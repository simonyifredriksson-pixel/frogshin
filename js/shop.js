/**
 * Shop: skin cases, the crate-opening reel, and abilities.
 *
 * Item previews are generated as SVG from the same colour palette the 3D
 * models use, so a shop card and the thing you equip can never disagree —
 * there is one source of truth per skin and no separate preview art.
 */

import {
  CATALOG, CRATES, RARITY, DEFAULT_SKIN,
  rollCrate, cratePool, crateOdds, findSkin,
} from './skins.js?v=v43';
import { Audio } from './audio.js?v=v43';
import { PX } from './icons.js?v=v43';
import { CFG } from './config.js?v=v43';

const $ = (id) => document.getElementById(id);
const MAX_ABILITIES = CFG.abilities.maxEquipped;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// --------------------------------------------------------------- previews

/**
 * Katana, drawn diagonally so the blade colour reads.
 *
 * The card has to show the SHAPE, not just the palette — otherwise every
 * sword in the shop looks identical and there is nothing to choose between
 * them. Each `fx.shape` gets its own silhouette, matching the 3D build.
 */
function swordSVG(s) {
  const f = s.fx || {};
  const g = hex(s.guard);
  let blade;
  switch (f.shape) {
    case 'broad':
      blade = `<polygon points="52,4 62,14 24,52 14,42" fill="${hex(s.blade)}"/>
        <polygon points="52,4 62,14 40,36 30,26" fill="${hex(s.edge)}"/>`;
      break;
    case 'serrated':
      blade = `<polygon points="54,6 60,12 22,50 16,44" fill="${hex(s.blade)}"/>
        ${[0, 1, 2, 3, 4].map((i) => `<polygon fill="${hex(s.edge)}" points="${
          52 - i * 7},${10 + i * 7} ${57 - i * 7},${15 + i * 7} ${
          49 - i * 7},${17 + i * 7}"/>`).join('')}`;
      break;
    case 'curved':
      blade = `<path d="M56,6 Q62,14 46,30 Q30,46 18,46 L14,42 Q30,40 44,26 Q54,14 52,4 Z"
        fill="${hex(s.blade)}"/>
        <path d="M56,6 Q60,13 48,26 L44,22 Q52,12 52,5 Z" fill="${hex(s.edge)}"/>`;
      break;
    case 'fang':
      blade = `<polygon points="50,10 60,20 26,48 18,40" fill="${hex(s.blade)}"/>
        <polygon points="50,10 60,20 44,32 36,24" fill="${hex(s.edge)}"/>`;
      break;
    case 'light':
      blade = `<polygon points="56,2 63,9 21,51 14,44" fill="${hex(s.edge)}"
          opacity="0.55"/>
        <polygon points="55,5 60,10 20,50 15,45" fill="${hex(s.blade)}"/>`;
      break;
    default:
      blade = `<polygon points="54,6 60,12 22,50 16,44" fill="${hex(s.blade)}"/>
        <polygon points="54,6 60,12 42,30 36,24" fill="${hex(s.edge)}"/>`;
      break;
  }
  // Guards differ too, so two swords never share an outline.
  let guard;
  switch (f.tsuba) {
    case 'square':
      guard = `<rect x="11" y="40" width="18" height="8" fill="${g}"
        transform="rotate(-45 20 44)"/>`;
      break;
    case 'cross':
      guard = `<rect x="8" y="42" width="24" height="5" fill="${g}"
          transform="rotate(-45 20 44)"/>
        <rect x="17" y="34" width="5" height="20" fill="${g}"
          transform="rotate(-45 20 44)"/>`;
      break;
    case 'ring':
      guard = `<circle cx="20" cy="44" r="8" fill="none" stroke="${g}" stroke-width="4"/>`;
      break;
    case 'none': guard = ''; break;
    default:
      guard = `<rect x="12" y="41" width="16" height="6" fill="${g}"
        transform="rotate(-45 20 44)"/>`;
      break;
  }
  const runes = f.runes
    ? [0, 1, 2].map((i) => `<circle cx="${44 - i * 9}" cy="${18 + i * 9}" r="1.8"
        fill="${hex(f.runes)}"/>`).join('')
    : '';
  const tassel = f.tassel
    ? `<rect x="1" y="57" width="3" height="6" fill="${hex(f.tassel)}"/>` : '';
  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    ${blade}${runes}${guard}
    <rect x="4" y="47" width="15" height="8" fill="${hex(s.grip)}"
          transform="rotate(-45 11.5 51)"/>
    <rect x="1" y="53" width="6" height="6" fill="${g}"
          transform="rotate(-45 4 56)"/>${tassel}
  </svg>`;
}

/** Kunai, matching the in-world model's silhouette — including its shape. */
function kunaiSVG(s) {
  const f = s.fx || {};
  let blade;
  switch (f.shape) {
    case 'broad':
      blade = `<polygon points="32,6 50,30 32,38 14,30" fill="${hex(s.blade)}"/>
        <polygon points="32,6 32,38 14,30" fill="${hex(s.facet)}"/>`;
      break;
    case 'needle':
      blade = `<polygon points="32,1 39,32 32,37 25,32" fill="${hex(s.blade)}"/>
        <polygon points="32,1 32,37 25,32" fill="${hex(s.facet)}"/>`;
      break;
    case 'crystal':
      blade = `<polygon points="32,3 44,20 32,38 20,20" fill="${hex(s.blade)}"/>
        <polygon points="32,3 32,38 20,20" fill="${hex(s.facet)}"/>
        <polygon points="32,3 36,12 32,20 28,12" fill="${hex(s.facet)}"/>`;
      break;
    case 'star':
      blade = `${[0, 90, 180, 270].map((a) => `<polygon fill="${hex(s.blade)}"
        points="32,4 38,26 26,26" transform="rotate(${a} 32 26)"/>`).join('')}
        <circle cx="32" cy="26" r="6" fill="${hex(s.facet)}"/>`;
      break;
    default:
      blade = `<polygon points="32,4 45,32 32,38 19,32" fill="${hex(s.blade)}"/>
        <polygon points="32,4 32,38 19,32" fill="${hex(s.facet)}"/>`;
      break;
  }
  const ribbon = f.ribbon
    ? `<rect x="30" y="56" width="4" height="8" fill="${hex(f.ribbon)}"/>
       <rect x="31" y="60" width="2" height="4" fill="${hex(f.ribbon)}" opacity="0.6"/>`
    : '';
  const star = f.shape === 'star';
  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    ${blade}
    ${star ? '' : `<rect x="26" y="36" width="12" height="5" fill="${hex(s.ring)}"/>
    <rect x="28" y="41" width="8" height="14" fill="${hex(s.wrap)}"/>
    <rect x="27" y="45" width="10" height="2" fill="${hex(s.ring)}" opacity="0.5"/>
    <rect x="27" y="50" width="10" height="2" fill="${hex(s.ring)}" opacity="0.5"/>
    <circle cx="32" cy="58" r="5" fill="none" stroke="${hex(s.ring)}" stroke-width="3"/>`}
    ${ribbon}
  </svg>`;
}

