/**
 * Central tuning values. Everything that affects stability, performance or
 * gameplay balance lives here so it can be adjusted in one place.
 */
export const CONFIG = {
  // --- Simulation clock -----------------------------------------------------
  /** Real-time length of one physics tick (seconds). */
  FIXED_DT: 1 / 60,
  /** A long frame (tab switch, GC pause) is clamped to this before accumulating. */
  MAX_FRAME_DT: 0.1,
  /** Spiral-of-death guard: at most this many ticks per rendered frame. */
  MAX_TICKS_PER_FRAME: 4,
  /** More solver iterations = much steadier tall stacks (default is 4). */
  SOLVER_ITERATIONS: 8,

  // --- Budgets (keep integrated GPUs/CPUs happy) -----------------------------
  MAX_PIECES: 600,
  MAX_PROJECTILES: 40,
  /** Anything that falls below this height has left the world. */
  KILL_Y: -30,

  // --- World -----------------------------------------------------------------
  GROUND_HALF: 150, // half-size of the ground collider (m)
  BUILD_HALF: 45, // pieces may only be placed inside +/- this many metres
  GRID: 0.2, // placement snap step (m)

  // --- Slider ranges + defaults ----------------------------------------------
  ranges: {
    launchSpeed: { min: 10, max: 80, step: 1 },
    impactorMass: { min: 50, max: 1500, step: 10 },
    dropHeight: { min: 6, max: 30, step: 1 },
    swingAngle: { min: 30, max: 85, step: 1 },
    pieceDensity: { min: 100, max: 1200, step: 10 },
    gravity: { min: 0, max: 25, step: 0.1 },
    timeScale: { min: 0.05, max: 2, step: 0.05 },
  },
  defaults: {
    launchSpeed: 38,
    impactorMass: 300,
    dropHeight: 22,
    swingAngle: 65,
    pieceDensity: 350,
    gravity: 9.81,
    timeScale: 1,
    material: 'stone',
    projectileShape: 'ball',
    snap: true,
    quality: 'high',
  },
  /** Speed used by the slow-motion toggle. */
  SLOWMO_SCALE: 0.2,
};
