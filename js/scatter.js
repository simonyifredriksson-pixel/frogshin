/**
 * What grows on the realm — trees, rocks, reeds, bones — and how it streams.
 *
 * ── the problem ────────────────────────────────────────────────────────────
 * The valley scatters 620 trees and 340 boulders into seven InstancedMeshes,
 * once, at load. That does not survive being made twenty times bigger: the
 * realm's area is 53 times the valley's, so the same density is thirty-odd
 * thousand trees, and they cannot all be resident.
 *
 * The obvious fix — one InstancedMesh per ground tile — trades a memory
 * problem for a draw-call one: ninety-seven live tiles times five kinds of
 * prop is nearly five hundred draws for scenery alone.
 *
 * ── what this does instead ─────────────────────────────────────────────────
 * ONE InstancedMesh per kind of prop, sized once for the worst case, and
 * REFILLED when the player crosses into a new tile. Filling is cheap: every
 * tile's contents are a pure function of its coordinates, so the scatter is
 * regenerated rather than remembered, and the same tile always grows the
 * same trees. Five draw calls, no allocation per tile, and nothing to keep
 * in sync with the ground.
 *
 * Which props a place grows, and how densely, comes from the region table —
 * the Emberwaste burns and the Palewood is bleached, so neither has the
 * Bramblewood's canopy.
 */

import * as THREE from '../lib/three.module.js?v=v81';
import { mulberry32 } from './util.js?v=v81';
import { SEA } from './regions.js?v=v81';
import { CHUNK } from './realm.js?v=v81';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Prop kinds, and what each region grows.
 *
 * `flora` on a region is read from here by id. A region with none listed gets
 * the default mix, so adding a region never means editing this file.
 */
const KINDS = {
  trunk: { geo: () => new THREE.CylinderGeometry(0.42, 0.6, 1, 6), cast: true },
  pine:  { geo: () => new THREE.ConeGeometry(1, 1, 7, 1), cast: false },
  blob:  { geo: () => new THREE.IcosahedronGeometry(1, 0), cast: false },
  rock:  { geo: () => new THREE.DodecahedronGeometry(1, 0), cast: true },
  post:  { geo: () => new THREE.CylinderGeometry(1, 1, 1, 6), cast: false },
  /**
   * Spikes out of the ground: crystal in the Glimmerwood, ice in the
   * Rimefang, cooled obsidian at Cindermaw.
   *
   * One shape for all three because the region's own palette does the rest —
   * the same octahedron is white in the north, blue in the glowing wood and
   * near-black on the volcano, and it is the thing that makes those three
   * places read as different at a glance from inside them.
   */
  shard: { geo: () => new THREE.OctahedronGeometry(1, 0), cast: true },
};

/**
 * How much of each thing a region grows, per tile.
 *
 * Tuned per region rather than globally, because density is most of what
 * makes a place feel like itself: the Bramblewood is impassable with trees
 * and the Frostmarch is bare, and one number each is what says so.
 */
