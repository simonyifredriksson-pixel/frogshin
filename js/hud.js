/**
 * In-game HUD.
 *
 * Deliberately sparse: health, the two ability meters, a crosshair that
 * reacts to grapple targets, and transient feedback (hit markers, kill feed,
 * damage vignette). Everything else stays off screen until it matters.
 */

import { clamp } from './util.js';
import { CFG } from './config.js';
import { staminaBand } from './stamina.js';
import { ITEM_ICONS, SLOT_LABELS } from './items.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.healthFill = $('health-fill');
    this.healthText = $('health-text');
    this.healthBar = $('health-bar');
    this.staminaFill = $('stamina-fill');
    this.staminaBar = $('stamina-bar');
    this.staminaText = $('stamina-text');
    this.dashFill = $('dash-fill');
    this.dashRoot = $('dash-meter');
    this.dashCharges = $('dash-charges');
    this.grappleFill = $('grapple-fill');
    this.grappleRoot = $('grapple-meter');
    this.crosshair = $('crosshair');
    this.killfeed = $('killfeed');
    this.respawn = $('respawn');
    this.respawnCount = $('respawn-count');
    this.respawnKiller = $('respawn-killer');
    this.hitmarkerEl = $('hitmarker');
    this.vignette = $('vignette');
    this.roomInfo = $('room-info');
    this.roomCode = $('room-code');
    this.netStatus = $('net-status');
    this.scoreboard = $('scoreboard');
    this.scoreRows = $('score-rows');
    this.toastEl = $('toast');
    this.hotbarEl = $('hotbar');
    this.pickupPrompt = $('pickup-prompt');
    this.slotEls = [];
    this.onSlotClick = null;
    this.comboEl = $('combo');
    this.speedEl = $('speed-lines');

    this._hitTimer = 0;
    this._vignetteLevel = 0;
    this._toastTimer = 0;
    this._comboTimer = 0;
    this._lastHealth = 1;
    this._flashTimer = 0;
    this._feedItems = [];
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  // ---------------------------------------------------------------- meters

  setHealth(frac) {
    const pct = clamp(frac, 0, 1) * 100;
    this.healthFill.style.width = pct + '%';
    this.healthText.textContent = Math.ceil(clamp(frac, 0, 1) * CFG.combat.maxHealth);
    this.healthFill.classList.toggle('low', frac < 0.3);
    this.healthFill.classList.toggle('mid', frac >= 0.3 && frac < 0.6);
    // Pulse the bar when health drops.
    if (frac < this._lastHealth - 0.001) {
      this.healthBar.classList.remove('bump');
      void this.healthBar.offsetWidth;      // restart the CSS animation
      this.healthBar.classList.add('bump');
    }
    this._lastHealth = frac;
  }

  // --------------------------------------------------------------- hotbar

  /**
   * Build the hotbar once. Slots are clickable as well as key-bound, so the
   * number under each slot is both a label and a genuine shortcut.
   */
  buildHotbar(inventory) {
    this.hotbarEl.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < inventory.slots.length; i++) {
      const el = document.createElement('div');
      el.className = 'hb-slot';
      el.innerHTML =
        '<div class="hb-icon"></div>' +
        '<div class="hb-count"></div>' +
        '<div class="hb-key">' + (SLOT_LABELS[i] || '') + '</div>';
      // The HUD is pointer-events:none, so slots opt back in individually.
      el.style.pointerEvents = 'auto';
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (this.onSlotClick) this.onSlotClick(i);
      });
      this.hotbarEl.appendChild(el);
      this.slotEls.push(el);
    }
    this._hotbarBuilt = true;
  }

  /** Refresh icons, counts and the selection highlight. */
  setHotbar(inventory) {
    if (!this._hotbarBuilt) this.buildHotbar(inventory);
    for (let i = 0; i < this.slotEls.length; i++) {
      const el = this.slotEls[i];
      const slot = inventory.slots[i];
      const icon = el.querySelector('.hb-icon');
      const count = el.querySelector('.hb-count');

      if (!slot) {
        if (el.dataset.item !== '') { icon.innerHTML = ''; el.dataset.item = ''; }
        count.textContent = '';
        el.classList.add('empty');
      } else {
        el.classList.remove('empty');
        if (el.dataset.item !== slot.item.id) {
          el.dataset.item = slot.item.id;
          icon.innerHTML = ITEM_ICONS[slot.item.id] || '';
        }
        // Infinite items (the katana) show no number.
        count.textContent = slot.item.infinite ? '' : String(slot.count);
        count.classList.toggle('none', !slot.item.infinite && slot.count <= 0);
      }
      el.classList.toggle('sel', i === inventory.selected);
    }
  }

  /** "Press E" prompt shown when standing near a crate. */
  setPickupPrompt(show) {
    if (show === this._pickupShown) return;
    this._pickupShown = show;
    this.pickupPrompt.classList.toggle('show', show);
  }

  /**
   * Stamina bar. Colour band comes from the shared `staminaBand` helper so
   * the HUD and the gameplay thresholds can never disagree.
   * @param frac      0..1
   * @param exhausted locked out until recovery
   */
  setStamina(frac, exhausted) {
    const f = clamp(frac, 0, 1);
    this.staminaFill.style.width = (f * 100) + '%';
    this.staminaText.textContent = Math.ceil(f * CFG.stamina.max);

    const band = 's-' + staminaBand(f);
    if (band !== this._stamBand) {
      this._stamBand = band;
      this.staminaFill.className = 'fill ' + band;
    }
    if (exhausted !== this._stamSpent) {
      this._stamSpent = exhausted;
      this.staminaBar.classList.toggle('spent', exhausted);
    }
  }

  /**
   * @param cooldown remaining cooldown in seconds
   * @param charges  air dashes left
   * @param grounded whether charges are irrelevant right now
   */
  setDash(cooldown, charges, grounded) {
    const ready = cooldown <= 0;
    const frac = ready ? 1 : 1 - cooldown / CFG.dash.cooldown;
    this.dashFill.style.width = (frac * 100) + '%';
    this.dashRoot.classList.toggle('ready', ready);
    // Charge pips only mean something in the air.
    const usable = grounded ? CFG.dash.airCharges : charges;
    this.dashCharges.textContent = ready
      ? (usable > 0 ? '●'.repeat(Math.max(1, usable)) : '○')
      : '○';
  }

  setGrapple(cooldown, active, hasTarget) {
    const ready = cooldown <= 0;
    const frac = ready ? 1 : 1 - cooldown / CFG.grapple.cooldown;
    this.grappleFill.style.width = (frac * 100) + '%';
    this.grappleRoot.classList.toggle('ready', ready);
    this.grappleRoot.classList.toggle('active', active);
    this.grappleRoot.classList.toggle('target', ready && hasTarget && !active);
  }

  /** 'idle' | 'target' | 'attached' | 'hidden' */
  setCrosshair(state) {
    if (this._crossState === state) return;
    this._crossState = state;
    this.crosshair.className = 'cross-' + state;
  }

  // -------------------------------------------------------------- feedback

  hitmarker(heavy) {
    this.hitmarkerEl.classList.remove('pop', 'pop-heavy');
    void this.hitmarkerEl.offsetWidth;
    this.hitmarkerEl.classList.add(heavy ? 'pop-heavy' : 'pop');
    this._hitTimer = 0.22;
  }

  /** Red edge flash. `amount` roughly 0..1. */
  damageFlash(amount) {
    this._vignetteLevel = Math.min(1, this._vignetteLevel + amount);
  }

  combo(n) {
    if (n < 2) return;
    this.comboEl.textContent = n + ' HIT';
    this.comboEl.classList.remove('show');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('show');
    this._comboTimer = 1.4;
  }

  /** Add a line to the kill feed. */
  addKill(killer, victim, selfName) {
    const el = document.createElement('div');
    el.className = 'feed-item';
    const k = document.createElement('span');
    k.className = 'feed-name' + (killer === selfName ? ' me' : '');
    k.textContent = killer || 'The world';
    const icon = document.createElement('span');
    icon.className = 'feed-icon';
    icon.textContent = killer ? '⚔' : '☠';
    const v = document.createElement('span');
    v.className = 'feed-name' + (victim === selfName ? ' me' : '');
    v.textContent = victim;
    el.appendChild(k); el.appendChild(icon); el.appendChild(v);
    this.killfeed.appendChild(el);
    this._feedItems.push({ el, t: 6 });
    while (this._feedItems.length > 5) {
      const old = this._feedItems.shift();
      old.el.remove();
    }
  }

  toast(text, duration = 2.6) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this._toastTimer = duration;
  }

  // -------------------------------------------------------------- overlays

  showRespawn(seconds, killerName) {
    this.respawn.classList.add('show');
    this.respawnCount.textContent = Math.max(0, Math.ceil(seconds));
    this.respawnKiller.textContent = killerName
      ? `Slain by ${killerName}`
      : 'You fell in battle';
  }
  hideRespawn() { this.respawn.classList.remove('show'); }

  setRoom(code, status, online) {
    this.roomCode.textContent = code || '—';
    this.netStatus.textContent = status || '';
    this.roomInfo.classList.toggle('offline', !online);
  }

  /** @param rows array of { name, kills, deaths, self, color, ping } */
  setScoreboard(rows) {
    this.scoreRows.innerHTML = '';
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    for (const r of rows) {
      const el = document.createElement('div');
      el.className = 'score-row' + (r.self ? ' self' : '');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = '#' + r.color.toString(16).padStart(6, '0');
      const n = document.createElement('span');
      n.className = 'sname';
      n.textContent = r.name;
      const k = document.createElement('span'); k.className = 'sk'; k.textContent = r.kills;
      const d = document.createElement('span'); d.className = 'sd'; d.textContent = r.deaths;
      el.append(swatch, n, k, d);
      this.scoreRows.appendChild(el);
    }
  }
  showScoreboard(v) { this.scoreboard.classList.toggle('show', v); }

  /**
   * Radial speed lines. They ramp in with raw speed, but the animated
   * streak layers are reserved for an actual sprint so the effect stays
   * meaningful rather than showing up on every dash and grapple swing.
   */
  setSpeed(speed, sprinting) {
    const t = clamp((speed - 18) / 16, 0, 1);
    this.speedEl.style.opacity = t * (sprinting ? 1 : 0.5);
    this.speedEl.classList.toggle('sprint', !!sprinting && t > 0.12);
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    if (this._hitTimer > 0) this._hitTimer -= dt;

    if (this._vignetteLevel > 0) {
      this._vignetteLevel = Math.max(0, this._vignetteLevel - dt * 1.9);
      this.vignette.style.opacity = this._vignetteLevel * 0.85;
    }

    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this._comboTimer > 0) {
      this._comboTimer -= dt;
      if (this._comboTimer <= 0) this.comboEl.classList.remove('show');
    }

    for (let i = this._feedItems.length - 1; i >= 0; i--) {
      const it = this._feedItems[i];
      it.t -= dt;
      if (it.t < 1) it.el.style.opacity = clamp(it.t, 0, 1);
      if (it.t <= 0) { it.el.remove(); this._feedItems.splice(i, 1); }
    }
  }

  /** Persistent low-health warning border. */
  setCritical(v) {
    this.root.classList.toggle('critical', v);
  }
}
