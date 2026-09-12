/**
 * THE PROLOGUE — the last hour of a war the player is about to forget.
 *
 * This is the first thing anybody sees. It is not a tutorial, nobody is
 * kidnapped, and the player does not wake up in a ditch. They are standing at
 * the front of an army on an island above the clouds, with the strongest gear
 * in the game on their back, opposite the frog who took the country — and
 * they win, and then they lose anyway, and then they fall.
 *
 * Everything the rest of the game does with memory hangs off this scene. It
 * is played once, at the start, and then not referred to again for hours; the
 * flashbacks (js/flashbacks.js) hand it back to the player one piece at a
 * time, and the final fight puts them on this island again.
 *
 * ── the shape of it ──────────────────────────────────────────────────────
 *   open     six camera shots over the armies, and the conversation
 *   fight    ordinary gameplay. Frogath, at full strength, ~2m30
 *   kneel    he goes down. Time slows, the music thins, you walk over
 *   launch   he is not finished. One blow, and you leave the island
 *   fall     twenty seconds of sky, cloud, storm and lightning
 *   done     black, and then the Croaklands
 *
 * ── who owns the player ──────────────────────────────────────────────────
 * `holdsPlayer` is the contract with main.js: while it is true the prologue
 * is driving the body and the camera itself and the update loop must not run
 * the player's own controls. During `fight` it is false and the game is a
 * game. That one flag is the difference between a cutscene and a fight, and
 * it is the only difference — the same player, the same camera rig, the same
 * boss code.
 */

import * as THREE from '../lib/three.module.js?v=v124';
import { CFG } from './config.js?v=v124';
import { clamp, lerp, damp, smoothstep, dampAngle, lookYaw } from './util.js?v=v124';
import { Frogath } from './frogath.js?v=v124';
import { HEAVEN, VOID_Y } from './heaven.js?v=v124';
import { Audio } from './audio.js?v=v124';
import { Cine } from './cinema.js?v=v124';
import { PROLOGUE_THEME, FALL_THEME } from './themes.js?v=v124';

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

/**
 * HIS HEALTH, HERE ONLY.
 *
 * The number looks enormous next to the dungeon Frogath's 5200, and it has to
 * be: that one is fought by a frog with a stick, and this one is fought by
 * somebody carrying the best equipment in the game at three and a half times
 * a normal frog's damage. In the only terms that matter — how long the fight
 * LASTS — this is much the shorter of the two.
 *
 * Worked: a three-hit combo is about 3×22 base, times the 3.4 multiplier, so
 * roughly 225 a combo. He rests 2.6× longer than the dungeon Frogath between
 * patterns (see HERO_LOADOUT.rest), which leaves the player swinging most of
 * the fight — call it a combo every two and a half seconds. 10400 puts that
 * at about two minutes, which is the brief: a fight that takes a while and
 * that the player is never really in danger of losing.
 */
export const PROLOGUE_HEALTH = 10400;

/**
 * WHAT THE PLAYER IS CARRYING FOR THIS ONE FIGHT.
 *
 * The brief for the scene is that the player looks like somebody who has
 * spent an entire adventure preparing for this exact morning, so the gear is
 * not "good" — it is absurd, and it is meant to feel absurd. The armour in
 * particular: `armour` is the fraction of an incoming blow that actually
 * lands, so at 0.12 a hit from a god takes about a twentieth of the player's
 * health. Frogath can connect eight times and the player is still standing.
 *
 * That is the point. This is the one fight in the game the player is meant
 * to win, in a scene about how strong they used to be, and the fastest way
 * to say "you were unstoppable" is to let them BE unstoppable for two
 * minutes. None of it survives the fall — the Croaklands starts them in rags
 * with three hearts, which is what makes the rest of the game a game.
 */
export const HERO_LOADOUT = {
  damageMultiplier: 3.4,
  hearts: 14,                 // HEART is 20, so 280 health
  kunai: 40,
  /** Every kunai is a legendary one: they hit far harder than a found blade. */
  kunaiMultiplier: 3.0,
  /** Fraction of an incoming blow that gets through. Deliberately tiny. */
  armour: 0.12,
  /**
   * And how slowly he swings, here only.
   *
   * `rest` multiplies the gap between his attacks and `warn` multiplies every
   * telegraph. At these values his phase-one sword combo announces itself for
   * nearly two seconds and he waits three and a half between patterns, which
   * is a fight that takes a while and cannot really be lost. His actual
   * MOVES are untouched — the dungeon Frogath is exactly as brutal as he was.
   */
  rest: 2.6,
  warn: 2.4,
};

// ═════════════════════════════════════════════════════════════ the shots ══

