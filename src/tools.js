/**
 * Destruction tools: cannon, heavy drop and wrecking ball.
 *
 * All three just create ordinary rigid bodies with velocity (or a rope joint);
 * every bit of damage afterwards is the physics engine resolving contacts.
 * Shared geometries/materials are reused, so firing 1000 shots allocates no new
 * GPU resources, and the projectile budget is enforced first-in-first-out.
 */
import * as THREE from 'three';
import { CONFIG } from './config.js';

const SPHERE = new THREE.SphereGeometry(1, 28, 20); // unit radius, scaled per shot
const CUBE = new THREE.BoxGeometry(1, 1, 1); // unit side, scaled per shot
const RADIUS_DENSITY = 800; // kg/m^3 used only to size impactors from their mass

const ROPE_LENGTH = 12;
const HIT_ANGLE = THREE.MathUtils.degToRad(20); // swing angle from vertical at which the ball meets the target

export const TOOLS = [
  { id: 'cannon', name: 'Cannon', key: '1', tip: 'Cannon: fires an iron ball where you click. Launch speed and mass in Settings.' },
  { id: 'drop', name: 'Drop', key: '2', tip: 'Heavy drop: releases a heavy weight from above the clicked spot (2x impactor mass).' },
  { id: 'wrecker', name: 'Wrecker', key: '3', tip: 'Wrecking ball: a crane swings a 5x-mass ball on a rope into the clicked spot.' },
];

/**
 * Launch direction that lands on `target` with speed `v` under gravity `g`
 * (low arc). Falls back to a straight shot if the target is out of range.
 */
export function ballisticDirection(origin, target, v, g, out = new THREE.Vector3()) {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const h = target.y - origin.y;
  const d = Math.hypot(dx, dz);
  const direct = () => out.set(target.x - origin.x, target.y - origin.y, target.z - origin.z).normalize();
  if (g < 0.05 || d < 0.5) return direct();
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return direct();
  const theta = Math.atan((v2 - Math.sqrt(disc)) / (g * d));
  return out.set((dx / d) * Math.cos(theta), Math.sin(theta), (dz / d) * Math.cos(theta));
}

