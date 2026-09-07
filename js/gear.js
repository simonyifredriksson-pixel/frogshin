/**
 * EVERY THING YOU CAN CARRY — the realm's item database.
 *
 * Separate from `items.js` on purpose. That file owns the HOTBAR: kunai,
 * abilities, the five keys along the bottom of the screen, and the throwing
 * system behind them. This owns the BAG: swords, armour, food, materials and
 * key items, none of which existed before the overworld did.
 *
 * ── the shape of an item ───────────────────────────────────────────────────
 *   id        stable key; saves and quests refer to items by this and only
 *   name      what the player reads
 *   cat       which inventory tab it appears under (see CATS)
 *   slot      for equipment: 'weapon' | 'head' | 'body' | 'legs' | null
 *   tier      0-5, matching region tiers; drives where it is found
 *   stars     1-3, shown as pips; a rough read on quality within a tier
 *   atk/def   what equipping it adds
 *   heal      what eating it restores
 *   stack     how many fit in one slot (1 for equipment)
 *   value     froglets, for selling
 *   icon      one glyph, drawn in the slot
 *   desc      flavour, and it must say what the thing DOES if that is not
 *             obvious from the numbers
 *   swim/warm passive words shown as green tags, like the reference does
 *
 * ── why stats are additive and small ───────────────────────────────────────
 * A tier-5 sword adds 34 attack over a base of 20. That is a little under
 * three times the damage, across the whole game — deliberately flat, because
 * the bosses are hand-tuned fights with readable telegraphs and a player who
 * out-scales them by ten times is not playing them any more, they are
 * watching them fall over.
 */

/** Inventory tabs, in the order they appear along the top. */
export const CATS = [
  { id: 'weapon', name: 'Weapons', icon: '🗡' },
  { id: 'kunai', name: 'Kunai', icon: '✦' },
  { id: 'armour', name: 'Armour', icon: '🛡' },
  { id: 'food', name: 'Food', icon: '🍲' },
  { id: 'material', name: 'Materials', icon: '🌿' },
  { id: 'key', name: 'Key Items', icon: '★' },
];

const W = (id, name, tier, stars, atk, value, icon, desc, tags) =>
  ({ id, name, cat: 'weapon', slot: 'weapon', tier, stars, atk, def: 0,
     stack: 1, value, icon, desc, tags: tags || [] });
const A = (id, name, slot, tier, stars, def, value, icon, desc, tags) =>
  ({ id, name, cat: 'armour', slot, tier, stars, atk: 0, def,
     stack: 1, value, icon, desc, tags: tags || [] });
const F = (id, name, tier, heal, value, icon, desc, tags) =>
  ({ id, name, cat: 'food', slot: null, tier, stars: 1, atk: 0, def: 0,
     heal, stack: 20, value, icon, desc, tags: tags || [] });
const M = (id, name, tier, value, icon, desc) =>
  ({ id, name, cat: 'material', slot: null, tier, stars: 1, atk: 0, def: 0,
     stack: 99, value, icon, desc, tags: [] });
const K = (id, name, icon, desc) =>
  ({ id, name, cat: 'key', slot: null, tier: 0, stars: 3, atk: 0, def: 0,
     stack: 1, value: 0, icon, desc, tags: [] });

