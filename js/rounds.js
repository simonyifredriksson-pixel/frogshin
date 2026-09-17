/**
 * Round flow and game modes.
 *
 * Phases cycle: VOTING -> STARTING -> PLAYING -> ENDING -> VOTING ...
 *
 * One client is the authority (the host, or the local player when offline).
 * It owns the phase clock, tallies votes, assigns taggers and resolves tags,
 * then broadcasts the whole round state. Everyone else is a pure mirror and
 * only ever *requests* things (a vote, a tag) — which means the modes cannot
 * desync, because there is exactly one place the rules are applied.
 *
 * Modes:
 *   FFA       — ordinary deathmatch, most kills wins.
 *   TAG       — taggers have unlimited kunai; tagging SWAPS roles, so the
 *               thrower becomes a runner and the victim becomes it.
 *   INFECTION — same throw, but the victim JOINS the taggers. Ends when
 *               everyone is infected, or the survivors run out the clock.
 */

import { CFG } from './config.js?v=v151';
import { clamp } from './util.js?v=v151';

export const MODES = {
  TAG: 'tag', INFECTION: 'infection', FFA: 'ffa', TEAM: 'team',
  JUGGERNAUT: 'juggernaut', OVERDRIVE: 'overdrive', PROPHUNT: 'prophunt',
};

/**
 * Every mode, in the order the vote screen lists them and the order a tie
 * resolves in. Written once: `_resolveVote` used to carry its own copy and a
 * mode added to `MODES` but forgotten here could win a vote it was never
 * offered, or — as happened — be unvotable while its button was on screen.
 */
export const MODE_ORDER = [
  MODES.TAG, MODES.INFECTION, MODES.FFA, MODES.TEAM,
  MODES.JUGGERNAUT, MODES.OVERDRIVE, MODES.PROPHUNT,
];

/** A fresh zeroed tally. One place, so a new mode cannot be half-added. */
export function emptyTally() {
  const t = {};
  for (const m of MODE_ORDER) t[m] = 0;
  return t;
}

/** Squad sizes offered by the TEAM mode: 1v1 through 5v5. */
export const MAX_TEAM_SIZE = 5;

export const MODE_INFO = {
  [MODES.TAG]: {
    name: 'TAG',
    blurb: 'Taggers have unlimited kunai. Get hit and you become it — and they go free.',
  },
  [MODES.INFECTION]: {
    name: 'INFECTION',
    blurb: 'Get hit and you join the taggers. Survive to the end, or convert everyone.',
  },
  [MODES.FFA]: {
    name: 'CLASSIC FFA',
    blurb: 'Everyone for themselves. Katana, kunai, no teams. Most kills wins.',
  },
  [MODES.TEAM]: {
    name: 'TEAM BATTLE',
    blurb: 'Same fight, two sides. Pick 1v1 up to 5v5. No friendly fire — the '
      + 'team with the most kills takes the round.',
  },
  [MODES.JUGGERNAUT]: {
    name: 'JUGGERNAUT',
    blurb: 'One armoured toad with a huge katana, endless kunai and a mountain '
      + 'of health, against everyone else. Slow, though. Kill it, or be killed '
      + 'and watch the rest try. Needs three players.',
    minPlayers: CFG.juggernaut.minPlayers,
  },
  [MODES.OVERDRIVE]: {
    name: 'OVERDRIVE',
    blurb: 'Same frog, same grapple, no stamina and twice the top speed. The '
      + 'katana hurts as hard as you were moving — 500 speed is a kill. '
      + 'Landing it at that speed is the whole game.',
  },
  [MODES.PROPHUNT]: {
    name: 'PROP HUNT',
    blurb: 'Everyone but the hunters turns into the scenery — a lamppost, a '
      + 'ramen cart, a stilt hut, whatever this map is full of. C changes '
      + 'what you are, SHIFT bolts you to the spot. Hunters have blades and '
      + 'the clock. Needs two players.',
    minPlayers: CFG.prophunt.minPlayers,
  },
};

/**
 * How much health the juggernaut gets for a given lobby size.
 *
 * The table is the specification verbatim. It is not monotonic — five players
 * give less than four — so it is written out rather than computed, which is
 * also what makes it a one-line change if those numbers were a slip.
 */
