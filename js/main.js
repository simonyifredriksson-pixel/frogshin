/**
 * FROGSHIN — entry point.
 *
 * Owns the renderer, the mode state machine (menu / loading / playing /
 * paused), and the glue between the gameplay systems and the network layer.
 */

import * as THREE from '../lib/three.module.js?v=v39';
import { CFG, BUILD, FROG_COLORS, NINJA_NAMES } from './config.js?v=v39';
import { clamp, pick, roomCode as makeRoomCode } from './util.js?v=v39';
import { Input } from './input.js?v=v39';
import { Audio } from './audio.js?v=v39';
import { World } from './world.js?v=v39';
import { Effects } from './effects.js?v=v39';
import { Atmosphere } from './atmosphere.js?v=v39';
import { FollowCamera } from './camera.js?v=v39';
import { Player } from './player.js?v=v39';
import { RemotePlayer } from './remote.js?v=v39';
import { HUD } from './hud.js?v=v39';
import { KunaiSystem, PickupSystem, setKunaiSkin } from './items.js?v=v39';
import { FrogModel } from './frog.js?v=v39';
import { DummyField } from './dummy.js?v=v39';
import { RoundManager, PHASE, MODES, maxTaggers } from './rounds.js?v=v39';
import { ToadModel } from './npc.js?v=v39';
import { findSkin, DEFAULT_SKIN } from './skins.js?v=v39';
import { StoryMode, STORY_PHASE, STORY_PHASE_CODE, PRISON_CODE } from './story.js?v=v39';
import { DungeonRun } from './dungeon.js?v=v39';
import { GUARDIAN_NAMES } from './dungeonboss.js?v=v39';
import { JudgmentRun } from './judgment.js?v=v39';
import { COMBO_NAMES } from './ascended.js?v=v39';
import { MenuScene } from './menu.js?v=v39';
import { Economy } from './economy.js?v=v39';
import { Shop } from './shop.js?v=v39';
import { Network, NetRole } from './net.js?v=v39';

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;

