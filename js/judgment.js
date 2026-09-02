/**
 * THE LAST JUDGMENT — the arena behind the statue.
 *
 * A single room and a single fight. You get here by beating the First Croak
 * on a no-checkpoint run, carrying his crystal to the stone frog in the
 * arena, and giving it up. There is no way out except winning or quitting,
 * which is the point.
 *
 * The arena is deliberately huge and almost empty: the Ascended covers
 * enormous distances and most of his attacks are about where you are
 * standing, so cover would only make his patterns unreadable.
 */

import * as THREE from '../lib/three.module.js?v=v34';
import { CFG } from './config.js?v=v34';
import { clamp } from './util.js?v=v34';
import { Terrain, CollisionWorld } from './collision.js?v=v34';
import { Ascended } from './ascended.js?v=v34';
import { Audio } from './audio.js?v=v34';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const ORIGIN = new THREE.Vector3(4200, 600, 0);

class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(x, y, z, sx, sy, sz, color, ry = 0) {
    this.items.push([x, y, z, sx, sy, sz, color, ry]);
  }
  build(scene) {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      _e.set(0, it[7], 0);
      _q.setFromEuler(_e);
      _v.set(it[0], it[1], it[2]);
      _s.set(it[3], it[4], it[5]);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setHex(it[6]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    return mesh;
  }
}

export class JudgmentRun {
  constructor(opts) {
    this.scene = opts.scene;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.camera = opts.camera;
    this.followCam = opts.followCam;

    this.boss = null;
    this.state = 'entering';
    this.deaths = 0;
    this.timer = 0;
    this.onVictory = null;
    this.center = ORIGIN.clone();
  }

  get collision() { return this._collision; }
  get spawnPoint() {
    return new THREE.Vector3(
      ORIGIN.x - CFG.ascended.arenaRadius * 0.7, ORIGIN.y + 0.6, ORIGIN.z);
  }

  buildTasks() {
    const A = CFG.ascended;
    return [
      ['Opening the way', () => {
        this.terrain = new Terrain(240, 33, () => -600);
        this._collision = new CollisionWorld(this.terrain);
        const mat = () => new THREE.MeshLambertMaterial({});
        this.batches = {
          box: new Batch(new THREE.BoxGeometry(1, 1, 1), mat()),
          post: new Batch(new THREE.CylinderGeometry(1, 1, 1, 8), mat()),
        };
      }],
      ['Laying the judgment floor', () => this._floor()],
      ['Raising the pillars of heaven', () => this._pillars()],
      ['Sealing it behind you', () => {
        for (const k in this.batches) this.batches[k].mesh = this.batches[k].build(this.scene);
        this._collision.bake();
      }],
    ];
  }

  _floor() {
    const A = CFG.ascended;
    const B = this.batches;
    const R = A.arenaRadius;
    const step = 6;
    for (let x = -R; x <= R; x += step) {
      for (let z = -R; z <= R; z += step) {
        if (Math.hypot(x + step / 2, z + step / 2) > R) continue;
        B.box.add(ORIGIN.x + x + step / 2, ORIGIN.y - 0.16, ORIGIN.z + z + step / 2,
          step + 0.06, 0.34, step + 0.06, 0x0b0a12);
      }
    }
    this._collision.addBox(ORIGIN.x, ORIGIN.y - 0.16, ORIGIN.z, R + 2, 0.17, R + 2, 'stone');

    // Concentric gold inlay: it reads as a seal, and it gives the eye
    // something to judge distance against during his wider attacks.
    for (const r of [14, 26, 38, 48]) {
      const n = Math.round(r * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        B.box.add(ORIGIN.x + Math.cos(a) * r, ORIGIN.y + 0.03, ORIGIN.z + Math.sin(a) * r,
          1.8, 0.06, 1.8, r === 48 ? 0x6a5210 : 0xc9a227, a);
      }
    }
  }