export function juggernautHealthMultiplier(playerCount) {
  const J = CFG.juggernaut;
  const listed = J.healthByPlayers[playerCount];
  if (listed !== undefined) return listed;
  if (playerCount < J.minPlayers) return J.healthByPlayers[J.minPlayers] || 1;
  // Beyond the table, each extra player adds a flat amount.
  const keys = Object.keys(J.healthByPlayers).map(Number);
  const top = Math.max.apply(null, keys);
  return J.healthByPlayers[top] + (playerCount - top) * J.healthPerExtraPlayer;
}

/** Modes a lobby of this size is allowed to play. */
export function modeAvailable(mode, playerCount) {
  const info = MODE_INFO[mode];
  if (!info || !info.minPlayers) return true;
  return playerCount >= info.minPlayers;
}

/** Team colours, used for nameplates and the scoreboard. */
export const TEAM_COLORS = [0x4a9ee0, 0xe05a4a];
export const TEAM_NAMES = ['BLUE', 'RED'];

export const PHASE = {
  VOTING: 'voting',
  STARTING: 'starting',
  PLAYING: 'playing',
  ENDING: 'ending',
};

/** Highest legal tagger count for a lobby size (always leaves one runner). */
export function maxTaggers(playerCount) {
  return Math.max(1, playerCount - 1);
}

export class RoundManager {
  /**
   * @param authority   true if this client runs the rules
   * @param onBroadcast (stateObject) => void
   */
  constructor(authority, onBroadcast) {
    this.authority = authority;
    this.onBroadcast = onBroadcast;

    this.phase = PHASE.VOTING;
    this.mode = CFG.rounds.defaultMode;
    this.timer = CFG.rounds.voteTime;
    this.taggerCount = 1;
    this.taggers = new Set();
    this.immunity = new Map();      // playerId -> seconds of no-tag-back left
    this.votes = new Map();         // playerId -> { mode, taggers }
    this.tally = emptyTally();
    this.startingTaggers = new Set();
    // Juggernaut mode: who the monster is, and who it has already put out.
    this.juggernaut = null;
    this.eliminated = new Set();
    this.teams = new Map();         // playerId -> 0 | 1, team mode only
    this.teamSize = 2;              // "2v2"; shares the picker with taggerCount
    this.outcome = '';              // 'survivors' | 'taggers' | 'ffa' | 'team0' | 'team1' | 'draw'
    this.result = '';
    this.roundNumber = 0;
    this._syncAccum = 0;
    /** Set by `forceMode` when a tournament has already decided the mode. */
    this.forced = null;
    /**
     * Solo practice: free-for-all rules with none of the ceremony.
     *
     * Not a mode of its own — it IS ffa, just with no vote to sit through, no
     * clock and no round end, because there is one player and nothing to
     * decide. Combat, kunai and the dummies behave exactly as they do in a
     * real match, which is the entire point of practising in it.
     */
    this.practice = false;

    // Set by the game so the manager can react without importing anything.
    this.onPhaseChange = null;
    this.onTag = null;              // (victimId, byId, mode) => void
    this.onEliminate = null;        // (victimId, wasJuggernaut) => void
  }

  // ------------------------------------------------------------- queries

  isTagger(id) { return this.taggers.has(id); }
  get isTagMode() { return this.mode === MODES.TAG || this.mode === MODES.INFECTION; }
  get isTeamMode() { return this.mode === MODES.TEAM; }
  get isJuggernautMode() { return this.mode === MODES.JUGGERNAUT; }
  /**
   * OVERDRIVE is a free-for-all with the speed rules bolted on, so
   * everything that asks "is this a fight?" has to say yes to it — scoring,
   * damage, the leaderboard. It is checked as its own getter rather than
   * folded into `isFfaMode` because the things that differ (stamina, top
   * speed, sword damage) are asked about by name.
   */
  get isOverdriveMode() { return this.mode === MODES.OVERDRIVE; }
  /**
   * PROP HUNT reuses `taggers` for its hunters and `eliminated` for the
   * props that have been found.
   *
   * Deliberately not a third set. Both of those already do exactly the right
   * thing everywhere else in the class — `removePlayer` clears them, the
   * wire carries them, `_beginVoting` resets them — and a parallel `hunters`
   * set would be a fourth place to forget one of those.
   *
   * What it is NOT is a tag mode: `isTagMode` gates the kunai swap, the
   * tag immunity and the "you are it" HUD, none of which apply here. See
   * `applyTag`, which refuses a prop-hunt round outright.
   */
  get isPropHunt() { return this.mode === MODES.PROPHUNT; }
  isHunter(id) { return this.isPropHunt && this.taggers.has(id); }
  /** Disguised, and still standing. */
  isProp(id) {
    return this.isPropHunt && !this.taggers.has(id) && !this.eliminated.has(id);
  }
  /** Props still hidden, out of a lobby. */
  propsLeft(playerIds) {
    return playerIds.filter((id) => this.isProp(id)).length;
  }
  get playing() { return this.phase === PHASE.PLAYING; }
  /** Damage and deaths matter in the shooting modes, not the chases. */
  get combatEnabled() {
    return this.mode === MODES.FFA || this.mode === MODES.TEAM
      || this.mode === MODES.JUGGERNAUT || this.mode === MODES.OVERDRIVE
      || this.mode === MODES.PROPHUNT;
  }

