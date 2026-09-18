/**
 * Third-person follow camera.
 *
 * Responsibilities: mouse-driven orbit, smoothed follow, wall avoidance so
 * the camera never clips into geometry, speed-reactive FOV, and trauma-based
 * screen shake used by every impactful action in the game.
 */

import * as THREE from '../lib/three.module.js?v=v153';
import { CFG } from './config.js?v=v153';
import { clamp, damp, lerp } from './util.js?v=v153';

const _desired = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class FollowCamera {
  constructor(camera, collision) {
    this.cam = camera;
    this.collision = collision;
    this.yaw = 0;
    this.pitch = -0.12;
    this.distance = CFG.camera.distance;
    this.currentDistance = CFG.camera.distance;
    this.pos = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.trauma = 0;             // 0..1, decays; shake scales with trauma^2
    this.shakeTime = 0;
    this.baseFov = CFG.camera.fov;
    this.fovBoost = 0;
    this.initialised = false;
    this.rollTarget = 0;
    this.roll = 0;
    this.punch = 0;              // extra distance from punchOut(), decaying
    this.punchDecay = 1;
    // Overdrive's 0.3s impact shake — its own clock, see impact().
    this.impactTime = 0;
    this.impactDuration = 0.3;
    this.impactStrength = 0;
  }

  /** Feed accumulated mouse delta. */
  look(dx, dy) {
    this.yaw -= dx * CFG.camera.sensitivity;
    this.pitch -= dy * CFG.camera.sensitivity;
    this.pitch = clamp(this.pitch, CFG.camera.pitchMin, CFG.camera.pitchMax);
    // Keep yaw bounded so it never loses float precision in a long session.
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** Add screen shake. `amount` is roughly 0..1. */
  shake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /**
   * A time-boxed IMPACT: heavy hit, smooth return, done.
   *
   * Overdrive's high-speed katana connect. It is a separate channel from
   * `trauma` on purpose — trauma is an accumulating pool that decays at a
   * fixed rate, so asking it for "exactly 0.3 seconds" means computing an
   * amount from the decay constant and hoping nothing else adds to the pool
   * in the meantime. This owns its own clock and always lasts exactly
   * `duration`.
   *
   * The envelope is (1 - t)², which is what makes it SMOOTH rather than
   * jittery: it starts at full strength and arrives at zero with zero
   * slope, so the camera settles instead of snapping back. The offsets are
   * layered sines like the trauma shake — deliberately not random noise,
   * which reads as a rattle and is the thing that makes shake nauseating.
   */
  impact(duration, strength = 1) {
    // A stronger hit replaces a weaker one in flight rather than adding, so
    // two fast kills in a row cannot stack into something unreadable.
    if (this.impactTime > 0 && this.impactStrength > strength) return;
    this.impactDuration = Math.max(0.05, duration || 0.3);
    this.impactTime = this.impactDuration;
    this.impactStrength = strength;
  }

  /**
   * Throw the camera backwards, then reel it in.
   *
   * Used for the moment a boss stops being a fight and becomes an event —
   * the recoil sells scale in a way shake cannot, because shake says "that
   * was loud" and this says "get back".
   */
  punchOut(extra, duration) {
    this.punch = Math.max(this.punch || 0, extra);
    this.punchDecay = 1 / Math.max(0.15, duration || 1);
  }

  /** Unit vector the player is aiming along (used by grapple + attacks). */
  aimDirection(out) {
    const cp = Math.cos(this.pitch);
    out.set(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp
    );
    return out.normalize();
  }

  /** Flat forward vector for movement input. */
  flatForward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
  flatRight(out) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }

  /**
   * @param target  player feet position
   * @param speed   horizontal speed, drives the FOV kick
   * @param dt
   */
  update(target, speed, dt, extra = {}) {
    const C = CFG.camera;

    // Focus point sits at the frog's chest, nudged over the shoulder.
    _focus.set(target.x, target.y + C.height, target.z);
    const rightX = Math.cos(this.yaw), rightZ = -Math.sin(this.yaw);
    _focus.x += rightX * C.shoulder;
    _focus.z += rightZ * C.shoulder;

    if (!this.initialised) {
      this.focus.copy(_focus);
      this.initialised = true;
    } else {
      // Follow the focus a bit faster vertically so jumps stay framed.
      this.focus.x = damp(this.focus.x, _focus.x, C.followLerp, dt);
      this.focus.z = damp(this.focus.z, _focus.z, C.followLerp, dt);
      this.focus.y = damp(this.focus.y, _focus.y, C.followLerp * 0.8, dt);
    }

    // Orbit position behind the focus.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    _dir.set(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp).normalize();

    // Wall avoidance: cast from the focus toward the ideal camera spot and
    // pull in to the first hit so the view never ends up inside a wall.
    let want = this.distance;
    if (this.collision) {
      const hit = this.collision.raycast(
        this.focus.x, this.focus.y, this.focus.z,
        _dir.x, _dir.y, _dir.z, want + 0.6
      );
      if (hit) want = Math.max(C.minDistance, hit.dist - 0.5);
    }
    // Snap in instantly (never clip), ease back out slowly (no jitter).
    this.currentDistance = want < this.currentDistance
      ? want
      : damp(this.currentDistance, want, 6, dt);

    // A punch-out is added AFTER wall avoidance and deliberately not clamped
    // by it: during the beat it is used for, the camera is meant to leave the
    // arena rather than politely stop at a pillar.
    if (this.punch > 0) {
      this.punch = Math.max(0, this.punch - dt * this.punch * this.punchDecay * 3.2
        - dt * 1.5);
    }
    _desired.copy(this.focus)
      .addScaledVector(_dir, this.currentDistance + (this.punch || 0));

    // --- speed FOV -------------------------------------------------------
    const speedT = clamp((speed - 12) / 26, 0, 1);
    const boostTarget = speedT * C.fovSpeedBoost
      + (extra.dashing ? 9 : 0)
      + (extra.grappling ? 5 : 0)
      + (extra.sprinting ? CFG.sprint.fovBoost : 0);
    this.fovBoost = damp(this.fovBoost, boostTarget, extra.dashing ? 22 : 7, dt);

    // --- shake -----------------------------------------------------------
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.shakeTime += dt;
    const s = this.trauma * this.trauma;
    let shakeX = 0, shakeY = 0, shakeZ = 0, shakeRoll = 0;
    if (s > 0.0005) {
      const t = this.shakeTime * 34;
      // Layered sines read as a sharp punch rather than random noise.
      shakeX = (Math.sin(t * 1.0) + Math.sin(t * 2.3) * 0.5) * s * 0.42;
      shakeY = (Math.sin(t * 1.7 + 2.1) + Math.sin(t * 3.1) * 0.5) * s * 0.42;
      shakeZ = Math.sin(t * 1.3 + 1.1) * s * 0.22;
      shakeRoll = Math.sin(t * 1.9 + 0.4) * s * 0.05;
    }

    /**
     * The Overdrive impact, on top of whatever trauma is doing.
     *
     * Heavier than a normal hit (0.95 against 0.42) and over in 0.3s. The
     * (1 - t)² envelope lands it at exactly zero with zero slope, so the
     * frame it ends is indistinguishable from a still camera — no snap.
     */
    if (this.impactTime > 0) {
      this.impactTime = Math.max(0, this.impactTime - dt);
      const k = this.impactTime / this.impactDuration;   // 1 -> 0
      const e = k * k * this.impactStrength;
      const t = (this.impactDuration - this.impactTime) * 46;
      shakeX += (Math.sin(t) + Math.sin(t * 2.1) * 0.45) * e * 0.95;
      shakeY += (Math.sin(t * 1.6 + 1.3) + Math.sin(t * 2.7) * 0.45) * e * 0.8;
      shakeRoll += Math.sin(t * 1.25 + 0.7) * e * 0.045;
    }

    this.cam.position.set(_desired.x + shakeX, _desired.y + shakeY, _desired.z + shakeZ);
    this.cam.lookAt(this.focus);

    // Slight roll when strafing at speed, plus shake roll.
    this.roll = damp(this.roll, this.rollTarget, 6, dt);
    this.cam.rotateZ(this.roll + shakeRoll);

    const fov = this.baseFov + this.fovBoost;
    if (Math.abs(this.cam.fov - fov) > 0.01) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }

    this.pos.copy(this.cam.position);
  }

  /** Place the camera immediately (respawn, level start) with no easing. */
  snapTo(target) {
    this.initialised = false;
    this.currentDistance = this.distance;
    this.trauma = 0;
    this.impactTime = 0;
    this.punch = 0;
    this.update(target, 0, 1 / 60);
  }
}
