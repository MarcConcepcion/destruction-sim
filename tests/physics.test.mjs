/**
 * Headless physics tests (no browser, no Three.js): `npm test`
 *
 * These exercise the real Physics wrapper + Rapier WASM and assert on emergent
 * behaviour (stability, toppling, rope length, cleanup) rather than on scripts.
 */
import { Physics } from '../src/physics.js';
import { CONFIG } from '../src/config.js';

let passed = 0;
let failed = 0;
const results = [];
function check(name, ok, detail = '') {
  (ok ? passed++ : failed++);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---- helpers ---------------------------------------------------------------
const Q_ID = { x: 0, y: 0, z: 0, w: 1 };
const qy = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const BRICK = { type: 'box', half: [0.6, 0.3, 0.3] };
const brickMass = 1.2 * 0.6 * 0.6 * 350 * 0.9;

function runSeconds(p, seconds, { microEvery = 0 } = {}) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    p.update(1 / 60);
    if (microEvery && i % microEvery === 0) {
      p.queriesDirty = true;
      p.prepareQueries(); // simulate the builder poking the world mid-sim
    }
  }
}

/** The pinwheel tower from src/presets.js: 4 bricks/layer, mirrored every other layer. */
function buildTower(p, layers = 18) {
  const ents = [];
  const A = [[-0.3, -0.6, 0], [0.6, -0.3, Math.PI / 2], [0.3, 0.6, 0], [-0.6, 0.3, Math.PI / 2]];
  for (let l = 0; l < layers; l++) {
    const mirror = l % 2 === 1;
    for (const [x, z, a] of A) {
      ents.push(
        p.createEntity({
          kind: 'piece',
          shape: BRICK,
          mass: brickMass,
          position: { x: mirror ? -x : x, y: 0.3 + l * 0.6 + 0.005 * l, z },
          quaternion: qy(a),
          friction: 0.75,
          restitution: 0.05,
          persistent: true,
        }),
      );
    }
  }
  return ents;
}

function topY(ents) { return Math.max(...ents.map((e) => e.body.translation().y)); }

