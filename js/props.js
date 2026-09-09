/**
 * THINGS THAT ACTUALLY MOVE WHEN YOU TOUCH THEM.
 *
 * Every interaction in the Croaklands used to be a line of text: stand near a
 * thing, press E, read "obtained". This file is the answer to that. A chest
 * has a lid, and the lid swings up on its hinge. A lever has a handle, and the
 * handle throws. A door has two leaves and they open. A sword on a pedestal
 * lifts off the pedestal. The prompt is still there — it has to be, or nobody
 * would know the thing was interactive — but the prompt is not the event.
 *
 * ── the shape of a prop ────────────────────────────────────────────────────
 * One class, one `kind`, because they all want the same six things: a group in
 * the scene, colliders, a persistent id, a reach, an animation clock and a
 * payoff beat somewhere in the middle of that clock. Splitting them into seven
 * classes bought nothing but seven copies of `update`.
 *
 *   chest     lid on a hinge; the contents rise out of it and come to you
 *   crate     a lid that comes off sideways, for the rougher settlements
 *   lever     a handle that throws, and stays thrown
 *   gate      a portcullis that RISES, taking its collider with it
 *   door      two leaves that swing, taking their colliders with them
 *   plate     a pressure plate that sinks under a hand
 *   pedestal  something standing on a stand, lifted off it
 *   pickup    something lying on the ground, picked up off it
 *
 * ── why the colliders are built at load and only disabled later ────────────
 * The collision broadphase is baked ONCE, with every box already in it, and
 * nothing looks at a box added afterwards. So a door's leaf gets its solid at
 * load like everything else and opening it sets `disabled` — which the
 * broadphase does honour, on every query. See CollisionWorld.bake.
 *
 * ── persistence ───────────────────────────────────────────────────────────
 * A prop that has been used records its id in `Progress.found`, and `restore`
 * puts it back in its used pose with no animation and no reward. An opened
 * chest stays open across a save, which is the only way a player can tell at
 * a glance which rooms of a ruin they have already been through.
 */

import * as THREE from '../lib/three.module.js?v=v100';
import { clamp, lerp, damp } from './util.js?v=v100';
import { Audio } from './audio.js?v=v100';

const _v = new THREE.Vector3();

/** Shared geometry. One of each, for every prop in the world. */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  ico: new THREE.IcosahedronGeometry(1, 0),
  cone: new THREE.ConeGeometry(1, 1, 6),
  oct: new THREE.OctahedronGeometry(1, 0),
};

/**
 * Materials, cached by colour.
 *
 * Two hundred chests in a world share four materials rather than owning six
 * hundred, which is the difference between the props being free and the props
 * being the reason the frame rate drops in a ruin.
 */
const MATS = new Map();
function mat(color, opts) {
  const key = color + (opts ? ':' + JSON.stringify(opts) : '');
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {}));
    MATS.set(key, m);
  }
  return m;
}
export function disposePropMats() {
  for (const m of MATS.values()) m.dispose();
  MATS.clear();
}

const mesh = (geo, m, sx, sy, sz, x, y, z) => {
  const o = new THREE.Mesh(geo, m);
  o.scale.set(sx, sy, sz);
  o.position.set(x, y, z);
  return o;
};

/**
 * How long each kind takes, and when in that time the payoff lands.
 *
 * `pay` is deliberately not 0 and not 1. At 0 the reward arrives before the
 * lid has moved, which is the text-box problem again; at 1 the player has
 * been staring at an open chest for a second wondering whether it worked.
 */
const TIMING = {
  chest: { dur: 0.9, pay: 0.42, reach: 3.0 },
  crate: { dur: 0.7, pay: 0.40, reach: 3.0 },
  lever: { dur: 0.6, pay: 0.55, reach: 3.0 },
  gate: { dur: 2.6, pay: 0.90, reach: 5.0 },
  door: { dur: 1.5, pay: 0.70, reach: 4.0 },
  plate: { dur: 0.45, pay: 0.60, reach: 2.6 },
  pedestal: { dur: 1.1, pay: 0.45, reach: 3.0 },
  pickup: { dur: 0.75, pay: 0.30, reach: 2.8 },
  /**
   * The two that carry the story.
   *
   * Longer than the rest and paying LATE, because the payoff is a page of
   * text: the carving finishing lighting up, or the cover coming all the way
   * open, is what should put the words on screen. Paying at a third of the
   * way through would open the dialogue box over a book that is still shut.
   */
  stele: { dur: 1.1, pay: 0.75, reach: 3.4 },
  tome: { dur: 1.0, pay: 0.70, reach: 3.0 },
  /** A market stall. The only prop you can use more than once. */
  stall: { dur: 0.8, pay: 0.45, reach: 3.6 },
};

