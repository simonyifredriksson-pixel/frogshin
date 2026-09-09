/**
 * THE BAG, ON SCREEN — the Tab inventory.
 *
 * Six category tabs across the top, a grid of slots under them, the frog
 * itself turning on the right with whatever it is wearing, and a detail card
 * for whatever is selected. Everything it shows it reads from a `Progress`;
 * it owns no state about the player at all beyond which slot the cursor is on.
 *
 * ── why the frog is rendered by the game's own renderer ────────────────────
 * A second WebGL context to draw one frog is a second copy of every shader in
 * the game and a second GPU upload of the frog's geometry, spun up and torn
 * down every time somebody presses Tab. Instead the doll box in the DOM is
 * deliberately TRANSPARENT and the frog is drawn straight through it: the
 * screen rect of that box becomes a viewport and a scissor on the main canvas,
 * cleared to the panel's own colour and rendered into after the world.
 *
 * That is why nothing in `.inv-doll` may be given a background — the moment it
 * has one, it covers the only thing that box is for.
 *
 * ── why the cursor is an index and not a DOM focus ────────────────────────
 * The panel is driven from the keyboard first (arrows, then Enter) because
 * this opens over a game where the mouse has just been taken away from the
 * player. Mouse clicks move the same cursor rather than acting directly, so
 * there is exactly one selected thing and one code path that acts on it.
 */

import * as THREE from '../lib/three.module.js?v=v98';
import { CATS, GEAR_BY_ID } from './gear.js?v=v98';
import { gearIcon, catIcon } from './gearicons.js?v=v98';
import { HEART } from './progression.js?v=v98';
import { FrogModel } from './frog.js?v=v98';
import { clamp } from './util.js?v=v98';

const $ = (id) => document.getElementById(id);

/** Scratch, so the per-frame doll pass allocates nothing. */
const _clear = new THREE.Color();

/** Columns in the slot grid. The keyboard cursor needs to know the shape. */
const COLS = 6;

/** Equipment slots, in the order they are listed beside the frog. */
const WORN = [
  { slot: 'weapon', label: 'WEAPON' },
  { slot: 'head', label: 'HEAD' },
  { slot: 'body', label: 'BODY' },
  { slot: 'legs', label: 'LEGS' },
];

/** Stars as a fixed-width row, so names do not shift about. */
function starRow(n) {
  let s = '';
  for (let i = 0; i < 3; i++) s += i < n ? '★' : '<i>☆</i>';
  return s;
}

export class InventoryScreen {
  /**
   * @param renderer  the game's WebGLRenderer, borrowed for the doll
   * @param onChange  called whenever equipment changed, so the game can save
   *                  and re-read stats
   */
  constructor(renderer, onChange = null) {
    this.renderer = renderer;
    this.onChange = onChange;
    /** Set by the game: (item) => bool, true if it was actually eaten. */
    this.onEat = null;
    this.progress = null;
    this.isOpen = false;
    this.cat = 0;
    this.cursor = 0;
    this.rows = [];
    this.time = 0;
    /** Something the player just did, echoed at the foot of the panel. */
    this.notice = '';
    this.noticeT = 0;

    this.root = $('inv');
    this.tabsEl = $('inv-tabs');
    this.gridEl = $('inv-grid');
    this.detailEl = $('inv-detail');
    this.wornEl = $('inv-worn');
    this.dollEl = $('inv-doll');
    this.headEl = $('inv-head');
    this.footEl = $('inv-foot');

    this._buildTabs();
    this._buildDoll();
  }

  // ------------------------------------------------------------------ chrome

