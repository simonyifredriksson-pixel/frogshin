/**
 * The fourteen guardians of the dungeon.
 *
 * Each one is a different creature with a different way of fighting. Rather
 * than fourteen bespoke rigs, there is one parametric builder driven by a
 * spec table — silhouette, palette, head, limbs, weapon — which is what makes
 * a swamp hulk and a floating wraith come out of the same code without either
 * looking like a recolour of the other.
 *
 * Movesets are assembled from shared ATTACK PRIMITIVES (slam, combo, charge,
 * throw, spin, shockwave, volley, leap). Every primitive draws its danger on
 * the floor before it can hurt anyone, so a new boss cannot accidentally
 * invent an unfair attack — it can only recombine fair ones.
 */

import * as THREE from '../lib/three.module.js?v=v112';

const G = {
  sphere: new THREE.SphereGeometry(1, 12, 9),
  low: new THREE.SphereGeometry(1, 8, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 7),
  capsule: new THREE.CapsuleGeometry(1, 1, 3, 8),
  torus: new THREE.TorusGeometry(1, 0.12, 6, 20),
};

/**
 * The fourteen, in the order you meet them.
 *
 * `moves` is a weighted pool: the boss picks from it, so a duellist that also
 * throws feels different from one that only throws, without either needing
 * its own AI.
 */
