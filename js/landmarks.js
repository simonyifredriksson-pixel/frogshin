/**
 * THE THINGS YOU CAN SEE FROM THE NEXT REGION.
 *
 * One enormous structure per region, and its only job is to answer the
 * question "where am I?" from a mile away. A palace on the skyline, a volcano
 * smoking, a tree with a village in it, a door four storeys tall attached to
 * nothing — these are what turn a big map into a place you can navigate by
 * memory instead of by opening the map every thirty seconds.
 *
 * ── scale, and why it is the whole point ──────────────────────────────────
 * Nothing in here is smaller than sixty units and most of it is two or three
 * hundred. That is deliberate and it is the difference between a landmark and
 * a prop: fog on the clearer regions reaches seven hundred units, so a
 * structure has to be tall enough to still subtend something at that range.
 *
 * ── what they are made of ─────────────────────────────────────────────────
 * Shared geometry and shared materials, like everything else in the game —
 * twenty-four landmarks between them cost about four hundred meshes, and only
 * the two or three within sight are ever drawn.
 *
 * ── colliders ─────────────────────────────────────────────────────────────
 * A builder returns its solids separately rather than deriving them from the
 * meshes. Most of a landmark should NOT be solid: a two-hundred-unit statue
 * wants a collider around its plinth and its legs, not a box the size of its
 * silhouette, or the region behind it becomes unreachable.
 */

import * as THREE from '../lib/three.module.js?v=v86';
import { mulberry32 } from './util.js?v=v86';

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  taper: new THREE.CylinderGeometry(0.55, 1, 1, 9),
  cone: new THREE.ConeGeometry(1, 1, 9),
  sphere: new THREE.SphereGeometry(1, 12, 9),
  low: new THREE.SphereGeometry(1, 8, 6),
  disc: new THREE.CylinderGeometry(1, 1, 1, 18),
  torus: new THREE.TorusGeometry(1, 0.1, 6, 18),
  octa: new THREE.OctahedronGeometry(1, 0),
};

let M = null;
function mats() {
  if (M) return M;
  const L = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0x000000 });
  const B = (c) => new THREE.MeshBasicMaterial({ color: c });
  M = {
    stone: L(0x8b8578), stoneDark: L(0x5f5b52), stonePale: L(0xc4bfae),
    marble: L(0xd8d4c6), marbleDark: L(0x9a968a),
    wood: L(0x6b4a2a), woodDark: L(0x452e19), bark: L(0x574029),
    thatch: L(0xb99a5a), tile: L(0x8a2f28), tileDark: L(0x5c1f1a),
    iron: L(0x565f6b), ironDark: L(0x353b45), gold: L(0xc9a227),
    bone: L(0xe0dcd0), boneDark: L(0xa8a496),
    leaf: L(0x2f5f27), leafPale: L(0x8fc44a),
    ice: L(0xcfe6f4), iceDeep: L(0x8fb8d8),
    sand: L(0xd8c49a), sandDark: L(0xa8906a),
    obsidian: L(0x2a2226), ash: L(0x4a423c),
    dead: L(0x6a6258), pale: L(0xe8ece8),
    // Lit things: their own light source, so they read at dusk and in fog.
    lamp: B(0xffd76b), ember: B(0xff7a3c), glow: B(0x8fe8ff),
    prism: B(0xc0e8ff), water: L(0x3f8fb8, 0x0d3348),
  };
  return M;
}

/** One part. Returns the mesh so a caller can nudge it. */
function put(g, geo, mat, sx, sy, sz, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x || 0, y || 0, z || 0);
  m.rotation.set(rx || 0, ry || 0, rz || 0);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/**
 * Every landmark, by the `kind` its region declares.
 *
 * A builder gets the group to fill, a seeded RNG so the same landmark is the
 * same shape on every machine, and a `solid` callback to register colliders
 * in the group's own local space.
 */