  _buildTabs() {
    if (!this.tabsEl) return;
    this.tabsEl.innerHTML = '';
    CATS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'inv-tab';
      b.innerHTML = `<span class="it-icon">${catIcon(c)}</span>`
        + `<span class="it-name">${c.name}</span>`
        + `<span class="it-n" data-count="${c.id}">0</span>`;
      b.onclick = () => { this.cat = i; this.cursor = 0; this.refresh(); };
      this.tabsEl.appendChild(b);
    });
  }

  /**
   * The frog on the right.
   *
   * Its own scene and camera, because it is lit for a display case rather than
   * for the world it is standing in: two flat lights and no shadow, so the
   * silhouette reads at the size of a postage stamp.
   */
  _buildDoll() {
    this.dollScene = new THREE.Scene();
    this.dollCam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
    this.dollCam.position.set(0, 1.35, 6.4);
    this.dollCam.lookAt(0, 1.05, 0);
    const key = new THREE.DirectionalLight(0xfff3d0, 1.35);
    key.position.set(3, 6, 5);
    this.dollScene.add(key);
    const fill = new THREE.HemisphereLight(0xbcd8ff, 0x3a3a2a, 0.85);
    this.dollScene.add(fill);
    this.doll = null;
    this.dollSkins = null;
  }

  /**
   * Rebuild the doll for a colour and skin set.
   *
   * Called on open rather than in the constructor: the shop's equipped skins
   * are not known until the player is in a game, and they can change between
   * one Tab press and the next.
   */
  setFrog(color, skins) {
    const key = `${color}|${skins && skins.frog && skins.frog.id}|`
      + `${skins && skins.sword && skins.sword.id}`;
    if (this.doll && key === this._dollKey) return;
    if (this.doll) {
      this.dollScene.remove(this.doll.root);
      this.doll.dispose();
    }
    this._dollKey = key;
    this.doll = new FrogModel(color, '', true, skins);
    this.doll.root.scale.setScalar(1.5);
    this.dollScene.add(this.doll.root);
  }

  // -------------------------------------------------------------- open/close

  open(progress, color, skins) {
    this.progress = progress;
    this.isOpen = true;
    this.cursor = 0;
    this.setFrog(color, skins);
    this.root.classList.remove('hidden');
    this.refresh();
  }

  close() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }

  // ------------------------------------------------------------------ paint

  /** The whole panel, from the save. Cheap enough to do on every change. */
  refresh() {
    const p = this.progress;
    if (!p) return;
    const st = p.stats();

    // ---- header: who you are ------------------------------------------
    if (this.headEl) {
      // The table is cumulative, so the bar is simply xp against the next
      // total — no need to subtract the previous threshold.
      const next = p.xpForNext;
      const frac = Number.isFinite(next) && next > 0
        ? clamp(p.xp / next, 0, 1) : 1;
      let hearts = '';
      for (let i = 0; i < p.hearts; i++) hearts += '♥';
      this.headEl.innerHTML =
        `<div class="ih-lv">LV <b>${p.level}</b></div>`
        + `<div class="ih-xp"><div class="ih-xp-fill" style="width:${(frac * 100).toFixed(1)}%"></div>`
        + `<span>${p.xp}${Number.isFinite(next) ? ' / ' + next : ''} XP</span></div>`
        + `<div class="ih-hearts">${hearts}<span>${p.hearts * HEART} HP</span></div>`
        + `<div class="ih-stat">ATK <b>${st.atk}</b></div>`
        + `<div class="ih-stat">DEF <b>${st.def}</b></div>`;
    }

    // ---- tabs: which one, and how full each is -------------------------
    const kids = this.tabsEl ? this.tabsEl.children : [];
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('on', i === this.cat);
      const n = p.itemsIn(CATS[i].id).length;
      const badge = kids[i].querySelector('.it-n');
      if (badge) {
        badge.textContent = n;
        badge.classList.toggle('zero', n === 0);
      }
    }

    // ---- the grid ------------------------------------------------------
    this.rows = p.itemsIn(CATS[this.cat].id);
    this.cursor = this.rows.length ? clamp(this.cursor, 0, this.rows.length - 1) : 0;
    this.gridEl.innerHTML = '';
    if (!this.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'NOTHING HERE YET';
      this.gridEl.appendChild(empty);
    }
    this.rows.forEach((row, i) => {
      const g = row.item;
      const el = document.createElement('button');
      el.className = 'inv-slot';
      el.classList.toggle('on', i === this.cursor);
      el.classList.toggle('worn', p.isEquipped(g.id));
      el.innerHTML = `<span class="is-icon">${gearIcon(g)}</span>`
        + `<span class="is-stars">${starRow(g.stars)}</span>`
        + (row.n > 1 ? `<span class="is-n">×${row.n}</span>` : '')
        + (p.isEquipped(g.id) ? '<span class="is-worn">WORN</span>' : '')
        + `<span class="is-name">${g.name}</span>`;
      el.onclick = () => {
        if (this.cursor === i) this.act();
        else { this.cursor = i; this.refresh(); }
      };
      this.gridEl.appendChild(el);
    });

    // ---- what is being worn -------------------------------------------
    if (this.wornEl) {
      this.wornEl.innerHTML = WORN.map(({ slot, label }) => {
        const g = GEAR_BY_ID.get(p.equipped[slot]);
        return `<button class="inv-wornrow${g ? '' : ' none'}" data-slot="${slot}">`
          + `<span class="iw-label">${label}</span>`
          + `<span class="iw-icon">${g ? gearIcon(g) : '<i class="iw-none">·</i>'}</span>`
          + `<span class="iw-name">${g ? g.name : '—'}</span>`
          + `<span class="iw-num">${g ? (g.atk ? '+' + g.atk + ' ATK' : '') + (g.def ? '+' + g.def + ' DEF' : '') : ''}</span>`
          + '</button>';
      }).join('');
      for (const b of this.wornEl.querySelectorAll('.inv-wornrow')) {
        b.onclick = () => {
          const id = p.equipped[b.dataset.slot];
          if (!id) return;
          p.equip(id);                   // equipping the worn one takes it off
          this._say(`${GEAR_BY_ID.get(id).name} put away.`);
          this._changed();
        };
      }
    }

    this._paintDetail();
    this._paintFoot();
  }

  _paintDetail() {
    const p = this.progress;
    const row = this.rows[this.cursor];
    if (!row) {
      this.detailEl.innerHTML = '<div class="id-empty">Nothing selected.</div>';
      return;
    }
    const g = row.item;
    const bits = [];
    if (g.atk) bits.push(`<div class="id-stat"><span>ATTACK</span><b>+${g.atk}</b></div>`);
    if (g.def) bits.push(`<div class="id-stat"><span>DEFENCE</span><b>+${g.def}</b></div>`);
    if (g.heal) bits.push(`<div class="id-stat"><span>RESTORES</span><b>${g.heal} HP</b></div>`);
    if (g.value) bits.push(`<div class="id-stat"><span>WORTH</span><b>${g.value}</b></div>`);
    if (row.n > 1) bits.push(`<div class="id-stat"><span>HELD</span><b>${row.n}</b></div>`);
    const tags = (g.tags || [])
      .map((t) => `<span class="id-tag">${t}</span>`).join('');
    this.detailEl.innerHTML =
      `<div class="id-name">${g.name}</div>`
      + `<div class="id-stars">${starRow(g.stars)}<span class="id-tier">TIER ${g.tier}</span></div>`
      + (bits.length ? `<div class="id-stats">${bits.join('')}</div>` : '')
      + (tags ? `<div class="id-tags">${tags}</div>` : '')
      + `<div class="id-desc">${g.desc}</div>`
      + `<div class="id-act">${this._actLabel(g, p)}</div>`;
  }

  _actLabel(g, p) {
    if (g.slot) return p.isEquipped(g.id) ? 'ENTER — TAKE OFF' : 'ENTER — EQUIP';
    if (g.heal) return 'ENTER — EAT';
    return 'Nothing to do with this one.';
  }

  _paintFoot() {
    if (!this.footEl) return;
    this.footEl.innerHTML = this.noticeT > 0
      ? `<b>${this.notice}</b>`
      : '<span>← → tabs</span><span>ARROWS move</span>'
        + '<span>ENTER equip / eat</span><span>TAB close</span>';
  }

  _say(msg) {
    this.notice = msg;
    this.noticeT = 3;
  }

  _changed() {
    if (this.onChange) this.onChange();
    this.refresh();
  }

  // ----------------------------------------------------------------- acting

  /** Equip, take off, or eat whatever the cursor is on. */
  act() {
    const p = this.progress;
    const row = this.rows[this.cursor];
    if (!p || !row) return;
    const g = row.item;
    if (g.slot) {
      const was = p.isEquipped(g.id);
      if (p.equip(g.id)) {
        this._say(was ? `${g.name} put away.` : `${g.name} equipped.`);
        this._changed();
      }
      return;
    }
    if (g.heal) {
      // Eating is the game's business — it owns the health bar — so this only
      // reports the intent and lets the caller decide whether it landed.
      if (this.onEat && this.onEat(g)) {
        this._say(`Ate the ${g.name.toLowerCase()}.`);
        this._changed();
      } else {
        this._say('Not hurt enough to bother.');
        this._paintFoot();
      }
      return;
    }
    this._say('Nothing happens.');
    this._paintFoot();
  }

  /**
   * One frame of keyboard handling.
   *
   * Returns true if the panel wants to close, so the caller can put the mouse
   * back where it found it rather than this reaching into pointer lock.
   */
  keys(input) {
    if (!this.isOpen) return false;
    if (input.consume('Tab') || input.consume('Escape')) return true;

    const n = this.rows.length;
    let moved = false;
    if (input.consume('KeyQ') || input.consume('BracketLeft')) {
      this.cat = (this.cat + CATS.length - 1) % CATS.length;
      this.cursor = 0; moved = true;
    }
    if (input.consume('KeyE') || input.consume('BracketRight')) {
      this.cat = (this.cat + 1) % CATS.length;
      this.cursor = 0; moved = true;
    }
    if (n) {
      if (input.consume('ArrowRight') || input.consume('KeyD')) {
        this.cursor = (this.cursor + 1) % n; moved = true;
      }
      if (input.consume('ArrowLeft') || input.consume('KeyA')) {
        this.cursor = (this.cursor + n - 1) % n; moved = true;
      }
      if (input.consume('ArrowDown') || input.consume('KeyS')) {
        this.cursor = Math.min(n - 1, this.cursor + COLS); moved = true;
      }
      if (input.consume('ArrowUp') || input.consume('KeyW')) {
        this.cursor = Math.max(0, this.cursor - COLS); moved = true;
      }
    }
    if (input.consume('Enter') || input.consume('Space')) { this.act(); return false; }
    if (moved) {
      this.refresh();
      const sel = this.gridEl.querySelector('.inv-slot.on');
      if (sel && sel.scrollIntoView) {
        sel.scrollIntoView({ block: 'nearest' });
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- drawing

  update(dt) {
    if (!this.isOpen) return;
    this.time += dt;
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this._paintFoot();
    }
    if (this.doll) {
      this.doll.root.rotation.y = Math.sin(this.time * 0.5) * 0.9;
      this.doll.update(dt, {
        speed: 0, vy: 0, grounded: true, moving: false, dashT: 0,
        attackT: 0, attackIndex: 0, sprinting: false, throwT: 0,
        parrying: false, grappling: false, tongueTo: null,
        wallSliding: false, swimming: false, dead: false,
      });
    }
  }

  /**
   * Draw the frog through the transparent doll box.
   *
   * Called after the world has been rendered, with autoClear off, so this
   * paints over the world inside one rectangle and leaves the rest alone.
   * Viewport coordinates count up from the BOTTOM of the canvas, which is why
   * the DOM rect's `bottom` is what gets subtracted.
   */
  render() {
    if (!this.isOpen || !this.dollEl || !this.doll) return;
    const r = this.dollEl.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const R = this.renderer;
    const y = window.innerHeight - r.bottom;
    const prevAuto = R.autoClear;
    // The clear COLOUR is the world's — every mode sets its own sky to it —
    // so it has to go back afterwards or the next frame clears the sky to the
    // colour of this panel.
    R.getClearColor(_clear);
    const prevAlpha = R.getClearAlpha();
    R.autoClear = false;
    R.setScissorTest(true);
    R.setViewport(r.left, y, r.width, r.height);
    R.setScissor(r.left, y, r.width, r.height);
    R.setClearColor(0x14141b, 1);
    R.clear(true, true, false);
    this.dollCam.aspect = r.width / r.height;
    this.dollCam.updateProjectionMatrix();
    R.render(this.dollScene, this.dollCam);
    // Hand the renderer back exactly as it was found: the next frame draws
    // the world, and a viewport left over from here would shrink it into
    // this box.
    R.setScissorTest(false);
    R.setViewport(0, 0, window.innerWidth, window.innerHeight);
    R.setClearColor(_clear, prevAlpha);
    R.autoClear = prevAuto;
  }

  dispose() {
    if (this.doll) {
      this.dollScene.remove(this.doll.root);
      this.doll.dispose();
      this.doll = null;
    }
    this._dollKey = null;
  }
}
