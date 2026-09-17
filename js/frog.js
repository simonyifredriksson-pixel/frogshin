/**
 * The ninja frog character.
 *
 * Everything is built procedurally out of primitives â€” no external model
 * files â€” and animated by a small hand-written procedural rig. The rig is
 * driven purely from gameplay state (speed, grounded, dash timer, attack
 * timer, ...) which means the exact same code animates the local player and
 * every networked remote player.
 */

import * as THREE from '../lib/three.module.js?v=v152';
import { CFG } from './config.js?v=v152';
import { clamp, lerp, damp, dampAngle } from './util.js?v=v152';

const CLOTH = 0x24242e;        // ninja gi
const CLOTH_DARK = 0x16161d;
const SCARF = 0xc0392b;
const BELLY = 0xdfe6a8;
const EYE_WHITE = 0xfefbe8;

/**
 * Sides on the cylinders worn as clothing.
 *
 * A cylinder is a prism: its flat faces lie at cos(PI/sides) of its nominal
 * radius, so a coarse one is much narrower between its corners than it looks.
 * The gi was an 8-sided cylinder â€” faces at 0.92 of its radius â€” and that is
 * what let the body push out through the shirt. Rounder means the cloth only
 * has to be a little bigger than the frog rather than a lot.
 */
const WRAP_SIDES = 24;

/**
 * Radius of a shut eyelid.
 *
 * The lid sits in the middle of the eyeball and swells to cover it, so this
 * is the radius that just swallows the white, the pupil and the highlight â€”
 * the highlight's far edge is the furthest, at 0.209.
 */
const LID_SHUT = 0.216;

/** Held for the one-of-one's draw flash, so it allocates nothing per frame. */
const WHITE = new THREE.Color(0xffffff);

/**
 * The ninja idle stance: a low guard held whenever the frog is standing
 * still with nothing else to do.
 *
 * `stagger` puts one foot in front of the other and `shinSplit` bends the
 * back knee harder, so the rear heel lifts the way a real fighting stance
 * does. Everything else about the pose is a continuous function of time
 * rather than keyframes, which is why it loops with nothing to snap.
 */
const STANCE = {
  hip: -1.00, stagger: 0.20,
  /**
   * The two knees are given separately rather than as a symmetric split.
   *
   * The hip carries a sideways splay as well as its pitch, and the splay sits
   * BETWEEN the X-rotations in the chain, so the pitches do not simply add:
   * the same splay lands differently on a leg swung forward than on one swung
   * back. A shared angle put the rear sole 0.075 above the lead's. These are
   * the values that measure level.
   */
  leadShin: 1.70,
  rearShin: 1.64,
  /**
   * How far the body drops into the crouch.
   *
   * MEASURED off the rig, not derived. Bending the knees shortens a leg's
   * reach to the ground and the body has to come down by exactly that much or
   * the frog floats â€” but the reach depends on the ankle angle and the LENGTH
   * OF THE FOOT as much as on the knee, and a hip-and-knee formula gets it
   * wrong by more than the whole crouch. Retune the angles above and this has
   * to be re-measured with them; the test asserts the soles land where the
   * resting pose's do, so it will say so.
   */
  drop: 0.130,
};
const STANCE_DROP = STANCE.drop;
/** How much bigger a wrap must be than the thing it covers, corners and all. */
const WRAP_FIT = 1.01 / Math.cos(Math.PI / WRAP_SIDES);

/**
 * The torso ellipsoid, shared out of _buildTorso: the clothes are sized off
 * it rather than by eye, and the lower panel below is a band of it.
 */
const TOR = [0.52, 0.46, 0.46];
const TOR_Y = 0.62;

/**
 * The gi band â€” how tall it is at rest, and where it is centred.
 *
 * The two move together so the TOP stays exactly where it was, at 0.77: the
 * shirt was only ever short at the BOTTOM, where it stopped a hair under the
 * obi and left the whole lower back bare. Raising the height and dropping the
 * centre by half of it lengthens the hem and touches nothing else â€” the croak
 * that swells the gi still tops out at the same 0.8975 it always did.
 */
const GI_H = 0.40, GI_Y = 0.57;

/**
 * The gi's lower panel: the shirt carried on down the flanks and the back.
 *
 * The gi proper is a cylinder, so it can only end in a flat rim, and simply
 * lengthening it further would barrel the frog out at the hips â€” the torso
 * has drawn in from 0.52 to 0.34 by the time it reaches the legs, while a
 * cylinder stays 0.53 the whole way down. This panel is instead a band of the
 * torso's OWN ellipsoid, a fiftieth proud of it, so it adds cloth without
 * adding bulk: the silhouette stays the frog's and only the colour changes.
 *
 * It ends at 0.27 because that is where the haunches take over and there is
 * nothing left to cover but leg. At the FRONT the belly stands further out
 * than the torso at every height in the band, so the panel is hidden there
 * and the pale belly still reads â€” the cloth appears at the flanks and runs
 * unbroken around the back, which is the line it ends on.
 *
 * It hangs off the body rather than the girth group: it wraps the hips, which
 * do not breathe. When a croak swells the gi it engulfs this panel entirely
 * (radius 0.66 against 0.48, hem down to 0.24), so the seam cannot part.
 */
const SKIRT_FIT = 1.02;
const SKIRT_TOP = 0.42, SKIRT_BOT = 0.27;
const skirtTheta = (y) =>
  Math.acos(clamp((y - TOR_Y) / (TOR[1] * SKIRT_FIT), -1, 1));

