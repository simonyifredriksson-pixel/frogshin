/**
 * Visual effects.
 *
 * All particles live in two pooled THREE.Points systems (one additive for
 * sparks/energy, one alpha-blended for dust/smoke), so the entire effect
 * layer costs two draw calls no matter how much is happening on screen.
 * Meshes for slash arcs, shockwave rings and damage numbers are pooled too —
 * nothing is allocated during gameplay.
 */

import * as THREE from '../lib/three.module.js?v=v58';
import { clamp } from './util.js?v=v58';

const VERT = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

// The two trailing includes matter: a ShaderMaterial does not get tone
// mapping or the linear->sRGB output conversion unless it asks for them, and
// without them particles render noticeably brighter than the lit scene.
const FRAG = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = smoothstep(0.25, 0.02, d);
    gl_FragColor = vec4(vColor, vAlpha * a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.geo = g;
  }

  spawn(x, y, z, vx, vy, vz, r, g_, b, size, life, gravity, drag) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = (this._rr = ((this._rr || 0) + 1) % this.max);   // recycle oldest-ish

    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = r; this.col[i3 + 1] = g_; this.col[i3 + 2] = b;
    this.size[i] = size; this.size0[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = gravity; this.drag[i] = drag;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // Swap-remove keeps the live particles packed at the front of the
        // buffer, so the draw range is always exactly the live count.
        const last = --n;
        if (i !== last) {
          const a = i * 3, b = last * 3;
          for (let k = 0; k < 3; k++) {
            this.pos[a + k] = this.pos[b + k];
            this.vel[a + k] = this.vel[b + k];
            this.col[a + k] = this.col[b + k];
          }
          this.size[i] = this.size[last];
          this.size0[i] = this.size0[last];
          this.alpha[i] = this.alpha[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last];
        }
        i--;
        continue;
      }
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t * t;
      this.size[i] = this.size0[i] * (0.35 + t * 0.65);
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    if (n > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------

const _col = new THREE.Color();

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.spark = new ParticlePool(scene, 700, true);
    this.dust = new ParticlePool(scene, 500, false);

    this._initArcs();
    this._initRings();
    this._initNumbers();
    this.time = 0;
  }

  // -------------------------------------------------------------- slash arc

  _initArcs() {
    // A crescent built once and reused; scaled/oriented per swing.
    const shape = new THREE.BufferGeometry();
    const segs = 20, inner = 0.55, outer = 1.0, span = 2.5;
    const verts = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const a = -span / 2 + (i / segs) * span;
      // Taper the crescent toward its ends for a blade-like sweep.
      const taper = Math.sin((i / segs) * Math.PI);
      verts.push(Math.cos(a) * inner, 0, Math.sin(a) * inner);
      verts.push(Math.cos(a) * (inner + (outer - inner) * taper), 0,
        Math.sin(a) * (inner + (outer - inner) * taper));
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    shape.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    shape.setIndex(idx);

    this.arcs = [];
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(shape, mat);
      m.visible = false;
      m.renderOrder = 11;
      this.scene.add(m);
      this.arcs.push({ mesh: m, t: 0, dur: 0.22, roll: 0 });
    }
    this._arcIdx = 0;
  }

  /**
   * Spawn a katana slash crescent.
   * @param pos world position of the swing centre
   * @param yaw facing
   * @param index combo index (changes the roll of the arc)
   */
  slashArc(pos, yaw, index = 0, color = 0xdff3ff, scale = 3.0) {
    const a = this.arcs[this._arcIdx = (this._arcIdx + 1) % this.arcs.length];
    a.mesh.visible = true;
    a.mesh.position.copy(pos);
    a.mesh.scale.setScalar(scale);
    a.t = 0;
    a.dur = index === 2 ? 0.28 : 0.2;
    a.mesh.material.color.setHex(color);
    // Horizontal, reversed horizontal, then a vertical downward cut.
    if (index === 0) a.mesh.rotation.set(0.25, yaw + 0.5, 0.35);
    else if (index === 1) a.mesh.rotation.set(0.25, yaw - 0.5, -0.35);
    else a.mesh.rotation.set(Math.PI / 2 - 0.15, yaw, Math.PI / 2);
    a.dir = index === 1 ? -1 : 1;
    a.baseYaw = a.mesh.rotation.y;
  }

  // ----------------------------------------------------------- shock rings

  _initRings() {
    const geo = new THREE.RingGeometry(0.72, 1.0, 28);
    geo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 11;
      this.scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 0.4, from: 1, to: 4, flat: true });
    }
    this._ringIdx = 0;
  }

  /** Expanding ring. `flat=false` orients it to face `dir` (dash cone). */
  ring(pos, from, to, dur, color, flat = true, dir = null) {
    const r = this.rings[this._ringIdx = (this._ringIdx + 1) % this.rings.length];
    r.mesh.visible = true;
    r.mesh.position.copy(pos);
    r.mesh.material.color.setHex(color);
    r.t = 0; r.dur = dur; r.from = from; r.to = to;
    if (flat || !dir) {
      r.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    } else {
      // Face along the travel direction.
      r.mesh.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
      r.mesh.rotateX(Math.PI / 2);
    }
    return r;
  }

  // -------------------------------------------------------- damage numbers

  _initNumbers() {
    this.numbers = [];
    for (let i = 0; i < 16; i++) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false,
      }));
      spr.visible = false;
      spr.renderOrder = 20;
      this.scene.add(spr);
      this.numbers.push({ spr, canvas: c, tex, t: 0, dur: 1.0, vy: 3 });
    }
    this._numIdx = 0;
  }

  /**
   * Floating damage readout.
   * @param duration seconds on screen. Training dummies use a very short
   *                 0.2s flash; combat hits linger about a second.
   */
  damageNumber(pos, amount, crit = false, duration = 1.05) {
    const n = this.numbers[this._numIdx = (this._numIdx + 1) % this.numbers.length];
    const ctx = n.canvas.getContext('2d');
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = crit ? 'bold 46px "Courier New", monospace' : 'bold 36px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(String(Math.round(amount)), 64, 32);
    ctx.fillStyle = crit ? '#ffd24a' : '#ff6b5a';
    ctx.fillText(String(Math.round(amount)), 64, 32);
    n.tex.needsUpdate = true;

    n.spr.visible = true;
    n.spr.position.copy(pos);
    n.spr.position.x += (Math.random() - 0.5) * 0.8;
    n.spr.scale.set(crit ? 2.4 : 1.8, crit ? 1.2 : 0.9, 1);
    n.t = 0;
    n.dur = duration;
    // Short flashes barely drift; long ones arc up and away.
    n.vy = duration < 0.4 ? 1.2 : 3.4 + Math.random();
    n.vx = duration < 0.4 ? 0 : (Math.random() - 0.5) * 1.6;
  }

  // ---------------------------------------------------------------- bursts

  _rgb(hex) { _col.setHex(hex); return _col; }

  /** Ground dust puff — landings, footsteps, sliding. */
  dustPuff(pos, amount = 8, power = 2.4, color = 0xbfae8f) {
    const c = this._rgb(color);
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * power;
      this.dust.spawn(
        pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.08, pos.z + (Math.random() - 0.5) * 0.6,
        Math.cos(a) * s, 0.7 + Math.random() * 1.6, Math.sin(a) * s,
        c.r, c.g, c.b,
        0.34 + Math.random() * 0.4, 0.45 + Math.random() * 0.5, -1.2, 2.6
      );
    }
  }

  /** Trailing energy left behind a dash. */
  dashTrail(pos, dir, color = 0x8ce8ff) {
    const c = this._rgb(color);
    for (let i = 0; i < 3; i++) {
      this.spark.spawn(
        pos.x + (Math.random() - 0.5) * 0.7,
        pos.y + 0.6 + Math.random() * 0.9,
        pos.z + (Math.random() - 0.5) * 0.7,
        -dir.x * 5 + (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 2.4,
        -dir.z * 5 + (Math.random() - 0.5) * 3,
        c.r, c.g, c.b,
        0.28 + Math.random() * 0.26, 0.25 + Math.random() * 0.22, -1.0, 3.5
      );
    }
  }

  /**
   * Wake left behind a sprinting frog: pale streaks peeling off the body
   * plus a little ground dust, so the speed reads from outside too.
   */
  sprintTrail(pos, dir) {
    for (let i = 0; i < 2; i++) {
      this.spark.spawn(
        pos.x + (Math.random() - 0.5) * 0.9,
        pos.y + 0.45 + Math.random() * 1.05,
        pos.z + (Math.random() - 0.5) * 0.9,
        -dir.x * (5 + Math.random() * 5) + (Math.random() - 0.5) * 1.6,
        0.5 + Math.random() * 1.4,
        -dir.z * (5 + Math.random() * 5) + (Math.random() - 0.5) * 1.6,
        0.82, 0.93, 1.0,
        0.14 + Math.random() * 0.18, 0.16 + Math.random() * 0.14, 1.2, 2.2
      );
    }
    if (Math.random() < 0.5) {
      this.dust.spawn(
        pos.x + (Math.random() - 0.5) * 0.5, pos.y + 0.08, pos.z + (Math.random() - 0.5) * 0.5,
        -dir.x * 3.2, 1.0 + Math.random(), -dir.z * 3.2,
        0.78, 0.72, 0.60,
        0.26 + Math.random() * 0.26, 0.3 + Math.random() * 0.25, -1.4, 2.6
      );
    }
  }

  /** Big directional burst at the start of a dash. */
  dashBurst(pos, dir, color = 0x8ce8ff) {
    const c = this._rgb(color);
    for (let i = 0; i < 26; i++) {
      const spread = 0.55;
      this.spark.spawn(
        pos.x, pos.y + 0.9, pos.z,
        -dir.x * (7 + Math.random() * 10) + (Math.random() - 0.5) * 9 * spread,
        (Math.random() - 0.4) * 6,
        -dir.z * (7 + Math.random() * 10) + (Math.random() - 0.5) * 9 * spread,
        c.r, c.g, c.b,
        0.3 + Math.random() * 0.4, 0.28 + Math.random() * 0.3, -3, 3.0
      );
    }
    const p = new THREE.Vector3(pos.x, pos.y + 0.9, pos.z);
    this.ring(p, 0.4, 3.6, 0.32, color, false, dir);
  }

  /** Sparks + blood-free "impact" hit burst. */
  hitBurst(pos, dir, heavy = false) {
    const n = heavy ? 30 : 18;
    for (let i = 0; i < n; i++) {
      const sp = (heavy ? 11 : 7) * (0.4 + Math.random());
      const a = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.3) * 1.4;
      // Bias the spray along the attack direction.
      const vx = dir.x * sp * 0.7 + Math.cos(a) * sp * 0.55;
      const vy = Math.sin(el) * sp * 0.7 + 2.5;
      const vz = dir.z * sp * 0.7 + Math.sin(a) * sp * 0.55;
      const warm = Math.random() < 0.5;
      this.spark.spawn(pos.x, pos.y, pos.z, vx, vy, vz,
        warm ? 1.0 : 1.0, warm ? 0.85 : 0.55, warm ? 0.4 : 0.25,
        0.26 + Math.random() * 0.3, 0.24 + Math.random() * 0.28, -14, 1.6);
    }
    this.ring(pos, 0.3, heavy ? 3.2 : 2.2, 0.24, 0xfff0c0, false, dir);
  }

  /** Green frog-splat poof on death. */
  deathBurst(pos, color = 0x6cc24a) {
    const c = this._rgb(color);
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI - Math.PI / 2;
      const sp = 4 + Math.random() * 11;
      this.spark.spawn(
        pos.x, pos.y + 0.9, pos.z,
        Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + 4, Math.sin(a) * Math.cos(el) * sp,
        c.r, c.g, c.b,
        0.35 + Math.random() * 0.45, 0.7 + Math.random() * 0.6, -13, 1.1
      );
    }
    this.dustPuff(pos, 16, 4, 0x9aa88a);
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), 0.5, 6, 0.5, 0x9cff7d, true);
  }

  respawnBurst(pos, color = 0x9cff7d) {
    const c = this._rgb(color);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      this.spark.spawn(
        pos.x + Math.cos(a) * 1.5, pos.y + 0.1, pos.z + Math.sin(a) * 1.5,
        Math.cos(a) * 1.2, 5 + Math.random() * 5, Math.sin(a) * 1.2,
        c.r, c.g, c.b, 0.3 + Math.random() * 0.3, 0.7, -3, 1.2
      );
    }
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.2, pos.z), 0.4, 5, 0.55, color, true);
  }

  /** Splash when something enters water. */
  splash(pos) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 4;
      this.spark.spawn(pos.x, pos.y, pos.z,
        Math.cos(a) * s, 4 + Math.random() * 5, Math.sin(a) * s,
        0.55, 0.8, 0.95, 0.24 + Math.random() * 0.24, 0.55, -16, 1.0);
    }
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.05, pos.z), 0.4, 4.5, 0.5, 0x9fd8f0, true);
  }

  /**
   * A burning building or bonfire. Emits flame, smoke and the occasional
   * ember; called repeatedly from the story level for each active fire.
   */
  fire(x, y, z, size = 1) {
    const s = size;
    // Flame core — hot, fast, short-lived.
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.7 * s;
      const warm = Math.random();
      this.spark.spawn(
        x + Math.cos(a) * r, y + Math.random() * 0.4 * s, z + Math.sin(a) * r,
        (Math.random() - 0.5) * 0.9, 2.6 + Math.random() * 3.0 * s, (Math.random() - 0.5) * 0.9,
        1.0, 0.42 + warm * 0.42, 0.10 + warm * 0.14,
        (0.34 + Math.random() * 0.4) * s, 0.42 + Math.random() * 0.35,
        3.4, 1.5
      );
    }
    // Smoke, drifting and expanding.
    if (Math.random() < 0.55) {
      this.dust.spawn(
        x + (Math.random() - 0.5) * s, y + 1.1 * s, z + (Math.random() - 0.5) * s,
        (Math.random() - 0.2) * 1.4, 2.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.4,
        0.16, 0.15, 0.15,
        (0.8 + Math.random() * 0.9) * s, 1.5 + Math.random(), 1.1, 0.5
      );
    }
    // Rising embers.
    if (Math.random() < 0.22) {
      this.spark.spawn(
        x + (Math.random() - 0.5) * 1.4 * s, y + 0.6, z + (Math.random() - 0.5) * 1.4 * s,
        (Math.random() - 0.5) * 2.4, 3.5 + Math.random() * 3.5, (Math.random() - 0.5) * 2.4,
        1.0, 0.7, 0.25, 0.12 + Math.random() * 0.12, 1.6 + Math.random(), 1.4, 0.7
      );
    }
  }

  /** Bubbles rising off a swimming frog. */
  bubbles(pos, amount = 3) {
    for (let i = 0; i < amount; i++) {
      this.spark.spawn(
        pos.x + (Math.random() - 0.5) * 0.7,
        pos.y + 0.9 + Math.random() * 0.6,
        pos.z + (Math.random() - 0.5) * 0.7,
        (Math.random() - 0.5) * 0.9,
        1.6 + Math.random() * 2.2,          // buoyant, so they rise
        (Math.random() - 0.5) * 0.9,
        0.72, 0.90, 1.0,
        0.12 + Math.random() * 0.2, 0.8 + Math.random() * 0.7,
        3.0,                                 // positive "gravity" = upward drift
        0.8
      );
    }
  }

  /** Sticky green burst where the tongue lands. */
  tongueImpact(pos) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this.spark.spawn(pos.x, pos.y, pos.z,
        Math.cos(a) * s, Math.random() * 3, Math.sin(a) * s,
        1.0, 0.55, 0.68, 0.2 + Math.random() * 0.2, 0.3, -9, 2.0);
    }
    this.ring(pos, 0.2, 1.6, 0.25, 0xff9ec0, false, new THREE.Vector3(0, 1, 0));
  }

  /** Small anticipation flare, e.g. wall jumps. */
  puff(pos, color = 0xffffff, n = 10, speed = 4) {
    const c = this._rgb(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed;
      this.spark.spawn(pos.x, pos.y, pos.z,
        Math.cos(a) * s, (Math.random() - 0.3) * speed, Math.sin(a) * s,
        c.r, c.g, c.b, 0.22 + Math.random() * 0.25, 0.3, -6, 2.4);
    }
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    this.time += dt;
    this.spark.update(dt);
    this.dust.update(dt);

    for (const a of this.arcs) {
      if (!a.mesh.visible) continue;
      a.t += dt;
      const k = a.t / a.dur;
      if (k >= 1) { a.mesh.visible = false; continue; }
      // Sweep the crescent through its arc while it fades.
      a.mesh.rotation.y = a.baseYaw + a.dir * k * 1.5;
      a.mesh.material.opacity = (1 - k) * (1 - k) * 0.9;
      a.mesh.scale.setScalar(a.mesh.scale.x * (1 + dt * 1.2));
    }

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);      // ease-out expansion
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * e);
      r.mesh.material.opacity = (1 - k) * 0.85;
    }

    for (const n of this.numbers) {
      if (!n.spr.visible) continue;
      n.t += dt;
      const k = n.t / n.dur;
      if (k >= 1) { n.spr.visible = false; continue; }
      n.spr.position.y += n.vy * dt;
      n.spr.position.x += n.vx * dt;
      n.vy -= 4.5 * dt;
      n.spr.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }
}
