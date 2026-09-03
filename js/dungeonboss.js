/**
 * A dungeon guardian.
 *
 * One AI, driven by a per-boss moveset drawn from shared ATTACK PRIMITIVES.
 * That is what lets the fourteen fight genuinely differently — a leaping eel,
 * a stone thrower, a blinking duellist and a spinning brute all run this same
 * loop — while guaranteeing they cannot invent an unfair attack between them.
 *
 * Every primitive follows the same three beats:
 *   TELEGRAPH — the danger is drawn on the floor. Nothing can hurt you yet.
 *   STRIKE    — the hitbox opens, exactly where the marker was.
 *   RECOVER   — the opening. This is when you punish it.
 *
 * Stats compound with depth; the telegraph shortens but never below
 * CFG.dungeon.boss.minTelegraph, so a deep guardian is faster to read, never
 * unreadable.
 */

import * as THREE from '../lib/three.module.js?v=v41';
import { CFG } from './config.js?v=v41';
import { clamp, lerp, damp, dampAngle, lookYaw } from './util.js?v=v41';
import { GUARDIANS, buildGuardian } from './guardians.js?v=v41';
import { Audio } from './audio.js?v=v41';

const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * Moves that travel along the FLOOR, and can therefore be jumped.
 *
 * These are drawn in a distinct colour so the rule is learnable from one
 * look: an amber ring means "get off the ground", a red one means "get out
 * of the way". Without an answer other than running, a wide ground wave from
 * a big guardian is just an unavoidable tax.
 */
const GROUND_MOVES = new Set(['shockwave', 'spin']);
const WARN_RED = 0xff7a3c;      // move out of it
const WARN_AMBER = 0xffd24a;    // jump over it
/**
 * A teleport is coming — dash or parry it.
 *
 * Its own colour because it is the one warning you cannot answer by walking:
 * the guardian is about to be somewhere else, so moving out of the marked
 * circle achieves nothing. Violet reads as clearly different from the two
 * ground colours at a glance, which is the whole job.
 */
const WARN_BLINK = 0xb07aff;

const STATE = {
  IDLE: 'idle',
  APPROACH: 'approach',
  TELEGRAPH: 'telegraph',
  STRIKE: 'strike',
  RECOVER: 'recover',
  DEAD: 'dead',
};

/**
 * How each primitive behaves.
 *   range    the distance it wants to start from
 *   windup   telegraph multiplier
 *   recover  seconds of opening afterwards
 *   hits     how many strikes it chains
 *   dmg      multiplier on the boss's base damage
 */
const MOVES = {
  slam:      { range: 4.5, windup: 1.35, recover: 0.95, hits: 1, dmg: 1.4 },
  combo:     { range: 4.0, windup: 0.75, recover: 0.55, hits: 3, dmg: 0.7 },
  charge:    { range: 15, windup: 1.10, recover: 0.85, hits: 1, dmg: 1.2 },
  leap:      { range: 14, windup: 1.20, recover: 0.90, hits: 1, dmg: 1.35 },
  throw:     { range: 18, windup: 0.90, recover: 0.60, hits: 1, dmg: 0.9 },
  volley:    { range: 16, windup: 1.00, recover: 0.70, hits: 1, dmg: 0.7 },
  spin:      { range: 5.0, windup: 1.15, recover: 1.00, hits: 1, dmg: 1.1 },
  shockwave: { range: 8.0, windup: 1.25, recover: 0.90, hits: 1, dmg: 1.15 },
  spores:    { range: 10, windup: 1.10, recover: 0.80, hits: 1, dmg: 0.85 },
  puddle:    { range: 9.0, windup: 0.95, recover: 0.70, hits: 1, dmg: 0.8 },
  blink:     { range: 12, windup: 0.70, recover: 0.45, hits: 1, dmg: 0.9 },
  ringout:   { range: 12, windup: 1.20, recover: 0.85, hits: 1, dmg: 1.0 },
};