/** Shared geometries â€” every frog reuses these, so memory stays flat. */
const G = {
  /** Cylinder for clothing that has to enclose a limb or the torso. */
  wrap: new THREE.CylinderGeometry(1, 1, 1, WRAP_SIDES),
  /**
   * The mouth: a crease that lies ON the face mask's own surface.
   *
   * A flat box cannot do this job. The mask is a curved dome, so a bar wide
   * enough to be a frog's mouth is 0.08 further forward at its centre than at
   * its ends â€” push it out until the middle shows and the corners hang off
   * the face; leave it flush and the whole thing is swallowed, which is what
   * had happened. A band of the mask's own sphere follows the curve exactly.
   */
  mouth: new THREE.SphereGeometry(1, 22, 2, Math.PI / 2 - 0.62, 1.24, 1.45, 0.15),
  /** The gi's lower panel: a band of the torso's own sphere. See SKIRT_TOP. */
  skirt: new THREE.SphereGeometry(1, 30, 4, 0, Math.PI * 2,
    skirtTheta(SKIRT_TOP), skirtTheta(SKIRT_BOT) - skirtTheta(SKIRT_TOP)),
  sphere: new THREE.SphereGeometry(1, 12, 9),
  lowSphere: new THREE.SphereGeometry(1, 8, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  capsule: new THREE.CapsuleGeometry(1, 1, 3, 8),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 7),
  torus: new THREE.TorusGeometry(1, 0.12, 6, 18),
  /**
   * A PARTIAL ring â€” a crescent, not a circle.
   *
   * The eclipse emblem is a dark disc with a thin arc of light around most
   * of it, and the gap is the whole read: a complete ring is a badge, an
   * interrupted one is a body passing in front of a star. Thinner in the
   * tube than `torus` (0.075 against 0.12) because at emblem scale a 0.12
   * tube is a doughnut.
   *
   * Lies in the XY plane like every TorusGeometry, so it faces +Z with no
   * rotation â€” which is exactly where the chest is.
   */
  arc: new THREE.TorusGeometry(1, 0.075, 5, 22, Math.PI * 1.42),
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
 * katana in the game â€” the juggernaut's is the same weapon scaled up, which
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
    case 'dagger':
      /**
       * A KNIFE. Short, straight, and pointed rather than tipped.
       *
       * `fang` was doing this job and it does not: its point is a cone 0.40
       * long, so on a blade shortened to two-thirds it is over a third of
       * the whole weapon and the thing reads as an ARROWHEAD on a handle.
       * A knife is mostly blade with a little point on the end of it.
       */
      blade.scale.set(0.05, 1.30 * L, 0.10);
      k.add(mesh(G.box, m.edge, 0.052, 1.24 * L, 0.03, 0, 0.78 * L, 0.032));
      k.add(mesh(G.cone, m.edge, 0.05, 0.14, 0.06, 0, tipY - 0.04, 0));
      break;
    case 'light':
      // Not steel at all â€” a bar of light, like the god's.
      blade.scale.set(0.10, 1.42 * L, 0.30);
      k.add(mesh(G.box, m.edge, 0.14, 1.36 * L, 0.16, 0, 0.80 * L, 0));
      k.add(mesh(G.cone, m.edge, 0.12, 0.34, 0.30, 0, tipY + 0.06, 0));
      break;
    /**
     * ═══ CAPSTONE — the one-of-one's blade ══════════════════════════════
     *
     * The narrowest, straightest blade in the game, and the only one with
     * no effect on it whatsoever: no glow, no runes, no aura, no orbit.
     *
     * That absence IS the design. Every other top-tier sword here announces
     * itself by emitting something, which means they are all the same sword
     * at different wavelengths — turn the lights off and a Mythic and a ???
     * are two grey katanas. This one is recognisable by its OUTLINE: it is
     * visibly narrower than everything else, perfectly straight where the
     * good blades curve, and it ends in a flat angled kissaki instead of a
     * cone. The test the brief set was "does it still look amazing with all
     * the effects off", and the only way to pass that is to not have any.
     *
     * The three-material stack across the blade — dark spine, steel body,
     * ivory hamon along the cutting edge — is what stops a narrow blade
     * reading as a stick. It is also the only place on the whole item where
     * three colours meet.
     */
    case 'keystone': {
      blade.scale.set(0.044, 1.42 * L, 0.105);
      blade.position.y = 0.80 * L;
      // The hamon: a bright temper line down the cutting edge.
      k.add(mesh(G.box, m.edge, 0.048, 1.36 * L, 0.030, 0, 0.80 * L, 0.041));
      // The spine behind it, in the grip's dark colour.
      k.add(mesh(G.box, m.grip, 0.046, 1.36 * L, 0.024, 0, 0.80 * L, -0.044));
      // A flat, angled kissaki rather than a cone â€” the tip is a facet.
      k.add(mesh(G.box, m.steel, 0.044, 0.22, 0.092, 0, tipY - 0.07, 0.006, 0, 0, 0.17));
      k.add(mesh(G.box, m.edge, 0.047, 0.10, 0.034, 0, tipY - 0.02, 0.034, 0, 0, 0.17));
      break;
    }
    /**
     * â•â•â• THE THREE THAT ARE NOT SWORDS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     *
     * A spear, an axe and a maul, added for the WEAPONS table in
     * js/weapons.js â€” the gear list has four polearms, two mauls and two
     * axes in it and every one of them was being drawn as a katana.
     *
     * All three are built the same way and it is the one thing that makes
     * them read: a long plain SHAFT in the grip colour, and the mass at the
     * far end of it. A sword's weight is in the hand; a polearm's is at the
     * top of a pole, and the silhouette is the only thing that says so.
     */
    case 'spear': {
      // A shaft the whole length, with a leaf-shaped head on the end.
      blade.visible = false;
      k.add(mesh(G.cyl, m.grip, 0.036, 1.62 * L, 0.036, 0, 0.72 * L, 0));
      k.add(mesh(G.box, m.steel, 0.05, 0.40 * L, 0.15, 0, 1.42 * L, 0));
      k.add(mesh(G.cone, m.edge, 0.075, 0.34, 0.10, 0, 1.74 * L, 0));
      // A collar where the head is socketed on, and a butt-spike.
      k.add(mesh(G.cyl, m.gold, 0.055, 0.08, 0.055, 0, 1.22 * L, 0));
      k.add(mesh(G.cone, m.gold, 0.04, 0.14, 0.04, 0, -0.30, 0, Math.PI));
      break;
    }
    case 'axe': {
      /**
       * A short haft with a broad bit hung off one side of it.
       *
       * THE HEAD IS BIG. It has to be: at a third of this size it read as a
       * small block on a stick, and the one thing that makes an axe an axe
       * from ten units away is that all of its mass is out at the end and
       * off to one side. A weapon silhouette is a mass distribution.
       */
      blade.visible = false;
      k.add(mesh(G.cyl, m.grip, 0.05, 1.10 * L, 0.05, 0, 0.44 * L, 0));
      /**
       * The bit: thick and narrow where it is socketed onto the haft, thinning
       * and FLARING out to a tall edge.
       *
       * It must flare the whole way. It used to be waisted â€” a 0.52 shoulder,
       * a 0.30 middle and a 0.58 edge â€” and a cutting edge standing that far
       * proud of the piece behind it reads as a tab with a notch bitten out
       * behind it, which is a hatchet that has hit something it should not
       * have. Each step is thinner in x, deeper in z and taller in y than the
       * one before it, so the outline is one clean wedge.
       */
      k.add(mesh(G.box, m.steel, 0.09, 0.44 * L, 0.30, 0, 0.86 * L, 0.20));
      k.add(mesh(G.box, m.steel, 0.07, 0.54 * L, 0.22, 0, 0.86 * L, 0.44));
      k.add(mesh(G.box, m.edge, 0.035, 0.62 * L, 0.08, 0, 0.86 * L, 0.57));
      // A langet down the haft, and a spike on top, so it reads as a weapon
      // and not as a woodsman's tool.
      k.add(mesh(G.box, m.gold, 0.055, 0.26, 0.055, 0, 0.60 * L, 0.06));
      k.add(mesh(G.cone, m.edge, 0.05, 0.24, 0.05, 0, 1.14 * L, 0));
      break;
    }
    case 'hammer': {
      /**
       * A haft and a block, with no edge anywhere on it â€” and the block is
       * deliberately enormous. See the note on the axe: the whole reading of
       * a maul is that the far end of it is much heavier than the near end.
       */
      blade.visible = false;
      k.add(mesh(G.cyl, m.grip, 0.055, 1.02 * L, 0.055, 0, 0.40 * L, 0));
      k.add(mesh(G.box, m.steel, 0.26, 0.46 * L, 0.52, 0, 0.86 * L, 0));
      // Faces on both ends of the head, banded in the guard colour, and
      // studs on them.
      for (const z of [-0.29, 0.29]) {
        k.add(mesh(G.box, m.gold, 0.28, 0.46 * L, 0.07, 0, 0.86 * L, z));
        for (const y of [-0.11, 0.11]) {
          k.add(mesh(G.box, m.gold, 0.07, 0.07, 0.07, 0, 0.86 * L + y, z * 1.14));
        }
      }
      // A collar where the head is wedged onto the haft.
      k.add(mesh(G.cyl, m.gold, 0.075, 0.09, 0.075, 0, 0.60 * L, 0));
      break;
    }
    default:                                   // katana
      k.add(mesh(G.box, m.edge, 0.048, 1.32 * L, 0.035, 0, 0.78 * L, 0.036));
      k.add(mesh(G.cone, m.edge, 0.06, 0.22, 0.075, 0, tipY, 0));
      break;
  }
  k.add(blade);

  // A second blade out of the pommel â€” the Ascended's double-ended weapon.
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
  /**
   * FRAGMENTS ORBITING THE BLADE.
   *
   * On exactly one sword in the game â€” the Astral Sovereign, the only Mythic
   * â€” so that seeing it means something. Handed out on the group as
   * `userData.shards` and driven by `FrogModel.update`, because the pivot is
   * re-posed every frame by the swing code and anything animating itself
   * inside it would fight that.
   */
  if (F.orbit && m.bladeShard) {
    const shards = [];
    const n = F.orbitN || 6;
    for (let i = 0; i < n; i++) {
      const s = mesh(G.box, m.bladeShard, 0.05, 0.05, 0.05, 0, 0, 0);
      s.castShadow = false;
      k.add(s);
      shards.push({
        mesh: s,
        a: (i / n) * Math.PI * 2,
        r: 0.22 + (i % 2) * 0.10,
        y: (0.20 + (i / n) * 1.25) * L,
        spin: 1.15 + (i % 3) * 0.38,
      });
    }
    k.userData.shards = shards;
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
    /**
     * ═══ THE GUARD IS THE EMBLEM ════════════════════════════════════════
     *
     * CAPSTONE's tsuba is the keystone arch itself, lying flat around the
     * blade: a springing bar behind, five wedges rising over the front, and
     * the crown wedge lit.
     *
     * This is the whole of "the emblem appears on one other part of the
     * skin". It is on the chest, and it is here, and it is on the back of
     * the mantle at a third the size â€” and that is all. The instruction was
     * not to repeat it everywhere, and a guard is the one place on a sword
     * where a symbol is structural rather than decorative.
     */
    case 'keystone': {
      const arch = m.bladeEmblem || m.gold;
      k.add(mesh(G.box, m.gold, 0.34, 0.030, 0.075, 0, 0.07, -0.05));
      for (let i = 0; i < 5; i++) {
        const a = Math.PI - (i / 4) * Math.PI;
        const crown = i === 2;
        k.add(mesh(G.box, crown ? arch : m.gold,
          crown ? 0.075 : 0.058, 0.032, crown ? 0.090 : 0.072,
          Math.cos(a) * 0.145, 0.07, -0.05 + Math.sin(a) * 0.145,
          0, -a + Math.PI / 2, 0));
      }
      break;
    }
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

    // `fx` is what makes a skin more than a recolour â€” glowing hide, inlay,
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
      scarf: new THREE.MeshLambertMaterial({ color: useCustomFrog ? fs.scarf : SCARF }),
      eye: new THREE.MeshBasicMaterial({ color: EYE_WHITE }),
      pupil: new THREE.MeshBasicMaterial({ color: 0x101014 }),
      shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      // A glowing blade is emissive-lit rather than shaded â€” it is the light
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
    // Named apart from the frog's `shard`: a frog and its sword can both be
    // orbiting things, in two different colours.
    if (sfx.orbit) {
      this.mats.bladeShard = new THREE.MeshBasicMaterial({ color: sfx.orbit });
    }
    if (sfx.tassel) this.mats.tassel = new THREE.MeshLambertMaterial({ color: sfx.tassel });
    /**
     * CAPSTONE's guard, which is the keystone arch in metal.
     *
     * Named apart from the frog's `emblemLit` because a frog and its sword
     * carry the emblem in two different colours in principle, and because
     * `buildKatana` is also called by js/weapons.js with a gear look that
     * has no frog attached to it at all.
     */
    if (sfx.emblemGlow) {
      this.mats.bladeEmblem = new THREE.MeshBasicMaterial({ color: sfx.emblemGlow });
    }
    if (sfx.trim) this.mats.bladeTrim = new THREE.MeshLambertMaterial({ color: sfx.trim });
    if (sfx.aura) {
      this.mats.aura = new THREE.MeshBasicMaterial({
        color: sfx.aura, transparent: true, opacity: 0.22, depthWrite: false,
      });
    }
    if (ffx.pattern) this.mats.inlay = new THREE.MeshBasicMaterial({ color: ffx.pattern });
    if (ffx.eyeGlow) this.mats.eyeLit = new THREE.MeshBasicMaterial({ color: ffx.eyeGlow });
    /**
     * A LUMINOUS IRIS — the pupil, and nothing else.
     *
     * `eyeGlow` lights the whole eyeball, sclera included. On a frog whose
     * eyes are radius-0.23 mounds that is two headlights, which is right for
     * the Forgotten One and wrong for anything that is meant to look calm.
     * Keystone's brief asked for a glow you notice when you look closely and
     * not before, so `iris` lights the PUPIL alone and leaves the white to
     * be lit by the world like the rest of the frog.
     */
    if (ffx.iris) this.mats.irisLit = new THREE.MeshBasicMaterial({ color: ffx.iris });
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
    /**
     * â”€â”€ the Swampforged and Celestial sets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Armour, moss, a hood, a shield, specks and orbiting fragments. The two
     * new crate sets describe almost every skin in them as wearing ARMOUR,
     * and there was no way to say that â€” a crate that sells you "heavy
     * ancient armour covered in moss" and hands you a differently tinted
     * naked frog is the exact failure the `fx` system exists to prevent.
     *
     * Plate is lit rather than shaded only when it glows; ordinary metal and
     * wet moss both want the light.
     */
    if (ffx.plates) {
      this.mats.plate = new THREE.MeshLambertMaterial({
        color: ffx.plates,
        emissive: new THREE.Color(ffx.plates).multiplyScalar(0.16),
      });
      this.mats.plateDark = new THREE.MeshLambertMaterial({
        color: new THREE.Color(ffx.plates).multiplyScalar(0.66),
      });
    }
    /**
     * ═══ KEYSTONE — the one-of-one's own materials ══════════════════════
     *
     * Five, and only one of them is lit.
     *
     * `emblemLit` is a `MeshBasicMaterial` and everything else here is
     * Lambert, which is the entire effects budget of this skin: a single
     * 0.06-unit wedge at the centre of the chest emblem is the only thing
     * on the whole frog that emits rather than reflects. That is the point
     * — see the note on the skin in js/skins.js. Adding a second lit
     * material here is how this skin stops being clean.
     *
     * The metal is deliberately given a small emissive term rather than
     * being lit: antique gold in a night ward has to stay readable without
     * becoming a lamp, and 0.10 of its own colour is the difference between
     * "old metal" and "flat brown".
     */
    if (ffx.diadem) {
      this.mats.diadem = new THREE.MeshLambertMaterial({
        color: ffx.diadem,
        emissive: new THREE.Color(ffx.diadem).multiplyScalar(0.10),
      });
      this.mats.diademDark = new THREE.MeshLambertMaterial({
        color: new THREE.Color(ffx.diadem).multiplyScalar(0.55),
      });
    }
    if (ffx.mantle) {
      this.mats.mantle = new THREE.MeshLambertMaterial({ color: ffx.mantle });
      this.mats.mantleDark = new THREE.MeshLambertMaterial({
        color: new THREE.Color(ffx.mantle).multiplyScalar(0.62),
      });
    }
    if (ffx.trim) this.mats.trim = new THREE.MeshLambertMaterial({ color: ffx.trim });
    if (ffx.emblem) {
      this.mats.emblem = new THREE.MeshLambertMaterial({
        color: ffx.emblem,
        emissive: new THREE.Color(ffx.emblem).multiplyScalar(0.12),
      });
    }
    if (ffx.emblemGlow) {
      this.mats.emblemLit = new THREE.MeshBasicMaterial({ color: ffx.emblemGlow });
      // The motes that appear only while standing still. Faint, and few.
      this.mats.mote = new THREE.MeshBasicMaterial({
        color: ffx.emblemGlow, transparent: true, opacity: 0.55, depthWrite: false,
      });
    }
    if (ffx.moss) this.mats.moss = new THREE.MeshLambertMaterial({ color: ffx.moss });
    if (ffx.hood) {
      this.mats.hood = new THREE.MeshLambertMaterial({ color: ffx.hood });
    }
    if (ffx.shield) {
      this.mats.shield = new THREE.MeshLambertMaterial({ color: ffx.shield });
      this.mats.shieldRim = new THREE.MeshLambertMaterial({
        color: new THREE.Color(ffx.shield).multiplyScalar(0.6),
      });
    }
    if (ffx.stars) this.mats.star = new THREE.MeshBasicMaterial({ color: ffx.stars });
    /**
     * `embers` was DEAD. Frogath's hide and the Ascended's have declared it
     * since they were written and no builder has ever read it, so two of the
     * three rarest skins in the game were quietly missing an effect their
     * own data asks for. Sparks, rising and fading out â€” implemented here
     * because the orbit machinery below is most of what it needed.
     */
    if (ffx.embers) {
      this.mats.ember = new THREE.MeshBasicMaterial({
        color: ffx.embers, transparent: true, opacity: 0.85, depthWrite: false,
      });
    }
    if (ffx.orbit) {
      this.mats.shard = new THREE.MeshBasicMaterial({ color: ffx.orbit });
      this.mats.shardFaint = new THREE.MeshBasicMaterial({
        color: ffx.orbit, transparent: true, opacity: 0.35, depthWrite: false,
      });
    }
    /**
     * â”€â”€ WINGS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Nothing else on this rig comes off the BACK, which is the whole
     * reason they exist: the fx vocabulary had grown able to say
     * "crowned, haloed, horned, spiked, glowing" in a dozen combinations,
     * and every one of them still reads as the same frog with different
     * jewellery from across the arena. A wing changes the outline.
     *
     * Two materials: a shaded membrane so the feathers catch the light
     * and read as solid, and an unlit edge so they still register against
     * a dark sky. `wingGlow` defaults to the membrane colour, so a skin
     * that only wants plain wings says one thing rather than two.
     */
    if (ffx.wings) {
      this.mats.wing = new THREE.MeshLambertMaterial({
        color: ffx.wings,
        emissive: new THREE.Color(ffx.wings).multiplyScalar(0.22),
      });
      this.mats.wingEdge = new THREE.MeshBasicMaterial({
        color: ffx.wingGlow || ffx.wings,
        transparent: true, opacity: 0.75, depthWrite: false,
      });
    }
    /**
     * â•â• THE ECLIPSE SET'S MATERIALS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     *
     * One skin uses these â€” see `frog_ecl_secret` in js/skins.js â€” and it
     * is the only one in the game with a builder to itself.
     *
     * â”€â”€ every animated value here is a COLOUR, never an opacity â”€â”€â”€â”€â”€â”€â”€â”€
     * `setGhost` walks the whole graph stashing each material's opacity so
     * it can restore it afterwards, so anything that writes `opacity` every
     * frame fights the invisibility ability and loses in both directions:
     * the stash captures a mid-fade value, and the restore is overwritten a
     * frame later. Colour is untouched by ghosting, and the two effects
     * that genuinely need to fade â€” the fragments and the motes â€” do it by
     * SCALE, the same way the embers above do and for the same reason.
     */
    if (ffx.eclipse) {
      const plate = new THREE.Color(ffx.obsidian || 0x24223a);
      const silver = new THREE.Color(ffx.silver || 0xbcc0cf);
      const energy = new THREE.Color(ffx.energy || 0x9b86f0);
      // Kept for the animation, which lerps AROUND these rather than
      // rebuilding a colour from a hex every frame.
      this._eclEnergy = energy.clone();
      this._eclSilver = silver.clone();

      // Armour. Lit, with a touch of self-light so it separates from the
      // body underneath it even on the side facing away from the sun.
      this.mats.eclPlate = new THREE.MeshLambertMaterial({
        color: plate, emissive: plate.clone().multiplyScalar(0.18),
      });
      // The bevel along the top edge of each plate. A shade LIGHTER, which
      // is what gives a piece of armour a readable edge instead of a
      // silhouette that dissolves into the body.
      this.mats.eclLip = new THREE.MeshLambertMaterial({
        color: plate.clone().multiplyScalar(1.75),
      });
      this.mats.eclSilver = new THREE.MeshLambertMaterial({
        color: silver, emissive: silver.clone().multiplyScalar(0.12),
      });
      // The one true black on the whole skin: the disc at the centre of the
      // emblem, and the charm hanging off the belt.
      this.mats.eclVoid = new THREE.MeshBasicMaterial({ color: 0x07060c });
      /**
       * Sclera and iris. Basic, so the eyes stay the brightest thing on the
       * frog whatever the light is doing â€” they are the focal point.
       *
       * SILVER, not white. At 0xe8e6ff over this much of the head they read
       * as two cartoon eyes; pulled back to a moonlit silver they read as
       * something looking at you, which is the whole intent. The bright
       * white is kept for the one highlight dot in each, where a specular
       * glint belongs.
       */
      this.mats.eclEye = new THREE.MeshBasicMaterial({ color: 0xd2d4e8 });
      this.mats.eclIris = new THREE.MeshBasicMaterial({ color: energy.clone() });
      // The emblem's crescent and the hairline cracks. Three materials, not
      // one, so they can pulse out of phase â€” a single material makes every
      // crack on the model flash in unison, which reads as a light switch.
      this.mats.eclEmblem = new THREE.MeshBasicMaterial({ color: energy.clone() });
      this.mats.eclCrackA = new THREE.MeshBasicMaterial({ color: energy.clone() });
      this.mats.eclCrackB = new THREE.MeshBasicMaterial({ color: energy.clone() });
      // Fragments: a dim violet chip. Faded by scale, so a fixed opacity.
      this.mats.eclFrag = new THREE.MeshBasicMaterial({
        color: energy.clone().multiplyScalar(0.72),
        transparent: true, opacity: 0.62, depthWrite: false,
      });
      this.mats.eclMote = new THREE.MeshBasicMaterial({
        color: energy.clone().multiplyScalar(0.85),
        transparent: true, opacity: 0.5, depthWrite: false,
      });
      // The distortion at the feet. Dark, not smoky â€” it reads as the
      // ground being wrong rather than as something burning.
      this.mats.eclShade = new THREE.MeshBasicMaterial({
        color: 0x120c22, transparent: true, opacity: 0.42, depthWrite: false,
      });
      this.mats.eclShadeOut = new THREE.MeshBasicMaterial({
        color: 0x1a1230, transparent: true, opacity: 0.18, depthWrite: false,
      });
    }

    this.root = new THREE.Group();          // sits at the player's ground point
    /**
     * Raises the whole animated rig so the SOLES rest on the ground.
     *
     * The rig is modelled with its feet hanging below its own origin â€” hip
     * +0.36, shin -0.30, foot -0.29, sole -0.08 â€” which puts the bottom of
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
    /**
     * Start standing, not with the legs straight down.
     *
     * The rig is BUILT straight because _groundRig has to measure it that way,
     * but a frog that appears is already on its feet. Left at zero the legs
     * spent their first frames folding from straight into whatever pose was
     * asked for, and the soles swung below the floor on the way â€” which is
     * worse the deeper the pose, and the ninja stance is deep.
     */
    for (const leg of this.legs) {
      leg.hip.rotation.x = -0.42;
      leg.shin.rotation.x = 0.85;
      leg.foot.rotation.x = -0.51;
    }
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

  _buildTorso() {
    const b = this.body;
    // Chunky pear-shaped frog torso.
    this.torso = mesh(G.sphere, this.mats.skin, ...TOR, 0, TOR_Y, 0);
    b.add(this.torso);
    // The gi's hem, carried down the flanks and the back. See SKIRT_FIT.
    this.skirtM = mesh(G.skirt, this.mats.cloth,
      TOR[0] * SKIRT_FIT, TOR[1] * SKIRT_FIT, TOR[2] * SKIRT_FIT, 0, TOR_Y, 0);
    b.add(this.skirtM);

    /**
     * The midsection: the belly and everything worn OVER it, in one group.
     *
     * The throat pulse in update() breathes this whole group rather than the
     * belly alone. Clothes on a body that inflates have to inflate with it â€”
     * a shirt over a balloon stretches when the balloon does â€” and scaling
     * only the belly drove it in and out through a gi and a sash that never
     * moved, so the pale area grew and shrank against a fixed dark rim.
     *
     * Grouping them is what keeps it honest: the belly stays exactly the same
     * fraction proud of the cloth at every point in the breath, because the
     * one scale applies to both.
     */
    this.girth = new THREE.Group();
    b.add(this.girth);
    const g = this.girth;

    // Pale belly patch, pushed slightly forward.
    const BEL = [0.40, 0.34, 0.33], BEL_Z = 0.20;
    this.bellyM = mesh(G.sphere, this.mats.belly, ...BEL, 0, 0.55, BEL_Z);
    g.add(this.bellyM);
    /**
     * Ninja gi wrapped around the middle, and the obi over it.
     *
     * Each is sized off what it has to COVER rather than by eye. The gi was a
     * 0.50-wide 8-sided cylinder around a 0.52-wide torso: its flat faces sat
     * at 0.46, inside the body, so the green frog pushed out through the
     * shirt everywhere except the eight corners â€” over half of every
     * horizontal slice was flesh showing through cloth. The obi then has to
     * clear the gi for the same reason.
     */
    const gi = TOR.map((r) => r * WRAP_FIT);
    this.giM = mesh(G.wrap, this.mats.cloth, gi[0], GI_H, gi[2], 0, GI_Y, 0);
    g.add(this.giM);

    /**
     * The obi is tied ON the belly, so it has to reach past it.
     *
     * The frog is not round front-to-back: the belly bulges forward to 0.53
     * while the gi's back sits at 0.47. A sash centred on the body therefore
     * cannot reach the belly's nose without ballooning off the spine by the
     * same amount â€” and centred, it simply sank behind the belly, leaving the
     * red showing only as two slivers at the far edges where the belly ran
     * out.
     *
     * So it is an oval, pushed forward far enough to clear the belly's nose
     * and no further. Both numbers come from the shapes it wraps: the belly's
     * front and the gi's back.
     */
    const nose = BEL_Z + BEL[2];                 // the belly's front
    const spine = gi[2];                         // the gi's back
    const obiZ = (nose - spine) / 2;             // shift forward to sit between
    const obiR = ((nose + spine) / 2) * WRAP_FIT;
    g.add(mesh(G.wrap, this.mats.scarf,
      gi[0] * WRAP_FIT, 0.10, obiR, 0, 0.50, obiZ));
    // Sash knot.
    g.add(mesh(G.box, this.mats.scarf, 0.16, 0.16, 0.12, 0.34, 0.50, 0.16));
  }

  _buildHead() {
    // Head pivots at the neck so it can tilt toward grapple targets.
    this.head = new THREE.Group();
    this.head.position.set(0, 1.02, 0);
    this.body.add(this.head);

    this.headM = mesh(G.sphere, this.mats.skin, 0.44, 0.36, 0.42, 0, 0, 0);
    this.head.add(this.headM);

    // Wide frog mouth line, drawn on the mask a hair proud of it. It used to
    // be a flat bar at z 0.34, which sat inside the mask's 0.43 and was never
    // visible at all â€” the jaw hanging out in front was doing the whole job
    // of looking like a mouth, and once that was tucked away the face had
    // nothing on it.
    this.head.add(mesh(G.mouth, this.mats.skinDark,
      0.435 * 1.02, 0.20 * 1.02, 0.415 * 1.02, 0, -0.14, 0.02));
    // Jaw â€” opens when the tongue fires.
    //
    // Tucked inside the face mask. It used to reach z 0.52 while the mask's
    // front is 0.43, so a dark green chin hung out in front of the black
    // cloth and read as a second chin covering it.
    //
    // Made SMALLER to fit rather than pushed back behind the hinge: the jaw
    // has to stay in front of its pivot or opening it swings the chin
    // backwards into the skull instead of dropping it.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.12, 0.16);
    this.head.add(this.jaw);
    this.jaw.add(mesh(G.sphere, this.mats.skinDark, 0.31, 0.11, 0.20, 0, -0.04, 0.05));

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
      /**
       * Lid used for blinking. It swells over the eyeball from inside it,
       * rather than being a flat plate that drops down the front.
       *
       * As a plate it was a disc of radius 0.24 lying at eye height with its
       * thickness scaled to nothing â€” and the eyeball spans that height, so
       * the disc cut a green line straight across the white. Not during a
       * blink: while the eye was OPEN, which is nearly all the time.
       *
       * Centred in the middle of the eyeball, a lid at rest is a speck buried
       * inside the white where nothing can see it, and 0.21 is the radius
       * that just swallows the white, the pupil and the highlight.
       */
      const lid = mesh(G.lowSphere, this.mats.skin, 0.002, 0.002, 0.002, 0, 0.02, 0.10);
      g.add(lid);
      this.eyes.push({ group: g, white, pupil, lid });
    }

    // --- ninja hood: dark cowl over the back and top of the skull ---
    //
    // The back reached z -0.67 against a skull that stops at -0.42: a quarter
    // of a unit of cloth hanging off the back of the head, 60% of the head's
    // own depth again, which read as a huge black lump from behind. It is now
    // pulled in so the head reaches back 1.25x less far â€” 0.33 took it 1.5x
    // and that was too far the other way, leaving the hood looking shrunken.
    //
    // Radius and offset move together so the hood's FRONT edge stays put over
    // the crown; only the back comes in.
    //
    // (The two lines that used to follow this set scale.z to the 0.45 it had
    // already been given and then moved the blob back to -0.22. The "flatten
    // the front" they claimed to do never happened.)
    const hood = mesh(G.sphere, this.mats.cloth, 0.47, 0.40, 0.38, 0, 0.02, -0.156);
    this.head.add(hood);
    this.head.add(mesh(G.sphere, this.mats.cloth, 0.455, 0.30, 0.44, 0, 0.14, 0));
    // Face mask across the mouth.
    this.head.add(mesh(G.sphere, this.mats.clothDark, 0.435, 0.20, 0.415, 0, -0.14, 0.02));

    // Headband across the brow with two trailing tails.
    this.head.add(mesh(G.cyl, this.mats.scarf, 0.455, 0.075, 0.44, 0, 0.10, 0));
    /**
     * The brow plate, and the sheath fittings in _buildGear, are the frog's
     * OWN gear drawn in the sword's guard colour â€” which is fine for every
     * skin in the game except one. Collected so `_buildEclipse` can restate
     * them in silver: the Forgotten One has no gold anywhere on it, and a
     * gold buckle in the middle of its face was the single loudest wrong
     * note on the model.
     *
     * The katana itself is deliberately NOT in this list. Which sword you
     * carry is your choice, and its guard should stay the colour that sword
     * says it is.
     */
    this._goldTrim = this._goldTrim || [];
    const brow = mesh(G.box, this.mats.gold, 0.14, 0.11, 0.03, 0, 0.10, 0.42);
    this._goldTrim.push(brow);
    this.head.add(brow);
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
      // Wrist wrap + three-toed frog hand. Rounded like the leg's, so the
      // pair match rather than one being a visible octagon.
      fore.add(mesh(G.wrap, this.mats.clothDark, 0.115, 0.06, 0.115, 0, -0.03, 0));
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
      /**
       * The haunch, filling the corner between the body and the thigh.
       *
       * The torso is a sphere that pinches to a point at its bottom, and the
       * thigh is a tube standing beside it, so the two run out of each other
       * on the way down: by y 0.18 the torso's edge has drawn in to x 0.15
       * while the thigh's inner edge is still at 0.165, and the air between
       * them widens from there. That is what made the legs read as parked
       * next to the frog rather than growing out of it.
       *
       * It rides in the hip group, close to the pivot, so it follows the leg
       * a little as it swings â€” like a haunch â€” instead of either staying
       * welded to the body or swinging the whole way with the thigh.
       */
      hip.add(mesh(G.sphere, this.mats.skin, 0.20, 0.155, 0.185,
        sx * -0.05, -0.10, -0.01));
      // Powerful frog thigh, angled outward.
      hip.add(mesh(G.capsule, this.mats.skin, 0.155, 0.15, 0.16, sx * 0.05, -0.14, -0.02));
      const shin = new THREE.Group();
      shin.position.set(sx * 0.08, -0.30, 0);
      hip.add(shin);
      shin.add(mesh(G.capsule, this.mats.skin, 0.10, 0.14, 0.10, 0, -0.13, 0.02));
      // Leg wrap. Two things were wrong with it: an 8-sided cylinder's flat
      // faces sit at 0.92 of its radius, and it was centred on z 0 while the
      // shin it wraps sits at z +0.02 â€” so the green leg came out through the
      // front of the black binding. Rounder, and lined up with the limb.
      shin.add(mesh(G.wrap, this.mats.clothDark, 0.115, 0.07, 0.115, 0, -0.02, 0.02));
      const foot = new THREE.Group();
      foot.position.set(0, -0.29, 0);
      shin.add(foot);
      // Big webbed foot â€” reads instantly as "frog".
      foot.add(mesh(G.lowSphere, this.mats.skin, 0.15, 0.06, 0.26, 0, -0.02, 0.11));
      for (let t = 0; t < 3; t++) {
        foot.add(mesh(G.lowSphere, this.mats.skin, 0.055, 0.045, 0.10,
          (t - 1) * 0.10, -0.02, 0.30));
      }
      this.legs.push({ hip, shin, foot, side: sx });
    }
  }

  /**
   * Measure how far the feet hang below the origin, and lift by exactly that.
   *
   * Run once, right after the legs are built and while everything is still in
   * its rest pose at the world origin â€” so a local-space box is a world-space
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
    // the feet at precisely zero is geometrically right and looks wrong â€”
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
    // Koiguchi and kojiri â€” see the note on `_goldTrim` in _buildHead.
    this._goldTrim = this._goldTrim || [];
    for (const [sy, sz, py] of [[0.05, 0.16, 0.68], [0.045, 0.158, -0.08]]) {
      const fit = mesh(G.box, this.mats.gold, 0.095, sy, sz, 0, py, 0);
      this._goldTrim.push(fit);
      this.sheath.add(fit);
    }
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
   * This is the whole answer to "why buy a crate" â€” a recolour costs nothing
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
    /**
     * A ring of points around the skull.
     *
     * `crown` may be a NUMBER, which scales it â€” the Swamp King's is meant
     * to be huge and the Star Emperor's larger again, and a crown that is
     * the same size on a common and on a legendary is not a crown, it is a
     * hat everybody owns. `true` still means 1.
     *
     * â”€â”€ IT HAS TO CLEAR THE EYES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     * This frog's eyes are mounds of radius 0.23 centred at (Â±0.28, 0.26,
     * 0.10) â€” they bulge to y 0.49, well above the 0.36 skull. The crown was
     * a ring of 0.14-tall cones based at y 0.26, on a ring of radius 0.36:
     * the same height and almost the same place as the eyes, so five of its
     * seven points were INSIDE an eyeball and the other two inside the
     * skull. No skin has ever actually shown its crown, this one or the
     * three that had it before.
     *
     * The band may still be hidden behind the brow â€” that is what a crown
     * does â€” but the POINTS now start above the eyes and rise from there.
     */
    if (F.crown && M.inlay) {
      const cs = typeof F.crown === 'number' ? F.crown : 1;
      const rr = 1 + (cs - 1) * 0.12;
      const y = 0.40 + (cs - 1) * 0.10;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        this.head.add(mesh(G.cone, M.inlay, 0.05 * cs, 0.30 * cs, 0.05 * cs,
          Math.cos(a) * 0.34 * rr, y + 0.04 * cs, Math.sin(a) * 0.32 * rr));
      }
      // A band joining them, so it is a crown and not seven spikes.
      this.head.add(mesh(G.torus, M.inlay,
        0.34 * rr, 0.34 * rr, 0.33 * rr, 0, y - 0.13 * cs, 0, Math.PI / 2));
    }
    /**
     * â”€â”€ ARMOUR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * A breastplate, a pair of pauldrons and a collar. Parented to the BODY
     * and the SHOULDERS respectively, so the plate leans and squashes with
     * the frog and the pauldrons swing with the arms â€” armour bolted to the
     * root would slide about over the animation and read as a decal.
     *
     * The pauldrons go on `shoulder`, not `fore`: a pauldron covers the
     * joint, and on the forearm it would travel down the arm mid-swing.
     */
    if (M.plate) {
      /**
       * SIZED OFF THE TORSO, the way every other garment on this rig is.
       *
       * The torso is an ellipsoid 0.52 Ã— 0.46 Ã— 0.46 centred at y 0.62 (see
       * TOR), which puts its front face at z 0.45 across the chest. The
       * first version of this armour was 0.35 deep and sat entirely INSIDE
       * the frog â€” exactly the mistake the note on the gi warns about, and
       * it renders as a differently-coloured naked frog. Every figure below
       * is checked against that ellipsoid at the height it sits at.
       */
      /**
       * The breastplate goes in `girth`, NOT on the body.
       *
       * That group is what the croak inflates, and it holds the belly with
       * the gi and the obi over it precisely so clothing stretches with the
       * body underneath â€” see _buildTorso. Armour bolted to the body would
       * have the belly swell straight through it on every croak.
       */
      const g = this.girth;
      g.add(mesh(G.lowSphere, M.plate, 0.46, 0.33, 0.42, 0, 0.56, 0.20));
      /**
       * A raised ridge down the middle of it, so it is not a smooth blob —
       * UNLESS an emblem is going there, in which case the ridge would run
       * straight through the middle of it. One or the other owns the centre
       * line of the chest; on Keystone it is the emblem.
       */
      if (!M.emblem) {
        g.add(mesh(G.box, M.plateDark, 0.07, 0.30, 0.07, 0, 0.58, 0.56));
      }
      // A gorget at the neck: clear of the torso (0.443 at this height) and
      // of the skull (0.388), so it rings the gap between them.
      b.add(mesh(G.wrap, M.plateDark, 0.48, 0.11, 0.45, 0, 0.86, 0));
      b.add(mesh(G.wrap, M.plate, 0.465, 0.07, 0.435, 0, 0.94, 0));
      // Pauldrons capping the shoulder joints. The upper arm is a 0.11
      // capsule, so these have to be more than twice its width to read.
      for (const arm of this.arms) {
        arm.shoulder.add(mesh(G.lowSphere, M.plate, 0.26, 0.18, 0.25, 0, -0.02, 0));
        arm.shoulder.add(mesh(G.box, M.plateDark, 0.27, 0.045, 0.26, 0, -0.15, 0));
      }
    }
    /**
     * ═══════════════════════════════════════════════════════════════════
     * ═══ KEYSTONE — THE ONE OF ONE ═════════════════════════════════════
     * ═══════════════════════════════════════════════════════════════════
     *
     * Four pieces, built in the order they are meant to be read:
     * the CREST (from across the map), the MANTLE (from across a street),
     * the EMBLEM (from a duel's distance), and the SEAMS (from nowhere at
     * all — they are for the person who owns it).
     *
     * Every offset below is checked against the rig it sits on. The skull
     * is a 0.44 × 0.36 × 0.42 ellipsoid at the head's origin, the eye
     * mounds are radius-0.23 spheres at (±0.28, 0.26, 0.10), the cowl is
     * 0.47 × 0.40 × 0.38 at (0, 0.02, −0.156), and the torso is 0.52 ×
     * 0.46 × 0.46 centred at y 0.62. Those five numbers decide everything
     * here — see `_buildHead` and the note on the crown, which is the
     * cautionary tale: it spent months as seven points buried inside the
     * eyeballs because nobody measured.
     */
    if (M.diadem) this._buildDiadem(F, M);
    if (M.mantle) this._buildMantle(F, M);
    if (M.emblem) this._buildEmblem(F, M);

    // Moss: tufts around the torso and over the crown, each pushed out to
    // the body's own surface at its height so it sits ON the frog.
    if (M.moss) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const y = 0.52 + (i % 4) * 0.13;
        const k = Math.sqrt(Math.max(0.2, 1 - Math.pow((y - 0.62) / 0.46, 2)));
        b.add(mesh(G.lowSphere, M.moss, 0.16, 0.09, 0.14,
          Math.cos(a) * 0.55 * k, y, Math.sin(a) * 0.50 * k));
      }
      this.head.add(mesh(G.lowSphere, M.moss, 0.24, 0.10, 0.20, 0, 0.30, -0.10));
    }
    /**
     * A HOOD, pulled up over the cowl the rig already has.
     *
     * Every frog wears a dark cowl over the back and top of its skull â€” see
     * _buildHead â€” so a hood skin cannot just add cloth in the same place;
     * that is what the first attempt did, and it was invisible. This one is
     * bigger than the cowl in all three axes and arches over the top of the
     * eyes, which the cowl does not reach.
     *
     * It stops short of the FACE on purpose. The eyes are mounds at
     * (Â±0.28, 0.26, 0.10) with a radius of 0.23; a shell whose front edge
     * lands at z 0.16 presses in behind them and leaves the whites, the
     * pupils and the mask clear, which is how a hood actually sits.
     */
    if (M.hood) {
      this.head.add(mesh(G.sphere, M.hood, 0.52, 0.44, 0.36, 0, 0.08, -0.20));
      this.head.add(mesh(G.cone, M.hood, 0.16, 0.34, 0.16, 0, 0.26, -0.38, 1.15));
      // A drape down the back of the neck.
      this.head.add(mesh(G.box, M.hood, 0.42, 0.34, 0.05, 0, -0.18, -0.42, 0.24));
    }
    /**
     * A shield, strapped to the OFF arm.
     *
     * Side -1, never side +1: the sword is posed into the right hand, and a
     * shield on that arm would be swung through the target along with the
     * blade. On the left forearm it stays out of every swing.
     */
    if (M.shield) {
      const off = this.arms.find((a) => a.side < 0);
      if (off) {
        off.fore.add(mesh(G.cyl, M.shield, 0.30, 0.05, 0.30,
          -0.13, -0.16, 0, 0, 0, Math.PI / 2));
        off.fore.add(mesh(G.torus, M.shieldRim, 0.30, 0.30, 0.30,
          -0.15, -0.16, 0, 0, 0, Math.PI / 2));
        off.fore.add(mesh(G.lowSphere, M.shieldRim, 0.08, 0.08, 0.08, -0.19, -0.16, 0));
      }
    }
    /**
     * Glowing specks over the hide â€” stars, or a comet's trail.
     *
     * Pushed out onto the torso's own surface at each height for the same
     * reason the moss is: a speck one hundredth inside an opaque frog is not
     * a speck, and the torso's half-width falls away fast above the middle.
     */
    if (M.star) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 * 3;
        const y = 0.34 + (i / 14) * 0.58;
        const k = Math.sqrt(Math.max(0.2, 1 - Math.pow((y - 0.62) / 0.46, 2)));
        b.add(mesh(G.box, M.star, 0.05, 0.05, 0.05,
          Math.cos(a) * 0.54 * k, y, Math.sin(a) * 0.49 * k));
      }
      this.head.add(mesh(G.box, M.star, 0.055, 0.055, 0.055, 0.30, 0.06, 0.28));
      this.head.add(mesh(G.box, M.star, 0.045, 0.045, 0.045, -0.34, -0.02, 0.22));
    }
    /**
     * â”€â”€ ORBITING FRAGMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Chips of gold going round the frog, animated in `update`. This is the
     * signature of the Mythic â€” see the note on `frog_sovereign` in
     * js/skins.js â€” so it is deliberately the only fx here that MOVES
     * independently of the rig, which is what makes it catch the eye.
     *
     * Parented to the body but positioned in body space each frame, and
     * `castShadow` off: fourteen shadow casters orbiting a frog is a lot of
     * shadow map for a cosmetic, and a chip of light should not cast one.
     */
    // Sparks coming off the hide and rising. See the note on the material.
    if (M.ember) {
      this.embers = [];
      for (let i = 0; i < 9; i++) {
        const size = 0.06 + (i % 3) * 0.015;
        const e = mesh(G.box, M.ember, size, size, size, 0, 0, 0);
        e.castShadow = false;
        b.add(e);
        this.embers.push({
          mesh: e,
          size,
          a: (i / 9) * Math.PI * 2,
          r: 0.34 + (i % 3) * 0.13,
          t: i / 9,                       // staggered, so they do not pulse together
          rate: 0.34 + (i % 4) * 0.08,
        });
      }
    }
    if (M.shard) {
      this.shards = [];
      const n = F.orbitN || 6;
      for (let i = 0; i < n; i++) {
        const s = mesh(G.box, M.shard, 0.07, 0.07, 0.07, 0, 0, 0);
        s.castShadow = false;
        b.add(s);
        const halo = mesh(G.lowSphere, M.shardFaint, 0.11, 0.11, 0.11, 0, 0, 0);
        halo.castShadow = false;
        s.add(halo);
        this.shards.push({
          mesh: s,
          a: (i / n) * Math.PI * 2,
          r: 0.72 + (i % 3) * 0.13,
          y: 0.30 + (i % 4) * 0.20,
          spin: 0.55 + (i % 3) * 0.22,
          bob: 0.06 + (i % 2) * 0.05,
        });
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
      /**
       * â”€â”€ A BROKEN ONE HANGS, IT DOES NOT FLOAT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
       *
       * `haloBroken` swaps the pristine ring for the crescent geometry the
       * eclipse emblem already uses â€” a circle with a piece missing â€” and
       * hangs it BEHIND the head at a tilt rather than level overhead.
       *
       * The tilt is the read. A ring sitting flat above the skull is the
       * universal shorthand for sanctity, and it keeps meaning that however
       * you recolour it; the same ring knocked off its axis with a bite out
       * of it means the opposite, and means it instantly. That is the whole
       * difference between Astral Sovereign and Fallen Celestial, which
       * until now were the same crowned, double-haloed frog in two tints.
       */
      if (F.haloBroken) {
        this._haloBroken = true;
        this._haloTilt = Math.PI / 2 - 0.42;
        this.halo = mesh(G.arc, M.halo, 0.34, 0.34, 0.34,
          0, 1.80, -0.16, this._haloTilt, 0, 0.55);
        this.halo.castShadow = false;
        b.add(this.halo);
        // A shard of it, drifting loose where the gap is.
        const chip = mesh(G.box, M.halo, 0.07, 0.05, 0.05, 0.30, 1.62, -0.05, 0, 0, 0.6);
        chip.castShadow = false;
        b.add(chip);
      } else {
        this.halo = mesh(G.torus, M.halo, 0.30, 0.30, 0.30, 0, 1.92, 0, Math.PI / 2);
        this.halo.castShadow = false;
        b.add(this.halo);
        if (F.halo2) {
          this.halo2 = mesh(G.torus, M.halo, 0.42, 0.42, 0.42, 0, 2.02, 0, Math.PI / 2);
          this.halo2.castShadow = false;
          b.add(this.halo2);
        }
      }
    }
    if (M.wing) this._buildWings(F, M, b);
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
    /**
     * The restrained version: a lit iris in a normal eye.
     *
     * The pupil is also shrunk. At full size it fills most of the visible
     * eyeball, so lighting it is barely different from lighting the whole
     * thing — and the sclera is dropped to a pale ivory rather than left
     * stark white, because a cold blue iris needs something warm and
     * slightly dim around it or the contrast reads as a glare rather than
     * as an eye.
     */
    if (M.irisLit) {
      for (const e of this.eyes) {
        e.pupil.material = M.irisLit;
        e.pupil.scale.set(0.072, 0.098, 0.072);
      }
      this.mats.eye.color.setHex(0xe4e0d2);
    }
    if (F.eclipse) this._buildEclipse();
    if (F.divine) this._buildDivine();
  }

  /**
   * â•â•â• WINGS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * A fan of feathers off each shoulder blade, hinged at a group so the
   * whole thing can flex â€” see `_updateWings`.
   *
   * â”€â”€ ragged on purpose â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   * `wingsTorn` shortens alternate feathers and drops one outright. A
   * clean, even fan reads as an angel; the same fan with holes in it reads
   * as one that has been through something, which is the entire brief for
   * the skin this was written for. It is a flag rather than a separate
   * builder because the two are the same object at different ages.
   *
   * The geometry is boxes, not planes: this rig is lit from one side and a
   * zero-thickness feather disappears entirely at the wrong angle.
   *
   * Mounted on the BODY so they squash and lean with it. On the root they
   * would slide around over the animation and read as a sticker.
   */
  /**
   * ═══ KEYSTONE'S HEADPIECE ═══════════════════════════════════════════════
   *
   * A ridge over the crown and ONE curved crest sweeping off the back. That
   * is the whole thing, and the restraint is the design: one strong
   * silhouette element beats twenty small ones, and this rig has a cemetery
   * of small ones that nobody can see from more than four units away.
   *
   * ── WHY THERE IS NO CIRCLET ───────────────────────────────────────────
   * The obvious ceremonial headpiece is a band around the skull, and on this
   * frog it is geometrically impossible. The eyes are radius-0.23 mounds
   * centred at (±0.28, 0.26, 0.10) — 0.297 from the head's axis, reaching up
   * to y 0.49 — while the SKULL only reaches y 0.36. Any ring wide enough to
   * clear the eyeballs is a ring floating above a head it never touches, and
   * any ring that touches the head passes straight through both eyes. This
   * is the same trap the crown fell into: seven points buried inside the
   * eyeballs for months because nobody did the arithmetic.
   *
   * So the headpiece lives on the CENTRELINE, in the 0.10-unit channel
   * between the eyes where there is nothing to hit, and on the BACK of the
   * skull where there is nothing at all. Both are clear at every angle, and
   * the shape it produces — a spine running front to back, rising into a
   * fin — is more distinctive than a circlet would have been anyway.
   */
  _buildDiadem(F, M) {
    const h = this.head;

    /**
     * The ridge: five plates following the skull's own curve from the brow
     * over the crown. Each one is placed ON the surface at its own z rather
     * than on a straight line, so it reads as something fitted to the head
     * instead of a bar laid across it.
     *
     * The skull is 0.44 × 0.36 × 0.42, and the cowl over the back of it is
     * bigger again, so the ridge has to rise as it goes back — these are the
     * heights of the cowl, not of the bare skull.
     */
    const RIDGE = [
      [0.345, 0.20, 0.055, 0.075],   // z, y, halfWidth, length — at the brow
      [0.235, 0.345, 0.052, 0.085],
      [0.080, 0.430, 0.050, 0.100],  // over the crown
      [-0.090, 0.445, 0.048, 0.100],
      [-0.235, 0.405, 0.045, 0.095],
    ];
    for (const [z, y, w, len] of RIDGE) {
      h.add(mesh(G.box, M.diadem, w, 0.05, len, 0, y, z));
      // A hairline of ivory down the top of it, which is the only place on
      // the head the trim colour appears.
      if (M.trim) h.add(mesh(G.box, M.trim, w * 0.34, 0.052, len * 0.8, 0, y + 0.012, z));
    }
    // The brow terminal: a small keystone wedge where the ridge meets the
    // face, wider at the top than the bottom like the stone it is named for.
    h.add(mesh(G.box, M.diadem, 0.085, 0.10, 0.045, 0, 0.145, 0.375));
    if (M.trim) h.add(mesh(G.box, M.trim, 0.050, 0.030, 0.050, 0, 0.175, 0.378));

    /**
     * ── THE CREST ───────────────────────────────────────────────────────
     *
     * One curve, rising up and back off the crown. This is the thing that
     * makes the skin recognisable at range, so it is the only part of the
     * design allowed to be large — and it is still only 0.5 units tall,
     * which is a third of the frog.
     *
     * Built as seven tapering segments along a quadratic rather than as one
     * angled slab, because a straight fin reads as a knife stuck in the head
     * and a curved one reads as something forged to a shape. The taper is
     * what keeps it elegant instead of blunt.
     */
    /**
     * ── IT HAS TO BE BIG ENOUGH TO CHANGE THE OUTLINE ──────────────────
     *
     * The first version of this crest was 0.44 tall and swept back 0.40,
     * and against a default frog at twenty units it was INDISTINGUISHABLE —
     * a two-pixel nub on the skull. That is the brief's own final test
     * ("would I recognise it in a crowd of a hundred?") failing outright,
     * and no amount of detail on the chest fixes a silhouette.
     *
     * So it is now 0.55 tall and sweeps 0.72 BACK, which is the important
     * number: height alone just makes a spike, and a spike is what the
     * brief said not to make. The long backward sweep is what turns the
     * outline into a shape nothing else in the game has — the head reads as
     * an arrowhead rather than as a ball.
     *
     * It is still smaller than the head it sits on, so the frog is not
     * gigantic and the proportions are untouched.
     */
    const N = 9;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const y = 0.40 + t * 0.55;
      const z = -0.24 - t * 0.24 - t * t * 0.48;
      const tall = 0.17 - t * 0.075;
      const wide = 0.055 - t * 0.022;
      // Leaning further back as it climbs, so the top of the curve is
      // nearly horizontal and the whole thing sweeps rather than spikes.
      const lean = 0.30 + t * 0.78;
      h.add(mesh(G.box, M.diadem, wide, tall, 0.26 - t * 0.07, 0, y, z, lean));
      if (M.trim && i > 1) {
        h.add(mesh(G.box, M.trim, wide * 0.30, tall * 0.92, 0.265 - t * 0.07,
          0, y + 0.005, z, lean));
      }
    }
    // The crest's root, covering the join so it does not look posted on.
    h.add(mesh(G.lowSphere, M.diademDark || M.diadem, 0.085, 0.075, 0.115,
      0, 0.395, -0.255));

    /**
     * Two studs low on the sides of the cowl, at z −0.26 where the eyes
     * cannot reach. They are the only symmetrical metal on the head, and
     * they exist to stop the profile view being a bare cheek.
     */
    for (const sx of [-1, 1]) {
      h.add(mesh(G.lowSphere, M.diadem, 0.055, 0.055, 0.045,
        sx * 0.355, 0.12, -0.255));
    }
  }

  /**
   * ═══ KEYSTONE'S MANTLE — AND WHY IT IS ONLY ON ONE SHOULDER ═════════════
   *
   * Every other frog in this game is bilaterally symmetrical. Every one.
   * That makes asymmetry the cheapest and by far the strongest recognition
   * cue available: a lopsided outline is identifiable at any range, at any
   * speed, from any angle and in any lighting, and it costs four boxes.
   *
   * It hangs off the LEFT shoulder and is parented to the BODY rather than
   * to the arm. A cape on the shoulder joint swings with every punch and
   * reads as a flag tied to the wrist; on the body it leans and squashes
   * with the torso, which is what cloth does.
   */
  _buildMantle(F, M) {
    const b = this.body;
    const D = M.mantleDark || M.mantle;

    /**
     * ── AND IT HAS TO STAND PROUD OF THE BODY ──────────────────────────
     *
     * Same lesson as the crest. The first mantle hung flat against the
     * back at x −0.40, inside the frog's own width — so it changed the
     * colour of the shoulder and nothing else, and the silhouette was a
     * default frog. A cape that does not break the outline is paint.
     *
     * It now reaches x −0.62, clear of the torso's own 0.52 half-width, and
     * falls to the knee. That overhang is the entire point: one side of
     * this frog is a straight draped edge and the other is a frog, and THAT
     * is what somebody recognises across an arena.
     */
    b.add(mesh(G.lowSphere, M.mantle, 0.42, 0.28, 0.40, -0.46, 0.80, -0.02));
    /**
     * ── AND IT HANGS DOWN THE SIDE, NOT DOWN THE BACK ──────────────────
     *
     * The second version of this hung the fall behind the frog at z −0.40
     * to −0.46. From the side and from behind it was a cape; FROM THE
     * FRONT it was nothing at all, because it was directly behind a body
     * wider than it was. Half the time you see another player in this game
     * you are looking at their front.
     *
     * The fall is therefore centred on z −0.10 — beside the torso rather
     * than behind it — and pushed out to x −0.66, clear of the 0.52 body
     * and the 0.46 shoulder. What that buys is the thing the whole skin is
     * for: from straight on, one side of this frog is a long straight
     * draped edge falling to the ankle and the other side is an ordinary
     * round frog. Nothing else in the game is lopsided, so the outline
     * alone identifies it, at any range and from any angle.
     */
    const FALL = [
      [-0.56, 0.68, -0.08, 0.30, 0.26, 0.40],
      [-0.63, 0.46, -0.10, 0.26, 0.26, 0.46],
      [-0.66, 0.24, -0.11, 0.22, 0.26, 0.48],
      [-0.64, 0.02, -0.11, 0.20, 0.24, 0.44],
      [-0.58, -0.16, -0.10, 0.18, 0.20, 0.36],
    ];
    for (const [x, y, z, w, hgt, depth] of FALL) {
      b.add(mesh(G.box, M.mantle, w, hgt, depth, x, y, z, 0, 0, 0.16));
    }
    // An ivory hem along the bottom edge, and a darker lining showing at it.
    b.add(mesh(G.box, D, 0.19, 0.06, 0.37, -0.57, -0.27, -0.10, 0, 0, 0.16));
    if (M.trim) {
      b.add(mesh(G.box, M.trim, 0.20, 0.022, 0.38, -0.572, -0.24, -0.10, 0, 0, 0.16));
    }

    /**
     * The clasp: the one piece of metal holding the whole thing on, at the
     * collarbone where it can actually be seen from the front. Without it
     * the mantle reads as a towel.
     */
    b.add(mesh(G.lowSphere, M.diadem || D, 0.085, 0.085, 0.060, -0.40, 0.855, 0.15));
    if (M.trim) {
      b.add(mesh(G.box, M.trim, 0.040, 0.040, 0.030, -0.40, 0.875, 0.185));
    }

    /**
     * ── THE MARK ON THE BACK ────────────────────────────────────────────
     *
     * Three wedges, 0.05 across, on the shoulder of the cape. The emblem
     * proper is on the chest; this is a maker's mark, and it is the reward
     * for being the one person who ever walks behind the champion.
     *
     * Three rather than five on purpose — the full arch is the chest's, and
     * repeating it whole would be the "put the logo everywhere" failure.
     */
    if (M.emblem) {
      for (let i = 0; i < 3; i++) {
        const a = Math.PI - (i / 2) * Math.PI;
        b.add(mesh(G.box, M.emblem, 0.030, 0.038, 0.020,
          -0.40 + Math.cos(a) * 0.075, 0.70 + Math.sin(a) * 0.075, -0.50,
          0, 0, a - Math.PI / 2));
      }
    }
  }

  /**
   * ═══ THE EMBLEM — "THE ONE WHO COULD NOT BE REPLACED" ══════════════════
   *
   * A five-stone arch with the keystone lit.
   *
   * This is the one idea the whole skin is built on, and the reason it is an
   * ARCH rather than a monogram or a rune: remove the wedge at the crown of
   * an arch and the arch falls. There is no second one, and nothing else
   * will do in its place. That is the concept stated as a piece of masonry
   * instead of as a slogan, and it is why it reads as something off an
   * ancient building rather than as a logo.
   *
   * ── the lit wedge is the ENTIRE effects budget ──────────────────────────
   * One 0.075-unit box of `emblemLit`. It is the only unlit material on the
   * frog, the only thing that pulses, and the only bright colour anywhere on
   * the skin. Everything else here is metal and cloth catching the world's
   * own light — which is the test the brief actually set: turn every
   * particle off and this still has to look like the rarest thing in the
   * game. With this wedge dark it still does, because the arch is a SHAPE.
   *
   * Sized against the breastplate it sits on: `plates` puts a 0.46 × 0.33 ×
   * 0.42 dome at (0, 0.56, 0.20) in `girth`, whose front face runs from
   * z 0.586 at the top of the arch to z 0.603 at its feet. The emblem sits
   * at 0.61 — proud of it everywhere, and by no more than two centimetres.
   */
  _buildEmblem(F, M) {
    const g = this.girth;
    const b = this.body;

    /**
     * ── KEYSTONE'S OWN ARMOUR ───────────────────────────────────────────
     *
     * Flat, thin, and on one shoulder. The shared `plates` set is a domed
     * breastplate plus two round pauldrons, and it turns this rig into a
     * barrel — which is what "do not make it bulky" rules out, and what
     * makes every armoured skin in the game the same shape.
     *
     * A 0.12-deep plate adds a little to the frog's depth and nothing to
     * its width. What it adds instead is a hard, straight-edged panel on a
     * body made entirely of spheres, which reads as armour precisely
     * BECAUSE it does not follow the curve.
     *
     * ── IT HAS TO CLEAR THE BELLY, NOT THE TORSO ────────────────────────
     * The obvious reference is the torso ellipsoid, whose front face is at
     * z 0.46. That is the wrong shape: the pale belly patch is a SEPARATE
     * sphere pushed forward, `BEL = [0.40, 0.34, 0.33]` at z 0.20, so its
     * nose reaches 0.53 — seven centimetres proud of the torso. A plate
     * sized off the torso sits behind it, and the render showed exactly
     * that: a belly bulging through a breastplate with the emblem stranded
     * on the wrong side of it. The same trap the obi's note warns about, in
     * the same place, for the same reason.
     *
     * Front face at 0.55, which clears the belly's nose everywhere across
     * the plate's own height.
     */
    const plate = this.mats.diademDark
      ? new THREE.MeshLambertMaterial({ color: 0x1e2c26 })
      : this.mats.clothDark;
    this.mats.champPlate = plate;
    // The chest panel: a flat slab across the pectorals, edged in ivory.
    g.add(mesh(G.box, plate, 0.60, 0.38, 0.12, 0, 0.600, 0.490));
    if (M.trim) {
      g.add(mesh(G.box, M.trim, 0.615, 0.016, 0.125, 0, 0.785, 0.492));
      g.add(mesh(G.box, M.trim, 0.615, 0.016, 0.125, 0, 0.415, 0.492));
    }
    // A thin collar, sitting in the gap between the torso and the skull.
    b.add(mesh(G.wrap, plate, 0.455, 0.075, 0.425, 0, 0.885, 0));
    if (M.diadem) b.add(mesh(G.wrap, M.diadem, 0.445, 0.022, 0.415, 0, 0.935, 0));

    /**
     * ONE PAULDRON, on the RIGHT — the shoulder the mantle leaves bare.
     *
     * Two would restore the symmetry the mantle was added to break. One
     * says the armour was made for this frog and made around the mantle,
     * which is the difference between a costume and a commission.
     */
    const right = this.arms[1];
    if (right) {
      right.shoulder.add(mesh(G.box, plate, 0.26, 0.12, 0.28, 0.02, -0.03, 0));
      right.shoulder.add(mesh(G.box, plate, 0.23, 0.09, 0.25, 0.03, -0.14, 0));
      if (M.diadem) {
        right.shoulder.add(mesh(G.box, M.diadem, 0.265, 0.020, 0.285, 0.02, 0.035, 0));
      }
    }

    /**
     * ── THE EMBLEM ──────────────────────────────────────────────────────
     *
     * Scaled up twice from the first pass, which was a 0.27-wide arch of
     * 0.05 wedges and rendered as an illegible white smear. At any real
     * distance an emblem has to be a SHAPE, and what makes an arch read as
     * an arch is the GAPS between its stones — so the wedges are small
     * relative to the radius and there is no base bar closing the bottom
     * of it. The springing line went because it merged with the two foot
     * wedges and turned the whole thing back into a smear.
     */
    /**
     * SMALL STONES ON A WIDE ARC.
     *
     * At R 0.20 with 0.09-deep wedges the five stones touched, and an arch
     * whose stones touch is not an arch — it is a white croquet hoop
     * painted on the chest, which is what the render showed. The radius is
     * down to 0.15 and the stones to two thirds of their size, so there is
     * daylight between them and the eye reads five separate pieces holding
     * each other up. That is the whole idea of the emblem.
     */
    /**
     * The stones are sized against the ARC they sit on, not by eye.
     *
     * Five stones over a half-circle of radius R are 0.785·R apart along
     * it. At R 0.15 with 0.044-wide stones the gaps were bigger than the
     * stones and the emblem read as five scattered tiles; at R 0.20 with
     * 0.09 stones they touched and it read as a solid hoop. 0.075 on a
     * 0.145 arc leaves a joint about a third of a stone wide, which is
     * what masonry looks like and what makes the eye read five pieces
     * holding each other up rather than one painted shape.
     */
    const R = 0.145;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI - (i / 4) * Math.PI;
      const keystone = i === 2;
      const mat = keystone && M.emblemLit ? M.emblemLit : M.emblem;
      g.add(mesh(G.box, mat,
        keystone ? 0.090 : 0.075,
        keystone ? 0.112 : 0.085,
        keystone ? 0.034 : 0.028,
        Math.cos(a) * R, 0.600 + Math.sin(a) * R, 0.565,
        0, 0, a - Math.PI / 2));
      /**
       * The keystone gets a shadow-wedge behind it in the solid colour, so
       * that when the light is off — and it does go off; see `_updateAlive`
       * — there is still a wedge there rather than a gap in the arch.
       */
      if (keystone) {
        g.add(mesh(G.box, M.emblem, 0.074, 0.108, 0.020,
          0, 0.600 + R, 0.552, 0, 0, a - Math.PI / 2));
      }
    }
    /** Held for the pulse. See `_updateKeystone`. */
    this.keystoneLit = M.emblemLit ? g.children[g.children.length - 2] : null;

    /**
     * ── THE WAIST ───────────────────────────────────────────────────────
     *
     * A plate over the obi with a short panel hanging from it. Deliberately
     * plain: the chest already has the emblem and the head already has the
     * crest, and a third thing competing with them is how a clean skin stops
     * being clean.
     */
    if (M.diadem) {
      g.add(mesh(G.box, M.diadem, 0.26, 0.070, 0.055, 0, 0.300, 0.440));
      if (M.trim) g.add(mesh(G.box, M.trim, 0.19, 0.020, 0.060, 0, 0.300, 0.443));
      // The hanging panel, in the cloth's own colour with an ivory edge.
      g.add(mesh(G.box, this.mats.clothDark, 0.17, 0.22, 0.045, 0, 0.185, 0.440));
      if (M.trim) g.add(mesh(G.box, M.trim, 0.175, 0.016, 0.048, 0, 0.080, 0.441));
    }

    /**
     * ── SEAMS ───────────────────────────────────────────────────────────
     *
     * Four ivory hairlines on the armour. They are 0.015 units thick and
     * nobody will ever see them from gameplay distance, which is the point:
     * the brief asked for detail that rewards looking closely, and detail
     * that is visible from across the arena is not detail, it is pattern.
     */
    if (M.trim) {
      for (const sx of [-1, 1]) {
        g.add(mesh(G.box, M.trim, 0.015, 0.28, 0.124, sx * 0.238, 0.600, 0.492));
      }
      // And one across the pauldron, on the side that has one.
      if (right) {
        right.shoulder.add(mesh(G.box, M.trim, 0.235, 0.012, 0.26, 0.03, -0.088, 0));
      }
    }
  }

  /**
   * ═══ KEYSTONE, MOVING ═══════════════════════════════════════════════════
   *
   * Four things, and all four are small enough that describing them takes
   * longer than seeing them. That is the intent: the brief asked for effects
   * that make the skin feel alive without BEING the skin, and the ceiling on
   * every number here is "somebody has to look twice to notice".
   *
   *   1. THE EMBLEM BREATHES. The lit wedge fades between 0.45 and 1.0 on a
   *      slow sine. Not a flash, not a strobe — the period is over four
   *      seconds, so at a glance it is simply lit.
   *   2. MOTES, ONLY WHEN STANDING STILL. Three of them, drifting up past the
   *      chest, and they fade out entirely the moment the frog moves. A
   *      particle that survives a sprint is a trail; one that only exists
   *      while you are still is punctuation.
   *   3. THE STANCE SHIFTS. Standing idle, the frog slowly settles its
   *      weight and lets the crest drift a few degrees. It reads as patience
   *      rather than as an animation playing.
   *   4. THE DRAW FLASHES. One clean pulse down the hamon when the katana
   *      comes out, decaying in a fifth of a second. Calm, then instant.
   *
   * What is deliberately NOT here: any aura, any trail, any orbit, any
   * screen effect, anything that scales with speed. At full sprint this skin
   * emits exactly what it emits standing still, which is almost nothing —
   * and that is what keeps the silhouette readable at speed instead of
   * hiding it inside its own effects.
   */
  _animateKeystone(dt, t, s, stance, speed) {
    /**
     * The emblem's slow breath.
     *
     * Driven on the MATERIAL rather than by swapping meshes, so the solid
     * wedge behind it (see `_buildEmblem`) shows through as the light drops
     * and the arch never has a hole in it.
     */
    const lit = this.mats.emblemLit;
    if (lit) {
      const k = 0.45 + (0.5 + Math.sin(t * 1.45) * 0.5) * 0.55;
      if (!this._emblemBase) this._emblemBase = lit.color.clone();
      lit.color.copy(this._emblemBase).multiplyScalar(k);
    }

    /**
     * Three motes, and they only exist while the frog is standing still.
     *
     * Built on first use rather than in the constructor: most frogs wearing
     * this skin will be the only one in the lobby, and every OTHER frog
     * would otherwise carry three unused meshes for the whole match.
     */
    if (this.mats.mote) {
      if (!this.motes) {
        this.motes = [];
        for (let i = 0; i < 3; i++) {
          const m = mesh(G.box, this.mats.mote, 0.035, 0.035, 0.035, 0, 0, 0);
          m.castShadow = false;
          this.body.add(m);
          this.motes.push({ mesh: m, t: i / 3, a: i * 2.1, r: 0.30 + i * 0.07 });
        }
      }
      // Fades with movement rather than switching off, so breaking into a
      // walk does not make three specks vanish on the same frame.
      const still = clamp(1 - speed * 0.7, 0, 1) * (stance ? 1 : 0.25);
      for (const m of this.motes) {
        m.t += dt * 0.32;
        if (m.t >= 1) m.t -= 1;
        m.a += dt * 0.55;
        m.mesh.position.set(
          Math.cos(m.a) * m.r, 0.45 + m.t * 0.62, Math.sin(m.a) * m.r * 0.6 + 0.30);
        // Fade in at the bottom, out at the top, and out entirely if moving.
        const fade = Math.sin(m.t * Math.PI);
        m.mesh.visible = still > 0.05;
        m.mesh.scale.setScalar(0.6 + fade * 0.7);
        this.mats.mote.opacity = 0.50 * still;
      }
    }

    /**
     * THE IDLE: a weight shift, and the crest drifting with it.
     *
     * Two damped sines a prime ratio apart (0.42 and 0.27 Hz), so the two
     * never line up and the loop never reads as a loop. Amplitudes are in
     * HUNDREDTHS of a radian — this is a frog settling its weight, not a
     * frog swaying.
     */
    if (stance) {
      this._calm = damp(this._calm === undefined ? 0 : this._calm, 1, 1.6, dt);
    } else {
      this._calm = damp(this._calm === undefined ? 0 : this._calm, 0, 8, dt);
    }
    const calm = this._calm || 0;
    if (calm > 0.01) {
      this.body.rotation.z += Math.sin(t * 0.42) * 0.030 * calm;
      this.body.rotation.y += Math.sin(t * 0.27) * 0.045 * calm;
      // The head lags the body, which is what makes it read as weight
      // moving rather than as the whole frog rotating.
      this.head.rotation.z += Math.sin(t * 0.42 - 0.6) * 0.022 * calm;
    }

    /**
     * THE DRAW. One clean pulse down the hamon as the blade comes round.
     *
     * Fired on the RISING EDGE of the swing rather than on a timer, so it
     * lands on the exact frame the katana starts moving — which is what
     * makes it read as "calm, then instant precision" rather than as a
     * light that happens to be blinking. It decays to nothing in 0.2s, so
     * it is over before the swing is.
     *
     * This rig has no sheathed state: the katana is always in the hand and
     * the scabbard on the back is scenery. The swing IS the draw.
     */
    const swinging = (s.attackT || 0) > 0;
    if (swinging && !this._wasSwing) this._drawT = 0.2;
    this._wasSwing = swinging;

    if (this._drawT > 0) {
      this._drawT = Math.max(0, this._drawT - dt);
      const k = this._drawT / 0.2;
      const e = this.mats.edge;
      if (e && e.color) {
        if (!this._edgeBase) this._edgeBase = e.color.clone();
        e.color.copy(this._edgeBase).lerp(WHITE, k * 0.8);
      }
    } else if (this._edgeBase && this.mats.edge) {
      this.mats.edge.color.copy(this._edgeBase);
      this._edgeBase = null;
    }
  }

  /**
   * Fire the one-of-one's draw flash. A no-op on every other skin, so the
   * caller does not have to know which frog it is holding.
   */
  flashDraw() {
    if (this.fx && this.fx.emblem) this._drawT = 0.2;
  }

  _buildWings(F, M, b) {
    const torn = !!F.wingsTorn;
    const span = F.wingSpan || 1;
    this.wings = [];

    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      // Off the shoulder blade: clear of the torso's back face (z -0.45 at
      // this height) so the root is not buried inside the frog.
      wing.position.set(sx * 0.26, 0.84, -0.30);
      // Swept up and out. Only slightly back: swept hard behind the frog
      // they were invisible from the front, which is the angle a player
      // spends the whole match looking at another player from.
      wing.rotation.set(0.26, sx * -0.32, sx * 0.20);
      b.add(wing);

      const FEATHERS = 6;
      for (let i = 0; i < FEATHERS; i++) {
        // A tear takes one feather out of the fan entirely.
        if (torn && i === 3) continue;
        const t = i / (FEATHERS - 1);
        // Longest at the top of the fan, tapering down â€” a wing, not a rake.
        let len = (0.78 - t * 0.34) * span;
        if (torn && i % 2 === 1) len *= 0.62;     // snapped short
        const thick = 0.05 - t * 0.010;

        const f = new THREE.Group();
        f.position.set(0, 0.02 - t * 0.05, 0);
        // Fanned: the top feather points up and back, the bottom one out.
        // Starts just above horizontal rather than near-vertical: fanned
        // steeper, the top feathers rose past the head and crowded the
        // face from the front, which is where the skin is mostly seen.
        f.rotation.set(0, 0, sx * (0.86 - t * 1.46));
        wing.add(f);

        /**
         * WIDE ENOUGH TO OVERLAP ITS NEIGHBOUR.
         *
         * At 0.13 across, with the fan spread over 1.5 radians, adjacent
         * feathers left a gap wider than the feather itself â€” so the
         * membrane never joined up and the whole wing rendered as a
         * handful of loose sticks poking out of the frog's back. The
         * width here is set so the fan closes into a surface, and the
         * TEARS are then what put holes back into it deliberately.
         */
        const q = mesh(G.box, M.wing, len, 0.26 - t * 0.06, thick, sx * len * 0.5, 0, 0);
        q.castShadow = false;
        f.add(q);
        // A lit edge along the leading side, so the wing still registers
        // against a night sky. Thin: when this was the only part with any
        // contrast, the edge WAS the wing.
        const e = mesh(G.box, M.wingEdge, len * 0.9, 0.03, thick * 0.8,
          sx * len * 0.5, 0.115 - t * 0.028, 0);
        e.castShadow = false;
        f.add(e);

        this.wings.push({
          group: f,
          side: sx,
          rest: f.rotation.z,
          // Staggered so the fan ripples rather than flapping as one plank.
          phase: t * 1.6 + (sx > 0 ? 0.4 : 0),
        });
      }
    }
  }

  /**
   * Flex the wings.
   *
   * Deliberately a slow drift rather than a flap: this frog walks and jumps
   * like every other frog, and wings that beat would promise a flight the
   * movement code does not deliver. They open a little in the air, which is
   * the one moment the promise is true enough.
   */
  _updateWings(dt, s) {
    if (!this.wings) return;
    const airborne = !s.grounded && !s.dead ? 1 : 0;
    for (const w of this.wings) {
      const drift = Math.sin(this.t * 1.5 + w.phase) * 0.09;
      // Opening is away from the spine, which is the sign of `rest`.
      const open = airborne * 0.30 * Math.sign(w.rest || w.side);
      w.group.rotation.z = damp(w.group.rotation.z, w.rest + drift + open, 6, dt);
    }
  }

  /**
   * â•â•â• THE FORGOTTEN ONE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * The one skin with a builder of its own. Everything else in the game is
   * assembled out of the shared fx vocabulary above â€” horns, a crown, a
   * halo, spines, orbiting chips â€” and that vocabulary can only produce
   * more entries in the same list. This is meant to read as a different
   * TIER of cosmetic, so it is a different object.
   *
   * â”€â”€ the rules it is built to â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   *  1. It is a FROG. Same proportions, same rig, same hitbox. Nothing here
   *     touches a collider or a stat, and nothing changes the silhouette by
   *     more than the thickness of a piece of armour.
   *  2. The body takes light. See the note on the skin in js/skins.js.
   *  3. Rarity comes from the armour, the emblem and the eyes â€” not from
   *     covering the frog in glow. There are exactly four lit colours on
   *     the whole model and three of them are hairlines.
   *  4. Everything is parented to the part it belongs to: the cuirass to
   *     `girth` so it breathes, the pauldrons to the shoulders so they
   *     swing, the shin guards to the shins. Armour bolted to the body
   *     slides over the animation and reads as a decal.
   *
   * Every offset below is checked against the shape it sits on. The torso
   * is an ellipsoid 0.52 x 0.46 x 0.46 at y 0.62; the head is 0.44 x 0.36 x
   * 0.42; the eyes are mounds of radius 0.23 at (Â±0.28, 0.26, 0.10) that
   * bulge to y 0.49. A plate that ignores those is a plate inside the frog.
   */
  _buildEclipse() {
    const M = this.mats;
    const b = this.body;
    const g = this.girth;
    const h = this.head;

    /** Where the cuirass ellipsoid's surface is, at a point on its face. */
    const CU = { x: 0.455, y: 0.30, z: 0.405, cy: 0.625, cz: 0.155 };
    const cuirassZ = (x, y) => {
      const k = 1 - (x / CU.x) ** 2 - ((y - CU.cy) / CU.y) ** 2;
      return CU.cz + CU.z * Math.sqrt(Math.max(0, k));
    };

    /**
     * â”€â”€ the headpiece â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Every gold fitting on the frog's own gear becomes silver. There is no
     * gold anywhere on this skin, and the brow plate sits dead centre of
     * the face â€” see `_goldTrim`.
     */
    for (const m of this._goldTrim || []) m.material = M.eclSilver;

    /**
     * A sleek fitted skullcap, not a hood.
     *
     * Low and tight: at x 0 it caps the skull to y 0.43, and by the time it
     * reaches the eyes at x 0.28 it has drawn down to 0.38 â€” under their
     * crown at 0.49 â€” so it hugs the head and leaves the face open, which
     * is what a fitted mask does and what a hood cannot.
     *
     * The RIM is what makes it read as a separate piece. Without it the cap
     * is the same darkness as the skull underneath and the two dissolve
     * into one blob; a band a shade lighter around its base draws the line
     * between helmet and head, which is the whole silhouette.
     */
    h.add(mesh(G.sphere, M.eclPlate, 0.455, 0.245, 0.405, 0, 0.185, -0.045));
    h.add(mesh(G.wrap, M.eclLip, 0.462, 0.028, 0.412, 0, 0.205, -0.045));
    // One silver seam front to back along the crest, clear of the cap's
    // crown at 0.430 so it sits ON the helmet rather than inside it.
    h.add(mesh(G.box, M.eclSilver, 0.030, 0.030, 0.34, 0, 0.437, -0.07));

    /**
     * Cheek guards, BELOW the eyes.
     *
     * The eye mounds span x 0.05 to 0.51 and reach down to y 0.03, so
     * anything at eye height and outboard of the skull is inside an
     * eyeball. At y -0.07 the mound is not there at all and the guard has
     * the side of the jaw to itself.
     *
     * There are no temple studs any more. Two silver chips floating beside
     * the eyes read as debris stuck to the face, and the brief asked for a
     * simple silhouette â€” the cap, the guards and one brow plate is the
     * whole headpiece.
     */
    for (const sx of [-1, 1]) {
      h.add(mesh(G.box, M.eclPlate, 0.050, 0.170, 0.215,
        sx * 0.368, -0.070, 0.045, 0, 0, sx * -0.13));
      // A hairline along the guard's top edge, in the LIP colour rather
      // than in silver: silver here reads as a chip stuck to the jaw, and
      // the face is allowed exactly one bright line â€” the brow plate.
      h.add(mesh(G.box, M.eclLip, 0.052, 0.016, 0.218,
        sx * 0.368, 0.014, 0.045, 0, 0, sx * -0.13));
    }

    /**
     * â”€â”€ the eyes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Silver-white, with a small violet centre. The default pupil is 0.105
     * x 0.135 and nearly fills the white; shrunk to 0.072 it becomes an
     * IRIS with sclera around it, which is what makes an eye read as
     * looking at something rather than as a hole.
     *
     * Deliberately not enlarged. The brief for this skin was "bright but
     * not enormous", and the frog's eyes are already big.
     */
    for (const e of this.eyes) {
      e.white.material = M.eclEye;
      e.pupil.material = M.eclIris;
      e.pupil.scale.set(0.082, 0.108, 0.082);
      e.pupil.position.z = 0.215;
    }

    // â”€â”€ chest: a fitted cuirass, standing a tenth proud of the torso â”€â”€â”€â”€
    //
    // In `girth`, with the belly and the gi, so a croak swells all three
    // together â€” see _buildTorso. Its nose lands at z 0.560 against the
    // belly's 0.530, so the pale belly stays behind it at every point.
    g.add(mesh(G.lowSphere, M.eclPlate, CU.x, CU.y, CU.z, 0, CU.cy, CU.cz));
    // The bevel along its top edge, and a gorget filling the neck gap
    // between the torso (0.443 at that height) and the skull (0.388).
    g.add(mesh(G.wrap, M.eclLip, 0.445, 0.030, 0.395, 0, 0.905, 0.145));
    b.add(mesh(G.wrap, M.eclPlate, 0.462, 0.085, 0.435, 0, 0.868, 0));
    b.add(mesh(G.wrap, M.eclSilver, 0.452, 0.020, 0.426, 0, 0.922, 0));

    /**
     * â”€â”€ THE ECLIPSE EMBLEM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * A dark disc with a thin crescent of light around most of it. Three
     * parts and about 0.3 units across: it is a maker's mark on a
     * breastplate, not a logo â€” the brief was explicit that it must not be
     * a giant glowing badge, and the crescent is the only part of it that
     * is lit at all.
     *
     * The crescent is rotated so its gap sits at the lower right, which is
     * what makes it read as something passing in FRONT of a light rather
     * than as a broken ring.
     *
     * `eclEmblem` is its own material because the emblem brightens when
     * the player moves or attacks and the cracks do not â€” see `update`.
     */
    const emY = 0.665;
    const emZ = cuirassZ(0, emY);
    g.add(mesh(G.cyl, M.eclVoid, 0.100, 0.020, 0.100, 0, emY, emZ + 0.012, Math.PI / 2));
    g.add(mesh(G.torus, M.eclSilver, 0.114, 0.114, 0.114, 0, emY, emZ + 0.006));
    g.add(mesh(G.arc, M.eclEmblem, 0.150, 0.150, 0.150, 0, emY, emZ + 0.002, 0, 0, 2.55));

    /**
     * â”€â”€ hairline cracks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Ancient energy leaking through the armour. Three on the chest, one
     * along each pauldron, one down each shin guard â€” seven lines, none
     * longer than a seventh of a unit, each sixty-thousandths thick.
     *
     * Every one sits on the surface of the plate it is on, computed rather
     * than eyeballed: a crack a hundredth of a unit inside an opaque
     * cuirass is not a crack.
     */
    for (const [x, y, len, tilt, mat] of [
      [-0.175, 0.745, 0.130, 0.42, M.eclCrackA],
      [0.205, 0.700, 0.105, -0.52, M.eclCrackB],
      [-0.240, 0.565, 0.090, -0.30, M.eclCrackA],
    ]) {
      g.add(mesh(G.box, mat, 0.016, len, 0.016, x, y, cuirassZ(x, y) + 0.008, 0, 0, tilt));
    }

    // â”€â”€ shoulders: small, angular, canted outward â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //
    // Flatter than the generic pauldron on purpose (0.095 tall against
    // 0.18). The brief asked for small angular pieces, and a dome twice
    // that height is the thing it asked to avoid.
    for (const arm of this.arms) {
      const sx = arm.side;
      const tilt = sx * 0.24;
      arm.shoulder.add(mesh(G.box, M.eclPlate, 0.245, 0.095, 0.225, 0, -0.035, 0, 0, 0, tilt));
      arm.shoulder.add(mesh(G.box, M.eclLip, 0.255, 0.022, 0.235, 0, -0.092, 0, 0, 0, tilt));
      arm.shoulder.add(mesh(G.box, M.eclSilver, 0.040, 0.028, 0.230,
        sx * 0.095, -0.010, 0, 0, 0, tilt));
      arm.shoulder.add(mesh(G.box, M.eclCrackB, 0.014, 0.018, 0.165,
        sx * 0.035, 0.016, 0, 0, 0, tilt));
      // Two silver bands over the forearm wraps. The forearm is a 0.10
      // capsule, so 0.118 clears it and reads as a band rather than a tube.
      arm.fore.add(mesh(G.wrap, M.eclSilver, 0.118, 0.020, 0.118, 0, -0.105, 0));
      arm.fore.add(mesh(G.wrap, M.eclSilver, 0.113, 0.017, 0.113, 0, -0.205, 0));
    }

    // â”€â”€ legs: a plate on the outer thigh, a guard down the shin â”€â”€â”€â”€â”€â”€â”€â”€â”€
    for (const leg of this.legs) {
      const sx = leg.side;
      leg.hip.add(mesh(G.box, M.eclPlate, 0.070, 0.150, 0.165,
        sx * 0.170, -0.130, -0.015, 0, 0, sx * 0.14));
      leg.shin.add(mesh(G.box, M.eclPlate, 0.125, 0.185, 0.055, 0, -0.140, 0.095, -0.05));
      leg.shin.add(mesh(G.box, M.eclLip, 0.130, 0.020, 0.050, 0, -0.048, 0.102, -0.05));
      leg.shin.add(mesh(G.box, M.eclCrackA, 0.013, 0.090, 0.013, 0, -0.150, 0.150, -0.05));
    }

    /**
     * â”€â”€ the charm on the belt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Two silver links and a tiny eclipse â€” the emblem again, a fifth of
     * the size. Its own group so it can swing a little in the idle, which
     * is most of what sells a hanging object as hanging.
     *
     * Hung at the front right hip and pushed clear of the gi, which is a
     * cylinder of radius 0.53 around the middle: at x 0.27 the gi's surface
     * is at z 0.456, so 0.40 would be inside it and 0.50 is not.
     */
    this.eclCharm = new THREE.Group();
    this.eclCharm.position.set(0.27, 0.455, 0.385);
    b.add(this.eclCharm);
    this.eclCharm.add(mesh(G.box, M.eclSilver, 0.020, 0.055, 0.020, 0, -0.032, 0));
    this.eclCharm.add(mesh(G.box, M.eclSilver, 0.018, 0.050, 0.018, 0, -0.080, 0));
    this.eclCharm.add(mesh(G.torus, M.eclSilver, 0.058, 0.058, 0.058, 0, -0.135, 0));
    this.eclCharm.add(mesh(G.cyl, M.eclVoid, 0.046, 0.016, 0.046, 0, -0.135, 0.008, Math.PI / 2));

    /**
     * â”€â”€ three fragments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Slow, and not always there. Each turns at about a fifth of a radian
     * a second â€” a lap takes half a minute â€” and runs a fade cycle of its
     * own, so at any moment one or two of the three are visible and
     * occasionally none are. That is the difference between a character
     * with fragments around it and a character inside a particle system.
     *
     * Faded by SCALE. See the note on the materials above.
     */
    this.eclFrags = [];
    for (let i = 0; i < 3; i++) {
      const size = 0.055 + (i % 2) * 0.018;
      const m = mesh(G.box, M.eclFrag, size, size * 1.35, size * 0.7, 0, 0, 0);
      m.castShadow = false;
      m.visible = false;
      b.add(m);
      this.eclFrags.push({
        mesh: m,
        size,
        a: (i / 3) * Math.PI * 2,
        /**
         * CLOSE IN. They orbit just off the shoulders, not in a wide ring
         * around the frog: at 0.95 the outermost was nearly a body-width
         * out and read as a halo of debris, which is the thing the brief
         * ruled out. At 0.68 they sit inside the silhouette the arms
         * already make, so the character's footprint is unchanged.
         */
        r: 0.64 + (i % 3) * 0.07,
        y: 0.68 + i * 0.17,
        spin: 0.19 + (i % 3) * 0.045,
        // Long, and coprime-ish, so the three never sync up into a pulse.
        period: 9.5 + i * 1.7,
        t: i * 3.1,
      });
    }

    /**
     * â”€â”€ five motes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Very tiny, drifting up and out. Three hundredths of a unit â€” at
     * arm's length they are a pixel â€” and a full rise takes four seconds,
     * so what you see is the occasional speck leaving the frog rather than
     * a column of smoke.
     */
    this.eclMotes = [];
    for (let i = 0; i < 5; i++) {
      const m = mesh(G.box, M.eclMote, 0.030, 0.030, 0.030, 0, 0, 0);
      m.castShadow = false;
      b.add(m);
      this.eclMotes.push({
        mesh: m,
        a: (i / 5) * Math.PI * 2,
        r: 0.22 + (i % 3) * 0.07,
        t: i / 5,
        rate: 0.21 + (i % 4) * 0.028,
      });
    }

    /**
     * â”€â”€ the distortion at the feet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     *
     * Two flat discs, the outer one nearly invisible. Parented to `lift`
     * rather than to `body`: `body` carries the breath and the hop, and a
     * shadow that bobs with the frog's chest is not on the ground.
     */
    this.eclShade = mesh(G.cyl, M.eclShade, 0.50, 0.010, 0.50, 0, 0.030, 0);
    this.eclShade.castShadow = false;
    this.lift.add(this.eclShade);
    this.eclShadeOut = mesh(G.cyl, M.eclShadeOut, 0.62, 0.008, 0.62, 0, 0.018, 0);
    this.eclShadeOut.castShadow = false;
    this.lift.add(this.eclShadeOut);

    // Idle gesture clock â€” see the note in `update`.
    this.eclipse = true;
    this.eclGestureIn = 7 + Math.random() * 7;
    this.eclGesture = 0;
  }

  /**
   * FROGATH THE DIVINE â€” the god's rig, at frog scale.
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
    // Phase 2 burns hotter â€” the wing membrane goes from gold to white.
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

  /**
   * â•â•â• THE EARTH SHELL â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * A boulder that closes over the frog.
   *
   * â”€â”€ built on first use, then kept â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   * Not in the constructor. Only one ability in four is Earth Shell and
   * only two may be carried at once, so most frogs in most matches never
   * raise one â€” and a dozen meshes that never render still cost every frog
   * in the room memory, a place in `setGhost`'s traversal, and a say in the
   * rig's bounding box. That last one is not hypothetical: an invisible
   * boulder is TALLER than a frog, so every measurement of the model
   * silently became a measurement of the shell.
   *
   * It is kept once built, because it is raised and dropped several times a
   * match and rebuilding it each time would hitch on exactly the frame the
   * player most needs it not to.
   *
   * It is a low-poly sphere with plates stuck to it rather than a smooth
   * dome: at this art scale a clean sphere reads as a bubble â€” a force
   * field â€” and the whole point of this ability rather than a parry is that
   * it is made of rock.
   *
   * Lives on the ROOT, not the body, so it does not bob, lean or swing with
   * whatever pose the frog was in when it went up. Stone does not bob.
   */
  _buildShell() {
    this.shell = new THREE.Group();
    this.shell.visible = false;

    /**
     * ── the stone ─────────────────────────────────────────────────────
     *
     * Weathered garden-ornament granite: a sage grey-green, not the brown
     * of a boulder. Three tones do the whole statue and the podium under
     * it — the mid for the mass, the pale for the surfaces the weather has
     * bleached, the dark for every recess.
     *
     * These are the exact three colours the hotbar icon is drawn in. That
     * is the point: see the note on the build below.
     */
    const stone = new THREE.MeshLambertMaterial({ color: 0x8b8f6f });
    const pale = new THREE.MeshLambertMaterial({ color: 0xa9ad8c });
    const dark = new THREE.MeshLambertMaterial({ color: 0x5d6149 });

    const S = this.shell;
    const add = (mat, sx, sy, sz, x, y, z) => {
      const m = mesh(G.box, mat, sx, sy, sz, x, y, z);
      S.add(m);
      return m;
    };

    /**
     * ═══ BUILT FROM THE ICON, RECTANGLE FOR RECTANGLE ══════════════════
     *
     * The statue is the hotbar icon in three dimensions, and it is laid
     * out in the icon's own coordinates so the two cannot drift apart.
     *
     * ── why it went back to slabs ─────────────────────────────────────
     * It was ellipsoids, and then smooth-shaded ellipsoids, and the
     * smoother it got the less it looked like stone: a rounded sage-green
     * mass reads as clay or putty, because nothing quarried is that soft.
     * Cut stone has FLAT FACES and hard edges that catch the light one at
     * a time — which is exactly what the icon draws, and exactly what the
     * rest of this game's art is made of.
     *
     * So every piece below is one rectangle of the 32×32 icon extruded to
     * a depth. `px`/`py` map icon pixels to world units and `slab` places
     * one; the numbers in each call are the `x y w h` of the matching
     * `<rect>` in `ITEM_ICONS.earthshell`, in the same order. Change the
     * icon and you can see at a glance what the model owes it.
     *
     * LOCAL +Z IS THE FRONT. `setFacing` puts the root at `yaw + Math.PI`,
     * so a point at +Z maps to the direction the frog is facing — which is
     * why the face, the hands and the feet are all at positive z.
     */
    const U = 0.052;                 // one icon pixel, in world units
    const POD = 0.32;                // the statue stands this high on its rock
    const px = (x, w) => (x + w / 2 - 16) * U;
    const py = (y, h) => (29 - (y + h / 2)) * U + POD;
    const slab = (mat, x, y, w, h, z, d) =>
      add(mat, w * U, h * U, d, px(x, w), py(y, h), z);

    /**
     * ── the mass, bottom to top ──
     *
     * THE FRONT FACES ARE FLUSH. All three courses have their front at
     * z = FACE, and the depth tapering happens entirely at the BACK.
     *
     * That is the whole trick to this build. The icon's courses are 28, 26
     * and 24 pixels wide — a seven per cent step each — and the first
     * attempt tapered the depth as well and set each course further back,
     * so from the front it stepped in and from three-quarters it stepped
     * back: a ziggurat, terrace by terrace, which is a temple and not a
     * frog. Flush at the front, it is the icon head-on, with the body
     * falling away behind the head the way a sitting frog's does.
     */
    const FACE = 0.55;
    const back = (d) => FACE - d / 2;
    slab(stone, 2, 18, 28, 6, back(1.34), 1.34);   // haunches, the widest
    slab(stone, 3, 15, 26, 10, back(1.14), 1.14);  // body
    slab(stone, 4, 8, 24, 7, back(0.94), 0.94);    // head
    /**
     * The eye mounds sit a little BEHIND the face, because a frog's eyes
     * are on top of its skull rather than on the front of it — and the
     * feet stand well in front of everything, which is what stops the
     * whole thing reading as one slab from the side.
     */
    const EYE = 0.42;
    slab(stone, 5, 4, 8, 5, EYE - 0.23, 0.46);     // eye mound, left
    slab(stone, 19, 4, 8, 5, EYE - 0.23, 0.46);    // eye mound, right
    slab(stone, 3, 25, 9, 4, 0.50, 0.62);          // foot, left
    slab(stone, 20, 25, 9, 4, 0.50, 0.62);         // foot, right

    // ── the bleached surfaces ──
    slab(pale, 6, 3, 6, 3, EYE - 0.17, 0.34);      // crown of the left eye
    slab(pale, 20, 3, 6, 3, EYE - 0.17, 0.34);     // and the right
    slab(pale, 7, 7, 18, 2, FACE + 0.03, 0.30);    // the brow course
    slab(pale, 4, 26, 7, 2, 0.78, 0.14);           // toes, left
    slab(pale, 21, 26, 7, 2, 0.78, 0.14);          // toes, right

    /**
     * ── the folded hands ──
     *
     * The one piece the icon can only hint at. On a 32-pixel sprite it is
     * a pale band across the belly; here it is a real block standing proud
     * of the body with a shadow line under it, because the folded hands
     * are what make this an ORNAMENT — a thing carved deliberately, sitting
     * patiently — rather than a frog-shaped rock.
     */
    slab(pale, 10, 18, 12, 3, FACE + 0.09, 0.28);
    slab(dark, 10, 21, 12, 1, FACE + 0.11, 0.24);
    // A thumb laid over each end of the pile, to break the straight edge.
    slab(stone, 10, 17, 3, 2, FACE + 0.09, 0.24);
    slab(stone, 19, 17, 3, 2, FACE + 0.09, 0.24);

    /**
     * ── the recesses ──
     *
     * Each one sits a few centimetres proud of the course it belongs to,
     * so it catches its own edge of light — written as an offset from that
     * course's front rather than as a number, because the first build of
     * this hard-coded the offsets and then moved the courses, which left
     * the mouth floating in front of the face and the brow buried inside
     * it.
     *
     * The mouth is DEEP. It is the single strongest line on the icon and
     * the thing that makes the face a face; at the depth of the other
     * details it washed out into the shadow under the brow.
     */
    slab(dark, 6, 9, 7, 1, EYE + 0.02, 0.16);      // lid crease, left
    slab(dark, 19, 9, 7, 1, EYE + 0.02, 0.16);     // and right
    slab(dark, 5, 12, 22, 2, FACE + 0.05, 0.26);   // the mouth

    /**
     * ═══ THE PODIUM ════════════════════════════════════════════════════
     *
     * Three courses of rough rock, each a little narrower than the one
     * below, with chips knocked off the corners.
     *
     * A garden ornament stands on something. Without it the statue's feet
     * met the grass at a hard line and it read as having been dropped
     * there; on a plinth it reads as having been PUT there, which is the
     * difference between a rock and a carving. It also gives the burst
     * something to come apart from.
     */
    add(stone, 1.78, 0.13, 1.54, 0, 0.065, 0.02);
    add(dark, 1.62, 0.09, 1.40, 0, 0.175, 0.02);
    add(pale, 1.46, 0.14, 1.26, 0, 0.28, 0.02);
    /**
     * Chips, on a fixed spiral rather than at random — two players using
     * the same ability must be standing on the same rock, or it reads as
     * two abilities. Same reasoning as the lichen that used to be here.
     */
    for (let i = 0; i < 10; i++) {
      const a = i * 2.399;                      // golden angle
      const t = i / 10;
      add(i % 3 === 0 ? dark : stone,
        0.16 + (i % 4) * 0.06, 0.09 + (i % 3) * 0.04, 0.16 + (i % 5) * 0.05,
        Math.cos(a) * 0.86, 0.05 + t * 0.22, Math.sin(a) * 0.74);
    }

    /**
     * ── the counter window, as cracks lighting up ─────────────────────
     *
     * The tell the ability is balanced around: an opponent is meant to be
     * able to see that a release is coming and step back, so it has to be
     * visible from outside and not only on the owner's HUD.
     *
     * Cracks rather than a glow shell. A statue lighting up along its
     * fault lines is about to come apart; a statue inside a bubble of
     * light is wearing a bubble of light.
     */
    const crackMat = new THREE.MeshBasicMaterial({
      color: 0xffc66b, transparent: true, opacity: 0, depthWrite: false,
    });
    this.shellCracks = [];
    // x, y, z, length, yaw, roll — laid along the statue's own courses.
    const CRACKS = [
      [0.00, 0.62, 0.68, 0.80, 0.0, 0.22],
      [-0.52, 0.80, 0.40, 0.58, -0.6, -0.80],
      [0.50, 0.76, 0.42, 0.58, 0.6, 0.90],
      [0.00, 0.80, -0.66, 0.76, 3.1, 0.18],
      [-0.70, 0.44, -0.20, 0.52, -1.3, -0.45],
      [0.68, 0.48, -0.22, 0.52, 1.3, 0.50],
      [0.00, 1.18, 0.56, 0.40, 0.0, 1.45],
    ];
    for (const c of CRACKS) {
      const m = mesh(G.box, crackMat, c[3], 0.035, 0.035, c[0], c[1], c[2], 0, c[4], c[5]);
      m.castShadow = false;
      S.add(m);
      this.shellCracks.push(m);
    }
    this.shellCrackMat = crackMat;

    this.root.add(this.shell);
    this._shellScale = 0;
  }

  /**
   * Raise, hold or drop the stone.
   *
   * The frog inside is hidden outright rather than left to clip through â€”
   * `setGhost(0)` is already the one path that fades the whole rig, so the
   * shell borrows it instead of introducing a second way to hide a frog.
   *
   * @param s { shell, shellHot }  up, and inside the counter window
   */
  _updateShell(dt, s) {
    // Nothing to build and nothing built: the overwhelmingly common case,
    // and it costs one comparison. See `_buildShell` for why it is lazy.
    if (!this.shell && !s.shell) return;
    if (!this.shell) this._buildShell();
    const want = s.shell ? 1 : 0;
    // Springs up fast, crumbles away faster â€” a shell that eased out slowly
    // would still be standing well after it stopped blocking anything.
    this._shellScale = damp(this._shellScale, want, want ? 14 : 22, dt);
    const up = this._shellScale > 0.02;
    this.shell.visible = up;
    if (!up) {
      // Whatever happened to the shell â€” crumbled, released, or the frog
      // died and it was dropped outright â€” the frog comes back.
      if (this.lift) this.lift.visible = true;
      return;
    }

    const k = this._shellScale;
    /**
     * It SETTLES. A touch of overshoot on the way up, taken out of the
     * height rather than the width, so the statue drops the last inch and
     * squats rather than inflating like a balloon.
     *
     * And it does not turn. The boulder this replaced span slowly, which
     * was fine for a rock and is wrong for a carving: a statue that rotates
     * is a prop on a turntable. It holds the frog's own facing â€” the face,
     * the folded hands and the feet are all built toward local +Z, which
     * `setFacing` has already pointed the way the player was looking.
     */
    /**
     * A shade bigger than the frog it swallowed. The carving is built at
     * roughly 1.5 units across, against a frog about 1.0 wide â€” this takes
     * it to 1.7, which is enough for the statue to read as something the
     * frog is INSIDE rather than as a frog wearing a costume, without
     * making it big enough to clip through the scenery it sits in.
     */
    const SIZE = 1.15;
    const drop = Math.sin(Math.min(1, k) * Math.PI) * 0.10 * want;
    const w = k * SIZE * (1 + drop * 0.35);
    this.shell.scale.set(w, k * SIZE * (1 - drop), w);

    /**
     * Hide the frog once the stone has actually closed, not before.
     *
     * `lift` is the whole rig â€” torso, head, limbs, gear â€” and leaves the
     * nameplate (which hangs off the root) alone, so a sealed opponent can
     * still be identified. The 0.8 threshold is what keeps the frog visible
     * through the raise and the crumble; popping it out at the first frame
     * would make the shell look like it spawned instead of closing.
     */
    if (this.lift) this.lift.visible = k < 0.8;

    /**
     * The fault lines light up when the counter window opens.
     *
     * One shared material, so seven cracks cost one opacity write a frame
     * rather than seven â€” and so they can never drift out of step with each
     * other, which would read as flickering rather than as pulsing.
     */
    if (this.shellCrackMat) {
      const hot = s.shellHot ? 1 : 0;
      const pulse = 0.55 + Math.abs(Math.sin(this.t * 9)) * 0.45;
      this.shellCrackMat.opacity = damp(
        this.shellCrackMat.opacity, hot * pulse, 16, dt);
    }
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
   * see past â€” foliage, water â€” so a tree is cover, not an invisibility
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
      // Eyes close the same way a blink closes them â€” uniformly, to the
      // radius that just swallows the eyeball. Driving scale.y alone left the
      // lid a needle now that the other two axes are a speck, and it was a
      // four-times-oversized ellipsoid before that.
      for (const e of this.eyes) e.lid.scale.setScalar(damp(e.lid.scale.x, LID_SHUT, 12, dt));
      this.tongue.visible = false;
      // Dying drops the stone. It is not a coffin, and a boulder standing
      // over a corpse would keep blocking shots that should now go through.
      this._updateShell(dt, { shell: false, shellHot: false });
      return;
    }
    this.root.rotation.z = damp(this.root.rotation.z, 0, 10, dt);

    const speed = s.speed || 0;
    const moving = s.moving && s.grounded;

    /**
     * Is the frog standing still with nothing else going on?
     *
     * Every other state is listed here rather than relying on the pose chain
     * below, because the stance also moves the BODY â€” and the body is posed
     * before any of those branches get a say. Anything that is its own
     * animation wins: attacking, dashing, jumping, falling, grappling,
     * throwing, parrying, swimming, sliding a wall. When one ends this goes
     * true again on its own and the frog settles back into guard, damped like
     * everything else, so there is nothing to schedule or cancel.
     */
    const stance = s.grounded && !moving && !s.swimming
      && !(s.dashT > 0) && !(s.attackT > 0) && !(s.throwT > 0)
      && !s.grappling && !s.parrying && !s.wallSliding && this.flip <= 0;
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
    // half of every cycle â€” which is precisely what it used to do.
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
    // Only on the ground â€” mid-air keeps the normal tuck so jumps read clearly.
    const ninjaRun = s.sprinting && moving && !s.swimming;
    if (ninjaRun) {
      targetLean = 1.02;
      targetSquash = 1.06;
      targetY = hop * 0.45 + 0.16;
      targetRoll = 0;
    } else if (moving && !s.swimming) {
      targetLean = lerp(targetLean, 0.16 * run, 0.8);
    }

    /**
     * Stepping up onto something.
     *
     * `climbing` comes from the collision: it is 1 on the frame a ledge was
     * walked onto and fades over about a fifth of a second, so a staircase
     * taken at a run holds it near 1 the whole way up and a single kerb gets
     * one pulse of it.
     *
     * The pose is additive on whatever the run cycle is already doing rather
     * than a branch of its own, because you climb WHILE running and the
     * stride has to keep going underneath. The frog leans into the step, the
     * body rises, and the lead knee comes up further down in the leg pass â€”
     * a reach, which is what makes the climb read as effort rather than the
     * frog being teleported upward.
     */
    const climb = clamp(s.climbing || 0, 0, 1);
    if (climb > 0 && s.grounded && !s.swimming && !s.dashT) {
      // Sine rather than the raw value: full at the moment of the step, and
      // easing out instead of falling off a cliff at the end of the fuse.
      const c = Math.sin(climb * Math.PI * 0.5);
      targetLean += 0.26 * c;
      targetY += 0.09 * c;
      targetSquash += 0.05 * c;
    }

    /**
     * The ninja stance. Weight low and forward, and never quite still.
     *
     * The idle motion is several slow sines at frequencies that do not divide
     * into each other â€” breath, a weight shift, a settle â€” so the pose keeps
     * drifting instead of ticking round a loop. There are no keyframes to
     * wrap, so there is no seam to hide.
     *
     * `_stanceDrop` is handed to the floor clamp at the end of update: it is
     * how far the body is ALLOWED below its origin, being exactly what the
     * bent knees gave up.
     */
    this._stanceDrop = 0;
    let stanceBend = 0;
    if (stance) {
      const settle = Math.sin(t * 0.83) * 0.018;
      targetLean = 0.26 + settle;
      targetSquash = 1.02;
      /**
       * The crouch follows how far the knees have ACTUALLY folded, not the
       * pose being aimed at.
       *
       * Bending a knee lifts that foot toward the hip and the body comes down
       * to meet it â€” but the body reaches its target sooner than the legs
       * reach theirs, so committing to the full drop the moment the frog
       * stops walking pushes the soles through the floor for the length of
       * the transition. That is the feet-in-the-ground bug this rig has had
       * before, and this is what stops it coming back: the drop can never run
       * ahead of the legs that earned it.
       */
      stanceBend = clamp(
        (this.legs[0].shin.rotation.x - 0.85) / (STANCE.leadShin - 0.85), 0, 1);
      // Breath rides on top of the crouch rather than either side of it.
      targetY = idleBob * 0.55 - STANCE_DROP * stanceBend;
      targetRoll = Math.sin(t * 0.61) * 0.020;
      this._stanceDrop = STANCE_DROP * stanceBend;
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
        // Tuck the legs up â€” classic frog leap silhouette.
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
      } else if (stance) {
        // Guard: knees deep, left foot forward, right heel back and light.
        // The weight rocks slowly between them, which is most of what makes
        // a held pose look like a person rather than a statue.
        const shift = Math.sin(t * 0.62) * 0.055;
        const fwd = leg.side < 0 ? 1 : -1;        // left leg leads
        hipX = STANCE.hip - fwd * (STANCE.stagger + shift);
        shinX = fwd > 0 ? STANCE.leadShin : STANCE.rearShin;
      } else {
        hipX = -0.42;              // resting frog crouch
        shinX = 0.85;
      }
      /**
       * The reach for the step. See the `climb` block above.
       *
       * Only the LEADING leg â€” whichever is swinging forward this instant â€”
       * so it looks like one foot being placed on the tread rather than both
       * knees rising together, which reads as a crouch. Off the same phase
       * the stride uses, so it stays in time with the walk.
       */
      if (climb > 0 && s.grounded && !s.swimming) {
        const lead = clamp(-phase, 0, 1) * Math.sin(climb * Math.PI * 0.5);
        hipX -= 0.42 * lead;
        shinX += 0.55 * lead;
      }
      leg.hip.rotation.x = damp(leg.hip.rotation.x, hipX, 20, dt);
      leg.shin.rotation.x = damp(leg.shin.rotation.x, shinX, 20, dt);
      // Legs splay wide on the power stroke â€” the classic frog kick shape.
      const splay = s.swimming ? 0.30 + Math.max(0, kick) * 0.62
        : (stance ? 0.30 : 0.22);
      leg.hip.rotation.z = damp(leg.hip.rotation.z, leg.side * splay, 10, dt);
      // Feet flat to the ground in the stance. The default ankle follows the
      // shin at 0.6, which in a deep crouch drives the toe down hard and digs
      // it into the floor â€” the toe, not the knee, is what limits how low the
      // frog can get. Cancelling the whole chain (lean + hip + knee) lands the
      // sole flat instead, and the rear heel is allowed to lift the way a back
      // foot does in a real stance.
      let footX = s.grounded ? -leg.shin.rotation.x * 0.6 : -0.6;
      if (stance) {
        footX = -(this.lean + leg.hip.rotation.x + leg.shin.rotation.x);
      }
      leg.foot.rotation.x = damp(leg.foot.rotation.x, footX, 16, dt);
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
        } else if (s.reachT > 0 && arm.side > 0) {
          /**
           * Reaching out and back â€” a hand on the lid, the lever, the hilt.
           *
           * Out and in over the same gesture, so the arm is extended on the
           * beat the thing it is touching starts to move and back by its
           * side once the animation has taken over. Right arm only; the left
           * keeps whatever it was doing.
           */
          const k = 1 - s.reachT;                  // 0 -> 1 over the reach
          const e = Math.sin(k * Math.PI);         // out, then back
          sx = lerp(0.08, -1.42, e);
          sz = arm.side * lerp(0.24, 0.06, e);
          fx = lerp(-0.5, -0.16, e);
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
        } else if (stance) {
          // Both elbows folded, hands up. The rig's arms hang along -Y and a
          // negative x-rotation swings them FORWARD, so the lead arm carries
          // the larger angle.
          //
          // The sword hand is the right one (see _poseAttack), so that is the
          // one held back by the hip with the katana on the back behind it â€”
          // cocked to draw rather than waving about in front.
          const breath = Math.sin(t * 1.9) * 0.025;
          const sway = Math.sin(t * 0.74) * 0.045;
          if (arm.side < 0) {
            sx = -1.04 + breath + sway;          // lead hand, up and forward
            sz = arm.side * 0.15;
            fx = -1.22 - breath;
          } else {
            sx = -0.28 + breath - sway;          // sword hand, back at the hip
            sz = arm.side * 0.32;
            fx = -1.52 + breath;
          }
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
    if (stance) {
      // Cancel most of the stance's forward pitch so the frog is watching
      // you rather than the floor, and let the head drift a hair â€” a fighter
      // reading the room, not scanning it.
      headTiltX = -this.lean * 0.82 + Math.sin(t * 0.80) * 0.022;
      headTiltY = Math.sin(t * 0.43) * 0.065;
    }
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
    /**
     * THE FORGOTTEN ONE occasionally looks up.
     *
     * Fired from `_animateEclipse` on a seven-to-fourteen second clock and
     * only while standing, so it reads as a thought rather than a loop. It
     * is ADDED to whatever the head was going to do and then damped like
     * everything else, so there is nothing to cancel when the frog starts
     * moving mid-gesture â€” the target simply changes underneath it.
     *
     * Small on purpose: 0.26 radians is about fifteen degrees. A calm,
     * extremely powerful character glances at the sky; it does not perform.
     */
    if (this.eclGesture > 0) {
      const k = Math.sin(this.eclGesture * Math.PI);
      headTiltX -= 0.26 * k;
      headTiltY += 0.10 * k;
    }
    this.head.rotation.x = dampAngle(this.head.rotation.x, headTiltX, 12, dt);
    this.head.rotation.y = dampAngle(this.head.rotation.y, headTiltY, 12, dt);

    // Skin extras that live rather than sit there: haloes turn, the aura
    // breathes. Cheap, and it is what makes a legendary read as special
    // rather than as a differently-coloured frog.
    /**
     * A whole halo turns steadily. A broken one labours.
     *
     * Half the speed with a wobble on the tilt, so it reads as something
     * that is still trying to work rather than as a ring that happens to
     * have a gap in it. The spin is on the ring's OWN axis â€” Three.js
     * composes Euler XYZ as RxÂ·RyÂ·Rz, so the z term is innermost and turns
     * the torus within its own plane, leaving the tilt intact.
     */
    if (this.halo) this.halo.rotation.z += dt * (this._haloBroken ? 0.42 : 0.9);
    if (this._haloBroken && this.halo) {
      this.halo.rotation.x = this._haloTilt + Math.sin(t * 1.1) * 0.07;
    }
    if (this.halo2) this.halo2.rotation.z -= dt * 0.6;
    this._updateWings(dt, s);
    if (this.bodyAura) {
      this.bodyAura.material.opacity = 0.11 + Math.sin(t * 2.4) * 0.04;
    }
    /**
     * Orbiting fragments. Each rides its own ring at its own rate, and bobs
     * on a phase taken from its starting angle â€” a single shared rate would
     * make them a rigid wheel, and the whole point is that they float.
     */
    if (this.shards) {
      for (const s of this.shards) {
        s.a += dt * s.spin;
        s.mesh.position.set(
          Math.cos(s.a) * s.r,
          s.y + Math.sin(t * 1.7 + s.a) * s.bob,
          Math.sin(s.a) * s.r,
        );
        s.mesh.rotation.y += dt * 1.6;
        s.mesh.rotation.x += dt * 1.1;
      }
    }
    /**
     * Embers: each spark rises from the hip to over the head and restarts.
     *
     * Fading is done with SCALE, not opacity, because all nine share one
     * material â€” nine materials to fade nine cubes independently would be
     * nine draw calls for something the size of a pixel at arm's length.
     *
     * `size` is the spark's own build scale and the fade MULTIPLIES it.
     * `setScalar(k)` alone replaced it, which turned nine 0.05 sparks into
     * nine unit cubes and buried the frog in slabs of light.
     */
    if (this.embers) {
      for (const e of this.embers) {
        e.t += dt * e.rate;
        if (e.t >= 1) e.t -= 1;
        e.a += dt * 0.5;
        const k = 1 - e.t;
        e.mesh.position.set(
          Math.cos(e.a) * e.r * (0.7 + e.t * 0.5),
          0.24 + e.t * 1.55,
          Math.sin(e.a) * e.r * (0.7 + e.t * 0.5),
        );
        e.mesh.scale.setScalar(e.size * Math.max(0.12, k * k));
        e.mesh.rotation.y += dt * 2.4;
      }
    }
    // The same, around the blade. Local to the weapon pivot, so they follow
    // it through the swing instead of hanging in the air where it used to be.
    const bs = this.katana && this.katana.userData.shards;
    if (bs) {
      for (const s of bs) {
        s.a += dt * s.spin;
        s.mesh.position.set(Math.cos(s.a) * s.r, s.y, Math.sin(s.a) * s.r);
        s.mesh.rotation.y += dt * 2.2;
      }
    }
    if (this.eclipse) this._animateEclipse(dt, t, s, stance, speed);
    if (this.divine) this._animateDivine(dt, t);
    if (this.fx.emblem) this._animateKeystone(dt, t, s, stance, speed);

    // Throat pulse â€” a frog is never quite still.
    this.croakPulse = damp(this.croakPulse, 0, 6, dt);
    const throat = 1 + Math.sin(t * 3.1) * 0.03 + this.croakPulse * 0.25;
    // Breathe the whole midsection, so the gi and the sash swell with the
    // belly instead of the belly pumping through them.
    //
    // Width through the group. Its Y is left alone on purpose: the group sits
    // at the body's origin, so scaling that would carry every child's HEIGHT
    // as well as its size and ride the gi up the chest on each breath.
    this.girth.scale.set(throat, 1, throat);
    // Height on each mesh's OWN scale instead, which grows it about its own
    // centre and moves nothing. The gi has to grow with the belly here too:
    // breathing the belly upward against a shirt of fixed height pushed it
    // out through the top of the gi â€” 0.04 proud at rest, 0.18 at full croak,
    // a pale bubble surfacing at the chest for the few frames of the pulse.
    // The gi's centre sits above the belly's, so growing both by the same
    // factor keeps its top edge permanently clear of the belly's.
    //
    // Note the doubling. The belly is a sphere, so its scale.y is a RADIUS;
    // the gi is a cylinder, so its scale.y is a full HEIGHT. Feeding both the
    // same number moves the gi's edges half as far as the belly's, which is
    // why matching the scales still let the bubble grow. Twice the belly's
    // change moves both edges together, so the amount of belly showing past
    // the band stays exactly what it is at rest.
    //
    // Three, not two, because the belly's VISIBLE top climbs faster than its
    // geometric one: inflating also pushes it further out of the green torso,
    // so it surfaces from the chest higher up than its own crown moves. Two
    // held the lower edge exactly but still let a pale bubble creep out above
    // the band. Three holds both, and the test pins it.
    const bellyR = 0.34 * throat;
    this.bellyM.scale.y = bellyR;
    this.giM.scale.y = GI_H + 3 * (bellyR - 0.34);

    // Jaw opens while the tongue is out.
    const jawOpen = s.grappling ? 0.55 : 0;
    this.jaw.rotation.x = damp(this.jaw.rotation.x, jawOpen, 22, dt);

    // ---- blink -----------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blink = 1; this.blinkTimer = 2.2 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 7);
    // The lid grows over the eyeball and shrinks back inside it. Uniform, so
    // there is never a flat disc lying across the white â€” see _buildHead.
    const lidR = 0.002 + Math.sin(this.blink * Math.PI) * (LID_SHUT - 0.002);
    for (const e of this.eyes) e.lid.scale.setScalar(lidR);

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

    // ---- keep the frog out of the floor ----------------------------------
    // Last line of defence. The body's origin is the soles of the feet and
    // sits exactly on the ground, so ANY animation that pushes the body
    // below zero buries the legs in the terrain. Rather than trusting every
    // pose to remember that, it is enforced once, here, after all of them.
    //
    // Only while upright and on the ground: the death keel-over and the swim
    // pose both move the body deliberately, and neither is standing on
    // anything.
    //
    // The floor is the CROUCH, not zero. A stance that bends the knees pulls
    // the feet up toward the hips, so the body must come down by exactly that
    // much or the frog stands on air; clamping at zero would throw the ninja
    // guard away every frame. `_stanceDrop` is that much and nothing more, so
    // this still refuses any pose that would sink the legs into the ground.
    const floor = -(this._stanceDrop || 0);
    if (s.grounded && !s.dead && !s.swimming && this.body.position.y < floor) {
      this.body.position.y = floor;
    }

    // ---- tongue ----------------------------------------------------------
    this._updateTongue(dt, s);

    // ---- earth shell -----------------------------------------------------
    this._updateShell(dt, s);
  }

  /**
   * â•â•â• THE FORGOTTEN ONE, MOVING â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * Six small things, none of which is a particle system:
   *
   *   the eyes shimmer        a slow brightening of the iris, nothing else
   *   the emblem answers      brighter while moving or attacking
   *   the cracks pulse        two hairline sets, out of phase
   *   three fragments drift   in and out, at a fifth of a radian a second
   *   five motes rise         a speck at a time
   *   the ground distorts     two discs, breathing
   *
   * Plus the gesture clock, read by the head block in `update`.
   *
   * Everything animated here is a COLOUR or a SCALE. Nothing writes
   * `opacity`, because `setGhost` owns that â€” see the note on the materials
   * in the constructor.
   */
  _animateEclipse(dt, t, s, stance, speed) {
    const M = this.mats;

    /**
     * The iris. A slow breath between two-thirds and full, which at this
     * size is a shimmer rather than a blink â€” the eye stays lit the whole
     * time and only its intensity moves.
     *
     * Both eyes share the material and therefore shimmer together, which is
     * correct: two eyes catching the light independently reads as a fault.
     */
    const shimmer = 0.68 + (0.5 + Math.sin(t * 1.45) * 0.5) * 0.32;
    M.eclIris.color.copy(this._eclEnergy).multiplyScalar(shimmer);

    /**
     * The emblem answers the player.
     *
     * Dim while standing, brighter while moving, brightest through a swing.
     * `attackT` counts down through the swing, so it is at its strongest on
     * the frame the blade starts moving and has faded by the recovery.
     *
     * The range is deliberately narrow â€” 0.55 to 1.25 of the base colour.
     * The brief was that the emblem should become SLIGHTLY brighter, and an
     * emblem that switches from dark to blazing is a light, not a mark.
     */
    const run = clamp(speed / 12, 0, 1);
    const swing = clamp(s.attackT || 0, 0, 1);
    const emb = 0.55 + run * 0.30 + swing * 0.40
      + Math.sin(t * 0.9) * 0.05;
    M.eclEmblem.color.copy(this._eclEnergy).multiplyScalar(emb);

    /**
     * The cracks. Two sets on long, unequal periods, so what you see is one
     * line somewhere on the armour coming up as another goes down â€” energy
     * moving through it rather than a row of lamps on a timer.
     *
     * They bottom out at a quarter rather than at zero: a crack that goes
     * out entirely leaves the armour looking chipped.
     */
    M.eclCrackA.color.copy(this._eclEnergy)
      .multiplyScalar(0.28 + (0.5 + Math.sin(t * 0.62) * 0.5) * 0.72);
    M.eclCrackB.color.copy(this._eclEnergy)
      .multiplyScalar(0.28 + (0.5 + Math.sin(t * 0.47 + 2.2) * 0.5) * 0.72);

    /**
     * Fragments. Each runs its own cycle: a long hidden stretch, then a
     * fade up, a while orbiting, and a fade down. `k` is the visible
     * fraction, and it multiplies the build scale rather than replacing it
     * â€” the same mistake the embers made once, which turned nine specks
     * into nine unit cubes.
     */
    for (const f of this.eclFrags) {
      f.t += dt;
      if (f.t >= f.period) f.t -= f.period;
      f.a += dt * f.spin;
      /**
       * Visible for the middle 44% of the cycle, easing in and out.
       *
       * Measured, not guessed: at 56% all three were up together 36% of
       * the time, which is a permanent ring by another name. At 44% that
       * falls to 22%, the average drops from 1.64 fragments to 1.27, and
       * for better than a third of the time there are none at all â€” so
       * the usual sight is one fragment, occasionally two.
       */
      const p = f.t / f.period;
      let k = 0;
      if (p > 0.28 && p < 0.72) k = Math.sin(((p - 0.28) / 0.44) * Math.PI);
      f.mesh.visible = k > 0.02;
      if (!f.mesh.visible) continue;
      f.mesh.position.set(
        Math.cos(f.a) * f.r,
        f.y + Math.sin(t * 0.7 + f.a) * 0.055,
        Math.sin(f.a) * f.r,
      );
      f.mesh.rotation.y += dt * 0.42;
      f.mesh.rotation.x += dt * 0.27;
      f.mesh.scale.set(f.size * k, f.size * 1.35 * k, f.size * 0.7 * k);
    }

    // Motes: one rise each, staggered, fading out by scale near the top.
    for (const m of this.eclMotes) {
      m.t += dt * m.rate;
      if (m.t >= 1) m.t -= 1;
      m.a += dt * 0.22;
      const k = 1 - m.t;
      m.mesh.position.set(
        Math.cos(m.a) * m.r * (0.85 + m.t * 0.55),
        0.26 + m.t * 1.20,
        Math.sin(m.a) * m.r * (0.85 + m.t * 0.55),
      );
      m.mesh.scale.setScalar(0.030 * Math.max(0.05, k * k));
    }

    /**
     * The ground. Two discs turning against each other and breathing, which
     * at this opacity reads as the air over the frog's feet being wrong
     * rather than as smoke coming off it.
     *
     * It tightens when the frog moves: a distortion that stays the same
     * size whatever the player does is a decal on the floor.
     */
    if (this.eclShade) {
      const br = 1 + Math.sin(t * 1.1) * 0.06 - run * 0.18;
      this.eclShade.scale.set(0.50 * br, 0.010, 0.50 * br);
      this.eclShade.rotation.y += dt * 0.25;
      this.eclShadeOut.scale.set(0.62 * br * 1.04, 0.008, 0.62 * br * 1.04);
      this.eclShadeOut.rotation.y -= dt * 0.16;
    }

    // The charm swings a little, and more when the frog is moving.
    if (this.eclCharm) {
      const sway = Math.sin(t * 2.1) * 0.10 + Math.sin(this.stride) * 0.22 * run;
      this.eclCharm.rotation.x = damp(this.eclCharm.rotation.x, sway, 9, dt);
      this.eclCharm.rotation.z = damp(this.eclCharm.rotation.z,
        Math.sin(t * 1.6) * 0.07, 7, dt);
    }

    /**
     * The gesture clock: a glance upward, every seven to fourteen seconds,
     * and only while genuinely standing still.
     *
     * The countdown runs ONLY in stance, so a player who is moving is not
     * quietly accruing gestures that all fire the moment they stop. The
     * gesture itself is allowed to finish whatever happens â€” it is a
     * quarter-radian offset that damps out on its own if the frog starts
     * running mid-glance.
     */
    if (this.eclGesture > 0) {
      this.eclGesture = Math.max(0, this.eclGesture - dt * 0.5);
    } else if (stance) {
      this.eclGestureIn -= dt;
      if (this.eclGestureIn <= 0) {
        this.eclGesture = 1;
        this.eclGestureIn = 7 + Math.random() * 7;
      }
    }
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
      // â€” translating instead drove the whole frog 0.12 into the floor.
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

    /**
     * THE MOUTH, TAKEN FROM THE RIG — not assumed.
     *
     * This used to be a constant offset from the root, `(0, 1.42 + _lift,
     * 0.30)`, which is where the mouth is when the frog is standing
     * perfectly square and looking straight ahead. It is almost never doing
     * that while grappling: the head TILTS to look along the tongue (see
     * `headTiltX/Y` in `update`), the body bobs and leans, and the jaw drops
     * open as the tongue fires. The constant follows none of it.
     *
     * Measured against the real rig, the gap ran from 0.41 units to 0.78 —
     * on a frog 1.75 tall that is a third to nearly half its height, always
     * too high and never turning with the head. On screen the tongue left
     * from somewhere around the shoulder.
     *
     * Reading the jaw's own world matrix fixes all of it at once and cannot
     * drift again: if the head moves, the mouth moves, because it IS the
     * mouth. `updateWorldMatrix` because this runs inside the animation
     * update, before the renderer has refreshed the graph — without it the
     * tongue would lag the head by a frame.
     */
    this.jaw.updateWorldMatrix(true, false);
    const from = new THREE.Vector3(0, -0.02, 0.20).applyMatrix4(this.jaw.matrixWorld);
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
      // applied to it â€” force setGhost to run over the rig again.
      this._ghost = undefined;
    }
    if (this.tagMarker) this.tagMarker.visible = v;
  }

  /**
   * Point the frog along a gameplay yaw.
   *
   * The rig is modelled facing +Z (eyes, mouth and toes are all at positive
   * Z, scarf and sheath trail at negative Z), while gameplay yaw points along
   * -Z â€” so the half-turn here is what stops the frog from running backwards
   * and staring into the camera. Always set facing through this method.
   */
  setFacing(yaw) {
    this.root.rotation.y = yaw + Math.PI;
  }

  /** Called by the player controller the moment a double jump starts. */
  triggerFlip() { this.flip = 1; }
  /** Little throat puff â€” used on jumps and croaks. */
  croak() { this.croakPulse = 1; }

  /**
   * Fade the ENTIRE frog â€” used while invisibility is up, and by the shadow
   * clone when its owner is invisible.
   *
   * Walks the whole rig rather than just `this.mats`, because parts of the
   * model carry their own materials: the nameplate sprite and the "it"
   * marker. Fading only the body left those floating at full strength, which
   * defeats the point â€” a name tag hanging over thin air is worse than no
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

  /**
   * â•â•â• PUT A DIFFERENT WEAPON IN THE FROG'S HAND â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   *
   * Called when the equipped weapon changes â€” see `applyStats` in
   * js/overworld.js. Twenty weapons in the gear table were all being drawn
   * as the same katana, so buying the Quarry Maul changed a number in the
   * bag and nothing else in the world.
   *
   * It REBUILDS the group rather than swapping meshes inside it, because
   * the nine shapes `buildKatana` makes have different part counts â€” a maul
   * has a haft and a block where a sabre has seven stacked segments â€” and
   * there is no sensible correspondence to morph between. Rebuilding costs
   * about twenty meshes and happens when a player equips something, which
   * is a menu action and not a frame.
   *
   * â”€â”€ what it keeps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   * The pivot's transform. `this.katana` is animated every frame by the
   * swing code and parked in the sheath pose between swings, so a fresh
   * group at the origin would put the weapon through the frog's chest until
   * the next animation frame wrote over it. Copied across explicitly.
   *
   * â”€â”€ the materials â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   * The four the weapon colours live in are REPLACED, not edited, and the
   * old ones are disposed. They cannot simply be recoloured: a glowing
   * blade is a `MeshBasicMaterial` and a steel one is a `MeshLambertMaterial`
   * â€” a bar of light is a light source, not a thing the world lights â€” so
   * FROGSHIN and the Reed Knife need different material classes, not
   * different values in the same one.
   *
   * `saya` follows the grip so the scabbard on the frog's back stays part of
   * the same object, and `same` follows the guard for the same reason.
   */
  setWeapon(look) {
    if (!look || !this.katana) return;
    const M = this.mats;
    const kill = (m) => { if (m) m.dispose(); };

    kill(M.steel);
    M.steel = look.glow
      ? new THREE.MeshBasicMaterial({ color: look.blade })
      : new THREE.MeshLambertMaterial({
        color: look.blade, emissive: look.glowTint || 0x2a3038,
      });
    kill(M.edge);
    M.edge = look.glow
      ? new THREE.MeshBasicMaterial({ color: look.edge })
      : new THREE.MeshLambertMaterial({ color: look.edge });
    kill(M.gold);
    M.gold = new THREE.MeshLambertMaterial({ color: look.guard });
    kill(M.grip);
    M.grip = new THREE.MeshLambertMaterial({ color: look.grip });
    kill(M.same);
    M.same = new THREE.MeshLambertMaterial({ color: look.guard });
    kill(M.saya);
    M.saya = new THREE.MeshLambertMaterial({
      color: new THREE.Color(look.grip).multiplyScalar(1.15),
    });
    if (look.runes) {
      kill(M.rune);
      M.rune = new THREE.MeshBasicMaterial({ color: look.runes });
    }
    if (look.aura) {
      kill(M.aura);
      M.aura = new THREE.MeshBasicMaterial({
        color: look.aura, transparent: true, opacity: 0.22, depthWrite: false,
      });
    }
    if (look.tassel) {
      kill(M.tassel);
      M.tassel = new THREE.MeshLambertMaterial({ color: look.tassel });
    }
    if (look.orbit) {
      kill(M.bladeShard);
      M.bladeShard = new THREE.MeshBasicMaterial({ color: look.orbit });
    }

    // The sheath is made of the same materials, so it re-tints for free â€”
    // but its meshes hold references to the OLD ones, so it is rebuilt too.
    for (const child of this.sheath.children.slice()) {
      if (child.geometry && !Object.values(G).includes(child.geometry)) {
        child.geometry.dispose();
      }
      this.sheath.remove(child);
    }
    this.sheath.add(mesh(G.box, M.saya, 0.085, 0.80, 0.15, 0, 0.30, 0));
    this.sheath.add(mesh(G.box, M.gold, 0.095, 0.05, 0.16, 0, 0.68, 0));
    this.sheath.add(mesh(G.box, M.gold, 0.092, 0.045, 0.158, 0, -0.08, 0));
    this.sheath.add(mesh(G.cyl, M.grip, 0.10, 0.05, 0.17, 0, 0.60, 0));

    const old = this.katana;
    const pos = old.position.clone();
    const rot = old.rotation.clone();
    const scl = old.scale.clone();
    this.body.remove(old);
    old.traverse((o) => {
      if (o.geometry && !Object.values(G).includes(o.geometry)) {
        o.geometry.dispose();
      }
    });

    this.swordFx = look;
    this.katana = buildKatana(M, look);
    this.blade = this.katana.userData.blade;
    this.katana.position.copy(pos);
    this.katana.rotation.copy(rot);
    this.katana.scale.copy(scl);
    this.body.add(this.katana);
    /** What is in the hand, so the tests and the HUD can ask. */
    this.weaponLook = look;
  }

  dispose() {
    const shared = Object.values(G);
    const seen = new Set();
    this.root.traverse((o) => {
      if (o.geometry && !shared.includes(o.geometry)) o.geometry.dispose();
      // Sweep every material, not just this.mats â€” the nameplate sprite and
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
