/**
 * THE OPEN WORLD — one controller over the realm, its monsters and its people.
 *
 * Everything below is glue, and deliberately so. The pieces already exist and
 * each owns exactly one thing:
 *
 *   realm.js        the ground, streamed in tiles, and one height function
 *   scatter.js      the trees, rocks and reeds, streamed per tile
 *   realmsites.js   villages, shrines, ruins, arenas — built once, baked once
 *   mobs.js         camps of small things
 *   dungeonboss.js  the guardian fight, reused unchanged
 *   frogath.js      the last one, reused unchanged
 *   realmquests.js  the people, the dialogue box, the log and the map
 *   progression.js  what the player has and has become
 *
 * This file decides WHEN each of them happens, and that is all it decides.
 *
 * ── how an encounter works ────────────────────────────────────────────────
 * Every guardian in the region table becomes an `encounter`: a placed arena
 * and no boss. Walk within 260 units and the boss is built; walk into the ring
 * of stones and it wakes up; walk 340 units away and it is thrown away again.
 *
 * That last part is the important one. Leaving means the fight RESETS — full
 * health, back at its stone, as if you had never been. An open-world boss you
 * can whittle down over six visits is not a boss, and one that chases you
 * across a region is not an encounter, it is a pest.
 *
 * ── what is saved, and when ───────────────────────────────────────────────
 * `Progress` is the whole save and it is written at every moment the player
 * would mind losing: a guardian down, a camp cleared, a secret found, a quest
 * accepted or handed in, a region entered, and on the way out to the menu. It
 * is one blob in `Economy`, so there is no way for half of it to survive.
 */

import * as THREE from '../lib/three.module.js?v=v81';
import { CFG } from './config.js?v=v81';
import { clamp, damp } from './util.js?v=v81';
import { Realm } from './realm.js?v=v81';
import { Scatter } from './scatter.js?v=v81';
import { Sites } from './realmsites.js?v=v81';
import { Camp } from './mobs.js?v=v81';
import { DungeonBoss } from './dungeonboss.js?v=v81';
import { Frogath } from './frogath.js?v=v81';
import { GUARDIAN_BY_ID } from './guardians.js?v=v81';
import { REGIONS, SEA, regionAt, regionOpen, CONTENT_HALF } from './regions.js?v=v81';
import { Progress, HEART, BASE } from './progression.js?v=v81';
import { GEAR_BY_ID, rollLoot } from './gear.js?v=v81';
import { QUEST_BY_ID, SECRETS, npcSays, questProgress,
  mainObjective } from './quests.js?v=v81';
import { People, Life, Dialogue, Journal, grantReward,
  disposeVillagerMats } from './realmquests.js?v=v81';
import { disposeLandmarkMats } from './landmarks.js?v=v81';
import { Weather } from './weather.js?v=v81';
import { Audio } from './audio.js?v=v81';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const _scratch = [];
/** Scratch colour for the sky blend, so it allocates nothing per frame. */
const _fogTarget = new THREE.Color();

/** Encounter distances, in world units. See the file header. */
const BUILD_AT = 260;
const DROP_AT = 340;
/** Camps come and go closer in — there are more of them and they are smaller. */
const CAMP_BUILD = 300;
const CAMP_DROP = 420;

/**
 * How a region's tier becomes a guardian's power on the dungeon stat curve.
 *
 * The curve was written for fourteen rooms in order, index 0 to 13. Out here
 * there is no order — you can walk into the Frostmarch at level three if you
 * are determined — so the region's own tier decides, and the guardians within
 * one region step up slightly in the order they are listed. Tier 5 lands
 * around index 12, which is where the dungeon's hardest guardians sit.
 */
function powerFor(tier, indexInRegion) {
  return tier * 2.4 + indexInRegion * 0.7;
}

export class Overworld {
  constructor(opts) {
    this.scene = opts.scene;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.camera = opts.camera;
    this.economy = opts.economy;
    this.inventory = opts.inventory || null;   // an InventoryScreen, or none
    /** For the inventory's paperdoll: the player's own colour and skins. */
    this.frogColor = opts.color === undefined ? 0x6cc24a : opts.color;
    this.skins = opts.skins || null;
    this.followCam = null;                     // assigned once the rig exists
    this.atmo = null;                          // assigned by the loader

    this.realm = new Realm(this.scene, opts.seed || 90210);
    this.scatter = null;
    this.sites = null;
    this.people = null;
    /** The unnamed villagers, in whichever settlement is nearest. */
    this.life = null;
    /** What is falling out of the sky. One system, retargeted per region. */
    this.weather = new Weather(this.scene);
    this.dialogue = new Dialogue();
    this.journal = new Journal();

    /** Loaded from the save, or a brand new adventurer. */
    this.progress = this.economy && this.economy.realm
      ? new Progress(this.economy.realm) : Progress.fresh();

    this.encounters = [];
    this.camps = [];
    this.boss = null;              // the live DungeonBoss, if any
    this.bossOf = null;            // its encounter
    this.frogath = null;
    this.region = null;
    this.bannerT = 0;
    this.deathT = 0;
    this.home = null;              // where dying puts you back
    this.prompt = null;            // what E would do right now
    this.time = 0;
    this._savedWater = null;
    /**
     * The last place the player stood that they were allowed to stand in.
     *
     * The gate pushes them back toward it, so a sealed border is a wall you
     * bounce off rather than a teleport. See `_gate`.
     */
    this.lastOpen = null;
    this.sealedT = 0;
    this._sealedSaid = null;
  }

