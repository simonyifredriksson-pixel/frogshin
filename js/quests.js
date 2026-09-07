/**
 * THE STORY, THE SIDE STORIES, AND THE PEOPLE WHO TELL THEM.
 *
 * Three tables and nothing else:
 *
 *   QUESTS    the main line and the side lines, each a list of stages
 *   NPCS      who stands where, and what they say at each stage
 *   SECRETS   the things nobody tells you about
 *
 * ── stages, and why a quest is a list ─────────────────────────────────────
 * A stage has a `text` (what the log says to do), a `where` (which region),
 * a `mark` (what the map should put a star on) and a `done(p)` predicate that
 * reads the save. Nothing anywhere fires an event to advance a quest: the
 * stage is recomputed from what the player has actually done. That means a
 * quest cannot desynchronise from the world — kill the boss before you are
 * told to and the stage is already complete when you are told to.
 *
 * ── the main line is a CHAIN, and it says so ──────────────────────────────
 * Every stage of the main line names a place and the map stars it. The chain
 * is: village, road, first fight, first guardian, next region, next
 * guardian, and so on to the throne — and each region's gate in `regions.js`
 * names the guardian that opens it, so the world physically opens in the
 * same order the log describes. The player is never told to "explore"; they
 * are told where to go and what is waiting there.
 *
 * ── dialogue ──────────────────────────────────────────────────────────────
 * An NPC's `lines` is a list of { when, say } — the first whose `when(p)`
 * holds is what they are saying today. So a villager comments on the
 * guardian you killed this morning without anybody writing a trigger for it,
 * and the ones on the road tell you where the next one is.
 */

/** The main line, in order. Its id is referenced by NPCs and the HUD. */
export const MAIN = 'main';

/** A stage. `mark` is what the map screen should star. */
const st = (text, where, mark, done) => ({ text, where, mark, done });
/** A map marker on a named place, a guardian's arena, or a whole region. */
const site = (id) => ({ kind: 'site', id });
const boss = (id) => ({ kind: 'boss', id });
const region = (id) => ({ kind: 'region', id });

/** A side quest, and its last stage is always "go and hand it in". */
const turnIn = (id, text, where, mark) => st(text, where, mark, (p) => p.questDone(id));

