/**
 * The ninja frog character.
 *
 * Everything is built procedurally out of primitives — no external model
 * files — and animated by a small hand-written procedural rig. The rig is
 * driven purely from gameplay state (speed, grounded, dash timer, attack
 * timer, ...) which means the exact same code animates the local player and
 * every networked remote player.
 */

import * as THREE from '../lib/three.module.js?v=v16';
import { clamp, lerp, damp, dampAngle } from './util.js?v=v16';

const CLOTH = 0x24242e;        // ninja gi
const CLOTH_DARK = 0x16161d;
const SCARF = 0xc0392b;
const BELLY = 0xdfe6a8;
const EYE_WHITE = 0xfefbe8;

/** Shared geometries — every frog reuses these, so memory stays flat. */
const G = {
  sphere: new THREE.SphereGeometry(1, 12, 9),
  lowSphere: new THREE.SphereGeometry(1, 8, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  capsule: new THREE.CapsuleGeometry(1, 1, 3, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 7),
};

function mesh(geo, mat, sx, sy, sz, px, py, pz) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(px || 0, py || 0, pz || 0);
  m.castShadow = true;
  return m;
}

export class FrogModel {
  /**
   * @param {number} color  body tint (distinguishes players)
   * @param {string} name   displayed above the head
   * @param {boolean} isLocal local player skips its own nameplate
   */
  /**
   * @param skins optional { frog, sword } palettes from the shop. The player
   *              colour still tints the body when the default frog skin is
   *              worn, so colour choice keeps working; a bought skin
   *              overrides it entirely.
   */
  constructor(color = 0x6cc24a, name = 'Frog', isLocal = false, skins = null) {
    this.color = color;
    this.name = name;
    this.isLocal = isLocal;

    const fs = skins && skins.frog;
    const ss = skins && skins.sword;
    const useCustomFrog = !!fs && fs.id !== 'frog_default';

    const skin = new THREE.Color(useCustomFrog ? fs.skin : color);
    const skinDark = skin.clone().multiplyScalar(0.72);

    this.mats = {
      skin: new THREE.MeshLambertMaterial({ color: skin }),
      skinDark: new THREE.MeshLambertMaterial({ color: skinDark }),
      belly: new THREE.MeshLambertMaterial({ color: useCustomFrog ? fs.belly : BELLY }),
      cloth: new THREE.MeshLambertMaterial({ color: useCustomFrog ? fs.cloth : CLOTH }),
      clothDark: new THREE.MeshLambertMaterial({
        color: new THREE.Color(useCustomFrog ? fs.cloth : CLOTH).multiplyScalar(0.62),
      }),
      scarf: new THREE.MeshLambertMaterial({ color: useCustomFrog ? fs.scarf : SCARF }),
      eye: new THREE.MeshBasicMaterial({ color: EYE_WHITE }),
      pupil: new THREE.MeshBasicMaterial({ color: 0x101014 }),
      shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      steel: new THREE.MeshLambertMaterial({
        color: ss ? ss.blade : 0xd9dee6,
        emissive: ss ? ss.glow : 0x2a3038,
      }),
      edge: new THREE.MeshLambertMaterial({ color: ss ? ss.edge : 0xf2f6fb }),
      gold: new THREE.MeshLambertMaterial({ color: ss ? ss.guard : 0xc9a227 }),
      grip: new THREE.MeshLambertMaterial({ color: ss ? ss.grip : CLOTH_DARK }),
      tongue: new THREE.MeshLambertMaterial({ color: 0xef7d9d }),
    };

    this.root = new THREE.Group();          // origin at the feet
    this.body = new THREE.Group();          // squash/stretch + bob live here
    this.root.add(this.body);

    this._buildTorso();
    this._buildHead();
    this._buildLimbs();
    this._buildGear();
    this._buildTongue();
    if (!isLocal) this._buildNameplate();

    // ---- animation state -------------------------------------------------
    this.t = 0;
    this.stride = 0;
    this.blinkTimer = 1 + Math.random() * 3;
    this.blink = 0;
    this.flip = 0;              // double-jump flip progress, 0..1
    this.lean = 0;
    this.squash = 1;
    this.croakPulse = 0;
    this.tongueLen = 0;
    this.swimPhase = 0;
    this.visible = true;
  }

