/**
 * The arena maps.
 *
 * A map is DATA: a seed, a height function, a palette, an atmosphere preset
 * and a list of the World builders that lay out its content. World stays the
 * engine — batches, terrain mesh, water, and the solid/deco/roof/lantern
 * toolkit every map is built out of — so adding a map never means touching
 * the renderer or the physics.
 *
 * Everything derives from `seed`, so every client generates a byte-identical
 * map from the id alone. That is the whole reason the id is all the network
 * ever has to agree on.
 *
 * The water line is deliberately NOT per-map: the swimming code reads
 * CFG.world.waterLevel directly, so a map that wants water shapes its terrain
 * around that height instead of moving it.
 */

import { CFG } from './config.js?v=v145';
import { clamp, smoothstep } from './util.js?v=v145';

export const MAPS = [
  {
    id: 'valley',
    name: 'LOTUS VALLEY',
    blurb: 'Open ground, a temple village and mountains to grapple.',
    seed: 1337,
    /** Steep terrain above this cannot be walked up. Here: the snow line. */
    climbLimitY: CFG.world.snowLine,
    palette: {
      sand: 0xd6c48a,
      grass: 0x74b04a,
      grass2: 0x5f9a3c,
      dirt: 0x8a7550,
      rock: 0x6f6a63,
      high: 0xeef2f6,          // snow
      highAt: CFG.world.snowLine,
      slopeDirt: 0.28,
      slopeRock: 0.46,
      rockFromY: 52,
    },
    atmosphere: {},            // the bright default sky
    /**
     * Order matters, and it is one rule: BUILD everything, then PLANT.
     *
     * Structures declare the ground they stand on (World._clear) and the
     * planting steps read that. A planting step that runs early cannot know
     * about a structure that comes later, and the ground it was told to leave
     * alone is ground that did not exist yet.
     *
     * The bamboo grove is why this is written down. It both builds a shrine
     * and plants 190 stalks, and it used to run before the bridges — so the
     * stair up to the grove's own bridge came up through a bamboo thicket
     * that had been sown across it, and stopped you ten steps from the top.
     */
    features: [
      ['Laying the Lotus Arena', (w) => w._buildArena()],
      ['Building the temple village', (w) => w._buildVillage()],
      ['Hanging the Sky Shrine', (w) => w._buildShrine()],
      ['Stacking the rock spires', (w) => w._buildSpires()],
      ['Stringing the rope bridges', (w) => w._buildBridges()],
      ['Planting the bamboo grove', (w) => w._buildBambooGrove()],
      ['Growing the forests', (w) => w._buildForests()],
      ['Scattering stones', (w) => { w._buildRocks(); w._buildLanterns(); }],
    ],
    flats: [
      { x: 0, z: 0, r: 40, f: 26, h: 4.0 },        // Lotus Arena (centre)
      { x: 0, z: -142, r: 27, f: 30, h: 62.0 },    // Sky Shrine plateau
      { x: -34, z: 132, r: 46, f: 30, h: 11.0 },   // Temple village
      { x: 128, z: 26, r: 42, f: 30, h: 8.0 },     // Bamboo grove
      { x: -132, z: -44, r: 17, f: 18, h: 40.0 },  // West mesa top
      { x: -96, z: -104, r: 13, f: 15, h: 27.0 },  // Stepping mesa
      { x: 86, z: -96, r: 20, f: 22, h: 24.0 },    // East cliff terrace
    ],
    basins: [{ x: -66, z: 70, r: 32, f: 22, h: -3.0 }],

    height(w, x, z) {
      const S = CFG.world.size;
      const dCenter = Math.hypot(x, z) / (S * 0.5);
      let h = w.noise.fbm(x * 0.0062, z * 0.0062, 5) * 15 + 8;
      h += w.noise2.fbm(x * 0.021, z * 0.021, 3) * 3.2;
      const rim = smoothstep(clamp((dCenter - 0.40) / 0.42, 0, 1));
      const north = smoothstep(clamp((-z - 60) / 110, 0, 1));
      const mountainMask = clamp(rim * 0.85 + north * 0.75, 0, 1.35);
      const ridge = w.noise.ridged(x * 0.0048 + 11, z * 0.0048 - 7, 4);
      h += ridge * 96 * mountainMask;
      const edge = smoothstep(clamp((dCenter - 0.86) / 0.14, 0, 1));
      h += edge * 150;
      return h;
    },
  },

  {
    id: 'mire',
    name: 'THE HANGING MIRE',
    blurb: 'A drowned valley under a village that never touches the ground.',
    seed: 8821,
    /**
     * Every spire in the Mire can be climbed. Only the wall around the edge
     * of the world refuses you.
     *
     * No height limit at all: the towers are meant to be scaled, and stopping
     * you partway up one on a map whose whole point is going upward would be
     * backwards. The rim begins to rise at 0.88 of the half-size, so the
     * radius sits just inside that — the limit engages exactly as the ground
     * turns into the outer mountain and nowhere else.
     */
    climbLimitY: Infinity,
    climbLimitRadius: CFG.world.size * 0.5 * 0.86,
    /**
     * SQUARE, like the world it sits in.
     *
     * The Mire used to be a disc of radius 168 dropped into a 420-unit
     * square, which threw away the four corners — about a third of the map
     * — and is most of why it read as smaller than the valley beside it.
     * The valley's mountains run out to (186, 186); this now does too.
     */
    climbLimitShape: 'square',
    palette: {
      sand: 0x6a6a52,          // wet silt at the waterline
      grass: 0x4a6b3a,         // sodden moss
      grass2: 0x3d5c33,
      dirt: 0x4a4438,
      rock: 0x53565c,          // cold wet stone
      high: 0x6a6f77,          // no snow — the spires just go greyer
      highAt: 46,
      slopeDirt: 0.22,
      slopeRock: 0.34,         // rock takes over early: this place is stone
      rockFromY: 20,
    },
    /**
     * Cold, thick and low. The only warm light in the map comes from the
     * lanterns under the huts, which is what makes them read as inhabited.
     */
    atmosphere: {
      fogNear: 16,
      fogFar: 190,
      fogColor: 0x5d6c70,
      skyTop: 0x64757c,
      skyMid: 0x8fa1a4,
      skyBottom: 0xc3ccc6,
      cloudCount: 0,
      leaves: false,
      sunColor: 0xcfe0dd,
      sunIntensity: 0.55,
      ambient: 0x53656b,
      ambientIntensity: 0.85,
    },
    features: [
      ['Drowning the valley', (w) => w._buildMireGround()],
      ['Raising the spires', (w) => w._buildMireSpires()],
      ['Hanging the village', (w) => w._buildMireVillage()],
      ['Stringing the walkways', (w) => w._buildMireWalks()],
      ['Planting the reeds', (w) => w._buildMireReeds()],
      ['Lighting the lanterns', (w) => w._buildMireLights()],
    ],
    /**
     * The mud islands — and the four corner ones are the point of the
     * square rim. Land out at (±150, ±150) was previously inside the
     * heightfield but behind an unclimbable circular edge, so the map had
     * four quadrants of nothing anybody could reach.
     */
    flats: [
      { x: 0, z: 0, r: 30, f: 34, h: 1.6 },        // the shallows at the centre
      { x: -104, z: 88, r: 22, f: 26, h: 3.4 },    // a mud island
      { x: 112, z: -74, r: 20, f: 24, h: 3.0 },    // another
      { x: 74, z: 108, r: 16, f: 20, h: 2.8 },
      { x: -148, z: -142, r: 24, f: 26, h: 3.6 },  // the four corners
      { x: 152, z: 146, r: 22, f: 24, h: 3.2 },
      { x: -156, z: 138, r: 18, f: 22, h: 2.9 },
      { x: 144, z: -152, r: 20, f: 24, h: 3.3 },
      // And the four edges. Kept inside 160 because a hamlet is hung in a
      // ring up to 14 units out from its island and the rim starts at 185.
      { x: -12, z: -156, r: 17, f: 20, h: 2.8 },
      { x: 158, z: 18, r: 16, f: 20, h: 3.0 },
      { x: 24, z: 160, r: 15, f: 18, h: 2.7 },
      { x: -160, z: -6, r: 16, f: 20, h: 3.1 },
    ],
    basins: [
      { x: -58, z: -46, r: 40, f: 30, h: 0.2 },    // open water
      { x: 96, z: 52, r: 34, f: 26, h: 0.4 },
      { x: -130, z: 4, r: 30, f: 24, h: 0.3 },
      { x: 40, z: -128, r: 32, f: 26, h: 0.2 },
    ],

    height(w, x, z) {
      const S = CFG.world.size;
      /**
       * CHEBYSHEV, not hypot — the ruler that makes this map square.
       *
       * `max(|x|, |z|)` raises the rim as four straight walls rather than
       * as a circle, which is what lets the Mire use the corners of the
       * square world the way the valley's mountains already do. It threw
       * away about a third of its own map by measuring a circle, and that
       * is most of why it felt smaller than the valley standing next to it.
       *
       * `climbLimitShape: 'square'` above MUST match this. A circular climb
       * limit against a square rim is an invisible wall on both diagonals —
       * the exact trap written up in js/collision.js.
       */
      const d = Math.max(Math.abs(x), Math.abs(z)) / (S * 0.5);

      // A drowned flat. Most of the map sits within a stride of the
      // waterline, so wading is the default and dry land is a choice.
      let h = 1.5 + w.noise.fbm(x * 0.0085, z * 0.0085, 4) * 2.4;
      // Silt banks and reed islands pushed up out of it.
      h += Math.max(0, w.noise2.fbm(x * 0.019, z * 0.019, 3)) * 3.4;

      // SPIRES. Ridged noise thresholded, so what survives is isolated towers
      // rather than the connected ranges the valley uses — the shapes in the
      // reference are columns standing in water, not a mountainside.
      //
      // These numbers are picked to keep the towers WALKABLE, which is a
      // tighter constraint than it sounds. A flank's gradient is about
      // amp * expo / flank-length, the flank length scales with 1/frequency,
      // and moving at full speed you can only rise stepHeight (0.65) per
      // sub-step of 0.258 — so anything steeper than a gradient of ~2.5 stops
      // you dead no matter how the climb limits are set. The original
      // 0.0125/1.7/72 gave a gradient near 11: a forest of unclimbable
      // needles, which lifting the climb limit did nothing for.
      //
      // Widening the towers and straightening their profile puts all of the
      // raised ground inside the walkable band — the valley, for comparison,
      // measures 94%. The exponent is 1 on purpose: that makes each tower a
      // straight cone whose flank has the SAME gradient the whole way up, so
      // there is no band near the summit that quietly stops you. Keep this in
      // mind before retuning: frequency sets how MANY towers there are, and
      // amp/frequency sets whether you can get up them.
      const r = w.noise.ridged(x * 0.0062 + 41, z * 0.0062 - 19, 3);
      const tower = Math.max(0, r - 0.40) / 0.60;
      h += tower * 54;

      // The rim, so nobody wanders off the heightfield. It starts where the
      // valley's does, so the two maps are the same size to the unit.
      const edge = smoothstep(clamp((d - 0.88) / 0.12, 0, 1));
      h += edge * 150;
      return h;
    },
  },
  /**
   * ═══ SHIZUKA WARD ══════════════════════════════════════════════════════
   *
   * A city everybody left this morning.
   *
   * ── the one rule this map is built on ─────────────────────────────────
   * Nothing is broken. No rubble, no fire, no weeds through the tarmac. The
   * lamps are lit, the vending machines are humming, there are cars parked
   * neatly at the kerb and a lit window nine floors up. An empty city is
   * only eerie while it still works: add rubble and "where did everybody
   * go" becomes "something happened here", which is a smaller question.
   *
   * ── it is FLAT, and that is the whole terrain ─────────────────────────
   * The other two maps are landscapes with things on them. This one is a
   * road grid, and a road grid has to agree with itself to the centimetre —
   * a kerb that follows a hill is a kerb you trip over, and lane markings
   * painted on a slope read as a mistake. So `height` returns one number
   * across the entire ward and every builder measures off `CITY.ground`.
   *
   * The only relief is the rim, which is the same wall every map has to
   * stop you walking off the heightfield. Here it is read as the rest of
   * the city, too far to reach.
   */
  {
    id: 'city',
    name: 'SHIZUKA WARD',
    blurb: 'A Japanese city with the people taken out. Rooftops, skyways '
      + 'and a lot of parked cars.',
    seed: 4417,
    /**
     * Nothing to climb but the buildings, and those have stairs. The limit
     * only ever engages on the rim.
     */
    /**
     * NOTHING is off limits any more, because there is nothing to climb.
     *
     * The ward used to be ringed by a hundred and seventy units of
     * mountain, and the limit existed to stop you walking up it. It is a
     * LAKE now: the ground runs flat to the waterfront and then shelves
     * away under the surface. A beach is walkable by design and open water
     * is its own boundary, so a climb rule here would only be a rule about
     * something that is not there.
     */
    climbLimitY: Infinity,
    /**
     * The lake is wider than the heightfield. The bridge crosses it to an
     * island well past the terrain's edge, so the water has to reach the
     * horizon or the map ends in a visible seam of nothing.
     */
    waterSize: 1600,
    /**
     * The ground IS the road. Terrain is asphalt everywhere, and a block is
     * simply a place where a pavement was laid on top of it — so the grid
     * can never disagree with itself.
     */
    palette: {
      // `sand` is the band below the waterline, which on this map is the
      // lake bed and the wet shingle at the foot of the beach.
      sand: 0x7a7565,
      grass: 0x3a3d42,
      grass2: 0x34373c,
      dirt: 0x3d4045,
      rock: 0x4a4d53,
      high: 0x5a5e66,
      highAt: 60,
      slopeDirt: 0.9,
      slopeRock: 0.95,
      rockFromY: 40,
    },
    /**
     * Late afternoon going blue — the light in the reference photograph.
     *
     * `fogFar` had to go a long way out when the mountain became a lake.
     * At 300 it was doing a job — hiding the rim at the end of an avenue —
     * and the thing at the end of an avenue now is the bridge and the
     * island beyond it, which are the point. 620 keeps the haze on the far
     * shore without erasing it.
     */
    atmosphere: {
      fogNear: 60,
      fogFar: 620,
      fogColor: 0x6a7a92,
      skyTop: 0x1f3a63,
      skyMid: 0x4a6a96,
      skyBottom: 0x9fb4cc,
      cloudCount: 22,
      leaves: false,
      sunColor: 0xffe2c0,
      sunIntensity: 1.05,
      ambient: 0x8fa6c4,
      ambientIntensity: 0.78,
    },
    groundY: 6,
    features: [
      ['Pouring the streets', (w) => w._buildCity()],
      ['Painting the lanes', (w) => w._buildCityStreets()],
      ['Parking the cars', (w) => w._buildCityCars()],
      ['Hanging the skyways', (w) => w._buildCitySkyways()],
      ['Walling the waterfront', (w) => w._buildCityShore()],
      ['Closing the bridge', (w) => w._buildCityBridge()],
      ['Something in the lake', (w) => w._buildCityShark()],
    ],
    flats: [],
    basins: [],

    height(w, x, z) {
      /**
       * CHEBYSHEV, `max(|x|, |z|)` — a square ward with a square shoreline.
       * See the note on the Mire's height function: cutting a square world
       * with a circle throws away its four corners.
       */
      const d = Math.max(Math.abs(x), Math.abs(z));
      // Dead flat across the whole ward. See the note above: every kerb and
      // every painted line in it is placed against this one number.
      let h = 6;

      /**
       * AND THEN THE LAKE.
       *
       * This used to be a hundred and seventy units of mountain. A wall is
       * an honest boundary but it is also a full stop — it says the world
       * ends here — whereas water says the world carries on and you cannot
       * walk it. The ward is an island now, with a bridge across to another
       * one you can see from the waterfront.
       *
       * The shelf runs 178 -> 218 and drops 26, which puts the actual
       * water's edge at about 187: eleven units of beach past the last kerb
       * at 176, enough to stand on and look out from. A first pass ran the
       * same drop over 28 units starting at 172 and left two and a half —
       * a kerb, then immediately the lake, which is a quay rather than a
       * shore and gave the waterfront nowhere to be.
       *
       * The steepest part is a gradient of 0.98 against a walk limit of
       * 1.38, so wading back out never leaves anyone stuck against their
       * own shoreline.
       */
      const t = smoothstep(clamp((d - 178) / 40, 0, 1));
      h -= t * 26;
      // A little relief on the lake bed so the shallows are not a mirror.
      if (t > 0) h += w.noise.fbm(x * 0.013, z * 0.013, 2) * 3.2 * t;
      return h;
    },
  },
];

export const DEFAULT_MAP = MAPS[0].id;

export function findMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

export function mapName(id) {
  const m = MAPS.find((x) => x.id === id);
  return m ? m.name : '—';
}