export const GUARDIANS = [
  {
    id: 'grott', name: 'GROTT, THE GATE-KEEPER',
    body: 'hulk', skin: 0x6f7a3e, dark: 0x4a5228, trim: 0x9a7d33,
    head: 'toad', weapon: 'club', horns: 0, eyes: 0xff5a2c,
    moves: ['slam', 'slam', 'combo'],
    blurb: 'Slow. Enormous. Hits like a falling wall.',
  },
  {
    id: 'silt', name: 'SILT, WARDEN OF THE SHALLOWS',
    body: 'lean', skin: 0x4a6b6f, dark: 0x2e4a4e, trim: 0x8fc4c9,
    head: 'eel', weapon: 'spear', horns: 0, eyes: 0x8fe8ff,
    moves: ['leap', 'combo', 'leap'],
    blurb: 'Leaps the whole room and lands on your head.',
  },
  {
    id: 'brack', name: 'BRACK, THE THREE-STROKE',
    body: 'lean', skin: 0x7a4a2a, dark: 0x53301a, trim: 0xd9a05a,
    head: 'toad', weapon: 'twin', horns: 2, eyes: 0xffb03c,
    moves: ['combo', 'combo', 'charge'],
    blurb: 'Three strokes, always three, and never a pause between them.',
  },
  {
    id: 'mosshide', name: 'MOSSHIDE, THE PATIENT',
    body: 'hulk', skin: 0x3f5f2c, dark: 0x27401b, trim: 0x8fc44a,
    head: 'mossy', weapon: 'none', horns: 0, eyes: 0xc9ff6b,
    moves: ['spores', 'slam', 'spores'],
    blurb: 'Does not chase. Fills the room instead.',
  },
  {
    id: 'varn', name: 'VARN, WHO CAME RUNNING',
    body: 'lean', skin: 0x8a3a2a, dark: 0x5c2318, trim: 0xffb03c,
    head: 'horned', weapon: 'club', horns: 2, eyes: 0xff7a3c,
    moves: ['charge', 'charge', 'combo'],
    blurb: 'Crosses the room before you have finished reading this.',
  },
  {
    id: 'quarryhand', name: 'THE QUARRY-HAND',
    body: 'stone', skin: 0x6d6a63, dark: 0x46443f, trim: 0x9a9790,
    head: 'blunt', weapon: 'none', horns: 0, eyes: 0xffd76b,
    moves: ['throw', 'throw', 'shockwave'],
    blurb: 'Never comes close. Never needs to.',
  },
  {
    id: 'okka', name: 'OKKA, TWICE-DROWNED',
    body: 'lean', skin: 0x2e4a6b, dark: 0x1b2f46, trim: 0x6fa8d9,
    head: 'eel', weapon: 'twin', horns: 0, eyes: 0x8fd8ff,
    moves: ['blink', 'combo', 'blink', 'volley'],
    blurb: 'Is not where you last saw it.',
  },
  {
    id: 'palecroak', name: 'THE PALE CROAK',
    body: 'wraith', skin: 0xcfc5b4, dark: 0x9a9280, trim: 0xffffff,
    head: 'skull', weapon: 'none', horns: 0, eyes: 0xd8f0ff,
    moves: ['volley', 'ringout', 'volley'],
    blurb: 'Sings, and the room fills with teeth.',
  },
  {
    id: 'huldr', name: 'HULDR, SPINE OF THE DEEP',
    body: 'hulk', skin: 0x4a3a6b, dark: 0x2e2346, trim: 0xa88fd9,
    head: 'horned', weapon: 'great', horns: 4, eyes: 0xc9a0ff,
    moves: ['spin', 'slam', 'spin', 'combo'],
    blurb: 'Turns, and the turn is the attack.',
  },
  {
    id: 'stonewalks', name: 'THE STONE THAT WALKS',
    body: 'stone', skin: 0x53504a, dark: 0x33312d, trim: 0xc9a227,
    head: 'blunt', weapon: 'great', horns: 0, eyes: 0xff8a3c,
    moves: ['shockwave', 'slam', 'shockwave', 'charge'],
    blurb: 'Every footfall is a hazard.',
  },
  // The last four carry a `tune` multiplier on health and damage. The
  // compounding curve alone made them a wall rather than a climb, so the top
  // of the run is pulled back slightly — the shape of each fight is
  // unchanged, there is just a little less of it.
  {
    id: 'nix', name: 'NIX, LAST OF THE CHOIR',
    body: 'wraith', skin: 0x2a2a44, dark: 0x16162a, trim: 0x6cc2ff,
    head: 'skull', weapon: 'spear', horns: 0, eyes: 0x6cf0ff,
    moves: ['volley', 'blink', 'volley', 'ringout'],
    tune: 0.90,
    blurb: 'Sings three notes. All of them arrive.',
  },
  {
    id: 'gravewater', name: 'GRAVEWATER',
    body: 'hulk', skin: 0x2f4a3a, dark: 0x1b2f24, trim: 0x6fd99a,
    head: 'mossy', weapon: 'none', horns: 0, eyes: 0x8fffc4,
    moves: ['puddle', 'leap', 'puddle', 'combo'],
    tune: 0.88,
    blurb: 'Leaves the floor behind it worse than it found it.',
  },
  {
    id: 'hollowking', name: 'THE HOLLOW KING',
    body: 'wraith', skin: 0x3a2a4a, dark: 0x231830, trim: 0xffd76b,
    head: 'crowned', weapon: 'great', horns: 3, eyes: 0xffd76b,
    moves: ['spin', 'charge', 'volley', 'combo', 'shockwave'],
    tune: 0.86,
    blurb: 'Wore a crown once. Still behaves as though it does.',
  },
  {
    id: 'zehl', name: 'ZEHL, THE FINAL GUARDIAN',
    body: 'hulk', skin: 0x1f1f2e, dark: 0x101018, trim: 0xff5a3c,
    head: 'crowned', weapon: 'great', horns: 4, eyes: 0xff3c2c,
    moves: ['combo', 'charge', 'shockwave', 'volley', 'spin', 'slam', 'blink'],
    tune: 0.85,
    blurb: 'The last thing between you and the door.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // THE OVERWORLD'S OWN
  //
  // The fourteen above are the dungeon's, in the order you meet them going
  // down. These seven never had a room: they belong to the realm, and each
  // one is there because a region needed something of its own to be about.
  // They are built out of the same primitives, so none of them can invent an
  // unfair attack — only recombine fair ones.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'tidemother', name: 'THE TIDEMOTHER, SWOLLEN',
    body: 'hulk', skin: 0x3f6a63, dark: 0x24443f, trim: 0x9fe0d0,
    head: 'toad', weapon: 'none', horns: 0, eyes: 0xbdf6ff,
    moves: ['puddle', 'slam', 'shockwave', 'puddle'],
    tune: 0.92,
    blurb: 'The fen rises when she moves. She has never had to chase anything.',
  },
  {
    id: 'whisperweed', name: 'WHISPERWEED',
    body: 'wraith', skin: 0x35662c, dark: 0x1f3f1a, trim: 0xc9ff6b,
    head: 'mossy', weapon: 'none', horns: 0, eyes: 0xdcff8a,
    moves: ['spores', 'spores', 'leap', 'ringout'],
    tune: 0.90,
    blurb: 'It is not one plant. You will work that out too late.',
  },
  {
    id: 'skarn', name: 'SKARN, THE RUSTED KNIGHT',
    body: 'stone', skin: 0x7a5a3a, dark: 0x4a3422, trim: 0xd9b06a,
    head: 'blunt', weapon: 'great', horns: 1, eyes: 0xffb03c,
    moves: ['combo', 'charge', 'combo', 'slam'],
    tune: 0.89,
    blurb: 'Every joint screams. It has not stopped him for four hundred years.',
  },
  {
    id: 'glassback', name: 'GLASSBACK',
    body: 'stone', skin: 0x5a6a8a, dark: 0x36415a, trim: 0xa8d8ff,
    head: 'skull', weapon: 'none', horns: 2, eyes: 0x8fe8ff,
    moves: ['spin', 'ringout', 'charge', 'spin'],
    tune: 0.88,
    blurb: 'The shell throws your own blows back at you. Aim for the seams.',
  },
  {
    id: 'lanternbearer', name: 'THE LANTERN-BEARER',
    body: 'wraith', skin: 0x2e3a44, dark: 0x1a222a, trim: 0xffd76b,
    head: 'skull', weapon: 'spear', horns: 0, eyes: 0xffe9a8,
    moves: ['blink', 'volley', 'blink', 'combo'],
    tune: 0.87,
    blurb: 'Follow the light. That is what it is for.',
  },
  {
    id: 'twincroaks', name: 'THE TWIN CROAKS',
    body: 'lean', skin: 0x6a4a7a, dark: 0x412e4c, trim: 0xe0a8ff,
    head: 'horned', weapon: 'twin', horns: 2, eyes: 0xe8b0ff,
    moves: ['combo', 'leap', 'combo', 'blink'],
    tune: 0.87,
    blurb: 'One of them is always behind you. They take turns being the one.',
  },
  {
    id: 'volkh', name: 'VOLKH, THE EMBER-EATER',
    body: 'hulk', skin: 0x6a2a1a, dark: 0x3f1610, trim: 0xff8a3c,
    head: 'horned', weapon: 'club', horns: 3, eyes: 0xffca4a,
    moves: ['charge', 'shockwave', 'slam', 'volley', 'charge'],
    tune: 0.85,
    blurb: 'It eats fire and breathes it back out bigger. It has been growing.',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // THE CROAKLANDS
  //
  // One more for each region the expanded world added, plus the two that gate
  // the road north. Same primitives, same rules — every attack any of these
  // can make is one the player has already learned to read somewhere else.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'thistlejack', name: 'THISTLEJACK',
    body: 'lean', skin: 0x8a7a3a, dark: 0x554a22, trim: 0xd9c46a,
    head: 'horned', weapon: 'spear', horns: 2, eyes: 0xff8a3c,
    moves: ['throw', 'combo', 'throw'],
    tune: 0.95,
    /**
     * Deliberately the softest thing in the book.
     *
     * He is in the second region you can reach, on a farm, at tier zero: the
     * first guardian most players will fight, and the one that teaches what a
     * telegraph is. He throws twice for every time he closes, so the lesson
     * is "read the ring, then punish the recovery" and nothing else.
     */
    blurb: 'Straw, string and bad intentions. Somebody built him to guard wheat.',
  },
  {
    id: 'sableknight', name: 'THE SABLE KNIGHT',
    body: 'lean', skin: 0x2a2a34, dark: 0x16161c, trim: 0xb0b8c4,
    head: 'crowned', weapon: 'great', horns: 1, eyes: 0xa8d8ff,
    moves: ['combo', 'charge', 'combo', 'slam'],
    tune: 0.90,
    blurb: 'The last of the palace guard. Nobody told him it fell.',
  },
  {
    id: 'mirrorwidow', name: 'THE MIRROR WIDOW',
    body: 'lean', skin: 0x6a8a9a, dark: 0x3f5460, trim: 0xdff4ff,
    head: 'eel', weapon: 'twin', horns: 0, eyes: 0xffffff,
    moves: ['blink', 'volley', 'blink', 'ringout'],
    tune: 0.89,
    blurb: 'There are two of her and one is a reflection. Not always the same one.',
  },
  {
    id: 'sandreaver', name: 'THE SANDREAVER',
    body: 'hulk', skin: 0xc4a06a, dark: 0x8a6a3c, trim: 0xffe0a0,
    head: 'blunt', weapon: 'none', horns: 0, eyes: 0xff7a3c,
    moves: ['shockwave', 'charge', 'shockwave', 'slam'],
    tune: 0.88,
    blurb: 'It travels under the dunes. The wave is the only warning.',
  },
  {
    id: 'dunelord', name: 'THE DUNE LORD',
    body: 'stone', skin: 0xa8905e, dark: 0x6a5836, trim: 0xffd76b,
    head: 'crowned', weapon: 'spear', horns: 2, eyes: 0xffca4a,
    moves: ['throw', 'volley', 'combo', 'throw'],
    tune: 0.88,
    blurb: 'Buried with everything he owned, including the habit of command.',
  },
  {
    id: 'ossuar', name: 'OSSUAR, THE STACKED',
    body: 'hulk', skin: 0xd8d2c2, dark: 0x9a9484, trim: 0xf4f0e4,
    head: 'skull', weapon: 'club', horns: 0, eyes: 0xff5a2c,
    moves: ['slam', 'shockwave', 'slam', 'combo'],
    tune: 0.87,
    blurb: 'Assembled out of what was lying about. It is still collecting.',
  },
  {
    id: 'dolmath', name: 'DOLMATH OF THE DEEP WATER',
    body: 'hulk', skin: 0x2a4a5a, dark: 0x152c38, trim: 0x8fd8ff,
    head: 'eel', weapon: 'spear', horns: 0, eyes: 0xa8f0ff,
    moves: ['puddle', 'leap', 'volley', 'puddle', 'combo'],
    tune: 0.86,
    blurb: 'He held the keep when it was dry. He is still holding it.',
  },
  {
    id: 'cindren', name: 'CINDREN, THE SECOND FIRE',
    body: 'lean', skin: 0x8a3a1a, dark: 0x542010, trim: 0xffb03c,
    head: 'horned', weapon: 'twin', horns: 3, eyes: 0xffd24a,
    moves: ['charge', 'combo', 'charge', 'volley'],
    tune: 0.86,
    blurb: 'Whatever started the Emberwaste, this is what it left behind.',
  },
  {
    id: 'emberthrone', name: 'THE THING ON THE RIM',
    body: 'stone', skin: 0x3a2a28, dark: 0x201614, trim: 0xff6a2c,
    head: 'crowned', weapon: 'great', horns: 4, eyes: 0xff4a20,
    moves: ['shockwave', 'slam', 'spin', 'shockwave', 'charge'],
    tune: 0.84,
    blurb: 'It sits in the caldera and the caldera has not put it out.',
  },
  {
    id: 'moonwake', name: 'MOONWAKE',
    body: 'wraith', skin: 0x3a4a72, dark: 0x222c48, trim: 0xcfe0ff,
    head: 'skull', weapon: 'spear', horns: 0, eyes: 0xdff0ff,
    moves: ['volley', 'blink', 'ringout', 'volley'],
    tune: 0.85,
    blurb: 'It walks the shelf at night, which up here is always.',
  },
  {
    id: 'prismgaunt', name: 'THE PRISMGAUNT',
    body: 'stone', skin: 0x5a6aa8, dark: 0x35406a, trim: 0xa8f0ff,
    head: 'horned', weapon: 'none', horns: 4, eyes: 0xffffff,
    moves: ['ringout', 'volley', 'spin', 'ringout'],
    tune: 0.84,
    blurb: 'It splits what it is hit with and gives you all the pieces back.',
  },
  {
    id: 'rimeglass', name: 'RIMEGLASS',
    body: 'wraith', skin: 0xa8c8dd, dark: 0x6a8ba8, trim: 0xffffff,
    head: 'crowned', weapon: 'twin', horns: 2, eyes: 0xbff0ff,
    moves: ['blink', 'combo', 'ringout', 'blink', 'volley'],
    tune: 0.84,
    blurb: 'Cold enough that the air around it falls out of the sky.',
  },
  {
    id: 'hoarwarden', name: 'THE HOARWARDEN',
    body: 'stone', skin: 0xa8bccc, dark: 0x6a8296, trim: 0xffffff,
    head: 'blunt', weapon: 'club', horns: 0, eyes: 0xbff0ff,
    moves: ['slam', 'shockwave', 'charge', 'slam'],
    tune: 0.85,
    blurb: 'It has been standing in the courtyard so long it is part of it.',
  },
  {
    id: 'gatewright', name: 'THE GATEWRIGHT',
    body: 'stone', skin: 0x5a564e, dark: 0x36332e, trim: 0xc9a227,
    head: 'blunt', weapon: 'great', horns: 0, eyes: 0xff8a3c,
    moves: ['combo', 'slam', 'shockwave', 'combo'],
    tune: 0.85,
    /**
     * Arkos's opposite number.
     *
     * The Hollow City's gate is barred from the inside and somebody barred
     * it. He and Arkos were the same rank in the same order, and the pair of
     * them are why nothing has come south in four hundred years.
     */
    blurb: 'He barred the gate from the inside and then stayed inside with it.',
  },
  // ══════════════════════════════════════════════════════════════════════════
  // THE OPTIONAL TEN
  //
  // One per region along the first half of the road, and not one of them is
  // in the main line or gates anything. They are what the journey between two
  // guardians is FOR: something big enough to be worth telling somebody
  // about, standing over a cave or a mine or a tithe yard that the story never
  // mentions.
  //
  // Each carries `rank: 'mini'` — two phases, a softer guard, less dodging —
  // so they read as a hard fight rather than as the region's own guardian
  // fought early. The encounter builder honours a spec's own rank over the
  // one its region's tier would imply, which is the whole reason the field
  // exists. See Overworld._buildBoss.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'hedgewife', name: 'THE HEDGE-WIFE',
    body: 'lean', skin: 0x6a7a3a, dark: 0x40501f, trim: 0xd9d06a,
    head: 'mossy', weapon: 'spear', horns: 1, eyes: 0xffe08a,
    moves: ['throw', 'spores', 'combo'], tune: 0.95, rank: 'mini',
    blurb: 'She kept the hedges. The hedges have kept her.',
  },
  {
    id: 'eelfather', name: 'THE EEL-FATHER',
    body: 'hulk', skin: 0x3a5a5a, dark: 0x22383a, trim: 0x8fd0c4,
    head: 'eel', weapon: 'none', horns: 0, eyes: 0xaef0ff,
    moves: ['leap', 'puddle', 'combo', 'leap'], tune: 0.93, rank: 'mini',
    blurb: 'Every eel in the mire is one of his. He is not being poetic.',
  },
  {
    id: 'barkwretch', name: 'BARKWRETCH',
    body: 'wraith', skin: 0x4a3a26, dark: 0x2c2216, trim: 0x9ac45a,
    head: 'mossy', weapon: 'none', horns: 2, eyes: 0xc9ff8a,
    moves: ['spores', 'slam', 'ringout'], tune: 0.93, rank: 'mini',
    blurb: 'It was a tree. Somebody asked it to move and it has not stopped.',
  },
  {
    id: 'stairwright', name: 'THE STAIRWRIGHT',
    body: 'stone', skin: 0x6a665c, dark: 0x413e37, trim: 0xc9a227,
    head: 'blunt', weapon: 'club', horns: 0, eyes: 0xffca6b,
    moves: ['shockwave', 'slam', 'combo'], tune: 0.92, rank: 'mini',
    blurb: 'It cut the stair. It has opinions about who uses it.',
  },
  {
    id: 'tithetaker', name: 'THE TITHE-TAKER',
    body: 'lean', skin: 0x4a3a4a, dark: 0x2c2230, trim: 0xd9b06a,
    head: 'crowned', weapon: 'twin', horns: 1, eyes: 0xffd08a,
    moves: ['combo', 'charge', 'throw'], tune: 0.91, rank: 'mini',
    blurb: 'It counts what leaves the basin and it counts very carefully.',
  },
  {
    id: 'overburden', name: 'THE OVERBURDEN',
    body: 'stone', skin: 0x5e5a52, dark: 0x393630, trim: 0x9a9790,
    head: 'blunt', weapon: 'none', horns: 0, eyes: 0xff9a4a,
    moves: ['throw', 'shockwave', 'slam'], tune: 0.91, rank: 'mini',
    blurb: 'Everything the cutters threw away, in one heap, upright.',
  },
  {
    id: 'saltjaw', name: 'SALTJAW',
    body: 'hulk', skin: 0x4a5a4a, dark: 0x2c382c, trim: 0xc4e0b4,
    head: 'eel', weapon: 'none', horns: 0, eyes: 0xbfffd8,
    moves: ['puddle', 'leap', 'shockwave'], tune: 0.90, rank: 'mini',
    blurb: 'It drinks the salt water and it has not been well for a while.',
  },
  {
    id: 'secondvoice', name: 'THE SECOND VOICE',
    body: 'wraith', skin: 0x3a3a52, dark: 0x22222f, trim: 0x8fd0ff,
    head: 'skull', weapon: 'none', horns: 0, eyes: 0xbfe8ff,
    moves: ['volley', 'ringout', 'blink'], tune: 0.90, rank: 'mini',
    blurb: 'The Choir had two. Nix sings the melody.',
  },
  {
    id: 'slaghide', name: 'SLAGHIDE',
    body: 'hulk', skin: 0x5a3226, dark: 0x361c14, trim: 0xff9a4a,
    head: 'horned', weapon: 'club', horns: 2, eyes: 0xffb84a,
    moves: ['charge', 'slam', 'shockwave'], tune: 0.89, rank: 'mini',
    blurb: 'Poured, cooled, and then it stood up out of the mould.',
  },
  {
    id: 'windward', name: 'THE WINDWARD',
    body: 'lean', skin: 0x6a6a76, dark: 0x40404a, trim: 0xdfe8f4,
    head: 'horned', weapon: 'spear', horns: 3, eyes: 0xdff4ff,
    moves: ['leap', 'combo', 'volley'], tune: 0.89, rank: 'mini',
    blurb: 'It hunts the ridge line because the ridge line is where the wind is.',
  },

  {
    id: 'arkos', name: 'ARKOS, WARDEN OF THE SPAN',
    body: 'stone', skin: 0x4a4a52, dark: 0x2c2c32, trim: 0xc9a227,
    head: 'blunt', weapon: 'great', horns: 0, eyes: 0xffd76b,
    moves: ['slam', 'shockwave', 'combo', 'charge', 'spin'],
    tune: 0.85,
    /**
     * The last gate before the throne.
     *
     * The Ashen Throne is gated on this one rather than on Zehl, because Zehl
     * is standing IN the Ashen Throne — a region gated on a guardian inside
     * it can never be entered. Arkos holds the bridge, and the bridge is the
     * only way across.
     */
    blurb: 'He built the bridge. He has never once let anybody use it.',
  },
];