  // ----------------------------------------------------------------- build

  _buildTorso() {
    const b = this.body;
    // Chunky pear-shaped frog torso.
    this.torso = mesh(G.sphere, this.mats.skin, 0.52, 0.46, 0.46, 0, 0.62, 0);
    b.add(this.torso);
    // Pale belly patch, pushed slightly forward.
    this.bellyM = mesh(G.sphere, this.mats.belly, 0.40, 0.34, 0.33, 0, 0.55, 0.20);
    b.add(this.bellyM);
    // Ninja gi wrapped around the middle.
    b.add(mesh(G.cyl, this.mats.cloth, 0.50, 0.34, 0.46, 0, 0.60, 0));
    // Obi sash.
    b.add(mesh(G.cyl, this.mats.scarf, 0.53, 0.10, 0.49, 0, 0.50, 0));
    // Sash knot.
    b.add(mesh(G.box, this.mats.scarf, 0.16, 0.16, 0.12, 0.34, 0.50, 0.16));
  }

  _buildHead() {
    // Head pivots at the neck so it can tilt toward grapple targets.
    this.head = new THREE.Group();
    this.head.position.set(0, 1.02, 0);
    this.body.add(this.head);

    this.headM = mesh(G.sphere, this.mats.skin, 0.44, 0.36, 0.42, 0, 0, 0);
    this.head.add(this.headM);

    // Wide frog mouth line.
    this.head.add(mesh(G.box, this.mats.skinDark, 0.52, 0.035, 0.10, 0, -0.13, 0.34));
    // Jaw — opens when the tongue fires.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.12, 0.16);
    this.head.add(this.jaw);
    this.jaw.add(mesh(G.sphere, this.mats.skinDark, 0.34, 0.12, 0.26, 0, -0.04, 0.10));

    // --- eyes: big, high on the head, very expressive ---
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * 0.28, 0.26, 0.10);
      this.head.add(g);
      // Green eyelid mound so the eyes sit ON the head, frog-style.
      g.add(mesh(G.lowSphere, this.mats.skin, 0.23, 0.23, 0.23, 0, 0, 0));
      const white = mesh(G.lowSphere, this.mats.eye, 0.185, 0.185, 0.185, 0, 0.02, 0.09);
      g.add(white);
      const pupil = mesh(G.lowSphere, this.mats.pupil, 0.105, 0.135, 0.105, 0, 0.02, 0.20);
      g.add(pupil);
      const shine = mesh(G.lowSphere, this.mats.shine, 0.045, 0.045, 0.045, sx * -0.05, 0.09, 0.24);
      g.add(shine);
      // Lid used for blinking (scales down over the eye).
      const lid = mesh(G.lowSphere, this.mats.skin, 0.24, 0.24, 0.24, 0, 0.10, 0.02);
      lid.scale.y = 0.02;
      g.add(lid);
      this.eyes.push({ group: g, white, pupil, lid });
    }

    // --- ninja hood: dark cowl over the back and top of the skull ---
    const hood = mesh(G.sphere, this.mats.cloth, 0.47, 0.40, 0.45, 0, 0.02, -0.05);
    // Flatten the front so the face stays open.
    hood.scale.z = 0.45;
    hood.position.z = -0.22;
    this.head.add(hood);
    this.head.add(mesh(G.sphere, this.mats.cloth, 0.455, 0.30, 0.44, 0, 0.14, 0));
    // Face mask across the mouth.
    this.head.add(mesh(G.sphere, this.mats.clothDark, 0.435, 0.20, 0.415, 0, -0.14, 0.02));

    // Headband across the brow with two trailing tails.
    this.head.add(mesh(G.cyl, this.mats.scarf, 0.455, 0.075, 0.44, 0, 0.10, 0));
    this.head.add(mesh(G.box, this.mats.gold, 0.14, 0.11, 0.03, 0, 0.10, 0.42));
    this.bandTails = [];
    for (const sx of [-1, 1]) {
      const tail = new THREE.Group();
      tail.position.set(sx * 0.16, 0.10, -0.38);
      this.head.add(tail);
      tail.add(mesh(G.box, this.mats.scarf, 0.09, 0.02, 0.55, 0, 0, -0.28));
      this.bandTails.push(tail);
    }
  }

  _buildLimbs() {
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * 0.46, 0.78, 0);
      this.body.add(shoulder);
      // Upper arm hangs down from the shoulder pivot.
      shoulder.add(mesh(G.capsule, this.mats.cloth, 0.11, 0.16, 0.11, 0, -0.20, 0));
      const fore = new THREE.Group();
      fore.position.set(0, -0.38, 0);
      shoulder.add(fore);
      fore.add(mesh(G.capsule, this.mats.skin, 0.10, 0.13, 0.10, 0, -0.15, 0));
      // Wrist wrap + three-toed frog hand.
      fore.add(mesh(G.cyl, this.mats.clothDark, 0.115, 0.06, 0.115, 0, -0.03, 0));
      const hand = new THREE.Group();
      hand.position.set(0, -0.32, 0);
      fore.add(hand);
      hand.add(mesh(G.lowSphere, this.mats.skin, 0.115, 0.10, 0.115, 0, 0, 0));
      for (let f = 0; f < 3; f++) {
        hand.add(mesh(G.lowSphere, this.mats.skin, 0.05, 0.05, 0.05,
          (f - 1) * 0.09, -0.09, 0.03));
      }
      this.arms.push({ shoulder, fore, hand, side: sx });
    }

    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.27, 0.36, 0);
      this.body.add(hip);
      // Powerful frog thigh, angled outward.
      hip.add(mesh(G.capsule, this.mats.skin, 0.155, 0.15, 0.16, sx * 0.05, -0.14, -0.02));
      const shin = new THREE.Group();
      shin.position.set(sx * 0.08, -0.30, 0);
      hip.add(shin);
      shin.add(mesh(G.capsule, this.mats.skin, 0.10, 0.14, 0.10, 0, -0.13, 0.02));
      shin.add(mesh(G.cyl, this.mats.clothDark, 0.115, 0.07, 0.115, 0, -0.02, 0));
      const foot = new THREE.Group();
      foot.position.set(0, -0.29, 0);
      shin.add(foot);
      // Big webbed foot — reads instantly as "frog".
      foot.add(mesh(G.lowSphere, this.mats.skin, 0.15, 0.06, 0.26, 0, -0.02, 0.11));
      for (let t = 0; t < 3; t++) {
        foot.add(mesh(G.lowSphere, this.mats.skin, 0.055, 0.045, 0.10,
          (t - 1) * 0.10, -0.02, 0.30));
      }
      this.legs.push({ hip, shin, foot, side: sx });
    }
  }

  _buildGear() {
    // --- katana: parented to a pivot so it can move hand <-> back ---
    this.katana = new THREE.Group();
    const blade = mesh(G.box, this.mats.steel, 0.045, 1.35, 0.11, 0, 0.78, 0);
    this.katana.add(blade);
    // Angled tip.
    this.katana.add(mesh(G.cone, this.mats.edge, 0.06, 0.22, 0.075, 0, 1.55, 0));
    this.katana.add(mesh(G.box, this.mats.gold, 0.17, 0.045, 0.17, 0, 0.08, 0));   // tsuba
    this.katana.add(mesh(G.cyl, this.mats.grip, 0.055, 0.30, 0.055, 0, -0.10, 0)); // grip
    this.katana.add(mesh(G.box, this.mats.gold, 0.07, 0.04, 0.07, 0, -0.26, 0));   // pommel
    this.blade = blade;
    this.body.add(this.katana);

    // Sheath worn diagonally across the back.
    this.sheath = new THREE.Group();
    this.sheath.position.set(-0.16, 0.72, -0.40);
    this.sheath.rotation.set(0.25, 0, -0.62);
    this.body.add(this.sheath);
    this.sheath.add(mesh(G.box, this.mats.clothDark, 0.085, 0.80, 0.15, 0, 0.30, 0));
    this.sheath.add(mesh(G.box, this.mats.gold, 0.095, 0.05, 0.16, 0, 0.68, 0));

    // Shoulder strap.
    this.body.add(mesh(G.box, this.mats.clothDark, 0.09, 0.62, 0.09, 0.10, 0.66, -0.10));

    // --- scarf: three trailing segments driven by velocity ---
    this.scarf = [];
    let parent = this.body;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.92 : -0.02, i === 0 ? -0.20 : -0.30);
      parent.add(seg);
      const w = 0.20 - i * 0.035;
      seg.add(mesh(G.box, this.mats.scarf, w, 0.05, 0.34, 0, 0, -0.17));
      this.scarf.push(seg);
      parent = seg;
    }

    // Belt pouch + shuriken detail.
    this.body.add(mesh(G.box, this.mats.clothDark, 0.13, 0.13, 0.08, -0.30, 0.48, 0.14));
    this.sheathPos = this.katana.position.clone();
  }

  _buildTongue() {
    this.tongue = new THREE.Group();
    this.tongue.visible = false;
    // Built along +Y then rotated; scaling Y extends the tongue.
    this.tongueMesh = mesh(G.cyl, this.mats.tongue, 0.075, 1, 0.075, 0, 0.5, 0);
    this.tongueMesh.castShadow = false;
    this.tongue.add(this.tongueMesh);
    this.tongueTip = mesh(G.lowSphere, this.mats.tongue, 0.14, 0.14, 0.14, 0, 1, 0);
    this.tongueTip.castShadow = false;
    this.tongue.add(this.tongueTip);
    // Tongue lives on the root (world-oriented), not the animated body.
    this.root.add(this.tongue);
  }

  _buildNameplate() {
    this.plateCanvas = document.createElement('canvas');
    this.plateCanvas.width = 256;
    this.plateCanvas.height = 72;
    this.plateTex = new THREE.CanvasTexture(this.plateCanvas);
    this.plateTex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.plateTex, transparent: true, depthTest: true, depthWrite: false,
    }));
    spr.scale.set(2.4, 0.68, 1);
    spr.position.set(0, 2.25, 0);
    this.nameplate = spr;
    this.root.add(spr);
    this._plateHealth = -1;
    this.drawNameplate(1);
  }

  /** Redraw the floating name + health bar. `hp01` is health in 0..1. */
  drawNameplate(hp01) {
    if (!this.plateCanvas) return;
    const bucket = Math.round(hp01 * 20);
    if (bucket === this._plateHealth) return;
    this._plateHealth = bucket;

    const c = this.plateCanvas, ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);

    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(this.name, 128, 32);
    ctx.fillStyle = '#eafbe0';
    ctx.fillText(this.name, 128, 32);

    // Health bar.
    const bw = 176, bh = 12, bx = (256 - bw) / 2, by = 46;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(bx, by, bw, bh);
    const hp = clamp(hp01, 0, 1);
    ctx.fillStyle = hp > 0.5 ? '#7ede4f' : hp > 0.25 ? '#e8c34a' : '#e05a4a';
    ctx.fillRect(bx, by, bw * hp, bh);
    this.plateTex.needsUpdate = true;
  }

  // ------------------------------------------------------------- animation

  /**
   * Drive the whole rig from gameplay state.
   * @param {number} dt
   * @param {object} s  {
   *   speed, vy, grounded, dashT, attackT, attackIndex, grappling,
   *   tongueFrom, tongueTo, dead, wallSliding, moving
   * }
   */
  update(dt, s) {
    this.t += dt;
    const t = this.t;

    // ---- death: keel over sideways --------------------------------------
    if (s.dead) {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI * 0.48, 9, dt);
      this.body.position.y = damp(this.body.position.y, -0.25, 8, dt);
      for (const e of this.eyes) e.lid.scale.y = damp(e.lid.scale.y, 1.0, 12, dt);
      this.tongue.visible = false;
      return;
    }
    this.root.rotation.z = damp(this.root.rotation.z, 0, 10, dt);

    const speed = s.speed || 0;
    const moving = s.moving && s.grounded;
    // Sprinting lifts the ceiling so the legs actually cycle faster rather
    // than saturating at the walk-run cap.
    const run = clamp(speed / 15, 0, s.sprinting ? 2.3 : 1.4);

    // ---- stride / hop ----------------------------------------------------
    if (moving) this.stride += dt * (6.0 + run * 5.5);
    else this.stride = damp(this.stride, Math.round(this.stride / Math.PI) * Math.PI, 8, dt);
    const sw = Math.sin(this.stride);
    const swAbs = Math.abs(Math.sin(this.stride));

    // Frogs bounce: a small double-time hop on top of the run cycle.
    const hop = moving ? swAbs * 0.13 * run : 0;

    // ---- body bob, squash, lean -----------------------------------------
    const idleBob = Math.sin(t * 1.9) * 0.025;
    let targetY = (moving ? hop : idleBob);
    let targetSquash = 1;
    let targetLean = 0;
    let targetRoll = 0;

    if (!s.grounded) {
      // Stretch upward on the rise, tuck on the fall.
      const v = clamp(s.vy / 18, -1, 1);
      targetSquash = 1 + v * 0.16;
      targetLean = -v * 0.22;
      targetY = 0.04;
    }
    if (s.dashT > 0) {
      targetLean = 0.62;          // dive forward hard
      targetSquash = 1.14;
      targetY = 0.1;
    }
    if (s.grappling) {
      targetLean = -0.15;
      targetSquash = 1.06;
    }
    if (s.wallSliding) {
      targetRoll = 0.3;
      targetLean = -0.1;
    }
    if (s.swimming) {
      // Body goes near-horizontal and tips with the direction of travel.
      targetLean = 1.32 - (s.swimPitch || 0) * 0.55;
      targetSquash = 1.04;
      targetY = 0.55;              // float the body up off the "feet" origin
      targetRoll = 0;
    }
    // Ninja run: torso pitched almost horizontal, chest low, arms trailing.
    // Only on the ground — mid-air keeps the normal tuck so jumps read clearly.
    const ninjaRun = s.sprinting && moving && !s.swimming;
    if (ninjaRun) {
      targetLean = 1.02;
      targetSquash = 1.06;
      targetY = hop * 0.45 + 0.16;
      targetRoll = 0;
    } else if (moving && !s.swimming) {
      targetLean = lerp(targetLean, 0.16 * run, 0.8);
    }

    this.squash = damp(this.squash, targetSquash, 14, dt);
    this.lean = damp(this.lean, targetLean, 12, dt);
    this.body.position.y = damp(this.body.position.y, targetY, 16, dt);
    this.body.rotation.x = this.lean;
    this.body.rotation.z = damp(this.body.rotation.z, targetRoll, 10, dt);
    this.body.scale.set(1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash));

    // ---- double-jump flip ------------------------------------------------
    if (this.flip > 0) {
      this.flip = Math.max(0, this.flip - dt / 0.44);
      // Ease-out so the frog snaps out of the flip and lands cleanly.
      const p = 1 - this.flip;
      this.body.rotation.x = this.lean - Math.PI * 2 * (p * p * (3 - 2 * p));
    }

    // ---- legs ------------------------------------------------------------
    if (s.swimming) this.swimPhase += dt * 5.0;
    const kick = Math.sin(this.swimPhase);

    for (const leg of this.legs) {
      const phase = leg.side > 0 ? sw : -sw;
      let hipX, shinX;
      if (s.swimming) {
        // Breaststroke: both legs sweep together, wide out then snap closed.
        hipX = -0.5 + kick * 0.95;
        shinX = 1.0 - kick * 0.9;
      } else if (!s.grounded || s.dashT > 0) {
        // Tuck the legs up — classic frog leap silhouette.
        const tuck = s.dashT > 0 ? 1.5 : clamp(1.0 - s.vy / 26, 0.4, 1.5);
        hipX = -1.15 * tuck;
        shinX = 1.9 * tuck;
      } else if (ninjaRun) {
        // Long, low strides to match the pitched-forward torso.
        hipX = phase * 1.30;
        shinX = clamp(-phase, 0, 1) * 1.85 + 0.20;
      } else if (moving) {
        hipX = phase * 0.85 * run;
        shinX = clamp(-phase, 0, 1) * 1.25 * run + 0.15;
      } else {
        hipX = -0.42;              // resting frog crouch
        shinX = 0.85;
      }
      leg.hip.rotation.x = damp(leg.hip.rotation.x, hipX, 20, dt);
      leg.shin.rotation.x = damp(leg.shin.rotation.x, shinX, 20, dt);
      // Legs splay wide on the power stroke — the classic frog kick shape.
      const splay = s.swimming ? 0.30 + Math.max(0, kick) * 0.62 : 0.22;
      leg.hip.rotation.z = damp(leg.hip.rotation.z, leg.side * splay, 10, dt);
      leg.foot.rotation.x = damp(leg.foot.rotation.x,
        s.grounded ? -leg.shin.rotation.x * 0.6 : -0.6, 16, dt);
    }

    // ---- arms ------------------------------------------------------------
    const atk = s.attackT || 0;
    if (atk > 0) {
      this._poseAttack(s.attackIndex || 0, atk, dt);
    } else {
      if (s.parrying) {
        // Held out front, horizontal, catching the blow.
        this.katana.position.set(0.30, 1.02, 0.52);
        this.katana.rotation.set(0.1, 0, 1.5);
      } else {
        // Katana rides on the back when not swinging.
        this.katana.position.set(-0.16, 0.74, -0.42);
        this.katana.rotation.set(0.25, 0, -0.62);
      }
      this.katana.scale.setScalar(1);
      this.sheath.visible = false;   // sword itself stands in for the sheath
      // Unwind the torso twist left over from a swing.
      this.body.rotation.y = damp(this.body.rotation.y, 0, 12, dt);

      for (const arm of this.arms) {
        const phase = arm.side > 0 ? -sw : sw;
        let sx, sz, fx;
        if (s.parrying) {
          // Blade brought up across the body in a guard.
          sx = -1.15; sz = arm.side * (arm.side > 0 ? 0.55 : 0.85); fx = -1.25;
        } else if (s.throwT > 0 && arm.side > 0) {
          // Right arm snaps from cocked-behind-the-ear to fully extended.
          const k = 1 - s.throwT;                 // 0 -> 1 over the throw
          const e = k * k * (3 - 2 * k);
          sx = lerp(-2.35, 0.55, e);
          sz = arm.side * 0.25;
          fx = lerp(-1.5, -0.12, e);
        } else if (s.swimming) {
          // Arms sweep out and back, offset from the leg kick.
          const pull = Math.sin(this.swimPhase - 0.7);
          sx = -0.9 - pull * 0.85;
          sz = arm.side * (0.5 + Math.max(0, pull) * 0.5);
          fx = -0.45 - Math.max(0, -pull) * 0.5;
        } else if (ninjaRun) {
          // Arms swept straight out behind, elbows locked. The rig's arms
          // hang along -Y, so ~1.9rad about X points them back and slightly
          // up, which becomes level once the torso pitch is applied.
          sx = 1.92 + Math.sin(this.stride * 2) * 0.10;
          sz = arm.side * 0.34;
          fx = -0.10;
        } else if (s.grappling) {
          sx = -1.5; sz = arm.side * 0.25; fx = -0.5;
        } else if (!s.grounded) {
          sx = -0.5 - clamp(s.vy / 30, -0.6, 0.6); sz = arm.side * 0.75; fx = -0.55;
        } else if (s.dashT > 0) {
          sx = 1.9; sz = arm.side * 0.2; fx = -0.3;
        } else if (moving) {
          sx = phase * 0.95 * run; sz = arm.side * 0.24; fx = -0.5 - swAbs * 0.3;
        } else {
          sx = 0.06 + Math.sin(t * 1.9) * 0.05; sz = arm.side * 0.30; fx = -0.35;
        }
        arm.shoulder.rotation.x = damp(arm.shoulder.rotation.x, sx, 16, dt);
        arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, sz, 14, dt);
        arm.fore.rotation.x = damp(arm.fore.rotation.x, fx, 16, dt);
      }
    }

    // ---- head ------------------------------------------------------------
    // Head lifts to cancel most of the torso pitch, so the frog keeps its
    // eyes on where it is going instead of staring at the ground.
    let headTiltX = ninjaRun ? -0.86 : (moving ? -0.10 * run : 0.05);
    let headTiltY = 0;
    if (s.grappling && s.tongueTo) {
      // Look along the tongue.
      const dx = s.tongueTo.x - this.root.position.x;
      const dz = s.tongueTo.z - this.root.position.z;
      const dy = s.tongueTo.y - (this.root.position.y + 1.4);
      const flat = Math.hypot(dx, dz);
      headTiltX = -clamp(Math.atan2(dy, flat), -0.9, 0.9);
      const worldYaw = Math.atan2(dx, dz);
      headTiltY = clamp(((worldYaw - this.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.8, 0.8);
    }
    this.head.rotation.x = dampAngle(this.head.rotation.x, headTiltX, 12, dt);
    this.head.rotation.y = dampAngle(this.head.rotation.y, headTiltY, 12, dt);

    // Throat pulse — a frog is never quite still.
    this.croakPulse = damp(this.croakPulse, 0, 6, dt);
    const throat = 1 + Math.sin(t * 3.1) * 0.03 + this.croakPulse * 0.25;
    this.bellyM.scale.set(0.40 * throat, 0.34 * throat, 0.33 * throat);

    // Jaw opens while the tongue is out.
    const jawOpen = s.grappling ? 0.55 : 0;
    this.jaw.rotation.x = damp(this.jaw.rotation.x, jawOpen, 22, dt);

    // ---- blink -----------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blink = 1; this.blinkTimer = 2.2 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 7);
    const lidY = 0.02 + Math.sin(this.blink * Math.PI) * 0.98;
    for (const e of this.eyes) e.lid.scale.y = lidY;

    // ---- cloth: scarf + headband tails trail behind motion ---------------
    const drag = clamp(speed / 20, 0, 1);
    const flutter = Math.sin(t * 11 + this.stride) * 0.16;
    for (let i = 0; i < this.scarf.length; i++) {
      const seg = this.scarf[i];
      const target = 0.5 + drag * 0.85 + flutter * (i + 1) * 0.55 + (s.grounded ? 0 : 0.25);
      seg.rotation.x = damp(seg.rotation.x, target, 12 - i * 2, dt);
      seg.rotation.y = damp(seg.rotation.y, Math.sin(t * 4.2 + i) * 0.22 * (0.3 + drag), 9, dt);
    }
    for (let i = 0; i < this.bandTails.length; i++) {
      const tl = this.bandTails[i];
      tl.rotation.x = damp(tl.rotation.x, 0.25 + drag * 0.7 + flutter * 0.6, 11, dt);
      tl.rotation.y = damp(tl.rotation.y, Math.sin(t * 5 + i * 2) * 0.3, 9, dt);
    }

    // Spin and bob the tagger marker so it catches the eye.
    if (this.tagMarker && this.tagMarker.visible) {
      this.tagMarker.rotation.y += dt * 2.4;
      this.tagMarker.position.y = 2.62 + Math.sin(t * 3.2) * 0.12;
    }

    // ---- tongue ----------------------------------------------------------
    this._updateTongue(dt, s);
  }

  /** Three-hit katana combo: horizontal, reverse horizontal, overhead. */
  _poseAttack(index, p, dt) {
    // `p` runs 1 -> 0 over the swing.
    const k = 1 - p;                       // 0 -> 1 progress
    const sw = Math.sin(Math.min(1, k * 1.25) * Math.PI);   // impulse curve
    const right = this.arms[1];
    const left = this.arms[0];

    // The sword lives in the right hand for the duration of the swing.
    this.katana.scale.setScalar(1);

    if (index === 0) {
      // Right-to-left horizontal slash.
      right.shoulder.rotation.x = lerp(-1.5, 0.2, k);
      right.shoulder.rotation.z = lerp(-1.4, 1.3, smooth(k));
      right.shoulder.rotation.y = lerp(-0.6, 0.9, smooth(k));
      right.fore.rotation.x = -0.5 - sw * 0.4;
      this.body.rotation.y = lerp(0.55, -0.5, smooth(k));
      this.katana.rotation.set(-1.5 + sw * 0.5, 0, lerp(1.5, -1.7, smooth(k)));
    } else if (index === 1) {
      // Reverse slash coming back the other way.
      right.shoulder.rotation.x = lerp(-1.2, 0.1, k);
      right.shoulder.rotation.z = lerp(1.3, -1.2, smooth(k));
      right.shoulder.rotation.y = lerp(0.9, -0.6, smooth(k));
      right.fore.rotation.x = -0.5 - sw * 0.4;
      this.body.rotation.y = lerp(-0.5, 0.55, smooth(k));
      this.katana.rotation.set(-1.4 + sw * 0.4, 0, lerp(-1.7, 1.5, smooth(k)));
    } else {
      // Overhead finisher with a shoulder drop.
      right.shoulder.rotation.x = lerp(-2.5, 1.5, smooth(k));
      right.shoulder.rotation.z = lerp(0.2, 0.05, k);
      right.shoulder.rotation.y = 0;
      right.fore.rotation.x = lerp(-1.3, -0.15, smooth(k));
      this.body.rotation.y = 0;
      this.body.position.y += -sw * 0.12;
      this.katana.rotation.set(lerp(-2.6, 1.3, smooth(k)), 0, 0);
    }

    // Off hand braces near the hilt.
    left.shoulder.rotation.x = damp(left.shoulder.rotation.x, -0.7, 18, dt);
    left.shoulder.rotation.z = damp(left.shoulder.rotation.z, -0.55, 18, dt);
    left.fore.rotation.x = damp(left.fore.rotation.x, -0.9, 18, dt);

    // Park the katana at the right hand's world offset.
    this.katana.position.set(0.52, 0.42, 0.16);
  }

  /**
   * Position the tongue between the mouth and the grapple point.
   * Works in root-local space so it stays correct as the frog rotates.
   */
  _updateTongue(dt, s) {
    if (!s.tongueTo || (!s.grappling && this.tongueLen <= 0.01)) {
      this.tongue.visible = false;
      this.tongueLen = 0;
      return;
    }

    const from = new THREE.Vector3(0, 1.42, 0.30);      // mouth, root-local
    this.root.localToWorld(from);
    const to = s.tongueTo;

    const dir = new THREE.Vector3().subVectors(to, from);
    const full = dir.length();
    if (full < 0.01) { this.tongue.visible = false; return; }
    dir.multiplyScalar(1 / full);

    // Extend fast on fire, retract fast on release.
    const target = s.grappling ? full : 0;
    const rate = s.grappling ? 220 : 170;
    this.tongueLen = Math.abs(this.tongueLen - target) < rate * dt
      ? target
      : this.tongueLen + Math.sign(target - this.tongueLen) * rate * dt;

    if (this.tongueLen <= 0.02) { this.tongue.visible = false; return; }

    this.tongue.visible = true;
    // The tongue group is a child of root, so undo the root transform.
    this.tongue.position.copy(this.root.worldToLocal(from.clone()));
    const localDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.root.rotation.y);
    this.tongue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);

    const L = this.tongueLen;
    // Slight taper + wobble so it feels organic rather than like a rod.
    const wob = 1 + Math.sin(this.t * 30) * 0.08;
    this.tongueMesh.scale.set(0.075 * wob, L, 0.075 * wob);
    this.tongueMesh.position.y = L * 0.5;
    this.tongueTip.position.y = L;
    this.tongueTip.visible = s.grappling;
  }

  /**
   * Show or hide the "this frog is it" marker: a bright inverted cone
   * hovering above the head, visible across the map during a chase.
   */
  setTagger(v) {
    if (this._isTagger === v) return;
    this._isTagger = v;
    if (v && !this.tagMarker) {
      const g = new THREE.Group();
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.34, 0.6, 5),
        new THREE.MeshBasicMaterial({ color: 0xff5a3c })
      );
      cone.rotation.x = Math.PI;          // point the tip down at the frog
      g.add(cone);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.07, 6, 14),
        new THREE.MeshBasicMaterial({ color: 0xffb03c })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.42;
      g.add(ring);
      g.position.set(0, 2.62, 0);
      this.tagMarker = g;
      this.root.add(g);
    }
    if (this.tagMarker) this.tagMarker.visible = v;
  }

  /**
   * Point the frog along a gameplay yaw.
   *
   * The rig is modelled facing +Z (eyes, mouth and toes are all at positive
   * Z, scarf and sheath trail at negative Z), while gameplay yaw points along
   * -Z — so the half-turn here is what stops the frog from running backwards
   * and staring into the camera. Always set facing through this method.
   */
  setFacing(yaw) {
    this.root.rotation.y = yaw + Math.PI;
  }

  /** Called by the player controller the moment a double jump starts. */
  triggerFlip() { this.flip = 1; }
  /** Little throat puff — used on jumps and croaks. */
  croak() { this.croakPulse = 1; }

  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.root.visible = v;
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); });
    for (const k in this.mats) this.mats[k].dispose();
    if (this.plateTex) this.plateTex.dispose();
  }
}

const smooth = (t) => t * t * (3 - 2 * t);
