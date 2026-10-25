/**
 * Material library: physical properties + shared Three.js materials.
 *
 * Every placed piece reuses one of a small, fixed set of materials (4 kinds x 3
 * tint variants) and a cached geometry per piece type, so the number of GPU
 * resources does not grow with the number of pieces - and nothing needs
 * disposing when pieces are deleted.
 */
import * as THREE from 'three';
import { createPieceTextures, groundTexture, gridTexture } from './textures.js';

/**
 * density: multiplier on the global "piece density" slider.
 * texWorld: world size in metres of one texture tile.
 */
export const MATERIALS = {
  wood:  { name: 'Wood',  density: 0.6, friction: 0.6,  restitution: 0.12, roughness: 0.85, metalness: 0.0,  texWorld: 1.6, swatch: '#b98550' },
  stone: { name: 'Stone', density: 1.0, friction: 0.8,  restitution: 0.04, roughness: 0.92, metalness: 0.0,  texWorld: 1.2, swatch: '#9a9c9f' },
  brick: { name: 'Brick', density: 0.9, friction: 0.75, restitution: 0.05, roughness: 0.88, metalness: 0.0,  texWorld: 1.2, swatch: '#a24d37' },
  metal: { name: 'Metal', density: 2.2, friction: 0.45, restitution: 0.15, roughness: 0.38, metalness: 0.85, texWorld: 1.0, swatch: '#b8bfc6' },
};

const TINTS = [0xffffff, 0xece4dc, 0xdde6ee];

export function createMaterialLibrary(maxAnisotropy = 4) {
  const aniso = Math.min(4, maxAnisotropy);
  const textures = createPieceTextures(aniso);
  const ground = groundTexture(aniso);
  const grid = gridTexture(aniso);
  const owned = [ground, grid, ...Object.values(textures)];

  const pieceMaterials = {};
  for (const [id, def] of Object.entries(MATERIALS)) {
    const map = textures[id];
    map.repeat.set(1 / def.texWorld, 1 / def.texWorld); // geometry UVs are in metres
    pieceMaterials[id] = TINTS.map(
      (tint) =>
        new THREE.MeshStandardMaterial({
          map,
          bumpMap: map,
          bumpScale: id === 'brick' ? 1.6 : 0.8,
          color: tint,
          roughness: def.roughness,
          metalness: def.metalness,
          envMapIntensity: id === 'metal' ? 1.2 : 0.6,
        }),
    );
  }

  ground.repeat.set(120, 120); // 600 m plane / 5 m tiles
  const groundMaterial = new THREE.MeshStandardMaterial({ map: ground, roughness: 1, metalness: 0 });

  grid.repeat.set(8, 8); // 40 m pad / 5 m tiles
  const gridMaterial = new THREE.MeshBasicMaterial({
    map: grid,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });

  // Tools use a distinct, saturated palette so they never read as building blocks.
  const tools = {
    ball: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.3, metalness: 0.9 }),
    weight: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.45, metalness: 0.55 }),
    wrecker: new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.28, metalness: 0.95 }),
    gantry: new THREE.MeshStandardMaterial({ color: 0xf5b800, roughness: 0.55, metalness: 0.35 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 0.9, metalness: 0 }),
  };

  const ghostOK = new THREE.MeshBasicMaterial({ color: 0x35e0a1, transparent: true, opacity: 0.45, depthWrite: false });
  const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.45, depthWrite: false });
  const ghostEdge = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const hoverErase = new THREE.MeshBasicMaterial({
    color: 0xff3b30,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const all = [
    ...Object.values(pieceMaterials).flat(),
    groundMaterial,
    gridMaterial,
    ...Object.values(tools),
    ghostOK, ghostBad, ghostEdge, hoverErase,
  ];

  return {
    ground: groundMaterial,
    grid: gridMaterial,
    tools,
    ghostOK,
    ghostBad,
    ghostEdge,
    hoverErase,
    piece(materialId, variant = 0) {
      const list = pieceMaterials[materialId];
      return list[variant % list.length];
    },
    /** Re-compile after toggling shadows. */
    refresh() {
      for (const m of all) m.needsUpdate = true;
    },
    dispose() {
      for (const m of all) m.dispose();
      for (const t of owned) t.dispose();
    },
  };
}