export class Prop {
  /**
   * @param spec  { kind, id, at:{x,y,z}, yaw, wood, trim, label, prize,
   *                takes, linked }
   *   label   what the E prompt says
   *   prize   whatever the owner wants to hand over — this file never reads
   *           it, it only says when to hand it over
   *   takes   a key item id the world requires before this will move
   *   linked  another prop's id this one opens, for a lever on a gate
   */
  constructor(spec, scene) {
    this.spec = spec;
    this.kind = spec.kind;
    this.id = spec.id;
    this.scene = scene;
    const T = TIMING[this.kind] || TIMING.chest;
    this.dur = T.dur;
    this.payAt = T.pay;
    this.reach = spec.reach || T.reach;

    this.group = new THREE.Group();
    this.group.position.set(spec.at.x, spec.at.y, spec.at.z);
    this.group.rotation.y = spec.yaw || 0;
    this.group.visible = false;

    /** 'shut' -> 'moving' -> 'used'. Nothing goes back. */
    this.state = 'shut';
    this.t = 0;
    this.paid = false;
    /** Colliders, so the owner can hand them to the collision world. */
    this.solids = [];
    /** Boxes to switch off once this thing is open. */
    this.blockers = [];
    /** The prize, floating out of whatever it was in. */
    this.prize = null;
    this.prizeT = 0;

    this._build();
    scene.add(this.group);
  }

  get used() { return this.state === 'used'; }
  get moving() { return this.state === 'moving'; }
  /** Where the prompt and the reach test measure from. */
  get pos() { return this.group.position; }

  // ---------------------------------------------------------------- building

  _build() {
    const s = this.spec;
    const wood = s.wood === undefined ? 0x6b4a2a : s.wood;
    const trim = s.trim === undefined ? 0xc9a227 : s.trim;
    switch (this.kind) {
      case 'chest': this._chest(wood, trim); break;
      case 'crate': this._crate(wood, trim); break;
      case 'lever': this._lever(wood, trim); break;
      case 'gate': this._gate(trim); break;
      case 'door': this._door(wood, trim); break;
      case 'plate': this._plate(trim); break;
      case 'pedestal': this._pedestal(wood, trim); break;
      case 'stele': this._stele(trim); break;
      case 'tome': this._tome(wood, trim); break;
      case 'stall': this._stall(wood, trim); break;
      default: this._pickup(trim); break;
    }
  }

