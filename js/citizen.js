/**
 * THE PEOPLE OF THE CROAKLANDS — and they are frogs.
 *
 * Everyone in the world used to be built from one of two rigs: the player's
 * `FrogModel`, which is a ninja in a gi with a katana on its back, or a
 * nine-sphere `Villager` that was a snowman with eyes on the front of its
 * face. Neither of them is a frog and neither of them is a citizen, which
 * between them made a country of farmers and fishmongers look like a martial
 * arts school.
 *
 * ── what makes this read as a frog ────────────────────────────────────────
 * Four things, and they are worth naming because they are the whole job:
 *
 *   EYES ON TOP     bulging up out of the skull, not set into the front of a
 *                   face. This is the single strongest cue there is.
 *   WIDE FLAT HEAD  broad across, shallow front to back, with a mouth line
 *                   that runs the full width of it.
 *   THROAT SAC      a paler pouch under the jaw. It breathes.
 *   WEBBED HANDS    splayed fans rather than fists, and hind feet that are
 *   AND FEET        longer than the shins they hang off.
 *
 * Plus a squat, bow-legged stance: thighs out to the sides, knees higher than
 * the hips. A frog does not stand like a person in a frog suit.
 *
 * ── and they are not all warriors ─────────────────────────────────────────
 * `ROLES` is the other half. A farmer wears a straw hat and carries a hoe; a
 * fishmonger has a creel; a smith has an apron and a hammer; a scholar has a
 * book and spectacles. Only `guard`, `soldier` and `ninja` carry a weapon,
 * and there are three of those roles out of twenty. The player is the ninja.
 * Everybody else is somebody who lives here.
 *
 * ── why it is cheap ───────────────────────────────────────────────────────
 * The parts are MERGED. Every skin-coloured piece of the torso becomes one
 * geometry, the head another, and both are cached per body VARIANT — so the
 * whole world shares six of each no matter how many frogs are standing in it.
 * Colour lives in the material, which is cached per palette. A citizen is
 * about a dozen draw calls with sixty parts in it, where the nine-mesh
 * villager it replaces was nine draw calls with nine.
 */

import * as THREE from '../lib/three.module.js?v=v98';
import { clamp, damp, lerp } from './util.js?v=v98';

/** Source geometry. Everything below is built out of these five. */
const S = {
  sphere: new THREE.SphereGeometry(1, 10, 7),
  low: new THREE.SphereGeometry(1, 7, 5),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 7),
  cone: new THREE.ConeGeometry(1, 1, 7),
  ring: new THREE.TorusGeometry(1, 0.16, 5, 10),
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Merge a list of transformed geometries into one.
 *
 * Hand-rolled because the local Three build is the core module and nothing
 * else — there is no BufferGeometryUtils to import. Positions and normals
 * only: nothing here is textured, and vertex colours would defeat the point
 * of sharing one geometry between every colour of frog in the country.
 */
function merge(parts) {
  const geos = [];
  let verts = 0;
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    g.applyMatrix4(part.m);
    geos.push(g);
    verts += g.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o);
    nrm.set(g.attributes.normal.array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}

/** A transform, as the merge helper wants it. */
function at(geo, sx, sy, sz, x, y, z, rx, ry, rz) {
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  _e.set(rx || 0, ry || 0, rz || 0);
  _q.setFromEuler(_e);
  return { geo, m: new THREE.Matrix4().compose(_p, _q, _s) };
}

// ══════════════════════════════════════════════════════════════════ looks ══

/**
 * Frog colours, as families rather than a spray of hex values.
 *
 * Named because the quest table refers to them: a village of green frogs with
 * one blue traveller passing through says something, and it can only say it
 * if the palette is a list somebody chose.
 */
export const SKINS = {
  green: 0x6cc24a,
  moss: 0x4f8a3a,
  olive: 0x8fa34a,
  brown: 0x8a6a3a,
  clay: 0xa8703a,
  blue: 0x4f8fc4,
  teal: 0x3f8a86,
  yellow: 0xc9b23a,
  sand: 0xc9a878,
  pale: 0xcfd4b4,
  dark: 0x3a4a3a,
  slate: 0x5a6a70,
  plum: 0x7a4f6a,
};
export const SKIN_KEYS = Object.keys(SKINS);

/**
 * Body variants. Geometry is cached per entry, so this list is the whole cost.
 *
 *   build  how the torso is shaped
 *   eye    how far the eyes bulge, which is most of a frog's expression
 *   squat  how low and how bow-legged the stance is
 */
