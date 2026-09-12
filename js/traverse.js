/**
 * THE BROKEN ROADS — traversal that belongs to the world.
 *
 * Eight places in the Croaklands where the way through is gone and you have
 * to climb, swing or dash across what is left of it. None of them is a
 * parkour course, and the difference is not decoration — it is the whole
 * design, so it is worth stating as a rule:
 *
 *   EVERY PIECE IS ATTACHED TO SOMETHING.
 *
 * There is no floating platform anywhere in this file. A stone you jump to
 * is a pier of the bridge that fell, or an outcrop of the canyon wall, or a
 * root out of the bank, or a block off the parapet lying where it landed. A
 * rope you swing from is tied between two things that could hold a rope. A
 * beam is a beam off the span, with one end still on the abutment. Anything
 * that cannot be explained by what happened here does not get built.
 *
 * `anchor` on every piece names what holds it up, and `_piece` throws on a
 * name that is not in `ANCHORS` — where there is deliberately no `'none'`.
 * That is enforcement rather than good intentions, and it is the only
 * reason the rule will survive contact with the next eight sites.
 *
 * ── why the road is broken ───────────────────────────────────────────────
 * Because the sites are placed ON THE ROAD NETWORK, at real crossings, at
 * the road's own graded height. `Network.along(id, t)` gives a point on a
 * named road; a river crossing is found by intersecting the two polylines.
 * So the answer to "why is there an obstacle here" is never "because the
 * game wanted one": it is that this is where the King's Road crosses the
 * Long Croak, and the bridge that used to be here is in the river.
 *
 * And each one says so, three ways: a hoarding at the near end with the
 * reason on it, the abandoned carts and crates of the traffic that stopped,
 * and a line the frogs who live nearby will tell you about the route.
 *
 * ── failure is a ledge, not a death ─────────────────────────────────────
 * Every site has a CATCH — a bank, a shelf, a river, a lower terrace you
 * land on if you miss, with a ramp back up at the far end. `_catch` builds
 * it and the tests check every site has one. Missing a jump should cost the
 * climb again, not the last ten minutes. The other half of that is in
 * js/player.js: fall just short of a lip and you catch it and pull up.
 *
 * ── difficulty comes from the region ────────────────────────────────────
 * A site's gaps are sized by its region's tier: the Lilyreach gets hops a
 * standing jump clears, the Sunderway gets swings over two hundred units of
 * nothing. The numbers in `RUNG` are derived from the movement constants
 * rather than chosen — the same arithmetic the tutorial island uses, for
 * the same reason.
 *
 * ── and some of it is optional ──────────────────────────────────────────
 * Five of the eight have a spur: a harder line off the main route, always
 * visible from it, ending at a chest, a shrine or a shortcut. Nothing on
 * the critical path touches one, which the tests also check.
 */

import * as THREE from '../lib/three.module.js?v=v121';
import { clamp, mulberry32, lookYaw } from './util.js?v=v121';
import { REGION_BY_ID } from './regions.js?v=v121';
import { ROADS, RIVERS } from './roads.js?v=v121';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * ═══ THE RUNGS OF THE LADDER ════════════════════════════════════════════
 *
 * Edge-to-edge air, by what it takes to cross it.
 *
 * MEASURED, NOT DERIVED. These were first worked out on paper and the
 * paper was wrong — by a lot in the one case that mattered. The real
 * numbers come from integrating config.js's own constants the way
 * player.js integrates them, which is what scratchpad/probe_jump.mjs does
 * and what the test suite re-checks every run:
 *
 *   jump only            11.8   max rise 3.6
 *   jump + flip          22.2   max rise 5.7
 *   jump + dash          29.5
 *   jump + flip + dash   43.3
 *   tongue                 62   (grapple.range)
 *
 * The paper version had "flip + dash ≈ 31" and set the swing rung at 38 on
 * that basis — so every gap in the two hardest regions in the game, meant
 * to need the tongue, could be cleared with a dash. The reason the paper
 * was wrong is worth keeping: A DASH SUSPENDS GRAVITY. player.js skips the
 * whole gravity block while `dashTimer > 0`, so a dash mid-jump is 0.17 s
 * of level flight at 47 u/s inserted into the arc, and then the arc
 * continues from that height rather than from where it would have been.
 * It is worth about twelve units more than the arithmetic suggests.
 *
 * Each rung sits a real margin clear of the ability below it, because
 * these are out in the world rather than on a teaching island: a player
 * crossing a fallen bridge in the rain is not lining a jump up on a marked
 * platform.
 */
export const RUNG = {
  /** A standing jump clears it. Early roads, and every catch route. */
  step: 6,
  /** A running jump — 11.8 available. The first thing a road asks for. */
  hop: 10,
  /** Needs the flip: past 11.8, inside 22.2. */
  flip: 17,
  /** Needs a dash: past 22.2, inside 29.5. */
  dash: 27,
  /** Needs the tongue: past the 43.3 a flip and a dash together reach. */
  swing: 46,
  /** A long swing, for the last regions. Still ten clear of the 62 range. */
  reach: 52,
};

/** What a region's tier is allowed to ask for. Hardest first. */
const BY_TIER = {
  1: ['hop', 'step'],
  2: ['flip', 'hop', 'step'],
  3: ['dash', 'flip', 'hop'],
  4: ['swing', 'dash', 'flip'],
  5: ['reach', 'swing', 'dash'],
};

/**
 * How far away a site stops being drawn.
 *
 * NINE HUNDRED, WHICH IS A LONG WAY, AND DELIBERATELY.
 *
 * A traversal that only appears when you are already at it cannot do the
 * thing traversals are for, which is to put somewhere you can see above or
 * below you and let you work out that you can get there. The Sunderway's
 * pylons drop a hundred and twenty units into a chasm and the Cinder Stair
 * climbs forty up a cone; those are meant to be landmarks you walk toward,
 * not surprises. Nine hundred units is far enough that the Gap in the
 * Sunderway is on the skyline from the Ashen Throne road.
 *
 * It is affordable because of how the geometry is packed: the whole layer
 * is 38 instanced meshes and ~650 instances TOTAL across all eight sites,
 * so even every site resident at once is a rounding error. Drawing them
 * all unconditionally would work; the distance test is kept only so that
 * eight groups' worth of matrices are not walked every frame.
 */
const SHOW = 900;

/**
 * ═══ THE EIGHT ══════════════════════════════════════════════════════════
 *
 * `why` is the in-world reason, and it is not flavour text: it is on the
 * hoarding at the near end, it is what arriving tells you, and a test
 * asserts every site has one. If a site cannot be given a believable `why`
 * it does not belong in the world.
 *
 *   road/t     where on the road network it sits; `t` is 0..1 along it
 *   cross      instead of road/t: the river this road crosses, found by
 *              intersecting the two polylines
 *   kind       which builder runs
 *   spur       an optional harder line, and what is at the end of it
 *
 * ── ON WHERE THESE `t` VALUES CAME FROM ────────────────────────────────
 *
 * Not from taste. Every one was found by sweeping the named route at four
 * hundred points and taking the position that is inside the intended
 * region, out of the water, and FURTHEST from every settlement — see
 * scratchpad/probe_roads.mjs. Five of the eight I first typed by eye were
 * wrong, and wrong in ways that mattered: the Cinder Stair was three units
 * inside the village of Ashfall, the Falls of the Whisper were twelve
 * hundred units outside the Whispermire, and the Old Mountain Route was on
 * a road that does not enter the Moonshelf at any point along it.
 *
 * The bridge is the sharpest case. It was written as the King's Road
 * crossing the Long Croak, which sounds right and is impossible: roads.js
 * says in as many words that the Long Croak was deliberately routed WEST
 * of the King's Road, and the two never meet anywhere. The only river
 * crossings on the map with room around them are on the Glass Road, so
 * that is where the fallen bridge is — over the Whisper, in the Glassfen.
 *
 * The order below is the order a player meets them, and the tiers run
 * 0, 1, 1, 2, 3, 4, 5, 5.
 */
export const SITES = [
  {
    /**
     * THE FIRST ONE, a few hundred units out of the starting village on the
     * road east. Tier 0, so a running jump is the whole vocabulary.
     */
    id: 'fallen-mile', name: 'THE FALLEN MILE',
    region: 'lilyreach', kind: 'forest',
    road: 'woodroad', t: 0.210,
    why: 'Half a hillside of pines came down across the Wood Road in a gale '
      + 'and nobody has dug the road out from under them. You go over the '
      + 'trunks or you go round by the coast.',
    said: 'The Wood Road is shut. Windfall, a mile of it. Climb the trunks '
      + 'if you are in a hurry — the cutters do.',
  },
  {
    id: 'span-break', name: 'THE BREAK IN THE CUTTING',
    region: 'sunkenstair', kind: 'landslide',
    road: 'cuttersway', t: 0.430,
    why: 'The cutting collapsed onto the Cutter\'s Way and took thirty units '
      + 'of road with it. The quarry gangs shored the sides and went home.',
    said: 'The Cutter\'s Way is under a hill. They shored it and left it.',
  },
  {
    id: 'whisper-falls', name: 'THE FALLS OF THE WHISPER',
    region: 'whispermire', kind: 'waterfall',
    river: 'whisperflow', t: 0.738,
    why: 'The Whisper drops off a shelf of rock here. There is a slot in the '
      + 'cliff behind the water — the mire folk used it before the road.',
    said: 'There is a way up behind the falls. Wet, but it is a way up.',
    spur: { what: 'shrine',
      why: 'A shrine in the dry chamber behind the water, where they left '
        + 'offerings for the crossing.' },
  },
  {
    /**
     * THE FALLEN BRIDGE, on the one river crossing in the country with room
     * around it. See the note above about the King's Road.
     */
    id: 'drowned-crossing', name: 'THE DROWNED CROSSING',
    region: 'glassfen', kind: 'bridge',
    cross: { road: 'glassroad', river: 'whisperflow' },
    why: 'The bridge where the Glass Road crosses the Whisper went down in '
      + 'the spring flood and nobody has been sent to rebuild it. The piers '
      + 'are still standing.',
    said: 'You will not get a cart over the Whisper this year. The piers are '
      + 'still there, if you have got legs.',
    spur: { what: 'chest',
      why: 'A carter\'s strongbox, still lashed to the span that fell.' },
  },
  {
    id: 'drowned-keep-stair', name: 'THE STAIR IN THE DROWNED KEEP',
    region: 'drownedkeep', kind: 'keep',
    road: 'ashroad', t: 0.253,
    why: 'The keep\'s great stair fell in when the lake came up. The floors '
      + 'above it are still there, and so are the beams that held them.',
    said: 'The stair in the keep is gone. You can still get up it — through '
      + 'it, rather. Mind the floors.',
    spur: { what: 'chest',
      why: 'The pay-chest of the garrison, on the floor they never cleared.' },
  },
  {
    /**
     * ON THE COLD ROAD, NOT THE MOON ROAD.
     *
     * The Moon Road crosses the Moonshelf as a plateau: five units of fall
     * at sixty out, measured. A cliff route needs a cliff, and a ledge cut
     * into flat ground with ropes strung across nothing is the single most
     * obviously fake thing this file could contain. The Cold Road through
     * the Spine falls thirty-five units at forty-six out — a real shoulder
     * with real air under it — and the Spine is tier 4 either way.
     */
    id: 'old-mountain-road', name: 'THE OLD MOUNTAIN ROUTE',
    region: 'spine', kind: 'cliff',
    road: 'coldroad', t: 0.087,
    why: 'This was the main route between the two kingdoms before the Cold '
      + 'Road was cut. The pegs and the ropes are still in the cliff.',
    said: 'That was the road between the kingdoms, once. The ropes are old, '
      + 'but they were put in by people who meant them to hold.',
    spur: { what: 'shortcut',
      why: 'A ledge that carries on round the shoulder instead of down.' },
  },
  {
    id: 'cinder-stair', name: 'THE CINDER STAIR',
    region: 'cindermaw', kind: 'crumble',
    road: 'ashroad', t: 0.853,
    why: 'The basalt stair up the cone is still standing. Every few years '
      + 'another flight of it drops into the vents underneath.',
    said: 'The stair up the cone loses a flight a year. Do not stand about '
      + 'on it, and do not look down.',
  },
  {
    id: 'sunderway-gap', name: 'THE GAP IN THE SUNDERWAY',
    region: 'sunderway', kind: 'canyon',
    road: 'sunderroad', t: 0.855,
    why: 'A hundred units of the causeway are at the bottom of the chasm. '
      + 'Travellers strung ropes between the standing pylons, and enough of '
      + 'them got across that the ropes are still there.',
    said: 'The Sunderway has a hole in it you could put a village in. There '
      + 'are ropes. People have crossed on them. Some people.',
    spur: { what: 'chest',
      why: 'A courier\'s satchel on a pylon nobody had a reason to reach.' },
  },
];

/**
 * ═══ A LASHING, AND THE BEAM IT IS HOLDING ══════════════════════════════
 *
 * The one thing in this file you use the KUNAI on.
 *
 * A long timber stood on end and roped to a standing post, the way a
 * bridge gang parks a spare beam. Cut the rope — a thrown kunai from
 * across the gap, or the katana if you can reach it — and the beam comes
 * down across the obstacle and is a walkable bridge from then on.
 *
 * It is a SHORTCUT, never the route. Both sites that have one are provably
 * crossable without it (the reachability proof ignores optional pieces),
 * so a player who never works out what the rope is for loses nothing but
 * a few seconds. That matters: the spec this was built to says in as many
 * words not to force every ability into every section, and a mechanism
 * that gates a road on noticing a rope is exactly that mistake.
 *
 * ── how it works around the one-bake rule ──────────────────────────────
 * The broadphase is hashed once and never looks at a box added afterwards
 * (see js/collision.js), so the beam's colliders cannot be created when it
 * lands. They are created at BUILD time, in the position the beam will
 * end up in, and left `disabled` — which `query` does honour per-call.
 * Cutting the rope clears the flag. So the collider appears the frame the
 * beam arrives, with no rebake and no streamed layer.
 *
 * The beam itself is a real Group rather than instances, because it has to
 * rotate, and one extra draw call at two of eight sites is nothing.
 */
class Lashing {
  /**
   * @param site   the site it belongs to, for the frame
   * @param spec   { f, up, s, len, fall, tag } in the site's frame:
   *               where the post is, how high the rope is, how long the
   *               beam is, and which way along the road it falls (±1)
   */
  constructor(tv, site, spec) {
    this.tv = tv;
    this.site = site;
    this.spec = spec;
    this.id = `lash:${site.spec.id}`;
    this.cut = false;
    /** 0 standing, 1 flat. Eased in `update`. */
    this.k = 0;
    this.boxes = [];
    this.group = new THREE.Group();
    this.pos = new THREE.Vector3();
    /** Set once the beam has finished falling. */
    this.down = false;
  }

  /**
   * WHERE THE ROPE IS, in world space — which is the thing you aim at.
   *
   * Up at the top of the standing beam, so it is visible from across the
   * gap and reads as the thing holding the beam up.
   */
  knot() {
    return this.tv.worldOf(this.site, this.spec.f, this.spec.up, this.spec.s);
  }

