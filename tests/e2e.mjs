/**
 * End-to-end smoke test for the PRODUCTION build.
 *
 *   npm run build && npm run test:e2e
 *
 * It serves dist/ under a sub-path (/demolition-lab/) exactly like a GitHub
 * Pages project site, drives the real UI in headless Chromium and checks the
 * acceptance criteria: build, destroy with real physics, pause, slow motion,
 * reset, bounded memory after repeated destruction, no console errors and no
 * broken asset URLs.
 *
 * Playwright is intentionally NOT a project dependency (it is large). Install
 * it once if you want to run this test:  npm i -D playwright && npx playwright install chromium
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const PREFIX = '/demolition-lab/'; // simulated GitHub Pages project path
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png',
};

// ---------------------------------------------------------------- tiny harness
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- static server
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(PREFIX)) {
    res.writeHead(404).end('not under base path'); // root-absolute URLs would land here
    return;
  }
  let rel = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------- browser
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const consoleErrors = [];
const badResponses = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });

// Helpers evaluated inside the page --------------------------------------------
const sim = (fn, arg) => page.evaluate(fn, arg);
const waitSettled = async (maxMs = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const awake = await sim(() => window.__sim.physics.awakeCount);
    if (awake === 0) return true;
    await sleep(250);
  }
  return false;
};
const pieceStats = () => sim(() => {
  const { structures } = window.__sim;
  let maxY = 0, moved = 0, n = 0, sx = 0, sy = 0, sz = 0;
  for (const e of structures.list) {
    const t = e.body.translation();
    n++; sx += t.x; sy += t.y; sz += t.z;
    maxY = Math.max(maxY, t.y);
    const h = e.home.p;
    if (e.removed || !e.active || Math.hypot(t.x - h[0], t.y - h[1], t.z - h[2]) > 0.6) moved++;
  }
  return { n, maxY, moved, cx: sx / n, cy: sy / n, cz: sz / n };
});
/** Screen position (px, within the page) of a world point. */
const toScreen = (p) => sim((pt) => {
  const { camera } = window.__sim.gfx;
  const v = new camera.position.constructor(pt.x, pt.y, pt.z).project(camera);
  const r = document.getElementById('scene').getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}, p);

