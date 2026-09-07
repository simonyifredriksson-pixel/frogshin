/**
 * THE CROAKLANDS — every region of the open world, as data.
 *
 * This file is the world's spine. A region owns its ground, its weather, its
 * music, its architecture, its monsters, its people and its secrets, and
 * everything else in the overworld reads them from here: the terrain
 * generator asks each region how high its ground is, the encounter placer asks
 * which guardians live in it, the map screen asks what to label it, the
 * weather asks what falls out of its sky.
 *
 * It is data and not code for the same reason `maps.js` is: adding a region, a
 * boss, a village or a landmark must never mean touching the generator, the
 * streamer or the renderer.
 *
 * ── the shape of a region ──────────────────────────────────────────────────
 *   id        stable key; save files, quests and gates refer to regions by it
 *   name      what the player is told when they cross into it
 *   blurb     one line, shown on the map screen and on the crossing banner
 *   x, z      centre, in world units
 *   r         radius of its full influence
 *   feather   how far its influence fades out past `r`
 *   tier      0-5, roughly how dangerous; drives level guidance and rewards
 *   gate      guardian id that must be dead before you may walk in, or null
 *   arch      building style for its settlements and ruins (see realmsites)
 *   weather   what falls out of its sky (see weather.js)
 *   music     which mood the ambient bed plays (see audio.js)
 *   palette   ground colours; same keys the valley's palette uses, plus a
 *             `road` colour so a desert road is pale sand and a forest road
 *             is churned mud
 *   sky       atmosphere preset, spread over the default
 *   ground    (n, x, z) => height, where x and z are REGION-LOCAL — the
 *             region's own centre is (0, 0). This trips everybody up once:
 *             the volcano's cone, the capital's basin, the lake bed and the
 *             Sunderway's chasm were all written with world-space centres,
 *             which put them thousands of units outside the map. There was no
 *             volcano and no chasm at all, and the two basins were flat.
 *   landmark  the ENORMOUS thing you can see from the next region over
 *   bosses    guardian ids that live here, with where and how big an arena
 *   camps     small enemy groups
 *   sites     named places: towns, shrines, ruins, caves, oddities
 *
 * ── how the ground is blended ──────────────────────────────────────────────
 * Regions overlap. Every one contributes a weight that falls off as the
 * inverse fourth power of the distance in units of its own radius, and the
 * final height is the weighted average. That is what stops a region boundary
 * being a cliff: two neighbours simply average into each other.
 * `regionWeights` below is the only place that arithmetic lives.
 *
 * ── the shape of the map ───────────────────────────────────────────────────
 * South is warm and safe and where you start; north is where the First Croak
 * is sitting. The middle is the drowned capital, and every road in the world
 * runs through it. Mountains are the boundaries — the Rimefang in the
 * north-west, Cindermaw in the north-east — and the rivers all run south to
 * the sea you woke up in.
 */

import { clamp, smoothstep } from './util.js?v=v83';

/** World extent. The realm spans -REALM_HALF .. +REALM_HALF on X and Z. */
export const REALM_SIZE = 5120;
export const REALM_HALF = REALM_SIZE / 2;

/** Sea level. Below this is water, and swimming works exactly as it does. */
export const SEA = 6;

/**
 * Content has to stay inside this, and so does anything that must be
 * reachable: past it the rim mountains take over and the ground climbs
 * hundreds of units into a wall you cannot walk over.
 */
export const CONTENT_HALF = REALM_HALF * 0.84;

// ─────────────────────────────────────────────────────────── shape helpers ──

/**
 * A single great peak or a volcanic cone.
 *
 * `crater` pulls the middle back down again, which is the difference between
 * a mountain and a volcano — and the reason Cindermaw reads as a volcano from
 * three regions away rather than as just another tall hill.
 *
 * `cx`/`cz` are REGION-LOCAL, like everything a `ground` function is handed.
 */
function cone(x, z, cx, cz, radius, height, crater = 0) {
  const d = Math.hypot(x - cx, z - cz) / radius;
  if (d >= 1) return 0;
  const up = 1 - smoothstep(clamp(d, 0, 1));
  if (crater <= 0) return height * up;
  // Inside the crater lip, fall away into the caldera.
  const lip = 0.24;
  if (d > lip) return height * up;
  const inner = 1 - smoothstep(clamp(d / lip, 0, 1));
  return height * up - crater * inner;
}

/**
 * A bowl — a lake bed, or a basin with a city in the bottom of it.
 *
 * `cx`/`cz` are REGION-LOCAL, like everything a `ground` function is handed.
 */
function bowl(x, z, cx, cz, radius, depth) {
  const d = Math.hypot(x - cx, z - cz) / radius;
  if (d >= 1) return 0;
  return -depth * (1 - smoothstep(clamp(d, 0, 1)));
}

/**
 * Dunes: long parallel waves, softened by noise so they are not corrugated
 * iron. The wavelength is deliberately long — a 300-unit dune is a hill you
 * walk over, a 90-unit one is a wall you cannot.
 */
function dunes(n, x, z, amp, wave, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const u = (x * c + z * s) / wave;
  return Math.sin(u * Math.PI * 2) * amp * (0.6 + n.fbm(x * 0.0016, z * 0.0016, 2) * 0.4);
}

