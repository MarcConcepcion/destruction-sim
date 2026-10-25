/**
 * Physics layer: a thin, renderer-agnostic wrapper around Rapier.
 *
 * Responsibilities
 *  - own the Rapier world, the fixed-step clock and slow-motion handling
 *  - create / remove rigid bodies ("entities") and keep a collider -> entity map
 *  - hand interpolated transforms to render objects
 *  - scene queries used by the builder and tools (ray, shape-cast, overlap)
 *
 * This module deliberately has no dependency on Three.js, so the same code runs
 * headless in Node for tests (see tests/physics.test.mjs). A render object only
 * has to look like `{ position.set(), quaternion.set(), visible }`.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';

const POSE_LEN = 7; // x y z qx qy qz qw

function makeColliderDesc(shape) {
  switch (shape.type) {
    case 'box':
      return RAPIER.ColliderDesc.cuboid(shape.half[0], shape.half[1], shape.half[2]);
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
    case 'ball':
      return RAPIER.ColliderDesc.ball(shape.radius);
    default:
      throw new Error(`Unknown shape type: ${shape.type}`);
  }
}

/** Build a Rapier query shape (optionally uniformly scaled, used to shrink overlap probes). */
function makeQueryShape(shape, k = 1) {
  switch (shape.type) {
    case 'box':
      return new RAPIER.Cuboid(shape.half[0] * k, shape.half[1] * k, shape.half[2] * k);
    case 'cylinder':
      return new RAPIER.Cylinder(shape.halfHeight * k, shape.radius * k);
    default:
      return new RAPIER.Ball(shape.radius * k);
  }
}

export class Physics {
  /** Rapier's compat build must load its (embedded) WASM before any use. */
  static async create(options) {
    await RAPIER.init();
    return new Physics(options);
  }

  constructor({ gravity = 9.81 } = {}) {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.integrationParameters.numSolverIterations = CONFIG.SOLVER_ITERATIONS;

    this.gravity = gravity;
    this.timeScale = 1;
    this.paused = false;

    /** Dynamic bodies we manage. */
    this.entities = new Set();
    /** collider handle -> entity (ground maps to GROUND). Cleaned on removal. */
    this.byCollider = new Map();
    this.anchors = new Set();
    this.nextId = 1;

    this.accumulator = 0;
    this.alpha = 1; // render interpolation factor in [0,1)
    this.simTime = 0; // simulated seconds (advances slower in slow-mo)
    this.tickCount = 0;
    this.awakeCount = 0;
    /** True when colliders were added/removed since the last world step. */
    this.queriesDirty = false;

    this.GROUND = { kind: 'ground', id: 0 };
    this._createGround();
    // Scene queries only see colliders that existed during a step(): prime once.
    this.world.step();
  }

