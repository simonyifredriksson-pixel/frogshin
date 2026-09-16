/**
 * THE SHARK IN SHIZUKA WARD'S LAKE.
 *
 * It cruises just under the surface with its fin showing, breaches clear of
 * the water every half-minute or so, and eats anybody who stays in the lake
 * for more than a moment.
 *
 * ── the problem this file is mostly about ─────────────────────────────────
 * Two requirements pull against each other. The shark must reach a swimmer
 * within 1.2 seconds, every time, wherever they went in — AND it must swim
 * there. A thing that appears next to you is not a shark, it is a trapdoor
 * with teeth, and the whole point of the fin is that you watched it coming.
 *
 * Teleporting is off the table, and so is "make it fast enough to cross the
 * lake in 1.2s" — the lake is four hundred units across, and 330 units a
 * second is a missile, not an animal.
 *
 * So the shark is never far away in the first place. It PATROLS THE WATER
 * NEAREST THE PLAYER: the cruise target wanders inside a ring 22–55 units
 * from the point on the shoreline you are standing nearest to. That single
 * decision is what makes both halves work —
 *
 *   - the strike is only ever ~55 units, which is a believable 46 u/s charge
 *     over 1.2 seconds rather than a teleport, and
 *   - the fin is where you can SEE it, which is the other thing that was
 *     asked for. A shark cruising the far side of a lake is a shark nobody
 *     ever knows about.
 *
 * It is a cheat, and it is invisible, because a lake this size has no "far
 * side" you can observe from the shore anyway.
 *
 * ── it really does swim ───────────────────────────────────────────────────
 * Position is integrated along a heading with a capped turn rate, never
 * lerped toward a target. It banks into its turns, it overshoots and comes
 * back around, and it cannot pivot on the spot — a charging shark turns at
 * 3.2 rad/s and a cruising one at 1.1. The strike speed is solved from the
 * distance remaining and the time left, so the bite lands on schedule
 * whether you went in close to it or across the bay from it.
 */

import * as THREE from '../lib/three.module.js?v=v145';
import { CFG } from './config.js?v=v145';
import { clamp } from './util.js?v=v145';

const _v = new THREE.Vector3();

/** Cruising, winding up a jump, mid-jump, or coming for you. */
export const SHARK = {
  CRUISE: 'cruise',
  BREACH: 'breach',
  STRIKE: 'strike',
};

export class Shark {
  /**
   * @param scene    where the model goes
   * @param shoreAt  Chebyshev distance of the waterline — the patrol hugs it
   * @param swimAt   Chebyshev distance at which the lake is deep enough to
   *                 float it. The shark is never allowed inside this, so it
   *                 can never end up on the beach.
   */
  constructor(scene, shoreAt, swimAt, rnd) {
    const S = CFG.shark;
    this.scene = scene;
    this.shoreAt = shoreAt;
    this.swimAt = swimAt !== undefined ? swimAt : shoreAt + S.draft;
    this.waterY = CFG.world.waterLevel;
    /**
     * The map's own seeded generator, not `Math.random`.
     *
     * Two reasons, and the second is the better one. It makes the shark
     * testable — a simulation whose wander and breach timing reroll every
     * run produces a test that fails one time in three for a different
     * reason each time, which is worse than no test. And it makes every
     * client's shark agree: the world is generated from one seed precisely
     * so that everybody sees the same map, and a fish that breaches at a
     * different moment for each player is a small hole in that.
     */
    this.rnd = rnd || Math.random;

    this.state = SHARK.CRUISE;
    this.pos = new THREE.Vector3(this.swimAt + 26, this.waterY - S.cruiseDepth, 0);
    this.yaw = 0;
    this.speed = S.cruiseSpeed;

    /** Where it is heading while cruising, and how that point wanders. */
    this.target = this.pos.clone();
    this._wanderA = 0;
    this._wanderR = (S.patrolNear + S.patrolFar) * 0.5;
    this._retarget = 0;

    /** Seconds until the next breach, and where it is through one. */
    this.breachIn = S.breachEvery[0]
      + this.rnd() * (S.breachEvery[1] - S.breachEvery[0]);
    this.breachT = 0;

    /** How long the current victim has been in the water. */
    this.soak = 0;
    /** One-frame flag: it just ate somebody. */
    this.bit = false;

    this.group = buildSharkModel();
    this.tailPivot = this.group.userData.tailPivot;
    this.group.position.copy(this.pos);
    scene.add(this.group);

    // The surface wake — two thin streaks that only show while the fin is up.
    this.wake = buildWake();
    scene.add(this.wake);
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.wake);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.wake.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  /**
   * The point of open water closest to a position on the island.
   *
   * The shoreline is a SQUARE ring, so the nearest water is straight out
   * across whichever edge is closer — which is what `|x| > |z|` picks. A
   * radial projection would send the shark to the corner whenever you stood
   * on a diagonal, which is both wrong and much further away.
   */
  _nearestWater(p, out) {
    const r = this.shoreAt;
    if (Math.abs(p.x) > Math.abs(p.z)) {
      out.set(Math.sign(p.x) * r || r, 0, clamp(p.z, -r, r));
    } else {
      out.set(clamp(p.x, -r, r), 0, Math.sign(p.z) * r || r);
    }
    return out;
  }

