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
 */
export const RARITY = {
  common:    { id: 'common',    name: 'Common',    color: '#4b69ff', weight: 7992 },
  uncommon:  { id: 'uncommon',  name: 'Uncommon',  color: '#8847ff', weight: 1598 },
  rare:      { id: 'rare',      name: 'Rare',      color: '#d32ce6', weight: 320 },
  epic:      { id: 'epic',      name: 'Epic',      color: '#eb4b4b', weight: 64 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ffd700', weight: 26 },
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

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
 *   crown     a ring of points around the skull
 *   spikes    n spines down the back
 *   fins      cheek fins
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

export const CRATES = [
  {
    id: 'crate_kunai', kind: 'kunai', price: 1500,
    name: 'Common Kunai Case',
    blurb: 'Nine blades. Nine ways to miss.',
    color: '#c0392b',
  },
  {
    id: 'crate_sword', kind: 'swords', price: 2500,
    name: 'Common Sword Case',
    blurb: 'Steel for the frog who takes their duels seriously.',
    color: '#5f9ec4',
  },
  {
    id: 'crate_frog', kind: 'frogs', price: 5000,
    name: 'Common Frog Case',
    blurb: 'A whole new you. Same terrible habits.',
    color: '#4e9a3c',
  },
];

export function crateById(id) { return CRATES.find((c) => c.id === id) || null; }

/**
 * What a crate can actually contain.
 *
 * Reward skins are filtered out here rather than at each call site, so a
 * crate can never hand you something that is supposed to be earned — and the
 * displayed odds, which read the same pool, stay honest.
 */
export function cratePool(crate) {
  return (CATALOG[crate.kind] || []).filter((s) => !s.reward);
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
