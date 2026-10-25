/**
 * HUD: toolbar, settings panel, stats, status pill, toasts and error overlay.
 *
 * Plain DOM, no framework. Every control calls into the `actions` object that
 * main.js provides, and reads/writes the shared `settings` object, so a button
 * and its keyboard shortcut always go through the same code path.
 */
import { CONFIG } from './config.js';
import { PIECES } from './pieces.js';
import { MATERIALS } from './materials.js';
import { TOOLS } from './tools.js';
import { PRESETS, EGG_PRESET } from './presets.js';

// ------------------------------------------------------------------ helpers ----
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) node.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return node;
}

const svg = (inner) =>
  `<svg viewBox="0 0 32 32" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${inner}</svg>`;

const ICONS = {
  cube: svg('<rect x="9" y="9" width="14" height="14" rx="1.5"/>'),
  brick: svg('<rect x="4" y="11" width="24" height="10" rx="1.5"/><path d="M16 11v10" opacity=".5"/>'),
  plank: svg('<rect x="3" y="13" width="26" height="6" rx="1.2"/>'),
  beam: svg('<rect x="3" y="12" width="26" height="8" rx="1.2"/><path d="M3 16h26" opacity=".4"/>'),
  column: svg('<ellipse cx="16" cy="8" rx="6" ry="2.4"/><path d="M10 8v16c0 1.4 2.7 2.4 6 2.4s6-1 6-2.4V8"/>'),
  slab: svg('<path d="M4 17l12-6 12 6-12 6z"/><path d="M4 17v3l12 6 12-6v-3" opacity=".6"/>'),
  ball: svg('<circle cx="16" cy="16" r="9"/><path d="M9 13c4 2 10 2 14 0" opacity=".4"/>'),
  erase: svg('<path d="M6 21l9-11 9 8-6 6H9z"/><path d="M13 24h14"/>'),
  cannon: svg('<circle cx="10" cy="22" r="5"/><path d="M13 17l11-9 3 4-11 9z"/><circle cx="28" cy="6" r="1.2" fill="currentColor"/>'),
  drop: svg('<path d="M8 7h16l-3 6H11z"/><path d="M16 15v10M11 21l5 5 5-5"/>'),
  wrecker: svg('<path d="M6 4h16M22 4v3"/><path d="M22 7L12 20"/><circle cx="10" cy="23" r="5"/>'),
  build: svg('<path d="M5 24l10-10M12 7l3 3-8 8-3-3z"/><path d="M17 5l10 10"/>'),
  destroy: svg('<path d="M16 4l3 8 8-1-6 6 5 7-8-3-3 8-3-8-8 3 5-7-6-6 8 1z"/>'),
};

const fmt = {
  speed: (v) => `${v} m/s`,
  mass: (v) => `${v} kg`,
  height: (v) => `${v} m`,
  angle: (v) => `${v}°`,
  density: (v) => `${v} kg/m³`,
  gravity: (v) => `${v.toFixed(1)} m/s²`,
  scale: (v) => `${v.toFixed(2)}×`,
};

/** Slider definitions. `show` decides when the row is visible. */
const SLIDERS = [
  { key: 'launchSpeed', label: 'Launch speed', fmt: fmt.speed, show: 'cannon', tip: 'How fast the cannon fires. Faster = more impact energy.' },
  { key: 'dropHeight', label: 'Drop height', fmt: fmt.height, show: 'drop', tip: 'How high above the target the weight is released.' },
  { key: 'swingAngle', label: 'Swing angle', fmt: fmt.angle, show: 'wrecker', tip: 'How far the wrecking ball is pulled back before release.' },
  { key: 'impactorMass', label: 'Impactor mass', fmt: fmt.mass, show: 'destroy', tip: 'Mass of the cannonball. The heavy drop uses 2x this, the wrecking ball 5x.' },
  { key: 'pieceDensity', label: 'Piece density', fmt: fmt.density, show: 'build', tip: 'Density of newly placed pieces (heavier pieces are harder to knock over). Multiplied by the material factor.' },
  { key: 'gravity', label: 'Gravity', fmt: fmt.gravity, show: 'always', tip: 'World gravity. Earth = 9.8, Moon = 1.6, 0 = floaty chaos.' },
  { key: 'timeScale', label: 'Sim speed', fmt: fmt.scale, show: 'always', tip: 'Simulation speed: slow down to watch a collapse, speed up to wait for it.' },
];

const keyHint = (label, key) => (key ? `${label} (${key})` : label);

