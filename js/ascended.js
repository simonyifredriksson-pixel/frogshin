/**
 * FROGATH, THE ASCENDED — THE DIVINE JUDGMENT.
 *
 * What you fought at the bottom of the dungeon was not his true form. This
 * is. He is winged, enormous, and never touches the ground.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * Every attack draws its danger — a ring, a lane, a marker — for at least
 * CFG.ascended.minWarning seconds before anything can hurt you, and the
 * marker is exactly the size of the hitbox. He is meant to be beaten by
 * mastery: a perfect player can take zero damage. The difficulty is in how
 * MUCH there is to read, how fast it arrives, and how little room is left
 * between the end of one pattern and the start of the next — never in
 * hiding what is about to happen.
 *
 * ── STRUCTURE ──────────────────────────────────────────────────────────────
 * Attacks are PRIMITIVES. Combos are scripted lists of primitives with
 * timings, so every signature sequence is written out literally and a new
 * combo can only ever recombine attacks that already telegraph properly.
 *
 * There are TWO phases and one hard line between them, at half health:
 *
 *   PHASE I   THE DIVINE JUDGMENT   100% → 50%
 *       A god fighting a mortal. Sword, wings, stars, beams, blinks.
 *
 *   ── THE ASCENSION ── a scripted stop. He remembers what he is.
 *
 *   PHASE II  THE DIVINE ASCENSION   50% → 0%
 *       Not a harder version of phase 1 — a different creature. New wings,
 *       a double-ended blade with escorts, floating arena, branching combos
 *       that read what you just did, and the brand: you may not stand still.
 *       Below 10% he stops speaking and the arena starts falling.
 *
 * `esc` (a five-step ladder on health) only ever tightens TIMING. Crossing
 * into phase 2 is the only thing that gives him new tools, so nothing you
 * learn is ever invalidated — it only has to be done faster.
 */

import * as THREE from '../lib/three.module.js?v=v60';
import { CFG } from './config.js?v=v60';
import { clamp, lerp, damp, dampAngle, lookYaw } from './util.js?v=v60';
import { Audio } from './audio.js?v=v60';

const _v = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _to = new THREE.Vector3();
const _col1 = new THREE.Color();
const _col2 = new THREE.Color();

const GOLD = 0xffd76b;
const HOT = 0xfff3c4;
const WHITE = 0xffffff;
const WARN = 0xffb03c;      // move out of it
const WARN_JUMP = 0xffe14a; // ground wave — jump it

/**
 * How far off dead-centre his back is turned during the entrance.
 *
 * A perfectly square back is a flat silhouette, and it also leaves the turn
 * exactly 180° from its target — the one angle where "shortest way round" has
 * no answer, so he could rotate either way from one run to the next. A few
 * degrees of bias fixes both: the pose reads better and the turn is always
 * the same direction.
 */
const BACK_BIAS = 0.20;

const ENTRANCE_LINE =
  '“You were told a god had fallen. You were not told which one.”';

/**
 * THE ASCENSION — the phase-2 cutscene, beat by beat.
 *
 * `[time, kind, payload]`, absolute seconds from the moment he freezes. It is
 * written as data so the pacing can be read at a glance and tuned without
 * touching the code that plays it. `say` is dialogue; the rest are cues the
 * player handles in `_ascension`.
 */
const ASCENSION = [
  [0.00, 'freeze'],                                  // stop dead, drop the sword
  [0.60, 'droop'],                                   // wings hang
  [2.60, 'say', '“...Enough.”'],
  [5.00, 'lookDown'],                                // he studies his own wounds
  [6.20, 'say', '“You have forced me to remember...”'],
  [9.20, 'say', '“...what I am.”'],
  [11.00, 'flicker'],                                // the aura goes unstable
  [12.20, 'crack'],                                  // gold splits open across him
  [13.60, 'shed'],                                   // the old wings come apart
  [15.40, 'erupt'],                                  // the new ones tear out
  [16.60, 'skyOpen'],                                // the sky opens, light pours in
  [17.60, 'say', '“Do you know why the fourteen guardians stood before me?”'],
  [21.20, 'say', '“They were never protecting you from me.”'],
  [24.20, 'whiteEyes'],
  [24.60, 'say', '“They were protecting...”'],
  [27.60, 'say', '“...me from you.”'],
  [29.60, 'shockwave'],                              // the arena goes with him
  [31.40, 'done'],
];

/** The last stand, at 10%. Silence, then a promise. */
const FINAL_SCRIPT = [
  [0.00, 'hush'],
  [1.60, 'raise'],
  [3.00, 'say', '“...One final lesson.”'],
  [6.00, 'whiteEyes'],
  [6.40, 'say', '“Death...”'],
  [8.60, 'say', '“...does not miss twice.”'],
  [11.00, 'begin'],
];

/**
 * Combat barks. He is not chatty — these fire at most one per condition, and
 * never while a scripted beat is playing.
 */
const BARKS = {
  survived: '“...You still stand.”',
  learning: '“You’re learning.”',
  damaged: '“Then learn faster.”',
  quarter: '“You have mistaken survival... for victory.”',
};

// ---------------------------------------------------------------- the model

/**
 * Build the god: an enormous winged frog in gold and white, armoured, with a
 * sword far larger than himself and runes turning around him.
 *
 * Everything that should glow is `MeshBasicMaterial` — he is the light in
 * the room, not something the room lights.
 */
function buildAscended() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const L = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0 });
  const B = (c, o) => new THREE.MeshBasicMaterial({
    color: c, transparent: o !== undefined, opacity: o === undefined ? 1 : o,
    depthWrite: o === undefined,
  });

  const M = {
    skin: L(0xf0d78a, 0x8a6a12),
    skinDark: L(0xc9a44a, 0x5a4208),
    belly: L(0xfff3c4, 0x9a7a1a),
    plate: L(0xfffaf0, 0x9a8a4a),      // divine armour
    plateDark: L(0xd9c98a, 0x6a5a2a),
    rune: B(HOT),
    eye: B(WHITE),
    wing: B(HOT, 0.62),
    wingCore: B(WHITE, 0.9),
    blade: B(HOT, 0.85),
    bladeCore: B(WHITE, 0.95),
    aura: new THREE.MeshBasicMaterial({
      color: GOLD, transparent: true, opacity: 0.12,
      side: THREE.BackSide, depthWrite: false,
    }),
  };

  const G = {
    sphere: new THREE.SphereGeometry(1, 16, 12),
    low: new THREE.SphereGeometry(1, 10, 8),
    box: new THREE.BoxGeometry(1, 1, 1),
    torus: new THREE.TorusGeometry(1, 0.07, 8, 36),
    capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
    cone: new THREE.ConeGeometry(1, 1, 6),
  };

  const put = (geo, mat, sx, sy, sz, px, py, pz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(px || 0, py || 0, pz || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    return m;
  };

  // ---- body ----
  body.add(put(G.sphere, M.skin, 1.5, 1.2, 1.4, 0, 1.5, 0));
  body.add(put(G.sphere, M.belly, 1.15, 0.9, 1.0, 0, 1.3, 0.5));
  // Divine breastplate and shoulder guards.
  body.add(put(G.sphere, M.plate, 1.35, 0.85, 1.1, 0, 1.85, 0.15));
  body.add(put(G.box, M.rune, 0.16, 0.9, 0.1, 0, 1.9, 1.2));
  for (const sx of [-1, 1]) {
    body.add(put(G.low, M.plate, 0.62, 0.42, 0.58, sx * 1.35, 2.15, 0));
    body.add(put(G.cone, M.plateDark, 0.22, 0.5, 0.22, sx * 1.5, 2.7, 0, 0, 0, sx * 0.5));
  }
  body.add(put(G.torus, M.plateDark, 1.5, 1.5, 1.5, 0, 1.0, 0, Math.PI / 2));

  // ---- head ----
  const head = new THREE.Group();
  head.position.set(0, 2.75, 0.3);
  body.add(head);
  head.add(put(G.sphere, M.skin, 1.3, 0.95, 1.2, 0, 0, 0));
  head.add(put(G.box, M.skinDark, 2.2, 0.09, 0.4, 0, -0.3, 0.9));
  // A crown of divine points.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    head.add(put(G.cone, M.plate, 0.10, 0.42 + (i % 3) * 0.16, 0.10,
      Math.cos(a) * 0.92, 0.62, Math.sin(a) * 0.86));
  }
  const eyes = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 0.64, 0.62, 0.34);
    head.add(g);
    g.add(put(G.low, M.skin, 0.5, 0.5, 0.5, 0, 0, 0));
    const glow = put(G.low, M.eye, 0.36, 0.36, 0.36, 0, 0.05, 0.22);
    g.add(glow);
    eyes.push(glow);
  }

  // ---- wings: the centrepiece ----
  // Each is a fan of long feathers on its own pivot, so a flap is a real
  // motion rather than a texture.
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(sx * 1.1, 2.0, -0.6);
    body.add(w);
    const feathers = [];
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const len = 5.5 + Math.sin(t * Math.PI) * 4.5;
      const f = new THREE.Group();
      f.rotation.z = sx * (0.25 + t * 1.05);
      f.rotation.y = sx * (-0.15 - t * 0.30);
      w.add(f);
      f.add(put(G.box, M.wing, 0.42, len, 0.10, sx * len * 0.42, len * 0.30, 0,
        0, 0, sx * -0.55));
      f.add(put(G.box, M.wingCore, 0.14, len * 0.9, 0.13,
        sx * len * 0.42, len * 0.30, 0, 0, 0, sx * -0.55));
      feathers.push(f);
    }
    // The shoulder of the wing, where it meets the armour.
    w.add(put(G.low, M.plate, 0.5, 0.5, 0.42, 0, 0, 0));
    wings.push({ group: w, feathers, side: sx });
  }

  // ---- limbs ----
  const limbs = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 1.35, 1.8, 0.3);
    body.add(arm);
    arm.add(put(G.capsule, M.skin, 0.32, 0.45, 0.32, 0, -0.6, 0));
    arm.add(put(G.low, M.plate, 0.36, 0.26, 0.36, 0, -0.32, 0));
    arm.add(put(G.low, M.skin, 0.36, 0.3, 0.42, 0, -1.25, 0.1));
    limbs.push(arm);
    const leg = new THREE.Group();
    leg.position.set(sx * 0.9, 0.9, -0.1);
    body.add(leg);
    leg.add(put(G.capsule, M.skinDark, 0.45, 0.55, 0.45, 0, -0.65, 0));
    leg.add(put(G.low, M.skin, 0.42, 0.26, 0.66, 0, -1.35, 0.28));
    limbs.push(leg);
  }

  // ---- the sword: far larger than he is ----
  const sword = new THREE.Group();
  sword.add(put(G.box, M.blade, 0.5, 16, 1.5, 0, 8, 0));
  sword.add(put(G.box, M.bladeCore, 0.22, 15.2, 0.7, 0, 7.8, 0));
  sword.add(put(G.cone, M.bladeCore, 0.55, 2.2, 1.5, 0, 17, 0));
  sword.add(put(G.box, M.plate, 3.0, 0.4, 0.4, 0, 0.2, 0));
  sword.add(put(G.box, M.plateDark, 0.3, 1.6, 0.3, 0, -0.8, 0));
  sword.position.set(0, -1.5, 0.3);
  sword.rotation.x = 0.15;
  limbs[0].add(sword);

  // ---- runes orbiting him ----
  const runes = [];
  for (let i = 0; i < 8; i++) {
    const r = put(G.box, M.rune, 0.5, 0.5, 0.12, 0, 0, 0);
    body.add(r);
    runes.push({ mesh: r, a: (i / 8) * Math.PI * 2, r: 4.5 + (i % 3) * 0.8,
      y: 1.2 + (i % 4) * 0.7 });
  }

  const aura = put(G.sphere, M.aura, 5.4, 5.4, 5.4, 0, 1.8, 0);
  body.add(aura);

  // ======================================================================
  // PHASE II. Built now, hidden until the ascension — a god does not wait
  // for geometry to load, and the transition has to be instant on the frame
  // the old wings come apart.
  // ======================================================================

  // ---- the true wings ----
  // Four pairs: one enormous primary pair and three smaller pairs stacked
  // behind it, which is what reads as "celestial" rather than "bigger bird".
  const wings2 = [];
  const WING2 = [
    { count: 11, base: 9.0, span: 8.0, y: 2.2, z: -0.8, tilt: 0.00, w: 0.52 },
    { count: 7, base: 5.5, span: 4.5, y: 3.6, z: -1.4, tilt: 0.55, w: 0.34 },
    { count: 7, base: 5.0, span: 4.0, y: 0.7, z: -1.4, tilt: -0.62, w: 0.34 },
    { count: 5, base: 3.4, span: 2.6, y: 2.2, z: -2.2, tilt: 0.00, w: 0.26 },
  ];
  for (const spec of WING2) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 1.2, spec.y, spec.z);
      w.rotation.x = spec.tilt;
      w.visible = false;
      body.add(w);
      const feathers = [];
      for (let i = 0; i < spec.count; i++) {
        const t = i / (spec.count - 1);
        const len = spec.base + Math.sin(t * Math.PI) * spec.span;
        const f = new THREE.Group();
        f.rotation.z = sx * (0.18 + t * 1.20);
        f.rotation.y = sx * (-0.12 - t * 0.34);
        w.add(f);
        // Sharper than the phase-1 feather: longer, thinner, barbed tip.
        f.add(put(G.box, M.wing, spec.w, len, 0.09, sx * len * 0.44, len * 0.30, 0,
          0, 0, sx * -0.55));
        f.add(put(G.box, M.wingCore, 0.12, len * 0.94, 0.12,
          sx * len * 0.44, len * 0.30, 0, 0, 0, sx * -0.55));
        f.add(put(G.cone, M.wingCore, 0.16, 1.5, 0.16,
          sx * len * 0.86, len * 0.62, 0, 0, 0, sx * -1.05));
        feathers.push(f);
      }
      w.add(put(G.low, M.plate, 0.44, 0.44, 0.38, 0, 0, 0));
      wings2.push({ group: w, feathers, side: sx, tier: WING2.indexOf(spec) });
    }
  }

  // ---- the true blade: double-ended, with escorts ----
  const sword2 = new THREE.Group();
  sword2.visible = false;
  sword2.add(put(G.box, M.blade, 0.62, 30, 1.7, 0, 0, 0));
  sword2.add(put(G.box, M.bladeCore, 0.26, 29, 0.8, 0, 0, 0));
  sword2.add(put(G.cone, M.bladeCore, 0.62, 2.6, 1.7, 0, 15.4, 0));
  sword2.add(put(G.cone, M.bladeCore, 0.62, 2.6, 1.7, 0, -15.4, 0, Math.PI));
  sword2.add(put(G.low, M.plate, 1.1, 0.7, 1.1, 0, 0, 0));
  sword2.add(put(G.torus, M.rune, 2.0, 2.0, 2.0, 0, 0, 0, Math.PI / 2));
  sword2.position.set(0, -1.5, 0.3);
  limbs[0].add(sword2);

  // Six lesser blades that hold formation around him and lead his swings.
  const escorts = [];
  for (let i = 0; i < 6; i++) {
    const e = new THREE.Group();
    e.visible = false;
    e.add(put(G.box, M.blade, 0.3, 7.0, 0.8, 0, 0, 0));
    e.add(put(G.box, M.bladeCore, 0.13, 6.6, 0.34, 0, 0, 0));
    e.add(put(G.cone, M.bladeCore, 0.3, 1.1, 0.8, 0, 3.9, 0));
    body.add(e);
    escorts.push({ mesh: e, a: (i / 6) * Math.PI * 2, r: 7.5, y: 2.0 + (i % 3) * 1.6 });
  }

  // ---- rings turning around him ----
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = put(G.torus, M.rune, 6.5 - i * 1.2, 6.5 - i * 1.2, 6.5 - i * 1.2,
      0, 1.8, 0, Math.PI / 2 + i * 0.5, 0, i * 0.7);
    r.visible = false;
    body.add(r);
    rings.push({ mesh: r, spin: 0.5 + i * 0.35, tilt: i * 0.5 });
  }

  // ---- a second, denser shell of runes ----
  const runes2 = [];
  for (let i = 0; i < 14; i++) {
    const r = put(G.box, M.rune, 0.44, 0.44, 0.1, 0, 0, 0);
    r.visible = false;
    body.add(r);
    runes2.push({ mesh: r, a: (i / 14) * Math.PI * 2, r: 6.5 + (i % 4) * 1.1,
      y: 0.4 + (i % 6) * 0.9 });
  }

  // The outer corona, only lit in phase 2. Its own material, so driving it
  // does not also drive the inner aura.
  M.halo = new THREE.MeshBasicMaterial({
    color: HOT, transparent: true, opacity: 0.10,
    side: THREE.BackSide, depthWrite: false,
  });
  const halo = put(G.sphere, M.halo, 7.5, 7.5, 7.5, 0, 1.8, 0);
  halo.visible = false;
  body.add(halo);

  return {
    root, body, head, eyes, wings, limbs, sword, runes, aura, mats: M,
    wings2, sword2, escorts, rings, runes2, halo,
  };
}

