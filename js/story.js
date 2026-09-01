/**
 * Story mode: "The Burning of the Swamp Village".
 *
 * Flow: ESCAPE (follow the boardwalk) -> CUTSCENE (Toadel notices you and
 * speaks) -> BOSS (an unwinnable-by-design duel).
 *
 * The fight is intentionally lopsided. You carry a broken sword that does a
 * third of its normal damage, Toadel has an enormous pool of health, and any
 * blow he lands takes 80% of yours — so two connect and you are finished.
 * Parrying is the only real defence, and it punishes greed: absorb a second
 * blow inside one parry and you are knocked flat long enough to be hit.
 *
 * Authority model matches the rest of the game: the host runs Toadel's AI
 * and broadcasts his state; every client independently checks whether his
 * swing landed on *them*, so nobody needs a per-player hit message.
 */

import * as THREE from '../lib/three.module.js?v=v31';
import { CFG } from './config.js?v=v31';
import { clamp, damp, dampAngle, angleDelta, lerp } from './util.js?v=v31';
import {
  ToadModel, VillageScene, PatrolGuard, VillagerToad, GuideFrog,
} from './npc.js?v=v31';
import { FrogModel } from './frog.js?v=v31';
import { StoryLevel, PATH_LENGTH, ARENA_Z, ARENA_RADIUS } from './storylevel.js?v=v31';
import { Audio } from './audio.js?v=v31';
import { ITEMS } from './items.js?v=v31';

export const STORY_PHASE = {
  ESCAPE: 'escape',
  CUTSCENE: 'cutscene',
  BOSS: 'boss',
  DEFEAT: 'defeat',
  PRISON: 'prison',
  // --- the village chapter, after the castle ---
  VILLAGE_CUT1: 'villageCut1',   // the frog in the bush calls you over
  VILLAGE_WALK: 'villageWalk',   // make your way to him
  VILLAGE_CUT2: 'villageCut2',   // a villager spots you; the soldiers turn
  VILLAGE_CHASE: 'villageChase', // fifteen guards, one gap in the fence
  VILLAGE_DONE: 'villageDone',
};

/**
 * Scripted tutorial beats during the duel. Each waits for the player to
 * actually perform the action before moving on, and the two that follow a
 * landed blow drop into slow motion so there is time to read the prompt.
 */
const TUT = {
  IDLE: 0,        // before the first blow
  DASH: 1,        // slow-mo: teach the dash
  ATTACK: 2,      // teach attacking
  WAIT_HIT: 3,    // wait for his next blow
  PARRY: 4,       // slow-mo: teach the parry
  DONE: 5,
};

// Defeat sequence timings, in seconds.
const FALL_TIME = 1.6;
const FADE_OUT = 2.0;
const BLACK_TIME = 2.0;
const FADE_IN = 2.2;

/**
 * Numeric code for the network. Players only become visible to one another
 * once BOTH have reached the cell, so each broadcasts how far along it is.
 */
export const STORY_PHASE_CODE = {
  [STORY_PHASE.ESCAPE]: 0,
  [STORY_PHASE.CUTSCENE]: 1,
  [STORY_PHASE.BOSS]: 2,
  [STORY_PHASE.DEFEAT]: 3,
  [STORY_PHASE.PRISON]: 4,
  [STORY_PHASE.VILLAGE_CUT1]: 5,
  [STORY_PHASE.VILLAGE_WALK]: 6,
  [STORY_PHASE.VILLAGE_CUT2]: 7,
  [STORY_PHASE.VILLAGE_CHASE]: 8,
  [STORY_PHASE.VILLAGE_DONE]: 9,
};
/** At or past this code means "has woken up in the castle". */
export const PRISON_CODE = 4;

const TOADEL_LINE =
  '“Another villager? How unfortunate. You should have stayed in your ' +
  'little house and waited for the flames to reach you.”';

/** Every spoken line in the village chapter, in the order it is heard. */
const VILLAGE_LINES = {
  hey: '“Hey! What do you think you are doing?”',
  comeHere: '“Come here, quick!”',
  spotted: '“Hey, look! It’s a frog!”',
  followMe: '“Follow me, quickly!”',
};
const GUIDE_NAME = 'A FROG IN THE BUSH';
const VILLAGER_NAME = 'TOAD VILLAGER';

const _v = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();

export class StoryMode {
  constructor(opts) {
    this.scene = opts.scene;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.camera = opts.camera;
    this.followCam = opts.followCam;
    this.authority = opts.authority;
    this.onBroadcast = opts.onBroadcast;    // (msg) => void

    this.level = null;
    this.phase = STORY_PHASE.ESCAPE;
    this.time = 0;
    this.actors = [];
    this.soldiers = [];
    this.fireEmitTimer = 0;
    this._syncAccum = 0;

    // Objectives shown top-left. `done` drives the strike-through.
    this.objectives = [
      { id: 'escape', text: 'Escape the village', done: false, active: true },
    ];

    this.boss = null;
    this.cutscene = null;
    this.shake = 0;

    // --- village chapter ---
    this.villagers = null;
    this.villageGuards = [];
    this.guide = null;
    this.accuser = null;
    this.watchers = [];
    this._villageDown = 0;

    // Slow motion multiplier applied to gameplay (never to the UI).
    this.timeScale = 1;
    this.tutorial = TUT.IDLE;
    this.tutorialTimer = 0;
    this.defeat = null;
  }

  /** True while the tutorial is holding the player's hand — no real damage. */
  get inTutorial() { return this.tutorial !== TUT.DONE; }

  // ---------------------------------------------------------------- build

  buildTasks() {
    const level = new StoryLevel(this.scene);
    this.level = level;
    const tasks = level.buildTasks();
    tasks.push(['Rousing the invaders', () => this._populate()]);
    return tasks;
  }

  get collision() { return this.level.collision; }
  get spawnPoint() { return this.level.spawnPos.clone(); }

