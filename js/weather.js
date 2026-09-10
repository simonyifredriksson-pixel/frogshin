/**
 * WEATHER — what falls out of each region's sky.
 *
 * One particle system for the whole world, retargeted as you cross a border
 * rather than rebuilt. Rain in the drowned capital, snow in the Frostmarch, a
 * blizzard in the Rimefang, ash over Cindermaw, sand in the Thirstlands,
 * spores in the Glimmerwood, leaves in Hollowroot Wood, and nothing at all in
 * the Lilyreach because the first place a player stands should be calm.
 *
 * ── why one system and not one per region ─────────────────────────────────
 * Building a fresh particle system at a region border means allocating a
 * buffer and uploading it in the frame the player crossed a line, which is a
 * hitch exactly when they are moving fastest. Instead there is one buffer of
 * `COUNT` particles for the life of the mode, and a border only changes the
 * NUMBERS: density, colour, size, fall speed, drift and turbulence, each
 * damped toward the new region's preset over about two seconds.
 *
 * ── how density can change without popping ────────────────────────────────
 * Every particle holds a fixed random threshold. It is drawn only while that
 * threshold is under the current density, so lowering the density retires
 * particles one at a time in a stable order instead of thinning the whole
 * field at once — and raising it brings the same ones back. A retired
 * particle is parked far below the world where nothing can see it.
 *
 * ── why the field follows the camera ──────────────────────────────────────
 * Weather is drawn in a box around the viewer and wraps: a particle that
 * leaves the box is respawned on the opposite face. That means the field
 * costs the same whether you are standing still or sprinting, and it never
 * runs out behind you.
 */

import * as THREE from '../lib/three.module.js?v=v105';
import { mulberry32, damp, clamp } from './util.js?v=v105';

/** How many particles exist. Density decides how many are drawn. */
const COUNT = 1100;
/** Half-extent of the box the field lives in, around the camera. */
const BOX = 46;
const BOX_Y = 34;

const VERT = `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Fade with distance so the far edge of the box does not read as a wall.
    vFade = 1.0 - clamp(-mv.z / 70.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * (300.0 / max(1.0, -mv.z));
  }
`;