  get collision() { return this.realm.collision; }

  /** True while a full-screen panel is holding the world still. */
  get frozen() {
    return (this.inventory && this.inventory.isOpen)
      || this.dialogue.open || this.journal.open;
  }

  // ------------------------------------------------------------------ build

  buildTasks() {
    const tasks = this.realm.buildTasks();
    tasks.push(['Sowing the wild', () => {
      this.scatter = new Scatter(this.scene, this.realm);
    }]);
    this.sites = new Sites(this.scene, this.realm);
    for (const t of this.sites.buildTasks(REGIONS)) tasks.push(t);
    this.people = new People(this.scene, this.realm);
    for (const t of this.people.buildTasks()) tasks.push(t);
    tasks.push(['Opening the shutters', () => {
      this.life = new Life(this.scene, this.realm);
    }]);
    tasks.push(['Placing the guardians', () => this._placeEncounters()]);
    tasks.push(['Setting the watch', () => this._placeCamps()]);
    /**
     * The broadphase is baked LAST, once, with every site's collider already
     * in it. The collision world hashes its boxes into a grid at bake time
     * and nothing looks at a box added afterwards, so a structure built after
     * this line would be scenery you walk straight through.
     */
    tasks.push(['Settling the stones', () => this.realm.collision.bake()]);
    return tasks;
  }

  _placeEncounters() {
    for (const R of REGIONS) {
      (R.bosses || []).forEach((spec, i) => {
        const arena = this.sites.arenas.get(spec.id);
        const spec2 = GUARDIAN_BY_ID.get(spec.id);
        // Frogath is not in the guardian table — he has his own file, his own
        // rig and his own fight — so he is allowed through without one.
        if (!arena || (!spec2 && spec.id !== 'frogath')) return;
        this.encounters.push({
          id: spec.id,
          spec: spec2 || null,
          region: R,
          tier: R.tier,
          power: powerFor(R.tier, i),
          at: arena.at,
          r: spec.r || spec.arena,
          final: !!spec.final,
        });
      });
    }
  }

  _placeCamps() {
    for (const R of REGIONS) {
      (R.camps || []).forEach((spec, i) => {
        this.camps.push(new Camp(spec, R, i, this.scene,
          this.effects, this.realm));
      });
    }
  }

  // ------------------------------------------------------------------ start

  /**
   * Put the player in the world.
   *
   * Where they were standing when they last saved, if that is on land; the
   * village otherwise. "If that is on land" is not paranoia — a save written
   * from a build with a different height function would drop the player into
   * a lake, or inside a hill.
   */
  start(player) {
    this.player = player;

    /**
     * The realm's sea is at 6; the arena's is at 2.2.
     *
     * The swimming check reads `CFG.world.waterLevel` globally, so the realm
     * has to say what its own waterline is or two whole regions — both
     * marshes, both built around wading — would be walked across as if they
     * were dry. Put back on the way out, so the arena is unaffected.
     */
    this._savedWater = CFG.world.waterLevel;
    CFG.world.waterLevel = SEA;

    const p = this.progress;
    let spot = null;
    if (p.at) {
      const h = this.realm.heightAt(p.at.x, p.at.z);
      const R = regionAt(p.at.x, p.at.z, _scratch);
      // On land, roughly where the save said, and somewhere the player is
      // actually allowed to be. A save from before a gate existed must not
      // strand them inside a sealed region.
      if (h > SEA - 1 && Math.abs(h - p.at.y) < 40 && regionOpen(R, p.slain)) {
        spot = { x: p.at.x, y: h, z: p.at.z };
      }
    }
    if (!spot) {
      const start = this.sites.sites.find((s) => s.id === 'croakhollow');
      spot = start
        ? { x: start.at.x, y: start.at.y + 1, z: start.at.z + start.r * 0.9 }
        : { x: 300, y: 0, z: 1790 };
      spot.y = this.realm.heightAt(spot.x, spot.z) + 1;
    }
    this.home = { x: spot.x, y: spot.y, z: spot.z };
    this.lastOpen = { x: spot.x, z: spot.z };

    player.pos.set(spot.x, spot.y + 1.2, spot.z);
    player.vel.set(0, 0, 0);
    player.combatEnabled = true;
    player.onUseItem = () => this.eatQuick();
    this.applyStats();
    player.health.revive();
    player.stamina.reset();

    // Everything within sight, before the first frame is drawn.
    this.realm.streamAround(spot.x, spot.z, true);
    if (this.scatter) this.scatter.streamAround(spot.x, spot.z, true);
    this.sites.update(spot.x, spot.z, 0);
    this.region = regionAt(spot.x, spot.z, _scratch);
    p.seen.add(this.region.id);
    // The sky and the music of wherever we woke up, with no cross-fade.
    this.weather.set(this.region.weather || 'clear', true);
    Audio.setRegionMood(this.region.music || 'calm');
    if (this.life) this.life.moveTo(this.sites.nearestSettlement(spot.x, spot.z));
    this._paintObjectives();
    this.save();
  }

