/**
 * Story-mode characters: the armoured invader toads and the villager frogs
 * they are attacking.
 *
 * Toads are built from the same primitive-and-group approach as the player
 * frog, but heavier and hunched, with plate armour and a wooden club. All
 * materials are module-level singletons so twenty toads on screen still only
 * touch a handful of materials.
 */

import * as THREE from '../lib/three.module.js?v=v22';
import { damp, dampAngle, lerp, clamp } from './util.js?v=v22';
import { CFG } from './config.js?v=v22';
import { buildKatana } from './frog.js?v=v22';

const G = {
  sphere: new THREE.SphereGeometry(1, 10, 8),
  low: new THREE.SphereGeometry(1, 7, 5),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 7),
  cone: new THREE.ConeGeometry(1, 1, 6),
  capsule: new THREE.CapsuleGeometry(1, 1, 3, 7),
};

let M = null;
function mats() {
  if (M) return M;
  const L = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0x000000 });
  M = {
    skin: L(0x6f7a3e),        // sickly olive toad hide
    skinDark: L(0x535c2e),
    belly: L(0x9aa06a),
    iron: L(0x565f6b),
    ironDark: L(0x353b45),
    gold: L(0x9a7d33),
    wood: L(0x6b4a2a),
    woodDark: L(0x452e19),
    eye: L(0xff5a2c, 0x8a2a10),   // glowing malice
    cloth: L(0x7a2f22),
    bossIron: L(0x3c3f4a),
    bossTrim: L(0xb08b32),
    bossCloth: L(0x5e1a14),
  };
  return M;
}

function part(geo, mat, sx, sy, sz, px, py, pz, rx, ry, rz) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(px || 0, py || 0, pz || 0);
  m.rotation.set(rx || 0, ry || 0, rz || 0);
  m.castShadow = true;
  return m;
}

/**
 * An armoured toad. `boss` makes it much larger and more ornate.
 * Modelled facing +Z, like the player frog, so `setFacing` matches.
 */
export class ToadModel {
  /**
   * @param boss       larger, horned, caped — Toadel and the juggernaut
   * @param swordSkin  when given, the club is replaced by a katana in this
   *                   palette, scaled up to suit the toad's bulk
   */
  constructor(boss = false, swordSkin = null) {
    const P = mats();
    this.boss = boss;
    this.swordSkin = swordSkin;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);

    const s = boss ? 1.85 : 1.0;
    this.scaleFactor = s;
    this.root.scale.setScalar(s);

    const iron = boss ? P.bossIron : P.iron;
    const trim = boss ? P.bossTrim : P.gold;

    // ---- torso: broad and hunched forward ----
    this.body.add(part(G.sphere, P.skin, 0.62, 0.52, 0.56, 0, 0.78, 0));
    this.body.add(part(G.sphere, P.belly, 0.48, 0.38, 0.40, 0, 0.68, 0.24));
    // Breastplate.
    this.body.add(part(G.sphere, iron, 0.64, 0.42, 0.50, 0, 0.86, 0.04));
    this.body.add(part(G.box, trim, 0.14, 0.42, 0.06, 0, 0.88, 0.50));
    // Shoulder plates.
    for (const sx of [-1, 1]) {
      this.body.add(part(G.low, iron, 0.28, 0.22, 0.26, sx * 0.62, 1.06, 0));
      this.body.add(part(G.cone, trim, 0.12, 0.20, 0.12, sx * 0.72, 1.22, 0, 0, 0, sx * 0.4));
    }
    // Belt.
    this.body.add(part(G.cyl, P.woodDark, 0.60, 0.09, 0.56, 0, 0.52, 0));

