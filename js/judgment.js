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

import * as THREE from '../lib/three.module.js?v=v64';
import { CFG } from './config.js?v=v64';
import { clamp, lerp } from './util.js?v=v64';
import { Terrain, CollisionWorld } from './collision.js?v=v64';
import { Ascended } from './ascended.js?v=v64';
import { Audio } from './audio.js?v=v64';

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

  /** Below this you have fallen out of the arena — see Game._voidGuard. */
  get voidY() { return ORIGIN.y - CFG.move.voidDepth; }
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
      ['Cracking what comes next', () => this._buildAscendedArena()],
      ['Sealing it behind you', () => {
        for (const k in this.batches) this.batches[k].mesh = this.batches[k].build(this.scene);
        this._collision.bake();
      }],
    ];
  }

  /**
   * The phase-2 arena, built up front and hidden.
   *
   * It has to appear on the exact frame he tells it to, so none of it is
   * created during the fight: the platforms exist from the start with their
   * colliders disabled and their meshes parked below the floor, and the
   * ascension only ever flips switches.
   */
  _buildAscendedArena() {
    const A = CFG.ascended;
    const R = A.arenaRadius;

    // ---- floating platforms ----
    // Real ground you can stand on, placed OUTSIDE the ring the ground waves
    // cover, so they are an answer to those attacks rather than decoration.
    // Individual meshes, not instanced: they have to move.
    this.platforms = [];
    const mat = new THREE.MeshLambertMaterial({ color: 0x171426 });
    const edge = new THREE.MeshBasicMaterial({ color: 0xc9a227 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const rad = R * 0.62 + (i % 2) * 9;
      const x = ORIGIN.x + Math.cos(a) * rad;
      const z = ORIGIN.z + Math.sin(a) * rad;
      const y = ORIGIN.y + 7 + (i % 3) * 4.5;
      const w = 13 - (i % 3) * 2;

      const g = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, w), mat);
      g.add(slab);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.14, w * 0.8), edge);
      rim.position.y = 0.86;
      g.add(rim);
      // Broken rock hanging under it, so it reads as torn out of the floor.
      for (let k = 0; k < 4; k++) {
        const s = 2 + Math.random() * 3;
        const chunk = new THREE.Mesh(new THREE.BoxGeometry(s, s * 1.6, s), mat);
        chunk.position.set((Math.random() - 0.5) * w * 0.6, -1.4 - Math.random() * 2.5,
          (Math.random() - 0.5) * w * 0.6);
        chunk.rotation.set(Math.random(), Math.random(), Math.random());
        g.add(chunk);
      }
      g.position.set(x, ORIGIN.y - 40, z);      // parked below, invisible
      g.visible = false;
      this.scene.add(g);

      const box = this._collision.addBox(x, y, z, w / 2, 0.8, w / 2, 'stone');
      box.disabled = true;
      this.platforms.push({ group: g, box, x, y, z, rise: 0, phase: i * 0.7 });
    }

    // ---- cracks across the floor ----
    this.cracks = [];
    const crackMat = new THREE.MeshBasicMaterial({
      color: 0xffd76b, transparent: true, opacity: 0,
    });
    this.crackMat = crackMat;
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + Math.random() * 0.2;
      const len = 16 + Math.random() * (R - 14);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, len), crackMat);
      m.position.set(
        ORIGIN.x + Math.cos(a) * (len * 0.5 + 4), ORIGIN.y + 0.08,
        ORIGIN.z + Math.sin(a) * (len * 0.5 + 4));
      m.rotation.y = -a + Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this.cracks.push(m);
    }

    // ---- cracks across the sky ----
    // The dark above the arena is split by seams of divine light. Placed high
    // and wide so they read as the sky itself giving way, and never as
    // something in the play space.
    this.skyCracks = [];
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0xffd76b, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.skyMat = skyMat;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const len = 90 + Math.random() * 130;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, len), skyMat);
      const rad = R * 0.5 + Math.random() * R;
      m.position.set(
        ORIGIN.x + Math.cos(a) * rad,
        ORIGIN.y + 120 + Math.random() * 90,
        ORIGIN.z + Math.sin(a) * rad);
      m.rotation.set(Math.random() * 0.6 - 0.3, -a + Math.random(), Math.random() * 0.5);
      m.visible = false;
      this.scene.add(m);
      this.skyCracks.push({ mesh: m, phase: Math.random() * 6.28 });
    }

    // ---- the symbol he stands on ----
    this.symbol = new THREE.Group();
    const symMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false,
    });
    this.symbolMat = symMat;
    for (const rr of [30, 24, 17]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.5, 6, 64), symMat);
      ring.rotation.x = Math.PI / 2;
      this.symbol.add(ring);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 13), symMat);
      spoke.position.set(Math.cos(a) * 23, 0, Math.sin(a) * 23);
      spoke.rotation.y = -a + Math.PI / 2;
      this.symbol.add(spoke);
    }
    this.symbol.position.set(ORIGIN.x, ORIGIN.y + 0.12, ORIGIN.z);
    this.symbol.visible = false;
    this.scene.add(this.symbol);

    this.ascendedArena = false;
    this.arenaT = 0;
    this.collapse = 0;

    // The sky as it was when the room was built. Captured HERE rather than at
    // the ascension: recording it on the way in would overwrite the real
    // value with the darkened one on any second pass, and the original would
    // be gone for good.
    this._fogWas = this.scene.fog ? this.scene.fog.color.getHex() : null;
    this._bgWas = this.scene.background && this.scene.background.getHex
      ? this.scene.background.getHex() : null;
  }

  /** Called by the boss on the ascension. Everything here is a switch flip. */
  ascendArena() {
    if (this.ascendedArena) return;
    this.ascendedArena = true;
    this.arenaT = 0;
    for (const p of this.platforms) { p.group.visible = true; p.box.disabled = false; }
    for (const c of this.cracks) c.visible = true;
    for (const s of this.skyCracks) s.mesh.visible = true;
    this.symbol.visible = true;
    // The sky goes out. Only he is lit now.
    if (this.scene.fog) this.scene.fog.color.setHex(0x05040a);
    if (this.scene.background && this.scene.background.setHex) {
      this.scene.background.setHex(0x05040a);
    }
    this.followCam.shake(2.0);
  }

  /** 10%: the arena starts falling into the dark. */
  collapseArena() { this.collapse = 0.0001; }

  _updateArena(dt) {
    if (!this.ascendedArena) return;
    this.arenaT += dt;
    const k = clamp(this.arenaT / 2.4, 0, 1);

    for (const p of this.platforms) {
      // Rise into place, then drift, so the ground is never quite still.
      const drift = Math.sin(this.arenaT * 0.5 + p.phase) * 0.9;
      let y = lerp(ORIGIN.y - 40, p.y, k * k) + drift * k;
      if (this.collapse > 0) {
        // And then it goes. The collider goes with the mesh, so a platform
        // you can see falling is a platform you can no longer stand on.
        p.fall = (p.fall || 0) + dt * (0.5 + p.phase * 0.35);
        y -= p.fall * p.fall * 6;
        if (p.fall > 0.9 && !p.box.disabled) p.box.disabled = true;
      }
      p.group.position.y = y;
      p.group.rotation.y = Math.sin(this.arenaT * 0.22 + p.phase) * 0.05;
      // Keep the collider on the mesh. Safe to move after bake(): the
      // broadphase is keyed on x/z only, and neither of those changes.
      p.box.minY = y - 0.8;
      p.box.maxY = y + 0.8;
    }

    // The sky seams breathe, out of step with the floor, so the two never
    // pulse together and flatten into one effect.
    this.skyMat.opacity = (0.30 + Math.sin(this.arenaT * 0.9) * 0.16) * k;
    for (const s of this.skyCracks) {
      s.mesh.scale.z = 1 + Math.sin(this.arenaT * 0.7 + s.phase) * 0.18;
    }
    this.crackMat.opacity = 0.35 + Math.sin(this.arenaT * 2.2) * 0.12 + k * 0.3;
    this.symbolMat.opacity = (0.22 + Math.sin(this.arenaT * 1.4) * 0.10) * k;
    this.symbol.rotation.y += dt * 0.12;
    if (this.collapse > 0) {
      this.collapse += dt;
      this.crackMat.opacity = 0.6 + Math.sin(this.arenaT * 9) * 0.3;
    }
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
    // The boss owns the pacing of the ascension, so the arena listens to him
    // rather than watching his health and guessing.
    this.boss.onAscend = () => this.ascendArena();
    this.boss.onFinal = () => this.collapseArena();
    Audio.stopBossMusic();
    Audio.stopAmbient();
    Audio.stopAllTracks(0.3);
    // Decode ahead of time — a fight is a bad place to wait on a download.
    Audio.prefetchTracks(['phase1', 'ascension', 'ascended']);
  }

  /** Undo the phase-2 arena so a retry starts in the room you first entered. */
  _resetArena() {
    if (!this.platforms) return;
    for (const p of this.platforms) {
      p.group.visible = false;
      p.group.position.y = ORIGIN.y - 40;
      p.box.disabled = true;
      p.box.minY = ORIGIN.y - 40.8;
      p.box.maxY = ORIGIN.y - 39.2;
      p.fall = 0;
    }
    for (const c of this.cracks) c.visible = false;
    for (const s of this.skyCracks) s.mesh.visible = false;
    this.symbol.visible = false;
    this.crackMat.opacity = 0;
    this.skyMat.opacity = 0;
    this.symbolMat.opacity = 0;
    this.ascendedArena = false;
    this.arenaT = 0;
    this.collapse = 0;
    if (this.scene.fog && this._fogWas !== null) {
      this.scene.fog.color.setHex(this._fogWas);
    }
    if (this._bgWas !== null && this.scene.background && this.scene.background.setHex) {
      this.scene.background.setHex(this._bgWas);
    }
  }

  update(dt, player, onHit, skipHeld) {
    if (!this.boss) return;
    this._updateArena(dt);

    // The skip prompt. Clearing it has to happen OUTSIDE the entrance test:
    // the moment the entrance ends this block stops running, so a clear
    // nested inside it never fires and the prompt is stranded on screen for
    // the rest of the fight.
    const showSkip = this.boss.inEntrance && this.boss.skippable;
    if (showSkip) {
      const p = this.boss.updateSkip(dt, !!skipHeld);
      this.hud.setTutorial('HOLD', 'SPACE',
        p > 0 ? `SKIPPING… ${Math.round(p * 100)}%` : 'TO SKIP');
    }
    if (this._skipPrompt && !showSkip) this.hud.setTutorial(null);
    this._skipPrompt = showSkip;

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
      // A scripted beat means the fight has genuinely stopped: he cannot be
      // hurt (see takeDamage) and you cannot act. Anything less and the
      // ascension is just a cinematic you get to shoot through.
      if (this.boss.inCutscene) {
        player.cinematic = true;
        player.vel.set(0, 0, 0);
        this._wasCut = true;
      } else if (this._wasCut) {
        this._wasCut = false;
        player.cinematic = false;
        this.hud.setCinematic(false);
      }
      this.boss.update(dt, player, this.camera, onHit);
      if (this.boss.fighting && player.cinematic && !this.boss.inCutscene) {
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
        this._resetArena();
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
    Audio.stopAllTracks();
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
    Audio.stopAllTracks();
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
    Audio.stopAllTracks(0.3);
    for (const p of (this.platforms || [])) {
      this.scene.remove(p.group);
      p.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      p.box.disabled = true;
    }
    this.platforms = null;
    for (const c of (this.cracks || [])) {
      this.scene.remove(c); c.geometry.dispose();
    }
    this.cracks = null;
    for (const s of (this.skyCracks || [])) {
      this.scene.remove(s.mesh); s.mesh.geometry.dispose();
    }
    this.skyCracks = null;
    if (this.skyMat) { this.skyMat.dispose(); this.skyMat = null; }
    if (this.symbol) {
      this.scene.remove(this.symbol);
      this.symbol.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.symbol = null;
    }
    if (this.crackMat) { this.crackMat.dispose(); this.crackMat = null; }
    if (this.symbolMat) { this.symbolMat.dispose(); this.symbolMat = null; }
    this.hud.hideBossBar();
    this.hud.setObjectives(null);
    this.hud.setSubtitle('');
    this.hud.setCinematic(false);
    this.hud.setTutorial(null);
  }
}