  /** Fill the village with the attack in progress, plus Toadel at the gate. */
  _populate() {
    const rnd = Math.random;
    const frogFactory = () => {
      const f = new FrogModel(0x6cc24a, '', true);
      f.root.scale.setScalar(0.95);
      return f;
    };

    // Background vignettes along the route: beatings, burnings, chases.
    const kinds = ['beating', 'burning', 'fleeing', 'burning', 'beating'];
    for (let i = 0; i < 14; i++) {
      const t = 0.06 + (i / 14) * 0.82;
      const z = t * PATH_LENGTH;
      if (z > ARENA_Z - 22) continue;
      const side = i % 2 === 0 ? -1 : 1;
      const x = Math.sin(z * 0.012) * 7 + side * (12 + rnd() * 10);
      const y = this.level.heightAt(x, z);
      if (y < 1.4) continue;
      const kind = kinds[i % kinds.length];
      const facing = Math.atan2(-side, 0) + (rnd() - 0.5);
      const actor = new VillageScene(kind, x, y, z, facing, frogFactory);
      this.scene.add(actor.root);
      this.actors.push(actor);
    }

    // The ring of soldiers that seals the arena.
    for (const [x, y, z, face] of this.level.soldierSpots) {
      const t = new ToadModel(false);
      t.root.position.set(x, y, z);
      t.setFacing(face);
      t.root.visible = false;              // revealed when the fight starts
      this.scene.add(t.root);
      this.soldiers.push(t);
    }

    // Toadel, waiting in front of the gate.
    this.boss = new BossToadel(this.scene, this.level, this.effects);

    // The gaoler, asleep in the corridor outside your cell.
    const sleeper = new ToadModel(false);
    sleeper.root.position.copy(this.level.sleepingGuardPos);
    sleeper.setFacing(-Math.PI / 2);
    // Slumped against the wall: tipped back, legs out, head lolling.
    sleeper.root.rotation.z = 0.42;
    sleeper.body.rotation.x = -0.35;
    sleeper.head.rotation.x = 0.55;
    sleeper.head.rotation.z = 0.3;
    for (const leg of sleeper.legs) leg.hip.rotation.x = -1.1;
    for (const arm of sleeper.arms) arm.shoulder.rotation.x = 0.6;
    this.scene.add(sleeper.root);
    this.sleeper = sleeper;
  }

  // --------------------------------------------------------------- update

  /**
   * @param player local Player
   * @param remotes iterable of RemotePlayer
   */
  update(dt, player, remotes) {
    this.time += dt;
    this.level.update(dt);

    // `gdt` is world time (slowed during tutorial beats); `dt` stays real so
    // scripted timers — prompts, fades, the black hold — are never stretched.
    const gdt = dt * this.timeScale;

    for (const a of this.actors) a.update(gdt);
    this._emitFires(dt);

    if (this.shake > 0) {
      this.shake -= dt;
      this.followCam.shake(0.35);
    }

    switch (this.phase) {
      case STORY_PHASE.ESCAPE: this._updateEscape(dt, player); break;
      case STORY_PHASE.CUTSCENE: this._updateCutscene(dt, player); break;
      case STORY_PHASE.BOSS:
        this._updateBoss(gdt, player);
        this._updateTutorial(dt, player);
        break;
      case STORY_PHASE.DEFEAT: this._updateDefeat(dt, player); break;
      case STORY_PHASE.PRISON: this._updatePrison(dt, player); break;
      case STORY_PHASE.VILLAGE_CUT1: this._updateVillageCut1(dt, player); break;
      case STORY_PHASE.VILLAGE_WALK: this._updateVillageWalk(dt, player); break;
      case STORY_PHASE.VILLAGE_CUT2: this._updateVillageCut2(dt, player); break;
      case STORY_PHASE.VILLAGE_CHASE: this._updateVillageChase(dt, player); break;
      case STORY_PHASE.VILLAGE_DONE: this._updateVillageDone(dt, player); break;
      default: break;
    }

    // The village keeps living through every one of its phases, cutscenes
    // included — a market that freezes the moment someone speaks looks dead.
    if (this.inVillage) {
      if (this.phase !== STORY_PHASE.VILLAGE_CHASE) {
        for (const v of this.villagers) v.update(gdt);
      }
      this._catchVillageFall(player);
    }
  }

  /**
   * The village is a slab three hundred units above the swamp. The fence
   * keeps you in, but a frog with a grapple and a double jump will get over
   * anything — so leaving the slab puts you back at the gate rather than
   * dropping you into a very long fall.
   */
  _catchVillageFall(player) {
    const floor = this.level.villageEnter.y;
    if (player.pos.y > floor - 25) return;
    player.pos.copy(this.level.villageEnter);
    player.vel.set(0, 0, 0);
    this.followCam.snapTo(player.pos);
    this.hud.toast('You are not getting out that way', 2.5);
  }

  /** Chapter over: the village keeps living, nobody is hunting you. */
  _updateVillageDone(dt) {
    this.guide.update(dt, null);
    for (const g of this.villageGuards) g.update(dt, null, null);
  }

  // ------------------------------------------------------------- tutorial

  /**
   * Drive the tutorial prompts. Each step ends when the player does the
   * thing, so nobody is left staring at a prompt they have already obeyed.
   */
  _updateTutorial(dt, player) {
    if (this.tutorial === TUT.DONE || this.tutorial === TUT.IDLE) return;
    this.tutorialTimer += dt;

    if (this.tutorial === TUT.DASH) {
      // Cleared by dashing — or by a generous timeout so nobody gets stuck.
      if (player.dashTimer > 0 || this.tutorialTimer > 9) {
        this._setTutorial(TUT.ATTACK);
      }
    } else if (this.tutorial === TUT.ATTACK) {
      if (player.combat.attacking || this.tutorialTimer > 9) {
        this._setTutorial(TUT.WAIT_HIT);
      }
    } else if (this.tutorial === TUT.PARRY) {
      // Cleared as soon as the guard is actually up.
      if (player.parrying || this.tutorialTimer > 10) {
        this._setTutorial(TUT.DONE);
      }
    }
  }

