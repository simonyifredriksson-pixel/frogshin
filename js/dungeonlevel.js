/**
 * The Dungeon: fifteen boss rooms in a line, joined by short corridors.
 *
 * Built on a slab far from every other space in the game, like the castle, so
 * nothing here can be seen from the arena or the story. The rooms are simple
 * on purpose — a circular floor, a wall ring and a doorway — because the
 * interest in this mode is the fifteen fights, not the architecture. What the
 * geometry *does* carry is the descent: the palette cools and darkens room by
 * room, so by the time you reach Frogath's arena the place has stopped
 * looking like stone at all.
 *
 * Layout runs along +x: room i is centred at origin.x + i * roomSpacing.
 */

import * as THREE from '../lib/three.module.js?v=v54';
import { CFG } from './config.js?v=v54';
import { mulberry32, clamp, lerp } from './util.js?v=v54';
import { Terrain, CollisionWorld } from './collision.js?v=v54';
import { lanternGlowTexture } from './world.js?v=v54';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const HALF = 120;             // terrain extent; the rooms sit far above it
const WALL_H = 22;
const DOOR_W = 9;

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

export class DungeonLevel {
  constructor(scene) {
    this.scene = scene;
    this.rnd = mulberry32(4242);
    this.time = 0;
    this.lanterns = [];
    this.glows = [];
    this.rooms = [];
    const o = CFG.dungeon.origin;
    this.origin = new THREE.Vector3(o.x, o.y, o.z);
  }

  /** Flat and far below — nothing down there is ever seen. */
  heightAt() { return -400; }

  buildTasks() {
    const D = CFG.dungeon;
    return [
      ['Cutting the shaft', () => {
        this.terrain = new Terrain(HALF * 2, 33, () => -400);
        this.collision = new CollisionWorld(this.terrain);
        const mat = () => new THREE.MeshLambertMaterial({});
        this.batches = {
          box: new Batch(new THREE.BoxGeometry(1, 1, 1), mat()),
          post: new Batch(new THREE.CylinderGeometry(1, 1, 1, 8), mat()),
          blob: new Batch(new THREE.IcosahedronGeometry(1, 0), mat()),
        };
      }],
      // Rooms are built a few at a time so the loading bar keeps moving.
      ['Opening the upper halls', () => this._buildRooms(0, 5)],
      ['Opening the deep halls', () => this._buildRooms(5, 10)],
      ['Opening the last halls', () => this._buildRooms(10, D.rooms - 1)],
      ['Uncovering the throne', () => this._buildThrone()],
      ['Sealing the dungeon', () => {
        for (const k in this.batches) {
          this.batches[k].mesh = this.batches[k].build(this.scene, k !== 'blob');
        }
        this.collision.bake();
      }],
    ];
  }

  build() { for (const [, fn] of this.buildTasks()) fn(); return this; }

  /** Centre of room `i`. */
  roomCenter(i) {
    const D = CFG.dungeon;
    return new THREE.Vector3(
      this.origin.x + i * D.roomSpacing, this.origin.y, this.origin.z);
  }

  /**
   * Palette for room `i` — a descent from warm sandstone to cold black, so
   * how deep you are is legible from the walls alone.
   */
  _palette(i) {
    const t = i / (CFG.dungeon.rooms - 1);
    const floor = _c.setHSL(
      lerp(0.09, 0.62, t), lerp(0.16, 0.30, t), lerp(0.30, 0.07, t)).getHex();
    const wall = _c.setHSL(
      lerp(0.08, 0.66, t), lerp(0.13, 0.34, t), lerp(0.22, 0.05, t)).getHex();
    const trim = _c.setHSL(
      lerp(0.10, 0.72, t), lerp(0.35, 0.55, t), lerp(0.42, 0.28, t)).getHex();
    // Torches shift from firelight to a cold spectral blue.
    const light = _c.setHSL(lerp(0.09, 0.55, t), 0.85, 0.6).getHex();
    return { floor, wall, trim, light };
  }