export const GEAR = [
  // ───────────────────────────────────────────────────────────── weapons ──
  W('reed-knife', 'Reed Knife', 0, 1, 2, 12, '🗡',
    'A sharpened reed. It will do until something better does.'),
  W('bronze-tanto', 'Bronze Tantō', 0, 2, 5, 40, '🗡',
    'Village work. Honest, blunt, and yours.'),
  W('mire-spear', 'Mire Spear', 1, 2, 8, 90, '🔱',
    'Longer reach than it looks. Wading is easier with something to lean on.',
    ['Reach Up']),
  W('bramble-edge', 'Bramble Edge', 1, 3, 11, 140, '🗡',
    'The teeth along the back are not decoration.'),
  W('quarry-maul', 'Quarry Maul', 2, 2, 15, 210, '🔨',
    'Slow. You will feel the wind-up in your shoulders and so will they.',
    ['Heavy']),
  W('stair-glaive', 'Stairfoot Glaive', 2, 3, 18, 280, '🔱',
    'Left leaning against the shrine for a hundred years, still sharp.',
    ['Reach Up']),
  W('gravebite', 'Gravebite', 3, 2, 22, 380, '🗡',
    'Cold to hold. Colder to be hit by.'),
  W('choir-saber', 'Choir Sabre', 3, 3, 25, 460, '🗡',
    'It hums on the backswing. The Choir taught it that.'),
  W('spine-cleaver', 'Spine Cleaver', 4, 2, 28, 620, '🪓',
    'Cut from something that was walking around a week ago.'),
  W('ember-brand', 'Ember Brand', 4, 3, 31, 760, '🗡',
    'Still warm. It has not been near a fire in years.', ['Burning']),
  W('hollow-kings-blade', "The Hollow King's Blade", 5, 3, 34, 1200, '⚔',
    'He was holding it when the city emptied. He never let go.'),
  // The only `unique` item in the game: it drops from Frogath and from
  // nothing else. See gearOfTier.
  Object.assign(W('frogshin', 'FROGSHIN', 5, 3, 30, 0, '⚔',
    'The blade the game is named for. It was always going to be yours.',
    ['Divine']), { unique: true }),

  // ────────────────────────────────────────────────────────────── armour ──
  A('reed-hood', 'Reed Hood', 'head', 0, 1, 1, 10, '🎽',
    'Keeps the sun off. Keeps very little else off.'),
  A('reed-wrap', 'Reed Wrap', 'body', 0, 1, 2, 14, '🎽',
    'What every frog in Croakhollow is wearing.'),
  A('reed-leggings', 'Reed Leggings', 'legs', 0, 1, 1, 10, '👖',
    'Two reeds and some optimism.'),

  A('mire-cowl', 'Mire Cowl', 'head', 1, 2, 3, 70, '🎽',
    'Woven to shed water. It does, mostly.', ['Swim Speed Up']),
  A('mire-mail', 'Mire Mail', 'body', 1, 2, 5, 95, '🎽',
    'Scales off something that lived in the fen.', ['Swim Speed Up']),
  A('mire-greaves', 'Mire Greaves', 'legs', 1, 2, 3, 70, '👖',
    'Wading depth stops mattering.', ['Swim Speed Up']),

  A('quarry-helm', 'Quarry Helm', 'head', 2, 2, 6, 160, '⛑',
    'Cut stone falls in the quarry. This is why the cutters still have heads.'),
  A('quarry-plate', 'Quarry Plate', 'body', 2, 3, 9, 220, '🛡',
    'Heavy enough that you will notice. Solid enough that you will be glad.'),
  A('quarry-boots', 'Quarry Boots', 'legs', 2, 2, 6, 160, '🥾',
    'Steel toes. The quarry teaches you why.'),

  A('grave-veil', 'Grave Veil', 'head', 3, 3, 9, 320, '🎽',
    'The drowned do not look at you while you wear it.', ['Unseen']),
  A('grave-shroud', 'Grave Shroud', 'body', 3, 3, 13, 420, '🎽',
    'Buried with someone who did not need it any more.', ['Unseen']),
  A('grave-wraps', 'Grave Wraps', 'legs', 3, 3, 9, 320, '👖',
    'They come off wet no matter how long it has been dry.', ['Unseen']),

  A('ember-mask', 'Ember Mask', 'head', 4, 3, 12, 540, '⛑',
    'Breathes through ash.', ['Fire Guard']),
  A('ember-cuirass', 'Ember Cuirass', 'body', 4, 3, 17, 700, '🛡',
    'Scorched to the point of being fireproof.', ['Fire Guard']),
  A('ember-boots', 'Ember Boots', 'legs', 4, 3, 12, 540, '🥾',
    'You can stand on the coals now. You still should not.', ['Fire Guard']),

  A('frost-crown', 'Frost Crown', 'head', 5, 3, 15, 880, '⛑',
    'The Frostmarch made it, and the Frostmarch cannot have it back.',
    ['Cold Guard']),
  A('throne-plate', 'Throne Plate', 'body', 5, 3, 22, 1300, '🛡',
    'Cut from the seat itself. It does not care what hits it.',
    ['Cold Guard', 'Fire Guard']),
  A('throne-greaves', 'Throne Greaves', 'legs', 5, 3, 15, 900, '🥾',
    'Every guardian you put down is in the metal somewhere.',
    ['Cold Guard']),

  // ──────────────────────────────────────────────────────────────── food ──
  F('lilypad', 'Lily Pad', 0, 12, 4, '🍃', 'Bitter. Filling.'),
  F('bog-berry', 'Bog Berry', 0, 18, 6, '🫐', 'Grows where the water sits still.'),
  F('cave-mushroom', 'Cave Mushroom', 1, 26, 10, '🍄',
    'Found in the dark. Eat it in the light.'),
  F('smoked-fish', 'Smoked Fish', 2, 44, 22, '🐟',
    'Croakhollow trades these upriver. Now you know why.'),
  F('ember-root', 'Ember Root', 3, 62, 38, '🌰',
    'Warms you from the middle out.', ['Cold Guard']),
  F('choir-honey', 'Choir Honey', 4, 90, 70, '🍯',
    'The cliffs are full of hives nobody can reach. Nobody but you.'),
  F('kings-broth', "King's Broth", 5, 150, 140, '🍲',
    'The Hollow City ate well, once.'),

  // ─────────────────────────────────────────────────────────── materials ──
  M('reed-fibre', 'Reed Fibre', 0, 2, '🌿', 'Twists into anything.'),
  M('mire-scale', 'Mire Scale', 1, 8, '🐚', 'Overlaps into armour, given a smith.'),
  M('bramble-thorn', 'Bramble Thorn', 1, 9, '🌵', 'Sharp before you pick it up.'),
  M('cut-stone', 'Cut Stone', 2, 14, '🧱', 'The quarry made mountains of it.'),
  M('grave-salt', 'Grave Salt', 3, 26, '🧂', "Keeps the drowned at arm's length."),
  M('choir-crystal', 'Choir Crystal', 3, 34, '💎', 'Rings if you tap it. Keeps ringing.'),
  M('spine-marrow', 'Spine Marrow', 4, 48, '🦴', 'Still faintly warm.'),
  M('ember-glass', 'Ember Glass', 4, 56, '🔶', 'Sand that was somewhere very hot.'),
  M('hollow-iron', 'Hollow Iron', 5, 90, '⚙', 'The city ran on it.'),
  M('god-shard', 'Shard of the First', 5, 220, '✨',
    'A piece of something that should not have pieces.'),

  // ─────────────────────────────────────────────────────────── key items ──
  K('light-crystal', 'The Light Crystal', '🔮',
    'Dropped by the First Croak. The stone frog in the arena wants it.'),
  K('croakhollow-key', 'Croakhollow Cellar Key', '🗝',
    'The innkeeper insists there is nothing down there.'),
  K('bell-clapper', 'The Bell Clapper', '🔔',
    'Taken from the Drowned Bell. Something answered.'),
  K('map-realm', 'Ragged Map', '🗺',
    'Someone drew the whole realm from memory and got most of it right.'),
  K('choir-note', 'The Last Note', '🎵',
    'Written on a scrap. It finishes the song.'),
  K('white-door-handle', 'Handle of the White Door', '🚪',
    'The door was not attached to anything. Neither is this.'),

  // ══════════════════════════════════════════════════════════════════════════
  // THE CROAKLANDS
  //
  // Everything below belongs to a region the expanded world added. Kept in
  // one block rather than filed into the lists above so that "what came from
  // where" stays readable, and so a region's whole kit can be checked at a
  // glance against the region it drops in.
  // ══════════════════════════════════════════════════════════════════════════

  // ─── weapons ───
  W('harrow-scythe', 'Harrow Scythe', 0, 2, 6, 46, '🌾',
    'For wheat. It has been used for other things.', ['Reach Up']),
  W('glass-sabre', 'Glassfen Sabre', 2, 3, 17, 260, '🗡',
    'Ground on a stone under still water. You can see through the edge.'),
  W('dune-pike', 'Dune Pike', 3, 2, 21, 340, '🔱',
    'Long enough to reach whatever is under the sand.', ['Reach Up']),
  W('bone-maul', 'Ossuary Maul', 3, 3, 24, 430, '🔨',
    'Somebody made a hammer out of somebody.', ['Heavy']),
  W('moonglass-lance', 'Moonglass Lance', 4, 3, 29, 700, '🔱',
    'Cut on the shelf, above the cloud, at night. It is always night up there.',
    ['Reach Up']),
  W('prism-edge', 'Prism Edge', 5, 3, 32, 980, '⚔',
    'It splits the light and it splits most other things.', ['Divine']),
  W('rime-pick', 'Rimefang Pick', 5, 3, 33, 1050, '🪓',
    'It was for the ice. The ice is not what it is for now.', ['Cold Guard']),

  // ─── armour ───
  A('harrow-hat', 'Harrow Hat', 'head', 0, 2, 2, 24, '🎽',
    'Straw. Keeps the sun and the crows off.'),
  A('harrow-coat', 'Harrow Coat', 'body', 0, 2, 4, 34, '🎽',
    'Canvas, waxed, and patched about nine times.'),

  A('glass-veil', 'Glassfen Veil', 'head', 2, 3, 7, 190, '🎽',
    'The fen shows you your own face. This stops it.', ['Unseen']),
  A('glass-scale', 'Glassfen Scale', 'body', 2, 3, 11, 250, '🛡',
    'Mirror-bright. Things look at it instead of at you.', ['Unseen']),
  A('glass-fins', 'Glassfen Fins', 'legs', 2, 3, 7, 190, '🥾',
    'Made for still water and no noise.', ['Swim Speed Up']),

  A('sand-wrap', 'Sunwrap', 'head', 3, 2, 8, 280, '🎽',
    'Ten feet of linen and a reason for all of it.', ['Heat Guard']),
  A('sand-mail', 'Sandreed Mail', 'body', 3, 3, 12, 380, '🛡',
    'Scales cut from something that swims in dunes.', ['Heat Guard']),
  A('sand-boots', 'Dune Striders', 'legs', 3, 2, 8, 280, '🥾',
    'You stop sinking. That is the whole trick.', ['Heat Guard']),

  A('bone-crest', 'Ossuary Crest', 'head', 3, 3, 10, 340, '⛑',
    'Somebody else wore this first, from the inside.'),
  A('bone-carapace', 'Ossuary Carapace', 'body', 3, 3, 14, 450, '🛡',
    'Ribs. Not yours.'),

  A('moon-circlet', 'Moonshelf Circlet', 'head', 4, 3, 13, 600, '⛑',
    'The astronomers wear them so they can see in the dark.', ['Unseen']),
  A('moon-robe', 'Moonshelf Robe', 'body', 4, 3, 18, 760, '🎽',
    'Woven above the cloud, which is why it weighs nothing.', ['Unseen']),
  A('moon-slippers', 'Moonshelf Slippers', 'legs', 4, 3, 13, 600, '👖',
    'They make no sound at all. It is unnerving.', ['Unseen']),

  A('prism-helm', 'Prismgaunt Helm', 'head', 5, 3, 16, 940, '⛑',
    'The light goes in and comes out somewhere else.', ['Divine']),
  A('prism-plate', 'Prismgaunt Plate', 'body', 5, 3, 23, 1400, '🛡',
    'Hit it hard enough and it hands the blow back in pieces.', ['Divine']),
  A('rime-greaves', 'Rimefang Greaves', 'legs', 5, 3, 16, 960, '🥾',
    'Nothing in the north can find your feet.', ['Cold Guard']),

  // ─── food ───
  F('harrow-loaf', 'Harrow Loaf', 0, 22, 8, '🍞',
    'The mill has not stopped in four hundred years. This is why.'),
  F('mirror-clam', 'Mirror Clam', 2, 50, 26, '🐚',
    'They come out of the Glassfen already open.'),
  F('sand-date', 'Sandreed Date', 3, 58, 32, '🌰',
    'Sweet enough to walk another day on.', ['Heat Guard']),
  F('glow-cap', 'Glimmer Cap', 4, 96, 74, '🍄',
    'It is still glowing on the way down.'),
  F('rime-broth', 'Rime Broth', 5, 160, 150, '🍲',
    'Made with snow, and it still warms you.', ['Cold Guard']),

  // ─── materials ───
  M('mill-grain', 'Harrow Grain', 0, 4, '🌾', 'The whole south eats this.'),
  M('lily-silk', 'Lily Silk', 0, 6, '🧵', 'Pulled off the underside of a pad.'),
  M('mirror-glass', 'Mirror Glass', 2, 30, '🪟',
    'The Glassfen makes it by lying perfectly still.'),
  M('sand-glass', 'Sun Glass', 3, 38, '🔸', 'Lightning strikes sand and leaves this.'),
  M('bone-meal', 'Bone Meal', 3, 30, '🦴', 'The Boneflats are made of it.'),
  M('obsidian-chip', 'Obsidian Chip', 4, 52, '⬛', 'It was liquid this century.'),
  M('moon-silver', 'Moon Silver', 4, 74, '⚪', 'Only found above the cloud line.'),
  M('prism-shard', 'Prism Shard', 5, 110, '🔷', 'A piece of the Heartshard.'),
  M('rime-core', 'Rime Core', 5, 120, '❄', 'It has not melted. It is not going to.'),

  // ─── key items ───
  K('mill-key', 'Mill Loft Key', '🗝',
    'Reeve Tull would like somebody else to go up there.'),
  K('scarecrow-heart', "Thistlejack's Heart", '🎃',
    'A turnip, a nail and a great deal of malice.'),
  K('library-seal', 'Seal of the Drowned Library', '📜',
    'Reading it makes your eyes water and your ears ring.'),
  K('lantern-oil', 'Gravekeeper’s Oil', '🛢',
    'Six months of light, if nobody drops it.'),
  K('star-chart', 'The Unfinished Chart', '🌌',
    'Someone was mapping the sky and stopped mid-constellation.'),
  K('span-token', 'Warden’s Token', '🎖',
    'Arkos gave these to people he let across. There are two.'),
  K('crown-fragment', 'Fragment of the Crown', '👑',
    'Anurath had a crown. This is a corner of it.'),
];

