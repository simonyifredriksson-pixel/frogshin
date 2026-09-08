/**
 * THE WAKEWOOD — where an emperor wakes up with nothing.
 *
 * This is the first place anybody walks around in. The prologue is a
 * cinematic; this is the game, and it has about thirty seconds to convince
 * somebody that the rest of it is worth their time. So it is not a clearing
 * with some trees in it. It is a cathedral.
 *
 * ── what is actually here ────────────────────────────────────────────────
 *   nine COLOSSAL trees, twenty units through the trunk and a hundred and
 *   thirty tall, standing in a ring with their buttress roots arching over
 *   the ground you walk on; a canopy so dense the light comes through it in
 *   separate shafts; a floor of moss, fern, flower, mushroom and fallen leaf
 *   with about sixteen hundred things growing on it; a stream you can wade,
 *   with stepping stones and a fall over a root; four ruined arches the
 *   forest has half swallowed; hanging curtains of moss; spore-light drifting
 *   upward; fireflies; butterflies; and eighteen small creatures that live
 *   here and will hop out of your way.
 *
 * ── and the pedestal ─────────────────────────────────────────────────────
 * In the middle, on a mossy dais, a stone with the same mark that is on the
 * player's clothes. Touching it is the first flashback in the game and the
 * first line of the story: a crowd kneeling, and somebody shouting ALL HAIL
 * THE EMPEROR.
 *
 * ── how it stays cheap ──────────────────────────────────────────────────
 * Everything static is instanced by material and then handed to `flatten`
 * with the rest of the site layer, so the whole wood is about a dozen draw
 * calls. The only per-frame work is the creatures and the motes: five
 * instanced meshes whose matrices are rewritten each frame, which is around
 * two hundred and forty matrix writes and no allocation at all.
 */

import * as THREE from '../lib/three.module.js?v=v90';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep,
  dampAngle, lookYaw } from './util.js?v=v90';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _cd = new THREE.Color();

/** How far the wood reaches. Beyond this it thins back into the Lily Reach. */
export const WOOD_R = 118;
/** The clearing in the middle: no trees, nothing tall, nothing in the way. */
export const GLADE_R = 26;

/**
 * WHERE IT IS.
 *
 * A fold of the Lily Reach north-east of Croakhollow — close enough that the
 * villager who finds you can walk you home, far enough that waking up here
 * is waking up somewhere strange.
 */
export const WOOD_AT = { x: 640, z: 2010 };

/** One instanced batch of one geometry and one material. */
class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    this.items.push([x, y, z, sx, sy, sz, color, ry, rx, rz]);
  }
  build(parent, cast) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    mesh.castShadow = !!cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      _e.set(it[8], it[7], it[9]);
      _q.setFromEuler(_e);
      _v.set(it[0], it[1], it[2]);
      _s.set(it[3], it[4], it[5]);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setHex(it[6]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
    return mesh;
  }
}

/** A soft round blob, for motes and fireflies. */
function glowTexture(inner, mid) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(16, 16, 0.5, 16, 16, 15.5);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.4, mid);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(c);
}

/** A vertical fade, for light shafts and moss curtains. */
function fadeTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, top);
    grad.addColorStop(0.6, bottom);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 64);
  }
  return new THREE.CanvasTexture(c);
}

// ═══════════════════════════════════════════════════════════ the creatures ══

/**
 * THE THINGS THAT LIVE HERE.
 *
 * Eighteen small forest creatures — the ones in the reference art peering out
 * of the undergrowth. They are the single biggest reason the wood reads as
 * ALIVE rather than as a set: a static forest with perfect lighting is a
 * photograph, and one with something moving at the edge of it is a place.
 *
 * Each one is five instanced parts, so all eighteen cost five draw calls and
 * are individually animated. Their behaviour is deliberately simple and
 * deliberately readable:
 *
 *   idle    they sit, and their ears twitch, and they breathe
 *   hop     three or four little arcs to somewhere else nearby
 *   watch   if the player is close they stop and TURN TO LOOK
 *   flee    if the player gets very close they bolt a short way off
 *
 * "Turn to look" is the one that matters. A creature that ignores you is
 * scenery; a creature that notices you is a creature.
 */
class Critters {
  constructor(parent, realm, at, rnd, count = 18) {
    this.realm = realm;
    this.at = at;
    this.list = [];
    this.t = 0;

    const geo = {
      body: new THREE.SphereGeometry(1, 7, 5),
      head: new THREE.SphereGeometry(1, 7, 5),
      ear: new THREE.ConeGeometry(1, 1, 5),
      eye: new THREE.SphereGeometry(1, 5, 4),
      tail: new THREE.SphereGeometry(1, 5, 4),
    };
    const mat = {
      body: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      head: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      ear: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      eye: new THREE.MeshBasicMaterial({ color: 0x14140f }),
      tail: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    };
    this.geo = geo;
    this.mat = mat;
    this.mesh = {};
    // Two ears and two eyes each, so those two get double the instances.
    const per = { body: 1, head: 1, ear: 2, eye: 2, tail: 1 };
    for (const k in geo) {
      const m = new THREE.InstancedMesh(geo[k], mat[k], count * per[k]);
      m.frustumCulled = false;
      m.castShadow = k === 'body';
      m.receiveShadow = false;
      parent.add(m);
      this.mesh[k] = m;
    }

    /**
     * FIVE KINDS, and they are not evenly mixed.
     *
     * Mostly the small brown ones, a few pale ones, and exactly two of the
     * big slow mossy sort — the ones with a bush growing on their back that
     * the reference art puts at the edge of the path. Rarity is what makes
     * spotting one feel like spotting something.
     */
    const KINDS = [
      { w: 34, skin: 0x8a6a42, ear: 0xa8845a, size: 0.5, hop: 2.2, shy: 7 },
      { w: 24, skin: 0xb99a5a, ear: 0xd8c49a, size: 0.44, hop: 2.6, shy: 9 },
      { w: 18, skin: 0x6b8a4a, ear: 0x8fc44a, size: 0.56, hop: 1.8, shy: 6 },
      { w: 14, skin: 0xd8d4c6, ear: 0xf2ecdc, size: 0.4, hop: 3.0, shy: 11 },
      // The big mossy one. Slow, unbothered, and twice everybody else's size.
      { w: 6, skin: 0x4f6f3a, ear: 0x2f5f27, size: 1.0, hop: 0.9, shy: 4 },
    ];
    const total = KINDS.reduce((a, k) => a + k.w, 0);
    for (let i = 0; i < count; i++) {
      let roll = rnd() * total, kind = KINDS[0];
      for (const k of KINDS) { roll -= k.w; if (roll <= 0) { kind = k; break; } }
      /**
       * Scattered round the glade rather than in it: they keep to the edges
       * of the clearing, which is where you notice them out of the corner
       * of your eye.
       *
       * But never past the halfway mark. Nothing lives in the blighted half
       * of the wood, and the fact that the creatures stop exactly where the
       * green stops is the clearest statement the place makes about what is
       * happening to it.
       */
      const a = rnd() * Math.PI * 2;
      const r = GLADE_R * 0.7 + rnd() * (WOOD_R * 0.55 - GLADE_R * 0.7);
      const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
      this.list.push({
        kind,
        x, z, y: realm.heightAt(x, z),
        home: { x, z },
        yaw: rnd() * Math.PI * 2,
        state: 'idle',
        wait: rnd() * 4,
        hopT: 0, hops: 0,
        fromX: x, fromZ: z, toX: x, toZ: z,
        breathe: rnd() * 6,
        earTwitch: 0,
        scale: kind.size * (0.86 + rnd() * 0.3),
      });
    }
  }

