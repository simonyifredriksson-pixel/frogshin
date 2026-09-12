/**
 * Shop: skin cases, the crate-opening reel, and abilities.
 *
 * Item previews are generated as SVG from the same colour palette the 3D
 * models use, so a shop card and the thing you equip can never disagree —
 * there is one source of truth per skin and no separate preview art.
 */

import {
  CATALOG, RARITY, RARITY_ORDER, DEFAULT_SKIN, BULK_SIZES,
  rollCrate, rollMany, cratePool, crateOdds, findSkin, cratesFor, setOf,
  ECLIPSE_TITLE, eclipseProgress,
} from './skins.js?v=v121';
import { Audio } from './audio.js?v=v121';
import { PX } from './icons.js?v=v121';
import { CFG } from './config.js?v=v121';

const $ = (id) => document.getElementById(id);
const MAX_ABILITIES = CFG.abilities.maxEquipped;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/**
 * ── how long an opening takes ──────────────────────────────────────────
 *
 * `STAGE_MS` is the crate animation, and it runs ONCE per purchase rather
 * than once per case: it is the set's signature, and sitting through the
 * same vines ten times in a ten-pack would make the flourish the thing
 * standing between you and your items.
 *
 * The reel is much shorter inside a multi-buy. Five and a half seconds is
 * the right length for a single open — it is the whole ceremony — and
 * completely wrong ten times in a row.
 */
const STAGE_MS = { base: 950, swamp: 1800, celestial: 1850, eclipse: 1750 };
const SPIN_SOLO = 5.4;
const SPIN_BULK = 2.3;
/** What S leaves you: the last half second, exactly as asked. */
const SKIP_S = 0.5;
/** How long a result sits on screen before the next case in a multi-buy. */
const HOLD_MS = { low: 720, high: 1250 };

const SET_NAMES = {
  base: 'STANDARD', swamp: 'SWAMPFORGED', celestial: 'CELESTIAL FORGE',
  eclipse: 'THE ECLIPSE COLLECTION',
};

/**
 * ── THE SECRET SEQUENCE ────────────────────────────────────────────────
 *
 * What happens when a ??? comes out, beat by beat, in milliseconds from the
 * moment the reel WOULD have started. One table, read top to bottom, is the
 * whole cutscene; `_eclipseReveal` does nothing but schedule it.
 *
 * The shape is deliberate and it is the shape of an absence:
 *
 *   dark     the case opened and NOTHING came out. The room goes black and
 *            the music drops away. Three seconds of nothing at all — which
 *            is the longest anything in this game asks you to wait, and the
 *            reason the rest of it lands.
 *   crate    the case is still there, still shut, floating.
 *   disc     the eclipse rises behind it.
 *   line     AN UNKNOWN PRESENCE HAS BEEN DISCOVERED.
 *   mystery  a ??? appears. Still not the item.
 *   tag      SECRET ITEM.
 *   reveal   and only now, what it actually is.
 *
 * Total is a little over eleven seconds. That is very long for a menu and
 * exactly right for something that happens once in three thousand opens;
 * `S` cuts to the reveal for anybody who has seen it before.
 */
