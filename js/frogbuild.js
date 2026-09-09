/**
 * A FROG, BUILT PROPERLY — and one frog for the whole game to share.
 *
 * There were three separate frogs in this codebase before this file: the
 * player's own rig in frog.js, the villagers in citizen.js, and — the
 * problem — a hand-rolled sphere-and-box approximation in every crowd
 * scene. Those approximations were, accurately, blobs. Four hundred blobs on
 * the heavenly battlefield and two hundred and forty kneeling blobs in the
 * coronation hall, in a game whose entire identity is that everybody in it
 * is a frog.
 *
 * So: one builder, instanced, with real anatomy.
 *
 * ── what makes a frog read as a frog ─────────────────────────────────────
 * Four things, and none of them is optional:
 *
 *   1. The body is WIDER THAN IT IS TALL and it leans forward. A vertical
 *      capsule is a person.
 *   2. The head is a SEPARATE, WIDER dome sitting FORWARD of the shoulders,
 *      not a ball on top of them.
 *   3. The eyes are on HUMPS, up and out past the width of the skull, and
 *      they point forward.
 *   4. The hind legs are FOLDED — knee above the hip, shin coming back
 *      down and forward, and a long flat foot.
 *
 * Get those four and a dozen boxes read unmistakably as a frog. Miss any
 * one and no amount of extra geometry rescues it.
 *
 * ── two detail levels ────────────────────────────────────────────────────
 *   crowd  fifteen parts. For armies and congregations. Still has all four
 *          of the things above, which is the point.
 *   full   thirty-odd. Toes, fingers, nostrils, brow ridges, a belly seam.
 *          For anybody the camera gets close to.
 *
 * ── and it draws into BATCHES, not meshes ────────────────────────────────
 * Every part is one `add` on an instanced batch, so four hundred knights
 * cost four draw calls. The caller supplies the batches; the contract is
 * four geometries — see `addFrog`.
 */

/**
 * WHAT A FROG IS WEARING.
 *
 * `knight` is the one the armies wear: the Croaklands went to war and its
 * soldiers are frogs in plate, not frogs in a gi. The player is the only
 * ninja on either field, which is rather the point of the player.
 */
export const OUTFITS = {
  /** Nothing. A villager, or a memory of one. */
  bare: { helm: null, plate: false, cape: false, hold: null },
  /** Plate, a visored helm with a plume, a shield and a sword. */
  knight: { helm: 'great', plate: true, pauldrons: true, greaves: true,
    tabard: true, shield: true, hold: 'sword', cape: false },
  /** Lighter: a kettle helm, a spear, no shield. */
  spearman: { helm: 'kettle', plate: true, pauldrons: true, greaves: false,
    tabard: true, shield: false, hold: 'spear', cape: false },
  /** A crested helm and a drawn sword. Front rank only. */
  captain: { helm: 'crested', plate: true, pauldrons: true, greaves: true,
    tabard: true, shield: false, hold: 'sword', cape: true },
  /** The player: hood, mask, no plate. */
  ninja: { helm: 'hood', plate: false, pauldrons: false, greaves: false,
    tabard: false, shield: false, hold: 'katana', cape: false },
  /** An emperor. Plate under a cape, and a crown. */
  royal: { helm: 'crown', plate: true, pauldrons: true, greaves: true,
    tabard: true, shield: false, hold: null, cape: true },
  /** A robed one — an elder, a priest, whoever hands over a crown. */
  robed: { helm: 'wrap', plate: false, robe: true, hold: 'staff' },
};

/**
 * ONE FROG.
 *
 * @param B  batches: { box, blob, rod, cone }, each with
 *           `.add(x,y,z, sx,sy,sz, colour, ry, rx, rz)`
 * @param o  {
 *   x, y, z    where its feet are
 *   s          scale; 1 is about a metre and a half tall standing
 *   face       yaw, by the `lookYaw` convention used everywhere else
 *   skin       body colour
 *   belly      the paler underside; defaults to a lightened skin
 *   cloth      what it is wearing under the metal
 *   metal      plate colour
 *   trim       crest, plume and edging
 *   outfit     a key of OUTFITS, or an object
 *   kneel      0 standing, 1 down on one knee
 *   detail     'crowd' or 'full'
 *   armPose    'rest' | 'salute' | 'reach' | 'hold'
 * }
 */
