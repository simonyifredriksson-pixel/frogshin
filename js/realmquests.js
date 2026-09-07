/**
 * THE PEOPLE, THE LOG AND THE MAP.
 *
 * Four things that all read the same save and write nothing to the world:
 *
 *   People     the named NPCs, as bodies you can walk up to and talk to
 *   Life       the unnamed ones — villagers going about their day
 *   Dialogue   one line at a time, advanced with E
 *   Journal    the quest log (J) and the realm map (M)
 *
 * ── why nothing here fires an event ───────────────────────────────────────
 * A quest stage is a predicate over the save (see quests.js). So talking to
 * somebody does not "advance" anything: it starts a quest, or it hands one in,
 * and both of those are single facts written to `Progress`. The log then
 * recomputes what to say from scratch. There is no quest state machine to get
 * out of step with the world, because there is no quest state machine.
 *
 * ── the map is the direction-giver ───────────────────────────────────────
 * It draws the ground, the rivers, the roads, every place you have found, and
 * one enormous star on the thing the main line currently wants — with a
 * dashed line to it from wherever you are standing. A locked region is drawn
 * differently from one you simply have not visited, and it says which
 * guardian opens it. The intent is that a player can open this, look once,
 * and close it knowing which way to walk.
 */

import * as THREE from '../lib/three.module.js?v=v84';
import { FrogModel } from './frog.js?v=v84';
import { dampAngle, clamp, mulberry32, lerp } from './util.js?v=v84';
import { QUESTS, QUEST_BY_ID, MAIN, NPCS, npcSays, questProgress,
  mainObjective, SECRETS, SECRET_IDS } from './quests.js?v=v84';
import { REGIONS, REGION_BY_ID, REALM_HALF, SEA, regionOpen } from './regions.js?v=v84';
import { ROADS, RIVERS } from './roads.js?v=v84';
import { GEAR_BY_ID } from './gear.js?v=v84';
import { GUARDIAN_BY_ID } from './guardians.js?v=v84';

const $ = (id) => document.getElementById(id);

/** How close you have to be for the E prompt to appear. */
export const TALK_RANGE = 7.5;

const MARK = {
  give: new THREE.MeshBasicMaterial({ color: 0xffd76b }),
  turn: new THREE.MeshBasicMaterial({ color: 0x8fe86b }),
};
const MARK_GEO = {
  bang: new THREE.BoxGeometry(0.3, 1.0, 0.3),
  dot: new THREE.BoxGeometry(0.3, 0.3, 0.3),
  ring: new THREE.TorusGeometry(0.5, 0.12, 5, 12),
};

/**
 * Which roles move about.
 *
 * Everybody who has a job that keeps them in one place stays in one place: a
 * smith is at his forge, an archivist is in her library. The ones who wander
 * are the ones it would be strange to find standing still — children,
 * rangers, fishers — and that contrast is what makes the still ones read as
 * busy rather than as furniture.
 */
const WANDERS = new Set(['child', 'ranger', 'fisher', 'worker']);

// ══════════════════════════════════════════════════════════════════ people ══

