/**
 * THE THINGS BETWEEN THE BOSSES — camp mobs.
 *
 * A guardian is a set-piece: one fight, one arena, a health bar across the top
 * of the screen. These are the opposite — three to six small creatures around
 * a fire, and the reason walking across a region is not a walk.
 *
 * ── why they are built from the guardian rig ───────────────────────────────
 * `buildGuardian` already turns a spec into a body with a silhouette, a head,
 * a weapon and its own palette. Writing a second creature builder for the
 * small ones would mean two places to fix a leg, and eleven kinds that all
 * looked like each other. They get the same rig at two-thirds the size, with
 * their own specs — so a Frostling and an Emberling are recognisably different
 * animals, and neither is a recoloured guardian.
 *
 * ── the contract with the player ───────────────────────────────────────────
 * Same as the dungeon's: nothing may hurt you that did not draw itself on the
 * floor first. A mob telegraphs with a ring exactly the size of its reach,
 * holds it for the wind-up, and only then swings. They are quick, not unfair.
 */

import * as THREE from '../lib/three.module.js?v=v83';
import { damp, dampAngle, clamp, mulberry32 } from './util.js?v=v83';
import { buildGuardian } from './guardians.js?v=v83';
import { rollLoot } from './gear.js?v=v83';

const _to = new THREE.Vector3();
const _at = new THREE.Vector3();

const WARN = 0xff7a3c;

/**
 * The eleven kinds, keyed by the name the region table uses.
 *
 * `rig` is a guardian spec. `reach` is both the telegraph radius and the hit
 * radius — one number, so the ring on the floor cannot lie about the danger.
 */
