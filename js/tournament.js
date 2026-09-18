/**
 * ═══ TOURNAMENTS ═════════════════════════════════════════════════════════
 *
 * A hosted match with something real staked on it. The host picks a mode, a
 * size and a prize, pays for that prize UP FRONT, and the winners are paid
 * out of what was put up.
 *
 * ── the one rule everything else follows from ───────────────────────────
 * THE PRIZE IS ESCROWED. The host is debited the instant the tournament is
 * created, not when it is won. Paying at the end would mean a host who puts
 * up 10,000 and spends it before the final whistle simply mints 10,000 for
 * the winner out of nothing — the same froglets exist twice. Taking it at
 * the start makes it a transfer, which is the only way the total in the
 * world stays constant.
 *
 * A skin works the same way and is stricter about it: the host stops owning
 * it the moment the tournament opens. One skin, one holder, always.
 *
 * ── what this cannot do ────────────────────────────────────────────────
 * This is a peer-to-peer game with the wallet in each player's own browser,
 * and a developer menu that hands out froglets. Escrow makes the transfer
 * HONEST — it stops the ordinary case where a prize is conjured rather than
 * moved — but it is not, and cannot be, anti-cheat. There is no server to
 * be the referee. It is bookkeeping between people who are playing fairly.
 *
 * This module is deliberately pure: no DOM, no network, no economy. It
 * decides what a tournament costs and who is owed what, and the callers do
 * the spending and the telling.
 */

import { MODES } from './rounds.js?v=v156';

/** What is being played for. */
export const PRIZE = { FROGLETS: 'froglets', SKIN: 'skin' };

/**
 * How the prize is divided.
 *
 *   WINNER  one payout, to whoever finished top of the scoreboard.
 *   PODIUM  three payouts, first through third, each its own amount.
 *   TEAM    one payout EACH to every member of the winning team.
 */
export const SPLIT = { WINNER: 'winner', PODIUM: 'podium', TEAM: 'team' };

/** Tournament sizes on offer. Two is a duel; eight is a full room. */
export const SIZES = [2, 4, 6, 8];

/**
 * Modes a tournament can be run in.
 *
 * A tournament is scored on the scoreboard, so it needs a mode that ranks
 * players individually — which is FFA, and TEAM when the host wants sides.
 * Tag, Infection and Juggernaut all end in a verdict about a SIDE rather
 * than an order of finish, so there is no second or third place to pay.
 */
export const TOURNEY_MODES = [MODES.FFA, MODES.TEAM];

/** A fresh, valid, unconfigured tournament. */
export function blankTournament() {
  return {
    mode: MODES.FFA,
    size: 4,
    teams: false,
    prize: { kind: PRIZE.FROGLETS, amount: 5000, slot: null, id: null },
    split: SPLIT.WINNER,
    // First, second, third. Only read when `split` is PODIUM.
    podium: [5000, 2500, 1000],
  };
}

/** How many players are on each side, for a teams tournament. */
export function teamSize(cfg) {
  return Math.max(1, Math.floor((cfg.size || 2) / 2));
}

/**
 * ═══ WHAT THE HOST MUST PUT UP ═══════════════════════════════════════════
 *
 * Every froglet that can be paid out, totalled. This is the number that is
 * taken from the host at creation, so it has to cover the most expensive
 * outcome the settings allow — not the likeliest one.
 *
 * A TEAM split is the one that catches people out: "5,000 to each winner"
 * in a 3v3 is fifteen thousand froglets, not five.
 *
 * A skin costs no froglets. It costs the skin.
 */
export function escrowCost(cfg) {
  if (!cfg || cfg.prize.kind !== PRIZE.FROGLETS) return 0;
  if (cfg.split === SPLIT.PODIUM) {
    return (cfg.podium || []).reduce((a, n) => a + Math.max(0, Math.round(n) || 0), 0);
  }
  const amount = Math.max(0, Math.round(cfg.prize.amount) || 0);
  if (cfg.split === SPLIT.TEAM) return amount * teamSize(cfg);
  return amount;
}

/**
 * Is this tournament actually runnable, and if not, why not?
 *
 * Returns null when it is fine, or a sentence to put in front of the host.
 * Every rule here is one that would otherwise produce a tournament that
 * cannot pay out what it promised.
 */
export function validate(cfg, economy) {
  if (!cfg) return 'No tournament to start.';
  if (!TOURNEY_MODES.includes(cfg.mode)) {
    return 'A tournament needs a mode that ranks players — free-for-all or teams.';
  }
  if (!SIZES.includes(cfg.size)) return 'Pick how many players are taking part.';
  if (cfg.teams && cfg.size < 4) return 'Teams need at least four players.';
  if (cfg.teams && cfg.mode !== MODES.TEAM) {
    return 'Teams are played in the TEAM mode.';
  }

  if (cfg.prize.kind === PRIZE.SKIN) {
    if (!cfg.prize.id || !cfg.prize.slot) return 'Choose a skin to put up.';
    if (economy && !economy.owns(cfg.prize.slot, cfg.prize.id)) {
      return 'You no longer own that skin.';
    }
    /**
     * A SKIN CANNOT BE SPLIT. You are staking the one you own; there is no
     * way to hand a copy to second place, or to four members of a team,
     * without creating skins that did not exist. Froglets divide, a skin
     * does not.
     */
    if (cfg.split !== SPLIT.WINNER) {
      return 'A skin can only go to a single winner — there is only one of it.';
    }
    return null;
  }

  const cost = escrowCost(cfg);
  if (cost <= 0) return 'Set a prize worth winning.';
  if (economy && !economy.canAfford(cost)) {
    const short = (cost - economy.froglets).toLocaleString('en-GB');
    return `You need ${short} more froglets to put that up.`;
  }
  return null;
}