export const REGIONS = [
  // ══════════════════════════════════════ TIER 0 — where you wake up ══════
  {
    id: 'lilyreach',
    name: 'THE LILYREACH',
    blurb: 'Warm water, flat stones, and nothing that wants to kill you yet.',
    x: 300, z: 1850, r: 400, feather: 250, tier: 0,
    gate: null, arch: 'reed', weather: 'clear', music: 'calm',
    palette: {
      sand: 0xd8cb92, grass: 0x7cc258, grass2: 0x63a844, dirt: 0x8a7550,
      rock: 0x6f6a63, high: 0x9fb0a4, highAt: 140, road: 0xa88f62,
      slopeDirt: 0.30, slopeRock: 0.52, rockFromY: 80,
    },
    sky: { fogNear: 80, fogFar: 700, skyTop: 0x2f7fd0, skyMid: 0x79bfee },
    /**
     * Deliberately almost flat. This is where a player learns which way is
     * forward, and a beginner region that hides its own exits behind hills
     * teaches nothing except that the game is confusing.
     */
    ground: (n, x, z) => 8 + n.fbm(x * 0.0022, z * 0.0022, 3) * 6,
    landmark: {
      kind: 'greatlily', at: [560, 1990],
      name: 'THE MOTHER PAD',
      blurb: 'One lily the size of a village, and a village on it.',
    },
    bosses: [],
    camps: [
      { at: [90, 1720], kind: 'lurker', n: 3, tier: 0 },
      { at: [560, 1900], kind: 'lurker', n: 3, tier: 0 },
    ],
    sites: [
      { id: 'croakhollow', kind: 'village', at: [300, 1790], r: 66,
        name: 'CROAKHOLLOW', blurb: 'The last village that still has a roof.' },
      { id: 'listening-stone', kind: 'shrine', at: [80, 1660], r: 18,
        name: 'THE LISTENING STONE' },
      { id: 'reedcaves', kind: 'cave', at: [660, 1710], r: 22,
        name: 'THE REED HOLLOWS', blurb: 'Something has been sleeping in it.' },
    ],
  },

  {
    id: 'harrowmead',
    name: 'THE HARROWMEAD',
    blurb: 'Ploughed, fenced, worked and worried. The first road runs through it.',
    x: -350, z: 1740, r: 380, feather: 230, tier: 0,
    gate: null, arch: 'timber', weather: 'clear', music: 'calm',
    palette: {
      sand: 0xd2c69a, grass: 0x8ec552, grass2: 0xa8b845, dirt: 0x9a7f52,
      rock: 0x7a746a, high: 0xa8b6a8, highAt: 150, road: 0xb59a68,
      slopeDirt: 0.28, slopeRock: 0.50, rockFromY: 90,
    },
    sky: { fogNear: 90, fogFar: 760, skyTop: 0x3a86d4, skyMid: 0x8fc9ee },
    ground: (n, x, z) => 16 + n.fbm(x * 0.0026, z * 0.0026, 3) * 14,
    landmark: {
      kind: 'mill', at: [-500, 1600],
      name: 'THE GREAT HARROW MILL',
      blurb: 'Six sails, and it has not stopped turning in four hundred years.',
    },
    bosses: [{ id: 'thistlejack', at: [-560, 1900], arena: 40 }],
    camps: [{ at: [-180, 1900], kind: 'scarecrow', n: 3, tier: 0 }],
    sites: [
      { id: 'harrowmead-town', kind: 'town', at: [-330, 1700], r: 86,
        name: 'HARROWMEAD', blurb: 'Grain, gossip, and a blacksmith who talks.' },
      { id: 'longfurrow', kind: 'farm', at: [-580, 1770], r: 46,
        name: 'LONGFURROW FARM' },
      { id: 'stoneboat', kind: 'easteregg', at: [-140, 1560], r: 16,
        name: 'THE STONE BOAT',
        blurb: 'A fishing boat, in the middle of a wheat field, made of granite.' },
    ],
  },

  // ══════════════════════════════════════ TIER 1 — out of the shallows ════
  {
    id: 'whispermire',
    name: 'THE WHISPERMIRE',
    blurb: 'Wading depth for a day in every direction. Something under it.',
    x: -1000, z: 1480, r: 420, feather: 260, tier: 1,
    gate: null, arch: 'stilt', weather: 'fog', music: 'grim',
    /**
     * Most of this region is under the waterline and that IS the region. Its
     * warden is called the Warden of the Shallows and its village stands on
     * stilts; demanding dry ground for either would be demanding it stop
     * being a marsh. Wading depth is walkable, so content here is placed in
     * it — see `Realm.placeSpot`.
     */
    amphibious: true,
    palette: {
      sand: 0x6a6a52, grass: 0x4a6b3a, grass2: 0x3d5c33, dirt: 0x4a4438,
      rock: 0x53565c, high: 0x6a6f77, highAt: 130, road: 0x5e5340,
      slopeDirt: 0.22, slopeRock: 0.34, rockFromY: 50,
    },
    sky: {
      fogNear: 22, fogFar: 280, fogColor: 0x5d6c70, skyTop: 0x64757c,
      skyMid: 0x8fa1a4, skyBottom: 0xc3ccc6, cloudCount: 0, leaves: false,
      sunColor: 0xcfe0dd, sunIntensity: 0.6, ambient: 0x53656b,
    },
    ground: (n, x, z) => 4.6 + n.fbm(x * 0.0045, z * 0.0045, 4) * 3.4
      + Math.max(0, n.fbm(x * 0.014, z * 0.014, 3)) * 5,
    landmark: {
      kind: 'deadtree', at: [-1200, 1330],
      name: 'THE DROWNED WATCHER',
      blurb: 'A tree the size of a tower, dead for longer than the village.',
    },
    bosses: [
      { id: 'silt', at: [-1060, 1300], arena: 46 },
      { id: 'tidemother', at: [-820, 1640], arena: 54 },
    ],
    camps: [
      { at: [-880, 1360], kind: 'lurker', n: 4, tier: 1 },
      { at: [-1160, 1580], kind: 'reedstalker', n: 3, tier: 1 },
    ],
    sites: [
      { id: 'the-stilts', kind: 'village', at: [-980, 1560], r: 56,
        name: 'THE STILTS', blurb: 'Nine huts and a rope. No ground at all.' },
      { id: 'witchhut', kind: 'hut', at: [-1300, 1460], r: 24,
        name: 'THE BOGWIFE’S HUT' },
      { id: 'drowned-bell', kind: 'easteregg', at: [-1240, 1680], r: 16,
        name: 'THE DROWNED BELL',
        blurb: 'Ring it three times and something answers.' },
    ],
  },

  {
    id: 'hollowroot',
    name: 'HOLLOWROOT WOOD',
    blurb: 'Old forest. The canopy closes over the path behind you.',
    x: 1080, z: 1440, r: 420, feather: 250, tier: 1,
    gate: 'silt', arch: 'timber', weather: 'leaves', music: 'wild',
    palette: {
      sand: 0xbcae7e, grass: 0x3f7a34, grass2: 0x2f5f27, dirt: 0x6b5333,
      rock: 0x6a6459, high: 0xa8b3a0, highAt: 160, road: 0x6f5636,
      slopeDirt: 0.26, slopeRock: 0.46, rockFromY: 100,
    },
    sky: { fogNear: 44, fogFar: 340, fogColor: 0x8fae86, leafCount: 300 },
    ground: (n, x, z) => 22 + n.fbm(x * 0.0038, z * 0.0038, 4) * 20,
    landmark: {
      kind: 'greattree', at: [1080, 1400],
      name: 'THE HOLLOWROOT',
      blurb: 'A tree with a village inside it. You can see it from the sea.',
    },
    bosses: [
      { id: 'mosshide', at: [1320, 1300], arena: 48 },
      { id: 'whisperweed', at: [860, 1620], arena: 44 },
    ],
    camps: [
      { at: [1000, 1240], kind: 'thornling', n: 4, tier: 1 },
      { at: [1260, 1580], kind: 'thornling', n: 5, tier: 2 },
    ],
    sites: [
      { id: 'roothome', kind: 'treevillage', at: [1080, 1400], r: 62,
        name: 'ROOTHOME', blurb: 'Built inside the trunk, five floors up.' },
      { id: 'woodwarden', kind: 'camp', at: [1160, 1160], r: 30,
        name: 'THE WOODWARDEN’S FIRE' },
      { id: 'mushroom-ring', kind: 'easteregg', at: [1360, 1580], r: 18,
        name: 'THE RING', blurb: 'Stand in the middle and the wood goes quiet.' },
      { id: 'sunkenchapel', kind: 'ruin', at: [820, 1280], r: 32,
        name: 'THE SUNKEN CHAPEL' },
    ],
  },

  {
    id: 'sunkenstair',
    name: 'THE SUNKEN STAIR',
    blurb: 'A staircase the size of a valley, going down into the water.',
    x: 150, z: 1120, r: 400, feather: 240, tier: 1,
    gate: 'mosshide', arch: 'stone', weather: 'clear', music: 'holy',
    palette: {
      sand: 0xc9bb8e, grass: 0x6f9b4e, grass2: 0x5b8440, dirt: 0x8a7550,
      rock: 0x8b8578, high: 0xd8ddd4, highAt: 200, road: 0x9c937c,
      slopeDirt: 0.28, slopeRock: 0.44, rockFromY: 90,
    },
    sky: { fogNear: 70, fogFar: 560 },
    /**
     * Terraced on purpose: the region IS a staircase, so the height function
     * quantises into steps and then softens the edges. The softening matters
     * for more than looks — a hard terrace is a wall you cannot walk up, and
     * this is the road to the middle of the map.
     */
    ground: (n, x, z) => {
      const base = 44 + n.fbm(x * 0.003, z * 0.003, 3) * 14;
      const tread = 30;
      const step = Math.floor(base / tread) * tread;
      return step + smoothstep(clamp((base % tread) / tread, 0, 1)) * tread;
    },
    landmark: {
      kind: 'statue', at: [150, 990],
      name: 'THE KNEELING KING',
      blurb: 'Ninety feet of him, kneeling, facing north. Nobody knows who.',
    },
    bosses: [
      { id: 'grott', at: [150, 950], arena: 50 },
      { id: 'skarn', at: [400, 1120], arena: 46 },
    ],
    camps: [{ at: [-60, 1080], kind: 'stonewarden', n: 3, tier: 2 }],
    sites: [
      { id: 'stairfoot', kind: 'shrine', at: [150, 1250], r: 22,
        name: 'THE STAIRFOOT SHRINE' },
      { id: 'stairhead-gate', kind: 'gatehouse', at: [150, 890], r: 36,
        name: 'THE STAIRHEAD GATE' },
      { id: 'toll-camp', kind: 'camp', at: [-140, 1220], r: 28,
        name: 'THE TOLLKEEPER’S FIRE' },
    ],
  },

  // ══════════════════════════════════════ TIER 2 — the drowned capital ════
  {
    id: 'anurath',
    name: 'THE ANURATH BASIN',
    blurb: 'The capital of everything, in the bottom of a bowl, half underwater.',
    x: -100, z: 480, r: 440, feather: 260, tier: 2,
    gate: 'grott', arch: 'marble', weather: 'rain', music: 'grim',
    palette: {
      sand: 0xbfb59a, grass: 0x6b8f56, grass2: 0x577542, dirt: 0x8a8068,
      rock: 0x9a978e, high: 0xd0d4cc, highAt: 210, road: 0xa8a294,
      slopeDirt: 0.30, slopeRock: 0.46, rockFromY: 110,
    },
    sky: {
      fogNear: 50, fogFar: 480, fogColor: 0x8f9aa6, skyTop: 0x3f5a78,
      skyMid: 0x7d94ad, cloudCount: 22, sunIntensity: 0.7,
    },
    /**
     * A bowl with a rim. The city sits in the bottom of it, which is why the
     * city drowned — and why every road in the world runs down into it.
     */
    // Local coordinates: the bowl is centred on the region itself.
    ground: (n, x, z) => 96 + n.fbm(x * 0.003, z * 0.003, 4) * 22
      + bowl(x, z, 0, 0, 400, 100),
    landmark: {
      kind: 'palace', at: [-100, 420],
      name: 'THE HIGH CROAK',
      blurb: 'The palace. Its towers are the only part still above the water.',
    },
    bosses: [
      { id: 'stonewalks', at: [-100, 340], arena: 56 },
      { id: 'sableknight', at: [160, 620], arena: 48 },
    ],
    camps: [
      { at: [-340, 560], kind: 'husk', n: 5, tier: 3 },
      { at: [100, 300], kind: 'husk', n: 5, tier: 3 },
    ],
    sites: [
      { id: 'anurath-city', kind: 'city', at: [-170, 550], r: 120,
        name: 'ANURATH', blurb: 'What is left of it, and who is left in it.' },
      { id: 'kings-bridge', kind: 'bridge', at: [-100, 740], r: 40,
        name: 'THE KING’S BRIDGE' },
      { id: 'drowned-library', kind: 'dungeon', at: [-380, 380], r: 36,
        name: 'THE DROWNED LIBRARY', blurb: 'Every book in the world, ruined.' },
      { id: 'throneless-hall', kind: 'ruin', at: [160, 420], r: 38,
        name: 'THE THRONELESS HALL' },
    ],
  },

  {
    id: 'quarry',
    name: 'THE GREAT QUARRY',
    blurb: 'Cut out of the world stone by stone, and never finished.',
    x: 1420, z: 700, r: 400, feather: 240, tier: 2,
    gate: 'stonewalks', arch: 'stone', weather: 'dust', music: 'wild',
    palette: {
      sand: 0xc4b48c, grass: 0x7a8a4e, grass2: 0x64743e, dirt: 0x9a8560,
      rock: 0x9a938a, high: 0xcfd4cc, highAt: 190, road: 0xb0a68c,
      slopeDirt: 0.34, slopeRock: 0.40, rockFromY: 50,
    },
    sky: { fogNear: 80, fogFar: 620, fogColor: 0xcfc7ae },
    /**
     * Pits rather than hills: ridged noise inverted, so the ground is a plain
     * with bites taken out of it. Clamped at the bottom so a pit is a floor
     * you can fight on and not a funnel you slide into.
     */
    ground: (n, x, z) => {
      const plain = 66 + n.fbm(x * 0.0035, z * 0.0035, 3) * 10;
      const pit = Math.max(0, n.ridged(x * 0.0052 + 7, z * 0.0052 - 3, 3) - 0.42);
      return plain - Math.min(38, pit * 92);
    },
    landmark: {
      kind: 'unfinished', at: [1600, 560],
      name: 'THE UNFINISHED KING',
      blurb: 'A statue three hundred feet tall, carved to the waist and abandoned.',
    },
    bosses: [
      { id: 'quarryhand', at: [1420, 540], arena: 52 },
      { id: 'glassback', at: [1660, 820], arena: 46 },
    ],
    camps: [
      { at: [1280, 760], kind: 'stonewarden', n: 4, tier: 2 },
      { at: [1560, 460], kind: 'stonewarden', n: 4, tier: 3 },
    ],
    sites: [
      { id: 'cutters-rest', kind: 'town', at: [1520, 780], r: 82,
        name: 'CUTTER’S REST', blurb: 'They still work it. Nobody knows why.' },
      { id: 'deepcut', kind: 'mine', at: [1260, 600], r: 32,
        name: 'THE DEEPCUT', blurb: 'It goes further down than anyone will say.' },
      { id: 'sledge-shrine', kind: 'shrine', at: [1700, 680], r: 20,
        name: 'THE SLEDGE SHRINE' },
    ],
  },

  {
    id: 'glassfen',
    name: 'THE GLASSFEN',
    blurb: 'Water so still the sky is underneath you as well as above.',
    x: -1340, z: 800, r: 400, feather: 240, tier: 2,
    gate: 'stonewalks', arch: 'stilt', weather: 'mist', music: 'holy',
    amphibious: true,
    palette: {
      sand: 0xb8bcb0, grass: 0x5f8a6a, grass2: 0x4c7356, dirt: 0x6f7264,
      rock: 0x7d8288, high: 0xc8d2d6, highAt: 160, road: 0x8a8c7e,
      slopeDirt: 0.24, slopeRock: 0.40, rockFromY: 70,
    },
    sky: {
      fogNear: 40, fogFar: 420, fogColor: 0xa8c0c8, skyTop: 0x5f8fbe,
      skyMid: 0xa8cfe2, skyBottom: 0xd8e8ee, cloudCount: 10,
      sunIntensity: 0.75, leaves: false,
    },
    ground: (n, x, z) => 5.0 + n.fbm(x * 0.004, z * 0.004, 3) * 3
      + Math.max(0, n.fbm(x * 0.012, z * 0.012, 2)) * 7,
    landmark: {
      kind: 'waterfalltemple', at: [-1560, 660],
      name: 'THE TEMPLE BEHIND THE FALL',
      blurb: 'There is a door behind the waterfall. There is always a door.',
    },
    bosses: [{ id: 'mirrorwidow', at: [-1560, 700], arena: 46 }],
    camps: [{ at: [-1200, 900], kind: 'mirebeast', n: 4, tier: 2 }],
    sites: [
      { id: 'glasshook', kind: 'village', at: [-1240, 760], r: 58,
        name: 'GLASSHOOK', blurb: 'Fishermen. They will not say what they catch.' },
      { id: 'mirror-shrine', kind: 'shrine', at: [-1420, 960], r: 22,
        name: 'THE SHRINE OF TWO SKIES' },
      { id: 'upside-house', kind: 'easteregg', at: [-1620, 920], r: 16,
        name: 'THE UPSIDE HOUSE',
        blurb: 'A cottage, complete and undamaged, standing on its roof.' },
    ],
  },

  // ══════════════════════════════════════ TIER 3 — the middle lands ═══════
  {
    id: 'gravewater',
    name: 'GRAVEWATER',
    blurb: 'They buried them in the shallows. The shallows gave them back.',
    x: -1740, z: 200, r: 400, feather: 240, tier: 3,
    gate: 'quarryhand', arch: 'bone', weather: 'rain', music: 'dread',
    amphibious: true,
    palette: {
      sand: 0x8a8a72, grass: 0x4f6355, grass2: 0x3e5144, dirt: 0x54503f,
      rock: 0x5f6367, high: 0x8d939a, highAt: 150, road: 0x63604c,
      slopeDirt: 0.24, slopeRock: 0.38, rockFromY: 50,
    },
    sky: {
      fogNear: 26, fogFar: 260, fogColor: 0x5a6a68, skyTop: 0x4a5b60,
      skyMid: 0x7d9096, cloudCount: 4, leaves: false,
      sunIntensity: 0.42, ambient: 0x495b60,
    },
    ground: (n, x, z) => 5.2 + n.fbm(x * 0.005, z * 0.005, 4) * 4
      + Math.max(0, n.fbm(x * 0.017, z * 0.017, 2)) * 6,
    landmark: {
      kind: 'lantern', at: [-1620, 40],
      name: 'THE GREAT LANTERN',
      blurb: 'Lit to keep them down. Somebody still climbs up and fills it.',
    },
    bosses: [
      { id: 'gravewater', at: [-1880, 120], arena: 54 },
      { id: 'okka', at: [-1580, 320], arena: 48 },
      { id: 'lanternbearer', at: [-1920, 400], arena: 46 },
    ],
    camps: [
      { at: [-1700, 40], kind: 'drowned', n: 5, tier: 3 },
      { at: [-1860, 340], kind: 'drowned', n: 5, tier: 3 },
    ],
    sites: [
      { id: 'gravekeeper', kind: 'camp', at: [-1620, 40], r: 30,
        name: 'THE GRAVEKEEPER’S LANTERN' },
      { id: 'barrowfields', kind: 'ruin', at: [-1800, -40], r: 42,
        name: 'THE BARROWFIELDS' },
      { id: 'saltwalk', kind: 'bridge', at: [-1540, 200], r: 32,
        name: 'THE SALT WALK' },
    ],
  },

  {
    id: 'thirstlands',
    name: 'THE THIRSTLANDS',
    blurb: 'It was a sea once. The shells are still here; the water is not.',
    x: 1800, z: 150, r: 440, feather: 260, tier: 3,
    gate: 'quarryhand', arch: 'sandstone', weather: 'sand', music: 'hot',
    palette: {
      sand: 0xe0cb96, grass: 0xbfa870, grass2: 0xd0b87e, dirt: 0xb59a68,
      rock: 0xa8906a, high: 0xd8c8a0, highAt: 240, road: 0xd8c49a,
      slopeDirt: 0.34, slopeRock: 0.48, rockFromY: 150,
    },
    sky: {
      fogNear: 90, fogFar: 700, fogColor: 0xe2cfa4, skyTop: 0x4f9fd8,
      skyMid: 0xa8d4ec, skyBottom: 0xefdcae, cloudCount: 4, leaves: false,
      sunColor: 0xfff0c0, sunIntensity: 1.15, ambient: 0xc4a878,
    },
    /**
     * Dunes, plus mesas.
     *
     * The mesas are terraced rather than quantised. A bare `Math.floor` of
     * the noise gives genuinely flat tops, and also gives a thirty-unit
     * vertical wall at every terrace edge — measured, that was a sixty-unit
     * height change over one metre, the worst discontinuity anywhere in the
     * world. Softening the tread edge the way the Sunken Stair does keeps
     * the flat tops and turns the walls into climbable steps.
     */
    ground: (n, x, z) => {
      const base = 44 + n.fbm(x * 0.0022, z * 0.0022, 3) * 22
        + dunes(n, x, z, 30, 320, 0.7);
      const mesa = Math.max(0, n.ridged(x * 0.0026 + 41, z * 0.0026 - 12, 2) - 0.62) * 5;
      const step = Math.floor(mesa);
      const edge = smoothstep(clamp((mesa - step) * 3, 0, 1));
      /**
       * The oasis, centred exactly where the Gilt ends.
       *
       * Local (-80, 55) is world (1720, 205), which is the river's last node.
       * The Gilt runs east out of the Choir Cliffs and stops here, and a
       * river that stops in the middle of a dune is not a river — measured,
       * its mouth sat twenty-five units above the waterline. A basin deep
       * enough to hold water is what makes Sandreed an oasis rather than a
       * town that claims to be one, and the mesas here are tall enough that
       * it has to be a deep one.
       */
      return base + (step + edge) * 30 + bowl(x, z, -80, 55, 165, 108);
    },
    landmark: {
      kind: 'pyramid', at: [1920, -80],
      name: 'THE SUNKEN CROWN',
      blurb: 'A pyramid, buried to its shoulders. Somebody has dug the door out.',
    },
    bosses: [
      { id: 'sandreaver', at: [1920, -80], arena: 50 },
      { id: 'dunelord', at: [1640, 360], arena: 48 },
    ],
    camps: [
      { at: [1720, 20], kind: 'dunestalker', n: 4, tier: 3 },
      { at: [1980, 280], kind: 'dunestalker', n: 5, tier: 4 },
    ],
    sites: [
      // On the SHORE of the oasis, not in it.
      { id: 'sandreed', kind: 'town', at: [1750, 320], r: 82,
        name: 'SANDREED', blurb: 'An oasis, a market, and no questions asked.' },
      { id: 'bonepit', kind: 'ruin', at: [2020, 60], r: 36,
        name: 'THE BONE PIT', blurb: 'Something the size of a hill died here.' },
      { id: 'buried-gate', kind: 'easteregg', at: [1540, 100], r: 18,
        name: 'THE BURIED GATE',
        blurb: 'An archway, standing in sand, leading from nothing to nothing.' },
    ],
  },

  {
    id: 'choircliffs',
    name: 'THE CHOIR CLIFFS',
    blurb: 'The wind comes through the holes in the rock and sings.',
    x: 700, z: -150, r: 400, feather: 240, tier: 3,
    gate: 'gravewater', arch: 'stone', weather: 'clear', music: 'holy',
    palette: {
      sand: 0xcdc3a2, grass: 0x6f8a5e, grass2: 0x5a7349, dirt: 0x8a7d5e,
      rock: 0x8f8a80, high: 0xeef2f6, highAt: 260, road: 0x9e9682,
      slopeDirt: 0.30, slopeRock: 0.44, rockFromY: 150,
    },
    sky: { fogNear: 100, fogFar: 800, skyTop: 0x2569b8, cloudCount: 32 },
    /**
     * Ridges you can WALK.
     *
     * Amplitude 130 at frequency 0.0042 gives a gradient of about 3.4 per
     * unit — a slope of 1.1 on the controller's 0..1 scale, against a climb
     * limit of 0.46. Measured, one of its own shrines sat on 0.69 and no
     * gentler ground existed within three hundred units: the region was a
     * wall pretending to be a place. Wider, lower ridges keep the skyline at
     * a gradient the frog can actually take.
     */
    ground: (n, x, z) => 90 + n.ridged(x * 0.0020 - 11, z * 0.0020 + 5, 4) * 120,
    landmark: {
      kind: 'organ', at: [740, -320],
      name: 'THE STONE ORGAN',
      blurb: 'Forty pipes of rock, four hundred feet tall, and the wind plays them.',
    },
    bosses: [
      { id: 'nix', at: [700, -320], arena: 48 },
      { id: 'twincroaks', at: [500, 20], arena: 52 },
    ],
    camps: [{ at: [880, -40], kind: 'windrider', n: 4, tier: 3 }],
    sites: [
      { id: 'choirhold', kind: 'shrine', at: [700, -20], r: 24,
        name: 'THE CHOIRHOLD' },
      { id: 'windstair', kind: 'tower', at: [920, -240], r: 28,
        name: 'THE WINDSTAIR' },
      { id: 'the-note', kind: 'easteregg', at: [540, -360], r: 16,
        name: 'THE LAST NOTE', blurb: 'Stand still and it finishes the song.' },
    ],
  },

  {
    id: 'boneflats',
    name: 'THE BONEFLATS',
    blurb: 'Flat for a day in every direction, and ribbed like the inside of a chest.',
    x: -820, z: -260, r: 380, feather: 230, tier: 3,
    gate: 'gravewater', arch: 'bone', weather: 'dust', music: 'dread',
    palette: {
      sand: 0xcfc8b4, grass: 0x8a8a70, grass2: 0x9a9a80, dirt: 0x8f8874,
      rock: 0xb8b2a0, high: 0xe0dcd0, highAt: 180, road: 0xa8a290,
      slopeDirt: 0.30, slopeRock: 0.46, rockFromY: 110,
    },
    sky: {
      fogNear: 70, fogFar: 560, fogColor: 0xc8c0aa, skyTop: 0x6f86a0,
      skyMid: 0xb0bcc4, cloudCount: 8, sunIntensity: 0.8, leaves: false,
    },
    /**
     * The ribs are TERRAIN, not props: a periodic ridge crossing the whole
     * region, so from the ground you are walking between the bones of
     * something and from the cliffs above you can see what it was.
     */
    ground: (n, x, z) => {
      const flat = 34 + n.fbm(x * 0.003, z * 0.003, 3) * 8;
      // Local coordinates: the ribs run east-west through the region's middle.
      const s = Math.max(0, Math.sin(x * 0.0125));
      const rib = s * s * s * s * 34 * clamp(1 - Math.abs(z) / 340, 0, 1);
      return flat + rib;
    },
    landmark: {
      kind: 'skull', at: [-1100, -320],
      name: 'THE GREAT SKULL',
      blurb: 'You can walk in through the eye. People have. Some came out.',
    },
    bosses: [{ id: 'ossuar', at: [-1100, -320], arena: 50 }],
    camps: [
      { at: [-680, -180], kind: 'bonepicker', n: 4, tier: 3 },
      { at: [-940, -440], kind: 'bonepicker', n: 5, tier: 4 },
    ],
    sites: [
      { id: 'ribwatch', kind: 'camp', at: [-680, -300], r: 32,
        name: 'RIBWATCH', blurb: 'Bonepickers, and they are not the worst of it.' },
      { id: 'seventh-rib', kind: 'ruin', at: [-900, -160], r: 32,
        name: 'THE SEVENTH RIB' },
      { id: 'oathbreaker', kind: 'easteregg', at: [-700, -470], r: 20,
        name: 'THE OATHBREAKER',
        blurb: 'A sword the length of a bridge, driven through the ribs into the ground.' },
    ],
  },

  {
    id: 'drownedkeep',
    name: 'THE DROWNED KEEP',
    blurb: 'A castle at the bottom of a lake. You can see the towers from the shore.',
    /**
     * Tier 3, not 4.
     *
     * It sits 2400 units from the start — nearer than Gravewater, which is
     * tier 3 — and danger has to rise with distance or the map stops teaching
     * the player where they can go. It is also gated on Nix, who is tier 3,
     * so a tier-4 label here disagreed with its own gate.
     */
    x: 1320, z: -320, r: 340, feather: 200, tier: 3,
    gate: 'nix', arch: 'marble', weather: 'mist', music: 'strange',
    amphibious: true,
    palette: {
      sand: 0x9aa8a0, grass: 0x5a7a66, grass2: 0x486350, dirt: 0x6a7064,
      rock: 0x74807e, high: 0xbecac4, highAt: 170, road: 0x7e857a,
      slopeDirt: 0.26, slopeRock: 0.42, rockFromY: 80,
    },
    sky: {
      fogNear: 34, fogFar: 340, fogColor: 0x92a8ae, skyTop: 0x4a6f8a,
      skyMid: 0x8fb0be, cloudCount: 12, sunIntensity: 0.6, leaves: false,
    },
    ground: (n, x, z) => 60 + n.fbm(x * 0.0034, z * 0.0034, 3) * 16
      + bowl(x, z, 0, 0, 300, 92),
    landmark: {
      kind: 'sunkentower', at: [1320, -320],
      name: 'THE LEANING TOWERS',
      blurb: 'Four of them, out of the water at an angle, still flying flags.',
    },
    bosses: [{ id: 'dolmath', at: [1320, -160], arena: 52 }],
    camps: [{ at: [1180, -440], kind: 'drowned', n: 5, tier: 4 }],
    sites: [
      { id: 'lakewatch', kind: 'village', at: [1140, -140], r: 54,
        name: 'LAKEWATCH', blurb: 'They row out at night and will not say why.' },
      { id: 'keep-arena', kind: 'arena', at: [1460, -460], r: 42,
        name: 'THE SUNKEN RING', blurb: 'Somebody is still taking bets.' },
    ],
  },

  // ══════════════════════════════════════ TIER 4 — the burning frontier ═══
  {
    id: 'emberwaste',
    name: 'THE EMBERWASTE',
    blurb: 'It burned a long time ago and has not finished.',
    x: 1540, z: -640, r: 420, feather: 250, tier: 4,
    gate: 'nix', arch: 'obsidian', weather: 'ash', music: 'hot',
    palette: {
      sand: 0x8f6a4a, grass: 0x6a4a32, grass2: 0x543a26, dirt: 0x5a3a24,
      rock: 0x4a3a34, high: 0x8a7a72, highAt: 200, road: 0x54402e,
      slopeDirt: 0.32, slopeRock: 0.42, rockFromY: 70,
    },
    sky: {
      fogNear: 44, fogFar: 420, fogColor: 0x6a4432, skyTop: 0x5e2a1e,
      skyMid: 0xa8583a, skyBottom: 0xd8916a, cloudCount: 6, leaves: false,
      sunColor: 0xffc08a, sunIntensity: 0.85, ambient: 0x6a3a2a,
    },
    ground: (n, x, z) => 74 + n.fbm(x * 0.004, z * 0.004, 4) * 30
      + Math.max(0, n.ridged(x * 0.008 + 3, z * 0.008 + 9, 3) - 0.5) * 100,
    landmark: {
      kind: 'burnttree', at: [1380, -520],
      name: 'THE BLACK CANDLE',
      blurb: 'One tree left standing out of a forest, and it is still smoking.',
    },
    bosses: [
      { id: 'varn', at: [1540, -760], arena: 48 },
      { id: 'cindren', at: [1760, -520], arena: 46 },
    ],
    camps: [
      { at: [1400, -640], kind: 'emberling', n: 5, tier: 4 },
      { at: [1660, -820], kind: 'emberling', n: 5, tier: 4 },
    ],
    sites: [
      { id: 'ashfall', kind: 'camp', at: [1400, -760], r: 30,
        name: 'THE ASHFALL CAMP' },
      { id: 'burnt-village', kind: 'ruin', at: [1640, -460], r: 46,
        name: 'WHAT WAS EMBERFORD', blurb: 'Doorways, chimneys, and nothing else.' },
      { id: 'kiln', kind: 'dungeon', at: [1820, -720], r: 34,
        name: 'THE OLD KILN' },
    ],
  },

  {
    id: 'cindermaw',
    name: 'CINDERMAW',
    blurb: 'The mountain that is still eating. You can see it from the capital.',
    x: 1960, z: -1120, r: 420, feather: 250, tier: 5,
    gate: 'varn', arch: 'obsidian', weather: 'ash', music: 'hot',
    palette: {
      sand: 0x5a4038, grass: 0x4a3830, grass2: 0x3a2a24, dirt: 0x40302a,
      rock: 0x33292a, high: 0x6a5a56, highAt: 420, road: 0x453632,
      slopeDirt: 0.36, slopeRock: 0.44, rockFromY: 140,
    },
    sky: {
      fogNear: 34, fogFar: 340, fogColor: 0x4a2620, skyTop: 0x2a1210,
      skyMid: 0x8a2e1c, skyBottom: 0xd06a30, cloudCount: 0, leaves: false,
      sunColor: 0xff9a50, sunIntensity: 0.7, ambient: 0x6a2a18,
    },
    /**
     * An actual cone with an actual caldera. The point of the shape is that
     * you can identify this region from three regions away, which is what a
     * landmark is for — and the height function is the only thing that can
     * make a mountain that big.
     */
    // The cone sits at local (20, -80) — world (1980, -1200) — which is where
    // the landmark's caldera furniture is placed.
    ground: (n, x, z) => 80 + n.fbm(x * 0.005, z * 0.005, 3) * 20
      + cone(x, z, 20, -80, 400, 400, 150)
      + Math.max(0, n.ridged(x * 0.01 + 5, z * 0.01 - 7, 2) - 0.6) * 40,
    landmark: {
      kind: 'volcano', at: [1980, -1200],
      name: 'THE MAW',
      blurb: 'The caldera. There is a temple on the rim and it is still in use.',
    },
    bosses: [
      { id: 'volkh', at: [1700, -1000], arena: 52 },
      { id: 'emberthrone', at: [1780, -1400], arena: 48 },
    ],
    camps: [
      { at: [1820, -1320], kind: 'cinderhound', n: 5, tier: 5 },
      { at: [2100, -960], kind: 'cinderhound', n: 5, tier: 5 },
    ],
    sites: [
      { id: 'rimtemple', kind: 'temple', at: [1740, -1220], r: 38,
        name: 'THE RIM TEMPLE', blurb: 'They have not let the fire go out.' },
      { id: 'lava-bridge', kind: 'bridge', at: [1840, -880], r: 36,
        name: 'THE BLACK SPAN' },
      { id: 'glass-cave', kind: 'cave', at: [2140, -1300], r: 26,
        name: 'THE GLASS THROAT' },
    ],
  },

  {
    id: 'spine',
    name: 'THE SPINE OF THE DEEP',
    blurb: 'A ridge of vertebrae, and it is not a metaphor.',
    x: -420, z: -820, r: 380, feather: 230, tier: 4,
    gate: 'varn', arch: 'bone', weather: 'clear', music: 'dread',
    palette: {
      sand: 0xb8b2a0, grass: 0x5f6f52, grass2: 0x4d5c42, dirt: 0x6f6552,
      rock: 0x7d7a74, high: 0xf2f5f8, highAt: 280, road: 0x88837a,
      slopeDirt: 0.28, slopeRock: 0.42, rockFromY: 170,
    },
    sky: { fogNear: 80, fogFar: 640, skyTop: 0x1f4f86, skyMid: 0x5a8fc0 },
    // Same correction as the Choir Cliffs: 150 at 0.0035 was a gradient of
    // 3.3, more than twice what can be climbed.
    ground: (n, x, z) => 110 + n.ridged(x * 0.0017 + 31, z * 0.0017 - 17, 4) * 140,
    landmark: {
      kind: 'archway', at: [-440, -960],
      name: 'THE EYE OF THE DEEP',
      blurb: 'A hole through the ridge, big enough to see the next region through.',
    },
    bosses: [{ id: 'huldr', at: [-440, -960], arena: 52 }],
    camps: [{ at: [-300, -700], kind: 'bonepicker', n: 4, tier: 4 }],
    sites: [
      { id: 'vertebrae', kind: 'ruin', at: [-580, -760], r: 32,
        name: 'THE SEVENTH VERTEBRA' },
      { id: 'spinecamp', kind: 'camp', at: [-280, -880], r: 28,
        name: 'THE LAST FIRE BEFORE THE RIDGE' },
    ],
  },

  {
    id: 'moonshelf',
    name: 'THE MOONSHELF',
    blurb: 'A shelf of white rock above the cloud, and it is night up here.',
    x: 320, z: -940, r: 380, feather: 230, tier: 4,
    gate: 'varn', arch: 'marble', weather: 'motes', music: 'strange',
    palette: {
      sand: 0xb8bcc8, grass: 0x5a6478, grass2: 0x48506a, dirt: 0x6a6e80,
      rock: 0x8a90a4, high: 0xdfe6f4, highAt: 320, road: 0x8f94a6,
      slopeDirt: 0.28, slopeRock: 0.44, rockFromY: 210,
    },
    sky: {
      fogNear: 70, fogFar: 620, fogColor: 0x2a3350, skyTop: 0x0a1030,
      skyMid: 0x243a66, skyBottom: 0x5a6f96, cloudCount: 14, leaves: false,
      sunColor: 0xc8d8ff, sunIntensity: 0.42, ambient: 0x2f3a5c,
    },
    ground: (n, x, z) => 190 + n.fbm(x * 0.0028, z * 0.0028, 4) * 40
      + Math.max(0, n.ridged(x * 0.0034 + 17, z * 0.0034 + 23, 3) - 0.55) * 120,
    landmark: {
      kind: 'skytower', at: [340, -1080],
      name: 'THE NEEDLE',
      blurb: 'A tower going up into the cloud. Nobody has reported the top.',
    },
    bosses: [{ id: 'moonwake', at: [340, -1080], arena: 48 }],
    camps: [{ at: [180, -860], kind: 'windrider', n: 4, tier: 4 }],
    sites: [
      { id: 'moonwatch', kind: 'village', at: [180, -1000], r: 52,
        name: 'MOONWATCH', blurb: 'Astronomers. They have not slept in years.' },
      { id: 'floatstones', kind: 'easteregg', at: [480, -880], r: 20,
        name: 'THE UNFALLEN',
        blurb: 'Nine boulders, hanging in the air, exactly where they stopped.' },
    ],
  },

  {
    id: 'palewood',
    name: 'THE PALEWOOD',
    blurb: 'Every tree the same colour as fog. So is everything else.',
    x: -1700, z: -700, r: 380, feather: 230, tier: 4,
    gate: 'huldr', arch: 'timber', weather: 'fog', music: 'strange',
    palette: {
      sand: 0xd0cfc6, grass: 0x8f9a8c, grass2: 0x7c887a, dirt: 0x8a8a7e,
      rock: 0x9a9a92, high: 0xe8ece8, highAt: 170, road: 0x9c9c90,
      slopeDirt: 0.26, slopeRock: 0.44, rockFromY: 110,
    },
    sky: {
      fogNear: 16, fogFar: 170, fogColor: 0xc9cec7, skyTop: 0xa8b0a8,
      skyMid: 0xc4cbc2, skyBottom: 0xdfe4de, cloudCount: 0,
      sunIntensity: 0.4, ambient: 0x9aa39a, leafCount: 200,
    },
    ground: (n, x, z) => 44 + n.fbm(x * 0.004, z * 0.004, 4) * 18,
    landmark: {
      kind: 'whitedoor', at: [-1560, -560],
      name: 'THE WHITE DOOR',
      blurb: 'A door, four storeys tall, attached to nothing at all.',
    },
    bosses: [{ id: 'palecroak', at: [-1700, -840], arena: 48 }],
    camps: [{ at: [-1840, -600], kind: 'palething', n: 4, tier: 4 }],
    sites: [
      { id: 'white-door', kind: 'easteregg', at: [-1560, -560], r: 20,
        name: 'THE WHITE DOOR', blurb: 'It is a door. It is not attached to anything.' },
      { id: 'pale-camp', kind: 'camp', at: [-1560, -840], r: 28,
        name: 'THE LAST LANTERN' },
      { id: 'pale-hollow', kind: 'cave', at: [-1880, -820], r: 24,
        name: 'THE HOLLOW', blurb: 'The fog goes in and does not come out.' },
    ],
  },

  // ══════════════════════════════════════ TIER 5 — the end of the world ═══
  {
    id: 'hollowcity',
    name: 'THE HOLLOW CITY',
    blurb: 'It held a million frogs. The walls are still up.',
    x: 900, z: -1400, r: 420, feather: 240, tier: 5,
    gate: 'huldr', arch: 'stone', weather: 'dust', music: 'dread',
    palette: {
      sand: 0xa8a08c, grass: 0x5a6350, grass2: 0x49523f, dirt: 0x6a6252,
      rock: 0x74706a, high: 0xb8bcb6, highAt: 260, road: 0x7e7a70,
      slopeDirt: 0.30, slopeRock: 0.46, rockFromY: 100,
    },
    sky: {
      fogNear: 56, fogFar: 460, fogColor: 0x6a6f78, skyTop: 0x3a4450,
      skyMid: 0x6f7a86, cloudCount: 8, sunIntensity: 0.55,
    },
    ground: (n, x, z) => 78 + n.fbm(x * 0.0032, z * 0.0032, 3) * 16,
    landmark: {
      kind: 'wall', at: [900, -1230],
      name: 'THE LAST GATE',
      blurb: 'Two hundred feet of wall, and the gate is barred from the inside.',
    },
    bosses: [
      { id: 'hollowking', at: [900, -1520], arena: 58 },
      { id: 'gatewright', at: [1120, -1300], arena: 50 },
    ],
    camps: [
      { at: [1020, -1340], kind: 'cityhusk', n: 6, tier: 5 },
      { at: [780, -1500], kind: 'cityhusk', n: 6, tier: 5 },
    ],
    sites: [
      { id: 'lastgate', kind: 'gatehouse', at: [900, -1230], r: 46,
        name: 'THE LAST GATE' },
      { id: 'hollow-market', kind: 'city', at: [860, -1400], r: 112,
        name: 'THE HOLLOW MARKET',
        blurb: 'Stalls, awnings, prices chalked up. Nobody.' },
      { id: 'undercity', kind: 'dungeon', at: [1080, -1520], r: 38,
        name: 'THE UNDERCITY' },
    ],
  },

  {
    id: 'glimmerwood',
    name: 'THE GLIMMERWOOD',
    blurb: 'The rocks are up in the air and the plants are lit from inside.',
    x: -320, z: -1480, r: 400, feather: 240, tier: 5,
    gate: 'hollowking', arch: 'crystal', weather: 'spores', music: 'strange',
    palette: {
      sand: 0x8f9ab8, grass: 0x4a7a86, grass2: 0x3a6470, dirt: 0x5a5a78,
      rock: 0x6a6a92, high: 0xc0d8f0, highAt: 260, road: 0x6f6f8c,
      slopeDirt: 0.26, slopeRock: 0.42, rockFromY: 160,
    },
    sky: {
      fogNear: 40, fogFar: 400, fogColor: 0x3a4a7a, skyTop: 0x14184a,
      skyMid: 0x3a4a92, skyBottom: 0x6a8ac0, cloudCount: 6, leaves: false,
      sunColor: 0xa8c8ff, sunIntensity: 0.5, ambient: 0x3a4a80,
    },
    ground: (n, x, z) => 96 + n.fbm(x * 0.0036, z * 0.0036, 4) * 34
      + Math.max(0, n.ridged(x * 0.006 - 21, z * 0.006 + 13, 2) - 0.66) * 90,
    landmark: {
      kind: 'crystal', at: [-340, -1620],
      name: 'THE HEARTSHARD',
      blurb: 'A crystal the size of a cathedral, and it hums when you get close.',
    },
    bosses: [{ id: 'prismgaunt', at: [-340, -1620], arena: 50 }],
    camps: [
      { at: [-180, -1400], kind: 'prismling', n: 5, tier: 5 },
      { at: [-480, -1560], kind: 'prismling', n: 5, tier: 5 },
    ],
    sites: [
      { id: 'lumen', kind: 'village', at: [-180, -1500], r: 54,
        name: 'LUMEN', blurb: 'They grow the light. They will show you how.' },
      { id: 'floating-stair', kind: 'ruin', at: [-520, -1400], r: 34,
        name: 'THE FLOATING STAIR' },
      { id: 'singing-cave', kind: 'cave', at: [-160, -1680], r: 26,
        name: 'THE SINGING CAVE' },
    ],
  },

  {
    id: 'frostmarch',
    name: 'THE FROSTMARCH',
    blurb: 'The cold got here first and never left.',
    x: -1240, z: -1380, r: 420, feather: 250, tier: 5,
    gate: 'hollowking', arch: 'ice', weather: 'snow', music: 'cold',
    palette: {
      sand: 0xd8dde2, grass: 0x8fa08f, grass2: 0x7b8c7b, dirt: 0x7a7f84,
      rock: 0x8a9099, high: 0xf6f9fc, highAt: 150, road: 0x9aa0a8,
      slopeDirt: 0.28, slopeRock: 0.42, rockFromY: 110,
    },
    sky: {
      fogNear: 44, fogFar: 380, fogColor: 0xc4d2de, skyTop: 0x5f86b0,
      skyMid: 0xa8c6de, skyBottom: 0xdfeaf2, sunColor: 0xdfeaff,
      sunIntensity: 0.7, ambient: 0x8fa4bc, leaves: false,
    },
    ground: (n, x, z) => 96 + n.fbm(x * 0.0036, z * 0.0036, 4) * 46,
    landmark: {
      kind: 'frozencastle', at: [-1080, -1230],
      name: 'THE HOARFROST HOLD',
      blurb: 'A castle with the sea frozen halfway up its walls.',
    },
    bosses: [
      { id: 'brack', at: [-1240, -1520], arena: 48 },
      { id: 'hoarwarden', at: [-1020, -1580], arena: 46 },
    ],
    camps: [{ at: [-1380, -1280], kind: 'frostling', n: 5, tier: 5 }],
    sites: [
      { id: 'coldhearth', kind: 'camp', at: [-1140, -1320], r: 30,
        name: 'THE COLD HEARTH' },
      { id: 'hoarfrost', kind: 'keep', at: [-1080, -1230], r: 62,
        name: 'THE HOARFROST HOLD' },
      { id: 'frozen-fall', kind: 'easteregg', at: [-1330, -1230], r: 20,
        name: 'THE STOPPED FALL',
        blurb: 'A waterfall, frozen mid-fall, with fish in it.' },
    ],
  },

  {
    id: 'rimefang',
    name: 'THE RIMEFANG',
    blurb: 'Mountains with the tops bitten off. Nothing lives above the third ridge.',
    x: -1880, z: -1620, r: 400, feather: 240, tier: 5,
    gate: 'brack', arch: 'ice', weather: 'blizzard', music: 'cold',
    palette: {
      sand: 0xe4eaf0, grass: 0xa8b8c0, grass2: 0x94a4ae, dirt: 0x8a939c,
      rock: 0x9aa4ae, high: 0xffffff, highAt: 340, road: 0xb0bac2,
      slopeDirt: 0.30, slopeRock: 0.44, rockFromY: 200,
    },
    sky: {
      fogNear: 26, fogFar: 240, fogColor: 0xdae6f0, skyTop: 0x7f9ec0,
      skyMid: 0xc4dcee, skyBottom: 0xeff6fa, sunColor: 0xf0f8ff,
      sunIntensity: 0.55, ambient: 0xa8bccc, leaves: false, cloudCount: 0,
    },
    ground: (n, x, z) => 150 + n.ridged(x * 0.0016 - 61, z * 0.0016 + 37, 4) * 320,
    landmark: {
      kind: 'icetemple', at: [-1780, -1800],
      name: 'THE TOOTH',
      blurb: 'A temple cut into the last peak, with the door facing the wind.',
    },
    bosses: [{ id: 'rimeglass', at: [-1780, -1800], arena: 46 }],
    camps: [{ at: [-1980, -1480], kind: 'rimewraith', n: 5, tier: 5 }],
    sites: [
      { id: 'the-tooth', kind: 'temple', at: [-1780, -1800], r: 38,
        name: 'THE TOOTH' },
      { id: 'ice-caves', kind: 'cave', at: [-2020, -1740], r: 28,
        name: 'THE BLUE THROAT' },
    ],
  },

  {
    id: 'sunderway',
    name: 'THE SUNDERWAY',
    blurb: 'The land stops. There is a bridge, and it is the only way north.',
    x: 420, z: -1780, r: 340, feather: 200, tier: 5,
    gate: 'brack', arch: 'stone', weather: 'clear', music: 'dread',
    palette: {
      sand: 0x8f8a7e, grass: 0x5a6152, grass2: 0x494f42, dirt: 0x6a6355,
      rock: 0x6f6c66, high: 0xb0b4ae, highAt: 320, road: 0x8a867c,
      slopeDirt: 0.30, slopeRock: 0.46, rockFromY: 160,
    },
    sky: {
      fogNear: 60, fogFar: 520, fogColor: 0x6a6f7a, skyTop: 0x2a3240,
      skyMid: 0x5f6b7c, cloudCount: 10, sunIntensity: 0.5, leaves: false,
    },
    /**
     * Two plateaus and a chasm.
     *
     * The road across it is graded into a causeway by the road network — see
     * roads.js — which is what makes the crossing walkable at all. The chasm
     * itself is two hundred units deep and is meant to be looked into, not
     * climbed.
     */
    ground: (n, x, z) => {
      const plateau = 200 + n.fbm(x * 0.003, z * 0.003, 3) * 30;
      // Local coordinates: the chasm runs east-west through the middle of the
      // region, which is where the causeway crosses it.
      const gap = clamp(1 - Math.abs(z) / 140, 0, 1);
      return plateau - smoothstep(gap) * 220;
    },
    /**
     * Fall off the causeway and you are fished out.
     *
     * The chasm floor is under the waterline and its walls are seventeen
     * units of rise per metre. It is not a dead end — the chasm tapers out at
     * both ends where this region stops dominating the blend, so a player CAN
     * swim four hundred units east or west and walk up out of it, and the
     * reachability test proves that. But four hundred units of swimming after
     * a misstep is a punishment nobody enjoys, so `pit` says: below this
     * height, in this region, you are in the hole, and after a moment
     * somebody puts you back at the near side.
     *
     * Death would do it too, but being killed by scenery you were told to
     * cross is a worse answer than being rescued from it.
     */
    pit: { below: 70, to: [420, -1640] },
    landmark: {
      kind: 'bigbridge', at: [420, -1780],
      name: 'THE SUNDERWAY',
      blurb: 'A bridge a quarter of a mile long, and it was built in one night.',
    },
    bosses: [{ id: 'arkos', at: [420, -1900], arena: 48 }],
    camps: [{ at: [560, -1660], kind: 'husk', n: 5, tier: 5 }],
    sites: [
      { id: 'span-camp', kind: 'camp', at: [420, -1640], r: 30,
        name: 'THE NEAR SIDE' },
      { id: 'span-shrine', kind: 'shrine', at: [420, -1920], r: 22,
        name: 'THE FAR SIDE SHRINE' },
    ],
  },

  {
    id: 'ashenthrone',
    name: 'THE ASHEN THRONE',
    blurb: 'Where the First Croak sat down and never stood up.',
    x: 0, z: -1990, r: 340, feather: 200, tier: 5,
    gate: 'arkos', arch: 'obsidian', weather: 'ash', music: 'dread',
    palette: {
      sand: 0x6a6258, grass: 0x4a4a44, grass2: 0x3c3c37, dirt: 0x4a423a,
      rock: 0x55524c, high: 0x8f8a84, highAt: 300, road: 0x5e5a52,
      slopeDirt: 0.30, slopeRock: 0.44, rockFromY: 60,
    },
    sky: {
      fogNear: 34, fogFar: 320, fogColor: 0x3a3a42, skyTop: 0x1a1a22,
      skyMid: 0x40404e, skyBottom: 0x6a6072, cloudCount: 0, leaves: false,
      sunColor: 0xffd0a0, sunIntensity: 0.5, ambient: 0x3a3a48,
    },
    ground: (n, x, z) => 150 + n.fbm(x * 0.004, z * 0.004, 3) * 22,
    landmark: {
      kind: 'throne', at: [0, -2070],
      name: 'THE ASHEN THRONE',
      blurb: 'The seat itself. It is far too big for anything that walks.',
    },
    bosses: [
      { id: 'zehl', at: [0, -1900], arena: 56 },
      { id: 'frogath', at: [0, -2070], arena: 72, final: true },
    ],
    camps: [],
    sites: [
      { id: 'thronegate', kind: 'gatehouse', at: [0, -1810], r: 40,
        name: 'THE THRONE GATE' },
    ],
  },
];

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

