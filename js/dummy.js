/**
 * Straw training dummies.
 *
 * Deliberately indestructible: they exist to show you your damage numbers,
 * so they never die and never need health synchronised between clients.
 * Each client reacts to its own hits locally, which keeps them completely
 * free of networking while still feeling responsive.
 */

import * as THREE from '../lib/three.module.js?v=v63';
import { damp } from './util.js?v=v63';

const BURLAP = 0xc9ac72;
const BURLAP_DARK = 0xa88c56;
const STRAW = 0xe8c95c;
const WOOD = 0x8a6238;
const WOOD_DARK = 0x5d4022;
const STONE = 0x8a8781;
const STITCH = 0x6b5433;

let _geo = null;
function geo() {
  if (_geo) return _geo;
  _geo = {
    sphere: new THREE.SphereGeometry(1, 10, 8),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
    cone: new THREE.ConeGeometry(1, 1, 6),
    disc: new THREE.CylinderGeometry(1, 1, 1, 14),
  };
  return _geo;
}

let _mats = null;
function mats() {
  if (_mats) return _mats;
  const L = (c) => new THREE.MeshLambertMaterial({ color: c });
  _mats = {
    burlap: L(BURLAP),
    burlapDark: L(BURLAP_DARK),
    straw: L(STRAW),
    wood: L(WOOD),
    woodDark: L(WOOD_DARK),
    stone: L(STONE),
    stitch: L(STITCH),
    red: L(0xc0392b),
    cream: L(0xefe6cf),
  };
  return _mats;
}

function part(g, m, sx, sy, sz, px, py, pz, rx, ry, rz) {
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(px || 0, py || 0, pz || 0);
  mesh.rotation.set(rx || 0, ry || 0, rz || 0);
  mesh.castShadow = true;
  return mesh;
}

export class TrainingDummy {
  constructor(x, y, z, facing = 0) {
    const G = geo();
    const M = mats();

    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;

    // Pivot everything above the base so hits can rock the whole dummy.
    this.body = new THREE.Group();
    this.body.position.y = 0.45;
    this.root.add(this.body);

    // --- stone base ---
    this.root.add(part(G.cyl, M.stone, 0.62, 0.22, 0.62, 0, 0.11, 0));
    this.root.add(part(G.cyl, M.woodDark, 0.68, 0.08, 0.68, 0, 0.26, 0));

    // --- post ---
    this.body.add(part(G.cyl, M.wood, 0.11, 0.55, 0.11, 0, 0.5, 0));

    // --- sack body: pear-shaped, wide at the bottom ---
    this.body.add(part(G.sphere, M.burlap, 0.46, 0.56, 0.40, 0, 1.42, 0));
    this.body.add(part(G.sphere, M.burlapDark, 0.40, 0.22, 0.36, 0, 1.02, 0));

    // Waist and neck ties with straw bursting out.
    this.body.add(part(G.cyl, M.straw, 0.30, 0.07, 0.30, 0, 0.92, 0));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.body.add(part(G.cone, M.straw, 0.05, 0.20, 0.05,
        Math.cos(a) * 0.30, 0.86, Math.sin(a) * 0.30, Math.PI * 0.85, 0, a));
    }

    // --- target painted on the chest ---
    this.body.add(part(G.disc, M.cream, 0.26, 0.02, 0.26, 0, 1.44, 0.38, Math.PI / 2, 0, 0));
    this.body.add(part(G.disc, M.red, 0.19, 0.02, 0.19, 0, 1.44, 0.40, Math.PI / 2, 0, 0));
    this.body.add(part(G.disc, M.cream, 0.11, 0.02, 0.11, 0, 1.44, 0.41, Math.PI / 2, 0, 0));
    this.body.add(part(G.disc, M.red, 0.05, 0.02, 0.05, 0, 1.44, 0.42, Math.PI / 2, 0, 0));