// -------------------------------------------------------------------- boss

const STATE = {
  DORMANT: 'dormant',
  SKY: 'sky',           // the sky cracks, the symbol appears
  DESCEND: 'descend',
  STARE: 'stare',
  ARM: 'arm',           // wings fold, sword appears
  BURST: 'burst',       // wings snap open, shockwave, bar appears
  FIGHT: 'fight',
  ASCENSION: 'ascension', // the 50% cutscene — he remembers what he is
  JUDGMENT: 'judgment', // the 10% silence
  DEAD: 'dead',
};

/**
 * The five scripted combos, written out as they were designed.
 * Each entry is [primitive, delay-before-the-next-step].
 */
const COMBOS = {
  // Vanish, beam from above, trap the escape, dive, turn and strike again.
  skyfall: [
    ['vanishUp', 0.55], ['skyBeam', 1.05], ['starTrap', 0.65],
    ['dive', 0.75], ['turnSlash', 0.5],
  ],
  // Three slashes, teleport behind, wide slash, wing shock, projectiles.
  backbreaker: [
    ['slash', 0.34], ['slash', 0.34], ['slash', 0.42],
    ['blinkBehind', 0.30], ['wideSlash', 0.55],
    ['wingShock', 0.55], ['wingBurst', 0.5],
  ],
  // Mark the whole arena, rain on it, go quiet, then appear in your face.
  reckoning: [
    ['flyHigh', 0.5], ['markArena', 1.5], ['rainMarks', 0.9],
    ['silence', 0.7], ['blinkFront', 0.22], ['slash', 0.26],
    ['slash', 0.26], ['slash', 0.26], ['wideSlash', 0.6],
  ],
  // Charge the sword, sweep the beam around the arena, stars falling in it.
  sweep: [
    ['chargeSword', 1.1], ['sweepBeam', 2.4], ['starRain', 0.6],
  ],
  // Rise out of sight, fill the dark with orbs, then come through the arena.
  eclipse: [
    ['flyVeryHigh', 0.7], ['orbSwarm', 2.0], ['orbRelease', 1.0],
    ['diveThrough', 0.8],
  ],
};

/**
 * PHASE II. The five signature sequences, written out as specified.
 *
 * A step is `[primitive, delay]` as before, or a BRANCH:
 *
 *     ['branch', delay, { air, far, near, clean, hit, else }]
 *
 * A branch reads what the player is doing at that instant and picks the
 * continuation, so the same combo does not play out the same way twice and
 * the correct answer to step 1 is not automatically the correct answer to
 * step 2. `clean` fires when the last resolved marker MISSED you (you dodged
 * it), `hit` when it landed — which is how he punishes both panic dodging
 * and greed without ever removing the tell.
 */
const COMBOS2 = {
  // Gone. A wingbeat behind you. Three slashes, a wave, then the sky.
  divineHunt: [
    ['vanishSoft', 0.75], ['appearBehind', 0.30],
    ['fastSlash', 0.24], ['fastSlash', 0.24], ['waveSlash', 0.55],
    ['branch', 0.30, { clean: 'pinAbove', hit: 'wideSlash' }],
    ['skyLance', 0.85], ['starTrap', 0.55],
    ['branch', 0.25, { air: 'skyPin', else: 'diveThrough' }],
  ],
  // The sky closes over you and then opens exactly where you are standing.
  heavensExecution: [
    ['flyVeryHigh', 0.60], ['wingEclipse', 0.90],
    ['brandCircle', 1.20], ['chargeSword', 1.00],
    ['rotorBeam', 2.90], ['orbHarass', 0.70],
    ['blinkFront', 0.24],
    ['heavySlash', 0.42], ['heavySlash', 0.40], ['heavySlash', 0.46],
    ['detonate', 0.70],
  ],
  // Hundreds of feathers, one gap, and no time to admire it.
  wingsOfJudgment: [
    ['spreadWings', 0.55], ['featherWall', 1.55], ['featherVolley', 0.75],
    ['chargeThrough', 0.60], ['instantTurn', 0.28], ['chargeThrough', 0.55],
    ['wingShock', 0.62],
    ['branch', 0.24, { air: 'skyPin', else: 'turnSlash' }],
  ],
  // He leaves. The sky does the work. Then he comes back through it.
  divineMeteor: [
    ['vanishClouds', 0.85], ['skyGlow', 0.70],
    ['meteorFall', 2.60], ['meteorFall', 1.70],
    ['plummet', 1.00], ['groundQuake', 0.72],
    ['launch', 0.55], ['crossBeam', 0.90],
  ],
  // Silence, a white blade, and three cuts you have to hear coming.
  godsBlade: [
    ['raiseBlade', 0.90], ['hush', 0.80], ['vanishSoft', 0.55],
    ['crossSlash', 0.62], ['crossSlash', 0.50], ['crossSlash', 0.40],
    ['overheadFall', 0.95],
  ],
};

Object.assign(COMBOS, COMBOS2);

/** The phase-2 signature sequences, for tooling and tests. */
export const COMBO_NAMES = Object.keys(COMBOS2);

/** Which combos are available. Phase 1 is unchanged; phase 2 is all new. */
const POOL1 = [
  ['backbreaker', 'sweep', 'skyfall'],
  ['backbreaker', 'skyfall', 'sweep', 'reckoning'],
];
const POOL2 = [
  ['divineHunt', 'wingsOfJudgment', 'heavensExecution'],
  ['divineHunt', 'wingsOfJudgment', 'heavensExecution', 'divineMeteor'],
  ['divineHunt', 'heavensExecution', 'divineMeteor', 'godsBlade', 'wingsOfJudgment'],
];

/**
 * Seconds of rest between combos, and the multiplier on every telegraph,
 * indexed by escalation step. Telegraphs are still floored by minWarning —
 * the gaps close, the tells never disappear.
 */
const REST = CFG.ascended.rest;
const TELE = CFG.ascended.tele;
const ESC = CFG.ascended.esc;

export class Ascended {
  constructor(center, scene, effects, hud, followCam) {
    const A = CFG.ascended;
    this.scene = scene;
    this.effects = effects;
    this.hud = hud;
    this.followCam = followCam;
    this.center = center.clone();

    this.rig = buildAscended();
    this.rig.root.scale.setScalar(A.scale);
    scene.add(this.rig.root);

    this.maxHealth = A.health;
    this.health = this.maxHealth;
    this.phase = 1;

    this.pos = new THREE.Vector3(center.x, center.y + 220, center.z);
    this.yaw = 0;
    this.rig.root.position.copy(this.pos);
    this.rig.root.visible = false;

    this.state = STATE.DORMANT;
    this.t = 0;
    this.bob = 0;
    this.wingOpen = 1;
    this.wingFlap = 0;
    this.auraFlash = 0;
    this.swordCharge = 0;
    this.darkness = 0;

    // Danger that is drawn now and resolves later. One list, so a new attack
    // cannot forget to warn: to hurt the player you must push a marker.
    this.pending = [];
    this.orbs = [];
    this.beams = [];
    this.stars = [];

    this.combo = null;
    this.step = 0;
    this.stepT = 0;
    this.restT = 2.0;
    this.justDied = false;
    this.began = false;
    this.skippable = false;
    this.skipHeld = 0;
    this._lastPos = null;
    this.hidden = false;

    // ---- phase 2 ----
    this.esc = 0;             // escalation step: tightens timing, nothing else
    this.ascended = false;    // has he shed the first form?
    this.wing2Open = 0;       // 0 = the true wings are still furled away
    this.shed = 0;            // 0..1 disintegration of the OLD wings
    this.script = null;       // the beat list currently playing
    this.scriptAt = 0;
    this.scriptI = 0;
    this.onAscend = null;     // the arena listens for this
    this.onFinal = null;
    this.feathers = [];       // shed feathers that seed ground zones
    this.wall = [];           // suspended feather wall, awaiting its volley
    this.pillars = [];        // vertical beams of light, static or orbiting
    this.meteors = [];        // falling rocks, real and otherwise
    this.bladeWhite = 0;
    this.mark = null;         // the brand
    this.markT = CFG.ascended.mark.every;
    this.featherT = 0;
    this.lastCleanDodge = true;
    this.dodgeStreak = 0;
    this._barked = {};
    this._combosSurvived = 0;
    this.eyeWhite = 0;
    this.hushT = 0;           // silence held by godsBlade / the last stand
  }

