/**
 * Audio engine.
 *
 * Every SOUND EFFECT is synthesized with WebAudio at runtime — no files — so
 * the game stays a pure static drop-in. Positional sounds are attenuated and
 * panned relative to the camera, which is what makes another player's dash or
 * katana swing readable before you can see them.
 *
 * MUSIC TRACKS are the one exception: see TRACKS below. They are optional
 * files, faded in and out through the music bus, and every one of them falls
 * back to the synthesized boss music if the file is not there — so the game
 * never breaks because a track is missing.
 */

/**
 * Optional music files, looked up by the name callers pass to playTrack().
 *
 * ── DROPPING IN A TRACK ────────────────────────────────────────────────────
 * Put the file at the path below (relative to frogshin/) and it is picked up
 * on the next load. Nothing else needs changing. Any format the browser can
 * decode works; .mp3 and .ogg are the safe choices.
 *
 *   phase1     THE DIVINE JUDGMENT — Frogath before the ascension, looped
 *   ascension  the 50% cutscene, played once, NOT looped
 *   ascended   PHASE II — the whole back half of the fight, looped
 *
 * `ascension` is also used, cut short, for the Frogath-skin transformation,
 * so it wants to be recognisable in its first two seconds.
 */

/**
 * The theme defaults, so a partial theme cannot reach Web Audio. See
 * `setTheme` — this is the one import this file has, and it is here to stop
 * a missing field becoming a NaN becoming a thrown TypeError.
 */
import { asTheme } from './themes.js?v=v125';

const TRACKS = {
  phase1: 'audio/frogath-phase1.mp3',
  ascension: 'audio/frogath-ascension.mp3',
  ascended: 'audio/frogath-ascended.mp3',
};

/**
 * THE EIGHT MOODS — what a region sounds like.
 *
 * Each region in the overworld names one of these, and it decides the wind,
 * the incidental noises and the slow music bed underneath. All of it is
 * synthesised, like everything else in the game: no files, so a region's
 * theme costs a scale, a root note and a waveform.
 *
 *   wind    level of the filtered noise bed
 *   voice   which incidental sound plays: bird, croak, bell, groan,
 *           crackle, chime, ping
 *   gap     seconds between those, low and high
 *   scale   semitone degrees the figure is drawn from
 *   root    hertz the whole thing is built on
 *   drone   multiples of the root held underneath
 *   tempo   milliseconds between notes of the figure
 */