  _setTutorial(step) {
    this.tutorial = step;
    this.tutorialTimer = 0;

    if (step === TUT.DASH) {
      this.timeScale = 0.18;
      this.hud.setTutorial('PRESS', 'Q', 'TO DASH AWAY');
      Audio.cue(this.camera.position);
    } else if (step === TUT.ATTACK) {
      this.timeScale = 1;
      this.hud.setTutorial('CLICK', 'LMB', 'TO HIT THE BOSS');
      Audio.cue(this.camera.position);
    } else if (step === TUT.WAIT_HIT) {
      this.timeScale = 1;
      this.hud.setTutorial(null);
    } else if (step === TUT.PARRY) {
      this.timeScale = 0.18;
      this.hud.setTutorial('HOLD', 'RIGHT CLICK', 'TO PARRY HIS ATTACK');
      Audio.cue(this.camera.position);
    } else if (step === TUT.DONE) {
      this.timeScale = 1;
      this.hud.setTutorial(null);
      this.hud.announce('NOW SURVIVE', 'danger');
    }
  }

  /** Called by the player when one of Toadel's blows connects. */
  onBossLanded() {
    if (this.tutorial === TUT.IDLE) { this._setTutorial(TUT.DASH); return true; }
    if (this.tutorial === TUT.WAIT_HIT) { this._setTutorial(TUT.PARRY); return true; }
    return false;
  }

  _updateEscape(dt, player) {
    this.boss.idle(dt);
    // Trigger once the player is close enough to the gate.
    const d = Math.hypot(
      player.pos.x - this.boss.pos.x,
      player.pos.z - this.boss.pos.z
    );
    if (d < CFG.story.triggerRange) this._beginCutscene(player);
  }

  // ------------------------------------------------------------- cutscene

  _beginCutscene(player) {
    this.phase = STORY_PHASE.CUTSCENE;
    this.cutscene = { t: 0, stage: 0, spoken: false };
    // Freeze the player and take the camera off them.
    player.cinematic = true;
    player.vel.set(0, 0, 0);
    this.hud.setCinematic(true);
    this.hud.setSubtitle('');
    Audio.stopAmbient();
  }

  _updateCutscene(dt, player) {
    const c = this.cutscene;
    c.t += dt;

    // Frame Toadel over the player's shoulder for the whole scene.
    const b = this.boss;
    _v.set(b.pos.x, b.pos.y + 2.6, b.pos.z);
    const camDist = lerp(16, 9, clamp(c.t / 5.5, 0, 1));
    const angle = -Math.PI / 2 + 0.35 + c.t * 0.06;
    this.camera.position.set(
      b.pos.x + Math.cos(angle) * camDist,
      b.pos.y + 5.2 - clamp(c.t / 5.5, 0, 1) * 1.4,
      b.pos.z + Math.sin(angle) * camDist
    );
    this.camera.lookAt(_v);

    if (c.stage === 0) {
      // He becomes aware of you and turns his head.
      b.turnHead(dt, player.pos, 1);
      if (c.t > 1.6) { c.stage = 1; Audio.exhausted(b.pos); }
    } else if (c.stage === 1) {
      // Turns to face you fully, then advances.
      b.faceTarget(dt, player.pos, 3.0);
      const dist = Math.hypot(player.pos.x - b.pos.x, player.pos.z - b.pos.z);
      if (dist > 6.5) b.walkToward(dt, player.pos, 5.0);
      else b.walkToward(dt, player.pos, 0);
      if (c.t > 3.4 && !c.spoken) {
        c.spoken = true;
        this.hud.setSubtitle(TOADEL_LINE, CFG.story.boss.name);
        Audio.tone({ freq: 90, to: 60, dur: 1.4, type: 'sawtooth', volume: 0.2, pos: b.pos });
      }
      if (c.t > 8.6) { c.stage = 2; }
    } else if (c.stage === 2) {
      this._beginBoss(player);
    }

    b.model.update(dt, { speed: b.moveSpeedNow });
  }

  // ----------------------------------------------------------------- boss

  _beginBoss(player) {
    this.phase = STORY_PHASE.BOSS;
    this.cutscene = null;

    player.cinematic = false;
    // A broken blade: a third of the damage it would normally do. Putting a
    // real katana in the hotbar is also what enables the parry, since that is
    // now gated on having the sword out rather than on being in story mode.
    player.damageMultiplier = CFG.story.brokenSwordMult;
    player.inventory.slots[0] = { item: ITEMS.katana, count: -1 };
    player.inventory.select(0);
    player.inventory.dirty = true;
    player.combatEnabled = true;

    this.hud.setCinematic(false);
    this.hud.setSubtitle('');
    this.hud.showBossBar(CFG.story.boss.name, 1);

    // Seal the arena and reveal the soldiers holding the line.
    this.level.sealArena();
    for (const s of this.soldiers) s.root.visible = true;

    this._completeObjective('escape', false);
    this._addObjective('survive', 'Survive Toadel');

    this.shake = CFG.story.shakeTime;
    Audio.death(this.boss.pos);
    Audio.startAmbient();
    Audio.startBossMusic();
    this.boss.begin();
  }

  _updateBoss(dt, player) {
    const b = this.boss;

    // Toadel is deliberately a SOLO encounter, even in a shared session —
    // it is the whole reason players cannot see each other until afterwards.
    // Every client therefore owns its own copy of him and runs its own AI.
    // Sharing one networked boss meant whoever reached the gate first began
    // the fight for everybody, and the others could never duel him at all.
    b.updateAI(dt, player);
    b.resolveStrike(dt, player, this);

    for (const s of this.soldiers) {
      s.update(dt, { speed: 0 });
      // Soldiers bang their clubs — a hostile, closing-in ambience.
      if (Math.random() < dt * 0.25) s.swing(0.7);
    }

    this.hud.setBossBar(b.health / b.maxHealth);
  }

  // ---------------------------------------------------------- defeat

  /**
   * Toadel has finished you. You collapse, the world fades out, and you come
   * round somewhere else entirely.
   */
  beginDefeat(player) {
    if (this.phase === STORY_PHASE.DEFEAT || this.phase === STORY_PHASE.PRISON) return;
    this.phase = STORY_PHASE.DEFEAT;
    this.defeat = { t: 0, stage: 'fall' };
    this.timeScale = 1;

    player.frozen = true;
    player.knockdown = 99;          // stay down; nothing can act you out of it
    player.parrying = false;
    player.storyParry = false;

    this.hud.setTutorial(null);
    this.hud.hideBossBar();
    this.hud.clearAnnounce();
    Audio.stopBossMusic();
    Audio.hurt(player.pos);
    Audio.land(player.pos, true);
  }