  get fraction() { return clamp(this.health / this.maxHealth, 0, 1); }
  get alive() { return this.health > 0; }
  get fighting() {
    return this.state === STATE.FIGHT || this.state === STATE.JUDGMENT
      || this.state === STATE.ASCENSION;
  }
  /** True only while he can actually act. The cutscenes are not the fight. */
  get acting() { return this.state === STATE.FIGHT; }
  get inEntrance() {
    return this.state === STATE.SKY || this.state === STATE.DESCEND
      || this.state === STATE.STARE || this.state === STATE.ARM
      || this.state === STATE.BURST;
  }
  /** True while a scripted beat owns the screen — no attacks, no input. */
  get inCutscene() {
    return this.state === STATE.ASCENSION || this.state === STATE.JUDGMENT;
  }
  /** Telegraph length at this escalation, never below the floor. */
  warn(base) {
    return Math.max(CFG.ascended.minWarning, base * (TELE[this.esc] || 1));
  }

  begin(skippable) {
    this.state = STATE.SKY;
    this.t = 0;
    this.skippable = !!skippable;
    this.rig.root.visible = false;
    Audio.stopBossMusic();
    Audio.stopAmbient();
  }

  // -------------------------------------------------------------- damage

  takeDamage(amount) {
    // Invulnerable through his own cutscenes. Letting the player chew
    // through the ascension would erase the one beat the fight is built on.
    if (!this.alive || !this.acting) return false;
    this.health = Math.max(0, this.health - amount);
    _tmp.copy(this.pos).y += 6;
    this.effects.hitBurst(_tmp, { x: 0, y: 0, z: 1 }, amount > 30);

    const A = CFG.ascended;
    const f = this.fraction;

    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this.justDied = true;
      this._clear();
      Audio.stopBossMusic();
      Audio.stopTrack('ascended');
      return true;
    }

    // The one hard line.
    if (!this.ascended && f <= A.ascendAt) { this._beginAscension(); return false; }
    // The last stand.
    if (this.ascended && !this._final && f <= A.finalAt) { this._beginFinal(); return false; }

    // Escalation only tightens timing, so it needs no announcement.
    let step = 0;
    for (let i = ESC.length - 1; i >= 0; i--) { if (f <= ESC[i]) { step = i; break; } }
    if (step > this.esc) this.esc = step;

