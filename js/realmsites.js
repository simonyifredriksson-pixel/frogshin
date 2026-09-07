/**
 * THE PLACES — villages, shrines, ruins, camps, arenas and the odd door.
 *
 * The region table declares a site as four numbers and a name. This turns each
 * one into something you can walk into: geometry, colliders, and a trigger
 * radius the overworld asks about.
 *
 * ── why every site is built at load, and hidden rather than streamed ───────
 * There are seventeen named sites, nineteen camp fires and twenty-two boss
 * arenas across the realm — sixty-odd small structures in total, which is less
 * geometry than the arena valley holds in trees. Building them all once means
 * their COLLIDERS can be baked into the heightfield world in a single pass,
 * which matters: the collision world bakes its broadphase once, and a site
 * that appeared later would have boxes nothing could find.
 *
 * So they are all built, all baked, and then simply not DRAWN unless you are
 * within sight of them. Visibility is a flag; a collider is a commitment.
 *
 * ── the shape of an arena ─────────────────────────────────────────────────
 * A ring of standing stones and nothing else. It is a boundary you can see
 * from outside and a landmark you can navigate by, and deliberately not a
 * wall: an open-world boss you cannot walk away from is a dungeon room with
 * extra steps.
 */

import * as THREE from '../lib/three.module.js?v=v80';
import { mulberry32 } from './util.js?v=v80';
import { SEA } from './regions.js?v=v80';

/** Shared geometry. Every site draws from these and none of them own any. */
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  taper: new THREE.CylinderGeometry(0.7, 1, 1, 7),
  cone: new THREE.ConeGeometry(1, 1, 7),
  sphere: new THREE.SphereGeometry(1, 9, 7),
  low: new THREE.SphereGeometry(1, 7, 5),
  torus: new THREE.TorusGeometry(1, 0.14, 6, 16),
};

/** Shared materials, likewise. Sites are stone, wood, thatch and lantern. */
function makeMats() {
  const L = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0x000000 });
  return {
    stone: L(0x8b8578),
    stoneDark: L(0x5f5b52),
    wood: L(0x6b4a2a),
    woodDark: L(0x452e19),
    thatch: L(0xb99a5a),
    tile: L(0x8a2f28),
    rope: L(0xcfc0a0),
    bone: L(0xd8d2c2),
    iron: L(0x565f6b),
    gold: L(0xc9a227),
    // Lanterns and glowing things are their own light source, so they read at
    // dusk and in the Palewood's fog.
    lamp: new THREE.MeshBasicMaterial({ color: 0xffd76b }),
    ember: new THREE.MeshBasicMaterial({ color: 0xff8a3c }),
    pale: new THREE.MeshBasicMaterial({ color: 0xeef4ff }),
    green: new THREE.MeshBasicMaterial({ color: 0x8fe86b }),
  };
}

export class Sites {
  /**
   * @param realm   for heights and for `placeSpot`
   * @param scene   where the structures go
   */
  constructor(scene, realm) {
    this.scene = scene;
    this.realm = realm;
    this.mats = makeMats();
    /** Every built site: { id, kind, name, blurb, at, r, group, region } */
    this.sites = [];
    /** Arena rings, keyed by boss id, so a fight can be found by its stones. */
    this.arenas = new Map();
    this.root = new THREE.Group();
    this.root.name = 'sites';
    scene.add(this.root);
    this._shown = new Set();
  }

  // ------------------------------------------------------------------ build

  /** One labelled step per region, for the loading bar. */
  buildTasks(regions) {
    return regions.map((R) => [`Building ${R.name.toLowerCase()}`, () => this._region(R)]);
  }

  _region(R) {
    for (const s of R.sites || []) this._site(R, s);
    for (const b of R.bosses || []) this._arena(R, b);
  }

