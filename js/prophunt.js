/**
 * ═══ PROP HUNT ═══════════════════════════════════════════════════════════
 *
 * Half the lobby are HUNTERS with blades. Everyone else is a lamppost.
 *
 * ── the disguises belong to the map ──────────────────────────────────────
 * This is the whole reason the mode is worth having, and it is the part that
 * is easy to get wrong. A generic crate that turns up in the temple, the
 * swamp and the city is not a disguise — it is a marker saying "player here",
 * because a hunter learns in one round that crates are never scenery.
 *
 * So every prop in this file is a thing the map it belongs to is ALREADY
 * full of. Shizuka Ward has forty-eight ramen carts and a lamppost on every
 * corner (see `_buildCityLife` and `_cityLamp` in js/world.js); the Hanging
 * Mire has stilt huts, reed beds and hanging marsh lights; Lotus Valley has
 * the shrine, its stone lanterns and the bamboo grove. Standing still in the
 * right place, a prop is genuinely indistinguishable from the furniture,
 * and that is the game.
 *
 * ── they are NOT the world's meshes ──────────────────────────────────────
 * Rebuilt here rather than cloned out of `World`, on purpose. The world's
 * props live in InstancedMesh batches — one draw call for four hundred
 * railings — and a single instance cannot be pulled out of a batch and
 * parented to a moving player. These are standalone groups built to match.
 *
 * Matching is therefore a thing that can DRIFT, and drift is the one failure
 * this mode cannot survive: a lamppost half a unit shorter than every other
 * lamppost is a lamppost with a frog in it.
 *
 * The two city props with an unambiguous collider in the world — the lamp
 * and the vending machine — are checked against it by `test_prophunt`,
 * which builds Shizuka Ward and re-derives their real size from the boxes
 * `_cityLamp` and `_cityVendor` actually added. That is what caught the
 * first lamppost, which was 5.0 tall and 0.22 wide against a real one 5.6
 * tall and 0.34 wide. The rest are matched by eye against the builders they
 * name, and drawn by `p_props.mjs` — a hut or a reed bed has no single
 * number to compare.
 *
 * ── holding still ───────────────────────────────────────────────────────
 * SHIFT locks a prop in place: movement input stops reaching the body and
 * the facing freezes, exactly as `sealedInStone` does for Earth Shell. The
 * camera stays free, because four minutes unable to see who is walking
 * towards you is not tension, it is a loading screen.
 *
 * Locking is not cosmetic. An unlocked prop drifts a little on its own —
 * see `bob` — which is what makes a moving prop findable at all; a locked
 * one is arithmetically still.
 */

import * as THREE from '../lib/three.module.js?v=v156';

// ---------------------------------------------------------------- geometry

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cone: new THREE.ConeGeometry(0.5, 1, 12),
  ball: new THREE.SphereGeometry(0.5, 12, 8),
  torus: new THREE.TorusGeometry(0.5, 0.12, 6, 14),
};

/**
 * Materials are shared across every prop on screen and cached by colour.
 *
 * `lit` picks an unlit basic material — a lamp head, a paper lantern, a
 * vending machine's face. Those have to read as emitting at night, and the
 * city map is night: a Lambert lamp head in the dark is a grey lump on a
 * pole, which is a lamppost nobody would mistake for the forty real ones.
 */
const _mats = new Map();
function mat(color, lit) {
  const key = (lit ? 'L' : 'S') + color;
  let m = _mats.get(key);
  if (!m) {
    m = lit
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshLambertMaterial({ color, flatShading: true });
    _mats.set(key, m);
  }
  return m;
}

/** One piece: geometry, colour, size, position, and an optional yaw/roll. */
function part(g, color, sx, sy, sz, x, y, z, ry = 0, rz = 0, lit = false) {
  const m = new THREE.Mesh(g, mat(color, lit));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.set(0, ry, rz);
  m.castShadow = !lit;
  m.receiveShadow = !lit;
  return m;
}

// ------------------------------------------------------------ city props