  // ---------------------------------------------------------------- world ----
  _createGround() {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    const h = CONFIG.GROUND_HALF;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h, 0.5, h).setFriction(0.9).setRestitution(0.05),
      body,
    );
    this.groundBody = body;
    this.groundCollider = collider;
    this.byCollider.set(collider.handle, this.GROUND);
  }

  setGravity(g) {
    this.gravity = g;
    this.world.gravity = { x: 0, y: -g, z: 0 };
    // Sleeping bodies would otherwise ignore the new gravity.
    this.wakeAll();
  }

  wakeAll() {
    for (const e of this.entities) e.body.wakeUp();
  }

  // -------------------------------------------------------------- entities ----
  /**
   * Create a dynamic rigid body + collider.
   * @param {object} d
   * @param {string} d.kind        'piece' | 'projectile' | 'wrecker' | ...
   * @param {object} d.shape       {type:'box',half:[x,y,z]} | {type:'cylinder',halfHeight,radius} | {type:'ball',radius}
   * @param {number} d.mass        kilograms (inertia is derived from the shape)
   * @param {{x:number,y:number,z:number}} d.position
   * @param {{x:number,y:number,z:number,w:number}} [d.quaternion]
   * @param {{x:number,y:number,z:number}} [d.velocity]
   * @param {boolean} [d.ccd]      continuous collision detection (fast projectiles)
   * @param {boolean} [d.persistent] disabled (not removed) when it leaves the world, so Restore can bring it back
   * @param {object} [d.mesh]      render object to drive
   * @param {Function} [d.onRemove] called after the body is removed
   */
  createEntity(d) {
    const rb = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(d.position.x, d.position.y, d.position.z)
      .setLinearDamping(d.linearDamping ?? 0.02)
      .setAngularDamping(d.angularDamping ?? 0.05)
      .setCcdEnabled(!!d.ccd);
    if (d.quaternion) rb.setRotation(d.quaternion);
    if (d.velocity) rb.setLinvel(d.velocity.x, d.velocity.y, d.velocity.z);
    const body = this.world.createRigidBody(rb);

    const cd = makeColliderDesc(d.shape)
      .setMass(d.mass)
      .setFriction(d.friction ?? 0.7)
      .setRestitution(d.restitution ?? 0.05);
    const collider = this.world.createCollider(cd, body);

    const q = d.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };
    const pose = [d.position.x, d.position.y, d.position.z, q.x, q.y, q.z, q.w];
    const entity = {
      id: this.nextId++,
      kind: d.kind,
      body,
      collider,
      shape: d.shape,
      mass: d.mass,
      mesh: d.mesh ?? null,
      data: d.data ?? {},
      persistent: !!d.persistent,
      onRemove: d.onRemove ?? null,
      home: { p: pose.slice(0, 3), q: pose.slice(3) },
      prev: pose.slice(),
      cur: pose.slice(),
      active: true,
      removed: false,
      asleepSynced: false, // pose already captured while asleep
      meshSynced: false, // mesh already written with the final resting pose
    };
    this.entities.add(entity);
    this.byCollider.set(collider.handle, entity);
    this.queriesDirty = true;
    if (entity.mesh) this._writeMesh(entity, 1);
    return entity;
  }

  removeEntity(e) {
    if (e.removed) return;
    e.removed = true;
    this.entities.delete(e);
    this.byCollider.delete(e.collider.handle);
    // Removing the body also removes its colliders and any attached joints.
    this.world.removeRigidBody(e.body);
    this.queriesDirty = true;
    if (e.onRemove) e.onRemove(e);
  }

  /** Fixed, collider-less body used as a joint anchor (e.g. the crane hook). */
  createAnchor(position) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z),
    );
    this.anchors.add(body);
    return body;
  }

  /** Rope = maximum-distance joint: the body can swing and slacken but never stretch. */
  createRope(anchorBody, entity, length) {
    const data = RAPIER.JointData.rope(length, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    return this.world.createImpulseJoint(data, anchorBody, entity.body, true);
  }

  removeAnchor(body) {
    if (!this.anchors.delete(body)) return;
    this.world.removeRigidBody(body); // also drops joints attached to it
  }

  /** Put a persistent entity back at the pose it was built in. */
  restoreEntity(e) {
    const b = e.body;
    b.setEnabled(true);
    b.setTranslation({ x: e.home.p[0], y: e.home.p[1], z: e.home.p[2] }, true);
    b.setRotation({ x: e.home.q[0], y: e.home.q[1], z: e.home.q[2], w: e.home.q[3] }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    b.wakeUp();
    e.active = true;
    if (e.mesh) e.mesh.visible = true;
    this._capture(e, true);
    e.asleepSynced = false;
    e.meshSynced = false;
    this.queriesDirty = true;
  }

  /** Persistent entities that leave the world are parked instead of deleted. */
  _disableEntity(e) {
    e.body.setEnabled(false);
    e.active = false;
    if (e.mesh) e.mesh.visible = false;
    this.queriesDirty = true;
  }

  // ------------------------------------------------------------- stepping ----
  /**
   * Advance the simulation by a real frame time.
   *
   * Real time is consumed in fixed FIXED_DT ticks. Slow motion / fast forward
   * scales the *simulated* time of each tick instead of skipping ticks, so slow
   * motion stays smooth (the render interpolates between ticks) and a tick never
   * exceeds FIXED_DT of simulated time (stability).
   */
  update(frameDt) {
    if (this.paused) return;
    this.accumulator += Math.min(frameDt, CONFIG.MAX_FRAME_DT);
    let ticks = 0;
    while (this.accumulator >= CONFIG.FIXED_DT) {
      if (ticks >= CONFIG.MAX_TICKS_PER_FRAME) {
        this.accumulator = 0; // can't keep up: drop the backlog rather than spiral
        break;
      }
      this._tick();
      this.accumulator -= CONFIG.FIXED_DT;
      ticks++;
    }
    this.alpha = this.accumulator / CONFIG.FIXED_DT;
  }

  _tick() {
    const s = this.timeScale;
    const substeps = Math.max(1, Math.ceil(s)); // fast-forward: keep each step <= FIXED_DT
    this.world.timestep = (CONFIG.FIXED_DT * s) / substeps;
    for (let i = 0; i < substeps; i++) this.world.step();
    this.simTime += CONFIG.FIXED_DT * s;
    this.tickCount++;
    this.queriesDirty = false;
    this._afterStep();
  }

  /**
   * Make newly added/removed colliders visible to scene queries.
   *
   * Rapier refreshes its query structures inside step(). While the simulation
   * runs, the next tick (<= 16 ms away) does that for free, so nothing is done
   * here. While *paused* no tick happens, so placement/erase previews would see
   * a stale world; we then run a 0.1 ms step. A step that short still injects a
   * little contact jitter, so awake bodies' velocities are saved and restored
   * around it: the pause stays frozen and resting stacks stay asleep.
   * (Measured: without the restore, a settled 72-brick tower never fell asleep.)
   */
  prepareQueries() {
    if (!this.queriesDirty || !this.paused) return;
    const saved = [];
    for (const e of this.entities) {
      if (e.active && !e.body.isSleeping()) saved.push([e.body, e.body.linvel(), e.body.angvel()]);
    }
    const dt = this.world.timestep;
    this.world.timestep = 1e-4;
    this.world.step();
    this.world.timestep = dt;
    for (const [body, lv, av] of saved) {
      body.setLinvel(lv, false);
      body.setAngvel(av, false);
    }
    this.queriesDirty = false;
  }

  _afterStep() {
    let awake = 0;
    let fell = null;
    for (const e of this.entities) {
      if (!e.active) continue;
      if (e.body.isSleeping()) {
        // Capture the final pose once, then skip the body until it wakes.
        if (!e.asleepSynced) {
          this._capture(e, true);
          e.asleepSynced = true;
        }
        continue;
      }
      awake++;
      e.asleepSynced = false;
      e.meshSynced = false;
      this._capture(e, false);
      if (e.cur[1] < CONFIG.KILL_Y) (fell ??= []).push(e);
    }
    this.awakeCount = awake;
    if (fell) {
      for (const e of fell) {
        if (e.persistent) this._disableEntity(e);
        else this.removeEntity(e);
      }
    }
  }

  /** Read the body pose into e.cur (prev <- cur, or both = current when snapping). */
  _capture(e, snap) {
    if (!snap) {
      for (let i = 0; i < POSE_LEN; i++) e.prev[i] = e.cur[i];
    }
    const t = e.body.translation();
    const r = e.body.rotation();
    const c = e.cur;
    c[0] = t.x; c[1] = t.y; c[2] = t.z;
    c[3] = r.x; c[4] = r.y; c[5] = r.z; c[6] = r.w;
    if (snap) {
      for (let i = 0; i < POSE_LEN; i++) e.prev[i] = c[i];
    }
  }

  /** Push (interpolated) transforms to render objects. Call once per rendered frame. */
  syncMeshes() {
    const a = this.paused ? 1 : this.alpha;
    for (const e of this.entities) {
      if (!e.mesh || !e.active) continue;
      if (e.asleepSynced) {
        if (e.meshSynced) continue; // resting: mesh already shows the final pose
        this._writeMesh(e, 1);
        e.meshSynced = true;
      } else {
        this._writeMesh(e, a);
      }
    }
  }

  _writeMesh(e, a) {
    const p = e.prev;
    const c = e.cur;
    const m = e.mesh;
    m.position.set(p[0] + (c[0] - p[0]) * a, p[1] + (c[1] - p[1]) * a, p[2] + (c[2] - p[2]) * a);
    // Normalised lerp, taking the shortest arc.
    const dot = p[3] * c[3] + p[4] * c[4] + p[5] * c[5] + p[6] * c[6];
    const s = dot < 0 ? -1 : 1;
    let x = p[3] + (c[3] * s - p[3]) * a;
    let y = p[4] + (c[4] * s - p[4]) * a;
    let z = p[5] + (c[5] * s - p[5]) * a;
    let w = p[6] + (c[6] * s - p[6]) * a;
    const len = Math.hypot(x, y, z, w) || 1;
    x /= len; y /= len; z /= len; w /= len;
    m.quaternion.set(x, y, z, w);
  }

  // --------------------------------------------------------------- queries ----
  /**
   * Cast a ray against the world.
   * @param {{x,y,z}} origin
   * @param {{x,y,z}} dir  unit vector
   * @param {number} maxDist
   * @param {(e:object)=>boolean} [filter] return false to ignore an entity (ground is `physics.GROUND`)
   * @returns {{point:{x,y,z}, normal:{x,y,z}, distance:number, entity:object}|null}
   */
  pick(origin, dir, maxDist = 300, filter) {
    this.prepareQueries();
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider) => {
        const e = this.byCollider.get(collider.handle);
        return !!e && (!filter || filter(e));
      },
    );
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      point: { x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      distance: d,
      entity: this.byCollider.get(hit.collider.handle),
    };
  }

  /**
   * Slide a shape straight down from `start` until it touches something.
   * @returns {number|null} distance travelled, or null if nothing is below.
   */
  castShapeDown(shape, start, quat, maxDist) {
    this.prepareQueries();
    const hit = this.world.castShape(
      start,
      quat,
      { x: 0, y: -1, z: 0 },
      makeQueryShape(shape),
      0,
      maxDist,
      true,
    );
    return hit ? hit.time_of_impact : null;
  }

  /** True if the (slightly shrunk) shape overlaps any collider. */
  overlaps(shape, pos, quat, shrink = 0.96) {
    this.prepareQueries();
    return !!this.world.intersectionWithShape(pos, quat, makeQueryShape(shape, shrink));
  }

  // ------------------------------------------------------------- bookkeeping ----
  count(kind) {
    let n = 0;
    for (const e of this.entities) if (e.kind === kind && e.active) n++;
    return n;
  }

  /** Free the WASM-side world. The instance is unusable afterwards. */
  dispose() {
    this.entities.clear();
    this.byCollider.clear();
    this.anchors.clear();
    this.world.free();
    this.world = null;
  }
}
