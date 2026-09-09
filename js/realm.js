/**
 * THE REALM — the open world's ground, and how it is streamed.
 *
 * Two jobs, and they are separate on purpose:
 *
 *   HEIGHT   one pure function of (x, z), blended from the region table, used
 *            by collision, by content placement and by the mesh alike. There
 *            is exactly one definition of where the ground is.
 *   CHUNKS   the ground you can SEE, built in tiles around the player and
 *            thrown away behind them.
 *
 * ── why chunks ─────────────────────────────────────────────────────────────
 * The realm is 3072 across. Drawn at the density the 420-unit valley uses
 * (a vertex every 2.9), the ground alone would be 1.1 million triangles —
 * against about 147,000 for the whole valley including every tree, building
 * and boulder in it. A single mesh is simply not an option at this size, and
 * a coarse single mesh is a different game: you would see the horizon fold.
 *
 * So the ground is a grid of 192-unit tiles, each a modest 24x24 quads, and
 * only the tiles within `viewChunks` of the player exist. Walking east builds
 * a column of tiles ahead and frees the column behind, which keeps the drawn
 * triangle count flat no matter how far you travel.
 *
 * ── why collision is NOT chunked ───────────────────────────────────────────
 * Collision reads a pre-sampled heightfield covering the entire realm. It is
 * a Float32Array of about 590,000 entries — 2.4MB, sampled once during
 * loading — and having it whole means physics, spawning, pathing and the map
 * screen can ask about anywhere at any time without waiting for a tile. The
 * thing that must never stream is the thing the simulation depends on.
 */

import * as THREE from '../lib/three.module.js?v=v97';
import { CFG } from './config.js?v=v97';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep } from './util.js?v=v97';
import { Terrain, CollisionWorld } from './collision.js?v=v97';
import { REGIONS, REGION_BY_ID, REALM_SIZE, REALM_HALF, SEA,
  regionWeights, regionAt } from './regions.js?v=v97';
import { Network } from './roads.js?v=v97';

const _scratch = [];
const _col = new THREE.Color();
const _tmp = new THREE.Color();
/** River water, blended over the ground colour where a channel is cut. */
const _wetCol = new THREE.Color(0x3a6f8a);

/** How the ground is drawn and streamed. */
export const CHUNK = 192;                 // world units per tile
export const CHUNK_QUADS = 24;            // 8-unit vertices inside a tile
export const CHUNKS_PER_SIDE = Math.round(REALM_SIZE / CHUNK);

export class Realm {
  /**
   * @param scene  where the ground goes
   * @param seed   one number the whole realm derives from, so two machines
   *               generate byte-identical ground from the id alone
   */
  constructor(scene, seed = 90210) {
    this.scene = scene;
    this.seed = seed;
    this.noise = new ValueNoise(seed);
    this.noise2 = new ValueNoise(seed + 991);
    this.rnd = mulberry32(seed);

    /**
     * Roads and rivers, which are part of the GROUND and not decals on it.
     *
     * Handed the base height function — regions and rim, nothing else — so
     * it can sample the untouched terrain for its bed heights without asking
     * about its own output. See roads.js.
     */
    this.network = new Network((x, z) => this.baseHeightAt(x, z));

    this.terrain = null;
    this.collision = null;
    /** Live ground tiles, keyed "ix,iz". */
    this.chunks = new Map();
    this._chunkGeoPool = [];
    this._centre = { ix: 9999, iz: 9999 };
    this.waterMesh = null;

    /**
     * How far the ground is drawn, in tiles.
     *
     * Five is 11x11 tiles — 2112 units across, comfortably past the fog on
     * every region — at about 127,000 triangles for the ground. Lower it and
     * you see tiles appear; raise it and the count grows as the square.
     */
    this.viewChunks = 5;
  }

  // ------------------------------------------------------------------ height

  /**
   * Ground height anywhere in the realm.
   *
   * Pure, total and seed-derived: the same (x, z) gives the same answer on
   * every machine and at every moment. Everything that needs to know where
   * the ground is comes through here — including the pre-sampled heightfield
   * collision uses, which is just this function evaluated on a grid.
   */
  heightAt(x, z) {
    return this.network.carve(x, z, this.baseHeightAt(x, z));
  }

