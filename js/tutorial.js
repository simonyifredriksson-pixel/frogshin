/**
 * THE FIRST ISLAND — where you learn to be a frog.
 *
 * The very first time anybody opens FROGSHIN they do not see the menu. They
 * wake on a beach at the west end of a long green island with an old frog
 * standing over them, and they go east until they come out of an arch at the
 * far end knowing how to play. Nine stations, in the order the game needs
 * them:
 *
 *   THE BEACH     look, and walk                       mouse, WASD, Shift
 *   THE STEPS     a staircase of platforms over water   Space, and Space again
 *   THE CHASM     gaps too wide to jump                 Q
 *   THE POSTS     posts over deep water                 G
 *   THE YARD      straw targets, one out of reach       Left click, and 1 / 2
 *   THE RING      one frog who telegraphs every swing   Right click
 *   THE PIT       three of them at once                 all of it
 *   THE RUN       jump, dash, tongue, wall — in order   all of it
 *   THE WARDEN    something that hits back properly     all of it
 *
 * ── how a station is gated ───────────────────────────────────────────────
 * Two different ways, on purpose.
 *
 * The MOVEMENT stations are gated by the ground itself. There is no door on
 * the steps, the chasm or the posts, because there is no way across them but
 * the ability being taught — a player who has not found the dash is standing
 * at the edge of a twenty-three-unit hole with the key printed on their HUD.
 * The terrain is the lesson.
 *
 * The COMBAT stations are gated by a DOOR, because you can walk past a straw
 * man. Each is a real slab of stone that sinks into the ground when its
 * station is cleared — never an invisible wall, for the same reason nothing
 * else in this game has one any more.
 *
 * ── and it cannot be failed ─────────────────────────────────────────────
 * There is no lose condition anywhere on the island. Falling in the water
 * puts you back on the last checkpoint; dying does the same and refills you.
 * Every objective is "do it once more", never "do it without missing". A
 * tutorial that can be failed teaches people to quit.
 *
 * It can be SKIPPED — held, not tapped, and only offered once the first
 * station is behind you, so the option is found by somebody who has seen
 * what they would be skipping.
 *
 * ── the layout is DERIVED, not typed ────────────────────────────────────
 * Every x on this island comes out of `_layout`, which walks east placing
 * pieces and edge-to-edge air gaps. The first version of this file had the
 * coordinates written out by hand and they were wrong in four places — a
 * ramp descending into open water, a dash gap that turned out to be a
 * fifteen-unit hop, a hole that ended under a platform. A gap the player has
 * to cross is the one number that must mean what it says, so it is stated as
 * a gap and the positions are worked out from it.
 */

import * as THREE from '../lib/three.module.js?v=v94';
import { CFG } from './config.js?v=v94';
import { clamp, mulberry32 } from './util.js?v=v94';
import { Terrain, CollisionWorld } from './collision.js?v=v94';
import { Mob } from './mobs.js?v=v94';
import { addFrog } from './frogbuild.js?v=v94';
import { Cine } from './cinema.js?v=v94';
import { Audio } from './audio.js?v=v94';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _at = new THREE.Vector3();

/**
 * WHERE THE ISLAND IS.
 *
 * A long way from everything else and well above the void, like the dungeon
 * and the judgment arena. Nothing else is ever in this scene.
 */
export const TUTORIAL_AT = new THREE.Vector3(-9000, 500, -9000);

/**
 * WHERE THE GAME'S WATER LEVEL GOES WHILE THE ISLAND IS UP.
 *
 * The swimming check reads `CFG.world.waterLevel` as a global, and this
 * island has a visible sea round it at y ≈ 493 — so left alone, a player who
 * stepped off the beach would be swimming, and one standing ON the beach
 * would be a metre from it. Pushed three hundred units below the island, put
 * back on the way out. The same trick the prologue uses for the same reason.
 *
 * Falling in the sea is handled by the island itself, not by the swim code:
 * see `_fell`.
 */
export const TUTORIAL_WATER = TUTORIAL_AT.y - 300;

/** The island's own shape. y = 0 is the grass; nothing on it slopes. */
export const ISLE = {
  /**
   * Half the length of the straight middle. The ends are half-discs.
   *
   * Long, because the lagoon crossing is long: nine steps, two dash gaps and
   * four tongue gaps come to about four hundred units of parkour on their
   * own, and every one of those distances is fixed by `GAP` rather than by
   * how much room there happens to be. So the island is sized to fit the
   * course rather than the course being squeezed to fit the island — which
   * is the right way round, and is how the first version came out with the
   * gate two hundred and ninety units past the east tip.
   */
  spine: 430,
  /** Half the width, and the radius of each rounded end. */
  half: 100,
  /** One floor cell. Coarse enough to be cheap, fine enough to cut a hole. */
  cell: 12,
  /** The water surface, and the depth at which you count as having fallen. */
  water: -7,
  wet: -4,
};

/**
 * ═══ THE GAPS, AS GAPS ══════════════════════════════════════════════════
 *
 * Edge to edge, in units of open air, and these four numbers are the entire
 * difficulty curve of the island. They come from the movement numbers in
 * config.js rather than from taste:
 *
 *   jumpSpeed 17.5 against gravity -42 with a 1.45 fall multiplier is about
 *   0.76 s in the air, and runSpeed 15.5 carries you ~11.8 units in that.
 *   The frog flip adds most of another arc: ~19. A dash is 47 u/s for
 *   0.17 s and keeps 52% of that afterwards, so a jump with a dash in it is
 *   about 24. The tongue reaches 62.
 *
 * So: 9 is a hop anybody lands, 15 needs the second jump, 23 needs the dash
 * and cannot be flipped, and 34 needs the tongue and cannot be dashed.
 */
const GAP = { hop: 9, flip: 15, dash: 23, tongue: 34 };

/**
 * ═══ THE NINE STATIONS ══════════════════════════════════════════════════
 *
 * The WORDS live here. The numbers do not — `_layout` fills in `at`, `to`,
 * `checkpoint`, `y` and `door` on a private copy, so this table can be
 * rewritten without moving a single platform.
 *
 * `kind` is how it finishes:
 *   reach   walk past an x line
 *   land    get past the line AND up at the platform's height
 *   break   destroy straw targets
 *   parry   turn blows aside
 *   kill    put mobs down
 */
