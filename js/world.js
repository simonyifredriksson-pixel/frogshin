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

import * as THREE from '../lib/three.module.js?v=v48';
import { CFG } from './config.js?v=v48';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep } from './util.js?v=v48';
import { Terrain, CollisionWorld } from './collision.js?v=v48';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

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
  constructor(scene) {
    this.scene = scene;
    this.rnd = mulberry32(CFG.world.seed);
    this.noise = new ValueNoise(CFG.world.seed);
    this.noise2 = new ValueNoise(CFG.world.seed + 991);
    this.spawnPoints = [];
    this.lanterns = [];          // { mesh, baseY, phase } — bob animation
    this.grassPatches = [];
    this.waterMesh = null;
    this.time = 0;

    // Flat regions carved into the terrain so structures have somewhere to sit.
    this.flats = [
      { x: 0,    z: 0,    r: 40, f: 26, h: 4.0 },    // Lotus Arena (centre)
      { x: 0,    z: -142, r: 27, f: 30, h: 62.0 },   // Sky Shrine plateau
      { x: -34,  z: 132,  r: 46, f: 30, h: 11.0 },   // Temple village
      { x: 128,  z: 26,   r: 42, f: 30, h: 8.0 },    // Bamboo grove
      { x: -132, z: -44,  r: 17, f: 18, h: 40.0 },   // West mesa top
      { x: -96,  z: -104, r: 13, f: 15, h: 27.0 },   // Stepping mesa
      { x: 86,   z: -96,  r: 20, f: 22, h: 24.0 },   // East cliff terrace
    ];
    // Water basin.
    this.basins = [{ x: -66, z: 70, r: 32, f: 22, h: -3.0 }];
  }

  // -------------------------------------------------------- height function

  /**
   * Terrain height in world space. Pure function of (x,z) and the seed, so it
   * is safe to evaluate from anywhere (mesh build, collision, prop placement).
   */
  heightAt(x, z) {
    const S = CFG.world.size;
    const dCenter = Math.hypot(x, z) / (S * 0.5);

    // Rolling base terrain.
    let h = this.noise.fbm(x * 0.0062, z * 0.0062, 5) * 15 + 8;
    h += this.noise2.fbm(x * 0.021, z * 0.021, 3) * 3.2;

    // Mountains rise toward the rim and dominate the northern wall.
    const rim = smoothstep(clamp((dCenter - 0.40) / 0.42, 0, 1));
    const north = smoothstep(clamp((-z - 60) / 110, 0, 1));
    const mountainMask = clamp(rim * 0.85 + north * 0.75, 0, 1.35);
    const ridge = this.noise.ridged(x * 0.0048 + 11, z * 0.0048 - 7, 4);
    h += ridge * 96 * mountainMask;

    // Hard rim so players cannot wander off the edge of the heightfield.
    const edge = smoothstep(clamp((dCenter - 0.86) / 0.14, 0, 1));
    h += edge * 150;

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

  // ------------------------------------------------------------------ build

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
      ['Carving the valley', () => this._buildTerrainMesh()],
      ['Filling the lake', () => this._buildWater()],
      ['Laying the Lotus Arena', () => this._buildArena()],
      ['Building the temple village', () => this._buildVillage()],
      ['Hanging the Sky Shrine', () => this._buildShrine()],
      ['Planting the bamboo grove', () => this._buildBambooGrove()],
      ['Stacking the rock spires', () => this._buildSpires()],
      ['Stringing the rope bridges', () => this._buildBridges()],
      ['Growing the forests', () => this._buildForests()],
      ['Scattering stones', () => { this._buildRocks(); this._buildLanterns(); }],
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

    const cGrass = new THREE.Color(0x4f9e3a);
    const cGrass2 = new THREE.Color(0x67b34a);
    const cDirt = new THREE.Color(0x8a6b3f);
    const cSand = new THREE.Color(0xd6c48a);
    const cRock = new THREE.Color(0x6f6a63);
    const cSnow = new THREE.Color(0xeef2f6);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.terrain.heightAt(x, z);
      pos.setY(i, h);

      const slope = this.terrain.slopeAt(x, z);
      const varia = this.noise2.fbm(x * 0.03, z * 0.03, 2) * 0.5 + 0.5;

      if (h < waterLevel + 1.2) tmp.copy(cSand);
      // Same constant the climb limit uses, so where the snow starts is
      // exactly where the mountain stops letting you walk up it.
      else if (h > CFG.world.snowLine) {
        tmp.copy(cSnow).lerp(cRock, clamp((80 - h) / 22, 0, 1) * 0.5);
      }
      else {
        tmp.copy(cGrass).lerp(cGrass2, varia);
        if (slope > 0.28) tmp.lerp(cDirt, clamp((slope - 0.28) / 0.22, 0, 1));
        if (slope > 0.46) tmp.lerp(cRock, clamp((slope - 0.46) / 0.3, 0, 1));
        if (h > 52) tmp.lerp(cRock, clamp((h - 52) / 20, 0, 1));
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
    const { size, waterLevel } = CFG.world;
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

  /** Visual-only box (no collision) — trim, banners, decoration. */
  deco(cx, cy, cz, hx, hy, hz, color, rotY = 0, rotX = 0, rotZ = 0) {
    this.batches.box.add(cx, cy, cz, hx * 2, hy * 2, hz * 2, color, rotY, rotX, rotZ);
  }

  /** Pagoda-style flared roof: a 4-sided pyramid plus an overhanging slab. */
  roof(cx, cy, cz, radius, height, color, rotY = Math.PI / 4) {
    this.batches.roof.add(cx, cy + height * 0.5, cz, radius, height, radius, color, rotY);
    this.deco(cx, cy - 0.12, cz, radius * 0.78, 0.16, radius * 0.78, 0x3a2a22);
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

    // ---- plinth: three stone steps, so it reads as approachable ----
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
  }

  // ------------------------------------------------------------ arena (0,0)

  _buildArena() {
    const rnd = this.rnd;
    const baseY = 4.0;

    // Stone dais with steps.
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

      let ly = y;
      for (let l = 0; l < levels; l++) {
        const sw = w * (1 - l * 0.13), sd = dpt * (1 - l * 0.13);
        const hgt = 3.0;
        this.solid(x, ly + hgt / 2, z, sw, hgt / 2, sd, l === 0 ? 0xe4dcc8 : 0xd8cfb8, 'wood');
        // Dark timber framing.
        this.deco(x, ly + hgt - 0.15, z, sw + 0.06, 0.18, sd + 0.06, 0x4a382a);
        this.deco(x, ly + 0.2, z, sw + 0.06, 0.2, sd + 0.06, 0x4a382a);
        this.roof(x, ly + hgt + 0.3, z, Math.max(sw, sd) * 1.5, 1.9, 0x8c3f36);
        ly += hgt + 1.0;
      }
      houses.push({ x, z, top: ly, w, d: dpt });
      if (rnd() < 0.55) this.lantern(x + (rnd() - 0.5) * 4, ly + 3.5 + rnd() * 3, z + (rnd() - 0.5) * 4, 0xff9a5c);
    }
    this.villageHouses = houses;

    // Central great pagoda — the tallest thing in the village.
    const px = cx, pz = cz, py = this.heightAt(px, pz);
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

    // Wide stone terrace on the plateau.
    this.solid(cx, y + 0.6, cz, 20, 0.8, 16, 0x8e8b81, 'stone');
    this.deco(cx, y + 1.42, cz, 20.2, 0.06, 16.2, 0xa39a86);

    // Colonnade.
    for (let i = 0; i < 6; i++) {
      const ox = -15 + i * 6;
      for (const oz of [-13, 13]) {
        this.solid(cx + ox, y + 5.4, cz + oz, 0.75, 4, 0.75, 0xb0a894, 'stone');
      }
    }

    // Main hall.
    this.solid(cx, y + 5, cz, 11, 3.6, 8, 0xdcd3bc, 'wood');
    this.deco(cx, y + 8.5, cz, 11.2, 0.3, 8.2, 0x4a382a);
    this.roof(cx, y + 8.9, cz, 17, 4.4, 0x2f5d7c);
    this.roof(cx, y + 13.2, cz, 11, 3.4, 0x2f5d7c);
    this.solid(cx, y + 17.6, cz, 0.5, 1.6, 0.5, 0xc9a227, 'stone');
    this.lantern(cx, y + 21, cz, 0x8fe3ff);

    // Great bell.
    this.batches.post.add(cx + 15, y + 4.2, cz + 4, 1.5, 3.0, 1.5, 0x6b5a2a);
    this.collision.addBox(cx + 15, y + 4.2, cz + 4, 1.5, 1.5, 1.5, 'stone');

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

    // Dense bamboo — thin tall posts, cheap and very readable.
    for (let i = 0; i < 190; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 42;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      // Nothing grows in the clearing. Without this the shrine ends up with
      // stalks through its skull, which reads as a bug rather than a shrine.
      if (Math.hypot(x - sx, z - sz) < CLEARING) continue;
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
      spires.push([x, y + 0.9, z]);
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

  _bridge(a, b) {
    const [x1, y1, z1] = a, [x2, y2, z2] = b;
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
      this.batches.box.add(x, y, z, 3.0, 0.16, 1.7, i % 2 ? 0x8a6a45 : 0x7b5c3b, rotY);
      this.collision.addBox(x, y, z, 1.5, 0.22, 1.5, 'wood');
      // Rope rails.
      const s = Math.sin(rotY), c = Math.cos(rotY);
      for (const side of [-1.45, 1.45]) {
        this.batches.post.add(x + c * side, y + 0.9, z - s * side, 0.07, 1.8, 0.07, 0x4a3a2a);
      }
      if (i % 6 === 0) this.lantern(x, y + 5.5, z, 0xffd08a);
    }
    // End posts.
    for (const [px, py, pz] of [a, b]) {
      this.solid(px, py + 1.6, pz, 0.45, 1.8, 0.45, 0x5a442e, 'wood');
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
      // Keep the arena and village interiors clear for combat.
      if (Math.hypot(x, z) < 30) continue;
      if (Math.hypot(x + 34, z - 132) < 26) continue;
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

  _buildSpawns() {
    const rnd = this.rnd;
    // Arena-adjacent spawns.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const d = 22;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.spawnPoints.push([x, this.heightAt(x, z) + 1.2, z]);
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

  randomSpawn() {
    const p = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    return new THREE.Vector3(
      p[0] + (Math.random() - 0.5) * 3,
      p[1] + 0.5,
      p[2] + (Math.random() - 0.5) * 3
    );
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