  isJuggernaut(id) { return this.isJuggernautMode && this.juggernaut === id; }

  /**
   * Knocked out and watching. Juggernaut and Prop Hunt are the two modes
   * that eliminate anyone — in Tag being caught makes you a tagger, which
   * is a role change, not an exit.
   */
  isSpectating(id) { return this.eliminated.has(id); }

  /** Frogs still standing against the juggernaut. */
  survivorsLeft(playerIds) {
    return playerIds.filter(
      (id) => id !== this.juggernaut && !this.eliminated.has(id)).length;
  }

  /** Which side a player is on, or -1 outside team mode. */
  teamOf(id) {
    const t = this.teams.get(id);
    return t === undefined ? -1 : t;
  }

  /** True when two players must not be able to hurt each other. */
  areAllies(a, b) {
    if (!this.isTeamMode) return false;
    const ta = this.teamOf(a);
    return ta !== -1 && ta === this.teamOf(b);
  }
  get modeInfo() { return MODE_INFO[this.mode] || MODE_INFO[MODES.FFA]; }

  /** Seconds of tag immunity remaining for a player. */
  immunityFor(id) { return this.immunity.get(id) || 0; }

  // -------------------------------------------------------------- voting

  /**
   * Record a vote. Safe to call on any client — non-authority clients keep a
   * local copy for the UI while the authority's tally is what counts.
   */
  castVote(playerId, mode, taggerCount, playerCount) {
    if (this.phase !== PHASE.VOTING) return false;
    if (!MODE_INFO[mode]) return false;
    // A mode the lobby is too small for cannot be voted for at all — the
    // button is hidden as well, but the rule lives here so a stale or
    // hand-made packet cannot start a two-player juggernaut round.
    if (!modeAvailable(mode, playerCount)) return false;
    // Team mode reuses the same picker for squad size, but it is capped at
    // 5v5 rather than by the lobby size.
    const cap = mode === MODES.TEAM ? MAX_TEAM_SIZE : maxTaggers(playerCount);
    this.votes.set(playerId, {
      mode,
      taggers: clamp(Math.round(taggerCount || 1), 1, cap),
    });
    this._recount();
    return true;
  }

  _recount() {
    this.tally = emptyTally();
    for (const v of this.votes.values()) {
      if (this.tally[v.mode] !== undefined) this.tally[v.mode]++;
    }
  }

  /** Winning mode, plus the most popular tagger count among its voters. */
  _resolveVote(playerCount) {
    /**
     * A tournament's mode is not up for a vote — the prize was staked
     * against it. `modeAvailable` is deliberately not consulted: the host
     * chose a size when they staked, and a room that is briefly one player
     * short must not silently become a different game than the one people
     * are playing for.
     */
    if (this.forced) {
      return { mode: this.forced.mode, taggerCount: this.forced.taggerCount };
    }
    let bestMode = null;
    let bestVotes = -1;
    // Deterministic order so a tie always resolves the same way everywhere.
    for (const m of MODE_ORDER) {
      if (!modeAvailable(m, playerCount)) continue;
      if (this.tally[m] > bestVotes) { bestVotes = this.tally[m]; bestMode = m; }
    }
    if (bestVotes <= 0) bestMode = CFG.rounds.defaultMode;

    // Tagger count: most common request among people who voted for this mode.
    const counts = new Map();
    for (const v of this.votes.values()) {
      if (v.mode !== bestMode) continue;
      counts.set(v.taggers, (counts.get(v.taggers) || 0) + 1);
    }
    let bestCount = 1, bestSeen = -1;
    for (const [n, seen] of counts) {
      if (seen > bestSeen || (seen === bestSeen && n < bestCount)) {
        bestSeen = seen; bestCount = n;
      }
    }
    const cap = bestMode === MODES.TEAM ? MAX_TEAM_SIZE : maxTaggers(playerCount);
    return { mode: bestMode, taggerCount: clamp(bestCount, 1, cap) };
  }