  _buildRooms(from, to) {
    for (let i = from; i < to; i++) this._buildRoom(i);
  }

  /** One boss room: a round floor, a wall ring, and a door at each end. */
  _buildRoom(i) {
    const D = CFG.dungeon;
    const B = this.batches;
    const rnd = this.rnd;
    const c = this.roomCenter(i);
    const R = D.roomRadius;
    const P = this._palette(i);

    // ---- floor: a disc of tiles ----
    const step = 4;
    for (let x = -R; x <= R; x += step) {
      for (let z = -R; z <= R; z += step) {
        if (Math.hypot(x + step / 2, z + step / 2) > R) continue;
        const shade = _c.setHex(P.floor).offsetHSL(0, 0, (rnd() - 0.5) * 0.06).getHex();
        B.box.add(c.x + x + step / 2, c.y - 0.16, c.z + z + step / 2,
          step + 0.05, 0.34, step + 0.05, shade);
      }
    }
    this.collision.addBox(c.x, c.y - 0.16, c.z, R + 2, 0.17, R + 2, 'stone');

    // ---- wall ring, with a doorway at each end ----
    const segs = 44;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const wx = Math.cos(a) * (R + 1.6);
      const wz = Math.sin(a) * (R + 1.6);
      // Leave the two doorways clear (a = 0 is +x, a = PI is -x).
      const nearDoor = Math.abs(wz) < DOOR_W / 2
        && (wx > 0 ? i < D.rooms - 1 : i > 0);
      if (nearDoor) continue;
      B.box.add(c.x + wx, c.y + WALL_H / 2, c.z + wz,
        5.4, WALL_H, 5.4, P.wall, a);
      this.collision.addBox(c.x + wx, c.y + WALL_H / 2, c.z + wz,
        2.9, WALL_H / 2, 2.9, 'stone');
      // Buttress detail.
      if (s % 4 === 0) {
        B.box.add(c.x + wx * 1.06, c.y + WALL_H * 0.72, c.z + wz * 1.06,
          2.0, 1.2, 2.0, P.trim, a);
      }
    }

