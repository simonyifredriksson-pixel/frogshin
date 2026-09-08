/**
 * WHAT A MEMORY LOOKS LIKE.
 *
 * A flashback used to be a white screen with words on it. That is a
 * subtitle, not a memory — the player was told they saw a hall full of
 * kneeling frogs and had to take it on trust. So every flashback now cuts
 * to an ACTUAL SCENE: built geometry, a camera move across it, and the
 * dialogue over the top.
 *
 * ── where they are ───────────────────────────────────────────────────────
 * Fifteen hundred metres straight up, inside a closed dome. Not a separate
 * three.js scene, because the renderer, the camera and the whole update
 * loop belong to whichever mode is running and swapping scenes mid-frame
 * would mean threading a second renderer path through five files. A tableau
 * a mile above the Croaklands is invisible from the ground, sees nothing of
 * the world, and needs no plumbing at all: the camera simply goes there.
 *
 * Two details make that work:
 *   - every material is `fog: false`, so the region's fog cannot grey out
 *     a scene that is nominally a mile above the fog, and
 *   - each tableau sits inside a `BackSide` dome, so the sky sphere, the
 *     sun and the clouds are all hidden and the memory has its own light.
 *
 * ── six tableaux, fifteen memories ───────────────────────────────────────
 * They are shared. "You remember standing in front of your army" and "you
 * remember giving the order at the ford" are the same picture with different
 * words over it, and building fifteen scenes for fifteen memories would be
 * fifteen times the geometry for no gain the player can see.
 *
 *   hall     the throne room, a crowd on one knee, a crown
 *   ranks    an army in formation in a field, seen from the front
 *   pair     two frogs side by side on a step — you, and him, before
 *   island   the heavenly battlefield, small and far off, two armies
 *   statue   a carved figure with your own mark on its breast
 *   relic    a sword on a stone, and hands that know it
 *
 * ── and they are built on demand ─────────────────────────────────────────
 * A tableau is made the first time a memory that uses it fires, and then
 * kept. Most players will see three or four in a session; building all six
 * up front would be geometry nobody looks at.
 */

import * as THREE from '../lib/three.module.js?v=v91';
import { mulberry32, lerp, smoothstep, clamp } from './util.js?v=v91';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _look = new THREE.Vector3();

/** How far above the world the memories are staged. */
const UP = 1500;

/**
 * THE SHOTS, per tableau.
 *
 * `from` and `to` are camera positions in the tableau's own local space and
 * `at`/`atTo` what it looks at, all interpolated with a smoothstep. The
 * dialogue advances independently — the camera keeps moving while the player
 * reads, and cuts to the next shot when a line calls for it.
 *
 * Written as data for the same reason the prologue's are: a camera move is
 * the thing you tune twenty times.
 */
const SHOTS = {
  hall: [
    // Down the length of the hall, over the heads of the crowd.
    { from: [0, 9, -78], to: [0, 6, -34], at: [0, 7, 8], dur: 7 },
    // The crowd going down on one knee, from the side.
    { from: [-40, 5, -20], to: [-26, 3.4, -10], at: [-6, 2, -14], dur: 6 },
    // And the throne, and what is sitting on it.
    { from: [0, 5.5, -20], to: [0, 5, -13], at: [0, 6.4, 4], dur: 7 },
  ],
  ranks: [
    // Along the front rank at head height.
    { from: [-52, 3.2, -26], to: [46, 3.2, -26], at: [-20, 3, 6], atTo: [24, 3, 6], dur: 8 },
    // From behind the army, over them, at whoever they are facing.
    { from: [0, 26, 66], to: [0, 9, 26], at: [0, 6, -14], dur: 7 },
    // Low, in front of them, looking back at the wall of faces.
    { from: [0, 2.2, -22], to: [0, 3.4, -13], at: [0, 4, 10], dur: 6 },
  ],
  pair: [
    // Two figures on a step, side on, close.
    { from: [16, 3.4, -13], to: [10, 3, -8], at: [0, 3.2, 0], dur: 7 },
    // Push in on the one with no crown.
    { from: [4, 3.2, -11], to: [2.6, 3.1, -6.5], at: [2.2, 3.4, 0], dur: 7 },
  ],
  island: [
    // The whole island, from off the edge of it, tiny.
    { from: [-150, 62, -150], to: [-96, 40, -96], at: [0, 6, 0], dur: 8 },
    // The gap between the two armies.
    { from: [0, 16, -70], to: [0, 9, -34], at: [0, 5, 30], dur: 7 },
  ],
  statue: [
    // Up at it, from its feet.
    { from: [0, 1.6, -22], to: [0, 3.4, -13], at: [0, 13, 0], dur: 7 },
    // And the mark on its breast, close.
    { from: [0, 9, -12], to: [0, 8.6, -6.5], at: [0, 8.4, 0], dur: 6 },
  ],
  relic: [
    // A sword on a stone, from above, coming down to it.
    { from: [0, 11, -9], to: [0, 2.6, -4], at: [0, 1.4, 0], dur: 7 },
  ],
};

