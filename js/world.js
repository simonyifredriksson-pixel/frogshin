/**
 * World generation.
 *
 * The map is generated procedurally from a fixed seed so every client builds
 * an identical world without shipping any level data over the network.
 *
 * Performance strategy: every repeated prop (structure blocks, roofs, trunks,
 * foliage, rocks, lanterns) is accumulated into a batch and emitted as a
 * single InstancedMesh. The whole map is roughly a dozen draw calls.
 */

import * as THREE from '../lib/three.module.js?v=v146';
import { CFG } from './config.js?v=v146';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep } from './util.js?v=v146';
import { findMap } from './maps.js?v=v146';
import { Terrain, CollisionWorld } from './collision.js?v=v146';
import { Shark } from './shark.js?v=v146';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * How far a pagoda roof's eave slab reaches, as a fraction of its radius.
 *
 * Named because the Sky Shrine's colonnade has to stand under it. Its pillars
 * were placed by eye at 15 against an eave that stops at 13.26, so the outer
 * pair held up nothing at all and the rest poked through the roof.
 */
/**
 * ═══ SHIZUKA WARD ════════════════════════════════════════════════════════
 *
 * Every number the city is measured in. `pitch` and `road` are the two that
 * matter — the pavements, the lamp spacing, the parking bays, the skyways
 * and the crossings are all derived from them, so the ward can be made
 * denser or wider by editing one line rather than by moving three hundred
 * objects.
 */
const CITY = {
  /**
   * Block centre to block centre.
   *
   * A block is therefore `pitch - road` across, and the ROADS RUN AT THE
   * HALF-PITCH — at (k + 0.5) * pitch, never at k * pitch. The first draft
   * put the lane markings, the lamps and the skyways at k * pitch, which is
   * where the blocks are, so every white line was painted through the middle
   * of an apartment building. Anything placed on a street derives from the
   * half-pitch; anything placed on a block derives from the whole one.
   */
  pitch: 40,
  /** Asphalt between two blocks, kerb to kerb. */
  road: 16,
  /** How many blocks across, counting both ways from the middle. */
  span: 11,
  /**
   * No block is built past this from the centre — the ward's edge.
   *
   * MEASURED AS A SQUARE, `max(|x|, |z|)`, the same ruler the map's rim is
   * raised with. A circular reach cut the grid to a disc: five and a bit
   * rings, 41 blocks, and four corners of the world left empty. Nine by
   * nine is 81, and it is also simply what a ward looks like.
   *
   * It has to stop at the WATERFRONT: a block reaches `pitch/2 - road/2`
   * past its own centre, so 160 + 12 = 172, which is exactly where the
   * ground starts dropping away into the lake. An earlier draft had the
   * blocks reaching past where the edge began and built its whole outer
   * ring into a hillside, which is the failure this margin exists for.
   *
   * The ward gave up some ground when the mountain became a lake — 40 of
   * pitch against 44, so it is still nine blocks by nine, just tighter.
   * That is the right trade: a wall tells you where the map stops, and
   * open water with a bridge across it tells you the map goes on.
   */
  reach: 164,
  /** The flat the whole city sits on. Well above the waterline: no sea. */
  ground: 6,
  /** How high the pedestrian bridges run over the avenues. */
  skyway: 13.5,
  /** Shop banners. The only saturated colour in a grey ward. */
  signs: [0x2f9fb4, 0xd8483c, 0xe8b93a, 0x8f5ac4, 0x3f8f4a],
  /** Parked cars: municipal whites and silvers, one taxi yellow. */
  cars: [0xd8d8d2, 0xb4b8bc, 0x8a9098, 0x3f4a5c, 0xc4483c, 0xe8b93a, 0x4a5a48],
};
const ROOF_EAVE = 0.78;

/** Collects transforms + colours, then emits one InstancedMesh. */
class Batch {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.items = [];
  }
  add(px, py, pz, sx, sy, sz, color, rotY = 0, rotX = 0, rotZ = 0) {
    this.items.push([px, py, pz, sx, sy, sz, color, rotY, rotX, rotZ]);
  }
  build(scene, castShadow = true, receiveShadow = true) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.items.length);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
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
    mesh.frustumCulled = false;   // instances span the map; culling the whole
    scene.add(mesh);              // batch as one object would pop badly
    return mesh;
  }
}

export class World {
  /**
   * @param scene
   * @param mapId  which map from maps.js. Everything — seed, terrain shape,
   *               palette, contents — comes from that entry, so the id is the
   *               only thing clients have to agree on to build the same world.
   */
  constructor(scene, mapId) {
    this.scene = scene;
    this.map = findMap(mapId);
    this.rnd = mulberry32(this.map.seed);
    this.noise = new ValueNoise(this.map.seed);
    this.noise2 = new ValueNoise(this.map.seed + 991);
    this.spawnPoints = [];
    /**
     * The one flat a built map stands on.
     *
     * Shizuka Ward is a road grid, and a road grid has to agree with itself
     * to the centimetre — a kerb that follows the terrain is a kerb you trip
     * over. So the city declares its own ground height and every builder in
     * it measures from this rather than from `heightAt`. Maps that grow out
     * of their terrain leave it at zero and never read it.
     */
    this.groundY = this.map.groundY || 0;
    this.lanterns = [];          // { mesh, baseY, phase } — bob animation
    this.grassPatches = [];
    this.waterMesh = null;
    this.time = 0;
    // Every map must provide these — the game reads them without asking
    // which map it is on.
    this.dummySpots = [];
    this.statue = null;
    /**
     * Ground that nothing may be planted on. See `_clear`.
     *
     * Filled by the structure builders and read by the ones that scatter
     * foliage, so it only works because every map lists its structures before
     * its planting. If a map ever stops doing that, its trees come back
     * inside its temples.
     */
    this.keepOut = [];


    // Flat regions carved into the terrain so structures have somewhere to
    // sit, and basins scooped out for water. Both come from the map.
    this.flats = this.map.flats || [];
    this.basins = this.map.basins || [];
  }

  /** The map's display name, for the HUD and the lobby. */
  get mapName() { return this.map.name; }

  // -------------------------------------------------------- height function

  /**
   * Terrain height in world space. Pure function of (x,z) and the seed, so it
   * is safe to evaluate from anywhere (mesh build, collision, prop placement).
   */
  heightAt(x, z) {
    // The map owns its own shape; the flats and basins below are the shared
    // part, because every map wants somewhere level to build on.
    let h = this.map.height(this, x, z);

    // Carve flats and basins.
    for (let i = 0; i < this.flats.length; i++) {
      const f = this.flats[i];
      const d = Math.hypot(x - f.x, z - f.z);
      const t = 1 - smoothstep(clamp((d - f.r) / f.f, 0, 1));
      h = lerp(h, f.h + this.noise2.noise2(x * 0.05, z * 0.05) * 0.35 * (1 - t), t);
    }
    for (let i = 0; i < this.basins.length; i++) {
      const b = this.basins[i];
      const d = Math.hypot(x - b.x, z - b.z);
      const t = 1 - smoothstep(clamp((d - b.r) / b.f, 0, 1));
      h = lerp(h, b.h, t);
    }

    return h;
  }

  /**
   * The build split into labelled steps. The loader runs them one per frame
   * so the progress bar actually moves instead of the tab locking up.
   */
  buildTasks() {
    return [
      ['Raising the mountains', () => {
        const { size, grid } = CFG.world;
        this.terrain = new Terrain(size, grid, (x, z) => this.heightAt(x, z));
        this.collision = new CollisionWorld(this.terrain);
        this.collision.climbLimitY = this.map.climbLimitY;
        if (this.map.climbLimitRadius !== undefined) {
          this.collision.climbLimitRadius = this.map.climbLimitRadius;
        }
        /**
         * And WHICH SHAPE that radius means — see `climbLimitShape` in
         * js/collision.js for why this matters. A map whose rim is raised
         * from `max(|x|, |z|)` fills the square world out to its corners,
         * and measuring its climb limit with a circle would put an
         * invisible wall a quarter of the way in along both diagonals.
         * The rim and the limit must be cut with the same ruler.
         */
        if (this.map.climbLimitShape) {
          this.collision.climbLimitShape = this.map.climbLimitShape;
        }
        this.batches = {
          box:   new Batch(new THREE.BoxGeometry(1, 1, 1), this._mat()),
          roof:  new Batch(new THREE.ConeGeometry(1, 1, 4, 1), this._mat()),
          trunk: new Batch(new THREE.CylinderGeometry(0.42, 0.6, 1, 6), this._mat()),
          pine:  new Batch(new THREE.ConeGeometry(1, 1, 7, 1), this._mat()),
          blob:  new Batch(new THREE.IcosahedronGeometry(1, 0), this._mat()),
          rock:  new Batch(new THREE.DodecahedronGeometry(1, 0), this._mat()),
          post:  new Batch(new THREE.CylinderGeometry(1, 1, 1, 7), this._mat()),

        };
      }],
      ['Carving the land', () => this._buildTerrainMesh()],
      ['Filling the water', () => this._buildWater()],
      // Everything specific to this map, in the order it lists them.
      ...this.map.features.map(([label, fn]) => [label, () => fn(this)]),
      ['Lighting the lanterns', () => {
        this._buildSpawns();
        for (const k in this.batches) {
          // Foliage skips shadow casting — it is the most expensive caster
          // and contributes the least to readability.
          const cast = k !== 'blob' && k !== 'pine';
          this.batches[k].mesh = this.batches[k].build(this.scene, cast, true);
        }
        this.collision.bake();
      }],
    ];
  }

  /** Synchronous build (used by tools/tests). */
  build() {
    for (const [, fn] of this.buildTasks()) fn();
    return this;
  }

  /**
   * Give back everything this world put on the GPU.
   *
   * Needed because the arena world is now rebuilt whenever the map changes,
   * and a heightfield plus seven instanced batches per switch adds up fast on
   * the kind of machine this gets played on.
   *
   * Only touches what World itself created — the batches' geometry, the
   * terrain, the water, the lanterns, the ring and the statue, all of which
   * are made fresh per world. It deliberately does NOT sweep the whole scene:
   * frogs, toads and guardians share module-level geometry that has to
   * outlive any single world, and freeing that would break the next one.
   *
   * Textures are left alone for the same reason — the lantern halo's is
   * built once and shared by every lantern in the game. Disposing a material
   * does not touch its texture, so this is already safe.
   */
  dispose() {
    // The shark owns its own meshes, and the arena rebuilds the world on
    // every map change — leaving it behind would put a second one in the
    // lake each time somebody voted for the city again.
    if (this.shark) { this.shark.dispose(); this.shark = null; }
    const seen = new Set();
    const free = (o) => {
      if (!o || seen.has(o)) return;
      seen.add(o);
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) m.dispose();
      if (o.children) for (const c of o.children.slice()) free(c);
      if (o.parent) o.parent.remove(o);
    };

    for (const k in (this.batches || {})) {
      const b = this.batches[k];
      free(b.mesh);
      // A batch that never emitted a mesh still holds the geometry and
      // material it was created with.
      if (b.geometry) b.geometry.dispose();
      if (b.material) b.material.dispose();
    }
    free(this.terrainMesh);
    free(this.waterMesh);
    for (const l of this.lanterns) free(l.mesh);

    if (this.practiceRing) free(this.practiceRing.group);
    if (this.statue && this.statue.group) free(this.statue.group);