export function addFrog(B, o) {
  const s = o.s === undefined ? 1 : o.s;
  const face = o.face || 0;
  const kn = o.kneel || 0;
  const full = o.detail === 'full';
  const fit = typeof o.outfit === 'string'
    ? (OUTFITS[o.outfit] || OUTFITS.bare) : (o.outfit || OUTFITS.bare);
  const skin = o.skin === undefined ? 0x6fae4a : o.skin;
  const belly = o.belly === undefined ? lighten(skin, 0.34) : o.belly;
  const cloth = o.cloth === undefined ? 0x3a6a8a : o.cloth;
  const metal = o.metal === undefined ? 0x8f99a8 : o.metal;
  const trim = o.trim === undefined ? 0xc9a227 : o.trim;
  const dark = darken(skin, 0.4);

  /**
   * The body's own frame.
   *
   * `f` is forward, `r` is right. Everything below is written in "up,
   * forward, right" and mapped through these, which is what lets one
   * description serve a frog facing any direction.
   */
  const fx = -Math.sin(face), fz = -Math.cos(face);
  const rx = Math.cos(face), rz = -Math.sin(face);
  /** Place a part at (right, up, forward) in the frog's own frame. */
  const at = (bat, rt, up, fw, sx, sy, sz, colour, tiltX, tiltZ) => {
    bat.add(
      o.x + rx * rt * s + fx * fw * s,
      o.y + up * s,
      o.z + rz * rt * s + fz * fw * s,
      sx * s, sy * s, sz * s, colour, face, tiltX || 0, tiltZ || 0);
  };

  // How much the whole frog sinks and pitches when it kneels.
  const sink = kn * 0.30;
  const lean = kn * 0.10;

  // ───────────────────────────────────────────────────────────── the body ──
  /**
   * Wider than it is tall, and leaning forward.
   *
   * 1.18 across, 1.02 tall, 1.30 deep. Those proportions ARE the animal —
   * the previous crowd frogs were 1.16 × 1.28 × 1.04, which is a barrel
   * standing on end, and that is why they read as blobs.
   */
  at(B.blob, 0, 0.74 - sink, 0.02, 0.59, 0.51, 0.65, fit.plate ? metal : cloth,
    0.16 + lean, 0);
  // The paler underside, showing below the body's front.
  at(B.blob, 0, 0.56 - sink, 0.20, 0.44, 0.30, 0.42, belly, 0.2 + lean, 0);
  // The throat, which is the part that says "frog" from any angle.
  at(B.blob, 0, 0.86 - sink, 0.34, 0.30, 0.20, 0.20, belly);

  // ─────────────────────────────────────────────────────────── hind legs ──
  /**
   * FOLDED. Knee above the hip, shin back down and forward, long flat foot.
   *
   * When kneeling, the left leg goes down flat and the right stays folded,
   * which is what one knee down actually looks like.
   */
  for (const sd of [-1, 1]) {
    const down = kn > 0.5 && sd < 0;
    if (down) {
      // Shin flat on the ground, knee on the floor, foot behind.
      at(B.rod, sd * 0.42, 0.12, -0.10, 0.17, 0.62, 0.17, skin, 1.45, sd * 0.12);
      at(B.blob, sd * 0.42, 0.13, 0.22, 0.19, 0.17, 0.19, skin);
      at(B.box, sd * 0.42, 0.05, -0.44, 0.24, 0.10, 0.36, dark);
    } else {
      // Thigh: up and out, knee ABOVE the hip.
      at(B.rod, sd * 0.46, 0.62 - sink * 0.7, -0.14,
        0.19, 0.58, 0.19, skin, -0.5 + lean, sd * 0.46);
      // The knee itself, out at the widest point.
      at(B.blob, sd * 0.63, 0.80 - sink * 0.7, -0.14, 0.19, 0.18, 0.19, skin);
      // Shin: back down and forward to the foot.
      at(B.rod, sd * 0.60, 0.42 - sink * 0.7, 0.10,
        0.15, 0.62, 0.15, skin, 0.55, -sd * 0.16);
      // A long flat foot with the toes spread.
      at(B.box, sd * 0.54, 0.055, 0.40, 0.26, 0.09, 0.46, dark);
      if (full) {
        for (let t = -1; t <= 1; t++) {
          at(B.cone, sd * 0.54 + t * 0.10, 0.055, 0.62,
            0.055, 0.20, 0.055, dark, 1.57, 0);
        }
      }
      if (fit.greaves) {
        at(B.box, sd * 0.60, 0.42 - sink * 0.7, 0.10,
          0.20, 0.34, 0.20, metal, 0.55, -sd * 0.16);
      }
    }
  }

  // ──────────────────────────────────────────────────────────── the head ──
  /**
   * A SEPARATE, WIDER DOME, FORWARD of the shoulders.
   *
   * 0.72 wide against a 0.59 body: the skull is broader than the shoulders,
   * which is true of a frog and of almost nothing else.
   */
  const hu = 1.26 - sink * 0.9;
  const hf = 0.30 + lean * 0.4;
  at(B.blob, 0, hu, hf, 0.72, 0.40, 0.62, skin, 0.1, 0);
  // The wide flat mouth line, turned down.
  at(B.box, 0, hu - 0.13, hf + 0.30, 1.02, 0.07, 0.34, dark);
  if (full) {
    // A pale chin under it, and two nostrils on top.
    at(B.blob, 0, hu - 0.20, hf + 0.20, 0.44, 0.12, 0.30, belly);
    for (const sd of [-1, 1]) {
      at(B.blob, sd * 0.10, hu + 0.13, hf + 0.42, 0.045, 0.04, 0.045, dark);
    }
  }
  /**
   * THE EYE HUMPS.
   *
   * Up and OUT past the skull's own width — 0.40 out on a 0.72-wide head —
   * so the silhouette has two bumps on top of it. This is the single most
   * recognisable thing about the animal.
   */
  for (const sd of [-1, 1]) {
    at(B.blob, sd * 0.40, hu + 0.28, hf + 0.02, 0.26, 0.24, 0.26, skin);
    // Gold iris, forward-facing, with a dark slit pupil in it.
    at(B.blob, sd * 0.40, hu + 0.31, hf + 0.17, 0.17, 0.16, 0.12, 0xf4e6b0);
    at(B.blob, sd * 0.40, hu + 0.31, hf + 0.25, 0.05, 0.10, 0.05, 0x12100e);
    if (full) {
      // A brow ridge over each, which is what gives a frog its expression.
      at(B.box, sd * 0.40, hu + 0.46, hf + 0.04, 0.30, 0.06, 0.26, dark);
    }
  }

  // ────────────────────────────────────────────────────────── front arms ──
  /**
   * Short, and held in front rather than hanging at the sides.
   *
   * The pose matters more than the geometry: `salute` puts a fist to the
   * chest, `hold` closes both hands round whatever it is carrying, `reach`
   * puts one hand out. A crowd of frogs all in `rest` reads as furniture.
   */
  const pose = o.armPose || (fit.hold ? 'hold' : 'rest');
  for (const sd of [-1, 1]) {
    let up = 0.86 - sink * 0.8, fw = 0.22, out = sd * 0.52, tz = sd * 0.22;
    if (pose === 'salute' && sd > 0) { up += 0.16; fw = 0.34; out = sd * 0.26; tz = sd * 0.9; }
    if (pose === 'hold') { fw = 0.36; out = sd * 0.42; tz = sd * 0.5; }
    if (pose === 'reach' && sd > 0) { up += 0.10; fw = 0.62; out = sd * 0.34; tz = sd * 1.15; }
    if (kn > 0.5 && sd < 0) { up = 0.52; fw = 0.30; out = sd * 0.40; }
    // Upper arm, forearm, hand.
    at(B.rod, out, up, fw - 0.10, 0.13, 0.36, 0.13, skin, 0.4, tz);
    at(B.rod, out * 1.06, up - 0.22, fw + 0.10, 0.11, 0.32, 0.11, skin, 0.9, tz * 0.5);
    at(B.blob, out * 1.1, up - 0.38, fw + 0.22, 0.13, 0.12, 0.13, skin);
    if (full) {
      for (let g = -1; g <= 1; g++) {
        at(B.cone, out * 1.1 + g * 0.07, up - 0.46, fw + 0.28,
          0.035, 0.14, 0.035, skin, 2.6, 0);
      }
    }
    if (fit.pauldrons) {
      at(B.blob, out * 0.96, up + 0.18, fw - 0.14, 0.24, 0.16, 0.24, metal);
      if (full) at(B.box, out * 0.96, up + 0.26, fw - 0.14, 0.30, 0.05, 0.28, trim);
    }
  }

  // ──────────────────────────────────────────────────────── what it wears ──
  if (fit.plate) {
    // A breastplate over the body, and a gorget at the throat.
    at(B.blob, 0, 0.80 - sink, 0.14, 0.56, 0.42, 0.56, metal, 0.16 + lean, 0);
    at(B.box, 0, 1.02 - sink, 0.20, 0.44, 0.10, 0.34, metal);
    if (full) {
      // A raised crest down the middle of the chest.
      at(B.box, 0, 0.86 - sink, 0.40, 0.09, 0.34, 0.14, trim, 0.2, 0);
    }
  }
  if (fit.tabard) {
    // Cloth hanging over the plate, in whatever colours it is fighting for.
    at(B.box, 0, 0.58 - sink, 0.36, 0.40, 0.52, 0.06, cloth, 0.12, 0);
  }
  if (fit.robe) {
    at(B.cone, 0, 0.44, 0.02, 0.62, 1.0, 0.62, cloth, Math.PI, 0);
  }
  if (fit.cape) {
    // A cape off the shoulders, falling behind. Two panels so it has an
    // edge rather than being one flat card.
    at(B.box, 0, 0.66 - sink, -0.44, 0.86, 1.10, 0.07, o.capeColour || 0x7a1f2a,
      -0.10, 0);
    at(B.box, 0, 1.10 - sink, -0.36, 0.60, 0.16, 0.14, trim);
  }

  // ─────────────────────────────────────────────────────────── the helmet ──
  const th = hu + 0.34;
  switch (fit.helm) {
    case 'great': {
      // A dome over the skull, a visor with a slit, and a plume.
      at(B.blob, 0, hu + 0.16, hf - 0.04, 0.80, 0.42, 0.70, metal);
      at(B.box, 0, hu + 0.16, hf + 0.30, 0.74, 0.30, 0.14, metal);
      at(B.box, 0, hu + 0.20, hf + 0.38, 0.56, 0.05, 0.06, 0x14140f);
      // The eye humps push through it, so it still reads as a frog in a
      // helmet rather than as a helmet.
      for (const sd of [-1, 1]) {
        at(B.blob, sd * 0.42, hu + 0.30, hf + 0.02, 0.24, 0.20, 0.24, metal);
      }
      at(B.cone, 0, th + 0.20, hf - 0.10, 0.10, 0.44, 0.10, trim);
      at(B.blob, 0, th + 0.44, hf - 0.14, 0.13, 0.24, 0.13, o.plume || 0x8a2f28);
      break;
    }
    case 'kettle': {
      // A wide brim and a shallow bowl. Cheap kit, and it looks it.
      at(B.blob, 0, hu + 0.20, hf - 0.02, 0.62, 0.30, 0.58, metal);
      at(B.box, 0, hu + 0.14, hf - 0.02, 1.00, 0.06, 0.92, metal);
      break;
    }
    case 'crested': {
      at(B.blob, 0, hu + 0.18, hf - 0.04, 0.78, 0.40, 0.68, metal);
      at(B.box, 0, hu + 0.16, hf + 0.30, 0.70, 0.26, 0.12, metal);
      at(B.box, 0, hu + 0.20, hf + 0.37, 0.52, 0.05, 0.06, 0x14140f);
      // A fore-and-aft crest, which is what a captain has and a soldier
      // does not.
      at(B.box, 0, th + 0.24, hf - 0.06, 0.08, 0.34, 0.72, trim);
      break;
    }
    case 'hood': {
      at(B.blob, 0, hu + 0.14, hf - 0.06, 0.80, 0.44, 0.74, cloth);
      // The mask across the muzzle, and the two tails behind.
      at(B.box, 0, hu - 0.06, hf + 0.26, 0.86, 0.26, 0.18, darken(cloth, 0.25));
      at(B.box, 0, hu + 0.02, -0.34, 0.16, 0.62, 0.08, cloth, -0.2, 0);
      break;
    }
    case 'crown': {
      /**
       * SEVEN POINTS OF GOLD, and a band.
       *
       * The most important twelve parts in the game: this is what the
       * player is told they used to wear, and what gets put on their head
       * at the end of it.
       */
      at(B.box, 0, th, hf - 0.02, 0.86, 0.14, 0.80, 0xc9a227);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        at(B.box, Math.cos(a) * 0.40, th + 0.20 + (i % 2 ? 0.10 : 0),
          hf - 0.02 + Math.sin(a) * 0.36,
          0.09, 0.30 + (i % 2 ? 0.16 : 0), 0.09, 0xffd76b);
        if (full && i % 2 === 0) {
          at(B.blob, Math.cos(a) * 0.40, th + 0.42,
            hf - 0.02 + Math.sin(a) * 0.36, 0.07, 0.07, 0.07, 0x8fd8f4);
        }
      }
      break;
    }
    case 'wrap': {
      at(B.box, 0, hu + 0.22, hf - 0.02, 0.84, 0.20, 0.76, cloth);
      at(B.box, 0, hu + 0.10, -0.30, 0.20, 0.50, 0.08, cloth);
      break;
    }
    default: break;
  }

  // ───────────────────────────────────────────────── what it is carrying ──
  const hr = 0.52, hy = 0.48 - sink * 0.8, hz2 = 0.58;
  switch (fit.hold) {
    case 'sword': {
      // Held out and across, point up.
      at(B.box, hr, hy + 0.62, hz2, 0.07, 1.30, 0.16, 0xdfe6f0, 0, -0.22);
      at(B.box, hr, hy + 0.02, hz2, 0.34, 0.07, 0.10, trim);
      at(B.rod, hr, hy - 0.14, hz2, 0.055, 0.28, 0.055, 0x2b2b34);
      at(B.blob, hr, hy - 0.30, hz2, 0.075, 0.075, 0.075, trim);
      break;
    }
    case 'katana': {
      at(B.box, hr, hy + 0.54, hz2, 0.055, 1.16, 0.12, 0xe9eef5, 0, -0.16);
      at(B.box, hr, hy + 0.00, hz2, 0.20, 0.05, 0.20, trim);
      at(B.rod, hr, hy - 0.16, hz2, 0.05, 0.32, 0.05, 0x2b2b34);
      break;
    }
    case 'spear': {
      // Upright at the shoulder, which is what a rank of them looks like.
      at(B.rod, hr, hy + 1.22, hz2 - 0.14, 0.045, 3.10, 0.045, 0x6b4a2a, 0, -0.06);
      at(B.cone, hr + 0.09, hy + 2.86, hz2 - 0.14, 0.075, 0.42, 0.075, 0xdfe6f0);
      break;
    }
    case 'staff': {
      at(B.rod, hr, hy + 1.02, hz2 - 0.10, 0.05, 2.60, 0.05, 0x6b4a2a);
      at(B.blob, hr, hy + 2.36, hz2 - 0.10, 0.14, 0.16, 0.14, 0x8fd8f4);
      break;
    }
    default: break;
  }
  if (fit.shield) {
    // On the left arm, turned to face out.
    at(B.blob, -hr - 0.10, hy + 0.52, hz2 - 0.06, 0.42, 0.52, 0.10, metal);
    at(B.box, -hr - 0.10, hy + 0.52, hz2 + 0.02, 0.20, 0.26, 0.05, trim);
  }
}

