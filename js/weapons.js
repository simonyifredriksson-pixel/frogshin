/**
 * WHAT EACH WEAPON LOOKS LIKE, AND HOW IT SWINGS.
 *
 * Twenty weapons in js/gear.js and, until this file existed, all twenty were
 * the same katana held the same way and swung at the same rate. The only
 * thing that changed when you picked up the Quarry Maul was a number in the
 * bag. That is a progression you cannot see and cannot feel, which is most of
 * a progression wasted.
 *
 * ── the look ────────────────────────────────────────────────────────────
 * `buildKatana` in js/frog.js already builds nine genuinely different
 * shapes — it was written for the cosmetic sword skins — so a weapon only
 * has to name one and bring a palette. That is what `lookOf` returns, in
 * exactly the shape a skin's `fx` has, because it goes to the same builder.
 *
 * A COSMETIC SKIN STILL SHOWS. The gear decides the SHAPE and the skin
 * decides the COLOURS, so somebody who bought the gold katana carrying a
 * Quarry Maul gets a gold maul. Both purchases stay visible, and neither
 * silently overrides the other — see `FrogModel.setWeapon`.
 *
 * ── the feel ────────────────────────────────────────────────────────────
 * A class gives swing rate, reach and damage per swing, and the three are
 * tied together on purpose:
 *
 *     hit × speed ≈ 1
 *
 * So a maul lands about half again as much per blow at two-thirds the rate,
 * and its damage per second is the same as a sabre of equal `atk`. That
 * matters more than it sounds. `atk` is the tier ladder — it is what a
 * region's loot table and every shop price are built on — so a class that
 * changed total output would quietly re-rank the whole gear table, and the
 * Ossuary Maul would be strictly worse than the Choir Sabre it is meant to
 * be an alternative to.
 *
 * What a class actually changes is the SHAPE of a fight: a spear keeps
 * things at arm's length and cannot be swung indoors quickly, a knife wants
 * you inside the guard and punishes you for staying there, a maul is a
 * series of commitments you cannot take back. That is a real choice. Being
 * 8% better is not.
 */

import { GEAR_BY_ID } from './gear.js?v=v111';

/**
 * ═══ THE CLASSES ════════════════════════════════════════════════════════
 *
 *   speed  swing rate: divides the wind-up, the swing and the cooldown
 *   hit    damage per blow, ≈ 1/speed so output is unchanged
 *   reach  multiplies `CFG.combat.reach`
 *   shape  which silhouette `buildKatana` builds
 *   tsuba  the guard
 *   long   blade length multiplier
 */
export const CLASSES = {
  knife: {
    name: 'Knife', speed: 1.34, hit: 0.75, reach: 0.80,
    shape: 'dagger', tsuba: 'none', long: 0.62,
    note: 'Fast, and you have to be close enough to regret it.',
  },
  sword: {
    name: 'Sword', speed: 1.00, hit: 1.00, reach: 1.00,
    shape: 'katana', tsuba: 'disc', long: 1.0,
    note: 'The one everything else is measured against.',
  },
  sabre: {
    name: 'Sabre', speed: 1.14, hit: 0.88, reach: 1.02,
    shape: 'curved', tsuba: 'ring', long: 1.02,
    note: 'Quicker than it looks, and it keeps its edge in the cut.',
  },
  scythe: {
    name: 'Scythe', speed: 0.90, hit: 1.11, reach: 1.20,
    shape: 'curved', tsuba: 'none', long: 1.18,
    note: 'A farm tool. It sweeps, and it sweeps wide.',
  },
  spear: {
    name: 'Polearm', speed: 0.84, hit: 1.19, reach: 1.44,
    shape: 'spear', tsuba: 'none', long: 1.5,
    note: 'Reach. You will hit things before they can hit you.',
  },
  axe: {
    name: 'Axe', speed: 0.76, hit: 1.32, reach: 1.04,
    shape: 'axe', tsuba: 'none', long: 0.9,
    note: 'Heavy at the head, so it goes where it is already going.',
  },
  maul: {
    name: 'Maul', speed: 0.66, hit: 1.52, reach: 0.98,
    shape: 'hammer', tsuba: 'none', long: 0.86,
    note: 'Slow, and nothing it lands on is the same shape afterwards.',
  },
  great: {
    name: 'Greatsword', speed: 0.82, hit: 1.22, reach: 1.24,
    shape: 'broad', tsuba: 'cross', long: 1.22,
    note: 'Two hands, both of them busy.',
  },
  divine: {
    name: 'Divine', speed: 1.06, hit: 0.95, reach: 1.16,
    shape: 'light', tsuba: 'ring', long: 1.1,
    note: 'Not steel. It does not behave like steel either.',
  },
};

