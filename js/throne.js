/**
 * THE ASCENDED THRONE — where the last fight happens.
 *
 * Frogath was fought, until now, on the generic arena ring: twenty-odd
 * standing stones in an ash field, which is what every other boss in the
 * game gets. For the frog who threw an emperor off a floating island in
 * heaven, in a game whose whole opening is that island, that is nothing.
 *
 * So he gets his own place, and it is HEAVENLY — because that is where he
 * came from and what he is still trying to be.
 *
 * ── the idea in one line ─────────────────────────────────────────────────
 * He tore a piece of the heavenly island down with him and set his own
 * throne in the middle of it.
 *
 * Which means the arena is a contradiction you can stand in and read: a
 * ring of white marble and gold in the middle of an ash waste, cloud
 * pooling over its rim where there should be dirt, light coming down
 * through it from a sky that is grey everywhere else — and at the north end
 * of it a slab of obsidian with violet in the cracks, with the corruption
 * crawling out of it across the white floor toward you. Heaven, with him
 * sitting in it, spoiling it.
 *
 * ── what is actually built ───────────────────────────────────────────────
 *   floor        1,500-odd marble tiles laid at the terrain's own height, so
 *                the fighting ground is flat because the GROUND is flat, not
 *                because a deck was floated over it
 *   inlay        three gold rings, and the Emperor's own mark at the centre —
 *                the same ring-bar-and-rays that is on the stone in the
 *                Wakewood and on the statue's breast. He is sitting on it.
 *   colonnade    28 marble pillars at the rim, six of them snapped, with an
 *                architrave over the gaps. Every one of them SOLID.
 *   statues      eight frog knights on plinths, facing in, built out of the
 *                same frogbuild.js everything else is — the arena is
 *                watched by the army he betrayed.
 *   heaven       a cloud sea over the rim, light shafts down through it,
 *                three gold rings turning overhead, falls of light off the
 *                edge, and marble fragments in slow orbit
 *   his throne   obsidian, veined violet, at the north end, with the
 *                corruption spreading out of it across the marble
 *
 * ── and it costs almost nothing ──────────────────────────────────────────
 * Everything static is instanced — eight batches for the whole arena. The
 * only per-frame work is four group rotations and one opacity pulse, so the
 * clouds drift, the rings turn, the fragments orbit and the light breathes
 * for about four microseconds a frame. The root hides itself past 420 units.
 */

import * as THREE from '../lib/three.module.js?v=v106';
import { mulberry32, clamp, smoothstep } from './util.js?v=v106';
import { addFrog } from './frogbuild.js?v=v106';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** The marble floor's radius. The boss arena inside it is 72. */
export const THRONE_R = 92;
/** Where the colonnade stands. */
const COLONNADE_R = 88;
/** How far out the cloud sea reaches. Short of Zehl's arena at 170 north. */
const CLOUD_R = 156;
/** How far away the whole thing stops being drawn. */
const SHOW = 420;

/**
 * THE SKY OVER IT.
 *
 * The Ashen Throne is fog at 34 units and a sky the colour of wet slate.
 * That is right for the region and wrong for this: a heavenly arena inside
 * it has to be lit like one, or the marble reads as grey concrete. Blended
 * in over the last hundred and fifty units of the walk, so you SEE the
 * light change as you come up on it, which is the whole announcement that
 * the last fight is here.
 */
export const THRONE_SKY = {
  fogNear: 80, fogFar: 720, fogColor: 0xe4dfd0,
  skyTop: 0x6f9ed0, skyMid: 0xcfe0f0, skyBottom: 0xf8eed6,
  sunColor: 0xfff4dc, sunIntensity: 1.3, ambient: 0xd8e4f4,
};

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

/** A vertical fade, for the light shafts and the falls off the rim. */
function fadeTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, top);
    grad.addColorStop(0.55, bottom);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 64);
  }
  return new THREE.CanvasTexture(c);
}

function lerpHex(a, b, k) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const f = (x, y) => Math.round(x + (y - x) * k);
  return (f(ar, br) << 16) | (f(ag, bg) << 8) | f(ab, bb);
}

export class ThroneArena {
  /**
   * @param scene  where it goes
   * @param realm  for `heightAt` and for the collision world
   * @param at     the arena centre, in world space — the frogath arena's spot
   */
  constructor(scene, realm, at) {
    this.scene = scene;
    this.realm = realm;
    this.at = { x: at.x, y: at.y, z: at.z };
    this.rnd = mulberry32(0x7c0f11);
    this.owned = [];
    this.root = new THREE.Group();
    this.root.name = 'ascended-throne';
    this.root.position.set(at.x, 0, at.z);
    scene.add(this.root);
    /** The groups that move. All four are rotations, and nothing else. */
    this.spin = { clouds: null, shafts: null, rings: null, shards: null };
    this.t = 0;
    this.mats = this._mats();
    this.b = {};
    /** Where Frogath's seat ended up, so the fight can face him at it. */
    this.throneAt = { x: at.x, y: at.y, z: at.z - 66 };
    /** Counted for the cost checks. */
    this.solids = 0;
  }