  // ------------------------------------------------------ authority logic

  /**
   * @param dt
   * @param playerIds array of every player id currently in the match
   */
  update(dt, playerIds) {
    // Immunity ticks everywhere so the local HUD stays truthful.
    for (const [id, t] of this.immunity) {
      const left = t - dt;
      if (left <= 0) this.immunity.delete(id); else this.immunity.set(id, left);
    }

    if (!this.authority) {
      // Mirrors run the clock locally between syncs for a smooth countdown.
      if (this.timer > 0) this.timer = Math.max(0, this.timer - dt);
      return;
    }

    this.timer -= dt;

    switch (this.phase) {
      case PHASE.VOTING: {
        // A tournament has nothing to vote on — see `forceMode`.
        if (this.forced) { this._beginRound(playerIds); break; }
        // Start early once everyone present has voted.
        const everyoneVoted = playerIds.length > 0 &&
          playerIds.every((id) => this.votes.has(id));
        if (this.timer <= 0 || everyoneVoted) this._beginRound(playerIds);
        break;
      }
      case PHASE.STARTING:
        if (this.timer <= 0) {
          this._setPhase(PHASE.PLAYING, CFG.rounds.duration[this.mode] || 180);
        }
        break;
      case PHASE.PLAYING:
        if (this.timer <= 0) {
          const r = this._timeUpResult(playerIds);
          this._finish(r.text, r.outcome);
        } else if (this.mode === MODES.INFECTION &&
                   playerIds.length > 1 &&
                   playerIds.every((id) => this.taggers.has(id))) {
          this._finish('EVERYONE INFECTED — taggers win!', 'taggers');
        } else if (this.isPropHunt && playerIds.length > 1) {
          // The hunters win by finding everything. Running the clock out is
          // the props' win and is handled in `_timeUpResult`.
          if (this.propsLeft(playerIds) === 0) {
            this._finish('EVERY PROP FOUND — hunters win!', 'taggers');
          }
        } else if (this.isJuggernautMode && this.juggernaut) {
          // The juggernaut wins by clearing the field; the frogs win by
          // bringing it down. Its own death is reported through eliminate().
          if (this.eliminated.has(this.juggernaut)) {
            this._finish('THE JUGGERNAUT FALLS — frogs win!', 'survivors');
          } else if (this.survivorsLeft(playerIds) === 0) {
            this._finish('ALL FROGS DOWN — juggernaut wins!', 'juggernaut');
          }
        }
        break;
      case PHASE.ENDING:
        if (this.timer <= 0) this._beginVoting();
        break;
      default:
        break;
    }

    this._syncAccum += dt;
    if (this._syncAccum >= CFG.rounds.syncInterval) {
      this._syncAccum = 0;
      this.broadcast();
    }
  }