  /**
   * Push the save's numbers into the player.
   *
   * Called on start and after every equipment change. Two things cross over:
   * max health, which is hearts times HEART, and the katana's damage, which
   * rides on the multiplier the story's broken sword already uses. Nothing
   * else about the player is touched — the dash, the tongue and the kunai are
   * the same on the first day as the last, because they are the game's verbs
   * and not its numbers.
   */
  applyStats() {
    const st = this.progress.stats();
    const pl = this.player;
    if (!pl) return;
    pl.health.setMaxScale((this.progress.hearts * HEART) / CFG.combat.maxHealth);
    pl.damageMultiplier = st.atk / BASE.atk;
    // The hotbar's meal follows the bag, and the bag changes at exactly the
    // moments this is called: a kill, a reward, a piece of gear swapped.
    this._syncMeal();
  }

  save() {
    if (!this.economy) return;
    const pl = this.player;
    if (pl) this.progress.at = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
    this.economy.setRealm(this.progress.toJSON());
  }

  // ----------------------------------------------------------------- update

  /**
   * One frame.
   *
   * @param input  the real Input. While a panel is open the world is frozen
   *               and only the panel is given the keyboard.
   * @param onHit  (damage, from) => void, for anything that hits the player
   */
  update(dt, player, input, onHit) {
    this.time += dt;

    // ---- panels first. A frozen world still runs its UI ------------------
    if (this.frozen) {
      this._panelKeys(input);
      if (this.inventory) this.inventory.update(dt);
      // The map keeps drawing while it is open: the objective star pulses and
      // the dashed line to it has to follow you if you opened it mid-stride.
      this.journal.tick(dt, this.progress, player.pos, this.realm);
      return;
    }
    if (this._openKeys(input)) return;

    // ---- the world -------------------------------------------------------
    this.realm.update(dt, player.pos);
    if (this.scatter) this.scatter.streamAround(player.pos.x, player.pos.z);
    this.sites.update(player.pos.x, player.pos.z, dt);
    this.people.update(dt, player.pos, this.progress);
    this._region(player);
    this._gate(dt, player);
    this._encounters(dt, player, onHit);
    this._camps(dt, player, onHit);
    this._interact(player, input);
    this._death(dt, player);
    if (this.atmo) this._sky(dt, player);
    this.weather.update(dt, this.camera.position,
      this.atmo ? this.atmo.windDir : null);
    this._life(dt, player);
    this._banner(dt);
  }

  /**
   * The people who live in the nearest settlement.
   *
   * Only one settlement is populated at a time, and only when the player is
   * close enough to see it. Checked twice a second rather than every frame —
   * moving a village's worth of frogs is a rebuild, and the answer cannot
   * change in a frame.
   */
  _life(dt, player) {
    if (!this.life) return;
    this._lifeAcc = (this._lifeAcc || 0) + dt;
    if (this._lifeAcc > 0.5) {
      this._lifeAcc = 0;
      this.life.moveTo(this.sites.nearestSettlement(player.pos.x, player.pos.z));
    }
    if (this.life.where) this.life.update(dt, player.pos);
  }

  /**
   * The gate: a region a guardian still holds shut is a region you bounce off.
   *
   * Not a teleport and not an invisible wall you can slide along — the player
   * is pushed back the way they came, told what is holding it, and told which
   * guardian opens it. That last part is the whole design: a locked door that
   * does not say what the key is is indistinguishable from a bug.
   *
   * The push is away from the locked region's CENTRE, which is the direction
   * that reaches an open region fastest — every region's border is where its
   * own weight stops being the largest.
   */
  _gate(dt, player) {
    const R = this.region;
    if (!R) return;
    if (regionOpen(R, this.progress.slain)) {
      this.lastOpen = { x: player.pos.x, z: player.pos.z };
      if (this.sealedT > 0) {
        this.sealedT -= dt;
        if (this.sealedT <= 0) {
          const el = $('sealed');
          if (el) el.classList.remove('show');
        }
      }
      return;
    }
    /**
     * Sealed. Walk them back the way they came.
     *
     * The direction is toward the last place they were allowed to stand,
     * NOT away from the sealed region's centre. Away-from-centre is the
     * obvious choice and it has a hole in it: at the exact centre there is no
     * "away", the direction is zero, and the player stands in the middle of a
     * region they are not allowed in with a warning on screen and nothing
     * moving. Measured — a save or a teleport that lands dead centre stuck
     * there permanently.
     *
     * The last open position is always in an open region by construction, so
     * stepping toward it always gets out, and it retraces the route rather
     * than shoving them sideways into somewhere else they cannot go.
     */
    let ux = 0, uz = 0;
    if (this.lastOpen) {
      ux = this.lastOpen.x - player.pos.x;
      uz = this.lastOpen.z - player.pos.z;
    }
    let len = Math.hypot(ux, uz);
    if (len < 1) {
      // No history, or standing on it: fall back to outward, then to due east.
      ux = player.pos.x - R.x;
      uz = player.pos.z - R.z;
      len = Math.hypot(ux, uz);
      if (len < 1) { ux = 1; uz = 0; len = 1; }
    }
    ux /= len; uz /= len;
    const push = 26 * dt + 0.35;
    player.pos.x += ux * push;
    player.pos.z += uz * push;
    player.pos.y = this.realm.heightAt(player.pos.x, player.pos.z) + 1.0;
    // Any velocity still pointing the wrong way is thrown away, or the player
    // would grind against the border instead of being turned round.
    const into = -(player.vel.x * ux + player.vel.z * uz);
    if (into > 0) {
      player.vel.x += ux * into;
      player.vel.z += uz * into;
    }
    this.sealedT = 2.4;
    const el = $('sealed');
    const why = $('sealed-why');
    if (el && this._sealedSaid !== R.id) {
      this._sealedSaid = R.id;
      const g = GUARDIAN_BY_ID.get(R.gate);
      if (why) {
        why.textContent = `${R.name} will not open until `
          + `${g ? g.name : R.gate} is dead.`;
      }
      el.classList.add('show');
      Audio.uiBack();
    } else if (el) el.classList.add('show');
  }

