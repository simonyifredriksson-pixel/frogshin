/**
 * THE END OF THE GAME, IN TWO PARTS.
 *
 * Frogath goes down on the marble of the Ascended Throne, and then:
 *
 *   1. THE CORONATION. The screen cuts to a castle hall with two hundred
 *      frogs standing in it, you on one knee at the end of a red carpet,
 *      and somebody puts a crown on your head. Staged like a flashback —
 *      built geometry a mile above the world, five camera shots, dialogue
 *      over the top — because that machinery already exists and works. The
 *      tableau itself is `_coronation` in js/memoryscene.js.
 *
 *   2. THE WALK. The cutscene ends and the player is standing on a REAL red
 *      carpet in the real arena, a hundred and twenty metres of it running
 *      out through the broken side of the colonnade. They walk it. They
 *      cannot dash, they cannot grapple and they cannot sprint. When they
 *      reach the far end they get all three back and the game is theirs.
 *
 * ── why the walk is a walk ───────────────────────────────────────────────
 * Because it is the only thing in the game that asks the player to do
 * nothing quickly, and putting it immediately after the hardest fight is
 * the entire point: the last ninety seconds of FROGSHIN is a frog in a
 * crown walking slowly past statues of an army, and it would be worth
 * nothing at all if you could dash it in four seconds.
 *
 * The lock is one flag — `player.solemn` — and it takes away exactly three
 * things. Jumping, looking, swinging and the whole camera still work, so it
 * never feels like the controller has been unplugged; it feels like you
 * have been asked to behave yourself.
 *
 * ── and it cannot get stuck ──────────────────────────────────────────────
 * Three ways out, because a state that takes the player's abilities away is
 * the worst possible place for a bug: reaching the end of the carpet,
 * wandering more than sixty units off it, or ninety seconds elapsing. Any
 * of them ends the walk and gives everything back. There is no arrangement
 * of inputs that leaves a player permanently unable to dash.
 */

import { Cine } from './cinema.js?v=v109';
/**
 * THE MUSIC IT PLAYS UNDER, and it comes from js/themes.js like all of it.
 *
 * It was hand-written here, as `{ bpm, wave, bass: [...], lead: [...],
 * swell }` — an object of entirely the wrong shape, invented rather than
 * looked up. `audio.js` wants a root, a scale, chords, a motif, five voice
 * levels and four waveforms; it read `T.pad`, got `undefined`, multiplied
 * it, and handed `NaN` to an `AudioParam`, which throws.
 *
 * It threw inside `Flashbacks.scene` after the wash was up and the camera
 * taken and before the dialogue started, so the last scene in the game
 * locked solid on a white screen. Music now lives where music lives.
 */
import { CORONATION_THEME } from './themes.js?v=v109';

/**
 * THE SCRIPT.
 *
 * Twelve beats, and the shape of it matters more than the words: nobody in
 * the room knows what to call you, so they use every title in turn and none
 * of them fits, and the only line that lands is the last one — a stranger in
 * the crowd using your actual name, which the player has spent the whole
 * game recovering and has never once heard said out loud by anybody else.
 *
 * The `act` beats are the choreography. `next` cuts to the following camera
 * shot; `crown` starts the crown's descent. Both are handed in by the
 * caller so this table stays data.
 */
export function coronationScript(stage, opts = {}) {
  const cut = () => { if (stage) stage.next(); };
  const crown = () => { if (stage) stage.cue('crown'); };
  const name = opts.name || 'the Emperor';
  return [
    { wait: 2.6 },
    { face: 'narrator', who: '', text: 'The doors of the Croakhollow keep have not been opened in sixty years. They are open now, and the hall behind them is full.' },
    { face: 'elder', who: 'THE CHAMBERLAIN', text: 'Make way. Make way for — ' },
    { wait: 0.6, act: cut },
    { face: 'elder', who: 'THE CHAMBERLAIN', text: '...for whoever this is.' },
    { face: 'soldier', who: 'A GUARD', text: 'That is the one who came out of the Wakewood. In the dark. On foot.' },
    { face: 'soldier', who: 'ANOTHER GUARD', text: 'That is the one who went up the Ashen Throne alone.' },
    { wait: 0.5, act: cut },
    { face: 'elder', who: 'THE CHAMBERLAIN', text: 'Kneel, then. I have no idea what to call you and it does not seem to matter.' },
    { face: 'player', text: 'It never did.' },
    { wait: 0.8, act: cut },
    { face: 'elder', who: 'THE CHAMBERLAIN', text: 'This was found on the field where the sky came down. Nobody has been able to wear it.' },
    { wait: 0.4, act: crown },
    { face: 'narrator', who: '', text: 'It fits.' },
    { wait: 1.4 },
    { face: 'memory', who: 'A VOICE IN THE CROWD', text: `...${name}. That is ${name}.` },
    { wait: 1.0, act: cut },
    { face: 'narrator', who: '', text: 'Two hundred frogs say it back to you at once, and you find that you knew it all along.' },
    { wait: 2.2 },
  ];
}

