/**
 * FROGATH — THE FIRST CROAK.
 *
 * The god at the bottom of the dungeon, and the reason the other fourteen
 * existed. An enormous golden frog — a real frog, not a ninja — who floats,
 * never walks, and treats gravity as something that happens to other people.
 *
 * DESIGN RULE, and the one that everything else bends to: every attack draws
 * its danger on the floor (or in the air) for at least CFG.dungeon.frogath
 * .minWarning seconds before it can hurt anyone. He is meant to be brutally
 * hard because the patterns are dense, fast and layered — never because a
 * hitbox appeared without warning. A player who reads perfectly can dodge
 * everything in this file, in every phase.
 *
 * Structure:
 *   Entrance  — silence, a glow, a slow descent, the speech, then "Begin."
 *   Phase 1   — calm. Sword combos and single star volleys.
 *   Phase 2   — 70%. Teleports, faster combos, the first beams.
 *   Phase 3   — 40%. Attacks layer: stars DURING sword work, twin beams.
 *   Phase 4   — 15%. A dying star. Everything, at once, barely spaced.
 */

import * as THREE from '../lib/three.module.js?v=v55';
import { CFG } from './config.js?v=v55';
import { clamp, lerp, damp, dampAngle, lookYaw } from './util.js?v=v55';
import { Audio } from './audio.js?v=v55';

const _v = new THREE.Vector3();
const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();

const GOLD = 0xffd76b;
const GOLD_HOT = 0xfff3c4;
const GOLD_DEEP = 0xc9922a;

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

/** The speech, exactly as scripted, one screen at a time. */
export const FROGATH_SPEECH = [
  { t: 2.2, line: '“...So.”' },
  { t: 3.0, line: '“You are the first.”' },
  { t: 2.6, line: '' },
  { t: 5.0, line: '“Fourteen guardians. Fourteen graves. Every warrior who entered this place believed they were worthy.”' },
  { t: 3.4, line: '“None of them reached this throne.”' },
  { t: 3.6, line: '“And yet you stand before me.”' },
  { t: 3.0, line: '“Tell me, little mortal...”' },
  { t: 3.4, line: '“Did you come here believing you were strong?”' },
  { t: 5.6, line: '“...or have you simply not realized that everything you have defeated was merely protecting you from me?”' },
  { t: 3.2, line: '“You have conquered fourteen monsters.”' },
  { t: 2.4, line: '“Now...”' },
  { t: 3.2, line: '“...conquer death.”' },
];

const PHASE_NAMES = ['', 'THE GOD STIRS', 'THE GOD DESCENDS', 'A DYING STAR'];
/** Seconds of held Space needed to skip the entrance. */
const SKIP_HOLD = 0.9;

// ---------------------------------------------------------------- the model

/**
 * Build the god: a plain, enormous frog shape in gold, with a halo, glowing
 * eyes, ancient inlay across the back, and a sword of light.
 *
 * Everything is emissive-lit rather than lambert-shaded, because he is
 * supposed to be the light source in the room, not a thing the room lights.
 */
