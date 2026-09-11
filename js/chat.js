/**
 * TEXT CHAT.
 *
 * Tap the chat key to open, type, ENTER to send, ESC to back out. Lines sit
 * in the bottom-left as `<name> message`, newest at the bottom, and fade out
 * on their own a few seconds after they arrive so the log is never in the way
 * of the game.
 *
 * ── the key is O ────────────────────────────────────────────────────────
 * One key, the same in every mode, and it opens the moment you press it.
 *
 * O is bound to nothing else in the game, which is the whole reason to use
 * it. Tab and Ctrl both had to be shared: Tab is the scoreboard in the arena
 * and your bag in the Croaklands, Ctrl is the first half of every browser
 * shortcut. Sharing either meant a tap/hold split — a key that does one
 * thing quickly and another slowly — which works but costs a delay on
 * something and has to be explained. A free key needs none of that.
 *
 * The one guard it does need: `Ctrl+O` is the browser's own open-file
 * shortcut, so a press with any modifier held is left alone.
 *
 * ── duplicates collapse ─────────────────────────────────────────────────
 * The same line sent again does not add a row; it finds the existing row and
 * puts a count beside it — `<frog> hello (4)`. Somebody spamming one message
 * can otherwise push everything else off the screen, which in a game where
 * the log is also how you find out who joined is a real loss and not just
 * untidy.
 *
 * ── the text is never trusted ───────────────────────────────────────────
 * Every message comes off the network from another player, so nothing here
 * ever touches innerHTML. Names and bodies are written with `textContent`
 * into elements built by hand. A peer that sends `<img onerror=...>` gets it
 * displayed as those characters, which is the only correct outcome.
 */

/** How long a line stays lit after arriving, with the chat shut. */
const FADE_AFTER = 9.5;
/** Lines kept in the log at all. */
const MAX_LINES = 120;
/** Rows on screen with the chat shut, and with it open. */
const SHOW_SHUT = 6;
const SHOW_OPEN = 14;
/** What a message may be. */
const MAX_LEN = 120;
/** The key that opens the chat, in every mode. */
const OPEN_KEY = 'KeyO';
/**
 * How far back a duplicate is looked for, in rows and in seconds.
 *
 * Not the whole log: a line you sent five minutes ago being silently bumped
 * to `(2)` instead of appearing where you just typed it reads as the message
 * having been dropped.
 */
const DUPE_ROWS = 8;
const DUPE_AGE = 60;

const now = () => (typeof performance !== 'undefined' && performance.now
  ? performance.now() / 1000 : Date.now() / 1000);

/** A colour that may arrive as 0x6cc24a or as '#6cc24a'. */
function css(c) {
  if (typeof c === 'number') return '#' + (c >>> 0).toString(16).padStart(6, '0');
  return c || '#dfe6c8';
}

export class Chat {
  /**
   * @param opts.input     the game's Input, suspended while typing
   * @param opts.onSend    (text) => void — put it on the wire
   * @param opts.canOpen   () => boolean — false in menus
   * @param opts.selfName  () => string
   * @param opts.selfColor () => number|string
   */
  constructor(opts = {}) {
    this.input = opts.input || null;
    this.onSend = opts.onSend || (() => {});
    this.canOpen = opts.canOpen || (() => true);
    this.selfName = opts.selfName || (() => 'Frog');
    this.selfColor = opts.selfColor || (() => 0x6cc24a);

    this.root = document.getElementById('chat');
    this.logEl = document.getElementById('chat-log');
    this.formEl = document.getElementById('chat-entry');
    this.fieldEl = document.getElementById('chat-field');

    this.open = false;
    this.lines = [];
    /** What you have sent, for arrow-key recall. */
    this.history = [];
    this._histAt = -1;
    this._fadeTimer = null;

    this._bind();
  }