export const GEAR_BY_ID = new Map(GEAR.map((g) => [g.id, g]));

/**
 * Everything of a tier that a drop table may hand out.
 *
 * `unique` items are excluded. There is exactly one of those — FROGSHIN — and
 * it comes from beating the First Croak and from nowhere else. Being tier 5 it
 * was in the tier-5 pool, so any of the four tier-5 guardians could drop the
 * blade the game is named for before you had ever seen him, which took the
 * reward off the one fight that is supposed to give it.
 */
export function gearOfTier(tier, cat = null) {
  return GEAR.filter((g) => g.tier === tier && !g.unique && (!cat || g.cat === cat));
}

/**
 * What a defeated thing leaves behind.
 *
 * Tier drives the table, so a guardian in the Emberwaste drops Emberwaste
 * gear without anybody writing a loot list per boss. `boss` widens it: a
 * guardian always yields one piece of equipment, where a camp yields
 * materials and food.
 */
export function rollLoot(tier, boss, rnd = Math.random) {
  const out = [];
  const pick = (list) => list.length ? list[Math.floor(rnd() * list.length)] : null;
  if (boss) {
    const eq = pick([...gearOfTier(tier, 'weapon'), ...gearOfTier(tier, 'armour')]);
    if (eq) out.push({ id: eq.id, n: 1 });
    const m = pick(gearOfTier(tier, 'material'));
    if (m) out.push({ id: m.id, n: 2 + Math.floor(rnd() * 3) });
    const f = pick(gearOfTier(Math.max(0, tier - 1), 'food'));
    if (f) out.push({ id: f.id, n: 1 + Math.floor(rnd() * 2) });
  } else {
    const m = pick(gearOfTier(tier, 'material')) || pick(gearOfTier(0, 'material'));
    if (m) out.push({ id: m.id, n: 1 + Math.floor(rnd() * 2) });
    if (rnd() < 0.45) {
      const f = pick(gearOfTier(Math.min(5, tier), 'food')) || pick(gearOfTier(0, 'food'));
      if (f) out.push({ id: f.id, n: 1 });
    }
  }
  return out;
}
