/**
 * THE SCORE — one piece of music for every place in the game.
 *
 * There are no audio files. Everything here is a DESCRIPTION of a piece and
 * `AudioEngine.setTheme` plays it: a key, a scale, a chord progression, a
 * tempo, and how loud each of the five voices is. That is the whole format,
 * and it is why every region, every settlement and every fight can have its
 * own music for eight lines of data each rather than for a megabyte.
 *
 * ── the five voices ───────────────────────────────────────────────────────
 *   pad    long chords underneath. The colour of the place.
 *   bass   the root of the current chord, on the beat.
 *   lead   the tune, drawn from `motif` — degrees of the scale, or null for
 *          a rest. This is the part a player will actually remember.
 *   pluck  an arpeggio through the chord, filling the gaps.
 *   perc   noise hits on a pattern. Only where a place has a pulse.
 *
 * ── the shape of a theme ──────────────────────────────────────────────────
 *   root    hertz of the tonic
 *   scale   semitone degrees the melody may use
 *   chords  one per bar, as semitone offsets from the root
 *   bpm     beats per minute; a bar is four beats, a step is a sixteenth
 *   motif   sixteen entries per bar — an index into `scale`, or null
 *   swing   0..1, how far every second sixteenth is pushed late
 *
 * ── how the modes are chosen ──────────────────────────────────────────────
 * Not at random. The scale IS the feeling, so each place gets the one that
 * says what it is:
 *
 *   major pentatonic   home, safety, the south
 *   dorian             open country, work, travel
 *   aeolian            loss, ruin, the drowned places
 *   phrygian dominant  the desert, and anywhere that was not built by frogs
 *   lydian             height, air, the Choir Cliffs
 *   whole tone         nothing is quite solid — the Glimmerwood, the Moonshelf
 *   locrian / tritone  the volcano and the throne. Nothing resolves.
 */

/** Scales, by the name of the feeling rather than of the mode. */
const S = {
  home: [0, 2, 4, 7, 9],                  // major pentatonic
  open: [0, 2, 3, 5, 7, 9, 10],           // dorian
  loss: [0, 2, 3, 5, 7, 8, 10],           // aeolian
  east: [0, 1, 4, 5, 7, 8, 10],           // phrygian dominant
  high: [0, 2, 4, 6, 7, 9, 11],           // lydian
  drift: [0, 2, 4, 6, 8, 10],             // whole tone
  wrong: [0, 1, 3, 5, 6, 8, 10],          // locrian
  minor5: [0, 3, 5, 7, 10],               // minor pentatonic
};

/** Chord shapes, as offsets from whatever degree they are built on. */
const maj = (r) => [r, r + 4, r + 7];
const min = (r) => [r, r + 3, r + 7];
const sus = (r) => [r, r + 5, r + 7];
const dim = (r) => [r, r + 3, r + 6];
const maj7 = (r) => [r, r + 4, r + 7, r + 11];
const min7 = (r) => [r, r + 3, r + 7, r + 10];

/**
 * A theme, with sensible defaults so an entry only says what is unusual.
 *
 * `m` is the motif in a shorthand: a string of sixteen characters where a
 * digit is that degree of the scale, `-` is a rest and `.` is a hold. Written
 * as a string because a tune you can read in one line is a tune you can edit.
 */
function T(o) {
  return Object.assign({
    root: 110, scale: S.open, bpm: 72, swing: 0,
    chords: [min(0), min(0), sus(5), min(0)],
    pad: 0.05, bass: 0.05, lead: 0.055, pluck: 0.03, perc: 0,
    padWave: 'triangle', leadWave: 'triangle', bassWave: 'sine',
    pluckWave: 'triangle', cutoff: 1200, hold: 2.6, octave: 4,
    motif: '0---2---4---2---',
  }, o);
}

// ══════════════════════════════════════════════════════════ the regions ══

/**
 * One per region. Twenty-four pieces of music.
 *
 * Ordered as the player meets them, and they are meant to be heard in that
 * order: the south is warm and consonant, the middle turns modal and
 * wandering, and by the Ashen Throne nothing resolves at all.
 */
