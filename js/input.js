/**
 * Input: keyboard, mouse look via Pointer Lock, and edge-triggered actions.
 *
 * Movement keys are polled (held state) while abilities are consumed as
 * one-shot presses, so a single tap can never fire twice and a press that
 * lands between frames is never dropped.
 */

/**
 * Keys the developer chord needs to survive the modifier filter.
 *
 * The chord itself (L+J+M+3) uses no modifier at all, so this is only here to
 * stop the chord dying if a stray Ctrl or Alt happens to be held while it is
 * being pressed. Everything else with a modifier down still goes straight to
 * the browser.
 */
const CHORD_KEYS = new Set([
  'KeyL', 'KeyJ', 'KeyM',
  // Both threes. On a keyboard with a numeric keypad the "3" a player
  // reaches for is often Numpad3, which is a completely different code —
  // and the chord silently never completes.
  'Digit3', 'Numpad3',
]);

/**
 * ═══ THE CHORD, TYPED — J then L then M then 3 ═══════════════════════════
 *
 * Tracked HERE rather than by the caller, and that matters: a key that
 * advances the chord is SWALLOWED, so it never also fires as a game action.
 *
 * It used to be recognised after the fact, by looking back over the recent
 * presses — which meant every key in it did its normal job on the way past.
 * Two of the four have one. `M` opens the map and `3` selects a hotbar slot,
 * so typing the chord in the open world opened the developer panel AND the
 * map, in that order.
 *
 * And that was a trap rather than an annoyance: with the developer panel
 * open the game is frozen, `Game._updateRealm` returns before the overworld
 * updates at all, and the map's own close key is never read. The map sat on
 * top of the panel and no key could shift it.
 *
 * `J` and `L` are bound to nothing, so swallowing them costs nothing. `M`
 * is only swallowed once J and L are already in, and `3` only once M is
 * too — so a lone M still opens the map and a lone 3 still selects a slot.
 */