export class DungeonBoss {
  constructor(index, spot, scene, effects, collision) {
    const D = CFG.dungeon.boss;
    this.index = index;
    this.scene = scene;
    this.effects = effects;
    this.collision = collision;
    this.spec = GUARDIANS[index] || GUARDIANS[GUARDIANS.length - 1];
    this.moves = this.spec.moves;

    const g = (base, growth) => base * Math.pow(growth, index);
    // Per-boss trim on top of the curve, for the ones the curve overshot.
    const tune = this.spec.tune || 1;
    this.maxHealth = Math.round(g(D.baseHealth, D.healthGrowth) * tune);
    this.health = this.maxHealth;
    this.damage = Math.round(g(D.baseDamage, D.damageGrowth) * tune);
    this.speed = g(D.baseSpeed, D.speedGrowth);
    this.telegraph = Math.max(D.minTelegraph,
      D.telegraph * Math.pow(D.telegraphShrink, index));
    this.reach = D.reach;

    this.rig = buildGuardian(this.spec);
    this.model = this.rig;                 // the run treats these the same
    this.scaleFactor = 1.5 + index * 0.05;
    this.rig.root.scale.setScalar(this.scaleFactor);
    this.hovers = this.rig.hover;

    this.pos = spot.clone();
    if (this.hovers) this.pos.y += 1.6;
    this.baseY = this.pos.y;
    this.yaw = Math.PI;
    this.rig.root.position.copy(this.pos);
    this.setFacing(this.yaw);
    scene.add(this.rig.root);

    this.state = STATE.IDLE;
    this.timer = 0;
    this.active = false;
    this.moveSpeed = 0;
    this.struck = false;
    this.hitsLeft = 0;
    this.move = null;
    this.projectiles = [];
    this.hazards = [];
    this.chargeDir = new THREE.Vector3();
    this.leapFrom = new THREE.Vector3();
    this.leapTo = new THREE.Vector3();
    this.leapT = 0;
    this.justDied = false;
    this.windingGroundWave = false;
    this.t = Math.random() * 5;
    this.stride = 0;
    this.hurtT = 0;
    this.swingT = 0;
  }

  /**
   * The radius a move actually covers.
   *
   * ONE source of truth, read by both the warning marker and the hit test.
   * They used to be computed separately with different multipliers, so the
   * ring on the floor was smaller than the thing that hit you — the marker
   * lied. And the shockwave scaled to 40 units inside a 34-unit room, which
   * made the later guardians literally impossible to walk out of.
   */
  _moveRadius(move) {
    const R = this.reach * this.scaleFactor;
    switch (move) {
      case 'shockwave': return R * 2.2;
      case 'spin': return R * 1.4;
      case 'slam': return R * 1.3;
      case 'leap': return R * 1.35;
      case 'spores':
      case 'puddle': return R * 1.6;
      case 'charge': return R;
      default: return R * 1.2;                 // combo, blink
    }
  }

  get name() { return this.spec.name; }
  get blurb() { return this.spec.blurb; }
  get fraction() { return clamp(this.health / this.maxHealth, 0, 1); }
  get alive() { return this.health > 0; }

  setFacing(yaw) { this.rig.root.rotation.y = yaw + Math.PI; }

