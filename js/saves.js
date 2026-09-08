/**
 * SAVE FILES — five solo, five multiplayer, and none of them can touch each
 * other.
 *
 * The game used to have exactly one save for the whole Croaklands, kept
 * inside the economy blob. That was fine while there was one adventure, and
 * it is not fine now: a player who wants to start again should not have to
 * destroy the run they are eighteen guardians into, and two people playing
 * on the same machine should not be playing the same file.
 *
 * ── the shape on disk ────────────────────────────────────────────────────
 * One localStorage key, holding:
 *
 *   { v: 1, solo: [ slot|null ×5 ], mp: [ slot|null ×5 ] }
 *
 * and a slot is:
 *
 *   { blob, meta: { created, updated, seconds, name, region, slain,
 *                   power, hearts, prologue, memories } }
 *
 * `blob` is whatever `Progress` gave us, untouched and unread by this file —
 * exactly the arrangement the economy had with it, and for the same reason:
 * Progress owns its own shape and its own validation, and a save system that
 * knows what an equipped legging is will break the day one is renamed.
 *
 * `meta` is the part this file DOES own, because it is the part the save
 * screen has to draw without loading a two-hundred-kilobyte blob per row.
 * It is written from the blob on every commit, and it is derived data — if it
 * ever disagrees with the blob, the blob is right.
 *
 * ── why solo and multiplayer are separate arrays ─────────────────────────
 * Not a flag on one array of ten. A multiplayer file is a file you can only
 * meaningfully continue with other people, and offering it in the solo list
 * is offering to strand somebody's co-op run. Two arrays means the wrong
 * thing cannot be picked, rather than being merely discouraged.
 */

const KEY = 'frogshin.saves.v1';

/** Five each. The number is fixed by the save screen's layout. */
export const SLOTS = 5;
export const KINDS = ['solo', 'mp'];

/** An empty store, for a first run or an unreadable one. */
function blank() {
  return { v: 1, solo: new Array(SLOTS).fill(null), mp: new Array(SLOTS).fill(null) };
}

