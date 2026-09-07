/**
 * LIGHT THROUGH THE TREES — the layer that makes a place feel like a place.
 *
 * Two effects and a colour grade, and between them they are most of the
 * difference between "a hillside with trees on it" and somewhere you want to
 * stand still and look at:
 *
 *   SHAFTS  soft volumetric beams slanting down along the sun's direction.
 *           Warm gold in the peaceful woods, sickly green in the corrupted
 *           ones, hard white on the snow, orange in the ash.
 *   MOTES   things drifting in the air and blinking: fireflies in the south,
 *           spores in the mire, embers over the lava, snow-glitter in the
 *           north, pale wisps where something is wrong.
 *   GRADE   the sun's own colour and the bounce off the ground, so the light
 *           in the Emberwaste is not the light in the Frostmarch with a
 *           different fog colour in front of it.
 *
 * ── one draw call each ────────────────────────────────────────────────────
 * The shafts are ONE mesh: every beam is quads in a single merged geometry,
 * and the whole thing drifts after the camera rather than being anchored to
 * the world. That is deliberate. Anchored beams have to be re-placed as the
 * player walks, which either pops or costs a rebuild; a slow drift reads as
 * light moving through moving branches and costs one position assignment.
 *
 * The motes are one `Points` with a per-particle phase, so they blink out of
 * step without a second buffer upload. Both fade their opacity to zero rather
 * than being removed, so a region change is a cross-fade and not a cut.
 */

import * as THREE from '../lib/three.module.js?v=v85';
import { clamp, damp, mulberry32 } from './util.js?v=v85';

/** Scratch colour for every cross-fade below. Allocates nothing per frame. */
const _grade = new THREE.Color();

/** How many beams, and how many motes at full density. */
const SHAFTS = 22;
const MOTES = 420;
/** The box the motes live in, centred on the camera. */
const BOX = 54;
const BOX_Y = 26;

/**
 * The eight moods, and what the air does in each.
 *
 * Keyed by the region's own `music` mood, which every region already
 * declares — so a new region gets an atmosphere for free and the two can
 * never disagree about what kind of place it is.
 *
 *   shaft   beam brightness, 0 for none
 *   beam    beam colour
 *   motes   how many things are in the air
 *   mote    their colour
 *   rise    how fast they drift up. Embers rise; fireflies mill; spores sink.
 *   blink   how sharply they pulse — fireflies blink, dust does not
 *   sun     the sun's own colour
 *   bounce  the colour of the light coming back off the ground
 *   sky     the colour of the light coming down from the whole sky
 */
const MOODS = {
  calm: {
    shaft: 0.30, beam: 0xffe8a8, motes: 300, mote: 0xfff0a0,
    rise: 0.25, blink: 1.0, sun: 0xfff2d6, bounce: 0x4a5a30, sky: 0xbfe0ff,
  },
  wild: {
    shaft: 0.24, beam: 0xdcf0a0, motes: 240, mote: 0xd8ff9a,
    rise: 0.15, blink: 0.8, sun: 0xf4f0c8, bounce: 0x40522a, sky: 0xb4d8f0,
  },
  grim: {
    shaft: 0.13, beam: 0x9ac4a0, motes: 200, mote: 0x9affc0,
    rise: -0.10, blink: 0.55, sun: 0xc8d4c0, bounce: 0x2a3a2c, sky: 0x8fa8a0,
  },
  holy: {
    shaft: 0.40, beam: 0xfff8e0, motes: 150, mote: 0xfff8d8,
    rise: 0.30, blink: 0.35, sun: 0xfff8e8, bounce: 0x6a6a58, sky: 0xd8e8ff,
  },
  hot: {
    shaft: 0.28, beam: 0xffa860, motes: 320, mote: 0xff9a3c,
    rise: 1.30, blink: 0.9, sun: 0xffc890, bounce: 0x5a2a18, sky: 0xffb890,
  },
  cold: {
    shaft: 0.20, beam: 0xdff0ff, motes: 260, mote: 0xeaf8ff,
    rise: -0.35, blink: 0.4, sun: 0xe8f4ff, bounce: 0x8fa8bc, sky: 0xcfe4ff,
  },
  strange: {
    shaft: 0.26, beam: 0xc0a0ff, motes: 280, mote: 0xc9a0ff,
    rise: 0.20, blink: 1.0, sun: 0xe0d0ff, bounce: 0x3a3050, sky: 0xb8a8e8,
  },
  dread: {
    shaft: 0.10, beam: 0xff8a70, motes: 130, mote: 0xff6a4a,
    rise: 0.45, blink: 0.7, sun: 0xffbca8, bounce: 0x3a1e1a, sky: 0x9a7a78,
  },
};
export const AMBIENCE_MOODS = Object.keys(MOODS);