  /**
   * Result text plus a machine-readable outcome, which the economy uses to
   * decide who gets paid.
   * @returns { text, outcome: 'survivors'|'taggers'|'ffa' }
   */
  _timeUpResult(playerIds) {
    // Overdrive scores like a free-for-all: most kills on the board wins,
    // and the economy pays it out the same way.
    if (this.mode === MODES.FFA || this.mode === MODES.OVERDRIVE) {
      return { text: 'TIME — check the scoreboard', outcome: 'ffa' };
    }
    if (this.mode === MODES.TEAM) {
      // Kill totals are supplied by the game, which is what actually tracks
      // them; the round object only decides what the numbers mean.
      const a = this.teamKills ? this.teamKills[0] : 0;
      const b = this.teamKills ? this.teamKills[1] : 0;
      if (a === b) return { text: `DRAW — ${a} each`, outcome: 'draw' };
      const win = a > b ? 0 : 1;
      return {
        text: `${TEAM_NAMES[win]} WINS — ${Math.max(a, b)} to ${Math.min(a, b)}`,
        outcome: 'team' + win,
      };
    }
    /**
     * PROP HUNT on the clock: anybody still hidden has won.
     *
     * Scored as 'survivors' — the same outcome tag the runners get for
     * outlasting a tag round — so the economy pays it out without needing to
     * learn a seventh mode. The props ARE the survivors.
     */
    if (this.mode === MODES.PROPHUNT) {
      const left = this.propsLeft(playerIds);
      return left > 0
        ? {
          text: `TIME — ${left} prop${left === 1 ? '' : 's'} never found!`,
          outcome: 'survivors',
        }
        : { text: 'EVERY PROP FOUND — hunters win!', outcome: 'taggers' };
    }
    if (this.mode === MODES.JUGGERNAUT) {
      // Outlasting the clock counts as beating it — the frogs held the field.
      const left = this.survivorsLeft(playerIds);
      return left > 0
        ? {
          text: `TIME — ${left} frog${left === 1 ? '' : 's'} outlasted the juggernaut!`,
          outcome: 'survivors',
        }
        : { text: 'ALL FROGS DOWN — juggernaut wins!', outcome: 'juggernaut' };
    }
    const survivors = playerIds.filter((id) => !this.taggers.has(id)).length;
    if (this.mode === MODES.INFECTION) {
      return survivors > 0
        ? {
          text: `${survivors} survivor${survivors === 1 ? '' : 's'} held out — survivors win!`,
          outcome: 'survivors',
        }
        : { text: 'Taggers win!', outcome: 'taggers' };
    }
    return { text: 'TIME — the runners escaped!', outcome: 'survivors' };
  }

  _beginVoting() {
    this.roundNumber++;
    this.votes.clear();
    this._recount();
    this.taggers.clear();
    this.immunity.clear();
    // Everyone comes back for the next round — spectating never carries over.
    this.eliminated.clear();
    this.juggernaut = null;
    /**
     * A forced mode still passes THROUGH voting, for one tick.
     *
     * `_beginRound` is the only place that deals teams, picks taggers and
     * chooses a juggernaut — jumping straight to STARTING would skip all of
     * it and start a team match with nobody on a team. So the phase is set
     * as normal and `update` resolves it on the very next tick, with a
     * zero-length timer so nothing counts down.
     *
     * The vote SCREEN never appears: main.js checks `forced` before showing
     * it. A screen that flashes up and vanishes reads as a bug.
     */
    this._setPhase(PHASE.VOTING, this.forced ? 0 : CFG.rounds.voteTime);
  }

  /**
   * ═══ LOCK THE MODE AND SKIP THE VOTE ═══════════════════════════════════
   *
   * A tournament plays what the host paid for. There is nothing to vote on:
   * the prize was staked against a specific mode, and letting the room vote
   * it away would mean the money was put up for one game and spent on
   * another. So the vote never happens and the match starts straight into
   * the countdown.
   *
   * `null` hands the room back its vote — used when the tournament is over
   * or abandoned, so an ordinary room that follows it behaves normally.
   */
  forceMode(mode, teamSize) {
    this.forced = mode ? { mode, taggerCount: clamp(teamSize || 1, 1, MAX_TEAM_SIZE) } : null;
  }

