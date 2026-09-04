/**
 * The ninja frog character.
 *
 * Everything is built procedurally out of primitives — no external model
 * files — and animated by a small hand-written procedural rig. The rig is
 * driven purely from gameplay state (speed, grounded, dash timer, attack
 * timer, ...) which means the exact same code animates the local player and
 * every networked remote player.
 */

import * as THREE from '../lib/three.module.js?v=v54';
import { CFG } from './config.js?v=v54';
import { clamp, lerp, damp, dampAngle } from './util.js?v=v54';

const CLOTH = 0x24242e;        // ninja gi
const CLOTH_DARK = 0x16161d;
const SCARF = 0xc0392b;
const BELLY = 0xdfe6a8;
const EYE_WHITE = 0xfefbe8;

/**
 * A patch of a unit sphere: the latitude band between polar angles t0 and t1,
 * optionally narrowed to an azimuth wedge of `phiLen` centred on the face
 * (+Z). SphereGeometry measures theta from the +Y pole and puts phi = PI/2 at
 * +Z, which is why the wedge is centred there.
 *
 * This is the workhorse for every layer of clothing on the frog. A band, a
 * sash or a belly patch built this way sits ON the surface of whatever
 * ellipsoid it is scaled onto, so it cannot gap away from the body or push a
 * corner out through it — which is exactly what a cylinder or a box wrapped
 * around a sphere does, and what made the old model read as a pile of parts.
 */
function bandGeo(t0, t1, phiLen = Math.PI * 2, seg = 30, rings = 8) {
  return new THREE.SphereGeometry(1, seg, rings,
    Math.PI / 2 - phiLen / 2, phiLen, t0, t1 - t0);
}

/**
 * A hood: ONE continuous shell over a whole ellipsoid with a single oval
 * opening in the front.
 *
 * Built as a sock rather than as a heap of overlapping blobs. Every point is
 * a slerp from a point on the opening's rim to the pole opposite it, so the
 * result is a single smooth sheet with an exactly elliptical edge at the
 * front that closes cleanly at the back — the two properties that make a
 * hood read as fitted to the head instead of balanced on top of it. There is
 * no seam to show and no separate piece that can drift out of alignment,
 * because there is only one piece.
 *
 * Returned on the UNIT sphere so the caller can scale it onto whatever
 * ellipsoid the head or torso is. Normals are the positions, which is exact
 * on a sphere; Three's normal matrix keeps them correct under that scale.
 *
 * @param openW  half-width of the face opening, radians
 * @param openH  half-height of the face opening, radians
 * @param tilt   how far above the equator the opening is centred, radians
 */