export class People {
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.list = [];
  }

  /** One step per NPC, so thirty frogs do not all build in the same frame. */
  buildTasks() {
    const out = [];
    // Six at a time: thirty separate loading steps is a lot of bar for very
    // little work, and each frog is only a few dozen small meshes.
    for (let i = 0; i < NPCS.length; i += 6) {
      const slice = NPCS.slice(i, i + 6);
      out.push([`Waking the ${slice[0].name.toLowerCase()}`,
        () => { for (const s of slice) this._build(s); }]);
    }
    return out;
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
    model.root.scale.setScalar(spec.role === 'child' ? 0.78 : 1.05);
    this.scene.add(model.root);

    // The marker above their head: a bar over a dot for a quest they are
    // offering, a ring for one they will take back. Never rebuilt — only
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
      home: spot, at: { x: spot.x, y: spot.y, z: spot.z },
      yaw: Math.random() * Math.PI * 2,
      wander: WANDERS.has(spec.role),
      goal: null, wait: Math.random() * 4, speed: 0,
    });
  }

  /**
   * What this NPC's marker should be, given the save.
   *
   * `give` — they have a quest you have not started.
   * `turn` — you have finished everything but the hand-in.
   */
  markFor(npc, p) {
    const gives = npc.spec.gives;
    const turns = npc.spec.turns;
    if (turns && p.quests.has(turns) && !p.questDone(turns)) {
      const q = QUEST_BY_ID.get(turns);
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

      // The wanderers pace a short loop round wherever they belong, and stop
      // dead the moment you are close enough to talk to.
      let moving = false;
      if (npc.wander && d > TALK_RANGE * 1.6) {
        npc.wait -= dt;
        if (!npc.goal || npc.wait <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 4 + Math.random() * 9;
          npc.goal = { x: npc.home.x + Math.cos(a) * r, z: npc.home.z + Math.sin(a) * r };
          npc.wait = 3 + Math.random() * 5;
        }
        const gx = npc.goal.x - npc.at.x, gz = npc.goal.z - npc.at.z;
        const gd = Math.hypot(gx, gz);
        if (gd > 1.2) {
          npc.yaw = dampAngle(npc.yaw, Math.atan2(gx, gz), 3.5, dt);
          npc.at.x += (gx / gd) * 2.4 * dt;
          npc.at.z += (gz / gd) * 2.4 * dt;
          npc.at.y = this.realm.heightAt(npc.at.x, npc.at.z);
          npc.model.root.position.set(npc.at.x, npc.at.y, npc.at.z);
          moving = true;
        } else npc.goal = null;
      }
      // They look at you once you are close.
      if (d < 26 && !moving) npc.yaw = dampAngle(npc.yaw, Math.atan2(dx, dz), 4, dt);

      npc.model.setFacing(npc.yaw);
      npc.model.update(dt, {
        speed: moving ? 2.4 : 0, vy: 0, grounded: true, moving,
        dashT: 0, attackT: 0, attackIndex: 0, sprinting: false, throwT: 0,
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

// ════════════════════════════════════════════════════════════════════ life ══

/** Shared geometry for the villagers. Nine parts, and that is the point. */
const VG = {
  sphere: new THREE.SphereGeometry(1, 8, 6),
  low: new THREE.SphereGeometry(1, 6, 5),
  box: new THREE.BoxGeometry(1, 1, 1),
};
/** One material pair per colour, shared by every villager wearing it. */
const _villagerMats = new Map();
function villagerMats(colour) {
  let m = _villagerMats.get(colour);
  if (m) return m;
  const skin = new THREE.Color(colour);
  m = {
    skin: new THREE.MeshLambertMaterial({ color: skin }),
    dark: new THREE.MeshLambertMaterial({ color: skin.clone().multiplyScalar(0.7) }),
    cloth: new THREE.MeshLambertMaterial({ color: 0xefe6cf }),
    eye: new THREE.MeshBasicMaterial({ color: 0x101014 }),
  };
  _villagerMats.set(colour, m);
  return m;
}

/**
 * A villager: nine meshes, and every one of them earns its place.
 *
 * The player's `FrogModel` is about sixty meshes — a full rig with a gi, a
 * scarf, a katana, eyelids and a nameplate. That is right for the player and
 * for the named characters you talk to, and completely wrong for the five
 * frogs milling about in the market: five of them cost three hundred draw
 * calls, which measured as more than the rest of the village put together.
 *
 * This is a body, a belly, a head, two eyes, two arms, two legs. It bobs when
 * it walks and it turns to look at you, which is all a background villager
 * has ever needed to do.
 */
class Villager {
  constructor(colour, scale = 1) {
    const M = villagerMats(colour);
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.root.scale.setScalar(scale);
    const put = (geo, mat, sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    put(VG.sphere, M.skin, 0.34, 0.30, 0.30, 0, 0.52, 0);
    put(VG.low, M.cloth, 0.30, 0.16, 0.24, 0, 0.44, 0.06);
    this.head = put(VG.sphere, M.skin, 0.26, 0.22, 0.24, 0, 0.82, 0.02);
    for (const sx of [-1, 1]) {
      put(VG.low, M.eye, 0.06, 0.06, 0.06, sx * 0.12, 0.90, 0.18);
    }
    this.arms = [];
    for (const sx of [-1, 1]) {
      this.arms.push(put(VG.low, M.dark, 0.09, 0.20, 0.09, sx * 0.34, 0.50, 0));
    }
    this.legs = [];
    for (const sx of [-1, 1]) {
      this.legs.push(put(VG.low, M.dark, 0.10, 0.18, 0.10, sx * 0.16, 0.18, 0));
    }
    this.t = Math.random() * 6;
    this.stride = 0;
  }

  setFacing(yaw) { this.root.rotation.y = yaw + Math.PI; }

  update(dt, s) {
    this.t += dt;
    const moving = !!s.moving;
    if (moving) this.stride += dt * 7;
    const sw = Math.sin(this.stride);
    this.body.position.y = moving ? Math.abs(sw) * 0.08
      : Math.sin(this.t * 1.8) * 0.02;
    for (let i = 0; i < this.legs.length; i++) {
      this.legs[i].position.z = moving ? sw * 0.14 * (i ? -1 : 1) : 0;
    }
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].position.z = moving ? -sw * 0.10 * (i ? -1 : 1) : 0;
    }
    this.head.rotation.y = Math.sin(this.t * 0.7) * 0.3;
  }

  /** Materials are shared by colour, so a villager owns nothing to free. */
  dispose() {}
}

/** Free the shared villager materials. Geometry is shared; do not touch it. */
export function disposeVillagerMats() {
  for (const [, m] of _villagerMats) {
    for (const k in m) m[k].dispose();
  }
  _villagerMats.clear();
}

/**
 * The unnamed villagers.
 *
 * A settlement with eight houses and one named elder in it is a stage set.
 * This puts six or seven frogs in whichever settlement the player is closest
 * to, wandering between the spots the settlement builder marked out — and
 * takes them away again when the player leaves.
 *
 * Only ONE settlement is populated at a time, and that is the whole trick.
 * Each frog is a few dozen meshes; thirty settlements' worth standing around
 * permanently would cost more than the rest of the world put together, and
 * you can only ever be in one of them.
 */
export class Life {
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.folk = [];
    this.where = null;
  }

  /** Populate a settlement, or nothing if `site` is null. */
  moveTo(site) {
    if (site === this.where) return;
    this.where = site;
    for (const f of this.folk) {
      this.scene.remove(f.model.root);
      f.model.dispose();
    }
    this.folk.length = 0;
    if (!site || !site.spots || !site.spots.length) return;

    const rnd = mulberry32(((Math.round(site.at.x) * 22695477)
      ^ (Math.round(site.at.z) * 1103515245)) >>> 0);
    const COLOURS = [0x6cc24a, 0x8fc44a, 0x53b7e8, 0xd9743a, 0xc9a227,
      0x7fd45a, 0xa8543a, 0x9a6a3a];
    const n = Math.min(site.spots.length, site.kind === 'city' ? 9
      : site.kind === 'town' ? 7 : 5);
    for (let i = 0; i < n; i++) {
      const s = site.spots[Math.floor(rnd() * site.spots.length)];
      const child = rnd() < 0.22;
      const model = new Villager(COLOURS[Math.floor(rnd() * COLOURS.length)],
        child ? 0.72 : 0.95 + rnd() * 0.12);
      const y = this.realm.heightAt(s.x, s.z);
      model.root.position.set(s.x, y, s.z);
      this.scene.add(model.root);
      this.folk.push({
        model, at: { x: s.x, y, z: s.z }, yaw: rnd() * 6.28,
        goal: null, wait: rnd() * 4, speed: 0, child,
      });
    }
  }

  update(dt, playerPos) {
    for (const f of this.folk) {
      f.wait -= dt;
      if (!f.goal || f.wait <= 0) {
        const spots = this.where.spots;
        const s = spots[Math.floor(Math.random() * spots.length)];
        f.goal = { x: s.x + (Math.random() - 0.5) * 6, z: s.z + (Math.random() - 0.5) * 6 };
        f.wait = 3 + Math.random() * 6;
      }
      const gx = f.goal.x - f.at.x, gz = f.goal.z - f.at.z;
      const gd = Math.hypot(gx, gz);
      let moving = false;
      if (gd > 1.4) {
        const sp = f.child ? 3.4 : 2.2;
        f.yaw = dampAngle(f.yaw, Math.atan2(gx, gz), 3, dt);
        f.at.x += (gx / gd) * sp * dt;
        f.at.z += (gz / gd) * sp * dt;
        f.speed = sp;
        moving = true;
      } else {
        f.goal = null;
        f.speed = 0;
      }
      f.at.y = this.realm.heightAt(f.at.x, f.at.z);
      f.model.root.position.set(f.at.x, f.at.y, f.at.z);
      // A villager you walk up to turns and looks at you.
      const dx = playerPos.x - f.at.x, dz = playerPos.z - f.at.z;
      if (!moving && Math.hypot(dx, dz) < 14) {
        f.yaw = dampAngle(f.yaw, Math.atan2(dx, dz), 3, dt);
      }
      f.model.setFacing(f.yaw);
      f.model.update(dt, { moving });
    }
  }

  dispose() {
    this.moveTo(null);
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

/** Icon glyphs on the map, by site kind. */
const PIN = {
  city: '▣', town: '▣', village: '⌂', treevillage: '⌂',
  camp: '△', enemycamp: '✖', hut: '⌂', farm: '≡',
  shrine: '⌖', temple: '⛩', ruin: '⌗', tower: '↑', keep: '▲',
  gatehouse: '⊓', bridge: '≠', cave: '◠', mine: '⛏', dungeon: '⌸',
  arena: '◎', landmark: '★', easteregg: '?',
};

export class Journal {
  constructor() {
    this.logRoot = $('questlog');
    this.logBody = $('ql-body');
    this.mapRoot = $('realmmap');
    this.canvas = $('rm-canvas');
    this.legend = $('rm-legend');
    this.objEl = $('rm-objective');
    this.logOpen = false;
    this.mapOpen = false;
    this._ground = null;
    this.pulse = 0;
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
   * The main line is always listed, and always first. Side quests appear once
   * they have been started — a log full of quests you have never heard of is
   * a checklist, not a journal.
   */
  paintLog(p) {
    if (!this.logBody) return;
    const parts = [];
    const obj = mainObjective(p);
    if (obj) {
      const where = REGION_BY_ID.get(obj.where);
      parts.push('<div class="ql-current"><span>★ CURRENT OBJECTIVE</span>'
        + `<b>${obj.text}</b>`
        + `<i>${where ? where.name : ''} &nbsp;·&nbsp; step ${obj.index + 1} of ${obj.total}</i>`
        + '</div>');
    }
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
    const found = SECRET_IDS.filter((k) => p.found.has(k)).length;
    const openRegions = REGIONS.filter((R) => regionOpen(R, p.slain)).length;
    parts.push('<div class="ql-quest"><div class="ql-name">THE REALM</div>'
      + `<div class="ql-stage tick">✔ ${p.slain.size} guardians put down</div>`
      + `<div class="ql-stage tick">✔ ${p.camps.size} camps cleared</div>`
      + `<div class="ql-stage tick">✔ ${found} of ${SECRET_IDS.length} secrets found</div>`
      + `<div class="ql-stage tick">✔ ${p.seen.size} of ${REGIONS.length} regions entered</div>`
      + `<div class="ql-stage tick">✔ ${openRegions} of ${REGIONS.length} regions unsealed</div>`
      + '</div>');
    this.logBody.innerHTML = parts.join('');
  }

  /**
   * The objectives panel, top-left of the HUD.
   *
   * The main line first and marked active, then any side quest actually
   * accepted. Never more than four rows — the panel is a reminder, not the
   * log.
   */
  static objectives(p) {
    const out = [];
    const obj = mainObjective(p);
    if (obj) {
      const where = REGION_BY_ID.get(obj.where);
      out.push({
        text: `★ ${obj.text}`,
        sub: where ? where.name : '',
        done: false,
      });
    } else {
      out.push({ text: 'The seat is empty. It is over.', sub: '', done: true });
    }
    for (const q of QUESTS) {
      if (!q.side || !p.quests.has(q.id) || p.questDone(q.id)) continue;
      const i = questProgress(q, p);
      if (i < q.stages.length) out.push({ text: q.stages[i].text, sub: '', done: false });
      if (out.length >= 4) break;
    }
    return out;
  }

  // -------------------------------------------------------------------- map

  toggleMap(p, playerPos, realm, facing = 0) {
    this.mapOpen = !this.mapOpen;
    this.mapRoot.classList.toggle('hidden', !this.mapOpen);
    if (this.mapOpen) this.paintMap(p, playerPos, realm, facing);
  }

  /**
   * Called every frame while the map is up.
   *
   * Twelve times a second rather than sixty: the objective star pulses and
   * the player arrow turns with the camera, and neither of those needs the
   * whole map redrawn on every frame.
   */
  tick(dt, p, playerPos, realm, facing = 0) {
    if (!this.mapOpen) return;
    this.pulse += dt;
    this._acc = (this._acc || 0) + dt;
    if (this._acc < 1 / 12) return;
    this._acc = 0;
    this.paintMap(p, playerPos, realm, facing);
  }

  /**
   * A top-down plot of the realm.
   *
   * The GROUND is sampled once and cached — a few tens of thousands of height
   * lookups, which is a blink — and everything on top of it is redrawn
   * because the player's position, the objective and what has been found all
   * change. Regions you have never entered are drawn dark, and regions you
   * cannot enter yet are drawn dark AND told to you: the map is a record of
   * where you have been and a statement of where you may go.
   */
  paintMap(p, playerPos, realm, facing = 0) {
    const c = this.canvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    const N = c.width;
    const SPAN = REALM_HALF * 2;
    const toPx = (v) => ((v + REALM_HALF) / SPAN) * N;

    /**
     * The ground is sampled COARSE and blown up.
     *
     * `heightAt` blends the region table and then carves the rivers and grades
     * the roads through it, so one pixel is real work. At the canvas's own
     * resolution that is hundreds of thousands of them — several seconds, on
     * the frame the player pressed M. At 208 it is forty thousand, which is a
     * blink, and the result is upscaled with smoothing off so it reads as a
     * deliberately pixelated map rather than a blurry one. Built once and
     * kept: the ground does not change.
     */
    if (!this._ground) {
      const S = 208;
      const off = document.createElement('canvas');
      off.width = S; off.height = S;
      const octx = off.getContext('2d');
      const img = octx.createImageData(S, S);
      const step = SPAN / S;
      const pal = {};
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const x = -REALM_HALF + i * step, z = -REALM_HALF + j * step;
          const h = realm.heightAt(x, z);
          realm.paletteAt(x, z, pal);
          let r, g, b;
          if (h < SEA) {
            const k = clamp((SEA - h) / 24, 0, 1);
            r = lerp(44, 12, k); g = lerp(96, 40, k); b = lerp(138, 86, k);
          } else {
            const col = h > pal.highAt ? pal.high : pal.grass;
            r = col.r * 255; g = col.g * 255; b = col.b * 255;
          }
          /**
           * Hillshade.
           *
           * The single thing that makes the map readable as terrain rather
           * than as a colour field: light from the north-west, so a mountain
           * range has a bright face and a dark one and you can see the shape
           * of the land at a glance. Sampled from the height function at the
           * map's own scale, which is why the ranges show and the bumps do
           * not.
           */
          const hx = realm.heightAt(x + step, z) - h;
          const hz = realm.heightAt(x, z + step) - h;
          const shade = clamp(1 + (-hx - hz) / (step * 0.55), 0.42, 1.65);
          const o = (j * S + i) * 4;
          img.data[o] = clamp(r * shade, 0, 255);
          img.data[o + 1] = clamp(g * shade, 0, 255);
          img.data[o + 2] = clamp(b * shade, 0, 255);
          img.data[o + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      this._ground = off;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._ground, 0, 0, N, N);

    // ---- rivers, then roads: the network, so the map reads as a country ----
    const line = (pts, colour, width, dash) => {
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
      ctx.beginPath();
      pts.forEach((q, i) => {
        const px = toPx(q[0]), pz = toPx(q[1]);
        if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
      });
      ctx.stroke();
      ctx.restore();
    };
    for (const r of RIVERS) line(r.pts, 'rgba(70,140,190,0.85)', 3.4);
    for (const r of ROADS) line(r.pts, 'rgba(228,206,150,0.55)', 3.6);
    for (const r of ROADS) line(r.pts, 'rgba(96,72,40,0.75)', 1.4, [7, 5]);

    /**
     * Fog of war, and the seals.
     *
     * Three states, and they have to look like three states: a region you
     * have walked in is clear; one you have not is dimmed; one you cannot
     * enter yet is dimmed AND crossed, with the name of the guardian who
     * opens it written on it. That last part is the important one — a locked
     * door with no label is just a dead end.
     */
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,16,0.80)';
    ctx.fillRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'destination-out';
    for (const R of REGIONS) {
      if (!p.seen.has(R.id)) continue;
      const rad = ((R.r + R.feather) / SPAN) * N;
      const g = ctx.createRadialGradient(toPx(R.x), toPx(R.z), rad * 0.35,
        toPx(R.x), toPx(R.z), rad);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(toPx(R.x), toPx(R.z), rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Locked regions: hatched, and labelled with what opens them.
    for (const R of REGIONS) {
      if (regionOpen(R, p.slain)) continue;
      const rad = (R.r / SPAN) * N;
      const cx = toPx(R.x), cz = toPx(R.z);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cz, rad, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(192,57,43,0.5)';
      ctx.lineWidth = 2;
      for (let k = -rad * 2; k < rad * 2; k += 9) {
        ctx.beginPath();
        ctx.moveTo(cx + k, cz - rad);
        ctx.lineTo(cx + k + rad * 2, cz + rad);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(255,120,100,0.95)';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SEALED', cx, cz - 3);
      const g = GUARDIAN_BY_ID.get(R.gate);
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(255,180,170,0.9)';
      ctx.fillText(g ? g.name.split(',')[0] : R.gate, cx, cz + 10);
    }

    // ---- names ----
    ctx.textAlign = 'center';
    for (const R of REGIONS) {
      if (!p.seen.has(R.id)) continue;
      const cx = toPx(R.x), cz = toPx(R.z);
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = 'rgba(12,14,20,0.75)';
      ctx.fillText(R.name, cx + 1, cz - 15);
      ctx.fillStyle = 'rgba(245,238,220,0.95)';
      ctx.fillText(R.name, cx, cz - 16);
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(245,238,220,0.5)';
      ctx.fillText(`tier ${R.tier}`, cx, cz - 5);
    }

    // ---- pins: places, then guardians ----
    for (const R of REGIONS) {
      if (!p.seen.has(R.id)) continue;
      for (const s of R.sites || []) {
        const px = toPx(s.at[0]), pz = toPx(s.at[1]);
        const known = p.found.has(s.id);
        ctx.font = '14px monospace';
        ctx.fillStyle = known ? '#ffcf5c' : 'rgba(240,232,212,0.62)';
        ctx.fillText(PIN[s.kind] || '·', px, pz + 5);
      }
      if (R.landmark) {
        const px = toPx(R.landmark.at[0]), pz = toPx(R.landmark.at[1]);
        ctx.font = '17px monospace';
        ctx.fillStyle = p.found.has(`landmark:${R.id}`) ? '#ffe9a8'
          : 'rgba(255,233,168,0.55)';
        ctx.fillText('★', px, pz + 6);
      }
      for (const b of R.bosses || []) {
        const px = toPx(b.at[0]), pz = toPx(b.at[1]);
        ctx.beginPath();
        ctx.arc(px, pz, b.final ? 6 : 4.5, 0, Math.PI * 2);
        if (p.slain.has(b.id)) {
          ctx.strokeStyle = '#6cc24a'; ctx.lineWidth = 2; ctx.stroke();
        } else {
          ctx.fillStyle = b.final ? '#ffd76b' : '#c0392b';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        }
      }
    }

    // ---- the objective: a dashed line from you to it, and a big star ----
    const obj = mainObjective(p);
    let target = null;
    if (obj && obj.mark) {
      target = this._markPos(obj.mark);
    }
    const px = toPx(playerPos.x), pz = toPx(playerPos.z);
    if (target) {
      const tx = toPx(target.x), tz = toPx(target.z);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,207,92,0.85)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -(this.pulse * 26) % 16;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(tx, tz);
      ctx.stroke();
      ctx.restore();
      const beat = 1 + Math.sin(this.pulse * 4) * 0.16;
      ctx.save();
      ctx.translate(tx, tz);
      ctx.scale(beat, beat);
      ctx.font = 'bold 30px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(12,14,20,0.8)';
      ctx.fillText('★', 1, 11);
      ctx.fillStyle = '#ffcf5c';
      ctx.fillText('★', 0, 10);
      ctx.restore();
    }

    /**
     * You: an arrow, pointing the way you are facing.
     *
     * A dot tells you where you are and nothing else, which means opening the
     * map still leaves you turning on the spot trying to work out which way
     * is north. An arrow answers both questions at once.
     *
     * ── the angle ──────────────────────────────────────────────────────────
     * `facing` is the follow camera's yaw. Its flat forward vector is
     * `(-sin yaw, -cos yaw)` in world x/z (see FollowCamera.flatForward), and
     * the map puts -z at the top, so that same pair is the direction on the
     * canvas. The arrow below is drawn pointing UP, and rotating "up" by θ
     * clockwise gives `(sin θ, -cos θ)` — equate the two and θ is `-yaw`.
     *
     * A translucent wedge goes behind it for the field of view, which is what
     * makes the heading readable at a glance rather than something you have
     * to squint at a triangle to work out.
     */
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-facing);

    // The view cone: a 70-degree wedge, fading out.
    const cone = ctx.createRadialGradient(0, 0, 3, 0, 0, 46);
    cone.addColorStop(0, 'rgba(124,192,236,0.55)');
    cone.addColorStop(1, 'rgba(124,192,236,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 46, -Math.PI / 2 - 0.61, -Math.PI / 2 + 0.61);
    ctx.closePath();
    ctx.fill();

    // The arrow: a chevron, so the tail reads as a tail and not as a second
    // point. Outlined in the map's own dark so it survives any ground colour.
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7.5, 8);
    ctx.lineTo(0, 3.6);
    ctx.lineTo(-7.5, 8);
    ctx.closePath();
    ctx.fillStyle = '#7cc0ec';
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    if (this.objEl) {
      this.objEl.innerHTML = obj
        ? `<span>★ CURRENT OBJECTIVE</span><b>${obj.text}</b>`
          + `<i>${(REGION_BY_ID.get(obj.where) || {}).name || ''}</i>`
        : '<span>★ COMPLETE</span><b>The seat is empty.</b><i></i>';
    }
    if (this.legend) {
      this.legend.innerHTML =
        '<span><i style="background:#c0392b"></i>guardian standing</span>'
        + '<span><i style="background:#6cc24a"></i>guardian down</span>'
        + '<span><i style="background:#ffd76b"></i>Frogath</span>'
        + '<span><i style="background:#ffcf5c"></i>found</span>'
        + '<span><i style="background:#7cc0ec"></i>you — the arrow points where you are looking</span>'
        + '<span><i style="background:rgba(192,57,43,0.5)"></i>sealed</span>'
        + '<span><i style="background:rgba(228,206,150,0.7)"></i>road</span>'
        + '<span><i style="background:rgba(70,140,190,0.9)"></i>river</span>';
    }
  }

  /** Where a quest stage's marker points, in world coordinates. */
  _markPos(mark) {
    if (!mark) return null;
    if (mark.kind === 'region') {
      const R = REGION_BY_ID.get(mark.id);
      return R ? { x: R.x, z: R.z } : null;
    }
    for (const R of REGIONS) {
      if (mark.kind === 'boss') {
        for (const b of R.bosses || []) {
          if (b.id === mark.id) return { x: b.at[0], z: b.at[1] };
        }
      } else {
        for (const s of R.sites || []) {
          if (s.id === mark.id) return { x: s.at[0], z: s.at[1] };
        }
        if (R.landmark && `landmark:${R.id}` === mark.id) {
          return { x: R.landmark.at[0], z: R.landmark.at[1] };
        }
      }
    }
    return null;
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

/** Everything a secret hands over, so the overworld and the tests agree. */
export function secretFor(id) { return SECRETS[id] || null; }