  begin() {
    this.active = true;
    this.state = STATE.APPROACH;
    this.timer = 0.9;
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtT = 0.18;
    _tmp.set(this.pos.x, this.pos.y + 1.8 * this.scaleFactor, this.pos.z);
    this.effects.hitBurst(_tmp, { x: 0, y: 0, z: 1 }, amount > 30);
    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this.justDied = true;
      this.effects.deathBurst(_tmp, this.spec.trim);
      Audio.death(this.pos);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- AI

  update(dt, player, onHit) {
    this.t += dt;
    this._updateProjectiles(dt, player, onHit);
    this._updateHazards(dt, player, onHit);

    if (!this.active || !this.alive) { this._animate(dt); return; }

    const target = player.pos;
    _to.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const dist = _to.length();
    if (dist > 0.001) _to.multiplyScalar(1 / dist);

    // A rig's yaw points along -Z, so the direction TO the player is not a
    // yaw that looks at them — see lookYaw. This guardian used to turn its
    // back on you and fight over its shoulder.
    const want = lookYaw(this.pos.x, this.pos.z, target.x, target.z);
    const turn = this.state === STATE.TELEGRAPH ? 2.0 : 5.5;
    this.yaw = dampAngle(this.yaw, want, turn, dt);

    this.timer -= dt;
    switch (this.state) {
      case STATE.APPROACH: this._approach(dt, dist, player); break;
      case STATE.TELEGRAPH:
        this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
        if (this.timer <= 0) this._beginStrike(player);
        break;
      case STATE.STRIKE: this._strike(dt, dist, player, onHit); break;
      case STATE.RECOVER:
        this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
        if (this.timer <= 0) { this.state = STATE.APPROACH; this.timer = 0.2; }
        break;
      default: break;
    }
    this._animate(dt);
  }

  /** Walk toward the range the chosen move wants to be at. */
  _approach(dt, dist, player) {
    // The move is picked BEFORE the approach so the walk has a purpose: a
    // thrower backs off, a duellist closes.
    if (!this.move) {
      this.move = this.moves[Math.floor(Math.random() * this.moves.length)];
    }
    const M = MOVES[this.move] || MOVES.combo;

    const diff = dist - M.range;
    if (Math.abs(diff) > 1.6) {
      this.pos.addScaledVector(_to, this.speed * Math.sign(diff) * dt);
      this.moveSpeed = this.speed;
    } else {
      this.moveSpeed = damp(this.moveSpeed, 0, 6, dt);
    }

    if (this.timer > 0) return;
    // Close enough to commit. The tolerance is generous so a boss never
    // paces forever trying to hit an exact distance.
    if (Math.abs(diff) > M.range * 0.6 + 2) return;

    this.state = STATE.TELEGRAPH;
    this.timer = this.telegraph * M.windup;
    this.hitsLeft = M.hits;
    this._drawWarning(player);
  }

  /**
   * Draw the danger. This is the contract with the player: whatever is about
   * to hurt them appears on the floor first, and stays there for the whole
   * wind-up.
   */
  _drawWarning(player) {
    const jumpable = GROUND_MOVES.has(this.move);
    this.windingGroundWave = jumpable;
    const col = this.move === 'blink' ? WARN_BLINK
      : (jumpable ? WARN_AMBER : WARN_RED);
    const w = Math.max(0.12, this.timer);
    // The marker is the hitbox. Not an approximation of it.
    const R = this._moveRadius(this.move);
    switch (this.move) {
      case 'charge':
        this.chargeDir.copy(_to);
        for (let i = 1; i <= 8; i++) {
          _tmp.set(this.pos.x + _to.x * i * 4.5, this.baseY + 0.1,
            this.pos.z + _to.z * i * 4.5);
          this.effects.ring(_tmp, R, R, w, col, true);
        }
        break;
      case 'leap': {
        // Land where they will be, not where they are — but the marker goes
        // on that spot too, so it is still entirely dodgeable. Running in a
        // straight line stops being an answer; changing direction is.
        const lead = w * 0.55;
        const vx = player.vel ? player.vel.x : 0;
        const vz = player.vel ? player.vel.z : 0;
        this.leapTo.set(
          player.pos.x + vx * lead, this.baseY, player.pos.z + vz * lead);
        _tmp.set(this.leapTo.x, this.baseY + 0.1, this.leapTo.z);
        this.effects.ring(_tmp, R, R, w, col, true);
        break;
      }
      case 'spin':
      case 'shockwave':
        // Grows from the boss out to exactly where it will reach.
        _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
        this.effects.ring(_tmp, 1, R, w, col, true);
        break;
      case 'ringout':
        _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
        this.effects.ring(_tmp, 1, R * 2.5, w, col, true);
        break;
      case 'spores':
      case 'puddle':
        _tmp.set(player.pos.x, this.baseY + 0.1, player.pos.z);
        this.effects.ring(_tmp, R, R, w, col, true);
        break;
      case 'blink':
        // It will reappear beside you and swing immediately, so the marker
        // has to cover the reach of that swing — not just say "something is
        // coming". A blink that telegraphs less than it hits is a cheap
        // shot, whatever else it is.
        _tmp.set(player.pos.x, this.baseY + 0.1, player.pos.z);
        this.effects.ring(_tmp, R * 2, R, w, col, true);
        break;
      case 'throw':
      case 'volley':
        // The alert says a shot is coming; the bolt itself, visible the whole
        // way, is what says where. There is no floor area to match here.
        _tmp.set(player.pos.x, this.baseY + 0.1, player.pos.z);
        this.effects.ring(_tmp, R * 1.6, R * 0.8, w, col, true);
        break;
      default:                                   // slam, combo
        // Drawn AHEAD of the boss, because the strike lunges forward — the
        // marker has to cover where the blow lands, not where it starts.
        _tmp.set(this.pos.x + _to.x * R * 0.4, this.baseY + 0.1,
          this.pos.z + _to.z * R * 0.4);
        this.effects.ring(_tmp, 1.0, R * 1.6, w, col, true);
        break;
    }
    // A ground wave gets its own two-note rise, so it is identifiable with
    // your back turned.
    Audio.tone({
      freq: jumpable ? 110 : 150, to: jumpable ? 250 : 380,
      dur: w, type: 'sawtooth', volume: 0.12, pos: this.pos,
    });
  }

  _beginStrike(player) {
    this.state = STATE.STRIKE;
    this.struck = false;
    this.swung = false;
    this.blinkHold = 0;
    this.swingT = 0.32;
    this.timer = (this.move === 'charge' || this.move === 'leap') ? 0.5 : 0.24;

    if (this.move === 'blink') {
      // Vanish and reappear beside them — and then WAIT.
      //
      // Arriving and swinging on the same frame is unreactable however well
      // the wind-up was telegraphed, because the wind-up happened somewhere
      // else: by the time you can see where he actually is, the blade is
      // already on you. The pause is what turns the teleport back into an
      // attack you can answer, and the ring below is drawn at the spot he is
      // really standing rather than the one he left.
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, this.spec.trim, 18, 8);
      const a = Math.random() * Math.PI * 2;
      this.pos.set(player.pos.x + Math.cos(a) * 5, this.baseY,
        player.pos.z + Math.sin(a) * 5);
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, this.spec.trim, 18, 8);

      this.blinkHold = CFG.dungeon.boss.blinkDelay;
      this.timer += this.blinkHold;          // the strike still gets its time
      const BR = this._moveRadius('blink');
      _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
      this.effects.ring(_tmp, BR * 2, BR * 1.2, this.blinkHold, WARN_BLINK, true);
      Audio.dash(this.pos);
      Audio.tone({
        freq: 300, to: 820, dur: this.blinkHold, type: 'sine',
        volume: 0.14, pos: this.pos,
      });
    }
    if (this.move === 'leap') {
      this.leapT = 0;
      this.leapFrom.copy(this.pos);
    }
    Audio.slash(this.pos, 2);
  }

  _strike(dt, dist, player, onHit) {
    const M = MOVES[this.move] || MOVES.combo;
    const dmg = Math.round(this.damage * M.dmg);
    // The same radius the marker was drawn at.
    const R = this._moveRadius(this.move);

    // He has landed, but the blade has not moved yet. Nothing can hurt you
    // for this beat — it is the window to dash out or set a parry, and it is
    // the same length every time so it can be learned.
    if (this.blinkHold > 0) {
      this.blinkHold -= dt;
      this.moveSpeed = 0;
      return;
    }

    switch (this.move) {
      case 'charge':
        this.pos.addScaledVector(this.chargeDir, this.speed * 3.6 * dt);
        this.moveSpeed = this.speed * 3;
        if (!this.struck && this._near(player, R)) {
          this.struck = true;
          onHit(dmg, this.pos);
        }
        break;

      case 'leap': {
        // An arc that lands on the marked spot.
        this.leapT = Math.min(1, this.leapT + dt / 0.5);
        const k = this.leapT;
        this.pos.lerpVectors(this.leapFrom, this.leapTo, k);
        this.pos.y = this.baseY + Math.sin(k * Math.PI) * 7;
        this.moveSpeed = this.speed * 2;
        if (k >= 1 && !this.struck) {
          this.struck = true;
          _tmp.set(this.pos.x, this.baseY + 0.3, this.pos.z);
          this.effects.ring(_tmp, 0.5, R * 2.4, 0.35, this.spec.trim, true);
          this.effects.dustPuff(_tmp, 16, 6, 0xcfc0a0);
          if (this._near(player, R * 1.2)) onHit(dmg, this.pos);
        }
        break;
      }

      case 'throw':
        if (!this.struck) { this.struck = true; this._hurl(player, dmg, 24, 0); }
        break;

      case 'volley':
        if (!this.struck) {
          this.struck = true;
          // Three bolts, fanned — standing still is not an answer.
          for (let i = -1; i <= 1; i++) this._hurl(player, dmg, 30, i * 0.22);
        }
        break;

      case 'ringout':
        if (!this.struck) {
          this.struck = true;
          // An outward ring: move through a gap, or wear it. It descends to
          // body height as it spreads, so a hovering caster's ring still
          // threatens the floor rather than passing overhead.
          const drop = (player.pos.y + 1.0 - (this.pos.y + 1.2)) / 14;
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            this._hurlDir(Math.sin(a), drop, Math.cos(a), dmg, 22);
          }
        }
        break;

      // --- ground waves: wide, but you can JUMP them ---
      case 'spin':
      case 'shockwave':
        if (!this.struck) {
          this.struck = true;
          _tmp.set(this.pos.x, this.baseY + 0.35, this.pos.z);
          this.effects.ring(_tmp, 0.5, R, 0.5, WARN_AMBER, true);
          if (this.move === 'shockwave') {
            this.effects.dustPuff(_tmp, 20, 7, 0xcfc0a0);
          }
          // It travels along the floor, so being off the floor clears it.
          // Without this the wide late-game waves were simply a tax: they
          // out-reach the room and no amount of running gets you out.
          if (this._near(player, R) && this._grounded(player)) {
            onHit(dmg, this.pos);
          }
        }
        break;

      case 'spores':
      case 'puddle':
        if (!this.struck) {
          this.struck = true;
          // A patch of floor that stays dangerous, and stays drawn.
          this.hazards.push({
            x: player.pos.x, z: player.pos.z, y: this.baseY,
            r: R, life: this.move === 'puddle' ? 6 : 3.5,
            dmg: Math.round(dmg * 0.5), tick: 0, color: this.spec.trim,
            jumpable: this.move === 'puddle',
          });
        }
        break;

      default: {
        // Lunge into the swing. A melee guardian moves slower than a
        // sprinting frog, so without this last-moment surge it could be
        // kited around the room forever and never land anything — which is
        // not a hard fight, it is a non-fight.
        this.pos.addScaledVector(_to, this.speed * 2.4 * dt);
        this.moveSpeed = this.speed * 2;
        if (!this.struck && this._near(player, R * 1.2)) {
          this.struck = true;
          onHit(dmg, this.pos);
        }
        if (!this.swung) {
          this.swung = true;
          _tmp.set(this.pos.x - Math.sin(this.yaw) * R * 0.6,
            this.pos.y + 1.4, this.pos.z - Math.cos(this.yaw) * R * 0.6);
          this.effects.slashArc(_tmp, this.yaw, 2, this.spec.trim, R);
        }
        break;
      }
    }

    if (this.timer > 0) return;
    this.hitsLeft--;
    if (this.hitsLeft > 0 && this.move === 'combo') {
      // Chain the combo, with a shorter tell each time.
      this.state = STATE.TELEGRAPH;
      this.timer = this.telegraph * 0.5;
      this._drawWarning(player);
    } else {
      this.state = STATE.RECOVER;
      this.timer = M.recover;
      this.move = null;
      this.pos.y = this.baseY;
    }
  }

  _near(player, r) {
    return Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < r;
  }

  /**
   * Is the player on the floor?
   *
   * Both a real jump and the moment mid-dash count as airborne, so a
   * well-timed dash over a wave works too — dodging the ground with the
   * dodge button is exactly what a player will try first.
   */
  _grounded(player) {
    if (player.grounded === false) return false;
    if (player.pos.y > this.baseY + 1.1) return false;
    return true;
  }

  /**
   * Throw at where the player is GOING, not where they are.
   *
   * Firing at the current position means anyone who keeps moving is
   * untouchable — a bolt with a half-second flight time arrives at empty
   * floor every time. Leading the shot makes running in a straight line the
   * wrong answer, which is the whole point of a ranged attack.
   */
  _hurl(player, dmg, speed, spread) {
    // Aim at the CHEST, in three dimensions. The hovering guardians throw
    // from well above head height, so a dead-level shot sailed over the
    // player every single time — they were firing at nothing.
    const aimY = player.pos.y + 1.0;
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const flight = Math.hypot(dx, dz) / speed;
    const vx = player.vel ? player.vel.x : 0;
    const vz = player.vel ? player.vel.z : 0;
    const a = Math.atan2(dx + vx * flight, dz + vz * flight) + (spread || 0);
    const flat = Math.hypot(dx + vx * flight, dz + vz * flight);
    const dy = (aimY - (this.pos.y + 1.2)) / Math.max(flat, 0.001);
    this._hurlDir(Math.sin(a), dy, Math.cos(a), dmg, speed);
  }

  _hurlDir(dx, dy, dz, dmg, speed) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 0),
      new THREE.MeshBasicMaterial({ color: this.spec.trim })
    );
    mesh.position.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, dx: dx / len, dy: dy / len, dz: dz / len, speed, life: 3.4, dmg,
    });
    Audio.kunaiThrow(this.pos);
  }

  _updateProjectiles(dt, player, onHit) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.x += p.dx * p.speed * dt;
      p.mesh.position.y += p.dy * p.speed * dt;
      p.mesh.position.z += p.dz * p.speed * dt;
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 7;
      // Against the player's body centre, not their feet.
      _tmp.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
      const hit = p.mesh.position.distanceTo(_tmp) < 1.9;
      if (hit || p.life <= 0) {
        if (hit && onHit) onHit(p.dmg, p.mesh.position);
        this.effects.puff(p.mesh.position, this.spec.trim, 8, 4);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Lingering floor hazards — spore clouds and puddles. */
  _updateHazards(dt, player, onHit) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      h.tick -= dt;
      // The ring is redrawn for as long as the hazard exists, so a patch of
      // floor is never quietly dangerous.
      if (h.tick <= 0) {
        h.tick = 0.45;
        _tmp.set(h.x, h.y + 0.1, h.z);
        this.effects.ring(_tmp, h.r, h.r, 0.45, h.color, true);
        // A puddle is on the floor and can be hopped; a spore cloud fills
        // the air above it and cannot.
        const clears = h.jumpable && !this._grounded(player);
        if (!clears && Math.hypot(player.pos.x - h.x, player.pos.z - h.z) < h.r) {
          onHit(h.dmg, _tmp);
        }
      }
      if (h.life <= 0) this.hazards.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ animation

  _animate(dt) {
    const rig = this.rig;
    rig.root.position.copy(this.pos);
    this.setFacing(this.yaw);

    if (!this.alive) {
      rig.root.rotation.z = damp(rig.root.rotation.z, Math.PI * 0.45, 6, dt);
      rig.body.position.y = damp(rig.body.position.y, -0.3, 6, dt);
      return;
    }

    const moving = this.moveSpeed > 0.6;
    if (moving) this.stride += dt * (3.4 + Math.min(this.moveSpeed, 16) * 0.5);
    const sw = Math.sin(this.stride);

    // The hovering ones drift; the walking ones tramp.
    if (this.hovers) {
      rig.body.position.y = Math.sin(this.t * 1.4) * 0.22;
      rig.body.rotation.x = damp(rig.body.rotation.x, moving ? 0.16 : 0.04, 4, dt);
    } else {
      rig.body.position.y = Math.abs(sw) * (moving ? 0.10 : 0)
        + Math.sin(this.t * 1.3) * 0.02;
      rig.body.rotation.x = damp(rig.body.rotation.x, moving ? 0.18 : 0.08, 6, dt);
      for (const leg of rig.legs) {
        const phase = leg.side > 0 ? sw : -sw;
        leg.hip.rotation.x = damp(leg.hip.rotation.x, moving ? phase * 0.6 : -0.15, 14, dt);
        leg.shin.rotation.x = damp(leg.shin.rotation.x,
          moving ? clamp(-phase, 0, 1) * 0.85 + 0.1 : 0.4, 14, dt);
      }
    }
    rig.head.rotation.x = damp(rig.head.rotation.x, moving ? -0.14 : -0.04, 6, dt);

    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = 1 - this.swingT / 0.32;
      rig.arms[1].shoulder.rotation.x = lerp(-2.5, 1.0, k);
      rig.arms[1].fore.rotation.x = lerp(-1.1, -0.1, k);
      rig.arms[0].shoulder.rotation.x = damp(rig.arms[0].shoulder.rotation.x, -0.4, 12, dt);
    } else {
      for (const arm of rig.arms) {
        const phase = arm.side > 0 ? -sw : sw;
        arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x,
          moving ? phase * 0.45 : 0.08, 10, dt);
        arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, arm.side * 0.2, 8, dt);
        arm.fore.rotation.x = damp(arm.fore.rotation.x, -0.45, 10, dt);
      }
    }

    if (this.hurtT > 0) {
      this.hurtT -= dt;
      rig.body.position.x = Math.sin(this.hurtT * 90) * 0.07;
    } else {
      rig.body.position.x = damp(rig.body.position.x, 0, 12, dt);
    }
  }

  dispose() {
    this.scene.remove(this.rig.root);
    this.rig.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
    this.hazards.length = 0;
  }
}

export const GUARDIAN_NAMES = GUARDIANS.map((g) => g.name);
