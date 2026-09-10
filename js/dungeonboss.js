/**
 * A guardian fight.
 *
 * One AI, driven by a per-boss moveset drawn from shared ATTACK PRIMITIVES.
 * That is what lets forty of them fight genuinely differently — a leaping eel,
 * a stone thrower, a blinking duellist and a spinning brute all run this same
 * loop — while guaranteeing they cannot invent an unfair attack between them.
 *
 * Every primitive follows the same three beats:
 *   TELEGRAPH — the danger is drawn on the floor. Nothing can hurt you yet.
 *   STRIKE    — the hitbox opens, exactly where the marker was.
 *   RECOVER   — the opening. This is when you punish it.
 *
 * ── why a guardian cannot be shot to death from twenty units ───────────────
 * It used to be possible to stand outside every marker and throw kunai until
 * a boss fell over, which is not a fight, it is a chore with a health bar.
 * Four rules, all of them learnable in one fight, close that off WITHOUT
 * touching the health pool:
 *
 *   GUARD     Thrown damage lands at a fraction while the guardian is on its
 *             feet and watching you. It cannot guard mid-strike, and it cannot
 *             guard its recovery.
 *   PUNISH    Three guarded hits, or a few seconds spent camping at range,
 *             and the next move is guaranteed to be a gap-closer. Camping is
 *             answered, not forbidden.
 *   WINDOW    Recovery and stagger take DOUBLE from a thrown blade. A kunai
 *             spent on the right beat is worth four spent on the wrong one.
 *   WEAK      A head hit ignores the guard entirely. Aim, and range works.
 *
 * So the loop the fight teaches is: read → dodge → close → cut → break its
 * poise → spend a kunai on the opening → back out. Kunai stay strong. Kunai
 * SPAM does not.
 *
 * ── phases ────────────────────────────────────────────────────────────────
 * Each rank gets two to four phases off the same health pool. A boundary is a
 * hard beat: the guardian is briefly untouchable, the arena is cleared, the
 * telegraph tightens, and two new primitives unlock — picked from a table
 * keyed off the spec's own id, so a given guardian escalates the same way
 * every time and no two escalate alike.
 *
 * Stats compound with depth; the telegraph shortens but never below
 * CFG.dungeon.boss.minTelegraph, so a deep guardian is faster to read, never
 * unreadable. Nothing here raises damage above what the difficulty curve
 * already sets, and nothing here is unavoidable.
 */

import * as THREE from '../lib/three.module.js?v=v101';
import { CFG } from './config.js?v=v101';
import { clamp, lerp, damp, dampAngle, lookYaw } from './util.js?v=v101';
import { GUARDIANS, buildGuardian } from './guardians.js?v=v101';
import { Audio } from './audio.js?v=v101';

const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _side = new THREE.Vector3();

/**
 * Moves that travel along the FLOOR, and can therefore be jumped.
 *
 * These are drawn in a distinct colour so the rule is learnable from one
 * look: an amber ring means "get off the ground", a red one means "get out
 * of the way". Without an answer other than running, a wide ground wave from
 * a big guardian is just an unavoidable tax.
 */
const GROUND_MOVES = new Set(['shockwave', 'spin', 'quake', 'storm']);
const WARN_RED = 0xff7a3c;      // move out of it
const WARN_AMBER = 0xffd24a;    // jump over it
/**
 * A teleport is coming — dash or parry it.
 *
 * Its own colour because it is the one warning you cannot answer by walking:
 * the guardian is about to be somewhere else, so moving out of the marked
 * circle achieves nothing. Violet reads as clearly different from the two
 * ground colours at a glance, which is the whole job.
 */
const WARN_BLINK = 0xb07aff;
/** A shell is going up. White, because the answer is "get in there". */
const WARN_GUARD = 0xdff4ff;

const STATE = {
  IDLE: 'idle',
  APPROACH: 'approach',
  TELEGRAPH: 'telegraph',
  STRIKE: 'strike',
  RECOVER: 'recover',
  DODGE: 'dodge',
  STAGGER: 'stagger',
  PHASE: 'phase',
  DEAD: 'dead',
};

/**
 * How each primitive behaves.
 *   range    the distance it wants to start from
 *   windup   telegraph multiplier
 *   recover  seconds of opening afterwards
 *   hits     how many strikes it chains
 *   dmg      multiplier on the boss's base damage
 *
 * `recover` is never below 0.4. That number is the counter-attack window and
 * it is the whole reason the fight is winnable — a boss with no recovery is
 * not hard, it is a wall.
 */
const MOVES = {
  slam:      { range: 4.5, windup: 1.35, recover: 0.95, hits: 1, dmg: 1.4 },
  combo:     { range: 4.0, windup: 0.75, recover: 0.55, hits: 3, dmg: 0.7 },
  charge:    { range: 15, windup: 1.10, recover: 0.85, hits: 1, dmg: 1.2 },
  leap:      { range: 14, windup: 1.20, recover: 0.90, hits: 1, dmg: 1.35 },
  throw:     { range: 18, windup: 0.90, recover: 0.60, hits: 1, dmg: 0.9 },
  volley:    { range: 16, windup: 1.00, recover: 0.70, hits: 1, dmg: 0.7 },
  spin:      { range: 5.0, windup: 1.15, recover: 1.00, hits: 1, dmg: 1.1 },
  shockwave: { range: 8.0, windup: 1.25, recover: 0.90, hits: 1, dmg: 1.15 },
  spores:    { range: 10, windup: 1.10, recover: 0.80, hits: 1, dmg: 0.85 },
  puddle:    { range: 9.0, windup: 0.95, recover: 0.70, hits: 1, dmg: 0.8 },
  blink:     { range: 12, windup: 0.70, recover: 0.45, hits: 1, dmg: 0.9 },
  ringout:   { range: 12, windup: 1.20, recover: 0.85, hits: 1, dmg: 1.0 },

  // ---- unlocked by later phases -----------------------------------------
  /** A wide two-beat arc. Close range, and it covers the sidestep. */
  sweep:     { range: 5.5, windup: 1.00, recover: 0.80, hits: 2, dmg: 1.0 },
  /** Three charges back to back, each re-telegraphed. Keep moving. */
  rush:      { range: 17, windup: 1.05, recover: 1.10, hits: 3, dmg: 0.9 },
  /** The ground opens under you. Vertical, so jumping is NOT the answer. */
  erupt:     { range: 13, windup: 1.30, recover: 0.80, hits: 1, dmg: 1.25 },
  /** Five aimed bolts in sequence. Punishes standing still at any range. */
  barrage:   { range: 20, windup: 0.95, recover: 0.95, hits: 5, dmg: 0.55 },
  /** Three expanding rings you dodge THROUGH, or jump. */
  quake:     { range: 11, windup: 1.40, recover: 1.20, hits: 1, dmg: 1.2 },
  /** A shell: thrown blades do nothing to it. Cut it down. */
  barrier:   { range: 8.0, windup: 0.80, recover: 0.45, hits: 1, dmg: 0 },
  /** Five rings and a floor full of hazards. The last phase's opener. */
  storm:     { range: 12, windup: 1.50, recover: 1.30, hits: 1, dmg: 0.9 },
};

/** Moves whose `hits` are chained with a short re-telegraph between them. */
const CHAINED = new Set(['combo', 'sweep', 'rush', 'barrage']);
/** What a guardian reaches for when it has decided you are too far away. */
const CLOSERS = ['charge', 'leap', 'blink', 'rush'];
/** Sweeps the air clear of thrown blades — see `_eatProjectiles`. */
const EATS_BLADES = new Set(['shockwave', 'spin', 'quake', 'storm', 'barrier']);
/**
 * Inside this, you are in the fight.
 *
 * It gates the one bonus big enough to matter — double damage on a thrown
 * blade during a recovery. See `takeDamage`.
 */
const CLOSE = 13;

/**
 * The difficulty ladder.
 *
 *   phases  how many times the fight changes shape
 *   health  a modest multiplier on the curve — the DIFFICULTY is in the
 *           moveset, not in the size of the bar
 *   chain   chance of following a finished move straight into another one
 *   dodge   chance of hopping out of a swing it can see coming
 *   guard   fraction of THROWN damage that gets through while it is guarding
 *   arena   seconds between the arena's own hazards, from phase two
 */
