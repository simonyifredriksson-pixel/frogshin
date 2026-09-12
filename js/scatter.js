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

import * as THREE from '../lib/three.module.js?v=v121';
import { mulberry32 } from './util.js?v=v121';
import { SEA } from './regions.js?v=v121';
import { CHUNK } from './realm.js?v=v121';

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

/**
 * GROUND DETAIL — flowers, mushrooms, ferns, fallen logs, moss.
 *
 * Kept in its own table and its own radius, because it answers a different
 * question. The mix above decides what a REGION looks like from a hilltop;
 * this decides what the ground looks like under your feet, and none of it is
 * visible from more than about a hundred units away.
 *
 * So it is only grown on the nine tiles around the player — see DETAIL_R.
 * That is what makes it affordable to have this much of it: a lush tile grows
 * forty-odd separate plants, and there are nine such tiles rather than sixty.
 *
 * None of it needs a new InstancedMesh either. A flower is a stem (`post`)
 * and a head (`blob`); a mushroom is a stalk and a cap; a fern is three low
 * `pine` fronds; a fallen log is a `trunk` on its side with `blob` moss on
 * top. The five meshes that were already there simply carry more instances.
 */
export const DETAIL = {
  lilyreach:   { flower: 16, shroom: 4,  fern: 8,  log: 2, moss: 6 },
  harrowmead:  { flower: 20, shroom: 2,  fern: 4,  log: 1, moss: 3 },
  whispermire: { flower: 5,  shroom: 16, fern: 12, log: 4, moss: 10 },
  hollowroot:  { flower: 7,  shroom: 14, fern: 18, log: 5, moss: 12 },
  sunkenstair: { flower: 9,  shroom: 6,  fern: 7,  log: 2, moss: 14 },
  anurath:     { flower: 8,  shroom: 5,  fern: 6,  log: 2, moss: 7 },
  quarry:      { flower: 3,  shroom: 2,  fern: 2,  log: 1, moss: 5 },
  glassfen:    { flower: 6,  shroom: 10, fern: 9,  log: 3, moss: 8 },
  gravewater:  { flower: 3,  shroom: 14, fern: 8,  log: 4, moss: 9 },
  thirstlands: { flower: 2,  shroom: 0,  fern: 1,  log: 0, moss: 0 },
  choircliffs: { flower: 6,  shroom: 3,  fern: 4,  log: 1, moss: 6 },
  boneflats:   { flower: 1,  shroom: 2,  fern: 0,  log: 0, moss: 1 },
  drownedkeep: { flower: 5,  shroom: 8,  fern: 8,  log: 3, moss: 11 },
  emberwaste:  { flower: 1,  shroom: 1,  fern: 1,  log: 1, moss: 0 },
  cindermaw:   { flower: 0,  shroom: 0,  fern: 0,  log: 0, moss: 0 },
  spine:       { flower: 2,  shroom: 3,  fern: 2,  log: 1, moss: 2 },
  moonshelf:   { flower: 3,  shroom: 4,  fern: 2,  log: 0, moss: 3 },
  palewood:    { flower: 5,  shroom: 18, fern: 16, log: 6, moss: 13 },
  hollowcity:  { flower: 4,  shroom: 6,  fern: 5,  log: 2, moss: 9 },
  glimmerwood: { flower: 12, shroom: 20, fern: 12, log: 4, moss: 10 },
  frostmarch:  { flower: 2,  shroom: 2,  fern: 1,  log: 1, moss: 2 },
  rimefang:    { flower: 0,  shroom: 0,  fern: 0,  log: 0, moss: 1 },
  sunderway:   { flower: 2,  shroom: 2,  fern: 2,  log: 1, moss: 4 },
  ashenthrone: { flower: 1,  shroom: 3,  fern: 1,  log: 1, moss: 2 },
};
const DEFAULT_DETAIL = { flower: 8, shroom: 5, fern: 6, log: 2, moss: 6 };
/**
 * How far out the ground detail goes, in tiles.
 *
 * One, so nine tiles — 576 units on a side. A flower is fifteen centimetres
 * across; past a hundred units it is not there whether it is drawn or not.
 */
