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
export const BUILD = 'v158';

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
     * The same, for a walkway you are meant to walk along.
     *
     * A rope bridge is a continuous sloping surface, but collision is boxes,
     * so it is built as a chain of overlapping planks. Standing on one you
     * are inside the next as well, and the step check measures against the
     * higher of them — which on a climbing span is the plank spacing times
     * the gradient, not the height of anything you could see. The mountain
     * spans came out asking for a metre a stride and simply stopped you.
     *
     * stepHeight is the rule for LEDGES: a crate, a kerb, a dais. A deck is
     * not a ledge, and only surfaces tagged 'deck' get this — bridge planks
     * and the ramps up to them, nothing else in the map.
     *
     * 2.0 covers the steepest span the valley builds: 2.0 of plank spacing
     * at a gradient of 0.50, plus the sag reversing at the far end, measured
     * at 1.27 per plank with a margin for where two planks overlap at once.
     * It can be this generous BECAUSE of the gate above — it is a stride
     * along a walkway, never a leap onto one.
     */
    deckStep: 2.0,
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

  /**
   * ═══ CATCHING THE EDGE ═════════════════════════════════════════════════
   *
   * Fall short of a ledge and, if your hands come within reach of its lip,
   * you catch it and pull yourself up instead of dropping.
   *
   * This exists for the broken roads in js/traverse.js. A crossing made of
   * the piers of a bridge that fell is only enjoyable if a jump judged
   * slightly short costs you a second rather than the whole crossing —
   * otherwise it is a thing players learn to walk around. Every one of
   * those sites also has a shelf underneath it to land on, so this is the
   * SECOND mercy rather than the only one: the edge catch saves the jump
   * that was nearly right, and the shelf saves the one that was not.
   *
   * `low` and `high` are measured from the FEET (`pos.y` is the soles; the
   * head is at `pos.y + move.height`, 1.75). So a lip anywhere between the
   * chest and a little over the head is catchable, and one at knee height
   * is not — that one is a step, and stepHeight already has it.
   *
   * It is deliberately not free of consequence: `cooldown` stops a held
   * approach from re-grabbing the same lip over and over as a way of
   * hovering, and a grab does NOT refund a used dash the way landing does
   * until the mantle actually completes.
   */
  ledge: {
    /** How far beyond the collision radius the hands reach. */
    reach: 0.85,
    /** Lowest catchable lip, above the soles — about chest height. */
    low: 1.00,
    /** Highest catchable lip — a little above the top of the head. */
    high: 2.00,
    /** How long the frog hangs before it pulls itself up. */
    hold: 0.42,
    /** How far below the lip the soles hang while holding on. */
    hangDrop: 1.35,
    /** No second catch for this long after letting go or topping out. */
    cooldown: 0.30,
    /** Minimum air time first, so it cannot fire on the frame you jump. */
    minAir: 0.10,
    /** Only when actually falling this fast or faster. */
    minFall: -1.0,
  },

  // -------------------------------------------------------------- stamina
  stamina: {
    // All costs halved from the first pass so stamina lasts twice as long.
    max: 100,
    jumpCost: 8,             // ground jump
    doubleJumpCost: 10,      // the frog flip costs more than a normal hop
    wallJumpCost: 6.5,
    breachCost: 9,           // leaping clear of the water
    /**
     * A dash is a fifth of the tank.
     *
     * Dashing used to be free, with only the dash's own duration stopping a
     * second one. That made it spammable in a straight line, which is what
     * this price is for: four dashes empty you, and emptying you costs the
     * sprint and the jump too.
     */
    dashCost: 20,
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
    /**
     * THE GUARD, AND THE ONLY THING THAT ENDS IT.
     *
     * You may raise it whenever you like and hold it as long as you like: a
     * blade held up is not a resource, and a guard on a stopwatch made every
     * fight about the stopwatch rather than about the fight.
     *
     * What costs you is USING it. The moment a blow is turned aside the
     * guard drops, and it cannot go back up for `afterHit` seconds. That
     * window is the attacker's answer to a raised blade, and it is why a
     * combo still beats standing there — the first hit opens you for the
     * second.
     */
    parry: {
      afterHit: 0.8,         // locked out this long once a blow is turned
      knockdownTime: 0.7,    // seconds on the floor, unable to act
      chipStagger: 0.18,     // brief hitstop when a blow is turned aside
      breakLock: 0.6,        // helpless after a guard is broken outright
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
  /**
   * ═══ WHAT THINGS PAY ════════════════════════════════════════════════════
   *
   * One rule runs through all of it: THE HARDER IT IS, THE MORE IT PAYS.
   * Being the one juggernaut against a room beats being one of the room;
   * room fourteen of the dungeon beats room one; and the two bosses that
   * end the game pay more than everything else put together.
   *
   * ── arena vs dungeon are DECOUPLED ────────────────────────────────────
   * The dungeon and the open world used to be priced as multiples of
   * `roundWinReward` — Frogath was `roundWinReward * 10`. That made the
   * arena's round payout a hidden multiplier on the whole game: nudging it
   * from 100 to 300 would have silently tripled Frogath, the Ascended, every
   * realm guardian and the island. Each now has its own number.
   */
  economy: {
    storageKey: 'frogshin.economy',

    // ---- the arena, per round. Repeatable, so these stay modest. ----
    tagReward: 250,          // per player tagged or infected
    roundWinReward: 300,     // your side won the round
    taggerWinReward: 800,    // won while it was you doing the chasing
    infectorStartWinReward: 500,  // started as an infector and it won
    survivorReward: 300,     // lasted the round without being caught
    ffaWinReward: 500,       // top of the scoreboard, on your own
    onlineInterval: 900,     // 15 minutes...
    onlineReward: 250,       // ...pays this much

    /**
     * ---- the dungeon: FIRST CLEAR ONLY, see Economy.awardOnce ----
     *
     * One entry per guardian, room 1 to room 14, WRITTEN OUT rather than
     * generated. A geometric curve produced the right shape and horrible
     * numbers — 107, 229, 4,786 — and a reward is a thing a player reads
     * off the screen and repeats to a friend. Round numbers are worth more
     * than a tidy formula.
     *
     * ── the shape ───────────────────────────────────────────────────────
     * Room one is the juggernaut at a third of its strength: the dungeon's
     * tutorial, paid 50, which is less than a single tag in the arena. The
     * first six rooms come to 875 between them — under one cheap crate for
     * clearing the easy half. It then roughly doubles every two rooms to
     * 7,000 at the last guardian.
     *
     * ── THE INVARIANT THAT MATTERS ──────────────────────────────────────
     * Froglets per point of boss health has to rise at EVERY step. The
     * bosses grow at `dungeon.boss.healthGrowth` (1.175 a room), and this
     * table outruns that the whole way down: 0.20 per hp at room one to
     * 3.44 at room fourteen. That is what stops the best earner in the game
     * being whichever shallow room you can already clear. Edit a number
     * here and the test suite checks that property again.
     */
    dungeonRewards: [
      50, 75, 100, 150, 200, 300, 500,
      700, 1000, 1500, 2000, 3000, 5000, 7000,
    ],
    frogathReward: 25000,    // the bottom of the dungeon
    divineReward: 100000,    // the Ascended — the hardest fight in the game

    // ---- the open world: also first time only ----
    guardianReward: 1500,    // per realm guardian, x (1 + its tier)
    islandReward: 750,       // reaching the end of the First Island
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
    /**
     * ═══ THE SHADOW CLONE ════════════════════════════════════════════════
     *
     * It replays what you did half a second ago, and it is a SECOND BODY on
     * the field — not a decoy. It swings when you swung and those swings
     * land; it can be hit, and kunai aim-assist locks onto it exactly as it
     * does onto a player. Distraction is a thing you can use it for, not the
     * thing it is for.
     *
     * ── it dies to one hit ────────────────────────────────────────────────
     * That is the whole balance of it. A body that fights for you, soaks the
     * kunai meant for you, and cannot be removed would simply be a second
     * player; one that pops the moment anybody connects is a trade. Killing
     * it early refunds NOTHING — the cooldown runs from the moment you cast,
     * so a clone swatted in its first second costs the same sixty as one that
     * lived its full ten.
     */
    shadowclone: {
      duration: 10,
      cooldown: 60,
      delay: 0.45,           // how far behind you the clone copies your moves
      buffer: 4.0,           // seconds of movement history kept
      minGap: 1.7,           // it never stands on top of you, even at a halt
      /**
       * What its swings hit for, as a fraction of your own.
       *
       * Not 1. The clone repeats every cut you make, so at full damage the
       * ability is a flat doubling of your output for ten seconds and there
       * is no decision in it. At 0.6 a swing you land yourself is still
       * worth more than one it copies, and the clone is worth casting for
       * the body as much as for the damage.
       */
      damage: 0.6,
    },

    /**
     * ═══ EARTH SHELL ═════════════════════════════════════════════════════
     *
     * Stone closes over you and nothing gets through. The catch is that it
     * is a COMMITMENT, not a raised guard: you cannot move, swing, throw or
     * look while it is up, and it comes down on its own clock. A parry is
     * something you flick; this is something you decide.
     *
     * ── the release is the whole ability ──────────────────────────────────
     * Letting it lapse does nothing but waste twelve seconds. Releasing at
     * the right MOMENT bursts the shell outward — you launch forward and
     * everything near you is thrown off. Two moments count as right:
     *
     *   1. Just after the shell eats a blow (`counterWindow`). This is the
     *      reactive one — block, then answer, which is what the ability is
     *      really for.
     *   2. The last `lateWindow` seconds before it lapses. This is the one
     *      you can practise alone and the one that works when nobody is
     *      obliging enough to attack you.
     *
     * Without (2) the ability would be dead weight against anyone who
     * simply waits you out, which is the obvious counter and would make it
     * a trap rather than a choice.
     */
    earthshell: {
      duration: 4.0,         // how long the stone can hold before it lapses
      cooldown: 12,
      counterWindow: 0.55,   // release window opened by absorbing a hit
      lateWindow: 0.7,       // release window before it lapses on its own
      /**
       * The burst. `launch` is forward speed, `lift` the hop that sells it,
       * `radius`/`knock` throw everyone else off, and `damage` is small on
       * purpose — this is a disengage and a re-opening, not a kill.
       */
      launch: 42,
      lift: 7.5,
      radius: 7.0,
      knock: 26,
      damage: 14,
      invulnerable: 0.45,    // i-frames carried out of the burst
    },

    /**
     * ═══ TONGUE TRAP ═════════════════════════════════════════════════════
     *
     * The tongue the frog already grapples with, aimed at a person. It
     * catches whoever is in front of you, drags them into your reach and
     * the katana comes round on its own.
     *
     * ── why it is a cone and not a line ───────────────────────────────────
     * A hitscan line at this range would be a snipe. The cone is narrow
     * enough that you must actually be facing your target and wide enough
     * that it is not a pixel test, which puts the ability where it belongs:
     * a close-to-mid opener, not a ranged pick.
     *
     * The pull is capped at `pullTo` rather than being a fixed impulse, so
     * it lands the victim at the same place every time — at the end of your
     * blade. A raw impulse would drag a light target through you and leave
     * a heavy one out of reach.
     */
    tonguetrap: {
      cooldown: 10,
      range: 26,             // furthest the tongue will reach for someone
      arc: 0.42,             // half-angle of the catching cone, radians
      travel: 0.16,          // seconds the tongue takes to get there
      hold: 0.22,            // beat it holds them before the strike
      pullTo: 3.0,           // where the drag ends: just inside katana reach
      damage: 24,            // the automatic strike at the end of the drag
      /**
       * Nothing can be caught twice in a row by the same frog inside this,
       * so two people with tongues cannot hold one player in the air
       * forever. It is the same idea as tag immunity.
       */
      immunity: 1.6,
    },

    /**
     * ═══ LIGHTNING STEP ══════════════════════════════════════════════════
     *
     * You become the arc, not the frog. Each press throws you to a target,
     * you hang there for a heartbeat, and the next press throws you on.
     *
     * ── the first step is free, the rest are earned ───────────────────────
     * Firing the ability takes you to the first target automatically. Every
     * step after that needs a press inside `window` seconds — miss it and
     * the chain ends then and there with the finishing slash. So the floor
     * of the ability is "a dash that does 20", and the ceiling is four of
     * them strung together by somebody with the timing for it. That gap is
     * the whole point; an ability that does its best work on its own has no
     * skill in it.
     *
     * ── against a boss ────────────────────────────────────────────────────
     * A boss is one target, so chaining round it would be four free hits
     * from nowhere. Instead it offers `bossPoints` standing points around
     * itself and you chain between THOSE, striking from a new angle each
     * time. Same mobility, same damage, but you are on the floor next to it
     * between steps where it can reach you — mobility and damage, not an
     * instant win.
     */
    lightningstep: {
      cooldown: 12,
      maxTargets: 4,
      range: 26,             // how far the first target may be
      linkRange: 22,         // and each hop after that
      damage: 20,
      travel: 0.09,          // seconds in the air between points — very fast
      window: 0.38,          // to press again, or the chain ends
      hang: 0.06,            // beat on arrival before the window opens
      finisher: 1.5,         // the last strike multiplies the per-target hit
      invulnerable: 0.25,    // carried a moment past the last step
      bossPoints: 4,         // standing points offered around a boss
      bossRadius: 7.5,       // how far out those points sit
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
    duration: {
      tag: 180, infection: 180, ffa: 300, juggernaut: 240,
      // Shorter than FFA: at Overdrive speeds a kill takes one clean hit, so
      // five minutes of it is a long time.
      overdrive: 240,
      /**
       * The longest round in the game, and it has to be.
       *
       * A prop hunt is a SEARCH. Shizuka Ward is 420 units across with
       * forty-eight ramen carts and a lamppost on every corner; a hunter
       * who has to walk up to things and look at them needs time to cover
       * that, and a three-minute round is one where the props win by
       * default because the map is bigger than the clock.
       */
      prophunt: 300,
    },
    defaultMode: 'ffa',      // used if nobody votes
    tagImmunity: 2.5,        // stops instant tag-backs
    taggerCooldown: 0.2,     // taggers throw faster (they have infinite kunai)
    /**
     * How far a runner must spawn from the nearest chaser, in the modes that
     * have one: Tag, Infection and Juggernaut.
     *
     * 45 rather than a bigger number because it has to be SATISFIABLE. The
     * valley has 16 spawn points; measured against every one of them, a
     * chaser standing on the worst of them still leaves 10 legal points at
     * 45, and 10 at 60 — but pushing further only narrows the choice without
     * buying distance, and predictable spawns are their own problem. Below
     * about 40 the nearest pair of points (22 apart) starts letting a tagger
     * cover you from next door.
     */
    spawnSafeDist: 45,
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
     * `duration` stops a dash being re-fired every tenth of a second, and
     * CFG.stamina.dashCost is what stops it being chained across the map;
     * air dashes are limited by `airCharges` on top, which only refill on
     * landing. Raise this only if a ground dash still reads as too strong
     * once the stamina price is accounted for.
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

  // ------------------------------------------------------------ OVERDRIVE
  /**
   * ═══ FROGSHIN: OVERDRIVE ═════════════════════════════════════════════
   *
   * A game MODE, not a movement system. Every value here is an override
   * that is applied while an Overdrive round is playing and dropped the
   * instant it ends — nothing in `move`, `sprint`, `grapple` or `combat` is
   * touched, so the normal modes are bit-for-bit what they were.
   *
   * ── the speed number, and why it is not units per second ──────────────
   * "Maximum speed 500" cannot be 500 engine units/s, and that is a hard
   * limit of the EXISTING movement system rather than a preference.
   * `CollisionWorld.moveCharacter` splits a frame's travel into at most SIX
   * sub-steps of 0.44 units (`min(6, ceil(dist / (radius * 0.8)))`), so
   * above about 2.6 units per frame the capsule starts skipping straight
   * through walls. At 60fps that ceiling is ~158 u/s and at 30fps it is
   * ~79. 500 u/s would put a frog through the side of every building in
   * Shizuka Ward, and fixing that means rewriting the collision sweep —
   * which is exactly the movement-system overhaul this mode must not be.
   *
   * So SPEED IS A SCALE. The frog genuinely moves far faster in engine
   * terms (58 u/s flat out against the normal 31), and `fullSpeedAt` maps
   * that to the 0–500 readout the damage formula, the shake threshold and
   * the HUD all use. Every number in the brief is exact on that scale:
   * 500 max, damage = speed × 0.5, shake above 350.
   *
   * ── health ────────────────────────────────────────────────────────────
   * 250, because the brief's own damage table needs it. `500 speed = 250
   * damage` against Frogshin's normal 100 health would make every hit
   * above 200 speed identical — a one-shot — and collapse the top 60% of
   * the range into one outcome. At 250 the table reads as intended: a
   * full-speed hit is exactly lethal and a half-speed one takes half. Set
   * this to 1.0 to get one-shot Overdrive instead; nothing else changes.
   */
  overdrive: {
    /** Health pool as a multiple of `combat.maxHealth`. 2.5 => 250. */
    healthScale: 2.5,

    // --- movement overrides (the same fields the normal mode reads) ---
    runSpeed: 18.0,          // was 15.5
    airSpeed: 17.0,          // was 14.0
    sprintMult: 3.2,         // was 2.0  =>  57.6 u/s flat out, against 31
    accelMult: 1.6,          // reach it quickly; sprint.accelMult is 1.5
    groundAccel: 360,        // must beat runSpeed * friction, as in `move`

    /**
     * Engine units/s that read as the full 500.
     *
     * 72 puts a flat-out ground sprint (18 × 3.2 = 57.6) at exactly 400,
     * which leaves the top fifth of the bar for what you can only get by
     * diving or by swinging off the existing grapple — so the 500 hit is
     * something you set up, not something you hold down Shift for.
     */
    fullSpeedAt: 72,
    maxSpeed: 500,

    /** DAMAGE = SPEED × 0.5, exactly as specified. */
    damagePerSpeed: 0.5,

    // --- the impact shake ---
    /** Strictly ABOVE this: 350 is no shake, 351 shakes. */
    shakeAbove: 350,
    shakeTime: 0.3,
    shakeStrength: 1.0,

    /**
     * Where the speed wake starts and where it is at full strength, on the
     * 0–500 scale. Below `windFrom` there is nothing at all, so standing
     * still is calm.
     */
    windFrom: 100,
    windFull: 450,
  },

  // ------------------------------------------------------------ prop hunt
  /**
   * ═══ PROP HUNT ═══════════════════════════════════════════════════════
   *
   * See js/prophunt.js for the disguises themselves. These are the numbers
   * that decide whether the mode is a game or a formality.
   */
  prophunt: {
    /**
     * Two, not three.
     *
     * One hunter against one prop is a real round — a whole map, one person
     * hiding in it and one person walking up to lampposts — which is more
     * than can be said for a one-on-one juggernaut. Below two there is
     * nobody to hide from.
     */
    minPlayers: 2,

    /**
     * Hunters as a share of the lobby, rounded UP and capped at one short
     * of everybody.
     *
     * A quarter rather than a third because the hunters have every
     * advantage that matters: they move freely, they can see, and they have
     * blades against props that mostly cannot fight back. Four props to one
     * hunter is the ratio at which a hunter has to actually search instead
     * of sweeping a street in formation.
     */
    hunterFraction: 0.25,

    /**
     * Seconds at the start where hunters cannot move and props can.
     *
     * The mode does not work without it. A hunter who watches the round
     * begin sees the entire lobby standing in the open turning into
     * furniture, and the search is over before it starts.
     */
    hideTime: 15,

    /**
     * What a prop's body is scaled to while disguised.
     *
     * The collider follows the PROP, not the frog — a ramen cart that slips
     * through a doorway a cart could not fit through is the tell that ends
     * the disguise. `r` and `h` come off the prop's own definition; this is
     * the floor, so the very small props (a bicycle) still cannot walk
     * through a wall a frog would be stopped by.
     */
    minRadius: 0.55,

    /**
     * A prop moves at this multiple of the normal run speed.
     *
     * Slower, and deliberately: the whole skill of being a prop is choosing
     * where to be BEFORE the hunters arrive, and a lamppost that can outrun
     * a frog turns the mode into tag with a costume.
     */
    speedMult: 0.72,

    /** Health, as a multiple of `combat.maxHealth`. A prop is found once. */
    healthScale: 0.4,

    /** Froglets a hunter is paid for finding one. */
    findReward: 120,

    /**
     * ═══ THE REVEAL ══════════════════════════════════════════════════════
     *
     * Every 30 seconds, every prop still hidden lights up for 5.
     *
     * Without it a good prop is unbeatable. The mode's failure state is a
     * player who picked a perfect corner in the first fifteen seconds and
     * then did nothing for five minutes while a hunter walked past them
     * eleven times — which is not a stand-off, it is two people not playing.
     * The reveal puts a clock on hiding: a spot only has to survive until
     * the next pulse, and after that it is a spot somebody has SEEN.
     *
     * Five seconds is long enough for a hunter to take a bearing and start
     * moving, and short enough that a prop who breaks for new cover the
     * instant it fires can still get away. That trade — stay and be found,
     * or move while everyone is looking — is the decision the mode wanted.
     *
     * It is derived from the ROUND CLOCK, never broadcast. Every client
     * computes the same window from `RoundManager.timer`, so a pulse cannot
     * fire on one screen and not another, and it costs nothing on the wire.
     * See `revealAt` in js/prophunt.js.
     *
     * ── THESE ARE A GAP AND A LENGTH, NOT A PERIOD ────────────────────
     * `revealGap` is the DARK time between pulses and `revealFor` is how
     * long a pulse lasts, so the cycle is the two added together — 35
     * seconds, of which 30 are dark.
     *
     * It used to be `revealEvery: 30`, a period, which made the dark time
     * 25 rather than 30 and meant changing the pulse length silently
     * changed the gap as well. Two independent numbers, each meaning the
     * thing it is named after.
     */
    revealGap: 30,
    revealFor: 5,
  },

  // ---------------------------------------------------------------- shark
  /**
   * ═══ THE SHARK IN THE LAKE ═══════════════════════════════════════════
   *
   * Shizuka Ward only. See js/shark.js for how these fit together — the
   * short version is that `bite` is a CONTRACT (1.2 seconds in the water
   * and you are eaten) and everything else exists to make that contract
   * survivable to look at.
   *
   * The two that actually matter:
   *
   *   patrolFar    how far the shark ever wanders from the water nearest
   *                you. It keeps the fin somewhere you can SEE it, and it
   *                keeps the charge to a couple of seconds rather than a
   *                long boring swim across the bay.
   *   strikeSpeed  how fast it comes once it commits. Above a sprinting
   *                frog in water (16.5) by enough that fleeing is not an
   *                answer, below the speed at which it stops being legible.
   */
  shark: {
    /**
     * Seconds in the water before it COMMITS. At 1.2 it turns and charges;
     * it eats you when it gets to you.
     *
     * This is not the same as "eaten at 1.2s", and the difference is the
     * whole feel of the thing. A bite on a timer has to be solved backwards
     * — the shark needs whatever speed arrives on schedule, which at range
     * is a torpedo and up close is a shark politely slowing down. A CHARGE
     * on a timer just needs one honest speed, and the seconds between the
     * fin turning toward you and the water closing over you are the part
     * worth having.
     */
    alert: 0.8,
    /**
     * HOW BIG. One number sizes the whole animal: the model is authored at
     * unit scale and every derived measurement below is per-unit-of-scale,
     * multiplied by this where it is used. At 3 the shark is about 25 units
     * nose to tail — a frog is 1.75 tall, so it is roughly fourteen frogs
     * long, which is the point.
     */
    scale: 3.0,
    /**
     * How close it has to BE to bite, per unit of scale — no killing from
     * the bay. It tracks the size because the mouth does: a bigger animal
     * reaches you sooner, which is also what lets it take somebody wading
     * in water too shallow for it to swim into.
     */
    biteRange: 4.2,

    cruiseSpeed: 17.0,
    /**
     * How fast it moves when it is repositioning rather than loitering —
     * far enough from its patrol point that it is going somewhere. Set to
     * keep pace with a sprinting frog on land (31 u/s) so that running
     * around the ward does not leave it permanently behind.
     */
    trackSpeed: 52.0,
    cruiseAccel: 11.0,
    cruiseTurn: 1.1,            // radians/s — a lazy circling turn
    strikeAccel: 240.0,         // a charge winds up fast — full speed in ~0.2s
    strikeTurn: 3.2,            // floor on the turn rate; strikeRadius usually wins
    /**
     * The radius the strike turn is solved from, so a faster charge turns
     * harder. A FIXED turn rate meant a thirty-unit turn circle at speed,
     * and the shark sailed straight past its victim and had to loop —
     * which the simulation caught and no amount of reading would have.
     */
    strikeRadius: 13.0,
    /**
     * Charge speed. Five times what a sprinting frog manages in water
     * (16.5), so committing to a swim is committing and there is no version
     * of fleeing that works.
     *
     * It is still a speed you can WATCH arrive rather than one that
     * teleports: over the couple of seconds a charge takes, 82 units a
     * second is a bow wave crossing the bay at you. `strikeRadius` keeps
     * the turn circle tight enough that it still converges at this speed —
     * a fixed turn RATE would have it sailing straight past again.
     */
    strikeSpeed: 82.0,

    /** How far from the nearest water it patrols, near and far. */
    patrolNear: 26,
    patrolFar: 62,
    /** How often it picks a new wander point, and how fast it circles. */
    retargetEvery: 2.2,
    circleRate: 0.5,
    /** Never steer closer to the island than this past the swim line. */
    standOff: 14,
    /**
     * How much water it needs under it. The shark may never go anywhere
     * shallower, charging or otherwise — it cannot beach itself, and the
     * shallows are the one place a swimmer is genuinely safer.
     */
    draft: 1.45,

    /** Depth of the back below the surface while cruising. */
    cruiseDepth: 0.86,
    /** How high the fin's tip sits above the body origin — see `_place`. */
    finTop: 2.45,

    /** The dolphin jump: every 25–30 seconds, as asked. */
    breachEvery: [25, 30],
    breachTime: 1.75,
    breachHeight: 5.2,
    breachSpeed: 38.0,
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

/**
 * WHAT DUNGEON ROOM `room` PAYS, the first time it is ever cleared.
 *
 * A lookup into `economy.dungeonRewards`, clamped at both ends so a
 * cheat-jumped or out-of-range room reads a real entry instead of
 * `undefined` — which would otherwise reach `awardOnce` as NaN and silently
 * pay nothing while still burning the bounty.
 *
 * The last GUARDIAN is room `rooms - 2`, not `rooms - 1`: the final room
 * holds Frogath, who is not on this table and is paid `frogathReward`.
 */
export function dungeonPayout(room) {
  const table = CFG.economy.dungeonRewards;
  if (!table || !table.length) return 0;
  const i = Math.max(0, Math.min(table.length - 1, room | 0));
  return table[i];
}
