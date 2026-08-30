/**
 * Local player controller.
 *
 * Owns the movement state machine (run / jump / double jump / wall jump /
 * dash / grapple / swim) and drives the combat + health components. Anything
 * other players need to see is pushed onto `this.events`, which the network
 * layer drains once per frame.
 */

import * as THREE from '../lib/three.module.js?v=v11';
import { CFG } from './config.js?v=v11';
import { clamp, damp, dampAngle, lerp } from './util.js?v=v11';
import { FrogModel } from './frog.js?v=v11';
import { Grapple, GrappleState } from './grapple.js?v=v11';
import { Combat, Health } from './combat.js?v=v11';
import { Stamina } from './stamina.js?v=v11';
import { Inventory, SLOT_KEYS, ITEMS } from './items.js?v=v11';
import { Audio } from './audio.js?v=v11';

const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _swimWish = new THREE.Vector3();
const _throwOrigin = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _throwDir = new THREE.Vector3();
const _axis = { x: 0, y: 0 };

export class Player {
  constructor(opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.color = opts.color;
    this.world = opts.world;
    this.collision = opts.world.collision;
    this.effects = opts.effects;
    this.scene = opts.scene;
    this.kunai = opts.kunai;         // KunaiSystem
    this.pickups = opts.pickups;     // PickupSystem
    this.inventory = new Inventory();
    this.kunaiCooldown = 0;
    this.throwT = 0;
    // Set each frame by the round manager: taggers throw faster, and the
    // chase modes turn player damage off entirely.
    this.throwCooldownOverride = 0;
    this.combatEnabled = true;

    // --- story mode ---
    this.cinematic = false;        // frozen for a cutscene
    this.frozen = false;           // frozen for the defeat sequence
    this.storyParry = false;       // right mouse becomes parry, not throw
    this.parrying = false;
    this.parryHits = 0;            // blows absorbed during the current parry
    this.knockdown = 0;            // seconds face-down and helpless
    this.damageMultiplier = 1;     // broken sword scales this down
    this.justParried = 0;
    this.justKnockedDown = false;

    this.model = new FrogModel(this.color, this.name, true);
    this.scene.add(this.model.root);

    // --- physics state ---
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.wasGrounded = false;
    this.groundTag = 'terrain';
    this.onWall = false;
    this.wallNormal = new THREE.Vector3();
    this.hitCeiling = false;
    this.landedThisFrame = false;
    this.yaw = 0;
    this.visualYaw = 0;
    this.inWater = false;
    this.swimStroke = 0;
    this.sprinting = false;
    this._bubbleTimer = 0;
    this._sprintTrail = 0;
    this._sprintSound = 0;
    this._tiredCue = 0;
    this._breached = false;

    // --- movement timers ---
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.wallCoyote = 0;
    this.wallCoyoteNormal = new THREE.Vector3();
    this.doubleJumpLeft = 1;
    this.jumpHeld = false;
    this.wallSliding = false;
    this.stepDistance = 0;
    this.airTime = 0;
    this.peakFallSpeed = 0;

    // --- dash ---
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashCharges = CFG.dash.airCharges;
    this.dashDir = new THREE.Vector3();

    // --- abilities / stats ---
    this.grapple = new Grapple(this.collision);
    this.combat = new Combat();
    this.health = new Health();
    this.stamina = new Stamina();

    this.events = [];
    this.kills = 0;
    this.deaths = 0;
    this.lastHitBy = null;
    this.timeAlive = 0;

    // Reusable collision state object (avoids per-frame allocation).
    this._cstate = {
      pos: this.pos, vel: this.vel,
      grounded: false, groundTag: 'terrain',
      wallNormal: new THREE.Vector3(), onWall: false,
      hitCeiling: false, landedThisFrame: false, wallTag: '',
    };
  }

