/**
 * Froglets — the game's currency, and the progress that survives a refresh.
 *
 * Everything is stored locally in the browser. That is a deliberate choice:
 * the game has no server of its own (multiplayer is peer-to-peer), so there
 * is nowhere trustworthy to keep a balance. It means progress is per-browser
 * and not carried between machines, which is the honest trade for a game
 * that ships as static files.
 *
 * Writes are debounced — awards can land several times a second during a
 * busy round, and localStorage is synchronous.
 */

import { CFG } from './config.js?v=v40';

export class Economy {
  constructor() {
    this.froglets = 0;
    this.secondsOnline = 0;
    this.totalEarned = 0;
    this.owned = { swords: [], frogs: [], kunai: [] };  // unlocked skins
    this.equipped = { sword: null, frog: null, kunai: null };
    this.abilities = [];        // purchased ability ids
    this.loadout = [];          // the (at most two) carried into a match
    // Dropped by the First Croak on a no-checkpoint run. Carried to the
    // statue in the arena, and consumed there.
    this.crystal = false;
    this.ascendedBeaten = false;

    this.pending = [];          // award popups the HUD has not shown yet
    this._saveTimer = 0;
    this._dirty = false;
    this._onlineAccum = 0;

    // Offline solo practice pays nothing. The gate lives here rather than at
    // each call site so no payout — present or future — can slip past it.
    this.earning = true;

    this.load();
  }

  // ------------------------------------------------------------ persistence

  load() {
    try {
      const raw = localStorage.getItem(CFG.economy.storageKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.froglets = Math.max(0, Number(d.froglets) || 0);
      this.secondsOnline = Number(d.secondsOnline) || 0;
      this.totalEarned = Number(d.totalEarned) || 0;
      if (d.owned) Object.assign(this.owned, d.owned);
      if (d.equipped) Object.assign(this.equipped, d.equipped);
      if (Array.isArray(d.abilities)) this.abilities = d.abilities;
      if (Array.isArray(d.loadout)) this.loadout = d.loadout;
      this.crystal = !!d.crystal;
      this.ascendedBeaten = !!d.ascendedBeaten;
    } catch (e) {
      // Corrupt or blocked storage must never stop the game starting.
      console.warn('[frogshin] could not read saved progress:', e);
    }
  }

  save() {
    this._dirty = false;
    try {
      localStorage.setItem(CFG.economy.storageKey, JSON.stringify({
        froglets: this.froglets,
        secondsOnline: this.secondsOnline,
        totalEarned: this.totalEarned,
        owned: this.owned,
        equipped: this.equipped,
        abilities: this.abilities,
        loadout: this.loadout,
        crystal: this.crystal,
        ascendedBeaten: this.ascendedBeaten,
      }));
    } catch (e) {
      console.warn('[frogshin] could not save progress:', e);
    }
  }

  // ---------------------------------------------------------------- balance

  /**
   * Add froglets and queue a popup.
   * @param reason short label shown beside the amount
   */
  award(amount, reason) {
    if (!this.earning) return;
    const n = Math.round(amount);
    if (n <= 0) return;
    this.froglets += n;
    this.totalEarned += n;
    this.pending.push({ amount: n, reason: reason || '' });
    this._dirty = true;
  }

  canAfford(cost) { return this.froglets >= cost; }

  /** Deduct a price. Returns false (and changes nothing) if too poor. */
  spend(cost) {
    if (!this.canAfford(cost)) return false;
    this.froglets -= cost;
    this._dirty = true;
    this.save();          // purchases save immediately, never debounced
    return true;
  }

  // --------------------------------------------------------------- unlocks

  owns(kind, id) {
    const list = this.owned[kind];
    return !!list && list.indexOf(id) !== -1;
  }

  unlock(kind, id) {
    if (!this.owned[kind]) this.owned[kind] = [];
    if (this.owns(kind, id)) return false;
    this.owned[kind].push(id);
    this._dirty = true;
    this.save();
    return true;
  }

  hasAbility(id) { return this.abilities.indexOf(id) !== -1; }

  unlockAbility(id) {
    if (this.hasAbility(id)) return false;
    this.abilities.push(id);
    // Buying something you cannot yet carry would be a bad surprise, so a
    // new ability equips itself while there is room.
    if (this.loadout.length < CFG.abilities.maxEquipped) this.loadout.push(id);
    this._dirty = true;
    this.save();
    return true;
  }

  isEquippedAbility(id) { return this.loadout.indexOf(id) !== -1; }

  /**
   * Toggle an ability in the carried loadout.
   * @returns {'on'|'off'|'full'} what happened
   */
  toggleAbility(id) {
    const at = this.loadout.indexOf(id);
    if (at !== -1) {
      this.loadout.splice(at, 1);
      this._dirty = true;
      this.save();
      return 'off';
    }
    if (this.loadout.length >= CFG.abilities.maxEquipped) return 'full';
    this.loadout.push(id);
    this._dirty = true;
    this.save();
    return 'on';
  }

  // ----------------------------------------------------------------- update

  /**
   * Tracks time played and pays out the periodic bonus.
   * Called every frame with real time, in menus as well as in a match.
   */
  update(dt) {
    this.secondsOnline += dt;
    // The time bonus PAUSES in solo practice rather than banking up silently
    // — otherwise the whole session would pay out the moment you left.
    if (this.earning) {
      this._onlineAccum += dt;
      if (this._onlineAccum >= CFG.economy.onlineInterval) {
        this._onlineAccum -= CFG.economy.onlineInterval;
        this.award(CFG.economy.onlineReward, 'Time played');
      }
    }

    // Debounced write: awards can arrive many times a second.
    if (this._dirty) {
      this._saveTimer -= dt;
      if (this._saveTimer <= 0) { this.save(); this._saveTimer = 3; }
    }
  }

  /** Minutes until the next time bonus, for the HUD tooltip. */
  get minutesToNextBonus() {
    return Math.max(0, (CFG.economy.onlineInterval - this._onlineAccum) / 60);
  }

  /** Take queued popups, clearing the queue. */
  drainPending() {
    if (!this.pending.length) return null;
    const out = this.pending.slice();
    this.pending.length = 0;
    return out;
  }
}
