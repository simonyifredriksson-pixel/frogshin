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

import { CFG } from './config.js?v=v46';
import { clamp } from './util.js?v=v46';

export const MODES = {
  TAG: 'tag', INFECTION: 'infection', FFA: 'ffa', TEAM: 'team',
  JUGGERNAUT: 'juggernaut',
};

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
    this.tally = { tag: 0, infection: 0, ffa: 0, team: 0, juggernaut: 0 };
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
  get playing() { return this.phase === PHASE.PLAYING; }
  /** Damage and deaths matter in the shooting modes, not the chases. */
  get combatEnabled() {
    return this.mode === MODES.FFA || this.mode === MODES.TEAM
      || this.mode === MODES.JUGGERNAUT;
  }

  isJuggernaut(id) { return this.isJuggernautMode && this.juggernaut === id; }

  /**
   * Knocked out and watching. Only juggernaut mode eliminates anyone — in
   * Tag being caught makes you a tagger, which is a role change, not an exit.
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
    this.tally = { tag: 0, infection: 0, ffa: 0, team: 0, juggernaut: 0 };
    for (const v of this.votes.values()) {
      if (this.tally[v.mode] !== undefined) this.tally[v.mode]++;
    }
  }

  /** Winning mode, plus the most popular tagger count among its voters. */
  _resolveVote(playerCount) {
    let bestMode = null;
    let bestVotes = -1;
    // Deterministic order so a tie always resolves the same way everywhere.
    for (const m of [MODES.TAG, MODES.INFECTION, MODES.FFA, MODES.TEAM,
      MODES.JUGGERNAUT]) {
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
    if (this.mode === MODES.FFA) {
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
    this._setPhase(PHASE.VOTING, CFG.rounds.voteTime);
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
    if (!this.authority || !this.playing || !this.isJuggernautMode) return false;
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
    this.tally = s.v || { tag: 0, infection: 0, ffa: 0, team: 0, juggernaut: 0 };
    this.taggers = new Set(s.tg || []);
    this.juggernaut = s.jg || null;
    this.juggernautHealth = s.jh || 1;

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