  /** Place the frog at a spawn point and clear all momentum. */
  spawn(position) {
    this.pos.copy(position);
    this.vel.set(0, 0, 0);
    this.health.revive();
    this.combat.reset();
    this.stamina.reset();
    this.grapple.cancel();
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashCharges = CFG.dash.airCharges;
    this.doubleJumpLeft = 1;
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.z = 0;
    this.model.body.position.y = 0;
    this.effects.respawnBurst(this.pos, this.color);
    Audio.respawn(this.pos);
    this.events.push({ t: 'respawn', x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  get mouthPosition() {
    return _mouth.set(
      this.pos.x - Math.sin(this.visualYaw) * 0.30,
      this.pos.y + 1.42,
      this.pos.z - Math.cos(this.visualYaw) * 0.30
    );
  }

  /** Snapshot for the network layer. */
  netState() {
    const g = this.grapple.netState();
    return {
      x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
      vx: r2(this.vel.x), vy: r2(this.vel.y), vz: r2(this.vel.z),
      yaw: r2(this.visualYaw),
      hp: Math.round(this.health.hp),
      d: this.health.dead ? 1 : 0,
      g: this.grounded ? 1 : 0,
      dt: this.dashTimer > 0 ? 1 : 0,
      sw: this.inWater ? 1 : 0,
      sp: this.sprinting ? 1 : 0,
      // How far through the story this player is, so others know whether
      // they should be visible yet. 0 in the arena.
      st: this.storyPhaseCode || 0,
      at: this.combat.attacking ? this.combat.comboIndex + 1 : 0,
      gr: g,
      k: this.kills,
    };
  }

  // ------------------------------------------------------------------ input

  /**
   * @param dt seconds
   * @param input Input instance
   * @param cam FollowCamera
   * @param targets remote players available to hit
   */
  update(dt, input, cam, targets) {
    this._lastInput = input;     // so the dead/frozen paths can flush it too
    this.health.update(dt);
    this.combat.update(dt);
    this.stamina.update(dt);
    this.timeAlive += dt;

    // Hitstop: slow the local simulation to a crawl for a few frames on a
    // connecting hit. This is applied to dt so physics stays consistent.
    if (this.combat.hitstop > 0) dt *= 0.12;

    if (this.health.dead) {
      this._updateDead(dt, cam);
      return;
    }

    // Cutscenes, knockdowns and the defeat sequence all take control away.
    // Gravity and collision still run so the body settles on the ground.
    if (this.knockdown > 0 || this.cinematic || this.frozen) {
      if (this.knockdown > 0) this.knockdown -= dt;
      this._makeHelpless(input);
      this._updateHelpless(dt, cam);
      return;
    }

    const active = input && input.locked;
    if (active) input.moveAxis(_axis); else { _axis.x = 0; _axis.y = 0; }

    // World-space wish direction from camera-relative input.
    cam.flatForward(_fwd);
    cam.flatRight(_right);
    _wish.set(0, 0, 0)
      .addScaledVector(_right, _axis.x)
      .addScaledVector(_fwd, _axis.y);
    const hasInput = _wish.lengthSq() > 1e-6;
    if (hasInput) _wish.normalize();

    // Sprint is a held modifier: Shift plus any movement input. Facing always
    // follows the movement direction, so the run is never a backpedal.
    // It works underwater too, as a gentler swim boost.
    this.sprinting = active && hasInput && this.stamina.canAct
      && (input.down('ShiftLeft') || input.down('ShiftRight'));

    if (this.sprinting) {
      const rate = this.inWater
        ? CFG.stamina.swimSprintDrain
        : CFG.stamina.sprintDrain;
      // drain() reports the tank running dry, so sprint ends the same frame
      // rather than one frame late.
      if (!this.stamina.drain(rate * dt)) this.sprinting = false;
    }

    // ---- ability inputs -------------------------------------------------
    if (active) {
      if (input.consume('Space')) this.jumpBuffer = CFG.move.jumpBuffer;
      this.jumpHeld = input.down('Space');
      if (input.consume('KeyQ')) this._tryDash(_wish, hasInput, cam);
      if (input.consume('KeyG')) this._toggleGrapple(cam);
      if (input.consumeAttack()) this._tryAttack(cam);

      // Hotbar: number keys select the matching slot, left to right.
      for (let i = 0; i < SLOT_KEYS.length; i++) {
        if (input.consume(SLOT_KEYS[i]) && this.inventory.select(i)) Audio.uiClick();
      }
      const wheel = input.takeWheel();
      if (wheel) this._cycleSlot(wheel);
      // In story mode the right button is a held parry rather than a throw.
      if (this.storyParry) {
        const held = input.rightHeld;
        if (held !== this.parrying) {
          this.parrying = held;
          // Releasing the parry clears the tally, so each guard is judged
          // on its own — that is what makes holding it forever a risk.
          if (!held) this.parryHits = 0;
          else Audio.uiHover();
        }
        input.consume('MouseRight');
      } else if (input.consume('MouseRight')) {
        this._tryThrowKunai(cam);
      }
      if (input.consume('KeyE')) this._tryPickup();
    } else {
      this.jumpHeld = false;
    }

    // ---- timers ---------------------------------------------------------
    if (this._tiredCue > 0) this._tiredCue -= dt;
    if (this.kunaiCooldown > 0) this.kunaiCooldown -= dt;
    if (this.throwT > 0) this.throwT -= dt;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.coyote > 0) this.coyote -= dt;
    if (this.wallCoyote > 0) this.wallCoyote -= dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;

    // ---- jump -----------------------------------------------------------
    if (this.jumpBuffer > 0) this._tryJump(_wish, hasInput);

    // Variable jump height: releasing Space early clips the rise.
    if (!this.jumpHeld && this.vel.y > 0 && !this.grounded && this.dashTimer <= 0) {
      this.vel.y *= Math.pow(CFG.move.jumpCutMult, dt * 12);
    }

    // ---- horizontal movement -------------------------------------------
    const dashing = this.dashTimer > 0;
    if (this.inWater && !dashing) {
      this._swim(dt, cam, _axis, active);
    } else if (dashing) {
      // The dash fully overrides steering; that's what makes it feel decisive.
      this.vel.x = this.dashDir.x * CFG.dash.speed;
      this.vel.z = this.dashDir.z * CFG.dash.speed;
      this.vel.y = Math.max(this.vel.y, 0) * 0.2;
      this.effects.dashTrail(this.pos, this.dashDir, 0x8ce8ff);
      if (this.dashTimer <= 0) this._endDash();
    } else {
      const sp = CFG.sprint;
      const boost = this.sprinting ? sp.speedMult : 1;
      // Sprint raises the speed you steer toward. Because acceleration is
      // momentum-preserving, letting go of Shift does not brake you — you
      // simply stop being pushed past the walk cap and coast back down.
      const wishSpeed = (this.grounded ? CFG.move.runSpeed : CFG.move.airSpeed) * boost;
      const accel = (this.grounded ? CFG.move.groundAccel : CFG.move.airAccel)
        * (this.sprinting ? sp.accelMult : 1);
      if (this.grounded && !this.inWater) {
        this._friction(dt, this.sprinting ? sp.frictionMult : 1);
      } else {
        this._airFriction(dt);
      }
      if (hasInput) this._accelerate(_wish, wishSpeed, accel, dt);
    }

    // ---- gravity --------------------------------------------------------
    // Swimming supplies its own vertical forces, so gravity is skipped there.
    if (!dashing && !this.inWater) {
      let g = CFG.move.gravity * this.grapple.gravityScale;
      if (this.vel.y < 0) g *= CFG.move.fallGravityMult;
      if (this.wallSliding && this.vel.y < 0) g *= 0.45;
      this.vel.y += g * dt;
      if (this.vel.y < CFG.move.maxFallSpeed) this.vel.y = CFG.move.maxFallSpeed;
      if (this.wallSliding && this.vel.y < CFG.move.wallSlideSpeed) {
        this.vel.y = CFG.move.wallSlideSpeed;
      }
    }

    // ---- grapple --------------------------------------------------------
    this.grapple.update(dt, this.pos, this.vel, this.mouthPosition, hasInput ? _wish : null);
    this._handleGrappleEvents();

    // ---- integrate + collide -------------------------------------------
    const cs = this._cstate;
    cs.pos = this.pos; cs.vel = this.vel;
    this.collision.moveCharacter(cs, dt);
    this.wasGrounded = this.grounded;
    this.grounded = cs.grounded;
    this.groundTag = cs.groundTag;
    this.onWall = cs.onWall;
    this.hitCeiling = cs.hitCeiling;
    this.wallNormal.copy(cs.wallNormal);
    this.landedThisFrame = cs.landedThisFrame;

    // Bounced off a cliff: shove away from the rock and kill the dash, so
    // charging a mountain never gains you height.
    if (cs.bounce) this._bounceOffCliff(cs.bounceX, cs.bounceZ);

    this._postMove(dt, hasInput, cam, dashing);

    // ---- attacks resolve -------------------------------------------------
    if (this.combat.active) {
      const hits = this.combat.resolve(this.pos, this.yaw, targets);
      if (hits) this._applyHits(hits, cam);
    }

    // ---- facing ---------------------------------------------------------
    this._updateFacing(dt, hasInput, cam, dashing);

    // ---- model ----------------------------------------------------------
    this._updateModel(dt, hasInput);
  }

  // -------------------------------------------------------------- movement

  /** Quake-style acceleration: caps steering speed without killing momentum. */
  _accelerate(dir, wishSpeed, accel, dt) {
    const current = this.vel.x * dir.x + this.vel.z * dir.z;
    const add = wishSpeed - current;
    if (add <= 0) return;
    let a = accel * dt;
    if (a > add) a = add;
    this.vel.x += dir.x * a;
    this.vel.z += dir.z * a;
  }

  _friction(dt, scale = 1) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 0.01) { this.vel.x = 0; this.vel.z = 0; return; }
    // The `max(speed, 5)` floor gives a crisp stop instead of a long slide.
    const drop = Math.max(speed, 5) * CFG.move.groundFriction * scale * dt;
    const k = Math.max(0, speed - drop) / speed;
    this.vel.x *= k;
    this.vel.z *= k;
  }

