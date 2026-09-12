/**
 * THE WAKEWOOD — where an emperor wakes up with nothing.
 *
 * This is the first place anybody walks around in, and it is by a long way
 * the largest hand-built location in the game: a wood nine hundred metres
 * across, with a network of paths through it, forty colossal trees, a lake,
 * a waterfall, a hollow stump you can walk inside, eleven ruins, and about
 * thirty-four thousand individual growing things.
 *
 * ── the three problems this file exists to solve ─────────────────────────
 *
 * 1. IT HAS TO BE WALKABLE. The first version of this wood was scattered
 *    uniformly, which is what a forest looks like from above and is
 *    completely unplayable from inside — the player spent the opening of the
 *    game shuffling sideways between root colliders. So the wood is now
 *    built around a PATH NETWORK first and everything else is placed
 *    against it. Nothing is ever placed on a path, nothing solid is ever
 *    placed within reach of one, and every path is paved so you can see
 *    where it goes.
 *
 * 2. IT HAS TO BE BIG. Fifteen times the area of the first version. That is
 *    far too much geometry to draw at once, so the floor is built into a
 *    GRID OF CELLS, each with its own instanced meshes, and only the cells
 *    near the player are shown. The trees are global, because a hundred-
 *    metre tree is a landmark and you are meant to see it from the far side
 *    of the wood.
 *
 * 3. IT HAS TO FEEL ALIVE. Forty creatures that notice you, four drifting
 *    swarms that follow the paths, and a living/dying gradient — the middle
 *    is the green of the reference paintings and the outer third is bare
 *    grey trees in cold fog.
 *
 * ── and the pedestal ────────────────────────────────────────────────────
 * In the glade at the middle, on a mossy dais, a stone with the same mark
 * that is on the player's clothes. Touching it is the first flashback in the
 * game and the first line of the story.
 */

import * as THREE from '../lib/three.module.js?v=v114';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep,
  dampAngle, lookYaw } from './util.js?v=v114';
import { SEA, REGIONS } from './regions.js?v=v114';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _cd = new THREE.Color();

/**
 * How far the wood reaches.
 *
 * Fifteen times the area of the original hundred-and-eighteen-metre wood,
 * which is a radius of √15 times as much. You cannot see one side of it
 * from the other.
 */
export const WOOD_R = 457;
/** The clearing you wake up in: no trees, nothing tall, nothing in the way. */
export const GLADE_R = 30;
/** Floor detail is built into cells this big and shown by distance. */
const CELL = 56;
/** How far from the player a floor cell is still drawn. */
const FLOOR_SHOW = 168;

/**
 * WHERE THE WOOD IS.
 *
 * The empty north of the Lily Reach, and the spot is not a guess: it was
 * searched for. A four-hundred-and-fifty-metre wood dropped anywhere near
 * the settled part of the region swallows something — the first attempt put
 * it thirty-six metres from the Lily Reach's own landmark and straight on
 * top of Croakhollow, which is how a village ends up inside a forest.
 *
 * This centre is the CLOSEST spot to Croakhollow that clears every site,
 * boss arena and landmark in the country by thirty metres and is a hundred
 * per cent dry land: seven hundred and ten metres from the village, which
 * is a walk with a path most of the way and exactly the right length for
 * "a villager finds you and takes you home".
 */
export const WOOD_AT = { x: 700, z: 1800 };

/**
 * HOW MUCH ROOM A PLACE GETS INSIDE THE WOOD.
 *
 * A four-hundred-and-fifty-metre wood does not fit in the Lily Reach
 * without touching something: the region is not that big and the map's
 * walkable ground stops at 2150, so every genuinely empty spot is on the
 * outer rim — one candidate was measured at fifty per cent too steep to
 * walk, which is a mountain wall rather than a forest.
 *
 * So the wood is put on the flattest ground in the region (measured: 0.4%
 * unwalkable, twenty-two metres of relief across nine hundred) and it
 * simply DOES NOT GROW where something already is. Croakhollow ends up in a
 * clearing on the wood's western edge, which reads far better than a
 * kilometre of empty grass anyway: the first village is a village at the
 * edge of the forest you woke up in.
 */
const SITE_ROOM = 42;

/**
 * HOW WIDE A PATH IS, and how much room it keeps round itself.
 *
 * `PATH_W` is the paved part. `PATH_CLEAR` is how far from the middle of a
 * path nothing SOLID may be placed — wider than the paving, because a
 * boulder whose edge overhangs the path is the same obstruction as a boulder
 * on it. `PATH_BARE` is how far out the undergrowth is thinned, which is
 * what makes a path read as a path rather than as a stripe of stones.
 */
export const PATH_W = 3.4;
export const PATH_CLEAR = 5.2;
const PATH_BARE = 6.4;

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
    this.mesh = mesh;
    return mesh;
  }
}

/** A soft round blob, for motes, fireflies and fog. */
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

/** A vertical fade, for light shafts, waterfalls and moss curtains. */
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
 * Forty small forest creatures — the ones in the reference art peering out
 * of the undergrowth. They are the single biggest reason the wood reads as
 * ALIVE rather than as a set: a static forest with perfect lighting is a
 * photograph, and one with something moving at the edge of it is a place.
 *
 * Each is five instanced parts, so all forty cost five draw calls and are
 * individually animated. Their behaviour is deliberately simple:
 *
 *   idle    they sit, and their ears twitch, and they breathe
 *   hop     three or four little arcs to somewhere else nearby
 *   watch   if the player is close they stop and TURN TO LOOK
 *   flee    if the player gets very close they bolt a short way off
 *
 * "Turn to look" is the one that matters. A creature that ignores you is
 * scenery; a creature that notices you is a creature.
 *
 * Only the ones within a hundred and thirty metres are simulated or drawn.
 * Forty creatures spread over nine hundred metres means about six are ever
 * in range, and the rest cost one distance check each.
 */
