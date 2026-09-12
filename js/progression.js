/**
 * WHAT YOU HAVE AND WHAT YOU HAVE BECOME — the bag, the levels, the gear.
 *
 * One object owns everything the overworld remembers about a player between
 * sessions: carried items, what is equipped, the level, and which bosses,
 * quests and secrets are behind them. It serialises to a single blob that
 * `Economy` stores, so there is exactly one save and no way for half of your
 * progress to load.
 *
 * ── hearts, and why health is stored as a count ────────────────────────────
 * Max health is `hearts * HEART`, and hearts are what you are awarded. Storing
 * the count rather than the total means the HUD can draw the row of hearts
 * from the same number the award used, and a change to HEART re-tunes the
 * whole game without invalidating a save.
 *
 * ── why levels are cheap and stats are flat ────────────────────────────────
 * Levelling gives a little attack, a little defence and occasionally a heart.
 * It does not give tenfold anything. The bosses are hand-built fights with
 * telegraphs you learn; a player who out-scales them stops playing them. What
 * levelling actually buys is the margin to survive a mistake, which is the
 * thing that makes a hard region become a familiar one.
 */

import { GEAR_BY_ID, GEAR } from './gear.js?v=v118';
import { clamp } from './util.js?v=v118';

/** Health per heart. Four hearts is the starting body. */
export const HEART = 25;
export const START_HEARTS = 4;
export const MAX_HEARTS = 20;

/**
 * Kunai you leave the village with, and the only ones you are given.
 *
 * They do NOT come back. There is no regeneration, no crate in the field and
 * no unlimited supply — every blade after these twenty is one somebody found:
 * a chest, a body, a shop, a reward, the bottom of a ruin. That is the whole
 * point of the number being small enough to count. See `Overworld.giveKunai`
 * for every route more of them get into a bag, and `_syncKunai` for how the
 * throwing stack and the save stay the same number.
 */
export const START_KUNAI = 20;
/** A bag only holds so many. Found blades past this are left where they are. */
export const MAX_KUNAI = 99;

/** Base numbers before any gear or level. */
export const BASE = { atk: 20, def: 0, stamina: 100 };

/**
 * Experience needed to reach each level, cumulative.
 *
 * Written out rather than a formula so the curve can be READ: the first few
 * levels come quickly enough to feel like the game is responding, and the
 * later ones are paced against what a region's worth of bosses actually pays.
 */
export const XP_TABLE = [
  0, 60, 150, 280, 460, 700, 1010, 1400, 1880, 2460,
  3150, 3960, 4900, 5980, 7210, 8600, 10160, 11900, 13840, 16000,
];

export class Progress {
  constructor(data) {
    /** id -> count. Equipment is count 1; stacks hold their number. */
    this.bag = new Map();
    this.equipped = { weapon: null, head: null, body: null, legs: null };
    this.level = 1;
    this.xp = 0;
    this.hearts = START_HEARTS;
    /** Bosses put down, by guardian id. Cleared bosses stay cleared. */
    this.slain = new Set();
    /** Camps cleared, by "regionId:index". */
    this.camps = new Set();
    /** Sites visited — shrines, ruins, easter eggs. */
    this.found = new Set();
    /** Regions entered, for the map screen and for "you have been here". */
    this.seen = new Set();
    /** questId -> { stage, done } */
    this.quests = new Map();
    /**
     * MEMORIES RECOVERED, by flashback id.
     *
     * The player begins the game having forgotten the opening, and this is
     * the record of how much of it has come back. It is a Set of ids rather
     * than a counter because each flashback fires ONCE — a memory you keep
     * having is not a memory, it is a bug — and because the story reveal is
     * gated on WHICH ones have been seen, not how many. See js/flashbacks.js.
     */
    this.memories = new Set();
    /**
     * Whether the opening has been lived through at all.
     *
     * The save screen reads it to decide whether to play the heavenly
     * battlefield, and the flashbacks read it because a memory of something
     * you have not been shown yet is not a memory of anything.
     */
    this.prologue = false;
    /**
     * WHETHER THE CROWN IS ON.
     *
     * Set the moment the coronation begins — not when the procession that
     * follows it ends — so a player who closes the game halfway down the
     * carpet comes back a king. It is the other end of the arc `prologue`
     * opens, and every talkable frog in the country reads it: see
     * `crownGreeting` in js/quests.js, which is why a coronation is worth
     * exactly one boolean and thirty-eight changed conversations.
     */
    this.crowned = false;
    /** The region the player was last standing in, for the save screen. */
    this.region = '';
    /** Where the player was standing when they last saved. */
    this.at = null;
    /**
     * Kunai in hand. A resource, not a facility.
     *
     * Kept HERE rather than only in the hotbar because the hotbar is rebuilt
     * every time the mode is entered: a count that lived only there would
     * quietly reset to twenty on every load, which is the same thing as being
     * unlimited with extra steps.
     */
    this.kunai = START_KUNAI;
    if (data) this.load(data);
  }