  _pillars() {
    const A = CFG.ascended;
    const B = this.batches;
    const R = A.arenaRadius;
    // A ring of broken pillars well outside the floor: they mark the edge
    // without ever being something to hide behind.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const x = ORIGIN.x + Math.cos(a) * (R + 7);
      const z = ORIGIN.z + Math.sin(a) * (R + 7);
      const h = 26 + (i % 4) * 9;
      B.post.add(x, ORIGIN.y + h / 2, z, 3.4, h, 3.4, 0x14121c);
      B.box.add(x, ORIGIN.y + h + 1, z, 5.2, 2, 5.2, 0x1c1928, a);
      this._collision.addBox(x, ORIGIN.y + h / 2, z, 2.2, h / 2, 2.2, 'stone');
    }
    // And a wall of barriers just past the floor, so the arena is closed.
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      this._collision.addBox(
        ORIGIN.x + Math.cos(a) * (R + 2.5), ORIGIN.y + 14, ORIGIN.z + Math.sin(a) * (R + 2.5),
        3.0, 14, 3.0, 'barrier');
    }
  }

  // ------------------------------------------------------------------ flow

  start(player) {
    this.state = 'entering';
    this.timer = 0;
    player.pos.copy(this.spawnPoint);
    player.vel.set(0, 0, 0);
    player.health.revive();
    player.stamina.reset();
    this.followCam.snapTo(player.pos);
    this.hud.hideBossBar();
    this.hud.setObjectives([{
      id: 'judgment', text: 'FROGATH, THE ASCENDED', done: false, active: true,
    }]);
    this.boss = new Ascended(this.center, this.scene, this.effects, this.hud,
      this.followCam);
    Audio.stopBossMusic();
    Audio.stopAmbient();
  }

  update(dt, player, onHit, skipHeld) {
    if (!this.boss) return;

    if (this.boss.inEntrance) {
      const p = this.boss.updateSkip(dt, !!skipHeld);
      if (this.boss.skippable) {
        this.hud.setTutorial('HOLD', 'SPACE',
          p > 0 ? `SKIPPING… ${Math.round(p * 100)}%` : 'TO SKIP');
      }
      if (!this.boss.inEntrance) this.hud.setTutorial(null);
    }

    if (this.state === 'entering') {
      const d = Math.hypot(player.pos.x - this.center.x, player.pos.z - this.center.z);
      if (d < 30) {
        this.state = 'fight';
        player.cinematic = true;
        player.vel.set(0, 0, 0);
        this.hud.setCinematic(true);
        this.boss.begin(this.deaths > 0);
      }
      return;
    }

    if (this.state === 'fight') {
      this.boss.update(dt, player, this.camera, onHit);
      if (this.boss.fighting && player.cinematic) {
        player.cinematic = false;
        this.hud.setCinematic(false);
      }
      this.hud.setBossBar(this.boss.fraction);
      if (this.boss.justDied) { this.boss.justDied = false; this._won(player); }
      else if (player.health.dead) this._died(player);
      return;
    }

    if (this.state === 'dead') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.hud.clearAnnounce();
        this.boss.dispose();
        this.start(player);
      }
      return;
    }
    if (this.state === 'won') {
      this.timer += dt;
      this.boss.update(dt, player, this.camera, () => {});
    }
  }

  _died(player) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.timer = 3.0;
    this.deaths++;
    this.hud.hideBossBar();
    this.hud.setCinematic(false);
    this.hud.setSubtitle('');
    this.hud.setTutorial(null);
    this.hud.announce('JUDGED', 'danger', true);
    Audio.stopBossMusic();
  }

  _won(player) {
    this.state = 'won';
    this.timer = 0;
    this.hud.hideBossBar();
    this.hud.setCinematic(false);
    this.hud.setSubtitle('');
    this.hud.announce('THE ASCENDED HAS FALLEN', 'good', true);
    this.hud.setObjectives([{
      id: 'judgment', text: 'FROGATH, THE ASCENDED', done: true, active: false,
    }]);
    Audio.stopBossMusic();
    Audio.respawn(player.pos);
    _v.copy(this.center);
    this.effects.ring(_v, 1, 120, 3.0, 0xffffff, true);
    this.followCam.shake(2.5);
    if (this.onVictory) this.onVictory();
  }

  /** The boss as a hittable target, for the shared combat and kunai code. */
  bossTarget() {
    if (!this.boss || !this.boss.fighting || !this.boss.alive) return null;
    return {
      id: 'ascended', pos: this.boss.pos, dead: false, isDummy: false,
      hitbox: {
        bodyOffset: 5.0, bodyRadius: 7.0,
        headOffset: 12.0, headRadius: 3.4,
        vertical: 20,
      },
      onHit: (dmg) => this.boss.takeDamage(dmg),
    };
  }

  damageBoss(amount) {
    if (this.boss && this.boss.fighting) this.boss.takeDamage(amount);
  }

  update_(dt) { /* kept for symmetry with DungeonRun */ }

  dispose() {
    if (this.boss) { this.boss.dispose(); this.boss = null; }
    this.hud.hideBossBar();
    this.hud.setObjectives(null);
    this.hud.setSubtitle('');
    this.hud.setCinematic(false);
    this.hud.setTutorial(null);
  }
}