export function createUI({ settings, actions }) {
  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const hud = $('hud');
  const panel = $('panel');
  const toolbar = $('toolbar');
  const info = $('info');
  const toasts = $('toasts');
  const guide = $('guide');
  const status = $('status');
  const statEls = Object.fromEntries([...document.querySelectorAll('[data-stat]')].map((n) => [n.dataset.stat, n]));

  const rows = new Map(); // slider key -> {row, input, out, def}
  const sections = []; // {node, show}
  let mode = 'build';
  let toolId = TOOLS[0].id;

  /** Button that blurs itself after use so Space/Enter shortcuts keep working. */
  const button = (label, { tip, onClick, cls = 'btn', pressed } = {}) =>
    el('button', {
      type: 'button',
      class: cls,
      title: tip,
      'aria-pressed': pressed === undefined ? false : String(pressed),
      onclick: (e) => {
        onClick(e);
        e.currentTarget.blur();
      },
    }, label);

  function segmented(options, current, onPick) {
    const wrap = el('div', { class: 'seg', role: 'group' });
    const buttons = options.map((o) => {
      const b = el('button', {
        type: 'button',
        class: 'seg-btn',
        title: o.tip,
        'aria-pressed': String(o.id === current()),
        'data-id': o.id,
        onclick: (e) => {
          onPick(o.id);
          sync();
          e.currentTarget.blur();
        },
      }, o.swatch ? el('i', { class: 'swatch', style: `background:${o.swatch}` }) : null, o.label);
      return b;
    });
    wrap.append(...buttons);
    wrap._sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === current())));
    return wrap;
  }

  function section(title, show, ...kids) {
    const node = el('section', { class: 'sec' }, el('h3', {}, title), ...kids);
    sections.push({ node, show });
    return node;
  }

  function slider(def) {
    const r = CONFIG.ranges[def.key];
    const out = el('output', {}, def.fmt(settings[def.key]));
    const input = el('input', {
      type: 'range',
      min: r.min,
      max: r.max,
      step: r.step,
      value: settings[def.key],
      'aria-label': def.label,
    });
    input.addEventListener('input', () => {
      settings[def.key] = Number(input.value);
      out.textContent = def.fmt(settings[def.key]);
      actions.settingChanged(def.key);
    });
    input.addEventListener('change', () => input.blur());
    const row = el('label', { class: 'row', title: def.tip }, el('span', { class: 'row-label' }, def.label, out), input);
    rows.set(def.key, { row, input, out, def });
    return row;
  }

  // ---------------------------------------------------------------- panel -------
  const pauseBtn = button('Pause', { tip: 'Pause / resume (Space)', onClick: () => actions.togglePause() });
  const slowBtn = button('Slow-mo', { tip: 'Slow motion on / off (M)', onClick: () => actions.toggleSlowMo() });
  const shapeSeg = segmented(
    [
      { id: 'ball', label: 'Ball', tip: 'Spherical cannonball' },
      { id: 'cube', label: 'Cube', tip: 'Cubic cannon slug' },
    ],
    () => settings.projectileShape,
    (id) => { settings.projectileShape = id; },
  );
  const shapeRow = el('div', { class: 'row', 'data-for': 'cannon' }, el('span', { class: 'row-label' }, 'Projectile'), shapeSeg);
  const matSeg = segmented(
    Object.entries(MATERIALS).map(([id, m]) => ({ id, label: m.name, swatch: m.swatch, tip: `${m.name}: density x${m.density}, friction ${m.friction}` })),
    () => settings.material,
    (id) => { settings.material = id; eggClick(id); },
  );
  // ---- Easter egg: click/tap the Wood material 5 times (each within 2.5 s of the last) ----
  const EGG_KEY = 'demolition-lab.egg';
  let eggClicks = 0;
  let eggTimer = 0;
  function eggUnlocked() {
    try { return localStorage.getItem(EGG_KEY) === '1'; } catch { return false; }
  }
  function addEggButton(highlight) {
    if (presetRow.querySelector('[data-egg]')) return;
    const b = button(EGG_PRESET.name, { tip: `${EGG_PRESET.tip}. Replaces what you have built.`, onClick: () => actions.preset(EGG_PRESET.id) });
    b.dataset.egg = '1';
    presetRow.append(b);
    if (highlight) {
      b.classList.add('egg-new');
      b.scrollIntoView?.({ block: 'nearest' });
      setTimeout(() => b.classList.remove('egg-new'), 8000);
    }
  }
  function eggClick(id) {
    if (id !== 'wood' || eggUnlocked()) { eggClicks = 0; return; }
    eggClicks++;
    clearTimeout(eggTimer);
    eggTimer = setTimeout(() => { eggClicks = 0; }, 2500);
    if (eggClicks < 5) return;
    eggClicks = 0;
    try { localStorage.setItem(EGG_KEY, '1'); } catch { /* private mode: still unlocked for this visit */ }
    addEggButton(true);
    toast('Easter egg found! "KIM CANTOS" is now in Settings > Starter structures.', 'egg');
  }
  const snapBtn = button('Grid snap', { tip: 'Snap placement to a 0.2 m grid (G)', onClick: () => actions.toggleSnap(), pressed: settings.snap });
  const qualitySeg = segmented(
    [
      { id: 'high', label: 'High', tip: 'Shadows on, sharper rendering' },
      { id: 'low', label: 'Low', tip: 'Shadows off, lower resolution - for slower GPUs' },
    ],
    () => settings.quality,
    (id) => { settings.quality = id; actions.settingChanged('quality'); },
  );
  const clearBtn = button('Clear all', {
    tip: 'Delete every piece and projectile',
    cls: 'btn danger',
    onClick: (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed) {
        delete b.dataset.armed;
        b.textContent = 'Clear all';
        actions.clearAll();
      } else {
        b.dataset.armed = '1';
        b.textContent = 'Click again to confirm';
        setTimeout(() => {
          if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Clear all'; }
        }, 2500);
      }
    },
  });

  const presetRow = el('div', { class: 'btn-row wrap' },
    PRESETS.map((p) => button(p.name, { tip: `${p.tip}. Replaces what you have built.`, onClick: () => actions.preset(p.id) })),
  );
  if (eggUnlocked()) addEggButton(false); // remembered from an earlier visit

  panel.append(
    section('Simulation', 'always',
      el('div', { class: 'btn-row' }, pauseBtn, slowBtn),
      slider(SLIDERS.find((s) => s.key === 'timeScale')),
      slider(SLIDERS.find((s) => s.key === 'gravity')),
    ),
    section('Tool', 'destroy',
      shapeRow,
      slider(SLIDERS.find((s) => s.key === 'launchSpeed')),
      slider(SLIDERS.find((s) => s.key === 'dropHeight')),
      slider(SLIDERS.find((s) => s.key === 'swingAngle')),
      slider(SLIDERS.find((s) => s.key === 'impactorMass')),
    ),
    section('Material', 'build',
      matSeg,
      slider(SLIDERS.find((s) => s.key === 'pieceDensity')),
      el('div', { class: 'btn-row' }, snapBtn),
    ),
    section('Scene', 'always',
      el('div', { class: 'btn-row' },
        button('Restore', { tip: 'Put every piece back where you built it and clear projectiles (R)', onClick: () => actions.restore() }),
        button('Clear shots', { tip: 'Remove all projectiles and the crane (C)', onClick: () => actions.clearProjectiles() }),
      ),
      el('div', { class: 'btn-row' },
        button('Undo', { tip: 'Remove the last piece you placed (Ctrl+Z)', onClick: () => actions.undo() }),
        button('Reset view', { tip: 'Return the camera to its start position (Home)', onClick: () => actions.resetView() }),
      ),
      el('div', { class: 'btn-row' }, clearBtn),
    ),
      section('Starter structures', 'always', presetRow),
    section('Graphics', 'always', qualitySeg),
  );

  // -------------------------------------------------------------- toolbar -------
  function modeButton(id, label, key, tip) {
    return el('button', {
      type: 'button',
      class: 'tool mode',
      'data-mode': id,
      'data-tip': `${tip} (${key})`,
      'aria-pressed': String(mode === id),
      onclick: (e) => {
        actions.setMode(id);
        e.currentTarget.blur();
      },
    }, el('span', { class: 'ico', html: '' }), el('span', { class: 'lbl' }, label), el('kbd', {}, key));
  }

  function renderToolbar(slot) {
    toolbar.replaceChildren();
    const modes = el('div', { class: 'group modes' },
      modeButton('build', 'Build', 'B', 'Build mode: place pieces'),
      modeButton('destroy', 'Destroy', 'X', 'Destroy mode: fire tools'),
    );
    for (const b of modes.children) b.querySelector('.ico').innerHTML = ICONS[b.dataset.mode];

    const items = mode === 'build'
      ? [...PIECES.map((p) => ({ id: p.id, label: p.name, key: p.key, tip: p.tip })), { id: 'erase', label: 'Erase', key: '8', tip: 'Erase: click a piece to remove it' }]
      : TOOLS.map((t) => ({ id: t.id, label: t.name, key: t.key, tip: t.tip }));

    const tools = el('div', { class: 'group items' });
    items.forEach((it, i) => {
      const b = el('button', {
        type: 'button',
        class: 'tool',
        'data-tip': it.tip,
        'aria-pressed': String(i === slot),
        onclick: (e) => {
          actions.selectSlot(i);
          e.currentTarget.blur();
        },
      }, el('span', { class: 'ico' }), el('span', { class: 'lbl' }, it.label), el('kbd', {}, it.key));
      b.querySelector('.ico').innerHTML = ICONS[it.id];
      tools.append(b);
    });
    toolbar.append(modes, tools);
  }

  // ------------------------------------------------------------ visibility -----
  function applyContext() {
    app.dataset.mode = mode;
    for (const s of sections) {
      s.node.hidden = !(s.show === 'always' || s.show === mode);
    }
    for (const { row, def } of rows.values()) {
      let visible = true;
      if (def.show === 'build') visible = mode === 'build';
      else if (def.show === 'destroy') visible = mode === 'destroy';
      else if (def.show !== 'always') visible = mode === 'destroy' && toolId === def.show;
      row.hidden = !visible;
    }
    shapeRow.hidden = !(mode === 'destroy' && toolId === 'cannon');
  }

  function sync() {
    for (const { input, out, def } of rows.values()) {
      input.value = settings[def.key];
      out.textContent = def.fmt(settings[def.key]);
    }
    for (const seg of [shapeSeg, matSeg, qualitySeg]) seg._sync();
    snapBtn.setAttribute('aria-pressed', String(settings.snap));
  }

  // ---------------------------------------------------------------- toasts ------
  function toast(message, kind = 'info') {
    const t = el('div', { class: `toast ${kind}` }, message);
    toasts.append(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    }, 2400);
  }

  // ---------------------------------------------------------- panel / guide -----
  const panelToggle = $('panel-toggle');
  const guideToggle = $('guide-toggle');
  panelToggle.addEventListener('click', (e) => {
    const open = panel.classList.toggle('open');
    panelToggle.setAttribute('aria-expanded', String(open));
    e.currentTarget.blur();
  });
  guideToggle.addEventListener('click', (e) => {
    actions.toggleGuide();
    e.currentTarget.blur();
  });
  // Start with the guide collapsed on small screens so it doesn't cover the scene.
  const small = window.matchMedia('(max-width: 860px)').matches;
  if (small) {
    guide.classList.add('collapsed');
    guideToggle.setAttribute('aria-expanded', 'false');
  }
  $('fatal-reload').addEventListener('click', () => location.reload());

  renderToolbar(1);
  applyContext();

  return {
    show() {
      $('loading').hidden = true;
      hud.hidden = false;
    },
    /** @param {'build'|'destroy'} m */
    setContext(m, tool, slot) {
      const modeChanged = m !== mode;
      mode = m;
      toolId = tool;
      if (modeChanged || slot !== undefined) renderToolbar(slot);
      applyContext();
    },
    setSlot(slot) {
      renderToolbar(slot);
    },
    toggleGuide() {
      const collapsed = guide.classList.toggle('collapsed');
      guideToggle.setAttribute('aria-expanded', String(!collapsed));
    },
    setInfo(text) {
      if (info.textContent !== text) info.textContent = text;
      info.hidden = !text;
    },
    sync,
    toast,
    updateStats(s) {
      statEls.pieces.textContent = `${s.pieces}/${s.maxPieces}`;
      statEls.shots.textContent = `${s.shots}/${s.maxShots}`;
      statEls.awake.textContent = String(s.awake);
      statEls.gravity.textContent = s.gravity.toFixed(1);
      statEls.speed.textContent = fmt.scale(s.speed);
      statEls.fps.textContent = String(Math.round(s.fps));
      let state = s.awake > 0 ? 'running' : 'settled';
      let text = s.awake > 0 ? 'RUNNING' : 'SETTLED';
      if (s.speed < 1) { state = 'slow'; text = `SLOW-MO ${fmt.scale(s.speed)}`; }
      if (s.paused) { state = 'paused'; text = 'PAUSED'; }
      if (status.dataset.state !== state || status.textContent !== text) {
        status.dataset.state = state;
        status.textContent = text;
      }
      pauseBtn.textContent = s.paused ? 'Resume' : 'Pause';
      pauseBtn.setAttribute('aria-pressed', String(s.paused));
      slowBtn.setAttribute('aria-pressed', String(s.speed < 1));
    },
    fatal(title, detail) {
      $('loading').hidden = true;
      $('fatal-title').textContent = title;
      $('fatal-text').textContent = detail;
      $('fatal').hidden = false;
    },
  };
}
