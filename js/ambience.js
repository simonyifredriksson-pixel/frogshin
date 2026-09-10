/**
 * WHAT COLOUR THE LIGHT IS, per region.
 *
 * The sun in the Emberwaste is orange and the ground throws red back up at
 * you; the sun on the Frostmarch is blue-white and so is the bounce. Fog
 * colour and sun INTENSITY are the Overworld's (`_sky`); this is the other
 * half of it — the hue of the light itself, damped so a border is a couple of
 * seconds of the light changing round you rather than a cut.
 *
 * ── what used to be here, and why it is gone ──────────────────────────────
 * This module also drew volumetric light shafts and a swarm of drifting
 * fireflies. Both were removed on sight: they were BLINDING.
 *
 * The motes were the worse of the two, and the bug is worth writing down so
 * nobody re-introduces it. A `Points` sprite is sized in PIXELS, and the
 * shader sized them as `aSize * uPix / max(1.0, -mv.z)` — which for a mote one
 * unit from the camera is 24 × 360 ÷ 1, or an 8600-pixel additive sprite. The
 * swarm wraps inside a box centred on the camera, so there was always one a
 * metre from your face, and it filled the entire screen with solid gold.
 * Anything that sizes a point by distance needs a hard clamp AND a minimum
 * distance, and it needs to be looked at on a real screen before it ships.
 *
 * The shafts were the same class of mistake: forty-four additively-blended
 * quads whose group was parked at the camera position, so the camera was
 * inside all of them at once.
 *
 * A colour grade cannot do that to anybody. It only ever changes the HUE of
 * two lights that already exist; it never adds brightness, never draws a
 * surface, and costs nothing.
 */

import * as THREE from '../lib/three.module.js?v=v109';
import { clamp } from './util.js?v=v109';

/** Scratch colour for the cross-fade. Allocates nothing per frame. */
const _grade = new THREE.Color();

/**
 * The eight moods, and what the light does in each.
 *
 * Keyed by the region's own `music` mood, which every region already
 * declares — so a new region gets a light for free and the two can never
 * disagree about what kind of place it is.
 *
 *   sun     the sun's own colour
 *   bounce  the colour of the light coming back off the ground
 *   sky     the colour of the light coming down from the whole sky
 */
const MOODS = {
  calm: { sun: 0xfff2d6, bounce: 0x4a5a30, sky: 0xbfe0ff },
  wild: { sun: 0xf4f0c8, bounce: 0x40522a, sky: 0xb4d8f0 },
  grim: { sun: 0xc8d4c0, bounce: 0x2a3a2c, sky: 0x8fa8a0 },
  holy: { sun: 0xfff8e8, bounce: 0x6a6a58, sky: 0xd8e8ff },
  hot: { sun: 0xffc890, bounce: 0x5a2a18, sky: 0xffb890 },
  cold: { sun: 0xe8f4ff, bounce: 0x8fa8bc, sky: 0xcfe4ff },
  strange: { sun: 0xe0d0ff, bounce: 0x3a3050, sky: 0xb8a8e8 },
  dread: { sun: 0xffbca8, bounce: 0x3a1e1a, sky: 0x9a7a78 },
};
export const AMBIENCE_MOODS = Object.keys(MOODS);

export class Ambience {
  /**
   * @param scene kept only so the signature matches every other world system
   *              and a future effect has somewhere to go. Nothing is added
   *              to it — see the file header.
   */
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;
    this.mood = null;
    this.want = MOODS.calm;
    this.t = 0;
  }

  /**
   * Aim at a mood.
   *
   * @param immediate ignored for the grade, which damps to its target from
   *                  whatever the lights already are — there is nothing to
   *                  snap. Kept in the signature because the Overworld calls
   *                  it the same way it calls `Weather.set`.
   */
  set(mood, immediate = false) {
    this.want = MOODS[mood] || MOODS.calm;
    this.mood = mood;
    this._snap = !!immediate;
  }

  /**
   * Push the mood's colour into the scene's lights.
   *
   * Called with the Atmosphere's `sun` and `hemi`. Tolerates being handed
   * nothing, because the realm can be updated for a frame before the
   * atmosphere exists.
   */
  grade(dt, sun, hemi) {
    if (!this.enabled) return;
    const M = this.want;
    const k = this._snap ? 1 : clamp(dt * 0.9, 0, 1);
    this._snap = false;
    if (sun) sun.color.lerp(_grade.setHex(M.sun), k);
    if (hemi) {
      hemi.color.lerp(_grade.setHex(M.sky), k);
      hemi.groundColor.lerp(_grade.setHex(M.bounce), k);
    }
  }

  /** Nothing is drawn, so a frame costs a clock tick. */
  update(dt) { this.t += dt; }

  /** Nothing is drawn, so there is nothing to size to the screen. */
  setPixelHeight() {}

  setEnabled(on) { this.enabled = on; }

  /** Draw calls this costs. Zero, and that is the point. */
  get drawn() { return 0; }

  dispose() {}
}