export const QUESTS = [
  {
    id: MAIN,
    name: 'THE LONG CROAK',
    side: false,
    blurb: 'Every guardian in the world has started walking north. Find out why.',
    stages: [
      st('Speak to Old Bram in Croakhollow.',
        'lilyreach', site('croakhollow'),
        (p) => p.questStage(MAIN) > 0),
      st('Follow the Mead Way west to Harrowmead and find Reeve Tull.',
        'harrowmead', site('harrowmead-town'),
        (p) => p.questStage(MAIN) > 1 || p.seen.has('harrowmead')),
      st('Something is standing in Longfurrow’s west field. Put Thistlejack down.',
        'harrowmead', boss('thistlejack'),
        (p) => p.slain.has('thistlejack')),
      st('The Whispermire is rising. Go west to The Stilts and speak to Wade.',
        'whispermire', site('the-stilts'),
        (p) => p.seen.has('whispermire')),
      st('GUARDIAN 1 — Silt, Warden of the Shallows, in the deep channel.',
        'whispermire', boss('silt'),
        (p) => p.slain.has('silt')),
      st('The Wood Road east is open. Reach Roothome in Hollowroot Wood.',
        'hollowroot', site('roothome'),
        (p) => p.seen.has('hollowroot')),
      st('GUARDIAN 2 — Mosshide, the Patient, in the deep wood.',
        'hollowroot', boss('mosshide'),
        (p) => p.slain.has('mosshide')),
      st('Take the King’s Road north and climb the Sunken Stair.',
        'sunkenstair', site('stairhead-gate'),
        (p) => p.seen.has('sunkenstair')),
      st('GUARDIAN 3 — Grott, the Gate-Keeper, holds the Stairhead Gate.',
        'sunkenstair', boss('grott'),
        (p) => p.slain.has('grott')),
      st('The road drops into the Anurath Basin. Find the capital.',
        'anurath', site('anurath-city'),
        (p) => p.seen.has('anurath')),
      st('GUARDIAN 4 — The Stone That Walks, in the palace forecourt.',
        'anurath', boss('stonewalks'),
        (p) => p.slain.has('stonewalks')),
      st('The Cutter’s Way east is open. GUARDIAN 5 — the Quarry-Hand.',
        'quarry', boss('quarryhand'),
        (p) => p.slain.has('quarryhand')),
      st('Follow the Salt Road west. GUARDIAN 6 — Gravewater itself.',
        'gravewater', boss('gravewater'),
        (p) => p.slain.has('gravewater')),
      st('GUARDIAN 7 — Nix, last of the Choir, at the Stone Organ.',
        'choircliffs', boss('nix'),
        (p) => p.slain.has('nix')),
      st('Take the Ash Road. GUARDIAN 8 — Varn, who came running.',
        'emberwaste', boss('varn'),
        (p) => p.slain.has('varn')),
      st('GUARDIAN 9 — Huldr, at the Eye of the Deep on the Spine.',
        'spine', boss('huldr'),
        (p) => p.slain.has('huldr')),
      st('GUARDIAN 10 — The Hollow King, behind the Last Gate.',
        'hollowcity', boss('hollowking'),
        (p) => p.slain.has('hollowking')),
      st('Take the Cold Road. GUARDIAN 11 — Brack, at the Hoarfrost Hold.',
        'frostmarch', boss('brack'),
        (p) => p.slain.has('brack')),
      st('GUARDIAN 12 — Arkos holds the Sunderway, and it is the only bridge north.',
        'sunderway', boss('arkos'),
        (p) => p.slain.has('arkos')),
      st('GUARDIAN 13 — Zehl, the Final Guardian, at the Throne Gate.',
        'ashenthrone', boss('zehl'),
        (p) => p.slain.has('zehl')),
      st('FROGATH. He has been waiting the whole time.',
        'ashenthrone', boss('frogath'),
        (p) => p.slain.has('frogath')),
    ],
  },

  // ══════════════════════════════════════════════════════════ side quests ══
  // Optional, every one of them. None is needed to finish the main line, and
  // each is anchored to a person who will tell you what they want and where.

  {
    id: 'mill', name: 'SIX SAILS', side: true,
    blurb: 'The Great Harrow Mill has something living in the loft.',
    stages: [
      st('Ask Reeve Tull about the mill.', 'harrowmead', site('harrowmead-town'),
        (p) => p.questStage('mill') > 0),
      st('Put Thistlejack down and take what is holding him together.',
        'harrowmead', boss('thistlejack'), (p) => p.has('scarecrow-heart')),
      turnIn('mill', 'Bring the heart back to Tull.', 'harrowmead',
        site('harrowmead-town')),
    ],
    reward: { xp: 180, items: [{ id: 'harrow-scythe', n: 1 }, { id: 'harrow-hat', n: 1 }] },
  },
  {
    id: 'smith', name: 'THE SMITH WHO TALKS', side: true,
    blurb: 'Goss will make you something if you bring him something.',
    stages: [
      st('Bring Goss six Reed Fibre.', 'harrowmead', site('harrowmead-town'),
        (p) => p.has('reed-fibre', 6)),
      turnIn('smith', 'Hand it over.', 'harrowmead', site('harrowmead-town')),
    ],
    reward: { xp: 140, items: [{ id: 'harrow-coat', n: 1 }] },
  },
  {
    id: 'stilts', name: 'NINE HUTS AND A ROPE', side: true,
    blurb: 'The Stilts has lost its bell-rope, and with it its warning.',
    stages: [
      st('Find the Drowned Bell somewhere in the Whispermire.',
        'whispermire', site('drowned-bell'), (p) => p.found.has('drowned-bell')),
      turnIn('stilts', 'Bring the clapper back to Wade at The Stilts.',
        'whispermire', site('the-stilts')),
    ],
    reward: { xp: 220, items: [{ id: 'mire-greaves', n: 1 }] },
  },
  {
    id: 'bogwife', name: 'WHAT THE BOGWIFE WANTS', side: true,
    blurb: 'Five scales, and she will not say what for.',
    stages: [
      st('Bring the Bogwife five Mire Scale.', 'whispermire', site('witchhut'),
        (p) => p.has('mire-scale', 5)),
      turnIn('bogwife', 'Take them to the hut.', 'whispermire', site('witchhut')),
    ],
    reward: { xp: 240, items: [{ id: 'mire-cowl', n: 1 }] },
  },
  {
    id: 'woodwarden', name: 'THE PATIENT THING', side: true,
    blurb: 'The Woodwarden has not slept. Something in the wood is growing.',
    stages: [
      st('Put down Mosshide in Hollowroot Wood.', 'hollowroot', boss('mosshide'),
        (p) => p.slain.has('mosshide')),
      turnIn('woodwarden', 'Tell the Woodwarden it is over.', 'hollowroot',
        site('woodwarden')),
    ],
    reward: { xp: 260, items: [{ id: 'bramble-edge', n: 1 }] },
  },
  {
    id: 'roothome', name: 'THE RING IN THE WOOD', side: true,
    blurb: 'Elder Tam wants to know what is in the clearing nobody walks into.',
    stages: [
      st('Find the Ring, deep in Hollowroot Wood.', 'hollowroot',
        site('mushroom-ring'), (p) => p.found.has('mushroom-ring')),
      st('Bring Tam six Bramble Thorn from the wood.', 'hollowroot',
        site('roothome'), (p) => p.has('bramble-thorn', 6)),
      turnIn('roothome', 'Take them up to Roothome.', 'hollowroot', site('roothome')),
    ],
    reward: { xp: 300, items: [{ id: 'mire-mail', n: 1 }] },
  },
  {
    id: 'toll', name: 'THE TOLLKEEPER’S PROBLEM', side: true,
    blurb: 'Something has moved onto the stair and it is not paying.',
    stages: [
      st('Clear an enemy camp anywhere on the Sunken Stair.', 'sunkenstair',
        site('toll-camp'), (p) => p.camps.size >= 1),
      turnIn('toll', 'Go back and tell Hask.', 'sunkenstair', site('toll-camp')),
    ],
    reward: { xp: 320, items: [{ id: 'stair-glaive', n: 1 }] },
  },
  {
    id: 'monk', name: 'THREE STONES', side: true,
    blurb: 'Brother Orin would like somebody to visit the shrines again.',
    stages: [
      st('Find three shrines anywhere in the realm.', 'sunkenstair',
        site('stairfoot'), (p) => p.found.size >= 3),
      turnIn('monk', 'Tell Orin at the Stairfoot Shrine.', 'sunkenstair',
        site('stairfoot')),
    ],
    reward: { xp: 340, items: [{ id: 'choir-crystal', n: 3 }] },
  },
  {
    id: 'library', name: 'EVERY BOOK IN THE WORLD', side: true,
    blurb: 'Archivist Lume is still cataloguing a library that is under water.',
    stages: [
      st('Find the Drowned Library in the Anurath Basin.', 'anurath',
        site('drowned-library'), (p) => p.found.has('drowned-library')),
      turnIn('library', 'Bring the seal back to Lume.', 'anurath',
        site('anurath-city')),
    ],
    reward: { xp: 420, items: [{ id: 'glass-sabre', n: 1 }] },
  },
  {
    id: 'crown', name: 'A CORNER OF THE CROWN', side: true,
    blurb: 'Chancellor Vess would like the crown back. Any of it.',
    stages: [
      st('Search the Throneless Hall.', 'anurath', site('throneless-hall'),
        (p) => p.found.has('throneless-hall')),
      turnIn('crown', 'Take the fragment to Vess in Anurath.', 'anurath',
        site('anurath-city')),
    ],
    reward: { xp: 460, items: [{ id: 'quarry-plate', n: 1 }] },
  },
  {
    id: 'watch', name: 'THE LAST OF THE GUARD', side: true,
    blurb: 'Captain Rell wants the Sable Knight put to rest.',
    stages: [
      st('Put down the Sable Knight, east of the city.', 'anurath',
        boss('sableknight'), (p) => p.slain.has('sableknight')),
      turnIn('watch', 'Report to Captain Rell at the King’s Bridge.', 'anurath',
        site('kings-bridge')),
    ],
    reward: { xp: 480, items: [{ id: 'quarry-boots', n: 1 }] },
  },
  {
    id: 'cutters', name: 'STILL CUTTING', side: true,
    blurb: 'Cutter’s Rest works a quarry nobody buys from. Ask why.',
    stages: [
      st('Ask Foreman Gost what they are digging for.', 'quarry',
        site('cutters-rest'), (p) => p.questStage('cutters') > 0),
      st('Bring Gost five Cut Stone from the pits.', 'quarry',
        site('cutters-rest'), (p) => p.has('cut-stone', 5)),
      turnIn('cutters', 'Hand them over.', 'quarry', site('cutters-rest')),
    ],
    reward: { xp: 380, items: [{ id: 'quarry-helm', n: 1 }] },
  },
  {
    id: 'deepcut', name: 'HOW FAR DOWN', side: true,
    blurb: 'Mab says the Deepcut goes further than the foreman admits.',
    stages: [
      st('Find the mouth of the Deepcut.', 'quarry', site('deepcut'),
        (p) => p.found.has('deepcut')),
      st('Put down Glassback, which is what is living in it.', 'quarry',
        boss('glassback'), (p) => p.slain.has('glassback')),
      turnIn('deepcut', 'Tell Mab.', 'quarry', site('cutters-rest')),
    ],
    reward: { xp: 520, items: [{ id: 'cut-stone', n: 12 }, { id: 'quarry-maul', n: 1 }] },
  },
  {
    id: 'glasshook', name: 'WHAT THEY CATCH', side: true,
    blurb: 'Elder Saro will trade, if you bring glass out of the fen.',
    stages: [
      st('Bring Saro four Mirror Glass.', 'glassfen', site('glasshook'),
        (p) => p.has('mirror-glass', 4)),
      turnIn('glasshook', 'Take it to Glasshook.', 'glassfen', site('glasshook')),
    ],
    reward: { xp: 500, items: [{ id: 'glass-scale', n: 1 }] },
  },
  {
    id: 'mirror', name: 'THE HOUSE THAT IS WRONG', side: true,
    blurb: 'The hermit at the Shrine of Two Skies has seen something upsetting.',
    stages: [
      st('Find the Upside House in the Glassfen.', 'glassfen',
        site('upside-house'), (p) => p.found.has('upside-house')),
      turnIn('mirror', 'Describe it to the hermit.', 'glassfen',
        site('mirror-shrine')),
    ],
    reward: { xp: 540, items: [{ id: 'glass-veil', n: 1 }, { id: 'glass-fins', n: 1 }] },
  },
  {
    id: 'gravekeeper', name: 'THEY DO NOT STAY DOWN', side: true,
    blurb: 'The Gravekeeper is out of salt and the water is rising.',
    stages: [
      st('Gather six Grave Salt from Gravewater.', 'gravewater',
        site('gravekeeper'), (p) => p.has('grave-salt', 6)),
      turnIn('gravekeeper', 'Take it to the Gravekeeper’s Lantern.', 'gravewater',
        site('gravekeeper')),
    ],
    reward: { xp: 560, items: [{ id: 'grave-shroud', n: 1 }] },
  },
  {
    id: 'sandreed', name: 'GLASS OUT OF SAND', side: true,
    blurb: 'Zib in Sandreed buys Sun Glass and asks no questions.',
    stages: [
      st('Bring Zib five Sun Glass from the Thirstlands.', 'thirstlands',
        site('sandreed'), (p) => p.has('sand-glass', 5)),
      turnIn('sandreed', 'Take it to the market.', 'thirstlands', site('sandreed')),
    ],
    reward: { xp: 600, items: [{ id: 'sand-mail', n: 1 }, { id: 'sand-boots', n: 1 }] },
  },
  {
    id: 'pyramid', name: 'THE DOOR THEY DUG OUT', side: true,
    blurb: 'Oss opened the Sunken Crown and something came up out of it.',
    stages: [
      st('Find the Sunken Crown in the Thirstlands.', 'thirstlands',
        site('landmark:thirstlands'), (p) => p.found.has('landmark:thirstlands')),
      st('Put down the Sandreaver.', 'thirstlands', boss('sandreaver'),
        (p) => p.slain.has('sandreaver')),
      turnIn('pyramid', 'Find Oss at the pyramid and tell him.', 'thirstlands',
        site('landmark:thirstlands')),
    ],
    reward: { xp: 700, items: [{ id: 'dune-pike', n: 1 }] },
  },
  {
    id: 'choir', name: 'THE LAST NOTE', side: true,
    blurb: 'The Choir stopped mid-song. One note is missing.',
    stages: [
      st('Find the Last Note in the Choir Cliffs.', 'choircliffs',
        site('the-note'), (p) => p.found.has('the-note')),
      turnIn('choir', 'Sing it back at the Choirhold.', 'choircliffs',
        site('choirhold')),
    ],
    reward: { xp: 640, items: [{ id: 'choir-saber', n: 1 }] },
  },
  {
    id: 'bones', name: 'WHAT THE FLATS ARE MADE OF', side: true,
    blurb: 'Gale at Ribwatch will pay for Bone Meal and will not say why.',
    stages: [
      st('Bring Gale eight Bone Meal.', 'boneflats', site('ribwatch'),
        (p) => p.has('bone-meal', 8)),
      turnIn('bones', 'Take it to Ribwatch.', 'boneflats', site('ribwatch')),
    ],
    reward: { xp: 680, items: [{ id: 'bone-carapace', n: 1 }, { id: 'bone-maul', n: 1 }] },
  },
  {
    id: 'lake', name: 'WHY THEY ROW OUT AT NIGHT', side: true,
    blurb: 'Lakewatch takes something out onto the water. Ask Nim.',
    stages: [
      st('Ask Nim in Lakewatch.', 'drownedkeep', site('lakewatch'),
        (p) => p.questStage('lake') > 0),
      st('Put down Dolmath, who is holding the keep.', 'drownedkeep',
        boss('dolmath'), (p) => p.slain.has('dolmath')),
      turnIn('lake', 'Go back to Lakewatch.', 'drownedkeep', site('lakewatch')),
    ],
    reward: { xp: 760, items: [{ id: 'grave-veil', n: 1 }] },
  },
  {
    id: 'ashfall', name: 'WHAT BURNED', side: true,
    blurb: 'The Ashfall Camp remembers the Emberwaste being green.',
    stages: [
      st('Put down Cindren, the Second Fire.', 'emberwaste', boss('cindren'),
        (p) => p.slain.has('cindren')),
      turnIn('ashfall', 'Tell the camp.', 'emberwaste', site('ashfall')),
    ],
    reward: { xp: 820, items: [{ id: 'ember-cuirass', n: 1 }] },
  },
  {
    id: 'rimtemple', name: 'THE FIRE THEY KEEP', side: true,
    blurb: 'The Rim Temple has not let its fire go out. It nearly has.',
    stages: [
      st('Bring Keeper Vail three Obsidian Chip.', 'cindermaw', site('rimtemple'),
        (p) => p.has('obsidian-chip', 3)),
      turnIn('rimtemple', 'Take them up to the rim.', 'cindermaw', site('rimtemple')),
    ],
    reward: { xp: 900, items: [{ id: 'ember-mask', n: 1 }, { id: 'ember-boots', n: 1 }] },
  },
  {
    id: 'volkh', name: 'THE EMBER-EATER', side: true,
    blurb: 'Something in the caldera has been growing for two hundred years.',
    stages: [
      st('Put down Volkh, the Ember-Eater, at Cindermaw.', 'cindermaw',
        boss('volkh'), (p) => p.slain.has('volkh')),
      st('And the thing sitting in the caldera itself.', 'cindermaw',
        boss('emberthrone'), (p) => p.slain.has('emberthrone')),
      turnIn('volkh', 'Tell Vail what is up there now.', 'cindermaw',
        site('rimtemple')),
    ],
    reward: { xp: 1100, items: [{ id: 'ember-brand', n: 1 }] },
  },
  {
    id: 'moon', name: 'THE UNFINISHED CHART', side: true,
    blurb: 'Sela was mapping the sky and stopped in the middle of it.',
    stages: [
      st('Find the Unfallen, out on the Moonshelf.', 'moonshelf',
        site('floatstones'), (p) => p.found.has('floatstones')),
      st('Put down Moonwake, which walks the shelf at night.', 'moonshelf',
        boss('moonwake'), (p) => p.slain.has('moonwake')),
      turnIn('moon', 'Take the chart back to Moonwatch.', 'moonshelf',
        site('moonwatch')),
    ],
    reward: { xp: 1000, items: [{ id: 'moonglass-lance', n: 1 }, { id: 'moon-circlet', n: 1 }] },
  },
  {
    id: 'palewood', name: 'THE FOG GOES IN', side: true,
    blurb: 'Hoyd keeps the last lantern in the Palewood and wants to know why.',
    stages: [
      st('Find the White Door.', 'palewood', site('white-door'),
        (p) => p.found.has('white-door')),
      st('Then go into the Hollow, where the fog goes.', 'palewood',
        site('pale-hollow'), (p) => p.found.has('pale-hollow')),
      turnIn('palewood', 'Tell Hoyd what is in there.', 'palewood',
        site('pale-camp')),
    ],
    reward: { xp: 1050, items: [{ id: 'moon-robe', n: 1 }] },
  },
  {
    id: 'undercity', name: 'BELOW THE MARKET', side: true,
    blurb: 'The Hollow City has a city under it, and the clerk has the plan.',
    stages: [
      st('Find the way into the Undercity.', 'hollowcity', site('undercity'),
        (p) => p.found.has('undercity')),
      st('Put down the Gatewright, who barred it from the inside.', 'hollowcity',
        boss('gatewright'), (p) => p.slain.has('gatewright')),
      turnIn('undercity', 'Tell the Last Clerk.', 'hollowcity',
        site('hollow-market')),
    ],
    reward: { xp: 1200, items: [{ id: 'hollow-kings-blade', n: 1 }] },
  },
  {
    id: 'lumen', name: 'THEY GROW THE LIGHT', side: true,
    blurb: 'Iri in Lumen needs shards of the Heartshard, and will show you how.',
    stages: [
      st('Bring Iri four Prism Shard.', 'glimmerwood', site('lumen'),
        (p) => p.has('prism-shard', 4)),
      turnIn('lumen', 'Take them to Lumen.', 'glimmerwood', site('lumen')),
    ],
    reward: { xp: 1250, items: [{ id: 'prism-helm', n: 1 }, { id: 'prism-edge', n: 1 }] },
  },
  {
    id: 'coldhearth', name: 'THE COLD HEARTH', side: true,
    blurb: 'A fire in the Frostmarch that has been out a long time.',
    stages: [
      st('Bring three Ember Glass to the Cold Hearth.', 'frostmarch',
        site('coldhearth'), (p) => p.has('ember-glass', 3)),
      turnIn('coldhearth', 'Light it.', 'frostmarch', site('coldhearth')),
    ],
    reward: { xp: 1150, items: [{ id: 'frost-crown', n: 1 }] },
  },
  {
    id: 'tooth', name: 'THE DOOR FACING THE WIND', side: true,
    blurb: 'A pilgrim has been trying to reach the Tooth for eleven years.',
    stages: [
      st('Bring the pilgrim three Rime Core.', 'rimefang', site('the-tooth'),
        (p) => p.has('rime-core', 3)),
      st('Put down Rimeglass, which is what is in the temple.', 'rimefang',
        boss('rimeglass'), (p) => p.slain.has('rimeglass')),
      turnIn('tooth', 'Go back to the pilgrim.', 'rimefang', site('the-tooth')),
    ],
    reward: { xp: 1400, items: [{ id: 'rime-pick', n: 1 }, { id: 'rime-greaves', n: 1 }] },
  },
  {
    id: 'collector', name: 'THE COLLECTOR', side: true,
    blurb: 'Someone in Croakhollow wants one of everything strange.',
    stages: [
      st('Find six of the realm’s secrets.', 'lilyreach', site('croakhollow'),
        (p) => p.found.size >= 6),
      turnIn('collector', 'Show Pel what you have found.', 'lilyreach',
        site('croakhollow')),
    ],
    reward: { xp: 900, items: [{ id: 'map-realm', n: 1 }] },
  },
];

