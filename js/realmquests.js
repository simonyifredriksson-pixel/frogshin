/**
 * THE PEOPLE, THE LOG AND THE MAP.
 *
 * Three things that all read the same save and write nothing to the world:
 *
 *   People     the ten NPCs, as bodies you can walk up to and talk to
 *   Dialogue   one line at a time, advanced with E
 *   Journal    the quest log (J) and the realm map (M)
 *
 * ── why nothing here fires an event ────────────────────────────────────────
 * A quest stage is a predicate over the save (see quests.js). So talking to
 * somebody does not "advance" anything: it starts a quest, or it hands one in,
 * and both of those are single facts written to `Progress`. The log then
 * recomputes what to say from scratch. There is no quest state machine to get
 * out of step with the world, because there is no quest state machine.
 */

import * as THREE from '../lib/three.module.js?v=v80';
import { FrogModel } from './frog.js?v=v80';
import { dampAngle, clamp } from './util.js?v=v80';
import { QUESTS, QUEST_BY_ID, MAIN, NPCS, npcSays, questProgress,
  SECRETS } from './quests.js?v=v80';
import { REGIONS, REGION_BY_ID, REALM_HALF, SEA } from './regions.js?v=v80';
import { GEAR_BY_ID } from './gear.js?v=v80';

const $ = (id) => document.getElementById(id);

/** How close you have to be for the E prompt to appear. */
export const TALK_RANGE = 7.0;

const MARK = {
  give: new THREE.MeshBasicMaterial({ color: 0xffd76b }),
  turn: new THREE.MeshBasicMaterial({ color: 0x8fe86b }),
};
const MARK_GEO = {
  bang: new THREE.BoxGeometry(0.3, 1.0, 0.3),
  dot: new THREE.BoxGeometry(0.3, 0.3, 0.3),
  ring: new THREE.TorusGeometry(0.5, 0.12, 5, 12),
};

// ══════════════════════════════════════════════════════════════════ people ══

export class People {
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.list = [];
  }

  /** One step per NPC, so ten frogs do not all build in the same frame. */
  buildTasks() {
    return NPCS.map((spec) => [`Waking ${spec.name.toLowerCase()}`,
      () => this._build(spec)]);
  }

  _build(spec) {
    const R = REGION_BY_ID.get(spec.region);
    if (!R) return;
    // Snapped to standable ground the same way a boss arena is: the table's
    // coordinates are a hint beside a village, and the ground under them is
    // generated.
    const spot = this.realm.placeSpot(spec.at[0], spec.at[1], 8, R, 0.40);
    const model = new FrogModel(spec.colour, spec.name, false);
    model.root.position.set(spot.x, spot.y, spot.z);
    model.root.scale.setScalar(1.05);
    this.scene.add(model.root);

    // The marker above their head: a bar over a dot for a quest they are
    // offering, a ring for one they will take back. Rebuilt never — only
    // shown or hidden, so this costs nothing per frame.
    const mark = new THREE.Group();
    mark.position.y = 2.9;
    const bang = new THREE.Mesh(MARK_GEO.bang, MARK.give);
    bang.position.y = 0.5;
    const dot = new THREE.Mesh(MARK_GEO.dot, MARK.give);
    const ring = new THREE.Mesh(MARK_GEO.ring, MARK.turn);
    ring.position.y = 0.4;
    ring.rotation.x = Math.PI / 2;
    mark.add(bang, dot, ring);
    model.root.add(mark);

    this.list.push({
      spec, model, mark, bang, dot, ring,
      at: spot, yaw: Math.random() * Math.PI * 2, talked: false,
    });
  }

  /**
   * What this NPC's marker should be, given the save.
   *
   * `give` — they have a quest you have not started.
   * `turn` — you have finished the last stage of theirs and not handed it in.
   */
  markFor(npc, p) {
    const gives = npc.spec.gives;
    const turns = npc.spec.turns;
    if (turns && !p.questDone(turns) && p.quests.has(turns)) {
      const q = QUEST_BY_ID.get(turns);
      // The final stage of every side quest is "hand it in", so being at the
      // one before the end is what makes them ready to be talked to.
      if (q && questProgress(q, p) >= q.stages.length - 1) return 'turn';
    }
    if (gives && !p.quests.has(gives)) return 'give';
    return null;
  }

  update(dt, playerPos, p) {
    for (const npc of this.list) {
      const dx = playerPos.x - npc.at.x, dz = playerPos.z - npc.at.z;
      const d = Math.hypot(dx, dz);
      // Only the near ones are drawn or animated at all.
      const near = d < 260;
      npc.model.root.visible = near;
      if (!near) continue;
      // They look at you once you are close, and idle otherwise.
      if (d < 30) npc.yaw = dampAngle(npc.yaw, Math.atan2(dx, dz), 4, dt);
      npc.model.setFacing(npc.yaw);
      npc.model.update(dt, {
        speed: 0, vy: 0, grounded: true, moving: false, dashT: 0,
        attackT: 0, attackIndex: 0, sprinting: false, throwT: 0,
        parrying: false, grappling: false, tongueTo: null,
        wallSliding: false, swimming: false, dead: false,
      });
      const mark = this.markFor(npc, p);
      npc.bang.visible = mark === 'give';
      npc.dot.visible = mark === 'give';
      npc.ring.visible = mark === 'turn';
      npc.mark.rotation.y += dt * 1.6;
      npc.mark.position.y = 2.9 + Math.sin(performance.now() / 400) * 0.12;
    }
  }

  /** The nearest NPC within talking distance, or null. */
  near(x, z) {
    let best = null, bestD = TALK_RANGE;
    for (const npc of this.list) {
      const d = Math.hypot(npc.at.x - x, npc.at.z - z);
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }

  dispose() {
    for (const npc of this.list) {
      this.scene.remove(npc.model.root);
      npc.model.dispose();
    }
    this.list.length = 0;
  }
}

