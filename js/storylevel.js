/**
 * Story level: the burning swamp village.
 *
 * A deliberately linear map — a raised wooden boardwalk running through
 * flooded swamp, lined with stilt houses, ending at a palisade gate. The
 * boardwalk is the "clear path" the player follows: it is raised, lit by
 * lanterns and flanked by posts, so at no point should the way forward be
 * ambiguous.
 *
 * Layout runs along +Z: spawn at z=0, gate at z=PATH_LENGTH.
 */

import * as THREE from '../lib/three.module.js?v=v38';
import { CFG } from './config.js?v=v38';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep } from './util.js?v=v38';
import { Terrain, CollisionWorld } from './collision.js?v=v38';
import { lanternGlowTexture } from './world.js?v=v38';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export const PATH_LENGTH = 300;      // spawn to gate, in world units
// The dungeon lives in the same scene, just far enough away to never be seen
// from the village. Losing teleports you there rather than swapping scenes.
// Y is well above the terrain: outside the heightfield the sampler clamps to
// the raised outer rim, which would otherwise bury the cell in solid ground.
export const PRISON_ORIGIN = new THREE.Vector3(1200, 300, 0);
const G_RAT = {
  body: new THREE.SphereGeometry(1, 6, 5),
  tail: new THREE.CylinderGeometry(1, 1, 1, 4),
};
export const ARENA_Z = PATH_LENGTH - 34;
export const ARENA_RADIUS = 26;
const HALF = 190;                    // half the level's square extent
const TERRAIN_GRID = 97;             // heightfield samples per axis
const WATER = 1.15;
const PATH_Y = 2.6;                  // boardwalk deck height

class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    this.items.push([x, y, z, sx, sy, sz, color, ry, rx, rz]);
  }
  build(scene, cast = true) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    mesh.castShadow = cast; mesh.receiveShadow = true; mesh.frustumCulled = false;
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
    scene.add(mesh);
    return mesh;
  }
}

export class StoryLevel {
  constructor(scene) {
    this.scene = scene;
    this.rnd = mulberry32(7788);
    this.noise = new ValueNoise(7788);
    this.time = 0;
    this.fires = [];          // { x, y, z, size } — effect emitters
    this.lanterns = [];
    this.sceneActors = [];    // populated by story.js
    this.gatePos = new THREE.Vector3(0, PATH_Y, PATH_LENGTH);
    this.spawnPos = new THREE.Vector3(0, PATH_Y + 0.5, 4);
  }

  /**
   * Ground height. A land corridor follows the path; everything beyond it
   * drops away into swamp water, which is what keeps the route unambiguous
   * without walling the player in.
   */
  heightAt(x, z) {
    const corridor = Math.abs(x);
    let h = 2.05 + this.noise.fbm(x * 0.03, z * 0.03, 3) * 0.55;

    // Sink into water away from the path.
    const bank = smoothstep(clamp((corridor - 17) / 20, 0, 1));
    h = lerp(h, -1.4, bank * 0.92);

    // Scattered mud islands out in the swamp so it is not a flat void.
    const isl = this.noise.fbm(x * 0.012 + 40, z * 0.012, 2);
    if (corridor > 26) h += Math.max(0, isl) * 4.2;

    // Flat arena floor in front of the gate.
    const dArena = Math.hypot(x, z - ARENA_Z);
    const inArena = 1 - smoothstep(clamp((dArena - ARENA_RADIUS) / 8, 0, 1));
    h = lerp(h, PATH_Y - 0.15, inArena);

    // Solid ground right at the gate.
    if (z > PATH_LENGTH - 12) h = Math.max(h, PATH_Y - 0.15);

    // Outer rim so nobody swims off the edge of the world.
    const edge = Math.max(Math.abs(x), Math.abs(z - PATH_LENGTH * 0.5)) / HALF;
    h += smoothstep(clamp((edge - 0.82) / 0.18, 0, 1)) * 60;

    return h;
  }

  buildTasks() {
    return [
      ['Flooding the swamp', () => {
        // 97 samples rather than 129: the swamp is a flat corridor, so the
        // extra resolution cost load time and bought nothing visible.
        this.terrain = new Terrain(HALF * 2, TERRAIN_GRID, (x, z) => this.heightAt(x, z));
        this.collision = new CollisionWorld(this.terrain);
        const mat = () => new THREE.MeshLambertMaterial({});
        this.batches = {
          box:  new Batch(new THREE.BoxGeometry(1, 1, 1), mat()),
          roof: new Batch(new THREE.ConeGeometry(1, 1, 4, 1), mat()),
          post: new Batch(new THREE.CylinderGeometry(1, 1, 1, 6), mat()),
          blob: new Batch(new THREE.IcosahedronGeometry(1, 0), mat()),
          cone: new Batch(new THREE.ConeGeometry(1, 1, 6, 1), mat()),
        };
      }],
      ['Growing the mangroves', () => this._buildTerrainMesh()],
      ['Raising the water', () => this._buildWater()],
      ['Laying the boardwalk', () => this._buildPath()],
      ['Building the village', () => this._buildHouses()],
      ['Setting the fires', () => this._buildFires()],
      ['Barring the gate', () => { this._buildGate(); this._buildArena(); }],
      ['Digging the dungeon', () => this._buildPrison()],
      // The castle is split across several steps so each frame does a
      // bounded amount of work and the loading bar keeps moving.
      ['Cutting the dungeon halls', () => this._castleLower()],
      ['Raising the great hall', () => this._castleHall()],
      ['Opening the courtyard', () => this._castleOuter()],
      ['Waking the village', () => this._buildVillage()],
      ['Choking the air with smoke', () => {
        for (const k in this.batches) {
          this.batches[k].mesh = this.batches[k].build(this.scene, k !== 'blob');
        }
        this.collision.bake();
      }],
    ];
  }

  build() { for (const [, fn] of this.buildTasks()) fn(); return this; }

  // ------------------------------------------------------------- geometry

