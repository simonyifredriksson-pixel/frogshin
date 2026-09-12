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

import * as THREE from '../lib/three.module.js?v=v115';
import { Citizen, pickCitizen, citizenHeight, disposeCitizenMats,
  disposeCitizenGeos } from './citizen.js?v=v115';
import { dampAngle, clamp, mulberry32, lerp } from './util.js?v=v115';
import { QUESTS, QUEST_BY_ID, MAIN, NPCS, npcSays, questProgress,
  mainObjective, SECRETS, SECRET_IDS } from './quests.js?v=v115';
import { REGIONS, REGION_BY_ID, REALM_HALF, SEA, regionOpen } from './regions.js?v=v115';
import { ROADS, RIVERS } from './roads.js?v=v115';
import { GEAR_BY_ID } from './gear.js?v=v115';
import { GUARDIAN_BY_ID } from './guardians.js?v=v115';
import { LORE_COUNT, loreRead } from './lore.js?v=v115';

const $ = (id) => document.getElementById(id);

/** How close you have to be for the E prompt to appear. */
export const TALK_RANGE = 7.5;

const MARK = {
  give: new THREE.MeshBasicMaterial({ color: 0xffd76b }),
  turn: new THREE.MeshBasicMaterial({ color: 0x8fe86b }),
  /**
   * The beacon over somebody who has work for you.
   *
   * Transparent, additive and drawn without writing depth, so it goes up
   * through the roof of whatever they are standing in and can be seen from
   * the edge of the village. A gold bang over a frog's head is only useful
   * once you are already looking at the frog; the point of this is to be
   * what makes you look.
   */
  beam: new THREE.MeshBasicMaterial({
    color: 0xffd76b, transparent: true, opacity: 0.3,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }),
};
const MARK_GEO = {
  bang: new THREE.BoxGeometry(0.3, 1.0, 0.3),
  dot: new THREE.BoxGeometry(0.3, 0.3, 0.3),
  ring: new THREE.TorusGeometry(0.5, 0.12, 5, 12),
  beam: new THREE.CylinderGeometry(0.55, 0.9, 22, 7, 1, true),
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
    /**
     * A named character is a FROG, and a frog of whatever trade they follow.
     *
     * They used to be built from the player's own rig — a ninja in a gi with
     * a katana across its back — which meant the elder who asks you to fetch
     * her a bell clapper was visibly better armed than you were. `Citizen`
     * gives them frog anatomy and the clothes and tools of their role, and
     * only the three armed roles carry a weapon.
     */
    const rnd = mulberry32(((Math.round(spot.x) * 668265263)
      ^ (Math.round(spot.z) * 374761393)) >>> 0);
    const model = new Citizen({
      skin: spec.colour, role: spec.role, rnd,
      scale: spec.role === 'child' ? 0.8 : 1.06,
    });
    model.root.position.set(spot.x, spot.y, spot.z);
    this.scene.add(model.root);

    // The marker above their head: a bar over a dot for a quest they are
    // offering, a ring for one they will take back. Never rebuilt — only
    // shown or hidden, so this costs nothing per frame.
    //
    // In the model's OWN units, because it is a child of the scaled root:
    // `citizenHeight` is in world units, so it has to be divided back out or
    // a large frog's marker ends up twice as far over its head as a small
    // one's.
    const mark = new THREE.Group();
    mark.position.y = citizenHeight(1) / model.scale + 0.45;
    const bang = new THREE.Mesh(MARK_GEO.bang, MARK.give);
    bang.position.y = 0.5;
    const dot = new THREE.Mesh(MARK_GEO.dot, MARK.give);
    const ring = new THREE.Mesh(MARK_GEO.ring, MARK.turn);
    ring.position.y = 0.4;
    ring.rotation.x = Math.PI / 2;
    mark.add(bang, dot, ring);
    model.root.add(mark);

    // The beacon. Its own child of the root rather than of the bobbing marker,
    // because a column of light that bobs reads as a bug.
    const beam = new THREE.Mesh(MARK_GEO.beam, MARK.beam);
    beam.position.y = (citizenHeight(1) / model.scale) + 9.0;
    beam.renderOrder = 2;
    beam.visible = false;
    model.root.add(beam);

    this.list.push({
      spec, model, mark, bang, dot, ring, beam, markY: mark.position.y,
      home: spot, at: { x: spot.x, y: spot.y, z: spot.z },
      yaw: Math.random() * Math.PI * 2,
      wander: WANDERS.has(spec.role),
      goal: null, wait: Math.random() * 4, speed: 0,
      /** Set while a greeting is walking them somewhere. See `script`. */
      script: null, arrived: false,
    });
  }

  /**
   * WALK THIS ONE SOMEWHERE AND HOLD THEM THERE.
   *
   * The quest-giver greeting uses it: rather than the player having to find
   * the right frog in a village of thirty, the frog comes to them. While a
   * script is set the NPC ignores its own wandering entirely, so it cannot
   * wander off mid-cutscene, and `arrived` says when it has got there.
   */
  script(npc, x, z, faceAt) {
    npc.script = { x, z, faceAt };
    npc.arrived = false;
  }

  clearScript(npc) {
    if (!npc) return;
    npc.script = null;
    npc.arrived = false;
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
    /**
     * How close the nearest lit beacon is.
     *
     * The beam material is shared by every NPC, so its fade is decided once,
     * by whichever beacon you are closest to. That is also the right answer:
     * the one you are walking towards is the one the fade is for.
     */
    let nearestBeacon = Infinity;
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
      if (npc.script) {
        // Being walked somewhere by a cutscene. Nothing else gets a say.
        const gx = npc.script.x - npc.at.x, gz = npc.script.z - npc.at.z;
        const gd = Math.hypot(gx, gz);
        if (gd > 0.5) {
          npc.yaw = dampAngle(npc.yaw, Math.atan2(gx, gz), 6, dt);
          const step = Math.min(gd, 3.6 * dt);
          npc.at.x += (gx / gd) * step;
          npc.at.z += (gz / gd) * step;
          npc.at.y = this.realm.heightAt(npc.at.x, npc.at.z);
          npc.model.root.position.set(npc.at.x, npc.at.y, npc.at.z);
          moving = true;
        } else {
          npc.arrived = true;
          const f = npc.script.faceAt || playerPos;
          npc.yaw = dampAngle(npc.yaw, Math.atan2(f.x - npc.at.x, f.z - npc.at.z), 6, dt);
        }
        npc.model.setFacing(npc.yaw);
        npc.model.update(dt, { speed: moving ? 3.6 : 0, moving });
        npc.bang.visible = false;
        npc.dot.visible = false;
        npc.ring.visible = false;
        npc.beam.visible = false;
        continue;
      }
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
      npc.model.update(dt, { speed: moving ? 2.4 : 0, moving });
      const mark = this.markFor(npc, p);
      npc.bang.visible = mark === 'give';
      npc.dot.visible = mark === 'give';
      npc.ring.visible = mark === 'turn';
      npc.mark.rotation.y += dt * 1.6;
      npc.mark.position.y = npc.markY + Math.sin(performance.now() / 400) * 0.12;
      /**
       * The beacon: only for somebody with work to GIVE, and only until you
       * are standing in front of them.
       *
       * It fades out over the last few metres rather than switching off,
       * because a column of light that vanishes as you approach reads as
       * broken, and one that is still there while you are talking to them is
       * in the way of the conversation.
       */
      const beacon = mark === 'give' && d > TALK_RANGE * 0.8;
      npc.beam.visible = beacon;
      if (beacon) {
        npc.beam.scale.y = 1 + Math.sin(performance.now() / 700) * 0.05;
        if (d < nearestBeacon) nearestBeacon = d;
      }
    }
    if (nearestBeacon < Infinity) {
      MARK.beam.opacity = 0.30
        * clamp((nearestBeacon - TALK_RANGE * 0.8) / 8, 0, 1);
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

/**
 * Who you find in what kind of place.
 *
 * The whole answer to "not everyone is a ninja". A fishing village is
 * fishermen and their children; a city is merchants, scholars, priests and
 * bakers. The armed roles are not in ANY of these lists — soldiers only
 * appear where the occupation puts them, and the player is the only ninja in
 * the country.
 */
const CROWD = {
  village: ['farmer', 'fisher', 'child', 'elder', 'worker', 'shopkeeper', 'healer'],
  town: ['merchant', 'smith', 'baker', 'innkeeper', 'child', 'scholar',
    'shopkeeper', 'farmer', 'fishmonger'],
  city: ['merchant', 'scholar', 'priest', 'noble', 'baker', 'innkeeper',
    'healer', 'child', 'shopkeeper', 'smith'],
  treevillage: ['ranger', 'hunter', 'child', 'elder', 'healer', 'farmer'],
  camp: ['worker', 'traveller', 'explorer', 'hunter'],
  farm: ['farmer', 'worker', 'child'],
  hut: ['hermit', 'farmer'],
};

/**
 * Free the shared citizen caches.
 *
 * Both of them: the materials, keyed by (skin, cloth), and the MERGED
 * geometry, keyed by body variant. The geometry is built here rather than at
 * module scope, so unlike the guardians' shared parts it really is this
 * mode's to free — and it is a few hundred kilobytes of buffers, so leaving
 * it behind across a quit and a re-entry would grow with every visit.
 *
 * Kept under the old name because the whole world calls it that.
 */
export function disposeVillagerMats() {
  disposeCitizenMats();
  disposeCitizenGeos();
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

  /**
   * Populate a settlement, or nothing if `site` is null.
   *
   * @param slain the set of guardians already down, so the crowd knows
   *              whether this place is still occupied. Rebuilt when it
   *              changes, which is what makes a village visibly celebrate.
   */
  moveTo(site, slain) {
    const freed = !!(site && site.freedBy && slain && slain.has(site.freedBy));
    if (site === this.where && freed === this._freed) return;
    this.where = site;
    this._freed = freed;
    for (const f of this.folk) {
      this.scene.remove(f.model.root);
      f.model.dispose();
    }
    this.folk.length = 0;
    if (!site || !site.spots || !site.spots.length) return;

    const rnd = mulberry32(((Math.round(site.at.x) * 22695477)
      ^ (Math.round(site.at.z) * 1103515245)) >>> 0);
    /**
     * Who is out, and whether the occupation is still here.
     *
     * A settlement whose guardian is still standing is under it: fewer people
     * on the street, and a couple of Frogath's soldiers among them. Kill the
     * thing in the next valley and the soldiers are gone, the square fills
     * up, and a merchant turns up who was not there before. The boards coming
     * off the windows is `Sites.setFreed`; this is the other half of it.
     */
    const held = !!(site.freedBy && slain && !slain.has(site.freedBy));
    const roles = (CROWD[site.kind] || CROWD.village).slice();
    const full = Math.min(site.spots.length, site.kind === 'city' ? 9
      : site.kind === 'town' ? 7 : 5);
    const n = held ? Math.max(2, full - 2) : full;
    for (let i = 0; i < n; i++) {
      const s = site.spots[Math.floor(rnd() * site.spots.length)];
      /**
       * The garrison, and who turns up once it leaves.
       *
       * Two soldiers while the place is held; a merchant standing where they
       * were once it is not. It is the same list of spots either way, so the
       * change reads as the same square with different people in it.
       */
      const role = held && i < 2 ? 'soldier'
        : (!held && i === 0 && site.kind !== 'village') ? 'merchant'
          : roles[Math.floor(rnd() * roles.length)];
      const model = new Citizen(Object.assign(pickCitizen(rnd, [role]), {
        scale: 0.9 + rnd() * 0.22,
      }));
      const y = this.realm.heightAt(s.x, s.z);
      model.root.position.set(s.x, y, s.z);
      this.scene.add(model.root);
      this.folk.push({
        model, at: { x: s.x, y, z: s.z }, yaw: rnd() * 6.28,
        goal: null, wait: rnd() * 4, speed: 0,
        child: model.buildId === 'young',
        // A soldier patrols rather than pottering, and does not stop to look
        // at you: they are not here to be talked to.
        patrol: role === 'soldier',
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
        // A child runs everywhere, a soldier walks a line, everybody else
        // ambles.
        const sp = f.child ? 3.4 : f.patrol ? 2.8 : 2.2;
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
      /**
       * A villager you walk up to turns and looks at you.
       *
       * A soldier does not, and that is the point of the distinction: the
       * occupation is not interested in you, and a square where two frogs in
       * black walk their line while everybody else watches you says what is
       * happening without a word of dialogue.
       */
      const dx = playerPos.x - f.at.x, dz = playerPos.z - f.at.z;
      if (!moving && !f.patrol && Math.hypot(dx, dz) < 14) {
        f.yaw = dampAngle(f.yaw, Math.atan2(dx, dz), 3, dt);
      }
      f.model.setFacing(f.yaw);
      f.model.update(dt, { moving, speed: f.speed });
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

/**
 * The map, and the objective list that sits in the corner of the HUD.
 *
 * There used to be a third thing here: a full-screen quest LOG on `J`,
 * listing every stage of every quest you had accepted. It has been removed.
 * The objective panel already says what to do next and the map already stars
 * where, so the log was a third place to read the same sentence — and a
 * full-screen panel you have to close is a worse way to read one line than
 * the four rows that are on screen all the time anyway.
 */
export class Journal {
  constructor() {
    this.mapRoot = $('realmmap');
    this.canvas = $('rm-canvas');
    this.legend = $('rm-legend');
    this.objEl = $('rm-objective');
    this.mapOpen = false;
    this._ground = null;
    this.pulse = 0;
  }

  get open() { return this.mapOpen; }

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

  // ---------------------------------------------------------------- minimap

  /**
   * THE MINIMAP — top right, always up, zoomed into where you are standing.
   *
   * The full map on `M` is for planning: the whole country, the objective
   * starred, a line drawn to it. This is for WALKING — a few hundred units
   * around you, the road you are on, the next three places, and your own arrow
   * turning in the middle of it. You should be able to follow a road without
   * stopping to open anything.
   *
   * ── why it is cheap ───────────────────────────────────────────────────────
   * The ground is sampled from `realm.terrain`, the pre-built collision
   * heightfield — an array lookup rather than `realm.heightAt`, which blends
   * the region table and carves the river network and costs about fifteen
   * microseconds a call. At this canvas's resolution that difference is the
   * difference between a stutter every few steps and nothing measurable.
   *
   * And it is only re-sampled when you have actually moved somewhere else:
   * RESAMPLE units of walking, which is about two seconds at a run. In between,
   * the cached image is drawn at an offset, so it scrolls smoothly rather than
   * snapping.
   */
  paintMini(p, playerPos, realm, facing = 0, regionName = '') {
    const c = $('mm-canvas');
    if (!c || !realm || !realm.terrain) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const N = c.width;
    /** How many world units the little map covers, corner to corner. */
    const VIEW = 420;
    const RESAMPLE = 26;
    const px = playerPos.x, pz = playerPos.z;
    const toPx = (wx, wz) => [
      (wx - px) / VIEW * N + N / 2,
      (wz - pz) / VIEW * N + N / 2,
    ];

    /**
     * The ground, re-sampled only when you have left the last patch.
     *
     * `_mini` holds the offscreen image and the world point it was centred
     * on. Between resamples the image is simply drawn shifted by how far you
     * have walked since, which is exact — one world unit is a fixed number of
     * pixels — so the scroll is smooth and free.
     */
    const M = this._mini;
    if (!M || Math.hypot(M.x - px, M.z - pz) > RESAMPLE) {
      this._sampleMini(realm, px, pz, VIEW, N);
    }
    const g = this._mini;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, N, N);
    if (g) {
      // Drawn OVERSIZE and offset: the sample covers more ground than the
      // window shows, which is what leaves something to scroll into.
      const scale = N / VIEW;
      const dx = (g.x - px) * scale;
      const dz = (g.z - pz) * scale;
      const span = g.span * scale;
      ctx.drawImage(g.canvas, N / 2 - span / 2 + dx, N / 2 - span / 2 + dz,
        span, span);
    }

    // ---- the network: rivers under roads, same as the big map ----
    const line = (pts, colour, width) => {
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let drawn = 0;
      pts.forEach((q, i) => {
        const [a, b] = toPx(q[0], q[1]);
        if (i === 0) ctx.moveTo(a, b); else ctx.lineTo(a, b);
        drawn++;
      });
      if (drawn) ctx.stroke();
      ctx.restore();
    };
    /** Skip anything whose nodes are all well outside the window. */
    const near = (pts) => pts.some((q) =>
      Math.abs(q[0] - px) < VIEW && Math.abs(q[1] - pz) < VIEW);
    for (const r of RIVERS) if (near(r.pts)) line(r.pts, 'rgba(70,140,190,0.9)', 5);
    for (const r of ROADS) if (near(r.pts)) line(r.pts, 'rgba(228,206,150,0.7)', 5);

    // ---- what is around you: places, then guardians ----
    const half = VIEW * 0.55;
    ctx.textAlign = 'center';
    for (const R of REGIONS) {
      if (Math.abs(R.x - px) > R.r + VIEW || Math.abs(R.z - pz) > R.r + VIEW) continue;
      for (const s of R.sites || []) {
        if (Math.abs(s.at[0] - px) > half || Math.abs(s.at[1] - pz) > half) continue;
        const [a, b] = toPx(s.at[0], s.at[1]);
        ctx.font = '15px monospace';
        ctx.fillStyle = 'rgba(12,14,20,0.75)';
        ctx.fillText(PIN[s.kind] || '·', a + 1, b + 6);
        ctx.fillStyle = p.found.has(s.id) ? '#ffcf5c' : 'rgba(240,232,212,0.85)';
        ctx.fillText(PIN[s.kind] || '·', a, b + 5);
      }
      for (const b0 of R.bosses || []) {
        if (Math.abs(b0.at[0] - px) > half || Math.abs(b0.at[1] - pz) > half) continue;
        const [a, b] = toPx(b0.at[0], b0.at[1]);
        ctx.beginPath();
        ctx.arc(a, b, 5, 0, Math.PI * 2);
        if (p.slain.has(b0.id)) {
          ctx.strokeStyle = '#6cc24a'; ctx.lineWidth = 2.4; ctx.stroke();
        } else {
          ctx.fillStyle = b0.final ? '#ffd76b' : '#c0392b';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.4; ctx.stroke();
        }
      }
    }

    /**
     * The objective, even when it is off the edge.
     *
     * Inside the window it gets its star. Outside it, the star is pinned to
     * the rim in the right direction — which is the whole reason a minimap
     * beats a compass strip: it tells you where to go AND what is between you
     * and it.
     */
    const obj = mainObjective(p);
    const target = obj && obj.mark ? this._markPos(obj.mark) : null;
    if (target) {
      let [tx, tz] = toPx(target.x, target.z);
      const edge = N / 2 - 12;
      const ox = tx - N / 2, oz = tz - N / 2;
      const d = Math.hypot(ox, oz);
      if (d > edge) { tx = N / 2 + ox / d * edge; tz = N / 2 + oz / d * edge; }
      const beat = 1 + Math.sin(this.pulse * 4) * 0.16;
      ctx.save();
      ctx.translate(tx, tz);
      ctx.scale(beat, beat);
      ctx.font = 'bold 19px monospace';
      ctx.fillStyle = 'rgba(12,14,20,0.85)';
      ctx.fillText('★', 1, 8);
      ctx.fillStyle = '#ffcf5c';
      ctx.fillText('★', 0, 7);
      ctx.restore();
    }

    // ---- you, in the middle, pointing where you are looking ----
    ctx.save();
    ctx.translate(N / 2, N / 2);
    ctx.rotate(-facing);
    const cone = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
    cone.addColorStop(0, 'rgba(124,192,236,0.5)');
    cone.addColorStop(1, 'rgba(124,192,236,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 34, -Math.PI / 2 - 0.61, -Math.PI / 2 + 0.61);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(6.8, 7.2);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-6.8, 7.2);
    ctx.closePath();
    ctx.fillStyle = '#7cc0ec';
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // North, so the little map is orientable even though it does not rotate.
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(12,14,20,0.8)';
    ctx.fillText('N', N / 2 + 1, 13);
    ctx.fillStyle = 'rgba(245,238,220,0.75)';
    ctx.fillText('N', N / 2, 12);

    const label = $('mm-region');
    if (label && label.textContent !== regionName) label.textContent = regionName;
  }

  /**
   * Sample the ground around a point into an offscreen canvas.
   *
   * Deliberately WIDER than the window — 1.5× — so walking does not
   * immediately expose an unsampled edge, and heights come from the collision
   * heightfield rather than the height function. The palette is looked up once
   * per block of pixels rather than per pixel: `paletteAt` blends every region
   * whose weight reaches the point, and at this size the answer does not
   * change within a few metres.
   */
  _sampleMini(realm, cx, cz, view, n) {
    const span = view * 1.5;
    const S = 128;
    let off = this._mini && this._mini.canvas;
    if (!off) {
      off = document.createElement('canvas');
      off.width = S; off.height = S;
    }
    const octx = off.getContext('2d');
    if (!octx) return;
    const img = octx.createImageData(S, S);
    const step = span / S;
    const pal = this._miniPal || (this._miniPal = {});
    const T = realm.terrain;
    for (let j = 0; j < S; j++) {
      const z = cz - span / 2 + j * step;
      for (let i = 0; i < S; i++) {
        const x = cx - span / 2 + i * step;
        const h = T.heightAt(x, z);
        // One palette lookup per eight pixels each way: sixteen a row rather
        // than a hundred and twenty-eight.
        if ((i & 7) === 0 || (j & 7) === 0) realm.paletteAt(x, z, pal);
        // Palette entries are THREE.Colors — components in 0..1, as the big
        // map's sampler above also assumes.
        let r, g, b;
        if (h < SEA) {
          const k = clamp((SEA - h) / 24, 0, 1);
          r = lerp(44, 12, k); g = lerp(96, 40, k); b = lerp(138, 86, k);
        } else {
          const col = h > pal.highAt ? pal.high : pal.grass;
          r = col.r * 255; g = col.g * 255; b = col.b * 255;
        }
        // Hillshade off the same field, so ridges and valleys read.
        const dx = T.heightAt(x + step, z) - h;
        const dz = T.heightAt(x, z + step) - h;
        const shade = clamp(1 + (-dx - dz) / (step * 0.5), 0.45, 1.6);
        const o = (j * S + i) * 4;
        img.data[o] = clamp(r * shade, 0, 255);
        img.data[o + 1] = clamp(g * shade, 0, 255);
        img.data[o + 2] = clamp(b * shade, 0, 255);
        img.data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    this._mini = { canvas: off, x: cx, z: cz, span };
    void n;
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
      /**
       * "ROADS SHUT", and the name of what is standing in them.
       *
       * Not "SEALED". A map is allowed to record that a road is closed — that
       * is what a map is for — but it should say it the way a traveller would
       * have written it, and the thing under it is a creature holding a
       * crossing rather than a lock with a key.
       */
      ctx.fillStyle = 'rgba(255,120,100,0.95)';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ROADS SHUT', cx, cz - 3);
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
    this.mapOpen = false;
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
