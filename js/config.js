/**
 * FROGSHIN — central tuning constants.
 * Every "feel" number lives here so movement can be tuned in one place.
 */

/**
 * Build identifier, bumped on every deploy.
 *
 * Players exchange this when they connect. Two people on different builds
 * can look connected while silently disagreeing about the rules — one seeing
 * the other but not vice versa, for instance — so a mismatch is surfaced
 * loudly instead of being left to look like a game bug.
 */
export const BUILD = 'v52';

export const CFG = {
  // ---------------------------------------------------------------- world
  world: {
    seed: 1337,              // fixed seed => every client generates an identical map
    size: 420,               // world spans -size/2 .. +size/2 on X and Z
    grid: 145,               // heightfield resolution (grid x grid samples)
    waterLevel: 2.2,
    killPlane: -30,          // fall below this and you respawn
    /**
     * Where the snow starts.
     *
     * Used for BOTH the terrain colouring and the climb limit, so the rule
     * and the thing you can see are the same number: green and rock are
     * scrambled up however you like, and only the white peaks turn you back.
     */
    snowLine: 74,
  },

  // ------------------------------------------------------------- movement
  move: {
    runSpeed: 15.5,          // top ground speed (units/s)
    airSpeed: 14.0,          // top speed you can steer toward while airborne
    // Must exceed runSpeed * groundFriction (15.5 * 11 = 170.5), otherwise
    // friction wins the tug-of-war and the real top speed settles well below
    // runSpeed — which would also make the sprint multiplier inexact.
    groundAccel: 220,        // how hard we chase the target velocity on ground
    airAccel: 42,            // weaker in the air, but enough to feel responsive
    groundFriction: 11.0,
    airFriction: 0.35,
    gravity: -42.0,
    fallGravityMult: 1.45,   // heavier on the way down => snappy, non-floaty arc
    maxFallSpeed: -62,

    jumpSpeed: 17.5,
    doubleJumpSpeed: 15.5,   // the "frog flip" second jump
    jumpCutMult: 0.42,       // release Space early => shorter hop
    coyoteTime: 0.13,        // grace period to jump after leaving a ledge
    jumpBuffer: 0.14,        // pressing Space just before landing still jumps

    wallSlideSpeed: -5.0,    // clamped fall speed while hugging a wall
    wallJumpUp: 16.5,
    wallJumpOut: 13.0,
    wallCoyote: 0.16,

    // Shove applied when you run into an unclimbable cliff face.
    mountainBounce: 11,
    radius: 0.55,            // collision capsule radius
    height: 1.75,            // collision capsule height
    stepHeight: 0.65,        // auto-step over small ledges
    /**
     * Steepest TERRAIN you can walk up, on Terrain.slopeAt's 0..1 scale
     * (0 flat, 1 vertical; the scale is |gradient| / 3, so this is a little
     * over 50°). Anything steeper is a cliff face and has to be grappled or
     * gone around — without this the mountains were walkable if you simply
     * approached them slowly. Boxes are unaffected: ledges still use
     * stepHeight, so stairs and crates behave exactly as before.
     *
     * IT ONLY APPLIES ABOVE world.snowLine. The lower slopes are scrambled up
     * exactly as they always were; it is the white peaks that are off limits,
     * so the boundary is something you can see rather than something you
     * discover by walking into it.
     */
    maxClimbSlope: 0.46,
    /**
     * How far below a level's floor counts as having left the world, and how
     * fast the void takes you. Damage rather than an instant kill so it reads
     * as a fall you did not survive, and so a death-cam/respawn plays
     * normally instead of teleporting you.
     */
    voidDepth: 40,
    voidDamage: 90,          // per second
    /**
     * How far the soles are allowed to settle INTO the ground.
     *
     * The rig is lifted so its feet stop at the floor rather than hanging
     * a third of a unit through it (see FrogModel._groundRig), but stopping
     * at exactly zero reads as hovering: a foot that only ever touches the
     * ground at a single point, with a shadow under it, looks like it is
     * floating. A few centimetres of give makes contact read as contact.
     *
     * Raise it if the frog looks like it is standing on the grass rather
     * than in it; lower it toward 0 if the toes start disappearing.
     */
    footSink: 0.05,
  },

  // -------------------------------------------------------------- stamina
  stamina: {
    // All costs halved from the first pass so stamina lasts twice as long.
    max: 100,
    jumpCost: 8,             // ground jump
    doubleJumpCost: 10,      // the frog flip costs more than a normal hop
    wallJumpCost: 6.5,
    breachCost: 9,           // leaping clear of the water
    sprintDrain: 10.5,       // per second on land
    swimSprintDrain: 7.5,    // per second underwater — cheaper, you go slower
    regen: 27,               // per second once recovery starts
    regenDelay: 0.65,        // quiet period after spending before regen kicks in
    exhaustedRegenMult: 1.3, // recover quicker while locked out
    // Run dry and you are locked out of sprint AND jump until stamina climbs
    // back to this fraction.
    recoverTo: 0.70,
  },

  // ---------------------------------------------------------------- story
  story: {
    triggerRange: 17,        // how close to Toadel before the cutscene fires
    shakeTime: 0.5,          // screen shake when the fight begins
    brokenSwordMult: 1 / 3,  // your blade is broken: a third of normal damage
    parry: {
      knockdownAfter: 2,     // hits absorbed in one parry before you go down
      knockdownTime: 0.7,    // seconds on the floor, unable to act
      chipStagger: 0.18,     // brief hitstop when a blow is turned aside
      // A raised guard used to cost nothing: you could hold it forever and
      // simply never be hit. It is now a timed commitment.
      cooldown: 1.5,         // seconds between one guard and the next
      maxHold: 1.2,          // a guard drops on its own after this long
      breakLock: 0.6,        // helpless after a guard is broken
    },
    /**
     * Market fruit in the village. Cheap on purpose: it is the only healing
     * in the chase, and froglets should never be the thing standing between
     * a player and finishing the story.
     */
    fruit: {
      price: 25,
      heal: 35,
      reach: 4.2,            // how close to a stall counts as standing at it
    },
    boss: {
      name: 'TOADEL, THE TOAD LEADER',
      health: 3000,          // deliberately brutal — you are meant to lose
      damageFraction: 0.8,   // each landed blow takes 80% of your health
      reach: 5.2,
      arc: 1.15,
      moveSpeed: 11.5,
      chaseAccel: 34,
      attackCooldown: [0.95, 0.8, 1.35],
      windup: [0.30, 0.24, 0.42],   // fast — you must read them quickly
      comboWindow: 1.5,
      lungeSpeed: 26,
      turnRate: 5.0,
      syncRate: 12,          // boss state broadcasts per second
    },
  },

  // -------------------------------------------------------------- economy
  economy: {
    storageKey: 'frogshin.economy',
    tagReward: 100,          // per player tagged or infected
    roundWinReward: 100,     // your side won the round
    taggerWinReward: 300,    // won while it was you doing the chasing
    infectorStartWinReward: 200,  // started as an infector and the infection won
    onlineInterval: 900,     // 15 minutes...
    onlineReward: 250,       // ...pays this much
  },

  // ------------------------------------------------------------ abilities
  abilities: {
    maxEquipped: 2,          // only two may be carried into a match
    invisibility: {
      duration: 5,
      cooldown: 30,
      // 70% transparent to you and your own side; fully gone to the enemy.
      friendlyOpacity: 0.30,
    },
    shadowclone: {
      duration: 10,
      cooldown: 60,
      delay: 0.45,           // how far behind you the clone copies your moves
      buffer: 4.0,           // seconds of movement history kept
      minGap: 1.7,           // it never stands on top of you, even at a halt
    },
  },

  // -------------------------------------------------------------- dungeon
  /**
   * Fifteen boss rooms, each harder than the last.
   *
   * The curve is set from the player's actual damage output rather than
   * picked by feel: a full katana combo is 58 over ~1.2s, so roughly 50 damage
   * per second sustained. Room 1 is about five seconds of that; room 14 is
   * about forty. Anything more is a health sponge, not a difficulty curve.
   */
  dungeon: {
    rooms: 15,
    roomRadius: 34,
    roomSpacing: 108,
    // Far from every other space in the game, like the castle.
    origin: { x: -2400, y: 400, z: 0 },

    boss: {
      // Room 1 is the juggernaut at a third of its strength.
      baseHealth: 250,
      healthGrowth: 1.175,     // compounding per room -> ~2000 by room 14
      baseDamage: 17,
      damageGrowth: 1.09,      // -> ~52 by room 14, half a health bar
      baseSpeed: 7.0,
      speedGrowth: 1.045,
      reach: 4.6,
      // How long the wind-up is telegraphed. Shrinks as you descend, but
      // never below `minTelegraph` — the fight must stay readable.
      telegraph: 0.62,
      telegraphShrink: 0.955,
      minTelegraph: 0.26,
      /**
       * The beat between a teleport landing and the blade moving.
       *
       * A blink telegraphs on the spot the guardian LEAVES, so without a
       * pause on arrival the swing is unreactable no matter how long the
       * wind-up was. Fixed, never scaled by depth — it is the window that
       * makes the move answerable at all.
       */
      blinkDelay: 0.8,
    },

    /** The god at the bottom. */
    frogath: {
      name: 'FROGATH',
      title: 'THE FIRST CROAK',
      health: 5200,
      scale: 3.4,
      hoverHeight: 7.5,        // how far above the floor he floats
      // Phase thresholds as fractions of max health.
      phases: [1.0, 0.70, 0.40, 0.15],
      contactDamage: 34,
      swordDamage: 46,
      beamDamage: 58,
      starDamage: 30,
      // Every attack shows its warning for at least this long. Difficulty
      // comes from the patterns, never from unreadable hitboxes.
      minWarning: 0.45,
      arenaRadius: 42,
    },
  },

  /**
   * FROGATH, THE ASCENDED — the fight behind the fight.
   *
   * Reached only by beating the First Croak on a NO-CHECKPOINT run, taking
   * the light crystal he drops to the statue in the arena, and giving it up.
   *
   * The design rule from the dungeon still holds and matters more here than
   * anywhere: every attack draws its danger before it can land. He is meant
   * to be beaten by mastery, so a perfect player must be able to take zero
   * damage — the difficulty is in how much there is to read, how fast, and
   * how little space is left between one pattern and the next.
   */
  ascended: {
    name: 'FROGATH, THE ASCENDED',
    title: 'THE DIVINE JUDGMENT',
    // Phase 2. He stops holding back, and the bar says so.
    name2: 'FROGATH — THE ASCENDED GOD',
    title2: 'PHASE II — THE DIVINE ASCENSION',
    finalTitle: 'PHASE II — ONE FINAL LESSON',
    health: 9000,
    scale: 4.6,
    hoverHeight: 9,
    arenaRadius: 52,

    /**
     * ONE hard split, at half health: the ascension. Everything about him
     * changes there — moveset, silhouette, arena, music.
     *
     * `esc` is a separate, much gentler ladder that only tightens timing.
     * It exists so the back half of each phase still ramps, WITHOUT giving
     * him new tools he has not shown you yet.
     */
    ascendAt: 0.50,
    finalAt: 0.10,
    esc: [1.00, 0.75, 0.50, 0.30, 0.10],
    rest: [1.25, 1.00, 0.62, 0.44, 0.26],
    tele: [1.00, 0.90, 0.74, 0.64, 0.52],
    // Warnings shrink with escalation but never below this floor.
    minWarning: 0.34,

    swordDamage: 52,
    beamDamage: 64,
    starDamage: 34,
    shockDamage: 40,
    orbDamage: 30,
    diveDamage: 58,
    // Phase 2 only.
    featherDamage: 24,
    meteorDamage: 46,
    markDamage: 95,

    /**
     * The brand. A golden symbol lands on you and arms after `time`; if you
     * have not covered `escape` metres of ground by then it detonates.
     * It is not a damage source so much as a rule: you may not stand still.
     */
    mark: { time: 4.2, escape: 20, radius: 19, every: 15 },
  },

  /**
   * FROGATH THE DIVINE — the reward skin's kill transformation.
   *
   * Purely cosmetic. `freeze` is the beat where the player is held still at
   * the moment of the kill; it is deliberately short enough that it can never
   * cost them a fight.
   */
  divine: {
    duration: 1.6,          // whole ascension, seconds
    freeze: 0.18,           // the held instant at the start of it
    shockwave: 22,          // radius of the golden ring it throws out
  },

  // --------------------------------------------------------------- rounds
  rounds: {
    voteTime: 22,            // seconds to pick a mode
    startCountdown: 5,       // "get ready" before a round begins
    endTime: 9,              // results screen before voting again
    duration: { tag: 180, infection: 180, ffa: 300, juggernaut: 240 },
    defaultMode: 'ffa',      // used if nobody votes
    tagImmunity: 2.5,        // stops instant tag-backs
    taggerCooldown: 0.2,     // taggers throw faster (they have infinite kunai)
    syncInterval: 1.0,       // authority state rebroadcast
  },

  // ----------------------------------------------------------- juggernaut
  juggernaut: {
    // One huge toad against everyone else. Pointless one-on-one, so the mode
    // is hidden until a third player joins.
    minPlayers: 3,
    /**
     * Health multiplier by lobby size, exactly as specified. The numbers do
     * not rise monotonically (five players give LESS than four) — that is
     * what was asked for, and it is a single table to change if it was meant
     * to read differently.
     */
    healthByPlayers: { 3: 7, 4: 10, 5: 9 },
    /** Each player beyond the table adds this much. */
    healthPerExtraPlayer: 1,
    /**
     * The juggernaut moves and sprints exactly like everyone else, and
     * grapples like everyone else.
     *
     * It used to be half speed with a halved sprint and no tongue, which made
     * the mode a chase nobody could lose: the frogs simply walked away and
     * shot it. The fight is now a straight 1-vs-N — same mobility, same
     * tools — and the asymmetry is entirely in what it can take and what it
     * hits for. These two are kept as knobs so it can be slowed again from
     * config alone if that turns out too strong.
     */
    moveScale: 1.0,
    sprintBonusScale: 1.0,
    swordScale: 2.1,         // a massive katana, matched to the toad's bulk
    // Absolute reach, not a multiplier — compare with combat.reach (3.5).
    // Toadel's own boss reach is 5.2, and this sits just under it.
    reach: 5.0,
    swordDamage: 50,         // flat, whichever swing of the combo lands

    /**
     * The juggernaut cannot grapple — it charges a leap instead. G aims,
     * winds up, and hurls the whole toad at the spot you were looking at.
     *
     * The wind-up scales with distance: a short hop is nearly instant, a
     * map-crossing leap takes the full 1.5s and is impossible to miss coming.
     * That telegraph is what stops the mode's one mobility tool from simply
     * undoing its slowness.
     */
    leap: {
      minCharge: 0.5,
      maxCharge: 1.5,
      range: 48,             // furthest it can throw itself
      flightMin: 0.55,       // airtime for the shortest leap
      flightMax: 1.25,       // ... and for a full-range one
      cooldown: 2.0,
      maxPitch: 0.85,        // cap on how steeply it can aim (radians)
    },
  },

  // ---------------------------------------------------------------- items
  kunai: {
    damage: 25,
    headshotDamage: 50,      // clean hit to the head
    startCount: 10,
    boxCount: 5,             // kunai inside each pickup crate
    speed: 186,              // 3x the original throw speed
    gravity: 0,              // zero: the kunai flies dead straight, no drop
    // Range is now the limit rather than the drop. `lifetime` is derived
    // from range / speed so the two can never disagree.
    range: 134,              // 5x the old level-throw distance of ~27u
    radius: 0.12,            // the blade's own thickness, added to hitboxes
    cooldown: 0.32,
    stickTime: 2.5,          // how long a thrown kunai stays in a surface
    knockback: 5.0,
    knockbackUp: 2.5,
    maxInFlight: 32,

    // --- aim assist ---
    // Started at half the grapple's effective 0.27 rad cone (0.135), then
    // widened by 1.5x on request: 0.2025 rad (~11.6 degrees).
    assistAngle: 0.2025,
    assistRange: 120,
    // Rather than snapping the throw at the target, the blade STEERS toward
    // it at a limited turn rate, so it visibly curves in instead of flying
    // past and registering a hit anyway.
    homingTurnRate: 2.2,     // radians per second
    homingGiveUpAngle: 1.2,  // stop steering rather than turn back on itself
    homingStopDist: 1.4,     // close enough; let it fly straight in
  },

  // Hitbox geometry, as offsets above a target's feet. Used by kunai to tell
  // a headshot from a body hit. Tuned against the actual rig: the frog's
  // head mesh sits at 0.66..1.38 with the eyes reaching ~1.5, and its torso
  // at 0.16..1.08 — the two genuinely overlap on such a squat character, so
  // the head sphere is kept tight and the neck reads as a headshot.
  hitbox: {
    player: { headOffset: 1.14, headRadius: 0.28, bodyOffset: 0.60, bodyRadius: 0.52 },
    // Dummy head sits at body-local 2.12 plus the 0.45 body-group offset.
    dummy:  { headOffset: 2.57, headRadius: 0.30, bodyOffset: 1.87, bodyRadius: 0.52 },
  },

  pickups: {
    boxes: 5,                // crates alive at once
    cycle: 30,               // seconds before the whole set is replaced
    range: 3.2,              // how close you must be to press E
    spawnRadius: 150,        // keep crates inside the mountain rim
    bobHeight: 0.35,
    syncInterval: 2.0,       // authority rebroadcast, covers late joiners
  },

  // --------------------------------------------------------------- sprint
  sprint: {
    speedMult: 2.0,          // hold Shift for double top speed
    swimMult: 1.5,           // Shift underwater is a gentler boost
    accelMult: 1.5,          // reach that speed quickly, not over ten metres
    frictionMult: 0.55,      // less braking so the run holds its momentum
    fovBoost: 13,            // widen the view — the classic "going fast" cue
    trailInterval: 0.028,    // seconds between trail puffs
  },

  // ----------------------------------------------------------------- swim
  swim: {
    speed: 11.0,             // full 3D swim speed, steered with the camera
    accel: 40,
    drag: 2.3,               // water resistance
    sinkGravity: -3.2,       // gentle sink when you stop kicking
    riseSpeed: 30,           // Space thrusts you upward
    maxRise: 10,
    maxSink: -9,
    breachBoost: 19,         // leap clear of the surface from just below it
    breachDepth: 1.4,        // how close to the surface a breach is allowed
    surfaceLevel: 0.55,      // eye depth that counts as "at the surface"
  },

  // ----------------------------------------------------------------- dash
  dash: {
    speed: 47,
    duration: 0.17,
    /**
     * Seconds of enforced wait AFTER a dash ends, on top of the dash itself.
     *
     * Zero: the only thing stopping a second dash is the first one still
     * running, so you may dash again the instant it finishes and no sooner.
     * That is the whole gate — `duration` is what stops it being spammed
     * every tenth of a second, and it is the number to raise if ground
     * dashing turns out to be too strong.
     *
     * Dashing has never cost stamina and still does not; air dashes are
     * limited by `airCharges` instead, which only refill on landing.
     */
    cooldown: 0,
    airCharges: 1,           // air dashes before you must touch ground/grapple
    endSpeedKeep: 0.52,      // fraction of dash speed retained on exit
    invulnerable: 0.14,      // brief i-frames make the dash a real defensive tool
  },

  // -------------------------------------------------------------- grapple
  grapple: {
    range: 62,
    fireSpeed: 210,          // tongue travel speed (visual + hit timing)
    retractSpeed: 150,
    pull: 105,               // acceleration toward the anchor
    maxPullSpeed: 40,
    swingBoost: 1.02,        // slight per-second tangential gain => swings feel alive
    minRopeLength: 3.5,
    cooldown: 0.35,
    detachDist: 3.0,         // auto-release when you arrive
    aimAssistAngle: 0.09,    // radians of cone assist toward anchors
    maxTime: 4.0,            // safety release
    // Bare rock offers nothing to stick to: terrain steeper than this cannot
    // be grappled, so the mountain rim is not a shortcut out of the map.
    // Structures (stone, wood, anchors) are always valid whatever the slope.
    noGrappleSlope: 0.42,
  },

  // --------------------------------------------------------------- combat
  combat: {
    maxHealth: 100,
    comboDamage: [16, 16, 26],
    comboWindow: 0.85,
    attackCooldown: [0.34, 0.34, 0.5],
    windup: [0.07, 0.06, 0.11],   // delay before the hitbox opens
    reach: 3.5,
    arc: 1.25,                    // half-angle of the slash cone (radians)
    knockback: [11, 11, 19],
    knockbackUp: [4.5, 4.5, 8.5],
    hitstop: [0.045, 0.045, 0.09],
    regenDelay: 6.0,
    regenRate: 9.0,
    respawnTime: 3.0,
    spawnProtection: 2.0,
  },

  // --------------------------------------------------------------- camera
  camera: {
    fov: 74,
    distance: 6.4,
    minDistance: 1.6,
    height: 1.85,
    shoulder: 0.75,          // over-the-shoulder offset
    sensitivity: 0.0024,
    pitchMin: -1.15,
    pitchMax: 1.05,
    followLerp: 16,          // position smoothing
    fovSpeedBoost: 16,       // extra FOV at high speed (speed lines feel)
    near: 0.15,
    far: 900,
  },

  // ----------------------------------------------------------------- net
  net: {
    sendRate: 20,            // state packets per second
    interpDelay: 0.11,       // render remote players this far in the past
    timeout: 9.0,            // drop a peer after this many seconds of silence
    prefix: 'frogshin-v1-',  // PeerJS id namespace
    /**
     * How long to wait for the MATCHMAKING SERVER to answer at all.
     *
     * Separate from the 20s allowed for a data channel, and it matters more:
     * if the signalling socket never opens, PeerJS reports nothing — no
     * 'open', often no 'error' either — so without this the button simply
     * hangs forever on "Creating room…" and reads as broken. School and
     * office firewalls block that socket routinely.
     */
    brokerTimeout: 12,
    /** The room Quick Play tries to claim. */
    publicRoom: 'FROG',
  },

  // -------------------------------------------------------------- quality
  gfx: {
    pixelScale: 0.5,         // internal render scale (pixel-art look + perf)
    shadows: true,
    maxParticles: 900,
  },
};

/** Team colours used to tint remote frogs so players are distinguishable. */
export const FROG_COLORS = [
  0x6cc24a, 0x4aa3c2, 0xc2794a, 0xa64ac2, 0xc2b74a,
  0x4ac28a, 0xc24a6c, 0x7a8ac2, 0x9cc24a, 0xc25a2a,
];

export const NINJA_NAMES = [
  'Ribbit', 'Shadowpad', 'Lilyblade', 'Kero', 'Toadstorm', 'Nightcroak',
  'Bogstep', 'Jadefang', 'Mistleap', 'Pondwraith', 'Tadpole', 'Swampsong',
];