  /**
   * Full 3D swimming.
   *
   * Unlike ground movement, WASD steers along the camera's *aim* vector, so
   * looking down and holding W dives. Space thrusts upward, and doing so just
   * below the surface launches the frog clear of the water entirely.
   */
  _swim(dt, cam, axis, active) {
    const S = CFG.swim;

    // Build a 3D wish vector from the camera basis.
    cam.aimDirection(_aim);
    cam.flatRight(_right);
    _swimWish.set(0, 0, 0)
      .addScaledVector(_right, axis.x)
      .addScaledVector(_aim, axis.y);

    const hasInput = _swimWish.lengthSq() > 1e-6;
    // Holding Shift underwater is a 1.5x boost rather than the 2x of a
    // land sprint — water resistance should still be felt.
    const boost = this.sprinting ? CFG.sprint.swimMult : 1;
    if (hasInput) {
      _swimWish.normalize();
      // Same momentum-preserving acceleration as on land, in three axes.
      const current = this.vel.dot(_swimWish);
      const add = S.speed * boost - current;
      if (add > 0) {
        this.vel.addScaledVector(_swimWish, Math.min(S.accel * boost * dt, add));
      }
      this.swimStroke += dt;
    }

    // Kick upward, or breach clean out of the water near the surface.
    const depth = CFG.world.waterLevel - (this.pos.y + CFG.move.height * 0.5);
    let breaching = false;
    if (active && this.jumpHeld) {
      if (depth < S.breachDepth && !this._breached && this.stamina.canAct) {
        // Leaping clear of the water is a jump, so it is priced like one.
        this._breached = true;
        breaching = true;
        this.stamina.spend(CFG.stamina.breachCost);
        this.vel.y = S.breachBoost;
        this.model.croak();
        _tmp.set(this.pos.x, CFG.world.waterLevel, this.pos.z);
        this.effects.splash(_tmp);
        Audio.splash(_tmp);
      } else {
        this.vel.y += S.riseSpeed * dt;
      }
    } else {
      this._breached = false;
      // Sink gently when idle so you drift down rather than hovering.
      this.vel.y += S.sinkGravity * dt;
    }

    // Water resistance on every axis.
    const drag = Math.exp(-S.drag * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    if (!breaching) {
      // A breach deliberately escapes the swim rise cap — otherwise the
      // launch impulse would be clamped straight back down to a normal kick.
      this.vel.y *= drag;
      this.vel.y = clamp(this.vel.y, S.maxSink, S.maxRise);
    }

    // Trail of bubbles while actively swimming.
    this._bubbleTimer -= dt;
    if (this._bubbleTimer <= 0 && (hasInput || this.jumpHeld)) {
      this._bubbleTimer = 0.09;
      this.effects.bubbles(this.pos, 2);
    }
  }

  _airFriction(dt) {
    const k = Math.exp(-CFG.move.airFriction * dt);
    this.vel.x *= k;
    this.vel.z *= k;
  }

  _tryJump(wish, hasInput) {
    // Exhausted means no jumping at all until stamina is back to 70%.
    // Checked once up front so every branch below is covered.
    if (!this.stamina.canAct) {
      this.jumpBuffer = 0;
      if (!this._tiredCue || this._tiredCue <= 0) {
        this._tiredCue = 0.55;          // rate-limit the "can't do that" cue
        Audio.exhausted(this.pos);
      }
      return;
    }

    // Grapple + jump = detach with a kick. Chaining swings is the core skill.
    if (this.grapple.attached) {
      this.grapple.release();
      this.stamina.spend(CFG.stamina.jumpCost);
      this.vel.y = Math.max(this.vel.y + 7, 11);
      this.jumpBuffer = 0;
      this.effects.puff(this.mouthPosition, 0xff9ec0, 8, 3);
      Audio.doubleJump(this.pos);
      this.events.push({ t: 'jump', k: 1, x: this.pos.x, y: this.pos.y, z: this.pos.z });
      return;
    }

    if (this.grounded || this.coyote > 0) {
      this.stamina.spend(CFG.stamina.jumpCost);
      this.vel.y = CFG.move.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.doubleJumpLeft = 1;
      this.model.croak();
      this.effects.dustPuff(this.pos, 7, 2.2, 0xcfc0a0);
      Audio.jump(this.pos);
      this.events.push({ t: 'jump', k: 0, x: this.pos.x, y: this.pos.y, z: this.pos.z });
      return;
    }

    if (this.wallCoyote > 0) {
      // Wall jump: up and away from the surface, with a speed floor so it
      // always gains ground even when you were sliding straight down.
      this.stamina.spend(CFG.stamina.wallJumpCost);
      this.vel.y = CFG.move.wallJumpUp;
      this.vel.x += this.wallCoyoteNormal.x * CFG.move.wallJumpOut;
      this.vel.z += this.wallCoyoteNormal.z * CFG.move.wallJumpOut;
      this.wallCoyote = 0;
      this.jumpBuffer = 0;
      this.doubleJumpLeft = 1;
      this.dashCharges = CFG.dash.airCharges;
      this.effects.puff(
        _tmp.set(this.pos.x, this.pos.y + 0.9, this.pos.z), 0xd8e8ff, 10, 5);
      Audio.wallJump(this.pos);
      this.events.push({ t: 'jump', k: 2, x: this.pos.x, y: this.pos.y, z: this.pos.z });
      return;
    }

    if (this.doubleJumpLeft > 0) {
      this.doubleJumpLeft--;
      this.stamina.spend(CFG.stamina.doubleJumpCost);
      this.vel.y = CFG.move.doubleJumpSpeed;
      this.jumpBuffer = 0;
      // Redirect momentum into the held direction — the flip is a steering tool.
      if (hasInput) {
        const speed = Math.max(Math.hypot(this.vel.x, this.vel.z), 9);
        this.vel.x = wish.x * speed;
        this.vel.z = wish.z * speed;
      }
      this.model.triggerFlip();
      this.model.croak();
      this.effects.ring(
        _tmp.set(this.pos.x, this.pos.y + 0.9, this.pos.z), 0.4, 3.2, 0.35, 0xbdf5a0, true);
      Audio.doubleJump(this.pos);
      this.events.push({ t: 'jump', k: 1, x: this.pos.x, y: this.pos.y, z: this.pos.z });
    }
  }

  // ------------------------------------------------------------------ dash

  _tryDash(wish, hasInput, cam) {
    if (this.dashCooldown > 0 || this.dashTimer > 0) return;
    if (!this.grounded && this.dashCharges <= 0) return;

    if (hasInput) this.dashDir.copy(wish);
    else cam.flatForward(this.dashDir);
    this.dashDir.y = 0;
    if (this.dashDir.lengthSq() < 1e-6) this.dashDir.set(0, 0, -1);
    this.dashDir.normalize();

    this.dashTimer = CFG.dash.duration;
    this.dashCooldown = CFG.dash.cooldown;
    this.health.invulnerable = Math.max(this.health.invulnerable, CFG.dash.invulnerable);
    if (!this.grounded) this.dashCharges--;

    // Face the dash so the animation and the motion agree.
    this.yaw = Math.atan2(-this.dashDir.x, -this.dashDir.z);

    this.effects.dashBurst(this.pos, this.dashDir, 0x8ce8ff);
    Audio.dash(this.pos);
    this.events.push({
      t: 'dash',
      x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
      dx: r2(this.dashDir.x), dz: r2(this.dashDir.z),
    });
  }

  _endDash() {
    this.dashTimer = 0;
    const keep = CFG.dash.speed * CFG.dash.endSpeedKeep;
    this.vel.x = this.dashDir.x * keep;
    this.vel.z = this.dashDir.z * keep;
    // A touch of lift on exit so air-dashes flow into a jump or grapple.
    if (!this.grounded) this.vel.y = Math.max(this.vel.y, 1.5);
  }

  // --------------------------------------------------------------- grapple

  _toggleGrapple(cam) {
    if (this.grapple.active) { this.grapple.release(); return; }
    cam.aimDirection(_aim);
    if (this.grapple.tryFire(this.mouthPosition, _aim)) {
      Audio.tongueFire(this.pos);
      this.events.push({
        t: 'grapple',
        x: r2(this.grapple.anchor.x), y: r2(this.grapple.anchor.y), z: r2(this.grapple.anchor.z),
      });
    }
  }

  _handleGrappleEvents() {
    if (this.grapple.justAttached) {
      this.effects.tongueImpact(this.grapple.anchor);
      Audio.tongueHit(this.grapple.anchor);
      // Attaching refreshes air mobility — grappling is meant to extend combos.
      this.dashCharges = CFG.dash.airCharges;
      this.doubleJumpLeft = 1;
    }
    if (this.grapple.justMissed) Audio.tongueRelease(this.pos);
    if (this.grapple.justReleased) {
      this.events.push({ t: 'grapEnd' });
      Audio.tongueRelease(this.pos);
    }
  }

  // ---------------------------------------------------------------- combat

  _tryAttack(cam) {
    const i = this.combat.tryAttack();
    if (i < 0) return;

    // Attacks commit to where the camera is looking.
    this.yaw = cam.yaw;
    // Small forward lunge — closes the gap and sells the weight of the swing.
    const lunge = i === 2 ? 7.5 : 4.5;
    this.vel.x += -Math.sin(this.yaw) * lunge;
    this.vel.z += -Math.cos(this.yaw) * lunge;
    if (i === 2 && !this.grounded) this.vel.y = Math.max(this.vel.y, -6);

    _tmp.set(
      this.pos.x - Math.sin(this.yaw) * 1.5,
      this.pos.y + 1.1,
      this.pos.z - Math.cos(this.yaw) * 1.5
    );
    this.effects.slashArc(_tmp, this.yaw, i, i === 2 ? 0xfff0b0 : 0xdff3ff, i === 2 ? 3.8 : 3.0);
    Audio.slash(this.pos, i);
    this.events.push({ t: 'attack', i, yaw: r2(this.yaw) });
  }

  // ------------------------------------------------------------ kunai

  /** Step the hotbar selection, skipping empty slots. */
  _cycleSlot(dir) {
    const slots = this.inventory.slots;
    const n = slots.length;
    for (let step = 1; step <= n; step++) {
      // + n * n keeps the value positive before the wrap for either direction.
      const i = (this.inventory.selected + dir * step + n * n) % n;
      if (slots[i]) {
        if (this.inventory.select(i)) Audio.uiClick();
        return;
      }
    }
  }

  /** Throw the equipped kunai along the camera aim. */
  _tryThrowKunai(cam) {
    if (this.kunaiCooldown > 0 || this.health.dead) return;
    const slot = this.inventory.selectedSlot;
    if (!slot || slot.item !== ITEMS.kunai) {
      // Equipped something else — say so rather than silently doing nothing.
      this.needKunaiCue = true;
      return;
    }
    if (slot.count <= 0) { this.outOfKunaiCue = true; return; }

    this.inventory.useSelectedKunai();
    this.kunaiCooldown = this.throwCooldownOverride || CFG.kunai.cooldown;
    this.throwT = 0.26;
    this.yaw = cam.yaw;                       // throw where you are looking

    cam.aimDirection(_aim);
    // Launch from beside the head so the kunai clears the frog's own body.
    const o = _throwOrigin.copy(this.pos);
    o.y += 1.45;
    o.addScaledVector(_aim, 0.6);
    o.x += Math.cos(cam.yaw) * 0.28;
    o.z += -Math.sin(cam.yaw) * 0.28;

    // The hand sits below and to the side of the camera, so throwing along
    // the raw camera vector would drift off the reticle. Instead find what
    // the crosshair is actually pointing at and aim the throw at that point.
    const range = CFG.kunai.range;
    const hit = this.collision.raycast(
      cam.pos.x, cam.pos.y, cam.pos.z, _aim.x, _aim.y, _aim.z, range);
    if (hit) _aimPoint.set(hit.x, hit.y, hit.z);
    else _aimPoint.copy(cam.pos).addScaledVector(_aim, range);

    const dir = _throwDir.subVectors(_aimPoint, o);
    if (dir.lengthSq() < 1e-6) dir.copy(_aim);
    dir.normalize();

    this.kunai.throw_(o, dir, this.id, true);
    Audio.kunaiThrow(this.pos);
    this.events.push({
      t: 'kunai',
      x: r2(o.x), y: r2(o.y), z: r2(o.z),
      dx: r2(dir.x), dy: r2(dir.y), dz: r2(dir.z),
    });
  }

  /** Grab the nearest kunai crate. */
  _tryPickup() {
    if (!this.pickups || this.health.dead) return;
    const crate = this.pickups.nearest(this.pos);
    if (!crate) return;
    this.inventory.addKunai(CFG.kunai.boxCount);
    // Remove locally straight away so it feels instant; the authority's next
    // sync is what makes it official for everyone else.
    this.pickups.remove(crate.id, true);
    Audio.pickup(this.pos);
    this.pickedUpCue = CFG.kunai.boxCount;
    this.events.push({ t: 'pickup', id: crate.id });
  }

  _applyHits(hits, cam) {
    for (const h of hits) {
      _tmp.set(h.target.pos.x, h.target.pos.y + 1.0, h.target.pos.z);
      this.effects.hitBurst(_tmp, { x: h.dirX, y: 0, z: h.dirZ }, h.heavy);
      Audio.hit(_tmp, h.heavy);
      cam.shake(h.heavy ? 0.5 : 0.3);

      // Training dummies are purely local practice targets: they show their
      // own short damage flash and never touch the network.
      if (h.target.isDummy) {
        if (h.target.onHit) {
          h.target.onHit(Math.round(h.damage * this.damageMultiplier), h.dirX, h.dirZ);
        }
        continue;
      }

      // Chase modes have no damage — the katana swing stays purely cosmetic.
      if (!this.combatEnabled) continue;

      this.effects.damageNumber(_tmp, Math.round(h.damage * this.damageMultiplier), h.heavy);
      this.events.push({
        t: 'hit',
        id: h.target.id,
        dmg: h.damage,
        kx: r2(h.dirX * h.knockback),
        ky: r2(h.knockbackUp),
        kz: r2(h.dirZ * h.knockback),
        c: h.index,
      });
    }
  }

  /** Damage requested by another player. Returns true if it landed. */
  receiveHit(dmg, kx, ky, kz, fromId, cam) {
    if (this.health.dead || this.health.protected) return false;
    const applied = this.health.damage(dmg, fromId);
    if (!applied) return false;

    this.vel.x += kx;
    this.vel.y = Math.max(this.vel.y, 0) + ky;
    this.vel.z += kz;
    // Being hit interrupts a grapple — no free escapes.
    if (this.grapple.active) this.grapple.release();
    this.lastHitBy = fromId;

    _tmp.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
    this.effects.hitBurst(_tmp, { x: -kx, y: 0, z: -kz }, dmg > 20);
    Audio.hurt(this.pos);
    if (cam) cam.shake(clamp(dmg / 45, 0.15, 0.6));

    if (this.health.justDied) this._die(cam);
    return true;
  }

  _die(cam) {
    this.deaths++;
    // Consumed by the game loop next frame. A flag is used rather than a
    // direct callback because deaths can originate mid-frame (falling) or
    // between frames (an incoming hit packet).
    this.deathPending = true;
    this.combat.reset();
    this.grapple.cancel();
    this.dashTimer = 0;
    this.effects.deathBurst(this.pos, this.color);
    Audio.death(this.pos);
    if (cam) cam.shake(0.75);
    this.events.push({
      t: 'die', by: this.lastHitBy || null,
      x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
    });
  }

  /** Environmental death (fell off the map / drowned in the void). */
  killByWorld(cam) {
    if (this.health.dead) return;
    this.lastHitBy = null;
    this.health.kill();
    this._die(cam);
  }

  /**
   * A blow from Toadel. Either it is turned aside by a parry, or it takes
   * 80% of your maximum health — so two clean hits finish you.
   * @param from  world position the blow came from
   * @param story StoryMode, for feedback hooks
   */
  onBossBlow(from, yaw, story) {
    const S = CFG.story;
    const dirX = this.pos.x - from.x;
    const dirZ = this.pos.z - from.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / len, nz = dirZ / len;

    if (this.parrying) {
      this.parryHits++;
      this.justParried = 0.2;
      // Absorbing a second blow inside one parry breaks your guard.
      if (this.parryHits >= S.parry.knockdownAfter) {
        this._knockDown(nx, nz);
        return;
      }
      // Turned aside: sparks, a shove, no damage.
      this.vel.x += nx * 7;
      this.vel.z += nz * 7;
      this.combat.hitstop = S.parry.chipStagger;
      _tmp.set(this.pos.x + nx * 0.6, this.pos.y + 1.1, this.pos.z + nz * 0.6);
      this.effects.hitBurst(_tmp, { x: -nx, y: 0, z: -nz }, true);
      this.effects.ring(_tmp, 0.3, 2.6, 0.3, 0xbfe3ff, false, { x: nx, y: 0, z: nz });
      Audio.parry(this.pos);
      return;
    }

    // Unblocked.
    this.vel.x += nx * 16;
    this.vel.y = Math.max(this.vel.y, 0) + 7;
    this.vel.z += nz * 16;
    _tmp.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
    this.effects.hitBurst(_tmp, { x: -nx, y: 0, z: -nz }, true);
    Audio.hit(this.pos, true);
    Audio.hurt(this.pos);

    // A blow that starts a tutorial beat lands visibly but does not wound —
    // otherwise the lesson would kill you before you could practise it.
    if (story && story.onBossLanded()) return;

    const dmg = this.health.max * S.boss.damageFraction;
    this.health.damage(dmg, 'toadel');
    this.effects.damageNumber(_tmp, Math.round(dmg), true);

    if (this.health.justDied) {
      // The story owns what defeat looks like; no ordinary respawn here.
      if (story) { this.deathPending = false; story.beginDefeat(this); }
      else this._die(null);
    }
  }

  _knockDown(nx, nz) {
    this.knockdown = CFG.story.parry.knockdownTime;
    this.parrying = false;
    this.parryHits = 0;
    this.justKnockedDown = true;
    this.combat.reset();
    this.grapple.cancel();
    this.dashTimer = 0;
    this.vel.x += nx * 13;
    this.vel.y = Math.max(this.vel.y, 0) + 5;
    this.vel.z += nz * 13;
    _tmp.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
    this.effects.dustPuff(_tmp, 14, 4, 0xa89878);
    Audio.land(this.pos, true);
    Audio.hurt(this.pos);
  }

  /**
   * Strip every means of moving under your own power.
   *
   * Cancelling the abilities is not enough on its own: queued key presses sit
   * in the input buffer and would all fire the instant control came back, so
   * the buffer is flushed every frame too. Without this you could dash or
   * grapple out of a knockdown.
   */
  _makeHelpless(input) {
    if (input) input.flush();
    if (this.grapple.active) this.grapple.cancel();
    this.dashTimer = 0;
    this.sprinting = false;
    this.parrying = false;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.wallCoyote = 0;
    this.combat.active = false;
  }

  /** Physics only: used for cutscenes and while knocked flat. */
  _updateHelpless(dt, cam) {
    this.vel.y += CFG.move.gravity * dt;
    // Heavy damping: knockback still carries you, but you cannot steer.
    this.vel.x *= Math.exp(-9 * dt);
    this.vel.z *= Math.exp(-9 * dt);
    const cs = this._cstate;
    cs.pos = this.pos; cs.vel = this.vel;
    this.collision.moveCharacter(cs, dt);
    this.grounded = cs.grounded;
    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.visualYaw);
    this.model.update(dt, {
      speed: 0, vy: this.vel.y, grounded: this.grounded, moving: false,
      // Reuse the collapse pose for a knockdown; a cutscene just stands still.
      dead: this.knockdown > 0,
    });
    if (this.knockdown <= 0 && !this.cinematic) this.model.root.rotation.z = 0;
  }