export const MOB_KINDS = {
  lurker: {
    name: 'MIRE LURKER', reach: 3.2, scale: 0.62, speed: 7.0, sight: 30,
    rig: { id: 'lurker', name: 'MIRE LURKER', body: 'lean',
      skin: 0x4a6b4a, dark: 0x2e4630, trim: 0x8fc47a,
      head: 'eel', weapon: 'none', horns: 0, eyes: 0x9fe86b },
  },
  reedstalker: {
    name: 'REEDSTALKER', reach: 3.8, scale: 0.66, speed: 7.6, sight: 34,
    rig: { id: 'reedstalker', name: 'REEDSTALKER', body: 'lean',
      skin: 0x53664a, dark: 0x35422e, trim: 0xc9d98f,
      head: 'toad', weapon: 'spear', horns: 0, eyes: 0xffd76b },
  },
  thornling: {
    name: 'THORNLING', reach: 3.0, scale: 0.58, speed: 8.2, sight: 28,
    rig: { id: 'thornling', name: 'THORNLING', body: 'hulk',
      skin: 0x35521f, dark: 0x213515, trim: 0x8fc44a,
      head: 'mossy', weapon: 'none', horns: 2, eyes: 0xc9ff6b },
  },
  stonewarden: {
    name: 'STONE WARDEN', reach: 3.6, scale: 0.72, speed: 5.4, sight: 26,
    rig: { id: 'stonewarden', name: 'STONE WARDEN', body: 'stone',
      skin: 0x6d6a63, dark: 0x46443f, trim: 0x9a9790,
      head: 'blunt', weapon: 'club', horns: 0, eyes: 0xffd76b },
  },
  drowned: {
    name: 'THE DROWNED', reach: 3.2, scale: 0.66, speed: 6.4, sight: 30,
    rig: { id: 'drowned', name: 'THE DROWNED', body: 'wraith',
      skin: 0x3a5060, dark: 0x24333e, trim: 0x8fc4d9,
      head: 'skull', weapon: 'none', horns: 0, eyes: 0x8fd8ff },
  },
  windrider: {
    name: 'WINDRIDER', reach: 3.4, scale: 0.64, speed: 9.0, sight: 38,
    rig: { id: 'windrider', name: 'WINDRIDER', body: 'lean',
      skin: 0x8fa4bc, dark: 0x5d6c80, trim: 0xdfeaff,
      head: 'horned', weapon: 'spear', horns: 2, eyes: 0x6cf0ff },
  },
  bonepicker: {
    name: 'BONEPICKER', reach: 3.0, scale: 0.62, speed: 8.4, sight: 32,
    rig: { id: 'bonepicker', name: 'BONEPICKER', body: 'lean',
      skin: 0xcfc5b4, dark: 0x8f8878, trim: 0xf2f5f8,
      head: 'skull', weapon: 'twin', horns: 0, eyes: 0xff7a3c },
  },
  emberling: {
    name: 'EMBERLING', reach: 3.4, scale: 0.64, speed: 7.8, sight: 30,
    rig: { id: 'emberling', name: 'EMBERLING', body: 'hulk',
      skin: 0x7a2f1e, dark: 0x4a1a10, trim: 0xff8a3c,
      head: 'horned', weapon: 'club', horns: 2, eyes: 0xffca4a },
  },
  palething: {
    name: 'PALE THING', reach: 3.2, scale: 0.68, speed: 6.8, sight: 22,
    rig: { id: 'palething', name: 'PALE THING', body: 'wraith',
      skin: 0xdedbd2, dark: 0xa8a49a, trim: 0xffffff,
      head: 'skull', weapon: 'none', horns: 0, eyes: 0xd8f0ff },
  },
  cityhusk: {
    name: 'CITY HUSK', reach: 3.8, scale: 0.74, speed: 6.2, sight: 30,
    rig: { id: 'cityhusk', name: 'CITY HUSK', body: 'stone',
      skin: 0x5a5348, dark: 0x38332c, trim: 0xc9a227,
      head: 'crowned', weapon: 'great', horns: 0, eyes: 0xff8a3c },
  },
  frostling: {
    name: 'FROSTLING', reach: 3.4, scale: 0.64, speed: 7.4, sight: 32,
    rig: { id: 'frostling', name: 'FROSTLING', body: 'lean',
      skin: 0x9fc2dd, dark: 0x6a8ba8, trim: 0xf6f9fc,
      head: 'horned', weapon: 'spear', horns: 3, eyes: 0xbff0ff },
  },

  // ── the Croaklands' own ────────────────────────────────────────────────
  scarecrow: {
    name: 'SCARECROW', reach: 3.2, scale: 0.60, speed: 6.2, sight: 24,
    rig: { id: 'scarecrow', name: 'SCARECROW', body: 'lean',
      skin: 0x9a8a4a, dark: 0x63582c, trim: 0xd9c46a,
      head: 'blunt', weapon: 'spear', horns: 0, eyes: 0xff8a3c },
  },
  husk: {
    name: 'CITY HUSK', reach: 3.4, scale: 0.68, speed: 6.8, sight: 28,
    rig: { id: 'husk', name: 'HUSK', body: 'wraith',
      skin: 0x6a6a7a, dark: 0x42424e, trim: 0xb0b8c4,
      head: 'crowned', weapon: 'none', horns: 0, eyes: 0xa8d8ff },
  },
  mirebeast: {
    name: 'MIREBEAST', reach: 3.6, scale: 0.70, speed: 6.6, sight: 28,
    rig: { id: 'mirebeast', name: 'MIREBEAST', body: 'hulk',
      skin: 0x466055, dark: 0x2b3c34, trim: 0x8fc4b0,
      head: 'eel', weapon: 'none', horns: 0, eyes: 0xa8f0d8 },
  },
  dunestalker: {
    name: 'DUNESTALKER', reach: 3.6, scale: 0.66, speed: 8.6, sight: 36,
    rig: { id: 'dunestalker', name: 'DUNESTALKER', body: 'lean',
      skin: 0xc4a06a, dark: 0x8a6a3c, trim: 0xffe0a0,
      head: 'toad', weapon: 'twin', horns: 0, eyes: 0xff7a3c },
  },
  cinderhound: {
    name: 'CINDERHOUND', reach: 3.2, scale: 0.62, speed: 9.2, sight: 34,
    rig: { id: 'cinderhound', name: 'CINDERHOUND', body: 'lean',
      skin: 0x6a2418, dark: 0x3f120c, trim: 0xff8a3c,
      head: 'horned', weapon: 'none', horns: 2, eyes: 0xffca4a },
  },
  rimewraith: {
    name: 'RIMEWRAITH', reach: 3.4, scale: 0.68, speed: 7.0, sight: 30,
    rig: { id: 'rimewraith', name: 'RIMEWRAITH', body: 'wraith',
      skin: 0xb8d4e4, dark: 0x7d9cb0, trim: 0xffffff,
      head: 'skull', weapon: 'none', horns: 0, eyes: 0xbff0ff },
  },
  prismling: {
    name: 'PRISMLING', reach: 3.0, scale: 0.58, speed: 8.0, sight: 30,
    rig: { id: 'prismling', name: 'PRISMLING', body: 'stone',
      skin: 0x5a6aa8, dark: 0x35406a, trim: 0xa8f0ff,
      head: 'horned', weapon: 'none', horns: 3, eyes: 0xffffff },
  },
};