    // --- arms: a pole through the shoulders with straw cuffs ---
    this.body.add(part(G.cyl, M.wood, 0.055, 0.95, 0.055, 0, 1.72, 0, 0, 0, Math.PI / 2));
    for (const s of [-1, 1]) {
      this.body.add(part(G.cyl, M.straw, 0.13, 0.13, 0.13, s * 0.62, 1.72, 0, 0, 0, Math.PI / 2));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        this.body.add(part(G.cone, M.straw, 0.04, 0.17, 0.04,
          s * 0.70, 1.72 + Math.sin(a) * 0.12, Math.cos(a) * 0.12,
          0, 0, s * Math.PI * 0.5));
      }
    }
    // A wooden practice sword in one hand.
    this.body.add(part(G.box, M.woodDark, 0.06, 0.62, 0.13, 0.88, 2.0, 0, 0, 0, 0.12));

    // --- head ---
    this.body.add(part(G.sphere, M.burlap, 0.28, 0.30, 0.26, 0, 2.12, 0));
    this.body.add(part(G.cyl, M.straw, 0.17, 0.05, 0.17, 0, 1.86, 0));
    // Cross-stitch eyes.
    for (const sx of [-0.11, 0.11]) {
      this.body.add(part(G.box, M.stitch, 0.015, 0.10, 0.015, sx, 2.16, 0.25, 0, 0, 0.7));
      this.body.add(part(G.box, M.stitch, 0.015, 0.10, 0.015, sx, 2.16, 0.25, 0, 0, -0.7));
    }
    // Stitched mouth.
    for (let i = 0; i < 4; i++) {
      this.body.add(part(G.box, M.stitch, 0.014, 0.055, 0.014,
        -0.06 + i * 0.04, 2.03, 0.25, 0, 0, i % 2 ? 0.6 : -0.6));
    }
    // Straw tuft on top.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.body.add(part(G.cone, M.straw, 0.035, 0.16, 0.035,
        Math.cos(a) * 0.10, 2.42, Math.sin(a) * 0.10, 0.25 * Math.cos(a), 0, 0.25 * Math.sin(a)));
    }

    // Chest position used for hit tests and damage-number placement.
    this.pos = new THREE.Vector3(x, y, z);
    this.hitPoint = new THREE.Vector3(x, y + 1.85, z);
    this.id = null;
    this.dead = false;          // never dies; kept so target lists are uniform

    // Wobble state.
    this.wobble = 0;
    this.wobbleAxis = 0;
    this.spin = 0;
  }

  /** React to a hit: rock away from the blow. */
  hit(dirX, dirZ) {
    this.wobble = 1;
    // Rock about the axis perpendicular to the incoming direction.
    this.wobbleAxis = Math.atan2(dirX, dirZ);
    this.spin = 1;
  }

  update(dt, time) {
    if (this.wobble > 0) {
      this.wobble = Math.max(0, this.wobble - dt * 2.2);
      // Damped oscillation — a struck dummy swings and settles.
      const amp = this.wobble * this.wobble * 0.55;
      const osc = Math.sin(this.wobble * 26) * amp;
      this.body.rotation.x = Math.cos(this.wobbleAxis) * osc;
      this.body.rotation.z = -Math.sin(this.wobbleAxis) * osc;
    } else {
      this.body.rotation.x = damp(this.body.rotation.x, 0, 8, dt);
      this.body.rotation.z = damp(this.body.rotation.z, 0, 8, dt);
    }
    // Idle sway so they are not perfectly static.
    this.body.rotation.y = Math.sin(time * 0.7 + this.pos.x) * 0.04;
  }
}

/** Builds and owns every dummy in the world. */
export class DummyField {
  constructor(scene) {
    this.scene = scene;
    this.dummies = [];
  }

  add(x, y, z, facing) {
    const d = new TrainingDummy(x, y, z, facing);
    d.id = 'dummy-' + this.dummies.length;
    this.scene.add(d.root);
    this.dummies.push(d);
    return d;
  }

  /**
   * Cone/radius hit test used by the katana. Returns the dummies hit.
   * Kunai use the projectile system's own segment test instead.
   */
  queryRadius(pos, radius, out) {
    out.length = 0;
    for (const d of this.dummies) {
      const dx = d.pos.x - pos.x;
      const dz = d.pos.z - pos.z;
      const dy = d.pos.y - pos.y;
      if (dy > 3.2 || dy < -3.2) continue;
      if (dx * dx + dz * dz <= radius * radius) out.push(d);
    }
    return out;
  }

  update(dt, time) {
    for (const d of this.dummies) d.update(dt, time);
  }
}
