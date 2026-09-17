/**
 * THE SHARK IN SHIZUKA WARD'S LAKE.
 *
 * It cruises just under the surface with its fin showing, breaches clear of
 * the water every half-minute or so, and eats anybody who stays in the lake
 * for more than a moment.
 *
 * ── the shape of it ───────────────────────────────────────────────────────
 * `CFG.shark.alert` seconds in the water and it COMMITS: turns, and charges
 * at one honest speed until it arrives. The timer starts the chase; what
 * finishes you is the shark reaching you.
 *
 * That ordering matters. An earlier version EATS you on the timer instead,
 * which forces the speed to be solved backwards from the arrival time — at
 * range that is a torpedo and up close it is a shark politely slowing down,
 * and neither is a thing you can watch happen. A charge on a timer needs
 * only one speed, and the seconds between the fin turning toward you and
 * the water closing over you are the part worth having.
 *
 * ── it is never far away, and that is deliberate ──────────────────────────
 * The cruise target wanders inside a ring 26–62 units from the point on the
 * shoreline nearest the player, and it repositions briskly when it falls
 * behind. That keeps the FIN somewhere you can see it, which is half of why
 * this exists — a shark cruising the far side of a lake is a shark nobody
 * ever knows about — and it keeps a charge down to a couple of seconds.
 * It is a cheat, and it is invisible, because a lake this size has no "far
 * side" you can watch from the shore anyway.
 *
 * ── it really does swim ───────────────────────────────────────────────────
 * Position is integrated along a heading with a capped turn rate, never
 * lerped toward a target, and never corrected afterwards: it banks into its
 * turns, it can overshoot, and it slides along the shoreline rather than
 * being shoved off it. The turn rate is solved from a fixed RADIUS, so the
 * faster it charges the harder it turns — a fixed rate gave it a turn
 * circle wider than the distance to its prey, and it sailed straight past.
 *
 * It also never leaves the water. `swimAt` is solved from the map's own
 * height function at build time, and the charge is not exempt from it.
 */

