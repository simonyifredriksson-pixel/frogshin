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
 * timings, so the five signature sequences are written out literally and a
 * new combo can only ever recombine attacks that already telegraph properly.
 *
 *   Phase 1  THE ASCENDED      100%  sword, wings, stars, beams, blinks
 *   Phase 2  DIVINE WRATH       70%  faster, longer chains, delayed strikes
 *   Phase 3  THE HEAVENS BREAK  45%  sky beams, mirrored slashes, wing waves
 *   Phase 4  GOD OF DEATH       20%  constant chaining, huge sword
 *   Phase 5  THE LAST JUDGMENT   8%  silence, a line, then everything
 */

import * as THREE from '../lib/three.module.js?v=v33';
import { CFG } from './config.js?v=v33';
import { clamp, lerp, damp, dampAngle } from './util.js?v=v33';
import { Audio } from './audio.js?v=v33';

const _v = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _to = new THREE.Vector3();

const GOLD = 0xffd76b;
const HOT = 0xfff3c4;
const WHITE = 0xffffff;
const WARN = 0xffb03c;      // move out of it
const WARN_JUMP = 0xffe14a; // ground wave — jump it

export const PHASE_NAMES = [
  'THE ASCENDED', 'DIVINE WRATH', 'THE HEAVENS BREAK',
  'GOD OF DEATH', 'THE LAST JUDGMENT',
];

const ENTRANCE_LINE =
  '“You were told a god had fallen. You were not told which one.”';
const JUDGMENT_LINE = '“Enough. Kneel, or be unmade.”';

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

  return { root, body, head, eyes, wings, limbs, sword, runes, aura, mats: M };
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
  JUDGMENT: 'judgment', // the phase-5 silence
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

/** Which combos each phase can call on. */
const PHASE_POOL = [
  ['backbreaker', 'sweep', 'skyfall'],
  ['backbreaker', 'skyfall', 'sweep', 'reckoning'],
  ['skyfall', 'reckoning', 'sweep', 'backbreaker', 'eclipse'],
  ['reckoning', 'eclipse', 'skyfall', 'backbreaker', 'sweep'],
  ['eclipse', 'reckoning', 'backbreaker', 'skyfall', 'sweep'],
];

