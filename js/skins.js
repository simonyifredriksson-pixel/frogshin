/**
 * Skins, rarities and the crates that drop them.
 *
 * Everything in the game is drawn from primitives with flat colours, so a
 * "skin" is a small palette rather than a texture. That keeps the whole
 * cosmetic system data-only: no new art files, no loading, and a skin costs
 * nothing at runtime beyond the material colours it already had.
 */

/**
 * Rarity tiers. Weights are relative and follow the familiar steep curve —
 * the top tier is deliberately rare enough to feel like an event.
 *
 * ── why the weights are RELATIVE ────────────────────────────────────────
 * `rollCrate` totals only the tiers a crate actually contains, so a crate
 * whose floor is Uncommon is genuinely better per roll rather than being a
 * commons machine with the commons deleted. That is what makes the Celestial
 * Forge worth 5,000 froglets: its worst outcome is an Uncommon, and its
 * Legendary chance is about five times the Swampforged one.
 *
 * MYTHIC exists for exactly one item — the Astral Sovereign — and at weight
 * 4 against the celestial crate's 2,012 it lands about once in five hundred
 * opens. Anything likelier would not deserve its own tier.
 */
export const RARITY = {
  common:    { id: 'common',    name: 'Common',    color: '#4b69ff', weight: 7992 },
  uncommon:  { id: 'uncommon',  name: 'Uncommon',  color: '#8847ff', weight: 1598 },
  rare:      { id: 'rare',      name: 'Rare',      color: '#d32ce6', weight: 320 },
  epic:      { id: 'epic',      name: 'Epic',      color: '#eb4b4b', weight: 64 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ffd700', weight: 26 },
  mythic:    { id: 'mythic',    name: 'Mythic',    color: '#8ffaff', weight: 4 },
  /**
   * ??? — and it stays ??? until somebody pulls one.
   *
   * Weight 3 against the Eclipse crates' 10,007 is 0.0300%, which is the
   * figure these were specified at: about one in 3,336 opens. It is not a
   * tier anything else uses, and the three items in it are the only things
   * in the game whose NAME is hidden until it is yours — see `secret` on a
   * skin and `Shop.hidden`.
   */
  secret:    { id: 'secret',    name: 'Secret',    color: '#efe6ff', weight: 3 },
};

export const RARITY_ORDER = [
  'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret',
];

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
   * THE RAREST THING THE SHOP CAN PRODUCE. About one open in five hundred.
   *
   * It gets everything: armour, a crown, a double halo, glowing hide, and
   * twelve golden fragments orbiting the frog. That last one is the tell —
   * `orbit` is on this and on one sword, and nothing else, so a frog with
   * fragments going round it is unmistakable from across the arena.
   */
  { id: 'frog_sovereign', name: 'Astral Sovereign', rarity: 'mythic', set: 'celestial',
    skin: 0x1a1e38, belly: 0xd8e0ff, cloth: 0x0d1024, scarf: 0xffd76b,
    fx: {
      plates: 0x2a3060, orbit: 0xffd76b, orbitN: 12, stars: 0xffffff,
      crown: 1.8, pattern: 0xffe98a, eyeGlow: 0xffffff, aura: 0xffd76b,
      halo: 0xfff3c4, halo2: true, horns: 4, spikes: 6, emissive: 0x2a2060,
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
  { id: 'frog_ecl_fallen', name: 'Fallen Celestial', rarity: 'mythic', set: 'eclipse',
    skin: 0x0f0d18, belly: 0xd8d0f0, cloth: 0x070610, scarf: 0xffffff,
    fx: {
      plates: 0x1a1830, embers: 0xbfa8ff, stars: 0xffffff, crown: 1.7,
      pattern: 0xffffff, eyeGlow: 0xffffff, aura: 0x7a5ad0,
      halo: 0xd8d0ff, halo2: true, horns: 4, spikes: 6, emissive: 0x1a1040,
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
    id: 'crate_kunai', kind: 'kunai', set: 'base', price: 1000,
    name: 'Common Kunai Case',
    blurb: 'Nine blades. Nine ways to miss.',
    color: '#c0392b',
  },
  {
    id: 'crate_sword', kind: 'swords', set: 'base', price: 1500,
    name: 'Common Sword Case',
    blurb: 'Steel for the frog who takes their duels seriously.',
    color: '#5f9ec4',
  },
  {
    id: 'crate_frog', kind: 'frogs', set: 'base', price: 2500,
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
    id: 'crate_sky_kunai', kind: 'kunai', set: 'celestial', price: 2500,
    name: 'Celestial Kunai Case',
    blurb: 'Dark metal and starlight. Nothing common has ever been in one.',
    color: '#7fbcff', anim: 'celestial',
  },
  {
    id: 'crate_sky_sword', kind: 'swords', set: 'celestial', price: 3500,
    name: 'Celestial Sword Case',
    blurb: 'Nine blades of heavenly metal — and one that is not quite a blade.',
    color: '#8fd8ff', anim: 'celestial',
  },
  {
    id: 'crate_sky_frog', kind: 'frogs', set: 'celestial', price: 5000,
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
    id: 'crate_ecl_kunai', kind: 'kunai', set: 'eclipse', price: 2500,
    name: 'Eclipse Kunai Crate',
    blurb: 'Nine blades cut from the dark. One of them is not a blade.',
    color: '#a87aff', anim: 'eclipse',
  },
  {
    id: 'crate_ecl_sword', kind: 'swords', set: 'eclipse', price: 3500,
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

/**
 * Roll one item from a crate.
 *
 * Picks a RARITY first by weight, then an item uniformly within it. Doing it
 * that way keeps the advertised odds exact no matter how many items sit in
 * each tier — adding a second legendary later must not double its chance.
 */
export function rollCrate(crate, rnd = Math.random) {
  const pool = cratePool(crate);
  const tiers = {};
  for (const item of pool) (tiers[item.rarity] = tiers[item.rarity] || []).push(item);

  let total = 0;
  for (const r of RARITY_ORDER) if (tiers[r]) total += RARITY[r].weight;

  let roll = rnd() * total;
  for (const r of RARITY_ORDER) {
    if (!tiers[r]) continue;
    roll -= RARITY[r].weight;
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

/** Percentage chance of each tier present in a crate, for the odds display. */
export function crateOdds(crate) {
  const pool = cratePool(crate);
  const present = new Set(pool.map((i) => i.rarity));
  let total = 0;
  for (const r of present) total += RARITY[r].weight;
  return RARITY_ORDER
    .filter((r) => present.has(r))
    .map((r) => ({ rarity: r, pct: (RARITY[r].weight / total) * 100 }));
}