  _buildTerrainMesh() {
    const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, TERRAIN_GRID - 1, TERRAIN_GRID - 1);
    geo.rotateX(-Math.PI / 2);
    // Centre the level on the path rather than on the origin.
    geo.translate(0, 0, PATH_LENGTH * 0.5);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const mud = new THREE.Color(0x4a4530);
    const moss = new THREE.Color(0x3f5c2c);
    const wet = new THREE.Color(0x2f3a26);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // Read the height the heightfield already computed instead of running
      // the noise stack a second time for every vertex.
      const h = this.terrain.heightAt(x, z);
      pos.setY(i, h);
      const v = this.noise.fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.5;
      if (h < WATER + 0.4) tmp.copy(wet);
      else tmp.copy(mud).lerp(moss, v);
      const sh = 0.82 + v * 0.3;
      colors[i * 3] = tmp.r * sh; colors[i * 3 + 1] = tmp.g * sh; colors[i * 3 + 2] = tmp.b * sh;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  _buildWater() {
    const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 40, 40);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, PATH_LENGTH * 0.5);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x2c4436, transparent: true, opacity: 0.82,
      emissive: 0x121e18, side: THREE.DoubleSide, depthWrite: false,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER;
    this.scene.add(this.water);
    this.waterBase = geo.attributes.position.array.slice();
  }

  /** The raised boardwalk — the route the player is meant to follow. */
  _buildPath() {
    const B = this.batches;
    const rnd = this.rnd;
    const planks = Math.floor(PATH_LENGTH / 2.2);

    for (let i = 0; i <= planks; i++) {
      const z = (i / planks) * PATH_LENGTH;
      // A gentle S-curve keeps it from being a bare corridor.
      const x = Math.sin(z * 0.012) * 7;
      const shade = i % 2 ? 0x6b4a2a : 0x7a5732;
      B.box.add(x, PATH_Y, z, 7.2, 0.3, 2.2, shade);
      this.collision.addBox(x, PATH_Y, z, 3.6, 0.35, 1.2, 'wood');

      // Support piles down into the water.
      if (i % 3 === 0) {
        for (const sx of [-3.1, 3.1]) {
          const gy = this.heightAt(x + sx, z);
          B.post.add(x + sx, (PATH_Y + gy) * 0.5, z, 0.22, PATH_Y - gy, 0.22, 0x4a3420);
        }
      }
      // Hand rails.
      if (i % 2 === 0) {
        for (const sx of [-3.5, 3.5]) {
          B.post.add(x + sx, PATH_Y + 0.6, z, 0.11, 1.2, 0.11, 0x5a3f26);
        }
      }
      // Lanterns light the way — the clearest possible "go this way" signal.
      if (i % 9 === 0) {
        this._lantern(x + 3.5, PATH_Y + 1.7, z, 0xffa63c);
      }
    }

    // Signposts with arrows at intervals.
    for (let k = 1; k <= 4; k++) {
      const z = (k / 5) * PATH_LENGTH;
      const x = Math.sin(z * 0.012) * 7 - 4.6;
      B.post.add(x, PATH_Y + 1.3, z, 0.14, 2.6, 0.14, 0x5a3f26);
      B.box.add(x, PATH_Y + 2.3, z, 1.5, 0.4, 0.12, 0xc9a227, 0.4);
    }
  }

  _lantern(x, y, z, color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 7, 5),
      new THREE.MeshBasicMaterial({ color })
    );
    m.position.set(x, y, z);
    this.scene.add(m);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lanternGlowTexture(), color, transparent: true, opacity: 0.75,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(3.4, 3.4, 1);
    m.add(halo);
    this.batches.post.add(x, y + 0.5, z, 0.05, 1.0, 0.05, 0x2a211c);
    this.lanterns.push({ mesh: m, baseY: y, phase: this.rnd() * 6.28 });
  }

  /** Stilt houses lining the boardwalk, many of them already alight. */
  _buildHouses() {
    const B = this.batches;
    const rnd = this.rnd;
    this.houses = [];

    for (let i = 0; i < 30; i++) {
      const t = 0.04 + (i / 30) * 0.9;
      const z = t * PATH_LENGTH + (rnd() - 0.5) * 6;
      if (z > ARENA_Z - 16) continue;               // keep the arena clear
      const side = i % 2 === 0 ? -1 : 1;
      const px = Math.sin(z * 0.012) * 7 + side * (11 + rnd() * 7);
      const gy = this.heightAt(px, z);
      const floor = PATH_Y + 0.4 + rnd() * 0.8;
      const w = 3.2 + rnd() * 2.0;
      const d = 3.2 + rnd() * 2.0;
      const wallH = 3.0 + rnd() * 1.2;
      const burning = rnd() < 0.55;

      // Stilts.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = px + sx * (w - 0.4), lz = z + sz * (d - 0.4);
          const ly = this.heightAt(lx, lz);
          B.post.add(lx, (floor + ly) * 0.5, lz, 0.26, floor - ly, 0.26, 0x4a3420);
        }
      }
      // Deck + walls.
      B.box.add(px, floor, z, w * 2, 0.3, d * 2, 0x6b4a2a);
      this.collision.addBox(px, floor, z, w, 0.35, d, 'wood');
      const wallCol = burning ? 0x4a3226 : 0x7d6242;
      B.box.add(px, floor + wallH * 0.5, z, w * 2, wallH, d * 2, wallCol);
      this.collision.addBox(px, floor + wallH * 0.5, z, w, wallH * 0.5, d, 'wood');
      // Thatch roof, heavily overgrown.
      B.roof.add(px, floor + wallH + 1.1, z, Math.max(w, d) * 1.75, 2.2,
        Math.max(w, d) * 1.75, burning ? 0x5c3a1e : 0x6f6234, Math.PI / 4);
      B.blob.add(px + (rnd() - 0.5) * w, floor + wallH + 1.4, z + (rnd() - 0.5) * d,
        1.4, 0.7, 1.4, 0x4e7a34);

      if (burning) {
        this.fires.push({ x: px, y: floor + wallH + 0.6, z, size: 1.5 + rnd() });
        if (rnd() < 0.6) this.fires.push({ x: px + (rnd() - 0.5) * w * 1.4, y: floor + 0.5, z: z + (rnd() - 0.5) * d * 1.4, size: 1.0 });
      }
      this.houses.push({ x: px, y: floor, z, w, d, burning });
    }

    // Mangroves and reeds everywhere else.
    for (let i = 0; i < 420; i++) {
      const x = (rnd() * 2 - 1) * (HALF - 20);
      const z = rnd() * (HALF * 2) - HALF + PATH_LENGTH * 0.5;
      const gy = this.heightAt(x, z);
      if (gy < WATER - 2 || gy > 22) continue;
      if (Math.abs(x - Math.sin(z * 0.012) * 7) < 6) continue;   // keep the path clear
      const h = 6 + rnd() * 12;
      B.post.add(x, gy + h * 0.5, z, 0.3 + rnd() * 0.25, h, 0.3 + rnd() * 0.25, 0x4a3a26);
      // Drooping canopy.
      B.blob.add(x, gy + h, z, 2.4 + rnd() * 1.6, 1.4, 2.4 + rnd() * 1.6, 0x3f5f2c, rnd() * 3);
      if (rnd() < 0.4) {
        B.blob.add(x + (rnd() - 0.5) * 3, gy + h - 1.5, z + (rnd() - 0.5) * 3,
          1.4, 0.9, 1.4, 0x4a6b33, rnd() * 3);
      }
      if (h > 12) this.collision.addAnchor(x, gy + h, z, 1.7);
      this.collision.addBox(x, gy + h * 0.4, z, 0.4, h * 0.4, 0.4, 'tree');
    }
  }

  _buildFires() {
    // A few extra ground fires along the route for atmosphere.
    const rnd = this.rnd;
    for (let i = 0; i < 16; i++) {
      const z = rnd() * (ARENA_Z - 20) + 10;
      const side = rnd() < 0.5 ? -1 : 1;
      const x = Math.sin(z * 0.012) * 7 + side * (7 + rnd() * 12);
      const y = this.heightAt(x, z);
      if (y < WATER) continue;
      this.fires.push({ x, y: y + 0.4, z, size: 0.9 + rnd() * 0.8 });
      // Charred debris.
      this.batches.box.add(x, y + 0.2, z, 1.4, 0.3, 1.4, 0x2a2018, rnd() * 3);
    }
  }

  /** The palisade and gate that close off the far end. */
  _buildGate() {
    const B = this.batches;
    const z = PATH_LENGTH;
    const gx = 0;

    // Palisade wall across the whole corridor.
    for (let i = -14; i <= 14; i++) {
      const x = gx + i * 2.1;
      if (Math.abs(i) < 4) continue;        // gap for the gate itself
      const h = 9 + Math.abs(Math.sin(i * 1.7)) * 1.6;
      B.post.add(x, PATH_Y + h * 0.5, z, 1.0, h, 1.0, 0x5a3f26);
      B.cone.add(x, PATH_Y + h, z, 1.0, 1.2, 1.0, 0x4a3420);
      this.collision.addBox(x, PATH_Y + h * 0.5, z, 1.05, h * 0.5, 1.05, 'wood');
    }

    // Gate frame and closed doors.
    for (const sx of [-8.4, 8.4]) {
      B.post.add(gx + sx, PATH_Y + 6, z, 1.3, 12, 1.3, 0x4a3420);
      this.collision.addBox(gx + sx, PATH_Y + 6, z, 1.35, 6, 1.35, 'wood');
    }
    B.box.add(gx, PATH_Y + 11.4, z, 10.5, 1.1, 1.6, 0x4a3420);
    B.box.add(gx, PATH_Y + 4.6, z, 8.2, 9.2, 0.9, 0x6b4a2a);
    this.collision.addBox(gx, PATH_Y + 4.6, z, 8.2, 4.6, 0.7, 'wood');
    // Iron banding.
    for (const y of [1.6, 4.6, 7.6]) {
      B.box.add(gx, PATH_Y + y, z, 8.4, 0.4, 1.1, 0x3d434c);
    }
    this._lantern(gx - 9.4, PATH_Y + 8.5, z - 1, 0xff7a2c);
    this._lantern(gx + 9.4, PATH_Y + 8.5, z - 1, 0xff7a2c);

    this.gatePos.set(gx, PATH_Y, z);
  }

  /**
   * The boss arena. A ring of invisible walls backed by a visible line of
   * soldiers, so the boundary is obvious rather than a mystery wall.
   */
  _buildArena() {
    this.arenaCenter = new THREE.Vector3(0, PATH_Y, ARENA_Z);
    this.soldierSpots = [];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * ARENA_RADIUS;
      const z = ARENA_Z + Math.sin(a) * ARENA_RADIUS;
      // Leave the gate side open visually; the wall still blocks.
      this.soldierSpots.push([x, this.heightAt(x, z), z, Math.atan2(-x, ARENA_Z - z)]);
    }
    // Barrier segments forming a rough circle.
    this.arenaWalls = [];
    const segs = 20;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a) * (ARENA_RADIUS + 2.2);
      const z = ARENA_Z + Math.sin(a) * (ARENA_RADIUS + 2.2);
      this.arenaWalls.push({ x, y: PATH_Y + 5, z, hx: 3.2, hy: 6, hz: 3.2 });
    }
  }

  /**
   * The castle dungeon you wake in after losing.
   *
   * Built at load time but placed far from the village (PRISON_ORIGIN) rather
   * than in a second scene, so the defeat transition is just a teleport —
   * no scene swap, no hitch behind the fade.
   */
  _buildPrison() {
    const B = this.batches;
    const rnd = this.rnd;
    const O = PRISON_ORIGIN;
    const W = 9, D = 7.5, H = 7;      // half-width, half-depth, height

    this.prisonSpawn = new THREE.Vector3(O.x - 3.5, O.y + 0.2, O.z + 2.5);
    this.prisonLook = new THREE.Vector3(O.x + W, O.y + 2.2, O.z);

    const stone = [0x4a4a4c, 0x545456, 0x3f3f42, 0x5b5b5d, 0x46464a];
    const pick = () => stone[Math.floor(rnd() * stone.length)];

    // ---- floor: irregular slabs ----
    for (let ix = -6; ix <= 6; ix++) {
      for (let iz = -5; iz <= 5; iz++) {
        const x = O.x + ix * 1.5, z = O.z + iz * 1.5;
        B.box.add(x + (rnd() - 0.5) * 0.1, O.y - 0.15, z + (rnd() - 0.5) * 0.1,
          1.48, 0.3, 1.48, pick());
      }
    }
    this.collision.addBox(O.x, O.y - 0.2, O.z, W + 1, 0.3, D + 1, 'stone');

    // ---- walls: courses of blocks, offset every other row ----
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const y = O.y + 0.4 + r * 0.78;
      const off = (r % 2) * 0.6;
      // Long walls (±Z).
      for (let i = -7; i <= 7; i++) {
        const x = O.x + i * 1.25 + off;
        for (const sz of [-1, 1]) {
          // Leave a gap for the barred door on the +X wall handled below.
          B.box.add(x, y, O.z + sz * D, 1.22, 0.76, 0.7, pick());
        }
      }
      // Short walls (±X).
      for (let i = -5; i <= 5; i++) {
        const z = O.z + i * 1.35 + off;
        // Doorway gap on the +X wall.
        const isDoor = Math.abs(z - O.z) < 2.2 && r < 6;
        if (!isDoor) B.box.add(O.x + W, y, z, 0.7, 0.76, 1.32, pick());
        B.box.add(O.x - W, y, z, 0.7, 0.76, 1.32, pick());
      }
    }
    // Wall colliders. The +X wall is split around the doorway so the barred
    // door itself can be opened later.
    for (const sz of [-1, 1]) this.collision.addBox(O.x, O.y + 3.5, O.z + sz * D, W + 1, 4, 0.8, 'stone');
    this.collision.addBox(O.x - W, O.y + 3.5, O.z, 0.8, 4, D, 'stone');
    for (const sz of [-1, 1]) {
      this.collision.addBox(O.x + W, O.y + 3.5, O.z + sz * ((D + 2.2) / 2),
        0.8, 4, (D - 2.2) / 2, 'stone');
    }
    // Lintel above the doorway.
    this.collision.addBox(O.x + W, O.y + 5.8, O.z, 0.8, 1.8, 2.4, 'stone');

    // The barred door: solid to walk into, but rays pass straight through it
    // so you can see — and shoot your tongue at — what is on the other side.
    this.cellDoor = this.collision.addBox(O.x + W, O.y + 2.4, O.z, 0.5, 2.4, 2.3, 'bars');
    this.cellDoor.rayTransparent = true;

    // ---- vaulted ceiling ---- (depth spans the FULL room, 2*D wide)
    for (let i = -7; i <= 7; i++) {
      B.box.add(O.x + i * 1.25, O.y + H + 0.3, O.z, 1.26, 0.6, D * 2 + 1.4, pick());
    }
    this.collision.addBox(O.x, O.y + H + 0.5, O.z, W, 0.6, D, 'stone');

    // ---- barred door in the +X wall ----
    for (let i = -4; i <= 4; i++) {
      B.post.add(O.x + W, O.y + 2.4, O.z + i * 0.5, 0.07, 4.8, 0.07, 0x2f2a24);
    }
    for (let j = 0; j < 5; j++) {
      B.box.add(O.x + W, O.y + 0.4 + j * 1.1, O.z, 0.09, 0.09, 2.3, 0x2f2a24);
    }
    // Arch over the door.
    B.box.add(O.x + W, O.y + 5.1, O.z, 0.75, 0.6, 2.8, 0x585a5c);

    // ---- light shaft from a ceiling grate ----
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 2.6, H + 0.4, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xd8e4f0, transparent: true, opacity: 0.10,
        depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    shaft.position.set(O.x + 1.5, O.y + (H + 0.4) * 0.5, O.z - 1.2);
    this.scene.add(shaft);
    this.prisonShaft = shaft;
    // The grate it falls through.
    for (let i = -2; i <= 2; i++) {
      B.box.add(O.x + 1.5 + i * 0.34, O.y + H + 0.1, O.z - 1.2, 0.05, 0.1, 0.9, 0x24211c);
      B.box.add(O.x + 1.5, O.y + H + 0.1, O.z - 1.2 + i * 0.34, 0.9, 0.1, 0.05, 0x24211c);
    }

    // ---- chains hanging from the walls ----
    for (let c = 0; c < 6; c++) {
      const wallX = c % 2 === 0 ? O.x - W + 0.7 : O.x + W - 0.7;
      const z = O.z + (rnd() - 0.5) * D * 1.5;
      const top = O.y + 4.4 + rnd() * 1.4;
      const links = 5 + Math.floor(rnd() * 5);
      for (let l = 0; l < links; l++) {
        B.box.add(wallX, top - l * 0.34, z + Math.sin(l * 1.3) * 0.06,
          0.07, 0.17, 0.07, 0x3a3229, 0, 0, l % 2 ? 0.5 : -0.5);
      }
      // Shackle at the end.
      B.box.add(wallX, top - links * 0.34, z, 0.16, 0.06, 0.16, 0x2f281f);
    }

    // ---- wooden stocks ----
    const sx = O.x - 4.5, sz = O.z - 3.2;
    B.box.add(sx, O.y + 0.9, sz, 0.24, 1.8, 0.24, 0x6b5334);
    B.box.add(sx, O.y + 0.1, sz, 1.5, 0.2, 0.6, 0x5a4529);
    B.box.add(sx, O.y + 1.9, sz, 1.5, 0.5, 0.18, 0x7a5f3c);
    B.box.add(sx, O.y + 2.3, sz, 1.5, 0.28, 0.2, 0x6b5334);
    this.collision.addBox(sx, O.y + 1.0, sz, 0.5, 1.2, 0.5, 'wood');

    // ---- skull with a guttering candle ----
    const kx = O.x - 6.2, kz = O.z + 3.4;
    B.blob.add(kx, O.y + 0.32, kz, 0.34, 0.30, 0.38, 0xd8d2c0);
    B.box.add(kx, O.y + 0.16, kz + 0.26, 0.26, 0.14, 0.14, 0xc8c2b0);
    B.post.add(kx, O.y + 0.78, kz, 0.07, 0.5, 0.07, 0xe8e2cc);
    this._lantern(kx, O.y + 1.06, kz, 0xffc06a);

    // A couple more candles for pools of light.
    this._lantern(O.x + 5.5, O.y + 0.6, O.z + 4.6, 0xff9a4c);
    this._lantern(O.x - 1.5, O.y + 3.4, O.z - D + 0.9, 0xffb45c);

    // ---- straw and rubble on the floor ----
    for (let i = 0; i < 40; i++) {
      const x = O.x + (rnd() - 0.5) * W * 1.7;
      const z = O.z + (rnd() - 0.5) * D * 1.7;
      B.box.add(x, O.y + 0.06, z, 0.22 + rnd() * 0.3, 0.05, 0.06,
        rnd() < 0.6 ? 0x8a7a4a : 0x6f6238, rnd() * 3);
    }
    for (let i = 0; i < 10; i++) {
      const x = O.x + (rnd() - 0.5) * W * 1.6;
      const z = O.z + (rnd() - 0.5) * D * 1.6;
      B.blob.add(x, O.y + 0.12, z, 0.16 + rnd() * 0.2, 0.12, 0.16 + rnd() * 0.2, 0x44444a, rnd() * 3);
    }

    // ---- cobwebs in the corners ----
    const webMat = new THREE.MeshBasicMaterial({
      color: 0xdfe4e8, transparent: true, opacity: 0.16,
      depthWrite: false, side: THREE.DoubleSide,
    });
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const web = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), webMat);
      web.position.set(O.x + cx * (W - 1.4), O.y + H - 1.4, O.z + cz * (D - 1.4));
      web.rotation.set(0, Math.atan2(-cx, -cz) + Math.PI / 4, Math.PI / 4);
      this.scene.add(web);
    }

    // ---- the key, hanging on a hook in the corridor beyond the bars ----
    // Deliberately placed straight through the doorway gap and at eye level,
    // so it is visible from inside the cell the moment you stand up.
    this.keyPos = new THREE.Vector3(O.x + W + 6.5, O.y + 2.15, O.z + 0.8);
    B.box.add(this.keyPos.x + 0.45, this.keyPos.y + 0.5, this.keyPos.z,
      0.1, 0.12, 0.1, 0x3a3229);                                   // hook
    const keyGroup = new THREE.Group();
    const brass = new THREE.MeshLambertMaterial({ color: 0xd9a625, emissive: 0x4a3208 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 6, 12), brass);
    keyGroup.add(ring);
    const keyShaft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), brass);
    keyShaft.position.y = -0.34;
    keyGroup.add(keyShaft);
    for (let i = 0; i < 2; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.06), brass);
      tooth.position.set(0.11, -0.42 - i * 0.14, 0);
      keyGroup.add(tooth);
    }
    keyGroup.position.copy(this.keyPos);
    this.scene.add(keyGroup);
    this.keyMesh = keyGroup;
    // Generous anchor radius — this is a scripted beat, not a precision test.
    this.keyAnchor = { x: this.keyPos.x, y: this.keyPos.y, z: this.keyPos.z, r: 1.5 };
    this.collision.anchors.push(this.keyAnchor);
    // Halo so it reads as the thing to aim at.
    const keyHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lanternGlowTexture(), color: 0xffd76b, transparent: true,
      opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    keyHalo.scale.set(2.6, 2.6, 1);
    keyGroup.add(keyHalo);

    // ---- the sleeping guard, slumped against the corridor wall ----
    this.sleepingGuardPos = new THREE.Vector3(O.x + W + 9.5, O.y, O.z - 2.2);

    // ---- rats ----
    this.rats = [];
    const ratMat = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(G_RAT.body, ratMat);
      body.scale.set(0.16, 0.13, 0.30);
      g.add(body);
      const head = new THREE.Mesh(G_RAT.body, ratMat);
      head.scale.set(0.10, 0.09, 0.12);
      head.position.z = 0.32;
      g.add(head);
      const tail = new THREE.Mesh(G_RAT.tail, ratMat);
      tail.scale.set(0.02, 0.42, 0.02);
      tail.rotation.x = Math.PI / 2;
      tail.position.z = -0.42;
      g.add(tail);
      g.position.set(O.x + (rnd() - 0.5) * 10, O.y + 0.13, O.z + (rnd() - 0.5) * 8);
      this.scene.add(g);
      this.rats.push({
        mesh: g,
        angle: rnd() * Math.PI * 2,
        speed: 0.7 + rnd() * 0.9,
        turn: 0,
        home: new THREE.Vector3(O.x, O.y + 0.13, O.z),
      });
    }
  }

  // -------------------------------------------------------------- castle

  /**
   * Generic stone room. Walls are built as block courses with gaps left for
   * doorways, so corridors and halls can be chained together.
   *
   * @param doors array of { side:'+x'|'-x'|'+z'|'-z', at:number, w:number }
   *              `at` is the centre of the gap along that wall.
   */
  _room(x0, z0, x1, z1, y, h, doors = [], opts = {}) {
    const B = this.batches;
    const rnd = this.rnd;
    const stone = opts.stone || [0x4a4a4c, 0x545456, 0x3f3f42, 0x5b5b5d, 0x46464a];
    const pick = () => stone[Math.floor(rnd() * stone.length)];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;

    // NOTE ON UNITS: Batch.add takes the FULL size of the box (it scales a
    // 1x1x1 cube), while collision.addBox takes HALF extents. Mixing the two
    // up is what made the first castle render as floating blocks with gaps.
    // Every visual size below is therefore >= its loop step, so neighbouring
    // blocks touch and the castle reads as one solid structure.

    // Floor.
    const step = 2.6;
    for (let x = x0; x < x1; x += step) {
      for (let z = z0; z < z1; z += step) {
        B.box.add(x + step / 2, y - 0.15, z + step / 2,
          step + 0.04, 0.34, step + 0.04, pick());
      }
    }
    this.collision.addBox(cx, y - 0.2, cz, hx, 0.3, hz, 'stone');

    const gap = (side, coord) => doors.some(
      (d) => d.side === side && Math.abs(coord - d.at) < d.w / 2);

    // Block size is a deliberate trade: the castle is large, and a finer
    // course would put tens of thousands of instances on screen for detail
    // nobody reads at play distance.
    const RH = 1.1, RW = 1.8;
    const rows = Math.ceil(h / RH);
    for (let r = 0; r < rows; r++) {
      const wy = y + 0.55 + r * RH;
      const off = (r % 2) * 0.9;
      const doorRow = wy < y + (opts.doorHeight || 6);
      // Blocks are a touch wider than the step, so the small course-to-course
      // stagger cannot open a seam.
      const BW = RW + 0.22, BH = RH + 0.05, BT = 0.95;
      for (let x = x0; x <= x1; x += RW) {
        if (!(doorRow && gap('-z', x))) B.box.add(x + off * 0.2, wy, z0, BW, BH, BT, pick());
        if (!(doorRow && gap('+z', x))) B.box.add(x + off * 0.2, wy, z1, BW, BH, BT, pick());
      }
      for (let z = z0; z <= z1; z += RW) {
        if (!(doorRow && gap('-x', z))) B.box.add(x0, wy, z + off * 0.2, BT, BH, BW, pick());
        if (!(doorRow && gap('+x', z))) B.box.add(x1, wy, z + off * 0.2, BT, BH, BW, pick());
      }
    }

    // Wall colliders, split around each doorway.
    const wallCollide = (side, fixed, from, to, axis) => {
      const segs = [[from, to]];
      for (const d of doors) {
        if (d.side !== side) continue;
        const a = d.at - d.w / 2, b = d.at + d.w / 2;
        for (let i = segs.length - 1; i >= 0; i--) {
          const [s0, s1] = segs[i];
          if (b <= s0 || a >= s1) continue;
          segs.splice(i, 1);
          if (a > s0) segs.push([s0, a]);
          if (b < s1) segs.push([b, s1]);
        }
      }
      for (const [s0, s1] of segs) {
        if (s1 - s0 < 0.2) continue;
        const mid = (s0 + s1) / 2, half = (s1 - s0) / 2;
        if (axis === 'x') this.collision.addBox(mid, y + h / 2, fixed, half, h / 2, 0.7, 'stone');
        else this.collision.addBox(fixed, y + h / 2, mid, 0.7, h / 2, half, 'stone');
      }
      // Lintel above each doorway so you cannot leap over the wall.
      for (const d of doors) {
        if (d.side !== side) continue;
        const dh = opts.doorHeight || 6;
        if (h - dh < 0.3) continue;
        if (axis === 'x') this.collision.addBox(d.at, y + dh + (h - dh) / 2, fixed, d.w / 2, (h - dh) / 2, 0.7, 'stone');
        else this.collision.addBox(fixed, y + dh + (h - dh) / 2, d.at, 0.7, (h - dh) / 2, d.w / 2, 'stone');
      }
    };
    wallCollide('-z', z0, x0, x1, 'x');
    wallCollide('+z', z1, x0, x1, 'x');
    wallCollide('-x', x0, z0, z1, 'z');
    wallCollide('+x', x1, z0, z1, 'z');

    // Ceiling (courtyards pass roof:false and stay open to the sky).
    if (opts.roof !== false) {
      const cs = step * 1.4;
      for (let x = x0; x < x1; x += cs) {
        for (let z = z0; z < z1; z += cs) {
          B.box.add(x + cs / 2, y + h + 0.3, z + cs / 2, cs + 0.05, 0.6, cs + 0.05, pick());
        }
      }
      this.collision.addBox(cx, y + h + 0.4, cz, hx, 0.5, hz, 'stone');
    } else {
      // Crenellations around an open courtyard: here the gaps ARE the point,
      // so merlon width is deliberately half the spacing.
      for (let x = x0; x <= x1; x += 2.4) {
        for (const z of [z0, z1]) B.box.add(x, y + h + 0.75, z, 1.2, 1.1, 1.0, pick());
      }
      for (let z = z0; z <= z1; z += 2.4) {
        for (const x of [x0, x1]) B.box.add(x, y + h + 0.75, z, 1.0, 1.1, 1.2, pick());
      }
    }

    // Wall torches for light and readability.
    if (opts.torches !== false) {
      const n = Math.max(2, Math.floor((x1 - x0) / 16));
      for (let i = 0; i < n; i++) {
        const x = lerp(x0 + 4, x1 - 4, n === 1 ? 0.5 : i / (n - 1));
        this._lantern(x, y + 3.4, z0 + 1.0, 0xff9a3c);
        this._lantern(x, y + 3.4, z1 - 1.0, 0xff9a3c);
      }
    }
    return { cx, cz, x0, x1, z0, z1, y, h };
  }

  /**
   * The castle above the dungeon, built in three passes so no single frame
   * has to generate the whole thing: lower halls, the great hall, then the
   * outer courtyard and gatehouse.
   */
  _castleLower() {
    const O = PRISON_ORIGIN;
    const B = this.batches;
    const y = O.y;
    const X = (n) => O.x + n;      // castle coords are relative to the cell

    // ---- dungeon corridor out of the cell ----
    this._room(X(9), O.z - 4.5, X(42), O.z + 4.5, y, 7,
      [{ side: '-x', at: O.z, w: 5 }, { side: '+x', at: O.z, w: 6 }]);

    // Other cells lining the corridor, for flavour.
    for (let i = 0; i < 4; i++) {
      const cxp = X(14 + i * 7);
      for (let k = -5; k <= 5; k++) {
        B.post.add(cxp + k * 0.5, y + 2.2, O.z + 4.4, 0.06, 4.4, 0.06, 0x2f2a24);
      }
    }

    // ---- guard room ----
    const guardRoom = this._room(X(42), O.z - 17, X(72), O.z + 17, y, 8,
      [{ side: '-x', at: O.z, w: 6 }, { side: '+x', at: O.z, w: 6 }]);
    // Table, benches, weapon rack. (Visual = full size, collider = half.)
    B.box.add(X(56), y + 0.9, O.z, 7.0, 0.3, 3.0, 0x6b5334);
    for (const s of [-1, 1]) B.box.add(X(56), y + 0.45, O.z + s * 2.4, 6.4, 0.25, 1.0, 0x5a4529);
    this.collision.addBox(X(56), y + 0.75, O.z, 3.5, 0.5, 1.5, 'wood');
    for (let i = 0; i < 5; i++) {
      B.post.add(X(46 + i * 1.1), y + 1.5, O.z - 15.5, 0.06, 3, 0.06, 0x6b5334);
    }

    // ---- corridor to the hall ----
    this._room(X(72), O.z - 5, X(96), O.z + 5, y, 7,
      [{ side: '-x', at: O.z, w: 6 }, { side: '+x', at: O.z, w: 7 }]);
  }

  _castleHall() {
    const O = PRISON_ORIGIN;
    const B = this.batches;
    const y = O.y;
    const X = (n) => O.x + n;

    // ---- great hall ----
    const hall = this._room(X(96), O.z - 36, X(178), O.z + 36, y, 18,
      [
        { side: '-x', at: O.z, w: 7 },
        { side: '+x', at: O.z, w: 10 },
        { side: '+z', at: X(136) - O.x + O.z * 0, w: 9 },
      ], { doorHeight: 8 });
    // Columns down both sides.
    for (let i = 0; i < 7; i++) {
      const cxp = X(104 + i * 11);
      for (const sz of [-20, 20]) {
        B.post.add(cxp, y + 9, O.z + sz, 1.5, 18, 1.5, 0x585a5c);
        B.box.add(cxp, y + 18.2, O.z + sz, 2.1, 0.7, 2.1, 0x63656a);
        this.collision.addBox(cxp, y + 9, O.z + sz, 1.5, 9, 1.5, 'stone');
        this.collision.addAnchor(cxp, y + 17.5, O.z + sz, 1.8);
      }
    }
    // Long banquet table and a raised dais at the far end.
    B.box.add(X(137), y + 1.0, O.z, 44, 0.35, 4.8, 0x6b5334);
    for (let i = 0; i < 8; i++) {
      B.post.add(X(116 + i * 6), y + 0.5, O.z, 0.22, 1.0, 0.22, 0x5a4529);
    }
    this.collision.addBox(X(137), y + 0.85, O.z, 22, 0.5, 2.4, 'wood');
    B.box.add(X(172), y + 0.35, O.z, 11, 0.7, 24, 0x5b5b5d);
    this.collision.addBox(X(172), y + 0.35, O.z, 5.5, 0.35, 12, 'stone');
    // Banners.
    for (let i = 0; i < 6; i++) {
      const cxp = X(102 + i * 14);
      for (const sz of [-35, 35]) {
        B.box.add(cxp, y + 11, O.z + sz + (sz > 0 ? -0.9 : 0.9), 1.6, 5, 0.1, 0x5e1a14);
      }
    }

    // ---- barracks off the hall ----
    this._room(X(120), O.z + 36, X(158), O.z + 64, y, 9,
      [{ side: '-z', at: X(136), w: 9 }]);
    for (let i = 0; i < 6; i++) {
      const bx = X(126 + (i % 3) * 11), bz = O.z + 44 + Math.floor(i / 3) * 12;
      B.box.add(bx, y + 0.3, bz, 2.8, 0.6, 5.6, 0x6b5334);
      B.box.add(bx, y + 0.68, bz, 2.6, 0.3, 5.2, 0x8a7a4a);
      this.collision.addBox(bx, y + 0.3, bz, 1.4, 0.3, 2.8, 'wood');
    }

  }

  _castleOuter() {
    const O = PRISON_ORIGIN;
    const B = this.batches;
    const rnd = this.rnd;
    const y = O.y;
    const X = (n) => O.x + n;

    // ---- courtyard (open to the sky) ----
    this._room(X(178), O.z - 30, X(240), O.z + 30, y, 14,
      [{ side: '-x', at: O.z, w: 10 }, { side: '+x', at: O.z, w: 9 }],
      { roof: false, doorHeight: 9 });
    // A well, crates and a cart to break sightlines.
    B.post.add(X(205), y + 0.8, O.z - 6, 3.0, 1.6, 3.0, 0x585a5c);
    this.collision.addBox(X(205), y + 0.8, O.z - 6, 3.0, 0.8, 3.0, 'stone');
    for (let i = 0; i < 9; i++) {
      const bx = X(186 + rnd() * 46), bz = O.z - 24 + rnd() * 48;
      const s = 1.8 + rnd() * 1.2;
      B.box.add(bx, y + s / 2, bz, s, s, s, 0x6b4a2a, rnd() * 3);
      this.collision.addBox(bx, y + s / 2, bz, s / 2, s / 2, s / 2, 'wood');
    }

    // ---- gatehouse and the way out ----
    this._room(X(240), O.z - 9, X(262), O.z + 9, y, 10,
      [{ side: '-x', at: O.z, w: 9 }, { side: '+x', at: O.z, w: 8 }],
      { doorHeight: 8 });
    this.castleExit = new THREE.Vector3(X(258), y + 1, O.z);
    this._lantern(X(256), y + 5.5, O.z - 3.5, 0xffd76b);
    this._lantern(X(256), y + 5.5, O.z + 3.5, 0xffd76b);

    // ---- guard patrol routes ----
    this.guardRoutes = [
      // Guard room circuit.
      [[X(48), O.z - 12], [X(66), O.z - 12], [X(66), O.z + 12], [X(48), O.z + 12]],
      // Corridor sentry.
      [[X(76), O.z], [X(93), O.z]],
      // Great hall, down one side and back the other.
      [[X(102), O.z - 28], [X(172), O.z - 28], [X(172), O.z + 28], [X(102), O.z + 28]],
      // Great hall centre.
      [[X(110), O.z], [X(168), O.z]],
      // Barracks to hall.
      [[X(136), O.z + 56], [X(136), O.z + 20]],
      // Courtyard circuit.
      [[X(186), O.z - 22], [X(232), O.z - 22], [X(232), O.z + 22], [X(186), O.z + 22]],
      // Gatehouse pair.
      [[X(246), O.z - 5], [X(256), O.z + 5]],
    ];
  }

  // --------------------------------------------------------------- village

  /**
   * The medieval village outside the castle gate.
   *
   * Built on the same raised slab as the castle (the terrain out here is far
   * below), laid out as a walled market town: a street from the gatehouse to
   * a market square, houses either side, and a perimeter fence with exactly
   * one gap in it. That gap is the way out, and the guide frog's whole job is
   * to take you to it — so the layout has to make it findable but not
   * obvious, which is why it sits behind the market rather than in line with
   * the gate.
   */
  _buildVillage() {
    const O = PRISON_ORIGIN;
    const B = this.batches;
    const rnd = this.rnd;
    const y = O.y;
    const X = (n) => O.x + n;

    // X0 deliberately OVERLAPS the gatehouse floor (which ends at 262). A
    // village slab that merely butted up against it would leave a seam the
    // player drops through — and the ground here is three hundred units down.
    const X0 = 256, X1 = 446;          // village extent along +x
    const Z0 = -64, Z1 = 64;

    // ---- cobbled ground ----
    const step = 4;
    for (let x = X0; x < X1; x += step) {
      for (let z = Z0; z < Z1; z += step) {
        // Two-tone cobbles, with the street a shade lighter than the yards.
        const street = Math.abs(z) < 7 || (x > 320 && x < 372 && Math.abs(z) < 30);
        const shade = street ? 0x6d6a63 : 0x585549;
        const jitter = (rnd() * 0.12 - 0.06);
        B.box.add(X(x + step / 2), y - 0.16, z + step / 2,
          step + 0.05, 0.34, step + 0.05,
          _c.setHex(shade).offsetHSL(0, 0, jitter).getHex());
      }
    }
    // One big collider for the whole plaza rather than hundreds of tiles.
    this.collision.addBox(X((X0 + X1) / 2), y - 0.16, (Z0 + Z1) / 2,
      (X1 - X0) / 2, 0.17, (Z1 - Z0) / 2, 'stone');

    this.villageEnter = new THREE.Vector3(X(272), y + 1, O.z);
    // The bush sits just off the street, close enough that the whisper makes
    // sense and you can see who is talking.
    this.bushPos = new THREE.Vector3(X(288), y, O.z - 13);

    // ---- perimeter fence, with one gap ----
    this.fenceHole = new THREE.Vector3(X(438), y + 1, 30);
    this._fenceRun(X0, Z0, X1, Z0, y, null);              // south
    this._fenceRun(X0, Z1, X1, Z1, y, null);              // north
    this._fenceRun(X1, Z0, X1, Z1, y, 30);               // east, with the gap
    // West side: the castle wall only covers the gatehouse itself, so the
    // village has to close the rest of that edge or you can walk off the slab.
    this._fenceRun(X0, Z0, X0, -11, y, null);
    this._fenceRun(X0, 11, X0, Z1, y, null);
    // Marker posts either side of the gap so it reads as a way through.
    for (const dz of [-3.4, 3.4]) {
      B.post.add(X(X1), y + 1.5, 30 + dz, 0.42, 3.0, 0.42, 0x6b4a2a);
    }
    this._lantern(X(X1) - 1.6, y + 3.4, 30, 0xffd76b);

    // ---- houses either side of the street ----
    this.villageHouses = [];
    for (let i = 0; i < 18; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const px = X0 + 14 + (i >> 1) * 20 + rnd() * 5;
      if (px > X1 - 16) continue;
      const pz = side * (15 + rnd() * 26);
      // Keep the market square open.
      if (px > 316 && px < 376 && Math.abs(pz) < 32) continue;
      this._cottage(X(px), y, pz, 4 + rnd() * 2.4, 4 + rnd() * 2.2,
        4.2 + rnd() * 1.6, rnd);
      this.villageHouses.push({ x: X(px), z: pz });
    }

    // ---- market square: fruit stalls ----
    this.fruitStands = [];
    const stalls = [[330, -14], [330, 14], [364, -14], [364, 14]];
    for (let i = 0; i < stalls.length; i++) {
      const [sx, sz] = stalls[i];
      this._fruitStall(X(sx), y, sz, i, rnd);
    }
    // A well in the middle of the square.
    B.post.add(X(347), y + 0.7, 0, 3.4, 1.4, 3.4, 0x585a5c);
    this.collision.addBox(X(347), y + 0.7, 0, 1.7, 0.7, 1.7, 'stone');
    this._lantern(X(347), y + 4.6, 0, 0xffd76b);

    // Street lanterns down the main run.
    for (let x = X0 + 18; x < X1 - 10; x += 26) {
      this._lantern(X(x), y + 4.2, -6.5, 0xffd76b);
      this._lantern(X(x), y + 4.2, 6.5, 0xffd76b);
    }

    // ---- where the cast stands ----
    // The villager who spots you, and the two soldiers who hear her.
    this.accuserSpot = new THREE.Vector3(X(300), y, O.z + 9);
    this.watchSpots = [
      new THREE.Vector3(X(316), y, O.z - 6),
      new THREE.Vector3(X(319), y, O.z + 4),
    ];

    // Idle villagers wander between these.
    this.villagerSpots = [];
    for (let i = 0; i < 12; i++) {
      this.villagerSpots.push(new THREE.Vector3(
        X(X0 + 20 + rnd() * (X1 - X0 - 40)), y, Z0 + 12 + rnd() * (Z1 - Z0 - 24)));
    }

    // ---- the guide's route to the gap ----
    // Deliberately not a straight line: it rounds the market so you are led
    // through the busiest part of the village rather than along the wall.
    this.guideRoute = [
      new THREE.Vector3(X(300), y, O.z - 16),
      new THREE.Vector3(X(322), y, O.z - 26),
      new THREE.Vector3(X(352), y, O.z - 24),
      new THREE.Vector3(X(378), y, O.z - 6),
      new THREE.Vector3(X(402), y, 14),
      new THREE.Vector3(X(424), y, 26),
      new THREE.Vector3(X(435), y, 30),
    ];

    // ---- 15 guards, scattered ----
    this.villageGuardRoutes = [];
    // Keep every beat well inside the fence: a waypoint outside it would send
    // a guard walking at a wall, or off the slab entirely.
    const PAD = 10;
    const cx = (n) => clamp(n, X0 + PAD, X1 - PAD);
    const cz = (n) => clamp(n, Z0 + PAD, Z1 - PAD);
    for (let i = 0; i < 15; i++) {
      // Spread around the whole village, each pacing a short beat.
      const gx = X0 + 22 + (i % 5) * 34 + rnd() * 8;
      const gz = Z0 + 16 + Math.floor(i / 5) * 34 + rnd() * 10;
      const len = 10 + rnd() * 14;
      const horiz = rnd() < 0.5;
      this.villageGuardRoutes.push(horiz
        ? [[X(cx(gx)), cz(gz)], [X(cx(gx + len)), cz(gz)]]
        : [[X(cx(gx)), cz(gz)], [X(cx(gx)), cz(gz + len)]]);
    }
  }

  /**
   * A run of fence posts and rails, optionally with a gap at `holeZ`.
   *
   * The colliders deliberately OVERLAP along the run (half-extent 1.6 on a
   * 3-unit spacing). Square colliders sized to the posts left 1.2-unit gaps
   * between them, which a frog is slim enough to walk straight through — the
   * fence looked solid and wasn't.
   */
  _fenceRun(x0, z0, x1, z1, y, holeZ) {
    const B = this.batches;
    const O = PRISON_ORIGIN;
    const X = (n) => O.x + n;
    const SPACING = 3;
    const runLen = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.round(runLen / SPACING));
    // Which way the fence runs decides how the rails and colliders lie.
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const railYaw = alongX ? 0 : Math.PI / 2;
    const hx = alongX ? 1.6 : 0.45;
    const hz = alongX ? 0.45 : 1.6;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      // Leave a frog-sized gap — the way out.
      if (holeZ !== null && Math.abs(z - holeZ) < 3.2) continue;
      B.post.add(X(x), y + 1.4, z, 0.34, 2.8, 0.34, 0x5c4126);
      B.box.add(X(x), y + 2.1, z, 3.1, 0.22, 0.16, 0x6b4a2a, railYaw);
      B.box.add(X(x), y + 1.2, z, 3.1, 0.22, 0.16, 0x6b4a2a, railYaw);
      this.collision.addBox(X(x), y + 1.5, z, hx, 1.5, hz, 'wood');
    }
  }

  /** A timber-framed village house. */
  _cottage(x, y, z, w, d, h, rnd) {
    const B = this.batches;
    // Plaster walls with a dark timber frame — the medieval look.
    B.box.add(x, y + h * 0.5, z, w * 2, h, d * 2, 0xd8cfb4);
    this.collision.addBox(x, y + h * 0.5, z, w, h * 0.5, d, 'wood');
    // Corner posts and a mid rail.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        B.post.add(x + sx * w, y + h * 0.5, z + sz * d, 0.34, h, 0.34, 0x4a3420);
      }
    }
    B.box.add(x, y + h * 0.62, z, w * 2 + 0.1, 0.26, d * 2 + 0.1, 0x4a3420);
    // Jettied upper floor, overhanging the street.
    B.box.add(x, y + h + 0.9, z, w * 2.3, 1.8, d * 2.3, 0xcfc5a6);
    B.box.add(x, y + h + 1.8, z, w * 2.35, 0.24, d * 2.35, 0x4a3420);
    // Steep tiled roof.
    B.roof.add(x, y + h + 3.4, z, Math.max(w, d) * 2.5, 3.4,
      Math.max(w, d) * 2.5, 0x6b3f30, Math.PI / 4);
    // Door and a shuttered window.
    B.box.add(x, y + 1.1, z + d + 0.05, 1.2, 2.2, 0.14, 0x4a3420);
    B.box.add(x - w * 0.5, y + 2.2, z + d + 0.05, 1.0, 1.0, 0.12, 0x5c7a8a);
    if (rnd() < 0.5) {
      // Chimney.
      B.box.add(x + w * 0.6, y + h + 3.8, z, 0.8, 2.6, 0.8, 0x6d6a63);
    }
  }

  /**
   * A market fruit stall. Recorded in `fruitStands` so the story can offer a
   * purchase when the player stands at the counter.
   */
  _fruitStall(x, y, z, index, rnd) {
    const B = this.batches;
    // Counter.
    B.box.add(x, y + 0.55, z, 5.0, 1.1, 2.4, 0x7d6242);
    this.collision.addBox(x, y + 0.55, z, 2.5, 0.55, 1.2, 'wood');
    // Awning posts and striped canopy.
    for (const sx of [-1, 1]) {
      B.post.add(x + sx * 2.3, y + 1.6, z - 1.0, 0.16, 3.2, 0.16, 0x4a3420);
      B.post.add(x + sx * 2.3, y + 1.6, z + 1.0, 0.16, 3.2, 0.16, 0x4a3420);
    }
    const cloth = [0xc0392b, 0x2f7a4f, 0xc9a227, 0x3f5f8a][index % 4];
    B.box.add(x, y + 3.3, z, 5.6, 0.3, 3.2, cloth);
    B.box.add(x, y + 3.5, z - 1.5, 5.6, 0.5, 0.3, cloth);

    // Heaped fruit on the counter.
    const colors = [0xd94f3d, 0xe8a33d, 0x8fc44a, 0xb04ac9];
    for (let i = 0; i < 14; i++) {
      B.blob.add(
        x + (rnd() - 0.5) * 4.2, y + 1.25 + rnd() * 0.25, z + (rnd() - 0.5) * 1.6,
        0.26, 0.26, 0.26, colors[Math.floor(rnd() * colors.length)], rnd() * 3);
    }
    // Crates of stock underneath.
    B.box.add(x - 1.6, y + 0.4, z + 1.8, 1.4, 0.8, 1.0, 0x6b4a2a);
    B.box.add(x + 1.5, y + 0.4, z + 1.8, 1.2, 0.8, 1.0, 0x6b4a2a);

    this.fruitStands.push({
      // Stand in FRONT of the counter, on the street side.
      pos: new THREE.Vector3(x, y, z + 2.6),
      id: 'stall' + index,
    });
  }

  /** Barriers are only inserted once the fight actually starts. */
  sealArena() {
    if (this._sealed) return;
    this._sealed = true;
    for (const w of this.arenaWalls) {
      this.collision.addBox(w.x, w.y, w.z, w.hx, w.hy, w.hz, 'barrier');
    }
    this.collision.bake();
  }

  /** Rats scurry in short bursts, then freeze — never leaving the cell. */
  updateRats(dt) {
    if (!this.rats) return;
    for (const r of this.rats) {
      r.turn -= dt;
      if (r.turn <= 0) {
        r.turn = 0.5 + Math.random() * 1.6;
        r.angle += (Math.random() - 0.5) * 2.4;
        r.speed = Math.random() < 0.35 ? 0 : 0.8 + Math.random() * 1.4;
      }
      // Steer back if they wander toward a wall.
      const dx = r.mesh.position.x - r.home.x;
      const dz = r.mesh.position.z - r.home.z;
      if (Math.abs(dx) > 6.5 || Math.abs(dz) > 5) {
        r.angle = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.6;
      }
      r.mesh.position.x += Math.sin(r.angle) * r.speed * dt;
      r.mesh.position.z += Math.cos(r.angle) * r.speed * dt;
      r.mesh.rotation.y = r.angle;
      // Little scampering bob while moving.
      r.mesh.position.y = r.home.y + (r.speed > 0 ? Math.abs(Math.sin(this.time * 18)) * 0.04 : 0);
    }
  }

  update(dt) {
    this.time += dt;
    for (const l of this.lanterns) {
      // Flicker rather than a smooth bob — these are open flames.
      l.mesh.position.y = l.baseY + Math.sin(this.time * 2.1 + l.phase) * 0.1;
      const f = 0.85 + Math.sin(this.time * 13 + l.phase * 3) * 0.15;
      l.mesh.scale.setScalar(f);
    }

    this._wAccum = (this._wAccum || 0) + dt;
    if (this._wAccum > 1 / 30 && this.water) {
      this._wAccum = 0;
      const pos = this.water.geometry.attributes.position;
      const base = this.waterBase;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        pos.array[i * 3 + 1] =
          Math.sin(x * 0.1 + this.time * 1.1) * 0.16 +
          Math.sin(z * 0.13 - this.time * 0.8) * 0.13;
      }
      pos.needsUpdate = true;
    }
  }
}