/** Seconds of rest between combos, per phase. The whole difficulty curve. */
const REST = [1.25, 0.95, 0.70, 0.48, 0.34];
/** Multiplier on every telegraph, per phase. Floored by minWarning. */
const TELE = [1.0, 0.88, 0.76, 0.66, 0.58];

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
  }

  get fraction() { return clamp(this.health / this.maxHealth, 0, 1); }
  get alive() { return this.health > 0; }
  get fighting() { return this.state === STATE.FIGHT || this.state === STATE.JUDGMENT; }
  get inEntrance() {
    return this.state === STATE.SKY || this.state === STATE.DESCEND
      || this.state === STATE.STARE || this.state === STATE.ARM
      || this.state === STATE.BURST;
  }
  /** Telegraph length for this phase, never below the floor. */
  warn(base) {
    return Math.max(CFG.ascended.minWarning, base * (TELE[this.phase - 1] || 1));
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
    if (!this.alive || !this.fighting) return false;
    this.health = Math.max(0, this.health - amount);
    _tmp.copy(this.pos).y += 6;
    this.effects.hitBurst(_tmp, { x: 0, y: 0, z: 1 }, amount > 30);

    const A = CFG.ascended;
    const f = this.fraction;
    for (let i = A.phases.length - 1; i >= 1; i--) {
      if (f <= A.phases[i] && this.phase < i + 1) {
        this.phase = i + 1;
        this._onPhase();
        break;
      }
    }
    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this.justDied = true;
      this._clear();
      Audio.stopBossMusic();
      return true;
    }
    return false;
  }

  _onPhase() {
    const A = CFG.ascended;
    // The last phase is a scripted beat, not just a stat change.
    if (this.phase === 5) {
      this.state = STATE.JUDGMENT;
      this.t = 0;
      this._clear();
      this.combo = null;
      this.hud.showBossBar(A.name, this.fraction, A.finalTitle);
      Audio.stopBossMusic();
      return;
    }
    this.hud.announce(PHASE_NAMES[this.phase - 1], 'danger', false);
    _tmp.copy(this.pos);
    this.effects.ring(_tmp, 1, 70, 1.0, HOT, false, { x: 0, y: 1, z: 0 });
    this.effects.puff(_tmp, HOT, 50, 18);
    this.followCam.shake(1.4);
    this.auraFlash = 1.6;
    this.wingFlap = 1;
    Audio.death(this.pos);
    Audio.startBossMusic();
    this.combo = null;
    this.restT = 0.7;
  }

  // -------------------------------------------------------------- update

  update(dt, player, camera, onHit) {
    this.t += dt;
    this.bob += dt;
    this._updatePending(dt, player, onHit);
    this._updateStars(dt, player, onHit);
    this._updateOrbs(dt, player, onHit);
    this._updateBeams(dt, player, onHit);

    switch (this.state) {
      case STATE.SKY: this._sky(dt, player, camera); break;
      case STATE.DESCEND: this._descend(dt, player, camera); break;
      case STATE.STARE: this._stare(dt, player, camera); break;
      case STATE.ARM: this._arm(dt, player, camera); break;
      case STATE.BURST: this._burst(dt, player, camera); break;
      case STATE.FIGHT: this._fight(dt, player, onHit); break;
      case STATE.JUDGMENT: this._judgment(dt, player); break;
      default: break;
    }
    this._animate(dt, player);
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
    this.pos.set(this.center.x, this.center.y + A.hoverHeight + 14, this.center.z);
    this.rig.root.visible = true;
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
      this.hud.announce(PHASE_NAMES[0], 'danger', false);
    }
  }

  _cam(camera, player, dist, pitch) {
    const a = Math.atan2(player.pos.x - this.center.x, player.pos.z - this.center.z);
    camera.position.set(
      this.center.x + Math.sin(a) * dist,
      this.center.y + 3.0,
      this.center.z + Math.cos(a) * dist);
    _v.copy(this.pos);
    _v.y -= lerp(0, 22, 1 - pitch);
    camera.lookAt(_v);
  }

  // ---------------------------------------------------------- phase five

  /** Silence, a line, and then he stops holding back. */
  _judgment(dt, player) {
    this.hoverTarget = null;
    this.turnToPlayer = true;
    if (this.t > 0.8 && !this._jSpoke) {
      this._jSpoke = true;
      this.hud.setSubtitle(JUDGMENT_LINE, CFG.ascended.name);
      this.hud.announce(PHASE_NAMES[4], 'danger', true);
      Audio.tone({ freq: 58, to: 44, dur: 2.4, type: 'sawtooth', volume: 0.24, pos: this.pos });
    }
    // The wings spread and the whole arena lights up.
    this.wingOpen = Math.min(1, this.wingOpen + dt * 0.8);
    if (this.t > 1.2 && this.t % 0.35 < dt) {
      _tmp.copy(this.center);
      this.effects.ring(_tmp, 2, 60, 1.0, HOT, true);
    }
    if (this.t > 4.2 && !this._jBurst) {
      this._jBurst = true;
      this.auraFlash = 3;
      this.wingFlap = 1;
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, WHITE, 90, 30);
      this.effects.ring(this.center, 1, 100, 1.0, WHITE, true);
      this.followCam.shake(2.5);
      this.hud.setSubtitle('');
      this.hud.clearAnnounce();
      Audio.startBossMusic();
      Audio.headshot(this.pos);
    }
    if (this.t > 5.4) {
      this.state = STATE.FIGHT;
      this.restT = 0.35;
      this.combo = null;
    }
  }

  // -------------------------------------------------------------- combat

  _fight(dt, player, onHit) {
    this._hover(dt, player);

    if (this.combo) { this._runCombo(dt, player, onHit); return; }
    this.restT -= dt;
    if (this.restT > 0) return;

    const pool = PHASE_POOL[this.phase - 1] || PHASE_POOL[0];
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
  }

  _runCombo(dt, player, onHit) {
    this.stepT -= dt;
    if (this.stepT > 0) return;
    if (this.step >= this.combo.length) {
      this.combo = null;
      this.restT = REST[this.phase - 1] || 0.8;
      return;
    }
    const [move, delay] = this.combo[this.step++];
    this._doMove(move, player);
    // Later phases compress the gaps between the steps of a combo.
    this.stepT = delay * (TELE[this.phase - 1] || 1);
  }

  // ------------------------------------------------------------ movement

  _hover(dt, player) {
    const A = CFG.ascended;
    const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
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
      if (hit && !(p.jump && airborne)) onHit(p.dmg, _tmp);

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
    this.pending.length = 0;
    this.swarm = [];
    this.darkness = 0;
  }

  // ----------------------------------------------------------- animation

  _animate(dt, player) {
    const rig = this.rig;
    const hurt = 1 - this.fraction;

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
    if (this.turnToPlayer || this.fighting) {
      const want = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      this.yaw = dampAngle(this.yaw, want, this.fighting ? 6 : 1.8, dt);
    }
    rig.root.rotation.y = this.yaw + Math.PI;

    rig.body.position.y = Math.sin(this.bob * 1.0) * 0.3;

    // ---- wings ----
    // `wingOpen` is the spread; `wingFlap` is a decaying impulse, so a flap
    // reads as a beat rather than a loop.
    this.wingFlap = damp(this.wingFlap, 0, 4, dt);
    const beat = Math.sin(this.bob * 1.6) * 0.10 + this.wingFlap * 0.85;
    for (const w of rig.wings) {
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
    rig.mats.blade.opacity = 0.75 + this.swordCharge * 0.25;

    // ---- runes ----
    for (let i = 0; i < rig.runes.length; i++) {
      const r = rig.runes[i];
      r.a += dt * (0.4 + i * 0.03 + this.phase * 0.12);
      r.mesh.position.set(Math.cos(r.a) * r.r, r.y + Math.sin(r.a * 2) * 0.4,
        Math.sin(r.a) * r.r);
      r.mesh.rotation.y = -r.a;
      r.mesh.rotation.z += dt * 1.4;
    }

    // ---- aura, eyes, glow ----
    this.auraFlash = damp(this.auraFlash, 0, 4, dt);
    const pulse = 0.5 + Math.sin(this.t * (3 + hurt * 10)) * 0.5;
    rig.aura.material.opacity =
      0.09 + hurt * 0.30 + pulse * (0.03 + hurt * 0.10) + this.auraFlash * 0.2;
    rig.aura.scale.setScalar(5.4 + hurt * 2.4 + this.auraFlash * 1.8);
    const heat = new THREE.Color(GOLD).lerp(new THREE.Color(WHITE), hurt * 0.9);
    rig.aura.material.color.copy(heat);
    rig.mats.rune.color.copy(heat);
    rig.mats.wing.color.copy(heat);
    rig.mats.wing.opacity = 0.55 + hurt * 0.3 + this.auraFlash * 0.15;
    // In the last phase the eyes go pure white.
    for (const e of rig.eyes) {
      e.scale.setScalar(0.36 * (1 + pulse * 0.15 + hurt * 0.45));
    }
    if (this.phase >= 4) rig.mats.eye.color.setHex(WHITE);

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