  _mats() {
    const own = (m) => { this.owned.push(m); return m; };
    const L = (c, opts) => own(new THREE.MeshLambertMaterial(
      Object.assign({ color: c }, opts || {})));
    const shaftTex = own(fadeTexture('rgba(255,246,214,0.55)',
      'rgba(255,238,196,0.16)'));
    const fallTex = own(fadeTexture('rgba(244,250,255,0.62)',
      'rgba(214,236,255,0.10)'));
    return {
      // One white Lambert for everything stone: the per-instance colour does
      // the marble, the obsidian, the gold and the corruption between them.
      stone: L(0xffffff),
      // Cloud is its own material because it is the only transparent thing
      // that also has to take light.
      cloud: L(0xffffff, { transparent: true, opacity: 0.72, depthWrite: false }),
      shaft: own(new THREE.MeshBasicMaterial({
        map: shaftTex, transparent: true, opacity: 0.34, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      })),
      fall: own(new THREE.MeshBasicMaterial({
        map: fallTex, transparent: true, opacity: 0.5, depthWrite: false,
        side: THREE.DoubleSide, fog: false,
      })),
      ring: own(new THREE.MeshBasicMaterial({
        color: 0xffe6a8, transparent: true, opacity: 0.5, fog: false,
      })),
      violet: own(new THREE.MeshBasicMaterial({ color: 0x9f6ce8, fog: false })),
      flame: own(new THREE.MeshBasicMaterial({ color: 0xfff2cf, fog: false })),
    };
  }

  _geo(g) { this.owned.push(g); return g; }

  /** Ground height in the root's own space — the root sits at y 0. */
  _y(lx, lz) {
    return this.realm.heightAt(this.at.x + lx, this.at.z + lz);
  }

  _solid(lx, ly, lz, hx, hy, hz, tag) {
    this.realm.collision.addBox(this.at.x + lx, ly, this.at.z + lz,
      hx, hy, hz, tag || 'stone');
    this.solids++;
  }

  _anchor(lx, ly, lz, r) {
    this.realm.collision.addAnchor(this.at.x + lx, ly, this.at.z + lz, r);
  }

  // ───────────────────────────────────────────────────────────────── build ──

  /** Labelled steps, so the loading bar moves while this goes up. */
  buildTasks() {
    return [
      ['Laying the marble', () => { this._batches(); this._floor(); }],
      ['Inlaying the mark', () => { this._inlay(); this._corruption(); }],
      ['Raising the colonnade', () => { this._colonnade(); this._braziers(); }],
      ['Setting the watch of stone', () => this._statues()],
      ['Letting the light in', () => { this._clouds(); this._light(); }],
      ['Seating him', () => { this._throne(); this._carpet(); this._finish(); }],
    ];
  }

  /**
   * ONE STEP BY NAME.
   *
   * The overworld assembles its whole loading list up front, and this
   * arena cannot exist at that moment: it is built around wherever
   * `placeSpot` actually put the Frogath arena, which is not known until
   * the sites have gone up. So the loader pushes one wrapper per name in
   * `STEPS` and asks for the matching function when the wrapper runs.
   */
  step(label) {
    const t = this.buildTasks().find((x) => x[0] === label);
    return t ? t[1] : null;
  }

  build() { for (const [, fn] of this.buildTasks()) fn(); return this; }

  _batches() {
    const S = this.mats.stone;
    this.b = {
      // A hex tile, so the floor is a mosaic rather than a grid.
      tile: new Batch(this._geo(new THREE.CylinderGeometry(1, 1, 1, 6)), S),
      box: new Batch(this._geo(new THREE.BoxGeometry(1, 1, 1)), S),
      pillar: new Batch(this._geo(new THREE.CylinderGeometry(1, 1, 1, 12)), S),
      // The three the frog builder wants alongside `box`.
      blob: new Batch(this._geo(new THREE.SphereGeometry(1, 8, 6)), S),
      rod: new Batch(this._geo(new THREE.CylinderGeometry(1, 1, 1, 6)), S),
      cone: new Batch(this._geo(new THREE.ConeGeometry(1, 1, 7)), S),
      cloud: new Batch(this._geo(new THREE.SphereGeometry(1, 9, 6)),
        this.mats.cloud),
      /**
       * The two unlit-material batches: brazier flame and the violet in the
       * cracks of his throne.
       *
       * Instanced rather than a mesh each because there are forty-odd of
       * them between the arena and the carpet, and forty draw calls for
       * forty small glowing boxes is half the arena's whole budget spent on
       * the least important thing in it.
       */
      flame: new Batch(this._geo(new THREE.SphereGeometry(1, 7, 5)),
        this.mats.flame),
      violet: new Batch(this._geo(new THREE.BoxGeometry(1, 1, 1)),
        this.mats.violet),
    };
  }

