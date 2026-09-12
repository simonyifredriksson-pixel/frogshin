/**
 * THE PLACES — cities, towns, villages, temples, ruins, caves and the odd door.
 *
 * The region table declares a site as a kind, four numbers and a name. This
 * turns each one into somewhere you can walk into: geometry, colliders, a
 * trigger radius the overworld asks about, and — for settlements — a set of
 * spots for the people who live there to stand on.
 *
 * ── architecture ──────────────────────────────────────────────────────────
 * Every region names an `arch` style, and every builder in here reads it. The
 * same "village" code makes reed huts in the Lilyreach, stilts over the
 * Whispermire, marble in the capital, bone in Gravewater and ice in the
 * Frostmarch — so a settlement tells you which region you are in before you
 * have read its name, and adding a region does not mean writing a new village.
 *
 * ── why every site is built at load, and hidden rather than streamed ──────
 * There are about eighty named sites, fifty camp fires, thirty-three boss
 * arenas and twenty-four landmarks across the realm. Building them all once
 * means their COLLIDERS can be baked into the heightfield world in a single
 * pass, which matters: the collision world hashes its boxes into a grid at
 * bake time and nothing ever looks at a box added afterwards, so a structure
 * built later would be scenery you walk straight through.
 *
 * So they are all built, all baked, and then simply not DRAWN unless you are
 * within sight of them. Visibility is a flag; a collider is a commitment.
 *
 * ── the shape of an arena ────────────────────────────────────────────────
 * A ring of standing stones and nothing else. It is a boundary you can see
 * from outside and a landmark you can navigate by, and deliberately not a
 * wall: an open-world boss you cannot walk away from is a dungeon room with
 * extra steps.
 */

import * as THREE from '../lib/three.module.js?v=v125';
import { mulberry32, clamp } from './util.js?v=v125';
import { SEA } from './regions.js?v=v125';
import { buildLandmark } from './landmarks.js?v=v125';
import { ROADS } from './roads.js?v=v125';

/** Shared geometry. Every site draws from these and none of them own any. */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  taper: new THREE.CylinderGeometry(0.7, 1, 1, 7),
  cone: new THREE.ConeGeometry(1, 1, 7),
  sphere: new THREE.SphereGeometry(1, 9, 7),
  low: new THREE.SphereGeometry(1, 7, 5),
  disc: new THREE.CylinderGeometry(1, 1, 1, 14),
  torus: new THREE.TorusGeometry(1, 0.14, 6, 16),
  octa: new THREE.OctahedronGeometry(1, 0),
};

/** Shared materials. Sites are stone, wood, thatch, ice, bone and lantern. */
function makeMats() {
  const L = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0x000000 });
  return {
    stone: L(0x8b8578), stoneDark: L(0x5f5b52), stonePale: L(0xc4bfae),
    marble: L(0xd8d4c6), marbleDark: L(0x9a968a),
    wood: L(0x6b4a2a), woodDark: L(0x452e19), plank: L(0x8a6a42),
    thatch: L(0xb99a5a), reed: L(0xc9b878),
    tile: L(0x8a2f28), tileDark: L(0x5c1f1a),
    rope: L(0xcfc0a0), cloth: L(0xa8543a), clothBlue: L(0x3a6a8a),
    bone: L(0xe0dcd0), boneDark: L(0xa8a496),
    iron: L(0x565f6b), ironDark: L(0x353b45), gold: L(0xc9a227),
    ice: L(0xcfe6f4), iceDeep: L(0x8fb8d8),
    sand: L(0xd8c49a), sandDark: L(0xa8906a),
    obsidian: L(0x2a2226), ash: L(0x4a423c),
    leaf: L(0x2f5f27), leafPale: L(0x8fc44a), bark: L(0x574029),
    crystal: L(0x7a9ad0, 0x223a66),
    // Lanterns and glowing things are their own light source, so they read at
    // dusk and in the Palewood's fog.
    lamp: new THREE.MeshBasicMaterial({ color: 0xffd76b }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff8a3c }),
    pale: new THREE.MeshBasicMaterial({ color: 0xeef4ff }),
    green: new THREE.MeshBasicMaterial({ color: 0x8fe86b }),
    glow: new THREE.MeshBasicMaterial({ color: 0x8fe8ff }),
    water: L(0x3f8fb8, 0x0d3348),
  };
}

/**
 * What a region's buildings are made of, and what shape their roofs are.
 *
 * `roof` is the thing that changes the silhouette most, so it is the thing
 * that most distinguishes one region's architecture from another's: a thatched
 * cone in the marshes, a tiled hip in the capital, a flat sandstone slab in
 * the desert, a steep ice pitch in the north.
 */
const STYLE = {
  reed: { wall: 'wood', trim: 'reed', roof: 'cone', roofMat: 'reed', post: 'woodDark' },
  timber: { wall: 'wood', trim: 'plank', roof: 'hip', roofMat: 'thatch', post: 'woodDark' },
  stilt: { wall: 'plank', trim: 'rope', roof: 'cone', roofMat: 'thatch', post: 'woodDark' },
  stone: { wall: 'stone', trim: 'stoneDark', roof: 'hip', roofMat: 'tile', post: 'stoneDark' },
  marble: { wall: 'marble', trim: 'gold', roof: 'hip', roofMat: 'tile', post: 'marbleDark' },
  bone: { wall: 'boneDark', trim: 'bone', roof: 'cone', roofMat: 'bone', post: 'bone' },
  sandstone: { wall: 'sand', trim: 'sandDark', roof: 'flat', roofMat: 'sandDark', post: 'sandDark' },
  obsidian: { wall: 'obsidian', trim: 'ember', roof: 'flat', roofMat: 'ash', post: 'ash' },
  ice: { wall: 'ice', trim: 'iceDeep', roof: 'steep', roofMat: 'iceDeep', post: 'stonePale' },
  crystal: { wall: 'crystal', trim: 'glow', roof: 'steep', roofMat: 'crystal', post: 'stoneDark' },
};

/** How big a settlement of each kind is. */
const SETTLE = {
  village: { houses: 8, ring: 0.62, well: true, market: 0, wall: false, big: 0 },
  town: { houses: 15, ring: 0.68, well: true, market: 5, wall: false, big: 1 },
  city: { houses: 28, ring: 0.74, well: true, market: 9, wall: true, big: 3 },
};

/**
 * THE SIGNATURE — the one thing you remember a settlement by.
 *
 * A ring of houses round a well is a settlement. It is not a PLACE. What
 * makes somewhere memorable is a single silhouette you can see from outside
 * it and can name afterwards — the great frog at Croakhollow, Harrowmead's
 * mill, the fallen king lying across the square in Anurath — so every
 * settlement in the country gets one, and no two get the same one.
 *
 * Each entry names a method on Sites. They are built from the same primitives
 * as the houses and flattened with the rest of the site, so a signature costs
 * a few hundred triangles and not one extra draw call.
 */
const SIGNATURE = {
  croakhollow: '_sigFrog',            // the great frog, mossy, lantern in mouth
  'harrowmead-town': '_sigMill',      // the mill, and its sails turn
  'the-stilts': '_sigRopeRing',       // the walkway that IS the village
  'anurath-city': '_sigFallenKing',   // a colossus face-down across the square
  'low-quarter': '_sigCanal',         // the canal, the punts, the waterwheel
  'cutters-rest': '_sigSawmill',      // the great saw and the log stacks
  glasshook: '_sigDryingRacks',       // nets, racks, and the hook light
  sandreed: '_sigOasis',              // the pool and the bazaar lane
  lakewatch: '_sigPier',              // the long pier and the drowned bell
  moonwatch: '_sigObservatory',       // the dome and the brass ring
  'hollow-market': '_sigEmptyStalls', // a thousand awnings and nobody
  lumen: '_sigLightFields',           // terraces of grown light
};

/**
 * FLATTENING — the single biggest thing in the world's draw-call budget.
 *
 * A village is built as two hundred little meshes: a wall, a wall, a roof, a
 * post, a plank, a lamp. That is exactly the right way to AUTHOR one — the
 * builders read as descriptions of buildings — and completely the wrong way
 * to draw one. Measured, the Hollow Market and Anurath were nine hundred draw
 * calls each of nothing but buildings, which was two thirds of the entire
 * frame and by far the worst place in the country.
 *
 * Nothing in a site moves. So once it is built, every mesh in it that shares
 * a material is merged into ONE mesh, in the group's own local space. A city
 * goes from nine hundred draw calls to about ten, the silhouette is identical
 * to the pixel, and the colliders are untouched because they were registered
 * separately in world space when the site was built.
 *
 * Two things are deliberately NOT merged:
 *   - a subgroup marked `userData.keep`, because `setFreed` toggles the
 *     boarded-up and rebuilding versions of a settlement independently, and
 *   - a subgroup marked `userData.spin`, because the mill turns.
 * Both are flattened INTERNALLY, so they cost one draw call per material each
 * rather than one per plank.
 *
 * `castShadow` and `receiveShadow` are taken from the first mesh of each
 * material group. Every site part sets them the same way, so that is exact
 * rather than an approximation.
 */
const _fm = new THREE.Matrix4();