/**
 * A street lamp, measured off `World._cityLamp` rather than guessed.
 *
 * The real one is a 0.34-wide post 5.6 units tall in 0x2f3238, with a
 * 1.5 × 0.44 lit head slab in 0xffe2a0 at 5.7. Those exact numbers are
 * copied here and `test_prophunt` re-derives them from the city's own
 * collision boxes, because a lamppost a unit shorter than the forty real
 * ones is not a disguise — it is a lamppost with a frog in it. The first
 * pass at this was 5.0 tall and 0.22 wide, and that is what the check
 * caught.
 */
function buildLamppost() {
  const g = new THREE.Group();
  g.add(part(G.box, 0x2a2e36, 0.72, 0.18, 0.72, 0, 0.09, 0));     // foot
  g.add(part(G.box, 0x2f3238, 0.34, 5.6, 0.34, 0, 2.80, 0));      // post
  g.add(part(G.box, 0xffe2a0, 1.50, 0.44, 0.68, 0, 5.70, 0, 0, 0, true));
  g.add(part(G.box, 0x1e222a, 1.58, 0.16, 0.74, 0, 5.98, 0));     // hood
  return g;
}

/**
 * A ramen cart, matching `World._ramenCart`: a boxy stall on two wheels
 * with a cloth noren over the counter and a lantern hung off the corner.
 */
function buildRamenCart() {
  const g = new THREE.Group();
  g.add(part(G.box, 0x5a3f2a, 2.4, 0.9, 1.3, 0, 0.85, 0));        // body
  g.add(part(G.box, 0x7a5636, 2.5, 0.12, 1.4, 0, 1.36, 0));       // counter
  for (const x of [-0.85, 0.85]) {
    g.add(part(G.cyl, 0x2a2420, 0.62, 0.14, 0.62, x, 0.34, 0.62, 0, Math.PI / 2));
  }
  for (const x of [-1.05, 1.05]) {
    g.add(part(G.box, 0x4a3524, 0.09, 1.25, 0.09, x, 2.02, -0.2));
  }
  g.add(part(G.box, 0x3a2a1c, 2.5, 0.14, 1.5, 0, 2.70, -0.2));    // roof
  g.add(part(G.box, 0xb8342a, 2.3, 0.55, 0.06, 0, 2.38, -0.9));   // noren
  g.add(part(G.cyl, 0xffb86a, 0.32, 0.46, 0.32, 1.02, 2.30, 0.28, 0, 0, true));
  return g;
}

/**
 * A lit vending machine, measured off `World._cityVendor`: a 1.4 × 1.9 × 0.8
 * body with a lit 1.04 × 1.10 face and a dark tray under it. Same check as
 * the lamppost — the test re-derives the body from the city's own collider.
 *
 * The body colour is one of the two the world picks between; a machine that
 * is always the red one would still be a machine, and half the real ones are
 * teal, so the commoner of the two is used.
 */
function buildVending() {
  const g = new THREE.Group();
  g.add(part(G.box, 0xc4483c, 1.40, 1.90, 0.80, 0, 0.95, 0));
  g.add(part(G.box, 0xfff0c4, 1.04, 1.10, 0.12, 0, 1.25, 0.44, 0, 0, true));
  g.add(part(G.box, 0x2a2e36, 1.04, 0.24, 0.12, 0, 0.35, 0.44));  // tray
  return g;
}

/** A stack of delivery crates, as `World._crateStack` leaves them. */
function buildCrateStack() {
  const g = new THREE.Group();
  g.add(part(G.box, 0x6a4f33, 1.10, 0.80, 1.10, 0, 0.40, 0));
  g.add(part(G.box, 0x7a5c3c, 0.95, 0.70, 0.95, 0.10, 1.15, -0.06, 0.22));
  g.add(part(G.box, 0x5e462e, 0.80, 0.60, 0.80, -0.08, 1.80, 0.10, -0.15));
  return g;
}

/** A concrete street planter with a shrub in it. */
function buildPlanter() {
  const g = new THREE.Group();
  g.add(part(G.box, 0x8a8880, 1.5, 0.75, 1.5, 0, 0.37, 0));
  g.add(part(G.box, 0x3a2e20, 1.3, 0.10, 1.3, 0, 0.78, 0));
  g.add(part(G.ball, 0x3f6b2a, 1.15, 0.90, 1.15, 0, 1.22, 0));
  g.add(part(G.ball, 0x4e8034, 0.70, 0.60, 0.70, 0.35, 1.45, -0.2));
  return g;
}

