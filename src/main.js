/**
 * Demolition Lab - entry point. Wires graphics, physics, build/destroy tools,
 * input and UI together and runs the frame loop.
 */
import './style.css';
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createGraphics } from './sceneSetup.js';
import { Physics } from './physics.js';
import { CameraRig } from './cameraRig.js';
import { Structures } from './structures.js';
import { Builder } from './builder.js';
import { Tools, TOOLS } from './tools.js';
import { PIECES, disposePieceGeometries } from './pieces.js';
import { MATERIALS } from './materials.js';
import { loadPreset, PRESETS } from './presets.js';
import { Input } from './input.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('scene');
const $loading = document.getElementById('loading');

function showFatal(title, detail) {
  $loading.hidden = true;
  document.getElementById('hud').hidden = true;
  document.getElementById('fatal-title').textContent = title;
  document.getElementById('fatal-text').textContent = detail;
  document.getElementById('fatal').hidden = false;
  document.getElementById('fatal-reload').onclick = () => location.reload();
}

async function boot() {
  const settings = { ...CONFIG.defaults };
  let gfx;
  let physics;
  try {
    gfx = createGraphics(canvas);
    physics = await Physics.create({ gravity: settings.gravity });
  } catch (err) {
    console.error(err);
    const noGL = !window.WebGLRenderingContext;
    showFatal(
      noGL ? 'WebGL is not available' : 'Could not start the game',
      noGL
        ? 'This browser has no WebGL support. Try a recent Chrome, Firefox, Safari or Edge with hardware acceleration enabled.'
        : String(err && err.message ? err.message : err),
    );
    return null;
  }
  physics.timeScale = settings.timeScale;

  // ------------------------------------------------------------ shared state ----
  const keys = new Set();
  const pointer = { ndc: new THREE.Vector2(), inside: false };
  const raycaster = new THREE.Raycaster();
  const state = { mode: 'build', toolIndex: 0 };

  const structures = new Structures({ scene: gfx.scene, physics, materials: gfx.materials, settings });
  const tools = new Tools({ scene: gfx.scene, camera: gfx.camera, physics, materials: gfx.materials, settings });
  const builder = new Builder({
    scene: gfx.scene, camera: gfx.camera, physics, structures, materials: gfx.materials, settings, pointer, raycaster,
  });
  const rig = new CameraRig(gfx.camera, canvas, keys);

  // Aim reticle for destroy mode.
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.42, 40),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }),
  );
  reticle.renderOrder = 10;
  reticle.visible = false;
  gfx.scene.add(reticle);
  const Z = new THREE.Vector3(0, 0, 1);
  const _n = new THREE.Vector3();

  // ----------------------------------------------------------------- actions ----
  let ui; // assigned below; actions only run after creation

  const notSolid = (e) => e.kind !== 'projectile' && e.kind !== 'wrecker';

  /** Where the pointer is aiming in the world (first solid hit, or the ground plane / far point). */
  function aimPoint(fallbackDistance) {
    raycaster.setFromCamera(pointer.ndc, gfx.camera);
    const { origin, direction } = raycaster.ray;
    const hit = physics.pick(origin, direction, 400, notSolid);
    if (hit) return { point: hit.point, normal: hit.normal };
    if (fallbackDistance) {
      return {
        point: { x: origin.x + direction.x * fallbackDistance, y: origin.y + direction.y * fallbackDistance, z: origin.z + direction.z * fallbackDistance },
        normal: { x: 0, y: 1, z: 0 },
      };
    }
    return null;
  }

  function activeTool() {
    return TOOLS[state.toolIndex].id;
  }

  const actions = {
    primary() {
      if (state.mode === 'build') {
        const r = builder.primary();
        if (r === 'full') ui.toast(`Piece limit reached (${CONFIG.MAX_PIECES}). Erase something first.`, 'warn');
        return;
      }
      const id = activeTool();
      const aim = aimPoint(id === 'cannon' ? 70 : 0);
      if (!aim) return;
      if (id === 'cannon') tools.fire(aim.point);
      else if (id === 'drop') tools.drop(aim.point);
      else tools.swing(aim.point);
    },

    setMode(mode) {
      if (mode === state.mode) return;
      state.mode = mode;
      builder.setActive(mode === 'build');
      gfx.pad.visible = mode === 'build';
      reticle.visible = false;
      ui.setContext(mode, activeTool(), mode === 'build' ? builder.slot : state.toolIndex);
    },
    toggleMode() {
      actions.setMode(state.mode === 'build' ? 'destroy' : 'build');
    },

    /** Number keys / toolbar buttons: pieces (0-6) + erase (7) in build mode, tools (0-2) in destroy mode. */
    selectSlot(i) {
      if (state.mode === 'build') {
        if (i < 0 || i > PIECES.length) return;
        builder.select(i);
        ui.setContext('build', activeTool(), i);
      } else {
        if (i < 0 || i >= TOOLS.length) return;
        state.toolIndex = i;
        ui.setContext('destroy', activeTool(), i);
      }
    },

    rotate(dir, fine) {
      if (state.mode === 'build') builder.rotate(dir, fine);
    },
    tilt() {
      if (state.mode === 'build') builder.cycleTilt();
    },
    toggleSnap() {
      settings.snap = !settings.snap;
      ui.sync();
      ui.toast(`Grid snap ${settings.snap ? 'on' : 'off'}`);
    },

    togglePause() {
      physics.paused = !physics.paused;
      if (!physics.paused) physics.accumulator = 0; // don't replay time spent paused
    },
    toggleSlowMo() {
      settings.timeScale = settings.timeScale < 1 ? 1 : CONFIG.SLOWMO_SCALE;
      physics.timeScale = settings.timeScale;
      ui.sync();
    },

    restore() {
      tools.clearAll();
      structures.restoreAll();
      ui.toast(structures.count ? 'Layout restored' : 'Nothing to restore yet');
    },
    clearProjectiles() {
      tools.clearAll();
    },
    clearAll() {
      tools.clearAll();
      structures.clearAll();
      ui.toast('Scene cleared');
    },
    undo() {
      if (!structures.undo()) ui.toast('Nothing to undo');
    },
    preset(id) {
      tools.clearAll();
      const n = loadPreset(id, structures);
      const name = PRESETS.find((p) => p.id === id).name;
      ui.toast(`${name}: ${n} pieces`);
    },
    resetView() {
      rig.reset();
    },
    toggleGuide() {
      ui.toggleGuide();
    },

    settingChanged(key) {
      if (key === 'gravity') physics.setGravity(settings.gravity);
      else if (key === 'timeScale') physics.timeScale = settings.timeScale;
      else if (key === 'quality') gfx.setQuality(settings.quality);
    },
  };

  ui = createUI({ settings, actions });
  const input = new Input({ canvas, pointer, keys, actions });
  ui.setContext('build', activeTool(), builder.slot);
  builder.select(builder.slot);

  // ------------------------------------------------------------- housekeeping ----
  const resizeObserver = new ResizeObserver(() => gfx.resize());
  resizeObserver.observe(gfx.container);
  gfx.resize();

  const onContextLost = (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    ui.fatal('Graphics context lost', 'The browser reclaimed the GPU. Reload the page to continue.');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  // ----------------------------------------------------------------- frame loop ----
  let raf = 0;
  let last = performance.now();
  let fps = 60;
  let statsClock = 0;
  let lowFpsFor = 0;
  let autoDowngraded = false;
  let clockSinceStart = 0;

  function updateReticle() {
    if (!pointer.inside) {
      reticle.visible = false;
      ui.setInfo('');
      return;
    }
    const id = activeTool();
    const aim = aimPoint(0);
    if (aim) {
      _n.set(aim.normal.x, aim.normal.y, aim.normal.z);
      reticle.position.set(aim.point.x, aim.point.y, aim.point.z).addScaledVector(_n, 0.03);
      reticle.quaternion.setFromUnitVectors(Z, _n);
      reticle.visible = true;
    } else {
      reticle.visible = false;
    }
    const m = settings.impactorMass;
    ui.setInfo(
      id === 'cannon'
        ? `Cannon - ${settings.launchSpeed} m/s - ${m} kg ${settings.projectileShape}`
        : id === 'drop'
          ? `Heavy drop - ${m * 2} kg from ${settings.dropHeight} m`
          : `Wrecking ball - ${m * 5} kg - ${settings.swingAngle}° swing`,
    );
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    try {
      const dt = Math.min((now - last) / 1000, CONFIG.MAX_FRAME_DT);
      last = now;
      fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

      rig.update(dt);
      physics.update(dt);
      physics.syncMeshes();
      tools.update();

      if (state.mode === 'build') {
        builder.update();
        ui.setInfo(pointer.inside ? builder.info : '');
      } else {
        updateReticle();
      }

      gfx.followTarget(rig.target);
      gfx.render();

      statsClock += dt;
      clockSinceStart += dt;
      if (statsClock >= 0.2) {
        statsClock = 0;
        ui.updateStats({
          pieces: structures.count,
          maxPieces: CONFIG.MAX_PIECES,
          shots: tools.projectileCount,
          maxShots: CONFIG.MAX_PROJECTILES,
          awake: physics.awakeCount,
          gravity: physics.gravity,
          speed: physics.timeScale,
          fps,
          paused: physics.paused,
        });
        // Self-protection for slow GPUs: if we stay under 28 fps, drop to Low graphics once.
        if (!autoDowngraded && settings.quality === 'high' && clockSinceStart > 6 && fps < 28 && !document.hidden) {
          lowFpsFor += 0.2;
          if (lowFpsFor > 4) {
            autoDowngraded = true;
            settings.quality = 'low';
            gfx.setQuality('low');
            ui.sync();
            ui.toast('Frame rate was low - switched to Low graphics', 'warn');
          }
        } else if (fps >= 28) {
          lowFpsFor = 0;
        }
      }
    } catch (err) {
      cancelAnimationFrame(raf);
      console.error(err);
      ui.fatal('The simulation stopped unexpectedly', String(err && err.message ? err.message : err));
    }
  }

  ui.show();
  ui.toast('Pick a piece and click to build - or load a starter structure in the panel', 'info');
  raf = requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  // --------------------------------------------------------------- teardown ------
  function dispose() {
    cancelAnimationFrame(raf);
    input.dispose();
    resizeObserver.disconnect();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    rig.dispose();
    builder.dispose();
    tools.dispose();
    structures.clearAll();
    reticle.geometry.dispose();
    reticle.material.dispose();
    disposePieceGeometries();
    physics.dispose(); // frees the WASM world
    gfx.dispose();
  }

  const app = { settings, physics, structures, tools, builder, actions, gfx, state, dispose };
  // Small debug/test handle (used by tests/e2e.mjs); harmless in production.
  window.__sim = app;
  return app;
}

const appPromise = boot();

// Free GPU + WASM memory on page hide / hot reload.
window.addEventListener('pagehide', () => appPromise.then((a) => a && a.dispose()), { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => appPromise.then((a) => a && a.dispose()));

export { MATERIALS };
