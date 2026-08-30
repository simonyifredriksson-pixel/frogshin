/**
 * FROGSHIN — entry point.
 *
 * Owns the renderer, the mode state machine (menu / loading / playing /
 * paused), and the glue between the gameplay systems and the network layer.
 */

import * as THREE from '../lib/three.module.js?v=v10';
import { CFG, BUILD, FROG_COLORS, NINJA_NAMES } from './config.js?v=v10';
import { clamp, pick, roomCode as makeRoomCode } from './util.js?v=v10';
import { Input } from './input.js?v=v10';
import { Audio } from './audio.js?v=v10';
import { World } from './world.js?v=v10';
import { Effects } from './effects.js?v=v10';
import { Atmosphere } from './atmosphere.js?v=v10';
import { FollowCamera } from './camera.js?v=v10';
import { Player } from './player.js?v=v10';
import { RemotePlayer } from './remote.js?v=v10';
import { HUD } from './hud.js?v=v10';
import { KunaiSystem, PickupSystem } from './items.js?v=v10';
import { DummyField } from './dummy.js?v=v10';
import { RoundManager, PHASE, maxTaggers } from './rounds.js?v=v10';
import { StoryMode, STORY_PHASE, STORY_PHASE_CODE, PRISON_CODE } from './story.js?v=v10';
import { MenuScene } from './menu.js?v=v10';
import { Network, NetRole } from './net.js?v=v10';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;

const QUALITY = {
  crisp:  { scale: null, shadows: true,  pixelated: false, leaves: 300, clouds: 28 },
  pixel:  { scale: 0.60, shadows: true,  pixelated: true,  leaves: 260, clouds: 26 },
  chunky: { scale: 0.42, shadows: false, pixelated: true,  leaves: 180, clouds: 20 },
  potato: { scale: 0.34, shadows: false, pixelated: true,  leaves: 90,  clouds: 12 },
};