export const FLORA = {
  // ── the south: green, worked, wet ──
  lilyreach:   { conifer: 3,  broad: 6,  rock: 3,  reed: 16, bone: 0,  shard: 0,  crop: 0 },
  harrowmead:  { conifer: 2,  broad: 5,  rock: 3,  reed: 3,  bone: 0,  shard: 0,  crop: 10 },
  whispermire: { conifer: 1,  broad: 1,  rock: 2,  reed: 32, bone: 2,  shard: 0,  crop: 0 },
  hollowroot:  { conifer: 16, broad: 11, rock: 2,  reed: 2,  bone: 0,  shard: 0,  crop: 0 },
  sunkenstair: { conifer: 4,  broad: 3,  rock: 8,  reed: 2,  bone: 0,  shard: 0,  crop: 0 },
  // ── the middle ──
  anurath:     { conifer: 2,  broad: 4,  rock: 6,  reed: 6,  bone: 1,  shard: 0,  crop: 0 },
  quarry:      { conifer: 1,  broad: 1,  rock: 18, reed: 0,  bone: 1,  shard: 0,  crop: 0 },
  glassfen:    { conifer: 2,  broad: 2,  rock: 3,  reed: 22, bone: 1,  shard: 0,  crop: 0 },
  gravewater:  { conifer: 2,  broad: 1,  rock: 3,  reed: 16, bone: 9,  shard: 0,  crop: 0 },
  thirstlands: { conifer: 0,  broad: 0,  rock: 10, reed: 0,  bone: 4,  shard: 2,  crop: 5 },
  choircliffs: { conifer: 5,  broad: 1,  rock: 14, reed: 0,  bone: 1,  shard: 0,  crop: 0 },
  boneflats:   { conifer: 0,  broad: 0,  rock: 6,  reed: 0,  bone: 16, shard: 0,  crop: 0 },
  drownedkeep: { conifer: 3,  broad: 2,  rock: 4,  reed: 14, bone: 2,  shard: 0,  crop: 0 },
  // ── the frontier ──
  emberwaste:  { conifer: 4,  broad: 0,  rock: 10, reed: 0,  bone: 5,  shard: 3,  crop: 0 },
  cindermaw:   { conifer: 0,  broad: 0,  rock: 12, reed: 0,  bone: 2,  shard: 10, crop: 0 },
  spine:       { conifer: 2,  broad: 0,  rock: 10, reed: 0,  bone: 14, shard: 0,  crop: 0 },
  moonshelf:   { conifer: 1,  broad: 0,  rock: 12, reed: 0,  bone: 1,  shard: 5,  crop: 0 },
  palewood:    { conifer: 18, broad: 3,  rock: 2,  reed: 3,  bone: 3,  shard: 0,  crop: 0 },
  // ── the end ──
  hollowcity:  { conifer: 2,  broad: 2,  rock: 9,  reed: 1,  bone: 6,  shard: 0,  crop: 0 },
  glimmerwood: { conifer: 6,  broad: 4,  rock: 4,  reed: 2,  bone: 0,  shard: 12, crop: 0 },
  frostmarch:  { conifer: 5,  broad: 0,  rock: 7,  reed: 0,  bone: 2,  shard: 4,  crop: 0 },
  rimefang:    { conifer: 1,  broad: 0,  rock: 8,  reed: 0,  bone: 1,  shard: 12, crop: 0 },
  sunderway:   { conifer: 1,  broad: 0,  rock: 11, reed: 0,  bone: 3,  shard: 0,  crop: 0 },
  ashenthrone: { conifer: 1,  broad: 0,  rock: 8,  reed: 0,  bone: 10, shard: 4,  crop: 0 },
};
const DEFAULT_FLORA = {
  conifer: 5, broad: 3, rock: 5, reed: 3, bone: 0, shard: 0, crop: 0,
};

