/**
 * Stamina.
 *
 * Sprinting drains it continuously and every jump costs a lump sum. Hitting
 * zero puts the player into an *exhausted* lockout: sprint and jump are both
 * refused until stamina climbs back to CFG.stamina.recoverTo (70%). Regen is
 * slightly faster while locked out so the punishment is a real setback
 * without becoming a long dead stop.
 */

import { CFG } from './config.js?v=v54';
import { clamp } from './util.js?v=v54';

export class Stamina {
  constructor(max = CFG.stamina.max) {
    this.max = max;
    this.value = max;
    this.exhausted = false;
    this.sinceSpend = 999;
    // One-frame flags the game loop reads for feedback (sound, HUD flash).
    this.justExhausted = false;
    this.justRecovered = false;
  }

  get fraction() { return clamp(this.value / this.max, 0, 1); }

  /** True when the player is allowed to sprint or jump. */
  get canAct() { return !this.exhausted && this.value > 0; }

  /** How much of the lockout is left, 0..1 — drives the HUD warning. */
  get recoveryProgress() {
    if (!this.exhausted) return 1;
    return clamp(this.fraction / CFG.stamina.recoverTo, 0, 1);
  }

  /**
   * Pay a one-off cost (a jump). Returns false if the player is locked out,
   * in which case nothing is spent and the action must not happen.
   */
  spend(amount) {
    if (!this.canAct) return false;
    this.value = Math.max(0, this.value - amount);
    this.sinceSpend = 0;
    if (this.value <= 0) this._exhaust();
    return true;
  }

  /**
   * Continuous drain (sprinting). Pass an already dt-scaled amount.
   * Returns false the moment the tank runs dry, so the caller can drop out
   * of sprint on the same frame.
   */
  drain(amount) {
    if (!this.canAct) return false;
    this.value = Math.max(0, this.value - amount);
    this.sinceSpend = 0;
    if (this.value <= 0) { this._exhaust(); return false; }
    return true;
  }

  _exhaust() {
    if (this.exhausted) return;
    this.exhausted = true;
    this.justExhausted = true;
  }

  update(dt) {
    this.justExhausted = false;
    this.justRecovered = false;

    this.sinceSpend += dt;
    if (this.sinceSpend >= CFG.stamina.regenDelay && this.value < this.max) {
      const rate = CFG.stamina.regen * (this.exhausted ? CFG.stamina.exhaustedRegenMult : 1);
      this.value = Math.min(this.max, this.value + rate * dt);
    }

    if (this.exhausted && this.fraction >= CFG.stamina.recoverTo) {
      this.exhausted = false;
      this.justRecovered = true;
    }
  }

  reset() {
    this.value = this.max;
    this.exhausted = false;
    this.sinceSpend = 999;
    this.justExhausted = false;
    this.justRecovered = false;
  }
}

/**
 * Bar colour band for a stamina fraction.
 * Bands are defined highest-first so the first match wins.
 */
export function staminaBand(fraction) {
  if (fraction >= 0.70) return 'bright';    // bright green
  if (fraction >= 0.50) return 'dark';      // dark green
  if (fraction >= 0.30) return 'yellow';
  if (fraction >= 0.10) return 'red';
  return 'darkred';
}