  /** Keys that OPEN a panel. Returns true if one just did. */
  _openKeys(input) {
    if (input.consume('Tab') && this.inventory) {
      this.inventory.onEat = (item) => this._eat(item);
      this.inventory.open(this.progress, this.frogColor, this.skins);
      /**
       * Give the mouse back.
       *
       * The bag has slots and tabs to click, and the game has the pointer
       * captured — so without this the panel is keyboard-only and the cursor
       * is invisible. Releasing the lock would normally drop the pause screen
       * on top; `Game._onLockChange` asks `overworld.frozen` first, which is
       * true from the moment `open` is called above.
       */
      input.releaseLock();
      return true;
    }
    if (input.consume('KeyJ')) { this.journal.toggleLog(this.progress); return true; }
    if (input.consume('KeyM')) {
      this.journal.toggleMap(this.progress, this.player.pos, this.realm);
      return true;
    }
    return false;
  }

  /** Keys while a panel is up. Each panel closes itself; this only routes. */
  _panelKeys(input) {
    if (this.dialogue.open) { this.dialogue.keys(input); return; }
    if (this.inventory && this.inventory.isOpen) {
      if (this.inventory.keys(input)) {
        this.inventory.close();
        this.applyStats();
        this.save();
        // Take the mouse back for looking around. A browser can refuse a
        // lock requested this soon after leaving one, in which case the
        // click-to-play prompt appears and the next click gets it — which is
        // the same path every other mode already relies on.
        input.requestLock();
      }
      return;
    }
    if (this.journal.logOpen && (input.consume('KeyJ') || input.consume('Escape')
      || input.consume('Tab'))) {
      this.journal.closeAll();
      return;
    }
    if (this.journal.mapOpen && (input.consume('KeyM') || input.consume('Escape')
      || input.consume('Tab'))) {
      this.journal.closeAll();
    }
  }

  /** Eating: only when it would do something. Returns whether it landed. */
  _eat(item) {
    const pl = this.player;
    if (!pl || !item.heal) return false;
    if (pl.health.hp >= pl.health.max - 0.5) return false;
    pl.health.hp = Math.min(pl.health.max, pl.health.hp + item.heal);
    this.progress.remove(item.id, 1);
    Audio.refreshed(pl.pos);
    this._syncMeal();
    return true;
  }

  /**
   * The quick meal in the last hotbar slot.
   *
   * The best thing in the bag, so the key is worth pressing — and the bag is
   * still where you choose to eat something else. Kept in step with what is
   * actually carried, because a hotbar slot that offers food you ate ten
   * minutes ago is worse than an empty one.
   */
  _syncMeal() {
    const pl = this.player;
    if (!pl || !pl.inventory) return;
    const food = this.progress.itemsIn('food');
    let best = null;
    for (const row of food) {
      if (!best || row.item.heal > best.item.heal) best = row;
    }
    this._meal = best ? best.item : null;
    pl.inventory.setMeal(best ? best.n : 0);
  }

  /** Eat the hotbar meal. Returns whether anything happened. */
  eatQuick() {
    if (!this._meal) return false;
    const item = this._meal;
    if (!this._eat(item)) {
      this.hud.toast('Not hurt enough to bother.', 1.4);
      return false;
    }
    this.hud.toast(`Ate the ${item.name.toLowerCase()}.`, 1.6);
    this.save();
    return true;
  }

  // ---------------------------------------------------------------- regions

  _region(player) {
    const R = regionAt(player.pos.x, player.pos.z, _scratch);
    if (R === this.region) return;
    const open = regionOpen(R, this.progress.slain);
    this.region = R;

    // Crossing the sky and the music over. Both damp rather than cut, so a
    // border is a couple of seconds of the weather changing round you.
    this.weather.set(R.weather || 'clear');
    Audio.setRegionMood(R.music || 'calm');

    /**
     * A region only counts as SEEN if you were allowed in.
     *
     * Region weights overlap, so standing at the border of a sealed region
     * makes `regionAt` name it — and the main line asks whether regions have
     * been seen. Without this check, walking up to a sealed border would tick
     * off "reach the next region" without ever entering it.
     */
    const first = open && !this.progress.seen.has(R.id);
    if (open) this.progress.seen.add(R.id);
    else this._sealedSaid = null;

    const el = $('region-banner');
    if (el) {
      const name = $('rb-region'), blurb = $('rb-blurb');
      if (name) name.textContent = R.name;
      if (blurb) {
        blurb.textContent = open ? `Tier ${R.tier} · ${R.blurb}`
          : 'SEALED · ' + R.blurb;
      }
      el.classList.toggle('locked', !open);
      el.classList.add('show');
    }
    this.bannerT = 4.5;
    if (first) {
      // Seeing a place for the first time is worth something on its own —
      // it is what makes walking off the road a decision rather than a risk.
      const r = this.progress.addXp(60 + R.tier * 40);
      this._announceLevels(r);
      this.hud.toast(`${R.name} — ${R.blurb}`, 6);
      this.save();
      this._paintObjectives();
    }
  }

