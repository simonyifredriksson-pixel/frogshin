/**
 * Tongue grapple.
 *
 * Four states: IDLE -> FIRING (tongue travelling) -> ATTACHED -> RETRACTING.
 *
 * While attached the frog is governed by two forces that together give the
 * ability its character:
 *   1. a rope *constraint* (a hard maximum distance) which produces genuine
 *      pendulum swinging and preserves tangential speed, and
 *   2. a reel-in pull toward the anchor, which is what makes it feel fast and
 *      aggressive rather than like a slow winch.
 */

import * as THREE from '../lib/three.module.js?v=v52';
import { CFG } from './config.js?v=v52';
import { clamp } from './util.js?v=v52';

export const GrappleState = {
  IDLE: 0,
  FIRING: 1,
  ATTACHED: 2,
  RETRACTING: 3,
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Grapple {
  constructor(collision) {
    this.collision = collision;
    this.state = GrappleState.IDLE;
    this.anchor = new THREE.Vector3();     // where the tongue is stuck
    this.tip = new THREE.Vector3();        // animated tongue tip
    this.origin = new THREE.Vector3();     // mouth position
    this.dir = new THREE.Vector3();
    this.ropeLength = 0;
    this.travel = 0;                       // how far the tip has flown
    this.targetDist = 0;
    this.cooldown = 0;
    this.attachedTime = 0;
    this.hitTag = '';
    this.justAttached = false;
    this.justMissed = false;
    this.justReleased = false;
  }

  get active() { return this.state !== GrappleState.IDLE; }
  get attached() { return this.state === GrappleState.ATTACHED; }
  /** True while any part of the tongue should be drawn. */
  get visible() { return this.state !== GrappleState.IDLE; }

  /**
   * Try to fire. Returns true if the tongue launched.
   * @param origin mouth position in world space
   * @param dir    normalised aim direction
   */
  tryFire(origin, dir) {
    if (this.state !== GrappleState.IDLE || this.cooldown > 0) return false;

    this.origin.copy(origin);
    this.dir.copy(dir).normalize();

    let hit = this.collision.raycast(
      origin.x, origin.y, origin.z,
      this.dir.x, this.dir.y, this.dir.z,
      CFG.grapple.range
    );

    // A cliff face gives the tongue nothing to grip. Rejecting it here (as
    // opposed to blocking the shot) means the tongue still flies out and
    // slaps the rock, which reads as "that surface will not hold" rather
    // than as the button not working.
    if (hit && hit.tag === 'terrain' && this.collision.terrain &&
        this.collision.terrain.slopeAt(hit.x, hit.z) > CFG.grapple.noGrappleSlope) {
      hit = null;
    }

    // Soft aim assist toward floating anchors — grappling at speed with a
    // mouse is hard, and lanterns are the intended targets.
    const assist = this._findAssistAnchor(origin, this.dir);
    let target = null;

    if (assist && (!hit || assist.dist < hit.dist + 10 || hit.tag === 'terrain')) {
      target = { x: assist.x, y: assist.y, z: assist.z, dist: assist.dist, tag: 'anchor' };
      // Re-aim the visual tongue at the assisted point.
      this.dir.set(target.x - origin.x, target.y - origin.y, target.z - origin.z).normalize();
    } else if (hit) {
      target = hit;
    }

    if (!target) {
      // Whiff: the tongue still flies out to full range and snaps back, which
      // is far more readable than nothing happening at all.
      this.state = GrappleState.FIRING;
      this.targetDist = CFG.grapple.range;
      this.travel = 0;
      this.anchor.copy(origin).addScaledVector(this.dir, CFG.grapple.range);
      this.tip.copy(origin);
      this.willAttach = false;
      this.hitTag = '';
      return true;
    }

    this.state = GrappleState.FIRING;
    this.targetDist = target.dist;
    this.travel = 0;
    this.anchor.set(target.x, target.y, target.z);
    this.tip.copy(origin);
    this.willAttach = true;
    this.hitTag = target.tag;
    return true;
  }

  /** Nearest floating anchor inside the aim cone, if any. */
  _findAssistAnchor(origin, dir) {
    const anchors = this.collision.anchors;
    let best = null, bestScore = Infinity;
    const maxAngle = CFG.grapple.aimAssistAngle * 3.0;

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      _v.set(a.x - origin.x, a.y - origin.y, a.z - origin.z);
      const dist = _v.length();
      if (dist > CFG.grapple.range || dist < 3) continue;
      _v.multiplyScalar(1 / dist);
      const dot = _v.dot(dir);
      if (dot <= 0) continue;
      const angle = Math.acos(clamp(dot, -1, 1));
      if (angle > maxAngle) continue;
      // Prefer tight angles first, then proximity.
      const score = angle * 10 + dist * 0.01;
      if (score < bestScore) { bestScore = score; best = { a, dist, angle }; }
    }
    if (!best) return null;
    return { x: best.a.x, y: best.a.y, z: best.a.z, dist: best.dist };
  }

  /** Detach, retracting the tongue. */
  release() {
    if (this.state === GrappleState.IDLE) return false;
    const wasAttached = this.state === GrappleState.ATTACHED;
    this.state = GrappleState.RETRACTING;
    this.cooldown = CFG.grapple.cooldown;
    this.justReleased = true;
    return wasAttached;
  }

  cancel() {
    this.state = GrappleState.IDLE;
    this.travel = 0;
    this.attachedTime = 0;
  }

  /**
   * Advance the grapple and apply its forces to the player.
   * @param dt
   * @param pos player feet position (mutated by the rope constraint)
   * @param vel player velocity (mutated)
   * @param mouth current mouth position (rope origin)
   * @param inputDir optional world-space movement input for swing steering
   */
  update(dt, pos, vel, mouth, inputDir) {
    this.justAttached = false;
    this.justMissed = false;
    this.justReleased = false;

    if (this.cooldown > 0) this.cooldown -= dt;

    switch (this.state) {
      case GrappleState.FIRING: {
        this.travel += CFG.grapple.fireSpeed * dt;
        if (this.travel >= this.targetDist) {
          this.travel = this.targetDist;
          if (this.willAttach) {
            this.state = GrappleState.ATTACHED;
            this.attachedTime = 0;
            this.justAttached = true;
            // Start the rope at the current separation so there is no snap.
            this.ropeLength = mouth.distanceTo(this.anchor);
          } else {
            this.state = GrappleState.RETRACTING;
            this.justMissed = true;
            this.cooldown = CFG.grapple.cooldown * 0.6;
          }
        }
        this.tip.copy(this.origin).addScaledVector(this.dir, this.travel);
        // The mouth moves while the tongue flies, so keep the base attached.
        this.origin.copy(mouth);
        break;
      }

      case GrappleState.ATTACHED: {
        this.attachedTime += dt;
        this.tip.copy(this.anchor);
        this.origin.copy(mouth);
        this._applyRope(dt, pos, vel, mouth, inputDir);
        if (this.attachedTime > CFG.grapple.maxTime) this.release();
        break;
      }

      case GrappleState.RETRACTING: {
        this.origin.copy(mouth);
        const d = this.tip.distanceTo(mouth);
        if (d < 1.0) { this.cancel(); break; }
        _v.subVectors(mouth, this.tip).normalize();
        this.tip.addScaledVector(_v, Math.min(d, CFG.grapple.retractSpeed * dt));
        break;
      }
      default:
        break;
    }
  }

  /** Rope constraint + reel-in pull. Mutates `pos` and `vel`. */
  _applyRope(dt, pos, vel, mouth, inputDir) {
    const G = CFG.grapple;

    _v.subVectors(this.anchor, mouth);
    let dist = _v.length();
    if (dist < 0.001) { this.release(); return; }
    _n.copy(_v).multiplyScalar(1 / dist);

    // Arrived — pop off so the player keeps their momentum instead of
    // grinding against the anchor.
    if (dist < G.detachDist) { this.release(); return; }

    // Reel in: the rope can only ever get shorter while attached.
    this.ropeLength = Math.min(this.ropeLength, dist);
    this.ropeLength -= 24 * dt;
    this.ropeLength = Math.max(G.minRopeLength, this.ropeLength);

    // --- hard constraint: never exceed the rope length ---
    if (dist > this.ropeLength) {
      const correction = Math.min(dist - this.ropeLength, 2.0);
      pos.addScaledVector(_n, correction);
      // Cancel the component of velocity pulling away from the anchor; the
      // tangential part survives, and that is what makes swings work.
      const radial = vel.dot(_n);
      if (radial < 0) vel.addScaledVector(_n, -radial);
    }

    // --- reel-in acceleration ---
    const towardSpeed = vel.dot(_n);
    if (towardSpeed < G.maxPullSpeed) {
      // Ease off the pull as we approach the cap so it never feels like a snap.
      const strength = G.pull * clamp(1 - towardSpeed / G.maxPullSpeed, 0.15, 1);
      vel.addScaledVector(_n, strength * dt);
    }

    // --- swing steering: player input pushes along the tangent ---
    if (inputDir && (inputDir.x || inputDir.z)) {
      _tmp.copy(inputDir);
      // Project the input onto the plane perpendicular to the rope so the
      // player can pump a swing but cannot fight the constraint.
      _tmp.addScaledVector(_n, -_tmp.dot(_n));
      const l = _tmp.length();
      if (l > 0.001) {
        _tmp.multiplyScalar(1 / l);
        vel.addScaledVector(_tmp, 26 * dt);
      }
    }

    // A whisper of tangential gain keeps long swings from bleeding out.
    // Scaling the tangential component itself makes this a proportional
    // (exponential) boost rather than a constant shove.
    _tmp.copy(vel).addScaledVector(_n, -vel.dot(_n));
    const tanLen = _tmp.length();
    if (tanLen > 0.01 && tanLen < 34) {
      vel.addScaledVector(_tmp, (G.swingBoost - 1) * dt);
    }
  }

  /** Gravity multiplier while swinging — lighter, so arcs stay long and fun. */
  get gravityScale() {
    return this.state === GrappleState.ATTACHED ? 0.62 : 1.0;
  }

  /** Serialisable state for the network layer. */
  netState() {
    if (!this.visible) return null;
    return [
      this.state,
      Math.round(this.tip.x * 20) / 20,
      Math.round(this.tip.y * 20) / 20,
      Math.round(this.tip.z * 20) / 20,
    ];
  }
}