// ---- 1. world, queries ------------------------------------------------------
{
  const p = await Physics.create();
  const hit = p.pick({ x: 3, y: 10, z: 2 }, { x: 0, y: -1, z: 0 });
  check('ray pick finds ground', !!hit && Math.abs(hit.point.y) < 1e-3 && hit.entity === p.GROUND && hit.normal.y > 0.99,
    hit && `y=${hit.point.y.toFixed(3)}`);

  const e = p.createEntity({ kind: 'piece', shape: { type: 'box', half: [0.4, 0.4, 0.4] }, mass: 100, position: { x: 0, y: 0.4, z: 0 } });
  // While running, a new collider is visible to queries after the next tick.
  runSeconds(p, 1 / 60);
  check('new body visible to overlap query after one tick',
    p.overlaps({ type: 'box', half: [0.4, 0.4, 0.4] }, { x: 0, y: 0.5, z: 0 }, Q_ID));
  check('empty space reports no overlap',
    !p.overlaps({ type: 'box', half: [0.4, 0.4, 0.4] }, { x: 5, y: 0.5, z: 0 }, Q_ID));
  const toi = p.castShapeDown({ type: 'box', half: [0.4, 0.4, 0.4] }, { x: 5, y: 3, z: 5 }, Q_ID, 20);
  check('shape-cast down lands on the ground', toi !== null && Math.abs(toi - 2.6) < 1e-2, `toi=${toi?.toFixed(3)}`);
  const hit2 = p.pick({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 300, (en) => en.kind === 'piece');
  check('ray pick returns the entity it hit', hit2?.entity === e);
  p.dispose();
}

// ---- 2. settling / sleeping ---------------------------------------------------
{
  const p = await Physics.create();
  const e = p.createEntity({ kind: 'projectile', shape: { type: 'box', half: [0.5, 0.5, 0.5] }, mass: 200, position: { x: 0, y: 4, z: 0 } });
  runSeconds(p, 6);
  const y = e.body.translation().y;
  check('dropped box rests on the ground and goes to sleep', Math.abs(y - 0.5) < 0.02 && e.body.isSleeping(), `y=${y.toFixed(3)}`);
  check('awake counter drops to 0 once settled', p.awakeCount === 0);
  p.dispose();
}

// ---- 3. tower stability (with builder-style micro-steps interleaved) --------------
{
  const p = await Physics.create();
  const ents = buildTower(p, 18);
  const h0 = topY(ents);
  runSeconds(p, 12, { microEvery: 7 });
  const h1 = topY(ents);
  const drift = Math.max(...ents.map((e) => {
    const t = e.body.translation();
    return Math.hypot(t.x - e.home.p[0], t.z - e.home.p[2]);
  }));
  check('72-brick tower stands for 12 s', Math.abs(h1 - h0) < 0.15 && drift < 0.25, `top Δy=${(h1 - h0).toFixed(3)} m, max drift=${drift.toFixed(3)} m`);
  const sleeping = ents.filter((e) => e.body.isSleeping()).length;
  console.log(`   (info) ${sleeping}/${ents.length} bricks asleep after 12 s`);

  // ---- 3b. paused query refresh must not disturb a settled structure ----------------------
{
  const p2 = await Physics.create();
  const ents2 = buildTower(p2, 18);
  runSeconds(p2, 8);
  const asleepBefore = ents2.filter((e) => e.body.isSleeping()).length;
  const tops = topY(ents2);
  p2.paused = true;
  for (let i = 0; i < 200; i++) {
    const tmp = p2.createEntity({ kind: 'piece', shape: { type: 'box', half: [0.4, 0.4, 0.4] }, mass: 100, position: { x: 12 + (i % 5), y: 0.4, z: 8 } });
    p2.prepareQueries(); // what the builder does every frame while paused
    if (i % 3 === 0) { p2.removeEntity(tmp); p2.prepareQueries(); }
  }
  const stillAsleep = ents2.filter((e) => e.body.isSleeping()).length;
  check('settled tower falls asleep (72/72)', asleepBefore === ents2.length, `${asleepBefore}/72`);
  check('paused place/erase refreshes leave the tower asleep and unmoved', stillAsleep === asleepBefore && Math.abs(topY(ents2) - tops) < 1e-3, `${stillAsleep}/72 asleep`);
  p2.dispose();
}

// ---- 4. a cannonball must topple it through real contact physics -------------
  const ball = p.createEntity({
    kind: 'projectile', shape: { type: 'ball', radius: 0.4 }, mass: 300,
    position: { x: -14, y: 3.5, z: 0.1 }, velocity: { x: 38, y: 2, z: 0 }, ccd: true,
    friction: 0.5, restitution: 0.25, angularDamping: 0.6,
  });
  runSeconds(p, 8);
  const h2 = topY(ents);
  const scattered = ents.filter((e) => Math.hypot(e.body.translation().x, e.body.translation().z) > 1.5).length;
  check('cannonball collapses the tower', h2 < h0 * 0.5 && scattered > 20, `top ${h0.toFixed(1)}→${h2.toFixed(1)} m, ${scattered} bricks displaced >1.5 m`);
  check('debris eventually settles', p.awakeCount < ents.length / 2, `${p.awakeCount} still awake`);

  // ---- 5. restore ---------------------------------------------------------------
  p.removeEntity(ball);
  for (const e of ents) p.restoreEntity(e);
  runSeconds(p, 6);
  const h3 = topY(ents);
  check('restore rebuilds the tower exactly and it stands again', Math.abs(h3 - h0) < 0.15, `top ${h3.toFixed(2)} vs ${h0.toFixed(2)}`);
  p.dispose();
}

// ---- 6. rope pendulum --------------------------------------------------------------
{
  const p = await Physics.create();
  const L = 12;
  const anchor = p.createAnchor({ x: 0, y: 15, z: 0 });
  const ang = (65 * Math.PI) / 180;
  const ball = p.createEntity({
    kind: 'wrecker', shape: { type: 'ball', radius: 0.7 }, mass: 1500,
    position: { x: -L * Math.sin(ang), y: 15 - L * Math.cos(ang), z: 0 }, ccd: true, angularDamping: 0.3, linearDamping: 0.01,
  });
  p.createRope(anchor, ball, L);
  let maxDist = 0, minY = 99, maxX = -99;
  for (let i = 0; i < 60 * 8; i++) {
    p.update(1 / 60);
    const t = ball.body.translation();
    maxDist = Math.max(maxDist, Math.hypot(t.x, t.y - 15, t.z));
    minY = Math.min(minY, t.y); maxX = Math.max(maxX, t.x);
  }
  check('rope never stretches (<1%)', maxDist < L * 1.01, `max length ${maxDist.toFixed(3)} / ${L}`);
  check('wrecking ball swings through the bottom to the far side', minY < 15 - L * 0.99 && maxX > 4, `lowest y=${minY.toFixed(2)}, far x=${maxX.toFixed(2)}`);
  p.removeAnchor(anchor);
  p.removeEntity(ball);
  check('crane teardown leaves no entities', p.entities.size === 0 && p.anchors.size === 0);
  p.dispose();
}

// ---- 7. clock: slow motion + pause ----------------------------------------------------
{
  const p = await Physics.create();
  p.timeScale = 0.25;
  runSeconds(p, 4);
  check('slow-mo 0.25× advances ~1 s of sim per 4 s real', Math.abs(p.simTime - 1) < 0.05, `simTime=${p.simTime.toFixed(3)}`);
  p.timeScale = 2;
  const t0 = p.simTime;
  runSeconds(p, 2);
  check('2× speed advances ~4 s of sim per 2 s real', Math.abs(p.simTime - t0 - 4) < 0.1, `Δ=${(p.simTime - t0).toFixed(3)}`);
  p.paused = true;
  const t1 = p.simTime;
  runSeconds(p, 2);
  check('pause freezes simulated time', p.simTime === t1);
  p.paused = false;
  // a 1-second hitch must not cause a burst of >MAX_TICKS_PER_FRAME ticks
  const tk = p.tickCount;
  p.update(1.0);
  check('long frame is clamped (no spiral of death)', p.tickCount - tk <= CONFIG.MAX_TICKS_PER_FRAME, `${p.tickCount - tk} ticks`);
  p.dispose();
}

// ---- 8. world bounds ----------------------------------------------------------------------
{
  const p = await Physics.create();
  const proj = p.createEntity({ kind: 'projectile', shape: { type: 'ball', radius: 0.4 }, mass: 100, position: { x: 400, y: 5, z: 0 } });
  const piece = p.createEntity({ kind: 'piece', persistent: true, shape: { type: 'box', half: [0.4, 0.4, 0.4] }, mass: 100, position: { x: 400, y: 5, z: 5 } });
  runSeconds(p, 8); // beyond the ground edge: free-falls past KILL_Y
  check('projectile outside the world is removed', proj.removed && !p.entities.has(proj));
  check('piece outside the world is parked, not deleted', piece.persistent && !piece.active && !piece.removed);
  p.restoreEntity(piece);
  check('restore brings a fallen piece back', piece.active && Math.abs(piece.body.translation().x - 400) < 1e-6 && piece.body.isEnabled());
  p.dispose();
}

// ---- 9. continuous collision detection --------------------------------------------------------
{
  // A 0.2 m thick, very heavy wall; a ball at 120 m/s covers 2 m per tick, so some
  // start offsets would step straight over the wall without CCD.
  const run = async (ccd, startX) => {
    const p = await Physics.create();
    p.createEntity({ kind: 'piece', shape: { type: 'box', half: [0.1, 2, 3] }, mass: 40000, position: { x: 0, y: 2, z: 0 } });
    const b = p.createEntity({ kind: 'projectile', shape: { type: 'ball', radius: 0.3 }, mass: 50, position: { x: startX, y: 2, z: 0 }, velocity: { x: 120, y: 0, z: 0 }, ccd });
    runSeconds(p, 1.5);
    const x = b.body.translation().x;
    p.dispose();
    return x;
  };
  const offsets = [-9.0, -9.4, -9.8, -10.2];
  let blocked = 0, tunnelled = 0;
  for (const o of offsets) {
    if ((await run(true, o)) < 0.5) blocked++;
    if ((await run(false, o)) > 0.5) tunnelled++;
  }
  check('fast projectiles with CCD never tunnel through a thin wall', blocked === offsets.length, `${blocked}/${offsets.length} stopped`);
  console.log(`   (info) without CCD ${tunnelled}/${offsets.length} of the same shots tunnel through`);
}

// ---- 10. no unbounded growth / leaks -------------------------------------------------------------
{
  const p = await Physics.create();
  const baseBodies = p.world.bodies.len();
  for (let round = 0; round < 40; round++) {
    const ents = [];
    for (let i = 0; i < 50; i++) {
      ents.push(p.createEntity({ kind: 'projectile', shape: { type: 'ball', radius: 0.3 }, mass: 50, position: { x: (i % 10) * 0.7, y: 2 + (i / 10), z: 0 } }));
    }
    runSeconds(p, 0.2);
    for (const e of ents) p.removeEntity(e);
  }
  check('2000 create/remove cycles leave the world empty', p.entities.size === 0 && p.byCollider.size === 1 && p.world.bodies.len() === baseBodies,
    `entities=${p.entities.size}, colliderMap=${p.byCollider.size}, bodies=${p.world.bodies.len()}`);
  p.dispose();
}

console.log('\n' + results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