function mergeParts(parts) {
  let verts = 0;
  const geos = [];
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(p.m);
    geos.push(g);
    verts += g.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * Collapse a group's meshes into one per material, in place.
 *
 * @param owned every merged geometry is pushed here so the caller can free
 *              it — these are the only geometries Sites actually owns, since
 *              the parts they were built from are module-level singletons.
 * @returns how many draw calls were removed
 */
function flatten(group, owned) {
  let saved = 0;
  // Recurse into the ones that have to stay independent, then leave them be.
  const holdouts = [];
  for (const child of group.children) {
    if (child.isGroup && (child.userData.keep || child.userData.spin)) {
      saved += flatten(child, owned);
      holdouts.push(child);
    }
  }
  group.updateMatrixWorld(true);
  _fm.copy(group.matrixWorld).invert();
  const byMat = new Map();
  const drop = [];
  const skip = new Set(holdouts);
  const walk = (node) => {
    for (const child of node.children) {
      if (skip.has(child)) continue;
      if (child.isMesh && child.geometry && child.material
          && !child.isInstancedMesh) {
        let list = byMat.get(child.material);
        if (!list) { list = []; byMat.set(child.material, list); }
        const m = new THREE.Matrix4().multiplyMatrices(_fm, child.matrixWorld);
        list.push({ geo: child.geometry, m, cast: child.castShadow,
          recv: child.receiveShadow });
        drop.push(child);
      }
      if (child.children.length) walk(child);
    }
  };
  walk(group);
  if (byMat.size === 0) return saved;
  for (const c of drop) if (c.parent) c.parent.remove(c);
  // Any now-empty subgroups are left in place: they cost nothing to traverse
  // and removing them would invalidate references the builders kept.
  for (const [mat, parts] of byMat) {
    const geo = mergeParts(parts);
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = parts[0].cast;
    mesh.receiveShadow = parts[0].recv;
    // The contents move as a unit or not at all, so the bounds are honest.
    group.add(mesh);
    saved += parts.length - 1;
  }
  return saved;
}

export class Sites {
  /**
   * @param scene   where the structures go
   * @param realm   for heights and for `placeSpot`
   */
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.mats = makeMats();
    /**
     * Every built site: { id, kind, name, blurb, at, r, group, region,
     * settlement, spots }. `spots` is where villagers may stand.
     */
    this.sites = [];
    /**
     * EVERY MARKET STALL'S COUNTER, in world space.
     *
     * Filled by `_stall`, read by the overworld to give each one a tray of
     * wares and its own trade — see js/stalls.js. Nine hundred-odd meshes of
     * market get merged into the site they stand in and are then unreachable,
     * so the position has to be remembered at the moment it is known.
     */
    this.stalls = [];
    /** Arena rings, keyed by boss id, so a fight can be found by its stones. */
    this.arenas = new Map();
    /** The huge things, keyed by region id. */
    this.landmarks = new Map();
    /**
     * Everything in a settlement that turns: a mill's sails, the Low
     * Quarter's wheel, Cutter's Rest's saw.
     *
     * One moving part is worth a dozen static ones for making a place read as
     * inhabited, and it is the cheapest movement in the game — a `rotation.z`
     * on a group `flatten` was told to leave alone. Only spun while the site
     * it belongs to is actually drawn.
     */
    this.spins = [];
    /**
     * The merged geometries, which are the only ones this class owns.
     *
     * Every part a site is built from comes out of the module-level `G`, so
     * disposing those would knock the buffers out from under everything else
     * in the world. The flattened results are ours, and there are a few
     * hundred kilobytes of them.
     */
    this.owned = [];
    /** How many draw calls flattening removed. Read by the cost checks. */
    this.merged = 0;
    this.root = new THREE.Group();
    this.root.name = 'sites';
    scene.add(this.root);
  }

  // ------------------------------------------------------------------ build

  /** One labelled step per region, plus one for the roadside furniture. */
  buildTasks(regions) {
    const tasks = regions.map((R) =>
      [`Building ${R.name.toLowerCase()}`, () => this._region(R)]);
    tasks.push(['Putting up the signposts', () => this._roadside()]);
    return tasks;
  }

  _region(R) {
    if (R.landmark) this._landmark(R);
    for (const s of R.sites || []) this._site(R, s);
    for (const b of R.bosses || []) this._arena(R, b);
    for (const c of R.camps || []) this._campfire(R, c);
  }

  /** A collider in WORLD space, from a part's local offsets. */
  _solid(g, hx, hy, hz, x, y, z, tag) {
    this.realm.collision.addBox(
      g.position.x + x, g.position.y + y, g.position.z + z, hx, hy, hz, tag);
  }

  _put(g, geo, mat, sx, sy, sz, x, y, z, ry) {
    const m = new THREE.Mesh(geo, typeof mat === 'string' ? this.mats[mat] : mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }

  /**
   * ═══ A SOLID RUN ALONG A ROTATED WALL ════════════════════════════════════
   *
   * `_solid` — and `CollisionWorld.addBox` under it — is AXIS-ALIGNED. There
   * is no rotation argument anywhere in the collision world, which is fine
   * for the ninety-odd per cent of this file that builds square things, and
   * quietly wrong for the two that build a wall around a circle.
   *
   * What happened in practice: a curtain-wall segment eight units long and
   * two thick, laid tangentially, got ONE unrotated collider two units deep
   * — so at every segment that was not facing north or south, the collider
   * lay across the wall instead of along it, and the wall had a walkable gap
   * beside it. A city with a wall you can stroll through at eleven of its
   * twenty-two segments.
   *
   * This lays a CHAIN of small axis-aligned cubes along the segment instead.
   * Each is `thick` on a side and they overlap, so the run is continuous
   * whichever way the wall points, and a staircase of small boxes is
   * indistinguishable from a rotated one at the size a frog is.
   *
   * @param dirX,dirZ  unit vector along the wall
   * @param half       half its length
   * @param thick      half its thickness
   */
  _solidRun(g, x, y, z, dirX, dirZ, half, thick, hy, tag) {
    const step = Math.max(thick * 1.2, 1.0);
    const n = Math.max(1, Math.ceil(half / step));
    for (let i = -n; i <= n; i++) {
      const t = (i / n) * half;
      this._solid(g, thick, hy, thick, x + dirX * t, y, z + dirZ * t,
        tag || 'wall');
    }
  }

  /** A grapple anchor, so the tongue has something to reach for. */
  _anchor(g, x, y, z, r = 1.8) {
    this.realm.collision.addAnchor(
      g.position.x + x, g.position.y + y, g.position.z + z, r);
  }

  // ------------------------------------------------- standing on the ground

  /**
   * THE GROUND UNDER A PART, in the group's own coordinates.
   *
   * A site's group is placed at ONE height — the terrain at its middle — and
   * everything inside it was authored at a fixed offset from that. On level
   * ground that is right and on a slope it is a disaster: half a colonnade
   * buried to the capitals, half of it standing on nothing. Measured across
   * the world, the worst sites had eleven units of relief under a footprint
   * built as if it were a table top, which is exactly why a ruin read as
   * "some stone pillars randomly placed" — the pillars were all that was
   * still above the dirt.
   *
   * Anything that stands ON the ground asks this where the ground is.
   * Anything that stands on something ELSE — a roof on its walls, a lintel on
   * its posts — keeps its fixed offset, because that is a real relationship.
   */
  _gy(g, x, z) {
    return this.realm.heightAt(g.position.x + x, g.position.z + z) - g.position.y;
  }

  /** `_put`, with the part's BASE resting on the terrain under it. */
  _putOn(g, geo, mat, sx, sy, sz, x, z, ry) {
    return this._put(g, geo, mat, sx, sy, sz, x, this._gy(g, x, z) + sy * 0.5, z, ry);
  }

  /**
   * How far the ground drops under a footprint, and to what.
   *
   * Sampled on a five-by-five grid rather than at the corners: a site is
   * often placed on a saddle or a shoulder, where the middle of an edge is
   * lower than either end of it.
   */
  _relief(g, hw, hd) {
    let lo = Infinity, hi = -Infinity;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const y = this._gy(g, (i / 2) * hw, (j / 2) * hd);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return { lo, hi };
  }

  /**
   * A LEVEL FOUNDATION, filling whatever the slope leaves under a building.
   *
   * This is the fix for every site that is not a single object. Rather than
   * trying to make a temple follow a hillside — which no temple does — the
   * hillside is filled in under it with courses of stone down to the lowest
   * ground in the footprint, and the building is put on top of a flat plinth.
   * Which is what anybody actually building on a slope does, and it means the
   * thing above can go on being authored as if the world were flat.
   *
   * Three courses, each a little smaller than the one below, so it reads as
   * masonry rather than as a slab. Skipped entirely where the ground is
   * already level enough that a plinth would be a step for no reason.
   *
   * @returns the local Y the building should be built from — 0 when nothing
   *          was needed, so a caller can always just use it.
   */
  _plinth(g, hw, hd, mat = 'stoneDark', pad = 1.06) {
    const { lo, hi } = this._relief(g, hw, hd);
    // Under half a unit of fall is a floor, not a slope.
    if (hi - lo < 0.5) return 0;
    const drop = Math.min(hi - lo + 1.2, 26);
    const bottom = lo - 0.6;
    const courses = 3;
    /**
     * A RING of courses, not a solid block.
     *
     * The middle is deliberately left empty. Several of the things that stand
     * on a plinth are sunk INTO it — a dungeon's stair goes down through the
     * floor of its hall to a door below ground — and a solid slab buries all
     * of that in stone. Nothing sees the inside of a foundation anyway, so
     * the four edge beams are the whole of what a plinth needs to be.
     */
    for (let i = 0; i < courses; i++) {
      const k = pad - i * 0.045;
      const y0 = bottom + (drop * i) / courses;
      const y1 = bottom + (drop * (i + 1)) / courses;
      const h = y1 - y0, cy = (y0 + y1) * 0.5;
      const m = i === courses - 1 ? mat : 'stone';
      const t = Math.max(2.2, Math.min(hw, hd) * 0.22);   // beam thickness
      this._put(g, G.box, m, hw * k, h, t, 0, cy, hd * k - t);
      this._put(g, G.box, m, hw * k, h, t, 0, cy, -(hd * k - t));
      this._put(g, G.box, m, t, h, hd * k, hw * k - t, cy, 0);
      this._put(g, G.box, m, t, h, hd * k, -(hw * k - t), cy, 0);
    }
    // The colliders follow the ring, so the middle stays walkable.
    const t0 = Math.max(2.2, Math.min(hw, hd) * 0.22);
    const half = (0 - bottom) * 0.5, cy0 = bottom * 0.5;
    this._solid(g, hw * pad, half, t0, 0, cy0, hd * pad - t0, 'wall');
    this._solid(g, hw * pad, half, t0, 0, cy0, -(hd * pad - t0), 'wall');
    this._solid(g, t0, half, hd * pad, hw * pad - t0, cy0, 0, 'wall');
    this._solid(g, t0, half, hd * pad, -(hw * pad - t0), cy0, 0, 'wall');
    /**
     * Steps up the low side.
     *
     * Without them a plinth on a real slope is a wall you cannot climb, and
     * the site becomes scenery. Tagged `deck`, which is the surface the
     * character controller allows a two-unit step onto.
     */
    const rise = -bottom;
    const n = Math.max(2, Math.round(rise / 1.4));
    for (let i = 0; i < n; i++) {
      const y = bottom + (rise * (i + 1)) / n;
      const out = hd * pad + (n - i) * 1.5;
      this._put(g, G.box, 'stone', hw * 0.5, 0.5, 1.5, 0, y, out);
      this._solid(g, hw * 0.25, 0.3, 0.9, 0, y, out, 'deck');
    }
    return 0;
  }

  // --------------------------------------------------------------- landmark

  /**
   * The region's one enormous thing.
   *
   * Placed with a generous footprint so it lands on ground broad enough to
   * hold it, and given its own visibility radius: a landmark that pops in at
   * the same distance as a hut is not doing its job.
   */
  _landmark(R) {
    const L = R.landmark;
    const spot = this.realm.placeSpot(L.at[0], L.at[1], 46, R, 0.34);
    const seed = (Math.round(spot.x) * 40503) ^ (Math.round(spot.z) * 30011);
    const { group, solids } = buildLandmark(L.kind, seed >>> 0);
    group.position.set(spot.x, spot.y, spot.z);
    for (const s of solids) {
      this.realm.collision.addBox(spot.x + s.x, spot.y + s.y, spot.z + s.z,
        s.hx, s.hy, s.hz, s.tag);
    }
    group.visible = false;
    // Flattened like everything else. A landmark is the biggest thing in the
    // region and is drawn from twelve hundred units, so it is the single
    // best-value merge in the world — and the one part of one landmark that
    // moves, the mill's sail hub, is marked `spin` and survives it.
    this.merged += flatten(group, this.owned);
    this.root.add(group);
    this.landmarks.set(R.id, {
      region: R.id, kind: L.kind, name: L.name, blurb: L.blurb || '',
      at: spot, group, spin: group.userData.spin || null,
    });
    // Landmarks are the navigation aid, so they are also a site you can
    // examine — the name is half of what makes them memorable.
    this.sites.push({
      id: `landmark:${R.id}`, kind: 'landmark', name: L.name,
      blurb: L.blurb || '', region: R.id, at: spot, r: 34, group,
      spots: null, landmark: true,
    });
  }

  // ------------------------------------------------------------------ sites

  _site(R, spec) {
    // Sites are buildings and standing stones, so they are allowed rougher
    // ground than an arena is — a shrine on a slope is a shrine on a slope.
    const spot = this.realm.placeSpot(spec.at[0], spec.at[1],
      Math.max(14, spec.r), R, 0.42);
    const g = new THREE.Group();
    g.position.set(spot.x, spot.y, spot.z);
    const rnd = mulberry32(((Math.round(spot.x) * 374761393)
      ^ (Math.round(spot.z) * 668265263)) >>> 0);
    const style = STYLE[R.arch] || STYLE.timber;
    let spots = null;
    /**
     * Which site is being built, for `_stall` to file its counters under.
     * A field rather than a parameter threaded through nine builders and two
     * signature methods, which is what it would take otherwise.
     */
    this._nowSite = spec.id;
    /**
     * AND WHETHER ANYBODY IS BEHIND THE COUNTERS.
     *
     * A settlement whose signature is the empty market has no shops in it —
     * not the forty stalls the signature builds, and not the nine the city
     * layout put in the square either. The Hollow Market's whole blurb is
     * "Stalls, awnings, prices chalked up. Nobody.", and nine working
     * traders in the middle of it would be the loudest possible way to
     * contradict that. So the flag is set for the whole site, from the
     * signature table, before anything is built.
     */
    this._nowAbandoned = SIGNATURE[spec.id] === '_sigEmptyStalls';

    switch (spec.kind) {
      case 'village': case 'town': case 'city':
        spots = this._settlement(g, spec, R, rnd, style, SETTLE[spec.kind]);
        break;
      case 'treevillage': spots = this._treeVillage(g, spec, R, rnd, style); break;
      // A village that has been burned. Nobody lives here, so no spots.
      case 'burnt': this._burnt(g, spec, rnd, style); break;
      case 'shrine': this._shrine(g, spec, rnd, style); break;
      case 'temple': this._temple(g, spec, rnd, style); break;
      case 'ruin': this._ruin(g, spec, rnd, style); break;
      case 'camp': spots = this._camp(g, spec, rnd, style); break;
      case 'hut': spots = this._hut(g, spec, rnd, style); break;
      case 'farm': spots = this._farm(g, spec, rnd, style); break;
      case 'tower': this._tower(g, spec, rnd, style); break;
      case 'keep': spots = this._keep(g, spec, rnd, style); break;
      case 'gatehouse': this._gatehouse(g, spec, rnd, style); break;
      case 'bridge': this._bridge(g, spec, rnd, style); break;
      case 'cave': this._cave(g, spec, rnd, style); break;
      case 'mine': this._mine(g, spec, rnd, style); break;
      case 'dungeon': this._dungeon(g, spec, rnd, style); break;
      case 'arena': this._siteArena(g, spec, rnd, style); break;
      default: this._oddity(g, spec, rnd, style); break;
    }

    g.visible = false;
    // Two hundred meshes of buildings become one per material. See `flatten`.
    this.merged += flatten(g, this.owned);
    // Whatever survived the merge because it turns. See `this.spins`.
    for (const c of g.children) {
      if (c.isGroup && c.userData.spin) {
        this.spins.push({ site: g, hub: c, rate: c.userData.rate || 0.4 });
      }
    }
    this.root.add(g);
    /**
     * Which guardian's death this settlement is waiting on.
     *
     * The region's own first guardian, not its gate: the gate is what let you
     * IN, and what these people are frightened of is the thing living next
     * door. A region with no guardian of its own is never boarded up.
     */
    const own = (R.bosses || []).find((b) => !b.final);
    this.sites.push({
      id: spec.id, kind: spec.kind, name: spec.name,
      blurb: spec.blurb || '', region: R.id,
      at: spot, r: spec.r, group: g,
      settlement: spec.kind === 'village' || spec.kind === 'town'
        || spec.kind === 'city' || spec.kind === 'treevillage',
      freedBy: own ? own.id : null,
      spots,
    });
  }

  /**
   * Show every settlement the version of itself that matches the save.
   *
   * Called on entry and after every guardian falls. Cheap — it is a visibility
   * flag on two groups per settlement — so it can be called whenever anything
   * changes rather than being carefully scheduled.
   *
   * @returns the ids of settlements that changed state, so the game can say so
   */
  setFreed(slain) {
    const changed = [];
    for (const s of this.sites) {
      if (!s.settlement) continue;
      const g = s.group;
      if (!g.userData.wreck) continue;
      const freed = !s.freedBy || slain.has(s.freedBy);
      if (s._freed === freed) continue;
      s._freed = freed;
      g.userData.wreck.visible = !freed;
      g.userData.mend.visible = freed;
      changed.push(s);
    }
    return changed;
  }

  // ---------------------------------------------------------- the buildings

  /**
   * One building, in the region's style.
   *
   * `floor` lifts it — used by the stilt villages, where the ground is under
   * water and the floor has to clear it.
   */
  _house(g, x, z, w, d, h, face, style, floor = 0) {
    const S = style;
    if (floor > 0.7) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          this._put(g, G.cyl, S.post, 0.18, floor + 0.8, 0.18,
            x + sx * w * 0.8, floor * 0.5 - 0.4, z + sz * d * 0.8);
        }
      }
      this._put(g, G.box, S.trim, w * 1.15, 0.24, d * 1.15, x, floor, z, face);
    }
    this._put(g, G.box, S.wall, w, h, d, x, floor + h * 0.5, z, face);
    this._put(g, G.box, S.trim, w * 1.04, 0.3, d * 1.04, x, floor + 0.15, z, face);
    const top = floor + h;
    switch (S.roof) {
      case 'cone':
        this._put(g, G.cone, S.roofMat, w * 0.9, h * 0.8, d * 0.9,
          x, top + h * 0.4, z, face);
        break;
      case 'steep':
        this._put(g, G.cone, S.roofMat, w * 0.85, h * 1.3, d * 0.85,
          x, top + h * 0.65, z, face + 0.78);
        break;
      case 'flat':
        this._put(g, G.box, S.roofMat, w * 1.12, 0.4, d * 1.12, x, top + 0.2, z, face);
        this._put(g, G.box, S.trim, w * 1.12, 0.7, 0.2, x, top + 0.5, z + d * 0.55, face);
        break;
      default: {                                  // hip
        this._put(g, G.box, S.roofMat, w * 1.18, 0.34, d * 1.18, x, top + 0.2, z, face);
        this._put(g, G.cone, S.roofMat, w * 0.95, h * 0.55, d * 0.95,
          x, top + h * 0.3, z, face + 0.785);
        break;
      }
    }
    // A doorway and a window, so it reads as lived in rather than as a crate.
    const fx = Math.sin(face), fz = Math.cos(face);
    this._put(g, G.box, 'woodDark', w * 0.3, h * 0.6, 0.2,
      x + fx * d * 0.52, floor + h * 0.3, z + fz * d * 0.52, face);
    this._put(g, G.box, 'lamp', w * 0.22, h * 0.22, 0.16,
      x - fx * d * 0.52, floor + h * 0.6, z - fz * d * 0.52, face);
    this._solid(g, w * 0.55, h * 0.5 + floor * 0.5, d * 0.55,
      x, floor * 0.5 + h * 0.5, z, 'house');
  }

  /** A fire, its ring of stones, and the logs somebody stacked beside it. */
  _fire(g, x, z, rnd) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this._put(g, G.low, 'stoneDark', 0.4, 0.3, 0.4,
        x + Math.cos(a) * 1.5, 0.2, z + Math.sin(a) * 1.5);
    }
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const m = this._put(g, G.cyl, 'woodDark', 0.12, 1.6, 0.12,
        x + Math.cos(a) * 0.4, 0.6, z + Math.sin(a) * 0.4);
      m.rotation.z = Math.cos(a) * 0.5;
      m.rotation.x = Math.sin(a) * 0.5;
    }
    this._put(g, G.low, 'ember', 0.7, 0.9, 0.7, x, 0.7, z);
  }

  /** A pole with a light on it. Also a grapple anchor. */
  _lamppost(g, x, z, h = 5.4) {
    this._put(g, G.cyl, 'woodDark', 0.14, h, 0.14, x, h * 0.5, z);
    this._put(g, G.low, 'lamp', 0.42, 0.5, 0.42, x, h + 0.1, z);
    this._anchor(g, x, h + 0.1, z);
  }

  /**
   * A market stall: four posts, an awning, and a table of goods.
   *
   * AND IT REMEMBERS WHERE ITS COUNTER IS. Every stall pushes a record onto
   * `this.stalls`, in world space, so the overworld can put a tray of wares
   * on the counter of each one and give it its own trade — see js/stalls.js
   * and `_placeStalls`. Recorded here rather than at each of the three call
   * sites because a stall that is not in the list is a stall you walk up to
   * and cannot buy anything from, and there is no way to notice that from
   * reading the call sites.
   *
   * The counter is the plank at `z + 0.7`, and its offset is NOT rotated by
   * `face` (the posts are not either — only the awning and the plank turn on
   * the spot). So the recorded point is that plank's centre, which is where
   * the goods have to sit whichever way the stall is turned.
   */
  _stall(g, x, z, face, rnd) {
    const cloth = rnd() < 0.5 ? 'cloth' : 'clothBlue';
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._put(g, G.cyl, 'woodDark', 0.11, 3.0, 0.11,
          x + sx * 1.8, 1.5, z + sz * 1.3);
      }
    }
    this._put(g, G.box, cloth, 4.4, 0.16, 3.2, x, 3.1, z, face);
    this._put(g, G.box, 'plank', 3.6, 0.18, 1.2, x, 1.1, z + 0.7, face);
    for (let i = 0; i < 4; i++) {
      this._put(g, G.low, rnd() < 0.5 ? 'leafPale' : 'gold',
        0.24, 0.24, 0.24, x - 1.4 + i * 0.9, 1.35, z + 0.7);
    }
    this._solid(g, 2.0, 0.6, 0.8, x, 1.0, z + 0.7, 'stall');
    this.stalls.push({
      site: this._nowSite,
      x: g.position.x + x,
      y: g.position.y + 1.19,
      z: g.position.z + z + 0.7,
      face,
      /**
       * The Hollow Market's forty are not shops. See `_sigEmptyStalls`, and
       * `leftoverOf` in js/stalls.js for what is left on them instead.
       */
      abandoned: !!this._nowAbandoned,
    });
  }

  // ----------------------------------------------- what makes a place lived-in

  /**
   * One paving stone, laid flat on whatever the ground is doing under it.
   *
   * Individually placed rather than being one big slab, which is the whole
   * trick: a hundred separate stones follow a hillside exactly, and after
   * `flatten` they are one mesh anyway, so the ground-hugging is free.
   */
  _tile(g, x, z, s, mat) {
    return this._put(g, G.box, mat, s, 0.32, s, x, this._gy(g, x, z) - 0.1, z);
  }

  /**
   * A PAVED SQUARE at the middle of a settlement.
   *
   * Worn, gapped and not quite square — stones missing where a cart wore a
   * rut, a different colour where somebody patched it. A perfect disc of one
   * material reads as a texture; a bad one reads as a place with a history.
   */
  _plaza(g, r, rnd, mat = 'stonePale') {
    // Three units: big enough that a square is a couple of hundred triangles
    // rather than a couple of thousand, small enough that the stones still
    // step down a slope instead of tilting through it.
    const step = 3.0;
    for (let x = -r; x <= r; x += step) {
      for (let z = -r; z <= r; z += step) {
        const d = Math.hypot(x, z);
        if (d > r || d < 2.2) continue;
        // Fewer stones towards the edge: paving frays into dirt, it does not
        // stop at a line.
        if (rnd() < 0.10 + 0.5 * (d / r) ** 3) continue;
        this._tile(g, x + (rnd() - 0.5) * 0.5, z + (rnd() - 0.5) * 0.5,
          step * (0.78 + rnd() * 0.2), rnd() < 0.24 ? 'stone' : mat);
      }
    }
  }

  /** A worn path of trodden stones between two points. */
  _path(g, x0, z0, x1, z1, rnd, w = 1.7) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (rnd() < 0.12) continue;
      this._tile(g,
        x0 + (x1 - x0) * t + (rnd() - 0.5) * w,
        z0 + (z1 - z0) * t + (rnd() - 0.5) * w,
        w * (0.65 + rnd() * 0.55), rnd() < 0.3 ? 'stoneDark' : 'stone');
    }
  }

  /** A kitchen garden: four furrows of something green behind a low rail. */
  _garden(g, x, z, a, rnd) {
    const c = Math.cos(a), s = Math.sin(a);
    const at = (ox, oz) => [x + ox * c - oz * s, z + ox * s + oz * c];
    for (let i = 0; i < 4; i++) {
      const [fx, fz] = at(0, -1.9 + i * 1.25);
      this._putOn(g, G.box, 'wood', 4.2, 0.34, 0.7, fx, fz, a);
      for (let k = 0; k < 5; k++) {
        const [cx, cz] = at(-1.7 + k * 0.85, -1.9 + i * 1.25);
        if (rnd() < 0.18) continue;
        this._putOn(g, G.low, rnd() < 0.45 ? 'leafPale' : 'leaf',
          0.3, 0.55, 0.3, cx, cz);
      }
    }
    for (const sg of [-1, 1]) {
      const [rx, rz] = at(0, sg * 2.9);
      this._put(g, G.box, 'plank', 5.0, 0.14, 0.12,
        rx, this._gy(g, rx, rz) + 0.75, rz, a);
      for (const e of [-1, 1]) {
        const [px, pz] = at(e * 2.4, sg * 2.9);
        this._putOn(g, G.cyl, 'woodDark', 0.09, 1.0, 0.09, px, pz);
      }
    }
  }

  /** Two posts, a line, and somebody's washing on it. */
  _washline(g, x0, z0, x1, z1, rnd) {
    const y0 = this._gy(g, x0, z0), y1 = this._gy(g, x1, z1);
    this._put(g, G.cyl, 'woodDark', 0.11, 4.4, 0.11, x0, y0 + 2.2, z0);
    this._put(g, G.cyl, 'woodDark', 0.11, 4.4, 0.11, x1, y1 + 2.2, z1);
    const a = Math.atan2(z1 - z0, x1 - x0);
    const len = Math.hypot(x1 - x0, z1 - z0);
    this._put(g, G.box, 'rope', len, 0.07, 0.07,
      (x0 + x1) * 0.5, (y0 + y1) * 0.5 + 4.3, (z0 + z1) * 0.5, -a);
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const y = y0 + (y1 - y0) * t;
      const h = 0.9 + rnd() * 0.8;
      this._put(g, G.box, rnd() < 0.5 ? 'cloth' : 'clothBlue',
        0.9 + rnd() * 0.5, h, 0.06, x, y + 4.25 - h * 0.5, z, -a);
    }
  }

  /**
   * A STRING OF LANTERNS between two posts.
   *
   * The cheapest thing in the game that changes how a place feels. Lamps are
   * an unlit basic material, so a line of them across a square is the thing
   * you can see from the treeline at dusk, and it is what says somebody is
   * still living here.
   */
  _lanternLine(g, x0, z0, x1, z1, n = 5) {
    const y0 = this._gy(g, x0, z0), y1 = this._gy(g, x1, z1);
    const a = Math.atan2(z1 - z0, x1 - x0);
    const len = Math.hypot(x1 - x0, z1 - z0);
    this._put(g, G.box, 'rope', len, 0.06, 0.06,
      (x0 + x1) * 0.5, (y0 + y1) * 0.5 + 5.0, (z0 + z1) * 0.5, -a);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const y = y0 + (y1 - y0) * t + 5.0;
      // The line sags, so the middle lanterns hang lower.
      const sag = Math.sin(t * Math.PI) * 0.55;
      this._put(g, G.cyl, 'woodDark', 0.03, 0.5, 0.03, x, y - sag - 0.25, z);
      this._put(g, G.low, 'lamp', 0.26, 0.34, 0.26, x, y - sag - 0.7, z);
    }
  }

  /** Barrels, crates, a bucket and a stack of firewood — somebody's yard. */
  _clutter(g, x, z, rnd) {
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const ox = x + (rnd() - 0.5) * 2.6, oz = z + (rnd() - 0.5) * 2.6;
      const roll = rnd();
      if (roll < 0.45) {
        this._putOn(g, G.cyl, 'wood', 0.42, 1.0, 0.42, ox, oz);
        // The iron band, as a short wider drum rather than a torus: at this
        // size it reads identically and costs a tenth of the triangles.
        this._put(g, G.cyl, 'iron', 0.45, 0.14, 0.45,
          ox, this._gy(g, ox, oz) + 0.62, oz);
      } else if (roll < 0.8) {
        this._putOn(g, G.box, 'plank', 0.9, 0.8, 0.9, ox, oz, rnd() * 1.5);
      } else {
        this._putOn(g, G.low, 'thatch', 0.7, 0.5, 0.7, ox, oz);
      }
    }
    // Firewood, cut and stacked. Four rows of three.
    const fy = this._gy(g, x + 2.2, z - 1.6);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        this._put(g, G.cyl, 'woodDark', 0.17, 1.6, 0.17,
          x + 2.2 + c * 0.38, fy + 0.2 + r * 0.36, z - 1.6, 0)
          .rotation.z = Math.PI / 2;
      }
    }
  }

  /** A signpost at the road, with the name of the place pointing back. */
  _signpost(g, x, z, a) {
    this._putOn(g, G.cyl, 'woodDark', 0.14, 3.6, 0.14, x, z);
    const y = this._gy(g, x, z);
    for (let i = 0; i < 2; i++) {
      this._put(g, G.box, 'plank', 2.2, 0.42, 0.14,
        x + Math.cos(a) * 0.9, y + 3.0 - i * 0.62, z + Math.sin(a) * 0.9,
        -a + (i ? 0.9 : 0));
    }
    this._put(g, G.cone, 'woodDark', 0.24, 0.4, 0.24, x, y + 3.8, z);
  }

  /**
   * A RAIL FENCE round the outside, with a gap where the road comes in.
   *
   * The edge of a settlement matters as much as the middle of one: a ring of
   * houses standing in open grass reads as props on a table, and the same
   * houses inside a fence read as a place with an inside and an outside.
   */
  _fenceRun(g, r, rnd, gaps = []) {
    const seg = Math.max(16, Math.round(r * 0.5));
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      if (gaps.some((ga) => Math.abs(((a - ga + Math.PI * 3)
        % (Math.PI * 2)) - Math.PI) < 0.34)) continue;
      if (rnd() < 0.08) continue;                    // a panel somebody took
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this._gy(g, x, z);
      this._put(g, G.cyl, 'woodDark', 0.12, 1.9, 0.12, x, y + 0.95, z);
      const a2 = a + (Math.PI * 2) / seg;
      const x2 = Math.cos(a2) * r, z2 = Math.sin(a2) * r;
      const mx = (x + x2) * 0.5, mz = (z + z2) * 0.5;
      const len = Math.hypot(x2 - x, z2 - z);
      const my = (y + this._gy(g, x2, z2)) * 0.5;
      for (const h of [0.65, 1.35]) {
        this._put(g, G.box, 'plank', len, 0.14, 0.09,
          mx, my + h, mz, -Math.atan2(z2 - z, x2 - x));
      }
    }
  }

  // ---------------------------------------------------------- the signatures

  /** Build whatever this particular settlement is known for. See SIGNATURE. */
  _signature(g, spec, R, rnd, style, ring, spots) {
    const fn = SIGNATURE[spec.id];
    if (fn && this[fn]) this[fn](g, spec, R, rnd, style, ring, spots);
  }

  /**
   * CROAKHOLLOW — THE GREAT FROG.
   *
   * Old, mossy, twice the height of a house, sitting on a plinth in the
   * square with a lantern held in its mouth. It is the first landmark of the
   * game and it has to do two jobs: be a thing you can point at from the
   * treeline, and tell you what the people here think they are.
   */
  _sigFrog(g, spec, R, rnd, style, ring) {
    const x = -ring * 0.42, z = -ring * 0.28;
    const y = this._gy(g, x, z);
    // Plinth: three courses, each a little smaller.
    for (let i = 0; i < 3; i++) {
      this._put(g, G.box, i === 1 ? 'stoneDark' : 'stone',
        6.4 - i * 0.9, 0.8, 5.6 - i * 0.9, x, y + 0.4 + i * 0.8, z);
    }
    const base = y + 2.4;
    // Body, haunches, head. All one animal, in six spheres.
    this._put(g, G.low, 'stoneDark', 3.1, 2.5, 3.6, x, base + 2.2, z);
    for (const s of [-1, 1]) {
      this._put(g, G.low, 'stoneDark', 1.5, 1.3, 2.0, x + s * 2.5, base + 1.2, z - 0.4);
      // Front legs, straight down, the way a sitting frog holds them.
      this._put(g, G.cyl, 'stoneDark', 0.55, 3.0, 0.55, x + s * 1.7, base + 1.5, z + 2.6);
      this._put(g, G.low, 'stoneDark', 0.85, 0.4, 1.2, x + s * 1.7, base + 0.2, z + 3.2);
    }
    this._put(g, G.low, 'stoneDark', 2.3, 1.9, 2.0, x, base + 3.8, z + 2.0);
    for (const s of [-1, 1]) {
      this._put(g, G.low, 'stone', 0.75, 0.75, 0.75, x + s * 1.1, base + 5.0, z + 2.2);
      this._put(g, G.low, 'obsidian', 0.34, 0.34, 0.34, x + s * 1.1, base + 5.2, z + 2.8);
    }
    // The lantern in its mouth, and the moss four hundred years put on it.
    this._put(g, G.cyl, 'iron', 0.09, 1.2, 0.09, x, base + 3.0, z + 3.5);
    this._put(g, G.low, 'lamp', 0.5, 0.62, 0.5, x, base + 2.3, z + 3.6);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, r = 1.6 + rnd() * 1.6;
      this._put(g, G.low, 'leaf', 0.5 + rnd() * 0.5, 0.18, 0.5 + rnd() * 0.5,
        x + Math.cos(a) * r, base + 1.4 + rnd() * 2.6, z + Math.sin(a) * r);
    }
    this._solid(g, 3.2, 4.0, 3.2, x, y + 4, z, 'statue');
    this._anchor(g, x, base + 5.4, z + 2.2, 2.2);
    // Offerings at its feet: somebody still comes here.
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2;
      this._putOn(g, G.low, i % 2 ? 'leafPale' : 'lamp', 0.3, 0.3, 0.3,
        x + Math.cos(a) * 4.6, z + Math.sin(a) * 4.6);
    }
  }

  /**
   * HARROWMEAD — THE MILL, and its sails turn.
   *
   * Movement is what makes a silhouette stick. The sail hub is its own group
   * marked `spin`, which is the one thing `flatten` leaves standing so it can
   * keep turning after the rest of the town is merged into eight meshes.
   */
  _sigMill(g, spec, R, rnd, style, ring) {
    const x = ring * 0.86, z = -ring * 0.62;
    const y = this._gy(g, x, z);
    for (let i = 0; i < 2; i++) {
      this._put(g, G.box, 'stone', 8.2 - i * 0.8, 0.7, 8.2 - i * 0.8,
        x, y + 0.35 + i * 0.7, z);
    }
    this._put(g, G.taper, 'stonePale', 3.5, 13, 3.5, x, y + 8.0, z);
    this._put(g, G.cone, 'tileDark', 3.4, 3.4, 3.4, x, y + 16.2, z);
    // The stage the miller walks round to reef the sails.
    this._put(g, G.disc, 'plank', 4.6, 0.3, 4.6, x, y + 6.4, z);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this._put(g, G.cyl, 'woodDark', 0.08, 1.0, 0.08,
        x + Math.cos(a) * 4.4, y + 6.9, z + Math.sin(a) * 4.4);
    }
    this._solid(g, 3.2, 8, 3.2, x, y + 8, z, 'mill');
    this._anchor(g, x, y + 14, z, 2.6);

    const hub = new THREE.Group();
    hub.userData.spin = true;
    hub.userData.rate = 0.34;
    hub.position.set(x, y + 12.6, z + 3.6);
    g.add(hub);
    g.userData.spin = hub;
    this._put(hub, G.cyl, 'ironDark', 0.4, 1.2, 0.4, 0, 0, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const arm = this._put(hub, G.box, 'woodDark', 9.5, 0.4, 0.3,
        c * 4.7, s * 4.7, 0);
      arm.rotation.z = ang;
      const sail = this._put(hub, G.box, 'cloth', 7.0, 2.1, 0.12,
        c * 5.6 - s * 1.0, s * 5.6 + c * 1.0, 0.28);
      sail.rotation.z = ang;
    }
    // Grain: the reason the mill is here at all.
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, r = 6 + rnd() * 3;
      this._putOn(g, G.cyl, 'thatch', 0.55, 1.3, 0.55,
        x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
    this._signpost(g, x - 8, z + 6, Math.PI);
  }

  /**
   * THE STILTS — THE ROPE RING.
   *
   * Nine huts and a rope, says the blurb, so the rope had better be the
   * village. A plank walkway on posts joins every hut in a ring above the
   * water, with rope handrails and lanterns, and it carries `deck` colliders
   * so you can actually walk it.
   */
  _sigRopeRing(g, spec, R, rnd, style, ring) {
    const rad = ring * 0.9;
    const deck = (SEA + 3.0) - g.position.y;
    const seg = 20;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const a2 = ((i + 1) / seg) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const x2 = Math.cos(a2) * rad, z2 = Math.sin(a2) * rad;
      const mx = (x + x2) * 0.5, mz = (z + z2) * 0.5;
      const len = Math.hypot(x2 - x, z2 - z) * 1.1;
      const face = -Math.atan2(z2 - z, x2 - x);
      this._put(g, G.box, 'plank', len, 0.3, 2.4, mx, deck, mz, face);
      this._solid(g, len * 0.5, 0.25, 1.2, mx, deck, mz, 'deck');
      // Posts down into the water, and the rail above.
      const gy = this._gy(g, x, z);
      this._put(g, G.cyl, 'woodDark', 0.18, deck - gy + 1, 0.18,
        x, (deck + gy) * 0.5, z);
      this._put(g, G.cyl, 'woodDark', 0.11, 1.5, 0.11, x, deck + 0.9, z);
      this._put(g, G.box, 'rope', len, 0.08, 0.08, mx, deck + 1.5, mz, face);
      if (i % 4 === 0) {
        this._put(g, G.low, 'lamp', 0.28, 0.34, 0.28, x, deck + 1.8, z);
        this._anchor(g, x, deck + 1.8, z, 1.6);
      }
      // A spur inward, so the ring is not a dead loop.
      if (i % 5 === 0) {
        this._put(g, G.box, 'plank', rad * 0.7, 0.3, 1.8,
          Math.cos(a) * rad * 0.64, deck, Math.sin(a) * rad * 0.64, -a);
        this._solid(g, rad * 0.35, 0.25, 0.9,
          Math.cos(a) * rad * 0.64, deck, Math.sin(a) * rad * 0.64, 'deck');
      }
    }
    // Fish drying, and the boats they were caught from.
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6 + 0.4;
      const x = Math.cos(a) * rad * 0.55, z = Math.sin(a) * rad * 0.55;
      this._put(g, G.cyl, 'woodDark', 0.1, 3.0, 0.1, x - 1.4, deck + 1.5, z);
      this._put(g, G.cyl, 'woodDark', 0.1, 3.0, 0.1, x + 1.4, deck + 1.5, z);
      this._put(g, G.box, 'rope', 3.0, 0.06, 0.06, x, deck + 2.8, z);
      for (let k = 0; k < 5; k++) {
        this._put(g, G.low, 'bone', 0.16, 0.42, 0.1,
          x - 1.1 + k * 0.55, deck + 2.4, z);
      }
      const bx = Math.cos(a) * rad * 1.16, bz = Math.sin(a) * rad * 1.16;
      this._put(g, G.low, 'plank', 2.4, 0.5, 0.9, bx, SEA + 0.3 - g.position.y, bz, a);
    }
  }

  /**
   * ANURATH — THE FALLEN KING.
   *
   * A colossus of the old crown, face-down across what used to be the parade
   * square, snapped at the waist. Nobody in the city will tell you who pulled
   * it down. It is the largest single object in any settlement and it is the
   * image the capital is meant to leave you with.
   */
  _sigFallenKing(g, spec, R, rnd, style, ring) {
    const x = -ring * 0.2, z = ring * 0.5;
    const y = this._gy(g, x, z);
    const a = 0.5;
    const c = Math.cos(a), s = Math.sin(a);
    const at = (ox, oz) => [x + ox * c - oz * s, z + ox * s + oz * c];
    // The body, in three pieces, with the break between the first two.
    const parts = [[-9, 7.5], [1.5, 8.5], [12.5, 5.5]];
    for (let i = 0; i < parts.length; i++) {
      const [ox, len] = parts[i];
      const [px, pz] = at(ox, 0);
      this._put(g, G.box, 'marble', len, 4.4, 6.2, px, y + 2.0 + i * 0.15, pz, -a);
    }
    // The head, half-buried, turned to look at you.
    const [hx, hz] = at(-14.5, 1.2);
    this._put(g, G.low, 'marble', 3.4, 3.0, 3.4, hx, y + 1.9, hz);
    this._put(g, G.torus, 'gold', 3.0, 3.0, 3.0, hx, y + 3.1, hz)
      .rotation.set(Math.PI / 2, 0.4, 0);
    for (const e of [-1, 1]) {
      const [ex, ez] = at(-16.0, 1.2 + e * 1.2);
      this._put(g, G.low, 'marbleDark', 0.6, 0.5, 0.6, ex, y + 2.4, ez);
    }
    // An arm flung out, and the hand that came off it.
    const [ax, az] = at(-3, -6.5);
    this._put(g, G.cyl, 'marble', 1.5, 11, 1.5, ax, y + 1.4, az, 0)
      .rotation.set(Math.PI / 2, 0, a + 0.9);
    const [fx, fz] = at(-2, -13);
    this._put(g, G.low, 'marble', 2.0, 1.2, 2.4, fx, y + 1.0, fz);
    for (let i = 0; i < 4; i++) {
      this._put(g, G.cyl, 'marble', 0.32, 2.2, 0.32,
        fx + (i - 1.5) * 0.9, y + 0.9, fz - 1.6, 0).rotation.x = 1.3;
    }
    // Rubble, and the weeds that got in afterwards.
    for (let i = 0; i < 16; i++) {
      const [rx, rz] = at(-18 + rnd() * 34, (rnd() - 0.5) * 14);
      this._putOn(g, rnd() < 0.4 ? G.octa : G.low,
        rnd() < 0.75 ? 'marbleDark' : 'leaf',
        0.5 + rnd() * 1.1, 0.4 + rnd() * 0.8, 0.5 + rnd() * 1.1, rx, rz,
        rnd() * 3);
    }
    for (const [ox, len] of parts) {
      const [px, pz] = at(ox, 0);
      this._solid(g, len * 0.5, 2.2, 3.1, px, y + 2.2, pz, 'colossus');
    }
    this._anchor(g, x, y + 5.5, z, 3.0);
  }

  /**
   * THE LOW QUARTER — THE CANAL.
   *
   * The part of the capital that was always underwater, so the streets are
   * water: a channel straight through the middle of it, punts tied along the
   * bank, stepping stones where a bridge used to be, and a wheel that has not
   * stopped turning because nobody knows how to stop it.
   */
  _sigCanal(g, spec, R, rnd, style, ring) {
    const wy = (SEA + 0.15) - g.position.y;
    const len = ring * 2.0;
    // The channel: water down the middle, quay walls either side.
    this._put(g, G.box, 'water', len, 0.3, 9.0, 0, wy, 0, 0.35);
    for (const s of [-1, 1]) {
      const zz = s * 5.4;
      const x0 = Math.cos(0.35) * 0, z0 = zz;
      this._put(g, G.box, 'stoneDark', len, 2.6, 1.6,
        -Math.sin(0.35) * zz, wy + 1.0, z0 * Math.cos(0.35), 0.35);
      for (let i = -4; i <= 4; i++) {
        const t = i / 4;
        const px = Math.cos(0.35) * t * len * 0.45 - Math.sin(0.35) * zz;
        const pz = Math.sin(0.35) * t * len * 0.45 + Math.cos(0.35) * zz;
        this._put(g, G.cyl, 'woodDark', 0.16, 2.6, 0.16, px, wy + 1.3, pz);
        if (i % 2 === 0) this._put(g, G.low, 'lamp', 0.26, 0.3, 0.26, px, wy + 2.7, pz);
      }
    }
    // Punts, tied up along the quay.
    for (let i = 0; i < 5; i++) {
      const t = (i / 4 - 0.5) * 0.8;
      const s = i % 2 ? 1 : -1;
      const px = Math.cos(0.35) * t * len - Math.sin(0.35) * s * 3.2;
      const pz = Math.sin(0.35) * t * len + Math.cos(0.35) * s * 3.2;
      this._put(g, G.low, 'plank', 3.0, 0.45, 1.0, px, wy + 0.35, pz, 0.35);
      this._put(g, G.cyl, 'woodDark', 0.07, 3.4, 0.07, px + 1.0, wy + 1.7, pz)
        .rotation.z = 0.3;
    }
    // Stepping stones where the bridge came down.
    for (let i = 0; i < 5; i++) {
      const zz = -5 + i * 2.5;
      this._put(g, G.disc, 'stone', 1.1, 0.9, 1.1,
        -Math.sin(0.35) * zz + ring * 0.3, wy + 0.35, Math.cos(0.35) * zz);
      this._solid(g, 1.0, 0.5, 1.0,
        -Math.sin(0.35) * zz + ring * 0.3, wy + 0.4, Math.cos(0.35) * zz, 'deck');
    }
    // The wheel nobody can stop.
    const wx = -ring * 0.62, wz = ring * 0.34;
    const wgy = this._gy(g, wx, wz);
    for (const s of [-1, 1]) {
      this._put(g, G.box, 'woodDark', 0.7, 9.0, 0.7, wx + s * 3.2, wgy + 4.5, wz);
    }
    const hub = new THREE.Group();
    hub.userData.spin = true;
    hub.userData.rate = 0.42;
    hub.position.set(wx, wgy + 6.4, wz);
    g.add(hub);
    if (!g.userData.spin) g.userData.spin = hub;
    this._put(hub, G.cyl, 'ironDark', 0.3, 6.6, 0.3, 0, 0, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      this._put(hub, G.box, 'plank', 9.6, 0.3, 0.24, 0, 0, 0).rotation.z = ang;
      this._put(hub, G.box, 'plank', 1.2, 1.6, 2.6, c * 4.6, s * 4.6, 0)
        .rotation.z = ang;
    }
    this._anchor(g, wx, wgy + 9.5, wz, 2.4);
  }

  /**
   * CUTTER'S REST — THE SAW.
   *
   * They still work it and nobody knows why, so the mill has to look like it
   * is still working: a great blade on a driven shaft, a log deck feeding it,
   * and more cut timber stacked around than anybody could ever have a use for.
   */
  _sigSawmill(g, spec, R, rnd, style, ring) {
    const x = ring * 0.7, z = ring * 0.55;
    const y = this._gy(g, x, z);
    // The open shed: six posts and a long roof, no walls.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 0, 1]) {
        this._put(g, G.cyl, 'woodDark', 0.32, 7.0, 0.32,
          x + sx * 6.0, y + 3.5, z + sz * 5.0);
      }
    }
    this._put(g, G.box, 'plank', 14.0, 0.5, 12.0, x, y + 7.2, z);
    this._put(g, G.box, 'tileDark', 15.0, 0.4, 6.6, x, y + 8.4, z)
      .rotation.z = 0.22;
    this._put(g, G.box, 'plank', 12.0, 0.4, 3.4, x, y + 0.4, z - 1.0);
    this._solid(g, 6.5, 3.5, 6.0, x, y + 3.5, z, 'shed');
    // The blade, on a shaft, mid-cut through a log.
    const hub = new THREE.Group();
    hub.userData.spin = true;
    hub.userData.rate = 5.5;
    hub.position.set(x + 1.2, y + 2.6, z + 1.2);
    g.add(hub);
    if (!g.userData.spin) g.userData.spin = hub;
    this._put(hub, G.disc, 'iron', 2.6, 0.14, 2.6, 0, 0, 0)
      .rotation.x = Math.PI / 2;
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      this._put(hub, G.box, 'iron', 0.5, 0.5, 0.12,
        Math.cos(ang) * 2.7, Math.sin(ang) * 2.7, 0).rotation.z = ang + 0.4;
    }
    this._put(g, G.cyl, 'bark', 0.8, 6.0, 0.8, x + 1.2, y + 1.2, z + 1.2, 0)
      .rotation.z = Math.PI / 2;
    // Log stacks, and the sawdust under them.
    for (let s = 0; s < 3; s++) {
      const lx = x - 11 - s * 3.6, lz = z + (s - 1) * 5;
      const ly = this._gy(g, lx, lz);
      for (let r = 0; r < 3; r++) {
        for (let c2 = 0; c2 < 3 - r; c2++) {
          this._put(g, G.cyl, 'bark', 0.62, 8.0, 0.62,
            lx + (c2 - (2 - r) * 0.5) * 1.3, ly + 0.6 + r * 1.1, lz, 0)
            .rotation.x = Math.PI / 2;
        }
      }
      this._putOn(g, G.disc, 'thatch', 4.0, 0.14, 4.0, lx, lz + 4.5);
    }
    this._signpost(g, x - 9, z - 7, 2.4);
  }

  /**
   * GLASSHOOK — THE RACKS, AND THE HOOK.
   *
   * Fishermen who will not say what they catch, so what is on the racks is
   * deliberately not fish-shaped. The hook itself is the silhouette: a
   * leaning iron mast with a lamp swung out over the water on a chain.
   */
  _sigDryingRacks(g, spec, R, rnd, style, ring) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const rad = ring * 0.72;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const y = this._gy(g, x, z);
      // An A-frame with three lines strung across it.
      for (const s of [-1, 1]) {
        this._put(g, G.cyl, 'woodDark', 0.13, 5.0, 0.13,
          x + Math.cos(a + 1.57) * s * 2.4, y + 2.4,
          z + Math.sin(a + 1.57) * s * 2.4).rotation.z = s * 0.18;
      }
      for (let k = 0; k < 3; k++) {
        this._put(g, G.box, 'rope', 4.8, 0.06, 0.06, x, y + 2.0 + k * 1.1, z,
          -(a + 1.57));
        for (let n = 0; n < 4; n++) {
          const t = (n / 3 - 0.5) * 4.0;
          this._put(g, G.low, n % 2 ? 'bone' : 'boneDark', 0.18, 0.5, 0.12,
            x + Math.cos(a + 1.57) * t, y + 1.7 + k * 1.1,
            z + Math.sin(a + 1.57) * t);
        }
      }
      // A net over the frame.
      if (i % 2 === 0) {
        this._put(g, G.box, 'rope', 5.0, 2.6, 0.08, x, y + 3.4, z, -(a + 1.57));
      }
    }
    // THE HOOK: a leaning mast with the light out on the end of it.
    const hx = ring * 0.1, hz = -ring * 1.0;
    const hy = this._gy(g, hx, hz);
    for (let i = 0; i < 3; i++) {
      this._put(g, G.box, 'stone', 5.0 - i, 0.9, 5.0 - i, hx, hy + 0.45 + i * 0.9, hz);
    }
    this._put(g, G.cyl, 'ironDark', 0.34, 15.0, 0.34, hx, hy + 10.2, hz)
      .rotation.z = 0.13;
    this._put(g, G.cyl, 'ironDark', 0.24, 6.0, 0.24, hx - 2.4, hy + 17.0, hz, 0)
      .rotation.z = 1.15;
    this._put(g, G.torus, 'ironDark', 1.3, 1.3, 1.3, hx - 5.0, hy + 16.0, hz)
      .rotation.y = Math.PI / 2;
    this._put(g, G.cyl, 'rope', 0.05, 2.2, 0.05, hx - 5.0, hy + 14.6, hz);
    this._put(g, G.low, 'lamp', 0.9, 1.1, 0.9, hx - 5.0, hy + 13.2, hz);
    this._solid(g, 1.4, 8, 1.4, hx, hy + 8, hz, 'mast');
    this._anchor(g, hx - 5.0, hy + 13.6, hz, 2.6);
  }

  /**
   * SANDREED — THE OASIS.
   *
   * The pool is the entire reason a town is here, so it is in the middle and
   * everything faces it: a stone rim, palms leaning over it, and a covered
   * bazaar lane running down one side under striped awnings.
   */
  _sigOasis(g, spec, R, rnd, style, ring) {
    const px = -ring * 0.5, pz = ring * 0.35;
    const py = this._gy(g, px, pz);
    this._put(g, G.disc, 'water', 9.0, 0.4, 9.0, px, py - 0.35, pz);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const x = px + Math.cos(a) * 9.4, z = pz + Math.sin(a) * 9.4;
      // Tangentially. See `_solidRun` for why `a + π/2` is the wrong yaw:
      // it lays the block ACROSS the kerb rather than along it, and the
      // ring came out as eighteen slabs at angles to each other.
      this._put(g, G.box, 'sandDark', 3.6, 0.9, 1.6,
        x, this._gy(g, x, z) + 0.25, z, -a - Math.PI / 2);
    }
    // Steps down to the water on one side, so it is a place people use.
    for (let i = 0; i < 3; i++) {
      this._put(g, G.box, 'sandDark', 6.0, 0.4, 1.4,
        px, py - 0.1 - i * 0.4, pz + 9.6 - i * 1.4);
    }
    // Palms, leaning the way palms do.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.7;
      const x = px + Math.cos(a) * 12, z = pz + Math.sin(a) * 12;
      const y = this._gy(g, x, z);
      const h = 8 + rnd() * 5;
      const lean = 0.16 + rnd() * 0.12;
      this._put(g, G.taper, 'bark', 0.42, h, 0.42, x, y + h * 0.5, z)
        .rotation.z = Math.cos(a) * lean;
      const tx = x - Math.cos(a) * lean * h * 0.9;
      for (let k = 0; k < 6; k++) {
        const fa = (k / 6) * Math.PI * 2;
        const f = this._put(g, G.box, 'leaf', 4.6, 0.16, 0.9,
          tx + Math.cos(fa) * 2.0, y + h - 0.3, z + Math.sin(fa) * 2.0, -fa);
        f.rotation.z = 0.34;
      }
      this._put(g, G.low, 'gold', 0.5, 0.6, 0.5, tx, y + h - 0.9, z);
      this._anchor(g, tx, y + h, z, 2.0);
    }
    // The bazaar lane: awnings on posts, all the way down one side.
    for (let i = 0; i < 7; i++) {
      const x = px + 15 + i * 0.4, z = pz - 12 + i * 4.0;
      const y = this._gy(g, x, z);
      for (const s of [-1, 1]) {
        this._put(g, G.cyl, 'woodDark', 0.12, 3.6, 0.12, x + s * 3.0, y + 1.8, z);
      }
      this._put(g, G.box, i % 2 ? 'cloth' : 'clothBlue', 7.0, 0.14, 3.8,
        x, y + 3.7, z, 0.1);
      for (let k = 0; k < 3; k++) {
        this._putOn(g, G.low, rnd() < 0.5 ? 'gold' : 'leafPale',
          0.34, 0.34, 0.34, x - 1.4 + k * 1.4, z + 0.9);
      }
    }
  }

  /**
   * LAKEWATCH — THE PIER.
   *
   * They row out at night and will not say why, so the pier goes a long way
   * out and there is a bell at the end of it. Lamps the whole length, boats
   * tied along it, and the thing they ring when one does not come back.
   */
  _sigPier(g, spec, R, rnd, style, ring) {
    const wy = (SEA + 1.4) - g.position.y;
    const a = -1.1;
    const c = Math.cos(a), s = Math.sin(a);
    const len = ring * 1.9;
    for (let i = 0; i < 16; i++) {
      const t = ring * 0.3 + (i / 15) * len;
      const x = c * t, z = s * t;
      this._put(g, G.box, 'plank', 3.2, 0.34, 3.4, x, wy, z, -a);
      this._solid(g, 1.6, 0.25, 1.7, x, wy, z, 'deck');
      for (const sd of [-1, 1]) {
        const bx = x - s * sd * 1.5, bz = z + c * sd * 1.5;
        this._put(g, G.cyl, 'woodDark', 0.17, 4.0, 0.17, bx, wy - 1.8, bz);
      }
      if (i % 4 === 2) {
        this._lamppost(g, x - s * 1.7, z + c * 1.7, 3.4);
        // A boat, tied on.
        this._put(g, G.low, 'plank', 3.2, 0.55, 1.1,
          x + s * 3.4, wy - 1.1, z - c * 3.4, -a);
      }
    }
    // The bell at the end, in its frame.
    const ex = c * (ring * 0.3 + len), ez = s * (ring * 0.3 + len);
    for (const sd of [-1, 1]) {
      this._put(g, G.cyl, 'woodDark', 0.26, 6.0, 0.26,
        ex - s * sd * 1.8, wy + 3.0, ez + c * sd * 1.8);
    }
    this._put(g, G.box, 'woodDark', 4.4, 0.4, 0.4, ex, wy + 6.1, ez, -a + Math.PI / 2);
    this._put(g, G.taper, 'gold', 1.4, 2.2, 1.4, ex, wy + 4.7, ez);
    this._put(g, G.low, 'gold', 0.3, 0.4, 0.3, ex, wy + 3.4, ez);
    this._anchor(g, ex, wy + 6.1, ez, 2.4);
    this._solid(g, 1.6, 1.2, 1.6, ex, wy + 4.7, ez, 'bell');
  }

  /**
   * MOONWATCH — THE OBSERVATORY.
   *
   * Astronomers who have not slept in years, and the reason is on the roof: a
   * dome, a brass ring big enough to walk through, and a tube pointed at
   * whatever it is they are watching. It leans north, which is where the
   * Ashen Throne is.
   */
  _sigObservatory(g, spec, R, rnd, style, ring) {
    const x = ring * 0.25, z = -ring * 0.8;
    const y = this._gy(g, x, z);
    for (let i = 0; i < 3; i++) {
      this._put(g, G.disc, 'stonePale', 7.4 - i * 0.8, 0.8, 7.4 - i * 0.8,
        x, y + 0.4 + i * 0.8, z);
    }
    this._put(g, G.cyl, 'stonePale', 4.6, 14, 4.6, x, y + 9.4, z);
    // Windows, all the way round, all of them lit.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this._put(g, G.box, 'lamp', 0.7, 1.4, 0.3,
        x + Math.cos(a) * 4.6, y + 8.0 + (i % 3) * 2.2, z + Math.sin(a) * 4.6, -a);
    }
    // The dome, and the slot cut in it.
    this._put(g, G.low, 'iron', 5.2, 3.4, 5.2, x, y + 16.4, z);
    this._put(g, G.box, 'obsidian', 1.6, 3.6, 5.4, x, y + 17.4, z, 0.4);
    // The great brass ring, tilted the way an armillary is.
    this._put(g, G.torus, 'gold', 6.4, 6.4, 6.4, x, y + 17.0, z)
      .rotation.set(0.9, 0.4, 0);
    this._put(g, G.torus, 'gold', 5.4, 5.4, 5.4, x, y + 17.0, z)
      .rotation.set(1.9, 1.1, 0);
    // The tube, pointed north.
    const tube = this._put(g, G.taper, 'ironDark', 0.9, 9.0, 0.9,
      x, y + 19.5, z - 2.2);
    tube.rotation.x = -0.95;
    this._put(g, G.torus, 'gold', 1.0, 1.0, 1.0, x, y + 22.4, z - 4.6)
      .rotation.x = 0.6;
    this._solid(g, 4.2, 7, 4.2, x, y + 7, z, 'tower');
    this._anchor(g, x, y + 16, z, 3.0);
    // Charts pinned up outside, and the ladder they left leaning.
    for (let i = 0; i < 4; i++) {
      const a = 2.2 + i * 0.5;
      this._put(g, G.box, 'bone', 1.6, 2.0, 0.08,
        x + Math.cos(a) * 5.0, y + 2.6, z + Math.sin(a) * 5.0, -a);
    }
    this._put(g, G.box, 'plank', 0.3, 9.0, 0.3, x + 5.4, y + 4.4, z + 1.0)
      .rotation.z = 0.24;
  }

  /**
   * THE HOLLOW MARKET — THE STALLS, AND NOBODY.
   *
   * Stalls, awnings, prices chalked up, says the blurb. So the signature is
   * scale: forty-odd stalls in rows with the goods still on them, every
   * awning intact, and one enormous bell in the middle that nobody rang. An
   * empty market is far more frightening than a ruined one.
   */
  _sigEmptyStalls(g, spec, R, rnd, style, ring) {
    for (let row = -3; row <= 3; row++) {
      for (let col = -3; col <= 3; col++) {
        if (Math.abs(row) < 1 && Math.abs(col) < 1) continue;
        const x = col * 9.5 + (rnd() - 0.5) * 1.4;
        const z = row * 8.5 + (rnd() - 0.5) * 1.4;
        if (Math.hypot(x, z) > ring * 1.05) continue;
        this._stall(g, x, z, (row + col) % 2 ? 0 : Math.PI / 2, rnd);
        // The chalked price board, still legible.
        this._putOn(g, G.box, 'obsidian', 1.2, 1.5, 0.1, x + 2.6, z - 1.4, 0.4);
        if (rnd() < 0.4) this._clutter(g, x - 3.0, z + 2.4, rnd);
      }
    }
    // THE BELL. Nobody rang it, and that is the whole story of the place.
    const y = this._gy(g, 0, 0);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._put(g, G.cyl, 'woodDark', 0.5, 13.0, 0.5,
          sx * 3.4, y + 6.5, sz * 3.4).rotation.z = -sx * 0.1;
      }
    }
    this._put(g, G.box, 'woodDark', 8.0, 0.7, 0.7, 0, y + 12.6, 0);
    this._put(g, G.box, 'woodDark', 0.7, 0.7, 8.0, 0, y + 12.6, 0);
    this._put(g, G.cone, 'tileDark', 6.4, 3.0, 6.4, 0, y + 14.4, 0);
    this._put(g, G.taper, 'gold', 3.2, 5.4, 3.2, 0, y + 9.2, 0);
    this._put(g, G.low, 'gold', 0.8, 1.0, 0.8, 0, y + 6.2, 0);
    this._solid(g, 3.0, 3.0, 3.0, 0, y + 9.0, 0, 'bell');
    this._anchor(g, 0, y + 12.6, 0, 3.2);
  }

  /**
   * LUMEN — THE LIGHT FIELDS.
   *
   * They grow the light and they will show you how. Terraces stepping up the
   * slope, each one a bed of something that glows, with tall stalks at the
   * back and glass frames over the young ones. In the Rimefang's dark it is
   * visible from a very long way off, which is the point.
   */
  _sigLightFields(g, spec, R, rnd, style, ring) {
    for (let t = 0; t < 4; t++) {
      const rad = ring * (0.5 + t * 0.22);
      const lift = t * 1.5;
      // The retaining wall of the terrace.
      const seg = 18 + t * 4;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2 - 0.9;
        if (a > 0.5 && a < 1.3) continue;                 // the way up
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        const y = this._gy(g, x, z);
        /**
         * The retaining wall of the terrace — laid tangentially, and SOLID.
         *
         * Four tiers of it hold the Light Fields up, and none of it had a
         * collider: the whole signature of Lumen was a stack of terraces
         * you walked straight through the side of. The way up is the gap
         * the loop above skips.
         */
        const dx = -Math.sin(a), dz = Math.cos(a);
        const h = 1.6 + lift;
        this._put(g, G.box, 'stoneDark', rad * 0.42, h, 1.2,
          x, y + h * 0.5 - 0.5, z, -a - Math.PI / 2);
        this._solidRun(g, x, y + h * 0.5 - 0.5, z, dx, dz,
          rad * 0.42, 0.8, h * 0.5, 'wall');
      }
      // The crop: rows of glowing bulbs, brighter the higher you go.
      const beds = 20 + t * 6;
      for (let i = 0; i < beds; i++) {
        const a = (i / beds) * Math.PI * 2 + t * 0.2;
        const r2 = rad - 3.2 - rnd() * 2.4;
        const x = Math.cos(a) * r2, z = Math.sin(a) * r2;
        const y = this._gy(g, x, z) + lift * 0.7;
        this._put(g, G.cyl, 'bark', 0.12, 1.3 + rnd() * 0.8, 0.12, x, y + 0.7, z);
        this._put(g, G.low, t >= 2 ? 'glow' : 'green',
          0.34 + rnd() * 0.2, 0.4, 0.34, x, y + 1.6, z);
      }
      // Glass frames over the young beds.
      if (t < 2) {
        for (let i = 0; i < 3; i++) {
          const a = 2.0 + i * 1.1 + t;
          const x = Math.cos(a) * (rad - 6), z = Math.sin(a) * (rad - 6);
          const y = this._gy(g, x, z) + lift * 0.7;
          this._put(g, G.box, 'crystal', 3.4, 0.1, 2.6, x, y + 1.2, z, a)
            .rotation.z = 0.2;
          for (const sx of [-1, 1]) {
            this._put(g, G.cyl, 'plank', 0.09, 1.2, 0.09, x + sx * 1.5, y + 0.6, z);
          }
        }
      }
    }
    // The tall stalks at the top: the thing you see from the pass.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * ring * 0.28, z = Math.sin(a) * ring * 0.28;
      const y = this._gy(g, x, z);
      const h = 9 + rnd() * 5;
      this._put(g, G.taper, 'bark', 0.3, h, 0.3, x, y + h * 0.5, z);
      this._put(g, G.low, 'glow', 1.3, 1.7, 1.3, x, y + h + 0.7, z);
      this._anchor(g, x, y + h, z, 2.0);
    }
  }

  // -------------------------------------------------------- settlement kinds

  /**
   * A settlement: houses round a centre, and a reason for each one.
   *
   * Stilted where the ground is wet, because three of the settlements are in
   * marshes and a hut with its floor under the waterline is a hut nobody
   * lives in. The stilt height is measured from the actual ground, so the
   * same code builds Croakhollow on dry land and The Stilts over the fen.
   *
   * Returns the spots the people who live here may stand on.
   */
  _settlement(g, spec, R, rnd, style, cfg) {
    const spots = [];
    /**
     * Two versions of the same village, and only one of them drawn.
     *
     * A settlement in a region a guardian still holds is boarded up: planks
     * over the doorways, a cold brazier, a broken cart, a scorch where
     * something came through. Put that guardian down and the boards come off,
     * the brazier is lit, banners go up and there is scaffolding where they
     * have started repairing the roof.
     *
     * Both sets are built once and toggled by `setFreed`, because a village
     * that rebuilt itself by allocating geometry would do it in the frame the
     * player walked back in.
     */
    const wreck = new THREE.Group();
    const mend = new THREE.Group();
    // `keep` tells `flatten` these two must survive as separate groups: their
    // whole job is to be shown one at a time. See the note above `flatten`.
    wreck.userData.keep = true;
    mend.userData.keep = true;
    g.add(wreck, mend);
    g.userData.wreck = wreck;
    g.userData.mend = mend;
    const ring = spec.r * cfg.ring;
    const n = cfg.houses;
    /** Where every front door is, in the group's own coordinates. */
    const doors = [];
    for (let i = 0; i < n; i++) {
      // Two rings for a city, one for anything smaller — a single ring of
      // twenty-eight houses is a fence, not a city.
      const inner = cfg.houses > 20 && i % 3 === 0;
      const rad = inner ? ring * 0.52 : ring * (0.9 + rnd() * 0.22);
      const a = (i / n) * Math.PI * 2 + rnd() * 0.18;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const gy = this.realm.heightAt(g.position.x + x, g.position.z + z);
      const drop = gy - g.position.y;
      const stilt = Math.max(0, (SEA + 1.8) - gy) + (R.amphibious ? 1.2 : 0.3);
      const w = 3.0 + rnd() * 1.6, d = 3.0 + rnd() * 1.6;
      const h = 2.6 + rnd() * 1.4;
      this._house(g, x, z, w, d, h, a + Math.PI, style, drop + stilt);
      spots.push({ x: g.position.x + x * 0.72, z: g.position.z + z * 0.72 });
      doors.push({ x: x * 0.78, z: z * 0.78, a, w, d });
    }

    // The centre: a well, a fire, and the lamps that make it findable at dusk.
    this._put(g, G.cyl, 'stone', 1.6, 1.2, 1.6, 0, 0.45, 0);
    this._put(g, G.cyl, 'stoneDark', 1.3, 0.3, 1.3, 0, 1.0, 0);
    this._solid(g, 1.6, 0.7, 1.6, 0, 0.5, 0, 'well');
    for (const sx of [-1, 1]) {
      this._put(g, G.cyl, style.post, 0.12, 2.6, 0.12, sx * 1.5, 1.7, 0);
    }
    this._put(g, G.box, style.trim, 3.4, 0.16, 0.3, 0, 3.0, 0);
    this._fire(g, ring * 0.34, ring * 0.2, rnd);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      this._lamppost(g, Math.cos(a) * ring * 0.5, Math.sin(a) * ring * 0.5);
    }
    spots.push({ x: g.position.x, z: g.position.z + 4 });

    // A market, for towns and cities.
    for (let i = 0; i < cfg.market; i++) {
      const a = (i / Math.max(1, cfg.market)) * Math.PI * 2;
      const rad = ring * 0.3;
      this._stall(g, Math.cos(a) * rad, Math.sin(a) * rad, a + Math.PI, rnd);
      spots.push({
        x: g.position.x + Math.cos(a) * rad * 0.6,
        z: g.position.z + Math.sin(a) * rad * 0.6,
      });
    }

    // The big buildings: a hall, an inn, a smithy. These are what make a town
    // read as bigger than a village from outside it.
    const BIG = [
      { w: 9, d: 7, h: 6.5, roofTall: true },
      { w: 7, d: 6, h: 5.5, roofTall: false },
      { w: 6, d: 6, h: 4.5, roofTall: false },
    ];
    for (let i = 0; i < cfg.big; i++) {
      const a = Math.PI * 0.5 + i * 2.1;
      const rad = ring * 0.66;
      const b = BIG[i];
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const gy = this.realm.heightAt(g.position.x + x, g.position.z + z);
      const stilt = Math.max(0, (SEA + 1.8) - gy) + 0.3;
      this._house(g, x, z, b.w, b.d, b.h, a + Math.PI, style,
        gy - g.position.y + stilt);
      if (b.roofTall) {
        // A tower on the hall, with a bell in it: a skyline for the town.
        this._put(g, G.cyl, style.wall, 1.8, 12, 1.8, x, gy - g.position.y + 6, z);
        this._put(g, G.cone, style.roofMat, 2.6, 4, 2.6, x,
          gy - g.position.y + 14, z);
        this._put(g, G.low, 'gold', 0.8, 1.0, 0.8, x, gy - g.position.y + 11.4, z);
        this._anchor(g, x, gy - g.position.y + 12, z, 2.2);
      }
      if (i === 2) {
        // The smithy's forge and anvil, outside where you can see them.
        this._put(g, G.box, 'stoneDark', 1.6, 1.4, 1.6, x + 4, 0.7, z);
        this._put(g, G.low, 'ember', 0.6, 0.5, 0.6, x + 4, 1.6, z);
        this._put(g, G.box, 'iron', 0.9, 0.7, 0.5, x + 4, 0.4, z + 2.4);
        spots.push({ x: g.position.x + x + 4, z: g.position.z + z + 2.4 });
      }
    }

    /**
     * ---- WHAT TURNS A RING OF HOUSES INTO SOMEWHERE PEOPLE LIVE ----
     *
     * Everything below this line is dressing, and dressing is most of what a
     * village IS. A house is a box with a roof on it wherever you build it;
     * what tells you somebody lives in that box is the path worn to its door,
     * the washing on the line beside it, the garden it eats out of and the
     * firewood stacked against its wall.
     *
     * All of it hugs the terrain — every paving stone, rail and post asks
     * `_gy` where the ground is — and all of it is merged into the same eight
     * meshes as the houses by `flatten`, so a village that reads as lived-in
     * costs the same number of draw calls as one that reads as a diagram.
     */
    this._plaza(g, Math.min(19, ring * 0.44), rnd);
    for (const d of doors) {
      // The path in from the square, and the yard round the door.
      this._path(g, Math.cos(d.a) * ring * 0.3, Math.sin(d.a) * ring * 0.3,
        d.x, d.z, rnd);
      const out = d.a + Math.PI;
      const side = d.a + 1.9;
      if (rnd() < 0.55) {
        this._garden(g, d.x + Math.cos(side) * 5.4, d.z + Math.sin(side) * 5.4,
          d.a, rnd);
      }
      if (rnd() < 0.6) {
        this._clutter(g, d.x + Math.cos(out) * 2.6 + Math.cos(side) * 2.2,
          d.z + Math.sin(out) * 2.6 + Math.sin(side) * 2.2, rnd);
      }
    }
    // Washing between every second pair of neighbours, and lanterns strung
    // across the square. Both are lines rather than objects, which is why
    // they read from a distance: they cross the gaps the houses leave.
    for (let i = 0; i < doors.length; i += 2) {
      const a2 = doors[(i + 1) % doors.length];
      const d = doors[i];
      if (Math.hypot(a2.x - d.x, a2.z - d.z) > ring * 0.9) continue;
      this._washline(g, d.x, d.z, a2.x, a2.z, rnd);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI + 0.4;
      const r2 = ring * 0.46;
      this._lanternLine(g, Math.cos(a) * r2, Math.sin(a) * r2,
        Math.cos(a + Math.PI) * r2, Math.sin(a + Math.PI) * r2, 6);
    }
    // The road in, named, and a fence with a gap for it. A city has a wall
    // instead, so it does not get one.
    this._signpost(g, ring * 0.94, ring * 0.24, 0.25);
    if (!cfg.wall) this._fenceRun(g, spec.r * 0.88, rnd, [0.25, 0.25 + Math.PI]);
    // And the one thing this place, and only this place, is known for.
    this._signature(g, spec, R, rnd, style, ring, spots);

    // ---- boarded up, or rebuilding ----
    {
      const ring2 = ring * 0.9;
      // Boards over three of the doorways, a cold brazier, a broken cart.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.9;
        const x = Math.cos(a) * ring2, z = Math.sin(a) * ring2;
        const gy = this.realm.heightAt(g.position.x + x, g.position.z + z)
          - g.position.y;
        for (let k = 0; k < 3; k++) {
          const m = this._put(wreck, G.box, 'plank', 3.4, 0.3, 0.22,
            x, gy + 1.2 + k * 0.9, z, a);
          m.rotation.z = (k - 1) * 0.16;
        }
      }
      this._put(wreck, G.cyl, 'ash', 1.0, 1.2, 1.0, -ring * 0.3, 0.6, ring * 0.3);
      this._put(wreck, G.low, 'ash', 0.9, 0.35, 0.9, -ring * 0.3, 1.3, ring * 0.3);
      const cart = this._put(wreck, G.box, 'woodDark', 2.6, 0.3, 1.8,
        ring * 0.42, 0.5, -ring * 0.3, 0.7);
      cart.rotation.z = 0.5;
      this._put(wreck, G.disc, 'woodDark', 1.0, 0.25, 1.0,
        ring * 0.34, 0.3, -ring * 0.42, 0.4).rotation.x = 0.2;
      // A scorch where something came through the fence.
      this._put(wreck, G.disc, 'obsidian', 4.4, 0.12, 4.4, ring * 0.1, 0.1, -ring2);

      /**
       * FROGATH'S BANNERS.
       *
       * The thing that says who is in charge here, without a word of
       * dialogue. Four black poles round the square, each with a long dark
       * banner and a pale eye on it, and a garrison brazier under them. They
       * are in the `wreck` group, so putting the region's guardian down takes
       * them down — the same beat that unboards the doors — and the village's
       * own coloured bunting goes up in their place.
       *
       * This is why the banners are here rather than in a separate system:
       * "the enemy's flags come down when you win" has to be one flag toggle
       * or it will eventually get out of step with the boards.
       */
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.45;
        const bx = Math.cos(a) * ring * 0.66, bz = Math.sin(a) * ring * 0.66;
        const gy = this.realm.heightAt(g.position.x + bx, g.position.z + bz)
          - g.position.y;
        this._put(wreck, G.cyl, 'ironDark', 0.14, 8.2, 0.14, bx, gy + 4.1, bz);
        this._put(wreck, G.box, 'obsidian', 1.7, 4.4, 0.10,
          bx, gy + 5.6, bz, a);
        // The eye. Two marks, and everybody in the country knows them.
        this._put(wreck, G.low, 'pale', 0.34, 0.20, 0.06, bx, gy + 6.4, bz, a);
        this._put(wreck, G.box, 'obsidian', 0.10, 0.34, 0.08, bx, gy + 6.4, bz, a);
        this._put(wreck, G.box, 'obsidian', 1.9, 0.16, 0.14, bx, gy + 7.9, bz, a);
      }
      // The garrison's fire, which is the only warm thing in an occupied
      // village — and it is not for the villagers.
      this._put(wreck, G.cyl, 'ironDark', 0.9, 1.4, 0.9, ring * 0.2, 0.7, ring * 0.5);
      this._put(wreck, G.low, 'ember', 0.7, 0.5, 0.7, ring * 0.2, 1.5, ring * 0.5);

      // Banners, bunting, a lit brazier and scaffolding on the hall roof.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const x = Math.cos(a) * ring * 0.52, z = Math.sin(a) * ring * 0.52;
        this._put(mend, G.box, i % 2 ? 'cloth' : 'clothBlue',
          1.4, 3.2, 0.16, x, 4.2, z, a);
      }
      this._put(mend, G.cyl, 'stoneDark', 1.1, 1.6, 1.1, -ring * 0.3, 0.8, ring * 0.3);
      this._put(mend, G.low, 'ember', 1.0, 1.1, 1.0, -ring * 0.3, 1.9, ring * 0.3);
      for (let i = 0; i < 5; i++) {
        this._put(mend, G.cyl, 'plank', 0.12, 5.0, 0.12,
          ring * 0.6 + i * 1.3, 2.5, -ring * 0.2);
      }
      for (let i = 0; i < 3; i++) {
        this._put(mend, G.box, 'plank', 6.4, 0.2, 0.5,
          ring * 0.6 + 2.6, 1.4 + i * 1.6, -ring * 0.2);
      }
      // Fresh thatch, stacked and ready to go up.
      this._put(mend, G.cyl, 'thatch', 1.1, 2.2, 1.1,
        ring * 0.6 + 6, 1.1, -ring * 0.2, 0.4).rotation.z = Math.PI / 2;
      wreck.visible = true;
      mend.visible = false;
    }

    // A wall, for a city.
    if (cfg.wall) {
      const rw = spec.r * 0.94;
      const seg = 22;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        // Two gaps, so the roads have somewhere to come in.
        if (i === 0 || i === 1 || i === Math.floor(seg / 2)) continue;
        const x = Math.cos(a) * rw, z = Math.sin(a) * rw;
        const gy = this.realm.heightAt(g.position.x + x, g.position.z + z);
        const base = gy - g.position.y;
        // Tangentially, and solid the whole way along. See `_solidRun` —
        // the yaw was `a + π/2`, which rotates every off-axis segment the
        // wrong way and left half the city wall walk-through.
        const dx = -Math.sin(a), dz = Math.cos(a);
        this._put(g, G.box, 'stone', rw * 0.32, 7, 2.4, x, base + 3.5, z,
          -a - Math.PI / 2);
        this._solidRun(g, x, base + 3.5, z, dx, dz, rw * 0.32, 1.5, 3.5,
          'wall');
        if (i % 5 === 0) {
          this._put(g, G.cyl, 'stoneDark', 2.6, 12, 2.6, x, base + 6, z);
          this._put(g, G.cone, 'tileDark', 3.2, 4, 3.2, x, base + 14, z);
          this._solid(g, 2.6, 6, 2.6, x, base + 6, z, 'tower');
        }
      }
    }
    return spots;
  }

  /**
   * A village inside a tree.
   *
   * The trunk is the region's landmark and stands at the same coordinates, so
   * this builds only what is bolted to it: platforms spiralling up, rope
   * bridges between them, and huts out on the branches. The platforms carry
   * `deck` colliders, which is the tag the character controller allows a
   * two-unit step onto — so they are stairs you can actually climb.
   */
  _treeVillage(g, spec, R, rnd, style) {
    const spots = [];
    /** Every platform, so the bridges and the lantern lines can find them. */
    const decks = [];
    for (let i = 0; i < 11; i++) {
      const a = i * 0.86;
      const y = 6 + i * 6.5;
      const rad = 27 + (i % 3) * 5;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      this._put(g, G.box, 'plank', 7, 0.5, 6, x, y, z, a);
      this._solid(g, 3.6, 0.3, 3.2, x, y, z, 'deck');
      // The walkway back to the trunk.
      const mx = Math.cos(a) * rad * 0.55, mz = Math.sin(a) * rad * 0.55;
      /**
       * The walkway back to the trunk — RADIALLY, which is what it is.
       *
       * A plank running from a deck to the middle of the tree points along
       * the radius, not along the tangent — and this plank's LONG axis is
       * its local Z, not its X (the scale is 2.4 by 0.35 by rad·0.9). Local
       * +Z under a yaw θ points at (sin θ, cos θ), and the outward radius
       * is (cos a, sin a), so θ = π/2 − a. It was `a + π/2`, which is that
       * with the z component flipped, and the walkway came out lying across
       * the gap it was supposed to bridge.
       */
      this._put(g, G.box, 'plank', 2.4, 0.35, rad * 0.9, mx, y - 0.1, mz,
        Math.PI / 2 - a);
      this._solidRun(g, mx, y - 0.1, mz, Math.cos(a), Math.sin(a),
        rad * 0.45, 1.2, 0.25, 'deck');
      if (i % 2 === 0) {
        this._house(g, x, z, 3.0, 2.8, 2.6, a + Math.PI, style, y + 0.3);
        spots.push({ x: g.position.x + x, z: g.position.z + z });
      }
      this._lamppost(g, x + 2, z + 2, 3.0);
      this._anchor(g, x, y + 2, z, 2.0);
      decks.push({ x, z, y, a });
      // A rail round the outside edge, because eleven platforms with no rails
      // read as scaffolding rather than as somebody's balcony.
      for (let k = 0; k < 6; k++) {
        const ra = a + (k / 6 - 0.5) * 1.5;
        const rx = Math.cos(ra) * (rad + 3.2), rz = Math.sin(ra) * (rad + 3.2);
        this._put(g, G.cyl, 'woodDark', 0.08, 1.1, 0.08, rx, y + 0.8, rz);
      }
      // Bunting and lanterns strung out to the branch above.
      this._put(g, G.box, 'rope', 0.08, 6.5, 0.08, x, y + 3.4, z);
      this._put(g, G.low, 'lamp', 0.3, 0.38, 0.3, x + 1.6, y + 2.2, z + 1.6);
    }
    /**
     * THE ROPE BRIDGES.
     *
     * The thing that makes Roothome read as one village rather than eleven
     * sheds nailed to a tree: every platform is joined to the next one round
     * the spiral, so from the ground it is a web of walkways going up into the
     * canopy with lanterns hanging off all of them.
     */
    for (let i = 0; i < decks.length - 1; i++) {
      const A = decks[i], B = decks[i + 1];
      const mx = (A.x + B.x) * 0.5, mz = (A.z + B.z) * 0.5;
      const my = (A.y + B.y) * 0.5;
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      const face = -Math.atan2(B.z - A.z, B.x - A.x);
      const deck = this._put(g, G.box, 'plank', len, 0.28, 1.7, mx, my, mz, face);
      deck.rotation.z = 0;
      this._solid(g, len * 0.4, 0.3, 0.85, mx, my, mz, 'deck');
      for (const s of [-1, 1]) {
        const rx = mx - Math.sin(-face) * s * 0.9;
        const rz = mz - Math.cos(-face) * s * 0.9;
        this._put(g, G.box, 'rope', len, 0.07, 0.07, rx, my + 1.1, rz, face);
      }
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        this._put(g, G.low, 'lamp', 0.22, 0.28, 0.22,
          A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t + 1.0,
          A.z + (B.z - A.z) * t);
      }
      this._anchor(g, mx, my + 1.2, mz, 2.0);
    }
    /**
     * THE GREAT LANTERN.
     *
     * Hung in the middle of the spiral on four chains, three metres across.
     * It is the only thing in the Hollowroot you can see from outside the
     * treeline at night, and it is what Roothome means.
     */
    const gy = 44;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this._put(g, G.cyl, 'rope', 0.07, 16, 0.07,
        Math.cos(a) * 5.0, gy + 10, Math.sin(a) * 5.0).rotation.z = Math.cos(a) * 0.28;
    }
    this._put(g, G.cone, 'tileDark', 3.6, 1.8, 3.6, 0, gy + 3.2, 0);
    this._put(g, G.taper, 'lamp', 2.6, 4.4, 2.6, 0, gy, 0);
    this._put(g, G.torus, 'gold', 2.9, 2.9, 2.9, 0, gy - 2.0, 0)
      .rotation.x = Math.PI / 2;
    this._put(g, G.low, 'gold', 0.5, 0.9, 0.5, 0, gy - 2.9, 0);
    this._anchor(g, 0, gy, 0, 3.4);
    // The ground floor: a market round the roots, paved, under lantern lines.
    this._plaza(g, 26, rnd, 'plank');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      this._stall(g, Math.cos(a) * 34, Math.sin(a) * 34, a + Math.PI, rnd);
      spots.push({ x: g.position.x + Math.cos(a) * 30, z: g.position.z + Math.sin(a) * 30 });
      this._lanternLine(g, Math.cos(a) * 30, Math.sin(a) * 30,
        Math.cos(a + Math.PI * 0.5) * 30, Math.sin(a + Math.PI * 0.5) * 30, 5);
      this._clutter(g, Math.cos(a + 0.4) * 22, Math.sin(a + 0.4) * 22, rnd);
    }
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 1.0;
      this._garden(g, Math.cos(a) * 40, Math.sin(a) * 40, a, rnd);
    }
    this._fire(g, 0, 36, rnd);
    this._signpost(g, 30, 30, 0.8);
    return spots;
  }

  /**
   * A village that has been burned.
   *
   * Mirefoot, where the game starts, and it has to do a specific job: say
   * what happened here without a line of text. So it is built as a village
   * FIRST — the same ring, the same well, the same doorways — and then taken
   * apart: roofs gone, wall stumps standing, every timber charred, the well
   * rope cut, a cart on its side with everything spilled out of it, and one
   * of Frogath's banners planted in the middle of the square where the fire
   * pit used to be.
   *
   * The shape of a village with no roofs on it is the whole point. A pile of
   * rubble reads as scenery; eight house-shaped outlines with their windows
   * still in them reads as somewhere people lived last week.
   */
  _burnt(g, spec, rnd, style) {
    const ring = spec.r * 0.6;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.2;
      const rad = ring * (0.86 + rnd() * 0.26);
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const gy = this.realm.heightAt(g.position.x + x, g.position.z + z)
        - g.position.y;
      const w = 3.0 + rnd() * 1.5, d = 3.0 + rnd() * 1.5;
      // Wall stumps: three sides up, one side down, so you can see inside.
      const h = 1.0 + rnd() * 1.4;
      const face = a + Math.PI;
      const c = Math.cos(face), s = Math.sin(face);
      const wall = (ox, oz, ww, dd) => {
        this._put(g, G.box, 'woodDark', ww, h, dd,
          x + ox * c - oz * s, gy + h / 2, z + ox * s + oz * c, face);
      };
      wall(0, -d / 2, w, 0.3);
      wall(-w / 2, 0, 0.3, d);
      wall(w / 2, 0, 0.3, d);
      // The doorway, still standing, with its frame burned black.
      this._put(g, G.box, 'obsidian', 0.34, 2.4, 0.34,
        x + (-0.9) * c - (d / 2) * s, gy + 1.2, z + (-0.9) * s + (d / 2) * c);
      this._put(g, G.box, 'obsidian', 0.34, 2.4, 0.34,
        x + (0.9) * c - (d / 2) * s, gy + 1.2, z + (0.9) * s + (d / 2) * c);
      this._put(g, G.box, 'obsidian', 2.4, 0.3, 0.34,
        x + 0 * c - (d / 2) * s, gy + 2.4, z + 0 * s + (d / 2) * c, face);
      // A chimney, because a chimney is the only thing that survives a fire.
      this._put(g, G.box, 'stoneDark', 1.0, 3.4 + rnd() * 1.6, 1.0,
        x + (w / 2 - 0.4) * c, gy + 1.7, z + (w / 2 - 0.4) * s);
      // Fallen roof timbers, leaning where the roof went.
      for (let k = 0; k < 3; k++) {
        const m = this._put(g, G.cyl, 'obsidian', 0.14, 3.6, 0.14,
          x + (rnd() - 0.5) * w, gy + 0.7, z + (rnd() - 0.5) * d, rnd() * 3);
        m.rotation.z = 0.9 + rnd() * 0.5;
      }
      this._put(g, G.disc, 'ash', w * 0.7, 0.08, d * 0.7, x, gy + 0.04, z);
      this._solid(g, w * 0.5, h * 0.5, 0.2,
        x + 0 * c - (d / 2) * s, gy + h / 2, z + 0 * s + (d / 2) * c, 'wall');
    }

    /**
     * The well, with the rope cut.
     *
     * A small thing that people notice: whoever came through did not just
     * burn the place, they made sure nobody could come back to it.
     */
    this._put(g, G.cyl, 'stone', 2.0, 1.4, 2.0, 0, 0.7, 0);
    this._put(g, G.cyl, 'obsidian', 1.7, 0.2, 1.7, 0, 1.4, 0);
    for (const sx of [-1, 1]) {
      this._put(g, G.cyl, 'obsidian', 0.14, 3.0, 0.14, sx * 1.6, 2.2, 0);
    }
    this._put(g, G.cyl, 'rope', 0.06, 1.1, 0.06, -1.6, 2.9, 0);
    this._solid(g, 2.0, 0.7, 2.0, 0, 0.7, 0, 'solid');

    /**
     * Frogath's banner, in the middle of the square.
     *
     * Planted where the village fire used to be, and it is still standing
     * because nobody has come back to pull it down. This is the first time
     * the player sees the eye, and every occupied village in the country has
     * four more of them.
     */
    this._put(g, G.cyl, 'ironDark', 0.16, 9.0, 0.16, 0, 4.5, ring * 0.42);
    this._put(g, G.box, 'obsidian', 2.0, 5.0, 0.12, 0, 6.0, ring * 0.42);
    this._put(g, G.low, 'pale', 0.40, 0.24, 0.07, 0, 7.0, ring * 0.42);
    this._put(g, G.box, 'obsidian', 0.12, 0.40, 0.09, 0, 7.0, ring * 0.42);
    this._put(g, G.box, 'obsidian', 2.2, 0.18, 0.16, 0, 8.6, ring * 0.42);

    // The cart everybody was loading when the soldiers arrived, on its side.
    const cart = this._put(g, G.box, 'woodDark', 3.2, 0.35, 2.0,
      -ring * 0.36, 0.7, -ring * 0.3, 0.6);
    cart.rotation.z = 1.4;
    for (const sx of [-1, 1]) {
      this._put(g, G.disc, 'woodDark', 1.2, 0.28, 1.2,
        -ring * 0.36 + sx * 0.9, 0.4, -ring * 0.3 - 1.2).rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 7; i++) {
      this._put(g, G.low, i % 3 ? 'thatch' : 'plank',
        0.28, 0.22, 0.28, -ring * 0.36 + (rnd() - 0.5) * 5,
        0.18, -ring * 0.3 + (rnd() - 0.5) * 5);
    }
    // Scorch on the ground, spreading out from the square.
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * ring;
      this._put(g, G.disc, 'ash', 3 + rnd() * 5, 0.06, 3 + rnd() * 5,
        Math.cos(a) * d, 0.03, Math.sin(a) * d);
    }
    void style;
    return null;
  }

  /** A camp: a fire, two lean-tos and somebody's kit. */
  _camp(g, spec, rnd, style) {
    const spots = [];
    this._fire(g, 0, 0, rnd);
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.6;
      const x = Math.cos(a) * 6, z = Math.sin(a) * 6;
      this._put(g, G.box, 'thatch', 3.0, 0.2, 2.2, x, 1.6, z, a);
      for (const sx of [-1, 1]) {
        this._put(g, G.cyl, 'woodDark', 0.11, 3.2, 0.11,
          x + Math.cos(a + Math.PI / 2) * sx * 2.4, 0.8,
          z + Math.sin(a + Math.PI / 2) * sx * 2.4);
      }
      this._solid(g, 3.0, 0.2, 2.2, x, 1.6, z, 'deck');
      spots.push({ x: g.position.x + x * 0.6, z: g.position.z + z * 0.6 });
    }
    // A cart, a crate and a stack of spears: somebody is living here.
    this._put(g, G.box, 'plank', 3.0, 0.3, 2.0, 4, 1.1, -5, 0.4);
    for (const sx of [-1, 1]) {
      this._put(g, G.disc, 'woodDark', 1.1, 0.3, 1.1, 4 + sx * 1.2, 1.0, -5,
        Math.PI / 2).rotation.z = Math.PI / 2;
    }
    this._put(g, G.box, 'wood', 1.0, 1.0, 1.0, -5, 0.5, 4);
    this._solid(g, 1.0, 0.5, 1.0, -5, 0.5, 4, 'crate');
    this._lamppost(g, -4, 4, 6.0);
    return spots;
  }

  /** One hut, off on its own, with a garden of things nobody should eat. */
  _hut(g, spec, rnd, style) {
    this._house(g, 0, 0, 4.4, 4.0, 3.4, 0.6, style,
      Math.max(0, SEA + 1.8 - g.position.y) + 0.4);
    this._fire(g, 5, 3, rnd);
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2, d = 6 + rnd() * 8;
      this._put(g, G.cone, i % 3 ? 'leaf' : 'green', 0.7, 1.6, 0.7,
        Math.cos(a) * d, 0.8, Math.sin(a) * d);
    }
    // Things hanging up to dry.
    for (const sx of [-1, 1]) {
      this._put(g, G.cyl, 'woodDark', 0.1, 4.0, 0.1, sx * 5, 2, -5);
    }
    this._put(g, G.box, 'rope', 10, 0.08, 0.08, 0, 3.8, -5);
    for (let i = 0; i < 5; i++) {
      this._put(g, G.low, 'boneDark', 0.3, 0.5, 0.3, -4 + i * 2, 3.3, -5);
    }
    this._lamppost(g, -4, 2, 4.0);
    return [{ x: g.position.x + 5, z: g.position.z + 3 }];
  }

  /** A farm: a barn, fences, and a field of something in rows. */
  _farm(g, spec, rnd, style) {
    this._house(g, 0, 0, 8, 6, 5.5, 0.2, style, 0.3);
    this._put(g, G.box, style.wall, 5, 3.2, 4, -10, 1.6, 4, 0.3);
    this._put(g, G.cone, style.roofMat, 4.4, 3, 3.6, -10, 4.4, 4, 0.3);
    this._solid(g, 2.5, 1.6, 2.0, -10, 1.6, 4, 'house');
    // The field, in rows, with a scarecrow in it.
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 14; c++) {
        this._put(g, G.box, 'leafPale', 0.5, 1.2, 0.5,
          12 + r * 2.6, 0.6, -16 + c * 2.6);
      }
    }
    this._put(g, G.cyl, 'woodDark', 0.14, 3.4, 0.14, 20, 1.7, 0);
    this._put(g, G.box, 'wood', 2.6, 0.16, 0.16, 20, 2.6, 0);
    this._put(g, G.low, 'thatch', 0.5, 0.6, 0.5, 20, 3.6, 0);
    // Fences round the lot.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rad = spec.r * 0.9;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const base = this.realm.heightAt(g.position.x + x, g.position.z + z)
        - g.position.y;
      this._put(g, G.cyl, 'woodDark', 0.11, 1.8, 0.11, x, base + 0.9, z);
      // Tangentially — see `_solidRun`. A rail laid with `a + π/2` points
      // across the fence line instead of along it, so the paddock came out
      // as twenty-six planks at angles to each other.
      this._put(g, G.box, 'wood', 3.4, 0.14, 0.12, x, base + 1.3, z,
        -a - Math.PI / 2);
    }
    this._fire(g, 6, 6, rnd);
    return [{ x: g.position.x + 16, z: g.position.z }, { x: g.position.x + 6, z: g.position.z + 6 }];
  }

  /** A shrine: a stepped platform under a gate, with an offering slab. */
  _shrine(g, spec, rnd, style) {
    const r = Math.max(9, spec.r);
    this._plinth(g, r * 1.05, r * 1.05);
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.22;
      this._put(g, G.box, i ? 'stone' : 'stoneDark',
        r * k, 0.45, r * k, 0, 0.22 + i * 0.45, 0);
      this._solid(g, r * k, 0.25, r * k, 0, 0.22 + i * 0.45, 0, 'deck');
    }
    const top = 1.6;
    for (const sx of [-1, 1]) {
      this._put(g, G.taper, 'tile', 0.34, 5.4, 0.34, sx * r * 0.5, top + 2.7, 0);
      this._solid(g, 0.4, 2.7, 0.4, sx * r * 0.5, top + 2.7, 0, 'post');
    }
    this._put(g, G.box, 'tile', r * 1.25, 0.34, 0.5, 0, top + 5.5, 0);
    this._put(g, G.box, 'tile', r * 1.0, 0.26, 0.4, 0, top + 4.7, 0);
    this._put(g, G.box, 'stoneDark', 1.5, 0.9, 1.0, 0, top + 0.45, 0);
    this._put(g, G.low, 'lamp', 0.3, 0.34, 0.3, 0, top + 1.1, 0);
    this._anchor(g, 0, top + 5.5, 0, 2.0);
    // Offering stones round the outside, lying on whatever the ground does.
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2, d = r * (1.1 + rnd() * 0.4);
      this._putOn(g, G.low, 'stone', 0.5 + rnd() * 0.5, 0.5 + rnd() * 0.5,
        0.5 + rnd() * 0.5, Math.cos(a) * d, Math.sin(a) * d);
    }
  }

  /** A temple: a colonnade, a roof, a dark doorway and something lit inside. */
  _temple(g, spec, rnd, style) {
    const r = Math.max(16, spec.r);
    // Level ground first, whatever the hill is doing. See `_plinth`.
    this._plinth(g, r * 1.1, r * 0.9);
    this._put(g, G.box, 'stoneDark', r * 1.1, 1.6, r * 0.9, 0, 0.8, 0);
    this._solid(g, r * 1.1, 0.9, r * 0.9, 0, 0.8, 0, 'deck');
    for (let i = 0; i < 4; i++) {
      const k = 1 - i * 0.06;
      this._put(g, G.box, style.wall, r * k, 0.7, r * 0.82 * k, 0, 1.6 + i * 0.7, 0);
    }
    const base = 4.4;
    // Columns down both sides.
    for (let i = -3; i <= 3; i++) {
      for (const sz of [-1, 1]) {
        this._put(g, G.cyl, style.wall, 1.2, 12, 1.2, i * (r * 0.24),
          base + 6, sz * r * 0.34);
        this._solid(g, 1.2, 6, 1.2, i * (r * 0.24), base + 6, sz * r * 0.34, 'pillar');
      }
    }
    /**
     * The roof, and it holds weight now.
     *
     * The columns reach base+12 and the slab sits at base+13, so anybody who
     * grappled a temple went through the roof and out the other side. It is
     * a stone slab on stone columns.
     */
    this._put(g, G.box, style.roofMat, r * 1.02, 1.6, r * 0.86, 0, base + 13, 0);
    this._solid(g, r * 1.0, 0.8, r * 0.84, 0, base + 13, 0, 'deck');
    this._put(g, G.cone, style.roofMat, r * 0.8, 6, r * 0.7, 0, base + 16, 0, 0.785);
    // The cella, and the light in it.
    this._put(g, G.box, style.wall, r * 0.5, 10, r * 0.44, 0, base + 5, 0);
    this._put(g, G.box, 'obsidian', r * 0.18, 6, 0.6, 0, base + 3, r * 0.23);
    this._put(g, G.low, 'lamp', 1.1, 1.3, 1.1, 0, base + 4, r * 0.1);
    this._solid(g, r * 0.26, 5, r * 0.24, 0, base + 5, 0, 'wall');
    for (let i = 0; i < 8; i++) {
      const a = i * 0.9;
      const x = Math.cos(a) * r * 0.9, z = Math.sin(a) * r * 0.9 - r * 0.7;
      this._putOn(g, G.box, 'stoneDark', 3.0, 0.5, 1.4, x, z);
    }
  }

  /**
   * A ruin: a broken hall, its arch still standing, and the rest fallen in.
   *
   * Built on a plinth like everything else, because the thing that made ruins
   * read as "some pillars randomly placed" was every wall being buried to a
   * different depth by the hillside they were dropped on.
   *
   * The rubble is the exception — it is meant to be lying on the ground, so
   * it goes through `_putOn` and follows the slope out of the footprint.
   */
  _ruin(g, spec, rnd, style) {
    const r = Math.max(14, spec.r);
    this._plinth(g, r * 0.62, r * 0.5);
    /**
     * A floor, but only where the building was.
     *
     * Kept to the span between the standing piers rather than the whole
     * footprint: a ruin whose floor is a forty-metre slab reads as a car park
     * with some rocks on it. What is left of a floor is the bit that had
     * walls round it.
     */
    this._put(g, G.box, 'stonePale', r * 0.46, 0.5, r * 0.24, 0, 0.25, 0);
    this._solid(g, r * 0.46, 0.25, r * 0.24, 0, 0.25, 0, 'deck');

    // The arch that is still up: two piers and a lintel across them.
    for (const sx of [-1, 1]) {
      this._put(g, G.box, 'stone', 1.5, 7.0, 1.5, sx * r * 0.42, 4.0, 0);
      this._solid(g, 1.5, 3.5, 1.5, sx * r * 0.42, 4.0, 0, 'pillar');
    }
    this._put(g, G.box, 'stone', r * 0.5 + 1.5, 1.1, 1.6, 0, 8.0, 0);
    this._put(g, G.box, 'stoneDark', r * 0.36, 0.8, 1.2, 0, 9.1, 0);
    this._anchor(g, 0, 8.6, 0, 2.0);

    /**
     * The walls, falling away from the arch in both directions.
     *
     * They step DOWN as they go out and they touch: a wall built out of
     * blocks with gaps between them is a row of stumps, which is the other
     * half of why these read as scattered stone. Each block is as wide as the
     * gap between it and the next.
     */
    for (const side of [-1, 1]) {
      for (let k = 1; k <= 4; k++) {
        const h = Math.max(1.2, 6.0 - k * (0.9 + rnd() * 0.6));
        const x = side * (r * 0.42 + k * 3.0);
        this._put(g, G.box, 'stone', 1.6, h, 1.4, x, 0.5 + h * 0.5, 0);
        this._solid(g, 1.6, h * 0.5, 1.4, x, 0.5 + h * 0.5, 0, 'wall');
      }
      // A cross wall, so it reads as a building rather than a fence.
      for (let k = 0; k < 3; k++) {
        const h = Math.max(1.0, 4.2 - k * 1.2);
        const x = side * (r * 0.42);
        const z = -(k + 1) * 3.0;
        this._put(g, G.box, 'stone', 1.4, h, 1.6, x, 0.5 + h * 0.5, z);
        this._solid(g, 1.4, h * 0.5, 1.6, x, 0.5 + h * 0.5, z, 'wall');
      }
    }

    // A statue that lost its head, and the head, on the floor beside it.
    // A five-unit column of stone: solid, obviously.
    this._put(g, G.box, 'stoneDark', 1.6, 5.0, 1.6, r * 0.2, 3.0, -r * 0.3);
    this._solid(g, 1.6, 2.5, 1.6, r * 0.2, 3.0, -r * 0.3, 'stone');
    this._put(g, G.low, 'stone', 1.1, 1.2, 1.1, r * 0.2 + 2.6, 1.6, -r * 0.3 + 2);

    // Fallen stone, lying wherever the ground is.
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.3 + rnd() * 0.8);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      this._putOn(g, G.low, 'stoneDark', 0.6 + rnd() * 0.9, 0.6 + rnd() * 0.7,
        0.6 + rnd() * 0.9, x, z);
    }
    // Vines down the standing piers.
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      this._put(g, G.box, 'leaf', 0.4, 3 + rnd() * 3, 0.4,
        side * (r * 0.42 + 0.9), 3.5, (rnd() - 0.5) * 2.4);
    }
  }

  /** A tower: round, tall, with a stair up the outside and a light on top. */
  /**
   * A tower: round, tall, with a stair up the outside and a light on top.
   *
   * ── the two things that were wrong with it ────────────────────────────────
   * The base sat at a fixed height, so on any slope the tower stood on a
   * pillar of air down one side. And the spiral stair was built out of BOXES
   * rotated flat about Y — a helix of horizontal slabs whose corners stick
   * out through the wall at every angle, which is what reads as a tilted
   * mess bolted to the side of a cylinder.
   *
   * Both are fixed the same way: a proper skirt of masonry filling to the
   * lowest ground under it, and the stair rebuilt as treads that hug the
   * wall — narrow, tangential and pitched, so it reads as a stair going up.
   */
  _tower(g, spec, rnd, style) {
    const h = 34 + rnd() * 12;
    // A skirt down to the ground on every side, so it never floats.
    const { lo } = this._relief(g, 7, 7);
    const foot = Math.min(0, lo) - 0.8;
    this._put(g, G.disc, 'stoneDark', 7.0, -foot + 1.2, 7.0, 0, (foot + 1.2) * 0.5, 0);
    this._put(g, G.disc, 'stone', 6.4, 0.7, 6.4, 0, 1.1, 0);
    this._solid(g, 6.4, (1.4 - foot) * 0.5, 6.4, 0, (foot + 1.4) * 0.5, 0, 'deck');

    this._put(g, G.cyl, style.wall, 4.6, h, 4.6, 0, h * 0.5 + 1, 0);
    this._solid(g, 4.6, h * 0.5, 4.6, 0, h * 0.5 + 1, 0, 'tower');
    /**
     * String courses up the shaft.
     *
     * Three of them, because without any the tower is thirty-five units of
     * unbroken tube and reads as a pipe. They cost three meshes and they are
     * what makes it look built rather than extruded.
     */
    for (let i = 1; i <= 3; i++) {
      this._put(g, G.disc, 'stoneDark', 4.9, 0.6, 4.9, 0, 1 + h * (i / 4), 0);
    }
    this._put(g, G.disc, 'stone', 5.8, 1.4, 5.8, 0, h + 1, 0);
    /**
     * The parapet, and it is a parapet.
     *
     * The whole point of climbing a thirty-five-unit tower is standing on
     * top of it, and the blocks round the edge were decoration — so the
     * reward for the climb was walking through them and falling off. The
     * GAPS between them are still gaps, which is what crenellations are.
     */
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this._put(g, G.box, 'stoneDark', 1.2, 1.8, 1.0,
        Math.cos(a) * 5.4, h + 2.6, Math.sin(a) * 5.4, a);
      this._solid(g, 1.1, 0.9, 1.1,
        Math.cos(a) * 5.4, h + 2.6, Math.sin(a) * 5.4, 'wall');
    }
    this._put(g, G.cone, style.roofMat, 6.0, 6.0, 6.0, 0, h + 6.4, 0);
    this._put(g, G.low, 'lamp', 1.0, 1.2, 1.0, 0, h + 3.4, 0);
    this._anchor(g, 0, h + 3, 0, 2.4);

    /**
     * The stair: treads hugging the wall, each turned to face along the climb.
     *
     * Half as long as they were and rotated tangentially rather than being
     * left as flat squares — so what you see is a ribbon winding up the tower
     * instead of a stack of slabs poking out of it at every angle.
     */
    const steps = Math.floor(h / 1.5);
    for (let i = 0; i < steps; i++) {
      const a = i * 0.40;
      const rad = 5.3;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      this._put(g, G.box, 'stone', 1.1, 0.42, 2.4, x, 1.9 + i * 1.5, z,
        -a + Math.PI / 2);
      this._solid(g, 0.9, 0.25, 1.2, x, 1.9 + i * 1.5, z, 'deck');
      // A baluster on the outside of every third tread.
      if (i % 3 === 0) {
        this._put(g, G.cyl, 'stoneDark', 0.16, 1.5, 0.16,
          Math.cos(a) * (rad + 0.9), 2.8 + i * 1.5, Math.sin(a) * (rad + 0.9));
      }
    }
    // Windows going up, so it is lit from inside.
    for (let i = 1; i < 5; i++) {
      const a = i * 1.7;
      this._put(g, G.box, 'lamp', 0.9, 1.4, 0.4,
        Math.cos(a) * 4.7, 1 + i * (h / 5), Math.sin(a) * 4.7, a);
    }
  }

  /** A keep: a walled block with corner towers and a gate you can walk in. */
  _keep(g, spec, rnd, style) {
    const spots = [];
    const r = Math.max(26, spec.r);
    this._put(g, G.box, style.wall, r * 0.62, 16, r * 0.52, 0, 8, 0);
    this._solid(g, r * 0.62, 8, r * 0.52, 0, 8, 0, 'wall');
    this._put(g, G.box, style.roofMat, r * 0.68, 1.4, r * 0.58, 0, 16.7, 0);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._put(g, G.cyl, style.wall, 4.4, 26, 4.4, sx * r * 0.6, 13, sz * r * 0.5);
        this._put(g, G.cone, style.roofMat, 5.6, 8, 5.6, sx * r * 0.6, 30, sz * r * 0.5);
        this._solid(g, 4.4, 13, 4.4, sx * r * 0.6, 13, sz * r * 0.5, 'tower');
        this._anchor(g, sx * r * 0.6, 27, sz * r * 0.5, 2.4);
      }
    }
    // The curtain, with a gap for the gate.
    const seg = 16;
    for (let i = 0; i < seg; i++) {
      if (i === Math.floor(seg * 0.75)) continue;
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * r * 0.92, z = Math.sin(a) * r * 0.92;
      const base = this.realm.heightAt(g.position.x + x, g.position.z + z)
        - g.position.y;
      /**
       * TANGENTIALLY, which is not what this said.
       *
       * A box rotated about Y by θ has its local +X along (cos θ, −sin θ).
       * The tangent to a circle at angle `a` is (−sin a, cos a). Solving
       * those gives θ = −a − π/2; the code said `a + π/2`, which satisfies
       * the x component and gets the z component backwards — so every
       * segment except the four on the axes was rotated the wrong way and
       * the "curtain wall" was a ring of blocks at angles to each other.
       */
      const dx = -Math.sin(a), dz = Math.cos(a);
      this._put(g, G.box, 'stone', r * 0.2, 8, 2.0, x, base + 4, z,
        -a - Math.PI / 2);
      this._solidRun(g, x, base + 4, z, dx, dz, r * 0.2, 1.3, 4, 'wall');
    }
    this._fire(g, 0, r * 0.3, rnd);
    spots.push({ x: g.position.x, z: g.position.z + r * 0.36 });
    spots.push({ x: g.position.x - r * 0.3, z: g.position.z });
    return spots;
  }

  /** A gatehouse: an arch across a road, with a guard walk over the top. */
  _gatehouse(g, spec, rnd, style) {
    const r = Math.max(18, spec.r);
    // A gatehouse straddles a road, and a road is graded flat — but the
    // ground beside it is not, so the piers get a foundation of their own.
    this._plinth(g, r * 0.5 + 6, 10);
    for (const sx of [-1, 1]) {
      this._put(g, G.box, style.wall, 5, 18, 8, sx * (r * 0.36 + 3), 9, 0);
      this._solid(g, 5, 9, 8, sx * (r * 0.36 + 3), 9, 0, 'wall');
      this._put(g, G.cyl, style.wall, 4.2, 24, 4.2, sx * (r * 0.36 + 3), 12, -7);
      this._put(g, G.cone, style.roofMat, 5.2, 7, 5.2, sx * (r * 0.36 + 3), 27.5, -7);
      this._solid(g, 4.2, 12, 4.2, sx * (r * 0.36 + 3), 12, -7, 'tower');
    }
    // The arch and the walk over it.
    this._put(g, G.box, style.wall, r * 0.8, 4, 9, 0, 20, 0);
    this._put(g, G.box, 'stoneDark', r * 0.76, 1.0, 10, 0, 22.5, 0);
    this._solid(g, r * 0.4, 0.6, 5, 0, 22.5, 0, 'deck');
    for (let i = -4; i <= 4; i++) {
      this._put(g, G.box, 'stoneDark', 1.4, 2.2, 1.0, i * (r * 0.09), 24, 4.6);
    }
    this._put(g, G.box, 'woodDark', r * 0.3, 12, 0.8, 0, 12, 3.4);
    this._put(g, G.low, 'lamp', 0.7, 0.8, 0.7, 0, 21, 5);
    this._anchor(g, 0, 22, 0, 2.4);
  }

  /**
   * A bridge over whatever is here.
   *
   * The deck is graded flat by the road network where a road runs over it, so
   * this is the parapet, the piers and the lamps: the bit that makes a ford
   * look like a crossing.
   */
  _bridge(g, spec, rnd, style) {
    const len = Math.max(30, spec.r * 1.6);
    this._put(g, G.box, 'stone', 9, 1.0, len, 0, 0.4, 0);
    this._solid(g, 4.5, 0.5, len * 0.5, 0, 0.4, 0, 'deck');
    for (const sx of [-1, 1]) {
      this._put(g, G.box, 'stonePale', 0.8, 1.8, len, sx * 4.2, 1.6, 0);
      /**
       * THE PARAPET IS SOLID.
       *
       * A knee-high stone wall down both sides of every bridge in the realm,
       * and it had no collider — so the parapet was decoration and the
       * bridge was a plank you fell off sideways. It is a wall. It is made
       * of stone. It holds you on the bridge.
       */
      this._solid(g, 0.5, 0.9, len * 0.5, sx * 4.2, 1.6, 0, 'wall');
      for (let i = -2; i <= 2; i++) {
        this._put(g, G.cyl, 'stoneDark', 0.7, 4.4, 0.7, sx * 4.2, 1.4, i * (len * 0.22));
        this._solid(g, 0.6, 2.2, 0.6, sx * 4.2, 1.4, i * (len * 0.22), 'stone');
        this._put(g, G.low, 'lamp', 0.4, 0.45, 0.4, sx * 4.2, 3.9, i * (len * 0.22));
        this._anchor(g, sx * 4.2, 3.9, i * (len * 0.22), 1.6);
      }
    }
    /**
     * Piers going down to whatever is underneath — however far that is.
     *
     * They used to be a fixed twenty-two units long, so over anything deeper
     * than that the bridge stood on three stubs hanging in the air, and over
     * anything shallower they buried themselves. Each one now reaches the
     * actual ground under its own foot.
     */
    for (let i = -1; i <= 1; i++) {
      const z = i * (len * 0.33);
      const foot = Math.min(-2, this._gy(g, 0, z)) - 1;
      this._put(g, G.box, 'stoneDark', 4, -foot, 5, 0, foot * 0.5, z);
      // A splayed base, so it reads as taking the weight.
      this._put(g, G.box, 'stone', 5.4, 1.4, 6.4, 0, foot + 0.7, z);
    }
  }

  /** A cave: a mouth in a rock face, and dark inside it. */
  _cave(g, spec, rnd, style) {
    const r = Math.max(12, spec.r);
    // The outcrop the mouth is in.
    /**
     * The outcrop, and EVERY BOULDER IN IT IS SOLID.
     *
     * Seven masses of eight to thirteen units each, and one collider used
     * to cover the middle one. The other six were a cliff face you walked
     * through — which is exactly the kind of thing the no-clip complaint is
     * about, because nothing in the game looks more solid than a rock.
     *
     * Inset a little from the visual, the same as the boulders in
     * js/world.js and js/scatter.js: clipping the edge of a rock is much
     * less annoying than snagging on air beside one.
     */
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI - 0.4;
      const sx = 8 + rnd() * 5, sy = 7 + rnd() * 7, sz = 8 + rnd() * 5;
      const bx = Math.cos(a) * r * 0.9, bz = Math.sin(a) * r * 0.9 - r * 0.5;
      this._putOn(g, G.low, 'stoneDark', sx, sy, sz, bx, bz);
      const by = this._gy(g, bx, bz);
      this._solid(g, sx * 0.78, sy * 0.62, sz * 0.78,
        bx, by + sy * 0.4, bz, 'rock');
    }
    this._putOn(g, G.low, 'stoneDark', r * 0.9, 12, r * 0.7, 0, -r * 0.55);
    this._solid(g, r * 0.8, 6, r * 0.5, 0, 5, -r * 0.7, 'rock');
    // The mouth itself, and the black behind it.
    this._put(g, G.cyl, 'obsidian', 4.4, 8, 4.4, 0, 3.4, -r * 0.2, 0);
    this._put(g, G.low, 'obsidian', 5.0, 5.0, 3.0, 0, 3.6, -r * 0.32);
    for (let i = 0; i < 6; i++) {
      const t = (i / 5) * 2 - 1;
      this._put(g, G.cone, 'stonePale', 0.9, 3 + rnd() * 2, 0.9,
        t * 3.4, 7.4, -r * 0.2, 0);
    }
    for (let i = 0; i < 4; i++) {
      const t = (i / 3) * 2 - 1;
      this._put(g, G.cone, 'stonePale', 0.8, 2.4, 0.8, t * 2.8, 1.2, -r * 0.2);
    }
    this._put(g, G.low, 'glow', 0.6, 0.7, 0.6, 0, 2.4, -r * 0.36);
    this._lamppost(g, 5, 2, 4.4);
  }

  /** A mine: a timbered adit, spoil heaps, a winch and a track. */
  _mine(g, spec, rnd, style) {
    const r = Math.max(14, spec.r);
    this._putOn(g, G.low, 'stoneDark', r * 0.8, 14, r * 0.6, 0, -r * 0.5);
    this._solid(g, r * 0.7, 7, r * 0.45, 0, 6, -r * 0.62, 'rock');
    // The adit: two posts and a lintel, and black behind.
    for (const sx of [-1, 1]) {
      this._put(g, G.box, 'wood', 0.7, 6, 0.7, sx * 2.6, 3, -r * 0.16);
    }
    this._put(g, G.box, 'wood', 6.6, 0.8, 1.0, 0, 6.2, -r * 0.16);
    this._put(g, G.box, 'obsidian', 4.6, 5.4, 1.0, 0, 2.7, -r * 0.2);
    // The winch, the spoil, and a rail out of the hole.
    this._put(g, G.cyl, 'woodDark', 0.5, 5, 0.5, -6, 2.5, 2);
    this._put(g, G.cyl, 'woodDark', 0.5, 5, 0.5, -3, 2.5, 2);
    this._put(g, G.cyl, 'wood', 0.9, 3.4, 0.9, -4.5, 4.4, 2, Math.PI / 2)
      .rotation.z = Math.PI / 2;
    this._anchor(g, -4.5, 4.4, 2, 1.8);
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2, d = 8 + rnd() * 8;
      this._putOn(g, G.low, 'stone', 2 + rnd() * 2, 1.4, 2 + rnd() * 2,
        Math.cos(a) * d, Math.sin(a) * d);
    }
    for (let i = 0; i < 12; i++) {
      this._put(g, G.box, 'ironDark', 2.4, 0.12, 0.2, 0, 0.4, -r * 0.1 + i * 2.4);
    }
    this._put(g, G.box, 'plank', 2.0, 1.4, 2.6, 0, 1.2, 10);
    this._solid(g, 1.0, 0.7, 1.3, 0, 1.2, 10, 'cart');
    this._lamppost(g, 5, -2, 4.6);
  }

  /**
   * A dungeon entrance: a stair going down into the ground, and a door at the
   * bottom of it that does not open.
   *
   * The stair treads are `deck`, so you can walk down and stand in front of
   * the door — which is where the loot and the lore are.
   */
  /**
   * A DUNGEON ENTRANCE — a building over a stair going down.
   *
   * This one was the worst in the world and the player named it: the Drowned
   * Library, "just some stone pillars randomly placed". It was a ring of
   * fourteen short wall stubs at a fixed height, on ground with eleven units
   * of fall across it — so eleven of them were buried, three stuck out, and
   * the stair went down into a hillside that was already above it.
   *
   * Rebuilt as an actual structure: a level plinth, a rectangular hall with
   * FOUR corners and walls that meet at them, a colonnade down the inside, a
   * roof that is missing most of its slabs, and the stair sunk through the
   * floor at the back with a door at the bottom. It is a building that has
   * lost its roof, which is what a ruined library is, rather than a scatter
   * of blocks in a circle.
   */
  _dungeon(g, spec, rnd, style) {
    const r = Math.max(16, spec.r);
    const hw = r * 0.62, hd = r * 0.5;
    this._plinth(g, hw + 1.5, hd + 1.5);

    // ---- the floor ----
    this._put(g, G.box, 'stone', hw, 0.7, hd, 0, 0.35, 0);
    this._solid(g, hw, 0.35, hd, 0, 0.35, 0, 'deck');
    this._put(g, G.box, 'stoneDark', hw + 1.3, 0.5, hd + 1.3, 0, 0.15, 0);

    /**
     * The walls: four runs that MEET.
     *
     * Built as continuous slabs along each side rather than as blocks spaced
     * round a circle, with a gap left in the front wall for the doorway. A
     * wall you can see through the middle of is a fence.
     */
    const H = 9;
    const wall = (x, z, sx, sz) => {
      this._put(g, G.box, style.wall, sx, H, sz, x, 0.7 + H * 0.5, z);
      this._solid(g, sx, H * 0.5, sz, x, 0.7 + H * 0.5, z, 'wall');
    };
    wall(0, -hd, hw, 1.4);                       // back
    wall(-hw, 0, 1.4, hd);                       // left
    wall(hw, 0, 1.4, hd);                        // right
    const doorHalf = 3.2;
    for (const sx of [-1, 1]) {
      const run = (hw - doorHalf) * 0.5;
      wall(sx * (doorHalf + run), hd, run, 1.4);  // front, either side of the door
    }
    // The doorway's own frame, and the lintel over it.
    for (const sx of [-1, 1]) {
      this._put(g, G.box, 'stoneDark', 0.8, H, 2.0, sx * doorHalf, 0.7 + H * 0.5, hd);
    }
    this._put(g, G.box, 'stoneDark', doorHalf + 0.8, 1.2, 2.2, 0, 0.7 + H - 0.6, hd);

    // Corner piers, so the runs read as joined rather than as four fences.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this._put(g, G.box, 'stoneDark', 2.0, H + 1.4, 2.0,
          sx * hw, 0.7 + (H + 1.4) * 0.5, sz * hd);
        this._solid(g, 2.0, (H + 1.4) * 0.5, 2.0, sx * hw, 0.7 + (H + 1.4) * 0.5,
          sz * hd, 'pillar');
      }
    }

    /**
     * A colonnade down both long sides, and what is left of the roof.
     *
     * Two thirds of the slabs are gone, chosen off the site's own seed so the
     * same library is the same ruin every time. The ones that remain are what
     * make the columns read as having held something up.
     */
    const cols = 4;
    for (let i = 0; i < cols; i++) {
      const z = -hd * 0.62 + (i / (cols - 1)) * hd * 1.24;
      for (const sx of [-1, 1]) {
        const x = sx * hw * 0.55;
        this._put(g, G.cyl, style.wall, 1.1, H - 1.4, 1.1, x, 0.7 + (H - 1.4) * 0.5, z);
        this._put(g, G.disc, 'stoneDark', 1.5, 0.5, 1.5, x, 0.7 + H - 1.6, z);
        this._solid(g, 1.1, (H - 1.4) * 0.5, 1.1, x, 0.7 + (H - 1.4) * 0.5, z, 'pillar');
        if (rnd() < 0.4) {
          this._put(g, G.box, style.roofMat, hw * 0.62, 0.7, hd * 0.3,
            sx * hw * 0.5, 0.7 + H + 0.4, z);
        }
      }
    }

    /**
     * The stair down, sunk through the floor at the back.
     *
     * It reaches the door at the bottom and every tread is `deck`, so you can
     * walk down and stand in front of it — which is where the chests and the
     * carvings are.
     */
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const z = -hd * 0.1 - i * 1.9;
      this._put(g, G.box, 'stone', 4.4, 0.6, 2.0, 0, -i * 1.1, z);
      this._solid(g, 2.2, 0.35, 1.0, 0, -i * 1.1, z, 'deck');
      // Cheek walls, so the stair is a cut and not a floating ladder.
      for (const sx of [-1, 1]) {
        this._put(g, G.box, 'stoneDark', 0.7, 2.4 + i * 1.1, 2.0,
          sx * 4.8, 0.5 - i * 1.1 * 0.5, z);
      }
    }
    const floorY = -steps * 1.1;
    const backZ = -hd * 0.1 - steps * 1.9;
    this._put(g, G.box, 'stoneDark', 5.6, 0.8, 5.0, 0, floorY - 0.4, backZ - 2.2);
    this._solid(g, 5.6, 0.5, 5.0, 0, floorY - 0.4, backZ - 2.2, 'deck');
    // The door at the bottom, and it does not open.
    this._put(g, G.box, style.wall, 5.6, 11, 1.4, 0, floorY + 5.4, backZ - 4.6);
    this._put(g, G.box, 'obsidian', 3.4, 7.6, 0.7, 0, floorY + 4.2, backZ - 4.9);
    this._put(g, G.torus, 'gold', 0.9, 0.9, 0.9, 0, floorY + 4.2, backZ - 5.2);
    this._solid(g, 3.0, 4.0, 1.0, 0, floorY + 5.4, backZ - 4.6, 'door');
    for (const sx of [-1, 1]) {
      this._put(g, G.cyl, 'stoneDark', 0.6, 4.4, 0.6, sx * 3.4, floorY + 2.2, backZ - 3.2);
      this._put(g, G.low, 'ember', 0.45, 0.55, 0.45, sx * 3.4, floorY + 4.8, backZ - 3.2);
    }

    // Fallen roof slabs on the floor of the hall, and outside it.
    for (let i = 0; i < 9; i++) {
      const x = (rnd() - 0.5) * hw * 1.4, z = (rnd() - 0.5) * hd * 1.4;
      if (Math.abs(x) < 5 && z < 0) continue;         // not down the stairwell
      const m = this._put(g, G.box, style.roofMat, 2.2 + rnd() * 1.6, 0.5,
        1.6 + rnd() * 1.2, x, 0.9, z, rnd() * 3);
      m.rotation.z = (rnd() - 0.5) * 0.3;
    }
  }

  /** An arena you can walk into: tiered seating round a sand floor. */
  _siteArena(g, spec, rnd, style) {
    const r = Math.max(24, spec.r);
    // A bowl of seating cut into a hillside still needs a level floor.
    this._plinth(g, r * 0.9, r * 0.9);
    this._put(g, G.disc, 'sand', r * 0.6, 0.8, r * 0.6, 0, 0.4, 0);
    this._solid(g, r * 0.6, 0.4, r * 0.6, 0, 0.4, 0, 'deck');
    for (let t = 0; t < 5; t++) {
      const rad = r * (0.64 + t * 0.07);
      const seg = 26 + t * 4;
      for (let i = 0; i < seg; i++) {
        if (t < 2 && i % 9 === 0) continue;              // the two entrances
        const a = (i / seg) * Math.PI * 2;
        // Tangentially, so the tier reads as a continuous bench rather than
        // as a ring of blocks — the same yaw fix as every other curved run
        // in this file. See `_solidRun`.
        this._put(g, G.box, t % 2 ? 'stone' : 'stonePale', rad * 0.14, 2.2,
          r * 0.09, Math.cos(a) * rad, 0.8 + t * 1.8, Math.sin(a) * rad,
          -a - Math.PI / 2);
      }
      this._solid(g, rad * 1.02, 0.4, rad * 1.02, 0, 0.8 + t * 1.8, 0, 'deck');
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this._put(g, G.cyl, 'woodDark', 0.4, 12, 0.4, Math.cos(a) * r,
        6, Math.sin(a) * r);
      this._put(g, G.box, 'cloth', 4, 6, 0.3, Math.cos(a) * r, 9,
        Math.sin(a) * r, a);
      this._anchor(g, Math.cos(a) * r, 11, Math.sin(a) * r, 2.0);
    }
  }

  /**
   * The strange ones.
   *
   * Each easter egg is built from its own id rather than from a generic
   * shape, because the point of them is that they are specific: a bell in the
   * water, an oak with a room in it, a boat in a wheat field, a cottage
   * standing on its roof.
   */
  _oddity(g, spec, rnd, style) {
    switch (spec.id) {
      case 'drowned-bell':
        for (const sx of [-1, 1]) {
          this._put(g, G.cyl, 'woodDark', 0.18, 6.0, 0.18, sx * 2.2, 3.0, 0);
        }
        this._put(g, G.box, 'wood', 2.8, 0.2, 0.3, 0, 6.0, 0);
        this._put(g, G.taper, 'gold', 1.5, 2.6, 1.5, 0, 4.0, 0);
        this._put(g, G.low, 'gold', 0.4, 0.5, 0.4, 0, 2.6, 0);
        this._solid(g, 1.6, 1.4, 1.6, 0, 4.0, 0, 'bell');
        this._anchor(g, 0, 6.0, 0, 1.8);
        break;

      case 'mushroom-ring':
        for (let i = 0; i < 13; i++) {
          const a = (i / 13) * Math.PI * 2;
          const h = 2.4 + rnd() * 3.4;
          this._put(g, G.cyl, 'pale', 0.5, h, 0.5,
            Math.cos(a) * 9, h * 0.5, Math.sin(a) * 9);
          this._put(g, G.low, i % 2 ? 'green' : 'cloth', 2.2, 1.2, 2.2,
            Math.cos(a) * 9, h, Math.sin(a) * 9);
        }
        this._put(g, G.disc, 'leaf', 8, 0.2, 8, 0, 0.1, 0);
        break;

      case 'stoneboat': {
        // A fishing boat, in a wheat field, made of granite.
        this._put(g, G.low, 'stone', 3.0, 1.6, 8.0, 0, 1.4, 0);
        this._put(g, G.box, 'stone', 5.2, 0.5, 13, 0, 2.4, 0);
        this._put(g, G.cyl, 'stoneDark', 0.4, 12, 0.4, 0, 8, 1);
        this._put(g, G.box, 'stonePale', 0.3, 8, 5, 0, 8, -1.6);
        this._solid(g, 2.6, 1.6, 6.5, 0, 1.4, 0, 'boat');
        // The mast and the sail are granite too. That is the joke.
        this._solid(g, 0.5, 6, 0.5, 0, 8, 1, 'stone');
        this._solid(g, 0.4, 4, 4.6, 0, 8, -1.6, 'stone');
        break;
      }

      case 'upside-house': {
        // Complete, undamaged, and standing on its roof.
        const h = new THREE.Group();
        h.rotation.z = Math.PI;
        h.position.y = 8.6;
        g.add(h);
        this._put(h, G.box, style.wall, 4.4, 4.0, 4.0, 0, 2, 0);
        this._put(h, G.cone, style.roofMat, 4.2, 4.4, 4.2, 0, 6, 0);
        this._put(h, G.box, 'woodDark', 1.3, 2.4, 0.2, 0, 1.2, 2.1);
        this._put(h, G.box, 'lamp', 1.0, 1.0, 0.16, 0, 2.6, -2.1);
        this._solid(g, 2.2, 4.3, 2.0, 0, 4.3, 0, 'house');
        break;
      }

      case 'buried-gate':
        for (const sx of [-1, 1]) {
          this._put(g, G.box, 'sand', 2.0, 9, 2.0, sx * 4.4, 4.5, 0);
          this._solid(g, 2.0, 4.5, 2.0, sx * 4.4, 4.5, 0, 'pillar');
        }
        this._put(g, G.box, 'sandDark', 11, 2.0, 2.6, 0, 10, 0);
        // The lintel. Eleven units of dressed stone across the top of the
        // gate, and it should stop a jump rather than swallow it.
        this._solid(g, 11, 1.0, 2.6, 0, 10, 0, 'wall');
        this._put(g, G.box, 'gold', 8, 0.5, 0.4, 0, 8.6, 1.4);
        this._anchor(g, 0, 10, 0, 2.0);
        for (let i = 0; i < 9; i++) {
          const a = rnd() * Math.PI * 2, d = 8 + rnd() * 10;
          this._put(g, G.low, 'sandDark', 1.4, 0.7, 1.4,
            Math.cos(a) * d, 0.3, Math.sin(a) * d);
        }
        break;

      case 'floatstones':
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const d = 6 + (i % 3) * 5;
          this._put(g, G.low, 'stone', 2.4 + rnd() * 2, 1.8 + rnd() * 1.6,
            2.4 + rnd() * 2, Math.cos(a) * d, 5 + i * 2.6, Math.sin(a) * d);
        }
        this._put(g, G.disc, 'stoneDark', 5, 0.6, 5, 0, 0.3, 0);
        this._solid(g, 5, 0.3, 5, 0, 0.3, 0, 'deck');
        break;

      case 'frozen-fall':
        // A waterfall, frozen mid-fall, with fish in it.
        this._put(g, G.box, 'stoneDark', 16, 30, 8, 0, 15, -8);
        this._solid(g, 16, 15, 8, 0, 15, -8, 'cliff');
        this._put(g, G.box, 'ice', 9, 30, 3, 0, 15, -2.6);
        // Nine by thirty units of solid ice. It is the thing the oddity IS.
        this._solid(g, 9, 15, 3, 0, 15, -2.6, 'ice');
        for (let i = 0; i < 5; i++) {
          this._put(g, G.cone, 'iceDeep', 1.2, 5 + rnd() * 4, 1.2,
            -3.4 + i * 1.7, 4, -1.6, 0);
        }
        for (let i = 0; i < 6; i++) {
          this._put(g, G.low, 'clothBlue', 0.7, 0.35, 0.25,
            -3 + rnd() * 6, 6 + rnd() * 16, -2.2);
        }
        this._put(g, G.disc, 'ice', 9, 0.4, 9, 0, 0.2, 3);
        break;

      case 'oathbreaker': {
        /**
         * A sword the length of a bridge, point-first into the ground.
         *
         * Leaning, so the silhouette is a diagonal against the sky — a
         * vertical one at this scale reads as a tower. Solid at the base
         * only, so you can walk right up to it and under the guard.
         */
        const s = new THREE.Group();
        s.rotation.z = 0.22;
        s.rotation.y = 0.5;
        g.add(s);
        this._put(s, G.box, 'iron', 3.4, 74, 0.9, 0, 30, 0);
        this._put(s, G.box, 'stonePale', 0.7, 66, 1.1, 0, 34, 0);
        this._put(s, G.cone, 'iron', 3.4, 12, 0.9, 0, -8, 0, 0).rotation.x = Math.PI;
        this._put(s, G.box, 'gold', 12, 2.4, 3.0, 0, 66, 0);
        this._put(s, G.cyl, 'woodDark', 1.3, 14, 1.3, 0, 74, 0);
        this._put(s, G.low, 'gold', 1.8, 2.0, 1.8, 0, 82, 0);
        this._solid(g, 3.0, 8, 3.0, 0, 8, 0, 'sword');
        // Where it went in: shattered rib and thrown-up ground.
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          this._put(g, G.low, 'bone', 1.6 + rnd() * 1.6, 1.0, 1.6 + rnd() * 1.6,
            Math.cos(a) * (8 + rnd() * 7), 0.5, Math.sin(a) * (8 + rnd() * 7));
        }
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.4;
          const m = this._put(g, G.box, 'boneDark', 1.6, 16, 1.2,
            Math.cos(a) * 13, 6, Math.sin(a) * 13, a);
          m.rotation.z = Math.cos(a) * 0.6;
          m.rotation.x = -Math.sin(a) * 0.6;
        }
        this._anchor(g, 0, 60, 0, 3.0);
        break;
      }

      case 'the-note':
        this._put(g, G.box, 'stone', 1.1, 0.5, 1.1, 0, 0.25, 0);
        this._put(g, G.box, 'pale', 0.5, 0.04, 0.7, 0, 0.55, 0);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const h = 1.6 + rnd();
          this._put(g, G.box, 'stoneDark', 0.5, h, 0.5,
            Math.cos(a) * 4, 0.8, Math.sin(a) * 4, a);
          // Standing stones. Small, but stone, and there are six of them in
          // a ring — walking through the ring rather defeats the object.
          this._solid(g, 0.5, h * 0.5, 0.5,
            Math.cos(a) * 4, 0.8, Math.sin(a) * 4, 'stone');
        }
        break;

      case 'white-door':
        // The little one, standing in front of the enormous one. Same joke,
        // told twice, and the small one is the one you can actually open.
        this._put(g, G.box, 'pale', 1.4, 3.2, 0.14, 0, 1.6, 0);
        this._put(g, G.box, 'marbleDark', 1.6, 0.16, 0.22, 0, 3.3, 0);
        this._put(g, G.low, 'gold', 0.12, 0.12, 0.12, 0.5, 1.7, 0.16);
        this._solid(g, 1.4, 1.6, 0.3, 0, 1.6, 0, 'door');
        break;

      default:
        this._put(g, G.box, 'stone', 1.2, 2.4, 1.2, 0, 1.2, 0);
        this._solid(g, 1.2, 1.2, 1.2, 0, 1.2, 0, 'stone');
        break;
    }
  }

  // ------------------------------------------------------------ camp fires

  /**
   * A fire and a couple of tents wherever a camp of monsters lives.
   *
   * They are not decoration: a camp you can see from a distance is a camp you
   * can choose to walk round, which is the difference between an encounter
   * and an ambush.
   */
  _campfire(R, spec) {
    const spot = this.realm.placeSpot(spec.at[0], spec.at[1], 16, R, 0.36);
    const g = new THREE.Group();
    g.position.set(spot.x, spot.y, spot.z);
    const rnd = mulberry32(((Math.round(spot.x) * 1103515245)
      ^ (Math.round(spot.z) * 12345)) >>> 0);
    this._fire(g, 0, 0, rnd);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rnd();
      const x = Math.cos(a) * 7, z = Math.sin(a) * 7;
      this._put(g, G.cone, 'cloth', 2.4, 3.0, 2.4, x, 1.5, z, a);
      this._put(g, G.box, 'obsidian', 1.0, 1.6, 0.3, x, 0.8, z + 2.2, a);
      this._solid(g, 1.8, 0.8, 1.8, x, 0.8, z, 'tent');
    }
    // Spoils on a rack, so the camp has a reason to be here.
    for (const sx of [-1, 1]) {
      this._put(g, G.cyl, 'woodDark', 0.12, 3.4, 0.12, sx * 3, 1.7, -6);
    }
    this._put(g, G.box, 'rope', 6.4, 0.08, 0.08, 0, 3.2, -6);
    for (let i = 0; i < 3; i++) {
      this._put(g, G.low, 'boneDark', 0.4, 0.7, 0.4, -2 + i * 2, 2.6, -6);
    }
    g.visible = false;
    this.merged += flatten(g, this.owned);
    this.root.add(g);
    this.sites.push({
      id: `camp:${R.id}:${Math.round(spot.x)}`, kind: 'enemycamp',
      name: 'AN ENEMY CAMP', blurb: '', region: R.id,
      at: spot, r: 18, group: g, spots: null,
    });
  }

  // ---------------------------------------------------------------- arenas

  /**
   * A boss arena: a ring of standing stones on the ground it will be fought
   * on, plus a marker at the middle so it can be seen from a distance.
   */
  _arena(R, spec) {
    const spot = this.realm.placeSpot(spec.at[0], spec.at[1], spec.arena, R, 0.30);
    const g = new THREE.Group();
    g.position.set(spot.x, spot.y, spot.z);
    const rnd = mulberry32(((Math.round(spot.x) * 2246822519)
      ^ (Math.round(spot.z) * 3266489917)) >>> 0);
    const n = Math.round(spec.arena / 4.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * spec.arena, z = Math.sin(a) * spec.arena;
      const gy = this.realm.heightAt(spot.x + x, spot.z + z) - spot.y;
      const h = 2.6 + rnd() * 2.4;
      const m = this._put(g, G.box, 'stone', 0.9, h, 0.9, x, gy + h * 0.5, z, a);
      m.rotation.z = (rnd() - 0.5) * 0.16;
      // Deliberately NOT solid. See the file header: the ring is a boundary
      // you can see, not one that holds you in.
    }
    // The centre stone, taller, so the arena is legible from outside it.
    this._put(g, G.box, 'stoneDark', 1.2, 5.0, 1.2, 0, 2.5, 0, rnd());
    this._solid(g, 1.2, 2.5, 1.2, 0, 2.5, 0, 'stone');
    this._anchor(g, 0, 5.4, 0, 2.0);
    g.visible = false;
    this.merged += flatten(g, this.owned);
    this.root.add(g);
    this.arenas.set(spec.id, {
      id: spec.id, region: R.id, at: spot, r: spec.arena,
      final: !!spec.final, group: g,
    });
  }

  // ------------------------------------------------------- roadside furniture

  /**
   * Signposts, mile-stones and roadside shrines.
   *
   * The point of these is direction. A signpost at a junction naming what is
   * down each arm is the cheapest possible way to stop a player being lost,
   * and it works without opening a menu.
   */
  /**
   * Signposts and mile-stones, as four instanced meshes.
   *
   * There are sixteen roads, three signposts each and a mile-stone every
   * couple of hundred units — about three hundred small objects, spread the
   * length and breadth of the map. As individual meshes that was two hundred
   * and ninety draw calls that were ALWAYS live, because unlike a village
   * there is no one place to cull them from: the whole point is that they are
   * everywhere the roads are.
   *
   * Four `InstancedMesh`es cost four draw calls for all of it, at any
   * distance, and the geometry is identical on every one of them — which is
   * exactly the case instancing exists for.
   */
  _roadside() {
    const net = this.realm.network;
    const posts = [], arms = [], caps = [], stones = [];
    for (const road of ROADS) {
      const nodes = net.roadNodes.get(road.id);
      if (!nodes) continue;
      // A post at each end and one in the middle: junctions get several,
      // which is exactly where they are wanted.
      for (const t of [0.02, 0.5, 0.98]) {
        const p = net.along(road.id, t);
        if (!p) continue;
        const y = this.realm.heightAt(p.x, p.z);
        posts.push([p.x, y + 2.5, p.z, 0]);
        arms.push([p.x + 1.8, y + 4.2, p.z, 0.5]);
        arms.push([p.x - 1.8, y + 3.1, p.z, 2.2]);
        caps.push([p.x, y + 5.2, p.z, 0]);
      }
      const n = Math.max(2, Math.floor(nodes.length * 1.4));
      for (let i = 1; i < n; i++) {
        const p = net.along(road.id, i / n);
        if (!p) continue;
        const y = this.realm.heightAt(p.x + 8, p.z + 8);
        stones.push([p.x + 8, y + 0.8, p.z + 8, (i * 0.7) % 3.14]);
      }
    }

    const batch = (geo, mat, list, sx, sy, sz) => {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const mx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3(sx, sy, sz);
      const v = new THREE.Vector3();
      const e = new THREE.Euler();
      list.forEach(([x, y, z, ry], i) => {
        v.set(x, y, z);
        e.set(0, ry, 0);
        q.setFromEuler(e);
        mx.compose(v, q, s);
        m.setMatrixAt(i, mx);
      });
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = true;
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    };

    this.roadside = [
      batch(G.cyl, this.mats.woodDark, posts, 0.22, 5.0, 0.22),
      batch(G.box, this.mats.plank, arms, 4.4, 0.7, 0.3),
      batch(G.low, this.mats.lamp, caps, 0.3, 0.34, 0.3),
      batch(G.box, this.mats.stonePale, stones, 0.7, 1.6, 0.5),
    ].filter(Boolean);
  }

  // ----------------------------------------------------------------- runtime

  /**
   * Draw only what is near, and scale "near" to how big the thing is.
   *
   * A landmark and a hut are not the same promise. A landmark has to be
   * visible from the region before it — that is its whole job — so it is
   * drawn out to twelve hundred units and left for the fog to fade.
   *
   * Everything else used to share one radius of five hundred and twenty,
   * which was set when the early regions held three sites each. They now hold
   * eight or nine.
   *
   * So the radius is derived from the site's own footprint instead. A
   * twenty-unit hut is not visible from six hundred units away whether it is
   * drawn or not; a hundred-and-twenty-unit city is, and gets six hundred and
   * forty. That draws every silhouette a player can actually make out and
   * skips the ones they cannot, which costs nothing on screen.
   */
  update(x, z, dt = 0) {
    const FAR2 = 1200 * 1200;
    for (const s of this.sites) {
      const d2 = (s.at.x - x) ** 2 + (s.at.z - z) ** 2;
      if (s.landmark) { s.group.visible = d2 < FAR2; continue; }
      if (s._show2 === undefined) {
        const show = 260 + s.r * 3.2;
        s._show2 = show * show;
      }
      s.group.visible = d2 < s._show2;
    }
    for (const [, a] of this.arenas) {
      const d2 = (a.at.x - x) ** 2 + (a.at.z - z) ** 2;
      // A ring of standing stones is a navigation aid, so it keeps the old
      // generous radius: seeing the arena from a long way off is how a player
      // knows there is a fight over there before they walk into it.
      a.group.visible = d2 < 520 * 520;
    }
    // The mill turns, because a landmark that moves is the one you remember.
    for (const [, L] of this.landmarks) {
      if (L.spin && L.group.visible) L.spin.rotation.z += dt * 0.4;
    }
    // And the same for a settlement's own moving parts.
    for (const s of this.spins) {
      if (s.site.visible) s.hub.rotation.z += dt * s.rate;
    }
  }

  /** The site whose trigger the player is standing in, or null. */
  at(x, z) {
    let best = null, bestD = Infinity;
    for (const s of this.sites) {
      const d = Math.hypot(s.at.x - x, s.at.z - z);
      // Generous on the small ones: an easter egg with a 16-unit radius is
      // something you have to be standing on, which is fine, but a 3-unit
      // trigger would be something you walk past.
      const reach = Math.max(14, s.r * 0.8);
      if (d < reach && d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /**
   * The settlement you are STANDING IN, or null for open country.
   *
   * Unlike `nearestSettlement`, which reaches out far enough to have the
   * residents built before you can see them, this is the settlement's own
   * footprint with a short apron round it — it is what the music asks, and
   * the music should change as you come through the gate rather than a
   * hundred and fifty units out in a field.
   */
  settlementAt(x, z) {
    let best = null, bestD = Infinity;
    for (const s of this.sites) {
      if (!s.settlement) continue;
      const d = Math.hypot(s.at.x - x, s.at.z - z);
      if (d > s.r * 1.15 + 14 || d >= bestD) continue;
      bestD = d; best = s;
    }
    return best;
  }

  /**
   * Is this point inside ANY built site — settlement, ruin, camp, arena?
   *
   * Asked by the scatter, which grows trees and boulders wherever the
   * ground will take one and has no idea a temple is there. Those are
   * colliders now (see js/scatter.js), and a solid pine in a temple
   * doorway or a boulder in the middle of a boss arena is worse than the
   * no-clip it replaced. The visual is left alone; only the collider is
   * skipped, so a ruin with a tree growing through it still has one.
   *
   * A plain scan of two hundred sites. It is asked a few hundred times per
   * tile crossing — roughly once every eight seconds of walking — and a
   * spatial index for that would be forty lines to save a fraction of a
   * millisecond.
   */
  insideSite(x, z) {
    for (const s of this.sites) {
      const d2 = (s.at.x - x) * (s.at.x - x) + (s.at.z - z) * (s.at.z - z);
      const r = s.r + 6;
      if (d2 < r * r) return true;
    }
    for (const [, a] of this.arenas) {
      const d2 = (a.at.x - x) * (a.at.x - x) + (a.at.z - z) * (a.at.z - z);
      const r = a.r + 8;
      if (d2 < r * r) return true;
    }
    return false;
  }

  /** The nearest settlement, for spawning the people who live in it. */
  nearestSettlement(x, z, within = 240) {
    let best = null, bestD = within;
    for (const s of this.sites) {
      if (!s.settlement || !s.spots || !s.spots.length) continue;
      const d = Math.hypot(s.at.x - x, s.at.z - z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const k in this.mats) this.mats[k].dispose();
    /**
     * The merged geometries, and only those.
     *
     * The parts every site was built from live in the module-level `G` and are
     * shared with every other site in the world; freeing one would knock the
     * buffers out from under all of them. The flattened results belong to this
     * instance, they are the bulk of what a load allocates, and nothing else
     * will ever free them.
     */
    for (const g of this.owned) g.dispose();
    this.owned.length = 0;
    this.sites.length = 0;
    this.arenas.clear();
    this.landmarks.clear();
  }
}