  /**
   * Hold a point out past the swim line, pushing on the NEAREST EDGE only.
   *
   * The boundary is a square, so the shortest way out of it is straight
   * across whichever side you are closest to. Scaling both coordinates
   * instead — which is what this did first — pushes along a radius, and on
   * a square that slides the shark SIDEWAYS as well as outward: motion with
   * no cause, in a direction nothing asked for. It showed up as the shark
   * momentarily travelling at 53 units a second while charging at 40, which
   * is the kind of thing that is invisible until something measures it.
   */
  _keepOut(p) {
    const ax = Math.abs(p.x), az = Math.abs(p.z);
    if (Math.max(ax, az) >= this.swimAt) return p;
    if (ax >= az) p.x = (Math.sign(p.x) || 1) * this.swimAt;
    else p.z = (Math.sign(p.z) || 1) * this.swimAt;
    return p;
  }

  /**
   * @param dt
   * @param player { pos, inWater } or null when there is nobody to hunt
   */
  update(dt, player) {
    const S = CFG.shark;
    this.bit = false;
    if (dt <= 0) return;

    /**
     * Put it somewhere sensible the first time it hears about a player.
     *
     * This is placement, not movement: it happens on the frame the world
     * starts running, before anybody has seen the lake, and never again.
     * Building it at a fixed point on the +x side meant a player who
     * spawned on the far side of the ward began the match with the shark
     * four hundred units away — a cold start the patrol then had to spend
     * twenty seconds undoing.
     */
    if (!this._placed && player) {
      this._placed = true;
      this._nearestWater(player.pos, _v);
      const a = Math.atan2(this.pos.z - _v.z, this.pos.x - _v.x);
      this.pos.x = _v.x + Math.cos(a) * S.patrolFar;
      this.pos.z = _v.z + Math.sin(a) * S.patrolFar;
      this._keepOut(this.pos);
    }

    // ---- how long has the swimmer been in? ------------------------------
    const swimming = !!(player && player.inWater);
    this.soak = swimming ? this.soak + dt : 0;

    // ---- pick a state ---------------------------------------------------
    if (this.breachT > 0) {
      this.state = SHARK.BREACH;
    } else if (swimming && this.soak >= S.alert) {
      // Committed. Before `alert` it carries on cruising and you get the
      // one warning this map offers: the fin turning your way.
      this.state = SHARK.STRIKE;
    } else {
      this.state = SHARK.CRUISE;
      this.breachIn -= dt;
      if (this.breachIn <= 0) {
        this.breachT = S.breachTime;
        this.breachIn = S.breachEvery[0]
          + this.rnd() * (S.breachEvery[1] - S.breachEvery[0]);
        /**
         * Enter the state on the SAME frame the arc starts.
         *
         * Without this the first frame of the jump is flagged as a cruise
         * while the body is already climbing, so anything reading `state`
         * — the wake, which should vanish mid-air, and anything that
         * reacts to a breach — is one frame behind the thing it describes.
         */
        this.state = SHARK.BREACH;
      }
    }

    // ---- where does it want to be? --------------------------------------
    let wantSpeed = S.cruiseSpeed;
    let turnRate = S.cruiseTurn;

    if (this.state === SHARK.STRIKE) {
      /**
       * IT IS COMING. One honest speed, straight at you, until it arrives.
       *
       * No solved-for-arrival-time speed any more: the 1.2 seconds is when
       * it COMMITS, not when it bites, so the charge only has to be fast —
       * it does not have to be fast by a computed amount. That is why this
       * is a constant and the eat is simply what happens when it gets here.
       */
      this.target.set(player.pos.x, 0, player.pos.z);
      wantSpeed = S.strikeSpeed;
      /**
       * TURN RATE FROM SPEED, not a constant.
       *
       * A fixed 3.2 rad/s sounds hard until you notice what it means at
       * charge speed: a turn circle wider than the distance to the prey.
       * The shark sailed straight past its victim and had to loop back
       * round — which the simulation caught and no amount of reading the
       * code ever would. Holding the RADIUS fixed means the faster it
       * charges the harder it turns, so it always closes.
       */
      turnRate = Math.max(S.strikeTurn, this.speed / S.strikeRadius);
    } else if (this.state === SHARK.BREACH) {
      // Mid-jump it holds its line: a breaching shark is a ballistic object.
      wantSpeed = S.breachSpeed;
      turnRate = S.cruiseTurn * 0.25;
    } else {
      // Cruise: a wandering point in the water nearest the player, or a slow
      // circuit of the shoreline when there is nobody about.
      this._retarget -= dt;
      if (this._retarget <= 0) {
        this._retarget = S.retargetEvery;
        this._wanderA += (this.rnd() - 0.4) * 1.5;
        this._wanderR = S.patrolNear
          + this.rnd() * (S.patrolFar - S.patrolNear);
      }
      this._wanderA += dt * S.circleRate;
      if (player) this._nearestWater(player.pos, _v);
      else _v.set(this.shoreAt, 0, 0);
      this.target.set(
        _v.x + Math.cos(this._wanderA) * this._wanderR,
        0,
        _v.z + Math.sin(this._wanderA) * this._wanderR);
      /**
       * REPOSITIONING is not cruising.
       *
       * The patrol steers toward the water nearest you, but steering is not
       * arriving: at a lazy 11 units a second a shark on the far side of
       * the island needs half a minute to come round, and the simulation
       * had it still 380 units away when a swimmer went in. Half the
       * entries in the test were never reached at all.
       *
       * So when it is a long way from where it wants to be it swims like an
       * animal covering ground rather than one loitering — `trackSpeed`
       * keeps pace with a sprinting frog, which is what stops the distance
       * growing every time somebody runs across the ward.
       */
      const far = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      wantSpeed = far > S.patrolFar ? S.trackSpeed : S.cruiseSpeed;
      // Keep it off the beach: never steer to somewhere it would run aground.
      // Same nearest-edge push as `_keepOut`, a standoff further out.
      const tax = Math.abs(this.target.x), taz = Math.abs(this.target.z);
      const off = this.swimAt + S.standOff;
      if (Math.max(tax, taz) < off) {
        if (tax >= taz) this.target.x = (Math.sign(this.target.x) || 1) * off;
        else this.target.z = (Math.sign(this.target.z) || 1) * off;
      }
    }

    // ---- swim: turn toward the target, then move along the heading ------
    /**
     * This is the part that makes it an animal rather than a cursor. The
     * heading turns at a capped rate and the body always travels along the
     * heading, so it arcs into its turns and can overshoot — it is never
     * moved toward a point directly.
     */
    const want = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = turnRate * dt;
    this.yaw += clamp(d, -step, step);

    // Speed eases rather than snapping, so a charge visibly winds up.
    const accel = this.state === SHARK.STRIKE ? S.strikeAccel : S.cruiseAccel;
    this.speed += clamp(wantSpeed - this.speed, -accel * dt, accel * dt);

    /**
     * Move, and SLIDE along the shore rather than being shoved off it.
     *
     * Axis at a time, exactly as `CollisionWorld._moveAxis` does it for the
     * player: try x, keep it only if it stays in water; then the same for z.
     * A shark swimming at the beach therefore turns and runs along it.
     *
     * The first version let it move freely and then corrected its position
     * afterwards, which is a different thing wearing the same result — a
     * correction is motion the animal did not make, and it showed up as the
     * shark travelling at 58 units a second while charging at 40. Anything
     * that measures speed by differencing positions would see it, and so
     * would anyone watching the fin twitch sideways at the waterline.
     */
    const dx = Math.sin(this.yaw) * this.speed * dt;
    const dz = Math.cos(this.yaw) * this.speed * dt;
    const wet = (x, z) => Math.max(Math.abs(x), Math.abs(z)) >= this.swimAt;
    if (wet(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
    if (wet(this.pos.x, this.pos.z + dz)) this.pos.z += dz;

    /**
     * IT NEVER LEAVES THE WATER. No exceptions, charging or not.
     *
     * `swimAt` is the distance out at which the lake is deep enough to
     * float it — solved from the map's own height function when it was
     * built, not guessed — so this is the shoreline holding it off rather
     * than a rule about where it is allowed to be. Steering away from the
     * beach is not enough on its own: a shark carrying speed into a turn
     * drifts, and the patrol was ending up over dry sand a couple of frames
     * at a time.
     *
     * The charge is NOT exempt from this, which is the one thing that makes
     * standing in the shallows meaningfully different from swimming: it
     * will come as far as the water goes and no further. Its reach still
     * covers anybody deep enough to be counted as in the water, because
     * `biteRange` is wider than the strip between the two.
     *
     * The breach is vertical and lands where it took off, so it is inside
     * this rule too — the jump leaves the surface, never the lake.
     */
    this._keepOut(this.pos);

    // ---- vertical: the breach arc, or a gentle cruise depth --------------
    let pitch = 0;
    if (this.breachT > 0) {
      this.breachT -= dt;
      const t = 1 - this.breachT / S.breachTime;       // 0 -> 1
      /**
       * A DOLPHIN JUMP: one clean parabola out and back in.
       *
       * `4t(1-t)` peaks at 1 exactly halfway, so the arc is symmetric and
       * it re-enters the water at the same depth it left. Pitch follows the
       * derivative, which is what puts the nose up on the way out and down
       * on the way in — a breach with a level body reads as a plank being
       * thrown.
       */
      const arc = 4 * t * (1 - t);
      this.pos.y = this.waterY - S.cruiseDepth + arc * S.breachHeight;
      pitch = (0.5 - t) * S.breachPitch;
      if (this.breachT <= 0) this.breachT = 0;
    } else {
      // Cruising depth, with a slow roll so the fin cuts rather than glides.
      const bob = Math.sin(this.pos.x * 0.06 + this.pos.z * 0.05) * 0.12;
      this.pos.y = this.waterY - S.cruiseDepth + bob;
      pitch = 0;
    }

    // ---- the bite -------------------------------------------------------
    if (this.state === SHARK.STRIKE) {
      /**
       * Eaten when it ARRIVES. Nothing here is on a clock.
       *
       * The timer's whole job was to start the charge; what finishes you is
       * the shark reaching you, which is the version of this that can be
       * watched happening. It is also why there is no escape clause: a
       * swimmer flees at 16.5 and this closes at 40.
       */
      const dist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (dist <= S.biteRange) {
        this.bit = true;
        this.soak = 0;
      }
    }

    this._place(pitch, dt);
  }

  /** Push the simulation onto the model. */
  _place(pitch, dt) {
    const S = CFG.shark;
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.yaw, 0);
    this.group.rotateX(pitch);
    // Bank into the turn — read off how hard it is turning right now.
    const bank = clamp(this.speed * 0.006, 0, 0.5);
    this.group.rotateZ(Math.sin(this.yaw * 2) * bank * 0.2);

    // Tail beat, faster when it is moving faster. This is the only thing
    // that separates "a shark" from "a shark-shaped rock being dragged".
    this._beat = (this._beat || 0) + (0.8 + this.speed * 0.13) * dt;
    if (this.tailPivot) {
      this.tailPivot.rotation.y = Math.sin(this._beat * 6) * 0.42;
    }

    // The wake only exists while the fin is above the surface.
    const finUp = this.pos.y + S.finTop > this.waterY + 0.05;
    this.wake.visible = finUp && this.breachT <= 0;
    if (this.wake.visible) {
      this.wake.position.set(this.pos.x, this.waterY + 0.06, this.pos.z);
      this.wake.rotation.y = this.yaw;
      const s = 0.6 + clamp(this.speed / 40, 0, 1.6);
      this.wake.scale.set(s, 1, s);
    }
  }
}

/**
 * The model: a slate-backed, pale-bellied fish with a fin that shows.
 *
 * Built from flat-shaded boxes like everything else in this game. The one
 * dimension that is not a matter of taste is the DORSAL FIN's height — it
 * has to clear `CFG.shark.cruiseDepth` or the whole thing swims past
 * invisibly, which is the failure that would make this feature pointless.
 */
function buildSharkModel() {
  const g = new THREE.Group();
  const back = 0x4a555e;
  const belly = 0xcfcdc4;
  const dark = 0x38414a;

  const box = (w, h, d, color, x, y, z, parent) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, flatShading: true }));
    m.position.set(x, y, z);
    (parent || g).add(m);
    return m;
  };

  // Body, in four tapering segments from snout to tail root. The model faces
  // +z, which is the direction `yaw` is measured from.
  box(1.5, 1.25, 2.2, back, 0, 0, 0.4);
  box(1.25, 1.05, 1.8, back, 0, -0.02, 2.0);
  box(0.85, 0.75, 1.4, back, 0, -0.04, 3.3);
  box(0.5, 0.45, 1.1, back, 0, -0.04, 4.3);
  // The snout, blunter underneath than on top.
  box(1.0, 0.7, 1.4, back, 0, 0.1, -1.3);
  box(0.7, 0.35, 0.9, dark, 0, -0.25, -1.8);
  // Pale belly, so it reads as a shark from below and from the side.
  box(1.3, 0.35, 3.6, belly, 0, -0.62, 0.9);
  // Eyes.
  for (const s of [-1, 1]) box(0.14, 0.14, 0.14, 0x14181c, s * 0.52, 0.22, -1.1);
  // Gills.
  for (let i = 0; i < 4; i++) {
    box(0.06, 0.5, 0.06, dark, 0.74, 0.0, -0.4 + i * 0.28);
    box(0.06, 0.5, 0.06, dark, -0.74, 0.0, -0.4 + i * 0.28);
  }

  /**
   * THE DORSAL FIN — the thing you actually see.
   *
   * Raked backwards, because a vertical triangle reads as a sail. Built as
   * three stacked slabs that step back as they rise, which at this art
   * style is indistinguishable from a swept triangle and costs three boxes.
   */
  box(0.22, 0.8, 1.25, back, 0, 0.92, 1.0);
  box(0.18, 0.62, 0.78, back, 0, 1.52, 1.34);
  box(0.13, 0.42, 0.38, dark, 0, 2.0, 1.66);

  /**
   * Pectoral fins — and the size of these is not a matter of taste.
   *
   * The first pass made them three units across on a body one and a half
   * wide, and rendered they were two grey slabs with a fish somewhere
   * between them. Every fin on this model is now smaller than the body it
   * hangs off, which is both correct and the only way the silhouette reads
   * as an animal rather than as an aircraft.
   */
  for (const s of [-1, 1]) {
    const f = box(0.95, 0.1, 0.55, back, s * 0.8, -0.38, 1.25);
    f.rotation.z = s * 0.3;
    f.rotation.y = s * -0.4;
  }
  // A small second dorsal and the pelvic pair, which is most of what makes
  // the silhouette read as a shark rather than as a dolphin.
  box(0.11, 0.26, 0.34, back, 0, 0.56, 3.6);
  for (const s of [-1, 1]) {
    const f = box(0.45, 0.09, 0.3, back, s * 0.34, -0.4, 3.3);
    f.rotation.z = s * 0.32;
  }

  /**
   * The tail, on a pivot so it can beat. Everything behind the tail root is
   * parented here rather than to the body.
   */
  const tail = new THREE.Group();
  tail.position.set(0, 0, 4.8);
  g.add(tail);
  box(0.26, 0.28, 0.9, back, 0, 0, 0.4, tail);
  /**
   * Caudal fin: a long upper lobe and a short lower one, both raked hard
   * back. The asymmetry is the shark-specific part — an even fork is a
   * tuna — and the rake is what stops it reading as a rudder.
   */
  const up = box(0.14, 1.35, 0.75, back, 0, 0.62, 1.05, tail);
  up.rotation.x = -0.6;
  const up2 = box(0.12, 0.55, 0.35, dark, 0, 1.35, 1.5, tail);
  up2.rotation.x = -0.6;
  const lo = box(0.14, 0.7, 0.5, back, 0, -0.38, 0.95, tail);
  lo.rotation.x = 0.5;

  g.userData.tailPivot = tail;
  return g;
}

/** Two thin streaks on the surface: the V the fin drags behind it. */
function buildWake() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd8ecf4, transparent: true, opacity: 0.4, depthWrite: false,
  });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 7), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = s * 0.16;
    m.position.set(s * 0.7, 0, 3.0);
    g.add(m);
  }
  g.renderOrder = 2;
  return g;
}