export const REGION_THEMES = {
  // ── the south: home, and safe ──
  lilyreach: T({
    root: 131, scale: S.home, bpm: 64,
    chords: [maj(0), maj(0), maj(5), maj(7)],
    motif: '0---2---4-2-0---', lead: 0.06, pluck: 0.035, hold: 3.0,
    padWave: 'triangle', leadWave: 'triangle', cutoff: 1500,
  }),
  harrowmead: T({
    root: 123, scale: S.home, bpm: 78,
    chords: [maj(0), maj(7), maj(5), maj(0)],
    motif: '0-2-4-2-7---4---', pluck: 0.045, perc: 0.03, cutoff: 1400,
  }),

  // ── the fens: low, wet, unresolved ──
  whispermire: T({
    root: 82, scale: S.loss, bpm: 54,
    chords: [min(0), min(0), min(8), min(3)],
    motif: '0-------3---2---', pad: 0.06, lead: 0.045, pluck: 0.02,
    padWave: 'sawtooth', leadWave: 'sine', cutoff: 520, hold: 4.0,
  }),
  glassfen: T({
    root: 147, scale: S.high, bpm: 50,
    chords: [maj7(0), maj7(0), maj7(5), maj7(2)],
    motif: '0---4---6---4---', pad: 0.045, lead: 0.04, pluck: 0.03,
    padWave: 'sine', leadWave: 'sine', cutoff: 2400, hold: 4.4,
  }),
  gravewater: T({
    root: 65, scale: S.loss, bpm: 46,
    chords: [min(0), min(0), dim(2), min(0)],
    motif: '0-----------3---', pad: 0.065, lead: 0.04, pluck: 0.015,
    padWave: 'sawtooth', leadWave: 'triangle', cutoff: 340, hold: 5.0,
  }),
  drownedkeep: T({
    root: 87, scale: S.loss, bpm: 52,
    chords: [min7(0), min7(0), min7(5), min7(3)],
    motif: '0---3-5-3---0---', pad: 0.06, lead: 0.045, pluck: 0.025,
    padWave: 'sawtooth', leadWave: 'sine', cutoff: 460, hold: 4.2,
  }),

  // ── the woods ──
  hollowroot: T({
    root: 98, scale: S.open, bpm: 68,
    chords: [min(0), min(0), maj(10), sus(5)],
    motif: '0-3-5-3-7-5-3---', lead: 0.055, pluck: 0.04, cutoff: 1100,
    leadWave: 'sine',
  }),
  palewood: T({
    root: 92, scale: S.loss, bpm: 44,
    chords: [min(0), min(8), min(0), min(3)],
    motif: '0-------------3-', pad: 0.06, lead: 0.038, pluck: 0.012,
    padWave: 'sine', leadWave: 'sine', cutoff: 700, hold: 5.5,
  }),
  glimmerwood: T({
    root: 116, scale: S.drift, bpm: 58,
    chords: [[0, 4, 8], [2, 6, 10], [0, 4, 8], [4, 8, 12]],
    motif: '0-2-4-6-8-6-4-2-', pad: 0.05, lead: 0.045, pluck: 0.05,
    padWave: 'sine', leadWave: 'sine', pluckWave: 'sine', cutoff: 2600,
  }),

  // ── the stair and the capital ──
  sunkenstair: T({
    root: 131, scale: S.high, bpm: 60,
    chords: [maj(0), maj(7), maj(0), maj(5)],
    motif: '0---4---7---11--', pad: 0.05, lead: 0.055, pluck: 0.03,
    padWave: 'sine', leadWave: 'sine', cutoff: 2000, hold: 3.6,
  }),
  anurath: T({
    root: 98, scale: S.loss, bpm: 56,
    chords: [min(0), maj(8), min(5), maj(3)],
    motif: '0---3---7---8-7-', pad: 0.062, lead: 0.055, pluck: 0.028,
    perc: 0.018, padWave: 'sawtooth', leadWave: 'triangle', cutoff: 800,
    hold: 4.0,
  }),
  hollowcity: T({
    root: 73, scale: S.loss, bpm: 48,
    chords: [min(0), min(0), maj(8), min(5)],
    motif: '0-------7-------', pad: 0.07, lead: 0.05, pluck: 0.014,
    padWave: 'sawtooth', leadWave: 'triangle', cutoff: 420, hold: 5.5,
  }),

  // ── the working country ──
  quarry: T({
    root: 110, scale: S.minor5, bpm: 92,
    chords: [min(0), min(0), min(5), min(3)],
    motif: '0-3-0-5-3---0---', bass: 0.06, pluck: 0.045, perc: 0.05,
    leadWave: 'square', cutoff: 900, hold: 1.6, swing: 0.16,
  }),
  choircliffs: T({
    root: 165, scale: S.high, bpm: 54,
    chords: [maj(0), maj(2), maj(7), maj(0)],
    motif: '0---2---4---6---', pad: 0.048, lead: 0.05, pluck: 0.032,
    padWave: 'sine', leadWave: 'sine', cutoff: 2800, hold: 4.6,
  }),
  boneflats: T({
    root: 69, scale: S.minor5, bpm: 50,
    chords: [min(0), min(0), min(0), min(7)],
    motif: '0-------5-------', pad: 0.05, lead: 0.04, pluck: 0.01,
    padWave: 'sawtooth', cutoff: 380, hold: 4.8,
  }),
  spine: T({
    root: 78, scale: S.loss, bpm: 52,
    chords: [min(0), min(3), min(0), dim(6)],
    motif: '0---3-------7---', pad: 0.058, lead: 0.042, pluck: 0.016,
    padWave: 'sawtooth', cutoff: 420, hold: 4.4,
  }),

  // ── the dry lands ──
  thirstlands: T({
    root: 104, scale: S.east, bpm: 66,
    chords: [maj(0), min(1), maj(0), maj(5)],
    motif: '0-1-4-1-0---5---', lead: 0.058, pluck: 0.038, perc: 0.028,
    leadWave: 'sawtooth', cutoff: 1300, hold: 2.4, swing: 0.12,
  }),
  emberwaste: T({
    root: 87, scale: S.east, bpm: 74,
    chords: [min(0), maj(1), min(0), dim(6)],
    motif: '0-1-0-5-1---0---', pad: 0.058, lead: 0.05, perc: 0.04,
    padWave: 'sawtooth', leadWave: 'square', cutoff: 620, hold: 2.0,
  }),
  cindermaw: T({
    root: 62, scale: S.wrong, bpm: 84,
    chords: [dim(0), dim(0), dim(6), dim(0)],
    motif: '0-1-3-1-6---3---', pad: 0.07, lead: 0.05, perc: 0.055,
    bass: 0.07, padWave: 'sawtooth', leadWave: 'square', cutoff: 460,
    hold: 1.6,
  }),

  // ── the cold ──
  moonshelf: T({
    root: 156, scale: S.drift, bpm: 46,
    chords: [[0, 4, 8], [0, 4, 8], [6, 10, 14], [2, 6, 10]],
    motif: '0---4---8---4---', pad: 0.045, lead: 0.042, pluck: 0.036,
    padWave: 'sine', leadWave: 'sine', pluckWave: 'sine', cutoff: 3000,
    hold: 5.0,
  }),
  frostmarch: T({
    root: 139, scale: S.loss, bpm: 50,
    chords: [min(0), min(0), maj(8), min(5)],
    motif: '0---3---7---3---', pad: 0.05, lead: 0.05, pluck: 0.03,
    padWave: 'sine', leadWave: 'sine', cutoff: 2400, hold: 4.4,
  }),
  rimefang: T({
    root: 175, scale: S.loss, bpm: 42,
    chords: [min(0), min(0), min(8), dim(2)],
    motif: '0-----------10--', pad: 0.048, lead: 0.045, pluck: 0.022,
    padWave: 'sine', leadWave: 'sine', cutoff: 3200, hold: 5.6,
  }),

  // ── the end of the road ──
  sunderway: T({
    root: 73, scale: S.wrong, bpm: 54,
    chords: [dim(0), min(0), dim(6), min(0)],
    motif: '0-------6-------', pad: 0.065, lead: 0.045, pluck: 0.012,
    padWave: 'sawtooth', cutoff: 400, hold: 5.0,
  }),
  ashenthrone: T({
    root: 58, scale: S.wrong, bpm: 44,
    chords: [dim(0), dim(0), dim(6), dim(6)],
    motif: '0-----------6---', pad: 0.08, lead: 0.045, pluck: 0.01,
    bass: 0.07, padWave: 'sawtooth', leadWave: 'triangle', cutoff: 300,
    hold: 6.0,
  }),
};