  // ------------------------------------------------------------------- bag

  count(id) { return this.bag.get(id) || 0; }
  has(id, n = 1) { return this.count(id) >= n; }

  /**
   * Put something in the bag.
   *
   * Clamped to the item's stack size so a generous drop table cannot produce
   * a slot holding four hundred berries, and unknown ids are refused rather
   * than stored — a save that has been edited, or an item that was renamed
   * between versions, must not put a slot in the bag that nothing can draw.
   */
  add(id, n = 1) {
    const g = GEAR_BY_ID.get(id);
    if (!g || n <= 0) return 0;
    const before = this.count(id);
    const after = Math.min(g.stack, before + n);
    this.bag.set(id, after);
    return after - before;
  }

  remove(id, n = 1) {
    const before = this.count(id);
    if (before < n) return false;
    if (before === n) {
      this.bag.delete(id);
      // Anything equipped that is no longer carried cannot stay equipped.
      for (const slot in this.equipped) {
        if (this.equipped[slot] === id) this.equipped[slot] = null;
      }
    } else this.bag.set(id, before - n);
    return true;
  }

  /** Everything in one tab, in a stable order: tier, then stars, then name. */
  itemsIn(cat) {
    const out = [];
    for (const [id, n] of this.bag) {
      const g = GEAR_BY_ID.get(id);
      if (!g || g.cat !== cat) continue;
      out.push({ item: g, n });
    }
    out.sort((a, b) => a.item.tier - b.item.tier
      || a.item.stars - b.item.stars
      || a.item.name.localeCompare(b.item.name));
    return out;
  }

  // -------------------------------------------------------------- equipment

  /** Equip, or unequip by passing null. Returns whether anything changed. */
  equip(id) {
    if (id === null) return false;
    const g = GEAR_BY_ID.get(id);
    if (!g || !g.slot || !this.has(id)) return false;
    if (this.equipped[g.slot] === id) { this.equipped[g.slot] = null; return true; }
    this.equipped[g.slot] = id;
    return true;
  }

  isEquipped(id) {
    for (const slot in this.equipped) if (this.equipped[slot] === id) return true;
    return false;
  }

  /** Base plus every equipped piece. The single source of the player's power. */
  stats() {
    let atk = BASE.atk, def = BASE.def;
    // Levels are worth a little, and only a little. See the file comment.
    atk += (this.level - 1) * 2;
    def += (this.level - 1) * 1.5;
    const tags = new Set();
    for (const slot in this.equipped) {
      const g = GEAR_BY_ID.get(this.equipped[slot]);
      if (!g) continue;
      atk += g.atk || 0;
      def += g.def || 0;
      for (const t of g.tags || []) tags.add(t);
    }
    return {
      atk: Math.round(atk),
      def: Math.round(def),
      maxHealth: this.hearts * HEART,
      stamina: BASE.stamina,
      tags: [...tags],
    };
  }

