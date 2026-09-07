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
 * A stage has a `text` (what the log says to do), a `where` (which region,
 * for the marker) and a `done(p)` predicate that reads the save. Nothing
 * anywhere fires an event to advance a quest: the stage is recomputed from
 * what the player has actually done. That means a quest cannot desynchronise
 * from the world — kill the boss before you are told to and the stage is
 * already complete when you are told to.
 *
 * ── dialogue ───────────────────────────────────────────────────────────────
 * An NPC's `lines` is a list of { when, say } — the first whose `when(p)`
 * holds is what they are saying today. So a villager comments on the boss you
 * killed this morning without anybody writing a trigger for it.
 */

/** The main line, in order. Its id is referenced by NPCs and the HUD. */
export const MAIN = 'main';

export const QUESTS = [
  {
    id: MAIN,
    name: 'THE FIRST CROAK',
    side: false,
    blurb: 'Something at the top of the world is calling the guardians home.',
    stages: [
      { text: 'Speak to Old Bram in Croakhollow.',
        where: 'shallows',
        done: (p) => p.questStage(MAIN) > 0 },
      { text: 'Leave the Shallows. Any road out will do.',
        where: 'shallows',
        done: (p) => p.seen.size >= 2 },
      { text: 'Put down a guardian. Either marsh has one.',
        where: 'mirefen',
        done: (p) => p.slain.size >= 1 },
      { text: 'Four guardians. The road up is watched.',
        where: 'sunkenstair',
        done: (p) => p.slain.size >= 4 },
      { text: 'Reach the Choir Cliffs and hear what they are singing.',
        where: 'choircliffs',
        done: (p) => p.seen.has('choircliffs') },
      { text: 'Eight guardians. The Hollow City will not open for less.',
        where: 'gravewater',
        done: (p) => p.slain.size >= 8 },
      { text: 'Take the Last Gate. The Hollow King is behind it.',
        where: 'hollowcity',
        done: (p) => p.slain.has('hollowking') },
      { text: 'Twelve guardians. Zehl is the last door.',
        where: 'frostmarch',
        done: (p) => p.slain.size >= 12 },
      { text: 'Zehl, the Final Guardian, at the Throne Gate.',
        where: 'ashenthrone',
        done: (p) => p.slain.has('zehl') },
      { text: 'FROGATH. He has been waiting the whole time.',
        where: 'ashenthrone',
        done: (p) => p.slain.has('frogath') },
    ],
  },

  // ─────────────────────────────────────────────────────────── side quests ──
  {
    id: 'stilts',
    name: 'NINE HUTS AND A ROPE',
    side: true,
    blurb: 'The Stilts has lost its bell-rope, and with it its warning.',
    stages: [
      { text: 'Find the Drowned Bell somewhere in Mirefen.',
        where: 'mirefen', done: (p) => p.found.has('drowned-bell') },
      { text: 'Bring the clapper back to Wade at The Stilts.',
        where: 'mirefen', done: (p) => p.questDone('stilts') },
    ],
    reward: { xp: 220, items: [{ id: 'mire-greaves', n: 1 }] },
  },
  {
    id: 'woodwarden',
    name: 'THE PATIENT THING',
    side: true,
    blurb: 'The Woodwarden has not slept. Something in the wood is growing.',
    stages: [
      { text: 'Put down Mosshide in the Bramblewood.',
        where: 'bramblewood', done: (p) => p.slain.has('mosshide') },
      { text: 'Tell the Woodwarden it is over.',
        where: 'bramblewood', done: (p) => p.questDone('woodwarden') },
    ],
    reward: { xp: 260, items: [{ id: 'bramble-edge', n: 1 }] },
  },
  {
    id: 'cutters',
    name: 'STILL CUTTING',
    side: true,
    blurb: 'Cutter’s Rest works a quarry nobody buys from. Ask why.',
    stages: [
      { text: 'Ask Foreman Gost what they are digging for.',
        where: 'quarry', done: (p) => p.questStage('cutters') > 0 },
      { text: 'Bring Gost five Cut Stone from the pits.',
        where: 'quarry', done: (p) => p.has('cut-stone', 5) },
      { text: 'Hand them over.',
        where: 'quarry', done: (p) => p.questDone('cutters') },
    ],
    reward: { xp: 300, items: [{ id: 'quarry-plate', n: 1 }] },
  },
  {
    id: 'gravekeeper',
    name: 'THEY DO NOT STAY DOWN',
    side: true,
    blurb: 'The Gravekeeper is out of salt and the water is rising.',
    stages: [
      { text: 'Gather six Grave Salt from Gravewater.',
        where: 'gravewater', done: (p) => p.has('grave-salt', 6) },
      { text: 'Take it to the Gravekeeper’s Lantern.',
        where: 'gravewater', done: (p) => p.questDone('gravekeeper') },
    ],
    reward: { xp: 380, items: [{ id: 'grave-shroud', n: 1 }] },
  },
  {
    id: 'choir',
    name: 'THE LAST NOTE',
    side: true,
    blurb: 'The Choir stopped mid-song. One note is missing.',
    stages: [
      { text: 'Find the Last Note in the Choir Cliffs.',
        where: 'choircliffs', done: (p) => p.found.has('the-note') },
      { text: 'Sing it back at the Choirhold.',
        where: 'choircliffs', done: (p) => p.questDone('choir') },
    ],
    reward: { xp: 420, items: [{ id: 'choir-saber', n: 1 }] },
  },
  {
    id: 'ashfall',
    name: 'WHAT BURNED',
    side: true,
    blurb: 'The Ashfall Camp remembers the Emberwaste being green.',
    stages: [
      { text: 'Put down Volkh, the Ember-Eater.',
        where: 'emberwaste', done: (p) => p.slain.has('volkh') },
      { text: 'Tell the camp.',
        where: 'emberwaste', done: (p) => p.questDone('ashfall') },
    ],
    reward: { xp: 520, items: [{ id: 'ember-cuirass', n: 1 }] },
  },
  {
    id: 'coldhearth',
    name: 'THE COLD HEARTH',
    side: true,
    blurb: 'A fire in the Frostmarch that has been out a long time.',
    stages: [
      { text: 'Bring three Ember Glass to the Cold Hearth.',
        where: 'frostmarch', done: (p) => p.has('ember-glass', 3) },
      { text: 'Light it.',
        where: 'frostmarch', done: (p) => p.questDone('coldhearth') },
    ],
    reward: { xp: 600, items: [{ id: 'frost-crown', n: 1 }] },
  },
  {
    id: 'collector',
    name: 'THE COLLECTOR',
    side: true,
    blurb: 'Someone in Croakhollow wants one of everything strange.',
    stages: [
      { text: 'Find four of the realm’s secrets.',
        where: 'shallows', done: (p) => p.found.size >= 4 },
      { text: 'Show Pel what you have found.',
        where: 'shallows', done: (p) => p.questDone('collector') },
    ],
    reward: { xp: 700, items: [{ id: 'map-realm', n: 1 }] },
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

// ══════════════════════════════════════════════════════════════════ people ══

/**
 * Who stands where, and what they say.
 *
 * `at` is a region-local hint; the overworld snaps it to standable ground the
 * same way it snaps a boss arena. `gives` is a quest they hand over when
 * spoken to, and `turns` a quest they will take the finished version of.
 */
export const NPCS = [
  {
    id: 'bram', name: 'OLD BRAM', region: 'shallows', at: [8, 462],
    colour: 0x6cc24a, gives: MAIN, turns: null,
    lines: [
      { when: (p) => p.slain.has('frogath'),
        say: ['You went up there.', 'And you came back down.',
              'Nobody has ever done the second part.'] },
      { when: (p) => p.slain.size >= 8,
        say: ['Eight of them.', 'The old songs only ever named six.',
              'Whatever is calling them, it is losing its voice.'] },
      { when: (p) => p.slain.size >= 1,
        say: ['You put one down. Good.',
              'They are not monsters, you know. They are GUARDIANS.',
              'Somebody set them to guard something. Go and find out what.'] },
      { when: () => true,
        say: ['You are the one who came out of the water, then.',
              'Fourteen guardians between here and the Ashen Throne.',
              'They have all started walking the same direction. North.',
              'Somebody has to go and look. It is not going to be me.'] },
    ],
  },
  {
    id: 'pel', name: 'PEL THE COLLECTOR', region: 'shallows', at: [-26, 486],
    colour: 0xd9743a, gives: 'collector', turns: 'collector',
    lines: [
      { when: (p) => p.questDone('collector'),
        say: ['A door with no wall. A bell nobody rang.',
              'I have catalogued stranger. Not much stranger.'] },
      { when: (p) => p.found.size >= 4,
        say: ['You FOUND them? All four?', 'Show me. Show me right now.'] },
      { when: () => true,
        say: ['There are things out there that do not belong to any region.',
              'A bell in the fen. An oak with a room in it.',
              'A note in the cliffs. A door in the Palewood attached to NOTHING.',
              'Bring me four and I will draw you a map worth having.'] },
    ],
  },
  {
    id: 'wade', name: 'WADE OF THE STILTS', region: 'mirefen', at: [-614, 462],
    colour: 0x53b7e8, gives: 'stilts', turns: 'stilts',
    lines: [
      { when: (p) => p.questDone('stilts'),
        say: ['Hear that? That is a village that knows when to run.'] },
      { when: (p) => p.found.has('drowned-bell'),
        say: ['You have the clapper. I can hear it from here.',
              'Hand it over and I will hang it tonight.'] },
      { when: () => true,
        say: ['Nine huts and a rope, and the rope is what matters.',
              'The bell went into the water forty years ago.',
              'Find its clapper and we can warn each other again.'] },
    ],
  },
  {
    id: 'warden', name: 'THE WOODWARDEN', region: 'bramblewood', at: [556, 244],
    colour: 0x4e9a3c, gives: 'woodwarden', turns: 'woodwarden',
    lines: [
      { when: (p) => p.questDone('woodwarden'),
        say: ['I slept.', 'First time in a year. Thank you.'] },
      { when: (p) => p.slain.has('mosshide'),
        say: ['It is quiet.', 'It has not been quiet since I was young.'] },
      { when: () => true,
        say: ['Mosshide does not chase. That is the thing about it.',
              'It fills the wood instead, and then the wood is it.',
              'Go in. Do not stand still.'] },
    ],
  },
  {
    id: 'gost', name: 'FOREMAN GOST', region: 'quarry', at: [694, -14],
    colour: 0x9a938a, gives: 'cutters', turns: 'cutters',
    lines: [
      { when: (p) => p.questDone('cutters'),
        say: ['Five stones. That is the last of the order.',
              'Ninety years late. Nobody is coming to collect it.'] },
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
    id: 'keeper', name: 'THE GRAVEKEEPER', region: 'gravewater', at: [-618, -152],
    colour: 0x8d939a, gives: 'gravekeeper', turns: 'gravekeeper',
    lines: [
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
  {
    id: 'chorister', name: 'THE LAST CHORISTER', region: 'choircliffs', at: [176, -464],
    colour: 0xc9a227, gives: 'choir', turns: 'choir',
    lines: [
      { when: (p) => p.questDone('choir'),
        say: ['That was it. That was the note.',
              'Four hundred years and it was a B flat.'] },
      { when: (p) => p.found.has('the-note'),
        say: ['You have it. I can see you have it.', 'Sing it. Sing it here.'] },
      { when: () => true,
        say: ['The wind does the singing now. It gets it nearly right.',
              'One note short, and it has been one note short since Nix.',
              'It is written down somewhere out on the cliffs.'] },
    ],
  },
  {
    id: 'ashfarer', name: 'THE ASHFARER', region: 'emberwaste', at: [696, -554],
    colour: 0xd8916a, gives: 'ashfall', turns: 'ashfall',
    lines: [
      { when: (p) => p.questDone('ashfall'),
        say: ['It will not grow back in my life.',
              'It might in yours. That is enough.'] },
      { when: (p) => p.slain.has('volkh'),
        say: ['The Ember-Eater is down?', 'Say it again. Slowly.'] },
      { when: () => true,
        say: ['This was forest. All of it, out to the cliffs.',
              'Volkh eats the fire and breathes it out bigger.',
              'It has been doing that for two hundred years.'] },
    ],
  },
  {
    id: 'hearth', name: 'THE HEARTHWIFE', region: 'frostmarch', at: [-476, -934],
    colour: 0xdfeaff, gives: 'coldhearth', turns: 'coldhearth',
    lines: [
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
  {
    id: 'zehl-herald', name: 'THE HERALD', region: 'ashenthrone', at: [0, -1084],
    colour: 0x8f8a84, gives: null, turns: null,
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
        say: ['Twelve guardians, and then Zehl, and then him.',
              'You are not ready. Nobody was ever ready.',
              'Come back when you have put twelve of them down.'] },
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
 * walking into it. Each gives something, and the something is never just
 * flavour: an easter egg you cannot tell you found is not an easter egg.
 */
export const SECRETS = {
  'drowned-bell': {
    title: 'THE DROWNED BELL',
    say: ['You ring it three times.',
          'On the third, something a long way down rings back.'],
    gives: [{ id: 'bell-clapper', n: 1 }], xp: 120,
  },
  'hollow-oak': {
    title: 'THE HOLLOW OAK',
    say: ['There is a room inside the tree.',
          'A stool, a cup, and a tally scratched into the wood: four hundred.',
          'Four hundred of what, it does not say.'],
    gives: [{ id: 'choir-crystal', n: 1 }, { id: 'cave-mushroom', n: 3 }], xp: 140,
  },
  'the-note': {
    title: 'THE LAST NOTE',
    say: ['A scrap of paper, weighted with a stone.',
          'One note, and underneath it: "for when the wind forgets".'],
    gives: [{ id: 'choir-note', n: 1 }], xp: 180,
  },
  'white-door': {
    title: 'THE WHITE DOOR',
    say: ['A door, standing on its own in the fog.',
          'It is not attached to anything. It is not a ruin — there was never a wall.',
          'You open it. Behind it is the Palewood, exactly as it was.',
          'You take the handle.'],
    gives: [{ id: 'white-door-handle', n: 1 }, { id: 'god-shard', n: 1 }], xp: 240,
  },
  'first-shrine': {
    title: 'THE LISTENING STONE',
    say: ['The stone is warm on one side.',
          'Put your ear to it and you can hear something enormous breathing,',
          'a very long way north.'],
    gives: [{ id: 'bog-berry', n: 4 }], xp: 60,
  },
  'stairfoot': {
    title: 'THE STAIRFOOT SHRINE',
    say: ['Somebody has left offerings here for a very long time.',
          'The newest is two hundred years old.'],
    gives: [{ id: 'bronze-tanto', n: 1 }], xp: 90,
  },
  'choirhold': {
    title: 'THE CHOIRHOLD',
    say: ['Seats cut into the rock, facing out over nothing at all.',
          'The acoustics are perfect. That is clearly the point.'],
    gives: [{ id: 'choir-crystal', n: 2 }], xp: 130,
  },
  'vertebrae': {
    title: 'THE SEVENTH VERTEBRA',
    say: ['You are standing inside a bone.',
          'There are six more behind you and the ridge goes on past sight.'],
    gives: [{ id: 'spine-marrow', n: 2 }], xp: 200,
  },
  'lastgate': {
    title: 'THE LAST GATE',
    say: ['Barred from the inside.',
          'Whatever the Hollow City was keeping out, it did not work,',
          'or it worked and the city starved.'],
    gives: [{ id: 'hollow-iron', n: 2 }], xp: 260,
  },
  'thronegate': {
    title: 'THE THRONE GATE',
    say: ['Every guardian passed through here on the way up.',
          'You can see where they scraped the arch.'],
    gives: [{ id: 'god-shard', n: 1 }], xp: 300,
  },
};