  /** In the shape `Overworld.targets` and combat expect. */
  target() {
    const w = this.knot();
    this.pos.set(w.x, w.y, w.z);
    return {
      id: this.id,
      pos: this.pos,
      dead: this.cut,
      /**
       * `isDummy` so the KATANA reaches it too.
       *
       * Melee hits are events resolved by id and only dummies get their
       * `onHit` called directly (see Player._applyHits) — thrown kunai
       * call it either way. Without this flag the rope could be cut from
       * across the gap and not from arm's length, which is a strange rule
       * for a rope.
       */
      isDummy: true,
      hitbox: {
        bodyOffset: 0, bodyRadius: 1.6,
        headOffset: 0.6, headRadius: 1.2,
        vertical: 2.4,
      },
      onHit: () => this.release(),
    };
  }

  release() {
    if (this.cut) return false;
    this.cut = true;
    return true;
  }

  /** Ease the beam down, and hand it its colliders when it lands. */
  update(dt) {
    if (!this.cut || this.down) return;
    this.k = Math.min(1, this.k + dt / 1.1);
    this._place();
    if (this.k >= 1) {
      this.down = true;
      for (const b of this.boxes) b.disabled = false;
    }
  }

  /** Rotate the beam group from standing (k 0) to flat (k 1). */
  _place() {
    // Eased, so it starts slow and slams.
    const e = this.k * this.k;
    this.group.rotation.z = -(Math.PI / 2) * e;
  }
}

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

/**
 * WHERE A ROAD CROSSES A RIVER.
 *
 * Computed rather than typed, because a crossing IS the answer to "why is
 * there a bridge here" and a typed coordinate can drift away from the road
 * it was supposed to be on. Seventeen roads against four rivers is a few
 * hundred segment pairs, once, at load.
 *
 * @returns {x, z, t} the first intersection, or null
 */
export function findCrossing(roadId, riverId) {
  const road = ROADS.find((r) => r.id === roadId);
  const river = RIVERS.find((r) => r.id === riverId);
  if (!road || !river) return null;
  const spans = road.pts.length - 1;
  for (let i = 0; i < spans; i++) {
    const a = road.pts[i], b = road.pts[i + 1];
    for (let j = 0; j < river.pts.length - 1; j++) {
      const c = river.pts[j], d = river.pts[j + 1];
      const hit = segCross(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
      if (!hit) continue;
      /**
       * `t` IS IN NODE-INDEX SPACE, NOT ARC LENGTH.
       *
       * Because that is the space `Network.along` reads: it multiplies t by
       * `nodes.length - 1` and lerps between two adjacent nodes. Handing it
       * an arc-length fraction would put the crossing somewhere else along
       * the road entirely — further on wherever the early spans are shorter
       * than the late ones, which on the King's Road is most of it.
       */
      return { x: hit.x, z: hit.z, t: (i + hit.u) / spans };
    }
  }
  return null;
}

/** Where two segments meet, with `u` along the first. */
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az;
  const sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((cx - ax) * sz - (cz - az) * sx) / den;
  const t = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (u < 0 || u > 1 || t < 0 || t > 1) return null;
  return { x: ax + rx * u, z: az + rz * u, u };
}

