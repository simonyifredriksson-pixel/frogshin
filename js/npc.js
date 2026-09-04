/**
 * Story-mode characters: the armoured invader toads and the villager frogs
 * they are attacking.
 *
 * Toads are built from the same primitive-and-group approach as the player
 * frog, but heavier and hunched, with plate armour and a wooden club. All
 * materials are module-level singletons so twenty toads on screen still only
 * touch a handful of materials.
 */

import * as THREE from '../lib/three.module.js?v=v45';
import { damp, dampAngle, lerp, clamp } from './util.js?v=v45';
import { CFG } from './config.js?v=v45';
import { buildKatana, FrogModel } from './frog.js?v=v45';

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
    tongue: L(0xd4718c),
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
      const sfx = swordSkin.fx || {};
      this.swordMats = {
        steel: sfx.glow
          ? new THREE.MeshBasicMaterial({ color: swordSkin.blade })
          : new THREE.MeshLambertMaterial({
            color: swordSkin.blade, emissive: swordSkin.glow,
          }),
        edge: sfx.glow
          ? new THREE.MeshBasicMaterial({ color: swordSkin.edge })
          : new THREE.MeshLambertMaterial({ color: swordSkin.edge }),
        gold: new THREE.MeshLambertMaterial({ color: swordSkin.guard }),
        grip: new THREE.MeshLambertMaterial({ color: swordSkin.grip }),
        same: new THREE.MeshLambertMaterial({ color: swordSkin.guard }),
      };
      if (sfx.runes) {
        this.swordMats.rune = new THREE.MeshBasicMaterial({ color: sfx.runes });
      }
      if (sfx.tassel) {
        this.swordMats.tassel = new THREE.MeshLambertMaterial({ color: sfx.tassel });
      }
      if (sfx.aura) {
        this.swordMats.aura = new THREE.MeshBasicMaterial({
          color: sfx.aura, transparent: true, opacity: 0.22, depthWrite: false,
        });
      }
      this.weapon = buildKatana(this.swordMats, swordSkin.fx);
      this.weapon.scale.setScalar(CFG.juggernaut.swordScale);
      this.arms[1].hand.add(this.weapon);
      // The club leans BACK over the shoulder (rotation.x -0.4), which reads
      // fine for a lump of wood but points a blade the wrong way. A positive
      // X rotation tilts the blade toward +Z — the direction the rig faces —
      // so the katana is held out in front, tip forward and up.
      this.weapon.position.set(0, -0.26, 0.14);
      this.weapon.rotation.set(0.34, 0, -0.10);
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

    // ---- tongue ----
    // Toads have tongues too, and the juggernaut is a PLAYER wearing this
    // rig — without one, its grapple rope was invisible while the physics
    // ran normally, which looked like the ability was broken.
    this.tongue = new THREE.Group();
    this.tongue.visible = false;
    this.tongueMesh = part(G.cyl, P.tongue, 0.10, 1, 0.10, 0, 0.5, 0);
    this.tongueMesh.castShadow = false;
    this.tongue.add(this.tongueMesh);
    this.tongueTip = part(G.low, P.tongue, 0.18, 0.18, 0.18, 0, 1, 0);
    this.tongueTip.castShadow = false;
    this.tongue.add(this.tongueTip);
    this.root.add(this.tongue);
    this.tongueLen = 0;

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

  /**
   * Draw the grapple rope, the same way FrogModel does.
   *
   * Anchored at the mouth, extended fast on fire and retracted fast on
   * release, and parented to the root so the toad's own rotation does not
   * drag the rope off its anchor.
   */
  _updateTongue(dt, s) {
    if (!s.tongueTo || (!s.grappling && this.tongueLen <= 0.01)) {
      this.tongue.visible = false;
      this.tongueLen = 0;
      return;
    }
    // Mouth position in root-local space, scaled with the rig.
    const from = new THREE.Vector3(0, 1.28, 0.55);
    this.root.localToWorld(from);
    const dir = new THREE.Vector3().subVectors(s.tongueTo, from);
    const full = dir.length();
    if (full < 0.01) { this.tongue.visible = false; return; }
    dir.multiplyScalar(1 / full);

    const target = s.grappling ? full : 0;
    const rate = s.grappling ? 220 : 170;
    this.tongueLen = Math.abs(this.tongueLen - target) < rate * dt
      ? target
      : this.tongueLen + Math.sign(target - this.tongueLen) * rate * dt;
    if (this.tongueLen <= 0.02) { this.tongue.visible = false; return; }

    this.tongue.visible = true;
    this.tongue.position.copy(this.root.worldToLocal(from.clone()));
    const localDir = dir.clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.root.rotation.y);
    this.tongue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);

    // The rope is drawn in root-local space, so undo the rig's scale — a
    // 1.85x toad would otherwise stretch the rope past its anchor point.
    const L = this.tongueLen / (this.scaleFactor || 1);
    const wob = 1 + Math.sin(this.t * 30) * 0.08;
    this.tongueMesh.scale.set(0.10 * wob, L, 0.10 * wob);
    this.tongueMesh.position.y = L * 0.5;
    this.tongueTip.position.y = L;
    this.tongueTip.visible = !!s.grappling;
  }

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
    this._updateTongue(dt, s);

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
 * A toad going about its day in the village.
 *
 * Wanders between loose waypoints and stops to look around. No vision, no
 * aggression — these are civilians, and the point of them is that the village
 * feels lived in right up until one of them notices what you are.
 */
