/**
 * Input: keyboard, mouse look via Pointer Lock, and edge-triggered actions.
 *
 * Movement keys are polled (held state) while abilities are consumed as
 * one-shot presses, so a single tap can never fire twice and a press that
 * lands between frames is never dropped.
 */

/**
 * The keys of the Ctrl-based developer chord (Ctrl+L+J+M), plus Ctrl itself.
 *
 * Held keys are normally dropped the moment a modifier is down, so that
 * Ctrl+C, Ctrl+R and friends reach the browser untouched. These five are the
 * only exception: without it a Ctrl chord could never be seen at all, because
 * the keys would never make it into the held set.
 */
const CHORD_KEYS = new Set([
  'ControlLeft', 'ControlRight', 'KeyL', 'KeyJ', 'KeyM',
]);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();       // consumed once per press
    this.mouse = { dx: 0, dy: 0 };
    this.wheel = 0;
    this.locked = false;
    this.sensitivity = 1.0;
    this.invertY = false;
    this.enabled = false;
    this._mouseDown = false;
    this._mousePressed = false;
    this.onLockChange = null;

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      const modified = e.ctrlKey || e.metaKey || e.altKey;
      // Never swallow browser shortcuts — except the developer chord's own
      // keys, which have to be tracked or the chord can never be recognised.
      if (modified && !CHORD_KEYS.has(code)) return;
      // Never swallow typing in the room-code field either.
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);

      // Stop Space/arrows from scrolling the page mid-fight. F3 is in the
      // list because it opens the browser's find bar, and it is half of the
      // developer menu's chord.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
        'F3'].includes(code)) {
        e.preventDefault();
      }
      // Ctrl+L / Ctrl+J / Ctrl+M are the other chord. Ask the browser not to
      // act on them. Chrome reserves some of these (Ctrl+L focuses the
      // address bar) and will ignore this — which is why the chord is also
      // designed to work with Ctrl pressed LAST, see _updateCheatChord.
      if (modified && CHORD_KEYS.has(code)) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    // Losing focus must clear held keys or the frog runs off on its own.
    window.addEventListener('blur', () => { this.keys.clear(); this._mouseDown = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this._mouseDown = false; this._rightDown = false; }
      // Drop anything buffered while unlocked so a stale Space press from the
      // menu cannot fire the instant the mouse is captured.
      this.pressed.clear();
      this._mousePressed = false;
      this.mouse.dx = 0; this.mouse.dy = 0;
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += (e.movementY || 0) * (this.invertY ? -1 : 1);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this._mouseDown = true; this._mousePressed = true; }
      if (e.button === 2) { this._rightDown = true; this.pressed.add('MouseRight'); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseDown = false;
      if (e.button === 2) this._rightDown = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Wheel cycles the hotbar. This is the in-play equivalent of clicking a
    // slot, which the pointer lock makes impossible while you are moving.
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
  }

  requestLock() {
    if (this.locked || !this.canvas.requestPointerLock) return;
    // Chrome returns a promise here and rejects it if the request comes too
    // soon after the user exited the lock. That is expected and harmless —
    // the click-to-play overlay simply stays up until the next click — so
    // the rejection is swallowed rather than surfacing as a page error.
    const r = this.canvas.requestPointerLock();
    if (r && typeof r.catch === 'function') r.catch(() => { /* retried on next click */ });
  }
  releaseLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  // -------------------------------------------------------------- querying

  down(code) { return this.keys.has(code); }

  /** True exactly once per physical press. */
  consume(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  get attackHeld() { return this._mouseDown; }
  /** Right button held — used for the story-mode parry. */
  get rightHeld() { return !!this._rightDown; }
  consumeAttack() {
    if (this._mousePressed) { this._mousePressed = false; return true; }
    return false;
  }

  /** Normalised WASD vector: x = right, y = forward. */
  moveAxis(out) {
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1e-5) { x /= len; y /= len; }
    out.x = x; out.y = y;
    return out;
  }

  /** Read and clear accumulated mouse delta for this frame. */
  takeLook() {
    const d = { dx: this.mouse.dx * this.sensitivity, dy: this.mouse.dy * this.sensitivity };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return d;
  }

  /** Read and clear accumulated wheel steps (-1 up, +1 down per notch). */
  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Drop anything buffered — used when switching between menu and game. */
  flush() {
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.wheel = 0;
    this._mousePressed = false;
  }
}
