/**
 * Shop: skin cases, the crate-opening reel, and abilities.
 *
 * Item previews are generated as SVG from the same colour palette the 3D
 * models use, so a shop card and the thing you equip can never disagree —
 * there is one source of truth per skin and no separate preview art.
 */

import {
  CATALOG, CRATES, RARITY, DEFAULT_SKIN,
  rollCrate, crateOdds, findSkin,
} from './skins.js?v=v26';
import { Audio } from './audio.js?v=v26';
import { PX } from './icons.js?v=v26';
import { CFG } from './config.js?v=v26';

const $ = (id) => document.getElementById(id);
const MAX_ABILITIES = CFG.abilities.maxEquipped;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// --------------------------------------------------------------- previews

/** Katana, drawn diagonally so the blade colour reads. */
function swordSVG(s) {
  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    <polygon points="54,6 60,12 22,50 16,44" fill="${hex(s.blade)}"/>
    <polygon points="54,6 60,12 42,30 36,24" fill="${hex(s.edge)}"/>
    <rect x="12" y="41" width="16" height="6" fill="${hex(s.guard)}"
          transform="rotate(-45 20 44)"/>
    <rect x="4" y="47" width="15" height="8" fill="${hex(s.grip)}"
          transform="rotate(-45 11.5 51)"/>
    <rect x="1" y="53" width="6" height="6" fill="${hex(s.guard)}"
          transform="rotate(-45 4 56)"/>
  </svg>`;
}

/** Kunai, matching the in-world model's silhouette. */
function kunaiSVG(s) {
  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    <polygon points="32,4 45,32 32,38 19,32" fill="${hex(s.blade)}"/>
    <polygon points="32,4 32,38 19,32" fill="${hex(s.facet)}"/>
    <rect x="26" y="36" width="12" height="5" fill="${hex(s.ring)}"/>
    <rect x="28" y="41" width="8" height="14" fill="${hex(s.wrap)}"/>
    <rect x="27" y="45" width="10" height="2" fill="${hex(s.ring)}" opacity="0.5"/>
    <rect x="27" y="50" width="10" height="2" fill="${hex(s.ring)}" opacity="0.5"/>
    <circle cx="32" cy="58" r="5" fill="none" stroke="${hex(s.ring)}" stroke-width="3"/>
  </svg>`;
}