const RANKS = {
  elite: { phases: 2, health: 1.00, chain: 0.22, dodge: 0.08, guard: 0.45, arena: 7.0 },
  mini:  { phases: 2, health: 1.15, chain: 0.32, dodge: 0.16, guard: 0.38, arena: 6.0 },
  major: { phases: 3, health: 1.35, chain: 0.42, dodge: 0.24, guard: 0.28, arena: 5.0 },
  final: { phases: 4, health: 1.60, chain: 0.52, dodge: 0.32, guard: 0.22, arena: 4.0 },
};

/**
 * What each phase boundary unlocks.
 *
 * Indexed by a hash of the spec's own id, so THIS guardian always escalates
 * this way and its neighbour does not. Every entry is a primitive the player
 * has already been taught to read somewhere else in the world.
 */
const PHASE_UNLOCKS = [
  [['erupt', 'rush'], ['quake', 'barrier'], ['storm', 'quake']],
  [['sweep', 'erupt'], ['barrier', 'barrage'], ['storm', 'barrier']],
  [['rush', 'barrage'], ['quake', 'erupt'], ['storm', 'quake']],
  [['erupt', 'sweep'], ['barrier', 'quake'], ['storm', 'erupt']],
];

/** Stable small hash, so a spec's escalation never shuffles between runs. */
function idHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h;
}

export class DungeonBoss {
  /**
   * @param index  which room this is, 0-14. Drives the stat curve.
   * @param opts   the OVERWORLD's way in, and nothing the dungeon passes:
   *                 spec      an explicit guardian spec, for the ones that
   *                           live in the open world and have no room number
   *                 power     what to use instead of `index` on the stat
   *                           curve, so a region's tier decides how hard its
   *                           guardian hits rather than an arbitrary index
   *                 scale     body size override
   *                 rank      'elite' | 'mini' | 'major' | 'final' — the
   *                           difficulty ladder. See RANKS.
   *                 arenaRadius  how much floor the fight has, for the arena
   *                           hazards of the later phases
   *                 groundAt  (x, z) => y. Given one, the guardian STANDS ON
   *                           the terrain instead of on a fixed plane — a
   *                           dungeon room is dead flat, an open-world arena
   *                           never quite is.
   *                 kunai     the KunaiSystem, so a ground wave can sweep
   *                           blades out of the air
   *                 onPhase   (phase, of, boss) => void, for the HUD's
   *                           announcement and the music
   */
  constructor(index, spot, scene, effects, collision, opts = {}) {
    const D = CFG.dungeon.boss;
    this.index = index;
    this.scene = scene;
    this.effects = effects;
    this.collision = collision;
    this.spec = opts.spec || GUARDIANS[index] || GUARDIANS[GUARDIANS.length - 1];
    this.moves = this.spec.moves;
    this.groundAt = opts.groundAt || null;
    this.kunai = opts.kunai || null;
    this.onPhase = opts.onPhase || null;
    this.arenaRadius = opts.arenaRadius || 26;

    const power = opts.power === undefined ? index : opts.power;
    const g = (base, growth) => base * Math.pow(growth, power);
    // Per-boss trim on top of the curve, for the ones the curve overshot.
    const tune = this.spec.tune || 1;

    /**
     * Rank, and what it does.
     *
     * A dungeon room's rank comes from how deep it is; the open world hands
     * one in from the region's tier. It never touches how hard a blow lands —
     * only how many phases the fight has, how willing it is to chain, how
     * well it guards, and a small multiplier on the bar.
     */
    this.rank = opts.rank || this.spec.rank
      || (power >= 11 ? 'final' : power >= 7 ? 'major' : power >= 3.5 ? 'mini' : 'elite');
    const R = RANKS[this.rank] || RANKS.elite;
    this.R = R;

    this.maxHealth = Math.round(g(D.baseHealth, D.healthGrowth) * tune * R.health);
    this.health = this.maxHealth;
    this.damage = Math.round(g(D.baseDamage, D.damageGrowth) * tune);
    this.speed = g(D.baseSpeed, D.speedGrowth);
    this.telegraph = Math.max(D.minTelegraph,
      D.telegraph * Math.pow(D.telegraphShrink, power));
    this.minTelegraph = D.minTelegraph;
    this.reach = D.reach;

    this.rig = buildGuardian(this.spec);
    this.model = this.rig;                 // the run treats these the same
    this.scaleFactor = opts.scale || (1.5 + power * 0.05);
    this.rig.root.scale.setScalar(this.scaleFactor);
    this.hovers = this.rig.hover;

    this.pos = spot.clone();
    if (this.hovers) this.pos.y += 1.6;
    this.baseY = this.pos.y;
    this.yaw = Math.PI;
    this.rig.root.position.copy(this.pos);
    this.setFacing(this.yaw);
    scene.add(this.rig.root);

    this.state = STATE.IDLE;
    this.timer = 0;
    this.active = false;
    this.moveSpeed = 0;
    this.struck = false;
    this.hitsLeft = 0;
    this.move = null;
    this.projectiles = [];
    this.hazards = [];
    this.waves = [];
    this.chargeDir = new THREE.Vector3();
    this.leapFrom = new THREE.Vector3();
    this.leapTo = new THREE.Vector3();
    this.leapT = 0;
    this.dodgeFrom = new THREE.Vector3();
    this.dodgeTo = new THREE.Vector3();
    this.dodgeT = 0;
    this.justDied = false;
    this.windingGroundWave = false;
    this.t = Math.random() * 5;
    this.stride = 0;
    this.hurtT = 0;
    this.swingT = 0;

    // ---- phases -----------------------------------------------------------
    this.phase = 1;
    this.phaseCount = R.phases;
    this.unlocks = PHASE_UNLOCKS[idHash(this.spec.id || this.spec.name)
      % PHASE_UNLOCKS.length];
    /** The pool it actually picks from. Grows at every phase boundary. */
    this.pool = this.moves.slice();
    this.invuln = false;

    // ---- guard, poise, punishment ----------------------------------------
    /**
     * Poise. Melee damage fills it; a full bar staggers the guardian wide
     * open. Measured as a FRACTION of its health so it works at every point
     * on the stat curve without a second table, and the bar it takes grows
     * after each break so nothing can be stagger-locked to death.
     */
    this.poise = 0;
    this.poiseMax = this.maxHealth * 0.13;
    this.staggers = 0;
    /** Guarded hits since the last punish. Three, and it comes for you. */
    this.deflects = 0;
    /** Seconds spent outside `FAR` since the last punish. */
    this.farT = 0;
    this.forceClose = false;
    this.dodgeCd = 2.0;
    /**
     * How far away the player was last frame.
     *
     * Zero until it has been updated once, which reads as "right next to me"
     * — the generous answer, and the right one: a guardian that has not run a
     * frame yet has not had a chance to guard anything either.
     */
    this.playerDist = 0;
    /** Lateral drift while closing, so it is not a walking target. */
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 1.5;
    /** How many extra moves this exchange may still chain into. */
    this.chainLeft = 0;

    // ---- the shell -------------------------------------------------------
    this.barrierT = 0;
    this.barrierHp = 0;
    this.barrierMax = 4 + (R.phases - 2);
    this.barrierMesh = null;

    // ---- the arena's own hazards, from phase two -------------------------
    this.arenaT = R.arena;
  }

  /**
   * The radius a move actually covers.
   *
   * ONE source of truth, read by both the warning marker and the hit test.
   * They used to be computed separately with different multipliers, so the
   * ring on the floor was smaller than the thing that hit you — the marker
   * lied. And the shockwave scaled to 40 units inside a 34-unit room, which
   * made the later guardians literally impossible to walk out of.
   */
  _moveRadius(move) {
    const R = this.reach * this.scaleFactor;
    switch (move) {
      case 'shockwave': return R * 2.2;
      case 'spin': return R * 1.4;
      case 'slam': return R * 1.3;
      case 'leap': return R * 1.35;
      case 'spores':
      case 'puddle': return R * 1.6;
      case 'charge':
      case 'rush': return R;
      case 'sweep': return R * 1.9;
      case 'erupt': return R * 1.5;
      case 'quake':
      case 'storm': return R * 2.2;
      case 'barrier': return R;
      default: return R * 1.2;                 // combo, blink, throw, barrage
    }
  }

