/**
 * Skins, rarities and the crates that drop them.
 *
 * Everything in the game is drawn from primitives with flat colours, so a
 * "skin" is a small palette rather than a texture. That keeps the whole
 * cosmetic system data-only: no new art files, no loading, and a skin costs
 * nothing at runtime beyond the material colours it already had.
 */

/**
 * ═══ RARITY TIERS AND WHAT EACH IS WORTH ════════════════════════════════
 *
 * Two mechanisms, because the top of the ladder and the bottom of it are
 * answering different questions. See `tierChances` for the arithmetic.
 *
 * ── the top three are ANCHORED ──────────────────────────────────────────
 * A Legendary is 0.80% to pull, a Mythic 0.20%, a Secret 0.03% — per item,
 * in every crate in the game. These are headline numbers a player quotes to
 * a friend, so they are stated outright rather than falling out of whatever
 * else happens to be in the pool.
 *
 * ── the four below are WEIGHTED ─────────────────────────────────────────
 * They share whatever the anchored tiers leave, in proportion. That is what
 * makes a crate whose floor is Uncommon genuinely better per roll rather
 * than a commons machine with the commons deleted, and it is what the
 * Celestial Forge's 5,000 froglets buy: no commons at all, two Legendaries
 * instead of one, and the only Mythic in the game.
 *
 * ── WHY THESE FOUR NUMBERS ──────────────────────────────────────────────
 * They are chosen so the ladder holds at the join. In a five-tier crate
 * they come out at exactly 62% / 24% / 10% / 3.2%, which puts Epic four
 * times a Legendary — and the ladder is the whole point of having tiers.
 *
 * The previous curve was 7992 / 1598 / 320 / 64, a clean division by five
 * all the way down, and it could not survive Legendary moving to 0.80%:
 * Epic landed at 0.6365%, so a Legendary would have been EASIER to pull
 * than an Epic. Raising the top of a ladder means re-spacing the rungs
 * under it, or it stops being a ladder.
 */
/**
 * ═══ ONE ODDS TABLE, FOR EVERY CASE IN THE GAME ══════════════════════════
 *
 * `odds` is the chance of the TIER, as a percentage. Every crate uses the
 * same ladder, and the items inside a tier share it equally.
 *
 * ── what this replaced, twice ─────────────────────────────────────────
 * First a pure weight system, where a tier's probability depended on which
 * OTHER tiers happened to be in the same crate — so Mythic came out five
 * times rarer in the Celestial cases than the Eclipse ones purely because
 * Celestial has no Common tier to dilute it.
 *
 * Then a hybrid: weights below, flat per-ITEM anchors on the top three. That
 * fixed the drift but made the top of the ladder very steep — a Legendary
 * was 0.80% and a crate holding one paid one out about once in a hundred
 * and twenty-five opens.
 *
 * A per-TIER table is the version a player can actually hold in their head:
 * a third of opens are Common, one in twenty is Legendary, one in a thousand
 * is ???. It reads the same on every case because it IS the same on every
 * case, and a crate that is missing a tier simply shares that tier's slice
 * out among the ones it has — see `tierChances`.
 */
