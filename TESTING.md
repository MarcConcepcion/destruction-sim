# Testing checklist

## Automated

- [ ] `npm install` completes
- [ ] `npm test` - physics unit tests pass
- [ ] `npm run build` completes (the large-chunk note is expected: Rapier embeds its WASM)
- [ ] `npm run build && npm run test:e2e` - all browser checks pass (needs Playwright, see README)

## Manual, in a real browser (`npm run dev` or `npm run preview`)

Page and UI
- [ ] Loads with no errors in the console and no failed requests in the Network tab
- [ ] HUD shows Pieces, Shots, Moving, Gravity, Speed, FPS and a status pill
- [ ] Hovering toolbar and panel items shows tooltips; the `?` button / `H` toggles the controls guide
- [ ] Layout is usable on a narrow window (resize to phone width)
- [ ] Typing/clicking in the Settings panel never places a piece or fires a tool

Build mode
- [ ] Every piece type (`1`-`7`) can be placed, rotated (`Q`/`E`, Shift for fine) and tilted (`F`)
- [ ] Pieces stack on each other and on the ground; `G` toggles grid snap
- [ ] Eraser (`8`) removes a piece; `Ctrl+Z` undoes; the 600-piece limit shows a message
- [ ] Wall, Tower and Pyramid presets build and stand still after settling

Destroy mode
- [ ] Cannon, Heavy drop and Wrecking ball each work and visibly knock pieces over
- [ ] Launch speed, impactor mass, drop height, swing angle sliders change the result
- [ ] Changing piece density or material changes how heavy/slippery structures are
- [ ] Gravity slider (try 0 and 25) affects everything, including resting pieces
- [ ] Speed slider and `M` give slow motion; `Space` pauses and resumes; status pill follows
- [ ] `R` restores the layout, `C` clears only projectiles, Clear all asks for confirmation

Camera
- [ ] Drag orbits, right-drag pans, wheel zooms, `WASD` (+Shift) moves, `Home` resets

Robustness
- [ ] Fire 100+ shots: Shots stays at or below 40 and FPS does not keep falling
- [ ] Build and collapse several structures, then reset: Pieces/Moving counts return to expected values
- [ ] Switching tabs for a minute and returning does not cause a physics jump
- [ ] Production build served from a sub-path (e.g. `npm run preview` or GitHub Pages) loads all assets