  _bind() {
    if (!this.root) return;

    document.addEventListener('keydown', (e) => {
      const code = e.code;
      /**
       * O OPENS IT — and only when it is shut.
       *
       * It must NOT toggle. Once the chat is open, O is a letter like any
       * other: a key that closed the box would make it impossible to type
       * "frog", "no" or "look". Escape and Enter are what close it.
       */
      if (code === OPEN_KEY && !this.open) {
        /**
         * A modifier means this is a browser shortcut, not the chat key —
         * Ctrl+O is the open-file dialog. Left entirely alone: not opened,
         * not swallowed.
         */
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        if (!e.repeat) this.tryOpen();
        return;
      }

      if (!this.open) return;
      if (code === 'Escape') { e.preventDefault(); this.close(); return; }
      if (code === 'Enter' || code === 'NumpadEnter') {
        e.preventDefault();
        this.submit();
        return;
      }
      if (code === 'ArrowUp' || code === 'ArrowDown') {
        e.preventDefault();
        this._recall(code === 'ArrowUp' ? 1 : -1);
      }
    });

    if (this.formEl) {
      this.formEl.addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
    }
  }

  // ------------------------------------------------------------------ open

  /** Open it, unless we are somewhere it makes no sense. */
  tryOpen() {
    if (this.open || !this.root || !this.canOpen()) return false;
    this.open = true;
    this.root.classList.add('open');
    /**
     * The game stops reading the keyboard and the mouse.
     *
     * Not just the keys — the LOOK too. The pointer is still locked while you
     * type, which is deliberate (releasing it to a cursor and then trying to
     * take it back needs a fresh user gesture the browser may refuse), and
     * without this the camera would spin to wherever the mouse drifted while
     * you were writing.
     */
    if (this.input) this.input.suspend(true);
    this._histAt = -1;
    if (this.fieldEl) {
      this.fieldEl.value = '';
      this.fieldEl.focus();
    }
    this._render();
    return true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    if (this.fieldEl) { this.fieldEl.value = ''; this.fieldEl.blur(); }
    if (this.input) this.input.suspend(false);
    this._render();
    this._armFade();
  }

  /** Shut it without ceremony — leaving a match, opening a menu. */
  forceClose() { this.close(); }

  submit() {
    const raw = this.fieldEl ? this.fieldEl.value : '';
    const text = String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
    // Enter on an empty box just shuts it, the way it does everywhere else.
    if (text) {
      this.history.push(text);
      if (this.history.length > 40) this.history.shift();
      const line = this.push({
        name: this.selfName(), text, color: this.selfColor(), self: true,
      });

      /**
       * DID IT ACTUALLY GO ANYWHERE?
       *
       * `onSend` returns null when the line left the machine, or the reason
       * it did not. Both outcomes are reported, because the whole point of
       * the feature is that somebody else reads it and the sender is the
       * only person who can be told otherwise.
       *
       * The exception was swallowing failures too: a thrown error looked
       * exactly like a successful send. It is caught — a dead link must not
       * take the game down mid-sentence — but it is no longer hidden.
       */
      /**
       * Only a STRING counts as a failure. `onSend` is a callback somebody
       * else writes, and returning something incidental — the `true` out of
       * `sendEvent`, the length out of an `Array.push` — must not be read as
       * an error message. The reason is the message, or there is no reason.
       */
      let why = null;
      try {
        const r = this.onSend(text);
        why = typeof r === 'string' && r ? r : null;
      } catch (e) {
        why = 'That did not send — the connection errored.';
      }
      if (why) {
        if (line) line.undelivered = true;
        this.system(why);
      }
    }
    this.close();
  }

  /** Walk back and forth through what you have sent. */
  _recall(dir) {
    if (!this.history.length || !this.fieldEl) return;
    this._histAt = Math.max(-1, Math.min(this.history.length - 1, this._histAt + dir));
    this.fieldEl.value = this._histAt < 0
      ? '' : this.history[this.history.length - 1 - this._histAt];
    // Caret to the end, so typing continues the line rather than splitting it.
    const n = this.fieldEl.value.length;
    if (this.fieldEl.setSelectionRange) this.fieldEl.setSelectionRange(n, n);
  }