const BUILDS = [
  { id: 'slim', w: 0.88, h: 1.06, eye: 0.94, squat: 0.94 },
  { id: 'round', w: 1.10, h: 0.94, eye: 1.00, squat: 1.06 },
  { id: 'stout', w: 1.22, h: 0.88, eye: 0.90, squat: 1.14 },
  { id: 'lanky', w: 0.82, h: 1.16, eye: 1.08, squat: 0.86 },
  { id: 'young', w: 0.92, h: 0.82, eye: 1.24, squat: 1.00 },
  { id: 'old', w: 1.04, h: 0.86, eye: 0.86, squat: 1.18 },
];
export const BUILD_IDS = BUILDS.map((b) => b.id);

/**
 * Who lives here, and what that looks like.
 *
 *   cloth   the colour of what they are wearing
 *   wear    'apron' | 'tunic' | 'robe' | 'wrap' | null
 *   hat     'straw' | 'hood' | 'cap' | 'crown' | 'helm' | null
 *   hold    what is in the right hand
 *   armed   true only for the three roles that are supposed to be dangerous
 *   build   forced body variant, where the role implies one
 *
 * Twenty roles, three of them armed. That ratio IS the design: the Croaklands
 * is a country with an occupying army in it, not an army with a country.
 */
export const ROLES = {
  farmer: { cloth: 0xb8a06a, wear: 'wrap', hat: 'straw', hold: 'hoe' },
  fisher: { cloth: 0x5a8a9a, wear: 'wrap', hat: 'straw', hold: 'rod' },
  fishmonger: { cloth: 0x6a9aa8, wear: 'apron', hold: 'creel' },
  merchant: { cloth: 0x9a5a7a, wear: 'robe', hat: 'cap', hold: 'purse' },
  shopkeeper: { cloth: 0xc4a86a, wear: 'apron', hold: 'ledger' },
  smith: { cloth: 0x5a4a3a, wear: 'apron', hold: 'hammer' },
  innkeeper: { cloth: 0xb4886a, wear: 'apron', hold: 'tankard' },
  baker: { cloth: 0xe0d6b4, wear: 'apron', hat: 'cap', hold: 'loaf' },
  child: { cloth: 0xd9c89a, wear: 'wrap', build: 'young' },
  elder: { cloth: 0x9a9a8a, wear: 'robe', build: 'old', hold: 'staff' },
  scholar: { cloth: 0x6a6a9a, wear: 'robe', hold: 'book', specs: true },
  priest: { cloth: 0xe4e0d0, wear: 'robe', hat: 'hood', hold: 'censer' },
  king: { cloth: 0x7a2a3a, wear: 'robe', hat: 'crown', hold: 'sceptre' },
  queen: { cloth: 0x5a2a6a, wear: 'robe', hat: 'crown' },
  traveller: { cloth: 0x8a7a5a, wear: 'wrap', hat: 'cap', hold: 'staff', pack: true },
  explorer: { cloth: 0x7a6a4a, wear: 'wrap', hat: 'straw', hold: 'rope', pack: true },
  hunter: { cloth: 0x4a5a3a, wear: 'wrap', hold: 'bow' },
  ranger: { cloth: 0x3f5a3a, wear: 'wrap', hat: 'hood', hold: 'bow' },
  worker: { cloth: 0x8a7a6a, wear: 'wrap', hold: 'pick' },
  healer: { cloth: 0xd0e0d8, wear: 'robe', hold: 'bowl' },
  // Four more the quest table already asks for by name.
  hermit: { cloth: 0x7a7060, wear: 'wrap', hat: 'hood', build: 'old', hold: 'staff' },
  monk: { cloth: 0xd8d0bc, wear: 'robe', hat: 'hood', hold: 'censer' },
  trader: { cloth: 0x9a5a7a, wear: 'robe', hat: 'cap', hold: 'purse' },
  noble: { cloth: 0x4a3a6a, wear: 'robe', hat: 'cap', hold: 'purse' },
  // ---- the three that are armed ----------------------------------------
  guard: { cloth: 0x4a5058, wear: 'tunic', hat: 'helm', hold: 'spear', armed: true },
  soldier: { cloth: 0x3a2a30, wear: 'tunic', hat: 'helm', hold: 'sword', armed: true },
  ninja: { cloth: 0x2a2a34, wear: 'tunic', hat: 'band', hold: 'sword', armed: true },
};
export const ROLE_IDS = Object.keys(ROLES);
/** Who is a civilian. Read by the world when it wants a crowd. */
export const CIVILIAN_ROLES = ROLE_IDS.filter((r) => !ROLES[r].armed);

// ═════════════════════════════════════════════════════════════ geometry ══

/**
 * Merged geometry, cached per body variant.
 *
 * Four pieces per variant, and they are split exactly where the animation
 * needs a joint: the torso bobs, the head turns, the arms swing, the legs
 * stride. Anything that does not move is inside one of those four.
 */