  _updateDead(dt, cam) {
    // A corpse has no agency either — same lockout as a knockdown.
    this._makeHelpless(this._lastInput);
    // Corpse keeps falling so it settles somewhere sensible.
    this.vel.y += CFG.move.gravity * dt;
    this.vel.x *= Math.exp(-5 * dt);
    this.vel.z *= Math.exp(-5 * dt);
    const cs = this._cstate;
    cs.pos = this.pos; cs.vel = this.vel;
    this.collision.moveCharacter(cs, dt);
    this.grounded = cs.grounded;
    this.model.root.position.copy(this.pos);
    this.model.update(dt, { dead: true, speed: 0, grounded: true });
  }

  // ----------------------------------------------------------- post-physics

  /**
   * Rebound off an unclimbable rock face.
   *
   * Rate-limited so grinding against a cliff does not machine-gun the sound
   * and particles; the push itself still applies every frame, which is what
   * makes the wall genuinely impossible to hug.
   */
  _bounceOffCliff(nx, nz) {
    const push = CFG.move.mountainBounce;
    this.vel.x = nx * push;
    this.vel.z = nz * push;
    // No wall-cling, no wall-jump, and a dash into rock simply stops.
    this.wallSliding = false;
    this.wallCoyote = 0;
    if (this.dashTimer > 0) { this.dashTimer = 0; this.dashDir.set(nx, 0, nz); }

    this._bounceCue = (this._bounceCue || 0);
    if (this._bounceCue <= 0) {
      this._bounceCue = 0.35;
      _tmp.set(this.pos.x - nx * 0.4, this.pos.y + 1.0, this.pos.z - nz * 0.4);
      this.effects.dustPuff(_tmp, 6, 2.2, 0x9a9187);
      Audio.land(this.pos, false);
    }
  }