export class VillagerToad {
  constructor(spots, index, collision) {
    this.model = new ToadModel(false);
    this.spots = spots;
    this.collision = collision;
    this.index = index % spots.length;
    const s = spots[this.index];
    this.pos = new THREE.Vector3(s.x, s.y, s.z);
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.waitTimer = Math.random() * 3;
    this.model.root.position.copy(this.pos);
    // Slight size variation so a crowd does not look cloned.
    this.model.root.scale.setScalar(0.9 + Math.random() * 0.2);
    this.frozen = false;
  }

  /** Stop dead and stare at a point — used when the alarm goes up. */
  lookAt(x, z) {
    this.frozen = true;
    this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  update(dt) {
    if (this.frozen) {
      this.model.setFacing(this.yaw);
      this.model.update(dt, { speed: 0 });
      return;
    }
    if (this.waitTimer > 0) {
      this.waitTimer -= dt;
      this.speed = 0;
    } else {
      const goal = this.spots[this.index];
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.8) {
        this.index = Math.floor(Math.random() * this.spots.length);
        this.waitTimer = 1.5 + Math.random() * 4;
      } else {
        this.speed = 2.6;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 3, dt);
        this.pos.x += (dx / d) * this.speed * dt;
        this.pos.z += (dz / d) * this.speed * dt;
      }
    }
    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);
    this.model.update(dt, { speed: this.speed });
  }
}

/**
 * The frog who hides in the bush and then leads you out of the village.
 *
 * Runs a fixed route to the gap in the fence, but paces himself against the
 * player: he will not get more than `leash` ahead, and stops and waves you on
 * when you fall behind. A guide you can lose is not a guide.
 */
export class GuideFrog {
  constructor(route, collision) {
    this.model = new FrogModel(0x7fd45a, '', true);
    this.model.root.scale.setScalar(0.95);
    this.route = route;
    this.collision = collision;
    this.index = 0;
    this.pos = route[0].clone();
    this.yaw = 0;
    this.speed = 0;
    this.leash = 16;          // never get further ahead than this
    this.runSpeed = 11;
    this.arrived = false;
    this.waiting = false;
    // Set by the story: fired once, when he reaches the gap in the fence.
    this.onArrive = null;
    this.model.root.position.copy(this.pos);
  }

  /** Sit in the bush with only the head showing. */
  hideIn(pos) {
    this.pos.copy(pos);
    this.pos.y -= 0.62;               // sunk into the leaves
    this.model.root.position.copy(this.pos);
  }

  /** Stand up and start leading. */
  begin(from) {
    if (from) this.pos.copy(from);
    this.index = 0;
    this.arrived = false;
    this.model.root.position.copy(this.pos);
  }

  update(dt, playerPos) {
    if (this.arrived) {
      this.model.root.position.copy(this.pos);
      this.model.setFacing(this.yaw);
      this.model.update(dt, { speed: 0, moving: false, grounded: true });
      return;
    }

    const goal = this.route[this.index];
    const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z;
    const d = Math.hypot(dx, dz);

    if (d < 2.2) {
      if (this.index < this.route.length - 1) this.index++;
      else {
        // Reached the gap: hop through and stay put on the far side.
        this.arrived = true;
        this.waiting = false;
        if (this.onArrive) this.onArrive();
        return;
      }
    }

    // Hold position if the player has fallen behind.
    const lag = playerPos
      ? Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z) : 0;
    this.waiting = lag > this.leash;
    this.speed = this.waiting ? 0 : this.runSpeed;

    if (d > 0.05) {
      // While waiting, turn back and face the player rather than the route.
      const wantYaw = this.waiting && playerPos
        ? Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z)
        : Math.atan2(dx, dz);
      this.yaw = dampAngle(this.yaw, wantYaw, 8, dt);
    }
    if (this.speed > 0) {
      this.pos.x += (dx / d) * this.speed * dt;
      this.pos.z += (dz / d) * this.speed * dt;
    }

    this.model.root.position.copy(this.pos);
    this.model.setFacing(this.yaw);
    this.model.update(dt, {
      speed: this.speed, moving: this.speed > 0.5, grounded: true,
      sprinting: this.speed > 8,
    });
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