    // ---- head: wide, low-set, angry ----
    this.head = new THREE.Group();
    this.head.position.set(0, 1.28, 0.10);
    this.body.add(this.head);
    this.head.add(part(G.sphere, P.skin, 0.50, 0.38, 0.46, 0, 0, 0));
    this.head.add(part(G.sphere, P.skinDark, 0.44, 0.14, 0.40, 0, -0.16, 0.06));  // jaw
    // Helmet.
    this.head.add(part(G.sphere, iron, 0.53, 0.34, 0.48, 0, 0.10, -0.02));
    this.head.add(part(G.box, iron, 0.10, 0.16, 0.50, 0, 0.34, -0.06));           // crest
    if (boss) {
      // Horns mark the leader out at a glance.
      for (const sx of [-1, 1]) {
        this.head.add(part(G.cone, trim, 0.10, 0.52, 0.10,
          sx * 0.42, 0.28, -0.04, -0.3, 0, sx * 0.75));
      }
      this.head.add(part(G.box, trim, 0.56, 0.05, 0.05, 0, 0.20, 0.40));
    }
    // Eyes.
    for (const sx of [-1, 1]) {
      this.head.add(part(G.low, P.eye, 0.11, 0.09, 0.09, sx * 0.24, 0.06, 0.38));
    }
    this.head.add(part(G.box, P.skinDark, 0.56, 0.03, 0.10, 0, -0.10, 0.36));     // mouth line