class Critters {
  constructor(parent, wood, rnd, count = 40) {
    this.wood = wood;
    this.realm = wood.realm;
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
     * Mostly the small brown ones, a few pale ones, and two or three of the
     * big slow mossy sort — the ones with a bush growing on their back that
     * the reference art puts at the edge of the path. Rarity is what makes
     * spotting one feel like spotting something.
     */
    const KINDS = [
      { w: 34, skin: 0x8a6a42, ear: 0xa8845a, size: 0.5, hop: 2.2, shy: 7 },
      { w: 24, skin: 0xb99a5a, ear: 0xd8c49a, size: 0.44, hop: 2.6, shy: 9 },
      { w: 18, skin: 0x6b8a4a, ear: 0x8fc44a, size: 0.56, hop: 1.8, shy: 6 },
      { w: 14, skin: 0xd8d4c6, ear: 0xf2ecdc, size: 0.4, hop: 3.0, shy: 11 },
      { w: 6, skin: 0x4f6f3a, ear: 0x2f5f27, size: 1.0, hop: 0.9, shy: 4 },
    ];
    const total = KINDS.reduce((a, k) => a + k.w, 0);
    for (let i = 0; i < count; i++) {
      let roll = rnd() * total, kind = KINDS[0];
      for (const k of KINDS) { roll -= k.w; if (roll <= 0) { kind = k; break; } }
      /**
       * Beside the paths, and in the living half of the wood.
       *
       * Beside, not on: a creature standing in the road is something the
       * player walks into. A few metres off means the player sees them from
       * the path, which is where the player is.
       */
      const spot = wood.nearPath(rnd, 5, 14);
      this.list.push({
        kind,
        x: spot.x, z: spot.z, y: this.realm.heightAt(spot.x, spot.z),
        home: { x: spot.x, z: spot.z },
        yaw: rnd() * Math.PI * 2,
        state: 'idle',
        wait: rnd() * 4,
        hopT: 0, hops: 0,
        fromX: spot.x, fromZ: spot.z, toX: spot.x, toZ: spot.z,
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
      const pd = playerPos
        ? Math.hypot(playerPos.x - c.x, playerPos.z - c.z) : 9999;
      /**
       * Only the ones you could actually see are simulated OR drawn.
       *
       * The rest have their instances collapsed to a zero scale, which is
       * how one InstancedMesh can hold forty creatures and submit six.
       */
      if (pd > 130) {
        _m.makeScale(0, 0, 0);
        this.mesh.body.setMatrixAt(idx.body++, _m);
        this.mesh.head.setMatrixAt(idx.head++, _m);
        this.mesh.tail.setMatrixAt(idx.tail++, _m);
        for (let i = 0; i < 2; i++) {
          this.mesh.ear.setMatrixAt(idx.ear++, _m);
          this.mesh.eye.setMatrixAt(idx.eye++, _m);
        }
        continue;
      }
      const K = c.kind;

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
          // Watching. It has seen you, and it turns to face you.
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
      const air = (c.state === 'hop' || c.state === 'flee')
        ? Math.sin(clamp(c.hopT, 0, 1) * Math.PI) * 0.55 * c.scale * 2.2 : 0;
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
      put(this.mesh.body, idx.body++, c.x, y + 0.42 * S, c.z,
        0.46 * S, (0.4 + breath) * S, 0.52 * S, face);
      const hx = c.x + fx * 0.42 * S, hz = c.z + fz * 0.42 * S;
      const hy = y + 0.62 * S;
      put(this.mesh.head, idx.head++, hx, hy, hz,
        0.3 * S, 0.28 * S, 0.3 * S, face);
      for (const sd of [-1, 1]) {
        put(this.mesh.ear, idx.ear++,
          hx + rx * sd * 0.16 * S - fx * 0.04 * S, hy + 0.3 * S,
          hz + rz * sd * 0.16 * S - fz * 0.04 * S,
          0.1 * S, 0.34 * S, 0.1 * S, face, sd * (0.12 + flick), -sd * 0.2);
      }
      for (const sd of [-1, 1]) {
        put(this.mesh.eye, idx.eye++,
          hx + rx * sd * 0.15 * S + fx * 0.2 * S, hy + 0.05 * S,
          hz + rz * sd * 0.15 * S + fz * 0.2 * S,
          0.075 * S, 0.085 * S, 0.06 * S, face);
      }
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
    /** Everything always drawn: trees, roots, ruins, the lake, the light. */
    this.big = new THREE.Group();
    this.root.add(this.big);
    /** Floor detail, per cell, shown by distance. */
    this.cells = new Map();
    this.cellGroup = new THREE.Group();
    this.root.add(this.cellGroup);
    this.owned = [];
    this.at = null;
    this.wakeAt = null;
    this.critters = null;
    this.motes = null;
    this.flies = null;
    this.wings = null;
    this.petals = null;
    /** The hanging moss: one instanced mesh, and the sway data for it. */
    this.curtains = null;
    this.falls = [];
    this.pedestal = null;
    /** The path network: a list of polylines, plus a lookup grid. */
    this.paths = [];
    this._pathGrid = new Map();
    this._pathG = 32;
    this._shown = new Set();
  }

  _lam(color, extra) {
    const m = new THREE.MeshLambertMaterial(
      Object.assign({ color }, extra || {}));
    this.owned.push(m);
    return m;
  }

  _solid(x, y, z, hx, hy, hz, tag) {
    this.realm.collision.addBox(x, y, z, hx, hy, hz, tag);
  }

  _gy(x, z) { return this.realm.heightAt(x, z); }

  // ------------------------------------------------------------ the gradient

  /**
   * HOW DEAD IT IS HERE. 0 in the heart of the wood, 1 at the treeline.
   *
   * The middle sixty per cent is the wood in the reference paintings: green,
   * gold, loud with things growing, sun coming down in shafts. The outer
   * forty is the OTHER reference: bare branches, grey bark, no undergrowth,
   * cold blue fog, and mossy arches standing in it.
   *
   * That is not decoration. It is the first thing the game tells the player
   * about the state of the country, and it tells them without a word: this
   * place is alive at the centre and dying at the edges, and whatever is
   * doing it is coming inward.
   */
  wither(x, z) {
    const dx = x - this.at.x, dz = z - this.at.z;
    const r = Math.hypot(dx, dz) / WOOD_R;
    // Scaled with the wood: the noise has to have a wavelength comparable
    // to the wood's own size or the boundary is either a perfect ring or a
    // grey mush.
    const edge = 0.56 + this.noise.fbm(x * 0.0055, z * 0.0055, 2) * 0.18;
    return smoothstep(clamp((r - edge) / (1.02 - edge), 0, 1));
  }

  /** A colour, desaturated and cooled toward the blight. */
  _fade(hex, w, dead = 0x6b7078) {
    if (w <= 0.001) return hex;
    _c.setHex(hex).lerp(_cd.setHex(dead), w * 0.88);
    return _c.getHex();
  }

  // -------------------------------------------------------------- the paths

  /**
   * THE PATH NETWORK, and it is built before anything else.
   *
   * Eight ways out of the glade and two rings joining them, all of them
   * wandering rather than straight. Everything in the wood is then placed
   * AGAINST this: no tree, boulder, log or ruin may stand within
   * `PATH_CLEAR` of a path's middle, and the undergrowth thins out within
   * `PATH_BARE` of it.
   *
   * This is the fix for a wood that was, in the user's words, basically
   * impossible to walk. A forest scattered uniformly has no lines through
   * it, and a player in one is permanently wedged between two trunks. A
   * forest built round paths has somewhere to go from anywhere in it, and
   * the paths are what the player follows to find the rest of it.
   */
  _makePaths() {
    const R = this.rnd;
    const P = [];

    /** One wandering line from a to b, as a polyline. */
    const wander = (x0, z0, x1, z1, amp) => {
      const pts = [];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(4, Math.round(len / 20));
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
      const ph = R() * 6, ph2 = R() * 6;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        // Two sines of different wavelength — one long curve, one wobble —
        // and both zeroed at the ends, so paths actually meet what they
        // are supposed to join.
        const bend = Math.sin(t * Math.PI)
          * (Math.sin(t * 2.1 + ph) * amp + Math.sin(t * 5.7 + ph2) * amp * 0.35);
        pts.push({
          x: lerp(x0, x1, t) + nx * bend,
          z: lerp(z0, z1, t) + nz * bend,
        });
      }
      return pts;
    };

    // ---- eight spokes out of the glade ----
    const SPOKES = 8;
    const ends = [];
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2 + R() * 0.18;
      const r = WOOD_R * (0.94 + R() * 0.1);
      ends.push({ a, ex: this.at.x + Math.cos(a) * r,
        ez: this.at.z + Math.sin(a) * r });
      P.push(wander(
        this.at.x + Math.cos(a) * GLADE_R * 0.5,
        this.at.z + Math.sin(a) * GLADE_R * 0.5,
        ends[i].ex, ends[i].ez, 26));
    }

    /**
     * TWO RINGS, at a third and two thirds out.
     *
     * Without them the wood is a star and every journey goes through the
     * glade. With them it is a network, which is what makes exploring it
     * feel like exploring rather than like walking up and down spokes.
     */
    for (const frac of [0.34, 0.68]) {
      for (let i = 0; i < SPOKES; i++) {
        const a0 = ends[i].a;
        const a1 = ends[(i + 1) % SPOKES].a
          + (i === SPOKES - 1 ? Math.PI * 2 : 0);
        const r = WOOD_R * frac;
        P.push(wander(
          this.at.x + Math.cos(a0) * r, this.at.z + Math.sin(a0) * r,
          this.at.x + Math.cos(a1) * r, this.at.z + Math.sin(a1) * r, 14));
      }
    }
    this.paths = P;
    this._indexPaths();
  }

  /**
   * A LOOKUP GRID FOR THE PATH SEGMENTS.
   *
   * `pathDist` is asked about forty thousand times during the build, once
   * per thing that might grow somewhere, and there are several hundred
   * segments. Testing every segment every time is nine million distance
   * calculations and it was a visible hitch in the loading bar. Bucketing
   * the segments into a coarse grid makes it a handful each.
   */
  _indexPaths() {
    const G = 32;
    this._pathG = G;
    this._pathGrid.clear();
    for (const line of this.paths) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z };
        // Every cell the segment's bounding box touches, plus a margin so a
        // query just outside the box still finds it.
        const pad = PATH_BARE + 4;
        const x0 = Math.floor((Math.min(a.x, b.x) - pad) / G);
        const x1 = Math.floor((Math.max(a.x, b.x) + pad) / G);
        const z0 = Math.floor((Math.min(a.z, b.z) - pad) / G);
        const z1 = Math.floor((Math.max(a.z, b.z) + pad) / G);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            const k = `${cx},${cz}`;
            let list = this._pathGrid.get(k);
            if (!list) { list = []; this._pathGrid.set(k, list); }
            list.push(seg);
          }
        }
      }
    }
  }

  /** Distance from (x,z) to the nearest path, or Infinity if far away. */
  pathDist(x, z) {
    const G = this._pathG;
    const list = this._pathGrid.get(
      `${Math.floor(x / G)},${Math.floor(z / G)}`);
    if (!list) return Infinity;
    let best = Infinity;
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const px = s.ax + dx * t, pz = s.az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) best = d;
    }
    return best;
  }

  /** Is this spot on a path, or close enough that it must be kept clear? */
  onPath(x, z, margin = PATH_CLEAR) { return this.pathDist(x, z) < margin; }

  /**
   * IS SOMETHING ALREADY HERE?
   *
   * Asked by every placement pass in the wood. A village, a shrine, a boss
   * arena or a landmark inside the treeline gets a clearing round it and
   * nothing of the forest is built there — no tree, no undergrowth, no
   * ruin, no fog.
   *
   * `taken` rather than "occupied" because it is asked thirty-four thousand
   * times and reads better at the call sites than the alternative.
   */
  taken(x, z) {
    const K = this.keepOut;
    if (!K) return false;
    for (let i = 0; i < K.length; i++) {
      const k = K[i];
      const dx = k.x - x, dz = k.z - z;
      if (dx * dx + dz * dz < k.r * k.r) return true;
    }
    return false;
  }

  /**
   * A spot BESIDE a path, between `lo` and `hi` metres from it.
   *
   * Used to place the things the player is meant to notice — creatures, the
   * swarms, the ruins — where they will actually be seen. Sampled by
   * rejection, which is fine: a few hundred tries at build time.
   */
  nearPath(rnd, lo, hi) {
    for (let i = 0; i < 400; i++) {
      const a = rnd() * Math.PI * 2;
      const r = GLADE_R + Math.sqrt(rnd()) * (WOOD_R * 0.72 - GLADE_R);
      const x = this.at.x + Math.cos(a) * r;
      const z = this.at.z + Math.sin(a) * r;
      const d = this.pathDist(x, z);
      if (d >= lo && d <= hi) return { x, z };
    }
    return { x: this.at.x + GLADE_R, z: this.at.z };
  }

  // ------------------------------------------------------------ the cells

  /** The floor cell for a world position, made on demand. */
  _cell(x, z) {
    const cx = Math.floor((x - this.at.x) / CELL);
    const cz = Math.floor((z - this.at.z) / CELL);
    const k = `${cx},${cz}`;
    let c = this.cells.get(k);
    if (!c) {
      const g = new THREE.Group();
      g.visible = false;
      this.cellGroup.add(g);
      c = {
        key: k, cx, cz, group: g,
        b: {
          blade: new Batch(this.geo.blade, this.mats.moss),
          cone: new Batch(this.geo.cone, this.mats.leaf),
          cap: new Batch(this.geo.cap, this.mats.fung),
          /**
           * THE PAVING IS FLOOR DETAIL, and it lives in the cells.
           *
           * Five thousand paving stones at forty triangles each is two
           * hundred thousand triangles, and having them in the
           * always-drawn group meant every square metre of path in a
           * nine-hundred-metre wood was submitted from anywhere in the
           * Lily Reach. It is the single largest thing in the wood and it
           * is only ever visible under the player's feet.
           */
          disc: new Batch(this.geo.disc, this.mats.dirt),
        },
      };
      this.cells.set(k, c);
    }
    return c;
  }

  buildTasks() {
    const out = [
      ['Finding the wood', () => {
        /**
         * PINNED, NOT SEARCHED FOR.
         *
         * `Realm.placeSpot` looks up to four hundred and eighty metres from
         * its hint for level ground, which is right for a shrine and
         * completely wrong for this: the wood's position was chosen by
         * searching the whole region for somewhere that clears every site
         * in the country, and letting the placer wander half a kilometre
         * from it put Croakhollow back inside the forest.
         *
         * So the hint is used as given, and only nudged if it happens to be
         * wet — a short spiral, tens of metres, not hundreds.
         */
        let px = WOOD_AT.x, pz = WOOD_AT.z;
        if (this._gy(px, pz) < SEA + 1.2) {
          for (let ring = 1; ring <= 5; ring++) {
            let done = false;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              const tx = WOOD_AT.x + Math.cos(a) * ring * 12;
              const tz = WOOD_AT.z + Math.sin(a) * ring * 12;
              if (this._gy(tx, tz) >= SEA + 1.2) {
                px = tx; pz = tz; done = true; break;
              }
            }
            if (done) break;
          }
        }
        this.at = { x: px, y: this._gy(px, pz), z: pz };
        /**
         * EVERYTHING ALREADY HERE, so the wood can grow around it.
         *
         * Collected once from the region tables — sites, boss arenas and
         * landmarks within reach of the treeline — and consulted by every
         * placement pass. See `SITE_ROOM`.
         */
        this.keepOut = [];
        for (const reg of REGIONS) {
          for (const s of reg.sites || []) {
            this.keepOut.push({ id: s.id, x: s.at[0], z: s.at[1],
              r: (s.r || 20) + SITE_ROOM });
          }
          for (const b of reg.bosses || []) {
            this.keepOut.push({ id: 'boss:' + b.id, x: b.at[0], z: b.at[1],
              r: (b.arena || b.r || 40) + SITE_ROOM });
          }
          if (reg.landmark) {
            this.keepOut.push({ id: 'landmark:' + reg.id,
              x: reg.landmark.at[0], z: reg.landmark.at[1], r: 46 + SITE_ROOM });
          }
        }
        // Only the ones that could possibly matter.
        this.keepOut = this.keepOut.filter((k) =>
          Math.hypot(k.x - this.at.x, k.z - this.at.z) < WOOD_R + k.r + 40);
        this.wakeAt = {
          x: this.at.x - 13, z: this.at.z + 9,
          y: this._gy(this.at.x - 13, this.at.z + 9),
        };
        const white = 0xffffff;
        this.mats = {
          bark: this._lam(white), leaf: this._lam(white),
          moss: this._lam(white), stone: this._lam(white),
          fung: this._lam(white), dirt: this._lam(white),
        };
        this.geo = {
          trunk: new THREE.CylinderGeometry(0.72, 1, 1, 9),
          limb: new THREE.CylinderGeometry(0.5, 1, 1, 6),
          /**
           * Six by four, not seven by five.
           *
           * A canopy clump is a twenty-metre blob of leaves seen from
           * underneath, and a moss patch is a smear on a root. There are
           * seventeen hundred of the first and seven hundred of the second,
           * so the two segments this drops are worth seventy thousand
           * triangles across the wood and are not visible in either.
           */
          blob: new THREE.SphereGeometry(1, 6, 4),
          low: new THREE.SphereGeometry(1, 4, 3),
          cone: new THREE.ConeGeometry(1, 1, 5),
          blade: new THREE.BoxGeometry(1, 1, 1),
          rock: new THREE.IcosahedronGeometry(1, 0),
          slab: new THREE.BoxGeometry(1, 1, 1),
          cap: new THREE.SphereGeometry(1, 7, 4),
          disc: new THREE.CylinderGeometry(1, 1, 1, 10),
        };
        this.b = {
          trunk: new Batch(this.geo.trunk, this.mats.bark),
          limb: new Batch(this.geo.limb, this.mats.bark),
          blob: new Batch(this.geo.blob, this.mats.leaf),
          low: new Batch(this.geo.low, this.mats.moss),
          rock: new Batch(this.geo.rock, this.mats.stone),
          slab: new Batch(this.geo.slab, this.mats.stone),
          disc: new Batch(this.geo.disc, this.mats.dirt),
        };
      }],
      ['Cutting the paths', () => { this._makePaths(); this._pave(); }],
      ['Raising the great trees', () => this._trees()],
      ['Filling the wood', () => this._smallTrees()],
      ['Laying the roots', () => this._roots()],
      ['Dropping the deadwood', () => this._deadwood()],
      ['Digging the lake', () => this._lake()],
      ['Losing the ruins', () => this._ruins()],
      ['Hollowing the great stump', () => this._stump()],
      ['Setting the emperor stone', () => this._pedestalStone()],
      ['Letting the light in', () => this._light()],
    ];
    /**
     * The floor, in four passes.
     *
     * Thirty-four thousand instances is too much to place in one frame — it
     * was a visible stall in the loading bar — so it is quartered by angle
     * and each quarter is its own step.
     */
    for (let q = 0; q < 4; q++) {
      out.push([`Growing the undergrowth (${q + 1}/4)`, () => this._floor(q)]);
    }
    out.push(['Waking the wood', () => {
      this._alive();
      for (const k in this.b) {
        this.b[k].build(this.big,
          k === 'trunk' || k === 'limb' || k === 'slab' || k === 'rock');
      }
      for (const [, c] of this.cells) {
        for (const k in c.b) c.b[k].build(c.group, false);
      }
    }]);
    return out;
  }

  build() { for (const [, fn] of this.buildTasks()) fn(); return this; }

  /**
   * How many things are growing on the floor, and in how many cells.
   *
   * Read by the cost checks. The floor lives in per-cell batches so there
   * is no single list to measure, and "how much is in this wood" is a
   * question worth being able to answer in one call.
   */
  floorCount() {
    let n = 0;
    const kinds = {};
    for (const [, c] of this.cells) {
      for (const k in c.b) {
        n += c.b[k].items.length;
        kinds[k] = (kinds[k] || 0) + c.b[k].items.length;
      }
    }
    return { total: n, cells: this.cells.size, kinds };
  }

  /** Every floor item in the wood, flattened. Only for the tests. */
  floorItems(kind) {
    const out = [];
    for (const [, c] of this.cells) {
      if (kind) { if (c.b[kind]) out.push(...c.b[kind].items); continue; }
      for (const k in c.b) out.push(...c.b[k].items);
    }
    return out;
  }

  /**
   * THE PAVING.
   *
   * Worn earth and trodden leaf along every path, laid as individual discs
   * at their own ground height so it follows the terrain exactly. This is
   * the only reason a player can tell where a path goes, and it is what
   * turns nine hundred metres of trees into somewhere with a route through
   * it.
   */
  _pave() {
    const R = this.rnd;
    for (const line of this.paths) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i], b = line[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(2, Math.round(len / 1.8));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const x = lerp(a.x, b.x, t) + (R() - 0.5) * PATH_W * 0.9;
          const z = lerp(a.z, b.z, t) + (R() - 0.5) * PATH_W * 0.9;
          const w = this.wither(x, z);
          const s = 1.6 + R() * 1.9;
          const B = this._cell(x, z).b;
          B.disc.add(x, this._gy(x, z) - 0.08, z, s, 0.3, s,
            this._fade(R() < 0.55 ? 0x8a7250 : 0x6f5c40, w * 0.7, 0x7a7d84),
            R() * 3);
          if (R() < 0.28) {
            B.disc.add(x, this._gy(x, z) + 0.06, z, 0.5 + R() * 0.5, 0.05,
              0.7 + R() * 0.5,
              this._fade([0xd8a05a, 0xb99a5a, 0x8fc44a][Math.floor(R() * 3)],
                w * 0.8, 0x8a8f96), R() * 3);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------- the trees

  /**
   * FORTY COLOSSAL TREES.
   *
   * Twenty metres through the base, over a hundred tall, and every one of
   * them at least thirteen metres clear of a path. The scale is the point
   * and it is not subtle: the player is meant to look up.
   */
  _trees() {
    const R = this.rnd;
    const B = this.b;
    this.trees = [];
    const WANT = 44;
    /**
     * THE FIRST NINE STAND ROUND THE GLADE.
     *
     * Deliberately, and it is the most important placement decision in the
     * wood. Forty trees scattered over four hundred and fifty metres leaves
     * the clearing you wake up in standing in open ground — which is a
     * field, not a cathedral. So nine of them are placed in a ring just
     * outside the glade, close enough that their limbs reach in and their
     * canopies meet overhead, and the light comes down through the gaps in
     * separate shafts.
     *
     * That is the shot the whole location is built for, and it is the first
     * thing the player sees when they stand up.
     */
    const RING = 9;
    for (let slot = 0; slot < RING; slot++) {
      /**
       * One slot at a time, with its own budget of tries.
       *
       * The angle has to come from the SLOT rather than from how many trees
       * have been placed so far: deriving it from `trees.length` meant that
       * if the first slot's angle happened to land on a path, every
       * subsequent try used the same angle and the whole ring silently
       * failed to build. Which it did — the glade ended up with its nearest
       * giant a hundred and eighty metres away.
       */
      const base = (slot / RING) * Math.PI * 2;
      for (let i = 0; i < 24; i++) {
        const a = base + (R() - 0.5) * 0.45;
        const rad = GLADE_R + 6 + R() * 14;
        const x = this.at.x + Math.cos(a) * rad;
        const z = this.at.z + Math.sin(a) * rad;
        if (this.onPath(x, z, PATH_CLEAR + 3)) continue;
        if (this.taken(x, z)) continue;
        if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 22)) continue;
        if (!this._giant(x, z, a, R)) break;
      }
    }
    for (let n = 0; n < WANT * 60 && this.trees.length < WANT; n++) {
      const a = R() * Math.PI * 2;
      const rad = GLADE_R + 30 + Math.sqrt(R()) * (WOOD_R - GLADE_R - 46);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      // Never near a path, and never on top of another giant.
      if (this.onPath(x, z, PATH_CLEAR + 8)) continue;
      if (this.taken(x, z)) continue;
      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 34)) continue;
      this._giant(x, z, a, R);
    }
  }

  /**
   * ONE COLOSSAL TREE. Returns true if it could not be built.
   *
   * Split out of `_trees` so the ring round the glade and the scatter
   * through the wood can share it — they differ only in where they look for
   * somewhere to stand.
   */
  _giant(x, z, a, R) {
    const B = this.b;
    {
      const y = this._gy(x, z);
      if (y < 1) return true;
      const h = 92 + R() * 44;
      const base = 8 + R() * 4.5;
      const lean = (R() - 0.5) * 0.06;
      const w = this.wither(x, z);
      const bark = this._fade(0x574029, w, 0x5f6068);

      let px = x, pz = z, py = y - 2;
      for (let s = 0; s < 5; s++) {
        const r0 = lerp(base, base * 0.3, s / 5);
        const seg = h / 5;
        const nx = px + Math.cos(a) * lean * seg * (s > 1 ? 1 : 0.2);
        const nz = pz + Math.sin(a) * lean * seg * (s > 1 ? 1 : 0.2);
        B.trunk.add((px + nx) * 0.5, py + seg * 0.5, (pz + nz) * 0.5,
          r0, seg * 1.02, r0, bark, a, 0, 0);
        px = nx; pz = nz; py += seg;
      }
      B.trunk.add(x, y + 1, z, base * 1.5, 6, base * 1.5,
        this._fade(0x4a3524, w, 0x53545c));
      if (w < 0.72) {
        B.low.add(x, y + 0.4, z, base * 1.75, 1.6, base * 1.75,
          this._fade(0x3f5c2e, w * 1.3));
      }
      /**
       * The trunk collider is the TRUNK, not the flare.
       *
       * `base * 0.62` rather than `base * 0.9`: the flare at the foot is
       * only two metres tall, and a box the width of it running ninety
       * metres up made every giant into a twenty-five-metre pillar of
       * nothing. That was a large part of why the wood could not be walked.
       */
      this._solid(x, y + h * 0.4, z, base * 0.62, h * 0.4, base * 0.62, 'trunk');

      const limbs = 4 + Math.floor(R() * 3);
      for (let l = 0; l < limbs; l++) {
        const la = R() * Math.PI * 2;
        const lh = y + h * (0.55 + R() * 0.4);
        const len = 22 + R() * 26;
        B.limb.add(px + Math.cos(la) * len * 0.5, lh + len * 0.14,
          pz + Math.sin(la) * len * 0.5, 2.2, len, 2.2, bark,
          la + Math.PI / 2, 0, 1.28);
        const ex = px + Math.cos(la) * len;
        const ez = pz + Math.sin(la) * len;
        if (w < 0.66) {
          for (let k = 0; k < 5; k++) {
            const cs = (13 + R() * 13) * (1 - w * 0.55);
            B.blob.add(ex + (R() - 0.5) * 18, lh + len * 0.3 + (R() - 0.5) * 12,
              ez + (R() - 0.5) * 18, cs, cs * 0.62, cs,
              this._fade(R() < 0.35 ? 0x2f5f27
                : (R() < 0.5 ? 0x3f7a30 : 0x4f8f38), w * 1.5, 0x7a7458));
          }
        } else {
          // A dead limb ends in bare twigs and nothing else, which is the
          // whole silhouette of the misty reference image.
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
      if (w < 0.66) {
        for (let k = 0; k < 4; k++) {
          const cs = (16 + R() * 12) * (1 - w * 0.5);
          B.blob.add(px + (R() - 0.5) * 14, py + 6 + (R() - 0.5) * 10,
            pz + (R() - 0.5) * 14, cs, cs * 0.55, cs,
            this._fade(0x2a5423, w * 1.5, 0x7a7458));
        }
      }
      this.trees.push({ x, z, y, h, base, top: py, w });
      return false;
    }
  }

  /** Four hundred ordinary trees, filling the wood between the giants. */
  _smallTrees() {
    const R = this.rnd;
    const B = this.b;
    this.small = 0;
    for (let n = 0; n < 3200 && this.small < 460; n++) {
      const a = R() * Math.PI * 2;
      const rad = GLADE_R + 8 + Math.sqrt(R()) * (WOOD_R - GLADE_R - 8);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      if (this.onPath(x, z, PATH_CLEAR + 1.4)) continue;
      if (this.taken(x, z)) continue;
      const y = this._gy(x, z);
      if (y < 1) continue;
      if (this.lake
        && Math.hypot(x - this.lake.x, z - this.lake.z) < this.lake.r + 3) continue;
      const h = 20 + R() * 32;
      const tw = 1.3 + R() * 1.7;
      const wi = this.wither(x, z);
      B.trunk.add(x, y + h * 0.5, z, tw, h, tw,
        this._fade(0x4f3a26, wi, 0x64656d), R() * 3);
      if (wi < 0.6) {
        for (let k = 0; k < 3; k++) {
          const cs = (6 + R() * 8) * (1 - wi * 0.5);
          B.blob.add(x + (R() - 0.5) * 7, y + h * (0.8 + R() * 0.3),
            z + (R() - 0.5) * 7, cs, cs * 0.7, cs,
            this._fade(R() < 0.4 ? 0x2f5f27 : 0x467f34, wi * 1.6, 0x7a7458));
        }
      } else {
        for (let k = 0; k < 5; k++) {
          const ba = R() * Math.PI * 2;
          const bl = 3 + R() * 7;
          B.limb.add(x + Math.cos(ba) * bl * 0.4, y + h * (0.55 + R() * 0.45),
            z + Math.sin(ba) * bl * 0.4, 0.34, bl, 0.34,
            this._fade(0x4f3a26, 1, 0x6b6c74),
            ba + Math.PI / 2, 0, 1.0 + R() * 0.5);
        }
      }
      this._solid(x, y + h * 0.4, z, tw * 0.85, h * 0.4, tw * 0.85, 'tree');
      this.small++;
    }
  }

  /**
   * THE ROOTS.
   *
   * Buttresses arching out of each giant and back into the ground. The floor
   * of a wood like this is not flat — it is a mess of things you step over.
   *
   * ── and what changed about them ─────────────────────────────────────────
   * The first version put a solid box on the inner third of every root, five
   * to eight roots a tree. That is forty solid boxes round the foot of each
   * giant, which is not a tree, it is a barricade. Now: any root that would
   * reach a path is simply not built; only the innermost segment is solid at
   * all, and it is tagged `deck` so the character controller lets you STEP
   * onto it rather than walling you off.
   */
  _roots() {
    const R = this.rnd;
    const B = this.b;
    for (const t of this.trees) {
      const n = 5 + Math.floor(R() * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + R() * 0.4;
        const len = t.base * (1.6 + R() * 2.2);
        const tipX = t.x + Math.cos(a) * (t.base * 0.7 + len);
        const tipZ = t.z + Math.sin(a) * (t.base * 0.7 + len);
        /**
         * A root reaches thirty-five metres from its trunk.
         *
         * So a giant standing just outside a village's clearing can still
         * send a buttress into it — which is exactly what happened: one
         * root in the Reed Caves, and nothing else in the whole wood. The
         * TIP is what has to be clear, not the trunk.
         */
        if (this.onPath(tipX, tipZ, PATH_CLEAR)) continue;
        if (this.taken(tipX, tipZ)) continue;
        const thick = 1.3 + R() * 2.0;
        for (let s = 0; s < 3; s++) {
          const f0 = s / 3, f1 = (s + 1) / 3;
          const r0 = t.base * 0.7 + len * f0;
          const r1 = t.base * 0.7 + len * f1;
          const x0 = t.x + Math.cos(a) * r0, z0 = t.z + Math.sin(a) * r0;
          const x1 = t.x + Math.cos(a) * r1, z1 = t.z + Math.sin(a) * r1;
          const h0 = lerp(3.6, 0.2, smoothstep(f0));
          const h1 = lerp(3.6, 0.2, smoothstep(f1));
          const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
          const my = (this._gy(x0, z0) + h0 + this._gy(x1, z1) + h1) * 0.5;
          const segLen = Math.hypot(x1 - x0, z1 - z0);
          const th = thick * (1 - f0 * 0.45);
          const wi = this.wither(mx, mz);
          B.limb.add(mx, my, mz, th, segLen * 1.15, th,
            this._fade(0x4a3524, wi, 0x5f6068),
            Math.atan2(z1 - z0, x1 - x0) + Math.PI / 2, 0,
            Math.PI / 2 - Math.atan2(h1 - h0, segLen));
          if (wi < 0.75) {
            B.low.add(mx, my + th * 0.5, mz, th * 0.95, th * 0.4, segLen * 0.5,
              this._fade(0x3f7a30, wi * 1.3),
              Math.atan2(z1 - z0, x1 - x0) + Math.PI / 2);
          }
          if (s === 0 && th > 1.6) {
            this._solid(mx, my + th * 0.25, mz, th * 0.8, th * 0.6,
              segLen * 0.5, 'deck');
          }
        }
      }
    }
  }

  /** Fallen trunks, with fungus shelves growing off them. */
  _deadwood() {
    const R = this.rnd;
    const B = this.b;
    let made = 0;
    for (let n = 0; n < 600 && made < 46; n++) {
      const a = R() * Math.PI * 2;
      const rad = GLADE_R + 8 + Math.sqrt(R()) * (WOOD_R - GLADE_R - 20);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const len = 14 + R() * 24;
      // Long things need more room: half their length plus the clearance.
      if (this.onPath(x, z, PATH_CLEAR + len * 0.5)) continue;
      if (this.taken(x, z)) continue;
      const y = this._gy(x, z);
      if (y < 1) continue;
      const w = 1.5 + R() * 1.7;
      const dir = R() * Math.PI * 2;
      const wi = this.wither(x, z);
      B.limb.add(x, y + w * 0.8, z, w, len, w,
        this._fade(0x4a3524, wi, 0x5f6068), dir + Math.PI / 2, 0, Math.PI / 2);
      // `deck`, so it is something you climb over rather than a wall.
      this._solid(x, y + w * 0.6, z, w, w * 0.8, len * 0.5, 'deck');
      if (wi < 0.7) {
        B.low.add(x, y + w * 1.5, z, w * 0.9, w * 0.35, len * 0.46,
          this._fade(0x3f7a30, wi * 1.3), dir + Math.PI / 2);
      }
      const shelves = Math.round((3 + Math.floor(R() * 5)) * (1 - wi * 0.7));
      for (let k = 0; k < shelves; k++) {
        const t = (k / Math.max(1, shelves) - 0.5) * len * 0.85;
        const sx = x - Math.sin(dir) * t, sz = z - Math.cos(dir) * t;
        const sd = R() < 0.5 ? 1 : -1;
        const fx2 = sx + Math.cos(dir) * sd * w * 0.7;
        const fz2 = sz - Math.sin(dir) * sd * w * 0.7;
        if (this.onPath(fx2, fz2, PATH_W + 0.4)) continue;
        this._cell(fx2, fz2).b.cap.add(fx2, y + w * (0.9 + R() * 0.6), fz2,
          0.55 + R() * 0.5, 0.16, 0.4 + R() * 0.3,
          this._fade(R() < 0.3 ? 0xf2ecdc : 0xd8a05a, wi, 0xa8a49a), dir);
      }
      if (wi < 0.55 && R() < 0.7) {
        const t = (R() - 0.5) * len * 0.6;
        const sx = x - Math.sin(dir) * t, sz = z - Math.cos(dir) * t;
        const sh = 3 + R() * 4;
        B.trunk.add(sx, y + w * 1.6 + sh * 0.5, sz, 0.3, sh, 0.3, 0x4f3a26);
        for (let k = 0; k < 2; k++) {
          B.blob.add(sx + (R() - 0.5) * 2, y + w * 1.6 + sh,
            sz + (R() - 0.5) * 2, 2.2, 1.5, 2.2, 0x4f8f38);
        }
      }
      made++;
    }
    this.logs = made;
  }

  /**
   * THE LAKE, and the fall that feeds it.
   *
   * A wood this size needs somewhere to arrive at, and water is the oldest
   * answer there is: it is flat, it is bright, and you can see it from a
   * long way off through the trunks. Lily pads on it, because this is a frog
   * game, and a stream coming off a mossy shelf at the far end.
   */
  _lake() {
    const R = this.rnd;
    const B = this.b;
    /**
     * Somewhere that is not already something else.
     *
     * The lake is thirty-four metres across and there is no point putting
     * it on top of a shrine, so it walks round the wood until it finds a
     * clear bearing — see `taken`.
     */
    let a = 1.9, cx = 0, cz = 0;
    for (let i = 0; i < 16; i++) {
      a = 1.9 + i * 0.41;
      const rad = WOOD_R * (0.38 + (i % 3) * 0.08);
      cx = this.at.x + Math.cos(a) * rad;
      cz = this.at.z + Math.sin(a) * rad;
      if (!this.taken(cx, cz) && this._gy(cx, cz) > SEA + 1
        && !this.onPath(cx, cz, 30)) break;
    }
    const cy = this._gy(cx, cz);
    this.lake = { x: cx, z: cz, y: cy, r: 34 };

    const wmat = this._lam(0x4f9fc4, {
      transparent: true, opacity: 0.8, emissive: 0x0d3348,
    });
    const geo = new THREE.CircleGeometry(this.lake.r, 26);
    this.owned.push(geo);
    const m = new THREE.Mesh(geo, wmat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, cy + 0.2, cz);
    m.receiveShadow = true;
    this.big.add(m);

    for (let i = 0; i < 54; i++) {
      const ra = (i / 54) * Math.PI * 2;
      const rr = this.lake.r * (0.98 + R() * 0.14);
      const x = cx + Math.cos(ra) * rr, z = cz + Math.sin(ra) * rr;
      const s = 0.7 + R() * 1.8;
      // The rim stones are the only solid-ish thing here and they still
      // keep off the paths, which run right down to the water.
      if (!this.onPath(x, z, PATH_W + 1.2)) {
        B.rock.add(x, this._gy(x, z) + s * 0.3, z, s, s * 0.7, s,
          0x6f6b62, R() * 3);
      }
      const cell = this._cell(x, z);
      for (let k = 0; k < 4; k++) {
        const h = 1.4 + R() * 1.8;
        const rx = x + (R() - 0.5) * 3, rz = z + (R() - 0.5) * 3;
        if (this.onPath(rx, rz, PATH_W + 0.4)) continue;
        cell.b.blade.add(rx, this._gy(rx, rz) + h * 0.5, rz,
          0.09, h, 0.09, 0x6b8a4a,
          R() * 3, (R() - 0.5) * 0.3, (R() - 0.5) * 0.3);
      }
    }
    for (let i = 0; i < 44; i++) {
      const pa = R() * Math.PI * 2;
      const pr = Math.sqrt(R()) * this.lake.r * 0.85;
      const x = cx + Math.cos(pa) * pr, z = cz + Math.sin(pa) * pr;
      const s = 0.8 + R() * 1.3;
      // Lily pads are floor detail too, so they go in the cells.
      this._cell(x, z).b.disc.add(x, cy + 0.28, z, s, 0.06, s,
        R() < 0.5 ? 0x3f7a30 : 0x4f8f38, R() * 3);
      if (R() < 0.18) B.low.add(x, cy + 0.44, z, 0.24, 0.2, 0.24, 0xf4a0c0);
    }
    // The fall: a mossy shelf with water coming off it.
    const fx = cx + Math.cos(a) * (this.lake.r + 6);
    const fz = cz + Math.sin(a) * (this.lake.r + 6);
    const fy = this._gy(fx, fz);
    for (let i = 0; i < 3; i++) {
      B.slab.add(fx, fy + 1.2 + i * 1.5, fz, 9 - i * 2, 1.6, 7 - i * 1.6,
        0x7a7a70, a);
      B.low.add(fx, fy + 2.1 + i * 1.5, fz, 4.4 - i, 0.5, 3.4 - i, 0x3f7a30, a);
    }
    this._solid(fx, fy + 3, fz, 4.5, 3, 3.5, 'shelf');
    const ftex = fadeTexture('rgba(226,244,255,0.95)', 'rgba(150,196,232,0.7)');
    this.owned.push(ftex);
    ftex.wrapT = THREE.RepeatWrapping;
    ftex.repeat.set(1, 3);
    const fmat = new THREE.MeshBasicMaterial({
      map: ftex, transparent: true, opacity: 0.82, depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.owned.push(fmat);
    const fgeo = new THREE.PlaneGeometry(7, 6.4);
    this.owned.push(fgeo);
    const fall = new THREE.Mesh(fgeo, fmat);
    fall.position.set(fx - Math.cos(a) * 4.4, fy + 3.0, fz - Math.sin(a) * 4.4);
    fall.rotation.y = -a + Math.PI / 2;
    this.big.add(fall);
    this.falls.push({ tex: ftex, speed: 1.1 });
    for (let i = 0; i < 5; i++) {
      B.low.add(fx - Math.cos(a) * 5 + (R() - 0.5) * 4, fy + 0.6,
        fz - Math.sin(a) * 5 + (R() - 0.5) * 4, 2.4, 1.2, 2.4, 0xeaf6ff);
    }
  }

  /**
   * ELEVEN RUINS, out where the wood is dying.
   *
   * Somebody built here a very long time ago and the wood has taken it
   * back. The reference is exact: a mossy arch standing alone in blue fog
   * between bare trees, with blue flowers in the grass in front of it.
   *
   * They are the first environmental storytelling in the game and they are
   * deliberately unexplained — the answer arrives about eight hours later,
   * when the player works out whose empire this was. Placed BESIDE a path
   * so they are walked past rather than stumbled on by luck.
   */
  _ruins() {
    const R = this.rnd;
    const B = this.b;
    let made = 0;
    for (let n = 0; n < 500 && made < 11; n++) {
      const a = R() * Math.PI * 2;
      const rad = WOOD_R * (0.62 + R() * 0.3);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const d = this.pathDist(x, z);
      if (d < PATH_CLEAR + 2 || d > 26) continue;
      if (this.taken(x, z)) continue;
      const y = this._gy(x, z);
      if (y < 1) continue;
      const face = a + Math.PI / 2 + (R() - 0.5) * 0.5;
      const w = 5.2 + R() * 2.4;
      const h = 7 + R() * 3.5;
      const lean = (R() - 0.5) * 0.14;
      for (const sd of [-1, 1]) {
        const px = x + Math.cos(face) * sd * w * 0.5;
        const pz = z + Math.sin(face) * sd * w * 0.5;
        B.slab.add(px, this._gy(px, pz) + h * 0.5 - 0.6, pz,
          1.5, h, 1.5, 0x8b8578, face, 0, lean);
        this._solid(px, this._gy(px, pz) + h * 0.4, pz, 0.8, h * 0.4, 0.8, 'pier');
        B.low.add(px, this._gy(px, pz) + h * 0.4, pz, 0.9, h * 0.3, 0.9, 0x3f7a30);
      }
      const gone = 1 + Math.floor(R() * 3);
      for (let k = 0; k < 5; k++) {
        if (k === gone) continue;
        const t = (k / 4 - 0.5) * Math.PI * 0.86;
        B.slab.add(x + Math.cos(face) * Math.sin(t) * w * 0.5,
          y + h - 0.4 + Math.cos(t) * 1.6,
          z + Math.sin(face) * Math.sin(t) * w * 0.5,
          1.4, 1.5, 1.4, 0x8b8578, face, 0, t * 0.7 + lean);
      }
      B.rock.add(x + Math.cos(face) * w * 0.7, y + 0.7,
        z + Math.sin(face) * w * 0.7, 1.6, 1.1, 1.4, 0x8b8578, R() * 3);
      for (let k = 0; k < 6; k++) {
        const vx = x + Math.cos(face) * -w * 0.5;
        const vz = z + Math.sin(face) * -w * 0.5;
        B.low.add(vx + (R() - 0.5) * 1.2, y + 1 + k * 1.1,
          vz + (R() - 0.5) * 1.2, 0.7, 0.5, 0.7, 0x2f5f27);
      }
      made++;
    }
    this.ruins = made;
  }

  /**
   * THE GREAT STUMP, and you can walk inside it.
   *
   * One of the giants came down a very long time ago and what is left is a
   * hollow shell eighteen metres across with a floor of moss, glowing
   * mushrooms in the dark, and a doorway facing the glade. A wood this large
   * needs INTERIORS — places that are not "more trees" — and this is the
   * cheapest possible one: a ring of wall segments with a gap in it.
   */
  _stump() {
    const R = this.rnd;
    const B = this.b;
    let x = 0, z = 0;
    for (let i = 0; i < 16; i++) {
      const a2 = 4.4 + i * 0.41;
      const rad = WOOD_R * (0.26 + (i % 3) * 0.07);
      x = this.at.x + Math.cos(a2) * rad;
      z = this.at.z + Math.sin(a2) * rad;
      if (!this.taken(x, z) && this._gy(x, z) > SEA + 1
        && !this.onPath(x, z, 14)
        && (!this.lake || Math.hypot(x - this.lake.x, z - this.lake.z) > 60)) break;
    }
    const y = this._gy(x, z);
    this.stump = { x, z, y, r: 9 };
    const SEG = 22;
    // The doorway faces the glade, so it can be found.
    const door = Math.atan2(this.at.z - z, this.at.x - x);
    for (let i = 0; i < SEG; i++) {
      const sa = (i / SEG) * Math.PI * 2;
      const off = Math.abs(Math.atan2(Math.sin(sa - door), Math.cos(sa - door)));
      if (off < 0.34) continue;                     // the way in
      const h = off < 0.9 ? 3 + R() * 2 : 7 + R() * 5;
      const sx = x + Math.cos(sa) * this.stump.r;
      const sz = z + Math.sin(sa) * this.stump.r;
      const sy = this._gy(sx, sz);
      B.limb.add(sx, sy + h * 0.5, sz, 1.7, h, 1.7, 0x4a3524,
        sa + Math.PI / 2, 0, 0);
      B.low.add(sx, sy + h, sz, 1.9, 0.7, 1.9, 0x3f7a30);
      this._solid(sx, sy + h * 0.5, sz, 1.2, h * 0.5, 1.2, 'stump');
    }
    B.disc.add(x, y + 0.1, z, this.stump.r - 0.8, 0.3, this.stump.r - 0.8,
      0x3f5c2e);
    const cell = this._cell(x, z);
    for (let i = 0; i < 24; i++) {
      const ma = R() * Math.PI * 2;
      const mr = R() * (this.stump.r - 1.6);
      const mx = x + Math.cos(ma) * mr, mz = z + Math.sin(ma) * mr;
      // A spoke can run through the stump, and a mushroom in the middle of
      // the road is a mushroom in the middle of the road.
      if (this.onPath(mx, mz, PATH_W + 0.6)) continue;
      const s = 0.3 + R() * 0.5;
      cell.b.cap.add(mx, this._gy(mx, mz) + s * 1.6, mz, s, s * 0.8, s,
        R() < 0.6 ? 0x8fe8ff : 0xa8d4f4);
    }
    this.realm.collision.addAnchor(x, y + 9, z, 2.6);
  }

  /**
   * THE EMPEROR STONE.
   *
   * A mossy dais in the middle of the glade with a carved disc standing on
   * it, and on the disc the same mark that is on the player's clothes. The
   * player wakes up sixteen metres away, looking straight at it.
   */
  _pedestalStone() {
    const B = this.b;
    const x = this.at.x, z = this.at.z;
    const y = this._gy(x, z);
    for (let i = 0; i < 3; i++) {
      B.disc.add(x, y + 0.25 + i * 0.5, z, 5.4 - i * 1.1, 0.5, 5.4 - i * 1.1,
        i === 1 ? 0x7a7a70 : 0x8b8578);
      B.low.add(x + (i - 1) * 1.6, y + 0.5 + i * 0.5, z + (1 - i) * 1.7,
        1.5, 0.24, 1.5, 0x3f7a30);
    }
    B.slab.add(x, y + 2.1, z, 1.9, 1.6, 1.9, 0x8b8578);
    const dy = y + 3.5;
    B.disc.add(x, dy, z, 1.7, 0.34, 1.7, 0xc4bfae, 0, Math.PI / 2, 0);
    /**
     * THE MARK: a ring with a bar across it and three rays over the top.
     *
     * Simple enough to be recognised on a scrap of cloth eight hours later,
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
   * Shafts coming down through gaps in the canopy — most of them ONTO THE
   * PATHS, which is what makes a path look like somewhere to go — and
   * curtains of moss off the great limbs.
   *
   * Every shaft is at 0.09 opacity, anchored to the world rather than to
   * the camera, and tilted so the player walks through them rather than
   * into them. An additive plane at high opacity in front of the camera is
   * what made an earlier build of this game literally unplayable.
   */
  _light() {
    const R = this.rnd;
    const tex = fadeTexture('rgba(226,244,200,0.85)', 'rgba(180,220,150,0.2)');
    this.owned.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.09, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.owned.push(mat);
    const pmat = new THREE.MeshBasicMaterial({
      color: 0xdff4c0, transparent: true, opacity: 0.14, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.owned.push(pmat);
    /**
     * FORTY SHAFTS, IN TWO DRAW CALLS.
     *
     * Instanced rather than one mesh each, and it matters more here than
     * anywhere else in the wood: forty shafts is eighty crossed planes plus
     * forty pools, which as individual meshes was a hundred and twenty draw
     * calls — over a third of everything the wood submitted, for something
     * the player reads as "sunlight". A unit plane scaled per instance
     * gives exactly the same picture for one.
     */
    const sgeo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(sgeo);
    const pgeo = new THREE.CircleGeometry(1, 12);
    this.owned.push(pgeo);
    const shaftB = new Batch(sgeo, mat);
    const poolB = new Batch(pgeo, pmat);
    this.shafts = [];
    for (let i = 0; i < 40; i++) {
      let x, z;
      if (i < 4) {
        // Four in the glade itself, so waking up means waking up in light.
        const a = R() * Math.PI * 2;
        const r = R() * GLADE_R * 0.75;
        x = this.at.x + Math.cos(a) * r;
        z = this.at.z + Math.sin(a) * r;
      } else {
        const s = this.nearPath(R, 0, 3.5);
        x = s.x; z = s.z;
        if (this.wither(x, z) > 0.5) continue;
      }
      const y = this._gy(x, z);
      const w = 7 + R() * 14;
      const h = 70 + R() * 34;
      const spin = R() * 3;
      for (let k = 0; k < 2; k++) {
        shaftB.add(x, y + h * 0.42, z, w, h, 1, 0xffffff,
          spin + k * Math.PI / 2, 0.16 + R() * 0.1, 0.12);
      }
      poolB.add(x, y + 0.08, z, w * 0.5, w * 0.5, 1, 0xffffff,
        0, -Math.PI / 2, 0);
      this.shafts.push({ x, z });
    }
    const sm = shaftB.build(this.big, false);
    if (sm) sm.renderOrder = 3;
    const pm = poolB.build(this.big, false);
    if (pm) pm.renderOrder = 2;

    /**
     * COLD FOG WHERE THE SUN IS NOT.
     *
     * Big, soft, pale-blue billboards lying low between the dead trees. Not
     * additive: additive fog over a dark wood glows, which reads as magic,
     * and this has to read as damp.
     */
    const gtex = glowTexture('rgba(212,232,248,0.55)', 'rgba(186,212,236,0.3)');
    this.owned.push(gtex);
    const gmat = new THREE.MeshBasicMaterial({
      map: gtex, transparent: true, opacity: 0.34, depthWrite: false,
    });
    this.owned.push(gmat);
    const ggeo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(ggeo);
    const G = 420;
    const fog = new THREE.InstancedMesh(ggeo, gmat, G);
    fog.frustumCulled = false;
    fog.renderOrder = 1;
    let fi = 0;
    for (let i = 0; i < G * 4 && fi < G; i++) {
      const a = R() * Math.PI * 2;
      const rad = WOOD_R * (0.5 + R() * 0.62);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      if (this.wither(x, z) < 0.35 || this.taken(x, z)) continue;
      const s = 16 + R() * 34;
      _v.set(x, this._gy(x, z) + 1.5 + R() * 7, z);
      _s.set(s, s * (0.3 + R() * 0.25), 1);
      _m.compose(_v, _q.identity(), _s);
      fog.setMatrixAt(fi++, _m);
    }
    fog.count = fi;
    fog.instanceMatrix.needsUpdate = true;
    this.big.add(fog);
    this.fog = fog;

    // ---- hanging moss ----
    const mtex = fadeTexture('rgba(120,170,90,0.95)', 'rgba(90,140,70,0.55)');
    this.owned.push(mtex);
    const mmat = new THREE.MeshLambertMaterial({
      map: mtex, transparent: true, opacity: 0.9, depthWrite: false,
      side: THREE.DoubleSide, color: 0x9fc47a,
    });
    this.owned.push(mmat);
    /**
     * THE MOSS, ALSO INSTANCED — and it still sways.
     *
     * One InstancedMesh whose matrices are rewritten each frame, rather than
     * eighty meshes each with its own rotation. The sway is two sines and
     * eighty matrix writes, which is nothing, and it is eighty draw calls
     * saved.
     */
    const cgeo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(cgeo);
    const items = [];
    for (const t of this.trees) {
      if (t.w > 0.55) continue;
      const n = 2 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const rad = t.base + 6 + R() * 26;
        const x = t.x + Math.cos(a) * rad;
        const z = t.z + Math.sin(a) * rad;
        if (this.wither(x, z) > 0.6) continue;
        const top = t.y + t.h * (0.5 + R() * 0.35);
        const len = 8 + R() * 20;
        items.push({
          x, z, y: top - len * 0.5,
          w: 2.4 + R() * 3.5, h: len,
          yaw: R() * Math.PI, phase: R() * 6,
        });
      }
    }
    if (items.length) {
      const mesh = new THREE.InstancedMesh(cgeo, mmat, items.length);
      mesh.frustumCulled = false;
      this.big.add(mesh);
      this.curtains = { mesh, items };
    }
  }

  /**
   * THE FLOOR, IN CELLS.
   *
   * Thirty-four thousand growing things, distributed by a noise field so the
   * wood has THICKETS and CLEARINGS, thinned out along the paths so they
   * stay walkable, and thinned further toward the blight so the outer wood
   * is bare. Placed into per-cell instanced meshes so only what is near the
   * player is ever drawn.
   *
   * @param quarter which quarter of the wood, by angle. Four passes so no
   *                single loading step does more than nine thousand.
   */
  _floor(quarter) {
    const R = this.rnd;
    const N = 8600;
    const a0 = (quarter / 4) * Math.PI * 2;
    for (let i = 0; i < N; i++) {
      const a = a0 + R() * (Math.PI / 2);
      const rad = Math.sqrt(R()) * WOOD_R;
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      const y = this._gy(x, z);
      if (y < 0.6) continue;
      // Nothing of the forest grows where somebody already lives.
      if (this.taken(x, z)) continue;
      if (this.lake
        && Math.hypot(x - this.lake.x, z - this.lake.z) < this.lake.r + 1) continue;

      /**
       * THE PATHS ARE KEPT CLEAR, and this is the line that does it.
       *
       * On the paving: nothing at all. Just beside it: thinned smoothly, so
       * the edge of a path is a fray rather than a kerb.
       */
      const pd = this.pathDist(x, z);
      /**
       * `PATH_W + 0.8`, not `PATH_W`.
       *
       * Several of the floor kinds scatter their pieces up to 0.65 metres
       * off the point being tested — a colony of mushrooms, a tuft of three
       * grass blades — so a reject radius equal to the paving still put
       * individual pieces on it. The margin is that offset plus a little.
       */
      const keep = PATH_W + 0.8;
      if (pd < keep) continue;
      if (pd < PATH_BARE && R() > (pd - keep) / (PATH_BARE - keep)) continue;

      const dens = this.noise.fbm(x * 0.02, z * 0.02, 2);
      const inGlade = rad < GLADE_R;
      if (inGlade && R() > 0.3) continue;
      if (rad < 6) continue;
      if (!inGlade && R() > 0.35 + dens * 0.8) continue;

      // And the undergrowth simply stops toward the treeline.
      const w = this.wither(x, z);
      if (w > 0.15 && R() < w * 0.8) continue;

      const B = this._cell(x, z).b;
      const roll = R();
      if (roll < 0.42) {
        const c = this._fade(
          R() < 0.3 ? 0x8fc44a : (R() < 0.6 ? 0x4f8f38 : 0x3f7a30), w, 0x8a7f62);
        for (let k = 0; k < 3; k++) {
          const h = (0.5 + R() * 1.1) * (1 - w * 0.45);
          B.blade.add(x + (R() - 0.5) * 0.5, y + h * 0.5, z + (R() - 0.5) * 0.5,
            0.09, h, 0.09, c, R() * 3,
            (R() - 0.5) * (0.4 + w * 0.8), (R() - 0.5) * (0.4 + w * 0.8));
        }
      } else if (roll < 0.66) {
        if (w > 0.55) {
          // A dead twig, out where nothing ferny grows any more.
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
              z + Math.sin(fa) * 0.5 * s, 0.3 * s, 1.5 * s, 0.3 * s,
              this._fade(R() < 0.4 ? 0x2f5f27 : 0x3f7a30, w * 1.4, 0x8a7f62),
              fa, Math.cos(fa) * 0.5, Math.sin(fa) * 0.5);
          }
        }
      } else if (roll < 0.80) {
        /**
         * FLOWERS — and the one detail the misty reference is built on.
         *
         * Pink, gold and pale blue on a green stalk in the living wood. Out
         * in the blight they are the small BLUE ones scattered through the
         * dead grass in front of the ruined arches, which is the most
         * memorable thing in that image: the only colour left in a place
         * where everything else has gone grey.
         */
        const h = (0.4 + R() * 0.7) * (1 - w * 0.3);
        B.blade.add(x, y + h * 0.5, z, 0.05, h, 0.05,
          this._fade(0x4f8f38, w, 0x7a7458));
        const live = [0xf4a0c0, 0x8fd8f4, 0xf4e6b0, 0xd8b0f4][Math.floor(R() * 4)];
        const dead = R() < 0.75 ? 0x6f9fe0 : 0x9fc4f4;
        B.cap.add(x, y + h + 0.08, z, 0.16 + w * 0.05, 0.1, 0.16 + w * 0.05,
          w > 0.5 ? dead : live);
      } else if (roll < 0.94) {
        const n = 1 + Math.floor(R() * 4);
        for (let k = 0; k < n; k++) {
          const mx = x + (R() - 0.5) * 1.3, mz = z + (R() - 0.5) * 1.3;
          const my = this._gy(mx, mz);
          const s = (0.16 + R() * 0.3) * (1 - w * 0.25);
          B.blade.add(mx, my + s * 1.1, mz, s * 0.3, s * 2.2, s * 0.3,
            this._fade(0xe8dcc0, w * 0.6, 0xb8bcc4));
          const glow = R() < (w > 0.5 ? 0.55 : 0.22);
          B.cap.add(mx, my + s * 2.3, mz, s, s * 0.72, s,
            glow ? (w > 0.5 ? 0xa8d4f4 : 0x8fe8ff)
              : this._fade(R() < 0.5 ? 0xb04a3a : 0xd8a05a, w, 0x9a9488));
        }
      } else {
        /**
         * Stones — the only floor item that can obstruct, so the only one
         * with a clearance test of its own, and it is never given a
         * collider. A boulder you can walk over is far better in a wood
         * than a boulder that stops you dead.
         */
        if (pd < PATH_BARE + 2) continue;
        const s = 0.4 + R() * 1.5;
        B.cap.add(x, y + s * 0.28, z, s, s * 0.55, s * 0.9,
          this._fade(R() < 0.5 ? 0x7a7a70 : 0x5f5b52, w * 0.5, 0x8a8f96),
          R() * 3, R() * 0.4, R() * 0.4);
      }
    }

    // Fallen leaves all over the glade, on the last pass.
    if (quarter === 3) {
      for (let i = 0; i < 300; i++) {
        const a = R() * Math.PI * 2;
        const rad = Math.sqrt(R()) * (GLADE_R + 8);
        const x = this.at.x + Math.cos(a) * rad;
        const z = this.at.z + Math.sin(a) * rad;
        const s = 0.3 + R() * 0.45;
        this._cell(x, z).b.disc.add(x, this._gy(x, z) + 0.04, z,
          s, 0.03, s * 1.3,
          [0xd8a05a, 0xb99a5a, 0x8fc44a, 0xa8845a][Math.floor(R() * 4)], R() * 3);
      }
    }
  }

  /**
   * WHAT MOVES.
   *
   * Spore-light drifting upward, fireflies wandering, butterflies flitting,
   * blue petals falling out in the blight, and forty creatures. All five are
   * instanced and updated by rewriting matrices, so the whole living layer
   * is nine draw calls and allocates nothing per frame.
   *
   * All four swarms follow the PATHS, biased to where the player will
   * actually be. A firefly three hundred metres off the road is a firefly
   * nobody ever sees.
   */
  _alive() {
    const R = this.rnd;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(geo);

    const swarm = (n, tex, opacity, order, place, blending) => {
      this.owned.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity, depthWrite: false,
        blending: blending === undefined ? THREE.AdditiveBlending : blending,
      });
      this.owned.push(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      const items = [];
      for (let i = 0; i < n; i++) items.push(place(R));
      this.big.add(mesh);
      return { mesh, items };
    };

    this.motes = swarm(560,
      glowTexture('rgba(230,255,210,0.95)', 'rgba(160,230,140,0.4)'),
      0.55, 4, (r) => {
        const s = this.nearPath(r, 0, 22);
        return {
          x: s.x, z: s.z, y: r() * 34, s: 0.16 + r() * 0.34,
          rise: 0.4 + r() * 1.1, sway: r() * 6, swayR: 0.3 + r() * 0.8,
        };
      });
    this.motes.top = 36;

    this.flies = swarm(150,
      glowTexture('rgba(255,244,180,1)', 'rgba(255,214,90,0.5)'),
      0.85, 5, (r) => {
        const s = this.nearPath(r, 0, 16);
        return {
          hx: s.x, hz: s.z, hy: 1 + r() * 5, r: 1.5 + r() * 4,
          p: r() * 6, q: r() * 6, sp: 0.3 + r() * 0.6,
          s: 0.2 + r() * 0.22, blink: r() * 6,
        };
      });

    this.wings = swarm(90,
      glowTexture('rgba(255,255,255,0.95)', 'rgba(240,180,220,0.6)'),
      0.9, 4, (r) => {
        const s = this.nearPath(r, 0, 14);
        return {
          hx: s.x, hz: s.z, r: 3 + r() * 9, p: r() * 6,
          sp: 0.5 + r() * 0.7, s: 0.3 + r() * 0.3, bob: r() * 6,
        };
      }, THREE.NormalBlending);

    /**
     * BLUE PETALS, out in the dead part.
     *
     * The counterpart to the butterflies, and lifted straight from the
     * misty reference: little blue flakes drifting low through the grass in
     * front of the ruins. They FALL rather than rise, which is the whole
     * difference in feeling — the glade's motes go up toward the light and
     * these come down.
     */
    const ptex = glowTexture('rgba(200,224,255,0.9)', 'rgba(130,175,235,0.5)');
    this.owned.push(ptex);
    const pmat = new THREE.MeshBasicMaterial({
      map: ptex, transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.owned.push(pmat);
    const P = 300;
    const petals = new THREE.InstancedMesh(geo, pmat, P);
    petals.frustumCulled = false;
    petals.renderOrder = 4;
    const pitems = [];
    for (let i = 0; i < P * 4 && pitems.length < P; i++) {
      const a = R() * Math.PI * 2;
      const rad = WOOD_R * (0.6 + R() * 0.48);
      const x = this.at.x + Math.cos(a) * rad;
      const z = this.at.z + Math.sin(a) * rad;
      if (this.wither(x, z) < 0.4) continue;
      pitems.push({
        x, z, y: R() * 14, s: 0.14 + R() * 0.2,
        fall: 0.5 + R() * 1.0, drift: R() * 6, driftR: 0.6 + R() * 1.4,
      });
    }
    petals.count = pitems.length;
    this.big.add(petals);
    this.petals = { mesh: petals, items: pitems, top: 14 };

    this.critters = new Critters(this.big, this, R, 40);
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

    /**
     * THE FLOOR CELLS.
     *
     * Shown by distance, and this is the whole reason a wood this size is
     * affordable: thirty-four thousand instances exist and about a
     * twentieth of them are ever submitted. Recomputed only when the player
     * moves into a different cell, so this is normally one comparison.
     */
    if (playerPos) {
      const cx = Math.floor((playerPos.x - this.at.x) / CELL);
      const cz = Math.floor((playerPos.z - this.at.z) / CELL);
      if (cx !== this._pcx || cz !== this._pcz) {
        this._pcx = cx; this._pcz = cz;
        const reach = Math.ceil(FLOOR_SHOW / CELL);
        const want = new Set();
        for (let dx = -reach; dx <= reach; dx++) {
          for (let dz = -reach; dz <= reach; dz++) {
            if (Math.hypot(dx, dz) > reach + 0.5) continue;
            want.add(`${cx + dx},${cz + dz}`);
          }
        }
        for (const k of this._shown) {
          if (!want.has(k)) {
            const c = this.cells.get(k);
            if (c) c.group.visible = false;
          }
        }
        for (const k of want) {
          const c = this.cells.get(k);
          if (c) c.group.visible = true;
        }
        this._shown = want;
      }
    }

    if (!near) return;
    const T = this.time;
    for (const f of this.falls) f.tex.offset.y -= f.speed * dt;

    /** Collapse an instance to nothing — how a far swarm member is culled. */
    const hide = (mesh, i) => {
      _m.makeScale(0, 0, 0);
      mesh.setMatrixAt(i, _m);
    };

    const M = this.motes;
    if (M) {
      for (let i = 0; i < M.items.length; i++) {
        const it = M.items[i];
        it.y += it.rise * dt;
        if (it.y > M.top) it.y -= M.top;
        if (playerPos && Math.hypot(it.x - playerPos.x, it.z - playerPos.z) > 150) {
          hide(M.mesh, i); continue;
        }
        _v.set(it.x + Math.sin(T * 0.4 + it.sway) * it.swayR,
          this._gy(it.x, it.z) + it.y,
          it.z + Math.cos(T * 0.33 + it.sway) * it.swayR);
        _m.makeScale(it.s, it.s, 1);
        _m.setPosition(_v);
        M.mesh.setMatrixAt(i, _m);
      }
      M.mesh.instanceMatrix.needsUpdate = true;
    }

    const F = this.flies;
    if (F) {
      for (let i = 0; i < F.items.length; i++) {
        const it = F.items[i];
        if (playerPos && Math.hypot(it.hx - playerPos.x, it.hz - playerPos.z) > 130) {
          hide(F.mesh, i); continue;
        }
        const t = T * it.sp;
        const x = it.hx + Math.sin(t + it.p) * it.r;
        const z = it.hz + Math.sin(t * 1.31 + it.q) * it.r;
        const y = this._gy(x, z) + it.hy + Math.sin(t * 0.7 + it.p) * 0.9;
        // Blinking, as a scale pulse: the mesh has one shared material, so
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

    const W = this.wings;
    if (W) {
      for (let i = 0; i < W.items.length; i++) {
        const it = W.items[i];
        if (playerPos && Math.hypot(it.hx - playerPos.x, it.hz - playerPos.z) > 120) {
          hide(W.mesh, i); continue;
        }
        const t = T * it.sp;
        const x = it.hx + Math.cos(t + it.p) * it.r;
        const z = it.hz + Math.sin(t * 0.83 + it.p) * it.r;
        const y = this._gy(x, z) + 1.4 + Math.sin(t * 2.6 + it.bob) * 0.7;
        const w = it.s * (0.35 + 0.65 * Math.abs(Math.sin(T * 9 + it.p)));
        _v.set(x, y, z);
        _m.makeScale(w, it.s, 1);
        _m.setPosition(_v);
        W.mesh.setMatrixAt(i, _m);
      }
      W.mesh.instanceMatrix.needsUpdate = true;
    }

    const P = this.petals;
    if (P) {
      for (let i = 0; i < P.items.length; i++) {
        const it = P.items[i];
        it.y -= it.fall * dt;
        if (it.y < 0) it.y += P.top;
        if (playerPos && Math.hypot(it.x - playerPos.x, it.z - playerPos.z) > 140) {
          hide(P.mesh, i); continue;
        }
        _v.set(it.x + Math.sin(T * 0.5 + it.drift) * it.driftR,
          this._gy(it.x, it.z) + 0.2 + it.y,
          it.z + Math.cos(T * 0.42 + it.drift) * it.driftR);
        _m.makeScale(it.s, it.s * 0.7, 1);
        _m.setPosition(_v);
        P.mesh.setMatrixAt(i, _m);
      }
      P.mesh.instanceMatrix.needsUpdate = true;
    }

    // The moss curtains sway. One instanced mesh, eighty matrix writes.
    const C = this.curtains;
    if (C && C.mesh) {
      for (let i = 0; i < C.items.length; i++) {
        const it = C.items[i];
        _e.set(0, it.yaw, Math.sin(T * 0.6 + it.phase) * 0.05);
        _q.setFromEuler(_e);
        _v.set(it.x, it.y, it.z);
        _s.set(it.w, it.h, 1);
        _m.compose(_v, _q, _s);
        C.mesh.setMatrixAt(i, _m);
      }
      C.mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.critters) this.critters.update(dt, playerPos);
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.critters) this.critters.dispose();
    for (const k in (this.geo || {})) {
      try { this.geo[k].dispose(); } catch (e) { /* gone */ }
    }
    for (const o of this.owned) {
      if (o && o.dispose) { try { o.dispose(); } catch (e) { /* gone */ } }
    }
    this.owned.length = 0;
    this.curtains = null;
    this.falls.length = 0;
    this.cells.clear();
    this._shown.clear();
  }
}