  _updateDefeat(dt, player) {
    const d = this.defeat;
    d.t += dt;

    // The boss stands over you while the light goes out.
    this.boss.model.update(dt, { speed: 0 });

    if (d.stage === 'fall') {
      if (d.t > FALL_TIME) { d.stage = 'out'; d.t = 0; this.hud.setFade(1, FADE_OUT); }
    } else if (d.stage === 'out') {
      if (d.t > FADE_OUT) {
        d.stage = 'black'; d.t = 0;
        // Move everything while the screen is fully black.
        this._enterPrison(player);
      }
    } else if (d.stage === 'black') {
      if (d.t > BLACK_TIME) { d.stage = 'in'; d.t = 0; this.hud.setFade(0, FADE_IN); }
    } else if (d.stage === 'in') {
      if (d.t > FADE_IN) {
        this.phase = STORY_PHASE.PRISON;
        this.defeat = null;
        this._wakeUp(player);
      }
    }
  }

  /** Teleport into the cell behind the black screen. */
  _enterPrison(player) {
    const level = this.level;
    player.health.revive();
    player.pos.copy(level.prisonSpawn);
    player.vel.set(0, 0, 0);
    player.damageMultiplier = 1;
    player.knockdown = 99;          // still lying down when the lights return
    player.frozen = true;
    player.model.root.position.copy(player.pos);

    // Point the camera at the barred door, low to the floor.
    this.followCam.yaw = Math.atan2(
      -(level.prisonLook.x - player.pos.x),
      -(level.prisonLook.z - player.pos.z)
    );
    this.followCam.pitch = 0.35;    // looking up from the ground
    this.followCam.distance = 2.4;
    this.followCam.snapTo(player.pos);

    Audio.stopAmbient();
    this._completeObjective('survive', false);
    this._addObjective('escape-cell', 'Escape the dungeon');
  }

  /** Come round: the camera rises as the frog picks itself up. */
  _wakeUp(player) {
    this.wake = { t: 0 };
    this.hud.setSubtitle('');
    Audio.startAmbient();
  }

  _updatePrison(dt, player) {
    this.level.updateRats(dt);

    if (this.wake) {
      this.wake.t += dt;
      // Slow, groggy return to your feet.
      const k = clamp(this.wake.t / 3.2, 0, 1);
      this.followCam.pitch = lerp(0.35, -0.05, k);
      this.followCam.distance = lerp(2.4, CFG.camera.distance, k);

      if (this.wake.t > 2.2 && player.knockdown > 1) {
        player.knockdown = 0;         // back on your feet
        player.frozen = false;
        this.hud.toast('You wake in a cell beneath the castle', 5);
      }
      if (this.wake.t > 3.4) {
        this.wake = null;
        // The tongue is still yours — the game says so explicitly, because
        // this is the first time it is used to solve something.
        this.hud.setTutorial('PRESS', 'G', 'WHILE LOOKING AT THE KEY TO GRAB IT');
        Audio.cue(player.pos);
        this.keyPrompt = true;
      }
      return;
    }

    // The sleeping guard snores on, oblivious.
    if (this.sleeper) {
      this.snore = (this.snore || 0) + dt;
      this.sleeper.body.position.y = Math.sin(this.snore * 1.5) * 0.05;
      if (this.snore % 4 < dt * 2) Audio.tone({
        freq: 70, to: 55, dur: 0.5, type: 'sawtooth',
        volume: 0.06, pos: this.sleeper.root.position,
      });
    }

    // ---- grab the key with the tongue ----
    if (!this.keyTaken && player.grapple.attached) {
      const k = this.level.keyPos;
      if (player.grapple.anchor.distanceTo(k) < 2.2) this._takeKey(player);
    }

    if (this.keyTaken) this._updateEscapeCastle(dt, player);
  }

  /** Tongue hit the key: it flies to you and the cell door swings open. */
  _takeKey(player) {
    this.keyTaken = true;
    this.keyPrompt = false;
    this.hud.setTutorial(null);
    player.grapple.release();

    const level = this.level;
    if (level.keyMesh) level.keyMesh.visible = false;
    // Remove the anchor so the tongue does not keep catching on nothing.
    const idx = level.collision.anchors.indexOf(level.keyAnchor);
    if (idx >= 0) level.collision.anchors.splice(idx, 1);

    this.effects.puff(level.keyPos, 0xffd76b, 18, 5);
    Audio.pickup(player.pos);

    // Open the door.
    if (level.cellDoor) level.cellDoor.disabled = true;
    if (level.doorMesh) level.doorMesh.visible = false;
    Audio.uiBack();
    setTimeout(() => Audio.land(player.pos, true), 220);

    this._completeObjective('escape-cell');
    this._addObjective('escape-castle', 'Escape the castle');
    this.hud.announce('THE DOOR IS OPEN', 'good');
    this.hud.toast('Guards patrol the halls — stay out of sight', 5);

    this._spawnGuards();
  }

  _spawnGuards() {
    if (this.guards && this.guards.length) return;
    this.guards = [];
    const y = this.level.prisonSpawn.y;
    for (const route of this.level.guardRoutes) {
      const g = new PatrolGuard(route, y, this.level.collision);
      this.scene.add(g.model.root);
      this.guards.push(g);
    }
  }

