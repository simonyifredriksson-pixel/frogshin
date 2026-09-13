/**
 * ═══ THE RULES BEHIND EARTH SHELL, TONGUE TRAP AND LIGHTNING STEP ════════
 *
 * Decisions only. Nothing in here touches the scene, the network, the HUD or
 * the player object — it takes positions and plain target records and says
 * what should happen. The moving parts live in js/player.js; what counts as
 * a legal target, a perfect release or a valid next link lives here, where it
 * can be checked without a browser.
 *
 * That split is what the tournament module bought us and it is worth having
 * again: these three abilities are almost entirely *rules*, and rules that
 * can only be exercised by playing the game are rules that do not get
 * exercised.
 *
 * ── the target shape ──────────────────────────────────────────────────────
 * Every function here takes targets in the one shape combat already uses
 * (see `Overworld.targets`):
 *
 *     { id, pos: {x,y,z}, dead, isDummy, hitbox: { bodyOffset, ... } }
 *
 * so a remote player, a dummy, a camp mob, a guardian and a boss are all
 * legal targets without any of them being special-cased.
 */

/** Squared distance, because almost nothing here needs the square root. */
function d2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Where a strike should land on a target — its middle, not its feet. */
export function aimPoint(t, out) {
  const off = (t.hitbox && t.hitbox.bodyOffset) || 1.0;
  out = out || {};
  out.x = t.pos.x; out.y = t.pos.y + off; out.z = t.pos.z;
  return out;
}

/**
 * Is this worth pointing an ability at?
 *
 * `hostile` is supplied by the caller because only the game knows about
 * teams, and `los` because only the collision world knows about walls.
 * Both default to "yes", which is what a solo practice session wants.
 */
