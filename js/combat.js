/**
 * Combat: the katana combo state machine, cone hit detection, and health.
 *
 * Networking model is attacker-detects / victim-confirms: the attacking
 * client runs the hit test locally (so the swing feels instant with zero
 * latency) and sends a `hit` event; the victim applies the damage to its own
 * authoritative health and broadcasts the result. Nobody can silently set
 * another player's health — only request damage on them.
 */

import * as THREE from '../lib/three.module.js?v=v11';
import { CFG } from './config.js?v=v11';
import { clamp } from './util.js?v=v11';

const _to = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class Combat {
  constructor() {
    this.comboIndex = 0;
    this.attackTimer = 0;        // counts down through the current swing
    this.attackDuration = 0;
    this.cooldown = 0;
    this.comboTimer = 0;         // time left to chain into the next hit
    this.windupLeft = 0;
    this.active = false;         // hitbox is open
    this.hitThisSwing = new Set();
    this.hitstop = 0;
    this.justSwung = false;
    this.swingIndex = 0;
  }

  /** Normalised swing progress for the animation rig (1 -> 0). */
  get attackT() {
    return this.attackDuration > 0 ? clamp(this.attackTimer / this.attackDuration, 0, 1) : 0;
  }
  get attacking() { return this.attackTimer > 0; }

  /** Begin a swing if off cooldown. Returns the combo index, or -1. */
  tryAttack() {
    if (this.cooldown > 0) return -1;

    // Chain into the next combo step, or restart from the first.
    if (this.comboTimer > 0) this.comboIndex = (this.comboIndex + 1) % 3;
    else this.comboIndex = 0;

    const i = this.comboIndex;
    this.attackDuration = CFG.combat.attackCooldown[i];
    this.attackTimer = this.attackDuration;
    this.cooldown = CFG.combat.attackCooldown[i];
    this.windupLeft = CFG.combat.windup[i];
    this.comboTimer = CFG.combat.comboWindow;
    this.active = false;
    this.hitThisSwing.clear();
    this.justSwung = true;
    this.swingIndex = i;
    return i;
  }

  update(dt) {
    this.justSwung = false;

    // Hitstop freezes the swing for a few frames on contact — the single
    // cheapest trick for making a hit feel like it connected with something.
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }

    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.comboTimer > 0) this.comboTimer -= dt;
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.windupLeft > 0) {
        this.windupLeft -= dt;
        this.active = false;
      } else {
        // Hitbox stays open for the first part of the follow-through.
        this.active = this.attackTimer > this.attackDuration * 0.25;
      }
      if (this.attackTimer <= 0) { this.active = false; this.attackTimer = 0; }
    }
  }

  /**
   * Cone hit test against a list of targets.
   * @param origin  attacker feet position
   * @param yaw     attacker facing
   * @param targets array of { id, pos, dead, alive }
   * @returns array of { target, dir, damage, index }
   */
  resolve(origin, yaw, targets) {
    if (!this.active) return null;
    const i = this.comboIndex;
    const reach = CFG.combat.reach;
    const results = [];

    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));

    for (let k = 0; k < targets.length; k++) {
      const t = targets[k];
      if (!t || t.dead || this.hitThisSwing.has(t.id)) continue;

      _to.set(t.pos.x - origin.x, 0, t.pos.z - origin.z);
      const dist = _to.length();
      // Add the target's body radius so hits land on the frog, not its origin.
      if (dist > reach + CFG.move.radius) continue;

      const dy = t.pos.y - origin.y;
      if (dy > 2.6 || dy < -2.6) continue;      // vertical slice

      if (dist > 0.001) {
        _to.multiplyScalar(1 / dist);
        // Very close targets always connect regardless of facing, which stops
        // point-blank swings from mysteriously whiffing.
        if (dist > 1.2) {
          const angle = Math.acos(clamp(_to.dot(_fwd), -1, 1));
          if (angle > CFG.combat.arc) continue;
        }
      } else {
        _to.copy(_fwd);
      }

      this.hitThisSwing.add(t.id);
      results.push({
        target: t,
        dirX: _to.x, dirZ: _to.z,
        damage: CFG.combat.comboDamage[i],
        knockback: CFG.combat.knockback[i],
        knockbackUp: CFG.combat.knockbackUp[i],
        index: i,
        heavy: i === 2,
      });
    }

    if (!results.length) return null;
    this.hitstop = CFG.combat.hitstop[i];
    return results;
  }

  reset() {
    this.attackTimer = 0;
    this.cooldown = 0;
    this.comboTimer = 0;
    this.active = false;
    this.hitstop = 0;
    this.hitThisSwing.clear();
  }
}

// ---------------------------------------------------------------------------

/** Health, damage bookkeeping, regeneration and the death/respawn clock. */
export class Health {
  constructor(max = CFG.combat.maxHealth) {
    this.max = max;
    this.hp = max;
    this.dead = false;
    this.timeSinceDamage = 999;
    this.respawnTimer = 0;
    this.spawnProtection = CFG.combat.spawnProtection;
    this.invulnerable = 0;
    this.lastAttacker = null;
    this.justDied = false;
    this.justHurt = 0;
  }

  get fraction() { return clamp(this.hp / this.max, 0, 1); }
  get protected() { return this.spawnProtection > 0 || this.invulnerable > 0; }

  /**
   * Apply damage. Returns true if it landed.
   * @returns {boolean}
   */
  damage(amount, fromId) {
    if (this.dead || this.protected) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.timeSinceDamage = 0;
    this.justHurt = amount;
    this.lastAttacker = fromId || null;
    this.spawnProtection = 0;      // taking a hit ends spawn protection
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      this.justDied = true;
      this.respawnTimer = CFG.combat.respawnTime;
    }
    return true;
  }

  kill() {
    if (this.dead) return;
    this.hp = 0;
    this.dead = true;
    this.justDied = true;
    this.respawnTimer = CFG.combat.respawnTime;
  }

  revive() {
    this.hp = this.max;
    this.dead = false;
    this.respawnTimer = 0;
    this.timeSinceDamage = 999;
    this.spawnProtection = CFG.combat.spawnProtection;
    this.invulnerable = 0;
  }

  update(dt) {
    this.justDied = false;
    this.justHurt = 0;
    this.timeSinceDamage += dt;
    if (this.spawnProtection > 0) this.spawnProtection -= dt;
    if (this.invulnerable > 0) this.invulnerable -= dt;

    if (this.dead) {
      this.respawnTimer -= dt;
      return;
    }
    // Out-of-combat regeneration so a fight can't leave you permanently crippled.
    if (this.timeSinceDamage > CFG.combat.regenDelay && this.hp < this.max) {
      this.hp = Math.min(this.max, this.hp + CFG.combat.regenRate * dt);
    }
  }
}