export class Tools {
  constructor({ scene, camera, physics, materials, settings }) {
    Object.assign(this, { scene, camera, physics, materials, settings });
    this.projectiles = []; // FIFO of live projectile entities
    this.crane = null; // {group, ball, anchor, rope, geoms, from, to}
    this._v = new THREE.Vector3();
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  get projectileCount() {
    return this.projectiles.length;
  }

  // --------------------------------------------------------------- spawning ----
  _spawn({ kind, shape, mass, position, velocity, quaternion, mesh, material, angularDamping, restitution }) {
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return this.physics.createEntity({
      kind,
      shape,
      mass,
      position,
      velocity,
      quaternion,
      mesh,
      ccd: true, // fast, small, heavy: must not tunnel through thin planks
      friction: 0.5,
      restitution: restitution ?? 0.25,
      linearDamping: 0.0,
      angularDamping: angularDamping ?? 0.3,
      onRemove: (e) => {
        e.mesh.removeFromParent();
        const i = this.projectiles.indexOf(e);
        if (i >= 0) this.projectiles.splice(i, 1);
      },
    });
  }

  _register(entity) {
    this.projectiles.push(entity);
    while (this.projectiles.length > CONFIG.MAX_PROJECTILES) {
      this.physics.removeEntity(this.projectiles[0]); // oldest first
    }
  }

  /** Fire from just in front of the camera so the ball lands on `target`. */
  fire(target) {
    const { settings, camera } = this;
    const mass = settings.impactorMass;
    this._d.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const origin = this._o.copy(camera.position).addScaledVector(this._d, 2).add(this._v.set(0, -0.6, 0));
    const dir = ballisticDirection(origin, target, settings.launchSpeed, this.physics.gravity, this._v);

    const ball = settings.projectileShape === 'ball';
    const radius = THREE.MathUtils.clamp(Math.cbrt((3 * mass) / (4 * Math.PI * RADIUS_DENSITY)), 0.2, 1.2);
    const side = radius * 1.6; // a cube of similar bulk
    const mesh = new THREE.Mesh(ball ? SPHERE : CUBE);
    mesh.scale.setScalar(ball ? radius : side);
    const e = this._spawn({
      kind: 'projectile',
      shape: ball ? { type: 'ball', radius } : { type: 'box', half: [side / 2, side / 2, side / 2] },
      mass,
      position: { x: origin.x, y: origin.y, z: origin.z },
      velocity: { x: dir.x * settings.launchSpeed, y: dir.y * settings.launchSpeed, z: dir.z * settings.launchSpeed },
      mesh,
      material: this.materials.tools.ball,
      angularDamping: ball ? 0.6 : 0.2,
    });
    this._register(e);
    return e;
  }

  /** Release a heavy weight from `dropHeight` metres above the target's x/z. */
  drop(target) {
    const { settings } = this;
    const mass = settings.impactorMass * 2;
    const side = THREE.MathUtils.clamp(Math.cbrt(mass / 1200), 0.5, 1.6);
    const mesh = new THREE.Mesh(CUBE);
    mesh.scale.set(side, side * 0.85, side);
    const yaw = Math.random() * Math.PI;
    const e = this._spawn({
      kind: 'projectile',
      shape: { type: 'box', half: [side / 2, (side * 0.85) / 2, side / 2] },
      mass,
      position: { x: target.x, y: Math.max(settings.dropHeight, target.y + 3), z: target.z },
      quaternion: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
      mesh,
      material: this.materials.tools.weight,
      restitution: 0.1,
      angularDamping: 0.4,
    });
    this._register(e);
    return e;
  }

  /**
   * Build a small gantry crane and let its wrecking ball swing into `target`.
   *
   * Geometry: the hook sits above and *beyond* the target (as seen from the
   * camera) so the ball, released from `swingAngle` on the camera side, meets
   * the target ~20 deg before the bottom of its arc, where it is already moving
   * mostly horizontally at speed v = sqrt(2 g L (cos 20 - cos swingAngle)).
   */
  swing(target) {
    this.clearCrane();
    const { settings, camera, physics } = this;
    const L = ROPE_LENGTH;
    const mass = settings.impactorMass * 5;
    const radius = THREE.MathUtils.clamp(Math.cbrt((3 * mass) / (4 * Math.PI * 1000)), 0.4, 1.6);

    const dir = this._d.set(target.x - camera.position.x, 0, target.z - camera.position.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const dx = dir.x;
    const dz = dir.z;

    const hitY = THREE.MathUtils.clamp(target.y, radius + 0.05, 10);
    const hook = new THREE.Vector3(
      target.x + dx * L * Math.sin(HIT_ANGLE),
      hitY + L * Math.cos(HIT_ANGLE),
      target.z + dz * L * Math.sin(HIT_ANGLE),
    );
    const theta = THREE.MathUtils.degToRad(settings.swingAngle);
    const start = new THREE.Vector3(hook.x - dx * L * Math.sin(theta), hook.y - L * Math.cos(theta), hook.z - dz * L * Math.sin(theta));

    const anchor = physics.createAnchor(hook);
    const mesh = new THREE.Mesh(SPHERE);
    mesh.scale.setScalar(radius);
    const ball = this._spawn({
      kind: 'wrecker',
      shape: { type: 'ball', radius },
      mass,
      position: { x: start.x, y: start.y, z: start.z },
      mesh,
      material: this.materials.tools.wrecker,
      angularDamping: 0.4,
      restitution: 0.15,
    });
    physics.createRope(anchor, ball, L);

    // --- visuals: yellow gantry beside the swing plane, a rope, a pulley block ---
    const mat = this.materials.tools;
    const geoms = [];
    const part = (geo, material) => {
      geoms.push(geo);
      const m = new THREE.Mesh(geo, material);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const group = new THREE.Group();
    const px = -dz; // perpendicular to the swing direction
    const pz = dx;
    const mastX = hook.x + px * 3.2;
    const mastZ = hook.z + pz * 3.2;
    const mastH = hook.y + 1.2;
    const base = part(new THREE.BoxGeometry(2.6, 0.35, 2.6), mat.gantry);
    base.position.set(mastX, 0.175, mastZ);
    const mast = part(new THREE.CylinderGeometry(0.22, 0.3, mastH, 12), mat.gantry);
    mast.position.set(mastX, mastH / 2, mastZ);
    // Boom: from the mast top to the hook, a unit cylinder oriented and scaled to fit.
    const top = new THREE.Vector3(mastX, mastH, mastZ);
    const boomVec = new THREE.Vector3().subVectors(hook, top);
    const boomLen = boomVec.length();
    const boom = part(new THREE.CylinderGeometry(0.16, 0.16, boomLen, 10), mat.gantry);
    boom.position.copy(top).addScaledVector(boomVec, 0.5);
    boom.quaternion.setFromUnitVectors(this._up, boomVec.clone().normalize());
    const pulley = part(new THREE.SphereGeometry(0.3, 16, 12), mat.gantry);
    pulley.position.copy(hook);
    const rope = part(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), mat.rope);
    rope.castShadow = true;
    group.add(base, mast, boom, pulley, rope);
    this.scene.add(group);

    this.crane = { group, ball, anchor, rope, geoms, hook };
    this.update();
    return ball;
  }

  // --------------------------------------------------------------- upkeep ------
  /** Stretch the rope mesh between the hook and the ball. Call after physics.syncMeshes(). */
  update() {
    const c = this.crane;
    if (!c) return;
    const a = c.hook;
    const b = c.ball.mesh.position;
    this._v.subVectors(b, a);
    const len = this._v.length();
    c.rope.position.copy(a).addScaledVector(this._v, 0.5);
    c.rope.scale.set(1, Math.max(len, 1e-3), 1);
    c.rope.quaternion.setFromUnitVectors(this._up, this._v.divideScalar(len || 1));
  }

  clearCrane() {
    const c = this.crane;
    if (!c) return;
    this.crane = null;
    this.physics.removeEntity(c.ball); // removes the rope joint with it
    this.physics.removeAnchor(c.anchor);
    c.group.removeFromParent();
    for (const g of c.geoms) g.dispose(); // per-crane geometry; materials are shared
  }

  clearProjectiles() {
    for (const e of [...this.projectiles]) this.physics.removeEntity(e);
  }

  clearAll() {
    this.clearProjectiles();
    this.clearCrane();
  }

  dispose() {
    this.clearAll();
    SPHERE.dispose();
    CUBE.dispose();
  }
}