const STATE = { WAIT: 0, WANDER: 1, CHASE: 2, WIND: 3, HIT: 4, REST: 5, DEAD: 6 };

export class Mob {
  /**
   * @param kind    key into MOB_KINDS
   * @param tier    0-5, from the camp; scales health, damage and reward
   * @param home    {x, y, z} it wanders around and returns to
   * @param groundAt (x, z) => y, so it walks the terrain instead of a plane
   */
  constructor(kind, tier, home, scene, effects, groundAt) {
    const K = MOB_KINDS[kind] || MOB_KINDS.lurker;
    this.kind = kind;
    this.K = K;
    this.tier = tier;
    this.scene = scene;
    this.effects = effects;
    this.groundAt = groundAt;

    this.maxHealth = Math.round(34 + tier * 26);
    this.health = this.maxHealth;
    this.damage = Math.round(7 + tier * 4.5);
    this.speed = K.speed;
    this.reach = K.reach;

    this.rig = buildGuardian(K.rig);
    this.rig.root.scale.setScalar(K.scale);
    this.hovers = this.rig.hover;

    this.home = new THREE.Vector3(home.x, home.y, home.z);
    this.pos = this.home.clone();
    this.goal = this.home.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw + Math.PI;
    scene.add(this.rig.root);

    this.state = STATE.WAIT;
    this.timer = Math.random() * 2.5;
    this.moveSpeed = 0;
    this.t = Math.random() * 6;
    this.stride = 0;
    this.hurtT = 0;
    this.swingT = 0;
    this.justDied = false;
    /** Set once, by whoever awards the kill. */
    this.counted = false;
  }

  get alive() { return this.health > 0; }
  get name() { return this.K.name; }

  /** The shape the player's katana and kunai test against. */
  target(onDead) {
    const s = this.K.scale;
    return {
      id: this.id, pos: this.pos, dead: !this.alive, isDummy: false,
      hitbox: {
        bodyOffset: 1.5 * s, bodyRadius: 1.7 * s,
        headOffset: 2.6 * s, headRadius: 0.9 * s,
        vertical: 3.6,
      },
      onHit: (dmg) => { if (this.takeDamage(dmg) && onDead) onDead(this); },
    };
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtT = 0.16;
    // Being hit makes it notice you, whatever it was doing. A mob you can
    // shoot from thirty units while it wanders is not an encounter.
    if (this.state === STATE.WAIT || this.state === STATE.WANDER) {
      this.state = STATE.CHASE;
      this.timer = 0;
    }
    _at.set(this.pos.x, this.pos.y + 1.6 * this.K.scale, this.pos.z);
    this.effects.hitBurst(_at, { x: 0, y: 0, z: 1 }, amount > 30);
    if (this.health <= 0) {
      this.state = STATE.DEAD;
      this.justDied = true;
      this.effects.deathBurst(_at, this.K.rig.trim);
      return true;
    }
    return false;
  }

  /** What it was carrying. Rolled on death, from the camp's tier. */
  loot(rnd = Math.random) { return rollLoot(this.tier, false, rnd); }

  update(dt, player, onHit) {
    this.t += dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.swingT > 0) this.swingT -= dt;

    if (this.state === STATE.DEAD) {
      // Sink and fade. The overworld removes it once it is under the ground.
      this.pos.y -= dt * 1.6;
      this.rig.root.position.copy(this.pos);
      this.rig.root.rotation.z = damp(this.rig.root.rotation.z, 1.3, 6, dt);
      return;
    }

    const px = player.pos.x, pz = player.pos.z;
    const dist = Math.hypot(px - this.pos.x, pz - this.pos.z);
    const homeDist = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
    this.timer -= dt;