const ECLIPSE_BEATS = [
  { at: 0, act: 'dark' },
  { at: 1200, act: 'crate' },
  { at: 3000, act: 'disc' },
  { at: 5200, act: 'line' },
  { at: 7600, act: 'mystery' },
  { at: 9200, act: 'tag' },
  { at: 11200, act: 'reveal' },
];
const ECLIPSE_MS = ECLIPSE_BEATS[ECLIPSE_BEATS.length - 1].at;

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
  // Fragments orbiting the blade — one sword in the game has these, and the
  // card has to show it or the rarest drop looks like another gold katana.
  const orbit = f.orbit
    ? [[46, 8], [36, 22], [24, 34], [14, 48], [52, 20], [30, 12]]
      .slice(0, f.orbitN || 6)
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="4"
        fill="${hex(f.orbit)}"/><rect x="${x - 1}" y="${y - 1}" width="6" height="6"
        fill="${hex(f.orbit)}" opacity="0.35"/>`).join('')
    : '';
  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    ${orbit}${blade}${runes}${guard}
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
  // The Forgotten One's eyes are the card's focal point too: a cold white
  // sclera with a small violet centre, exactly as the rig builds them.
  const eye = f.eclipse ? hex(f.energy) : (f.eyeGlow ? hex(f.eyeGlow) : '#12121a');
  const white = f.eclipse ? '#e8e6ff' : (f.eyeGlow ? hex(f.eyeGlow) : '#fefbe8');
  const halo = f.halo
    ? `<ellipse cx="32" cy="8" rx="17" ry="4" fill="none"
        stroke="${hex(f.halo)}" stroke-width="3"/>`
    + (f.halo2 ? `<ellipse cx="32" cy="5" rx="22" ry="4" fill="none"
        stroke="${hex(f.halo)}" stroke-width="2" opacity="0.7"/>` : '')
    : '';
  const horns = f.horns
    ? `<polygon points="14,14 10,3 20,11" fill="${hex(s.skin)}"/>
       <polygon points="50,14 54,3 44,11" fill="${hex(s.skin)}"/>` : '';
  // `crown` may be a number that scales it, matching the 3D build.
  const cs = typeof f.crown === 'number' ? f.crown : 1;
  const crown = f.crown && f.pattern
    ? [0, 1, 2, 3, 4].map((i) => `<polygon fill="${hex(f.pattern)}"
        points="${16 + i * 8},13 ${19 + i * 8},${13 - 9 * cs} ${22 + i * 8},13"/>`).join('')
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
  /**
   * Everything the two new crate sets add. Drawn in the same order the rig
   * builds it, so a card and the frog you equip agree — a Swamp Warden whose
   * card is a plain green frog would be a lie told at 4,500 froglets.
   */
  const moss = f.moss
    ? [[8, 24], [18, 19], [30, 17], [42, 19], [52, 24], [24, 21]]
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="9" height="5"
        rx="2" fill="${hex(f.moss)}"/>`).join('')
    : '';
  // Breastplate, pauldrons and a collar, over the torso.
  const plates = f.plates
    ? `<rect x="8" y="24" width="12" height="11" fill="${hex(f.plates)}"/>
       <rect x="44" y="24" width="12" height="11" fill="${hex(f.plates)}"/>
       <rect x="19" y="33" width="26" height="17" fill="${hex(f.plates)}"/>
       <rect x="30" y="35" width="4" height="13" fill="${hex(f.plates)}"
         opacity="0.45"/>
       <rect x="17" y="30" width="30" height="4" fill="${hex(f.plates)}"
         opacity="0.7"/>`
    : '';
  /**
   * The hood is drawn BEHIND the head, a size larger, so a rim of it shows
   * around the crown and temples.
   *
   * As an arch over the front it covered the eyes — they sit at the head's
   * top outer corners on this card, and any band wide enough to read as a
   * hood lands on them. A shell behind reads the same and keeps the face,
   * which is the whole thing you are buying.
   */
  const hood = f.hood
    ? `<path d="M3,34 Q3,2 32,2 Q61,2 61,34 L61,44 L52,40 L52,24
        Q52,11 32,11 Q12,11 12,24 L12,40 L3,44 Z" fill="${hex(f.hood)}"/>`
    : '';
  const shield = f.shield
    ? `<circle cx="9" cy="45" r="9" fill="${hex(f.shield)}"/>
       <circle cx="9" cy="45" r="9" fill="none" stroke="${hex(f.shield)}"
         stroke-width="2" opacity="0.5"/>
       <circle cx="9" cy="45" r="2.5" fill="${hex(f.shield)}" opacity="0.55"/>`
    : '';
  const stars = f.stars
    ? [[16, 30], [26, 24], [40, 28], [48, 36], [22, 40], [36, 44], [44, 20]]
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="2" height="2"
        fill="${hex(f.stars)}"/>`).join('')
    : '';
  const orbit = f.orbit
    ? [[3, 20], [58, 22], [6, 44], [56, 46], [30, 2], [32, 60], [14, 10], [50, 10]]
      .slice(0, Math.min(8, f.orbitN || 6))
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="4"
        fill="${hex(f.orbit)}"/><rect x="${x - 1}" y="${y - 1}" width="6"
        height="6" fill="${hex(f.orbit)}" opacity="0.3"/>`).join('')
    : '';

  /**
   * ── THE FORGOTTEN ONE'S CARD ────────────────────────────────────────
   *
   * Drawn part for part against the rig — skullcap, brow bar, cuirass,
   * emblem, pauldrons, arm bands, two fragments — because this is the one
   * item in the game you cannot inspect before buying. A card that showed
   * a dark frog and handed over an armoured one would be a lie told at
   * one in three thousand three hundred.
   *
   * `shape-rendering: crispEdges` is on the whole sheet, so the emblem is
   * built from a filled disc, a ring and an arc rather than from a
   * gradient — the same three parts, in the same three colours, as the
   * plate on the frog's chest.
   */
  const eclipse = f.eclipse ? `
    <rect x="13" y="6" width="38" height="8" fill="${hex(f.obsidian)}"/>
    <rect x="10" y="10" width="44" height="4" fill="${hex(f.obsidian)}"/>
    <rect x="30" y="4" width="4" height="9" fill="${hex(f.silver)}"/>
    <rect x="11" y="14" width="42" height="2" fill="${hex(f.silver)}"/>
    <rect x="8" y="22" width="11" height="6" fill="${hex(f.obsidian)}"/>
    <rect x="45" y="22" width="11" height="6" fill="${hex(f.obsidian)}"/>
    <rect x="8" y="28" width="11" height="2" fill="${hex(f.silver)}"/>
    <rect x="45" y="28" width="11" height="2" fill="${hex(f.silver)}"/>
    <rect x="18" y="25" width="28" height="15" fill="${hex(f.obsidian)}"/>
    <rect x="18" y="25" width="28" height="2" fill="${hex(f.silver)}"
      opacity="0.5"/>
    <circle cx="32" cy="32" r="6.2" fill="none" stroke="${hex(f.energy)}"
      stroke-width="2.2" stroke-dasharray="29 10"/>
    <circle cx="32" cy="32" r="4.5" fill="#07060c" stroke="${hex(f.silver)}"
      stroke-width="1.2"/>
    <rect x="22" y="28" width="1.5" height="6" fill="${hex(f.energy)}"
      opacity="0.85"/>
    <rect x="41" y="30" width="1.5" height="5" fill="${hex(f.energy)}"
      opacity="0.55"/>
    <rect x="16" y="40" width="32" height="3" fill="${hex(s.scarf)}"/>
    <rect x="37" y="43" width="2" height="4" fill="${hex(f.silver)}"/>
    <rect x="35" y="47" width="6" height="3" fill="${hex(f.silver)}"/>
    <rect x="36" y="48" width="4" height="1" fill="#07060c"/>
    <rect x="5" y="33" width="8" height="2" fill="${hex(f.silver)}"/>
    <rect x="51" y="33" width="8" height="2" fill="${hex(f.silver)}"/>
    <rect x="22" y="47" width="6" height="7" fill="${hex(f.obsidian)}"/>
    <rect x="36" y="47" width="6" height="7" fill="${hex(f.obsidian)}"/>
    <rect x="22" y="47" width="6" height="2" fill="${hex(f.silver)}"/>
    <rect x="36" y="47" width="6" height="2" fill="${hex(f.silver)}"/>
    <rect x="4" y="19" width="3" height="4" fill="${hex(f.energy)}"
      opacity="0.5"/>
    <rect x="57" y="41" width="3" height="4" fill="${hex(f.energy)}"
      opacity="0.35"/>`
    : '';
  // The distortion at the feet goes BEHIND everything, like the aura does.
  const eclipseBack = f.eclipse
    ? `<ellipse cx="32" cy="57" rx="19" ry="4" fill="#1a1230" opacity="0.55"/>
       <ellipse cx="32" cy="57" rx="13" ry="3" fill="#120c22" opacity="0.7"/>`
    : '';

  return `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
    ${eclipseBack}${aura}${orbit}${halo}${hood}${fins}${spikes}${horns}
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
    ${plates}${moss}${stars}${shield}${crown}
    ${pattern}${eclipse}
  </svg>`;
}

