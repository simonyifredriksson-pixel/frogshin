/**
 * THE COUNTER, ON SCREEN — what is on a market stall and what it costs.
 *
 * Walk up to any stall in the country, press E, and this opens: the trade's
 * sign, whoever is behind it saying their line, your purse, and the three to
 * six lots laid out along the counter with an icon, a name, what the thing
 * actually does and a price. Buy as many as you can afford; the panel stays
 * open, so a grocer is one visit rather than six.
 *
 * ── why there is a panel at all ────────────────────────────────────────────
 * The first version of the markets did it on the E prompt: "Buy Stairfoot
 * Glaive — 322 froglets", press E, done. Which is fine for a bag of turnips
 * and indefensible for a weapon, because three hundred froglets is most of a
 * region's income and you could not see what the thing DID before paying.
 * That is not a decision, it is a gamble on a name.
 *
 * ── it is a list, and the list is the whole interface ─────────────────────
 * Deliberately not a grid, not tabs, not a shop with departments. A stall
 * has one trade and a handful of lots; a vertical list shows every one of
 * them at once with room for the stat line, and there is never a second
 * page to discover. The keyboard drives it — up, down, Enter — with the
 * mouse moving the same cursor rather than acting on its own, which is the
 * arrangement js/inventoryui.js already uses and for the same reason: this
 * opens over a game that has just taken the pointer away.
 *
 * ── what it does NOT own ──────────────────────────────────────────────────
 * Money and goods. It calls `onBuy(lot)` and the overworld decides whether
 * that worked, exactly as the props do — see `_propPay`. This file knows
 * what a price looks like and nothing about whether you can pay it.
 */

import { gearIcon } from './gearicons.js?v=v105';
import { clamp } from './util.js?v=v105';

const $ = (id) => document.getElementById(id);

/** Stars as a fixed-width row, so names do not shift about. */
function starRow(n) {
  let s = '';
  for (let i = 0; i < 3; i++) s += i < n ? '★' : '<i>☆</i>';
  return s;
}

/** What a lot is worth having, in one line. */
function statLine(item) {
  if (!item) return 'Throwing blades. The only reliable supply there is.';
  const bits = [];
  if (item.atk) bits.push(`+${item.atk} ATK`);
  if (item.def) bits.push(`+${item.def} DEF`);
  if (item.heal) bits.push(`heals ${item.heal}`);
  if (item.slot) bits.push(item.slot.toUpperCase());
  return bits.join(' · ') || item.cat.toUpperCase();
}

export class StallScreen {
  constructor() {
    this.isOpen = false;
    /** The stall being looked at: { sign, keeper, line, stock, abandoned }. */
    this.stall = null;
    this.cursor = 0;
    /** Set by the owner: (lot) => string|null — the reply to show. */
    this.onBuy = null;
    /** Where the purse comes from. Read, never written. */
    this.economy = null;
    this.progress = null;
    this.notice = '';
    this.noticeT = 0;

    this.root = $('stall');
    this.signEl = $('stall-sign');
    this.purseEl = $('stall-purse');
    this.sayEl = $('stall-say');
    this.listEl = $('stall-list');
    this.detailEl = $('stall-detail');
    this.footEl = $('stall-foot');
  }

  // ---------------------------------------------------------- open and shut

  /**
   * @param stall    { sign, keeper, line, stock, abandoned }
   * @param economy  for the purse — read only
   * @param progress for how many of a thing is already carried
   */
  open(stall, economy, progress) {
    this.stall = stall;
    this.economy = economy;
    this.progress = progress;
    this.isOpen = true;
    this.cursor = 0;
    this.notice = '';
    this.noticeT = 0;
    if (this.root) this.root.classList.remove('hidden');
    this.refresh();
  }

  close() {
    this.isOpen = false;
    this.stall = null;
    if (this.root) this.root.classList.add('hidden');
  }

  // ------------------------------------------------------------------ paint

  get lots() { return (this.stall && this.stall.stock) || []; }