  _postMove(dt, hasInput, cam, dashing) {
    if (this._bounceCue > 0) this._bounceCue -= dt;
    // Coyote time.
    if (this.grounded) {
      this.coyote = CFG.move.coyoteTime;
      this.doubleJumpLeft = 1;
      this.dashCharges = CFG.dash.airCharges;
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }

    // Wall slide + wall coyote.
    const wallish = this.onWall && !this.grounded && this.wallNormal.lengthSq() > 0.1;
    this.wallSliding = wallish && this.vel.y < 1.5;
    if (wallish) {
      this.wallCoyote = CFG.move.wallCoyote;
      this.wallCoyoteNormal.copy(this.wallNormal);
      if (this.wallSliding && Math.random() < dt * 22) {
        this.effects.dustPuff(
          _tmp.set(this.pos.x, this.pos.y + 0.7, this.pos.z), 1, 0.6, 0xcccccc);
      }
    }

    // Landing.
    if (this.landedThisFrame) {
      const hard = this.peakFallSpeed < -24;
      this.effects.dustPuff(this.pos, hard ? 16 : 7, hard ? 4.5 : 2.2, 0xcfc0a0);
      Audio.land(this.pos, hard);
      if (hard) {
        cam.shake(clamp(-this.peakFallSpeed / 130, 0.1, 0.45));
        this.effects.ring(
          _tmp.set(this.pos.x, this.pos.y + 0.1, this.pos.z), 0.4, 4.5, 0.35, 0xffe9b8, true);
      }
      this.events.push({ t: 'land', hard: hard ? 1 : 0, x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z) });
      this.peakFallSpeed = 0;
    }
    this.peakFallSpeed = Math.min(this.peakFallSpeed, this.vel.y);