const GEOS = new Map();
function geosFor(buildId) {
  let g = GEOS.get(buildId);
  if (g) return g;
  const B = BUILDS.find((b) => b.id === buildId) || BUILDS[0];
  const w = B.w, h = B.h, ey = B.eye;

  // ---- torso: a pear, wider low than high, with thighs out to the sides --
  const skin = [
    at(S.sphere, 0.30 * w, 0.26 * h, 0.26 * w, 0, 0.50 * h, 0),
    at(S.sphere, 0.26 * w, 0.20 * h, 0.23 * w, 0, 0.68 * h, 0.01),
    // Haunches. A frog's thighs sit out and BACK, which is what gives it the
    // coiled look even standing still.
    at(S.low, 0.15 * w, 0.13 * h, 0.19 * w, -0.24 * w, 0.32 * h, -0.04),
    at(S.low, 0.15 * w, 0.13 * h, 0.19 * w, 0.24 * w, 0.32 * h, -0.04),
    // Shoulders.
    at(S.low, 0.10, 0.09, 0.10, -0.27 * w, 0.62 * h, 0.02),
    at(S.low, 0.10, 0.09, 0.10, 0.27 * w, 0.62 * h, 0.02),
  ];
  const belly = [
    // Pale underside. Kept a little tighter to the torso than it was, so a
    // belt or an apron worn over it still reads as being in front of it.
    at(S.sphere, 0.215 * w, 0.175 * h, 0.15, 0, 0.44 * h, 0.135),
  ];
  // Back markings. Every frog in the world gets the same four; the colour
  // they are drawn in is the only thing that varies, so they read as pattern
  // rather than as damage.
  const spots = [
    at(S.low, 0.07, 0.02, 0.06, -0.13 * w, 0.66 * h, -0.16),
    at(S.low, 0.06, 0.02, 0.05, 0.15 * w, 0.60 * h, -0.17),
    at(S.low, 0.05, 0.02, 0.05, 0.02, 0.72 * h, -0.16),
    at(S.low, 0.06, 0.02, 0.05, -0.06, 0.52 * h, -0.18),
  ];

  // ---- head: wide, flat, and the eyes stand UP off it ------------------
  const head = [
    at(S.sphere, 0.25 * w, 0.155, 0.22, 0, 0, 0),
    // Snout, low and blunt.
    at(S.low, 0.19 * w, 0.11, 0.13, 0, -0.02, 0.17),
    // The mounds the eyes sit on. Without these the eyes look stuck on.
    at(S.low, 0.105 * ey, 0.085 * ey, 0.10 * ey, -0.155 * w, 0.105, 0.015),
    at(S.low, 0.105 * ey, 0.085 * ey, 0.10 * ey, 0.155 * w, 0.105, 0.015),
    // Throat sac, under the jaw.
    at(S.sphere, 0.15 * w, 0.10, 0.12, 0, -0.13, 0.10),
  ];
  const eyeball = [
    at(S.low, 0.085 * ey, 0.085 * ey, 0.085 * ey, -0.155 * w, 0.15, 0.03),
    at(S.low, 0.085 * ey, 0.085 * ey, 0.085 * ey, 0.155 * w, 0.15, 0.03),
  ];
  const pupil = [
    at(S.low, 0.048 * ey, 0.052 * ey, 0.048 * ey, -0.163 * w, 0.155, 0.085),
    at(S.low, 0.048 * ey, 0.052 * ey, 0.048 * ey, 0.163 * w, 0.155, 0.085),
  ];
  // The lids are skin, and they cover the top third of each eye. This is
  // what stops a frog's eyes reading as two golf balls.
  const lid = [
    at(S.low, 0.092 * ey, 0.055 * ey, 0.092 * ey, -0.155 * w, 0.195, 0.02),
    at(S.low, 0.092 * ey, 0.055 * ey, 0.092 * ey, 0.155 * w, 0.195, 0.02),
  ];
  // The mouth runs the whole width of the head, because a frog's does.
  const mouth = [
    at(S.box, 0.30 * w, 0.016, 0.10, 0, -0.055, 0.15),
  ];

  /**
   * A limb, with the hand or foot on the end of it.
   *
   * Built pointing DOWN from its own origin so the group it hangs in can be
   * rotated about x to swing it, and the webbing is what sells it: an arm
   * ending in a splayed fan reads as a frog's, and one ending in a ball reads
   * as a snowman's.
   */
  const arm = [
    at(S.low, 0.062, 0.13, 0.062, 0, -0.11, 0),
    at(S.low, 0.052, 0.09, 0.052, 0, -0.27, 0.01),
    // Webbed hand: a flat fan and three splayed fingers.
    at(S.low, 0.075, 0.022, 0.085, 0, -0.37, 0.03),
    at(S.low, 0.018, 0.016, 0.05, -0.05, -0.375, 0.075),
    at(S.low, 0.018, 0.016, 0.055, 0, -0.377, 0.085),
    at(S.low, 0.018, 0.016, 0.05, 0.05, -0.375, 0.075),
  ];
  const leg = [
    // Shin, angled out at the top the way a squatting frog's is.
    at(S.low, 0.068, 0.13 * B.squat, 0.068, 0, -0.12, 0),
    // The foot is LONGER than the shin. That is a frog.
    at(S.low, 0.085, 0.024, 0.15, 0, -0.24, 0.06),
    at(S.low, 0.022, 0.018, 0.07, -0.055, -0.243, 0.15),
    at(S.low, 0.022, 0.018, 0.075, 0, -0.245, 0.165),
    at(S.low, 0.022, 0.018, 0.07, 0.055, -0.243, 0.15),
  ];

  g = {
    build: B,
    torso: merge(skin),
    belly: merge(belly),
    spots: merge(spots),
    head: merge(head),
    eye: merge(eyeball),
    pupil: merge(pupil),
    lid: merge(lid),
    mouth: merge(mouth),
    arm: merge(arm),
    leg: merge(leg),
  };
  GEOS.set(buildId, g);
  return g;
}