const FRAG = `
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vColor, vFade * 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * The presets.
 *
 *   density   0..1, how much of the field is drawn
 *   fall      units per second downward
 *   drift     units per second sideways, along the wind
 *   swirl     how much the path wanders, so snow floats and rain does not
 *   size      point size in the shader's units
 *   colour    two colours; each particle picks between them
 *   spread    how far the field reaches horizontally, as a fraction of BOX
 */
export const WEATHER = {
  clear: { density: 0.00, fall: 0, drift: 0, swirl: 0, size: 1, colour: [0xffffff, 0xffffff] },
  rain: { density: 0.95, fall: 46, drift: 5, swirl: 0.1, size: 1.4, colour: [0x9fc4dd, 0xc8dcea] },
  fog: { density: 0.55, fall: 1.2, drift: 2.4, swirl: 1.6, size: 7.0, colour: [0xc0ccd0, 0xa8b8bc] },
  mist: { density: 0.40, fall: 0.8, drift: 1.6, swirl: 1.4, size: 6.0, colour: [0xd0e4ea, 0xb8d4dc] },
  snow: { density: 0.70, fall: 6.5, drift: 3.2, swirl: 2.2, size: 2.6, colour: [0xffffff, 0xe0eef8] },
  blizzard: { density: 1.00, fall: 16, drift: 26, swirl: 3.0, size: 2.8, colour: [0xffffff, 0xd8e8f4] },
  ash: { density: 0.72, fall: 4.5, drift: 3.0, swirl: 1.8, size: 2.4, colour: [0x6a6058, 0x2f2a28] },
  sand: { density: 0.85, fall: 3.0, drift: 30, swirl: 1.2, size: 2.2, colour: [0xe0cb96, 0xc4a878] },
  dust: { density: 0.45, fall: 2.0, drift: 9.0, swirl: 1.0, size: 2.0, colour: [0xc8bfa4, 0xa8a08c] },
  leaves: { density: 0.35, fall: 5.0, drift: 6.0, swirl: 2.6, size: 3.2, colour: [0x8fc44a, 0xc9a227] },
  spores: { density: 0.50, fall: 1.6, drift: 2.0, swirl: 2.4, size: 3.0, colour: [0x8fe8ff, 0xc0e8ff] },
  motes: { density: 0.42, fall: 0.6, drift: 1.2, swirl: 1.8, size: 2.4, colour: [0xcfe0ff, 0xffffff] },
};

export class Weather {
  constructor(scene) {
    this.scene = scene;
    const rnd = mulberry32(8317);

    this.pos = new Float32Array(COUNT * 3);
    this.col = new Float32Array(COUNT * 3);
    this.size = new Float32Array(COUNT);
    /** Each particle's fixed place in the density order. */
    this.threshold = new Float32Array(COUNT);
    /** Per-particle phase, so they do not all wander in step. */
    this.phase = new Float32Array(COUNT);
    this.pick = new Uint8Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      this.pos[i * 3] = (rnd() * 2 - 1) * BOX;
      this.pos[i * 3 + 1] = (rnd() * 2 - 1) * BOX_Y;
      this.pos[i * 3 + 2] = (rnd() * 2 - 1) * BOX;
      this.threshold[i] = rnd();
      this.phase[i] = rnd() * Math.PI * 2;
      this.pick[i] = rnd() < 0.5 ? 0 : 1;
      this.size[i] = 1;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    // A fixed, generous sphere: the field moves with the camera every frame
    // and recomputing bounds would be pure waste.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX * 2.4);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.name = 'weather';
    scene.add(this.points);
    this.geo = geo;

    // The live numbers, damped toward whatever region we are in.
    this.now = { density: 0, fall: 0, drift: 0, swirl: 0, size: 1 };
    this.target = WEATHER.clear;
    this.colA = new THREE.Color(0xffffff);
    this.colB = new THREE.Color(0xffffff);
    this.wantA = new THREE.Color(0xffffff);
    this.wantB = new THREE.Color(0xffffff);
    this.time = 0;
    this._wind = 1;
    this._colourDirty = true;
    this.set('clear', true);
  }

  /** Which weather to move toward. `immediate` snaps instead of easing. */
  set(kind, immediate = false) {
    const w = WEATHER[kind] || WEATHER.clear;
    if (this.kind === kind && !immediate) return;
    this.kind = kind;
    this.target = w;
    this.wantA.setHex(w.colour[0]);
    this.wantB.setHex(w.colour[1]);
    if (immediate) {
      this.now.density = w.density;
      this.now.fall = w.fall;
      this.now.drift = w.drift;
      this.now.swirl = w.swirl;
      this.now.size = w.size;
      this.colA.copy(this.wantA);
      this.colB.copy(this.wantB);
      this._colourDirty = true;
    }
  }

  /**
   * One frame.
   *
   * @param cameraPos where the box is centred
   * @param windDir   a THREE.Vector2 of the atmosphere's own wind, so the
   *                  rain and the clouds go the same way
   */
  update(dt, cameraPos, windDir) {
    if (!cameraPos) return;
    this.time += dt;
    const T = this.target;
    const n = this.now;
    // Two seconds to change the weather, which is about how long it takes to
    // walk out of one region's influence and into the next.
    n.density = damp(n.density, T.density, 0.9, dt);
    n.fall = damp(n.fall, T.fall, 1.2, dt);
    n.drift = damp(n.drift, T.drift, 1.2, dt);
    n.swirl = damp(n.swirl, T.swirl, 1.2, dt);
    const prevSize = n.size;
    n.size = damp(n.size, T.size, 1.2, dt);
    if (Math.abs(n.size - prevSize) > 0.002) this._colourDirty = true;

    const k = clamp(dt * 0.9, 0, 1);
    if (this.colA.getHex() !== this.wantA.getHex()
      || this.colB.getHex() !== this.wantB.getHex()) {
      this.colA.lerp(this.wantA, k);
      this.colB.lerp(this.wantB, k);
      this._colourDirty = true;
    }

    // Nothing is falling and nothing is drawn: skip the whole pass.
    if (n.density < 0.002) {
      if (this.points.visible) this.points.visible = false;
      return;
    }
    this.points.visible = true;

    if (this._colourDirty) {
      for (let i = 0; i < COUNT; i++) {
        const c = this.pick[i] ? this.colB : this.colA;
        this.col[i * 3] = c.r;
        this.col[i * 3 + 1] = c.g;
        this.col[i * 3 + 2] = c.b;
        this.size[i] = n.size;
      }
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this._colourDirty = false;
    }

    // Gusts, so sand and blizzards come in waves rather than at a constant
    // rate. Shared by the drift so the whole field leans together.
    this._wind = 0.7 + Math.sin(this.time * 0.5) * 0.25
      + Math.sin(this.time * 1.7) * 0.12;
    const wx = windDir ? windDir.x : 0.8;
    const wz = windDir ? windDir.y : 0.35;
    const cx = cameraPos.x, cy = cameraPos.y, cz = cameraPos.z;
    const p = this.pos;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      if (this.threshold[i] >= n.density) {
        // Retired. Park it a long way under the world.
        p[i3 + 1] = -9999;
        continue;
      }
      // A retired particle coming back has to be put somewhere sensible.
      if (p[i3 + 1] < -5000) {
        p[i3] = cx + (Math.random() * 2 - 1) * BOX;
        p[i3 + 1] = cy + BOX_Y * (Math.random() * 0.6 + 0.4);
        p[i3 + 2] = cz + (Math.random() * 2 - 1) * BOX;
      }
      const ph = this.phase[i] + this.time * 1.3;
      p[i3] += (wx * n.drift * this._wind + Math.sin(ph) * n.swirl) * dt;
      p[i3 + 1] -= n.fall * dt;
      p[i3 + 2] += (wz * n.drift * this._wind + Math.cos(ph * 0.8) * n.swirl) * dt;

      // Wrap the box round the camera, so the field never runs out.
      if (p[i3 + 1] < cy - BOX_Y) {
        p[i3 + 1] = cy + BOX_Y;
        p[i3] = cx + (Math.random() * 2 - 1) * BOX;
        p[i3 + 2] = cz + (Math.random() * 2 - 1) * BOX;
      } else if (p[i3 + 1] > cy + BOX_Y * 1.1) {
        p[i3 + 1] = cy - BOX_Y * 0.9;
      }
      const dx = p[i3] - cx;
      if (dx > BOX) p[i3] -= BOX * 2; else if (dx < -BOX) p[i3] += BOX * 2;
      const dz = p[i3 + 2] - cz;
      if (dz > BOX) p[i3 + 2] -= BOX * 2; else if (dz < -BOX) p[i3 + 2] += BOX * 2;
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  /** How much of the field is live, for the tests and the diagnostics. */
  get drawn() {
    let n = 0;
    for (let i = 0; i < COUNT; i++) if (this.threshold[i] < this.now.density) n++;
    return n;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}