    // Footsteps.
    if (this.grounded && !dashing) {
      this.stepDistance += Math.hypot(this.vel.x, this.vel.z) * dt;
      // Shorter stride while sprinting keeps the footfalls in step with the
      // faster leg cycle instead of drifting out of sync.
      if (this.stepDistance > (this.sprinting ? 1.7 : 2.4)) {
        this.stepDistance = 0;
        Audio.footstep(this.pos);
        this.effects.dustPuff(this.pos, this.sprinting ? 4 : 2,
          this.sprinting ? 1.8 : 0.9, 0xc8bda6);
      }
    }

    // Sprint wake: streaks behind the frog plus an occasional wind rush.
    // Land only — underwater the swim bubbles already carry the speed.
    if (this.sprinting && !this.inWater) {
      this._sprintTrail -= dt;
      if (this._sprintTrail <= 0) {
        this._sprintTrail = CFG.sprint.trailInterval;
        _tmp.set(-Math.sin(this.visualYaw), 0, -Math.cos(this.visualYaw));
        this.effects.sprintTrail(this.pos, _tmp);
      }
      this._sprintSound -= dt;
      if (this._sprintSound <= 0) {
        this._sprintSound = 0.34;
        Audio.sprintWhoosh(this.pos);
      }
    }

    // Water.
    const wasInWater = this.inWater;
    // Swim once roughly chest-deep, so wading through shallows still walks.
    this.inWater = this.pos.y + CFG.move.height * 0.7 < CFG.world.waterLevel;
    if (this.inWater !== wasInWater) {
      _tmp.set(this.pos.x, CFG.world.waterLevel, this.pos.z);
      this.effects.splash(_tmp);
      Audio.splash(_tmp);
      if (this.inWater) {
        // Water resets your air options — the lake is a safe reset, not a trap.
        this.dashCharges = CFG.dash.airCharges;
        this.doubleJumpLeft = 1;
      }
    }