  _banner(dt) {
    if (this.bannerT <= 0) return;
    this.bannerT -= dt;
    if (this.bannerT > 0) return;
    const el = $('region-banner');
    if (el) el.classList.remove('show');
  }

  /**
   * Fog and sky, blended toward the region you are in.
   *
   * Damped rather than switched: a hard cut at a region border is the one
   * thing that makes a blended landscape look tiled. The Emberwaste's red
   * haze arrives over about two seconds of walking into it.
   */
  _sky(dt, player) {
    const R = this.region;
    if (!R) return;
    const S = R.sky || {};
    const fog = this.atmo.airFog;
    if (fog) {
      fog.near = damp(fog.near, S.fogNear === undefined ? 90 : S.fogNear, 1.2, dt);
      fog.far = damp(fog.far, S.fogFar === undefined ? 620 : S.fogFar, 1.2, dt);
      if (S.fogColor !== undefined) {
        _fogTarget.setHex(S.fogColor);
        fog.color.lerp(_fogTarget, clamp(dt * 1.2, 0, 1));
      }
    }
    if (this.atmo.skyMat) {
      const u = this.atmo.skyMat.uniforms;
      const lerpTo = (uni, hex, fallback) => {
        _fogTarget.setHex(hex === undefined ? fallback : hex);
        uni.value.lerp(_fogTarget, clamp(dt * 1.2, 0, 1));
      };
      lerpTo(u.uTop, S.skyTop, 0x2f7fd0);
      lerpTo(u.uMid, S.skyMid, 0x79bfee);
      lerpTo(u.uBottom, S.skyBottom, 0xcfe9f5);
    }
    if (this.atmo.sun) {
      this.atmo.sun.intensity = damp(this.atmo.sun.intensity,
        S.sunIntensity === undefined ? 1.0 : S.sunIntensity, 1.2, dt);
    }
  }

  // ------------------------------------------------------------- encounters

  _encounters(dt, player, onHit) {
    const px = player.pos.x, pz = player.pos.z;

    // Frogath is his own thing from start to finish.
    if (this.frogath) { this._updateFrogath(dt, player, onHit); return; }

    if (this.boss) {
      const e = this.bossOf;
      const d = Math.hypot(e.at.x - px, e.at.z - pz);
      /**
       * The killing blow is collected FIRST, before anything asks whether it
       * is alive.
       *
       * `takeDamage` is called from the player's own hit path, so by the time
       * this runs the guardian is already dead and `alive` is already false.
       * Checking `justDied` inside an `if (alive)` branch — which is what
       * this used to do — meant the payout never happened at all: no record,
       * no experience, no loot, and the main line could never advance.
       */
      if (this.boss.justDied) {
        this.boss.justDied = false;
        this._bossDown(e, player);
      }
      if (this.boss.alive) {
        if (d > DROP_AT) { this._dropBoss(); return; }
        // Inside the ring wakes it up. Only once — `begin` is idempotent but
        // the music sting is not.
        if (!this.boss.active && d < e.r + 8) {
          this.boss.begin();
          this.hud.showBossBar(this.boss.name, 1, this.boss.blurb);
          Audio.startBossMusic();
        }
        this.boss.update(dt, player, onHit);
        if (this.boss.active) this.hud.setBossBar(this.boss.fraction);
      } else {
        // Let the body finish falling over, then tidy it away.
        this.boss.update(dt, player, onHit);
        this.deadFor = (this.deadFor || 0) + dt;
        if (this.deadFor > 5) this._dropBoss();
      }
      return;
    }

    /**
     * Nothing live. Frogath first, then the NEAREST guardian still standing.
     *
     * Nearest, not first in the table: the Ashen Throne holds Zehl and the
     * throne itself a hundred and twenty units apart, and taking whichever
     * the table listed first meant standing on the throne built Zehl —
     * so the message telling you why the seat is still guarded was
     * unreachable, and so was Frogath.
     */
    for (const e of this.encounters) {
      if (!e.final || this.progress.slain.has(e.id)) continue;
      if (!regionOpen(e.region, this.progress.slain)) continue;
      const d = Math.hypot(e.at.x - px, e.at.z - pz);
      if (d < e.r + 10) {
        this._maybeFrogath(e, d, player);
        if (this.frogath) return;
      }
    }
    let best = null, bestD = BUILD_AT;
    for (const e of this.encounters) {
      if (e.final || this.progress.slain.has(e.id)) continue;
      // A guardian inside a region you cannot walk into is not an encounter
      // yet. Building it would put a fight on the far side of a sealed
      // border, close enough to be shot at across it.
      if (!regionOpen(e.region, this.progress.slain)) continue;
      const d = Math.hypot(e.at.x - px, e.at.z - pz);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) this._buildBoss(best);
  }

  _buildBoss(e) {
    _v.set(e.at.x, this.realm.heightAt(e.at.x, e.at.z), e.at.z);
    this.boss = new DungeonBoss(0, _v, this.scene, this.effects,
      this.realm.collision, {
        spec: e.spec,
        power: e.power,
        groundAt: (x, z) => this.realm.heightAt(x, z),
      });
    this.bossOf = e;
    this.deadFor = 0;
  }

  _dropBoss() {
    if (this.boss) this.boss.dispose();
    this.boss = null;
    this.bossOf = null;
    this.deadFor = 0;
    this.hud.hideBossBar();
    Audio.stopBossMusic();
  }

