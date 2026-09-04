/**
 * The Dungeon: a fifteen-room gauntlet, played solo.
 *
 * Two ways to run it, chosen before you start and fixed for the run:
 *
 *   CHECKPOINTS — dying returns you to the start of the room you were in.
 *                 The intended way to learn the fights.
 *   NO CHECKPOINTS — dying sends you back to room one. Everything you learned
 *                 you keep; everything you cleared, you clear again.
 *
 * The run itself is a small state machine: walk into a room, the door seals,
 * fight, the door opens, walk on. Room fifteen is Frogath, who gets his own
 * entrance and his own file.
 */

import * as THREE from '../lib/three.module.js?v=v53';
import { CFG } from './config.js?v=v53';
import { clamp } from './util.js?v=v53';
import { DungeonLevel } from './dungeonlevel.js?v=v53';
import { DungeonBoss } from './dungeonboss.js?v=v53';
import { Frogath } from './frogath.js?v=v53';
import { Audio } from './audio.js?v=v53';

const _v = new THREE.Vector3();

export const RUN_STATE = {
  ENTERING: 'entering',   // walking in; the boss has not woken yet
  FIGHT: 'fight',
  CLEARED: 'cleared',     // boss down, door open
  DEAD: 'dead',
  ASCEND: 'ascend',       // the no-checkpoint ending: he rises and breaks
  WON: 'won',
};

export class DungeonRun {
  constructor(opts) {
    this.scene = opts.scene;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.camera = opts.camera;
    this.followCam = opts.followCam;
    this.checkpoints = !!opts.checkpoints;

    this.level = null;
    this.room = 0;
    this.deepest = 0;
    this.boss = null;
    this.frogath = null;
    this.state = RUN_STATE.ENTERING;
    this.deaths = 0;
    // Counted separately: it is what unlocks skipping his entrance.
    this.frogathDeaths = 0;
    // Set by the game: fired once, when Frogath falls.
    this.onVictory = null;
    // Fired when the crystal is picked up (no-checkpoint runs only).
    this.onCrystal = null;
    this.crystal = null;
    this._exploded = false;
    this.timer = 0;
    this.runTime = 0;
    this._sealed = false;
  }

  buildTasks() {
    const level = new DungeonLevel(this.scene);
    this.level = level;
    return level.buildTasks();
  }

  get collision() { return this.level.collision; }

  /**
   * Below this you have left the dungeon entirely.
   *
   * The rooms are a chain of discs floating in nothing, so a gap anywhere
   * along the run drops you forever. Rather than trying to prove every seam
   * in fifteen rooms is sealed, anything under the floor is simply out of
   * the world — see Game._voidGuard.
   */
  get voidY() { return this.level.origin.y - CFG.move.voidDepth; }
  get isFinalRoom() { return this.room === CFG.dungeon.rooms - 1; }

  /** Where the player starts a room. */
  spawnFor(room) {
    if (room === CFG.dungeon.rooms - 1 && this.level.throne) {
      return this.level.throne.entry.clone();
    }
    return this.level.rooms[room].entry.clone();
  }

  get spawnPoint() { return this.spawnFor(this.room); }

  // ----------------------------------------------------------------- flow

  /** Begin the run (or restart it after a no-checkpoint death). */
  start(player, room = 0) {
    this.room = room;
    this.deepest = Math.max(this.deepest, room);
    this._enterRoom(player);
  }

  /**
   * Developer menu: drop straight into any room.
   *
   * Goes through the same _enterRoom the normal flow uses, so a jumped-to
   * room is set up identically to one you walked into — same doors, same
   * boss, same objective. A shortcut that built a slightly different room
   * would be worse than useless for testing.
   */
  jumpToRoom(room, player) {
    const n = clamp(Math.round(room), 0, CFG.dungeon.rooms - 1);
    this.room = n;
    this.deepest = Math.max(this.deepest, n);
    this._enterRoom(player);
  }

  /** Developer menu: drop whatever is in the room. */
  killBoss() {
    if (this.state !== RUN_STATE.FIGHT) return false;
    if (this.frogath) { this.frogath.takeDamage(this.frogath.health); return true; }
    if (this.boss) { this.boss.takeDamage(this.boss.health); return true; }
    return false;
  }