    // Fell out of the world.
    if (this.pos.y < CFG.world.killPlane) this.killByWorld(cam);
  }

  _updateFacing(dt, hasInput, cam, dashing) {
    let target = this.yaw;
    if (this.combat.attacking) {
      target = this.yaw;                       // locked by the swing
    } else if (this.grapple.attached) {
      // Face the anchor while swinging.
      target = Math.atan2(
        this.grapple.anchor.x - this.pos.x,
        this.grapple.anchor.z - this.pos.z
      ) + Math.PI;
    } else if (dashing) {
      target = Math.atan2(-this.dashDir.x, -this.dashDir.z);
    } else if (hasInput) {
      target = Math.atan2(-_wish.x, -_wish.z);
      this.yaw = target;
    } else {
      target = this.yaw;
    }
    // Snappy but not instant — instant rotation reads as robotic.
    this.visualYaw = dampAngle(this.visualYaw, target, dashing ? 30 : 15, dt);

    // Camera roll leans into fast strafes.
    const lateral = this.vel.x * Math.cos(cam.yaw) - this.vel.z * Math.sin(cam.yaw);
    cam.rollTarget = clamp(-lateral / 240, -0.05, 0.05);
  }

  _updateModel(dt, hasInput) {
    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.visualYaw);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.model.update(dt, {
      speed,
      vy: this.vel.y,
      grounded: this.grounded,
      moving: hasInput && speed > 0.8,
      dashT: this.dashTimer,
      attackT: this.combat.attackT,
      attackIndex: this.combat.comboIndex,
      throwT: this.throwT > 0 ? this.throwT / 0.26 : 0,
      grappling: this.grapple.visible,
      tongueTo: this.grapple.visible ? this.grapple.tip : null,
      wallSliding: this.wallSliding,
      sprinting: this.sprinting,
      swimming: this.inWater,
      swimPitch: this.inWater ? clamp(this.vel.y / 10, -1, 1) : 0,
      parrying: this.parrying,
      dead: this.health.dead,
    });
  }

  /** Hide the local frog's own head when the camera is very close. */
  setSelfVisible(v) { this.model.setVisible(v); }
}

const r2 = (v) => Math.round(v * 100) / 100;
