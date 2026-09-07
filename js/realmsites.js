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

import * as THREE from '../lib/three.module.js?v=v86';
import { mulberry32, clamp } from './util.js?v=v86';
import { SEA } from './regions.js?v=v86';
import { buildLandmark } from './landmarks.js?v=v86';
import { ROADS } from './roads.js?v=v86';

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
    /** Arena rings, keyed by boss id, so a fight can be found by its stones. */
    this.arenas = new Map();
    /** The huge things, keyed by region id. */
    this.landmarks = new Map();
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

  /** A grapple anchor, so the tongue has something to reach for. */
  _anchor(g, x, y, z, r = 1.8) {
    this.realm.collision.addAnchor(
      g.position.x + x, g.position.y + y, g.position.z + z, r);
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

  /** A market stall: four posts, an awning, and a table of goods. */
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
        this._put(g, G.box, 'stone', rw * 0.32, 7, 2.4, x, base + 3.5, z,
          a + Math.PI / 2);
        this._solid(g, rw * 0.16, 3.5, 1.6, x, base + 3.5, z, 'wall');
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
    for (let i = 0; i < 11; i++) {
      const a = i * 0.86;
      const y = 6 + i * 6.5;
      const rad = 27 + (i % 3) * 5;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      this._put(g, G.box, 'plank', 7, 0.5, 6, x, y, z, a);
      this._solid(g, 3.6, 0.3, 3.2, x, y, z, 'deck');
      // The walkway back to the trunk.
      const mx = Math.cos(a) * rad * 0.55, mz = Math.sin(a) * rad * 0.55;
      this._put(g, G.box, 'plank', 2.4, 0.35, rad * 0.9, mx, y - 0.1, mz, a + Math.PI / 2);
      this._solid(g, 1.4, 0.25, rad * 0.45, mx, y - 0.1, mz, 'deck');
      if (i % 2 === 0) {
        this._house(g, x, z, 3.0, 2.8, 2.6, a + Math.PI, style, y + 0.3);
        spots.push({ x: g.position.x + x, z: g.position.z + z });
      }
      this._lamppost(g, x + 2, z + 2, 3.0);
      this._anchor(g, x, y + 2, z, 2.0);
    }
    // The ground floor: a market round the roots.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      this._stall(g, Math.cos(a) * 34, Math.sin(a) * 34, a + Math.PI, rnd);
      spots.push({ x: g.position.x + Math.cos(a) * 30, z: g.position.z + Math.sin(a) * 30 });
    }
    this._fire(g, 0, 36, rnd);
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
      this._put(g, G.box, 'wood', 3.4, 0.14, 0.12, x, base + 1.3, z, a + Math.PI / 2);
    }
    this._fire(g, 6, 6, rnd);
    return [{ x: g.position.x + 16, z: g.position.z }, { x: g.position.x + 6, z: g.position.z + 6 }];
  }

  /** A shrine: a stepped platform under a gate, with an offering slab. */
  _shrine(g, spec, rnd, style) {
    const r = Math.max(9, spec.r);
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
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.55 + rnd() * 0.3);
      this._put(g, G.low, 'stone', 0.5 + rnd() * 0.5, 0.4 + rnd() * 0.4,
        0.5 + rnd() * 0.5, Math.cos(a) * d, top + 0.3, Math.sin(a) * d);
    }
  }

  /** A temple: a colonnade, a roof, a dark doorway and something lit inside. */
  _temple(g, spec, rnd, style) {
    const r = Math.max(16, spec.r);
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
    this._put(g, G.box, style.roofMat, r * 1.02, 1.6, r * 0.86, 0, base + 13, 0);
    this._put(g, G.cone, style.roofMat, r * 0.8, 6, r * 0.7, 0, base + 16, 0, 0.785);
    // The cella, and the light in it.
    this._put(g, G.box, style.wall, r * 0.5, 10, r * 0.44, 0, base + 5, 0);
    this._put(g, G.box, 'obsidian', r * 0.18, 6, 0.6, 0, base + 3, r * 0.23);
    this._put(g, G.low, 'lamp', 1.1, 1.3, 1.1, 0, base + 4, r * 0.1);
    this._solid(g, r * 0.26, 5, r * 0.24, 0, base + 5, 0, 'wall');
    for (let i = 0; i < 8; i++) {
      const a = i * 0.9;
      this._put(g, G.box, 'stoneDark', 3.0, 0.5, 1.4, Math.cos(a) * r * 0.9,
        0.5, Math.sin(a) * r * 0.9 - r * 0.7);
    }
  }

  /** A ruin: broken wall, standing arch, rubble. */
  _ruin(g, spec, rnd, style) {
    const r = Math.max(14, spec.r);
    for (const sx of [-1, 1]) {
      this._put(g, G.box, 'stone', 1.5, 7.0, 1.5, sx * r * 0.42, 3.5, 0);
      this._solid(g, 1.5, 3.5, 1.5, sx * r * 0.42, 3.5, 0, 'pillar');
    }
    this._put(g, G.box, 'stone', r * 0.5 + 1.5, 1.1, 1.6, 0, 7.6, 0);
    this._put(g, G.box, 'stoneDark', r * 0.36, 0.8, 1.2, 0, 8.7, 0);
    this._anchor(g, 0, 8.2, 0, 2.0);
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = (i % 4) + 1;
      const h = 5.5 - k * (0.8 + rnd() * 0.7);
      const x = side * (r * 0.42 + k * 4.2);
      this._put(g, G.box, 'stone', 2.0, h, 1.4, x, h, 0);
      this._solid(g, 2.0, h, 1.4, x, h, 0, 'wall');
    }
    // A statue that lost its head, and the head.
    this._put(g, G.box, 'stoneDark', 1.6, 5.0, 1.6, r * 0.2, 2.5, -r * 0.5);
    this._put(g, G.low, 'stone', 1.1, 1.2, 1.1, r * 0.2 + 3, 1.1, -r * 0.5 + 2);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.2 + rnd() * 0.8);
      this._put(g, G.low, 'stoneDark', 0.6 + rnd() * 0.9, 0.4 + rnd() * 0.6,
        0.6 + rnd() * 0.9, Math.cos(a) * d, 0.3, Math.sin(a) * d);
    }
    // Vines, if the region grows any.
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2;
      this._put(g, G.box, 'leaf', 0.5, 3 + rnd() * 3, 0.5,
        Math.cos(a) * r * 0.42, 3, Math.sin(a) * r * 0.42);
    }
  }

  /** A tower: round, tall, with a stair up the outside and a light on top. */
  _tower(g, spec, rnd, style) {
    const h = 34 + rnd() * 12;
    this._put(g, G.disc, 'stoneDark', 6.5, 1.2, 6.5, 0, 0.6, 0);
    this._solid(g, 6.5, 0.6, 6.5, 0, 0.6, 0, 'deck');
    this._put(g, G.cyl, style.wall, 4.6, h, 4.6, 0, h * 0.5, 0);
    this._solid(g, 4.6, h * 0.5, 4.6, 0, h * 0.5, 0, 'tower');
    this._put(g, G.disc, 'stone', 5.8, 1.4, 5.8, 0, h, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this._put(g, G.box, 'stoneDark', 1.2, 1.8, 1.0,
        Math.cos(a) * 5.4, h + 1.6, Math.sin(a) * 5.4, a);
    }
    this._put(g, G.low, 'lamp', 1.4, 1.6, 1.4, 0, h + 2.6, 0);
    this._anchor(g, 0, h + 2, 0, 2.4);
    // The stair, spiralling up the outside as `deck` steps.
    const steps = Math.floor(h / 1.4);
    for (let i = 0; i < steps; i++) {
      const a = i * 0.44;
      const x = Math.cos(a) * 5.6, z = Math.sin(a) * 5.6;
      this._put(g, G.box, 'stone', 2.4, 0.4, 1.6, x, 1.2 + i * 1.4, z, a);
      this._solid(g, 1.3, 0.25, 0.9, x, 1.2 + i * 1.4, z, 'deck');
    }
    // Windows going up, so it is lit from inside.
    for (let i = 1; i < 5; i++) {
      const a = i * 1.7;
      this._put(g, G.box, 'lamp', 0.9, 1.4, 0.4,
        Math.cos(a) * 4.7, i * (h / 5), Math.sin(a) * 4.7, a);
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
      this._put(g, G.box, 'stone', r * 0.2, 8, 2.0, x, base + 4, z, a + Math.PI / 2);
      this._solid(g, r * 0.1, 4, 1.4, x, base + 4, z, 'wall');
    }
    this._fire(g, 0, r * 0.3, rnd);
    spots.push({ x: g.position.x, z: g.position.z + r * 0.36 });
    spots.push({ x: g.position.x - r * 0.3, z: g.position.z });
    return spots;
  }

  /** A gatehouse: an arch across a road, with a guard walk over the top. */
  _gatehouse(g, spec, rnd, style) {
    const r = Math.max(18, spec.r);
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
      for (let i = -2; i <= 2; i++) {
        this._put(g, G.cyl, 'stoneDark', 0.7, 4.4, 0.7, sx * 4.2, 1.4, i * (len * 0.22));
        this._put(g, G.low, 'lamp', 0.4, 0.45, 0.4, sx * 4.2, 3.9, i * (len * 0.22));
        this._anchor(g, sx * 4.2, 3.9, i * (len * 0.22), 1.6);
      }
    }
    // Piers going down into whatever is underneath.
    for (let i = -1; i <= 1; i++) {
      this._put(g, G.box, 'stoneDark', 4, 22, 5, 0, -11, i * (len * 0.33));
    }
  }

  /** A cave: a mouth in a rock face, and dark inside it. */
  _cave(g, spec, rnd, style) {
    const r = Math.max(12, spec.r);
    // The outcrop the mouth is in.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI - 0.4;
      this._put(g, G.low, 'stoneDark', 8 + rnd() * 5, 7 + rnd() * 7, 8 + rnd() * 5,
        Math.cos(a) * r * 0.9, 3, Math.sin(a) * r * 0.9 - r * 0.5);
    }
    this._put(g, G.low, 'stoneDark', r * 0.9, 12, r * 0.7, 0, 4, -r * 0.55);
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
    this._put(g, G.low, 'stoneDark', r * 0.8, 14, r * 0.6, 0, 4, -r * 0.5);
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
      this._put(g, G.low, 'stone', 2 + rnd() * 2, 1.4, 2 + rnd() * 2,
        Math.cos(a) * d, 0.6, Math.sin(a) * d);
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
  _dungeon(g, spec, rnd, style) {
    const r = Math.max(16, spec.r);
    // A sunken court, walled, with the stair down one side.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      if (i === 0 || i === 13) continue;
      const x = Math.cos(a) * r * 0.7, z = Math.sin(a) * r * 0.7;
      this._put(g, G.box, style.wall, r * 0.18, 8, 2.0, x, 2, z, a + Math.PI / 2);
      this._solid(g, r * 0.1, 4, 1.4, x, 2, z, 'wall');
    }
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const z = r * 0.6 - i * 1.9;
      this._put(g, G.box, 'stone', 7, 0.6, 2.0, 0, -i * 1.1, z);
      this._solid(g, 3.5, 0.35, 1.0, 0, -i * 1.1, z, 'deck');
    }
    const floorY = -steps * 1.1;
    this._put(g, G.box, 'stoneDark', 14, 0.8, 12, 0, floorY - 0.4, -r * 0.2);
    this._solid(g, 7, 0.5, 6, 0, floorY - 0.4, -r * 0.2, 'deck');
    // The door.
    this._put(g, G.box, style.wall, 10, 12, 1.6, 0, floorY + 6, -r * 0.5);
    this._put(g, G.box, 'obsidian', 6.4, 9, 0.8, 0, floorY + 4.6, -r * 0.54);
    this._put(g, G.torus, 'gold', 1.0, 1.0, 1.0, 0, floorY + 4.6, -r * 0.58);
    this._solid(g, 5, 6, 1.2, 0, floorY + 6, -r * 0.5, 'door');
    for (const sx of [-1, 1]) {
      this._put(g, G.cyl, 'stoneDark', 0.7, 5, 0.7, sx * 5.4, floorY + 2.5, -r * 0.3);
      this._put(g, G.low, 'ember', 0.5, 0.6, 0.5, sx * 5.4, floorY + 5.4, -r * 0.3);
    }
  }

  /** An arena you can walk into: tiered seating round a sand floor. */
  _siteArena(g, spec, rnd, style) {
    const r = Math.max(24, spec.r);
    this._put(g, G.disc, 'sand', r * 0.6, 0.8, r * 0.6, 0, 0.4, 0);
    this._solid(g, r * 0.6, 0.4, r * 0.6, 0, 0.4, 0, 'deck');
    for (let t = 0; t < 5; t++) {
      const rad = r * (0.64 + t * 0.07);
      const seg = 26 + t * 4;
      for (let i = 0; i < seg; i++) {
        if (t < 2 && i % 9 === 0) continue;              // the two entrances
        const a = (i / seg) * Math.PI * 2;
        this._put(g, G.box, t % 2 ? 'stone' : 'stonePale', rad * 0.14, 2.2,
          r * 0.09, Math.cos(a) * rad, 0.8 + t * 1.8, Math.sin(a) * rad,
          a + Math.PI / 2);
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
          this._put(g, G.box, 'stoneDark', 0.5, 1.6 + rnd(), 0.5,
            Math.cos(a) * 4, 0.8, Math.sin(a) * 4, a);
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