// ═══════════════════════════════════════════════════════════════ shafts ══

/**
 * Build every beam into one geometry.
 *
 * Each beam is two quads crossed at right angles, which is what stops it
 * vanishing when you walk around it — a single quad is invisible edge-on, and
 * a beam of light that disappears when you turn your head is worse than no
 * beam at all. `uv.y` runs 0 at the bottom to 1 at the top and the shader
 * fades both ends; `aSeed` gives each beam its own brightness and flicker.
 */
function shaftGeometry(rnd) {
  const quads = SHAFTS * 2;
  const pos = new Float32Array(quads * 6 * 3);
  const uv = new Float32Array(quads * 6 * 2);
  const seed = new Float32Array(quads * 6);
  let p = 0, t = 0, s = 0;
  const vert = (x, y, z, u, v, sd) => {
    pos[p++] = x; pos[p++] = y; pos[p++] = z;
    uv[t++] = u; uv[t++] = v;
    seed[s++] = sd;
  };
  for (let i = 0; i < SHAFTS; i++) {
    // Spread across the view, not in a ring: a beam behind you is wasted.
    const x = (rnd() - 0.5) * 96;
    const z = (rnd() - 0.5) * 96;
    const w = 1.4 + rnd() * 4.2;
    const h = 34 + rnd() * 30;
    const sd = rnd();
    // The beams lean, and they all lean the same way, because they are all
    // coming from the same sun.
    const lean = 0.34;
    for (let q = 0; q < 2; q++) {
      const c = q === 0 ? 1 : 0, k = q === 0 ? 0 : 1;
      const ax = w * c, az = w * k;
      const x0 = x - ax, z0 = z - az, x1 = x + ax, z1 = z + az;
      const tx = h * lean;
      vert(x0, 0, z0, 0, 0, sd);
      vert(x1, 0, z1, 1, 0, sd);
      vert(x1 + tx, h, z1, 1, 1, sd);
      vert(x0, 0, z0, 0, 0, sd);
      vert(x1 + tx, h, z1, 1, 1, sd);
      vert(x0 + tx, h, z0, 0, 1, sd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  return g;
}

const SHAFT_VERT = `
attribute float aSeed;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Fade at both ends, and across the width.
 *
 * The width fade is the one that matters: a hard-edged rectangle of light
 * reads as a sheet of paper, and the same rectangle with its edges taken off
 * reads as air. The slow flicker on top is branches moving.
 */
const SHAFT_FRAG = `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
void main() {
  float edge = sin(vUv.x * 3.14159);
  float top = smoothstep(1.0, 0.55, vUv.y);
  float bottom = smoothstep(0.0, 0.30, vUv.y);
  float flick = 0.72 + 0.28 * sin(uTime * 0.6 + vSeed * 31.4);
  float a = edge * edge * top * bottom * flick * uStrength * (0.55 + vSeed * 0.7);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ════════════════════════════════════════════════════════════════ motes ══

const MOTE_VERT = `
attribute float aPhase;
attribute float aSize;
uniform float uTime;
uniform float uBlink;
uniform float uPix;
uniform float uDensity;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Blink out of step, and the sharpness of the blink is the mood's.
  float b = sin(uTime * 2.1 + aPhase * 6.28318);
  vA = mix(0.85, max(0.0, b), uBlink);
  // Density is a threshold rather than a count, so turning it down does not
  // shuffle which particles exist — the same ones simply stop being drawn.
  if (aPhase > uDensity) { vA = 0.0; }
  gl_PointSize = aSize * uPix / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const MOTE_FRAG = `
uniform vec3 uColor;
uniform float uStrength;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.04, r) * vA * uStrength;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Ambience {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.enabled = opts.enabled === undefined ? true : !!opts.enabled;
    this.t = 0;
    const rnd = mulberry32(0x5eed1e);

    // ---- shafts ----------------------------------------------------------
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(MOODS.calm.beam) },
        uStrength: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.shafts = new THREE.Mesh(shaftGeometry(rnd), this.shaftMat);
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 3;
    this.shafts.visible = false;
    scene.add(this.shafts);

    // ---- motes -----------------------------------------------------------
    const pos = new Float32Array(MOTES * 3);
    const phase = new Float32Array(MOTES);
    const size = new Float32Array(MOTES);
    this.vel = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      pos[i * 3] = (rnd() - 0.5) * BOX * 2;
      pos[i * 3 + 1] = rnd() * BOX_Y;
      pos[i * 3 + 2] = (rnd() - 0.5) * BOX * 2;
      // A drift each, so the swarm never moves as one body.
      this.vel[i * 3] = (rnd() - 0.5) * 0.9;
      this.vel[i * 3 + 1] = (rnd() - 0.5) * 0.5;
      this.vel[i * 3 + 2] = (rnd() - 0.5) * 0.9;
      phase[i] = rnd();
      size[i] = 24 + rnd() * 46;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(MOODS.calm.mote) },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uBlink: { value: 1 },
        uDensity: { value: 0 },
        uPix: { value: 1 },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 4;
    this.motes.visible = false;
    scene.add(this.motes);
    this.pos = pos;

    this.mood = null;
    /** What we are damping toward. */
    this.want = MOODS.calm;
    this.rise = 0.25;
    this._colBeam = new THREE.Color(MOODS.calm.beam);
    this._colMote = new THREE.Color(MOODS.calm.mote);
    this._drift = new THREE.Vector3();
    this._first = true;
  }

  /**
   * Aim at a mood.
   *
   * @param immediate skip the cross-fade — for entering the world, where
   *                  there is nothing to fade FROM and a two-second ramp just
   *                  looks like the effect switching on late.
   */
  set(mood, immediate = false) {
    const M = MOODS[mood] || MOODS.calm;
    if (this.want === M && !immediate) return;
    this.want = M;
    this.mood = mood;
    if (!immediate) return;
    this._colBeam.setHex(M.beam);
    this._colMote.setHex(M.mote);
    this.shaftMat.uniforms.uColor.value.copy(this._colBeam);
    this.moteMat.uniforms.uColor.value.copy(this._colMote);
    this.shaftMat.uniforms.uStrength.value = M.shaft;
    this.moteMat.uniforms.uStrength.value = 1;
    this.moteMat.uniforms.uDensity.value = M.motes / MOTES;
    this.moteMat.uniforms.uBlink.value = M.blink;
    this.rise = M.rise;
  }

  /**
   * Push the mood's colour grade into the scene's lights.
   *
   * Separate from `set` because it writes to somebody else's object, and the
   * Overworld already owns the damping of everything else about the sky. Call
   * it with the Atmosphere's `sun` and `hemi`.
   */
  grade(dt, sun, hemi) {
    const M = this.want;
    const k = clamp(dt * 0.9, 0, 1);
    if (sun) sun.color.lerp(_grade.setHex(M.sun), k);
    if (hemi) {
      hemi.color.lerp(_grade.setHex(M.sky), k);
      hemi.groundColor.lerp(_grade.setHex(M.bounce), k);
    }
  }

  /**
   * One frame.
   *
   * @param sunDir which way the light is coming from, so the beams lean with
   *               it rather than in whatever direction they were authored.
   */
  update(dt, cameraPos, sunDir, windDir) {
    if (!this.enabled) return;
    this.t += dt;
    const M = this.want;

    // ---- cross-fade -----------------------------------------------------
    const k = clamp(dt * 0.9, 0, 1);
    const su = this.shaftMat.uniforms;
    const mu = this.moteMat.uniforms;
    su.uTime.value = this.t;
    mu.uTime.value = this.t;
    this._colBeam.lerp(_grade.setHex(M.beam), k);
    this._colMote.lerp(_grade.setHex(M.mote), k);
    su.uColor.value.copy(this._colBeam);
    mu.uColor.value.copy(this._colMote);
    su.uStrength.value = damp(su.uStrength.value, M.shaft, 1.1, dt);
    mu.uDensity.value = damp(mu.uDensity.value, M.motes / MOTES, 1.1, dt);
    mu.uStrength.value = damp(mu.uStrength.value, 1, 1.5, dt);
    mu.uBlink.value = damp(mu.uBlink.value, M.blink, 1.1, dt);
    this.rise = damp(this.rise, M.rise, 1.1, dt);
    this.shafts.visible = su.uStrength.value > 0.004;
    this.motes.visible = mu.uDensity.value > 0.004;

    // ---- the beams drift after you --------------------------------------
    /**
     * Not anchored, and not welded to the camera either.
     *
     * Welded, they slide with you and read as a decal on the lens. Anchored,
     * they have to be re-placed as you walk, which pops. Trailing at a fifth
     * of a unit per second gives parallax while you move and settles when you
     * stop, which is exactly what light through branches does.
     */
    const s = this.shafts.position;
    if (this._first) { s.copy(cameraPos); this._first = false; }
    s.x = damp(s.x, cameraPos.x, 0.5, dt);
    s.z = damp(s.z, cameraPos.z, 0.5, dt);
    s.y = damp(s.y, cameraPos.y - 6, 1.2, dt);
    if (sunDir) {
      // Face the beams into the sun's bearing, so they come from where the
      // light does.
      this.shafts.rotation.y = Math.atan2(sunDir.x, sunDir.z);
    }

    // ---- the motes drift, and wrap ---------------------------------------
    const pos = this.pos;
    const wx = windDir ? windDir.x : 0.4;
    const wz = windDir ? windDir.y : 0.2;
    for (let i = 0; i < MOTES; i++) {
      const i3 = i * 3;
      const ph = this.t * 0.7 + i;
      pos[i3] += (this.vel[i3] + Math.sin(ph) * 0.5 + wx * 0.6) * dt;
      pos[i3 + 1] += (this.vel[i3 + 1] + this.rise * 2.2) * dt;
      pos[i3 + 2] += (this.vel[i3 + 2] + Math.cos(ph * 0.8) * 0.5 + wz * 0.6) * dt;
      // Wrap into the box around the camera, in world space.
      const dx = pos[i3] - cameraPos.x;
      const dz = pos[i3 + 2] - cameraPos.z;
      if (dx > BOX) pos[i3] -= BOX * 2; else if (dx < -BOX) pos[i3] += BOX * 2;
      if (dz > BOX) pos[i3 + 2] -= BOX * 2;
      else if (dz < -BOX) pos[i3 + 2] += BOX * 2;
      const dy = pos[i3 + 1] - cameraPos.y;
      if (dy > BOX_Y) pos[i3 + 1] -= BOX_Y * 1.6;
      else if (dy < -BOX_Y * 0.6) pos[i3 + 1] += BOX_Y * 1.6;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
  }

  /** Everything off. For a cutscene, or a boss arena that wants the air. */
  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.shafts.visible = false; this.motes.visible = false; }
  }

  /** Screen height, for the point size. Called on resize. */
  setPixelHeight(h) { this.moteMat.uniforms.uPix.value = Math.max(1, h) * 0.5; }

  /** How many draw calls this is costing right now. */
  get drawn() {
    return (this.shafts.visible ? 1 : 0) + (this.motes.visible ? 1 : 0);
  }

  dispose() {
    this.scene.remove(this.shafts);
    this.scene.remove(this.motes);
    this.shafts.geometry.dispose();
    this.motes.geometry.dispose();
    this.shaftMat.dispose();
    this.moteMat.dispose();
  }
}