const BUILD = {
  // ─────────────────────────────────────────────────────── the Lilyreach ──
  greatlily(g, rnd, solid) {
    const P = mats();
    // One vast pad, floating, with a village's worth of huts on it.
    put(g, G.disc, P.leafPale, 76, 1.6, 76, 0, 2, 0);
    put(g, G.disc, P.leaf, 70, 1.2, 70, 0, 3.2, 0);
    solid(76, 2, 76, 0, 1.5, 0, 'deck');
    // The stem, going down into the water, and the flower beside it.
    put(g, G.cyl, P.leaf, 3, 40, 3, 0, -18, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      put(g, G.cone, P.marble, 9, 26, 9, Math.cos(a) * 26 + 40, 16,
        Math.sin(a) * 26 + 40, 0.3 * Math.cos(a), 0, 0.3 * Math.sin(a));
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const d = 34 + rnd() * 22;
      put(g, G.box, P.wood, 7, 5, 7, Math.cos(a) * d, 6.5, Math.sin(a) * d, 0, a);
      put(g, G.cone, P.thatch, 6.5, 6, 6.5, Math.cos(a) * d, 12, Math.sin(a) * d, 0, a);
    }
  },

  // ─────────────────────────────────────────────────────── the Harrowmead ──
  mill(g, rnd, solid) {
    const P = mats();
    put(g, G.taper, P.stonePale, 13, 62, 13, 0, 31, 0);
    put(g, G.cone, P.tile, 15, 16, 15, 0, 68, 0);
    solid(11, 31, 11, 0, 31, 0, 'wall');
    // Six sails on an axle, and they turn — see `spin` below.
    const hub = new THREE.Group();
    hub.position.set(0, 56, 14);
    g.add(hub);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const arm = new THREE.Group();
      arm.rotation.z = a;
      hub.add(arm);
      put(arm, G.box, P.wood, 1.6, 44, 1.2, 0, 22, 0);
      put(arm, G.box, P.thatch, 7, 30, 0.5, 4.5, 24, 1);
    }
    put(g, G.cyl, P.woodDark, 3, 6, 3, 0, 56, 12, Math.PI / 2);
    g.userData.spin = hub;
    // Marked on the hub itself too, so `Sites.flatten` leaves it as its own
    // group instead of merging the sails into the tower they turn in front of.
    hub.userData.spin = true;
  },

  // ────────────────────────────────────────────────────── the Whispermire ──
  deadtree(g, rnd, solid) {
    const P = mats();
    put(g, G.taper, P.dead, 11, 120, 11, 0, 60, 0);
    solid(9, 60, 9, 0, 60, 0, 'trunk');
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2;
      const y = 50 + rnd() * 60;
      const len = 24 + rnd() * 34;
      const b = put(g, G.cyl, P.dead, 2.6, len, 2.6,
        Math.cos(a) * len * 0.3, y, Math.sin(a) * len * 0.3);
      b.rotation.z = Math.cos(a) * 1.1;
      b.rotation.x = -Math.sin(a) * 1.1;
    }
    // Roots, out of the water.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = put(g, G.cyl, P.dead, 3, 30, 3, Math.cos(a) * 12, 4, Math.sin(a) * 12);
      r.rotation.z = Math.cos(a) * 0.9;
      r.rotation.x = -Math.sin(a) * 0.9;
    }
  },

  // ─────────────────────────────────────────────────────── Hollowroot Wood ──
  greattree(g, rnd, solid) {
    const P = mats();
    // A trunk you could put a street inside, and they have.
    put(g, G.taper, P.bark, 26, 150, 26, 0, 75, 0);
    solid(20, 75, 20, 0, 75, 0, 'trunk');
    // The doorway, and the windows going up it.
    put(g, G.box, P.woodDark, 9, 14, 3, 0, 7, 25);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2;
      const y = 24 + i * 13;
      put(g, G.box, P.lamp, 3, 3.4, 1.5, Math.cos(a) * 24, y, Math.sin(a) * 24, 0, a);
      put(g, G.box, P.wood, 7, 1.2, 5, Math.cos(a) * 26, y - 2.4, Math.sin(a) * 26, 0, a);
    }
    // Roots and canopy.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = put(g, G.cyl, P.bark, 6, 46, 6, Math.cos(a) * 22, 8, Math.sin(a) * 22);
      r.rotation.z = Math.cos(a) * 1.1;
      r.rotation.x = -Math.sin(a) * 1.1;
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rnd() * 0.4;
      const d = 30 + rnd() * 46;
      put(g, G.low, P.leaf, 40, 24, 40, Math.cos(a) * d, 132 + rnd() * 30,
        Math.sin(a) * d);
    }
    put(g, G.low, P.leaf, 58, 34, 58, 0, 150, 0);
  },

  // ─────────────────────────────────────────────────────── the Sunken Stair ──
  statue(g, rnd, solid) {
    const P = mats();
    // A king, kneeling, facing north (-Z).
    put(g, G.box, P.stoneDark, 30, 6, 30, 0, 3, 0);
    solid(30, 3, 30, 0, 3, 0, 'deck');
    // Thigh, shin and foot of the kneeling leg.
    put(g, G.box, P.stone, 9, 9, 26, -11, 10, -4, 0.2);
    put(g, G.box, P.stone, 9, 22, 9, 11, 17, -8);
    put(g, G.box, P.stone, 11, 5, 20, 11, 7, 2);
    solid(24, 12, 22, 0, 10, -4, 'wall');
    // Torso, arms, head, crown.
    put(g, G.box, P.stone, 24, 34, 15, 0, 38, -6);
    put(g, G.box, P.stone, 7, 30, 7, -16, 36, -2, 0.3);
    put(g, G.box, P.stone, 7, 26, 7, 16, 34, -6, -0.2);
    put(g, G.low, P.stone, 11, 12, 11, 0, 62, -6);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      put(g, G.cone, P.gold, 2.2, 8, 2.2, Math.cos(a) * 9, 72, Math.sin(a) * 9 - 6);
    }
    // The sword, point down, taking his weight.
    put(g, G.box, P.iron, 3, 46, 1.6, 0, 22, 12);
    put(g, G.box, P.gold, 9, 2.4, 3, 0, 45, 12);
  },

  // ─────────────────────────────────────────────────────── the Anurath Basin ──
  palace(g, rnd, solid) {
    const P = mats();
    // A terrace, a great hall, and five towers of decreasing height.
    put(g, G.box, P.marbleDark, 90, 8, 70, 0, 4, 0);
    solid(90, 4, 70, 0, 4, 0, 'deck');
    put(g, G.box, P.marble, 62, 34, 44, 0, 25, 0);
    solid(62, 17, 44, 0, 25, 0, 'wall');
    put(g, G.box, P.tile, 68, 6, 50, 0, 45, 0);
    const towers = [[0, -26, 120], [-40, 18, 92], [40, 18, 92],
      [-62, -12, 74], [62, -12, 74]];
    for (const [tx, tz, h] of towers) {
      put(g, G.cyl, P.marble, 11, h, 11, tx, h / 2, tz);
      put(g, G.cone, P.tile, 14, 24, 14, tx, h + 12, tz);
      put(g, G.low, P.gold, 3, 4, 3, tx, h + 26, tz);
      solid(11, h / 2, 11, tx, h / 2, tz, 'tower');
    }
    // Arches along the front, and water lapping at them.
    for (let i = -2; i <= 2; i++) {
      put(g, G.box, P.marble, 5, 26, 5, i * 15, 21, 24);
    }
    put(g, G.disc, P.water, 96, 1, 76, 0, 9, 0);
  },

  // ─────────────────────────────────────────────────────── the Great Quarry ──
  unfinished(g, rnd, solid) {
    const P = mats();
    // Carved to the waist out of the living rock, and stopped.
    put(g, G.box, P.stonePale, 44, 46, 40, 0, 23, 0);
    solid(44, 23, 40, 0, 23, 0, 'wall');
    put(g, G.box, P.stone, 34, 60, 28, 0, 74, 0);
    put(g, G.box, P.stone, 12, 44, 12, -22, 66, 0, 0, 0, 0.15);
    put(g, G.box, P.stone, 12, 30, 12, 22, 60, 0, 0, 0, -0.2);
    put(g, G.low, P.stone, 15, 17, 15, 0, 114, 0);
    // The half-cut side, still stepped from the chisels.
    for (let i = 0; i < 7; i++) {
      put(g, G.box, P.stonePale, 40 - i * 4, 6, 8, 0, 4 + i * 6, -22 + i * 2);
    }
    // Scaffolding nobody took down.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        put(g, G.cyl, P.wood, 1.2, 110, 1.2, sx * (26 + i * 5), 55, -14 + i * 6);
      }
      for (let i = 0; i < 8; i++) {
        put(g, G.box, P.wood, 34, 0.8, 1.6, sx * 40, 14 + i * 13, 0);
      }
    }
  },

  // ─────────────────────────────────────────────────────── the Glassfen ──
  waterfalltemple(g, rnd, solid) {
    const P = mats();
    // A cliff, a fall down it, and a temple front in behind the water.
    put(g, G.box, P.stoneDark, 90, 110, 26, 0, 55, -26);
    solid(90, 55, 26, 0, 55, -26, 'cliff');
    put(g, G.box, P.water, 34, 108, 3, 0, 54, -11);
    put(g, G.disc, P.water, 30, 2, 22, 0, 2, 4);
    // The facade, set back so the fall runs in front of it.
    put(g, G.box, P.marble, 34, 30, 8, 0, 15, -14);
    put(g, G.box, P.tile, 40, 4, 12, 0, 32, -14);
    for (let i = -2; i <= 2; i++) {
      put(g, G.cyl, P.marble, 3, 26, 3, i * 7, 13, -10);
    }
    put(g, G.box, P.stoneDark, 8, 14, 3, 0, 7, -7);
    put(g, G.low, P.glow, 2.4, 2.8, 2.4, 0, 18, -8);
  },

  // ─────────────────────────────────────────────────────── Gravewater ──
  lantern(g, rnd, solid) {
    const P = mats();
    // A stone tower with one enormous lamp in the top of it.
    put(g, G.taper, P.stoneDark, 14, 96, 14, 0, 48, 0);
    solid(11, 48, 11, 0, 48, 0, 'tower');
    for (let i = 0; i < 5; i++) {
      put(g, G.disc, P.stone, 15 - i, 2.4, 15 - i, 0, 20 + i * 18, 0);
    }
    put(g, G.disc, P.iron, 17, 4, 17, 0, 98, 0);
    put(g, G.low, P.lamp, 11, 13, 11, 0, 108, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      put(g, G.cyl, P.ironDark, 1.2, 22, 1.2, Math.cos(a) * 11, 108, Math.sin(a) * 11);
    }
    put(g, G.cone, P.iron, 15, 14, 15, 0, 124, 0);
    // The stair up the outside, which is how somebody still fills it.
    for (let i = 0; i < 30; i++) {
      const a = i * 0.42;
      put(g, G.box, P.stone, 6, 1.2, 3, Math.cos(a) * 15, 6 + i * 3.1,
        Math.sin(a) * 15, 0, a);
    }
  },

  // ─────────────────────────────────────────────────────── the Thirstlands ──
  pyramid(g, rnd, solid) {
    const P = mats();
    // Buried to the shoulders, so it is steps out of the sand and no base.
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const w = 96 - i * 5.4;
      put(g, G.box, i % 4 === 0 ? P.sandDark : P.sand, w, 7, w, 0, 3.5 + i * 6.6, 0);
    }
    solid(96, 40, 96, 0, 40, 0, 'wall');
    // The door somebody dug out, at the bottom of a cut in the sand.
    put(g, G.box, P.stoneDark, 16, 22, 8, 0, 8, 52);
    put(g, G.box, P.obsidian, 11, 16, 3, 0, 8, 57);
    put(g, G.box, P.gold, 13, 2.4, 4, 0, 18, 56);
    for (const sx of [-1, 1]) {
      put(g, G.box, P.sandDark, 6, 26, 30, sx * 22, 6, 60);
    }
    // A capstone that catches the light.
    put(g, G.octa, P.gold, 9, 12, 9, 0, 116, 0);
  },

  // ─────────────────────────────────────────────────────── the Choir Cliffs ──
  organ(g, rnd, solid) {
    const P = mats();
    /**
     * Pipes of rock in a shallow arc, tallest in the middle.
     *
     * Twenty-four rather than forty, and fatter: at forty the landmark alone
     * was eighty draw calls, and from any distance where it matters the extra
     * sixteen were a texture rather than a shape.
     */
    for (let i = 0; i < 24; i++) {
      const t = (i / 23) * 2 - 1;
      const h = 150 - Math.abs(t) * 90 + rnd() * 24;
      const x = t * 110;
      const z = Math.abs(t) * 30;
      const r = 7.5 + rnd() * 3;
      put(g, G.cyl, i % 3 === 0 ? P.stonePale : P.stone, r, h, r, x, h / 2, z);
      // The hole the wind comes through.
      put(g, G.box, P.stoneDark, r * 0.7, 10, r * 2.4, x, h * 0.72, z);
      if (i % 4 === 0) solid(r, h / 2, r, x, h / 2, z, 'pipe');
    }
    put(g, G.box, P.stoneDark, 240, 8, 40, 0, 4, 10);
    solid(120, 4, 20, 0, 4, 10, 'deck');
  },

  // ─────────────────────────────────────────────────────── the Boneflats ──
  skull(g, rnd, solid) {
    const P = mats();
    // Something's head, on its side, with a way in through the eye.
    put(g, G.low, P.bone, 54, 44, 62, 0, 40, 0);
    put(g, G.low, P.bone, 34, 26, 30, 0, 26, 54);
    solid(50, 40, 58, 0, 40, 0, 'skull');
    for (const sx of [-1, 1]) {
      put(g, G.low, P.boneDark, 13, 15, 13, sx * 26, 50, 26);
      // The eye socket you can walk into.
      put(g, G.cyl, P.stoneDark, 10, 14, 10, sx * 26, 50, 30, Math.PI / 2);
    }
    // Teeth, and the jaw lying separately where it fell.
    for (let i = 0; i < 9; i++) {
      const t = (i / 8) * 2 - 1;
      put(g, G.cone, P.bone, 4, 16, 4, t * 26, 16, 60 - Math.abs(t) * 10,
        Math.PI, 0, 0);
    }
    put(g, G.low, P.boneDark, 40, 12, 26, 20, 6, -62, 0, 0.4);
  },

  // ─────────────────────────────────────────────────────── the Drowned Keep ──
  sunkentower(g, rnd, solid) {
    const P = mats();
    // Four towers, out of the water at an angle, still flying flags.
    const lean = [[0, 0, 0.10, 118], [-42, 30, -0.14, 96],
      [46, -26, 0.17, 84], [-30, -44, -0.09, 70]];
    for (const [tx, tz, tilt, h] of lean) {
      const t = new THREE.Group();
      t.position.set(tx, 0, tz);
      t.rotation.z = tilt;
      t.rotation.x = tilt * 0.6;
      g.add(t);
      put(t, G.cyl, P.marbleDark, 10, h, 10, 0, h / 2, 0);
      put(t, G.disc, P.marble, 12, 4, 12, 0, h, 0);
      put(t, G.cone, P.tile, 12, 20, 12, 0, h + 10, 0);
      put(t, G.cyl, P.woodDark, 0.8, 22, 0.8, 0, h + 30, 0);
      put(t, G.box, P.tile, 12, 7, 0.4, 6, h + 36, 0);
      solid(10, h / 2, 10, tx, h / 2, tz, 'tower');
    }
    // The curtain wall, mostly under.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      put(g, G.box, P.marbleDark, 22, 20, 6, Math.cos(a) * 62, 6,
        Math.sin(a) * 62, 0, a + Math.PI / 2);
    }
    put(g, G.disc, P.water, 110, 1, 110, 0, 8, 0);
  },

  // ─────────────────────────────────────────────────────── the Emberwaste ──
  burnttree(g, rnd, solid) {
    const P = mats();
    put(g, G.taper, P.obsidian, 14, 130, 14, 0, 65, 0);
    solid(11, 65, 11, 0, 65, 0, 'trunk');
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const y = 46 + rnd() * 70;
      const len = 20 + rnd() * 40;
      const b = put(g, G.cyl, P.ash, 2.6, len, 2.6,
        Math.cos(a) * len * 0.3, y, Math.sin(a) * len * 0.3);
      b.rotation.z = Math.cos(a) * 1.2;
      b.rotation.x = -Math.sin(a) * 1.2;
    }
    // Still burning, at the base.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      put(g, G.low, P.ember, 3 + rnd() * 3, 4, 3 + rnd() * 3,
        Math.cos(a) * 15, 3, Math.sin(a) * 15);
    }
    put(g, G.low, P.ember, 9, 11, 9, 0, 6, 0);
  },

  // ─────────────────────────────────────────────────────── Cindermaw ──
  volcano(g, rnd, solid) {
    const P = mats();
    /**
     * The cone itself is TERRAIN, not this.
     *
     * The region's height function raises a four-hundred-unit mountain with a
     * caldera in the top of it, because nothing built out of boxes reads as a
     * volcano at that size. What is built here is what sits IN the caldera:
     * the lava, the vents, and the plume.
     */
    put(g, G.disc, P.ember, 58, 3, 58, 0, 2, 0);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 52;
      put(g, G.low, P.obsidian, 5 + rnd() * 7, 4 + rnd() * 6, 5 + rnd() * 7,
        Math.cos(a) * d, 3, Math.sin(a) * d);
    }
    // The plume, going up out of sight.
    for (let i = 0; i < 12; i++) {
      const s = 22 + i * 7;
      put(g, G.low, P.ash, s, s * 0.6, s, Math.sin(i * 1.3) * i * 3,
        30 + i * 34, Math.cos(i * 1.1) * i * 3);
    }
    // Obsidian spires round the rim, so the caldera has an edge you can see.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const h = 40 + rnd() * 40;
      put(g, G.cone, P.obsidian, 9, h, 9, Math.cos(a) * 74, h / 2, Math.sin(a) * 74);
      solid(9, h / 2, 9, Math.cos(a) * 74, h / 2, Math.sin(a) * 74, 'spire');
    }
  },

  // ─────────────────────────────────────────────────────── the Spine ──
  archway(g, rnd, solid) {
    const P = mats();
    // A hole through the ridge — two legs and a span, at the scale of a hill.
    for (const sx of [-1, 1]) {
      put(g, G.box, P.stone, 24, 100, 34, sx * 62, 50, 0, 0, 0, sx * 0.06);
      solid(24, 50, 34, sx * 62, 50, 0, 'pillar');
    }
    for (let i = 0; i < 9; i++) {
      const t = (i / 8) * 2 - 1;
      const x = t * 62;
      const y = 100 + Math.cos(t * Math.PI / 2) * 34;
      put(g, G.box, P.stone, 18, 22, 34, x, y, 0, 0, 0, -t * 0.4);
    }
    put(g, G.box, P.stoneDark, 150, 16, 40, 0, 148, 0);
    // Vertebral buttresses, so it reads as bone and not masonry.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        put(g, G.low, P.bone, 10, 16, 10, sx * 62, 18 + i * 20, sx * 22);
      }
    }
  },

  // ─────────────────────────────────────────────────────── the Moonshelf ──
  skytower(g, rnd, solid) {
    const P = mats();
    // A needle going up into the cloud, narrowing the whole way.
    let r = 16;
    for (let i = 0; i < 22; i++) {
      const h = 22;
      put(g, G.cyl, i % 2 ? P.marble : P.marbleDark, r, h, r, 0, 11 + i * h, 0);
      if (i % 4 === 0) {
        put(g, G.disc, P.marble, r * 1.5, 2.4, r * 1.5, 0, i * h + 20, 0);
        put(g, G.low, P.glow, 2, 2.4, 2, r * 1.4, i * h + 22, 0);
      }
      r *= 0.93;
    }
    solid(14, 60, 14, 0, 60, 0, 'tower');
    // The base, and the stair spiralling up out of sight.
    put(g, G.disc, P.marbleDark, 30, 6, 30, 0, 3, 0);
    solid(30, 3, 30, 0, 3, 0, 'deck');
    for (let i = 0; i < 40; i++) {
      const a = i * 0.38;
      put(g, G.box, P.marble, 7, 1.4, 3.4, Math.cos(a) * 19, 7 + i * 4.4,
        Math.sin(a) * 19, 0, a);
    }
  },

  // ─────────────────────────────────────────────────────── the Palewood ──
  whitedoor(g, rnd, solid) {
    const P = mats();
    /**
     * A door. Four storeys tall. Attached to nothing at all.
     *
     * Not a ruin — there is deliberately no wall, no foundation and no
     * rubble, because the joke only lands if it is obviously not the last
     * piece of something bigger.
     */
    put(g, G.box, P.pale, 26, 56, 3, 0, 28, 0);
    put(g, G.box, P.marbleDark, 30, 4, 5, 0, 58, 0);
    put(g, G.box, P.pale, 3, 56, 4, -14, 28, 0);
    put(g, G.box, P.pale, 3, 56, 4, 14, 28, 0);
    for (let i = 0; i < 4; i++) {
      put(g, G.box, P.marbleDark, 20, 1.2, 4, 0, 10 + i * 13, 1.6);
    }
    put(g, G.low, P.gold, 1.6, 1.6, 1.6, 9, 26, 2.4);
    solid(14, 28, 2.5, 0, 28, 0, 'door');
  },

  // ─────────────────────────────────────────────────────── the Hollow City ──
  wall(g, rnd, solid) {
    const P = mats();
    // Two hundred feet of curtain wall with a barred gate in the middle.
    put(g, G.box, P.stone, 190, 62, 16, 0, 31, 0);
    solid(190, 31, 16, 0, 31, 0, 'wall');
    for (let i = -6; i <= 6; i++) {
      put(g, G.box, P.stoneDark, 7, 8, 20, i * 15, 66, 0);
    }
    for (const sx of [-1, 1]) {
      put(g, G.cyl, P.stone, 20, 92, 20, sx * 40, 46, 0);
      put(g, G.disc, P.stoneDark, 23, 6, 23, sx * 40, 92, 0);
      put(g, G.cone, P.tileDark, 22, 22, 22, sx * 40, 104, 0);
      solid(20, 46, 20, sx * 40, 46, 0, 'tower');
    }
    // The gate, and the bars across it from the inside.
    put(g, G.box, P.stoneDark, 22, 42, 20, 0, 21, 0);
    put(g, G.box, P.ironDark, 18, 34, 3, 0, 17, -9);
    for (let i = 0; i < 5; i++) {
      put(g, G.box, P.wood, 26, 3, 3, 0, 8 + i * 7, -12, 0, 0, 0.12);
    }
  },

  // ─────────────────────────────────────────────────────── the Glimmerwood ──
  crystal(g, rnd, solid) {
    const P = mats();
    // One cathedral-sized shard, and a copse of smaller ones round it.
    const main = put(g, G.octa, P.prism, 26, 110, 26, 0, 74, 0);
    main.rotation.y = 0.4;
    solid(20, 40, 20, 0, 40, 0, 'crystal');
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rnd() * 0.5;
      const d = 34 + rnd() * 42;
      const h = 30 + rnd() * 60;
      const s = put(g, G.octa, i % 3 ? P.prism : P.glow, 8 + rnd() * 6, h,
        8 + rnd() * 6, Math.cos(a) * d, h * 0.62, Math.sin(a) * d);
      s.rotation.z = (rnd() - 0.5) * 0.5;
      if (i % 3 === 0) solid(8, h * 0.4, 8, Math.cos(a) * d, h * 0.4,
        Math.sin(a) * d, 'crystal');
    }
    // Rocks that never came down.
    for (let i = 0; i < 8; i++) {
      const a = rnd() * Math.PI * 2, d = 40 + rnd() * 60;
      put(g, G.low, P.stoneDark, 8 + rnd() * 8, 6 + rnd() * 6, 8 + rnd() * 8,
        Math.cos(a) * d, 60 + rnd() * 70, Math.sin(a) * d);
    }
  },

  // ─────────────────────────────────────────────────────── the Frostmarch ──
  frozencastle(g, rnd, solid) {
    const P = mats();
    // A keep with the sea frozen halfway up its walls.
    put(g, G.box, P.stonePale, 74, 56, 60, 0, 28, 0);
    solid(74, 28, 60, 0, 28, 0, 'wall');
    put(g, G.box, P.iceDeep, 84, 22, 70, 0, 11, 0);
    for (const [tx, tz, h] of [[-38, -32, 96], [38, -32, 96], [-38, 32, 78],
      [38, 32, 78], [0, -40, 118]]) {
      put(g, G.cyl, P.stonePale, 13, h, 13, tx, h / 2, tz);
      put(g, G.cone, P.ice, 16, 26, 16, tx, h + 13, tz);
      solid(13, h / 2, 13, tx, h / 2, tz, 'tower');
    }
    // Icicles the size of trees, off every edge.
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 30 + rnd() * 46;
      put(g, G.cone, P.ice, 3 + rnd() * 3, 20 + rnd() * 30, 3 + rnd() * 3,
        Math.cos(a) * d, 40, Math.sin(a) * d, Math.PI);
    }
    put(g, G.disc, P.ice, 130, 2, 130, 0, 4, 0);
  },

  // ─────────────────────────────────────────────────────── the Rimefang ──
  icetemple(g, rnd, solid) {
    const P = mats();
    // Cut into the last peak, with the door facing the wind.
    put(g, G.box, P.iceDeep, 80, 96, 50, 0, 48, -30);
    solid(80, 48, 50, 0, 48, -30, 'cliff');
    put(g, G.box, P.ice, 44, 40, 14, 0, 20, 0);
    put(g, G.box, P.stonePale, 52, 6, 20, 0, 42, 0);
    put(g, G.cone, P.ice, 30, 30, 24, 0, 56, -4);
    for (let i = -3; i <= 3; i++) {
      put(g, G.cyl, P.ice, 3.4, 36, 3.4, i * 7, 18, 7);
    }
    put(g, G.box, P.stoneDark, 12, 22, 4, 0, 11, 8);
    put(g, G.low, P.glow, 2.6, 3, 2.6, 0, 26, 6);
    // Frozen waterfall down the face beside it.
    put(g, G.box, P.ice, 16, 92, 5, -46, 46, -6);
  },

  // ─────────────────────────────────────────────────────── the Sunderway ──
  bigbridge(g, rnd, solid) {
    const P = mats();
    /**
     * The road across the chasm is already there — the road network grades a
     * causeway over it, which is what makes the crossing walkable. This is
     * the bridge built ON that causeway: piers, parapets and arches, running
     * north-south, so the crossing looks like the feat it is.
     */
    for (let i = -5; i <= 5; i++) {
      const z = i * 34;
      const drop = 30 + Math.cos((i / 5) * Math.PI / 2) * 70;
      put(g, G.box, P.stoneDark, 13, drop, 13, 0, -drop / 2 + 1, z);
      // The arch between this pier and the next.
      if (i < 5) {
        for (let k = 0; k < 5; k++) {
          const t = (k / 4) * 2 - 1;
          put(g, G.box, P.stone, 9, 6, 8, 0,
            -6 - (1 - Math.cos(t * Math.PI / 2)) * 14, z + 17 + t * 13);
        }
      }
    }
    // The deck and its parapets.
    put(g, G.box, P.stone, 26, 4, 366, 0, 0, 0);
    solid(13, 2, 183, 0, 0, 0, 'deck');
    for (const sx of [-1, 1]) {
      put(g, G.box, P.stonePale, 3, 7, 366, sx * 11.5, 4, 0);
      for (let i = -5; i <= 5; i++) {
        put(g, G.cyl, P.stone, 4, 24, 4, sx * 12, 12, i * 34);
        put(g, G.low, P.lamp, 1.8, 2, 1.8, sx * 12, 25, i * 34);
      }
    }
  },

  // ─────────────────────────────────────────────────────── the Ashen Throne ──
  throne(g, rnd, solid) {
    const P = mats();
    // A seat far too big for anything that walks, on a stepped dais.
    for (let i = 0; i < 5; i++) {
      const w = 96 - i * 13;
      put(g, G.box, i % 2 ? P.obsidian : P.ash, w, 7, w, 0, 3.5 + i * 6.4, 0);
    }
    solid(96, 18, 96, 0, 18, 0, 'deck');
    put(g, G.box, P.obsidian, 54, 12, 46, 0, 38, 0);
    put(g, G.box, P.obsidian, 54, 84, 12, 0, 76, -22);
    solid(54, 42, 12, 0, 76, -22, 'wall');
    for (const sx of [-1, 1]) {
      put(g, G.box, P.obsidian, 10, 46, 44, sx * 26, 56, 4);
      put(g, G.cone, P.ember, 6, 22, 6, sx * 40, 60, -18);
    }
    // A crown of spikes across the back, and the ash blowing off them.
    for (let i = -4; i <= 4; i++) {
      const h = 26 + (4 - Math.abs(i)) * 12;
      put(g, G.cone, P.obsidian, 5, h, 5, i * 12, 118 + h / 2 - 26, -22);
    }
    put(g, G.low, P.ember, 12, 5, 12, 0, 44, 6);
  },
};