/** Free the merged geometry. Only on the way out of the mode. */
export function disposeCitizenGeos() {
  for (const [, g] of GEOS) {
    for (const k in g) if (g[k] && g[k].dispose) g[k].dispose();
  }
  GEOS.clear();
}

// ════════════════════════════════════════════════════════════ materials ══

const MATS = new Map();
/**
 * One set per (skin, cloth) pair.
 *
 * Keyed on both because the cloth is the role and the skin is the person, and
 * a village where the farmer and the smith share a material is a village
 * where they are wearing the same thing.
 */
function matsFor(skin, cloth) {
  const key = skin + ':' + cloth;
  let m = MATS.get(key);
  if (m) return m;
  const c = new THREE.Color(skin);
  m = {
    skin: new THREE.MeshLambertMaterial({ color: c }),
    dark: new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(0.62) }),
    // A frog's underside is always paler than its back.
    belly: new THREE.MeshLambertMaterial({
      color: c.clone().lerp(new THREE.Color(0xfff4d8), 0.55),
    }),
    eye: new THREE.MeshLambertMaterial({ color: 0xf4d24a }),
    pupil: new THREE.MeshBasicMaterial({ color: 0x0d0d10 }),
    mouth: new THREE.MeshBasicMaterial({ color: 0x2a1c18 }),
    cloth: new THREE.MeshLambertMaterial({ color: cloth }),
    wood: new THREE.MeshLambertMaterial({ color: 0x6b4a2a }),
    metal: new THREE.MeshLambertMaterial({ color: 0xa8b0b8 }),
    straw: new THREE.MeshLambertMaterial({ color: 0xd9c07a }),
    gold: new THREE.MeshLambertMaterial({ color: 0xd9b23a }),
  };
  MATS.set(key, m);
  return m;
}
export function disposeCitizenMats() {
  for (const [, m] of MATS) for (const k in m) m[k].dispose();
  MATS.clear();
}

// ══════════════════════════════════════════════════════════════ citizen ══

/**
 * Model units to world units.
 *
 * The parts are authored around a frog one unit tall. A standing adult in the
 * Croaklands is about 1.6, which puts their eyes level with the player's
 * chest — the right relationship for a country of ordinary people with one
 * ninja walking through it.
 */
const STAND = 1.55;
/** How tall a citizen of this scale actually is, for markers overhead. */
export function citizenHeight(scale = 1) { return 1.12 * STAND * scale; }

const put = (parent, geo, mat, x, y, z, rx) => {
  const o = new THREE.Mesh(geo, mat);
  o.position.set(x || 0, y || 0, z || 0);
  if (rx) o.rotation.x = rx;
  o.castShadow = true;
  parent.add(o);
  return o;
};