/**
 * By stable id — how the region table and the save file name them.
 *
 * The dungeon addresses guardians by INDEX (`GUARDIANS[room]`), which is why
 * the seven overworld ones are appended rather than slotted in: rooms one to
 * fourteen have to keep pointing at the same fourteen creatures, and a save
 * that says a boss is dead has to still mean that boss.
 */
export const GUARDIAN_BY_ID = new Map(GUARDIANS.map((g) => [g.id, g]));

/**
 * RECOMMENDED POWER, per guardian.
 *
 * ── what this is for ─────────────────────────────────────────────────────
 * It is a WARNING, not a gate. Nothing in the game reads this number and
 * refuses to let the player fight: the fight always starts, the boss always
 * has the same health and the same patterns, and a good player carrying the
 * wrong sword can absolutely still win. What it does is tell the player, at
 * the moment they walk into the ring, which side of the curve they are on —
 * so "I am not ready for this" is a decision they make with information
 * rather than a discovery they make after three minutes of dying.
 *
 * ── and why that matters more than the number ────────────────────────────
 * The whole design the user asked for lives on the player being ALLOWED to
 * be underlevelled and being able to walk away: try the boss, get taken
 * apart, leave, find a cave, come back. That loop only works if the game
 * says "this is a tier above you" instead of silently scaling the boss to
 * whatever you happen to be carrying. Scaled bosses make exploration
 * pointless, because preparing changes nothing.
 *
 * ── the curve ────────────────────────────────────────────────────────────
 * Compare against `Progress.power`, which starts at 10 with nothing equipped
 * and reaches the high sixties in full late-game gear. The steps widen as
 * they go: the first few are a few points apart because the player's early
 * finds are small, and the last few are ten or twelve apart because by then
 * a single weapon is worth that much.
 */