const DETAIL_R = 1;

/**
 * Flower colours, by region family.
 *
 * Warm mixed meadow in the south, deep purples in the mire, bone-white in
 * the dead places, and something luminous in the Glimmerwood.
 */
const PETALS = {
  warm: [0xffe86a, 0xff9ac0, 0xffffff, 0xffb84a, 0xd88fff],
  mire: [0x9a6ad9, 0xd88fd9, 0xe4e4c0, 0x6a9ad9],
  pale: [0xe8e4d0, 0xd0d4c8, 0xffffff],
  glow: [0x8ff0ff, 0xc9a0ff, 0x9affc0, 0xfff08a],
  ember: [0xff8a3c, 0xffca4a, 0xd94a2c],
  cold: [0xdff4ff, 0xc9d8ff, 0xffffff],
};
const PETAL_FOR = {
  whispermire: 'mire', glassfen: 'mire', gravewater: 'mire',
  hollowroot: 'mire', drownedkeep: 'mire',
  boneflats: 'pale', spine: 'pale', palewood: 'pale', hollowcity: 'pale',
  glimmerwood: 'glow', moonshelf: 'glow',
  emberwaste: 'ember', cindermaw: 'ember', ashenthrone: 'ember',
  frostmarch: 'cold', rimefang: 'cold', sunderway: 'cold',
};
/** Mushroom caps: brown and speckled almost everywhere, luminous in two. */
const CAPS = {
  normal: [0xa8543a, 0xc4703a, 0xd9a06a, 0x8a4a3a, 0xe0d0b4],
  glow: [0x6cf0ff, 0xc0a0ff, 0x9affc0],
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
      // The ground detail rides on the same five meshes as the trees — a
      // flower is a `post` and a `blob`, a fern is three `pine` fronds — so
      // adding it costs instances rather than draw calls. Nine tiles of a
      // lush region is roughly 1500 extra posts and 1800 extra blobs, hence
      // the headroom on those two.
      trunk: 3600, pine: 7200, blob: 6400, rock: 4200, post: 9600, shard: 3000,
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
    /**
     * ═══ AND THE SOLID ONES ══════════════════════════════════════════════
     *
     * Every tree, boulder and crystal spike in the overworld came out of
     * this file, and none of them was solid. The realm's broadphase is baked
     * once and never looks at a box added afterwards, and this file's whole
     * design is that its contents are thrown away and regenerated whenever
     * the player crosses a tile — so thirty thousand trunks and boulders
     * were scenery you walked straight through.
     *
     * They are collected here as flat septuples and handed to
     * `collision.setStreamed` at the end of every refill. See collision.js:
     * a second hash, replaced wholesale, read by the same `query`.
     *
     * ── WHAT IS SOLID AND WHAT IS NOT ────────────────────────────────────
     * Trunks, big boulders and big shards. Not reeds, not bones, not
     * flowers, not ferns, not the small stones: running through undergrowth
     * should feel like running through undergrowth, and a collider on a
     * fifteen-centimetre flower is a thing that snags you for no reason.
     *
     * The colliders also hug the TRUNK rather than the canopy, which is the
     * same rule js/world.js states for the valley's trees: weaving past
     * poles, not bumping into invisible boxes the size of a tree's shadow.
     *
     * ── AND WHERE NOTHING IS EVER SOLID ──────────────────────────────────
     * On a road, and inside a settlement. The scatter has no keep-out of
     * its own — it will happily grow a pine in the middle of a village
     * square — and that was harmless while none of it was solid. Making it
     * solid without this would wall off doorways and market stalls. The
     * visual is untouched in both cases; only the collider is skipped.
     */
    this.solids = [];
    /** Set by the overworld: true where a collider must not be placed. */
    this.keepClear = null;
    /** How many solid pieces the last refill handed over. For the tests. */
    this.solidCount = 0;
  }

  /**
   * Remember a solid piece of scatter, unless it is somewhere it must not be.
   *
   * `road` comes from the road network's own surface test rather than from a
   * distance to a polyline, so a wide paved approach is as clear as a track.
   */
  _solid(x, y, z, hx, hy, hz) {
    /**
     * `realm.network`, NOT `realm.net` — there is no `net` on a Realm, so
     * this test was reading undefined and skipping itself entirely. Every
     * solid boulder and trunk the scatter produced was allowed to stand in
     * the middle of a road, collider and all: roads blocked by scenery,
     * which is a strange thing to find while building the broken ones.
     */
    const net = this.realm && this.realm.network;
    if (net && net.roadAt(x, z) > 0.12) return;
    if (this.keepClear && this.keepClear(x, z)) return;
    this.solids.push([x, y, z, hx, hy, hz, 'stone']);
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
    this.solids.length = 0;

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
        // Ground detail only on the tiles you are standing among.
        const detail = Math.abs(dx) <= DETAIL_R && Math.abs(dz) <= DETAIL_R;
        tiles += this._fillTile(cix + dx, ciz + dz, half, detail) ? 1 : 0;
      }
    }

    for (const k in this.meshes) {
      const mesh = this.meshes[k];
      mesh.count = this._n[k] || 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    /**
     * Hand the solid pieces over in one go.
     *
     * Only the DETAIL tiles contribute — the nine round the player, 576
     * units on a side — because a collider four hundred units away can
     * never be touched and hashing it is pure cost. See `_fillTile`.
     */
    if (this.realm && this.realm.collision) {
      this.solidCount = this.realm.collision.setStreamed(this.solids);
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
  _fillTile(cx, cz, half, detail = false) {
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
      // The trunk, and only the trunk. See `_solid`.
      if (detail) this._solid(x, y + th * 0.5, z, 0.55 * sc, th * 0.5, 0.55 * sc);
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
      if (detail) this._solid(x, y + th * 0.5, z, 0.6 * sc, th * 0.5, 0.6 * sc);
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
      /**
       * Boulders over 1.5 units. Under that you scramble over them, which
       * is the rule js/world.js already uses for the valley's rocks — and
       * the collider is inset from the silhouette for the same reason:
       * snagging on the edge of a rock you were clearly going to clear is
       * worse than clipping a corner of one.
       */
      if (detail && s > 1.5) {
        this._solid(x, y + s * 0.35, z, s * 0.78, s * 0.5, s * 0.7);
      }
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
      // A three-metre spike of ice or obsidian is not something to walk
      // through. The small ones stay passable so the ice fields still flow.
      if (detail && s > 2.0) {
        this._solid(x, y + s * 0.8, z, s * 0.42, s * 0.9, s * 0.42);
      }
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

    if (detail) this._detail(region, pal, x0, z0, rnd, scatter);
    return true;
  }

  /**
   * The ground under your feet.
   *
   * Everything here is small, close and clustered. Clustered on purpose: one
   * flower in a field is a mistake and eight in a patch is a meadow, and the
   * same is true of mushrooms round a log. Only ever called for the nine
   * tiles around the player — see DETAIL_R.
   */
  _detail(region, pal, x0, z0, rnd, scatter) {
    const D = DETAIL[region.id] || DEFAULT_DETAIL;
    const realm = this.realm;
    const petals = PETALS[PETAL_FOR[region.id] || 'warm'];
    const caps = CAPS[region.id === 'glimmerwood' || region.id === 'moonshelf'
      ? 'glow' : 'normal'];

    // ---- flowers: a stem and a head, in patches of five to nine ----------
    scatter(D.flower, (x, y, z, r) => {
      if (y < SEA + 0.6) return;
      if (realm._slopeAt(x, z) > 0.34) return;
      const col = petals[Math.floor(r() * petals.length)];
      const n = 5 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) {
        const px = x + (r() - 0.5) * 3.4, pz = z + (r() - 0.5) * 3.4;
        const py = realm.heightAt(px, pz);
        if (py < SEA + 0.4) continue;
        const h = 0.30 + r() * 0.34;
        this._emit('post', px, py + h * 0.5, pz, 0.028, h, 0.028, 0x5a7a3a);
        this._emit('blob', px, py + h + 0.05, pz, 0.10, 0.07, 0.10,
          col, r() * 3, r(), r());
      }
    });

    // ---- mushrooms: a stalk and a cap, in rings ---------------------------
    scatter(D.shroom, (x, y, z, r) => {
      if (y < SEA + 0.4) return;
      if (realm._slopeAt(x, z) > 0.40) return;
      const col = caps[Math.floor(r() * caps.length)];
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r();
        const d = 0.4 + r() * 1.6;
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        const py = realm.heightAt(px, pz);
        if (py < SEA + 0.3) continue;
        const s = 0.5 + r() * 0.9;
        this._emit('post', px, py + 0.14 * s, pz, 0.05 * s, 0.28 * s, 0.05 * s,
          0xe4dcc4);
        this._emit('blob', px, py + 0.30 * s, pz,
          0.17 * s, 0.10 * s, 0.17 * s, col, r() * 3);
      }
    });

    // ---- ferns: three low fronds out of one crown ------------------------
    scatter(D.fern, (x, y, z, r) => {
      if (y < SEA + 0.6) return;
      if (realm._slopeAt(x, z) > 0.44) return;
      const col = _c.copy(pal.grass2).multiplyScalar(0.7 + r() * 0.3).getHex();
      const s = 0.7 + r() * 0.7;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + r() * 2;
        this._emit('pine', x + Math.cos(a) * 0.16 * s, y + 0.30 * s,
          z + Math.sin(a) * 0.16 * s,
          0.30 * s, 0.62 * s, 0.30 * s, col, a, 0.34, 0);
      }
    });

    /**
     * Fallen logs, with moss on them and mushrooms along them.
     *
     * The one piece of detail that is bigger than a boot: a log lying across
     * a slope is a landmark at ten units and the thing that makes a wood look
     * old rather than planted.
     */
    scatter(D.log, (x, y, z, r) => {
      if (y < SEA + 0.8) return;
      if (realm._slopeAt(x, z) > 0.30) return;
      const len = 3.4 + r() * 4.4;
      const rad = 0.34 + r() * 0.24;
      const a = r() * Math.PI * 2;
      // A cylinder stands up the y axis, so a log is one rotated flat and
      // then turned to lie along its bearing.
      this._emit('trunk', x, y + rad * 0.85, z, rad, len, rad,
        0x5a4230, a, Math.PI / 2, 0);
      for (let k = 0; k < 3; k++) {
        const t = (k - 1) * len * 0.3;
        const mx = x + Math.sin(a) * t, mz = z + Math.cos(a) * t;
        this._emit('blob', mx, y + rad * 1.5, mz, rad * 0.9, rad * 0.35, rad * 0.9,
          _c.copy(pal.grass).multiplyScalar(0.8).getHex(), r() * 3);
      }
    });

    // ---- moss: a green skin over a stone --------------------------------
    scatter(D.moss, (x, y, z, r) => {
      if (y < SEA - 1) return;
      const s = 0.5 + r() * 1.5;
      this._emit('rock', x, y + s * 0.4, z, s, s * 0.6, s * 0.85,
        _c.copy(pal.rock).multiplyScalar(0.8).getHex(), r() * 3, r() * 0.3, r() * 0.3);
      this._emit('blob', x, y + s * 0.62, z, s * 0.82, s * 0.30, s * 0.72,
        _c.copy(pal.grass).multiplyScalar(0.72 + r() * 0.25).getHex(),
        r() * 3, r() * 0.2, r() * 0.2);
    });
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