/** How many instanced parts one frog costs, so a caller can size a batch. */
export function frogParts(detail = 'crowd', outfit = 'bare') {
  const fit = typeof outfit === 'string'
    ? (OUTFITS[outfit] || OUTFITS.bare) : outfit;
  let n = 3 + 2 * 4 + 3 + 2 * 3 + 2 * 3;         // body, legs, head, arms, eyes
  if (detail === 'full') n += 2 + 6 + 2 + 6;
  if (fit.plate) n += 2;
  if (fit.pauldrons) n += 2;
  if (fit.greaves) n += 2;
  if (fit.tabard) n += 1;
  if (fit.cape) n += 2;
  if (fit.helm) n += 6;
  if (fit.hold) n += 4;
  if (fit.shield) n += 2;
  return n + 6;                                   // slack, so nothing overruns
}

// ─────────────────────────────────────────────────────────────── colours ──

function lighten(hex, k) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const f = (v) => Math.min(255, Math.round(v + (255 - v) * k));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

function darken(hex, k) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const f = (v) => Math.max(0, Math.round(v * (1 - k)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/**
 * THE COLOURS FROGS COME IN.
 *
 * Same palette the villagers use, so the frog kneeling in a memory could
 * plausibly be the frog selling you kunai in Harrowmead.
 */
export const FROG_SKINS = [
  0x6fae4a, 0x8fc44a, 0x5a8f3a, 0x4f6f3a, 0x9fbe5a,
  0x7fbf5a, 0x6cc24a, 0x86a84e,
];

/** And the cloth they wear it with. */
export const FROG_CLOTH = [
  0x3a6a8a, 0x7a5a3a, 0x4a5058, 0x8a2f28, 0x2f6f8a, 0x6b4a2a,
];