  _enterRoom(player) {
    this._clearBoss();
    // Every door opens, then this room's shut once the fight starts. Doing
    // it wholesale means a reset can never leave a stale barrier behind.
    this.level.openAllDoors();
    this.state = RUN_STATE.ENTERING;
    this.timer = 0;
    this._announcedOpen = false;

    player.pos.copy(this.spawnFor(this.room));
    player.vel.set(0, 0, 0);
    player.health.revive();
    player.stamina.reset();
    this.followCam.snapTo(player.pos);

    this.hud.hideBossBar();
    this.hud.setObjectives([{
      id: 'room',
      text: this.isFinalRoom
        ? 'The throne — FROGATH'
        : `Room ${this.room + 1} of ${CFG.dungeon.rooms}`,
      done: false,
      active: true,
    }]);

    if (this.isFinalRoom) {
      // Silence. The arena is empty and the sky has not opened yet.
      Audio.stopBossMusic();
      Audio.stopAmbient();
      this.frogath = new Frogath(
        this.level.throne.center, this.scene, this.effects, this.hud,
        this.followCam);
      this.hud.announce('', '', false);
    } else {
      const r = this.level.rooms[this.room];
      this.boss = new DungeonBoss(
        this.room, r.bossSpot, this.scene, this.effects, this.collision);
      this.hud.toast(
        `Room ${this.room + 1} — ${this.boss.name}`, 3.5);
      Audio.startAmbient();
    }
  }

  _clearBoss() {
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    if (this.frogath) { this.frogath.dispose(); this.frogath = null; }
    this._sealed = false;
  }

  // --------------------------------------------------------------- update

  /**
   * @param onHit    (damage, sourcePos) => void — applies damage to the player
   * @param skipHeld is the skip key down this frame
   */
  update(dt, player, onHit, skipHeld) {
    this.level.update(dt);
    this.runTime += dt;

    // Skipping Frogath's entrance, once he has earned the right to be skipped.
    // Clearing the prompt has to happen OUTSIDE the entrance test: the moment
    // the entrance ends this block stops running, so a clear nested inside it
    // never fires and the prompt is stranded on screen for the whole fight.
    const showSkip = !!this.frogath && this.frogath.inEntrance
      && this.frogath.skippable;
    if (showSkip) {
      const p = this.frogath.updateSkip(dt, !!skipHeld);
      this.hud.setTutorial('HOLD', 'SPACE',
        p > 0 ? `SKIPPING… ${Math.round(p * 100)}%` : 'TO SKIP');
    }
    if (this._skipPrompt && !showSkip) this.hud.setTutorial(null);
    this._skipPrompt = showSkip;

    switch (this.state) {
      case RUN_STATE.ENTERING: this._updateEntering(dt, player); break;
      case RUN_STATE.FIGHT: this._updateFight(dt, player, onHit); break;
      case RUN_STATE.CLEARED: this._updateCleared(dt, player); break;
      case RUN_STATE.DEAD: this._updateDead(dt, player); break;
      case RUN_STATE.ASCEND: this._updateAscend(dt, player); break;
      case RUN_STATE.WON: this._updateWon(dt); break;
      default: break;
    }
  }

  /** Walk far enough in and the fight starts. */
  _updateEntering(dt, player) {
    const center = this.isFinalRoom
      ? this.level.throne.center : this.level.rooms[this.room].center;
    const d = Math.hypot(player.pos.x - center.x, player.pos.z - center.z);
    const trigger = this.isFinalRoom ? 26 : 20;
    if (d > trigger) return;

    this.state = RUN_STATE.FIGHT;
    this.timer = 0;
    // The doors shut. You fight what is in front of you.
    this.level.setDoors(this.room, true);
    this.hud.toast('The doors seal behind you', 2.2);
    if (this.frogath) {
      // The entrance takes over the camera; the player is a spectator to it.
      player.cinematic = true;
      player.vel.set(0, 0, 0);
      this.hud.setCinematic(true);
      // Skippable only once he has actually killed you — the speech earns its
      // first showing, and after that it is in your way.
      this.frogath.begin(this.frogathDeaths > 0);
    } else {
      this.boss.begin();
      this.hud.showBossBar(this.boss.name, 1);
      Audio.startBossMusic();
    }
  }

  _updateFight(dt, player, onHit) {
    if (this.frogath) {
      this.frogath.update(dt, player, this.camera, onHit);
      // Control returns to the player the moment he says "Begin."
      if (this.frogath.fighting && player.cinematic) {
        player.cinematic = false;
        this.hud.setCinematic(false);
      }
      this.hud.setBossBar(this.frogath.fraction);
      if (this.frogath.justDied) {
        this.frogath.justDied = false;
        this._onFrogathDown(player);
      }
    } else {
      this.boss.update(dt, player, onHit);
      this.hud.setBossBar(this.boss.fraction);
      // Ground waves are the one attack with an answer other than running.
      // Said once, the first time one is ever wound up, and then never again.
      if (this.boss.windingGroundWave && !this._taughtJump) {
        this._taughtJump = true;
        this.hud.toast('AMBER RING — jump it', 3.5);
      }
      if (this.boss.justDied) {
        this.boss.justDied = false;
        this._onBossDown(player);
      }
    }

    if (player.health.dead) this._onPlayerDown(player);
  }