export const RARITY = {
  common:    { id: 'common',    name: 'Common',    color: '#4b69ff', odds: 35 },
  uncommon:  { id: 'uncommon',  name: 'Uncommon',  color: '#8847ff', odds: 27 },
  rare:      { id: 'rare',      name: 'Rare',      color: '#d32ce6', odds: 20 },
  epic:      { id: 'epic',      name: 'Epic',      color: '#eb4b4b', odds: 10 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ffd700', odds: 5 },
  /**
   * 2.95 rather than 2.9, and the extra twentieth of a point is ???'s.
   *
   * The ladder has to come to a hundred or every crate's board is a rounding
   * error away from lying. ??? was halved to 0.05 and the point had to go
   * somewhere; Mythic is the tier directly under it and the one that should
   * absorb it.
   */
  mythic:    { id: 'mythic',    name: 'Mythic',    color: '#8ffaff', odds: 2.95 },
  /**
   * ??? — and it stays ??? until somebody pulls one.
   *
   * ONE IN TWO THOUSAND. These cases cost six to twelve thousand froglets,
   * so a ??? is a serious amount of money spent and is meant to be — the
   * point of the tier is that seeing one in the Croaklands is an event.
   *
   * It is also the only tier whose items hide their own NAME until they are
   * yours — see `secret` on a skin and `Shop.hidden`.
   */
  secret:    { id: 'secret',    name: 'Secret',    color: '#efe6ff', odds: 0.05 },
};

export const RARITY_ORDER = [
  'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret',
];

/**
 * ═══ WHAT A DUPLICATE IS WORTH ═══════════════════════════════════════════
 *
 * Pull something you already own and you are handed froglets instead. Every
 * open gives you SOMETHING, which is the difference between a case you stop
 * buying once your collection fills up and one that always has a floor.
 *
 * ── two axes ──────────────────────────────────────────────────────────
 * A frog skin is worth more than a sword, and a sword more than a kunai —
 * the same order their cases are priced in, because it is the same
 * judgement about how much of the frog you are actually looking at. The
 * ratio is taken straight from the three commons: 500 / 400 / 250.
 *
 * Mythic and Secret are FLAT across all three. At that end the tier is the
 * whole story; nobody who pulls a second Astral Sovereign cares that it is
 * a sword rather than a frog.
 *
 * ── it must never pay to farm ─────────────────────────────────────────
 * The ceiling on all of this is that a player who owns everything must not
 * profit by opening cases. Worked against every case in the game, the best
 * return is about 47% on the cheapest kunai case — a real consolation, and
 * comfortably short of a machine that prints froglets. The test suite
 * recomputes that for every case, so a generous edit here fails loudly
 * rather than quietly turning the shop into an income.
 */
const DUPE_BASE = {
  common: 500, uncommon: 1000, rare: 2000, epic: 4000, legendary: 8000,
};
const DUPE_FLAT = { mythic: 20000, secret: 50000 };
const DUPE_KIND = { frogs: 1, swords: 0.8, kunai: 0.5 };

/** Froglets handed over for a duplicate of this kind and tier. */
export function dupeValue(kind, rarity) {
  if (DUPE_FLAT[rarity] !== undefined) return DUPE_FLAT[rarity];
  const base = DUPE_BASE[rarity] || 0;
  return Math.round(base * (DUPE_KIND[kind] === undefined ? 1 : DUPE_KIND[kind]));
}

/**
 * ═══ THE ECLIPSE SET'S MATERIALS ════════════════════════════════════════
 *
 * The three ??? items are one set, and a set is a MATERIAL before it is a
 * silhouette. These seven colours are the whole palette of all three, which
 * is why they are written once here rather than typed out three times: a
 * frog, a sword and a kunai that agree to the hex digit read as forged from
 * the same thing, and three hand-picked near-blacks do not.
 *
 *   obsidian  the body and the blades. NOT black — 0x1c1b26 still takes
 *             light, so the form reads. The first pass at this set was
 *             0x07070a everywhere and rendered as a frog-shaped hole: no
 *             shading, no silhouette, nothing to look at.
 *   plate     the armour, a shade lighter and pushed toward violet so the
 *             armour separates from the body it is worn over.
 *   silver    trim. Muted, not chrome — a little of it, in thin lines.
 *   violet    cloth: the obi, the headband, the scarf.
 *   energy    the eclipse emblem, the cracks, the centre of the eye. The
 *             ONLY bright colour in the set, and it is used sparingly.
 *   cold      the cutting edge and the sclera. Very slightly blue-white.
 *   void      the one true black, and it is 0.2 units wide: the disc at the
 *             centre of the eclipse emblem.
 */
const ECL = {
  obsidian: 0x1c1b26,
  plate:    0x24223a,
  silver:   0xbcc0cf,
  violet:   0x312a52,
  energy:   0x9b86f0,
  cold:     0xe8e6ff,
  void:     0x07060c,
};

// ---------------------------------------------------------------- swords

/**
 * blade / edge highlight / guard / grip / optional emissive glow, plus `fx`.
 *
 * `fx` is what stops a skin being a recolour. Colour alone is free, which
 * would make a crate — and beating Frogath — worth nothing, so every skin
 * above common changes the WEAPON: its blade profile, its guard, whether it
 * glows, what hangs off it. The builder reads these and assembles a
 * different object, not a different palette.
 *
 *   shape  katana | broad | serrated | curved | light | fang
 *   tsuba  disc | square | cross | ring | none
 *   glow   the blade emits light instead of reflecting it
 *   runes  colour of glowing marks along the blade
 *   aura   colour of a soft shell around the blade
 *   tassel colour of a cord hanging from the pommel
 */
export const SWORD_SKINS = [
  // The standard-issue katana every frog carries: mirror-polished blade, a
  // plain pale tsuba, and a black cord-wrapped tsuka over an ivory same.
  // Deliberately not gold — this is the shape of the weapon, not a prize.
  { id: 'sword_default', name: 'Black Cord',    rarity: 'common',
    blade: 0xe6ecf4, edge: 0xffffff, guard: 0xe4e0d2, grip: 0x141419, glow: 0x39414c,
    fx: { shape: 'katana', tsuba: 'disc' } },
  // Frogath's blade of light, as a cosmetic. It looks like the thing that
  // killed you fourteen times; it does exactly what your katana always did.
  { id: 'sword_frogath', name: 'The First Croak', rarity: 'legendary', reward: true,
    blade: 0xfff3c4, edge: 0xffffff, guard: 0xffd76b, grip: 0x4a3206, glow: 0xc9922a,
    fx: {
      shape: 'light', tsuba: 'ring', glow: true, runes: 0xfff3c4,
      aura: 0xffd76b, tassel: 0xffd76b, long: 1.35,
    } },
  { id: 'sword_bamboo',  name: 'Bamboo Cut',   rarity: 'common',
    blade: 0xcfd6c2, edge: 0xe8eedd, guard: 0x7a6a3a, grip: 0x3f4a24, glow: 0x22281a,
    fx: { shape: 'katana', tsuba: 'square' } },
  { id: 'sword_river',   name: 'River Iron',   rarity: 'common',
    blade: 0xaab6c4, edge: 0xdce6f2, guard: 0x6f7c8a, grip: 0x232a33, glow: 0x1d2530,
    fx: { shape: 'curved', tsuba: 'disc' } },
  { id: 'sword_ivy',     name: 'Ivy Edge',     rarity: 'uncommon',
    blade: 0xa8d9a0, edge: 0xe4ffe0, guard: 0x4e7a34, grip: 0x1f3a1a, glow: 0x1d4a20,
    fx: { shape: 'serrated', tsuba: 'cross', tassel: 0x4e7a34 } },
  { id: 'sword_ember',   name: 'Ember Brand',  rarity: 'uncommon',
    blade: 0xe8a06a, edge: 0xffd9b0, guard: 0x8a4620, grip: 0x2a1409, glow: 0x6a2408,
    fx: { shape: 'broad', tsuba: 'square', runes: 0xff7a2a } },
  { id: 'sword_frost',   name: 'Frostbite',    rarity: 'rare',
    blade: 0xbfe6ff, edge: 0xf0fbff, guard: 0x5f9ec4, grip: 0x142633, glow: 0x2a6a9a,
    fx: { shape: 'fang', tsuba: 'cross', runes: 0x8fd8ff, aura: 0x8fd8ff } },
  { id: 'sword_venom',   name: 'Venomfang',    rarity: 'rare',
    blade: 0xc9ff6b, edge: 0xf2ffd0, guard: 0x5a8a2a, grip: 0x1a2a0d, glow: 0x4a8a10,
    fx: { shape: 'serrated', tsuba: 'ring', runes: 0xc9ff6b, tassel: 0x4a8a10 } },
  { id: 'sword_blood',   name: 'Bloodmoon',    rarity: 'epic',
    blade: 0xff8a8a, edge: 0xffd0d0, guard: 0x8a1a1a, grip: 0x2a0808, glow: 0x9a1010,
    fx: {
      shape: 'broad', tsuba: 'cross', runes: 0xff3c3c, aura: 0xc01818,
      tassel: 0x8a1a1a, long: 1.15,
    } },
  // The Ascended's blade. Comes with the Frogath the Divine frog skin and is
  // the weapon half of it: double-ended, white-cored, trailing light.
  { id: 'sword_divine', name: 'The Divine Judgment', rarity: 'legendary', reward: true,
    blade: 0xffffff, edge: 0xfff3c4, guard: 0xfffaf0, grip: 0x6a5210, glow: 0xffd76b,
    fx: {
      shape: 'light', tsuba: 'ring', glow: true, runes: 0xffffff,
      aura: 0xfff3c4, tassel: 0xfff3c4, long: 1.5, doubled: true,
    } },
  { id: 'sword_lotus',   name: 'Golden Lotus', rarity: 'legendary',
    blade: 0xffe9a0, edge: 0xfffbe0, guard: 0xffd24a, grip: 0x3a2a06, glow: 0xc9922a,
    fx: {
      shape: 'curved', tsuba: 'ring', glow: true, runes: 0xfff3c4,
      aura: 0xffd24a, tassel: 0xffd24a, long: 1.2,
    } },

  /**
   * ═══ SWAMPFORGED ════════════════════════════════════════════════════
   *
   * Wood, chipped iron and poison. The ladder runs down the list: two
   * commons, two uncommons, two rares, two epics and the King's Fang, which
   * is the only gold on any of them.
   */
  { id: 'sword_rotwood', name: 'Rotwood Blade', rarity: 'common', set: 'swamp',
    blade: 0x8a7a52, edge: 0xaa9a6a, guard: 0x6a5a3a, grip: 0x3a2e1c, glow: 0x1a1408,
    fx: { shape: 'katana', tsuba: 'square' } },
  { id: 'sword_bogcut',  name: 'Bog Cutter',    rarity: 'common', set: 'swamp',
    blade: 0x7a8a72, edge: 0xa8b89a, guard: 0x4a5a44, grip: 0x24301f, glow: 0x141a12,
    fx: { shape: 'serrated', tsuba: 'square' } },
  { id: 'sword_mosssteel', name: 'Mosssteel Katana', rarity: 'uncommon', set: 'swamp',
    blade: 0x9ab89a, edge: 0xd8ecd0, guard: 0x5a7a4a, grip: 0x22301c, glow: 0x1a2a18,
    fx: { shape: 'katana', tsuba: 'disc', tassel: 0x7aa84a } },
  { id: 'sword_venomedge', name: 'Venom Edge',  rarity: 'uncommon', set: 'swamp',
    blade: 0x6a8a5a, edge: 0xc8f0a0, guard: 0x4a6a2a, grip: 0x1a240f, glow: 0x2a4a10,
    fx: { shape: 'curved', tsuba: 'ring', runes: 0xa8ff4a } },
  { id: 'sword_swampfang', name: 'Swampfang',   rarity: 'rare', set: 'swamp',
    blade: 0xc8c0a0, edge: 0xeae4c8, guard: 0x5a4a2a, grip: 0x241c10, glow: 0x2a2418,
    fx: { shape: 'fang', tsuba: 'cross', tassel: 0x6a8a2a } },
  { id: 'sword_warden',  name: 'Warden Blade',  rarity: 'rare', set: 'swamp',
    blade: 0x8a8a7a, edge: 0xb8b8a0, guard: 0x6a5a3a, grip: 0x2a2418, glow: 0x1a1a12,
    fx: { shape: 'broad', tsuba: 'cross', long: 1.1 } },
  { id: 'sword_rotfang', name: 'Rotfang Katana', rarity: 'epic', set: 'swamp',
    blade: 0x2a3024, edge: 0x8aa86a, guard: 0x3a4a24, grip: 0x121610, glow: 0x2a4a10,
    fx: {
      shape: 'serrated', tsuba: 'ring', runes: 0xc9ff4a, aura: 0x6ac02a,
    } },
  { id: 'sword_marsh',   name: 'Marsh Reaper',  rarity: 'epic', set: 'swamp',
    blade: 0x24301f, edge: 0x7a9a5a, guard: 0x2a3a1f, grip: 0x0f1410, glow: 0x24400f,
    fx: {
      shape: 'broad', tsuba: 'cross', runes: 0x8ac44a, aura: 0x4a8a2a, long: 1.25,
    } },
  { id: 'sword_kingsfang', name: "King's Fang", rarity: 'legendary', set: 'swamp',
    blade: 0xd8f0b0, edge: 0xf4ffe0, guard: 0xc9a227, grip: 0x2a3a14, glow: 0x6ac02a,
    fx: {
      shape: 'fang', tsuba: 'ring', glow: true, runes: 0xa8ff4a,
      aura: 0x6aff2a, tassel: 0xc9a227, long: 1.2,
    } },

  /**
   * ═══ CELESTIAL FORGE ════════════════════════════════════════════════
   *
   * Dark metal, gold and blue-white light — the metal the heaven levels are
   * built out of, so this set reads as the same material as Frogath's own
   * gear rather than as another palette.
   *
   * `orbit` is on exactly one of them. See the note in js/frog.js: it is the
   * signal that somebody is carrying the rarest thing in the game, and it
   * only means that if nothing else in the shop has it.
   */
  { id: 'sword_starsteel', name: 'Starsteel Blade', rarity: 'uncommon', set: 'celestial',
    blade: 0x8a97ac, edge: 0xdce6f4, guard: 0x3a4258, grip: 0x141a26, glow: 0x2a3648,
    fx: { shape: 'katana', tsuba: 'disc', runes: 0xbfe6ff } },
  { id: 'sword_moonfang', name: 'Moonfang',    rarity: 'uncommon', set: 'celestial',
    blade: 0xc0cada, edge: 0xf0f6ff, guard: 0x6a7a9a, grip: 0x1a2230, glow: 0x3a4a6a,
    fx: { shape: 'fang', tsuba: 'ring', runes: 0x7fbcff } },
  { id: 'sword_astral',  name: 'Astral Katana', rarity: 'rare', set: 'celestial',
    blade: 0x9aa8c8, edge: 0xe4eeff, guard: 0xffd24a, grip: 0x1a2038, glow: 0x3a4a8a,
    fx: { shape: 'katana', tsuba: 'ring', runes: 0x8fd8ff, tassel: 0xffd24a } },
  { id: 'sword_comet',   name: 'Comet Edge',   rarity: 'rare', set: 'celestial',
    blade: 0x7fbcff, edge: 0xdcf2ff, guard: 0x4a6a9a, grip: 0x121c30, glow: 0x2a6ac0,
    fx: { shape: 'curved', tsuba: 'cross', runes: 0xbfe6ff, aura: 0x7fbcff } },
  { id: 'sword_sunforged', name: 'Sunforged Blade', rarity: 'epic', set: 'celestial',
    blade: 0xffd24a, edge: 0xfff6d0, guard: 0xc9a227, grip: 0x3a2a06, glow: 0xc9922a,
    fx: {
      shape: 'broad', tsuba: 'cross', glow: true, runes: 0xfff3c4,
      aura: 0xffd24a, long: 1.1,
    } },
  { id: 'sword_heavensfang', name: "Heaven's Fang", rarity: 'epic', set: 'celestial',
    blade: 0xfff3c4, edge: 0xffffff, guard: 0xe8c86a, grip: 0x3a2e0a, glow: 0xffd76b,
    fx: {
      shape: 'fang', tsuba: 'ring', glow: true, runes: 0xffffff,
      aura: 0xffd76b, tassel: 0xffd76b, long: 1.15,
    } },
  { id: 'sword_celestial', name: 'Celestial Reaper', rarity: 'legendary', set: 'celestial',
    blade: 0x2a3060, edge: 0xbfd4ff, guard: 0xffd24a, grip: 0x0d1024, glow: 0x4a5ac0,
    fx: {
      shape: 'curved', tsuba: 'cross', runes: 0xbfe6ff, aura: 0x6a7aff,
      tassel: 0xffd24a, long: 1.3,
    } },
  { id: 'sword_emperor', name: "Emperor's Edge", rarity: 'legendary', set: 'celestial',
    blade: 0xffe98a, edge: 0xfffbe0, guard: 0xffd24a, grip: 0x2a2050, glow: 0xc9922a,
    fx: {
      shape: 'broad', tsuba: 'ring', glow: true, runes: 0xfff3c4,
      aura: 0xffd76b, tassel: 0xffd24a, long: 1.3,
    } },
  { id: 'sword_sovereign', name: 'Astral Sovereign', rarity: 'mythic', set: 'celestial',
    blade: 0xffffff, edge: 0xfff3c4, guard: 0xffd24a, grip: 0x1a1e38, glow: 0xffd76b,
    fx: {
      shape: 'light', tsuba: 'ring', glow: true, runes: 0xffffff,
      aura: 0xffd76b, tassel: 0xffd24a, long: 1.4,
      orbit: 0xffd76b, orbitN: 8,
    } },

  /**
   * ═══ THE ECLIPSE COLLECTION ═════════════════════════════════════════
   *
   * Black, bruised violet, and a cold crack of light. The set gets less
   * legible as it climbs — the commons are plain dark steel, the legendary
   * burns like a corona, and the mythic is a hole with a star in it.
   *
   * `sword_ecl_dusk` is the one the brief called "Moonfang". There is
   * already a Moonfang in the Celestial set, and two swords sharing a name
   * in one shop is a bug you hit while reading, not while playing — so this
   * one is Duskfang. Same idea, no collision.
   */
  { id: 'sword_ecl_nightsteel', name: 'Nightsteel Blade', rarity: 'common', set: 'eclipse',
    blade: 0x3a3f4a, edge: 0x6a7280, guard: 0x24272e, grip: 0x12141a, glow: 0x14161c,
    fx: { shape: 'katana', tsuba: 'disc' } },
  { id: 'sword_ecl_shadow', name: 'Shadow Katana', rarity: 'common', set: 'eclipse',
    blade: 0x24242e, edge: 0x50506a, guard: 0x1a1a22, grip: 0x0e0e14, glow: 0x101018,
    fx: { shape: 'katana', tsuba: 'square' } },
  { id: 'sword_ecl_dusk', name: 'Duskfang', rarity: 'uncommon', set: 'eclipse',
    blade: 0x6a7490, edge: 0xb8c4e0, guard: 0x3a4258, grip: 0x141826, glow: 0x2a3044,
    fx: { shape: 'fang', tsuba: 'ring', runes: 0x9ab0e0 } },
  { id: 'sword_ecl_edge', name: 'Eclipse Edge', rarity: 'rare', set: 'eclipse',
    blade: 0x2a2438, edge: 0xffb43a, guard: 0x4a3a1a, grip: 0x120e1e, glow: 0x6a4a10,
    fx: { shape: 'curved', tsuba: 'ring', runes: 0xffb43a } },
  { id: 'sword_ecl_voidfang', name: 'Voidfang', rarity: 'rare', set: 'eclipse',
    blade: 0x1a1426, edge: 0xa87aff, guard: 0x3a2a5a, grip: 0x0d0a16, glow: 0x4a2a8a,
    fx: { shape: 'fang', tsuba: 'cross', runes: 0xa87aff, aura: 0x7a4ad0 } },
  { id: 'sword_ecl_darkstar', name: 'Darkstar Reaver', rarity: 'epic', set: 'eclipse',
    blade: 0x141020, edge: 0xc0a8ff, guard: 0x2a2048, grip: 0x0a0812, glow: 0x5a3aa8,
    fx: {
      shape: 'broad', tsuba: 'cross', runes: 0x8f6aff, aura: 0x5a3aa8, long: 1.2,
    } },
  { id: 'sword_ecl_warden', name: 'Eclipse Warden Blade', rarity: 'legendary', set: 'eclipse',
    blade: 0x1a1a22, edge: 0xffd76b, guard: 0xffb43a, grip: 0x241806, glow: 0xff9a2a,
    fx: {
      shape: 'broad', tsuba: 'ring', glow: true, runes: 0xffb43a,
      aura: 0xff9a2a, tassel: 0xffb43a, long: 1.25,
    } },
  { id: 'sword_ecl_fallen', name: 'Fallen Star', rarity: 'mythic', set: 'eclipse',
    blade: 0x0f0d18, edge: 0xffffff, guard: 0xd8d0ff, grip: 0x1a1040, glow: 0xbfa8ff,
    fx: {
      shape: 'light', tsuba: 'ring', glow: true, runes: 0xffffff,
      aura: 0xbfa8ff, tassel: 0xd8d0ff, long: 1.35,
    } },
  /**
   * ??? — ECLIPSE'S EDGE.
   *
   * Obsidian, a silver ring for a guard, and three thin violet cracks up the
   * flat — the same three materials the armour and the kunai are made of, so
   * the set reads as one object split three ways.
   *
   * ── it used to be pitch black with ten orbiting chips ─────────────────
   * Which is the cheap way to say "rare" and it did not work: the blade had
   * no shading at all, and the chips were the only thing you could see. Now
   * the blade is the thing you see and there are THREE fragments, slow.
   */
  { id: 'sword_ecl_secret', name: "Eclipse's Edge", rarity: 'secret', set: 'eclipse',
    secret: true,
    blade: ECL.obsidian, edge: ECL.cold, guard: ECL.silver, grip: 0x141320,
    glow: 0x16122a,
    fx: {
      shape: 'broad', tsuba: 'ring', runes: ECL.energy,
      orbit: ECL.energy, orbitN: 3, long: 1.25, tassel: ECL.violet,
    } },
];

// ----------------------------------------------------------------- kunai

/**
 * blade / facet / wrap / ring, plus `fx`.
 *
 *   shape   classic | broad | needle | crystal | star
 *   glow    the blade emits light rather than reflecting it
 *   ribbon  colour of a streamer trailing from the ring
 *   big     scale multiplier on the blade
 */
export const KUNAI_SKINS = [
  { id: 'kunai_default', name: 'Field Kunai', rarity: 'common',
    blade: 0x2b2f36, facet: 0x5a626d, wrap: 0xc0392b, ring: 0x14161a,
    fx: { shape: 'classic' } },
  { id: 'kunai_slate',   name: 'Slate',       rarity: 'common',
    blade: 0x3a4048, facet: 0x6d7682, wrap: 0x4a5560, ring: 0x161a1f,
    fx: { shape: 'needle' } },
  { id: 'kunai_rust',    name: 'Rusted Fang', rarity: 'common',
    blade: 0x4a3428, facet: 0x8a6242, wrap: 0x7a4a2a, ring: 0x1d1410,
    fx: { shape: 'broad' } },
  { id: 'kunai_ivy',     name: 'Ivy Wrap',    rarity: 'uncommon',
    blade: 0x2a3a2c, facet: 0x6a8a5a, wrap: 0x4e9a3c, ring: 0x14201a,
    fx: { shape: 'classic', ribbon: 0x4e9a3c } },
  { id: 'kunai_copper',  name: 'Copperhead',  rarity: 'uncommon',
    blade: 0x6a3f22, facet: 0xc08a4a, wrap: 0xd97a2a, ring: 0x2a1a0d,
    fx: { shape: 'broad', ribbon: 0xd97a2a, big: 1.15 } },
  { id: 'kunai_night',   name: 'Nightglass',  rarity: 'rare',
    blade: 0x1a1830, facet: 0x6a5aa8, wrap: 0x4a3a9a, ring: 0x0d0a1a,
    fx: { shape: 'crystal', glow: true } },
  { id: 'kunai_koi',     name: 'Koi',         rarity: 'rare',
    blade: 0xf0e6d8, facet: 0xffffff, wrap: 0xe0502a, ring: 0x2a1a14,
    fx: { shape: 'needle', ribbon: 0xe0502a, big: 1.1 } },
  { id: 'kunai_cinder',  name: 'Cinderpoint', rarity: 'epic',
    blade: 0x2a1410, facet: 0xff7a3c, wrap: 0xff4a1a, ring: 0x1a0a06,
    fx: { shape: 'star', glow: true, ribbon: 0xff4a1a } },
  { id: 'kunai_sun',     name: 'Sunspire',    rarity: 'legendary',
    blade: 0xffd76b, facet: 0xfff6d0, wrap: 0xc9922a, ring: 0x3a2a06,
    fx: { shape: 'crystal', glow: true, ribbon: 0xffd76b, big: 1.25 } },

  /**
   * ═══ SWAMPFORGED ════════════════════════════════════════════════════
   *
   * Every blade in the pool is drawn from the same shared geometry, and
   * changing shape rebuilds the pool — so these lean on the five profiles
   * rather than asking for new ones, and rise through them: mud and moss are
   * plain, the King's Fang is a glowing shard half again the size.
   */
  { id: 'kunai_mud',     name: 'Mud Kunai',    rarity: 'common', set: 'swamp',
    blade: 0x4a3a28, facet: 0x8a7a52, wrap: 0x6a5a3a, ring: 0x1d1610,
    fx: { shape: 'classic' } },
  { id: 'kunai_moss',    name: 'Moss Kunai',   rarity: 'common', set: 'swamp',
    blade: 0x3a4a2c, facet: 0x7aa85a, wrap: 0x5a7a3a, ring: 0x16200f,
    fx: { shape: 'broad' } },
  { id: 'kunai_bog',     name: 'Bog Kunai',    rarity: 'uncommon', set: 'swamp',
    blade: 0x2a3a2c, facet: 0x6a8a6a, wrap: 0x4a5a44, ring: 0x141a12,
    fx: { shape: 'needle', ribbon: 0x5a7a3a } },
  { id: 'kunai_venom',   name: 'Venom Kunai',  rarity: 'uncommon', set: 'swamp',
    blade: 0x24401c, facet: 0xa8ff4a, wrap: 0x4a8a2a, ring: 0x101a0a,
    fx: { shape: 'classic', ribbon: 0xa8ff4a, big: 1.1 } },
  { id: 'kunai_swampfang', name: 'Swampfang Kunai', rarity: 'rare', set: 'swamp',
    blade: 0xc8c0a0, facet: 0xeae4c8, wrap: 0x5a4a2a, ring: 0x241c10,
    fx: { shape: 'broad', ribbon: 0x6a8a2a, big: 1.15 } },
  { id: 'kunai_warden',  name: 'Warden Kunai', rarity: 'rare', set: 'swamp',
    blade: 0x6a6a58, facet: 0xb8b8a0, wrap: 0x4a4030, ring: 0x1e1e16,
    fx: { shape: 'needle', big: 1.2 } },
  { id: 'kunai_rotfang', name: 'Rotfang Kunai', rarity: 'epic', set: 'swamp',
    blade: 0x1e2018, facet: 0xc9ff4a, wrap: 0x3a5a14, ring: 0x0f1208,
    fx: { shape: 'star', glow: true, ribbon: 0x6ac02a } },
  { id: 'kunai_marsh',   name: 'Marsh Kunai',  rarity: 'epic', set: 'swamp',
    blade: 0x24301f, facet: 0x8ac44a, wrap: 0x2a3a1f, ring: 0x0f1410,
    fx: { shape: 'crystal', glow: true, ribbon: 0x4a8a2a, big: 1.15 } },
  { id: 'kunai_kingsfang', name: "King's Fang Kunai", rarity: 'legendary', set: 'swamp',
    blade: 0xd8f0b0, facet: 0xa8ff4a, wrap: 0xc9a227, ring: 0x2a3a14,
    fx: { shape: 'crystal', glow: true, ribbon: 0x6aff2a, big: 1.3 } },

  /**
   * ═══ CELESTIAL FORGE ════════════════════════════════════════════════
   *
   * No `orbit` here, unlike the sword set. A kunai is a POOLED PROJECTILE —
   * dozens exist at once and they are rebuilt whenever the shape changes —
   * so orbiting fragments would be per-frame work on every blade in flight,
   * paid for by everyone in the match. The Prime gets the biggest glowing
   * shard in the game instead.
   */
  { id: 'kunai_star',    name: 'Star Kunai',   rarity: 'uncommon', set: 'celestial',
    blade: 0x2a2e42, facet: 0xbfe6ff, wrap: 0x4a5a8a, ring: 0x14161f,
    fx: { shape: 'classic', ribbon: 0x7fbcff } },
  { id: 'kunai_moon',    name: 'Moon Kunai',   rarity: 'uncommon', set: 'celestial',
    blade: 0x8a97ac, facet: 0xf0f6ff, wrap: 0x6a7a9a, ring: 0x1a2230,
    fx: { shape: 'needle' } },
  { id: 'kunai_astral',  name: 'Astral Kunai', rarity: 'rare', set: 'celestial',
    blade: 0x3a4258, facet: 0xffd24a, wrap: 0x2a3348, ring: 0x141a26,
    fx: { shape: 'broad', ribbon: 0xffd24a, big: 1.1 } },
  { id: 'kunai_comet',   name: 'Comet Kunai',  rarity: 'rare', set: 'celestial',
    blade: 0x1a2c48, facet: 0x8fd8ff, wrap: 0x2a6ac0, ring: 0x0f1828,
    fx: { shape: 'needle', glow: true, ribbon: 0x8fd8ff, big: 1.15 } },
  { id: 'kunai_sunspear', name: 'Sun Kunai',   rarity: 'epic', set: 'celestial',
    blade: 0xc9a227, facet: 0xfff6d0, wrap: 0xffd24a, ring: 0x3a2a06,
    fx: { shape: 'star', glow: true, ribbon: 0xffd24a } },
  { id: 'kunai_heaven',  name: 'Heaven Kunai', rarity: 'epic', set: 'celestial',
    blade: 0xfff3c4, facet: 0xffffff, wrap: 0xe8c86a, ring: 0x3a2e0a,
    fx: { shape: 'crystal', glow: true, ribbon: 0xffd76b, big: 1.15 } },
  { id: 'kunai_celestial', name: 'Celestial Kunai', rarity: 'legendary', set: 'celestial',
    blade: 0x2a3060, facet: 0xbfd4ff, wrap: 0x6a7aff, ring: 0x0d1024,
    fx: { shape: 'crystal', glow: true, ribbon: 0x6a7aff, big: 1.25 } },
  { id: 'kunai_emperor', name: 'Emperor Kunai', rarity: 'legendary', set: 'celestial',
    blade: 0xffe98a, facet: 0xfffbe0, wrap: 0xffd24a, ring: 0x2a2050,
    fx: { shape: 'star', glow: true, ribbon: 0xffd24a, big: 1.25 } },
  { id: 'kunai_prime',   name: 'Astral Kunai Prime', rarity: 'mythic', set: 'celestial',
    blade: 0xffffff, facet: 0xffd76b, wrap: 0xffd24a, ring: 0x1a1e38,
    fx: { shape: 'crystal', glow: true, ribbon: 0xffd76b, big: 1.4 } },

  /**
   * ═══ THE ECLIPSE COLLECTION ═════════════════════════════════════════
   *
   * Two names moved. The brief's "Moon Kunai" collides with the Celestial
   * set's, so this one is Dusk Kunai; and its Legendary and its secret were
   * BOTH called Eclipse Shard, in the same crate. The secret keeps the name
   * — it is the one that matters, and it is the set piece — so the
   * legendary is Eclipse Sliver.
   */
  { id: 'kunai_ecl_shadow', name: 'Shadow Kunai', rarity: 'common', set: 'eclipse',
    blade: 0x24242e, facet: 0x50506a, wrap: 0x1a1a22, ring: 0x0e0e14,
    fx: { shape: 'classic' } },
  { id: 'kunai_ecl_night', name: 'Night Kunai', rarity: 'common', set: 'eclipse',
    blade: 0x1e2438, facet: 0x6a7490, wrap: 0x2a3450, ring: 0x0f1220,
    fx: { shape: 'needle' } },
  { id: 'kunai_ecl_dusk', name: 'Dusk Kunai', rarity: 'uncommon', set: 'eclipse',
    blade: 0x3a4258, facet: 0xb8c4e0, wrap: 0x6a7490, ring: 0x141826,
    fx: { shape: 'broad', ribbon: 0x9ab0e0 } },
  { id: 'kunai_ecl_eclipse', name: 'Eclipse Kunai', rarity: 'rare', set: 'eclipse',
    blade: 0x2a2438, facet: 0xffb43a, wrap: 0x6a4a10, ring: 0x120e1e,
    fx: { shape: 'classic', ribbon: 0xffb43a, big: 1.1 } },
  { id: 'kunai_ecl_void', name: 'Void Fang', rarity: 'rare', set: 'eclipse',
    blade: 0x1a1426, facet: 0xa87aff, wrap: 0x4a2a8a, ring: 0x0d0a16,
    fx: { shape: 'needle', glow: true, ribbon: 0xa87aff } },
  { id: 'kunai_ecl_darkstar', name: 'Darkstar Kunai', rarity: 'epic', set: 'eclipse',
    blade: 0x141020, facet: 0xc0a8ff, wrap: 0x5a3aa8, ring: 0x0a0812,
    fx: { shape: 'star', glow: true, ribbon: 0x8f6aff } },
  { id: 'kunai_ecl_sliver', name: 'Eclipse Sliver', rarity: 'legendary', set: 'eclipse',
    blade: 0x1a1a22, facet: 0xffd76b, wrap: 0xffb43a, ring: 0x241806,
    fx: { shape: 'crystal', glow: true, ribbon: 0xff9a2a, big: 1.2 } },
  { id: 'kunai_ecl_fallen', name: 'Fallen Star Kunai', rarity: 'mythic', set: 'eclipse',
    blade: 0x0f0d18, facet: 0xffffff, wrap: 0xd8d0ff, ring: 0x1a1040,
    fx: { shape: 'crystal', glow: true, ribbon: 0xbfa8ff, big: 1.3 } },
  /**
   * ??? — THE ECLIPSE SHARD.
   *
   * Not a blade: a piece of the thing itself. Black crystal with one cold
   * crack through it, and the streamer behind it is DARKER than the air, so
   * a thrown one drags a shadow rather than a light.
   */
  { id: 'kunai_ecl_secret', name: 'Eclipse Shard', rarity: 'secret', set: 'eclipse',
    secret: true,
    blade: ECL.obsidian, facet: ECL.cold, wrap: 0x141320, ring: ECL.silver,
    fx: { shape: 'crystal', glow: true, ribbon: ECL.energy, big: 1.25 } },
];

// ------------------------------------------------------------------ frog

/**
 * skin / belly / cloth (gi) / scarf, plus `fx`.
 *
 * As with the swords, `fx` is what makes a skin worth owning. A recolour is
 * free; these change the frog. The rig reads them and adds real geometry, so
 * a legendary is recognisable across the arena at a glance.
 *
 *   emissive  the hide self-lights in this colour
 *   eyeGlow   glowing eyes instead of ordinary ones
 *   pattern   glowing inlay lines over the back and brow
 *   aura      a soft shell around the whole frog
 *   halo      one or two rings above the head
 *   horns     n horns on the brow
 *   crown     a ring of points around the skull; a number scales it
 *   spikes    n spines down the back
 *   fins      cheek fins
 *   plates    colour of a breastplate, pauldrons and a collar — ARMOUR
 *   moss      colour of moss tufts over the shoulders and back
 *   hood      colour of a hood pulled over the skull
 *   shield    colour of a shield strapped to the off arm
 *   stars     colour of glowing specks scattered over the hide
 *   orbit     colour of fragments that ORBIT the frog (`orbitN` = how many)
 *   embers    colour of sparks that rise off the hide and fade
 *   divine    build the Ascended's whole rig — wings, rings, corona
 */
export const FROG_SKINS = [
  { id: 'frog_default', name: 'Pond Green',  rarity: 'common',
    skin: 0x6cc24a, belly: 0xdfe6a8, cloth: 0x24242e, scarf: 0xc0392b,
    fx: {} },
  { id: 'frog_bog',     name: 'Bog Brown',   rarity: 'common',
    skin: 0x8a7a3a, belly: 0xe0d6a8, cloth: 0x2a2418, scarf: 0x7a5a2a,
    fx: { spikes: 3 } },
  { id: 'frog_reed',    name: 'Reed',        rarity: 'common',
    skin: 0x9ac24a, belly: 0xeef2c0, cloth: 0x2e3320, scarf: 0x6a8a2a,
    fx: { fins: true } },
  { id: 'frog_tree',    name: 'Tree Frog',   rarity: 'uncommon',
    skin: 0x3aa8c2, belly: 0xd8f2f8, cloth: 0x16242e, scarf: 0xe0a02a,
    fx: { fins: true, spikes: 4, pattern: 0xe0a02a } },
  { id: 'frog_slate',   name: 'Slate Ninja', rarity: 'uncommon',
    skin: 0x6a7280, belly: 0xd0d8e0, cloth: 0x14161c, scarf: 0x8a9aa8,
    fx: { horns: 2, spikes: 5 } },
  { id: 'frog_dart',    name: 'Poison Dart', rarity: 'rare',
    skin: 0xff5a3c, belly: 0xffd0a8, cloth: 0x1a0e0a, scarf: 0x2a2a2a,
    fx: { pattern: 0xffe14a, eyeGlow: 0xffe14a, spikes: 6 } },
  { id: 'frog_midnight', name: 'Midnight',   rarity: 'rare',
    skin: 0x3a3a6a, belly: 0xa8a8d8, cloth: 0x0d0d1a, scarf: 0x6a5aff,
    fx: { emissive: 0x1a1a3a, eyeGlow: 0x8f7aff, aura: 0x3a2a8a, horns: 2 } },
  { id: 'frog_golden',  name: 'Golden Toad', rarity: 'epic',
    skin: 0xe0b83a, belly: 0xfff0b0, cloth: 0x3a2a06, scarf: 0xc0392b,
    fx: {
      emissive: 0x6a4a08, pattern: 0xfff3c4, eyeGlow: 0xfff0b0,
      crown: true, horns: 2, aura: 0xe0b83a,
    } },
  { id: 'frog_spirit',  name: 'Spirit Frog', rarity: 'legendary',
    skin: 0xa8f0e0, belly: 0xe8fffa, cloth: 0x1a3a3a, scarf: 0x6affd0,
    fx: {
      emissive: 0x2a6a5a, pattern: 0x6affd0, eyeGlow: 0xe8fffa,
      aura: 0x6affd0, halo: 0x6affd0, fins: true, spikes: 5,
    } },
  // Not in any crate. The only way to own this is to put Frogath down, and
  // it is his LOOK only — none of what made him hard comes with it. Same
  // size, same hitbox, same everything that matters; only the god's
  // appearance, at frog scale.
  { id: 'frog_frogath', name: 'Frogath',     rarity: 'legendary', reward: true,
    skin: 0xe8b73a, belly: 0xffe9a8, cloth: 0x4a3206, scarf: 0xfff3c4,
    fx: {
      emissive: 0x6a4a08, pattern: 0xfff3c4, eyeGlow: 0xfff6d0,
      aura: 0xffd76b, halo: 0xffd76b, halo2: true, crown: true,
      horns: 2, spikes: 4, embers: 0xffd76b,
    } },
  /**
   * FROGATH THE DIVINE. The Ascended himself, at frog scale.
   *
   * Awarded only for putting THE DIVINE JUDGMENT down, and the rarest thing
   * in the game — there is no crate that can produce it. `divine` builds the
   * whole rig: armour, wings, orbiting runes, rings, corona, white eyes.
   *
   * It has TWO forms, exactly as he does. You wear phase 1; the first kill of
   * a life ascends you to phase 2 until you die. Purely cosmetic — see
   * `divinePhase` in Player, which touches nothing but the model.
   */
  { id: 'frog_divine', name: 'Frogath the Divine', rarity: 'legendary', reward: true,
    skin: 0xf0d78a, belly: 0xfff3c4, cloth: 0x6a5210, scarf: 0xfffaf0,
    fx: {
      divine: true,
      emissive: 0x8a6a12, pattern: 0xfff3c4, eyeGlow: 0xffffff,
      aura: 0xffd76b, halo: 0xfff3c4, halo2: true, crown: true,
      horns: 2, embers: 0xfff3c4,
    } },

  /**
   * ═══ SWAMPFORGED ════════════════════════════════════════════════════
   *
   * Mud, leather, moss and poison — and the armour gets heavier as the tier
   * climbs, which is the thing you can see across an arena. The two commons
   * carry nothing that glows; from Venom Frog up, something does.
   */
  { id: 'frog_bogfrog', name: 'Bog Frog',      rarity: 'common', set: 'swamp',
    skin: 0x6a5a3a, belly: 0xc4b88a, cloth: 0x4a3a24, scarf: 0x6a5a2a,
    fx: {} },
  { id: 'frog_mossfrog', name: 'Moss Frog',    rarity: 'common', set: 'swamp',
    skin: 0x5a7a4a, belly: 0xc8d8a8, cloth: 0x3a4a2a, scarf: 0x6a8a4a,
    fx: { moss: 0x9ad24a, plates: 0x5a4a2a } },
  { id: 'frog_scout',   name: 'Swamp Scout',   rarity: 'uncommon', set: 'swamp',
    skin: 0x7aa84a, belly: 0xdcecb0, cloth: 0x2a3a20, scarf: 0x9ac24a,
    fx: { fins: true, spikes: 3 } },
  { id: 'frog_mudguard', name: 'Mudguard Frog', rarity: 'uncommon', set: 'swamp',
    skin: 0x7a6a4a, belly: 0xd8c8a0, cloth: 0x3a2e1c, scarf: 0x8a7a4a,
    fx: { plates: 0x6a5638, shield: 0x7a5a30, spikes: 3 } },
  { id: 'frog_venomfrog', name: 'Venom Frog',  rarity: 'rare', set: 'swamp',
    skin: 0x2a4a2a, belly: 0x8ac46a, cloth: 0x16240f, scarf: 0x4a8a2a,
    fx: {
      plates: 0x24401c, pattern: 0xa8ff4a, eyeGlow: 0xa8ff4a, spikes: 5,
      emissive: 0x14240c,
    } },
  { id: 'frog_assassin', name: 'Bog Assassin', rarity: 'rare', set: 'swamp',
    skin: 0x4a5a44, belly: 0xa8b89a, cloth: 0x141a12, scarf: 0x2a3a24,
    fx: { hood: 0x141a12, plates: 0x2a3524 } },
  { id: 'frog_wardenfrog', name: 'Swamp Warden', rarity: 'epic', set: 'swamp',
    skin: 0x5a6a4a, belly: 0xb8c8a0, cloth: 0x2a3324, scarf: 0x4a5a3a,
    fx: {
      plates: 0x6a6a58, moss: 0x8fc44a, horns: 2, spikes: 5,
      emissive: 0x1a2410,
    } },
  { id: 'frog_rotfangfrog', name: 'Rotfang Frog', rarity: 'epic', set: 'swamp',
    skin: 0x2a2a24, belly: 0x8a9a70, cloth: 0x121410, scarf: 0x4a6a1a,
    fx: {
      plates: 0x1e2018, pattern: 0xc9ff4a, eyeGlow: 0xc9ff4a, aura: 0x4a8a10,
      horns: 2, spikes: 6, emissive: 0x162008,
    } },
  { id: 'frog_swampking', name: 'The Swamp King', rarity: 'legendary', set: 'swamp',
    skin: 0x4a7a3a, belly: 0xd0e8a8, cloth: 0x1a2a14, scarf: 0x8ac24a,
    fx: {
      plates: 0x8a7a3a, moss: 0x9ad24a, crown: 1.7, pattern: 0x9aff5a,
      eyeGlow: 0x9aff5a, aura: 0x4aa82a, horns: 2, spikes: 6,
      emissive: 0x1e3a12,
    } },

  /**
   * ═══ CELESTIAL FORGE ════════════════════════════════════════════════
   *
   * Dark metal, gold and blue-white light. Nothing in this set is common —
   * its floor is Uncommon, which is what the 5,000 buys.
   */
  { id: 'frog_starbound', name: 'Starbound Frog', rarity: 'uncommon', set: 'celestial',
    skin: 0x2a2e42, belly: 0x8a94b8, cloth: 0x14161f, scarf: 0x4a5a8a,
    fx: { plates: 0x1e2230, stars: 0xbfe6ff, emissive: 0x101828 } },
  { id: 'frog_moonlit', name: 'Moonlit Frog',  rarity: 'uncommon', set: 'celestial',
    skin: 0x8a97ac, belly: 0xdce6f4, cloth: 0x2a3240, scarf: 0x7fbcff,
    fx: { plates: 0xc0cada, pattern: 0x7fbcff, emissive: 0x1a2430 } },
  { id: 'frog_astralwarrior', name: 'Astral Warrior', rarity: 'rare', set: 'celestial',
    skin: 0x3a4258, belly: 0xc0c8dc, cloth: 0x1a2030, scarf: 0xffd24a,
    fx: {
      plates: 0x2a3348, pattern: 0xffd24a, horns: 2, emissive: 0x141c2a,
    } },
  { id: 'frog_cometfrog', name: 'Comet Frog',  rarity: 'rare', set: 'celestial',
    skin: 0x2e3a52, belly: 0xa8b8d8, cloth: 0x161e2c, scarf: 0x8fd8ff,
    fx: {
      plates: 0x222c40, stars: 0x8fd8ff, pattern: 0x8fd8ff,
      eyeGlow: 0xd0f0ff, spikes: 4, emissive: 0x122030,
    } },
  { id: 'frog_sunforged', name: 'Sunforged Frog', rarity: 'epic', set: 'celestial',
    skin: 0xc9a227, belly: 0xfff0b0, cloth: 0x4a3206, scarf: 0xffd24a,
    fx: {
      plates: 0xffd24a, pattern: 0xfff3c4, eyeGlow: 0xfff6d0,
      aura: 0xffd24a, horns: 2, emissive: 0x6a4a08,
    } },
  { id: 'frog_moonguardian', name: 'Moon Guardian', rarity: 'epic', set: 'celestial',
    skin: 0x9aa8c0, belly: 0xe4eef8, cloth: 0x28303e, scarf: 0x7fbcff,
    fx: {
      plates: 0xd0daea, pattern: 0x7fbcff, eyeGlow: 0xdcf0ff,
      halo: 0x9fd4ff, aura: 0x5a9ae0, emissive: 0x1e2a3a,
    } },
  { id: 'frog_staremperor', name: 'Star Emperor', rarity: 'legendary', set: 'celestial',
    skin: 0x2a3050, belly: 0xc0c8e8, cloth: 0x161a2e, scarf: 0xffd24a,
    fx: {
      plates: 0x3a4470, crown: 1.6, pattern: 0xffe98a, eyeGlow: 0xfff6d0,
      aura: 0x6a7aff, horns: 4, spikes: 6, emissive: 0x1a2050,
    } },
  /**
   * "Floating energy" — `embers`, NOT `orbit`.
   *
   * Orbiting fragments are the Mythic's tell and have to stay unique to it,
   * or a Legendary two tiers down looks the same across an arena and the
   * signal is worth nothing. Rising sparks are the same promise kept a
   * different way.
   */
  { id: 'frog_champion', name: "Heaven's Champion", rarity: 'legendary', set: 'celestial',
    skin: 0xb89a4a, belly: 0xffeeb8, cloth: 0x3a2e0a, scarf: 0xfff3c4,
    fx: {
      plates: 0xe8c86a, embers: 0xffd76b, pattern: 0xfff3c4,
      eyeGlow: 0xffffff, aura: 0xffd76b, halo: 0xfff3c4, horns: 2,
      emissive: 0x5a4408,
    } },
  /**
   * ═══ THE RAREST THING THE SHOP CAN PRODUCE ═══════════════════════════
   * About one open in five hundred.
   *
   * ENTHRONED. Armour, a crown, a double halo, glowing hide, and twelve
   * golden fragments orbiting it — `orbit` is on this and on one sword and
   * nothing else in the game, so a frog with fragments going round it is
   * unmistakable from across the arena.
   *
   * ── it has no horns and no spines ─────────────────────────────────────
   * It used to have four horns and six spikes, and so does Fallen
   * Celestial. Between that, the crown, the double halo, the stars, the
   * glowing eyes and the armour, the two Mythics in this game were the same
   * frog in two tints — which is the one thing two items out of two
   * different five-thousand-froglet cases must not be.
   *
   * Horns are not regal. They went to the one that FELL, and this kept the
   * crown, so the two now differ in outline rather than in palette: this is
   * a crowned, haloed, orbited thing, and that is a horned, winged, broken
   * one. See `frog_ecl_fallen`.
   */
  { id: 'frog_sovereign', name: 'Astral Sovereign', rarity: 'mythic', set: 'celestial',
    skin: 0x1a1e38, belly: 0xd8e0ff, cloth: 0x0d1024, scarf: 0xffd76b,
    fx: {
      plates: 0x2a3060, orbit: 0xffd76b, orbitN: 12, stars: 0xffffff,
      crown: 1.9, pattern: 0xffe98a, eyeGlow: 0xffffff, aura: 0xffd76b,
      halo: 0xfff3c4, halo2: true, emissive: 0x2a2060,
    } },

  /**
   * ═══ THE ECLIPSE COLLECTION ═════════════════════════════════════════
   *
   * The ladder here is DARKNESS rather than ornament: each one is a little
   * less lit than the last, and what light they do carry moves from cold
   * blue through violet to a corona and finally to bare white cracks.
   */
  { id: 'frog_ecl_shadow', name: 'Shadow Frog', rarity: 'common', set: 'eclipse',
    skin: 0x2a2a34, belly: 0x8a8a9a, cloth: 0x14141a, scarf: 0x3a3a4a,
    fx: {} },
  { id: 'frog_ecl_night', name: 'Night Frog', rarity: 'common', set: 'eclipse',
    skin: 0x1e2438, belly: 0x7a86a8, cloth: 0x0f1220, scarf: 0x2a3450,
    fx: { spikes: 3 } },
  { id: 'frog_ecl_scout', name: 'Eclipse Scout', rarity: 'uncommon', set: 'eclipse',
    skin: 0x2e3450, belly: 0x8a94b8, cloth: 0x161a2c, scarf: 0x6a5ad0,
    fx: { fins: true, plates: 0x22283f, emissive: 0x101425 } },
  { id: 'frog_ecl_void', name: 'Void Walker', rarity: 'rare', set: 'eclipse',
    skin: 0x1a1426, belly: 0x6a5a8a, cloth: 0x0d0a16, scarf: 0x7a4ad0,
    fx: {
      plates: 0x20182f, pattern: 0xa87aff, eyeGlow: 0xa87aff, spikes: 5,
      emissive: 0x160e26,
    } },
  { id: 'frog_ecl_ronin', name: 'Astral Ronin', rarity: 'rare', set: 'eclipse',
    skin: 0x2a2440, belly: 0x9a8ac0, cloth: 0x14102a, scarf: 0xc9a227,
    fx: { plates: 0x241d3a, pattern: 0xffd24a, horns: 2, emissive: 0x140f28 } },
  { id: 'frog_ecl_darkstar', name: 'Darkstar Frog', rarity: 'epic', set: 'eclipse',
    skin: 0x141020, belly: 0x7a6aa8, cloth: 0x0a0812, scarf: 0x8f6aff,
    fx: {
      plates: 0x1a1430, stars: 0xc0a8ff, pattern: 0x8f6aff,
      eyeGlow: 0xc0a8ff, aura: 0x5a3aa8, spikes: 6, emissive: 0x18102e,
    } },
  { id: 'frog_ecl_warden', name: 'Eclipse Warden', rarity: 'legendary', set: 'eclipse',
    skin: 0x1a1a22, belly: 0xc8c0a8, cloth: 0x0c0c12, scarf: 0xffb43a,
    fx: {
      plates: 0x2a2a34, crown: 1.5, pattern: 0xffb43a, eyeGlow: 0xffd76b,
      aura: 0xff9a2a, halo: 0xffb43a, horns: 2, spikes: 5, emissive: 0x241806,
    } },
  /**
   * ═══ THE ONE THAT FELL ═══════════════════════════════════════════════
   *
   * The name is the whole brief, and it is the opposite of the Mythic it
   * used to be a recolour of. Where the Astral Sovereign is crowned,
   * double-haloed and orbited by its own gold, this is HORNED, WINGED and
   * carrying one halo with a piece missing, hanging behind its head at a
   * tilt instead of sitting level over it.
   *
   * `wingsTorn` shortens alternate feathers and drops one outright, so the
   * fan has holes in it. A clean, even fan reads as an angel; this one has
   * been through something.
   *
   * ── why it lost the crown ─────────────────────────────────────────────
   * Two five-thousand-froglet cases must not pay out the same silhouette,
   * and they did: both Mythics had a crown, a double halo, four horns, six
   * spikes, stars, glowing eyes and armour, and differed only in being gold
   * or violet. Everything a fallen thing would have lost went to the
   * Sovereign, and everything it would have gained came here.
   */
  { id: 'frog_ecl_fallen', name: 'Fallen Celestial', rarity: 'mythic', set: 'eclipse',
    skin: 0x0f0d18, belly: 0xd8d0f0, cloth: 0x070610, scarf: 0xffffff,
    fx: {
      plates: 0x1a1830, embers: 0xbfa8ff, stars: 0xffffff,
      // Ashen, not black. A dark membrane on a near-black frog left only
      // the lit edge visible and the wings read as sticks; they have to
      // carry their own mass against the body they grow out of.
      wings: 0x9a90c4, wingGlow: 0xe8dcff, wingsTorn: true, wingSpan: 1.2,
      pattern: 0xffffff, eyeGlow: 0xffffff, aura: 0x7a5ad0,
      halo: 0xd8d0ff, haloBroken: true, horns: 4, spikes: 6, emissive: 0x1a1040,
    } },
  /**
   * ══ ??? — THE FORGOTTEN ONE ═══════════════════════════════════════════
   *
   * The rarest thing in the game, and the ONLY skin that does not go through
   * the generic fx list. `eclipse: true` runs a builder of its own — see
   * `_buildEclipse` in js/frog.js — because everything below the top of the
   * ladder is assembled from the same vocabulary of horns, crowns, haloes
   * and spikes, and a skin built out of that vocabulary can only ever be
   * another entry in it.
   *
   * ── WHY THE OLD ONE WAS WRONG ─────────────────────────────────────────
   * It was `skin: 0x07070a` with `emissive: 0` and nine effects bolted on:
   * a crown, four horns, six spines, two haloes, eight orbiting chips, a
   * white aura, rising sparks and stars. Two separate failures, both fatal.
   *
   * The body had no SHADING. A Lambert material at 0x07070a lit by this
   * game's sky returns almost the same number on every face, so the torso,
   * the head and the legs were one flat silhouette with no form in it — you
   * could not see that it was a frog, only where it was.
   *
   * And the effects were doing the work the DESIGN should do. Anything can
   * have more particles. Rarity that reads across a map comes from the
   * silhouette and the material, and every one of those nine things was
   * noise laid over a shape nobody could see.
   *
   * ── WHAT IT IS NOW ────────────────────────────────────────────────────
   * Obsidian that takes light, over a violet under-layer, wearing a fitted
   * celestial ninja harness: a sleek skullcap, a cuirass with the eclipse
   * emblem on it, small angular pauldrons, silver arm bands, shin guards, a
   * charm on the belt. Silver-white eyes with a violet centre that shimmers.
   * Three fragments that drift in and out, five motes, hairline cracks that
   * pulse, and a low distortion at the feet. That is the whole effect list,
   * and none of it is bright.
   */
  { id: 'frog_ecl_secret', name: 'The Forgotten One', rarity: 'secret', set: 'eclipse',
    secret: true,
    skin: ECL.obsidian,
    belly: 0x2b2743,
    cloth: 0x100f18,
    scarf: ECL.violet,
    fx: {
      eclipse: true,
      obsidian: ECL.plate,
      silver: ECL.silver,
      energy: ECL.energy,
      /**
       * A hair of self-light so the shadowed side never falls to pure
       * black. This is what keeps the form readable at dusk and indoors —
       * without it the skin is legible only where the sun happens to be.
       */
      emissive: 0x08070f,
    } },
];

/** Catalog lookup by the same keys the Economy stores unlocks under. */
export const CATALOG = {
  swords: SWORD_SKINS,
  kunai: KUNAI_SKINS,
  frogs: FROG_SKINS,
};

/** The default each category falls back to; always owned. */
export const DEFAULT_SKIN = {
  swords: 'sword_default',
  kunai: 'kunai_default',
  frogs: 'frog_default',
};

export function findSkin(kind, id) {
  const list = CATALOG[kind];
  if (!list) return null;
  return list.find((s) => s.id === id) || list.find((s) => s.id === DEFAULT_SKIN[kind]) || list[0];
}

// ---------------------------------------------------------------- crates

/**
 * ═══ THE CASES ══════════════════════════════════════════════════════════
 *
 * Three SETS of three: a case per category per set. `set` is what scopes the
 * pool — a Swampforged case can only ever hand you swamp gear — which is the
 * whole reason the sets are worth buying separately. Without it every case
 * of a kind would draw from the same growing soup and adding a set would
 * only ever DILUTE what the older ones drop.
 *
 * `anim` picks the opening sequence. See `_openCrate` in js/shop.js: the base
 * cases just spin the reel, the swamp one cracks and gasses, the celestial
 * one lifts off the ground.
 */
export const CRATES = [
  // ── the standard cases ──────────────────────────────────────────────
  {
    id: 'crate_kunai', kind: 'kunai', set: 'base', price: 1800,
    name: 'Common Kunai Case',
    blurb: 'Nine blades. Nine ways to miss.',
    color: '#c0392b',
  },
  {
    id: 'crate_sword', kind: 'swords', set: 'base', price: 2800,
    name: 'Common Sword Case',
    blurb: 'Steel for the frog who takes their duels seriously.',
    color: '#5f9ec4',
  },
  {
    id: 'crate_frog', kind: 'frogs', set: 'base', price: 3600,
    name: 'Common Frog Case',
    blurb: 'A whole new you. Same terrible habits.',
    color: '#4e9a3c',
  },
  // ── Swampforged: wood, chipped iron, poison ─────────────────────────
  {
    id: 'crate_swamp_kunai', kind: 'kunai', set: 'swamp', price: 2000,
    name: 'Swampforged Kunai Case',
    blurb: 'Nine blades pulled out of the mire. Two of them still drip.',
    color: '#6ac02a', anim: 'swamp',
  },
  {
    id: 'crate_swamp_sword', kind: 'swords', set: 'swamp', price: 3000,
    name: 'Swampforged Sword Case',
    blurb: 'Rotwood to royalty. Everything in here was forged in a bog.',
    color: '#7aa84a', anim: 'swamp',
  },
  {
    id: 'crate_swamp_frog', kind: 'frogs', set: 'swamp', price: 4500,
    name: 'Bogswamp Crate',
    blurb: 'Nine frogs out of the wetlands, up to and including their king.',
    color: '#4a7a3a', anim: 'swamp',
  },
  /**
   * ── Celestial Forge: the upgrade ──────────────────────────────────
   *
   * Not swamp iron — heavenly metal, the same stuff the heaven levels are
   * built out of. Priced above everything else and worth it: NO CASE IN
   * THIS SET CAN ROLL A COMMON. Its floor is Uncommon, which multiplies
   * every tier above it (see the note on RARITY), and one item in it is
   * Mythic — the only Mythic in the game.
   */
  {
    id: 'crate_sky_kunai', kind: 'kunai', set: 'celestial', price: 4200,
    name: 'Celestial Kunai Case',
    blurb: 'Dark metal and starlight. Nothing common has ever been in one.',
    color: '#7fbcff', anim: 'celestial',
  },
  {
    id: 'crate_sky_sword', kind: 'swords', set: 'celestial', price: 5600,
    name: 'Celestial Sword Case',
    blurb: 'Nine blades of heavenly metal — and one that is not quite a blade.',
    color: '#8fd8ff', anim: 'celestial',
  },
  {
    id: 'crate_sky_frog', kind: 'frogs', set: 'celestial', price: 6600,
    name: 'Celestial Forge Crate',
    blurb: 'Ancient gold, blue fire, and the rarest frog anybody owns.',
    color: '#ffd24a', anim: 'celestial',
  },
  /**
   * ── THE ECLIPSE COLLECTION ────────────────────────────────────────
   *
   * Three crates that are meant to be opened as a SET. Each hides one ???
   * at 0.03%, the three of them are pieces of the same thing, and owning
   * all three is the only way to the title — see `eclipseFound`.
   */
  {
    id: 'crate_ecl_kunai', kind: 'kunai', set: 'eclipse', price: 3100,
    name: 'Eclipse Kunai Crate',
    blurb: 'Nine blades cut from the dark. One of them is not a blade.',
    color: '#a87aff', anim: 'eclipse',
  },
  {
    id: 'crate_ecl_sword', kind: 'swords', set: 'eclipse', price: 4100,
    name: 'Eclipse Sword Crate',
    blurb: 'Nightsteel, void and corona — and something with no name yet.',
    color: '#8f6aff', anim: 'eclipse',
  },
  {
    id: 'crate_ecl_frog', kind: 'frogs', set: 'eclipse', price: 5000,
    name: 'Forbidden Frog Crate',
    blurb: 'An old power nobody was supposed to dig back up.',
    color: '#ffb43a', anim: 'eclipse',
  },
];

/**
 * ═══ THE ECLIPSE, THE FOURTH SECRET ═══════════════════════════════════
 *
 * The three ??? items, and the title you get for holding all three.
 *
 * DERIVED, never stored. A flag saved alongside them could drift out of
 * step with the collection it describes — the honest answer to "have they
 * found the Eclipse" is "do they own these three", asked fresh every time.
 */
/**
 * ═══ THE FIVE COLLECTIONS ════════════════════════════════════════════════
 *
 * Verdant Samurai, Frostveil, Emberborn, Dragon Ascension and Divine Sun —
 * fifteen cases, a hundred and fifty skins, and one shape between them:
 *
 *   2 Common · 2 Uncommon · 2 Rare · 1 Epic · 1 Legendary · 1 Mythic · 1 ???
 *
 * ── why these are built rather than written out ───────────────────────
 * The sets above this line are hand-written because each one is a handful
 * of items with their own ideas. A hundred and fifty literals is a
 * different problem: the thing that matters about them is the LADDER — that
 * a Rare visibly out-dresses an Uncommon, and does so the same way in every
 * collection — and a ladder is exactly what you cannot see in a wall of
 * hex. Written as a table, the progression is the code.
 *
 * A collection supplies five colours and thirty names. The tier decides
 * everything else, identically across all five, so a Frostveil Epic and an
 * Emberborn Epic wear the same amount of armour in different weather.
 */
const COLLECTIONS = [
  {
    id: 'verdant', name: 'Verdant Samurai', color: '#6aa832',
    price: { frogs: 6000, swords: 4500, kunai: 3000 },
    // dark, mid, light, accent, glow
    pal: [0x1f3a1a, 0x4e7a34, 0x8fc44a, 0xc9d98f, 0x9cff6b],
    blurb: 'Bamboo, moss and old jade. Everything in here grew before it '
      + 'was forged.',
    swords: ['Bamboo Blade', 'Moss Katana', 'Jade Edge', 'Forest Fang',
      'Ronin Blade', 'Verdant Katana', 'Warden Blade', 'Jade Reaver',
      "Shogun's Blade", 'Whisperleaf'],
    kunai: ['Bamboo Kunai', 'Moss Kunai', 'Jade Kunai', 'Forest Kunai',
      'Ronin Kunai', 'Verdant Fang', 'Warden Kunai', 'Jade Shard',
      'Shogun Kunai', "The Sage's Needle"],
  },
  {
    id: 'frost', name: 'Frostveil', color: '#8fd8ff',
    price: { frogs: 7500, swords: 5500, kunai: 4000 },
    pal: [0x2a4a66, 0x6a9ec4, 0xbfe4ff, 0xe8f6ff, 0x8ff0ff],
    blurb: 'Nine things out of the deep winter, and one that was already '
      + 'there when it arrived.',
    swords: ['Frost Blade', 'Ice Katana', 'Snowfang', 'Frozen Edge',
      'Glacier Fang', 'Crystal Blade', 'Frost Reaper', "Winter's Edge",
      "Emperor's Frost", 'Heartfrost'],
    kunai: ['Snow Kunai', 'Frost Kunai', 'Ice Fang', 'Frozen Kunai',
      'Glacier Kunai', 'Crystal Shard', 'Winter Fang', 'Frost Reaper',
      "Emperor's Kunai", 'Stillfrost'],
  },
  {
    id: 'ember', name: 'Emberborn', color: '#ff8a3c',
    price: { frogs: 9000, swords: 7000, kunai: 5000 },
    pal: [0x3a1a10, 0x8a3a1e, 0xff8a3c, 0xffca4a, 0xff6a2a],
    blurb: 'Ash, cinder and the things that walk out of a fire still '
      + 'burning.',
    swords: ['Ash Blade', 'Ember Katana', 'Cinder Edge', 'Flamefang',
      'Magma Blade', 'Inferno Katana', 'Ember Reaper', 'Volcanic Fang',
      'Inferno Shogun Blade', 'Cinderheart'],
    kunai: ['Ash Kunai', 'Ember Kunai', 'Cinder Kunai', 'Flame Fang',
      'Magma Kunai', 'Inferno Kunai', 'Ember Shard', 'Volcanic Fang',
      'Inferno Kunai', 'Ashfall'],
  },
  {
    id: 'dragon', name: 'Dragon Ascension', color: '#d94a4a',
    price: { frogs: 10500, swords: 8500, kunai: 6500 },
    pal: [0x3a0f14, 0x9c2430, 0xd94a4a, 0xd8ad2e, 0xffb03c],
    blurb: 'Scale, bone and gold. The ladder here ends somewhere that was '
      + 'never a frog.',
    swords: ['Scale Blade', 'Dragon Fang', 'Crimson Edge', 'Wyrm Katana',
      'Dragonbone Blade', 'Elder Fang', 'Dragon Reaver', 'Imperial Dragon',
      "Dragon Emperor's Fang", 'Wyrmheart'],
    kunai: ['Scale Kunai', 'Dragon Kunai', 'Crimson Fang', 'Wyrm Kunai',
      'Dragonbone Kunai', 'Elder Kunai', 'Dragon Shard', 'Imperial Fang',
      'Dragon Emperor Kunai', 'Wyrmscale'],
  },
  {
    id: 'sun', name: 'Divine Sun', color: '#ffd76b',
    price: { frogs: 12000, swords: 10000, kunai: 8000 },
    pal: [0x5a4408, 0xb89a4a, 0xffd76b, 0xfff3c4, 0xffe08a],
    blurb: 'The most expensive case in the shop, and the brightest thing '
      + 'in it does not set.',
    swords: ['Sunsteel Blade', 'Dawn Katana', 'Solar Edge', 'Golden Fang',
      'Sun Guardian', 'Celestial Blade', "Heaven's Reaver", 'Divine Edge',
      'Sword of the Sun', 'Daybreaker'],
    kunai: ['Sunlit Kunai', 'Dawn Kunai', 'Solar Kunai', 'Golden Fang',
      'Sun Shard', 'Celestial Kunai', "Heaven's Kunai", 'Divine Shard',
      'Kunai of the Sun', 'Sunfall'],
  },
];

/**
 * The ladder every collection climbs. Ten rungs, and the tier is the rung.
 *
 * `pal` is the collection's five colours — dark, mid, light, accent, glow —
 * and each rung says which of them to use and what the frog is WEARING. The
 * escalation is deliberately the same in all five so a player who has
 * learned to read one case can read the other fourteen.
 */
const TIER_LADDER = [
  'common', 'common', 'uncommon', 'uncommon', 'rare', 'rare',
  'epic', 'legendary', 'mythic', 'secret',
];

/** Darken or lighten a hex by a factor, staying inside 0..255 per channel. */
function shade(hex, k) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/**
 * ═══ THE FIFTY FROGS, ONE CONCEPT AT A TIME ══════════════════════════════
 *
 * The swords and the kunai below are still generated from a ladder, because
 * a katana is a katana and what changes up its tiers is genuinely its
 * material and its shape. A FROG is a person. Generating fifty of them from
 * one escalation produced exactly what you would expect: the same frog
 * wearing slightly more of the same armour in five weathers, which is the
 * complaint this table exists to answer.
 *
 * So every rung is written out, and every rung is somebody:
 *
 *   Common      ordinary clothes. No effects at all. This is the floor the
 *               whole collection is measured against, and it has to be a
 *               villager rather than a lesser warrior.
 *   Uncommon    a trade, and the gear that goes with it — a hood, a satchel,
 *               a set of plates. Recognisable at ten paces.
 *   Rare        armour with an idea in it, and the first glowing anything.
 *   Epic        a different silhouette. Horns, bulk, a shield.
 *   Legendary   the outline changes again and the light starts to come from
 *               INSIDE the frog rather than off it.
 *   Mythic      royalty. A crown, a halo, and something in orbit.
 *   ???         nothing else in the game looks like it. See the notes on
 *               each one — they are the only skins here with an argument
 *               attached rather than a description.
 *
 * `fx` keys are the shared cosmetic vocabulary in js/frog.js. Everything
 * used here is something a builder actually reads; test_crates checks that
 * claim for every skin in the game, which is how `embers` was caught sitting
 * dead in two Legendaries for months.
 */
const FROG_CONCEPTS = {
  // ── 🌿 VERDANT SAMURAI — nature, and the very old things in it ────────
  verdant: [
    { name: 'Mushroom Hopper', skin: 0x6f8f4a, belly: 0xd8d0a8, cloth: 0x6b4f33,
      scarf: 0xc4694a, fx: {} },
    { name: 'River Fisher', skin: 0x7aa04e, belly: 0xdfe0b0, cloth: 0x4a6b7a,
      scarf: 0xe8dcc0, fx: {} },
    // Woven bamboo over a monk's robe: plates the colour of dry cane.
    { name: 'Bamboo Monk', skin: 0x6f9445, belly: 0xd8d8a8, cloth: 0xc9b978,
      scarf: 0xb8863c, fx: { plates: 0xc9b978, pattern: 0x8a6a2a, moss: 0x6f9445 } },
    // The cloak IS the skin. A hood and a pair of leaf ears off the cheeks.
    { name: 'Leafcloak Scout', skin: 0x5c8a3a, belly: 0xc4d8a0, cloth: 0x2f4a20,
      scarf: 0x8fc44a, fx: { hood: 0x3f6b28, fins: true } },
    { name: 'Thornback', skin: 0x46613a, belly: 0xa8b894, cloth: 0x2a3a22,
      scarf: 0x6b4f33, fx: { plates: 0x4a3a28, spikes: 6, horns: 2 } },
    // The lantern is the light: a warm glow off the belt, nothing else lit.
    { name: 'Lantern Keeper', skin: 0x4e7a34, belly: 0xc8cfa0, cloth: 0x35301f,
      scarf: 0xffb347, fx: { hood: 0x2f4a20, pattern: 0xffb347, eyeGlow: 0xffd76b } },
    // Ancient tree, worn as armour, with the roots still attached to it.
    { name: 'Giantwood Guardian', skin: 0x3f4f2e, belly: 0x9aa878, cloth: 0x2a2a1a,
      scarf: 0x6b5a2a, fx: {
        plates: 0x5a4630, moss: 0x5f8f3a, spikes: 5, shield: 0x4a3a24,
        emissive: 0x1a2410,
      } },
    /**
     * Translucent, lit from within, and trailing the leaves it left behind.
     *
     * The leaves are `stars`, not `orbit`. An orbit is the top-tier tell —
     * a ring of fragments turning round a frog means Mythic or ???, and it
     * only means that while nothing below carries it. `stars` gives the
     * same drifting motes without spending the signal, which matters more
     * here than on any other skin: this one sits directly under the Ancient
     * King of Roots, and the two have to be distinguishable at a glance.
     */
    { name: 'Spirit of the Grove', skin: 0x7fd8a0, belly: 0xdfffe8, cloth: 0x2a4a38,
      scarf: 0xbfffd0, fx: {
        aura: 0x7fffb0, pattern: 0xbfffd0, eyeGlow: 0xdfffe8, stars: 0x8fe0a0,
        embers: 0xbfffd0, emissive: 0x1a3a26, fins: true,
      } },
    // Royal, and made of the forest rather than dressed in it.
    { name: 'Ancient King of Roots', skin: 0x35301f, belly: 0xa8a070, cloth: 0x201c12,
      scarf: 0xc9a227, fx: {
        crown: 2.0, plates: 0x5a4630, moss: 0x4e7a34, pattern: 0xc9d98f,
        eyeGlow: 0xc9ff6b, halo: 0xc9d98f, stars: 0xc9d98f,
        orbit: 0x8fc44a, orbitN: 9, spikes: 6, emissive: 0x1a1a0e,
      } },
    /**
     * ── ??? THE FORGOTTEN GROVE ───────────────────────────────────────
     *
     * It is not a frog in armour. The roots grew around it and became the
     * shape — `wings` is what carries that, torn and bark-coloured, so the
     * OUTLINE is wrong before you have read anything on it. Bark orbits it,
     * and the eyes are two stars a very long way down a dark hole.
     */
    { name: 'The Forgotten Grove', skin: 0x1e2416, belly: 0x6f7a52, cloth: 0x12160d,
      scarf: 0x3a4a22, secret: true, fx: {
        wings: 0x4a3a26, wingGlow: 0x9cff6b, wingsTorn: true, wingSpan: 1.15,
        moss: 0x3f6b28, orbit: 0x6b5a3a, orbitN: 11, stars: 0xdfffe8,
        eyeGlow: 0xffffff, pattern: 0x9cff6b, emissive: 0x0e1408,
        horns: 4, spikes: 6,
      } },
  ],

  // ── ❄️ FROSTVEIL — a whole frozen civilisation ───────────────────────
  frost: [
    { name: 'Snowbound Traveller', skin: 0x8aa4b8, belly: 0xe4eef6, cloth: 0x3f5060,
      scarf: 0xc44a4a, fx: {} },
    { name: 'Ice Fisher', skin: 0x7f9aae, belly: 0xdfe8f2, cloth: 0x5a4a38,
      scarf: 0xb8a078, fx: {} },
    // The coat, and the bottles clinking on the belt.
    { name: 'Winter Apothecary', skin: 0x8fa8bc, belly: 0xe8f0f8, cloth: 0x2f3f52,
      scarf: 0x6fc4a8, fx: { hood: 0x2a3848, pattern: 0x8ff0c4 } },
    { name: 'Frost Nomad', skin: 0x93a6b6, belly: 0xe0ebf4, cloth: 0x4a4038,
      // Snow blowing off the layers, where the Sky Nomad has stitching.
      scarf: 0xcfb894, fx: { hood: 0x6a5a48, fins: true, embers: 0xe8f4ff } },
    // Ice worked like metal: polished plate and a slab of a shield.
    { name: 'Glacier Knight', skin: 0x6a9ec4, belly: 0xdff0ff, cloth: 0x2a4a66,
      scarf: 0xbfe4ff, fx: {
        plates: 0x9fd4ef, shield: 0x7fc0e8, pattern: 0xe8f6ff, spikes: 3,
      } },
    // The aurora is the costume. Nothing on it is solid.
    { name: 'Aurora Dancer', skin: 0x5a7fae, belly: 0xd8e8ff, cloth: 0x2a2f52,
      scarf: 0x8fffd8, fx: {
        pattern: 0x8fffd8, aura: 0x6affc4, stars: 0xdfffff, eyeGlow: 0x8ff0ff,
      } },
    { name: 'Frozen Colossus', skin: 0x4a6a86, belly: 0xbcd8ea, cloth: 0x22384a,
      scarf: 0x8fc4e4, fx: {
        plates: 0xa8dcf4, spikes: 6, horns: 2, emissive: 0x12303f,
        shield: 0x88c4e0,
      } },
    // Almost not there, and it brings its own weather with it.
    { name: 'Whiteout Revenant', skin: 0xc8d8e4, belly: 0xffffff, cloth: 0xa8bccc,
      scarf: 0xffffff, fx: {
        plates: 0xe8f4ff, aura: 0xffffff, embers: 0xffffff,
        eyeGlow: 0xbfe4ff, pattern: 0xffffff, emissive: 0x6a8ca8,
      } },
    { name: 'Crown of Winter', skin: 0x2f4f6e, belly: 0xcfe8ff, cloth: 0x1a2f44,
      scarf: 0xe8f6ff, fx: {
        crown: 2.0, plates: 0xbfe4ff, halo: 0xe8f6ff, halo2: true,
        orbit: 0xbfe4ff, orbitN: 9, stars: 0xffffff, eyeGlow: 0x8ff0ff,
        spikes: 6, emissive: 0x18384f,
      } },
    /**
     * ── ??? THE LAST WINTER ───────────────────────────────────────────
     *
     * Black and white, and the snow around it has stopped.
     *
     * `orbit` is doing the work: eleven pale fragments held in a ring that
     * turns very slowly, so from a distance they read as flakes hanging in
     * the air rather than as an effect playing. Everything else on it is
     * deliberately colourless — it is the only skin in the game with no hue
     * at all, and that is most of why it is recognisable.
     */
    { name: 'The Last Winter', skin: 0x1a1a1e, belly: 0xf4f4f6, cloth: 0x0e0e12,
      scarf: 0xffffff, secret: true, fx: {
        orbit: 0xffffff, orbitN: 11, stars: 0xffffff, embers: 0xdfe8f0,
        eyeGlow: 0xffffff, pattern: 0xffffff, plates: 0x2a2a30,
        emissive: 0x0a0a0e, spikes: 6, horns: 2,
      } },
  ],

  // ── 🔥 EMBERBORN — several different kinds of fire ───────────────────
  ember: [
    { name: 'Campfire Cook', skin: 0x8a6a4a, belly: 0xdcc8a8, cloth: 0xb84a2a,
      scarf: 0xe8dcc0, fx: {} },
    { name: 'Coal Miner', skin: 0x5a5048, belly: 0xa89880, cloth: 0x3a342c,
      scarf: 0xffb347, fx: {} },
    { name: 'Ash Wanderer', skin: 0x7a7268, belly: 0xc4bcb0, cloth: 0x4a443c,
      scarf: 0x9a9088, fx: { hood: 0x5a544c, pattern: 0xa89c8c, embers: 0xb8aca0 } },
    { name: 'Forge Apprentice', skin: 0x8a5a3a, belly: 0xd8b890, cloth: 0x3a2a1e,
      scarf: 0xc4884a, fx: { plates: 0x7a6a5a, pattern: 0xffb347, shield: 0x5a4a3a } },
    // The armour is old and the cracks in it are lit.
    { name: 'Flame Ronin', skin: 0x6a3020, belly: 0xc48a5a, cloth: 0x2a1810,
      scarf: 0xff8a3c, fx: {
        plates: 0x5a3020, pattern: 0xff8a3c, eyeGlow: 0xffca4a,
        emissive: 0x3a1206,
      } },
    { name: 'Magma Smith', skin: 0x7a3a1e, belly: 0xd09060, cloth: 0x2a1a12,
      scarf: 0xffca4a, fx: {
        plates: 0x4a4038, pattern: 0xff6a2a, embers: 0xffb347,
        eyeGlow: 0xff8a3c, shield: 0x5a4a3a, emissive: 0x3f1608,
      } },
    // Stops being a person. Horns, bulk and volcanic rock.
    // Actually alight, which is what separates it from the Elder Wyrm —
    // the two are otherwise the same idea of "horned thing in old plate".
    { name: 'Infernal Beast', skin: 0x4a1c12, belly: 0x9a5a3a, cloth: 0x1e0c08,
      scarf: 0xff6a2a, fx: {
        horns: 4, spikes: 6, plates: 0x3a2018, eyeGlow: 0xffca4a,
        pattern: 0xff6a2a, emissive: 0x4a1204, embers: 0xff8a3c,
      } },
    // Stone on the outside, and something molten moving under it.
    { name: 'Living Volcano', skin: 0x3a342e, belly: 0x8a6a52, cloth: 0x201c18,
      scarf: 0xff8a3c, fx: {
        plates: 0x4a443c, pattern: 0xff4a1a, embers: 0xff8a3c,
        aura: 0xff6a2a, eyeGlow: 0xffca4a, spikes: 5, emissive: 0x5a1a04,
      } },
    { name: 'Cinder Sovereign', skin: 0x2f221c, belly: 0xa87a58, cloth: 0x18100c,
      scarf: 0xffca4a, fx: {
        crown: 2.0, plates: 0x4a3028, halo: 0xff8a3c, orbit: 0xffca4a,
        orbitN: 9, embers: 0xff8a3c, pattern: 0xffca4a, eyeGlow: 0xffe08a,
        spikes: 6, horns: 2, emissive: 0x5a1c04,
      } },
    /**
     * ── ??? THE FIRST FLAME ───────────────────────────────────────────
     *
     * Dormant, and then you notice the cracks.
     *
     * Deliberately NO `aura` and no orbit. This is the one skin in the game
     * that is defined by what it does NOT have: a body of nearly black
     * material, a handful of embers, and a pattern colour so bright it is
     * effectively white — so the only light on it comes out of the seams.
     * A big flaming shell around it would make it the same as the Cinder
     * Sovereign with a different hat.
     */
    { name: 'The First Flame', skin: 0x14100e, belly: 0x3a2a22, cloth: 0x0a0806,
      scarf: 0x2a1c14, secret: true, fx: {
        pattern: 0xfff4d0, eyeGlow: 0xffffff, embers: 0xffb347,
        plates: 0x1a1512, emissive: 0x6a1c00,
      } },
  ],

  // ── 🐉 DRAGON ASCENSION — five different dragon cultures ─────────────
  dragon: [
    { name: 'Dragon Egg Keeper', skin: 0x7a8a5a, belly: 0xd8d0a0, cloth: 0x5a4a30,
      scarf: 0xc4a05a, fx: {} },
    { name: 'Mountain Rider', skin: 0x6a7a8a, belly: 0xc8d0d8, cloth: 0x4a3a2a,
      scarf: 0x9c2430, fx: {} },
    { name: 'Scale Hunter', skin: 0x7a6a4a, belly: 0xc8b890, cloth: 0x3a2a20,
      scarf: 0xd94a4a, fx: { plates: 0x8a5a3a, pattern: 0xd8ad2e, spikes: 3 } },
    { name: 'Sky Nomad', skin: 0x8ab0c4, belly: 0xdfeef6, cloth: 0x4a5a6a,
      scarf: 0xe8c86a, fx: { hood: 0x3a4a5a, fins: true, pattern: 0xbfe4ff } },
    // Western: plate, a shield and a pair of helm horns.
    { name: 'Drake Knight', skin: 0x5a6068, belly: 0xb8bcc4, cloth: 0x2a2e34,
      scarf: 0x9c2430, fx: {
        plates: 0x8a9098, shield: 0x9c2430, horns: 2, pattern: 0xd8ad2e,
      } },
    // Eastern: robes, beads, and a serpent worked into the cloth.
    { name: 'Serpent Monk', skin: 0x8a3a3a, belly: 0xe0c090, cloth: 0x5a1a1a,
      scarf: 0xd8ad2e, fx: {
        hood: 0x6a2020, pattern: 0xd8ad2e, eyeGlow: 0xffb03c, fins: true,
      } },
    // A third culture entirely: dragon technology, and it is powered.
    { name: 'Storm Dragon Rider', skin: 0x3a4a6a, belly: 0xa8c4e4, cloth: 0x1e2838,
      scarf: 0x8fd8ff, fx: {
        plates: 0x5a6a8a, pattern: 0x8fd8ff, eyeGlow: 0xdfffff,
        aura: 0x6ab0ff, spikes: 5, emissive: 0x16243a,
      } },
    { name: 'Elder Wyrm', skin: 0x4a2a24, belly: 0xa87a58, cloth: 0x241410,
      scarf: 0x9c2430, fx: {
        horns: 4, spikes: 6, plates: 0x6a4a34, pattern: 0xd8ad2e,
        eyeGlow: 0xffb03c, emissive: 0x2a1008,
      } },
    { name: 'Dragon Throne', skin: 0x3a0f14, belly: 0xc49060, cloth: 0x1e080c,
      scarf: 0xd8ad2e, fx: {
        crown: 2.0, plates: 0x8a2430, halo: 0xd8ad2e, orbit: 0xffb03c,
        orbitN: 9, stars: 0xffd76b, pattern: 0xd8ad2e, eyeGlow: 0xffca4a,
        spikes: 6, horns: 2, emissive: 0x3a0a0e,
      } },
    /**
     * ── ??? THE NAMELESS WYRM ─────────────────────────────────────────
     *
     * No wings and no neon, which were both asked for by name.
     *
     * What it has instead is `pattern` over a nearly black hide and four
     * heavy horns — markings that read as something moving under the skin
     * rather than as paint on it. It is the quietest ??? in the game on
     * purpose: everything else at this tier announces itself, and this one
     * is recognised rather than noticed.
     */
    { name: 'The Nameless Wyrm', skin: 0x16141a, belly: 0x4a4038, cloth: 0x0c0a0e,
      scarf: 0x6a3a2a, secret: true, fx: {
        pattern: 0xc49a4a, eyeGlow: 0xffb03c, emissive: 0x1a0c06,
        horns: 4, spikes: 6, plates: 0x22202a, stars: 0xd8ad2e,
      } },
  ],

  // ── ☀️ DIVINE SUN — civilisations that worshipped it ─────────────────
  sun: [
    { name: 'Dawn Pilgrim', skin: 0xa89a6a, belly: 0xe8dcb0, cloth: 0xc4b48a,
      scarf: 0xd8ad2e, fx: {} },
    { name: 'Sun Temple Servant', skin: 0xb8a878, belly: 0xf0e4c0, cloth: 0xe8dcc0,
      scarf: 0xc9a227, fx: {} },
    { name: 'Solar Scholar', skin: 0xa89858, belly: 0xefe0b0, cloth: 0x8a7a4a,
      scarf: 0xffd76b, fx: { hood: 0x7a6a3a, pattern: 0xffd76b, stars: 0xffe08a } },
    { name: 'Golden Courier', skin: 0xc4a84a, belly: 0xfff0c8, cloth: 0x6a5420,
      scarf: 0xffe08a, fx: { pattern: 0xffe08a, fins: true } },
    // The sword is the radiant part, so the eyes catch it and nothing else
    // does — which is also what keeps it off the Glacier Knight's design.
    { name: 'Sunblade Knight', skin: 0xdfd8c0, belly: 0xfffaf0, cloth: 0x8a7430,
      scarf: 0xffd76b, fx: {
        plates: 0xfff3c4, shield: 0xd8ad2e, pattern: 0xffd76b,
        eyeGlow: 0xffffff,
      } },
    { name: 'Solar Priest', skin: 0xc8b070, belly: 0xfff0c8, cloth: 0xe8d8a0,
      scarf: 0xffd76b, fx: {
        hood: 0xd8c488, stars: 0xffe08a, pattern: 0xffd76b, eyeGlow: 0xfff3c4,
      } },
    { name: 'Daystar Guardian', skin: 0xb89a4a, belly: 0xffeeb8, cloth: 0x6a5420,
      scarf: 0xfff3c4, fx: {
        plates: 0xe8c86a, pattern: 0xfff3c4, eyeGlow: 0xffffff,
        aura: 0xffd76b, spikes: 5, shield: 0xd8ad2e, emissive: 0x5a4408,
      } },
    /**
     * Half of it is in daylight and half of it is not. The palette does
     * that — a dark hide under gold plate, with the light reading as
     * coming from one side only.
     */
    { name: 'Eclipse Monarch', skin: 0x20202a, belly: 0xffeeb8, cloth: 0x12121a,
      scarf: 0xffd76b, fx: {
        crown: 1.6, plates: 0xd8ad2e, halo: 0xfff3c4, pattern: 0xffd76b,
        eyeGlow: 0xfff3c4, aura: 0x6a5aa8, emissive: 0x2a2060, spikes: 5,
      } },
    { name: 'Celestial Emperor', skin: 0xdfd0a0, belly: 0xfffaf0, cloth: 0x8a7430,
      scarf: 0xfff3c4, fx: {
        crown: 2.0, plates: 0xffe08a, halo: 0xfff3c4, halo2: true,
        orbit: 0xffd76b, orbitN: 12, stars: 0xffffff, pattern: 0xfff3c4,
        eyeGlow: 0xffffff, aura: 0xffd76b, emissive: 0x6a5408,
      } },
    /**
     * ── ??? THE ONE WHO SAW THE SUN ───────────────────────────────────
     *
     * A piece of a dying star, in a frog.
     *
     * The body is the darkest thing in the collection and the core is the
     * brightest thing in the game — `emissive` carries that, and the orbit
     * is only five fragments so it reads as something coming APART rather
     * than as a crown of light. The contrast is the whole design: it stands
     * next to the Celestial Emperor and is obviously not more of the same.
     */
    { name: 'The One Who Saw the Sun', skin: 0x120e08, belly: 0x5a4a20, cloth: 0x080604,
      scarf: 0xfff3c4, secret: true, fx: {
        emissive: 0x8a6a00, pattern: 0xffffff, eyeGlow: 0xffffff,
        orbit: 0xfff3c4, orbitN: 5, stars: 0xffffff, embers: 0xffd76b,
        plates: 0x1a1610, aura: 0xffe08a,
      } },
  ],
};

/**
 * The frog at rung `i` of a collection — read from FROG_CONCEPTS.
 *
 * Everything except the id and the rarity is written out per skin. See the
 * note on the table for why a frog cannot be generated the way a katana can.
 */
function collectionFrog(c, i) {
  const spec = FROG_CONCEPTS[c.id][i];
  const s = {
    id: `frog_${c.id}_${i}`, name: spec.name, rarity: TIER_LADDER[i], set: c.id,
    skin: spec.skin, belly: spec.belly, cloth: spec.cloth, scarf: spec.scarf,
    fx: spec.fx,
  };
  if (spec.secret) s.secret = true;
  return s;
}
/** The sword at rung `i`. Shape climbs, then the blade starts to glow. */
function collectionSword(c, i) {
  const [dark, mid, light, accent, glow] = c.pal;
  const rarity = TIER_LADDER[i];
  const SHAPE = ['katana', 'katana', 'curved', 'curved', 'serrated',
    'serrated', 'broad', 'broad', 'light', 'light'];
  const TSUBA = ['disc', 'square', 'disc', 'cross', 'square',
    'cross', 'ring', 'ring', 'ring', 'ring'];
  const fx = { shape: SHAPE[i], tsuba: TSUBA[i] };
  if (i >= 3) fx.tassel = accent;
  if (i >= 4) fx.runes = glow;
  if (i >= 6) fx.aura = glow;
  if (i >= 7) { fx.glow = true; fx.long = 1.15; }
  if (i >= 8) fx.long = 1.3;
  if (i === 9) { fx.orbit = glow; fx.orbitN = 3; }
  const s = {
    id: `sword_${c.id}_${i}`, name: c.swords[i], rarity, set: c.id,
    blade: shade(light, 0.8 + i * 0.03),
    edge: i >= 7 ? accent : shade(light, 1.1),
    guard: i >= 6 ? accent : shade(mid, 0.9),
    grip: shade(dark, 0.8),
    glow: shade(glow, 0.5 + i * 0.06),
    fx,
  };
  if (rarity === 'secret') s.secret = true;
  return s;
}

/** The kunai at rung `i`. The cheapest of the three, and the plainest. */
function collectionKunai(c, i) {
  const [dark, mid, light, accent, glow] = c.pal;
  const rarity = TIER_LADDER[i];
  const SHAPE = ['classic', 'classic', 'needle', 'needle', 'broad',
    'broad', 'crystal', 'crystal', 'star', 'star'];
  const fx = { shape: SHAPE[i] };
  if (i >= 4) fx.ribbon = accent;
  if (i >= 6) fx.glow = true;
  if (i >= 8) fx.big = 1.2;
  const s = {
    id: `kunai_${c.id}_${i}`, name: c.kunai[i], rarity, set: c.id,
    blade: shade(mid, 0.7 + i * 0.05),
    facet: shade(light, 0.85 + i * 0.02),
    wrap: i >= 6 ? accent : shade(dark, 1.3),
    ring: shade(dark, 0.8),
    fx,
  };
  if (rarity === 'secret') s.secret = true;
  return s;
}

/**
 * Expand the table into the three catalogues and fifteen cases.
 *
 * Pushed onto the arrays above rather than kept apart, so everything that
 * already reads `FROG_SKINS` — the avatar screen, the reel, `findSkin`,
 * the dupe values, the odds display — picks these up with no idea they were
 * generated.
 */
for (const c of COLLECTIONS) {
  for (let i = 0; i < TIER_LADDER.length; i++) {
    FROG_SKINS.push(collectionFrog(c, i));
    SWORD_SKINS.push(collectionSword(c, i));
    KUNAI_SKINS.push(collectionKunai(c, i));
  }
  CRATES.push(
    {
      id: `crate_${c.id}_kunai`, kind: 'kunai', set: c.id,
      price: c.price.kunai, name: `${c.name} Kunai Case`,
      blurb: c.blurb, color: c.color,
    },
    {
      id: `crate_${c.id}_sword`, kind: 'swords', set: c.id,
      price: c.price.swords, name: `${c.name} Sword Case`,
      blurb: c.blurb, color: c.color,
    },
    {
      id: `crate_${c.id}_frog`, kind: 'frogs', set: c.id,
      price: c.price.frogs, name: `${c.name} Crate`,
      blurb: c.blurb, color: c.color,
    },
  );
}


export const ECLIPSE_SET = {
  frogs: 'frog_ecl_secret',
  swords: 'sword_ecl_secret',
  kunai: 'kunai_ecl_secret',
};

export const ECLIPSE_TITLE = 'THE ONE WHO FOUND THE ECLIPSE';

/** Which of the three somebody has, and whether that is all of them. */
export function eclipseProgress(economy) {
  const have = [];
  const missing = [];
  for (const [kind, id] of Object.entries(ECLIPSE_SET)) {
    (economy && economy.owns(kind, id) ? have : missing).push(id);
  }
  return { have: have.length, total: 3, missing, complete: missing.length === 0 };
}

export function eclipseFound(economy) {
  return eclipseProgress(economy).complete;
}

/** Every secret item, for the collection screens and the tests. */
export function secretsOf(kind) {
  return (CATALOG[kind] || []).filter((s) => s.secret);
}

export function crateById(id) { return CRATES.find((c) => c.id === id) || null; }

/** Every case that fills a given category, in shop order. */
export function cratesFor(kind) { return CRATES.filter((c) => c.kind === kind); }

/** Which set a skin belongs to. Anything unmarked is the original set. */
export function setOf(item) { return (item && item.set) || 'base'; }

/**
 * What a crate can actually contain.
 *
 * Scoped to the crate's SET, so the Celestial Forge cannot hand you a Bog
 * Frog and buying a new set never waters down an old one.
 *
 * Reward skins are filtered out here rather than at each call site, so a
 * crate can never hand you something that is supposed to be earned — and the
 * displayed odds, which read the same pool, stay honest.
 */
export function cratePool(crate) {
  const set = setOf(crate);
  return (CATALOG[crate.kind] || [])
    .filter((s) => !s.reward && setOf(s) === set);
}

/** Skins that cannot be bought — only awarded. */
export function isReward(kind, id) {
  const s = (CATALOG[kind] || []).find((x) => x.id === id);
  return !!(s && s.reward);
}

/** The pool split into tiers: `{ rare: [item, item], ... }`. */
function tiersOf(pool) {
  const tiers = {};
  for (const item of pool) (tiers[item.rarity] = tiers[item.rarity] || []).push(item);
  return tiers;
}

/**
 * ═══ WHAT EACH TIER IS ACTUALLY WORTH, IN THIS CRATE ════════════════════
 *
 * The single place the odds are decided. `rollCrate` and `crateOdds` both
 * come through here, so what the shop advertises and what the roller does
 * cannot drift apart — they are not two implementations of the same rule,
 * they are one.
 *
 * Every tier's share comes straight off `RARITY` and does not depend on how
 * many ITEMS are in it: a tier with two Legendaries in it still pays out a
 * Legendary 5% of the time, and each of the two is 2.5%. That is the
 * difference between this and the per-item anchors it replaced, and it is
 * what lets a case advertise one ladder however many skins it holds.
 *
 * ── a crate that is missing a tier ────────────────────────────────────
 * Renormalised, not deleted. The Celestial cases have no Common tier, so
 * their remaining tiers share Common's 35% in proportion — a case whose
 * floor is Uncommon genuinely UPGRADES its commons rather than quietly
 * giving that third of its probability to nothing.
 *
 * @returns `{ tier: probability }` as fractions of 1, summing to 1.
 */
function tierChances(tiers) {
  let total = 0;
  for (const r of RARITY_ORDER) if (tiers[r]) total += RARITY[r].odds;

  const out = {};
  if (total <= 0) return out;
  for (const r of RARITY_ORDER) {
    if (!tiers[r]) continue;
    out[r] = RARITY[r].odds / total;
  }
  return out;
}

/**
 * Roll one item from a crate.
 *
 * Picks a RARITY first, then an item uniformly within it. Doing it that way
 * is what makes the advertised ladder exact: the tier's slice is fixed, and
 * whatever is in it splits that slice evenly.
 */
export function rollCrate(crate, rnd = Math.random) {
  const tiers = tiersOf(cratePool(crate));
  const chance = tierChances(tiers);

  // Rolled against the ACTUAL total rather than against 1. The chances sum
  // to 1 in exact arithmetic and to a hair under it in floating point, and
  // that hair is a roll that falls off the end of the loop.
  let total = 0;
  for (const r of RARITY_ORDER) if (tiers[r]) total += chance[r];

  let roll = rnd() * total;
  for (const r of RARITY_ORDER) {
    if (!tiers[r]) continue;
    roll -= chance[r];
    if (roll <= 0) {
      const group = tiers[r];
      return group[Math.floor(rnd() * group.length) % group.length];
    }
  }
  // Rounding fallback: hand back the commonest thing rather than nothing.
  const first = tiers[RARITY_ORDER.find((r) => tiers[r])];
  return first[0];
}

/**
 * Roll a crate several times.
 *
 * Every roll is INDEPENDENT — no pity, no "one of these is guaranteed to be
 * good". A ten-pack is ten opens bought in one click, and it has to have the
 * same odds as ten separate clicks or the price per open would be a lie.
 */
export function rollMany(crate, n, rnd = Math.random) {
  const out = [];
  for (let i = 0; i < Math.max(1, n | 0); i++) out.push(rollCrate(crate, rnd));
  return out;
}

/** How many cases you may buy in one go. */
export const BULK_SIZES = [1, 3, 5, 10];

/**
 * Percentage chance of each tier present in a crate, for the odds display.
 *
 * Reads the same `tierChances` the roller does, so the shop cannot advertise
 * a number the roller does not honour. `per` is the chance of one SPECIFIC
 * item in that tier, which is the number a player chasing one thing actually
 * wants — and for the anchored tiers it is the stated headline figure.
 */
export function crateOdds(crate) {
  const tiers = tiersOf(cratePool(crate));
  const chance = tierChances(tiers);
  return RARITY_ORDER
    .filter((r) => tiers[r])
    .map((r) => ({
      rarity: r,
      pct: chance[r] * 100,
      per: (chance[r] * 100) / tiers[r].length,
    }));
}