  get name() { return this.spec.name; }
  get blurb() { return this.spec.blurb; }
  get fraction() { return clamp(this.health / this.maxHealth, 0, 1); }
  get alive() { return this.health > 0; }

  /**
   * Is it open right now?
   *
   * Recovery and stagger, and nothing else. This is the beat the whole fight
   * is built around: it is when a thrown blade is worth double, and it is the
   * only time the guard is off while it is still on its feet.
   */
  get vulnerable() {
    return this.state === STATE.RECOVER || this.state === STATE.STAGGER;
  }

  /** Committed to a swing: it cannot guard, and it cannot dodge. */
  get committed() {
    return this.state === STATE.STRIKE || this.state === STATE.TELEGRAPH;
  }

  setFacing(yaw) { this.rig.root.rotation.y = yaw + Math.PI; }

  begin() {
    this.active = true;
    this.state = STATE.APPROACH;
    this.timer = 0.9;
    // Catch up on any boundary crossed while it was asleep. A guardian shot
    // at from outside its ring, or one handed damage by a test harness, would
    // otherwise wake up in phase one with a third of a health bar — and,
    // worse, could not have run the transition at all because the transition
    // needs the update loop to end its own invulnerability.
    while (this.phase < this.phaseCount
           && this.fraction <= 1 - this.phase / this.phaseCount) {
      this._advancePhase();
    }
  }

  /**
   * Damage.
   *
   * @param amount raw damage
   * @param o      { ranged, head } — a THROWN blade sets `ranged`, and a hit
   *               on the head sets `head`. The katana passes neither, so a
   *               plain `takeDamage(n)` is a full-strength melee hit and every
   *               caller that predates the guard still behaves as it did.
   * @returns true if this blow killed it
   */
  takeDamage(amount, o = {}) {
    if (!this.alive) return false;

    // A phase boundary is a beat, not a damage window. Nothing lands, and it
    // is obvious on screen that nothing landed.
    if (this.invuln) { this._deflect(); return false; }

    const ranged = !!o.ranged;
    let dmg = amount;
    let guarded = false;

    if (this.vulnerable) {
      /**
       * The opening.
       *
       * A katana always gets the bonus — you had to be standing next to the
       * thing to swing it. A thrown blade gets DOUBLE, but only from inside
       * `CLOSE`: the opening is a beat, and a blade launched from twenty
       * units arrives after it has passed.
       *
       * That distance is what separates skill from spam. Throwing on cooldown
       * from across the arena catches a recovery every third throw by pure
       * luck, and without this it caught it at double damage — which made
       * standing still and holding the button the strongest thing in the
       * game, again, by accident. In close, on the beat, a kunai is the best
       * damage in the fight. Out there, it is chip.
       */
      const close = this.playerDist < CLOSE;
      dmg *= ranged ? (close ? 2.0 : 0.8) : 1.5;
    } else if (o.head) {
      /**
       * The weak point ignores the guard entirely. Aiming is the answer.
       *
       * A small MULTIPLIER on top, not a large one: a thrown blade already
       * does double damage on a head hit (CFG.kunai.headshotDamage), so
       * anything generous here turns "throw at its head" back into the one
       * strategy the whole guard exists to stop.
       */
      dmg *= 1.25;
    } else if (ranged && this.barrierT > 0) {
      // The shell eats thrown blades whole. Walk in and cut it off.
      this._deflect();
      return false;
    } else if (ranged && !this.committed) {
      dmg *= this.R.guard;
      guarded = true;
    } else if (!ranged && this.barrierT > 0) {
      // Melee is what breaks a shell, so it lands — at a cost — and every
      // blow takes a plate off.
      dmg *= 0.5;
      this._hitBarrier();
    }

    dmg = Math.max(1, Math.round(dmg));
    this.health = Math.max(0, this.health - dmg);
    this.hurtT = 0.18;

    // Poise: melee fills it fast, thrown blades barely. Breaking it is the
    // reward for closing the distance.
    if (this.state !== STATE.STAGGER) {
      this.poise += dmg * (ranged ? 0.35 : 1);
    }

    _tmp.set(this.pos.x, this.pos.y + 1.8 * this.scaleFactor, this.pos.z);
    if (guarded) {
      this._deflect();
      this.deflects++;
      // Three guarded hits and it stops tolerating the range. This is the
      // answer to standing still and throwing: not immunity, retaliation.
      if (this.deflects >= 3) { this.deflects = 0; this.forceClose = true; }
    } else {
      this.effects.hitBurst(_tmp, { x: 0, y: 0, z: 1 }, dmg > 30);
    }

    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this.invuln = false;
      this.justDied = true;
      this.effects.deathBurst(_tmp, this.spec.trim);
      Audio.death(this.pos);
      return true;
    }