    switch (this.state) {
      case STATE.WAIT:
        this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
        if (dist < this.K.sight) { this.state = STATE.CHASE; break; }
        if (this.timer <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = 6 + Math.random() * 14;
          this.goal.set(this.home.x + Math.cos(a) * r, 0,
            this.home.z + Math.sin(a) * r);
          this.state = STATE.WANDER;
          this.timer = 4;
        }
        break;

      case STATE.WANDER: {
        if (dist < this.K.sight) { this.state = STATE.CHASE; break; }
        const d = this._walkTo(this.goal.x, this.goal.z, this.speed * 0.35, dt);
        if (d < 1.4 || this.timer <= 0) {
          this.state = STATE.WAIT;
          this.timer = 1 + Math.random() * 3;
        }
        break;
      }

      case STATE.CHASE:
        /**
         * A leash, and why.
         *
         * A mob that follows forever turns every camp into a train you drag
         * across the region, and eleven of them arrive at the next boss with
         * you. Past 90 units from its fire it goes home — which also means a
         * player who does not want the fight can simply leave.
         */
        if (homeDist > 90 && dist > 20) {
          this.state = STATE.REST;
          this.timer = 0;
          break;
        }
        if (dist > this.K.sight * 1.6) {
          this.state = STATE.WAIT;
          this.timer = 1.5;
          break;
        }
        this._walkTo(px, pz, this.speed, dt);
        if (dist < this.reach * 0.92 && this.timer <= 0) {
          this.state = STATE.WIND;
          this.timer = 0.55;
          // The ring IS the hitbox. See the file header.
          _at.set(px, this.groundAt(px, pz) + 0.1, pz);
          this.effects.ring(_at, this.reach, this.reach, 0.55, WARN, true);
          this.strikeAt = { x: px, z: pz };
        }
        break;

      case STATE.WIND:
        this.moveSpeed = damp(this.moveSpeed, 0, 12, dt);
        if (this.timer <= 0) {
          this.state = STATE.HIT;
          this.timer = 0.18;
          this.swingT = 0.3;
          // Hit test against where the marker was drawn, not where the player
          // is now — that is what makes walking out of it work.
          const s = this.strikeAt;
          const dx = px - s.x, dz = pz - s.z;
          const low = player.pos.y < this.pos.y + 2.4;
          if (Math.hypot(dx, dz) < this.reach && low && onHit) {
            onHit(this.damage, this.pos);
          }
        }
        break;

      case STATE.HIT:
        if (this.timer <= 0) { this.state = STATE.REST; this.timer = 0.7; }
        break;

      case STATE.REST:
        this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
        if (this.timer > 0) break;
        if (homeDist > 90) {
          const d = this._walkTo(this.home.x, this.home.z, this.speed * 0.8, dt);
          if (d < 6) { this.state = STATE.WAIT; this.timer = 1; }
        } else {
          this.state = dist < this.K.sight ? STATE.CHASE : STATE.WAIT;
          this.timer = 0.3;
        }
        break;

      default: break;
    }