  /**
   * The land before anybody built on it: regions blended, plus the rim.
   *
   * Separate from `heightAt` because the road and river network needs to know
   * where the ground WAS in order to decide where to put its beds. Nothing
   * else should call this — the roads are part of the world, and a system
   * that asks about the ground without them will disagree with collision.
   */
  baseHeightAt(x, z) {
    const total = regionWeights(x, z, _scratch);
    let h = 0;
    for (let i = 0; i < _scratch.length; i++) {
      const e = _scratch[i];
      h += e.region.ground(this.noise, x - e.region.x, z - e.region.z) * e.w;
    }
    h /= total;

    /**
     * The rim.
     *
     * Rises steeply in the outer eighth so the world ends in mountains you
     * cannot walk over rather than in a straight edge with sky beyond it.
     * Measured from the SQUARE distance to the edge, not the radius, because
     * the map is square and a circular rim would leave four walkable corners
     * hanging off the end of it.
     */
    const edge = Math.max(Math.abs(x), Math.abs(z)) / REALM_HALF;
    h += smoothstep(clamp((edge - 0.86) / 0.14, 0, 1)) * 340;
    return h;
  }

  /** The region at a point, for weather, music and what the HUD is told. */
  regionAt(x, z) { return regionAt(x, z, _scratch); }

  /** Blended ground palette at a point, so region borders fade in colour too. */
  paletteAt(x, z, out) {
    const total = regionWeights(x, z, _scratch);
    const keys = ['sand', 'grass', 'grass2', 'dirt', 'rock', 'high', 'road'];
    for (const k of keys) {
      let r = 0, g = 0, b = 0;
      for (const e of _scratch) {
        _tmp.setHex(e.region.palette[k]);
        r += _tmp.r * e.w; g += _tmp.g * e.w; b += _tmp.b * e.w;
      }
      out[k] = out[k] || new THREE.Color();
      out[k].setRGB(r / total, g / total, b / total);
    }
    let dirt = 0, rock = 0, from = 0, highAt = 0;
    for (const e of _scratch) {
      dirt += e.region.palette.slopeDirt * e.w;
      rock += e.region.palette.slopeRock * e.w;
      from += e.region.palette.rockFromY * e.w;
      highAt += e.region.palette.highAt * e.w;
    }
    out.slopeDirt = dirt / total;
    out.slopeRock = rock / total;
    out.rockFromY = from / total;
    out.highAt = highAt / total;
    return out;
  }

  // ------------------------------------------------------------------- build

  /**
   * The labelled build steps, run one per frame by the loader.
   *
   * The heightfield is split across several steps rather than sampled in one
   * go. It is about 590,000 evaluations of a multi-octave noise blend — over
   * half a second of solid work — and doing that inside a single frame means
   * the loading bar freezes at whatever it last said, which reads as a hang.
   */
  buildTasks() {
    const SLICES = 10;
    const tasks = [];
    tasks.push(['Waking the realm', () => {
      const cell = 4.5;
      const grid = Math.round(REALM_SIZE / cell) + 1;
      // Allocated empty and filled by the slices below.
      this.terrain = new Terrain(REALM_SIZE, grid, () => 0);
      this.collision = new CollisionWorld(this.terrain);
      this.collision.climbLimitY = Infinity;
      /**
       * THE SAME 0.86, AND THE SAME METRIC.
       *
       * `heightAt` raises the mountain rim from `max(|x|, |z|) / REALM_HALF`
       * crossing 0.86, and this refuses steep climbs past the same number —
       * but it used to measure a CIRCLE, and the two disagree everywhere
       * except on the axes. On a diagonal the circle bit at 0.61 of the
       * Chebyshev distance, which is roughly a quarter of the map inside the
       * mountains you can see, and the player got a slope that silently
       * would not be climbed with nothing there to explain it.
       *
       * One word, and the refusal now happens exactly where the mountains
       * are. See `climbLimitShape` in js/collision.js.
       */
      this.collision.climbLimitShape = 'square';
      this.collision.climbLimitRadius = REALM_HALF * 0.86;
    }]);
    /**
     * Rivers and roads BEFORE the heightfield.
     *
     * They only sample about a hundred and thirty points between them, so
     * they are almost free — but everything the heightfield records has to
     * already include them, or collision would disagree with the mesh about
     * where the roads are.
     */
    for (const t of this.network.buildTasks()) tasks.push(t);
    for (let s = 0; s < SLICES; s++) {
      const which = s;
      tasks.push([`Raising the land (${s + 1}/${SLICES})`, () => {
        const t = this.terrain, g = t.grid;
        const from = Math.floor((g * which) / SLICES);
        const to = Math.floor((g * (which + 1)) / SLICES);
        for (let j = from; j < to; j++) {
          const z = -t.half + j * t.cell;
          for (let i = 0; i < g; i++) {
            t.heights[j * g + i] = this.heightAt(-t.half + i * t.cell, z);
          }
        }
      }]);
    }
    tasks.push(['Filling the water', () => this._buildWater()]);
    return tasks;
  }