export class Traversals {
  /**
   * @param scene  where they go
   * @param realm  for `heightAt`, `network` and the collision world
   */
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.owned = [];
    this.root = new THREE.Group();
    this.root.name = 'traversals';
    scene.add(this.root);
    /** Every built site. See `_site` for the shape. */
    this.sites = [];
    /** Colliders registered, for the cost checks. */
    this.solids = 0;
    /** Traversal pieces across all sites. Filled by `_finish`. */
    this.pieces = 0;
    this.rnd = mulberry32(0x7b0ade);
    this.t = 0;
  }

  // ───────────────────────────────────────────────────────────────── build ──

  /** One labelled step per site, so the loading bar moves. */
  buildTasks() {
    const tasks = [['Reading the old roads', () => this._begin()]];
    for (const spec of SITES) {
      tasks.push([`Breaking ${spec.name.toLowerCase()}`,
        () => this._site(spec)]);
    }
    tasks.push(['Leaving them broken', () => this._finish()]);
    return tasks;
  }

  /**
   * Standalone build, for tests and for anything that owns its own realm.
   *
   * The overworld does NOT use this: it folds `buildTasks()` into its own
   * loading list and bakes the broadphase once at the end, and a second
   * bake here would be wasted work rather than wrong.
   */
  build() {
    for (const [, fn] of this.buildTasks()) fn();
    this.realm.collision.bake();
    return this;
  }

  _begin() {
    const own = (m) => { this.owned.push(m); return m; };
    const geo = (g) => { this.owned.push(g); return g; };
    const L = (c, o) => own(new THREE.MeshLambertMaterial(
      Object.assign({ color: c }, o || {})));
    this.mats = {
      // One white Lambert for everything solid; the per-instance colour does
      // the stone, the timber, the rope and the moss between them.
      solid: L(0xffffff),
      water: L(0x2f6f8e, { transparent: true, opacity: 0.72,
        depthWrite: false }),
      spray: own(new THREE.MeshBasicMaterial({
        color: 0xdff0ff, transparent: true, opacity: 0.32,
        depthWrite: false, side: THREE.DoubleSide,
      })),
      glow: own(new THREE.MeshBasicMaterial({ color: 0xffd76b, fog: false })),
      // For the lashed beams, which are real meshes rather than instances
      // because they have to rotate — so they carry their own colour.
      timber: L(0x7a5a3a),
    };
    this.geos = {
      box: geo(new THREE.BoxGeometry(1, 1, 1)),
      blob: geo(new THREE.SphereGeometry(1, 8, 6)),
      rod: geo(new THREE.CylinderGeometry(1, 1, 1, 7)),
      cone: geo(new THREE.ConeGeometry(1, 1, 7)),
      plane: geo(new THREE.PlaneGeometry(1, 1)),
    };
  }

  /**
   * WHICH RUNGS THIS SITE MAY USE, hardest first.
   *
   * A region's tier decides, so the Lilyreach cannot ask for a swing and
   * the Sunderway is not made of hops. A builder generally wants `[0]` for
   * its headline gap and something easier for the rest.
   */
  _rungs(spec) {
    const R = REGION_BY_ID.get(spec.region);
    const tier = R ? R.tier : 1;
    const names = BY_TIER[clamp(tier, 1, 5)] || BY_TIER[1];
    return names.map((n) => ({ name: n, gap: RUNG[n] }));
  }

  /**
   * WHERE ON THE ROAD NETWORK THIS SITE SITS.
   *
   * A crossing is computed from the two polylines; everything else is a `t`
   * along a named road or river. Either way the height comes from the
   * GRADED network rather than from the raw terrain, so a site on a road
   * sits on the road and not in the cutting beside it.
   */
  _where(spec) {
    const net = this.realm.network;
    if (!net || !net.along) return null;
    let on = null;
    if (spec.cross) {
      const hit = findCrossing(spec.cross.road, spec.cross.river);
      if (!hit) return null;
      on = net.along(spec.cross.road, hit.t) || { x: hit.x, z: hit.z };
    } else {
      on = net.along(spec.road || spec.river, spec.t);
    }
    if (!on) return null;
    /**
     * ═══ THE HEIGHT IS THE GROUND, NOT THE NETWORK NODE ════════════════
     *
     * `along` returns the height the road or river was GRADED to, and for a
     * road that is the same thing as the ground — the corridor is flattened
     * to it, which the probe confirms to a tenth of a unit at all six road
     * sites.
     *
     * For a RIVER it is not remotely the same thing. A river's node height
     * is the top of its banks; the channel is then cut `depth` below that
     * (16 for the Long Croak, 12 for the Whisper). So the Falls of the
     * Whisper, placed at its river node, built its whole climb twelve units
     * up in the air over the channel floor — a staircase starting at first-
     * floor height with nothing under it.
     *
     * `heightAt` answers the question actually being asked, which is where
     * the player's feet will be, and it answers it correctly for both.
     */
    return { x: on.x, z: on.z, y: this.realm.heightAt(on.x, on.z) };
  }

  /**
   * ═══ WHERE THE GROUND IS, RELATIVE TO THE SITE ═════════════════════════
   *
   * The single most important thing a builder here can ask, and the one
   * this file originally did not ask at all.
   *
   * THE TERRAIN IS A HARD FLOOR. `CollisionWorld.moveCharacter` ends with
   * `if (pos.y <= th) pos.y = th`, unconditionally, everywhere. So a
   * platform below the ground is not a platform, it is a piece of scenery
   * inside a hill; and a hole in a road is not a hole, because the graded
   * road corridor is solid ground you walk straight across.
   *
   * The first version of these eight sites ignored both facts and paid for
   * it twice over: 115 of 259 pieces were under the dirt — including every
   * catch shelf, so the whole "a miss costs the climb, not the crossing"
   * mechanic was buried — and the four sites built as GAPS in a road could
   * be walked through along the road, which is the one failure mode that
   * makes an obstacle not an obstacle.
   *
   * What works instead, and what all eight now do:
   *
   *   BLOCK the road at ground level with something solid, and put the way
   *   past it ABOVE. Then the gaps are gaps in the air, which the terrain
   *   cannot fill in, and falling off lands you on the road, which is the
   *   friendliest catch there is and costs nothing to build.
   *
   *   Where a real drop is wanted, go OFF the corridor. The road is graded
   *   flat for about eleven units either side and then the ground does
   *   whatever the landscape does — at the Cinder Stair it falls sixty-six
   *   units at forty out, at the Sunderway forty-one. That is where a
   *   chasm crossing belongs, and `flank` below is how a builder finds it.
   */
  _ground(site, f, s) {
    const d = site.dir;
    return this.realm.heightAt(
      site.at.x + d.x * f - d.z * s,
      site.at.z + d.z * f + d.x * s) - site.y;
  }

  /**
   * HOW FAR OFF THE ROAD YOU HAVE TO GO FOR A REAL DROP, and which way.
   *
   * Sweeps both verges and returns the offset where the ground has fallen
   * at least `want` below the road, or null if this is flat country. The
   * sign is which side; the magnitude is how far out.
   */
  _flank(site, want) {
    let best = null;
    for (const sign of [1, -1]) {
      for (let a = 14; a <= 64; a += 2) {
        const g = this._ground(site, 0, sign * a);
        if (g > -want) continue;
        if (!best || a < Math.abs(best)) best = sign * a;
        break;
      }
    }
    return best;
  }

  /** The road's heading here, as a unit vector in the XZ plane. */
  _direction(spec) {
    const net = this.realm.network;
    const id = spec.cross ? spec.cross.road : (spec.road || spec.river);
    let t = spec.t === undefined ? 0.5 : spec.t;
    if (spec.cross) {
      const hit = findCrossing(spec.cross.road, spec.cross.river);
      if (hit) t = hit.t;
    }
    if (net && net.along) {
      const a = net.along(id, clamp(t - 0.03, 0, 1));
      const b = net.along(id, clamp(t + 0.03, 0, 1));
      if (a && b) {
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01) return { x: dx / d, z: dz / d };
      }
    }
    return { x: 1, z: 0 };
  }

  _site(spec) {
    const at = this._where(spec);
    if (!at) return;
    const g = new THREE.Group();
    g.position.set(at.x, 0, at.z);
    g.visible = false;
    this.root.add(g);

    const site = {
      spec, at, group: g,
      /**
       * WHICH WAY THE ROAD RUNS THROUGH HERE.
       *
       * Everything is laid out along it, so a fallen bridge lies across the
       * way you were walking rather than at some angle to it.
       */
      dir: this._direction(spec),
      /** The road's own graded height. Everything is `up` from this. */
      y: at.y,
      /** Every traversal piece, with what holds it up. See `_piece`. */
      pieces: [],
      /** Grapple targets, in this frame. See `_anchorAt`. */
      anchorList: [],
      /** Where the crossing starts and ends. See `_piece`. */
      entry: null,
      exit: null,
      /** How far below the route you land if you miss. See `_catch`. */
      catchY: null,
      anchors: 0,
      rungs: this._rungs(spec),
      /** The optional line, if this site has one. */
      spur: null,
      /** Lashed beams you cut with a kunai. See `_lash` and `Lashing`. */
      lashings: [],
      /** How long the obstacle is, for the distance checks. */
      span: 60,
    };
    this.sites.push(site);
    this._b = {
      box: new Batch(this.geos.box, this.mats.solid),
      blob: new Batch(this.geos.blob, this.mats.solid),
      rod: new Batch(this.geos.rod, this.mats.solid),
      cone: new Batch(this.geos.cone, this.mats.solid),
      lamp: new Batch(this.geos.blob, this.mats.glow),
    };

    // The story at the near end, before the obstacle itself.
    this._hoarding(site);
    switch (spec.kind) {
      case 'bridge': this._bridge(site); break;
      case 'forest': this._forest(site); break;
      case 'waterfall': this._waterfall(site); break;
      case 'landslide': this._landslide(site); break;
      case 'keep': this._keep(site); break;
      case 'cliff': this._cliff(site); break;
      case 'crumble': this._crumble(site); break;
      default: this._canyon(site); break;
    }
    for (const k in this._b) this._b[k].build(g, k !== 'lamp');
    this._b = null;
  }

  // ───────────────────────────────────────────────────────── the vocabulary ──

  /**
   * ═══ THE SITE'S OWN FRAME ══════════════════════════════════════════════
   *
   * `f` is along the road, `s` is across it, `up` is above the road's
   * graded height. So a builder writes "eleven units further on and six to
   * the left" and gets that whichever way the road runs.
   *
   * THE YAW. A part's local +X must end up pointing along the road. In
   * three.js a Y rotation of θ sends local +X to `(cos θ, 0, −sin θ)` and
   * local +Z to `(sin θ, 0, cos θ)`. Setting `cos θ = d.x` and
   * `sin θ = −d.z` satisfies the first and — checked, not assumed — sends
   * local +Z to `(−d.z, d.x)`, which is exactly the across axis used for
   * `s` two lines below. So:
   *
   *     θ = atan2(−d.z, d.x)
   *
   * and NOT `−atan2(d.x, d.z)`, which is a different angle everywhere but
   * the diagonals and is the z-mirrored answer — the same mistake that laid
   * every tangential city wall across itself. The sizes follow the frame
   * too: `sx` is the FULL extent along the road, `sz` across it.
   */
  _at(bat, site, f, up, s, sx, sy, sz, colour, roll) {
    const d = site.dir;
    bat.add(d.x * f - d.z * s, site.y + up, d.z * f + d.x * s,
      sx, sy, sz, colour, Math.atan2(-d.z, d.x), 0, roll || 0);
  }

  /**
   * ═══ A COLLIDER, IN THE SAME FRAME ═════════════════════════════════════
   *
   * `ha` is the half-extent ALONG the road and `hb` across it. But
   * colliders are strictly axis-aligned boxes — `addBox` has no rotation —
   * so a piece laid along a road that runs diagonally cannot be described
   * by one box. Two cases, and the split matters:
   *
   *   NEARLY SQUARE — a pier cap, a boulder, a platform. One box, grown to
   *   the rotated footprint. Worst case at 45° it is 41% wider than the
   *   thing it stands for, which on something you land on top of is a
   *   little invisible ledge round the edge and nothing worse.
   *
   *   LONG AND THIN — a beam, a walkway, a shored timber, a cliff face. A
   *   CHAIN of small overlapping cubes along it, which is what
   *   realmsites._solidRun does and for the reason it had to: one
   *   unrotated box two units deep standing for an eighteen-unit diagonal
   *   beam lies ACROSS the beam, and the beam becomes a hole you fall
   *   through everywhere except due north.
   */
  _solid(site, f, up, s, ha, hy, hb, tag, out) {
    const d = site.dir;
    const x = site.at.x + d.x * f - d.z * s;
    const z = site.at.z + d.z * f + d.x * s;
    const y = site.y + up;
    const col = this.realm.collision;
    const c = Math.abs(d.x), sn = Math.abs(d.z);
    const long = Math.max(ha, hb), short = Math.min(ha, hb);

    /**
     * ═══ A WALKABLE SURFACE IS TILED, NOT APPROXIMATED ═════════════════
     *
     * Because the growth on a diagonal is not a rounding error at the
     * sizes a floor comes in. The Drowned Keep's floor slabs are 11 by 6;
     * on a road running north-east one axis-aligned box standing for one
     * of them is twelve units to a side, and a slab held back to s = −8 to
     * leave a slot down the middle of the tower reached right across that
     * slot and roofed the ramp climbing through it. Nothing about the
     * intended geometry was wrong; the box standing for it was.
     *
     * So anything tagged 'deck' — the tag for every surface in this file
     * that a frog stands on — is tiled with cells no more than 1.8 to a
     * side, whose worst-case growth is 2.5 instead of 12. Barriers keep
     * the cheap approximation: 'cliff', 'wall' and 'stone' are things you
     * are stopped by, and a fat box inside a mountain is invisible.
     */
    const Q = 1.8;
    if (tag === 'deck' && (ha > Q || hb > Q)) {
      const na = Math.max(1, Math.ceil(ha / Q));
      const nb = Math.max(1, Math.ceil(hb / Q));
      if (na * nb <= 150) {
        const qa = ha / na, qb = hb / nb;
        const hx = qa * c + qb * sn, hz = qa * sn + qb * c;
        let first = null;
        for (let i = 0; i < na; i++) {
          const ff = ha * (-1 + (2 * i + 1) / na);
          for (let j = 0; j < nb; j++) {
            const ss = hb * (-1 + (2 * j + 1) / nb);
            this.solids++;
            const b = col.addBox(
              x + d.x * ff - d.z * ss, y, z + d.z * ff + d.x * ss,
              hx, hy, hz, 'deck');
            if (out) out.push(b);
            if (!first) first = b;
          }
        }
        return first;
      }
    }

    if (long <= short * 1.6) {
      this.solids++;
      const b = col.addBox(x, y, z, ha * c + hb * sn, hy, ha * sn + hb * c,
        tag || 'stone');
      if (out) out.push(b);
      return b;
    }
    const ax = ha >= hb ? d.x : -d.z;
    const az = ha >= hb ? d.z : d.x;
    /**
     * THE CHAIN SPANS `long`, NOT `long + short`.
     *
     * Each cube is `short` in half-extent, so the outermost centres go to
     * `long − short` and the chain's outer faces land exactly on ±long.
     * Running the centres out to ±long instead — which is what this did at
     * first, and what realmsites._solidRun does — makes every long piece
     * `short` too long at each end. On the Drowned Keep's floor slabs
     * (11 by 6) that was six units of invisible floor past both broken
     * edges, and the slabs met in the middle of a tower they were supposed
     * to leave a hole in.
     */
    const reach = Math.max(0, long - short);
    const step = Math.max(short * 1.2, 1.0);
    const n = Math.max(1, Math.ceil(reach / step));
    let first = null;
    for (let i = -n; i <= n; i++) {
      const t = (i / n) * reach;
      this.solids++;
      const b = col.addBox(x + ax * t, y, z + az * t, short, hy, short,
        tag || 'stone');
      if (out) out.push(b);
      if (!first) first = b;
    }
    return first;
  }

  /**
   * A grapple target.
   *
   * Recorded in the site's frame as well as registered with the collision
   * world, because "can this gap be crossed" is a question about anchors as
   * much as about platforms, and the only way to answer it is to know where
   * they are relative to the pieces. See the reachability proof in the
   * tests, which walks exactly this list.
   */
  _anchorAt(site, f, up, s, r) {
    const d = site.dir;
    this.realm.collision.addAnchor(
      site.at.x + d.x * f - d.z * s, site.y + up,
      site.at.z + d.z * f + d.x * s, r);
    site.anchors++;
    site.anchorList.push({ f, up, s, r });
    // A lamp on every anchor, because a grapple point you cannot see is a
    // gap with no answer. Small, warm, and the same on all eight sites, so
    // the language is learned once.
    this._at(this._b.lamp, site, f, up, s, 0.62, 0.7, 0.62, 0xffd76b);
  }

  /**
   * ═══ ONE THING YOU CAN STAND ON, AND WHAT HOLDS IT UP ══════════════════
   *
   * The enforcement of the rule in the file header. A piece must name what
   * holds it up, and the name has to be one of the things that exist in
   * this world — a pier, an abutment, the canyon wall, a trunk, a rope
   * between two pegs, the rubble it landed in. There is deliberately no
   * `'none'`: a platform floating in the air is not a thing this file can
   * build, because there is nothing to pass here.
   *
   * `optional` marks a piece on a spur, so the tests can check that no
   * required piece depends on one. `caught` marks the floor of the catch,
   * which you land on rather than cross on.
   *
   * `entry` and `exit` mark where the crossing STARTS and ENDS. They are
   * declared rather than inferred because the only test worth having on a
   * traversal is "can this actually be crossed", and answering it means
   * knowing which piece you arrive on and which one you are trying to
   * reach. Half of these sites go up rather than along, so no rule about
   * lowest-`f` and highest-`f` would serve all of them.
   *
   * @param ha  half-extent along the road
   * @param hb  half-extent across it
   */
  _piece(site, f, up, s, ha, hb, anchor, opts) {
    if (!ANCHORS.has(anchor)) {
      throw new Error(`traverse: "${anchor}" is not a thing that holds a `
        + 'piece up. See ANCHORS — every piece must be attached to '
        + 'something, and a floating platform is not buildable here.');
    }
    const o = opts || {};
    const p = {
      f, up, s, ha, hb, anchor,
      /**
       * Where the terrain is here, relative to the site. Recorded so the
       * tests can assert the invariant that matters most in this file —
       * nothing walkable is under the dirt — against the real terrain
       * rather than against the intent. See `_ground`.
       */
      ground: this._ground(site, f, s),
      optional: !!o.optional,
      grapple: !!o.grapple,
      caught: !!o.caught,
      /** Only walkable once a rope has been cut. See `_lash`. */
      lashed: !!o.lashed,
    };
    site.pieces.push(p);
    if (o.entry) site.entry = p;
    if (o.exit) site.exit = p;
    return p;
  }

  /**
   * ═══ A SURFACE YOU STAND ON ════════════════════════════════════════════
   *
   * The visual, the collider and the piece record, in one call, all
   * agreeing that the walkable top is at `top`.
   *
   * It has its own function because the three were written out separately
   * at first and drifted apart immediately. A boulder whose mesh topped out
   * at `up + 0.4·sz` but whose collider stopped at `up + 0.1·sz` is a rock
   * you stand a third of the way inside; an abutment whose box top was 1.5
   * above the road it is supposed to continue is a kerb you have to jump.
   * Both were real, and neither is possible through here: `top` is the
   * surface, `thick` is how much body hangs below it, and every caller
   * states the height it means rather than a centre it has to work out.
   */
  _pad(site, f, top, s, ha, hb, thick, colour, tag, opts) {
    const o = opts || {};
    const t = this._onGround(site, f, top, s);
    this._at(this._b.box, site, f, t - thick * 0.5, s,
      ha * 2, thick, hb * 2, colour, o.roll);
    this._solid(site, f, t - thick * 0.5, s, ha, thick * 0.5, hb,
      tag || 'deck');
    return this._piece(site, f, t, s, ha, hb, o.anchor || 'rubble', o);
  }

  /**
   * ═══ NEVER UNDER THE DIRT ══════════════════════════════════════════════
   *
   * A safety net, and it is honestly labelled as one: it silently lifts a
   * surface that would have been below the local ground up to just above
   * it.
   *
   * It exists because THE TERRAIN IS A HARD FLOOR — see `_ground` — and a
   * platform under it is not a platform. The eight sites below are each
   * laid out to sit above their own ground, so in the normal case this
   * changes nothing; it is here because the ground under a two-hundred-unit
   * site is not flat and no amount of hand-tuning eight builders makes
   * that safe. The test asserts the invariant directly against the terrain
   * afterwards, so a site that needs this a lot shows up as one whose gaps
   * have quietly changed rather than as one that looks fine and is buried.
   */
  _onGround(site, f, top, s) {
    const g = this._ground(site, f, s);
    return top < g + 0.05 ? g + 0.05 : top;
  }

  /**
   * ═══ THE WAY UP ONTO THE WRECK ═════════════════════════════════════════
   *
   * A short walked ramp from the road to whatever height the route runs at,
   * optionally sliding sideways to `s1` as it climbs.
   *
   * Every one of the eight now has its route ABOVE the road, or out on the
   * flank, or both (see `_blockage` and `_flank` for why), and a route that
   * starts six units up is a route with no entrance — the measured ceiling
   * for a standing gain is 5.7 units with a flip, and that is over a two-
   * unit gap. Tagged 'deck' with a rise inside `deckStep`, so it is climbed
   * by walking rather than by six separate jumps.
   */
  _rampUp(site, f0, dir, top, s0, s1, colour, anchor) {
    const RISE = 1.6, RUN = 2.8;
    /**
     * The ramp is sized by the GROUND it has to climb over, not only by
     * the height asked for. `_pad` lifts a tread that would be under the
     * dirt, so on rising ground a ramp planned as five even steps comes
     * out as five uneven ones and two of them can be five units apart —
     * past `deckStep`, which turns a walk into a wall. Counting the treads
     * from the worst of the two keeps every rise inside a stride.
     */
    let climb = Math.abs(top);
    const probe = Math.max(4, Math.ceil(climb / RISE));
    for (let i = 0; i <= probe; i++) {
      const k = i / probe;
      const g = this._ground(site, f0 + dir * i * RUN, s0 + (s1 - s0) * k);
      climb = Math.max(climb, Math.abs(g));
    }
    /**
     * AND IT KEEPS EXTENDING UNTIL NO RISE IS MORE THAN A STRIDE.
     *
     * Laid out as a fixed number of even steps it is not even: `_pad` lifts
     * every tread that would be under the dirt, so on a shoulder where the
     * ground rises to meet the ramp the actual rises came out at three and
     * four units — past `deckStep`, which turns a walk into a wall you
     * cannot get onto. This walks the ramp out one tread at a time and
     * stops when it has arrived, capping each step against the last.
     */
    const CAP = 1.8;
    /**
     * ═══ SIDEWAYS AND UPWARDS ARE DIFFERENT JOBS ═══════════════════════
     *
     * When the ramp also moves ACROSS the road it is LEVEL: it holds one
     * height and only slides. The three flank crossings need that — a walk
     * out from the carriageway to a ledge line twenty-four units off it —
     * and doing it as a climb cannot work. The ground under such a walk
     * falls forty-five units from the road to the ledge, `_pad` lifts every
     * tread that would be buried, and the result is a "ramp" whose real
     * steps are three units apart: past `deckStep`, so a wall.
     *
     * Held level, the same walk is a shelf out over the drop, which is
     * what it should have been in the first place — the ledge and the road
     * are at the same height, and the thing between them is a bridge.
     */
    const level = s0 !== s1;
    const n = level
      ? Math.max(1, Math.ceil(Math.abs(s1 - s0) / 4.0))
      : Math.max(1, Math.ceil(climb / RISE));
    let last = null;
    let prev = level ? top : 0;
    for (let i = 0; i < n * 3; i++) {
      const k = Math.min(1, (i + 1) / n);
      const want = level ? top : top * k;
      const s = s0 + (s1 - s0) * k;
      const f = f0 + dir * i * (level ? 1.6 : RUN);
      // Never more than a stride above the tread before it, whatever the
      // ground under this one turns out to be.
      const g = this._ground(site, f, s);
      /**
       * A LEVEL WALKWAY NEEDS NO PLANK WHERE THE GROUND IS ALREADY THERE.
       *
       * Out at the road end of a walk to a ledge the ground IS the road,
       * so a pad held at the walkway's height gets lifted onto it by
       * `_pad` — and a lifted pad is a slab standing on the carriageway
       * roofing whatever else is there. Skipping those leaves the walkway
       * starting where the ground stops, which is where a walkway starts.
       */
      if (level && g + 0.05 > want + 0.3) continue;
      const at = Math.min(Math.max(want, g + 0.05), prev + CAP);
      // Thin treads: 1.2 thick, so a tread's own underside can never be a
      // ceiling over the one before it at a 1.6 rise.
      last = this._pad(site, f, at, s, level ? 2.4 : RUN * 0.95, 3.4, 0.9,
        colour, 'deck', { anchor });
      prev = last.up;
      if (k >= 1 && (level || Math.abs(prev - top) < CAP * 0.5)) break;
    }
    // A level walk whose ground was already there the whole way places
    // nothing; callers still need somewhere to carry on from.
    return last || { f: f0, up: top, s: s1, ha: 2.4, hb: 3.4 };
  }

  /**
   * ═══ THE THING THAT SHUTS THE ROAD ═════════════════════════════════════
   *
   * A solid mass across the corridor, from `from` to `to` and `h` high:
   * the brash of a windfall, the spoil of a slide, the deck of a bridge
   * lying where it fell, the blocks of a collapsed causeway.
   *
   * Every one of the eight has one, and this is why. On a graded road the
   * corridor is FLAT for eleven units either side, so "a gap in the road"
   * is not a gap at all — the ground fills it and you walk across without
   * noticing there was supposed to be an obstacle. Four of these sites were
   * built that way at first and all four were walk-throughs.
   *
   * With the road blocked, the way past is over the wreck, the gaps up
   * there are gaps in the AIR — which the terrain cannot fill in — and
   * falling off lands you back on the road, which is the friendliest catch
   * in the game and costs nothing to build.
   *
   * It is deliberately not a wall to the horizon. It spans about fifty
   * units of ground, so a player who would rather walk round it through
   * the trees can, at the cost of a long detour — which is exactly what
   * the Wood Road's own signpost says to do. The traversal is the fast and
   * interesting line, not the only line.
   */
  _blockage(site, from, to, h, colour, tag) {
    const R = this.rnd;
    const step = 5.5;
    for (let f = from; f <= to; f += step) {
      for (let s = -24; s <= 24; s += 6) {
        const g = this._ground(site, f, s);
        // Taper at the edges so it reads as a heap and not as a box.
        const k = 1 - Math.pow(Math.abs(s) / 27, 2.2);
        if (k <= 0.05) continue;
        const hh = h * k * (0.82 + R() * 0.36);
        /**
         * AND IT NEVER SWALLOWS THE ROUTE IT IS THE REASON FOR.
         *
         * Called last in each builder, so `site.pieces` is the finished
         * route and this can simply ask. Without it the heap put six units
         * of solid rock through whatever happened to be passing: the Fallen
         * Mile's own entry ramp ran up the inside of a brash pile, and the
         * three flank crossings had their ramps out to the ledge buried in
         * the rockfall that was supposed to be sending them there.
         *
         * Checking against the pieces beats hand-listing keep-out boxes in
         * eight builders, and it cannot drift out of date.
         */
        let clear = true;
        for (const p of site.pieces) {
          /**
           * A CATCH PIECE DOES NOT VETO. You are meant to land on the
           * wreck — that is what the wreck is for — and the catch runs the
           * whole length of the obstacle at ground level, so counting it
           * as route to protect vetoed every blob and left four sites with
           * nothing on the carriageway at all.
           */
          if (p.caught) continue;
          if (Math.abs(p.f - f) > p.ha + 2.5) continue;
          if (Math.abs(p.s - s) > p.hb + 2.5) continue;
          /**
           * NOR DOES A SURFACE AT GROUND LEVEL.
           *
           * Rubble on a floor is correct — it is what a fallen stair does
           * to the room under it, and the Drowned Keep's blocked doorway
           * IS the ground floor with the stair on top of it. Only an
           * ELEVATED route piece has a claim on the air a heap wants, and
           * treating the floor as one vetoed every blob at three sites.
           */
          if (p.up < g + 1.2) continue;
          // Nor anything standing clear above the heap's own top.
          if (p.up > g + hh * 1.35 + 0.6) continue;
          clear = false;
          break;
        }
        if (!clear) continue;
        const w = 3.4 + R() * 1.8;
        this._at(this._b.blob, site, f + (R() - 0.5) * 3, g + hh * 0.35,
          s + (R() - 0.5) * 3, w, hh, w, colour, R() * 3);
        this._solid(site, f, g + hh * 0.35, s, 3.0, hh, 3.4, tag || 'stone');
      }
    }
  }

  /**
   * The same, in rock rather than masonry.
   *
   * A unit sphere's y SCALE is its half-height, unlike a box's, which is
   * exactly the sort of difference that produced the sunk boulders — so it
   * gets its own function rather than a flag. The collider is inscribed at
   * 72% of the width, because the very top of a sphere is a point and the
   * flat part you actually stand on is smaller than the silhouette.
   */
  _rock(site, f, top, s, ha, hb, depth, colour, tag, opts) {
    const o = opts || {};
    const t = this._onGround(site, f, top, s);
    this._at(this._b.blob, site, f, t - depth, s, ha, depth, hb, colour,
      o.roll);
    this._solid(site, f, t - depth, s, ha * 0.72, depth, hb * 0.72,
      tag || 'rock');
    return this._piece(site, f, t, s, ha * 0.72, hb * 0.72,
      o.anchor || 'rubble', o);
  }

  /**
   * ═══ BUILD A LASHED BEAM ═══════════════════════════════════════════════
   *
   * A timber stood on end against a post and roped near the top, the way a
   * gang parks a spare. Cut the rope and it comes down across the obstacle
   * and stays there. See the `Lashing` class for why the colliders are made
   * now and disabled rather than made when it lands.
   *
   * The beam's PIVOT is at (f, 0, s) and it falls along the road in the
   * direction `fall`, so the fallen beam occupies f … f + fall·len at the
   * pivot's height. That is where the colliders go, and where the optional
   * pieces are recorded — optional, because this is a shortcut and the
   * crossing is provably possible without ever noticing the rope.
   *
   * @param spec { f, s, len, fall, why }
   */
  _lash(site, spec) {
    const B = this._b;
    const len = spec.len;
    const fall = spec.fall || 1;
    const L = new Lashing(this, site, {
      f: spec.f, up: len * 0.86, s: spec.s, len, fall,
    });
    site.lashings.push(L);

    // The post it is roped to, and the rope itself, both instanced — they
    // do not move, only the beam does.
    this._at(B.rod, site, spec.f, len * 0.45, spec.s - 1.9, 0.55,
      len * 0.9, 0.55, 0x6b4a2a);
    this._solid(site, spec.f, len * 0.45, spec.s - 1.9, 0.7, len * 0.45, 0.7,
      'stone');
    // The knot, high up, which is the thing you aim at. A lamp on it so it
    // reads as something you are meant to do something about.
    for (let i = 0; i < 3; i++) {
      this._at(B.rod, site, spec.f, len * 0.86 + i * 0.35 - 0.35,
        spec.s - 0.95, 0.16, 2.6, 0.16, 0xc9a227, Math.PI / 2);
    }
    this._at(B.lamp, site, spec.f, len * 0.86 + 0.9, spec.s - 0.95,
      0.55, 0.6, 0.55, 0xffd76b);

    /**
     * THE BEAM, as a real Group so it can rotate. Built along local +Y
     * (standing); a Z rotation of −π/2 sends local +Y to local +X, and the
     * group's own Y rotation then points local +X along the road. The
     * Euler order is the default XYZ, so R = Ry·Rz and the fall happens in
     * the beam's own frame before the road orientation is applied — which
     * is the order that makes both readable.
     */
    const d = site.dir;
    const g = L.group;
    g.position.set(
      site.at.x + d.x * spec.f - d.z * spec.s,
      site.y + 0.6,
      site.at.z + d.z * spec.f + d.x * spec.s);
    g.rotation.y = Math.atan2(-d.z, d.x) + (fall < 0 ? Math.PI : 0);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(this.geos.box, this.mats.timber);
      m.position.set(0, len * ((i + 0.5) / 7), 0);
      m.scale.set(1.5, len / 6.6, 1.5);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    site.group.add(g);
    L._place();

    /**
     * And the colliders, in the position the beam WILL be in — along the
     * road from the pivot — created now and disabled until the rope goes.
     * Collected through `_solid`'s `out` list rather than its return value,
     * so it does not matter whether a piece this size takes the single-box
     * branch or the tiled one: every box it made gets the flag.
     */
    const n = Math.max(2, Math.round(len / 2.2));
    for (let i = 0; i < n; i++) {
      const f = spec.f + fall * (len * ((i + 0.5) / n));
      this._solid(site, f, 0.6, spec.s, 1.2, 0.75, 1.0, 'deck', L.boxes);
      this._piece(site, f, 1.35, spec.s, 1.2, 1.0, 'shoring',
        { optional: true, lashed: true });
    }
    for (const b of L.boxes) b.disabled = true;
    return L;
  }

  /**
   * ═══ WHERE YOU LAND IF YOU MISS ════════════════════════════════════════
   *
   * A bank, a shelf, a river or a lower terrace running the length of the
   * obstacle, with a ramp back up at the far end. Every site has one and
   * the tests check it, because the alternative — a fall that costs the
   * whole crossing — turns a road you have to think about into a road you
   * go round.
   *
   * @param drop   how far below the route it is
   * @param back   what the ramp is made of: 'ramp' | 'stair' | 'roots'
   * @param rampS  which side of the route the ramp climbs, if the middle
   *               is occupied. The Break in the Cutting needs it: the
   *               slide's boulders come down across the road from the cut
   *               face, and a ramp up the centre line passed under one of
   *               them with a unit and a half of headroom.
   * @param avoid  `f` positions the shelf must leave a hole around —
   *               anything that stands IN the gap and carries on down
   *               past the shelf: a bridge pier, a causeway pylon, a
   *               basalt column. Without it the shelf runs straight
   *               through them and the rock you are standing on is inside
   *               the pier, which collision resolves by shoving you out
   *               of it. Radii are in units either side.
   */
  _catch(site, from, to, drop, back, rampS, avoid) {
    const R = this.rnd;
    const span = to - from;
    const n = Math.max(2, Math.round(span / 9));
    const blocked = (f) => (avoid || []).some((a) => Math.abs(f - a.f) < a.r);
    const cs = rampS || 0;

    /**
     * ═══ THE GROUND IS THE CATCH WHEREVER THE GROUND IS CLOSE ══════════
     *
     * A shelf `drop` below the route is only a shelf if the terrain is
     * lower than that. On a graded road it is not: the corridor is flat at
     * road level, so the "river bed nine units down" and the "shelf thirty
     * units down" of the first version were both inside the hill, and the
     * entire failure-is-a-ledge mechanic was buried scenery at six of the
     * eight sites — 115 pieces of it.
     *
     * Where the ground is at or near the route, the GROUND is the catch:
     * you fall off the wreck and land on the road you were walking on,
     * which is both the friendliest possible outcome and free. Nothing is
     * built, `catchY` records where the ground actually is, and the route
     * out is to walk back and try again.
     *
     * A shelf is only built where the terrain genuinely falls away — which
     * is off the corridor, and is why the three flank crossings pass an
     * `rampS`.
     */
    /**
     * The test is whether the requested shelf would be UNDER the ground,
     * not whether the ground is above the route. `-drop − 0.5` rather than
     * `-drop + 1.0`: at the Drowned Keep the catch is half a unit down and
     * the ground is at zero, so a shelf there is half a unit inside the
     * floor — and the single ramp tread it built landed inside the rubble
     * blocking the doorway.
     */
    const g0 = this._ground(site, (from + to) * 0.5, cs);
    if (g0 > -drop - 0.5) {
      site.catchY = g0;
      site.catchIsGround = true;
      // A few pieces on it, so the reachability proof and the HUD know the
      // floor is a real place you can be.
      for (let i = 0; i <= n; i++) {
        const f = from + (span * i) / n;
        if (blocked(f)) continue;
        this._piece(site, f, this._ground(site, f, cs), cs, 5, 5, 'bank',
          { caught: true });
      }
      return site.catchY;
    }

    site.catchY = -drop;
    site.catchIsGround = false;
    for (let i = 0; i <= n; i++) {
      const f = from + (span * i) / n;
      if (blocked(f)) continue;
      const s = cs + (R() - 0.5) * 6;
      /**
       * NO SHELF WHERE THE GROUND HAS COME BACK UP TO MEET IT.
       *
       * A flank is not a uniform drop: at the Sunderway the shoulder falls
       * away over the middle of the chasm and rises again towards both
       * ends, so shelf rocks near the ends were lifted by `_pad` to sit ON
       * the ground at route level — where they became five-unit-thick
       * slabs standing across the walkway out to the causeway. Where the
       * ground is already there, the ground is the shelf.
       */
      if (this._ground(site, f, s) > -drop + 1.0) continue;
      const w = 5 + R() * 4;
      this._rock(site, f, -drop, s, w, w * 0.9, 2.6,
        R() < 0.5 ? 0x7a7266 : 0x8a8478, 'deck',
        { anchor: 'bank', caught: true, roll: R() * 0.2 });
    }
    /**
     * ═══ AND THE WAY BACK UP ═════════════════════════════════════════
     *
     * At the far end deliberately: climbing out should put you past what
     * you fell off, so a miss costs the crossing and not the approach as
     * well.
     *
     * TWO THINGS THIS GETS RIGHT THAT THE FIRST VERSION DID NOT.
     *
     * It is laid out BACKWARDS from `to` rather than forwards from it. The
     * first version started six units short of the far end and marched
     * forward 2.6 per step, so in the Sunderway — thirty units down, and
     * therefore seventeen steps — it climbed out into open air thirty-eight
     * units past the end of the chasm. Deriving the start from the step
     * count is the lesson the tutorial island's layout already learned: do
     * not hand-type a coordinate you can compute.
     *
     * And it is tagged 'deck' with a rise inside `deckStep`, so it is
     * WALKED rather than jumped. A ramp of ordinary ledges is climbed with
     * stepHeight, which is 0.65 and refuses every one of these — seventeen
     * separate jumps to get out of a hole you fell into by accident.
     * `deckStep` is 2.0 and exists for precisely this: a surface you are
     * meant to walk along. The first tread is inside stepHeight so you can
     * get onto it from the floor of the catch in the first place.
     */
    /**
     * ═══ AND THE WAY BACK UP, IN TWO LEGS ══════════════════════════════
     *
     * A shelf on a flank is thirty units down AND thirty units out, and
     * those need different answers:
     *
     *   THE CLIMB runs along the shelf at the shelf's own offset, where
     *   there is nothing but air below it and treads can be laid at a
     *   stride apart all the way up.
     *
     *   THE WALK IN is level, at route height, from the head of the climb
     *   back to the carriageway.
     *
     * One diagonal ramp doing both was the first attempt and it cannot
     * work: it crosses the shoulder where the ground rises to meet it, and
     * `_pad` lifts every tread that would be buried, so the rises came out
     * at five and a half units in the Sunderway — past `deckStep`, which
     * makes it a wall rather than a ramp. And it cannot simply stop out on
     * the flank either: these shelves are at a hundred and seventy units of
     * altitude, above `snowLine`, where `maxClimbSlope` refuses to let you
     * walk up the natural slope at all.
     */
    // 1.6, not 1.8: the treads overlap heavily, so a rise larger than the
    // frog's own 1.75 makes each tread's underside a low ceiling over the
    // one below it. Still well inside `deckStep`, so it is still walked.
    const RISE = 1.6, RUN = 2.6;
    const steps = Math.max(1, Math.ceil((drop - 0.6) / RISE));
    const w = back === 'roots' ? 2.6 : 3.5;
    const col = back === 'roots' ? 0x6a5238
      : (back === 'stair' ? 0x9a9184 : 0x7a7266);
    /**
     * The climb sits EIGHT UNITS FURTHER OUT than the shelf itself.
     *
     * Because the shelf is a line of rocks with random offsets and each
     * one is lifted to its own ground, so their tops are not level — and a
     * shelf rock's body hangs five units below its top. A ramp threaded up
     * the middle of them ran under the high ones. Out past the line it has
     * clear air over it the whole way.
     */
    const rs = cs + (cs < 0 ? -8 : 8);
    const start = to - steps * RUN;
    for (let i = 0; i < steps; i++) {
      const up = Math.min(0, -drop + 0.6 + i * RISE);
      this._pad(site, start + i * RUN, up, rs, RUN * 0.95, w, 2.2,
        col, 'deck', { anchor: back === 'roots' ? 'root' : 'rubble' });
    }
    if (cs) {
      /**
       * The walk in starts just PAST the head of the climb, not short of
       * it. Six units short put it among the climb's own treads, and a
       * 1.6-thick slab of walkway less than a stride over a tread is a
       * tread you cannot stand up on. Thin, too, for the same reason.
       */
      const legs = Math.max(1, Math.ceil(Math.abs(rs) / 4.5));
      for (let i = 1; i <= legs; i++) {
        this._pad(site, to + 3, 0, rs * (1 - i / legs), 2.6, 3.2, 1.0, col,
          'deck', { anchor: back === 'roots' ? 'root' : 'rubble' });
      }
    }
    return site.catchY;
  }

  /**
   * THE HOARDING, AND THE TRAFFIC THAT STOPPED.
   *
   * Every site opens with a board carrying its `why`, and the carts, crates
   * and barrels of the people who got this far and turned round.
   *
   * This is what makes an obstacle a thing that HAPPENED rather than a
   * thing that was placed: the road is not merely broken, it is broken and
   * somebody had to give up on it. A player who walks past a cart with a
   * wheel off, four crates stacked by the verge and a shut-road board has
   * been told the whole story before they see the gap.
   */
  _hoarding(site) {
    const B = this._b;
    const R = this.rnd;
    const f = -34;
    for (const s of [-4.5, 4.5]) {
      this._at(B.rod, site, f, 1.5, s, 0.5, 3.0, 0.5, 0x6b4a2a);
      this._solid(site, f, 1.5, s, 0.6, 1.5, 0.6, 'stone');
    }
    this._at(B.box, site, f, 2.5, 0, 1.0, 1.5, 10.0, 0xc9b078);
    this._at(B.box, site, f, 3.35, 0, 0.7, 0.24, 10.4, 0x8a2f28);
    // A lamp on it, so a shut road reads at dusk. No anchor: the tongue is
    // not meant to be an answer to a signpost.
    this._at(B.lamp, site, f, 3.9, 0, 0.7, 0.8, 0.7, 0xffd76b);

    // A cart with a wheel off, and the wheel lying where it rolled to.
    this._at(B.box, site, f - 9, 1.1, -6, 6.8, 2.8, 6.2, 0x7a5a3a, 0.14);
    for (const s of [-7.6, -4.4]) {
      this._at(B.rod, site, f - 9, 0.6, s, 1.3, 0.5, 1.3, 0x5a4230);
    }
    this._at(B.rod, site, f - 12.5, 0.2, -3.0, 1.3, 0.4, 1.3, 0x5a4230);
    this._solid(site, f - 9, 1.1, -6, 1.8, 1.2, 3.2, 'stone');
    // Crates stacked on the verge where they were unloaded.
    for (let i = 0; i < 5; i++) {
      const s = 5 + R() * 5;
      const ff = f - 6 - R() * 14;
      const h = 1.0 + R() * 0.6;
      this._at(B.box, site, ff, h * 0.5, s, 2.0, h, 2.0,
        R() < 0.5 ? 0x8a6a3a : 0x6b4a2a, R() * 0.4);
      this._solid(site, ff, h * 0.5, s, 1.1, h * 0.5, 1.1, 'stone');
    }
    // A barrel on its side, and a crate somebody dropped.
    this._at(B.rod, site, f - 16, 0.9, 6.5, 0.9, 2.2, 0.9, 0x7a5a3a,
      Math.PI / 2);
    this._at(B.box, site, f - 19, 0.5, 4.0, 1.6, 1.0, 1.6, 0x6b4a2a, 0.5);
  }

  // ─────────────────────────────────────────────────────────── the eight ──

  /**
   * ═══ A BRIDGE THAT WENT DOWN ═══════════════════════════════════════════
   *
   * The piers are standing; the deck is not. You cross on the abutment,
   * the stub of deck still cantilevered off it, the two pier caps, and the
   * span that fell and lodged with one end on the second pier.
   *
   * ── why the crossing is ABOVE the road rather than over a gorge ───────
   *
   * Because there is no gorge, and there cannot be one. The road network
   * GRADES its corridor flat across everything it crosses, rivers
   * included — measured at this crossing, the road holds 17.8 all the way
   * through while the river's own channel test reads 1.0, so the Whisper
   * passes under a flat embankment with no cut in it at all. A bridge
   * built down into that reads as a set of stones sunk in a lawn, and the
   * road beside it is a clear walk.
   *
   * So the deck that came down is ON the road, in a heap, and the piers
   * stand up out of it with their caps ten units above. You cross up
   * there. Falling lands you on the wreck, which is a fair catch and the
   * reason nothing else has to be built for one.
   */
  _bridge(site) {
    const B = this._b;
    const R = this.rnd;
    const gap = site.rungs[0].gap;
    const span = 30 + gap * 3;
    site.span = span;
    /** How high the surviving deck sits above the road. */
    const DECK = 10;

    for (const end of [-1, 1]) {
      const f = end * span * 0.5;
      // The abutment: the road continuing onto the bridge, flush with it,
      // and the entry and the exit of the crossing.
      this._pad(site, f, 0, 0, 6, 8, 6, 0x8a8478, 'deck',
        { anchor: 'abutment', entry: end < 0, exit: end > 0 });
      /**
       * The ramp up the abutment's flank to the surviving deck. A bridge
       * approach IS a ramp, so this is not a concession to the movement
       * numbers — it is the embankment the road climbed to deck level on,
       * still standing where the deck is not.
       */
      /**
       * At s = 12, BESIDE the deck rather than under it.
       *
       * Up the middle it climbed straight underneath the surviving stub —
       * which sits at deck height with its body 1.4 thick — so the last
       * three treads had a slab a foot and a half over them. A bridge
       * approach ramp beside the abutment is also what one looks like.
       */
      this._rampUp(site, f - end * 3, -end, DECK, 12, 12, 0x8a8478,
        'abutment');
      // And the stub of deck still cantilevered off it, with a broken edge.
      const fs = f - end * 12;
      this._pad(site, fs, DECK, 0, 3.5, 6, 1.4, 0x9a9184, 'deck',
        { anchor: 'abutment' });
      // A parapet on the stub, so it reads as a road and not a shelf.
      for (const s of [-5.4, 5.4]) {
        this._at(B.box, site, fs, DECK + 0.9, s, 7, 1.8, 1.2, 0x8a8478);
        this._solid(site, fs, DECK + 0.9, s, 3.5, 0.9, 0.6, 'wall');
      }
    }

    /**
     * THE PIERS. Two of them standing out of the wreck with their caps at
     * about deck level, and the gap between them is the site's headline
     * rung. The second sits lower than the first, because a pier that
     * settled is a pier that tells you the river moved under it.
     */
    const piers = [];
    for (let i = 0; i < 2; i++) {
      const f = (i === 0 ? -1 : 1) * (gap * 0.5 + 3.5);
      const cy = DECK - 1.4 - i * 1.6;
      // The shaft, down through the wreck into the river bed.
      this._at(B.rod, site, f, cy - 10, 0, 3.4, 22, 3.4, 0x7a7468);
      this._solid(site, f, cy - 10, 0, 3.6, 11, 3.6, 'stone');
      this._pad(site, f, cy, 0, 3.5, 3.5, 1.6, 0x9a9184, 'deck',
        { anchor: 'pier' });
      // The cutwater on the upstream side.
      this._at(B.cone, site, f, cy - 6, -4.2, 2.4, 5, 2.4, 0x7a7468,
        Math.PI);
      this._anchorAt(site, f, cy + 3.4, 0, 2.6);
      piers.push({ f, cy });
      // Driftwood and deck timbers caught against it.
      for (let k = 0; k < 4; k++) {
        this._at(B.rod, site, f + (R() - 0.5) * 8, cy - 7 + R() * 2,
          (R() - 0.5) * 9, 0.4, 4 + R() * 4, 0.4, 0x5a4a34,
          1.3 + R() * 0.6);
      }
    }

    /**
     * AND THE SPAN THAT FELL, one end still on the second pier and the
     * other down in the wreck. It is the piece that makes this read as a
     * collapse rather than as a row of stepping stones, and it is the way
     * back UP if you come off.
     */
    const p = piers[1];
    for (let i = 0; i < 6; i++) {
      const k = i / 5;
      this._pad(site, p.f + 5 + i * 3.0, p.cy - k * (p.cy - 1.2),
        3.2 + k * 3, 2.1, 2.7, 1.0, 0x8a8478, 'deck',
        { anchor: 'pier', roll: -0.34 });
    }

    /**
     * THE GANG'S SPARE BEAM, stood on end on the near abutment and roped
     * to a post — which is what a bridge repair crew does with a beam it
     * has not used yet. This is the most believable mechanism on the map:
     * there is a spare beam at the fallen bridge because somebody brought
     * a beam to the fallen bridge.
     *
     * Dropped, it runs down the side of the crossing from the abutment
     * past the first pier, so the stub-to-pier jump can be walked instead.
     * A shortcut, not the route — see `_lash`.
     */
    this._lash(site, { f: -span * 0.5 + 3, s: 11, len: 30, fall: 1 });

    // The deck that came down, blocking the way through. Last, so it can
    // see the route and leave it alone — see `_blockage`.
    this._blockage(site, -span * 0.26, span * 0.26, 5.0, 0x8a8478, 'stone');

    // The wreck is the catch: `_catch` sees the ground is at route level
    // and builds nothing. The river shows either side of the heap.
    this._catch(site, -span * 0.5 + 8, span * 0.5 - 8, 9, 'rubble', 0,
      piers.map((q) => ({ f: q.f, r: 10 })));
    this._water(site, -span * 0.5 - 30, -span * 0.30, 0.2);
    this._water(site, span * 0.30, span * 0.5 + 30, 0.2);

    /**
     * THE SPUR: a carter's strongbox lashed to the fallen span, out over
     * the water where nobody would go for it. A tongue off the pier's
     * anchor and a jump back.
     */
    if (site.spec.spur) {
      // s = 20, clear of the approach ramp at 12: at 15 the strongbox's
      // slab sat a unit and a quarter over one of the ramp's treads.
      const f = p.f + 16, s = 20;
      this._pad(site, f, p.cy + 1.2, s, 2.5, 2.5, 1.2, 0x8a8478, 'deck',
        { anchor: 'pier', optional: true, grapple: true, roll: 0.2 });
      this._anchorAt(site, f, p.cy + 4.6, s, 2.6);
      site.spur = { f, up: p.cy + 1.2, s, what: site.spec.spur.what };
    }
  }

  /** A river or a pool under an obstacle: a plane, and some foam on it. */
  _water(site, from, to, depth) {
    const m = new THREE.Mesh(this.geos.plane, this.mats.water);
    const d = site.dir;
    const mid = (from + to) / 2;
    m.position.set(d.x * mid, site.y + depth, d.z * mid);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(d.x, d.z);
    m.scale.set(to - from + 40, 120, 1);
    m.renderOrder = 2;
    site.group.add(m);
    const R = this.rnd;
    for (let i = 0; i < 40; i++) {
      this._at(this._b.box, site, from + R() * (to - from), depth + 0.3,
        (R() - 0.5) * 70, 3 + R() * 5, 0.3, 3 + R() * 5, 0xdff0ff, R() * 0.3);
    }
  }

  /**
   * ═══ A MILE OF WINDFALL ════════════════════════════════════════════════
   *
   * Half a hillside of pines across the road. You cross ON the trunks, and
   * each one has its ROOT PLATE still in the ground at the butt — the disc
   * of earth and roots a windthrown tree tears up — which is what holds
   * the far end in the air and what you climb to get onto it. So there is
   * never a log hanging in space.
   *
   * The catch is the road itself, buried under the timber: you drop into
   * the gaps between trunks and walk out up a bank of roots.
   */
  _forest(site) {
    const B = this._b;
    const R = this.rnd;
    const gap = site.rungs[0].gap;
    const span = 40 + gap * 3;
    site.span = span;

    /**
     * ═══ THE BRASH, WHICH IS WHAT SHUTS THE ROAD ═══════════════════════
     *
     * The tops and branches of half a hillside of pines, in three piles
     * across the way. They are the reason this is an obstacle at all: the
     * road under them is graded flat, and without something solid on it a
     * "windfall" is a scattering of logs you stroll between.
     *
     * The trunks then lie ON the piles, so their walkable tops are five
     * units up and the gaps between them are gaps in the air. Fall into
     * one and you land on the road between two piles, which is the whole
     * of the failure handling this site needs.
     */
    /**
     * ═══ THE WAY UP ONTO THE TIMBER ════════════════════════════════════
     *
     * The first pine came down butt-first into the road, so it lies at an
     * angle from the tarmac up to the height of the rest of the windfall.
     * It is the entry, and it is a walked ramp rather than a jump: the
     * crossing has to START where the player is, which is on the road.
     *
     * The first version marked the first ROOT PLATE as the entry, five and
     * a half units up, with nothing under it — a crossing that began with
     * a leap onto a wall. The test that asserts an entry is at road level
     * exists because of exactly that.
     */
    /**
     * The timber lies at 7.6, clear above the 6.2 the brash piles reach.
     * Not a stylistic choice: a trunk inside the brash is a trunk you
     * cannot walk on, and `_blockage` would rather leave a hole in the
     * heap than bury it — which puts the hole exactly where the player
     * would have walked round.
     */
    const DECK = 7.6;
    this._pad(site, -span * 0.5 + 1, 0, 0, 5, 9, 3, 0x6b5a3a, 'deck',
      { anchor: 'bank', entry: true });
    {
      const rampN = Math.ceil(DECK / 1.7);
      for (let i = 0; i < rampN; i++) {
        const k = (i + 1) / rampN;
        this._at(B.rod, site, -span * 0.5 + 5 + i * 3.0, DECK * k, 0,
          1.7, 1.9, 1.7, 0x6b5236, Math.PI / 2 - 0.34);
        this._pad(site, -span * 0.5 + 5 + i * 3.0, DECK * k, 0, 1.5, 1.7,
          1.6, 0x6b5236, 'deck', { anchor: 'trunk' });
      }
    }

    let f = -span * 0.5 + 8;
    let up = DECK;
    let last = null;
    for (let i = 0; i < 6 && f < span * 0.5 - 10; i++) {
      const s = (R() - 0.5) * 14;
      const len = 22 + R() * 12;
      const thick = 1.5 + R() * 0.7;
      /**
       * The root plate: thin along the road, wide across it, standing on
       * edge the way a windthrown pine's does. It is the step up onto the
       * trunk.
       */
      this._rock(site, f, up, s, 2.2, 5.5, 2.6, 0x5a4230, 'tree',
        { anchor: 'root', roll: (R() - 0.5) * 0.4 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        this._at(B.rod, site, f + Math.cos(a) * 1.2, up * 0.5 + Math.sin(a) * 4,
          s, 0.34, 4 + R() * 3, 0.34, 0x4a3628, a);
      }
      // The trunk, lying along the road with a slight lean. A chain of
      // pads, so it is one continuous surface however the road runs.
      const lean = (R() - 0.5) * 0.10;
      for (let k = 0; k < 6; k++) {
        const ff = f + 3 + (len * k) / 6;
        const ss = s + lean * ((len * k) / 6) * 2;
        this._at(B.rod, site, ff, up, ss, thick, len / 5.2, thick, 0x6b5236,
          Math.PI / 2);
        this._solid(site, ff, up - thick * 0.2, ss, len / 11, thick * 0.78,
          thick * 0.8, 'deck');
        last = this._piece(site, ff, up + thick * 0.58, ss, len / 11,
          thick * 0.8, 'trunk');
      }
      // A branch stub up off the trunk, with an anchor on it: something to
      // swing from where the next trunk is too far to step to.
      const bf = f + 3 + len * 0.6;
      this._at(B.rod, site, bf, up + 3.4, s, 0.55, 7, 0.55, 0x5a4430, 0.3);
      this._anchorAt(site, bf, up + 6.4, s, 2.6);
      // Needles and moss on the upper side.
      for (let k = 0; k < 10; k++) {
        this._at(B.cone, site, f + 3 + R() * len, up + thick * 0.6,
          s + (R() - 0.5) * 4, 1.6, 2.6, 1.6, 0x3f6a2f, R() * 3);
      }
      f += len * 0.72 + gap;
      up += 1.1;
    }
    /**
     * The far bank, where the road comes out from under the windfall. The
     * exit is here rather than on the last trunk, because a crossing ends
     * where you are back on the road.
     */
    const end = span * 0.5 - 4;
    this._pad(site, end, 0, 0, 6, 9, 4, 0x6b5a3a, 'deck',
      { anchor: 'bank', exit: true });
    if (last) {
      // A last trunk lying down onto that bank, so the descent is walked.
      const drop = last.up;
      const steps = Math.max(1, Math.ceil(drop / 1.6));
      for (let i = 0; i < steps; i++) {
        this._pad(site, last.f + 3 + i * 2.8, drop - (drop * (i + 1)) / steps,
          last.s, 1.6, 1.7, 1.6, 0x6b5236, 'deck', { anchor: 'trunk' });
      }
    }
    /**
     * THE CUTTERS' SKID-POLE, standing against a tree at the roadside with
     * a rope round it — the pole they roll trunks with, left where they
     * left everything else. Cut the rope from anywhere and it comes down
     * along the verge as a flat run past the first two trunks.
     *
     * It is at the FIRST of the eight deliberately: this is where a player
     * learns that a rope with a light on it is a thing you can throw a
     * kunai at, and the lesson is cheap here because the crossing is a
     * tier-0 hop either way.
     *
     * s = −14 keeps it clear of both the trunks (which reach −11 once
     * their colliders are grown) and the ramp out of the catch (s = 0).
     */
    this._lash(site, { f: -span * 0.5 + 6, s: -14, len: 24, fall: 1 });
    /**
     * AND THE BRASH, LAST, so it can see the route and leave it alone.
     *
     * Three piles of tops and branches across the way. They are the reason
     * this is an obstacle at all: the road under them is graded flat, and
     * without something solid on it a "windfall" is a scattering of logs
     * you stroll between. See `_blockage`, including why it runs last.
     */
    const PILES = 3;
    for (let i = 0; i < PILES; i++) {
      const f0 = -span * 0.28 + (span * 0.56 * i) / (PILES - 1);
      this._blockage(site, f0 - 4, f0 + 4, 4.6, 0x4a3f2c, 'tree');
    }
    /**
     * And the road under it all, which is the catch. `_catch` sees that the
     * ground here is at route level and builds nothing: you fall off a
     * trunk, land on the road between two piles of brash, and walk back to
     * the ramp. See the note there about why a built shelf would be buried.
     */
    this._catch(site, -span * 0.5 + 10, span * 0.5 - 8, 6, 'roots');
  }

  /**
   * ═══ A WAY UP BEHIND A WATERFALL ═══════════════════════════════════════
   *
   * The river drops off a shelf. Behind the sheet of water there is a slot
   * in the rock with wet ledges up it, each an outcrop of the wall behind
   * it — which is what makes it a route rather than a staircase.
   *
   * The catch is the plunge pool: you land in water and the climb starts
   * again from the bottom.
   */
  _waterfall(site) {
    const B = this._b;
    const R = this.rnd;
    /**
     * ═══ THE SLOT, AND WHAT IS AROUND IT ══════════════════════════════
     *
     * Written as a set of extents rather than as a sequence of parts,
     * because the first version had the cliff mass at f 0..16 and the
     * climb at f ≈ 0 — the ledges were INSIDE the rock they were supposed
     * to be cut into, which collision resolves by shoving the frog out of
     * the mountain. Nothing in a headroom check finds that; only writing
     * down where each mass begins and ends does.
     *
     *   SLOT     f −5 … 9      the climb, between walls at s = ±8.5
     *   CLIFF    f 14 … 30     the mass of rock, BEHIND the slot
     *   LIP      f −14 … −6    what the water pours off, above the pool
     *   POOL     f −22 … −4    where you land, and the sheet of water
     *
     * ═══ AND HOW BIG THE STEPS IN IT ARE ══════════════════════════════
     *
     * WHY THIS IS NOT SIZED BY `gap`. Every other site sets its spacing
     * from the region's rung, but a rung is a HORIZONTAL gap and these
     * steps are mostly vertical, where the arithmetic is different: a jump
     * peaks at 3.6 units, and it is only 3.2 up about a third of a second
     * in, by which time run speed has carried it five units sideways.
     * So a 3.2 rise leaves about five units of lateral reach and no more.
     * The first draft used `gap * 0.42` and ±8 across, asking for 7 up and
     * 16 across in a tier-1 region — not a hard climb, an impossible one.
     *
     * ACROSS IS 4.5 AND THE LEDGES ARE 4.8 WIDE, and the two have to be
     * checked against each other. A collider is an axis-aligned box, so a
     * ledge on a road that runs diagonally gets an AABB up to 41% wider
     * than the ledge — and at ±2.6 across with ledges nearly five wide,
     * the grown boxes of the two sides OVERLAPPED, which made the ledge
     * above a ceiling 1.6 over the ledge below. Nine units between centres
     * leaves 4.2 of edge-to-edge air at a 3.2 rise, against a measured 8.7
     * available with nothing but a jump — comfortable, and the boxes clear
     * each other by a unit and a half.
     */
    const HOP_UP = 3.2, ACROSS = 4.5, LEDGE = 2.4;
    const rungs = 11;
    const topLedge = HOP_UP * rungs;          // 35.2
    const shelfUp = topLedge + HOP_UP;        // 38.4 — one more rung up
    const rise = shelfUp;
    site.span = 56;

    // The mass of rock, behind the slot.
    this._at(B.box, site, 22, rise * 0.5 - 6, 0, 16, rise + 20, 90, 0x6f6a5c);
    this._solid(site, 22, rise * 0.5 - 6, 0, 8, (rise + 20) * 0.5, 45,
      'cliff');
    // The lip the water pours off, out over the pool.
    this._at(B.box, site, -10, shelfUp + 5, 0, 8, 4, 70, 0x7a7468);
    this._solid(site, -10, shelfUp + 5, 0, 4, 2, 35, 'cliff');
    // The two side walls of the slot.
    for (const sw of [-8.5, 8.5]) {
      this._at(B.box, site, 2, rise * 0.5 - 4, sw, 14, rise + 8, 2.0,
        0x655f54);
      this._solid(site, 2, rise * 0.5 - 4, sw, 7, (rise + 8) * 0.5, 1.0,
        'cliff');
    }
    // The floor of the slot, which is where the climb starts.
    this._pad(site, -1, 0, 0, 4, 6, 3, 0x5f5a50, 'deck',
      { anchor: 'wall', entry: true });
    let up = HOP_UP;
    let s = -ACROSS;
    for (let i = 0; i < rungs; i++) {
      /**
       * A SHELF, NOT A BOULDER: 1.3 of body under it, not 2.4.
       *
       * A rock's collider hangs `depth` below its surface and `depth`
       * again below that — see `_rock` — so at 2.4 each ledge reached 4.8
       * down, which is more than the 3.2 spacing twice over. The ledge two
       * rungs up on the same side had its underside 1.6 above your feet:
       * a climb the frog cannot stand up in. At 1.3 the clearance is 3.8.
       */
      const w = LEDGE + R() * 0.4;
      this._rock(site, -1 + R() * 2, up, s, w, w, 1.3, 0x5f5a50, 'deck',
        { anchor: 'wall', roll: R() * 0.3 });
      // A root out of a crack every third ledge: the tongue is a way to
      // skip a stretch of the climb for anyone who would rather.
      if (i % 3 === 2) {
        this._at(B.rod, site, -3, up + 2.6, s, 0.5, 5.4, 0.5, 0x4a4030, 0.4);
        this._anchorAt(site, -3, up + 5, s, 2.4);
      }
      up += HOP_UP;
      s = -s;
    }
    /**
     * The top: a shelf out onto the upper river, one rung above the last
     * ledge and inside the slot's far end so it is not in the cliff.
     */
    this._pad(site, 6, shelfUp, 0, 3.5, 6, 2.4, 0x7a7468, 'deck',
      { anchor: 'wall', exit: true });

    /**
     * THE WATER ITSELF — a sheet down the front of the slot, so the route
     * is genuinely BEHIND it. Two planes slightly apart, because one flat
     * card reads as a pane of glass.
     */
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(this.geos.plane, this.mats.spray);
      const d = site.dir;
      m.position.set(d.x * (-6 - i * 1.6), site.y + rise * 0.5 - 2,
        d.z * (-6 - i * 1.6));
      m.rotation.y = Math.atan2(d.x, d.z) + Math.PI / 2;
      m.scale.set(26, rise + 8, 1);
      m.renderOrder = 3;
      site.group.add(m);
    }
    /**
     * THE PLUNGE POOL is the catch, and it is only just below the slot
     * floor — you land in the water and wade out onto the rock. There is
     * no ramp because there is nothing to climb: 0.6 is a step.
     */
    this._catch(site, -18, 4, 0.6, 'roots');
    this._water(site, -22, -4, -0.6);

    if (site.spec.spur) {
      /**
       * THE SPUR: the dry chamber the mire folk left offerings in, out
       * through a break in the slot's east wall near the top — so it is
       * visible for most of the climb and takes a flip across fifteen
       * units of air, or the tongue off the anchor above it.
       *
       * s = 13 puts it clear of the wall (which occupies 7.5 to 9.5) and
       * f = 11 clear of the cliff mass (which starts at 14).
       */
      const f = 11, sp = 13, sup = 30;
      this._pad(site, f, sup, sp, 2.4, 2.4, 1.6, 0x8a8478, 'deck',
        { anchor: 'wall', optional: true, grapple: true });
      this._at(B.rod, site, f, sup + 1.8, sp, 0.9, 2.4, 0.9, 0xc4bfae);
      this._at(B.box, site, f, sup + 3.3, sp, 2.2, 0.6, 2.2, 0xb4af9e);
      this._anchorAt(site, f, sup + 4.2, sp, 2.8);
      site.spur = { f, up: sup, s: sp, what: site.spec.spur.what };
    }
  }

  /**
   * ═══ A CUTTING THAT CAME DOWN ══════════════════════════════════════════
   *
   * The hillside is on the road. You go over the slide: boulders that
   * rolled and settled into the heap, and the shoring timbers the quarry
   * gangs braced against the cut face before they left. Nothing is in the
   * air — every boulder is resting in spoil and every timber has one end
   * on the road and one against rock.
   */
  _landslide(site) {
    const B = this._b;
    const R = this.rnd;
    const gap = site.rungs[0].gap;
    const span = 30 + gap * 2;
    site.span = span;

    // The cut face on the uphill side.
    this._at(B.box, site, 0, 8, -22, span + 20, 26, 14, 0x6f6a5c);
    this._solid(site, 0, 8, -22, (span + 20) * 0.5, 13, 7, 'cliff');
    // The road either side of the slide.
    this._pad(site, -span * 0.5, 0, 0, 6, 9, 4, 0x9a9184, 'deck',
      { anchor: 'abutment', entry: true });
    this._pad(site, span * 0.5, 0, 0, 6, 9, 4, 0x9a9184, 'deck',
      { anchor: 'abutment', exit: true });

    /**
     * ═══ THE SPOIL, WHICH IS WHAT SHUTS THE ROAD ═══════════════════════
     *
     * Thirty units of hillside on the carriageway, five and a half deep.
     * It is what makes this an obstacle: the road under it is graded flat,
     * so without something solid standing on it a "landslide" is a few
     * decorative rocks beside a clear road.
     */
    // The scree you scramble up onto the heap at either end, and down the
    // far side. Walked, per `_rampUp`. (The heap itself goes in last, so
    // it can see the route and leave it alone — see `_blockage`.)
    // 8.5 clears the 7.4 the spoil reaches, for the same reason the Fallen
    // Mile's timber sits at 7.6: a boulder inside the heap is not a
    // boulder you can stand on.
    /**
     * ═══ THE ROUTE OVER THE SLIDE IS THE SHORING ═══════════════════════
     *
     * Up the verge at s = 13 to the height of the timbers, then in to
     * them, along the three of them, and back down the far verge.
     *
     * The boulders on the heap are scenery you may hop on — marked
     * optional — rather than the line. They were the line at first and it
     * does not work: a boulder's body hangs eight units below its top, so
     * the scree ramps climbing the ends of the heap ran underneath them
     * and every tread had a rock over it. Timbers a gang braced from the
     * road into the cut face are a better answer anyway. They are flat,
     * they are eleven units apart, which is the hop this region is rated
     * for, and somebody put them there on purpose.
     */
    const SHORE = 12.6;
    for (const end of [-1, 1]) {
      /**
       * BOTH ramps on the DOWNHILL verge, at s = +17.
       *
       * Not ±17: the cut face is on the uphill side at s = −22 with a
       * fourteen-unit collider, so a ramp at −17 climbs up the inside of
       * the hillside. The downhill verge at +17 is clear of both the face
       * and the boulder field, whose grown colliders reach about ±11.
       */
      const top = this._rampUp(site, end * (span * 0.5 - 2), -end, SHORE,
        17, 17, 0x7a7266, 'rubble');
      this._rampUp(site, top.f - end * 2, -end, SHORE, 17, 0,
        0x7a7266, 'rubble');
    }

    /**
     * The boulders that rolled and settled ON the heap. The gaps are
     * between BOULDERS, which is what crossing a slide is actually like —
     * you are not jumping between stones in space, you are picking a line
     * over a pile — and they are gaps in the air above the spoil, which is
     * the only kind of gap the terrain cannot fill in.
     */
    let up = 8.5;
    for (let i = 0; i < 6; i++) {
      // Held to the middle third, clear of the scree ramps at either end:
      // a boulder's body hangs eight units below its top, so one sitting
      // over a ramp tread is a tread you cannot stand up on.
      const f = -12 + 24 * (i / 5);
      /**
       * EVERY BOULDER IS ON THE UPHILL SIDE, s = −16 … −1.
       *
       * They came off the cut face, which is at s = −22, so that is where
       * they are. It is also what keeps the far verge clear for the ramp
       * out of the catch at s = +11: the first version spread them from
       * −12 to +5, and with a boulder's grown collider five units to a
       * side, one of them sat directly over a ramp tread — a shelf you
       * climb out on that runs through the inside of a rock.
       */
      const s = -6 + i * 2.4 + (R() - 0.5) * 3;
      const sz = 4 + R() * 3;
      /**
       * SCENERY, NOT SURFACE — visual and collider, and no `_piece`.
       *
       * They are the rocks that came down, and you can scramble on them
       * if you like, but the DESIGNED line over the slide is the shoring.
       * Registering them as traversal surfaces made a claim the geometry
       * cannot keep: they sit in a heap under the walkway to the timbers,
       * so several of them had a plank a unit over their tops, and a
       * surface you cannot stand up on should not be offered as one.
       *
       * Shallow bodies too — 0.3 of their width rather than 0.8 — so a
       * boulder is a rock resting in spoil and not an eight-unit slab
       * hanging over whatever passes below.
       */
      const g = this._ground(site, f, s);
      const top = Math.max(up, g + 0.05);
      const depth = sz * 0.3;
      this._at(B.blob, site, f, top - depth, s, sz, depth, sz,
        R() < 0.5 ? 0x7a7468 : 0x8a8478, R() * 0.3);
      this._solid(site, f, top - depth, s, sz * 0.72, depth, sz * 0.72,
        'rock');
      /**
       * Held under ten units, which keeps every boulder a clear stride
       * below the shoring at 12.6. They rose to 15.7 at first and the
       * higher ones roofed the walkway in to the timbers.
       */
      up += (i < 3 ? 0.5 : -0.4);
    }
    // Loose spoil filling in underneath, so nothing reads as a floating rock.
    for (let i = 0; i < 40; i++) {
      const sz = 1.2 + R() * 2.4;
      this._at(B.blob, site, -span * 0.5 + R() * span, sz * 0.3,
        -16 + R() * 26, sz, sz * 0.7, sz,
        R() < 0.5 ? 0x6f6a5c : 0x7a7266, R() * 3);
    }

    /**
     * THE SHORING the gangs left: timbers braced from the road into the cut
     * face. It is the high line across, and it is the reason a player
     * believes somebody was here and gave up.
     */
    for (let i = 0; i < 3; i++) {
      const f = -8 + i * 11;
      this._at(B.rod, site, f, 6, -8, 0.8, 18, 0.8, 0x6b4a2a, 0.5);
      this._solid(site, f, 6, -8, 0.9, 9, 0.9, 'stone');
      this._pad(site, f, 12.6, 0, 1.6, 9, 1.2, 0x7a5a3a, 'deck',
        { anchor: 'shoring', roll: 0.1 });
      this._anchorAt(site, f, 13.1, 6, 2.4);
    }
    // Thirty units of hillside on the carriageway, five and a half deep,
    // last so it leaves the route alone.
    this._blockage(site, -span * 0.26, span * 0.26, 5.5, 0x6f6a5c, 'stone');
    // The ramp out goes up the DOWNHILL verge, at s = +11, because the
    // slide came down across the road from the cut face on the other side.
    this._catch(site, -span * 0.5 + 6, span * 0.5 - 6, 4, 'rubble', 11);
  }

  /**
   * ═══ A KEEP WITH ITS STAIR GONE ════════════════════════════════════════
   *
   * Inside a tower whose stair fell in. Up through the building: a fallen
   * pillar as a ramp to the first floor, the broken edges of the floors
   * above, a balcony out through a window, and a shaft at the top narrow
   * enough to kick off both sides.
   *
   * Every piece is a piece of the building. The floors are attached to the
   * wall they are still keyed into; the pillar is lying where it fell.
   */
  _keep(site) {
    const B = this._b;
    const rise = 34;
    site.span = 30;

    // The shell: three walls and two jambs, with the near face open so you
    // can see in and see what you are climbing.
    for (const [f, s, w, d] of [[0, -13, 13, 1.4], [0, 13, 13, 1.4],
      /**
       * The east wall in two halves, with a five-unit window between
       * them at s = 0 — because the balcony goes THROUGH it, and a
       * balcony inside a solid wall is a balcony inside a wall. The gap
       * is the window it was reached through.
       */
      [13, -8.5, 1.4, 4.5], [13, 8.5, 1.4, 4.5]]) {
      this._at(B.box, site, f, rise * 0.5, s, w * 2, rise, d * 2, 0x8a8478);
      this._solid(site, f, rise * 0.5, s, w, rise * 0.5, d, 'wall');
    }
    for (const s of [-10, 10]) {
      this._at(B.box, site, -13, rise * 0.5, s, 1.4, rise, 6, 0x8a8478);
      this._solid(site, -13, rise * 0.5, s, 0.7, rise * 0.5, 3, 'wall');
    }
    // The ground floor you walk in onto, flush with the road outside.
    this._pad(site, 0, 0, 0, 13, 13, 1.6, 0x9a9184, 'deck',
      { anchor: 'abutment', entry: true });

    /**
     * ═══ THE FALLEN PILLAR, AND THE SLOT IT CLIMBS ═══════════════════
     *
     * One end on the ground floor, the other lodged in the broken edge of
     * the first floor. It is the way up to it, and it lies at the angle a
     * dropped pillar lies at. A chain of pads, so it is a continuous
     * walkable ramp rather than six things to jump between.
     *
     * IT RUNS UP THE MIDDLE, AT s = 0, AND THE FLOORS ARE HELD BACK TO
     * ±8 TO LEAVE IT ROOM. Both numbers are there for one reason: the
     * first version put the pillar at s = −7 to −4, and the first floor
     * slab covers s = −13 to −1, so the top third of the pillar ran
     * UNDERNEATH the slab. A ramp that disappears into a ceiling is a ramp
     * you walk up and bang your head on, and the collider check caught it
     * as a surface half a unit under another surface. The slab pair now
     * leaves a four-unit slot down the middle of the tower and the pillar
     * climbs through it into daylight.
     */
    for (let i = 0; i < 7; i++) {
      const k = i / 6;
      this._at(B.rod, site, -9 + k * 13, 0.8 + k * 8.4, 0,
        1.6, 2.6, 1.6, 0xc4bfae, Math.PI / 2 - 0.55);
      this._solid(site, -9 + k * 13, 0.8 + k * 8.4, 0, 1.4, 1.3, 1.4,
        'deck');
      this._piece(site, -9 + k * 13, 2.1 + k * 8.4, 0, 1.4, 1.4, 'pillar');
    }

    /**
     * THE FLOORS, each a partial slab still keyed into the wall with its
     * broken edge facing in. That broken edge is the platform, and the
     * joists poking out of it are what is holding the slab up. They
     * alternate sides, so getting up is a zig-zag across the tower.
     */
    const floors = [10, 20, 28];
    floors.forEach((up, i) => {
      const s = i % 2 ? 8 : -8;
      this._pad(site, 0, up, s, 11, 6, 1.4, 0x9a9184, 'deck',
        { anchor: 'floor' });
      for (let k = -2; k <= 2; k++) {
        this._at(B.box, site, k * 4.4, up - 0.9, s + (i % 2 ? -7 : 7),
          1.0, 0.7, 5.0, 0x6b4a2a);
      }
      this._anchorAt(site, 0, up + 3.0, 0, 2.8);
      // A balcony out through the wall on the way up: the one place you
      // can see out, and where the spur becomes visible.
      if (i === 1) {
        this._pad(site, 11, up + 5, 0, 1.7, 4, 1.2, 0x9a9184, 'deck',
          { anchor: 'balcony' });
      }
    });

    /**
     * THE SHAFT at the top: two walls six and a half units apart, which is
     * inside a wall jump either way, and the only route to the roof.
     */
    for (const s of [-3.4, 3.4]) {
      this._at(B.box, site, -6, rise - 3, s, 8, 12, 1.2, 0x8a8478);
      this._solid(site, -6, rise - 3, s, 4, 6, 0.7, 'wall');
    }
    this._pad(site, -6, rise + 2, 0, 4, 4, 1.4, 0x9a9184, 'deck',
      { anchor: 'floor', exit: true });

    /**
     * THE FAR DOORWAY, BLOCKED BY THE STAIR THAT FELL THROUGH IT.
     *
     * Which is why you go up and over the roof instead of walking through
     * the tower. Without it the keep is a gatehouse with two open ends and
     * the whole climb is optional decoration — the road runs straight
     * through the ground floor, and a graded road is walkable.
     */
    this._blockage(site, 8, 15, 6.0, 0x9a9184, 'stone');

    // The rubble the stair made is the catch: you fall INSIDE, onto the
    // heap, and start again from the pillar.
    this._catch(site, -11, 11, 0.5, 'stair');

    if (site.spec.spur) {
      /**
       * The pay-chest, on a slab of the collapsed stair still wedged high
       * in a corner. A flip up off the second floor, or the tongue.
       *
       * s = +7 and up = 24 rather than s = −10 and up = 26, because the
       * top floor slab sits at s = −8 with a footprint from −14 to −2 and
       * its underside at 26.6: the first placement put the chest a foot
       * and a half under it, in a space the frog cannot stand up in.
       */
      const f = 6, up = 24, s = 7;
      this._pad(site, f, up, s, 2.5, 2.5, 1.2, 0xc4bfae, 'deck',
        { anchor: 'floor', optional: true, grapple: true, roll: 0.16 });
      this._anchorAt(site, f, up + 3.2, s, 2.6);
      site.spur = { f, up, s, what: site.spec.spur.what };
    }
  }

  /**
   * ═══ AN OLD ROUTE ACROSS A CLIFF ═══════════════════════════════════════
   *
   * The road between the kingdoms, from before there was a road. A cut
   * ledge along the face, gone in two places, with the original pegs still
   * driven into the rock and the ropes still strung between them — which is
   * what you cross the gaps on, and what an NPC will tell you were left by
   * the people who built the route.
   */
  _cliff(site) {
    const B = this._b;
    const gap = site.rungs[0].gap;
    const span = 40 + gap * 3;
    site.span = span;

    /**
     * ═══ THE ROUTE IS OFF THE ROAD, ON THE SHOULDER ════════════════════
     *
     * `_flank` finds how far out the ground has actually fallen away, and
     * the whole traverse is laid along there. That is the difference
     * between a cliff route and a picture of one: inside the road corridor
     * the ground is graded flat, so a "ledge above a drop" has no drop
     * under it and the two gaps in it are ground you walk across.
     *
     * At this site — the Cold Road through the Spine — the shoulder falls
     * thirty-five units at forty-six out. So the old route leaves the road
     * at the rockfall, runs along the face out there, and comes back.
     */
    const FS = this._flank(site, 16) || -26;
    const dropAt = this._ground(site, 0, FS);

    /**
     * ═══ THE FACE IS THE HILLSIDE, WHICH IS ALREADY THERE ══════════════
     *
     * All this adds is a SCARP: a band of rock above the ledge, twelve
     * units tall, so the ledge reads as cut into something.
     *
     * The first version put a ninety-unit slab fourteen thick along the
     * whole traverse, on the uphill side — which is between the road and
     * the ledge. Photographed from the approach it was a featureless grey
     * wall filling the frame with the entire route hidden behind it, and
     * it was redundant besides: the ground already falls thirty-five units
     * away from the road here. The terrain IS the cliff. Adding another
     * one only got in the way of looking at the thing.
     */
    const upS = FS - Math.sign(FS) * 7;
    this._at(B.box, site, 0, 7, upS, span * 0.64, 12, 8, 0x6f6a5c);
    this._solid(site, 0, 7, upS, span * 0.32, 6, 4, 'cliff');

    /**
     * THE LEDGE, cut into the face — there at the ends, gone in the middle.
     * A chain of pads, so it is continuous whichever way the road runs.
     * The two end segments run back in to the road, which is where a
     * crossing has to start and finish.
     */
    this._pad(site, -span * 0.5, 0, 0, 5, 8, 4, 0x9a9184, 'deck',
      { anchor: 'abutment', entry: true });
    this._pad(site, span * 0.5, 0, 0, 5, 8, 4, 0x9a9184, 'deck',
      { anchor: 'abutment', exit: true });
    this._rampUp(site, -span * 0.5 + 5, 1, 0.4, 0, FS, 0x8a8478, 'wall');
    this._rampUp(site, span * 0.5 - 5, -1, 0.4, 0, FS, 0x8a8478, 'wall');

    const segs = [[-span * 0.5 + 16, -span * 0.5 + 26], [-5, 5],
      [span * 0.5 - 26, span * 0.5 - 16]];
    for (const [a, b] of segs) {
      const n = Math.max(1, Math.round((b - a) / 5));
      for (let i = 0; i < n; i++) {
        const f = a + ((b - a) * (i + 0.5)) / n;
        this._pad(site, f, 0.4, FS, (b - a) / (n * 2), 4, 1.6, 0x8a8478,
          'deck', { anchor: 'wall' });
      }
      // A hand line along the walkable stretches, pegged into the face.
      for (let i = 0; i <= n; i++) {
        this._at(B.rod, site, a + ((b - a) * i) / n, 2.0, FS - 3.4,
          0.28, 3.2, 0.28, 0x4a4a52);
      }
    }

    /**
     * THE PEGS AND THE ROPES across the two gaps — which are over real
     * air now: `dropAt` units of it. Each peg is driven into the rock and
     * each rope runs between two pegs, so a swing is off something
     * somebody hammered in. The pegs are `_piece`s as well as anchors:
     * standing on one is a real option, and the reachability proof needs
     * to know they are there.
     */
    for (const [a, b] of [[-span * 0.5 + 26, -5], [5, span * 0.5 - 26]]) {
      const n = Math.max(2, Math.round((b - a) / gap));
      for (let i = 0; i <= n; i++) {
        const f = a + ((b - a) * i) / n;
        this._at(B.rod, site, f, 6.5, FS - 3.4, 0.4, 4.4, 0.4, 0x4a4a52,
          Math.PI / 2);
        this._at(B.blob, site, f, 6.5, FS, 0.7, 0.7, 0.7, 0x3a3a42);
        this._solid(site, f, 6.2, FS, 0.8, 0.35, 0.8, 'deck');
        this._piece(site, f, 6.5, FS, 0.8, 0.8, 'peg', { grapple: true });
        this._anchorAt(site, f, 6.5, FS, 2.8);
        // And the rope on to the next one, sagging.
        if (i < n) {
          const seg = (b - a) / n;
          for (let k = 0; k < 4; k++) {
            const kk = (k + 0.5) / 4;
            this._at(B.rod, site, f + seg * kk,
              6.4 - Math.sin(kk * Math.PI) * 1.6, FS,
              0.13, seg / 3.6, 0.13, 0x6b5a3a, Math.PI / 2);
          }
        }
      }
    }
    /**
     * The ledge below, out where there is room for one: eleven down, or as
     * far down as the shoulder actually goes if that is less. `_catch`
     * refuses to build below the ground, so on a shallower shoulder this
     * quietly becomes "the ground is the catch" instead.
     */
    this._catch(site, -span * 0.5 + 8, span * 0.5 - 8,
      Math.min(11, Math.max(2, -dropAt - 4)), 'stair', FS);
    // The rockfall that shut the road, and why anyone goes round. Last, so
    // it leaves the route alone — see `_blockage`.
    this._blockage(site, -span * 0.14, span * 0.14, 6.5, 0x6f6a5c, 'stone');

    if (site.spec.spur) {
      /**
       * A ledge that keeps going round the shoulder instead of down — a
       * genuine shortcut, which is the best optional reward there is
       * because it is worth something every time you come back.
       *
       * IT RUNS LEVEL, rising half a unit a ledge. Not decoration: the
       * first version climbed 1.6 a ledge with the ledges 1.4 thick and
       * their footprints overlapping, so each one's underside was two
       * tenths of a unit above the one below it. A shortcut you have to
       * crawl through is not a shortcut, and a ledge that carries on round
       * a shoulder is level anyway — that is what makes it a shortcut
       * rather than a climb.
       *
       * AND IT STAYS ON THE FACE, at the traverse's own offset. The face
       * itself sits ten units further out; the first version stepped the
       * spur three units FURTHER out each ledge, straight into the rock,
       * so all five were inside the mountain. On a cliff route "further
       * round" is along the face, not into it.
       */
      const f = span * 0.5 - 14;
      for (let i = 0; i < 5; i++) {
        this._pad(site, f + i * 5, 7 + i * 0.5, FS, 2.4, 2.8, 1.2,
          0x8a8478, 'deck', { anchor: 'wall', optional: true });
      }
      site.spur = { f: f + 20, up: 9, s: FS, what: site.spec.spur.what };
    }
  }

  /**
   * ═══ A STAIR THAT IS STILL FALLING ═════════════════════════════════════
   *
   * Basalt steps up the cone, with flights missing where they went into the
   * vents below. Everything standing is keyed into the cone; the blocks
   * that fell are wedged across the shaft and are the catch.
   */
  _crumble(site) {
    const B = this._b;
    const R = this.rnd;
    const gap = site.rungs[0].gap;
    const rise = 44;
    /**
     * Three flights of five treads and two missing flights, CENTRED on the
     * site's own origin — because `siteAt` and the settlement-clearance
     * check both measure from there, and a stair laid out from f = −26
     * forwards puts its top a hundred and forty units away from the point
     * the rest of the game thinks this site is at.
     */
    const run = 3 * 5 * 4.4 + 2 * gap;
    site.span = run + 30;

    /**
     * ═══ THE STAIR IS OUT ON THE CONE'S FLANK ══════════════════════════
     *
     * Where the ground has actually fallen away — eighty-three units at
     * forty-six out, here, which is the biggest relief any of the eight
     * sites has under it. Inside the road corridor the ground is graded
     * flat, so a "flight dropped into the vents" would have been a gap in
     * the road with solid ground across it: an obstacle you walk through.
     */
    const FS = this._flank(site, 25) || -22;

    /**
     * A BAND OF BASALT above the stair, and no more than that — the cone
     * itself is terrain, and the ground here falls eighty-three units away
     * from the road. See the same note in `_cliff`: a full-height slab on
     * the uphill side of a flank route is a grey wall between the player
     * and the route, standing in for a hillside that already exists.
     */
    const upS = FS - Math.sign(FS) * 8;
    this._at(B.box, site, 0, 8, upS, run * 0.7, 14, 10, 0x3a3138);
    this._solid(site, 0, 8, upS, run * 0.35, 7, 5, 'cliff');
    void rise;

    /**
     * Three flights standing and two gone, and the gone ones are where the
     * vents are — which is why they went.
     */
    const start = -run * 0.5;
    let f = start;
    let lastPad = null;
    /**
     * THE STAIR FOLLOWS THE ROAD'S OWN GRADE.
     *
     * `up` for each tread is the height of the ROAD at that point along,
     * plus a step — so the flight stays level with the way it is a detour
     * from, and out at `FS` it is a shelf standing over the drop. The first
     * version climbed 1.9 a tread for a hundred and seventy units, which
     * put its top thirty-six units above the road it was supposed to rejoin
     * — a staircase to nowhere with a thirty-six unit fall at the end.
     */
    const tread = (ff) => this._ground(site, ff, 0) + 1.2;
    // The road at the near end, and the scramble out to the stair's foot.
    this._pad(site, start - 6, this._ground(site, start - 6, 0), 0, 5, 8, 4,
      0x4a4148, 'deck', { anchor: 'abutment', entry: true });
    this._rampUp(site, start - 2, 1, tread(start), 0, FS, 0x4a4148, 'wall');
    /** Where the basalt columns stand, so the shelf leaves them room. */
    const columns = [];
    for (let flight = 0; flight < 5; flight++) {
      if (flight === 1 || flight === 3) {
        /**
         * A MISSING FLIGHT, and the column standing in the hole.
         *
         * The vent is `gap` wide — fifty-two units in the Cindermaw — and
         * that is past anything a jump and a dash together reach. So there
         * is a basalt column standing IN the gap at the half-way point,
         * which splits it into two jumps of about twenty-three each: a
         * flip and a dash, or the tongue off the ring at the top.
         *
         * The first version put the column BESIDE the flight instead, at
         * the near edge of the gap and sixteen units above it. Grappling
         * it from the stair got you to a point you were already standing
         * next to, and there was nothing else within reach on the far
         * side — a fifty-two unit gap with no answer at all. A column in
         * the middle of the vent is also the more honest picture: it is
         * the plug of basalt the stair was cut around.
         */
        const cf = f + gap * 0.5;
        const ctop = tread(cf) + 0.6;
        // The vent itself, glowing, down in the air below the gap.
        this._at(B.box, site, cf, ctop - 16, FS, gap * 0.7, 5, 9, 0x1a1216);
        this._at(B.lamp, site, cf, ctop - 14.4, FS, gap * 0.4, 0.5, 4,
          0xff7a3c);
        // The column: up out of the vent, top a little above the stair.
        this._at(B.rod, site, cf, ctop - 30, FS, 3.2, 60, 3.2, 0x2f272c);
        this._solid(site, cf, ctop - 30, FS, 3.4, 30, 3.4, 'stone');
        this._pad(site, cf, ctop, FS, 3.0, 3.0, 1.4, 0x554b52, 'deck',
          { anchor: 'column' });
        this._anchorAt(site, cf, ctop + 3.6, FS, 3.0);
        columns.push({ f: cf, r: 9 });
        f += gap;
        continue;
      }
      for (let i = 0; i < 5; i++) {
        lastPad = this._pad(site, f, tread(f), FS, 2.2, 4.5, 2.0,
          R() < 0.5 ? 0x4a4148 : 0x554b52, 'deck', { anchor: 'wall' });
        f += 4.4;
      }
    }
    /**
     * And back onto the road above the rockfall — a crossing ends where
     * you can walk on again.
     */
    this._rampUp(site, f, 1, tread(f), FS, 0, 0x4a4148, 'wall');
    site.exit = this._pad(site, f + 6, this._ground(site, f + 6, 0), 0,
      5, 8, 4, 0x4a4148, 'deck', { anchor: 'abutment', exit: true });
    void lastPad;
    this._catch(site, start + 4, f - 4, 9, 'stair', FS, columns);
    // The rockfall that shut the road, so the stair is the way on. Last,
    // so it leaves the route alone — see `_blockage`.
    this._blockage(site, -12, 12, 7.0, 0x3a3138, 'stone');
  }

  /**
   * ═══ A HUNDRED UNITS OF CAUSEWAY IN A CHASM ════════════════════════════
   *
   * The hardest one, and the only site where the drop is genuinely a drop:
   * the pylon shafts run a hundred and twenty units down and out of sight,
   * so you can see what is under you. The pylons that carried the causeway
   * are still standing and the ropes travellers strung between them are
   * still on them.
   *
   * Even here there is a catch — a shelf thirty units down with a ramp back
   * up — because the alternative is a two-hundred-unit fall for a mistimed
   * swing, and this is a road rather than a boss.
   */
  _canyon(site) {
    const B = this._b;
    const R = this.rnd;
    const gap = site.rungs[0].gap;
    const span = 40 + gap * 3;
    site.span = span;

    /**
     * ═══ THE PYLONS STAND OUT OVER THE REAL DROP ═══════════════════════
     *
     * `_flank` finds it: at this site the ground falls ninety-one units at
     * sixty-four out, the deepest relief under any of the eight. Which is
     * the whole point — the road corridor itself is graded flat, so a
     * "hundred units of causeway in the chasm" laid across the road was a
     * hundred units of solid ground with some stonework standing in it,
     * and the drop the player was supposed to be frightened of was two
     * feet of kerb.
     *
     * So the causeway swings out round the collapse, over the side of the
     * gorge, and the shafts genuinely disappear.
     */
    const FS = this._flank(site, 30) || -34;
    const floor = this._ground(site, 0, FS);

    for (const end of [-1, 1]) {
      const f = end * span * 0.5;
      // The standing end of the causeway, flush with the road.
      this._pad(site, f, 0, 0, 8, 11, 8, 0x8a8478, 'deck',
        { anchor: 'abutment', entry: end < 0, exit: end > 0 });
      // The broken lip, out where the causeway left the hillside.
      const fs = f - end * 13;
      this._pad(site, fs, 0.4, FS, 4, 8, 1.6, 0x9a9184, 'deck',
        { anchor: 'abutment' });
      this._rampUp(site, f - end * 4, -end, 0.4, 0, FS, 0x8a8478,
        'abutment');
      /**
       * The parapet blocks still on the broken end are DECORATION — no
       * collider. There is nothing they need to stop (the lip they sit on
       * is the thing you are aiming for, not a thing you fall off), and
       * solid they sat over the walkway coming back in from the shelf.
       */
      for (const s of [-5, 5]) {
        this._at(B.box, site, fs, 1.3, FS + s, 8, 1.8, 1.6, 0x8a8478,
          R() * 0.1);
      }
    }

    /**
     * THE PYLONS. Piers of the causeway, caps at about road level and a
     * ring of iron on top that somebody tied a rope to. The shafts run
     * down past the floor of the gorge and out of sight: seeing one
     * disappear IS the drop.
     */
    const pylons = [];
    /**
     * At least four bays, so at least three pylons stand in the gap.
     * `round((span − 30) / gap)` alone gives three bays and two pylons at
     * the Sunderway's numbers, and two lonely posts across a hundred and
     * seventy units does not read as a causeway that fell — it reads as
     * two posts. Three at forty-one apart is still well inside the tongue.
     */
    const n = Math.max(4, Math.round((span - 30) / gap));
    for (let i = 1; i < n; i++) {
      const f = -span * 0.5 + 15 + ((span - 30) * i) / n;
      const up = 0.4 - (i % 2) * 2.5;
      const shaft = Math.max(40, up - floor + 30);
      this._at(B.rod, site, f, up - shaft * 0.5, FS, 3.0, shaft, 3.0,
        0x7a7468);
      this._solid(site, f, up - shaft * 0.5, FS, 3.2, shaft * 0.5, 3.2,
        'stone');
      this._pad(site, f, up, FS, 3.5, 3.5, 1.8, 0x9a9184, 'deck',
        { anchor: 'pier' });
      // The ring, and the anchor on it.
      this._at(B.rod, site, f, up + 3.4, FS, 0.4, 4.4, 0.4, 0x4a4a52);
      this._at(B.blob, site, f, up + 5.6, FS, 0.9, 0.9, 0.9, 0x3a3a42);
      this._anchorAt(site, f, up + 5.6, FS, 3.0);
      pylons.push({ f, up });
    }
    /**
     * AND THE ROPES between them, sagging. Not decoration: the anchors sit
     * on the rings the ropes are tied to, so a player who looks at a rope
     * and presses the grapple key gets the swing the rope implies.
     */
    for (let i = 0; i < pylons.length - 1; i++) {
      const a = pylons[i], b = pylons[i + 1];
      for (let k = 0; k < 8; k++) {
        const kk = (k + 0.5) / 8;
        this._at(B.rod, site, a.f + (b.f - a.f) * kk,
          a.up + (b.up - a.up) * kk + 5.4 - Math.sin(kk * Math.PI) * 3.4, FS,
          0.16, (b.f - a.f) / 7, 0.16, 0x6b5a3a, Math.PI / 2);
      }
    }
    /**
     * The shelf, with a hole round each pylon, as far down as the gorge
     * actually goes — capped at thirty, because a two-hundred-unit fall
     * for a mistimed swing would make this the one obstacle in the country
     * nobody attempts twice, and this is a road rather than a boss.
     */
    this._catch(site, -span * 0.5 + 14, span * 0.5 - 14,
      Math.min(30, Math.max(3, -floor - 8)), 'stair', FS,
      pylons.map((p) => ({ f: p.f, r: 9 })));
    // The collapsed span, filling the road so the swing is the way on.
    // Last, so it leaves the route alone — see `_blockage`.
    this._blockage(site, -16, 16, 7.5, 0x8a8478, 'stone');

    if (site.spec.spur) {
      const p = pylons[Math.floor(pylons.length / 2)];
      const s = FS + Math.sign(FS) * 22;
      const shaft = Math.max(40, p.up - this._ground(site, p.f, s) + 30);
      this._at(B.rod, site, p.f, p.up - shaft * 0.5, s, 2.4, shaft, 2.4,
        0x7a7468);
      this._solid(site, p.f, p.up - shaft * 0.5, s, 2.6, shaft * 0.5, 2.6,
        'stone');
      this._pad(site, p.f, p.up + 1.7, s, 2.7, 2.7, 1.4, 0x9a9184, 'deck',
        { anchor: 'pier', optional: true, grapple: true });
      this._anchorAt(site, p.f, p.up + 4.6, s, 2.8);
      site.spur = { f: p.f, up: p.up + 1.7, s, what: site.spec.spur.what };
    }
  }

  /**
   * Nothing to do but count.
   *
   * Deliberately does NOT bake: the overworld folds these steps into its
   * own loading list and bakes the whole world once afterwards. Baking here
   * would be harmless but pointless, and it would hide the real rule —
   * everything in this file must be registered BEFORE that one bake.
   */
  _finish() {
    this.pieces = this.sites.reduce((n, s) => n + s.pieces.length, 0);
  }

  // ───────────────────────────────────────────────────────────────── frame ──

  /**
   * Show the one you are near and hide the rest.
   *
   * Each site is its own group of five instanced meshes, so at most one
   * site's worth of draw calls is ever submitted — and a site is a few
   * hundred instances, a rounding error next to the region it stands in.
   */
  update(dt, px, pz) {
    this.t += dt;
    for (const s of this.sites) {
      const show = Math.hypot(px - s.at.x, pz - s.at.z) < SHOW;
      if (s.group.visible !== show) s.group.visible = show;
      // A cut beam keeps falling whether or not you are watching it, so
      // this is outside the visibility test — it takes a second and a
      // player who cuts a rope and runs would otherwise come back to a
      // beam still standing.
      for (const L of s.lashings) L.update(dt);
    }
  }

  /**
   * EVERY ROPE STILL HOLDING A BEAM UP, as something combat can hit.
   *
   * Folded into the overworld's own `targets()`, so a thrown kunai and a
   * katana swing both reach them through the one path everything else
   * uses. Only uncut ropes are offered: a target with `dead` true is one
   * combat has to keep filtering, and a rope that has been cut is gone.
   */
  targets(list) {
    for (const s of this.sites) {
      if (!s.group.visible) continue;
      for (const L of s.lashings) {
        if (!L.cut) list.push(L.target());
      }
    }
    return list;
  }

  /** Every lashing across all sites. For the HUD and the tests. */
  lashings() {
    const out = [];
    for (const s of this.sites) for (const L of s.lashings) out.push(L);
    return out;
  }

  /**
   * A point in a site's frame, in world coordinates.
   *
   * The frame `_at` and `_solid` use. This is how anything OUTSIDE this
   * file — a chest on a spur, a marker on the map, a test measuring a gap —
   * asks where a piece actually ended up.
   */
  worldOf(site, f, up, s) {
    const d = site.dir;
    return {
      x: site.at.x + d.x * f - d.z * s,
      y: site.y + up,
      z: site.at.z + d.z * f + d.x * s,
    };
  }

  /**
   * THE OPTIONAL LINES, and what is at the end of each.
   *
   * Handed out rather than acted on here, because the reward for a spur is
   * a chest or a shrine and this file knows nothing about loot tables. The
   * overworld turns each into a real prop; see `_placeSpurs`.
   */
  spurs() {
    const out = [];
    for (const s of this.sites) {
      if (!s.spur) continue;
      const at = this.worldOf(s, s.spur.f, s.spur.up, s.spur.s);
      out.push({
        site: s, id: `traverse:${s.spec.id}`, what: s.spur.what,
        why: s.spec.spur.why, at,
        // Facing back the way you came, so you read it as you arrive.
        yaw: lookYaw(at.x, at.z, s.at.x, s.at.z),
      });
    }
    return out;
  }

  /** The site the player is standing in, or null. For the HUD and the tests. */
  siteAt(x, z) {
    for (const s of this.sites) {
      if (Math.hypot(x - s.at.x, z - s.at.z) < s.span * 0.5 + 40) return s;
    }
    return null;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const o of this.owned) {
      if (o && o.dispose) { try { o.dispose(); } catch (e) { /* gone */ } }
    }
    this.owned.length = 0;
    this.sites.length = 0;
  }
}

/**
 * ═══ THE THINGS THAT CAN HOLD A PIECE UP ════════════════════════════════
 *
 * The whole rule of this file, as a list. Every traversal piece names one
 * of these, `_piece` throws on anything else, and a test asserts that no
 * piece anywhere is unattached.
 *
 * There is no `'none'`, and that omission IS the design: if a platform
 * cannot be explained by something in the world that would physically hold
 * it there, it does not get built. That is the difference between a bridge
 * that fell and twenty blocks hanging in the sky.
 */
export const ANCHORS = new Set([
  'abutment',   // cut into the bank at either end of a crossing
  'pier',       // a bridge pier or a causeway pylon, standing in the gap
  'wall',       // an outcrop or a ledge cut into a rock face
  'floor',      // a partial floor still keyed into a building's wall
  'balcony',    // off the outside of a wall
  'pillar',     // a fallen column, lying where it landed
  'trunk',      // a windthrown tree, root plate still in the ground
  'root',       // a root plate, or a root out of a bank
  'rubble',     // resting in the heap it slid into
  'shoring',    // a timber braced against a cut face
  'peg',        // an iron pin driven into rock, with a rope on it
  'column',     // a basalt column, part of the cone
  'bank',       // the ground at the bottom of the obstacle
]);