  /**
   * POWER — one number for how ready the player is for a fight.
   *
   * Every boss in the game carries a recommended power (see `RECOMMENDED` in
   * guardians.js) and the approach warning compares this against it. It has
   * to be a single number or it cannot be compared, and it has to be honest
   * about what actually wins fights, so it is weighted the way the fights
   * are: attack matters most, then health, then armour, and the level itself
   * barely at all.
   *
   * Deliberately NOT a gate. Nothing in the game refuses to let a player
   * walk into a fight because this number is low — it only warns them, and a
   * good player can and should be able to ignore it. See the note on
   * `RECOMMENDED`.
   */
  get power() {
    const s = this.stats();
    return Math.round(
      (s.atk - BASE.atk) * 1.15         // what the weapon is worth
      + (s.def - BASE.def) * 0.75       // what the armour is worth
      + (this.hearts - 3) * 3.2         // what surviving a mistake is worth
      + (this.level - 1) * 0.9          // and the levels, faintly
      + 10);
  }

  /**
   * How much of a blow the player actually takes.
   *
   * Defence is a fraction, not a subtraction. Subtracting flat defence lets a
   * well-armoured player reach zero damage taken and the fights stop being
   * fights; a fraction with a ceiling means armour always helps and never
   * makes you invulnerable. Capped at 70%.
   */
  damageTaken(raw) {
    const def = this.stats().def;
    const soak = Math.min(0.70, def / (def + 60));
    return Math.max(1, raw * (1 - soak));
  }

  // ------------------------------------------------------------------- xp

  get xpForNext() {
    return XP_TABLE[Math.min(XP_TABLE.length - 1, this.level)] || Infinity;
  }

  /**
   * Award experience. Returns what changed, so the HUD can announce it.
   *
   * Loops rather than levelling once: a boss at the end of a long absence can
   * legitimately cross two thresholds, and a single-step version would bank
   * the remainder invisibly.
   */
  addXp(n) {
    const gained = [];
    this.xp += Math.max(0, Math.round(n));
    while (this.level < XP_TABLE.length && this.xp >= this.xpForNext) {
      this.level++;
      gained.push(this.level);
      // A heart every third level, so the body grows but not every time.
      if (this.level % 3 === 0 && this.hearts < MAX_HEARTS) this.hearts++;
    }
    return { levels: gained, level: this.level, hearts: this.hearts };
  }

  /** What a kill is worth: tier drives it, bosses are worth far more. */
  static xpFor(tier, boss) {
    return boss ? 80 + tier * 110 : 8 + tier * 7;
  }

  // ---------------------------------------------------------------- quests

  questStage(id) {
    const q = this.quests.get(id);
    return q ? q.stage : -1;
  }
  questDone(id) {
    const q = this.quests.get(id);
    return !!(q && q.done);
  }
  startQuest(id) {
    if (this.quests.has(id)) return false;
    this.quests.set(id, { stage: 0, done: false });
    return true;
  }
  advanceQuest(id, to) {
    const q = this.quests.get(id);
    if (!q || q.done) return false;
    q.stage = to === undefined ? q.stage + 1 : to;
    return true;
  }
  finishQuest(id) {
    const q = this.quests.get(id);
    if (!q || q.done) return false;
    q.done = true;
    return true;
  }

  // ----------------------------------------------------------- persistence

  toJSON() {
    return {
      bag: [...this.bag],
      equipped: this.equipped,
      level: this.level,
      xp: this.xp,
      hearts: this.hearts,
      slain: [...this.slain],
      camps: [...this.camps],
      found: [...this.found],
      seen: [...this.seen],
      quests: [...this.quests].map(([id, q]) => [id, q.stage, q.done ? 1 : 0]),
      at: this.at,
      kunai: this.kunai,
      memories: [...this.memories],
      prologue: this.prologue,
      crowned: this.crowned,
      region: this.region,
      // Written for the SAVE SCREEN's benefit, which needs a one-glance
      // summary without loading and interpreting the whole blob. Derived, so
      // if it ever disagrees with the rest of this object the rest wins.
      power: this.power,
    };
  }