  /**
   * A carved standing stone.
   *
   * The carving is a separate group that starts at nothing and grows to full
   * size when it is read, which on screen looks like the cuts filling with
   * light as you brush four hundred years of moss off them. It uses scale
   * rather than opacity because the materials are shared by colour — fading
   * one stele's glow would fade every stele's.
   */
  _stele(trim) {
    const stone = 0x6d6a63;
    this.group.add(mesh(G.box, mat(0x46443f), 2.2, 0.3, 1.0, 0, 0.15, 0));
    // Leaning, always. A standing stone that is exactly upright looks placed.
    const body = new THREE.Group();
    body.rotation.z = 0.05;
    this.group.add(body);
    body.add(mesh(G.box, mat(stone), 1.7, 3.3, 0.55, 0, 1.75, 0));
    body.add(mesh(G.box, mat(0x53504a), 1.85, 0.22, 0.7, 0, 3.4, 0));
    // Moss along the bottom, on the weather side.
    body.add(mesh(G.box, mat(0x4f6a3a), 1.72, 0.5, 0.58, 0, 0.55, 0.01));

    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 2.0, 0.3);
    body.add(this.hinge);
    // The cuts. Five lines of them, and they light up.
    for (let i = 0; i < 5; i++) {
      const w = 0.5 + ((i * 7) % 5) * 0.16;
      this.hinge.add(mesh(G.box, mat(trim), w, 0.055, 0.05, 0, 0.55 - i * 0.28, 0));
    }
    this.hinge.scale.setScalar(0.001);
    this.solids.push({ cx: 0, cy: 1.7, cz: 0, hx: 0.85, hy: 1.7, hz: 0.4, tag: 'solid' });
  }

  /**
   * A market stall that sells kunai, and the only prop you can use twice.
   *
   * The blades are physically on the counter in a rack, and buying slides
   * the rack toward you and takes one bundle out of it — then it slides back
   * and refills, because a shop that runs out the first time you use it is
   * not a shop. `spec.repeat` is what lets this one reset; every other prop
   * in the world is a one-shot on purpose.
   */
  _stall(wood, trim) {
    this.group.add(mesh(G.box, mat(wood), 2.6, 0.16, 1.1, 0, 1.0, 0));
    for (const s of [-1, 1]) {
      this.group.add(mesh(G.box, mat(0x4a3822), 0.16, 1.0, 0.16, s * 1.2, 0.5, 0.45));
      this.group.add(mesh(G.cyl, mat(0x4a3822), 0.09, 2.4, 0.09, s * 1.2, 1.2, -0.45));
    }
    // The awning, because a stall without one reads as a table.
    this.group.add(mesh(G.box, mat(trim), 3.0, 0.1, 1.6, 0, 2.4, -0.1));
    this.group.add(mesh(G.box, mat(0x8a4a3a), 3.0, 0.34, 0.08, 0, 2.2, 0.66));
    // A crate of stock behind the counter.
    this.group.add(mesh(G.box, mat(wood), 0.8, 0.7, 0.7, 0.9, 0.35, -0.7));

    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 1.14, 0);
    this.group.add(this.hinge);
    // A rack of blades, point up, in a row.
    for (let i = -2; i <= 2; i++) {
      this.hinge.add(mesh(G.cone, mat(0xb8c0c8), 0.06, 0.42, 0.06, i * 0.38, 0.2, 0));
      this.hinge.add(mesh(G.box, mat(0x2a2a30), 0.04, 0.2, 0.04, i * 0.38, -0.05, 0));
    }
    this.solids.push({ cx: 0, cy: 0.6, cz: 0, hx: 1.35, hy: 0.6, hz: 0.6, tag: 'solid' });
  }

  /** A book on a lectern, and the covers come apart when it is read. */
  _tome(wood, trim) {
    this.group.add(mesh(G.box, mat(0x46443f), 1.0, 0.24, 1.0, 0, 0.12, 0));
    this.group.add(mesh(G.cyl, mat(wood), 0.16, 1.5, 0.16, 0, 0.9, 0));
    const desk = new THREE.Group();
    desk.position.set(0, 1.7, 0);
    desk.rotation.x = -0.42;
    this.group.add(desk);
    desk.add(mesh(G.box, mat(wood), 1.1, 0.1, 0.8, 0, 0, 0));
    desk.add(mesh(G.box, mat(trim), 1.15, 0.06, 0.1, 0, 0.03, 0.38));

    // Two covers on one spine, closed. Opening rotates them apart.
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 0.09, 0);
    desk.add(this.hinge);
    this.leaves = [];
    for (const s of [-1, 1]) {
      const leaf = new THREE.Group();
      this.hinge.add(leaf);
      leaf.add(mesh(G.box, mat(0x6a2a2a), 0.45, 0.05, 0.66, s * 0.235, 0.03, 0));
      leaf.add(mesh(G.box, mat(0xe8dcc0), 0.41, 0.03, 0.60, s * 0.235, 0.06, 0));
      this.leaves.push({ hinge: leaf, side: s });
      // Closed: both halves lie on top of each other.
      leaf.rotation.z = s * 1.55;
    }
    this.solids.push({ cx: 0, cy: 0.9, cz: 0, hx: 0.5, hy: 0.9, hz: 0.5, tag: 'solid' });
  }

  /**
   * A chest, and the important part is the hinge.
   *
   * The lid is a child of a group whose origin sits along the BACK top edge,
   * so rotating that group swings the lid up and back the way a real lid
   * does. Put the lid straight in the chest's own group and it rotates about
   * its middle, which reads as the lid sinking into the box.
   */
  _chest(wood, trim) {
    const dark = 0x3a2716;
    this.group.add(mesh(G.box, mat(wood), 1.5, 0.62, 1.0, 0, 0.31, 0));
    this.group.add(mesh(G.box, mat(dark), 1.54, 0.10, 1.04, 0, 0.06, 0));
    // Two bands and a lock plate, so it reads as a chest at ten units.
    this.group.add(mesh(G.box, mat(trim), 1.56, 0.09, 0.14, 0, 0.34, 0.34));
    this.group.add(mesh(G.box, mat(trim), 1.56, 0.09, 0.14, 0, 0.34, -0.34));
    this.lock = mesh(G.box, mat(trim), 0.26, 0.24, 0.10, 0, 0.60, 0.52);
    this.group.add(this.lock);

    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 0.62, -0.5);
    this.group.add(this.hinge);
    this.hinge.add(mesh(G.box, mat(wood), 1.5, 0.30, 1.0, 0, 0.15, 0.5));
    this.hinge.add(mesh(G.box, mat(trim), 1.54, 0.08, 0.12, 0, 0.31, 0.16));
    // The inside, only visible once it is open — a lid that opens onto the
    // same colour as the outside looks like a solid block splitting in half.
    this.hinge.add(mesh(G.box, mat(0x1a1208), 1.42, 0.02, 0.92, 0, -0.01, 0.5));

    this.solids.push({ cx: 0, cy: 0.45, cz: 0, hx: 0.8, hy: 0.45, hz: 0.55, tag: 'solid' });
  }

  /** A crate. The lid comes off sideways and lands beside it. */
  _crate(wood, trim) {
    this.group.add(mesh(G.box, mat(wood), 1.2, 1.0, 1.2, 0, 0.5, 0));
    this.group.add(mesh(G.box, mat(trim), 1.24, 0.08, 1.24, 0, 0.52, 0));
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 1.0, 0);
    this.group.add(this.hinge);
    this.hinge.add(mesh(G.box, mat(wood), 1.24, 0.12, 1.24, 0, 0.06, 0));
    this.solids.push({ cx: 0, cy: 0.5, cz: 0, hx: 0.65, hy: 0.5, hz: 0.65, tag: 'solid' });
  }

  /** A lever: a stone base, a post, and a handle that throws forward. */
  _lever(wood, trim) {
    this.group.add(mesh(G.box, mat(0x5a564e), 1.0, 0.3, 1.0, 0, 0.15, 0));
    this.group.add(mesh(G.cyl, mat(0x6d6a63), 0.16, 1.1, 0.16, 0, 0.85, 0));
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 1.35, 0);
    this.group.add(this.hinge);
    this.hinge.add(mesh(G.cyl, mat(wood), 0.10, 1.3, 0.10, 0, 0.65, 0));
    this.hinge.add(mesh(G.ico, mat(trim), 0.24, 0.24, 0.24, 0, 1.32, 0));
    this.hinge.rotation.x = 0.85;
    this.solids.push({ cx: 0, cy: 0.6, cz: 0, hx: 0.5, hy: 0.6, hz: 0.5, tag: 'solid' });
  }

  /**
   * A portcullis. It rises, and it takes its collider with it.
   *
   * This is the shape every "you cannot pass yet" in the world should have
   * had from the start: a thing standing in the road, with a reason, that
   * physically moves out of the road when the reason stops applying.
   */
  _gate(trim) {
    const w = this.spec.w || 7;
    const h = this.spec.h || 5.5;
    this.hinge = new THREE.Group();
    this.group.add(this.hinge);
    const bars = Math.max(3, Math.round(w / 1.1));
    for (let i = 0; i < bars; i++) {
      const x = -w / 2 + (i + 0.5) * (w / bars);
      this.hinge.add(mesh(G.box, mat(0x4a4a52), 0.18, h, 0.18, x, h / 2, 0));
    }
    for (let j = 0; j < 3; j++) {
      this.hinge.add(mesh(G.box, mat(0x5a5a62), w, 0.2, 0.24,
        0, h * (0.2 + j * 0.35), 0));
    }
    this.hinge.add(mesh(G.box, mat(trim), w + 0.6, 0.34, 0.5, 0, h + 0.1, 0));
    // Jambs, which never move.
    this.group.add(mesh(G.box, mat(0x53504a), 0.7, h + 1, 0.7, -w / 2 - 0.4, (h + 1) / 2, 0));
    this.group.add(mesh(G.box, mat(0x53504a), 0.7, h + 1, 0.7, w / 2 + 0.4, (h + 1) / 2, 0));
    this.solids.push({ cx: -w / 2 - 0.4, cy: (h + 1) / 2, cz: 0, hx: 0.4, hy: (h + 1) / 2, hz: 0.4, tag: 'solid' });
    this.solids.push({ cx: w / 2 + 0.4, cy: (h + 1) / 2, cz: 0, hx: 0.4, hy: (h + 1) / 2, hz: 0.4, tag: 'solid' });
    // The grid itself: solid, but you can see and reach through it.
    this.solids.push({
      cx: 0, cy: h / 2, cz: 0, hx: w / 2, hy: h / 2, hz: 0.2,
      tag: 'solid', blocker: true, rayTransparent: true,
    });
    this.lift = h + 0.6;
  }

  /** Two leaves on two hinges, swinging outward. */
  _door(wood, trim) {
    const w = this.spec.w || 4.4;
    const h = this.spec.h || 4.4;
    const half = w / 2;
    this.leaves = [];
    for (let s = -1; s <= 1; s += 2) {
      const hinge = new THREE.Group();
      hinge.position.set(s * half, 0, 0);
      this.group.add(hinge);
      hinge.add(mesh(G.box, mat(wood), half, h, 0.28, -s * half / 2, h / 2, 0));
      hinge.add(mesh(G.box, mat(trim), half * 0.9, 0.14, 0.34,
        -s * half / 2, h * 0.72, 0));
      hinge.add(mesh(G.box, mat(trim), half * 0.9, 0.14, 0.34,
        -s * half / 2, h * 0.28, 0));
      hinge.add(mesh(G.ico, mat(trim), 0.16, 0.16, 0.16,
        -s * (half - 0.35), h * 0.5, 0.22));
      this.leaves.push({ hinge, side: s });
    }
    this.solids.push({
      cx: 0, cy: h / 2, cz: 0, hx: half, hy: h / 2, hz: 0.25,
      tag: 'solid', blocker: true,
    });
  }

  /** A pressure plate. It sinks, and it stays sunk. */
  _plate(trim) {
    this.group.add(mesh(G.box, mat(0x46443f), 2.2, 0.16, 2.2, 0, 0.08, 0));
    this.hinge = new THREE.Group();
    this.group.add(this.hinge);
    this.hinge.add(mesh(G.box, mat(0x6d6a63), 1.8, 0.22, 1.8, 0, 0.24, 0));
    this.hinge.add(mesh(G.box, mat(trim), 0.6, 0.06, 0.6, 0, 0.38, 0));
  }

  /** Something standing on a stand. */
  _pedestal(wood, trim) {
    this.group.add(mesh(G.box, mat(0x53504a), 1.3, 0.3, 1.3, 0, 0.15, 0));
    this.group.add(mesh(G.cyl, mat(0x6d6a63), 0.45, 1.1, 0.45, 0, 0.85, 0));
    this.group.add(mesh(G.box, mat(0x5a564e), 1.1, 0.2, 1.1, 0, 1.5, 0));
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 1.6, 0);
    this.group.add(this.hinge);
    this._trophy(this.hinge, wood, trim);
    this.solids.push({ cx: 0, cy: 0.8, cz: 0, hx: 0.6, hy: 0.8, hz: 0.6, tag: 'solid' });
  }

  /** Something lying on the ground, waiting to be picked up. */
  _pickup(trim) {
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 0.2, 0);
    this.group.add(this.hinge);
    this._trophy(this.hinge, this.spec.wood === undefined ? 0x8a8f96 : this.spec.wood, trim);
    this.hinge.rotation.z = 1.5;
  }

  /**
   * The thing itself: a blade, a bundle of kunai, a relic.
   *
   * Three silhouettes rather than one, because "a sword on a stand" and "a
   * handful of throwing blades on the floor" should not be the same object in
   * a different colour — the player is meant to know what they are walking
   * toward before they read the prompt.
   */
  _trophy(parent, body, trim) {
    switch (this.spec.look) {
      case 'kunai':
        for (let i = -1; i <= 1; i++) {
          const k = new THREE.Group();
          k.position.set(i * 0.13, 0, 0);
          k.rotation.z = i * 0.22;
          k.add(mesh(G.cone, mat(0xb8c0c8), 0.09, 0.5, 0.09, 0, 0.32, 0));
          k.add(mesh(G.box, mat(0x2a2a30), 0.05, 0.28, 0.05, 0, 0.02, 0));
          parent.add(k);
        }
        break;
      case 'relic':
        parent.add(mesh(G.oct, mat(trim), 0.3, 0.44, 0.3, 0, 0.4, 0));
        parent.add(mesh(G.cyl, mat(body), 0.22, 0.16, 0.22, 0, 0.08, 0));
        break;
      case 'scroll':
        parent.add(mesh(G.cyl, mat(0xe8dcc0), 0.11, 0.7, 0.11, 0, 0.35, 0));
        parent.add(mesh(G.cyl, mat(trim), 0.13, 0.08, 0.13, 0, 0.68, 0));
        parent.add(mesh(G.cyl, mat(trim), 0.13, 0.08, 0.13, 0, 0.04, 0));
        break;
      default:                                    // a sword
        parent.add(mesh(G.box, mat(0xc8d0d8), 0.09, 1.5, 0.22, 0, 0.9, 0));
        parent.add(mesh(G.box, mat(trim), 0.1, 0.1, 0.6, 0, 0.16, 0));
        parent.add(mesh(G.cyl, mat(body), 0.07, 0.42, 0.07, 0, -0.08, 0));
        break;
    }
  }

  // -------------------------------------------------------------- interaction

  /** What the E prompt should say, or null if there is nothing to do. */
  promptFor(progress) {
    if (this.used) return this.spec.usedLabel || null;
    if (this.state === 'moving') return null;
    if (this.spec.takes && progress && !progress.has(this.spec.takes)) {
      return this.spec.lockedLabel || 'Locked';
    }
    return this.spec.label || 'Open';
  }

  /** Locked things say why rather than doing nothing. */
  blockedBy(progress) {
    if (this.spec.takes && progress && !progress.has(this.spec.takes)) {
      return this.spec.takes;
    }
    return null;
  }

  /**
   * Start moving.
   *
   * Returns false when there is nothing to start, so the caller can tell the
   * difference between "that worked" and "that is already open".
   */
  use() {
    if (this.state !== 'shut') return false;
    this.state = 'moving';
    this.t = 0;
    this.paid = false;
    this._sound();
    return true;
  }

  /**
   * Put it in its used pose with no animation, no sound and no reward.
   *
   * A repeating prop is never restored: a market stall has no used pose, and
   * marking one used would close a shop permanently the first time a player
   * bought from it and then saved.
   */
  restore() {
    if (this.spec.repeat) return;
    this.state = 'used';
    this.t = this.dur;
    this.paid = true;
    this._pose(1);
    this._openBlockers();
    // Whatever was inside is long gone.
    if (this.hinge && (this.kind === 'pedestal' || this.kind === 'pickup')) {
      this.hinge.visible = false;
    }
  }

  _openBlockers() {
    for (const b of this.blockers) b.disabled = true;
  }

  _sound() {
    const p = this.pos;
    switch (this.kind) {
      case 'gate':
        Audio.tone({ freq: 70, to: 130, dur: 2.2, type: 'sawtooth', volume: 0.13, pos: p });
        Audio.noise({ dur: 2.0, volume: 0.12, filter: 700, filterTo: 300, type: 'bandpass', pos: p });
        break;
      case 'door':
        Audio.tone({ freq: 150, to: 60, dur: 1.3, type: 'triangle', volume: 0.12, pos: p });
        break;
      case 'lever':
      case 'plate':
        Audio.tone({ freq: 420, to: 180, dur: 0.28, type: 'square', volume: 0.12, pos: p });
        break;
      case 'stele':
        // A low rising note, like something remembering.
        Audio.tone({ freq: 120, to: 480, dur: 1.1, type: 'sine', volume: 0.13, pos: p });
        break;
      case 'tome':
        Audio.noise({ dur: 0.5, volume: 0.11, filter: 2600, filterTo: 900, type: 'bandpass', pos: p });
        break;
      default:
        Audio.tone({ freq: 260, to: 120, dur: 0.5, type: 'triangle', volume: 0.10, pos: p });
        Audio.noise({ dur: 0.35, volume: 0.10, filter: 1400, filterTo: 500, type: 'bandpass', pos: p });
        break;
    }
  }

  /**
   * One frame.
   *
   * @param onPay called once, on the payoff beat, with this prop. The owner
   *              decides what a prop is worth; this file decides when.
   */
  update(dt, onPay, playerPos) {
    if (this.state === 'moving') {
      this.t += dt;
      const k = clamp(this.t / this.dur, 0, 1);
      this._pose(k);
      if (!this.paid && k >= this.payAt) {
        this.paid = true;
        this._openBlockers();
        if (this.spec.prize) this._spawnPrize();
        if (onPay) onPay(this);
      }
      if (k >= 1) {
        // A stall is open again the moment the rack has slid back. Everything
        // else in the world is a one-shot.
        this.state = this.spec.repeat ? 'shut' : 'used';
        this.t = this.spec.repeat ? 0 : this.dur;
        if (this.spec.repeat) this.paid = false;
      }
    }
    if (this.prize) this._updatePrize(dt, playerPos);
    // Idle life: a thing you are meant to notice glints and turns.
    if (!this.used && (this.kind === 'pedestal' || this.kind === 'pickup')
        && this.hinge && this.hinge.visible) {
      this.hinge.rotation.y += dt * 0.9;
      if (this.kind === 'pickup') {
        this.hinge.position.y = 0.2 + Math.sin(this.t2 = (this.t2 || 0) + dt) * 0.06;
      }
    }
  }

  /** The pose at progress `k`, 0 shut to 1 fully used. */
  _pose(k) {
    const e = k * k * (3 - 2 * k);              // smoothstep
    switch (this.kind) {
      case 'chest':
        // Past vertical, so it stays open on its own.
        this.hinge.rotation.x = lerp(0, -2.1, e);
        break;
      case 'crate':
        this.hinge.rotation.z = lerp(0, -1.7, e);
        this.hinge.position.x = lerp(0, -1.0, e);
        this.hinge.position.y = lerp(1.0, 0.1, e);
        break;
      case 'lever':
        this.hinge.rotation.x = lerp(0.85, -0.85, e);
        break;
      case 'gate':
        this.hinge.position.y = lerp(0, this.lift, e);
        break;
      case 'door':
        for (const l of this.leaves) l.hinge.rotation.y = l.side * lerp(0, 1.85, e);
        break;
      case 'plate':
        this.hinge.position.y = lerp(0, -0.16, e);
        break;
      case 'stele':
        // The cuts fill with light, from nothing to full.
        this.hinge.scale.setScalar(Math.max(0.001, e));
        break;
      case 'tome':
        // Both covers rotate down from shut to flat.
        for (const l of this.leaves) l.hinge.rotation.z = l.side * lerp(1.55, 0, e);
        break;
      case 'stall':
        // The rack slides out to you and back again — one gesture, there and
        // returned, because the stall is still open for business afterwards.
        this.hinge.position.z = Math.sin(e * Math.PI) * 0.5;
        break;
      case 'pedestal':
      case 'pickup':
        // Lifted, turned, and gone: the prize IS the thing on the stand, so
        // it leaves rather than dissolving where it stood.
        this.hinge.position.y = (this.kind === 'pickup' ? 0.2 : 0) + e * 1.4;
        this.hinge.rotation.y += 0.08;
        this.hinge.scale.setScalar(Math.max(0.001, 1 - e));
        if (k >= 1) this.hinge.visible = false;
        break;
      default: break;
    }
  }

  /**
   * The contents, coming out.
   *
   * A physical object that rises out of the chest, hangs for a moment where
   * the player can see what it is, and then goes to them. "Obtained" as an
   * event in the world rather than a line in a box.
   */
  _spawnPrize() {
    const look = this.spec.prizeLook || 'relic';
    const g = new THREE.Group();
    const save = this.spec.look;
    this.spec.look = look;
    this._trophy(g, 0x8a8f96, this.spec.trim === undefined ? 0xffd76b : this.spec.trim);
    this.spec.look = save;
    g.position.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
    g.scale.setScalar(0.9);
    this.scene.add(g);
    this.prize = g;
    this.prizeT = 0;
    Audio.pickup(this.pos);
  }

  _updatePrize(dt, playerPos) {
    this.prizeT += dt;
    const g = this.prize;
    g.rotation.y += dt * 2.4;
    if (this.prizeT < 0.9) {
      // Up out of the box, and hold.
      g.position.y = damp(g.position.y, this.pos.y + 1.9, 5, dt);
      return;
    }
    // Then to the player, shrinking as it goes.
    if (playerPos) {
      _v.set(playerPos.x, playerPos.y + 1.0, playerPos.z);
      g.position.lerp(_v, Math.min(1, dt * 6));
    }
    const left = 1 - clamp((this.prizeT - 0.9) / 0.6, 0, 1);
    g.scale.setScalar(Math.max(0.001, 0.9 * left));
    if (left > 0.001) return;
    this.scene.remove(g);
    g.traverse((o) => { if (o.isMesh) o.geometry = o.geometry; });
    this.prize = null;
  }

  dispose() {
    if (this.prize) { this.scene.remove(this.prize); this.prize = null; }
    this.scene.remove(this.group);
  }
}