/**
 * Frog bust: head, eyes, mask and scarf — plus everything the skin's `fx`
 * adds, so the card shows what you would actually be wearing.
 */
function frogSVG(s) {
  const f = s.fx || {};
  const eye = f.eyeGlow ? hex(f.eyeGlow) : '#12121a';
  const white = f.eyeGlow ? hex(f.eyeGlow) : '#fefbe8';
  const halo = f.halo
    ? `<ellipse cx="32" cy="8" rx="17" ry="4" fill="none"
        stroke="${hex(f.halo)}" stroke-width="3"/>`
    + (f.halo2 ? `<ellipse cx="32" cy="5" rx="22" ry="4" fill="none"
        stroke="${hex(f.halo)}" stroke-width="2" opacity="0.7"/>` : '')
    : '';
  const horns = f.horns
    ? `<polygon points="14,14 10,3 20,11" fill="${hex(s.skin)}"/>
       <polygon points="50,14 54,3 44,11" fill="${hex(s.skin)}"/>` : '';
  const crown = f.crown && f.pattern
    ? [0, 1, 2, 3, 4].map((i) => `<polygon fill="${hex(f.pattern)}"
        points="${16 + i * 8},13 ${19 + i * 8},4 ${22 + i * 8},13"/>`).join('')
    : '';
  const spikes = f.spikes
    ? [0, 1, 2].map((i) => `<polygon fill="${hex(s.cloth)}"
        points="8,${26 + i * 8} 2,${30 + i * 8} 8,${34 + i * 8}"/>`).join('')
    : '';
  const fins = f.fins
    ? `<polygon points="12,20 2,26 12,30" fill="${hex(s.skin)}"/>
       <polygon points="52,20 62,26 52,30" fill="${hex(s.skin)}"/>` : '';
  const pattern = f.pattern
    ? `<rect x="16" y="34" width="32" height="2" fill="${hex(f.pattern)}"/>
       <rect x="20" y="46" width="24" height="2" fill="${hex(f.pattern)}"/>` : '';
  const aura = f.aura
    ? `<circle cx="32" cy="34" r="29" fill="${hex(f.aura)}" opacity="0.16"/>` : '';

  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    ${aura}${halo}${fins}${spikes}${horns}${crown}
    <rect x="10" y="14" width="10" height="9" fill="${hex(s.skin)}"/>
    <rect x="44" y="14" width="10" height="9" fill="${hex(s.skin)}"/>
    <rect x="12" y="16" width="6" height="5" fill="${white}"/>
    <rect x="46" y="16" width="6" height="5" fill="${white}"/>
    <rect x="15" y="18" width="3" height="3" fill="${eye}"/>
    <rect x="46" y="18" width="3" height="3" fill="${eye}"/>
    <rect x="12" y="22" width="40" height="20" fill="${hex(s.skin)}"/>
    <rect x="12" y="26" width="40" height="5" fill="${hex(s.scarf)}"/>
    <rect x="12" y="31" width="40" height="7" fill="${hex(s.cloth)}"/>
    <rect x="20" y="42" width="24" height="12" fill="${hex(s.skin)}"/>
    <rect x="24" y="44" width="16" height="8" fill="${hex(s.belly)}"/>
    <rect x="14" y="38" width="36" height="4" fill="${hex(s.cloth)}"/>
    ${pattern}
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
    // A reward skin is not in any crate — say so, rather than letting someone
    // spend five thousand froglets hunting for something they cannot roll.
    // Name the right boss, too: the two Frogath rewards come from different
    // fights, and "BEAT FROGATH" on the Ascended's gear would send you back
    // down the dungeon for something that is not there.
    const lockLabel = skin.reward
      ? (skin.id.includes('divine') ? 'BEAT THE ASCENDED' : 'BEAT FROGATH')
      : 'LOCKED';
    card.innerHTML =
      `<div class="skin-art">${previewSVG(kind, skin)}</div>`
      + `<div class="skin-name">${skin.name}</div>`
      + `<div class="skin-tier" style="color:${r.color}">`
      + `${skin.reward ? 'REWARD' : r.name}</div>`
      + (equipped ? '<div class="tag">ON</div>'
        : (owned ? '' : `<div class="tag">${lockLabel}</div>`));

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
    // The REEL must be drawn from the same pool the roll came from.
    //
    // It used to spin the full catalog, so Frogath's hide and blade — and the
    // Ascended's — flew past the marker on every open. You could never
    // actually win one (rollCrate filters rewards), but a reel that shows
    // them is a reel that promises them, and the only thing it can teach is
    // that you got unlucky. They are earned by beating the fight, nowhere
    // else, and the crate should never suggest otherwise.
    const pool = cratePool(crate);

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