/**
 * ═══ EVERY WEAPON IN THE GAME ═══════════════════════════════════════════
 *
 * `cls` is its class; the colours are its own. Written out one by one rather
 * than derived from the tier, because the point of the exercise is that the
 * Bramble Edge and the Gravebite are different objects — a table that made
 * them the same shape in two shades of grey would be the same failure this
 * file exists to fix, with more code.
 *
 * `runes` and `aura` are for the handful that are not ordinary metal.
 */
export const WEAPONS = {
  // ── tier 0 ────────────────────────────────────────────────────────────
  'reed-knife': { cls: 'knife',
    blade: 0xcfd9b4, edge: 0xe8f0d0, guard: 0x7a6a3a, grip: 0x4a5228 },
  'bronze-tanto': { cls: 'knife',
    blade: 0xc9a45a, edge: 0xe8d09a, guard: 0x8a6a2a, grip: 0x2a1c0a },
  'harrow-scythe': { cls: 'scythe',
    blade: 0xc4cbb2, edge: 0xe4ecd4, guard: 0x6a5a32, grip: 0x3f3420 },
  // ── tier 1 ────────────────────────────────────────────────────────────
  'mire-spear': { cls: 'spear',
    blade: 0x9ab0a2, edge: 0xd0e2d4, guard: 0x4a5a44, grip: 0x2a3428 },
  'bramble-edge': { cls: 'sword',
    blade: 0xa8b490, edge: 0xd8e8b8, guard: 0x5a7a34, grip: 0x24320f,
    runes: 0x8fd05a },
  // ── tier 2 ────────────────────────────────────────────────────────────
  'quarry-maul': { cls: 'maul',
    blade: 0x9a968c, edge: 0xb8b4a8, guard: 0x6a6458, grip: 0x33302a },
  'stair-glaive': { cls: 'spear',
    blade: 0xb4bcc4, edge: 0xdce6f0, guard: 0x7a8290, grip: 0x252a32 },
  'glass-sabre': { cls: 'sabre',
    blade: 0xbfe0ea, edge: 0xeafaff, guard: 0x5f8f9e, grip: 0x1a2e34 },
  // ── tier 3 ────────────────────────────────────────────────────────────
  'gravebite': { cls: 'sword',
    blade: 0x8e94a0, edge: 0xc4ccd8, guard: 0x4a4a54, grip: 0x1a1a20,
    runes: 0x7ac0a0 },
  'choir-saber': { cls: 'sabre',
    blade: 0xd8e4f4, edge: 0xffffff, guard: 0xc9a227, grip: 0x2a2a3a,
    runes: 0xbfe6ff },
  'dune-pike': { cls: 'spear',
    blade: 0xd8c49a, edge: 0xf4e6c4, guard: 0x9a7a3a, grip: 0x3a2a14 },
  'bone-maul': { cls: 'maul',
    blade: 0xe4dcc4, edge: 0xf4eeda, guard: 0x8a8270, grip: 0x2e2a20 },
  // ── tier 4 ────────────────────────────────────────────────────────────
  'spine-cleaver': { cls: 'axe',
    blade: 0xd0c8b0, edge: 0xeae2c8, guard: 0x7a7060, grip: 0x241f18 },
  'ember-brand': { cls: 'sword',
    blade: 0xe8a06a, edge: 0xffd9b0, guard: 0x8a4620, grip: 0x2a1409,
    runes: 0xff7a2a },
  'moonglass-lance': { cls: 'spear',
    blade: 0xcfe0ff, edge: 0xf4faff, guard: 0x7a8ec4, grip: 0x1a2038,
    runes: 0xbfd4ff },
  // ── tier 5 ────────────────────────────────────────────────────────────
  'hollow-kings-blade': { cls: 'great',
    blade: 0x8a8fa0, edge: 0xc0c8dc, guard: 0x3a3a48, grip: 0x14141c,
    runes: 0x9a8fd0 },
  'prism-edge': { cls: 'great',
    blade: 0xd4e8ff, edge: 0xffffff, guard: 0x9ac4e4, grip: 0x1a2634,
    runes: 0xbfe6ff, aura: 0x7ac0ff },
  'rime-pick': { cls: 'axe',
    blade: 0xbfe6ff, edge: 0xf0fbff, guard: 0x5f9ec4, grip: 0x142633,
    runes: 0x8fd8ff },
  'frogshin': { cls: 'divine',
    blade: 0xffffff, edge: 0xfff3c4, guard: 0xffd24a, grip: 0x3a2a06,
    runes: 0xffffff, aura: 0xffd76b, glow: true },
};