function buildFrogath() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const M = {
    skin: new THREE.MeshLambertMaterial({ color: 0xe8b73a, emissive: 0x6a4a08 }),
    skinDark: new THREE.MeshLambertMaterial({ color: 0xbf8f22, emissive: 0x4a3206 }),
    belly: new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0x7a5c12 }),
    inlay: new THREE.MeshBasicMaterial({ color: GOLD_HOT }),
    eye: new THREE.MeshBasicMaterial({ color: 0xfff6d0 }),
    halo: new THREE.MeshBasicMaterial({
      color: GOLD, transparent: true, opacity: 0.92,
    }),
    blade: new THREE.MeshBasicMaterial({
      color: GOLD_HOT, transparent: true, opacity: 0.85,
    }),
  };

  const G = {
    sphere: new THREE.SphereGeometry(1, 16, 12),
    low: new THREE.SphereGeometry(1, 10, 8),
    box: new THREE.BoxGeometry(1, 1, 1),
    torus: new THREE.TorusGeometry(1, 0.09, 8, 40),
    capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
  };

  const put = (geo, mat, sx, sy, sz, px, py, pz, rx, ry, rz) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(px || 0, py || 0, pz || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    return m;
  };

  // ---- body: a broad, squat frog ----
  body.add(put(G.sphere, M.skin, 1.45, 1.15, 1.35, 0, 1.5, 0));
  body.add(put(G.sphere, M.belly, 1.12, 0.86, 1.0, 0, 1.28, 0.45));

  // ---- head: wide, low, with the huge frog mouth ----
  const head = new THREE.Group();
  head.position.set(0, 2.5, 0.25);
  body.add(head);
  head.add(put(G.sphere, M.skin, 1.25, 0.92, 1.15, 0, 0, 0));
  head.add(put(G.box, M.skinDark, 2.1, 0.08, 0.4, 0, -0.28, 0.85));   // mouth
  const eyes = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 0.62, 0.62, 0.3);
    head.add(g);
    g.add(put(G.low, M.skin, 0.5, 0.5, 0.5, 0, 0, 0));
    const glow = put(G.low, M.eye, 0.34, 0.34, 0.34, 0, 0.06, 0.22);
    g.add(glow);
    eyes.push(glow);
  }

  // ---- ancient inlay: glowing lines across the back and brow ----
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI - Math.PI / 2;
    body.add(put(G.box, M.inlay, 0.09, 0.09, 2.5,
      Math.sin(a) * 1.25, 1.9 + Math.cos(a) * 0.5, -0.1, 0.35, 0, 0));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 4 - 0.5) * 1.5;
    head.add(put(G.box, M.inlay, 0.07, 0.07, 0.9,
      Math.sin(a) * 1.0, 0.35 + Math.cos(a) * 0.25, 0.35, 0.6, 0, 0));
  }
  // Concentric rings on the belly, like a coin.
  for (let i = 1; i <= 3; i++) {
    body.add(put(G.torus, M.inlay, 0.34 * i, 0.34 * i, 0.34 * i, 0, 1.28, 1.28));
  }

  // ---- limbs: hanging loose, because he is not standing on anything ----
  const limbs = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 1.3, 1.75, 0.25);
    body.add(arm);
    arm.add(put(G.capsule, M.skin, 0.3, 0.42, 0.3, 0, -0.55, 0));
    arm.add(put(G.low, M.skin, 0.34, 0.28, 0.4, 0, -1.15, 0.1));
    limbs.push(arm);

    const leg = new THREE.Group();
    leg.position.set(sx * 0.85, 0.9, -0.1);
    body.add(leg);
    leg.add(put(G.capsule, M.skinDark, 0.42, 0.5, 0.42, 0, -0.6, 0));
    leg.add(put(G.low, M.skin, 0.4, 0.24, 0.62, 0, -1.25, 0.25));
    limbs.push(leg);
  }

  // ---- halo ----
  const halo = new THREE.Mesh(G.torus, M.halo);
  halo.scale.setScalar(1.9);
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, 4.3, 0);
  body.add(halo);
  const halo2 = new THREE.Mesh(G.torus, M.halo);
  halo2.scale.setScalar(2.5);
  halo2.rotation.x = Math.PI / 2;
  halo2.position.set(0, 4.5, 0);
  body.add(halo2);

  // ---- sword of light, in the right hand ----
  const sword = new THREE.Group();
  sword.add(put(G.box, M.blade, 0.22, 7.0, 0.7, 0, 3.4, 0));
  sword.add(put(G.box, M.blade, 0.3, 6.4, 0.34, 0, 3.2, 0));
  sword.add(put(G.box, M.inlay, 1.4, 0.22, 0.22, 0, 0.1, 0));
  sword.add(put(G.box, M.inlay, 0.18, 0.9, 0.18, 0, -0.5, 0));
  sword.position.set(0, -1.2, 0.2);
  sword.rotation.x = 0.2;
  limbs[0].add(sword);

  // ---- aura: a shell that brightens as he weakens ----
  const aura = new THREE.Mesh(G.sphere, new THREE.MeshBasicMaterial({
    color: GOLD, transparent: true, opacity: 0.10, side: THREE.BackSide,
    depthWrite: false,
  }));
  aura.scale.setScalar(4.6);
  aura.position.y = 1.8;
  body.add(aura);

  return { root, body, head, eyes, limbs, halo, halo2, sword, aura, mats: M };
}

// ------------------------------------------------------------------- boss

const STATE = {
  DORMANT: 'dormant',
  DESCEND: 'descend',
  SPEECH: 'speech',
  RAISE: 'raise',
  STARE: 'stare',
  FIGHT: 'fight',
  DEAD: 'dead',
};

export class Frogath {
  constructor(center, scene, effects, hud, followCam) {
    const F = CFG.dungeon.frogath;
    this.scene = scene;
    this.effects = effects;
    this.hud = hud;
    this.followCam = followCam;
    this.center = center.clone();

    this.rig = buildFrogath();
    this.rig.root.scale.setScalar(F.scale);
    this.scene.add(this.rig.root);

    this.maxHealth = F.health;
    this.health = this.maxHealth;
    this.phase = 1;

    // He starts far above the arena, invisible, waiting for the sky to open.
    this.pos = new THREE.Vector3(center.x, center.y + 150, center.z);
    this.yaw = 0;
    this.rig.root.position.copy(this.pos);
    this.rig.root.visible = false;

    this.state = STATE.DORMANT;
    this.t = 0;
    this.speechIndex = 0;
    this.speechTimer = 0;

    this.stars = [];        // falling star projectiles
    this.beams = [];        // active light beams
    this.warnings = [];     // ground markers that are not yet dangerous
    this.attackTimer = 2.0;
    this.attackName = '';
    this.attackStep = 0;
    this.swingT = 0;
    this.teleportFlash = 0;
    this.justDied = false;
    this.began = false;
    this.bob = 0;
  }

  get fraction() { return clamp(this.health / this.maxHealth, 0, 1); }
  get alive() { return this.health > 0; }
  get fighting() { return this.state === STATE.FIGHT; }

  /**
   * Kick off the entrance. The arena should be silent when this is called.
   * @param skippable true once the player has died to him at least once —
   *                  the speech is worth hearing the first time and a chore
   *                  on the twentieth attempt.
   */
  begin(skippable) {
    this.state = STATE.DESCEND;
    this.t = 0;
    this.rig.root.visible = true;
    this.skippable = !!skippable;
    this.skipHeld = 0;
    Audio.stopBossMusic();
  }

  /** True while the entrance is playing and could be skipped. */
  get inEntrance() {
    return this.state === STATE.DESCEND || this.state === STATE.SPEECH
      || this.state === STATE.RAISE || this.state === STATE.STARE;
  }