/** A bicycle left against a wall. Low, and the easiest prop to walk past. */
function buildBicycle() {
  const g = new THREE.Group();
  for (const z of [-0.62, 0.62]) {
    g.add(part(G.torus, 0x1a1a1e, 0.66, 0.66, 0.66, 0, 0.33, z, Math.PI / 2));
  }
  g.add(part(G.box, 0x3a6a8a, 0.07, 0.07, 1.30, 0, 0.62, 0));
  g.add(part(G.box, 0x3a6a8a, 0.07, 0.42, 0.07, 0, 0.52, -0.5));
  g.add(part(G.box, 0x24242a, 0.16, 0.08, 0.34, 0, 0.86, -0.28));  // saddle
  g.add(part(G.box, 0x24242a, 0.50, 0.06, 0.06, 0, 0.98, 0.58));   // bars
  return g;
}

// ----------------------------------------------------------- valley props

/**
 * A SHRINE OUTBUILDING — the disguise that was asked for by name: "a house
 * that matches the temple".
 *
 * Same vocabulary as `World._buildShrine`: vermilion posts, a pale plaster
 * body and a heavy dark tiled roof with the eaves standing well proud of
 * the walls. At 3.4 units it is a small building rather than a box, which
 * is what lets it sit in the village without being the odd one out.
 */
function buildShrineHut() {
  const g = new THREE.Group();
  g.add(part(G.box, 0x6a6258, 2.9, 0.30, 2.5, 0, 0.15, 0));       // stone base
  for (const x of [-1.2, 1.2]) {
    for (const z of [-1.0, 1.0]) {
      g.add(part(G.box, 0xb8442e, 0.22, 1.9, 0.22, x, 1.25, z));  // posts
    }
  }
  g.add(part(G.box, 0xdfd8c4, 2.3, 1.6, 1.9, 0, 1.10, 0));        // walls
  g.add(part(G.box, 0x3a2a1e, 1.0, 1.4, 0.08, 0, 1.00, 0.98));    // door
  g.add(part(G.box, 0x4a3a28, 3.3, 0.18, 2.9, 0, 2.28, 0));       // eaves
  g.add(part(G.box, 0x2e2a30, 2.9, 0.42, 2.5, 0, 2.58, 0));       // tiles
  g.add(part(G.box, 0x3a3640, 2.2, 0.30, 1.8, 0, 2.92, 0));
  g.add(part(G.box, 0xb8442e, 2.4, 0.14, 0.14, 0, 3.12, 0));      // ridge
  return g;
}

/** A stone lantern, as `World._buildLanterns` scatters along the paths. */
function buildStoneLantern() {
  const g = new THREE.Group();
  g.add(part(G.cyl, 0x7a7668, 0.72, 0.30, 0.72, 0, 0.15, 0));
  g.add(part(G.cyl, 0x8a8678, 0.34, 0.95, 0.34, 0, 0.78, 0));     // shaft
  g.add(part(G.box, 0x9a9688, 0.92, 0.14, 0.92, 0, 1.32, 0));     // platform
  g.add(part(G.box, 0x8a8678, 0.70, 0.52, 0.70, 0, 1.65, 0));     // firebox
  g.add(part(G.box, 0xffd88a, 0.46, 0.34, 0.46, 0, 1.65, 0, 0, 0, true));
  g.add(part(G.box, 0x9a9688, 1.05, 0.20, 1.05, 0, 2.00, 0));     // cap
  g.add(part(G.ball, 0x9a9688, 0.30, 0.34, 0.30, 0, 2.18, 0));
  return g;
}

/** A bronze bell hung in a timber frame. */
function buildPrayerBell() {
  const g = new THREE.Group();
  for (const x of [-0.75, 0.75]) {
    g.add(part(G.box, 0x5a4330, 0.22, 2.4, 0.22, x, 1.20, 0, 0, x > 0 ? -0.06 : 0.06));
  }
  g.add(part(G.box, 0x4a3628, 2.0, 0.24, 0.30, 0, 2.48, 0));      // lintel
  g.add(part(G.cyl, 0x6a6a4a, 0.80, 0.95, 0.80, 0, 1.72, 0));     // bell
  g.add(part(G.cyl, 0x7a7a54, 0.90, 0.16, 0.90, 0, 1.22, 0));     // lip
  g.add(part(G.box, 0x8a6a3a, 0.16, 0.16, 1.10, 0, 1.85, 0.80));  // striker
  return g;
}

