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

import { CFG } from './config.js?v=v65';
import { clamp, smoothstep } from './util.js?v=v65';

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
    features: [
      ['Laying the Lotus Arena', (w) => w._buildArena()],
      ['Building the temple village', (w) => w._buildVillage()],
      ['Hanging the Sky Shrine', (w) => w._buildShrine()],
      ['Planting the bamboo grove', (w) => w._buildBambooGrove()],
      ['Stacking the rock spires', (w) => w._buildSpires()],
      ['Stringing the rope bridges', (w) => w._buildBridges()],
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
     * backwards. The rim begins to rise at 0.84 of the half-size, so the
     * radius sits just inside that — the limit engages exactly as the ground
     * turns into the outer mountain and nowhere else.
     */
    climbLimitY: Infinity,
    climbLimitRadius: CFG.world.size * 0.5 * 0.80,
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
    flats: [
      { x: 0, z: 0, r: 30, f: 34, h: 1.6 },        // the shallows at the centre
      { x: -104, z: 88, r: 22, f: 26, h: 3.4 },    // a mud island
      { x: 112, z: -74, r: 20, f: 24, h: 3.0 },    // another
      { x: 74, z: 108, r: 16, f: 20, h: 2.8 },
    ],
    basins: [
      { x: -58, z: -46, r: 40, f: 30, h: 0.2 },    // open water
      { x: 96, z: 52, r: 34, f: 26, h: 0.4 },
    ],

    height(w, x, z) {
      const S = CFG.world.size;
      const d = Math.hypot(x, z) / (S * 0.5);

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

      // The rim, so nobody wanders off the heightfield.
      const edge = smoothstep(clamp((d - 0.84) / 0.16, 0, 1));
      h += edge * 150;
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