  /** Sneak through the castle to the gatehouse. */
  _updateEscapeCastle(dt, player) {
    const target = player.health.dead ? null : player.pos;
    let anyChasing = false;
    let maxAlert = 0;

    for (const g of this.guards) {
      g.update(dt, target, (guard) => {
        // A guard's club hurts, but far less than Toadel's.
        const dx = player.pos.x - guard.pos.x;
        const dz = player.pos.z - guard.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        player.vel.x += (dx / len) * 11;
        player.vel.z += (dz / len) * 11;
        player.vel.y = Math.max(player.vel.y, 0) + 5;
        player.health.damage(28, 'guard');
        _v.set(player.pos.x, player.pos.y + 1.1, player.pos.z);
        this.effects.hitBurst(_v, { x: -dx / len, y: 0, z: -dz / len }, false);
        this.effects.damageNumber(_v, 28, false);
        Audio.hit(player.pos, false);
        Audio.hurt(player.pos);
        this.followCam.shake(0.35);
      });
      if (g.state === 'chase') anyChasing = true;
      maxAlert = Math.max(maxAlert, g.alertLevel);
    }

    this.hud.setAlert(maxAlert, anyChasing);

    // Caught and beaten: back to the cell, door shut again.
    if (player.health.dead && !this._recapture) {
      this._recapture = 2.5;
      this.hud.announce('CAUGHT', 'danger', true);
    }
    if (this._recapture > 0) {
      this._recapture -= dt;
      if (this._recapture <= 0) {
        this._recapture = 0;
        player.health.revive();
        player.pos.copy(this.level.prisonSpawn);
        player.vel.set(0, 0, 0);
        this.followCam.snapTo(player.pos);
        this.hud.clearAnnounce();
        this.hud.toast('Thrown back in your cell — try again', 4);
        for (const g of this.guards) { g.state = 'patrol'; g.alertLevel = 0; }
      }
    }

    // Reached the gatehouse — out of the castle and into the village.
    if (!this.escaped && this.level.castleExit &&
        player.pos.distanceTo(this.level.castleExit) < 7) {
      this.escaped = true;
      this._completeObjective('escape-castle');
      this.hud.announce('YOU ESCAPED THE CASTLE', 'good');
      this.hud.setAlert(0, false);
      Audio.respawn(player.pos);
      this._enterVillage(player);
    }
  }

  // ------------------------------------------------------------- village

  /** Populate the village and play the frog-in-the-bush cutscene. */
  _enterVillage(player) {
    this._populateVillage();

    this.phase = STORY_PHASE.VILLAGE_CUT1;
    this.cutscene = { t: 0, stage: 0 };
    player.cinematic = true;
    player.vel.set(0, 0, 0);
    this.hud.setCinematic(true);
    this.hud.setSubtitle('');
    this._addObjective('village', 'Get out of the village');
  }

