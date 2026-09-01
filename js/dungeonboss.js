/**
 * The fourteen guardians.
 *
 * One class, four archetypes, and stats that compound with depth. Room 1 is
 * the juggernaut at a third of its strength; room 14 is roughly forty seconds
 * of uninterrupted damage and hits for half a health bar.
 *
 * Every attack follows the same three-beat shape — TELEGRAPH, STRIKE,
 * RECOVER — and the telegraph is always drawn as a ring on the floor before
 * anything can hurt you. The wind-up shortens as you descend but never drops
 * below CFG.dungeon.boss.minTelegraph, so a deep guardian is faster to read,
 * never unreadable. Difficulty here comes from pattern and pressure, not from
 * hiding the hitbox.
 */

import * as THREE from '../lib/three.module.js?v=v25';
import { CFG } from './config.js?v=v25';
import { clamp, lerp, damp, dampAngle } from './util.js?v=v25';
import { ToadModel } from './npc.js?v=v25';
import { findSkin, DEFAULT_SKIN } from './skins.js?v=v25';
import { Audio } from './audio.js?v=v25';

const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/**
 * Archetypes, cycled by room so no two neighbours fight the same way.
 *  brute    — slow, huge reach, enormous single blows
 *  duelist  — fast three-hit combos, short reach, closes hard
 *  charger  — winds up, then crosses the room in a straight line
 *  hurler   — keeps its distance and throws, punishing passive play
 */
export const ARCHETYPES = ['brute', 'duelist', 'charger', 'hurler'];

const STATE = {
  IDLE: 'idle',
  APPROACH: 'approach',
  TELEGRAPH: 'telegraph',
  STRIKE: 'strike',
  RECOVER: 'recover',
  DEAD: 'dead',
};

export class DungeonBoss {
  /**
   * @param index room number, 0-based
   * @param spot  where it waits
   */
  constructor(index, spot, scene, effects, collision) {
    const D = CFG.dungeon.boss;
    this.index = index;
    this.scene = scene;
    this.effects = effects;
    this.collision = collision;
    this.archetype = ARCHETYPES[index % ARCHETYPES.length];

    // Compounding stats. Room 1 (index 0) is deliberately gentle.
    const g = (base, growth) => base * Math.pow(growth, index);
    this.maxHealth = Math.round(g(D.baseHealth, D.healthGrowth));
    this.health = this.maxHealth;
    this.damage = Math.round(g(D.baseDamage, D.damageGrowth));
    this.speed = g(D.baseSpeed, D.speedGrowth);
    this.telegraph = Math.max(D.minTelegraph,
      D.telegraph * Math.pow(D.telegraphShrink, index));
    this.reach = D.reach;

    this._applyArchetype();

    // A guardian is a toad; the later ones carry the same katana the
    // juggernaut does, so the threat reads at a glance.
    const armed = index >= 4;
    this.model = new ToadModel(true,
      armed ? findSkin('swords', DEFAULT_SKIN.swords) : null);
    // They grow as you descend.
    this.scaleFactor = 1 + index * 0.045;
    this.model.root.scale.setScalar(1.85 * this.scaleFactor);

    this.pos = spot.clone();
    this.yaw = Math.PI;
    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);
    scene.add(this.model.root);