  _site(R, spec) {
    // Sites are buildings and standing stones, so they are allowed rougher
    // ground than an arena is — a shrine on a slope is a shrine on a slope.
    const spot = this.realm.placeSpot(spec.at[0], spec.at[1],
      Math.max(14, spec.r), R, 0.42);
    const g = new THREE.Group();
    g.position.set(spot.x, spot.y, spot.z);
    const rnd = mulberry32((Math.round(spot.x) * 374761393)
      ^ (Math.round(spot.z) * 668265263));

    switch (spec.kind) {
      case 'village': this._village(g, spec, R, rnd); break;
      case 'shrine': this._shrine(g, spec, rnd); break;
      case 'ruin': this._ruin(g, spec, rnd); break;
      case 'camp': this._camp(g, spec, rnd); break;
      default: this._oddity(g, spec, rnd); break;
    }

    g.visible = false;
    this.root.add(g);
    this.sites.push({
      id: spec.id, kind: spec.kind, name: spec.name,
      blurb: spec.blurb || '', region: R.id,
      at: spot, r: spec.r, group: g,
    });
  }

  /** A collider in WORLD space, from a part's local offsets. */
  _solid(g, hx, hy, hz, x, y, z, tag) {
    this.realm.collision.addBox(
      g.position.x + x, g.position.y + y, g.position.z + z, hx, hy, hz, tag);
  }