export const RECOMMENDED = {
  // The teaching fight. A brand new frog with a stick can take it, and the
  // number says so — it must never be the one that sends somebody away.
  grott: 10,
  silt: 13,
  // The named ones the player will have heard about for hours. Each is a
  // deliberate step ABOVE what its region would imply, because a fight with
  // a name should be a fight you prepare for.
  arkos: 44,
  hollowking: 40,
  gatewright: 52,
  eelfather: 30,
  stairwright: 34,
  tithetaker: 36,
  dunelord: 50,
  emberthrone: 58,
  rimeglass: 64,
  hoarwarden: 62,
  zehl: 72,
  // And the one nobody is ever quite ready for.
  frogath: 80,
};

/**
 * What a guardian expects.
 *
 * A named entry wins; everything else is derived from where it stands, which
 * is the honest answer — the fourth guardian of a tier-three region really
 * is harder than the first, and the region's tier really is the game's own
 * statement of how deep you are.
 */
export function recommendedFor(id, tier = 0, index = 0) {
  const r = RECOMMENDED[id];
  if (r !== undefined) return r;
  return Math.round(11 + tier * 11.5 + index * 2.6);
}

/**
 * HOW READY THE PLAYER IS, as something you can say out loud.
 *
 * Five bands, and the wording of each is doing a job. "You are ready" must
 * not read as a promise the fight is easy, and "come back later" must not
 * read as a refusal — the player can always try, and the game should sound
 * like it expects some of them to.
 */
