/**
 * THE REALM — every region of the open world, as data.
 *
 * This file is the world's spine. A region owns its ground, its weather, its
 * monsters, its people and its secrets, and everything else in the overworld
 * reads them from here: the terrain generator asks each region how high its
 * ground is, the encounter placer asks which guardians live in it, the quest
 * log asks where its people are standing.
 *
 * It is data and not code for the same reason `maps.js` is: adding a region,
 * a boss or a village must never mean touching the generator, the streamer or
 * the renderer. A region is a literal you can read in one sitting.
 *
 * ── the shape of a region ──────────────────────────────────────────────────
 *   id        stable key; save files and quests refer to regions by this
 *   name      what the player is told when they cross into it
 *   blurb     one line, shown on the map screen
 *   x, z      centre, in world units
 *   r         radius of its full influence
 *   feather   how far its influence fades out past `r`
 *   tier      0-5, roughly how dangerous; drives level guidance and rewards
 *   palette   ground colours; same keys the valley's palette uses
 *   sky       atmosphere preset, spread over the default
 *   ground    (n, x, z) => height, in region-local terms. See `realmHeight`.
 *   bosses    guardian ids that live here, with where and how big
 *   camps     small enemy groups
 *   sites     named places: villages, shrines, ruins, easter eggs
 *
 * ── how the ground is blended ──────────────────────────────────────────────
 * Regions overlap. Every one contributes a weight that falls from 1 at its
 * centre to 0 at `r + feather`, and the final height is the weighted average.
 * That is what stops a region boundary being a cliff: two neighbours simply
 * average into each other over the width of their feathers. `realmHeight`
 * below is the only place that arithmetic lives.
 */

import { clamp, smoothstep } from './util.js?v=v80';

/** World extent. The realm spans -REALM_HALF .. +REALM_HALF on X and Z. */
export const REALM_SIZE = 3072;
export const REALM_HALF = REALM_SIZE / 2;

/** Sea level. Below this is water, and swimming works exactly as it does. */
export const SEA = 6;