export const MOODS = {
  calm: {
    wind: 0.075, voice: 'bird', gap: [4, 13],
    scale: [0, 2, 4, 7, 9], root: 110, drone: [1, 1.5, 2.005],
    wave: 'triangle', lead: 'triangle', cutoff: 900,
    tempo: 2600, hold: 2.2, note: 0.055, pad: 0.045,
  },
  wild: {
    wind: 0.095, voice: 'bird', gap: [3, 9],
    scale: [0, 3, 5, 7, 10], root: 98, drone: [1, 1.335, 2],
    wave: 'triangle', lead: 'sine', cutoff: 1100,
    tempo: 2200, hold: 1.8, note: 0.06, pad: 0.05,
  },
  grim: {
    wind: 0.11, voice: 'croak', gap: [3, 10],
    scale: [0, 2, 3, 7, 8], root: 82, drone: [1, 1.5, 2.01],
    wave: 'sawtooth', lead: 'triangle', cutoff: 480,
    tempo: 3000, hold: 2.6, note: 0.055, pad: 0.055,
  },
  holy: {
    wind: 0.06, voice: 'bell', gap: [8, 20],
    scale: [0, 4, 5, 7, 11], root: 131, drone: [1, 1.5, 3.005],
    wave: 'sine', lead: 'sine', cutoff: 1600,
    tempo: 3400, hold: 3.2, note: 0.05, pad: 0.04,
  },
  hot: {
    wind: 0.13, voice: 'crackle', gap: [2, 7],
    scale: [0, 1, 4, 6, 8], root: 73, drone: [1, 1.49, 2.02],
    wave: 'sawtooth', lead: 'square', cutoff: 380,
    tempo: 2400, hold: 1.6, note: 0.05, pad: 0.06,
  },
  cold: {
    wind: 0.12, voice: 'chime', gap: [5, 14],
    scale: [0, 2, 3, 7, 10], root: 147, drone: [1, 1.5, 2.005],
    wave: 'sine', lead: 'sine', cutoff: 2200,
    tempo: 3200, hold: 3.0, note: 0.042, pad: 0.035,
  },
  strange: {
    wind: 0.07, voice: 'ping', gap: [4, 11],
    scale: [0, 1, 6, 7, 11], root: 116, drone: [1, 1.414, 2.03],
    wave: 'triangle', lead: 'sine', cutoff: 1400,
    tempo: 2800, hold: 2.4, note: 0.048, pad: 0.042,
  },
  dread: {
    wind: 0.10, voice: 'groan', gap: [6, 16],
    scale: [0, 1, 3, 6, 8], root: 62, drone: [1, 1.06, 1.5],
    wave: 'sawtooth', lead: 'triangle', cutoff: 300,
    tempo: 3600, hold: 3.4, note: 0.05, pad: 0.065,
  },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.volumes = { master: 0.85, sfx: 1.0, music: 0.5 };
    this.listener = {
      x: 0, y: 0, z: 0,
      fx: 0, fy: 0, fz: -1,     // forward
      rx: 1, ry: 0, rz: 0,      // right
    };
    this.maxDistance = 90;
    this._ambient = null;
    this._music = null;
    /** The open world's slow bed, and which mood it is playing. */
    this._region = null;
    this._mood = null;
    /** The composed piece currently playing — see setTheme(). */
    this._theme = null;
    this._birdTimer = 0;
    this._lastStep = 0;
    this._buffers = new Map();    // track name -> AudioBuffer | 'missing'
    this._playing = new Map();    // track name -> { src, gain }
    this._fetching = new Map();
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    // A permanently-installed lowpass, wide open above water. Sweeping it
    // down is what makes submerging sound muffled.
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 22000;
    this.muffle.Q.value = 0.6;
    this.master.connect(this.muffle);
    this.muffle.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    // Shared white-noise buffer for whooshes, impacts and wind.
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(kind, v) {
    this.volumes[kind] = v;
    if (!this.ready) return;
    if (kind === 'master') this.master.gain.value = v;
    if (kind === 'sfx') this.sfxBus.gain.value = v;
    if (kind === 'music') this.musicBus.gain.value = v;
  }

  /** Muffle everything while the camera is submerged. */
  setUnderwater(v) {
    if (!this.ready || !this.muffle) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, t);
    this.muffle.frequency.linearRampToValueAtTime(v ? 520 : 22000, t + 0.35);
  }

  setListener(pos, forward, right) {
    const l = this.listener;
    l.x = pos.x; l.y = pos.y; l.z = pos.z;
    l.fx = forward.x; l.fy = forward.y; l.fz = forward.z;
    l.rx = right.x; l.ry = right.y; l.rz = right.z;
  }

  /** Distance gain + stereo pan for a world-space sound. */
  _spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const l = this.listener;
    const dx = pos.x - l.x, dy = pos.y - l.y, dz = pos.z - l.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > this.maxDistance) return null;
    // Inverse-ish falloff, clamped so nearby sounds don't blow out.
    const gain = Math.min(1, 1 / (1 + (dist / 9) * (dist / 9) * 0.55));
    const inv = dist > 0.001 ? 1 / dist : 0;
    const pan = Math.max(-0.9, Math.min(0.9,
      (dx * l.rx + dy * l.ry + dz * l.rz) * inv));
    return { gain, pan };
  }

  /** Build the gain -> pan -> bus chain for one voice. */
  _out(pos, volume, bus) {
    const sp = this._spatial(pos);
    if (!sp) return null;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    let node = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = sp.pan;
      g.connect(p);
      node = p;
    }
    node.connect(bus || this.sfxBus);
    return { gain: g, vol: volume * sp.gain };
  }

  // ------------------------------------------------------------ primitives

  /**
   * A pitched tone with an optional glide and a percussive envelope.
   *
   * `cutoff`, when given, puts a lowpass in front of the envelope. That is
   * what takes the edge off a sawtooth pad — the music engine leans on it
   * heavily, because a theme's cutoff is most of what separates a warm
   * village from the inside of a volcano.
   */
  tone(opts) {
    if (!this.ready) return;
    const {
      freq = 440, to = null, dur = 0.2, type = 'sine', volume = 0.3,
      pos = null, attack = 0.005, decay = null, detune = 0, cutoff = null,
    } = opts;
    const chain = this._out(pos, volume, opts.bus);
    if (!chain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    osc.detune.value = detune;
    if (cutoff !== null) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      lp.Q.value = 0.5;
      osc.connect(lp);
      lp.connect(chain.gain);
    } else osc.connect(chain.gain);
    const g = chain.gain.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(chain.vol, t + attack);
    g.exponentialRampToValueAtTime(0.0008, t + (decay || dur));
    osc.start(t);
    osc.stop(t + (decay || dur) + 0.05);
  }

  /** Filtered noise burst — whooshes, impacts, footsteps, splashes. */
  noise(opts) {
    if (!this.ready) return;
    const {
      dur = 0.2, volume = 0.3, pos = null, filter = 1200, filterTo = null,
      type = 'bandpass', q = 1.0, attack = 0.005,
    } = opts;
    const chain = this._out(pos, volume, opts.bus);
    if (!chain) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t);
    if (filterTo !== null) f.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t + dur);
    f.Q.value = q;
    src.connect(f);
    f.connect(chain.gain);
    const g = chain.gain.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(chain.vol, t + attack);
    g.exponentialRampToValueAtTime(0.0008, t + dur);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // --------------------------------------------------------- game one-shots

  jump(pos) {
    // A rising croak — unmistakably a frog.
    this.tone({ freq: 190, to: 420, dur: 0.16, type: 'sawtooth', volume: 0.22, pos });
    this.tone({ freq: 95, to: 210, dur: 0.18, type: 'square', volume: 0.10, pos });
    this.noise({ dur: 0.12, volume: 0.10, pos, filter: 900, filterTo: 2600 });
  }

  doubleJump(pos) {
    this.tone({ freq: 320, to: 720, dur: 0.2, type: 'sawtooth', volume: 0.2, pos });
    this.tone({ freq: 640, to: 1180, dur: 0.16, type: 'triangle', volume: 0.14, pos });
    this.noise({ dur: 0.22, volume: 0.16, pos, filter: 500, filterTo: 4200, q: 0.7 });
  }

  land(pos, hard) {
    this.noise({
      dur: hard ? 0.25 : 0.13, volume: hard ? 0.34 : 0.16, pos,
      filter: hard ? 320 : 620, filterTo: 90, type: 'lowpass', q: 0.6,
    });
    if (hard) this.tone({ freq: 110, to: 45, dur: 0.2, type: 'sine', volume: 0.24, pos });
  }

  footstep(pos) {
    const t = performance.now();
    if (t - this._lastStep < 150) return;
    this._lastStep = t;
    this.noise({
      dur: 0.07, volume: 0.09, pos,
      filter: 900 + Math.random() * 700, filterTo: 260, type: 'lowpass', q: 0.8,
    });
  }

  dash(pos) {
    // Sharp air-tear: a fast downward noise sweep plus a metallic zip.
    this.noise({ dur: 0.34, volume: 0.42, pos, filter: 4200, filterTo: 260, q: 1.6 });
    this.tone({ freq: 1400, to: 220, dur: 0.22, type: 'sawtooth', volume: 0.16, pos });
    this.tone({ freq: 70, to: 40, dur: 0.3, type: 'sine', volume: 0.28, pos });
  }

  /** Sharp flick of a thrown kunai. */
  kunaiThrow(pos) {
    this.noise({ dur: 0.16, volume: 0.24, pos, filter: 5200, filterTo: 900, q: 2.6 });
    this.tone({ freq: 1500, to: 520, dur: 0.12, type: 'triangle', volume: 0.10, pos });
  }

  /** Steel turning steel aside — bright, metallic, satisfying. */
  parry(pos) {
    this.tone({ freq: 2400, to: 1500, dur: 0.22, type: 'triangle', volume: 0.2, pos });
    this.tone({ freq: 3600, to: 2600, dur: 0.14, type: 'sine', volume: 0.13, pos });
    this.noise({ dur: 0.16, volume: 0.24, pos, filter: 6000, filterTo: 2400, q: 4 });
  }

  /** Bright two-tone ping that cuts through everything else. */
  headshot(pos) {
    this.tone({ freq: 1750, dur: 0.1, type: 'square', volume: 0.16, pos });
    this.tone({ freq: 2600, to: 3300, dur: 0.16, type: 'triangle', volume: 0.13, pos });
    this.noise({ dur: 0.14, volume: 0.18, pos, filter: 5000, filterTo: 2200, q: 3 });
  }

  /** Chime when a supply crate is collected. */
  pickup(pos) {
    const notes = [660, 880, 1170];
    notes.forEach((f, i) => setTimeout(() => this.tone({
      freq: f, dur: 0.18, type: 'triangle', volume: 0.13, pos,
    }), i * 45));
  }

  /** Dull thud of straw taking a hit. */
  dummyHit(pos) {
    this.noise({ dur: 0.16, volume: 0.26, pos, filter: 900, filterTo: 200, type: 'lowpass', q: 0.8 });
    this.tone({ freq: 150, to: 70, dur: 0.14, type: 'sine', volume: 0.16, pos });
  }

  /** Winded gasp when stamina runs dry, and when an action is refused. */
  exhausted(pos) {
    this.noise({ dur: 0.34, volume: 0.20, pos, filter: 1500, filterTo: 380, q: 1.1 });
    this.tone({ freq: 200, to: 110, dur: 0.26, type: 'sawtooth', volume: 0.11, pos });
  }

  /** Soft chime when stamina recovers enough to act again. */
  refreshed(pos) {
    this.tone({ freq: 620, to: 880, dur: 0.2, type: 'triangle', volume: 0.11, pos });
    this.tone({ freq: 1240, dur: 0.14, type: 'sine', volume: 0.06, pos });
  }

  /** Low, airy rush repeated while sprinting. Kept quiet — it loops often. */
  sprintWhoosh(pos) {
    this.noise({
      dur: 0.42, volume: 0.075, pos,
      filter: 700, filterTo: 2100, q: 0.9, attack: 0.14,
    });
  }

  tongueFire(pos) {
    this.tone({ freq: 900, to: 180, dur: 0.18, type: 'square', volume: 0.13, pos });
    this.noise({ dur: 0.2, volume: 0.16, pos, filter: 2600, filterTo: 700, q: 2.5 });
  }

  tongueHit(pos) {
    // Wet slap.
    this.noise({ dur: 0.11, volume: 0.3, pos, filter: 1800, filterTo: 380, q: 1.2 });
    this.tone({ freq: 420, to: 130, dur: 0.1, type: 'sine', volume: 0.22, pos });
  }

  tongueRelease(pos) {
    this.tone({ freq: 500, to: 900, dur: 0.1, type: 'triangle', volume: 0.1, pos });
  }

  slash(pos, index = 0) {
    // Blade cutting air; the finisher is lower and heavier.
    const base = index === 2 ? 2600 : 3600 + index * 400;
    this.noise({ dur: 0.19, volume: 0.3, pos, filter: base, filterTo: 500, q: 2.2 });
    this.tone({
      freq: index === 2 ? 700 : 1150, to: index === 2 ? 190 : 320,
      dur: 0.14, type: 'triangle', volume: 0.12, pos,
    });
  }

  hit(pos, heavy) {
    // Meaty impact + a bright metallic ring.
    this.noise({ dur: heavy ? 0.24 : 0.15, volume: heavy ? 0.5 : 0.34, pos, filter: 800, filterTo: 110, type: 'lowpass', q: 0.7 });
    this.tone({ freq: heavy ? 150 : 210, to: 55, dur: 0.16, type: 'square', volume: 0.3, pos });
    this.tone({ freq: 2400, to: 1500, dur: 0.1, type: 'triangle', volume: 0.14, pos });
  }

  hurt(pos) {
    this.tone({ freq: 300, to: 130, dur: 0.24, type: 'sawtooth', volume: 0.24, pos });
    this.noise({ dur: 0.2, volume: 0.18, pos, filter: 700, filterTo: 200, type: 'lowpass' });
  }

  death(pos) {
    this.tone({ freq: 420, to: 60, dur: 0.75, type: 'sawtooth', volume: 0.3, pos });
    this.tone({ freq: 210, to: 40, dur: 0.9, type: 'square', volume: 0.18, pos });
    this.noise({ dur: 0.6, volume: 0.24, pos, filter: 1400, filterTo: 90, type: 'lowpass' });
  }

  respawn(pos) {
    // Bright ascending pentatonic sparkle.
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this.tone({
      freq: f, dur: 0.3, type: 'triangle', volume: 0.16, pos,
    }), i * 55));
  }

  splash(pos) {
    this.noise({ dur: 0.4, volume: 0.32, pos, filter: 2400, filterTo: 340, q: 0.9 });
  }

  wallJump(pos) {
    this.noise({ dur: 0.16, volume: 0.22, pos, filter: 1800, filterTo: 500, q: 1.4 });
    this.tone({ freq: 260, to: 520, dur: 0.14, type: 'square', volume: 0.14, pos });
  }

  uiHover() { this.tone({ freq: 720, dur: 0.06, type: 'triangle', volume: 0.10 }); }
  uiClick() {
    this.tone({ freq: 520, to: 880, dur: 0.11, type: 'square', volume: 0.14 });
    this.tone({ freq: 1200, dur: 0.07, type: 'triangle', volume: 0.08 });
  }
  uiBack() { this.tone({ freq: 480, to: 260, dur: 0.13, type: 'square', volume: 0.12 }); }

  /**
   * ── the two crate sets ────────────────────────────────────────────────
   *
   * Both are 2D (`pos` left null): the case is being opened on a menu, not
   * at a place in the world, so panning it would put the sound off to one
   * side of a thing that is dead centre of the screen.
   */

  /** Swampforged: a dry crack, then wet gas escaping. */
  crateCrack() {
    this.noise({ dur: 0.09, volume: 0.34, filter: 3200, filterTo: 900, q: 1.8 });
    this.tone({ freq: 150, to: 62, dur: 0.26, type: 'square', volume: 0.20 });
    // The hiss comes in a beat later, the way pressure does.
    this.tone({ freq: 90, to: 70, dur: 0.7, type: 'sawtooth', volume: 0.07, cutoff: 380 });
    this.noise({ dur: 0.85, volume: 0.14, filter: 700, filterTo: 260, q: 0.7, attack: 0.14 });
  }

  /** Celestial: a rising swell that resolves into a bright fifth. */
  crateLift() {
    this.tone({ freq: 180, to: 540, dur: 1.1, type: 'triangle', volume: 0.16, attack: 0.25 });
    this.tone({ freq: 270, to: 810, dur: 1.1, type: 'sine', volume: 0.11, attack: 0.3 });
    this.noise({ dur: 1.0, volume: 0.09, filter: 500, filterTo: 4200, q: 0.6, attack: 0.4 });
  }

  /** The one Mythic. Deliberately the biggest noise the shop can make. */
  crateMythic() {
    this.tone({ freq: 880, dur: 1.5, type: 'sine', volume: 0.20, attack: 0.02 });
    this.tone({ freq: 1320, dur: 1.5, type: 'triangle', volume: 0.14, attack: 0.06 });
    this.tone({ freq: 220, to: 440, dur: 1.6, type: 'sawtooth', volume: 0.10, cutoff: 900 });
    this.noise({ dur: 1.4, volume: 0.12, filter: 6000, filterTo: 800, q: 0.8 });
  }

  /**
   * ── the eclipse ───────────────────────────────────────────────────────
   *
   * The secret sequence is built on ABSENCE, so its sounds go the other way
   * from every other crate noise in here. Nothing bright, nothing that
   * resolves; a low bed that grows under a room that has gone quiet.
   */

  /** The moment the light goes. Sub-bass and a long breath downward. */
  eclipseFall() {
    this.tone({ freq: 110, to: 41, dur: 2.6, type: 'sine', volume: 0.26, attack: 0.5 });
    this.tone({ freq: 55, to: 27, dur: 3.0, type: 'triangle', volume: 0.18, attack: 0.8 });
    this.noise({ dur: 2.8, volume: 0.10, filter: 900, filterTo: 140, q: 0.5, attack: 0.9 });
  }

  /** The presence. A minor cluster that hangs without ever settling. */
  eclipsePresence() {
    this.tone({ freq: 146.8, dur: 3.2, type: 'sine', volume: 0.13, attack: 0.7 });
    this.tone({ freq: 174.6, dur: 3.2, type: 'sine', volume: 0.11, attack: 0.9 });
    this.tone({ freq: 220, dur: 3.4, type: 'triangle', volume: 0.08, attack: 1.2 });
    this.noise({ dur: 3.0, volume: 0.06, filter: 260, filterTo: 520, q: 0.7, attack: 1.0 });
  }

  /** The item lands. The only bright thing in the whole sequence. */
  eclipseReveal() {
    this.tone({ freq: 73.4, to: 587, dur: 1.8, type: 'sawtooth', volume: 0.16, cutoff: 2600, attack: 0.04 });
    this.tone({ freq: 1174, dur: 1.9, type: 'sine', volume: 0.17, attack: 0.02 });
    this.tone({ freq: 1760, dur: 1.9, type: 'triangle', volume: 0.10, attack: 0.10 });
    this.noise({ dur: 1.6, volume: 0.14, filter: 7000, filterTo: 600, q: 0.8 });
  }

  /**
   * Pull the music down out of the way, and put it back.
   *
   * Rides `musicBus` rather than `volumes.music`, so the player's own music
   * setting is never touched — duck and restore are presentation, and a
   * cutscene interrupted half way must not leave a changed slider behind.
   */
  duckMusic(level = 0.12, secs = 1.2) {
    if (!this.ready || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.volumes.music * level, t + secs);
  }

  unduckMusic(secs = 1.2) {
    if (!this.ready || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.volumes.music, t + secs);
  }

  // ---------------------------------------------------------------- ambient

  /** Continuous wind bed; call once when gameplay starts. */
  startAmbient() {
    if (!this.ready || this._ambient) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    f.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.075, t + 2.5);
    // Slow LFO on the cutoff makes the wind gust instead of hiss.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 230;
    lfo.connect(lfoGain);
    lfoGain.connect(f.frequency);
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t); lfo.start(t);
    this._ambient = { src, g, lfo };
  }

  stopAmbient() {
    // The open world's music rides on the ambient wind, so it goes with it.
    // Leaving it playing meant the Frostmarch's theme following you into the
    // menu and then into an arena match.
    this.stopRegionMusic();
    this.stopTheme();
    if (!this._ambient) return;
    const t = this.ctx.currentTime;
    this._ambient.g.gain.linearRampToValueAtTime(0, t + 0.6);
    const a = this._ambient;
    setTimeout(() => { try { a.src.stop(); a.lfo.stop(); } catch (e) { /* already stopped */ } }, 800);
    this._ambient = null;
  }

  /**
   * Occasional birds/frogs. Driven from the game loop.
   *
   * What you hear depends on where you are standing: the open world sets a
   * MOOD per region (see `setRegionMood`) and this picks the flavour from it.
   * That is most of what makes a region sound different — the wind bed and
   * the music underneath it change slowly, but the incidental noises are what
   * you actually notice.
   */
  updateAmbient(dt) {
    if (!this.ready) return;
    this._birdTimer -= dt;
    if (this._birdTimer > 0) return;
    const M = MOODS[this._mood] || MOODS.calm;
    this._birdTimer = M.gap[0] + Math.random() * (M.gap[1] - M.gap[0]);
    const roll = Math.random();
    switch (M.voice) {
      case 'croak': {
        const f = 100 + Math.random() * 70;
        this.tone({ freq: f, to: f * 1.7, dur: 0.24, type: 'sawtooth', volume: 0.055 });
        if (roll < 0.4) {
          setTimeout(() => this.tone({ freq: f * 0.8, to: f * 1.2, dur: 0.3,
            type: 'sawtooth', volume: 0.04 }), 320);
        }
        break;
      }
      case 'bell': {
        const f = 520 + Math.floor(Math.random() * 4) * 130;
        this.tone({ freq: f, dur: 2.6, type: 'sine', volume: 0.05, attack: 0.01 });
        this.tone({ freq: f * 2.01, dur: 1.6, type: 'sine', volume: 0.02 });
        break;
      }
      case 'groan': {
        const f = 58 + Math.random() * 26;
        this.tone({ freq: f * 1.4, to: f, dur: 2.2, type: 'triangle', volume: 0.06 });
        this.noise({ dur: 1.6, volume: 0.03, filter: 260, filterTo: 120, q: 1.2 });
        break;
      }
      case 'crackle':
        this.noise({ dur: 0.4, volume: 0.05, filter: 2400, filterTo: 700, q: 0.8 });
        if (roll < 0.5) {
          setTimeout(() => this.noise({ dur: 0.24, volume: 0.035,
            filter: 3200, filterTo: 900 }), 210);
        }
        break;
      case 'chime': {
        const f = 1200 + Math.floor(Math.random() * 5) * 220;
        this.tone({ freq: f, dur: 1.4, type: 'sine', volume: 0.035 });
        this.tone({ freq: f * 1.5, dur: 1.0, type: 'sine', volume: 0.02 });
        break;
      }
      case 'ping': {
        const f = 700 + Math.random() * 900;
        this.tone({ freq: f, to: f * 1.9, dur: 0.5, type: 'sine', volume: 0.04 });
        break;
      }
      default: {
        if (roll < 0.55) {
          // Bird chirp: two quick rising blips.
          const f = 1800 + Math.random() * 1400;
          this.tone({ freq: f, to: f * 1.5, dur: 0.09, type: 'sine', volume: 0.05 });
          setTimeout(() => this.tone({ freq: f * 1.2, to: f * 0.85, dur: 0.11,
            type: 'sine', volume: 0.045 }), 110);
        } else {
          const f = 120 + Math.random() * 60;
          this.tone({ freq: f, to: f * 1.6, dur: 0.2, type: 'sawtooth', volume: 0.05 });
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------- region moods

  /**
   * Put the world into a region's mood.
   *
   * Three things change: the wind bed's filter and level, which incidental
   * noises play, and the slow music underneath. The music is rebuilt only
   * when the mood actually changes — crossing a border must not restart the
   * theme you were already listening to.
   */
  setRegionMood(mood) {
    if (!this.ready || this._mood === mood) return;
    this._mood = mood;
    const M = MOODS[mood] || MOODS.calm;
    // Retune the wind. It is one filtered noise loop for the whole session,
    // so this is a ramp rather than a rebuild.
    if (this._ambient) {
      try {
        this._ambient.g.gain.linearRampToValueAtTime(
          M.wind, this.ctx.currentTime + 2.5);
      } catch (e) { /* a stopped node; harmless */ }
    }
    // A composed theme outranks the bed. `setTheme` is what the open world
    // actually uses now; the bed survives as the fallback for anywhere that
    // sets a mood without naming a piece of music.
    if (this._theme) return;
    this.stopRegionMusic();
    this._startRegionBed(M);
  }

  /**
   * The bed: a drone and a very slow figure over it.
   *
   * Deliberately sparse — one note every two to four seconds. This plays for
   * as long as the player is in a region, which can be twenty minutes, and
   * anything busier becomes wallpaper you want to turn off.
   */
  _startRegionBed(M) {
    if (!this.ready || this._region) return;
    const t = this.ctx.currentTime;
    const pad = this.ctx.createGain();
    pad.gain.value = 0;
    pad.gain.linearRampToValueAtTime(M.pad, t + 4);
    pad.connect(this.musicBus);
    const oscs = [];
    for (const mult of M.drone) {
      const o = this.ctx.createOscillator();
      o.type = M.wave;
      o.frequency.value = M.root * mult;
      o.detune.value = (Math.random() - 0.5) * 14;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = M.cutoff;
      o.connect(lp); lp.connect(pad);
      o.start(t);
      oscs.push(o);
    }
    let step = 0;
    const timer = setInterval(() => {
      if (!this._region) return;
      const deg = M.scale[(step * 3 + ((step / 4) | 0)) % M.scale.length];
      const oct = step % 12 < 6 ? 2 : 4;
      const freq = M.root * oct * Math.pow(2, deg / 12);
      this.tone({
        freq, dur: M.hold, type: M.lead, volume: M.note,
        bus: this.musicBus, attack: 0.05,
      });
      if (step % 5 === 0) {
        this.tone({ freq: freq * 1.5, dur: M.hold * 0.7, type: 'sine',
          volume: M.note * 0.45, bus: this.musicBus, attack: 0.08 });
      }
      step++;
    }, M.tempo);
    this._region = { timer, pad, oscs };
  }

  stopRegionMusic() {
    if (!this._region) return;
    const r = this._region;
    this._region = null;
    clearInterval(r.timer);
    try {
      const t = this.ctx.currentTime;
      r.pad.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => {
        for (const o of r.oscs) { try { o.stop(); } catch (e) { /* gone */ } }
      }, 1500);
    } catch (e) { /* context torn down */ }
    this._mood = null;
  }

  // ------------------------------------------------------------- the score

  /**
   * PLAY A PIECE OF MUSIC.
   *
   * `theme` is one of the objects in js/themes.js — a key, a scale, a chord
   * per bar, a tempo and a level for each of the five voices. `id` names it,
   * and asking for the piece that is already playing does nothing: the caller
   * can hand this the same theme every frame, which is exactly what the open
   * world does.
   *
   * Passing null stops the music.
   */
  setTheme(theme, id) {
    if (!this.ready) return;
    const key = id || (theme && theme.id) || 'theme';
    if (this._theme && this._theme.id === key) return;
    this.stopTheme();
    if (!theme) return;
    /**
     * ═══ AND NOTHING HERE MAY THROW ════════════════════════════════════════
     *
     * Two guards, because music failing is never worth breaking a game over.
     *
     * `asTheme` fills in every field from the defaults in js/themes.js. A
     * theme missing one is not a quieter theme — the numbers go straight
     * into Web Audio, `undefined * 0.5` is NaN, and an `AudioParam` handed a
     * non-finite value throws a TypeError.
     *
     * And the try/catch is the backstop, because of where that throw landed
     * the one time it happened. The coronation was built with a hand-written
     * theme object of the wrong shape; `linearRampToValueAtTime(NaN)` threw
     * inside `Flashbacks.scene` AFTER it had set `busy`, raised the wash and
     * taken the camera, and BEFORE it started the dialogue whose ending hook
     * gives all three back. The last scene in the game froze on a white
     * screen with no way out of it.
     *
     * A cutscene must not be able to be killed by its own soundtrack.
     */
    try {
      this._startTheme(asTheme(theme), key);
    } catch (e) {
      this._theme = null;
      console.warn('[frogshin] theme failed to start:', key, e && e.message);
    }
  }

  /** Which piece is playing, or null. Cheap enough to poll. */
  get themeId() { return this._theme ? this._theme.id : null; }

  /**
   * Build one theme and start its clock.
   *
   * The clock is a sixteenth-note grid: `bpm` gives the beat, a bar is four
   * beats and a step is a sixteenth, so every voice can be written as "on
   * these steps". Swing pushes every second sixteenth late — the difference
   * between a village that trudges and one that has a market in it.
   */
  _startTheme(T, id) {
    // Two beds at once would be mud, and the bed is the poorer of the two.
    this.stopRegionMusic();
    const t = this.ctx.currentTime;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(1, t + 2.2);
    gain.connect(this.musicBus);

    // A sustained root underneath everything, so the gaps between bars are
    // still the same place. Only the tonic and its octave — a fifth would
    // fight the diminished chords the late regions are built on.
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0;
    droneGain.gain.linearRampToValueAtTime(T.pad * 0.5, t + 4);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(160, T.cutoff * 0.5);
    lp.connect(droneGain);
    droneGain.connect(gain);
    const oscs = [];
    for (const mult of [0.25, 0.5]) {
      const o = this.ctx.createOscillator();
      o.type = T.padWave;
      o.frequency.value = T.root * mult;
      o.detune.value = (Math.random() - 0.5) * 10;
      o.connect(lp);
      o.start(t);
      oscs.push(o);
    }

    const stepSec = 60 / T.bpm / 4;
    const leadBase = T.root * Math.pow(2, (T.octave || 4) - 3);
    const motif = T.motif || '';

    /** How long a lead note rings: until the next one, roughly. */
    const leadLen = (at) => {
      let n = 1;
      while (n < 8 && motif[(at + n) % motif.length] === '-') n++;
      return Math.min(T.hold, Math.max(0.18, n * stepSec * 0.92));
    };

    /** One sixteenth of the piece. */
    const voice = (i) => {
      if (!this._theme || this._theme.id !== id) return;
      const s = i % 16;
      const bar = Math.floor(i / 16);
      const chord = T.chords[bar % T.chords.length];
      const beat = stepSec * 4;

      // pad — the chord, once a bar, breathing in slowly.
      if (s === 0 && T.pad > 0) {
        for (const c of chord) {
          this.tone({
            freq: T.root * Math.pow(2, c / 12), dur: T.hold, type: T.padWave,
            volume: T.pad, bus: gain, attack: Math.min(1.2, T.hold * 0.35),
            cutoff: T.cutoff,
          });
        }
      }

      // bass — the root of the chord. Twice a bar, four times if it drives.
      if (T.bass > 0 && (s === 0 || s === 8
        || (T.perc > 0 && (s === 6 || s === 14)))) {
        this.tone({
          freq: T.root * 0.5 * Math.pow(2, chord[0] / 12),
          dur: beat * 0.85, type: T.bassWave, volume: T.bass, bus: gain,
          attack: 0.012, cutoff: 520,
        });
      }

      // lead — the tune. A digit is a degree of the scale, `-` is a rest,
      // and a degree past the top of the scale wraps into the next octave.
      const ch = motif[i % Math.max(1, motif.length)];
      if (T.lead > 0 && ch >= '0' && ch <= '9') {
        const d = +ch;
        const sc = T.scale;
        const semi = sc[d % sc.length] + 12 * Math.floor(d / sc.length);
        this.tone({
          freq: leadBase * Math.pow(2, semi / 12), dur: leadLen(i),
          type: T.leadWave, volume: T.lead, bus: gain, attack: 0.02,
          cutoff: T.cutoff * 2.2,
        });
      }

      // pluck — an arpeggio through the chord, quieter under the tune than
      // it is in the holes the tune leaves.
      if (T.pluck > 0 && s % 2 === 1) {
        const n = chord[Math.floor(i / 2) % chord.length];
        this.tone({
          freq: T.root * 2 * Math.pow(2, n / 12), dur: stepSec * 2.4,
          type: T.pluckWave, volume: T.pluck * (ch === '-' ? 1 : 0.5),
          bus: gain, attack: 0.006, cutoff: T.cutoff * 2.6,
        });
      }

      // perc — kick, snare and a hat. Only where a place has a pulse.
      if (T.perc > 0) {
        if (s === 0 || s === 8) {
          this.noise({
            dur: 0.20, volume: T.perc * 1.4, filter: 230, filterTo: 55,
            type: 'lowpass', bus: gain,
          });
        } else if (s === 4 || s === 12) {
          this.noise({
            dur: 0.16, volume: T.perc, filter: 1700, filterTo: 620, q: 1.1,
            bus: gain,
          });
        } else if (s % 2 === 0) {
          this.noise({
            dur: 0.05, volume: T.perc * 0.32, filter: 7200, type: 'highpass',
            q: 0.8, bus: gain,
          });
        }
      }
    };

    /**
     * The clock. Kept as a named closure because `bossPhase` re-arms the
     * interval at a shorter period when a guardian changes shape.
     */
    const beat = () => {
      const th = this._theme;
      if (!th || th.id !== id) return;
      const i = th.step++;
      const sw = T.swing * stepSec * 500;
      if (sw > 1 && i % 2 === 1) setTimeout(() => voice(i), sw);
      else voice(i);
    };

    const period = Math.max(45, stepSec * 1000);
    this._theme = {
      id, T, gain, droneGain, oscs, beat, step: 0,
      period, basePeriod: period, timer: null, phase: 1,
    };
    this._theme.timer = setInterval(beat, this._theme.period);
    beat();
  }

  /** Fade the current piece out and let its tail ring. */
  stopTheme(fade = 0.9) {
    if (!this._theme) return;
    const th = this._theme;
    this._theme = null;
    clearInterval(th.timer);
    try {
      const t = this.ctx.currentTime;
      th.gain.gain.cancelScheduledValues(t);
      th.gain.gain.setValueAtTime(th.gain.gain.value, t);
      th.gain.gain.linearRampToValueAtTime(0, t + fade);
    } catch (e) { /* context torn down */ }
    setTimeout(() => {
      for (const o of th.oscs) { try { o.stop(); } catch (e) { /* gone */ } }
      try { th.gain.disconnect(); } catch (e) { /* gone */ }
    }, Math.ceil(fade * 1000) + 300);
  }

  // ------------------------------------------------------------------ music

  /**
   * Menu theme: a slow pentatonic koto-style arpeggio over a soft pad.
   * Scheduled note-by-note on a timer rather than pre-rendered.
   */
  startMenuMusic() {
    if (!this.ready || this._music) return;
    const scale = [0, 2, 4, 7, 9];         // major pentatonic
    const root = 220;
    let step = 0;

    // Warm drone pad underneath.
    const t = this.ctx.currentTime;
    const pad = this.ctx.createGain();
    pad.gain.value = 0;
    pad.gain.linearRampToValueAtTime(0.06, t + 3);
    pad.connect(this.musicBus);
    const oscs = [];
    for (const mult of [1, 1.5, 2.005]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = root * 0.5 * mult;
      o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(pad);
      o.start(t);
      oscs.push(o);
    }

    const timer = setInterval(() => {
      if (!this._music) return;
      const oct = step % 16 < 8 ? 1 : 2;
      const deg = scale[(step * 3 + Math.floor(step / 5)) % scale.length];
      const freq = root * oct * Math.pow(2, deg / 12);
      this.tone({ freq, dur: 1.1, type: 'triangle', volume: 0.11, bus: this.musicBus, attack: 0.012 });
      // Occasional fifth above for a bit of shimmer.
      if (step % 4 === 0) {
        this.tone({ freq: freq * 1.5, dur: 0.9, type: 'sine', volume: 0.05, bus: this.musicBus });
      }
      step++;
    }, 430);

    this._music = { timer, pad, oscs };
  }

  /** Sharp attention cue for a tutorial prompt. */
  cue(pos) {
    this.tone({ freq: 880, to: 1320, dur: 0.16, type: 'square', volume: 0.16, pos });
    this.tone({ freq: 1760, dur: 0.1, type: 'triangle', volume: 0.09, pos });
  }

  /**
   * Boss theme: a driving low ostinato under a slow, menacing motif in a
   * minor scale. Scheduled note-by-note like the menu theme.
   */
  startBossMusic() {
    if (!this.ready || this._boss) return;
    const t = this.ctx.currentTime;

    // Pulsing sub drone.
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0;
    droneGain.gain.linearRampToValueAtTime(0.10, t + 2.0);
    droneGain.connect(this.musicBus);
    const oscs = [];
    for (const f of [55, 55.6, 82.5]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = 0.34;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      o.connect(lp); lp.connect(g); g.connect(droneGain);
      o.start(t);
      oscs.push(o);
    }

    // Natural minor — tense without being atonal.
    const scale = [0, 2, 3, 5, 7, 8, 10];
    const root = 110;
    let step = 0;

    /**
     * One beat of the bed, kept as a named closure.
     *
     * `bossPhase` re-arms the interval at a shorter period when a guardian
     * changes shape, and it can only do that if there is something to re-arm
     * it with — an anonymous callback passed straight to setInterval is gone
     * the moment the handle is cleared.
     */
    const beat = () => {
      if (!this._boss) return;
      // Driving eighth-note pulse on the root.
      this.tone({
        freq: root, dur: 0.16, type: 'square', volume: 0.09,
        bus: this.musicBus, attack: 0.004,
      });
      if (step % 2 === 1) {
        this.tone({
          freq: root * 1.5, dur: 0.12, type: 'square', volume: 0.05,
          bus: this.musicBus, attack: 0.004,
        });
      }
      // A slower motif riding on top.
      if (step % 4 === 0) {
        const deg = scale[(Math.floor(step / 4) * 2) % scale.length];
        this.tone({
          freq: root * 2 * Math.pow(2, deg / 12), dur: 0.7,
          type: 'sawtooth', volume: 0.07, bus: this.musicBus, attack: 0.02,
        });
      }
      // Percussive hit on the downbeat.
      if (step % 8 === 0) {
        this.noise({
          dur: 0.22, volume: 0.13, filter: 260, filterTo: 60,
          type: 'lowpass', bus: this.musicBus,
        });
      }
      step++;
    };
    const timer = setInterval(beat, 250);

    this._boss = { timer, droneGain, oscs, beat, period: 250, phase: 1 };
  }

  /**
   * A guardian has changed phase.
   *
   * A sting on top, and the bed underneath tightens: shorter beat, louder
   * drone. Nothing about it is required for the fight to work — the fight
   * announces itself on screen too — but a phase change that sounds the same
   * as the phase before it does not land as a phase change.
   */
  bossPhase(n) {
    this.tone({ freq: 88, to: 320, dur: 1.2, type: 'sawtooth', volume: 0.24 });
    this.tone({ freq: 640, to: 210, dur: 0.9, type: 'triangle', volume: 0.15 });
    this.noise({
      dur: 0.75, volume: 0.20, filter: 900, filterTo: 110, type: 'lowpass',
    });
    // A composed fight tightens the same way: the grid speeds up by 7% a
    // phase, so the theme you have been hearing gets harder rather than
    // being swapped for a different one halfway through the fight.
    if (this._theme) {
      const th = this._theme;
      th.phase = n;
      clearInterval(th.timer);
      th.period = Math.max(45, th.basePeriod * Math.pow(0.93, Math.max(0, n - 1)));
      th.timer = setInterval(th.beat, th.period);
    }
    if (!this._boss) return;
    this._boss.phase = n;
    clearInterval(this._boss.timer);
    this._boss.period = Math.max(150, 250 - (n - 1) * 34);
    this._boss.timer = setInterval(this._boss.beat, this._boss.period);
    const t = this.ctx.currentTime;
    this._boss.droneGain.gain.linearRampToValueAtTime(
      Math.min(0.19, 0.10 + n * 0.025), t + 1.0);
  }

  // ------------------------------------------------------------ music files

  /**
   * Fetch and decode a track, once. Resolves to null if it is not there.
   *
   * A missing file is remembered as 'missing' so a boss that asks for its
   * track on every phase change does not re-request a 404 each time.
   */
  async _load(name) {
    if (!this.ready) return null;
    const cached = this._buffers.get(name);
    if (cached) return cached === 'missing' ? null : cached;
    if (this._fetching.has(name)) return this._fetching.get(name);

    const url = TRACKS[name];
    if (!url) return null;
    const job = (async () => {
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) throw new Error(String(res.status));
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this._buffers.set(name, buf);
        return buf;
      } catch (e) {
        // Absent or undecodable. Not an error worth breaking a fight over.
        this._buffers.set(name, 'missing');
        return null;
      } finally {
        this._fetching.delete(name);
      }
    })();
    this._fetching.set(name, job);
    return job;
  }

  /** Warm the cache so a cue does not wait on the network mid-fight. */
  prefetchTracks(names) {
    if (!this.ready) return;
    for (const n of (names || Object.keys(TRACKS))) this._load(n);
  }

  /** True once we know whether a track exists (either way). */
  trackKnown(name) { return this._buffers.has(name); }
  trackAvailable(name) {
    const b = this._buffers.get(name);
    return !!b && b !== 'missing';
  }

  /**
   * Start a music track.
   *
   * @param name    key in TRACKS
   * @param opts    { loop, volume, fade, from, fallback }
   *
   * If the file is missing, `fallback` decides what happens: 'boss' (the
   * default) starts the synthesized boss music instead, and false leaves it
   * silent — which is what the ascension cutscene wants, because its silence
   * is the point.
   */
  playTrack(name, opts = {}) {
    if (!this.ready) return;
    const fade = opts.fade === undefined ? 0.8 : opts.fade;
    this._load(name).then((buf) => {
      if (!buf) {
        const fb = opts.fallback === undefined ? 'boss' : opts.fallback;
        if (fb === 'boss') this.startBossMusic();
        return;
      }
      // A second call for a track already playing is a no-op, so a phase
      // that re-asserts its music does not restart it.
      if (this._playing.has(name)) return;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.musicBus);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = !!opts.loop;
      src.connect(gain);
      const t = this.ctx.currentTime;
      const vol = opts.volume === undefined ? 0.9 : opts.volume;
      gain.gain.linearRampToValueAtTime(vol, t + fade);
      src.start(0, opts.from || 0);
      const entry = { src, gain, vol };
      this._playing.set(name, entry);
      src.onended = () => {
        if (this._playing.get(name) === entry) this._playing.delete(name);
      };
    });
  }

  /** Fade a track out and let it go. Safe to call when it is not playing. */
  stopTrack(name, fade = 0.6) {
    const e = this._playing.get(name);
    if (!e) return;
    this._playing.delete(name);
    const t = this.ctx.currentTime;
    try {
      e.gain.gain.cancelScheduledValues(t);
      e.gain.gain.setValueAtTime(e.gain.gain.value, t);
      e.gain.gain.linearRampToValueAtTime(0, t + fade);
    } catch (err) { /* noop */ }
    setTimeout(() => { try { e.src.stop(); } catch (err) { /* noop */ } },
      Math.ceil(fade * 1000) + 120);
  }

  stopAllTracks(fade = 0.5) {
    for (const name of Array.from(this._playing.keys())) this.stopTrack(name, fade);
  }

  /**
   * Play the opening of a track as a one-shot sting.
   *
   * This is how the Frogath skin borrows the ascension music for its
   * transformation: the same cue the boss uses, cut to length.
   */
  sting(name, duration = 2.2, volume = 0.8) {
    if (!this.ready) return;
    this._load(name).then((buf) => {
      if (!buf) return;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.musicBus);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      const t = this.ctx.currentTime;
      gain.gain.linearRampToValueAtTime(volume, t + 0.08);
      gain.gain.setValueAtTime(volume, t + Math.max(0.1, duration - 0.5));
      gain.gain.linearRampToValueAtTime(0, t + duration);
      src.start();
      setTimeout(() => { try { src.stop(); } catch (e) { /* noop */ } },
        Math.ceil(duration * 1000) + 150);
    });
  }

  stopBossMusic() {
    if (!this._boss) return;
    clearInterval(this._boss.timer);
    const t = this.ctx.currentTime;
    this._boss.droneGain.gain.linearRampToValueAtTime(0, t + 1.2);
    const b = this._boss;
    setTimeout(() => { for (const o of b.oscs) { try { o.stop(); } catch (e) { /* noop */ } } }, 1500);
    this._boss = null;
  }

  stopMenuMusic() {
    if (!this._music) return;
    clearInterval(this._music.timer);
    const t = this.ctx.currentTime;
    this._music.pad.gain.linearRampToValueAtTime(0, t + 1.0);
    const m = this._music;
    setTimeout(() => { for (const o of m.oscs) { try { o.stop(); } catch (e) { /* noop */ } } }, 1200);
    this._music = null;
  }
}

export const Audio = new AudioEngine();