export const QUEST_BY_ID = new Map(QUESTS.map((q) => [q.id, q]));

/**
 * Where a quest has actually got to, computed from the save.
 *
 * Returns the index of the first stage whose `done` is false, or the stage
 * count when every one is behind you. Nothing stores this — it is derived, so
 * it cannot be wrong.
 */
export function questProgress(quest, p) {
  for (let i = 0; i < quest.stages.length; i++) {
    if (!quest.stages[i].done(p)) return i;
  }
  return quest.stages.length;
}

/**
 * The one thing the player is supposed to be doing, and where.
 *
 * This is what the HUD shows and what the map stars. It is always the main
 * line: a side quest is never the headline objective, because the point of
 * the headline objective is that there is exactly one of it.
 */
export function mainObjective(p) {
  const q = QUEST_BY_ID.get(MAIN);
  const at = questProgress(q, p);
  if (at >= q.stages.length) return null;
  return { index: at, total: q.stages.length, ...q.stages[at] };
}

// ══════════════════════════════════════════════════════════════════ people ══

/**
 * Who stands where, and what they say.
 *
 * `at` is a hint; the overworld snaps it to standable ground the same way it
 * snaps a boss arena. `gives` is a quest they hand over when spoken to, and
 * `turns` a quest they will take the finished version of. `role` is what they
 * do, which drives what they look like and whether they wander.
 */
