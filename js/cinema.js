/**
 * THE CINEMATIC DIALOGUE SYSTEM — how characters talk in this game.
 *
 * Two channels, and the difference between them is the whole design:
 *
 *   SCRIPT   A conversation. It holds the game: one line at a time in a box
 *            at the bottom of the screen, a name, a portrait, a typewriter,
 *            and the player presses a key to move it on. Used for cutscenes,
 *            flashbacks and the beat before and after a fight.
 *
 *   BANTER   A line thrown out MID-FIGHT. It holds nothing at all. It slides
 *            in low on the screen, it times itself out, and the boss carries
 *            on swinging while it is up. This is the channel Frogath talks on
 *            during the battle, and it must never take a frame of control
 *            away from the player — a boss that pauses the fight to gloat is
 *            a boss whose gloating you learn to hate.
 *
 * ── why the portraits are drawn here ──────────────────────────────────────
 * There are no image files in this project. A portrait is therefore drawn to
 * a canvas with a dozen arcs and rectangles — a frog head, eyes, and whatever
 * that character wears on it. That is enough: at 78 pixels a side, what reads
 * is the silhouette and the colour, and a crowned green toad is not going to
 * be mistaken for a hooded grey ninja.
 *
 * ── the shape of a script ─────────────────────────────────────────────────
 *   [
 *     { who: 'FROGATH', face: 'frogath', text: 'So you finally came.' },
 *     { who: null, wait: 1.2, act: () => camera.pushIn() },
 *     { who: 'YOU', face: 'player', text: '...Frogath.' },
 *   ]
 *
 * A beat with no `text` is a PAUSE — it runs its `act` and waits `wait`
 * seconds. That is how a conversation gets camera moves and animation cues
 * interleaved with its lines without a second scripting language.
 */

const $ = (id) => document.getElementById(id);

/**
 * WHO CAN SPEAK, AND WHAT THEY LOOK LIKE.
 *
 * `skin` is the face, `cloth` whatever is round the neck, `hat` the thing on
 * top — that is the entire vocabulary and it is plenty. `tone` tints the name
 * plate, so the player learns to read who is talking before the text arrives.
 */
export const SPEAKERS = {
  player: { name: 'YOU', skin: 0x6fae4a, cloth: 0x2b2f36, hat: 'hood', tone: 0xbfe3ff },
  frogath: { name: 'FROGATH', skin: 0x4f6f3a, cloth: 0x241c22, hat: 'crown', tone: 0xff8a5c },
  frogathPure: { name: 'FROGATH', skin: 0x7fbf5a, cloth: 0xd8d4c6, hat: 'crown', tone: 0xffd76b },
  memory: { name: 'A MEMORY', skin: 0x8fa8b8, cloth: 0x55606c, hat: null, tone: 0xa8c8e8 },
  elder: { name: 'THE ELDER', skin: 0x9fae6a, cloth: 0x7a5a3a, hat: 'wrap', tone: 0xe8dcc0 },
  commander: { name: 'COMMANDER', skin: 0x5a6f4a, cloth: 0x3a4048, hat: 'helm', tone: 0xffc46b },
  soldier: { name: 'A SOLDIER', skin: 0x6fae4a, cloth: 0x4a5058, hat: 'helm', tone: 0xcfe8b8 },
  narrator: { name: '', skin: null, cloth: null, hat: null, tone: 0xd8d4c6 },
};