  _beginRound(playerIds) {
    const win = this._resolveVote(playerIds.length);
    this.mode = win.mode;
    this.taggerCount = win.taggerCount;
    this.taggers.clear();
    this.immunity.clear();

    if (this.isTagMode) {
      // Pick the taggers at random from everyone present.
      const pool = playerIds.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      const n = Math.min(this.taggerCount, Math.max(1, pool.length - 1));
      for (let i = 0; i < n && i < pool.length; i++) this.taggers.add(pool[i]);
    }

    /**
     * PROP HUNT: deal the hunters.
     *
     * A FRACTION of the lobby rather than the vote's tagger count, because
     * the count picker is a chase-mode control and the balance here is a
     * ratio: one hunter to three or four props. `CFG.prophunt.hunterFraction`
     * is that ratio, rounded up so a two-player lobby is one of each, and
     * capped so there is always at least one prop left to find — a round
     * where everybody is a hunter ends the instant it starts.
     */
    if (this.isPropHunt && playerIds.length) {
      const pool = playerIds.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      const want = Math.ceil(pool.length * CFG.prophunt.hunterFraction);
      const n = clamp(want, 1, Math.max(1, pool.length - 1));
      for (let i = 0; i < n; i++) this.taggers.add(pool[i]);
    }
    // Remembered separately from `taggers`, which changes as people are
    // tagged — the economy pays a bonus for having STARTED as an infector.
    this.startingTaggers = new Set(this.taggers);

    // Team mode: shuffle, then deal alternately so the sides stay even even
    // when the lobby is smaller than the requested squad size.
    this.teams.clear();
    if (this.mode === MODES.TEAM) {
      this.teamSize = clamp(win.taggerCount, 1, MAX_TEAM_SIZE);
      const pool = playerIds.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      const cap = this.teamSize * 2;
      for (let i = 0; i < pool.length && i < cap; i++) this.teams.set(pool[i], i % 2);
      // Anyone beyond the squad cap still plays, balanced onto the smaller side.
      for (let i = cap; i < pool.length; i++) {
        let a = 0, b = 0;
        for (const t of this.teams.values()) { if (t === 0) a++; else b++; }
        this.teams.set(pool[i], a <= b ? 0 : 1);
      }
    }

    // Juggernaut: one player at random becomes the monster, nobody is out yet.
    this.eliminated.clear();
    this.juggernaut = null;
    if (this.mode === MODES.JUGGERNAUT && playerIds.length) {
      this.juggernaut = playerIds[Math.floor(Math.random() * playerIds.length)];
      this.juggernautHealth = juggernautHealthMultiplier(playerIds.length);
    }

    this.result = '';
    this.outcome = '';
    this._setPhase(PHASE.STARTING, CFG.rounds.startCountdown);
  }

  _finish(result, outcome) {
    this.result = result;
    this.outcome = outcome || '';
    this._setPhase(PHASE.ENDING, CFG.rounds.endTime);
  }

  /**
   * Drop straight into practice: ffa, playing, and no clock running.
   *
   * The timer is Infinity rather than a big number so nothing can quietly
   * expire during a long session — `timer -= dt` leaves it Infinity, so the
   * PLAYING case in update() never reaches its end-of-round branch.
   */
  enterPractice() {
    this.practice = true;
    this.mode = MODES.FFA;
    this.votes.clear();
    this.taggers.clear();
    this.eliminated.clear();
    this.juggernaut = null;
    this.result = '';
    this.outcome = '';
    this._setPhase(PHASE.PLAYING, Infinity);
  }

  /** Back to a normal lobby, for when a solo session becomes a real match. */
  leavePractice() {
    this.practice = false;
    this.votes.clear();
    this._setPhase(PHASE.VOTING, CFG.rounds.voteTime);
  }

  _setPhase(phase, timer) {
    this.phase = phase;
    this.timer = timer;
    if (this.onPhaseChange) this.onPhaseChange(phase, this);
    this.broadcast();
  }

  /**
   * Authority: apply a tag requested by a thrower.
   * @returns true if the tag landed
   */
  applyTag(victimId, byId) {
    if (!this.authority || !this.playing || !this.isTagMode) return false;
    if (!this.taggers.has(byId)) return false;      // only taggers can tag
    if (this.taggers.has(victimId)) return false;   // already it
    if (this.immunityFor(victimId) > 0) return false;

    this.taggers.add(victimId);
    if (this.mode === MODES.TAG) {
      // Straight swap: the thrower is released and cannot be tagged straight
      // back, which is what stops two players ping-ponging forever.
      this.taggers.delete(byId);
      this.immunity.set(byId, CFG.rounds.tagImmunity);
    }
    this.immunity.set(victimId, CFG.rounds.tagImmunity);

    if (this.onTag) this.onTag(victimId, byId, this.mode);
    this.broadcast();
    return true;
  }