/** Stacked sake barrels — the kind piled against a shrine wall. */
function buildBarrels() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.42, 0], [0.42, 0.1]]) {
    g.add(part(G.cyl, 0xd8c48a, 0.78, 0.86, 0.78, x, 0.43, z));
    g.add(part(G.cyl, 0x3a2a1a, 0.84, 0.10, 0.84, x, 0.43, z));
    g.add(part(G.cyl, 0xb8342a, 0.72, 0.08, 0.72, x, 0.86, z));
  }
  g.add(part(G.cyl, 0xd8c48a, 0.74, 0.82, 0.74, 0, 1.30, 0.05));
  g.add(part(G.cyl, 0x3a2a1a, 0.80, 0.10, 0.80, 0, 1.30, 0.05));
  return g;
}

/** A clump of bamboo out of the grove. Tall, thin and very easy to miss. */
function buildBambooClump() {
  const g = new THREE.Group();
  const canes = [[0, 0, 4.4], [0.32, 0.2, 3.8], [-0.28, 0.26, 4.1],
    [0.14, -0.30, 3.4]];
  for (const [x, z, h] of canes) {
    g.add(part(G.cyl, 0x6f9445, 0.17, h, 0.17, x, h / 2, z, 0, x * 0.04));
    for (let i = 1; i * 0.9 < h; i++) {
      g.add(part(G.cyl, 0x8fb45a, 0.20, 0.07, 0.20, x, i * 0.9, z));
    }
    g.add(part(G.box, 0x4e7a34, 0.9, 0.07, 0.55, x, h - 0.3, z, x * 3));
  }
  return g;
}

// ------------------------------------------------------------- mire props

/** A stilt hut, matching `World._mireHut`: a hut on legs over the water. */
function buildStiltHut() {
  const g = new THREE.Group();
  for (const x of [-1.0, 1.0]) {
    for (const z of [-0.9, 0.9]) {
      g.add(part(G.cyl, 0x4a3a2a, 0.20, 1.5, 0.20, x, 0.75, z));
    }
  }
  g.add(part(G.box, 0x5a4632, 2.5, 0.20, 2.2, 0, 1.58, 0));       // deck
  g.add(part(G.box, 0x6a5a42, 2.1, 1.5, 1.8, 0, 2.42, 0));        // walls
  g.add(part(G.box, 0x2a2018, 0.85, 1.2, 0.06, 0, 2.28, 0.92));   // doorway
  g.add(part(G.box, 0x4a5a3a, 2.7, 0.22, 2.4, 0, 3.24, 0));       // thatch
  g.add(part(G.box, 0x3f4f30, 1.9, 0.34, 1.7, 0, 3.50, 0));
  g.add(part(G.cyl, 0x8fd8a0, 0.26, 0.34, 0.26, 1.0, 2.70, 0.95, 0, 0, true));
  return g;
}

/** A cluster of the big pale mire mushrooms. */
function buildMushrooms() {
  const g = new THREE.Group();
  const caps = [[0, 0, 1.5, 1.25], [0.72, 0.38, 1.0, 0.85], [-0.62, 0.48, 0.75, 0.7]];
  for (const [x, z, h, r] of caps) {
    g.add(part(G.cyl, 0xd8d0b8, r * 0.38, h, r * 0.38, x, h / 2, z));
    g.add(part(G.ball, 0x8a6a8a, r * 2.0, r * 1.1, r * 2.0, x, h, z));
    g.add(part(G.ball, 0x9a7a9a, r * 1.4, r * 0.5, r * 1.4, x, h + 0.18, z));
  }
  g.add(part(G.box, 0x4e6a3a, 1.9, 0.08, 1.7, 0, 0.04, 0));       // moss pad
  return g;
}