export const STATIONS = [
  {
    id: 'beach', title: 'THE BEACH', kind: 'reach',
    objective: 'Walk to the arch',
    prompt: ['MOVE', 'W A S D', 'AND LOOK WITH THE MOUSE'],
    teach: 'W A S D to move, the mouse to look. Hold SHIFT to run.',
    master: 'Up you get. You have been asleep on my beach for two days.',
  },
  {
    id: 'steps', title: 'THE STEPS', kind: 'land',
    objective: 'Jump the steps to the top',
    prompt: ['JUMP', 'SPACE', 'AGAIN IN THE AIR FOR THE FROG FLIP'],
    teach: 'SPACE jumps. Press it again while you are in the air for the '
      + 'frog flip — a second jump out of nothing. The last two are too far '
      + 'without it.',
    master: 'A frog that cannot jump is somebody\'s dinner. Up. All the way up.',
  },
  {
    id: 'chasm', title: 'THE CHASM', kind: 'reach',
    objective: 'Dash across the gaps',
    prompt: ['DASH', 'Q', 'IN THE AIR, AFTER THE JUMP'],
    teach: 'Q dashes. Jump first, then dash while you are out over the water '
      + '— it carries you further than any jump, it costs stamina, and for a '
      + 'moment nothing can touch you.',
    master: 'Too far to jump. That is rather the point. Jump, then Q.',
  },
  {
    id: 'posts', title: 'THE POSTS', kind: 'reach',
    objective: 'Grapple post to post',
    prompt: ['TONGUE', 'G', 'AIM AT THE LIGHTS'],
    teach: 'G fires your tongue at anything glowing. It reels you in, and you '
      + 'can swing on it. G again lets go. It is the best thing you own.',
    master: 'Look at a light. Press G. Do not think about it too hard.',
  },
  {
    id: 'yard', title: 'THE YARD', kind: 'break', need: 4,
    objective: 'Destroy the straw targets',
    prompt: ['SWING', 'LEFT CLICK', '— PRESS 2 FOR KUNAI, 1 FOR THE BLADE'],
    teach: 'LEFT CLICK swings the katana; keep going for the combo, the third '
      + 'is the heavy one. The fourth target is out over the water: press 2 '
      + 'to take out a kunai, throw it with LEFT CLICK, then press 1 to put '
      + 'the blade back in your hand.',
    master: 'Straw first. Straw does not hit back and you are not ready.',
  },
  {
    id: 'ring', title: 'THE RING', kind: 'parry', need: 3,
    objective: 'Parry three blows',
    prompt: ['GUARD', 'RIGHT CLICK', 'HOLD IT — AND KEEP THE BLADE IN HAND'],
    teach: 'HOLD RIGHT CLICK to guard, with the katana in hand — press 1 if '
      + 'you still have kunai out. A red ring on the ground is a blow about '
      + 'to land. Hold the guard through it. Turn one aside and you must wait '
      + 'a moment before guarding again.',
    master: 'She shows you the blow before she throws it. Everything in this '
      + 'country does. Watch the ground, not her.',
  },
  {
    id: 'pit', title: 'THE PIT', kind: 'kill', need: 3,
    objective: 'Put down all three',
    prompt: ['FIGHT', 'ALL OF IT', 'GUARD IT OR DASH IT — BOTH WORK'],
    teach: 'Three at once. You can dash out of a red ring instead of guarding '
      + 'it — a dash has the same moment of nothing-touches-you. Knowing '
      + 'which to use is most of this game.',
    master: 'Three. Do not stand in the middle of them.',
  },
  {
    id: 'run', title: 'THE RUN', kind: 'reach',
    objective: 'Run the course to the plaza',
    prompt: ['EVERYTHING', 'IN ORDER', 'JUMP — DASH — TONGUE — WALL'],
    teach: 'Jump the short ones, dash the long one, tongue the posts. At the '
      + 'end there is a wall: hold into it and press SPACE to kick off it.',
    master: 'Everything I have shown you, in one go, without stopping.',
  },
  {
    id: 'warden', title: 'THE WARDEN', kind: 'kill', need: 1,
    objective: 'Beat the Warden of the First Island',
    prompt: ['THE WARDEN', 'ALL OF IT', 'GUARD, HIT THREE TIMES, GET OUT'],
    teach: 'He telegraphs like everything else. Guard it or dash it, take '
      + 'your three hits, and get back out of his reach.',
    master: 'One more, and he is not straw. If he puts you down, get up.',
  },
];

/** One instanced batch of one geometry and one material. */
class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    this.items.push([x, y, z, sx, sy, sz, color, ry, rx, rz]);
  }
  build(parent, cast) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    mesh.castShadow = !!cast;
    mesh.receiveShadow = true;
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
    this.mesh = mesh;
    return mesh;
  }
}

/** Is this point on the island's stadium outline? */
export function onIsland(x, z) {
  const dx = Math.max(0, Math.abs(x) - ISLE.spine);
  return Math.hypot(dx, z) <= ISLE.half;
}

export class TutorialIsland {
  constructor(opts) {
    this.scene = opts.scene;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.camera = opts.camera;
    this.followCam = opts.followCam;
    /** Called once, when the island is finished or skipped. */
    this.onDone = opts.onDone || (() => {});

    this.at = TUTORIAL_AT.clone();
    this.rnd = mulberry32(0x1541d);
    this.owned = [];
    this.root = new THREE.Group();
    this.root.name = 'tutorial-island';
    this.root.position.copy(this.at);
    this.scene.add(this.root);

    /**
     * The stations, with their geometry filled in. A private copy so the
     * exported table stays the words and nothing else.
     */
    this.stations = STATIONS.map((s) => Object.assign({}, s));
    this.plan = this._layout();

    this.index = 0;
    this.count = 0;
    this.t = 0;
    this.finished = false;
    this.straw = [];
    this.mobs = [];
    this.doors = [];
    this.skipHeld = 0;
    this._taught = new Set();
    this._checkpoint = new THREE.Vector3();
  }

  get collision() { return this._collision; }
  /** Below this you are out of the world entirely — see Game._voidGuard. */
  get voidY() { return this.at.y - CFG.move.voidDepth; }
  get spawnPoint() {
    return new THREE.Vector3(this.at.x + this.plan.spawn, this.at.y + 1.2,
      this.at.z);
  }
  /** The station being played, or null once they are all behind you. */
  get station() { return this.stations[this.index] || null; }
  /** Which station a given id is, for the tests. */
  stationOf(id) { return this.stations.find((s) => s.id === id) || null; }

  // ───────────────────────────────────────────────────────────── the layout ──

  /**
   * WALK EAST, PLACING THINGS.
   *
   * `x` is always the east edge of whatever was placed last, so a gap is
   * added to it and the next piece's centre is that plus its own half-width.
   * Everything the builders and the stations need comes out of here, which
   * is the only way a stated gap and a built gap can be the same number.
   */
  _layout() {
    const P = {
      holes: [], steps: [], chasm: [], posts: [], runPlats: [],
      runPosts: [], stair: [],
    };
    const S = (id) => this.stations.find((x) => x.id === id);
    let x = -(ISLE.spine + ISLE.half) + 18;

    // ── THE BEACH ──────────────────────────────────────────────────────────
    P.spawn = x;
    P.master = x + 6;
    P.arch = x + 62;
    const beach = S('beach');
    beach.at = x;
    beach.to = P.arch + 6;
    beach.checkpoint = [x, 0, 0];
    x = P.arch + 14;

    /**
     * ── THE LAGOON ───────────────────────────────────────────────────────
     *
     * One long hole in the floor holding all three movement stations, so
     * the whole crossing is over water and a missed jump anywhere in it is
     * the same mistake with the same correction. It also means the island
     * reads as beach — lagoon — beach, which is the shape of an island.
     */
    const lagoonFrom = x;

    // ── THE STEPS ─────────────────────────────────────────────────────────
    let y = 1.4;
    const stepHw = 3.5;
    for (let i = 0; i < 9; i++) {
      x += stepHw;
      P.steps.push({ x, y, hw: stepHw });
      x += stepHw;
      // The first six are inside one jump; the last two need the flip.
      if (i < 8) x += (i < 6 ? GAP.hop : GAP.flip);
      y += 1.5;
    }
    const top = P.steps[P.steps.length - 1];
    const steps = S('steps');
    steps.at = P.steps[0].x;
    steps.to = top.x - 3;
    steps.y = top.y;
    steps.checkpoint = [P.arch + 4, 0, 0];

    // ── THE CHASM ─────────────────────────────────────────────────────────
    const chasmHw = 6;
    for (let i = 0; i < 2; i++) {
      x += GAP.dash;
      x += chasmHw;
      P.chasm.push({ x, y: top.y, hw: chasmHw });
      x += chasmHw;
    }
    const chasm = S('chasm');
    chasm.at = P.chasm[0].x;
    chasm.to = P.chasm[1].x - 4;
    chasm.checkpoint = [top.x, top.y, 0];

    // ── THE POSTS ─────────────────────────────────────────────────────────
    const postHw = 3.2;
    for (let i = 0; i < 3; i++) {
      x += GAP.tongue;
      x += postHw;
      // Rising, and alternating a little, so the swing has somewhere to go.
      P.posts.push({ x, y: top.y + 4 + i * 3, hw: postHw });
      x += postHw;
    }
    x += GAP.tongue;
    P.landing = { x: x + 7, y: top.y, hw: 7 };
    x = P.landing.x + P.landing.hw;
    const posts = S('posts');
    posts.at = P.posts[0].x;
    posts.to = P.landing.x - 3;
    posts.checkpoint = [P.chasm[1].x, top.y, 0];

    /**
     * The stair down to the grass. Eight treads, each a fixed rise, so it is
     * walkable rather than being a cliff with steps drawn on it — and the
     * lagoon ends where the last tread reaches ground level.
     */
    let sy = P.landing.y;
    for (let i = 0; i < 8; i++) {
      sy -= P.landing.y / 8;
      x += 3.6;
      P.stair.push({ x, y: sy });
    }
    P.holes.push([lagoonFrom, x + 4]);
    x += 12;

    // ── THE YARD ──────────────────────────────────────────────────────────
    const yard = S('yard');
    yard.at = x;
    P.yardAt = x + 20;
    /**
     * Three targets you can walk up to and one on a post out over the water
     * on the island's north shore — which is the whole lesson about the
     * kunai: there is a target you cannot reach and a key that deals with it.
     */
    /**
     * Three you can walk up to, and one fifteen units in the air.
     *
     * UP rather than far away: the first version put the fourth one on a
     * post out past the north shore, which measured a hundred and eighteen
     * units from the nearest and read as a straw man on the horizon rather
     * than as a target. On top of a post in the middle of the same yard it
     * is unmistakably part of the station, obviously out of reach — nothing
     * jumps fifteen units and there is no anchor on it — and close enough
     * that a first kunai throw is not a guess.
     */
    P.straw = [
      { x: x + 12, z: -6, reach: true },
      { x: x + 20, z: 8, reach: true },
      { x: x + 29, z: -5, reach: true },
      { x: x + 22, z: -1, reach: false, up: 15 },
    ];
    x += 44;
    yard.door = x;
    yard.to = x + 4;
    yard.checkpoint = [yard.at + 4, 0, 0];
    x += 12;

    // ── THE RING ──────────────────────────────────────────────────────────
    const ring = S('ring');
    ring.at = x;
    P.ringAt = { x: x + 22, z: 0, r: 22 };
    x += 48;
    ring.door = x;
    ring.to = x + 4;
    ring.checkpoint = [ring.at + 6, 0, 0];
    x += 12;

    // ── THE PIT ───────────────────────────────────────────────────────────
    const pit = S('pit');
    pit.at = x;
    P.pitAt = { x: x + 26, z: 0, r: 24 };
    x += 56;
    pit.door = x;
    pit.to = x + 4;
    pit.checkpoint = [pit.at + 4, 0, 0];
    x += 12;

    /**
     * ── THE RUN ─────────────────────────────────────────────────────────
     *
     * The second hole, and the victory lap: the same three gaps in the same
     * order they were taught, then a wall to kick off. No ground underneath
     * any of it.
     */
    const run = S('run');
    run.at = x;
    run.checkpoint = [x - 6, 0, 0];
    const runFrom = x + 2;
    x = runFrom;
    let ry = 2.0;
    const runHw = 3.5;
    for (let i = 0; i < 4; i++) {
      x += runHw;
      P.runPlats.push({ x, y: ry, hw: runHw });
      x += runHw;
      if (i < 3) x += GAP.hop;
      ry += 1.3;
    }
    x += GAP.dash;
    x += 5;
    P.runDash = { x, y: ry, hw: 5 };
    x += 5;
    for (let i = 0; i < 2; i++) {
      x += GAP.tongue;
      x += 3.0;
      P.runPosts.push({ x, y: ry + 8 + i * 3, hw: 3.0 });
      x += 3.0;
    }
    /**
     * The wall, HIGHER than the last post you swung off.
     *
     * That is what makes it a wall-jump rather than a step: coming off the
     * last anchor you arrive below its top, so there is nothing to do but
     * hold into it and press SPACE. Its ledge is four below the top, which
     * one kick clears.
     */
    x += 16;
    const lastPost = P.runPosts[P.runPosts.length - 1];
    P.wall = { x: x + 2, y: lastPost.y + 6, hw: 2, ledge: x + 9 };
    x = P.wall.ledge + 5;
    P.runRamp = { from: x, y: P.wall.y - 4 };
    x += 20;
    P.holes.push([runFrom - 2, x - 2]);
    run.to = x - 6;

    // ── THE PLAZA, THE WARDEN AND THE GATE ────────────────────────────────
    const warden = S('warden');
    warden.at = x;
    P.plazaAt = { x: x + 22, z: 0, r: 24 };
    x += 46;
    warden.door = x;
    warden.to = x + 4;
    warden.checkpoint = [P.plazaAt.x - 14, 0, 0];
    x += 14;
    P.gate = x;
    P.east = x + 10;
    return P;
  }