  /**
   * Hold Space to skip. Held, not tapped, so it cannot be triggered by the
   * jump you were already pressing when you walked in.
   *
   * @param held is the key down this frame
   * @returns 0..1 progress, for the HUD prompt
   */
  updateSkip(dt, held) {
    if (!this.skippable || !this.inEntrance) return 0;
    this.skipHeld = held ? this.skipHeld + dt : Math.max(0, this.skipHeld - dt * 2);
    if (this.skipHeld >= SKIP_HOLD) { this._skipEntrance(); return 1; }
    return clamp(this.skipHeld / SKIP_HOLD, 0, 1);
  }

  /** Jump straight to the stare, so "Begin." still lands. */
  _skipEntrance() {
    const F = CFG.dungeon.frogath;
    // Nothing left to skip — and this is what takes the prompt off screen,
    // since the stare it drops you into is still part of the entrance.
    this.skippable = false;
    this.skipHeld = 0;
    this.pos.set(this.center.x, this.center.y + F.hoverHeight + 16, this.center.z);
    // Face-on immediately: the stare a skip drops you into is shorter than
    // the turn takes, so he would otherwise still be coming round when
    // "Begin." lands.
    this.turningToPlayer = true;
    if (this._camAngle !== undefined) {
      this.yaw = this._camAngle + Math.PI;      // already looking at you
      this._yawPosed = true;
    }
    this.eyesHot = true;
    this.hud.setSubtitle('');
    this.hud.setFade(0, 0.25);
    if (!this._faded) {
      this._faded = true;
      this.hud.showBossBar(F.name, 1, `${F.title}   ·   ??? / ??? HP`);
    }
    this.state = STATE.STARE;
    // Straight to the moment before he speaks: the fight begins in about a
    // second rather than instantly, so the skip never drops you mid-attack.
    this.t = 3.4;
    this.began = false;
  }

  // --------------------------------------------------------------- damage