/**
 * The bare hands, and anything not in the table.
 *
 * A frog with no weapon equipped still has the katana it started the game
 * with — the story hands you a broken sword in the first five minutes and
 * never takes it away — so the fallback is that blade rather than nothing.
 */
const DEFAULT = {
  cls: 'sword',
  blade: 0xe6ecf4, edge: 0xffffff, guard: 0xe4e0d2, grip: 0x141419,
};

/** The class of a weapon id, always something. */
export function classOf(id) {
  const w = WEAPONS[id];
  return CLASSES[(w && w.cls) || DEFAULT.cls] || CLASSES.sword;
}

/**
 * HOW IT SWINGS, for `Combat.setWeapon`.
 *
 * @returns { id, name, speed, hit, reach, note }
 */
export function feelOf(id) {
  const c = classOf(id);
  return {
    id: id || null,
    name: c.name,
    speed: c.speed,
    hit: c.hit,
    reach: c.reach,
    note: c.note,
  };
}

/**
 * WHAT IT LOOKS LIKE, in the shape `buildKatana` wants.
 *
 * @param id    the equipped weapon's gear id
 * @param skin  the cosmetic sword skin, if a non-default one is worn — its
 *              colours win, the gear's shape still does. See the note at the
 *              top of the file.
 */
export function lookOf(id, skin) {
  const w = WEAPONS[id] || DEFAULT;
  const c = CLASSES[w.cls] || CLASSES.sword;
  const custom = skin && skin.id && skin.id !== 'sword_default';
  return {
    // Shape and size are the WEAPON's. This is the whole point of the file.
    shape: c.shape,
    tsuba: c.tsuba,
    long: c.long,
    // Colours are the skin's if one was bought, otherwise the weapon's own.
    blade: custom ? skin.blade : w.blade,
    edge: custom ? skin.edge : w.edge,
    guard: custom ? skin.guard : w.guard,
    grip: custom ? skin.grip : w.grip,
    glow: custom ? !!(skin.fx && skin.fx.glow) : !!w.glow,
    /**
     * Marks and light: whichever of the two has them. A bought skin's runes
     * are part of what was paid for, and a weapon that glows on its own
     * should not stop glowing because a plain skin is worn over it.
     */
    runes: (custom && skin.fx && skin.fx.runes) || w.runes || null,
    aura: (custom && skin.fx && skin.fx.aura) || w.aura || null,
    tassel: (custom && skin.fx && skin.fx.tassel) || null,
    /**
     * Orbiting fragments come only from a SKIN — no piece of gear has them.
     * They are the Astral Sovereign's signature, and somebody who rolled a
     * Mythic out of the Celestial Forge should keep it whether they are
     * carrying a Reed Knife or a Quarry Maul.
     */
    orbit: (custom && skin.fx && skin.fx.orbit) || null,
    orbitN: (custom && skin.fx && skin.fx.orbitN) || 6,
  };
}

/** Every weapon in the gear table has a look. For the tests. */
export function missing() {
  const out = [];
  for (const [id, g] of GEAR_BY_ID) {
    if (g.cat === 'weapon' && !WEAPONS[id]) out.push(id);
  }
  return out;
}