  // ───────────────────────────────────────────────────────────────── build ──

  buildTasks() {
    return [
      ['Finding the island', () => this._begin()],
      ['Laying the ground', () => { this._floor(); this._water(); }],
      ['Growing the palms', () => { this._palms(); this._arch(); }],
      ['Building the steps', () => { this._steps(); this._chasm(); }],
      ['Sinking the posts', () => { this._posts(); this._yard(); }],
      ['Drawing the ring', () => { this._ring(); this._pit(); }],
      ['Setting the course', () => { this._run(); this._plaza(); }],
      ['Waking the old frog', () => { this._master(); this._finishBuild(); }],
    ];
  }

  build() { for (const [, fn] of this.buildTasks()) fn(); return this; }

  _begin() {
    /**
     * A flat terrain a long way down, and a collision world over it.
     *
     * Everything walkable on this island is a BOX. The terrain exists only
     * because `CollisionWorld` wants one, and to catch anybody who leaves
     * the island entirely — see `voidY`.
     */
    this.terrain = new Terrain(1400, 25, () => this.at.y - 400);
    this._collision = new CollisionWorld(this.terrain);
    const own = (m) => { this.owned.push(m); return m; };
    const L = (c, o) => own(new THREE.MeshLambertMaterial(
      Object.assign({ color: c }, o || {})));
    this.mats = {
      // One white Lambert for everything solid; the per-instance colour does
      // the sand, the grass, the stone and the straw between them.
      solid: L(0xffffff),
      water: L(0x2f8fbe, { transparent: true, opacity: 0.7,
        depthWrite: false }),
      glow: own(new THREE.MeshBasicMaterial({ color: 0x8fe8ff, fog: false })),
      lamp: own(new THREE.MeshBasicMaterial({ color: 0xffd76b, fog: false })),
    };
    const geo = (g) => { this.owned.push(g); return g; };
    this.b = {
      box: new Batch(geo(new THREE.BoxGeometry(1, 1, 1)), this.mats.solid),
      blob: new Batch(geo(new THREE.SphereGeometry(1, 8, 6)), this.mats.solid),
      rod: new Batch(geo(new THREE.CylinderGeometry(1, 1, 1, 8)),
        this.mats.solid),
      cone: new Batch(geo(new THREE.ConeGeometry(1, 1, 7)), this.mats.solid),
      lamp: new Batch(geo(new THREE.SphereGeometry(1, 7, 5)), this.mats.lamp),
      glow: new Batch(geo(new THREE.SphereGeometry(1, 8, 6)), this.mats.glow),
    };
  }

  /** Over one of the holes in the floor? */
  overHole(x) {
    for (const [a, b] of this.plan.holes) if (x > a && x < b) return true;
    return false;
  }

  /** A collider, from local coordinates. */
  _solid(x, y, z, hx, hy, hz, tag) {
    return this._collision.addBox(this.at.x + x, this.at.y + y, this.at.z + z,
      hx, hy, hz, tag || 'stone');
  }

  _anchor(x, y, z, r) {
    this._collision.addAnchor(this.at.x + x, this.at.y + y, this.at.z + z, r);
  }

  /** A platform: a slab, a paler top, and a deck collider. */
  _plat(x, y, hw, hz, col) {
    this.b.box.add(x, y - 1.0, 0, hw * 2, 2.0, hz * 2, col || 0x8a8172);
    this.b.box.add(x, y + 0.08, 0, hw * 2 - 0.6, 0.3, hz * 2 - 0.6, 0x9a9182);
    this._solid(x, y - 1.0, 0, hw, 1.0, hz, 'deck');
  }