export class Citizen {
  /**
   * @param opts { skin, cloth, role, build, scale, rnd }
   *   role   a key of ROLES. Decides what they wear and carry, and is the
   *          only thing that decides whether they are armed.
   *   build  a key of BUILD_IDS, or omitted to take the role's own, or a
   *          random one — so a village is not nine copies of one frog.
   *   rnd    a seeded random, so a settlement rebuilds identically.
   */
  constructor(opts = {}) {
    const rnd = opts.rnd || Math.random;
    const role = ROLES[opts.role] ? opts.role : 'farmer';
    const R = ROLES[role];
    this.role = role;
    this.armed = !!R.armed;

    const buildId = opts.build || R.build
      || BUILD_IDS[Math.floor(rnd() * BUILD_IDS.length)];
    const G = geosFor(BUILD_IDS.includes(buildId) ? buildId : 'round');
    const B = G.build;
    this.buildId = B.id;

    const skin = opts.skin === undefined
      ? SKINS[SKIN_KEYS[Math.floor(rnd() * SKIN_KEYS.length)]] : opts.skin;
    const cloth = opts.cloth === undefined ? R.cloth : opts.cloth;
    const M = matsFor(skin, cloth);
    this.skin = skin;

    this.root = new THREE.Group();
    // An old frog stands lower and a child is smaller; the scale on top of
    // that is the individual.
    //
    // STAND is what turns the model's own units into world units — the parts
    // above are authored around a unit-tall frog because that is the easiest
    // thing to reason about, and an adult citizen has to come up to roughly
    // the player's shoulder or the whole country looks like a toy village.
    const base = B.id === 'young' ? 0.66 : B.id === 'old' ? 0.86 : 1;
    this.scale = STAND * base
      * (opts.scale === undefined ? 0.94 + rnd() * 0.16 : opts.scale);
    this.root.scale.setScalar(this.scale);

    /** Bobs when walking. Everything hangs off it. */
    this.body = new THREE.Group();
    this.root.add(this.body);
    put(this.body, G.torso, M.skin);
    put(this.body, G.belly, M.belly);
    put(this.body, G.spots, M.dark);

    /** Turns to look at you. */
    this.head = new THREE.Group();
    this.head.position.set(0, 0.80 * B.h, 0.02);
    this.body.add(this.head);
    put(this.head, G.head, M.skin);
    put(this.head, G.eye, M.eye);
    this.pupils = put(this.head, G.pupil, M.pupil);
    this.lids = put(this.head, G.lid, M.skin);
    put(this.head, G.mouth, M.mouth);

    this.arms = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * 0.30 * B.w, 0.62 * B.h, 0.02);
      g.rotation.z = sx * 0.22;
      this.body.add(g);
      put(g, G.arm, M.skin);
      this.arms.push({ g, side: sx });
    }
    /**
     * THE LEGS — and the feet reach the ground on every build.
     *
     * The hip is at `0.30 · B.h`, which moves with the build, and the leg
     * geometry's own length does not: its lowest point is a fixed 0.263
     * below its origin. So the taller builds hung in the air — six
     * centimetres on `slim` and eleven on `lanky`, which is four to six per
     * cent of a villager's height and reads as a hover.
     *
     * The scale below is exactly what lands the foot on y 0: the hip height
     * divided by how far the leg actually reaches once the bow-legged tilt
     * has shortened it. Which also means a lanky frog now has genuinely
     * longer legs than a stout one, rather than the same legs and a gap.
     */
    this.legs = [];
    const drop = 0.263 * Math.cos(0.30 * B.squat);
    const legScale = (0.30 * B.h) / drop;
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      // Out to the sides: the bow-legged stance is half the silhouette.
      g.position.set(sx * 0.24 * B.w, 0.30 * B.h, -0.02);
      g.rotation.z = sx * 0.30 * B.squat;
      g.scale.y = legScale;
      this.body.add(g);
      put(g, G.leg, M.skin);
      this.legs.push({ g, side: sx });
    }

    this._wear(R, M, B);
    this._hat(R, M, B);
    this._hold(R, M);
    if (R.pack) this._pack(M, B);
    if (R.specs) this._specs(M, B);

    this.t = rnd() * 8;
    this.stride = 0;
    /** Counts down through a croak — the throat swells and the eyes shut. */
    this.croak = 2 + rnd() * 8;
    this.croakT = 0;
    this.blink = 1 + rnd() * 4;
    this.blinkT = 0;
  }

  /**
   * What they are wearing, and it has to sit ON the frog.
   *
   * Every one of these used to be a box, which read exactly as a box: a
   * farmer with a plank nailed across his middle and a smith wearing a
   * shoebox. They are ellipsoids now, cut from the same shapes as the body
   * and scaled a hair larger than the part they cover, so cloth follows the
   * belly rather than intersecting it.
   */
  _wear(R, M, B) {
    switch (R.wear) {
      case 'apron': {
        // A panel over the front of the belly, curved to it, and a neck strap.
        const a = put(this.body, S.sphere, M.cloth, 0, 0.42 * B.h, 0.10);
        a.scale.set(0.24 * B.w, 0.235 * B.h, 0.22);
        const b = put(this.body, S.sphere, M.cloth, 0, 0.55 * B.h, 0.075);
        b.scale.set(0.15 * B.w, 0.13 * B.h, 0.20);
        put(this.body, S.cyl, M.cloth, 0, 0.60 * B.h, 0.16)
          .scale.set(0.024, 0.20, 0.024);
        break;
      }
      case 'tunic': {
        // A shell over the shoulders and chest, and a belt round the waist.
        const t = put(this.body, S.sphere, M.cloth, 0, 0.56 * B.h, 0);
        t.scale.set(0.285 * B.w, 0.20 * B.h, 0.255 * B.w);
        const belt = put(this.body, S.cyl, M.dark, 0, 0.42 * B.h, 0);
        belt.scale.set(0.315 * B.w, 0.055, 0.30 * B.w);
        break;
      }
      case 'robe': {
        /**
         * ═══ IT FALLS FROM THE SHOULDERS TO THE GROUND ══════════════════
         *
         * `S.cone` is a unit cone centred on its own origin — apex at +y,
         * base at −y — so scaled to 0.62·h it spans ±0.31·h about wherever
         * it is put. It used to be put at y 0.02, which means it ran from
         * −0.29·h to +0.33·h: nearly a third of it BELOW the villager's
         * feet, reaching only as high as their belly, and pointed end up.
         *
         * That reads as a conical straw hat lying on the ground underneath
         * them. Which is precisely what it looked like, on all seven roles
         * that wear a robe — the merchant, the priest, the king, the queen,
         * the monk, the trader and the noble.
         *
         * At 0.31·h it spans 0 to 0.62·h: hem on the ground, narrow end at
         * the shoulders, legs hidden. Which is a robe.
         */
        const r = put(this.body, S.cone, M.cloth, 0, 0.31 * B.h, 0);
        r.scale.set(0.34 * B.w, 0.62 * B.h, 0.32 * B.w);
        const y = put(this.body, S.sphere, M.cloth, 0, 0.58 * B.h, 0);
        y.scale.set(0.27 * B.w, 0.16 * B.h, 0.25 * B.w);
        break;
      }
      case 'wrap': {
        // A sash over one shoulder and a belt. Cloth, not carpentry.
        const belt = put(this.body, S.cyl, M.cloth, 0, 0.40 * B.h, 0);
        belt.scale.set(0.32 * B.w, 0.05, 0.305 * B.w);
        const sash = put(this.body, S.box, M.cloth, 0.07 * B.w, 0.53 * B.h, 0.145);
        sash.scale.set(0.085, 0.30 * B.h, 0.055);
        sash.rotation.z = 0.26;
        break;
      }
      default: break;
    }
  }

  _hat(R, M, B) {
    const h = this.head;
    switch (R.hat) {
      case 'straw': {
        /**
         * A conical straw hat, sitting BEHIND and ABOVE the eyes.
         *
         * The brim was 0.40 — nearly twice the width of the head — which
         * rendered as somebody standing under a parasol. A frog's eyes are on
         * top of its skull, so the hat has to perch behind them and stay
         * narrow enough that you can still see them from the front, which is
         * the whole reason the model is shaped the way it is.
         */
        const brim = put(h, S.cyl, M.straw, 0, 0.27, -0.03);
        brim.scale.set(0.25, 0.022, 0.25);
        const crown = put(h, S.cone, M.straw, 0, 0.28, -0.03);
        crown.scale.set(0.17, 0.15, 0.17);
        break;
      }
      case 'hood':
        put(h, S.sphere, M.cloth, 0, 0.16, -0.03)
          .scale.set(0.29, 0.22, 0.27);
        put(h, S.cone, M.cloth, 0, 0.28, -0.12)
          .scale.set(0.14, 0.22, 0.14);
        break;
      case 'cap':
        put(h, S.sphere, M.cloth, 0, 0.22, 0)
          .scale.set(0.24, 0.11, 0.22);
        break;
      case 'crown': {
        const c = put(h, S.ring, M.gold, 0, 0.30, 0, Math.PI / 2);
        c.scale.set(0.17, 0.17, 0.17);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          put(h, S.cone, M.gold, Math.cos(a) * 0.16, 0.36, Math.sin(a) * 0.16)
            .scale.set(0.035, 0.09, 0.035);
        }
        break;
      }
      case 'helm':
        put(h, S.sphere, M.metal, 0, 0.20, -0.01)
          .scale.set(0.26, 0.15, 0.24);
        put(h, S.box, M.metal, 0, 0.14, 0.19)
          .scale.set(0.06, 0.14, 0.04);
        break;
      case 'band': {
        /**
         * A HEADBAND, BEHIND THE EYES AND ABOVE THEM.
         *
         * It was at y 0.16, which on this skull is level with the eyeballs
         * — a ninja wearing a blindfold. A frog's eyes are on humps on top
         * of its head, so a band goes round the skull BEHIND them: back a
         * little in z, up a little in y, and with two tails trailing off
         * the knot at the back, which is the whole read of the thing.
         */
        put(h, S.box, M.cloth, 0, 0.215, -0.045)
          .scale.set(0.50, 0.055, 0.38);
        for (const sx of [-1, 1]) {
          const tail = put(h, S.box, M.cloth, sx * 0.045, 0.14, -0.20);
          tail.scale.set(0.05, 0.20, 0.03);
          tail.rotation.x = -0.4;
        }
        break;
      }
      default: break;
    }
    void B;
  }

  /**
   * What is in the right hand, hanging from the HAND.
   *
   * Parented to a group at the END of the arm rather than at the shoulder,
   * which is the bug this replaced: a hoe built in shoulder space came out as
   * a pole standing beside the frog with its blade level with their ear, held
   * by nothing at all. Everything below is now positioned relative to the
   * palm, so a staff reaches the ground and a hammer hangs at the hip — and
   * because the group is still a child of the arm, it all swings when they
   * walk.
   */
  _hold(R, M) {
    const hand = new THREE.Group();
    hand.position.set(0, -0.37, 0.03);
    this.arms[1].g.add(hand);
    this.hand = hand;
    /**
     * A shaft gripped a third of the way down and running past the fist.
     *
     * `len` is the whole length. A long tool therefore stands with its head
     * above the hand and its butt near the floor, which is how you hold a
     * hoe; the old version put the grip at the bottom, so the whole tool
     * pointed up into the air.
     */
    const shaft = (len, mat, tilt) => {
      const o = put(hand, S.cyl, mat, 0.02, len * 0.18, 0.02);
      o.scale.set(0.022, len, 0.022);
      o.rotation.x = tilt || 0.05;
      return o;
    };
    switch (R.hold) {
      case 'hoe':
        shaft(0.9, M.wood);
        put(hand, S.box, M.metal, 0.02, 0.42, 0.06).scale.set(0.15, 0.035, 0.10);
        break;
      case 'rod':
        shaft(1.1, M.wood, -0.5);
        break;
      case 'staff':
        shaft(1.0, M.wood);
        put(hand, S.low, M.gold, 0.02, 0.49, 0.02).scale.setScalar(0.045);
        break;
      case 'spear':
        shaft(1.15, M.wood);
        put(hand, S.cone, M.metal, 0.02, 0.65, 0.02).scale.set(0.035, 0.15, 0.035);
        break;
      case 'sword':
        put(hand, S.box, M.metal, 0.03, 0.28, 0.02).scale.set(0.035, 0.5, 0.09);
        put(hand, S.box, M.wood, 0.03, 0.03, 0.02).scale.set(0.07, 0.05, 0.16);
        break;
      case 'bow': {
        const b = put(hand, S.ring, M.wood, 0.03, 0.02, 0.02);
        b.scale.set(0.22, 0.22, 0.05);
        b.rotation.y = Math.PI / 2;
        break;
      }
      case 'hammer':
        shaft(0.5, M.wood);
        put(hand, S.box, M.metal, 0.02, 0.22, 0.02).scale.set(0.07, 0.09, 0.13);
        break;
      case 'pick':
        shaft(0.7, M.wood);
        put(hand, S.box, M.metal, 0.02, 0.33, 0.02).scale.set(0.21, 0.03, 0.04);
        break;
      case 'creel':
        put(hand, S.cyl, M.straw, 0.09, -0.10, 0.01).scale.set(0.11, 0.14, 0.09);
        put(hand, S.box, M.wood, 0.09, -0.01, 0.01).scale.set(0.20, 0.02, 0.16);
        break;
      case 'purse':
        put(hand, S.low, M.cloth, 0.04, -0.06, 0.01).scale.setScalar(0.07);
        put(hand, S.low, M.gold, 0.04, 0.00, 0.01).scale.set(0.03, 0.02, 0.03);
        break;
      case 'ledger':
      case 'book':
        put(hand, S.box, M.cloth, 0.05, -0.02, 0.04).scale.set(0.13, 0.04, 0.17);
        put(hand, S.box, M.belly, 0.05, 0.00, 0.04).scale.set(0.12, 0.02, 0.16);
        break;
      case 'tankard':
        put(hand, S.cyl, M.metal, 0.05, -0.02, 0.02).scale.set(0.055, 0.10, 0.055);
        break;
      case 'loaf':
        put(hand, S.low, M.straw, 0.05, -0.02, 0.02).scale.set(0.07, 0.05, 0.11);
        break;
      case 'bowl':
        put(hand, S.low, M.belly, 0.05, -0.01, 0.02).scale.set(0.09, 0.04, 0.09);
        break;
      case 'censer':
        shaft(0.3, M.metal);
        put(hand, S.low, M.gold, 0.02, -0.14, 0.02).scale.setScalar(0.055);
        break;
      case 'sceptre':
        shaft(0.7, M.gold);
        put(hand, S.low, M.eye, 0.02, 0.34, 0.02).scale.setScalar(0.05);
        break;
      case 'rope': {
        const r = put(hand, S.ring, M.straw, 0.06, -0.04, 0.01);
        r.scale.set(0.09, 0.09, 0.35);
        r.rotation.x = Math.PI / 2;
        break;
      }
      default: break;
    }
  }

  _pack(M, B) {
    put(this.body, S.box, M.wood, 0, 0.58 * B.h, -0.24).scale.set(0.26, 0.28, 0.14);
    put(this.body, S.box, M.cloth, 0, 0.70 * B.h, -0.24).scale.set(0.28, 0.06, 0.16);
  }

  _specs(M, B) {
    for (const sx of [-1, 1]) {
      const r = put(this.head, S.ring, M.metal, sx * 0.155 * B.w, 0.15, 0.10);
      r.scale.set(0.075, 0.075, 0.045);
    }
    put(this.head, S.box, M.metal, 0, 0.15, 0.10).scale.set(0.12, 0.012, 0.012);
  }

  setFacing(yaw) { this.root.rotation.y = yaw + Math.PI; }

  /**
   * @param s { moving, speed, talking }
   *
   * Four behaviours and no more: the stride, the idle breath, the blink, and
   * the croak. The croak is the one worth having — a village where somebody
   * puffs their throat out and shuts their eyes every few seconds feels
   * inhabited in a way that a village of frogs breathing quietly does not.
   */
  update(dt, s) {
    this.t += dt;
    const moving = !!(s && s.moving);
    const sp = (s && s.speed) || 0;
    if (moving) this.stride += dt * (5.5 + Math.min(sp, 6) * 0.9);
    const sw = Math.sin(this.stride);

    this.body.position.y = moving ? Math.abs(sw) * 0.055
      : Math.sin(this.t * 1.7) * 0.014;
    this.body.rotation.x = damp(this.body.rotation.x, moving ? 0.13 : 0.02, 6, dt);

    for (const leg of this.legs) {
      const phase = leg.side > 0 ? sw : -sw;
      leg.g.rotation.x = damp(leg.g.rotation.x, moving ? phase * 0.5 : 0, 14, dt);
    }
    for (const arm of this.arms) {
      const phase = arm.side > 0 ? -sw : sw;
      arm.g.rotation.x = damp(arm.g.rotation.x, moving ? phase * 0.42 : 0.04, 12, dt);
    }

    // The head sweeps slowly when idle and steadies when walking.
    this.head.rotation.y = moving ? damp(this.head.rotation.y, 0, 5, dt)
      : Math.sin(this.t * 0.6) * 0.34;
    this.head.rotation.x = damp(this.head.rotation.x, moving ? -0.10 : 0, 5, dt);

    // ---- the croak -------------------------------------------------------
    this.croak -= dt;
    if (this.croak <= 0 && this.croakT <= 0) {
      this.croak = 4 + Math.random() * 10;
      this.croakT = 0.55;
    }
    if (this.croakT > 0) {
      this.croakT -= dt;
      const k = Math.sin(clamp(1 - this.croakT / 0.55, 0, 1) * Math.PI);
      // The throat is part of the head mesh, so the whole head swells a
      // little rather than the sac alone. At this size that reads correctly
      // and costs one scale assignment instead of a separate mesh.
      this.head.scale.set(1 + k * 0.10, 1 + k * 0.06, 1 + k * 0.12);
      this.lids.position.y = -k * 0.045;
    } else {
      this.head.scale.set(1, 1, 1);
      // ---- the blink -----------------------------------------------------
      this.blink -= dt;
      if (this.blink <= 0) { this.blink = 2 + Math.random() * 5; this.blinkT = 0.14; }
      if (this.blinkT > 0) {
        this.blinkT -= dt;
        this.lids.position.y = lerp(0, -0.05, Math.sin((1 - this.blinkT / 0.14) * Math.PI));
      } else this.lids.position.y = 0;
    }
  }

  /** Geometry and materials are both shared, so a citizen owns nothing. */
  dispose() {}
}

/**
 * A whole crowd's worth of variation from one seed.
 *
 * The point is that a village is not nine of the same frog and not nine
 * random ones either: the roles come from what the place IS, and the bodies
 * and colours come from the seed, so the same village is the same village
 * every time you walk into it.
 */
export function pickCitizen(rnd, roles) {
  const pool = roles && roles.length ? roles : CIVILIAN_ROLES;
  return {
    role: pool[Math.floor(rnd() * pool.length)],
    skin: SKINS[SKIN_KEYS[Math.floor(rnd() * SKIN_KEYS.length)]],
    build: BUILD_IDS[Math.floor(rnd() * BUILD_IDS.length)],
    scale: 0.9 + rnd() * 0.24,
    rnd,
  };
}