// ═══════════════════════════════════════════════════════ the settlements ══

/**
 * WHAT A PLACE WITH PEOPLE IN IT SOUNDS LIKE.
 *
 * Walking into a village is meant to be a relief, so the settlement themes
 * are the warmest music in the game: major, faster, plucked, with the melody
 * out in front. Three sizes and two special cases, and the region's own key
 * is kept — the Stilts sounds like the fen having a good day rather than like
 * a different country.
 *
 * Held cities get the MINOR version. A town with Frogath's banners in the
 * square should not sound pleased with itself.
 */
export const SETTLEMENT_THEMES = {
  village: T({
    root: 147, scale: S.home, bpm: 86,
    chords: [maj(0), maj(5), maj(7), maj(0)],
    motif: '0-2-4-7-4-2-0---', lead: 0.062, pluck: 0.055, perc: 0.022,
    padWave: 'triangle', leadWave: 'triangle', pluckWave: 'triangle',
    cutoff: 1800, hold: 1.8, swing: 0.14,
  }),
  town: T({
    root: 131, scale: S.home, bpm: 96,
    chords: [maj(0), maj(7), maj(9), maj(5)],
    motif: '0-2-4-2-7-9-7-4-', lead: 0.06, pluck: 0.06, perc: 0.038,
    bass: 0.055, cutoff: 1900, hold: 1.5, swing: 0.16,
  }),
  city: T({
    root: 110, scale: S.home, bpm: 88,
    chords: [maj(0), maj(5), maj(9), maj(7)],
    motif: '0-4-7-4-9-7-4-0-', pad: 0.055, lead: 0.06, pluck: 0.05,
    perc: 0.03, bass: 0.058, padWave: 'sine', cutoff: 1700, hold: 2.2,
  }),
  treevillage: T({
    root: 139, scale: S.open, bpm: 80,
    chords: [min(0), maj(10), sus(5), min(0)],
    motif: '0-3-5-7-5-3-0---', lead: 0.058, pluck: 0.055, perc: 0.018,
    leadWave: 'sine', pluckWave: 'sine', cutoff: 1600, hold: 2.0,
  }),
  /** Any settlement whose guardian is still standing. Same tune, minor. */
  held: T({
    root: 116, scale: S.loss, bpm: 70,
    chords: [min(0), min(0), maj(8), min(5)],
    motif: '0-3-5-3-0-------', lead: 0.05, pluck: 0.03, perc: 0.012,
    padWave: 'triangle', leadWave: 'triangle', cutoff: 900, hold: 2.6,
  }),
};