export const NPCS = [
  // ───────────────────────────────────────────────────── the Lilyreach ──
  {
    id: 'bram', name: 'OLD BRAM', region: 'lilyreach', at: [308, 1772],
    colour: 0x6cc24a, role: 'elder', gives: MAIN, turns: null,
    lines: [
      { when: (p) => p.slain.has('frogath'),
        say: ['You went up there.', 'And you came back down.',
          'Nobody has ever done the second part.'] },
      { when: (p) => p.slain.size >= 10,
        say: ['Ten of them.', 'The old songs only ever named six.',
          'Whatever is calling them, it is losing its voice.'] },
      { when: (p) => p.slain.has('silt'),
        say: ['You put the Warden down. Good.',
          'They are not monsters, you know. They are GUARDIANS.',
          'Somebody set them to guard something, and now they have all',
          'started walking the same way. North. Go and find out what is up there.'] },
      { when: (p) => p.questStage(MAIN) > 0,
        say: ['Still here? Then listen properly.',
          'Take the Mead Way west out of the village. It runs to Harrowmead.',
          'Ask for Reeve Tull. He has been writing to me about the fields.'] },
      { when: () => true,
        say: ['You are the one who came out of the water, then.',
          'Thirteen guardians between here and the Ashen Throne.',
          'They have all started walking the same direction. North.',
          'Somebody has to go and look. It is not going to be me.',
          'Start west. The Mead Way. Ask for Reeve Tull at Harrowmead.'] },
    ],
  },
  {
    id: 'pel', name: 'PEL THE COLLECTOR', region: 'lilyreach', at: [276, 1808],
    colour: 0xd9743a, role: 'trader', gives: 'collector', turns: 'collector',
    lines: [
      { when: (p) => p.questDone('collector'),
        say: ['A door with no wall. A bell nobody rang. A boat in a wheat field.',
          'I have catalogued stranger. Not much stranger.'] },
      { when: (p) => p.found.size >= 6,
        say: ['You FOUND them? Six?', 'Show me. Show me right now.'] },
      { when: () => true,
        say: ['There are things out there that do not belong to any region.',
          'A bell in the fen. An oak with a room in it. A cottage on its roof.',
          'A door in the Palewood attached to NOTHING.',
          'Bring me six and I will draw you a map worth having.'] },
    ],
  },
  {
    id: 'nan', name: 'NAN OF THE REACH', region: 'lilyreach', at: [344, 1826],
    colour: 0x53b7e8, role: 'fisher', gives: null, turns: null,
    lines: [
      { when: (p) => p.seen.size >= 8,
        say: ['You have been about, haven’t you.',
          'Tell me one thing. Is the water still warm anywhere else?'] },
      { when: () => true,
        say: ['Smoked fish. Best in the realm and I will hear nothing else.',
          'The reach is warm because the Long Croak comes down cold and slow',
          'and gives it all up here before the sea.',
          'Follow the river north and it will take you the whole way.'] },
    ],
  },

  // ──────────────────────────────────────────────────── the Harrowmead ──
  {
    id: 'tull', name: 'REEVE TULL', region: 'harrowmead', at: [-320, 1682],
    colour: 0xc9a227, role: 'elder', gives: 'mill', turns: 'mill',
    lines: [
      { when: (p) => p.questDone('mill'),
        say: ['A turnip and a nail. That is what was standing in my field.',
          'The mill turns again. Take the road west when you are ready —',
          'the Whispermire is drowning The Stilts, and Wade is out of ideas.'] },
      { when: (p) => p.has('scarecrow-heart'),
        say: ['Is that it? Is that what was in the loft?', 'Give it here.'] },
      { when: (p) => p.questStage('mill') > 0,
        say: ['West field. Past the fences. You will hear it before you see it.'] },
      { when: () => true,
        say: ['Bram wrote to me. He said you would come and he said you were odd.',
          'Something got into the mill loft and then it got into the west field.',
          'Put it down and I will tell you what the roads out of here go to.'] },
    ],
  },
  {
    id: 'goss', name: 'GOSS THE SMITH', region: 'harrowmead', at: [-350, 1714],
    colour: 0x9a6a3a, role: 'smith', gives: 'smith', turns: 'smith',
    lines: [
      { when: (p) => p.questDone('smith'),
        say: ['Wear it. It is not much but it is waxed.',
          'When you get to the capital, ask at the forge on the west side.',
          'They will still be working. They have nothing else to do.'] },
      { when: (p) => p.has('reed-fibre', 6),
        say: ['Six. Good. Sit down, this takes a minute.'] },
      { when: () => true,
        say: ['Everyone wants a sword. Nobody brings me anything to make one with.',
          'Six Reed Fibre. It grows in the shallows, you cannot miss it.',
          'Bring that and I will run you up a coat that keeps the rain out.'] },
    ],
  },
  {
    id: 'wick', name: 'WICK', region: 'harrowmead', at: [-300, 1724],
    colour: 0x8fe86b, role: 'child', gives: null, turns: null,
    lines: [
      { when: (p) => p.slain.has('thistlejack'),
        say: ['You KILLED it!', 'Was it scary? It was scary, wasn’t it.',
          'I am going to be a ninja. I have decided.'] },
      { when: () => true,
        say: ['You are not from here.',
          'There is a stone boat in the north field. A BOAT. Made of stone.',
          'Nobody will tell me why and I have asked everybody.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Whispermire ──
  {
    id: 'wade', name: 'WADE OF THE STILTS', region: 'whispermire', at: [-968, 1546],
    colour: 0x53b7e8, role: 'elder', gives: 'stilts', turns: 'stilts',
    lines: [
      { when: (p) => p.slain.has('silt') && p.questDone('stilts'),
        say: ['Hear that? That is a village that knows when to run.',
          'And the water has gone down since you dealt with the Warden.',
          'The Wood Road east from Croakhollow is walkable now. Roothome is up',
          'inside a tree the size of a hill. You will not miss it.'] },
      { when: (p) => p.slain.has('silt'),
        say: ['The channel is quiet. I do not know what to do with quiet.',
          'Go east. Croakhollow, then the Wood Road, then Hollowroot Wood.'] },
      { when: (p) => p.found.has('drowned-bell'),
        say: ['You have the clapper. I can hear it from here.',
          'Hand it over and I will hang it tonight.'] },
      { when: () => true,
        say: ['Nine huts and a rope, and the rope is what matters.',
          'The bell went into the water forty years ago.',
          'And the water is coming up. That is the Warden — Silt, out in the',
          'deep channel south-west of here. Somebody has to go down there.'] },
    ],
  },
  {
    id: 'bogwife', name: 'THE BOGWIFE', region: 'whispermire', at: [-1300, 1462],
    colour: 0x4a6b3a, role: 'hermit', gives: 'bogwife', turns: 'bogwife',
    lines: [
      { when: (p) => p.questDone('bogwife'),
        say: ['Five scales. Now go away and let me work.',
          'If you must know: the Tidemother is not the Warden. She is older.',
          'She is out at the north end and she has never had to chase anything.'] },
      { when: (p) => p.has('mire-scale', 5),
        say: ['Ah. Come in. Do not look at the shelves.'] },
      { when: () => true,
        say: ['You smell of dry land.',
          'Five Mire Scale. Off the lurkers. Do not ask what for.'] },
    ],
  },

  // ─────────────────────────────────────────────────── Hollowroot Wood ──
  {
    id: 'warden', name: 'THE WOODWARDEN', region: 'hollowroot', at: [1156, 1164],
    colour: 0x4e9a3c, role: 'ranger', gives: 'woodwarden', turns: 'woodwarden',
    lines: [
      { when: (p) => p.questDone('woodwarden'),
        say: ['I slept.', 'First time in a year. Thank you.',
          'North now. The King’s Road out of Croakhollow climbs the Sunken',
          'Stair — a staircase the size of a valley. Something holds the top.'] },
      { when: (p) => p.slain.has('mosshide'),
        say: ['It is quiet.', 'It has not been quiet since I was young.'] },
      { when: () => true,
        say: ['Mosshide does not chase. That is the thing about it.',
          'It fills the wood instead, and then the wood is it.',
          'East, past the second camp. Go in. Do not stand still.'] },
    ],
  },
  {
    id: 'tam', name: 'ELDER TAM', region: 'hollowroot', at: [1090, 1384],
    colour: 0x8a6a3a, role: 'elder', gives: 'roothome', turns: 'roothome',
    lines: [
      { when: (p) => p.questDone('roothome'),
        say: ['A ring of mushrooms and a silence in the middle of it.',
          'My grandmother said not to walk into that clearing. Now I know.'] },
      { when: (p) => p.has('bramble-thorn', 6),
        say: ['Thorns. Six. That will hold the ladders another season.'] },
      { when: () => true,
        say: ['Five floors, all of them inside the trunk, and the tree does not',
          'mind. We have asked it.',
          'There is a clearing north-east nobody walks into. Find out why.'] },
    ],
  },
  {
    id: 'ivy', name: 'IVY THE SCOUT', region: 'hollowroot', at: [1064, 1420],
    colour: 0x2f5f27, role: 'ranger', gives: null, turns: null,
    lines: [
      { when: (p) => p.slain.has('whisperweed'),
        say: ['You got the weed. That was not one plant, you know.',
          'It never is.'] },
      { when: () => true,
        say: ['Keep to the road and you keep your legs.',
          'There is a chapel sunk into the ground west of here. Old. Older',
          'than Roothome. And something called Whisperweed south of it.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Sunken Stair ──
  {
    id: 'orin', name: 'BROTHER ORIN', region: 'sunkenstair', at: [150, 1244],
    colour: 0xefe6cf, role: 'monk', gives: 'monk', turns: 'monk',
    lines: [
      { when: (p) => p.questDone('monk'),
        say: ['Three stones, and somebody stood at all of them.',
          'That is more than the last four hundred years managed.'] },
      { when: (p) => p.found.size >= 3,
        say: ['You have been to the stones. I can tell. People come back',
          'quieter.'] },
      { when: (p) => p.slain.has('grott'),
        say: ['The Gate-Keeper is down and the gate is open.',
          'Down the far side is the Anurath Basin. The capital is in the',
          'bottom of it, and most of the capital is under water.'] },
      { when: () => true,
        say: ['Thirty treads, each one thirty feet. Somebody built this.',
          'At the top is the Stairhead Gate and Grott is sitting in it.',
          'He has been sitting in it since before the city drowned.'] },
    ],
  },
  {
    id: 'hask', name: 'HASK THE TOLLKEEPER', region: 'sunkenstair', at: [-140, 1214],
    colour: 0x8b8578, role: 'guard', gives: 'toll', turns: 'toll',
    lines: [
      { when: (p) => p.questDone('toll'),
        say: ['Cleared. I can go back to charging people.',
          'You will not be charged. Consider it professional courtesy.'] },
      { when: (p) => p.camps.size >= 1,
        say: ['You cleared one. I heard it from here.'] },
      { when: () => true,
        say: ['Toll is two froglets. I am not going to collect it.',
          'Something has moved onto the stair and it is not paying either.',
          'Clear a camp — any camp — and I will find you a proper glaive.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Anurath Basin ──
  {
    id: 'vess', name: 'CHANCELLOR VESS', region: 'anurath', at: [-160, 538],
    colour: 0xd8d4c6, role: 'noble', gives: 'crown', turns: 'crown',
    lines: [
      { when: (p) => p.questDone('crown'),
        say: ['A corner of it. After four hundred years, a corner.',
          'Take the Cutter’s Way east. The Great Quarry is still working and',
          'the Quarry-Hand is still throwing rocks at anyone who asks why.'] },
      { when: (p) => p.found.has('throneless-hall'),
        say: ['You went into the hall. Was the seat still there?',
          'No. Of course not. Give me what you did find.'] },
      { when: (p) => p.slain.has('stonewalks'),
        say: ['The Stone That Walks has stopped walking.',
          'The forecourt is quiet for the first time in my life.'] },
      { when: () => true,
        say: ['Chancellor of what, you are wondering. Of this. All of this.',
          'A bowl with a city in the bottom and the sea in the city.',
          'The Stone That Walks is in the palace forecourt. It has been',
          'pacing since the water came. Kill it and I will call you a knight.'] },
    ],
  },
  {
    id: 'lume', name: 'ARCHIVIST LUME', region: 'anurath', at: [-382, 394],
    colour: 0x7d94ad, role: 'scholar', gives: 'library', turns: 'library',
    lines: [
      { when: (p) => p.questDone('library'),
        say: ['The seal reads: BY ORDER, THE GUARDIANS ARE SET.',
          'Set by whom, it does not say. It never says.'] },
      { when: (p) => p.found.has('drowned-library'),
        say: ['You got in. You actually got in.', 'Give me the seal. Carefully.'] },
      { when: () => true,
        say: ['Every book in the world is in there and every one of them is ruined.',
          'I am cataloguing them anyway. It is what I do.',
          'West of the palace. Down the stair. Bring me the seal off the door.'] },
    ],
  },
  {
    id: 'rell', name: 'CAPTAIN RELL', region: 'anurath', at: [-100, 730],
    colour: 0x565f6b, role: 'guard', gives: 'watch', turns: 'watch',
    lines: [
      { when: (p) => p.questDone('watch'),
        say: ['He was the last of my company. Now he is not anything.',
          'Thank you. I could not have done it.'] },
      { when: (p) => p.slain.has('sableknight'),
        say: ['It is done, then.', 'Say it plainly. I would rather hear it plainly.'] },
      { when: () => true,
        say: ['I hold the King’s Bridge. There is no king and half a bridge.',
          'East of the city there is a knight in black who does not know the',
          'palace fell. He is still on duty. Put him off it.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Great Quarry ──
  {
    id: 'gost', name: 'FOREMAN GOST', region: 'quarry', at: [1514, 766],
    colour: 0x9a938a, role: 'elder', gives: 'cutters', turns: 'cutters',
    lines: [
      { when: (p) => p.questDone('cutters'),
        say: ['Five stones. That is the last of the order.',
          'Ninety years late. Nobody is coming to collect it.',
          'If you are going on: the Salt Road runs west out of the capital',
          'into Gravewater. Take salt. Take a great deal of salt.'] },
      { when: (p) => p.has('cut-stone', 5),
        say: ['That is cut stone. Proper cut stone.', 'Give it here.'] },
      { when: (p) => p.questStage('cutters') > 0,
        say: ['Five Cut Stone. From the pits, not off the floor.'] },
      { when: () => true,
        say: ['You want to know what we are digging for.',
          'So do I. The order came from the Hollow City.',
          'The Hollow City has been empty for four hundred years.',
          'We are still filling it.'] },
    ],
  },
  {
    id: 'mab', name: 'MAB THE CUTTER', region: 'quarry', at: [1542, 798],
    colour: 0xb0a68c, role: 'worker', gives: 'deepcut', turns: 'deepcut',
    lines: [
      { when: (p) => p.questDone('deepcut'),
        say: ['So it was a Glassback. I said it was a Glassback.',
          'Gost owes me four froglets and an apology.'] },
      { when: (p) => p.slain.has('glassback'),
        say: ['It is dead? Down there? Say that again slowly.'] },
      { when: (p) => p.found.has('deepcut'),
        say: ['You saw the mouth of it. Now go in.'] },
      { when: () => true,
        say: ['The Deepcut goes further down than the foreman admits.',
          'Two of ours went in and one came out and he has not spoken since.',
          'Find the mouth. It is west of the pits, behind the spoil.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Glassfen ──
  {
    id: 'saro', name: 'ELDER SARO', region: 'glassfen', at: [-1232, 750],
    colour: 0x5f8a6a, role: 'elder', gives: 'glasshook', turns: 'glasshook',
    lines: [
      { when: (p) => p.questDone('glasshook'),
        say: ['Mirror glass. The fen makes it by lying perfectly still.',
          'So do we. That is the arrangement.'] },
      { when: (p) => p.has('mirror-glass', 4),
        say: ['Four. Lay them down there, face up.'] },
      { when: () => true,
        say: ['We fish. You want to know what we catch. Everybody does.',
          'Bring me four Mirror Glass and I will trade you something',
          'that makes things look at your armour instead of at you.'] },
    ],
  },
  {
    id: 'hermit', name: 'THE HERMIT OF TWO SKIES', region: 'glassfen',
    at: [-1420, 950], colour: 0xa8cfe2, role: 'hermit',
    gives: 'mirror', turns: 'mirror',
    lines: [
      { when: (p) => p.questDone('mirror'),
        say: ['On its roof. Complete and undamaged, on its ROOF.',
          'I have been saying it for years. Thank you for looking.'] },
      { when: (p) => p.found.has('upside-house'),
        say: ['You saw it. Describe it. Do not leave anything out.'] },
      { when: () => true,
        say: ['There are two skies here and one of them is underneath you.',
          'West, past the shallows, there is a cottage standing on its roof.',
          'Go and look at it and come back and tell me I am not mad.'] },
    ],
  },

  // ─────────────────────────────────────────────────── Gravewater ──
  {
    id: 'keeper', name: 'THE GRAVEKEEPER', region: 'gravewater', at: [-1618, 54],
    colour: 0x8d939a, role: 'hermit', gives: 'gravekeeper', turns: 'gravekeeper',
    lines: [
      { when: (p) => p.questDone('gravekeeper') && p.slain.has('gravewater'),
        say: ['Salted, and the big one down as well.',
          'Go north-east. The Choir Cliffs sing, and Nix is what they are',
          'singing about. You will hear the Stone Organ before you see it.'] },
      { when: (p) => p.questDone('gravekeeper'),
        say: ['Salted. They will lie still a while longer.'] },
      { when: (p) => p.has('grave-salt', 6),
        say: ['Six. That is a season.', 'Put it down there, gently.'] },
      { when: () => true,
        say: ['They buried them in the shallows because the ground was soft.',
          'Soft ground does not keep anything.',
          'Six salt. It is the only thing they respect.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Thirstlands ──
  {
    id: 'zib', name: 'ZIB OF SANDREED', region: 'thirstlands', at: [1744, 310],
    colour: 0xe0cb96, role: 'trader', gives: 'sandreed', turns: 'sandreed',
    lines: [
      { when: (p) => p.questDone('sandreed'),
        say: ['Sun glass. Lightning strikes the dunes and leaves it behind.',
          'I sell it to the capital. The capital is under water. It is a',
          'difficult market.'] },
      { when: (p) => p.has('sand-glass', 5),
        say: ['Five. Do not put them down hard.'] },
      { when: () => true,
        say: ['An oasis, a market, and no questions asked. That is Sandreed.',
          'Bring me five Sun Glass off the dunes and we will do business.'] },
    ],
  },
  {
    id: 'oss', name: 'OSS THE DIGGER', region: 'thirstlands', at: [1900, -56],
    colour: 0xa8906a, role: 'worker', gives: 'pyramid', turns: 'pyramid',
    lines: [
      { when: (p) => p.questDone('pyramid'),
        say: ['I dug out a door and a thing came up out of it.',
          'That is the last door I dig out.'] },
      { when: (p) => p.slain.has('sandreaver'),
        say: ['You got it? Under the sand? How did you even SEE it?'] },
      { when: () => true,
        say: ['Buried to the shoulders and I found the door.',
          'Then something started travelling under the dunes.',
          'The wave is the only warning you get. Watch the sand.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Choir Cliffs ──
  {
    id: 'chorister', name: 'THE LAST CHORISTER', region: 'choircliffs',
    at: [700, -8], colour: 0xc9a227, role: 'monk', gives: 'choir', turns: 'choir',
    lines: [
      { when: (p) => p.questDone('choir') && p.slain.has('nix'),
        say: ['That was it. That was the note.',
          'Four hundred years and it was a B flat.',
          'The Ash Road goes east from here into the Emberwaste. Varn is',
          'there, and Varn comes RUNNING. Do not let him start.'] },
      { when: (p) => p.found.has('the-note'),
        say: ['You have it. I can see you have it.', 'Sing it. Sing it here.'] },
      { when: () => true,
        say: ['The wind does the singing now. It gets it nearly right.',
          'One note short, and it has been one note short since Nix.',
          'It is written down somewhere out on the cliffs.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Boneflats ──
  {
    id: 'gale', name: 'GALE THE PICKER', region: 'boneflats', at: [-676, -294],
    colour: 0xb8b2a0, role: 'worker', gives: 'bones', turns: 'bones',
    lines: [
      { when: (p) => p.questDone('bones'),
        say: ['Bone meal. It goes in the fields down south.',
          'Do not tell them where it comes from.'] },
      { when: (p) => p.has('bone-meal', 8),
        say: ['Eight. Sack’s over there.'] },
      { when: () => true,
        say: ['The ribs are not rocks. You worked that out, I hope.',
          'There is a skull the size of a hill out west and you can walk in',
          'through the eye. People have. Some came out.',
          'Bring me eight Bone Meal and I will make it worth the walk.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Drowned Keep ──
  {
    id: 'nim', name: 'NIM THE ROWER', region: 'drownedkeep', at: [1136, -132],
    colour: 0x5a7a66, role: 'fisher', gives: 'lake', turns: 'lake',
    lines: [
      { when: (p) => p.questDone('lake'),
        say: ['We rowed out to keep him company. That is all it ever was.',
          'Now nobody has to.'] },
      { when: (p) => p.slain.has('dolmath'),
        say: ['He is down? Then we can stop.', 'Four generations, and we can stop.'] },
      { when: (p) => p.questStage('lake') > 0,
        say: ['He held the keep when it was dry. He is still holding it.'] },
      { when: () => true,
        say: ['You want to know why we row out at night.',
          'Ask me properly and I will tell you properly.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Emberwaste ──
  {
    id: 'ashfarer', name: 'THE ASHFARER', region: 'emberwaste', at: [1396, -750],
    colour: 0xd8916a, role: 'ranger', gives: 'ashfall', turns: 'ashfall',
    lines: [
      { when: (p) => p.questDone('ashfall') && p.slain.has('varn'),
        say: ['It will not grow back in my life. It might in yours.',
          'North-west from here the ground stops being ash and starts being',
          'bone. That is the Spine. Huldr turns, and the turn is the attack.'] },
      { when: (p) => p.slain.has('cindren'),
        say: ['The Second Fire is out?', 'Say it again. Slowly.'] },
      { when: () => true,
        say: ['This was forest. All of it, out to the cliffs.',
          'Varn is the one who came running. Cindren is what was left after.',
          'And east, in the mountain, Volkh eats the fire and breathes it',
          'back out bigger. It has been doing that for two hundred years.'] },
    ],
  },

  // ─────────────────────────────────────────────────── Cindermaw ──
  {
    id: 'sonn', name: 'SONN THE FIRE-TENDER', region: 'cindermaw',
    at: [1712, -1236], colour: 0xffca4a, role: 'worker',
    gives: 'volkh', turns: 'volkh',
    lines: [
      { when: (p) => p.questDone('volkh'),
        say: ['Empty. The caldera is empty.',
          'I have tended this fire since I was nine and I do not know what',
          'it is for now. I will keep tending it.'] },
      { when: (p) => p.slain.has('emberthrone'),
        say: ['You went down INTO it?', 'And came out. Say that part again.'] },
      { when: (p) => p.slain.has('volkh'),
        say: ['The Ember-Eater is down. Good.',
          'Now: there is something sitting in the caldera. We do not look at',
          'it and we do not talk about it. You should go and look at it.'] },
      { when: () => true,
        say: ['Volkh eats the fire and breathes it out bigger.',
          'It has been doing that for two hundred years and the mountain has',
          'got hotter every one of them.',
          'It is on the west shoulder. Take something that does not burn.'] },
    ],
  },
  {
    id: 'vail', name: 'KEEPER VAIL', region: 'cindermaw', at: [1740, -1210],
    colour: 0xff8a3c, role: 'monk', gives: 'rimtemple', turns: 'rimtemple',
    lines: [
      { when: (p) => p.questDone('volkh'),
        say: ['The caldera is empty. In four hundred years it has never been',
          'empty.', 'I do not know what we keep the fire for now.'] },
      { when: (p) => p.questDone('rimtemple'),
        say: ['The fire is up again. Thank you.',
          'There is something sitting IN the caldera. We do not look at it.'] },
      { when: (p) => p.has('obsidian-chip', 3),
        say: ['Three chips. That will hold it a month.'] },
      { when: () => true,
        say: ['We have not let the fire go out. It has come close twice.',
          'Three Obsidian Chip. Off the black rock, not out of the vents.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Spine ──
  {
    id: 'scout', name: 'THE LAST SCOUT', region: 'spine', at: [-282, -872],
    colour: 0x7d7a74, role: 'ranger', gives: null, turns: null,
    lines: [
      { when: (p) => p.slain.has('huldr'),
        say: ['You went through the Eye and you came back out of it.',
          'The Hollow City is north-east. The wall is still up and the gate',
          'is barred from the INSIDE. Think about that on the way.'] },
      { when: () => true,
        say: ['This is the last fire before the ridge. I keep it lit and I do',
          'not go further.',
          'There is a hole through the ridge — the Eye of the Deep. Huldr is',
          'in it. It turns, and the turn is the attack. That is all I have.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Moonshelf ──
  {
    id: 'sela', name: 'SELA THE ASTRONOMER', region: 'moonshelf', at: [176, -992],
    colour: 0xcfe0ff, role: 'scholar', gives: 'moon', turns: 'moon',
    lines: [
      { when: (p) => p.questDone('moon'),
        say: ['The chart is finished. It took eleven years and one afternoon.',
          'Come back at night. It is always night. Come back anyway.'] },
      { when: (p) => p.slain.has('moonwake'),
        say: ['It walked the shelf every night of my life.',
          'I am going to sleep. I have not tried it in a while.'] },
      { when: (p) => p.found.has('floatstones'),
        say: ['Nine boulders, hanging exactly where they stopped.',
          'Now deal with the thing that walks past them.'] },
      { when: () => true,
        say: ['We are above the cloud, so it is always night, so we count.',
          'I stopped mid-constellation because something walks the shelf.',
          'West of here, nine stones hang in the air. Start there.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Palewood ──
  {
    id: 'hoyd', name: 'HOYD OF THE LAST LANTERN', region: 'palewood',
    at: [-1556, -832], colour: 0xd0cfc6, role: 'hermit',
    gives: 'palewood', turns: 'palewood',
    lines: [
      { when: (p) => p.questDone('palewood'),
        say: ['A door with nothing behind it and a hollow with nothing in it.',
          'I have kept a lantern lit here for thirty years for that.',
          'Worth it. I would rather know.'] },
      { when: (p) => p.found.has('white-door'),
        say: ['You opened it. What was behind it?',
          'The Palewood. Exactly as it was. Yes. That is what I got too.'] },
      { when: () => true,
        say: ['Everything here is the colour of fog, including the things.',
          'There is a door out east attached to nothing at all.',
          'And the fog goes into a hollow north of it and does not come out.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Hollow City ──
  {
    id: 'clerk', name: 'THE LAST CLERK', region: 'hollowcity', at: [862, -1392],
    colour: 0x74706a, role: 'scholar', gives: 'undercity', turns: 'undercity',
    lines: [
      { when: (p) => p.questDone('undercity'),
        say: ['There is a city under the city and it is in better repair.',
          'I have filed that. I do not know who reads my filings.',
          'North-west is the Frostmarch and the Hoarfrost Hold. Brack is',
          'there. Three strokes, always three, and never a pause between.'] },
      { when: (p) => p.found.has('undercity'),
        say: ['You found the stair down. Good. Now the gate.'] },
      { when: (p) => p.slain.has('hollowking'),
        say: ['He wore a crown once. He still behaved as though he did.',
          'The market is quiet. It was always quiet. Now it is quiet the',
          'right way.'] },
      { when: () => true,
        say: ['Stalls, awnings, prices chalked up, and nobody.',
          'A million frogs lived here. The walls are still up and the gate is',
          'barred from the inside, which is the part nobody explains.',
          'There is an Undercity. I have the plan. I would like it verified.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Glimmerwood ──
  {
    id: 'iri', name: 'IRI OF LUMEN', region: 'glimmerwood', at: [-176, -1492],
    colour: 0x8fe8ff, role: 'trader', gives: 'lumen', turns: 'lumen',
    lines: [
      { when: (p) => p.questDone('lumen'),
        say: ['We grow the light. You plant a shard and you wait.',
          'It is not complicated. It is just slow.'] },
      { when: (p) => p.has('prism-shard', 4),
        say: ['Four shards. Hold them away from your face.'] },
      { when: () => true,
        say: ['The rocks are up in the air and the plants are lit from inside.',
          'Both of those are the Heartshard’s fault and we are grateful.',
          'Bring me four Prism Shard and I will fit you out.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Frostmarch ──
  {
    id: 'hearth', name: 'THE HEARTHWIFE', region: 'frostmarch', at: [-1136, -1312],
    colour: 0xdfeaff, role: 'elder', gives: 'coldhearth', turns: 'coldhearth',
    lines: [
      { when: (p) => p.questDone('coldhearth') && p.slain.has('brack'),
        say: ['Warm. You have no idea what that word means up here.',
          'And Brack is down. Then the only road left is the Sunderway.',
          'The land stops. There is a bridge. Arkos built it and Arkos has',
          'never once let anybody use it.'] },
      { when: (p) => p.questDone('coldhearth'),
        say: ['Warm.', 'You have no idea what that word means up here.'] },
      { when: (p) => p.has('ember-glass', 3),
        say: ['Ember glass. Three pieces. That will catch.'] },
      { when: () => true,
        say: ['The hearth went out before my mother was born.',
          'Ember glass will light it. Three pieces, from the waste.',
          'It is a long way. Bring a coat.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Rimefang ──
  {
    id: 'pilgrim', name: 'THE PILGRIM', region: 'rimefang', at: [-1776, -1792],
    colour: 0xffffff, role: 'monk', gives: 'tooth', turns: 'tooth',
    lines: [
      { when: (p) => p.questDone('tooth'),
        say: ['Eleven years to reach a door and one afternoon to walk through it.',
          'There was nothing inside. I am not disappointed. I am finished.'] },
      { when: (p) => p.slain.has('rimeglass'),
        say: ['Cold enough that the air fell out of the sky around it.',
          'And you went in anyway.'] },
      { when: () => true,
        say: ['Eleven years I have been trying to reach that door.',
          'The wind comes straight at it. That is deliberate.',
          'Three Rime Core and I can make the last stretch. Or you can.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Sunderway ──
  {
    id: 'span', name: 'THE NEAR-SIDE GUARD', region: 'sunderway', at: [420, -1634],
    colour: 0x8a867c, role: 'guard', gives: null, turns: null,
    lines: [
      { when: (p) => p.slain.has('arkos'),
        say: ['He is off the bridge. Four hundred years and he is off the bridge.',
          'Walk it. Nobody alive has walked it.',
          'On the far side is the Ashen Throne, and Zehl is standing in the',
          'gate. After Zehl there is only the seat, and what is on it.'] },
      { when: () => true,
        say: ['The land stops. You can see that it stops.',
          'Arkos built the bridge in one night and has never let anybody use',
          'it. He is not cruel about it. He is just very clear.'] },
    ],
  },

  // ─────────────────────────────────────────────────── the Ashen Throne ──
  {
    id: 'herald', name: 'THE HERALD', region: 'ashenthrone', at: [0, -1804],
    colour: 0x8f8a84, role: 'noble', gives: null, turns: null,
    lines: [
      { when: (p) => p.slain.has('frogath'),
        say: ['The seat is empty.', 'It was empty before you got here.',
          'That is the part nobody will believe.'] },
      { when: (p) => p.slain.has('zehl'),
        say: ['Zehl is down. The gate is open.',
          'He is behind it. He has always been behind it.'] },
      { when: (p) => p.slain.size >= 12,
        say: ['Twelve.', 'Zehl will see you now.'] },
      { when: () => true,
        say: ['Thirteen guardians, and then him.',
          'You are not ready. Nobody was ever ready.',
          'Zehl is in the gate behind me. Everything else is behind Zehl.'] },
    ],
  },
];

export const NPC_BY_ID = new Map(NPCS.map((n) => [n.id, n]));

/** What this NPC is saying today — the first line-set whose test holds. */
export function npcSays(npc, p) {
  for (const l of npc.lines) if (l.when(p)) return l.say;
  return ['...'];
}

// ═════════════════════════════════════════════════════════════════ secrets ══

/**
 * The things nobody tells you about.
 *
 * Keyed by the site id in the region table, so finding one is a matter of
 * walking into it and pressing a key. Each gives something, and the something
 * is never only flavour: an easter egg you cannot tell you found is not an
 * easter egg.
 *
 * None of these is required for the main line. Six of them together are worth
 * a map of the whole realm, which is the Collector's quest — so exploring is
 * paid for twice.
 */
export const SECRETS = {
  // ── the south ──
  'listening-stone': {
    title: 'THE LISTENING STONE',
    say: ['The stone is warm on one side.',
      'Put your ear to it and you can hear something enormous breathing,',
      'a very long way north.'],
    gives: [{ id: 'bog-berry', n: 4 }], xp: 60,
  },
  reedcaves: {
    title: 'THE REED HOLLOWS',
    say: ['A crack in the bank, and a room behind it with a bed of reeds.',
      'Something slept here for a long time and left recently.'],
    gives: [{ id: 'reed-fibre', n: 6 }, { id: 'lily-silk', n: 2 }], xp: 80,
  },
  stoneboat: {
    title: 'THE STONE BOAT',
    say: ['A fishing boat, in the middle of a wheat field, carved from granite.',
      'Mast, oars, nets, all of it stone, all of it perfect.',
      'There is a name on the bow and it is a name nobody in Harrowmead has.'],
    gives: [{ id: 'mill-grain', n: 6 }, { id: 'harrow-loaf', n: 2 }], xp: 120,
  },
  'drowned-bell': {
    title: 'THE DROWNED BELL',
    say: ['You ring it three times.',
      'On the third, something a long way down rings back.'],
    gives: [{ id: 'bell-clapper', n: 1 }], xp: 140,
  },
  'mushroom-ring': {
    title: 'THE RING',
    say: ['Thirteen mushrooms, evenly spaced, taller than you are.',
      'You step into the middle and the entire wood stops making noise.',
      'When you step out again it starts, mid-birdsong, where it left off.'],
    gives: [{ id: 'glow-cap', n: 2 }, { id: 'bramble-thorn', n: 4 }], xp: 180,
  },
  sunkenchapel: {
    title: 'THE SUNKEN CHAPEL',
    say: ['A chapel, three-quarters underground, with the spire coming up',
      'through the leaf litter like a tooth.',
      'Inside, somebody has been leaving offerings. Recently.'],
    gives: [{ id: 'bronze-tanto', n: 1 }, { id: 'choir-crystal', n: 1 }], xp: 200,
  },

  // ── the middle ──
  stairfoot: {
    title: 'THE STAIRFOOT SHRINE',
    say: ['Somebody has left offerings here for a very long time.',
      'The newest is two hundred years old.'],
    gives: [{ id: 'smoked-fish', n: 2 }], xp: 150,
  },
  'stairhead-gate': {
    title: 'THE STAIRHEAD GATE',
    say: ['Thirty treads up and the gate is still standing.',
      'The arch is scraped. Something enormous has gone through it, more',
      'than once, in both directions.'],
    gives: [{ id: 'cut-stone', n: 4 }], xp: 200,
  },
  'drowned-library': {
    title: 'THE DROWNED LIBRARY',
    say: ['Shelves to the ceiling and the ceiling is under water.',
      'Every book in the world, ruined, catalogued, and still in order.',
      'The seal on the door reads: BY ORDER, THE GUARDIANS ARE SET.'],
    gives: [{ id: 'library-seal', n: 1 }, { id: 'hollow-iron', n: 1 }], xp: 320,
  },
  'throneless-hall': {
    title: 'THE THRONELESS HALL',
    say: ['A hall built for a seat, and no seat in it.',
      'Marks on the floor where it stood. Drag marks, going north.',
      'In the rubble: a corner of something that was gold.'],
    gives: [{ id: 'crown-fragment', n: 1 }], xp: 340,
  },
  deepcut: {
    title: 'THE DEEPCUT',
    say: ['The mouth is timbered and the timber is newer than the quarry.',
      'Cold air comes out of it. Cold air, and a sound like glass settling.'],
    gives: [{ id: 'cut-stone', n: 6 }, { id: 'mirror-glass', n: 1 }], xp: 300,
  },
  'sledge-shrine': {
    title: 'THE SLEDGE SHRINE',
    say: ['A shrine to a hammer. There is a hammer on it.',
      'It has been there so long the stone has taken its shape.'],
    gives: [{ id: 'quarry-maul', n: 1 }], xp: 280,
  },
  'mirror-shrine': {
    title: 'THE SHRINE OF TWO SKIES',
    say: ['You stand on the slab and the water round it goes perfectly still.',
      'There is a sky above you and a sky below you and you are in between.'],
    gives: [{ id: 'mirror-glass', n: 2 }, { id: 'mirror-clam', n: 2 }], xp: 300,
  },
  'upside-house': {
    title: 'THE UPSIDE HOUSE',
    say: ['A cottage, standing on its roof, complete and undamaged.',
      'The door works. The lamp inside is lit. There is a cup on the ceiling',
      'and it is the right way up.'],
    gives: [{ id: 'glass-sabre', n: 1 }], xp: 380,
  },
  barrowfields: {
    title: 'THE BARROWFIELDS',
    say: ['Nine hundred mounds in rows, and the rows go under the water.',
      'Somebody has been salting the near ones. Only the near ones.'],
    gives: [{ id: 'grave-salt', n: 4 }, { id: 'lantern-oil', n: 1 }], xp: 340,
  },
  saltwalk: {
    title: 'THE SALT WALK',
    say: ['A causeway of packed salt across the shallows.',
      'They walk the dead out along it. It has not been used in a while and',
      'it is worn in the middle, which means it was used a great deal.'],
    gives: [{ id: 'grave-salt', n: 3 }], xp: 260,
  },

  // ── the frontier ──
  bonepit: {
    title: 'THE BONE PIT',
    say: ['Something the size of a hill died here and the sand is still',
      'moving off it.',
      'There is a rib you can walk the length of.'],
    gives: [{ id: 'bone-meal', n: 5 }, { id: 'sand-glass', n: 2 }], xp: 380,
  },
  'buried-gate': {
    title: 'THE BURIED GATE',
    say: ['An archway, standing in sand, leading from nothing to nothing.',
      'There are hinge-marks. There was a door. There was never a wall.'],
    gives: [{ id: 'sand-glass', n: 3 }, { id: 'god-shard', n: 1 }], xp: 420,
  },
  choirhold: {
    title: 'THE CHOIRHOLD',
    say: ['Seats cut into the rock, facing out over nothing at all.',
      'The acoustics are perfect. That is clearly the point.'],
    gives: [{ id: 'choir-crystal', n: 2 }, { id: 'choir-honey', n: 1 }], xp: 340,
  },
  'the-note': {
    title: 'THE LAST NOTE',
    say: ['A scrap of paper, weighted with a stone.',
      'One note, and underneath it: "for when the wind forgets".'],
    gives: [{ id: 'choir-note', n: 1 }], xp: 300,
  },
  windstair: {
    title: 'THE WINDSTAIR',
    say: ['A tower with no roof and a stair up the outside of it.',
      'From the top you can see the Stone Organ, the Hollow City wall, and',
      'a very long way north to something smoking.'],
    gives: [{ id: 'choir-crystal', n: 3 }], xp: 360,
  },
  oathbreaker: {
    title: 'THE OATHBREAKER',
    say: ['A sword the length of a bridge, driven point-first through the ribs',
      'and a long way into the ground under them.',
      'There is writing on the guard, forty feet up, and it is upside down.',
      'It reads: I SWORE I WOULD NOT.',
      'The grip is wrapped for a hand nothing has.'],
    gives: [{ id: 'hollow-iron', n: 3 }, { id: 'god-shard', n: 1 }], xp: 480,
  },
  'seventh-rib': {
    title: 'THE SEVENTH RIB',
    say: ['You are standing inside a bone.',
      'There are six more behind you and the ridge goes on past sight.'],
    gives: [{ id: 'bone-meal', n: 4 }, { id: 'spine-marrow', n: 1 }], xp: 380,
  },
  'keep-arena': {
    title: 'THE SUNKEN RING',
    say: ['Tiers of seats round a floor of sand, half of it under the lake.',
      'There is a slate with odds chalked on it and the chalk is not old.',
      'Somebody is still taking bets on something.'],
    gives: [{ id: 'moon-silver', n: 1 }, { id: 'kings-broth', n: 1 }], xp: 460,
  },
  'burnt-village': {
    title: 'WHAT WAS EMBERFORD',
    say: ['Doorways, chimneys, and nothing else.',
      'The doorways are all open. Every single one. They got out.'],
    gives: [{ id: 'ember-glass', n: 3 }], xp: 440,
  },
  kiln: {
    title: 'THE OLD KILN',
    say: ['A kiln the size of a house, and it is still warm.',
      'Nobody has fired it in two hundred years, which raises a question',
      'nobody in the Ashfall Camp wants to be asked.'],
    gives: [{ id: 'obsidian-chip', n: 3 }, { id: 'ember-root', n: 2 }], xp: 480,
  },
  'glass-cave': {
    title: 'THE GLASS THROAT',
    say: ['A lava tube, cooled, and the walls are glass all the way in.',
      'You can see yourself going in, and going in, and going in.'],
    gives: [{ id: 'obsidian-chip', n: 4 }, { id: 'ember-brand', n: 1 }], xp: 560,
  },
  rimtemple: {
    title: 'THE RIM TEMPLE',
    say: ['Built on the lip of a caldera, facing in.',
      'They have not let the fire go out. Given what is down there, that may',
      'not have been the plan they think it was.'],
    gives: [{ id: 'ember-root', n: 3 }], xp: 500,
  },
  vertebrae: {
    title: 'THE SEVENTH VERTEBRA',
    say: ['A room, and the room is a bone, and the bone is one of many.',
      'Somebody has been living in it. There is a fire and a tally on the',
      'wall and the tally stops.'],
    gives: [{ id: 'spine-marrow', n: 2 }], xp: 500,
  },
  floatstones: {
    title: 'THE UNFALLEN',
    say: ['Nine boulders, hanging in the air, exactly where they stopped.',
      'You can walk under them. You can push one. It comes back.'],
    gives: [{ id: 'moon-silver', n: 2 }, { id: 'star-chart', n: 1 }], xp: 540,
  },
  'white-door': {
    title: 'THE WHITE DOOR',
    say: ['A door, standing on its own in the fog, four storeys of it.',
      'It is not attached to anything. It is not a ruin — there was never a wall.',
      'You open it. Behind it is the Palewood, exactly as it was.',
      'You take the handle.'],
    gives: [{ id: 'white-door-handle', n: 1 }, { id: 'god-shard', n: 1 }], xp: 580,
  },
  'pale-hollow': {
    title: 'THE HOLLOW',
    say: ['The fog goes in here and does not come out.',
      'You follow it. It is a room. It is a perfectly ordinary room, with a',
      'chair in it, and the fog is sitting in the chair.'],
    gives: [{ id: 'moon-robe', n: 1 }], xp: 600,
  },

  // ── the end ──
  lastgate: {
    title: 'THE LAST GATE',
    say: ['Barred from the inside.',
      'Whatever the Hollow City was keeping out, it did not work,',
      'or it worked and the city starved.'],
    gives: [{ id: 'hollow-iron', n: 2 }], xp: 620,
  },
  undercity: {
    title: 'THE UNDERCITY',
    say: ['A stair down, and a city at the bottom in better repair than the',
      'one above it.',
      'The lamps are lit. Somebody is paying for the oil.'],
    gives: [{ id: 'hollow-iron', n: 3 }, { id: 'kings-broth', n: 2 }], xp: 700,
  },
  'singing-cave': {
    title: 'THE SINGING CAVE',
    say: ['Crystals from floor to ceiling, and they are all in tune.',
      'You hum, and eleven of them answer, and one of them is flat.'],
    gives: [{ id: 'prism-shard', n: 3 }], xp: 680,
  },
  'floating-stair': {
    title: 'THE FLOATING STAIR',
    say: ['Forty steps, going up, unsupported, ending in the air.',
      'You climb them. There is nothing at the top. The view is extraordinary.'],
    gives: [{ id: 'prism-shard', n: 2 }, { id: 'glow-cap', n: 2 }], xp: 660,
  },
  'frozen-fall': {
    title: 'THE STOPPED FALL',
    say: ['A waterfall, frozen mid-fall, with fish in it.',
      'They are facing upstream. They were still swimming when it happened.'],
    gives: [{ id: 'rime-core', n: 2 }], xp: 700,
  },
  hoarfrost: {
    title: 'THE HOARFROST HOLD',
    say: ['A castle with the sea frozen halfway up its walls.',
      'The gate is open. Everything inside is exactly where it was put down.'],
    gives: [{ id: 'rime-core', n: 1 }, { id: 'rime-broth', n: 2 }], xp: 740,
  },
  'the-tooth': {
    title: 'THE TOOTH',
    say: ['A temple cut into the last peak, with the door facing the wind.',
      'That is deliberate. Everything about this place is deliberate.'],
    gives: [{ id: 'rime-core', n: 3 }], xp: 800,
  },
  'ice-caves': {
    title: 'THE BLUE THROAT',
    say: ['Ice going down further than the lamp reaches.',
      'There are shapes in the walls and you decide not to look closely.'],
    gives: [{ id: 'rime-core', n: 2 }, { id: 'moon-silver', n: 1 }], xp: 780,
  },
  'span-shrine': {
    title: 'THE FAR SIDE SHRINE',
    say: ['A shrine on the far side of the bridge, facing back the way you came.',
      'It is for people who made it across. There are two tokens on it.'],
    gives: [{ id: 'span-token', n: 2 }], xp: 820,
  },
  thronegate: {
    title: 'THE THRONE GATE',
    say: ['Every guardian passed through here on the way up.',
      'You can see where they scraped the arch.'],
    gives: [{ id: 'god-shard', n: 1 }], xp: 900,
  },
};

/** Every secret's id, for the tests and for the map's completion count. */
export const SECRET_IDS = Object.keys(SECRETS);