    this.state = STATE.IDLE;
    this.timer = 0;
    this.comboLeft = 0;
    this.active = false;
    this.moveSpeed = 0;
    this.struck = false;
    this.projectiles = [];
    this.chargeDir = new THREE.Vector3();
    this.justDied = false;
  }

  get name() {
    return GUARDIAN_NAMES[this.index] || ('GUARDIAN ' + (this.index + 1));
  }
  get fraction() { return clamp(this.health / this.maxHealth, 0, 1); }
  get alive() { return this.health > 0; }

  _applyArchetype() {
    switch (this.archetype) {
      case 'brute':
        this.reach *= 1.35;
        this.damage = Math.round(this.damage * 1.35);
        this.speed *= 0.7;
        this.telegraph *= 1.25;
        this.comboCount = 1;
        this.recoverTime = 0.85;
        break;
      case 'duelist':
        this.speed *= 1.3;
        this.damage = Math.round(this.damage * 0.7);
        this.telegraph *= 0.8;
        this.comboCount = 3;
        this.recoverTime = 0.5;
        break;
      case 'charger':
        this.speed *= 1.1;
        this.damage = Math.round(this.damage * 1.15);
        this.comboCount = 1;
        this.recoverTime = 0.7;
        break;
      case 'hurler':
        this.speed *= 0.85;
        this.damage = Math.round(this.damage * 0.85);
        this.comboCount = 1;
        this.recoverTime = 0.6;
        this.preferredRange = 16;
        break;
      default:
        this.comboCount = 1;
        this.recoverTime = 0.7;
        break;
    }
  }

  begin() {
    this.active = true;
    this.state = STATE.APPROACH;
    this.timer = 0.9;
  }

  /**
   * Damage from the player. Returns true if this blow killed it.
   */
  takeDamage(amount) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this.model.flinch();
    _tmp.set(this.pos.x, this.pos.y + 2.2 * this.scaleFactor, this.pos.z);
    this.effects.hitBurst(_tmp, { x: 0, y: 0, z: 1 }, amount > 30);
    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this.justDied = true;
      this.model.dead = true;
      this.effects.deathBurst(_tmp, 0x8a6f1a);
      Audio.death(this.pos);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------- AI

  /**
   * @param onHit called with the damage when an attack connects
   */
  update(dt, player, onHit) {
    this._updateProjectiles(dt, player, onHit);

    if (!this.active || !this.alive) {
      this.model.update(dt, { speed: 0, dead: !this.alive });
      this.model.root.position.copy(this.pos);
      return;
    }

    const target = player.pos;
    _to.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const dist = _to.length();
    if (dist > 0.001) _to.multiplyScalar(1 / dist);

    // It always turns to face you; there is no free circling.
    const want = Math.atan2(_to.x, _to.z);
    const turnRate = this.state === STATE.TELEGRAPH ? 2.2 : 5.5;
    this.yaw = dampAngle(this.yaw, want, turnRate, dt);

    this.timer -= dt;
    switch (this.state) {
      case STATE.APPROACH: this._approach(dt, dist, player); break;
      case STATE.TELEGRAPH: this._telegraph(dt, dist, player); break;
      case STATE.STRIKE: this._strike(dt, dist, player, onHit); break;
      case STATE.RECOVER:
        this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
        if (this.timer <= 0) { this.state = STATE.APPROACH; this.timer = 0.2; }
        break;
      default: break;
    }

    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);
    this.model.update(dt, {
      speed: this.moveSpeed,
      attackT: this.state === STATE.STRIKE ? 1 : 0,
    });
  }

  _approach(dt, dist, player) {
    // The hurler wants space, everyone else wants to be on top of you.
    const want = this.archetype === 'hurler' ? this.preferredRange : this.reach * 0.75;
    const diff = dist - want;
    if (Math.abs(diff) > 1.2) {
      const dir = Math.sign(diff);
      this.pos.addScaledVector(_to, this.speed * dir * dt);
      this.moveSpeed = this.speed;
    } else {
      this.moveSpeed = damp(this.moveSpeed, 0, 6, dt);
    }

    if (this.timer > 0) return;
    // In range (or, for a charger, far enough to be worth charging).
    const canStrike = this.archetype === 'hurler'
      || (this.archetype === 'charger' ? dist > 8 : dist < this.reach * 1.15);
    if (canStrike) {
      this.state = STATE.TELEGRAPH;
      this.timer = this.telegraph;
      this.comboLeft = this.comboCount;
      this._beginTelegraph(player);
    }
  }

  /** Draw the warning. Always on the floor, always before the hitbox opens. */
  _beginTelegraph(player) {
    const col = 0xff7a3c;
    if (this.archetype === 'charger') {
      this.chargeDir.copy(_to);
      // A lane down the room, so you know exactly where not to be.
      for (let i = 1; i <= 8; i++) {
        _tmp.set(this.pos.x + _to.x * i * 5, this.pos.y + 0.1, this.pos.z + _to.z * i * 5);
        this.effects.ring(_tmp, 2.4, 2.6, this.telegraph, col, true);
      }
    } else if (this.archetype === 'hurler') {
      _tmp.set(player.pos.x, player.pos.y + 0.1, player.pos.z);
      this.effects.ring(_tmp, 3.4, 3.6, this.telegraph, col, true);
    } else {
      _tmp.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
      this.effects.ring(_tmp, 1.0, this.reach * 2, this.telegraph, col, true);
    }
    Audio.tone({
      freq: 150, to: 380, dur: this.telegraph, type: 'sawtooth',
      volume: 0.12, pos: this.pos,
    });
  }

  _telegraph(dt) {
    this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
    if (this.timer > 0) return;
    this.state = STATE.STRIKE;
    this.timer = this.archetype === 'charger' ? 0.55 : 0.26;
    this.struck = false;
    this.model.swing(0.42);
    Audio.slash(this.pos, 2);
  }

  _strike(dt, dist, player, onHit) {
    if (this.archetype === 'charger') {
      // Cross the room in a straight line, hitting anything on the way.
      this.pos.addScaledVector(this.chargeDir, this.speed * 3.4 * dt);
      this.moveSpeed = this.speed * 3;
      const d = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (!this.struck && d < this.reach) {
        this.struck = true;
        onHit(this.damage, this.pos);
      }
    } else if (this.archetype === 'hurler') {
      if (!this.struck) {
        this.struck = true;
        this._hurl(player);
      }
    } else if (!this.struck) {
      this.struck = true;
      if (dist < this.reach * 1.2) onHit(this.damage, this.pos);
      _tmp.set(this.pos.x - Math.sin(this.yaw) * this.reach * 0.6,
        this.pos.y + 1.6, this.pos.z - Math.cos(this.yaw) * this.reach * 0.6);
      this.effects.slashArc(_tmp, this.yaw, 2, 0xffb03c, this.reach);
    }

    if (this.timer > 0) return;
    this.comboLeft--;
    if (this.comboLeft > 0) {
      // Chain into the next hit of the combo, with a shorter tell.
      this.state = STATE.TELEGRAPH;
      this.timer = this.telegraph * 0.55;
      this._beginTelegraph(player);
    } else {
      this.state = STATE.RECOVER;
      this.timer = this.recoverTime;
    }
  }

  /** A thrown rock — slow enough to sidestep, fast enough to punish standing. */
  _hurl(player) {
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 2.4, this.pos.z);
    const to = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z);
    const dir = to.sub(from).normalize();
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.65, 0),
      new THREE.MeshLambertMaterial({ color: 0x6b5a48 })
    );
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, dir, life: 3.2, speed: 26 });
    Audio.kunaiThrow(this.pos);
  }

  _updateProjectiles(dt, player, onHit) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.dir, p.speed * dt);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 7;

      const hitPlayer = p.mesh.position.distanceTo(player.pos) < 1.7;
      if (hitPlayer || p.life <= 0) {
        if (hitPlayer && onHit) onHit(this.damage, p.mesh.position);
        this.effects.dustPuff(p.mesh.position, 8, 3, 0x6b5a48);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  dispose() {
    this.scene.remove(this.model.root);
    this.model.dispose();
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
  }
}

/** Names for the fourteen, so a room is remembered by who was in it. */
export const GUARDIAN_NAMES = [
  'GROTT, THE GATE-KEEPER',
  'SILT, WARDEN OF THE SHALLOWS',
  'BRACK, THE THREE-STROKE',
  'MOSSHIDE, THE PATIENT',
  'VARN, WHO CAME RUNNING',
  'THE QUARRY-HAND',
  'OKKA, TWICE-DROWNED',
  'THE PALE CROAK',
  'HULDR, SPINE OF THE DEEP',
  'THE STONE THAT WALKS',
  'NIX, LAST OF THE CHOIR',
  'GRAVEWATER',
  'THE HOLLOW KING',
  'ZEHL, THE FINAL GUARDIAN',
];