// ════════════════════════════════════════════════════════════════ dialogue ══

/**
 * One speaker, a list of lines, and E to go on.
 *
 * Deliberately not a typewriter effect: the lines are short, the player is
 * mid-adventure, and a character-by-character reveal is a thing you wait for
 * on every re-read.
 */
export class Dialogue {
  constructor() {
    this.root = $('talk');
    this.whoEl = $('talk-who');
    this.sayEl = $('talk-say');
    this.lines = [];
    this.at = 0;
    this.open = false;
    /** Called with no arguments when the last line is dismissed. */
    this.onEnd = null;
  }

  start(who, lines, onEnd = null) {
    this.lines = lines.slice();
    this.at = 0;
    this.open = true;
    this.onEnd = onEnd;
    if (this.whoEl) this.whoEl.textContent = who;
    this.root.classList.remove('hidden');
    this._paint();
  }

  _paint() {
    if (this.sayEl) this.sayEl.textContent = this.lines[this.at] || '';
  }

  /** Returns true while it is still holding the screen. */
  keys(input) {
    if (!this.open) return false;
    if (input.consume('Escape')) { this.close(); return false; }
    if (input.consume('KeyE') || input.consume('Enter') || input.consume('Space')) {
      this.at++;
      if (this.at >= this.lines.length) {
        const end = this.onEnd;
        this.close();
        if (end) end();
        return false;
      }
      this._paint();
    }
    return true;
  }

  close() {
    this.open = false;
    this.onEnd = null;
    this.root.classList.add('hidden');
  }
}

// ═════════════════════════════════════════════════════════════════ journal ══

export class Journal {
  constructor() {
    this.logRoot = $('questlog');
    this.logBody = $('ql-body');
    this.mapRoot = $('realmmap');
    this.canvas = $('rm-canvas');
    this.legend = $('rm-legend');
    this.logOpen = false;
    this.mapOpen = false;
    this._drawn = false;
  }

  get open() { return this.logOpen || this.mapOpen; }

  // -------------------------------------------------------------------- log

  toggleLog(p) {
    this.logOpen = !this.logOpen;
    this.logRoot.classList.toggle('hidden', !this.logOpen);
    if (this.logOpen) this.paintLog(p);
  }