  _put(g, geo, mat, sx, sy, sz, x, y, z, ry) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }

  // ----------------------------------------------------------- site kinds

  /**
   * A village: huts round a well, and a fence with a way in.
   *
   * Stilted where the ground is wet, because two of the three villages are in
   * marshes and a hut with its floor under the waterline is a hut nobody
   * lives in. The stilt height is measured from the actual ground, so the
   * same code builds Croakhollow on dry land and The Stilts over the fen.
   */
  _village(g, spec, R, rnd) {
    const M = this.mats;
    const n = 7 + Math.floor(rnd() * 3);
    const ring = spec.r * 0.62;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.25;
      const x = Math.cos(a) * ring, z = Math.sin(a) * ring;
      const gy = this.realm.heightAt(g.position.x + x, g.position.z + z);
      // How far this hut's ground is below the village centre, plus stilts
      // enough to clear the water.
      const drop = gy - g.position.y;
      const stilt = Math.max(0, (SEA + 1.6) - gy) + 0.4;
      const floor = drop + stilt;
      const w = 3.0 + rnd() * 1.2, d = 3.0 + rnd() * 1.2;
      const face = a + Math.PI;

      if (stilt > 0.7) {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            this._put(g, G.cyl, M.woodDark, 0.16, floor - drop + 0.6, 0.16,
              x + sx * w * 0.7, drop + (floor - drop) * 0.5 - 0.3, z + sz * d * 0.7);
          }
        }
      }
      // Platform, walls, roof.
      this._put(g, G.box, M.wood, w * 1.6, 0.28, d * 1.6, x, floor, z, face);
      this._put(g, G.box, M.woodDark, w * 1.4, 2.4, d * 1.4, x, floor + 1.3, z, face);
      this._put(g, G.cone, M.thatch, w * 1.25, 1.9, d * 1.25, x, floor + 3.3, z, face);
      // One collider per hut: the walls, as one box. Doorways are not modelled
      // and a frog cannot fit through one anyway at this size.
      this._solid(g, w * 1.4, 1.4, d * 1.4, x, floor + 1.5, z, 'hut');
      this._solid(g, w * 1.6, 0.2, d * 1.6, x, floor + 0.1, z, 'deck');
    }
    // The well in the middle, and a fire.
    this._put(g, G.cyl, M.stone, 1.5, 1.1, 1.5, 0, 0.4, 0);
    this._put(g, G.cyl, M.stoneDark, 1.2, 0.3, 1.2, 0, 0.95, 0);
    this._solid(g, 1.5, 0.7, 1.5, 0, 0.5, 0, 'well');
    for (const sx of [-1, 1]) {
      this._put(g, G.cyl, M.woodDark, 0.12, 2.4, 0.12, sx * 1.4, 1.6, 0);
    }
    this._put(g, G.box, M.wood, 3.2, 0.16, 0.3, 0, 2.8, 0);
    this._fire(g, 5, 0, rnd);
    // Lanterns on poles, which double as grapple anchors — the tongue is the
    // player's whole traversal kit and a village with nothing to grab is a
    // village you can only walk through.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const x = Math.cos(a) * ring * 0.55, z = Math.sin(a) * ring * 0.55;
      this._put(g, G.cyl, M.woodDark, 0.14, 5.2, 0.14, x, 2.6, z);
      this._put(g, G.low, M.lamp, 0.42, 0.5, 0.42, x, 5.3, z);
      this.realm.collision.addAnchor(
        g.position.x + x, g.position.y + 5.3, g.position.z + z, 1.8);
    }
  }

  /** A shrine: a stepped stone platform under a gate, with an offering slab. */
  _shrine(g, spec, rnd) {
    const M = this.mats;
    const r = Math.max(9, spec.r);
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.22;
      this._put(g, G.box, i ? M.stone : M.stoneDark,
        r * k, 0.45, r * k, 0, 0.22 + i * 0.45, 0);
      this._solid(g, r * k, 0.25, r * k, 0, 0.22 + i * 0.45, 0, 'deck');
    }
    const top = 1.6;
    // The gate. Two posts and two beams, the second shorter and higher.
    for (const sx of [-1, 1]) {
      this._put(g, G.taper, M.tile, 0.34, 5.4, 0.34, sx * r * 0.5, top + 2.7, 0);
      this._solid(g, 0.4, 2.7, 0.4, sx * r * 0.5, top + 2.7, 0, 'post');
    }
    this._put(g, G.box, M.tile, r * 1.25, 0.34, 0.5, 0, top + 5.5, 0);
    this._put(g, G.box, M.tile, r * 1.0, 0.26, 0.4, 0, top + 4.7, 0);
    // The slab you actually press.
    this._put(g, G.box, M.stoneDark, 1.5, 0.9, 1.0, 0, top + 0.45, 0);
    this._put(g, G.low, M.lamp, 0.3, 0.34, 0.3, 0, top + 1.1, 0);
    for (let i = 0; i < 5; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.55 + rnd() * 0.3);
      this._put(g, G.low, M.stone, 0.5 + rnd() * 0.5, 0.4 + rnd() * 0.4,
        0.5 + rnd() * 0.5, Math.cos(a) * d, top + 0.3, Math.sin(a) * d);
    }
  }

  /** A ruin: broken wall, standing arch, rubble. */
  _ruin(g, spec, rnd) {
    const M = this.mats;
    const r = Math.max(14, spec.r);
    // The arch you walk through, at the front.
    for (const sx of [-1, 1]) {
      this._put(g, G.box, M.stone, 1.5, 7.0, 1.5, sx * r * 0.42, 3.5, 0);
      this._solid(g, 1.5, 3.5, 1.5, sx * r * 0.42, 3.5, 0, 'pillar');
    }
    this._put(g, G.box, M.stone, r * 0.5 + 1.5, 1.1, 1.6, 0, 7.6, 0);
    this._put(g, G.box, M.stoneDark, r * 0.36, 0.8, 1.2, 0, 8.7, 0);
    // Wall stumps either side, each a different height — a ruin is uneven.
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = (i % 4) + 1;
      const h = 5.5 - k * (0.8 + rnd() * 0.7);
      const x = side * (r * 0.42 + k * 4.2);
      this._put(g, G.box, M.stone, 2.0, h, 1.4, x, h, 0);
      this._solid(g, 2.0, h, 1.4, x, h, 0, 'wall');
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, d = r * (0.2 + rnd() * 0.8);
      this._put(g, G.low, M.stoneDark, 0.6 + rnd() * 0.9, 0.4 + rnd() * 0.6,
        0.6 + rnd() * 0.9, Math.cos(a) * d, 0.3, Math.sin(a) * d);
    }
  }

  /** A camp: a fire, two lean-tos and somebody's kit. */
  _camp(g, spec, rnd) {
    const M = this.mats;
    this._fire(g, 0, 0, rnd);
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.6;
      const x = Math.cos(a) * 6, z = Math.sin(a) * 6;
      this._put(g, G.box, M.thatch, 3.0, 0.2, 2.2, x, 1.6, z, a);
      for (const sx of [-1, 1]) {
        this._put(g, G.cyl, M.woodDark, 0.11, 3.2, 0.11,
          x + Math.cos(a + Math.PI / 2) * sx * 2.4, 0.8,
          z + Math.sin(a + Math.PI / 2) * sx * 2.4);
      }
      this._solid(g, 3.0, 0.2, 2.2, x, 1.6, z, 'deck');
    }
    this._put(g, G.cyl, M.woodDark, 0.16, 6.0, 0.16, -4, 3.0, 4);
    this._put(g, G.low, M.lamp, 0.4, 0.46, 0.4, -4, 6.1, 4);
    this.realm.collision.addAnchor(
      g.position.x - 4, g.position.y + 6.1, g.position.z + 4, 1.8);
  }

  /**
   * The strange ones.
   *
   * Each easter egg is built from its own id rather than from a generic
   * "easteregg" shape, because the point of them is that they are specific:
   * a bell in the water, an oak with a room in it, a scrap of paper under a
   * stone, and a door attached to nothing at all.
   */
  _oddity(g, spec, rnd) {
    const M = this.mats;
    switch (spec.id) {
      case 'drowned-bell':
        // Half-submerged, hanging from a leaning frame.
        for (const sx of [-1, 1]) {
          this._put(g, G.cyl, M.woodDark, 0.18, 6.0, 0.18, sx * 2.2, 3.0, 0);
        }
        this._put(g, G.box, M.wood, 2.8, 0.2, 0.3, 0, 6.0, 0);
        this._put(g, G.taper, M.gold, 1.5, 2.6, 1.5, 0, 4.0, 0);
        this._put(g, G.low, M.gold, 0.4, 0.5, 0.4, 0, 2.6, 0);
        this._solid(g, 1.6, 1.4, 1.6, 0, 4.0, 0, 'bell');
        break;

      case 'hollow-oak': {
        // One enormous trunk with a doorway-sized gap and a canopy over it.
        this._put(g, G.taper, M.woodDark, 3.4, 16, 3.4, 0, 8, 0);
        this._put(g, G.low, this.mats.stone, 1.2, 1.6, 0.8, 0, 2.0, 3.0);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          this._put(g, G.low, M.green, 5.5, 3.4, 5.5,
            Math.cos(a) * 4, 15 + rnd() * 3, Math.sin(a) * 4);
        }
        this._solid(g, 3.0, 8, 3.0, 0, 8, 0, 'trunk');
        break;
      }

      case 'the-note':
        this._put(g, G.box, M.stone, 1.1, 0.5, 1.1, 0, 0.25, 0);
        this._put(g, G.box, M.pale, 0.5, 0.04, 0.7, 0, 0.55, 0, 0.3);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this._put(g, G.box, M.stoneDark, 0.5, 1.6 + rnd(), 0.5,
            Math.cos(a) * 4, 0.8, Math.sin(a) * 4, a);
        }
        break;

      case 'white-door':
        // A door. Not attached to anything. That is the whole joke.
        this._put(g, G.box, M.pale, 1.4, 3.2, 0.14, 0, 1.6, 0);
        this._put(g, G.box, M.bone, 1.6, 0.16, 0.22, 0, 3.3, 0);
        this._put(g, G.low, M.gold, 0.12, 0.12, 0.12, 0.5, 1.7, 0.16);
        this._solid(g, 1.4, 1.6, 0.3, 0, 1.6, 0, 'door');
        break;

      default:
        this._put(g, G.box, M.stone, 1.2, 2.4, 1.2, 0, 1.2, 0);
        this._solid(g, 1.2, 1.2, 1.2, 0, 1.2, 0, 'stone');
        break;
    }
  }

  _fire(g, x, z, rnd) {
    const M = this.mats;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this._put(g, G.low, M.stoneDark, 0.4, 0.3, 0.4,
        x + Math.cos(a) * 1.5, 0.2, z + Math.sin(a) * 1.5);
    }
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const m = this._put(g, G.cyl, M.woodDark, 0.12, 1.6, 0.12,
        x + Math.cos(a) * 0.4, 0.6, z + Math.sin(a) * 0.4);
      m.rotation.z = Math.cos(a) * 0.5;
      m.rotation.x = Math.sin(a) * 0.5;
    }
    this._put(g, G.low, M.ember, 0.7, 0.9, 0.7, x, 0.7, z);
  }

  /**
   * A boss arena: a ring of standing stones on the ground it will be fought
   * on, plus a marker at the middle so it can be seen from a distance.
   */
  _arena(R, spec) {
    const spot = this.realm.placeSpot(spec.at[0], spec.at[1], spec.arena, R, 0.30);
    const g = new THREE.Group();
    g.position.set(spot.x, spot.y, spot.z);
    const rnd = mulberry32((Math.round(spot.x) * 2246822519)
      ^ (Math.round(spot.z) * 3266489917));
    const M = this.mats;
    const n = Math.round(spec.arena / 4.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * spec.arena, z = Math.sin(a) * spec.arena;
      const gy = this.realm.heightAt(spot.x + x, spot.z + z) - spot.y;
      const h = 2.6 + rnd() * 2.4;
      const m = this._put(g, G.box, M.stone, 0.9, h, 0.9, x, gy + h * 0.5, z, a);
      m.rotation.z = (rnd() - 0.5) * 0.16;
      // Deliberately NOT solid. See the file header: the ring is a boundary
      // you can see, not one that holds you in.
    }
    // The centre stone, taller, so the arena is legible from outside it.
    this._put(g, G.box, M.stoneDark, 1.2, 5.0, 1.2, 0, 2.5, 0, rnd());
    this._solid(g, 1.2, 2.5, 1.2, 0, 2.5, 0, 'stone');
    g.visible = false;
    this.root.add(g);
    this.arenas.set(spec.id, {
      id: spec.id, region: R.id, at: spot, r: spec.arena,
      final: !!spec.final, group: g,
    });
  }

  // ----------------------------------------------------------------- runtime

  /**
   * Draw only what is near.
   *
   * Sixty structures is not many, but sixty structures' worth of draw calls
   * for buildings the player cannot see is the easiest saving in the file.
   * The radius is generous — 520 units, past every region's fog — so nothing
   * ever pops into existence in front of you.
   */
  update(x, z) {
    const R2 = 520 * 520;
    for (const s of this.sites) {
      const d2 = (s.at.x - x) ** 2 + (s.at.z - z) ** 2;
      s.group.visible = d2 < R2;
    }
    for (const [, a] of this.arenas) {
      const d2 = (a.at.x - x) ** 2 + (a.at.z - z) ** 2;
      a.group.visible = d2 < R2;
    }
  }

  /** The site whose trigger the player is standing in, or null. */
  at(x, z) {
    for (const s of this.sites) {
      const d = Math.hypot(s.at.x - x, s.at.z - z);
      // Generous on the small ones: an easter egg with a 12-unit radius is
      // something you have to be standing on, which is fine, but a 3-unit
      // trigger would be something you walk past.
      if (d < Math.max(14, s.r * 0.8)) return s;
    }
    return null;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const k in this.mats) this.mats[k].dispose();
    this.sites.length = 0;
    this.arenas.clear();
  }
}
