/**
 * WHAT A MEMORY LOOKS LIKE.
 *
 * A flashback used to be a white screen with words on it. That is a
 * subtitle, not a memory â€” the player was told they saw a hall full of
 * kneeling frogs and had to take it on trust. So every flashback now cuts
 * to an ACTUAL SCENE: built geometry, a camera move across it, and the
 * dialogue over the top.
 *
 * â”€â”€ where they are â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
 * â”€â”€ six tableaux, fifteen memories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * They are shared. "You remember standing in front of your army" and "you
 * remember giving the order at the ford" are the same picture with different
 * words over it, and building fifteen scenes for fifteen memories would be
 * fifteen times the geometry for no gain the player can see.
 *
 *   hall     the throne room, a crowd on one knee, a crown
 *   ranks    an army in formation in a field, seen from the front
 *   pair     two frogs side by side on a step â€” you, and him, before
 *   island   the heavenly battlefield, small and far off, two armies
 *   statue   a carved figure with your own mark on its breast
 *   relic    a sword on a stone, and hands that know it
 *
 * â”€â”€ and they are built on demand â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * A tableau is made the first time a memory that uses it fires, and then
 * kept. Most players will see three or four in a session; building all six
 * up front would be geometry nobody looks at.
 */

import * as THREE from '../lib/three.module.js?v=v121';
import { mulberry32, lerp, smoothstep, clamp } from './util.js?v=v121';
import { addFrog, FROG_SKINS, FROG_CLOTH } from './frogbuild.js?v=v121';

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
 * dialogue advances independently â€” the camera keeps moving while the player
 * reads, and cuts to the next shot when a line calls for it.
 *
 * Written as data for the same reason the prologue's are: a camera move is
 * the thing you tune twenty times.
 *
 * Exported so a test can check that the frogs in a tableau are facing the
 * cameras that look at them — see `_frog` and `cast`.
 */
export const SHOTS = {
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
  /**
   * THE CORONATION â€” not a memory. The end of the game.
   *
   * Five shots, and they are in the order the ceremony happens in: the
   * length of the hall, the faces watching, you on one knee, the crown
   * coming down, and then up and back off the whole room. The last one
   * pulls away down the carpet you are about to walk, which is what makes
   * the walk that follows read as the same scene continuing rather than as
   * the game starting again.
   */
  coronation: [
    { from: [0, 7.5, -86], to: [0, 5.4, -40], at: [0, 5, 9], dur: 8 },
    { from: [-27, 4.4, -27], to: [-16, 3.2, -12],
      at: [0, 3, -15], atTo: [0, 3.2, 3], dur: 6 },
    { from: [0, 3.8, -12], to: [0, 2.9, -5.4], at: [0, 2.5, 3.2], dur: 6 },
    { from: [3.6, 3.6, -3.4], to: [1.7, 3.2, -0.7], at: [0, 2.9, 3.2], dur: 7 },
    { from: [0, 4.2, -8], to: [0, 13, -38], at: [0, 4, 5], dur: 8 },
  ],
};