  _onBossDown(player) {
    this.state = RUN_STATE.CLEARED;
    this.timer = 0;
    // The way on opens and lights up; the way back stays shut.
    this.level.openExit(this.room);
    this.hud.hideBossBar();
    this.hud.announce('GUARDIAN DOWN', 'good');
    Audio.stopBossMusic();
    Audio.refreshed(player.pos);
    // Clearing a room patches you up — otherwise a no-checkpoint run is
    // decided by chip damage from three rooms ago rather than by the fight
    // in front of you.
    player.health.revive();
    player.stamina.reset();
  }

  _onFrogathDown(player) {
    this.state = RUN_STATE.WON;
    this.timer = 0;
    this.level.setDoors(this.room, false);
    this.hud.hideBossBar();
    this.hud.setCinematic(false);
    this.hud.setSubtitle('');
    this.hud.announce('FROGATH HAS FALLEN', 'good', true);
    this.hud.setObjectives([{
      id: 'done', text: 'The dungeon is beaten', done: true, active: false,
    }]);
    Audio.stopBossMusic();
    Audio.respawn(player.pos);
    _v.copy(this.level.throne.center);
    this.effects.ring(_v, 1, 70, 2.5, 0xfff3c4, true);
    this.followCam.shake(2.0);

    // His look, and nothing else. The skin is the trophy; none of what made
    // him hard comes with it.
    if (this.onVictory) this.onVictory(!this.checkpoints);
    // Beaten without checkpoints, he does not simply die.
    if (!this.checkpoints) {
      this.state = RUN_STATE.ASCEND;
      this.timer = 0;
      this.hud.clearAnnounce();
    }
  }