/** Seconds as the save screen wants to read it. */
export function playtime(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** A date as a short, unambiguous, locale-free string. */
export function stamp(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class SaveSlots {
  /**
   * @param economy the Economy, so selecting a slot can hand its blob over
   *                and every realm write can be caught on the way past
   */
  constructor(economy) {
    this.economy = economy || null;
    this.data = blank();
    /** { kind, index } of the file being played, or null in the menus. */
    this.active = null;
    this._load();
    /**
     * Every write the realm makes lands in the ACTIVE slot.
     *
     * The overworld saves through `Economy.setRealm` in a dozen places — a
     * guardian down, a quest turned in, walking four hundred units — and not
     * one of them should have to know which file is open. Catching it here
     * means the slot system cannot be bypassed by a call site that has not
     * heard of it.
     */
    if (this.economy) {
      this.economy.onRealmWrite = (blob) => this.commit(blob);
    }
  }

  // ------------------------------------------------------------ persistence

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { this._migrate(); return; }
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) { this._migrate(); return; }
      for (const k of KINDS) {
        const arr = Array.isArray(d[k]) ? d[k] : [];
        this.data[k] = new Array(SLOTS).fill(null).map((_, i) => {
          const s = arr[i];
          if (!s || typeof s !== 'object' || !s.blob) return null;
          return { blob: s.blob, meta: Object.assign({}, s.meta) };
        });
      }
    } catch (e) {
      // Corrupt or blocked storage must never stop the game starting. The
      // player gets an empty save screen, which is recoverable; a thrown
      // exception here would be a black page, which is not.
      console.warn('[frogshin] could not read save files:', e);
      this.data = blank();
    }
  }

  /**
   * THE ONE SAVE THAT EXISTED BEFORE THIS FILE.
   *
   * Anybody who has already played is holding a realm blob inside the economy
   * key. It goes into solo slot one, keeping their guardians, their gear and
   * their froglets, and it is NOT deleted from where it was — if this code
   * has a bug, the old save is still sitting there untouched.
   */
  _migrate() {
    this.data = blank();
    const old = this.economy && this.economy.realm;
    if (!old || typeof old !== 'object') return;
    this.data.solo[0] = { blob: old, meta: this._metaFor(old, {
      created: Date.now(), seconds: 0,
    }) };
    this.data.solo[0].meta.note = 'carried over';
    this._write();
  }

  _write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('[frogshin] could not write save files:', e);
    }
  }

  // ------------------------------------------------------------------ reads

  /** The five slots of one kind, as rows the save screen can draw. */
  list(kind) {
    const arr = this.data[kind] || [];
    const out = [];
    for (let i = 0; i < SLOTS; i++) {
      const s = arr[i];
      out.push({
        kind, index: i,
        empty: !s,
        meta: s ? s.meta : null,
      });
    }
    return out;
  }

  slot(kind, index) {
    const arr = this.data[kind];
    if (!arr || index < 0 || index >= SLOTS) return null;
    return arr[index];
  }

  /** Has this file already been shown the opening? */
  sawPrologue(kind, index) {
    const s = this.slot(kind, index);
    return !!(s && s.meta && s.meta.prologue);
  }

  // ----------------------------------------------------------------- writes

  /**
   * Start a brand new adventure in this slot.
   *
   * The slot is filled in immediately, with no blob, so the row stops saying
   * EMPTY the moment the player commits to it. `prologue: false` is the flag
   * that makes the opening cinematic play — see `Game._enterCroaklands`.
   */
  create(kind, index) {
    if (!this.data[kind] || index < 0 || index >= SLOTS) return null;
    this.data[kind][index] = {
      blob: null,
      meta: {
        created: Date.now(), updated: Date.now(), seconds: 0,
        name: '', region: '', slain: 0, power: 0, hearts: 3,
        prologue: false, memories: 0,
      },
    };
    this._write();
    return this.select(kind, index);
  }

  /**
   * Make a slot the live file.
   *
   * Its blob is pushed into the economy WITHOUT going back through
   * `setRealm`, because that would immediately commit it again and stamp a
   * fresh `updated` time on a file the player has only looked at.
   */
  select(kind, index) {
    const s = this.slot(kind, index);
    if (!s) return null;
    this.active = { kind, index };
    if (this.economy) this.economy.realm = s.blob;
    return this.active;
  }

  /** Put the menus back to having no file open. */
  deselect() {
    this.active = null;
    if (this.economy) this.economy.realm = null;
  }

  /**
   * Write the active slot.
   *
   * Called for every realm save, through the hook installed in the
   * constructor. If nothing is selected — which is what happens in the arena,
   * the dungeon and the judgment — this does nothing at all rather than
   * inventing a file to write to.
   */
  commit(blob) {
    if (!this.active) return false;
    const { kind, index } = this.active;
    const arr = this.data[kind];
    if (!arr) return false;
    const prev = arr[index];
    const meta = this._metaFor(blob, prev ? prev.meta : null);
    arr[index] = { blob, meta };
    this._write();
    return true;
  }

  /** Add played time to the open file. Called about once a second. */
  tick(seconds) {
    if (!this.active || !seconds) return;
    const s = this.slot(this.active.kind, this.active.index);
    if (!s || !s.meta) return;
    s.meta.seconds = (s.meta.seconds || 0) + seconds;
    // Not written every second: the blob is the expensive part and it has
    // not changed. The next real save carries the time with it, and so does
    // `flush` on the way out.
    this._dirty = true;
  }

  /** Force the played time to disk. Called when a mode is left. */
  flush() {
    if (this._dirty) { this._dirty = false; this._write(); }
  }

  /** Remember that this file has seen the opening. */
  markPrologueSeen() {
    if (!this.active) return;
    const s = this.slot(this.active.kind, this.active.index);
    if (!s || !s.meta) return;
    s.meta.prologue = true;
    this._write();
  }

  /**
   * DELETE A FILE, PERMANENTLY.
   *
   * One slot, by index, and nothing else is touched — which is the whole
   * requirement. The other nine entries are not read, not rewritten and not
   * re-indexed, so there is no path by which erasing slot four can disturb
   * slot one.
   */
  erase(kind, index) {
    const arr = this.data[kind];
    if (!arr || index < 0 || index >= SLOTS) return false;
    if (!arr[index]) return false;
    arr[index] = null;
    if (this.active && this.active.kind === kind && this.active.index === index) {
      this.deselect();
    }
    this._write();
    return true;
  }

  // ------------------------------------------------------------------- meta

  /**
   * What the save screen shows about a file.
   *
   * Read defensively off the blob: this runs on data that may have been
   * written by an older build, and a missing field must produce a dull row
   * rather than an exception on the menu screen.
   */
  _metaFor(blob, prev) {
    const p = prev || {};
    const b = blob && typeof blob === 'object' ? blob : {};
    const count = (v) => (Array.isArray(v) ? v.length
      : (v && typeof v === 'object' ? Object.keys(v).length : 0));
    return {
      created: p.created || Date.now(),
      updated: Date.now(),
      seconds: p.seconds || 0,
      note: p.note || '',
      prologue: p.prologue === undefined ? !!b.prologue : !!p.prologue,
      // Everything below is the blob's own account of itself.
      region: b.region || b.lastRegion || '',
      slain: count(b.slain),
      quests: count(b.questsDone) || count(b.quests),
      memories: count(b.memories),
      hearts: Number(b.hearts) || 3,
      level: Number(b.level) || 1,
      power: Number(b.power) || 0,
      froglets: Number(b.froglets) || 0,
    };
  }
}
