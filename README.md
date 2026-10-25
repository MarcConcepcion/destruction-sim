# Demolition Lab

![Alt Text](https://i.redd.it/aqiy5823tvaf1.gif)


A browser-based 3D physics destruction sandbox. Build towers, walls and pyramids from bricks, planks, beams, columns and slabs, then bring them down with a cannon, a heavy drop or a swinging wrecking ball. Everything that falls, tumbles or breaks is real rigid-body physics ([Rapier](https://rapier.rs)) rendered with [Three.js](https://threejs.org) - no scripted collapses.

Runs entirely in the browser: no backend, no account, no paid services.

## How to play

1. **Build mode** (`B`): pick a piece (`1`-`7`) or the eraser (`8`), a material in Settings, and click to place. Pieces snap to a grid and stack on each other; `Q`/`E` rotate, `F` tilts onto the side. Or load a starter structure (wall, tower, pyramid) from the Settings panel.
2. **Destroy mode** (`X`): choose Cannon (`1`), Heavy drop (`2`) or Wrecking ball (`3`) and click where you want to hit.
3. Tune projectile speed, impactor mass, drop height, swing angle, piece density, **gravity** and **simulation speed** in Settings. `M` toggles slow motion, `Space` pauses.
4. `R` restores your built layout (and removes projectiles); `C` clears projectiles only; Clear all in Settings removes everything.

### Controls

| Input | Action |
| --- | --- |
| Click | Place a piece / fire the active tool |
| Drag / right-drag / wheel | Orbit / pan / zoom |
| `W` `A` `S` `D` (+`Shift`) | Move the camera (faster with Shift) |
| `B` / `X` / `Tab` | Build mode / Destroy mode / toggle |
| `1`-`8` | Select piece (8 = erase) or tool |
| `Q` `E` / `F` / `G` | Rotate / tilt / grid snap |
| `Space` / `M` | Pause / slow motion |
| `R` / `C` | Restore layout / clear projectiles |
| `Ctrl+Z` | Undo last piece |
| `Home` / `H` | Reset camera / toggle the on-screen guide |

Pointer input is bound to the 3D canvas only and shortcuts ignore text fields, so using the panel never fires a tool.

## Physics and performance notes

- **Fixed step**: physics always advances in 1/60 s ticks from an accumulator; the frame delta is clamped (0.1 s) and at most 4 ticks run per frame, so a slow frame cannot cause a spiral of death. Rendering interpolates between ticks. Slow motion and the speed slider scale the accumulator, not the step size, so stability does not change with speed.
- **Stability**: 8 solver iterations, per-material friction/restitution, light damping, and sleeping bodies so a settled tower costs almost nothing.
- **Tunnelling**: cannon balls, dropped weights and the wrecking ball use continuous collision detection.
- **Budgets** (in `src/config.js`): 600 pieces, 40 projectiles (oldest are removed first), and bodies that fall out of the world are removed or disabled. Geometries and materials are shared; removed meshes and WASM bodies are freed.
- **Low-end GPUs**: a Quality setting (shadows/pixel ratio). If the frame rate stays under 28 fps the game switches to Low once and tells you.
- **Trade-off**: pieces are rigid and do not fracture. "Destruction" is structures collapsing and scattering from impacts, which keeps the simulation stable and fast in a browser. Rapier's compat build embeds its WASM as base64, so the physics chunk is large but cached separately from game code.

npm run build && npm run test:e2e
```

The e2e test serves `dist/` under a `/demolition-lab/` sub-path (like GitHub Pages), drives the real UI in headless Chromium with software WebGL, and checks building, destruction, pause, slow motion, restore, bounded object counts after repeated destruction, and the absence of console errors and 404s.