/** Every region you may walk into with an empty save. */
export const OPEN_AT_START = REGIONS.filter((R) => !R.gate).map((R) => R.id);

/**
 * Is this region walkable yet, given what the player has put down?
 *
 * The gate is a guardian id, so the whole progression chain already lives in
 * the region table and cannot disagree with it. Nothing anywhere keeps a
 * separate list of "unlocked areas" that could drift out of step with the
 * save.
 */
export function regionOpen(region, slain) {
  return !region.gate || slain.has(region.gate);
}

// ───────────────────────────────────────────────────────── ground blending ──

/**
 * How small a share of the blend a region may have before it is dropped.
 *
 * Evaluating a region's `ground` is the expensive part of a height sample —
 * multi-octave noise, several times over — and at twenty-four regions a naive
 * blend evaluates all of them for every one of the one and a half million
 * samples the heightfield needs. Almost all of that work is thrown away: a
 * region on the far side of the map contributes about a ten-thousandth.
 *
 * So regions below LO are skipped entirely, and regions between LO and HI are
 * faded in smoothly. The fade is what makes this safe: without it a region
 * crossing the cut would pop in at full weight and leave a step in the
 * ground. With it the contribution is continuous, and the largest error is a
 * fraction of a per cent of a height difference, spread over hundreds of
 * units — centimetres, sloped over a walk.
 */