/** A rotten stump, half-swallowed by moss. The lowest prop in the game. */
function buildRotStump() {
  const g = new THREE.Group();
  g.add(part(G.cyl, 0x4a3f2e, 1.45, 1.30, 1.45, 0, 0.65, 0));
  g.add(part(G.cyl, 0x3a3226, 1.30, 0.16, 1.30, 0, 1.34, 0));     // sawn top
  g.add(part(G.ball, 0x4e7a34, 1.30, 0.42, 1.30, 0, 1.36, 0));    // moss
  g.add(part(G.cyl, 0x4a3f2e, 0.45, 0.90, 0.45, 0.62, 1.05, 0.3, 0, 0.5));
  g.add(part(G.box, 0x3f6b28, 0.55, 0.10, 0.55, -0.5, 1.15, -0.35, 0.6));
  return g;
}

/** A reed bundle out of the beds `World._buildMireReeds` plants. */
function buildReedBundle() {
  const g = new THREE.Group();
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const x = Math.cos(a) * 0.32, z = Math.sin(a) * 0.32;
    const h = 2.1 + ((i * 7) % 5) * 0.22;
    g.add(part(G.cyl, 0x6a7a42, 0.08, h, 0.08, x, h / 2, z, 0, x * 0.22));
    g.add(part(G.box, 0x8a7a4a, 0.12, 0.34, 0.12, x * 1.4, h, z * 1.4, 0, x * 0.3));
  }
  g.add(part(G.ball, 0x3f4f2e, 1.30, 0.26, 1.30, 0, 0.06, 0));
  return g;
}

/** A marsh light on a crooked pole, as the mire hangs along its walkways. */
function buildMarshLamp() {
  const g = new THREE.Group();
  g.add(part(G.cyl, 0x4a3a2a, 0.18, 2.9, 0.18, 0, 1.45, 0, 0, 0.05));
  g.add(part(G.box, 0x4a3a2a, 0.12, 0.12, 0.70, 0.1, 2.86, 0.3));
  g.add(part(G.box, 0x2a2420, 0.10, 0.34, 0.10, 0.13, 2.60, 0.62));
  g.add(part(G.cyl, 0x8fd8a0, 0.42, 0.52, 0.42, 0.13, 2.28, 0.62, 0, 0, true));
  g.add(part(G.box, 0x2a2420, 0.50, 0.08, 0.50, 0.13, 2.56, 0.62));
  return g;
}

// --------------------------------------------------------------- the table

/**
 * ═══ WHAT EACH MAP LETS YOU BE ═══════════════════════════════════════════
 *
 * `h` is the prop's height and `r` its footprint radius. Both are read by
 * the game rather than decorative: `r` scales the player's collider so a
 * ramen cart cannot slip through a doorway a frog fits through, and `h`
 * puts the camera above the prop instead of inside it.
 *
 * `bob` is how far an UNLOCKED prop sways. It is the mode's one concession
 * to fairness: a prop that is perfectly still while walking is unfindable,
 * and one that is obviously bobbing is unhideable, so it is small — a few
 * centimetres — and it stops dead the moment Shift goes down.
 */
export const PROPS = {
  valley: [
    { id: 'shrine', name: 'Shrine Hut', h: 3.4, r: 1.55, bob: 0.05, build: buildShrineHut },
    { id: 'lantern', name: 'Stone Lantern', h: 2.3, r: 0.55, bob: 0.06, build: buildStoneLantern },
    { id: 'bell', name: 'Prayer Bell', h: 2.7, r: 1.00, bob: 0.05, build: buildPrayerBell },
    { id: 'barrels', name: 'Sake Barrels', h: 1.7, r: 0.85, bob: 0.07, build: buildBarrels },
    { id: 'bamboo', name: 'Bamboo Clump', h: 4.4, r: 0.60, bob: 0.09, build: buildBambooClump },
  ],
  mire: [
    { id: 'hut', name: 'Stilt Hut', h: 3.6, r: 1.45, bob: 0.05, build: buildStiltHut },
    { id: 'mushrooms', name: 'Mire Mushrooms', h: 2.1, r: 1.15, bob: 0.07, build: buildMushrooms },
    { id: 'stump', name: 'Rotten Stump', h: 1.6, r: 0.85, bob: 0.06, build: buildRotStump },
    { id: 'reeds', name: 'Reed Bundle', h: 3.0, r: 0.70, bob: 0.09, build: buildReedBundle },
    { id: 'marshlamp', name: 'Marsh Light', h: 3.1, r: 0.55, bob: 0.06, build: buildMarshLamp },
  ],
  city: [
    { id: 'lamppost', name: 'Street Lamp', h: 6.06, r: 0.45, bob: 0.05, build: buildLamppost },
    { id: 'ramen', name: 'Ramen Cart', h: 2.9, r: 1.35, bob: 0.05, build: buildRamenCart },
    { id: 'vending', name: 'Vending Machine', h: 1.9, r: 0.70, bob: 0.06, build: buildVending },
    { id: 'crates', name: 'Crate Stack', h: 2.1, r: 0.70, bob: 0.07, build: buildCrateStack },
    { id: 'planter', name: 'Street Planter', h: 1.7, r: 0.85, bob: 0.07, build: buildPlanter },
    { id: 'bicycle', name: 'Bicycle', h: 1.1, r: 0.70, bob: 0.08, build: buildBicycle },
  ],
};

