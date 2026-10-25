/**
 * Procedural textures (generated once on a <canvas>), so the game ships with
 * zero image assets: nothing to download, nothing to break under a GitHub Pages
 * sub-path. All tile seamlessly.
 */
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Tileable value noise. `px`,`py` = lattice period along each axis. */
function makeNoise(seed) {
  const rand = rng(seed);
  const N = 512;
  const lat = new Float32Array(N * N);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const sm = (t) => t * t * (3 - 2 * t);
  return function noise(u, v, px, py = px) {
    const x = u * px;
    const y = v * py;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = sm(x - ix);
    const fy = sm(y - iy);
    const x0 = ((ix % px) + px) % px;
    const x1 = (x0 + 1) % px;
    const y0 = ((iy % py) + py) % py;
    const y1 = (y0 + 1) % py;
    const a = lat[y0 * N + x0];
    const b = lat[y0 * N + x1];
    const c = lat[y1 * N + x0];
    const d = lat[y1 * N + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(noise, u, v, px, py, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u, v, px << o, py << o);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Fill a canvas per-pixel from `fn(u, v, x, y) -> [r,g,b]`. */
function paint(size, fn) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(canvas, { color = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

// ---------------------------------------------------------------- materials ----
function wood(aniso) {
  const n = makeNoise(11);
  const dark = hex(0x7a4e2a);
  const light = hex(0xc8975f);
  return toTexture(
    paint(512, (u, v) => {
      // Long grain: noise stretched along u, plus slow "growth ring" waves.
      const grain = fbm(n, u, v, 2, 48, 3);
      const ring = 0.5 + 0.5 * Math.sin((v * 22 + fbm(n, u, v, 3, 6, 2) * 5) * Math.PI * 2);
      const t = 0.5 * grain + 0.38 * ring + 0.12 * n(u, v, 64, 64);
      return mix(dark, light, t);
    }),
    { aniso },
  );
}

function stone(aniso) {
  const n = makeNoise(23);
  const dark = hex(0x7d8084);
  const light = hex(0xb9bbbd);
  return toTexture(
    paint(512, (u, v) => {
      const blotch = fbm(n, u, v, 6, 6, 5);
      const speck = n(u, v, 128, 128);
      const pit = speck > 0.86 ? 0.6 : 1;
      return mix(dark, light, blotch * 0.85 + speck * 0.15).map((c) => c * pit);
    }),
    { aniso },
  );
}

/** One tile = 1.2 m x 1.2 m = two courses of one 1.2 m brick, staggered by half a brick. */
function brick(aniso) {
  const n = makeNoise(37);
  const mortar = hex(0xb4ada0);
  const S = 512;
  const course = S / 2;
  const m = 7; // mortar thickness in px
  const tones = [hex(0x9c4a36), hex(0xa85438), hex(0x8f4331), hex(0xb05c3e)];
  return toTexture(
    paint(S, (u, v, x, y) => {
      const row = Math.floor(y / course);
      const xo = (x - row * (S / 2) + S) % S; // stagger the second course
      const by = y % course;
      const speck = n(u, v, 96, 96);
      if (xo < m || by < m) return mix(mortar, hex(0x8d877b), speck * 0.7);
      const base = tones[(row * 2 + (xo > S / 2 ? 1 : 0)) % tones.length];
      const blotch = fbm(n, u, v, 8, 8, 4);
      return mix(base, hex(0x6d3426), blotch * 0.55 + speck * 0.18);
    }),
    { aniso },
  );
}

function metal(aniso) {
  const n = makeNoise(53);
  const dark = hex(0x8d949c);
  const light = hex(0xd2d7dc);
  return toTexture(
    paint(512, (u, v) => {
      // Brushed steel: very fine noise stretched along u.
      const t = 0.6 * n(u, v, 2, 256) + 0.4 * n(u, v, 4, 64);
      return mix(dark, light, t);
    }),
    { aniso },
  );
}

// ------------------------------------------------------------------ world ------
export function groundTexture(aniso) {
  const n = makeNoise(71);
  const g1 = hex(0x587f3e);
  const g2 = hex(0x86a655);
  const dirt = hex(0x8d7c57);
  return toTexture(
    paint(512, (u, v) => {
      const base = mix(g1, g2, fbm(n, u, v, 8, 8, 5));
      const patch = Math.max(0, fbm(n, u, v, 3, 3, 3) - 0.58) * 3.2;
      const blade = n(u, v, 192, 192);
      return mix(base, dirt, Math.min(0.75, patch)).map((c) => c * (0.9 + blade * 0.2));
    }),
    { aniso },
  );
}

/** 5 m x 5 m tile of the build pad: faint 1 m lines with a stronger 5 m border. */
export function gridTexture(aniso) {
  const S = 320;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  for (let i = 1; i < 5; i++) {
    const p = (S / 5) * i;
    ctx.moveTo(p, 0); ctx.lineTo(p, S);
    ctx.moveTo(0, p); ctx.lineTo(S, p);
  }
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(0, 0, S, S);
  return toTexture(canvas, { aniso });
}

export function createPieceTextures(aniso) {
  return { wood: wood(aniso), stone: stone(aniso), brick: brick(aniso), metal: metal(aniso) };
}
