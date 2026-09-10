/**
 * THE HEAVENLY BATTLEFIELD — where the game opens, and where it will end.
 *
 * An island the size of a county, hanging above a sea of cloud, with an army
 * at either end of it. The player is at the front of one. Frogath is at the
 * front of the other. This is the last hour of a war the player is about to
 * forget, and the whole level exists to say one thing before a word of
 * dialogue is spoken: THIS IS ENORMOUS, AND YOU ARE THE ONE LEADING IT.
 *
 * ── how it is built, and why it is cheap ──────────────────────────────────
 * Everything here is either a heightfield, an InstancedMesh, or a handful of
 * big meshes. There are four hundred and thirty-two soldiers on this island
 * and they cost two draw calls, because a soldier is four instanced parts and
 * every soldier shares them. The statues are forty units tall and cost one
 * mesh each. The cloud sea is one disc and one instanced blob field.
 *
 * Measured, the whole level is about ninety draw calls — a third of what a
 * village in the Croaklands costs — which is what leaves the budget for the
 * boss, his hazards, and a camera that is allowed to look anywhere.
 *
 * ── the layout ────────────────────────────────────────────────────────────
 * The field runs along Z. The player's army is at -Z, Frogath's at +Z, and
 * the fight happens in the flat middle. The rim falls away on every side into
 * cloud, so there is no wall anywhere and no need for one: the edge of the
 * world is visible from the middle of it.
 *
 *      -Z  [ your army ]  ...  YOU  ...  <fight>  ...  FROGATH  [ his ]  +Z
 */

import * as THREE from '../lib/three.module.js?v=v103';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep,
  lookYaw } from './util.js?v=v103';
import { addFrog, FROG_SKINS } from './frogbuild.js?v=v103';
import { Terrain, CollisionWorld } from './collision.js?v=v103';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Half the island's square extent, and the heightfield resolution. */
const HALF = 300;
const GRID = 121;
/** Where the flat ground stops and the island falls away. */
const RIM = 205;
/** How far the two front lines stand apart. */
export const FIELD = 78;
/** The floor of the world. Anything below this has fallen off. */
export const VOID_Y = -220;

export const HEAVEN = {
  /** Where the player starts: front and centre of their own army. */
  playerAt: new THREE.Vector3(0, 0, -FIELD * 0.5),
  /** Where Frogath stands. */
  frogathAt: new THREE.Vector3(0, 0, FIELD * 0.5),
  fieldRadius: 96,
};

class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    this.items.push([x, y, z, sx, sy, sz, color, ry, rx, rz]);
  }
  build(scene, cast = true) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    mesh.castShadow = cast;
    mesh.receiveShadow = cast;
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
    scene.add(mesh);
    return mesh;
  }
}