// ══════════════════════════════════════════════════════════ the fights ══

/**
 * BOSS MUSIC, by rank — and three of them get their own.
 *
 * Fast, low, and built on a chord that will not settle. Every one has
 * percussion, because a fight needs a pulse to move to; the phase change
 * tightens the tempo (see `AudioEngine.bossPhase`), so the same theme gets
 * harder rather than being replaced mid-fight.
 */
export const BOSS_THEMES = {
  elite: T({
    root: 87, scale: S.minor5, bpm: 118,
    chords: [min(0), min(0), min(5), min(3)],
    motif: '0-0-3-0-5-3-0---', pad: 0.05, bass: 0.075, lead: 0.05,
    pluck: 0.02, perc: 0.06, padWave: 'sawtooth', leadWave: 'square',
    cutoff: 700, hold: 1.0,
  }),
  mini: T({
    root: 78, scale: S.loss, bpm: 128,
    chords: [min(0), min(0), dim(6), min(5)],
    motif: '0-0-3-5-3-0-6---', pad: 0.055, bass: 0.08, lead: 0.055,
    perc: 0.07, padWave: 'sawtooth', leadWave: 'square', cutoff: 640,
    hold: 0.9,
  }),
  major: T({
    root: 69, scale: S.wrong, bpm: 138,
    chords: [dim(0), dim(0), min(6), dim(0)],
    motif: '0-1-0-6-0-3-6-0-', pad: 0.06, bass: 0.085, lead: 0.055,
    perc: 0.08, padWave: 'sawtooth', leadWave: 'square', cutoff: 600,
    hold: 0.8,
  }),
  final: T({
    root: 58, scale: S.wrong, bpm: 148,
    chords: [dim(0), dim(6), dim(0), dim(1)],
    motif: '0-1-3-6-3-1-0-6-', pad: 0.07, bass: 0.09, lead: 0.06,
    perc: 0.09, padWave: 'sawtooth', leadWave: 'square', cutoff: 560,
    hold: 0.7,
  }),

  /**
   * The three that are somebody rather than something.
   *
   * A gate-keeper who has not moved in four hundred years, a bridge-builder
   * nobody has ever been allowed across, and a frog who asked to be turned
   * into a door. They get themes of their own because the player will have
   * heard their names for hours before meeting them.
   */
  grott: T({
    root: 65, scale: S.minor5, bpm: 104,
    chords: [min(0), min(0), min(0), min(5)],
    motif: '0-------0---3---', pad: 0.075, bass: 0.095, lead: 0.05,
    perc: 0.075, padWave: 'sawtooth', leadWave: 'triangle', cutoff: 380,
    hold: 1.6,
  }),
  arkos: T({
    root: 62, scale: S.loss, bpm: 126,
    chords: [min(0), maj(8), min(0), dim(6)],
    motif: '0-3-7-3-8-7-3-0-', pad: 0.07, bass: 0.088, lead: 0.06,
    perc: 0.078, padWave: 'sawtooth', leadWave: 'square', cutoff: 620,
    hold: 0.9,
  }),
  zehl: T({
    root: 55, scale: S.wrong, bpm: 152,
    chords: [dim(0), dim(0), dim(6), dim(6)],
    motif: '0-1-0-1-6-6-3-1-', pad: 0.08, bass: 0.095, lead: 0.062,
    perc: 0.095, padWave: 'sawtooth', leadWave: 'square', cutoff: 520,
    hold: 0.6,
  }),
};