function cowlGeo(openW, openH, tilt, radial = 40, rings = 14) {
  const pos = [], uv = [], idx = [];
  // A frame around the opening's centre: C through the middle of the
  // opening, R across it, U up it.
  const C = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  const R = new THREE.Vector3(1, 0, 0);
  const U = new THREE.Vector3(0, Math.cos(tilt), -Math.sin(tilt));
  const A = C.clone().negate();                 // the far side of the shell
  const rim = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();

  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * Math.PI * 2;
    // Where the rim sits: an ellipse in angle-space around C.
    const du = openW * Math.cos(a), dv = openH * Math.sin(a);
    const off = Math.hypot(du, dv);
    n.set(0, 0, 0).addScaledVector(R, du).addScaledVector(U, dv).normalize();
    rim.copy(C).multiplyScalar(Math.cos(off)).addScaledVector(n, Math.sin(off));
    const w = Math.PI - off;                    // rim to the far pole
    const sw = Math.sin(w);
    for (let j = 0; j <= rings; j++) {
      const s = j / rings;
      p.copy(rim).multiplyScalar(Math.sin((1 - s) * w) / sw)
        .addScaledVector(A, Math.sin(s * w) / sw).normalize();
      pos.push(p.x, p.y, p.z);
      uv.push(i / radial, s);
    }
  }
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < rings; j++) {
      const c0 = i * (rings + 1) + j, c1 = (i + 1) * (rings + 1) + j;
      idx.push(c0, c1, c0 + 1, c1, c1 + 1, c0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.slice(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** The point on an ellipsoid's surface lying in the direction (dx, dy, dz). */
function onShell(rx, ry, rz, dx, dy, dz) {
  const l = Math.hypot(dx, dy, dz) || 1;
  const x = dx / l, y = dy / l, z = dz / l;
  const k = 1 / Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
  return new THREE.Vector3(x * k, y * k, z * k);
}

/**
 * Shared geometries — every frog reuses these, so memory stays flat.
 *
 * The segment counts are what stop the frog reading as faceted blocks. They
 * are graded by how big the part is on screen rather than turned up across
 * the board: a fingertip does not need the same mesh as the torso, and the
 * geometry is shared but the TRIANGLES ARE NOT — every frog on the map draws
 * all of them, so a lazy number here costs a frame on the weakest machine
 * someone plays this on. Rounding everything off to 28x20 came to 71k
 * triangles a frog, twelve times what it needs.
 */
const G = {
  sphere: new THREE.SphereGeometry(1, 22, 16),      // torso, head, big masses
  lowSphere: new THREE.SphereGeometry(1, 14, 10),   // joints, hands, feet, eyes
  bead: new THREE.SphereGeometry(1, 10, 7),         // fingers, toes, highlights
  box: new THREE.BoxGeometry(1, 1, 1),
  capsule: new THREE.CapsuleGeometry(1, 1, 5, 14),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone: new THREE.ConeGeometry(1, 1, 12),
  torus: new THREE.TorusGeometry(1, 0.12, 8, 24),

  // ---- fitted clothing, each one a shell on the body it is worn over ----
  hood: cowlGeo(0.95, 0.62, -0.30),      // skull, open at the muzzle
  gi: cowlGeo(0.72, 0.62, -0.18),        // torso, open at the belly
  crease: bandGeo(1.63, 1.71, 1.40),     // the wide frog mouth
  band: bandGeo(1.14, 1.40),             // headband, right around the skull
  belly: bandGeo(1.02, 2.48, 1.90),      // pale front, behind the gi's opening
  obi: bandGeo(1.70, 2.03),              // sash
  socket: new THREE.TorusGeometry(1, 0.115, 8, 22),
};

// Scratch colours for the divine skin's phase blend, so it allocates none.
const _dvA = new THREE.Color();
const _dvB = new THREE.Color();

function mesh(geo, mat, sx, sy, sz, px, py, pz, rx, ry, rz) {
  const m = new THREE.Mesh(geo, mat);
  if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
  m.scale.set(sx, sy, sz);
  m.position.set(px || 0, py || 0, pz || 0);
  m.castShadow = true;
  return m;
}

/**
 * Build a katana.
 *
 * Shared by the player frogs and the juggernaut toad so there is exactly one
 * katana in the game — the juggernaut's is the same weapon scaled up, which
 * is the point: it should read as the familiar blade, only enormous.
 *
 * Modelled along +Y with the grip below the origin: a round tsuba, a habaki
 * collar, and a black cord wrap with pale diamonds showing through, which is
 * what gives the handle its woven look at a distance.
 *
 * @param m materials: steel, edge, gold (tsuba), grip (cord), same (wrap)
 * @returns a Group; `userData.blade` is the blade mesh the shine effect uses
 */
export function buildKatana(m, fx) {
  const k = new THREE.Group();
  const F = fx || {};
  const L = F.long || 1;                      // blade length multiplier

  // ---- blade ----
  // Each shape is a genuinely different weapon, not a tinted katana. This is
  // the whole reason a sword crate is worth opening.
  const blade = mesh(G.box, m.steel, 0.045, 1.35 * L, 0.11, 0, 0.78 * L, 0);
  const tipY = 1.55 * L;
  switch (F.shape) {
    case 'broad':
      // A heavy cleaver: wide, blunt-shouldered, squared off.
      blade.scale.set(0.06, 1.30 * L, 0.24);
      k.add(mesh(G.box, m.edge, 0.065, 1.26 * L, 0.05, 0, 0.78 * L, 0.09));
      k.add(mesh(G.box, m.steel, 0.06, 0.16, 0.24, 0, tipY - 0.10, 0));
      break;
    case 'serrated':
      // Teeth down one edge.
      blade.scale.set(0.05, 1.32 * L, 0.13);
      for (let i = 0; i < 9; i++) {
        k.add(mesh(G.cone, m.edge, 0.05, 0.09, 0.05,
          0, 0.28 + i * 0.135 * L, 0.085, 0, 0, -Math.PI / 2));
      }
      k.add(mesh(G.cone, m.edge, 0.055, 0.20, 0.07, 0, tipY, 0));
      break;
    case 'curved': {
      // A sabre: stacked segments describing an arc.
      blade.visible = false;
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        k.add(mesh(G.box, m.steel, 0.05, 0.22 * L, 0.115,
          0, (0.24 + i * 0.21) * L, t * t * 0.28, 0, 0, 0, t * 0.16));
      }
      k.add(mesh(G.cone, m.edge, 0.055, 0.22, 0.07, 0, tipY, 0.30, 0.22));
      break;
    }
    case 'fang':
      // Short, thick and wickedly pointed.
      blade.scale.set(0.075, 1.05 * L, 0.15);
      blade.position.y = 0.62 * L;
      k.add(mesh(G.cone, m.edge, 0.09, 0.40, 0.17, 0, 1.30 * L, 0));
      break;
    case 'light':
      // Not steel at all — a bar of light, like the god's.
      blade.scale.set(0.10, 1.42 * L, 0.30);
      k.add(mesh(G.box, m.edge, 0.14, 1.36 * L, 0.16, 0, 0.80 * L, 0));
      k.add(mesh(G.cone, m.edge, 0.12, 0.34, 0.30, 0, tipY + 0.06, 0));
      break;
    default:                                   // katana
      k.add(mesh(G.box, m.edge, 0.048, 1.32 * L, 0.035, 0, 0.78 * L, 0.036));
      k.add(mesh(G.cone, m.edge, 0.06, 0.22, 0.075, 0, tipY, 0));
      break;
  }
  k.add(blade);

  // A second blade out of the pommel — the Ascended's double-ended weapon.
  // Mirrored below the grip so the whole thing reads as one bar of light
  // through his fist rather than two swords.
  if (F.doubled) {
    const back = blade.clone();
    back.position.y = -blade.position.y - 0.34;
    back.rotation.z = Math.PI;
    k.add(back);
    k.add(mesh(G.cone, m.edge, 0.12, 0.30, 0.28, 0, -tipY - 0.30, 0, Math.PI));
  }

  // Glowing marks along the flat.
  if (F.runes && m.rune) {
    for (let i = 0; i < 5; i++) {
      k.add(mesh(G.box, m.rune, 0.055, 0.035, 0.035,
        0, (0.32 + i * 0.24) * L, 0.05));
    }
  }
  // A soft shell of light around the blade.
  if (F.aura && m.aura) {
    const a = mesh(G.box, m.aura, 0.20, 1.5 * L, 0.34, 0, 0.80 * L, 0);
    a.castShadow = false;
    k.add(a);
  }

  k.add(mesh(G.cyl, m.gold, 0.055, 0.10, 0.055, 0, 0.14, 0));       // habaki

  // ---- guard ----
  switch (F.tsuba) {
    case 'square':
      k.add(mesh(G.box, m.gold, 0.30, 0.032, 0.30, 0, 0.07, 0));
      break;
    case 'cross':
      k.add(mesh(G.box, m.gold, 0.46, 0.05, 0.09, 0, 0.07, 0));
      k.add(mesh(G.box, m.gold, 0.09, 0.05, 0.30, 0, 0.07, 0));
      break;
    case 'ring':
      k.add(mesh(G.torus, m.gold, 0.19, 0.19, 0.19, 0, 0.07, 0, Math.PI / 2));
      break;
    case 'none':
      break;
    default:                                   // disc
      k.add(mesh(G.cyl, m.gold, 0.165, 0.028, 0.165, 0, 0.07, 0));
      break;
  }

  // ---- tsuka: ivory same under a cord wrap ----
  k.add(mesh(G.cyl, m.same, 0.052, 0.30, 0.052, 0, -0.10, 0));
  k.add(mesh(G.cyl, m.grip, 0.058, 0.30, 0.058, 0, -0.10, 0));
  for (let i = 0; i < 5; i++) {
    const y = -0.005 - i * 0.055;
    k.add(mesh(G.box, m.same, 0.030, 0.030, 0.125, 0, y, 0, 0));
    k.add(mesh(G.box, m.same, 0.125, 0.030, 0.030, 0, y - 0.027, 0));
  }
  k.add(mesh(G.cyl, m.gold, 0.062, 0.035, 0.062, 0, -0.255, 0));    // kashira

  // A cord hanging from the pommel.
  if (F.tassel && m.tassel) {
    for (let i = 0; i < 3; i++) {
      k.add(mesh(G.box, m.tassel, 0.022, 0.16, 0.022,
        (i - 1) * 0.03, -0.36 - i * 0.02, 0));
    }
  }

  k.userData.blade = blade;
  return k;
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

    // `fx` is what makes a skin more than a recolour — glowing hide, inlay,
    // horns, a halo. Read once here and used by the builders below.
    const ffx = (useCustomFrog && fs.fx) || {};
    const sfx = (ss && ss.fx) || {};
    this.fx = ffx;
    this.swordFx = sfx;

    this.mats = {
      skin: new THREE.MeshLambertMaterial({
        color: skin, emissive: ffx.emissive || 0x000000,
      }),
      skinDark: new THREE.MeshLambertMaterial({
        color: skinDark,
        emissive: ffx.emissive
          ? new THREE.Color(ffx.emissive).multiplyScalar(0.6) : 0x000000,
      }),
      belly: new THREE.MeshLambertMaterial({ color: useCustomFrog ? fs.belly : BELLY }),
      cloth: new THREE.MeshLambertMaterial({ color: useCustomFrog ? fs.cloth : CLOTH }),
      clothDark: new THREE.MeshLambertMaterial({
        color: new THREE.Color(useCustomFrog ? fs.cloth : CLOTH).multiplyScalar(0.62),
      }),
      // The hood and the gi are open shells with a real edge, so they are
      // drawn from both sides: at the rim you see the inside of the garment
      // rather than straight through a surface with no thickness.
      cowl: new THREE.MeshLambertMaterial({
        color: useCustomFrog ? fs.cloth : CLOTH, side: THREE.DoubleSide,
      }),
      scarf: new THREE.MeshLambertMaterial({ color: useCustomFrog ? fs.scarf : SCARF }),
      eye: new THREE.MeshBasicMaterial({ color: EYE_WHITE }),
      pupil: new THREE.MeshBasicMaterial({ color: 0x101014 }),
      shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      // A glowing blade is emissive-lit rather than shaded — it is the light
      // source, not a thing the world lights.
      steel: sfx.glow
        ? new THREE.MeshBasicMaterial({ color: ss.blade })
        : new THREE.MeshLambertMaterial({
          color: ss ? ss.blade : 0xd9dee6,
          emissive: ss ? ss.glow : 0x2a3038,
        }),
      edge: sfx.glow
        ? new THREE.MeshBasicMaterial({ color: ss.edge })
        : new THREE.MeshLambertMaterial({ color: ss ? ss.edge : 0xf2f6fb }),
      gold: new THREE.MeshLambertMaterial({ color: ss ? ss.guard : 0xc9a227 }),
      grip: new THREE.MeshLambertMaterial({ color: ss ? ss.grip : CLOTH_DARK }),
      // Ivory rayskin under the cord wrap, and the lacquered scabbard. Both
      // follow the sword skin so a bought katana stays one coherent object.
      same: new THREE.MeshLambertMaterial({ color: ss ? ss.guard : 0xe4e0d2 }),
      saya: new THREE.MeshLambertMaterial({
        color: new THREE.Color(ss ? ss.grip : CLOTH_DARK).multiplyScalar(1.15),
      }),
      tongue: new THREE.MeshLambertMaterial({ color: 0xef7d9d }),
    };

    // ---- optional materials, only made when a skin asks for them ----
    if (sfx.runes) this.mats.rune = new THREE.MeshBasicMaterial({ color: sfx.runes });
    if (sfx.tassel) this.mats.tassel = new THREE.MeshLambertMaterial({ color: sfx.tassel });
    if (sfx.aura) {
      this.mats.aura = new THREE.MeshBasicMaterial({
        color: sfx.aura, transparent: true, opacity: 0.22, depthWrite: false,
      });
    }
    if (ffx.pattern) this.mats.inlay = new THREE.MeshBasicMaterial({ color: ffx.pattern });
    if (ffx.eyeGlow) this.mats.eyeLit = new THREE.MeshBasicMaterial({ color: ffx.eyeGlow });
    if (ffx.halo) {
      this.mats.halo = new THREE.MeshBasicMaterial({
        color: ffx.halo, transparent: true, opacity: 0.9,
      });
    }
    if (ffx.aura) {
      this.mats.bodyAura = new THREE.MeshBasicMaterial({
        color: ffx.aura, transparent: true, opacity: 0.14,
        side: THREE.BackSide, depthWrite: false,
      });
    }

    this.root = new THREE.Group();          // sits at the player's ground point
    /**
     * Raises the whole animated rig so the SOLES rest on the ground.
     *
     * The rig is modelled with its feet hanging below its own origin — hip
     * +0.36, shin -0.30, foot -0.29, sole -0.08 — which puts the bottom of
     * the foot about a third of a unit under y=0. Since the root is placed
     * exactly at the ground point, that difference was the frog standing
     * buried to the ankles.
     *
     * Fixing it here rather than by moving the legs keeps every pose, offset
     * and animation in the file untouched: they all still work in a space
     * where 0 is "stood normally". The exact amount is measured from the
     * geometry in `_groundRig` instead of hard-coded, so it stays correct if
     * the legs are ever remodelled.
     */
    this.lift = new THREE.Group();
    this.root.add(this.lift);
    this.body = new THREE.Group();          // squash/stretch + bob live here
    this.lift.add(this.body);
    this._lift = 0;

    this._buildTorso();
    this._buildHead();
    this._buildLimbs();
    this._groundRig();
    this._buildGear();
    this._buildTongue();
    this._buildSkinFx();
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

  /**
   * The torso, built as concentric layers on ONE body shape.
   *
   * The frog underneath is a single pear-shaped mass, and everything worn
   * over it — belly, gi, sash — is a shell scaled onto that same mass rather
   * than a separate solid parked next to it. That is what makes the torso
   * read as one body: the layers cannot gap, cannot intersect at an angle,
   * and cannot show a cut edge, because they are all the same surface at
   * slightly different radii.
   *
   * The old version stacked a squashed sphere, a cylinder and a box, and the
   * cylinder's flat rims sliced two hard rings across the frog's middle.
   */
  _buildTorso() {
    const b = this.body;
    const C = [0, 0.62, 0];                        // the torso's centre
    const R = [0.52, 0.46, 0.46];                  // and its radii

    // The body mass itself.
    this.torso = mesh(G.sphere, this.mats.skin, R[0], R[1], R[2], ...C);
    b.add(this.torso);

    // Pale belly, lying on the body and showing through the gi's opening.
    // Scaled about the torso's centre so the throat pulse in update() puffs
    // it straight out from the body instead of sliding it around.
    //
    // The gaps between layers are not arbitrary. Each shell is a POLYGON
    // approximating its ellipsoid, so it sags inside the true surface between
    // its own vertices; if the next layer up sits closer than that sag, the
    // one underneath pushes through it in a scalloped fringe wherever the two
    // meshes' facets fall out of step. 2.5% clears the sag of every shell
    // here with room to spare.
    this.bellyBase = [R[0] * 1.03, R[1] * 1.03, R[2] * 1.03];
    this.bellyM = mesh(G.belly, this.mats.belly, ...this.bellyBase, ...C);
    b.add(this.bellyM);

    // The gi: one piece of cloth over the whole torso, open at the front.
    b.add(mesh(G.gi, this.mats.cowl, R[0] * 1.055, R[1] * 1.055, R[2] * 1.055, ...C));

    // Obi sash, wrapped right around the outside of the gi.
    const OR = [R[0] * 1.088, R[1] * 1.088, R[2] * 1.088];
    b.add(mesh(G.obi, this.mats.scarf, ...OR, ...C));
    // Its knot, sitting on the sash rather than floating beside it.
    const k = onShell(...OR, 0.62, -0.30, 0.72);
    b.add(mesh(G.sphere, this.mats.scarf, 0.085, 0.075, 0.07,
      C[0] + k.x, C[1] + k.y, C[2] + k.z));
    for (const s of [-1, 1]) {
      b.add(mesh(G.capsule, this.mats.scarf, 0.032, 0.055, 0.032,
        C[0] + k.x * 1.02, C[1] + k.y * 1.02 - 0.10, C[2] + k.z * 1.02,
        0.25, 0, s * 0.45));
    }
  }

  _buildHead() {
    // Head pivots at the neck so it can tilt toward grapple targets.
    this.head = new THREE.Group();
    this.head.position.set(0, 1.02, 0);
    this.body.add(this.head);

    // The skull. Every layer below is a shell scaled onto these radii, so the
    // hood, the mask and the headband all follow the same surface.
    const H = [0.44, 0.36, 0.42];
    this.headR = H;
    this.headM = mesh(G.sphere, this.mats.skin, ...H, 0, 0, 0);
    this.head.add(this.headM);

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
      const shine = mesh(G.bead, this.mats.shine, 0.045, 0.045, 0.045, sx * -0.05, 0.09, 0.24);
      g.add(shine);
      // Lid used for blinking: a dome that flattens to a disc when open and
      // swells back over the eye to close it. Nudged forward of the old
      // position so a shut lid actually covers the pupil.
      const lid = mesh(G.lowSphere, this.mats.skin, 0.24, 0.24, 0.24, 0, 0.07, 0.06);
      lid.scale.y = 0.02;
      g.add(lid);
      this.eyes.push({ group: g, white, pupil, lid });
    }

    // --- the ninja hood ---
    //
    // One shell, drawn on the skull's own surface at a fixed 5% clearance, so
    // it fits the head everywhere by construction: no gap to open up at the
    // back, no corner to push out at the sides, nothing to fall out of
    // alignment. It replaces three overlapping ellipsoids that each had their
    // own idea of where the head was.
    //
    // The eyes are the one thing that comes THROUGH it, which is correct for
    // a frog — they are bulges under the cloth. Each gets a piped rim below,
    // so the hood is visibly stretched around the socket rather than merely
    // interpenetrating it.
    this.head.add(mesh(G.hood, this.mats.cowl, H[0] * 1.05, H[1] * 1.05, H[2] * 1.05));
    // The muzzle inside the opening stays bare green, which is how this frog
    // has always looked. The old build did add a cloth face mask here, but at
    // (0.435, 0.20, 0.415) against a head of (0.44, 0.36, 0.42) it was
    // narrower than the skull in both x and z — sealed inside it, never drawn
    // a single frame. Making it visible would change the face, so it is gone.
    //
    // The frog's wide mouth, creased along the head's own surface instead of
    // a flat slab hanging in front of the face.
    this.head.add(mesh(G.crease, this.mats.skinDark,
      H[0] * 1.022, H[1] * 1.022, H[2] * 1.022));

    // Sockets: the hood pulled tight around each eye.
    for (const e of this.eyes) {
      const d = e.group.position.clone().normalize();
      const ring = new THREE.Mesh(G.socket, this.mats.cowl);
      ring.scale.setScalar(0.238);
      ring.position.copy(d).multiplyScalar(0.035);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      ring.castShadow = true;
      e.group.add(ring);
    }

    // Headband, wrapped right around the outside of the hood. A band on the
    // head's own surface cannot poke out at the sides the way the old
    // cylinder's corners did.
    const BR = [H[0] * 1.075, H[1] * 1.075, H[2] * 1.075];
    this.head.add(mesh(G.band, this.mats.scarf, ...BR));
    // The plate at the front, seated on the band.
    const p = onShell(...BR, 0, 0.28, 1);
    this.head.add(mesh(G.lowSphere, this.mats.gold, 0.085, 0.062, 0.05,
      p.x, p.y, p.z * 1.005));

    // Two trailing tails. They hang down the back of the hood at rest and
    // stream out behind when running — the old pair sat up above the head
    // like antennae whatever the frog was doing.
    this.bandTails = [];
    for (const sx of [-1, 1]) {
      const tail = new THREE.Group();
      const t = onShell(...BR, sx * 0.55, -0.02, -1);
      tail.position.set(t.x, t.y, t.z);
      this.head.add(tail);
      // A flat ribbon trailing back off the knot, tapering and bending a
      // little so it reads as cloth rather than as a plank. Hanging rounded
      // segments straight down instead left a row of red beads beside the
      // neck with nothing joining them to the band.
      tail.add(mesh(G.box, this.mats.scarf, 0.085, 0.022, 0.30, 0, -0.015, -0.15));
      tail.add(mesh(G.box, this.mats.scarf, 0.058, 0.018, 0.26,
        0, -0.055, -0.41, 0.22));
      this.bandTails.push(tail);
    }
  }

  /**
   * Arms and legs.
   *
   * Every joint carries a rounded blend — a deltoid at the shoulder, a ball
   * at the elbow and knee, an ankle under the shin — sized to bridge the two
   * limbs it joins. Without them a capsule meeting a capsule at an angle
   * leaves a visible notch on the outside of the bend, and four of those down
   * each limb is most of what made the frog look assembled rather than
   * modelled. The bones themselves are unchanged, so every pose still works.
   */
  _buildLimbs() {
    this.arms = [];
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sx * 0.46, 0.78, 0);
      this.body.add(shoulder);
      // Deltoid: fills the corner where the arm leaves the gi.
      shoulder.add(mesh(G.lowSphere, this.mats.cloth, 0.145, 0.145, 0.145,
        sx * -0.015, -0.03, 0));
      // Upper arm hangs down from the shoulder pivot.
      shoulder.add(mesh(G.capsule, this.mats.cloth, 0.113, 0.16, 0.113, 0, -0.20, 0));
      const fore = new THREE.Group();
      fore.position.set(0, -0.38, 0);
      shoulder.add(fore);
      fore.add(mesh(G.lowSphere, this.mats.skin, 0.107, 0.107, 0.107, 0, 0.01, 0));
      fore.add(mesh(G.capsule, this.mats.skin, 0.10, 0.13, 0.10, 0, -0.15, 0));
      // Arm wrap: a rounded band, not a cylinder with two cut rims.
      fore.add(mesh(G.lowSphere, this.mats.clothDark, 0.117, 0.082, 0.117, 0, -0.03, 0));
      const hand = new THREE.Group();
      hand.position.set(0, -0.32, 0);
      fore.add(hand);
      hand.add(mesh(G.lowSphere, this.mats.skin, 0.118, 0.108, 0.122, 0, -0.01, 0.008));
      // Three fingers, splayed and tapering out of the palm.
      for (let f = 0; f < 3; f++) {
        const a = (f - 1) * 0.5;
        hand.add(mesh(G.capsule, this.mats.skin, 0.046, 0.042, 0.046,
          Math.sin(a) * 0.088, -0.088, 0.028, 0, 0, a));
      }
      this.arms.push({ shoulder, fore, hand, side: sx });
    }

    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.27, 0.36, 0);
      this.body.add(hip);
      // Haunch: the mass that carries the thigh into the body.
      hip.add(mesh(G.lowSphere, this.mats.skin, 0.178, 0.168, 0.182,
        sx * 0.035, -0.03, -0.01));
      // Powerful frog thigh, angled outward.
      hip.add(mesh(G.capsule, this.mats.skin, 0.155, 0.15, 0.16, sx * 0.05, -0.14, -0.02));
      const shin = new THREE.Group();
      shin.position.set(sx * 0.08, -0.30, 0);
      hip.add(shin);
      shin.add(mesh(G.lowSphere, this.mats.skin, 0.112, 0.108, 0.112, 0, 0.015, 0));
      shin.add(mesh(G.capsule, this.mats.skin, 0.10, 0.14, 0.10, 0, -0.13, 0.02));
      shin.add(mesh(G.lowSphere, this.mats.clothDark, 0.119, 0.09, 0.119, 0, -0.02, 0));
      const foot = new THREE.Group();
      foot.position.set(0, -0.29, 0);
      shin.add(foot);
      // Ankle, so the shin does not simply end above the foot.
      foot.add(mesh(G.lowSphere, this.mats.skin, 0.098, 0.085, 0.10, 0, 0.055, 0.005));
      // Big webbed foot — reads instantly as "frog".
      foot.add(mesh(G.lowSphere, this.mats.skin, 0.15, 0.062, 0.26, 0, -0.02, 0.11));
      // Toes, with the web filled in between them rather than three
      // free-floating beads on the front edge.
      foot.add(mesh(G.bead, this.mats.skin, 0.152, 0.032, 0.13, 0, -0.021, 0.255));
      for (let t = 0; t < 3; t++) {
        foot.add(mesh(G.capsule, this.mats.skin, 0.05, 0.036, 0.05,
          (t - 1) * 0.102, -0.021, 0.30, Math.PI / 2, 0, 0));
      }
      this.legs.push({ hip, shin, foot, side: sx });
    }
  }

  /**
   * Measure how far the feet hang below the origin, and lift by exactly that.
   *
   * Run once, right after the legs are built and while everything is still in
   * its rest pose at the world origin — so a local-space box is a world-space
   * box, and the number needs no correction.
   */
  _groundRig() {
    this.lift.position.y = 0;
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let lowest = Infinity;
    for (const leg of this.legs) {
      box.setFromObject(leg.foot);
      if (box.min.y < lowest) lowest = box.min.y;
    }
    if (!Number.isFinite(lowest)) return;
    // Lift the measured drop, then give a little of it back so the soles
    // settle INTO the ground rather than balancing exactly on it. Landing
    // the feet at precisely zero is geometrically right and looks wrong —
    // the frog reads as hovering, because a shadow under a foot that only
    // ever grazes the floor is what floating looks like.
    this._lift = Math.max(0, -lowest - CFG.move.footSink);
    this.lift.position.y = this._lift;
  }

  _buildGear() {
    // --- katana: parented to a pivot so it can move hand <-> back ---
    this.katana = buildKatana(this.mats, this.swordFx);
    this.blade = this.katana.userData.blade;
    this.body.add(this.katana);

    // Sheath worn diagonally across the back: glossy black saya with a pale
    // koiguchi and kojiri, matching the blade it holds.
    this.sheath = new THREE.Group();
    this.sheath.position.set(-0.16, 0.72, -0.40);
    this.sheath.rotation.set(0.25, 0, -0.62);
    this.body.add(this.sheath);
    this.sheath.add(mesh(G.box, this.mats.saya, 0.085, 0.80, 0.15, 0, 0.30, 0));
    this.sheath.add(mesh(G.box, this.mats.gold, 0.095, 0.05, 0.16, 0, 0.68, 0));
    this.sheath.add(mesh(G.box, this.mats.gold, 0.092, 0.045, 0.158, 0, -0.08, 0));
    // Sageo cord tied near the mouth of the scabbard.
    this.sheath.add(mesh(G.cyl, this.mats.grip, 0.10, 0.05, 0.17, 0, 0.60, 0));

    // Shoulder strap.
    this.body.add(mesh(G.box, this.mats.clothDark, 0.09, 0.62, 0.09, 0.10, 0.66, -0.10));

    // --- scarf: three trailing segments driven by velocity ---
    this.scarf = [];
    let parent = this.body;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.92 : -0.02, i === 0 ? -0.20 : -0.30);
      parent.add(seg);
      // Flat cloth: a scarf is a ribbon, and a chain of rounded segments
      // reads as sausage links rather than as fabric.
      const w = 0.20 - i * 0.035;
      seg.add(mesh(G.box, this.mats.scarf, w, 0.05, 0.34, 0, 0, -0.17));
      this.scarf.push(seg);
      parent = seg;
    }

    // Belt pouch + shuriken detail.
    this.body.add(mesh(G.box, this.mats.clothDark, 0.13, 0.13, 0.08, -0.30, 0.48, 0.14));
    this.sheathPos = this.katana.position.clone();
  }

  /**
   * Everything a skin adds beyond colour.
   *
   * This is the whole answer to "why buy a crate" — a recolour costs nothing
   * and is worth nothing, so a skin above common physically changes the frog:
   * spines, fins, horns, a crown, glowing inlay, a halo, a shell of light.
   * Built last so it sits on top of the finished rig.
   */
  _buildSkinFx() {
    const F = this.fx;
    const M = this.mats;
    const b = this.body;

    // Spines down the back.
    for (let i = 0; i < (F.spikes || 0); i++) {
      const t = i / Math.max(1, (F.spikes || 1) - 1);
      b.add(mesh(G.cone, M.skinDark, 0.07, 0.16 + (1 - t) * 0.10, 0.07,
        0, 0.80 + t * 0.28, -0.34 - t * 0.05, -0.5));
    }
    // Cheek fins.
    if (F.fins) {
      for (const sx of [-1, 1]) {
        this.head.add(mesh(G.cone, M.skinDark, 0.06, 0.26, 0.16,
          sx * 0.42, 0.02, -0.10, 0, 0, sx * 1.25));
      }
    }
    // Horns on the brow.
    for (let i = 0; i < (F.horns || 0); i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const tier = Math.floor(i / 2);
      this.head.add(mesh(G.cone, M.skinDark, 0.055, 0.20 + tier * 0.07, 0.055,
        sx * (0.26 + tier * 0.07), 0.30 + tier * 0.06, 0.02, -0.35, 0, sx * 0.6));
    }
    // A ring of points around the skull.
    if (F.crown && M.inlay) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        this.head.add(mesh(G.cone, M.inlay, 0.035, 0.14, 0.035,
          Math.cos(a) * 0.36, 0.26, Math.sin(a) * 0.34));
      }
    }
    // Glowing inlay across the back and brow.
    if (M.inlay) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI - Math.PI / 2;
        b.add(mesh(G.box, M.inlay, 0.035, 0.035, 0.42,
          Math.sin(a) * 0.40, 0.68 + Math.cos(a) * 0.16, -0.05, 0.3));
      }
      this.head.add(mesh(G.box, M.inlay, 0.30, 0.028, 0.028, 0, 0.16, 0.34));
    }
    // Haloes.
    if (M.halo) {
      this.halo = mesh(G.torus, M.halo, 0.30, 0.30, 0.30, 0, 1.92, 0, Math.PI / 2);
      this.halo.castShadow = false;
      b.add(this.halo);
      if (F.halo2) {
        this.halo2 = mesh(G.torus, M.halo, 0.42, 0.42, 0.42, 0, 2.02, 0, Math.PI / 2);
        this.halo2.castShadow = false;
        b.add(this.halo2);
      }
    }
    // A shell of light around the whole frog.
    if (M.bodyAura) {
      this.bodyAura = mesh(G.sphere, M.bodyAura, 1.05, 1.25, 1.05, 0, 0.85, 0);
      this.bodyAura.castShadow = false;
      b.add(this.bodyAura);
    }
    // Glowing eyes replace the ordinary pupils.
    if (M.eyeLit) {
      for (const e of this.eyes) {
        e.pupil.material = M.eyeLit;
        e.white.material = M.eyeLit;
      }
    }
    if (F.divine) this._buildDivine();
  }

  /**
   * FROGATH THE DIVINE — the god's rig, at frog scale.
   *
   * Both forms are built here and phase 2 starts hidden, because the
   * transformation has to land on one frame in the middle of a firefight; it
   * cannot be waiting on geometry. `setDivinePhase` only ever flips
   * visibility and a couple of scalars.
   *
   * Everything is parented to `this.body`, so it squashes, leans and bobs
   * with the frog and needs no animation of its own beyond the wingbeat.
   *
   * NOTE: nothing here touches the collider or any stat. The silhouette is
   * much bigger; the frog underneath is exactly the same size as default.
   */
  _buildDivine() {
    const M = this.mats;
    const b = this.body;
    const F = this.fx;

    const lit = (c, o) => new THREE.MeshBasicMaterial({
      color: c, transparent: o !== undefined, opacity: o === undefined ? 1 : o,
      depthWrite: o === undefined,
    });
    M.dvWing = lit(0xfff3c4, 0.66);
    M.dvCore = lit(0xffffff, 0.92);
    M.dvPlate = new THREE.MeshLambertMaterial({ color: 0xfffaf0, emissive: 0x8a7a3a });
    M.dvRune = lit(0xfff3c4);
    M.dvCorona = new THREE.MeshBasicMaterial({
      color: 0xffd76b, transparent: true, opacity: 0.10,
      side: THREE.BackSide, depthWrite: false,
    });

    const D = { wings1: [], wings2: [], rings: [], runes: [], blades: [] };

    // ---- divine armour: breastplate, pauldrons, a collar ring ----
    b.add(mesh(G.sphere, M.dvPlate, 0.40, 0.26, 0.34, 0, 0.74, 0.06));
    for (const sx of [-1, 1]) {
      b.add(mesh(G.lowSphere, M.dvPlate, 0.19, 0.13, 0.18, sx * 0.40, 0.86, 0));
      b.add(mesh(G.cone, M.dvPlate, 0.07, 0.16, 0.07, sx * 0.44, 1.00, 0, 0, 0, sx * 0.5));
    }
    b.add(mesh(G.torus, M.dvPlate, 0.30, 0.30, 0.30, 0, 0.52, 0, Math.PI / 2));

    // ---- PHASE 1 wings: one pair, the shape he descends with ----
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.30, 0.80, -0.16);
      b.add(w);
      const feathers = [];
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const len = 0.85 + Math.sin(t * Math.PI) * 0.62;
        const f = new THREE.Group();
        f.rotation.z = sx * (0.25 + t * 1.05);
        f.rotation.y = sx * (-0.15 - t * 0.30);
        w.add(f);
        f.add(mesh(G.box, M.dvWing, 0.075, len, 0.02, sx * len * 0.42, len * 0.30, 0,
          0, 0, sx * -0.55));
        f.add(mesh(G.box, M.dvCore, 0.026, len * 0.9, 0.026,
          sx * len * 0.42, len * 0.30, 0, 0, 0, sx * -0.55));
        feathers.push(f);
      }
      D.wings1.push({ group: w, feathers, side: sx });
    }

    // ---- PHASE 2 wings: four pairs, much larger and barbed ----
    const SPEC = [
      { count: 9, base: 1.55, span: 1.35, y: 0.90, z: -0.20, tilt: 0, w: 0.095 },
      { count: 6, base: 0.95, span: 0.75, y: 1.14, z: -0.30, tilt: 0.55, w: 0.062 },
      { count: 6, base: 0.88, span: 0.66, y: 0.52, z: -0.30, tilt: -0.60, w: 0.062 },
      { count: 4, base: 0.60, span: 0.44, y: 0.90, z: -0.42, tilt: 0, w: 0.048 },
    ];
    for (let s = 0; s < SPEC.length; s++) {
      const spec = SPEC[s];
      for (const sx of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(sx * 0.30, spec.y, spec.z);
        w.rotation.x = spec.tilt;
        w.visible = false;
        b.add(w);
        const feathers = [];
        for (let i = 0; i < spec.count; i++) {
          const t = i / (spec.count - 1);
          const len = spec.base + Math.sin(t * Math.PI) * spec.span;
          const f = new THREE.Group();
          f.rotation.z = sx * (0.18 + t * 1.20);
          f.rotation.y = sx * (-0.12 - t * 0.34);
          w.add(f);
          f.add(mesh(G.box, M.dvWing, spec.w, len, 0.018,
            sx * len * 0.44, len * 0.30, 0, 0, 0, sx * -0.55));
          f.add(mesh(G.box, M.dvCore, 0.022, len * 0.94, 0.022,
            sx * len * 0.44, len * 0.30, 0, 0, 0, sx * -0.55));
          f.add(mesh(G.cone, M.dvCore, 0.03, 0.26, 0.03,
            sx * len * 0.86, len * 0.62, 0, 0, 0, sx * -1.05));
          feathers.push(f);
        }
        D.wings2.push({ group: w, feathers, side: sx, tier: s });
      }
    }

    // ---- rings and runes: phase 2 only ----
    for (let i = 0; i < 3; i++) {
      const r = mesh(G.torus, M.dvRune, 0.62 - i * 0.11, 0.62 - i * 0.11,
        0.62 - i * 0.11, 0, 0.80, 0, Math.PI / 2 + i * 0.5, 0, i * 0.7);
      r.visible = false;
      r.castShadow = false;
      b.add(r);
      D.rings.push({ mesh: r, spin: 0.6 + i * 0.4, tilt: i * 0.5 });
    }
    for (let i = 0; i < 10; i++) {
      const r = mesh(G.box, M.dvRune, 0.055, 0.055, 0.014, 0, 0, 0);
      r.visible = false;
      r.castShadow = false;
      b.add(r);
      D.runes.push({ mesh: r, a: (i / 10) * Math.PI * 2,
        r: 0.66 + (i % 3) * 0.10, y: 0.35 + (i % 5) * 0.16 });
    }
    // Escort blades, so the phase-2 form is armed like he is.
    for (let i = 0; i < 4; i++) {
      const e = new THREE.Group();
      e.visible = false;
      e.add(mesh(G.box, M.dvWing, 0.03, 0.62, 0.075, 0, 0, 0));
      e.add(mesh(G.box, M.dvCore, 0.014, 0.58, 0.032, 0, 0, 0));
      e.add(mesh(G.cone, M.dvCore, 0.03, 0.12, 0.075, 0, 0.35, 0));
      b.add(e);
      D.blades.push({ mesh: e, a: (i / 4) * Math.PI * 2, r: 0.78,
        y: 0.7 + (i % 2) * 0.28 });
    }

    // The corona. Present in both forms, far brighter in phase 2.
    D.corona = mesh(G.sphere, M.dvCorona, 1.35, 1.55, 1.35, 0, 0.85, 0);
    D.corona.castShadow = false;
    b.add(D.corona);

    D.phase = 1;
    D.morph = 0;          // 0..1 progress of the ascension effect
    D.flap = 0;
    this.divine = D;
  }

  /**
   * Switch the divine skin between his two forms.
   *
   * @param n      1 or 2
   * @param morph  0..1, drives the transformation. 1 = fully settled.
   */
  setDivinePhase(n, morph) {
    const D = this.divine;
    if (!D) return;
    D.phase = n;
    D.morph = morph === undefined ? 1 : morph;
    const two = n >= 2;
    for (const w of D.wings1) w.group.visible = !two;
    for (const w of D.wings2) w.group.visible = two;
    for (const r of D.rings) r.mesh.visible = two;
    for (const r of D.runes) r.mesh.visible = two;
    for (const e of D.blades) e.mesh.visible = two;
    if (two) D.flap = 1;
  }

  /** Is this rig wearing the divine skin? */
  get isDivine() { return !!this.divine; }

  _animateDivine(dt, t) {
    const D = this.divine;
    if (!D) return;
    D.flap = damp(D.flap, 0, 3.5, dt);
    const beat = Math.sin(t * 2.2) * 0.12 + D.flap * 0.8;
    const two = D.phase >= 2;
    const m = D.morph;

    for (const w of (two ? [] : D.wings1)) {
      w.group.rotation.z = w.side * 0.12 - beat * w.side * 0.5;
      for (let i = 0; i < w.feathers.length; i++) {
        const k = i / (w.feathers.length - 1);
        w.feathers[i].rotation.x =
          Math.sin(t * 2.2 - k * 0.9) * 0.14 + beat * 0.5 * (1 - k * 0.4);
      }
    }
    for (const w of (two ? D.wings2 : [])) {
      // Tiers open in sequence during the morph, so the ascension unfolds
      // rather than popping.
      const open = clamp(m * 1.5 - w.tier * 0.16, 0, 1);
      w.group.rotation.z = w.side * (0.05 + (1 - open) * 1.5) - beat * w.side * 0.6;
      w.group.rotation.y = w.side * (1 - open) * 1.0;
      for (let i = 0; i < w.feathers.length; i++) {
        const k = i / (w.feathers.length - 1);
        const f = w.feathers[i];
        f.rotation.x = Math.sin(t * 2.6 - k * 1.1) * 0.16 + beat * 0.6 * (1 - k * 0.4);
        f.scale.setScalar(open);
      }
    }
    if (two) {
      for (let i = 0; i < D.rings.length; i++) {
        const r = D.rings[i];
        r.mesh.rotation.y += dt * r.spin;
        r.mesh.rotation.z = r.tilt + Math.sin(t * 0.7 + i) * 0.22;
        r.mesh.scale.setScalar(m);
      }
      for (let i = 0; i < D.runes.length; i++) {
        const r = D.runes[i];
        r.a -= dt * (0.7 + i * 0.03);
        r.mesh.position.set(Math.cos(r.a) * r.r * m,
          r.y + Math.sin(r.a * 2 + i) * 0.10, Math.sin(r.a) * r.r * m);
        r.mesh.rotation.y = -r.a;
        r.mesh.rotation.z += dt * 2.4;
      }
      for (let i = 0; i < D.blades.length; i++) {
        const e = D.blades[i];
        e.a += dt * 1.3;
        e.mesh.position.set(Math.cos(e.a) * e.r * m, e.y + Math.sin(e.a * 1.7) * 0.10,
          Math.sin(e.a) * e.r * m);
        e.mesh.rotation.set(Math.sin(e.a * 2) * 0.3, -e.a, 0.4 + Math.sin(e.a) * 0.4);
      }
    }

    // The corona: a steady glow in phase 1, an unmistakable one in phase 2.
    const pulse = 0.5 + Math.sin(t * 2.6) * 0.5;
    this.mats.dvCorona.opacity = two
      ? (0.16 + pulse * 0.10) * m
      : 0.09 + pulse * 0.04;
    D.corona.scale.setScalar((two ? 1.35 + 0.5 * m : 1.35)
      * (1 + pulse * 0.03));
    // Phase 2 burns hotter — the wing membrane goes from gold to white.
    this.mats.dvWing.color.copy(
      _dvA.setHex(0xfff3c4).lerp(_dvB.setHex(0xffffff), two ? m : 0));
    this.mats.dvWing.opacity = two ? 0.55 + m * 0.28 : 0.62;
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
    // Rides above the head, so it moves with the rig's ground lift.
    spr.position.set(0, 2.25 + this._lift, 0);
    this.nameplate = spr;
    this.root.add(spr);
    this._plateHealth = -1;
    this._xray = false;
    this.drawNameplate(1);
  }

  /**
   * Draw the nameplate THROUGH whatever is in front of it.
   *
   * Used when a player is hidden by something you are meant to be able to
   * see past — foliage, water — so a tree is cover, not an invisibility
   * cloak. Deliberately NOT enabled for solid geometry: seeing names through
   * walls is a different game.
   */
  setNameplateXRay(on) {
    if (!this.nameplate || on === this._xray) return;
    this._xray = on;
    this.nameplate.material.depthTest = !on;
    this.nameplate.renderOrder = on ? 12 : 0;
    this.nameplate.material.needsUpdate = true;
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
    // The idle breath rides ABOVE the origin rather than swinging either side
    // of it. The origin is the soles of the feet and sits exactly on the
    // ground, so a bob that goes negative buries the feet in the floor for
    // half of every cycle — which is precisely what it used to do.
    const idleBob = (0.5 + Math.sin(t * 1.9) * 0.5) * 0.05;
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

    // Skin extras that live rather than sit there: haloes turn, the aura
    // breathes. Cheap, and it is what makes a legendary read as special
    // rather than as a differently-coloured frog.
    if (this.halo) this.halo.rotation.z += dt * 0.9;
    if (this.halo2) this.halo2.rotation.z -= dt * 0.6;
    if (this.bodyAura) {
      this.bodyAura.material.opacity = 0.11 + Math.sin(t * 2.4) * 0.04;
    }
    if (this.divine) this._animateDivine(dt, t);

    // Throat pulse — a frog is never quite still.
    this.croakPulse = damp(this.croakPulse, 0, 6, dt);
    const throat = 1 + Math.sin(t * 3.1) * 0.03 + this.croakPulse * 0.25;
    const bb = this.bellyBase;
    this.bellyM.scale.set(bb[0] * throat, bb[1] * throat, bb[2] * throat);

    // Jaw opens while the tongue is out.
    const jawOpen = s.grappling ? 0.55 : 0;
    this.jaw.rotation.x = damp(this.jaw.rotation.x, jawOpen, 22, dt);

    // ---- blink -----------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blink = 1; this.blinkTimer = 2.2 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 7);
    // The lid closes to the size of the eye it covers, 0.235. Driving
    // scale.y to 1.0 against x/z of 0.24 stretched each lid into a green
    // ellipsoid four times the size of the head for the few frames a blink
    // lasts — a glitch that has been in every build so far.
    const lidY = 0.02 + Math.sin(this.blink * Math.PI) * 0.22;
    for (const e of this.eyes) e.lid.scale.y = lidY;

    // ---- cloth: scarf + headband tails trail behind motion ---------------
    const drag = clamp(speed / 20, 0, 1);
    const flutter = Math.sin(t * 11 + this.stride) * 0.16;
    // The scarf hangs down the back when still and streams out as the frog
    // gets moving. Resting at +0.5 rad stood it bolt upright behind the head
    // — a red slab over the hood that read as part of the hat.
    for (let i = 0; i < this.scarf.length; i++) {
      const seg = this.scarf[i];
      const target = -0.16 + drag * 1.35 + flutter * (i + 1) * 0.55 + (s.grounded ? 0 : 0.25);
      seg.rotation.x = damp(seg.rotation.x, target, 12 - i * 2, dt);
      seg.rotation.y = damp(seg.rotation.y, Math.sin(t * 4.2 + i) * 0.22 * (0.3 + drag), 9, dt);
    }
    // The tails hang at rest and lift as the frog picks up speed. Starting
    // from a positive angle held them up off the back of the head even when
    // standing still, which is what made them read as antennae.
    for (let i = 0; i < this.bandTails.length; i++) {
      const tl = this.bandTails[i];
      tl.rotation.x = damp(tl.rotation.x, -0.30 + drag * 1.15 + flutter * 0.5, 11, dt);
      tl.rotation.y = damp(tl.rotation.y, Math.sin(t * 5 + i * 2) * 0.3, 9, dt);
    }

    // Spin and bob the tagger marker so it catches the eye.
    if (this.tagMarker && this.tagMarker.visible) {
      this.tagMarker.rotation.y += dt * 2.4;
      this.tagMarker.position.y = 2.62 + Math.sin(t * 3.2) * 0.12;
    }

    // ---- keep the frog out of the floor ----------------------------------
    // Last line of defence. The body's origin is the soles of the feet and
    // sits exactly on the ground, so ANY animation that pushes the body
    // below zero buries the legs in the terrain. Rather than trusting every
    // pose to remember that, it is enforced once, here, after all of them.
    //
    // Only while upright and on the ground: the death keel-over and the swim
    // pose both move the body deliberately, and neither is standing on
    // anything.
    if (s.grounded && !s.dead && !s.swimming && this.body.position.y < 0) {
      this.body.position.y = 0;
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
      // The finisher's weight comes from COMPRESSING the body, not from
      // translating it down. The origin is the soles of the feet, so scaling
      // Y drops the shoulders by the same amount while the feet stay planted
      // — translating instead drove the whole frog 0.12 into the floor.
      this.body.scale.y *= 1 - sw * 0.13;
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

    // Mouth, root-local. `_lift` is added because the rig it belongs to was
    // raised to put the soles on the ground — without it the tongue would
    // still fire from where the mouth used to be.
    const from = new THREE.Vector3(0, 1.42 + this._lift, 0.30);
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
      g.position.set(0, 2.62 + this._lift, 0);
      this.tagMarker = g;
      this.root.add(g);
      // Built after the fact, so any fade already in effect has not been
      // applied to it — force setGhost to run over the rig again.
      this._ghost = undefined;
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

  /**
   * Fade the ENTIRE frog — used while invisibility is up, and by the shadow
   * clone when its owner is invisible.
   *
   * Walks the whole rig rather than just `this.mats`, because parts of the
   * model carry their own materials: the nameplate sprite and the "it"
   * marker. Fading only the body left those floating at full strength, which
   * defeats the point — a name tag hanging over thin air is worse than no
   * invisibility at all.
   *
   * Each material's original look is stashed the first time it is touched,
   * so restoring puts back exactly what was there (the nameplate, for one,
   * is transparent by nature and must stay that way at full opacity).
   * Materials are per-instance, so this only ever affects this one model.
   */
  setGhost(k) {
    if (this._ghost === k) return;
    this._ghost = k;
    const on = k < 0.999;
    this.root.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : null);
      if (!mats) return;
      for (const m of mats) {
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

  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.root.visible = v;
  }

  dispose() {
    const shared = Object.values(G);
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.geometry && !shared.includes(o.geometry)) o.geometry.dispose();
      // Sweep every material, not just this.mats — the nameplate sprite and
      // the tagger marker own theirs, and shadow clones are built and torn
      // down often enough that leaking them would add up.
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : null);
      if (!mats) return;
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.dispose();
      }
    });
    for (const k in this.mats) this.mats[k].dispose();
    if (this.plateTex) this.plateTex.dispose();
  }
}

const smooth = (t) => t * t * (3 - 2 * t);