export const REGIONS = [
  // ═══════════════════════════════════════════════════ TIER 0 — the start ══
  {
    id: 'shallows',
    name: 'THE LILY SHALLOWS',
    blurb: 'Warm water, flat stones, and nothing that wants to kill you yet.',
    x: 0, z: 520, r: 300, feather: 190, tier: 0,
    palette: {
      sand: 0xd8cb92, grass: 0x7cc258, grass2: 0x63a844, dirt: 0x8a7550,
      rock: 0x6f6a63, high: 0x9fb0a4, highAt: 120,
      slopeDirt: 0.30, slopeRock: 0.52, rockFromY: 70,
    },
    sky: { fogNear: 70, fogFar: 620, skyTop: 0x2f7fd0, skyMid: 0x79bfee },
    /**
     * Deliberately almost flat. This is where a player learns which way is
     * forward, and a beginner region that hides its own exits behind hills
     * teaches nothing except that the game is confusing.
     */
    ground: (n, x, z) => 7 + n.fbm(x * 0.0022, z * 0.0022, 3) * 5,
    bosses: [],
    camps: [
      { at: [-120, 470], kind: 'lurker', n: 3, tier: 0 },
      { at: [150, 600], kind: 'lurker', n: 3, tier: 0 },
    ],
    sites: [
      { id: 'croakhollow', kind: 'village', at: [0, 470], r: 62,
        name: 'CROAKHOLLOW', blurb: 'The last village that still has a roof.' },
      { id: 'first-shrine', kind: 'shrine', at: [130, 380], r: 16,
        name: 'THE LISTENING STONE' },
    ],
  },

  // ══════════════════════════════════════════════════ TIER 1 — the marshes ══
  {
    id: 'mirefen',
    name: 'MIREFEN',
    blurb: 'Wading depth for a day in every direction. Something under it.',
    x: -640, z: 400, r: 330, feather: 200, tier: 1,
    // Most of this region is under the waterline and that is the region.
    // Its warden is called the Warden of the Shallows and its village is
    // called The Stilts; demanding dry ground for either would be demanding
    // it stop being a marsh. Wading depth is walkable, so content here is
    // placed in it.
    amphibious: true,
    palette: {
      sand: 0x6a6a52, grass: 0x4a6b3a, grass2: 0x3d5c33, dirt: 0x4a4438,
      rock: 0x53565c, high: 0x6a6f77, highAt: 120,
      slopeDirt: 0.22, slopeRock: 0.34, rockFromY: 40,
    },
    sky: {
      fogNear: 20, fogFar: 260, fogColor: 0x5d6c70, skyTop: 0x64757c,
      skyMid: 0x8fa1a4, skyBottom: 0xc3ccc6, cloudCount: 0, leaves: false,
      sunColor: 0xcfe0dd, sunIntensity: 0.6, ambient: 0x53656b,
    },
    ground: (n, x, z) => 4.6 + n.fbm(x * 0.0045, z * 0.0045, 4) * 3.4
      + Math.max(0, n.fbm(x * 0.014, z * 0.014, 3)) * 5,
    bosses: [
      { id: 'silt', at: [-700, 300], arena: 44 },
      { id: 'tidemother', at: [-520, 560], arena: 52 },
    ],
    camps: [
      { at: [-560, 300], kind: 'lurker', n: 4, tier: 1 },
      { at: [-760, 470], kind: 'reedstalker', n: 3, tier: 1 },
    ],
    sites: [
      { id: 'stilts', kind: 'village', at: [-620, 470], r: 48,
        name: 'THE STILTS', blurb: 'Nine huts and a rope. No ground at all.' },
      { id: 'drowned-bell', kind: 'easteregg', at: [-820, 330], r: 12,
        name: 'THE DROWNED BELL',
        blurb: 'Ring it three times and something answers.' },
    ],
  },

  {
    id: 'bramblewood',
    name: 'THE BRAMBLEWOOD',
    blurb: 'Old forest. The canopy closes over the path behind you.',
    x: 560, z: 380, r: 320, feather: 190, tier: 1,
    palette: {
      sand: 0xbcae7e, grass: 0x3f7a34, grass2: 0x2f5f27, dirt: 0x6b5333,
      rock: 0x6a6459, high: 0xa8b3a0, highAt: 130,
      slopeDirt: 0.26, slopeRock: 0.46, rockFromY: 80,
    },
    sky: { fogNear: 40, fogFar: 300, fogColor: 0x8fae86, leafCount: 260 },
    ground: (n, x, z) => 12 + n.fbm(x * 0.0038, z * 0.0038, 4) * 16,
    bosses: [
      { id: 'mosshide', at: [620, 300], arena: 46 },
      { id: 'whisperweed', at: [470, 470], arena: 42 },
    ],
    camps: [
      { at: [520, 300], kind: 'thornling', n: 4, tier: 1 },
      { at: [660, 440], kind: 'thornling', n: 5, tier: 2 },
    ],
    sites: [
      { id: 'woodwarden', kind: 'camp', at: [560, 250], r: 30,
        name: 'THE WOODWARDEN’S FIRE' },
      { id: 'hollow-oak', kind: 'easteregg', at: [700, 500], r: 14,
        name: 'THE HOLLOW OAK', blurb: 'Something has been living in it.' },
    ],
  },

  // ═══════════════════════════════════════════════════ TIER 2 — the middle ══
  {
    id: 'sunkenstair',
    name: 'THE SUNKEN STAIR',
    blurb: 'A staircase the size of a valley, going down into the water.',
    // Tier 1, not 2: it is the central crossroads and sits CLOSER to home
    // than either marsh, so a higher tier here would put the second-hardest
    // early region on the shortest road out of the village.
    x: -160, z: 60, r: 300, feather: 180, tier: 1,
    palette: {
      sand: 0xc9bb8e, grass: 0x6f9b4e, grass2: 0x5b8440, dirt: 0x8a7550,
      rock: 0x8b8578, high: 0xd8ddd4, highAt: 150,
      slopeDirt: 0.28, slopeRock: 0.44, rockFromY: 60,
    },
    sky: { fogNear: 60, fogFar: 460 },
    /**
     * Terraced on purpose: the region IS a staircase, so the height function
     * quantises into steps and then softens the edges. The softening matters
     * for more than looks — a hard terrace is a wall you cannot walk up, and
     * this is a route to the middle of the map.
     */
    ground: (n, x, z) => {
      const base = 30 + n.fbm(x * 0.003, z * 0.003, 3) * 10;
      const tread = 26;
      const step = Math.floor(base / tread) * tread;
      return step + smoothstep(clamp((base % tread) / tread, 0, 1)) * tread;
    },
    bosses: [
      { id: 'grott', at: [-160, 0], arena: 48 },
      { id: 'skarn', at: [-60, 150], arena: 44 },
    ],
    camps: [{ at: [-240, 120], kind: 'stonewarden', n: 3, tier: 2 }],
    sites: [
      { id: 'stairfoot', kind: 'shrine', at: [-160, 190], r: 18,
        name: 'THE STAIRFOOT SHRINE' },
    ],
  },

  {
    id: 'quarry',
    name: 'THE GREAT QUARRY',
    blurb: 'Cut out of the world stone by stone, and never finished.',
    x: 640, z: -60, r: 300, feather: 170, tier: 2,
    palette: {
      sand: 0xc4b48c, grass: 0x7a8a4e, grass2: 0x64743e, dirt: 0x9a8560,
      rock: 0x9a938a, high: 0xcfd4cc, highAt: 160,
      slopeDirt: 0.34, slopeRock: 0.40, rockFromY: 30,
    },
    sky: { fogNear: 70, fogFar: 520, fogColor: 0xcfc7ae },
    /**
     * Pits rather than hills: ridged noise inverted, so the ground is a plain
     * with bites taken out of it. Clamped at the bottom so a pit is a floor
     * you can fight on and not a funnel you slide into.
     */
    ground: (n, x, z) => {
      const plain = 44 + n.fbm(x * 0.0035, z * 0.0035, 3) * 6;
      const pit = Math.max(0, n.ridged(x * 0.0052 + 7, z * 0.0052 - 3, 3) - 0.42);
      return plain - Math.min(30, pit * 74);
    },
    bosses: [
      { id: 'quarryhand', at: [640, -120], arena: 50 },
      { id: 'glassback', at: [760, 40], arena: 44 },
    ],
    camps: [
      { at: [560, -30], kind: 'stonewarden', n: 4, tier: 2 },
      { at: [700, -160], kind: 'stonewarden', n: 4, tier: 3 },
    ],
    sites: [
      { id: 'cutters', kind: 'village', at: [700, -20], r: 44,
        name: 'CUTTER’S REST', blurb: 'They still work it. Nobody knows why.' },
    ],
  },

  {
    id: 'gravewater',
    name: 'GRAVEWATER',
    blurb: 'They buried them in the shallows. The shallows gave them back.',
    x: -700, z: -260, r: 300, feather: 180, tier: 3,
    // Also a drowned region — they buried them in the shallows.
    amphibious: true,
    palette: {
      sand: 0x8a8a72, grass: 0x4f6355, grass2: 0x3e5144, dirt: 0x54503f,
      rock: 0x5f6367, high: 0x8d939a, highAt: 130,
      slopeDirt: 0.24, slopeRock: 0.38, rockFromY: 40,
    },
    sky: {
      fogNear: 24, fogFar: 240, fogColor: 0x5a6a68, skyTop: 0x4a5b60,
      skyMid: 0x7d9096, cloudCount: 4, leaves: false,
      sunIntensity: 0.42, ambient: 0x495b60,
    },
    ground: (n, x, z) => 5.2 + n.fbm(x * 0.005, z * 0.005, 4) * 4
      + Math.max(0, n.fbm(x * 0.017, z * 0.017, 2)) * 6,
    bosses: [
      { id: 'gravewater', at: [-700, -320], arena: 52 },
      { id: 'okka', at: [-560, -200], arena: 46 },
      { id: 'lanternbearer', at: [-820, -180], arena: 44 },
    ],
    camps: [
      { at: [-640, -260], kind: 'drowned', n: 5, tier: 3 },
      { at: [-780, -330], kind: 'drowned', n: 5, tier: 3 },
    ],
    sites: [
      { id: 'gravekeeper', kind: 'camp', at: [-620, -160], r: 26,
        name: 'THE GRAVEKEEPER’S LANTERN' },
    ],
  },

  // ══════════════════════════════════════════════════ TIER 3 — the heights ══
  {
    id: 'choircliffs',
    name: 'THE CHOIR CLIFFS',
    blurb: 'The wind comes through the holes in the rock and sings.',
    x: 180, z: -560, r: 300, feather: 190, tier: 3,
    palette: {
      sand: 0xcdc3a2, grass: 0x6f8a5e, grass2: 0x5a7349, dirt: 0x8a7d5e,
      rock: 0x8f8a80, high: 0xeef2f6, highAt: 180,
      slopeDirt: 0.30, slopeRock: 0.44, rockFromY: 110,
    },
    sky: { fogNear: 90, fogFar: 700, skyTop: 0x2569b8, cloudCount: 30 },
    /**
     * Ridges you can WALK, which the first version was not.
     *
     * Amplitude 130 at frequency 0.0042 gives a gradient of about 3.4 per
     * unit — a slope of 1.1 on the controller's 0..1 scale, against a climb
     * limit of 0.46. Measured, one of its own shrines sat on 0.69 and no
     * gentler ground existed within three hundred units: the region was a
     * wall pretending to be a place. Wider, lower ridges keep 90 units of
     * relief and a skyline, at a gradient the frog can actually take.
     */
    ground: (n, x, z) => 62 + n.ridged(x * 0.0022 - 11, z * 0.0022 + 5, 4) * 90,
    bosses: [
      { id: 'nix', at: [180, -620], arena: 46 },
      { id: 'twincroaks', at: [60, -470], arena: 50 },
    ],
    camps: [{ at: [260, -500], kind: 'windrider', n: 4, tier: 3 }],
    sites: [
      { id: 'choirhold', kind: 'shrine', at: [180, -470], r: 20,
        name: 'THE CHOIRHOLD' },
      { id: 'the-note', kind: 'easteregg', at: [300, -640], r: 12,
        name: 'THE LAST NOTE', blurb: 'Stand still and it finishes the song.' },
    ],
  },

  {
    id: 'spine',
    name: 'THE SPINE OF THE DEEP',
    blurb: 'A ridge of vertebrae, and it is not a metaphor.',
    x: -220, z: -740, r: 280, feather: 180, tier: 4,
    palette: {
      sand: 0xb8b2a0, grass: 0x5f6f52, grass2: 0x4d5c42, dirt: 0x6f6552,
      rock: 0x7d7a74, high: 0xf2f5f8, highAt: 200,
      slopeDirt: 0.28, slopeRock: 0.42, rockFromY: 120,
    },
    sky: { fogNear: 70, fogFar: 560, skyTop: 0x1f4f86, skyMid: 0x5a8fc0 },
    // Same correction as the Choir Cliffs: 150 at 0.0035 was a gradient of
    // 3.3, more than twice what can be climbed.
    ground: (n, x, z) => 84 + n.ridged(x * 0.0018 + 31, z * 0.0018 - 17, 4) * 110,
    bosses: [{ id: 'huldr', at: [-220, -800], arena: 50 }],
    camps: [{ at: [-160, -680], kind: 'bonepicker', n: 4, tier: 4 }],
    sites: [
      { id: 'vertebrae', kind: 'ruin', at: [-300, -700], r: 28,
        name: 'THE SEVENTH VERTEBRA' },
    ],
  },

  {
    id: 'emberwaste',
    name: 'THE EMBERWASTE',
    blurb: 'It burned a long time ago and has not finished.',
    x: 780, z: -520, r: 300, feather: 180, tier: 4,
    palette: {
      sand: 0x8f6a4a, grass: 0x6a4a32, grass2: 0x543a26, dirt: 0x5a3a24,
      rock: 0x4a3a34, high: 0x8a7a72, highAt: 170,
      slopeDirt: 0.32, slopeRock: 0.42, rockFromY: 50,
    },
    sky: {
      fogNear: 40, fogFar: 380, fogColor: 0x6a4432, skyTop: 0x5e2a1e,
      skyMid: 0xa8583a, skyBottom: 0xd8916a, cloudCount: 6, leaves: false,
      sunColor: 0xffc08a, sunIntensity: 0.85, ambient: 0x6a3a2a,
    },
    ground: (n, x, z) => 52 + n.fbm(x * 0.004, z * 0.004, 4) * 26
      + Math.max(0, n.ridged(x * 0.008 + 3, z * 0.008 + 9, 3) - 0.5) * 90,
    bosses: [
      { id: 'varn', at: [780, -580], arena: 46 },
      { id: 'volkh', at: [880, -430], arena: 50 },
    ],
    camps: [
      { at: [700, -480], kind: 'emberling', n: 5, tier: 4 },
      { at: [860, -600], kind: 'emberling', n: 5, tier: 4 },
    ],
    sites: [
      { id: 'ashfall', kind: 'camp', at: [700, -560], r: 26,
        name: 'THE ASHFALL CAMP' },
    ],
  },

  // ═══════════════════════════════════════════════════ TIER 4/5 — the end ══
  {
    id: 'palewood',
    name: 'THE PALEWOOD',
    blurb: 'Every tree the same colour as fog. So is everything else.',
    // Pushed out to 1221 from home. At its first position, 898 out, a tier-4
    // region sat nearer the village than both tier-3s — the frontier has to
    // get worse as you leave, not in patches.
    x: -1040, z: -120, r: 260, feather: 170, tier: 4,
    palette: {
      sand: 0xd0cfc6, grass: 0x8f9a8c, grass2: 0x7c887a, dirt: 0x8a8a7e,
      rock: 0x9a9a92, high: 0xe8ece8, highAt: 140,
      slopeDirt: 0.26, slopeRock: 0.44, rockFromY: 90,
    },
    sky: {
      fogNear: 14, fogFar: 150, fogColor: 0xc9cec7, skyTop: 0xa8b0a8,
      skyMid: 0xc4cbc2, skyBottom: 0xdfe4de, cloudCount: 0,
      sunIntensity: 0.4, ambient: 0x9aa39a, leafCount: 180,
    },
    ground: (n, x, z) => 26 + n.fbm(x * 0.004, z * 0.004, 4) * 14,
    bosses: [{ id: 'palecroak', at: [-1040, -180], arena: 46 }],
    camps: [{ at: [-1100, -60], kind: 'palething', n: 4, tier: 4 }],
    sites: [
      { id: 'white-door', kind: 'easteregg', at: [-980, -30], r: 12,
        name: 'THE WHITE DOOR', blurb: 'It is a door. It is not attached to anything.' },
    ],
  },

  {
    id: 'hollowcity',
    name: 'THE HOLLOW CITY',
    blurb: 'It held a million frogs. The walls are still up.',
    x: 300, z: -960, r: 300, feather: 170, tier: 5,
    palette: {
      sand: 0xa8a08c, grass: 0x5a6350, grass2: 0x49523f, dirt: 0x6a6252,
      rock: 0x74706a, high: 0xb8bcb6, highAt: 200,
      slopeDirt: 0.30, slopeRock: 0.46, rockFromY: 70,
    },
    sky: {
      fogNear: 50, fogFar: 420, fogColor: 0x6a6f78, skyTop: 0x3a4450,
      skyMid: 0x6f7a86, cloudCount: 8, sunIntensity: 0.55,
    },
    ground: (n, x, z) => 46 + n.fbm(x * 0.0032, z * 0.0032, 3) * 12,
    bosses: [
      { id: 'hollowking', at: [300, -1020], arena: 56 },
      { id: 'stonewalks', at: [200, -880], arena: 50 },
    ],
    camps: [
      { at: [380, -900], kind: 'cityhusk', n: 6, tier: 5 },
      { at: [240, -1000], kind: 'cityhusk', n: 6, tier: 5 },
    ],
    sites: [
      { id: 'lastgate', kind: 'ruin', at: [300, -860], r: 40,
        name: 'THE LAST GATE' },
    ],
  },

  {
    id: 'frostmarch',
    name: 'THE FROSTMARCH',
    blurb: 'The cold got here first and never left.',
    x: -560, z: -1000, r: 280, feather: 170, tier: 5,
    palette: {
      sand: 0xd8dde2, grass: 0x8fa08f, grass2: 0x7b8c7b, dirt: 0x7a7f84,
      rock: 0x8a9099, high: 0xf6f9fc, highAt: 110,
      slopeDirt: 0.28, slopeRock: 0.42, rockFromY: 90,
    },
    sky: {
      fogNear: 40, fogFar: 340, fogColor: 0xc4d2de, skyTop: 0x5f86b0,
      skyMid: 0xa8c6de, skyBottom: 0xdfeaf2, sunColor: 0xdfeaff,
      sunIntensity: 0.7, ambient: 0x8fa4bc, leaves: false,
    },
    ground: (n, x, z) => 70 + n.fbm(x * 0.0036, z * 0.0036, 4) * 40,
    bosses: [{ id: 'brack', at: [-560, -1060], arena: 46 }],
    camps: [{ at: [-620, -940], kind: 'frostling', n: 5, tier: 5 }],
    sites: [
      { id: 'coldhearth', kind: 'camp', at: [-480, -940], r: 26,
        name: 'THE COLD HEARTH' },
    ],
  },

  {
    id: 'ashenthrone',
    name: 'THE ASHEN THRONE',
    blurb: 'Where the First Croak sat down and never stood up.',
    // Pulled in off the rim. At z -1300 with the arena behind it at -1360,
    // the final fight was on the 0.44 slope of the mountain wall that closes
    // the map — the last boss cannot be fought on a cliff.
    x: 0, z: -1210, r: 260, feather: 150, tier: 5,
    palette: {
      sand: 0x6a6258, grass: 0x4a4a44, grass2: 0x3c3c37, dirt: 0x4a423a,
      rock: 0x55524c, high: 0x8f8a84, highAt: 220,
      slopeDirt: 0.30, slopeRock: 0.44, rockFromY: 40,
    },
    sky: {
      fogNear: 30, fogFar: 300, fogColor: 0x3a3a42, skyTop: 0x1a1a22,
      skyMid: 0x40404e, skyBottom: 0x6a6072, cloudCount: 0, leaves: false,
      sunColor: 0xffd0a0, sunIntensity: 0.5, ambient: 0x3a3a48,
    },
    ground: (n, x, z) => 96 + n.fbm(x * 0.004, z * 0.004, 3) * 18,
    bosses: [
      { id: 'zehl', at: [0, -1150], arena: 54 },
      { id: 'frogath', at: [0, -1270], arena: 70, final: true },
    ],
    camps: [],
    sites: [
      { id: 'thronegate', kind: 'ruin', at: [0, -1090], r: 34,
        name: 'THE THRONE GATE' },
    ],
  },
];

export const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

/**
 * Every region's weight at a point, and the blended ground height.
 *
 * The weights are a smooth falloff per region, normalised. Normalising is
 * what makes the seams disappear: at any point the weights sum to one, so no
 * gap between regions can leave the ground at zero and no overlap can stack
 * two regions' heights on top of each other.
 *
 * Outside every region's reach — the rim of the map — the nearest region
 * still wins by falling back to it, which keeps the height function total.
 * A height function with a hole in it is a hole in the world.
 */
export function regionWeights(x, z, out) {
  out.length = 0;
  let total = 0;
  for (let i = 0; i < REGIONS.length; i++) {
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
    const w = 1 / (u * u * u * u);
    out.push({ region: R, w });
    total += w;
  }
  return total;
}

/** The region a point belongs to — the heaviest one. Never null. */
export function regionAt(x, z, scratch) {
  const list = scratch || [];
  regionWeights(x, z, list);
  let best = list[0];
  for (const e of list) if (e.w > best.w) best = e;
  return best.region;
}