/**
 * THE OPENING SHOTS.
 *
 * `from`/`to` are camera positions and `at`/`atTo` what it is looking at, all
 * interpolated with a smoothstep over `dur`. Written as data because a camera
 * move is the one thing in a game you tune twenty times, and doing it in
 * code means twenty edits in twenty places.
 *
 * The order is deliberate and it is the order a film would use: the world,
 * then the scale of it, then his army, then yours, then the two leaders, then
 * over the player's shoulder into the fight. Nobody is told the player is the
 * leader — shot four says it.
 */
const SHOTS = [
  // 1. The island, from off the edge of it. Establishes that this is the sky.
  { from: [-330, 96, -320], to: [-210, 62, -215], at: [0, 10, 0], dur: 7.0 },
  // 2. Down the avenue of columns, both armies in frame.
  { from: [0, 34, -250], to: [0, 20, -150], at: [0, 12, 40], atTo: [0, 8, 90], dur: 6.0 },
  // 3. His army: low, close, moving along the front rank.
  { from: [-64, 5, 96], to: [56, 5, 96], at: [-20, 8, 118], atTo: [30, 8, 118], dur: 6.0 },
  // 4. Yours — from behind them, over their heads, landing on the player.
  { from: [0, 30, -132], to: [0, 6.5, -52], at: [0, 4, -60], atTo: [0, 2.2, -39], dur: 6.5 },
  // 5. The two of them, side on, the whole field between them.
  { from: [82, 12, 0], to: [64, 9, 0], at: [0, 6, 0], dur: 5.5 },
  // 6. Over the player's shoulder at Frogath. This is the fight's own angle.
  { from: [0, 6.5, -52], to: [0, 5.2, -46], at: [0, 5, 39], dur: 4.5 },
];

// ══════════════════════════════════════════════════════════ the dialogue ══

/**
 * THE CONVERSATION BEFORE THE FIGHT.
 *
 * Frogath knows exactly who he is talking to. The player answers like
 * somebody who has said all of this before and is done saying it. Nothing
 * here explains the backstory — it is written to be re-read later, once the
 * flashbacks have told the player what "you promised them" means.
 */
function openingScript(P) {
  return [
    { act: () => P._cam(0), wait: 2.2 },
    { face: 'narrator', who: '', text: 'Above the clouds. The last morning of the war.' },
    { act: () => P._cam(1), wait: 0.6 },
    { face: 'narrator', who: '', text: 'Every frog still willing to fight is standing on this island.' },
    { act: () => P._cam(2), wait: 0.5 },
    { face: 'frogath', text: 'So. You came all this way after all.' },
    { face: 'frogath', text: 'Majesty.' },
    { face: 'frogath', text: 'I had a wager with myself that you would not. I am glad to have lost it.' },
    { act: () => P._cam(3), wait: 0.4 },
    { face: 'player', text: 'It ends today, Frogath.' },
    { face: 'frogath', text: 'It ends today. You have said that four times now.' },
    { face: 'frogath', text: 'At the ford. At the span. On the stair.' },
    { face: 'frogath', text: 'And once across a table, with a map on it, when we were on the same side.' },
    { face: 'player', text: 'We were never on the same side. Not once you went under the throne.' },
    { act: () => P._cam(4), wait: 0.5 },
    { face: 'frogath', text: 'Look behind you. Go on — look at them.' },
    { face: 'frogath', text: 'Seven kingdoms. Every banner you ever gave out.' },
    { face: 'frogath', text: 'I used to stand at the front of that. On your right.' },
    { face: 'player', text: 'You did.' },
    { face: 'frogath', text: 'And I would still be standing there if you had listened to me ONCE.' },
    { act: () => P._cam(5), wait: 0.4 },
    { face: 'frogath', text: 'You built an empire and then you could not hold it.' },
    { face: 'frogath', text: 'So I held it. That is all I have ever done.' },
    { face: 'player', text: 'You held it the way a fist holds water.' },
    { face: 'frogath', text: 'They are ALIVE. Every one of them is alive.' },
    { face: 'frogath', text: 'You would rather they were free than breathing.' },
    { face: 'player', text: 'I would rather they were both.' },
    { face: 'player', text: 'And I am not the Emperor who let it happen. Not any more.' },
    { face: 'frogath', text: '...Then come up here and prove it.' },
    { act: () => P._muster(), wait: 1.6 },
    { face: 'frogath', text: 'One of us goes off this island. Let us find out which.' },
  ];
}

/**
 * WHAT HE SAYS WHEN HE LOSES.
 *
 * Quiet, and short. He does not beg and he does not monologue — the whole
 * point of the beat is that he sounds like somebody who has run out of
 * arguments, right up until he stops sounding like that.
 */