const CHORD_SEQ = [['KeyJ'], ['KeyL'], ['KeyM'], ['Digit3', 'Numpad3']];
/** How long a chord may take between keys before it lapses. */
const CHORD_GAP = 1.6;

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
    this.recent = [];               // recent presses, for sequence chords
    /** How much of the typed developer chord is in. See `CHORD_SEQ`. */
    this._chordAt = 0;
    this._chordT = 0;
    /** Set when the chord completes; taken and cleared by `takeChord`. */
    this._chordReady = false;
    /**
     * SUSPENDED — the game is not reading the keyboard or the mouse.
     *
     * Set while the chat is open. Gated in ONE place (here, in the queries)
     * rather than at every call site, because there are dozens of them: the
     * player, the combat code, the tutorial, every boss, the map, the
     * inventory. Any one of them missed would be a key that still moved the
     * frog while you were typing about it.
     *
     * The look is suspended too — see `Chat.tryOpen` for why the pointer
     * stays locked while you type.
     */
    this.suspended = false;

    this._bind();
  }

  /**
   * Stop or resume reading input, and drop whatever was held.
   *
   * Clearing on the way IN matters: keys held when the chat opens would
   * otherwise stay in `keys` forever, because the keyup arrives while a text
   * field has focus and never reaches the held-state set. The frog would run
   * into the distance while you wrote.
   */
  suspend(on) {
    this.suspended = !!on;
    this.keys.clear();
    this.pressed.clear();
    this.recent.length = 0;
    this._chordAt = 0;
    this._chordReady = false;
    this._mouseDown = false;
    this._mousePressed = false;
    this._rightDown = false;
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.wheel = 0;
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      const modified = e.ctrlKey || e.metaKey || e.altKey;
      // Never swallow browser shortcuts — except the developer chord's own
      // keys, which have to be tracked or the chord can never be recognised.
      if (modified && !CHORD_KEYS.has(code)) return;

      const tag = document.activeElement && document.activeElement.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      // While a text field has focus only the chord's keys are watched, and
      // only as HELD state: nothing is consumed as a game action, nothing is
      // cancelled, and nothing reaches the sequence detector. Four keys at
      // once is not something typing produces, so the chord still works from
      // the menu — where the name box usually has focus, which is one reason
      // it could look like the chord did nothing.
      if (typing && !CHORD_KEYS.has(code)) return;

      if (!this.keys.has(code) && !typing) {
        /**
         * The typed developer chord gets first refusal on the press.
         *
         * A key that advances it is NOT added to `pressed`, so it cannot
         * also fire whatever it is normally bound to — which for `M` is the
         * map and for `3` is a hotbar slot. See `CHORD_SEQ`.
         */
        if (!this._chordKey(code)) this.pressed.add(code);
        // Recent presses, for chords entered as a SEQUENCE rather than held
        // together. See `sequenceDone`.
        this.recent.push({ code, t: this._now() });
        if (this.recent.length > 16) this.recent.shift();
      }
      this.keys.add(code);
      if (typing) return;

      // Stop Space/arrows from scrolling the page mid-fight. F3 is in the
      // list because it opens the browser's find bar, and it is half of the
      // developer menu's chord.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
        'F3'].includes(code)) {
        e.preventDefault();
      }
      // If a modifier happened to be down, do not let the browser act on the
      // chord's keys as a shortcut.
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
      // Not accumulated while suspended, rather than accumulated and thrown
      // away: `takeLook` is not called every frame by every mode, so a
      // discard-on-read would let a long drift arrive all at once.
      if (!this.locked || this.suspended) return;
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
      if (!this.locked || this.suspended) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
  }

  /** Seconds, from whatever clock this environment has. */
  _now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() / 1000 : Date.now() / 1000;
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

  down(code) { return !this.suspended && this.keys.has(code); }

  /** Any of these held? Lets one binding accept Digit3 or Numpad3. */
  downAny(codes) {
    if (this.suspended) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /**
   * Were `codes` pressed IN ORDER, all within `window` seconds?
   *
   * The alternative to a held chord, and the reason it exists: cheap
   * keyboards — school machines especially — have a two- or three-key
   * rollover limit, and simply never report a fourth key held at the same
   * time. No amount of code makes those four arrive together, so they can be
   * entered one after another instead.
   *
   * An entry may be a single code or an array of alternatives.
   */
  sequenceDone(codes, window = 1.6) {
    const n = codes.length;
    if (this.recent.length < n) return false;
    const tail = this.recent.slice(-n);
    for (let i = 0; i < n; i++) {
      const want = codes[i];
      const got = tail[i].code;
      const ok = Array.isArray(want) ? want.indexOf(got) !== -1 : got === want;
      if (!ok) return false;
    }
    return tail[n - 1].t - tail[0].t <= window;
  }

  /** Forget the press history — call after acting on a sequence. */
  clearSequence() { this.recent.length = 0; }

  /**
   * ONE KEY, AGAINST THE TYPED CHORD.
   *
   * @returns true if the press was part of the chord and has been SWALLOWED
   *
   * The rule is strictly positional. A press only counts if it is the next
   * key the chord wants and it arrived within `CHORD_GAP` of the last one;
   * anything else drops the chord back to nothing — except a fresh `J`,
   * which starts it again, because somebody who mistypes will just start
   * over rather than pausing first.
   *
   * The consequence worth stating: `M` and `3` are only ever swallowed with
   * `J` and `L` already behind them, so the map key and the hotbar keys
   * behave completely normally the rest of the time.
   */
  _chordKey(code) {
    const now = this._now();
    const want = CHORD_SEQ[this._chordAt];
    const lapsed = this._chordAt > 0 && now - this._chordT > CHORD_GAP;
    if (!lapsed && want.indexOf(code) !== -1) {
      this._chordAt++;
      this._chordT = now;
      if (this._chordAt >= CHORD_SEQ.length) {
        this._chordAt = 0;
        this._chordReady = true;
      }
      return true;
    }
    // Wrong key, or too slow. Start over — and a `J` starts over AT ONE.
    if (CHORD_SEQ[0].indexOf(code) !== -1) {
      this._chordAt = 1;
      this._chordT = now;
      return true;
    }
    this._chordAt = 0;
    return false;
  }

  /**
   * Has the typed chord completed since this was last asked? Clears it.
   *
   * Always clears, even when the caller ignores the answer, so a chord
   * finished on the same frame the HELD version fired cannot toggle the
   * panel a second time and close it again.
   */
  takeChord() {
    const r = this._chordReady && !this.suspended;
    this._chordReady = false;
    return r;
  }

  /** True exactly once per physical press. */
  consume(code) {
    if (this.suspended) return false;
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  get attackHeld() { return !this.suspended && this._mouseDown; }
  /**
   * GUARD HELD — right mouse button, OR P.
   *
   * Parrying was the one thing in the game that could not be done without a
   * mouse: everything else has a key, and the guard was right-click and
   * nothing else. On a laptop trackpad a held right-click while also running
   * and steering is somewhere between awkward and impossible, and parrying
   * is not optional content — the story bosses break your guard on purpose
   * and expect you to time one.
   *
   * P rather than a modifier because it is reachable with the right hand
   * while the left stays on WASD, and it is not taken: the keys already
   * spoken for are WASD, Space, Shift, Ctrl, E, F, Q, R, G, Tab, M, J, 1-5
   * and 0. See the controls list in index.html.
   *
   * It is read through this one getter, so every caller gets it at once —
   * `Player._updateParry`, the tutorial's parry station and the boss
   * fights all ask the same question and none of them had to change.
   */
  get rightHeld() {
    return !this.suspended && (!!this._rightDown || this.down('KeyP'));
  }
  consumeAttack() {
    if (this.suspended) return false;
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