  /**
   * Read a save, defensively.
   *
   * Every field is validated and every unknown item id dropped. A save is a
   * file on someone's machine: it can be old, hand-edited, or written by a
   * version that called things something else, and none of those may put the
   * game into a state it cannot draw or cannot play out of.
   */
  load(d) {
    if (!d || typeof d !== 'object') return;
    this.bag.clear();
    if (Array.isArray(d.bag)) {
      for (const entry of d.bag) {
        if (!Array.isArray(entry)) continue;
        const [id, n] = entry;
        const g = GEAR_BY_ID.get(id);
        if (!g) continue;
        const k = Math.floor(Number(n));
        if (!Number.isFinite(k) || k <= 0) continue;
        this.bag.set(id, Math.min(g.stack, k));
      }
    }
    for (const slot of ['weapon', 'head', 'body', 'legs']) {
      const id = d.equipped && d.equipped[slot];
      const g = GEAR_BY_ID.get(id);
      // Only equip what exists, fits the slot, and is actually carried.
      this.equipped[slot] = (g && g.slot === slot && this.bag.has(id)) ? id : null;
    }
    this.level = clamp(Math.floor(Number(d.level) || 1), 1, XP_TABLE.length);
    this.xp = Math.max(0, Math.floor(Number(d.xp) || 0));
    this.hearts = clamp(Math.floor(Number(d.hearts) || START_HEARTS),
      START_HEARTS, MAX_HEARTS);
    const set = (target, arr) => {
      target.clear();
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string') target.add(v);
    };
    set(this.slain, d.slain);
    set(this.camps, d.camps);
    set(this.found, d.found);
    set(this.seen, d.seen);
    set(this.memories, d.memories);
    this.prologue = !!d.prologue;
    /**
     * A save from before the coronation existed, whose owner had already
     * killed Frogath, is a save whose owner has earned the crown. Reading
     * `slain` as the fallback means those players are greeted as kings
     * rather than being told to go and do the last fight again.
     */
    this.crowned = d.crowned === undefined
      ? this.slain.has('frogath') : !!d.crowned;
    this.region = typeof d.region === 'string' ? d.region : '';
    this.quests.clear();
    if (Array.isArray(d.quests)) {
      for (const q of d.quests) {
        if (!Array.isArray(q) || typeof q[0] !== 'string') continue;
        this.quests.set(q[0], {
          stage: Math.max(0, Math.floor(Number(q[1]) || 0)),
          done: !!q[2],
        });
      }
    }
    this.at = (d.at && Number.isFinite(d.at.x) && Number.isFinite(d.at.z))
      ? { x: d.at.x, y: Number(d.at.y) || 0, z: d.at.z } : null;
    // A save from before kunai were finite has no field, and that player is
    // owed the starting twenty rather than nothing. Zero is a legal value and
    // must survive the load, so this tests for the field, not for truthiness.
    this.kunai = d.kunai === undefined || !Number.isFinite(Number(d.kunai))
      ? START_KUNAI
      : clamp(Math.floor(Number(d.kunai)), 0, MAX_KUNAI);
  }

  /** A brand new adventurer: the clothes on their back and a reed knife. */
  static fresh() {
    const p = new Progress();
    p.add('reed-knife');
    p.add('reed-hood');
    p.add('reed-wrap');
    p.add('reed-leggings');
    p.add('lilypad', 3);
    p.equip('reed-knife');
    p.equip('reed-hood');
    p.equip('reed-wrap');
    p.equip('reed-leggings');
    return p;
  }
}