/** Draw one speaker's face into a canvas. Called once per speaker, cached. */
function drawFace(spec, size = 96) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  if (!g) return c;
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const S = size / 96;
  /**
   * A FILLED ELLIPSE, WITHOUT `CanvasRenderingContext2D.ellipse`.
   *
   * Which is most of this drawing — a frog is ellipses — and which is not
   * something to take on faith: `ellipse` is missing from older Safari and
   * from every headless canvas this project runs its tests through. An arc
   * inside a scaled transform gives exactly the same shape everywhere.
   */
  const oval = (cx, cy, rx, ry, from = 0, to = Math.PI * 2) => {
    if (typeof g.ellipse === 'function') {
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, from, to);
      g.fill();
      return;
    }
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    g.beginPath();
    g.arc(0, 0, rx, from, to);
    g.fill();
    g.restore();
  };
  // The plate behind them, so a portrait reads against any background.
  g.fillStyle = 'rgba(10,14,18,0.55)';
  g.fillRect(0, 0, size, size);
  if (spec.skin === null) return c;      // the narrator has no face

  // Shoulders and whatever they are wearing.
  g.fillStyle = hex(spec.cloth);
  oval(48 * S, 96 * S, 40 * S, 26 * S);

  // The head: wide and low, the way a frog's is.
  g.fillStyle = hex(spec.skin);
  oval(48 * S, 52 * S, 32 * S, 26 * S);
  // The two humps the eyes sit on.
  for (const sx of [-1, 1]) oval((48 + sx * 17) * S, 33 * S, 13 * S, 11 * S);
  // Eyes. Big, gold, and looking straight out of the screen at you.
  for (const sx of [-1, 1]) {
    g.fillStyle = '#f4e6b0';
    g.beginPath();
    g.arc((48 + sx * 17) * S, 32 * S, 8.5 * S, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#12100e';
    oval((48 + sx * 17) * S, 32 * S, 3.4 * S, 6.2 * S);
  }
  // The mouth: one wide line, turned down. Frogs do not smile.
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 3 * S;
  g.beginPath();
  g.arc(48 * S, 48 * S, 20 * S, 0.35, Math.PI - 0.35);
  g.stroke();

  // And the thing on top, which is most of what tells them apart.
  switch (spec.hat) {
    case 'crown': {
      g.fillStyle = '#c9a227';
      g.beginPath();
      g.moveTo(22 * S, 22 * S);
      for (let i = 0; i < 5; i++) {
        const x = (22 + i * 13) * S;
        g.lineTo(x + 6.5 * S, (i % 2 ? 12 : 4) * S);
        g.lineTo(x + 13 * S, 22 * S);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#7a1f2a';
      g.fillRect(22 * S, 20 * S, 52 * S, 6 * S);
      break;
    }
    case 'hood': {
      g.fillStyle = hex(spec.cloth);
      oval(48 * S, 40 * S, 38 * S, 34 * S, Math.PI, Math.PI * 2);
      g.fillRect(10 * S, 40 * S, 12 * S, 40 * S);
      g.fillRect(74 * S, 40 * S, 12 * S, 40 * S);
      // The mask across the muzzle. This is a ninja, after all.
      g.fillStyle = 'rgba(20,24,30,0.9)';
      g.fillRect(20 * S, 44 * S, 56 * S, 20 * S);
      break;
    }
    case 'helm': {
      g.fillStyle = '#565f6b';
      oval(48 * S, 26 * S, 34 * S, 20 * S, Math.PI, Math.PI * 2);
      g.fillRect(14 * S, 24 * S, 68 * S, 7 * S);
      g.fillStyle = '#353b45';
      g.fillRect(44 * S, 6 * S, 8 * S, 20 * S);
      break;
    }
    case 'wrap': {
      g.fillStyle = '#c9b878';
      g.fillRect(14 * S, 18 * S, 68 * S, 12 * S);
      oval(48 * S, 22 * S, 34 * S, 14 * S, Math.PI, Math.PI * 2);
      break;
    }
    default: break;
  }
  return c;
}

const _faces = new Map();
/**
 * The cached portrait for a speaker, or null.
 *
 * Wrapped, and it matters: a portrait is decoration on a conversation that
 * may be the last one in the game, and there is no canvas call in it worth
 * losing the conversation over. A browser that cannot draw one gets a
 * dialogue box with no picture in it, which is a box that still works.
 */
function faceFor(id) {
  if (_faces.has(id)) return _faces.get(id);
  const spec = SPEAKERS[id];
  let c = null;
  try {
    if (spec) c = drawFace(spec);
  } catch (e) {
    c = null;
  }
  _faces.set(id, c);
  return c;
}

/** Characters a second. Fast enough to read along with, slow enough to feel. */
const TYPE_RATE = 52;

export class Cinema {
  constructor() {
    this.root = $('cinema');
    this.nameEl = $('cine-name');
    this.textEl = $('cine-text');
    this.portrait = $('cine-portrait');
    this.hintEl = $('cine-hint');
    this.barTop = $('cine-bar-top');
    this.barBottom = $('cine-bar-bottom');
    this.banterRoot = $('banter');
    this.banterName = $('banter-name');
    this.banterText = $('banter-text');

    /** The running script, or null. */
    this.script = null;
    this.index = 0;
    this.shown = 0;            // characters of the current line revealed
    this.line = null;          // the line being typed, or null on a pause
    this.pause = false;        // true on a wordless beat
    this.hold = 0;             // seconds left on a wordless beat
    this.onEnd = null;
    this.lineDone = false;

    /** The banter queue. Lines waiting their turn during a fight. */
    this._banter = [];
    this._banterT = 0;
    this._said = new Set();    // ids of one-time lines already spoken
  }

  /** True while a conversation is holding the game. */
  get busy() { return !!this.script; }

  /**
   * Start a conversation.
   *
   * @param script  array of beats — see the note at the top of the file
   * @param opts    { onEnd, bars } — `bars` puts letterboxing in, which is
   *                what separates a cutscene from an NPC saying hello
   */
  play(script, opts = {}) {
    if (!this.root || !script || !script.length) {
      if (opts.onEnd) opts.onEnd();
      return;
    }
    this.script = script.filter(Boolean);
    this.index = -1;
    this.onEnd = opts.onEnd || null;
    this.bars = opts.bars !== false;
    this.root.classList.add('show');
    if (this.barTop) this.barTop.classList.toggle('show', !!this.bars);
    if (this.barBottom) this.barBottom.classList.toggle('show', !!this.bars);
    this._next();
  }

  /** Stop dead, without running the ending hook. Used when a mode is left. */
  cancel() {
    this.script = null;
    this.onEnd = null;
    if (this.root) this.root.classList.remove('show');
    if (this.barTop) this.barTop.classList.remove('show');
    if (this.barBottom) this.barBottom.classList.remove('show');
    this.clearBanter();
  }

  _finish() {
    const end = this.onEnd;
    this.script = null;
    this.onEnd = null;
    if (this.root) this.root.classList.remove('show');
    if (this.barTop) this.barTop.classList.remove('show');
    if (this.barBottom) this.barBottom.classList.remove('show');
    if (end) end();
  }

  _next() {
    this.index++;
    if (!this.script || this.index >= this.script.length) { this._finish(); return; }
    const beat = this.script[this.index];
    // A beat's `act` runs the moment it comes up: that is how a camera move
    // lands on the line rather than a beat behind it.
    if (beat.act) { try { beat.act(); } catch (e) { /* a cue is never fatal */ } }
    if (!beat.text) {
      /**
       * A WORDLESS BEAT: hold the screen for a moment, then move on.
       *
       * `pause` rather than a positive `hold`, because a beat is allowed to
       * ask for zero seconds — a pure camera cue with no dwell on it — and
       * a zero hold tested with `hold > 0` would sit there forever waiting
       * for a timer that had already expired.
       */
      this.pause = true;
      this.line = null;
      this.hold = beat.wait === undefined ? 0.9 : Math.max(0, beat.wait);
      if (this.textEl) this.textEl.textContent = '';
      if (this.nameEl) this.nameEl.textContent = '';
      if (this.portrait) this.portrait.classList.remove('show');
      if (this.hintEl) this.hintEl.classList.remove('show');
      this.lineDone = false;
      return;
    }
    this.pause = false;
    this.hold = 0;
    this.shown = 0;
    this.lineDone = false;
    this.line = beat.text;
    const spec = SPEAKERS[beat.face] || null;
    const who = beat.who || (spec ? spec.name : '');
    if (this.nameEl) {
      this.nameEl.textContent = who;
      this.nameEl.style.color = spec
        ? '#' + spec.tone.toString(16).padStart(6, '0') : '#d8d4c6';
    }
    if (this.portrait) {
      const face = beat.face ? faceFor(beat.face) : null;
      this.portrait.innerHTML = '';
      if (face) {
        this.portrait.appendChild(face);
        this.portrait.classList.add('show');
      } else this.portrait.classList.remove('show');
    }
    if (this.textEl) this.textEl.textContent = '';
    if (this.hintEl) this.hintEl.classList.remove('show');
  }

  /**
   * The player pressed the advance key.
   *
   * First press finishes the line the typewriter is still spelling out;
   * second press moves on. That is the convention everywhere, and getting it
   * the wrong way round means an impatient player skips lines unread.
   */
  advance() {
    if (!this.script) return false;
    if (this.pause) { this.pause = false; this.hold = 0; this._next(); return true; }
    if (!this.lineDone) {
      this.shown = this.line ? this.line.length : 0;
      this.lineDone = true;
      if (this.textEl) this.textEl.textContent = this.line || '';
      if (this.hintEl) this.hintEl.classList.add('show');
      return true;
    }
    this._next();
    return true;
  }

  /**
   * Read the advance key off the real Input.
   *
   * `consume` rather than `down`, which is the convention every other panel
   * in the game uses: it takes the press off the queue so one tap advances
   * one line, and — more importantly — so the same tap does not also swing
   * the katana on the frame the conversation ends.
   *
   * A plain `down` check is also wrong here for a duller reason: `input.keys`
   * is a Set, so reading `input.keys.KeyE` off it is always undefined, and a
   * conversation nothing can advance is a conversation the player is stuck
   * in forever.
   */
  keys(input) {
    if (!this.script || !input) return false;
    if (typeof input.consume !== 'function') return true;
    if (input.consume('KeyE') || input.consume('Enter')
      || input.consume('Space')) {
      this.advance();
    }
    return true;
  }

  // ------------------------------------------------------------- the banter

  /**
   * Say something WITHOUT stopping the fight.
   *
   * @param face  speaker id in SPEAKERS
   * @param text  the line
   * @param opts  { id, secs, priority }
   *
   * `id` makes a line one-shot for the whole fight, which is what almost
   * every reactive line wants: "you've grown stronger" is a moment, not a
   * catchphrase. A higher `priority` line displaces a lower one that is
   * currently up, so a phase change is never stuck behind a taunt.
   */
  say(face, text, opts = {}) {
    if (!this.banterRoot) return false;
    if (opts.id) {
      if (this._said.has(opts.id)) return false;
      this._said.add(opts.id);
    }
    const entry = {
      face, text,
      secs: opts.secs === undefined ? 3.0 : opts.secs,
      priority: opts.priority || 0,
    };
    // Nothing is queued deep: a fight that owes the player nine lines will
    // deliver them minutes late. Two waiting is plenty.
    if (this._banterT > 0 && entry.priority > (this._live
      ? this._live.priority : 0)) {
      this._banter.length = 0;
      this._banterT = 0;
    }
    if (this._banter.length >= 2) this._banter.shift();
    this._banter.push(entry);
    return true;
  }

  /** Drop everything queued and hide the banter line. */
  clearBanter() {
    this._banter.length = 0;
    this._banterT = 0;
    this._live = null;
    this._said.clear();
    if (this.banterRoot) this.banterRoot.classList.remove('show');
  }

  /** Forget which one-shot lines have been used, for a new fight. */
  resetSaid() { this._said.clear(); }

  update(dt) {
    // --- the conversation ---
    if (this.script) {
      if (this.pause) {
        this.hold -= dt;
        if (this.hold <= 0) this._next();
      } else if (!this.lineDone && this.line) {
        this.shown = Math.min(this.line.length, this.shown + TYPE_RATE * dt);
        const n = Math.floor(this.shown);
        if (this.textEl) this.textEl.textContent = this.line.slice(0, n);
        if (n >= this.line.length) {
          this.lineDone = true;
          if (this.hintEl) this.hintEl.classList.add('show');
        }
      }
    }

    // --- the banter, which runs whether or not anything else is ---
    if (this._banterT > 0) {
      this._banterT -= dt;
      if (this._banterT <= 0 && this.banterRoot) {
        this.banterRoot.classList.remove('show');
        this._live = null;
      }
      return;
    }
    if (!this._banter.length) return;
    const e = this._banter.shift();
    this._live = e;
    this._banterT = e.secs;
    const spec = SPEAKERS[e.face];
    if (this.banterName) {
      this.banterName.textContent = spec ? spec.name : '';
      this.banterName.style.color = spec
        ? '#' + spec.tone.toString(16).padStart(6, '0') : '#d8d4c6';
    }
    if (this.banterText) this.banterText.textContent = e.text;
    if (this.banterRoot) this.banterRoot.classList.add('show');
  }
}

/** One instance, like Audio — the screen only has one bottom edge. */
export const Cine = new Cinema();