/**
 * The marker that sits over a prop while the reveal is firing.
 *
 * A DIAMOND ABOVE IT, not a tint on the prop itself. Tinting was the first
 * idea and it is the wrong one: a lamppost that turns gold for five seconds
 * is still a lamppost behind a wall, so the reveal would only work on props
 * a hunter could already see. A marker floating clear of the prop's own
 * height carries over street furniture and reads from across a junction,
 * which is what "revealed" has to mean on a 420-unit map.
 *
 * Unlit on purpose — it is a HUD element that happens to live in the world,
 * and a Lambert marker would go dark in the shadow of the building it is
 * meant to be giving away.
 */
/**
 * THROUGH WALLS. `depthTest: false` is the whole trick — the marker is drawn
 * ignoring the depth buffer, so a building in front of it does not occlude
 * it, and `renderOrder` puts it after the world so it lands on top.
 *
 * ── ITS OWN MATERIALS, NOT THE SHARED CACHE ─────────────────────────────
 * This used to build the marker with `part()` and then walk it turning
 * depth testing off. `part()` hands out materials from `mat()`, which
 * caches BY COLOUR and shares them with every prop on the map — so that
 * loop was reaching into the cache and permanently disabling depth testing
 * on whatever else happened to use those two colours. Nothing does today,
 * which is the only reason it was not already a bug where lampposts drew
 * through buildings.
 */
const _markMat = [0xffe08a, 0xfff4d0].map((color) => new THREE.MeshBasicMaterial({
  color, depthTest: false, depthWrite: false,
}));

function markPiece(mat, sx, sy, sz, y) {
  const m = new THREE.Mesh(G.cone, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(0, y, 0);
  m.rotation.z = Math.PI;
  m.renderOrder = 998;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

export function buildRevealMark() {
  const g = new THREE.Group();
  g.add(markPiece(_markMat[0], 0.55, 0.60, 0.55, 0.30));
  g.add(markPiece(_markMat[1], 0.34, 0.34, 0.34, 0.46));
  return g;
}

/**
 * ═══ THE OUTLINE ════════════════════════════════════════════════════════
 *
 * The revealed prop itself, drawn THROUGH everything in one flat colour.
 *
 * A marker floating above a prop tells a hunter which direction to walk. It
 * does not tell them the thing behind that wall is a ramen cart rather than
 * a lamppost, and it does not survive the prop being inside a building —
 * which in Shizuka Ward is most of them.
 *
 * So the prop is rebuilt as a shell: every material replaced with one
 * unlit translucent colour, depth testing off, and scaled up 5% so it sits
 * just outside the real prop and reads as an OUTLINE around it rather than
 * as a solid blob replacing it. Seen with no wall in the way you get the
 * real prop with a glowing edge; seen through a wall you get the shape.
 *
 * One shared material for the whole thing, on purpose: an outline is a
 * silhouette, and silhouettes do not have colour detail. It also means a
 * revealed prop costs one material however many pieces it has.
 */
const _outlineMat = new THREE.MeshBasicMaterial({
  color: 0xffd98a,
  transparent: true,
  opacity: 0.42,
  depthTest: false,
  depthWrite: false,
  side: THREE.BackSide,
});

export function buildRevealOutline(mapId, index) {
  const g = buildProp(mapId, index);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.material = _outlineMat;
    o.renderOrder = 997;
    o.castShadow = false;
    o.receiveShadow = false;
  });
  /**
   * BackSide plus a 5% swell is what makes it an outline rather than a
   * wash over the prop: only the far faces are drawn, so from outside you
   * see the rim where the shell passes behind the silhouette's edge.
   */
  g.scale.setScalar(1.05);
  /**
   * Marked as an outline. It is built by `buildProp`, so it carries that
   * prop's `userData.prop` and is otherwise indistinguishable from the real
   * thing — which matters to anything counting what is in the scene.
   */
  g.userData.outline = true;
  return g;
}

