/**
 * Local player controller.
 *
 * Owns the movement state machine (run / jump / double jump / wall jump /
 * dash / grapple / swim) and drives the combat + health components. Anything
 * other players need to see is pushed onto `this.events`, which the network
 * layer drains once per frame.
 */

import * as THREE from '../lib/three.module.js?v=v134';
import { CFG } from './config.js?v=v134';
import { clamp, damp, dampAngle, lerp, angleDelta } from './util.js?v=v134';
import { FrogModel } from './frog.js?v=v134';
import { Grapple, GrappleState } from './grapple.js?v=v134';
import { Combat, Health } from './combat.js?v=v134';
import { Stamina } from './stamina.js?v=v134';
import { Inventory, SLOT_KEYS, ITEMS } from './items.js?v=v134';
import { Audio } from './audio.js?v=v134';
// The rules the three chained abilities run on — what may be targeted, what
// counts as a perfect release, where a step lands. See js/abilities.js.
import {
  SHELL, shellPerfect, shellRelease, shellBurst,
  pickTongueTarget, tonguePullPoint,
  nextStepTarget, stepCandidates, stepStandPoint, bossAnchors, planLightningStep,
} from './abilities.js?v=v134';

const _wish = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _swimWish = new THREE.Vector3();
const _throwOrigin = new THREE.Vector3();
const _render = new THREE.Vector3();
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
    /** Counts down through the reach-out gesture. See `reachOut`. */
    this.reachT = 0;
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

    /**
     * What to do when a CONSUMABLE hotbar slot is pressed.
     *
     * Set by whichever mode put one there — only the open world does — and
     * called with the item. Left null everywhere else, so the arena, the
     * story and the dungeon are unchanged.
     */
    this.onUseItem = null;

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

    /**
     * EARTH SHELL — `{ left, struck, burst }` while the stone is up, else
     * null. `struck` is the counter window a blocked blow opened; `burst` is
     * the tail after it goes off, kept so the model and the network have
     * something to show while you are still flying.
     */
    this.shell = null;
    this.shellBurst = 0;
    /** TONGUE TRAP — `{ target, phase, t, to }` while a catch is in flight. */
    this.trap = null;
    /** id -> seconds of "cannot be caught again", so nobody is juggled. */
    this.trapImmune = new Map();
    /** LIGHTNING STEP — the chain state machine; see `_updateStep`. */
    this.step = null;

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
    /** Render-only lag behind `pos` while climbing a ledge. See _absorbStep. */
    this.stepSmooth = 0;
    /** 1 the frame a ledge is stepped onto, decaying — drives the climb pose. */
    this.climbing = 0;
    this.yaw = 0;
    this.visualYaw = 0;
    this.inWater = false;
    this.swimStroke = 0;
    this.sprinting = false;
    /**
     * THE PROCESSION LOCK — no dash, no grapple, no sprint.
     *
     * Set while the player is walking the carpet after the coronation. See
     * js/coronation.js: the point of that walk is that it is a WALK, and a
     * player who can dash the length of a hundred-metre carpet in three
     * seconds has not had a coronation, they have had a loading screen.
     *
     * Deliberately one flag on the player rather than three checks in the
     * caller. It is read in exactly three places below — the sprint
     * modifier, the dash key and the grapple key — and everything else the
     * player can do, including jumping, swinging and looking around, still
     * works. Being unable to move at all would be a cutscene, and this is
     * meant to be something the player does.
     */
    this.solemn = false;
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

    /**
     * --- catching an edge ---
     *
     * `ledge` is null or `{ hx, hy, hz, tx, ty, tz, t }`: where the frog
     * hangs, where it ends up on top, and how long it has been holding on.
     * See `_updateLedge`, and CFG.ledge for why any of this exists.
     */
    this.ledge = null;
    this.ledgeCooldown = 0;
    /** 1 the frame an edge is caught, decaying. Drives the hang pose. */
    this.hanging = 0;

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
    this.ledge = null;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashCharges = CFG.dash.airCharges;
    this.doubleJumpLeft = 1;
    // Dying drops any ability that was running — but NOT its cooldown, so
    // death is never a way to refresh one.
    this.invisibleT = 0;
    this.cloneT = 0;
    this.cloneTrail.length = 0;
    this.shell = null;
    this.shellBurst = 0;
    this.trap = null;
    this.step = null;
    this.leapCharge = 0;
    this.leapCooldown = 0;
    // Frogath the Divine goes back to his first form on every respawn: the
    // ascended look is a kill streak you are wearing, so dying costs it.
    this.setDivinePhase(1, true);
    // No leftover climb: a respawn must not draw the frog under the floor.
    this.stepSmooth = 0;
    this.climbing = 0;
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
      /**
       * The three chained abilities, as one byte of "what is this frog
       * doing" rather than three fields.
       *
       * Watchers need these for the same reason they need the clone: an
       * opponent sealed in stone must LOOK sealed in stone, or the shell
       * reads as a bug where your hits stop landing for no reason. Bit 4
       * marks the counter window, which is the tell that a good player is
       * supposed to be able to see and step back from.
       */
      ab: (this.shell ? 1 : 0)
        | (this.step ? 2 : 0)
        | (this.shell && this.shell.struck > 0 ? 4 : 0)
        | (this.trap ? 8 : 0)
        | (this.shellBurst > 0 ? 16 : 0),
      // Where the tongue is reaching, so watchers see the same line the
      // thrower does. Only sent while one is actually out.
      tt: this.trap && this.trap.target ? [
        r2(this.trap.target.pos.x),
        r2(this.trap.target.pos.y + 1.0),
        r2(this.trap.target.pos.z),
      ] : null,
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
    this.sprinting = active && hasInput && !this.solemn && this.stamina.canAct
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
    /**
     * Stone means stone. While the shell is up you may do exactly one thing
     * — let it go — and every other action is refused.
     *
     * The presses are still CONSUMED (see the note on the procession lock
     * below): skipping `consume` would leave them in the buffer and the
     * frog would dash, swing and throw all at once the instant the shell
     * came down, from wherever the player had been mashing.
     */
    const sealed = !!this.shell || !!this.step;
    if (active && sealed) {
      input.consume('Space');
      input.consume('KeyQ');
      input.consume('KeyG');
      input.consume('KeyE');
      input.consume('MouseRight');
      input.takeWheel();
      this.jumpHeld = false;
      /**
       * ONE BUTTON, AND IT MEANS "NOW".
       *
       * Left mouse releases the shell and continues the lightning chain.
       * The ability's own hotbar key does the same — see `_useAbility` —
       * but both of these are fighting moves with a window measured in
       * fractions of a second, and reaching for a number key mid-exchange
       * is how you miss it.
       */
      const now = this.shell ? 'earthshell' : 'lightningstep';
      const answer = () => {
        if (this.shell) this._releaseShell(); else this._stepOnward();
      };
      if (input.consumeAttack()) answer();
      for (let i = 0; i < SLOT_KEYS.length; i++) {
        if (!input.consume(SLOT_KEYS[i])) continue;
        const slot = this.inventory.slots[i];
        if (slot && slot.item.id === now) answer();
      }
    } else if (active) {
      if (input.consume('Space')) this.jumpBuffer = CFG.move.jumpBuffer;
      this.jumpHeld = input.down('Space');
      /**
       * Dash and grapple, unless the procession lock is on.
       *
       * The presses are still CONSUMED while locked. `consume` is what
       * clears a key from the buffer, so skipping the call would leave Q
       * sitting there and the player would dash the instant the walk ended
       * — from wherever they had been mashing it.
       */
      if (input.consume('KeyQ') && !this.solemn) {
        this._tryDash(_wish, hasInput, cam);
      }
      if (input.consume('KeyG') && !this.solemn) this._toggleGrapple(cam);
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
        // A consumable is USED, and what using it means belongs to the mode
        // that put it there — the open world's meal comes out of a bag this
        // controller knows nothing about.
        else if (slot && slot.item.consume) {
          if (this.onUseItem) this.onUseItem(slot.item);
        } else if (this.inventory.select(i)) Audio.uiClick();
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
    if (this.reachT > 0) this.reachT -= dt;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.coyote > 0) this.coyote -= dt;
    if (this.wallCoyote > 0) this.wallCoyote -= dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;

    // ---- the three chained abilities ------------------------------------
    this._updateShell(dt, cam);
    this._updateTrap(dt, cam);

    /**
     * A LIGHTNING STEP OWNS THE BODY OUTRIGHT.
     *
     * Position is written straight from the chain, so gravity, friction,
     * steering and collision all have to stay out of it — being an arc of
     * lightning is precisely not being a frog subject to physics. The early
     * return is what guarantees that rather than a pile of flags checked in
     * six places further down.
     *
     * The model still updates, because a frog frozen mid-pose while it
     * crosses the arena looks like the game has hung.
     */
    if (this.step) {
      this._updateStep(dt, cam);
      this.visualYaw = this.yaw;
      this.model.root.position.set(this.pos.x, this.pos.y, this.pos.z);
      this._updateModel(dt, false);
      return;
    }

    // ---- jump -----------------------------------------------------------
    if (this.jumpBuffer > 0) this._tryJump(_wish, hasInput);

    // Variable jump height: releasing Space early clips the rise.
    if (!this.jumpHeld && this.vel.y > 0 && !this.grounded && this.dashTimer <= 0) {
      this.vel.y *= Math.pow(CFG.move.jumpCutMult, dt * 12);
    }

    // ---- horizontal movement -------------------------------------------
    const dashing = this.dashTimer > 0;
    if (this.shell) {
      /**
       * Rooted. Gravity below still runs, so a shell raised in mid-air
       * drops like the boulder it looks like — which is both the right
       * picture and the reason the ability is not an air-stall.
       */
      this.vel.x = 0;
      this.vel.z = 0;
    } else if (this.inWater && !dashing) {
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
    this._absorbStep(cs.stepUp, dt);
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

    /**
     * Holding an edge: Space means "pull up now" rather than "jump".
     *
     * Deliberately ABOVE the stamina check. Being winded while hanging off
     * a lip must not be able to strand you there — the catch is a mercy and
     * it would be a strange one that could leave you stuck.
     */
    if (this.ledge) { this._mantle(); this.jumpBuffer = 0; return; }

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

    // A dash costs stamina, and being exhausted refuses it outright — the
    // same rule jumping already follows. Charged here, before anything is
    // committed, so a refused dash consumes nothing but the cue.
    if (!this.stamina.canAct) {
      if (this._tiredCue <= 0) {
        this._tiredCue = 0.55;            // rate-limit the "can't do that" cue
        Audio.exhausted(this.pos);
      }
      return;
    }
    this.stamina.spend(CFG.stamina.dashCost);

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

    /**
     * ═══ A SECOND PRESS IS NOT A SECOND CAST ═══════════════════════════
     *
     * Two of these abilities are answered rather than fired: the shell is
     * released, and the lightning chain is continued. Both of those are the
     * same key pressed again, so the re-press has to be caught BEFORE the
     * cooldown check — the cooldown is already running by then, and the
     * player would get the "not ready" buzz for pressing exactly the key
     * the ability just told them to press.
     */
    if (id === 'earthshell' && this.shell) { this._releaseShell(); return; }
    if (id === 'lightningstep' && this.step) { this._stepOnward(); return; }

    if ((this.abilityCd[id] || 0) > 0) {
      if (!this._abilityCue || this._abilityCue <= 0) {
        this._abilityCue = 0.4;
        Audio.uiBack();
      }
      return;
    }

    /**
     * ═══ A CAST THAT FINDS NOTHING IS NOT A CAST ═══════════════════════
     *
     * The two aimed abilities can refuse, and a refusal must cost nothing —
     * no cooldown, no flash, no sound beyond the small "that did not take"
     * cue they play themselves. An ability that swallows twelve seconds for
     * being pointed at empty air is experienced as broken however carefully
     * the behaviour is written down.
     *
     * They are therefore attempted BEFORE the cooldown is charged, and they
     * return false to mean "nothing happened".
     */
    if (id === 'lightningstep' && !this._castLightningStep(A)) return;
    if (id === 'tonguetrap' && !this._castTongueTrap(A)) return;

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
    } else if (id === 'earthshell') {
      this._raiseShell(A);
    }
  }

  /** Announce an ability to the room, so everyone sees the same flash. */
  _abilEvent(a, extra) {
    const ev = {
      t: 'abil', a,
      x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z),
    };
    if (extra) for (const k in extra) ev[k] = extra[k];
    this.events.push(ev);
  }

  /**
   * The cue for an ability that declined to fire.
   *
   * Deliberately the same sound as pressing one on cooldown: in both cases
   * the answer is "not now", and inventing a second failure noise only asks
   * the player to learn the difference between two kinds of nothing.
   */
  _abilityRefused() {
    if (!this._abilityCue || this._abilityCue <= 0) {
      this._abilityCue = 0.4;
      Audio.uiBack();
    }
    return false;
  }

  /** What this frog is allowed to point an ability at. */
  _abilityOpts() {
    return {
      hostile: (t) => this._isHostileTarget(t),
      los: (from, t) => this._hasLineTo(from, t),
    };
  }

  /**
   * Is this something the abilities should be willing to grab or chain to?
   *
   * Your own clone and your own teammates are not. The check is delegated
   * to the game through `onIsHostile` when one is set, because only the game
   * knows about rounds and teams — offline, everything that can be hit is
   * fair game, which is what a practice session wants.
   */
  _isHostileTarget(t) {
    if (!t || t.id === this.id) return false;
    if (this.onIsHostile) return !!this.onIsHostile(t);
    return true;
  }

  /**
   * Clear line from here to a target's middle.
   *
   * Grapple anchors are floating hint points rather than geometry, so a hit
   * on one is not a wall — without that exclusion every anchor in the level
   * would cast a shadow that abilities could not reach through.
   */
  _hasLineTo(from, t) {
    if (!this.collision || !this.collision.raycast) return true;
    const ax = from.x, ay = (from.y || 0) + 1.0, az = from.z;
    const bx = t.pos.x;
    const by = t.pos.y + ((t.hitbox && t.hitbox.bodyOffset) || 1.0);
    const bz = t.pos.z;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const hit = this.collision.raycast(
      ax, ay, az, dx / len, dy / len, dz / len, len - 0.4);
    return !hit || hit.tag === 'anchor';
  }

  // ------------------------------------------------------------ earth shell

  /**
   * ═══ EARTH SHELL ═══════════════════════════════════════════════════════
   *
   * Stone closes over you. Nothing gets through and you can do nothing —
   * see `CFG.abilities.earthshell` for why that trade is the ability.
   */
  _raiseShell(A) {
    this.shell = { left: A.duration, struck: 0, hits: 0 };
    // A guard and a shell are the same idea and must not stack; the stone is
    // strictly better, so it takes over.
    if (this.parrying) this._dropParry();
    this.grapple.cancel();
    this.dashTimer = 0;
    this.combat.reset();
    _tmp.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
    this.effects.ring(_tmp, 0.6, 3.2, 0.42, 0xb98a52, true);
    this.effects.puff(_tmp, 0x8a6a44, 26, 7);
    Audio.tone({ freq: 150, to: 60, dur: 0.42, type: 'square', volume: 0.2, pos: this.pos });
    this._abilEvent('earthshell', { s: 1 });
  }

  /**
   * A blow the stone turned aside.
   *
   * The counter window opens HERE rather than on a timer, because this is
   * the moment the ability is built around: something hit you, and now you
   * have half a second to answer it. Called from `receiveHit` and from the
   * single-player damage path, so both kinds of attacker open it.
   */
  shellAbsorb(kx, kz) {
    if (!this.shell) return false;
    const A = CFG.abilities.earthshell;
    this.shell.struck = A.counterWindow;
    this.shell.hits++;
    const len = Math.hypot(kx, kz) || 1;
    _tmp.set(this.pos.x + (kx / len) * 0.9, this.pos.y + 1.0, this.pos.z + (kz / len) * 0.9);
    this.effects.hitBurst(_tmp, { x: -kx / len, y: 0, z: -kz / len }, true);
    this.effects.puff(_tmp, 0xb98a52, 10, 5);
    Audio.parry(this.pos);
    return true;
  }

  /**
   * Let the stone go.
   *
   * Inside a window this is the burst the ability exists for; outside one it
   * simply crumbles. The cooldown is untouched either way — it started when
   * you cast, so a wasted shell costs exactly what a perfect one does. That
   * is what makes the timing worth learning rather than worth retrying.
   */
  _releaseShell() {
    const A = CFG.abilities.earthshell;
    const kind = shellRelease(this.shell, A);
    const shell = this.shell;
    this.shell = null;
    if (kind !== SHELL.PERFECT) {
      _tmp.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
      this.effects.puff(_tmp, 0x7a5f3e, 16, 4);
      Audio.tone({ freq: 90, to: 40, dur: 0.3, type: 'square', volume: 0.12, pos: this.pos });
      this._abilEvent('earthshell', { s: 0 });
      return;
    }

    // ---- the burst ----
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.vel.x = fx * A.launch;
    this.vel.z = fz * A.launch;
    this.vel.y = Math.max(this.vel.y, 0) + A.lift;
    this.health.invulnerable = Math.max(this.health.invulnerable, A.invulnerable);
    this.shellBurst = 0.35;
    this.dashCharges = CFG.dash.airCharges;

    _tmp.set(this.pos.x, this.pos.y + 0.8, this.pos.z);
    this.effects.ring(_tmp, 0.5, A.radius * 1.3, 0.42, 0xd8a760, true);
    this.effects.puff(_tmp, 0xb98a52, 34, 13);
    this.effects.dashBurst(this.pos, { x: fx, y: 0, z: fz }, 0xd8a760);
    Audio.tone({ freq: 220, to: 70, dur: 0.5, type: 'square', volume: 0.28, pos: this.pos });
    Audio.dash(this.pos);

    this._shellShove(A, shell);
    this._abilEvent('earthshell', { s: 2 });
  }

  /** Throw everyone near the burst off, and chip them for it. */
  _shellShove(A, shell) {
    const hits = shellBurst(this.pos, this._targets, A, this._abilityOpts());
    for (const h of hits) {
      // Falls off with distance: standing next to the stone is the mistake,
      // being in the neighbourhood is not.
      const k = 1 - (h.dist / A.radius) * 0.55;
      const dmg = Math.max(1, Math.round(A.damage * k * this.damageMultiplier));
      this._dealAbilityHit(h.target, dmg,
        h.dirX * A.knock * k, A.knock * 0.28, h.dirZ * A.knock * k, 0);
      _tmp.set(h.target.pos.x, h.target.pos.y + 1.0, h.target.pos.z);
      this.effects.damageNumber(_tmp, dmg, false);
    }
    if (shell && shell.hits > 0 && hits.length) Audio.slash(this.pos, 2);
  }

  /**
   * ═══ ONE WAY TO HURT SOMEBODY ══════════════════════════════════════════
   *
   * All three abilities land their damage through here, and here does
   * exactly what `_applyHits` does for the katana, because there is only one
   * damage path in this game and an ability that invents a second one will
   * disagree with it.
   *
   * The rule is: a training dummy is hit on the spot, and EVERYTHING ELSE
   * is queued as a `hit` event. Whoever is running the current mode drains
   * that queue — the arena sends it to the victim's machine, the Croaklands
   * looks the id up in this frame's target list, the dungeon hands it to
   * the boss. Calling `onHit` here as well as queuing would double every
   * blow in every one of those modes.
   */
  _dealAbilityHit(target, dmg, kx, ky, kz, combo) {
    if (!target || target.dead) return;
    if (target.isDummy) {
      if (target.onHit) target.onHit(dmg, kx, kz, false, target.pos, 'melee');
      return;
    }
    this.events.push({
      t: 'hit', id: target.id, dmg,
      kx: r2(kx), ky: r2(ky), kz: r2(kz), c: combo,
    });
  }

  _updateShell(dt, cam) {
    if (this.shellBurst > 0) this.shellBurst -= dt;
    if (!this.shell) return;
    const A = CFG.abilities.earthshell;
    this.shell.left -= dt;
    if (this.shell.struck > 0) this.shell.struck -= dt;

    // Dust while the stone sits, so it reads as a solid object and not a tint.
    if (Math.random() < dt * 8) {
      _tmp.set(
        this.pos.x + (Math.random() - 0.5) * 2.2,
        this.pos.y + Math.random() * 1.6,
        this.pos.z + (Math.random() - 0.5) * 2.2);
      this.effects.puff(_tmp, 0x8a6a44, 2, 1.2);
    }

    // The moment the window opens, say so — the player cannot see a timer.
    const open = shellPerfect(this.shell, A);
    if (open && !this.shell.cued) {
      this.shell.cued = true;
      Audio.tone({ freq: 660, to: 880, dur: 0.12, type: 'square', volume: 0.15, pos: this.pos });
      if (cam) cam.shake(0.08);
    } else if (!open) {
      this.shell.cued = false;
    }

    if (this.shell.left <= 0) {
      // Lapsed. Same crumble as a mistimed release — see `_releaseShell`.
      this.shell = null;
      _tmp.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
      this.effects.puff(_tmp, 0x7a5f3e, 18, 4);
      Audio.tone({ freq: 90, to: 40, dur: 0.3, type: 'square', volume: 0.12, pos: this.pos });
      this._abilEvent('earthshell', { s: 0 });
    }
  }

  // ----------------------------------------------------------- tongue trap

  /**
   * ═══ TONGUE TRAP ═══════════════════════════════════════════════════════
   *
   * The same tongue the grapple uses, aimed at a person: it catches, drags
   * them to the end of your blade, and the blade comes round on its own.
   */
  _castTongueTrap(A) {
    const victim = pickTongueTarget(
      this.pos, this.yaw, this._targets, A,
      Object.assign(this._abilityOpts(), {
        immune: (t) => (this.trapImmune.get(t.id) || 0) > 0,
      }));
    if (!victim) return this._abilityRefused();

    this.trap = {
      id: victim.id, target: victim, phase: 'out', t: 0,
      to: tonguePullPoint(this.pos, victim, A),
    };
    this.grapple.cancel();
    // Face what you caught — the strike at the end has to land, and the
    // tongue coming out sideways from the mouth looks wrong besides.
    this.yaw = Math.atan2(-(victim.pos.x - this.pos.x), -(victim.pos.z - this.pos.z));
    Audio.tongueFire(this.pos);
    this._abilEvent('tonguetrap', { tid: victim.id });
    return true;
  }

  _updateTrap(dt, cam) {
    for (const [id, t] of this.trapImmune) {
      const left = t - dt;
      if (left <= 0) this.trapImmune.delete(id); else this.trapImmune.set(id, left);
    }
    if (!this.trap) return;
    const A = CFG.abilities.tonguetrap;
    const tr = this.trap;
    const victim = tr.target;

    // The catch is void if they died, left, or got out of reach while the
    // tongue was travelling. A tongue stuck to a corpse is not a mechanic.
    if (!victim || victim.dead) { this._endTrap(); return; }

    tr.t += dt;
    if (tr.phase === 'out') {
      if (tr.t >= A.travel) {
        tr.phase = 'hold';
        tr.t = 0;
        tr.to = tonguePullPoint(this.pos, victim, A);
        this.trapImmune.set(victim.id, A.immunity);
        _tmp.set(victim.pos.x, victim.pos.y + 1.0, victim.pos.z);
        this.effects.tongueImpact(_tmp);
        Audio.tongueHit(this.pos);
        this._pullVictim(victim, A);
      }
      return;
    }
    if (tr.phase === 'hold' && tr.t >= A.hold) {
      // The automatic strike. Routed through the ordinary swing so it
      // shares the katana's damage numbers, hit sparks and networking —
      // there is no second way to hit somebody in this game.
      this._trapStrike(victim, A, cam);
      this._endTrap();
    }
  }

  /**
   * ═══ DRAG THEM TO THE END OF THE BLADE ═════════════════════════════════
   *
   * A remote player cannot be moved from here — every client owns its own
   * body — so they are sent the pull as knockback aimed at the point they
   * should end up on, and their own `receiveHit` applies it. That is the
   * same attacker-detects / victim-confirms path damage already takes, so
   * the pull cannot land without the victim agreeing to it.
   *
   * ── and some things simply cannot be dragged ──────────────────────────
   * A camp mob has no velocity at all; it is walked around by a state
   * machine that writes its position directly. A guardian and a boss are
   * not going to be yanked off their feet either. There is no honest way to
   * pull those, so the tongue does not pretend to: `_trapStrike` closes
   * whatever gap is left by moving YOU instead, which keeps the promise the
   * ability actually makes — that the strike at the end of it lands.
   */
  _pullVictim(victim, A) {
    const dx = this.trap.to.x - victim.pos.x;
    const dz = this.trap.to.z - victim.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    // Strong enough to cover the gap inside the hold beat, and no stronger.
    const speed = Math.min(len / Math.max(A.hold, 0.05), 46);
    if (!victim.isDummy) {
      this.events.push({
        t: 'hit', id: victim.id, dmg: 0,
        kx: r2((dx / len) * speed), ky: r2(3.0), kz: r2((dz / len) * speed), c: 0,
      });
    }
    _tmp.set(victim.pos.x, victim.pos.y + 1.0, victim.pos.z);
    this.effects.ring(_tmp, 0.3, 2.2, 0.28, 0xef7d9d, true);
  }

  _trapStrike(victim, A, cam) {
    /**
     * Close whatever the drag did not — see `_pullVictim`. Without this the
     * "close-range strike" plays its animation at the far end of a tongue
     * and connects with a mob twenty units away, which looks exactly like
     * the bug it would be.
     */
    const gap = Math.hypot(victim.pos.x - this.pos.x, victim.pos.z - this.pos.z);
    if (gap > A.pullTo + 0.6) {
      const at = stepStandPoint(this.pos, victim, 1.2);
      this.pos.x = at.x;
      this.pos.z = at.z;
      // Their feet, not yours: dragged across a step you would otherwise
      // finish the swing hanging in the air above them.
      this.pos.y = Math.max(this.pos.y, at.y);
      this.vel.x = 0;
      this.vel.z = 0;
      this.effects.dashTrail(this.pos, { x: 0, y: 1, z: 0 }, 0xef7d9d);
    }

    const dmg = Math.round(A.damage * this.damageMultiplier);
    const dx = victim.pos.x - this.pos.x, dz = victim.pos.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(-dx, -dz);

    _tmp.set(this.pos.x - Math.sin(this.yaw) * 1.5, this.pos.y + 1.1,
      this.pos.z - Math.cos(this.yaw) * 1.5);
    this.effects.slashArc(_tmp, this.yaw, 2, 0xfff0b0, 3.6);
    Audio.slash(this.pos, 2);
    if (cam) cam.shake(0.22);

    this._dealAbilityHit(victim, dmg,
      (dx / len) * 9, 4.0, (dz / len) * 9, 2);
    _tmp.set(victim.pos.x, victim.pos.y + 1.2, victim.pos.z);
    this.effects.damageNumber(_tmp, dmg, true);
    this.effects.hitBurst(_tmp, { x: -dx / len, y: 0, z: -dz / len }, true);
  }

  _endTrap() {
    if (!this.trap) return;
    this.trap = null;
    Audio.tongueRelease(this.pos);
  }

  // -------------------------------------------------------- lightning step

  /**
   * ═══ LIGHTNING STEP ════════════════════════════════════════════════════
   *
   * The cast takes the first step for free; every step after it has to be
   * asked for inside a window. See `CFG.abilities.lightningstep`.
   */
  _castLightningStep(A) {
    const opts = this._abilityOpts();
    const plan = planLightningStep(this.pos, this.yaw, this._targets, A, opts);
    if (!plan) return this._abilityRefused();

    this.step = {
      plan,
      used: new Set(),
      struck: 0,               // how many blows the chain has landed
      phase: 'travel',
      t: 0,
      from: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      to: null,
      target: null,
      /**
       * A boss ring is rotated per cast so it is not the same four spots
       * every time — see `bossAnchors`.
       */
      anchorPhase: Math.random() * Math.PI * 2,
    };
    if (plan.boss) plan.pool = bossAnchors(plan.boss, A, this.step.anchorPhase);

    this.grapple.cancel();
    this.combat.reset();
    this.dashTimer = 0;
    if (this.parrying) this._dropParry();

    _tmp.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
    this.effects.ring(_tmp, 0.3, 3.0, 0.3, 0xfff27a, true);
    this.effects.puff(_tmp, 0xfff27a, 22, 9);
    Audio.tone({ freq: 1400, to: 300, dur: 0.16, type: 'sawtooth', volume: 0.22, pos: this.pos });

    if (!this._beginStep(A)) {
      // planLightningStep said there was something, so this should not
      // happen — but refusing cleanly beats a chain that starts nowhere.
      this.step = null;
      return this._abilityRefused();
    }
    this._abilEvent('lightningstep', { s: 1 });
    return true;
  }

  /** Pick the next link and launch at it. False when the chain is out. */
  _beginStep(A, aimYaw) {
    const st = this.step;
    if (!st || st.used.size >= A.maxTargets) return false;
    /**
     * A boss's standing points are rebuilt from where it is NOW, not from
     * where it was when the chain started. Bosses move — several of them
     * charge — and stepping to a point the boss has already walked away
     * from would put you in an empty corner of the room with the strike
     * landing on nothing.
     *
     * The ids are stable across rebuilds (`<boss>#0`..`#3`), which is what
     * lets `used` keep working: you still cannot take the same point twice.
     */
    if (st.plan.boss) {
      st.plan.pool = bossAnchors(st.plan.boss, A, st.anchorPhase);
    }
    const pool = st.plan.pool || this._targets;
    const range = st.used.size === 0 ? A.range : A.linkRange;
    const next = nextStepTarget(
      this.pos, aimYaw === undefined ? this.yaw : aimYaw,
      pool, range, st.used, this._abilityOpts());
    if (!next) return false;

    st.used.add(next.id);
    st.target = next;
    st.from = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    st.to = stepStandPoint(this.pos, next, 1.4);
    st.phase = 'travel';
    st.t = 0;
    this.yaw = Math.atan2(-(next.pos.x - this.pos.x), -(next.pos.z - this.pos.z));
    Audio.tone({ freq: 1800, to: 600, dur: 0.1, type: 'sawtooth', volume: 0.18, pos: this.pos });
    return true;
  }

  /**
   * The player asked for another link.
   *
   * Only legal inside the window. Pressing early does nothing at all rather
   * than buffering — a buffered press would mean mashing the key beat a
   * timed one, and the timing is the ability.
   */
  _stepOnward() {
    const st = this.step;
    if (!st || st.phase !== 'window') return;
    const A = CFG.abilities.lightningstep;
    if (!this._beginStep(A)) {
      // Asked for more and there is none left: end on the finisher rather
      // than punishing a correct press with a fizzle.
      this._endStep(A, true);
    }
  }

  _updateStep(dt, cam) {
    const st = this.step;
    if (!st) return;
    const A = CFG.abilities.lightningstep;

    // Whatever we were flying at may have died on the way to it — from our
    // own last strike, or from somebody else entirely.
    if (st.target && st.target.dead && st.phase === 'travel') {
      // Finish the movement anyway. Stopping dead in mid-air because the
      // target expired mid-flight drops the player out of the sky.
      st.target = null;
    }

    st.t += dt;
    if (st.phase === 'travel') {
      const k = Math.min(1, st.t / Math.max(A.travel, 0.01));
      this.pos.x = st.from.x + (st.to.x - st.from.x) * k;
      this.pos.y = st.from.y + (st.to.y - st.from.y) * k;
      this.pos.z = st.from.z + (st.to.z - st.from.z) * k;
      this.vel.set(0, 0, 0);
      this.effects.dashTrail(this.pos, { x: 0, y: 1, z: 0 }, 0xfff27a);
      if (k >= 1) {
        this._strikeStep(A, cam);
        st.phase = 'hang';
        st.t = 0;
      }
      return;
    }
    if (st.phase === 'hang') {
      this.vel.set(0, 0, 0);
      if (st.t >= A.hang) {
        if (st.used.size >= A.maxTargets) { this._endStep(A, true); return; }
        st.phase = 'window';
        st.t = 0;
        // The cue that the window is open. Without it the timing is
        // guesswork and "miss it and the chain ends" is just unfair.
        Audio.tone({ freq: 1000, to: 1300, dur: 0.09, type: 'square', volume: 0.16, pos: this.pos });
        this._markStepTargets(A);
      }
      return;
    }
    // window
    this.vel.set(0, 0, 0);
    if (st.t >= A.window) this._endStep(A, true);
  }

  /**
   * ═══ THE TARGETING MARKERS ═════════════════════════════════════════════
   *
   * Put a mark over everything the next press could take you to, at the
   * moment the window opens — which is the moment the choice is actually
   * yours.
   *
   * Drawn from the very list `_beginStep` will pick out of, so a mark can
   * never appear over somebody the ability would then refuse to go to. The
   * one you are looking at is brighter, because that is the one you will
   * get if you press now: showing the options without showing which is
   * selected would make the aim rule invisible.
   */
  _markStepTargets(A) {
    const st = this.step;
    if (!st) return;
    const pool = st.plan.boss
      ? bossAnchors(st.plan.boss, A, st.anchorPhase)
      : (st.plan.pool || this._targets);
    const range = A.linkRange;
    const options = stepCandidates(
      this.pos, pool, range, st.used, this._abilityOpts());
    if (!options.length) return;

    const picked = nextStepTarget(
      this.pos, this.yaw, pool, range, st.used, this._abilityOpts());
    for (const c of options) {
      const on = picked && c.t.id === picked.id;
      const off = (c.t.hitbox && c.t.hitbox.bodyOffset) || 1.0;
      _tmp.set(c.t.pos.x, c.t.pos.y + off + 0.9, c.t.pos.z);
      this.effects.ring(_tmp, on ? 0.2 : 0.5, on ? 1.9 : 1.1,
        A.window, on ? 0xfff27a : 0x7a8ea0, true);
      if (on) this.effects.puff(_tmp, 0xfff27a, 6, 2);
    }
  }

  /** The hit at the end of a link. */
  _strikeStep(A, cam) {
    const st = this.step;
    // A boss chain strikes the boss from the point it arrived at; an
    // ordinary chain strikes whatever it stepped to.
    const victim = st.plan.boss || (st.target && st.target.anchorOf) || st.target;
    if (!victim || victim.dead) return;

    st.struck++;
    const last = st.used.size >= A.maxTargets;
    const mult = last ? A.finisher : 1;
    const dmg = Math.round(A.damage * mult * this.damageMultiplier);
    const dx = victim.pos.x - this.pos.x, dz = victim.pos.z - this.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(-dx, -dz);

    _tmp.set(this.pos.x - Math.sin(this.yaw) * 1.4, this.pos.y + 1.1,
      this.pos.z - Math.cos(this.yaw) * 1.4);
    this.effects.slashArc(_tmp, this.yaw, last ? 2 : 1, 0xfff27a, last ? 4.0 : 3.0);
    this.effects.ring(_tmp, 0.2, 2.4, 0.24, 0xfff27a, true);
    Audio.slash(this.pos, last ? 2 : 0);
    if (cam) cam.shake(last ? 0.3 : 0.14);

    this._dealAbilityHit(victim, dmg,
      (dx / len) * 6, 3.5, (dz / len) * 6, last ? 2 : 1);
    _tmp.set(victim.pos.x, victim.pos.y + 1.2, victim.pos.z);
    this.effects.damageNumber(_tmp, dmg, last);
    this.effects.hitBurst(_tmp, { x: -dx / len, y: 0, z: -dz / len }, last);
  }

  _endStep(A, landed) {
    if (!this.step) return;
    this.step = null;
    this.health.invulnerable = Math.max(this.health.invulnerable, A.invulnerable);
    // Dropped back into ordinary physics facing where you finished, with a
    // little forward carry so the landing is not a dead stop.
    this.vel.x = -Math.sin(this.yaw) * 4;
    this.vel.z = -Math.cos(this.yaw) * 4;
    this.vel.y = 0;
    if (landed) {
      _tmp.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
      this.effects.puff(_tmp, 0xfff27a, 16, 6);
    }
    this._abilEvent('lightningstep', { s: 0 });
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
  /**
   * ═══ THE CLONE TAKES A HIT AND IS GONE ═════════════════════════════════
   *
   * One hit, whoever landed it and with whatever. That is what makes the
   * clone a trade rather than a free second body: it fights for you and it
   * soaks the kunai that was meant for you, and the price is that anybody
   * who connects with it removes it.
   *
   * The COOLDOWN IS NOT TOUCHED. It started when you cast and it keeps
   * running, so a clone swatted in its first second still costs the full
   * sixty seconds — the ability is the cast, not the uptime. Refunding here
   * would make throwing a clone into a crowd strictly free.
   *
   * Clearing the trail matters as much as the timer: `cloneTransform`
   * returns null without two samples, so this is what actually takes it off
   * everyone's screen — `netState` stops packing `cl` on the next tick.
   *
   * @returns true if there was a clone to kill, so the caller can decide
   *          whether anything is worth showing.
   */
  killClone() {
    if (this.cloneT <= 0) return false;
    this.cloneT = 0;
    this.cloneTrail.length = 0;
    return true;
  }

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

    /**
     * Stone first. The shell stops everything — no chip, no stagger, and
     * unlike a parry it is NOT spent by blocking: it keeps standing and
     * opens the counter window instead. That is the whole shape of the
     * ability, so it has to be checked before the guard.
     */
    if (this.shell) {
      this.shellAbsorb(kx, kz);
      if (cam) cam.shake(0.12);
      return false;
    }

    // A raised guard turns the blow aside — same rule everywhere, including
    // the arena. Turning one aside is what ends the guard: see `_parryTook`.
    if (this.parrying) {
      const len = Math.hypot(kx, kz) || 1;
      const nx = kx / len, nz = kz / len;
      this.justParried = 0.2;
      this._parryTook();
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
    this.ledge = null;
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

    // Stone turns a boss blow aside exactly as it turns a player's, and for
    // the same reason it is checked before the guard in `receiveHit`.
    if (this.shell) {
      this.shellAbsorb(-nx, -nz);
      return;
    }

    if (this.parrying) {
      this.justParried = 0.2;
      // Turned aside: sparks, a shove, no damage — and the guard comes down
      // for `afterHit` seconds, which is Toadel's whole opening.
      this._parryTook();
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
   * THE GUARD.
   *
   * Hold right mouse and the blade stays up, for as long as you hold it.
   * There is no timer on it and no cost to raising it — a guard that expired
   * on its own turned every exchange into a stopwatch problem, and a guard
   * you had to pay for meant the safe play was never to raise it at all.
   *
   * The price is on the OTHER side. Turning a blow aside drops the guard and
   * locks it for `afterHit` seconds (see `_parryTook`), so blocking the first
   * hit of a combo is what opens you to the second. Standing behind a raised
   * blade is free; standing behind it while somebody is actually swinging is
   * not.
   */
  _updateParry(dt, held) {
    if (this.parryCooldown > 0) this.parryCooldown -= dt;

    if (this.parrying) {
      this.parryHeld += dt;
      // Only letting go lowers it. Nothing else does, except being hit.
      if (!held) this._dropParry();
      return;
    }
    if (!held || this.parryCooldown > 0) {
      // A cue the first time you try to guard inside the lockout, rate-limited
      // so it cannot spam while the button is held down.
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

  /**
   * A blow was turned aside: the guard comes down and stays down.
   *
   * This is the entire cost of parrying, and it is the same everywhere — the
   * arena, the open world and the Toadel fight all route their absorbed hits
   * through here rather than each counting to two on their own.
   */
  _parryTook() {
    this.parrying = false;
    this.parryHits = 0;
    this.parryHeld = 0;
    this.parryCooldown = CFG.story.parry.afterHit;
    this._parryCue = 0.5;    // no "too soon" bark for the hit that caused it
  }

  /** Lower the guard because the button came up. Costs nothing. */
  _dropParry() {
    if (!this.parrying) return;
    this.parrying = false;
    this.parryHits = 0;
    this.parryHeld = 0;
  }

  /**
   * A guard broken outright.
   *
   * Not what an ordinary turned blow does any more — that is `_parryTook` —
   * but kept for the few attacks that are built to go THROUGH a guard, where
   * the point of the move is that blocking it is not an answer. A short total
   * lockout: no moving, attacking, dashing or guarding for `breakLock`.
   */
  _breakParry(nx, nz) {
    const P = CFG.story.parry;
    this.parrying = false;
    this.parryHits = 0;
    this.parryHeld = 0;
    this.parryCooldown = P.afterHit;
    this.knockdown = Math.max(this.knockdown, P.breakLock);
    this.justKnockedDown = true;
    this.combat.reset();
    this.grapple.cancel();
    this.ledge = null;
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
    this.ledge = null;
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
    this.ledge = null;
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
    // Keep the climb offset decaying here too, or a cutscene entered
    // mid-stair leaves the camera parked half a step underground.
    this._absorbStep(cs.stepUp, dt);
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
    // Keep the climb offset decaying here too, or a cutscene entered
    // mid-stair leaves the camera parked half a step underground.
    this._absorbStep(cs.stepUp, dt);
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

    // Catching the lip of something you fell just short of.
    this._updateLedge(dt);

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
    // Drawn a step BEHIND the simulation while a ledge is being climbed, so
    // the snap up becomes a rise. See `stepSmooth`.
    this.model.root.position.set(this.pos.x, this.pos.y - this.stepSmooth, this.pos.z);
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
      /**
       * The tongue is shared between the grapple and Tongue Trap — it is
       * the same tongue, and the rig only has one. The trap wins when both
       * somehow want it, because the trap cancels the grapple on cast and
       * so the grapple should not be out at all.
       */
      grappling: !!this.trap || this.grapple.visible,
      tongueTo: this.trap && this.trap.target
        ? {
          x: this.trap.target.pos.x,
          y: this.trap.target.pos.y + 1.0,
          z: this.trap.target.pos.z,
        }
        : (this.grapple.visible ? this.grapple.tip : null),
      // The stone, and whether the counter window is open — see `_buildShell`.
      shell: !!this.shell,
      shellHot: !!(this.shell && shellPerfect(this.shell, CFG.abilities.earthshell)),
      /**
       * A frog holding on to a lip is drawn with the wall-hug pose and the
       * climb reach on top of it, which between them is exactly what
       * hanging off an edge looks like. Reusing the two poses the rig
       * already has beats inventing a third for a state that lasts 0.42s.
       */
      wallSliding: this.wallSliding || !!this.ledge,
      sprinting: this.sprinting,
      swimming: this.inWater,
      swimPitch: this.inWater ? clamp(this.vel.y / 10, -1, 1) : 0,
      parrying: this.parrying,
      dead: this.health.dead,
      // Drives the climb: the rig reaches for the step it is walking onto.
      climbing: Math.max(this.climbing, this.hanging),
      /**
       * Reaching out to touch something.
       *
       * Set by whatever owns the world's interactive props (see props.js).
       * It lives here rather than in the props themselves because the arm
       * doing the reaching belongs to the frog: a chest that opens while the
       * player stands with their hands by their sides is a chest that opened
       * on its own.
       */
      reachT: this.reachT > 0 ? this.reachT / 0.55 : 0,
    });
  }

  /**
   * Reach for something. One shot, purely cosmetic.
   *
   * Called the moment an interaction is accepted, so the arm is already on
   * its way out while the lid, the lever or the door begins to move.
   */
  reachOut() { this.reachT = 0.55; }

  /**
   * Turn this frame's ledge snap into something that can be drawn.
   *
   * `stepSmooth` is how far BEHIND its true position the frog is drawn. A
   * step up adds to it and it decays to nothing, so the simulation's
   * instant lift becomes a quick rise on screen. Purely visual: collision,
   * hit registration and the position on the wire all use `pos` untouched.
   *
   * Capped at one step height. Without a cap, a flight of stairs taken at a
   * run adds a rise every frame faster than the decay removes it, and the
   * frog sinks steadily into the staircase — the offset has to be able to
   * describe one step, never a whole flight.
   *
   * `climbing` is the same event on a slower fuse, for the animation. It is
   * separate because the pose wants to persist across the gap between one
   * step and the next, while the position offset must not.
   */
  /**
   * ═══ CATCHING AN EDGE ═══════════════════════════════════════════════════
   *
   * Falling past the lip of something with your hands within reach of it
   * catches it. You hang for a moment and pull up.
   *
   * This is here for the broken roads (js/traverse.js): a crossing made of
   * the piers of a fallen bridge is only worth attempting if a jump judged
   * a little short costs a second rather than the whole crossing. The rest
   * of that mercy is the shelf underneath every one of those sites — this
   * saves the jump that was nearly right, the shelf saves the rest.
   *
   * Runs from `_postMove`, so `onWall`, `wallNormal` and `pos` are this
   * frame's resolved values. While holding on, the frog is PINNED: pos is
   * reassigned and velocity zeroed every frame, which is why gravity
   * accumulating in `update` beforehand does not matter.
   */
  _updateLedge(dt) {
    const L = CFG.ledge;
    if (this.ledgeCooldown > 0) this.ledgeCooldown -= dt;
    this.hanging = Math.max(0, this.hanging - dt / 0.3);

    if (this.ledge) {
      // Something took the ledge away — went in the water, got launched by a
      // grapple, teleported. Let go rather than hanging off nothing.
      if (this.inWater || this.grapple.attached) { this.releaseLedge(); return; }
      this.pos.set(this.ledge.hx, this.ledge.hy, this.ledge.hz);
      this.vel.set(0, 0, 0);
      // The fall is over: it must not land as a hard landing after the
      // mantle, and the camera must not shake for a fall you caught.
      this.peakFallSpeed = 0;
      this.wallSliding = false;
      this.hanging = 1;
      this.ledge.t += dt;
      if (this.ledge.t >= L.hold) this._mantle();
      return;
    }

    if (this.grounded || this.inWater) return;
    if (this.grapple.attached || this.dashTimer > 0) return;
    if (this.ledgeCooldown > 0) return;
    if (this.vel.y > L.minFall || this.airTime < L.minAir) return;
    // Only against a surface we are actually touching.
    if (!this.onWall && this.wallCoyote <= 0) return;
    const found = this._findLedge();
    if (found) this._grabLedge(found);
  }

  /**
   * The highest catchable lip in front of the frog, or null.
   *
   * Probes ONE point: a little way into the wall the frog is against, at
   * its own height. A box containing that point whose top is between the
   * chest and just over the head is a lip. Anything standing on that top
   * disqualifies it — an overhang is not a ledge, and catching one would
   * mantle the frog into solid rock.
   */
  _findLedge() {
    const L = CFG.ledge;
    const r = CFG.move.radius, h = CFG.move.height;
    // The wall normal points away from the surface, so we probe against it.
    const n = this.onWall && this.wallNormal.lengthSq() > 0.1
      ? this.wallNormal : this.wallCoyoteNormal;
    const nx = n.x, nz = n.z;
    if (nx === 0 && nz === 0) return null;
    const px = this.pos.x - nx * (r + L.reach);
    const pz = this.pos.z - nz * (r + L.reach);
    const cand = this._ledgeCand || (this._ledgeCand = []);
    this.collision.query(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5, cand);

    let best = null;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (px < b.minX || px > b.maxX || pz < b.minZ || pz > b.maxZ) continue;
      const top = b.maxY;
      if (top < this.pos.y + L.low || top > this.pos.y + L.high) continue;
      if (best && top <= best.maxY) continue;
      best = b;
    }
    if (!best) return null;
    // Refuse a lip with something sitting on it.
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      if (b === best) continue;
      if (px < b.minX || px > b.maxX || pz < b.minZ || pz > b.maxZ) continue;
      if (b.minY < best.maxY + h && b.maxY > best.maxY + 0.05) return null;
    }
    /**
     * Where the mantle puts you: the probe point, pulled far enough in from
     * the box's own edges to stand there. A piece thinner than the frog —
     * a beam, a rope, one cube of a chain — has no such room, so those use
     * the middle, which is what standing on a beam means anyway.
     */
    const inset = (lo, hi, p) => (hi - lo >= r * 2.2
      ? clamp(p, lo + r, hi - r) : (lo + hi) * 0.5);
    return {
      hx: this.pos.x, hy: best.maxY - L.hangDrop, hz: this.pos.z,
      tx: inset(best.minX, best.maxX, px),
      ty: best.maxY,
      tz: inset(best.minZ, best.maxZ, pz),
      tag: best.tag,
      t: 0,
    };
  }

  _grabLedge(g) {
    this.ledge = g;
    this.hanging = 1;
    this.vel.set(0, 0, 0);
    this.peakFallSpeed = 0;
    this.pos.set(g.hx, g.hy, g.hz);
    this.effects.dustPuff(
      _tmp.set(g.tx, g.ty + 0.1, g.tz), 5, 1.6, 0xcfc0a0);
    Audio.land(this.pos, false);
    this.events.push({ t: 'ledge', x: g.tx, y: g.ty, z: g.tz });
  }

  /** Pull up onto the lip. Drawn as a step-up, so it reads as a climb. */
  _mantle() {
    const g = this.ledge;
    if (!g) return;
    const rise = Math.max(0, g.ty - this.pos.y);
    this.pos.set(g.tx, g.ty, g.tz);
    this.vel.set(0, 0, 0);
    this.ledge = null;
    this.ledgeCooldown = CFG.ledge.cooldown;
    this.grounded = true;
    this.groundTag = g.tag || 'stone';
    this.airTime = 0;
    this.doubleJumpLeft = 1;
    this.dashCharges = CFG.dash.airCharges;
    // Borrow the ledge-step smoothing so the lift is drawn as a rise rather
    // than as a teleport. Capped there at one stepHeight, which is fine —
    // it only has to cover the moment; the pose does the rest.
    this._absorbStep(rise, 0);
    this.climbing = 1;
  }

  /** Let go and fall. Also how a jump off a held edge is answered. */
  releaseLedge() {
    if (!this.ledge) return;
    this.ledge = null;
    this.ledgeCooldown = CFG.ledge.cooldown;
  }

  _absorbStep(stepUp, dt) {
    const cap = CFG.move.stepHeight;
    if (stepUp > 0) {
      this.stepSmooth = Math.min(this.stepSmooth + stepUp, cap);
      this.climbing = 1;
    }
    // Fast enough to stay under the feet, slow enough to read as a rise.
    this.stepSmooth = damp(this.stepSmooth, 0, 17, dt);
    if (this.stepSmooth < 1e-4) this.stepSmooth = 0;
    this.climbing = Math.max(0, this.climbing - dt / 0.22);
  }

  /**
   * Where the frog is DRAWN: `pos` with the ledge-climb lag taken off.
   *
   * The camera follows this rather than `pos`, because smoothing the model
   * and not the camera would leave the whole world jolting under a frog that
   * rose calmly — which is the same judder seen from the other side.
   *
   * A shared scratch vector: read it, do not keep it.
   */
  get renderPos() {
    return _render.set(this.pos.x, this.pos.y - this.stepSmooth, this.pos.z);
  }

  /** Hide the local frog's own head when the camera is very close. */
  setSelfVisible(v) { this.model.setVisible(v); }
}

const r2 = (v) => Math.round(v * 100) / 100;