  /**
   * THE FLOOR — marble, laid on the ground rather than over it.
   *
   * A raised deck would have been easier to build and worse to fight on:
   * the player would have to find a way up onto it, the boss's hazards
   * would need their own height, and anybody knocked off the edge would be
   * stuck under it. So the tiles are laid at the TERRAIN's own height, one
   * height sample each. The arena spot was already chosen for being flat —
   * `placeSpot` rejects anything over a 0.30 slope — so a floor that
   * follows the ground is a flat floor, and it is flat for free.
   *
   * Hex tiles on a staggered grid, in four shades of marble picked per
   * tile, with the ones near his throne graded toward ash. Roughly fifteen
   * hundred of them in one draw call.
   */
  _floor() {
    const R = this.rnd;
    const STEP = 4.4;
    const SHADES = [0xe8e4d6, 0xdcd6c4, 0xf0ece0, 0xcfc8b6];
    const rows = Math.ceil(THRONE_R / (STEP * 0.87)) + 1;
    for (let r = -rows; r <= rows; r++) {
      const lz = r * STEP * 0.87;
      const off = (r & 1) ? STEP * 0.5 : 0;
      const cols = Math.ceil(THRONE_R / STEP) + 1;
      for (let c = -cols; c <= cols; c++) {
        const lx = c * STEP + off;
        const d = Math.hypot(lx, lz);
        if (d > THRONE_R) continue;
        /**
         * His end of the floor is going. The marble grades toward ash over
         * the last twenty units before the throne, and a few tiles near it
         * are missing outright, so the corruption reads as damage to the
         * place rather than as decoration on it.
         */
        const near = clamp((-lz - 40) / 26, 0, 1);
        if (near > 0.55 && R() < near * 0.5) continue;
        let col = SHADES[Math.floor(R() * SHADES.length)];
        if (near > 0) col = lerpHex(col, 0x3a3238, near * 0.85);
        // A wider skirt of tile at the very rim, so the edge is not a
        // straight line where the marble stops.
        const y = this._y(lx, lz);
        this.b.tile.add(lx, y + 0.07, lz,
          STEP * 0.60, 0.14 + R() * 0.05, STEP * 0.60, col, R() * 3);
      }
    }
  }