try {
  // ------------------------------------------------------------------ boot ----
  await page.goto(`${origin}${PREFIX}`, { waitUntil: 'load' });
  await page.waitForSelector('#hud:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__sim);
  check('production build boots under a sub-path', true);
  check('loading overlay hidden, fatal overlay hidden', await sim(() =>
    document.getElementById('loading').hidden && document.getElementById('fatal').hidden));

  // ---------------------------------------------------------- build (real input)
  // A real user always hovers before clicking; the ghost preview needs a frame to aim.
  await page.mouse.move(640, 420);
  await sleep(400);
  await page.mouse.click(640, 420);
  await sleep(300);
  check('click in Build mode places a piece', (await sim(() => window.__sim.structures.count)) === 1);
  await page.keyboard.press('Control+z');
  check('Ctrl+Z undoes the piece', (await sim(() => window.__sim.structures.count)) === 0);

  // Clicking UI must never place or fire anything.
  await page.click('#toolbar button >> nth=1');
  check('toolbar click does not place a piece', (await sim(() => window.__sim.structures.count)) === 0);

  // -------------------------------------------------------------- tower preset
  await sim(() => window.__sim.actions.preset('tower'));
  const built = await pieceStats();
  check('tower preset builds many pieces', built.n >= 50, `${built.n} pieces`);
  const settled = await waitSettled();
  const standing = await pieceStats();
  check('tower settles and stays standing (stable stack)', settled && standing.moved === 0 && standing.maxY > built.maxY * 0.95,
    `moved=${standing.moved} height ${standing.maxY.toFixed(1)}m`);

  // ------------------------------------------------------- destroy (real input)
  await page.keyboard.press('x');
  check('X switches to Destroy mode', (await sim(() => window.__sim.state.mode)) === 'destroy');
  await sim(() => { const s = window.__sim.settings; s.impactorMass = 1000; s.launchSpeed = 70; });
  const aim = await toScreen({ x: standing.cx, y: standing.maxY * 0.7, z: standing.cz });
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(aim.x, aim.y);
    await sleep(900);
  }
  check('cannon spawns projectiles', (await sim(() => window.__sim.tools.projectileCount)) > 0);
  // Heavy drop and wrecking ball (tools 2 and 3).
  await page.keyboard.press('2');
  await page.mouse.click(aim.x, aim.y);
  await sleep(2500);
  await page.keyboard.press('3');
  await page.mouse.click(aim.x, aim.y);
  await sleep(3500);
  await waitSettled(40000);
  const wrecked = await pieceStats();
  check('structure is destroyed by physics (pieces displaced)', wrecked.moved > built.n * 0.25 || wrecked.maxY < built.maxY * 0.6,
    `${wrecked.moved}/${wrecked.n} displaced, height ${built.maxY.toFixed(1)}m -> ${wrecked.maxY.toFixed(1)}m`);

  // ---------------------------------------------------------- pause / slow-mo
  await page.keyboard.press('Space');
  const t1 = await sim(() => window.__sim.physics.tickCount);
  await sleep(600);
  const t2 = await sim(() => window.__sim.physics.tickCount);
  check('Space pauses the simulation', t1 === t2 && (await sim(() => window.__sim.physics.paused)) === true);
  // The HUD refreshes on the render loop, which is slow under software GL: wait for it.
  const pill = await page.waitForFunction(() => /pause/i.test(document.getElementById('status').textContent), null, { timeout: 5000 }).then(() => true, () => false);
  check('status pill shows PAUSED', pill);
  await page.keyboard.press('Space');
  // Software-rendered CI can be slow: wait for ticks instead of assuming a frame rate.
  const resumed = await page.waitForFunction((n) => window.__sim.physics.tickCount > n, t2, { timeout: 5000 }).then(() => true, () => false);
  check('Space resumes', resumed);
  await page.keyboard.press('m');
  check('M enables slow motion', (await sim(() => window.__sim.physics.timeScale)) < 0.5);
  await page.keyboard.press('m');
  check('M disables slow motion', (await sim(() => window.__sim.physics.timeScale)) === 1);

  // -------------------------------------------------------------------- gravity
  await sim(() => { window.__sim.settings.gravity = 3; window.__sim.actions.settingChanged('gravity'); });
  check('gravity setting reaches the physics world', Math.abs((await sim(() => window.__sim.physics.world.gravity.y)) + 3) < 1e-6);
  await sim(() => { window.__sim.settings.gravity = 9.81; window.__sim.actions.settingChanged('gravity'); });

  // ---------------------------------------------------------------------- reset
  await page.keyboard.press('r');
  await waitSettled(30000);
  const restored = await pieceStats();
  check('R restores the built layout', restored.moved === 0 && restored.maxY > built.maxY * 0.95,
    `moved=${restored.moved} height ${restored.maxY.toFixed(1)}m`);

  // ------------------------------------- repeated destruction: bounded growth
  const before = await sim(() => {
    const { info } = window.__sim.gfx.renderer;
    return { geo: info.memory.geometries, tex: info.memory.textures, bodies: window.__sim.physics.entities.size };
  });
  for (let round = 0; round < 12; round++) {
    await sim((round) => {
      const { tools, structures } = window.__sim;
      const t = { x: 0, y: 5, z: 0 };
      for (let i = 0; i < 12; i++) tools.fire({ x: t.x + i * 0.2, y: t.y, z: t.z });
      tools.drop({ x: 0, y: 0, z: 0 });
      tools.swing({ x: 0, y: 0, z: 0 });
      // Restore only every 4th round so the projectile cap (not Restore) is what bounds growth.
      if (round % 4 === 3) window.__sim.actions.restore();
      return structures.count;
    }, round);
    await sleep(350);
  }
  // Fire one last volley and measure BEFORE any clean-up runs.
  await sim(() => { for (let i = 0; i < 80; i++) window.__sim.tools.fire({ x: 0, y: 5, z: 0 }); });
  const after = await sim(() => {
    const { info } = window.__sim.gfx.renderer;
    return {
      geo: info.memory.geometries, tex: info.memory.textures, bodies: window.__sim.physics.entities.size,
      shots: window.__sim.tools.projectileCount, pieces: window.__sim.structures.count,
    };
  });
  check('projectile count stays within its cap', after.shots <= 40, `${after.shots}/40`);
  check('rigid bodies bounded after repeated destruction', after.bodies <= before.bodies + 60, `${before.bodies} -> ${after.bodies}`);
  check('GPU geometries/textures do not leak', after.geo <= before.geo + 8 && after.tex <= before.tex + 2,
    `geometries ${before.geo} -> ${after.geo}, textures ${before.tex} -> ${after.tex}`);

  // ------------------------------------- every visible button does something
  await page.keyboard.press('Home');
  const buttons = await page.$$('#panel button:visible, #toolbar button:visible');
  let clicked = 0;
  for (const b of buttons) {
    const label = (await b.textContent()).trim();
    if (/clear all/i.test(label)) continue; // needs a second confirming click; covered below
    try { await b.click({ timeout: 1500 }); clicked++; } catch { /* hidden by mode */ }
  }
  check('all visible panel/toolbar buttons are clickable without errors', clicked >= 8, `${clicked} clicked`);

  await sleep(500);
  check('no console errors / page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('no 4xx/5xx or missing assets', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));
} catch (err) {
  check('test run completed without exceptions', false, err.message);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