function defeatScript(P) {
  return [
    { act: () => P._kneelShot(0), wait: 2.4 },
    { face: 'frogath', text: '...So you have finally done it.' },
    { act: () => P._walkIn(), wait: 0.8 },
    { face: 'player', text: 'It is over.' },
    { face: 'frogath', text: 'Over.' },
    { act: () => P._kneelShot(1), wait: 0.9 },
    { face: 'frogath', text: 'You never did understand what is under this country.' },
    { face: 'frogath', text: 'I only held the door. Somebody had to hold the door.' },
    { face: 'player', text: 'Then let go of it. I will carry it.' },
    { face: 'frogath', text: 'You. Carry it.' },
    { face: 'frogath', text: 'You are the one who told me to CONSIDER it, Majesty.' },
    { face: 'player', text: '...I know what I said.' },
    { face: 'player', text: 'And I have had four years to be sorry for it.' },
    { act: () => P._kneelShot(2), wait: 1.1 },
    { face: 'frogath', text: 'Four years.' },
    { face: 'frogath', text: 'It has had me for eleven.' },
    { face: 'frogath', text: 'No.' },
    { face: 'frogath', text: 'No — it has only begun.' },
    { act: () => P._betray(), wait: 0.1 },
  ];
}

/** And the two lines that land while the player is falling. */
function fallScript() {
  return [
    { face: 'frogath', text: 'Forget it, then. Forget all of it.' },
    { face: 'frogath', text: 'I will still be here when you remember.' },
  ];
}

// ═════════════════════════════════════════════════════════════ the banter ══

/**
 * FROGATH, TALKING WHILE HE FIGHTS.
 *
 * Every one of these goes out on the banter channel, which does not stop the
 * fight for a frame. They are keyed by what just happened rather than by a
 * timer, so what he says is a comment on the exchange the player just had —
 * that is the whole difference between a boss with dialogue and a boss with
 * a soundboard.
 *
 * `id` makes a line one-shot. A taunt heard twice is a taunt.
 */