    // Stagger before phase, so a blow that does both reads as the bigger of
    // the two — a phase transition already includes a wide-open beat.
    if (this._phaseDue()) { this._enterPhase(); return false; }
    if (this.poise >= this.poiseMax && this.active
        && this.state !== STATE.STAGGER) {
      this._stagger();
    }
    return false;
  }

  /** A blow that did not land: a spark, a ring and the parry note. */
  _deflect() {
    _tmp.set(this.pos.x, this.pos.y + 1.6 * this.scaleFactor, this.pos.z);
    this.effects.puff(_tmp, 0xdff4ff, 6, 5);
    this.effects.ring(_tmp, 0.6, 2.2 * this.scaleFactor, 0.22, WARN_GUARD, false);
    Audio.parry(this.pos);
  }

  _hitBarrier() {
    this.barrierHp--;
    _tmp.set(this.pos.x, this.pos.y + 1.6 * this.scaleFactor, this.pos.z);
    this.effects.puff(_tmp, WARN_GUARD, 10, 6);
    if (this.barrierHp > 0) return;
    // Cut through the shell: it drops, and the guardian reels. Breaking a
    // barrier has to PAY, or nobody would bother walking into one.
    this.barrierT = 0;
    this.effects.ring(_tmp, 1, 5 * this.scaleFactor, 0.4, WARN_GUARD, false);
    this.effects.dustPuff(_tmp, 18, 6, 0xdff4ff);
    Audio.parry(this.pos);
    if (this.active) this._stagger(1.3);
  }

  /** Wide open, and unable to act. The payoff for melee pressure. */
  _stagger(dur = 1.05) {
    this.state = STATE.STAGGER;
    this.timer = dur;
    this.poise = 0;
    this.staggers++;
    // Each break costs more than the last, so a fight cannot be won by
    // stagger-locking one guardian in place until it falls over.
    this.poiseMax *= 1.18;
    this.move = null;
    this.hitsLeft = 0;
    this.chainLeft = 0;
    this.moveSpeed = 0;
    _tmp.set(this.pos.x, this.baseY + 0.2, this.pos.z);
    this.effects.ring(_tmp, 1, 4.2 * this.scaleFactor, dur, 0xfff0a8, true);
    Audio.tone({
      freq: 420, to: 90, dur: 0.5, type: 'triangle',
      volume: 0.14, pos: this.pos,
    });
  }

  // ---------------------------------------------------------------- phases

  /**
   * Health has dropped past the next boundary.
   *
   * Only while it is awake. The transition makes it briefly untouchable and
   * only the update loop can take that back, so triggering one on a sleeping
   * guardian would leave it invulnerable forever. `begin` catches up instead.
   */
  _phaseDue() {
    if (!this.active) return false;
    if (this.phase >= this.phaseCount) return false;
    return this.fraction <= 1 - this.phase / this.phaseCount;
  }

  /** The stat and moveset half of a phase change, with no theatre. */
  _advancePhase() {
    this.phase++;
    this.speed *= 1.09;
    this.telegraph = Math.max(this.minTelegraph, this.telegraph * 0.93);
    const add = this.unlocks[Math.min(this.phase - 2, this.unlocks.length - 1)];
    for (const m of add) if (this.pool.indexOf(m) === -1) this.pool.push(m);
  }

  /**
   * A phase boundary.
   *
   * The dramatic beat: untouchable for a moment, the arena swept clear by an
   * outward wave, the telegraph tightened, and two more primitives in the
   * pool. The wave DOES damage — but it is the widest, slowest, most obvious
   * thing in the fight and it starts at the guardian, so standing next to a
   * boss that is transforming is a choice.
   */
  _enterPhase() {
    this._advancePhase();
    this.state = STATE.PHASE;
    this.timer = 1.7;
    this.invuln = true;
    this.move = null;
    this.hitsLeft = 0;
    this.chainLeft = 0;
    this.moveSpeed = 0;
    this.poise = 0;
    this.deflects = 0;
    this.farT = 0;
    this.barrierT = 0;
    this._clearProjectiles();
    this.hazards.length = 0;
    this.waves.length = 0;
    this.pos.y = this.baseY;

    // The arena reacts: one wide wave out of the guardian, and from here on
    // the floor itself is a threat (see `_arena`).
    _tmp.set(this.pos.x, this.baseY + 0.3, this.pos.z);
    const R = Math.min(this.arenaRadius, 34);
    this.effects.ring(_tmp, 1, R, 1.1, this.spec.trim, true);
    this.effects.dustPuff(_tmp, 28, 9, 0xcfc0a0);
    this.waves.push({
      x: this.pos.x, z: this.pos.z, y: this.baseY,
      r: 2, speed: R / 1.5, max: R, band: 3.4,
      dmg: Math.round(this.damage * 0.8), jumpable: true,
      color: this.spec.trim, hit: false, tick: 0,
    });
    this._eatProjectiles(R);
    Audio.tone({
      freq: 70, to: 300, dur: 1.4, type: 'sawtooth',
      volume: 0.2, pos: this.pos,
    });
    Audio.slash(this.pos, 2);
    if (this.onPhase) this.onPhase(this.phase, this.phaseCount, this);
  }

  // ------------------------------------------------------------------- AI

  update(dt, player, onHit) {
    this.t += dt;
    /**
     * Follow the ground, if we were given a way to ask where it is.
     *
     * `baseY` is the height everything else is measured from — the floor
     * markers, the leap arc, the hover bob — so moving it is all it takes to
     * put this fight on a hillside. Read every frame rather than once, because
     * the guardian walks: a charge across a boss arena covers sixty units and
     * the far end is not the height of the near end.
     */
    if (this.groundAt) {
      this.baseY = this.groundAt(this.pos.x, this.pos.z) + (this.hovers ? 1.6 : 0);
      // Not while it is off the floor under its own power: the leap and the
      // dodge set pos.y from baseY themselves.
      const airborne = (this.state === STATE.STRIKE && this.move === 'leap')
        || this.state === STATE.DODGE;
      if (!airborne) this.pos.y = this.baseY;
    }
    this._updateProjectiles(dt, player, onHit);
    this._updateHazards(dt, player, onHit);
    this._updateWaves(dt, player, onHit);

    if (this.barrierT > 0) {
      this.barrierT -= dt;
      if (this.barrierT <= 0) this.barrierHp = 0;
    }

    if (!this.active || !this.alive) { this._animate(dt); return; }

    const target = player.pos;
    _to.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const dist = _to.length();
    if (dist > 0.001) _to.multiplyScalar(1 / dist);
    // Remembered so `takeDamage`, which is called from the player's own hit
    // path and has no idea where anybody is standing, can ask.
    this.playerDist = dist;

    // A rig's yaw points along -Z, so the direction TO the player is not a
    // yaw that looks at them — see lookYaw. This guardian used to turn its
    // back on you and fight over its shoulder.
    const want = lookYaw(this.pos.x, this.pos.z, target.x, target.z);
    const turn = this.state === STATE.TELEGRAPH ? 2.0 : 5.5;
    this.yaw = dampAngle(this.yaw, want, turn, dt);

    /**
     * Camping is answered, not forbidden.
     *
     * Sitting at throwing range and never closing used to be a free win. Now
     * the seconds are counted, and when the count runs out the next move is
     * guaranteed to be something that crosses the gap. You can still fight at
     * range — you just cannot fight there undisturbed.
     */
    if (dist > 22) {
      this.farT += dt;
      if (this.farT > 3.2) { this.farT = 0; this.forceClose = true; }
    } else if (this.farT > 0) {
      this.farT = Math.max(0, this.farT - dt * 0.6);
    }

    if (this.dodgeCd > 0) this.dodgeCd -= dt;
    this._arena(dt, player);

    this.timer -= dt;
    switch (this.state) {
      case STATE.APPROACH: this._approach(dt, dist, player); break;
      case STATE.TELEGRAPH:
        this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
        if (this.timer <= 0) this._beginStrike(player);
        break;
      case STATE.STRIKE: this._strike(dt, dist, player, onHit); break;
      case STATE.RECOVER:
        this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
        if (this.timer <= 0) { this.state = STATE.APPROACH; this.timer = 0.2; }
        break;
      case STATE.DODGE: this._dodge(dt); break;
      case STATE.STAGGER:
        this.moveSpeed = damp(this.moveSpeed, 0, 12, dt);
        if (this.timer <= 0) { this.state = STATE.APPROACH; this.timer = 0.25; }
        break;
      case STATE.PHASE:
        this.moveSpeed = 0;
        if (this.timer <= 0) {
          this.invuln = false;
          this.state = STATE.APPROACH;
          this.timer = 0.3;
        }
        break;
      default: break;
    }
    this._animate(dt);
  }

  /**
   * Pick the next move.
   *
   * Weighted by the pool, so a thrower still mostly throws — but never the
   * same three moves in the same order, and never one it cannot reach you
   * with when it has decided to close.
   */
  _pick(exclude) {
    if (this.forceClose) {
      this.forceClose = false;
      // Prefer a closer this guardian actually owns; fall back to a charge,
      // because a boss with no way to reach you is the exploit itself.
      const own = CLOSERS.filter((m) => this.pool.indexOf(m) !== -1);
      const from = own.length ? own : ['charge'];
      return from[Math.floor(Math.random() * from.length)];
    }
    let pool = this.pool;
    if (exclude) {
      const trimmed = pool.filter((m) => m !== exclude);
      if (trimmed.length) pool = trimmed;
    }
    // A shell is a set-up, not an attack: only worth raising once it can
    // actually be used, and never twice in a row.
    let m = pool[Math.floor(Math.random() * pool.length)];
    if (m === 'barrier' && (this.barrierT > 0 || this.phase < 2)) {
      m = pool[Math.floor(Math.random() * pool.length)];
      if (m === 'barrier') m = 'combo';
    }
    return m;
  }

  /**
   * Three candidates, one choice.
   *
   * A follow-up is drawn from three rolls rather than one so that the same
   * opener does not lead to the same second move every time. The fight stays
   * learnable — every attack is still telegraphed and still has the same
   * recovery — without being memorisable as a fixed script.
   */
  _pickFollowUp(after) {
    const a = this._pick(after), b = this._pick(after), c = this._pick(after);
    const roll = Math.random();
    return roll < 0.4 ? a : roll < 0.75 ? b : c;
  }

  /** Walk toward the range the chosen move wants to be at. */
  _approach(dt, dist, player) {
    // The move is picked BEFORE the approach so the walk has a purpose: a
    // thrower backs off, a duellist closes.
    if (!this.move) {
      this.move = this._pick(null);
      // Each fresh exchange is allowed to chain into two more moves. That is
      // the cap: after them there is always a full recovery.
      this.chainLeft = 2;
    }
    const M = MOVES[this.move] || MOVES.combo;

    const diff = dist - M.range;
    if (Math.abs(diff) > 1.6) {
      this.pos.addScaledVector(_to, this.speed * Math.sign(diff) * dt);
      this.moveSpeed = this.speed;
    } else {
      this.moveSpeed = damp(this.moveSpeed, 0, 6, dt);
    }

    /**
     * Drift sideways while closing.
     *
     * A guardian that walks a straight line at you is a target you can hit
     * without moving. The drift is small, has no hitbox and changes nothing
     * about how the attacks are read — it just means the player has to keep
     * adjusting rather than standing and swinging.
     */
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 1.2 + Math.random() * 1.6; this.strafe *= -1; }
    if (dist < 26) {
      _side.set(-_to.z, 0, _to.x);
      this.pos.addScaledVector(_side, this.speed * 0.34 * this.strafe * dt);
    }

    // Sidestep an incoming swing — rarely, on a cooldown, and never out of a
    // telegraph or a recovery. Dodging the punish window would take away the
    // one thing the player is owed for reading the fight correctly.
    if (this._maybeDodge(player, dist)) return;

    if (this.timer > 0) return;
    /**
     * Close enough to commit — or out of patience.
     *
     * The tolerance is generous so a boss never paces trying to hit an exact
     * distance. The patience clock is the other half of that: a player who
     * matches the guardian's walking speed can hold it at a range its chosen
     * move does not want forever, and the guardian used to simply keep
     * walking. Now it commits anyway after a couple of seconds — which for a
     * charge or a leap means it comes at you from the wrong distance, still
     * fully telegraphed, and looks like impatience rather than a stalemate.
     */
    this.waiting = (this.waiting || 0) + dt;
    if (Math.abs(diff) > M.range * 0.6 + 2 && this.waiting < 2.4) return;
    this.waiting = 0;

    this.state = STATE.TELEGRAPH;
    /**
     * Never below the floor.
     *
     * `telegraph` is already clamped, but a move with a short `windup` — a
     * blink at 0.70, a combo at 0.75 — multiplied it back down under
     * `minTelegraph`, which is the one number in the fight that is supposed
     * to be inviolable. Every place a wind-up is set now goes through this.
     */
    this.timer = Math.max(this.minTelegraph, this.telegraph * M.windup);
    this.hitsLeft = M.hits;
    this._drawWarning(player);
  }

  /**
   * Hop out of a swing it can see coming.
   *
   * Reactive defence, which is what the fight was missing: standing next to a
   * guardian and holding the attack button should not be a guaranteed damage
   * rotation. It is on a long cooldown and a low roll, so it reads as the
   * guardian occasionally getting the better of you rather than as the game
   * refusing your input.
   */
  _maybeDodge(player, dist) {
    if (this.dodgeCd > 0 || dist > 6.5) return false;
    const swinging = player.combat && player.combat.active;
    if (!swinging) return false;
    if (Math.random() >= this.R.dodge) { this.dodgeCd = 0.6; return false; }

    this.dodgeCd = 3.4;
    this.state = STATE.DODGE;
    this.timer = 0.3;
    this.dodgeT = 0;
    this.dodgeFrom.copy(this.pos);
    _side.set(-_to.z, 0, _to.x);
    const s = Math.random() < 0.5 ? 1 : -1;
    this.dodgeTo.set(
      this.pos.x + _side.x * 6 * s - _to.x * 2.5, this.baseY,
      this.pos.z + _side.z * 6 * s - _to.z * 2.5);
    _tmp.copy(this.pos);
    this.effects.dustPuff(_tmp, 10, 4, 0xcfc0a0);
    Audio.dash(this.pos);
    return true;
  }

  _dodge(dt) {
    this.dodgeT = Math.min(1, this.dodgeT + dt / 0.3);
    this.pos.lerpVectors(this.dodgeFrom, this.dodgeTo, this.dodgeT);
    this.pos.y = this.baseY + Math.sin(this.dodgeT * Math.PI) * 1.1;
    this.moveSpeed = this.speed * 2;
    if (this.dodgeT >= 1) {
      this.pos.y = this.baseY;
      this.state = STATE.APPROACH;
      this.timer = 0.1;
    }
  }

  /**
   * The arena, from phase two.
   *
   * The floor stops being neutral: patches of it become dangerous on a timer,
   * telegraphed the same way everything else is and never underneath the
   * player at the moment they appear. It is what makes the second half of a
   * fight feel like a different place rather than the same one with a faster
   * boss, and it is why standing in one spot throwing does not work even
   * between the guardian's own attacks.
   */
  _arena(dt, player) {
    if (this.phase < 2) return;
    this.arenaT -= dt;
    if (this.arenaT > 0) return;
    this.arenaT = this.R.arena * (this.phase >= 3 ? 0.8 : 1);

    // Somewhere near the player, but offset — never dropped on their head.
    const a = Math.random() * Math.PI * 2;
    const d = 7 + Math.random() * 7;
    const x = player.pos.x + Math.cos(a) * d;
    const z = player.pos.z + Math.sin(a) * d;
    const y = this.groundAt ? this.groundAt(x, z) : this.baseY;
    const r = 4.5 + this.phase * 0.6;
    _tmp.set(x, y + 0.1, z);
    this.effects.ring(_tmp, r * 1.8, r, 0.75, WARN_RED, true);
    this.hazards.push({
      x, z, y, r, life: 4.2, delay: 0.75,
      dmg: Math.round(this.damage * 0.4), tick: 0, color: this.spec.trim,
      jumpable: false,
    });
    Audio.tone({
      freq: 180, to: 90, dur: 0.7, type: 'sine', volume: 0.09,
      pos: _tmp,
    });
  }

  /**
   * Draw the danger. This is the contract with the player: whatever is about
   * to hurt them appears on the floor first, and stays there for the whole
   * wind-up.
   */
  _drawWarning(player) {
    const jumpable = GROUND_MOVES.has(this.move);
    this.windingGroundWave = jumpable;
    const col = this.move === 'blink' ? WARN_BLINK
      : this.move === 'barrier' ? WARN_GUARD
        : (jumpable ? WARN_AMBER : WARN_RED);
    const w = Math.max(0.12, this.timer);
    // The marker is the hitbox. Not an approximation of it.
    const R = this._moveRadius(this.move);
    switch (this.move) {
      case 'charge':
      case 'rush':
        this.chargeDir.copy(_to);
        for (let i = 1; i <= 8; i++) {
          _tmp.set(this.pos.x + _to.x * i * 4.5, this.baseY + 0.1,
            this.pos.z + _to.z * i * 4.5);
          this.effects.ring(_tmp, R, R, w, col, true);
        }
        break;
      case 'leap': {
        // Land where they will be, not where they are — but the marker goes
        // on that spot too, so it is still entirely dodgeable. Running in a
        // straight line stops being an answer; changing direction is.
        const lead = w * 0.55;
        const vx = player.vel ? player.vel.x : 0;
        const vz = player.vel ? player.vel.z : 0;
        this.leapTo.set(
          player.pos.x + vx * lead, this.baseY, player.pos.z + vz * lead);
        _tmp.set(this.leapTo.x, this.baseY + 0.1, this.leapTo.z);
        this.effects.ring(_tmp, R, R, w, col, true);
        break;
      }
      case 'spin':
      case 'shockwave':
        // Grows from the boss out to exactly where it will reach.
        _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
        this.effects.ring(_tmp, 1, R, w, col, true);
        break;
      case 'quake':
      case 'storm':
        // Three or five rings will travel outward from here. The marker is
        // the ground they start on; each ring is then visible for its whole
        // trip, which is what makes dodging THROUGH them possible.
        _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
        this.effects.ring(_tmp, 1, R * 1.4, w, col, true);
        this.effects.ring(_tmp, R * 1.4, 1, w, col, true);
        break;
      case 'ringout':
        _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
        this.effects.ring(_tmp, 1, R * 2.5, w, col, true);
        break;
      case 'spores':
      case 'puddle':
        _tmp.set(player.pos.x, this.baseY + 0.1, player.pos.z);
        this.effects.ring(_tmp, R, R, w, col, true);
        break;
      case 'erupt':
        // A column, not a wave: it comes straight up out of the ground where
        // the marker is, so hopping over it does nothing. Walk out.
        _tmp.set(player.pos.x, this.baseY + 0.1, player.pos.z);
        this.effects.ring(_tmp, R * 1.5, R, w, col, true);
        this.effects.ring(_tmp, R * 0.5, R, w, col, true);
        break;
      case 'blink':
        // It will reappear beside you and swing immediately, so the marker
        // has to cover the reach of that swing — not just say "something is
        // coming". A blink that telegraphs less than it hits is a cheap
        // shot, whatever else it is.
        _tmp.set(player.pos.x, this.baseY + 0.1, player.pos.z);
        this.effects.ring(_tmp, R * 2, R, w, col, true);
        break;
      case 'barrier':
        _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
        this.effects.ring(_tmp, R * 1.5, R * 0.6, w, col, true);
        break;
      case 'throw':
      case 'volley':
      case 'barrage':
        // The alert says a shot is coming; the bolt itself, visible the whole
        // way, is what says where. There is no floor area to match here.
        _tmp.set(player.pos.x, this.baseY + 0.1, player.pos.z);
        this.effects.ring(_tmp, R * 1.6, R * 0.8, w, col, true);
        break;
      default:                                   // slam, combo, sweep
        // Drawn AHEAD of the boss, because the strike lunges forward — the
        // marker has to cover where the blow lands, not where it starts.
        _tmp.set(this.pos.x + _to.x * R * 0.4, this.baseY + 0.1,
          this.pos.z + _to.z * R * 0.4);
        this.effects.ring(_tmp, 1.0, R * 1.6, w, col, true);
        break;
    }
    // A ground wave gets its own two-note rise, so it is identifiable with
    // your back turned.
    Audio.tone({
      freq: jumpable ? 110 : 150, to: jumpable ? 250 : 380,
      dur: w, type: 'sawtooth', volume: 0.12, pos: this.pos,
    });
  }

  _beginStrike(player) {
    this.state = STATE.STRIKE;
    this.struck = false;
    this.swung = false;
    this.blinkHold = 0;
    this.swingT = 0.32;
    this.timer = (this.move === 'charge' || this.move === 'leap'
      || this.move === 'rush') ? 0.5 : 0.24;

    if (this.move === 'blink') {
      // Vanish and reappear beside them — and then WAIT.
      //
      // Arriving and swinging on the same frame is unreactable however well
      // the wind-up was telegraphed, because the wind-up happened somewhere
      // else: by the time you can see where he actually is, the blade is
      // already on you. The pause is what turns the teleport back into an
      // attack you can answer, and the ring below is drawn at the spot he is
      // really standing rather than the one he left.
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, this.spec.trim, 18, 8);
      const a = Math.random() * Math.PI * 2;
      this.pos.set(player.pos.x + Math.cos(a) * 5, this.baseY,
        player.pos.z + Math.sin(a) * 5);
      _tmp.copy(this.pos);
      this.effects.puff(_tmp, this.spec.trim, 18, 8);

      this.blinkHold = CFG.dungeon.boss.blinkDelay;
      this.timer += this.blinkHold;          // the strike still gets its time
      const BR = this._moveRadius('blink');
      _tmp.set(this.pos.x, this.baseY + 0.1, this.pos.z);
      this.effects.ring(_tmp, BR * 2, BR * 1.2, this.blinkHold, WARN_BLINK, true);
      Audio.dash(this.pos);
      Audio.tone({
        freq: 300, to: 820, dur: this.blinkHold, type: 'sine',
        volume: 0.14, pos: this.pos,
      });
    }
    if (this.move === 'leap') {
      this.leapT = 0;
      this.leapFrom.copy(this.pos);
    }
    Audio.slash(this.pos, 2);
  }

  _strike(dt, dist, player, onHit) {
    const M = MOVES[this.move] || MOVES.combo;
    const dmg = Math.round(this.damage * M.dmg);
    // The same radius the marker was drawn at.
    const R = this._moveRadius(this.move);

    // He has landed, but the blade has not moved yet. Nothing can hurt you
    // for this beat — it is the window to dash out or set a parry, and it is
    // the same length every time so it can be learned.
    if (this.blinkHold > 0) {
      this.blinkHold -= dt;
      this.moveSpeed = 0;
      return;
    }

    switch (this.move) {
      case 'charge':
      case 'rush':
        this.pos.addScaledVector(this.chargeDir, this.speed * 3.6 * dt);
        this.moveSpeed = this.speed * 3;
        if (!this.struck && this._near(player, R)) {
          this.struck = true;
          onHit(dmg, this.pos);
        }
        break;

      case 'leap': {
        // An arc that lands on the marked spot.
        this.leapT = Math.min(1, this.leapT + dt / 0.5);
        const k = this.leapT;
        this.pos.lerpVectors(this.leapFrom, this.leapTo, k);
        this.pos.y = this.baseY + Math.sin(k * Math.PI) * 7;
        this.moveSpeed = this.speed * 2;
        if (k >= 1 && !this.struck) {
          this.struck = true;
          _tmp.set(this.pos.x, this.baseY + 0.3, this.pos.z);
          this.effects.ring(_tmp, 0.5, R * 2.4, 0.35, this.spec.trim, true);
          this.effects.dustPuff(_tmp, 16, 6, 0xcfc0a0);
          if (this._near(player, R * 1.2)) onHit(dmg, this.pos);
        }
        break;
      }

      case 'throw':
      case 'barrage':
        if (!this.struck) { this.struck = true; this._hurl(player, dmg, 24, 0); }
        break;

      case 'volley':
        if (!this.struck) {
          this.struck = true;
          // Three bolts, fanned — standing still is not an answer.
          for (let i = -1; i <= 1; i++) this._hurl(player, dmg, 30, i * 0.22);
        }
        break;

      case 'ringout':
        if (!this.struck) {
          this.struck = true;
          // An outward ring: move through a gap, or wear it. It descends to
          // body height as it spreads, so a hovering caster's ring still
          // threatens the floor rather than passing overhead.
          const drop = (player.pos.y + 1.0 - (this.pos.y + 1.2)) / 14;
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            this._hurlDir(Math.sin(a), drop, Math.cos(a), dmg, 22);
          }
        }
        break;

      // --- ground waves: wide, but you can JUMP them ---
      case 'spin':
      case 'shockwave':
        if (!this.struck) {
          this.struck = true;
          _tmp.set(this.pos.x, this.baseY + 0.35, this.pos.z);
          this.effects.ring(_tmp, 0.5, R, 0.5, WARN_AMBER, true);
          if (this.move === 'shockwave') {
            this.effects.dustPuff(_tmp, 20, 7, 0xcfc0a0);
          }
          this._eatProjectiles(R);
          // It travels along the floor, so being off the floor clears it.
          // Without this the wide late-game waves were simply a tax: they
          // out-reach the room and no amount of running gets you out.
          if (this._near(player, R) && this._grounded(player)) {
            onHit(dmg, this.pos);
          }
        }
        break;

      /**
       * Rolling rings.
       *
       * Three (a quake) or five (a storm) bands travelling outward at a
       * readable speed. Each one is drawn for its whole trip, so you can dodge
       * BETWEEN them, jump one, or simply be outside their reach — which is
       * a different problem from a single instantaneous circle and the reason
       * these belong to the later phases.
       */
      case 'quake':
      case 'storm':
        if (!this.struck) {
          this.struck = true;
          const n = this.move === 'storm' ? 5 : 3;
          for (let i = 0; i < n; i++) {
            this.waves.push({
              x: this.pos.x, z: this.pos.z, y: this.baseY,
              r: 1.5 - i * 4.5, speed: 15 + i, max: R * 1.6, band: 2.8,
              dmg: Math.round(dmg * 0.7), jumpable: true,
              color: this.spec.trim, hit: false, tick: 0,
            });
          }
          _tmp.set(this.pos.x, this.baseY + 0.35, this.pos.z);
          this.effects.dustPuff(_tmp, 24, 8, 0xcfc0a0);
          this._eatProjectiles(R);
          if (this.move === 'storm') {
            // And the floor, so retreating to the edge is not free either.
            for (let i = 0; i < 3; i++) {
              const a = Math.random() * Math.PI * 2;
              const d = R * (0.5 + Math.random() * 0.6);
              const hx = this.pos.x + Math.cos(a) * d;
              const hz = this.pos.z + Math.sin(a) * d;
              _tmp.set(hx, this.baseY + 0.1, hz);
              this.effects.ring(_tmp, 8, 5, 0.9, WARN_RED, true);
              this.hazards.push({
                x: hx, z: hz, y: this.groundAt ? this.groundAt(hx, hz) : this.baseY,
                r: 5, life: 5, delay: 0.9,
                dmg: Math.round(dmg * 0.35), tick: 0, color: this.spec.trim,
                jumpable: false,
              });
            }
          }
        }
        break;

      /**
       * A column out of the ground.
       *
       * The one attack that cannot be jumped, which is what makes it worth
       * having: it forces a player who has learned to hop everything to move
       * their feet instead. It is also the slowest telegraph in the book.
       */
      case 'erupt':
        if (!this.struck) {
          this.struck = true;
          _tmp.set(player.pos.x, this.baseY + 0.2, player.pos.z);
          this.effects.ring(_tmp, 0.5, R, 0.5, WARN_RED, true);
          this.effects.dustPuff(_tmp, 22, 11, 0xcfc0a0);
          this.effects.puff(_tmp, this.spec.trim, 16, 12);
          if (this._near(player, R)) onHit(dmg, this.pos);
        }
        break;

      case 'barrier':
        if (!this.struck) {
          this.struck = true;
          this.barrierT = 7;
          this.barrierHp = this.barrierMax;
          _tmp.set(this.pos.x, this.baseY + 0.2, this.pos.z);
          this.effects.ring(_tmp, 1, R * 1.4, 0.6, WARN_GUARD, true);
          this.effects.puff(_tmp, WARN_GUARD, 20, 7);
          this._eatProjectiles(R * 1.4);
          Audio.tone({
            freq: 200, to: 640, dur: 0.6, type: 'sine',
            volume: 0.16, pos: this.pos,
          });
        }
        break;

      case 'spores':
      case 'puddle':
        if (!this.struck) {
          this.struck = true;
          // A patch of floor that stays dangerous, and stays drawn.
          this.hazards.push({
            x: player.pos.x, z: player.pos.z, y: this.baseY,
            r: R, life: this.move === 'puddle' ? 6 : 3.5, delay: 0,
            dmg: Math.round(dmg * 0.5), tick: 0, color: this.spec.trim,
            jumpable: this.move === 'puddle',
          });
        }
        break;

      default: {
        // Lunge into the swing. A melee guardian moves slower than a
        // sprinting frog, so without this last-moment surge it could be
        // kited around the room forever and never land anything — which is
        // not a hard fight, it is a non-fight.
        this.pos.addScaledVector(_to, this.speed * 2.4 * dt);
        this.moveSpeed = this.speed * 2;
        if (!this.struck && this._near(player, R * 1.2)) {
          this.struck = true;
          onHit(dmg, this.pos);
        }
        if (!this.swung) {
          this.swung = true;
          _tmp.set(this.pos.x - Math.sin(this.yaw) * R * 0.6,
            this.pos.y + 1.4, this.pos.z - Math.cos(this.yaw) * R * 0.6);
          this.effects.slashArc(_tmp, this.yaw, 2, this.spec.trim, R);
        }
        break;
      }
    }

    if (this.timer > 0) return;
    this.hitsLeft--;
    if (this.hitsLeft > 0 && CHAINED.has(this.move)) {
      /**
       * Chain the move, with a shorter tell each time.
       *
       * Shorter, but never shorter than `minTelegraph`. That floor is what
       * keeps a three-stroke combo answerable: every stroke in it can be
       * dodged on its own, so being caught by the first one is not being
       * caught by all three.
       */
      this.state = STATE.TELEGRAPH;
      this.timer = Math.max(this.minTelegraph, this.telegraph * 0.5);
      this._drawWarning(player);
      return;
    }

    /**
       * ...or into something else entirely.
       *
       * The unpredictable part. A finished move can flow straight into a
       * DIFFERENT one — drawn from three candidates so the pair is not a
       * fixed script — but only twice per exchange, and the follow-up is
       * telegraphed like everything else. After the chain there is always a
       * full recovery, so no sequence here can hold a player still until they
       * are dead.
       */
    if (this.chainLeft > 0 && Math.random() < this.R.chain) {
      this.chainLeft--;
      const after = this.move;
      this.move = this._pickFollowUp(after);
      this.state = STATE.TELEGRAPH;
      this.timer = Math.max(this.minTelegraph,
        this.telegraph * (MOVES[this.move] || MOVES.combo).windup * 0.7);
      this.hitsLeft = (MOVES[this.move] || MOVES.combo).hits;
      this.pos.y = this.baseY;
      this._drawWarning(player);
      return;
    }

    this.state = STATE.RECOVER;
    this.timer = Math.max(0.4, M.recover);
    this.move = null;
    this.pos.y = this.baseY;
  }

  _near(player, r) {
    return Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < r;
  }

  /**
   * Is the player on the floor?
   *
   * Both a real jump and the moment mid-dash count as airborne, so a
   * well-timed dash over a wave works too — dodging the ground with the
   * dodge button is exactly what a player will try first.
   */
  _grounded(player) {
    if (player.grounded === false) return false;
    if (player.pos.y > this.baseY + 1.1) return false;
    return true;
  }

  /**
   * Sweep thrown blades out of the air.
   *
   * A wide ground attack eats kunai in flight. Not as a tax — as the reason
   * a player learns to throw on the recovery instead of on a schedule. It
   * only ever clears what is already airborne; nothing about the throw is
   * blocked, and no blade already stuck in the guardian is refunded.
   */
  _eatProjectiles(r) {
    if (!this.kunai || !this.kunai.clearNear) return;
    const n = this.kunai.clearNear(this.pos.x, this.pos.z, r);
    if (n > 0) Audio.parry(this.pos);
  }

  /**
   * Throw at where the player is GOING, not where they are.
   *
   * Firing at the current position means anyone who keeps moving is
   * untouchable — a bolt with a half-second flight time arrives at empty
   * floor every time. Leading the shot makes running in a straight line the
   * wrong answer, which is the whole point of a ranged attack.
   */
  _hurl(player, dmg, speed, spread) {
    // Aim at the CHEST, in three dimensions. The hovering guardians throw
    // from well above head height, so a dead-level shot sailed over the
    // player every single time — they were firing at nothing.
    const aimY = player.pos.y + 1.0;
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const flight = Math.hypot(dx, dz) / speed;
    const vx = player.vel ? player.vel.x : 0;
    const vz = player.vel ? player.vel.z : 0;
    const a = Math.atan2(dx + vx * flight, dz + vz * flight) + (spread || 0);
    const flat = Math.hypot(dx + vx * flight, dz + vz * flight);
    const dy = (aimY - (this.pos.y + 1.2)) / Math.max(flat, 0.001);
    this._hurlDir(Math.sin(a), dy, Math.cos(a), dmg, speed);
  }

  _hurlDir(dx, dy, dz, dmg, speed) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 0),
      new THREE.MeshBasicMaterial({ color: this.spec.trim })
    );
    mesh.position.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, dx: dx / len, dy: dy / len, dz: dz / len, speed, life: 3.4, dmg,
    });
    Audio.kunaiThrow(this.pos);
  }

  _updateProjectiles(dt, player, onHit) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.x += p.dx * p.speed * dt;
      p.mesh.position.y += p.dy * p.speed * dt;
      p.mesh.position.z += p.dz * p.speed * dt;
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.y += dt * 7;
      // Against the player's body centre, not their feet.
      _tmp.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
      const hit = p.mesh.position.distanceTo(_tmp) < 1.9;
      if (hit || p.life <= 0) {
        if (hit && onHit) onHit(p.dmg, p.mesh.position);
        this.effects.puff(p.mesh.position, this.spec.trim, 8, 4);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  _clearProjectiles() {
    for (const p of this.projectiles) {
      this.effects.puff(p.mesh.position, this.spec.trim, 6, 4);
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
  }

  /** Lingering floor hazards — spore clouds, puddles and the arena's own. */
  _updateHazards(dt, player, onHit) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      // A delayed hazard is drawn before it bites. Its ring went up when it
      // was queued, so this is the beat the player has to leave in.
      if (h.delay > 0) { h.delay -= dt; continue; }
      h.life -= dt;
      h.tick -= dt;
      // The ring is redrawn for as long as the hazard exists, so a patch of
      // floor is never quietly dangerous.
      if (h.tick <= 0) {
        h.tick = 0.45;
        _tmp.set(h.x, h.y + 0.1, h.z);
        this.effects.ring(_tmp, h.r, h.r, 0.45, h.color, true);
        // A puddle is on the floor and can be hopped; a spore cloud fills
        // the air above it and cannot.
        const clears = h.jumpable && !this._grounded(player);
        if (!clears && Math.hypot(player.pos.x - h.x, player.pos.z - h.z) < h.r) {
          onHit(h.dmg, _tmp);
        }
      }
      if (h.life <= 0) this.hazards.splice(i, 1);
    }
  }

  /**
   * Rolling rings.
   *
   * A band of ground travelling outward. It hits ONCE — `hit` — so a slow
   * wave cannot grind a player down while they stand in it, and being off the
   * floor clears it like every other ground attack. The ring is redrawn every
   * fifth of a second, which is what makes its speed readable and therefore
   * makes dodging between two of them a real option.
   */
  _updateWaves(dt, player, onHit) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.speed * dt;
      if (w.r <= 0) continue;
      w.tick -= dt;
      if (w.tick <= 0) {
        w.tick = 0.2;
        _tmp.set(w.x, w.y + 0.15, w.z);
        this.effects.ring(_tmp, w.r, w.r + w.band * 0.5, 0.24, w.color, true);
      }
      if (!w.hit) {
        const d = Math.hypot(player.pos.x - w.x, player.pos.z - w.z);
        if (Math.abs(d - w.r) < w.band) {
          const clears = w.jumpable && !this._grounded(player);
          if (!clears) {
            w.hit = true;
            _tmp.set(w.x, w.y, w.z);
            if (onHit) onHit(w.dmg, _tmp);
          }
        }
      }
      if (w.r > w.max) this.waves.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ animation

  _animate(dt) {
    const rig = this.rig;
    rig.root.position.copy(this.pos);
    this.setFacing(this.yaw);
    this._animateBarrier(dt);

    if (!this.alive) {
      rig.root.rotation.z = damp(rig.root.rotation.z, Math.PI * 0.45, 6, dt);
      rig.body.position.y = damp(rig.body.position.y, -0.3, 6, dt);
      return;
    }

    const moving = this.moveSpeed > 0.6;
    if (moving) this.stride += dt * (3.4 + Math.min(this.moveSpeed, 16) * 0.5);
    const sw = Math.sin(this.stride);

    // A phase change is a transformation: it rears up and holds there. The
    // stagger is the opposite — it folds forward and cannot answer.
    if (this.state === STATE.PHASE) {
      rig.body.rotation.x = damp(rig.body.rotation.x, -0.5, 5, dt);
      rig.body.position.y = damp(rig.body.position.y, 0.4, 5, dt);
      rig.head.rotation.x = damp(rig.head.rotation.x, -0.6, 5, dt);
      for (const arm of rig.arms) {
        arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, -2.2, 6, dt);
        arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, arm.side * 0.7, 6, dt);
      }
      return;
    }
    if (this.state === STATE.STAGGER) {
      rig.body.rotation.x = damp(rig.body.rotation.x, 0.7, 8, dt);
      rig.body.position.y = damp(rig.body.position.y, -0.25, 8, dt);
      rig.head.rotation.x = damp(rig.head.rotation.x, 0.5, 8, dt);
      for (const arm of rig.arms) {
        arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, 0.6, 8, dt);
        arm.fore.rotation.x = damp(arm.fore.rotation.x, -0.1, 8, dt);
      }
      rig.body.position.x = Math.sin(this.t * 40) * 0.05;
      return;
    }

    // The hovering ones drift; the walking ones tramp.
    if (this.hovers) {
      rig.body.position.y = Math.sin(this.t * 1.4) * 0.22;
      rig.body.rotation.x = damp(rig.body.rotation.x, moving ? 0.16 : 0.04, 4, dt);
    } else {
      rig.body.position.y = Math.abs(sw) * (moving ? 0.10 : 0)
        + Math.sin(this.t * 1.3) * 0.02;
      rig.body.rotation.x = damp(rig.body.rotation.x, moving ? 0.18 : 0.08, 6, dt);
      for (const leg of rig.legs) {
        const phase = leg.side > 0 ? sw : -sw;
        leg.hip.rotation.x = damp(leg.hip.rotation.x, moving ? phase * 0.6 : -0.15, 14, dt);
        leg.shin.rotation.x = damp(leg.shin.rotation.x,
          moving ? clamp(-phase, 0, 1) * 0.85 + 0.1 : 0.4, 14, dt);
      }
    }
    rig.head.rotation.x = damp(rig.head.rotation.x, moving ? -0.14 : -0.04, 6, dt);

    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = 1 - this.swingT / 0.32;
      rig.arms[1].shoulder.rotation.x = lerp(-2.5, 1.0, k);
      rig.arms[1].fore.rotation.x = lerp(-1.1, -0.1, k);
      rig.arms[0].shoulder.rotation.x = damp(rig.arms[0].shoulder.rotation.x, -0.4, 12, dt);
    } else {
      for (const arm of rig.arms) {
        const phase = arm.side > 0 ? -sw : sw;
        arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x,
          moving ? phase * 0.45 : 0.08, 10, dt);
        arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, arm.side * 0.2, 8, dt);
        arm.fore.rotation.x = damp(arm.fore.rotation.x, -0.45, 10, dt);
      }
    }

    if (this.hurtT > 0) {
      this.hurtT -= dt;
      rig.body.position.x = Math.sin(this.hurtT * 90) * 0.07;
    } else {
      rig.body.position.x = damp(rig.body.position.x, 0, 12, dt);
    }
  }

  /**
   * The shell.
   *
   * Built the first time one goes up and kept afterwards, because a boss can
   * raise several over one fight and a new sphere per raise is a new material
   * per raise. Local to the rig root so it follows without a second update.
   */
  _animateBarrier(dt) {
    const up = this.barrierT > 0;
    if (!up && !this.barrierMesh) return;
    if (!this.barrierMesh) {
      this.barrierMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(2.6, 1),
        new THREE.MeshBasicMaterial({
          color: WARN_GUARD, transparent: true, opacity: 0.2,
          side: THREE.DoubleSide, depthWrite: false,
        })
      );
      this.barrierMesh.position.y = 1.6;
      this.rig.root.add(this.barrierMesh);
    }
    this.barrierMesh.visible = up;
    if (!up) return;
    this.barrierMesh.rotation.y += dt * 0.8;
    this.barrierMesh.rotation.x += dt * 0.35;
    // Thins out as its plates come off, so how much is left is visible.
    const left = this.barrierMax > 0 ? this.barrierHp / this.barrierMax : 0;
    this.barrierMesh.material.opacity = 0.08 + 0.16 * clamp(left, 0, 1);
  }

  dispose() {
    this.scene.remove(this.rig.root);
    /**
     * Materials only — never the geometry.
     *
     * `buildGuardian` draws every part from module-level geometry singletons
     * that EVERY guardian shares, so disposing them here frees buffers other
     * creatures are still drawing from and Three re-uploads them on the next
     * frame. Harmless in the dungeon, where one boss is torn down before the
     * next is built; in the overworld a camp despawning behind the player
     * would knock the geometry out from under every mob still on screen.
     * The materials are made per rig, so those are ours to free.
     */
    this.rig.root.traverse((o) => {
      if (o.material) o.material.dispose();
    });
    // The shell's sphere is ours alone, so that one geometry does go.
    if (this.barrierMesh) {
      this.barrierMesh.geometry.dispose();
      this.barrierMesh = null;
    }
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
    this.hazards.length = 0;
    this.waves.length = 0;
  }
}

export const GUARDIAN_NAMES = GUARDIANS.map((g) => g.name);
export { MOVES as BOSS_MOVES, RANKS as BOSS_RANKS, STATE as BOSS_STATE };