    // ---- arms ----
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * 0.60, 0.98, 0);
      this.body.add(shoulder);
      shoulder.add(part(G.capsule, P.skin, 0.16, 0.18, 0.16, 0, -0.24, 0));
      shoulder.add(part(G.cyl, iron, 0.18, 0.10, 0.18, 0, -0.10, 0));
      const fore = new THREE.Group();
      fore.position.set(0, -0.46, 0);
      shoulder.add(fore);
      fore.add(part(G.capsule, P.skin, 0.14, 0.17, 0.14, 0, -0.18, 0));
      const hand = new THREE.Group();
      hand.position.set(0, -0.40, 0);
      fore.add(hand);
      hand.add(part(G.low, P.skin, 0.17, 0.15, 0.17, 0, 0, 0));
      this.arms.push({ shoulder, fore, hand, side: sx });
    }

    // ---- legs: squat and splayed ----
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.32, 0.46, 0);
      this.body.add(hip);
      hip.add(part(G.capsule, P.skin, 0.20, 0.16, 0.20, sx * 0.06, -0.16, 0));
      const shin = new THREE.Group();
      shin.position.set(sx * 0.08, -0.32, 0);
      hip.add(shin);
      shin.add(part(G.capsule, P.skin, 0.14, 0.16, 0.14, 0, -0.16, 0));
      const foot = new THREE.Group();
      foot.position.set(0, -0.34, 0);
      shin.add(foot);
      foot.add(part(G.low, P.skin, 0.20, 0.08, 0.30, 0, 0, 0.12));
      this.legs.push({ hip, shin, foot, side: sx });
    }

    // ---- weapon, held in the right hand ----
    if (swordSkin) {
      // The juggernaut carries the same katana every frog does, just vast.
      // Reusing the builder is what keeps it recognisably the same weapon.
      this.swordMats = {
        steel: new THREE.MeshLambertMaterial({
          color: swordSkin.blade, emissive: swordSkin.glow,
        }),
        edge: new THREE.MeshLambertMaterial({ color: swordSkin.edge }),
        gold: new THREE.MeshLambertMaterial({ color: swordSkin.guard }),
        grip: new THREE.MeshLambertMaterial({ color: swordSkin.grip }),
        same: new THREE.MeshLambertMaterial({ color: swordSkin.guard }),
      };
      this.weapon = buildKatana(this.swordMats);
      this.weapon.scale.setScalar(CFG.juggernaut.swordScale);
      this.arms[1].hand.add(this.weapon);
      this.weapon.position.set(0, -0.30, 0.10);
      this.weapon.rotation.x = -0.35;
    } else {
      this.weapon = new THREE.Group();
      this.weapon.add(part(G.cyl, P.wood, 0.07, 0.90, 0.07, 0, -0.35, 0));
      this.weapon.add(part(G.cyl, P.wood, 0.17, 0.42, 0.17, 0, 0.34, 0));
      // Knots and iron bands so it reads as a heavy, crude weapon.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        this.weapon.add(part(G.low, P.woodDark, 0.07, 0.07, 0.07,
          Math.cos(a) * 0.17, 0.22 + (i % 2) * 0.24, Math.sin(a) * 0.17));
      }
      this.weapon.add(part(G.cyl, iron, 0.19, 0.05, 0.19, 0, 0.50, 0));
      if (boss) {
        this.weapon.scale.setScalar(1.25);
        this.weapon.add(part(G.cone, trim, 0.13, 0.26, 0.13, 0, 0.62, 0));
      }
      this.arms[1].hand.add(this.weapon);
      this.weapon.position.set(0, -0.18, 0.08);
      this.weapon.rotation.x = -0.4;
    }

    if (boss) {
      // Tattered cape.
      this.cape = new THREE.Group();
      this.cape.position.set(0, 1.06, -0.34);
      this.body.add(this.cape);
      for (let i = 0; i < 3; i++) {
        this.cape.add(part(G.box, P.bossCloth, 0.62 - i * 0.1, 0.5, 0.05,
          (i - 1) * 0.28, -0.42, -0.04 - i * 0.02, 0.16, 0, 0));
      }
    }

    // ---- animation state ----
    this.t = Math.random() * 10;
    this.stride = Math.random() * 6;
    this.attackT = 0;
    this.attackDur = 1;
    this.hurtT = 0;
    this.dead = false;
  }

  setFacing(yaw) { this.root.rotation.y = yaw + Math.PI; }

  // ---- FrogModel-compatible surface ------------------------------------
  // The juggernaut is a player wearing this model, and the player controller
  // must not have to care which one it is wearing. These are the parts of
  // FrogModel's interface it calls; the ones with no toad equivalent are
  // honest no-ops rather than missing methods that would throw mid-match.

  setVisible(v) { this.root.visible = v; }
  /** Toads do not croak, flip, or wear an "it" marker. */
  croak() {}
  triggerFlip() {}
  setTagger() {}
  drawNameplate() {}

  /** Same whole-rig fade the frogs use, so invisibility works identically. */
  setGhost(k) {
    if (this._ghost === k) return;
    this._ghost = k;
    const on = k < 0.999;
    this.root.traverse((o) => {
      const list = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : null);
      if (!list) return;
      for (const m of list) {
        if (m.userData.baseOpacity === undefined) {
          m.userData.baseOpacity = m.opacity;
          m.userData.baseTransparent = m.transparent;
          m.userData.baseDepthWrite = m.depthWrite;
        }
        if (on) {
          m.transparent = true;
          m.opacity = m.userData.baseOpacity * k;
          m.depthWrite = false;
        } else {
          m.transparent = m.userData.baseTransparent;
          m.opacity = m.userData.baseOpacity;
          m.depthWrite = m.userData.baseDepthWrite;
        }
      }
    });
  }

  dispose() {
    const seen = new Set();
    this.root.traverse((o) => {
      const list = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : null);
      if (!list) return;
      for (const m of list) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.dispose();
      }
    });
  }

  /** Kick off a swing animation. */
  swing(duration = 0.55) {
    this.attackT = duration;
    this.attackDur = duration;
  }

  flinch() { this.hurtT = 0.18; }

  /**
   * @param s { speed, attacking, dead, attackT }
   *
   * `attackT` is how the player controller reports a swing (it counts down
   * through the attack), so a rising edge here starts the toad's own smash —
   * that is what lets a player drive this model without a second code path.
   */
  update(dt, s = {}) {
    if (s.attackT > 0 && !this._wasSwinging && this.attackT <= 0) this.swing(0.42);
    this._wasSwinging = s.attackT > 0;

    this.t += dt;
    const t = this.t;

    if (s.dead || this.dead) {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI * 0.46, 6, dt);
      this.body.position.y = damp(this.body.position.y, -0.3, 6, dt);
      return;
    }

    const speed = s.speed || 0;
    const moving = speed > 0.6;
    if (moving) this.stride += dt * (3.2 + Math.min(speed, 14) * 0.55);

    const sw = Math.sin(this.stride);
    // Heavy, lumbering gait.
    this.body.position.y = Math.abs(Math.sin(this.stride)) * (moving ? 0.09 : 0)
      + Math.sin(t * 1.4) * 0.02;
    this.body.rotation.x = damp(this.body.rotation.x, moving ? 0.20 : 0.10, 6, dt);
    this.head.rotation.x = damp(this.head.rotation.x, moving ? -0.16 : -0.06, 6, dt);

    for (const leg of this.legs) {
      const phase = leg.side > 0 ? sw : -sw;
      leg.hip.rotation.x = damp(leg.hip.rotation.x, moving ? phase * 0.62 : -0.2, 14, dt);
      leg.shin.rotation.x = damp(leg.shin.rotation.x,
        moving ? clamp(-phase, 0, 1) * 0.9 + 0.1 : 0.45, 14, dt);
      leg.hip.rotation.z = damp(leg.hip.rotation.z, leg.side * 0.24, 8, dt);
    }

    // Attack: big overhead club smash.
    if (this.attackT > 0) {
      this.attackT = Math.max(0, this.attackT - dt);
      const k = 1 - this.attackT / this.attackDur;      // 0 -> 1
      const e = k < 0.42
        ? (k / 0.42) * (k / 0.42) * 0.5                  // slow wind-up
        : 0.5 + (1 - Math.pow(1 - (k - 0.42) / 0.58, 3)) * 0.5;  // fast strike
      const right = this.arms[1];
      right.shoulder.rotation.x = lerp(-2.6, 1.05, e);
      right.shoulder.rotation.z = 0.1;
      right.fore.rotation.x = lerp(-1.2, -0.1, e);
      this.body.rotation.x = 0.2 + Math.sin(e * Math.PI) * 0.25;
      const left = this.arms[0];
      left.shoulder.rotation.x = damp(left.shoulder.rotation.x, -0.5, 12, dt);
      left.shoulder.rotation.z = damp(left.shoulder.rotation.z, -0.4, 12, dt);
    } else {
      for (const arm of this.arms) {
        const phase = arm.side > 0 ? -sw : sw;
        arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x,
          moving ? phase * 0.5 : 0.1, 10, dt);
        arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, arm.side * 0.22, 8, dt);
        arm.fore.rotation.x = damp(arm.fore.rotation.x, -0.5, 10, dt);
      }
    }

    if (this.hurtT > 0) {
      this.hurtT -= dt;
      // Quick shudder on taking a hit.
      this.body.position.x = Math.sin(this.hurtT * 90) * 0.06;
    } else {
      this.body.position.x = damp(this.body.position.x, 0, 12, dt);
    }

    if (this.cape) {
      this.cape.rotation.x = 0.1 + Math.sin(t * 1.7) * 0.09 + Math.min(speed, 12) * 0.02;
    }
  }
}