/**
 * ═══ WHO FINISHED WHERE ══════════════════════════════════════════════════
 *
 * Most kills first. Ties are broken by id, which is arbitrary but STABLE —
 * every machine in the room sorts the same list the same way, so the host's
 * placement and everybody else's agree without anybody having to ask.
 *
 * Deliberately not "who got there first": nothing in the game records when
 * a kill happened, and inventing an order that only the host can see would
 * make the result unverifiable by the people who lost.
 *
 * @param players [{ id, name, kills, team }]
 */
export function placements(players) {
  return (players || [])
    .slice()
    .sort((a, b) => (b.kills || 0) - (a.kills || 0)
      || String(a.id).localeCompare(String(b.id)));
}

/**
 * ═══ WHO IS OWED WHAT ════════════════════════════════════════════════════
 *
 * The single source of truth for paying a tournament out. Returns one entry
 * per person owed something:
 *
 *   { id, place, kind, amount }        froglets
 *   { id, place, kind, slot, itemId }  a skin
 *
 * Nobody with zero kills is ever paid. A tournament where nothing happened
 * has no winner, and the host gets the stake back rather than handing it to
 * whoever happens to sort first — see `refundable`.
 */
export function payouts(cfg, players) {
  const order = placements(players);
  const scored = order.filter((p) => (p.kills || 0) > 0);
  if (!cfg || !scored.length) return [];

  const skin = cfg.prize.kind === PRIZE.SKIN;
  const give = (p, place, amount) => (skin
    ? { id: p.id, place, kind: PRIZE.SKIN, slot: cfg.prize.slot, itemId: cfg.prize.id }
    : { id: p.id, place, kind: PRIZE.FROGLETS, amount });

  if (cfg.split === SPLIT.TEAM) {
    /**
     * The winning SIDE, not the winning player. Sides are ranked by their
     * combined kills, and everyone on the best one is paid the same amount
     * — which is why `escrowCost` multiplies by the team size.
     */
    const byTeam = new Map();
    for (const p of scored) {
      const t = p.team === undefined || p.team === null || p.team < 0 ? -1 : p.team;
      byTeam.set(t, (byTeam.get(t) || 0) + (p.kills || 0));
    }
    let best = null, bestKills = -1;
    for (const [t, k] of byTeam) {
      if (t < 0) continue;
      if (k > bestKills) { bestKills = k; best = t; }
    }
    if (best === null) return [];
    const amount = Math.max(0, Math.round(cfg.prize.amount) || 0);
    /**
     * CAPPED AT THE NUMBER THAT WAS PAID FOR.
     *
     * `escrowCost` stakes `amount x teamSize`, and teamSize comes from the
     * tournament's configured size — so if more players end up on the
     * winning side than the tournament was set up for, paying all of them
     * would hand out more than was ever put up. Froglets would be minted.
     *
     * The cap takes the highest scorers on the side, which is both within
     * budget and the fairest way to choose when there is not enough to go
     * round. `order` is already sorted by kills, so slicing is enough.
     */
    return order
      .filter((p) => p.team === best)
      .slice(0, teamSize(cfg))
      .map((p) => give(p, 1, amount));
  }

  if (cfg.split === SPLIT.PODIUM) {
    const pod = cfg.podium || [];
    const out = [];
    for (let i = 0; i < Math.min(3, scored.length); i++) {
      const amount = Math.max(0, Math.round(pod[i]) || 0);
      if (amount > 0) out.push(give(scored[i], i + 1, amount));
    }
    return out;
  }

  return [give(scored[0], 1, Math.max(0, Math.round(cfg.prize.amount) || 0))];
}

/**
 * What the host should get back, having put up `escrowCost` and paid out
 * `payouts`.
 *
 * Non-zero in two honest cases: nobody scored at all, and a podium that ran
 * with fewer players than it had places for. The stake covers the most that
 * could have been paid, so anything the result did not reach belongs back
 * with the person who staked it — otherwise a three-place tournament played
 * by two people quietly destroys the third prize.
 */
export function refundable(cfg, players) {
  if (!cfg || cfg.prize.kind !== PRIZE.FROGLETS) {
    // A skin nobody won goes back to its owner, whole.
    return payouts(cfg, players).length ? 0 : -1;
  }
  const paid = payouts(cfg, players)
    .reduce((a, p) => a + (p.amount || 0), 0);
  return Math.max(0, escrowCost(cfg) - paid);
}

/** A one-line summary of the prize, for the lobby and the setup screen. */
export function describePrize(cfg, skinName) {
  if (!cfg) return '';
  if (cfg.prize.kind === PRIZE.SKIN) {
    return `${skinName || 'A skin'} — to the winner`;
  }
  const n = (v) => Math.max(0, Math.round(v) || 0).toLocaleString('en-GB');
  if (cfg.split === SPLIT.PODIUM) {
    const p = cfg.podium || [];
    return `1st ${n(p[0])} · 2nd ${n(p[1])} · 3rd ${n(p[2])} froglets`;
  }
  if (cfg.split === SPLIT.TEAM) {
    return `${n(cfg.prize.amount)} froglets to each of ${teamSize(cfg)} winners`;
  }
  return `${n(cfg.prize.amount)} froglets — winner takes all`;
}