  /**
   * The log, recomputed from the save every time it opens.
   *
   * The main line is always listed. Side quests appear once they have been
   * started — a log full of quests you have never heard of is a checklist,
   * not a journal.
   */
  paintLog(p) {
    if (!this.logBody) return;
    const parts = [];
    for (const q of QUESTS) {
      const known = q.id === MAIN || p.quests.has(q.id);
      if (!known) continue;
      const at = questProgress(q, p);
      const done = at >= q.stages.length || p.questDone(q.id);
      parts.push(`<div class="ql-quest${done ? ' done' : ''}">`
        + `<div class="ql-name${q.side ? '' : ' main'}">${q.name}`
        + (done ? ' — COMPLETE' : '') + '</div>'
        + `<div class="ql-blurb">${q.blurb}</div>`
        + q.stages.map((s, i) => {
          if (i > at) return '';       // nothing about what comes next
          const tick = i < at;
          const where = REGION_BY_ID.get(s.where);
          return `<div class="ql-stage${tick ? ' tick' : ''}">`
            + `${tick ? '✔' : '▸'} ${s.text}`
            + (tick || !where ? '' : ` <span class="ql-where">— ${where.name}</span>`)
            + '</div>';
        }).join('')
        + '</div>');
    }
    const found = Object.keys(SECRETS).filter((k) => p.found.has(k)).length;
    parts.push('<div class="ql-quest"><div class="ql-name">THE REALM</div>'
      + `<div class="ql-stage tick">✔ ${p.slain.size} guardians put down</div>`
      + `<div class="ql-stage tick">✔ ${p.camps.size} camps cleared</div>`
      + `<div class="ql-stage tick">✔ ${found} of ${Object.keys(SECRETS).length} secrets found</div>`
      + `<div class="ql-stage tick">✔ ${p.seen.size} of ${REGIONS.length} regions entered</div>`
      + '</div>');
    this.logBody.innerHTML = parts.join('');
  }

  /** The current main-line objective, for the HUD's objectives panel. */
  static objectives(p) {
    const out = [];
    const main = QUEST_BY_ID.get(MAIN);
    const at = questProgress(main, p);
    if (at < main.stages.length) {
      out.push({ text: main.stages[at].text, done: false });
    } else {
      out.push({ text: 'The seat is empty. It is over.', done: true });
    }
    // Then any side quest in progress, so the panel is a to-do list of things
    // actually accepted rather than everything in the file.
    for (const q of QUESTS) {
      if (!q.side || !p.quests.has(q.id) || p.questDone(q.id)) continue;
      const i = questProgress(q, p);
      if (i < q.stages.length) out.push({ text: q.stages[i].text, done: false });
      if (out.length >= 4) break;
    }
    return out;
  }

  // -------------------------------------------------------------------- map

  toggleMap(p, playerPos, realm) {
    this.mapOpen = !this.mapOpen;
    this.mapRoot.classList.toggle('hidden', !this.mapOpen);
    if (this.mapOpen) this.paintMap(p, playerPos, realm);
  }