  /** Pick somewhere nearby to hop to, and how many hops it takes. */
  _wander(c, rnd) {
    const a = rnd() * Math.PI * 2;
    const r = 2 + rnd() * 7;
    let tx = c.x + Math.cos(a) * r, tz = c.z + Math.sin(a) * r;
    // Kept on a lead round where they live, so the wood does not slowly
    // empty itself into the Lily Reach.
    const dx = tx - c.home.x, dz = tz - c.home.z;
    const d = Math.hypot(dx, dz);
    if (d > 16) { tx = c.home.x + (dx / d) * 16; tz = c.home.z + (dz / d) * 16; }
    c.fromX = c.x; c.fromZ = c.z;
    c.toX = tx; c.toZ = tz;
    c.yaw = lookYaw(c.x, c.z, tx, tz);
    c.state = 'hop';
    c.hopT = 0;
    c.hops = 2 + Math.floor(rnd() * 3);
  }

  update(dt, playerPos) {
    this.t += dt;
    const rnd = Math.random;
    const idx = { body: 0, head: 0, ear: 0, eye: 0, tail: 0 };
    for (const c of this.list) {
      const K = c.kind;
      const pd = playerPos
        ? Math.hypot(playerPos.x - c.x, playerPos.z - c.z) : 999;

      // ---- behaviour ----
      if (pd < K.shy * 0.45 && c.state !== 'flee') {
        // Too close. Bolt, away from the player.
        const a = Math.atan2(c.z - playerPos.z, c.x - playerPos.x);
        c.fromX = c.x; c.fromZ = c.z;
        c.toX = c.x + Math.cos(a) * (5 + rnd() * 5);
        c.toZ = c.z + Math.sin(a) * (5 + rnd() * 5);
        c.yaw = lookYaw(c.x, c.z, c.toX, c.toZ);
        c.state = 'flee';
        c.hopT = 0;
        c.hops = 3;
      } else if (c.state === 'idle') {
        c.wait -= dt;
        if (pd < K.shy) {
          // Watching. It has seen you, and it turns to face you — which is
          // the whole difference between scenery and a creature.
          c.yaw = dampAngle(c.yaw,
            lookYaw(c.x, c.z, playerPos.x, playerPos.z), 3.5, dt);
          c.wait = Math.max(c.wait, 0.6);
        } else if (c.wait <= 0) {
          this._wander(c, rnd);
        }
      }
      if (c.state === 'hop' || c.state === 'flee') {
        const speed = c.state === 'flee' ? K.hop * 2.0 : K.hop;
        c.hopT += dt * speed;
        if (c.hopT >= 1) {
          c.x = c.toX; c.z = c.toZ;
          c.hops--;
          if (c.hops <= 0) {
            c.state = 'idle';
            c.wait = 1.5 + rnd() * 5;
          } else {
            // Chain another hop in the same direction.
            const a = c.yaw;
            c.fromX = c.x; c.fromZ = c.z;
            c.toX = c.x - Math.sin(a) * (2 + rnd() * 3);
            c.toZ = c.z - Math.cos(a) * (2 + rnd() * 3);
            c.hopT = 0;
          }
        } else {
          c.x = lerp(c.fromX, c.toX, c.hopT);
          c.z = lerp(c.fromZ, c.toZ, c.hopT);
        }
      }
      c.y = this.realm.heightAt(c.x, c.z);
      // The arc of the hop itself.
      const air = (c.state === 'hop' || c.state === 'flee')
        ? Math.sin(clamp(c.hopT, 0, 1) * Math.PI) * 0.55 * c.scale * 2.2 : 0;
      // Breathing while sitting still, and an occasional ear flick.
      c.breathe += dt * (c.state === 'idle' ? 1.6 : 4.0);
      const breath = Math.sin(c.breathe) * 0.035;
      if (c.state === 'idle' && rnd() < dt * 0.5) c.earTwitch = 0.35;
      if (c.earTwitch > 0) c.earTwitch -= dt;
      const flick = c.earTwitch > 0 ? Math.sin(c.earTwitch * 40) * 0.4 : 0;

      // ---- draw ----
      const S = c.scale;
      const y = c.y + air;
      const face = c.yaw;
      const fx = -Math.sin(face), fz = -Math.cos(face);
      const rx = Math.cos(face), rz = -Math.sin(face);

      const put = (mesh, i, px, py, pz, sx, sy, sz, ry, rrx, rrz) => {
        _e.set(rrx || 0, ry || 0, rrz || 0);
        _q.setFromEuler(_e);
        _v.set(px, py, pz);
        _s.set(sx, sy, sz);
        _m.compose(_v, _q, _s);
        mesh.setMatrixAt(i, _m);
      };
      // Body, squashing very slightly as it breathes.
      put(this.mesh.body, idx.body++, c.x, y + 0.42 * S, c.z,
        0.46 * S, (0.4 + breath) * S, 0.52 * S, face);
      // Head, forward and a little up.
      const hx = c.x + fx * 0.42 * S, hz = c.z + fz * 0.42 * S;
      const hy = y + 0.62 * S;
      put(this.mesh.head, idx.head++, hx, hy, hz,
        0.3 * S, 0.28 * S, 0.3 * S, face);
      // Ears, up and back, twitching.
      for (const sd of [-1, 1]) {
        put(this.mesh.ear, idx.ear++,
          hx + rx * sd * 0.16 * S - fx * 0.04 * S,
          hy + 0.3 * S,
          hz + rz * sd * 0.16 * S - fz * 0.04 * S,
          0.1 * S, 0.34 * S, 0.1 * S,
          face, sd * (0.12 + flick), -sd * 0.2);
      }
      // Eyes, big and forward. Basic material, so they hold their black.
      for (const sd of [-1, 1]) {
        put(this.mesh.eye, idx.eye++,
          hx + rx * sd * 0.15 * S + fx * 0.2 * S,
          hy + 0.05 * S,
          hz + rz * sd * 0.15 * S + fz * 0.2 * S,
          0.075 * S, 0.085 * S, 0.06 * S, face);
      }
      // And a tail, or a bush, depending on what it is.
      put(this.mesh.tail, idx.tail++,
        c.x - fx * 0.44 * S, y + 0.46 * S, c.z - fz * 0.44 * S,
        0.2 * S, 0.2 * S, 0.2 * S, face);
    }
    for (const k in this.mesh) this.mesh[k].instanceMatrix.needsUpdate = true;
  }

  /** Colour every instance once, after construction. */
  paint() {
    const idx = { body: 0, head: 0, ear: 0, eye: 0, tail: 0 };
    for (const c of this.list) {
      this.mesh.body.setColorAt(idx.body++, _c.setHex(c.kind.skin));
      this.mesh.head.setColorAt(idx.head++, _c.setHex(c.kind.skin));
      for (let i = 0; i < 2; i++) {
        this.mesh.ear.setColorAt(idx.ear++, _c.setHex(c.kind.ear));
        this.mesh.eye.setColorAt(idx.eye++, _c.setHex(0x14140f));
      }
      this.mesh.tail.setColorAt(idx.tail++, _c.setHex(c.kind.ear));
    }
    for (const k in this.mesh) {
      if (this.mesh[k].instanceColor) this.mesh[k].instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const k in this.geo) this.geo[k].dispose();
    for (const k in this.mat) this.mat[k].dispose();
  }
}

// ══════════════════════════════════════════════════════════════ the wood ══