    this.batches = {};
    this.lanterns.length = 0;
    this.terrainMesh = null;
    this.waterMesh = null;
    this.practiceRing = null;
    this.statue = null;
  }

  /**
   * Material for the instanced prop batches.
   *
   * Deliberately does NOT set `vertexColors`. Per-instance colour comes from
   * InstancedMesh.setColorAt, which turns on USE_INSTANCING_COLOR by itself.
   * Setting `vertexColors` as well makes the shader additionally multiply by
   * a per-vertex `color` attribute that these shared geometries do not have —
   * an unbound attribute reads as zero, so every prop renders pure black.
   */
  _mat() {
    return new THREE.MeshLambertMaterial({});
  }

  // ------------------------------------------------------------ terrain mesh

  _buildTerrainMesh() {
    const { size, grid, waterLevel } = CFG.world;
    const geo = new THREE.PlaneGeometry(size, size, grid - 1, grid - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // The map's palette, so ground colour is part of a map's identity rather
    // than something baked into the renderer.
    const P = this.map.palette;
    const cGrass = new THREE.Color(P.grass);
    const cGrass2 = new THREE.Color(P.grass2);
    const cDirt = new THREE.Color(P.dirt);
    const cSand = new THREE.Color(P.sand);
    const cRock = new THREE.Color(P.rock);
    const cHigh = new THREE.Color(P.high);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.terrain.heightAt(x, z);
      pos.setY(i, h);

      const slope = this.terrain.slopeAt(x, z);
      const varia = this.noise2.fbm(x * 0.03, z * 0.03, 2) * 0.5 + 0.5;

      if (h < waterLevel + 1.2) tmp.copy(cSand);
      // The high band. On the valley this is the snow line, and it is the
      // same number the climb limit uses — so where the white starts is
      // exactly where the mountain stops letting you walk up it.
      else if (h > P.highAt) {
        tmp.copy(cHigh).lerp(cRock, clamp((P.highAt + 6 - h) / 22, 0, 1) * 0.5);
      } else {
        tmp.copy(cGrass).lerp(cGrass2, varia);
        if (slope > P.slopeDirt) {
          tmp.lerp(cDirt, clamp((slope - P.slopeDirt) / 0.22, 0, 1));
        }
        if (slope > P.slopeRock) {
          tmp.lerp(cRock, clamp((slope - P.slopeRock) / 0.3, 0, 1));
        }
        if (h > P.rockFromY) tmp.lerp(cRock, clamp((h - P.rockFromY) / 20, 0, 1));
      }
      // Subtle per-vertex value noise breaks up the flat-shaded look.
      const shade = 0.9 + varia * 0.2;
      colors[i * 3] = tmp.r * shade;
      colors[i * 3 + 1] = tmp.g * shade;
      colors[i * 3 + 2] = tmp.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.scene.add(mesh);
    this.terrainMesh = mesh;
  }

  _buildWater() {
    const { waterLevel } = CFG.world;
    /**
     * A map may ask for water WIDER than its own terrain.
     *
     * Shizuka Ward does: it is an island in a lake, and the lake has to run
     * past the heightfield and out under the far island so the horizon is
     * water rather than the edge of a 420-unit plane with nothing beyond
     * it. Every other map leaves this alone and gets exactly what it had.
     */
    const size = this.map.waterSize || CFG.world.size;
    const geo = new THREE.PlaneGeometry(size, size, 40, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x2f7fa8, transparent: true, opacity: 0.72,
      emissive: 0x0d3348, emissiveIntensity: 0.5,
      // DoubleSide matters: without it the surface vanishes when viewed from
      // below and being underwater looks like being in empty blue space.
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = waterLevel;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.waterMesh = mesh;
    this.waterBase = geo.attributes.position.array.slice();
  }

  // ---------------------------------------------------------------- helpers

  /** Visual box + matching collider. */
  solid(cx, cy, cz, hx, hy, hz, color, tag = 'wood') {
    this.batches.box.add(cx, cy, cz, hx * 2, hy * 2, hz * 2, color);
    this.collision.addBox(cx, cy, cz, hx, hy, hz, tag);
  }

  /**
   * Register ground a structure stands on, so nothing gets planted in it.
   *
   * Foliage used to be kept out of the districts by three circles written by
   * hand inside `_buildForests`, and a hand-written list of somebody else's
   * dimensions cannot stay right. It had the arena at 30 when the arena
   * reaches 34, the village at 26 when the village's outermost house stands
   * at 39, and the Sky Shrine at nothing at all — twenty-four trees grew up
   * through the shrine, four rocks with them. `_buildRocks` was never given a
   * list in the first place.
   *
   * So a builder declares its own footprint, in the same method that decides
   * how big the thing is. A structure that moves or grows takes its clearing
   * with it.
   */
  _clear(x, z, r) { this.keepOut.push({ x, z, r }); }

  /** True if (x, z) is clear of every structure, plus `pad` of margin. */
  _isClear(x, z, pad = 0) {
    for (let i = 0; i < this.keepOut.length; i++) {
      const k = this.keepOut[i];
      if (Math.hypot(x - k.x, z - k.z) < k.r + pad) return false;
    }
    return true;
  }

  /**
   * A flight of stone steps from `groundY` up to `topY`, running away from
   * (sx, sz) along (dx, dz).
   *
   * For masonry — the Sky Shrine's terrace is a single 1.40 lip against a
   * step height of 0.65, so the shrine could be looked at and not entered.
   * Bridges do NOT use this; they get `_ramp`, which is made of their own
   * planks.
   *
   * Axis-snapped for the same reason `_ramp` is: a diagonal flight of
   * axis-aligned steps has three treads overlapping you at once, the highest
   * of them out of reach, and stops you dead halfway up.
   *
   * The boxes run down to the ground rather than floating at tread height,
   * so there is no space underneath to fall into.
   */
  _steps(sx, sz, topY, groundY, dx, dz, width = 3.0, color = 0x8d8a80) {
    const rise = topY - groundY;
    if (rise <= 0) return;
    const RISER = 0.40, TREAD = 0.95;
    const n = Math.max(1, Math.ceil(rise / RISER));
    const riser = rise / n;
    const hw = width / 2;
    if (Math.abs(dx) >= Math.abs(dz)) { dx = Math.sign(dx) || 1; dz = 0; }
    else { dz = Math.sign(dz); dx = 0; }
    for (let i = 0; i < n; i++) {
      const top = topY - i * riser;
      const bottom = groundY - 1.5;
      this.solid(sx + dx * (i + 0.5) * TREAD, (top + bottom) / 2,
        sz + dz * (i + 0.5) * TREAD,
        dx ? TREAD / 2 + 0.15 : hw, (top - bottom) / 2, dz ? TREAD / 2 + 0.15 : hw,
        i % 2 ? color : 0x84817a, 'stone');
    }
    this._clear(sx + dx * n * TREAD * 0.5, sz + dz * n * TREAD * 0.5,
      n * TREAD * 0.5 + Math.max(hw, 2.5));
  }

  /**
   * The ramp down from a bridge abutment to the ground.
   *
   * Not a staircase — the same planks, rails and spacing as the span it
   * serves, carrying straight on past the last post and down to the grass.
   * It replaced a stone-and-timber flight of its own design, which read as
   * somebody else's building bolted onto the end of a rope bridge.
   *
   * The run is snapped to an axis. That is not cosmetic: collision boxes are
   * axis-aligned, so a diagonal run has to be covered by planks wide in BOTH
   * directions, and then three of them overlap you at once instead of one.
   * Snapped, the ramp turns a corner at the abutment, which reads as a
   * landing — and it is what makes the thing walkable.
   */
  _ramp(sx, sz, topY, groundY, dx, dz) {
    if (topY - groundY <= 0) return;
    const SPACING = 1.9;                            // as tight as planks sit
    const DROP = CFG.move.deckStep * 0.55;          // fall per plank
    if (Math.abs(dx) >= Math.abs(dz)) { dx = Math.sign(dx) || 1; dz = 0; }
    else { dz = Math.sign(dz); dx = 0; }
    // Planks are laid across the run, so the rotation is the run's bearing.
    const rotY = Math.atan2(dx, dz);

    /**
     * Descends until it reaches the ground UNDER ITS OWN FOOT.
     *
     * It used to interpolate down to the height of the ground at the
     * abutment, which is not the ground the ramp ends on: eleven metres out
     * along a falling hillside, the last plank sat 0.81 over the grass. That
     * is under a stride for a walkway but over one for a LEDGE, and the step
     * onto a plank from bare terrain is a ledge — so the ramp was climbable
     * from the top and unreachable from the bottom.
     *
     * 0.43 is what makes the last step legal: plus the plank's own 0.22 it
     * comes to 0.65, which is stepHeight exactly.
     */
    let y = topY, i = 0;
    for (; i < 60; i++) {
      const x = sx + dx * i * SPACING, z = sz + dz * i * SPACING;
      this._plank(x, y, z, rotY, i);
      const g = this.heightAt(x, z);
      if (y - g <= 0.43) break;
      y = Math.max(g + 0.21, y - DROP);
    }
    this._clear(sx + dx * i * SPACING * 0.5, sz + dz * i * SPACING * 0.5,
      i * SPACING * 0.5 + 3.0);
  }

  /**
   * One deck plank, with its two rail posts.
   *
   * The bridges and the ramps up to them both go through here, so an
   * approach is not "like" the span it serves — it is the same board, the
   * same rails, the same spacing and the same collider tag. The approaches
   * used to be stone-and-timber staircases of their own design and they read
   * as somebody else's building bolted onto the end of a rope bridge.
   */
  _plank(x, y, z, rotY, i) {
    this.batches.box.add(x, y, z, 3.0, 0.16, 1.7, i % 2 ? 0x8a6a45 : 0x7b5c3b, rotY);
    this.collision.addBox(x, y, z, 1.5, 0.22, 1.5, 'deck');
    const s = Math.sin(rotY), c = Math.cos(rotY);
    for (const side of [-1.45, 1.45]) {
      this.batches.post.add(x + c * side, y + 0.9, z - s * side, 0.07, 1.8, 0.07, 0x4a3a2a);
    }
  }

  /** Visual-only box (no collision) — trim, banners, decoration. */
  deco(cx, cy, cz, hx, hy, hz, color, rotY = 0, rotX = 0, rotZ = 0) {
    this.batches.box.add(cx, cy, cz, hx * 2, hy * 2, hz * 2, color, rotY, rotX, rotZ);
  }

  /** Pagoda-style flared roof: a 4-sided pyramid plus an overhanging slab. */
  roof(cx, cy, cz, radius, height, color, rotY = Math.PI / 4) {
    this.batches.roof.add(cx, cy + height * 0.5, cz, radius, height, radius, color, rotY);
    this.deco(cx, cy - 0.12, cz, radius * ROOF_EAVE, 0.16, radius * ROOF_EAVE, 0x3a2a22);
    // The roof slab is walkable — great for rooftop chases.
    this.collision.addBox(cx, cy - 0.1, cz, radius * 0.72, 0.22, radius * 0.72, 'roof');
  }

  /** Floating grapple lantern. Always a valid grapple target. */
  lantern(x, y, z, color = 0xffb347) {
    this.batches.post.add(x, y + 0.55, z, 0.06, 1.1, 0.06, 0x2a211c);
    const geo = new THREE.SphereGeometry(0.55, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.scene.add(m);

    // Soft halo so lanterns read as targets from a distance.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lanternGlowTexture(), color, transparent: true,
      opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(4.2, 4.2, 1);
    m.add(halo);

    this.collision.addAnchor(x, y, z, 1.9);
    this.lanterns.push({ mesh: m, baseY: y, phase: this.rnd() * Math.PI * 2 });
    return m;
  }

  /**
   * The glowing blue try-out ring.
   *
   * Unlit basic materials on purpose: it must read as a marker rather than
   * as scenery, and stay equally visible in shadow.
   */
  _buildPracticeRing(x, y, z, radius) {
    // You have to be able to see the ring to stand in it.
    this._clear(x, z, radius + 1);
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.45, radius, 48),
      new THREE.MeshBasicMaterial({
        color: 0x4ad0ff, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(radius - 1.5, radius + 0.9, 48),
      new THREE.MeshBasicMaterial({
        color: 0x2a9ad0, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    group.add(glow);

    // A soft column so it is findable from across the arena.
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(radius - 0.5, radius - 0.2, 7, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x5ad8ff, transparent: true, opacity: 0.09,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    pillar.position.y = 3.5;
    group.add(pillar);

    // Hidden by default — the game reveals it only in offline practice,
    // where it is the only place it means anything.
    group.visible = false;
    this.scene.add(group);
    this.practiceRing = { pos: new THREE.Vector3(x, y, z), radius, group, ring, glow, pillar };
  }

  /**
   * A weathered stone frog god, sitting just off the arena dais.
   *
   * Deliberately plain grey and easy to walk past — it is scenery until you
   * are carrying the crystal, and then it is the only thing in the map that
   * matters. Built from the same primitives as everything else so it reads
   * as part of the world rather than a dropped-in prop.
   */
  /**
   * The golden frog in the bamboo.
   *
   * This is the crystal altar, and it has to advertise itself as *something*
   * without a single word of explanation — you should walk into the clearing,
   * see gold where everything else is stone and green, and know it matters
   * long before you know why. Hence: gold rather than granite, a lantern-lit
   * clearing cut out of the grove, and a broken halo that says this was built
   * for someone who is no longer being worshipped.
   *
   * `y` is the GROUND height at (x,z) — the plinth is built up from there, so
   * it stands on the floor instead of hovering above or sinking into it.
   */
  _buildFrogathStatue(x, y, z) {
    const gold = 0xd4a933;         // weathered temple gold
    const goldLit = 0xf3d878;      // where the light catches it
    const goldDark = 0x8a6a18;     // deep shadow, and the carved lines
    const stone = 0x6f6a5e;        // the plinth stays stone: it is the pedestal
    const stoneLit = 0x8a8478;
    const moss = 0x5a6b45;

    // Nothing grows on the plinth. It stands on a mud island in the Mire,
    // right inside the band the reeds are planted in.
    this._clear(x, z, 6);

    // ---- plinth: four stone steps, so it reads as approachable ----
    // Four because three started with a 0.70 riser against a step height of
    // 0.65 — "approachable" that you could not actually walk up.
    this.solid(x, y + 0.18, z, 5.4, 0.18, 5.4, stoneLit, 'stone');
    this.solid(x, y + 0.35, z, 4.8, 0.35, 4.8, stone, 'stone');
    this.solid(x, y + 0.95, z, 4.0, 0.30, 4.0, stoneLit, 'stone');
    this.solid(x, y + 1.45, z, 3.3, 0.25, 3.3, stone, 'stone');
    this.deco(x, y + 1.72, z, 2.9, 0.06, 2.9, goldDark);          // gold inlay top

    // Carved band of marks around the top step. Nobody can read them, which
    // is the point.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.deco(x + Math.cos(a) * 3.0, y + 1.62, z + Math.sin(a) * 3.0,
        0.34, 0.05, 0.14, goldLit, a);
    }

    const by = y + 1.7;            // everything above sits on the plinth

    // ---- body: a broad squat frog, hunched forward ----
    this.solid(x, by + 1.5, z, 2.1, 1.5, 1.9, gold, 'stone');
    this.deco(x, by + 1.2, z + 1.3, 1.5, 1.0, 0.5, goldLit);      // belly
    // Ribs of carved line work down the back.
    for (let i = 0; i < 4; i++) {
      this.deco(x, by + 2.5 - i * 0.42, z - 1.55, 1.5 - i * 0.18, 0.05, 0.3, goldDark);
    }

    // ---- head ----
    const hy = by + 3.2;                                          // head centre
    this.solid(x, hy, z + 0.2, 1.7, 0.9, 1.6, gold, 'stone');
    const headTop = hy + 0.9;
    const headFront = z + 0.2 + 1.6;
    this.deco(x, hy - 0.4, z + 1.5, 1.9, 0.12, 0.3, goldDark);    // mouth line

    // ---- eyes ----
    //
    // A frog's eyes sit ON TOP of its skull, and these are built to sit proud
    // of it: the previous pair were centred inside the head volume, so the
    // face itself occluded them and they only appeared from the one angle
    // that looked past the skull. Everything here clears `headTop`, so there
    // is nothing in front of them from any direction.
    for (const sx of [-1, 1]) {
      // The bulge, breaking the line of the skull.
      this.deco(x + sx * 0.82, headTop + 0.30, z + 0.35, 0.62, 0.55, 0.62, gold);
      // Pale ring, entirely above the skull.
      this.deco(x + sx * 0.82, headTop + 0.62, z + 0.35, 0.50, 0.34, 0.50, goldLit);
      // And the pupil, proud of the eye on the FRONT face — high contrast,
      // and readable across the clearing.
      this.deco(x + sx * 0.82, headTop + 0.60, z + 0.92, 0.30, 0.26, 0.16, 0x1a1408);
      this.deco(x + sx * 0.82, headTop + 0.74, z + 0.90, 0.12, 0.08, 0.10, 0xfff3c4);
    }

    // ---- front limbs, braced on the plinth ----
    for (const sx of [-1, 1]) {
      this.deco(x + sx * 1.5, by + 0.7, z + 0.9, 0.4, 1.0, 0.4, gold);
      this.deco(x + sx * 1.5, by + 0.25, z + 1.4, 0.6, 0.18, 0.7, goldLit);
    }

    // ---- the halo, broken ----
    // A ring with a piece missing. Whatever this was, it is not finished.
    for (let i = 0; i < 10; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.5;
      this.deco(x + Math.cos(a) * 1.9, headTop + 1.6 + Math.sin(a) * 1.9, z - 0.3,
        0.34, 0.34, 0.34, goldLit);
    }

    // Moss, because it has been here a very long time and nobody tends it.
    this.deco(x - 1.0, y + 1.76, z + 1.1, 1.0, 0.05, 0.8, moss);
    this.deco(x + 1.3, by + 2.3, z - 0.9, 0.7, 0.05, 0.6, moss);

    this.collision.addBox(x, by + 1.7, z, 1.3, 2.6, 1.2, 'stone');

    /** Where the player must stand to use it. */
    this.statue = {
      pos: new THREE.Vector3(x, y + 1.7, z),
      // In front of the statue, at the foot of the steps.
      stand: new THREE.Vector3(x, y + 1.7, z + 3.8),
    };
  }

  torii(x, z, rotY = 0, scale = 1) {
    const y = this.heightAt(x, z);
    const w = 3.2 * scale, h = 6.2 * scale;
    const c = 0xc0392b, dark = 0x7d2318;
    const s = Math.sin(rotY), co = Math.cos(rotY);
    const off = (dx) => [x + co * dx, z - s * dx];
    const [lx, lz] = off(-w), [rx, rz] = off(w);
    this.solid(lx, y + h / 2, lz, 0.35 * scale, h / 2, 0.35 * scale, c, 'wood');
    this.solid(rx, y + h / 2, rz, 0.35 * scale, h / 2, 0.35 * scale, c, 'wood');
    this.deco(x, y + h, z, w * 1.35, 0.34 * scale, 0.5 * scale, dark, rotY);
    this.deco(x, y + h - 1.1 * scale, z, w * 1.1, 0.24 * scale, 0.4 * scale, c, rotY);
    this.collision.addAnchor(x, y + h, z, 2.0);
    // A gate is a thing you walk through, so the approach stays clear too.
    this._clear(x, z, w * 1.35 + 2);
  }

  // ------------------------------------------------------------ arena (0,0)

  _buildArena() {
    const rnd = this.rnd;
    const baseY = 4.0;
    // The outer combat platforms reach 31 from the centre and are 3.4 wide,
    // so the arena floor ends at 34.4. The gateway torii at 34 add their own.
    this._clear(0, 0, 36);

    /**
     * Stone dais. Three tiers, not two — the bottom one is new.
     *
     * The dais used to start with a 0.85 lip off ground at 4.0, against a
     * stepHeight of 0.65, so the arena floor could not be walked onto at all:
     * you had to jump onto the centre of your own map. This tier brings the
     * first rise down to 0.42 and the next to 0.43.
     */
    this.solid(0, baseY + 0.11, 0, 14.4, 0.31, 14.4, 0x84817a, 'stone');
    this.solid(0, baseY + 0.35, 0, 13, 0.5, 13, 0x8d8a80, 'stone');
    this.solid(0, baseY + 0.95, 0, 10, 0.5, 10, 0x9a978c, 'stone');
    this.deco(0, baseY + 1.47, 0, 8, 0.05, 8, 0xb5a98d);

    // Four corner pillars carrying lanterns — the arena's grapple ring.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = Math.cos(a) * 11.5, pz = Math.sin(a) * 11.5;
      this.solid(px, baseY + 4.5, pz, 0.7, 4.5, 0.7, 0x9c9488, 'stone');
      this.deco(px, baseY + 9.2, pz, 1.15, 0.25, 1.15, 0x5c4a3a);
      this.lantern(px, baseY + 10.6, pz, 0xffcf6b);
    }

    // Outer ring of raised combat platforms at mixed heights.
    // Their tops double as the training-dummy pedestals.
    this.dummySpots = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = 24 + rnd() * 7;
      const px = Math.cos(a) * d, pz = Math.sin(a) * d;
      const gy = this.heightAt(px, pz);
      const ph = 3 + rnd() * 5;
      this.solid(px, gy + ph * 0.5, pz, 3.4, ph * 0.5, 3.4, 0x7d7466, 'stone');
      this.deco(px, gy + ph + 0.08, pz, 3.5, 0.1, 3.5, 0x8f8677);
      if (i % 2 === 0) this.lantern(px, gy + ph + 9 + rnd() * 4, pz, 0x9ce8b0);
      // Every other platform gets a dummy, facing the centre of the arena.
      if (i % 2 === 1) {
        this.dummySpots.push([px, gy + ph + 0.18, pz, Math.atan2(-px, -pz)]);
      }
    }

    // Two more on the central dais so there is always one close at hand.
    this.dummySpots.push([-6.5, baseY + 1.45, 6.5, Math.atan2(6.5, -6.5)]);
    this.dummySpots.push([6.5, baseY + 1.45, -6.5, Math.atan2(-6.5, 6.5)]);

    // ---- practice ring, dead centre of the dummy platform ----
    // Standing in it lets a solo player try every skin and ability.
    this._buildPracticeRing(0, baseY + 1.5, 0, 4.2);

    // Aerial lantern ring — chain grapples in a circle above the arena.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const d = 17 + (i % 3) * 6;
      this.lantern(Math.cos(a) * d, baseY + 20 + (i % 4) * 5.5, Math.sin(a) * d, 0xffd28a);
    }

    // Gateway torii on the four approaches.
    this.torii(0, 34, 0, 1.2);
    this.torii(0, -34, 0, 1.2);
    this.torii(34, 0, Math.PI / 2, 1.2);
    this.torii(-34, 0, Math.PI / 2, 1.2);
  }

  // --------------------------------------------------- temple village (S/W)

  _buildVillage() {
    const cx = -34, cz = 132, rnd = this.rnd;
    const houses = [];

    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rnd() * 0.5;
      const d = 9 + rnd() * 30;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const y = this.heightAt(x, z);
      const w = 3.4 + rnd() * 2.6;
      const dpt = 3.4 + rnd() * 2.6;
      const levels = 1 + (rnd() < 0.4 ? 1 : 0) + (rnd() < 0.16 ? 1 : 0);

      // Its own clearing. Houses sit anywhere from 9 to 39 out, so one circle
      // round the village either swallows the whole district or misses the
      // outer houses — which is what it did, at 26.
      this._clear(x, z, Math.max(w, dpt) * 1.5 + 2.5);

      let ly = y;
      for (let l = 0; l < levels; l++) {
        const sw = w * (1 - l * 0.13), sd = dpt * (1 - l * 0.13);
        const hgt = 3.0;
        this.solid(x, ly + hgt / 2, z, sw, hgt / 2, sd, l === 0 ? 0xe4dcc8 : 0xd8cfb8, 'wood');
        // Dark timber framing.
        this.deco(x, ly + hgt - 0.15, z, sw + 0.06, 0.18, sd + 0.06, 0x4a382a);
        this.deco(x, ly + 0.2, z, sw + 0.06, 0.2, sd + 0.06, 0x4a382a);
        this.roof(x, ly + hgt + 0.3, z, Math.max(sw, sd) * 1.5, 1.9, 0x8c3f36);
        /**
         * The neck between this storey and the next.
         *
         * Storeys step up by hgt + 1.0 but are only hgt tall, so every house
         * had a one-unit band of nothing between its floors: solid wall, open
         * air, solid wall. You could get in there off the eave and stand
         * inside the building. This is the wall that was missing — it takes
         * the upper storey's footprint, which is what a real upper floor
         * sits on.
         */
        if (l < levels - 1) {
          const nw = w * (1 - (l + 1) * 0.13), nd = dpt * (1 - (l + 1) * 0.13);
          this.solid(x, ly + hgt + 0.5, z, nw, 0.5, nd, 0xcdc3ab, 'wood');
        }
        ly += hgt + 1.0;
      }
      houses.push({ x, z, top: ly, w, d: dpt });
      if (rnd() < 0.55) this.lantern(x + (rnd() - 0.5) * 4, ly + 3.5 + rnd() * 3, z + (rnd() - 0.5) * 4, 0xff9a5c);
    }
    this.villageHouses = houses;

    // Central great pagoda — the tallest thing in the village.
    const px = cx, pz = cz, py = this.heightAt(px, pz);
    this._clear(px, pz, 6.5 * 1.62 + 3);
    let ly = py;
    for (let l = 0; l < 4; l++) {
      const s = 6.5 - l * 1.1;
      this.solid(px, ly + 1.8, pz, s, 1.8, s, l % 2 ? 0xd8cfb8 : 0xe4dcc8, 'wood');
      this.deco(px, ly + 3.45, pz, s + 0.08, 0.2, s + 0.08, 0x4a382a);
      this.roof(px, ly + 3.7, pz, s * 1.62, 2.1, 0x9c4437);
      // Corner lanterns on every tier double as grapple rungs.
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        this.lantern(px + Math.cos(a) * s * 1.45, ly + 3.2, pz + Math.sin(a) * s * 1.45, 0xffc46b);
      }
      // The neck each tier stands on. Tiers are 3.6 tall and step up by 5.6,
      // so the pagoda had two metres of open air between every floor — four
      // storey-high holes you could walk into off the eaves.
      if (l < 3) {
        const ns = 6.5 - (l + 1) * 1.1;
        this.solid(px, ly + 4.6, pz, ns, 1.0, ns, 0xd8cfb8, 'wood');
      }
      ly += 5.6;
    }
    this.solid(px, ly + 1.4, pz, 0.5, 1.4, 0.5, 0xc9a227, 'stone');
    this.lantern(px, ly + 4.4, pz, 0xffe08a);

    this.torii(cx + 40, cz + 6, Math.PI / 2, 1.4);
    this.spawnPoints.push([cx + 14, this.heightAt(cx + 14, cz - 10) + 1, cz - 10]);
    this.spawnPoints.push([cx - 18, this.heightAt(cx - 18, cz + 14) + 1, cz + 14]);
  }

  // --------------------------------------------------- sky shrine (N, high)

  _buildShrine() {
    const cx = 0, cz = -142;
    const y = this.heightAt(cx, cz);
    // The terrace is 40 x 32, so its corner stands 25.6 out.
    this._clear(cx, cz, 27);

    // Wide stone terrace on the plateau.
    this.solid(cx, y + 0.6, cz, 20, 0.8, 16, 0x8e8b81, 'stone');
    this.deco(cx, y + 1.42, cz, 20.2, 0.06, 16.2, 0xa39a86);
    /**
     * The great stair, on the southern approach.
     *
     * The terrace is a single 1.40 lip out of the plateau — more than twice
     * the step height — so the Sky Shrine could be looked at and not entered.
     * It goes on the south side because that is where the torii stands, and a
     * gate in front of a wall you cannot climb is a strange thing to build.
     */
    this._steps(cx, cz + 16, y + 1.4, y, 0, 1, 9.0, 0x8e8b81);

    /**
     * The colonnade, sized off the roof it holds up.
     *
     * It used to be six pillars at x -15..15 by z ±13, running from the
     * terrace at y+1.4 to y+9.4 — placed by eye, and wrong in both
     * directions. The roof's eave slab reaches ROOF_EAVE * 17 = 13.26 and
     * sits at y+8.62..y+8.94, so the outer pair at 15 stood entirely beyond
     * it holding up nothing, every pillar overhung the eave in z by half its
     * own width, and all twelve ran 0.46 straight up through the roof.
     *
     * Everything below is derived from the roof instead. The pillars stand
     * far enough in that their full width is under the eave, and stop far
     * enough down that their tops are buried in it rather than out the far
     * side — which is what makes them read as carrying it.
     */
    const ROOF_R = 17;
    const HW = 0.75;                                   // pillar half-width
    const reach = ROOF_R * ROOF_EAVE - HW - 0.15;      // 12.36
    const base = y + 1.4;                              // the terrace top
    const top = y + 8.85;                              // inside the eave slab
    for (let i = 0; i < 6; i++) {
      const ox = -reach + (i / 5) * reach * 2;
      for (const oz of [-reach, reach]) {
        this.solid(cx + ox, (base + top) / 2, cz + oz,
          HW, (top - base) / 2, HW, 0xb0a894, 'stone');
      }
    }

    // Main hall.
    this.solid(cx, y + 5, cz, 11, 3.6, 8, 0xdcd3bc, 'wood');
    this.deco(cx, y + 8.5, cz, 11.2, 0.3, 8.2, 0x4a382a);
    this.roof(cx, y + 8.9, cz, ROOF_R, 4.4, 0x2f5d7c);
    this.roof(cx, y + 13.2, cz, 11, 3.4, 0x2f5d7c);
    this.solid(cx, y + 17.6, cz, 0.5, 1.6, 0.5, 0xc9a227, 'stone');
    this.lantern(cx, y + 21, cz, 0x8fe3ff);

    /**
     * Great bell, standing ON the terrace.
     *
     * It was centred at y+4.2 with a half-height of 1.5 while the terrace it
     * belongs to tops out at y+1.4, so it hung 1.3 clear of the floor. Its
     * collider was worse: half-extents of 1.5 around a cylinder scaled to
     * 1.5 ACROSS, so the invisible wall was twice the width of the bell and
     * you bounced off nothing, a stride short of it.
     */
    const bellR = 0.75, bellH = 3.0;
    const bellY = y + 1.4 + bellH / 2;
    this.batches.post.add(cx + 15, bellY, cz + 4, bellR * 2, bellH, bellR * 2, 0x6b5a2a);
    this.collision.addBox(cx + 15, bellY, cz + 4, bellR, bellH / 2, bellR, 'stone');

    this.torii(cx, cz + 24, 0, 1.9);
    this.spawnPoints.push([cx + 8, y + 2.5, cz + 10]);

    // A ladder of lanterns climbing the mountain face toward the shrine —
    // this is the intended "grapple highway" up from the valley.
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const lx = Math.sin(t * 5.1) * 26;
      const lz = lerp(-46, cz + 20, t);
      const ly = lerp(this.heightAt(lx, lz) + 14, y + 8, t) + Math.sin(t * 9) * 4;
      this.lantern(lx, ly, lz, 0x9fe0ff);
    }
  }

  // ------------------------------------------------------ bamboo grove (E)

  _buildBambooGrove() {
    const cx = 128, cz = 26, rnd = this.rnd;

    // The shrine sits at the heart of the grove, in a clearing. Placed first
    // so the planting below can be told to keep out of it.
    const sx = cx, sz = cz;
    const CLEARING = 9.5;
    this._clear(sx, sz, CLEARING);

    // Dense bamboo — thin tall posts, cheap and very readable.
    for (let i = 0; i < 190; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 42;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      // Nothing grows in the clearing. Without this the shrine ends up with
      // stalks through its skull, which reads as a bug rather than a shrine.
      if (!this._isClear(x, z)) continue;
      const y = this.heightAt(x, z);
      if (y < CFG.world.waterLevel + 0.5) continue;
      const h = 11 + rnd() * 10;
      const g = 0x6fae3e + (Math.floor(rnd() * 3) * 0x000a00);
      this.batches.post.add(x, y + h / 2, z, 0.18, h, 0.18, g);
      // Only the thicker stalks are solid, so running through stays fluid.
      if (rnd() < 0.35) this.collision.addBox(x, y + h / 2, z, 0.26, h / 2, 0.26, 'bamboo');
      // Leaf tuft.
      this.batches.blob.add(x, y + h, z, 1.1, 1.5, 1.1, 0x7cc24a);
    }

    // A deliberate wall of taller, denser bamboo right on the clearing's edge,
    // so the shrine is hidden until you are inside it and then unmissable.
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + rnd() * 0.06;
      const d = CLEARING + 0.4 + rnd() * 2.2;
      const x = sx + Math.cos(a) * d, z = sz + Math.sin(a) * d;
      const y = this.heightAt(x, z);
      if (y < CFG.world.waterLevel + 0.5) continue;
      const h = 15 + rnd() * 9;
      this.batches.post.add(x, y + h / 2, z, 0.2, h, 0.2, 0x64a336);
      this.batches.blob.add(x, y + h, z, 1.2, 1.7, 1.2, 0x86cf52);
    }

    this._buildShrineClearing(sx, sz, CLEARING);

    // Canopy platforms strung through the grove.
    const plats = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const d = 12 + (i % 3) * 11;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const py = this.heightAt(x, z) + 11 + (i % 4) * 3.5;
      this.solid(x, py, z, 3.6, 0.32, 3.6, 0x8a6a45, 'wood');
      this.deco(x, py + 0.42, z, 3.4, 0.1, 3.4, 0x9d7a50);
      // Corner rails, both decorative and a visual "you can land here" cue.
      for (const [ox, oz] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) {
        this.deco(x + ox, py + 1.0, z + oz, 0.14, 1.0, 0.14, 0x5f462c);
      }
      this.lantern(x, py + 5.5, z, 0xa8ff7d);
      plats.push([x, py, z]);
    }
    this.bambooPlatforms = plats;
    this.spawnPoints.push([cx - 20, this.heightAt(cx - 20, cz + 6) + 1, cz + 6]);
    this.spawnPoints.push([plats[0][0], plats[0][1] + 1.5, plats[0][2]]);
  }

  /**
   * The clearing the golden frog stands in.
   *
   * Everything here is staging for one thing: making a player who stumbles
   * into it stop. A cut stone floor where the rest of the grove is dirt, a
   * path that plainly leads somewhere, gold lanterns instead of the grove's
   * green ones, and an approach that frames the statue head-on.
   */
  _buildShrineClearing(x, z, radius) {
    const gy = this.heightAt(x, z);

    // Flagstone floor, so the clearing is obviously made rather than found.
    const step = 3.2;
    for (let ax = -radius; ax <= radius; ax += step) {
      for (let az = -radius; az <= radius; az += step) {
        if (Math.hypot(ax + step / 2, az + step / 2) > radius - 0.4) continue;
        const shade = 0x6a6357 + (Math.floor(this.rnd() * 3) * 0x040404);
        this.deco(x + ax + step / 2, gy + 0.06, z + az + step / 2,
          step * 0.5, 0.06, step * 0.5, shade);
      }
    }
    this.collision.addBox(x, gy - 0.1, z, radius, 0.2, radius, 'stone');

    // Two rings of gold inlay around the plinth.
    for (const r of [5.2, 7.4]) {
      const n = Math.round(r * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.deco(x + Math.cos(a) * r, gy + 0.14, z + Math.sin(a) * r,
          0.5, 0.04, 0.16, 0xc9a227, a);
      }
    }

    // A path in from the south — it reads as "this way" from outside.
    for (let i = 0; i < 7; i++) {
      this.deco(x, gy + 0.10, z + radius + 1.2 + i * 2.6, 1.5, 0.05, 1.0, 0x6a6357);
    }

    // Gold lanterns on posts, facing the approach. The rest of the grove is
    // lit green, so this corner of the map is the only warm light in it.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const px = x + Math.cos(a) * 6.6, pz = z + Math.sin(a) * 6.6;
      const py = this.heightAt(px, pz);
      this.solid(px, py + 1.7, pz, 0.22, 1.7, 0.22, 0x4a3a24, 'wood');
      this.lantern(px, py + 4.0, pz, 0xffd76b);
    }

    // A torii on the path, because you do not put a gate in front of nothing.
    this.torii(x, z + radius + 3.0, 0, 0.95);

    this._buildFrogathStatue(x, gy, z);
  }

  // ═══════════════════════════════════════════════════ SHIZUKA WARD (city)

  /**
   * ═══ A CITY THAT EVERYBODY LEFT THIS MORNING ═════════════════════════════
   *
   * Abandoned, but not ruined. Nothing here is broken, overgrown or on fire:
   * the lamps are lit, the vending machines hum, a shop sign is still
   * flickering and there are cars parked neatly at the kerb with one or two
   * abandoned at an angle in the road. The only thing missing is people.
   *
   * That is the whole brief, and it is a discipline rather than a look — the
   * temptation with an empty city is to add rubble, and rubble turns "where
   * did they all go" into "something happened here", which is a different and
   * much less interesting question.
   *
   * ── how it is laid out ────────────────────────────────────────────────
   * A road GRID, not a landscape. `CITY.pitch` sets the block spacing and
   * `CITY.road` the width of the asphalt between them; everything else —
   * pavements, crossings, lamp spacing, where a car may park — is measured
   * off those two numbers, so the ward can be made denser or wider by
   * changing one of them rather than by moving three hundred objects.
   *
   * The ground mesh IS the road: the terrain palette is asphalt, and every
   * block sits on a raised concrete pavement. So a road is simply where no
   * block was built, which means the grid can never disagree with itself.
   */
  _buildCity() {
    const C = CITY;
    const R = this.rnd;
    const half = Math.floor(C.span / 2);

    /**
     * Every block, and what stands on it — decided first, built after.
     *
     * The centre block is left empty on purpose: it is the arena everybody
     * lands in, and a map whose middle is a building is a map where the
     * first thing anybody does is walk round a wall.
     */
    for (let bx = -half; bx <= half; bx++) {
      for (let bz = -half; bz <= half; bz++) {
        const cx = bx * C.pitch;
        const cz = bz * C.pitch;
        // SQUARE reach — see CITY.reach. `d` stays radial below, because
        // what it is used for there is "how near the middle am I", which is
        // a distance and not an edge.
        if (Math.max(Math.abs(cx), Math.abs(cz)) > C.reach) continue;
        const d = Math.hypot(cx, cz);

        const inner = C.pitch * 0.5 - C.road * 0.5;   // half the buildable pad
        this._cityPavement(cx, cz, inner);
        this._clear(cx, cz, inner + 2);

        /**
         * A spawn beside every other block. The generic fallback puts six
         * points on a 22-unit ring, which on a ward three hundred across
         * means every match opens with everybody standing in one plaza.
         */
        if (d > C.pitch && ((bx + bz) & 1) === 0) {
          this.spawnPoints.push([cx + C.pitch * 0.5, this.groundY + 1.2, cz]);
        }

        // The central plaza, and the four crossings around it.
        if (bx === 0 && bz === 0) { this._cityPlaza(cx, cz, inner); continue; }

        /**
         * The block the bridge lands on is left as an open approach.
         *
         * `_cityBridgeDeck` ramps up from 150 to the deck at 176, and that
         * run passes straight through this plot — so a building here would
         * be a tower with a road through the middle of it. Leaving it bare
         * also gives the closure somewhere to be seen from.
         */
        if (bx === Math.floor(C.reach / C.pitch) && bz === 0) continue;

        /**
         * Towers toward the middle, low shops at the edges. A skyline has
         * to have a shape or the whole ward reads as one height, and the
         * cheapest shape that works is "tall in the centre".
         */
        /**
         * Apartments are the RULE and shophouses the exception, which is the
         * other way round from the first draft. The reference is a street
         * canyon — grey slabs with window grids on both sides of a wide
         * avenue — and a ward that was mostly two-storey shops read as a
         * model village with a couple of towers dropped into it.
         */
        const near = 1 - Math.min(1, d / C.reach);
        if (R() < 0.66 + near * 0.26) {
          this._cityTower(cx, cz, inner, near, R() < 0.5);
        } else this._cityShops(cx, cz, inner);
      }
    }
  }

  /**
   * The raised concrete a block stands on, and the kerb round it.
   *
   * Half a unit up, which is a kerb you step over rather than a ledge you
   * have to jump — `stepHeight` is 0.65, so this is deliberately inside it.
   * A city you have to jump to cross is a city nobody runs through.
   */
  _cityPavement(cx, cz, r) {
    const g = this.groundY;
    this.deco(cx, g + 0.24, cz, r, 0.26, r, 0x8e8b82);
    this.collision.addBox(cx, g + 0.24, cz, r, 0.26, r, 'deck');
    // A darker kerb band, so the edge of the pavement reads from the road.
    for (const [ox, oz, hx, hz] of [
      [0, -r, r, 0.45], [0, r, r, 0.45], [-r, 0, 0.45, r], [r, 0, 0.45, r],
    ]) {
      this.deco(cx + ox, g + 0.50, cz + oz, hx, 0.06, hz, 0x6f6c63);
    }
    // Paving joints. Cheap, and it stops a forty-unit slab reading as one
    // flat colour from a rooftop.
    const R = this.rnd;
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      this.deco(cx - r + t * r * 2, g + 0.51, cz, 0.06, 0.02, r, 0x7e7b73);
      this.deco(cx, g + 0.51, cz - r + t * r * 2, r, 0.02, 0.06, 0x7e7b73);
    }
    void R;
  }

  /**
   * An apartment block: a slab with a grid of windows on every face.
   *
   * The windows are what make it read as Japanese social housing rather than
   * as a grey box — evenly spaced, small, and the same on all four sides.
   * A handful are LIT, and that is the single strongest "still alive" cue in
   * the map: one warm rectangle nine floors up says somebody's timer is
   * still running.
   */
  _cityTower(cx, cz, pad, near, longX) {
    const R = this.rnd;
    /**
     * A SLAB, not a cube. `lon` runs along the building's frontage and `sht`
     * is its depth, and which of those is x and which is z is the one thing
     * that stops a grid of blocks reading as a grid of dice. It very nearly
     * fills its plot, so two facing blocks make a street canyon rather than
     * two huts on two lawns.
     */
    const lon = pad * (0.82 + R() * 0.14);
    const sht = pad * (0.46 + R() * 0.22);
    const w = longX ? lon : sht;
    const d = longX ? sht : lon;
    const floors = Math.round(7 + near * 11 + R() * 4);
    const fh = 3.2;                                   // one storey
    const h = floors * fh;
    const g = this.groundY + 0.5;
    const body = [0x9a9a95, 0x8e908c, 0xa4a29a][Math.floor(R() * 3)];

    this.solid(cx, g + h * 0.5, cz, w, h * 0.5, d, body, 'stone');
    // A darker plinth at street level. Two storeys of shade under twenty of
    // pale concrete is what stops the slab reading as one flat wall.
    this.deco(cx, g + 1.8, cz, w + 0.14, 1.8, d + 0.14, 0x6f716f);
    // The roof slab, walkable, with a parapet you can take cover behind.
    this.collision.addBox(cx, g + h + 0.2, cz, w, 0.3, d, 'roof');
    this.deco(cx, g + h + 0.2, cz, w + 0.3, 0.3, d + 0.3, 0x7e807c);
    for (const [ox, oz, hx, hz] of [
      [0, -d, w, 0.3], [0, d, w, 0.3], [-w, 0, 0.3, d], [w, 0, 0.3, d],
    ]) {
      this.deco(cx + ox, g + h + 0.9, cz + oz, hx, 0.5, hz, 0x9a9c98);
      this.collision.addBox(cx + ox, g + h + 0.9, cz + oz, hx, 0.5, hz, 'stone');
    }

    /**
     * WINDOWS. Four faces, one grid each, pushed 0.06 proud of the wall.
     *
     * Drawn as deco rather than as a texture because this whole game is
     * untextured — and at this scale a grid of small dark quads is exactly
     * what a texture would have drawn anyway.
     */
    const lit = 0xffd9a0;
    const dark = 0x353a45;
    for (let f = 0; f < floors; f++) {
      const y = g + f * fh + fh * 0.55;
      /**
       * Each face gets the half-extent it ACTUALLY has. The first draft
       * spread the ±z windows over `w` and then pushed them out by `w` as
       * well, so on any slab that was not square the front windows floated
       * off the wall and the side windows were buried inside it. `spread`
       * is along the face, `depth` is out to it, and they are never the same
       * number on a slab.
       */
      for (const ax of ['z', 'x']) {
        for (const s of [1, -1]) {
          const spread = ax === 'z' ? w : d;
          const depth = ax === 'z' ? d : w;
          const long = spread >= depth;

          // The balcony ledge. One thin line per floor, and it is most of
          // what makes a grey box read as somewhere people lived.
          if (ax === 'z') {
            this.deco(cx, y - fh * 0.42, cz + s * (depth + 0.2),
              spread * 0.96, 0.09, 0.2, 0x7a7c78);
          } else {
            this.deco(cx + s * (depth + 0.2), y - fh * 0.42, cz,
              0.2, 0.09, spread * 0.96, 0x7a7c78);
          }

          const cols = long ? Math.max(3, Math.round(spread / 2.2)) : 2;
          for (let i = 0; i < cols; i++) {
            const t = (i + 0.5) / cols;
            const off = (t - 0.5) * spread * 1.86;
            const col = R() < 0.06 ? lit : dark;
            if (ax === 'z') {
              this.deco(cx + off, y, cz + s * (depth + 0.07), 0.66, 0.8, 0.06, col);
            } else {
              this.deco(cx + s * (depth + 0.07), y, cz + off, 0.06, 0.8, 0.66, col);
            }
          }
        }
      }
    }

    /**
     * The rooftop water tank, on four short legs. Every building of this
     * kind in Japan has one, it is the only cover in a rooftop fight, and it
     * gives the skyline something other than flat lids.
     */
    const tw = Math.max(1.2, Math.min(w, d) * 0.36);
    for (const ox of [-tw * 0.78, tw * 0.78]) {
      for (const oz of [-tw * 0.78, tw * 0.78]) {
        this.deco(cx + ox, g + h + 1.3, cz + oz, 0.15, 1.1, 0.15, 0x5f6166);
      }
    }
    this.solid(cx, g + h + 3.3, cz, tw, 0.9, tw, 0x8c9096, 'stone');

    // A rooftop billboard on a third of them: the only saturated colour
    // anything above ten storeys has.
    if (R() < 0.34) {
      const bc = CITY.signs[Math.floor(R() * CITY.signs.length)];
      this.deco(cx, g + h + 3.6, cz + d * 0.76, w * 0.72, 2.3, 0.16, bc);
    }

    /**
     * And a banner down the corner of the facade on half of them.
     *
     * Structurally this ward is entirely grey, and the reference is not —
     * the thing that reads as Japanese in it is a cyan or a red sign running
     * six storeys down the side of an otherwise plain concrete block. The
     * rooftop billboards only pay off from a roof; this is the one you see
     * from the pavement, which is where the game is played.
     */
    if (R() < 0.5) {
      const sc = CITY.signs[Math.floor(R() * CITY.signs.length)];
      const sh = Math.min(h * 0.42, 9 + R() * 7);
      const top = g + h - 2 - R() * (h * 0.3);
      const ex = R() < 0.5 ? 1 : -1, ez = R() < 0.5 ? 1 : -1;
      this.deco(cx + ex * (w * 0.84), top - sh * 0.5, cz + ez * (d + 0.3),
        0.55, sh * 0.5, 0.14, sc);
    }

    /**
     * An external stair up the side, which is how you get to the roof.
     *
     * Every tower has one. A city of unclimbable slabs would waste the best
     * thing about a city map, and a grapple-only route would lock the
     * rooftops to whoever brought the tongue.
     */
    const side = Math.floor(R() * 4);
    const sx = side === 0 ? 1 : (side === 1 ? -1 : 0);
    const sz = side === 2 ? 1 : (side === 3 ? -1 : 0);
    /**
     * The face it climbs is `w` out on the x sides and `d` out on the z
     * sides — the same pairing the windows needed, and swapped here in
     * exactly the same way. On a square tower it made no difference; on a
     * slab it buried the whole flight inside the wall on two faces and hung
     * it in mid-air on the other two.
     */
    const steps = Math.ceil(h / 1.6);
    for (let i = 0; i < steps; i++) {
      const y = g + (i + 1) * (h / steps);
      const out = 1.4 + (i % 2) * 0.25;
      const px = cx + sx * (w + out) + (sx ? 0 : (i - steps / 2) * (w * 2 / steps));
      const pz = cz + sz * (d + out) + (sz ? 0 : (i - steps / 2) * (d * 2 / steps));
      this.solid(px, y, pz, 1.5, 0.14, 1.5, 0x5f6166, 'deck');
    }
    // And an aircraft beacon, above the tank, which doubles as the anchor.
    this.lantern(cx, g + h + 5.2, cz, 0xff6a5a);
  }

  /**
   * A row of shophouses: two or three storeys, awnings, and vertical signs.
   *
   * The signs are the colour in this map. Everything structural is grey, so
   * a cyan or a red banner four storeys tall is the only saturated thing in
   * a street and does all the work of telling one block from another.
   */
  _cityShops(cx, cz, pad) {
    const R = this.rnd;
    const g = this.groundY + 0.5;
    const dep = pad * 0.38;                 // how far back from the kerb

    /**
     * A TERRACE round all four sides of the plot, not a few detached huts in
     * the middle of it. A shophouse block that leaves its frontage empty
     * leaves a forty-unit concrete apron facing the street, which was the
     * single thing that made the first ward read as a diorama. The corners
     * are allowed to run into each other — in a city that is a corner shop.
     */
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const n = 3 + Math.floor(R() * 2);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const off = (t - 0.5) * pad * 1.86;
        const uw = (pad * 1.86) / n * 0.47;
        const h = 6.5 + R() * 6.5;
        const wall = [0xa8a49c, 0x9a9690, 0xb0aaa0, 0x8f8a82][Math.floor(R() * 4)];
        const px = cx + nx * (pad - dep) + (nx ? 0 : off);
        const pz = cz + nz * (pad - dep) + (nz ? 0 : off);
        const hx = nx ? dep : uw;
        const hz = nz ? dep : uw;
        this.solid(px, g + h * 0.5, pz, hx, h * 0.5, hz, wall, 'stone');
        this.collision.addBox(px, g + h + 0.2, pz, hx, 0.3, hz, 'roof');
        this.deco(px, g + h + 0.2, pz, hx + 0.22, 0.3, hz + 0.22, 0x6f6c64);

        // The shopfront: a dark glazed recess facing the street.
        this.deco(px + nx * (dep + 0.06), g + 1.5, pz + nz * (dep + 0.06),
          nx ? 0.06 : uw * 0.78, 1.5, nz ? 0.06 : uw * 0.78, 0x23272e);
        // And a striped awning over it.
        this.deco(px + nx * (dep + 0.55), g + 3.2, pz + nz * (dep + 0.55),
          nx ? 0.6 : uw * 0.88, 0.12, nz ? 0.6 : uw * 0.88,
          R() < 0.5 ? 0xc4483c : 0x2f7f8a);

        // A vertical sign board, hung off the corner and most of the height
        // of the building. These are the colour in the whole ward.
        if (R() < 0.72) {
          const col = CITY.signs[Math.floor(R() * CITY.signs.length)];
          const sh = h * (0.4 + R() * 0.34);
          this.deco(
            px + nx * (dep + 0.35) + (nx ? 0 : uw * 0.84),
            g + h - sh * 0.5,
            pz + nz * (dep + 0.35) + (nz ? 0 : uw * 0.84),
            nx ? 0.12 : 0.5, sh * 0.5, nz ? 0.5 : 0.12, col);
        }
      }
    }
  }

  /**
   * The middle of the ward: an open crossing with a shelter and the ring.
   *
   * Left deliberately bare. It is where everybody spawns and where most
   * fights start, and the one thing a fighting space must not have is
   * furniture to snag on.
   */
  _cityPlaza(cx, cz, pad) {
    const g = this.groundY;
    /**
     * PAVING, not paint. This used to be nine white bars each way, which
     * from any rooftop read as a chessboard dropped in the middle of a grey
     * city. Joint lines do the same job of breaking up a forty-unit slab
     * without announcing themselves; the zebra stripes now live at the
     * junctions, where a crossing actually goes.
     */
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7;
      const o = (t - 0.5) * pad * 1.86;
      this.deco(cx + o, g + 0.52, cz, 0.08, 0.02, pad * 0.94, 0x74716a);
      this.deco(cx, g + 0.52, cz + o, pad * 0.94, 0.02, 0.08, 0x74716a);
    }
    // Planters round the edge: clipped, alive, and nobody is watering them.
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bx = cx + ox * pad * 0.84, bz = cz + oz * pad * 0.84;
      this.solid(bx, g + 0.95, bz, 1.5, 0.45, 1.5, 0x6b6860, 'stone');
      this.deco(bx, g + 1.9, bz, 1.25, 0.6, 1.25, 0x4c6a44);
    }

    /**
     * THE ALTAR, THE RING AND THE DUMMIES.
     *
     * Every map owes the game these three, and the ward was built without
     * them — which nothing about the ward itself would ever have told me:
     * it renders beautifully and then you cannot hand in a crystal, cannot
     * try a skin and have nothing to hit. The valley hides them in its arena
     * and the Mire on its widest island, so the city's plaza is the same
     * answer to the same question: the one open space on the map.
     *
     * The bus shelter that used to stand here is gone. The plinth is better
     * cover than it was, and the middle of a fighting space does not want
     * two things to snag on.
     */
    const deck = g + 0.5;                    // the plaza pavement, not the road
    this._buildFrogathStatue(cx, deck, cz);
    this._buildPracticeRing(cx + 10.5, deck + 0.1, cz, 4.2);

    // Four dummies round the edge, each facing the altar.
    for (const [dx, dz] of [[0, 10.5], [-10.5, 0], [0, -10.5], [-7.4, 7.4]]) {
      this.dummySpots.push([cx + dx, deck + 0.18, cz + dz,
        Math.atan2(-dx, -dz)]);
    }

    this.spawnPoints.push([cx + 11, g + 1.2, cz + 11]);
    this.spawnPoints.push([cx - 11, g + 1.2, cz - 11]);
  }

  /**
   * ═══ THE STREETS ════════════════════════════════════════════════════════
   *
   * Lane markings, lamps, utility poles and the wires between them.
   *
   * All of it is placed off the same grid the blocks are, so a lamp is never
   * inside a building and a wire never crosses one. The lamps are the
   * grapple highway: one on every corner at five and a half units, which is
   * a tongue's length apart along any street.
   */
  _buildCityStreets() {
    const C = CITY;
    const R = this.rnd;
    const g = this.groundY;
    const half = Math.floor(C.span / 2);
    /**
     * Three numbers, all derived, all SQUARE — because the ward is.
     *
     *   far()  the ward's own ruler, `max(|x|, |z|)`
     *   road   the outermost street centreline. One half-pitch inside the
     *          last block centre, so the ring past the final blocks — which
     *          would be painted onto the rim — never gets built.
     *   paint  how far a lane marking may run along a street: out to the
     *          block edge plus the outskirts, and short of the rim.
     */
    const far = (a, b) => Math.max(Math.abs(a), Math.abs(b));
    const road = C.reach - C.pitch * 0.5;
    const paint = C.reach + C.pitch * 0.5 - 8;

    /**
     * EVERY line here is a HALF-pitch. `k * pitch` is where a block stands;
     * the asphalt is the gap between two of them, so a road runs at
     * `(k + 0.5) * pitch` and the loop has to start one short of the block
     * range to pick up the outermost street.
     */
    for (let k = -half - 1; k <= half; k++) {
      const line = (k + 0.5) * C.pitch;
      if (Math.abs(line) > road) continue;

      /**
       * Lane markings, and the long yellow pair the reference has. Dashes
       * rather than a solid strip: a solid one reads as a painted floor,
       * dashes read as a road. Each dash is culled against the ward's edge
       * so the paint stops where the asphalt does.
       */
      for (let m = -paint; m < paint; m += 9) {
        if (far(line, m) > paint) continue;
        this.deco(line, g + 0.03, m + 2.2, 0.16, 0.02, 2.2, 0xd8d6cc);
        this.deco(m + 2.2, g + 0.03, line, 2.2, 0.02, 0.16, 0xd8d6cc);
      }
      for (let m = -paint; m < paint; m += 12) {
        if (far(line, m) > paint) continue;
        this.deco(line - 1.6, g + 0.03, m + 6, 0.13, 0.02, 6, 0xc8a634);
        this.deco(m + 6, g + 0.03, line - 1.6, 6, 0.02, 0.13, 0xc8a634);
      }

      // Lamps at the kerb, one pair per block frontage — so they run down
      // BOTH sides of every street at mid-block, clear of the junctions.
      const kerb = C.road * 0.5 - 1.1;
      for (let m = -half; m <= half; m++) {
        const at = m * C.pitch;
        if (far(line, at) > C.reach) continue;
        // Checkerboarded off (k, m) so the lit ones alternate ALONG a street
        // rather than lighting one whole side and leaving the other dark.
        const lit = ((k + m) & 1) === 0;
        for (const s of [-1, 1]) {
          this._cityLamp(line + s * kerb, at, lit);
          this._cityLamp(at, line + s * kerb, lit);
        }

        /**
         * THE OVERHEAD WIRES.
         *
         * The docstring above this function has promised these since the
         * ward was written and there were none — which is worse than an
         * omission, because a comment that describes something that is not
         * there is the thing the next reader trusts. They are also the most
         * Japanese object on the whole map: nothing else says "a street in
         * Japan" as quickly as cable strung pole to pole over the road.
         *
         * Two segments per span with a metre of sag between them. One
         * straight box over forty-eight units reads as a scaffolding pole.
         */
        const next = (m + 1) * C.pitch;
        if (far(line, next) <= C.reach) {
          /**
           * Thin, and ABOVE the eye-line. The first pass hung them at five
           * units and a tenth of a unit thick, which from the pavement was
           * a black bar straight across the middle of every shot — cable
           * that reads as scaffolding is worse than no cable. 6.4 puts them
           * over a frog's head and clear of the shopfronts, and 0.07 is thin
           * enough to be a line rather than a beam.
           */
          const wy = this.groundY + 0.5 + 6.4;
          const hs = C.pitch * 0.25;             // half of half a span
          const sag = 0.9;
          const tilt = Math.atan2(sag, hs * 2);
          for (const s of [-1, 1]) {
            for (const e of [-1, 1]) {
              const mid = at + C.pitch * 0.5 + e * hs;
              // Down the street that runs in z, then the one that runs in x.
              this.deco(line + s * kerb, wy - sag * 0.5, mid,
                0.035, 0.035, hs, 0x24272c, 0, e * tilt, 0);
              this.deco(mid, wy - sag * 0.5, line + s * kerb,
                hs, 0.035, 0.035, 0x24272c, 0, 0, -e * tilt);
            }
          }
        }
        // A vending machine every so often: lit, humming, and the clearest
        // sign in the map that the power is still on.
        if (R() < 0.4) this._cityVendor(line + (C.road * 0.5 - 1.5), at + 5);
        if (R() < 0.4) this._cityVendor(at + 5, line - (C.road * 0.5 - 1.5));
      }

      /**
       * Zebra crossings on the approaches to every junction. A junction is
       * where two half-pitch lines meet, which is why `at` is a half-pitch
       * here and a whole one in the loop above.
       */
      for (let m = -half - 1; m <= half; m++) {
        const at = (m + 0.5) * C.pitch;
        // A junction needs a street on BOTH axes, so it is culled against
        // the outermost centreline, not against the ward's edge.
        if (far(line, at) > road) continue;
        for (const s of [-1, 1]) {
          for (let i = 0; i < 6; i++) {
            const t = (i + 0.5) / 6;
            const o = (t - 0.5) * C.road * 0.82;
            this.deco(line + o, g + 0.04, at + s * (C.road * 0.5 + 1.8),
              0.45, 0.02, 1.15, 0xd8d6cc);
            this.deco(at + s * (C.road * 0.5 + 1.8), g + 0.04, line + o,
              1.15, 0.02, 0.45, 0xd8d6cc);
          }
          /**
           * A traffic light on each CORNER of the junction, still cycling.
           * With the vending machines and the handful of lit windows this is
           * the whole of "alive" — the power is on and nobody is under it.
           *
           * Both coordinates have to come off their own centreline. These
           * used to be offset on one axis and left on the other, which stood
           * a post squarely in the middle of the crossing road — visible the
           * moment the ward was rendered down an avenue, and in the source
           * just two lines that each looked right on their own.
           *
           * 9.2 out is 1.2 inside the kerb, so they stand on the pavement.
           */
          for (const t of [-1, 1]) {
            const tx = line + s * (C.road * 0.5 + 1.2);
            const tz = at + t * (C.road * 0.5 + 1.2);
            this.batches.post.add(tx, g + 2.6, tz, 0.13, 5.2, 0.13, 0x2f3238);
            this.collision.addBox(tx, g + 2.6, tz, 0.2, 2.6, 0.2, 'stone');
            this.deco(tx, g + 5.0, tz, 0.2, 0.6, 0.2,
              R() < 0.5 ? 0x3f8f4a : 0xd8483c);
          }
        }
      }
    }
    void g;
  }

  /**
   * One street lamp: a dark post, a yellow head, and — on half of them — a
   * lit globe that is also a grapple anchor.
   *
   * `lit` is a COST control, and it is the one number in the ward that is
   * about frame rate rather than about looks. `World.lantern` is not
   * batched: each one adds a sphere mesh, an additive sprite and an entry
   * in the per-frame bob list, so at the ward's new size lighting every
   * lamp came to roughly eight hundred draw calls against the valley's
   * hundred and fifty. Post and head are instanced and stay on all of
   * them, so the street looks identical; only every other globe glows.
   *
   * Safe for the grapple highway with room to spare: lamps are a half
   * pitch apart, so lighting every other one leaves anchors 44 units
   * apart against a tongue that reaches 62 — and every lamp post, kerb
   * and wall in the ward is grappleable anyway.
   */
  _cityLamp(x, z, lit = true) {
    const g = this.groundY + 0.5;
    this.batches.post.add(x, g + 2.8, z, 0.17, 5.6, 0.17, 0x2f3238);
    this.collision.addBox(x, g + 2.8, z, 0.24, 2.8, 0.24, 'stone');
    // The head is the yellow slab the reference hangs off every pole.
    this.deco(x, g + 5.7, z, 0.75, 0.22, 0.34, 0xe8c23a);
    if (lit) this.lantern(x, g + 5.5, z, 0xffca6b);
    else this.deco(x, g + 5.5, z, 0.3, 0.2, 0.3, 0xffca6b);
  }

  /** A vending machine. The hum is the point; the light is how you see it. */
  _cityVendor(x, z) {
    const g = this.groundY + 0.5;
    const col = this.rnd() < 0.5 ? 0xc4483c : 0x2f7f8a;
    this.solid(x, g + 0.95, z, 0.7, 0.95, 0.4, col, 'stone');
    this.deco(x, g + 1.25, z + 0.44, 0.52, 0.55, 0.06, 0xfff0c4);
    this.deco(x, g + 0.35, z + 0.44, 0.52, 0.12, 0.06, 0x2a2e36);
  }

  /**
   * ═══ THE CARS ═══════════════════════════════════════════════════════════
   *
   * Parked at the kerb, mostly, and a few left at an angle in the road.
   *
   * They are SOLID and about waist high, which makes them the map's cover —
   * a street with nothing in it is a shooting gallery, and a street with a
   * line of parked cars down each side is a fight. The ones abandoned at an
   * angle are the ones that tell the story, so there are only a handful:
   * a road full of crashed cars is a disaster, and this is a Tuesday where
   * nobody came back.
   */
  _buildCityCars() {
    const C = CITY;
    const R = this.rnd;
    const half = Math.floor(C.span / 2);
    // The same square rulers the streets use: cars park on a street, so
    // they have to stop exactly where the street does.
    const far = (a, b) => Math.max(Math.abs(a), Math.abs(b));
    const road = C.reach - C.pitch * 0.5;
    const lim = C.reach + C.pitch * 0.5 - 8;

    for (let k = -half - 1; k <= half; k++) {
      const line = (k + 0.5) * C.pitch;          // the asphalt, not the block
      if (Math.abs(line) > road) continue;
      for (let m = -lim + 8; m < lim - 8; m += 9 + R() * 8) {
        if (far(line, m) > lim) continue;
        /**
         * Tucked against the kerb, nose-to-tail, on alternating sides.
         *
         * A car built long in its own +X has to be turned a QUARTER to park
         * along a road that runs in z. These two were the wrong way round,
         * which parked every car broadside across the kerb — obvious the
         * moment it was rendered and invisible in the source.
         */
        if (R() < 0.6) {
          const s = R() < 0.5 ? -1 : 1;
          this._car(line + s * (C.road * 0.5 - 2.3), m, Math.PI / 2, R);
        }
        if (R() < 0.6) {
          const s = R() < 0.5 ? -1 : 1;
          this._car(m, line + s * (C.road * 0.5 - 2.3), 0, R);
        }
        // And one in twenty stopped dead where it was, turned across a lane.
        // Offset off the centreline, which is where the skyway stairs land.
        if (R() < 0.05) {
          const s = R() < 0.5 ? -1 : 1;
          this._car(line + s * (3 + R() * 2), m, Math.PI / 2 + (R() - 0.5) * 1.6, R);
        }
      }
    }
  }

  /**
   * One car. A body, a cabin, four wheels and a pair of lights.
   *
   * Built from the shared batches like everything else, so a hundred and
   * sixty of them cost six instanced draws rather than a hundred and sixty
   * meshes. The collider is ONE box at body height: wheels you can catch a
   * foot on would make the streets miserable to run down.
   */
  _car(x, z, rot, R) {
    const g = this.groundY + 0.5;
    const col = CITY.cars[Math.floor(R() * CITY.cars.length)];
    const L = 2.1, W = 0.95;
    /**
     * The body is long in its own LOCAL +X, so every part hung off it has to
     * be placed along that axis after rotation: a local (1,0,0) turned by
     * `rot` about Y comes out at (cos, 0, -sin). The lights were being put
     * on (sin, 0, cos) — the local +Z — which stuck the headlamps on the
     * driver's door and the tail lights on the passenger's.
     */
    const s = Math.sin(rot), c = Math.cos(rot);
    const fx = c, fz = -s;                          // the way the car points
    this.batches.box.add(x, g + 0.62, z, L * 2, 0.72, W * 2, col, rot);
    // The cabin, set back and slightly narrower — that step is most of what
    // makes a box read as a car at a glance.
    this.batches.box.add(x - fx * 0.15, g + 1.16, z - fz * 0.15,
      L * 1.05, 0.5, W * 1.72, 0x2e333c, rot);
    this.batches.box.add(x, g + 0.28, z, L * 2.02, 0.22, W * 1.78, 0x22262c, rot);
    // Wheels, as four dark pucks.
    for (const [ax, az] of [[-1.3, -0.82], [1.3, -0.82], [-1.3, 0.82], [1.3, 0.82]]) {
      this.batches.post.add(
        x + ax * c + az * s, g + 0.3, z - ax * s + az * c,
        0.32, 0.26, 0.32, 0x1c1f24, 0, 0, Math.PI / 2);
    }
    // Lights: one warm pair at the front, one red at the back.
    this.deco(x + fx * L * 0.98, g + 0.72, z + fz * L * 0.98, 0.08, 0.12, 0.55,
      0xffeab0, rot);
    this.deco(x - fx * L * 0.98, g + 0.72, z - fz * L * 0.98, 0.08, 0.12, 0.55,
      0xc4483c, rot);
    /**
     * `addBox` is axis-aligned and takes no rotation, so a car turned a
     * quarter used to keep a collider lying ACROSS the road while the car
     * itself lay along it — an invisible barricade on one side and a car you
     * could walk through on the other. These are the rotated box's own AABB.
     */
    this.collision.addBox(x, g + 0.62, z,
      Math.abs(c) * L * 0.98 + Math.abs(s) * W * 0.98, 0.62,
      Math.abs(s) * L * 0.98 + Math.abs(c) * W * 0.98, 'stone');
  }

  /**
   * ═══ THE SKYWAYS ════════════════════════════════════════════════════════
   *
   * Covered pedestrian bridges over the main avenues.
   *
   * These are what make the rooftops a place rather than a set of islands:
   * with the external stairs they give a continuous high route across the
   * ward, so a fight can start in the street and end four storeys up without
   * anybody needing a grapple. They sit at a fixed height so the route reads
   * as a level rather than as scattered ledges.
   */
  _buildCitySkyways() {
    const C = CITY;
    const g = this.groundY + 0.5;
    const y = g + C.skyway;
    const half = Math.floor(C.span / 2);

    // Again: the half-pitch is the street. A bridge OVER an avenue has to be
    // over the avenue, and it has to land on a building at BOTH ends — so
    // it is culled a whole block inside the ward's edge, not at it.
    const far = (a, b) => Math.max(Math.abs(a), Math.abs(b));
    const road = C.reach - C.pitch * 0.5;
    for (let k = -half - 1; k <= half; k++) {
      const line = (k + 0.5) * C.pitch;
      if (Math.abs(line) > road) continue;
      // Only over every other avenue, or the sky fills up with walkways.
      if (((k % 2) + 2) % 2 !== 0) continue;

      for (let m = -half; m <= half; m++) {
        const at = m * C.pitch;               // mid-block, clear of junctions
        if (far(line, at) > C.reach) continue;
        /**
         * Every other block ALONG the avenue as well as every other avenue.
         *
         * One per block was fine on a ward five blocks wide; at nine it put
         * nine bridges down a single street, which from the pavement is a
         * covered arcade rather than the occasional crossing overhead. The
         * high route stays continuous either way — the gap is one block, and
         * every tower on it has its own stair.
         */
        if (((m % 2) + 2) % 2 !== 0) continue;
        for (const [px, pz, sx, sz] of [
          [line, at, C.road * 0.68, 1.8],
          [at, line, 1.8, C.road * 0.68],
        ]) {
          const alongZ = sz > sx;             // which way the bridge runs
          this.solid(px, y, pz, sx, 0.22, sz, 0x6f7276, 'deck');
          // A roof, so it reads as a covered bridge from the street below.
          this.deco(px, y + 2.5, pz, sx + 0.15, 0.12, sz + 0.15, 0x5a5d61);
          // A kerb and a top rail down each side, rather than a solid panel
          // you cannot see the street through.
          for (const s of [-1, 1]) {
            const ox = alongZ ? s * sx : 0, oz = alongZ ? 0 : s * sz;
            const rx = alongZ ? 0.08 : sx, rz = alongZ ? sz : 0.08;
            this.deco(px + ox, y + 0.5, pz + oz, rx, 0.3, rz, 0x8a8d90);
            this.deco(px + ox, y + 1.35, pz + oz, rx, 0.07, rz, 0x8a8d90);
            this.deco(px + ox, y + 1.9, pz + oz, rx, 0.62, rz, 0x5a5d61);
          }
          this.lantern(px, y + 1.9, pz, 0x8fd8ff);

          /**
           * A stair down to the street, laid along the ROAD CENTRELINE.
           *
           * Without one the skyways are ledges you need a tongue to reach,
           * which locks the whole high route to whoever brought the grapple.
           * The centreline is the one strip of asphalt nothing parks on —
           * cars sit at `road/2 - 2.3` from it — so the stair can descend a
           * full fourteen units without ever coming down through a car.
           * Tagged 'deck', so `deckStep` carries the 1.5 rise per tread.
           */
          const steps = 9;
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const sy = y - t * C.skyway;
            const run = 2.2 + t * 13;
            if (alongZ) this.solid(px + run, sy, pz, 1.2, 0.12, 1.2, 0x5f6166, 'deck');
            else this.solid(px, sy, pz + run, 1.2, 0.12, 1.2, 0x5f6166, 'deck');
          }
        }
      }
    }
  }

  /**
   * ═══ THE WATERFRONT ═════════════════════════════════════════════════════
   *
   * A parapet along the top of the beach, all the way round the ward.
   *
   * It is what turns "the asphalt stops and then there is a slope" into an
   * edge somebody built: a low wall you can vault, with lamps on it and the
   * lake on the other side. It also stops the outermost pavements from
   * ending in mid-air, which is what the mountain used to hide.
   */
  _buildCityShore() {
    const C = CITY;
    const R = this.rnd;
    const g = this.groundY;
    const edge = C.reach + C.pitch * 0.5 - 4;     // 176, just past the kerbs

    for (const axis of ['x', 'z']) {
      for (const s of [-1, 1]) {
        for (let m = -edge; m <= edge; m += 4) {
          // The corners are built by the other axis, so stop short of them.
          if (Math.abs(m) > edge - 2) continue;
          const px = axis === 'x' ? s * edge : m;
          const pz = axis === 'x' ? m : s * edge;
          const hx = axis === 'x' ? 0.55 : 2.05;
          const hz = axis === 'x' ? 2.05 : 0.55;
          this.solid(px, g + 0.62, pz, hx, 0.62, hz, 0x8e8b82, 'stone');
          this.deco(px, g + 1.3, pz, hx + 0.12, 0.08, hz + 0.12, 0x6f6c63);
        }
        // Lamps along it, and a bench or two facing the water.
        for (let m = -edge + 20; m < edge - 20; m += 34) {
          const px = axis === 'x' ? s * (edge - 3) : m;
          const pz = axis === 'x' ? m : s * (edge - 3);
          this._cityLamp(px, pz, R() < 0.5);
        }
      }
    }
  }

  /**
   * ═══ THE CLOSED BRIDGE ══════════════════════════════════════════════════
   *
   * A red suspension bridge out of the ward, across the lake, to an island
   * you can see from the waterfront — and it is SHUT. Barriers across the
   * carriageway, hazard stripes, and signs saying so.
   *
   * ── why it is closed, structurally ────────────────────────────────────
   * Because the island is off the map. The heightfield stops at 210 and the
   * island sits at 436, so a frog that walked the whole span would be
   * standing on scenery with no ground under it and no way back except the
   * water. Rather than pretend that is fine, the closure is real: the
   * approach is solid and walkable up to a barrier you cannot get past, and
   * everything beyond it is a view. The signs are not set dressing
   * explaining a rule — they ARE the rule, and they sit exactly where it
   * starts.
   *
   * ── the shape ─────────────────────────────────────────────────────────
   * Two towers, each a pair of legs crossed by horizontal braces, a main
   * cable in two catenaries over them, and vertical suspenders down to the
   * deck. The cable is what makes a suspension bridge read as one, so it is
   * built as real sagging geometry rather than a straight line: 26 short
   * segments per span, each tilted to its own chord.
   */
  _buildCityBridge() {
    const B = {
      z: 0,
      deck: 13,                         // roadway height, ~11 above the water
      x0: 176, xa: 232, xb: 384, x1: 436,
      top: 74,                          // tower tops
      half: 7.0,                        // half the carriageway
      red: 0xc4462a, dark: 0x8e3220, lit: 0xd9603f,
      steel: 0x6a6e74,
    };
    this._cityBridgeDeck(B);
    this._cityBridgeTower(B, B.xa);
    this._cityBridgeTower(B, B.xb);
    this._cityBridgeCables(B);
    this._cityBridgeClosure(B);
    this._cityIsland(B);
  }

  /** The carriageway, its railings, and the piers holding it up. */
  _cityBridgeDeck(B) {
    const g = this.groundY;
    /**
     * The first stretch is SOLID and the rest is scenery.
     *
     * `solidTo` is a few units past the barrier, so the approach you can
     * actually reach has ground under it and the closure has something to
     * stand on. Past that the deck is deco: nothing can get there, and a
     * collider out at 400 would only be a shelf floating over open water.
     */
    const solidTo = B.x0 + 26;

    /**
     * The approach ramp, up off the street to deck height.
     *
     * It starts at 150, inside the ward — which is why `_buildCity` leaves
     * that plot empty. Tagged 'deck' so `deckStep` carries the rise, the
     * same as every other walkway in the game.
     */
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = 150 + t * (B.x0 - 150);
      const y = g + 0.5 + t * (B.deck - g - 0.5);
      this.solid(x, y, B.z, 1.2, 0.3, B.half, 0x9a968c, 'deck');
      // A kerb down each side so the ramp is a road and not a plank.
      for (const s of [-1, 1]) {
        this.deco(x, y + 0.5, B.z + s * B.half, 1.2, 0.3, 0.25, 0x8e8b82);
      }
    }

    for (let x = B.x0; x < B.x1; x += 4) {
      const solid = x <= solidTo;
      if (solid) this.solid(x + 2, B.deck, B.z, 2.1, 0.32, B.half, B.red, 'deck');
      else this.deco(x + 2, B.deck, B.z, 2.1, 0.32, B.half, B.red);
      // Under-deck truss, which is most of what makes it read as a bridge
      // rather than a plank from below.
      this.deco(x + 2, B.deck - 0.9, B.z, 2.1, 0.55, B.half * 0.86, B.dark);
      // Railings down both edges.
      for (const s of [-1, 1]) {
        this.deco(x + 2, B.deck + 0.85, B.z + s * B.half, 2.1, 0.5, 0.12, B.lit);
      }
    }

    // Piers, down into the lake at the two towers and the far anchorage.
    for (const px of [B.xa, B.xb]) {
      this.deco(px, B.deck * 0.5 - 8, B.z, 5.5, B.deck * 0.5 + 8, 9.0, 0x7d7a72);
    }
  }

  /**
   * One tower: two legs, crossed by braces, with the road passing between.
   *
   * The braces are the Golden Gate's signature — the portal openings they
   * leave are what the reference photograph is mostly made of — so there
   * are five of them, closer together near the top exactly as in the real
   * thing, and the legs taper as they rise.
   */
  _cityBridgeTower(B, x) {
    const legs = [-B.half - 1.2, B.half + 1.2];
    for (const oz of legs) {
      // Stacked drums, each a little narrower than the last.
      const segs = 9;
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        const y0 = -4 + t * (B.top + 4);
        const y1 = -4 + ((i + 1) / segs) * (B.top + 4);
        const w = 2.9 - t * 1.0;
        this.deco(x, (y0 + y1) * 0.5, B.z + oz, w, (y1 - y0) * 0.5, w, B.red);
      }
      // A cap, so the top is a finished thing and not a cut-off box.
      this.deco(x, B.top + 1.0, B.z + oz, 1.9, 0.5, 1.9, B.dark);
      this.lantern(x, B.top + 3.2, B.z + oz, 0xff5a4a);
    }
    // The crossbeams. Tightening toward the top is what gives the tower its
    // proportions — evenly spaced ones read as a pylon, not a suspension
    // bridge tower.
    for (const t of [0.30, 0.55, 0.73, 0.87, 0.97]) {
      const y = B.deck + t * (B.top - B.deck);
      const w = 2.6 - t * 0.9;
      this.deco(x, y, B.z, w, 1.0, B.half + 1.2, B.red);
      this.deco(x, y - 1.1, B.z, w * 0.9, 0.22, B.half + 1.2, B.dark);
    }
    // And the beam the road passes under.
    this.deco(x, B.deck + 7.0, B.z, 2.9, 1.3, B.half + 1.2, B.red);
  }

  /**
   * The main cables and their suspenders.
   *
   * A catenary per span, approximated by short tilted segments. `sag` is
   * measured down from the tower tops, and the middle of the main span
   * comes to rest just above the deck — which is the line your eye actually
   * reads as "suspension bridge".
   */
  _cityBridgeCables(B) {
    const spans = [
      [B.x0, B.xa, (B.top - B.deck) * 0.62],   // shore side
      [B.xa, B.xb, B.top - B.deck - 3.0],      // the main span, deepest sag
      [B.xb, B.x1, (B.top - B.deck) * 0.62],   // island side
    ];
    const N = 26;
    // The cable ends at the deck at each anchorage and at the tower tops.
    const heightAt = (x0, x1, sag, t) => {
      const ends = (x0 === B.xa && x1 === B.xb) ? B.top : B.top;
      const end0 = (x0 === B.x0) ? B.deck + 1.5 : ends;
      const end1 = (x1 === B.x1) ? B.deck + 1.5 : ends;
      // A parabola through both ends with `sag` at the middle.
      return end0 + (end1 - end0) * t - sag * 4 * t * (1 - t);
    };

    for (const [x0, x1, sag] of spans) {
      for (const oz of [-B.half - 1.2, B.half + 1.2]) {
        let px = x0, py = heightAt(x0, x1, sag, 0);
        for (let i = 1; i <= N; i++) {
          const t = i / N;
          const nx = x0 + (x1 - x0) * t;
          const ny = heightAt(x0, x1, sag, t);
          const dx = nx - px, dy = ny - py;
          const len = Math.hypot(dx, dy);
          // rotZ tilts a box that is long in x up to the chord's angle.
          this.deco((px + nx) * 0.5, (py + ny) * 0.5, B.z + oz,
            len * 0.5 + 0.06, 0.3, 0.3, B.dark, 0, 0, Math.atan2(dy, dx));
          px = nx; py = ny;
        }
        // Suspenders: thin verticals from the cable down to the roadway.
        for (let i = 1; i < N; i++) {
          const t = i / N;
          const sx = x0 + (x1 - x0) * t;
          const sy = heightAt(x0, x1, sag, t);
          if (sy - B.deck < 1.6) continue;      // none where they would be stubs
          this.deco(sx, (sy + B.deck + 0.9) * 0.5, B.z + oz,
            0.1, (sy - B.deck - 0.9) * 0.5, 0.1, B.dark);
        }
      }
    }
  }

  /**
   * ROAD CLOSED.
   *
   * Everything here is at the ward end, where a player actually arrives, and
   * all of it is solid: two lines of water-filled barriers, a hazard-striped
   * hoarding across the full width, and signs on both sides of it. The
   * hoarding is what stops you — it is 2.6 tall against a jump of 17.5 units
   * per second, which sounds beatable until you notice there is nothing to
   * land on and a railing behind it.
   *
   * The cones and the digger are the part that makes it read as roadworks
   * rather than as a wall somebody put there.
   */
  _cityBridgeClosure(B) {
    const R = this.rnd;
    const gate = B.x0 + 14;

    // Hazard-striped hoarding right across the carriageway.
    const bays = 7;
    for (let i = 0; i < bays; i++) {
      const t = (i + 0.5) / bays;
      const oz = (t - 0.5) * B.half * 2;
      const w = (B.half * 2) / bays * 0.46;
      this.solid(gate, B.deck + 1.3, B.z + oz, 0.35, 1.3, w, 0xe8b93a, 'stone');
      // The diagonal stripe, in two darker bars.
      this.deco(gate - 0.38, B.deck + 1.75, B.z + oz, 0.06, 0.34, w * 0.92, 0x2a2e36);
      this.deco(gate - 0.38, B.deck + 0.85, B.z + oz, 0.06, 0.34, w * 0.92, 0x2a2e36);
    }
    // A rail along the top, so the barrier has a lip rather than an edge.
    this.solid(gate, B.deck + 2.75, B.z, 0.5, 0.18, B.half, 0xd8483c, 'stone');

    /**
     * THE SIGNS. Two of them, one facing the city and one facing the
     * bridge, because a sign you can only read from the wrong side is not
     * a sign. Each is a board on two posts with a red bar across it, which
     * is about as close to "ROAD CLOSED" as an untextured game can get —
     * and the striped barrier under it is doing the same job again.
     */
    for (const s of [-1, 1]) {
      const sx = gate - s * 5.5;
      for (const oz of [-2.4, 2.4]) {
        this.solid(sx, B.deck + 1.5, B.z + oz, 0.16, 1.5, 0.16, 0x4a4d52, 'stone');
      }
      this.deco(sx, B.deck + 3.4, B.z, 0.12, 1.5, 3.1, 0xe8e2d2);
      this.deco(sx - s * 0.14, B.deck + 3.4, B.z, 0.06, 0.34, 2.5, 0xd8483c);
      this.deco(sx - s * 0.14, B.deck + 4.3, B.z, 0.06, 0.16, 2.2, 0x2a2e36);
      this.deco(sx - s * 0.14, B.deck + 2.5, B.z, 0.06, 0.16, 2.2, 0x2a2e36);
      this.lantern(sx, B.deck + 5.4, B.z, 0xffb347);
    }

    // Cones, in a taper leading up to the barrier.
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const cx = gate - 13 + t * 11;
      const oz = (1 - t) * B.half * 0.85;
      for (const s of [-1, 1]) {
        this.deco(cx, B.deck + 0.42, B.z + s * oz, 0.28, 0.42, 0.28, 0xd8483c);
        this.deco(cx, B.deck + 0.72, B.z + s * oz, 0.13, 0.12, 0.13, 0xe8e2d2);
      }
    }

    // A digger and a stack of pipe, parked where the work stopped.
    const dx = gate - 9;
    this.solid(dx, B.deck + 1.1, B.z - 3.4, 1.9, 1.0, 1.2, 0xe8b93a, 'stone');
    this.deco(dx - 0.4, B.deck + 2.5, B.z - 3.4, 0.9, 0.7, 1.0, 0x2e333c);
    this.deco(dx + 2.2, B.deck + 2.2, B.z - 3.4, 1.8, 0.22, 0.3, 0xe8b93a, 0, 0, 0.5);
    for (let i = 0; i < 3; i++) {
      this.solid(gate - 4.5, B.deck + 0.5 + i * 0.85, B.z + 3.6 + (i % 2) * 0.5,
        1.5, 0.42, 0.42, 0x6a6e74, 'stone');
    }
    void R;
  }

  /**
   * The island the bridge is going to.
   *
   * Pure scenery — it is past the heightfield and nothing can reach it —
   * so it is built to read at distance and no closer: a headland, a little
   * town along the shore, and a light at the point. Anything finer than
   * that is detail nobody will ever stand next to.
   */
  _cityIsland(B) {
    const R = this.rnd;
    const cx = B.x1 + 44, cz = B.z;

    // The landmass: overlapping rock drums, highest inland.
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2;
      const d = R() * 54;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d * 0.8;
      const near = 1 - d / 54;
      const h = 6 + near * 30 + R() * 8;
      this.batches.rock.add(x, h * 0.4, z, 16 + R() * 12, h, 15 + R() * 11,
        near > 0.5 ? 0x5c6a52 : 0x6a6f60);
    }
    // A town along the near shore, facing the bridge.
    for (let i = 0; i < 16; i++) {
      const x = cx - 40 + R() * 34;
      const z = cz + (R() - 0.5) * 78;
      const h = 6 + R() * 16;
      this.deco(x, 10 + h * 0.5, z, 3 + R() * 3, h * 0.5, 3 + R() * 3,
        [0x9a9a95, 0x8e908c, 0xa4a29a][Math.floor(R() * 3)]);
      if (R() < 0.3) this.lantern(x, 12 + h, z, 0xffd9a0);
    }
    // And a light at the point, which is what you actually see at dusk.
    this.deco(cx + 30, 40, cz - 30, 2.2, 9, 2.2, 0xe8e2d2);
    this.lantern(cx + 30, 51, cz - 30, 0xffe08a);
  }

  /**
   * Put the shark in the lake.
   *
   * `shoreAt` is the Chebyshev distance of the actual waterline, solved
   * from the map's own height function rather than written down twice —
   * the shelf has been retuned once already, and a shark patrolling a
   * shoreline the map no longer has would cruise across the beach.
   */
  _buildCityShark() {
    const W = CFG.world.waterLevel;
    const start = CITY.reach + CITY.pitch * 0.5;
    const limit = CFG.world.size * 0.5;
    /**
     * Both lines are SOLVED from the map's own height function rather than
     * written down a second time. The shelf has already been retuned once,
     * and a shark patrolling a shoreline the map no longer has would cruise
     * across the beach.
     *
     *   shore   where the water starts — what the patrol hugs.
     *   swim    where it is `draft` deep — the closest the shark may ever
     *           come to the island, so it physically cannot beach itself.
     */
    let shore = start, swim = start;
    for (let d = start; d < limit; d += 0.5) {
      if (shore === start && this.heightAt(d, 0) <= W) shore = d;
      // `draft` is per unit of scale, like everything else about the animal.
      const draft = CFG.shark.draft * CFG.shark.scale;
      if (this.heightAt(d, 0) <= W - draft) { swim = d; break; }
    }
    // The map's seeded generator, so every client's shark wanders and
    // breaches identically — the same reason the map itself is seeded.
    this.shark = new Shark(this.scene, shore, swim, this.rnd);
  }

  // ------------------------------------------------------- rock spires (W)

  _buildSpires() {
    const rnd = this.rnd;
    const spires = [];
    const centres = [
      [-132, -44], [-96, -104], [-118, -8], [-150, -78], [-84, -60],
    ];
    for (let i = 0; i < centres.length; i++) {
      const [x, z] = centres[i];
      const base = this.heightAt(x, z);
      const h = 16 + rnd() * 16;
      const r = 5 + rnd() * 3.5;
      // Stack tapering rock drums to make a spire that is still cheap AABBs.
      let y = base;
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        const sr = r * (1 - s * 0.16);
        const sh = h / segs;
        this.batches.rock.add(x, y + sh / 2, z, sr, sh * 0.62, sr, 0x6d675e, rnd() * 3);
        this.collision.addBox(x, y + sh / 2, z, sr * 0.8, sh / 2, sr * 0.8, 'stone');
        y += sh;
      }
      // Flat cap you can actually stand and fight on.
      this.solid(x, y + 0.4, z, r * 0.85, 0.5, r * 0.85, 0x7a7369, 'stone');
      this.lantern(x, y + 7 + rnd() * 4, z, 0xffb0d0);
      // The cap's half-width travels with the anchor: a bridge landing here
      // has to start at the rim, not at the middle. See _bridge.
      spires.push([x, y + 0.9, z, r * 0.85]);
      this.spawnPoints.push([x, y + 2, z]);
    }
    this.spires = spires;
  }

  // ---------------------------------------------------------------- bridges

  _buildBridges() {
    // Rope bridges linking the spires, plus one long span to the arena.
    const links = [
      [this.spires[0], this.spires[2]],
      [this.spires[0], this.spires[4]],
      [this.spires[1], this.spires[3]],
      [this.spires[4], [-40, this.heightAt(-40, -30) + 8, -30]],
    ];
    for (const [a, b] of links) this._bridge(a, b);

    // Village to arena.
    this._bridge([-34, this.heightAt(-34, 96) + 6, 96], [-6, this.heightAt(-6, 44) + 6, 44]);
    // Bamboo grove to arena.
    this._bridge([96, this.heightAt(96, 26) + 9, 26], [40, this.heightAt(40, 8) + 7, 8]);
  }

  /**
   * @param approach build a stair up to each low end. OFF for the Mire.
   *
   * The Mire is a map whose whole idea is that nothing touches the ground:
   * the floor is wading depth, the village hangs in the air, and you go up by
   * grapple or by jumping hut to hut. Its walkways run between hut decks, so
   * a ground approach there is not an improvement — it descends out of
   * somebody's house into the water, and it argues with the map.
   */
  _bridge(a, b, approach = true) {
    /**
     * Start the deck at the EDGE of whatever it lands on, not the middle.
     *
     * A spire's cap is a platform up to 14 across whose top is exactly the
     * height the bridge is anchored at — and the deck sags. Anchored at the
     * centre, the first few planks hang below a platform they are standing
     * inside, so walking up the span you meet the CAP's side: a 3.58 wall of
     * plain stone. `_moveAxis` takes the first box it cannot step and stops
     * there, without ever looking at the plank one stride further on that it
     * could have stepped onto. That is what made all four mountain spans
     * climbable to exactly two planks from the top and no further.
     *
     * A fourth element on an anchor is the half-width of the thing it stands
     * on; trimming by 1.25 of it clears the corner of a square cap taken at
     * an angle. Anchors without one — the valley ends, the Mire's huts —
     * trim by nothing and are unchanged.
     */
    const ux0 = b[0] - a[0], uz0 = b[2] - a[2];
    const m0 = Math.hypot(ux0, uz0) || 1;
    const trimA = a[3] ? a[3] * 1.25 + 0.3 : 0;
    const trimB = b[3] ? b[3] * 1.25 + 0.3 : 0;
    const x1 = a[0] + (ux0 / m0) * trimA, z1 = a[2] + (uz0 / m0) * trimA, y1 = a[1];
    const x2 = b[0] - (ux0 / m0) * trimB, z2 = b[2] - (uz0 / m0) * trimB, y2 = b[1];
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const n = Math.max(2, Math.round(len / 2.0));
    const rotY = Math.atan2(dx, dz);
    const sag = Math.min(4.0, len * 0.05);

    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = lerp(x1, x2, t), z = lerp(z1, z2, t);
      // Catenary-ish droop makes the bridge read as rope, not a girder.
      const y = lerp(y1, y2, t) - Math.sin(t * Math.PI) * sag;
      this._plank(x, y, z, rotY, i);
      /**
       * Keep the deck clear of trees — but only where one could reach it.
       *
       * A conifer tops out around 22 units above its own ground, so a bridge
       * strung between two spires 30 up has nothing growing through it and
       * wants the forest left alone underneath. The low spans are the ones
       * with trunks coming up through the planks, which is what makes them
       * impassable: you cannot walk through a tree.
       */
      if (y - this.heightAt(x, z) < 24) this._clear(x, z, 4.0);
      if (i % 6 === 0) this.lantern(x, y + 5.5, z, 0xffd08a);
    }
    /**
     * Where a ramp continues down to the ground. Decided before the end posts
     * are placed, because an end that carries on walking does not get one.
     */
    const MAX_APPROACH = 14;
    const ramped = [[x1, y1, z1], [x2, y2, z2]].map(([px, py, pz]) => {
      if (!approach) return false;
      const g = this.heightAt(px, pz);
      const rise = py - g;
      return rise > CFG.move.stepHeight && rise <= MAX_APPROACH
        && g >= CFG.world.waterLevel + 0.5;
    });

    /**
     * End posts, at the SIDES of the deck — and not at all where a ramp
     * carries on.
     *
     * They used to stand dead centre on the last plank: a 0.9-wide, 3.6-tall
     * solid post planted in the middle of a walkway 3 wide, with a frog 1.1
     * across. That is not a newel, it is a turnstile — it blocked the way onto
     * every bridge in the map.
     *
     * Moving them to the rails was not enough. The rails run across the SPAN,
     * and a ramp is snapped to an axis, so the two do not line up: at a
     * diagonal abutment a post ends up square in the ramp's path, and the
     * turnstile is back a plank further out. An end that keeps walking has
     * nothing to newel, so it gets no post.
     */
    {
      const s2 = Math.sin(rotY), c2 = Math.cos(rotY);
      const anchors = [[x1, y1, z1], [x2, y2, z2]];
      for (let e = 0; e < 2; e++) {
        if (ramped[e]) continue;
        const [px, py, pz] = anchors[e];
        for (const side of [-1.35, 1.35]) {
          this.solid(px + c2 * side, py + 1.5, pz - s2 * side,
            0.22, 1.7, 0.22, 0x5a442e, 'wood');
        }
      }
    }

    /**
     * A stair up to each abutment that is close enough to the ground to have
     * one, so the bridge is something you can walk onto.
     *
     * The decks stood six to nine units above bare grass with no approach at
     * all — a staircase in the air, which is exactly what it looked like.
     *
     * MAX_APPROACH stops this sprouting a seventy-step ladder up the side of
     * a rock spire. Those spans are meant to be grappled to, and they have
     * spawn points on top; the ones that needed fixing are the low crossings
     * between the village, the grove and the arena.
     */
    const ends = [[[x1, y1, z1], [x2, y2, z2]], [[x2, y2, z2], [x1, y1, z1]]];
    for (let e = 0; e < 2; e++) {
      if (!ramped[e]) continue;
      const [end, other] = ends[e];
      const [px, py, pz] = end;
      const g = this.heightAt(px, pz);
      // A stair into a lake is not an approach.
      if (g < CFG.world.waterLevel + 0.5) continue;
      // Run the flight straight out along the bridge's own axis, away from
      // the span, so it never crosses the deck it serves.
      const ax = px - other[0], az = pz - other[2];
      const m = Math.hypot(ax, az) || 1;
      // Level with the deck's own planks, because it IS the deck's planks.
      this._ramp(px, pz, py, g, ax / m, az / m);
    }
  }

  // ---------------------------------------------------------------- forests

  _buildForests() {
    const rnd = this.rnd;
    const S = CFG.world.size * 0.5;
    let placed = 0;
    const attempts = 2600;

    for (let i = 0; i < attempts && placed < 620; i++) {
      const x = (rnd() * 2 - 1) * (S - 14);
      const z = (rnd() * 2 - 1) * (S - 14);
      const y = this.heightAt(x, z);
      if (y < CFG.world.waterLevel + 1.0 || y > 66) continue;
      if (this.terrain.slopeAt(x, z) > 0.42) continue;
      /**
       * Nothing grows where something is built.
       *
       * The pad is for the canopy: the trunk is what the test measures and
       * what you collide with, but a conifer's skirt reaches 2.5 past it, and
       * branches through a temple wall look as wrong as a trunk through one.
       *
       * The bamboo grove keeps its old blanket radius on top of the registry.
       * It is not a structure with a footprint, it is a whole district with
       * its own planting, and pines coming up through it would read as two
       * forests fighting.
       */
      if (!this._isClear(x, z, 2.5)) continue;
      if (Math.hypot(x - 128, z - 26) < 44) continue;

      // Density mask: clumps rather than an even scatter.
      const dens = this.noise2.fbm(x * 0.011, z * 0.011, 3) * 0.5 + 0.5;
      if (rnd() > dens * 1.15) continue;

      placed++;
      const conifer = y > 34 || rnd() < 0.55;
      const scale = 0.8 + rnd() * 0.9;

      if (conifer) {
        const th = 4.5 * scale, fh = 9 * scale, fr = 2.5 * scale;
        this.batches.trunk.add(x, y + th / 2, z, 0.55 * scale, th, 0.55 * scale, 0x5a4230);
        for (let k = 0; k < 3; k++) {
          const kt = k / 3;
          this.batches.pine.add(
            x, y + th * 0.6 + fh * kt * 0.72 + fh * 0.22 * 0.5, z,
            fr * (1 - kt * 0.3), fh * 0.5, fr * (1 - kt * 0.3),
            k === 0 ? 0x2e6b34 : (k === 1 ? 0x357a3b : 0x3d8a42), rnd() * 3
          );
        }
        // Collider hugs the trunk, not the canopy — running through a forest
        // should feel like weaving past poles, not bumping into invisible boxes.
        this.collision.addBox(x, y + (th + fh) * 0.4, z, 0.40 * scale, (th + fh) * 0.4, 0.40 * scale, 'tree');
        if (scale > 1.3) this.collision.addAnchor(x, y + th * 0.6 + fh * 0.9, z, 1.5);
      } else {
        const th = 5.5 * scale;
        this.batches.trunk.add(x, y + th / 2, z, 0.6 * scale, th, 0.6 * scale, 0x6b4f33);
        const cr = 3.0 * scale;
        this.batches.blob.add(x, y + th + cr * 0.5, z, cr, cr * 0.85, cr, 0x4e9a3c, rnd() * 3, rnd(), rnd());
        this.batches.blob.add(x + cr * 0.5, y + th + cr * 0.2, z - cr * 0.3, cr * 0.62, cr * 0.55, cr * 0.62, 0x59ab44, rnd() * 3);
        this.collision.addBox(x, y + th * 0.5, z, 0.45 * scale, th * 0.5, 0.45 * scale, 'tree');
        this.collision.addAnchor(x, y + th + cr * 0.4, z, 1.6);
      }
    }
    this.treeCount = placed;
  }

  _buildRocks() {
    const rnd = this.rnd;
    const S = CFG.world.size * 0.5;
    for (let i = 0; i < 340; i++) {
      const x = (rnd() * 2 - 1) * (S - 10);
      const z = (rnd() * 2 - 1) * (S - 10);
      const y = this.heightAt(x, z);
      if (y < CFG.world.waterLevel - 1) continue;
      // Boulders were never checked against anything, so they turned up on
      // the shrine terrace and inside the village.
      if (!this._isClear(x, z)) continue;
      const s = 0.6 + rnd() * 2.6;
      this.batches.rock.add(x, y + s * 0.45, z, s, s * 0.75, s * 0.9,
        rnd() < 0.5 ? 0x6f6a61 : 0x7d776c, rnd() * 3, rnd() * 0.4, rnd() * 0.4);
      // Slightly inset from the visual mesh so you can scramble over boulders
      // rather than snagging on their silhouette.
      if (s > 1.6) this.collision.addBox(x, y + s * 0.35, z, s * 0.6, s * 0.5, s * 0.6, 'stone');
    }
  }

  _buildLanterns() {
    // A scattering of high lanterns over open terrain so there is always
    // something to grapple to when crossing the map at speed.
    const rnd = this.rnd;
    const S = CFG.world.size * 0.5;
    for (let i = 0; i < 46; i++) {
      const x = (rnd() * 2 - 1) * (S - 40);
      const z = (rnd() * 2 - 1) * (S - 40);
      const g = this.heightAt(x, z);
      if (g > 70) continue;
      this.lantern(x, g + 16 + rnd() * 20, z, rnd() < 0.5 ? 0xffd08a : 0x9fe0ff);
    }
  }

  // ======================================================================
  // THE HANGING MIRE
  //
  // A drowned valley under a village that never touches the ground. The
  // whole map is built on one idea: the floor is wading depth and slow, and
  // everything worth having is in the air. You go UP — by grapple, by
  // walkway, by jumping between huts — and the water is what you fall into.
  //
  // Read against the reference: cold grey-green fog, stone columns standing
  // in still water, huts slung UNDER heavy canopies rather than perched on
  // top of them, and warm orange light spilling out of every window. The
  // warm light is the whole trick — it is the only warm colour in the map,
  // so it reads as inhabited and tells you where the platforms are.
  // ======================================================================

  /** Silt banks, boardwalks and a few things to hide behind at ground level. */
  _buildMireGround() {
    const rnd = this.rnd;
    const S = CFG.world.size * 0.5;
    const W = CFG.world.waterLevel;

    /**
     * Half-sunk logs and stumps in the shallows — cover, and something to
     * break the water up so it does not read as a flat sheet.
     *
     * The count and the band both grew with the map. A square rim opened up
     * the four corners, and scattering the same ninety logs over half again
     * as much water would have made the Mire read as EMPTIER rather than
     * bigger — which is the trap in every "make it larger" change.
     */
    for (let i = 0; i < 210; i++) {
      const x = (rnd() * 2 - 1) * (S - 26);
      const z = (rnd() * 2 - 1) * (S - 26);
      const g = this.heightAt(x, z);
      if (g > W + 2.2 || g < W - 3.0) continue;
      const len = 3 + rnd() * 7;
      const a = rnd() * Math.PI * 2;
      this.solid(x, g + 0.35, z, len * 0.5, 0.42, 0.5, 0x40382c, 'wood');
      // A stump beside it, more often than not.
      if (rnd() < 0.55) {
        this.solid(x + Math.cos(a) * len * 0.6, g + 0.9,
          z + Math.sin(a) * len * 0.6, 0.55, 0.9, 0.55, 0x453c2e, 'wood');
      }
    }

    /**
     * Low boardwalks linking the mud islands, so there is a dry route for
     * anyone who does not want to swim.
     *
     * Each island to its NEAREST neighbours, not to the next one in the
     * list. With four islands the list order happened to be a sensible
     * loop; with twelve spread over the whole square it laid 340-unit
     * piers diagonally across open water — eighty planks each, and they
     * looked exactly as odd as they sound. Nearest-two gives a connected
     * network out of short spans, and the dedup stops a pair being built
     * from both ends.
     */
    const islands = this.flats.filter((f) => f.h > W);
    const built = new Set();
    for (let i = 0; i < islands.length; i++) {
      const near = islands
        .map((f, j) => [Math.hypot(f.x - islands[i].x, f.z - islands[i].z), j])
        .filter(([, j]) => j !== i)
        .sort((p, q) => p[0] - q[0])
        .slice(0, 2);
      for (const [, j] of near) {
        const key = Math.min(i, j) + ':' + Math.max(i, j);
        if (built.has(key)) continue;
        built.add(key);
        this._mireBoardwalk(islands[i].x, islands[i].z, islands[j].x, islands[j].z);
      }
    }
  }

  /** A plank walk just above the waterline, on short piles. */
  _mireBoardwalk(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const n = Math.floor(len / 4);
    if (n < 2) return;
    const ux = dx / len, uz = dz / len;
    const yaw = Math.atan2(ux, uz);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + dx * t, z = z0 + dz * t;
      const g = this.heightAt(x, z);
      const y = Math.max(g, CFG.world.waterLevel) + 0.9;
      this.solid(x, y, z, 2.0, 0.16, 1.5, 0x53472f, 'wood');
      // Piles down into the water.
      if (i % 2 === 0) {
        this.deco(x, (y + g) * 0.5, z, 0.14, (y - g) * 0.5, 0.14, 0x3a3122);
      }
      // Handrail on one side, which also reads as a direction marker.
      if (i % 3 === 0) {
        this.deco(x - uz * 1.4, y + 0.7, z + ux * 1.4, 0.1, 0.7, 0.1, 0x3a3122, yaw);
      }
    }
  }

  /**
   * The spires. The terrain already makes the rock; this dresses it.
   *
   * Their tops are the anchor points the hanging village is slung from, so
   * they are found rather than placed: sample the heightfield, keep the
   * peaks, and hand the list to the village builder.
   */
  _buildMireSpires() {
    const rnd = this.rnd;
    const S = CFG.world.size * 0.5;
    this.mireSpires = [];

    // Find genuine local maxima, so a "spire" is really a tower and not a
    // random point on a slope.
    // Generous sampling and a modest neighbourhood: asking for a strict
    // local maximum over a wide radius finds almost nothing, because the
    // exact top of a noise ridge is a knife edge. A point that beats its
    // near neighbours is a tower for our purposes.
    /**
     * Sampled to 34 towers, where it used to take 20 out of a box inset 70
     * units — a box that stopped 30 units short of even the OLD circular
     * rim, so the outer third of the map had no spires, therefore no
     * village, therefore nothing to do in it.
     *
     * 58 of inset, though, not 34. A spire is a cone with about 30 units of
     * flank, and the rim starts climbing at 185: sampling to 176 stood the
     * outermost towers with their feet inside the boundary wall, where the
     * flank you are supposed to run up is just more mountain. The corners
     * are not left empty by this — they get a hamlet hung over the mud
     * island instead, which is what fills them.
     */
    for (let i = 0; i < 11000 && this.mireSpires.length < 34; i++) {
      const x = (rnd() * 2 - 1) * (S - 58);
      const z = (rnd() * 2 - 1) * (S - 58);
      const h = this.heightAt(x, z);
      if (h < 16) continue;
      let peak = true;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        if (this.heightAt(x + Math.cos(a) * 6, z + Math.sin(a) * 6) > h + 0.5) {
          peak = false; break;
        }
      }
      if (!peak) continue;
      // Keep them apart, or the village clumps into one corner.
      if (this.mireSpires.some((s) => Math.hypot(s.x - x, s.z - z) < 25)) continue;
      this.mireSpires.push({ x, z, y: h });
    }

    // Dress each one: a broken crown of rock, and dead trunks leaning off it.
    for (const s of this.mireSpires) {
      for (let i = 0; i < 5; i++) {
        const a = rnd() * Math.PI * 2, d = 2 + rnd() * 5;
        this.batches.rock.add(
          s.x + Math.cos(a) * d, s.y + 1 + rnd() * 3, s.z + Math.sin(a) * d,
          2 + rnd() * 3, 2 + rnd() * 4, 2 + rnd() * 3, 0x4c4f55);
      }
      for (let i = 0; i < 3; i++) {
        const a = rnd() * Math.PI * 2;
        const h = 8 + rnd() * 14;
        this.batches.post.add(s.x + Math.cos(a) * 3, s.y + h * 0.5,
          s.z + Math.sin(a) * 3, 0.3, h, 0.3, 0x36302a);
      }
    }
  }

  /**
   * The village, hung underneath the spires.
   *
   * Each hut is a platform on a mast dropped from the rock above, with a
   * flared roof over it and a lantern under the eaves. They sit at mixed
   * heights so the map has a vertical middle — somewhere to fight that is
   * neither the water nor the very top.
   */
  _buildMireVillage() {
    const rnd = this.rnd;
    this.mireHuts = [];
    const spires = this.mireSpires || [];

    for (const s of spires) {
      const want = 2 + Math.floor(rnd() * 3);
      let made = 0;
      // Try several spots per hut: a spire is a cone, so a good fraction of
      // the ring around it is solid rock at the height we want to hang from.
      // Nine tries per hut, not four. A spire is a cone, so most of the ring
      // round it fails the "hangs clear of the ground" rule below — at four
      // tries a third of the spires delivered no huts at all, and a spire
      // with nothing hanging from it is scenery rather than a place.
      for (let i = 0; i < want * 9 && made < want; i++) {
        const a = rnd() * Math.PI * 2;
        const d = 11 + rnd() * 18;
        const x = s.x + Math.cos(a) * d;
        const z = s.z + Math.sin(a) * d;
        // Hung well below the rock it is tied to, and always clear of the
        // water: the point of this village is that it never touches ground.
        // Clamping the height up to ground + 12 instead of rejecting the spot
        // made this guard unreachable and buried huts in the flank.
        const hang = s.y - 6 - rnd() * 22;
        if (hang - this.heightAt(x, z) < 8) continue;
        const hr = 3.0 + rnd() * 2.2;
        this._mireHut(x, hang, z, hr, rnd);
        this.mireHuts.push({ x, y: hang, z, r: hr });
        made++;
      }
    }

    /**
     * A cluster over the middle of the map, so the centre is contested.
     *
     * Two rings now rather than one. The old seven sat between 14 and 38
     * units out, which is a single knot of houses you can see all of from
     * any one of them; the outer ring reaches 74 and gives the middle of
     * the map a size of its own instead of a point.
     */
    for (let i = 0; i < 15; i++) {
      const a = (i / 15) * Math.PI * 2 + 0.3;
      const d = 16 + (i % 5) * 14.5;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = this.heightAt(x, z) + 14 + (i % 4) * 7;
      const hr = 3.4 + (i % 2);
      this._mireHut(x, y, z, hr, rnd);
      this.mireHuts.push({ x, y, z, r: hr });
    }

    /**
     * A HAMLET OVER EVERY OUTER ISLAND.
     *
     * The square rim opened up the four corners of the world, and a corner
     * you can walk to with nothing in it is not more map — it is more
     * walking. The render made that plain: the far corner came back as
     * flat silt, two sunken logs and a single lantern.
     *
     * These hang from nothing in particular, exactly as the central cluster
     * does, because the spires are FOUND from noise and noise does not
     * promise a tower in any given place. Waiting for one there is how the
     * outer third of this map stayed empty in the first place.
     */
    const outer = this.flats.filter(
      (f) => Math.max(Math.abs(f.x), Math.abs(f.z)) > 100);
    for (const f of outer) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + f.x * 0.017;
        const d = 7 + (i % 2) * 7;
        const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
        const y = this.heightAt(x, z) + 13 + (i % 3) * 6;
        const hr = 3.2 + (i % 2) * 0.8;
        this._mireHut(x, y, z, hr, rnd);
        this.mireHuts.push({ x, y, z, r: hr });
      }
    }

    // Training dummies on a few of the decks, facing the middle.
    for (let i = 0; i < this.mireHuts.length; i += 4) {
      const h = this.mireHuts[i];
      this.dummySpots.push([h.x, h.y + 0.3, h.z, Math.atan2(-h.x, -h.z)]);
    }

    // The practice ring goes on the widest island, and the golden frog with
    // it — the crystal has to have somewhere to be given up on every map.
    // The statue goes at the island's CENTRE, where the flat guarantees dry
    // ground; the ring sits beside it, still well inside the same flat.
    // Offsetting the statue instead put it off the edge and into the water.
    // DRY flats only, then the widest of those. Reducing over every flat
    // starts from the first one — which here is the centre shallows, below
    // the waterline — and never replaces it, so the altar ended up in a lake.
    const dry = this.flats.filter((f) => f.h > CFG.world.waterLevel + 0.6);
    const isle = dry.reduce((a, b) => (b.r > a.r ? b : a), dry[0]);
    this._buildFrogathStatue(isle.x, this.heightAt(isle.x, isle.z), isle.z);
    const rx = isle.x + Math.min(12, isle.r * 0.5);
    this._buildPracticeRing(rx, this.heightAt(rx, isle.z) + 0.1, isle.z, 4.2);
  }

  /** One hanging hut: mast, deck, walls, flared roof, lantern. */
  _mireHut(x, y, z, r, rnd) {
    const wood = 0x4a4030;
    const woodDark = 0x342c20;
    const thatch = 0x6a6152;
    const yaw = rnd() * Math.PI * 2;

    // Everything above the floor is measured from the deck's TOP surface.
    // Measuring from its centre instead is what pushed the walls and the ropes
    // down through the planks.
    const deckTop = y + 0.22;

    // The mast it hangs from, running up out of sight into the mist.
    this.deco(x, y + 16, z, 0.22, 16, 0.22, woodDark);
    // Guy ropes, splayed — they sell the weight hanging off them.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + yaw;
      this.deco(x + Math.cos(a) * r * 0.8, deckTop + 5.5, z + Math.sin(a) * r * 0.8,
        0.06, 5.5, 0.06, woodDark, 0, Math.cos(a) * 0.16, Math.sin(a) * 0.16);
    }

    // Deck. Solid, so it is a real platform to stand and fight on.
    this.solid(x, y, z, r, 0.22, r, wood, 'wood');
    this.deco(x, y + 0.3, z, r * 0.94, 0.06, r * 0.94, 0x5b503c, yaw);
    // Joists under it.
    for (let i = -1; i <= 1; i++) {
      this.deco(x + i * r * 0.6, y - 0.4, z, 0.12, 0.3, r, woodDark, yaw);
    }

    // Walls: three sides, so there is cover and a way in. Tall enough to
    // stand up in — at 1.5 the hut was shorter than the frog in it, which is
    // half of why the village read as flat.
    const wallH = 2.4;
    for (let i = 0; i < 3; i++) {
      const a = (i / 4) * Math.PI * 2 + yaw;
      this.solid(x + Math.cos(a) * r * 0.92, deckTop + wallH * 0.5,
        z + Math.sin(a) * r * 0.92, r * 0.72, wallH * 0.5, 0.16, wood, 'wood');
    }
    // A window with light behind it — the warm note the whole map needs.
    this.deco(x + Math.cos(yaw) * r * 0.95, deckTop + 1.3, z + Math.sin(yaw) * r * 0.95,
      0.5, 0.42, 0.1, 0xffb04a, yaw);

    // The roof: steep, drooping, ragged. This is the silhouette that makes the
    // place look like the reference rather than like a treehouse.
    //
    // roof() wants a cone RADIUS, so it draws twice what it is given. Passing
    // r * 2.1 spread a 16-wide roof — and a 13-wide eave slab — over an
    // 8-wide deck, 2.6 tall: a pancake with the hut lost underneath it. A
    // radius just past the deck's own r, over a height that is a real
    // fraction of the width, gives it a pitch.
    const eaveY = deckTop + wallH;
    this.roof(x, eaveY, z, r * 1.15, 3.6, thatch, yaw + Math.PI / 4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + yaw + Math.PI / 4;
      // Torn eaves hanging off the corners — off the eave line, and stopping
      // well short of the floor.
      this.deco(x + Math.cos(a) * r * 1.1, eaveY - 0.5,
        z + Math.sin(a) * r * 1.1, 0.5, 1.0, 0.5, thatch, a, 0.35, 0);
    }
    // Rags and net hanging beneath.
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.4 + rnd() * 0.6);
      this.deco(x + Math.cos(a) * d, y - 1.4 - rnd() * 1.6, z + Math.sin(a) * d,
        0.35, 1.4, 0.06, 0x5a5142, a);
    }

    // The lantern under the eaves — light, and a grapple anchor. Hung off the
    // porch side rather than buried in the roof cone, so it can be shot.
    this.lantern(x + Math.cos(yaw) * r * 1.05, eaveY - 0.8,
      z + Math.sin(yaw) * r * 1.05, 0xffa347);
  }

  /**
   * Rope walks between huts that are close enough to be linked.
   *
   * Built as a network — shortest pairs first, up to three walks per hut —
   * rather than one walk per hut. Taking only each hut's single nearest
   * neighbour leaves a village of isolated pairs, and once spans that would
   * cut through a house are refused there is little left at all.
   */
  _buildMireWalks() {
    const huts = this.mireHuts || [];

    /**
     * Where a walkway between two huts should actually begin and end, or null
     * if it should not be built.
     *
     * _bridge lays decking across the WHOLE span and plants a solid end post
     * at each endpoint, so a walk run between hut centres drove planking over
     * both floors, through the walls, with a post in the middle of each room.
     * That is the geometry that made the houses look sunk into their own
     * platforms. Every span is therefore trimmed back to the decks' edges and
     * dropped if it cannot clear them.
     */
    const span = (a, b) => {
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      // A deck is a SQUARE of half-extent r, so how far its edge is depends
      // on the direction you leave by — r straight out, r * 1.41 at a corner.
      // Trimming by a flat r leaves a diagonal gangway ending inside the room.
      const reach = Math.max(Math.abs(ux), Math.abs(uz)) || 1;
      const ai = a.r / reach + 0.2, bi = b.r / reach + 0.2;
      // Two decks almost touching leave no room for a span between them, and
      // clamping the trim to the midpoint instead would put the planks back
      // inside the rooms — the exact thing the trim exists to prevent.
      if (ai + bi > len - 2) return null;

      const s = {
        ax: a.x + ux * ai, az: a.z + uz * ai, ay: a.y + 0.28,
        bx: b.x - ux * bi, bz: b.z - uz * bi, by: b.y + 0.28,
      };
      // A span that passes over a THIRD hut plants decking across that one's
      // floor just as visibly. Planks are 1.5 half-wide, so clear the room by
      // that much.
      const sx = s.bx - s.ax, sz = s.bz - s.az;
      const sl = sx * sx + sz * sz || 1;
      const sag = Math.min(4.0, Math.hypot(sx, sz) * 0.05);
      for (const h of huts) {
        if (h === a || h === b) continue;
        const t = clamp(((h.x - s.ax) * sx + (h.z - s.az) * sz) / sl, 0, 1);
        /**
         * Measured as a SQUARE, for the same reason the endpoint trim above
         * is: a deck is a square of half-extent r, so its corner is r·1.41
         * out. A radial test of `r · 0.8 + 1.5` waves through any span that
         * clips a deck across the diagonal — which is planking laid over
         * somebody's floor, the exact thing this guard exists to stop, and
         * it only shows up on the handful of huts a walk happens to pass
         * cornerwise. The endpoints were fixed for this once; the third-hut
         * check was left measuring a circle.
         */
        const px = s.ax + sx * t, pz = s.az + sz * t;
        if (Math.max(Math.abs(px - h.x), Math.abs(pz - h.z)) > h.r + 1.5) continue;
        // _bridge droops the middle of the span; account for it before
        // deciding the walkway clears the roof or misses the deck.
        const py = lerp(s.ay, s.by, t) - Math.sin(t * Math.PI) * sag;
        if (Math.abs(py - (h.y + 0.22)) < 3) return null;
      }
      return s;
    };

    // Every pair worth considering, shortest first. Height counts against a
    // pair, so the walks read as level rope rather than as ladders.
    const pairs = [];
    for (let i = 0; i < huts.length; i++) {
      for (let j = i + 1; j < huts.length; j++) {
        const d = Math.hypot(huts[i].x - huts[j].x, huts[i].z - huts[j].z)
          + Math.abs(huts[i].y - huts[j].y) * 1.6;
        if (d < 42) pairs.push([d, i, j]);
      }
    }
    pairs.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]) || (p[2] - q[2]));

    const links = new Array(huts.length).fill(0);
    for (const [, i, j] of pairs) {
      if (links[i] >= 3 || links[j] >= 3) continue;
      const s = span(huts[i], huts[j]);
      if (!s) continue;
      links[i]++; links[j]++;
      // _bridge takes [x, y, z] triples, and hangs the deck FROM that height.
      // No ground approach: see _bridge. The Mire has no ground worth the name.
      this._bridge([s.ax, s.ay, s.az], [s.bx, s.by, s.bz], false);
    }
  }

  /** Reeds and poles standing out of the water. */
  _buildMireReeds() {
    const rnd = this.rnd;
    const S = CFG.world.size * 0.5;
    const W = CFG.world.waterLevel;
    // Reeds and fishing poles both grew with the map, for the same reason
    // the logs did: density is what "big" is actually made of.
    for (let i = 0; i < 820; i++) {
      const x = (rnd() * 2 - 1) * (S - 22);
      const z = (rnd() * 2 - 1) * (S - 22);
      const g = this.heightAt(x, z);
      if (g > W + 1.6 || g < W - 2.6) continue;
      // The mud islands carry the statue and the try-out ring, and they sit
      // squarely inside the band reeds are planted in.
      if (!this._isClear(x, z)) continue;
      const h = 1.6 + rnd() * 3.4;
      this.batches.post.add(x, g + h * 0.5, z, 0.05, h, 0.05,
        rnd() < 0.5 ? 0x6a6b45 : 0x565c3c);
    }
    // Fishing poles leaning out of the shallows, like the figures in the
    // reference are working from.
    for (let i = 0; i < 78; i++) {
      const x = (rnd() * 2 - 1) * (S - 32);
      const z = (rnd() * 2 - 1) * (S - 32);
      const g = this.heightAt(x, z);
      if (g > W + 1.0 || g < W - 2.0) continue;
      const h = 5 + rnd() * 4;
      this.batches.post.add(x, g + h * 0.5, z, 0.07, h, 0.07, 0x4a4232,
        0, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5);
    }
  }

  /** The lanterns that make the mist glow, and the grapple ring above. */
  _buildMireLights() {
    const rnd = this.rnd;
    const S = CFG.world.size * 0.5;
    /**
     * Lamps strung between the spires, high up — the grapple highway.
     *
     * Two per spire, not three. There are 27 spires now where there were
     * 15, and a lantern is the one thing in this engine that is NOT
     * instanced — a sphere, an additive sprite and a per-frame bob each —
     * so three apiece took the Mire past seven hundred draw calls against
     * the valley's 290. Two still leaves anchors well inside a 62-unit
     * tongue, and the huts carry their own lights regardless.
     */
    for (const s of (this.mireSpires || [])) {
      for (let i = 0; i < 2; i++) {
        const a = rnd() * Math.PI * 2, d = 10 + rnd() * 22;
        this.lantern(s.x + Math.cos(a) * d, s.y - 4 - rnd() * 16,
          s.z + Math.sin(a) * d, 0xffb257);
      }
    }
    // A few floating over open water, so crossing it is not pitch dark.
    for (let i = 0; i < 30; i++) {
      const x = (rnd() * 2 - 1) * (S - 32);
      const z = (rnd() * 2 - 1) * (S - 32);
      const g = this.heightAt(x, z);
      if (g > CFG.world.waterLevel + 3) continue;
      this.lantern(x, g + 9 + rnd() * 12, z, 0xff9a3c);
    }
  }

  _buildSpawns() {
    // Spawning in the water on a map that is mostly water would start every
    // life with a swim, so the Mire puts people on its decks instead.
    if (this.mireHuts && this.mireHuts.length) {
      for (const h of this.mireHuts) this.spawnPoints.push([h.x, h.y + 1.2, h.z]);
      for (const f of this.flats) {
        if (f.h > CFG.world.waterLevel + 0.5) {
          this.spawnPoints.push([f.x, this.heightAt(f.x, f.z) + 1.2, f.z]);
        }
      }
    } else {
      /**
       * Arena-adjacent spawns — and the ONLY points here that nothing looked
       * at before placing.
       *
       * Six positions on a 22-unit ring around the origin, with no question
       * asked about what is standing on them. On every map built so far the
       * answer was "nothing", because the middle of a map is always an arena
       * — but the ward's middle is a plaza with streets round it and the
       * streets have cars parked in them, so one life in six began inside a
       * hatchback. So this ring, and only this ring, steps aside.
       *
       * Deliberately NOT applied to the points a map builder placed. The
       * Mire's are at the centre of each hanging hut, and a hut has a mast
       * up the middle of it: by this test all 23 are "blocked", and both
       * discarding them and nudging them are worse than leaving them alone —
       * one leaves the map with a single spawn, the other walks people off
       * a deck into the water. An authored point is a decision; this ring
       * is arithmetic, and arithmetic is the thing worth checking.
       */
      const blocked = (x, y, z) => {
        for (const b of this.collision.boxes) {
          if (b.tag === 'deck' || b.tag === 'roof' || b.disabled) continue;
          if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ
            && b.maxY > y - 1.0 && b.minY < y + 1.0) return true;
        }
        return false;
      };
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        let x = Math.cos(a) * 22, z = Math.sin(a) * 22;
        const y = this.heightAt(x, z) + 1.2;
        if (blocked(x, y, z)) {
          // Out along the same spoke, which keeps the ring a ring.
          for (const d of [26, 30, 18, 34]) {
            const nx = Math.cos(a) * d, nz = Math.sin(a) * d;
            if (!blocked(nx, this.heightAt(nx, nz) + 1.2, nz)) { x = nx; z = nz; break; }
          }
        }
        this.spawnPoints.push([x, this.heightAt(x, z) + 1.2, z]);
      }
    }
    // Filter out anything that ended up underwater.
    this.spawnPoints = this.spawnPoints.filter(p => p[1] > CFG.world.waterLevel + 0.5);
    if (!this.spawnPoints.length) this.spawnPoints.push([0, this.heightAt(0, 0) + 2, 0]);
  }

  /**
   * A random point on walkable ground, kept inside the mountain rim.
   * Used for kunai crate placement.
   */
  randomGroundPoint(rnd = Math.random, maxRadius = 150) {
    for (let i = 0; i < 80; i++) {
      const a = rnd() * Math.PI * 2;
      // sqrt keeps the distribution even across the disc instead of
      // clustering everything near the middle.
      const d = Math.sqrt(rnd()) * maxRadius;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = this.heightAt(x, z);
      if (y < CFG.world.waterLevel + 1.0) continue;   // not in the lake
      if (y > 68) continue;                            // not up the peaks
      if (this.terrain.slopeAt(x, z) > 0.34) continue; // not on a cliff face
      return { x, y, z };
    }
    return { x: 0, y: this.heightAt(0, 0), z: 0 };
  }

  /**
   * A spawn point, optionally kept away from people you must not land next to.
   *
   * `avoid` is a list of anything with .x/.z — the taggers in Tag and
   * Infection, the juggernaut in Juggernaut. Landing a runner inside the
   * chaser's reach is not a fresh start, it is an instant tag, and it is the
   * one thing a respawn must not do.
   *
   * Distance is measured HORIZONTALLY on purpose. The map is 60 units tall
   * between the arena and the Sky Shrine, and 3D distance would call a spawn
   * "far" from a tagger standing directly below it.
   *
   * When several points qualify it picks among them at random, so spawns stay
   * unpredictable. When none do — a small map, or every point covered — it
   * falls back to whichever point is FURTHEST from trouble rather than
   * failing or spawning blind. That is why this cannot return nothing.
   */
  randomSpawn(avoid = null, minDist = 0) {
    const pts = this.spawnPoints;
    if (!pts.length) return new THREE.Vector3(0, this.heightAt(0, 0), 0);
    const pick = (p) => new THREE.Vector3(
      p[0] + (Math.random() - 0.5) * 3,
      p[1] + 0.5,
      p[2] + (Math.random() - 0.5) * 3
    );
    if (!avoid || !avoid.length || minDist <= 0) {
      return pick(pts[Math.floor(Math.random() * pts.length)]);
    }

    const safe = [];
    let best = pts[0], bestGap = -Infinity;
    for (const p of pts) {
      let gap = Infinity;
      for (const a of avoid) {
        gap = Math.min(gap, Math.hypot(p[0] - a.x, p[2] - a.z));
      }
      if (gap >= minDist) safe.push(p);
      if (gap > bestGap) { bestGap = gap; best = p; }
    }
    return pick(safe.length ? safe[Math.floor(Math.random() * safe.length)] : best);
  }

  // ----------------------------------------------------------------- update

  update(dt, cameraPos) {
    this.time += dt;

    // Practice ring: slow pulse so it reads as interactive.
    if (this.practiceRing) {
      const p = 0.75 + Math.sin(this.time * 2.0) * 0.25;
      this.practiceRing.ring.material.opacity = 0.55 + p * 0.4;
      this.practiceRing.glow.material.opacity = 0.12 + p * 0.16;
      this.practiceRing.pillar.material.opacity = 0.05 + p * 0.07;
      this.practiceRing.group.rotation.y += dt * 0.25;
    }

    // Lantern bob — cheap, and it makes the world feel alive.
    for (let i = 0; i < this.lanterns.length; i++) {
      const l = this.lanterns[i];
      l.mesh.position.y = l.baseY + Math.sin(this.time * 1.2 + l.phase) * 0.35;
    }

    // Water waves, refreshed at ~30Hz to keep the CPU cost negligible.
    this._waterAccum = (this._waterAccum || 0) + dt;
    if (this._waterAccum > 1 / 30 && this.waterMesh) {
      this._waterAccum = 0;
      const pos = this.waterMesh.geometry.attributes.position;
      const base = this.waterBase;
      const t = this.time;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        pos.array[i * 3 + 1] =
          Math.sin(x * 0.08 + t * 1.5) * 0.28 +
          Math.sin(z * 0.11 - t * 1.1) * 0.22;
      }
      pos.needsUpdate = true;
      this.waterMesh.geometry.computeVertexNormals();
    }
  }
}

// ------------------------------------------------------------------- assets

let _glowTex = null;
/** Radial gradient sprite reused by every lantern halo. */
export function lanternGlowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,235,180,0.7)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}