  /**
   * One water plane over the whole realm, at the waterline.
   *
   * ── why it used to leave holes in lakes ───────────────────────────────────
   * The surface ripples, and the ripple was ±0.9 units on a plane tessellated
   * at 170 units per quad — about two vertices per wavelength. So the trough
   * of every wave dipped nearly a metre BELOW the waterline while the crest
   * rose a metre above it, and everywhere a lake bed sits within a metre of
   * SEA (which is most of a shoreline, and all of a shallow lake) the water
   * simply was not there. From the bank it read as a lake that had not been
   * filled in.
   *
   * Now the ripple is a fifth of that and the plane sits a touch above the
   * line, so the surface never falls below the level the swim check uses, and
   * the tessellation is fine enough that the wave is a wave rather than a set
   * of facets. Cheaper, too: the animation walks every vertex at 30Hz.
   */
  _buildWater() {
    const geo = new THREE.PlaneGeometry(REALM_SIZE, REALM_SIZE, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: 0x2f7fa8, transparent: true, opacity: 0.72,
      emissive: 0x0d3348, emissiveIntensity: 0.5,
      // DoubleSide, or the surface vanishes from below and being underwater
      // looks like being in empty blue space.
      side: THREE.DoubleSide, depthWrite: false,
    }));
    // A hair above the line the swim check reads, so the ripple's trough is
    // still at or above it.
    mesh.position.y = SEA + 0.18;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.waterMesh = mesh;
    this.waterBase = geo.attributes.position.array.slice();
  }

  // ------------------------------------------------------------- streaming

  /**
   * Build and free ground tiles around a position.
   *
   * Cheap to call every frame: it returns immediately unless the player has
   * crossed into a different tile, which happens once every 192 units.
   */
  streamAround(x, z, force = false) {
    const ix = Math.floor((x + REALM_HALF) / CHUNK);
    const iz = Math.floor((z + REALM_HALF) / CHUNK);
    if (!force && ix === this._centre.ix && iz === this._centre.iz) return 0;
    this._centre.ix = ix;
    this._centre.iz = iz;

    const R = this.viewChunks;
    const wanted = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = ix + dx, cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= CHUNKS_PER_SIDE || cz >= CHUNKS_PER_SIDE) continue;
        // Round, not square: the corners of a square block are further away
        // than the fog reaches, so building them is work nobody sees.
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        wanted.add(`${cx},${cz}`);
      }
    }

    let built = 0;
    for (const key of wanted) {
      if (this.chunks.has(key)) continue;
      const [cx, cz] = key.split(',').map(Number);
      this.chunks.set(key, this._buildChunk(cx, cz));
      built++;
    }
    for (const [key, chunk] of [...this.chunks]) {
      if (wanted.has(key)) continue;
      this._freeChunk(chunk);
      this.chunks.delete(key);
    }
    return built;
  }

  /**
   * One ground tile.
   *
   * Its geometry is taken from a pool rather than allocated. Walking across
   * the realm builds and frees thousands of tiles, and a fresh
   * PlaneGeometry each time is thousands of buffer allocations the garbage
   * collector has to chase — which is felt as a stutter every 192 units,
   * exactly when the player is moving fastest.
   */
  _buildChunk(cx, cz) {
    const N = CHUNK_QUADS;
    const x0 = -REALM_HALF + cx * CHUNK;
    const z0 = -REALM_HALF + cz * CHUNK;

    let geo = this._chunkGeoPool.pop();
    if (!geo) {
      geo = new THREE.PlaneGeometry(CHUNK, CHUNK, N, N);
      geo.rotateX(-Math.PI / 2);
      geo.setAttribute('color',
        new THREE.BufferAttribute(new Float32Array((N + 1) * (N + 1) * 3), 3));
    }
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const pal = this._pal || (this._pal = {});

    for (let i = 0; i < pos.count; i++) {
      // The pooled plane is centred on the origin; shift it to this tile.
      const lx = pos.getX(i), lz = pos.getZ(i);
      const wx = x0 + CHUNK / 2 + lx, wz = z0 + CHUNK / 2 + lz;
      const h = this.heightAt(wx, wz);
      pos.setY(i, h);

      this.paletteAt(wx, wz, pal);
      const slope = this._slopeAt(wx, wz);
      const varia = this.noise2.fbm(wx * 0.05, wz * 0.05, 2) * 0.5 + 0.5;

      if (h < SEA + 1.4) _col.copy(pal.sand);
      else if (h > pal.highAt) _col.copy(pal.high);
      else {
        _col.copy(pal.grass).lerp(pal.grass2, varia);
        if (slope > pal.slopeDirt) {
          _col.lerp(pal.dirt, clamp((slope - pal.slopeDirt) / 0.22, 0, 1));
        }
        if (slope > pal.slopeRock) {
          _col.lerp(pal.rock, clamp((slope - pal.slopeRock) / 0.3, 0, 1));
        }
        if (h > pal.rockFromY) {
          _col.lerp(pal.rock, clamp((h - pal.rockFromY) / 40, 0, 1));
        }
        if (h > pal.highAt - 30) {
          _col.lerp(pal.high, clamp((h - (pal.highAt - 30)) / 30, 0, 1));
        }
      }
      /**
       * The road and the river, painted last.
       *
       * Both are already IN the height — this is only the surface, so a road
       * reads as a road from the air and a river reads as water even where it
       * has cut too shallow for the water plane to cover it. The road colour
       * is the region's own, so the Thirstlands has a pale sand track and
       * Hollowroot has churned mud.
       */
      const road = this.network.roadAt(wx, wz);
      if (road > 0.01) _col.lerp(pal.road, road * 0.85);
      const wet = this.network.riverAt(wx, wz);
      if (wet > 0.01) _col.lerp(_wetCol, wet * 0.7);

      const shade = 0.9 + varia * 0.2;
      col.setXYZ(i, _col.r * shade, _col.g * shade, _col.b * shade);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = this._groundMat || (this._groundMat =
      new THREE.MeshLambertMaterial({ vertexColors: true }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x0 + CHUNK / 2, 0, z0 + CHUNK / 2);
    mesh.receiveShadow = true;
    mesh.name = `ground:${cx},${cz}`;
    this.scene.add(mesh);
    return { mesh, geo };
  }

  _freeChunk(chunk) {
    this.scene.remove(chunk.mesh);
    // Geometry goes back to the pool, not to the GPU's free list: it will be
    // wanted again the moment the player turns round.
    if (this._chunkGeoPool.length < 160) this._chunkGeoPool.push(chunk.geo);
    else chunk.geo.dispose();
  }

  /** Slope in the same 0..1 terms Terrain.slopeAt uses, from the height fn. */
  _slopeAt(x, z) {
    const e = 3.4;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.min(1, Math.hypot(dx, dz) / 3);
  }

  // ---------------------------------------------------------------- update

  update(dt, cameraPos) {
    if (cameraPos) this.streamAround(cameraPos.x, cameraPos.z);
    // Water ripple, refreshed at ~30Hz like the arena's.
    this._wacc = (this._wacc || 0) + dt;
    if (this._wacc > 1 / 30 && this.waterMesh) {
      const t = (this._wtime = (this._wtime || 0) + this._wacc);
      this._wacc = 0;
      const p = this.waterMesh.geometry.attributes.position;
      const base = this.waterBase;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        // Amplitude 0.18 total, not 0.9 — see `_buildWater`. Shorter waves
        // too, so the plane's own tessellation can actually describe them.
        p.array[i * 3 + 1] = Math.sin(x * 0.05 + t * 1.1) * 0.10
          + Math.sin(z * 0.062 - t * 0.85) * 0.08;
      }
      p.needsUpdate = true;
    }
  }

  /**
   * Ground near (x, z) that something can actually be built or fought on.
   *
   * A region declares roughly where its boss stands or its village sits. The
   * ground under that point is GENERATED, so "roughly" sometimes lands in a
   * lake or halfway up a cliff — measured on the first pass: a boss arena
   * underwater, one on a 0.44 slope, and three sites likewise. Nudging the
   * coordinates by hand fixes it until the next time the height function
   * changes, and then silently breaks again.
   *
   * So the declared point is a HINT and this finds the real spot: spiral out
   * from it and take the first place that is dry, gentle underfoot, and flat
   * enough across `want` to stand an arena on. Nothing found means the least
   * bad candidate, because a boss that exists somewhere slightly wrong beats
   * a boss that does not exist.
   *
   * @param want  radius the thing needs, in world units
   * @param inside  a region it must remain inside, or null
   */
  placeSpot(x, z, want = 20, inside = null, maxSlope = 0.30) {
    /**
     * How deep the ground may be, and how steep.
     *
     * An amphibious region is a marsh and demanding dry land in one is
     * demanding it stop being a marsh — its warden is the Warden of the
     * Shallows and its village stands on stilts. Wading depth is walkable
     * here, so those regions accept ground a couple of metres under.
     *
     * The slope ceiling is the caller's, because the two things placed here
     * want different ground. A boss ARENA has to be close to level — you
     * fight there, and footing is the fight. A SITE is a building or a
     * standing stone, and a ruin on a slope is a ruin on a slope: those are
     * given more room, up to but never past the 0.46 the character controller
     * will actually walk. The Choir Cliffs are made of ridged noise and their
     * terrain bleeds a long way into the Hollow City, so demanding arena
     * flatness for a gatehouse there rejects the entire northern half of the
     * map and hands back the unimproved hint.
     */
    const wading = inside && inside.amphibious;
    const dry = wading ? SEA - 2.2 : SEA + 1.2;
    let best = null, bestScore = -Infinity;
    /**
     * Flat is a preference, standable is a requirement.
     *
     * Relief across the whole footprint used to be a hard reject, and in a
     * region built out of ridged noise nothing on the map passes it — so the
     * search gave up and handed back the bad hint it was asked to improve on,
     * which is the one outcome worse than not searching. `relaxed` is the
     * second pass: still dry, still standable, no longer fussy about being
     * level. A shrine on a slope is a shrine on a slope; a shrine in a lake
     * is a bug.
     */
    let relaxed = false;
    // Twenty rings at 0.6 of the footprint: far enough to walk out of a pit
    // or off a ridge, which 120 units was not.
    for (let ring = 0; ring <= 20; ring++) {
      // One more sweep with the flatness rule dropped, if nothing qualified.
      if (ring === 20 && !best && !relaxed) { relaxed = true; ring = -1; continue; }
      const rad = ring * Math.max(14, want * 0.6);
      const steps = ring === 0 ? 1 : 6 + ring * 3;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2 + ring * 0.7;
        const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
        if (Math.max(Math.abs(px), Math.abs(pz)) > REALM_HALF * 0.84) continue;
        if (inside && regionAt(px, pz, _scratch) !== inside) continue;
        const h = this.heightAt(px, pz);
        if (h < dry) continue;
        const slope = this._slopeAt(px, pz);
        if (slope > maxSlope) continue;
        // Flat ENOUGH across the whole footprint, not just at the middle: a
        // gentle point on the lip of a pit is still the lip of a pit.
        let lo = h, hi = h;
        for (let s = 0; s < 8; s++) {
          const sa = (s / 8) * Math.PI * 2;
          const sh = this.heightAt(px + Math.cos(sa) * want, pz + Math.sin(sa) * want);
          if (sh < lo) lo = sh;
          if (sh > hi) hi = sh;
        }
        const relief = hi - lo;
        if (!relaxed && relief > Math.max(14, want * 0.85)) continue;
        // Nearest wins; flatness breaks ties.
        const score = -rad - relief * 2;
        if (score > bestScore) { bestScore = score; best = { x: px, y: h, z: pz }; }
      }
      if (best && ring >= 1) break;      // close enough, stop searching
    }
    if (best) return best;
    return { x, y: this.heightAt(x, z), z };
  }

  /** Somewhere on dry, walkable land inside a region. */
  landingSpot(region, rnd = Math.random) {
    for (let i = 0; i < 200; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * region.r * 0.7;
      const x = region.x + Math.cos(a) * d, z = region.z + Math.sin(a) * d;
      const h = this.heightAt(x, z);
      if (h < SEA + 1.2) continue;
      if (this._slopeAt(x, z) > 0.34) continue;
      return { x, y: h, z };
    }
    return { x: region.x, y: this.heightAt(region.x, region.z), z: region.z };
  }

  dispose() {
    for (const [, chunk] of this.chunks) {
      this.scene.remove(chunk.mesh);
      chunk.geo.dispose();
    }
    this.chunks.clear();
    for (const g of this._chunkGeoPool) g.dispose();
    this._chunkGeoPool.length = 0;
    if (this._groundMat) { this._groundMat.dispose(); this._groundMat = null; }
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh.material.dispose();
      this.waterMesh = null;
    }
  }
}