  /** Villagers, stalls, the guide frog and the guards that will hunt you. */
  _populateVillage() {
    if (this.villagers) return;
    const L = this.level;

    this.villagers = [];
    for (let i = 0; i < 10; i++) {
      const v = new VillagerToad(L.villagerSpots, i, L.collision);
      this.scene.add(v.model.root);
      this.villagers.push(v);
    }

    // The one who spots you, and the two soldiers who hear her.
    this.accuser = new VillagerToad([L.accuserSpot], 0, L.collision);
    this.accuser.pos.copy(L.accuserSpot);
    this.accuser.frozen = true;
    // Facing away to begin with — she turns around in the cutscene.
    this.accuser.yaw = Math.PI;
    this.scene.add(this.accuser.model.root);

    this.watchers = [];
    for (const spot of L.watchSpots) {
      const t = new ToadModel(false);
      t.root.position.copy(spot);
      t.setFacing(0.4);            // looking away down the street
      this.scene.add(t.root);
      this.watchers.push(t);
    }

    // The guide, hiding with only his head above the leaves.
    this.guide = new GuideFrog(L.guideRoute, L.collision);
    this.guide.hideIn(L.bushPos);
    this.scene.add(this.guide.model.root);
    this.guide.onArrive = () => this._guideThroughFence();

    // The bush itself.
    const bush = new THREE.Group();
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f6b2c });
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), leafMat);
      b.position.set(
        (Math.random() - 0.5) * 1.9, 0.5 + Math.random() * 0.7,
        (Math.random() - 0.5) * 1.9);
      b.scale.setScalar(0.7 + Math.random() * 0.5);
      bush.add(b);
    }
    bush.position.copy(L.bushPos);
    this.scene.add(bush);
    this.bush = bush;

    // The guards do not exist until the alarm goes up — spawning them early
    // would have fifteen toads pacing an otherwise peaceful market.
    this.villageGuards = [];
  }

  _updateVillageCut1(dt, player) {
    const c = this.cutscene;
    const L = this.level;
    c.t += dt;

    // Frame the bush from over the player's shoulder.
    _v.set(L.bushPos.x, L.bushPos.y + 1.1, L.bushPos.z);
    const angle = Math.atan2(player.pos.x - L.bushPos.x, player.pos.z - L.bushPos.z);
    const dist = lerp(13, 7, clamp(c.t / 5, 0, 1));
    this.camera.position.set(
      L.bushPos.x + Math.sin(angle) * dist,
      L.bushPos.y + 3.4,
      L.bushPos.z + Math.cos(angle) * dist
    );
    this.camera.lookAt(_v);
    this.guide.model.setFacing(angle);

    if (c.stage === 0 && c.t > 0.9) {
      c.stage = 1;
      this.hud.setSubtitle(VILLAGE_LINES.hey, GUIDE_NAME);
      Audio.uiHover();
    } else if (c.stage === 1 && c.t > 3.6) {
      c.stage = 2;
      this.hud.setSubtitle(VILLAGE_LINES.comeHere, GUIDE_NAME);
      Audio.uiClick();
    } else if (c.stage === 2 && c.t > 6.4) {
      this.phase = STORY_PHASE.VILLAGE_WALK;
      this.cutscene = null;
      player.cinematic = false;
      this.hud.setCinematic(false);
      this.hud.setSubtitle('');
      this.hud.toast('Get to the frog in the bush', 4);
      Audio.startAmbient();
    }
  }

  /** Free movement until you reach the bush. */
  _updateVillageWalk(dt, player) {
    this.guide.model.update(dt, { speed: 0, moving: false, grounded: true });
    if (player.pos.distanceTo(this.level.bushPos) < 4.5) {
      this._beginVillageCut2(player);
    }
  }

  _beginVillageCut2(player) {
    this.phase = STORY_PHASE.VILLAGE_CUT2;
    this.cutscene = { t: 0, stage: 0 };
    player.cinematic = true;
    player.vel.set(0, 0, 0);
    this.hud.setCinematic(true);
    this.hud.setSubtitle('');
  }

  _updateVillageCut2(dt, player) {
    const c = this.cutscene;
    const L = this.level;
    c.t += dt;

    if (c.stage === 0) {
      // The villager turns around and points straight at you.
      _v.set(L.accuserSpot.x, L.accuserSpot.y + 2.2, L.accuserSpot.z);
      const a = c.t * 0.5 - 1.2;
      this.camera.position.set(
        L.accuserSpot.x + Math.sin(a) * 8,
        L.accuserSpot.y + 3.6,
        L.accuserSpot.z + Math.cos(a) * 8);
      this.camera.lookAt(_v);
      // Spin her to face the player, then throw an arm out.
      this.accuser.yaw = dampAngle(this.accuser.yaw,
        Math.atan2(player.pos.x - this.accuser.pos.x,
          player.pos.z - this.accuser.pos.z), 4, dt);
      this.accuser.model.setFacing(this.accuser.yaw);
      this.accuser.model.update(dt, { speed: 0 });
      const point = clamp((c.t - 1.0) / 0.4, 0, 1);
      this.accuser.model.arms[0].shoulder.rotation.x = lerp(0.1, -1.45, point);
      this.accuser.model.arms[0].fore.rotation.x = lerp(-0.5, -0.1, point);

      if (c.t > 1.2 && !c.spoken) {
        c.spoken = true;
        this.hud.setSubtitle(VILLAGE_LINES.spotted, VILLAGER_NAME);
        Audio.exhausted(this.accuser.pos);
      }
      if (c.t > 3.4) { c.stage = 1; c.t = 0; c.spoken = false; }
    } else if (c.stage === 1) {
      // Cut to the two soldiers turning to look back at you.
      const w = this.watchers[0];
      _v.set(w.root.position.x, w.root.position.y + 2.0, w.root.position.z);
      this.camera.position.set(
        w.root.position.x - 5.5, w.root.position.y + 3.2, w.root.position.z - 6.5);
      this.camera.lookAt(_v);
      for (const t of this.watchers) {
        // Heads come round first, then the whole body.
        const k = clamp(c.t / 1.4, 0, 1);
        const want = Math.atan2(
          player.pos.x - t.root.position.x, player.pos.z - t.root.position.z);
        t.setFacing(lerp(0.4, want, k));
        t.update(dt, { speed: 0 });
      }
      if (c.t > 0.2 && !c.spoken) { c.spoken = true; Audio.hurt(w.root.position); }
      if (c.t > 2.6) { c.stage = 2; c.t = 0; c.spoken = false; }
    } else if (c.stage === 2) {
      // Back to the bush: "Follow me, quickly!"
      _v.set(L.bushPos.x, L.bushPos.y + 1.2, L.bushPos.z);
      const angle = Math.atan2(
        player.pos.x - L.bushPos.x, player.pos.z - L.bushPos.z);
      this.camera.position.set(
        L.bushPos.x + Math.sin(angle) * 6.5,
        L.bushPos.y + 3.0,
        L.bushPos.z + Math.cos(angle) * 6.5);
      this.camera.lookAt(_v);
      // He stands up out of the leaves.
      this.guide.pos.y = lerp(L.bushPos.y - 0.62, L.bushPos.y, clamp(c.t / 0.8, 0, 1));
      this.guide.model.root.position.copy(this.guide.pos);
      this.guide.model.setFacing(angle);
      this.guide.model.update(dt, { speed: 0, grounded: true });

      if (c.t > 0.5 && !c.spoken) {
        c.spoken = true;
        this.hud.setSubtitle(VILLAGE_LINES.followMe, GUIDE_NAME);
        Audio.uiClick();
      }
      if (c.t > 3.0) this._beginVillageChase(player);
    }
  }

  _beginVillageChase(player) {
    this.phase = STORY_PHASE.VILLAGE_CHASE;
    this.cutscene = null;
    player.cinematic = false;
    this.hud.setCinematic(false);
    this.hud.setSubtitle('');

    // Every villager stops and stares — the whole square knows now.
    for (const v of this.villagers) v.lookAt(player.pos.x, player.pos.z);

    // Fifteen guards, scattered, already looking for you.
    const y = this.level.bushPos.y;
    for (const route of this.level.villageGuardRoutes) {
      const g = new PatrolGuard(route, y, this.level.collision);
      // They have been told there is a frog in the village, so they start
      // suspicious rather than oblivious.
      g.alertLevel = 0.55;
      g.state = 'alert';
      g.lastSeen = { x: player.pos.x, y: player.pos.y, z: player.pos.z };
      this.scene.add(g.model.root);
      this.villageGuards.push(g);
    }

    this.guide.begin(this.level.bushPos);
    this.guide.pos.y = this.level.bushPos.y;

    this._completeObjective('village', false);
    this._addObjective('village-escape', 'Follow the frog — get out of the village');
    this.hud.announce('RUN!', 'danger');
    this.hud.toast('Follow the frog. Fifteen guards are looking for you.', 5);
    Audio.startBossMusic();
  }

  _updateVillageChase(dt, player) {
    const L = this.level;
    const target = player.health.dead ? null : player.pos;
    let anyChasing = false;
    let maxAlert = 0;

    for (const g of this.villageGuards) {
      g.update(dt, target, (guard) => {
        const dx = player.pos.x - guard.pos.x;
        const dz = player.pos.z - guard.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        player.vel.x += (dx / len) * 11;
        player.vel.z += (dz / len) * 11;
        player.vel.y = Math.max(player.vel.y, 0) + 5;
        player.health.damage(24, 'guard');
        _v.set(player.pos.x, player.pos.y + 1.1, player.pos.z);
        this.effects.hitBurst(_v, { x: -dx / len, y: 0, z: -dz / len }, false);
        this.effects.damageNumber(_v, 24, false);
        Audio.hit(player.pos, false);
        Audio.hurt(player.pos);
        this.followCam.shake(0.35);
      });
      if (g.state === 'chase') anyChasing = true;
      maxAlert = Math.max(maxAlert, g.alertLevel);
    }
    this.hud.setAlert(maxAlert, anyChasing);

    // Villagers are frozen mid-stare during the chase, so they are updated
    // here rather than by the shared tick.
    for (const v of this.villagers) v.update(dt);
    this.guide.update(dt, player.pos);

    // A nudge when he is stood waiting for you.
    if (this.guide.waiting) {
      this._waveCue = (this._waveCue || 0) - dt;
      if (this._waveCue <= 0) {
        this._waveCue = 2.6;
        this.hud.toast('The frog is waiting — keep up!', 1.8);
      }
    }

    // Beaten down: you wake back at the castle gate and try again.
    if (player.health.dead && !this._villageDown) {
      this._villageDown = 2.5;
      this.hud.announce('CAUGHT', 'danger', true);
    }
    if (this._villageDown > 0) {
      this._villageDown -= dt;
      if (this._villageDown <= 0) {
        this._villageDown = 0;
        player.health.revive();
        player.pos.copy(L.villageEnter);
        player.vel.set(0, 0, 0);
        this.followCam.snapTo(player.pos);
        this.hud.clearAnnounce();
        this.hud.toast('Dragged back to the gate — go again', 4);
        for (const g of this.villageGuards) {
          g.state = 'patrol';
          g.alertLevel = 0.3;
        }
      }
    }

    // Through the gap in the fence.
    if (player.pos.distanceTo(L.fenceHole) < 5) this._finishVillage(player);
  }

  /** The guide reaches the gap and hops through it. */
  _guideThroughFence() {
    const L = this.level;
    this.guide.pos.set(L.fenceHole.x + 4, L.fenceHole.y - 1, L.fenceHole.z);
    this.guide.yaw = Math.PI * 0.5;
    this.guide.model.root.position.copy(this.guide.pos);
    this.guide.model.triggerFlip();
    this.effects.dustPuff(L.fenceHole, 10, 3, 0xcfc0a0);
    Audio.jump(L.fenceHole);
    this.hud.toast('Through the fence — go!', 3);
  }

  _finishVillage(player) {
    this.phase = STORY_PHASE.VILLAGE_DONE;
    this._completeObjective('village-escape');
    this.hud.setAlert(0, false);
    this.hud.announce('YOU ESCAPED THE VILLAGE', 'good', true);
    Audio.stopBossMusic();
    Audio.respawn(player.pos);
    for (const g of this.villageGuards) { g.state = 'patrol'; g.alertLevel = 0; }
  }

  /**
   * Buy a piece of fruit from the nearest stall.
   * @returns a short message for the HUD, or null if there is no stall here
   */
  buyFruit(player, economy) {
    const stand = this.nearestStand(player.pos);
    if (!stand) return null;
    const F = CFG.story.fruit;
    if (player.health.hp >= player.health.max) {
      return { text: 'You are not hurt — save your froglets', bad: true };
    }
    if (!economy.canAfford(F.price)) {
      return { text: `Not enough froglets — fruit costs ${F.price}`, bad: true };
    }
    economy.spend(F.price);
    player.health.hp = Math.min(player.health.max, player.health.hp + F.heal);
    this.effects.puff(
      _v.set(player.pos.x, player.pos.y + 1.2, player.pos.z), 0xd94f3d, 12, 3);
    Audio.pickup(player.pos);
    return { text: `Fruit bought — +${F.heal} health`, bad: false };
  }

  /** The stall the player is standing at, if any. */
  nearestStand(pos) {
    if (!this.level || !this.level.fruitStands) return null;
    if (!this.inVillage) return null;
    for (const s of this.level.fruitStands) {
      if (pos.distanceTo(s.pos) < CFG.story.fruit.reach) return s;
    }
    return null;
  }

  /** True once the player is out in the village. */
  get inVillage() {
    const c = STORY_PHASE_CODE[this.phase] || 0;
    return c >= STORY_PHASE_CODE[STORY_PHASE.VILLAGE_CUT1];
  }

  /** A player landed a hit on Toadel. Always local — the duel is solo. */
  damageBoss(amount) {
    if (!this.boss || this.phase !== STORY_PHASE.BOSS) return;
    this.boss.takeDamage(amount);
  }

  // ----------------------------------------------------------- objectives

  _addObjective(id, text) {
    if (this.objectives.some((o) => o.id === id)) return;
    for (const o of this.objectives) o.active = false;
    this.objectives.push({ id, text, done: false, active: true });
    this.hud.setObjectives(this.objectives);
    Audio.uiClick();
  }

  _completeObjective(id, chime = true) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done) return;
    o.done = true;
    o.active = false;
    this.hud.setObjectives(this.objectives);
    if (chime) Audio.refreshed(this.camera.position);
  }

  // --------------------------------------------------------------- extras

  /** Fire, smoke and ember particles from every burning building. */
  _emitFires(dt) {
    this.fireEmitTimer -= dt;
    if (this.fireEmitTimer > 0) return;
    this.fireEmitTimer = 0.05;

    const camPos = this.camera.position;
    for (const f of this.level.fires) {
      // Only spend particles on fires the player can actually see.
      const dx = f.x - camPos.x, dz = f.z - camPos.z;
      if (dx * dx + dz * dz > 110 * 110) continue;
      this.effects.fire(f.x, f.y, f.z, f.size);
    }
  }

  dispose() {
    this.hud.setCinematic(false);
    this.hud.hideBossBar();
    this.hud.setObjectives(null);
    this.hud.setSubtitle('');
    this.hud.setTutorial(null);
    this.hud.setFade(0, 0);
    this.hud.setPickupPrompt(false);
    Audio.stopBossMusic();

    // Free the village cast's GPU resources. The scene itself is dropped by
    // the caller, but the models own their own materials.
    for (const list of [this.villagers, this.villageGuards]) {
      if (!list) continue;
      for (const v of list) v.model.dispose();
    }
    if (this.guide) this.guide.model.dispose();
    if (this.accuser) this.accuser.model.dispose();
    for (const w of this.watchers) w.dispose();
  }
}