/**
 * A castle guard on patrol.
 *
 * Walks a waypoint loop, and only notices you if you are inside its vision
 * cone, within range, AND in clear line of sight — so breaking line of sight
 * is a real way to escape rather than a cosmetic one. Loses interest a few
 * seconds after you slip out of view.
 */
export class PatrolGuard {
  constructor(route, y, collision) {
    this.model = new ToadModel(false);
    this.route = route;
    this.collision = collision;
    this.index = 0;
    this.pos = new THREE.Vector3(route[0][0], y, route[0][1]);
    this.yaw = 0;
    this.model.root.position.copy(this.pos);
    this.state = 'patrol';        // patrol | alert | chase | search
    this.alertLevel = 0;          // 0..1 — fills while you are in view
    this.searchTimer = 0;
    this.attackCooldown = 0;
    this.speed = 0;
    this.waitTimer = 0;
    this.baseY = y;

    this.viewRange = 26;
    this.viewAngle = 0.62;        // half-angle of the cone, radians
    this.attackRange = 3.4;
  }

  /** Can this guard actually see `target` right now? */
  canSee(target) {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dy = target.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    if (dist > this.viewRange || Math.abs(dy) > 6) return false;

    // Facing check.
    const ang = Math.atan2(dx, dz);
    let rel = ang - this.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    // Very close by, they notice you regardless of facing.
    if (Math.abs(rel) > this.viewAngle && dist > 5) return false;

    // Line of sight: a wall between you breaks it.
    const inv = 1 / (dist || 1);
    const hit = this.collision.raycast(
      this.pos.x, this.pos.y + 1.6, this.pos.z,
      dx * inv, (dy + 1.0) / (dist || 1), dz * inv, dist - 0.6);
    return !hit;
  }