/** Which tableau each memory is staged in. */
export const STAGE = {
  /**
   * The coronation is its own tableau and is not a memory at all â€” it is
   * the last scene in the game, played once, when Frogath goes down. Listed
   * here because `begin` looks an id up in this table and there is no reason
   * for a staged scene to need a second way in.
   */
  coronation: 'coronation',
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
    /**
     * EVERY FROG PLACED, AND WHICH WAY IT FACES. See `_frog`.
     *
     * Kept for the tests rather than for the game: nothing here is read at
     * runtime, and it is a few hundred small objects built once.
     */
    this.cast = [];
    /** Which tableau is mid-build, so the cast knows where it belongs. */
    this._building = null;
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
   * A FROG â€” the real one, from frogbuild.js.
   *
   * These tableaux used to build their own: a sphere for a body, a smaller
   * sphere on top of it, two boxes for legs. Which is a blob, and a game
   * about frogs cannot have its most important cutscene be two hundred and
   * forty blobs. So every figure in every memory now comes out of the same
   * builder the heavenly armies do â€” wide low body, head forward of the
   * shoulders, eye humps, folded hind legs â€” wearing whatever that tableau
   * calls for.
   *
   * Still instanced into the tableau's own four batches, so the hall is
   * four draw calls exactly as it was before.
   *
   * â”€â”€ and every one of them is WRITTEN DOWN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   * `this.cast` collects what was placed and, crucially, which way it is
   * pointing. A model's forward is (âˆ’sin yaw, âˆ’cos yaw), so YAW ZERO FACES
   * âˆ’Z â€” and getting that backwards is the single most repeated mistake in
   * this codebase. It has now put both armies of the opening cinematic back
   * to back, faced a colossal statue away from both of its own camera
   * shots, and â€” until this pass â€” pointed the crowned emperor in the
   * game's most important flashback at the back wall while two hundred
   * frogs knelt to him with their own backs turned.
   *
   * Reading it out of a comment does not work. So the facings are recorded
   * and a test checks them against the shots that look at them.
   *
   * @param o { skin, cloth, kneel, outfit, detail, armPose, metal, trim,
   *            tag }  `tag` names the group, for that test.
   */
  _frog(B, x, y, z, sc, face, o = {}) {
    this.cast.push({
      kind: this._building || '?', tag: o.tag || 'frog',
      x, y, z, face,
      // Forward, spelled out, so a test never has to re-derive the rule.
      fx: -Math.sin(face), fz: -Math.cos(face),
    });
    addFrog(B, {
      x, y, z, s: sc * 1.06, face,
      skin: o.skin === undefined ? 0x6fae4a : o.skin,
      belly: o.belly,
      cloth: o.cloth === undefined ? 0x3a6a8a : o.cloth,
      metal: o.metal === undefined ? 0x9aa4b2 : o.metal,
      trim: o.trim === undefined ? 0xc9a227 : o.trim,
      capeColour: o.capeColour === undefined ? 0x7a1f2a : o.capeColour,
      plume: o.plume,
      outfit: o.outfit || 'bare',
      kneel: o.kneel || 0,
      detail: o.detail || 'crowd',
      armPose: o.armPose,
    });
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
      // The two the frog builder needs on top of box and blob: limbs, and
      // the small tapered things (toes, fingers, spear heads, plumes).
      rod: new Batch(this._geo(new THREE.CylinderGeometry(1, 1, 1, 6)),
        this._mat(0xffffff)),
      cone: new Batch(this._geo(new THREE.ConeGeometry(1, 1, 5)),
        this._mat(0xffffff)),
    };
    const R = this.rnd;
    this._building = kind;
    switch (kind) {
      case 'hall': this._hall(g, B, R); break;
      case 'ranks': this._ranks(g, B, R); break;
      case 'pair': this._pair(g, B, R); break;
      case 'island': this._island(g, B, R); break;
      case 'statue': this._statue(g, B, R); break;
      case 'coronation': this._coronation(g, B, R); break;
      default: this._relic(g, B, R); break;
    }
    this._building = null;
    for (const k in B) B[k].build(g);
    st = { kind, group: g };
    this.stages.set(kind, st);
    return st;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ the tableaux â”€â”€

  /**
   * THE HALL â€” a crowd on one knee, and a crown at the end of it.
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
     * slightly closer together â€” a crowd is denser where it can see. Every
     * one of them is the same eleven instanced parts.
     */
    for (let row = 0; row < 12; row++) {
      const n = 20 - Math.floor(row / 4);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * (1.9 + R() * 0.3);
        const z = -62 + row * 5.4 + (R() - 0.5) * 1.2;
        if (Math.abs(x) > 17) continue;
        /**
         * The household guard stand; the court kneels.
         *
         * The guard are the outermost file of the two rows closest to the
         * dais â€” on their feet, in plate, spears up. A hall where literally
         * everyone is at the same height is a carpet; two dozen standing
         * figures at the front give the crowd a top edge.
         */
        const guard = row >= 10 && Math.abs(x) > 12;
        /**
         * â•â•â• AND THEY KNEEL TOWARD THE THRONE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
         *
         * Yaw Ï€, because a model's forward is (âˆ’sin yaw, âˆ’cos yaw) and so
         * yaw zero faces âˆ’Z. The crowd is at z âˆ’62 to âˆ’3 and the throne is
         * at +12, so facing it means Ï€.
         *
         * They were at yaw 0 â€” kneeling with their backs to the thing they
         * were kneeling to. From shot one, which looks down the hall from
         * z âˆ’78, that is two hundred frogs on one knee all facing the
         * camera and nothing else.
         */
        this._frog(B, x, 0, z, 0.9 + R() * 0.16, Math.PI, {
          tag: 'crowd',
          skin: FROG_SKINS[Math.floor(R() * FROG_SKINS.length)],
          cloth: guard ? 0x3a6a8a
            : FROG_CLOTH[Math.floor(R() * FROG_CLOTH.length)],
          kneel: guard ? 0 : 1,
          outfit: guard ? 'spearman' : 'bare',
        });
      }
    }
    /**
     * â•â•â• AND THE ONE ON THE THRONE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     *
     * Wearing the thing they are all kneeling to, at `full` detail and a
     * scale of 1.5 â€” shot three pushes in on them from eleven metres and
     * this is the single frog the player is meant to recognise as
     * themselves.
     *
     * YAW ZERO, so they face âˆ’Z: down the hall, over the crowd, into all
     * three of this tableau's cameras. It was Ï€, which pointed the most
     * important frog in the game at the back wall and gave the player its
     * shoulders â€” in the shot whose whole job is showing them a crown.
     */
    this._frog(B, 0, 5.6, 12, 1.5, 0, {
      tag: 'throne',
      skin: 0x6fae4a, cloth: 0x8a2f28, outfit: 'royal',
      capeColour: 0x7a1f2a, detail: 'full', armPose: 'rest',
    });
  }

  /**
   * THE RANKS â€” an army in a field, waiting on your word.
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
    /**
     * The army itself â€” spearmen, and each one carries its OWN spear now.
     *
     * The shafts used to be added by hand next to a blob, which is why they
     * were all the same length and all landed at the same height: they had
     * no arm to be held by. The frog builder grips one at the shoulder, so
     * the forest of shafts comes out of the frogs. A little yaw jitter per
     * frog keeps them from being perfectly parallel, which is the thing
     * that made the hand-rolled version read as a fence.
     */
    /**
     * â•â•â• AND THEY FACE THE CAMERA, WHICH THEY DID NOT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     *
     * A model's forward is (âˆ’sin yaw, âˆ’cos yaw), so YAW ZERO FACES âˆ’Z. This
     * army stands at z 6 to 35 and the frog it is drawn up in front of is at
     * z âˆ’8; all three of this tableau's shots sit at negative z looking
     * toward positive z. So the army wants yaw 0, and the leader wants Ï€.
     *
     * It was the other way round, and the result was an entire army with its
     * back to a shot whose own comment calls it "the wall of faces", and a
     * commander facing away from the troops he is addressing. Shot two â€”
     * "from behind the army, over them, at whoever they are facing" â€” was
     * the only one that came out looking deliberate, and it looked
     * deliberate because it was accidentally the right way round.
     *
     * This is the same mistake, in the same convention, that once had both
     * leaders and both armies of the opening cinematic standing back to
     * back. See `lookYaw` in js/util.js, which exists so this can be
     * written down once instead of guessed at each time.
     */
    for (let row = 0; row < 10; row++) {
      for (let i = 0; i < 14; i++) {
        const x = (i - 6.5) * 2.6 + (R() - 0.5);
        const z = 6 + row * 3.2 + (R() - 0.5);
        const sc = 0.95 + R() * 0.16;
        this._frog(B, x, 0, z, sc, (R() - 0.5) * 0.22, {
          tag: 'army',
          skin: FROG_SKINS[Math.floor(R() * FROG_SKINS.length)],
          cloth: 0x4a5058, metal: 0x9aa4b2,
          // The front rank are captains, with crests. It is how you read
          // depth in a block of soldiers.
          outfit: row === 0 ? 'captain' : 'spearman',
          plume: 0x8a2f28,
        });
      }
    }
    // Banners over them.
    for (let i = -2; i <= 2; i++) {
      const x = i * 14;
      B.pillar.add(x, 9, 20, 0.2, 18, 0.2, 0x452e19);
      B.box.add(x + 2.4, 14.5, 20, 4.6, 9, 0.2, 0x2f6f8a);
    }
    /**
     * And the figure they are all facing: back to camera, arm raised.
     *
     * Yaw Ï€, so forward is +Z â€” into the army, and away from the shots that
     * sit at negative z. The cape is the read from behind, which is why they
     * have one.
     */
    this._frog(B, 0, 0, -8, 1.3, Math.PI, {
      tag: 'leader',
      skin: 0x6fae4a, cloth: 0x2b2f36, outfit: 'royal',
      capeColour: 0x7a1f2a, detail: 'full', armPose: 'reach',
    });
  }

  /**
   * THE PAIR â€” you, and him, before any of it.
   *
   * Two frogs sitting on a step. One is wearing a crown; the other is in
   * pale cloth with nothing on his head. They are close enough together
   * that the picture reads as friendship, which is the only thing it has to
   * do â€” the dialogue does the rest.
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
    /**
     * The two of them, on the step, turned a little toward each other.
     *
     * Both at `full` detail: shot two of this tableau comes to within two
     * and a half metres of the one without the crown, and at that range a
     * crowd frog's missing fingers and brow ridges are the whole frame.
     *
     * He is deliberately BAREHEADED â€” plate and pauldrons, no helm â€” so the
     * only difference between the two silhouettes is the crown. That is the
     * entire content of the picture.
     */
    /**
     * â•â•â• AND THEY FACE THE CAMERA â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     *
     * Both shots here sit at negative z looking at z 0, and the second one
     * pushes in to two and a half metres of the frog without the crown â€”
     * the whole point of the tableau being that the only difference between
     * the two silhouettes IS the crown.
     *
     * So they want yaw near ZERO (forward âˆ’Z, toward the camera), turned a
     * little toward each other: negative for the one on the left so it
     * looks right, positive for the one on the right so it looks left.
     *
     * They were at 0.86Ï€ and 1.14Ï€ â€” both facing +Z, away from both shots.
     * Which means the closest, most deliberate push-in in the whole
     * flashback system was framed on the back of somebody's head.
     */
    this._frog(B, -2.2, 4.6, -1, 1.15, -0.2, {
      tag: 'pair-crowned',
      skin: 0x6fae4a, cloth: 0x8a2f28, outfit: 'royal',
      capeColour: 0x7a1f2a, detail: 'full', armPose: 'rest',
    });
    this._frog(B, 2.2, 4.6, -1, 1.12, 0.2, {
      tag: 'pair-bare',
      skin: 0x7fbf5a, cloth: 0xd8d4c6, metal: 0x9aa4b2, detail: 'full',
      armPose: 'reach',
      outfit: { helm: null, plate: true, pauldrons: true, greaves: true,
        tabard: true, shield: false, hold: null, cape: true },
      capeColour: 0x4a5058,
    });
    void R;
  }

  /**
   * THE ISLAND â€” the heavenly battlefield, small and far away.
   *
   * A miniature of the place the game opened in: a disc of pale stone in
   * cloud, waterfalls off the edges, two blocks of army facing each other
   * and one figure in front of each. It is the memory that makes the player
   * realise the opening cinematic was them.
   *
   * Deliberately NOT detailed. It is a thing being remembered from a long
   * way off, and the silhouette â€” a flat island in the sky with two dark
   * masses on it â€” is the whole point.
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
     * reads as a mass rather than as individuals â€” and the two leaders in
     * front of them do not, which is exactly the composition.
     */
    for (const side of [-1, 1]) {
      const yours = side < 0;
      const cloth = yours ? 0x3a6a8a : 0x241c22;
      // Bright steel against dark, so the two masses read apart even at
      // a hundred and fifty metres, which is where shot one sits.
      const metal = yours ? 0x9aa4b2 : 0x4a4f58;
      for (let row = 0; row < 8; row++) {
        for (let i = 0; i < 15; i++) {
          const x = (i - 7) * 2.2;
          const z = side * (26 + row * 2.6);
          this._frog(B, x, 0, z, 0.8, yours ? Math.PI : 0, {
            tag: 'army',
            skin: yours ? FROG_SKINS[(row * 15 + i) % FROG_SKINS.length]
              : 0x4f6f3a,
            cloth, metal, outfit: 'spearman',
          });
        }
      }
      // The leader, alone, in front.
      this._frog(B, 0, 0, side * 16, 1.15, yours ? Math.PI : 0, {
        tag: 'leader',
        skin: yours ? 0x6fae4a : 0x4f6f3a, cloth, metal,
        outfit: yours ? 'royal' : 'captain',
        capeColour: cloth, plume: 0x8a2f28, armPose: 'reach',
        detail: 'full',
      });
    }
  }

  /**
   * THE STATUE â€” a carved figure with your own mark on its breast.
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
    // The plinth: three courses of dressed stone.
    for (let i = 0; i < 3; i++) {
      B.box.add(0, 0.8 + i * 1.4, 0, 12 - i * 2, 1.4, 12 - i * 2, 0x8b8578);
    }
    /**
     * AND THE COLOSSUS ON IT â€” a carved FROG, not a carved lump.
     *
     * This was five spheres and two pillars, which is to say it was a
     * snowman. It is now the same builder every other frog in the game
     * uses, at six and a half times scale, in weathered stone: crouched
     * on its haunches with the eye humps up and the crown gilded, which is
     * eighteen metres of unmistakable silhouette.
     *
     * It faces âˆ’Z, TOWARD the camera. Both shots in this tableau sit on the
     * negative-z side, and the old hand-built version had its head leaning
     * and its breast-mark on the +z face â€” the player was being shown the
     * back of the clue.
     */
    const SY = 4.3, SS = 6.5;
    this._frog(B, 0, SY, 0, SS, 0, {
      tag: 'statue',
      skin: 0xd8d4c6, belly: 0xe4e0d2, cloth: 0xbfb8a6,
      metal: 0xc4bfae, trim: 0xb8b0a0,
      outfit: 'royal', capeColour: 0xb0a897, detail: 'full', armPose: 'rest',
    });
    /**
     * AND THE MARK, on its breast.
     *
     * The same ring, bar and three rays that are carved on the stone in the
     * Wakewood and printed on the player's own clothes. It has to be the
     * same shape or the clue does not land.
     *
     * Sat on the front face of the breastplate â€” fw 0.14 plus half its
     * 0.56 depth, times the scale â€” so it is proud of the stone rather
     * than buried in it.
     */
    const MY = SY + 0.79 * SS, MZ = -(0.14 + 0.30) * SS;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      B.box.add(Math.cos(a) * 1.1, MY + Math.sin(a) * 1.1, MZ,
        0.38, 0.16, 0.24, 0xffd76b, 0, 0, -a);
    }
    B.box.add(0, MY, MZ, 1.9, 0.16, 0.24, 0xffd76b);
    for (let i = -1; i <= 1; i++) {
      B.box.add(i * 0.52, MY + 1.6 + Math.abs(i) * -0.12, MZ,
        0.17, 0.76, 0.24, 0xffd76b, 0, 0, i * 0.3);
    }
    // A crack up one leg, and ivy. It has been standing a long time.
    B.box.add(3.6, SY + 2.6, -0.4, 0.26, 5.6, 0.26, 0x6f6b62, 0, 0, 0.1);
    for (let i = 0; i < 16; i++) {
      B.blob.add(-3.4 + (R() - 0.5) * 1.6, 1.6 + i * 0.72, (R() - 0.5) * 2.4,
        0.8, 0.5, 0.8, 0x2f5f27);
    }
  }

  /**
   * â•â•â• THE CORONATION â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * The last scene in the game, and the only tableau in this file that is
   * not a memory: everything else here is something that already happened,
   * and this is something happening now.
   *
   * It is deliberately the SAME ROOM as `_hall`, lit the other way round.
   * The hall is a memory â€” brown, torchlit, a crowd on its knees in front
   * of somebody you cannot make out. This is that room with the shutters
   * open: the same colonnade, the same dais, and a congregation on its FEET
   * because the person being crowned is the one kneeling this time. A player
   * who saw the first flashback ninety minutes ago should recognise the
   * pillars before they work out why.
   *
   * â”€â”€ the composition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   * A red carpet runs the length of it, from the door the camera opens on to
   * the foot of the dais. You are at the end of that carpet on one knee, in
   * the ninja outfit â€” you are the only frog in the room not in plate or
   * cloth, which is what makes you findable in a crowd of two hundred. On
   * the step above you is a robed frog holding a crown, and the crown is the
   * one thing in this tableau that MOVES: it comes down onto your head on a
   * cue from the script. See `cue` and `update`.
   *
   * And the carpet is not decoration. When this scene ends the player is
   * put down on a real one in the world and walks it â€” see js/coronation.js.
   */
  _coronation(g, B, R) {
    // A warm, bright dome. The memory hall's is 0x2b2418; this is daylight.
    this._dome(g, 0x6a86ae, 0x7a6a4a);
    /**
     * The colonnade â€” the same pillars, the same spacing, the same stone as
     * `_hall`, running further because this shot starts further back.
     */
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 13; i++) {
        const z = -86 + i * 9;
        B.pillar.add(sd * 20, 10, z, 2.4, 20, 2.4, 0xd4cfbe);
        B.box.add(sd * 20, 20.4, z, 6.4, 1.6, 6.4, 0xe8e4d6);
        // A banner between each pair, red with a gold band.
        if (i < 12) {
          B.box.add(sd * 18.4, 13, z + 4.5, 0.3, 11, 5.4, 0x8a2f28);
          B.box.add(sd * 18.4, 18.2, z + 4.5, 0.36, 1.1, 5.4, 0xd8ad2e);
        }
      }
      B.box.add(sd * 20, 22, -34, 5.4, 2.4, 116, 0x9a9488);
    }
    // The dais, four courses, and the throne standing empty on it.
    for (let i = 0; i < 4; i++) {
      B.box.add(0, 0.5 + i * 1.05, 6 + i * 1.7, 28 - i * 4.4, 1.05, 4.2,
        0xd4cfbe);
    }
    B.box.add(0, 5.4, 13.4, 5.8, 5.2, 4.6, 0x8a2f28);
    B.box.add(0, 9.2, 15.0, 5.4, 8.4, 1.5, 0x7a1f2a);
    B.box.add(0, 13.0, 15.0, 2.6, 2.6, 1.3, 0xd8ad2e);
    /**
     * THE RED CARPET, with a gold edge, from the far door to the dais.
     *
     * Six units wide, which is the same width as the real one the player is
     * about to walk. The two being the same is the whole join between the
     * cutscene and the thing that comes after it.
     */
    for (let i = 0; i < 32; i++) {
      const z = -86 + i * 3;
      B.box.add(0, 0.06, z, 6.0, 0.12, 3.0, i & 1 ? 0x8a2f28 : 0x7d2824);
      for (const sd of [-1, 1]) {
        B.box.add(sd * 3.15, 0.08, z, 0.5, 0.16, 3.0, 0xd8ad2e);
      }
    }
    /**
     * TWO HUNDRED FROGS, ON THEIR FEET, LINING IT.
     *
     * Nobody kneels in this one but you. The rank nearest the carpet is the
     * household guard in plate with spears up â€” a line of vertical shafts
     * down both sides of the aisle is what makes a corridor of people read
     * as a processional route rather than as a crowd.
     */
    for (const sd of [-1, 1]) {
      for (let row = 0; row < 22; row++) {
        const z = -84 + row * 3.9;
        for (let f = 0; f < 5; f++) {
          const x = sd * (5.2 + f * 2.9) + (R() - 0.5) * 0.7;
          if (Math.abs(x) > 18) continue;
          const guard = f === 0 && row % 2 === 0;
          this._frog(B, x, 0, z + (R() - 0.5) * 0.8, 0.92 + R() * 0.16,
            Math.PI + (R() - 0.5) * 0.3, {
              tag: 'crowd',
              skin: FROG_SKINS[Math.floor(R() * FROG_SKINS.length)],
              cloth: guard ? 0x3a6a8a
                : FROG_CLOTH[Math.floor(R() * FROG_CLOTH.length)],
              metal: 0x9aa4b2,
              outfit: guard ? 'spearman' : 'bare',
              armPose: guard ? 'hold' : (R() < 0.4 ? 'salute' : 'rest'),
            });
        }
      }
    }
    /**
     * AND YOU, ON ONE KNEE, AT THE END OF THE CARPET.
     *
     * The ninja outfit, because that is what the player has been looking at
     * for the whole game, plus the red cape â€” so the frog on its knee at the
     * foot of the dais is unambiguously the one they have been driving, and
     * not a stranger they are being told is them. `full` detail: shots three
     * and four come within a metre of the back of this frog's head.
     */
    const KZ = 2.2, KS = 1.35;
    this._frog(B, 0, 0, KZ, KS, Math.PI, {
      tag: 'kneeling',
      skin: 0x6fae4a, cloth: 0x2b2f36, metal: 0x9aa4b2, trim: 0xd8ad2e,
      outfit: { helm: 'hood', plate: false, pauldrons: false, greaves: false,
        tabard: false, shield: false, hold: null, cape: true },
      capeColour: 0x8a2f28,
      kneel: 1, detail: 'full', armPose: 'rest',
    });
    /**
     * THE ONE DOING THE CROWNING â€” robed, on the step above you, arms out.
     *
     * Deliberately anonymous. Every named frog who could have done this is
     * either dead, was on the other side, or does not know who you are; the
     * point of the scene is the country putting the crown back on, not one
     * character handing it over.
     */
    this._frog(B, 0, 4.3, 7.6, 1.25, 0, {
      tag: 'chamberlain',
      skin: 0x86a84e, cloth: 0xe8e4d6, trim: 0xd8ad2e,
      outfit: { helm: 'wrap', plate: false, robe: true, hold: null },
      detail: 'full', armPose: 'reach',
    });
    /**
     * â•â•â• AND THE CROWN â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     *
     * The only moving thing in any tableau in this file, and the reason the
     * scene exists. Seven points and a band, exactly the silhouette the
     * memories have been showing the player since the first flashback and
     * exactly the one on Frogath's chair, in gold instead of black.
     *
     * A real Group rather than instances, because it has to be animated:
     * twelve meshes is nothing, and `update` lerps it from the robed frog's
     * hands down onto the kneeling frog's head when the script cues it.
     */
    const crown = new THREE.Group();
    const cg = this._geo(new THREE.BoxGeometry(1, 1, 1));
    const gold = this._mat(0xd8ad2e);
    const bright = this._mat(0xffd76b);
    const band = new THREE.Mesh(cg, gold);
    band.scale.set(1.30, 0.20, 1.22);
    crown.add(band);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const p = new THREE.Mesh(cg, bright);
      p.scale.set(0.14, 0.44 + (i % 2 ? 0.24 : 0), 0.14);
      p.position.set(Math.cos(a) * 0.58, 0.30 + (i % 2 ? 0.14 : 0),
        Math.sin(a) * 0.54);
      crown.add(p);
    }
    g.add(crown);
    /**
     * Where it starts and where it lands.
     *
     * The landing point is computed from the same numbers the kneeling frog
     * was built with rather than typed in: `addFrog` puts a crown at
     * hu + 0.34 above the feet and hf forward, and a kneel sinks the head by
     * 0.30 Ã— 0.9 and pitches it 0.04 forward. Getting this by eye would mean
     * re-eyeing it every time either of those changed.
     */
    const s = KS * 1.06;
    const hu = 1.26 - 0.30 * 0.9, hf = 0.30 + 0.04;
    crown.position.set(0, 5.1, 7.0);
    g.userData.crown = crown;
    g.userData.crownFrom = new THREE.Vector3(0, 5.1, 7.0);
    g.userData.crownTo = new THREE.Vector3(
      0, (hu + 0.34) * s, KZ + hf * s);
    crown.scale.setScalar(s);
    // Light shafts down the length of the hall, through the colonnade.
    for (let i = 0; i < 7; i++) {
      B.pillar.add((i % 2 ? -11 : 11), 14, -72 + i * 13,
        2.6, 28, 2.6, 0xf6ecd0);
    }
    // Braziers up both sides of the dais.
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = -4 - i * 7;
        B.pillar.add(sd * 12, 1.8, z, 0.8, 3.6, 0.8, 0x565f6b);
        B.blob.add(sd * 12, 4.0, z, 1.0, 0.8, 1.0, 0xffcf8a);
      }
    }
  }

  /**
   * A NAMED CUE FROM THE SCRIPT â€” currently only the crown coming down.
   *
   * A dialogue beat calls this and the tableau's own animation starts from
   * that moment. Driven off a cue rather than off elapsed time because a
   * shot can be advanced early by the player pressing E, so "2.8 seconds
   * into shot four" is not a thing this file can know.
   */
  cue(name) { this.anim = { name, t: 0 }; }

  /**
   * THE RELIC â€” a sword on a stone, and hands that know it.
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
    /**
     * AND THE HANDS THAT KNOW IT.
     *
     * The tableau was called that and did not have any. One frog kneeling
     * behind the stone with an arm out over the blade, facing the camera â€”
     * placed at +z so the shot, which comes down to four metres out on the
     * âˆ’z side, has it in frame and the stone between them.
     */
    this._frog(B, 0, 0, 2.6, 1.1, 0, {
      tag: 'hands',
      skin: 0x6fae4a, cloth: 0x2b2f36, metal: 0x8f99a8,
      outfit: 'royal', capeColour: 0x7a1f2a, kneel: 1,
      detail: 'full', armPose: 'reach',
    });
    // Shafts of light down onto it, so the eye goes there.
    for (let i = 0; i < 3; i++) {
      B.pillar.add((i - 1) * 2.4, 20, (i - 1) * 1.6, 1.6, 40, 1.6, 0xdff4c0);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ playing â”€â”€

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
    // Any tableau animation goes back to its start, so a coronation replayed
    // on a second save file does not open with the crown already worn.
    this.anim = null;
    const ud = st.group.userData;
    if (ud.crown) ud.crown.position.copy(ud.crownFrom);
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
    /**
     * THE CROWN COMING DOWN.
     *
     * The one piece of animation in this file. Held at its starting height
     * until the script cues it, then two and a half seconds of smoothstep
     * onto the kneeling frog's head, with the last of its turn coming off
     * as it settles so it lands square.
     */
    const ud = this.live.group.userData;
    if (ud.crown) {
      const k = this.anim && this.anim.name === 'crown'
        ? smoothstep(clamp(this.anim.t / 2.5, 0, 1)) : 0;
      ud.crown.position.lerpVectors(ud.crownFrom, ud.crownTo, k);
      ud.crown.rotation.y = (1 - k) * 1.1;
    }
    if (this.anim) this.anim.t += dt;
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