/** The three ways the walk can end, so the caller can say which happened. */
export const WALK_END = { ARRIVED: 'arrived', LEFT: 'left', TIMEOUT: 'timeout' };

/**
 * THE PROCESSION.
 *
 * Owns nothing but a flag on the player and a couple of numbers. Built by
 * the overworld when the coronation's dialogue finishes and dropped the
 * moment the walk is over.
 */
export class CarpetWalk {
  /**
   * @param opts {
   *   player, hud,
   *   from, to      the two ends of the carpet, in world space
   *   onEnd(why)    called exactly once
   * }
   */
  constructor(opts) {
    this.player = opts.player;
    this.hud = opts.hud || null;
    this.from = opts.from;
    this.to = opts.to;
    this.onEnd = opts.onEnd || (() => {});
    this.t = 0;
    this.done = false;
    /** How far along, 0 to 1. Painted as an objective so it reads as a task. */
    this.progress = 0;
    this.length = Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z);
    /**
     * TAKE THE THREE THINGS AWAY.
     *
     * And release a grapple that is already out: the fight that just ended
     * is one the player very likely finished mid-swing, and a tongue still
     * attached to a pillar would drag them off the carpet on the first
     * frame of their own coronation.
     */
    const p = this.player;
    p.solemn = true;
    p.sprinting = false;
    if (p.grapple && p.grapple.active) p.grapple.release();
    if (this.hud) {
      this.hud.setObjectives([{
        id: 'carpet', text: 'Walk the carpet', done: false, active: true,
      }]);
      this.hud.toast('Walk. There is no hurry, and nothing left to run from.',
        7);
    }
  }

  /**
   * @returns true while the walk is still going
   */
  update(dt, player) {
    if (this.done) return false;
    this.t += dt;
    const p = player || this.player;
    // Keep the lock asserted every frame. Anything else in the game that
    // clears player flags — a death, a mode change — would otherwise hand
    // the abilities back silently in the middle of the procession.
    p.solemn = true;

    const dx = p.pos.x - this.from.x, dz = p.pos.z - this.from.z;
    const tx = this.to.x - this.from.x, tz = this.to.z - this.from.z;
    /**
     * How far down the carpet, as a projection onto it rather than as a
     * distance from either end. A player who steps two metres to the side
     * has not gone backwards, and a straight distance-to-the-end test
     * would say they had.
     */
    const along = (dx * tx + dz * tz) / (this.length * this.length);
    this.progress = Math.max(0, Math.min(1, along));
    // And how far OFF it, for the bail-out.
    const off = Math.abs(dx * tz - dz * tx) / this.length;

    if (this.hud) {
      this.hud.setObjectives([{
        id: 'carpet',
        text: `Walk the carpet — ${Math.round(this.progress * 100)}%`,
        done: false, active: true,
      }]);
    }

    if (this.progress >= 0.985) return this._finish(WALK_END.ARRIVED);
    /**
     * The two safety valves. Sixty units off the carpet means the player
     * has decided to go somewhere else, and ninety seconds means something
     * has gone wrong that nobody should have to diagnose from inside it.
     * Both give everything back.
     */
    if (off > 60 || along < -1.2) return this._finish(WALK_END.LEFT);
    if (this.t > 90) return this._finish(WALK_END.TIMEOUT);
    return true;
  }

  _finish(why) {
    this.done = true;
    this.player.solemn = false;
    if (this.hud) {
      this.hud.setObjectives([]);
      if (why === WALK_END.ARRIVED) {
        this.hud.announce('LONG MAY YOU REIGN', 'divine', true);
        this.hud.toast('Your dash, your tongue and your legs are your own '
          + 'again. So is the country.', 9);
      } else {
        this.hud.toast('The procession breaks up. Everything is yours '
          + 'again.', 6);
      }
    }
    if (why === WALK_END.ARRIVED) {
      Cine.say('narrator', 'They are still cheering behind you.',
        { id: 'crown-done', secs: 5.0 });
    }
    this.onEnd(why);
    return false;
  }

  /** Abandon it — leaving the mode, loading a save. Gives the abilities back. */
  cancel() {
    if (this.done) return;
    this.done = true;
    this.player.solemn = false;
    if (this.hud) this.hud.setObjectives([]);
  }
}

export { CORONATION_THEME };