const CUT_LO = 0.0010;
const CUT_HI = 0.0055;

/** Scratch for the two-pass weighting, so a height sample allocates nothing. */
const _raw = new Float64Array(64);

export function regionWeights(x, z, out) {
  const n = REGIONS.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const R = REGIONS[i];
    const dx = x - R.x, dz = z - R.z;
    /**
     * A weight that is large near the centre and never reaches zero.
     *
     * The first version used a falloff that hit zero at r + feather, with
     * "hand it to the nearest region" for anywhere past every region. That
     * fallback is a Voronoi diagram, and it looks like one: the atlas came
     * out with hard straight-edged wedges radiating across the outer third
     * of the map, in the ground colour AND in the height, because two
     * neighbouring points could be assigned to different regions with
     * nothing in between.
     *
     * Inverse fourth power of the distance in units of the region's own
     * radius is smooth everywhere and total everywhere, so there is no
     * fallback to be seamed against. It is 1 at the region's edge, a
     * sixteenth at twice that, and a two-hundred-and-fifty-sixth at four
     * times — sharp enough that a region still owns its own ground, soft
     * enough that the corners of the map are a blend rather than a mosaic.
     */
    const u = Math.max(0.04, Math.hypot(dx, dz) / R.r);
    const u2 = u * u;
    const w = 1 / (u2 * u2);
    _raw[i] = w;
    total += w;
  }

  // Second pass: keep what matters, faded in over the cut so the drop is
  // continuous. Entries are reused rather than allocated — this runs well
  // over a million times during loading.
  let kept = 0, m = 0;
  const inv = 1 / total;
  for (let i = 0; i < n; i++) {
    const share = _raw[i] * inv;
    if (share <= CUT_LO) continue;
    const w = share >= CUT_HI ? _raw[i]
      : _raw[i] * smoothstep((share - CUT_LO) / (CUT_HI - CUT_LO));
    let e = out[m];
    if (!e) e = out[m] = { region: null, w: 0 };
    e.region = REGIONS[i];
    e.w = w;
    kept += w;
    m++;
  }
  out.length = m;
  return kept;
}

/** The region a point belongs to — the heaviest one. Never null. */
export function regionAt(x, z, scratch) {
  const list = scratch || [];
  regionWeights(x, z, list);
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (list[i].w > best.w) best = list[i];
  return best.region;
}