    // Ground follow. Mobs have no collider of their own — they are small and
    // the terrain is what they are actually walking on — so the height
    // function is the whole of their physics.
    const gy = this.groundAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gy + (this.hovers ? 1.4 : 0), 12, dt);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw + Math.PI;
    this._animate(dt);
  }

  /** Step toward a point, turning first. Returns the distance remaining. */
  _walkTo(x, z, speed, dt) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6, dt);
    }
    if (d > 1.0) {
      this.pos.x += (dx / d) * speed * dt;
      this.pos.z += (dz / d) * speed * dt;
      this.moveSpeed = speed;
    } else {
      this.moveSpeed = damp(this.moveSpeed, 0, 8, dt);
    }
    return d;
  }

  /**
   * Legs, arms and the wind-up.
   *
   * The limb names are the guardian rig's — `leg.hip` / `leg.shin` and
   * `arm.shoulder` / `arm.fore` — and `leg.side` is what puts the two legs out
   * of phase. Wraith kinds have no legs at all (the rig gives them none), so
   * the loop simply does not run for them and they drift instead.
   */
  _animate(dt) {
    const r = this.rig;
    const walk = clamp(this.moveSpeed / this.speed, 0, 1);
    this.stride += dt * (3 + walk * 9);
    const sw = Math.sin(this.stride);
    if (this.hovers) {
      r.body.position.y = Math.sin(this.t * 1.5) * 0.18;
    } else {
      r.body.position.y = Math.abs(sw) * 0.08 * walk + Math.sin(this.t * 1.7) * 0.02;
      for (const leg of r.legs) {
        const phase = leg.side > 0 ? sw : -sw;
        leg.hip.rotation.x = damp(leg.hip.rotation.x,
          walk > 0.1 ? phase * 0.6 : -0.15, 14, dt);
        leg.shin.rotation.x = damp(leg.shin.rotation.x,
          walk > 0.1 ? clamp(-phase, 0, 1) * 0.8 + 0.1 : 0.4, 14, dt);
      }
    }
    // Wind-up raises the arms; the strike drops them.
    const wind = this.state === STATE.WIND ? 1 - clamp(this.timer / 0.55, 0, 1) : 0;
    const swing = clamp(this.swingT / 0.3, 0, 1);
    for (const arm of r.arms) {
      const phase = arm.side > 0 ? -sw : sw;
      const idle = walk > 0.1 ? phase * 0.45 : 0.08;
      arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x,
        -wind * 1.8 + swing * 1.1 + idle * (1 - wind), 12, dt);
      arm.fore.rotation.x = damp(arm.fore.rotation.x, -0.45 - wind * 0.5, 10, dt);
    }
    // A hit flashes the hide, so a kunai at range still reads as landing.
    const lit = this.hurtT > 0 ? 0.6 : 0;
    r.mats.skin.emissive.setRGB(lit, lit * 0.3, lit * 0.2);
    if (this.hurtT > 0) r.body.position.x = Math.sin(this.hurtT * 90) * 0.06;
    else r.body.position.x = damp(r.body.position.x, 0, 12, dt);
  }

  dispose() {
    this.scene.remove(this.rig.root);
    for (const k in this.rig.mats) this.rig.mats[k].dispose();
  }
}

/**
 * A camp: some number of one kind of thing, around a point.
 *
 * Camps are built when the player comes near and torn down when they leave,
 * so nineteen camps across three thousand units cost nothing until you walk
 * into one. `cleared` is remembered in the save by "regionId:index", so a camp
 * you have wiped out stays wiped out.
 */
export class Camp {
  constructor(spec, region, index, scene, effects, realm) {
    this.spec = spec;
    this.region = region;
    this.index = index;
    this.id = `${region.id}:${index}`;
    this.scene = scene;
    this.effects = effects;
    this.realm = realm;
    this.mobs = [];
    this.live = false;
    // Placed once, so the fire does not move between visits.
    const hint = realm.placeSpot(spec.at[0], spec.at[1], 18, region, 0.34);
    this.at = hint;
  }

  spawn() {
    if (this.live) return;
    this.live = true;
    const rnd = mulberry32(
      (Math.round(this.at.x) * 73856093) ^ (Math.round(this.at.z) * 19349663));
    const groundAt = (x, z) => this.realm.heightAt(x, z);
    for (let i = 0; i < this.spec.n; i++) {
      const a = (i / this.spec.n) * Math.PI * 2 + rnd() * 0.7;
      const r = 5 + rnd() * 9;
      const x = this.at.x + Math.cos(a) * r, z = this.at.z + Math.sin(a) * r;
      const m = new Mob(this.spec.kind, this.spec.tier,
        { x, y: groundAt(x, z), z }, this.scene, this.effects, groundAt);
      m.id = `${this.id}:${i}`;
      this.mobs.push(m);
    }
  }

  despawn() {
    for (const m of this.mobs) m.dispose();
    this.mobs.length = 0;
    this.live = false;
  }

  get cleared() { return this.live && this.mobs.every((m) => !m.alive); }

  update(dt, player, onHit) {
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      m.update(dt, player, onHit);
      // Gone under the ground: nothing left to draw or test against.
      if (!m.alive && m.pos.y < this.realm.heightAt(m.pos.x, m.pos.z) - 3) {
        m.dispose();
        this.mobs.splice(i, 1);
      }
    }
  }

  targets(list, onDead) {
    for (const m of this.mobs) if (m.alive) list.push(m.target(onDead));
  }
}