/** Which tableau each memory is staged in. */
export const STAGE = {
  crown: 'hall', oath: 'hall', name: 'hall',
  ranks: 'ranks', field: 'ranks',
  ally: 'pair', throne: 'pair', corrupt: 'pair',
  island: 'island', won: 'island', fell: 'island',
  statue: 'statue', capital: 'statue',
  blade: 'relic', bridge: 'relic',
};

/** One instanced batch, exactly as the level builders use. */
class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    this.items.push([x, y, z, sx, sy, sz, color, ry, rx, rz]);
  }
  build(parent) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
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
    return mesh;
  }
}

export class MemoryScene {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'memories';
    this.root.visible = false;
    scene.add(this.root);
    this.stages = new Map();
    this.owned = [];
    /** The tableau currently on screen, and how far into its shots we are. */
    this.live = null;
    this.shot = 0;
    this.shotT = 0;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.rnd = mulberry32(0x11e11);
    /**
     * A light of its own.
     *
     * The world's sun is somewhere else entirely and a memory inside a
     * closed dome would be pitch black without this. Parented to the root
     * so it goes away with everything else.
     */
    this.lamp = new THREE.DirectionalLight(0xfff0d0, 1.15);
    this.lamp.position.set(-30, 60, -50);
    this.root.add(this.lamp);
    this.fill = new THREE.HemisphereLight(0xdfe8f8, 0x40403a, 0.85);
    this.root.add(this.fill);
  }

  /** A material that ignores the world's fog. Everything here uses one. */
  _mat(color, opts) {
    const m = new THREE.MeshLambertMaterial(
      Object.assign({ color, fog: false }, opts || {}));
    this.owned.push(m);
    return m;
  }

  _basic(color, opts) {
    const m = new THREE.MeshBasicMaterial(
      Object.assign({ color, fog: false }, opts || {}));
    this.owned.push(m);
    return m;
  }

  _geo(g) { this.owned.push(g); return g; }

  /**
   * A FROG, in about a dozen boxes and spheres.
   *
   * The same anatomy the armies on the heavenly battlefield use — wide low
   * body, head forward of the shoulders, eye-humps, folded hind legs — but
   * built into whichever batches the tableau is using, so a hall of two
   * hundred of them is still four draw calls.
   *
   * @param kneel 0 standing, 1 down on one knee
   */
  _frog(B, x, y, z, sc, face, skin, cloth, kneel = 0, crown = false) {
    const fx = -Math.sin(face), fz = -Math.cos(face);
    const rx = Math.cos(face), rz = -Math.sin(face);
    const drop = kneel * 0.34 * sc;
    // Body.
    B.blob.add(x, y + (0.72 - kneel * 0.24) * sc, z,
      1.16 * sc, 1.28 * sc, 1.04 * sc, cloth, face);
    // Head, forward and up.
    const hy = y + (1.5 - kneel * 0.5) * sc;
    B.blob.add(x + fx * 0.16 * sc, hy, z + fz * 0.16 * sc,
      0.62 * sc, 0.44 * sc, 0.66 * sc, skin, face);
    for (const sd of [-1, 1]) {
      B.blob.add(x + rx * sd * 0.34 * sc, hy + 0.3 * sc, z + rz * sd * 0.34 * sc,
        0.26 * sc, 0.24 * sc, 0.26 * sc, skin, face);
      B.blob.add(x + rx * sd * 0.34 * sc + fx * 0.2 * sc, hy + 0.32 * sc,
        z + rz * sd * 0.34 * sc + fz * 0.2 * sc,
        0.12 * sc, 0.12 * sc, 0.1 * sc, 0x1a1a14, face);
    }
    // Legs — one knee down if kneeling, both folded if not.
    for (const sd of [-1, 1]) {
      const down = kneel && sd < 0;
      B.box.add(x + rx * sd * 0.5 * sc, y + (down ? 0.16 : 0.62 - kneel * 0.2) * sc,
        z + rz * sd * 0.5 * sc,
        0.34 * sc, (down ? 0.24 : 0.74) * sc, (down ? 0.9 : 0.44) * sc,
        skin, face, 0, sd * 0.36 * (1 - kneel));
    }
    // Shoulders.
    B.box.add(x, y + (1.06 - kneel * 0.4) * sc, z,
      1.24 * sc, 0.22 * sc, 1.06 * sc, cloth, face);
    void drop;
    /**
     * THE CROWN.
     *
     * Seven points of gold, and it is the entire reason this tableau
     * exists: one frog in a hall of two hundred is wearing it, and that is
     * how the player is told who they used to be.
     */
    if (crown) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        B.box.add(x + Math.cos(a) * 0.4 * sc, hy + 0.62 * sc,
          z + Math.sin(a) * 0.4 * sc,
          0.1 * sc, 0.34 * sc, 0.1 * sc, 0xffd76b, -a);
      }
      B.box.add(x, hy + 0.44 * sc, z, 0.9 * sc, 0.16 * sc, 0.9 * sc, 0xc9a227,
        face);
    }
  }

  /** The dome every tableau sits inside, so no sky shows through. */
  _dome(g, top, bottom) {
    const geo = this._geo(new THREE.SphereGeometry(220, 16, 12));
    const mat = this._basic(top, { side: THREE.BackSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 40;
    g.add(m);
    // A floor disc, so the tableau is standing on something.
    const fgeo = this._geo(new THREE.CircleGeometry(200, 28));
    const fmat = this._mat(bottom);
    const f = new THREE.Mesh(fgeo, fmat);
    f.rotation.x = -Math.PI / 2;
    g.add(f);
  }

  /** Build (or fetch) one tableau. */
  _stage(kind) {
    let st = this.stages.get(kind);
    if (st) return st;
    const g = new THREE.Group();
    // Each tableau gets its own patch of sky, well apart from the others.
    const i = this.stages.size;
    g.position.set((i % 3) * 900 - 900, UP + Math.floor(i / 3) * 700, 0);
    g.visible = false;
    this.root.add(g);
    const B = {
      box: new Batch(this._geo(new THREE.BoxGeometry(1, 1, 1)),
        this._mat(0xffffff)),
      blob: new Batch(this._geo(new THREE.SphereGeometry(1, 7, 5)),
        this._mat(0xffffff)),
      pillar: new Batch(this._geo(new THREE.CylinderGeometry(1, 1, 1, 9)),
        this._mat(0xffffff)),
      shaft: new Batch(this._geo(new THREE.CylinderGeometry(1, 1, 1, 5)),
        this._mat(0xffffff)),
    };
    const R = this.rnd;
    switch (kind) {
      case 'hall': this._hall(g, B, R); break;
      case 'ranks': this._ranks(g, B, R); break;
      case 'pair': this._pair(g, B, R); break;
      case 'island': this._island(g, B, R); break;
      case 'statue': this._statue(g, B, R); break;
      default: this._relic(g, B, R); break;
    }
    for (const k in B) B[k].build(g);
    st = { kind, group: g };
    this.stages.set(kind, st);
    return st;
  }

  // ───────────────────────────────────────────────────────── the tableaux ──

  /**
   * THE HALL — a crowd on one knee, and a crown at the end of it.
   *
   * The single most important image in the game: it is the first flashback
   * the player gets, about ninety seconds into playing, and it is what
   * makes the whole mystery legible. So it is deliberately the biggest of
   * the six: two hundred and forty frogs, a colonnade down both sides, and
   * one figure on a throne wearing something nobody else is.
   */
  _hall(g, B, R) {
    this._dome(g, 0x2b2418, 0x4a3f2a);
    // Colonnade down both sides, and a coffered roof over it.
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const z = -70 + i * 10;
        B.pillar.add(sd * 20, 9, z, 2.2, 18, 2.2, 0xc4bfae);
        B.box.add(sd * 20, 18.6, z, 6, 1.4, 6, 0xd8d4c6);
      }
      B.box.add(sd * 20, 20, -25, 5, 2, 100, 0x8b8578);
    }
    // The dais and the throne.
    for (let i = 0; i < 4; i++) {
      B.box.add(0, 0.5 + i * 1, 6 + i * 1.6, 26 - i * 4, 1, 4, 0xc4bfae);
    }
    B.box.add(0, 5.4, 13, 5.6, 5, 4.4, 0x8a2f28);
    B.box.add(0, 9, 14.6, 5.2, 8, 1.4, 0x7a1f2a);
    B.box.add(0, 12.6, 14.6, 2.4, 2.4, 1.2, 0xffd76b);
    // Braziers, so the hall has warmth in it.
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = -40 + i * 22;
        B.pillar.add(sd * 13, 1.6, z, 0.7, 3.2, 0.7, 0x565f6b);
        B.blob.add(sd * 13, 3.6, z, 0.9, 0.7, 0.9, 0xff8a3c);
      }
    }
    /**
     * TWO HUNDRED AND FORTY FROGS, ALL DOWN ON ONE KNEE.
     *
     * Kneeling in ranks that face the throne, with the ones at the front
     * slightly closer together — a crowd is denser where it can see. Every
     * one of them is the same eleven instanced parts.
     */
    for (let row = 0; row < 12; row++) {
      const n = 20 - Math.floor(row / 4);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * (1.9 + R() * 0.3);
        const z = -62 + row * 5.4 + (R() - 0.5) * 1.2;
        if (Math.abs(x) > 17) continue;
        this._frog(B, x, 0, z, 0.9 + R() * 0.16, 0,
          [0x6fae4a, 0x8fc44a, 0x5a8f3a][Math.floor(R() * 3)],
          [0x3a6a8a, 0x7a5a3a, 0x4a5058][Math.floor(R() * 3)], 1);
      }
    }
    // And the one on the throne, wearing the thing they are all kneeling to.
    this._frog(B, 0, 5.6, 12, 1.5, Math.PI, 0x6fae4a, 0x8a2f28, 0, true);
  }

  /**
   * THE RANKS — an army in a field, waiting on your word.
   *
   * Fourteen files by ten ranks with their spears up, standing in corn. The
   * spears are the whole read: a forest of shafts at slightly different
   * angles is the most army-looking thing there is.
   */
  _ranks(g, B, R) {
    this._dome(g, 0x8fb8d8, 0x8a9a52);
    // Corn, to say this is a field rather than a parade ground.
    for (let i = 0; i < 900; i++) {
      const x = (R() - 0.5) * 170, z = (R() - 0.5) * 170;
      if (Math.abs(x) < 40 && z > -30 && z < 40) continue;
      const h = 1 + R() * 1.2;
      B.box.add(x, h * 0.5, z, 0.09, h, 0.09,
        R() < 0.5 ? 0xb99a5a : 0xc9b878, R() * 3, (R() - 0.5) * 0.3, 0);
    }
    for (let row = 0; row < 10; row++) {
      for (let i = 0; i < 14; i++) {
        const x = (i - 6.5) * 2.6 + (R() - 0.5);
        const z = 6 + row * 3.2 + (R() - 0.5);
        const sc = 0.95 + R() * 0.16;
        this._frog(B, x, 0, z, sc, Math.PI, 0x6fae4a, 0x4a5058);
        // A spear, leaning by its own small amount.
        const tilt = (R() - 0.5) * 0.3 - 0.1;
        B.shaft.add(x + 0.6 * sc, 3.1 * sc, z, 0.07, 6.2 * sc, 0.07,
          0x6b4a2a, 0, 0, tilt);
        B.shaft.add(x + 0.6 * sc - Math.sin(tilt) * 3.1 * sc, 6.2 * sc, z,
          0.11, 0.8, 0.11, 0xbfc8d4, 0, 0, tilt);
      }
    }
    // Banners over them.
    for (let i = -2; i <= 2; i++) {
      const x = i * 14;
      B.pillar.add(x, 9, 20, 0.2, 18, 0.2, 0x452e19);
      B.box.add(x + 2.4, 14.5, 20, 4.6, 9, 0.2, 0x2f6f8a);
    }
    // And the figure they are all facing, back to camera.
    this._frog(B, 0, 0, -8, 1.15, 0, 0x6fae4a, 0x2b2f36, 0, true);
  }

  /**
   * THE PAIR — you, and him, before any of it.
   *
   * Two frogs sitting on a step. One is wearing a crown; the other is in
   * pale cloth with nothing on his head. They are close enough together
   * that the picture reads as friendship, which is the only thing it has to
   * do — the dialogue does the rest.
   */
  _pair(g, B, R) {
    this._dome(g, 0x3a5068, 0x6f6b62);
    // A terrace: steps, a balustrade, and a view of nothing in particular.
    for (let i = 0; i < 5; i++) {
      B.box.add(0, 0.4 + i * 0.8, -6 - i * 2.2, 40 - i * 2, 0.8, 3, 0xc4bfae);
    }
    B.box.add(0, 4.2, 2, 40, 0.7, 5, 0xd8d4c6);
    for (let i = -6; i <= 6; i++) {
      B.pillar.add(i * 3, 5.4, 4.2, 0.34, 2.4, 0.34, 0xc4bfae);
    }
    B.box.add(0, 6.8, 4.2, 40, 0.4, 1.2, 0xd8d4c6);
    // A brazier and a low table with a map on it.
    B.pillar.add(-7, 5.2, -1, 0.6, 1.4, 0.6, 0x565f6b);
    B.blob.add(-7, 6.2, -1, 0.8, 0.6, 0.8, 0xff8a3c);
    B.box.add(5, 5.1, -1, 3.4, 0.3, 2.2, 0x6b4a2a);
    B.box.add(5, 5.3, -1, 2.8, 0.06, 1.7, 0xe8dcc0);
    /**
     * AND THE THING ON THE TABLE.
     *
     * Only present in this tableau because two of the three memories staged
     * here are about it: the artefact, sitting between them, which one of
     * them wants to consider using and the other one is frightened of. It
     * is deliberately a shape that does not belong to the rest of the
     * game's vocabulary.
     */
    B.blob.add(5, 5.9, -1, 0.5, 0.7, 0.5, 0x7a9ad0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      B.box.add(5 + Math.cos(a) * 0.42, 5.9, -1 + Math.sin(a) * 0.42,
        0.1, 0.9, 0.1, 0x8fe8ff, -a, 0.3, 0);
    }
    // The two of them, on the step, turned a little toward each other.
    this._frog(B, -2.2, 4.6, -1, 1.15, Math.PI * 0.86, 0x6fae4a, 0x8a2f28,
      0, true);
    this._frog(B, 2.2, 4.6, -1, 1.12, Math.PI * 1.14, 0x7fbf5a, 0xd8d4c6);
    void R;
  }

  /**
   * THE ISLAND — the heavenly battlefield, small and far away.
   *
   * A miniature of the place the game opened in: a disc of pale stone in
   * cloud, waterfalls off the edges, two blocks of army facing each other
   * and one figure in front of each. It is the memory that makes the player
   * realise the opening cinematic was them.
   *
   * Deliberately NOT detailed. It is a thing being remembered from a long
   * way off, and the silhouette — a flat island in the sky with two dark
   * masses on it — is the whole point.
   */
  _island(g, B, R) {
    this._dome(g, 0xa8cfec, 0xdfeaf6);
    // The island: a disc, with a ragged underside.
    B.pillar.add(0, -3, 0, 82, 6, 82, 0xf2ecdc);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      const r = 40 + R() * 40;
      B.shaft.add(Math.cos(a) * r, -14 - R() * 22, Math.sin(a) * r,
        7 + R() * 12, 30 + R() * 40, 7 + R() * 12, 0x8b8578, R() * 3, Math.PI, 0);
    }
    // Cloud all round it.
    for (let i = 0; i < 60; i++) {
      const a = R() * Math.PI * 2;
      const r = 90 + R() * 90;
      B.blob.add(Math.cos(a) * r, -20 - R() * 30, Math.sin(a) * r,
        20 + R() * 26, 8 + R() * 8, 20 + R() * 26, 0xf6fbff);
    }
    // Waterfalls, as pale columns going off the rim.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      B.box.add(Math.cos(a) * 78, -26, Math.sin(a) * 78,
        7, 52, 2, 0xdff0ff, -a);
    }
    // The two colonnades, and the statues at the ends.
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        B.pillar.add(sd * 26, 6, -30 + i * 10, 1.4, 12, 1.4, 0xf2ecdc);
      }
      B.box.add(sd * 44, 8, 44, 10, 16, 9, 0xd8ccae);
      B.blob.add(sd * 44, 18, 44, 4, 3.4, 4, 0xe8dec4);
    }
    /**
     * THE TWO ARMIES, as blocks of frogs.
     *
     * A hundred and twenty a side at a fifth scale, which at this distance
     * reads as a mass rather than as individuals — and the two leaders in
     * front of them do not, which is exactly the composition.
     */
    for (const side of [-1, 1]) {
      const cloth = side < 0 ? 0x3a6a8a : 0x241c22;
      for (let row = 0; row < 8; row++) {
        for (let i = 0; i < 15; i++) {
          const x = (i - 7) * 2.2;
          const z = side * (26 + row * 2.6);
          this._frog(B, x, 0, z, 0.8, side < 0 ? Math.PI : 0,
            side < 0 ? 0x6fae4a : 0x4f6f3a, cloth);
        }
      }
      // The leader, alone, in front.
      this._frog(B, 0, 0, side * 16, 1.1, side < 0 ? Math.PI : 0,
        side < 0 ? 0x6fae4a : 0x4f6f3a, cloth, 0, side < 0);
    }
  }

  /**
   * THE STATUE — a carved figure with your own mark on its breast.
   *
   * Worn almost flat, standing in long grass, with the mark still legible.
   * The second shot pushes in on the mark, because that is the thing the
   * player is meant to compare with their own clothes.
   */
  _statue(g, B, R) {
    this._dome(g, 0x6f8a9a, 0x5a6f4a);
    for (let i = 0; i < 600; i++) {
      const x = (R() - 0.5) * 120, z = (R() - 0.5) * 120;
      const h = 0.6 + R() * 1.1;
      B.box.add(x, h * 0.5, z, 0.09, h, 0.09,
        R() < 0.5 ? 0x4f8f38 : 0x8fc44a, R() * 3, (R() - 0.5) * 0.4, 0);
    }
    // Plinth, legs, body, head — a colossus in the old style.
    for (let i = 0; i < 3; i++) {
      B.box.add(0, 0.8 + i * 1.4, 0, 12 - i * 2, 1.4, 12 - i * 2, 0x8b8578);
    }
    for (const sd of [-1, 1]) {
      B.pillar.add(sd * 1.8, 8, 0, 1.4, 8, 1.4, 0xc4bfae);
    }
    B.blob.add(0, 13.5, 0, 4.2, 4, 3.4, 0xd8d4c6);
    B.blob.add(0, 18, 0.4, 2.2, 2, 2.2, 0xe0dcd0);
    for (const sd of [-1, 1]) {
      B.blob.add(sd * 1.2, 19, 1, 0.9, 0.8, 0.9, 0xf2ecdc);
      B.pillar.add(sd * 4.6, 12.5, 0, 1.1, 7, 1.1, 0xc4bfae, 0, 0, sd * 0.16);
    }
    /**
     * AND THE MARK, on its breast.
     *
     * The same ring, bar and three rays that are carved on the stone in the
     * Wakewood and printed on the player's own clothes. It has to be the
     * same shape or the clue does not land.
     */
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      B.box.add(Math.cos(a) * 1.5, 13.5 + Math.sin(a) * 1.5, 3.3,
        0.5, 0.2, 0.3, 0xffd76b, 0, 0, -a);
    }
    B.box.add(0, 13.5, 3.3, 2.5, 0.2, 0.3, 0xffd76b);
    for (let i = -1; i <= 1; i++) {
      B.box.add(i * 0.7, 15.6 + Math.abs(i) * -0.15, 3.3,
        0.22, 1, 0.3, 0xffd76b, 0, 0, i * 0.3);
    }
    // A crack up one leg, and ivy. It has been standing a long time.
    B.box.add(1.8, 8, 1.5, 0.3, 9, 0.3, 0x6f6b62, 0, 0, 0.1);
    for (let i = 0; i < 14; i++) {
      B.blob.add(-1.8 + (R() - 0.5) * 1.4, 3 + i * 0.9, (R() - 0.5) * 2,
        0.8, 0.5, 0.8, 0x2f5f27);
    }
  }

  /**
   * THE RELIC — a sword on a stone, and hands that know it.
   *
   * One shot, coming down onto it. The smallest tableau in the set and the
   * one that fires most often, because the player finds weapons all the way
   * through the game.
   */
  _relic(g, B, R) {
    this._dome(g, 0x2f3a30, 0x3f5c2e);
    for (let i = 0; i < 500; i++) {
      const x = (R() - 0.5) * 80, z = (R() - 0.5) * 80;
      const h = 0.5 + R() * 1;
      B.box.add(x, h * 0.5, z, 0.09, h, 0.09,
        R() < 0.5 ? 0x4f8f38 : 0x3f7a30, R() * 3, (R() - 0.5) * 0.4, 0);
    }
    // A mossy stone, and the blade laid across it.
    B.blob.add(0, 0.5, 0, 3, 1, 2.6, 0x7a7a70);
    B.blob.add(0, 1.1, 0, 2.6, 0.4, 2.2, 0x3f7a30);
    B.box.add(0, 1.5, 0, 5.4, 0.12, 0.3, 0xe9eef5, 0.3);
    B.box.add(-2.4, 1.5, -0.7, 1.4, 0.16, 0.22, 0x2b2b34, 0.3);
    B.box.add(-1.6, 1.55, -0.45, 0.3, 0.3, 0.7, 0xc9a227, 0.3);
    // Shafts of light down onto it, so the eye goes there.
    for (let i = 0; i < 3; i++) {
      B.pillar.add((i - 1) * 2.4, 20, (i - 1) * 1.6, 1.6, 40, 1.6, 0xdff4c0);
    }
  }

  // ────────────────────────────────────────────────────────────── playing ──

  /**
   * CUT TO A MEMORY.
   *
   * @param id the memory's id; the tableau is chosen from STAGE
   * @returns true if there is a scene for it
   */
  begin(id) {
    const kind = STAGE[id];
    if (!kind) return false;
    const st = this._stage(kind);
    for (const [, s] of this.stages) s.group.visible = false;
    st.group.visible = true;
    this.root.visible = true;
    this.live = st;
    this.shots = SHOTS[kind] || SHOTS.relic;
    this.shot = 0;
    this.shotT = 0;
    this._apply(true);
    return true;
  }

  /** Cut to the next shot, if there is one. Called by a dialogue beat. */
  next() {
    if (!this.live) return;
    this.shot = Math.min(this.shot + 1, this.shots.length - 1);
    this.shotT = 0;
  }

  _apply(snap) {
    const s = this.shots[this.shot];
    const o = this.live.group.position;
    this._from = new THREE.Vector3().fromArray(s.from).add(o);
    this._to = new THREE.Vector3().fromArray(s.to).add(o);
    this._at = new THREE.Vector3().fromArray(s.at).add(o);
    this._atTo = new THREE.Vector3().fromArray(s.atTo || s.at).add(o);
    if (snap) {
      this.camPos.copy(this._from);
      this.camLook.copy(this._at);
    }
  }

  /**
   * Drive the camera. Called every frame while a memory is playing.
   *
   * The shot advances on its own and holds at the end rather than looping:
   * a memory the player is reading slowly should settle, not keep sliding.
   */
  update(dt, camera) {
    if (!this.live || !camera) return;
    const s = this.shots[this.shot];
    this.shotT += dt;
    const k = smoothstep(clamp(this.shotT / s.dur, 0, 1));
    _v.copy(this._from).lerp(this._to, k);
    _look.copy(this._at).lerp(this._atTo, k);
    // Damped, so a cut between shots is a fast glide rather than a jump.
    const f = 1 - Math.pow(0.0005, dt);
    this.camPos.lerp(_v, f);
    this.camLook.lerp(_look, f);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    // The shot ran out and there is another: go to it by itself, so a
    // player who never presses anything still sees the whole scene.
    if (this.shotT > s.dur + 1.5 && this.shot < this.shots.length - 1) {
      this.next();
      this._apply(false);
    }
  }

  /** Take it away. The tableau is kept for next time. */
  end() {
    if (this.live) this.live.group.visible = false;
    this.live = null;
    this.root.visible = false;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const o of this.owned) {
      if (o && o.dispose) { try { o.dispose(); } catch (e) { /* gone */ } }
    }
    this.owned.length = 0;
    this.stages.clear();
    this.live = null;
  }
}
