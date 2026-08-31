/**
 * In-game HUD.
 *
 * Deliberately sparse: health, the two ability meters, a crosshair that
 * reacts to grapple targets, and transient feedback (hit markers, kill feed,
 * damage vignette). Everything else stays off screen until it matters.
 */

import { clamp } from './util.js?v=v14';
import { CFG } from './config.js?v=v14';
import { staminaBand } from './stamina.js?v=v14';
import { ITEM_ICONS, SLOT_LABELS } from './items.js?v=v14';
import { Audio } from './audio.js?v=v14';

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
    // Vote-screen elements are cached here rather than in buildVote(), which
    // only runs when an arena match starts. Going straight to Story mode
    // would otherwise leave these undefined and crash on the first reset.
    this.voteEl = $('vote');
    this.voteTimerEl = $('vote-timer');
    this.voteCards = Array.from(document.querySelectorAll('.vote-card'));
    this.tpCount = $('tp-count');
    this.tpMax = $('tp-max');
    this.tpNote = $('tp-note');
    this.taggerPicker = $('tagger-picker');
    this.voteFoot = $('vote-foot');

    this.roundBanner = $('round-banner');
    this.rbIcon = $('rb-icon');
    this.rbName = $('rb-name');
    this.rbTime = $('rb-time');
    this.rbRole = $('rb-role');
    this.announceEl = $('round-announce');
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

  // ----------------------------------------------------------------- story

  /**
   * Wipe every overlay back to a clean slate.
   *
   * The HUD is one shared set of elements reused by the arena, the story and
   * the menu, and several of them (the vote screen, the boss bar) live
   * OUTSIDE #hud — so hiding #hud alone leaves them on screen. Called both
   * when entering the story and when leaving a match.
   */
  resetOverlays() {
    this.hideRound();
    this.showVote(false);
    this.clearAnnounce();
    this.hideRespawn();
    this.showScoreboard(false);
    this.hideBossBar();
    this.setTutorial(null);
    this.setCinematic(false);
    this.setSubtitle('');
    this.setPickupPrompt(false);
    this.setAlert(0, false);
    this.setFade(0, 0);
    this.setCritical(false);
    this.killfeed.innerHTML = '';
    this._feedItems.length = 0;
    this.toastEl.classList.remove('show');
    this.comboEl.classList.remove('show');
    this._rbMode = null;
    this._bossFrac = 0;
  }

  /** @param list array of { id, text, done, active } — or null to hide */
  setObjectives(list) {
    const root = $('objectives');
    if (!list || !list.length) { root.classList.remove('show'); return; }
    root.classList.add('show');

    // Rebuild only when the objective set or its state actually changed.
    const key = list.map((o) => `${o.id}:${o.done ? 1 : 0}:${o.active ? 1 : 0}`).join('|');
    if (key === this._objKey) return;
    const isNew = this._objKey && list.length > this._objCount;
    this._objKey = key;
    this._objCount = list.length;

    const ul = $('obj-list');
    ul.innerHTML = '';
    list.forEach((o, i) => {
      const li = document.createElement('li');
      li.textContent = o.text;
      if (o.done) li.classList.add('done');
      if (o.active) li.classList.add('active');
      if (isNew && i === list.length - 1) li.classList.add('new');
      ul.appendChild(li);
    });
  }

  /**
   * Guard suspicion meter.
   * @param level   0..1 how close a guard is to spotting you
   * @param chasing true once one actually has
   */
  setAlert(level, chasing) {
    const el = $('alert');
    const show = level > 0.02 || chasing;
    if (show !== this._alertShown) {
      this._alertShown = show;
      el.classList.toggle('show', show);
    }
    if (chasing !== this._alertChase) {
      this._alertChase = chasing;
      el.classList.toggle('chase', chasing);
    }
    if (show) $('al-fill').style.width = (clamp(level, 0, 1) * 100) + '%';
  }

  showBossBar(name, fraction) {
    const bar = $('boss-bar');
    $('boss-name').textContent = name;
    bar.classList.add('show');
    this._bossFrac = fraction;
    $('boss-fill').style.width = (fraction * 100) + '%';
    $('boss-chip').style.width = (fraction * 100) + '%';
  }

  setBossBar(fraction) {
    const f = clamp(fraction, 0, 1);
    // Only touch the DOM on a visible change — this runs every frame.
    if (Math.abs(f - (this._bossFrac || 0)) < 0.0005) return;
    this._bossFrac = f;
    $('boss-fill').style.width = (f * 100) + '%';
    $('boss-chip').style.width = (f * 100) + '%';
  }

  hideBossBar() { $('boss-bar').classList.remove('show'); }

  /** Letterbox bars + hide the gameplay HUD. */
  setCinematic(on) {
    if (on === this._cine) return;
    this._cine = on;
    this.root.classList.toggle('cinematic', on);
  }

  /**
   * Tutorial prompt, split so the key gets its own badge.
   * Call with no arguments to hide it.
   * @param verb e.g. 'HOLD'   @param key 'RIGHT CLICK'   @param tail 'TO PARRY…'
   */
  setTutorial(verb, key, tail) {
    const el = $('tutorial');
    if (!verb) {
      el.classList.remove('show');
      this._tutKey = null;
      return;
    }
    const sig = verb + '|' + key + '|' + tail;
    if (sig !== this._tutKey) {
      this._tutKey = sig;
      $('tut-verb').textContent = verb;
      $('tut-key').textContent = key;
      $('tut-tail').textContent = tail;
    }
    el.classList.add('show');
  }

  /**
   * Fade the screen to or from black.
   * @param to       1 for black, 0 for clear
   * @param duration seconds
   */
  setFade(to, duration) {
    const el = $('fade');
    el.style.transition = duration > 0 ? `opacity ${duration}s ease-in-out` : 'none';
    // Force a reflow so a transition set in the same frame still animates.
    void el.offsetWidth;
    el.style.opacity = String(to);
  }

  setSubtitle(text, speaker) {
    const el = $('subtitle');
    if (!text) { el.classList.remove('show'); return; }
    $('sub-speaker').textContent = speaker || '';
    $('sub-text').textContent = text;
    el.classList.add('show');
  }

  // ------------------------------------------------------------ vote screen

  /**
   * Wire the vote overlay once.
   * @param onVote  (mode) => void
   * @param onCount (delta) => void
   */
  /** Wire the vote handlers. Elements themselves are cached in the ctor. */
  buildVote(onVote, onCount) {
    if (this._voteWired) return;
    this._voteWired = true;
    for (const card of this.voteCards) {
      card.addEventListener('mouseenter', () => Audio.uiHover());
      card.addEventListener('click', () => onVote(card.dataset.mode));
    }
    $('tp-minus').addEventListener('click', () => onCount(-1));
    $('tp-plus').addEventListener('click', () => onCount(1));
  }

  showVote(show) {
    if (show === this._voteShown) return;
    this._voteShown = show;
    this.voteEl.classList.toggle('show', show);
  }

  /**
   * @param round       RoundManager
   * @param playerCount lobby size
   * @param myMode      the mode this player voted for, or null
   * @param myCount     this player's requested tagger count
   * @param maxCount    highest legal tagger count
   */
  updateVote(round, playerCount, myMode, myCount, maxCount) {
    const secs = Math.max(0, Math.ceil(round.timer));
    if (secs !== this._voteSecs) {
      this._voteSecs = secs;
      this.voteTimerEl.textContent = secs;
    }

    for (const card of this.voteCards) {
      const m = card.dataset.mode;
      card.classList.toggle('picked', m === myMode);
      const n = card.querySelector('[data-count]');
      const v = round.tally[m] || 0;
      if (n.textContent !== String(v)) n.textContent = v;
    }

    // The tagger count only means anything for the chase modes, and only
    // becomes a choice at all once there are more than two players.
    const relevant = myMode === 'tag' || myMode === 'infection';
    const adjustable = relevant && playerCount > 2;
    this.taggerPicker.classList.toggle('disabled', !adjustable);
    this.tpCount.textContent = myCount;
    this.tpMax.textContent = `of ${maxCount} max`;
    this.tpNote.textContent = !relevant
      ? 'Only used by Tag and Infection'
      : (playerCount > 2
        ? `${playerCount} players — up to ${maxCount} taggers`
        : 'Needs 3+ players to change');

    this.voteFoot.textContent = myMode
      ? 'Vote locked in — you can still change it'
      : 'Click a mode to vote · the most votes wins';
  }

  // ---------------------------------------------------------------- round

  /**
   * Top-of-screen round readout.
   * @param info    { icon, name } for the current mode
   * @param seconds time left
   * @param role    'it' | 'runner' | '' — drives the colour and the label
   */
  setRound(info, seconds, role, taggerCount) {
    this.roundBanner.classList.add('show');
    if (this._rbMode !== info.name) {
      this._rbMode = info.name;
      this.rbIcon.textContent = info.icon;
      this.rbName.textContent = info.name;
    }
    const s = Math.max(0, Math.ceil(seconds));
    const txt = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (txt !== this._rbTime) { this._rbTime = txt; this.rbTime.textContent = txt; }
    this.roundBanner.classList.toggle('urgent', s <= 15);

    let label = '';
    if (role === 'it') label = "YOU ARE IT — tag someone!";
    else if (role === 'runner') label = taggerCount === 1 ? 'RUN — 1 tagger' : `RUN — ${taggerCount} taggers`;
    if (label !== this._rbRole) { this._rbRole = label; this.rbRole.textContent = label; }
    this.roundBanner.classList.toggle('it', role === 'it');
    this.roundBanner.classList.toggle('runner', role === 'runner');
  }

  hideRound() {
    this.roundBanner.classList.remove('show');
    this._rbMode = null;
  }

  /**
   * Big centre-screen message.
   * @param tone 'good' | 'danger' | ''
   * @param hold true to leave it on screen until cleared
   */
  announce(text, tone = '', hold = false) {
    this.announceEl.textContent = text;
    this.announceEl.classList.remove('show', 'hold', 'good', 'danger');
    void this.announceEl.offsetWidth;        // restart the animation
    if (tone) this.announceEl.classList.add(tone);
    this.announceEl.classList.add(hold ? 'hold' : 'show');
  }

  clearAnnounce() {
    this.announceEl.classList.remove('show', 'hold', 'good', 'danger');
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
        // The katana shows nothing; a tagger's kunai show the infinity mark.
        const endless = inventory.unlimitedKunai && slot.item.id === 'kunai';
        count.textContent = slot.item.infinite ? '' : (endless ? '∞' : String(slot.count));
        count.classList.toggle('none', !slot.item.infinite && !endless && slot.count <= 0);
        count.classList.toggle('endless', endless);
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