/**
 * Build a region's landmark.
 *
 * @param kind  which one, from the region table
 * @param seed  so the same landmark is the same shape everywhere
 * @returns { group, solids } — solids are in the group's LOCAL space, for the
 *          caller to offset into the world and hand to collision.
 */
export function buildLandmark(kind, seed = 1) {
  const fn = BUILD[kind];
  const group = new THREE.Group();
  group.name = `landmark:${kind}`;
  const solids = [];
  const solid = (hx, hy, hz, x, y, z, tag) =>
    solids.push({ hx, hy, hz, x, y, z, tag: tag || 'landmark' });
  if (!fn) {
    // An unknown kind is a data error, and a visible one: a plain grey block
    // is far easier to notice than nothing at all.
    put(group, G.box, mats().stone, 20, 40, 20, 0, 20, 0);
    solid(20, 20, 20, 0, 20, 0, 'landmark');
    return { group, solids };
  }
  fn(group, mulberry32(seed), solid);
  return { group, solids };
}

/** Every kind a region may ask for. Used by the tests to check the table. */
export const LANDMARK_KINDS = Object.keys(BUILD);

/** Free the shared materials. Geometry is shared and must NOT be disposed. */
export function disposeLandmarkMats() {
  if (!M) return;
  for (const k in M) M[k].dispose();
  M = null;
}