export class Scatter {
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.meshes = {};
    this._centre = { ix: 9999, iz: 9999 };
    /**
     * Room reserved per kind.
     *
     * An InstancedMesh cannot grow, so the cap is the budget: whatever the
     * densest region asks for across every visible tile, plus slack. Going
     * over does not corrupt anything — `_emit` simply stops, so the far
     * edge of a very crowded view thins out rather than the game breaking.
     */
    this.caps = {
      trunk: 3400, pine: 5400, blob: 2600, rock: 2800, post: 6000, shard: 3000,
    };
    for (const k in KINDS) {
      const mesh = new THREE.InstancedMesh(
        KINDS[k].geo(), new THREE.MeshLambertMaterial({}), this.caps[k]);
      mesh.castShadow = KINDS[k].cast;
      mesh.receiveShadow = true;
      // The realm streams; a mesh whose contents move every 192 units cannot
      // have its bounds trusted, and re-deriving them every frame is not
      // worth it for five meshes.
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `scatter:${k}`;
      scene.add(mesh);
      this.meshes[k] = mesh;
    }
    this._n = {};
  }

  /** Reserve a slot in a kind's mesh, or refuse when the budget is spent. */
  _emit(kind, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    const mesh = this.meshes[kind];
    const i = this._n[kind] || 0;
    if (i >= this.caps[kind]) return false;
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    mesh.setColorAt(i, _c.setHex(color));
    this._n[kind] = i + 1;
    return true;
  }

  /**
   * Rebuild the visible scatter if the player has changed tile.
   *
   * Returns how many tiles were walked, or 0 when nothing was needed — so it
   * is safe to call every frame and costs a pair of integer compares.
   */
  streamAround(x, z, force = false) {
    const half = this.realm.terrain ? this.realm.terrain.half : 1536;
    const cix = Math.floor((x + half) / CHUNK);
    const ciz = Math.floor((z + half) / CHUNK);
    if (!force && cix === this._centre.ix && ciz === this._centre.iz) return 0;
    this._centre.ix = cix;
    this._centre.iz = ciz;

    for (const k in this.meshes) this._n[k] = 0;

    /**
     * Scatter is drawn closer in than the ground.
     *
     * The ground is cheap per tile and wants to reach the horizon; trees are
     * not, and a tree at the fog line is a smudge. Four tiles is 768 units,
     * past every region's fog except the two clearest.
     */
    const R = 4;
    let tiles = 0;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        tiles += this._fillTile(cix + dx, ciz + dz, half) ? 1 : 0;
      }
    }

    for (const k in this.meshes) {
      const mesh = this.meshes[k];
      mesh.count = this._n[k] || 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    return tiles;
  }

  /**
   * Everything one tile grows.
   *
   * Seeded from the tile's own coordinates, so a tile is identical every time
   * it is walked back into and identical on every machine. That is why the
   * scatter can be thrown away and regenerated instead of stored: there is
   * nothing to store that the coordinates do not already say.
   */
  _fillTile(cx, cz, half) {
    const per = Math.round(half * 2 / CHUNK);
    if (cx < 0 || cz < 0 || cx >= per || cz >= per) return false;
    const x0 = -half + cx * CHUNK, z0 = -half + cz * CHUNK;
    const rnd = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ this.realm.seed);
    const realm = this.realm;

    // Which mix this tile grows, from the region at its middle.
    const region = realm.regionAt(x0 + CHUNK / 2, z0 + CHUNK / 2);
    const mix = FLORA[region.id] || DEFAULT_FLORA;
    const pal = realm.paletteAt(x0 + CHUNK / 2, z0 + CHUNK / 2, this._pal || (this._pal = {}));

    const scatter = (n, place) => {
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
        const y = realm.heightAt(x, z);
        place(x, y, z, rnd);
      }
    };

    // ---- conifers ----
    scatter(mix.conifer, (x, y, z, r) => {
      if (y < SEA + 1.2) return;
      if (realm._slopeAt(x, z) > 0.42) return;
      const sc = 0.8 + r() * 1.0;
      const th = 4.5 * sc, fh = 9 * sc, fr = 2.5 * sc;
      this._emit('trunk', x, y + th / 2, z, 0.55 * sc, th, 0.55 * sc, 0x5a4230);
      for (let k = 0; k < 3; k++) {
        const kt = k / 3;
        this._emit('pine', x, y + th * 0.6 + fh * kt * 0.72 + fh * 0.11, z,
          fr * (1 - kt * 0.3), fh * 0.5, fr * (1 - kt * 0.3),
          _c.copy(pal.grass2).multiplyScalar(0.55 + k * 0.16).getHex(), r() * 3);
      }
    });

    // ---- broadleaf ----
    scatter(mix.broad, (x, y, z, r) => {
      if (y < SEA + 1.2) return;
      if (realm._slopeAt(x, z) > 0.40) return;
      const sc = 0.8 + r() * 0.9;
      const th = 5.5 * sc, cr = 3.0 * sc;
      this._emit('trunk', x, y + th / 2, z, 0.6 * sc, th, 0.6 * sc, 0x6b4f33);
      this._emit('blob', x, y + th + cr * 0.5, z, cr, cr * 0.85, cr,
        _c.copy(pal.grass).multiplyScalar(0.9).getHex(), r() * 3, r(), r());
      this._emit('blob', x + cr * 0.5, y + th + cr * 0.2, z - cr * 0.3,
        cr * 0.62, cr * 0.55, cr * 0.62,
        _c.copy(pal.grass).multiplyScalar(1.05).getHex(), r() * 3);
    });

    // ---- boulders ----
    scatter(mix.rock, (x, y, z, r) => {
      if (y < SEA - 2) return;
      const s = 0.7 + r() * 2.8;
      this._emit('rock', x, y + s * 0.45, z, s, s * 0.75, s * 0.9,
        _c.copy(pal.rock).multiplyScalar(0.85 + r() * 0.3).getHex(),
        r() * 3, r() * 0.4, r() * 0.4);
    });

    // ---- reeds, in and at the waterline ----
    scatter(mix.reed, (x, y, z, r) => {
      if (y > SEA + 1.6 || y < SEA - 3.0) return;
      const h = 1.6 + r() * 3.2;
      this._emit('post', x, y + h * 0.5, z, 0.06, h, 0.06,
        r() < 0.5 ? 0x6a6b45 : 0x565c3c);
    });

    // ---- bones, standing out of the ground ----
    scatter(mix.bone, (x, y, z, r) => {
      if (y < SEA + 0.5) return;
      const h = 1.4 + r() * 4.4;
      this._emit('post', x, y + h * 0.45, z, 0.22 + r() * 0.2, h, 0.22 + r() * 0.2,
        0xcfc7b4, r() * 3, (r() - 0.5) * 0.5, (r() - 0.5) * 0.5);
    });

    /**
     * Shards: crystal, ice or cooled obsidian, depending where you are.
     *
     * Tinted from the region's OWN `high` colour — the one it paints its
     * peaks with — so the same octahedron is white in the Rimefang, pale blue
     * in the Glimmerwood and near-black at Cindermaw without this file
     * knowing which region it is filling. Emitted in pairs, a big one and a
     * lean-to, because a single spike reads as a rock.
     */
    scatter(mix.shard, (x, y, z, r) => {
      if (y < SEA - 1) return;
      // A generous slope limit on purpose: the two regions that grow the most
      // of these are the Rimefang and Cindermaw, both of which are made
      // almost entirely of steep ground. At the trees' 0.42 the Rimefang grew
      // almost nothing, which left the ice range bare.
      if (realm._slopeAt(x, z) > 0.72) return;
      const s = 1.4 + r() * 3.6;
      const col = _c.copy(pal.high).multiplyScalar(0.85 + r() * 0.35).getHex();
      this._emit('shard', x, y + s * 0.9, z, s * 0.5, s * 1.9, s * 0.5,
        col, r() * 3, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3);
      if (r() < 0.7) {
        const t = s * (0.4 + r() * 0.4);
        this._emit('shard', x + s * 0.7, y + t * 0.8, z - s * 0.4,
          t * 0.5, t * 1.7, t * 0.5, col, r() * 3, 0.4, 0.3);
      }
    });

    /**
     * Crops: wheat in the Harrowmead, scrub in the Thirstlands.
     *
     * Clusters of five stalks rather than five separate scatters, so a field
     * reads as planted rather than as weeds — which is what tells you at a
     * glance that somebody works this ground.
     */
    scatter(mix.crop, (x, y, z, r) => {
      if (y < SEA + 1.4) return;
      if (realm._slopeAt(x, z) > 0.3) return;
      const col = _c.copy(pal.grass2).multiplyScalar(1.25 + r() * 0.2).getHex();
      for (let k = 0; k < 5; k++) {
        const h = 1.1 + r() * 0.9;
        this._emit('post', x + (r() - 0.5) * 5, y + h * 0.5, z + (r() - 0.5) * 5,
          0.09, h, 0.09, col, r() * 3);
      }
    });
    return true;
  }

  /** How many instances are live, by kind — for the budget check. */
  counts() {
    const out = {};
    for (const k in this.meshes) out[k] = this.meshes[k].count;
    return out;
  }

  dispose() {
    for (const k in this.meshes) {
      const m = this.meshes[k];
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.meshes = {};
  }
}