  /**
   * A guardian is down.
   *
   * Everything a kill pays out happens here, in one place: the record, the
   * experience, the loot, and the save. Guardians do not come back — the
   * whole main line is counted in how many of them are behind you.
   */
  _bossDown(e, player) {
    const p = this.progress;
    p.slain.add(e.id);
    const xp = Progress.xpFor(e.tier, true);
    const r = p.addXp(xp);
    this.hud.hideBossBar();
    Audio.stopBossMusic();
    this.hud.announce(`${this.boss.name} FALLS`, 'divine', false);
    const said = [`${xp} experience.`];
    for (const it of rollLoot(e.tier, true)) {
      const g = GEAR_BY_ID.get(it.id);
      if (!g) continue;
      if (p.add(it.id, it.n) > 0) {
        said.push(`Taken: ${g.name}${it.n > 1 ? ` ×${it.n}` : ''}.`);
      }
    }
    this.hud.toast(said.join('  '), 7);
    this._announceLevels(r);
    this.economy.award(CFG.economy.roundWinReward * (1 + e.tier), 'GUARDIAN DOWN');
    this.applyStats();
    // Beating one heals you up. The next region is a long walk, and arriving
    // at it on four health is not a difficulty curve, it is a chore.
    player.health.revive();
    player.stamina.reset();
    this._paintObjectives();
    this.save();
  }

  /**
   * The last door.
   *
   * Zehl has to be down first. That is the only gate in the whole realm and
   * it is the story's: twelve guardians, then Zehl, then him. Walk up early
   * and the ground tells you so rather than nothing happening.
   */
  _maybeFrogath(e, d, player) {
    if (d > e.r + 10) return;
    if (!this.progress.slain.has('zehl')) {
      if (!this._toldAboutZehl) {
        this._toldAboutZehl = true;
        this.hud.toast('The seat is guarded. Zehl, the Final Guardian, '
          + 'stands at the Throne Gate.', 7);
      }
      return;
    }
    _v.set(e.at.x, this.realm.heightAt(e.at.x, e.at.z), e.at.z);
    this.frogath = new Frogath(_v, this.scene, this.effects, this.hud,
      this.followCam);
    this.frogathOf = e;
    this.frogath.begin(this._frogathTries > 0);
    this._frogathTries = (this._frogathTries || 0) + 1;
    this.hud.showBossBar('FROGATH, THE FIRST CROAK',
      1, 'He has been waiting the whole time.');
  }

  _updateFrogath(dt, player, onHit) {
    const f = this.frogath;
    f.update(dt, player, this.camera, onHit);
    this.hud.setBossBar(f.fraction);
    if (f.justDied) {
      f.justDied = false;
      const p = this.progress;
      p.slain.add('frogath');
      const r = p.addXp(Progress.xpFor(5, true) * 2);
      this._announceLevels(r);
      /**
       * The blade the game is named for, and it only ever comes from here.
       *
       * Equipped unconditionally rather than only when `add` reports a new
       * item: `equip` TOGGLES, so a second victory would have taken it back
       * out of your hand, and a save that already held it would never have
       * put it in.
       */
      p.add('frogshin', 1);
      if (!p.isEquipped('frogshin')) p.equip('frogshin');
      this.hud.toast('FROGSHIN is yours.', 10);
      this.applyStats();
      this.hud.hideBossBar();
      this.hud.announce('THE FIRST CROAK FALLS', 'divine', true);
      this._paintObjectives();
      this.save();
    }
    /**
     * Leaving the throne takes him away with it.
     *
     * Alive, that means the fight resets — the same rule every guardian gets.
     * Dead, it just tidies up the body once you have walked off the dais.
     */
    const d = Math.hypot(this.frogathOf.at.x - player.pos.x,
      this.frogathOf.at.z - player.pos.z);
    if (d > (f.alive ? DROP_AT : 60)) {
      f.dispose();
      this.frogath = null;
      this.hud.hideBossBar();
      Audio.stopBossMusic();
    }
  }

  // ------------------------------------------------------------------ camps

  _camps(dt, player, onHit) {
    const px = player.pos.x, pz = player.pos.z;
    for (const c of this.camps) {
      const d = Math.hypot(c.at.x - px, c.at.z - pz);
      if (!c.live && d < CAMP_BUILD && !this.progress.camps.has(c.id)) c.spawn();
      else if (c.live && d > CAMP_DROP) { c.despawn(); continue; }
      if (!c.live) continue;
      c.update(dt, player, onHit);
      if (c.cleared && !this.progress.camps.has(c.id)) {
        this.progress.camps.add(c.id);
        const xp = Progress.xpFor(c.spec.tier, false) * c.spec.n;
        const r = this.progress.addXp(xp);
        this.hud.toast(`Camp cleared. ${xp} experience.`, 4);
        this._announceLevels(r);
        this._paintObjectives();
        this.save();
      }
    }
  }

  /** Every live thing the player can hit, in the shape combat expects. */
  targets() {
    const list = [];
    if (this.frogath && this.frogath.fighting) {
      list.push({
        id: 'frogath', pos: this.frogath.pos, dead: false, isDummy: false,
        hitbox: {
          bodyOffset: 3.0, bodyRadius: 5.0,
          headOffset: 8.0, headRadius: 2.6,
          vertical: 14,
        },
        onHit: (dmg) => this.frogath.takeDamage(dmg),
      });
    } else if (this.boss && this.boss.alive && this.boss.active) {
      const s = this.boss.scaleFactor;
      list.push({
        id: 'guardian', pos: this.boss.pos, dead: false, isDummy: false,
        hitbox: {
          bodyOffset: 2.0 * s, bodyRadius: 2.0 * s,
          headOffset: 3.6 * s, headRadius: 1.1 * s,
          vertical: 4.5 * s,
        },
        onHit: (dmg) => this.boss.takeDamage(dmg),
      });
    }
    for (const c of this.camps) {
      if (c.live) c.targets(list, (m) => this._mobDown(m));
    }
    return list;
  }