// Scratch vectors for the shadow clone, so its per-frame work allocates none.
const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _v3d = new THREE.Vector3();

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
    this._lastSweep = 0;
    this._pendingJoins = new Map();
    // --- developer menu (F3 + J + L, or Ctrl + L + J + M) ---
    this.cheatsOpen = false;
    this.cheatStamina = false;
    this._chordHeld = false;
    this._ctpShown = false;
    this.settings = this.loadSettings();

    this._initRenderer();
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    this.input.onLockChange = (locked) => this._onLockChange(locked);

    this.net = new Network();
    this._wireNetwork();

    this.economy = new Economy();

    this.hud = new HUD();
    this.hud.show(false);
    this.hud.setFroglets(this.economy.froglets);

    this.menuScene = new MenuScene(this.renderer);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this._buildMenuUI();
    this._buildCheatUI();
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
    const panels = ['home', 'play', 'lobby', 'shop', 'howto', 'settings',
      'credits', 'dungeon'];
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

    // Skins repaint shared materials, so applying them once here covers every
    // kunai already pooled in the scene as well as any thrown later.
    this.shop = new Shop(this.economy, () => this._applySkins());
    this._applySkins();

    $('btn-play').onclick = () => this.showPanel('play');
    $('btn-shop').onclick = () => { this.shop.render(); this.showPanel('shop'); };
    $('btn-howto').onclick = () => this.showPanel('howto');
    $('btn-settings').onclick = () => this.showPanel('settings');
    $('btn-credits').onclick = () => this.showPanel('credits');
    for (const b of document.querySelectorAll('.btn-back')) {
      b.onclick = () => {
        Audio.uiBack();
        // The practice ring's try-out panel returns straight to the match.
        if (this._tryPanelOpen) {
          this._tryPanelOpen = false;
          $('menu').classList.remove('show');
          this.showPanel('home');
          return;
        }
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

    // --- the dungeon: solo, offline, and the run style is fixed up front ---
    $('btn-dungeon').onclick = () => { Audio.uiClick(); this.showPanel('dungeon'); };
    $('btn-dungeon-cp').onclick = () => this._startDungeon(true);
    $('btn-dungeon-nocp').onclick = () => this._startDungeon(false);

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

  /**
   * Push the equipped skins into the world.
   *
   * Kunai colours live on shared materials so they repaint instantly. The
   * frog and its katana are baked into the model at build time, so the local
   * player is rebuilt — only when actually in a match, since there is no
   * model to rebuild while sitting in the menu.
   */
  _applySkins() {
    const skins = this.shop.equippedSkins();
    this.equippedSkins = skins;
    // A shape change needs the pooled blades rebuilt, not just repainted.
    if (setKunaiSkin(skins.kunai) && this.kunaiSystem) this.kunaiSystem.rebuild();
    // The juggernaut wears the toad, not a frog — rebuilding here would put
    // the player back in a frog body mid-round.
    if (this.player && this.scene && !this.player.isJuggernaut) {
      const old = this.player.model;
      const rebuilt = new FrogModel(this.player.color, this.player.name, true, skins);
      rebuilt.root.position.copy(old.root.position);
      rebuilt.root.rotation.copy(old.root.rotation);
      this.scene.remove(old.root);
      old.dispose();
      this.player.model = rebuilt;
      this.scene.add(rebuilt.root);
    }
    // The clone wears whatever you wear, so it has to be rebuilt too.
    this._dropClone();
    // Abilities live in the hotbar; owning one is what puts it there.
    if (this.player) this.player.inventory.setAbilities(this.shop.equippedAbilities());
  }

  /** Throw away the shadow-clone model so it is rebuilt with fresh skins. */
  _dropClone() {
    if (!this._cloneModel) return;
    if (this.scene) this.scene.remove(this._cloneModel.root);
    this._cloneModel.dispose();
    this._cloneModel = null;
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
      // Toadel is not networked: each player fights their own copy alone.
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
      if (ev.t === 'elim') {
        // A player reporting their own knockout. Only the authority applies it,
        // and only for the sender — nobody can eliminate anyone else.
        if (this.round && this.round.authority && ev.id === id) {
          this.round.eliminate(id);
        }
        return;
      }
      if (ev.t === 'kunai') {
        // Visual only — the thrower owns hit detection for their own kunai.
        if (this.kunaiSystem) {
          _kOrigin.set(ev.x, ev.y, ev.z);
          _kDir.set(ev.dx, ev.dy, ev.dz).normalize();
          // Pass the assisted target through so onlookers see the same curve
          // the thrower does, rather than a blade flying implausibly straight.
          this.kunaiSystem.throw_(_kOrigin, _kDir, id, false, ev.tid || null);
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
      // Belt and braces: reject a teammate's hit even if one somehow arrives.
      if (this.round && this.round.areAllies(this.player.id, d.from)) return;
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
    // Last line of defence against the delayed-clone bug: whatever the
    // network says, we are not a player in our own roster. A remote plays
    // back interpDelay in the past, so a self-remote reads as a copy of you
    // trailing behind and sliding into you when you stop — and it inflates
    // the lobby count.
    if (!id || id === this.net.selfId) return;
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
    // A remote clone's kunai is drawn locally and deals nothing — the decoy
    // has to look armed, but only the real frog can actually hurt you.
    r.onCloneThrow = (pos, dx, dy, dz) => {
      if (!this.kunaiSystem) return;
      _v3c.set(dx, dy, dz);
      if (_v3c.lengthSq() < 1e-6) return;
      _v3c.normalize();
      const o = _v3d.copy(pos);
      o.y += 1.45;
      o.addScaledVector(_v3c, 0.6);
      this.kunaiSystem.throw_(o, _v3c, 'clone:' + id, false, null);
    };
    this.remotes.set(id, r);
    if (this.hud) this.hud.toast(`${prof.name} joined the hunt`);
  }

  /**
   * Drop remotes that are not real players.
   *
   * The roster is the only authority on who is in the room, so anything we
   * are still drawing that the roster does not list is a ghost — the leftover
   * of a missed `leave`, or a duplicate born from an id change. A player whose
   * connection merely stalls stays in the roster and is therefore kept, so
   * this cannot evict somebody who is still really here.
   */
  _sweepGhosts(t) {
    if (!this.net.isOnline || !this.remotes.size) return;
    if (t - this._lastSweep < 2) return;
    this._lastSweep = t;
    for (const id of Array.from(this.remotes.keys())) {
      if (id !== this.net.selfId && this.net.profiles.has(id)) continue;
      const r = this.remotes.get(id);
      r.dispose();
      this.remotes.delete(id);
      this._pendingJoins.delete(id);
      if (this.round) this.round.removePlayer(id);
      this._refreshLobby();
    }
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
    // So does the dungeon.
    if (this.pendingMode === 'dungeon') {
      this.pendingMode = null;
      this.sessionMode = 'dungeon';
      await this._enterDungeon(loading, bar, label, frame, this._dungeonCheckpoints);
      return;
    }
    // And the judgment arena, reached only through the statue.
    if (this.pendingMode === 'judgment') {
      this.pendingMode = null;
      this.sessionMode = 'judgment';
      await this._enterJudgment(loading, bar, label, frame);
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
      this.kunaiSystem.resolveTarget = (id, out) => this._resolveAimTarget(id, out);
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
      skins: this.equippedSkins,
    });

    // Owned abilities go into the hotbar before it is built, so the slots
    // are right on the very first frame.
    this.player.inventory.setAbilities(this.shop.equippedAbilities());
    this.hud.buildHotbar(this.player.inventory);
    this.hud.onSlotClick = (i) => {
      const slot = this.player.inventory.slots[i];
      // Clicking an ability slot fires it, exactly like its number key.
      if (slot && slot.item.ability) this.player._useAbility(slot.item.id);
      else if (this.player.inventory.select(i)) Audio.uiClick();
    };

    this._setupRounds(authority);
    this.player.spawn(this.world.randomSpawn());
    this.followCam.snapTo(this.player.pos);
    this._flushPendingJoins();

    this.hud.show(true);
    this.hud.setRoom(this.net.room, this.net.status || '', this.net.isOnline);
    this.hud.toast(this.net.isOnline
      ? `Room ${this.net.room} — share this code`
      : 'Offline solo practice — no other players, no froglets earned', 4.5);

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
    this.kunaiSystem.resolveTarget = (id, out) => this._resolveAimTarget(id, out);
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
      skins: this.equippedSkins,
    });
    // A villager, not a ninja: dash and tongue remain, weapons do not.
    this.player.spawn(this.story.spawnPoint);
    this.player.inventory.slots[0] = null;
    this.player.inventory.slots[1] = null;
    this.player.inventory.dirty = true;
    // No weapons during the village — the broken sword is handed over when
    // the duel starts, which is also what unlocks the parry.
    this.player.combatEnabled = false;
    this.followCam.snapTo(this.player.pos);

    // Anyone who joined while the level was still building gets created now.
    this._flushPendingJoins();

    this.hud.buildHotbar(this.player.inventory);
    this.hud.setObjectives(this.story.objectives);
    // The HUD is shared with the arena, so anything left over from a match
    // (round timer, "YOU ARE IT", a boss bar, the vote screen) is cleared —
    // otherwise it bleeds straight into the story.
    this.hud.resetOverlays();
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

  /**
   * Kick off a run. Offline and solo by design, so it disconnects first —
   * a shared clock and a mode built on repeated death do not mix.
   */
  _startDungeon(checkpoints) {
    Audio.uiClick();
    Audio.init(); Audio.resume();
    this._dungeonCheckpoints = checkpoints;
    this.pendingMode = 'dungeon';
    if (this.net.isOnline) this.net.disconnect();
    this._enterGame();
  }

  /**
   * Build and start a dungeon run.
   *
   * Solo and entirely offline: fifteen scripted fights would mean nothing
   * with someone else's kunai flying through them, and the whole mode is
   * built around dying and repeating, which does not survive a shared clock.
   */
  async _enterDungeon(loading, bar, label, frame, checkpoints) {
    this.isDungeon = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CFG.camera.fov, window.innerWidth / window.innerHeight,
      CFG.camera.near, CFG.camera.far);
    this.effects = new Effects(this.scene, this.camera);

    this.dungeon = new DungeonRun({
      scene: this.scene,
      effects: this.effects,
      hud: this.hud,
      camera: this.camera,
      followCam: null,          // assigned once the rig exists
      checkpoints,
    });

    const tasks = this.dungeon.buildTasks();
    for (let i = 0; i < tasks.length; i++) {
      label.textContent = tasks[i][0] + '…';
      bar.style.width = ((i / tasks.length) * 94) + '%';
      await frame();
      tasks[i][1]();
    }

    this.world = this.dungeon.level;
    this.followCam = new FollowCamera(this.camera, this.dungeon.collision);
    this.dungeon.followCam = this.followCam;

    // Underground: no sky, no leaves, heavy close fog and a cold key light.
    this.atmo = new Atmosphere(this.scene, this.renderer, {
      leafCount: 0,
      cloudCount: 0,
      shadows: this.quality.shadows,
      fogNear: 14,
      fogFar: 130,
      fogColor: 0x0a0910,
      skyTop: 0x05040a,
      skyMid: 0x0a0812,
      skyBottom: 0x120e18,
    });
    this.atmo.sun.color.setHex(0x9aa8d0);
    this.atmo.sun.intensity = 0.5;
    this.atmo.hemi.color.setHex(0x4a4260);
    this.atmo.hemi.groundColor.setHex(0x0a0810);
    this.atmo.hemi.intensity = 0.55;
    this.renderer.setClearColor(0x05040a);

    this.dummies = new DummyField(this.scene);
    this.kunaiSystem = new KunaiSystem(this.scene, this.dungeon.collision, this.effects);
    this.kunaiSystem.resolveTarget = (id, out) => this._resolveAimTarget(id, out);
    this.pickups = null;

    bar.style.width = '100%';
    await frame();

    const prof = this.profile;
    if (this.player) {
      this.scene.remove(this.player.model.root);
      this.player.model.dispose();
    }
    this.player = new Player({
      id: 'local',
      name: prof.name,
      color: prof.color,
      world: this.dungeon.level,
      effects: this.effects,
      scene: this.scene,
      kunai: this.kunaiSystem,
      pickups: null,
      skins: this.equippedSkins,
    });
    // Fully armed: this is the hardest content in the game.
    this.player.combatEnabled = true;
    this.player.inventory.setUnlimitedKunai(true);
    this.player.inventory.setAbilities(this.shop.equippedAbilities());

    this.hud.buildHotbar(this.player.inventory);
    this.hud.onSlotClick = (i) => {
      const slot = this.player.inventory.slots[i];
      if (slot && slot.item.ability) this.player._useAbility(slot.item.id);
      else if (this.player.inventory.select(i)) Audio.uiClick();
    };
    this.hud.resetOverlays();
    this.hud.show(true);
    this.hud.setRoom('', checkpoints ? 'Dungeon — checkpoints on'
      : 'Dungeon — no checkpoints', false);

    // Beating the god unlocks his appearance — a cosmetic, permanently.
    this.dungeon.onVictory = () => this._awardFrogathSkin();
    this.dungeon.onCrystal = () => {
      this.economy.crystal = true;
      this.economy.save();
    };

    this.dungeon.start(this.player, 0);
    this.followCam.snapTo(this.player.pos);

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
    Audio.stopMenuMusic();
    this._resize();
  }

  /**
   * The judgment arena. Same shape as the dungeon entry, one room, one boss.
   */
  async _enterJudgment(loading, bar, label, frame) {
    this.isJudgment = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CFG.camera.fov, window.innerWidth / window.innerHeight,
      CFG.camera.near, CFG.camera.far);
    this.effects = new Effects(this.scene, this.camera);

    this.judgment = new JudgmentRun({
      scene: this.scene, effects: this.effects, hud: this.hud,
      camera: this.camera, followCam: null,
    });

    const tasks = this.judgment.buildTasks();
    for (let i = 0; i < tasks.length; i++) {
      label.textContent = tasks[i][0] + '…';
      bar.style.width = ((i / tasks.length) * 94) + '%';
      await frame();
      tasks[i][1]();
    }

    this.world = { collision: this.judgment.collision, update: () => {} };
    this.followCam = new FollowCamera(this.camera, this.judgment.collision);
    this.judgment.followCam = this.followCam;

    // Black, with only his light in it.
    this.atmo = new Atmosphere(this.scene, this.renderer, {
      leafCount: 0, cloudCount: 0, shadows: this.quality.shadows,
      fogNear: 30, fogFar: 220,
      fogColor: 0x05040a, skyTop: 0x020206, skyMid: 0x05040c, skyBottom: 0x0a0814,
    });
    this.atmo.sun.color.setHex(0xffd76b);
    this.atmo.sun.intensity = 0.35;
    this.atmo.hemi.color.setHex(0x3a3050);
    this.atmo.hemi.groundColor.setHex(0x05040a);
    this.atmo.hemi.intensity = 0.4;
    this.renderer.setClearColor(0x020206);

    this.dummies = new DummyField(this.scene);
    this.kunaiSystem = new KunaiSystem(this.scene, this.judgment.collision, this.effects);
    this.kunaiSystem.resolveTarget = (id, out) => this._resolveAimTarget(id, out);
    this.pickups = null;

    bar.style.width = '100%';
    await frame();

    const prof = this.profile;
    if (this.player) {
      this.scene.remove(this.player.model.root);
      this.player.model.dispose();
    }
    this.player = new Player({
      id: 'local', name: prof.name, color: prof.color,
      world: this.world, effects: this.effects, scene: this.scene,
      kunai: this.kunaiSystem, pickups: null, skins: this.equippedSkins,
    });
    this.player.combatEnabled = true;
    this.player.inventory.setUnlimitedKunai(true);
    this.player.inventory.setAbilities(this.shop.equippedAbilities());

    this.hud.buildHotbar(this.player.inventory);
    this.hud.onSlotClick = (i) => {
      const slot = this.player.inventory.slots[i];
      if (slot && slot.item.ability) this.player._useAbility(slot.item.id);
      else if (this.player.inventory.select(i)) Audio.uiClick();
    };
    this.hud.resetOverlays();
    this.hud.show(true);
    this.hud.setRoom('', 'The Last Judgment', false);

    this.judgment.onVictory = () => {
      this.economy.ascendedBeaten = true;
      this.economy.award(CFG.economy.roundWinReward * 40, 'THE ASCENDED FALLS');
      // The rarest thing in the game: his own form, both of them. There is
      // no crate that can produce this.
      const gotFrog = this.economy.unlock('frogs', 'frog_divine');
      const gotSword = this.economy.unlock('swords', 'sword_divine');
      this.economy.save();
      this.hud.toast('You have beaten the god above gods.', 14);
      if (gotFrog || gotSword) {
        setTimeout(() => this.hud.toast(
          'UNLOCKED — FROGATH THE DIVINE. His form is yours; take a life with '
          + 'it on and you will wear his second one.', 16), 3200);
      }
    };
    this.judgment.start(this.player);
    this.followCam.snapTo(this.player.pos);

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
    Audio.stopMenuMusic();
    // Lift the black the sacrifice put up. Without this the arena loads
    // correctly behind a screen that never clears.
    this.hud.setFade(0, 0.9);
    this._resize();
  }

  /** One frame of the judgment fight. */
  _updateJudgment(dt, t) {
    const p = this.player;
    if (this.frozen) { this.renderer.render(this.scene, this.camera); return; }

    const look = this.input.takeLook();
    if (this.input.locked && !p.cinematic) this.followCam.look(look.dx, look.dy);

    const targets = [];
    const boss = this.judgment.bossTarget();
    if (boss) targets.push(boss);

    p.update(dt, this.input, this.followCam, targets);
    this.kunaiSystem.update(dt, targets);
    if (p.deathPending) p.deathPending = false;
    // Same as the dungeon: the katana queues its hits as events because the
    // arena needs them networked, so here is where they are applied.
    for (const ev of p.events) {
      if (ev.t === 'hit') {
        this.judgment.damageBoss(ev.dmg);
        this.hud.hitmarker(ev.c === 2);
      }
    }
    p.events.length = 0;

    this.judgment.update(dt, p, (dmg, from) => this._dungeonHit(dmg, from),
      this.input.down('Space'));

    this.effects.update(dt);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (!p.cinematic) {
      this.followCam.update(p.pos, speed, dt, {
        dashing: p.dashTimer > 0, grappling: p.grapple.attached,
        sprinting: p.sprinting,
      });
    }
    this.atmo.update(dt, this.camera.position);
    this._updateHud(dt, speed);
    this._updateAudioListener();
    Audio.updateAmbient(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** One frame of a dungeon run. */
  _updateDungeon(dt, t) {
    const p = this.player;
    if (this.frozen) { this.renderer.render(this.scene, this.camera); return; }

    const look = this.input.takeLook();
    if (this.input.locked && !p.cinematic) this.followCam.look(look.dx, look.dy);

    // The boss is the only target in the room, and it uses the same hit
    // plumbing every other target does.
    const targets = [];
    const boss = this.dungeon.bossTarget();
    if (boss) targets.push(boss);

    p.update(dt, this.input, this.followCam, targets);
    this.kunaiSystem.update(dt, targets);

    if (p.deathPending) p.deathPending = false;

    // The katana reports its hits as queued 'hit' EVENTS, because in the
    // arena they have to travel to the victim's client. Nothing is networked
    // down here, so this is where they get applied — without it the sword
    // swung, connected, showed a damage number, and did nothing at all.
    for (const ev of p.events) {
      if (ev.t === 'hit') {
        this.dungeon.damageBoss(ev.dmg);
        this.hud.hitmarker(ev.c === 2);
      }
    }
    p.events.length = 0;

    this.dungeon.update(dt, p, (dmg, from) => this._dungeonHit(dmg, from),
      this.input.down('Space'));

    this.effects.update(dt);
    this.world.update(dt);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (!p.cinematic) {
      this.followCam.update(p.pos, speed, dt, {
        dashing: p.dashTimer > 0, grappling: p.grapple.attached,
        sprinting: p.sprinting,
      });
    }
    this.atmo.update(dt, this.camera.position);
    this._updateHud(dt, speed);
    this._updateAudioListener();
    Audio.updateAmbient(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Frogath's look, awarded for putting him down.
   *
   * Cosmetic only, and deliberately so: you get the golden body and the blade
   * of light, and none of the flight, stars or beams. Wearing the god is a
   * trophy, not a power-up.
   */
  _awardFrogathSkin() {
    const gotFrog = this.economy.unlock('frogs', 'frog_frogath');
    const gotSword = this.economy.unlock('swords', 'sword_frogath');
    this.economy.award(CFG.economy.roundWinReward * 10, 'FROGATH DEFEATED');
    if (gotFrog || gotSword) {
      this.hud.toast(
        'UNLOCKED — Frogath\'s hide and his blade of light. Equip them in the shop.',
        10);
    } else {
      this.hud.toast('Frogath falls again.', 5);
    }
  }

  /** A boss attack landing on the player. */
  _dungeonHit(damage, from) {
    const p = this.player;
    if (p.health.dead || p.health.protected || p.dashTimer > 0) return;
    // Parrying turns a blow aside — routed through the player's own guard so
    // the cooldown and the broken-guard lockout apply here exactly as they do
    // everywhere else, rather than this path keeping its own softer copy.
    if (p.parrying) {
      p.parryHits++;
      p.justParried = 0.2;
      const dx = p.pos.x - (from ? from.x : p.pos.x);
      const dz = p.pos.z - (from ? from.z : p.pos.z);
      const len = Math.hypot(dx, dz) || 1;
      if (p.parryHits >= CFG.story.parry.knockdownAfter) {
        p._breakParry(dx / len, dz / len);
        this.hud.toast('GUARD BROKEN', 1.2);
        this.followCam.shake(0.6);
      } else {
        this.hud.toast('PARRIED', 0.5);
        Audio.parry(p.pos);
        this.followCam.shake(0.25);
      }
      return;
    }
    p.health.damage(damage, 'boss');
    _v3.copy(from || p.pos);
    this.effects.damageNumber(
      _v3.set(p.pos.x, p.pos.y + 1.2, p.pos.z), damage, damage > 40);
    this.hud.damageFlash(clamp(damage / 60, 0.3, 1));
    this.followCam.shake(clamp(damage / 40, 0.3, 1.1));
    Audio.hurt(p.pos);
  }

  // ------------------------------------------------------- developer menu

  /**
   * Build the dev menu once. Opened with F3+J+L or Ctrl+L+J+M.
   *
   * A three-key chord including a function key, because it must be
   * impossible to hit by accident mid-fight — this is a playtesting tool,
   * not a feature, and nothing here is networked or saved.
   */
  _buildCheatUI() {
    const rooms = $('cheat-rooms');
    for (let i = 0; i < CFG.dungeon.rooms; i++) {
      const b = document.createElement('button');
      b.className = 'cheat-room' + (i === CFG.dungeon.rooms - 1 ? ' boss' : '');
      b.textContent = i + 1;
      b.title = i === CFG.dungeon.rooms - 1
        ? 'FROGATH' : (GUARDIAN_NAMES[i] || ('Room ' + (i + 1)));
      b.onclick = () => this._cheatJump(i);
      rooms.appendChild(b);
    }

    $('cheat-god').onclick = () => {
      const p = this.player;
      if (!p) return this._cheatNote('Start a game first.');
      p.health.god = !p.health.god;
      this._cheatRefresh();
      this._cheatNote(p.health.god
        ? 'Nothing can hurt you.' : 'Invincibility off.');
    };
    $('cheat-stam').onclick = () => {
      this.cheatStamina = !this.cheatStamina;
      this._cheatRefresh();
      this._cheatNote(this.cheatStamina
        ? 'Stamina is pinned full.' : 'Stamina back to normal.');
    };
    $('cheat-heal').onclick = () => {
      const p = this.player;
      if (!p) return this._cheatNote('Start a game first.');
      p.health.revive();
      p.stamina.reset();
      this._cheatNote('Healed.');
    };
    $('cheat-kunai').onclick = () => {
      const p = this.player;
      if (!p) return this._cheatNote('Start a game first.');
      p.inventory.addKunai(50);
      this._cheatNote('+50 kunai.');
    };
    $('cheat-kill').onclick = () => {
      if (!this.dungeon) return this._cheatNote('Only in the dungeon.');
      this._cheatNote(this.dungeon.killBoss()
        ? 'Boss killed.' : 'Nothing is fighting you right now.');
    };
    $('cheat-frogath').onclick = () => this._cheatJump(CFG.dungeon.rooms - 1);
    $('cheat-crystal').onclick = () => {
      this.economy.crystal = true;
      this.economy.save();
      this._cheatNote('Crystal granted. Take it to the statue in the arena.');
    };
    $('cheat-ascended').onclick = () => {
      // Straight into the judgment arena, skipping the statue entirely —
      // otherwise testing him means a clean dungeon run every time.
      this._toggleCheats(false);
      this.gotoJudgment();
    };
    // Phase 2 is gated behind half his health, and the last stand behind 90%
    // of it. Without these, testing either one means winning most of the
    // fight first, every single time.
    const boss = () => (this.judgment && this.judgment.boss) || null;
    $('cheat-ascend').onclick = () => {
      const b = boss();
      if (!b) return this._cheatNote('Fight the Ascended first.');
      if (b.ascended) return this._cheatNote('He has already ascended.');
      if (!b.acting) return this._cheatNote('Wait for the fight to start.');
      this._toggleCheats(false);
      b.takeDamage(Math.max(0, b.health - b.maxHealth * CFG.ascended.ascendAt) + 1);
      this._cheatNote('Ascension triggered.');
    };
    $('cheat-laststand').onclick = () => {
      const b = boss();
      if (!b) return this._cheatNote('Fight the Ascended first.');
      if (!b.ascended) return this._cheatNote('He has to ascend first.');
      if (!b.acting) return this._cheatNote('Wait for the fight to resume.');
      this._toggleCheats(false);
      b.takeDamage(Math.max(0, b.health - b.maxHealth * CFG.ascended.finalAt) + 1);
      this._cheatNote('Last stand triggered.');
    };
    $('cheat-combo').onclick = () => {
      const b = boss();
      if (!b || !b.ascended) return this._cheatNote('Only after he ascends.');
      // Cycle the signature combos so each can be looked at on demand.
      this._comboIdx = ((this._comboIdx || 0) + 1) % COMBO_NAMES.length;
      const name = COMBO_NAMES[this._comboIdx];
      b.forceCombo(name);
      this._cheatNote('Combo: ' + name);
    };
    $('cheat-divine').onclick = () => {
      this.economy.unlock('frogs', 'frog_divine');
      this.economy.unlock('swords', 'sword_divine');
      this.economy.save();
      this._cheatNote('Frogath the Divine unlocked — equip it in the shop.');
    };
    $('cheat-close').onclick = () => this._toggleCheats(false);
  }

  _cheatJump(room) {
    if (!this.dungeon || !this.player) {
      return this._cheatNote('Room jumps only work in the dungeon.');
    }
    this.dungeon.jumpToRoom(room, this.player);
    this._cheatRefresh();
    const name = room === CFG.dungeon.rooms - 1
      ? 'FROGATH' : (GUARDIAN_NAMES[room] || '');
    return this._cheatNote(`Jumped to room ${room + 1} — ${name}`);
  }

  _cheatNote(msg) { $('cheat-note').textContent = msg; }

  /** Keep the toggles showing what is actually on. */
  _cheatRefresh() {
    const god = !!(this.player && this.player.health.god);
    const g = $('cheat-god');
    g.textContent = 'INVINCIBLE: ' + (god ? 'ON' : 'OFF');
    g.classList.toggle('on', god);
    const s = $('cheat-stam');
    s.textContent = 'INFINITE STAMINA: ' + (this.cheatStamina ? 'ON' : 'OFF');
    s.classList.toggle('on', !!this.cheatStamina);

    const here = this.dungeon ? this.dungeon.room : -1;
    const btns = $('cheat-rooms').children;
    for (let i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('here', i === here);
    }
  }

  /**
   * The developer menu answers to two chords, on the rising edge of either
   * being fully held:
   *
   *     F3 + J + L          the original
   *     Ctrl + L + J + M    the second
   *
   * A word on the Ctrl one. Chrome reserves Ctrl+L for the address bar and
   * will not let the page cancel it, and focusing the address bar blurs the
   * window, which clears every held key — so pressing Ctrl FIRST can lose the
   * chord before it completes. Because this only reads which keys are held
   * and not the order they arrived in, holding L+J+M and then tapping Ctrl
   * works everywhere: none of those three is a browser shortcut on its own,
   * and Ctrl by itself does nothing.
   */
  _updateCheatChord() {
    const k = (code) => this.input.down(code);
    const ctrl = k('ControlLeft') || k('ControlRight');
    const held = (k('F3') && k('KeyJ') && k('KeyL'))
      || (ctrl && k('KeyL') && k('KeyJ') && k('KeyM'));
    if (held && !this._chordHeld) this._toggleCheats(!this.cheatsOpen);
    this._chordHeld = held;
  }

  _toggleCheats(open) {
    if (open === this.cheatsOpen) return;
    this.cheatsOpen = open;
    $('cheats').classList.toggle('show', open);
    this._cheatRefresh();
    if (open) {
      // Needs the mouse. The lock-change handler checks `cheatsOpen` so this
      // does not trip the pause menu on the way out.
      this.input.releaseLock();
      this._cheatNote('');
    } else if (this.mode === 'playing') {
      this.input.requestLock();
    }
  }

  _onLockChange(locked) {
    // Voting deliberately releases the mouse so the cards can be clicked —
    // pausing there would drop the pause menu on top of the vote screen.
    const voting = this.round && this.round.phase === PHASE.VOTING && !this.isStory;
    // The practice ring's try-out panel and the dev menu also release the
    // mouse on purpose, and neither should drop the pause screen on top.
    if (this.mode === 'playing' && !locked && !voting
      && !this._tryPanelOpen && !this.cheatsOpen) this._pause();
    else if (this.mode === 'paused' && locked) this._resume();
  }

  /**
   * The world is standing still.
   *
   * Either the pause menu is up, or the developer menu is — clicking a cheat
   * button is impossible if a boss is still swinging at you while you aim
   * for it, so the dev menu freezes the game exactly as a pause does. It
   * just does not show the pause panel.
   */
  get frozen() { return this.mode === 'paused' || this.cheatsOpen; }

  _pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    $('pause').classList.add('show');
    $('pause-room').textContent = this.isDungeon
      ? (this.dungeon && this.dungeon.checkpoints
        ? 'The Dungeon — checkpoints on'
        : 'The Dungeon — no checkpoints')
      : (this.net.isOnline
        ? `Room code: ${this.net.room}`
        : 'Offline solo practice — no froglets earned');
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
    // The judgment arena owns its own scene as well.
    if (this.isJudgment) {
      if (this.judgment) this.judgment.dispose();
      this.judgment = null;
      this.isJudgment = false;
      this.world = null;
      this.scene = null;
      this.atmo = null;
      this.player = null;
      this.pickups = null;
      this.renderer.setClearColor(0x8ec9e8);
      this._underwater = false;
    }
    // The dungeon owns its own scene too — drop the whole thing.
    if (this.isDungeon) {
      if (this.dungeon) this.dungeon.dispose();
      this.dungeon = null;
      this.isDungeon = false;
      this.world = null;
      this.scene = null;
      this.atmo = null;
      this.player = null;
      this.pickups = null;
      this.renderer.setClearColor(0x8ec9e8);
      this._underwater = false;
    }
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
    // The vote screen and boss bar sit outside #hud, so hiding the HUD is not
    // enough — without this the mode-vote panel stayed stuck on the menu.
    this.hud.resetOverlays();
    // Drop the round so the next match starts from a fresh vote rather than
    // resuming a stale one.
    this.round = null;
    this.myVote = null;
    this.mode = 'menu';
    this.pendingMode = null;
    this.sessionMode = null;
    this._settingsFromPause = false;
    // The next match starts as an ordinary frog, whatever this one ended as.
    this._jugModelOn = false;
    this._elimAsked = false;
    this._endTrial();
    this._dropClone();
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
    // In a juggernaut round there is no respawn to count down to — dying is
    // elimination, and _onEliminate takes it from here.
    if (this.round && this.round.isJuggernautMode && this.round.playing) return;
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
      this._divineAscend();
    }
  }

  /**
   * The Frogath skin's kill transformation.
   *
   * Fires once per life on the first confirmed kill. Everything below is
   * cosmetic — the model swaps form, the screen says so, and an `ascend`
   * event goes out so every other client sees the same thing on their copy
   * of this frog. No stat is touched anywhere in this path.
   */
  _divineAscend() {
    const p = this.player;
    if (!p || !p.beginDivineAscension()) return;
    const D = CFG.divine;

    _v3c.copy(p.pos);
    _v3c.y += 0.9;
    this.effects.puff(_v3c, 0xfff3c4, 60, 14);
    this.effects.ring(_v3c, 1, D.shockwave, 0.9, 0xffd76b, true);
    this.effects.ring(_v3c, 1, D.shockwave * 0.6, 0.6, 0xffffff, true);
    this.followCam.shake(0.9);

    this.hud.announce('DIVINE ASCENSION', 'divine', false);
    // The second card lands as the wings finish opening.
    clearTimeout(this._divineCard);
    this._divineCard = setTimeout(() => {
      if (this.mode === 'playing') this.hud.announce('FROGATH — PHASE II', 'divine', false);
    }, Math.round(D.duration * 700));

    Audio.headshot(p.pos);
    // The same cue the boss ascends to, cut to a sting.
    Audio.sting('ascension', 2.4, 0.7);
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

    // The dev menu chord is checked in every mode, including the menus.
    this._updateCheatChord();
    // Pinning stamina is done here rather than inside Stamina, so the cheat
    // cannot leak into a normal game by leaving state behind.
    if (this.cheatStamina && this.player) this.player.stamina.reset();

    // Froglets accrue for time played, so this ticks in menus too — but not
    // in solo practice, where there is nobody to earn them against.
    this.economy.earning = !this.isSoloPractice;
    this.economy.update(dt);
    this.hud.setFroglets(this.economy.froglets, this.economy.earning);
    const awards = this.economy.drainPending();
    if (awards) for (const a of awards) this.hud.frogletPopup(a.amount, a.reason);

    if (this.mode === 'playing' || this.mode === 'paused') {
      // Players who connected before the world existed were parked in a
      // queue. Draining it here — rather than only on one entry path — means
      // no game mode can forget to do it. Story mode used to, which left
      // joining clients unable to see the host at all.
      this._flushPendingJoins();

      // Each mode is its own loop; they share the renderer and nothing else.
      if (this.isJudgment) this._updateJudgment(dt, t);
      else if (this.isDungeon) this._updateDungeon(dt, t);
      else if (this.isStory) this._updateStory(dt, t);
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
    // Not during voting: the mouse is meant to be free there. Nor while the
    // dev menu is open — it needs the cursor, and the prompt would sit on
    // top of it and grab the very click meant for a cheat button.
    const voting = this.round && this.round.phase === PHASE.VOTING && !this.isStory;
    const want = this.mode === 'playing' && !this.input.locked
      && !voting && !this._tryPanelOpen && !this.cheatsOpen;
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
    if (!this.frozen) {
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

      this._updateFruitStalls(p);

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
        r.setViewer(false, !(iAmInCastle && (r.storyPhase || 0) >= PRISON_CODE));
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

  /**
   * The stone frog in the arena.
   *
   * Scenery, unless you are carrying the crystal — then it is the only way
   * to the Ascended. The prompt is driven off the same proximity test the
   * sacrifice uses, so it can never say you can and then do nothing.
   */
  _updateStatue(p) {
    const s = this.world && this.world.statue;
    if (!s) return;
    const near = p.pos.distanceTo(s.stand) < 5.0;
    const armed = near && this.economy.crystal;
    this._statuePrompt = armed;
    if (armed) this.hud.setPickupPrompt(true, 'Sacrifice the crystal');

    if (!p.interactPressed) return;
    p.interactPressed = false;
    if (!near) return;
    if (!this.economy.crystal) {
      this.hud.toast(
        'The stone is cold. Something is missing from its hands.', 3);
      return;
    }
    this._sacrificeCrystal(p, s);
  }

  /** Give it up. The statue takes it, and takes you with it. */
  _sacrificeCrystal(p, s) {
    if (this._sacrificing) return;
    this._sacrificing = true;
    this.economy.crystal = false;
    this.economy.save();
    this.hud.setPickupPrompt(false);

    _v3.copy(s.pos).y += 3;
    this.effects.puff(_v3, 0xffffff, 90, 26);
    this.effects.ring(_v3, 1, 60, 1.0, 0xfff3c4, false, { x: 0, y: 1, z: 0 });
    this.effects.ring(s.pos, 1, 70, 1.2, 0xffd76b, true);
    this.followCam.shake(2.4);
    this.hud.setFade(1, 1.1);
    this.hud.announce('THE STONE OPENS ITS EYES', 'danger', true);
    Audio.headshot(p.pos);
    Audio.death(p.pos);

    // Long enough for the flash to land before the world changes.
    setTimeout(() => this.gotoJudgment(), 1200);
  }

  /**
   * Leave whatever is running and load the judgment arena.
   *
   * The teardown is the whole point: `_enterGame` refuses to start while a
   * match is already live, so calling it straight from the arena did nothing
   * at all and left the player sitting behind the fade. Quitting first puts
   * the game back in a state it will accept, and the fade is re-applied over
   * the top so the menu never flashes through the transition.
   */
  gotoJudgment() {
    if (this.mode === 'loading') return;
    this._sacrificing = false;
    if (this.net.isOnline) this.net.disconnect();
    this._quitToMenu();
    // _quitToMenu resets the overlays, which clears the fade — put it back.
    this.hud.setFade(1, 0);
    this.pendingMode = 'judgment';
    this._enterGame();
  }

  /**
   * The village market: stand at a stall and press E to buy fruit.
   *
   * The prompt is driven off the same proximity test the purchase uses, so
   * there is never a moment where it says you can buy and the key does
   * nothing.
   */
  _updateFruitStalls(p) {
    const stand = this.story.nearestStand(p.pos);
    const F = CFG.story.fruit;
    this.hud.setPickupPrompt(!!stand,
      stand ? `Buy fruit — ${F.price} froglets, +${F.heal} health` : '');

    if (!p.interactPressed) return;
    p.interactPressed = false;
    if (!stand) return;
    const res = this.story.buyFruit(p, this.economy);
    if (res) {
      this.hud.toast(res.text, 2.2);
      if (res.bad) Audio.uiBack();
    }
  }

  /**
   * The blue ring on the dummy platform.
   *
   * Solo practice only — being able to equip unowned skins would obviously
   * be nonsense in a real match. Standing in it grants unlimited kunai and
   * opens a try-out panel on T, which lends every skin and ability without
   * touching saved progress.
   */
  /**
   * Offline arena play with nobody else in the room.
   *
   * This is the one place that decides what counts as practice: the ring is
   * drawn here and only here, and nothing earned here pays out. Menus are
   * NOT practice — the time bonus keeps ticking while you browse the shop.
   */
  get isSoloPractice() {
    return (this.mode === 'playing' || this.mode === 'paused')
      && !this.net.isOnline && !this.isStory && !this.isDungeon;
  }

  _updatePracticeRing(p) {
    const ring = this.world && this.world.practiceRing;
    const soloPractice = this.isSoloPractice;
    if (!ring) return;
    // Only exists in practice; in a real match it is not even drawn.
    if (ring.group.visible !== soloPractice) ring.group.visible = soloPractice;
    if (!soloPractice) {
      if (this._inRing) this._exitPracticeRing();
      return;
    }

    const dx = p.pos.x - ring.pos.x;
    const dz = p.pos.z - ring.pos.z;
    const dy = Math.abs(p.pos.y - ring.pos.y);
    const inside = dy < 4 && (dx * dx + dz * dz) < ring.radius * ring.radius;

    if (inside !== this._inRing) {
      this._inRing = inside;
      if (inside) {
        p.inventory.setUnlimitedKunai(true);
        this.shop.setTryMode(true);
        this.hud.toast('Practice ring — press T to try every skin and ability', 4);
        Audio.refreshed(p.pos);
      } else {
        this._exitPracticeRing();
      }
    }

    this.hud.setRingPrompt(inside && !this._tryPanelOpen);

    if (inside && this.input.consume('KeyT')) this._openTryPanel();
  }

  /**
   * Step out of the ring.
   *
   * The borrowed loadout deliberately STAYS ON — walking away from the ring
   * to go and test a skin is the whole point. It is only handed back when
   * the match itself ends, in _quitToMenu.
   */
  _exitPracticeRing() {
    this._inRing = false;
    this.hud.setRingPrompt(false);
    if (this.player) this.player.inventory.setUnlimitedKunai(false);
  }

  /** Drop borrowed skins and abilities; called when leaving a match. */
  _endTrial() {
    this._inRing = false;
    this._tryPanelOpen = false;
    this.shop.setTryMode(false);
    if (this.shop.clearTrial()) this._applySkins();
  }

  /** Free the mouse and show the shop as a lend-everything panel. */
  _openTryPanel() {
    this._tryPanelOpen = true;
    this._settingsFromPause = false;
    this.shop.onTrialEquip = () => this._applySkins();
    this.shop.setTryMode(true);
    this.shop.render();
    this.input.releaseLock();
    $('menu').classList.add('show');
    this.showPanel('shop');
    this.hud.setRingPrompt(false);
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
          // Your Toadel is yours alone, so damage applies straight away.
          this.story.damageBoss(dmg);
        },
      });
    }
    return list;
  }

  _updateGame(dt, t) {
    const paused = this.frozen;
    const p = this.player;

    // The round clock runs OUTSIDE the pause check on purpose. Pausing used
    // to freeze it locally, so whoever paused came back with extra time on
    // the board while everyone else had been playing.
    if (this.round) this.round.update(dt, this._playerIds());

    if (!paused) {
      // Mouse look.
      const look = this.input.takeLook();
      if (this.input.locked) this.followCam.look(look.dx, look.dy);

      // Scoreboard while Tab is held.
      this.hud.showScoreboard(this.input.down('Tab'));
      if (this.input.down('Tab')) this._refreshScoreboard();

      // ---- round flow (the clock itself ticked above, pause or not) ----
      // Team score is tallied from everyone's own kill counters, which each
      // client already broadcasts — no separate scorekeeping to desync.
      if (this.round.isTeamMode && this.round.authority) {
        const totals = [0, 0];
        const t0 = this.round.teamOf(p.id);
        if (t0 !== -1) totals[t0] += p.kills;
        for (const r of this.remotes.values()) {
          const t = this.round.teamOf(r.id);
          if (t !== -1) totals[t] += r.kills || 0;
        }
        this.round.teamKills = totals;
      }
      this._applyRoles(p);

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

      // Respawn handling. In a juggernaut round dying is elimination, not a
      // respawn — so the request goes out and the spectator switch happens in
      // _onEliminate, once the authority has agreed.
      if (p.health.dead) {
        if (this.round.isJuggernautMode && this.round.playing) {
          if (!this._elimAsked) {
            this._elimAsked = true;
            this._requestEliminate(p.id);
          }
        } else {
          this.hud.showRespawn(p.health.respawnTimer, this._killerName);
          if (p.health.respawnTimer <= 0) {
            p.spawn(this.world.randomSpawn());
            this.followCam.snapTo(p.pos);
            this.hud.hideRespawn();
            this._killerName = null;
          }
        }
      } else {
        this._elimAsked = false;
      }

      this._drainEvents(p);
      this._sweepGhosts(t);

      for (const r of this.remotes.values()) {
        r.update(dt, t);
        // Invisibility hides you completely from the people hunting you, and
        // merely fades you for everyone on your own side — so a teammate can
        // still follow you without the enemy having a hope of it.
        r.setViewer(this._isHunting(p.id, r.id), false);
      }
      this._updateLocalClone(dt);

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

      this._updatePracticeRing(p);
      this._updateStatue(p);

      this._updateHud(dt, speed);
      this._updateAudioListener();
      Audio.updateAmbient(dt);

      this.net.tickState(dt, () => p.netState());
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Push the round's roles onto the player and the remotes.
   *
   * Everything role-dependent is decided in this one place, every frame, from
   * the round state — so a role change (tagged, eliminated, made juggernaut)
   * can never leave a stale privilege like endless kunai behind.
   */
  _applyRoles(p) {
    const R = this.round;
    const isIt = R.isTagger(p.id);
    const jug = R.isJuggernaut(p.id);
    const spec = R.isSpectating(p.id);

    // Endless kunai for taggers, the juggernaut, and anyone spectating.
    p.inventory.setUnlimitedKunai((R.isTagMode && isIt) || jug || spec);
    p.throwCooldownOverride = (R.isTagMode && isIt) ? CFG.rounds.taggerCooldown : 0;
    p.combatEnabled = R.combatEnabled;
    p.tagMode = R.isTagMode && R.playing;
    p.spectating = spec;
    this._setJuggernaut(p, jug);
    p.model.setTagger(R.isTagMode && isIt);

    for (const r of this.remotes.values()) {
      r.model.setTagger(R.isTagMode && R.isTagger(r.id));
    }
  }

  /**
   * Put the local player into (or out of) the juggernaut's body.
   *
   * The controller does not care which rig it is wearing — ToadModel exposes
   * the same surface FrogModel does — so this is a straight model swap plus
   * the stat changes.
   */
  _setJuggernaut(p, on) {
    if (p.isJuggernaut === on && this._jugModelOn === on) return;
    p.isJuggernaut = on;
    this._jugModelOn = on;

    const old = p.model;
    p.model = on
      ? new ToadModel(true, findSkin('swords', DEFAULT_SKIN.swords))
      : new FrogModel(p.color, p.name, true, this.shop.equippedSkins());
    p.model.root.position.copy(old.root.position);
    p.model.root.rotation.copy(old.root.rotation);
    this.scene.remove(old.root);
    old.dispose();
    this.scene.add(p.model.root);

    // A mountain of health, scaled to the lobby size.
    const mult = on ? (this.round.juggernautHealth || 1) : 1;
    p.health.setMaxScale(mult);
    if (on) {
      this.hud.toast('You are the JUGGERNAUT — slow, but almost unkillable', 4.5);
      this.hud.announce('JUGGERNAUT', 'danger', true);
    }
  }

  /**
   * Is `hunterId` someone `preyId` needs to hide from?
   *
   * Invisibility is deliberately not a blanket vanish: it hides you from
   * whoever is trying to catch you and from nobody else, so a runner's escape
   * still reads on everyone else's screen.
   */
  _isHunting(hunterId, preyId) {
    const R = this.round;
    if (!R || !R.playing) return false;
    if (R.isTagMode) {
      // Only the hunted benefit — a tagger going invisible would be unfair
      // and, on their own screen, pointless.
      return R.isTagger(hunterId) && !R.isTagger(preyId);
    }
    if (R.isTeamMode) return !R.areAllies(hunterId, preyId);
    return false;   // FFA: everyone hunts everyone, so nobody is special
  }

  /**
   * Draw the local player's shadow clone.
   *
   * It is a full copy, not a silhouette: same skins, same colour, no
   * transparency. What sells the decoy is that it does everything you do —
   * swings, throws, parries, sprints, vanishes — a beat behind, replayed from
   * the pose you actually held rather than re-derived.
   */
  _updateLocalClone(dt) {
    const p = this.player;
    const c = p.cloneTransform();
    if (!c) {
      if (this._cloneModel) this._cloneModel.root.visible = false;
      this._cloneAtk = this._cloneThr = undefined;
      return;
    }
    if (!this._cloneModel) {
      this._cloneModel = new FrogModel(p.color, '', true, this.shop.equippedSkins());
      this.scene.add(this._cloneModel.root);
    }
    const m = this._cloneModel;
    const pos = this._cloneStandoff(c, p);

    // Same visibility rule as you: your clone hides when you hide.
    m.root.visible = true;
    m.setGhost(c.invisible ? CFG.abilities.invisibility.friendlyOpacity : 1);
    m.root.position.copy(pos);
    m.setFacing(c.yaw);
    m.update(dt, {
      speed: c.speed,
      vy: c.vy,
      grounded: c.grounded,
      moving: c.moving,
      dashT: c.dashT,
      attackT: c.attackT,
      attackIndex: c.attackIndex,
      throwT: c.throwT,
      grappling: c.grappling,
      tongueTo: c.grappling ? { x: c.gx, y: c.gy, z: c.gz } : null,
      wallSliding: c.wallSliding,
      sprinting: c.sprinting,
      swimming: c.swimming,
      swimPitch: c.swimPitch,
      parrying: c.parrying,
      dead: c.dead,
    });

    // Discrete actions fire on a change of the recorded counter, so one swing
    // makes exactly one arc no matter what the frame rate is doing.
    if (this._cloneAtk === undefined) this._cloneAtk = c.atk;
    if (this._cloneThr === undefined) this._cloneThr = c.thr;
    if (c.atk !== this._cloneAtk) {
      this._cloneAtk = c.atk;
      const i = clamp(c.attackIndex, 0, 2);
      _v3.set(
        pos.x - Math.sin(c.yaw) * 1.5, pos.y + 1.1, pos.z - Math.cos(c.yaw) * 1.5);
      this.effects.slashArc(_v3, c.yaw, i, i === 2 ? 0xfff0b0 : 0xdff3ff, i === 2 ? 3.8 : 3.0);
      Audio.slash(pos, i);
    }
    if (c.thr !== this._cloneThr) {
      this._cloneThr = c.thr;
      this._cloneThrow(pos, c);
    }
  }

  /**
   * Keep the clone behind you rather than inside you.
   *
   * Replaying your path puts it behind you whenever you are moving, but at a
   * standstill the delayed position is exactly where you are — two frogs in
   * the same space, which looks broken and hides nothing. So when the gap
   * closes it is pushed out along your back.
   */
  _cloneStandoff(c, p) {
    const A = CFG.abilities.shadowclone;
    const out = _v3b.set(c.x, c.y, c.z);
    const dx = out.x - p.pos.x, dz = out.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d >= A.minGap) return out;
    // Straight out the back, using the facing you are actually rendered with.
    const bx = Math.sin(p.visualYaw), bz = Math.cos(p.visualYaw);
    out.x = p.pos.x + bx * A.minGap;
    out.z = p.pos.z + bz * A.minGap;
    // Sit it on whatever is under that spot so it does not float or sink.
    // Clamped from below so a clone behind you at the lip of a drop steps
    // down with you rather than teleporting to the valley floor.
    if (this.world && this.world.collision) {
      const g = this.world.collision.groundHeight(out.x, out.z, p.pos.y + 2);
      out.y = Math.max(g, c.y - 1.5);
    }
    return out;
  }

  /** The clone's kunai: visual only, and it never hits anything. */
  _cloneThrow(pos, c) {
    if (!this.kunaiSystem) return;
    _v3c.set(c.tdx, c.tdy, c.tdz);
    if (_v3c.lengthSq() < 1e-6) return;
    _v3c.normalize();
    const o = _v3d.copy(pos);
    o.y += 1.45;
    o.addScaledVector(_v3c, 0.6);
    // local=false: a decoy's kunai is a bluff, it deals no damage.
    this.kunaiSystem.throw_(o, _v3c, 'clone:' + this.player.id, false, null);
    Audio.kunaiThrow(pos);
  }

  /** Send the player's queued events over the wire and handle local ones. */
  _drainEvents(p) {
    if (!p.events.length) return;
    // A spectator leaves no trace: no thrown kunai for others to see, no
    // slashes, no landing puffs. Being invisible is worthless if your kunai
    // still sail across the map in front of everyone.
    if (p.spectating) { p.events.length = 0; return; }
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
      this.round.onEliminate = (id, wasJug) => this._onEliminate(id, wasJug);
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
      // A new round always brings everyone back into the fight.
      this.player.spectating = false;
      this._elimAsked = false;
      this.hud.setSpectating(false);
      // Fresh spawn for everyone, so no one starts a chase cornered.
      this.player.spawn(this.world.randomSpawn());
      this.followCam.snapTo(this.player.pos);
      const info = this.round.modeInfo;
      this.hud.announce(info.name, '', true);
    } else if (phase === PHASE.PLAYING) {
      const it = this.round.isTagger(this.player.id);
      if (this.round.isJuggernautMode) {
        const jug = this.round.isJuggernaut(this.player.id);
        this.hud.announce(jug ? 'YOU ARE THE JUGGERNAUT' : 'KILL THE JUGGERNAUT!',
          jug ? 'danger' : 'good');
      } else if (this.round.isTagMode) {
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
      this._awardRoundEnd();
      // The round is decided, so spectating is over — you rejoin the world
      // for the results and the next vote.
      this.player.spectating = false;
      this.hud.setSpectating(false);
    }
  }

  /**
   * Pay out at the end of a round.
   *
   * Guarded so it can only fire once per round — the ENDING phase change can
   * arrive more than once on a mirror client if a sync packet repeats it.
   */
  _awardRoundEnd() {
    const R = this.round;
    const E = CFG.economy;
    if (!R || this._paidRound === R.roundNumber) return;
    this._paidRound = R.roundNumber;

    const me = this.player.id;
    const wasIt = R.isTagger(me);
    const startedIt = R.startingTaggers && R.startingTaggers.has(me);

    if (R.mode === MODES.TEAM) {
      const mine = R.teamOf(me);
      if (mine !== -1 && R.outcome === 'team' + mine) {
        this.economy.award(E.roundWinReward, 'Team won');
      }
      return;
    }

    if (R.mode === MODES.JUGGERNAUT) {
      const wasJug = R.isJuggernaut(me);
      if (R.outcome === 'juggernaut') {
        // Clearing the whole field is the hardest win in the game.
        if (wasJug) this.economy.award(E.taggerWinReward, 'Won as juggernaut');
      } else if (R.outcome === 'survivors' && !wasJug) {
        this.economy.award(E.roundWinReward, 'Juggernaut down');
      }
      return;
    }

    if (R.mode === MODES.FFA) {
      // Top of the scoreboard takes the round.
      let best = this.player.kills;
      for (const r of this.remotes.values()) best = Math.max(best, r.kills || 0);
      if (this.player.kills >= best && best > 0) {
        this.economy.award(E.roundWinReward, 'Round won');
      }
      return;
    }

    if (R.outcome === 'taggers') {
      if (wasIt) this.economy.award(E.taggerWinReward, 'Won as tagger');
      if (startedIt) this.economy.award(E.infectorStartWinReward, 'Starting infector');
    } else if (R.outcome === 'survivors') {
      if (!wasIt) this.economy.award(E.roundWinReward, 'Survived');
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
      this.economy.award(CFG.economy.tagReward,
        this.round.mode === MODES.INFECTION ? 'Infected' : 'Tagged');
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
   * Ask for an elimination — a juggernaut-round knockout.
   * Same shape as _requestTag: only the authority applies the rule.
   */
  _requestEliminate(victimId) {
    if (this.round.authority) this.round.eliminate(victimId);
    else this.net.sendEvent({ t: 'elim', id: victimId });
  }

  /**
   * Someone has been knocked out of a juggernaut round.
   *
   * For the local player this is the doorway into spectating: no respawn, no
   * interaction either way, endless kunai, invisible to everyone.
   */
  _onEliminate(id, wasJuggernaut) {
    const me = this.player.id;
    const name = id === me ? 'You' : this.net.nameOf(id);

    if (wasJuggernaut) {
      this.hud.announce('THE JUGGERNAUT IS DOWN!', 'good', true);
      Audio.headshot(this.player.pos);
    } else {
      this.hud.toast(`${name} ${id === me ? 'are' : 'is'} out`, 2.2);
    }

    if (id !== me) return;

    // Local player is out: stop the respawn clock and start watching.
    this.player.spectating = true;
    this.player.health.revive();
    this.player.health.dead = false;
    this.player.health.respawnTimer = 0;
    this.hud.hideRespawn();
    this.hud.announce(wasJuggernaut ? 'YOU FELL' : 'ELIMINATED', 'danger', true);
    this.hud.setSpectating(true);
    this.hud.toast(
      'Spectating — endless kunai, invisible, out of the fight until the round ends', 5);
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
    const R = this.round;
    // Spectators can only interact with the dummies, so they never even see
    // the living in their target list — no hits, no aim assist, nothing.
    const ghost = this.player.spectating;

    for (const r of ghost ? [] : this.remotes.values()) {
      if (!r.spawned || r.dead) continue;
      // Teammates are not targets at all — the katana and the kunai's aim
      // assist both read this list, so friendly fire is impossible rather
      // than merely ignored on arrival.
      if (R && R.areAllies(this.player.id, r.id)) continue;
      // Spectators are not in the world: nothing can touch them, and their
      // aim assist must not lock onto them either.
      if (r.spectating || (R && R.isSpectating(r.id))) continue;
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

  /**
   * Where an assisted kunai should aim, for any target id.
   *
   * Works from every viewpoint: the id may be this client's own player (a
   * kunai someone threw at you), another frog, or a training dummy. Writes
   * the chest position into `out` and returns whether it found anything, so
   * a kunai stops curving once its target dies or disconnects.
   */
  _resolveAimTarget(id, out) {
    // The dungeon's boss is the only thing in the room worth curving toward.
    if (this.dungeon) {
      const b = this.dungeon.bossTarget();
      if (b && b.id === id) {
        out.set(b.pos.x, b.pos.y + b.hitbox.bodyOffset, b.pos.z);
        return true;
      }
      return false;
    }
    if (this.player && id === this.player.id && !this.player.health.dead) {
      const b = CFG.hitbox.player;
      out.set(this.player.pos.x, this.player.pos.y + b.bodyOffset, this.player.pos.z);
      return true;
    }
    const r = this.remotes.get(id);
    if (r && r.spawned && !r.dead) {
      const b = CFG.hitbox.player;
      out.set(r.pos.x, r.pos.y + b.bodyOffset, r.pos.z);
      return true;
    }
    if (this.dummies) {
      for (const d of this.dummies.dummies) {
        if (d.id !== id) continue;
        out.copy(d.hitPoint);
        return true;
      }
    }
    return false;
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

    // Hotbar redraws when the inventory changes — or every frame while an
    // ability is running or recharging, since that shade has to actually move.
    const actives = { invisibility: p.invisibleT, shadowclone: p.cloneT };
    const busy = p.inventory.equippedAbilities()
      .some((id) => (p.abilityCd[id] || 0) > 0 || (actives[id] || 0) > 0);
    if (p.inventory.dirty || busy || this._hbBusy) {
      p.inventory.dirty = false;
      this._hbBusy = busy;
      this.hud.setHotbar(p.inventory, p.abilityCd, actives);
    }
    // Your own frog fades rather than vanishing — you still need to see
    // yourself, but the feedback that it is working has to be constant.
    p.model.setGhost(
      p.invisibleT > 0 ? CFG.abilities.invisibility.friendlyOpacity : 1);
    if (p._abilityCue > 0 && !this._cueShown) {
      this._cueShown = true;
      this.hud.toast('Still recharging', 0.9);
    } else if (p._abilityCue <= 0) {
      this._cueShown = false;
    }
    // No supply crates in the story level — there the prompt belongs to the
    // village's fruit stalls, and _updateFruitStalls owns it. Setting it here
    // too would blank their prompt on the same frame it appeared.
    // The statue's prompt takes precedence when it is up, or the two would
    // fight over the same element every frame.
    if (!this.isStory && !this._statuePrompt) {
      this.hud.setPickupPrompt(
        !!this.pickups && !p.health.dead && !!this.pickups.nearest(p.pos));
    }

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
      let role = '';
      let count = R.taggers.size || R.taggerCount;
      if (R.isSpectating(p.id)) {
        role = 'out';
      } else if (R.isJuggernautMode) {
        role = R.isJuggernaut(p.id) ? 'juggernaut' : 'hunter';
        count = R.survivorsLeft(this._playerIds());
      } else if (R.isTagMode) {
        role = R.isTagger(p.id) ? 'it' : 'runner';
      }
      this.hud.setRound(R.modeInfo, R.timer, role, count);
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
    el.textContent = '! ' + (e.message || 'Unknown error') +
      (e.filename ? `\n${e.filename}:${e.lineno}` : '');
  }
});

// PeerJS is loaded as a plain script tag; give it a moment if it is slow.
function boot() {
  try {
    window.game = new Game();
  } catch (err) {
    const el = $('boot-error');
    if (el) { el.classList.add('show'); el.textContent = '! ' + err.message; }
    throw err;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
