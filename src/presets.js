/**
 * One-click starter structures. They go through the same Structures.addPiece()
 * path as hand-placed pieces, so they are ordinary rigid bodies: nothing is
 * glued together, they only stand because of friction and stacking.
 */
import { PIECE_BY_ID } from './pieces.js';

const GAP = 0.005; // 5 mm of clearance per course so freshly spawned layers never start interpenetrating
const qy = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

export const PRESETS = [
  { id: 'wall',    name: 'Brick wall', tip: 'A 12-course staggered brick wall, 8 bricks wide' },
  { id: 'tower',   name: 'Tower',      tip: 'An 18-storey pinwheel tower of stone bricks' },
  { id: 'pyramid', name: 'Pyramid',    tip: 'A stepped pyramid of wooden cubes' },
];

function wall(add) {
  const [L, H] = PIECE_BY_ID.brick.shape.size;
  const perRow = 8;
  const rows = 12;
  const x0 = (-perRow * L) / 2 + L / 2;
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? L / 2 : 0; // running bond: every other course offset by half a brick
    for (let i = 0; i < perRow; i++) {
      add('brick', 'brick', { x: x0 + i * L + shift, y: H / 2 + r * (H + GAP), z: 0 }, 0);
    }
  }
}

function tower(add) {
  const [L, H, W] = PIECE_BY_ID.brick.shape.size;
  const layers = 18;
  // 4 bricks around a small central void ("pinwheel"); the pattern is mirrored on alternate
  // layers so the vertical joints don't line up.
  const a = L / 2 - W / 2; // 0.3
  const b = L / 2; // 0.6
  const ring = [
    [-a, -b, 0],
    [b, -a, Math.PI / 2],
    [a, b, 0],
    [-b, a, Math.PI / 2],
  ];
  for (let l = 0; l < layers; l++) {
    const mirror = l % 2 === 1;
    for (const [x, z, yaw] of ring) {
      add('brick', 'stone', { x: mirror ? -x : x, y: H / 2 + l * (H + GAP), z }, yaw);
    }
  }
}

function pyramid(add) {
  const c = PIECE_BY_ID.cube.shape.size[0];
  const base = 6;
  for (let k = 0; k < base; k++) {
    const n = base - k;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        add(
          'cube',
          'wood',
          { x: (i - (n - 1) / 2) * c, y: c / 2 + k * (c + GAP), z: (j - (n - 1) / 2) * c },
          0,
        );
      }
    }
  }
}

const BUILDERS = { wall, tower, pyramid };

/**
 * Replace everything with a preset. Returns how many pieces were created.
 */
export function loadPreset(id, structures) {
  structures.clearAll();
  let n = 0;
  BUILDERS[id]((typeId, materialId, position, yaw) => {
    if (structures.addPiece({ typeId, materialId, position, quaternion: qy(yaw) })) n++;
  });
  return n;
}