    this._bark('damaged');
    if (this.ascended && f <= 0.25) this._bark('quarter');
    return false;
  }

  /** 50%. The fight stops and he tells you what you have done. */
  _beginAscension() {
    const A = CFG.ascended;
    this.ascended = true;
    this.phase = 2;
    this.esc = Math.max(this.esc, 2);   // half health is escalation step 2
    this.state = STATE.ASCENSION;
    this.script = ASCENSION;
    this.scriptAt = 0;
    this.scriptI = 0;
    this.t = 0;
    this.combo = null;
    this._clear();
    this.hoverTarget = null;
    this.hud.setBossBar(this.fraction);
    // Total silence. Everything that was playing goes, and nothing replaces
    // it until the cue asks for it.
    Audio.stopBossMusic();
    Audio.stopTrack('ascended');
    Audio.stopTrack('phase1');
    // No fallback: if the cutscene track is missing the beat plays in real
    // silence, which is what it asks for. Substituting boss music here would
    // actively wreck it.
    Audio.playTrack('ascension', { volume: 0.9, fallback: false });
  }

  /** 10%. He stops talking to you and starts finishing it. */
  _beginFinal() {
    const A = CFG.ascended;
    this._final = true;
    this.esc = ESC.length - 1;
    this.state = STATE.JUDGMENT;
    this.script = FINAL_SCRIPT;
    this.scriptAt = 0;
    this.scriptI = 0;
    this.t = 0;
    this.combo = null;
    this._clear();
    this.hud.showBossBar(CFG.ascended.name2, this.fraction, A.finalTitle);
    if (this.onFinal) this.onFinal();
  }

  /** One line, once, and never over a scripted beat. */
  _bark(key) {
    if (!this.acting || this._barked[key] || !BARKS[key]) return;
    if (!this.ascended) return;      // the barks belong to phase 2
    this._barked[key] = true;
    this.hud.setSubtitle(BARKS[key], CFG.ascended.name);
    this._barkT = 3.2;
    Audio.tone({ freq: 90, to: 70, dur: 1.2, type: 'sine', volume: 0.16, pos: this.pos });
  }

  // -------------------------------------------------------------- update

  update(dt, player, camera, onHit) {
    this.t += dt;
    this.bob += dt;
    this._updatePending(dt, player, onHit);
    this._updateStars(dt, player, onHit);
    this._updateOrbs(dt, player, onHit);
    this._updateBeams(dt, player, onHit);
    this._updateFeathers(dt, player, onHit);
    this._updatePillars(dt, player, onHit);
    this._updateMeteors(dt, player, onHit);
    this._updateMark(dt, player, onHit);

    if (this._barkT > 0) {
      this._barkT -= dt;
      if (this._barkT <= 0 && !this.inCutscene) this.hud.setSubtitle('');
    }

    switch (this.state) {
      case STATE.SKY: this._sky(dt, player, camera); break;
      case STATE.DESCEND: this._descend(dt, player, camera); break;
      case STATE.STARE: this._stare(dt, player, camera); break;
      case STATE.ARM: this._arm(dt, player, camera); break;
      case STATE.BURST: this._burst(dt, player, camera); break;
      case STATE.FIGHT: this._fight(dt, player, onHit); break;
      case STATE.ASCENSION: this._ascension(dt, player, camera); break;
      case STATE.JUDGMENT: this._judgment(dt, player); break;
      default: break;
    }
    this._animate(dt, player);
  }

  /**
   * Play a `[time, kind, payload]` script, firing each beat once as the
   * clock passes it. Returns the beat kinds fired this frame.
   */
  _runScript(dt) {
    this.scriptAt += dt;
    const fired = [];
    while (this.scriptI < this.script.length
           && this.script[this.scriptI][0] <= this.scriptAt) {
      const [, kind, payload] = this.script[this.scriptI++];
      if (kind === 'say') {
        this.hud.setSubtitle(payload, CFG.ascended.name);
        Audio.tone({ freq: 86, to: 72, dur: 1.4, type: 'sine', volume: 0.14, pos: this.pos });
      } else fired.push(kind);
    }
    return fired;
  }

  /** Hold Space to skip, once he has killed you at least once. */
  updateSkip(dt, held) {
    if (!this.skippable || !this.inEntrance) return 0;
    this.skipHeld = held ? this.skipHeld + dt : Math.max(0, this.skipHeld - dt * 2);
    if (this.skipHeld >= 0.9) { this._skip(); return 1; }
    return clamp(this.skipHeld / 0.9, 0, 1);
  }

  _skip() {
    const A = CFG.ascended;
    // Nothing left to skip — and this is what takes the prompt off screen,
    // since the burst it drops you into is still part of the entrance.
    this.skippable = false;
    this.skipHeld = 0;
    this.pos.set(this.center.x, this.center.y + A.hoverHeight + 14, this.center.z);
    this.rig.root.visible = true;
    // Skipping lands mid-turn otherwise — the burst is shorter than the turn
    // takes, so he would still be coming round as the fight started. A skip
    // should drop you at the pose the entrance was heading for.
    this.turnToPlayer = true;
    if (this._camAngle !== undefined) {
      this.yaw = this._camAngle + Math.PI;      // already looking at you
      this._yawPosed = true;
    }
    this.wingOpen = 1;
    this.hud.setSubtitle('');
    this.hud.setFade(0, 0.25);
    this.state = STATE.BURST;
    this.t = 0.9;
  }

  // ------------------------------------------------------------ entrance

  /** Darkness, then the sky splits and a divine sigil burns through it. */
  _sky(dt, player, camera) {
    const DUR = 5.0;
    this._cam(camera, player, 30, 0.2);
    this.hud.setFade(clamp(1 - this.t / 1.2, 0, 1) * 0.9, 0);

    if (this.t > 1.2 && !this._crackt) {
      this._crackt = true;
      Audio.tone({ freq: 40, to: 90, dur: 3.0, type: 'sawtooth', volume: 0.22, pos: this.center });
    }
    // Cracks of light spreading across the sky.
    if (this.t > 1.2 && Math.random() < dt * 26) {
      const a = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * 60;
      _tmp.set(this.center.x + Math.cos(a) * r, this.center.y + 90 + Math.random() * 50,
        this.center.z + Math.sin(a) * r);
      this.effects.puff(_tmp, Math.random() < 0.5 ? GOLD : HOT, 3, 3);
    }
    // The sigil: rings of light forming overhead.
    if (this.t > 2.4 && this.t % 0.4 < dt) {
      _tmp.set(this.center.x, this.center.y + 80, this.center.z);
      this.effects.ring(_tmp, 40, 6, 1.4, HOT, true);
    }
    this.followCam.shake(0.15 + clamp((this.t - 2) / 3, 0, 1) * 0.5);

    if (this.t >= DUR) {
      this.state = STATE.DESCEND;
      this.t = 0;
      this.rig.root.visible = true;
      Audio.headshot(this.center);
    }
  }

  /**
   * The descent. Wings fully open, so wide they blot out the sky behind him.
   */
  _descend(dt, player, camera) {
    const A = CFG.ascended;
    const DUR = 9.0;
    const k = clamp(this.t / DUR, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    this.pos.set(this.center.x,
      lerp(this.center.y + 220, this.center.y + A.hoverHeight + 26, e),
      this.center.z);
    this.wingOpen = 1;

    if (Math.random() < 0.95) {
      _tmp.set(this.pos.x + (Math.random() - 0.5) * 60,
        this.pos.y + (Math.random() - 0.5) * 30,
        this.pos.z + (Math.random() - 0.5) * 60);
      this.effects.puff(_tmp, Math.random() < 0.5 ? GOLD : HOT, 3, 2);
    }
    if (this.t % 0.5 < dt) {
      _tmp.copy(this.center);
      this.effects.ring(_tmp, 6, 60, 1.6, GOLD, true);
    }
    this.followCam.shake(0.3 + e * 0.5);
    this._cam(camera, player, lerp(34, 52, e), lerp(0.1, 0.6, e));

    if (k >= 1) { this.state = STATE.STARE; this.t = 0; }
  }

  /** He does not attack. He looks at you. */
  _stare(dt, player, camera) {
    this._cam(camera, player, 52, 0.6);
    this.turnToPlayer = true;
    if (this.t > 1.0 && !this._spoke) {
      this._spoke = true;
      this.hud.setSubtitle(ENTRANCE_LINE, CFG.ascended.name);
      Audio.tone({ freq: 62, to: 48, dur: 2.2, type: 'sawtooth', volume: 0.22, pos: this.pos });
    }
    if (this.t > 5.2) { this.state = STATE.ARM; this.t = 0; this.hud.setSubtitle(''); }
  }

  /** Wings fold; the sword comes into his hand; the arena floods with gold. */
  _arm(dt, player, camera) {
    const DUR = 3.0;
    this._cam(camera, player, 46, 0.5);
    const k = clamp(this.t / DUR, 0, 1);
    this.wingOpen = 1 - k * 0.85;                 // closing behind him
    this.swordShow = k;
    if (this.t > 1.4 && !this._swordIn) {
      this._swordIn = true;
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, WHITE, 40, 14);
      this.effects.ring(_tmp, 1, 26, 0.6, HOT, false, { x: 0, y: 1, z: 0 });
      Audio.slash(this.pos, 2);
    }
    if (k >= 1) { this.state = STATE.BURST; this.t = 0; }
  }

  /** The wings snap open. Everything goes white. The bar appears. */
  _burst(dt, player, camera) {
    const A = CFG.ascended;
    this._cam(camera, player, 44, 0.5);
    this.wingOpen = Math.min(1, this.wingOpen + dt * 6);

    if (!this._burst1) {
      this._burst1 = true;
      this.wingFlap = 1;
      this.hud.setFade(1, 0.1);
      _tmp.copy(this.center);
      this.effects.ring(_tmp, 1, 90, 0.8, WHITE, true);
      this.effects.puff(this.pos, WHITE, 80, 26);
      this.followCam.shake(2.2);
      Audio.headshot(this.pos);
      Audio.death(this.pos);
    }
    if (this.t > 0.35 && !this._burst2) {
      this._burst2 = true;
      this.hud.setFade(0, 0.6);
      this.hud.showBossBar(A.name, 1, A.title);
      Audio.startBossMusic();
    }
    if (this.t > 1.4) {
      this.state = STATE.FIGHT;
      this.t = 0;
      this.restT = 0.8;
      this.hud.announce(CFG.ascended.title, 'danger', false);
      Audio.playTrack('phase1', { loop: true, volume: 0.8 });
    }
  }

  _cam(camera, player, dist, pitch) {
    const a = Math.atan2(player.pos.x - this.center.x, player.pos.z - this.center.z);
    // Remembered so the entrance can pose him relative to the SHOT rather
    // than to the world — see _animate. Without this, which side of him you
    // see is decided by whichever way you happened to walk in from.
    this._camAngle = a;
    camera.position.set(
      this.center.x + Math.sin(a) * dist,
      this.center.y + 3.0,
      this.center.z + Math.cos(a) * dist);
    _v.copy(this.pos);
    _v.y -= lerp(0, 22, 1 - pitch);
    camera.lookAt(_v);
  }

  // ------------------------------------------------------- scripted beats

  /**
   * THE ASCENSION.
   *
   * The fight genuinely stops: no attacks are queued, nothing pending can
   * still be in flight (`_clear` ran on entry), and he takes no damage. The
   * whole beat is driven off ASCENSION so the pacing lives in one table.
   */
  _ascension(dt, player, camera) {
    const A = CFG.ascended;
    this.hoverTarget = null;
    this.turnToPlayer = true;

    for (const beat of this._runScript(dt)) {
      switch (beat) {
        case 'freeze':
          // Sword gone, dead still in the air, camera drifts in.
          this.rig.sword.visible = false;
          this.swingT = 0;
          this.vel = 0;
          this.hud.setCinematic(true);
          this.followCam.shake(0);
          break;
        case 'droop':
          // Wings hang. `wingOpen` drives the spread, so this is one number.
          this._droop = true;
          break;
        case 'lookDown':
          this._lookDown = true;
          Audio.tone({ freq: 60, to: 52, dur: 2.0, type: 'sine', volume: 0.10, pos: this.pos });
          break;
        case 'flicker':
          this._flicker = 1;
          Audio.tone({ freq: 200, to: 90, dur: 1.6, type: 'sawtooth', volume: 0.12, pos: this.pos });
          break;
        case 'crack':
          // Gold splits open along him. Read as cracks, not damage.
          this._cracking = 1;
          this.auraFlash = 1.4;
          for (let i = 0; i < 26; i++) {
            _tmp.set(this.pos.x + (Math.random() - 0.5) * 16,
              this.pos.y + Math.random() * 18 - 2,
              this.pos.z + (Math.random() - 0.5) * 16);
            this.effects.puff(_tmp, HOT, 3, 3);
          }
          Audio.tone({ freq: 340, to: 1200, dur: 1.3, type: 'square', volume: 0.13, pos: this.pos });
          break;
        case 'shed':
          // The old wings come apart. It should read as destruction — the
          // player is meant to think they broke something.
          this.shed = 0.0001;
          Audio.tone({ freq: 900, to: 120, dur: 1.8, type: 'sawtooth', volume: 0.20, pos: this.pos });
          this.followCam.shake(0.8);
          break;
        case 'erupt': {
          // And then the real ones tear out.
          for (const w of this.rig.wings) w.group.visible = false;
          for (const w of this.rig.wings2) w.group.visible = true;
          this.wing2Open = 0.0001;
          this.auraFlash = 3.2;
          this.followCam.shake(2.2);
          _tmp.copy(this.pos);
          this.effects.puff(_tmp, WHITE, 120, 34);
          this.effects.ring(_tmp, 2, 90, 0.9, WHITE, false, { x: 0, y: 1, z: 0 });
          Audio.tone({ freq: 70, to: 220, dur: 1.6, type: 'sawtooth', volume: 0.26, pos: this.pos });
          Audio.headshot(this.pos);
          break;
        }
        case 'skyOpen':
          // The arena is told to change here, not at 'done' — the player
          // should watch it happen while he is still talking.
          this.rig.halo.visible = true;
          for (const r of this.rig.rings) r.mesh.visible = true;
          for (const r of this.rig.runes2) r.mesh.visible = true;
          for (const e of this.rig.escorts) e.mesh.visible = true;
          this.rig.sword.visible = false;
          this.rig.sword2.visible = true;
          if (this.onAscend) this.onAscend();
          Audio.tone({ freq: 120, to: 600, dur: 3.0, type: 'sine', volume: 0.18, pos: this.pos });
          break;
        case 'whiteEyes':
          this.eyeWhite = 1;
          this.rig.mats.eye.color.setHex(WHITE);
          break;
        case 'shockwave': {
          // Everything at once, and the camera gets thrown backwards.
          this.wingFlap = 1;
          this.auraFlash = 4;
          this.followCam.shake(3.2);
          _tmp.copy(this.center);
          this.effects.ring(_tmp, 1, 200, 1.4, WHITE, true);
          this.effects.ring(_tmp, 1, 140, 1.0, HOT, true);
          _tmp.copy(this.pos);
          this.effects.puff(_tmp, WHITE, 150, 46);
          this._pullT = 0;                  // the camera gets thrown back
          if (this.followCam.punchOut) this.followCam.punchOut(26, 1.6);
          Audio.death(this.pos);
          break;
        }
        case 'done': {
          this.hud.setSubtitle('');
          this.hud.setCinematic(false);
          this.hud.showBossBar(A.name2, this.fraction, A.title2);
          this.hud.announce('THE DIVINE ASCENSION', 'danger', false);
          this.state = STATE.FIGHT;
          this.restT = 1.0;
          this.combo = null;
          this._barked = {};          // he has new things to say now
          Audio.stopTrack('ascension');
          Audio.playTrack('ascended', { loop: true, volume: 0.85 });
          break;
        }
        default: break;
      }
    }

    // Camera: drift in close for the speech, then get thrown back hard when
    // the shockwave lands, and stay wide — he does not fit in frame any more.
    const k = clamp(this.scriptAt / 6, 0, 1);
    if (this._pullT !== undefined) this._pullT += dt;
    const pull = this._pullT === undefined ? 0
      : clamp(this._pullT / 1.1, 0, 1);
    this._cam(camera, player, lerp(46, 34, k) + pull * 118, 0.22 + pull * 0.25);
  }

  /**
   * THE LAST STAND, at 10%.
   *
   * He goes quiet. The wings open all the way, the arena starts falling into
   * the dark, and then he fights at the top of his speed with no rest steps
   * at all. Still nothing new — only everything, faster.
   */
  _judgment(dt, player) {
    this.hoverTarget = null;
    this.turnToPlayer = true;
    this.hushT = 1;                      // held silent for the whole beat

    for (const beat of this._runScript(dt)) {
      switch (beat) {
        case 'hush':
          this.hud.setCinematic(true);
          this.hud.clearAnnounce();
          Audio.stopTrack('ascended');
          Audio.stopBossMusic();
          break;
        case 'raise':
          this.wingFlap = 1;
          this.swingT = 0;
          this._raised = true;
          Audio.tone({ freq: 58, to: 44, dur: 2.4, type: 'sawtooth', volume: 0.22, pos: this.pos });
          break;
        case 'whiteEyes':
          this.eyeWhite = 1;
          this.rig.mats.eye.color.setHex(WHITE);
          this.auraFlash = 2.0;
          break;
        case 'begin':
          this.hud.setSubtitle('');
          this.hud.setCinematic(false);
          this.hushT = 0;
          this.auraFlash = 3.5;
          this.wingFlap = 1;
          _tmp.copy(this.pos);
          this.effects.puff(_tmp, WHITE, 130, 38);
          this.effects.ring(this.center, 1, 170, 1.2, WHITE, true);
          this.followCam.shake(3.0);
          this.state = STATE.FIGHT;
          this.restT = 0.2;
          this.combo = null;
          Audio.playTrack('ascended', { loop: true, volume: 1.0 });
          Audio.headshot(this.pos);
          break;
        default: break;
      }
    }

    this.wingOpen = Math.min(1, this.wingOpen + dt * 0.8);
    if (this.scriptAt > 2.0 && this.scriptAt % 0.4 < dt) {
      _tmp.copy(this.center);
      this.effects.ring(_tmp, 2, 60, 1.0, HOT, true);
    }
  }

  // -------------------------------------------------------------- combat

  _fight(dt, player, onHit) {
    this._hover(dt, player);

    // A held silence (God's Blade) ends by bringing the track back, so the
    // pause reads as deliberate rather than as audio dropping out.
    if (this.hushT > 0) {
      this.hushT -= dt;
      if (this.hushT <= 0 && this.ascended && !this._final) {
        Audio.playTrack('ascended', { loop: true, volume: 0.85 });
      }
    }

    if (this.combo) { this._runCombo(dt, player, onHit); return; }
    this.restT -= dt;
    if (this.restT > 0) return;

    // Phase 2 has its own vocabulary. Within a phase, the escalation step
    // widens the pool but never swaps it for a different one.
    const table = this.ascended ? POOL2 : POOL1;
    const pool = table[clamp(this.ascended ? this.esc - 2 : this.esc,
      0, table.length - 1)] || table[0];

    // Never the same combo twice running: repetition is what lets a player
    // stop reading and start pattern-matching one thing.
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick === this._lastCombo && pool.length > 1) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    }
    this._lastCombo = pick;
    this.combo = COMBOS[pick];
    this.step = 0;
    this.stepT = 0;
    this._comboClean = true;      // did they get through it untouched?

    // The brand only exists in phase 2, and only between combos, so it never
    // arrives on top of a pattern you are already mid-way through reading.
    if (this.ascended && !this.mark) {
      this.markT -= 1;
      if (this.markT <= 0) { this.markT = CFG.ascended.mark.every; this._brand(player); }
    }
  }

  /** Start a named combo now. Used by the dev menu and the test harness. */
  forceCombo(name) {
    if (!COMBOS[name]) return false;
    this.combo = COMBOS[name];
    this._lastCombo = name;
    this.step = 0;
    this.stepT = 0;
    this._comboClean = true;
    return true;
  }

  _runCombo(dt, player, onHit) {
    this.stepT -= dt;
    if (this.stepT > 0) return;
    if (this.step >= this.combo.length) {
      this.combo = null;
      this.restT = REST[this.esc] || 0.8;
      this._combosSurvived++;
      if (this._comboClean && this._combosSurvived >= 2) this._bark('survived');
      return;
    }
    let [move, delay, opts] = this.combo[this.step++];
    if (move === 'branch') move = this._branch(opts, player);
    if (move) this._doMove(move, player);
    // Escalation compresses the gaps between the steps of a combo.
    this.stepT = delay * (TELE[this.esc] || 1);
  }

  /**
   * Pick a continuation from what the player is doing RIGHT NOW.
   *
   * This is the whole "the boss feels intelligent" mechanism, and it is
   * deliberately made of readable rules rather than randomness: jumping is
   * always answered from above, running away is always answered at range,
   * and a clean dodge is always answered with the follow-up. Learnable, but
   * it means no single habit survives the fight.
   */
  _branch(opts, player) {
    if (!opts) return null;
    const o = opts;
    const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const airborne = player.grounded === false
      || player.pos.y > this.center.y + 2.2;
    if (o.air && airborne) return o.air;
    if (o.far && d > 30) return o.far;
    if (o.near && d < 12) return o.near;
    if (o.clean && this.lastCleanDodge) return o.clean;
    if (o.hit && !this.lastCleanDodge) return o.hit;
    return o.else || null;
  }

  // ------------------------------------------------------------ movement

  _hover(dt, player) {
    const A = CFG.ascended;
    const want = lookYaw(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
    this.yaw = dampAngle(this.yaw, want, 5, dt);

    if (this.hoverTarget) {
      _to.copy(this.hoverTarget).sub(this.pos);
      const d = _to.length();
      if (d > 1) {
        _to.multiplyScalar(1 / d);
        const sp = [16, 22, 30, 40, 48][this.phase - 1] || 24;
        this.pos.addScaledVector(_to, Math.min(sp, d * 4) * dt);
      } else this.hoverTarget = null;
    }
    const minY = this.center.y + A.hoverHeight;
    if (this.pos.y < minY) this.pos.y = damp(this.pos.y, minY, 7, dt);
  }

  _moveTo(x, y, z) { this.hoverTarget = new THREE.Vector3(x, y, z); }

  _blinkTo(x, y, z) {
    _tmp.copy(this.pos);
    this.effects.puff(_tmp, GOLD, 24, 12);
    this.pos.set(x, y, z);
    this.hoverTarget = null;
    _tmp.copy(this.pos);
    this.effects.puff(_tmp, HOT, 24, 12);
    Audio.dash(this.pos);
    this.followCam.shake(0.35);
  }

  // ------------------------------------------------------------- warning

  /**
   * The ONLY way anything in this fight deals damage.
   *
   * Push a marker with a delay; it is drawn immediately and resolves when
   * the delay expires. Nothing else calls onHit, so no attack can exist
   * without first showing where it will land.
   */
  _mark(x, z, radius, delay, dmg, opts) {
    const o = opts || {};
    const col = o.jump ? WARN_JUMP : (o.col || WARN);
    _tmp.set(x, this.center.y + 0.1, z);
    if (o.lane) {
      // A lane marker: several rings along a line.
      for (let i = 0; i <= o.lane.steps; i++) {
        const t = i / o.lane.steps;
        _tmp.set(x + o.lane.dx * t * o.lane.len, this.center.y + 0.1,
          z + o.lane.dz * t * o.lane.len);
        this.effects.ring(_tmp, radius, radius, delay, col, true);
      }
    } else {
      this.effects.ring(_tmp, radius * (o.grow ? 1 : 5), radius, delay, col, true);
    }
    this.pending.push({
      x, z, r: radius, t: delay, dmg, jump: !!o.jump,
      lane: o.lane || null, fx: o.fx || 'burst', col,
    });
    if (o.sound !== false) {
      Audio.tone({
        freq: o.jump ? 120 : 220, to: o.jump ? 260 : 520,
        dur: Math.max(0.12, delay), type: 'sawtooth', volume: 0.10, pos: this.pos,
      });
    }
  }

  _updatePending(dt, player, onHit) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t > 0) continue;

      _tmp.set(p.x, this.center.y + 0.5, p.z);
      // Ground waves are cleared by being off the floor.
      const airborne = player.grounded === false
        || player.pos.y > this.center.y + 1.2;
      let hit = false;
      if (p.lane) {
        // Distance to the lane's centre line.
        const px = player.pos.x - p.x, pz = player.pos.z - p.z;
        const along = px * p.lane.dx + pz * p.lane.dz;
        const side = Math.abs(px * p.lane.dz - pz * p.lane.dx);
        hit = along > -p.r && along < p.lane.len * 1.05 && side < p.r;
      } else {
        hit = Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < p.r;
      }
      const landed = hit && !(p.jump && airborne);
      if (landed) onHit(p.dmg, _tmp);

      // Every resolved marker is a verdict on the player's last decision,
      // and the branch system and the barks both read it from here — so it
      // is recorded in exactly one place.
      this.lastCleanDodge = !landed;
      if (landed) {
        this._comboClean = false;
        this.dodgeStreak = 0;
      } else {
        this.dodgeStreak++;
        if (this.dodgeStreak >= 8) this._bark('learning');
      }

      if (p.fx === 'slash') {
        this.effects.slashArc(_tmp, this.yaw, 2, HOT, p.r);
        this.effects.ring(_tmp, 0.5, p.r, 0.25, HOT, true);
      } else {
        this.effects.puff(_tmp, p.col, 14, 7);
        this.effects.ring(_tmp, 0.5, p.r, 0.3, p.col, true);
      }
      this.followCam.shake(0.25);
      this.pending.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ primitives

  _doMove(move, player) {
    const A = CFG.ascended;
    const P = player.pos;
    switch (move) {
      // ---- positioning ----
      case 'vanishUp':
        this._blinkTo(P.x, this.center.y + 40, P.z);
        this.rig.root.visible = false;
        this.hidden = true;
        break;
      case 'flyHigh':
        this._moveTo(this.center.x, this.center.y + 34, this.center.z);
        this.wingFlap = 1;
        break;
      case 'flyVeryHigh':
        this._moveTo(this.center.x, this.center.y + 60, this.center.z);
        this.wingFlap = 1;
        break;
      case 'blinkBehind': {
        const m = Math.hypot(player.vel.x, player.vel.z);
        const bx = m > 1 ? -player.vel.x / m : Math.sin(this.yaw);
        const bz = m > 1 ? -player.vel.z / m : Math.cos(this.yaw);
        this._blinkTo(P.x + bx * 9, this.center.y + 4, P.z + bz * 9);
        break;
      }
      case 'blinkFront':
        this._blinkTo(P.x + Math.sin(this.yaw) * 9, this.center.y + 4,
          P.z + Math.cos(this.yaw) * 9);
        break;
      case 'silence':
        // A real pause. It is a fake opening: greed here is punished by the
        // step that follows, and it is always the same length, so it can be
        // learned rather than guessed.
        this.hidden = false;
        this.rig.root.visible = true;
        break;

      // ---- sword ----
      case 'slash':
        this._toPlayerRange(player, 9);
        this._mark(P.x, P.z, 12, this.warn(0.46), A.swordDamage, { fx: 'slash' });
        this.swingT = 0.26;
        break;
      case 'wideSlash':
        this._mark(this.pos.x, this.pos.z, 22, this.warn(0.62), A.swordDamage,
          { fx: 'slash' });
        this.swingT = 0.34;
        break;
      case 'turnSlash':
        this._toPlayerRange(player, 8);
        this._mark(P.x, P.z, 14, this.warn(0.40), A.swordDamage, { fx: 'slash' });
        this.swingT = 0.26;
        break;
      case 'chargeSword':
        this.swordCharge = 1;
        this.auraFlash = 1.2;
        Audio.tone({ freq: 140, to: 900, dur: 1.1, type: 'sawtooth', volume: 0.18, pos: this.pos });
        break;

      // ---- wings ----
      case 'wingShock':
        this.wingFlap = 1;
        // A ground wave: jumpable, and drawn in amber to say so.
        this._mark(this.pos.x, this.pos.z, 26, this.warn(0.7), A.shockDamage,
          { jump: true });
        break;
      case 'wingBurst': {
        this.wingFlap = 1;
        const n = 6 + this.phase * 2;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + this.t;
          this._spawnOrb(Math.sin(a), Math.cos(a), 26, A.orbDamage, 0);
        }
        break;
      }

      // ---- sky ----
      case 'skyBeam':
        this._beam(P.x, P.z, this.warn(0.85), 0);
        break;
      case 'sweepBeam':
        this._beam(P.x, P.z, this.warn(0.9), (Math.random() < 0.5 ? -1 : 1) * 0.75);
        this.swordCharge = 0;
        break;
      case 'starTrap':
        // Stars into the places you are being pushed toward, not where you
        // are — dodging the beam has to cost something.
        this._stars(player, 6 + this.phase, true);
        break;
      case 'starRain':
        this._stars(player, 8 + this.phase * 2, this.phase >= 2);
        break;
      case 'markArena': {
        // The whole floor gets circles. They land in waves, not at once.
        const n = 14 + this.phase * 4;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * (A.arenaRadius - 6);
          this._mark(this.center.x + Math.cos(a) * r, this.center.z + Math.sin(a) * r,
            6, this.warn(1.4) + (i % 5) * 0.22, A.starDamage, { sound: false });
        }
        Audio.tone({ freq: 300, to: 900, dur: 0.8, type: 'sine', volume: 0.12, pos: this.pos });
        break;
      }
      case 'rainMarks':
        this._stars(player, 6 + this.phase * 2, true);
        break;

      // ---- dives ----
      case 'dive':
      case 'diveThrough': {
        this.hidden = false;
        this.rig.root.visible = true;
        const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const len = move === 'diveThrough' ? A.arenaRadius * 2 : 34;
        this._mark(this.pos.x, this.pos.z, 7, this.warn(0.75), A.diveDamage, {
          lane: { dx: dx / d, dz: dz / d, len, steps: 10 },
        });
        this.diveTo = new THREE.Vector3(
          this.pos.x + (dx / d) * len, this.center.y + 3, this.pos.z + (dz / d) * len);
        this.diveT = this.warn(0.75);
        this.wingFlap = 1;
        break;
      }

      // ---- the eclipse ----
      case 'orbSwarm':
        this.darkness = 1;
        this.swarm = [];
        for (let i = 0; i < 16 + this.phase * 6; i++) {
          const a = (i / 20) * Math.PI * 2;
          const r = 8 + (i % 4) * 3;
          this.swarm.push({
            x: this.pos.x + Math.cos(a) * r, y: this.pos.y + (i % 5) * 2 - 4,
            z: this.pos.z + Math.sin(a) * r,
            kind: i % 3,       // 0 straight, 1 delayed, 2 tracking
          });
        }
        Audio.tone({ freq: 200, to: 1400, dur: 1.8, type: 'sine', volume: 0.14, pos: this.pos });
        break;
      case 'orbRelease': {
        this.darkness = 0;
        for (let i = 0; i < (this.swarm || []).length; i++) {
          const s = this.swarm[i];
          const tx = s.kind === 2 ? P.x + player.vel.x * 0.5 : P.x;
          const tz = s.kind === 2 ? P.z + player.vel.z * 0.5 : P.z;
          const dx = tx - s.x, dz = tz - s.z;
          const d = Math.hypot(dx, dz) || 1;
          this._spawnOrb(dx / d, dz / d, 24 + s.kind * 6, A.orbDamage,
            s.kind === 1 ? 0.5 + (i % 4) * 0.25 : 0, s);
        }
        this.swarm = [];
        break;
      }

      // ==================================================================
      // PHASE II
      // ==================================================================

      // ---- positioning ----
      case 'vanishSoft':
        // Gone — but you get the wingbeat. The sound IS the telegraph, and
        // it is directional, so the answer is to turn toward it.
        this.rig.root.visible = false;
        this.hidden = true;
        Audio.tone({ freq: 240, to: 90, dur: 0.5, type: 'triangle', volume: 0.13, pos: this.pos });
        break;
      case 'appearBehind': {
        // Behind where you are FACING, not behind your velocity — running in
        // a straight line does not make you safe.
        const yaw = player.yaw !== undefined ? player.yaw : this.yaw;
        this._blinkTo(P.x - Math.sin(yaw) * 10, this.center.y + 4.5,
          P.z - Math.cos(yaw) * 10);
        this.hidden = false;
        this.rig.root.visible = true;
        this.wingFlap = 1;
        break;
      }
      case 'instantTurn':
        // He does not arc around. He is simply facing you again.
        this.yaw = lookYaw(this.pos.x, this.pos.z, P.x, P.z);
        this.effects.puff(this.pos, HOT, 12, 8);
        break;
      case 'vanishClouds':
        this._moveTo(this.center.x, this.center.y + 90, this.center.z);
        this.rig.root.visible = false;
        this.hidden = true;
        this.wingFlap = 1;
        break;
      case 'launch':
        this._moveTo(this.center.x, this.center.y + 46, this.center.z);
        this.wingFlap = 1;
        break;
      case 'pinAbove':
        this._blinkTo(P.x, this.center.y + 30, P.z);
        this.swordCharge = 1;
        break;

      // ---- sword ----
      case 'fastSlash':
        this._toPlayerRange(player, 8.5);
        this._mark(P.x, P.z, 12, this.warn(0.34), A.swordDamage, { fx: 'slash' });
        this.swingT = 0.20;
        break;
      case 'heavySlash':
        this._toPlayerRange(player, 9.5);
        this._mark(P.x, P.z, 16, this.warn(0.52), A.swordDamage * 1.15, { fx: 'slash' });
        this.swingT = 0.32;
        break;
      case 'waveSlash': {
        // The third cut leaves the sword: a wave that keeps going.
        this._mark(P.x, P.z, 13, this.warn(0.40), A.swordDamage, { fx: 'slash' });
        const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        this._mark(this.pos.x, this.pos.z, 6.5, this.warn(0.62), A.shockDamage, {
          lane: { dx: dx / d, dz: dz / d, len: A.arenaRadius * 1.8, steps: 12 },
        });
        this.swingT = 0.34;
        break;
      }
      case 'raiseBlade':
        // Sword up, blade to white. This is the tell for the whole combo.
        this.swordCharge = 1;
        this.bladeWhite = 1;
        this.swingT = 0;
        this._raised = true;
        Audio.tone({ freq: 300, to: 1800, dur: 0.9, type: 'sine', volume: 0.16, pos: this.pos });
        break;
      case 'hush':
        // Everything drops out. A held silence is a real mechanic here: it
        // is always the same length, so it can be counted.
        this.hushT = 1.4;
        Audio.stopTrack('ascended');
        break;
      case 'crossSlash': {
        // He is across the arena and the cut is already on its way. Fast, but
        // the lane is on the floor before the blade is.
        const a = Math.atan2(P.x - this.center.x, P.z - this.center.z)
          + (Math.random() - 0.5) * 1.2;
        const R = A.arenaRadius + 6;
        this._blinkTo(this.center.x + Math.sin(a) * R, this.center.y + 4,
          this.center.z + Math.cos(a) * R);
        this.hidden = false;
        this.rig.root.visible = true;
        const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        this._mark(this.pos.x, this.pos.z, 7.5, this.warn(0.46), A.swordDamage * 1.2, {
          lane: { dx: dx / d, dz: dz / d, len: R * 2.2, steps: 14 }, fx: 'slash',
        });
        this.diveTo = new THREE.Vector3(
          this.pos.x + (dx / d) * R * 2.2, this.center.y + 4, this.pos.z + (dz / d) * R * 2.2);
        this.diveT = this.warn(0.46);
        this.swingT = 0.22;
        Audio.tone({ freq: 1600, to: 400, dur: 0.3, type: 'square', volume: 0.18, pos: this.pos });
        break;
      }
      case 'overheadFall':
        // Directly above you, straight down. Tight, and the last beat of the
        // combo — so the answer is a late dodge, not an early one.
        this._blinkTo(P.x, this.center.y + 24, P.z);
        this._mark(P.x, P.z, 11, this.warn(0.60), A.diveDamage, { fx: 'slash' });
        this.diveTo = new THREE.Vector3(P.x, this.center.y + 3, P.z);
        this.diveT = this.warn(0.60);
        this.bladeWhite = 1;
        this.swingT = 0.4;
        break;
      case 'detonate':
        // The end of Heaven's Execution: everything he was holding, at once.
        this._mark(this.pos.x, this.pos.z, 30, this.warn(0.85), A.swordDamage * 1.3,
          { grow: true });
        this.auraFlash = 2.6;
        this.followCam.shake(1.6);
        Audio.tone({ freq: 90, to: 40, dur: 1.2, type: 'sawtooth', volume: 0.24, pos: this.pos });
        break;

      // ---- wings ----
      case 'spreadWings':
        this.wingOpen = 1;
        this.wingFlap = 1;
        this.auraFlash = 1.2;
        break;
      case 'wingEclipse':
        // The wings close over the arena. Darkness is a telegraph too: it
        // means the next thing comes from directly overhead.
        this.darkness = 1;
        this.wingOpen = 1;
        Audio.tone({ freq: 160, to: 60, dur: 1.4, type: 'sine', volume: 0.18, pos: this.pos });
        break;
      case 'featherWall': {
        // Hundreds of feathers hang around you, with ONE inert arc. The gap
        // is shown by what is NOT glowing, and it is wide enough to run to.
        this._clearWall();
        const n = 40;
        const gapStart = Math.random() * Math.PI * 2;
        const gapWide = 1.15;                       // radians of safety
        const R = 30;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          let da = a - gapStart;
          while (da < -Math.PI) da += Math.PI * 2;
          while (da > Math.PI) da -= Math.PI * 2;
          if (Math.abs(da) < gapWide * 0.5) continue;   // the corridor
          const mesh = new THREE.Mesh(
            new THREE.ConeGeometry(0.34, 3.4, 5),
            new THREE.MeshBasicMaterial({ color: HOT })
          );
          const x = P.x + Math.cos(a) * R;
          const z = P.z + Math.sin(a) * R;
          mesh.position.set(x, this.center.y + 3.5 + (i % 3) * 2.2, z);
          mesh.rotation.z = Math.PI / 2;
          mesh.rotation.y = -a;
          this.scene.add(mesh);
          this.wall.push({ mesh, x, z, y: mesh.position.y });
        }
        Audio.tone({ freq: 700, to: 1500, dur: 1.2, type: 'sine', volume: 0.12, pos: this.pos });
        break;
      }
      case 'featherVolley': {
        for (const f of this.wall) {
          const dx = P.x - f.x, dz = P.z - f.z;
          const d = Math.hypot(dx, dz) || 1;
          this._spawnOrb(dx / d, dz / d, 34, A.featherDamage, 0,
            { x: f.x, y: f.y, z: f.z });
          this.scene.remove(f.mesh);
          f.mesh.geometry.dispose(); f.mesh.material.dispose();
        }
        this.wall.length = 0;
        this.followCam.shake(0.8);
        Audio.tone({ freq: 1400, to: 500, dur: 0.5, type: 'sawtooth', volume: 0.18, pos: this.pos });
        break;
      }

      // ---- charges ----
      case 'chargeThrough': {
        this.hidden = false;
        this.rig.root.visible = true;
        const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const len = A.arenaRadius * 2;
        this._mark(this.pos.x, this.pos.z, 7, this.warn(0.52), A.diveDamage, {
          lane: { dx: dx / d, dz: dz / d, len, steps: 12 }, fx: 'slash',
        });
        this.diveTo = new THREE.Vector3(
          this.pos.x + (dx / d) * len, this.center.y + 4, this.pos.z + (dz / d) * len);
        this.diveT = this.warn(0.52);
        this.wingFlap = 1;
        this.swingT = 0.3;
        break;
      }
      case 'plummet':
        // Out of the clouds, onto your head.
        this.hidden = false;
        this.rig.root.visible = true;
        this.pos.set(P.x, this.center.y + 70, P.z);
        this._mark(P.x, P.z, 13, this.warn(0.90), A.diveDamage, { grow: true });
        this.diveTo = new THREE.Vector3(P.x, this.center.y + 2.5, P.z);
        this.diveT = this.warn(0.90);
        break;
      case 'groundQuake':
        // Ground wave. Amber, therefore jumpable — the one attack in the
        // fight that cannot be outrun, only cleared.
        this.wingFlap = 1;
        this._mark(this.pos.x, this.pos.z, A.arenaRadius * 1.1, this.warn(0.80),
          A.shockDamage, { jump: true, grow: true });
        this.followCam.shake(1.4);
        break;

      // ---- sky ----
      case 'skyGlow':
        this.darkness = 0.6;
        Audio.tone({ freq: 200, to: 900, dur: 1.6, type: 'sine', volume: 0.14, pos: this.pos });
        break;
      case 'skyLance':
        // One enormous column where you are standing.
        this._pillar({ x: P.x, z: P.z, r: 12, warn: this.warn(0.85), life: 1.1,
          dmg: A.beamDamage });
        this.swordCharge = 1;
        break;
      case 'skyPin':
        // The answer to a jump: it lands where you will.
        this._pillar({
          x: P.x + player.vel.x * 0.35, z: P.z + player.vel.z * 0.35,
          r: 10, warn: this.warn(0.55), life: 0.8, dmg: A.beamDamage * 0.8,
        });
        break;
      case 'rotorBeam':
        // The downward beam that will not stay still, and speeds up.
        this._pillar({
          x: P.x, z: P.z, r: 11, warn: this.warn(1.0), life: 2.9,
          dmg: A.beamDamage, orbit: (Math.random() < 0.5 ? -1 : 1) * 0.55, accel: 0.42,
        });
        this.swordCharge = 0;
        break;
      case 'crossBeam':
        this._beam(P.x, P.z, this.warn(0.9), (Math.random() < 0.5 ? -1 : 1) * 0.5);
        break;
      case 'brandCircle':
        this._brand(player);
        break;
      case 'orbHarass': {
        // Fired while you are already busy escaping the beam, so they are
        // slow, few, and come from a single readable direction.
        const n = 5;
        const base = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.22;
          this._spawnOrb(Math.sin(a), Math.cos(a), 20, A.orbDamage,
            i * 0.16);
        }
        break;
      }
      case 'meteorFall': {
        // Some explode, some leave a burning circle, and some are decoys.
        // The decoys carry NO ground marker, which is the whole lesson of
        // this combo: read the floor, not the sky.
        const n = 7 + this.esc;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const rr = Math.random() * (A.arenaRadius - 8);
          const x = this.center.x + Math.cos(a) * rr;
          const z = this.center.z + Math.sin(a) * rr;
          const kind = i % 3;                     // 0 burst, 1 lingering, 2 fake
          const delay = this.warn(1.1) + i * 0.20;
          this._meteor(x, z, delay, kind);
        }
        Audio.tone({ freq: 120, to: 420, dur: 1.6, type: 'sawtooth', volume: 0.16, pos: this.pos });
        break;
      }

      default: break;
    }
  }

  /** Close to a set distance from the player, staying airborne. */
  _toPlayerRange(player, dist) {
    const a = Math.atan2(this.pos.x - player.pos.x, this.pos.z - player.pos.z);
    this.pos.set(player.pos.x + Math.sin(a) * dist, this.center.y + 4.5,
      player.pos.z + Math.cos(a) * dist);
    this.hoverTarget = null;
  }

  // ---- stars ----

  _stars(player, count, predictive) {
    const A = CFG.ascended;
    const w = this.warn(0.95);
    for (let i = 0; i < count; i++) {
      let tx, tz;
      if (predictive && i % 2 === 1) {
        const lead = 0.4 + Math.random() * 0.6;
        tx = player.pos.x + player.vel.x * lead;
        tz = player.pos.z + player.vel.z * lead;
      } else {
        const a = Math.random() * Math.PI * 2;
        const s = 3 + i * 1.5;
        tx = player.pos.x + Math.cos(a) * Math.random() * s;
        tz = player.pos.z + Math.sin(a) * Math.random() * s;
      }
      const dx = tx - this.center.x, dz = tz - this.center.z;
      const d = Math.hypot(dx, dz);
      if (d > A.arenaRadius - 3) {
        const k = (A.arenaRadius - 3) / d;
        tx = this.center.x + dx * k; tz = this.center.z + dz * k;
      }
      const delay = w + i * 0.05;
      this._mark(tx, tz, 5, delay, A.starDamage, { sound: false });
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.3, 0),
        new THREE.MeshBasicMaterial({ color: HOT })
      );
      mesh.position.set(tx, this.center.y + 80, tz);
      this.scene.add(mesh);
      this.stars.push({ mesh, x: tx, z: tz, t: 0, delay });
    }
    Audio.tone({ freq: 800, to: 1500, dur: 0.4, type: 'sine', volume: 0.09, pos: this.pos });
  }

  _updateStars(dt) {
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.t += dt;
      const k = clamp(s.t / s.delay, 0, 1);
      s.mesh.position.y = lerp(this.center.y + 80, this.center.y + 1.4, k * k);
      s.mesh.rotation.x += dt * 7;
      s.mesh.rotation.y += dt * 5;
      if (s.t < s.delay) continue;
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      this.stars.splice(i, 1);
    }
  }

  // ---- orbs ----

  _spawnOrb(dx, dz, speed, dmg, delay, from) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.75, 0),
      new THREE.MeshBasicMaterial({ color: HOT })
    );
    const sx = from ? from.x : this.pos.x;
    const sy = from ? from.y : this.pos.y;
    const sz = from ? from.z : this.pos.z;
    mesh.position.set(sx, sy, sz);
    this.scene.add(mesh);
    this.orbs.push({ mesh, dx, dz, speed, dmg, life: 4.5, delay: delay || 0 });
  }

  _updateOrbs(dt, player, onHit) {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      if (o.delay > 0) {
        // A held orb pulses in place, so a delayed shot is visibly waiting
        // rather than silently arming.
        o.delay -= dt;
        const s = 1 + Math.sin(o.delay * 22) * 0.2;
        o.mesh.scale.setScalar(s);
        continue;
      }
      o.life -= dt;
      o.mesh.position.x += o.dx * o.speed * dt;
      o.mesh.position.z += o.dz * o.speed * dt;
      // Drop to body height as it travels, so an orb from above still reaches.
      const want = player.pos.y + 1.0;
      o.mesh.position.y += (want - o.mesh.position.y) * Math.min(1, dt * 1.6);
      o.mesh.rotation.x += dt * 8;

      _tmp.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
      const hit = o.mesh.position.distanceTo(_tmp) < 2.0;
      if (hit || o.life <= 0) {
        if (hit) onHit(o.dmg, o.mesh.position);
        this.effects.puff(o.mesh.position, HOT, 8, 5);
        this.scene.remove(o.mesh);
        o.mesh.geometry.dispose();
        o.mesh.material.dispose();
        this.orbs.splice(i, 1);
      }
    }
  }

  // ---- beams ----

  _beam(tx, tz, warn, sweep) {
    const A = CFG.ascended;
    const yaw = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    this.beams.push({
      yaw, warn, sweep, t: 0, life: sweep ? 2.6 : 1.0, fired: false, mesh: null,
      cd: 0,
    });
    Audio.tone({ freq: 150, to: 1100, dur: warn, type: 'sawtooth', volume: 0.2, pos: this.pos });
  }

  _updateBeams(dt, player, onHit) {
    const A = CFG.ascended;
    const len = A.arenaRadius * 2.2;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;

      if (b.t < b.warn) {
        // The lane is drawn on the floor for the whole wind-up.
        if (Math.random() < dt * 50) {
          const d = Math.random() * len;
          _tmp.set(this.pos.x + Math.sin(b.yaw) * d, this.center.y + 0.1,
            this.pos.z + Math.cos(b.yaw) * d);
          this.effects.ring(_tmp, 4.2, 4.2, 0.2, WARN, true);
        }
        continue;
      }
      if (!b.fired) {
        b.fired = true;
        b.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({
            color: HOT, transparent: true, opacity: 0.8, depthWrite: false,
          }));
        this.scene.add(b.mesh);
        this.followCam.shake(1.2);
        Audio.headshot(this.pos);
      }
      b.yaw += b.sweep * dt;
      const cx = this.pos.x + Math.sin(b.yaw) * len * 0.5;
      const cz = this.pos.z + Math.cos(b.yaw) * len * 0.5;
      const fade = clamp((b.life - (b.t - b.warn)) / b.life, 0, 1);
      b.mesh.position.set(cx, this.center.y + 3, cz);
      b.mesh.rotation.y = b.yaw;
      b.mesh.scale.set(7 * fade, 7 * fade, len);
      b.mesh.material.opacity = 0.55 * fade + 0.3;
      // A sweeping beam paints the floor it is about to cross.
      if (b.sweep && Math.random() < dt * 30) {
        const d = Math.random() * len;
        _tmp.set(this.pos.x + Math.sin(b.yaw + b.sweep * 0.35) * d,
          this.center.y + 0.1, this.pos.z + Math.cos(b.yaw + b.sweep * 0.35) * d);
        this.effects.ring(_tmp, 4.2, 4.2, 0.3, WARN, true);
      }

      const px = player.pos.x - this.pos.x, pz = player.pos.z - this.pos.z;
      const along = px * Math.sin(b.yaw) + pz * Math.cos(b.yaw);
      const side = Math.abs(px * Math.cos(b.yaw) - pz * Math.sin(b.yaw));
      b.cd -= dt;
      if (along > 0 && along < len && side < 4.0 && b.cd <= 0) {
        b.cd = 0.4;
        _tmp.set(player.pos.x, player.pos.y + 1, player.pos.z);
        onHit(A.beamDamage, _tmp);
      }
      if (b.t > b.warn + b.life) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.beams.splice(i, 1);
      }
    }
  }

  // ======================================================================
  // PHASE II systems
  // ======================================================================

  /**
   * A vertical beam of light. Static, or orbiting the arena centre at an
   * accelerating rate (Heaven's Execution).
   *
   * Fairness: for the whole of `warn` it paints the circle it is going to
   * occupy, and an orbiting one also paints *ahead* of itself along its
   * travel, so you are never asked to guess which way it is coming.
   */
  _pillar(o) {
    const p = {
      x: o.x, z: o.z, r: o.r, warn: o.warn, life: o.life, dmg: o.dmg,
      orbit: o.orbit || 0, accel: o.accel || 0, t: 0, mesh: null, cd: 0,
      ang: Math.atan2(o.z - this.center.z, o.x - this.center.x),
      rad: Math.hypot(o.x - this.center.x, o.z - this.center.z),
    };
    this.pillars.push(p);
    Audio.tone({
      freq: 180, to: 1200, dur: o.warn, type: 'sawtooth', volume: 0.18, pos: this.pos,
    });
  }

  _updatePillars(dt, player, onHit) {
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i];
      p.t += dt;

      if (p.orbit) {
        p.orbit += Math.sign(p.orbit) * p.accel * dt;   // it speeds up
        p.ang += p.orbit * dt;
        p.x = this.center.x + Math.cos(p.ang) * p.rad;
        p.z = this.center.z + Math.sin(p.ang) * p.rad;
      }

      if (p.t < p.warn) {
        // The footprint, every frame, plus where it is heading.
        _tmp.set(p.x, this.center.y + 0.1, p.z);
        this.effects.ring(_tmp, p.r, p.r, 0.12, WARN, true);
        if (p.orbit) {
          const a2 = p.ang + Math.sign(p.orbit) * 0.5;
          _tmp.set(this.center.x + Math.cos(a2) * p.rad, this.center.y + 0.1,
            this.center.z + Math.sin(a2) * p.rad);
          this.effects.ring(_tmp, p.r * 0.8, p.r * 0.8, 0.12, WARN, true);
        }
        continue;
      }

      if (!p.mesh) {
        p.mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(1, 1, 1, 14, 1, true),
          new THREE.MeshBasicMaterial({
            color: WHITE, transparent: true, opacity: 0.75,
            depthWrite: false, side: THREE.DoubleSide,
          })
        );
        this.scene.add(p.mesh);
        this.followCam.shake(1.3);
        Audio.headshot(this.pos);
      }
      const k = clamp(1 - (p.t - p.warn) / p.life, 0, 1);
      p.mesh.position.set(p.x, this.center.y + 60, p.z);
      p.mesh.scale.set(p.r * (0.7 + k * 0.3), 120, p.r * (0.7 + k * 0.3));
      p.mesh.material.opacity = 0.35 + k * 0.45;
      // It keeps painting the floor while it burns, so an orbiting beam is
      // readable right up to the moment it reaches you.
      _tmp.set(p.x, this.center.y + 0.1, p.z);
      this.effects.ring(_tmp, p.r, p.r * 0.9, 0.1, HOT, true);

      p.cd -= dt;
      if (p.cd <= 0
          && Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < p.r) {
        p.cd = 0.45;
        _tmp.set(player.pos.x, player.pos.y + 1, player.pos.z);
        onHit(p.dmg, _tmp);
        this.lastCleanDodge = false;
        this._comboClean = false;
      }

      if (p.t > p.warn + p.life) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose(); p.mesh.material.dispose();
        this.pillars.splice(i, 1);
      }
    }
  }

  /**
   * A meteor. `kind` 0 bursts, 1 leaves a burning circle, 2 is a decoy.
   *
   * The decoy is the point of the attack: it looks identical in the sky and
   * has no marker on the ground. Once you learn to read the floor instead of
   * the sky, the whole combo becomes navigable — which is the deal this
   * fight makes everywhere.
   */
  _meteor(x, z, delay, kind) {
    const A = CFG.ascended;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.6, 0),
      new THREE.MeshBasicMaterial({ color: kind === 2 ? GOLD : HOT })
    );
    mesh.position.set(x, this.center.y + 110, z);
    this.scene.add(mesh);
    this.meteors.push({ mesh, x, z, t: 0, delay, kind });
    if (kind !== 2) {
      this._mark(x, z, 9, delay, A.meteorDamage, { sound: false, grow: true });
    }
  }

  _updateMeteors(dt, player, onHit) {
    const A = CFG.ascended;
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const k = clamp(m.t / m.delay, 0, 1);
      // Decoys burn out in the air rather than vanishing on the ground, so
      // the fake is legible from the sky as well, just later.
      const top = this.center.y + 110;
      const end = m.kind === 2 ? this.center.y + 26 : this.center.y + 1.5;
      m.mesh.position.y = lerp(top, end, k * k);
      m.mesh.rotation.x += dt * 4;
      m.mesh.rotation.z += dt * 3;
      if (m.kind === 2) m.mesh.material.opacity = 1 - k;
      if (m.kind === 2) { m.mesh.material.transparent = true; }

      if (k >= 1) {
        if (m.kind !== 2) {
          _tmp.set(m.x, this.center.y + 0.6, m.z);
          this.effects.puff(_tmp, HOT, 20, 12);
          this.followCam.shake(0.5);
          // A lingering meteor keeps re-arming its circle. Each pulse is a
          // fresh marker, so the burning ground is telegraphed like anything
          // else rather than being an invisible floor hazard.
          if (m.kind === 1) {
            for (let s = 0; s < 3; s++) {
              this._mark(m.x, m.z, 8, 0.55 + s * 0.75, A.starDamage * 0.7,
                { sound: false, col: WARN });
            }
          }
        } else {
          this.effects.puff(m.mesh.position, GOLD, 8, 5);
        }
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose(); m.mesh.material.dispose();
        this.meteors.splice(i, 1);
      }
    }
  }

  /**
   * THE BRAND.
   *
   * A golden symbol lands on you and arms after `time`. If you have not
   * covered `escape` metres of ground by then, it detonates on you. It deals
   * no damage by itself and is not dodgeable by position — the only answer
   * is to keep moving, which is exactly the habit his combos punish you for
   * not having.
   */
  _brand(player) {
    // Never restack. A second brand landing mid-countdown would silently
    // reset the timer you were counting down, which is the one thing a
    // "keep moving" mechanic must not do.
    if (this.mark) return;
    const M = CFG.ascended.mark;
    this.mark = {
      t: M.time, moved: 0,
      lx: player.pos.x, lz: player.pos.z,
    };
    this.hud.toast('BRANDED — KEEP MOVING');
    Audio.tone({ freq: 520, to: 760, dur: 0.5, type: 'square', volume: 0.16, pos: player.pos });
  }

  _updateMark(dt, player, onHit) {
    const m = this.mark;
    if (!m) return;
    const M = CFG.ascended.mark;

    m.moved += Math.hypot(player.pos.x - m.lx, player.pos.z - m.lz);
    m.lx = player.pos.x; m.lz = player.pos.z;
    m.t -= dt;

    // The symbol rides on the player, and tightens as it arms — the ring is
    // the countdown, so no HUD element is needed to read it.
    const k = clamp(1 - m.t / M.time, 0, 1);
    const safe = m.moved >= M.escape;
    this._markFx = (this._markFx || 0) - dt;
    if (this._markFx <= 0) {
      this._markFx = 0.08;
      _tmp.set(player.pos.x, player.pos.y + 0.12, player.pos.z);
      this.effects.ring(_tmp, 4.5 - k * 2.6, 4.5 - k * 2.6, 0.12,
        safe ? 0x7dff9c : (k > 0.6 ? WARN : GOLD), true);
    }
    if (!safe && Math.random() < dt * 30) {
      _tmp.set(player.pos.x + (Math.random() - 0.5) * 3, player.pos.y + 1.4,
        player.pos.z + (Math.random() - 0.5) * 3);
      this.effects.puff(_tmp, GOLD, 1, 1);
    }

    if (m.t > 0) return;
    this.mark = null;
    if (safe) {
      // Earned. It comes apart harmlessly and says so.
      _tmp.set(player.pos.x, player.pos.y + 1, player.pos.z);
      this.effects.puff(_tmp, 0x7dff9c, 18, 8);
      Audio.tone({ freq: 900, to: 1400, dur: 0.3, type: 'sine', volume: 0.14, pos: player.pos });
      return;
    }
    // Stood still. This still goes through a marker, so even the punishment
    // for not moving gives you its half-second.
    this._mark(player.pos.x, player.pos.z, M.radius, CFG.ascended.minWarning,
      CFG.ascended.markDamage, { grow: true, col: WARN });
    this.followCam.shake(2.0);
    Audio.tone({ freq: 200, to: 60, dur: 0.8, type: 'sawtooth', volume: 0.26, pos: player.pos });
  }

  /**
   * Shed feathers. In phase 2 he is constantly losing them, and where they
   * land they open a small circle of divine energy.
   */
  _updateFeathers(dt, player, onHit) {
    const A = CFG.ascended;
    if (this.acting && this.ascended) {
      this.featherT -= dt;
      if (this.featherT <= 0) {
        this.featherT = 0.5 + Math.random() * 0.7;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * (A.arenaRadius - 6);
        const x = this.center.x + Math.cos(a) * r;
        const z = this.center.z + Math.sin(a) * r;
        const mesh = new THREE.Mesh(
          new THREE.ConeGeometry(0.3, 3.0, 5),
          new THREE.MeshBasicMaterial({ color: HOT, transparent: true, opacity: 0.9 })
        );
        mesh.position.set(x, this.pos.y - 2, z);
        this.scene.add(mesh);
        const fall = 1.5;
        this.feathers.push({ mesh, x, z, t: 0, fall, y0: mesh.position.y });
        // Small, but it still announces itself before it opens.
        this._mark(x, z, 5.5, fall, A.featherDamage, { sound: false, col: WARN });
      }
    }
    for (let i = this.feathers.length - 1; i >= 0; i--) {
      const f = this.feathers[i];
      f.t += dt;
      const k = clamp(f.t / f.fall, 0, 1);
      f.mesh.position.y = lerp(f.y0, this.center.y + 0.4, k);
      f.mesh.rotation.y += dt * 3;
      f.mesh.rotation.z = Math.sin(f.t * 4) * 0.4;
      if (k >= 1) {
        this.effects.puff(f.mesh.position, HOT, 8, 5);
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose(); f.mesh.material.dispose();
        this.feathers.splice(i, 1);
      }
    }
  }

  _clearWall() {
    for (const f of this.wall) {
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose(); f.mesh.material.dispose();
    }
    this.wall.length = 0;
  }

  _clear() {
    for (const s of this.stars) {
      this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
    }
    this.stars.length = 0;
    for (const o of this.orbs) {
      this.scene.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose();
    }
    this.orbs.length = 0;
    for (const b of this.beams) {
      if (!b.mesh) continue;
      this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
    }
    this.beams.length = 0;
    for (const p of this.pillars) {
      if (!p.mesh) continue;
      this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
    }
    this.pillars.length = 0;
    for (const m of this.meteors) {
      this.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose();
    }
    this.meteors.length = 0;
    for (const f of this.feathers) {
      this.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mesh.material.dispose();
    }
    this.feathers.length = 0;
    this._clearWall();
    this.pending.length = 0;
    this.swarm = [];
    this.darkness = 0;
    this.mark = null;
  }

  // ----------------------------------------------------------- animation

  _animate(dt, player) {
    const rig = this.rig;
    const hurt = 1 - this.fraction;
    // Drives every glow in the rig. Defined once, up here, because both the
    // phase-1 aura and the phase-2 corona need it.
    const pulse = 0.5 + Math.sin(this.t * (3 + hurt * 10)) * 0.5;

    // The dive is a real movement, resolved when its lane marker fires.
    if (this.diveT > 0) {
      this.diveT -= dt;
      if (this.diveT <= 0 && this.diveTo) {
        this.pos.copy(this.diveTo);
        this.hoverTarget = null;
        this.effects.puff(this.pos, HOT, 30, 16);
        this.followCam.shake(0.9);
      }
    }

    rig.root.position.copy(this.pos);
    // Through the entrance he is posed against the CAMERA, not the world.
    //
    // He comes down out of the sky with his back to you — enormous, and not
    // yet interested. Then he turns all the way around and looks straight
    // down the lens, and that is the first time you see his face.
    //
    // Camera-relative is the whole point: posing him in world space meant the
    // shot depended on which side of the arena you walked in from, so the
    // same beat read as a back, a profile or a face depending on your path.
    if (this.inEntrance && this._camAngle !== undefined) {
      // `_camAngle` is the direction the camera sits in. A yaw equal to it
      // turns his BACK that way (see lookYaw); half a turn on top faces it.
      const want = this.turnToPlayer
        ? this._camAngle + Math.PI              // face the lens
        : this._camAngle + BACK_BIAS;           // shoulders to the lens
      if (!this._yawPosed) {
        // First framed frame: snap, so he is never caught mid-spin.
        this._yawPosed = true;
        this.yaw = want;
      } else {
        this.yaw = dampAngle(this.yaw, want, this.turnToPlayer ? 1.5 : 9, dt);
      }
    } else if (this.turnToPlayer || this.fighting) {
      const want = lookYaw(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
      this.yaw = dampAngle(this.yaw, want, this.fighting ? 6 : 1.8, dt);
    }
    rig.root.rotation.y = this.yaw + Math.PI;

    rig.body.position.y = Math.sin(this.bob * 1.0) * 0.3;

    // ---- wings ----
    // `wingOpen` is the spread; `wingFlap` is a decaying impulse, so a flap
    // reads as a beat rather than a loop.
    this.wingFlap = damp(this.wingFlap, 0, 4, dt);
    const beat = Math.sin(this.bob * 1.6) * 0.10 + this.wingFlap * 0.85;

    // During the ascension the old wings hang, then come apart.
    if (this._droop) this.wingOpen = damp(this.wingOpen, 0.12, 1.1, dt);
    if (this.shed > 0 && this.shed < 1) {
      this.shed = Math.min(1, this.shed + dt * 0.65);
      for (const w of rig.wings) {
        for (let i = 0; i < w.feathers.length; i++) {
          const f = w.feathers[i];
          // Each feather flies off on its own schedule, tip-first.
          const local = clamp((this.shed - i * 0.055) * 2.2, 0, 1);
          f.scale.setScalar(Math.max(0.001, 1 - local));
          f.position.y = local * 6;
          f.position.x = w.side * local * 5;
        }
      }
      if (Math.random() < dt * 90) {
        _tmp.set(this.pos.x + (Math.random() - 0.5) * 26,
          this.pos.y + 4 + Math.random() * 12,
          this.pos.z + (Math.random() - 0.5) * 26);
        this.effects.puff(_tmp, Math.random() < 0.5 ? WHITE : HOT, 3, 4);
      }
    }
    // And the true wings open.
    if (this.wing2Open > 0 && this.wing2Open < 1) {
      this.wing2Open = Math.min(1, this.wing2Open + dt * 0.55);
    }
    if (this.wing2Open > 0) {
      const open = this.wing2Open;
      for (const w of rig.wings2) {
        const tierLag = clamp(open * 1.4 - w.tier * 0.18, 0, 1);
        w.group.rotation.z = w.side * (0.05 + (1 - tierLag) * 1.5) - beat * w.side * 0.6;
        w.group.rotation.y = w.side * (1 - tierLag) * 1.0;
        for (let i = 0; i < w.feathers.length; i++) {
          const t = i / (w.feathers.length - 1);
          const f = w.feathers[i];
          f.rotation.x = Math.sin(this.bob * 1.9 - t * 1.1) * 0.16
            + beat * 0.6 * (1 - t * 0.4);
          // They grow as he comes apart, and the last stand doubles them.
          f.scale.setScalar(tierLag * (1 + hurt * 0.5 + (this._final ? 0.45 : 0)
            + this.auraFlash * 0.14));
        }
      }
    }
    // Once shedding starts, the loop above owns the old feathers.
    for (const w of this.shed > 0 ? [] : rig.wings) {
      w.group.rotation.z = w.side * (0.1 + (1 - this.wingOpen) * 1.15) - beat * w.side * 0.5;
      w.group.rotation.y = w.side * (1 - this.wingOpen) * 0.9;
      for (let i = 0; i < w.feathers.length; i++) {
        const t = i / (w.feathers.length - 1);
        const f = w.feathers[i];
        f.rotation.x = Math.sin(this.bob * 1.6 - t * 0.9) * 0.14 + beat * 0.5 * (1 - t * 0.4);
        // They grow with his fury.
        f.scale.setScalar(1 + hurt * 0.35 + this.auraFlash * 0.12);
      }
    }
    // Golden trail from the wingtips while he is moving.
    if (!this._lastPos) this._lastPos = this.pos.clone();
    const moved = this.pos.distanceTo(this._lastPos) / Math.max(dt, 1e-5);
    if (moved > 10 && Math.random() < dt * 40) {
      _tmp.copy(this._lastPos).lerp(this.pos, Math.random());
      this.effects.puff(_tmp, Math.random() < 0.5 ? GOLD : HOT, 2, 2);
    }
    this._lastPos.copy(this.pos);

    // ---- sword ----
    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = 1 - this.swingT / 0.3;
      rig.limbs[0].rotation.x = lerp(-2.6, 1.1, k);
    } else {
      rig.limbs[0].rotation.x = damp(rig.limbs[0].rotation.x,
        Math.sin(this.bob * 0.8) * 0.1, 3, dt);
    }
    // It grows through the phases and swells while charging.
    this.swordCharge = damp(this.swordCharge, 0, 1.2, dt);
    const swordScale = 1 + (this.phase - 1) * 0.10 + this.swordCharge * 0.5;
    rig.sword.scale.setScalar(swordScale);
    rig.sword2.scale.setScalar(swordScale * (this._final ? 1.15 : 1));
    rig.mats.blade.opacity = 0.75 + this.swordCharge * 0.25;
    // The God's Blade goes white, and stays white until the combo ends.
    this.bladeWhite = damp(this.bladeWhite, 0, 0.8, dt);
    rig.mats.blade.color.copy(
      _col2.setHex(HOT).lerp(_col1.setHex(WHITE), clamp(this.bladeWhite, 0, 1)));

    // ---- escorts, rings, the second rune shell ----
    if (this.ascended) {
      for (let i = 0; i < rig.escorts.length; i++) {
        const e = rig.escorts[i];
        // They lag the swing, so a slash reads as seven blades, not one.
        e.a += dt * (1.1 + i * 0.05 + (this._final ? 0.9 : 0));
        const lead = this.swingT > 0 ? 3.5 : 0;
        e.mesh.position.set(
          Math.cos(e.a) * (e.r + lead),
          e.y + Math.sin(e.a * 1.7) * 0.9,
          Math.sin(e.a) * (e.r + lead));
        e.mesh.rotation.set(Math.sin(e.a * 2) * 0.3, -e.a, 0.35 + Math.sin(e.a) * 0.5);
        e.mesh.scale.setScalar(1 + this.auraFlash * 0.2);
      }
      for (let i = 0; i < rig.rings.length; i++) {
        const r = rig.rings[i];
        r.mesh.rotation.y += dt * r.spin;
        r.mesh.rotation.z = r.tilt + Math.sin(this.bob * 0.6 + i) * 0.25;
        r.mesh.scale.setScalar(1 + hurt * 0.35 + this.auraFlash * 0.12);
      }
      for (let i = 0; i < rig.runes2.length; i++) {
        const r = rig.runes2[i];
        r.a -= dt * (0.55 + i * 0.02);
        r.mesh.position.set(Math.cos(r.a) * r.r, r.y + Math.sin(r.a * 2 + i) * 0.7,
          Math.sin(r.a) * r.r);
        r.mesh.rotation.y = -r.a;
        r.mesh.rotation.z += dt * 2.2;
      }
      // The corona. Bright enough to be hard to look straight at, brighter
      // when he is angry, unstable when he is nearly gone.
      const flick = this._final ? (0.5 + Math.random() * 0.5) : 1;
      rig.mats.halo.opacity =
        (0.08 + hurt * 0.22 + this.auraFlash * 0.16 + pulse * 0.05) * flick;
      rig.halo.scale.setScalar(7.5 + hurt * 3.0 + this.auraFlash * 2.2);
    }

    // ---- runes ----
    for (let i = 0; i < rig.runes.length; i++) {
      const r = rig.runes[i];
      r.a += dt * (0.4 + i * 0.03 + this.phase * 0.12);
      r.mesh.position.set(Math.cos(r.a) * r.r, r.y + Math.sin(r.a * 2) * 0.4,
        Math.sin(r.a) * r.r);
      r.mesh.rotation.y = -r.a;
      r.mesh.rotation.z += dt * 1.4;
    }

    // ---- the ascension's own tells ----
    // He studies his own wounds: the head tips down and stays there until the
    // new wings are out.
    if (this._lookDown && this.state === STATE.ASCENSION) {
      rig.head.rotation.x = damp(rig.head.rotation.x, 0.55, 1.6, dt);
    } else if (rig.head.rotation.x !== 0) {
      rig.head.rotation.x = damp(rig.head.rotation.x, 0, 3, dt);
    }
    // The aura goes unstable — a hard stutter, not a smooth pulse, because
    // the point is that something is wrong with him.
    if (this._flicker > 0) {
      this._flicker = Math.max(0, this._flicker - dt * 0.35);
      this.auraFlash = Math.max(this.auraFlash,
        Math.random() < 0.35 ? 1.4 + Math.random() : 0.2);
    }
    // Gold splits open along him and keeps venting until he sheds.
    if (this._cracking > 0 && this.shed < 1) {
      if (Math.random() < dt * 55) {
        _tmp.set(this.pos.x + (Math.random() - 0.5) * 13,
          this.pos.y + Math.random() * 16 - 1,
          this.pos.z + (Math.random() - 0.5) * 13);
        this.effects.puff(_tmp, Math.random() < 0.5 ? WHITE : HOT, 2, 2);
      }
      // Seams of light tracking across the body.
      if (Math.random() < dt * 6) {
        _tmp.copy(this.pos); _tmp.y += 6;
        this.effects.ring(_tmp, 1, 9 + Math.random() * 8, 0.35, HOT, false,
          { x: Math.random() - 0.5, y: 1, z: Math.random() - 0.5 });
      }
    }

    // ---- aura, eyes, glow ----
    this.auraFlash = damp(this.auraFlash, 0, 4, dt);
    rig.aura.material.opacity =
      0.09 + hurt * 0.30 + pulse * (0.03 + hurt * 0.10) + this.auraFlash * 0.2;
    rig.aura.scale.setScalar(5.4 + hurt * 2.4 + this.auraFlash * 1.8);
    const heat = new THREE.Color(GOLD).lerp(new THREE.Color(WHITE), hurt * 0.9);
    rig.aura.material.color.copy(heat);
    rig.mats.rune.color.copy(heat);
    rig.mats.wing.color.copy(heat);
    rig.mats.wing.opacity = 0.55 + hurt * 0.3 + this.auraFlash * 0.15;
    // The eyes go pure white at the ascension, and stay that way.
    for (const e of rig.eyes) {
      e.scale.setScalar(0.36 * (1 + pulse * 0.15 + hurt * 0.45
        + this.eyeWhite * 0.5));
    }
    if (this.eyeWhite > 0) rig.mats.eye.color.setHex(WHITE);

    // ---- unstable at the end ----
    if (this.fighting && Math.random() < dt * (14 + hurt * 70)) {
      _tmp.set(this.pos.x + (Math.random() - 0.5) * 22,
        this.pos.y + (Math.random() - 0.5) * 16,
        this.pos.z + (Math.random() - 0.5) * 22);
      this.effects.puff(_tmp, Math.random() < hurt ? WHITE : GOLD, 2, 2);
    }
    // A pool of light under him, so he is findable when he is behind you.
    if (this.fighting) {
      this._poolT = (this._poolT || 0) - dt;
      if (this._poolT <= 0) {
        this._poolT = 0.1;
        _tmp.set(this.pos.x, this.center.y + 0.06, this.pos.z);
        const r = 9 + hurt * 5;
        this.effects.ring(_tmp, r, r * 0.85, 0.2, GOLD, true);
      }
    }
  }

  dispose() {
    this._clear();
    this.scene.remove(this.rig.root);
    this.rig.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