class Game {
  constructor() {
    this.mode = 'menu';
    this.canvas = $('canvas');
    this.clock = now();
    this.lastFrame = this.clock;
    this.remotes = new Map();
    this._pendingJoins = new Map();
    this._ctpShown = false;
    this.settings = this.loadSettings();

    this._initRenderer();
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    this.input.onLockChange = (locked) => this._onLockChange(locked);

    this.net = new Network();
    this._wireNetwork();

    this.hud = new HUD();
    this.hud.show(false);

    this.menuScene = new MenuScene(this.renderer);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this._buildMenuUI();
    this._applyQuality(this.settings.quality);

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ------------------------------------------------------------- renderer

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,           // the pixel-art look does not want AA
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x8ec9e8);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
  }

  _applyQuality(name) {
    const q = QUALITY[name] || QUALITY.pixel;
    this.quality = q;
    this.settings.quality = name;
    this.canvas.classList.toggle('pixelated', q.pixelated);
    const shadowsChanged = this.renderer.shadowMap.enabled !== q.shadows;
    this.renderer.shadowMap.enabled = q.shadows;
    if (this.atmo && this.atmo.sun) this.atmo.sun.castShadow = q.shadows;
    if (this.menuScene && this.menuScene.atmo.sun) this.menuScene.atmo.sun.castShadow = q.shadows;
    // Toggling the shadow map changes the shader permutation, so every
    // material has to be told to recompile.
    if (shadowsChanged) {
      for (const s of [this.scene, this.menuScene && this.menuScene.scene]) {
        if (!s) continue;
        s.traverse((o) => {
          if (!o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.needsUpdate = true;
        });
      }
    }
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const q = this.quality || QUALITY.pixel;
    const ratio = q.scale === null ? Math.min(window.devicePixelRatio || 1, 2) : q.scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.menuScene) this.menuScene.resize(w, h);
  }

  // -------------------------------------------------------------- settings

  loadSettings() {
    const defaults = {
      name: pick(NINJA_NAMES),
      colorIndex: Math.floor(Math.random() * FROG_COLORS.length),
      sensitivity: 1.0,
      invertY: false,
      master: 0.85,
      sfx: 1.0,
      music: 0.5,
      quality: 'pixel',
    };
    try {
      const raw = localStorage.getItem('frogshin.settings');
      if (raw) return Object.assign(defaults, JSON.parse(raw));
    } catch (e) { /* storage can be blocked; defaults are fine */ }
    return defaults;
  }

  saveSettings() {
    try { localStorage.setItem('frogshin.settings', JSON.stringify(this.settings)); }
    catch (e) { /* non-fatal */ }
  }

  get profile() {
    return {
      name: (this.settings.name || 'Frog').slice(0, 14),
      color: FROG_COLORS[this.settings.colorIndex % FROG_COLORS.length],
    };
  }

  // ------------------------------------------------------------- menu UI

  _buildMenuUI() {
    const panels = ['home', 'play', 'lobby', 'howto', 'settings', 'credits'];
    this.showPanel = (name) => {
      for (const p of panels) $('panel-' + p).classList.toggle('active', p === name);
      Audio.uiClick();
    };

    // Any interaction is a valid gesture to start audio with.
    const arm = () => { Audio.init(); Audio.resume(); Audio.startMenuMusic(); };
    document.addEventListener('pointerdown', arm, { once: true });
    document.addEventListener('keydown', arm, { once: true });

    for (const btn of document.querySelectorAll('.btn')) {
      btn.addEventListener('mouseenter', () => Audio.uiHover());
    }

    $('btn-play').onclick = () => this.showPanel('play');
    $('btn-howto').onclick = () => this.showPanel('howto');
    $('btn-settings').onclick = () => this.showPanel('settings');
    $('btn-credits').onclick = () => this.showPanel('credits');
    for (const b of document.querySelectorAll('.btn-back')) {
      b.onclick = () => {
        Audio.uiBack();
        // Settings opened from the pause menu must go BACK to the pause menu.
        // Dropping to the main menu used to leave the match half-exited, so
        // pressing Play again restarted the level from scratch.
        if (this._settingsFromPause) {
          this._settingsFromPause = false;
          $('menu').classList.remove('show');
          $('pause').classList.add('show');
          return;
        }
        this.showPanel('home');
      };
    }

    // --- identity ---
    const nameInput = $('input-name');
    nameInput.value = this.settings.name;
    nameInput.addEventListener('input', () => {
      this.settings.name = nameInput.value.slice(0, 14) || 'Frog';
      this.saveSettings();
    });

    const swatches = $('color-picker');
    FROG_COLORS.forEach((c, i) => {
      const el = document.createElement('button');
      el.className = 'swatch-btn';
      el.style.background = '#' + c.toString(16).padStart(6, '0');
      el.title = 'Frog colour';
      el.onclick = () => {
        this.settings.colorIndex = i;
        this.saveSettings();
        for (const s of swatches.children) s.classList.remove('sel');
        el.classList.add('sel');
        Audio.uiClick();
      };
      if (i === this.settings.colorIndex) el.classList.add('sel');
      swatches.appendChild(el);
    });

    // --- multiplayer buttons ---
    const roomInput = $('input-room');
    roomInput.addEventListener('input', () => {
      roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });

    // Creating or joining a room now lands in a LOBBY instead of launching
    // straight into a match — otherwise there was no moment at which you
    // could choose Story, because the arena started the instant you hosted.
    $('btn-host').onclick = () => { this.pendingMode = null; this._connect('host', null); };
    $('btn-join').onclick = () => {
      const code = roomInput.value.trim();
      if (!code) { this._playStatus('Enter a room code to join.', true); return; }
      this.pendingMode = null;
      this._connect('join', code);
    };
    // Quick Play and the two solo buttons are explicit, so they go right in.
    $('btn-quickplay').onclick = () => { this.pendingMode = 'arena'; this._connect('host', 'FROG'); };
    $('btn-solo').onclick = () => { this.pendingMode = 'arena'; this._connect('solo', null); };
    $('btn-story').onclick = () => {
      this.pendingMode = 'story';
      if (this.net.isOnline && this.net.connected) this._enterGame();
      else this._connect('solo', null);
    };

    // --- lobby ---
    // Only the host chooses, and the choice is broadcast — otherwise two
    // players could pick different modes and end up in different worlds.
    $('lobby-arena').onclick = () => this._hostStart('arena');
    $('lobby-story').onclick = () => this._hostStart('story');
    $('lobby-leave').onclick = () => {
      Audio.uiBack();
      this.net.disconnect();
      this.pendingMode = null;
      this._playStatus('', false);
      this.showPanel('play');
    };

    // --- leave a match from the vote screen between rounds ---
    $('vote-leave').onclick = () => { Audio.uiBack(); this._quitToMenu(); };

    // --- settings controls ---
    const bind = (id, key, fn) => {
      const el = $(id);
      const apply = () => {
        const v = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
        this.settings[key] = v;
        this.saveSettings();
        if (fn) fn(v);
        const out = $(id + '-val');
        if (out) out.textContent = el.type === 'checkbox' ? (v ? 'On' : 'Off') : Math.round(v * 100) + '%';
      };
      if (el.type === 'checkbox') el.checked = this.settings[key];
      else el.value = this.settings[key];
      el.addEventListener('input', apply);
      apply();
    };
    bind('set-sens', 'sensitivity', (v) => { this.input.sensitivity = v; });
    bind('set-invert', 'invertY', (v) => { this.input.invertY = v; });
    bind('set-master', 'master', (v) => Audio.setVolume('master', v));
    bind('set-sfx', 'sfx', (v) => Audio.setVolume('sfx', v));
    bind('set-music', 'music', (v) => Audio.setVolume('music', v));

    const qual = $('set-quality');
    qual.value = this.settings.quality;
    qual.addEventListener('change', () => {
      this._applyQuality(qual.value);
      this.saveSettings();
      Audio.uiClick();
    });

    // --- click-to-play (the user gesture that pointer lock requires) ---
    $('click-to-play').addEventListener('mousedown', () => {
      Audio.init(); Audio.resume();
      this.input.requestLock();
    });

    // --- pause menu ---
    $('btn-resume').onclick = () => this._resume();
    $('btn-quit').onclick = () => this._quitToMenu();
    $('btn-pause-settings').onclick = () => {
      // Stay in 'paused' so the match is still live behind the panel — the
      // game keeps rendering and nothing gets torn down.
      this._settingsFromPause = true;
      $('pause').classList.remove('show');
      $('menu').classList.add('show');
      this.showPanel('settings');
    };
  }

  /** Show the pre-match lobby and keep its player count live. */
  _showLobby() {
    this.showPanel('lobby');
    this._refreshLobby();
  }

  _refreshLobby() {
    if (!$('panel-lobby').classList.contains('active')) return;
    const n = this.net.isOnline ? this.net.playerCount : 1;
    const isHost = !this.net.isOnline || this.net.isHost;
    $('lobby-code').textContent = this.net.room || '----';
    $('lobby-count').textContent = n;
    $('lobby-plural').textContent = n === 1 ? '' : 's';
    $('lobby-host-controls').classList.toggle('show', isHost);
    $('lobby-waiting').classList.toggle('show', !isHost);
    $('lobby-status').textContent = !isHost
      ? 'You are in — the host picks the mode'
      : (n === 1
        ? 'Waiting for friends — they join with the code above'
        : 'Ready when you are');
  }

  /**
   * Host picks the mode for everyone. The choice is broadcast, and also
   * re-sent whenever somebody new joins so late arrivals follow the host
   * into the mode already running instead of loading the wrong world.
   */
  _hostStart(mode) {
    this.sessionMode = mode;
    this.pendingMode = mode;
    this.net.sendEvent({ t: 'gamemode', m: mode });
    this._enterGame();
  }

  _playStatus(msg, isError) {
    const el = $('play-status');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  // ------------------------------------------------------------ networking

  _wireNetwork() {
    const net = this.net;

    net.onStatus = (msg) => {
      this._playStatus(msg, false);
      if (this.hud) {
        this.hud.setRoom(net.room, msg, net.isOnline);
      }
    };

    net.onFail = (msg) => {
      this._playStatus(msg, true);
      if (this.mode === 'loading') {
        // Connection died during load — fall back to a clearly-labelled solo game.
        this._playStatus(msg + ' Starting solo instead.', true);
        net.startSolo(this.profile);
      }
    };

    net.onReady = () => {
      if (this.mode !== 'menu' && this.mode !== 'menu-overlay') return;
      // A room made with Create/Join waits in the lobby so the players can
      // agree on Arena or Story. Everything else launches immediately.
      if (this.pendingMode) this._enterGame();
      else this._showLobby();
    };

    net.onVersionMismatch = (theirBuild, who) => {
      const msg = `${who} is on a different version (${theirBuild} vs ${BUILD}) — ` +
        'both press Ctrl+Shift+R to refresh';
      if (this.hud) this.hud.toast(msg, 9);
      this._playStatus(msg, true);
      console.warn('[frogshin] build mismatch:', theirBuild, 'vs', BUILD);
    };

    net.onJoin = (id, prof) => this._addRemote(id, prof);

    net.onLeave = (id) => {
      this._pendingJoins.delete(id);
      this._refreshLobby();
      if (this.round) this.round.removePlayer(id);
      const r = this.remotes.get(id);
      if (!r) return;
      if (this.hud) this.hud.toast(`${r.name} left`);
      r.dispose();
      this.remotes.delete(id);
    };

    net.onState = (id, s) => {
      const r = this.remotes.get(id);
      if (r) r.pushSnapshot(s, now());
    };

    net.onEvent = (id, ev) => {
      // World-state events are not tied to a remote player object, so they
      // are handled before the roster lookup.
      if (ev.t === 'boxes') {
        // Only the authority spawns waves; everyone else mirrors them.
        if (this.pickups && !this.pickups.authority) this.pickups.applyWave(ev.list);
        return;
      }
      if (ev.t === 'pickup') {
        if (this.pickups) this.pickups.remove(ev.id, true);
        return;
      }
      if (ev.t === 'gamemode') {
        // The host has chosen. Follow them in, unless we are already playing.
        this.sessionMode = ev.m;
        if (this.mode === 'menu' || this.mode === 'menu-overlay') {
          this.pendingMode = ev.m;
          this._enterGame();
        }
        return;
      }
      if (ev.t === 'boss') {
        if (this.story) this.story.applyBossState(ev);
        return;
      }
      if (ev.t === 'bossHit') {
        if (this.story && this.story.authority) this.story.damageBoss(ev.d);
        return;
      }
      if (ev.t === 'round') {
        if (this.round) this.round.applyState(ev);
        return;
      }
      if (ev.t === 'vote') {
        // Only the authority tallies; everyone else waits for the broadcast.
        if (this.round && this.round.authority) {
          this.round.castVote(id, ev.m, ev.c, this._playerIds().length);
          this.round.broadcast();
        }
        return;
      }
      if (ev.t === 'tag') {
        if (this.round && this.round.authority) this.round.applyTag(ev.id, id);
        return;
      }
      if (ev.t === 'kunai') {
        // Visual only — the thrower owns hit detection for their own kunai.
        if (this.kunaiSystem) {
          _kOrigin.set(ev.x, ev.y, ev.z);
          _kDir.set(ev.dx, ev.dy, ev.dz).normalize();
          this.kunaiSystem.throw_(_kOrigin, _kDir, id, false);
          Audio.kunaiThrow(_kOrigin);
        }
        return;
      }

      const r = this.remotes.get(id);
      if (!r) return;
      r.applyEvent(ev);
      if (ev.t === 'die') this._onRemoteDeath(id, ev);
    };

    net.onHit = (d) => {
      if (!this.player || this.player.health.dead) return;
      // Tag and Infection have no damage at all — only tagging.
      if (this.round && !this.round.combatEnabled) return;
      const landed = this.player.receiveHit(d.dmg, d.kx, d.ky, d.kz, d.from, this.followCam);
      // Death itself is picked up from `deathPending` in the game loop.
      if (landed) this.hud.damageFlash(clamp(d.dmg / 40, 0.2, 0.9));
    };
  }

  /**
   * Create a remote player. Peers can connect while the world is still
   * building, before the scene and effects pools exist, so those joins are
   * parked and materialised once the game scene is ready.
   */
  _addRemote(id, prof) {
    this._refreshLobby();          // keep the lobby's player count honest
    // Tell a late joiner which mode is already running.
    if (this.sessionMode && (!this.net.isOnline || this.net.isHost)) {
      this.net.sendEvent({ t: 'gamemode', m: this.sessionMode });
    }
    if (this.remotes.has(id)) return;
    if (!this.scene || !this.effects) {
      this._pendingJoins.set(id, prof);
      return;
    }
    const r = new RemotePlayer(id, prof.name, prof.color, this.scene, this.effects);
    this.remotes.set(id, r);
    if (this.hud) this.hud.toast(`${prof.name} joined the hunt`);
  }

  _flushPendingJoins() {
    if (!this._pendingJoins.size) return;
    const pending = Array.from(this._pendingJoins.entries());
    this._pendingJoins.clear();
    for (const [id, prof] of pending) this._addRemote(id, prof);
  }

  _connect(kind, code) {
    Audio.init(); Audio.resume();
    this._playStatus('Starting…', false);
    if (kind === 'solo') { this.net.startSolo(this.profile); return; }
    if (!Network.available) {
      this._playStatus('Multiplayer library unavailable — check your connection. Starting solo.', true);
      this.net.startSolo(this.profile);
      return;
    }
    if (kind === 'host') this.net.host(this.profile, code || makeRoomCode());
    else this.net.join(this.profile, code);
  }

  // ---------------------------------------------------------- game lifecycle

  async _enterGame() {
    if (this.mode === 'loading' || this.mode === 'playing') return;
    this.mode = 'loading';
    $('menu').classList.remove('show');
    const loading = $('loading');
    loading.classList.add('show');
    const bar = $('loading-bar');
    const label = $('loading-label');

    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

    // Story mode builds its own level in its own scene.
    if (this.pendingMode === 'story') {
      this.pendingMode = null;
      this.sessionMode = 'story';
      await this._enterStory(loading, bar, label, frame);
      return;
    }
    this.pendingMode = null;
    this.sessionMode = 'arena';

    if (!this.world) {
      // --- first-time world build, one step per frame ---
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(
        CFG.camera.fov, window.innerWidth / window.innerHeight, CFG.camera.near, CFG.camera.far);

      const world = new World(this.scene);
      const tasks = world.buildTasks();
      for (let i = 0; i < tasks.length; i++) {
        label.textContent = tasks[i][0] + '…';
        bar.style.width = ((i / tasks.length) * 92) + '%';
        await frame();
        tasks[i][1]();
      }
      this.world = world;

      label.textContent = 'Summoning the wind…';
      bar.style.width = '95%';
      await frame();

      this.effects = new Effects(this.scene, this.camera);
      this.kunaiSystem = new KunaiSystem(this.scene, world.collision, this.effects);
      this.dummies = new DummyField(this.scene);
      for (const [dx, dy, dz, face] of world.dummySpots) {
        this.dummies.add(dx, dy, dz, face);
      }
      this.atmo = new Atmosphere(this.scene, this.renderer, {
        leafCount: this.quality.leaves,
        cloudCount: this.quality.clouds,
        shadows: this.quality.shadows,
      });
      this.followCam = new FollowCamera(this.camera, world.collision);

      bar.style.width = '100%';
      label.textContent = 'Sharpening the katana…';
      await frame();
    }

    // --- (re)create the local player ---
    if (this.player) {
      this.scene.remove(this.player.model.root);
      this.player.model.dispose();
    }
    // Crate spawning is owned by exactly one client: the host, or the local
    // player when offline. Everyone else just mirrors what it broadcasts.
    const authority = !this.net.isOnline || this.net.isHost;
    if (!this.pickups) {
      this.pickups = new PickupSystem(this.scene, this.world, this.effects, authority);
      this.pickups.onSpawnWave = (list) => this.net.sendEvent({ t: 'boxes', list });
    } else {
      this.pickups.authority = authority;
    }
    if (authority) this.pickups.spawnWave();

    const prof = this.profile;
    this.player = new Player({
      id: this.net.selfId || 'local',
      name: prof.name,
      color: prof.color,
      world: this.world,
      effects: this.effects,
      scene: this.scene,
      kunai: this.kunaiSystem,
      pickups: this.pickups,
    });

    this.hud.buildHotbar(this.player.inventory);
    this.hud.onSlotClick = (i) => {
      if (this.player.inventory.select(i)) Audio.uiClick();
    };

    this._setupRounds(authority);
    this.player.spawn(this.world.randomSpawn());
    this.followCam.snapTo(this.player.pos);
    this._flushPendingJoins();

    this.hud.show(true);
    this.hud.setRoom(this.net.room, this.net.status || '', this.net.isOnline);
    this.hud.toast(this.net.isOnline
      ? `Room ${this.net.room} — share this code`
      : 'Offline solo practice — no other players', 4.5);

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();

    Audio.startAmbient();
    Audio.stopMenuMusic();
    this._resize();
  }

  /** Build and start the story level. */
  async _enterStory(loading, bar, label, frame) {
    this.isStory = true;
    this.storyScene = new THREE.Scene();
    this.scene = this.storyScene;
    this.camera = new THREE.PerspectiveCamera(
      CFG.camera.fov, window.innerWidth / window.innerHeight, CFG.camera.near, CFG.camera.far);

    this.effects = new Effects(this.scene, this.camera);

    const authority = !this.net.isOnline || this.net.isHost;
    this.story = new StoryMode({
      scene: this.scene,
      effects: this.effects,
      hud: this.hud,
      camera: this.camera,
      followCam: null,          // assigned once the camera rig exists
      authority,
      onBroadcast: (msg) => this.net.sendEvent(msg),
    });

    const tasks = this.story.buildTasks();
    const timings = [];
    for (let i = 0; i < tasks.length; i++) {
      label.textContent = tasks[i][0] + '…';
      bar.style.width = ((i / tasks.length) * 92) + '%';
      await frame();
      const t0 = performance.now();
      tasks[i][1]();
      timings.push([tasks[i][0], Math.round(performance.now() - t0)]);
    }
    // Logged so a slow load can be diagnosed from the console instead of guessed at.
    const total = timings.reduce((a, b) => a + b[1], 0);
    console.log(`[frogshin] story level built in ${total}ms`);
    console.table(timings.map(([name, ms]) => ({ step: name, ms })));

    label.textContent = 'Setting the village alight…';
    bar.style.width = '96%';
    await frame();

    this.world = this.story.level;          // shared interface: collision, etc.
    this.followCam = new FollowCamera(this.camera, this.story.collision);
    this.story.followCam = this.followCam;

    // Dusk, heavy smoke, firelight — nothing like the bright arena sky.
    this.atmo = new Atmosphere(this.scene, this.renderer, {
      leafCount: 0,
      cloudCount: 0,
      shadows: this.quality.shadows,
      fogNear: 22,
      fogFar: 165,
      fogColor: 0x6b4630,
      skyTop: 0x2a2233,
      skyMid: 0x6b4732,
      skyBottom: 0xb2704a,
    });
    this.atmo.sun.color.setHex(0xffb070);
    this.atmo.sun.intensity = 0.85;
    this.atmo.hemi.color.setHex(0x8a6a52);
    this.atmo.hemi.groundColor.setHex(0x2a2418);
    this.atmo.hemi.intensity = 0.6;
    this.renderer.setClearColor(0x6b4630);

    // No dummies, no crates, no rounds in the story.
    this.dummies = new DummyField(this.scene);
    this.kunaiSystem = new KunaiSystem(this.scene, this.story.collision, this.effects);
    this.pickups = null;

    bar.style.width = '100%';
    await frame();

    const prof = this.profile;
    if (this.player) { this.scene.remove(this.player.model.root); this.player.model.dispose(); }
    this.player = new Player({
      id: this.net.selfId || 'local',
      name: prof.name,
      color: prof.color,
      world: this.story.level,
      effects: this.effects,
      scene: this.scene,
      kunai: this.kunaiSystem,
      pickups: null,
    });
    // A villager, not a ninja: dash and tongue remain, weapons do not.
    this.player.spawn(this.story.spawnPoint);
    this.player.inventory.slots[0] = null;
    this.player.inventory.slots[1] = null;
    this.player.inventory.dirty = true;
    this.player.combatEnabled = false;
    // Right mouse is the parry for the whole story, not just the duel — so
    // it never falls through to the "equip kunai first" path.
    this.player.storyParry = true;
    this.followCam.snapTo(this.player.pos);

    this.hud.buildHotbar(this.player.inventory);
    this.hud.setObjectives(this.story.objectives);
    // The HUD is shared with the arena, so anything left over from a match
    // (round timer, "YOU ARE IT", a boss bar, the vote screen) is cleared —
    // otherwise it bleeds straight into the story.
    this.hud.resetForStory();
    this.hud.show(true);
    this.hud.setRoom(this.net.room, 'Story — the burning village', this.net.isOnline);
    this.hud.toast('Follow the boardwalk — get out of the village', 5);

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
    Audio.startAmbient();
    Audio.stopMenuMusic();
    this._resize();
  }

  _onLockChange(locked) {
    // Voting deliberately releases the mouse so the cards can be clicked —
    // pausing there would drop the pause menu on top of the vote screen.
    const voting = this.round && this.round.phase === PHASE.VOTING && !this.isStory;
    if (this.mode === 'playing' && !locked && !voting) this._pause();
    else if (this.mode === 'paused' && locked) this._resume();
  }

  _pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    $('pause').classList.add('show');
    $('pause-room').textContent = this.net.isOnline
      ? `Room code: ${this.net.room}` : 'Offline solo practice';
    this.hud.showScoreboard(false);
  }

  _resume() {
    if (this.mode !== 'paused' && this.mode !== 'menu-overlay') return;
    $('pause').classList.remove('show');
    $('menu').classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
  }

  _quitToMenu() {
    // Story keeps a whole separate scene; drop it so a later arena match
    // does not inherit the swamp.
    if (this.isStory) {
      if (this.story) this.story.dispose();
      this.story = null;
      this.isStory = false;
      this.world = null;
      this.scene = null;
      this.atmo = null;
      this.player = null;
      this.pickups = null;
      this.renderer.setClearColor(0x8ec9e8);
      this._underwater = false;
    }
    this.net.disconnect();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    $('pause').classList.remove('show');
    $('menu').classList.add('show');
    this.showPanel('home');
    this.hud.show(false);
    this.hud.hideRespawn();
    this.mode = 'menu';
    this.pendingMode = null;
    this.sessionMode = null;
    this._settingsFromPause = false;
    this.input.releaseLock();
    Audio.stopAmbient();
    Audio.stopBossMusic();
    Audio.startMenuMusic();
    this._playStatus('', false);
  }

  // ------------------------------------------------------------ death / kills

  _onLocalDeath() {
    const killer = this.player.lastHitBy;
    const killerName = killer ? this.net.nameOf(killer) : null;
    this._killerName = killerName;
    this.hud.addKill(killerName, this.player.name, this.player.name);
    this.hud.showRespawn(CFG.combat.respawnTime, killerName);
  }

  _onRemoteDeath(id, ev) {
    const victim = this.remotes.get(id);
    if (!victim) return;
    const killerName = ev.by === (this.net.selfId || 'local')
      ? this.player.name
      : (ev.by ? this.net.nameOf(ev.by) : null);
    this.hud.addKill(killerName, victim.name, this.player.name);
    if (ev.by && ev.by === this.net.selfId) {
      this.player.kills++;
      this.hud.toast(`You slew ${victim.name}!`, 2.0);
    }
  }

  // ------------------------------------------------------------------ loop

  _loop() {
    requestAnimationFrame(this._loop);
    const t = now();
    let dt = t - this.lastFrame;
    this.lastFrame = t;
    // Clamp so an alt-tab or a stall can never teleport anyone through a wall.
    dt = clamp(dt, 0, 0.05);
    this.clock = t;

    if (this.mode === 'playing' || this.mode === 'paused') {
      // Story and arena are two separate loops that share the renderer.
      if (this.isStory) this._updateStory(dt, t);
      else this._updateGame(dt, t);
    } else {
      this._updateMenu(dt);
    }

    this._syncClickToPlay();
  }

  /**
   * Show the click-to-play prompt whenever we are in a match but the mouse
   * is not captured. This also self-heals the case where a pointer-lock
   * request is rejected (browsers refuse one made too soon after an unlock).
   */
  _syncClickToPlay() {
    // Not during voting: the mouse is meant to be free there.
    const voting = this.round && this.round.phase === PHASE.VOTING && !this.isStory;
    const want = this.mode === 'playing' && !this.input.locked && !voting;
    if (want === this._ctpShown) return;
    this._ctpShown = want;
    $('click-to-play').classList.toggle('show', want);
  }

  _updateMenu(dt) {
    this.menuScene.update(dt);
    this.renderer.render(this.menuScene.scene, this.menuScene.camera);
  }

  /** Story-mode frame: no rounds, no crates, no scoreboard. */
  _updateStory(dt, t) {
    const p = this.player;
    if (this.mode !== 'paused') {
      const look = this.input.takeLook();
      // The cutscene owns the camera, so mouse look is ignored during it.
      if (this.input.locked && !p.cinematic) this.followCam.look(look.dx, look.dy);

      // Slow motion for the tutorial beats. The UI keeps real time so
      // prompts, fades and the HUD never crawl along with the action.
      const gdt = dt * this.story.timeScale;

      // Toadel is the only thing the broken sword can meaningfully hit.
      const targets = this._storyTargets();
      p.update(gdt, this.input, this.followCam, targets);

      if (p.deathPending) {
        p.deathPending = false;
        this.hud.announce('YOU DIED', 'danger', true);
        this._storyDeathTimer = 3.0;
      }
      if (this._storyDeathTimer > 0) {
        this._storyDeathTimer -= dt;
        if (this._storyDeathTimer <= 0 && p.health.dead) {
          // Straight back into the fight — the story does not move on.
          const arena = this.story.level.arenaCenter;
          const spawn = this.story.phase === STORY_PHASE.BOSS
            ? new THREE.Vector3(arena.x, arena.y + 1, arena.z - 14)
            : this.story.spawnPoint;
          p.spawn(spawn);
          p.damageMultiplier = this.story.phase === STORY_PHASE.BOSS
            ? CFG.story.brokenSwordMult : 1;
          this.followCam.snapTo(p.pos);
          this.hud.clearAnnounce();
        }
      }

      this._drainEvents(p);
      // Everyone plays the village and the duel alone, even in a shared
      // session. Two players only become visible to each other once BOTH
      // have been beaten by Toadel and woken in the cells — so this checks
      // the other player's broadcast progress, not just our own.
      const myCode = STORY_PHASE_CODE[this.story.phase] || 0;
      p.storyPhaseCode = myCode;
      const iAmInCastle = myCode >= PRISON_CODE;
      for (const r of this.remotes.values()) {
        r.update(dt, t);
        r.model.root.visible = iAmInCastle && (r.storyPhase || 0) >= PRISON_CODE;
      }

      // The story itself runs on real time so its scripted timers (fades,
      // the black hold, the wake-up) are not stretched by slow motion.
      this.story.update(dt, p, this.remotes.values());
      this.kunaiSystem.update(gdt, targets);
      this.effects.update(gdt);

      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (!p.cinematic) {
        this.followCam.update(p.pos, speed, dt, {
          dashing: p.dashTimer > 0, grappling: p.grapple.attached,
        });
      }
      this.atmo.update(dt, this.camera.position);

      this._updateHud(dt, speed);
      this._updateAudioListener();
      Audio.updateAmbient(dt);
      this.net.tickState(dt, () => p.netState());
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Toadel as a katana target, so the broken sword can chip at him. */
  _storyTargets() {
    const list = [];
    const boss = this.story && this.story.boss;
    if (boss && boss.active) {
      list.push({
        id: 'toadel', pos: boss.pos, dead: false, isDummy: true, // local-only
        hitbox: { headOffset: 4.2, headRadius: 0.9, bodyOffset: 2.2, bodyRadius: 1.3 },
        onHit: (dmg, dx, dz) => {
          boss.model.flinch();
          this.effects.damageNumber(
            _hitPos.set(boss.pos.x, boss.pos.y + 3.4, boss.pos.z), dmg, false, 0.35);
          Audio.hit(boss.pos, false);
          // Everyone reports damage; the host is what actually applies it.
          if (this.story.authority) this.story.damageBoss(dmg);
          else this.net.sendEvent({ t: 'bossHit', d: dmg });
        },
      });
    }
    return list;
  }

  _updateGame(dt, t) {
    const paused = this.mode === 'paused';
    const p = this.player;

    if (!paused) {
      // Mouse look.
      const look = this.input.takeLook();
      if (this.input.locked) this.followCam.look(look.dx, look.dy);

      // Scoreboard while Tab is held.
      this.hud.showScoreboard(this.input.down('Tab'));
      if (this.input.down('Tab')) this._refreshScoreboard();

      // ---- round flow -------------------------------------------------
      this.round.update(dt, this._playerIds());
      const isIt = this.round.isTagger(p.id);
      // Taggers get endless kunai and a snappier throw; runners keep theirs.
      p.inventory.setUnlimitedKunai(this.round.isTagMode && isIt);
      p.throwCooldownOverride = (this.round.isTagMode && isIt)
        ? CFG.rounds.taggerCooldown : 0;
      p.combatEnabled = this.round.combatEnabled;
      p.model.setTagger(this.round.isTagMode && isIt);
      for (const r of this.remotes.values()) {
        r.model.setTagger(this.round.isTagMode && this.round.isTagger(r.id));
      }

      const targets = this._buildTargets();
      p.update(dt, this.input, this.followCam, targets);
      // Locally-owned kunai resolve their own hits against the same list.
      this.kunaiSystem.update(dt, targets);
      this.dummies.update(dt, t);
      this.pickups.update(dt, t);

      // A death may have been triggered by a hit packet between frames or by
      // falling during the update, so it is consumed here in one place.
      if (p.deathPending) {
        p.deathPending = false;
        this._onLocalDeath();
      }

      // Respawn handling.
      if (p.health.dead) {
        this.hud.showRespawn(p.health.respawnTimer, this._killerName);
        if (p.health.respawnTimer <= 0) {
          p.spawn(this.world.randomSpawn());
          this.followCam.snapTo(p.pos);
          this.hud.hideRespawn();
          this._killerName = null;
        }
      }

      this._drainEvents(p);

      for (const r of this.remotes.values()) {
        r.update(dt, t);
        // Explicit: only the story ever hides players, and this guarantees a
        // frog hidden there is shown again on returning to the arena.
        r.model.root.visible = true;
      }

      this.world.update(dt, this.camera.position);

      const speed = Math.hypot(p.vel.x, p.vel.z);
      this.followCam.update(p.pos, speed, dt, {
        dashing: p.dashTimer > 0,
        grappling: p.grapple.attached,
        sprinting: p.sprinting,
      });

      // Underwater look is driven by the CAMERA, not the player, so it kicks
      // in exactly when the view actually goes below the surface. The two
      // thresholds are deliberately different so bobbing at the waterline
      // cannot strobe the whole effect on and off.
      const wl = CFG.world.waterLevel;
      const camY = this.camera.position.y;
      this._setUnderwater(this._underwater ? camY < wl + 0.2 : camY < wl - 0.05);

      this.atmo.update(dt, this.camera.position);
      this.effects.update(dt);

      this._updateHud(dt, speed);
      this._updateAudioListener();
      Audio.updateAmbient(dt);

      this.net.tickState(dt, () => p.netState());
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Send the player's queued events over the wire and handle local ones. */
  _drainEvents(p) {
    if (!p.events.length) return;
    for (const ev of p.events) {
      if (ev.t === 'hit') {
        // Hits are a direct request to one victim, not a broadcast.
        this.net.sendHit(ev.id, ev.dmg, ev.kx, ev.ky, ev.kz, ev.c);
        this.hud.hitmarker(ev.c === 2);
        this._comboCount = (this._comboCount || 0) + 1;
        this._comboReset = 1.6;
        this.hud.combo(this._comboCount);
      } else {
        this.net.sendEvent(ev);
      }
    }
    p.events.length = 0;
  }

  // ----------------------------------------------------------- round flow

  _setupRounds(authority) {
    if (!this.round) {
      this.round = new RoundManager(authority, (state) => this.net.sendEvent(state));
      this.myVote = null;
      this.myTaggerCount = 1;

      this.hud.buildVote(
        (mode) => this._castVote(mode, this.myTaggerCount),
        (delta) => {
          const cap = maxTaggers(this._playerIds().length);
          const next = clamp(this.myTaggerCount + delta, 1, cap);
          if (next === this.myTaggerCount) return;
          this.myTaggerCount = next;
          Audio.uiClick();
          if (this.myVote) this._castVote(this.myVote, next);
        }
      );

      this.round.onPhaseChange = (phase) => this._onPhaseChange(phase);
      this.round.onTag = (victimId, byId, mode) => this._onTag(victimId, byId, mode);
    } else {
      this.round.authority = authority;
    }
    this._onPhaseChange(this.round.phase);
  }

  /** Everyone in the match, local player first. */
  _playerIds() {
    const ids = [this.player ? this.player.id : 'local'];
    for (const id of this.remotes.keys()) ids.push(id);
    return ids;
  }

  _castVote(mode, count) {
    this.myVote = mode;
    const players = this._playerIds().length;
    this.round.castVote(this.player.id, mode, count, players);
    Audio.uiClick();
    // Mirrors have to ask the authority to record it.
    if (!this.round.authority) {
      this.net.sendEvent({ t: 'vote', m: mode, c: count });
    }
  }

  _onPhaseChange(phase) {
    if (!this.hud || !this.player) return;

    if (phase === PHASE.VOTING) {
      this.myVote = null;
      this.hud.showVote(true);
      this.hud.hideRound();
      this.hud.clearAnnounce();
      // Release the mouse so the vote screen can actually be clicked.
      this.input.releaseLock();
      return;
    }

    this.hud.showVote(false);

    if (phase === PHASE.STARTING) {
      // Fresh spawn for everyone, so no one starts a chase cornered.
      this.player.spawn(this.world.randomSpawn());
      this.followCam.snapTo(this.player.pos);
      const info = this.round.modeInfo;
      this.hud.announce(info.name, '', true);
    } else if (phase === PHASE.PLAYING) {
      const it = this.round.isTagger(this.player.id);
      if (this.round.isTagMode) {
        this.hud.announce(it ? 'YOU ARE IT!' : 'RUN!', it ? 'danger' : 'good');
        if (it) {
          // Put the kunai in hand — a tagger has nothing else to do with it.
          const slot = this.player.inventory.kunaiSlotIndex();
          if (slot >= 0) this.player.inventory.select(slot);
          Audio.exhausted(this.player.pos);
        }
      } else {
        this.hud.announce('FIGHT!', '', false);
      }
    } else if (phase === PHASE.ENDING) {
      this.hud.announce(this.round.result || 'ROUND OVER', 'good', true);
      Audio.refreshed(this.player.pos);
    }
  }

  _onTag(victimId, byId) {
    const me = this.player.id;
    const victimName = victimId === me ? 'You' : this.net.nameOf(victimId);
    const byName = byId === me ? 'You' : this.net.nameOf(byId);

    if (victimId === me) {
      this.hud.announce('TAGGED — YOU ARE IT!', 'danger');
      this.followCam.shake(0.6);
      this.hud.damageFlash(0.7);
      const slot = this.player.inventory.kunaiSlotIndex();
      if (slot >= 0) this.player.inventory.select(slot);
    } else if (byId === me) {
      this.hud.announce(`TAGGED ${this.net.nameOf(victimId).toUpperCase()}!`, 'good');
    }
    this.hud.addKill(byName, victimName, 'You');
    Audio.headshot(this.player.pos);
  }

  /** Ask for a tag. The authority is the only place the rule is applied. */
  _requestTag(victimId) {
    if (this.round.authority) this.round.applyTag(victimId, this.player.id);
    else this.net.sendEvent({ t: 'tag', id: victimId });
  }

  /**
   * Everything the local player can hit: other frogs plus training dummies.
   * Each entry carries its own `onHit`, which is what lets the katana and
   * thrown kunai share one code path while doing very different things —
   * a player hit goes on the wire, a dummy hit stays entirely local.
   */
  _buildTargets() {
    const list = [];
    const K = CFG.kunai;

    for (const r of this.remotes.values()) {
      if (!r.spawned || r.dead) continue;
      list.push({
        id: r.id, pos: r.pos, dead: r.dead, isDummy: false,
        hitbox: CFG.hitbox.player,
        onHit: (dmg, dx, dz, head, at) => {
          _hitPos.copy(at || r.pos);

          // In Tag and Infection a kunai does not wound — it tags.
          if (this.round.isTagMode) {
            const me = this.player.id;
            if (!this.round.playing) return;
            if (!this.round.isTagger(me)) return;        // runners cannot tag
            if (this.round.isTagger(r.id)) return;       // already it
            if (this.round.immunityFor(r.id) > 0) return; // no instant tag-back
            this._requestTag(r.id);
            this.hud.hitmarker(true);
            this.effects.ring(_hitPos, 0.3, 3.2, 0.4, 0xff8a3c, true);
            return;
          }

          this.net.sendHit(r.id, dmg,
            dx * K.knockback, K.knockbackUp, dz * K.knockback, 3);
          this.hud.hitmarker(true);
          this.effects.damageNumber(_hitPos, dmg, true);
          if (head) this._headshotFeedback(_hitPos);
        },
      });
    }

    for (const d of this.dummies.dummies) {
      list.push({
        id: d.id, pos: d.pos, dead: false, isDummy: true, dummy: d,
        hitbox: CFG.hitbox.dummy,
        onHit: (dmg, dx, dz, head, at) => {
          d.hit(dx, dz);
          // Brief 0.2s flash of the damage dealt.
          this.effects.damageNumber(at || d.hitPoint, dmg, !!head, 0.2);
          Audio.dummyHit(d.pos);
          this.hud.hitmarker(!!head);
          if (head) this._headshotFeedback(at || d.hitPoint);
        },
      });
    }
    return list;
  }

  /** Extra punch for a headshot: gold ring, chime and a screen kick. */
  _headshotFeedback(at) {
    this.effects.ring(at, 0.3, 3.0, 0.4, 0xffd24a, true);
    this.effects.puff(at, 0xffe9a8, 14, 6);
    Audio.headshot(at);
    this.followCam.shake(0.32);
    this.hud.toast('HEADSHOT — 50', 1.0);
  }

  /** Switch the whole presentation between above- and below-water. */
  _setUnderwater(v) {
    if (v === this._underwater) return;
    this._underwater = v;
    this.atmo.setUnderwater(v);
    // Clear colour shows through wherever nothing is drawn.
    this.renderer.setClearColor(v ? 0x0a6ec4 : 0x8ec9e8);
    $('underwater').classList.toggle('show', v);
    Audio.setUnderwater(v);
  }

  _updateHud(dt, speed) {
    const p = this.player;
    this.hud.setHealth(p.health.fraction);
    this.hud.setCritical(p.health.fraction < 0.28 && !p.health.dead);
    this.hud.setStamina(p.stamina.fraction, p.stamina.exhausted);

    // Audible bookends for the lockout so the rule is learnable without
    // having to watch the bar.
    if (p.stamina.justExhausted) {
      Audio.exhausted(p.pos);
      this.hud.toast('Out of stamina — recover to 70%', 1.8);
    }
    if (p.stamina.justRecovered) Audio.refreshed(p.pos);

    // Hotbar only redraws when the inventory actually changed.
    if (p.inventory.dirty) {
      p.inventory.dirty = false;
      this.hud.setHotbar(p.inventory);
    }
    // No supply crates in the story level.
    this.hud.setPickupPrompt(
      !!this.pickups && !p.health.dead && !!this.pickups.nearest(p.pos));

    // One-shot messages raised by the player controller.
    if (p.pickedUpCue) {
      this.hud.toast(`+${p.pickedUpCue} kunai`, 1.4);
      p.pickedUpCue = 0;
    }
    if (p.needKunaiCue) {
      this.hud.toast('Equip kunai first — press 2', 1.6);
      p.needKunaiCue = false;
    }
    if (p.outOfKunaiCue) {
      this.hud.toast('Out of kunai — find a supply crate', 1.6);
      p.outOfKunaiCue = false;
    }
    this.hud.setDash(p.dashCooldown, p.dashCharges, p.grounded);

    // Crosshair reacts to what the tongue would actually hit.
    this._aimCheck = (this._aimCheck || 0) - dt;
    if (this._aimCheck <= 0) {
      this._aimCheck = 0.08;
      const dir = this.followCam.aimDirection(new THREE.Vector3());
      const mouth = p.mouthPosition;
      const hit = this.world.collision.raycast(
        mouth.x, mouth.y, mouth.z, dir.x, dir.y, dir.z, CFG.grapple.range);
      this._hasGrappleTarget = !!hit;
    }
    this.hud.setGrapple(p.grapple.cooldown, p.grapple.attached, this._hasGrappleTarget);
    this.hud.setCrosshair(
      p.health.dead ? 'hidden'
        : p.grapple.attached ? 'attached'
          : (this._hasGrappleTarget && p.grapple.cooldown <= 0) ? 'target' : 'idle'
    );
    this.hud.setSpeed(speed, p.sprinting);

    // ---- round HUD (arena only; the story has its own objectives) ----
    const R = this.round;
    if (!R || this.isStory) {
      this.hud.update(dt);
      if (this._comboReset > 0) {
        this._comboReset -= dt;
        if (this._comboReset <= 0) this._comboCount = 0;
      }
      return;
    }
    if (R.phase === PHASE.VOTING) {
      const players = this._playerIds().length;
      this.hud.updateVote(R, players, this.myVote, this.myTaggerCount, maxTaggers(players));
    } else if (R.phase === PHASE.STARTING) {
      this.hud.setRound(R.modeInfo, R.timer, '', R.taggerCount);
      this.hud.announce(Math.max(1, Math.ceil(R.timer)) + '', '', true);
    } else if (R.phase === PHASE.PLAYING) {
      const role = R.isTagMode ? (R.isTagger(p.id) ? 'it' : 'runner') : '';
      this.hud.setRound(R.modeInfo, R.timer, role, R.taggers.size || R.taggerCount);
    }

    this.hud.update(dt);

    if (this._comboReset > 0) {
      this._comboReset -= dt;
      if (this._comboReset <= 0) this._comboCount = 0;
    }
  }

  _updateAudioListener() {
    const cam = this.camera;
    cam.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, _up).normalize();
    Audio.setListener(cam.position, _fwd, _right);
  }

  _refreshScoreboard() {
    const rows = [{
      name: this.player.name, kills: this.player.kills, deaths: this.player.deaths,
      self: true, color: this.player.color,
    }];
    for (const r of this.remotes.values()) {
      rows.push({ name: r.name, kills: r.kills, deaths: 0, self: false, color: r.color });
    }
    this.hud.setScoreboard(rows);
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _hitPos = new THREE.Vector3();
const _kDir = new THREE.Vector3();
const _kOrigin = new THREE.Vector3();

// --------------------------------------------------------------------------

window.addEventListener('error', (e) => {
  const el = $('boot-error');
  if (el) {
    el.classList.add('show');
    el.textContent = '⚠ ' + (e.message || 'Unknown error') +
      (e.filename ? `\n${e.filename}:${e.lineno}` : '');
  }
});

// PeerJS is loaded as a plain script tag; give it a moment if it is slow.
function boot() {
  try {
    window.game = new Game();
  } catch (err) {
    const el = $('boot-error');
    if (el) { el.classList.add('show'); el.textContent = '⚠ ' + err.message; }
    throw err;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
