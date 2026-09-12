/**
 * FROGSHIN — entry point.
 *
 * Owns the renderer, the mode state machine (menu / loading / playing /
 * paused), and the glue between the gameplay systems and the network layer.
 */

import * as THREE from '../lib/three.module.js?v=v124';
import {
  CFG, BUILD, FROG_COLORS, NINJA_NAMES, dungeonPayout,
} from './config.js?v=v124';
import { clamp, pick, roomCode as makeRoomCode } from './util.js?v=v124';
import { Input } from './input.js?v=v124';
import { Audio } from './audio.js?v=v124';
import { World } from './world.js?v=v124';
import { Effects } from './effects.js?v=v124';
import { Atmosphere } from './atmosphere.js?v=v124';
import { FollowCamera } from './camera.js?v=v124';
import { Player } from './player.js?v=v124';
import { RemotePlayer } from './remote.js?v=v124';
import { HUD } from './hud.js?v=v124';
import { KunaiSystem, PickupSystem, setKunaiSkin } from './items.js?v=v124';
import { FrogModel } from './frog.js?v=v124';
import { DummyField } from './dummy.js?v=v124';
import { RoundManager, PHASE, MODES, maxTaggers } from './rounds.js?v=v124';
import { ToadModel } from './npc.js?v=v124';
import {
  findSkin, DEFAULT_SKIN, CATALOG, RARITY,
  ECLIPSE_SET, ECLIPSE_TITLE, eclipseFound,
} from './skins.js?v=v124';
import { DungeonRun } from './dungeon.js?v=v124';
import { GUARDIAN_NAMES } from './dungeonboss.js?v=v124';
import { JudgmentRun } from './judgment.js?v=v124';
import { TutorialIsland, TUTORIAL_WATER } from './tutorial.js?v=v124';
import { COMBO_NAMES } from './ascended.js?v=v124';
import { MAPS, DEFAULT_MAP, findMap, mapName } from './maps.js?v=v124';
import { MenuScene } from './menu.js?v=v124';
import { Economy } from './economy.js?v=v124';
import { Shop } from './shop.js?v=v124';
import { Network, NetRole, cleanSkins, cleanTitle } from './net.js?v=v124';
import { Overworld } from './overworld.js?v=v124';
import { InventoryScreen } from './inventoryui.js?v=v124';
import { HeavenLevel, HEAVEN, VOID_Y } from './heaven.js?v=v124';
import { Prologue, HERO_LOADOUT } from './prologue.js?v=v124';
import { Cine } from './cinema.js?v=v124';
import { SaveSlots, playtime, stamp } from './saves.js?v=v124';
import { MEMORIES } from './flashbacks.js?v=v124';
import { GUARDIANS } from './guardians.js?v=v124';
import { gearOfTier } from './gear.js?v=v124';
import { Chat } from './chat.js?v=v124';

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
    // Which map the next arena will be built from, and who voted for what.
    // The world is generated from this id alone, so agreeing on it is all
    // the network has to do to put everyone in the same place.
    this.mapId = DEFAULT_MAP;
    this.mapVotes = new Map();
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
    /**
     * The ten save files, and the hook that routes every realm write into
     * whichever one is open. Built straight after the economy because its
     * constructor migrates the single old save into solo file one.
     */
    this.saves = new SaveSlots(this.economy);
    this._eraseTarget = null;

    this.hud = new HUD();
    this.hud.show(false);
    this.hud.setFroglets(this.economy.froglets);

    /**
     * TEXT CHAT. Tap Ctrl to open, Enter to send.
     *
     * Sent on the `event` channel, which is reliable and already relayed
     * through the host with the sender stamped on it — so a client's message
     * reaches every other client without chat needing a route of its own.
     *
     * `canOpen` is "playing, with the mouse captured", and the second half is
     * the load-bearing one. Every screen in this game that wants the keyboard
     * releases the pointer first — the pause menu, the vote screen, the
     * inventory, the practice panel — so asking whether the lock is held is
     * asking whether anything else already owns the input, and it keeps
     * answering correctly for panels that do not exist yet.
     *
     * It matters because the chat suspends the whole input layer while it is
     * up. Opening it behind a panel would leave that panel unable to read a
     * key, with the box that caused it hidden underneath.
     */
    this.chat = new Chat({
      input: this.input,
      canOpen: () => this.mode === 'playing' && this.input.locked,
      selfName: () => this.profile.name,
      selfColor: () => this.profile.color,
      /**
       * SEND IT — and say so plainly if it went nowhere.
       *
       * Returns null when the line left the machine, or the reason it did
       * not. The chat shows that reason as a system line and marks the
       * message undelivered.
       *
       * This exists because the first version silently pretended to work: it
       * echoed your line into your own log with full confidence whether or
       * not anybody else would ever see it, and the only symptom was other
       * players not replying. A chat that cannot tell you it failed is worse
       * than one that does not exist, because you keep talking to nobody.
       *
       * The four cases are genuinely different and worth telling apart —
       * playing alone, still connecting, a link that died, and a room you
       * are the only one in.
       */
      onSend: (text) => {
        if (!this.net.isOnline) {
          return 'You are playing offline — nobody else can see that.';
        }
        if (!this.net.connected) {
          return 'Not connected to the room yet — that one did not send.';
        }
        if (!this.net.sendEvent({ t: 'chat', s: text })) {
          return 'The link to the room is down — that one did not send.';
        }
        if (this.net.playerCount <= 1) return 'Nobody else is here yet.';
        return null;
      },
    });

    // The Tab inventory is built once and borrows the renderer for its
    // paperdoll. It only ever opens in the open world.
    this.inventoryUI = new InventoryScreen(this.renderer, () => {
      if (this.overworld) this.overworld.applyStats();
    });

    this.menuScene = new MenuScene(this.renderer);
    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Stamped from BUILD, so it always names the modules actually running.
    // See the note in index.html for why this exists.
    const stamp = $('build-stamp');
    if (stamp) stamp.textContent = BUILD;

    this._buildMenuUI();
    this._buildCheatUI();
    this._applyQuality(this.settings.quality);

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);

    /**
     * ═══ THE FIRST TIME ANYBODY OPENS THIS ═════════════════════════════════
     *
     * Straight to the island. No menu, no name field, no map picker — you
     * wake up on a beach and an old frog tells you which key jumps.
     *
     * The flag lives in `settings`, which is the one thing that already
     * round-trips through localStorage on its own, so a returning player
     * never sees it again — and neither does one who skipped it, because a
     * skip is a decision and asking again would be the game arguing.
     *
     * Audio and pointer lock both need a gesture the player has not made
     * yet, which is fine: the island builds, the click-to-play prompt comes
     * up over it, and the first click starts both. See `_syncClickToPlay`.
     */
    if (!this.settings.tutorialDone) {
      this.pendingMode = 'tutorial';
      this._enterGame();
    }
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
      /**
       * What we are WEARING, as three ids, for everyone else to build us
       * from. Read off the economy rather than `shop.equippedSkins()` so it
       * is available before the shop has rendered — the profile is asked for
       * on the way into a room, which can be the first thing that happens.
       */
      skins: {
        frog: this.economy.equipped.frog || DEFAULT_SKIN.frogs,
        sword: this.economy.equipped.sword || DEFAULT_SKIN.swords,
        kunai: this.economy.equipped.kunai || DEFAULT_SKIN.kunai,
      },
      /**
       * THE ONE TITLE — sent only if all three Eclipse secrets are owned.
       *
       * Derived here rather than stored, so it cannot fall out of step with
       * the collection: sell the save, edit the save, start a new one, and
       * the title follows what you actually have. The receiving end checks
       * it against the same constant (see `cleanTitle` in net.js), so this
       * is a claim that is verified, not one that is trusted.
       */
      title: eclipseFound(this.economy) ? ECLIPSE_TITLE : null,
    };
  }

  // ------------------------------------------------------------- menu UI

  _buildMenuUI() {
    const panels = ['home', 'play', 'lobby', 'shop', 'howto', 'settings',
      'credits', 'dungeon', 'saves', 'erase', 'croaklands', 'practice',
      'customize', 'avatar'];
    this.showPanel = (name) => {
      for (const p of panels) $('panel-' + p).classList.toggle('active', p === name);
      /**
       * `at-home` lets the CSS give the logo its full height on the first
       * screen and pull it in on the deeper ones, where the card carries its
       * own heading and two stacked titles is one too many.
       */
      $('menu').classList.toggle('at-home', name === 'home');
      // Each mode screen reads its numbers off the save as it opens, so they
      // are right on the second visit as well as the first.
      if (name === 'dungeon') this._renderDungeonStats();
      if (name === 'croaklands') this._renderRealmStats();
      Audio.uiClick();
    };
    $('menu').classList.add('at-home');

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

    $('btn-play').onclick = () => {
      this._renderMapPicker('play-maps', false);
      this._toggleMapList('play', false);      // opens shut every time
      this.showPanel('play');
    };
    // The two map lists start closed and are opened by their own button.
    $('play-map-toggle').onclick = () => {
      Audio.uiClick();
      this._toggleMapList('play');
    };
    $('lobby-map-toggle').onclick = () => {
      Audio.uiClick();
      this._toggleMapList('lobby');
    };
    // `openShop`/`openAvatar` rather than `render`, because the skin cards
    // are drawn on both screens and the Shop has to know which one it is
    // redrawing when you click one. See `Shop.refresh`.
    $('btn-shop').onclick = () => { this.shop.openShop(); this.showPanel('shop'); };
    $('btn-howto').onclick = () => this.showPanel('howto');
    $('btn-settings').onclick = () => this.showPanel('settings');
    $('btn-credits').onclick = () => this.showPanel('credits');
    // The two screens the main menu gained: what was buried under an "OR"
    // divider, and the name and colour that used to be asked of you before
    // you had chosen anything.
    $('btn-practice').onclick = () => this.showPanel('practice');
    $('btn-customize').onclick = () => this.showPanel('customize');
    $('btn-customize-shop').onclick = () => {
      this.shop.openShop();
      this.showPanel('shop');
    };
    $('btn-avatar').onclick = () => {
      this.shop.openAvatar();
      this.showPanel('avatar');
    };
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

    // Creating or joining a room lands in a LOBBY rather than launching
    // straight into a match, so the host has a moment to choose.
    $('btn-host').onclick = () => { this.pendingMode = null; this._connect('host', null); };
    $('btn-join').onclick = () => {
      const code = roomInput.value.trim();
      if (!code) { this._playStatus('Enter a room code to join.', true); return; }
      this.pendingMode = null;
      this._connect('join', code);
    };
    // Quick Play and the two solo buttons are explicit, so they go right in.
    $('btn-quickplay').onclick = () => {
      this.pendingMode = 'arena';
      this._connect('quick', CFG.net.publicRoom);
    };
    $('btn-solo').onclick = () => { this.pendingMode = 'arena'; this._connect('solo', null); };

    /**
     * --- THE FIRST ISLAND: the tutorial, on demand ---
     *
     * It plays itself the first time the game is ever opened, so this is for
     * the second time onward. Offline and connectionless, like the dungeon:
     * there is nobody else on the island.
     */
    $('btn-tutorial').onclick = () => {
      Audio.uiClick();
      Audio.init(); Audio.resume();
      if (this.net.isOnline) this.net.disconnect();
      this.pendingMode = 'tutorial';
      this._enterGame();
    };

    /**
     * --- THE CROAKLANDS: the main game ---
     *
     * This replaced the old Story Mode, which was one scripted level in its
     * own scene — a burning village, a walk down a path, one boss. Everything
     * it was trying to be is here instead, twenty-four regions of it, and
     * there is no reason to keep two answers to the same question in the
     * menu. Solo, offline, and it remembers everything.
     */
    /**
     * The button on the PLAY screen now OPENS the Croaklands screen; the one
     * ON that screen is what starts a game. A button that went straight to a
     * file-picker gave you nothing to decide with — no idea what the mode
     * was or how far you had got — and no way back out that was not the file
     * screen's own.
     */
    $('btn-realm').onclick = () => this.showPanel('croaklands');
    $('btn-realm-enter').onclick = () => {
      Audio.uiClick();
      Audio.init(); Audio.resume();
      this._showSaves();
    };

    // --- the save files ---
    /**
     * BACK MEANS ONE STEP, not all the way out.
     *
     * The generic handler above sends everything home, which is right for the
     * leaf panels hanging off the main menu. These four hang off PLAY, and
     * the file screen hangs off the Croaklands screen — so back on each of
     * them undoes one step rather than the whole journey. Assigned after that
     * loop so they win.
     */
    const backTo = {
      croaklands: 'play', dungeon: 'play', practice: 'play',
      customize: 'play', saves: 'croaklands', avatar: 'customize',
    };
    for (const [from, to] of Object.entries(backTo)) {
      const b = $('panel-' + from).querySelector('.btn-back');
      if (b) b.onclick = () => { Audio.uiBack(); this.showPanel(to); };
    }
    $('btn-erase-no').onclick = () => { Audio.uiBack(); this._showSaves(); };
    $('btn-erase-yes').onclick = () => {
      const t = this._eraseTarget;
      if (t) this.saves.erase(t.kind, t.index);
      this._eraseTarget = null;
      Audio.uiClick();
      this._showSaves();
    };

    // --- the dungeon: solo, offline, and the run style is fixed up front ---
    $('btn-dungeon').onclick = () => { Audio.uiClick(); this.showPanel('dungeon'); };
    $('btn-dungeon-cp').onclick = () => this._startDungeon(true);
    $('btn-dungeon-nocp').onclick = () => this._startDungeon(false);

    // --- lobby ---
    // The arena is the only thing there is to play together: the Croaklands
    // is a single-player country with one save, and the dungeon is a run.
    $('lobby-arena').onclick = () => this._hostStart('arena');
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

  // ------------------------------------------------------------ save files

  /**
   * THE SAVE SCREEN.
   *
   * Ten rows, built from `SaveSlots`. An empty one says so and starts a new
   * adventure; a used one shows what is in it and continues. The bin beside
   * each row goes to its own confirmation screen with the file named on it.
   */
  _showSaves() {
    this._paintSaves('solo', $('saves-solo'));
    this._paintSaves('mp', $('saves-mp'));
    $('save-status').textContent = '';
    this.showPanel('saves');
  }

  _paintSaves(kind, host) {
    if (!host) return;
    host.innerHTML = '';
    for (const row of this.saves.list(kind)) {
      const el = document.createElement('div');
      el.className = 'save-row' + (row.empty ? ' is-empty' : '');
      const active = this.saves.active;
      if (active && active.kind === kind && active.index === row.index) {
        el.classList.add('is-active');
      }

      const pick = document.createElement('button');
      pick.className = 'save-pick';
      const no = document.createElement('span');
      no.className = 'save-slotno';
      no.textContent = 'FILE ' + (row.index + 1);
      const body = document.createElement('div');
      body.className = 'save-body';
      const title = document.createElement('div');
      title.className = 'save-title';
      const facts = document.createElement('div');
      facts.className = 'save-facts';

      if (row.empty) {
        title.textContent = 'EMPTY — START A NEW ADVENTURE';
        facts.textContent = kind === 'mp'
          ? 'A fresh run through the Croaklands, played with others.'
          : 'A fresh run through the Croaklands.';
      } else {
        const m = row.meta || {};
        title.textContent = m.prologue
          ? (m.region ? String(m.region).toUpperCase() : 'THE CROAKLANDS')
          : 'THE LAST MORNING OF THE WAR';
        const bits = [];
        bits.push(`<b>${m.slain || 0}</b> guardians`);
        bits.push(`<b>${m.memories || 0}</b> memories`);
        bits.push(`<b>${m.hearts || 3}</b> hearts`);
        bits.push(playtime(m.seconds));
        bits.push(stamp(m.updated));
        facts.innerHTML = bits.join('<span class="sep">·</span>');
        // Thirty-seven guardians is the whole main line; the bar is how far
        // along it this file is, which is the one number that means anything
        // at a glance.
        const bar = document.createElement('div');
        bar.className = 'save-bar';
        const fill = document.createElement('i');
        fill.style.width = Math.min(100,
          Math.round(((m.slain || 0) / 37) * 100)) + '%';
        bar.appendChild(fill);
        body.appendChild(bar);
      }
      body.insertBefore(facts, body.firstChild);
      body.insertBefore(title, body.firstChild);
      pick.appendChild(no);
      pick.appendChild(body);
      pick.onmouseenter = () => Audio.uiHover();
      pick.onclick = () => this._openSave(kind, row.index, row.empty);
      el.appendChild(pick);

      if (!row.empty) {
        const del = document.createElement('button');
        del.className = 'save-del';
        del.textContent = '✕';
        del.title = 'Delete this file';
        del.onclick = (ev) => {
          ev.stopPropagation();
          Audio.uiBack();
          this._askErase(kind, row.index, row.meta);
        };
        el.appendChild(del);
      }
      host.appendChild(el);
    }
  }

  _askErase(kind, index, meta) {
    this._eraseTarget = { kind, index };
    const m = meta || {};
    $('erase-what').innerHTML =
      `<b>${kind === 'mp' ? 'MULTIPLAYER' : 'SOLO'} — FILE ${index + 1}</b><br>`
      + `${m.slain || 0} guardians down · ${m.memories || 0} memories `
      + `recovered · ${playtime(m.seconds)} played<br>`
      + `Last played ${stamp(m.updated) || 'never'}`;
    this.showPanel('erase');
  }

  /**
   * Open a file and go.
   *
   * A brand new file plays the opening — the heavenly battlefield, Frogath,
   * and the fall — and then wakes up in the Croaklands. A file that has
   * already seen it goes straight back to where it left off.
   */
  _openSave(kind, index, empty) {
    Audio.uiClick();
    Audio.init(); Audio.resume();
    if (empty) this.saves.create(kind, index);
    else this.saves.select(kind, index);
    this.pendingMode = this.saves.sawPrologue(kind, index)
      ? 'realm' : 'prologue';
    if (this.net.isOnline && kind === 'solo') this.net.disconnect();
    this._enterGame();
  }

  /** Show the pre-match lobby and keep its player count live. */
  _showLobby() {
    this.showPanel('lobby');
    this._toggleMapList('lobby', false);       // opens shut every time
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
      ? 'You are in — vote for a map; the host starts it'
      : (n === 1
        ? 'Waiting for friends — they join with the code above'
        : 'Ready when you are');
    this._renderRoster();
    this._renderMapPicker('lobby-maps', true);
  }

  /**
   * WHO IS IN THE ROOM, by name, with their title.
   *
   * Offline there is nobody to show it to, so the list is left empty and
   * CSS collapses it — a one-row list of yourself is furniture.
   *
   * Names come off the wire, so they go in as `textContent`. The title does
   * not: `net.cleanTitle` has already reduced it to one known constant or
   * null, which is exactly why it is safe to draw at all.
   */
  _renderRoster() {
    const box = $('lobby-roster');
    if (!box) return;
    box.innerHTML = '';
    if (!this.net.isOnline || this.net.playerCount < 2) return;
    for (const p of this.net.lobbyList) {
      const row = document.createElement('div');
      row.className = 'lr-row';
      const col = '#' + (p.color >>> 0).toString(16).padStart(6, '0');
      row.style.borderLeftColor = col;

      const dot = document.createElement('span');
      dot.className = 'lr-dot';
      dot.style.background = col;
      row.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'lr-name';
      name.textContent = p.name || 'Frog';
      row.appendChild(name);

      if (p.you) {
        const you = document.createElement('span');
        you.className = 'lr-you';
        you.textContent = '(YOU)';
        row.appendChild(you);
      }
      if (p.title) {
        const t = document.createElement('span');
        t.className = 'lr-title';
        t.textContent = `[${p.title}]`;
        row.appendChild(t);
      }
      box.appendChild(row);
    }
  }

  /**
   * The map picker, shared by the play panel and the lobby.
   *
   * @param hostId   which container to fill
   * @param voting   true in the lobby, where a click is a VOTE. The host's
   *                 own vote is also the decision — someone has to break a
   *                 tie, and the host is already the one who presses start.
   */
  /**
   * Show or hide a map list. Pressing the button again closes it.
   *
   * @param force  true/false to set it outright; omitted to flip.
   */
  _toggleMapList(which, force) {
    const row = $(`${which}-maps`);
    const btn = $(`${which}-map-toggle`);
    if (!row || !btn) return;
    const open = force === undefined ? !row.classList.contains('open') : !!force;
    row.classList.toggle('open', open);
    btn.classList.toggle('open', open);
  }

  _renderMapPicker(hostId, voting) {
    const host = $(hostId);
    if (!host) return;
    const isHost = !this.net.isOnline || this.net.isHost;
    // Keep the button's label showing the current pick, so the list can stay
    // shut and still tell you where you are going.
    const label = $(hostId.replace('-maps', '-map-current'));
    if (label) label.textContent = mapName(this.mapId);
    host.innerHTML = '';
    for (const m of MAPS) {
      const card = document.createElement('button');
      card.className = 'map-card' + (m.id === this.mapId ? ' picked' : '');
      const votes = voting ? this._mapVoteCount(m.id) : 0;
      card.innerHTML = `<div><b>${m.name}</b><span>${m.blurb}</span></div>`
        + `<i>${votes || ''}</i>`;
      card.onclick = () => {
        Audio.uiClick && Audio.uiClick();
        this._voteMap(m.id);
      };
      host.appendChild(card);
    }
    const note = $('lobby-map-note');
    if (note && voting) {
      note.innerHTML = isHost
        ? 'Everyone votes; <b>your</b> pick is the one that loads. The '
          + '<b>game mode</b> is voted for once you are all in.'
        : 'Vote for a map — the host has the final say. The <b>game mode</b> '
          + 'is voted for once you are all in.';
    }
  }

  _mapVoteCount(id) {
    let n = 0;
    for (const v of this.mapVotes.values()) if (v === id) n++;
    return n;
  }

  /**
   * Cast a map vote. The host's vote also SETS the map, and is broadcast so
   * everyone's picker agrees on what is actually going to load.
   */
  _voteMap(id) {
    const me = this.net.selfId || 'local';
    this.mapVotes.set(me, id);
    const isHost = !this.net.isOnline || this.net.isHost;
    if (isHost) this.mapId = id;
    if (this.net.isOnline) {
      this.net.sendEvent(isHost ? { t: 'map', id } : { t: 'mapvote', id });
    }
    this._renderMapPicker('lobby-maps', true);
    this._renderMapPicker('play-maps', false);
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

    /**
     * TELL THE ROOM WHAT WE ARE WEARING.
     *
     * Skins ride along with the introduction (see the connection metadata in
     * js/net.js), which covers everybody who was already dressed when they
     * arrived. This covers the other case: equipping something from the shop
     * without leaving the match, which is a thing you can do from the pause
     * menu and from the practice ring.
     *
     * Three ids, once per change, on the reliable channel. Not per frame and
     * not in the state packet — this changes when somebody opens a menu, not
     * twenty times a second.
     */
    const ids = {
      frog: this.economy.equipped.frog || DEFAULT_SKIN.frogs,
      sword: this.economy.equipped.sword || DEFAULT_SKIN.swords,
      kunai: this.economy.equipped.kunai || DEFAULT_SKIN.kunai,
    };
    if (JSON.stringify(ids) !== this._sentSkins) {
      this._sentSkins = JSON.stringify(ids);
      this.net.sendEvent({ t: 'skins', s: ids });
    }

    /**
     * AND THE TITLE, on the same terms.
     *
     * It normally arrives with the introduction, which covers everybody who
     * already had it when they joined. This covers the other case, and it
     * is the case that matters: finishing the set from the pause menu, in a
     * room, with the people you want to show it to already watching.
     *
     * `onChange` fires after every crate reveal, so the moment the third
     * secret lands this runs — once, because the comparison below only
     * sends when it has actually changed.
     */
    const title = eclipseFound(this.economy) ? ECLIPSE_TITLE : null;
    if (title !== this._sentTitle) {
      this._sentTitle = title;
      // Our own copy too, or the roster would show everyone else's title
      // and not ours — `lobbyList` reads this for the "(YOU)" row.
      if (this.net.profile) this.net.profile.title = title;
      this.net.sendEvent({ t: 'title', s: title });
      this._refreshLobby();
    }
  }

  /** Throw away the shadow-clone model so it is rebuilt with fresh skins. */
  _dropClone() {
    if (!this._cloneModel) return;
    if (this.scene) this.scene.remove(this._cloneModel.root);
    this._cloneModel.dispose();
    this._cloneModel = null;
  }

  /**
   * THE DUNGEON SCREEN'S TWO NUMBERS.
   *
   * Both come off the save. There is deliberately no "best time" row: the
   * game does not time a run, and a `--:--` that can never fill in is worse
   * than a row that is not there — it reads as a feature that is broken.
   */
  _renderDungeonStats() {
    const TOTAL = 15;
    const deep = Math.max(0, Math.min(TOTAL, this.economy.dungeonDeepest | 0));
    $('dg-beaten').textContent = `${deep} / ${TOTAL}`;

    // A bookmark exists only while a run is unfinished, and each mode keeps
    // its own — so say which mode as well as which room.
    const cp = this.economy.dungeonRunFor(true);
    const hard = this.economy.dungeonRunFor(false);
    const run = cp || hard;
    $('dg-run').textContent = run
      ? `GUARDIAN ${Math.max(1, (run.checkpoint | 0) + 1)}`
      : '—';
    const sub = $('dg-run').parentElement.querySelector('span');
    if (sub) {
      sub.textContent = run
        ? (cp ? 'SAVED RUN — CHECKPOINTS' : 'SAVED RUN — NO CHECKPOINTS')
        : 'RUN IN PROGRESS';
    }
  }

  /**
   * The Croaklands screen's summary.
   *
   * Built rather than hard-coded because what a returning player wants to
   * see is their own file, and somebody who has never played wants to see
   * the size of the thing instead.
   */
  _renderRealmStats() {
    const el = $('realm-stats');
    if (!el) return;
    el.textContent = '';
    const stat = (value, label) => {
      const d = document.createElement('div');
      d.className = 'stat';
      const b = document.createElement('b');
      b.textContent = value;
      const s = document.createElement('span');
      s.textContent = label;
      d.appendChild(b); d.appendChild(s);
      el.appendChild(d);
    };

    /**
     * The most-played solo file. `list` returns rows whose detail lives on
     * `meta`, not on the row — reading `s.seconds` off the row itself gives
     * undefined for every file and silently picks the first one.
     */
    let best = null;
    try {
      for (const s of this.saves.list('solo') || []) {
        if (!s || s.empty || !s.meta) continue;
        if (!best || (s.meta.seconds || 0) > (best.seconds || 0)) best = s.meta;
      }
    } catch (e) { best = null; }

    if (best) {
      stat(best.region || 'THE CROAKLANDS', 'LAST SEEN');
      stat(playtime(best.seconds || 0), 'PLAYED');
    } else {
      // Nothing saved yet: say how big it is instead of showing empty rows.
      stat('24', 'REGIONS');
      stat('17', 'ROADS');
    }
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
      this._connecting = false;
      this._playStatus(msg, true);
      if (this.mode === 'loading') {
        // Connection died during load — fall back to a clearly-labelled solo game.
        this._playStatus(msg + ' Starting solo instead.', true);
        net.startSolo(this.profile);
      }
    };

    net.onReady = () => {
      this._connecting = false;
      if (this.mode !== 'menu' && this.mode !== 'menu-overlay') return;
      // A room made with Create/Join waits in the lobby for the host to
      // start it. Everything else launches immediately.
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

    net.onJoin = (id, prof) => {
      // In the log as well as the toast. A toast is gone in three seconds;
      // the chat is where you look to find out who is actually in the room.
      if (this.chat) this.chat.system(`${prof.name} joined`);
      this._addRemote(id, prof);
    };

    net.onLeave = (id) => {
      this._pendingJoins.delete(id);
      this._refreshLobby();
      if (this.round) this.round.removePlayer(id);
      const r = this.remotes.get(id);
      if (!r) return;
      if (this.hud) this.hud.toast(`${r.name} left`);
      if (this.chat) this.chat.system(`${r.name} left`);
      r.dispose();
      this.remotes.delete(id);
    };

    net.onState = (id, s) => {
      const r = this.remotes.get(id);
      if (r) r.pushSnapshot(s, now());
    };

    net.onEvent = (id, ev) => {
      /**
       * A CHAT LINE from another player.
       *
       * Handled first and returned from immediately: it is the one event that
       * has nothing to do with a remote player OBJECT, so it must not depend
       * on them having spawned. Somebody typing in the lobby before the world
       * is built should still be heard.
       *
       * The text is not trusted. `Chat.push` writes it with textContent and
       * caps its length — the string came off a peer connection.
       */
      /**
       * SOMEBODY CHANGED THEIR SKIN mid-match.
       *
       * Kept on the profile as well as pushed at the model, so a player who
       * has not spawned yet — parked in `_pendingJoins` while the world
       * builds — is created wearing the right thing rather than the thing
       * they had on when they connected.
       */
      if (ev.t === 'skins') {
        const ids = cleanSkins(ev.s);
        const prof = this.net.profiles.get(id);
        if (prof) prof.skins = ids;
        const parked = this._pendingJoins.get(id);
        if (parked) parked.skins = ids;
        const r = this.remotes.get(id);
        if (r && r.setSkins) r.setSkins(ids);
        return;
      }
      /**
       * SOMEBODY EARNED THE TITLE mid-match.
       *
       * Through `cleanTitle` like every other route, so a peer on a hacked
       * build can announce nothing but the one real title. The lobby is
       * refreshed because that is the screen it is drawn on, and a player
       * can be sitting in it while someone else opens cases.
       */
      if (ev.t === 'title') {
        const prof = this.net.profiles.get(id);
        if (prof) prof.title = cleanTitle(ev.s);
        this._refreshLobby();
        return;
      }
      if (ev.t === 'chat') {
        const prof = this.net.profiles.get(id);
        this.chat.push({
          name: this.net.nameOf(id),
          text: ev.s,
          color: prof ? prof.color : 0xdfe6c8,
        });
        return;
      }
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
      if (ev.t === 'map') {
        // The host has settled the map. Everyone must build the same world,
        // so this is not a vote — it is the answer.
        this.mapId = findMap(ev.id).id;
        this.mapVotes.set(id, this.mapId);
        this._renderMapPicker('lobby-maps', true);
        this._renderMapPicker('play-maps', false);
        return;
      }
      if (ev.t === 'mapvote') {
        this.mapVotes.set(id, findMap(ev.id).id);
        this._renderMapPicker('lobby-maps', true);
        return;
      }
      if (ev.t === 'froglets') {
        // A gift from the developer menu. Froglets live in each player's own
        // browser, so the sender cannot credit anyone directly — it asks, and
        // the recipient pays itself. `to` is a player id, or '*' for the room.
        const me = this.net.selfId || 'local';
        if (ev.to !== '*' && ev.to !== me) return;
        const n = clamp(Math.round(Number(ev.n) || 0), 1, 9999999);
        this.economy.grant(n, `Gift from ${this.net.nameOf(id) || 'a frog'}`);
        this.hud.toast(
          `${this.net.nameOf(id) || 'Someone'} gave you ${n} froglets`, 4);
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
    // Tell a late joiner which mode is already running, and which map — they
    // must build the same world as everybody else or nothing lines up.
    if (!this.net.isOnline || this.net.isHost) {
      this.net.sendEvent({ t: 'map', id: this.mapId });
      if (this.sessionMode) this.net.sendEvent({ t: 'gamemode', m: this.sessionMode });
    }
    if (this.remotes.has(id)) return;
    if (!this.scene || !this.effects) {
      this._pendingJoins.set(id, prof);
      return;
    }
    const r = new RemotePlayer(id, prof.name, prof.color, this.scene,
      this.effects, prof.skins);
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
    // A second press while the first attempt is still in flight would tear
    // down the Peer that was about to succeed and start over — and on a slow
    // network, pressing again is exactly what people do.
    if (this._connecting && kind !== 'solo') {
      this._playStatus('Still connecting — give it a moment…', false);
      return;
    }
    this._connecting = kind !== 'solo';
    this._playStatus('Starting…', false);
    if (kind === 'solo') { this.net.startSolo(this.profile); return; }
    if (!Network.available) {
      this._playStatus('Multiplayer library unavailable — check your connection. Starting solo.', true);
      this.net.startSolo(this.profile);
      return;
    }
    if (kind === 'quick') this.net.quickPlay(this.profile, code);
    else if (kind === 'host') this.net.host(this.profile, code || makeRoomCode());
    else this.net.join(this.profile, code);
  }

  // ---------------------------------------------------------- game lifecycle

  async _enterGame() {
    if (this.mode === 'loading' || this.mode === 'playing') return;
    // Start dry. Only the arena has water at all, so the dungeon and the
    // judgment arena have no way of ever clearing this themselves —
    // whatever they inherit, they keep. Doing it on the way in as well as on
    // the way out means neither direction can carry the blue across.
    this._clearUnderwater();
    this.mode = 'loading';
    $('menu').classList.remove('show');
    const loading = $('loading');
    loading.classList.add('show');
    const bar = $('loading-bar');
    const label = $('loading-label');

    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

    // The dungeon builds its own level in its own scene.
    if (this.pendingMode === 'dungeon') {
      this.pendingMode = null;
      this.sessionMode = 'dungeon';
      await this._enterDungeon(loading, bar, label, frame, this._dungeonCheckpoints);
      return;
    }
    // The opening: the heavenly battlefield, in its own scene.
    if (this.pendingMode === 'prologue') {
      this.pendingMode = null;
      this.sessionMode = 'prologue';
      await this._enterPrologue(loading, bar, label, frame);
      return;
    }
    // The open world builds its own realm, in its own scene.
    if (this.pendingMode === 'realm') {
      this.pendingMode = null;
      this.sessionMode = 'realm';
      await this._enterRealm(loading, bar, label, frame);
      return;
    }
    // And the judgment arena, reached only through the statue.
    if (this.pendingMode === 'judgment') {
      this.pendingMode = null;
      this.sessionMode = 'judgment';
      await this._enterJudgment(loading, bar, label, frame);
      return;
    }
    // The first island — the tutorial. See js/tutorial.js.
    if (this.pendingMode === 'tutorial') {
      this.pendingMode = null;
      this.sessionMode = 'tutorial';
      await this._enterTutorial(loading, bar, label, frame);
      return;
    }
    this.pendingMode = null;
    this.sessionMode = 'arena';

    // The arena world is kept between matches so a rematch loads instantly.
    // That cache was never keyed on the MAP, so picking a different one in
    // the lobby left the old world standing and the game reopened the map you
    // had just switched away from — with only a page refresh to clear it.
    if (this.world && this.world.map && this.world.map.id !== this.mapId) {
      this._dropArenaWorld();
    }

    if (!this.world) {
      // --- first-time world build, one step per frame ---
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(
        CFG.camera.fov, window.innerWidth / window.innerHeight, CFG.camera.near, CFG.camera.far);

      const world = new World(this.scene, this.mapId);
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
      // The map's own sky, fog and light. Quality settings still win, so a
      // map asking for cloud cannot override someone's low-spec choice.
      const A = world.map.atmosphere || {};
      this.atmo = new Atmosphere(this.scene, this.renderer, {
        ...A,
        leafCount: A.leaves === false ? 0 : this.quality.leaves,
        cloudCount: Math.min(A.cloudCount === undefined ? 26 : A.cloudCount,
          this.quality.clouds),
        shadows: this.quality.shadows,
      });
      if (A.sunColor !== undefined) this.atmo.sun.color.setHex(A.sunColor);
      if (A.sunIntensity !== undefined) this.atmo.sun.intensity = A.sunIntensity;
      if (A.ambient !== undefined) this.atmo.hemi.color.setHex(A.ambient);
      if (A.ambientIntensity !== undefined) {
        this.atmo.hemi.intensity = A.ambientIntensity;
      }
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
    this.player.spawn(this._safeSpawn());
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

  /**
   * Throw the cached arena world away so the next entry builds a fresh one.
   *
   * Everything dropped here is rebuilt by _enterArena. The systems go with
   * the world rather than being kept: Effects, the kunai system and the
   * pickups all hold the scene and the collider, so keeping one would pin the
   * discarded world in memory and have it drawing into a scene nobody
   * renders.
   */
  _dropArenaWorld() {
    if (this.player) {
      if (this.scene) this.scene.remove(this.player.model.root);
      this.player.model.dispose();
      this.player = null;
    }
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this._dropClone();                 // needs this.scene, so before the null
    if (this.atmo && this.atmo.dispose) this.atmo.dispose();
    if (this.world && this.world.dispose) this.world.dispose();
    this.world = null;
    this.scene = null;
    this.effects = null;
    this.kunaiSystem = null;
    this.dummies = null;
    this.atmo = null;
    this.pickups = null;
    this.followCam = null;
    this.round = null;
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
    this.dungeon.onVictory = () => {
      // The run is over: there is nothing left to come back to.
      this.economy.clearDungeonRun(checkpoints);
      this._awardFrogathSkin();
    };
    this.dungeon.onCrystal = () => {
      this.economy.crystal = true;
      this.economy.save();
    };
    this.dungeon.onProgress = (room, mode) =>
      this.economy.setDungeonRun(mode, room);

    /**
     * ── A GUARDIAN'S FIRST KILL PAYS ──────────────────────────────────
     *
     * Keyed on the ROOM, not on the mode, so beating room six with
     * checkpoints and then again without does not pay twice. The bounty is
     * for having beaten that guardian, and you only do that once.
     *
     * The toast is worth having: `award` queues a purse popup, but a
     * five-figure payout during a boss death animation deserves to be said
     * out loud next to "GUARDIAN DOWN".
     */
    this.dungeon.onBossCleared = (room) => {
      const paid = this.economy.awardOnce(
        `dungeon:${room}`,
        dungeonPayout(room),
        `Room ${room + 1} cleared`,
      );
      if (paid > 0) {
        this.hud.toast(`+${paid.toLocaleString('en-GB')} froglets — `
          + 'first time down here', 4);
      }
    };

    /**
     * Offer to pick the run up where it was left, before it starts.
     *
     * Only THIS mode's bookmark is looked at. Dying at room seven with
     * checkpoints on and then choosing no-checkpoints used to drop you at
     * room seven, which hands the harder mode the easier one's progress and
     * skips the entire thing it is for.
     *
     * And only from room two on: "continue" at the first room is the same
     * thing as starting over, and a question with two identical answers is
     * just a click in the way.
     */
    const saved = this.economy.dungeonRunFor(checkpoints);
    const room = saved && saved.checkpoint > 0
      ? Math.min(saved.checkpoint, CFG.dungeon.rooms - 1) : 0;
    const at = room > 0 ? await this._askResume(room, checkpoints) : 0;

    this.dungeon.start(this.player, at);
    this.followCam.snapTo(this.player.pos);

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
    Audio.stopMenuMusic();
    this._resize();
  }

  /**
   * Ask whether to resume a saved dungeon run, and wait for the answer.
   *
   * Resolves to the room to start in: the saved one, or zero.
   *
   * Both buttons are unbound and the panel hidden the moment either is
   * pressed — so the question can be answered exactly once, and cannot be
   * left on screen over a run that has already begun. It resolves rather
   * than calling back so the caller reads as a straight line: ask, then
   * start the dungeon at whatever came back.
   *
   * Continuing does NOT restore the fight you were in. You arrive at the
   * start of that room with your health full and the boss's full, which is
   * what walking into a room does anyway — the save is a bookmark, not a
   * snapshot.
   */
  _askResume(room, checkpoints) {
    const panel = $('resume-run');
    const where = $('resume-where');
    const go = $('resume-continue');
    const again = $('resume-restart');
    if (!panel || !go || !again) return Promise.resolve(room);
    if (where) {
      where.textContent = room === CFG.dungeon.rooms - 1
        ? 'You left off at the throne.'
        : `You left off in room ${room + 1} of ${CFG.dungeon.rooms}.`;
    }
    panel.classList.remove('hidden');
    return new Promise((resolve) => {
      const done = (value) => {
        panel.classList.add('hidden');
        go.onclick = null;
        again.onclick = null;
        Audio.uiClick();
        resolve(value);
      };
      go.onclick = () => done(room);
      again.onclick = () => {
        // Starting over throws THIS mode's bookmark away immediately, so
        // quitting before the first room is cleared cannot resurrect it.
        // The other mode's run is left alone; it is a different run.
        this.economy.clearDungeonRun(checkpoints);
        done(0);
      };
    });
  }

  /**
   * Build and enter the open world.
   *
   * Same shape as the dungeon entry — its own scene, its own loop, solo and
   * offline — but a great deal more of it: the ground is streamed, the props
   * are streamed, and the boss fights build and drop themselves as you walk.
   *
   * Solo for the same reason the dungeon is. Every guardian is a hand-tuned
   * fight with a health bar and a telegraph, the quests read one save, and
   * the whole thing is built around walking away and coming back — none of
   * which survives a shared clock.
   */
  async _enterRealm(loading, bar, label, frame) {
    this.isRealm = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CFG.camera.fov, window.innerWidth / window.innerHeight,
      CFG.camera.near, 2600);
    this.effects = new Effects(this.scene, this.camera);

    const prof = this.profile;
    this.overworld = new Overworld({
      scene: this.scene,
      effects: this.effects,
      hud: this.hud,
      camera: this.camera,
      economy: this.economy,
      inventory: this.inventoryUI,
      color: prof.color,
      skins: this.equippedSkins,
    });

    const tasks = this.overworld.buildTasks();
    for (let i = 0; i < tasks.length; i++) {
      label.textContent = tasks[i][0] + '…';
      bar.style.width = ((i / tasks.length) * 94) + '%';
      await frame();
      tasks[i][1]();
    }

    this.world = { collision: this.overworld.collision, update: () => {} };
    this.followCam = new FollowCamera(this.camera, this.overworld.collision);
    this.overworld.followCam = this.followCam;

    /**
     * One atmosphere for the whole realm, retuned as you cross regions.
     *
     * Not one per region: the sky sphere, the sun and the cloud field are the
     * expensive parts and rebuilding them at a border would be a hitch every
     * time you walked into a new place. The Overworld damps the fog, the sky
     * colours and the sun toward whatever region you are standing in, so the
     * Emberwaste's red haze arrives over a couple of seconds of walking.
     */
    this.atmo = new Atmosphere(this.scene, this.renderer, {
      leafCount: this.quality.leaves,
      cloudCount: this.quality.clouds,
      shadows: this.quality.shadows,
      fogNear: 70, fogFar: 620,
    });
    this.overworld.atmo = this.atmo;
    this.renderer.setClearColor(0x79bfee);

    this.dummies = new DummyField(this.scene);
    this.kunaiSystem = new KunaiSystem(this.scene, this.overworld.collision,
      this.effects);
    this.kunaiSystem.resolveTarget = (id, out) => this._resolveAimTarget(id, out);
    this.pickups = null;

    bar.style.width = '100%';
    await frame();

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
    /**
     * Kunai are FINITE in the Croaklands.
     *
     * They used to be unlimited out here, which quietly made every fight in
     * the game a matter of standing at range and holding the button. Twenty
     * to start (see START_KUNAI), and every blade after those twenty is one
     * you found. `Overworld.start` sets the real count from the save.
     */
    this.player.inventory.setUnlimitedKunai(false);
    this.player.inventory.setAbilities(this.shop.equippedAbilities());
    // The guardians' wide attacks sweep thrown blades out of the air.
    this.overworld.kunai = this.kunaiSystem;

    this.hud.buildHotbar(this.player.inventory);
    this.hud.onSlotClick = (i) => {
      const slot = this.player.inventory.slots[i];
      if (slot && slot.item.ability) this.player._useAbility(slot.item.id);
      // Clicking the meal eats it, exactly as its key does.
      else if (slot && slot.item.consume) this.overworld.eatQuick();
      else if (this.player.inventory.select(i)) Audio.uiClick();
    };
    this.hud.resetOverlays();
    this.hud.show(true);
    this.hud.setRoom('', 'The Realm', false);

    /**
     * DID THIS FILE LIVE THROUGH THE OPENING?
     *
     * The flashbacks read `progress.prologue` and refuse to fire without it,
     * because a memory of a scene the player was never shown is not a reveal.
     * It is set from the SAVE FILE rather than from the blob so that the very
     * first entry after the prologue — where the blob is still null — already
     * knows, and it is written straight back into the blob by the save the
     * overworld does on start.
     */
    if (this.saves.active) {
      const a = this.saves.active;
      if (this.saves.sawPrologue(a.kind, a.index)) {
        this.overworld.progress.prologue = true;
      }
    }
    this.overworld.start(this.player);
    this.followCam.snapTo(this.player.pos);

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
    Audio.startAmbient();
    Audio.stopMenuMusic();
    this.hud.toast('TAB bag · M map · E reach out and talk', 8);
    this._resize();
  }

  // ═══════════════════════════════════════════════════════════ the prologue ══

  /**
   * THE OPENING: build heaven, put an army at each end of it, and start.
   *
   * Its own scene, like the dungeon and the realm, and it is thrown away
   * completely the moment the player hits the ground below — nothing from
   * this level is ever needed again until the final fight, which rebuilds it.
   */
  async _enterPrologue(loading, bar, label, frame) {
    this.isPrologue = true;
    /**
     * THERE IS NO WATER ON A FLOATING ISLAND.
     *
     * The swimming check reads `CFG.world.waterLevel` globally and the arena
     * leaves it at 2.2, which is ABOVE the heavenly battlefield's floor — so
     * the player spent the whole opening treading water in mid-air. Pushed
     * below the void and put back on the way out, exactly as the Croaklands
     * does with its own sea.
     */
    this._savedWater = CFG.world.waterLevel;
    CFG.world.waterLevel = VOID_Y - 100;
    this.scene = new THREE.Scene();
    // A very long far plane: the whole point of the level is that you can
    // see the mountains on the far side of the sky.
    this.camera = new THREE.PerspectiveCamera(
      CFG.camera.fov, window.innerWidth / window.innerHeight,
      CFG.camera.near, 5200);
    this.effects = new Effects(this.scene, this.camera);

    const level = new HeavenLevel(this.scene);
    const tasks = level.buildTasks();
    for (let i = 0; i < tasks.length; i++) {
      label.textContent = tasks[i][0] + '…';
      bar.style.width = ((i / tasks.length) * 94) + '%';
      await frame();
      tasks[i][1]();
    }
    this.heaven = level;
    this.world = { collision: level.collision, update: () => {} };
    this.followCam = new FollowCamera(this.camera, level.collision);

    /**
     * The light up here.
     *
     * Golden, low, and from behind the far army, so the player is looking
     * into the sun for the whole opening — which is what the reference is
     * doing and it is most of why it reads as holy rather than as bright.
     * The fog is pushed a very long way out; on a floating island the haze
     * IS the distance, and a near fog would hide the armies.
     */
    this.atmo = new Atmosphere(this.scene, this.renderer, {
      leafCount: 0,
      cloudCount: Math.min(14, this.quality.clouds),
      shadows: this.quality.shadows,
      fogNear: 260, fogFar: 2600,
      fogColor: 0xdfeaf6,
      skyTop: 0x6ea8dc, skyMid: 0xa8cfec, skyBottom: 0xf6e6c0,
    });
    /**
     * THE SUN GOES BEHIND HIS ARMY.
     *
     * Set on the light rather than passed as options, which is how the arena
     * does it — Atmosphere reads sky and fog from its options and nothing
     * else. Low and at +Z, so the player spends the whole opening looking
     * into it down the length of the field: that is most of why the
     * reference images read as holy rather than merely as bright.
     */
    if (this.atmo.sun) {
      this.atmo.sun.color.setHex(0xfff0c4);
      this.atmo.sun.intensity = 1.2;
      this.atmo.sun.position.set(-80, 190, 520);
      if (this.atmo.sun.target) this.atmo.sun.target.position.set(0, 0, 0);
    }
    if (this.atmo.hemi) {
      this.atmo.hemi.color.setHex(0xbfd8f0);
      this.atmo.hemi.intensity = 0.85;
    }
    this.renderer.setClearColor(0xdfeaf6);

    this.kunaiSystem = new KunaiSystem(this.scene, level.collision, this.effects);
    this.kunaiSystem.resolveTarget = (id, out) => this._resolveAimTarget(id, out);
    this.pickups = null;
    this.dummies = new DummyField(this.scene);

    bar.style.width = '100%';
    label.textContent = 'Drawing the legendary blade…';
    await frame();

    if (this.player) {
      this.scene.remove(this.player.model.root);
      this.player.model.dispose();
    }
    const prof = this.profile;
    this.player = new Player({
      id: 'local', name: prof.name, color: prof.color,
      world: this.world, effects: this.effects, scene: this.scene,
      kunai: this.kunaiSystem, pickups: null, skins: this.equippedSkins,
    });
    this.player.combatEnabled = true;
    this.hud.buildHotbar(this.player.inventory);
    this.hud.resetOverlays();
    this.hud.show(false);

    this.prologue = new Prologue({
      scene: this.scene, camera: this.camera, effects: this.effects,
      hud: this.hud, player: this.player, followCam: this.followCam,
      level, onDone: () => this._prologueDone(),
    });
    this.prologue.begin();

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
    Audio.stopMenuMusic();
    this._resize();
  }

  /**
   * One frame of the opening.
   *
   * Two halves. While the prologue `holdsPlayer` it owns the body and the
   * camera and this loop does nothing but let it; during the fight it is an
   * ordinary game loop with a boss in it, identical in every respect to the
   * dungeon's. That is the point — the fight has to be a real fight, so it
   * runs on the real fight code.
   */
  _updatePrologue(dt, t) {
    const p = this.player;
    const pro = this.prologue;
    if (this.frozen || !pro) { this.renderer.render(this.scene, this.camera); return; }

    // Slow motion lives here: everything downstream sees the scaled dt, so
    // the boss, the effects and the level all slow together.
    const sdt = dt * pro.timeScale;
    const held = pro.holdsPlayer;

    const targets = [];
    if (!held && pro.boss && pro.boss.alive && pro.boss.fighting) {
      const F = CFG.dungeon.frogath;
      targets.push({
        id: 'frogath', pos: pro.boss.pos, dead: false, isDummy: false,
        hitbox: {
          bodyOffset: 3.0, bodyRadius: 5.0,
          headOffset: 8.0, headRadius: 2.6,
          // He floats: without a tall vertical the katana's slice would never
          // reach him and the fight would be kunai-only.
          vertical: 14,
        },
        onHit: (dmg, o) => {
          const before = pro.boss.health;
          pro.boss.takeDamage(dmg, o || {});
          if (pro.boss.health < before) pro.noteHit(before - pro.boss.health);
          else pro.noteDeflect();
        },
      });
    }

    if (!held) {
      const look = this.input.takeLook();
      if (this.input.locked && !p.cinematic) this.followCam.look(look.dx, look.dy);
      p.update(sdt, this.input, this.followCam, targets);
      this._voidGuard(p, sdt, VOID_Y, HEAVEN.playerAt);
      this.kunaiSystem.update(sdt, targets);
      if (p.deathPending) p.deathPending = false;
      // The katana's hits are queued events; this is where they land.
      for (const ev of p.events) {
        if (ev.t === 'hit') {
          const before = pro.boss ? pro.boss.health : 0;
          if (pro.boss) pro.boss.takeDamage(ev.dmg, { head: ev.c === 2 });
          if (pro.boss && pro.boss.health < before) {
            pro.noteHit(before - pro.boss.health);
          }
          this.hud.hitmarker(ev.c === 2);
        }
      }
      p.events.length = 0;
    } else {
      // A cinematic still drains the queue, or a swing thrown on the last
      // frame of the fight lands during the conversation after it.
      p.events.length = 0;
      this.input.takeLook();
    }

    pro.update(sdt, this.input, (dmg, from) => this._prologueHit(dmg, from));
    /**
     * THE FALL CAN END INSIDE THAT CALL.
     *
     * `_updateFall` runs `onDone` on its last frame, which is `_prologueDone`
     * — and that throws the whole island away: the effects, the level, the
     * scene and the player all become null before this function has finished
     * running. Everything below here would then be called on nothing.
     *
     * This is not a hypothetical. It is exactly the crash the fall ended on:
     * "Cannot read properties of null (reading 'update')".
     */
    if (!this.isPrologue || !this.heaven || !this.effects) return;
    this.effects.update(sdt);
    this.heaven.update(sdt);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (!held && !p.cinematic) {
      this.followCam.update(p.renderPos, speed, sdt, {
        dashing: p.dashTimer > 0, grappling: p.grapple.attached,
        sprinting: p.sprinting,
      });
    }
    this.atmo.update(sdt, this.camera.position);
    if (!held) this._updateHud(sdt, speed);
    this._updateAudioListener();
    Audio.updateAmbient(sdt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Frogath hitting the player, during the opening fight. */
  _prologueHit(damage, from) {
    const p = this.player;
    if (!p || p.health.dead || p.health.protected || p.dashTimer > 0) return;
    if (p.parrying) {
      p.justParried = 0.2;
      p._parryTook();
      this.hud.toast('PARRIED', 0.5);
      Audio.parry(p.pos);
      this.followCam.shake(0.25);
      if (this.prologue) {
        Cine.say('frogath', 'Turned. Good.', { id: 'parried', secs: 2.6 });
      }
      return;
    }
    /**
     * THE ARMOUR, WHICH IS ABSURD ON PURPOSE.
     *
     * A blow from a god arrives at an eighth of its weight. See the note on
     * HERO_LOADOUT: the scene is about how strong this frog used to be, and
     * the shortest way to say that is to let them shrug him off.
     */
    const dealt = Math.max(1, Math.round(damage * HERO_LOADOUT.armour));
    p.health.damage(dealt, 'frogath');
    _v3.set(p.pos.x, p.pos.y + 1.2, p.pos.z);
    this.effects.damageNumber(_v3, dealt, false);
    this.hud.damageFlash(clamp(dealt / 60, 0.2, 0.6));
    this.followCam.shake(clamp(dealt / 40, 0.2, 0.7));
    Audio.hurt(p.pos);
    if (this.prologue) this.prologue.noteHurt();
    /**
     * DYING IN THE OPENING IS NOT AN ENDING — THE FIGHT STARTS OVER.
     *
     * The player is meant to win this one; the whole rest of the game is
     * built on their having won it. So going down restarts the whole
     * confrontation rather than ending anything: full health, and Frogath
     * put back to full health in phase one with his hazards cleared.
     *
     * Resetting HIM matters as much as reviving the player. Reviving alone
     * would drop somebody back in against a phase-four god on his last few
     * per cent, which is the hardest possible version of the fight handed
     * out as a punishment for losing the easiest one.
     */
    if (p.health.dead) {
      p.health.current = p.health.max;
      p.deathPending = false;
      p.spawn(HEAVEN.playerAt);
      p.pos.y = this.heaven.heightAt(HEAVEN.playerAt.x, HEAVEN.playerAt.z) + 0.4;
      // Facing him again — yaw zero would put their back to him. See the
      // note in Prologue.begin.
      p.visualYaw = Math.PI;
      this.followCam.yaw = Math.PI;
      this.followCam.snapTo(p.pos);
      if (this.prologue) this.prologue.restartFight();
      this.hud.announce('THE LINE HOLDS — GO AGAIN', 'good', false);
      Cine.say('frogath', 'Get up. We are not finished.',
        { id: 'again', secs: 3.6, priority: 2 });
    }
  }

  /**
   * The fall has landed. Throw heaven away and wake up in the Croaklands.
   *
   * `mode` has to come off 'playing' FIRST. `_enterGame` refuses outright
   * while a game is running — which is correct, it is what stops a second
   * click on Play from building a second world — and without this the fall
   * would end on a black screen with nothing loading and no way back.
   *
   * Everything here is synchronous up to `_enterGame`'s first await, and
   * this is called from inside the prologue's own update, so no frame can
   * run between dropping the island and the loading screen going up.
   */
  _prologueDone() {
    this.saves.markPrologueSeen();
    this.mode = 'menu';
    this.sessionMode = null;
    this._dropPrologue();
    this.pendingMode = 'realm';
    this._enterGame();
  }

  _dropPrologue() {
    // The arena's waterline, back the way we found it.
    if (this._savedWater !== null && this._savedWater !== undefined) {
      CFG.world.waterLevel = this._savedWater;
      this._savedWater = null;
    }
    this._clearUnderwater();
    if (this.prologue) this.prologue.dispose();
    this.prologue = null;
    if (this.heaven) this.heaven.dispose();
    this.heaven = null;
    if (this.player && this.scene) {
      this.scene.remove(this.player.model.root);
      this.player.model.dispose();
    }
    this.isPrologue = false;
    this.player = null;
    this.scene = null;
    this.world = null;
    this.atmo = null;
    this.effects = null;
    this.kunaiSystem = null;
    this.followCam = null;
    this.dummies = null;
    Cine.cancel();
    Audio.stopTheme();
    Audio.stopBossMusic();
  }

  /**
   * One frame of the open world.
   *
   * The panels — bag, log, map, dialogue — freeze the simulation rather than
   * running beside it. That is deliberate: they are read while standing in a
   * field with a guardian somewhere over the hill, and a mob that keeps
   * swinging at a player reading their inventory is a mob nobody can answer.
   */
  _updateRealm(dt, t) {
    const p = this.player;
    const ow = this.overworld;
    if (this.frozen) { this._renderRealm(); return; }

    // The panels have the keyboard while one is open, and the world holds
    // still behind them.
    if (ow.frozen) {
      ow.update(dt, p, this.input, () => {});
      this._renderRealm();
      return;
    }

    const look = this.input.takeLook();
    if (this.input.locked && !p.cinematic) this.followCam.look(look.dx, look.dy);

    const targets = ow.targets();
    p.update(dt, this.input, this.followCam, targets);
    this.kunaiSystem.update(dt, targets);
    if (p.deathPending) p.deathPending = false;

    // The katana reports hits as queued events because in the arena they have
    // to reach the victim's machine. Nothing out here is networked, so this is
    // where they land — and they have to be APPLIED here, not merely counted.
    // Showing the hitmarker and dropping `ev.dmg` on the floor is exactly why
    // the sword did no damage in the Croaklands while thrown kunai (which call
    // `target.onHit` directly) did. `combat.hitThisSwing` already guarantees
    // one event per target per swing, so this cannot double-hit.
    this._applyRealmHits(p, targets);

    ow.update(dt, p, this.input, (dmg, from) => this._realmHit(dmg, from));

    this.effects.update(dt);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (!p.cinematic) {
      this.followCam.update(p.renderPos, speed, dt, {
        dashing: p.dashTimer > 0, grappling: p.grapple.attached,
        sprinting: p.sprinting,
      });
    }
    this.atmo.update(dt, this.camera.position);
    this._updateHud(dt, speed);
    this._updateAudioListener();
    Audio.updateAmbient(dt);
    this._renderRealm();
  }

  /**
   * Drain the player's queued katana hits into the live targets they name.
   *
   * `targets` is the very array the swing was resolved against this frame, so
   * `ev.id` always has an owner unless that owner died mid-frame (a mob can be
   * killed by the first hit of a two-target swing). A dead target is skipped
   * rather than resurrected for one more blow.
   */
  _applyRealmHits(p, targets) {
    if (!p.events.length) return;
    for (const ev of p.events) {
      if (ev.t !== 'hit') continue;
      const t = targets.find((x) => x && x.id === ev.id);
      if (!t || t.dead || !t.onHit) continue;
      // 'melee' is what lets a guardian's guard tell a katana from a kunai.
      t.onHit(ev.dmg, ev.kx, ev.kz, false, t.pos, 'melee');
      this.hud.hitmarker(ev.c === 2);
    }
    p.events.length = 0;
  }

  /** The world, then the inventory's frog on top of it. */
  _renderRealm() {
    this.renderer.render(this.scene, this.camera);
    if (this.inventoryUI) this.inventoryUI.render();
  }

  /**
   * Something in the realm hit the player.
   *
   * Routed through `Progress.damageTaken` so armour actually does something,
   * and through the player's own parry so guarding works out here exactly as
   * it does in the dungeon.
   */
  _realmHit(damage, from) {
    const p = this.player;
    if (!p || p.health.dead || p.health.protected || p.dashTimer > 0) return;
    if (p.parrying) {
      p.justParried = 0.2;
      // The blow is turned; the guard comes down for `afterHit` seconds. The
      // toast says so, because a guard that silently stopped answering is the
      // most confusing thing a fight can do.
      p._parryTook();
      this.hud.toast('PARRIED', 0.5);
      Audio.parry(p.pos);
      this.followCam.shake(0.25);
      return;
    }
    const dealt = Math.round(this.overworld.progress.damageTaken(damage));
    p.health.damage(dealt, 'realm');
    _v3.set(p.pos.x, p.pos.y + 1.2, p.pos.z);
    this.effects.damageNumber(_v3, dealt, dealt > 40);
    this.hud.damageFlash(clamp(dealt / 60, 0.3, 1));
    this.followCam.shake(clamp(dealt / 40, 0.3, 1.1));
    Audio.hurt(p.pos);
    if (p.health.dead) this.hud.showRespawn(3.2, null);
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
      // The biggest single payout in the game, and it is paid once. He is
      // the hardest fight there is; beating him twice is a victory lap.
      this.economy.awardOnce('divine', CFG.economy.divineReward,
        'THE ASCENDED FALLS');
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

  /**
   * ═══ THE FIRST ISLAND ═══════════════════════════════════════════════════
   *
   * The tutorial. Same shape as the judgment arena's entry — its own scene,
   * its own box-built level, its own collision world — with two differences
   * that matter:
   *
   *   there is real water in view, so `CFG.world.waterLevel` is pushed far
   *   below the island and put back on the way out. The swimming check reads
   *   that global, and an island with a visible sea whose player is
   *   permanently mid-stroke is not the first impression to make.
   *
   *   combat is on and the kunai are NOT unlimited-but-free: the island
   *   hands over twelve, which is enough to learn the throw with and few
   *   enough that the lesson "these run out" arrives here rather than in the
   *   Croaklands.
   */
  async _enterTutorial(loading, bar, label, frame) {
    this.isTutorial = true;
    this._waterWas = CFG.world.waterLevel;
    CFG.world.waterLevel = TUTORIAL_WATER;
    this._clearUnderwater();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CFG.camera.fov, window.innerWidth / window.innerHeight,
      CFG.camera.near, CFG.camera.far);
    this.effects = new Effects(this.scene, this.camera);

    this.tutorial = new TutorialIsland({
      scene: this.scene, effects: this.effects, hud: this.hud,
      camera: this.camera, followCam: null,
      onDone: (why) => this._tutorialDone(why),
    });

    const tasks = this.tutorial.buildTasks();
    for (let i = 0; i < tasks.length; i++) {
      label.textContent = tasks[i][0] + '…';
      bar.style.width = ((i / tasks.length) * 94) + '%';
      await frame();
      tasks[i][1]();
    }

    this.world = { collision: this.tutorial.collision, update: () => {} };
    this.followCam = new FollowCamera(this.camera, this.tutorial.collision);
    this.tutorial.followCam = this.followCam;

    // A bright blue morning. The least moody sky in the project, on purpose:
    // it is the first thing anybody ever sees of this game.
    this.atmo = new Atmosphere(this.scene, this.renderer, {
      leafCount: 0, cloudCount: 26, shadows: this.quality.shadows,
      fogNear: 180, fogFar: 900, fogColor: 0xcfe9f5,
      skyTop: 0x2f8fd4, skyMid: 0x86c8ee, skyBottom: 0xe8f4ff,
    });
    this.atmo.sun.color.setHex(0xfff4e0);
    this.atmo.sun.intensity = 1.1;
    this.atmo.hemi.color.setHex(0xdff0ff);
    this.atmo.hemi.groundColor.setHex(0x6f8f4a);
    this.renderer.setClearColor(0x86c8ee);

    this.dummies = new DummyField(this.scene);
    this.kunaiSystem = new KunaiSystem(this.scene, this.tutorial.collision,
      this.effects);
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
    this.player.inventory.setAbilities(this.shop.equippedAbilities());
    /**
     * TWELVE KUNAI, not unlimited.
     *
     * The yard needs one throw and gives you eleven spare, which is enough
     * that missing does not matter and few enough that the number in the
     * corner going down teaches the thing the Croaklands is built on: blades
     * do not come back.
     */
    this.player.inventory.setUnlimitedKunai(false);
    if (this.player.inventory.setKunai) this.player.inventory.setKunai(12);

    this.hud.buildHotbar(this.player.inventory);
    this.hud.onSlotClick = (i) => {
      const slot = this.player.inventory.slots[i];
      if (slot && slot.item.ability) this.player._useAbility(slot.item.id);
      else if (this.player.inventory.select(i)) Audio.uiClick();
    };
    this.hud.resetOverlays();
    this.hud.show(true);
    this.hud.setRoom('', 'The First Island', false);

    this.tutorial.start(this.player);
    this.followCam.snapTo(this.player.pos);

    loading.classList.remove('show');
    this.mode = 'playing';
    this.input.flush();
    this.input.requestLock();
    Audio.stopMenuMusic();
    Audio.startAmbient();
    this.hud.setFade(0, 0.9);
    this._resize();
  }

  /**
   * ONE FRAME OF THE ISLAND.
   *
   * Deliberately the same shape as `_updateJudgment`: the player controller,
   * the kunai, the katana's queued hit events, the level, the camera. The
   * tutorial is not a special mode with its own physics — it is the real
   * game with a level that explains itself, which is the only way a tutorial
   * can teach anything true about what comes after it.
   */
  _updateTutorial(dt, t) {
    const p = this.player;
    const isle = this.tutorial;
    if (this.frozen || !isle) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const look = this.input.takeLook();
    if (this.input.locked && !p.cinematic) this.followCam.look(look.dx, look.dy);

    const targets = isle.targets([]);
    p.update(dt, this.input, this.followCam, targets);
    // Under the island entirely — a seam, or a very determined player.
    this._voidGuard(p, dt, isle.voidY, isle.spawnPoint);
    this.kunaiSystem.update(dt, targets);
    if (p.deathPending) p.deathPending = false;
    /**
     * ═══ THE KATANA'S HITS, APPLIED ══════════════════════════════════════
     *
     * The blade does NOT call a target's `onHit`. It queues a `hit` EVENT,
     * because in the arena a hit has to travel to the victim's client, and
     * whichever mode it happened in is what applies it — see `_applyHits`
     * in js/player.js, where `onHit` is only called directly for `isDummy`
     * targets. The dungeon resolves these with `damageBoss`, the open world
     * against its own mobs, and this is the island's.
     *
     * Getting this wrong once made every straw target and every mob on the
     * island completely immune to the sword. Thrown kunai still worked,
     * because a kunai calls `onHit` itself, which is precisely what made it
     * look like the sword was landing — the hit spark, the damage number
     * and the hitmarker all came up and nothing took any damage.
     */
    for (const ev of p.events) {
      if (ev.t !== 'hit') continue;
      isle.applyHit(ev.id, ev.dmg);
      this.hud.hitmarker(ev.c === 2);
    }
    p.events.length = 0;

    isle.update(dt, p, { skip: this.input.down('Backspace') });

    this.effects.update(dt);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (!p.cinematic) {
      this.followCam.update(p.renderPos, speed, dt, {
        dashing: p.dashTimer > 0, grappling: p.grapple.attached,
        sprinting: p.sprinting,
      });
    }
    this.atmo.update(dt, this.camera.position);
    this._updateHud(dt, speed);
    this._updateAudioListener();
    Audio.updateAmbient(dt);
    Cine.update(dt);
    this.renderer.render(this.scene, this.camera);
    void t;
  }

  /**
   * THE ISLAND IS OVER — finished or skipped, and it makes no difference.
   *
   * The flag is written either way. A player who skips the tutorial has
   * decided they do not need it, and asking them again next time they open
   * the game would be the game arguing with them.
   *
   * Then straight to the save files, because that is what the player came
   * for and the island was the thing in the way.
   */
  _tutorialDone(why) {
    if (this._tutorialEnding) return;
    this._tutorialEnding = true;
    this.settings.tutorialDone = true;
    this.saveSettings();
    if (why === 'finished') {
      this.economy.awardOnce('island', CFG.economy.islandReward, 'THE FIRST ISLAND');
      this.economy.save();
    }
    this.hud.setFade(1, 1.0);
    setTimeout(() => {
      this._tutorialEnding = false;
      this._leaveTutorial();
      this.hud.setFade(0, 0.6);
      this._showSaves();
      this.hud.toast(why === 'skipped'
        ? 'The island is on the main menu whenever you want it.'
        : 'Pick a file. The Croaklands are waiting.', 8);
    }, 1100);
  }

  /**
   * Tear the island down and go back to the menu.
   *
   * `mode` comes off 'playing' FIRST, exactly as `_dropPrologue` does — the
   * menu's own update loop refuses to run while a match is nominally live,
   * and the result is a permanent black screen.
   */
  _leaveTutorial() {
    // The sea goes back to wherever the rest of the game keeps it.
    if (this._waterWas !== undefined) {
      CFG.world.waterLevel = this._waterWas;
      this._waterWas = undefined;
    }
    this._clearUnderwater();
    if (this.tutorial) { this.tutorial.dispose(); this.tutorial = null; }
    /**
     * The atmosphere is the only one of these with a `dispose`.
     *
     * `Effects` and `KunaiSystem` do not have one, and the whole scene is
     * being thrown away anyway — the same reason `_dropPrologue` nulls them
     * rather than calling something. Reaching for a method that is not
     * there would throw on the way out of the island, which is the one
     * moment nobody would be able to recover from.
     */
    if (this.atmo && this.atmo.dispose) this.atmo.dispose();
    if (this.player && this.scene) {
      this.scene.remove(this.player.model.root);
      this.player.model.dispose();
    }
    this.isTutorial = false;
    this.player = null;
    this.scene = null;
    this.world = null;
    this.atmo = null;
    this.effects = null;
    this.kunaiSystem = null;
    this.followCam = null;
    this.dummies = null;
    this.mode = 'menu';
    this.sessionMode = null;
    this.hud.show(false);
    this.hud.resetOverlays();
    this.input.releaseLock();
    $('menu').classList.add('show');
    Cine.cancel();
    Audio.stopAmbient();
    Audio.startMenuMusic();
  }

  /** One frame of the judgment fight. */
  /**
   * The void.
   *
   * Levels that float in nothing — the dungeon, the judgment arena — cannot
   * be proven watertight seam by seam, and a player who slips through one
   * falls forever with no way back to the menu but a reload. So anything
   * below the floor is simply out of the world and dies there.
   *
   * Damage rather than an instant kill, so it reads as a fall and the normal
   * death/respawn flow runs. The one exception is invincibility: a god-mode
   * player cannot die, so they would fall forever — they get put back on
   * solid ground instead.
   */
  _voidGuard(p, dt, floorY, respawnTo) {
    if (!p || p.health.dead || p.pos.y > floorY) return false;
    if (p.health.protected) {
      if (respawnTo) {
        p.pos.copy(respawnTo);
        p.vel.set(0, 0, 0);
        this.followCam.snapTo(p.pos);
        this.hud.toast('Pulled back out of the void', 2.0);
      }
      return true;
    }
    p.health.damage(CFG.move.voidDamage * dt, null);
    // Falling is silent and featureless, so the HUD has to say what is
    // happening or it reads as the game having broken.
    this._voidToast = (this._voidToast || 0) - dt;
    if (this._voidToast <= 0) { this._voidToast = 1.2; this.hud.toast('The void', 1.0); }
    return true;
  }

  /**
   * Let a name show through foliage and water.
   *
   * Trees and ponds were working as invisibility: the nameplate depth-tests
   * against them like anything else, so a player standing inside a canopy or
   * sitting on the bottom of a pond had no tell at all. Both are meant to be
   * concealment you can still be spotted in, not a way to vanish.
   *
   * Only foliage and water qualify. The plate stays hidden behind solid
   * geometry, because seeing names through walls is a different game.
   *
   * Costs one raycast per remote, spread over several frames rather than
   * done for everyone at once.
   */
  _updateNameplateXRay(dt) {
    if (!this.remotes.size || !this.world || !this.world.collision) return;
    const ids = Array.from(this.remotes.keys());
    this._xrayCursor = ((this._xrayCursor || 0) + 1) % ids.length;
    const r = this.remotes.get(ids[this._xrayCursor]);
    if (!r || !r.model || !r.model.setNameplateXRay) return;

    // Under water is unambiguous and needs no ray.
    if (r.swimming) { r.model.setNameplateXRay(true); return; }

    const cam = this.camera.position;
    _v3c.set(r.pos.x, r.pos.y + 1.2, r.pos.z).sub(cam);
    const dist = _v3c.length();
    if (dist < 0.5 || dist > 140) { r.model.setNameplateXRay(false); return; }
    _v3c.multiplyScalar(1 / dist);
    const hit = this.world.collision.raycast(
      cam.x, cam.y, cam.z, _v3c.x, _v3c.y, _v3c.z, dist - 0.6);
    // Nothing in the way, or something solid: ordinary depth rules.
    r.model.setNameplateXRay(!!hit && hit.tag === 'tree');
  }

  _updateJudgment(dt, t) {
    const p = this.player;
    if (this.frozen) { this.renderer.render(this.scene, this.camera); return; }

    const look = this.input.takeLook();
    if (this.input.locked && !p.cinematic) this.followCam.look(look.dx, look.dy);

    const targets = [];
    const boss = this.judgment.bossTarget();
    if (boss) targets.push(boss);

    p.update(dt, this.input, this.followCam, targets);
    this._voidGuard(p, dt, this.judgment.voidY, this.judgment.spawnPoint);
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
      this.followCam.update(p.renderPos, speed, dt, {
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
    this._voidGuard(p, dt, this.dungeon.voidY, this.dungeon.spawnPoint);
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
      this.followCam.update(p.renderPos, speed, dt, {
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
    this.economy.awardOnce('frogath', CFG.economy.frogathReward, 'FROGATH DEFEATED');
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
    // the lockout after a turned blow applies here exactly as it does
    // everywhere else, rather than this path keeping its own softer copy.
    if (p.parrying) {
      p.justParried = 0.2;
      p._parryTook();
      this.hud.toast('PARRIED', 0.5);
      Audio.parry(p.pos);
      this.followCam.shake(0.25);
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

    // ---------------------------------------------------------- the story
    /**
     * THE OPENING, AND THE MEMORIES.
     *
     * The opening is two and a half minutes of boss fight and twenty seconds
     * of falling. Everything downstream of it — the amnesia, the flashbacks,
     * the way people talk to you — is only reachable through it, so testing
     * any of that without these buttons costs three minutes a go.
     */
    $('cheat-kill-frogath').onclick = () => {
      // The opening fight first, then the one at the end of the game.
      if (this.prologue && this.prologue.boss) {
        this.prologue.boss.takeDamage(1e9, {});
        this._cheatNote('Frogath down. The aftermath plays out from here.');
        this._toggleCheats(false);
        return;
      }
      const ow = this.overworld;
      if (ow && ow.frogath) {
        ow.frogath.takeDamage(1e9, {});
        this._cheatNote('Frogath down.');
        this._toggleCheats(false);
        return;
      }
      this._cheatNote('Nothing of his is standing in front of you.');
    };
    $('cheat-skip-open').onclick = () => {
      if (!this.prologue) return this._cheatNote('Only during the opening.');
      // Straight past the fight and the aftermath to the blow and the fall.
      if (this.prologue.boss) this.prologue.boss.health = 0;
      this.prologue._betray();
      this._cheatNote('Skipping to the fall.');
      this._toggleCheats(false);
    };
    $('cheat-skip-prologue').onclick = () => {
      if (this.prologue) {
        // Already in it: end it here and wake up in the Croaklands.
        this._cheatNote('Waking up in the Croaklands.');
        this._toggleCheats(false);
        this._prologueDone();
        return;
      }
      const a = this.saves.active;
      if (!a) return this._cheatNote('Open a save file first.');
      this.saves.markPrologueSeen();
      if (this.overworld) {
        this.overworld.progress.prologue = true;
        this.overworld.save();
      }
      this._cheatNote(`File ${a.index + 1} will skip the opening from now on.`);
    };
    $('cheat-replay-prologue').onclick = () => {
      const a = this.saves.active;
      if (!a) return this._cheatNote('Open a save file first.');
      const s = this.saves.slot(a.kind, a.index);
      if (s && s.meta) { s.meta.prologue = false; this.saves._write(); }
      if (this.overworld) {
        this.overworld.progress.prologue = false;
        this.overworld.save();
      }
      this._cheatNote(`File ${a.index + 1} will play the opening again on entry.`);
    };
    /**
     * ═══ THE FIRST ISLAND ═════════════════════════════════════════════════
     *
     * Three buttons. Play it, jump a station, and clear the first-run flag.
     */
    $('cheat-island').onclick = () => {
      this._toggleCheats(false);
      if (this.net.isOnline) this.net.disconnect();
      this.pendingMode = 'tutorial';
      this._enterGame();
    };
    /**
     * NEXT STATION.
     *
     * Runs the island's own `_advance`, so the door sinks, the objective
     * repaints and the next station's mobs spawn exactly as they would for
     * a player who had earned it — rather than teleporting past the state
     * machine and leaving half of it behind.
     */
    $('cheat-island-next').onclick = () => {
      const isle = this.tutorial;
      if (!isle) return this._cheatNote('Only on the First Island.');
      const s = isle.station;
      if (!s) return this._cheatNote('Every station is behind you already.');
      isle._advance(this.player);
      const next = isle.station;
      if (next) {
        // And stand the player on the new station, or they are still
        // seven hundred units west of the thing they wanted to look at.
        const p = this.player;
        p.pos.set(isle.at.x + next.checkpoint[0],
          isle.at.y + next.checkpoint[1] + 1.4,
          isle.at.z + next.checkpoint[2]);
        p.vel.set(0, 0, 0);
        p.health.revive();
        this.followCam.snapTo(p.pos);
      }
      this._cheatNote(next ? `On to ${next.title}.` : 'The gate is open.');
    };
    $('cheat-island-reset').onclick = () => {
      this.settings.tutorialDone = false;
      this.saveSettings();
      this._cheatNote('Forgotten. The next reload will open on the beach, '
        + 'exactly as a new player\'s would.');
    };

    $('cheat-memories').onclick = () => {
      const ow = this.overworld;
      if (!ow) return this._cheatNote('Only in the Croaklands.');
      ow.progress.prologue = true;
      for (const m of MEMORIES) ow.progress.memories.add(m.id);
      ow._paintObjectives();
      ow.save();
      this._cheatNote(`All ${MEMORIES.length} memories recovered. `
        + 'Everybody will recognise you now.');
    };
    $('cheat-forget').onclick = () => {
      const ow = this.overworld;
      if (!ow) return this._cheatNote('Only in the Croaklands.');
      ow.progress.memories.clear();
      ow._paintObjectives();
      ow.save();
      this._cheatNote('Memories cleared. The flashbacks will fire again.');
    };
    $('cheat-slay-all').onclick = () => {
      const ow = this.overworld;
      if (!ow) return this._cheatNote('Only in the Croaklands.');
      for (const g of GUARDIANS) ow.progress.slain.add(g.id);
      ow.sites.setFreed(ow.progress.slain);
      ow._paintObjectives();
      ow.save();
      this._cheatNote(`${GUARDIANS.length} guardians marked down. `
        + 'Every region is open and every village is rebuilding.');
    };
    $('cheat-endgame').onclick = () => {
      const ow = this.overworld;
      if (!ow) return this._cheatNote('Only in the Croaklands.');
      this._giveEndgameKit();
      ow.save();
      this._cheatNote(`Endgame kit equipped. Power ${ow.progress.power}.`);
    };

    /**
     * SKIP TO FROGATH — THE FINAL BOSS.
     *
     * The last fight in the game is gated on Zehl being down, which is
     * gated on every region north of the Lily Reach being open, which is
     * gated on thirty-odd guardians. Reaching it honestly is a full
     * playthrough, so this does the whole endgame in one press: every
     * guardian marked down, the best equipment in the game equipped, and
     * the player put on the dais with him about to build.
     *
     * It does NOT spawn him directly. The player is placed inside the
     * throne's trigger and `Overworld._encounters` builds him on the next
     * frame exactly as it would for a real player walking up — so this
     * tests the actual entry path, the actual gate, the actual boss bar and
     * the actual opening banter rather than a special case that only the
     * dev menu can reach.
     */
    $('cheat-final-frogath').onclick = () => {
      const ow = this.overworld;
      if (!ow) return this._cheatNote('Only in the Croaklands.');
      const e = ow.encounters.find((x) => x.id === 'frogath');
      if (!e) return this._cheatNote('There is no throne in this world.');
      const p = ow.progress;

      // Everything that gates the last fight. He is the one left standing.
      for (const g of GUARDIANS) p.slain.add(g.id);
      p.slain.delete('frogath');
      p.prologue = true;
      ow.sites.setFreed(p.slain);
      this._giveEndgameKit();

      // Drop whatever was live, so nothing is half-built on the dais.
      if (ow.boss) ow._dropBoss();
      if (ow.frogath) {
        ow.frogath.dispose();
        ow.frogath = null;
        ow.frogathOf = null;
      }
      ow._frogathTries = 0;
      ow._toldAboutZehl = true;
      if (ow.flash) ow.flash.cancel();
      Cine.clearBanter();
      Cine.cancel();

      /**
       * Standing just inside the ring, not on top of him.
       *
       * `e.r + 10` is the trigger, so a little inside that is where a
       * player would be when he wakes — and it leaves the whole arena in
       * front of them rather than behind.
       */
      const back = Math.min(e.r * 0.7, 22);
      const px = e.at.x;
      const pz = e.at.z - back;
      const p2 = this.player;
      p2.pos.set(px, ow.realm.heightAt(px, pz) + 1.5, pz);
      p2.vel.set(0, 0, 0);
      p2.health.current = p2.health.max;
      p2.visualYaw = Math.PI;                 // facing the throne
      // The region has to be re-evaluated, or the gate pushes them back out
      // of a region the save now says is open.
      ow.region = null;
      ow.lastOpen = { x: px, z: pz };
      ow.home = { x: px, y: p2.pos.y, z: pz };
      this.followCam.yaw = Math.PI;
      this.followCam.snapTo(p2.pos);
      ow._paintObjectives();
      ow.save();

      this._cheatNote(`${GUARDIANS.length} guardians down, power ${p.power}. `
        + 'Walk forward — he is waiting.');
      this._toggleCheats(false);
    };

    /**
     * THE OTHER END OF THE STORY, in one press.
     *
     * The coronation and the carpet walk are the last ninety seconds of the
     * game and they only ever fire once, off the end of Frogath's dying
     * words. Reaching them the honest way means beating the hardest fight in
     * the game — so this runs the actual `_coronate` path, with the actual
     * tableau, the actual script and the actual procession, rather than a
     * special case only this button can reach.
     *
     * It teleports to the arena first, because the walk needs the carpet and
     * the carpet is in the arena. `crowned` is cleared so the ceremony can be
     * watched more than once.
     */
    $('cheat-coronation').onclick = () => {
      const ow = this.overworld;
      if (!ow) return this._cheatNote('Only in the Croaklands.');
      if (!ow.throne) return this._cheatNote('There is no throne in this world.');
      const p = ow.progress;
      p.prologue = true;
      p.slain.add('frogath');
      // Cleared so the scene plays again on a second press.
      p.crowned = false;
      if (ow.walk) { ow.walk.cancel(); ow.walk = null; }
      if (ow.frogath) {
        ow.frogath.dispose();
        ow.frogath = null;
        ow.frogathOf = null;
        this.hud.hideBossBar();
      }
      if (ow.flash) ow.flash.cancel();
      Cine.clearBanter();
      Cine.cancel();
      // Standing on the mark, which is where `_beginCarpet` puts them anyway.
      const t = ow.throne;
      const pl = this.player;
      pl.pos.set(t.at.x, ow.realm.heightAt(t.at.x, t.at.z) + 1.5, t.at.z);
      pl.vel.set(0, 0, 0);
      pl.health.current = pl.health.max;
      ow.region = null;
      ow.lastOpen = { x: pl.pos.x, z: pl.pos.z };
      ow.home = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
      this.followCam.snapTo(pl.pos);
      this._toggleCheats(false);
      ow._coronate();
      this._cheatNote('The hall is full. Press E through it, then walk.');
    };

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
    // ---- froglets ----
    const amount = () => {
      const n = Math.round(Number($('cheat-amount').value) || 0);
      return clamp(n, 1, 9999999);
    };
    $('cheat-give-me').onclick = () => {
      const n = this.economy.grant(amount(), 'Developer menu');
      this._cheatRefresh();
      this._cheatNote(`+${n} froglets. You now have ${this.economy.froglets}.`);
    };
    $('cheat-give-all').onclick = () => {
      const n = amount();
      if (!this.net.isOnline || !this.remotes.size) {
        return this._cheatNote('Nobody else is here.');
      }
      // Sent to everyone at once; each client credits its own wallet, because
      // froglets live in that player's browser and nowhere else.
      this.net.sendEvent({ t: 'froglets', to: '*', n });
      this._cheatNote(`Sent ${n} froglets to ${this.remotes.size} player(s).`);
    };
    // ---- item picker ----
    $('cheat-kind').onchange = () => this._cheatItems();
    $('cheat-item-give').onclick = () => this._cheatGive(false);
    $('cheat-item-equip').onclick = () => this._cheatGive(true);
    $('cheat-item-cutscene').onclick = () => {
      const { kind, skin } = this._cheatPick();
      if (!skin) return this._cheatNote('Pick an item first.');
      // Closing the menu matters: the sequence takes over the screen, and
      // watching it through a developer panel is not watching it.
      this._toggleCheats(false);
      if (!this.shop.previewOpen(kind, skin)) {
        this._toggleCheats(true);
        return this._cheatNote('A case is already open.');
      }
      return null;
    };
    $('cheat-item-all').onclick = () => {
      let n = 0;
      for (const kind of ['frogs', 'swords', 'kunai']) {
        for (const s of CATALOG[kind]) if (this.economy.unlock(kind, s.id)) n++;
      }
      this.economy.save();
      this._cheatItems();
      this._cheatNote(`${n} newly unlocked. Everything is yours.`);
    };
    $('cheat-item-eclipse').onclick = () => {
      for (const [kind, id] of Object.entries(ECLIPSE_SET)) {
        this.economy.unlock(kind, id);
      }
      this.economy.save();
      this._cheatItems();
      this._cheatNote(`All three secrets granted — you are [${ECLIPSE_TITLE}]. `
        + 'Rejoin a room for other players to see it.');
    };
    /**
     * The counterpart, and the one that is actually hard to do by hand:
     * testing what a collection screen looks like EMPTY, and putting the
     * ??? back so the reveal can be watched a second time.
     */
    $('cheat-item-wipe').onclick = () => {
      for (const kind of ['frogs', 'swords', 'kunai']) this.economy.owned[kind] = [];
      this.economy.equipped.frog = DEFAULT_SKIN.frogs;
      this.economy.equipped.sword = DEFAULT_SKIN.swords;
      this.economy.equipped.kunai = DEFAULT_SKIN.kunai;
      this.economy.save();
      this.shop.refresh();
      this._applySkins();
      this._cheatItems();
      this._cheatNote('Collection cleared. Every secret is a ??? again.');
    };

    $('cheat-close').onclick = () => this._toggleCheats(false);
  }

  /**
   * THE ITEM PICKER — every skin of the chosen kind, in one dropdown.
   *
   * Secrets are listed by their REAL names here, unlike everywhere else in
   * the game. This is the developer menu: its whole job is to reach the
   * things the rest of the UI is deliberately hiding.
   */
  _cheatItems() {
    const sel = $('cheat-item');
    if (!sel) return;
    const kind = $('cheat-kind').value || 'frogs';
    const keep = sel.value;
    sel.innerHTML = '';
    for (const s of CATALOG[kind] || []) {
      const o = document.createElement('option');
      o.value = s.id;
      const tier = (RARITY[s.rarity] || {}).name || s.rarity;
      const mark = this.economy.owns(kind, s.id) ? '✓ ' : '';
      o.textContent = `${mark}${s.name} — ${tier.toUpperCase()}`
        + (s.secret ? ' ???' : '');
      sel.appendChild(o);
    }
    // Keep the selection across a refresh where it still exists, so granting
    // an item does not bounce the list back to the top.
    if (keep && sel.querySelector(`[value="${keep}"]`)) sel.value = keep;
  }

  /** What the two dropdowns currently name. */
  _cheatPick() {
    const kind = ($('cheat-kind') || {}).value || 'frogs';
    const id = ($('cheat-item') || {}).value || '';
    const skin = (CATALOG[kind] || []).find((s) => s.id === id) || null;
    return { kind, skin };
  }

  _cheatGive(equip) {
    const { kind, skin } = this._cheatPick();
    if (!skin) return this._cheatNote('Pick an item first.');
    const fresh = this.economy.unlock(kind, skin.id);
    if (equip) {
      const slot = kind === 'swords' ? 'sword' : (kind === 'frogs' ? 'frog' : 'kunai');
      this.economy.equipped[slot] = skin.id;
    }
    this.economy.save();
    this.shop.refresh();
    this._applySkins();
    this._cheatItems();
    return this._cheatNote(`${skin.name} ${fresh ? 'unlocked' : '(already owned)'}`
      + (equip ? ' and equipped.' : '.'));
  }

  /** Rebuild the per-player grant buttons. Called whenever the menu opens. */
  _cheatPlayers() {
    const host = $('cheat-players');
    if (!host) return;
    host.innerHTML = '';
    for (const [id, r] of this.remotes) {
      const b = document.createElement('button');
      b.className = 'cheat-btn';
      b.textContent = `GIVE → ${r.name}`;
      b.onclick = () => {
        const n = clamp(Math.round(Number($('cheat-amount').value) || 0), 1, 9999999);
        this.net.sendEvent({ t: 'froglets', to: id, n });
        this._cheatNote(`Sent ${n} froglets to ${r.name}.`);
      };
      host.appendChild(b);
    }
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

  /**
   * THE BEST OF EVERYTHING, EQUIPPED.
   *
   * Walked DOWN from tier five so a slot always ends up with the best thing
   * that exists for it, rather than with whatever the top tier happened to
   * include — there is no tier-five hat, and asking only tier five for one
   * would have left the player bare-headed in the last fight.
   *
   * Shared by the endgame-loadout button and the skip-to-Frogath button,
   * because "put me at the end of the game" and "give me the gear from the
   * end of the game" are the same operation twice.
   */
  _giveEndgameKit() {
    const ow = this.overworld;
    if (!ow) return null;
    const p = ow.progress;
    for (const slot of ['weapon', 'head', 'body', 'legs']) {
      let best = null;
      for (let t = 5; t >= 0 && !best; t--) {
        const list = gearOfTier(t).filter((g) => g.slot === slot);
        if (list.length) best = list[list.length - 1];
      }
      if (!best) continue;
      p.add(best.id, 1);
      if (!p.isEquipped(best.id)) p.equip(best.id);
    }
    p.hearts = 10;
    p.level = Math.max(p.level, 14);
    p.kunai = 60;
    ow.applyStats();
    if (this.player) this.player.inventory.setKunai(p.kunai);
    return p.power;
  }

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
   *     F3 + J + L      the original
   *     L + J + M + 3   the second — either three, main row or keypad
   *
   * Neither uses a modifier, so neither can be stolen by a browser shortcut —
   * which the Ctrl-based version it replaced could be, since Chrome keeps
   * Ctrl+L for the address bar and will not let a page have it.
   *
   * Only which keys are HELD matters, never the order they arrived in.
   *
   * AND, as a fallback, J then L then M then 3 pressed IN SEQUENCE within a
   * second and a half. Cheap keyboards — school machines in particular — have
   * a two- or three-key rollover limit and physically never report a fourth
   * key held at the same time, so on those the held chord can never complete
   * however it is written. Typing it out works on anything.
   */
  _updateCheatChord() {
    const k = (code) => this.input.down(code);
    const three = ['Digit3', 'Numpad3'];
    const held = (k('F3') && k('KeyJ') && k('KeyL'))
      || (k('KeyL') && k('KeyJ') && k('KeyM') && this.input.downAny(three));
    /**
     * Taken UNCONDITIONALLY, and that is the point.
     *
     * `takeChord` clears the flag whether or not it is acted on, so a chord
     * that completes on the same frame the held version fires is thrown
     * away rather than toggling the panel straight back shut.
     *
     * The typed chord now lives in js/input.js, which SWALLOWS the keys as
     * they go past — so typing it no longer also opens the map and selects
     * hotbar slot three on the way.
     */
    const typed = this.input.takeChord();
    if (held && !this._chordHeld) this._toggleCheats(!this.cheatsOpen);
    else if (!held && typed) this._toggleCheats(!this.cheatsOpen);
    this._chordHeld = held;
  }

  _toggleCheats(open) {
    if (open === this.cheatsOpen) return;
    this.cheatsOpen = open;
    if (open) {
      this._cheatPlayers();              // who is here can change between opens
      this._cheatItems();                // and what is owned changes too
    }
    $('cheats').classList.toggle('show', open);
    this._cheatRefresh();
    if (open) {
      /**
       * ═══ AND IT TAKES THE SCREEN FROM THE WORLD'S OWN PANELS ═══════════
       *
       * The map and the bag are closed on the way in, because while this is
       * open the game is frozen — `_updateRealm` returns before the
       * overworld updates at all — and the overworld is the only thing that
       * reads their close keys. A map left up sat on top of the developer
       * panel and no key on the keyboard could shift it.
       *
       * The chord swallowing its own `M` (see js/input.js) stops the map
       * being opened by the chord in the first place. This is the other
       * half: a map the player opened deliberately, a moment before, must
       * not become a thing they are stuck behind either.
       */
      const ow = this.overworld;
      if (ow) {
        if (ow.journal && ow.journal.closeAll) ow.journal.closeAll();
        if (ow.inventory && ow.inventory.isOpen) ow.inventory.close();
      }
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
    const voting = this.round && this.round.phase === PHASE.VOTING;
    // The practice ring's try-out panel and the dev menu also release the
    // mouse on purpose, and neither should drop the pause screen on top.
    // Nor should the realm's own panels — the bag is meant to be clicked.
    const panel = !!(this.overworld && this.overworld.frozen);
    if (this.mode === 'playing' && !locked && !voting && !panel
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
    // Pausing is a natural place to lose a session — the player walks away
    // from the machine, or closes the tab from the pause screen — so the
    // open world commits whatever it is holding before the world stops.
    if (this.overworld) this.overworld.save();
    $('pause').classList.add('show');
    $('pause-room').textContent = this.isRealm
      ? (this.overworld && this.overworld.region
        ? `The Realm — ${this.overworld.region.name}`
        : 'The Realm')
      : this.isDungeon
      ? (this.dungeon && this.dungeon.checkpoints
        ? 'The Dungeon — checkpoints on'
        : 'The Dungeon — no checkpoints')
      : (this.net.isOnline
        ? `Room code: ${this.net.room}`
        : 'Offline solo practice — no froglets earned');
    // The build, here too: mid-match is exactly when you want to know whether
    // you and the person you are playing with are running the same game.
    $('pause-room').textContent += `  ·  ${BUILD}`;
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
    // Dry off first, and for EVERY mode. This used to be done inside the
    // three branches below, so quitting an ordinary arena match while
    // swimming left the whole game tinted blue.
    this._clearUnderwater();
    // The played time on the open file, and then the file is closed.
    this.saves.flush();
    // The opening owns heaven, and quitting out of it abandons the scene
    // rather than finishing the fall — so the file has NOT seen the prologue
    // and will play it again next time, which is the right answer.
    if (this.isPrologue) {
      this._dropPrologue();
      this.saves.deselect();
    }
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
    }
    // The realm is three thousand units of streamed ground plus every camp,
    // village and guardian in it. All of it goes, and the save is written on
    // the way out by `Overworld.dispose`.
    if (this.isRealm) {
      if (this.overworld) this.overworld.dispose();
      this.overworld = null;
      this.isRealm = false;
      this.world = null;
      this.scene = null;
      this.atmo = null;
      this.player = null;
      this.pickups = null;
      this.kunaiSystem = null;
      this.effects = null;
      this.followCam = null;
      this.saves.deselect();
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

    /**
     * THE CHAT MUST NEVER LEAVE THE INPUT SUSPENDED.
     *
     * While it is open the game reads no keys and no mouse, which is exactly
     * right — and catastrophic if it ever outlives the chat. Any path that
     * hides the chat without closing it properly, now or later, would leave a
     * game that ignores every key with nothing on screen to explain why, and
     * no key that could fix it.
     *
     * So rather than trusting every exit to remember, the loop checks. It
     * costs one comparison a frame and it makes the whole class of bug
     * self-correcting.
     */
    if (this.chat && this.input.suspended && !this.chat.open) {
      this.input.suspend(false);
    }
    // And it shuts itself the moment anything else takes the screen — the
    // same condition that governs opening it, so the two cannot disagree.
    if (this.chat && this.chat.open
      && !(this.mode === 'playing' && this.input.locked)) {
      this.chat.forceClose();
    }

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
      // no game mode can forget to do it.
      this._flushPendingJoins();

      // Each mode is its own loop; they share the renderer and nothing else.
      if (this.isPrologue) this._updatePrologue(dt, t);
      else if (this.isTutorial) this._updateTutorial(dt, t);
      else if (this.isJudgment) this._updateJudgment(dt, t);
      else if (this.isRealm) this._updateRealm(dt, t);
      else if (this.isDungeon) this._updateDungeon(dt, t);
      else this._updateGame(dt, t);

      /**
       * Playtime, on the open save file.
       *
       * Counted for the Croaklands and its opening only — the arena, the
       * dungeon and the judgment are not part of anybody's adventure, and
       * counting them would make a save file's hours a lie.
       */
      if (this.saves.active && (this.isRealm || this.isPrologue)) {
        this._playAccum = (this._playAccum || 0) + dt;
        if (this._playAccum >= 1) {
          this.saves.tick(this._playAccum);
          this._playAccum = 0;
        }
      }
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
    const voting = this.round && this.round.phase === PHASE.VOTING;
    const panel = !!(this.overworld && this.overworld.frozen);
    const want = this.mode === 'playing' && !this.input.locked
      && !voting && !panel && !this._tryPanelOpen && !this.cheatsOpen;
    if (want === this._ctpShown) return;
    this._ctpShown = want;
    $('click-to-play').classList.toggle('show', want);
  }

  _updateMenu(dt) {
    this.menuScene.update(dt);
    this.renderer.render(this.menuScene.scene, this.menuScene.camera);
  }

  /**
   * The stone frog in the arena.
   *
   * Scenery, unless you are carrying the crystal — then it is the only way
   * to the Ascended. The prompt is driven off the same proximity test the
   * sacrifice uses, so it can never say you can and then do nothing.
   */
  /**
   * @see _updateStatue — the crystal is spent once; the door stays open.
   */
  _updateStatue(p) {
    const s = this.world && this.world.statue;
    if (!s) return;
    const near = p.pos.distanceTo(s.stand) < 5.0;
    /**
     * The stone answers to a crystal, or to having already had one.
     *
     * `statueOpened` is set by the first sacrifice and saved, so the way to
     * the Ascended is a door you open once rather than a toll you pay every
     * time. Without it, beating him meant another clean run of the dungeon
     * for another crystal, which is a re-run of content you have finished.
     */
    const opened = this.economy.statueOpened;
    const armed = near && (this.economy.crystal || opened);
    this._statuePrompt = armed;
    if (armed) {
      this.hud.setPickupPrompt(true,
        this.economy.crystal ? 'Sacrifice the crystal' : 'Wake the stone');
    }

    if (!p.interactPressed) return;
    p.interactPressed = false;
    if (!near) return;
    if (!this.economy.crystal && !opened) {
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
    // The crystal is consumed; what it bought is not. Both are saved here,
    // so closing the game between the sacrifice and the fight costs nothing.
    this.economy.crystal = false;
    this.economy.statueOpened = true;
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
      && !this.net.isOnline && !this.isDungeon;
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

  _updateGame(dt, t) {
    const paused = this.frozen;
    const p = this.player;

    // The round clock runs OUTSIDE the pause check on purpose. Pausing used
    // to freeze it locally, so whoever paused came back with extra time on
    // the board while everyone else had been playing.
    if (this.round) this.round.update(dt, this._playerIds());

    /**
     * ═══ A PAUSED PLAYER IS STILL IN THE MATCH ═══════════════════════════
     *
     * Pausing stops your CONTROL, not your presence. Everything in here used
     * to sit inside the `if (!paused)` block below, and the combined effect
     * was that pausing turned you into an immortal statue:
     *
     *   - the protection timers froze, so pausing within two seconds of a
     *     respawn (or inside a dash's i-frames) left `health.protected` true
     *     and turned every incoming hit away outright;
     *   - `tickState` stopped, so even the hits that DID land were invisible
     *     to everyone else — the damage came off your own health and was
     *     never broadcast, so the bar over your frog never moved on their
     *     screens;
     *   - the event queue stopped draining, so your own death never left
     *     your machine;
     *   - and `deathPending` was never consumed, so you did not actually die
     *     until you unpaused.
     *
     * From the outside all four read as one thing: hitting a paused player
     * does nothing. Which is how it was reported, and it is not a pause, it
     * is invulnerability with a menu over it.
     *
     * What still does NOT happen while paused: movement, aiming, attacking,
     * abilities, the camera. Those are the things pausing is for.
     */
    if (paused && p) {
      if (p.health) p.health.tickProtection(dt);
      // A death that arrived between frames resolves now, rather than being
      // held back until the pause menu closes.
      if (p.deathPending) {
        p.deathPending = false;
        this._onLocalDeath();
      }
      /**
       * Knockback taken while paused is DROPPED, not banked.
       *
       * `receiveHit` adds to the velocity and nothing integrates it while
       * the world is stopped, so without this a player who took a few hits
       * behind the pause menu was fired across the map on resuming.
       */
      p.vel.set(0, 0, 0);
      // The queue carries the death out to the room, along with anything a
      // swing left in it on the frame the pause landed.
      this._drainEvents(p);
      // And the room keeps hearing where they are and how they are doing.
      this.net.tickState(dt, () => p.netState());
    }

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
      // The arena has real terrain everywhere, so this should never fire —
      // it is here so that a hole nobody has found yet costs a life instead
      // of the whole session. Measured against the ground under you rather
      // than a fixed height, because the map has real valleys.
      if (this.world && this.world.collision && this.world.collision.terrain) {
        const gy = this.world.collision.terrain.heightAt(p.pos.x, p.pos.z);
        this._voidGuard(p, dt, gy - CFG.move.voidDepth, null);
      }
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
            p.spawn(this._safeSpawn());
            this._refillArenaKunai();
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
      this._updateNameplateXRay(dt);
      this._updateLocalClone(dt);

      this.world.update(dt, this.camera.position);

      const speed = Math.hypot(p.vel.x, p.vel.z);
      this.followCam.update(p.renderPos, speed, dt, {
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

    // Endless kunai for taggers, the juggernaut, anyone spectating — and in
    // solo practice, where running out of ammo just means walking to a crate
    // instead of practising the throw.
    p.inventory.setUnlimitedKunai(
      R.practice || (R.isTagMode && isIt) || jug || spec);
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
    // You always see yourself — at the friendly fade, never gone.
    if (hunterId === preyId) return false;

    const R = this.round;
    // No round in progress: practice, warm-up, the lull between rounds. There
    // are no sides, so everyone present is an opponent. Returning false here
    // meant invisibility did nothing at all outside a live round, which is
    // exactly where people first try the ability out.
    if (!R || !R.playing) return true;

    if (R.isTagMode) {
      // Only the hunted benefit — a tagger going invisible would be unfair
      // and, on their own screen, pointless.
      return R.isTagger(hunterId) && !R.isTagger(preyId);
    }
    if (R.isTeamMode) return !R.areAllies(hunterId, preyId);

    // FFA (and juggernaut): everyone hunts everyone. This used to return
    // false, with a comment saying "everyone hunts everyone, so nobody is
    // special" — which had the consequence backwards. Nobody counted as a
    // hunter, so an invisible frog was only ever faded to the friendly 30%
    // and stayed plainly visible to the entire lobby.
    return true;
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

    // Offline solo has nothing to vote on and nobody to vote with, so it
    // skips the mode screen and drops you straight into the map on ffa
    // rules. Being made to pick a game mode before you can practise alone
    // was pure ceremony.
    const practice = !this.net.isOnline;
    if (practice && !this.round.practice) this.round.enterPractice();
    else if (!practice && this.round.practice) this.round.leavePractice();

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

    // Practice has no vote, no countdown and no round banner — just the map.
    if (this.round && this.round.practice) {
      this.hud.showVote(false);
      this.hud.hideRound();
      this.hud.clearAnnounce();
      return;
    }

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
      this.player.spawn(this._safeSpawn());
      // And a fresh pouch, so nobody starts a round with the empty one they
      // finished the last one on. See `_refillArenaKunai`.
      this._refillArenaKunai();
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
      // Winning a free-for-all is beating everybody at once with nobody
      // helping, so it pays more than carrying a team to a win.
      if (this.player.kills >= best && best > 0) {
        this.economy.award(E.ffaWinReward, 'Round won');
      }
      return;
    }

    if (R.outcome === 'taggers') {
      if (wasIt) this.economy.award(E.taggerWinReward, 'Won as tagger');
      if (startedIt) this.economy.award(E.infectorStartWinReward, 'Starting infector');
    } else if (R.outcome === 'survivors') {
      if (!wasIt) this.economy.award(E.survivorReward, 'Survived');
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
   * ═══ A FRESH HANDFUL OF BLADES ON EVERY RESPAWN ═════════════════════════
   *
   * Ten of them — `CFG.kunai.startCount`, the same number a match begins
   * with — so coming back is a fresh start rather than a continuation of
   * however the last life ended.
   *
   * IN THE ARENA MODES ONLY, and that distinction is the whole of it. This
   * is called from `_updateGame` and `_onRoundPhase`, both of which only
   * run for a round of tag, free-for-all, team or juggernaut. Blades in the
   * Croaklands are a RESOURCE: bought with froglets, kept in the save, and
   * the story's difficulty is built on the fact that they do not come back
   * — see `giveKunai` in js/overworld.js, and the note on the tutorial
   * island's twelve. Refilling them on death there would undo all of it.
   *
   * In a round they are ammunition, and the difference matters. Coming back
   * with an empty pouch means being hunted with a sword and no answer at
   * all to somebody standing on a roof, and the crates scattered on a map
   * are not a quick enough remedy — you die, you come back with nothing,
   * and the only move available is to go looking for a box while somebody
   * chases you.
   *
   * A tagger is left alone: `unlimitedKunai` means the count is not what is
   * feeding their throws, and setting it would be writing to a number
   * nothing reads.
   */
  _refillArenaKunai() {
    const inv = this.player && this.player.inventory;
    if (!inv || !inv.setKunai || inv.unlimitedKunai) return;
    inv.setKunai(CFG.kunai.startCount);
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
  /**
   * A spawn position that is not on top of whoever is hunting you.
   *
   * Tag, Infection and Juggernaut all have a side that chases and a side that
   * runs, and a runner dropped inside a chaser's reach is tagged before the
   * respawn text has faded. FFA and Team have no chaser — everyone is equally
   * dangerous to everyone — so nothing is avoided there and the spawn stays
   * uniformly random, which is what those modes want.
   *
   * Only the people it can SEE are avoided: remotes that have spawned, are
   * alive, and are not spectating. That covers the case this exists for — the
   * mid-round respawn, with the tagger standing where they tagged you. At the
   * start of a round everyone respawns in the same instant, so the chasers'
   * positions are still last round's and there is nothing better to go on;
   * the rule is honest about that rather than pretending otherwise.
   */
  _safeSpawn() {
    const R = this.round;
    const hunted = R && (R.isTagMode ? !R.isTagger(this.player.id)
      : R.isJuggernautMode ? !R.isJuggernaut(this.player.id) : false);
    if (!hunted) return this.world.randomSpawn();

    const avoid = [];
    for (const r of this.remotes.values()) {
      if (!r.spawned || r.dead || r.spectating) continue;
      if (R.isSpectating(r.id)) continue;
      const chaser = R.isTagMode ? R.isTagger(r.id) : R.isJuggernaut(r.id);
      if (chaser) avoid.push(r.pos);
    }
    return this.world.randomSpawn(avoid, CFG.rounds.spawnSafeDist);
  }

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
    /**
     * The realm's targets are whatever is near enough to be live.
     *
     * Asked by ID rather than handed the object, because a kunai in flight
     * outlives its target: the mob it was thrown at can die, and its camp can
     * despawn, between the throw and the landing. Not finding the id is the
     * answer — the kunai stops curving and flies straight.
     */
    if (this.overworld) {
      for (const t of this.overworld.targets()) {
        if (t.id !== id) continue;
        out.set(t.pos.x, t.pos.y + t.hitbox.bodyOffset, t.pos.z);
        return true;
      }
      return false;
    }
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
    if (this.atmo) this.atmo.setUnderwater(v);
    // Clear colour shows through wherever nothing is drawn.
    this.renderer.setClearColor(v ? 0x0a6ec4 : 0x8ec9e8);
    $('underwater').classList.toggle('show', v);
    Audio.setUnderwater(v);
  }

  /**
   * Force the above-water presentation back, whatever the flag currently says.
   *
   * The underwater look is spread across four places — the scene fog, the
   * renderer's clear colour, a full-screen tint in the DOM and a filter on the
   * audio — and only the FOG belongs to the level. Leaving a level used to
   * clear the flag by assigning it directly, which put the flag and the screen
   * out of step: the tint and the audio filter stayed on, and _setUnderwater's
   * early-out then saw the flag already false and refused to take them off.
   * That is why the blue stuck until you found some water to swim through.
   *
   * So this sets all four unconditionally rather than going through the
   * early-out, and it runs on the way INTO a level as well as out — whatever
   * state the last one left behind, the next one starts dry.
   */
  _clearUnderwater() {
    this._underwater = false;
    if (this.atmo) this.atmo.setUnderwater(false);
    this.renderer.setClearColor(0x8ec9e8);
    $('underwater').classList.remove('show');
    Audio.setUnderwater(false);
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
    // The statue's prompt takes precedence when it is up, or the two would
    // fight over the same element every frame. The realm owns the prompt
    // outright — it is how you talk to people and examine places, and there
    // are no supply crates out there to compete for it.
    if (!this.isRealm && !this._statuePrompt) {
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

    // ---- round HUD (arena only; every other mode has its own) ----
    const R = this.round;
    if (!R) {
      this.hud.update(dt);
      if (this._comboReset > 0) {
        this._comboReset -= dt;
        if (this._comboReset <= 0) this._comboCount = 0;
      }
      return;
    }
    if (R.practice) {
      // No banner: there is no mode to name and no clock to count down.
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