  _mobDown(mob) {
    if (mob.counted) return;
    mob.counted = true;
    const p = this.progress;
    const r = p.addXp(Progress.xpFor(mob.tier, false));
    for (const it of mob.loot()) p.add(it.id, it.n);
    this._announceLevels(r);
    this.applyStats();
  }

  _announceLevels(r) {
    if (!r || !r.levels || !r.levels.length) return;
    const top = r.levels[r.levels.length - 1];
    this.hud.announce(`LEVEL ${top}`, 'divine', false);
    this.hud.toast(top % 3 === 0
      ? `Level ${top}. You feel a new heart start.`
      : `Level ${top}.`, 4);
    this.applyStats();
    // A level's worth of new max health should actually be in you.
    if (this.player) this.player.health.hp = this.player.health.max;
  }

  // ------------------------------------------------------------- interaction

  /**
   * What E does, here, now.
   *
   * One prompt and one key. The order is: a person to talk to, then a place
   * to examine — a villager standing inside their own village has to win, or
   * you would examine the huts at them.
   */
  _interact(player, input) {
    const px = player.pos.x, pz = player.pos.z;
    const npc = this.people.near(px, pz);
    const site = npc ? null : this.sites.at(px, pz);
    // A site only offers a prompt when there is something in it to find.
    // Standing in a village is not an action; standing at the foot of a
    // hundred-metre statue is.
    const findable = site && (SECRETS[site.id] || site.landmark);
    const secret = findable
      ? (this.progress.found.has(site.id) ? 'again' : 'new') : null;

    this._npcHere = npc;
    this._siteHere = site;
    if (npc) this.prompt = `Talk to ${npc.spec.name}`;
    else if (secret === 'new') this.prompt = `Examine ${site.name}`;
    else if (secret === 'again') this.prompt = site.name;
    else this.prompt = null;

    // The pickup prompt is already E-shaped screen furniture, so reusing it
    // means one prompt in one place rather than two that can both appear.
    this.hud.setPickupPrompt(!!this.prompt, this.prompt || '');

    /**
     * `player.interactPressed`, not `input.consume('KeyE')`.
     *
     * The player controller runs first and consumes E itself — for a supply
     * crate, of which there are none out here — so a second consume in this
     * file would never see the key and E would do nothing at all. The
     * controller already raises this one-shot flag for exactly this case (the
     * story's fruit stalls use it), so the overworld reads the flag and
     * clears it.
     */
    if (!player.interactPressed) return;
    player.interactPressed = false;
    if (!this.prompt) return;
    if (npc) this._talk(npc);
    else if (site) this._examine(site);
  }

  _talk(npc) {
    const p = this.progress;
    const lines = npcSays(npc.spec, p).slice();
    const turns = npc.spec.turns;
    const gives = npc.spec.gives;
    const q = turns ? QUEST_BY_ID.get(turns) : null;
    // Ready to be handed in? That is: everything before the final "hand it
    // in" stage is behind you, and it has not been handed in yet.
    const canTurn = q && p.quests.has(turns) && !p.questDone(turns)
      && questProgress(q, p) >= q.stages.length - 1;

    this.dialogue.start(npc.spec.name, lines, () => {
      if (canTurn) {
        p.finishQuest(turns);
        // Consume what the quest asked for, where it asked for a thing.
        this._takeQuestItems(turns);
        const said = [`${q.name} — done.`, ...grantReward(p, q)];
        this.applyStats();
        this._paintObjectives();
        this.save();
        this.dialogue.start(npc.spec.name, said);
        return;
      }
      if (gives && !p.quests.has(gives)) {
        p.startQuest(gives);
        /**
         * Accepting sets the stage to ONE, not zero.
         *
         * Two quests' first stage is literally "you have spoken to me", and
         * they test it as `questStage(id) > 0`. Leaving a new quest at stage
         * zero would leave those permanently on their first step no matter
         * what the player did.
         */
        p.advanceQuest(gives, 1);
        const gq = QUEST_BY_ID.get(gives);
        this._paintObjectives();
        this.save();
        if (gq) {
          this.hud.toast(gq.side ? `New task — ${gq.name}` : gq.name, 5);
        }
      }
    });
  }

  /** Quests that ask for materials take them when they are handed in. */
  _takeQuestItems(id) {
    const p = this.progress;
    const bill = {
      cutters: ['cut-stone', 5],
      gravekeeper: ['grave-salt', 6],
      coldhearth: ['ember-glass', 3],
      stilts: ['bell-clapper', 1],
    }[id];
    if (bill && p.has(bill[0], bill[1])) p.remove(bill[0], bill[1]);
  }