const BANTER = {
  opened: [
    'Your stance has not changed in four years.',
    'Still that guard. Still the same shoulder.',
  ],
  hitPlayer: [
    'Slower than I remember.',
    'Is that truly all that is left of you?',
    'Your army is watching this.',
  ],
  playerHit: [
    '...Better.',
    'There. That is the frog I fought at the bridge.',
    'Good. Do that again.',
  ],
  dodged: [
    'Ah — you still read that one.',
    'Interesting.',
  ],
  ranged: [
    'You never could beat me from over there.',
    'Throw all forty. I will wait.',
  ],
  phase: {
    2: ['Enough of this. Enough playing.',
      'You have forced my hand once already. Do you remember how that ended?'],
    3: ['Why will you not stay down?',
      'You have taken everything from me once. Not twice.'],
    4: ['I will NOT lose to you again.',
      'Look at what you are making me do.'],
  },
  low: [
    'So this is how it goes.',
    'After everything we did together.',
  ],
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ═════════════════════════════════════════════════════════════ the director ══

export class Prologue {
  /**
   * @param opts scene, camera, effects, hud, player, followCam, level, onDone
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.player = opts.player;
    this.followCam = opts.followCam;
    this.level = opts.level;
    this.onDone = opts.onDone || (() => {});

    this.phase = 'idle';
    this.t = 0;
    /** Multiplied into dt by main.js — this is how the defeat beat slows. */
    this.timeScale = 1;
    this.shot = null;
    this.shotT = 0;
    /** Where the camera actually is, damped, so a shot cut is never a snap. */
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.boss = null;
    this._said = { hits: 0, taken: 0 };
    this._banterCool = 0;
    this.fall = null;
    this.flash = document.getElementById('storm-flash');
  }

  /** True while the prologue is driving the body and the camera. */
  get holdsPlayer() {
    return this.phase !== 'fight' && this.phase !== 'idle';
  }

  /** True once the whole thing is finished and main.js may move on. */
  get finished() { return this.phase === 'done'; }

  // -------------------------------------------------------------- beginning

  begin() {
    const p = this.player;
    // The strongest loadout in the game, for one fight only. See HERO_LOADOUT.
    p.damageMultiplier = HERO_LOADOUT.damageMultiplier;
    p.health.max = HERO_LOADOUT.hearts * 20;
    p.health.current = p.health.max;
    p.combatEnabled = true;
    p.inventory.setUnlimitedKunai(false);
    p.inventory.setKunai(HERO_LOADOUT.kunai);
    p.cinematic = true;
    p.spawn(HEAVEN.playerAt);
    p.pos.y = this.level.heightAt(HEAVEN.playerAt.x, HEAVEN.playerAt.z) + 0.4;
    /**
     * FACING HIM. Which is not yaw zero.
     *
     * A model's forward is (-sin y, 0, -cos y) — see `lookYaw` in util.js —
     * so yaw zero faces -Z. The player stands at -Z and Frogath at +Z, so
     * yaw zero pointed the player AWAY from him and the two leaders opened
     * the game back to back.
     */
    p.visualYaw = lookYaw(HEAVEN.playerAt.x, HEAVEN.playerAt.z,
      HEAVEN.frogathAt.x, HEAVEN.frogathAt.z);

    // Frogath, standing at the far end. Not descending from anywhere: he is
    // already here, in front of his own army, and has been all morning.
    const at = new THREE.Vector3(HEAVEN.frogathAt.x,
      this.level.heightAt(HEAVEN.frogathAt.x, HEAVEN.frogathAt.z),
      HEAVEN.frogathAt.z);
    this.boss = new Frogath(at, this.scene, this.effects, this.hud,
      this.followCam);
    this.boss.maxHealth = PROLOGUE_HEALTH;
    this.boss.health = PROLOGUE_HEALTH;
    // He swings at a fraction of the dungeon pace. See HERO_LOADOUT.
    this.boss.restScale = HERO_LOADOUT.rest;
    this.boss.warnScale = HERO_LOADOUT.warn;
    // Straight to standing-and-waiting: skip the dungeon's sky entrance.
    this.boss.pos.set(at.x, at.y + CFG.dungeon.frogath.hoverHeight, at.z);
    this.boss.rig.root.position.copy(this.boss.pos);
    this.boss.rig.root.visible = true;
    this.boss.state = 'stare';
    this.boss.t = -1e9;                  // never advances out of it on its own
    this.boss.began = true;
    // And he faces the player, by the same rule.
    this.boss.yaw = lookYaw(at.x, at.z, HEAVEN.playerAt.x, HEAVEN.playerAt.z);
    this.boss.rig.root.rotation.y = this.boss.yaw;

    this.phase = 'open';
    this.t = 0;
    this._cam(0);
    this.camPos.copy(this.camera.position);
    this.hud.show(false);
    Audio.setTheme(PROLOGUE_THEME, 'prologue');
    Cine.resetSaid();
    Cine.play(openingScript(this), {
      onEnd: () => this._startFight(),
    });
  }

  // ------------------------------------------------------------ the camera

  /** Cut to shot `i` of the opening. */
  _cam(i) {
    const s = SHOTS[i];
    if (!s) return;
    this.shot = s;
    this.shotT = 0;
    // First shot lands hard; every one after eases from where we were, so
    // the sequence reads as one continuous move rather than as six cuts.
    this._shotFrom = new THREE.Vector3().fromArray(s.from);
    this._shotTo = new THREE.Vector3().fromArray(s.to);
    this._lookFrom = new THREE.Vector3().fromArray(s.at);
    this._lookTo = new THREE.Vector3().fromArray(s.atTo || s.at);
    if (i === 0) {
      this.camPos.copy(this._shotFrom);
      this.camLook.copy(this._lookFrom);
    }
  }

  _runShot(dt) {
    if (!this.shot) return;
    this.shotT += dt;
    const k = smoothstep(clamp(this.shotT / this.shot.dur, 0, 1));
    _v.copy(this._shotFrom).lerp(this._shotTo, k);
    _look.copy(this._lookFrom).lerp(this._lookTo, k);
    // Damped rather than assigned: a cut to a new shot then becomes a fast
    // glide into it, which is what stops the sequence feeling like slides.
    this.camPos.x = damp(this.camPos.x, _v.x, 3.4, dt);
    this.camPos.y = damp(this.camPos.y, _v.y, 3.4, dt);
    this.camPos.z = damp(this.camPos.z, _v.z, 3.4, dt);
    this.camLook.x = damp(this.camLook.x, _look.x, 4.0, dt);
    this.camLook.y = damp(this.camLook.y, _look.y, 4.0, dt);
    this.camLook.z = damp(this.camLook.z, _look.z, 4.0, dt);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  /** Both armies raise their weapons and roar. The beat before the fight. */
  _muster() {
    this.followCam.shake(0.7);
    Audio.death(this.player.pos);
    for (let i = 0; i < 5; i++) {
      _v.set((Math.random() - 0.5) * 90, 3, (Math.random() - 0.5) * 200);
      this.effects.puff(_v, 0xffd76b, 10, 8);
    }
    this.hud.announce('THE LAST MORNING OF THE WAR', 'divine', false);
  }

  // -------------------------------------------------------------- the fight

  _startFight() {
    this.phase = 'fight';
    this.t = 0;
    const p = this.player;
    p.cinematic = false;
    // The camera rig takes over from behind the player, looking at Frogath.
    this.followCam.yaw = Math.PI;
    this.followCam.snapTo(p.pos);
    this.hud.show(true);
    this.hud.showBossBar(CFG.dungeon.frogath.name, 1,
      `${CFG.dungeon.frogath.title}   ·   THE HEAVENLY BATTLEFIELD`);
    // Straight into it: he has already had his conversation.
    this.boss.state = 'fight';
    this.boss.t = 0;
    this.boss.attackTimer = 1.4;
    Audio.setTheme(null);
    Audio.startBossMusic();
    Cine.say('frogath', pick(BANTER.opened), { id: 'opened', secs: 3.4 });
  }

  /** The player landed a hit. Called from main's hit path. */
  noteHit(dmg) {
    this._said.hits++;
    if (this._banterCool > 0) return;
    if (this._said.hits === 4) {
      this._banter('playerHit', 'playerHit1');
    } else if (this._said.hits === 22) {
      Cine.say('frogath', 'You are beginning to remember, are you not?',
        { id: 'remember', secs: 4.0 });
      this._banterCool = 7;
    }
  }

  /** The player took a hit. */
  noteHurt() {
    this._said.taken++;
    if (this._banterCool > 0) return;
    if (this._said.taken === 2 || this._said.taken === 7) {
      this._banter('hitPlayer', 'hitPlayer' + this._said.taken);
    }
  }

  /** A thrown blade was turned aside. */
  noteDeflect() { this._banter('ranged', 'ranged1'); }

  /**
   * THE WHOLE CONFRONTATION, FROM THE TOP.
   *
   * Called when the player goes down. Frogath goes back to full health in
   * phase one with his hazards cleared, the boss bar is rebuilt, and his
   * one-shot lines are forgotten so the second attempt does not play out in
   * silence. The conversation before the fight is NOT replayed — the player
   * has read it, and making them read it again to retry is how a scene
   * becomes a chore.
   */
  restartFight() {
    if (!this.boss) return;
    this.boss.resetFight();
    this._lastPhase = this.boss.phase;
    this._said.hits = 0;
    this._said.taken = 0;
    this._banterCool = 2.0;
    Cine.resetSaid();
    this.hud.showBossBar(CFG.dungeon.frogath.name, 1,
      `${CFG.dungeon.frogath.title}   ·   THE HEAVENLY BATTLEFIELD`);
    Audio.startBossMusic();
  }

  _banter(key, id) {
    const list = BANTER[key];
    if (!list) return;
    if (Cine.say('frogath', pick(list), { id, secs: 3.2 })) {
      this._banterCool = 5.5;
    }
  }

  /**
   * A phase change.
   *
   * Deliberately NOT a cutscene. The user asked for a short cinematic moment
   * and this is it: a shake, an announcement, and a line — while he is
   * already winding up the next attack. Stopping the fight to watch him
   * stand up would be the fifth time in two minutes the player lost control.
   */
  notePhase(n) {
    const lines = BANTER.phase[n];
    if (lines) {
      Cine.say('frogath', pick(lines), { id: 'phase' + n, secs: 4.2,
        priority: 2 });
    }
    Audio.bossPhase(n);
  }

  // -------------------------------------------------------------- he kneels

  _startKneel() {
    this.phase = 'kneel';
    this.t = 0;
    this.timeScale = 0.35;               // the battlefield slows down
    const p = this.player;
    p.cinematic = true;
    p.vel.set(0, 0, 0);
    this.hud.hideBossBar();
    this.hud.show(false);
    Cine.clearBanter();
    Audio.stopBossMusic();
    Audio.stopTheme();
    // The music does not stop dead — it thins out. One quiet held theme.
    Audio.setTheme(FALL_THEME, 'aftermath');
    // He comes down out of the air and stays down.
    this.boss.state = 'dead';
    this._kneelAt = this.boss.pos.clone();
    this._kneelAt.y = this.level.heightAt(this._kneelAt.x, this._kneelAt.z);
    this._walkFrom = p.pos.clone();
    this._walkTo = null;
    Cine.play(defeatScript(this), { onEnd: () => { /* _betray takes over */ } });
  }

  /** Three framings for the beat where he is on one knee. */
  _kneelShot(i) {
    const b = this.boss.pos;
    const p = this.player.pos;
    const a = Math.atan2(p.x - b.x, p.z - b.z);
    if (i === 0) {
      // Wide and low: him down, the player standing, both armies behind.
      this._setShot([b.x + Math.sin(a + 1.3) * 26, 7, b.z + Math.cos(a + 1.3) * 26],
        [b.x + Math.sin(a + 1.1) * 17, 4.5, b.z + Math.cos(a + 1.1) * 17],
        [b.x, 3.2, b.z], null, 6.0);
    } else if (i === 1) {
      // Close on him. His face, and his own army out of focus behind.
      this._setShot([b.x + Math.sin(a) * 11, 4.4, b.z + Math.cos(a) * 11],
        [b.x + Math.sin(a) * 8.4, 4.0, b.z + Math.cos(a) * 8.4],
        [b.x, 3.4, b.z], null, 7.0);
    } else {
      // Over his shoulder at the player walking in. The last safe frame.
      this._setShot([b.x - Math.sin(a) * 6, 5.4, b.z - Math.cos(a) * 6],
        [b.x - Math.sin(a) * 5, 5.0, b.z - Math.cos(a) * 5],
        [p.x, 2.4, p.z], null, 6.0);
    }
  }

  _setShot(from, to, at, atTo, dur) {
    this.shot = { dur };
    this.shotT = 0;
    this._shotFrom = new THREE.Vector3().fromArray(from);
    this._shotTo = new THREE.Vector3().fromArray(to);
    this._lookFrom = new THREE.Vector3().fromArray(at);
    this._lookTo = new THREE.Vector3().fromArray(atTo || at);
  }

  /** The player walks the last few paces towards him. */
  _walkIn() {
    const b = this.boss.pos, p = this.player.pos;
    const a = Math.atan2(p.x - b.x, p.z - b.z);
    this._walkFrom = p.clone();
    this._walkTo = new THREE.Vector3(b.x + Math.sin(a) * 5.4, 0,
      b.z + Math.cos(a) * 5.4);
    this._walkTo.y = this.level.heightAt(this._walkTo.x, this._walkTo.z);
    this._walkT = 0;
  }

  // -------------------------------------------------------------- the blow

  /**
   * HE IS NOT FINISHED.
   *
   * One upward blow, and the player leaves the island. Nothing of the impact
   * itself is shown and nothing needs to be: what sells it is the camera
   * going with them, the sound falling away, and the fact that a moment ago
   * the fight was won.
   */
  _betray() {
    this.phase = 'launch';
    this.t = 0;
    this.timeScale = 0.18;
    const p = this.player;
    const b = this.boss.pos;
    this.followCam.shake(1.6);
    // He comes up off his knee, and the blade comes up with him.
    this.boss.rig.root.rotation.z = 0;
    _v.copy(p.pos).y += 1.2;
    this.effects.hitBurst(_v, { x: 0, y: 1, z: 0 }, true);
    this.effects.ring(_v, 0.6, 22, 0.5, 0xfff3c4, false, { x: 0, y: 1, z: 0 });
    this.effects.puff(_v, 0xfff3c4, 40, 16);
    Audio.hit(p.pos, true);
    Audio.death(p.pos);
    // The launch itself: mostly up, and away from him.
    const away = new THREE.Vector3(p.pos.x - b.x, 0, p.pos.z - b.z);
    if (away.lengthSq() < 0.01) away.set(0, 0, -1);
    away.normalize();
    this.launchVel = new THREE.Vector3(away.x * 26, 78, away.z * 26);
    this._spin = new THREE.Vector3(2.4, 1.1, 3.2);
    this.hud.setFade(0, 0);
    Cine.cancel();
  }

  // --------------------------------------------------------------- the fall

  _startFall() {
    this.phase = 'fall';
    this.t = 0;
    this.timeScale = 1;
    this._buildFallLayers();
    Audio.stopTheme();
    Audio.setTheme(FALL_THEME, 'fall');
    Audio.setUnderwater(true);           // everything goes distant and muffled
    Cine.play(fallScript(), { bars: false });
  }

  /**
   * CLOUD TO FALL THROUGH.
   *
   * A tunnel of billboards that follows the player down and wraps: anything
   * that ends up above them is moved to the bottom of the stack. Ninety
   * quads, recycled forever, which is what lets the fall be twenty seconds
   * long and six thousand units deep without building six thousand units of
   * anything.
   */
  _buildFallLayers() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.55, 'rgba(226,238,250,0.5)');
      grad.addColorStop(1, 'rgba(210,228,244,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.7, depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    const N = 90;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    const items = [];
    for (let i = 0; i < N; i++) {
      items.push({
        a: Math.random() * Math.PI * 2,
        r: 12 + Math.random() * 170,
        y: -20 - Math.random() * 900,
        s: 40 + Math.random() * 190,
        spin: (Math.random() - 0.5) * 0.6,
      });
    }
    this.scene.add(mesh);
    this.fall = { mesh, items, tex, mat, geo, span: 900, bolts: [] };

    // Lightning: four long thin bright quads, hidden until they are wanted.
    const bmat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 4; i++) {
      const bgeo = new THREE.PlaneGeometry(2.2 + Math.random() * 3, 300);
      const m = new THREE.Mesh(bgeo, bmat.clone());
      m.visible = false;
      this.scene.add(m);
      this.fall.bolts.push({ mesh: m, life: 0 });
    }
  }

  /** One flash of the storm. */
  _lightning() {
    const f = this.fall;
    if (!f) return;
    const b = f.bolts[Math.floor(Math.random() * f.bolts.length)];
    const p = this.player.pos;
    const a = Math.random() * Math.PI * 2;
    const r = 40 + Math.random() * 120;
    b.mesh.position.set(p.x + Math.cos(a) * r, p.y + 40 + Math.random() * 120,
      p.z + Math.sin(a) * r);
    b.mesh.rotation.set(0, -a + Math.PI / 2, (Math.random() - 0.5) * 0.5);
    b.mesh.visible = true;
    b.life = 0.16 + Math.random() * 0.12;
    b.mesh.material.opacity = 0.9;
    if (this.flash) {
      this.flash.classList.add('show');
      setTimeout(() => { if (this.flash) this.flash.classList.remove('show'); }, 90);
    }
    Audio.tone({ freq: 62, to: 34, dur: 1.6, type: 'sawtooth', volume: 0.24 });
    Audio.noise({ dur: 1.4, volume: 0.2, filter: 900, filterTo: 90,
      type: 'lowpass' });
  }

  // ---------------------------------------------------------------- update

  /**
   * One frame.
   *
   * @param dt   already scaled by `timeScale` in main.js
   * @param input the real Input, for advancing dialogue
   * @param onHit damage sink for the boss's attacks
   */
  update(dt, input, onHit) {
    this.t += dt;
    if (this._banterCool > 0) this._banterCool -= dt;
    Cine.update(dt);
    if (Cine.busy) Cine.keys(input);

    switch (this.phase) {
      case 'open': this._updateOpen(dt); break;
      case 'fight': this._updateFight(dt, onHit); break;
      case 'kneel': this._updateKneel(dt); break;
      case 'launch': this._updateLaunch(dt); break;
      case 'fall': this._updateFall(dt); break;
      default: break;
    }
  }

  _updateOpen(dt) {
    this._runShot(dt);
    // He breathes and his aura turns over even while nobody is fighting.
    this.boss.bob += dt;
    this.boss._animate(dt, this.player);
    const p = this.player;
    p.model.root.position.copy(p.pos);
    p.model.setFacing(p.visualYaw);
    p.model.update(dt, { speed: 0, moving: false, grounded: true });
  }

  _updateFight(dt, onHit) {
    const b = this.boss;
    if (!b) return;
    if (b.justDied) {
      b.justDied = false;
      this._startKneel();
      return;
    }
    b.update(dt, this.player, this.camera, onHit);
    if (b.alive) this.hud.setBossBar(b.fraction);
    // Phase lines: read off his own phase number rather than being pushed,
    // so a phase he enters from any source still gets its line.
    if (b.phase !== this._lastPhase) {
      if (this._lastPhase !== undefined) this.notePhase(b.phase);
      this._lastPhase = b.phase;
    }
    // The very low health lines.
    if (b.fraction < 0.10) {
      Cine.say('frogath', pick(BANTER.low), { id: 'low', secs: 4.0 });
    }
  }

  _updateKneel(dt) {
    this._runShot(dt);
    // He sinks onto one knee over the first second and a half, and stays.
    const b = this.boss;
    const k = clamp(this.t / 1.5, 0, 1);
    b.pos.y = lerp(b.pos.y, this._kneelAt.y + 1.6, k * 0.12);
    b.rig.root.position.copy(b.pos);
    b.rig.root.rotation.z = lerp(0, 0.34, smoothstep(k));
    b.rig.root.rotation.x = lerp(0, 0.16, smoothstep(k));
    b.yaw = dampAngle(b.yaw,
      Math.atan2(this.player.pos.x - b.pos.x, this.player.pos.z - b.pos.z)
      + Math.PI, 2.0, dt);
    b.rig.root.rotation.y = b.yaw;

    // The player's walk in, if `_walkIn` has been called.
    const p = this.player;
    if (this._walkTo) {
      this._walkT = Math.min(1, (this._walkT || 0) + dt * 0.42);
      const e = smoothstep(this._walkT);
      p.pos.lerpVectors(this._walkFrom, this._walkTo, e);
      p.pos.y = this.level.heightAt(p.pos.x, p.pos.z) + 0.4;
      p.visualYaw = Math.atan2(-(b.pos.x - p.pos.x), -(b.pos.z - p.pos.z));
      p.model.update(dt, { speed: this._walkT < 1 ? 1.6 : 0,
        moving: this._walkT < 1, grounded: true });
    } else {
      p.model.update(dt, { speed: 0, moving: false, grounded: true });
    }
    p.model.root.position.copy(p.pos);
    p.model.setFacing(p.visualYaw);
  }

  /**
   * The blow itself, in slow motion, and then time comes back.
   *
   * The player is moved by hand rather than by the physics: they are leaving
   * the island, and the collision world would very reasonably stop them.
   */
  _updateLaunch(dt) {
    const p = this.player;
    // Real seconds, so the slow motion is a slow LOOK at a fast event.
    p.pos.addScaledVector(this.launchVel, dt);
    this.launchVel.y -= 26 * dt;
    p.model.root.position.copy(p.pos);
    p.model.root.rotation.x += this._spin.x * dt;
    p.model.root.rotation.z += this._spin.z * dt;
    p.model.update(dt, { speed: 0, moving: false, grounded: false, dead: true });

    // The camera stays low on the island and lets them go, then swings after.
    const k = clamp(this.t / 2.2, 0, 1);
    const b = this.boss.pos;
    _v.set(b.x + 8, b.y + 5, b.z - 12);
    this.camera.position.lerp(_v, 1 - Math.pow(0.001, dt));
    _look.copy(p.pos);
    this.camera.lookAt(_look);
    // Time comes back up as the player clears the island.
    this.timeScale = lerp(0.18, 1.0, smoothstep(k));
    if (this.t > 2.4) this._startFall();
  }

  /**
   * TWENTY SECONDS OF SKY.
   *
   * Down through the island's own cloud sea, then the storm, then the world.
   * The island is not moved or faked: it is genuinely up there, getting
   * smaller, which is the one thing that cannot be faked convincingly.
   */
  _updateFall(dt) {
    const p = this.player;
    const T = this.t;
    // Terminal velocity, reached over the first three seconds.
    const speed = lerp(60, 165, smoothstep(clamp(T / 3, 0, 1)));
    p.pos.y -= speed * dt;
    p.pos.x += Math.sin(T * 0.7) * 6 * dt;
    p.pos.z += Math.cos(T * 0.5) * 6 * dt;
    p.model.root.position.copy(p.pos);
    // The tumble slows into a long straight fall: they stop fighting it.
    const settle = 1 - smoothstep(clamp((T - 2) / 5, 0, 1));
    p.model.root.rotation.x += this._spin.x * settle * dt;
    p.model.root.rotation.z += this._spin.z * settle * dt;
    p.model.update(dt, { speed: 0, moving: false, grounded: false, dead: true });

    // The camera falls with them, a little above and behind, looking down
    // past them at the world coming up.
    _v.set(p.pos.x + Math.sin(T * 0.35) * 9, p.pos.y + 7 + Math.sin(T) * 1.4,
      p.pos.z + 11 + Math.cos(T * 0.3) * 5);
    this.camera.position.lerp(_v, 1 - Math.pow(0.02, dt));
    _look.copy(p.pos);
    _look.y -= 6 + T * 2;                // tips down towards the ground
    this.camera.lookAt(_look);

    // The cloud tunnel, wrapped so it never runs out.
    const f = this.fall;
    if (f) {
      for (let i = 0; i < f.items.length; i++) {
        const it = f.items[i];
        if (it.y > p.pos.y + 60) it.y -= f.span;
        it.a += it.spin * dt;
        _v.set(p.pos.x + Math.cos(it.a) * it.r, it.y,
          p.pos.z + Math.sin(it.a) * it.r);
        const m = new THREE.Matrix4();
        m.makeScale(it.s, it.s * 0.5, 1);
        m.setPosition(_v);
        f.mesh.setMatrixAt(i, m);
      }
      f.mesh.instanceMatrix.needsUpdate = true;
      for (const b of f.bolts) {
        if (b.life > 0) {
          b.life -= dt;
          b.mesh.material.opacity = Math.max(0, b.life * 5);
          if (b.life <= 0) b.mesh.visible = false;
        }
      }
    }
    // The storm: nothing for the first five seconds, then it gets angry.
    if (T > 5.5 && Math.random() < dt * (T > 9 ? 1.6 : 0.7)) this._lightning();

    // The world below arrives. Fade to black on the way into it rather than
    // showing an impact: nothing about this needs to be shown.
    if (T > 16.5 && !this._faded) {
      this._faded = true;
      this.hud.setFade(1, 2.4);
      Audio.stopTheme();
      Audio.setUnderwater(false);
      Cine.cancel();
    }
    if (T > 19.4 && this.phase !== 'done') {
      this.phase = 'done';
      this.onDone();
    }
  }

  dispose() {
    Cine.cancel();
    if (this.boss) this.boss.dispose();
    this.boss = null;
    const f = this.fall;
    if (f) {
      this.scene.remove(f.mesh);
      f.geo.dispose(); f.mat.dispose(); f.tex.dispose();
      for (const b of f.bolts) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
      }
    }
    this.fall = null;
    Audio.setUnderwater(false);
    if (this.flash) this.flash.classList.remove('show');
  }
}