    // ---- torches ----
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + 0.4;
      this._lantern(
        c.x + Math.cos(a) * (R - 2.5), c.y + 6.5, c.z + Math.sin(a) * (R - 2.5),
        P.light);
    }

    // ---- corridor to the next room ----
    if (i < D.rooms - 1) {
      const gap = D.roomSpacing - R * 2 - 3.2;
      const x0 = c.x + R + 1.6;
      for (let x = 0; x < gap; x += step) {
        for (let z = -DOOR_W / 2; z < DOOR_W / 2; z += step) {
          B.box.add(x0 + x + step / 2, c.y - 0.16, c.z + z + step / 2,
            step + 0.05, 0.34, step + 0.05, P.floor);
        }
      }
      this.collision.addBox(x0 + gap / 2, c.y - 0.16, c.z,
        gap / 2 + 1, 0.17, DOOR_W / 2 + 1, 'stone');
      // Corridor walls.
      for (const sz of [-1, 1]) {
        this.collision.addBox(x0 + gap / 2, c.y + 5, c.z + sz * (DOOR_W / 2 + 2),
          gap / 2 + 1, 5, 2, 'stone');
        for (let x = 0; x < gap; x += 5) {
          B.box.add(x0 + x + 2.5, c.y + 5, c.z + sz * (DOOR_W / 2 + 2),
            5.2, 10, 4, P.wall);
        }
      }
      // Lintel, so the corridor reads as a passage rather than a trench.
      for (let x = 0; x < gap; x += 5) {
        B.box.add(x0 + x + 2.5, c.y + 10.4, c.z, 5.2, 1.2, DOOR_W + 4, P.wall);
      }
      this._lantern(x0 + gap * 0.5, c.y + 7.6, c.z + DOOR_W / 2 + 0.6, P.light);
    }

    // ---- a few pillars to break up the space ----
    if (i > 2) {
      const pillars = Math.min(6, 1 + Math.floor(i / 3));
      for (let p = 0; p < pillars; p++) {
        const a = (p / pillars) * Math.PI * 2 + i;
        const px = c.x + Math.cos(a) * R * 0.6;
        const pz = c.z + Math.sin(a) * R * 0.6;
        B.post.add(px, c.y + 5.5, pz, 2.0, 11, 2.0, P.wall);
        B.post.add(px, c.y + 11.2, pz, 2.6, 0.8, 2.6, P.trim);
        this.collision.addBox(px, c.y + 5.5, pz, 1.0, 5.5, 1.0, 'stone');
      }
    }

    // ---- door barriers ----
    // Built now and left disabled. Without them you could simply sprint past
    // a live guardian and be standing in front of Frogath inside a minute,
    // which would make the whole mode skippable.
    const doors = [];
    let backDoor = null;
    let frontDoor = null;
    for (const sx of [-1, 1]) {
      if (sx < 0 && i === 0) continue;                 // no door behind room 1
      if (sx > 0 && i >= D.rooms - 1) continue;
      const b = this.collision.addBox(
        c.x + sx * (R + 1.6), c.y + WALL_H / 2, c.z,
        2.6, WALL_H / 2, DOOR_W / 2 + 1.5, 'barrier');
      b.disabled = true;
      doors.push(b);
      if (sx < 0) backDoor = b; else frontDoor = b;
    }

    // A pane of light across the exit, lit only once the guardian is down —
    // with two identical doorways, the glowing one is the answer to "which
    // way now?" without a word of UI.
    let exitGlow = null;
    if (i < D.rooms - 1) {
      exitGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(DOOR_W - 0.5, 9),
        new THREE.MeshBasicMaterial({
          color: P.light, transparent: true, opacity: 0.0,
          depthWrite: false, side: THREE.DoubleSide,
        })
      );
      exitGlow.position.set(c.x + R + 1.6, c.y + 4.2, c.z);
      exitGlow.rotation.y = Math.PI / 2;
      exitGlow.visible = false;
      this.scene.add(exitGlow);
      this.glows.push(exitGlow);
    }

    this.rooms.push({
      index: i,
      center: c,
      radius: R,
      doors,
      backDoor,
      frontDoor,
      exitGlow,
      // Where the player stands on entering, and where the boss waits.
      entry: new THREE.Vector3(c.x - R * 0.72, c.y + 0.6, c.z),
      bossSpot: new THREE.Vector3(c.x + R * 0.45, c.y + 0.6, c.z),
      // The door out, which only opens once the boss is down.
      exit: new THREE.Vector3(c.x + R + 2, c.y + 0.6, c.z),
    });
  }

  /**
   * Frogath's arena: the last room, and deliberately unlike the other
   * fourteen — no ceiling, a wide black floor, and nothing to hide behind.
   * You are meant to feel exposed the moment you walk in.
   */
  _buildThrone() {
    const D = CFG.dungeon;
    const F = D.frogath;
    const B = this.batches;
    const i = D.rooms - 1;
    const c = this.roomCenter(i);
    const R = F.arenaRadius;

    const step = 5;
    for (let x = -R; x <= R; x += step) {
      for (let z = -R; z <= R; z += step) {
        if (Math.hypot(x + step / 2, z + step / 2) > R) continue;
        B.box.add(c.x + x + step / 2, c.y - 0.16, c.z + z + step / 2,
          step + 0.06, 0.34, step + 0.06, 0x0d0b14);
      }
    }
    this.collision.addBox(c.x, c.y - 0.16, c.z, R + 2, 0.17, R + 2, 'stone');

    // A ring of broken pillars around the rim: the graves of fourteen
    // guardians, and the only cover in the room.
    const segs = 30;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const wx = Math.cos(a) * (R + 2);
      const wz = Math.sin(a) * (R + 2);
      if (Math.abs(wz) < DOOR_W / 2 && wx < 0) continue;      // the way in
      const h = 14 + (s % 5) * 5;
      B.box.add(c.x + wx, c.y + h / 2, c.z + wz, 6.5, h, 6.5, 0x14111c, a);
      this.collision.addBox(c.x + wx, c.y + h / 2, c.z + wz,
        3.4, h / 2, 3.4, 'stone');
    }

    // A gold inlay circle on the floor, under where he will descend.
    for (let s = 0; s < 64; s++) {
      const a = (s / 64) * Math.PI * 2;
      B.box.add(c.x + Math.cos(a) * 16, c.y + 0.03, c.z + Math.sin(a) * 16,
        1.7, 0.06, 1.7, 0xc9a227, a);
      B.box.add(c.x + Math.cos(a) * 30, c.y + 0.03, c.z + Math.sin(a) * 30,
        1.4, 0.06, 1.4, 0x8a6f1a, a);
    }

    // The way in seals behind you. There is no leaving this room.
    const door = this.collision.addBox(
      c.x - (R + 2), c.y + 12, c.z, 3.0, 12, DOOR_W / 2 + 2, 'barrier');
    door.disabled = true;

    this.throne = {
      center: c,
      radius: R,
      doors: [door],
      entry: new THREE.Vector3(c.x - R * 0.8, c.y + 0.6, c.z),
    };
  }

  /**
   * Seal or open a room's doorways.
   *
   * The boxes are created up front and merely switched, so the broadphase is
   * never rebuilt mid-fight — re-baking every time a door moved would be a
   * visible hitch at exactly the wrong moment.
   */
  setDoors(room, sealed) {
    const r = (room === CFG.dungeon.rooms - 1) ? this.throne : this.rooms[room];
    if (!r || !r.doors) return;
    for (const d of r.doors) d.disabled = !sealed;
  }

  /**
   * Once a guardian is down, the exit opens and the way BACK stays shut.
   *
   * Two identical doorways with only one of them correct is a bad puzzle, and
   * wandering back into a cleared room is only ever a mistake — so the room
   * behind you is closed off and the way on is lit.
   */
  openExit(room) {
    const r = this.rooms[room];
    if (!r) return;
    if (r.frontDoor) r.frontDoor.disabled = true;    // open
    if (r.backDoor) r.backDoor.disabled = false;     // stays shut
    if (r.exitGlow) { r.exitGlow.visible = true; r.exitGlow.userData.on = true; }
  }

  /** Open every door in the dungeon — used when a run resets. */
  openAllDoors() {
    for (const r of this.rooms) {
      if (r.doors) for (const d of r.doors) d.disabled = true;
      if (r.exitGlow) { r.exitGlow.visible = false; r.exitGlow.userData.on = false; }
    }
    if (this.throne && this.throne.doors) {
      for (const d of this.throne.doors) d.disabled = true;
    }
  }

  _lantern(x, y, z, color) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 5),
      new THREE.MeshBasicMaterial({ color })
    );
    m.position.set(x, y, z);
    this.scene.add(m);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lanternGlowTexture(), color, transparent: true, opacity: 0.7,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(4.2, 4.2, 1);
    m.add(halo);
    this.lanterns.push({ mesh: m, baseY: y, phase: this.rnd() * 6.28 });
  }

  update(dt) {
    this.time += dt;
    // Torches breathe, so a still room is never completely static.
    for (const l of this.lanterns) {
      const f = 0.9 + Math.sin(this.time * 3.1 + l.phase) * 0.1;
      l.mesh.scale.setScalar(f);
    }
    // An open exit pulses, so it reads as an invitation rather than a wall.
    for (const g of this.glows) {
      if (!g.visible) continue;
      g.material.opacity = 0.30 + Math.sin(this.time * 2.6) * 0.14;
    }
  }

  dispose() {
    for (const l of this.lanterns) {
      l.mesh.material.dispose();
      l.mesh.geometry.dispose();
    }
    for (const g of this.glows) {
      this.scene.remove(g);
      g.material.dispose();
      g.geometry.dispose();
    }
    this.glows.length = 0;
  }
}