  /**
   * Authority: a player has been knocked out of a juggernaut round.
   *
   * This is elimination, not death — the frog goes to spectate rather than
   * respawning. The win check itself lives in update(), so a knockout and a
   * timeout can never disagree about who won.
   *
   * @returns true if this actually put someone out
   */
  eliminate(victimId) {
    if (!this.authority || !this.playing) return false;
    // The two modes where being killed puts you out rather than respawning
    // you. In a prop hunt a found prop is out; a hunter cannot be put out
    // at all, which is what stops props killing their way to a win.
    if (this.isPropHunt) {
      if (!this.isProp(victimId)) return false;
    } else if (!this.isJuggernautMode) {
      return false;
    }
    if (this.eliminated.has(victimId)) return false;
    this.eliminated.add(victimId);
    if (this.onEliminate) this.onEliminate(victimId, victimId === this.juggernaut);
    this.broadcast();
    return true;
  }

  /** Drop a player who left, and keep the round valid. */
  removePlayer(id) {
    this.votes.delete(id);
    this.taggers.delete(id);
    this.immunity.delete(id);
    this.eliminated.delete(id);
    // A juggernaut who quits ends the round rather than leaving the rest
    // swinging at nothing.
    if (this.juggernaut === id && this.authority && this.playing) {
      this._finish('THE JUGGERNAUT FLED — frogs win!', 'survivors');
    }
    this._recount();
    /**
     * A prop hunt with nobody left to hunt, or nobody left hunting, is over.
     *
     * Checked here rather than left to `update` because both of those are
     * states the PLAYING branch cannot see: it asks how many props are left,
     * and a lobby that has lost its last hunter still has props in it. The
     * round would run its full four minutes with nothing happening.
     */
    if (this.isPropHunt && this.authority && this.playing) {
      const ids = Array.from(new Set([...this.taggers, ...this.votes.keys()]));
      if (this.taggers.size === 0) {
        this._finish('THE HUNTERS LEFT — props win!', 'survivors');
      } else if (ids.length && this.propsLeft(ids) === 0) {
        this._finish('EVERY PROP FOUND — hunters win!', 'taggers');
      }
    }
  }

  // --------------------------------------------------------- replication

  /** Compact state for the wire. */
  serialize() {
    return {
      t: 'round',
      p: this.phase,
      m: this.mode,
      tl: Math.round(this.timer * 10) / 10,
      tg: Array.from(this.taggers),
      tc: this.taggerCount,
      v: this.tally,
      r: this.result,
      o: this.outcome || '',
      sg: Array.from(this.startingTaggers || []),
      tm: Array.from(this.teams.entries()),
      ts: this.teamSize,
      tk: this.teamKills || [0, 0],
      jg: this.juggernaut || '',
      jh: this.juggernautHealth || 1,
      el: Array.from(this.eliminated),
      n: this.roundNumber,
      // Whether the mode is locked by a tournament. Mirrors never resolve a
      // vote, but they do decide whether to put the vote screen up — and a
      // guest watching a tournament must not see it flash either.
      f: this.forced ? 1 : 0,
    };
  }

  broadcast() {
    if (this.authority && this.onBroadcast) this.onBroadcast(this.serialize());
  }

  /** Mirror side: adopt the authority's state. */
  applyState(s) {
    if (this.authority) return;
    const phaseChanged = s.p !== this.phase;
    this.phase = s.p;
    this.mode = s.m;
    this.timer = s.tl;
    this.taggerCount = s.tc;
    this.result = s.r || '';
    this.outcome = s.o || '';
    this.startingTaggers = new Set(s.sg || []);
    this.teams = new Map(s.tm || []);
    this.teamSize = s.ts || 2;
    this.teamKills = s.tk || [0, 0];
    this.roundNumber = s.n || 0;
    this.tally = s.v || emptyTally();
    this.taggers = new Set(s.tg || []);
    this.juggernaut = s.jg || null;
    this.juggernautHealth = s.jh || 1;
    // UI only on this side — a mirror never resolves a vote. See `serialize`.
    this.forced = s.f ? { mode: s.m, taggerCount: s.tc } : null;

    // Fire onEliminate for anyone newly out, so mirrors get the same
    // announcement and spectator switch the authority already made.
    const wasOut = this.eliminated;
    this.eliminated = new Set(s.el || []);
    if (this.onEliminate) {
      for (const id of this.eliminated) {
        if (!wasOut.has(id)) this.onEliminate(id, id === this.juggernaut);
      }
    }
    if (phaseChanged && this.onPhaseChange) this.onPhaseChange(this.phase, this);
  }
}
