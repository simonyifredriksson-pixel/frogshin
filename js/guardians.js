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

import * as THREE from '../lib/three.module.js?v=v41';

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
    name: 'GROTT, THE GATE-KEEPER',
    body: 'hulk', skin: 0x6f7a3e, dark: 0x4a5228, trim: 0x9a7d33,
    head: 'toad', weapon: 'club', horns: 0, eyes: 0xff5a2c,
    moves: ['slam', 'slam', 'combo'],
    blurb: 'Slow. Enormous. Hits like a falling wall.',
  },
  {
    name: 'SILT, WARDEN OF THE SHALLOWS',
    body: 'lean', skin: 0x4a6b6f, dark: 0x2e4a4e, trim: 0x8fc4c9,
    head: 'eel', weapon: 'spear', horns: 0, eyes: 0x8fe8ff,
    moves: ['leap', 'combo', 'leap'],
    blurb: 'Leaps the whole room and lands on your head.',
  },
  {
    name: 'BRACK, THE THREE-STROKE',
    body: 'lean', skin: 0x7a4a2a, dark: 0x53301a, trim: 0xd9a05a,
    head: 'toad', weapon: 'twin', horns: 2, eyes: 0xffb03c,
    moves: ['combo', 'combo', 'charge'],
    blurb: 'Three strokes, always three, and never a pause between them.',
  },
  {
    name: 'MOSSHIDE, THE PATIENT',
    body: 'hulk', skin: 0x3f5f2c, dark: 0x27401b, trim: 0x8fc44a,
    head: 'mossy', weapon: 'none', horns: 0, eyes: 0xc9ff6b,
    moves: ['spores', 'slam', 'spores'],
    blurb: 'Does not chase. Fills the room instead.',
  },
  {
    name: 'VARN, WHO CAME RUNNING',
    body: 'lean', skin: 0x8a3a2a, dark: 0x5c2318, trim: 0xffb03c,
    head: 'horned', weapon: 'club', horns: 2, eyes: 0xff7a3c,
    moves: ['charge', 'charge', 'combo'],
    blurb: 'Crosses the room before you have finished reading this.',
  },
  {
    name: 'THE QUARRY-HAND',
    body: 'stone', skin: 0x6d6a63, dark: 0x46443f, trim: 0x9a9790,
    head: 'blunt', weapon: 'none', horns: 0, eyes: 0xffd76b,
    moves: ['throw', 'throw', 'shockwave'],
    blurb: 'Never comes close. Never needs to.',
  },
  {
    name: 'OKKA, TWICE-DROWNED',
    body: 'lean', skin: 0x2e4a6b, dark: 0x1b2f46, trim: 0x6fa8d9,
    head: 'eel', weapon: 'twin', horns: 0, eyes: 0x8fd8ff,
    moves: ['blink', 'combo', 'blink', 'volley'],
    blurb: 'Is not where you last saw it.',
  },
  {
    name: 'THE PALE CROAK',
    body: 'wraith', skin: 0xcfc5b4, dark: 0x9a9280, trim: 0xffffff,
    head: 'skull', weapon: 'none', horns: 0, eyes: 0xd8f0ff,
    moves: ['volley', 'ringout', 'volley'],
    blurb: 'Sings, and the room fills with teeth.',
  },
  {
    name: 'HULDR, SPINE OF THE DEEP',
    body: 'hulk', skin: 0x4a3a6b, dark: 0x2e2346, trim: 0xa88fd9,
    head: 'horned', weapon: 'great', horns: 4, eyes: 0xc9a0ff,
    moves: ['spin', 'slam', 'spin', 'combo'],
    blurb: 'Turns, and the turn is the attack.',
  },
  {
    name: 'THE STONE THAT WALKS',
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
    name: 'NIX, LAST OF THE CHOIR',
    body: 'wraith', skin: 0x2a2a44, dark: 0x16162a, trim: 0x6cc2ff,
    head: 'skull', weapon: 'spear', horns: 0, eyes: 0x6cf0ff,
    moves: ['volley', 'blink', 'volley', 'ringout'],
    tune: 0.90,
    blurb: 'Sings three notes. All of them arrive.',
  },
  {
    name: 'GRAVEWATER',
    body: 'hulk', skin: 0x2f4a3a, dark: 0x1b2f24, trim: 0x6fd99a,
    head: 'mossy', weapon: 'none', horns: 0, eyes: 0x8fffc4,
    moves: ['puddle', 'leap', 'puddle', 'combo'],
    tune: 0.88,
    blurb: 'Leaves the floor behind it worse than it found it.',
  },
  {
    name: 'THE HOLLOW KING',
    body: 'wraith', skin: 0x3a2a4a, dark: 0x231830, trim: 0xffd76b,
    head: 'crowned', weapon: 'great', horns: 3, eyes: 0xffd76b,
    moves: ['spin', 'charge', 'volley', 'combo', 'shockwave'],
    tune: 0.86,
    blurb: 'Wore a crown once. Still behaves as though it does.',
  },
  {
    name: 'ZEHL, THE FINAL GUARDIAN',
    body: 'hulk', skin: 0x1f1f2e, dark: 0x101018, trim: 0xff5a3c,
    head: 'crowned', weapon: 'great', horns: 4, eyes: 0xff3c2c,
    moves: ['combo', 'charge', 'shockwave', 'volley', 'spin', 'slam', 'blink'],
    tune: 0.85,
    blurb: 'The last thing between you and the door.',
  },
];

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
