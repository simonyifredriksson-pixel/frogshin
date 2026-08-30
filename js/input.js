/**
 * Input: keyboard, mouse look via Pointer Lock, and edge-triggered actions.
 *
 * Movement keys are polled (held state) while abilities are consumed as
 * one-shot presses, so a single tap can never fire twice and a press that
 * lands between frames is never dropped.
 */

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
      // Never swallow browser shortcuts or typing in the room-code field.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const code = e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);

      // Stop Space/arrows from scrolling the page mid-fight.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    // Losing focus must clear held keys or the frog runs off on its own.
    window.addEventListener('blur', () => { this.keys.clear(); this._mouseDown = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this._mouseDown = false; }
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
      if (e.button === 2) this.pressed.add('MouseRight');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._mouseDown = false;
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
    if (!this.locked && this.canvas.requestPointerLock) this.canvas.requestPointerLock();
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