export function readiness(power, want) {
  const d = power - want;
  if (d >= 10) return { band: 'over', say: 'You are well past this one.' };
  if (d >= 0) return { band: 'ready', say: 'You are ready for this.' };
  if (d >= -8) return { band: 'close', say: 'A hard fight. You could take it.' };
  if (d >= -18) {
    return { band: 'under',
      say: 'This is above you. Better gear would change the fight.' };
  }
  return { band: 'far',
    say: 'This will take you apart. Find something better first.' };
}

/**
 * Build a guardian's body from its spec.
 *
 * Returns the same shape ToadModel does — root, body, head, arms, legs, plus
 * swing/flinch/update — so the boss AI never has to care which creature it is
 * driving.
 */
export function buildGuardian(spec) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const L = (c, e) => new THREE.MeshLambertMaterial({
    color: c, emissive: e || 0x000000,
  });
  const B = (c) => new THREE.MeshBasicMaterial({ color: c });
  const M = {
    skin: L(spec.skin),
    dark: L(spec.dark),
    trim: L(spec.trim),
    eye: B(spec.eyes),
  };
  // Wraiths are half-there.
  if (spec.body === 'wraith') {
    M.skin.transparent = true; M.skin.opacity = 0.82;
    M.dark.transparent = true; M.dark.opacity = 0.72;
  }

  const put = (geo, mat, sx, sy, sz, px, py, pz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(px || 0, py || 0, pz || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    return m;
  };

  // ---- silhouette ----
  // Each body type has its own proportions; this is what stops them all
  // reading as the same creature in different paint.
  const P = {
    hulk:   { w: 0.72, h: 0.58, d: 0.64, y: 0.86, legs: 0.42, arm: 0.70, tall: 1.0 },
    lean:   { w: 0.44, h: 0.62, d: 0.42, y: 1.02, legs: 0.58, arm: 0.52, tall: 1.15 },
    stone:  { w: 0.82, h: 0.50, d: 0.74, y: 0.74, legs: 0.30, arm: 0.86, tall: 0.9 },
    wraith: { w: 0.50, h: 0.74, d: 0.46, y: 1.20, legs: 0.0,  arm: 0.60, tall: 1.25 },
  }[spec.body] || P_HULK_FALLBACK();

  body.add(put(G.sphere, M.skin, P.w, P.h, P.d, 0, P.y, 0));
  body.add(put(G.sphere, M.dark, P.w * 0.74, P.h * 0.6, P.d * 0.66, 0, P.y - 0.12, P.d * 0.42));
  if (spec.body === 'stone') {
    // Slabs of rock rather than a smooth hide.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      body.add(put(G.box, M.dark, 0.34, 0.34, 0.34,
        Math.cos(a) * P.w, P.y + 0.2, Math.sin(a) * P.d, 0, a, 0.3));
    }
  }
  if (spec.body !== 'wraith') {
    body.add(put(G.cyl, M.trim, P.w * 0.92, 0.09, P.d * 0.92, 0, P.y - P.h * 0.7, 0));
  }

  // ---- head ----
  const head = new THREE.Group();
  head.position.set(0, P.y + P.h * 0.95, P.d * 0.18);
  body.add(head);
  const HEADS = {
    toad:    () => { head.add(put(G.sphere, M.skin, 0.52, 0.40, 0.48, 0, 0, 0));
      head.add(put(G.box, M.dark, 0.58, 0.04, 0.10, 0, -0.12, 0.36)); },
    eel:     () => { head.add(put(G.capsule, M.skin, 0.30, 0.34, 0.30, 0, 0, 0.18, 1.35, 0, 0));
      head.add(put(G.cone, M.dark, 0.24, 0.36, 0.24, 0, -0.04, 0.62, 1.35, 0, 0)); },
    mossy:   () => { head.add(put(G.sphere, M.skin, 0.50, 0.42, 0.46, 0, 0, 0));
      for (let i = 0; i < 5; i++) {
        head.add(put(G.low, M.trim, 0.16, 0.10, 0.16,
          (Math.random() - 0.5) * 0.7, 0.28, (Math.random() - 0.5) * 0.6));
      } },
    blunt:   () => { head.add(put(G.box, M.skin, 0.52, 0.42, 0.50, 0, 0, 0));
      head.add(put(G.box, M.dark, 0.56, 0.06, 0.12, 0, -0.14, 0.30)); },
    skull:   () => { head.add(put(G.sphere, M.skin, 0.42, 0.44, 0.44, 0, 0, 0));
      head.add(put(G.box, M.dark, 0.30, 0.16, 0.12, 0, -0.26, 0.34)); },
    horned:  () => { head.add(put(G.sphere, M.skin, 0.50, 0.42, 0.46, 0, 0, 0));
      head.add(put(G.box, M.dark, 0.54, 0.05, 0.10, 0, -0.14, 0.34)); },
    crowned: () => { head.add(put(G.sphere, M.skin, 0.50, 0.44, 0.46, 0, 0, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        head.add(put(G.cone, M.trim, 0.07, 0.28, 0.07,
          Math.cos(a) * 0.42, 0.36, Math.sin(a) * 0.40));
      } },
  };
  (HEADS[spec.head] || HEADS.toad)();

  for (const sx of [-1, 1]) {
    head.add(put(G.low, M.eye, 0.12, 0.10, 0.10, sx * 0.24, 0.08, 0.36));
  }
  // Horns.
  for (let i = 0; i < (spec.horns || 0); i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const tier = Math.floor(i / 2);
    head.add(put(G.cone, M.trim, 0.10, 0.34 + tier * 0.12, 0.10,
      side * (0.36 + tier * 0.1), 0.26 + tier * 0.12, -0.06, -0.3, 0, side * 0.7));
  }

  // ---- arms ----
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * P.w * 0.95, P.y + P.h * 0.5, 0);
    body.add(shoulder);
    shoulder.add(put(G.capsule, M.skin, 0.17, P.arm * 0.34, 0.17, 0, -P.arm * 0.34, 0));
    const fore = new THREE.Group();
    fore.position.set(0, -P.arm * 0.66, 0);
    shoulder.add(fore);
    fore.add(put(G.capsule, M.skin, 0.15, P.arm * 0.30, 0.15, 0, -P.arm * 0.26, 0));
    const hand = new THREE.Group();
    hand.position.set(0, -P.arm * 0.58, 0);
    fore.add(hand);
    hand.add(put(G.low, M.dark, 0.19, 0.16, 0.19, 0, 0, 0));
    arms.push({ shoulder, fore, hand, side: sx });
  }

  // ---- legs, or a trailing tail for the wraiths ----
  const legs = [];
  if (P.legs > 0) {
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * P.w * 0.5, P.y - P.h * 0.75, 0);
      body.add(hip);
      hip.add(put(G.capsule, M.skin, 0.21, P.legs * 0.42, 0.21, 0, -P.legs * 0.4, 0));
      const shin = new THREE.Group();
      shin.position.set(0, -P.legs * 0.8, 0);
      hip.add(shin);
      shin.add(put(G.capsule, M.skin, 0.16, P.legs * 0.38, 0.16, 0, -P.legs * 0.34, 0));
      const foot = new THREE.Group();
      foot.position.set(0, -P.legs * 0.72, 0);
      shin.add(foot);
      foot.add(put(G.low, M.dark, 0.22, 0.09, 0.32, 0, 0, 0.12));
      legs.push({ hip, shin, foot, side: sx });
    }
  } else {
    // A ragged tail instead of legs — it hovers.
    for (let i = 0; i < 4; i++) {
      body.add(put(G.cone, M.dark, 0.40 - i * 0.07, 0.4, 0.40 - i * 0.07,
        0, P.y - P.h - i * 0.34, 0, Math.PI, 0, 0));
    }
  }

  // ---- weapon ----
  let weapon = null;
  const WEAPONS = {
    club:  () => { const g = new THREE.Group();
      g.add(put(G.cyl, M.dark, 0.08, 0.9, 0.08, 0, -0.35, 0));
      g.add(put(G.cyl, M.dark, 0.20, 0.44, 0.20, 0, 0.34, 0));
      g.add(put(G.cyl, M.trim, 0.22, 0.06, 0.22, 0, 0.52, 0)); return g; },
    spear: () => { const g = new THREE.Group();
      g.add(put(G.cyl, M.dark, 0.06, 1.7, 0.06, 0, 0.4, 0));
      g.add(put(G.cone, M.trim, 0.14, 0.5, 0.14, 0, 1.5, 0)); return g; },
    great: () => { const g = new THREE.Group();
      g.add(put(G.box, M.trim, 0.16, 2.6, 0.55, 0, 1.3, 0));
      g.add(put(G.box, M.dark, 0.5, 0.16, 0.16, 0, 0.05, 0));
      g.add(put(G.cyl, M.dark, 0.09, 0.5, 0.09, 0, -0.3, 0)); return g; },
    twin:  () => { const g = new THREE.Group();
      g.add(put(G.box, M.trim, 0.1, 1.2, 0.28, 0, 0.6, 0));
      g.add(put(G.box, M.dark, 0.32, 0.12, 0.12, 0, 0.02, 0)); return g; },
  };
  if (spec.weapon && spec.weapon !== 'none' && WEAPONS[spec.weapon]) {
    weapon = WEAPONS[spec.weapon]();
    arms[1].hand.add(weapon);
    weapon.position.set(0, -0.2, 0.08);
    weapon.rotation.x = 0.25;
    // The twin-blade wielders carry one in each hand.
    if (spec.weapon === 'twin') {
      const off = WEAPONS.twin();
      arms[0].hand.add(off);
      off.position.set(0, -0.2, 0.08);
      off.rotation.x = 0.25;
    }
  }

  return { root, body, head, arms, legs, weapon, mats: M, hover: P.legs === 0 };
}

function P_HULK_FALLBACK() {
  return { w: 0.72, h: 0.58, d: 0.64, y: 0.86, legs: 0.42, arm: 0.70, tall: 1.0 };
}
