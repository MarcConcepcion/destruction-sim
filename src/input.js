/**
 * Keyboard + pointer input.
 *
 * Game input is kept apart from UI input:
 *  - pointer listeners live on the canvas only, so clicking/scrolling a panel
 *    never fires a tool or zooms the camera
 *  - key shortcuts are ignored while a text-entry control has focus, and
 *    focused buttons are blurred so Space can't also "click" them
 *  - a left-click only counts as an action if the pointer barely moved, so
 *    dragging to orbit never places a piece or fires the cannon
 */
const CLICK_MOVE_PX = 6;
const CLICK_MAX_MS = 700;

function isTextEntry(target) {
  if (!target || !target.tagName) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(target.type);
  return false;
}

export class Input {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {{ndc:{x:number,y:number,set:Function}, inside:boolean}} o.pointer  shared pointer state, written here
   * @param {Set<string>} o.keys   held movement keys (w a s d shift), read by the camera rig
   * @param {object} o.actions
   */
  constructor({ canvas, pointer, keys, actions }) {
    this.canvas = canvas;
    this.pointer = pointer;
    this.keys = keys;
    this.actions = actions;
    this._down = null;
    this._pointers = new Set();
    this._ac = new AbortController();
    const opt = { signal: this._ac.signal };

    canvas.addEventListener('pointermove', (e) => this._move(e), opt);
    canvas.addEventListener('pointerdown', (e) => this._pdown(e), opt);
    canvas.addEventListener('pointerup', (e) => this._pup(e), opt);
    canvas.addEventListener('pointercancel', (e) => this._pcancel(e), opt);
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') pointer.inside = false;
    }, opt);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opt);

    window.addEventListener('keydown', (e) => this._keydown(e), opt);
    window.addEventListener('keyup', (e) => this._keyup(e), opt);
    window.addEventListener('blur', () => keys.clear(), opt); // never get stuck panning
  }

  _setNdc(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointer.inside = true;
  }

  _move(e) {
    this._setNdc(e);
  }

  _pdown(e) {
    this._pointers.add(e.pointerId);
    this._setNdc(e);
    // Move keyboard focus to the game so shortcuts work and no slider/button keeps it.
    if (document.activeElement && document.activeElement !== this.canvas) document.activeElement.blur?.();
    this.canvas.focus({ preventScroll: true });
    // A second finger means pinch/pan: never treat that as a tap.
    if (this._pointers.size > 1) this._down = null;
    else this._down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
  }

  _pup(e) {
    this._pointers.delete(e.pointerId);
    const d = this._down;
    this._down = null;
    if (!d || d.id !== e.pointerId || d.button !== 0) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved <= CLICK_MOVE_PX && performance.now() - d.t <= CLICK_MAX_MS) {
      this._setNdc(e);
      this.actions.primary();
    }
  }

  _pcancel(e) {
    this._pointers.delete(e.pointerId);
    this._down = null;
  }

  _keydown(e) {
    if (isTextEntry(e.target)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // Ctrl/Cmd combos: only Undo is ours; leave reload, copy, etc. to the browser.
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z') {
        e.preventDefault();
        this.actions.undo();
      }
      return;
    }
    if (e.altKey) return;

    if (k === 'Shift') {
      this.keys.add('shift');
      return;
    }
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
      this.keys.add(k);
      return;
    }
    if (e.repeat) return;

    // A focused button would also "click" on Space/Enter; the game shortcut wins.
    if (e.target && e.target.tagName === 'BUTTON' && k === ' ') e.target.blur();

    const a = this.actions;
    switch (k) {
      case 'b': a.setMode('build'); break;
      case 'x': a.setMode('destroy'); break;
      case 'Tab': e.preventDefault(); a.toggleMode(); break;
      case ' ': e.preventDefault(); a.togglePause(); break;
      case 'm': a.toggleSlowMo(); break;
      case 'r': a.restore(); break;
      case 'c': a.clearProjectiles(); break;
      case 'q': a.rotate(-1, e.shiftKey); break;
      case 'e': a.rotate(1, e.shiftKey); break;
      case 'f': a.tilt(); break;
      case 'g': a.toggleSnap(); break;
      case 'h': a.toggleGuide(); break;
      case 'Home': a.resetView(); break;
      default:
        if (k >= '1' && k <= '8') a.selectSlot(Number(k) - 1);
    }
  }

  _keyup(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Shift') this.keys.delete('shift');
    else this.keys.delete(k);
  }

  dispose() {
    this._ac.abort();
  }
}