/** Frog bust: head, eyes, mask and scarf, in the skin's palette. */
function frogSVG(s) {
  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="10" y="14" width="10" height="9" fill="${hex(s.skin)}"/>
    <rect x="44" y="14" width="10" height="9" fill="${hex(s.skin)}"/>
    <rect x="12" y="16" width="6" height="5" fill="#fefbe8"/>
    <rect x="46" y="16" width="6" height="5" fill="#fefbe8"/>
    <rect x="15" y="18" width="3" height="3" fill="#12121a"/>
    <rect x="46" y="18" width="3" height="3" fill="#12121a"/>
    <rect x="12" y="22" width="40" height="20" fill="${hex(s.skin)}"/>
    <rect x="12" y="26" width="40" height="5" fill="${hex(s.scarf)}"/>
    <rect x="12" y="31" width="40" height="7" fill="${hex(s.cloth)}"/>
    <rect x="20" y="42" width="24" height="12" fill="${hex(s.skin)}"/>
    <rect x="24" y="44" width="16" height="8" fill="${hex(s.belly)}"/>
    <rect x="14" y="38" width="36" height="4" fill="${hex(s.cloth)}"/>
  </svg>`;
}

const PREVIEW = { swords: swordSVG, kunai: kunaiSVG, frogs: frogSVG };
export function previewSVG(kind, skin) { return (PREVIEW[kind] || kunaiSVG)(skin); }

// -------------------------------------------------------------- abilities

export const ABILITIES = [
  {
    id: 'invisibility',
    name: 'INVISIBILITY',
    price: 5000,
    duration: 5,
    cooldown: 30,
    blurb: 'Vanish for five seconds — but only from the people hunting you: '
      + 'taggers, infectors, and the other team in a squad match. Everyone '
      + 'else still sees you perfectly well.',
    art: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges">
      <g fill="#8fd8ff" opacity="0.55">
        <rect x="10" y="6" width="12" height="4"/><rect x="7" y="10" width="18" height="12"/>
        <rect x="9" y="22" width="14" height="5"/>
      </g>
      <g fill="#0d1a22"><rect x="11" y="13" width="3" height="4"/><rect x="18" y="13" width="3" height="4"/></g>
      <g fill="#ffffff" opacity="0.85"><rect x="5" y="12" width="2" height="8"/><rect x="25" y="12" width="2" height="8"/></g>
    </svg>`,
  },
  {
    id: 'shadowclone',
    name: 'SHADOW CLONE',
    price: 10000,
    duration: 10,
    cooldown: 60,
    blurb: 'Split off a shadow that shadows you for ten seconds, copying '
      + 'every move you make a beat behind. Good for making a chaser pick '
      + 'the wrong frog.',
    art: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges">
      <g fill="#2a2a44" opacity="0.85">
        <rect x="4" y="8" width="10" height="4"/><rect x="2" y="12" width="14" height="10"/>
        <rect x="4" y="22" width="10" height="4"/>
      </g>
      <g fill="#6cc24a">
        <rect x="18" y="8" width="10" height="4"/><rect x="16" y="12" width="14" height="10"/>
        <rect x="18" y="22" width="10" height="4"/>
      </g>
      <g fill="#12121a"><rect x="19" y="15" width="3" height="3"/><rect x="25" y="15" width="3" height="3"/></g>
    </svg>`,
  },
];

export function abilityById(id) { return ABILITIES.find((a) => a.id === id) || null; }

// ------------------------------------------------------------------ shop

export class Shop {
  /**
   * @param economy Economy
   * @param onChange called when an equip or purchase should update the game
   */
  constructor(economy, onChange) {
    this.economy = economy;
    this.onChange = onChange || (() => {});
    this.tab = 'swords';
    this.opening = false;
    // Trial mode is the practice ring: everything reads as owned, nothing is
    // charged, and equipping writes to a temporary loadout instead of saving.
    this.tryMode = false;
    this.onTrialEquip = null;
    this._wire();
  }

  setTryMode(on) {
    if (this.tryMode === on) return;
    this.tryMode = on;
    this.render();
  }

  _wire() {
    for (const btn of document.querySelectorAll('.shop-tab')) {
      btn.addEventListener('click', () => {
        this.tab = btn.dataset.tab;
        for (const b of document.querySelectorAll('.shop-tab')) {
          b.classList.toggle('active', b === btn);
        }
        Audio.uiClick();
        this.render();
      });
    }
    $('crate-close').onclick = () => { Audio.uiBack(); this.closeCrate(); };
    $('crate-again').onclick = () => {
      const c = this._lastCrate;
      this.closeCrate();
      if (c) this.buyCrate(c);
    };
  }

  status(msg, isError) {
    const el = $('shop-status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  // ---------------------------------------------------------------- render

  render() {
    $('shop-balance').textContent = this.economy.froglets.toLocaleString('en-GB');
    $('shop-purse-icon').innerHTML = PX.COIN;
    const body = $('shop-body');
    body.innerHTML = '';
    if (this.tab === 'abilities') this._renderAbilities(body);
    else this._renderSkins(body, this.tab);
  }

  _renderSkins(body, kind) {
    const crate = CRATES.find((c) => c.kind === kind);
    if (crate) body.appendChild(this._crateOffer(crate));

    const grid = document.createElement('div');
    grid.className = 'skin-grid';
    for (const skin of CATALOG[kind]) {
      grid.appendChild(this._skinCard(kind, skin));
    }
    body.appendChild(grid);
  }

  _crateOffer(crate) {
    const wrap = document.createElement('div');
    wrap.className = 'crate-offer';

    const box = document.createElement('div');
    box.className = 'crate-box';
    box.style.setProperty('--crate-color', crate.color);
    box.innerHTML = '<div class="crate-lock"></div>';
    wrap.appendChild(box);

    const meta = document.createElement('div');
    meta.className = 'crate-meta';
    const odds = crateOdds(crate)
      .map((o) => `<span style="color:${RARITY[o.rarity].color}">`
        + `${RARITY[o.rarity].name} ${o.pct.toFixed(o.pct < 1 ? 2 : 1)}%</span>`)
      .join('');
    meta.innerHTML = `<h3>${crate.name}</h3><p>${crate.blurb}</p>`
      + `<div class="crate-odds">${odds}</div>`;
    wrap.appendChild(meta);

    const buy = document.createElement('div');
    buy.className = 'crate-buy';
    const btn = document.createElement('button');
    btn.className = 'btn btn-go';
    btn.innerHTML = '<span>OPEN CASE</span>';
    btn.onclick = () => this.buyCrate(crate);
    buy.appendChild(btn);
    const price = document.createElement('div');
    price.className = 'crate-price';
    price.textContent = crate.price.toLocaleString('en-GB') + ' FROGLETS';
    buy.appendChild(price);
    wrap.appendChild(buy);
    return wrap;
  }

  _skinCard(kind, skin) {
    const owned = this.tryMode
      || skin.id === DEFAULT_SKIN[kind]
      || this.economy.owns(kind, skin.id);
    const slot = this._slot(kind);
    const current = this.tryMode && this.trial
      ? this.trial[slot]
      : this.economy.equipped[slot];
    const equipped = (current || DEFAULT_SKIN[kind]) === skin.id;
    const r = RARITY[skin.rarity];

    const card = document.createElement('div');
    card.className = 'skin-card' + (owned ? '' : ' locked') + (equipped ? ' equipped' : '');
    card.style.borderBottomColor = r.color;
    card.innerHTML =
      `<div class="skin-art">${previewSVG(kind, skin)}</div>`
      + `<div class="skin-name">${skin.name}</div>`
      + `<div class="skin-tier" style="color:${r.color}">${r.name}</div>`
      + (equipped ? '<div class="tag">ON</div>' : (owned ? '' : '<div class="tag">LOCKED</div>'));

    if (owned) {
      card.onclick = () => {
        if (this.tryMode) {
          // Trials never touch saved progress.
          this.trial = this.trial || {};
          this.trial[slot] = skin.id;
          Audio.uiClick();
          this.status(`Trying ${skin.name} — this is not saved.`);
          if (this.onTrialEquip) this.onTrialEquip();
        } else {
          this.economy.equipped[slot] = skin.id;
          this.economy.save();
          Audio.uiClick();
          this.status(`${skin.name} equipped.`);
          this.onChange();
        }
        this.render();
      };
    }
    return card;
  }

  /** economy.equipped uses singular keys. */
  _slot(kind) {
    return kind === 'swords' ? 'sword' : (kind === 'frogs' ? 'frog' : 'kunai');
  }

  _renderAbilities(body) {
    const max = MAX_ABILITIES;
    const note = document.createElement('p');
    note.className = 'note';
    note.innerHTML = this.tryMode
      ? '<b>Practice ring:</b> every ability is unlocked here to try. Nothing '
        + `is bought and nothing is saved. You still carry ${max} at a time.`
      : `You can carry <b>${max}</b> abilities into a match. Equipped ones sit `
        + 'in your hotbar — press their number key to fire.';
    body.appendChild(note);

    for (const a of ABILITIES) {
      const owned = this.tryMode || this.economy.hasAbility(a.id);
      const on = this._abilityOn(a.id);
      const card = document.createElement('div');
      card.className = 'ability-card' + (on ? ' equipped' : '');
      card.innerHTML =
        `<div class="ability-art">${a.art}</div>`
        + `<div class="ability-info"><h3>${a.name}</h3><p>${a.blurb}</p>`
        + `<div class="ability-stats"><span>LASTS ${a.duration}s</span>`
        + `<span>COOLDOWN ${a.cooldown}s</span></div></div>`;
      const btn = document.createElement('button');
      if (owned) {
        btn.className = 'btn ' + (on ? 'btn-go' : 'btn-quiet');
        btn.innerHTML = `<span>${on ? 'EQUIPPED' : 'EQUIP'}</span>`;
        btn.onclick = () => this._toggleAbility(a);
      } else {
        btn.className = 'btn btn-go';
        btn.innerHTML = `<span>${a.price.toLocaleString('en-GB')} FROGLETS</span>`;
        btn.onclick = () => {
          if (!this.economy.canAfford(a.price)) {
            Audio.uiBack();
            this.status(`Not enough froglets — you need ${(a.price - this.economy.froglets).toLocaleString('en-GB')} more.`, true);
            return;
          }
          this.economy.spend(a.price);
          this.economy.unlockAbility(a.id);
          Audio.respawn({ x: 0, y: 0, z: 0 });
          this.status(`${a.name} unlocked and equipped to your hotbar.`);
          this.onChange();
          this.render();
        };
      }
      card.appendChild(btn);
      body.appendChild(card);
    }
  }

  /** Is this ability in the loadout we are currently editing? */
  _abilityOn(id) {
    if (this.tryMode) {
      return !!(this.trial && this.trial.abilities
        && this.trial.abilities.indexOf(id) !== -1);
    }
    return this.economy.isEquippedAbility(id);
  }

  /** Equip/unequip, respecting the two-slot cap. */
  _toggleAbility(a) {
    let result;
    if (this.tryMode) {
      this.trial = this.trial || {};
      const list = this.trial.abilities || (this.trial.abilities = []);
      const at = list.indexOf(a.id);
      if (at !== -1) { list.splice(at, 1); result = 'off'; }
      else if (list.length >= MAX_ABILITIES) result = 'full';
      else { list.push(a.id); result = 'on'; }
    } else {
      result = this.economy.toggleAbility(a.id);
    }

    if (result === 'full') {
      Audio.uiBack();
      this.status(`You can only carry ${MAX_ABILITIES} abilities — unequip one first.`, true);
      return;
    }
    Audio.uiClick();
    this.status(result === 'on'
      ? `${a.name} equipped to your hotbar.`
      : `${a.name} unequipped.`);
    if (this.tryMode && this.onTrialEquip) this.onTrialEquip();
    else this.onChange();
    this.render();
  }

  // ---------------------------------------------------------- crate opening

  buyCrate(crate) {
    if (this.opening) return;
    if (!this.economy.canAfford(crate.price)) {
      Audio.uiBack();
      this.status(`Not enough froglets — you need ${(crate.price - this.economy.froglets).toLocaleString('en-GB')} more.`, true);
      return;
    }
    this.economy.spend(crate.price);
    this.status('');
    this.render();
    this._lastCrate = crate;
    this._openCrate(crate);
  }

  /** Spin the reel, then reveal. */
  _openCrate(crate) {
    this.opening = true;
    const won = rollCrate(crate);
    const pool = CATALOG[crate.kind];

    $('crate-title').textContent = crate.name.toUpperCase();
    $('crate-result').classList.remove('show');
    $('crate').classList.add('show');

    // Build a long strip of random items with the real prize at a fixed
    // index near the end, so the deceleration always has room to sell it.
    const COUNT = 52;
    const WIN_INDEX = 46;
    const strip = $('reel-strip');
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';
    strip.innerHTML = '';

    for (let i = 0; i < COUNT; i++) {
      const item = i === WIN_INDEX ? won : pool[Math.floor(Math.random() * pool.length)];
      const el = document.createElement('div');
      el.className = 'reel-item';
      el.style.borderBottomColor = RARITY[item.rarity].color;
      el.innerHTML = previewSVG(crate.kind, item) + `<span>${item.name}</span>`;
      strip.appendChild(el);
    }

    // Land the winning card under the centre marker, with a little offset so
    // it does not stop suspiciously dead-centre every time.
    const ITEM = 122, GAP = 8, PITCH = ITEM + GAP;
    const windowW = strip.parentElement.clientWidth;
    const jitter = (Math.random() - 0.5) * (ITEM * 0.5);
    const target = -(8 + WIN_INDEX * PITCH + ITEM / 2) + windowW / 2 + jitter;

    // Force a reflow so the transition starts from the reset position.
    void strip.offsetWidth;
    const DURATION = 5.4;
    strip.style.transition = `transform ${DURATION}s cubic-bezier(0.12, 0.62, 0.11, 1)`;
    strip.style.transform = `translateX(${target}px)`;

    this._tickReel(DURATION);

    clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => this._reveal(crate, won), DURATION * 1000 + 220);
  }

  /** Ticks that thin out as the reel slows, matching the deceleration. */
  _tickReel(duration) {
    let t = 0;
    const step = () => {
      if (!this.opening) return;
      Audio.uiHover();
      // Same easing shape as the CSS curve, so the clicks track the motion.
      const p = t / duration;
      const gap = 0.045 + Math.pow(p, 3) * 0.55;
      t += gap;
      if (t < duration) this._tickTimer = setTimeout(step, gap * 1000);
    };
    step();
  }

  _reveal(crate, won) {
    const r = RARITY[won.rarity];
    const dupe = !this.economy.unlock(crate.kind, won.id);

    $('cr-rarity').textContent = r.name.toUpperCase();
    $('cr-rarity').style.color = r.color;
    $('cr-art').innerHTML = previewSVG(crate.kind, won);
    $('cr-name').textContent = won.name;
    $('cr-dupe').textContent = dupe
      ? 'You already owned this one.'
      : 'Added to your collection.';
    $('crate-result').classList.add('show');

    // Louder fanfare the rarer it is.
    if (won.rarity === 'legendary' || won.rarity === 'epic') {
      Audio.headshot({ x: 0, y: 0, z: 0 });
      setTimeout(() => Audio.respawn({ x: 0, y: 0, z: 0 }), 120);
    } else {
      Audio.pickup({ x: 0, y: 0, z: 0 });
    }

    this.opening = false;
    this.onChange();
    this.render();
  }

  closeCrate() {
    clearTimeout(this._revealTimer);
    clearTimeout(this._tickTimer);
    this.opening = false;
    $('crate').classList.remove('show');
    this.render();
  }

  /**
   * Resolve the skin objects the game should use. A trial loadout from the
   * practice ring takes precedence over the saved one — and keeps doing so
   * after you step back out of the ring, so a borrowed skin lasts the whole
   * match rather than snapping off the moment you walk away.
   */
  equippedSkins() {
    const e = this.economy.equipped;
    const t = this.trial || {};
    return {
      sword: findSkin('swords', t.sword || e.sword || DEFAULT_SKIN.swords),
      frog: findSkin('frogs', t.frog || e.frog || DEFAULT_SKIN.frogs),
      kunai: findSkin('kunai', t.kunai || e.kunai || DEFAULT_SKIN.kunai),
    };
  }

  /**
   * Ability ids to put in the hotbar, capped at the carry limit. Borrowed
   * ones from the practice ring last the match, exactly like borrowed skins.
   */
  equippedAbilities() {
    const list = (this.trial && this.trial.abilities)
      ? this.trial.abilities
      : this.economy.loadout;
    return (list || []).slice(0, MAX_ABILITIES);
  }

  /** Forget a trial loadout — on leaving the match, not the ring. */
  clearTrial() {
    if (!this.trial) return false;
    this.trial = null;
    return true;
  }
}