  refresh() {
    const s = this.stall;
    if (!s || !this.root) return;
    const froglets = this.economy ? Math.floor(this.economy.froglets) : 0;
    const lots = this.lots;
    this.cursor = lots.length ? clamp(this.cursor, 0, lots.length - 1) : 0;

    if (this.signEl) this.signEl.textContent = s.sign || 'A STALL';
    if (this.purseEl) {
      this.purseEl.innerHTML = `<span class="sp-coin">◈</span> `
        + `<b>${froglets}</b> froglets`;
    }
    if (this.sayEl) {
      /**
       * NOBODY IS BEHIND THE ONES IN THE HOLLOW MARKET.
       *
       * So there is no keeper and no line — the price board speaks instead.
       * That place's blurb is "Stalls, awnings, prices chalked up. Nobody.",
       * and this is that sentence made usable: you can still buy, you just
       * leave the coins on the counter and nothing thanks you for them.
       */
      this.sayEl.innerHTML = s.abandoned
        ? '<i class="ss-none">Nobody behind the counter. The prices are '
          + 'chalked on the board. Leave the coins.</i>'
        : `<b>${s.keeper}:</b> “${s.line}”`;
    }

    if (this.listEl) {
      this.listEl.innerHTML = '';
      if (!lots.length) {
        const e = document.createElement('div');
        e.className = 'stall-empty';
        e.textContent = 'THE COUNTER IS BARE';
        this.listEl.appendChild(e);
      }
      lots.forEach((lot, i) => {
        const g = lot.item;
        const afford = froglets >= lot.price;
        const full = this._full(lot);
        const b = document.createElement('button');
        b.className = 'stall-row';
        b.classList.toggle('on', i === this.cursor);
        b.classList.toggle('poor', !afford);
        b.classList.toggle('full', full);
        b.innerHTML =
          `<span class="sr-icon">${g ? gearIcon(g) : '✦'}</span>`
          + `<span class="sr-mid">`
          + `<span class="sr-name">${lot.name}</span>`
          + `<span class="sr-stat">${statLine(g)}</span></span>`
          + `<span class="sr-stars">${g ? starRow(g.stars) : ''}</span>`
          + `<span class="sr-price">${lot.price}<i>◈</i></span>`;
        b.onclick = () => {
          if (this.cursor === i) this.buy();
          else { this.cursor = i; this.refresh(); }
        };
        this.listEl.appendChild(b);
      });
    }

    this._paintDetail();
    this._paintFoot();
  }

  /** How many of this lot the bag already holds, and whether it is full. */
  _full(lot) {
    if (!lot || !lot.item || !this.progress) return false;
    return this.progress.count(lot.item.id) >= lot.item.stack;
  }

  _paintDetail() {
    if (!this.detailEl) return;
    const lot = this.lots[this.cursor];
    if (!lot) {
      this.detailEl.innerHTML = '<div class="sd-empty">Nothing here.</div>';
      return;
    }
    const g = lot.item;
    const have = g && this.progress ? this.progress.count(g.id) : 0;
    this.detailEl.innerHTML =
      `<div class="sd-name">${lot.name}</div>`
      + `<div class="sd-desc">${g ? g.desc
        : 'Five blades, straight, and the only reliable supply in the '
        + 'country.'}</div>`
      + `<div class="sd-stat">${statLine(g)}</div>`
      + (g ? `<div class="sd-have">Carrying <b>${have}</b>`
        + `${g.stack > 1 ? ` of ${g.stack}` : ''}</div>` : '')
      + `<div class="sd-price">${lot.price} froglets</div>`;
  }

  _paintFoot() {
    if (!this.footEl) return;
    if (this.noticeT > 0 && this.notice) {
      this.footEl.innerHTML = `<span class="sf-note">${this.notice}</span>`;
      return;
    }
    this.footEl.innerHTML =
      '<b>↑ ↓</b> look along the counter &nbsp;·&nbsp; '
      + '<b>ENTER</b> buy &nbsp;·&nbsp; <b>E</b> / <b>ESC</b> leave';
  }

  _say(msg) {
    this.notice = msg;
    this.noticeT = 3.2;
    this._paintFoot();
  }

  // ------------------------------------------------------------------ acting

  /**
   * Buy whatever the cursor is on.
   *
   * The answer comes from the owner, because money and goods are the
   * overworld's business — see `_stallBuy`. A string back is shown at the
   * foot of the panel; null means it went through quietly.
   */
  buy() {
    const lot = this.lots[this.cursor];
    if (!lot || !this.onBuy) return;
    const reply = this.onBuy(lot);
    this._say(reply || 'Bought.');
    this.refresh();
  }

  /**
   * Keys while the counter is open.
   *
   * Returns true if the panel wants to close, so the caller can put the
   * mouse back where it found it rather than this reaching into pointer
   * lock — the same contract `InventoryScreen.keys` has.
   */
  keys(input) {
    if (!this.isOpen) return false;
    if (input.consume('Escape') || input.consume('KeyE')
      || input.consume('Tab')) return true;
    const n = this.lots.length;
    let moved = false;
    if (n) {
      if (input.consume('ArrowDown') || input.consume('KeyS')) {
        this.cursor = (this.cursor + 1) % n; moved = true;
      }
      if (input.consume('ArrowUp') || input.consume('KeyW')) {
        this.cursor = (this.cursor + n - 1) % n; moved = true;
      }
      /**
       * And the number keys, so a counter with five things on it can be
       * bought from without moving a cursor at all.
       */
      for (let i = 0; i < Math.min(9, n); i++) {
        if (input.consume(`Digit${i + 1}`) || input.consume(`Numpad${i + 1}`)) {
          this.cursor = i;
          this.buy();
          return false;
        }
      }
    }
    if (input.consume('Enter') || input.consume('Space')) {
      this.buy();
      return false;
    }
    if (moved) {
      this.refresh();
      const sel = this.listEl && this.listEl.querySelector('.stall-row.on');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }
    return false;
  }

  update(dt) {
    if (!this.isOpen) return;
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this._paintFoot();
    }
  }
}
