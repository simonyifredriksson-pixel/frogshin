/**
 * Combat: the katana combo state machine, cone hit detection, and health.
 *
 * Networking model is attacker-detects / victim-confirms: the attacking
 * client runs the hit test locally (so the swing feels instant with zero
 * latency) and sends a `hit` event; the victim applies the damage to its own
 * authoritative health and broadcasts the result. Nobody can silently set
 * another player's health — only request damage on them.
 */

import * as THREE from '../lib/three.module.js?v=v119';
import { CFG } from './config.js?v=v119';
import { clamp } from './util.js?v=v119';

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
    /**
     * ═══ WHAT IS BEING SWUNG ══════════════════════════════════════════════
     *
     * All twenty weapons in the gear table used to swing at exactly the same
     * rate with exactly the same reach, differing only in a damage number.
     * This is what makes a maul feel like a maul: see `feelOf` in
     * js/weapons.js and `setWeapon` below.
     *
     * Defaults are the sword's, which are 1 across the board — so anything
     * that never calls `setWeapon` (the arena, the dungeon, the prologue,
     * every remote player) behaves exactly as it did.
     */
    this.speed = 1;
    this.hit = 1;
    this.reachMult = 1;
  }

  /**
   * Set the weapon's feel. `f` is a `feelOf` result, or null for the default.
   *
   * Deliberately does NOT touch a swing in progress: the timers are read
   * through `attackT`, which is a ratio, and re-scaling `attackDuration`
   * under a swing that is half done would make the animation jump. The next
   * swing is the first one that uses it, which is one swing of latency after
   * equipping something in a menu.
   */
  setWeapon(f) {
    this.speed = (f && f.speed) || 1;
    this.hit = (f && f.hit) || 1;
    this.reachMult = (f && f.reach) || 1;
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
    /**
     * THE WHOLE SWING SCALES, wind-up included.
     *
     * A maul at 0.66 speed takes half again as long to bring round AND half
     * again as long to recover, and its wind-up — the part before the hitbox
     * opens — stretches with it. That last part is what makes a slow weapon
     * a commitment rather than just a slow number: there is more time in
     * which you have started something you cannot stop.
     *
     * The combo WINDOW does not scale. It is how long you have to decide on
     * the next cut, and a slow weapon giving you longer to think would undo
     * the thing that makes it slow.
     */
    const s = this.speed || 1;
    this.attackDuration = CFG.combat.attackCooldown[i] / s;
    this.attackTimer = this.attackDuration;
    this.cooldown = this.attackDuration;
    this.windupLeft = CFG.combat.windup[i] / s;
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
   * @param reachOverride longer blades (the juggernaut's) reach further; 0
   *                      or omitted keeps the standard katana reach
   * @returns array of { target, dir, damage, index }
   */
  resolve(origin, yaw, targets, reachOverride) {
    if (!this.active) return null;
    const i = this.comboIndex;
    /**
     * A polearm reaches half again as far as a knife.
     *
     * `reachOverride` still wins outright — that is the juggernaut's blade,
     * which is a different weapon at a different scale and has nothing to do
     * with what the frog bought in a market.
     */
    const reach = reachOverride || CFG.combat.reach * (this.reachMult || 1);
    const results = [];

    _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));

    for (let k = 0; k < targets.length; k++) {
      const t = targets[k];
      if (!t || t.dead || this.hitThisSwing.has(t.id)) continue;

      _to.set(t.pos.x - origin.x, 0, t.pos.z - origin.z);
      const dist = _to.length();
      // Add the TARGET's own girth so hits land on its body, not its origin.
      // A boss five units wide would otherwise need you standing inside it.
      const girth = (t.hitbox && t.hitbox.bodyRadius) || CFG.move.radius;
      if (dist > reach + girth) continue;

      // Vertical slice. A target can widen it — a boss that floats above the
      // floor would otherwise be permanently unreachable by the katana.
      const vert = (t.hitbox && t.hitbox.vertical) || 2.6;
      const dy = t.pos.y - origin.y;
      if (dy > vert || dy < -vert) continue;

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
      /**
       * DAMAGE PER BLOW RISES AS THE SWING SLOWS, by design and by very
       * nearly the reciprocal: `hit × speed ≈ 1` in every class in
       * js/weapons.js. So a maul's output over a fight matches a sabre's of
       * the same `atk`, and the class is a choice about the shape of a fight
       * rather than a hidden re-ranking of the whole gear table — which is
       * what `atk` is for, and what every shop price is built on.
       */
      results.push({
        target: t,
        dirX: _to.x, dirZ: _to.z,
        damage: CFG.combat.comboDamage[i] * (this.hit || 1),
        // Knockback follows the weight too: a maul throws things.
        knockback: CFG.combat.knockback[i] * (this.hit || 1),
        knockbackUp: CFG.combat.knockbackUp[i],
        index: i,
        heavy: i === 2 || (this.hit || 1) >= 1.4,
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
    this.god = false;             // developer invincibility
  }

  get fraction() { return clamp(this.hp / this.max, 0, 1); }
  /**
   * `god` is the developer menu's invincibility. It sits in `protected`
   * rather than in `damage()` so that every path that already asks "can this
   * land?" — thrown kunai, boss attacks, the parry — honours it without
   * needing to know it exists.
   */
  get protected() {
    return this.god || this.spawnProtection > 0 || this.invulnerable > 0;
  }

  /**
   * Scale the health pool — the juggernaut's mountain of hit points.
   *
   * The CURRENT hp is rescaled by the same proportion rather than refilled,
   * so gaining or losing the role mid-round cannot be used as a free heal.
   */
  setMaxScale(scale) {
    const want = CFG.combat.maxHealth * (scale || 1);
    if (want === this.max) return;
    const frac = this.max > 0 ? this.hp / this.max : 1;
    this.max = want;
    this.hp = want * frac;
  }

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

  /**
   * THE PART OF THE CLOCK THAT MUST RUN EVEN WHILE THE GAME IS PAUSED.
   *
   * Spawn protection and dash i-frames make `protected` true, and `protected`
   * makes every incoming hit bounce. They used to count down only inside
   * `update`, which the pause skips — so pausing inside either window left
   * you INVULNERABLE for as long as you stayed paused. Spawn, take a hit,
   * press Escape, and nothing could touch you.
   *
   * That is not a freeze, it is a shield, and the other players never stopped
   * playing. It goes with the round clock, which is outside the pause check
   * for the same reason: pausing must not hand the person who paused
   * something the rest of the room does not get.
   *
   * Called by `update` on the normal path, and directly by the game loop
   * while paused — never both in one frame, or the windows would run out at
   * twice the rate.
   */
  tickProtection(dt) {
    if (this.spawnProtection > 0) this.spawnProtection -= dt;
    if (this.invulnerable > 0) this.invulnerable -= dt;
  }

  update(dt) {
    this.justDied = false;
    this.justHurt = 0;
    this.timeSinceDamage += dt;
    this.tickProtection(dt);

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
