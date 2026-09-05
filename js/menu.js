/**
 * Start-screen background: a self-contained 3D diorama that the camera
 * drifts through on a looping spline.
 *
 * It is intentionally NOT the gameplay world — it is a much smaller, hand
 * composed scene (a lantern-lit shrine terrace above a lake, framed by pines
 * and a mountain ridge) so the menu appears instantly instead of waiting on
 * full world generation.
 */

import * as THREE from '../lib/three.module.js?v=v56';
import { ValueNoise, mulberry32, clamp, lerp, smoothstep } from './util.js?v=v56';
import { Atmosphere } from './atmosphere.js?v=v56';
import { FrogModel } from './frog.js?v=v56';
import { lanternGlowTexture } from './world.js?v=v56';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

class MiniBatch {
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

export class MenuScene {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.2, 900);
    this.rnd = mulberry32(90210);
    this.noise = new ValueNoise(90210);
    this.time = 0;
    this.lanterns = [];

    this._buildTerrain();
    this._buildProps();
    this._buildHero();
    this.atmo = new Atmosphere(this.scene, renderer, {
      cloudCount: 22,
      leafCount: 180,
      fogNear: 60,
      fogFar: 320,
      skyTop: 0x2b76c9,
      skyMid: 0x74baea,
      skyBottom: 0xd6ecf7,
      fogColor: 0xb2dcf0,
    });

