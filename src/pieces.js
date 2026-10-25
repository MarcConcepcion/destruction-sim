/**
 * Construction piece catalogue: shapes, sizes and the geometry/physics helpers
 * that depend on them. Sizes are in metres.
 */
import * as THREE from 'three';

export const PIECES = [
  { id: 'cube',   name: 'Cube',   key: '1', tip: 'Cube 0.8 m - the all-round building block',        shape: { type: 'box', size: [0.8, 0.8, 0.8] } },
  { id: 'brick',  name: 'Brick',  key: '2', tip: 'Brick 1.2 x 0.6 x 0.6 m - stack in staggered courses', shape: { type: 'box', size: [1.2, 0.6, 0.6] } },
  { id: 'plank',  name: 'Plank',  key: '3', tip: 'Plank 3.0 x 0.25 x 0.8 m - floors and bridges',    shape: { type: 'box', size: [3.0, 0.25, 0.8] } },
  { id: 'beam',   name: 'Beam',   key: '4', tip: 'Beam 2.4 x 0.4 x 0.4 m - lintels and supports',    shape: { type: 'box', size: [2.4, 0.4, 0.4] } },
  { id: 'column', name: 'Column', key: '5', tip: 'Column, 0.8 m wide and 1.6 m tall - round pillar', shape: { type: 'cylinder', radius: 0.4, height: 1.6 } },
  { id: 'slab',   name: 'Slab',   key: '6', tip: 'Slab 2.4 x 0.3 x 2.4 m - big floors and roofs',    shape: { type: 'box', size: [2.4, 0.3, 2.4] } },
  { id: 'ball',   name: 'Ball',   key: '7', tip: 'Ball 0.8 m - rolls away when the support goes',    shape: { type: 'ball', radius: 0.4 } },
];

export const PIECE_BY_ID = Object.fromEntries(PIECES.map((p) => [p.id, p]));

/** Shape description in the form physics.js expects. */
export function physicsShape(def) {
  const s = def.shape;
  if (s.type === 'box') return { type: 'box', half: s.size.map((v) => v / 2) };
  if (s.type === 'cylinder') return { type: 'cylinder', halfHeight: s.height / 2, radius: s.radius };
  return { type: 'ball', radius: s.radius };
}

export function pieceVolume(def) {
  const s = def.shape;
  if (s.type === 'box') return s.size[0] * s.size[1] * s.size[2];
  if (s.type === 'cylinder') return Math.PI * s.radius * s.radius * s.height;
  return (4 / 3) * Math.PI * s.radius ** 3;
}

/**
 * Re-write UVs so one UV unit == one metre. Materials then pick their own tile
 * size through texture.repeat, and a 3 m plank shows the same grain scale as a
 * 0.8 m cube instead of a stretched copy of the texture.
 */
function metreUVs(geometry, kind, size) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (kind === 'box') {
      if (nx > 0.5) uv.setXY(i, z, y);
      else if (ny > 0.5) uv.setXY(i, x, z);
      else uv.setXY(i, x, y);
    } else if (kind === 'cylinder') {
      if (ny > 0.5) uv.setXY(i, x, z);
      else uv.setXY(i, uv.getX(i) * 2 * Math.PI * size, y); // wrap-around, continuous across the seam
    } else {
      uv.setXY(i, uv.getX(i) * 2 * Math.PI * size, uv.getY(i) * Math.PI * size);
    }
  }
  uv.needsUpdate = true;
}

const geometryCache = new Map();
const edgeCache = new Map();

export function getPieceGeometry(def) {
  let g = geometryCache.get(def.id);
  if (!g) {
    const s = def.shape;
    if (s.type === 'box') {
      g = new THREE.BoxGeometry(...s.size);
      metreUVs(g, 'box');
    } else if (s.type === 'cylinder') {
      g = new THREE.CylinderGeometry(s.radius, s.radius, s.height, 28);
      metreUVs(g, 'cylinder', s.radius);
    } else {
      g = new THREE.SphereGeometry(s.radius, 28, 18);
      metreUVs(g, 'ball', s.radius);
    }
    geometryCache.set(def.id, g);
  }
  return g;
}

/** Outline used by the placement preview. */
export function getPieceEdges(def) {
  let g = edgeCache.get(def.id);
  if (!g) {
    g = new THREE.EdgesGeometry(getPieceGeometry(def), 30);
    edgeCache.set(def.id, g);
  }
  return g;
}

export function disposePieceGeometries() {
  for (const g of geometryCache.values()) g.dispose();
  for (const g of edgeCache.values()) g.dispose();
  geometryCache.clear();
  edgeCache.clear();
}

const _m = new THREE.Matrix4();
/**
 * Half-extents of the world-axis-aligned bounding box of a rotated piece.
 * Used to rest a preview exactly on a surface regardless of its orientation.
 */
export function worldHalfExtents(def, quat, out = new THREE.Vector3()) {
  _m.makeRotationFromQuaternion(quat);
  const e = _m.elements; // column-major: element(row i, col j) = e[j*4 + i]
  const s = def.shape;
  if (s.type === 'box') {
    const h = s.size.map((v) => v / 2);
    return out.set(
      Math.abs(e[0]) * h[0] + Math.abs(e[4]) * h[1] + Math.abs(e[8]) * h[2],
      Math.abs(e[1]) * h[0] + Math.abs(e[5]) * h[1] + Math.abs(e[9]) * h[2],
      Math.abs(e[2]) * h[0] + Math.abs(e[6]) * h[1] + Math.abs(e[10]) * h[2],
    );
  }
  if (s.type === 'cylinder') {
    const hh = s.height / 2;
    const ax = [e[4], e[5], e[6]]; // the cylinder's axis in world space
    const f = (a) => hh * Math.abs(a) + s.radius * Math.sqrt(Math.max(0, 1 - a * a));
    return out.set(f(ax[0]), f(ax[1]), f(ax[2]));
  }
  return out.set(s.radius, s.radius, s.radius);
}