  // ------------------------------------------------------------------ lines

  /**
   * Add a line.
   *
   * @param line.name   who said it; omitted for a system line
   * @param line.text   what they said
   * @param line.color  their frog colour
   * @param line.self   ours, so it can be marked
   * @param line.system a notice from the game rather than a person
   * @returns the stored line, so the caller can mark it afterwards — which
   *          is how `submit` flags one that never left the machine.
   */
  push(line) {
    if (!line) return null;
    const text = String(line.text == null ? '' : line.text).slice(0, MAX_LEN);
    if (!text) return null;
    const name = line.system ? '' : String(line.name || 'Frog').slice(0, 14);
    const t = now();
    const key = name + ' ' + text;

    // Same thing again? Count it on the row that is already there.
    const from = Math.max(0, this.lines.length - DUPE_ROWS);
    for (let i = this.lines.length - 1; i >= from; i--) {
      const l = this.lines[i];
      if (l.key !== key || t - l.first > DUPE_AGE) continue;
      l.count++;
      l.t = t;
      // A repeat is a fresh send: whether THIS one got out is decided again.
      l.undelivered = false;
      this._render();
      this._armFade();
      return l;
    }

    const row = {
      name, text, key, count: 1, t, first: t,
      color: css(line.color),
      self: !!line.self,
      system: !!line.system,
      undelivered: false,
    };
    this.lines.push(row);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this._render();
    this._armFade();
    return row;
  }

  /** A game notice — somebody joining, a room opening. */
  system(text) { this.push({ text, system: true }); }

  clear() {
    this.lines.length = 0;
    this._render();
  }

  // ----------------------------------------------------------------- render

  _render() {
    if (!this.logEl) return;
    const keep = this.open ? SHOW_OPEN : SHOW_SHUT;
    const shown = this.lines.slice(-keep);
    const t = now();

    this.logEl.textContent = '';
    for (const l of shown) {
      const row = document.createElement('div');
      row.className = 'chat-line'
        + (l.system ? ' system' : '')
        + (l.self ? ' self' : '')
        + (l.undelivered ? ' undelivered' : '');
      // Shut, a line goes quiet on its own. Open, everything stays readable —
      // you opened it to read.
      if (!this.open && t - l.t > FADE_AFTER) row.classList.add('gone');

      if (l.name) {
        const who = document.createElement('span');
        who.className = 'chat-who';
        who.style.color = l.color;
        // textContent, always. This string came off the network.
        who.textContent = `<${l.name}>`;
        row.appendChild(who);
      }
      const body = document.createElement('span');
      body.className = 'chat-text';
      body.textContent = l.text;
      row.appendChild(body);

      // The duplicate counter, exactly where the reference puts it: after the
      // message, dim, in brackets.
      if (l.count > 1) {
        const n = document.createElement('span');
        n.className = 'chat-count';
        n.textContent = `(${l.count})`;
        row.appendChild(n);
      }
      // A line that never left the machine says so, right on itself — so you
      // can see at a glance which of your messages nobody got.
      if (l.undelivered) {
        const x = document.createElement('span');
        x.className = 'chat-fail';
        x.textContent = 'NOT SENT';
        row.appendChild(x);
      }
      this.logEl.appendChild(row);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /**
   * Re-check the fades when the oldest visible line is next due to go.
   *
   * One timer, re-armed, rather than a per-frame update: the chat has no
   * business being in the game loop, and it is only ever waiting for one
   * moment at a time.
   */
  _armFade() {
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
    if (this.open) return;
    const t = now();
    let soonest = Infinity;
    for (const l of this.lines.slice(-SHOW_SHUT)) {
      const left = FADE_AFTER - (t - l.t);
      if (left > 0 && left < soonest) soonest = left;
    }
    if (soonest === Infinity) return;
    this._fadeTimer = setTimeout(() => {
      this._fadeTimer = null;
      this._render();
      this._armFade();
    }, soonest * 1000 + 60);
  }
}