    this._buildCameraPath();
  }

  // ------------------------------------------------------------------ scene

  height(x, z) {
    // A bowl: the lake sits low in the middle, ridges rise around the rim.
    const d = Math.hypot(x, z);
    let h = this.noise.fbm(x * 0.014, z * 0.014, 4) * 7 + 5;
    h += smoothstep(clamp((d - 42) / 40, 0, 1)) * 46;
    h += smoothstep(clamp((d - 95) / 45, 0, 1)) * 90;
    // Lake basin.
    const lake = 1 - smoothstep(clamp((Math.hypot(x - 14, z - 6) - 18) / 14, 0, 1));
    h = lerp(h, -2.0, lake);
    // Shrine terrace.
    const ter = 1 - smoothstep(clamp((Math.hypot(x + 26, z + 16) - 13) / 9, 0, 1));
    h = lerp(h, 13.0, ter);
    return h;
  }

  _buildTerrain() {
    const size = 260, grid = 100;
    const geo = new THREE.PlaneGeometry(size, size, grid - 1, grid - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0x54a33c);
    const grass2 = new THREE.Color(0x6fbb4c);
    const sand = new THREE.Color(0xd9c793);
    const rock = new THREE.Color(0x71695f);
    const snow = new THREE.Color(0xf1f5f9);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);
      const v = this.noise.fbm(x * 0.06, z * 0.06, 2) * 0.5 + 0.5;
      if (h < 1.6) tmp.copy(sand);
      else if (h > 74) tmp.copy(snow);
      else if (h > 46) tmp.copy(rock).lerp(snow, clamp((h - 46) / 30, 0, 1));
      else tmp.copy(grass).lerp(grass2, v);
      const sh = 0.88 + v * 0.24;
      colors[i * 3] = tmp.r * sh; colors[i * 3 + 1] = tmp.g * sh; colors[i * 3 + 2] = tmp.b * sh;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    this.scene.add(m);

    // Lake.
    const wgeo = new THREE.PlaneGeometry(70, 70, 24, 24);
    wgeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wgeo, new THREE.MeshLambertMaterial({
      color: 0x3690b8, transparent: true, opacity: 0.78, emissive: 0x123c52,
    }));
    water.position.set(14, 1.1, 6);
    this.scene.add(water);
    this.water = water;
    this.waterBase = wgeo.attributes.position.array.slice();
  }

  _buildProps() {
    // No `vertexColors` — per-instance colour comes from setColorAt, and
    // enabling both would multiply by a missing attribute and render black.
    const mat = () => new THREE.MeshLambertMaterial({});
    const B = {
      box: new MiniBatch(new THREE.BoxGeometry(1, 1, 1), mat()),
      roof: new MiniBatch(new THREE.ConeGeometry(1, 1, 4, 1), mat()),
      trunk: new MiniBatch(new THREE.CylinderGeometry(0.42, 0.6, 1, 6), mat()),
      pine: new MiniBatch(new THREE.ConeGeometry(1, 1, 7, 1), mat()),
      blob: new MiniBatch(new THREE.IcosahedronGeometry(1, 0), mat()),
      rock: new MiniBatch(new THREE.DodecahedronGeometry(1, 0), mat()),
      post: new MiniBatch(new THREE.CylinderGeometry(1, 1, 1, 7), mat()),
    };
    const rnd = this.rnd;

    // --- shrine terrace (the hero prop, framed left of centre) ---
    const sx = -26, sz = -16, sy = 13;
    B.box.add(sx, sy + 0.5, sz, 22, 1.0, 18, 0x8f8c82);
    B.box.add(sx, sy + 1.05, sz, 21, 0.12, 17, 0xa39a86);
    let ly = sy + 1.1;
    for (let l = 0; l < 3; l++) {
      const s = 6.0 - l * 1.2;
      B.box.add(sx, ly + 1.7, sz, s * 2, 3.4, s * 2, l % 2 ? 0xdfd6bf : 0xe8e0cb);
      B.box.add(sx, ly + 3.3, sz, s * 2 + 0.2, 0.4, s * 2 + 0.2, 0x4a382a);
      B.roof.add(sx, ly + 4.6, sz, s * 1.75, 2.4, s * 1.75, 0xa9463a, Math.PI / 4);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        this._lantern(B, sx + Math.cos(a) * s * 1.5, ly + 3.2, sz + Math.sin(a) * s * 1.5, 0xffc46b);
      }
      ly += 5.2;
    }
    B.box.add(sx, ly + 1.2, sz, 0.9, 2.4, 0.9, 0xc9a227);
    this._lantern(B, sx, ly + 4.0, sz, 0xffe4a0);

    // Terrace pillars.
    for (let i = 0; i < 5; i++) {
      const px = sx - 16 + i * 8;
      B.box.add(px, sy + 4.5, sz + 15, 0.8, 7, 0.8, 0xb3ab98);
      this._lantern(B, px, sy + 9.5, sz + 15, 0xffb85c);
    }

    // --- torii in the water, silhouetted against the lake ---
    this._torii(B, 16, 1.0, 6, 0.5);
    this._torii(B, 30, 2.0, -8, -0.4);

    // --- stone lantern path leading toward the shrine ---
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const px = lerp(2, sx + 14, t) + Math.sin(t * 3) * 3;
      const pz = lerp(26, sz + 12, t);
      const py = this.height(px, pz);
      B.box.add(px, py + 0.9, pz, 0.5, 1.8, 0.5, 0x8b8478);
      B.box.add(px, py + 2.0, pz, 1.0, 0.5, 1.0, 0x9d9689);
      this._lantern(B, px, py + 2.7, pz, 0xffca7a, 0.36);
      B.roof.add(px, py + 3.4, pz, 1.0, 0.8, 1.0, 0x7a736a, Math.PI / 4);
    }

    // --- forest ---
    for (let i = 0; i < 320; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 20 + rnd() * 105;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = this.height(x, z);
      if (y < 2.0 || y > 60) continue;
      if (Math.hypot(x - 14, z - 6) < 24) continue;      // keep the lake clear
      if (Math.hypot(x + 26, z + 16) < 26) continue;     // and the terrace
      const sc = 0.9 + rnd() * 1.1;
      if (y > 26 || rnd() < 0.6) {
        const th = 4.5 * sc, fh = 9.5 * sc, fr = 2.6 * sc;
        B.trunk.add(x, y + th / 2, z, 0.55 * sc, th, 0.55 * sc, 0x59422f);
        for (let k = 0; k < 3; k++) {
          const kt = k / 3;
          B.pine.add(x, y + th * 0.6 + fh * kt * 0.72 + fh * 0.11, z,
            fr * (1 - kt * 0.3), fh * 0.5, fr * (1 - kt * 0.3),
            [0x2b6631, 0x347539, 0x3d8742][k], rnd() * 3);
        }
      } else {
        const th = 5.5 * sc, cr = 3.1 * sc;
        B.trunk.add(x, y + th / 2, z, 0.6 * sc, th, 0.6 * sc, 0x6b4f33);
        B.blob.add(x, y + th + cr * 0.5, z, cr, cr * 0.85, cr, 0x4e9a3c, rnd() * 3, rnd(), rnd());
        B.blob.add(x + cr * 0.5, y + th + cr * 0.15, z - cr * 0.3,
          cr * 0.6, cr * 0.55, cr * 0.6, 0x59ab44, rnd() * 3);
      }
    }

    // --- rocks + bamboo accents ---
    for (let i = 0; i < 180; i++) {
      const a = rnd() * Math.PI * 2, d = 8 + rnd() * 120;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = this.height(x, z);
      if (y < 0.5) continue;
      const s = 0.5 + rnd() * 2.4;
      B.rock.add(x, y + s * 0.4, z, s, s * 0.75, s * 0.9,
        rnd() < 0.5 ? 0x6f6a61 : 0x7d776c, rnd() * 3, rnd() * 0.4, rnd() * 0.4);
    }
    for (let i = 0; i < 90; i++) {
      const x = 30 + rnd() * 40, z = 20 + rnd() * 40;
      const y = this.height(x, z);
      if (y < 1.5) continue;
      const h = 10 + rnd() * 9;
      B.post.add(x, y + h / 2, z, 0.17, h, 0.17, 0x6fae3e);
      B.blob.add(x, y + h, z, 1.0, 1.4, 1.0, 0x7cc24a);
    }

    // --- distant peaks beyond the ridge, for depth ---
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
      const d = 175 + rnd() * 90;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = 60 + rnd() * 90;
      B.roof.add(x, h * 0.5 - 6, z, 34 + rnd() * 26, h, 34 + rnd() * 26,
        0x6d7f8c, rnd() * 3);
      B.roof.add(x, h - 6 - h * 0.11, z, (12 + rnd() * 8), h * 0.24, (12 + rnd() * 8),
        0xeef4f8, rnd() * 3);
    }

    for (const k in B) B[k].build(this.scene, k !== 'pine' && k !== 'blob');
  }

  _lantern(B, x, y, z, color, scale = 0.55) {
    B.post.add(x, y + 0.5, z, 0.05, 1.0, 0.05, 0x2a211c);
    const geo = new THREE.SphereGeometry(scale, 8, 6);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    this.scene.add(m);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: lanternGlowTexture(), color, transparent: true, opacity: 0.6,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(scale * 8, scale * 8, 1);
    m.add(halo);
    this.lanterns.push({ mesh: m, baseY: y, phase: this.rnd() * 6.28 });
  }

  _torii(B, x, y, z, rotY) {
    const w = 5.5, h = 10;
    const c = 0xc0392b, dark = 0x7d2318;
    const s = Math.sin(rotY), co = Math.cos(rotY);
    B.box.add(x + co * -w, y + h / 2, z - s * -w, 0.7, h, 0.7, c, rotY);
    B.box.add(x + co * w, y + h / 2, z - s * w, 0.7, h, 0.7, c, rotY);
    B.box.add(x, y + h, z, w * 2.8, 0.7, 1.0, dark, rotY);
    B.box.add(x, y + h - 1.8, z, w * 2.3, 0.5, 0.8, c, rotY);
  }

  /** A ninja frog posed on the terrace, idling and looking around. */
  _buildHero() {
    this.hero = new FrogModel(0x6cc24a, 'Frogshin', true);
    this.hero.root.position.set(-26, 14.1, 0.5);
    this.hero.root.scale.setScalar(1.35);
    this.hero.root.rotation.y = 0.5;
    this.scene.add(this.hero.root);
    this.heroTimer = 3;
    this.heroAttack = 0;
  }

  // ------------------------------------------------------------ camera path

  _buildCameraPath() {
    // A long, slow loop that shows the lake, the shrine and the ridge.
    this.path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(46, 26, 52),
      new THREE.Vector3(6, 20, 58),
      new THREE.Vector3(-34, 24, 40),
      new THREE.Vector3(-56, 30, 2),
      new THREE.Vector3(-40, 27, -40),
      new THREE.Vector3(2, 24, -52),
      new THREE.Vector3(44, 28, -34),
      new THREE.Vector3(62, 30, 8),
    ], true, 'catmullrom', 0.5);

    // The look-at target orbits a smaller, offset loop so the framing keeps
    // changing instead of the camera simply circling a fixed point.
    this.lookPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-16, 12, -6),
      new THREE.Vector3(6, 8, 4),
      new THREE.Vector3(-24, 16, -14),
      new THREE.Vector3(-30, 14, 0),
      new THREE.Vector3(-6, 10, 10),
      new THREE.Vector3(14, 6, 6),
    ], true, 'catmullrom', 0.5);

    this.pathT = 0;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this.updateCamera(0);
  }

  updateCamera(dt) {
    // ~90 seconds for a full loop: slow enough to feel cinematic.
    this.pathT = (this.pathT + dt / 90) % 1;
    this.path.getPointAt(this.pathT, this._camPos);
    this.lookPath.getPointAt((this.pathT * 0.7 + 0.15) % 1, this._camLook);

    // A gentle float on top of the spline.
    this._camPos.y += Math.sin(this.time * 0.35) * 1.4;
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);
    this.camera.rotateZ(Math.sin(this.time * 0.21) * 0.012);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt;
    this.updateCamera(dt);
    this.atmo.update(dt, this.camera.position);

    for (const l of this.lanterns) {
      l.mesh.position.y = l.baseY + Math.sin(this.time * 1.1 + l.phase) * 0.3;
    }

    // Water ripples.
    if (this.water) {
      const pos = this.water.geometry.attributes.position;
      const base = this.waterBase;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        pos.array[i * 3 + 1] =
          Math.sin(x * 0.13 + this.time * 1.3) * 0.22 +
          Math.sin(z * 0.17 - this.time * 0.9) * 0.18;
      }
      pos.needsUpdate = true;
    }

    // Hero frog: idles, and now and then hops or does a little flourish.
    this.heroTimer -= dt;
    if (this.heroTimer <= 0) {
      this.heroTimer = 4 + Math.random() * 5;
      if (Math.random() < 0.5) {
        this.hero.triggerFlip();
        this.hero.croak();
      } else {
        this.heroAttack = 0.35;
      }
    }
    if (this.heroAttack > 0) this.heroAttack -= dt;

    this.hero.root.rotation.y = 0.5 + Math.sin(this.time * 0.28) * 0.55;
    this.hero.update(dt, {
      speed: 0, vy: 0, grounded: true, moving: false,
      dashT: 0,
      attackT: this.heroAttack > 0 ? this.heroAttack / 0.35 : 0,
      attackIndex: 0,
      grappling: false, tongueTo: null, wallSliding: false, dead: false,
    });
  }

  dispose() {
    this.atmo.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.scene.clear();
  }
}