  /**
   * THE GOLD — three rings, and the Emperor's mark at the middle of them.
   *
   * The mark is the same fourteen-piece ring, bar and three rays that is
   * carved on the stone in the Wakewood, inlaid on the statue's breast and
   * stitched on the player's own clothes. Putting it on the floor of the
   * arena, with his chair on top of it, is the only line of dialogue this
   * place needs: he is sitting on your name.
   */
  _inlay() {
    const GOLD = 0xd8ad2e, DIM = 0x9a7c25;
    for (const [rr, w] of [[26, 0.5], [52, 0.7], [74, 1.0]]) {
      const n = Math.round((Math.PI * 2 * rr) / 1.6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
        // The rings tarnish toward his end, like everything else here.
        const near = clamp((-lz - 30) / 40, 0, 1);
        this.b.box.add(lx, this._y(lx, lz) + 0.17, lz,
          1.5, 0.12, w, lerpHex(GOLD, 0x4a4038, near * 0.8), -a);
      }
      void DIM;
    }
    // The mark: a ring nine units across, a bar through it, three rays up.
    const MR = 9;
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const lx = Math.cos(a) * MR, lz = Math.sin(a) * MR;
      this.b.box.add(lx, this._y(lx, lz) + 0.19, lz,
        2.0, 0.16, 1.3, GOLD, -a);
    }
    for (let i = -6; i <= 6; i++) {
      this.b.box.add(i * 1.4, this._y(i * 1.4, 0) + 0.19, 0,
        1.5, 0.16, 1.3, GOLD);
    }
    for (let k = -1; k <= 1; k++) {
      for (let i = 0; i < 7; i++) {
        const lx = k * 3.4 + k * i * 0.5, lz = 2.2 + i * 1.4;
        this.b.box.add(lx, this._y(lx, lz) + 0.19, lz,
          1.2, 0.16, 1.5, GOLD, k * 0.3);
      }
    }
  }

  /**
   * THE CORRUPTION, coming out from under his chair.
   *
   * Sixteen veins of dark stone crawling out of the throne across the white
   * floor, thinning and fading as they go and stopping well short of the
   * middle. They are the arrow that points at him from anywhere in the
   * arena, and they are why the floor reads as HIS rather than as yours.
   */
  _corruption() {
    const R = this.rnd;
    const ORIGIN = -66;
    for (let v = 0; v < 16; v++) {
      const spread = (v / 15 - 0.5) * 2.1;
      let lx = spread * 6, lz = ORIGIN + 6;
      let a = Math.PI * 0.5 + spread * 0.5;
      const len = 30 + R() * 26;
      const n = Math.round(len / 2.2);
      for (let i = 0; i < n; i++) {
        a += (R() - 0.5) * 0.34;
        lx += Math.cos(a) * 2.2;
        lz += Math.sin(a) * 2.2;
        if (Math.hypot(lx, lz) > THRONE_R - 4) break;
        const k = 1 - i / n;
        const w = 0.5 + k * 1.5;
        this.b.box.add(lx, this._y(lx, lz) + 0.2, lz,
          2.6, 0.13, w, lerpHex(0xe8e4d6, 0x2a2028, 0.35 + k * 0.6), a);
        // Every so often a shard of it stands up out of the floor. These
        // ARE solid — the player should have to go round them.
        if (k > 0.45 && R() < 0.10) {
          const h = 1.6 + R() * 3.4;
          const y = this._y(lx, lz);
          this.b.cone.add(lx, y + h * 0.5, lz, 0.7 + R() * 0.5, h,
            0.7 + R() * 0.5, 0x2a2028, R() * 3, (R() - 0.5) * 0.3, 0);
          this._solid(lx, y + h * 0.4, lz, 0.8, h * 0.5, 0.8, 'stone');
        }
      }
    }
  }

  /**
   * THE COLONNADE — and this is the part that also fixes a no-clip.
   *
   * The generic arena's standing stones are deliberately NOT solid, because
   * a ring you cannot leave is a cage. That is the right call for a
   * boundary of loose stones you can see the gaps in. It is the wrong call
   * for a two-metre-thick marble pillar: walking through one of those is
   * exactly the kind of thing the player means when they say "there is a
   * bunch of no-clip stuff which shouldn't be".
   *
   * So every pillar is solid and the GAPS BETWEEN THEM ARE WIDE — twelve
   * units of clear air between one pillar and the next, with the whole
   * south side broken open. You can walk out of here in a dozen places;
   * you just cannot walk through the marble.
   */
  _colonnade() {
    const R = this.rnd;
    const N = 24;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const lx = Math.cos(a) * COLONNADE_R, lz = Math.sin(a) * COLONNADE_R;
      const y = this._y(lx, lz);
      /**
       * Six of them are snapped off. Picked by index rather than at random
       * so the ruin is spread round the ring instead of clumping, and the
       * broken ones are the ones facing the way the player arrives.
       */
      const broken = i % 4 === 1;
      const h = broken ? 5 + R() * 7 : 24 + R() * 4;
      const near = clamp((-lz - 30) / 50, 0, 1);
      const col = lerpHex(0xe8e4d6, 0x4a4048, near * 0.7);
      // Base, shaft, capital.
      this.b.box.add(lx, y + 0.7, lz, 5.0, 1.4, 5.0, lerpHex(col, 0, 0.08), a);
      this.b.pillar.add(lx, y + 1.4 + h * 0.5, lz, 1.9, h, 1.9, col, a);
      if (!broken) {
        this.b.box.add(lx, y + 1.4 + h + 0.8, lz, 5.2, 1.6, 5.2, col, a);
        // Fluting, so a pillar is not a smooth tube.
        for (let f = 0; f < 6; f++) {
          const fa = a + (f / 6) * Math.PI * 2;
          this.b.box.add(lx + Math.cos(fa) * 1.85, y + 1.4 + h * 0.5,
            lz + Math.sin(fa) * 1.85, 0.34, h * 0.96, 0.34,
            lerpHex(col, 0xffffff, 0.18), -fa);
        }
      }
      this._solid(lx, y + 1.4 + h * 0.5, lz, 2.4, h * 0.5 + 1.4, 2.4, 'stone');
      this._anchor(lx, y + 1.4 + h, lz, 2.4);
      /**
       * The architrave. Only spans a gap where BOTH pillars are standing,
       * which means the ring reads as a colonnade that has partly fallen
       * rather than as a fence with pieces missing.
       */
      const j = (i + 1) % N;
      const nb = j % 4 === 1;
      if (!broken && !nb) {
        const a2 = (j / N) * Math.PI * 2;
        const mx = (lx + Math.cos(a2) * COLONNADE_R) * 0.5;
        const mz = (lz + Math.sin(a2) * COLONNADE_R) * 0.5;
        const span = Math.hypot(Math.cos(a2) * COLONNADE_R - lx,
          Math.sin(a2) * COLONNADE_R - lz);
        const my = this._y(mx, mz) + 1.4 + 26;
        this.b.box.add(mx, my, mz, span + 1, 2.2, 3.0,
          lerpHex(col, 0xffffff, 0.1), a + Math.PI / N);
        this.b.box.add(mx, my + 1.6, mz, span + 1, 1.0, 4.2,
          lerpHex(col, 0xffffff, 0.2), a + Math.PI / N);
      }
    }
  }

  /**
   * BRAZIERS at the eight quarters, burning white.
   *
   * White flame, not orange: everything warm in this arena is gold or
   * daylight, and an orange campfire would drag the place back toward the
   * Emberwaste it is standing in.
   */
  _braziers() {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const lx = Math.cos(a) * 68, lz = Math.sin(a) * 68;
      const y = this._y(lx, lz);
      this.b.pillar.add(lx, y + 1.6, lz, 0.9, 3.2, 0.9, 0xdcd6c4);
      this.b.box.add(lx, y + 3.4, lz, 3.0, 0.5, 3.0, 0xd8ad2e, a);
      this.b.blob.add(lx, y + 4.1, lz, 1.5, 1.0, 1.5, 0xe8e4d6);
      this._solid(lx, y + 1.8, lz, 1.1, 1.8, 1.1, 'stone');
      // White flame, in two blobs. Everything warm in this arena is gold or
      // daylight; an orange campfire would drag it back toward the ash.
      for (let k = 0; k < 2; k++) {
        this.b.flame.add(lx, y + 4.7 + k * 1.1, lz,
          1.1 - k * 0.4, 1.5 - k * 0.5, 1.1 - k * 0.4, 0xfff2cf);
      }
    }
  }

  /**
   * EIGHT FROG KNIGHTS IN MARBLE, facing in.
   *
   * The army from the opening cinematic, carved, standing round the edge of
   * the place their commander took for himself. Built out of frogbuild.js
   * at five times scale, in the same four shades as the floor, so they are
   * unmistakably frogs and unmistakably the same frogs.
   *
   * Their plinths are solid; the statues are not. A collider the shape of a
   * nine-metre frog would eat a ninth of the arena, and the fight needs the
   * floor more than the statues need to be bumped into.
   */
  _statues() {
    const R = this.rnd;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8 + 0.39;
      const lx = Math.cos(a) * 78, lz = Math.sin(a) * 78;
      const y = this._y(lx, lz);
      const near = clamp((-lz - 30) / 50, 0, 1);
      const stone = lerpHex(0xdcd6c4, 0x4a4048, near * 0.7);
      // Plinth: two courses, and it is the solid part.
      this.b.box.add(lx, y + 1.1, lz, 8.0, 2.2, 8.0,
        lerpHex(stone, 0, 0.1), a);
      this.b.box.add(lx, y + 2.9, lz, 6.6, 1.6, 6.6, stone, a);
      this._solid(lx, y + 1.9, lz, 4.0, 1.9, 4.0, 'stone');
      /**
       * Facing the middle. `lookYaw` is atan2(from − to) and a model's
       * forward is (−sin y, −cos y), so a statue at (lx, lz) looking at the
       * origin is atan2(lx, lz) — get this backwards and eight statues
       * spend the last fight of the game staring out at the ash.
       */
      const face = Math.atan2(lx, lz);
      addFrog(this.b, {
        x: lx, y: y + 3.7, z: lz, s: 5.0, face,
        skin: stone, belly: lerpHex(stone, 0xffffff, 0.2),
        cloth: lerpHex(stone, 0, 0.12), metal: stone,
        trim: lerpHex(stone, 0xd8ad2e, near > 0.5 ? 0.1 : 0.35),
        outfit: i % 2 ? 'knight' : 'spearman',
        detail: 'full',
        armPose: i % 2 ? 'hold' : 'salute',
        plume: lerpHex(stone, 0x8a2f28, 0.3),
      });
      void R;
    }
  }

  /**
   * THE CLOUD SEA.
   *
   * Over the rim and out, so the marble ring looks like it is floating and
   * the ash waste beyond it is hidden — which is what actually sells the
   * arena as a piece of heaven rather than as a white patch of desert. It
   * stops at 156 units, comfortably short of Zehl's arena to the north, so
   * the previous fight is not staged in fog.
   *
   * Drifted by rotating the group it is in. Two hundred and forty instances
   * and not one matrix rebuilt per frame.
   */
  _clouds() {
    const R = this.rnd;
    const g = new THREE.Group();
    this.root.add(g);
    this.spin.clouds = g;
    for (let i = 0; i < 240; i++) {
      const a = R() * Math.PI * 2;
      const rr = THRONE_R + 2 + R() * (CLOUD_R - THRONE_R);
      const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
      const y = this._y(lx, lz);
      const w = 9 + R() * 20;
      this.b.cloud.add(lx, y + 0.6 + R() * 3.4, lz,
        w, 2.4 + R() * 3.4, w,
        lerpHex(0xf8fbff, 0xd8dfe8, R() * 0.5), R() * 3);
    }
    // And a low veil right at the rim, so the marble's edge is soft.
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2 + R() * 0.06;
      const rr = THRONE_R - 4 + R() * 8;
      const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
      this.b.cloud.add(lx, this._y(lx, lz) + 0.9, lz,
        13 + R() * 10, 1.8, 13 + R() * 10, 0xf6f9ff, R() * 3);
    }
  }

  /**
   * THE LIGHT — shafts down, rings turning, falls off the rim, fragments in
   * orbit. Four groups, four rotations, and that is the whole animation
   * budget of the arena.
   */
  _light() {
    const R = this.rnd;
    const plane = this._geo(new THREE.PlaneGeometry(1, 1));

    /**
     * Nine shafts coming down through the colonnade onto the floor, as
     * eighteen crossed planes in ONE instanced mesh.
     *
     * Instanced rather than eighteen meshes for the same reason the flames
     * are: they are the cheapest thing in the arena to draw and there is no
     * excuse for them being a quarter of its draw calls. The whole set sits
     * inside the group that turns, so they still sweep round.
     */
    const shafts = new THREE.Group();
    this.root.add(shafts);
    this.spin.shafts = shafts;
    const shaftB = new Batch(plane, this.mats.shaft);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      const rr = 16 + R() * 54;
      const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
      const h = 74 + R() * 30;
      const w = 9 + R() * 9;
      for (let k = 0; k < 2; k++) {
        shaftB.add(lx, this._y(lx, lz) + h * 0.45, lz, w, h, 1, 0xffffff,
          k * Math.PI * 0.5 + a);
      }
    }
    this.shaftMesh = shaftB.build(shafts, false);
    if (this.shaftMesh) this.shaftMesh.renderOrder = 4;
    this.shaftCount = shaftB.items.length;

    // Falls of light off the rim, going down into the cloud.
    const fallB = new Batch(plane, this.mats.fall);
    this.falls = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.9;
      const lx = Math.cos(a) * (THRONE_R - 1), lz = Math.sin(a) * (THRONE_R - 1);
      fallB.add(lx, this._y(lx, lz) - 16, lz, 11 + R() * 9, 40, 1, 0xffffff,
        -a + Math.PI * 0.5);
      this.falls.push({ x: lx, z: lz });
    }
    const fm = fallB.build(this.root, false);
    if (fm) fm.renderOrder = 3;

    /**
     * THREE RINGS OVERHEAD, turning on different axes.
     *
     * Straight out of the opening cinematic's sky — they are the visual
     * quote that tells the player, without a word of dialogue, that this
     * place is a piece of the island they were thrown off.
     */
    const rings = new THREE.Group();
    rings.position.y = this._y(0, 0) + 62;
    this.root.add(rings);
    this.spin.rings = rings;
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        this._geo(new THREE.TorusGeometry(1, 0.012 + i * 0.004, 6, 60)),
        this.mats.ring);
      const rr = 52 + i * 22;
      m.scale.set(rr, rr, rr);
      m.rotation.x = Math.PI * 0.5 + (i - 1) * 0.26;
      m.rotation.z = i * 0.5;
      m.userData.spinRate = 0.055 - i * 0.014;
      rings.add(m);
    }

    /**
     * MARBLE FRAGMENTS IN ORBIT.
     *
     * Pieces of the island that came down with it, still going round. In
     * one group, so twenty-two of them cost one rotation a frame.
     */
    const shards = new THREE.Group();
    shards.position.y = this._y(0, 0);
    this.root.add(shards);
    this.spin.shards = shards;
    const frag = new Batch(this._geo(new THREE.BoxGeometry(1, 1, 1)),
      this.mats.stone);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + R() * 0.2;
      const rr = 104 + R() * 46;
      frag.add(Math.cos(a) * rr, 22 + R() * 52, Math.sin(a) * rr,
        5 + R() * 11, 2.4 + R() * 5, 5 + R() * 11,
        lerpHex(0xe8e4d6, 0xa8a294, R() * 0.7),
        R() * 3, (R() - 0.5) * 0.5, (R() - 0.5) * 0.5);
    }
    frag.build(shards, false);
    this.fragBatch = frag;
  }

  /**
   * HIS SEAT.
   *
   * Obsidian, on the gold, at the north end. Everything else in this arena
   * is white and level and symmetrical; this is black, off-square and
   * jagged, and it is the only thing here that was not part of the island.
   *
   * The back and the arms are SOLID. He fights out in front of it, so a
   * collider on the throne is not something the fight can get stuck on,
   * and a slab of obsidian eleven metres tall that the player can walk
   * through is precisely the complaint.
   */
  _throne() {
    const R = this.rnd;
    const OZ = -66;
    const y0 = this._y(0, OZ);
    this.throneAt = { x: this.at.x, y: y0, z: this.at.z + OZ };
    // A dais of three courses, cracked, sitting on the ruined marble.
    for (let i = 0; i < 3; i++) {
      const w = 34 - i * 8;
      this.b.box.add(0, y0 + 0.55 + i * 1.1, OZ, w, 1.1, w * 0.8,
        lerpHex(0x2a2028, 0x4a4048, i * 0.2));
    }
    // Seat, back, arms.
    this.b.box.add(0, y0 + 4.6, OZ, 11, 2.0, 9, 0x241c22);
    this.b.box.add(0, y0 + 9.6, OZ - 4.0, 11, 12.0, 2.2, 0x241c22);
    this._solid(0, y0 + 9.6, OZ - 4.0, 5.5, 6.0, 1.6, 'wall');
    for (const sd of [-1, 1]) {
      this.b.box.add(sd * 5.8, y0 + 6.6, OZ, 1.6, 2.2, 8.0, 0x2a2028);
      this._solid(sd * 5.8, y0 + 6.0, OZ, 0.9, 2.4, 4.0, 'wall');
    }
    this._solid(0, y0 + 3.0, OZ, 6.0, 3.0, 4.6, 'deck');
    /**
     * A crown of shards across the top of the back — deliberately the same
     * seven-point silhouette as the crown in the memories, done in black
     * and broken. He built himself a copy of the thing he could not take.
     */
    for (let i = -3; i <= 3; i++) {
      const h = 5 + (3 - Math.abs(i)) * 3.4;
      this.b.cone.add(i * 1.7, y0 + 15.6 + h * 0.5, OZ - 4.0,
        0.7, h, 0.7, 0x241c22, 0, (R() - 0.5) * 0.12, i * 0.06);
    }
    // The violet in the cracks. An unlit material, so it glows in the fog.
    for (let i = 0; i < 14; i++) {
      this.b.violet.add((R() - 0.5) * 10, y0 + 5.4 + R() * 9.4, OZ - 2.8,
        0.3 + R() * 0.4, 1.6 + R() * 4.0, 0.3, 0x9f6ce8,
        0, 0, (R() - 0.5) * 0.9);
    }
    this._anchor(0, y0 + 16, OZ - 4, 3.0);
  }

  /**
   * ═══ THE RED CARPET ══════════════════════════════════════════════════════
   *
   * Built now and hidden until it is wanted. It runs from the Emperor's mark
   * at the middle of the arena — where he goes down — south, straight out
   * through the broken side of the colonnade and on for thirty units past
   * it, and the player walks it after the coronation with their dash, their
   * grapple and their sprint taken away. See js/coronation.js.
   *
   * SOUTH deliberately. That is the side of the ring that is smashed open
   * and it is the side the player walked in from, so the last thing they do
   * in the game is walk back out the way they came, on a carpet, past the
   * statues, with a crown on.
   *
   * A hundred and twenty metres of it. Long enough to be a procession at
   * walking pace — a bit over a minute — and short enough that the player
   * is never wondering whether the game has stopped working.
   */
  _carpet() {
    const g = new THREE.Group();
    g.visible = false;
    this.root.add(g);
    this.carpetGroup = g;
    const START_Z = 0, END_Z = 122;
    const W = 6.0;
    const cloth = new Batch(this._geo(new THREE.BoxGeometry(1, 1, 1)),
      this.mats.stone);
    const flame = new Batch(this._geo(new THREE.SphereGeometry(1, 7, 5)),
      this.mats.flame);
    const STEP = 3.0;
    for (let z = START_Z; z <= END_Z; z += STEP) {
      const y = this._y(0, z);
      // Alternating weft, so a hundred and twenty metres of red is not one
      // flat stripe.
      cloth.add(0, y + 0.24, z, W, 0.16, STEP, (z / STEP) & 1 ? 0x8a2f28 : 0x7d2824);
      for (const sd of [-1, 1]) {
        cloth.add(sd * (W * 0.5 - 0.42), y + 0.28, z, 0.55, 0.2, STEP, 0xd8ad2e);
      }
      /**
       * A brazier every fifteen metres down one side and then the other, so
       * the walk has a rhythm to it and the player can see how much is left.
       */
      if (z > 4 && Math.abs(z % 15) < STEP * 0.5) {
        const sd = ((z / 15) | 0) % 2 ? 1 : -1;
        const bx = sd * 6.2;
        const by = this._y(bx, z);
        cloth.add(bx, by + 1.5, z, 0.9, 3.0, 0.9, 0xdcd6c4);
        cloth.add(bx, by + 3.2, z, 2.4, 0.4, 2.4, 0xd8ad2e);
        // The carpet's own flame batch, built into the carpet's group —
        // otherwise eight burning braziers would be hanging in the arena
        // for the whole game before the carpet is ever rolled out.
        flame.add(bx, by + 4.2, z, 1.0, 1.4, 1.0, 0xfff2cf);
      }
    }
    cloth.build(g, false);
    flame.build(g, false);
    this.carpetBatch = cloth;
    /**
     * The two ends, in WORLD space, for the walk to measure against.
     *
     * `from` is a couple of units up the carpet rather than exactly on the
     * mark: the player is put down facing along it, and standing precisely
     * on the end tile makes the first step ambiguous.
     */
    this.carpetFrom = { x: this.at.x, y: this._y(0, 3), z: this.at.z + 3 };
    this.carpetTo = { x: this.at.x, y: this._y(0, END_Z), z: this.at.z + END_Z };
    this.carpetWidth = W;
  }

  /** Roll it out (or take it away). Nothing else in the arena changes. */
  showCarpet(on) {
    if (this.carpetGroup) this.carpetGroup.visible = !!on;
  }

  _finish() {
    // The floor and the inlay do not cast: a thousand-instance shadow pass
    // over a flat floor buys nothing and costs the whole frame.
    this.b.tile.build(this.root, false);
    this.b.cloud.build(this.root, false);
    this.b.flame.build(this.root, false);
    this.b.violet.build(this.root, false);
    for (const k of ['box', 'pillar', 'blob', 'rod', 'cone']) {
      this.b[k].build(this.root, true);
    }
    /**
     * ITS OWN LIGHT.
     *
     * The Ashen Throne's sun is at half intensity behind ash. Marble under
     * that reads as wet concrete, so the arena carries a light of its own —
     * enabled only when the player is close, because a second directional
     * light across the whole map costs a shadow pass nobody sees.
     */
    this.lamp = new THREE.DirectionalLight(0xfff4dc, 0.85);
    this.lamp.position.set(this.at.x - 40, 160, this.at.z + 60);
    this.lamp.visible = false;
    this.scene.add(this.lamp);
    this.fill = new THREE.HemisphereLight(0xdfe8f8, 0x9a968a, 0.55);
    this.fill.position.set(this.at.x, this._y(0, 0) + 40, this.at.z);
    this.fill.visible = false;
    this.scene.add(this.fill);
    this.root.visible = false;
  }

  // ───────────────────────────────────────────────────────────────── frame ──

  /**
   * HOW MUCH OF THIS PLACE YOU ARE IN — 1 inside the colonnade, 0 past 300
   * units, smoothstepped between. Drives the sky blend and the lights, and
   * is the reason walking up on the arena looks like the weather changing.
   */
  insideness(x, z) {
    const d = Math.hypot(x - this.at.x, z - this.at.z);
    if (d <= COLONNADE_R) return 1;
    if (d >= 300) return 0;
    return smoothstep(1 - (d - COLONNADE_R) / (300 - COLONNADE_R));
  }

  /** The region's sky, blended toward heaven by `k`. */
  skyBlend(S, k) {
    const out = Object.assign({}, S);
    const mixN = (a, b) => (a === undefined ? b : a + (b - a) * k);
    const mixC = (a, b) => lerpHex(a === undefined ? b : a, b, k);
    out.fogNear = mixN(S.fogNear, THRONE_SKY.fogNear);
    out.fogFar = mixN(S.fogFar, THRONE_SKY.fogFar);
    out.sunIntensity = mixN(S.sunIntensity, THRONE_SKY.sunIntensity);
    out.fogColor = mixC(S.fogColor, THRONE_SKY.fogColor);
    out.skyTop = mixC(S.skyTop, THRONE_SKY.skyTop);
    out.skyMid = mixC(S.skyMid, THRONE_SKY.skyMid);
    out.skyBottom = mixC(S.skyBottom, THRONE_SKY.skyBottom);
    return out;
  }

  update(dt, px, pz) {
    const d = Math.hypot(px - this.at.x, pz - this.at.z);
    const near = d < SHOW;
    this.root.visible = near;
    const k = this.insideness(px, pz);
    if (this.lamp) { this.lamp.visible = k > 0.02; this.lamp.intensity = 0.85 * k; }
    if (this.fill) { this.fill.visible = k > 0.02; this.fill.intensity = 0.55 * k; }
    if (!near) return;
    this.t += dt;
    // Four rotations and one pulse. That is the entire per-frame cost.
    if (this.spin.clouds) this.spin.clouds.rotation.y += dt * 0.008;
    if (this.spin.shards) this.spin.shards.rotation.y += dt * 0.014;
    if (this.spin.shafts) this.spin.shafts.rotation.y += dt * 0.004;
    if (this.spin.rings) {
      for (const m of this.spin.rings.children) {
        m.rotation.z += dt * (m.userData.spinRate || 0.04);
      }
    }
    if (this.mats.shaft) {
      this.mats.shaft.opacity = 0.28 + Math.sin(this.t * 0.5) * 0.07;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    if (this.lamp) this.scene.remove(this.lamp);
    if (this.fill) this.scene.remove(this.fill);
    for (const o of this.owned) if (o && o.dispose) o.dispose();
    this.owned.length = 0;
    this.b = {};
  }
}

/**
 * The build steps, by name and in order.
 *
 * Declared on the class rather than derived from an instance because the
 * loader needs the list before there is an instance to ask. Kept in step
 * with `buildTasks` by a test, which is the only thing that can keep two
 * lists in the same order honestly.
 */
ThroneArena.STEPS = [
  'Laying the marble',
  'Inlaying the mark',
  'Raising the colonnade',
  'Setting the watch of stone',
  'Letting the light in',
  'Seating him',
];