export function targetable(t, opts) {
  if (!t || t.dead) return false;
  if (!t.hitbox) return false;
  /**
   * Scenery says so for itself.
   *
   * The `targets()` list is not only creatures: the ropes holding up the
   * spare beams at the broken crossings go through it too, so that a kunai
   * and a katana both reach them by the one path. A katana cutting a rope
   * is the point of that; a tongue dragging one across the map, or a
   * lightning chain using two of them as stepping stones, is not.
   *
   * An explicit opt-out rather than a guess from the geometry — a rope and
   * a small mob are the same size, and inferring "is this a person" from a
   * hitbox radius would be wrong the first time either one changed.
   */
  if (t.noAbility) return false;
  const o = opts || {};
  if (o.hostile && !o.hostile(t)) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════ earth shell

export const SHELL = { RAISED: 'raised', PERFECT: 'perfect', DUD: 'dud' };

/**
 * Is the shell in a window where letting go bursts it?
 *
 * Two windows count, and they exist for different reasons — see the comment
 * on `CFG.abilities.earthshell`. `struck` is the time left on the window a
 * blocked blow opened; `left` is the time left on the shell itself.
 *
 * @param shell { left, struck }
 * @param A     CFG.abilities.earthshell
 */
export function shellPerfect(shell, A) {
  if (!shell || shell.left <= 0) return false;
  if (shell.struck > 0) return true;
  return shell.left <= A.lateWindow;
}

/**
 * What a release right now is worth.
 *
 * Split out from `shellPerfect` so the caller does not have to know that a
 * shell which has already lapsed is a dud rather than an error.
 */
export function shellRelease(shell, A) {
  if (!shell || shell.left <= 0) return SHELL.DUD;
  return shellPerfect(shell, A) ? SHELL.PERFECT : SHELL.DUD;
}

/**
 * Everyone the burst throws off, with the direction to throw them.
 *
 * Radial, not a cone: the shell bursts in every direction at once, so
 * standing behind someone who used it is no safer than standing in front.
 * The only thing that matters is how close you were.
 */
export function shellBurst(origin, targets, A, opts) {
  const out = [];
  if (!targets) return out;
  const r2 = A.radius * A.radius;
  for (const t of targets) {
    if (!targetable(t, opts)) continue;
    if (d2(t.pos, origin) > r2) continue;
    let dx = t.pos.x - origin.x, dz = t.pos.z - origin.z;
    const len = Math.hypot(dx, dz);
    /**
     * Someone standing exactly on top of you has no direction to be thrown
     * in, and normalising a zero vector would send them to NaN and out of
     * the world. They get thrown the way you are about to launch instead.
     */
    if (len < 1e-4) { dx = 0; dz = -1; } else { dx /= len; dz /= len; }
    out.push({ target: t, dirX: dx, dirZ: dz, dist: len });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════ tongue trap

/**
 * Who the tongue catches: the best target inside the cone you are facing.
 *
 * "Best" is the smallest angle off your aim, not the nearest — at this range
 * the nearest is often not the one you are looking at, and an ability that
 * grabs someone other than the frog under your crosshair feels broken even
 * when it is behaving exactly as written.
 *
 * @param opts { hostile, los, immune }  all optional
 */
export function pickTongueTarget(origin, yaw, targets, A, opts) {
  if (!targets || !targets.length) return null;
  const o = opts || {};
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const maxDist2 = A.range * A.range;
  const minDot = Math.cos(A.arc);

  let best = null, bestDot = -2;
  for (const t of targets) {
    if (!targetable(t, o)) continue;
    if (o.immune && o.immune(t)) continue;
    const dx = t.pos.x - origin.x, dz = t.pos.z - origin.z;
    const flat2 = dx * dx + dz * dz;
    if (flat2 > maxDist2 || flat2 < 1e-6) continue;
    const len = Math.sqrt(flat2);
    const dot = (dx / len) * fx + (dz / len) * fz;
    if (dot < minDot) continue;
    if (o.los && !o.los(origin, t)) continue;
    if (dot > bestDot) { bestDot = dot; best = t; }
  }
  return best;
}

/**
 * Where a caught target should be dragged to.
 *
 * Onto the line between you and them, `pullTo` out — so the drag always ends
 * at the end of your blade no matter how far away it started. Returned as a
 * point rather than an impulse because an impulse cannot promise that.
 */
export function tonguePullPoint(origin, target, A) {
  const dx = target.pos.x - origin.x, dz = target.pos.z - origin.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return { x: origin.x, y: target.pos.y, z: origin.z + A.pullTo };
  return {
    x: origin.x + (dx / len) * A.pullTo,
    y: target.pos.y,
    z: origin.z + (dz / len) * A.pullTo,
  };
}

// ══════════════════════════════════════════════════════ lightning step

/**
 * The next place to step to, or null if the chain is over.
 *
 * Preference order is deliberate:
 *   1. what you are actually aiming at, if it is legal
 *   2. otherwise the nearest legal target
 *
 * because the manual press is sold as *choosing* the next target. If it
 * silently took the nearest one regardless of aim, the skill in the ability
 * would be button timing alone and the direction you were facing would be
 * decoration.
 *
 * @param from    where the step starts
 * @param aimYaw  where the player is looking, or null for "nearest"
 * @param used    Set of target ids already hit — nothing is hit twice
 */
/**
 * Everything a step could legally go to from here.
 *
 * Shared by the chooser below and by the targeting markers, so the marks
 * the player sees and the options the ability will actually accept are the
 * same list. Two separate passes would eventually disagree, and a marker
 * over somebody you cannot reach is worse than no marker.
 */
export function stepCandidates(from, targets, range, used, opts) {
  const out = [];
  if (!targets || !targets.length) return out;
  const o = opts || {};
  const r2 = range * range;
  const seen = used || new Set();
  for (const t of targets) {
    if (!targetable(t, o)) continue;
    if (seen.has(t.id)) continue;
    const dx = t.pos.x - from.x, dz = t.pos.z - from.z;
    const flat2 = dx * dx + dz * dz;
    if (flat2 > r2) continue;
    if (o.los && !o.los(from, t)) continue;
    out.push({ t, flat2, dx, dz });
  }
  return out;
}

export function nextStepTarget(from, aimYaw, targets, range, used, opts) {
  const legal = stepCandidates(from, targets, range, used, opts);
  if (!legal.length) return null;
  const o = opts || {};

  if (aimYaw !== null && aimYaw !== undefined) {
    const fx = -Math.sin(aimYaw), fz = -Math.cos(aimYaw);
    let best = null, bestDot = -2;
    for (const c of legal) {
      const len = Math.sqrt(c.flat2) || 1;
      const dot = (c.dx / len) * fx + (c.dz / len) * fz;
      if (dot > bestDot) { bestDot = dot; best = c; }
    }
    /**
     * Only honour the aim if the player is actually looking that way. Past
     * a right angle they are facing away from every option, which means
     * they are not choosing — so fall through to the nearest rather than
     * flinging them at whatever happened to be least behind them.
     */
    if (best && bestDot > 0) return best.t;
  }

  let near = legal[0];
  for (const c of legal) if (c.flat2 < near.flat2) near = c;
  return near.t;
}

/**
 * Where to stand when you step to a target.
 *
 * Not on top of them — just outside their body, on the side you arrived
 * from, facing them. Landing inside a target would push you back out through
 * collision on the next frame and the strike would come from a place you
 * never stood.
 */
export function stepStandPoint(from, target, gap) {
  const dx = from.x - target.pos.x, dz = from.z - target.pos.z;
  const len = Math.hypot(dx, dz);
  const r = ((target.hitbox && target.hitbox.bodyRadius) || 0.6) + (gap || 1.4);
  if (len < 1e-4) return { x: target.pos.x, y: target.pos.y, z: target.pos.z + r };
  return {
    x: target.pos.x + (dx / len) * r,
    y: target.pos.y,
    z: target.pos.z + (dz / len) * r,
  };
}

/**
 * ═══ THE BOSS GETS POINTS, NOT REPEATS ═══════════════════════════════════
 *
 * A boss is a single target, so the ordinary chain would find nothing to go
 * on to after the first step and the ability would be one dash. Letting it
 * repeat on the same target instead would be four free hits from outside its
 * reach, which is the "instant win" this is written to avoid.
 *
 * So the boss offers standing points around itself and the chain runs
 * between THOSE. You still get four strikes, you still choose the order, and
 * between every one of them you are on the floor beside it at a known
 * distance where it can hit back.
 *
 * The ring is rotated by `phase` so it is not the same four spots every
 * cast, and the points are returned as ordinary targets — same shape as
 * everything else — so the chain code needs no idea that a boss is involved.
 */
export function bossAnchors(boss, A, phase) {
  const out = [];
  const n = Math.max(1, A.bossPoints | 0);
  const start = phase || 0;
  /**
   * The ring has to clear the boss itself.
   *
   * A flat 7.5 puts every point INSIDE the Ascended, whose body radius is
   * 7 — you would step to four places within arm's reach of each other and
   * all of them inside the model. Scaled off the target's own girth, the
   * ring is always a ring around it whatever the boss's size.
   */
  const girth = (boss.hitbox && boss.hitbox.bodyRadius) || 0;
  const r = Math.max(A.bossRadius, girth * 1.35);
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2;
    out.push({
      id: `${boss.id}#${i}`,
      anchorOf: boss,
      pos: {
        x: boss.pos.x + Math.cos(a) * r,
        y: boss.pos.y,
        z: boss.pos.z + Math.sin(a) * r,
      },
      dead: false,
      isDummy: false,
      // Small, so `stepStandPoint` puts you on the point rather than well
      // off it — the point IS where you are meant to stand.
      hitbox: { bodyOffset: 1.0, bodyRadius: 0.1 },
    });
  }
  return out;
}

/**
 * Does this target want the anchor treatment?
 *
 * Anything big enough that four points around it are further apart than a
 * body's width. Driven off the hitbox rather than a list of boss ids, so a
 * boss added later is handled without anybody remembering to come back here.
 */
export function wantsAnchors(t) {
  return !!(t && t.hitbox && (t.hitbox.bodyRadius || 0) >= 1.8);
}

/**
 * Everything a cast of Lightning Step needs to know before it commits.
 *
 * Returns null when there is nothing to step to, which is the caller's cue
 * to refuse the cast outright — no cooldown, no flash, no sound. An ability
 * that fires into empty air and eats twelve seconds for it is a bug the
 * player experiences as one even when it is written down as intended.
 */
export function planLightningStep(origin, yaw, targets, A, opts) {
  const o = opts || {};
  const first = nextStepTarget(origin, yaw, targets, A.range, null, o);
  if (!first) return null;

  if (wantsAnchors(first)) {
    return {
      boss: first,
      pool: bossAnchors(first, A, o.phase || 0),
      maxSteps: A.maxTargets,
    };
  }
  return { boss: null, pool: null, maxSteps: A.maxTargets };
}