// ══════════════════════════════════════════════════════════ the prologue ══

/**
 * THE HEAVENLY BATTLEFIELD, before a sword is drawn.
 *
 * Enormous and slow. Lydian, so it is bright without being happy — the mode
 * that sounds like altitude — over a very long pad and a bass that only moves
 * twice a bar. It has percussion, but only the low hit on the downbeat: an
 * army standing still, not an army marching.
 */
export const PROLOGUE_THEME = T({
  root: 98, scale: S.high, bpm: 52,
  chords: [maj7(0), maj7(0), maj7(7), maj7(5)],
  motif: '0---4---7---11--', pad: 0.075, bass: 0.06, lead: 0.055,
  pluck: 0.028, perc: 0.022, padWave: 'triangle', leadWave: 'sine',
  cutoff: 1700, hold: 5.2, octave: 4,
});

/**
 * THE FALL, and the beat before it.
 *
 * The same key as the prologue and nearly the same chords — it is the same
 * scene, ending — but the seventh is gone, the tempo has halved and there is
 * nothing on top but one note every two bars. This is also what plays over
 * the aftermath of the fight, which is why the two beats sound like one.
 */
export const FALL_THEME = T({
  root: 98, scale: S.loss, bpm: 40,
  chords: [min(0), min(0), min(8), min(5)],
  motif: '0---------------', pad: 0.075, bass: 0.045, lead: 0.04,
  pluck: 0.008, perc: 0, padWave: 'sine', leadWave: 'sine',
  cutoff: 900, hold: 6.5,
});

/**
 * A MEMORY SURFACING.
 *
 * Played under a flashback. Whole-tone, so nothing in it resolves and it
 * cannot be placed in a key — which is exactly what a half-remembered thing
 * should sound like — and quiet enough to talk over.
 */
export const MEMORY_THEME = T({
  root: 116, scale: S.drift, bpm: 44,
  chords: [[0, 4, 8], [2, 6, 10], [0, 4, 8], [4, 8, 12]],
  motif: '0-------4-------', pad: 0.055, bass: 0.03, lead: 0.045,
  pluck: 0.03, perc: 0, padWave: 'sine', leadWave: 'sine',
  pluckWave: 'sine', cutoff: 2600, hold: 5.6,
});

/** The theme for one guardian: its own if it has one, else its rank's. */
export function bossTheme(id, rank) {
  return BOSS_THEMES[id] || BOSS_THEMES[rank] || BOSS_THEMES.major;
}

/** The theme for a region, or a safe default for one added later. */
export function regionTheme(id) {
  return REGION_THEMES[id] || REGION_THEMES.lilyreach;
}

/**
 * The theme for a settlement.
 *
 * @param kind  village | town | city | treevillage
 * @param held  true while the region's guardian is still standing
 */
export function settlementTheme(kind, held) {
  if (held) return SETTLEMENT_THEMES.held;
  return SETTLEMENT_THEMES[kind] || SETTLEMENT_THEMES.village;
}

export const THEME_COUNT = Object.keys(REGION_THEMES).length
  + Object.keys(SETTLEMENT_THEMES).length + Object.keys(BOSS_THEMES).length;