  /**
   * Examine a place.
   *
   * Only the ones with something to find say anything — and each of those is
   * found exactly once, which is what makes `found` a count of secrets rather
   * than a count of visits.
   */
  _examine(site) {
    const p = this.progress;
    const secret = SECRETS[site.id];
    /**
     * A landmark is its own kind of find.
     *
     * There is no hand-written secret for the twenty-four enormous things,
     * because what they give you is the fact that you now know where they
     * are — so this records them, pays for the walk, and reads their own
     * blurb back. They then show as found on the map, which is what makes
     * them navigation aids rather than scenery.
     */
    if (!secret && site.landmark) {
      const already = p.found.has(site.id);
      if (!already) {
        p.found.add(site.id);
        const R = REGIONS.find((r) => r.id === site.region);
        const r = p.addXp(120 + (R ? R.tier : 0) * 60);
        this._announceLevels(r);
        _v.copy(this.player.pos);
        _v.y += 1;
        this.effects.ring(_v, 1, 10, 0.9, 0xffd76b, true);
        Audio.refreshed(this.player.pos);
        this._paintObjectives();
        this.save();
      }
      this.dialogue.start(site.name,
        [site.blurb || 'You will be able to find your way back to this.']
          .concat(already ? [] : ['Marked on your map.']));
      return;
    }
    if (!secret) {
      this.hud.toast(site.blurb || site.name, 4);
      return;
    }
    if (p.found.has(site.id)) {
      this.dialogue.start(secret.title, secret.say);
      return;
    }
    p.found.add(site.id);
    const said = secret.say.slice();
    for (const it of secret.gives || []) {
      const g = GEAR_BY_ID.get(it.id);
      if (g && p.add(it.id, it.n) > 0) {
        said.push(`Taken: ${g.name}${it.n > 1 ? ` ×${it.n}` : ''}.`);
      }
    }
    if (secret.xp) {
      const r = p.addXp(secret.xp);
      said.push(`${secret.xp} experience.`);
      this._announceLevels(r);
    }
    _v.copy(this.player.pos);
    _v.y += 1;
    this.effects.ring(_v, 1, 8, 0.8, 0xffd76b, true);
    Audio.refreshed(this.player.pos);
    this.dialogue.start(secret.title, said);
    // A secret can hand over gear and food, so the numbers and the hotbar
    // both have to catch up.
    this.applyStats();
    this._paintObjectives();
    this.save();
  }

  // ------------------------------------------------------------------ death

  /**
   * Dying puts you back at the last place with a roof.
   *
   * Not at the start of the region and not where you fell: the first is a
   * punishment measured in walking, the second is a death with no meaning.
   * Everything you had, you keep — the realm's difficulty is in the fights.
   */
  _death(dt, player) {
    if (!player.health.dead) {
      this.deathT = 0;
      // Keep a note of the last safe place, so respawning has somewhere to go.
      const site = this.sites.at(player.pos.x, player.pos.z);
      if (site && (site.kind === 'village' || site.kind === 'shrine'
        || site.kind === 'camp')) {
        this.home = { x: site.at.x, y: site.at.y, z: site.at.z };
      }
      return;
    }
    this.deathT += dt;
    if (this.deathT < 3.2) return;
    this.deathT = 0;
    if (this.boss) this._dropBoss();
    if (this.frogath) {
      this.frogath.dispose();
      this.frogath = null;
      this.hud.hideBossBar();
    }
    const h = this.home || { x: 0, z: 470 };
    player.pos.set(h.x, this.realm.heightAt(h.x, h.z) + 1.4, h.z);
    player.vel.set(0, 0, 0);
    player.health.revive();
    player.stamina.reset();
    if (this.followCam) this.followCam.snapTo(player.pos);
    this.hud.hideRespawn();
    this.realm.streamAround(h.x, h.z, true);
    if (this.scatter) this.scatter.streamAround(h.x, h.z, true);
    this.save();
  }

  // -------------------------------------------------------------------- HUD

  /**
   * The objectives panel, top-left.
   *
   * The id carries the TEXT, not just the row number. `HUD.setObjectives`
   * skips the rebuild when its key has not changed, and that key is built
   * from ids — so numbering the rows `q0..q3` would leave the first line
   * saying "Speak to Old Bram" for the rest of the game.
   */
  _paintObjectives() {
    const rows = Journal.objectives(this.progress).map((o, i) => ({
      id: `${i}:${o.text}`,
      text: o.sub ? `${o.text}  (${o.sub})` : o.text,
      done: o.done,
      active: i === 0,
    }));
    this.hud.setObjectives(rows);
  }

  /** What the main line currently wants, for the HUD and the map. */
  get objective() { return mainObjective(this.progress); }

  // ---------------------------------------------------------------- teardown

  dispose() {
    this.save();
    if (this._savedWater !== null) CFG.world.waterLevel = this._savedWater;
    if (this.boss) this.boss.dispose();
    if (this.frogath) this.frogath.dispose();
    for (const c of this.camps) c.despawn();
    this.camps.length = 0;
    this.encounters.length = 0;
    if (this.life) this.life.dispose();
    if (this.people) this.people.dispose();
    if (this.sites) this.sites.dispose();
    if (this.scatter) this.scatter.dispose();
    if (this.weather) this.weather.dispose();
    // The two module-level material caches. Both are keyed rather than owned
    // by an instance, so nothing else will ever free them.
    disposeVillagerMats();
    disposeLandmarkMats();
    Audio.stopRegionMusic();
    this.realm.dispose();
    this.dialogue.close();
    this.journal.closeAll();
    if (this.inventory) this.inventory.close();
    for (const id of ['region-banner', 'sealed']) {
      const el = $(id);
      if (el) el.classList.remove('show');
    }
    this.hud.setPickupPrompt(false, '');
  }
}