export class Wakewood {
  /**
   * @param scene the realm's scene
   * @param realm for `heightAt` and the collision world
   */
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.rnd = mulberry32(0x5eed1);
    this.noise = new ValueNoise(991);
    this.time = 0;
    this.root = new THREE.Group();
    this.root.name = 'wakewood';
    this.root.visible = false;
    scene.add(this.root);
    this.owned = [];
    /** Where the player wakes up, and where the villager comes from. */
    this.at = null;
    this.wakeAt = null;
    /** Live things. */
    this.critters = null;
    this.motes = null;
    this.flies = null;
    this.wings = null;
    this.curtains = [];
    /** The pedestal, for the overworld to hang a prop on. */
    this.pedestal = null;
  }

  _lam(color) {
    const m = new THREE.MeshLambertMaterial({ color });
    this.owned.push(m);
    return m;
  }

  _solid(x, y, z, hx, hy, hz, tag) {
    this.realm.collision.addBox(x, y, z, hx, hy, hz, tag);
  }

  /** The ground, in world space. */
  _gy(x, z) { return this.realm.heightAt(x, z); }

  /**
   * HOW DEAD IT IS HERE. 0 in the heart of the wood, 1 at the treeline.
   *
   * ── why the wood has two halves ─────────────────────────────────────────
   * The middle sixty per cent is the wood in the reference paintings: green,
   * gold, loud with things growing, sun coming down through it in shafts.
   * The outer forty is the OTHER reference: bare branches, grey bark, no
   * undergrowth, cold blue fog, and one mossy arch standing in it.
   *
   * That is not decoration. It is the first thing the game tells the player
   * about the state of the country, and it tells them without a word: this
   * place is alive at the centre and dying at the edges, and whatever is
   * doing it is coming inward. The player walks out through it to reach the
   * village, so they see the wood get worse as they leave — and the glade
   * they woke up in becomes the one green thing they have seen.
   *
   * Ragged rather than a ring: a noise field pushes the boundary in and out
   * by twenty units, so the dead part comes into the wood in fingers.
   */
  wither(x, z) {
    const dx = x - this.at.x, dz = z - this.at.z;
    const r = Math.hypot(dx, dz) / WOOD_R;
    /**
     * `edge` is where the dying begins, and it is deliberately inside the
     * halfway mark: the brief is that the middle sixty per cent is alive, so
     * the transition has to have STARTED by then or the outer third of the
     * wood reads as merely a bit dim rather than as dead.
     *
     * `fbm` is centred on zero and runs about ±1, so this puts the boundary
     * between 0.42 and 0.70 of the way out depending on which direction you
     * walk — which is what makes the blight come in as fingers.
     */
    const edge = 0.56 + this.noise.fbm(x * 0.018, z * 0.018, 2) * 0.14;
    return smoothstep(clamp((r - edge) / (1.02 - edge), 0, 1));
  }

  /**
   * A colour, faded toward the blight.
   *
   * Everything the wood is made of goes through here: leaves, moss, bark,
   * grass, water. Withering is not just "darker" — it is desaturated AND
   * cooled, because dead wood in fog goes grey-blue rather than brown, which
   * is exactly what the reference image does.
   */
  _fade(hex, w, dead = 0x6b7078) {
    if (w <= 0.001) return hex;
    _c.setHex(hex).lerp(_cd.setHex(dead), w * 0.88);
    return _c.getHex();
  }

  buildTasks() {
    return [
      ['Finding the wood', () => {
        const spot = this.realm.placeSpot(WOOD_AT.x, WOOD_AT.z, 40, null, 0.5)
          || { x: WOOD_AT.x, y: this._gy(WOOD_AT.x, WOOD_AT.z), z: WOOD_AT.z };
        this.at = { x: spot.x, y: spot.y, z: spot.z };
        // Waking spot: just off centre, so the pedestal is something the
        // player TURNS AND SEES rather than something they start on top of.
        this.wakeAt = {
          x: this.at.x - 13, z: this.at.z + 9,
          y: this._gy(this.at.x - 13, this.at.z + 9),
        };
        const white = 0xffffff;
        this.mats = {
          bark: this._lam(white), leaf: this._lam(white),
          moss: this._lam(white), stone: this._lam(white),
          fung: this._lam(white),
        };
        this.b = {
          trunk: new Batch(new THREE.CylinderGeometry(0.72, 1, 1, 9), this.mats.bark),
          limb: new Batch(new THREE.CylinderGeometry(0.5, 1, 1, 6), this.mats.bark),
          blob: new Batch(new THREE.SphereGeometry(1, 7, 5), this.mats.leaf),
          low: new THREE.Object3D() && new Batch(new THREE.SphereGeometry(1, 5, 4), this.mats.moss),
          cone: new Batch(new THREE.ConeGeometry(1, 1, 5), this.mats.leaf),
          blade: new Batch(new THREE.BoxGeometry(1, 1, 1), this.mats.moss),
          rock: new Batch(new THREE.IcosahedronGeometry(1, 0), this.mats.stone),
          slab: new Batch(new THREE.BoxGeometry(1, 1, 1), this.mats.stone),
          cap: new Batch(new THREE.SphereGeometry(1, 7, 4), this.mats.fung),
          stalk: new Batch(new THREE.CylinderGeometry(1, 1, 1, 5), this.mats.fung),
          disc: new Batch(new THREE.CylinderGeometry(1, 1, 1, 12), this.mats.stone),
        };
      }],
      ['Raising the great trees', () => this._trees()],
      ['Laying the roots', () => this._roots()],
      ['Growing the floor', () => this._floor()],
      ['Dropping the deadwood', () => this._deadwood()],
      ['Cutting the stream', () => this._stream()],
      ['Losing the arches', () => this._arches()],
      ['Setting the emperor stone', () => this._pedestalStone()],
      ['Letting the light in', () => this._light()],
      ['Waking the wood', () => {
        this._alive();
        for (const k in this.b) {
          this.b[k].mesh = this.b[k].build(this.root,
            k === 'trunk' || k === 'limb' || k === 'slab' || k === 'rock');
        }
      }],
    ];
  }

  build() { for (const [, fn] of this.buildTasks()) fn(); return this; }

  // ------------------------------------------------------------- the trees

  /**
   * NINE COLOSSAL TREES.
   *
   * Twenty units through the base, a hundred and thirty tall, standing in a
   * ring round the glade with their canopies meeting overhead. The scale is
   * the whole point and it is not subtle: the player is meant to look up.
   *
   * Each one is built the same way and none of them looks the same, because
   * everything is jittered off the seed: the lean, the number of limbs, where
   * the limbs come off, how the canopy clumps, and how much of the trunk is
   * bare before the first branch.
   */
  _trees() {
    const R = this.rnd;
    const B = this.b;
    this.trees = [];
    const N = 9;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + R() * 0.22;
      const rad = GLADE_R + 12 + R() * 34;
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const y = this._gy(x, z);
      const h = 96 + R() * 40;
      const base = 8.5 + R() * 4.5;
      const lean = (R() - 0.5) * 0.06;
      /**
       * How far gone this one is.
       *
       * The giants stand at the boundary, so some of them are half in the
       * blight — which is the best thing about doing it this way. A tree
       * whose trunk is grey at the foot and green at the crown says more
       * than either a live tree or a dead one.
       */
      const w = this.wither(x, z);
      const bark = this._fade(0x574029, w, 0x5f6068);
      // The trunk, in five tapering sections so it narrows convincingly and
      // can bend as it goes up.
      let px = x, pz = z, py = y - 2;
      for (let s = 0; s < 5; s++) {
        const t0 = s / 5, t1 = (s + 1) / 5;
        const r0 = lerp(base, base * 0.3, t0);
        const seg = h / 5;
        const nx = px + Math.cos(a) * lean * seg * (s > 1 ? 1 : 0.2);
        const nz = pz + Math.sin(a) * lean * seg * (s > 1 ? 1 : 0.2);
        B.trunk.add((px + nx) * 0.5, py + seg * 0.5, (pz + nz) * 0.5,
          r0, seg * 1.02, r0, bark, a, 0, 0);
        px = nx; pz = nz; py += seg;
        void t1;
      }
      // A wide flare at the foot, which is what makes it look ROOTED.
      B.trunk.add(x, y + 1, z, base * 1.5, 6, base * 1.5,
        this._fade(0x4a3524, w, 0x53545c));
      // And a skirt of moss round it — but only where anything still grows.
      if (w < 0.72) {
        B.low.add(x, y + 0.4, z, base * 1.75, 1.6, base * 1.75,
          this._fade(0x3f5c2e, w * 1.3));
      }
      // Solid, and generously so: the trunks are the wood's walls.
      this._solid(x, y + h * 0.4, z, base * 0.9, h * 0.4, base * 0.9, 'trunk');

      // ---- limbs, going out and up from two thirds of the way up ----
      const limbs = 4 + Math.floor(R() * 3);
      for (let l = 0; l < limbs; l++) {
        const la = R() * Math.PI * 2;
        const lh = y + h * (0.55 + R() * 0.4);
        const len = 22 + R() * 26;
        const lx = px + Math.cos(la) * len * 0.5;
        const lz = pz + Math.sin(la) * len * 0.5;
        const limb = B.limb;
        limb.add(lx, lh + len * 0.14, lz, 2.2, len, 2.2, bark,
          la + Math.PI / 2, 0, 1.28);
        const ex = px + Math.cos(la) * len;
        const ez = pz + Math.sin(la) * len;
        /**
         * AND THIS IS WHERE THE TWO HALVES OF THE WOOD DIVERGE.
         *
         * A living limb ends in five overlapping clumps of leaf. A dead one
         * ends in bare twigs, and nothing else — which is the whole
         * silhouette of the fourth reference image. Nothing about the branch
         * itself changes; the difference is entirely whether there is
         * anything on the end of it.
         */
        if (w < 0.66) {
          for (let k = 0; k < 5; k++) {
            const cs = (13 + R() * 13) * (1 - w * 0.55);
            B.blob.add(ex + (R() - 0.5) * 18, lh + len * 0.3 + (R() - 0.5) * 12,
              ez + (R() - 0.5) * 18, cs, cs * 0.62, cs,
              this._fade(R() < 0.35 ? 0x2f5f27
                : (R() < 0.5 ? 0x3f7a30 : 0x4f8f38), w * 1.5, 0x7a7458));
          }
        } else {
          // Bare twigs: five thin forks off the end of the branch.
          for (let k = 0; k < 5; k++) {
            const ta = la + (R() - 0.5) * 1.6;
            const tl = 5 + R() * 9;
            B.limb.add(ex + Math.cos(ta) * tl * 0.5,
              lh + len * 0.3 + (R() - 0.3) * 5,
              ez + Math.sin(ta) * tl * 0.5, 0.5, tl, 0.5,
              this._fade(0x574029, 1, 0x64656d),
              ta + Math.PI / 2, 0, 1.2 + (R() - 0.5) * 0.5);
          }
        }
      }
      // A crown clump on top, so the silhouette closes — on a live tree.
      if (w < 0.66) {
        for (let k = 0; k < 4; k++) {
          const cs = (16 + R() * 12) * (1 - w * 0.5);
          B.blob.add(px + (R() - 0.5) * 14, py + 6 + (R() - 0.5) * 10,
            pz + (R() - 0.5) * 14, cs, cs * 0.55, cs,
            this._fade(0x2a5423, w * 1.5, 0x7a7458));
        }
      }
      this.trees.push({ x, z, y, h, base, top: py });
    }

    /**
     * AND A RING OF ORDINARY TREES BEHIND THEM.
     *
     * Thirty of them, much smaller, filling the gaps between the giants so
     * the wood has depth and you cannot see straight out of it. Cheap: one
     * trunk and three clumps each.
     */
    for (let i = 0; i < 34; i++) {
      const a = R() * Math.PI * 2;
      const rad = GLADE_R + 20 + R() * (WOOD_R - GLADE_R - 24);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const y = this._gy(x, z);
      const h = 22 + R() * 30;
      const tw = 1.4 + R() * 1.6;
      const wi = this.wither(x, z);
      B.trunk.add(x, y + h * 0.5, z, tw, h, tw,
        this._fade(0x4f3a26, wi, 0x64656d), R() * 3);
      if (wi < 0.6) {
        for (let k = 0; k < 3; k++) {
          const cs = (6 + R() * 7) * (1 - wi * 0.5);
          B.blob.add(x + (R() - 0.5) * 7, y + h * (0.8 + R() * 0.3),
            z + (R() - 0.5) * 7, cs, cs * 0.7, cs,
            this._fade(R() < 0.4 ? 0x2f5f27 : 0x467f34, wi * 1.6, 0x7a7458));
        }
      } else {
        // A dead one: a scatter of bare branches and nothing on them. These
        // are what the treeline is made of, and what you walk out through.
        for (let k = 0; k < 5; k++) {
          const ba = R() * Math.PI * 2;
          const bl = 3 + R() * 7;
          B.limb.add(x + Math.cos(ba) * bl * 0.4,
            y + h * (0.55 + R() * 0.45), z + Math.sin(ba) * bl * 0.4,
            0.34, bl, 0.34, this._fade(0x4f3a26, 1, 0x6b6c74),
            ba + Math.PI / 2, 0, 1.0 + R() * 0.5);
        }
      }
      this._solid(x, y + h * 0.4, z, tw * 0.9, h * 0.4, tw * 0.9, 'tree');
    }
  }

  /**
   * THE ROOTS.
   *
   * Great buttresses arching out of each giant and back into the ground, and
   * this is where the reference art earns itself: the floor of a wood like
   * this is not flat, it is a mess of things you step over and duck under.
   * The low ones get `deck` colliders, so they are things you can climb.
   */
  _roots() {
    const R = this.rnd;
    const B = this.b;
    for (const t of this.trees) {
      const n = 5 + Math.floor(R() * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + R() * 0.4;
        const len = t.base * (1.6 + R() * 2.2);
        const thick = 1.3 + R() * 2.4;
        // Three segments arcing down and away.
        for (let s = 0; s < 3; s++) {
          const f0 = s / 3, f1 = (s + 1) / 3;
          const r0 = t.base * 0.7 + len * f0;
          const r1 = t.base * 0.7 + len * f1;
          const x0 = t.x + Math.cos(a) * r0, z0 = t.z + Math.sin(a) * r0;
          const x1 = t.x + Math.cos(a) * r1, z1 = t.z + Math.sin(a) * r1;
          // The arch: high at the trunk, into the ground at the far end.
          const h0 = lerp(4.2, 0.2, smoothstep(f0));
          const h1 = lerp(4.2, 0.2, smoothstep(f1));
          const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
          const my = (this._gy(x0, z0) + h0 + this._gy(x1, z1) + h1) * 0.5;
          const segLen = Math.hypot(x1 - x0, z1 - z0);
          const th = thick * (1 - f0 * 0.45);
          const wi = this.wither(mx, mz);
          const m = B.limb.add(mx, my, mz, th, segLen * 1.15, th,
            this._fade(0x4a3524, wi, 0x5f6068),
            Math.atan2(z1 - z0, x1 - x0) + Math.PI / 2, 0,
            Math.PI / 2 - Math.atan2(h1 - h0, segLen));
          void m;
          // Moss on the top of every root, which is most of the colour on
          // the floor of the wood — and it stops where the blight starts.
          if (wi < 0.75) {
            B.low.add(mx, my + th * 0.5, mz, th * 0.95, th * 0.4, segLen * 0.5,
              this._fade(0x3f7a30, wi * 1.3),
              Math.atan2(z1 - z0, x1 - x0) + Math.PI / 2);
          }
          if (s === 0) {
            // Only the innermost segment is solid — the outer ones are low
            // enough to walk over, and a collider on those would be a fence.
            this._solid(mx, my, mz, th, th, segLen * 0.5, 'root');
          } else if (s === 1) {
            this._solid(mx, my - th * 0.3, mz, th, th * 0.5, segLen * 0.5, 'deck');
          }
        }
      }
    }
  }

  /**
   * THE FLOOR.
   *
   * Sixteen hundred growing things, in five kinds, distributed by a noise
   * field so the wood has THICKETS and CLEARINGS rather than an even spray.
   * That distribution is the difference between a forest floor and a lawn
   * with props on it.
   */
  _floor() {
    const R = this.rnd;
    const B = this.b;
    const N = 2100;
    for (let i = 0; i < N; i++) {
      const a = R() * Math.PI * 2;
      const rad = Math.sqrt(R()) * WOOD_R;
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const y = this._gy(x, z);
      // Thickets: the noise decides how likely anything is to grow here.
      const dens = this.noise.fbm(x * 0.05, z * 0.05, 2);
      // The glade is kept clear, and the very middle is kept bare.
      const inGlade = rad < GLADE_R;
      if (inGlade && R() > 0.3) continue;
      if (rad < 6) continue;
      if (!inGlade && R() > 0.35 + dens * 0.8) continue;

      /**
       * AND THE UNDERGROWTH SIMPLY STOPS.
       *
       * `wither` thins the floor out as well as fading it: at the treeline
       * three quarters of what would have grown is not there, and what is
       * left is dead grass, bare twigs and stones. This is doing most of the
       * work — the difference between the two halves of the wood is felt as
       * how much stuff is around your feet long before it is noticed as a
       * colour change.
       */
      const w = this.wither(x, z);
      if (w > 0.15 && R() < w * 0.8) continue;

      const roll = R();
      if (roll < 0.42) {
        // Grass and moss tufts: three thin blades, splayed. In the blight
        // they are shorter, browner, and lean over.
        const c = this._fade(
          R() < 0.3 ? 0x8fc44a : (R() < 0.6 ? 0x4f8f38 : 0x3f7a30),
          w, 0x8a7f62);
        for (let k = 0; k < 3; k++) {
          const h = (0.5 + R() * 1.1) * (1 - w * 0.45);
          B.blade.add(x + (R() - 0.5) * 0.5, y + h * 0.5, z + (R() - 0.5) * 0.5,
            0.09, h, 0.09, c, R() * 3,
            (R() - 0.5) * (0.4 + w * 0.8), (R() - 0.5) * (0.4 + w * 0.8));
        }
      } else if (roll < 0.66) {
        // Ferns: a low rosette of cones leaning outward. Nothing ferny grows
        // in the blight, so out there this becomes a dead twig instead.
        if (w > 0.55) {
          const h = 0.7 + R() * 1.4;
          B.blade.add(x, y + h * 0.5, z, 0.07, h, 0.07,
            this._fade(0x4f3a26, 1, 0x6b6c74), R() * 3,
            (R() - 0.5) * 0.9, (R() - 0.5) * 0.9);
        } else {
          const n = 4 + Math.floor(R() * 3);
          const s = (0.7 + R() * 0.8) * (1 - w * 0.4);
          for (let k = 0; k < n; k++) {
            const fa = (k / n) * Math.PI * 2 + R() * 0.4;
            B.cone.add(x + Math.cos(fa) * 0.5 * s, y + 0.5 * s,
              z + Math.sin(fa) * 0.5 * s,
              0.3 * s, 1.5 * s, 0.3 * s,
              this._fade(R() < 0.4 ? 0x2f5f27 : 0x3f7a30, w * 1.4, 0x8a7f62),
              fa, Math.cos(fa) * 0.5, Math.sin(fa) * 0.5);
          }
        }
      } else if (roll < 0.80) {
        /**
         * FLOWERS — and the one detail the fourth reference is built on.
         *
         * In the green wood they are pink, gold and pale blue on a green
         * stalk. In the blight they are the small BLUE ones scattered
         * through the dead grass in front of the ruined arch, which is the
         * single most memorable thing in that image: the only colour left in
         * a place where everything else has gone grey.
         */
        const h = (0.4 + R() * 0.7) * (1 - w * 0.3);
        B.blade.add(x, y + h * 0.5, z, 0.05, h, 0.05,
          this._fade(0x4f8f38, w, 0x7a7458));
        const live = [0xf4a0c0, 0x8fd8f4, 0xf4e6b0, 0xd8b0f4][Math.floor(R() * 4)];
        const dead = R() < 0.75 ? 0x6f9fe0 : 0x9fc4f4;
        B.low.add(x, y + h + 0.08, z, 0.16 + w * 0.05, 0.1, 0.16 + w * 0.05,
          w > 0.5 ? dead : live);
      } else if (roll < 0.93) {
        // Mushrooms, in little colonies. The blight kills the red and gold
        // ones and leaves the pale glowing sort, which is unsettling rather
        // than pretty — the right note for the edge of the wood.
        const n = 1 + Math.floor(R() * 4);
        for (let k = 0; k < n; k++) {
          const mx = x + (R() - 0.5) * 1.3, mz = z + (R() - 0.5) * 1.3;
          const my = this._gy(mx, mz);
          const s = (0.16 + R() * 0.3) * (1 - w * 0.25);
          B.stalk.add(mx, my + s * 1.1, mz, s * 0.3, s * 2.2, s * 0.3,
            this._fade(0xe8dcc0, w * 0.6, 0xb8bcc4));
          const glow = R() < (w > 0.5 ? 0.55 : 0.22);
          B.cap.add(mx, my + s * 2.3, mz, s, s * 0.72, s,
            glow ? (w > 0.5 ? 0xa8d4f4 : 0x8fe8ff)
              : this._fade(R() < 0.5 ? 0xb04a3a : 0xd8a05a, w, 0x9a9488));
        }
      } else {
        // Stones, half sunk into the moss — and bare rock where the moss
        // has died back off them.
        const s = 0.4 + R() * 1.6;
        B.rock.add(x, y + s * 0.28, z, s, s * 0.6, s * 0.9,
          this._fade(R() < 0.5 ? 0x7a7a70 : 0x5f5b52, w * 0.5, 0x8a8f96),
          R() * 3, R() * 0.4, R() * 0.4);
        if (R() < 0.6 - w * 0.5) {
          B.low.add(x, y + s * 0.5, z, s * 0.8, s * 0.3, s * 0.7,
            this._fade(0x3f7a30, w * 1.4));
        }
      }
    }

    /**
     * AND A CARPET OF FALLEN LEAVES ON THE PATH.
     *
     * Flat discs in the middle of the glade, in autumn colours, where the
     * canopy drops onto the one bit of open ground. It is the detail that
     * makes the glade read as being UNDER something.
     */
    for (let i = 0; i < 260; i++) {
      const a = R() * Math.PI * 2;
      const rad = Math.sqrt(R()) * (GLADE_R + 8);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const s = 0.3 + R() * 0.45;
      B.disc.add(x, this._gy(x, z) + 0.04, z, s, 0.03, s * 1.3,
        [0xd8a05a, 0xb99a5a, 0x8fc44a, 0xa8845a][Math.floor(R() * 4)], R() * 3);
    }
  }

  /** Fallen trunks, with fungus shelves growing off them. */
  _deadwood() {
    const R = this.rnd;
    const B = this.b;
    for (let i = 0; i < 7; i++) {
      const a = R() * Math.PI * 2;
      const rad = GLADE_R + 4 + R() * 52;
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const y = this._gy(x, z);
      const len = 14 + R() * 22;
      const w = 1.6 + R() * 1.8;
      const dir = R() * Math.PI * 2;
      const wi = this.wither(x, z);
      B.limb.add(x, y + w * 0.8, z, w, len, w,
        this._fade(0x4a3524, wi, 0x5f6068),
        dir + Math.PI / 2, 0, Math.PI / 2);
      this._solid(x, y + w * 0.7, z, w, w, len * 0.5, 'log');
      // Moss along the top, shelves of fungus off the side, and a sapling
      // growing out of it — a fallen tree in a LIVING wood is a nursery. Out
      // in the blight it is only a dead tree on the ground.
      if (wi < 0.7) {
        B.low.add(x, y + w * 1.5, z, w * 0.9, w * 0.35, len * 0.46,
          this._fade(0x3f7a30, wi * 1.3), dir + Math.PI / 2);
      }
      const shelves = Math.round((3 + Math.floor(R() * 5)) * (1 - wi * 0.7));
      for (let k = 0; k < shelves; k++) {
        const t = (k / Math.max(1, shelves) - 0.5) * len * 0.85;
        const sx = x - Math.sin(dir) * t, sz = z - Math.cos(dir) * t;
        const sd = R() < 0.5 ? 1 : -1;
        B.cap.add(sx + Math.cos(dir) * sd * w * 0.7, y + w * (0.9 + R() * 0.6),
          sz - Math.sin(dir) * sd * w * 0.7,
          0.55 + R() * 0.5, 0.16, 0.4 + R() * 0.3,
          this._fade(R() < 0.3 ? 0xf2ecdc : 0xd8a05a, wi, 0xa8a49a), dir);
      }
      if (wi < 0.55 && R() < 0.7) {
        const t = (R() - 0.5) * len * 0.6;
        const sx = x - Math.sin(dir) * t, sz = z - Math.cos(dir) * t;
        const sh = 3 + R() * 4;
        B.trunk.add(sx, y + w * 1.6 + sh * 0.5, sz, 0.3, sh, 0.3, 0x4f3a26);
        for (let k = 0; k < 2; k++) {
          B.blob.add(sx + (R() - 0.5) * 2, y + w * 1.6 + sh, sz + (R() - 0.5) * 2,
            2.2, 1.5, 2.2, 0x4f8f38);
        }
      }
    }
  }

  /**
   * THE STREAM.
   *
   * A shallow ribbon of water winding through the wood, with stepping stones
   * where the path crosses it and a small fall over one of the roots. It does
   * two jobs: it is the only moving thing on the floor, and it gives the
   * glade a reason to be where it is.
   */
  _stream() {
    const R = this.rnd;
    const B = this.b;
    const wmat = new THREE.MeshLambertMaterial({
      color: 0x4f9fc4, transparent: true, opacity: 0.78,
      emissive: 0x0d3348,
    });
    this.owned.push(wmat);
    /**
     * The same stream, out where the wood is dead.
     *
     * Standing rather than running: darker, greener, and flatter. Water in
     * the blight is not clear water, and having two materials for one
     * stream costs one extra draw call and is the detail that makes walking
     * along it feel like walking towards something wrong.
     */
    const dmat = new THREE.MeshLambertMaterial({
      color: 0x3a4f52, transparent: true, opacity: 0.72,
    });
    this.owned.push(dmat);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(geo);
    // Twenty-two segments following a sine through the wood.
    const N = 22;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const along = lerp(-WOOD_R * 0.95, WOOD_R * 0.95, t);
      const side = Math.sin(t * Math.PI * 2.2) * 26 + Math.sin(t * 9) * 3;
      pts.push({
        x: this.at.x + along * 0.86 - side * 0.5,
        z: this.at.z + along * 0.5 + side * 0.86,
      });
    }
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
      const len = Math.hypot(b.x - a.x, b.z - a.z) * 1.2;
      const w = 4.2 + Math.sin(i * 1.3) * 1.6;
      const y = Math.min(this._gy(a.x, a.z), this._gy(b.x, b.z));
      const face = -Math.atan2(b.z - a.z, b.x - a.x);
      const wi = this.wither(mx, mz);
      const m = new THREE.Mesh(geo, wi > 0.5 ? dmat : wmat);
      m.rotation.set(-Math.PI / 2, 0, 0);
      m.position.set(mx, y + 0.12, mz);
      m.scale.set(len, w, 1);
      m.rotation.z = face;
      // A plane rotated to lie flat then spun about its own normal.
      m.rotation.set(-Math.PI / 2, 0, face);
      m.receiveShadow = true;
      this.root.add(m);
      // The bank: stones and moss down both sides.
      for (const sd of [-1, 1]) {
        const bx = mx - Math.sin(-face) * sd * w * 0.55;
        const bz = mz - Math.cos(-face) * sd * w * 0.55;
        const s = 0.5 + R() * 1.1;
        B.rock.add(bx, this._gy(bx, bz) + s * 0.3, bz, s, s * 0.7, s,
          this._fade(0x6f6b62, wi * 0.6, 0x8a8f96), R() * 3);
        if (R() < 0.5 - wi * 0.45) {
          B.low.add(bx, this._gy(bx, bz) + s * 0.5, bz, s * 0.8, s * 0.3,
            s * 0.8, this._fade(0x3f7a30, wi * 1.4));
        }
      }
      // Stepping stones at the crossing nearest the glade.
      if (i === Math.floor(N * 0.5)) {
        for (let k = -2; k <= 2; k++) {
          const sx = mx - Math.sin(-face) * k * 1.5;
          const sz = mz - Math.cos(-face) * k * 1.5;
          B.disc.add(sx, this._gy(sx, sz) + 0.28, sz, 1.05, 0.6, 1.05,
            0x8b8578, R() * 3);
          this._solid(sx, this._gy(sx, sz) + 0.2, sz, 0.95, 0.3, 0.95, 'deck');
        }
      }
    }
  }

  /**
   * FOUR RUINED ARCHES, half swallowed.
   *
   * Somebody built here, a very long time ago, and the wood has taken it
   * back. They are the first environmental storytelling in the game and they
   * are deliberately unexplained — the answer arrives about eight hours
   * later, when the player works out whose empire this was.
   */
  _arches() {
    const R = this.rnd;
    const B = this.b;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.8;
      /**
       * OUT IN THE DEAD PART, deliberately.
       *
       * The fourth reference image is a mossy arch standing alone in blue
       * fog between bare trees, with blue flowers in the grass in front of
       * it — and that is exactly what the outer wood now is. Putting the
       * arches in the green half would have wasted both: the ruins want the
       * fog, and the glade wants to be the only living thing you can see.
       */
      const rad = WOOD_R * (0.66 + R() * 0.26);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const y = this._gy(x, z);
      const face = a + Math.PI / 2 + (R() - 0.5) * 0.5;
      const w = 5.2 + R() * 2.4;
      const h = 7 + R() * 3.5;
      const lean = (R() - 0.5) * 0.14;
      // Two piers and a lintel, leaning, with the whole thing sunk a little.
      for (const sd of [-1, 1]) {
        const px = x + Math.cos(face) * sd * w * 0.5;
        const pz = z + Math.sin(face) * sd * w * 0.5;
        B.slab.add(px, this._gy(px, pz) + h * 0.5 - 0.6, pz,
          1.5, h, 1.5, 0x8b8578, face, 0, lean);
        this._solid(px, this._gy(px, pz) + h * 0.4, pz, 0.8, h * 0.4, 0.8, 'pier');
        // Moss up the north face of every pier.
        B.low.add(px, this._gy(px, pz) + h * 0.4, pz, 0.9, h * 0.3, 0.9,
          0x3f7a30);
      }
      // The arch itself, as five voussoirs — one of them missing.
      const gone = 1 + Math.floor(R() * 3);
      for (let k = 0; k < 5; k++) {
        if (k === gone) continue;
        const t = (k / 4 - 0.5) * Math.PI * 0.86;
        const ax = x + Math.cos(face) * Math.sin(t) * w * 0.5;
        const az = z + Math.sin(face) * Math.sin(t) * w * 0.5;
        B.slab.add(ax, y + h - 0.4 + Math.cos(t) * 1.6, az,
          1.4, 1.5, 1.4, 0x8b8578, face, 0, t * 0.7 + lean);
      }
      // A fallen stone at its foot, and ivy going up one side.
      B.rock.add(x + Math.cos(face) * w * 0.7, y + 0.7,
        z + Math.sin(face) * w * 0.7, 1.6, 1.1, 1.4, 0x8b8578, R() * 3);
      for (let k = 0; k < 6; k++) {
        const vx = x + Math.cos(face) * -w * 0.5;
        const vz = z + Math.sin(face) * -w * 0.5;
        B.low.add(vx + (R() - 0.5) * 1.2, y + 1 + k * 1.1, vz + (R() - 0.5) * 1.2,
          0.7, 0.5, 0.7, 0x2f5f27);
      }
    }
  }

  /**
   * THE EMPEROR STONE.
   *
   * A mossy dais in the middle of the glade with a carved disc standing on
   * it, and on the disc the same mark that is on the player's clothes. The
   * player wakes up nine units away from it looking straight at it.
   *
   * The prop that makes it touchable is added by the Overworld — this is
   * only the stone. `pedestal` is where it says to put it.
   */
  _pedestalStone() {
    const B = this.b;
    const x = this.at.x, z = this.at.z;
    const y = this._gy(x, z);
    // Three broad mossy steps up to it.
    for (let i = 0; i < 3; i++) {
      B.disc.add(x, y + 0.25 + i * 0.5, z, 5.4 - i * 1.1, 0.5, 5.4 - i * 1.1,
        i === 1 ? 0x7a7a70 : 0x8b8578);
      B.low.add(x + (i - 1) * 1.6, y + 0.5 + i * 0.5, z + (1 - i) * 1.7,
        1.5, 0.24, 1.5, 0x3f7a30);
    }
    // The plinth and the disc.
    B.slab.add(x, y + 2.1, z, 1.9, 1.6, 1.9, 0x8b8578);
    const dy = y + 3.5;
    B.disc.add(x, dy, z, 1.7, 0.34, 1.7, 0xc4bfae, 0, Math.PI / 2, 0);
    /**
     * THE MARK.
     *
     * A ring with a bar across it and three rays over the top. It has to be
     * simple enough to be recognised on a scrap of cloth eight hours later,
     * which is the only requirement — a crest nobody can redraw from memory
     * is not a clue.
     */
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      B.slab.add(x + Math.cos(a) * 1.05, dy + 0.2, z + Math.sin(a) * 1.05,
        0.34, 0.12, 0.2, 0xffd76b, -a);
    }
    B.slab.add(x, dy + 0.2, z, 1.7, 0.12, 0.22, 0xffd76b);
    for (let i = -1; i <= 1; i++) {
      B.slab.add(x + i * 0.5, dy + 0.2, z - 1.35 - Math.abs(i) * 0.1,
        0.16, 0.12, 0.7, 0xffd76b, i * 0.3);
    }
    this._solid(x, y + 2, z, 1.9, 2, 1.9, 'pedestal');
    this.realm.collision.addAnchor(x, y + 4, z, 2.2);
    this.pedestal = { x, y: dy, z };
  }

  /**
   * THE LIGHT, AND WHAT HANGS IN IT.
   *
   * Nine shafts coming down through gaps in the canopy, and curtains of moss
   * hanging off the great limbs. The shafts are the image the whole location
   * is built around and they are also the single most dangerous thing in it:
   * an additive plane at high opacity in front of the camera is what made an
   * earlier build of this game literally unplayable. So every one of them is
   * at 0.09, anchored to a TREE rather than to the camera, and tilted so the
   * player walks through them rather than into them.
   */
  _light() {
    const R = this.rnd;
    const tex = fadeTexture('rgba(226,244,200,0.85)', 'rgba(180,220,150,0.2)');
    this.owned.push(tex);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      /**
       * SUN ONLY WHERE THE WOOD IS ALIVE.
       *
       * Every shaft is inside the green half. That is not a lighting
       * decision, it is the point of the place: the glade is the last warm
       * thing here, and the treeline is cold, grey and flat. Half of them
       * are in the glade itself, so waking up means waking up in the light.
       */
      const rad = i < 4 ? R() * GLADE_R * 0.8 : GLADE_R * 0.6 + R() * 30;
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const y = this._gy(x, z);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.09, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.owned.push(mat);
      const w = 8 + R() * 16;
      const h = 74 + R() * 34;
      const geo = new THREE.PlaneGeometry(w, h);
      this.owned.push(geo);
      // Two crossed planes, so the shaft reads as a volume from any angle.
      for (let k = 0; k < 2; k++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y + h * 0.42, z);
        m.rotation.set(0.16 + R() * 0.1, a + k * Math.PI / 2, 0.12);
        m.renderOrder = 3;
        this.root.add(m);
      }
      // A brighter pool where it lands.
      const pmat = new THREE.MeshBasicMaterial({
        color: 0xdff4c0, transparent: true, opacity: 0.14, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.owned.push(pmat);
      const pgeo = new THREE.CircleGeometry(w * 0.5, 14);
      this.owned.push(pgeo);
      const pool = new THREE.Mesh(pgeo, pmat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, y + 0.08, z);
      pool.renderOrder = 2;
      this.root.add(pool);
    }

    /**
     * AND COLD FOG WHERE THE SUN IS NOT.
     *
     * Big, soft, pale-blue billboards lying low between the dead trees. It
     * is the other half of the fourth reference image and it does two jobs:
     * it hides the far treeline so the wood has no visible edge, and it
     * makes the walk out of the glade feel like walking into weather.
     *
     * Not additive. Additive fog over a dark wood glows, which reads as
     * magic; this has to read as damp.
     */
    const gtex = glowTexture('rgba(212,232,248,0.55)', 'rgba(186,212,236,0.3)');
    this.owned.push(gtex);
    const gmat = new THREE.MeshBasicMaterial({
      map: gtex, transparent: true, opacity: 0.34, depthWrite: false,
    });
    this.owned.push(gmat);
    const ggeo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(ggeo);
    const G = 120;
    const fog = new THREE.InstancedMesh(ggeo, gmat, G);
    fog.frustumCulled = false;
    fog.renderOrder = 1;
    let fi = 0;
    for (let i = 0; i < G * 3 && fi < G; i++) {
      const a = R() * Math.PI * 2;
      const rad = WOOD_R * (0.55 + R() * 0.6);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      // Only where it has actually died back. The glade never gets fog.
      if (this.wither(x, z) < 0.35) continue;
      const s = 14 + R() * 30;
      _v.set(x, this._gy(x, z) + 1.5 + R() * 6, z);
      _s.set(s, s * (0.3 + R() * 0.25), 1);
      _m.compose(_v, _q.identity(), _s);
      fog.setMatrixAt(fi++, _m);
    }
    fog.count = fi;
    fog.instanceMatrix.needsUpdate = true;
    this.root.add(fog);
    this.fog = fog;

    // ---- hanging moss ----
    const mtex = fadeTexture('rgba(120,170,90,0.95)', 'rgba(90,140,70,0.55)');
    this.owned.push(mtex);
    const mmat = new THREE.MeshLambertMaterial({
      map: mtex, transparent: true, opacity: 0.9, depthWrite: false,
      side: THREE.DoubleSide, color: 0x9fc47a,
    });
    this.owned.push(mmat);
    for (const t of this.trees) {
      const n = 3 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const rad = t.base + 6 + R() * 26;
        const x = t.x + Math.cos(a) * rad;
        const z = t.z + Math.sin(a) * rad;
        // Moss hangs where moss grows. Nothing green is left up there once
        // the tree it is hanging from has lost its leaves.
        if (this.wither(x, z) > 0.6) continue;
        const top = t.y + t.h * (0.5 + R() * 0.35);
        const len = 8 + R() * 20;
        const geo = new THREE.PlaneGeometry(2.4 + R() * 3.5, len);
        this.owned.push(geo);
        const m = new THREE.Mesh(geo, mmat);
        m.position.set(x, top - len * 0.5, z);
        m.rotation.y = R() * Math.PI;
        this.root.add(m);
        this.curtains.push({ mesh: m, phase: R() * 6, base: m.rotation.y });
      }
    }
  }

  /**
   * WHAT MOVES.
   *
   * Spore-light drifting upward, fireflies wandering, butterflies flitting,
   * and eighteen creatures. All four are instanced and all four are updated
   * by rewriting matrices, so the whole living layer is nine draw calls and
   * allocates nothing per frame.
   */
  _alive() {
    const R = this.rnd;

    // ---- spore-light: slow, upward, wrapping ----
    const tex = glowTexture('rgba(230,255,210,0.95)', 'rgba(160,230,140,0.4)');
    this.owned.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.owned.push(mat);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(geo);
    const N = 190;
    const motes = new THREE.InstancedMesh(geo, mat, N);
    motes.frustumCulled = false;
    motes.renderOrder = 4;
    const items = [];
    for (let i = 0; i < N; i++) {
      // Biased inward: the spore-light is a thing the LIVING wood is doing.
      const a = R() * Math.PI * 2;
      const rad = Math.pow(R(), 0.75) * WOOD_R * 0.72;
      items.push({
        x: this.at.x + Math.cos(a) * rad,
        z: this.at.z + Math.sin(a) * rad,
        y: R() * 34,
        s: 0.16 + R() * 0.34,
        rise: 0.4 + R() * 1.1,
        sway: R() * 6,
        swayR: 0.3 + R() * 0.8,
      });
    }
    this.root.add(motes);
    this.motes = { mesh: motes, items, top: 36 };

    // ---- fireflies: brighter, fewer, and they wander rather than rise ----
    const ftex = glowTexture('rgba(255,244,180,1)', 'rgba(255,214,90,0.5)');
    this.owned.push(ftex);
    const fmat = new THREE.MeshBasicMaterial({
      map: ftex, transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.owned.push(fmat);
    const F = 46;
    const flies = new THREE.InstancedMesh(geo, fmat, F);
    flies.frustumCulled = false;
    flies.renderOrder = 5;
    const fitems = [];
    for (let i = 0; i < F; i++) {
      // In the green half. Nothing is living out at the treeline.
      const a = R() * Math.PI * 2;
      const rad = Math.sqrt(R()) * WOOD_R * 0.62;
      fitems.push({
        hx: this.at.x + Math.cos(a) * rad,
        hz: this.at.z + Math.sin(a) * rad,
        hy: 1 + R() * 5,
        r: 1.5 + R() * 4,
        p: R() * 6, q: R() * 6,
        sp: 0.3 + R() * 0.6,
        s: 0.2 + R() * 0.22,
        blink: R() * 6,
      });
    }
    this.root.add(flies);
    this.flies = { mesh: flies, items: fitems };

    // ---- butterflies: two-tone, and they flit in short bursts ----
    const btex = glowTexture('rgba(255,255,255,0.95)', 'rgba(240,180,220,0.6)');
    this.owned.push(btex);
    const bmat = new THREE.MeshBasicMaterial({
      map: btex, transparent: true, opacity: 0.9, depthWrite: false,
    });
    this.owned.push(bmat);
    const W = 26;
    const wings = new THREE.InstancedMesh(geo, bmat, W);
    wings.frustumCulled = false;
    const witems = [];
    for (let i = 0; i < W; i++) {
      const a = R() * Math.PI * 2;
      const rad = Math.sqrt(R()) * WOOD_R * 0.55;
      witems.push({
        hx: this.at.x + Math.cos(a) * rad,
        hz: this.at.z + Math.sin(a) * rad,
        r: 3 + R() * 9,
        p: R() * 6,
        sp: 0.5 + R() * 0.7,
        s: 0.3 + R() * 0.3,
        bob: R() * 6,
      });
    }
    this.root.add(wings);
    this.wings = { mesh: wings, items: witems };

    /**
     * AND BLUE PETALS OUT IN THE DEAD PART.
     *
     * The counterpart to the butterflies, and lifted straight from the
     * fourth reference: little blue flakes drifting low through the grass in
     * front of the ruins. They fall rather than rise, which is the whole
     * difference in feeling — the glade's motes go up towards the light and
     * these come down.
     */
    const ptex = glowTexture('rgba(200,224,255,0.9)', 'rgba(130,175,235,0.5)');
    this.owned.push(ptex);
    const pmat = new THREE.MeshBasicMaterial({
      map: ptex, transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.owned.push(pmat);
    const P = 90;
    const petals = new THREE.InstancedMesh(geo, pmat, P);
    petals.frustumCulled = false;
    petals.renderOrder = 4;
    const pitems = [];
    for (let i = 0; i < P * 3 && pitems.length < P; i++) {
      const a = R() * Math.PI * 2;
      const rad = WOOD_R * (0.6 + R() * 0.5);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      if (this.wither(x, z) < 0.4) continue;
      pitems.push({
        x, z,
        y: R() * 14,
        s: 0.14 + R() * 0.2,
        fall: 0.5 + R() * 1.0,
        drift: R() * 6,
        driftR: 0.6 + R() * 1.4,
      });
    }
    petals.count = pitems.length;
    this.root.add(petals);
    this.petals = { mesh: petals, items: pitems, top: 14 };

    // ---- and the creatures ----
    this.critters = new Critters(this.root, this.realm, this.at, R, 18);
    this.critters.paint();
  }

  // ------------------------------------------------------------------ frame

  /**
   * @param playerPos so the creatures can notice you, or null
   * @param near      false when the player is a long way off: everything
   *                  living is skipped, because none of it can be seen
   */
  update(dt, playerPos, near = true) {
    this.time += dt;
    if (!near) return;
    const T = this.time;

    // Spore-light rises and wraps.
    const M = this.motes;
    if (M) {
      for (let i = 0; i < M.items.length; i++) {
        const it = M.items[i];
        it.y += it.rise * dt;
        if (it.y > M.top) it.y -= M.top;
        _v.set(it.x + Math.sin(T * 0.4 + it.sway) * it.swayR,
          this._gy(it.x, it.z) + it.y,
          it.z + Math.cos(T * 0.33 + it.sway) * it.swayR);
        _m.makeScale(it.s, it.s, 1);
        _m.setPosition(_v);
        M.mesh.setMatrixAt(i, _m);
      }
      M.mesh.instanceMatrix.needsUpdate = true;
    }

    // Fireflies wander a small lissajous and blink.
    const F = this.flies;
    if (F) {
      for (let i = 0; i < F.items.length; i++) {
        const it = F.items[i];
        const t = T * it.sp;
        const x = it.hx + Math.sin(t + it.p) * it.r;
        const z = it.hz + Math.sin(t * 1.31 + it.q) * it.r;
        const y = this._gy(x, z) + it.hy + Math.sin(t * 0.7 + it.p) * 0.9;
        // Blinking, as a scale pulse — the mesh has one shared material, so
        // it cannot be done with opacity.
        const b = 0.35 + 0.65 * Math.max(0, Math.sin(T * 2.2 + it.blink));
        const s = it.s * b;
        _v.set(x, y, z);
        _m.makeScale(s, s, 1);
        _m.setPosition(_v);
        F.mesh.setMatrixAt(i, _m);
      }
      F.mesh.instanceMatrix.needsUpdate = true;
    }

    // Butterflies: bigger loops, and they bob as they go.
    const W = this.wings;
    if (W) {
      for (let i = 0; i < W.items.length; i++) {
        const it = W.items[i];
        const t = T * it.sp;
        const x = it.hx + Math.cos(t + it.p) * it.r;
        const z = it.hz + Math.sin(t * 0.83 + it.p) * it.r;
        const y = this._gy(x, z) + 1.4 + Math.sin(t * 2.6 + it.bob) * 0.7;
        // The flutter: the quad narrows and widens, which at this size is a
        // wingbeat.
        const w = it.s * (0.35 + 0.65 * Math.abs(Math.sin(T * 9 + it.p)));
        _v.set(x, y, z);
        _m.makeScale(w, it.s, 1);
        _m.setPosition(_v);
        W.mesh.setMatrixAt(i, _m);
      }
      W.mesh.instanceMatrix.needsUpdate = true;
    }

    // Blue petals, falling and wrapping, out where the wood has died.
    const P = this.petals;
    if (P) {
      for (let i = 0; i < P.items.length; i++) {
        const it = P.items[i];
        it.y -= it.fall * dt;
        if (it.y < 0) it.y += P.top;
        _v.set(it.x + Math.sin(T * 0.5 + it.drift) * it.driftR,
          this._gy(it.x, it.z) + 0.2 + it.y,
          it.z + Math.cos(T * 0.42 + it.drift) * it.driftR);
        _m.makeScale(it.s, it.s * 0.7, 1);
        _m.setPosition(_v);
        P.mesh.setMatrixAt(i, _m);
      }
      P.mesh.instanceMatrix.needsUpdate = true;
    }

    // The moss curtains sway.
    for (const c of this.curtains) {
      c.mesh.rotation.z = Math.sin(T * 0.6 + c.phase) * 0.05;
    }

    if (this.critters) this.critters.update(dt, playerPos);
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.critters) this.critters.dispose();
    for (const k in (this.b || {})) {
      if (this.b[k].geo) { try { this.b[k].geo.dispose(); } catch (e) { /* gone */ } }
    }
    for (const o of this.owned) {
      if (o && o.dispose) { try { o.dispose(); } catch (e) { /* gone */ } }
    }
    this.owned.length = 0;
    this.curtains.length = 0;
  }
}
