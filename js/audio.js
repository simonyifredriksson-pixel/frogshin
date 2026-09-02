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
const TRACKS = {
  phase1: 'audio/frogath-phase1.mp3',
  ascension: 'audio/frogath-ascension.mp3',
  ascended: 'audio/frogath-ascended.mp3',
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

  /** A pitched tone with an optional glide and a percussive envelope. */
  tone(opts) {
    if (!this.ready) return;
    const {
      freq = 440, to = null, dur = 0.2, type = 'sine', volume = 0.3,
      pos = null, attack = 0.005, decay = null, detune = 0,
    } = opts;
    const chain = this._out(pos, volume, opts.bus);
    if (!chain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    osc.detune.value = detune;
    osc.connect(chain.gain);
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
    if (!this._ambient) return;
    const t = this.ctx.currentTime;
    this._ambient.g.gain.linearRampToValueAtTime(0, t + 0.6);
    const a = this._ambient;
    setTimeout(() => { try { a.src.stop(); a.lfo.stop(); } catch (e) { /* already stopped */ } }, 800);
    this._ambient = null;
  }

  /** Occasional birds/frogs. Driven from the game loop. */
  updateAmbient(dt) {
    if (!this.ready) return;
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 4 + Math.random() * 9;
      if (Math.random() < 0.55) {
        // Bird chirp: two quick rising blips.
        const f = 1800 + Math.random() * 1400;
        this.tone({ freq: f, to: f * 1.5, dur: 0.09, type: 'sine', volume: 0.05 });
        setTimeout(() => this.tone({ freq: f * 1.2, to: f * 0.85, dur: 0.11, type: 'sine', volume: 0.045 }), 110);
      } else {
        // Distant frog croak.
        const f = 120 + Math.random() * 60;
        this.tone({ freq: f, to: f * 1.6, dur: 0.2, type: 'sawtooth', volume: 0.05 });
      }
    }
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

    const timer = setInterval(() => {
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
    }, 250);

    this._boss = { timer, droneGain, oscs };
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
