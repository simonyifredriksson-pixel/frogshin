/**
 * Local player controller.
 *
 * Owns the movement state machine (run / jump / double jump / wall jump /
 * dash / grapple / swim) and drives the combat + health components. Anything
 * other players need to see is pushed onto `this.events`, which the network
 * layer drains once per frame.
 */

import * as THREE from '../lib/three.module.js?v=v47';
import { CFG } from './config.js?v=v47';
import { clamp, damp, dampAngle, lerp, angleDelta } from './util.js?v=v47';
import { FrogModel } from './frog.js?v=v47';
import { Grapple, GrappleState } from './grapple.js?v=v47';
import { Combat, Health } from './combat.js?v=v47';
import { Stamina } from './stamina.js?v=v47';
import { Inventory, SLOT_KEYS, ITEMS } from './items.js?v=v47';
import { Audio } from './audio.js?v=v47';

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
const _assist = new THREE.Vector3();
const _leapTarget = new THREE.Vector3();
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
    // Set each frame by the round manager.
    this.interactPressed = false; // E pressed where there are no crates
    this.tagMode = false;        // the katana tags rather than wounds
    this.isJuggernaut = false;   // slower, tougher, wearing the toad
    this.spectating = false;     // knocked out and watching

    // --- juggernaut leap (its replacement for the grapple) ---
    this.leapCharge = 0;         // seconds of wind-up left
    this.leapChargeTotal = 0;
    this.leapCooldown = 0;
    this.leapDist = 0;
    this.leapTarget = new THREE.Vector3();

    // --- story mode ---
    this.cinematic = false;        // frozen for a cutscene
    this.frozen = false;           // frozen for the defeat sequence
    this.storyParry = false;       // right mouse becomes parry, not throw
    this.parrying = false;
    this.parryHits = 0;            // blows absorbed during the current parry
    this.parryHeld = 0;            // how long this guard has been up
    this.parryCooldown = 0;        // seconds until you may guard again
    this._parryCue = 0;
    this.knockdown = 0;            // seconds face-down and helpless
    this.damageMultiplier = 1;     // broken sword scales this down
    this.justParried = 0;
    this.justKnockedDown = false;

    // --- abilities ---
    this.abilityCd = {};       // id -> seconds remaining
    this.invisibleT = 0;
    this.cloneT = 0;
    this.cloneTrail = [];      // recent poses the clone replays
    this._cloneClock = 0;
    this._abilityCue = 0;
    this._atkSeq = 0;          // bumped on each swing, so the clone can copy it
    this._thrSeq = 0;          // ditto for kunai throws
    this._thrDir = new THREE.Vector3(0, 0, -1);
    this._cloneMoving = false;
    this._cloneWasAttacking = false;

    // Frogath the Divine's two forms. Cosmetic; see setDivinePhase.
    this.divinePhase = 1;
    this.divineMorph = 1;
    this.ascendT = 0;

    // Cosmetic palettes from the shop, if any are equipped.
    this.model = new FrogModel(this.color, this.name, true, opts.skins || null);
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
    // Dying drops any ability that was running — but NOT its cooldown, so
    // death is never a way to refresh one.
    this.invisibleT = 0;
    this.cloneT = 0;
    this.cloneTrail.length = 0;
    this.leapCharge = 0;
    this.leapCooldown = 0;
    // Frogath the Divine goes back to his first form on every respawn: the
    // ascended look is a kill streak you are wearing, so dying costs it.
    this.setDivinePhase(1, true);
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.z = 0;
    this.model.body.position.y = 0;
    this.effects.respawnBurst(this.pos, this.color);
    Audio.respawn(this.pos);
    this.events.push({ t: 'respawn', x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /**
   * FROGATH THE DIVINE — the two-form skin.
   *
   * `divinePhase` is 1 until the first kill of a life, then 2 until death.
   * `divineMorph` runs 0→1 over the transformation so the wings unfold
   * rather than pop, and `ascendT` holds the brief freeze at the start of it.
   *
   * COSMETIC ONLY. Nothing here is read by movement, combat, health or
   * stamina — the ascended form has exactly the stats of the default skin.
   */
  setDivinePhase(n, instant) {
    this.divinePhase = n;
    this.divineMorph = n >= 2 ? (instant ? 1 : 0) : 1;
    this.ascendT = 0;
    if (this.model.setDivinePhase) this.model.setDivinePhase(n, this.divineMorph);
  }

  /** Begin the ascension. Returns false if it is not applicable. */
  beginDivineAscension() {
    if (!this.model.isDivine || this.divinePhase >= 2) return false;
    this.divinePhase = 2;
    this.divineMorph = 0;
    this.ascendT = CFG.divine.duration;
    this.model.setDivinePhase(2, 0);
    this.events.push({ t: 'ascend' });
    return true;
  }

  /** Advance the transformation. Called every frame from the player update. */
  _updateDivine(dt) {
    if (!this.model.isDivine) return;
    if (this.ascendT > 0) {
      this.ascendT = Math.max(0, this.ascendT - dt);
      const D = CFG.divine;
      this.divineMorph = clamp(1 - this.ascendT / D.duration, 0, 1);
      this.model.setDivinePhase(2, this.divineMorph);
    }
  }

  /** The fraction-of-a-second hold at the very start of the ascension. */
  get divineFrozen() {
    return this.ascendT > CFG.divine.duration - CFG.divine.freeze;
  }

  get mouthPosition() {
    // Tracks the rig's ground lift, so the tongue leaves the drawn mouth
    // rather than a point inside the chest.
    return _mouth.set(
      this.pos.x - Math.sin(this.visualYaw) * 0.30,
      this.pos.y + 1.42 + (this.model._lift || 0),
      this.pos.z - Math.cos(this.visualYaw) * 0.30
    );
  }

  /** Snapshot for the network layer. */
  netState() {
    const g = this.grapple.netState();
    const c = this.cloneTransform();
    return {
      // Abilities others must be able to see: the clone has to be visible to
      // work as bait, and invisibility has to be known so viewers can decide
      // whether it applies to them.
      //
      // The clone is packed as a flat array to keep the 20Hz packet small —
      // it carries the pose fields that actually change the silhouette, so a
      // watcher sees it swing and throw, not just glide.
      iv: this.invisibleT > 0 ? 1 : 0,
      // Spectators are invisible to EVERYONE, friend or enemy alike, so this
      // is sent separately from the invisibility ability rather than folded
      // into it — the two hide you from different people.
      sx: this.spectating ? 1 : 0,
      jg: this.isJuggernaut ? 1 : 0,
      cl: c ? [
        r2(c.x), r2(c.y), r2(c.z), r2(c.yaw), r2(c.speed),
        (c.grounded ? 1 : 0) | (c.moving ? 2 : 0) | (c.sprinting ? 4 : 0)
        | (c.swimming ? 8 : 0) | (c.parrying ? 16 : 0) | (c.dead ? 32 : 0)
        | (c.invisible ? 64 : 0),
        r2(c.attackT), c.attackIndex, r2(c.throwT), r2(c.vy),
        c.atk, c.thr, r2(c.tdx), r2(c.tdy), r2(c.tdz),
      ] : null,
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
    this._targets = targets;     // kunai aim assist reads this on throw
    this.health.update(dt);
    this.combat.update(dt);
    this.stamina.update(dt);
    this._updateDivine(dt);
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
    // The divine ascension borrows this for its opening instant — a sixth of
    // a second, short enough that it can never cost you an exchange.
    if (this.knockdown > 0 || this.cinematic || this.frozen || this.divineFrozen) {
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
      // Left mouse uses whatever is in your hand: swing the katana, or throw
      // the kunai. One button for "attack" is the intuitive mapping, and it
      // frees the right button to mean guard and nothing else.
      if (input.consumeAttack()) {
        const held = this.inventory.selectedItem;
        if (held === ITEMS.kunai) this._tryThrowKunai(cam);
        else this._tryAttack(cam);
      }

      // Hotbar: number keys select the matching slot, left to right.
      // An ability slot FIRES instead of selecting — there is nothing to
      // hold, and fumbling for a second keypress mid-chase is miserable.
      for (let i = 0; i < SLOT_KEYS.length; i++) {
        if (!input.consume(SLOT_KEYS[i])) continue;
        const slot = this.inventory.slots[i];
        if (slot && slot.item.ability) this._useAbility(slot.item.id);
        else if (this.inventory.select(i)) Audio.uiClick();
      }
      const wheel = input.takeWheel();
      if (wheel) this._cycleSlot(wheel);
      // Right mouse is PARRY, and only parry. It needs the katana in hand —
      // you cannot turn a blade aside with a handful of kunai — which is the
      // real cost of running kunai as your main weapon.
      const slot = this.inventory.selectedSlot;
      const swordOut = !!slot && slot.item === ITEMS.katana;
      if (swordOut) this._updateParry(dt, input.rightHeld);
      else if (this.parrying) this._dropParry();
      input.consume('MouseRight');
      if (input.consume('KeyE')) this._tryPickup();
    } else {
      this.jumpHeld = false;
    }

    // ---- timers ---------------------------------------------------------
    // Ability timers run whatever else is happening.
    for (const id in this.abilityCd) {
      if (this.abilityCd[id] > 0) this.abilityCd[id] -= dt;
    }
    if (this._abilityCue > 0) this._abilityCue -= dt;
    if (this.invisibleT > 0) {
      this.invisibleT -= dt;
      if (this.invisibleT <= 0) {
        this.effects.puff(
          _tmp.set(this.pos.x, this.pos.y + 1.0, this.pos.z), 0x8fd8ff, 14, 4);
        Audio.tongueRelease(this.pos);
      }
    }
    if (this.cloneT > 0) {
      this.cloneT -= dt;
      this._recordClone(dt);
      if (this.cloneT <= 0) this.cloneTrail.length = 0;
    }

    // The juggernaut's leap winds up and fires here, before movement, so a
    // launch this frame is not immediately overwritten by walk acceleration.
    this._updateLeap(dt);

    if (this._parryCue > 0) this._parryCue -= dt;
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
      // Sprint raises the speed you steer toward. Because acceleration is
      // momentum-preserving, letting go of Shift does not brake you — you
      // simply stop being pushed past the walk cap and coast back down.
      //
      // The juggernaut moves at half pace and gets only half the sprint
      // BONUS (2.0x becomes 1.5x), so running still helps it but never lets
      // it run a frog down — it has to corner you, which is the mode.
      const boost = this.sprinting ? this._sprintMult(sp.speedMult) : 1;
      // Rooted mid-leap-charge: you cannot walk out of your own wind-up.
      const scale = this.leapCharge > 0 ? 0
        : (this.isJuggernaut ? CFG.juggernaut.moveScale : 1);
      const wishSpeed = (this.grounded ? CFG.move.runSpeed : CFG.move.airSpeed)
        * boost * scale;
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
      // A blade drawn at 2.1x scale has to reach further than a frog's, or it
      // visibly passes through people without touching them.
      const reach = this.isJuggernaut ? CFG.juggernaut.reach : 0;
      const hits = this.combat.resolve(this.pos, this.yaw, targets, reach);
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
    const boost = this.sprinting ? this._sprintMult(CFG.sprint.swimMult) : 1;
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
    // A charging leap IS the jump — Space must not quietly cancel it by
    // lifting the toad off the ground mid-wind-up.
    if (this.leapCharge > 0) { this.jumpBuffer = 0; return; }

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
    // The juggernaut grapples like everyone else. It used to charge a leap
    // here instead, as compensation for being slow — now that it moves at
    // full speed it gets the same tongue as the frogs it is hunting, and the
    // mode is a straight fight rather than a chase. `_chargeLeap` and its
    // update are left intact so the leap can be given back if wanted.
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

  // ------------------------------------------------------- juggernaut leap

  /**
   * Begin (or cancel) the juggernaut's charged leap.
   *
   * Aims at whatever the crosshair is on, clamped to the leap's range, and
   * sets a wind-up proportional to how far that is. Pressing G again during
   * the wind-up aborts it, so committing to a long leap is a real decision
   * rather than a misclick you cannot take back.
   */
  _chargeLeap(cam) {
    const L = CFG.juggernaut.leap;
    if (this.leapCharge > 0) {          // already winding up: abort
      this.leapCharge = 0;
      this.leapCooldown = Math.max(this.leapCooldown, 0.4);
      Audio.uiBack();
      return;
    }
    if (this.leapCooldown > 0 || !this.grounded) return;
    // A leap is a jump, and jumps cost stamina.
    if (!this.stamina.canAct) { this._tiredCue = 0.5; return; }

    cam.aimDirection(_aim);
    // Straight down or straight up would make the ballistic solve meaningless.
    const pitch = Math.asin(clamp(_aim.y, -1, 1));
    const clamped = clamp(pitch, -L.maxPitch, L.maxPitch);
    if (clamped !== pitch) {
      const horiz = Math.hypot(_aim.x, _aim.z) || 1e-6;
      const s = Math.cos(clamped) / horiz;
      _aim.set(_aim.x * s, Math.sin(clamped), _aim.z * s);
    }

    // Land on the surface under the crosshair when there is one in range,
    // otherwise at the range limit along the aim.
    const hit = this.collision.raycast(
      cam.pos.x, cam.pos.y, cam.pos.z, _aim.x, _aim.y, _aim.z, L.range);
    if (hit) _leapTarget.set(hit.x, hit.y, hit.z);
    else _leapTarget.copy(cam.pos).addScaledVector(_aim, L.range);

    const d = Math.hypot(_leapTarget.x - this.pos.x, _leapTarget.z - this.pos.z);
    const k = clamp(d / L.range, 0, 1);
    this.leapTarget.copy(_leapTarget);
    this.leapDist = d;
    this.leapChargeTotal = lerp(L.minCharge, L.maxCharge, k);
    this.leapCharge = this.leapChargeTotal;

    Audio.tone({
      freq: 90, to: 240, dur: this.leapChargeTotal,
      type: 'sawtooth', volume: 0.13, pos: this.pos,
    });
    this.events.push({
      t: 'leapUp', c: r2(this.leapChargeTotal),
      x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
    });
  }

  /** Tick the wind-up, then launch. */
  _updateLeap(dt) {
    if (this.leapCooldown > 0) this.leapCooldown -= dt;
    if (this.leapCharge <= 0) return;

    // Rooted while charging: the whole point is that it is committed and
    // readable. Coming off the ground cancels it.
    if (!this.grounded) { this.leapCharge = 0; return; }
    this.vel.x *= Math.exp(-14 * dt);
    this.vel.z *= Math.exp(-14 * dt);

    const t = 1 - this.leapCharge / this.leapChargeTotal;
    this._leapFx = (this._leapFx || 0) - dt;
    if (this._leapFx <= 0) {
      this._leapFx = 0.09;
      // A ring that tightens as the charge completes.
      this.effects.ring(
        _tmp.set(this.pos.x, this.pos.y + 0.15, this.pos.z),
        2.6 * (1 - t) + 0.4, 0.5, 0.22, 0xffb03c, false, { x: 0, y: 1, z: 0 });
    }

    this.leapCharge -= dt;
    if (this.leapCharge > 0) return;
    this._launchLeap();
  }

  /**
   * Hurl the toad at the charged target.
   *
   * Solves the ballistic arc for a chosen flight time, so it genuinely lands
   * where it aimed instead of being launched at a fixed angle and hoping.
   */
  _launchLeap() {
    const L = CFG.juggernaut.leap;
    const g = CFG.move.gravity;                   // negative
    const dx = this.leapTarget.x - this.pos.x;
    const dz = this.leapTarget.z - this.pos.z;
    const dy = this.leapTarget.y - this.pos.y;
    const k = clamp(this.leapDist / L.range, 0, 1);
    const T = lerp(L.flightMin, L.flightMax, k);

    this.vel.x = dx / T;
    this.vel.z = dz / T;
    // vy chosen so the arc passes through the target at exactly time T.
    this.vel.y = (dy - 0.5 * g * T * T) / T;

    this.stamina.spend(CFG.stamina.jumpCost);
    this.leapCooldown = L.cooldown;
    this.grounded = false;
    this.coyote = 0;
    this.airTime = 0;

    _tmp.set(this.pos.x, this.pos.y + 0.2, this.pos.z);
    this.effects.dustPuff(_tmp, 20, 6, 0xcfc0a0);
    this.effects.ring(_tmp, 0.4, 5.0, 0.5, 0xffb03c, true);
    Audio.doubleJump(this.pos);
    Audio.land(this.pos, true);
    this.events.push({
      t: 'leap', x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
    });
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

  /**
   * Scale a sprint multiplier for whoever is running.
   *
   * The juggernaut halves the BONUS, not the multiplier — halving 2.0x to
   * 1.0x would make Shift do nothing at all, which is not "less effective",
   * it is broken. 2.0x becomes 1.5x; 1.5x underwater becomes 1.25x.
   */
  _sprintMult(base) {
    if (!this.isJuggernaut) return base;
    return 1 + (base - 1) * CFG.juggernaut.sprintBonusScale;
  }

  // ------------------------------------------------------------ abilities

  /** Fire an ability if it is off cooldown. */
  _useAbility(id) {
    const A = CFG.abilities[id];
    if (!A) return;
    if ((this.abilityCd[id] || 0) > 0) {
      if (!this._abilityCue || this._abilityCue <= 0) {
        this._abilityCue = 0.4;
        Audio.uiBack();
      }
      return;
    }
    this.abilityCd[id] = A.cooldown;

    if (id === 'invisibility') {
      this.invisibleT = A.duration;
      this.effects.puff(
        _tmp.set(this.pos.x, this.pos.y + 1.0, this.pos.z), 0x8fd8ff, 22, 5);
      this.effects.ring(_tmp, 0.4, 3.4, 0.45, 0x8fd8ff, true);
      Audio.tone({ freq: 900, to: 220, dur: 0.4, type: 'sine', volume: 0.16, pos: this.pos });
      Audio.tongueRelease(this.pos);
      this.events.push({
        t: 'abil', a: 'invisibility',
        x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
      });
    } else if (id === 'shadowclone') {
      this.cloneT = A.duration;
      // Seed the history so the clone has something to copy immediately.
      this.cloneTrail.length = 0;
      this._recordClone(0);
      this.effects.puff(
        _tmp.set(this.pos.x, this.pos.y + 1.0, this.pos.z), 0x9a7aff, 24, 6);
      this.effects.ring(_tmp, 0.4, 3.8, 0.45, 0x9a7aff, true);
      Audio.doubleJump(this.pos);
      this.events.push({
        t: 'abil', a: 'shadowclone',
        x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
      });
    }
  }

  /**
   * Record one frame of everything the clone needs to be you.
   *
   * The whole pose is captured, not just the position — the clone is meant to
   * be indistinguishable from you at a glance, so it has to swing, throw,
   * parry, sprint, swim and vanish exactly as you did. Replaying a recorded
   * pose is what guarantees that: there is no second animation path that
   * could drift out of step with the real one.
   *
   * Swings and throws are caught as rising edges of a counter rather than by
   * hooking the attack code, so a new action can never be missed or double
   * fired during the replay.
   */
  _recordClone(dt) {
    const A = CFG.abilities.shadowclone;
    this._cloneClock = (this._cloneClock || 0) + dt;

    const attacking = !!this.combat.attacking;
    if (attacking && !this._cloneWasAttacking) this._atkSeq = (this._atkSeq || 0) + 1;
    this._cloneWasAttacking = attacking;

    const g = this.grapple.visible;
    this.cloneTrail.push({
      t: this._cloneClock,
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      yaw: this.visualYaw,
      speed: Math.hypot(this.vel.x, this.vel.z),
      vy: this.vel.y,
      grounded: this.grounded,
      moving: this._cloneMoving,
      dashT: this.dashTimer,
      attackT: this.combat.attackT,
      attackIndex: this.combat.comboIndex,
      throwT: this.throwT > 0 ? this.throwT / 0.26 : 0,
      sprinting: this.sprinting,
      swimming: this.inWater,
      swimPitch: this.inWater ? clamp(this.vel.y / 10, -1, 1) : 0,
      parrying: this.parrying,
      wallSliding: this.wallSliding,
      dead: this.health.dead,
      grappling: g,
      gx: g ? this.grapple.tip.x : 0,
      gy: g ? this.grapple.tip.y : 0,
      gz: g ? this.grapple.tip.z : 0,
      // Sequence counters — a change during replay means "do it now".
      // The throw direction is carried on EVERY sample, not just the throwing
      // one, so a replay frame that steps over the exact throw sample still
      // knows which way the kunai went.
      atk: this._atkSeq || 0,
      thr: this._thrSeq || 0,
      tdx: this._thrDir.x, tdy: this._thrDir.y, tdz: this._thrDir.z,
      // Your clone hides when you hide.
      invisible: this.invisibleT > 0,
    });
    // Drop history older than the buffer window.
    while (this.cloneTrail.length > 2
      && this._cloneClock - this.cloneTrail[0].t > A.buffer) {
      this.cloneTrail.shift();
    }
  }

  /**
   * The pose the clone should hold right now, or null.
   *
   * Position and facing are interpolated; discrete state is taken from the
   * nearer sample, because a half-drawn sword is not a pose.
   */
  cloneTransform() {
    if (this.cloneT <= 0 || this.cloneTrail.length < 2) return null;
    const A = CFG.abilities.shadowclone;
    const want = this._cloneClock - A.delay;
    const trail = this.cloneTrail;
    if (want <= trail[0].t) return trail[0];
    for (let i = 0; i < trail.length - 1; i++) {
      const a = trail[i], b = trail[i + 1];
      if (want >= a.t && want <= b.t) {
        const span = b.t - a.t;
        const k = span > 1e-6 ? (want - a.t) / span : 0;
        const near = k < 0.5 ? a : b;
        return {
          ...near,
          x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k),
          yaw: a.yaw + angleDelta(a.yaw, b.yaw) * k,
          speed: lerp(a.speed, b.speed, k),
          vy: lerp(a.vy, b.vy, k),
        };
      }
    }
    return trail[trail.length - 1];
  }

  /** Step the hotbar selection, skipping empty slots. */
  _cycleSlot(dir) {
    const slots = this.inventory.slots;
    const n = slots.length;
    for (let step = 1; step <= n; step++) {
      // + n * n keeps the value positive before the wrap for either direction.
      const i = (this.inventory.selected + dir * step + n * n) % n;
      // Ability slots are skipped: the wheel picks what you HOLD, and you
      // never hold an ability.
      if (slots[i] && !slots[i].item.ability) {
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

    // Aim assist: pick a nearby player or dummy inside a narrow cone. The
    // kunai then curves toward it in flight rather than being snapped onto
    // it here, so a throw that was never close still misses.
    const assist = this._pickKunaiTarget(o, dir);

    this.kunai.throw_(o, dir, this.id, true, assist ? assist.id : null);
    Audio.kunaiThrow(this.pos);
    // Let the clone throw one too, a beat later.
    this._thrSeq++;
    this._thrDir.copy(dir);
    this.events.push({
      t: 'kunai',
      x: r2(o.x), y: r2(o.y), z: r2(o.z),
      dx: r2(dir.x), dy: r2(dir.y), dz: r2(dir.z),
      tid: assist ? assist.id : undefined,
    });
  }

  /**
   * Best aim-assist candidate for a throw: the target closest to the line
   * you are actually aiming along. Only players and dummies qualify —
   * scenery is never assisted.
   */
  _pickKunaiTarget(origin, dir) {
    const K = CFG.kunai;
    const list = this._targets;
    if (!list || !list.length) return null;

    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || t.dead) continue;
      const box = t.hitbox || CFG.hitbox.player;
      _assist.set(
        t.pos.x - origin.x,
        (t.pos.y + box.bodyOffset) - origin.y,
        t.pos.z - origin.z
      );
      const dist = _assist.length();
      if (dist < 2 || dist > K.assistRange) continue;
      _assist.multiplyScalar(1 / dist);
      const dot = _assist.dot(dir);
      if (dot <= 0) continue;
      const angle = Math.acos(clamp(dot, -1, 1));
      if (angle > K.assistAngle) continue;
      // Tightest angle wins; distance only breaks near-ties.
      const score = angle * 10 + dist * 0.003;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  /** Grab the nearest kunai crate. */
  _tryPickup() {
    // Spectators have endless kunai and no business taking crates the living
    // still need.
    if (this.spectating) return;
    // No crate system means we are somewhere with other things to interact
    // with (the story's fruit stalls). Raise a one-shot flag the game reads,
    // rather than reaching out of the controller into the world.
    if (!this.pickups) { this.interactPressed = true; return; }
    if (this.health.dead) return;
    // A crate wins if there is one in reach; otherwise E is free for
    // whatever else is here — the arena's statue, for one.
    if (!this.pickups.nearest(this.pos)) { this.interactPressed = true; return; }
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

  /**
   * Damage for one katana hit, before the story's broken-sword multiplier.
   *
   * The juggernaut's blade is a flat figure rather than a combo ramp — it is
   * an execution tool, not a rhythm, and a monster that hits for a different
   * amount depending on which swing landed is just confusing to fight.
   */
  swordDamage(h) {
    if (this.isJuggernaut) return CFG.juggernaut.swordDamage;
    return h.damage;
  }

  _applyHits(hits, cam) {
    // Spectators swing through everyone. Dummies still react, so there is
    // something to do while you wait.
    if (this.spectating) {
      for (const h of hits) {
        if (h.target.isDummy && h.target.onHit) {
          h.target.onHit(
            Math.round(this.swordDamage(h) * this.damageMultiplier), h.dirX, h.dirZ);
        }
      }
      return;
    }
    for (const h of hits) {
      _tmp.set(h.target.pos.x, h.target.pos.y + 1.0, h.target.pos.z);
      this.effects.hitBurst(_tmp, { x: h.dirX, y: 0, z: h.dirZ }, h.heavy);
      Audio.hit(_tmp, h.heavy);
      cam.shake(h.heavy ? 0.5 : 0.3);

      // Training dummies are purely local practice targets: they show their
      // own short damage flash and never touch the network.
      if (h.target.isDummy) {
        if (h.target.onHit) {
          h.target.onHit(
            Math.round(this.swordDamage(h) * this.damageMultiplier), h.dirX, h.dirZ);
        }
        continue;
      }

      // Tag and Infection: the blade tags instead of wounding. Routed through
      // the target's own onHit — the very same callback a thrown kunai uses —
      // so both weapons obey one copy of the tag rules (who may tag, who is
      // already it, immunity) and cannot drift apart.
      if (this.tagMode) {
        if (h.target.onHit) h.target.onHit(0, h.dirX, h.dirZ, false, _tmp);
        continue;
      }

      // Any other mode without damage leaves the swing purely cosmetic.
      if (!this.combatEnabled) continue;

      // The number shown and the number SENT are the same value. They used to
      // be computed separately, so a damage multiplier would show one figure
      // and inflict another.
      const dmg = Math.round(this.swordDamage(h) * this.damageMultiplier);
      this.effects.damageNumber(_tmp, dmg, h.heavy);
      this.events.push({
        t: 'hit',
        id: h.target.id,
        dmg,
        kx: r2(h.dirX * h.knockback),
        ky: r2(h.knockbackUp),
        kz: r2(h.dirZ * h.knockback),
        c: h.index,
      });
    }
  }

  /** Damage requested by another player. Returns true if it landed. */
  receiveHit(dmg, kx, ky, kz, fromId, cam) {
    // A spectator is out of the match entirely: nothing reaches them, and
    // nothing they do reaches anyone else.
    if (this.spectating) return false;
    if (this.health.dead || this.health.protected) return false;

    // A raised guard turns the blow aside — same rule everywhere, including
    // the arena: the second hit absorbed inside one parry breaks it.
    if (this.parrying) {
      const len = Math.hypot(kx, kz) || 1;
      const nx = kx / len, nz = kz / len;
      this.parryHits++;
      this.justParried = 0.2;
      if (this.parryHits >= CFG.story.parry.knockdownAfter) {
        this._breakParry(nx, nz);
        return false;
      }
      this.vel.x += nx * 7;
      this.vel.z += nz * 7;
      this.combat.hitstop = CFG.story.parry.chipStagger;
      _tmp.set(this.pos.x + nx * 0.6, this.pos.y + 1.1, this.pos.z + nz * 0.6);
      this.effects.hitBurst(_tmp, { x: -nx, y: 0, z: -nz }, true);
      this.effects.ring(_tmp, 0.3, 2.6, 0.3, 0xbfe3ff, false, { x: nx, y: 0, z: nz });
      Audio.parry(this.pos);
      if (cam) cam.shake(0.2);
      return false;
    }
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

  /**
   * The guard.
   *
   * Holding right mouse used to be free: the block never dropped, never ran
   * out and never had to be timed, so against anything that telegraphs you
   * could simply stand there. It is now a commitment — a short window, on a
   * cooldown, that punishes you badly if it breaks.
   */
  _updateParry(dt, held) {
    const P = CFG.story.parry;
    if (this.parryCooldown > 0) this.parryCooldown -= dt;

    if (this.parrying) {
      this.parryHeld += dt;
      // Drops on its own, so a held button is never a permanent shield.
      if (!held || this.parryHeld >= P.maxHold) this._dropParry();
      return;
    }
    if (!held || this.parryCooldown > 0) {
      // A cue the first time you try to guard too soon, rate-limited so it
      // cannot spam while the button is held down.
      if (held && (!this._parryCue || this._parryCue <= 0)) {
        this._parryCue = 0.5;
        Audio.uiBack();
      }
      return;
    }
    this.parrying = true;
    this.parryHeld = 0;
    this.parryHits = 0;
    Audio.uiHover();
  }

  /** Lower the guard and start its cooldown. */
  _dropParry() {
    if (!this.parrying) return;
    this.parrying = false;
    this.parryHits = 0;
    this.parryHeld = 0;
    this.parryCooldown = CFG.story.parry.cooldown;
  }

  /**
   * A guard broken by a second blow.
   *
   * Rather than the story's full knockdown, this is a short total lockout:
   * you cannot move, attack, dash or guard for `breakLock` seconds. Greedy
   * blocking has to cost something, and it is the same cost everywhere.
   */
  _breakParry(nx, nz) {
    const P = CFG.story.parry;
    this.parrying = false;
    this.parryHits = 0;
    this.parryHeld = 0;
    this.parryCooldown = P.cooldown;
    this.knockdown = Math.max(this.knockdown, P.breakLock);
    this.justKnockedDown = true;
    this.combat.reset();
    this.grapple.cancel();
    this.dashTimer = 0;
    this.vel.x += nx * 9;
    this.vel.z += nz * 9;
    _tmp.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
    this.effects.puff(_tmp, 0xffd24a, 16, 6);
    this.effects.ring(_tmp, 0.4, 3.4, 0.4, 0xffd24a, false, { x: nx, y: 0, z: nz });
    Audio.exhausted(this.pos);
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
    // Stashed for the clone recorder, which cannot see `hasInput` itself.
    this._cloneMoving = hasInput && speed > 0.8;
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