  /**
   * The no-checkpoint ending: he rises, comes apart, and leaves something
   * behind. Only on a clean run — the crystal has to mean the hard way.
   */
  _updateAscend(dt, player) {
    this.timer += dt;
    const b = this.frogath;
    if (!b) { this.state = RUN_STATE.WON; return; }
    const c = this.level.throne.center;

    if (this.timer < 4.0) {
      // Rising, faster and brighter.
      const k = this.timer / 4.0;
      b.pos.set(c.x, c.y + 8 + k * k * 46, c.z);
      b.rig.root.position.copy(b.pos);
      b.auraFlash = 1 + k * 3;
      this.followCam.shake(0.2 + k * 0.9);
      if (Math.random() < 0.9) {
        _v.set(b.pos.x + (Math.random() - 0.5) * 20, b.pos.y + (Math.random() - 0.5) * 16,
          b.pos.z + (Math.random() - 0.5) * 20);
        this.effects.puff(_v, 0xfff3c4, 4, 5);
      }
      if (this.timer % 0.4 < dt) this.effects.ring(c, 4, 60, 1.2, 0xffd76b, true);
      return;
    }

    if (!this._exploded) {
      this._exploded = true;
      _v.copy(b.pos);
      this.effects.puff(_v, 0xffffff, 90, 34);
      this.effects.ring(_v, 1, 90, 1.2, 0xffffff, false, { x: 0, y: 1, z: 0 });
      this.effects.ring(c, 1, 110, 1.4, 0xfff3c4, true);
      this.hud.setFade(1, 0.12);
      this.followCam.shake(2.4);
      Audio.headshot(b.pos);
      Audio.death(b.pos);
      b.rig.root.visible = false;
      // What is left of him.
      this.crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.5, 0),
        new THREE.MeshBasicMaterial({ color: 0xfff3c4 })
      );
      this.crystal.position.set(c.x, c.y + 2.2, c.z);
      this.scene.add(this.crystal);
      this.hud.announce('', '', false);
    }
    if (this.timer > 4.2 && this.timer < 4.35) this.hud.setFade(0, 0.7);

    // The crystal turns and waits to be picked up.
    if (this.crystal) {
      this.crystal.rotation.y += dt * 1.6;
      this.crystal.rotation.x += dt * 0.7;
      this.crystal.position.y = c.y + 2.2 + Math.sin(this.timer * 2) * 0.3;
      if (Math.random() < dt * 30) {
        _v.copy(this.crystal.position);
        this.effects.puff(_v, 0xfff3c4, 2, 2);
      }
      if (player.pos.distanceTo(this.crystal.position) < 4) {
        this.scene.remove(this.crystal);
        this.crystal.geometry.dispose();
        this.crystal.material.dispose();
        this.crystal = null;
        this.effects.puff(player.pos, 0xffffff, 30, 10);
        Audio.pickup(player.pos);
        this.hud.announce('YOU TAKE THE LIGHT', 'good', true);
        this.hud.toast(
          'Carry it to the stone frog in the arena.', 12);
        if (this.onCrystal) this.onCrystal();
        this.state = RUN_STATE.WON;
        this.timer = 0;
      }
    }
    if (this.timer > 6 && this.timer < 6.1) {
      this.hud.announce('TAKE IT', 'good', true);
    }
  }

  /**
   * After the god falls. The arena stays open — the run is over, and how
   * long you stand in it is your business.
   */
  _updateWon(dt) {
    this.timer += dt;
    if (this._wonToast || this.timer < 5) return;
    this._wonToast = true;
    this.hud.clearAnnounce();
    const mins = Math.floor(this.runTime / 60);
    const secs = Math.floor(this.runTime % 60);
    this.hud.toast(
      `Fifteen rooms, ${this.deaths} death${this.deaths === 1 ? '' : 's'}, `
      + `${mins}m ${secs}s. Press ESC to leave.`, 12);
  }

  _onPlayerDown(player) {
    if (this.state === RUN_STATE.DEAD) return;
    this.state = RUN_STATE.DEAD;
    this.timer = 2.6;
    this.deaths++;
    if (this.frogath) this.frogathDeaths++;
    this.hud.hideBossBar();
    this.hud.setCinematic(false);
    this.hud.setSubtitle('');
    this.hud.announce(
      this.checkpoints ? 'YOU DIED' : 'YOU DIED — BACK TO THE FIRST ROOM',
      'danger', true);
    Audio.stopBossMusic();
  }

  _updateCleared(dt, player) {
    this.timer += dt;
    if (this.timer < 1.6) return;
    // Guarded so the message fires once, not on every frame of the window.
    if (!this._announcedOpen) {
      this._announcedOpen = true;
      this.hud.clearAnnounce();
      this.hud.toast('The way on is open', 3);
    }
    // Walking out of the room advances the run.
    const r = this.level.rooms[this.room];
    if (r && player.pos.x > r.exit.x) {
      this.room++;
      this.deepest = Math.max(this.deepest, this.room);
      this._announcedOpen = false;
      this._enterRoom(player);
    }
  }

  _updateDead(dt, player) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.hud.clearAnnounce();
    // Checkpoints restart the room; without them the whole run resets.
    this.start(player, this.checkpoints ? this.room : 0);
  }

  // --------------------------------------------------------------- damage

  /** Route a player's katana or kunai hit into whichever boss is up. */
  damageBoss(amount) {
    if (this.state !== RUN_STATE.FIGHT) return;
    if (this.frogath) this.frogath.takeDamage(amount);
    else if (this.boss) this.boss.takeDamage(amount);
  }

  /** The boss as a hittable target, for the shared combat/kunai code. */
  bossTarget() {
    if (this.state !== RUN_STATE.FIGHT) return null;
    if (this.frogath) {
      if (!this.frogath.fighting) return null;
      return {
        id: 'frogath', pos: this.frogath.pos, dead: false, isDummy: false,
        hitbox: {
          bodyOffset: 3.0, bodyRadius: 5.0,
          headOffset: 8.0, headRadius: 2.6,
          // He floats. Without this the katana's vertical slice would put him
          // permanently out of reach and the fight would be kunai-only.
          vertical: 14,
        },
        onHit: (dmg) => this.frogath.takeDamage(dmg),
      };
    }
    if (!this.boss || !this.boss.alive) return null;
    const s = this.boss.scaleFactor;
    return {
      id: 'guardian', pos: this.boss.pos, dead: false, isDummy: false,
      hitbox: {
        bodyOffset: 2.0 * s, bodyRadius: 2.0 * s,
        headOffset: 3.6 * s, headRadius: 1.1 * s,
        vertical: 4.5 * s,
      },
      onHit: (dmg) => this.boss.takeDamage(dmg),
    };
  }

  dispose() {
    this._clearBoss();
    if (this.level) this.level.dispose();
    this.hud.hideBossBar();
    this.hud.setObjectives(null);
    this.hud.setSubtitle('');
    this.hud.setCinematic(false);
  }
}