  update(dt, target, onAttack) {
    const seen = target ? this.canSee(target) : false;

    if (seen) {
      this.alertLevel = Math.min(1, this.alertLevel + dt * 2.2);
      if (this.alertLevel >= 1) { this.state = 'chase'; this.searchTimer = 4.0; }
      else if (this.state === 'patrol') this.state = 'alert';
      this.lastSeen = { x: target.x, y: target.y, z: target.z };
    } else {
      this.alertLevel = Math.max(0, this.alertLevel - dt * 0.5);
      if (this.state === 'chase') {
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) this.state = 'search';
      } else if (this.state === 'search') {
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) { this.state = 'patrol'; this.alertLevel = 0; }
      } else if (this.state === 'alert' && this.alertLevel <= 0) {
        this.state = 'patrol';
      }
    }

    let goal = null;
    let speed = 0;
    if (this.state === 'chase' && this.lastSeen) {
      goal = this.lastSeen; speed = 13.5;
    } else if (this.state === 'search' && this.lastSeen) {
      goal = this.lastSeen; speed = 6.5;
      if (this.searchTimer <= 0) this.searchTimer = 3;
    } else if (this.state === 'alert') {
      goal = this.lastSeen; speed = 0;      // stop and stare
    } else {
      // Patrol: walk the loop, pausing briefly at each corner.
      const wp = this.route[this.index];
      goal = { x: wp[0], z: wp[1] };
      if (this.waitTimer > 0) { this.waitTimer -= dt; speed = 0; }
      else speed = 5.5;
      if (Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) < 1.6) {
        this.index = (this.index + 1) % this.route.length;
        this.waitTimer = 0.8 + Math.random() * 1.4;
      }
    }

    if (goal) {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const want = Math.atan2(dx, dz);
        this.yaw = dampAngle(this.yaw, want, this.state === 'chase' ? 7 : 3.2, dt);
      }
      if (speed > 0 && d > 0.6) {
        this.pos.x += (dx / d) * speed * dt;
        this.pos.z += (dz / d) * speed * dt;
      }
      this.speed = speed;
    }

    // Attack when they catch you.
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.state === 'chase' && target && this.attackCooldown <= 0) {
      const d = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
      if (d < this.attackRange) {
        this.attackCooldown = 1.5;
        this.model.swing(0.6);
        if (onAttack) onAttack(this);
      }
    }

    this.pos.y = this.baseY;
    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);
    this.model.update(dt, { speed: this.speed });
  }
}

/**
 * A scripted background actor: a toad beating a villager, or a villager
 * cowering. Purely decorative — these never interact with the player, they
 * exist to make the invasion feel like it is happening around you.
 */
export class VillageScene {
  /**
   * @param kind 'beating' | 'burning' | 'fleeing'
   */
  constructor(kind, x, y, z, facing, frogFactory) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;
    this.t = Math.random() * 5;
    this.cycle = 1.6 + Math.random() * 0.8;

    this.toad = new ToadModel(false);
    this.root.add(this.toad.root);

    if (kind === 'beating') {
      // A villager frog on the ground taking blows.
      this.victim = frogFactory();
      this.victim.root.position.set(0, 0, 1.9);
      this.victim.root.rotation.z = Math.PI * 0.45;
      this.root.add(this.victim.root);
      this.toad.setFacing(0);
    } else if (kind === 'fleeing') {
      this.victim = frogFactory();
      this.victim.root.position.set(0, 0, 3.2);
      this.root.add(this.victim.root);
      this.toad.setFacing(0);
    } else {
      this.toad.setFacing(Math.random() * Math.PI * 2);
    }
  }

  update(dt) {
    this.t += dt;
    if (this.kind === 'beating') {
      // Swing on a loop, with the club landing on the beat.
      if (this.t > this.cycle) {
        this.t = 0;
        this.toad.swing(0.6);
        if (this.victim) this.victim.croak();
      }
      this.toad.update(dt, { speed: 0 });
      if (this.victim) {
        this.victim.update(dt, {
          speed: 0, grounded: true, moving: false, dead: true,
        });
      }
    } else if (this.kind === 'fleeing') {
      this.toad.update(dt, { speed: 6 });
      if (this.victim) {
        this.victim.update(dt, {
          speed: 9, vy: 0, grounded: true, moving: true, dead: false,
        });
      }
    } else {
      // Torching a building: slow, deliberate swings at the walls.
      if (this.t > this.cycle * 1.6) { this.t = 0; this.toad.swing(0.8); }
      this.toad.update(dt, { speed: 0 });
    }
  }
}