/**
 * The disguises available on a map.
 *
 * Falls back to the city's rather than to an empty list: an unknown map id
 * would otherwise start a round in which nobody can hide, which is a much
 * worse failure than a lamppost in the wrong village.
 */
export function propsFor(mapId) {
  return PROPS[mapId] || PROPS.city;
}

/** One prop's definition on a map, by index — wraps, so cycling is safe. */
export function propAt(mapId, index) {
  const list = propsFor(mapId);
  return list[((index % list.length) + list.length) % list.length];
}

/** Index of a prop id on a map, or 0 if it is not one of them. */
export function propIndex(mapId, id) {
  const i = propsFor(mapId).findIndex((p) => p.id === id);
  return i < 0 ? 0 : i;
}

/**
 * Build the mesh for a prop.
 *
 * `userData.prop` carries the definition so whatever is holding the group
 * can ask how tall it is without keeping a parallel record that could fall
 * out of step with the group it describes.
 */
export function buildProp(mapId, index) {
  const def = propAt(mapId, index);
  const g = def.build();
  g.userData.prop = def;
  return g;
}

/**
 * ═══ THE REVEAL PULSE ════════════════════════════════════════════════════
 *
 * Every `revealEvery` seconds the hidden props light up for `revealFor`.
 *
 * A PURE FUNCTION OF THE ROUND CLOCK, and that is the whole design. Nothing
 * about the pulse is stored, broadcast or decided by the host: every client
 * is handed the same `sinceHide` by `RoundManager.timer` and arrives at the
 * same answer, so a reveal cannot fire on the hunter's screen a second
 * before it fires on the prop's — which would be the one bug that makes the
 * mechanic unfair rather than tense.
 *
 * The window sits at the END of each cycle rather than the start, so the
 * first one lands at 25 seconds instead of at 0. A pulse on the very frame
 * the hunters are released would reveal everybody before anybody had
 * finished choosing a corner.
 *
 * @param sinceHide seconds since the hunters were let go — negative while
 *                  the props are still scattering, which is never a reveal.
 * @param gap       DARK seconds between pulses.
 * @param forSecs   how long a pulse lasts. The cycle is gap + forSecs.
 * @returns { on, left, next } — whether it is firing, how long is left of
 *          it, and how long until the next one starts.
 */
export function revealAt(sinceHide, gap, forSecs) {
  const GAP = gap > 0 ? gap : 30;
  const F = forSecs > 0 ? forSecs : 5;
  const CYCLE = GAP + F;
  if (!(sinceHide >= 0)) {
    // Still hiding. The first pulse is a full gap away from the release.
    return { on: false, left: 0, next: GAP + Math.max(0, -(sinceHide || 0)) };
  }
  const phase = sinceHide % CYCLE;
  if (phase >= GAP) return { on: true, left: CYCLE - phase, next: 0 };
  return { on: false, left: 0, next: GAP - phase };
}

/**
 * How far a prop has drifted from rest at time `t`.
 *
 * Deterministic and locked to the clock rather than random, so every viewer
 * sees the same sway — a prop that bobbed differently on two screens would
 * be a prop that is standing still on the hunter's screen and moving on its
 * owner's, and only one of them would be playing the game.
 *
 * Returns 0 exactly when locked. Not "very nearly 0": the test asserts
 * stillness, and the mode's promise is that holding Shift makes you
 * furniture.
 */
export function propBob(def, t, locked) {
  if (locked || !def) return 0;
  return Math.sin(t * 1.7) * (def.bob || 0);
}