  /**
   * A top-down plot of the realm.
   *
   * The GROUND is drawn once and cached — it is a few thousand height lookups
   * and it never changes — and the things on top of it are redrawn every time
   * the map opens, because where you are standing and what you have killed do
   * change. Regions you have never entered are drawn dark: the map is a record
   * of where you have been, not a spoiler.
   */
  paintMap(p, playerPos, realm) {
    const c = this.canvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    const N = c.width;
    /**
     * The ground is sampled COARSE and blown up.
     *
     * `heightAt` blends thirteen regions of multi-octave noise and
     * `paletteAt` does the same again for six colours, so one pixel is real
     * work. At the canvas's own 720 square that is half a million of them —
     * several seconds, on the frame the player pressed M. At 180 it is thirty
     * thousand, which is a blink, and the result is upscaled with smoothing
     * off so it reads as a deliberately pixelated map rather than a blurry
     * one. Built once and kept: the ground does not change.
     */
    if (!this._ground) {
      const S = 180;
      const off = document.createElement('canvas');
      off.width = S; off.height = S;
      const octx = off.getContext('2d');
      const img = octx.createImageData(S, S);
      const step = (REALM_HALF * 2) / S;
      const pal = {};
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const x = -REALM_HALF + i * step, z = -REALM_HALF + j * step;
          const h = realm.heightAt(x, z);
          realm.paletteAt(x, z, pal);
          let r, g, b;
          if (h < SEA) {
            const k = clamp((SEA - h) / 20, 0, 1);
            r = 40 * (1 - k) + 12 * k; g = 90 * (1 - k) + 40 * k;
            b = 130 * (1 - k) + 80 * k;
          } else {
            const shade = clamp(0.55 + h / 260, 0.55, 1.25);
            const col = h > pal.highAt ? pal.high : pal.grass;
            r = col.r * 255 * shade; g = col.g * 255 * shade; b = col.b * 255 * shade;
          }
          const o = (j * S + i) * 4;
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      this._ground = off;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._ground, 0, 0, N, N);

    const toPx = (x) => ((x + REALM_HALF) / (REALM_HALF * 2)) * N;

    // Fog of war: everything outside the regions you have entered is dimmed.
    ctx.save();
    ctx.fillStyle = 'rgba(6,8,12,0.72)';
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'destination-out';
    for (const R of REGIONS) {
      if (!p.seen.has(R.id)) continue;
      const g = ctx.createRadialGradient(toPx(R.x), toPx(R.z), 0,
        toPx(R.x), toPx(R.z), (R.r + R.feather) / (REALM_HALF * 2) * N);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(toPx(R.x), toPx(R.z), (R.r + R.feather) / (REALM_HALF * 2) * N,
        0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    for (const R of REGIONS) {
      const seen = p.seen.has(R.id);
      if (!seen) continue;
      ctx.fillStyle = 'rgba(239,230,207,0.9)';
      ctx.fillText(R.name, toPx(R.x), toPx(R.z) - 4);
      ctx.fillStyle = 'rgba(239,230,207,0.45)';
      ctx.fillText(`tier ${R.tier}`, toPx(R.x), toPx(R.z) + 9);
      // Guardians: filled if still standing, hollow if put down.
      for (const b of R.bosses || []) {
        const px = toPx(b.at[0]), pz = toPx(b.at[1]);
        ctx.beginPath();
        ctx.arc(px, pz, 4, 0, Math.PI * 2);
        if (p.slain.has(b.id)) {
          ctx.strokeStyle = '#6cc24a'; ctx.lineWidth = 2; ctx.stroke();
        } else {
          ctx.fillStyle = b.final ? '#ffd76b' : '#c0392b'; ctx.fill();
        }
      }
      for (const s of R.sites || []) {
        const px = toPx(s.at[0]), pz = toPx(s.at[1]);
        ctx.fillStyle = p.found.has(s.id) ? '#ffcf5c' : 'rgba(239,230,207,0.35)';
        ctx.fillRect(px - 2.5, pz - 2.5, 5, 5);
      }
    }

    // You. Drawn last and biggest, because it is the one thing the map is
    // always asked first.
    const px = toPx(playerPos.x), pz = toPx(playerPos.z);
    ctx.beginPath();
    ctx.arc(px, pz, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#7cc0ec';
    ctx.fill();
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (this.legend) {
      this.legend.innerHTML =
        '<span><i style="background:#c0392b"></i>guardian standing</span>'
        + '<span><i style="background:#6cc24a"></i>guardian down</span>'
        + '<span><i style="background:#ffd76b"></i>Frogath</span>'
        + '<span><i style="background:#ffcf5c"></i>place found</span>'
        + '<span><i style="background:#7cc0ec"></i>you</span>';
    }
  }

  closeAll() {
    this.logOpen = false;
    this.mapOpen = false;
    this.logRoot.classList.add('hidden');
    this.mapRoot.classList.add('hidden');
  }
}

// ═════════════════════════════════════════════════════════════════ rewards ══

/**
 * Hand over a quest's reward, and say what arrived.
 *
 * Returns the lines to show, so the caller can put them straight into the
 * dialogue box — a reward you are not told about is a reward the player has
 * to go and look for in a menu.
 */
export function grantReward(p, quest) {
  const said = [];
  if (!quest.reward) return said;
  if (quest.reward.xp) {
    const r = p.addXp(quest.reward.xp);
    said.push(`${quest.reward.xp} experience.`);
    for (const lv of r.levels) said.push(`You are level ${lv}.`);
  }
  for (const it of quest.reward.items || []) {
    const g = GEAR_BY_ID.get(it.id);
    if (!g) continue;
    const got = p.add(it.id, it.n);
    if (got > 0) said.push(`Received: ${g.name}${it.n > 1 ? ` ×${it.n}` : ''}.`);
  }
  return said;
}