const PREVIEW = { swords: swordSVG, kunai: kunaiSVG, frogs: frogSVG };
export function previewSVG(kind, skin) { return (PREVIEW[kind] || kunaiSVG)(skin); }

/**
 * WHAT A ??? LOOKS LIKE BEFORE IT IS YOURS.
 *
 * A hole with a question mark in it. Deliberately carries nothing of the
 * real item — not its colours, not its silhouette, not its length — because
 * the whole value of a secret is that it cannot be worked out from the
 * collection screen. Somebody who has never pulled one should be able to
 * tell you only that it exists.
 */
export const MYSTERY_SVG = `<svg viewBox="0 0 64 64" shape-rendering="crispEdges"
    aria-hidden="true">
  <rect x="8" y="6" width="48" height="52" fill="#0a0a10"/>
  <rect x="8" y="6" width="48" height="52" fill="none" stroke="#2a2438" stroke-width="3"/>
  <g fill="#4a4260">
    <rect x="22" y="16" width="20" height="6"/>
    <rect x="36" y="22" width="6" height="8"/>
    <rect x="28" y="30" width="14" height="6"/>
    <rect x="28" y="36" width="8" height="6"/>
    <rect x="28" y="46" width="8" height="7"/>
  </g>
</svg>`;

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
    /**
     * Which screen the skin cards are currently drawn on — the shop, or the
     * equip screen. Both use `_skinCard`, and it has to redraw the one you
     * are actually looking at when you click one.
     */
    this.view = 'shop';
    this.avatarTab = 'frogs';
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
    this.refresh();
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
    // The equip screen's three sections.
    for (const b of document.querySelectorAll('.av-tab')) {
      b.addEventListener('click', () => {
        this.avatarTab = b.dataset.kind;
        Audio.uiClick();
        this.openAvatar();
      });
    }

    const again = () => {
      const c = this._lastCrate;
      const n = this._lastCount || 1;
      this.closeCrate();
      if (c) this.buyCrate(c, n);
    };
    $('crate-close').onclick = () => { Audio.uiBack(); this.closeCrate(); };
    $('crate-again').onclick = again;
    $('crate-close2').onclick = () => { Audio.uiBack(); this.closeCrate(); };
    $('crate-again2').onclick = again;

    /**
     * S SKIPS THE SPIN.
     *
     * On the document, not the overlay: the overlay never has focus — you
     * got here by clicking a button, and that button kept it — so a
     * listener on `#crate` would never fire. Gated on the overlay being
     * open, so S is the skip key only while a case is being opened and is
     * free for everything else the rest of the time.
     */
    document.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const box = $('crate');
      if (!box || !box.classList.contains('show')) return;
      if ((e.key || '').toLowerCase() !== 's') return;
      e.preventDefault();
      // Safe to call more than once: the second `skip` on the same spin is a
      // no-op, so a duplicate listener costs nothing and needs no bookkeeping
      // that could go stale.
      this.skip();
    });
  }

  /**
   * Say something, on whichever screen is actually showing.
   *
   * The skin cards are drawn on two screens now — the shop and the equip
   * screen — and "Bog Frog equipped." written into the shop's status line
   * while you are looking at the equip screen is a message nobody sees.
   */
  status(msg, isError) {
    const el = $(this.view === 'avatar' ? 'avatar-status' : 'shop-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  /** Redraw whichever screen the cards are on. */
  refresh() {
    if (this.view === 'avatar') this.renderAvatar();
    else this.render();
  }

  /** Is this one unlocked? Default skins and trial mode always are. */
  owns(kind, skin) {
    return this.tryMode
      || skin.id === DEFAULT_SKIN[kind]
      || this.economy.owns(kind, skin.id);
  }

  /**
   * Should this one still be a ??? — no name, no picture, no tier?
   *
   * Only the three Eclipse secrets are ever hidden, and only until they are
   * owned. Everything else in the game tells you exactly what it is before
   * you buy it, which is how a shop should work; these three are the
   * deliberate exception and the reason the collection has a pull.
   *
   * NOT hidden in trial mode. The practice ring lends you everything to look
   * at, and a ??? you cannot try is a ??? nobody learns anything from.
   */
  hidden(kind, skin) {
    return !!skin.secret && !this.owns(kind, skin);
  }

  /** The name, picture and tier to show — masked while it is still a ???. */
  faceOf(kind, skin) {
    if (this.hidden(kind, skin)) {
      return { name: '???', svg: MYSTERY_SVG, tier: '???', color: RARITY.secret.color };
    }
    const r = RARITY[skin.rarity];
    return {
      name: skin.name,
      svg: previewSVG(kind, skin),
      tier: skin.reward ? 'REWARD' : r.name,
      color: r.color,
    };
  }

  openShop() { this.view = 'shop'; this.render(); }

  openAvatar(kind) {
    this.view = 'avatar';
    if (kind) this.avatarTab = kind;
    this.renderAvatar();
  }

  /**
   * ═══ CUSTOMISE AVATAR ══════════════════════════════════════════════════
   *
   * The equip screen: everything you own, in one place, with nothing for
   * sale on it.
   *
   * Equipping used to happen only inside the SHOP, in among the crate
   * offers and their prices — so changing your frog meant walking through a
   * storefront, and the thing you already owned sat next to a button asking
   * you to buy more.
   *
   * GROUPED BY WHERE IT CAME FROM, and the heading is the case's real name
   * read straight off the crate table rather than a label written out here,
   * so a set added later names itself. Reward skins have no case, so they
   * get an AWARDS group of their own at the BOTTOM — they are the things
   * that cannot be bought, and they read better as the end of the list than
   * as an interruption in the middle of it.
   */
  renderAvatar() {
    const kind = this.avatarTab || 'frogs';
    for (const b of document.querySelectorAll('.av-tab')) {
      b.classList.toggle('active', b.dataset.kind === kind);
    }
    const body = $('avatar-body');
    if (!body) return;
    body.textContent = '';

    const items = CATALOG[kind] || [];
    const groupOf = (s) => (s.reward ? 'awards' : setOf(s));
    const order = [];
    for (const s of items) {
      const g = groupOf(s);
      if (order.indexOf(g) === -1) order.push(g);
    }
    order.sort((a, b) => (a === 'awards' ? 1 : 0) - (b === 'awards' ? 1 : 0));

    for (const key of order) {
      const list = items.filter((s) => groupOf(s) === key);
      if (!list.length) continue;

      const head = document.createElement('div');
      head.className = 'set-head';
      const crate = cratesFor(kind).find((c) => setOf(c) === key);
      head.textContent = key === 'awards'
        ? 'AWARDS'
        : (crate ? crate.name.toUpperCase() : (SET_NAMES[key] || key.toUpperCase()));
      // How much of the group you have. The reason to show a set you cannot
      // complete yet is to see how far off you are.
      const have = list.filter((s) => this.owns(kind, s)).length;
      const count = document.createElement('i');
      count.textContent = `${have} / ${list.length}`;
      head.appendChild(count);
      body.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'skin-grid';
      for (const s of list) grid.appendChild(this._skinCard(kind, s));
      body.appendChild(grid);
    }
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
    for (const crate of cratesFor(kind)) body.appendChild(this._crateOffer(crate));

    /**
     * The items, GROUPED BY SET.
     *
     * Three cases fill this tab now. One flat grid of thirty cards would
     * give no clue which case drops which, and a set that you cannot see the
     * boundaries of is not a set — it is a pile.
     *
     * Sets are listed in catalogue order rather than from a fixed list, so
     * adding a fourth one later needs no change here.
     */
    const items = CATALOG[kind] || [];
    const order = [];
    for (const s of items) {
      const set = setOf(s);
      if (order.indexOf(set) === -1) order.push(set);
    }
    for (const set of order) {
      const head = document.createElement('div');
      head.className = 'set-head';
      head.textContent = SET_NAMES[set] || set.toUpperCase();
      body.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'skin-grid';
      for (const skin of items) {
        if (setOf(skin) === set) grid.appendChild(this._skinCard(kind, skin));
      }
      body.appendChild(grid);
    }
  }

  _crateOffer(crate) {
    const wrap = document.createElement('div');
    wrap.className = 'crate-offer';
    /**
     * The contents drawer's open/shut state is kept on the Shop, not on the
     * element. `render()` rebuilds this whole panel on every purchase and
     * every equip, so state living in the DOM would slam the drawer shut the
     * moment you bought anything with it open.
     */
    const peeking = this._peek && this._peek.has(crate.id);
    if (peeking) wrap.classList.add('open');

    const side = document.createElement('div');
    side.className = 'crate-side';

    const box = document.createElement('div');
    // The case looks like its set here too, so you can tell them apart in
    // the shop and not only once one is already open.
    box.className = 'crate-box' + (setOf(crate) === 'base' ? '' : ' ' + setOf(crate));
    box.style.setProperty('--crate-color', crate.color);
    box.innerHTML = '<div class="crate-lock"></div>';
    side.appendChild(box);

    /**
     * CLICK THE CASE TO SEE WHAT IS IN IT.
     *
     * Deliberately not the OPEN CASE button — that one spends money. A case
     * you can inspect before buying is the difference between a gamble and a
     * choice, and the odds on the card only say how often a tier comes up,
     * not which nine things are in it.
     *
     * The caption is not decoration: a box that does something when you
     * click it and gives no sign of that is a secret, so it says so and the
     * chevron says which way it goes.
     */
    const peek = document.createElement('button');
    peek.className = 'crate-peek-btn';
    peek.innerHTML = `<span>WHAT'S INSIDE</span><i>${peeking ? '▴' : '▾'}</i>`;
    const toggle = () => {
      this._peek = this._peek || new Set();
      if (this._peek.has(crate.id)) this._peek.delete(crate.id);
      else this._peek.add(crate.id);
      Audio.uiClick();
      this.render();
    };
    peek.onclick = toggle;
    box.onclick = toggle;
    side.appendChild(peek);
    wrap.appendChild(side);

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
    btn.onclick = () => this.buyCrate(crate, 1);
    buy.appendChild(btn);
    const price = document.createElement('div');
    price.className = 'crate-price';
    price.textContent = crate.price.toLocaleString('en-GB') + ' FROGLETS';
    buy.appendChild(price);

    /**
     * BULK BUYS. Same case, several at a time.
     *
     * Charged at the plain multiple with no discount — this buys SPEED, not
     * a better deal. A ten-pack at a discount would make opening one at a
     * time the wrong move, and then the ×1 button is just a trap for anyone
     * who wanted to watch the animation.
     */
    const bulk = document.createElement('div');
    bulk.className = 'crate-bulk';
    for (const n of BULK_SIZES) {
      if (n === 1) continue;
      const b = document.createElement('button');
      b.className = 'btn btn-quiet';
      b.innerHTML = `<span>×${n}</span>`;
      b.title = `${n} cases — ${(crate.price * n).toLocaleString('en-GB')} froglets`;
      b.onclick = () => this.buyCrate(crate, n);
      bulk.appendChild(b);
    }
    buy.appendChild(bulk);
    const note = document.createElement('div');
    note.className = 'crate-bulk-note';
    note.textContent = BULK_SIZES.filter((n) => n > 1)
      .map((n) => `×${n} ${(crate.price * n).toLocaleString('en-GB')}`)
      .join('  ·  ');
    buy.appendChild(note);

    wrap.appendChild(buy);
    if (peeking) wrap.appendChild(this._crateContents(crate));
    return wrap;
  }

  /**
   * WHAT IS IN A CASE, tier by tier, with the odds on each.
   *
   * Built only when the drawer is open, so a shop tab with three cases is
   * not quietly drawing eighty item previews nobody asked to see.
   *
   * ── rarest first ────────────────────────────────────────────────────────
   * The question anybody opens this to answer is "is the thing I want in
   * here", and the thing they want is at the top of the ladder. The odds
   * come off `crateOdds`, which reads the same pool `rollCrate` rolls from,
   * so what is listed here and what can actually come out cannot drift.
   *
   * Owned items are marked. "Which of these do I still not have" is the
   * other half of the buying decision, and on a set you are most of the way
   * through it is the whole of it.
   */
  _crateContents(crate) {
    const el = document.createElement('div');
    el.className = 'crate-contents';

    const pool = cratePool(crate);
    const pct = {}, per = {};
    for (const o of crateOdds(crate)) { pct[o.rarity] = o.pct; per[o.rarity] = o.per; }

    const owned = pool.filter((s) => this.tryMode || this.economy.owns(crate.kind, s.id));
    const head = document.createElement('div');
    head.className = 'cc-head';
    head.innerHTML = `<b>${pool.length} ITEMS</b>`
      + `<span>${owned.length} of ${pool.length} collected</span>`;
    el.appendChild(head);

    // Rarest tier first. `RARITY_ORDER` runs the other way, so walk it back.
    for (const tier of RARITY_ORDER.slice().reverse()) {
      const group = pool.filter((s) => s.rarity === tier);
      if (!group.length) continue;
      const r = RARITY[tier];
      const row = document.createElement('div');
      row.className = 'cc-tier';
      row.style.borderLeftColor = r.color;

      const label = document.createElement('div');
      label.className = 'cc-label';
      const p = pct[tier] || 0;
      /**
       * THE PERCENTAGE IS THE TIER; THE "1 IN N" IS ONE ITEM.
       *
       * Those are different numbers whenever a tier holds more than one
       * thing, and the one a player actually wants is the second: nobody
       * is hunting "a legendary", they are hunting the Emperor. The
       * Celestial cases carry two Legendaries, so the tier pays out 1.60%
       * of the time while any particular blade is 0.80% — quoting 1 in 63
       * for that would be true of the tier and wrong about every item in
       * it. "each" is what makes the distinction readable.
       */
      const q = per[tier] || 0;
      const many = group.length > 1;
      label.innerHTML = `<span style="color:${r.color}">${r.name.toUpperCase()}</span>`
        + `<b>${p.toFixed(p < 1 ? 2 : 1)}%</b>`
        // One in how many. A percentage under a tenth of one percent means
        // nothing to read; "1 in 500" is a number you can feel.
        + (q > 0 && q < 5
          ? `<i>1 in ${Math.round(100 / q)}${many ? ' each' : ''}</i>` : '');
      row.appendChild(label);

      const grid = document.createElement('div');
      grid.className = 'cc-grid';
      for (const item of group) {
        const have = this.tryMode || this.economy.owns(crate.kind, item.id);
        // The odds for the secret tier are listed — you are told something is
        // in there and how unlikely it is — but the item itself stays a ???.
        const face = this.faceOf(crate.kind, item);
        const card = document.createElement('div');
        card.className = 'cc-item' + (have ? ' owned' : '');
        card.style.borderBottomColor = r.color;
        card.innerHTML = face.svg + `<span>${face.name}</span>`;
        if (have) card.appendChild(Object.assign(document.createElement('i'),
          { className: 'cc-tick', textContent: '✓' }));
        grid.appendChild(card);
      }
      row.appendChild(grid);
      el.appendChild(row);
    }

    // Say the one thing the odds cannot: a case is sealed to its own set.
    const foot = document.createElement('p');
    foot.className = 'cc-foot';
    foot.textContent = `Only these ${pool.length} can come out of this case — `
      + 'nothing from another set, and nothing that has to be earned.';
    el.appendChild(foot);
    return el;
  }

  _skinCard(kind, skin) {
    const owned = this.owns(kind, skin);
    const slot = this._slot(kind);
    const current = this.tryMode && this.trial
      ? this.trial[slot]
      : this.economy.equipped[slot];
    const equipped = (current || DEFAULT_SKIN[kind]) === skin.id;
    // A secret you have not found yet shows as a blank ??? — no name, no
    // colours, nothing that would spoil it.
    const face = this.faceOf(kind, skin);

    const card = document.createElement('div');
    card.className = 'skin-card' + (owned ? '' : ' locked') + (equipped ? ' equipped' : '');
    card.style.borderBottomColor = face.color;
    // A reward skin is not in any crate — say so, rather than letting someone
    // spend five thousand froglets hunting for something they cannot roll.
    // Name the right boss, too: the two Frogath rewards come from different
    // fights, and "BEAT FROGATH" on the Ascended's gear would send you back
    // down the dungeon for something that is not there.
    const lockLabel = skin.reward
      ? (skin.id.includes('divine') ? 'BEAT THE ASCENDED' : 'BEAT FROGATH')
      : 'LOCKED';
    card.innerHTML =
      `<div class="skin-art">${face.svg}</div>`
      + `<div class="skin-name">${face.name}</div>`
      + `<div class="skin-tier" style="color:${face.color}">`
      + `${face.tier}</div>`
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
        // Redraw whichever screen this card is on, not always the shop.
        this.refresh();
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

  /**
   * Every timer the opening sequence sets, in one place.
   *
   * The sequence is a chain of them — stage, spin, reveal, hold, next spin —
   * and closing the overlay part way through has to stop ALL of it. A stray
   * timer would land on a closed overlay and unlock an item you are no
   * longer watching, or start a spin on top of the next purchase.
   */
  _after(ms, fn) {
    const id = setTimeout(fn, ms);
    (this._timers = this._timers || []).push(id);
    return id;
  }

  _clearTimers() {
    for (const id of this._timers || []) clearTimeout(id);
    this._timers = [];
    this._holding = null;
  }

  /**
   * Buy and open `count` cases.
   *
   * The whole purchase is charged and ROLLED UP FRONT. Rolling as each reel
   * starts would mean a ten-pack could be interrupted half way — by a
   * close, a reload, a stray error — having charged for ten and delivered
   * four. Everything is decided here; what follows is presentation.
   */
  buyCrate(crate, count = 1) {
    if (this.opening) return;
    const n = Math.max(1, Math.min(50, count | 0));
    const total = crate.price * n;
    if (!this.economy.canAfford(total)) {
      Audio.uiBack();
      const short = (total - this.economy.froglets).toLocaleString('en-GB');
      this.status(n > 1
        ? `${n} cases costs ${total.toLocaleString('en-GB')} — you need ${short} more.`
        : `Not enough froglets — you need ${short} more.`, true);
      return;
    }
    this.economy.spend(total);
    this.status('');
    this.render();

    this._lastCrate = crate;
    this._lastCount = n;
    this._queue = rollMany(crate, n);
    this._batch = [];
    this._index = 0;
    this.opening = true;

    const box = $('crate');
    box.classList.remove('mist', 'starfield', 'staging', 'batching',
      'anim-base', 'anim-swamp', 'anim-celestial', 'anim-eclipse',
      'eclipsing', 'ec-dark');
    box.classList.add('anim-' + (crate.anim || 'base'));
    if (n > 1) box.classList.add('batching');
    $('crate-batch').classList.remove('show');
    $('crate-result').classList.remove('show');
    $('crate-title').textContent = crate.name.toUpperCase();
    box.classList.add('show');

    this._playStage(crate);
  }

  /**
   * STAGE ONE: the crate itself.
   *
   * Which sequence plays is the crate's `anim`, and all of it lives in CSS —
   * see the keyframes in css/style.css. The node is CLONED to restart it:
   * CSS animations only run when an element enters the document with the
   * class on it, so re-opening a case without replacing the node would show
   * a crate that has already finished cracking.
   */
  _playStage(crate) {
    const box = $('crate');
    const old = $('stage-crate');
    if (old && old.parentNode) {
      old.parentNode.replaceChild(old.cloneNode(true), old);
    }
    box.classList.add('staging');
    const anim = crate.anim || 'base';
    // Nothing written under the crate while it opens. The animation is the
    // thing you are watching; a line of narration under it is just something
    // else asking to be read, and it said nothing the crate was not already
    // showing. The line below the reel stays for what it is FOR — which case
    // of a pack you are on, and the skip key.
    this._sub('');
    if (anim === 'swamp') this._after(430, () => Audio.crateCrack());
    else if (anim === 'celestial') this._after(120, () => Audio.crateLift());
    // The Eclipse cases open on a low tone and nothing else — see the CSS.
    else if (anim === 'eclipse') {
      this._after(520, () => Audio.tone({
        freq: 96, to: 58, dur: 1.1, type: 'sine', volume: 0.16, attack: 0.2 }));
    } else Audio.uiClick();
    this._after(STAGE_MS[anim] || STAGE_MS.base, () => {
      box.classList.remove('staging');
      this._openCrate(crate);
    });
  }

  /** Spin the reel, then reveal. */
  _openCrate(crate) {
    this.opening = true;
    // Decided in `buyCrate`, up front, for the whole purchase. The fallback
    // is only there so a direct call cannot spin a reel with no prize on it.
    const won = (this._queue && this._queue[this._index]) || rollCrate(crate);
    // A ??? never touches the reel. Watching it scroll past a marker would
    // make it one card among fifty-two, which is the opposite of what it is.
    if (won.secret) { this._eclipseReveal(crate, won); return; }
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

    /**
     * THE FILLER GOES THROUGH THE MASK TOO.
     *
     * This was the one place a ??? could still give itself away. The strip
     * is filled at random from the crate's whole pool, and that pool holds
     * the secret — so roughly one card in nine of every reel was The
     * Forgotten One, under its real name, with its real art, scrolling past
     * the marker of a player who has never pulled one.
     *
     * The prize at WIN_INDEX never needs masking: a secret does not reach
     * the reel at all, it branches to `_eclipseReveal` before this runs.
     */
    for (let i = 0; i < COUNT; i++) {
      const item = i === WIN_INDEX ? won : pool[Math.floor(Math.random() * pool.length)];
      const face = this.faceOf(crate.kind, item);
      const el = document.createElement('div');
      el.className = 'reel-item';
      el.style.borderBottomColor = face.color;
      el.innerHTML = face.svg + `<span>${face.name}</span>`;
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
    const bulk = this._queue && this._queue.length > 1;
    const DURATION = bulk ? SPIN_BULK : SPIN_SOLO;
    strip.style.transition = `transform ${DURATION}s cubic-bezier(0.12, 0.62, 0.11, 1)`;
    strip.style.transform = `translateX(${target}px)`;

    /**
     * Kept so S can finish the spin from wherever it has got to. Without the
     * target, a skip would have to guess where the reel was going and could
     * land the marker on the wrong card — which is the one thing a skip must
     * never do: it changes the presentation, not the prize.
     */
    this._target = target;
    this._skipped = false;
    this._spin = (this._spin || 0) + 1;

    this._sub(bulk
      ? `CASE ${this._index + 1} OF ${this._queue.length}  ·  <kbd>S</kbd> SKIP`
      : '<kbd>S</kbd> SKIP');

    this._tickReel(DURATION, this._spin);
    this._after(DURATION * 1000 + 220, () => this._reveal(crate, won));
  }

  /**
   * DEVELOPER MENU ONLY — play an opening for one named item, free.
   *
   * The secret sequence fires roughly once in three thousand opens, which
   * makes it the one piece of this game that cannot be checked by playing
   * it. So the dev menu can ask for it directly. Nothing is charged and
   * nothing is rolled: the queue is set to exactly the item asked for, and
   * the rest of the machinery runs unchanged — which is the point, because
   * a preview that took a different path would not be evidence of anything.
   *
   * The item IS unlocked at the end, exactly as a real open would.
   *
   * @returns false if an opening is already on screen, true otherwise.
   */
  previewOpen(kind, skin) {
    if (this.opening || !skin) return false;
    const crate = cratesFor(kind).find((c) => cratePool(c).includes(skin))
      || cratesFor(kind)[0];
    if (!crate) return false;

    this._lastCrate = crate;
    this._lastCount = 1;
    this._queue = [skin];
    this._batch = [];
    this._index = 0;
    this.opening = true;

    const box = $('crate');
    box.classList.remove('mist', 'starfield', 'staging', 'batching',
      'anim-base', 'anim-swamp', 'anim-celestial', 'anim-eclipse',
      'eclipsing', 'ec-dark');
    box.classList.add('anim-' + (crate.anim || 'base'));
    $('crate-batch').classList.remove('show');
    $('crate-result').classList.remove('show');
    $('crate-title').textContent = crate.name.toUpperCase();
    box.classList.add('show');
    this._playStage(crate);
    return true;
  }

  /**
   * THE SECRET SEQUENCE — run instead of the reel when a ??? comes out.
   *
   * Schedules `ECLIPSE_BEATS` and does nothing else. Each beat switches one
   * thing on; the CSS holds the look and the transitions, this holds the
   * timing, and neither has to know much about the other.
   *
   * `_eclipse` is the live handle. `skip()` and `closeCrate()` both check it
   * to know a cutscene is on screen, and `_endEclipse` is the single place
   * that tears it down — including putting the MUSIC BACK, which has to
   * happen on every exit, not just the one where the sequence finishes.
   */
  _eclipseReveal(crate, won) {
    const box = $('crate');
    $('crate-title').textContent = crate.name.toUpperCase();
    $('crate-result').classList.remove('show');
    box.classList.remove('mist', 'starfield');
    box.classList.add('show', 'eclipsing');

    // Every piece starts off, every time. A second secret in the same
    // ten-pack must play the sequence from the beginning, not resume one
    // that is already lit.
    for (const id of ['ec-disc', 'ec-crate', 'ec-line', 'ec-mystery', 'ec-tag']) {
      const el = $(id);
      if (el) el.classList.remove('on');
    }
    $('ec-mystery').innerHTML = MYSTERY_SVG;
    // Nothing to read and nothing to press. The skip prompt comes back on
    // the first beat, once the screen has actually gone dark.
    this._sub('');

    this._eclipse = { crate, won };
    for (const beat of ECLIPSE_BEATS) {
      this._after(beat.at, () => this._eclipseBeat(beat.act));
    }
  }

  _eclipseBeat(act) {
    if (!this._eclipse) return;
    const box = $('crate');
    switch (act) {
      case 'dark':
        box.classList.add('ec-dark');
        Audio.duckMusic();
        Audio.eclipseFall();
        this._sub('<kbd>S</kbd> SKIP');
        break;
      case 'crate': $('ec-crate').classList.add('on'); break;
      case 'disc':
        $('ec-disc').classList.add('on');
        Audio.eclipsePresence();
        break;
      case 'line': $('ec-line').classList.add('on'); break;
      case 'mystery': $('ec-mystery').classList.add('on'); break;
      case 'tag': $('ec-tag').classList.add('on'); break;
      case 'reveal': {
        const { crate, won } = this._eclipse;
        this._endEclipse();
        this._reveal(crate, won);
        break;
      }
      default: break;
    }
  }

  /**
   * Take the sequence down. Safe to call at any point, and called on every
   * route out — the reveal, a skip, and closing the overlay mid-cutscene.
   */
  _endEclipse() {
    this._eclipse = null;
    const box = $('crate');
    box.classList.remove('eclipsing', 'ec-dark');
    for (const id of ['ec-disc', 'ec-crate', 'ec-line', 'ec-mystery', 'ec-tag']) {
      const el = $(id);
      if (el) el.classList.remove('on');
    }
    // The player's music setting was never changed — only the bus was
    // pulled down — so this is a restore, not a re-apply.
    Audio.unduckMusic(0.8);
  }

  /**
   * S — cut to the last half second.
   *
   * Three things can be on screen and each has its own skip: the crate
   * animation goes straight to the reel, a spinning reel keeps its landing
   * but runs the rest of the way in `SKIP_S`, and the pause between cases in
   * a multi-buy fires the next spin immediately.
   */
  skip() {
    if (!this.opening) return;
    // Mid-cutscene: cut straight to what it is. Somebody who has already
    // seen the eclipse should not have to sit through eleven seconds of it
    // again, and — as with the reel — a skip changes the presentation and
    // never the prize.
    if (this._eclipse) {
      const { crate, won } = this._eclipse;
      this._clearTimers();
      this._endEclipse();
      Audio.uiClick();
      this._reveal(crate, won);
      return;
    }
    const box = $('crate');
    if (box.classList.contains('staging')) {
      this._clearTimers();
      box.classList.remove('staging');
      Audio.uiClick();
      this._openCrate(this._lastCrate);
      return;
    }
    // Between cases: jump to the next one.
    if (this._holding) {
      const go = this._holding;
      this._clearTimers();
      go();
      return;
    }
    if (this._skipped || this._target === undefined) return;
    this._skipped = true;
    this._clearTimers();

    /**
     * Freeze the strip where it actually IS, then run the last half second
     * from there.
     *
     * Reading the computed transform is what makes it continuous: the CSS
     * transition is mid-flight, so the inline value still says the target,
     * and re-transitioning without pinning the real position first would
     * make the reel sit still for half a second and then jump.
     */
    const strip = $('reel-strip');
    const now = typeof getComputedStyle === 'function'
      ? getComputedStyle(strip).transform : null;
    strip.style.transition = 'none';
    if (now && now !== 'none') strip.style.transform = now;
    void strip.offsetWidth;
    strip.style.transition = `transform ${SKIP_S}s cubic-bezier(0.15, 0.75, 0.15, 1)`;
    strip.style.transform = `translateX(${this._target}px)`;

    const crate = this._lastCrate;
    const won = this._queue[this._index];
    this._after(SKIP_S * 1000 + 120, () => this._reveal(crate, won));
  }

  /** The line under the reel: where you are, and how to skip. */
  _sub(html) {
    const el = $('crate-sub');
    if (el) el.innerHTML = html || '';
  }

  /**
   * Ticks that thin out as the reel slows, matching the deceleration.
   *
   * `gen` is the spin this chain belongs to. A skip starts the next reveal
   * while an older chain still has a timer in flight, and without the check
   * that chain would keep clicking over the top of the reveal.
   */
  _tickReel(duration, gen) {
    let t = 0;
    const step = () => {
      if (!this.opening || this._spin !== gen || this._skipped) return;
      Audio.uiHover();
      // Same easing shape as the CSS curve, so the clicks track the motion.
      const p = t / duration;
      const gap = 0.045 + Math.pow(p, 3) * 0.55;
      t += gap;
      if (t < duration) this._tickTimer = this._after(gap * 1000, step);
    };
    step();
  }

  _reveal(crate, won) {
    const r = RARITY[won.rarity];
    // Whether the set is finished is read AFTER the unlock, and compared
    // against what was true before it — so the Eclipse line appears on the
    // one open that completes it, and never again.
    const wasComplete = eclipseProgress(this.economy).complete;
    const dupe = !this.economy.unlock(crate.kind, won.id);
    (this._batch = this._batch || []).push({ item: won, dupe });

    $('cr-rarity').textContent = r.name.toUpperCase();
    $('cr-rarity').style.color = r.color;
    $('cr-art').innerHTML = previewSVG(crate.kind, won);
    $('cr-name').textContent = won.name;
    $('cr-dupe').textContent = dupe
      ? 'You already owned this one.'
      : 'Added to your collection.';

    /**
     * ── the collection reward ───────────────────────────────────────────
     *
     * All three secrets is the rarest thing anybody will ever do in this
     * game, and the only reward the shop cannot hand over itself: a TITLE,
     * which exists to be read by other people. So the card says so, and
     * `onChange` below is what pushes it onto the network profile.
     */
    const title = $('cr-title');
    if (title) {
      const now = eclipseProgress(this.economy);
      const earned = now.complete && !wasComplete;
      title.classList.toggle('show', earned);
      title.textContent = earned
        ? `ALL THREE SECRETS FOUND · YOU ARE NOW [${ECLIPSE_TITLE}]`
        : '';
      if (earned) this._after(400, () => Audio.crateMythic());
    }
    $('crate-result').classList.add('show');

    /**
     * ── the top-tier flourishes ─────────────────────────────────────────
     *
     * A Legendary out of a Swampforged case fills the screen with mist; the
     * one Mythic darkens everything and puts stars behind the item. Both are
     * screen-wide on purpose — a rare drop should change the room, and both
     * are tied to the SET so the effect tells you where the thing came from.
     */
    const anim = crate.anim || 'base';
    const box = $('crate');
    if (anim === 'swamp' && (won.rarity === 'legendary' || won.rarity === 'mythic')) {
      box.classList.add('mist');
      // It rolls in and rolls off again — it is a moment, not a filter left
      // over the screen for as long as you sit reading the card.
      this._after(2800, () => box.classList.remove('mist'));
    }
    if (won.rarity === 'mythic' || won.rarity === 'secret') {
      // Left up until the overlay closes. It is the rarest thing in the game
      // and it happens about once in five hundred opens; it can have the sky.
      box.classList.add('starfield');
    }

    // Louder fanfare the rarer it is.
    if (won.rarity === 'secret') {
      Audio.eclipseReveal();
    } else if (won.rarity === 'mythic') {
      Audio.crateMythic();
    } else if (won.rarity === 'legendary' || won.rarity === 'epic') {
      Audio.headshot({ x: 0, y: 0, z: 0 });
      this._after(120, () => Audio.respawn({ x: 0, y: 0, z: 0 }));
    } else {
      Audio.pickup({ x: 0, y: 0, z: 0 });
    }

    this._index = (this._index || 0) + 1;
    this.onChange();
    this.render();

    const queue = this._queue || [];
    if (this._index < queue.length) {
      /**
       * More to open. Hold the result long enough to read, then spin again —
       * longer for something good, because the reason for a pause here is to
       * let a rare drop land, not to pad out the commons.
       */
      const top = won.rarity !== 'common' && won.rarity !== 'uncommon';
      const next = () => {
        this._holding = null;
        $('crate-result').classList.remove('show');
        box.classList.remove('mist');
        this._openCrate(crate);
      };
      this._holding = next;
      this._after(top ? HOLD_MS.high : HOLD_MS.low, () => {
        if (this._holding === next) next();
      });
      return;
    }

    this.opening = false;
    this._holding = null;
    if (queue.length > 1) this._revealBatch(crate);
    else this._sub('');
  }

  /**
   * Everything a multi-buy produced, once the last case has landed.
   *
   * Sorted RAREST FIRST. After ten opens what you want to know is the best
   * thing you got, and hunting for it down a list in roll order is work the
   * screen should be doing.
   */
  _revealBatch(crate) {
    const batch = this._batch || [];
    $('crate-result').classList.remove('show');
    $('crate').classList.remove('batching');
    $('cb-head').textContent = `${batch.length} CASES OPENED`;

    const rank = (e) => RARITY_ORDER.indexOf(e.item.rarity);
    const grid = $('cb-grid');
    grid.innerHTML = '';
    // Through the mask like everywhere else. Anything in this grid has just
    // been unlocked, so a secret here shows its real name — but routing it
    // by hand is how the reel above ended up leaking, and there is no
    // reason for this to be the one call site that knows better.
    for (const e of batch.slice().sort((a, b) => rank(b) - rank(a))) {
      const r = RARITY[e.item.rarity];
      const face = this.faceOf(crate.kind, e.item);
      const card = document.createElement('div');
      card.className = 'cb-item' + (e.dupe ? '' : ' fresh');
      card.style.borderBottomColor = face.color;
      card.innerHTML = face.svg
        + `<span>${face.name}</span>`
        + `<span style="color:${r.color}">${e.dupe ? 'DUPE' : 'NEW'}</span>`;
      grid.appendChild(card);
    }

    const counts = {};
    for (const e of batch) counts[e.item.rarity] = (counts[e.item.rarity] || 0) + 1;
    $('cb-tally').innerHTML = RARITY_ORDER
      .filter((k) => counts[k]).reverse()
      .map((k) => `<span style="color:${RARITY[k].color}">`
        + `${counts[k]}× ${RARITY[k].name}</span>`).join('');

    const fresh = batch.filter((e) => !e.dupe).length;
    this._sub(fresh
      ? `${fresh} NEW  ·  ${batch.length - fresh} ALREADY OWNED`
      : 'ALL DUPLICATES. IT HAPPENS.');
    $('crate-again2').querySelector('span').textContent
      = `OPEN ${batch.length} MORE`;
    $('crate-batch').classList.add('show');
  }

  closeCrate() {
    this._clearTimers();
    clearTimeout(this._revealTimer);
    clearTimeout(this._tickTimer);
    this.opening = false;
    this._queue = null;
    this._target = undefined;
    // Closing out of the middle of the cutscene must still put the music
    // back, so this goes through the same teardown as every other exit.
    if (this._eclipse) this._endEclipse();
    $('crate').classList.remove('show', 'staging', 'mist', 'starfield',
      'batching', 'anim-base', 'anim-swamp', 'anim-celestial', 'anim-eclipse',
      'eclipsing', 'ec-dark');
    $('crate-batch').classList.remove('show');
    $('crate-result').classList.remove('show');
    this._sub('');
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
