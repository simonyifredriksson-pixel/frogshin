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

import { CFG } from './config.js?v=v12';
import { clamp } from './util.js?v=v12';

export const MODES = { TAG: 'tag', INFECTION: 'infection', FFA: 'ffa' };

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
};

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
    this.tally = { tag: 0, infection: 0, ffa: 0 };
    this.result = '';
    this.roundNumber = 0;
    this._syncAccum = 0;

    // Set by the game so the manager can react without importing anything.
    this.onPhaseChange = null;
    this.onTag = null;              // (victimId, byId, mode) => void
  }

  // ------------------------------------------------------------- queries

  isTagger(id) { return this.taggers.has(id); }
  get isTagMode() { return this.mode === MODES.TAG || this.mode === MODES.INFECTION; }
  get playing() { return this.phase === PHASE.PLAYING; }
  /** Damage and deaths only matter in FFA. */
  get combatEnabled() { return this.mode === MODES.FFA; }
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
    const cap = maxTaggers(playerCount);
    this.votes.set(playerId, {
      mode,
      taggers: clamp(Math.round(taggerCount || 1), 1, cap),
    });
    this._recount();
    return true;
  }

  _recount() {
    this.tally = { tag: 0, infection: 0, ffa: 0 };
    for (const v of this.votes.values()) {
      if (this.tally[v.mode] !== undefined) this.tally[v.mode]++;
    }
  }

  /** Winning mode, plus the most popular tagger count among its voters. */
  _resolveVote(playerCount) {
    let bestMode = null;
    let bestVotes = -1;
    // Deterministic order so a tie always resolves the same way everywhere.
    for (const m of [MODES.TAG, MODES.INFECTION, MODES.FFA]) {
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
    return {
      mode: bestMode,
      taggerCount: clamp(bestCount, 1, maxTaggers(playerCount)),
    };
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
          this._finish(this._timeUpResult(playerIds));
        } else if (this.mode === MODES.INFECTION &&
                   playerIds.length > 1 &&
                   playerIds.every((id) => this.taggers.has(id))) {
          this._finish('EVERYONE INFECTED — taggers win!');
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

  _timeUpResult(playerIds) {
    if (this.mode === MODES.FFA) return 'TIME — check the scoreboard';
    const survivors = playerIds.filter((id) => !this.taggers.has(id)).length;
    if (this.mode === MODES.INFECTION) {
      return survivors > 0
        ? `${survivors} survivor${survivors === 1 ? '' : 's'} held out — survivors win!`
        : 'Taggers win!';
    }
    return 'TIME — the runners escaped!';
  }

  _beginVoting() {
    this.roundNumber++;
    this.votes.clear();
    this._recount();
    this.taggers.clear();
    this.immunity.clear();
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

    this.result = '';
    this._setPhase(PHASE.STARTING, CFG.rounds.startCountdown);
  }

  _finish(result) {
    this.result = result;
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

  /** Drop a player who left, and keep the round valid. */
  removePlayer(id) {
    this.votes.delete(id);
    this.taggers.delete(id);
    this.immunity.delete(id);
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
    this.roundNumber = s.n || 0;
    this.tally = s.v || { tag: 0, infection: 0, ffa: 0 };
    this.taggers = new Set(s.tg || []);
    if (phaseChanged && this.onPhaseChange) this.onPhaseChange(this.phase, this);
  }
}