// ---------------------------------------------------------------------------

/** Toadel: the toad leader. Fast, heavy, and not meant to be beaten. */
class BossToadel {
  constructor(scene, level, effects) {
    this.effects = effects;
    this.level = level;
    this.model = new ToadModel(true);
    this.pos = new THREE.Vector3(0, level.heightAt(0, PATH_LENGTH - 9), PATH_LENGTH - 9);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;                  // facing the gate, back to the player
    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);
    scene.add(this.model.root);

    this.maxHealth = CFG.story.boss.health;
    this.health = this.maxHealth;
    this.active = false;
    this.moveSpeedNow = 0;

    this.attackTimer = 0;      // cooldown until the next swing
    this.swingT = 0;           // time left in the current swing
    this.swingDur = 0;
    this.swingIndex = 0;
    this.struck = false;       // has this swing already resolved?
    this.comboTimer = 0;
    this.headTurn = 0;
  }

  begin() { this.active = true; this.attackTimer = 0.8; }

  /** Standing guard before the fight. */
  idle(dt) {
    this.moveSpeedNow = 0;
    this.model.update(dt, { speed: 0 });
  }

  turnHead(dt, target, amount) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    const rel = angleDelta(this.yaw, want);
    this.headTurn = damp(this.headTurn, clamp(rel, -1.2, 1.2) * amount, 4, dt);
    this.model.head.rotation.y = this.headTurn;
  }

  faceTarget(dt, target, rate) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, want, rate, dt);
    this.model.setFacing(this.yaw);
    this.model.head.rotation.y = damp(this.model.head.rotation.y, 0, 5, dt);
  }

  walkToward(dt, target, speed) {
    if (speed <= 0) { this.moveSpeedNow = damp(this.moveSpeedNow, 0, 8, dt); return; }
    _toPlayer.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const d = _toPlayer.length();
    if (d < 0.01) return;
    _toPlayer.multiplyScalar(1 / d);
    this.pos.addScaledVector(_toPlayer, speed * dt);
    this.pos.y = this.level.heightAt(this.pos.x, this.pos.z);
    this.model.root.position.copy(this.pos);
    this.moveSpeedNow = speed;
  }

  // ------------------------------------------------------------------- AI

  updateAI(dt, player) {
    if (!this.active) return;
    const B = CFG.story.boss;

    // This Toadel belongs to one player and can never target anyone else.
    // Taking only the local player as an argument makes that a property of
    // the code rather than something the caller has to remember.
    const target = player.pos;
    this.targetPos = target;

    _toPlayer.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const dist = _toPlayer.length();
    if (dist > 0.001) _toPlayer.multiplyScalar(1 / dist);

    // Always turning to face you — there is no circling him for free.
    const want = Math.atan2(_toPlayer.x, _toPlayer.z);
    this.yaw = dampAngle(this.yaw, want, B.turnRate, dt);

    if (this.swingT > 0) {
      this.swingT -= dt;
      // He lunges forward as the club comes down.
      const k = 1 - this.swingT / this.swingDur;
      if (k > 0.35 && k < 0.62) {
        this.pos.addScaledVector(_toPlayer, B.lungeSpeed * dt * (1 - dist / 14));
      }
      this.moveSpeedNow = 2;
    } else {
      if (this.attackTimer > 0) this.attackTimer -= dt;
      if (this.comboTimer > 0) this.comboTimer -= dt;

      // Close the gap fast, then swing the instant he is in range.
      if (dist > B.reach * 0.8) {
        const speed = B.moveSpeed * (dist > 16 ? 1.25 : 1);
        this.pos.addScaledVector(_toPlayer, speed * dt);
        this.moveSpeedNow = speed;
      } else {
        this.moveSpeedNow = damp(this.moveSpeedNow, 0, 8, dt);
        if (this.attackTimer <= 0) this._startSwing();
      }
    }

    // Keep him inside the arena.
    const dx = this.pos.x, dz = this.pos.z - ARENA_Z;
    const r = Math.hypot(dx, dz);
    if (r > ARENA_RADIUS - 2) {
      this.pos.x = dx / r * (ARENA_RADIUS - 2);
      this.pos.z = ARENA_Z + dz / r * (ARENA_RADIUS - 2);
    }

    this.pos.y = this.level.heightAt(this.pos.x, this.pos.z);
    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);
    this.model.update(dt, { speed: this.moveSpeedNow });
  }

  _startSwing() {
    const B = CFG.story.boss;
    this.swingIndex = this.comboTimer > 0 ? (this.swingIndex + 1) % 3 : 0;
    this.swingDur = B.attackCooldown[this.swingIndex];
    this.swingT = this.swingDur;
    this.attackTimer = this.swingDur + 0.12;
    this.comboTimer = B.comboWindow;
    this.struck = false;
    this.model.swing(this.swingDur);
    Audio.slash(this.pos, this.swingIndex === 2 ? 2 : 0);
  }

  /** Decide whether the current swing connects with the local player. */
  resolveStrike(dt, player, story) {
    if (this.swingT <= 0 || this.struck) return;
    const B = CFG.story.boss;
    const k = 1 - this.swingT / this.swingDur;
    if (k < B.windup[this.swingIndex] / this.swingDur) return;

    this.struck = true;

    if (player.health.dead || player.cinematic) return;

    _v.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const dist = _v.length();
    if (dist > B.reach) return;
    if (dist > 0.01) {
      _v.multiplyScalar(1 / dist);
      const fwd = Math.atan2(_v.x, _v.z);
      if (Math.abs(angleDelta(this.yaw, fwd)) > B.arc) return;
    }
    // Vertical slice, so a well-timed leap over the swing gets you clear.
    if (player.pos.y - this.pos.y > 3.0) return;

    _v.set(this.pos.x, this.pos.y + 2.0, this.pos.z);
    player.onBossBlow(_v, this.yaw, story);
  }

  takeDamage(amount) {
    if (!this.active) return;
    this.health = Math.max(0, this.health - amount);
    this.model.flinch();
  }

}