/** A soft vertical gradient, for waterfalls and light shafts. */
function fallTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, top);
    grad.addColorStop(0.55, bottom);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 128);
    // Streaks, so a falling sheet of water reads as moving rather than as a
    // flat panel once it is scrolling.
    g.globalAlpha = 0.5;
    for (let i = 0; i < 22; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.5)' : 'rgba(160,210,240,0.4)';
      g.fillRect(Math.random() * 8, Math.random() * 128, 1.4, 8 + Math.random() * 26);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A round soft blob, for cloud billboards. */
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.5, 'rgba(240,248,255,0.55)');
    grad.addColorStop(1, 'rgba(230,242,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}

export class HeavenLevel {
  constructor(scene) {
    this.scene = scene;
    this.rnd = mulberry32(20260907);
    this.noise = new ValueNoise(4242);
    this.time = 0;
    this.root = new THREE.Group();
    this.root.name = 'heaven';
    scene.add(this.root);
    /** Things that move: waterfalls, banners, motes, the sky rings. */
    this.falls = [];
    this.banners = [];
    this.owned = [];              // geometries/materials this level allocated
    /** Standing positions for the two armies' front ranks. */
    this.frontYours = [];
    this.frontTheirs = [];
  }

  // ---------------------------------------------------------------- terrain

  /**
   * The island's surface.
   *
   * Flat where the fight happens, gently swelling towards the two ends where
   * the ruins and the statues stand, and then it simply stops: past the rim
   * the ground drops four hundred units into cloud. There is no lip, no
   * fence and no invisible wall — the edge is meant to be somewhere you can
   * walk to and look over, and it is where the player leaves this level.
   */
  heightAt(x, z) {
    const r = Math.hypot(x, z);
    // The fighting floor: dead flat, so no attack telegraph is ever drawn on
    // a slope the player cannot read.
    if (r < HEAVEN.fieldRadius) {
      return this.noise.fbm(x * 0.02, z * 0.02, 2) * 0.35;
    }
    // Beyond it the island rises into terraces, and its edge is ragged.
    const t = clamp((r - HEAVEN.fieldRadius) / (RIM - HEAVEN.fieldRadius), 0, 1);
    let h = smoothstep(t) * 16
      + this.noise.fbm(x * 0.012, z * 0.012, 3) * 7.5 * t;
    // Two broad staircases up to the ruins at either end, so the terraces
    // are approachable rather than a wall.
    if (Math.abs(x) < 26) h = lerp(h, Math.round(h / 2.2) * 2.2, 0.85);
    // And then the world ends.
    const ragged = RIM + this.noise.fbm(x * 0.03, z * 0.03, 2) * 22;
    if (r > ragged) {
      const over = (r - ragged) / 40;
      h -= smoothstep(clamp(over, 0, 1)) * 420;
    }
    return h;
  }

  buildTasks() {
    return [
      ['Weighing the anchor of heaven', () => {
        this.terrain = new Terrain(HALF * 2, GRID, (x, z) => this.heightAt(x, z));
        this.collision = new CollisionWorld(this.terrain);
        const lam = (o) => {
          const m = new THREE.MeshLambertMaterial(o || {});
          this.owned.push(m);
          return m;
        };
        this.mats = {
          marble: lam({ color: 0xffffff }),
          gold: lam({ color: 0xffffff }),
          cloth: lam({ color: 0xffffff }),
          rock: lam({ color: 0xffffff }),
        };
        this.batches = {
          block: new Batch(new THREE.BoxGeometry(1, 1, 1), this.mats.marble),
          drum: new Batch(new THREE.CylinderGeometry(1, 1, 1, 9), this.mats.marble),
          shard: new Batch(new THREE.IcosahedronGeometry(1, 0), this.mats.rock),
          spike: new Batch(new THREE.ConeGeometry(1, 1, 6, 1), this.mats.rock),
          orb: new Batch(new THREE.SphereGeometry(1, 7, 5), this.mats.gold),
        };
        /**
         * FOUR SHAPES, FOUR HUNDRED AND THIRTY-TWO FROGS.
         *
         * Every part of every soldier in both armies is one of these, which
         * is what keeps the whole muster at four draw calls. `body` is a
         * squat ellipsoid rather than a cylinder — a frog is wider than it
         * is tall and the silhouette has to say so at fifty units.
         */
        /**
         * THE FOUR SHAPES EVERY FROG IN THE GAME IS MADE OF.
         *
         * `addFrog` in js/frogbuild.js expects exactly this contract —
         * box, blob, rod, cone — so the armies here, the congregation in
         * the coronation hall and the crowds in the flashbacks are all
         * built by one function into four instanced meshes.
         *
         * Six-by-four spheres and five-sided cylinders: at forty parts per
         * frog and four hundred and thirty-two frogs, every segment counts.
         */
        this.soldierBatches = {
          box: new Batch(new THREE.BoxGeometry(1, 1, 1), this.mats.cloth),
          blob: new Batch(new THREE.SphereGeometry(1, 6, 4), this.mats.cloth),
          rod: new Batch(new THREE.CylinderGeometry(1, 1, 1, 5), this.mats.cloth),
          cone: new Batch(new THREE.ConeGeometry(1, 1, 5), this.mats.cloth),
        };
      }],
      ['Laying the floor of the sky', () => this._ground()],
      ['Hanging the island', () => this._underside()],
      ['Setting the cloud sea', () => this._clouds()],
      ['Raising the far mountains', () => this._mountains()],
      ['Pouring the falls', () => this._waterfalls()],
      ['Building what was here before', () => this._ruins()],
      ['Waking the colossi', () => this._statues()],
      ['Sowing the lightwood', () => this._plants()],
      ['Loosing the rocks', () => this._floaters()],
      ['Opening the sky', () => this._skyRings()],
      ['Mustering your army', () => this._army(-1)],
      ['Mustering his', () => this._army(1)],
      ['Calling the muster', () => {
        for (const k in this.batches) {
          this.batches[k].mesh = this.batches[k].build(this.root, true);
        }
        for (const k in this.soldierBatches) {
          this.soldierBatches[k].mesh
            = this.soldierBatches[k].build(this.root, true);
        }
        this.collision.bake();
      }],
    ];
  }

  build() { for (const [, fn] of this.buildTasks()) fn(); return this; }

  /** A collider, in world space. */
  _solid(x, y, z, hx, hy, hz, tag) {
    this.collision.addBox(x, y, z, hx, hy, hz, tag);
  }

  _add(geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    this.owned.push(geo);
    return m;
  }

  // ------------------------------------------------------------ the surface

  /**
   * The island's top, vertex-coloured.
   *
   * Pale marble in the middle where the fight is, warming to gold at the
   * terraces and going blue-white at the very rim where the cloud spills
   * over it. Vertex colours rather than a texture: it is one material, it
   * costs nothing, and the gradient does most of the work of making a flat
   * plane look like a holy place.
   */
  _ground() {
    const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, GRID - 1, GRID - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const near = new THREE.Color(0xf2ecdc);
    const mid = new THREE.Color(0xd8c79a);
    const edge = new THREE.Color(0xa9c4dc);
    const veins = new THREE.Color(0xffd76b);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const r = Math.hypot(x, z) / RIM;
      _c.copy(near).lerp(mid, clamp(r * 1.25, 0, 1));
      if (r > 0.86) _c.lerp(edge, clamp((r - 0.86) / 0.3, 0, 1));
      // Gold veins running out of the middle, like the light under the
      // country is leaking up through the stone.
      const vein = this.noise.fbm(x * 0.05, z * 0.05, 2);
      if (vein > 0.42) _c.lerp(veins, (vein - 0.42) * 1.6);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.owned.push(mat);
    const m = this._add(geo, mat, 0, 0, 0);
    m.castShadow = false;
    this.ground = m;
  }

  /**
   * WHAT THE ISLAND IS SITTING ON: nothing.
   *
   * A ring of long inverted spikes under the rim, going down into the cloud.
   * It is the single most important thing in the level for selling the
   * height, because it is the only part that answers "how far down does this
   * go?" — and the answer has to be "further than you can see".
   */
  _underside() {
    const R = this.rnd;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + R() * 0.1;
      const rad = RIM * (0.5 + R() * 0.5);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const len = 40 + R() * 150;
      const wide = 12 + R() * 34;
      this.batches.spike.add(x, -len * 0.42, z, wide, len, wide,
        0x6d6a63, R() * 3, Math.PI, 0);
    }
    // A thick slab just under the surface, so the rim has an edge you can see
    // from below when the camera drops over it during the fall.
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const x = Math.cos(a) * RIM * 0.72, z = Math.sin(a) * RIM * 0.72;
      this.batches.shard.add(x, -14 - R() * 10, z,
        60 + R() * 40, 16 + R() * 14, 60 + R() * 40, 0x8b8578, R() * 3);
    }
  }

  /**
   * THE CLOUD SEA, far below.
   *
   * One enormous soft disc for the floor of it and a field of billboarded
   * puffs standing above that, at four depths. The depths matter: a single
   * layer reads as a painted backdrop, and four reads as weather.
   */
  _clouds() {
    const R = this.rnd;
    const tex = puffTexture();
    this.owned.push(tex);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0xdfeaf6, transparent: true, opacity: 0.92, depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.owned.push(floorMat);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2200, 40), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -300;
    floor.renderOrder = -6;
    this.root.add(floor);
    this.owned.push(floor.geometry);

    const puffMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.62, depthWrite: false,
    });
    this.owned.push(puffMat);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(geo);
    const puffs = new THREE.InstancedMesh(geo, puffMat, 240);
    puffs.frustumCulled = false;
    puffs.renderOrder = -5;
    for (let i = 0; i < 240; i++) {
      const layer = i % 4;
      const a = R() * Math.PI * 2;
      const rad = 180 + R() * 1500;
      const size = 120 + R() * 420;
      _v.set(Math.cos(a) * rad, -60 - layer * 62 - R() * 40, Math.sin(a) * rad);
      _q.identity();
      _s.set(size, size * (0.4 + R() * 0.3), 1);
      _m.compose(_v, _q, _s);
      puffs.setMatrixAt(i, _m);
    }
    puffs.instanceMatrix.needsUpdate = true;
    this.root.add(puffs);
    this.cloudField = puffs;

    // And a high veil of the same stuff, so the sky has something in it.
    const veil = new THREE.InstancedMesh(geo, puffMat, 60);
    veil.frustumCulled = false;
    veil.renderOrder = -4;
    for (let i = 0; i < 60; i++) {
      const a = R() * Math.PI * 2;
      const rad = 400 + R() * 1400;
      const size = 200 + R() * 500;
      _v.set(Math.cos(a) * rad, 140 + R() * 260, Math.sin(a) * rad);
      _s.set(size, size * 0.35, 1);
      _m.compose(_v, _q.identity(), _s);
      veil.setMatrixAt(i, _m);
    }
    veil.instanceMatrix.needsUpdate = true;
    this.root.add(veil);
    this.cloudVeil = veil;
  }

  /** Mountains on the horizon, enormous and a very long way off. */
  _mountains() {
    const R = this.rnd;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9fb6cc, transparent: true, opacity: 0.5, depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.owned.push(mat);
    const g = new THREE.Group();
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + R() * 0.12;
      const rad = 1500 + R() * 500;
      const h = 320 + R() * 620;
      const geo = new THREE.ConeGeometry(h * (0.5 + R() * 0.5), h, 5, 1);
      this.owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * rad, -160 + h * 0.5, Math.sin(a) * rad);
      m.renderOrder = -7;
      g.add(m);
    }
    this.root.add(g);
  }

  /**
   * WATERFALLS OFF THE EDGE.
   *
   * Six of them, and they never land: the water leaves the island, falls two
   * hundred units and is gone into the cloud. The texture scrolls, so they
   * move; the mist at the lip is a handful of puffs.
   */
  _waterfalls() {
    const R = this.rnd;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const rad = RIM * 0.96;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const y = this.heightAt(x, z);
      const tex = fallTexture('rgba(226,244,255,0.95)', 'rgba(150,196,232,0.7)');
      tex.repeat.set(1, 6);
      this.owned.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.8, depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.owned.push(mat);
      const w = 16 + R() * 22;
      const len = 240;
      const geo = new THREE.PlaneGeometry(w, len);
      this.owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y - len * 0.45, z);
      m.rotation.y = -a + Math.PI / 2;
      this.root.add(m);
      this.falls.push({ tex, speed: 0.9 + R() * 0.5 });
      // The pool it leaves from, and the mist coming back up off the lip.
      const pool = new THREE.Mesh(new THREE.CircleGeometry(w * 0.85, 14),
        new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true,
          opacity: 0.72 }));
      this.owned.push(pool.geometry, pool.material);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x - Math.cos(a) * w * 0.5, y + 0.25,
        z - Math.sin(a) * w * 0.5);
      this.root.add(pool);
      for (let k = 0; k < 4; k++) {
        this.batches.orb.add(x + (R() - 0.5) * w, y - 2 - k * 5,
          z + (R() - 0.5) * w, 7 + R() * 6, 5, 7 + R() * 6, 0xeaf6ff);
      }
    }
  }

  /**
   * ANCIENT RUINS.
   *
   * Colonnades down both long sides of the field and a broken arch behind
   * each army. Their job is to frame the shot: whatever the camera does
   * during the opening, there is architecture on both sides of it, and the
   * player is looking down an avenue rather than standing in a field.
   */
  _ruins() {
    const R = this.rnd;
    const B = this.batches;
    // The avenue: two rows of columns running the length of the field.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 11; i++) {
        const z = -150 + i * 30;
        const x = side * 62;
        const y = this.heightAt(x, z);
        // Every third column is broken off short. A colonnade with all its
        // columns intact reads as new.
        const tall = (i % 3 === 1) ? 5 + R() * 4 : 15 + R() * 4;
        B.drum.add(x, y + tall * 0.5, z, 2.6, tall, 2.6, 0xf2ecdc);
        B.block.add(x, y + 0.6, z, 7, 1.2, 7, 0xd8c79a);
        this._solid(x, y + 4, z, 2.6, 4, 2.6, 'column');
        if (tall > 12) {
          B.block.add(x, y + tall + 0.9, z, 7.4, 1.8, 7.4, 0xf2ecdc);
          // A stretch of architrave, where it has not come down.
          if (i % 3 !== 2 && i < 10) {
            B.block.add(x, y + tall + 2.6, z + 15, 4.4, 2.2, 30, 0xe8dcc0);
          }
        } else {
          // The drum that fell off it, lying where it landed.
          B.drum.add(x + side * (3 + R() * 4), y + 1.4, z + (R() - 0.5) * 6,
            2.6, 5, 2.6, 0xd8c79a, 0, Math.PI / 2, R());
        }
      }
    }
    // A great arch behind each army, and the stair up to it.
    for (const side of [-1, 1]) {
      const z = side * 150;
      const y = this.heightAt(0, z);
      for (const sx of [-1, 1]) {
        B.block.add(sx * 22, y + 15, z, 9, 30, 11, 0xf2ecdc);
        this._solid(sx * 22, y + 15, z, 4.5, 15, 5.5, 'pier');
      }
      B.block.add(0, y + 32, z, 62, 5, 12, 0xe8dcc0);
      B.block.add(0, y + 36.5, z, 52, 4, 9, 0xd8c79a);
      // The frog-eye keystone. Everybody in the country knows the mark.
      B.orb.add(0, y + 36.5, z - side * 5, 3.4, 2.2, 1.4, 0xffd76b);
      for (let s = 0; s < 6; s++) {
        B.block.add(0, y - 1 - s * 2.2, z - side * (8 + s * 4),
          70 - s * 4, 2.4, 4.4, 0xe8dcc0);
      }
    }
    // Broken walls out on the terraces, so the edges are not empty.
    for (let i = 0; i < 34; i++) {
      const a = R() * Math.PI * 2;
      const rad = HEAVEN.fieldRadius + 20 + R() * (RIM - HEAVEN.fieldRadius - 40);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const y = this.heightAt(x, z);
      if (y < -20) continue;
      const w = 6 + R() * 16, h = 3 + R() * 12;
      B.block.add(x, y + h * 0.5, z, w, h, 2.6, 0xe0d6c0, a);
      this._solid(x, y + h * 0.5, z, w * 0.5, h * 0.5, 1.3, 'wall');
    }
  }

  /**
   * THE COLOSSI.
   *
   * Four seated figures, forty units tall, two behind each army, looking in
   * at the field. Whatever else happens in this level, something enormous is
   * always watching — and when the player fights Frogath again at the end of
   * the game, these are the shapes they will recognise before anything else.
   */
  _statues() {
    const B = this.batches;
    const spots = [
      [-104, 118], [104, 118], [-104, -118], [104, -118],
    ];
    for (const [x, z] of spots) {
      const y = this.heightAt(x, z);
      const face = Math.atan2(-x, -z);
      // Throne.
      B.block.add(x, y + 6, z, 34, 12, 30, 0xcabfa2, face);
      B.block.add(x, y + 22, z + Math.cos(face) * -13, 34, 20, 5, 0xc0b596, face);
      this._solid(x, y + 12, z, 17, 12, 15, 'statue');
      // Legs, folded.
      for (const sx of [-1, 1]) {
        B.drum.add(x + sx * 9, y + 14, z + 12, 5, 16, 5, 0xd8ccae, 0, Math.PI / 2, 0);
        B.orb.add(x + sx * 9, y + 13, z + 20, 6, 4, 8, 0xd8ccae);
      }
      // Body and the great arms resting on the knees.
      B.orb.add(x, y + 24, z + 2, 13, 12, 11, 0xe0d6b8);
      for (const sx of [-1, 1]) {
        B.drum.add(x + sx * 13, y + 22, z + 9, 3.6, 20, 3.6, 0xd8ccae, 0, 0.9, 0);
      }
      // The head: wide, low, with the eye-ridges every frog in this game has.
      B.orb.add(x, y + 38, z + 1, 9, 8, 9, 0xe8dec4);
      for (const sx of [-1, 1]) {
        B.orb.add(x + sx * 5, y + 43, z + 2, 3.6, 3.2, 3.6, 0xf2ecdc);
        B.orb.add(x + sx * 5, y + 43.6, z + 4.6, 1.5, 1.5, 1.5, 0xffd76b);
      }
      // A crown of light. These were gods before Frogath called himself one.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        B.spike.add(x + Math.cos(a) * 7, y + 49, z + 1 + Math.sin(a) * 7,
          1.1, 5, 1.1, 0xffd76b);
      }
      // A long soft shaft of sun leaning off each one. Deliberately faint:
      // a bright additive column in front of the camera is what made an
      // earlier version of this game unplayable.
      const tex = fallTexture('rgba(255,232,170,0.5)', 'rgba(255,214,120,0.12)');
      this.owned.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.1, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.owned.push(mat);
      const geo = new THREE.PlaneGeometry(30, 120);
      this.owned.push(geo);
      const shaft = new THREE.Mesh(geo, mat);
      shaft.position.set(x, y + 70, z);
      shaft.rotation.set(0.25, face, 0.2);
      shaft.renderOrder = 4;
      this.root.add(shaft);
    }
  }

  /** Glowing plants — the lightwood. Instanced stalks with a bulb on top. */
  _plants() {
    const R = this.rnd;
    const B = this.batches;
    for (let i = 0; i < 220; i++) {
      const a = R() * Math.PI * 2;
      const rad = 30 + R() * (RIM - 50);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const y = this.heightAt(x, z);
      if (y < -10) continue;
      // Not on the fighting floor: nothing is allowed to clutter the arena.
      if (Math.hypot(x, z) < HEAVEN.fieldRadius * 0.75) continue;
      const h = 1.2 + R() * 3.4;
      B.drum.add(x, y + h * 0.5, z, 0.13, h, 0.13, 0x4f6f3a);
      B.orb.add(x, y + h + 0.3, z, 0.42 + R() * 0.4, 0.5, 0.42,
        R() < 0.4 ? 0x8fe8ff : 0xcfffa8);
    }
  }

  /**
   * FLOATING ROCK FORMATIONS.
   *
   * Off the sides and above, drifting. They are the thing that makes the sky
   * feel occupied, and the slow drift on them is what stops the whole level
   * reading as a diorama.
   */
  _floaters() {
    const R = this.rnd;
    const mat = new THREE.MeshLambertMaterial({ color: 0x8f8b80 });
    this.owned.push(mat);
    const g = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2;
      const rad = 280 + R() * 620;
      const y = -40 + R() * 200;
      const size = 18 + R() * 62;
      const geo = new THREE.IcosahedronGeometry(size, 0);
      this.owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      m.scale.set(1, 0.45 + R() * 0.4, 1);
      m.rotation.set(R(), R() * 6, R());
      m.castShadow = false;
      g.add(m);
      // A cap of green on the bigger ones, and a fall off one in three.
      if (size > 40) {
        const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 0.92, 0),
          new THREE.MeshLambertMaterial({ color: 0x4f7a38 }));
        this.owned.push(cap.geometry, cap.material);
        cap.position.copy(m.position);
        cap.position.y += size * 0.24;
        cap.scale.set(1, 0.16, 1);
        cap.rotation.copy(m.rotation);
        g.add(cap);
      }
    }
    this.root.add(g);
    this.floaters = g;
  }

  /** Rings of magic in the sky, very slowly turning. */
  _skyRings() {
    const R = this.rnd;
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const rad = 240 + i * 130;
      const geo = new THREE.TorusGeometry(rad, 1.6 + i * 0.6, 3, 64);
      this.owned.push(geo);
      const mat = new THREE.MeshBasicMaterial({
        color: i === 1 ? 0xbfe3ff : 0xffd76b, transparent: true,
        opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.owned.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 150 + i * 70;
      m.rotation.set(Math.PI / 2 + (R() - 0.5) * 0.5, R(), 0);
      m.renderOrder = 3;
      this.root.add(m);
      this.rings.push({ mesh: m, rate: 0.02 + i * 0.01 });
    }
  }

  // ------------------------------------------------------------- the armies

  /**
   * ONE ARMY, IN FORMATION.
   *
   * @param side -1 for the player's, +1 for Frogath's
   *
   * Sixteen files by thirteen ranks, plus a command row at the front and
   * banners every fourth file. Two hundred and sixteen frogs a side, and the
   * whole thing is four instanced parts.
   *
   * Two details do all the work of making it read as an ARMY rather than as
   * a grid. First, the ranks are jittered — a perfect lattice reads as
   * wallpaper. Second, the spears are jittered in ANGLE, because a forest of
   * spears at slightly different angles is the single most army-looking thing
   * there is.
   */
  /**
   * ONE SOLDIER, AND IT IS A FROG IN PLATE.
   *
   * The first version of this was a cylinder with a ball on top, which at
   * four hundred copies read as a crowd of chess pieces. The second had the
   * right parts in roughly the right places and STILL read as blobs,
   * because the proportions were wrong: a body taller than it is wide is a
   * barrel standing on end, whatever you glue to it.
   *
   * So it is `addFrog` now — one builder shared by every crowd in the game,
   * with the four things that actually make a frog read as a frog (see
   * js/frogbuild.js) — and the armies are in KNIGHT ARMOUR. The Croaklands
   * went to war; its soldiers are frogs in plate carrying spears and
   * shields, and the only ninja on either field is the player.
   *
   * About forty instanced parts each. At four hundred and thirty-two frogs
   * that is still four draw calls, because every part is one of the same
   * four shared geometries — see `soldierBatches` in the build tasks.
   */
  _frog(x, y, z, sc, face, skin, cloth, metal, trim, rank) {
    addFrog(this.soldierBatches, {
      x, y, z, s: sc * 1.02, face,
      skin, cloth, metal, trim,
      /**
       * Captains get a crest, a cape and a drawn sword; the ranks behind
       * them get a kettle helm and a spear. That difference is what makes a
       * front line read as a front line rather than as a texture.
       */
      outfit: rank === 'captain' ? 'captain' : 'spearman',
      plume: rank === 'captain' ? trim : cloth,
      capeColour: cloth,
      // Only the front rank is ever close enough to need toes and fingers.
      detail: rank === 'captain' ? 'full' : 'crowd',
      armPose: rank === 'captain' ? 'reach' : 'hold',
    });
  }

  _army(side) {
    const R = this.rnd;
    const S = this.soldierBatches;
    const B = this.batches;
    const yours = side < 0;
    const cloth = yours ? 0x3a6a8a : 0x241c22;
    const trim = yours ? 0xbfe3ff : 0x8a2f28;
    /**
     * WHAT THE TWO ARMIES ARE MADE OF.
     *
     * Yours are frogs of every colour the country comes in — it is a levy
     * from seven kingdoms and it should look like one. His are a uniform
     * dark green, because that is what a standing army under one banner
     * looks like, and the difference reads across the field.
     */
    const metal = yours ? 0x9aa4b2 : 0x4a4f58;
    const front = yours ? this.frontYours : this.frontTheirs;

    const files = 16, ranks = 13;
    const gap = 4.6, depth = 5.0;
    const z0 = side * (FIELD * 0.5 + 16);
    for (let r = 0; r < ranks; r++) {
      for (let f = 0; f < files; f++) {
        // The formation curves back at the wings, so it wraps round the
        // field rather than cutting across it in a straight line.
        const off = (f - (files - 1) / 2);
        const x = off * gap + (R() - 0.5) * 1.1;
        const bow = Math.abs(off) * Math.abs(off) * 0.13;
        const z = z0 + side * (r * depth + bow) + (R() - 0.5) * 1.2;
        const y = this.heightAt(x, z);
        if (y < -8) continue;
        /**
         * FACING THE OTHER ARMY.
         *
         * `lookYaw` is the rule everywhere in this game: a model's forward is
         * (-sin y, 0, -cos y), so a frog at -Z looking at +Z wants yaw π, not
         * yaw zero. Getting this backwards is what had both armies — and both
         * leaders — standing back to back at the start of the game.
         */
        const face = lookYaw(x, z, x, -side * 200);
        const scale = 0.92 + R() * 0.2;
        // Captains in the front rank: bigger, caped, and no spear — a sword.
        const boss = r === 0 && (f === 3 || f === 12);
        const sc = boss ? scale * 1.28 : scale;
        const skin = yours
          ? FROG_SKINS[Math.floor(R() * FROG_SKINS.length)]
          : 0x4f6f3a;
        this._frog(x, y, z, sc, face, skin, cloth, metal, trim,
          boss ? 'captain' : 'spear');
        if (r === 0) front.push({ x, z });
        // The front two ranks are solid, so the player cannot walk into the
        // army — and the rest are not, because nothing will ever reach them.
        if (r < 2) this._solid(x, y + 1, z, 0.7, 1.1, 0.7, 'soldier');
      }
    }

    // BANNERS. Tall, and they move — see `update`.
    for (let f = 0; f < files; f += 4) {
      const off = (f - (files - 1) / 2);
      const x = off * gap + 2.2;
      const z = z0 + side * (2.4 + Math.abs(off) * Math.abs(off) * 0.13);
      const y = this.heightAt(x, z);
      if (y < -8) continue;
      B.drum.add(x, y + 9, z, 0.2, 18, 0.2, 0x452e19);
      const geo = new THREE.PlaneGeometry(4.6, 9);
      this.owned.push(geo);
      const mat = new THREE.MeshLambertMaterial({
        color: yours ? 0x2f6f8a : 0x2a1418, side: THREE.DoubleSide,
      });
      this.owned.push(mat);
      const flag = new THREE.Mesh(geo, mat);
      flag.position.set(x + 2.4, y + 12.5, z);
      flag.castShadow = false;
      this.root.add(flag);
      // A mark on it. A pale eye for Frogath; a broken circle for the
      // rebellion, because that is what they think of his eye.
      const markGeo = new THREE.PlaneGeometry(2.4, 2.4);
      this.owned.push(markGeo);
      const markMat = new THREE.MeshBasicMaterial({
        color: yours ? 0xbfe3ff : 0xeef4ff, transparent: true, opacity: 0.9,
        side: THREE.DoubleSide,
      });
      this.owned.push(markMat);
      const mark = new THREE.Mesh(markGeo, markMat);
      mark.position.set(x + 2.4, y + 12.5, z + 0.06);
      this.root.add(mark);
      B.spike.add(x, y + 18.6, z, 0.4, 1.6, 0.4, yours ? 0xbfe3ff : 0x8a2f28);
      this.banners.push({ flag, mark, base: y + 12.5, phase: this.rnd() * 6 });
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt) {
    this.time += dt;
    for (const f of this.falls) f.tex.offset.y -= f.speed * dt;
    for (const r of this.rings) r.mesh.rotation.z += r.rate * dt;
    if (this.floaters) this.floaters.rotation.y += 0.006 * dt;
    // The banners snap in the wind: a small yaw wobble plus a lift, which at
    // this distance reads as cloth and costs two sines.
    for (const b of this.banners) {
      const w = Math.sin(this.time * 1.7 + b.phase);
      b.flag.rotation.y = w * 0.28;
      b.flag.position.y = b.base + Math.sin(this.time * 2.3 + b.phase) * 0.22;
      b.mark.rotation.y = b.flag.rotation.y;
      b.mark.position.y = b.flag.position.y;
      b.mark.position.x = b.flag.position.x + Math.sin(b.flag.rotation.y) * 0.06;
    }
    // The cloud sea drifts, very slowly, in the opposite direction to the
    // rocks — which is the cheapest possible parallax and sells the height.
    if (this.cloudField) this.cloudField.rotation.y -= 0.004 * dt;
    if (this.cloudVeil) this.cloudVeil.rotation.y += 0.009 * dt;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const o of this.owned) {
      if (o && o.dispose) { try { o.dispose(); } catch (e) { /* gone */ } }
    }
    this.owned.length = 0;
    this.falls.length = 0;
    this.banners.length = 0;
  }
}