  takeDamage(amount) {
    if (!this.alive || this.state !== STATE.FIGHT) return false;
    this.health = Math.max(0, this.health - amount);
    _tmp.copy(this.pos).y += 4;
    this.effects.hitBurst(_tmp, { x: 0, y: 0, z: 1 }, amount > 30);

    // Phase transitions.
    const F = CFG.dungeon.frogath;
    const f = this.fraction;
    for (let i = F.phases.length - 1; i >= 1; i--) {
      if (f <= F.phases[i] && this.phase < i + 1) {
        this.phase = i + 1;
        this._onPhase();
        break;
      }
    }

    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this.justDied = true;
      this._clearHazards();
      Audio.stopBossMusic();
      return true;
    }
    return false;
  }

  _onPhase() {
    const name = PHASE_NAMES[this.phase - 1] || '';
    if (name) this.hud.announce(name, 'danger', false);
    // A shockwave, and the aura tightens and brightens.
    _tmp.copy(this.pos);
    this.effects.ring(_tmp, 1, 40, 0.9, GOLD_HOT, false, { x: 0, y: 1, z: 0 });
    this.effects.puff(_tmp, GOLD_HOT, 40, 14);
    this.followCam.shake(1.2);
    Audio.death(this.pos);
    Audio.startBossMusic();
    // Attacks resume almost immediately — a phase change is not a rest.
    this.attackTimer = 0.9;
    this.attackName = '';
  }

  // --------------------------------------------------------------- update

  /**
   * @param onHit called with (damage, sourcePos) when something connects
   */
  update(dt, player, camera, onHit) {
    this.t += dt;
    this.bob += dt;
    this._updateStars(dt, player, onHit);
    this._updateBeams(dt, player, onHit);

    switch (this.state) {
      case STATE.DESCEND: this._descend(dt, player, camera); break;
      case STATE.SPEECH: this._speech(dt, player, camera); break;
      case STATE.RAISE: this._raise(dt, player, camera); break;
      case STATE.STARE: this._stare(dt, player); break;
      case STATE.FIGHT: this._fight(dt, player, onHit); break;
      default: break;
    }

    this._animate(dt, player);
  }

  // ------------------------------------------------------------- entrance

  /**
   * The descent. Slow, controlled, and lit from behind — he is not falling,
   * he is choosing to come down.
   */
  _descend(dt, player, camera) {
    const F = CFG.dungeon.frogath;
    const DUR = 11.0;
    const k = clamp(this.t / DUR, 0, 1);
    // Ease out hard so he decelerates into his stop rather than arriving.
    const e = 1 - Math.pow(1 - k, 3);
    const topY = this.center.y + 150;
    const restY = this.center.y + F.hoverHeight + 16;
    this.pos.set(this.center.x, lerp(topY, restY, e), this.center.z);

    // Golden fall, rays, and a shaking floor.
    if (Math.random() < 0.9) {
      _tmp.set(
        this.pos.x + (Math.random() - 0.5) * 30,
        this.pos.y + (Math.random() - 0.5) * 20,
        this.pos.z + (Math.random() - 0.5) * 30);
      this.effects.puff(_tmp, Math.random() < 0.5 ? GOLD : GOLD_HOT, 3, 1.4);
    }
    if (this.t % 0.55 < dt) {
      _tmp.copy(this.center);
      this.effects.ring(_tmp, 4, 44, 1.5, GOLD, true);
    }
    this.followCam.shake(0.22 + e * 0.3);

    // The camera cranes up to him: the player is looking at something vast.
    this._cinematicCamera(camera, player, lerp(26, 40, e), lerp(0.15, 0.55, e));

    if (k >= 1) {
      this.state = STATE.SPEECH;
      this.t = 0;
      this.speechIndex = 0;
      this.speechTimer = 1.6;          // a long silence before he speaks
      this.hud.setSubtitle('');
      _tmp.copy(this.center);
      this.effects.ring(_tmp, 2, 50, 1.2, GOLD_HOT, true);
      this.followCam.shake(1.4);
      Audio.death(this.pos);
    }
  }

  _speech(dt, player, camera) {
    this._cinematicCamera(camera, player, 40, 0.55);
    this.speechTimer -= dt;
    if (this.speechTimer > 0) return;

    if (this.speechIndex >= FROGATH_SPEECH.length) {
      this.state = STATE.RAISE;
      this.t = 0;
      this.hud.setSubtitle('');
      return;
    }
    const s = FROGATH_SPEECH[this.speechIndex++];
    this.speechTimer = s.t;
    this.hud.setSubtitle(s.line, s.line ? CFG.dungeon.frogath.name : '');
    if (s.line) {
      // A low, calm voice. He is not shouting; he does not need to.
      Audio.tone({
        freq: 74, to: 58, dur: Math.min(1.6, s.t * 0.5), type: 'sawtooth',
        volume: 0.2, pos: this.pos,
      });
    }
    // "Tell me, little mortal..." is the moment he stops addressing the room
    // and starts addressing YOU — so that is where he turns to face you.
    if (s.line.indexOf('little mortal') !== -1) {
      this.turningToPlayer = true;
      this.effects.ring(this.pos, 1, 14, 0.8, GOLD, false, { x: 0, y: 1, z: 0 });
      Audio.tone({ freq: 200, to: 90, dur: 0.9, type: 'sine', volume: 0.14, pos: this.pos });
    }
    // His eyes come up as he asks whether you thought you were strong.
    if (this.speechIndex === 8) this.eyesHot = true;
  }

  /** He raises the sword; the arena floods with light; the bar appears. */
  _raise(dt, player, camera) {
    const DUR = 2.6;
    this._cinematicCamera(camera, player, 40, 0.5);
    const k = clamp(this.t / DUR, 0, 1);
    this.rig.limbs[0].rotation.x = lerp(0, -2.5, k);
    this.rig.limbs[0].rotation.z = lerp(0, 0.4, k);

    if (this.t > DUR * 0.55 && !this._flashed) {
      this._flashed = true;
      _tmp.copy(this.center);
      this.effects.ring(_tmp, 1, 60, 0.7, GOLD_HOT, true);
      this.effects.puff(this.pos, GOLD_HOT, 60, 20);
      this.hud.setFade(1, 0.12);
      this.followCam.shake(1.6);
      Audio.headshot(this.pos);
    }
    if (this.t > DUR * 0.7 && !this._faded) {
      this._faded = true;
      this.hud.setFade(0, 0.5);
      const F = CFG.dungeon.frogath;
      // He does not tell you how much of him is left.
      this.hud.showBossBar(F.name, 1, `${F.title}   ·   ??? / ??? HP`);
    }
    if (k >= 1) {
      this.state = STATE.STARE;
      this.t = 0;
      this.hud.setSubtitle('');
    }
  }

  /**
   * He stands there and looks at you. Nothing happens for four seconds,
   * which is the loudest thing in the fight.
   */
  _stare(dt, player) {
    if (this.t > 4.0 && !this.began) {
      this.began = true;
      this.hud.setSubtitle('“Begin.”', CFG.dungeon.frogath.name);
      // The music drops exactly on the word.
      Audio.startBossMusic();
      Audio.headshot(this.pos);
      this.followCam.shake(0.8);
    }
    if (this.t > 5.6) {
      this.state = STATE.FIGHT;
      this.t = 0;
      this.attackTimer = 1.1;
      this.hud.setSubtitle('');
    }
  }

  /** Frame him from below, so he fills the sky. */
  _cinematicCamera(camera, player, dist, pitch) {
    const a = Math.atan2(player.pos.x - this.center.x, player.pos.z - this.center.z);
    // Remembered so the entrance can pose him relative to the SHOT rather
    // than to the world — see _animate. Without this, which side of him you
    // see is decided by whichever way you happened to walk in from.
    this._camAngle = a;
    camera.position.set(
      this.center.x + Math.sin(a) * dist,
      this.center.y + 2.5,
      this.center.z + Math.cos(a) * dist
    );
    _v.copy(this.pos);
    _v.y -= lerp(0, 12, 1 - pitch);
    camera.lookAt(_v);
  }

  // ---------------------------------------------------------------- fight

  /**
   * Pick and run attacks.
   *
   * The pool widens with each phase and the gaps between attacks shrink, but
   * the individual telegraphs never go below minWarning — a phase-4 Frogath
   * is relentless, not unfair.
   */
  _fight(dt, player, onHit) {
    const F = CFG.dungeon.frogath;

    // Float above and around the player, never landing.
    this._hover(dt, player);

    if (this.attackName) {
      this._runAttack(dt, player, onHit);
      return;
    }

    this.attackTimer -= dt;
    if (this.attackTimer > 0) return;

    const pool = this._attackPool();
    this.attackName = pool[Math.floor(Math.random() * pool.length)];
    this.attackStep = 0;
    this.attackT = 0;
    this._startAttack(player);
  }

  _attackPool() {
    switch (this.phase) {
      case 1: return ['swordCombo', 'starVolley', 'swordCombo', 'starVolley'];
      case 2: return ['swordCombo', 'starVolley', 'beam', 'teleportStrike',
        'starVolley', 'swordCombo'];
      case 3: return ['starsThenCharge', 'beamSweep', 'teleportStrike',
        'swordCombo', 'starBarrage', 'beam', 'starsAndBeam'];
      default: return ['starBarrage', 'starsAndBeam', 'beamSweep',
        'teleportStrike', 'starsThenCharge', 'starBarrage', 'swordCombo'];
    }
  }

  /** How long he rests after an attack — the player's whole opening. */
  _restTime() {
    return [1.35, 1.05, 0.8, 0.55][this.phase - 1] || 0.8;
  }

  _hover(dt, player) {
    const F = CFG.dungeon.frogath;
    // Always faces you. (Not atan2(dx,dz) — see lookYaw; that points a rig
    // the other way, which is exactly the bug this replaced.)
    const want = lookYaw(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
    this.yaw = dampAngle(this.yaw, want, 4.5, dt);

    if (this.hoverTarget) {
      _to.copy(this.hoverTarget).sub(this.pos);
      const d = _to.length();
      if (d > 1) {
        _to.multiplyScalar(1 / d);
        const speed = [9, 13, 17, 22][this.phase - 1] || 14;
        this.pos.addScaledVector(_to, Math.min(speed, d * 3) * dt);
      } else {
        this.hoverTarget = null;
      }
    } else if (Math.random() < dt * 0.4) {
      this._pickHoverSpot(player);
    }

    // Keep him above the floor, always.
    const minY = this.center.y + F.hoverHeight;
    if (this.pos.y < minY) this.pos.y = damp(this.pos.y, minY, 6, dt);
  }

  _pickHoverSpot(player) {
    const F = CFG.dungeon.frogath;
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * (F.arenaRadius - 20);
    this.hoverTarget = new THREE.Vector3(
      this.center.x + Math.cos(a) * r,
      this.center.y + F.hoverHeight + 2 + Math.random() * 9,
      this.center.z + Math.sin(a) * r
    );
  }

  // ------------------------------------------------------------- attacks

  /**
   * A flare of light every time he commits to something.
   *
   * Purely presentational, and deliberately tied to the attack START rather
   * than to a timer — it makes the fight feel like it is reacting to him
   * instead of running on a metronome, and it gives the eye a second cue
   * beyond the floor marker.
   */
  _flare(power) {
    this.auraFlash = Math.max(this.auraFlash || 0, power);
    this.followCam.shake(0.18 * power);
    _tmp.copy(this.pos);
    this.effects.puff(_tmp, GOLD_HOT, Math.round(8 * power), 6 * power);
    // A shockwave ring in the air around him, not on the floor, so it never
    // reads as a danger marker.
    this.effects.ring(_tmp, 2, 10 * power, 0.3, GOLD, false, { x: 0, y: 1, z: 0 });
  }

  _startAttack(player) {
    this._flare(this.phase >= 3 ? 1.4 : 1.0);
    switch (this.attackName) {
      case 'swordCombo': this.attackT = 0; this.comboLeft = this.phase >= 3 ? 4 : 3; break;
      case 'starVolley': this._spawnStars(player, this.phase >= 2 ? 7 : 5, false); this.attackT = 1.1; break;
      case 'starBarrage': this.attackT = 0; this.barrageLeft = 5 + this.phase * 2; break;
      case 'beam': this._chargeBeam(player, false); break;
      case 'beamSweep': this._chargeBeam(player, true); break;
      case 'teleportStrike': this.attackT = 0; break;
      case 'starsThenCharge': this._spawnStars(player, 9, true); this.attackT = 1.0; break;
      case 'starsAndBeam': this._spawnStars(player, 10, true); this._chargeBeam(player, false); break;
      default: this.attackName = ''; break;
    }
  }

  _runAttack(dt, player, onHit) {
    this.attackT -= dt;

    switch (this.attackName) {
      case 'swordCombo': this._swordCombo(dt, player, onHit); return;
      case 'starBarrage': this._starBarrage(dt, player); return;
      case 'teleportStrike': this._teleportStrike(dt, player, onHit); return;
      case 'starsThenCharge':
        if (this.attackT <= 0) {
          this.attackName = 'swordCombo';
          this.comboLeft = 3;
          this.attackT = 0;
          this._dashToPlayer(player);
        }
        return;
      default:
        // Volleys and beams run entirely in their own update lists.
        if (this.attackT <= 0) this._endAttack();
        return;
    }
  }

  /**
   * Finish the current attack and start the rest window.
   *
   * Guarded because two paths can reach it for the same attack — the timer
   * in _runAttack and the beam expiring in _updateBeams. Without the guard
   * the second call would push the rest timer out again, quietly handing the
   * player a free extra opening.
   */
  _endAttack() {
    if (!this.attackName) return;
    this.attackName = '';
    this.attackTimer = this._restTime();
  }

  /**
   * A flurry of sword strokes. Each one draws its arc on the ground first;
   * the higher phases add a fourth stroke and shorten the gaps.
   */
  _swordCombo(dt, player, onHit) {
    const F = CFG.dungeon.frogath;
    if (this.attackT > 0) return;

    if (this.comboLeft <= 0) { this._endAttack(); return; }
    this.comboLeft--;

    // Close in on the player, staying airborne.
    this._dashToPlayer(player);

    const warn = Math.max(F.minWarning, [0.75, 0.6, 0.5, 0.42][this.phase - 1]);
    const reach = 13;
    _tmp.set(player.pos.x, this.center.y + 0.1, player.pos.z);
    this.effects.ring(_tmp, 1.5, reach, warn, GOLD_HOT, true);
    Audio.tone({ freq: 260, to: 620, dur: warn, type: 'square', volume: 0.1, pos: this.pos });

    // The stroke itself lands when the warning expires.
    this.warnings.push({
      at: warn,
      x: player.pos.x, y: this.center.y, z: player.pos.z,
      r: reach, dmg: F.swordDamage, kind: 'slash',
    });
    this.attackT = warn + [0.42, 0.34, 0.26, 0.2][this.phase - 1];
    this.swingT = 0.3;
  }

  /**
   * Swoop in to strike.
   *
   * He drops to just above head height to swing, then `_hover` floats him
   * back up over the next second. That dip is deliberately the player's whole
   * melee window: he is only reachable by the katana while he is committing
   * to an attack, so trading blows is a genuine risk rather than free damage.
   * Kunai can reach him at any height.
   */
  _dashToPlayer(player) {
    const a = Math.atan2(this.pos.x - player.pos.x, this.pos.z - player.pos.z);
    this.pos.set(
      player.pos.x + Math.sin(a) * 9,
      this.center.y + 2.2,
      player.pos.z + Math.cos(a) * 9
    );
    this.hoverTarget = null;
    _tmp.copy(this.pos);
    this.effects.puff(_tmp, GOLD, 14, 6);
  }

  /**
   * Stars from the sky. Half land where you are, half where you are going —
   * so neither standing still nor running in a straight line is safe.
   */
  _spawnStars(player, count, predictive) {
    const F = CFG.dungeon.frogath;
    const warn = Math.max(F.minWarning, 1.0 - this.phase * 0.1);
    for (let i = 0; i < count; i++) {
      let tx, tz;
      if (predictive && i % 2 === 1) {
        // Lead the player by where their velocity is taking them.
        const lead = 0.45 + Math.random() * 0.5;
        tx = player.pos.x + player.vel.x * lead;
        tz = player.pos.z + player.vel.z * lead;
      } else {
        const spread = 3 + i * 1.6;
        const a = Math.random() * Math.PI * 2;
        tx = player.pos.x + Math.cos(a) * Math.random() * spread;
        tz = player.pos.z + Math.sin(a) * Math.random() * spread;
      }
      // Keep them inside the arena.
      const dx = tx - this.center.x, dz = tz - this.center.z;
      const d = Math.hypot(dx, dz);
      if (d > F.arenaRadius - 2) {
        const s = (F.arenaRadius - 2) / d;
        tx = this.center.x + dx * s;
        tz = this.center.z + dz * s;
      }
      this._makeStar(tx, tz, warn + i * 0.06);
    }
    Audio.tone({ freq: 700, to: 1200, dur: 0.4, type: 'sine', volume: 0.1, pos: this.pos });
  }

  _makeStar(x, z, delay) {
    const F = CFG.dungeon.frogath;
    // The marker on the ground is the warning; the star arrives when it
    // finishes shrinking.
    _tmp.set(x, this.center.y + 0.08, z);
    this.effects.ring(_tmp, 5.5, 0.6, delay, GOLD_HOT, true);

    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.1, 0),
      new THREE.MeshBasicMaterial({ color: GOLD_HOT })
    );
    mesh.position.set(x, this.center.y + 70, z);
    this.scene.add(mesh);
    this.stars.push({
      mesh, x, z, delay, t: 0,
      y0: this.center.y + 70, y1: this.center.y + 1.2,
      exploded: false,
      // Deeper phases leave a burning patch behind.
      explodes: this.phase >= 3,
    });
  }

  _starBarrage(dt, player) {
    if (this.attackT > 0) return;
    if (this.barrageLeft <= 0) { this._endAttack(); return; }
    this.barrageLeft--;
    this._spawnStars(player, 4 + this.phase, true);
    this.attackT = [0.9, 0.75, 0.55, 0.4][this.phase - 1];
  }

  _updateStars(dt, player, onHit) {
    const F = CFG.dungeon.frogath;
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.t += dt;
      if (s.t < s.delay) {
        // Still falling from the sky toward its marker.
        const k = clamp(s.t / s.delay, 0, 1);
        s.mesh.position.y = lerp(s.y0, s.y1, k * k);
        s.mesh.rotation.x += dt * 6;
        s.mesh.rotation.y += dt * 4;
        continue;
      }
      if (!s.exploded) {
        s.exploded = true;
        _tmp.set(s.x, this.center.y + 0.6, s.z);
        this.effects.puff(_tmp, GOLD_HOT, 16, 8);
        this.effects.ring(_tmp, 0.5, 7, 0.35, GOLD, true);
        this.followCam.shake(0.25);
        Audio.hit(_tmp, true);
        const d = Math.hypot(player.pos.x - s.x, player.pos.z - s.z);
        if (d < 4.2) onHit(F.starDamage, _tmp);
        // A lingering danger zone in the later phases, drawn as it burns.
        if (s.explodes) {
          this.warnings.push({
            at: 0.6, x: s.x, y: this.center.y, z: s.z,
            r: 5.5, dmg: Math.round(F.starDamage * 0.6), kind: 'burn',
          });
          this.effects.ring(_tmp, 5.5, 5.6, 0.6, 0xff8a3c, true);
        }
      }
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      this.stars.splice(i, 1);
    }

    // Delayed ground hits (sword arcs and burning patches).
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.at -= dt;
      if (w.at > 0) continue;
      _tmp.set(w.x, w.y + 0.6, w.z);
      const d = Math.hypot(player.pos.x - w.x, player.pos.z - w.z);
      if (d < w.r) onHit(w.dmg, _tmp);
      if (w.kind === 'slash') {
        this.effects.slashArc(_tmp, this.yaw, 2, GOLD_HOT, w.r);
        this.effects.ring(_tmp, 0.5, w.r, 0.28, GOLD_HOT, true);
        this.followCam.shake(0.5);
        Audio.slash(_tmp, 2);
      } else {
        this.effects.puff(_tmp, 0xff8a3c, 10, 5);
      }
      this.warnings.splice(i, 1);
    }
  }

  /**
   * A beam of light across the arena. `sweep` makes it rotate, which turns a
   * dodge into a run.
   */
  _chargeBeam(player, sweep) {
    const F = CFG.dungeon.frogath;
    const warn = Math.max(F.minWarning, 1.15 - this.phase * 0.12);
    const yaw = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const beam = {
      yaw, warn, life: sweep ? 2.2 : 1.0, t: 0,
      sweep: sweep ? (Math.random() < 0.5 ? -1 : 1) * 0.9 : 0,
      fired: false, mesh: null,
    };
    this.beams.push(beam);
    this.attackT = warn + beam.life + 0.2;
    Audio.tone({
      freq: 120, to: 900, dur: warn, type: 'sawtooth', volume: 0.18, pos: this.pos,
    });
  }

  _updateBeams(dt, player, onHit) {
    const F = CFG.dungeon.frogath;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;

      if (b.t < b.warn) {
        // Warning: a thin line on the floor showing exactly where it lands.
        if (!b.marker) {
          b.marker = true;
        }
        if (Math.random() < dt * 40) {
          const d = Math.random() * F.arenaRadius * 2;
          _tmp.set(
            this.pos.x + Math.sin(b.yaw) * d, this.center.y + 0.1,
            this.pos.z + Math.cos(b.yaw) * d);
          this.effects.ring(_tmp, 1.6, 1.7, 0.25, GOLD_HOT, true);
        }
        continue;
      }

      if (!b.fired) {
        b.fired = true;
        b.mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({
            color: GOLD_HOT, transparent: true, opacity: 0.75, depthWrite: false,
          })
        );
        this.scene.add(b.mesh);
        this.followCam.shake(1.0);
        Audio.headshot(this.pos);
      }

      b.yaw += b.sweep * dt;
      const len = F.arenaRadius * 2.2;
      const cx = this.pos.x + Math.sin(b.yaw) * len * 0.5;
      const cz = this.pos.z + Math.cos(b.yaw) * len * 0.5;
      b.mesh.position.set(cx, this.center.y + 2.2, cz);
      b.mesh.rotation.y = b.yaw;
      const fade = clamp((b.life - (b.t - b.warn)) / b.life, 0, 1);
      b.mesh.scale.set(5.5 * fade, 5.0 * fade, len);
      b.mesh.material.opacity = 0.55 * fade + 0.25;

      // Distance from the player to the beam's centre line.
      const px = player.pos.x - this.pos.x;
      const pz = player.pos.z - this.pos.z;
      const along = px * Math.sin(b.yaw) + pz * Math.cos(b.yaw);
      const side = Math.abs(px * Math.cos(b.yaw) - pz * Math.sin(b.yaw));
      if (along > 0 && along < len && side < 3.2) {
        b.hitCooldown = (b.hitCooldown || 0) - dt;
        if (b.hitCooldown <= 0) {
          b.hitCooldown = 0.45;
          _tmp.set(player.pos.x, player.pos.y + 1, player.pos.z);
          onHit(F.beamDamage, _tmp);
        }
      }

      if (b.t > b.warn + b.life) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.beams.splice(i, 1);
        if (this.attackName === 'beam' || this.attackName === 'beamSweep'
          || this.attackName === 'starsAndBeam') {
          this._endAttack();
        }
      }
    }
  }

  /** Vanish, reappear behind the player, and swing immediately. */
  _teleportStrike(dt, player, onHit) {
    if (this.attackStep === 0) {
      this.attackStep = 1;
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, GOLD, 26, 12);
      this.effects.ring(_tmp, 0.5, 9, 0.35, GOLD_HOT, false, { x: 0, y: 1, z: 0 });
      Audio.dash(this.pos);
      this.rig.root.visible = false;
      this.attackT = 0.35;
      return;
    }
    if (this.attackStep === 1 && this.attackT <= 0) {
      this.attackStep = 2;
      // Behind them, relative to the way they are moving.
      const vx = player.vel.x, vz = player.vel.z;
      const m = Math.hypot(vx, vz);
      const bx = m > 1 ? -vx / m : Math.sin(this.yaw);
      const bz = m > 1 ? -vz / m : Math.cos(this.yaw);
      this.pos.set(
        player.pos.x + bx * 8,
        this.center.y + CFG.dungeon.frogath.hoverHeight,
        player.pos.z + bz * 8);
      this.hoverTarget = null;
      this.rig.root.visible = true;
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, GOLD_HOT, 26, 12);
      this.followCam.shake(0.5);
      Audio.dash(this.pos);
      this.attackName = 'swordCombo';
      this.comboLeft = this.phase >= 3 ? 3 : 2;
      this.attackT = 0;
    }
  }

  _clearHazards() {
    for (const s of this.stars) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
    this.stars.length = 0;
    for (const b of this.beams) {
      if (!b.mesh) continue;
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    this.beams.length = 0;
    this.warnings.length = 0;
  }

  // ------------------------------------------------------------ animation

  _animate(dt, player) {
    const rig = this.rig;
    rig.root.position.copy(this.pos);

    // Through the entrance he is posed against the CAMERA, not the world.
    //
    // He descends and speaks with his back to you — you are looking at the
    // shoulders of something that has not acknowledged you yet. Then, on
    // "Tell me, little mortal...", he turns all the way around and looks
    // straight down the lens.
    //
    // Camera-relative is the whole point: posing him in world space meant the
    // shot depended on which side of the arena you walked in from, so the
    // same beat read as a back, a profile or a face depending on your path.
    if (this.state !== STATE.FIGHT && this._camAngle !== undefined) {
      // `_camAngle` is the direction the camera sits in. A yaw equal to it
      // turns his BACK that way (see lookYaw); half a turn on top faces it.
      const want = this.turningToPlayer
        ? this._camAngle + Math.PI              // face the lens
        : this._camAngle + BACK_BIAS;           // shoulders to the lens
      if (!this._yawPosed) {
        // First framed frame: snap, so he is never caught mid-spin.
        this._yawPosed = true;
        this.yaw = want;
      } else {
        this.yaw = dampAngle(this.yaw, want, this.turningToPlayer ? 1.6 : 9, dt);
      }
    }
    rig.root.rotation.y = this.yaw + Math.PI;

    // A slow float, never a walk cycle.
    rig.body.position.y = Math.sin(this.bob * 1.1) * 0.28;
    rig.body.rotation.x = Math.sin(this.bob * 0.7) * 0.05;

    // Haloes turn at different speeds so they never look like one object,
    // and wind up as he loses control of himself.
    const spin = 1 + (this.phase - 1) * 0.9;
    rig.halo.rotation.z += dt * 0.5 * spin;
    rig.halo2.rotation.z -= dt * 0.3 * spin;
    // They also tilt out of true in the later phases — a god coming apart.
    const wob = (this.phase - 1) * 0.06;
    rig.halo.rotation.x = Math.PI / 2 + Math.sin(this.t * 1.7) * wob;
    rig.halo2.rotation.x = Math.PI / 2 - Math.sin(this.t * 1.3) * wob;

    // Limbs hang and sway.
    for (let i = 0; i < rig.limbs.length; i++) {
      const l = rig.limbs[i];
      if (i === 0 && (this.state === STATE.RAISE || this.swingT > 0)) continue;
      l.rotation.x = damp(l.rotation.x, Math.sin(this.bob * 0.9 + i) * 0.12, 3, dt);
      l.rotation.z = damp(l.rotation.z, 0, 3, dt);
    }
    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = 1 - this.swingT / 0.3;
      rig.limbs[0].rotation.x = lerp(-2.4, 0.9, k);
    }

    // The aura grows and brightens as he weakens — by the last phase he is
    // a dying star rather than a statue. `auraFlash` punches it outward on
    // every attack and decays, so the glow breathes with what he is doing.
    const hurt = 1 - this.fraction;
    const pulse = 0.5 + Math.sin(this.t * (3 + hurt * 9)) * 0.5;
    this.auraFlash = damp(this.auraFlash || 0, 0, 5, dt);
    const flash = this.auraFlash;
    rig.aura.material.opacity =
      0.08 + hurt * 0.30 + pulse * (0.03 + hurt * 0.12) + flash * 0.22;
    rig.aura.scale.setScalar(4.6 + hurt * 2.2 + pulse * hurt * 0.9 + flash * 1.6);
    const heat = new THREE.Color(GOLD).lerp(new THREE.Color(0xffffff), hurt * 0.8);
    rig.aura.material.color.copy(heat);
    rig.mats.inlay.color.copy(heat);
    rig.mats.halo.opacity = 0.75 + hurt * 0.25;

    // Eyes burn from the moment he asks his question.
    if (this.eyesHot || this.state === STATE.FIGHT) {
      for (const e of rig.eyes) e.scale.setScalar(0.34 * (1 + pulse * 0.18 + hurt * 0.3));
    }

    // Embers fall from him constantly once the fight is on.
    if (this.state === STATE.FIGHT && Math.random() < dt * (12 + hurt * 40)) {
      _tmp.set(
        this.pos.x + (Math.random() - 0.5) * 14,
        this.pos.y + (Math.random() - 0.5) * 10,
        this.pos.z + (Math.random() - 0.5) * 14);
      this.effects.puff(_tmp, Math.random() < hurt ? GOLD_HOT : GOLD, 2, 1.2);
    }

    if (this.state !== STATE.FIGHT) return;

    // A pool of light on the floor beneath him. It tracks him around the
    // arena, so even when he is behind you there is a moving glow telling
    // you where he is — which is the difference between a hard fight and a
    // cheap one.
    this._poolT = (this._poolT || 0) - dt;
    if (this._poolT <= 0) {
      this._poolT = 0.11;
      _tmp.set(this.pos.x, this.center.y + 0.06, this.pos.z);
      const r = 7 + hurt * 4 + flash * 3;
      this.effects.ring(_tmp, r, r * 0.86, 0.22, GOLD, true);
    }

    // Afterimages when he crosses the arena at speed — he does not walk, he
    // relocates, and the trail is what sells it.
    const moved = this._lastPos
      ? this.pos.distanceTo(this._lastPos) / Math.max(dt, 1e-5) : 0;
    if (!this._lastPos) this._lastPos = this.pos.clone();
    if (moved > 14) {
      _tmp.copy(this._lastPos).lerp(this.pos, 0.5);
      this.effects.puff(_tmp, GOLD, 3, 2);
    }
    this._lastPos.copy(this.pos);
  }

  dispose() {
    this._clearHazards();
    this.scene.remove(this.rig.root);
    this.rig.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