  /**
   * THE ISLAND FLOOR, as a grid of cells with holes cut in it.
   *
   * A grid rather than a few big plates because the two movement stretches
   * need actual holes and a plate cannot have one. Twelve-unit cells: coarse
   * enough that the whole island is one draw call and a few hundred
   * colliders, fine enough that a hole's edge reads as an edge.
   *
   * Sand at the rim, a band of wet sand, grass inside — three colours picked
   * per cell from its distance to the water, which is the entire beach.
   */
  _floor() {
    const R = this.rnd;
    const C = ISLE.cell;
    const nx = Math.ceil((ISLE.spine + ISLE.half) / C) + 1;
    const nz = Math.ceil(ISLE.half / C) + 1;
    let cells = 0;
    for (let ix = -nx; ix <= nx; ix++) {
      for (let iz = -nz; iz <= nz; iz++) {
        const x = ix * C, z = iz * C;
        if (!onIsland(x, z) || this.overHole(x)) continue;
        const dx = Math.max(0, Math.abs(x) - ISLE.spine);
        const edge = 1 - Math.hypot(dx, z) / ISLE.half;
        let col;
        if (edge < 0.10) col = R() < 0.5 ? 0xcbb98a : 0xd8c79a;
        else if (edge < 0.19) col = 0xb7a377;
        else col = [0x4f8f38, 0x5c9c3f, 0x468030, 0x639f45][
          Math.floor(R() * 4)];
        // A cell's top is y = 0 exactly. Nothing on this island slopes.
        this.b.box.add(x, -1.4 - R() * 0.3, z, C + 0.4, 2.8, C + 0.4, col);
        this._solid(x, -1.4, z, C * 0.5 + 0.2, 1.4, C * 0.5 + 0.2, 'deck');
        cells++;
      }
    }
    this.floorCells = cells;
    /**
     * And a skirt of rock under the rim, so the island has a thickness and
     * does not read as a green rug lying on the sea.
     */
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      const px = Math.sign(dx) * ISLE.spine + dx * ISLE.half * 0.97;
      const pz = dz * ISLE.half * 0.97;
      this.b.blob.add(px, -4 - R() * 5, pz,
        9 + R() * 7, 5 + R() * 6, 9 + R() * 7,
        R() < 0.5 ? 0x8a8172 : 0x6f6a5c, R() * 3);
    }
  }

  /**
   * THE SEA.
   *
   * A visual plane and nothing else: there is no swimming on this island.
   * Falling in is a mistake being corrected and the correction is a
   * checkpoint — see `_fell`. Making it swimmable would turn a missed jump
   * into a two-minute swim, which teaches patience rather than jumping.
   */
  _water() {
    const geo = new THREE.CircleGeometry(900, 44);
    this.owned.push(geo);
    const m = new THREE.Mesh(geo, this.mats.water);
    m.rotation.x = -Math.PI / 2;
    m.position.y = ISLE.water;
    m.renderOrder = 2;
    this.root.add(m);
    this.sea = m;
    const R = this.rnd;
    // Surf where the water meets the sand.
    for (let i = 0; i < 260; i++) {
      const a = R() * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      const px = Math.sign(dx) * ISLE.spine + dx * (ISLE.half + 1 + R() * 9);
      const pz = dz * (ISLE.half + 1 + R() * 9);
      this.b.box.add(px, ISLE.water + 0.35, pz,
        5 + R() * 7, 0.4, 5 + R() * 7, 0xdff0ff, R() * 3);
    }
    /**
     * And foam over the holes — which is what tells a player standing at the
     * near edge that the thing in front of them has water in it rather than
     * being a hole in the world.
     */
    for (const [a, b] of this.plan.holes) {
      for (let i = 0; i < 90; i++) {
        const px = a + R() * (b - a);
        const pz = (R() - 0.5) * ISLE.half * 1.9;
        if (!onIsland(px, pz)) continue;
        this.b.box.add(px, ISLE.water + 0.3, pz,
          4 + R() * 6, 0.35, 4 + R() * 6, 0xcfe6f4, R() * 3);
      }
    }
  }

  /** Palms, grass and rocks, everywhere the walked line is not. */
  _palms() {
    const R = this.rnd;
    for (let i = 0; i < 120; i++) {
      const x = (R() - 0.5) * 2 * (ISLE.spine + ISLE.half * 0.8);
      const z = (R() - 0.5) * 2 * ISLE.half * 0.94;
      if (!onIsland(x, z) || this.overHole(x)) continue;
      // Never on the line down the middle the player actually walks.
      if (Math.abs(z) < 30) continue;
      const h = 9 + R() * 9;
      const lean = (R() - 0.5) * 0.34;
      this.b.rod.add(x, h * 0.5, z, 0.6, h, 0.6, 0x7a5a3a, R() * 3, 0, lean);
      this._solid(x - Math.sin(lean) * h * 0.4, h * 0.4, z,
        0.9, h * 0.5, 0.9, 'tree');
      const tx = x - Math.sin(lean) * h, ty = h;
      for (let f = 0; f < 6; f++) {
        const fa = (f / 6) * Math.PI * 2 + R();
        this.b.cone.add(tx + Math.cos(fa) * 3.4, ty + 0.6,
          z + Math.sin(fa) * 3.4, 1.5, 5.5, 1.5,
          R() < 0.5 ? 0x3f7a30 : 0x4f9f38, -fa, 1.25, 0);
      }
      for (let k = 0; k < 2; k++) {
        this.b.blob.add(tx + (R() - 0.5) * 1.6, ty - 0.4,
          z + (R() - 0.5) * 1.6, 0.6, 0.6, 0.6, 0x5a4230);
      }
    }
    for (let i = 0; i < 1400; i++) {
      const x = (R() - 0.5) * 2 * (ISLE.spine + ISLE.half * 0.9);
      const z = (R() - 0.5) * 2 * ISLE.half * 0.96;
      if (!onIsland(x, z) || this.overHole(x)) continue;
      const h = 0.7 + R() * 1.1;
      this.b.box.add(x, h * 0.5, z, 0.1, h, 0.1,
        R() < 0.5 ? 0x6b9a45 : 0x86bc55, R() * 3, (R() - 0.5) * 0.4, 0);
    }
    for (let i = 0; i < 80; i++) {
      const x = (R() - 0.5) * 2 * (ISLE.spine + ISLE.half * 0.9);
      const z = (R() - 0.5) * 2 * ISLE.half * 0.9;
      if (!onIsland(x, z) || this.overHole(x) || Math.abs(z) < 26) continue;
      const s = 0.8 + R() * 1.8;
      this.b.blob.add(x, s * 0.3, z, s, s * 0.7, s, 0x8a8172, R() * 3);
      if (s > 1.6) this._solid(x, s * 0.3, z, s * 0.7, s * 0.4, s * 0.7, 'rock');
    }
  }

  /**
   * THE ARCH the first objective points at, and a signpost at every station.
   *
   * The arch exists to be a thing you are told to walk to: it is the first
   * instruction in the game, so it is nine units tall, gold underneath and
   * visible from where you wake up.
   */
  _arch() {
    const AX = this.plan.arch;
    for (const sd of [-1, 1]) {
      this.b.box.add(AX, 4.5, sd * 5, 2.2, 9, 2.2, 0xd8cfae);
      this._solid(AX, 4.5, sd * 5, 1.2, 4.5, 1.2, 'stone');
      this.b.lamp.add(AX, 10.9, sd * 5, 0.9, 1.0, 0.9, 0xffd76b);
    }
    this.b.box.add(AX, 9.8, 0, 2.6, 1.6, 13, 0xe8e2c8);
    this.b.box.add(AX, 8.6, 0, 1.4, 0.7, 9.4, 0xd8ad2e);
    this._anchor(AX, 10, 0, 2.4);
    for (const s of this.stations) {
      const x = s.at - 5;
      if (this.overHole(x)) continue;
      this.b.rod.add(x, 2.2, -15, 0.32, 4.4, 0.32, 0x7a5a3a);
      this.b.box.add(x, 4.0, -15, 0.4, 1.1, 6.4, 0xd9c46a, 0.1);
      this._solid(x, 2.2, -15, 0.5, 2.2, 0.5, 'stone');
    }
  }

  /**
   * ═══ THE STEPS — jumping ════════════════════════════════════════════════
   *
   * Nine platforms rising out of the lagoon. The first six gaps are nine
   * units, which is inside a single jump — deliberately, because this is
   * where a player finds out what SPACE does and the first jump they ever
   * make should land. The last two open to fifteen, which one jump cannot
   * do, so the frog flip gets found by somebody who has not read the HUD.
   */
  _steps() {
    this.plan.steps.forEach((p, i) => {
      this._plat(p.x, p.y, p.hw, 5.5);
      if (i > 4) this.b.lamp.add(p.x, p.y + 1.6, 5.0, 0.5, 0.6, 0.5, 0xffd76b);
    });
  }

  /**
   * ═══ THE CHASM — dashing ════════════════════════════════════════════════
   *
   * Two tops at the height the steps left you at, with twenty-three units of
   * air before each. See `GAP`: that is past a frog flip and inside a jump
   * with a dash in it, which is what makes this station teach the dash
   * rather than reward the jump the player already has.
   */
  _chasm() {
    for (const p of this.plan.chasm) {
      this._plat(p.x, p.y, p.hw, 12);
      // A gold chevron pointing on. It is the only direction cue out there
      // and the gap is wide enough to want one.
      for (let k = -1; k <= 1; k++) {
        this.b.box.add(p.x + 2 - Math.abs(k) * 1.4, p.y + 0.3, k * 2.2,
          3.0, 0.24, 0.9, 0xd8ad2e);
      }
    }
  }

  /**
   * ═══ THE POSTS — the tongue ═════════════════════════════════════════════
   *
   * Three posts with lit anchors, thirty-four units apart. That is past a
   * dash and well inside the tongue's sixty-two, so there is exactly one way
   * across — and the anchors are the only lit things on this stretch, which
   * is how "aim at the lights" becomes an instruction needing no arrow.
   */
  _posts() {
    for (const p of this.plan.posts) {
      this.b.rod.add(p.x, p.y * 0.5 - 6, 0, p.hw * 0.62, p.y + 12,
        p.hw * 0.62, 0x7a6a58);
      this._solid(p.x, p.y * 0.5 - 6, 0, p.hw * 0.7, (p.y + 12) * 0.5,
        p.hw * 0.7, 'stone');
      this.b.box.add(p.x, p.y, 0, p.hw * 2, 1.4, p.hw * 2, 0x8a8172);
      this._solid(p.x, p.y, 0, p.hw, 0.7, p.hw, 'deck');
      /**
       * The anchor, three units above the cap so the tongue has clear air
       * round it, and generous — three units of radius — because this is
       * somebody's first grapple and a near miss teaches nothing.
       */
      this._anchor(p.x, p.y + 3.4, 0, 3.0);
      this.b.lamp.add(p.x, p.y + 3.4, 0, 1.1, 1.2, 1.1, 0xffd76b);
      this.b.glow.add(p.x, p.y + 3.4, 0, 2.0, 2.1, 2.0, 0x8fe8ff);
    }
    const L = this.plan.landing;
    this._plat(L.x, L.y, L.hw, 13);
    for (const st of this.plan.stair) {
      this.b.box.add(st.x, st.y - 1.6, 0, 3.6, 3.2, 22, 0x8a8172);
      this._solid(st.x, st.y - 1.6, 0, 1.8, 1.6, 11, 'deck');
    }
  }

  /**
   * ═══ THE YARD — the katana, and the kunai ═══════════════════════════════
   *
   * Four straw targets behind a rail fence, with a stone door at the far
   * end — a straw man is the one station a player can simply walk past.
   *
   * The fourth stands on a post out past the north shore. That is the whole
   * lesson about the hotbar: there is a target you cannot walk to, and a key
   * that puts something in your hand which deals with it.
   */
  _yard() {
    const A = this.plan.yardAt;
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      if (Math.cos(a) < -0.55) continue;                  // the way in
      const x = A + Math.cos(a) * 22, z = Math.sin(a) * 22;
      this.b.rod.add(x, 0.9, z, 0.16, 1.8, 0.16, 0x7a5a3a);
      this.b.box.add(x, 1.3, z, 2.8, 0.14, 0.12, 0xd9c46a, -a - Math.PI / 2);
    }
    /**
     * The post the fourth target stands on.
     *
     * Deliberately smooth and deliberately unanchored: nothing on it can be
     * grappled and nothing jumps fifteen units, so the only thing that
     * reaches the top of it is a thrown blade.
     */
    const far = this.plan.straw[3];
    const h = far.up;
    this.b.rod.add(far.x, h * 0.5, far.z, 1.5, h, 1.5, 0x7a6a58);
    this._solid(far.x, h * 0.5, far.z, 1.7, h * 0.5, 1.7, 'stone');
    this.b.box.add(far.x, h - 0.4, far.z, 4.4, 1.0, 4.4, 0x8a8172);
    // A lamp under it, so the thing you cannot reach is the thing you see.
    this.b.lamp.add(far.x, h + 5.4, far.z, 0.8, 0.9, 0.8, 0xffd76b);
  }

  /**
   * ═══ THE RING — the parry ═══════════════════════════════════════════════
   *
   * A circle of sand with a low kerb and six lamp posts. A ring rather than
   * open grass because a parry lesson needs the player to STAY, and a fenced
   * circle is the only instruction that reliably says so.
   */
  _ring() {
    const A = this.plan.ringAt;
    for (let i = 0; i < 50; i++) {
      const a = (i / 50) * Math.PI * 2;
      const x = A.x + Math.cos(a) * A.r, z = Math.sin(a) * A.r;
      this.b.box.add(x, 0.4, z, 3.6, 0.9, 1.6, 0xa89a80, -a - Math.PI / 2);
      if (i % 8 === 0) {
        this.b.rod.add(x, 1.8, z, 0.36, 3.6, 0.36, 0x7a6a58);
        this.b.lamp.add(x, 3.9, z, 0.6, 0.7, 0.6, 0xffd76b);
        this._solid(x, 1.8, z, 0.5, 1.8, 0.5, 'stone');
      }
    }
    for (let i = 0; i < 110; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * (A.r - 1);
      this.b.box.add(A.x + Math.cos(a) * r, 0.12, Math.sin(a) * r,
        6, 0.3, 6, this.rnd() < 0.5 ? 0xcbb98a : 0xd8c79a, this.rnd() * 3);
    }
  }

  /**
   * ═══ THE PIT — three at once ════════════════════════════════════════════
   *
   * A walled square, not an actual pit: a hole would put the fight below the
   * camera and this is the first time the player has to watch three things at
   * once. The walls stop anything wandering off and stop the player backing
   * away for ever — the lesson is dashing THROUGH them, which needs
   * somewhere to dash to — and the parapet is grappleable, so it is not a
   * box you are stuck in.
   */
  _pit() {
    const A = this.plan.pitAt, r = A.r;
    for (const [ox, oz, w, d] of [
      [0, -r, r, 1.5], [0, r, r, 1.5], [r, 0, 1.5, r], [-r, 0, 1.5, r],
    ]) {
      if (ox === -r) {
        // The near wall has a gap in it: the way in.
        for (const sd of [-1, 1]) {
          this.b.box.add(A.x + ox, 2.0, sd * (r * 0.72), 3.0, 4.0, r * 0.56,
            0xa89a80);
          this._solid(A.x + ox, 2.0, sd * (r * 0.72), 1.6, 2.0, r * 0.28,
            'wall');
        }
        continue;
      }
      this.b.box.add(A.x + ox, 2.0, oz, w * 2 + 3, 4.0, d * 2 + 3, 0xa89a80);
      this._solid(A.x + ox, 2.0, oz, w + 1.5, 2.0, d + 1.5, 'wall');
      this.b.box.add(A.x + ox, 4.4, oz, w * 2 + 4, 0.8, d * 2 + 4, 0xc4bfae);
    }
    this.b.lamp.add(A.x, 7.0, 0, 1.2, 1.4, 1.2, 0xffd76b);
    this.b.glow.add(A.x, 7.0, 0, 2.2, 2.4, 2.2, 0x8fe8ff);
    this._anchor(A.x, 7.0, 0, 2.8);
  }

  /**
   * ═══ THE RUN — everything, in order ═════════════════════════════════════
   *
   * Four hops, one dash gap, two tongue posts, and a wall to kick off, over
   * the second hole in the island. The same three gaps in the same order the
   * island taught them, so it is a victory lap and not an exam.
   */
  _run() {
    const P = this.plan;
    for (const p of P.runPlats) this._plat(p.x, p.y, p.hw, 6);
    this._plat(P.runDash.x, P.runDash.y, P.runDash.hw, 8);
    for (const p of P.runPosts) {
      this.b.rod.add(p.x, p.y * 0.5 - 4, 0, p.hw * 0.6, p.y + 8, p.hw * 0.6,
        0x7a6a58);
      this._solid(p.x, p.y * 0.5 - 4, 0, p.hw * 0.65, (p.y + 8) * 0.5,
        p.hw * 0.65, 'stone');
      this._anchor(p.x, p.y + 2.6, 0, 3.0);
      this.b.lamp.add(p.x, p.y + 2.6, 0, 1.0, 1.1, 1.0, 0xffd76b);
      this.b.glow.add(p.x, p.y + 2.6, 0, 1.8, 1.9, 1.8, 0x8fe8ff);
    }
    /**
     * The wall, and a ledge on the far side of it.
     *
     * The one thing on the island only crossable by kicking off a wall,
     * which is the last movement verb the game has and the one players most
     * often never find. Its top is a metre above the ledge, so a straight
     * jump cannot clear it and a wall-jump can.
     */
    const W = this.plan.wall;
    this.b.box.add(W.x, W.y * 0.5, 0, W.hw * 2, W.y, 26, 0x8a8172);
    this._solid(W.x, W.y * 0.5, 0, W.hw, W.y * 0.5, 13, 'wall');
    this.b.box.add(W.x, W.y + 0.5, 0, W.hw * 2 + 1.2, 1.0, 27, 0xc4bfae);
    this._plat(W.ledge, W.y - 4, 5, 10);
    const R = this.plan.runRamp;
    for (let i = 0; i < 9; i++) {
      const h = R.y * (1 - i / 9);
      this.b.box.add(R.from + i * 2.1, h * 0.5, 0, 2.4, h + 0.6, 18, 0x8a8172);
      this._solid(R.from + i * 2.1, h * 0.5, 0, 1.2, (h + 0.6) * 0.5, 9,
        'deck');
    }
  }

  /**
   * ═══ THE PLAZA AND THE GATE ═════════════════════════════════════════════
   *
   * A ring of paving with gold inlay, six columns round it, and the gate at
   * the far end. Walking through the gate is the only thing on this island
   * that calls `onDone`.
   */
  _plaza() {
    const A = this.plan.plazaAt;
    for (let i = 0; i < 180; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * A.r;
      this.b.box.add(A.x + Math.cos(a) * r, 0.16, Math.sin(a) * r,
        6, 0.35, 6, this.rnd() < 0.5 ? 0xc4bfae : 0xb4ae9c, this.rnd() * 3);
    }
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      this.b.box.add(A.x + Math.cos(a) * 15, 0.32, Math.sin(a) * 15,
        2.4, 0.3, 1.0, 0xd8ad2e, -a);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const x = A.x + Math.cos(a) * (A.r - 2), z = Math.sin(a) * (A.r - 2);
      this.b.rod.add(x, 6, z, 1.4, 12, 1.4, 0xd8cfae);
      this.b.box.add(x, 12.4, z, 3.4, 1.0, 3.4, 0xe8e2c8);
      this._solid(x, 6, z, 1.7, 6, 1.7, 'stone');
      this._anchor(x, 12.6, z, 2.4);
      this.b.lamp.add(x, 13.4, z, 0.7, 0.8, 0.7, 0xffd76b);
    }
    /**
     * THE GATE — deliberately the same shape as the arch on the beach. You
     * came in under one and you leave under the other, and this one is twice
     * the size and lit blue so it can be seen from the far end of the plaza.
     */
    const GX = this.plan.gate;
    for (const sd of [-1, 1]) {
      this.b.box.add(GX, 6.5, sd * 6, 2.6, 13, 2.6, 0xe8e2c8);
      this._solid(GX, 6.5, sd * 6, 1.4, 6.5, 1.4, 'stone');
      this.b.glow.add(GX, 15.8, sd * 6, 1.4, 1.5, 1.4, 0x8fe8ff);
    }
    this.b.box.add(GX, 14.2, 0, 3.0, 2.2, 15, 0xf2ecdc);
    this.b.box.add(GX, 12.6, 0, 1.6, 0.9, 11, 0xd8ad2e);
    const geo = new THREE.PlaneGeometry(11, 12.5);
    this.owned.push(geo);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfe8ff, transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    this.owned.push(mat);
    const veil = new THREE.Mesh(geo, mat);
    veil.position.set(GX, 6.4, 0);
    veil.rotation.y = Math.PI / 2;
    this.root.add(veil);
    this.gateVeil = veil;
  }

  /**
   * THE OLD FROG, and the doors.
   *
   * Two of him, on the beach and at the gate, built once each — a frog who
   * walked seven hundred units alongside the player would need a whole
   * pathfinder to do badly what two statues do perfectly. His voice arrives
   * at every station on the banter channel instead. See `_teach`.
   */
  _master() {
    for (const [x, face] of [
      [this.plan.master, Math.PI / 2], [this.plan.gate - 6, -Math.PI / 2],
    ]) {
      addFrog(this.b, {
        x, y: 0, z: -8, s: 1.5, face,
        skin: 0x86a84e, cloth: 0xe8e4d6, trim: 0xd8ad2e,
        outfit: 'robed', detail: 'full', armPose: 'rest',
      });
    }
    for (const s of this.stations) {
      if (s.door === undefined) continue;
      this.doors.push(this._buildDoor(s.id, s.door));
    }
  }

  /**
   * ONE DOOR.
   *
   * Its own group so it can be moved, and its own collider so the collider
   * goes off in the same breath. Eleven units of stone across the path with
   * a gold band on it; it sinks into the ground when its station is cleared.
   */
  _buildDoor(id, x) {
    const g = new THREE.Group();
    this.root.add(g);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.owned.push(geo);
    const put = (sx, sy, sz, py, hex) => {
      const mat = new THREE.MeshLambertMaterial({ color: hex });
      this.owned.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, py, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    };
    put(3.0, 11, 26, 5.5, 0x9a9182);
    put(3.4, 1.2, 26, 10.6, 0xd8ad2e);
    put(3.4, 1.2, 26, 1.6, 0xa89a80);
    // The jambs stay up. Only the leaf sinks.
    for (const sd of [-1, 1]) {
      this.b.box.add(x, 7, sd * 14.5, 4.0, 14, 4.0, 0xd8cfae);
      this._solid(x, 7, sd * 14.5, 2.2, 7, 2.2, 'stone');
      this.b.lamp.add(x, 14.6, sd * 14.5, 0.8, 0.9, 0.8, 0xffd76b);
    }
    const box = this._solid(x, 5.5, 0, 1.6, 5.5, 13, 'wall');
    return { id, x, group: g, box, y: 0, open: false };
  }

  _finishBuild() {
    for (const k in this.b) this.b[k].build(this.root, k !== 'box');
    this._collision.bake();
    /**
     * A bright, high sun and a lot of bounce.
     *
     * The island is the first thing anybody ever sees of this game and it is
     * a holiday. It is the least moody light in the project on purpose.
     */
    this.lamp = new THREE.DirectionalLight(0xfff4e0, 1.2);
    this.lamp.position.set(this.at.x - 160, this.at.y + 260, this.at.z + 200);
    this.scene.add(this.lamp);
    this.fill = new THREE.HemisphereLight(0xdff0ff, 0x6f8f4a, 0.72);
    this.fill.position.set(this.at.x, this.at.y + 60, this.at.z);
    this.scene.add(this.fill);
  }

  // ───────────────────────────────────────────────────────────────── flow ──

  /**
   * Ground height in world space, for the mobs to walk on.
   *
   * Every mob on this island stands on a station floor and every station
   * floor is y = 0 — the pit is walled, not sunk, and the plaza is paved
   * level. So this is a constant, and saying so here is cheaper and far
   * more honest than a height field that would only ever return one number.
   */
  groundAt() { return this.at.y; }

  start(player) {
    this.index = 0;
    this.count = 0;
    this.finished = false;
    if (player) {
      player.pos.copy(this.spawnPoint);
      player.vel.set(0, 0, 0);
      player.health.revive();
    }
    this._enter(player);
  }

  /** Put the checkpoint down and begin a station. */
  _enter(player) {
    const s = this.station;
    if (!s) return;
    this.count = 0;
    this._checkpoint.set(this.at.x + s.checkpoint[0],
      this.at.y + s.checkpoint[1] + 1.2, this.at.z + s.checkpoint[2]);
    this._clearMobs();
    this.straw.length = 0;
    if (this.strawRoot) {
      this.root.remove(this.strawRoot);
      this.strawRoot = null;
    }
    if (s.id === 'yard') this._spawnStraw();
    if (s.id === 'ring') this._spawnRing();
    if (s.id === 'pit') this._spawnPit();
    if (s.id === 'warden') this._spawnWarden();
    this._teach(s, player);
    this._paint();
  }

  /**
   * SAY IT IN THREE PLACES, ONCE EACH.
   *
   * The title as a banner, the KEYS as the persistent HUD prompt — the one
   * with the badge round the key, which stays on screen for as long as the
   * station is live — the sentence as a toast, and the old frog's line on
   * the banter channel, which is the one that never blocks so it can arrive
   * while the player is already moving.
   */
  _teach(s, player) {
    if (this.hud) {
      this.hud.setTutorial(s.prompt[0], s.prompt[1], s.prompt[2]);
      if (!this._taught.has(s.id)) {
        this.hud.announce(s.title, 'divine', false);
        this.hud.toast(s.teach, 12);
      }
    }
    if (!this._taught.has(s.id)) {
      Cine.say('elder', s.master,
        { id: 'isle-' + s.id, secs: 7.5, priority: 2 });
    }
    this._taught.add(s.id);
    if (player && player.health) player.health.revive();
  }

  _paint() {
    if (!this.hud) return;
    const s = this.station;
    if (!s) {
      this.hud.setObjectives([{
        id: 'gate', text: 'Walk through the gate', done: false, active: true,
      }]);
      return;
    }
    const need = s.need || 0;
    const rows = [];
    // The two behind you, ticked, so the island shows its own progress.
    for (let i = Math.max(0, this.index - 2); i < this.index; i++) {
      rows.push({ id: this.stations[i].id, text: this.stations[i].title,
        done: true, active: false });
    }
    rows.push({
      id: s.id,
      text: need > 1 ? `${s.objective} — ${this.count} of ${need}`
        : s.objective,
      done: false, active: true,
    });
    this.hud.setObjectives(rows);
  }

  /** One station finished. Open its door, and move on. */
  _advance(player) {
    const s = this.station;
    if (!s) return;
    if (this.hud) this.hud.announce(s.title + ' — DONE', 'divine', false);
    const d = this.doors.find((x) => x.id === s.id);
    if (d && !d.open) {
      d.open = true;
      d.box.disabled = true;
      if (this.hud) this.hud.toast('The door goes down.', 3);
      Audio.tone && Audio.tone({ freq: 90, to: 50, dur: 1.1,
        type: 'sawtooth', volume: 0.18, pos: player ? player.pos : null });
    }
    this.index++;
    if (this.station) { this._enter(player); return; }
    // All nine behind you.
    this.count = 0;
    this._clearMobs();
    if (this.hud) {
      this.hud.setTutorial(null);
      this.hud.announce('THE GATE IS OPEN', 'divine', true);
      this.hud.toast('That is everything. Through the arch, and the '
        + 'Croaklands are yours.', 12);
    }
    Cine.say('elder', 'That is all I have. Go on — the country is that way.',
      { id: 'isle-end', secs: 9.0, priority: 3 });
    this._paint();
  }

  // ─────────────────────────────────────────────────────────── the enemies ──

  _clearMobs() {
    for (const m of this.mobs) m.dispose();
    this.mobs.length = 0;
  }

  /**
   * A STRAW TARGET.
   *
   * Not `TrainingDummy` from js/dummy.js: those are indestructible practice
   * posts and this station's objective is to DESTROY four of them. Same
   * `target()` shape the mobs use, so the katana and the kunai both find
   * them with no special case anywhere in the player controller.
   */
  _spawnStraw() {
    const g = new THREE.Group();
    this.root.add(g);
    this.strawRoot = g;
    const geo = {
      post: new THREE.CylinderGeometry(0.28, 0.34, 1, 7),
      body: new THREE.CylinderGeometry(0.9, 0.7, 1, 8),
      head: new THREE.SphereGeometry(1, 8, 6),
      bar: new THREE.BoxGeometry(1, 1, 1),
    };
    for (const k in geo) this.owned.push(geo[k]);
    const mats = {
      straw: new THREE.MeshLambertMaterial({ color: 0xc9b06a }),
      rope: new THREE.MeshLambertMaterial({ color: 0x8a6a3a }),
      wood: new THREE.MeshLambertMaterial({ color: 0x7a5a3a }),
    };
    for (const k in mats) this.owned.push(mats[k]);
    this.plan.straw.forEach((spot, i) => {
      const root = new THREE.Group();
      const y = spot.reach ? 0 : spot.up - 0.4;
      root.position.set(spot.x, y, spot.z);
      root.rotation.y = spot.reach ? -1.6 : -3.0;
      g.add(root);
      const put = (k, mk, sx, sy, sz, py) => {
        const m = new THREE.Mesh(geo[k], mats[mk]);
        m.scale.set(sx, sy, sz);
        m.position.set(0, py, 0);
        m.castShadow = true;
        root.add(m);
      };
      put('post', 'wood', 1, 3.0, 1, 1.5);
      put('body', 'straw', 1, 1.8, 1, 2.4);
      put('head', 'straw', 0.62, 0.6, 0.62, 3.6);
      put('bar', 'wood', 3.4, 0.22, 0.22, 2.9);
      put('bar', 'rope', 1.0, 0.16, 1.0, 2.9);
      this.straw.push({
        id: 'straw-' + i,
        root,
        pos: new THREE.Vector3(this.at.x + spot.x, this.at.y + y,
          this.at.z + spot.z),
        health: 44,
        dead: false,
        reach: spot.reach,
        wobble: 0,
      });
    });
  }

  /** The shape the katana and the kunai both test against. */
  _strawTarget(t) {
    return {
      id: t.id, pos: t.pos, dead: t.dead, isDummy: false,
      hitbox: {
        bodyOffset: 2.4, bodyRadius: 1.4,
        headOffset: 3.6, headRadius: 0.8,
        vertical: 4.2,
      },
      onHit: (dmg) => this._hitStraw(t, dmg),
    };
  }

  _hitStraw(t, dmg) {
    if (t.dead) return;
    t.health -= dmg;
    t.wobble = 1;
    _at.copy(t.pos); _at.y += 2.4;
    this.effects.hitBurst(_at, { x: 0, y: 0, z: 1 }, dmg > 26);
    if (t.health > 0) return;
    t.dead = true;
    t.root.visible = false;
    this.effects.deathBurst(_at, 0xc9b06a);
    this.count++;
    const s = this.station;
    if (this.hud && s) {
      const left = (s.need || 1) - this.count;
      this.hud.toast(left > 0
        ? `Straw down. ${left} to go.`
        : 'All four. The door goes down.', 2.2);
      // And the nudge toward the one you cannot reach, exactly when it
      // becomes the only one left.
      if (left === 1 && this.straw[3] && !this.straw[3].dead) {
        this.hud.toast('The last one is out over the water. Press 2 for a '
          + 'kunai and throw it with LEFT CLICK.', 9);
      }
    }
    this._paint();
  }

  /**
   * THE ONE IN THE RING.
   *
   * A Stone Warden at tier zero: the slowest thing in the mob table, the
   * longest reach, and seven damage a blow. Its wind-up paints the whole
   * hitbox on the ground for over half a second before it lands, which is
   * exactly what a parry is for and exactly what the objective says to watch.
   *
   * It is UNKILLABLE, and that is not laziness. The objective is three
   * parries; a player who kills it in four swings has skipped the lesson and
   * shut themselves behind a door that only parries open.
   */
  _spawnRing() {
    const A = this.plan.ringAt;
    const m = new Mob('stonewarden', 0,
      { x: this.at.x + A.x, y: this.at.y, z: this.at.z + A.z },
      this.scene, this.effects, () => this.groundAt());
    m.maxHealth = 1e9;
    m.health = 1e9;
    m.unkillable = true;
    this.mobs.push(m);
  }

  _spawnPit() {
    const A = this.plan.pitAt;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this.mobs.push(new Mob(['lurker', 'thornling', 'reedstalker'][i], 0,
        { x: this.at.x + A.x + Math.cos(a) * 11, y: this.at.y,
          z: this.at.z + A.z + Math.sin(a) * 11 },
        this.scene, this.effects, () => this.groundAt()));
    }
  }

  /**
   * THE WARDEN.
   *
   * A City Husk at tier two — six times the health of anything else on the
   * island, a great sword, and sixteen damage a blow. Still telegraphed,
   * still leashed to the plaza, and still impossible to lose to: going down
   * puts you back on the plaza with a full bar and him back at full health.
   */
  _spawnWarden() {
    const A = this.plan.plazaAt;
    const m = new Mob('cityhusk', 2,
      { x: this.at.x + A.x + 12, y: this.at.y, z: this.at.z + A.z },
      this.scene, this.effects, () => this.groundAt());
    m.maxHealth = 220;
    m.health = 220;
    this.mobs.push(m);
    if (this.hud) {
      this.hud.showBossBar('THE WARDEN OF THE FIRST ISLAND', 1,
        'He was here before the island had a name.');
    }
  }

  /** Everything the player's katana and kunai may hit this frame. */
  targets(list) {
    for (const t of this.straw) if (!t.dead) list.push(this._strawTarget(t));
    for (const m of this.mobs) {
      if (m.alive) list.push(m.target(() => this._mobDied(m)));
    }
    return list;
  }

  _mobDied(m) {
    if (m.counted) return;
    m.counted = true;
    const s = this.station;
    if (s && s.kind === 'kill') {
      this.count++;
      if (this.hud) {
        const left = (s.need || 1) - this.count;
        if (left > 0) this.hud.toast(`Down. ${left} left.`, 2.0);
      }
      this._paint();
    }
  }

  /**
   * A BLOW LANDING ON THE PLAYER — and where the parry lesson is counted.
   *
   * Routed through the player's own guard rather than keeping a softer copy,
   * so the lockout after a turned blow applies here exactly as it does in
   * the dungeon and the open world. See `Player._parryTook`.
   */
  playerHit(player, damage) {
    if (player.health.dead || player.health.protected) return;
    /**
     * A dash has i-frames. Not a parry, but the right answer — and calling
     * it out by name is how the pit's lesson ("both work") gets taught by
     * the player doing it rather than by a paragraph.
     */
    if (player.dashTimer > 0) {
      if (this.hud) this.hud.toast('DODGED', 0.8);
      return;
    }
    if (player.parrying) {
      player.justParried = 0.2;
      player._parryTook();
      Audio.parry(player.pos);
      if (this.followCam) this.followCam.shake(0.25);
      const s = this.station;
      if (s && s.kind === 'parry') {
        this.count++;
        const left = (s.need || 1) - this.count;
        if (this.hud) {
          this.hud.toast(left > 0
            ? `PARRIED — ${this.count} of ${s.need}. Guard again.`
            : 'PARRIED. That is three, and that is the hardest thing in '
              + 'this game.', left > 0 ? 2.4 : 5);
        }
        this._paint();
      } else if (this.hud) this.hud.toast('PARRIED', 0.8);
      return;
    }
    player.health.damage(damage, 'island');
    _at.set(player.pos.x, player.pos.y + 1.2, player.pos.z);
    this.effects.damageNumber(_at, damage, damage > 30);
    if (this.hud) this.hud.damageFlash(clamp(damage / 60, 0.3, 1));
    if (this.followCam) this.followCam.shake(clamp(damage / 40, 0.3, 1.0));
    Audio.hurt(player.pos);
    /**
     * And a word about it, the first time only. Being hit for the first time
     * is the moment a player is most likely to be told something useful and
     * least likely to want a paragraph.
     */
    if (!this._toldHurt) {
      this._toldHurt = true;
      if (this.hud) {
        this.hud.toast('That is what being hit feels like. The red ring on '
          + 'the ground was the warning.', 9);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────── update ──

  /**
   * One frame of the island.
   *
   * @param held { skip } — whether the leave-the-island key is down
   */
  update(dt, player, held) {
    this.t += dt;
    if (this.gateVeil) {
      this.gateVeil.material.opacity = 0.2 + Math.sin(this.t * 2.2) * 0.08
        + (this.station ? 0 : 0.14);
    }
    // The doors sink, and stay down.
    for (const d of this.doors) {
      if (!d.open || d.y <= -11.4) continue;
      d.y = Math.max(-11.6, d.y - dt * 7);
      d.group.position.y = d.y;
    }
    for (const t of this.straw) {
      if (t.wobble <= 0) continue;
      t.wobble = Math.max(0, t.wobble - dt * 2.4);
      t.root.rotation.z = Math.sin(t.wobble * 24) * t.wobble * t.wobble * 0.5;
    }
    for (const m of this.mobs) {
      m.update(dt, player, (dmg) => this.playerHit(player, dmg));
      // A sparring partner that cannot be killed still has to look hurt.
      if (m.unkillable && m.health < m.maxHealth) m.health = m.maxHealth;
    }
    const s = this.station;
    if (s && s.id === 'warden' && this.mobs[0] && this.hud) {
      const w = this.mobs[0];
      this.hud.setBossBar(Math.max(0, w.health / w.maxHealth));
    }
    this._fell(player);
    this._checkStation(player);
    this._skip(dt, held);
  }

  /**
   * FELL IN THE WATER, OR WENT DOWN.
   *
   * Both do the same thing: back to the checkpoint, full health, and a word
   * about it. There is no failure state anywhere on this island — see the
   * file header — and this is the function that makes that true.
   */
  _fell(player) {
    const local = player.pos.y - this.at.y;
    const drowned = local < ISLE.wet;
    if (!drowned && !player.health.dead) return;
    player.pos.copy(this._checkpoint);
    player.vel.set(0, 0, 0);
    if (player.grapple && player.grapple.active) player.grapple.release();
    player.dashTimer = 0;
    player.health.revive();
    if (this.followCam) this.followCam.snapTo(player.pos);
    if (player.deathPending) player.deathPending = false;
    /**
     * And everything that was chasing goes back where it started, so a
     * player who went down does not respawn into the same swing.
     */
    for (const m of this.mobs) {
      if (!m.alive) continue;
      m.pos.copy(m.home);
      m.state = 0;
      m.timer = 1.4;
      m.health = m.maxHealth;
    }
    if (this.hud) {
      this.hud.toast(drowned
        ? 'Back on dry land. Go again.'
        : 'Up you get. Nothing on this island can finish you.', 3.5);
    }
  }

  /** Is the live station finished? */
  _checkStation(player) {
    const s = this.station;
    const x = player.pos.x - this.at.x;
    if (!s) {
      if (!this.finished && x > this.plan.gate) {
        this.finished = true;
        if (this.hud) {
          this.hud.setObjectives([]);
          this.hud.setTutorial(null);
        }
        this.onDone('finished');
      }
      return;
    }
    switch (s.kind) {
      case 'reach':
        if (x > s.to) this._advance(player);
        break;
      case 'land':
        /**
         * Past the line AND up at the platform's height, so falling into the
         * lagoon short of the top does not count as having climbed it —
         * which, with the checkpoint back at the arch, it otherwise would
         * the moment the player drifted east while falling.
         */
        if (x > s.to && player.pos.y - this.at.y > (s.y || 0) - 3) {
          this._advance(player);
        }
        break;
      case 'break':
      case 'parry':
      case 'kill':
        if (this.count >= (s.need || 1)) {
          if (s.id === 'warden' && this.hud) this.hud.hideBossBar();
          this._advance(player);
        }
        break;
      default: break;
    }
  }

  /**
   * ═══ SKIPPING ══════════════════════════════════════════════════════════
   *
   * Held for a second and a half, never tapped, and only offered once the
   * first station is behind you — so the option is found by somebody who has
   * seen what it is they would be skipping, and nobody leaves the tutorial
   * by leaning on a key.
   */
  _skip(dt, held) {
    if (this.finished || this.index < 1) return;
    const down = !!(held && held.skip);
    if (!down) {
      if (this.skipHeld > 0 && this.hud) {
        // Put the station's own prompt back.
        const s = this.station;
        if (s) this.hud.setTutorial(s.prompt[0], s.prompt[1], s.prompt[2]);
        else this.hud.setTutorial(null);
      }
      this.skipHeld = 0;
      return;
    }
    this.skipHeld += dt;
    if (this.hud) {
      this.hud.setTutorial('LEAVING', 'BACKSPACE',
        `KEEP HOLDING — ${Math.round(Math.min(1, this.skipHeld / 1.5) * 100)}%`);
    }
    if (this.skipHeld < 1.5) return;
    this.skipHeld = 0;
    this.finished = true;
    if (this.hud) {
      this.hud.setObjectives([]);
      this.hud.setTutorial(null);
      this.hud.hideBossBar();
    }
    this.onDone('skipped');
  }

  dispose() {
    this._clearMobs();
    if (this.hud) {
      this.hud.setObjectives([]);
      this.hud.setTutorial(null);
      this.hud.hideBossBar();
    }
    this.scene.remove(this.root);
    if (this.lamp) this.scene.remove(this.lamp);
    if (this.fill) this.scene.remove(this.fill);
    for (const o of this.owned) {
      if (o && o.dispose) { try { o.dispose(); } catch (e) { /* gone */ } }
    }
    this.owned.length = 0;
    this.straw.length = 0;
    this.doors.length = 0;
  }
}