import * as THREE from '../lib/three.module.js?v=v149';
import { CFG } from './config.js?v=v149';
import { clamp } from './util.js?v=v149';

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

    /**
     * Everything that is a LENGTH scales with the animal.
     *
     * The model is authored at unit scale and `CFG.shark.scale` sizes it, so
     * every measurement that has to agree with the body — how deep it
     * cruises, how high the fin reaches, how far the mouth is from the
     * middle, how much water it draws, how far it leaps — is derived here
     * rather than written out a second time at the new size. Change `scale`
     * and the whole animal, its patrol and its bite move together.
     */
    this.scale = S.scale;
    this.depth = S.cruiseDepth * this.scale;
    this.finTop = S.finTop * this.scale;
    this.reach = S.biteRange * this.scale;
    this.height = S.breachHeight * this.scale;

    this.state = SHARK.CRUISE;
    this.pos = new THREE.Vector3(this.swimAt + 26, this.waterY - this.depth, 0);
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
    this.group.scale.setScalar(this.scale);
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
   * SWIM ROUND THE ISLAND, not into it.
   *
   * The lake is a square ring, so a straight line between two points on
   * opposite faces goes overland. Left to itself the shark pointed at the
   * target, hit the shoreline, and crawled along it at whatever sideways
   * component its heading happened to have — pinned against the beach
   * eighty units from a swimmer it could see, for ever. Four of forty-eight
   * entries in the test simply never got there, which is the only way that
   * behaviour was ever going to come to light.
   *
   * So when the direct path would cut the corner off, it aims at the CORNER
   * instead — whichever of the four makes the whole journey shortest — and
   * re-checks each frame, so it goes direct again the moment it can. Two
   * hops gets you anywhere on a square ring.
   *
   * @returns [x, z] to steer at, or null when straight there is fine
   */
  _wayRound(tx, tz) {
    const mx = (this.pos.x + tx) * 0.5, mz = (this.pos.z + tz) * 0.5;
    if (Math.max(Math.abs(mx), Math.abs(mz)) >= this.swimAt) return null;
    const r = this.swimAt;
    let best = null, bestD = Infinity;
    for (const cx of [-r, r]) {
      for (const cz of [-r, r]) {
        const d = Math.hypot(cx - this.pos.x, cz - this.pos.z)
          + Math.hypot(tx - cx, tz - cz);
        if (d < bestD) { bestD = d; best = [cx, cz]; }
      }
    }
    return best;
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
       * No solved-for-arrival-time speed: `alert` is when it COMMITS, not
       * when it bites, so the charge only has to be fast — it does not have
       * to be fast by a computed amount. That is why this is a constant and
       * the eat is simply what happens when it gets here.
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
    /**
     * Aim at a point it can actually reach: the target pulled out to the
     * swim line, and then routed round a corner if going straight there
     * would take it overland.
     */
    this._keepOut(this.target);
    const way = this._wayRound(this.target.x, this.target.z);
    const aimX = way ? way[0] : this.target.x;
    const aimZ = way ? way[1] : this.target.z;
    const want = Math.atan2(aimX - this.pos.x, aimZ - this.pos.z);
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
    const wasAbove = this.pos.y - this.depth * 0.4 > this.waterY;
    let pitch = 0;
    if (this.breachT > 0) {
      this.breachT -= dt;
      if (this.breachT < 0) this.breachT = 0;
      const t = 1 - this.breachT / S.breachTime;        // 0 -> 1
      /**
       * A DOLPHIN JUMP: one clean parabola out and back in.
       *
       * `4t(1-t)` peaks at 1 exactly halfway, so the arc is symmetric and it
       * re-enters at the depth it left.
       *
       * PITCH IS THE DERIVATIVE OF THE ARC, not a separate fudge.
       *
       * The first version lerped the nose from +0.75 to -0.75 radians on its
       * own clock, which is a body rotating on a schedule while separately
       * being moved along a curve — the two disagree everywhere except the
       * ends, and the result was a shark that swam through its own jump at
       * the wrong angle and flattened out at the top. Taking the angle from
       * the actual velocity makes the body point along the path by
       * construction: steeply up off the surface, level at the apex, nose
       * first on the way back in.
       */
      const arc = 4 * t * (1 - t);
      const rise = this.height;
      this.pos.y = this.waterY - this.depth + arc * rise;
      const vy = rise * 4 * (1 - 2 * t) / S.breachTime;
      pitch = Math.atan2(vy, Math.max(4, this.speed));
      // A slow roll through the arc, so it corkscrews rather than staying
      // rigidly upright — the thing that makes a real breach look alive.
      this._breachRoll = Math.sin(t * Math.PI) * 0.5;
    } else {
      // Cruising depth, with a slow bob so the fin cuts rather than glides.
      const bob = Math.sin(this.pos.x * 0.06 + this.pos.z * 0.05) * 0.12;
      this.pos.y = this.waterY - this.depth + bob;
      this._breachRoll = 0;
      pitch = 0;
    }
    /**
     * One-frame flags for the surface being broken, in either direction, so
     * the game can throw a splash without knowing anything about breaching.
     */
    const nowAbove = this.pos.y - this.depth * 0.4 > this.waterY;
    this.brokeSurface = nowAbove !== wasAbove;

    // ---- the bite -------------------------------------------------------
    if (this.state === SHARK.STRIKE) {
      /**
       * Eaten when it ARRIVES. Nothing here is on a clock.
       *
       * The timer's whole job was to start the charge; what finishes you is
       * the shark reaching you, which is the version of this that can be
       * watched happening. It is also why there is no escape clause: a
       * swimmer flees at 16.5 and this closes at `strikeSpeed`.
       */
      const dist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (dist <= this.reach) {
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
    // Bank into the turn, and roll through a breach.
    const bank = clamp(this.speed * 0.006, 0, 0.5);
    this.group.rotateZ(Math.sin(this.yaw * 2) * bank * 0.2
      + (this._breachRoll || 0));

    // Tail beat, faster when it is moving faster. This is the only thing
    // that separates "a shark" from "a shark-shaped rock being dragged".
    this._beat = (this._beat || 0) + (0.8 + this.speed * 0.13) * dt;
    if (this.tailPivot) {
      this.tailPivot.rotation.y = Math.sin(this._beat * 6) * 0.42;
    }

    // The wake only exists while the fin is above the surface.
    const finUp = this.pos.y + this.finTop > this.waterY + 0.05;
    this.wake.visible = finUp && this.breachT <= 0;
    if (this.wake.visible) {
      this.wake.position.set(this.pos.x, this.waterY + 0.06, this.pos.z);
      this.wake.rotation.y = this.yaw;
      const s = (0.6 + clamp(this.speed / 40, 0, 1.6)) * this.scale;
      this.wake.scale.set(s, 1, s);
    }
    void S;
  }
}

/**
 * The model: a slate-backed, pale-bellied fish with a fin that shows.
 *
 * ── IT FACES +Z, and that is not an arbitrary choice ──────────────────────
 * `update` steers by a yaw and then moves along `(sin yaw, cos yaw)`, which
 * at yaw 0 is +z. A model authored nose-first down -z therefore swims
 * TAIL FIRST, for ever, and looks exactly like a shark being dragged
 * backwards through a lake — which is what the first version did. Every
 * offset below is measured with the snout at POSITIVE z and the tail at
 * negative, so "forward" means the same thing to the model and the motion.
 *
 * Built from flat-shaded boxes like everything else in this game, at unit
 * scale; `CFG.shark.scale` sizes the whole animal from one number. The one
 * dimension that is not a matter of taste is the DORSAL FIN's height — it
 * has to clear the cruising depth or the whole thing swims past invisibly,
 * which is the failure that would make this feature pointless.
 */
function buildSharkModel() {
  const g = new THREE.Group();
  const back = 0x3f4a54;          // darker than the first pass: it is scarier
  const belly = 0xc8c6bd;
  const dark = 0x2b333b;
  const tooth = 0xeeeae0;

  const box = (w, h, d, color, x, y, z, parent) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, flatShading: true }));
    m.position.set(x, y, z);
    (parent || g).add(m);
    return m;
  };

  // ---- body: tapering segments from the shoulders back to the tail root ---
  box(1.62, 1.40, 2.3, back, 0, 0, -0.3);
  box(1.34, 1.16, 1.9, back, 0, -0.03, -2.0);
  box(0.92, 0.82, 1.5, back, 0, -0.06, -3.4);
  box(0.54, 0.50, 1.2, back, 0, -0.06, -4.5);

  // ---- head: a wedge that comes to a point, not a brick ------------------
  box(1.40, 1.15, 1.3, back, 0, 0.04, 1.05);
  box(1.05, 0.82, 1.0, back, 0, 0.10, 2.05);
  box(0.62, 0.46, 0.8, back, 0, 0.16, 2.80);
  /**
   * THE MOUTH, which is most of what makes it frightening rather than
   * merely large: a dark recess slung UNDER the snout, the way a shark's
   * is, with a row of teeth along it. A mouth drawn at the tip reads as a
   * dolphin's smile; underslung reads as a shark.
   */
  box(1.02, 0.42, 1.2, dark, 0, -0.44, 1.95);
  /**
   * TEETH THAT HIDE UNDER THE SNOUT.
   *
   * The row used to be wider than the nose above it, so the outermost tooth
   * each side stuck past the silhouette. From ABOVE — which is how you see
   * a shark cruising past you in a lake — that is two bright specks on its
   * head, and they read as a pair of little lights rather than as a mouth.
   *
   * The fix is a tolerance, not a deletion: ±0.23 of tooth under ±0.31 of
   * snout, so the nose covers them completely from overhead. They sit just
   * FORWARD of the mouth recess rather than inside it — the first attempt
   * tucked them so far back that the dark box swallowed them and the shark
   * lost its teeth altogether, which fixes the complaint by removing the
   * feature.
   *
   * From the front and from underneath, where a mouth is meant to be read
   * from — and where you are when it is eating you — nothing has changed.
   */
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const ox = (t - 0.5) * 0.44;
    box(0.08, 0.24, 0.10, tooth, ox, -0.30, 2.62);
    box(0.07, 0.18, 0.09, tooth, ox, -0.57, 2.56);
  }
  // Eyes, set wide and forward, and a pale flash under the jaw.
  for (const s of [-1, 1]) {
    box(0.16, 0.16, 0.16, 0x0d1013, s * 0.58, 0.22, 1.85);
  }
  box(1.08, 0.28, 2.0, belly, 0, -0.62, 1.4);

  // ---- pale belly and gills ---------------------------------------------
  box(1.40, 0.38, 3.8, belly, 0, -0.72, -1.0);
  for (let i = 0; i < 5; i++) {
    const z = 0.9 - i * 0.30;
    box(0.06, 0.62, 0.06, dark, 0.80, -0.02, z);
    box(0.06, 0.62, 0.06, dark, -0.80, -0.02, z);
  }

  /**
   * THE DORSAL FIN — the thing you actually see from the shore.
   *
   * Raked backwards (each slab steps toward -z as it rises) because a
   * vertical triangle reads as a sail. Three slabs is indistinguishable
   * from a swept triangle at this art style and costs three boxes.
   */
  box(0.24, 0.95, 1.35, back, 0, 1.02, -0.85);
  box(0.19, 0.70, 0.85, back, 0, 1.70, -1.25);
  box(0.14, 0.48, 0.42, dark, 0, 2.22, -1.60);

  /**
   * Pectoral fins, and the size of these is not a matter of taste either.
   * An early pass made them three units across on a body one and a half
   * wide, and rendered they were two grey slabs with a fish somewhere
   * between them. Every fin is smaller than the body it hangs off.
   */
  for (const s of [-1, 1]) {
    const f = box(1.05, 0.11, 0.62, back, s * 0.86, -0.42, -0.9);
    f.rotation.z = s * 0.32;
    f.rotation.y = s * 0.42;
  }
  // Second dorsal and the pelvic pair — the detail that separates a shark
  // silhouette from a dolphin's.
  box(0.12, 0.30, 0.38, back, 0, 0.60, -3.7);
  for (const s of [-1, 1]) {
    const f = box(0.48, 0.10, 0.32, back, s * 0.36, -0.44, -3.4);
    f.rotation.z = s * 0.34;
  }

  /**
   * The tail, on a pivot so it can beat. Everything behind the tail root is
   * parented here rather than to the body.
   */
  const tail = new THREE.Group();
  tail.position.set(0, 0, -4.7);
  g.add(tail);
  // A long caudal peduncle, so the fin grows out of the body instead of
  // floating behind it — the first pass left a visible gap at this joint.
  box(0.30, 0.34, 1.5, back, 0, 0, -0.55, tail);
  /**
   * Caudal fin: a long upper lobe and a short lower one, both raked hard
   * back. The asymmetry is the shark-specific part — an even fork is a
   * tuna — and the rake is what stops it reading as a rudder.
   */
  const up = box(0.16, 1.85, 0.85, back, 0, 0.72, -1.05, tail);
  up.rotation.x = 0.66;
  const up2 = box(0.14, 0.7, 0.4, dark, 0, 1.62, -1.62, tail);
  up2.rotation.x = 0.66;
  const lo = box(0.16, 0.9, 0.55, back, 0, -0.46, -0.96, tail);
  lo.rotation.x = -0.55;

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