/**
 * Every prop in the world, and which ones are worth drawing.
 *
 * Built once at load — the colliders have to be in place before the
 * broadphase is baked — and then hidden by distance. A prop is three or four
 * meshes, so a hundred of them on screen would cost more than every villager
 * in a town; the cull radius is deliberately tight.
 */
/**
 * How far a prop is drawn.
 *
 * A hundred and fifty units. A chest is a metre and a half across and a lever
 * is thinner than that; past a hundred and fifty they are two pixels, and
 * there are about three hundred of them in the world.
 *
 * A gate is the exception in spirit — it is five metres tall and part of the
 * silhouette of the place it stands in — but a gate is always inside a site
 * whose own geometry is drawn much further out, so it is never the thing you
 * are looking at from two hundred units.
 */
const SHOW2 = 150 * 150;

export class Props {
  constructor(scene, collision) {
    this.scene = scene;
    this.collision = collision;
    this.list = [];
    this.byId = new Map();
    /** Set by the owner: what to do when a prop pays out. */
    this.onPay = null;
  }

  /**
   * Add one.
   *
   * Its colliders go straight into the collision world, in world space, and
   * the ones marked `blocker` are remembered so opening the thing can switch
   * them off.
   */
  add(spec) {
    const p = new Prop(spec, this.scene);
    const c = Math.cos(p.group.rotation.y), s = Math.sin(p.group.rotation.y);
    for (const b of p.solids) {
      if (!this.collision) break;
      // Rotate the local offset into the world. The half-extents are left
      // axis-aligned: a chest is near enough square, and a box that grew to
      // cover its own rotation would be a wall you bump into beside the door.
      const wx = spec.at.x + b.cx * c + b.cz * s;
      const wz = spec.at.z - b.cx * s + b.cz * c;
      const hx = Math.abs(b.hx * c) + Math.abs(b.hz * s);
      const hz = Math.abs(b.hx * s) + Math.abs(b.hz * c);
      const box = this.collision.addBox(wx, spec.at.y + b.cy, wz,
        hx, b.hy, hz, b.tag);
      if (b.rayTransparent) box.rayTransparent = true;
      if (b.blocker) p.blockers.push(box);
    }
    this.list.push(p);
    this.byId.set(p.id, p);
    return p;
  }

  get(id) { return this.byId.get(id) || null; }

  /** Put every already-used prop into its used pose. Call once, after load. */
  restore(progress) {
    for (const p of this.list) {
      if (progress.found.has(p.id)) p.restore();
    }
  }

  update(dt, px, pz, playerPos) {
    for (const p of this.list) {
      const d2 = (p.pos.x - px) ** 2 + (p.pos.z - pz) ** 2;
      const near = d2 < SHOW2;
      if (p.group.visible !== near) p.group.visible = near;
      // Off-screen props are frozen — but one that is mid-swing keeps moving,
      // because a gate opening two hundred units away is still opening.
      if (near || p.moving || p.prize) p.update(dt, this.onPay, playerPos);
    }
  }

  /** The nearest prop the player could act on, or null. */
  at(x, z) {
    let best = null, bestD = Infinity;
    for (const p of this.list) {
      const d2 = (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2;
      if (d2 > p.reach * p.reach || d2 >= bestD) continue;
      bestD = d2;
      best = p;
    }
    return best;
  }

  dispose() {
    for (const p of this.list) p.dispose();
    this.list.length = 0;
    this.byId.clear();
  }
}
