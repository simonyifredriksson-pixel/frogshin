/**
 * THE OPEN WORLD — one controller over the realm, its monsters and its people.
 *
 * Everything below is glue, and deliberately so. The pieces already exist and
 * each owns exactly one thing:
 *
 *   realm.js        the ground, streamed in tiles, and one height function
 *   scatter.js      the trees, rocks and reeds, streamed per tile
 *   realmsites.js   villages, shrines, ruins, arenas — built once, baked once
 *   mobs.js         camps of small things
 *   dungeonboss.js  the guardian fight, reused unchanged
 *   frogath.js      the last one, reused unchanged
 *   realmquests.js  the people, the dialogue box, the log and the map
 *   progression.js  what the player has and has become
 *
 * This file decides WHEN each of them happens, and that is all it decides.
 *
 * ── how an encounter works ────────────────────────────────────────────────
 * Every guardian in the region table becomes an `encounter`: a placed arena
 * and no boss. Walk within 260 units and the boss is built; walk into the ring
 * of stones and it wakes up; walk 340 units away and it is thrown away again.
 *
 * That last part is the important one. Leaving means the fight RESETS — full
 * health, back at its stone, as if you had never been. An open-world boss you
 * can whittle down over six visits is not a boss, and one that chases you
 * across a region is not an encounter, it is a pest.
 *
 * ── what is saved, and when ───────────────────────────────────────────────
 * `Progress` is the whole save and it is written at every moment the player
 * would mind losing: a guardian down, a camp cleared, a secret found, a quest
 * accepted or handed in, a region entered, and on the way out to the menu. It
 * is one blob in `Economy`, so there is no way for half of it to survive.
 */

import * as THREE from '../lib/three.module.js?v=v105';
import { CFG } from './config.js?v=v105';
import { clamp, damp, dampAngle, lookYaw, mulberry32 } from './util.js?v=v105';
import { coronationScript, CarpetWalk, CORONATION_THEME }
  from './coronation.js?v=v105';
import { Realm } from './realm.js?v=v105';
import { Scatter } from './scatter.js?v=v105';
import { Traversals } from './traverse.js?v=v105';
import { Sites } from './realmsites.js?v=v105';
import { Camp } from './mobs.js?v=v105';
import { DungeonBoss } from './dungeonboss.js?v=v105';
import { Frogath, FROGATH_THRONE_SPEECH } from './frogath.js?v=v105';
import { GUARDIAN_BY_ID } from './guardians.js?v=v105';
import { REGIONS, REGION_BY_ID, SEA, regionAt, regionOpen,
  CONTENT_HALF } from './regions.js?v=v105';
import { Progress, HEART, BASE, MAX_KUNAI } from './progression.js?v=v105';
import { GEAR_BY_ID, rollLoot } from './gear.js?v=v105';
import { QUEST_BY_ID, SECRETS, npcSays, questProgress, shutBecause,
  mainObjective } from './quests.js?v=v105';
import { People, Life, Dialogue, Journal, grantReward, TALK_RANGE,
  disposeVillagerMats } from './realmquests.js?v=v105';
import { disposeLandmarkMats } from './landmarks.js?v=v105';
import { Props, disposePropMats } from './props.js?v=v105';
import { TRADES, tradeFor, stockOf } from './stalls.js?v=v105';
import { feelOf, lookOf } from './weapons.js?v=v105';
import { StallScreen } from './stallui.js?v=v105';
import { LORE_BY_ID, LORE_BY_SITE, LORE_COUNT, loreRead } from './lore.js?v=v105';
import { Ambience } from './ambience.js?v=v105';
import { Weather } from './weather.js?v=v105';
import { Audio } from './audio.js?v=v105';
import { regionTheme, settlementTheme, bossTheme } from './themes.js?v=v105';
import { Flashbacks, memoryStage, memoriesFound,
  MEMORY_COUNT } from './flashbacks.js?v=v105';
import { Cine } from './cinema.js?v=v105';
import { recommendedFor, readiness } from './guardians.js?v=v105';
import { Wakewood, WOOD_R } from './wakewood.js?v=v105';
import { ThroneArena } from './throne.js?v=v105';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const _scratch = [];
/** Scratch colour for the sky blend, so it allocates nothing per frame. */
const _fogTarget = new THREE.Color();

/** Encounter distances, in world units. See the file header. */
const BUILD_AT = 260;
const DROP_AT = 340;
/**
 * Camps come and go closer in — there are more of them and they are smaller.
 *
 * Two hundred and fifty rather than three hundred. A camp is the single most
 * expensive thing in the world to draw: five or six creatures at forty meshes
 * each, which is more than the village they are camped outside. The early
 * regions now hold three or four camps apiece rather than one or two, and at
 * three hundred units three of the Lilyreach's were live at once from the
 * middle of Croakhollow — measured at fifteen hundred draw calls.
 *
 * At two hundred and fifty they are still an encounter you walk up to and
 * still visible well before they can reach you (a mob's leash is ninety
 * units), and never more than two are live from anywhere.
 */
const CAMP_BUILD = 250;
const CAMP_DROP = 340;

/**
 * How a region's tier becomes a guardian's power on the dungeon stat curve.
 *
 * The curve was written for fourteen rooms in order, index 0 to 13. Out here
 * there is no order — you can walk into the Frostmarch at level three if you
 * are determined — so the region's own tier decides, and the guardians within
 * one region step up slightly in the order they are listed. Tier 5 lands
 * around index 12, which is where the dungeon's hardest guardians sit.
 */
function powerFor(tier, indexInRegion) {
  return tier * 2.4 + indexInRegion * 0.7;
}

/**
 * THE OTHER HALF OF THE OPENING.
 *
 * The player fought this exact frog in the first two minutes of the game and
 * then forgot it. Everything here is written to be the SECOND half of that
 * conversation: he refers to things the opening said, in the same order, and
 * by the last phase he is saying the lines he said when he lost the first
 * time. A player who has recovered their memories will recognise every one
 * of them; a player who has not is about to.
 *
 * `mem` is the version for somebody who remembers. Both are kept because the
 * game genuinely allows the player to reach the throne having found almost
 * nothing, and "you finally remembered" said to a player who has not is the
 * one thing that would break the whole arc.
 */
/**
 * THE NUMBERS FOR THE LAST FIGHT. See `_maybeFrogath` for why they exist.
 *
 * Exported so a test can assert the two dials point the OPPOSITE way from
 * the prologue's — that is the one property of this table that matters and
 * the one a well-meant tweak is most likely to invert.
 */
export const FROGATH_FINAL_TUNING = { health: 11800, rest: 0.58, warn: 0.80 };

const FROGATH_FINAL = {
  open: {
    cold: ['You came a very long way to be confused.',
      'Do you even know what you are angry about?'],
    mem: ['There it is. That is the face I remember.',
      'You took your time coming back up.'],
  },
  hit: ['Still the same shoulder. Four years and still the same shoulder.',
    'You have been practising. On my guardians, I assume.',
    'That is the arm that used to hold a country together.'],
  hurt: ['You are slower than the last time we did this.',
    'Careful. I have already put you off this island once.',
    'Your army is not behind you today.'],
  phase: {
    2: ['Enough of this. Enough playing.',
      'You have forced my hand once already. Do you remember how that ended?'],
    3: ['You took everything from me once. Not twice.',
      'Why will you not stay DOWN?'],
    4: ['I will not lose to you again.',
      'Look at what you are making me do. Look at it.'],
  },
  low: {
    cold: ['So this is how it goes. After everything we did together.',
      'You do not even know what you are ending.'],
    mem: ['So this is how it goes.',
      '...Then you remember what happened. Good.',
      'Finish it properly this time.'],
  },
};

/**
 * WHAT A GUARDIAN SAYS WHEN IT CHANGES SHAPE.
 *
 * Indexed by phase minus two, so the first entry is what it says entering
 * phase two. They are written to be said by ANY of the forty-six guardians,
 * which is why none of them names anything: a stone gate-keeper and a
 * thirty-foot eel have to be able to deliver the same line.
 *
 * They also do the story's work. Every one of these implies the speaker knows
 * who they are fighting, which is the drip-feed that makes the player start
 * asking why — long before any flashback tells them.
 */
const GUARD_PHASE_LINES = [
  ['You are not what the orders described.',
    'He said you would be easier than this.',
    'Enough. Let us do this properly.'],
  ['I know that stance. Everything on this road knows that stance.',
    'You have done this before. I can tell.',
    'Why will you not stay down?'],
  ['He warned us about you. Years ago. YEARS.',
    'You should not be here. You fell.',
    'I will not be the one who let you past.'],
];

/**
 * What kind of place holds what kind of thing.
 *
 * `at` says where in the site it goes: 'centre' for the thing the place is
 * built around, 'edge' for what got shoved against a wall, and the default
 * for the middle ground. `chance` is rolled against the site's own seed, so
 * "some ruins have a pedestal" is stable rather than different every load.
 *
 * The shape of this table is the answer to "the world is empty between
 * bosses": every ruin, cave, mine, camp and hut in the Croaklands now has
 * something in it that opens.
 */
const PROP_PLAN = {
  ruin: [{ kind: 'chest', n: 2, at: 'edge' },
    { kind: 'pedestal', chance: 0.45, at: 'centre' },
    { kind: 'pickup', chance: 0.5 }],
  cave: [{ kind: 'chest', n: 2 }, { kind: 'pickup', chance: 0.7 }],
  mine: [{ kind: 'chest', n: 2, at: 'edge' }, { kind: 'crate', n: 2 },
    { kind: 'pickup', chance: 0.6 }],
  dungeon: [{ kind: 'chest', n: 3, at: 'edge' },
    { kind: 'gate', at: 'centre' }, { kind: 'lever', at: 'edge' },
    { kind: 'pedestal', chance: 0.7, at: 'centre' },
    { kind: 'pickup', chance: 0.8 }],
  temple: [{ kind: 'chest', at: 'edge' }, { kind: 'pedestal', at: 'centre' },
    { kind: 'plate', chance: 0.5, at: 'centre' }],
  shrine: [{ kind: 'pickup', chance: 0.8, at: 'centre' }],
  tower: [{ kind: 'chest', at: 'edge' }, { kind: 'pickup', chance: 0.4 }],
  keep: [{ kind: 'chest', n: 2, at: 'edge' }, { kind: 'door', at: 'centre' },
    { kind: 'pedestal', chance: 0.4 }],
  gatehouse: [{ kind: 'gate', at: 'centre' }, { kind: 'lever', at: 'edge' }],
  camp: [{ kind: 'crate', n: 2 }, { kind: 'pickup', chance: 0.75 }],
  hut: [{ kind: 'crate', chance: 0.9 }],
  farm: [{ kind: 'crate', n: 2 }],
  /**
   * Every settlement has somewhere to buy blades. It is the only reliable
   * supply in the country, and it costs froglets.
   *
   * A VILLAGE gets a stall prop of its own because it has no market: see
   * SETTLE in js/realmsites.js, where `market` is 0 for a village and 5 and
   * 9 for a town and a city. Those, and the tree village's four, have real
   * market stalls standing in them already, and each of THOSE now gets its
   * own trade — see `_placeStalls`. Giving them a random stall prop as well
   * would stand a second awning in the square beside the market.
   */
  village: [{ kind: 'crate', n: 2, at: 'edge' }, { kind: 'stall' }],
  town: [{ kind: 'crate', n: 3, at: 'edge' }],
  city: [{ kind: 'crate', n: 3, at: 'edge' }],
  treevillage: [{ kind: 'crate', n: 2, at: 'edge' }],
  landmark: [{ kind: 'chest', chance: 0.55, at: 'edge' }],
  bridge: [],
  arena: [],
  default: [{ kind: 'chest', chance: 0.6 }],
};

const PHASE_LINES = [
  'It has stopped fighting carefully.',
  'Something under it is awake now.',
  'Whatever it was keeping back, it is not keeping it back any more.',
];

export class Overworld {
  constructor(opts) {
    this.scene = opts.scene;
    this.effects = opts.effects;
    this.hud = opts.hud;
    this.camera = opts.camera;
    this.economy = opts.economy;
    this.inventory = opts.inventory || null;   // an InventoryScreen, or none
    /**
     * The player's thrown blades.
     *
     * Held only so a guardian's ground wave can sweep them out of the air —
     * see `_eatProjectiles`. Optional: without it the waves simply do not
     * clear anything, which is a weaker fight and not a broken one.
     */
    this.kunai = opts.kunai || null;
    /** For the inventory's paperdoll: the player's own colour and skins. */
    this.frogColor = opts.color === undefined ? 0x6cc24a : opts.color;
    this.skins = opts.skins || null;
    this.followCam = null;                     // assigned once the rig exists
    this.atmo = null;                          // assigned by the loader

    this.realm = new Realm(this.scene, opts.seed || 90210);
    this.scatter = null;
    this.sites = null;
    this.people = null;
    /** The unnamed villagers, in whichever settlement is nearest. */
    this.life = null;
    /** What is falling out of the sky. One system, retargeted per region. */
    this.weather = new Weather(this.scene);
    /**
     * What COLOUR the light is. The other half of the weather.
     *
     * Weather is what comes down — rain, snow, ash. This is the hue of the
     * sun and of the bounce off the ground, retargeted off the region's mood,
     * so the Emberwaste is lit orange from above and red from below and the
     * Frostmarch is lit blue-white from both. It draws nothing.
     */
    this.ambience = new Ambience(this.scene);
    this.dialogue = new Dialogue();
    this.journal = new Journal();
    /**
     * A MARKET COUNTER, when one is open.
     *
     * Made here rather than handed in, because unlike the bag it needs
     * nothing from the game outside it — no renderer, no paperdoll, no
     * player colour. It reads a purse and a bag and calls back. See
     * js/stallui.js.
     */
    this.stallui = new StallScreen();

    /** Loaded from the save, or a brand new adventurer. */
    this.progress = this.economy && this.economy.realm
      ? new Progress(this.economy.realm) : Progress.fresh();

    /** Chests, levers, gates, doors — everything that physically moves. */
    this.props = null;
    this._levers = [];
    this._gates = [];
    this.encounters = [];
    this.camps = [];
    this.boss = null;              // the live DungeonBoss, if any
    this.bossOf = null;            // its encounter
    this.frogath = null;
    this.region = null;
    this.bannerT = 0;
    this.deathT = 0;
    this.home = null;              // where dying puts you back
    this.prompt = null;            // what E would do right now
    this.time = 0;
    this._savedWater = null;
    /**
     * The last place the player stood that they were allowed to stand in.
     *
     * The gate pushes them back toward it, so a sealed border is a wall you
     * bounce off rather than a teleport. See `_gate`.
     */
    this.lastOpen = null;
    this.sealedT = 0;
    this._sealedSaid = null;
    /**
     * THE WAKEWOOD — where a new game actually begins. See js/wakewood.js.
     *
     * Its own module rather than a site kind, because it is the one place in
     * the country that is hand-built rather than generated from a table: it
     * is the first thirty seconds anybody plays and it is worth the file.
     */
    this.wood = null;
    /**
     * THE ASCENDED THRONE — the last arena. See js/throne.js.
     *
     * Also its own module, and for the same reason: it is the last ninety
     * seconds anybody plays, it is the only arena in the game that overrides
     * its region's own sky, and a generic ring of standing stones was not
     * going to carry the end of the story.
     */
    this.throne = null;
    /**
     * The procession after the coronation, while it is running. See
     * js/coronation.js — it is what holds `player.solemn` on.
     */
    this.walk = null;
    /**
     * A villager walking over to hand you a quest. See `_greet`.
     *
     * `_greetSite` is the settlement already greeted on this visit, cleared
     * the moment you step back outside it, so a village greets you once per
     * time you walk into it rather than once per frame.
     */
    this.greeting = null;
    this._greetSite = null;
    this._greetIn = 0;
    /**
     * THE MEMORIES.
     *
     * The player forgot the opening. This gives it back to them in pieces,
     * fired from six places in this file — a region entered, a guardian down,
     * a place examined, a carving read, a weapon found, a count reached — and
     * it decides everything else itself. See js/flashbacks.js.
     */
    this.flash = new Flashbacks({
      hud: this.hud,
      onSave: () => this.save(),
      // The scene and the camera, so a memory can be ACTED rather than
      // merely described. See js/memoryscene.js.
      scene: this.scene,
      camera: this.camera,
    });
    /** Guardians whose readiness warning has already been given. */
    this._warned = new Set();
  }

  get collision() { return this.realm.collision; }

  /**
   * True while a full-screen panel is holding the world still.
   *
   * A flashback counts: it takes the whole screen, it has a conversation in
   * it, and a mob that kept swinging while the player was remembering
   * something would be the worst possible place to lose a fight.
   */
  get frozen() {
    return (this.inventory && this.inventory.isOpen)
      // A market counter stops the world for the same reason the bag does:
      // it takes the mouse back, and a mob that kept swinging at you while
      // you compared two helmets would be indefensible.
      || (this.stallui && this.stallui.isOpen)
      || this.dialogue.open || this.journal.open
      || (this.flash && this.flash.busy)
      /**
       * A CINEMATIC CONVERSATION, but not banter.
       *
       * `Cine.busy` is true only for a SCRIPT — the last words with Frogath,
       * a flashback. It is never true for the mid-fight channel, which is
       * the entire reason those are two channels: a boss saying something
       * while it swings must not be able to stop the world, and the beat
       * after the last fight in the game must.
       */
      || Cine.busy;
  }

  // ------------------------------------------------------------------ build

  buildTasks() {
    const tasks = this.realm.buildTasks();
    tasks.push(['Sowing the wild', () => {
      this.scatter = new Scatter(this.scene, this.realm);
    }]);
    this.sites = new Sites(this.scene, this.realm);
    for (const t of this.sites.buildTasks(REGIONS)) tasks.push(t);
    this.people = new People(this.scene, this.realm);
    for (const t of this.people.buildTasks()) tasks.push(t);
    tasks.push(['Opening the shutters', () => {
      this.life = new Life(this.scene, this.realm);
    }]);
    tasks.push(['Placing the guardians', () => this._placeEncounters()]);
    tasks.push(['Setting the watch', () => this._placeCamps()]);
    tasks.push(['Filling the chests', () => {
      this.props = new Props(this.scene, this.realm.collision);
      this.props.onPay = (p) => this._propPay(p);
      this._placeProps();
    }]);
    // The goods on the market counters, one trade per stall. Before the
    // bake, like every other prop. See `_placeStalls`.
    tasks.push(['Setting out the market', () => this._placeStalls()]);
    /**
     * The Wakewood, before the bake.
     *
     * It registers a couple of hundred colliders — every trunk, every root,
     * every stepping stone — and the broadphase only ever looks at boxes
     * that were in it when `bake` ran, so building this after that line
     * would give the player a forest they walk straight through.
     */
    this.wood = new Wakewood(this.scene, this.realm);
    for (const t of this.wood.buildTasks()) tasks.push(t);
    /**
     * THE ASCENDED THRONE — the last arena, and also before the bake.
     *
     * It registers a collider for every pillar, every plinth, every shard
     * and the throne itself, and the broadphase only sees boxes that were
     * in it when `bake` ran. See js/throne.js.
     *
     * It has to come after `_placeEncounters`, because it is built around
     * wherever `placeSpot` actually put the Frogath arena rather than
     * around the coordinates the region table asked for.
     */
    tasks.push(['Finding the last ground', () => {
      const a = this.sites && this.sites.arenas.get('frogath');
      if (a) this.throne = new ThroneArena(this.scene, this.realm, a.at);
    }]);
    /**
     * Its own steps are pushed as a wrapper, because the arena does not
     * exist yet at the moment this list is being assembled — the task
     * above makes it. Each wrapper is a no-op if there is no arena.
     */
    for (const label of ThroneArena.STEPS) {
      tasks.push([label, () => {
        if (!this.throne) return;
        const step = this.throne.step(label);
        if (step) step();
      }]);
    }
    /**
     * THE STONE IN THE GLADE, as a thing you can put your hand on.
     *
     * The Wakewood builds the carving; this makes it touchable. It is the
     * first interactive object in the game and the first flashback, and it
     * has to come after the wood's own build steps because it needs to know
     * where the wood decided to put its pedestal.
     */
    tasks.push(['Reading the mark', () => {
      const p = this.wood.pedestal;
      if (!p || !this.props) return;
      this.props.add({
        kind: 'pedestal', id: 'wakewood:stone',
        at: { x: p.x, y: p.y + 0.2, z: p.z }, yaw: 0,
        label: 'Touch the mark', usedLabel: 'Touch it again',
        look: null, prizeLook: null,
        trim: 0xffd76b, wood: 0x8b8578,
        prize: { what: 'memory' },
        repeat: true,
        site: 'wakewood',
      });
    }]);
    /**
     * THE BROKEN ROADS — also before the bake, and for the same reason.
     *
     * Eight places where the way through is gone: a bridge in the river, a
     * mile of windfall over the Wood Road, a hole in the Sunderway. They
     * are placed ON the road network at its own graded heights, which is
     * what makes them roads that broke rather than obstacles that were
     * put somewhere. See js/traverse.js.
     */
    this.traverse = new Traversals(this.scene, this.realm);
    for (const t of this.traverse.buildTasks()) tasks.push(t);
    tasks.push(['Rewarding the climb', () => this._placeSpurs()]);
    /**
     * The broadphase is baked LAST, once, with every site's collider already
     * in it. The collision world hashes its boxes into a grid at bake time
     * and nothing looks at a box added afterwards, so a structure built after
     * this line would be scenery you walk straight through.
     */
    tasks.push(['Settling the stones', () => this.realm.collision.bake()]);
    /**
     * WHERE A TREE MAY NOT BE SOLID.
     *
     * The scatter's trunks, boulders and spikes are colliders now — see
     * js/scatter.js and the streamed layer in js/collision.js — and the
     * scatter has no keep-out of its own: it will grow a pine in the middle
     * of a market square, which was harmless while none of it was solid.
     *
     * This is the keep-out. Roads it handles itself; settlements it cannot
     * see, so the answer is handed in. The visual is untouched either way —
     * only the collider is skipped, so a village looks exactly as it did.
     */
    tasks.push(['Clearing the squares', () => {
      if (!this.scatter || !this.sites) return;
      const wood = this.wood;
      const tv = this.traverse;
      this.scatter.keepClear = (x, z) => {
        if (this.sites.insideSite(x, z)) return true;
        // Nor anything solid inside a broken crossing. Those are built to be
        // climbed on a measured line, and a streamed boulder dropped into
        // the gap between two piers changes the crossing without saying so.
        if (tv && tv.siteAt(x, z)) return true;
        // And nothing solid within reach of a Wakewood path. The wood spends
        // its whole build keeping its paths walkable (see PATH_CLEAR) and a
        // streamed boulder dropped on one afterwards would undo that.
        return !!(wood && wood.onPath && wood.onPath(x, z));
      };
    }]);
    return tasks;
  }

  _placeEncounters() {
    for (const R of REGIONS) {
      (R.bosses || []).forEach((spec, i) => {
        const arena = this.sites.arenas.get(spec.id);
        const spec2 = GUARDIAN_BY_ID.get(spec.id);
        // Frogath is not in the guardian table — he has his own file, his own
        // rig and his own fight — so he is allowed through without one.
        if (!arena || (!spec2 && spec.id !== 'frogath')) return;
        this.encounters.push({
          id: spec.id,
          spec: spec2 || null,
          region: R,
          tier: R.tier,
          power: powerFor(R.tier, i),
          /**
           * What the player ought to be carrying. A warning, never a gate —
           * see the note on RECOMMENDED in guardians.js. Shown once, when
           * they walk into the ring, and then never again.
           */
          wants: recommendedFor(spec.id, R.tier, i),
          at: arena.at,
          r: spec.r || spec.arena,
          final: !!spec.final,
        });
      });
    }
  }

  /**
   * Fill the world with things that move when you touch them.
   *
   * One pass over every site that has already been built, because a chest
   * belongs to the ruin it is standing in and there is no other list of where
   * the ruins are. Deterministic: the seed is the site's own position, so the
   * same ruin has the same three chests in the same corners on every load and
   * on every machine, which is what makes `Progress.found` able to remember
   * that you opened the middle one.
   *
   * Runs BEFORE the broadphase is baked — see `buildTasks`. A chest added
   * after the bake would be a chest you walk through.
   */
  _placeProps() {
    for (const s of this.sites.sites) {
      const R = REGION_BY_ID.get(s.region);
      const tier = R ? R.tier : 0;
      const rnd = mulberry32(((Math.round(s.at.x) * 2654435761)
        ^ (Math.round(s.at.z) * 1597334677)) >>> 0);
      const plan = PROP_PLAN[s.kind] || PROP_PLAN.default;
      let n = 0;
      /**
       * The story's own props first.
       *
       * A site that holds one of the twenty-eight carvings gets it before
       * anything else, and it goes near the middle where it cannot be missed.
       * Placed here rather than in a separate pass so the whole layer shares
       * one loop, one seed and one collider registration.
       */
      const lore = LORE_BY_SITE.get(s.id);
      if (lore) {
        const a = rnd() * Math.PI * 2;
        const d = s.r * 0.2;
        const lx = s.at.x + Math.cos(a) * d;
        const lz = s.at.z + Math.sin(a) * d;
        const ly = this.realm.heightAt(lx, lz);
        if (ly >= SEA + 0.4) {
          this._prop(lore.kind, lore.id, lx, ly, lz, a + Math.PI, tier, s, rnd,
            lore);
        }
      }
      for (const want of plan) {
        if (want.chance !== undefined && rnd() > want.chance) continue;
        for (let i = 0; i < (want.n || 1); i++) {
          const a = rnd() * Math.PI * 2;
          const d = s.r * (want.at === 'edge' ? 0.62 + rnd() * 0.22
            : want.at === 'centre' ? 0.12 : 0.34 + rnd() * 0.3);
          const x = s.at.x + Math.cos(a) * d;
          const z = s.at.z + Math.sin(a) * d;
          const y = this.realm.heightAt(x, z);
          // Nothing under water, and nothing on a slope it would hang off.
          if (y < SEA + 0.4) continue;
          this._prop(want.kind, `${s.id}:${want.kind}${n++}`,
            x, y, z, a + Math.PI, tier, s, rnd);
        }
      }
    }
  }

  /**
   * WHAT IS AT THE END OF AN OPTIONAL CLIMB.
   *
   * Five of the eight broken crossings have a spur — a harder line off the
   * route, visible from it, that nothing on the critical path needs. This
   * puts something real at the end of each: a strongbox lashed to a fallen
   * span, a garrison's pay-chest on a floor nobody cleared, a shrine in the
   * dry chamber behind a waterfall.
   *
   * The chests roll `deep`, so they pay a tier ABOVE their region — the
   * same allowance a chest at the bottom of a mine gets, and for the same
   * reason: you had to choose to go there. The Old Mountain Route's spur is
   * a shortcut instead, and a shortcut's reward is that it is a shortcut.
   *
   * Before the bake, like every other prop. See `_placeProps`.
   */
  _placeSpurs() {
    if (!this.traverse || !this.props) return;
    for (const sp of this.traverse.spurs()) {
      if (sp.what === 'shortcut') continue;
      const R = REGION_BY_ID.get(sp.site.spec.region);
      const tier = R ? R.tier : 0;
      const P = {
        kind: sp.what === 'shrine' ? 'pedestal' : 'chest',
        id: sp.id,
        at: { x: sp.at.x, y: sp.at.y + 0.05, z: sp.at.z },
        yaw: sp.yaw,
        wood: 0x6b4a2a,
        trim: 0xffd76b,
        site: 'dungeon',
      };
      if (sp.what === 'shrine') {
        P.label = 'Take the offering';
        P.look = 'relic';
        P.prizeLook = null;
        P.prize = { what: 'loot', tier: Math.min(5, tier + 1), deep: true };
      } else {
        P.label = 'Open the strongbox';
        P.usedLabel = 'Empty';
        P.prizeLook = 'relic';
        P.prize = { what: 'loot', tier, deep: true };
      }
      this.props.add(P);
    }
  }

  /**
   * ═══ A TRAY OF WARES ON EVERY MARKET STALL ═════════════════════════════
   *
   * The markets were already built and you could not buy anything from any
   * of them: nine stalls in a city, four round the roots of the tree
   * village, forty in the Hollow Market, and the only shop in the country
   * was a separate stall prop dropped at a random angle somewhere in the
   * square. This puts the goods on the counters that are already there.
   *
   * WHAT EACH ONE SELLS COMES FROM WHERE IT STANDS. `tradeFor` deals the
   * trades out along the row so no two neighbours repeat, and `offerOf`
   * seeds the actual item off the counter's rounded-off position — so the
   * grocer by the well is the grocer by the well on every load and on every
   * machine, which is what makes it worth walking back to an armourer you
   * found in a town you can reach. It is also what lets `Progress.found`
   * remember which of the Hollow Market's stalls you have already searched.
   *
   * The first stall of every market is the blade-seller, at the price the
   * world's one kunai stall always charged. Blades are the only reliable
   * supply in the country and that promise predates this file.
   *
   * Before the bake, like every other prop. See `_placeProps`.
   */
  _placeStalls() {
    if (!this.sites || !this.props) return;
    const byId = new Map(this.sites.sites.map((s) => [s.id, s]));
    /** How many counters this settlement has dealt trades out to so far. */
    const dealt = new Map();
    let n = 0;
    for (const st of this.sites.stalls) {
      const site = byId.get(st.site);
      const R = site ? REGION_BY_ID.get(site.region) : null;
      const tier = R ? R.tier : 0;
      // The counter's own position, rounded, is the seed for its stock.
      const seed = ((Math.round(st.x) * 2654435761)
        ^ (Math.round(st.z) * 1597334677)) >>> 0;
      /**
       * THE TRADE COMES FROM THE SETTLEMENT'S SEED, THE GOODS FROM THE
       * COUNTER'S.
       *
       * Which is the whole difference between a market and a shuffle.
       * `tradeFor` walks the trade list, so consecutive counters in a row
       * are consecutive trades; seeded per stall instead it draws
       * independently for each one and independent draws clump — Anurath's
       * nine-stall market came out with two herbalists side by side and no
       * armourer in it at all. The STOCK is still per counter, so two
       * herbalists in one city lay out overlapping but different goods.
       */
      const index = dealt.get(st.site) || 0;
      dealt.set(st.site, index + 1);
      const siteSeed = site
        ? (((Math.round(site.at.x) * 374761393)
          ^ (Math.round(site.at.z) * 668265263)) >>> 0)
        : seed;
      const trade = tradeFor(index, siteSeed);
      const stock = stockOf(trade, tier, seed);
      if (!stock.length) continue;

      this.props.add({
        kind: 'wares',
        id: `wares:${st.site}:${n++}`,
        at: { x: st.x, y: st.y, z: st.z },
        /**
         * `face` is the yaw the stall's awning was built with, and the
         * counter faces the same way, so the tray shares it. See `_stall`.
         */
        yaw: st.face || 0,
        wood: 0x8a6a4a,
        goods: trade.goods,
        site: site ? site.kind : null,
        /**
         * EVERY STALL REPEATS. A counter is not a chest: it is still there
         * tomorrow, and `Prop.restore` refuses to mark a repeating prop
         * used, so buying from one and then saving cannot shut it. That
         * includes the Hollow Market's — see `abandoned` below.
         */
        repeat: true,
        label: `Look at ${trade.at}`,
        /**
         * The whole counter travels on the prop, and `_touch` opens the
         * panel rather than buying anything. Nothing is charged until a lot
         * is chosen in there — see `_stallBuy`.
         */
        stall: {
          sign: trade.sign,
          keeper: trade.keeper,
          line: trade.line,
          stock,
          /**
           * NOBODY BEHIND IT, BUT STILL A SHOP.
           *
           * The Hollow Market's fifty-seven counters are the emptiest place
           * in the game, and its own blurb says how they work: "Stalls,
           * awnings, PRICES CHALKED UP. Nobody." So you read the board and
           * leave the coins. The panel drops the keeper and says so.
           *
           * They were one-shot stalls to SEARCH at first, on the theory
           * that a working shop would contradict the one word the place is
           * about. It does not — a price with nobody to take it is worse.
           */
          abandoned: !!st.abandoned,
        },
      });
    }
  }

  /**
   * ═══ BUYING ONE LOT OFF A COUNTER ══════════════════════════════════════
   *
   * Called by the panel, which owns no money and no goods. Returns the line
   * to show at the foot of it, so every outcome is answered in the place the
   * player is looking.
   *
   * The order matters and is the same as the props': check the purse, check
   * the pack, and only then spend. The inventory is capped per item — see
   * `Progress.add`, which returns how many it actually took — so charging
   * first would make a stall the one transaction in the game that can lose
   * you froglets.
   */
  _stallBuy(lot) {
    if (!lot || !this.economy) return 'Nothing doing.';
    if (!this.economy.canAfford(lot.price)) {
      Audio.uiBack();
      return `${lot.price} froglets. You have `
        + `${Math.floor(this.economy.froglets)}.`;
    }
    if (lot.kunai) {
      this.economy.spend(lot.price);
      this.giveKunai(lot.n, 'bought');
      this.markDirty();
      return `${lot.n} kunai. ${lot.price} froglets.`;
    }
    const g = GEAR_BY_ID.get(lot.item && lot.item.id);
    if (!g) return 'Nothing doing.';
    if (this.progress.count(g.id) >= g.stack) {
      Audio.uiBack();
      return `You cannot carry another ${g.name.toLowerCase()}.`;
    }
    const got = this.progress.add(g.id, lot.n);
    if (got <= 0) {
      Audio.uiBack();
      return `You cannot carry another ${g.name.toLowerCase()}.`;
    }
    this.economy.spend(lot.price);
    Audio.pickup(this.player ? this.player.pos : null);
    this.applyStats();
    this._paintObjectives();
    this.markDirty();
    return `${g.name}${got > 1 ? ` ×${got}` : ''}. ${lot.price} froglets.`;
  }

  /** One prop, with the look and the reward its kind and its region imply. */
  _prop(kind, id, x, y, z, yaw, tier, site, rnd, lore) {
    const P = { kind, id, at: { x, y, z }, yaw };
    const woods = [0x6b4a2a, 0x59422a, 0x7a5a3a, 0x4a3822];
    P.wood = woods[Math.floor(rnd() * woods.length)];
    P.trim = tier >= 4 ? 0xd9b06a : tier >= 2 ? 0xc9a227 : 0x9a7d33;
    /**
     * WHAT KIND OF PLACE THIS IS STANDING IN.
     *
     * Carried on the prop so the payout can ask. A chest in a cave is worth
     * more than a chest in a farmyard, and the only way for the payout to
     * know that is for the prop to remember where it was put.
     */
    P.site = site ? site.kind : null;
    if (lore) {
      // A carving is worth exactly one thing: what it says.
      P.label = lore.kind === 'tome' ? 'Read it' : 'Read the carving';
      P.usedLabel = 'Read it again';
      P.trim = 0xffd76b;
      P.prize = { what: 'lore', id: lore.id };
      const prop = this.props.add(P);
      return prop;
    }
    switch (kind) {
      case 'chest':
        P.label = 'Open the chest';
        P.usedLabel = 'Empty';
        // Deep in a ruin it is worth gear; on a farm it is worth blades.
        P.prize = rnd() < 0.45 ? { what: 'loot', tier }
          : { what: 'kunai', n: 3 + Math.floor(rnd() * 5) + tier };
        P.prizeLook = P.prize.what === 'kunai' ? 'kunai' : 'relic';
        break;
      case 'crate':
        P.label = 'Prise the lid off';
        P.usedLabel = 'Empty';
        P.prize = rnd() < 0.55
          ? { what: 'kunai', n: 2 + Math.floor(rnd() * 3) }
          : { what: 'loot', tier: Math.max(0, tier - 1) };
        P.prizeLook = P.prize.what === 'kunai' ? 'kunai' : 'relic';
        break;
      case 'pedestal':
        P.label = 'Take it';
        P.look = rnd() < 0.5 ? 'sword' : 'relic';
        P.prize = { what: 'loot', tier: Math.min(5, tier + 1) };
        P.prizeLook = null;         // the thing on the stand IS the prize
        break;
      case 'pickup':
        P.label = 'Pick it up';
        P.look = 'kunai';
        P.prize = { what: 'kunai', n: 2 + Math.floor(rnd() * 4) };
        P.prizeLook = null;
        break;
      /**
       * THE VILLAGE STALL — blades, and whatever else a knife-seller has.
       *
       * A village has no market of its own (SETTLE gives it `market: 0`, so
       * `_placeStalls` never reaches it), and blades must be buyable in every
       * settlement in the country. So it gets a stall of its own, and it
       * opens the same counter panel every market stall does: a stand you
       * can only buy one thing from, when the nine in the next town along
       * lay six out, would be the odd one out for no reason.
       */
      case 'stall': {
        const blades = TRADES[0];
        const seed = ((Math.round(x) * 2654435761)
          ^ (Math.round(z) * 1597334677)) >>> 0;
        P.repeat = true;
        P.label = `Look at ${blades.at}`;
        P.stall = {
          sign: blades.sign,
          keeper: blades.keeper,
          line: blades.line,
          stock: stockOf(blades, tier, seed),
          abandoned: false,
        };
        break;
      }
      case 'lever':
        P.label = 'Throw the lever';
        P.usedLabel = 'Thrown';
        P.prize = { what: 'open', site: site.id };
        break;
      case 'gate':
        // A gate is opened BY something. Standing at it does nothing, which
        // is the point — the lever is somewhere else in the ruin.
        P.label = null;
        P.w = 7; P.h = 5.5;
        break;
      case 'door':
        P.label = 'Push the doors open';
        P.usedLabel = 'Open';
        P.w = 4.4; P.h = 4.4;
        break;
      default:
        P.label = 'Press it';
        break;
    }
    const prop = this.props.add(P);
    if (kind === 'lever') this._levers.push({ lever: prop, site: site.id });
    if (kind === 'gate') this._gates.push({ gate: prop, site: site.id });
    return prop;
  }

  /**
   * A prop reached its payoff beat.
   *
   * Everything a prop can be worth is resolved here rather than in props.js,
   * which knows nothing about loot tables, kunai counts or quests — it only
   * knows how a lid moves and when the thing inside it should appear.
   */
  _propPay(prop) {
    const p = this.progress;
    const prize = prop.spec.prize;
    // A repeating prop is never recorded as used — see `Prop.restore`.
    if (!prop.spec.repeat) p.found.add(prop.id);
    if (!prize) { this.markDirty(); return; }
    if (prize.what === 'kunai') {
      this.giveKunai(prize.n, 'from the chest');
    } else if (prize.what === 'loot') {
      const said = [];
      /**
       * WHAT YOU GET FOR GOING SOMEWHERE YOU DID NOT HAVE TO.
       *
       * A chest in a cave, a mine or a dungeon rolls one tier ABOVE the
       * region it is in — see `deep` in rollLoot. Those are the three place
       * kinds you have to deliberately go into and fight your way through,
       * and they are exactly the places that should be holding equipment the
       * main line has not offered you yet. A chest sitting in a village
       * square does not get it.
       */
      const where = prop.spec.site;
      const deep = prize.deep
        || where === 'cave' || where === 'mine' || where === 'dungeon';
      for (const it of rollLoot(prize.tier, false, Math.random, { deep })) {
        const g = GEAR_BY_ID.get(it.id);
        if (g && p.add(it.id, it.n) > 0) {
          said.push(`${g.name}${it.n > 1 ? ` ×${it.n}` : ''}`);
        }
      }
      // A tier's worth of equipment as well, from anything on a stand.
      if (prop.kind === 'pedestal') {
        for (const it of rollLoot(prize.tier, true, Math.random, { deep })) {
          const g = GEAR_BY_ID.get(it.id);
          if (g && p.add(it.id, it.n) > 0) said.push(g.name);
        }
      }
      this.hud.toast(said.length ? `Taken: ${said.join(', ')}.` : 'Nothing left in it.', 5);
      if (deep && said.length) {
        this.hud.announce('SOMETHING FROM DEEPER IN', 'good', false);
      }
      this.applyStats();
    /**
     * THERE IS NO 'shop' PRIZE ANY MORE, and that is worth saying here
     * because there was one and it is the obvious place to look for it.
     *
     * A stall's price used to live on the prop and be charged on the payoff
     * beat, so pressing E bought the one thing that stall sold. Every stall
     * in the country now opens a counter with four to six lots on it and
     * nothing is charged until one is chosen — so the transaction cannot be
     * a prize at all: the prop no longer knows the price. See `_touch`,
     * which routes `spec.stall` to the panel, and `_stallBuy`, which is what
     * the panel calls back.
     */
    } else if (prize.what === 'memory') {
      /**
       * A THING THAT IS ONLY A MEMORY.
       *
       * The stone in the Wakewood: it holds no loot, opens no door and pays
       * no experience. Touching it is the first flashback in the game and
       * that is the entire reward, which is why it needs its own prize kind
       * rather than being dressed up as a chest with a story in it.
       */
      this._pendingMemory = { kind: 'prop', key: prop.id };
    } else if (prize.what === 'lore') {
      this._read(prize.id, true);
    } else if (prize.what === 'open') {
      // A lever opens every gate in the place it stands in.
      let opened = 0;
      for (const g of this._gates) {
        if (g.site !== prize.site || g.gate.used || g.gate.moving) continue;
        g.gate.use();
        this.progress.found.add(g.gate.id);
        opened++;
      }
      this.hud.toast(opened
        ? 'Somewhere behind you, something heavy starts to lift.'
        : 'Nothing happens. Whatever it was for is long gone.', 5);
    }
    this.markDirty();
  }

  /**
   * Read one of the twenty-eight.
   *
   * The first reading pays experience and counts toward the collection; every
   * reading after that just shows the text again, because a player who wants
   * to re-read the queen's letter after finding out who she was writing to
   * should be able to.
   */
  _read(id, first) {
    const l = LORE_BY_ID.get(id);
    if (!l) return;
    const p = this.progress;
    const lines = l.lines.slice();
    if (first && !p.found.has(id)) {
      p.found.add(id);
      const r = p.addXp(60 + l.order * 6);
      this._announceLevels(r);
      lines.push(`— ${loreRead(p)} of ${LORE_COUNT} found.`);
      this.applyStats();
      this.save();
      /**
       * Two of the carvings bring a memory up with them.
       *
       * Queued rather than played now: the player is about to read the stone,
       * and interrupting the words with a flashback about the words would be
       * the wrong order. `_pendingMemory` fires when the dialogue closes.
       */
      this._pendingMemory = { kind: 'lore', key: id };
    } else {
      lines.push(`— ${loreRead(p)} of ${LORE_COUNT} found.`);
    }
    this.dialogue.start(l.title, lines);
  }

  _placeCamps() {
    for (const R of REGIONS) {
      (R.camps || []).forEach((spec, i) => {
        this.camps.push(new Camp(spec, R, i, this.scene,
          this.effects, this.realm));
      });
    }
  }

  // ------------------------------------------------------------------ start

  /**
   * Put the player in the world.
   *
   * Where they were standing when they last saved, if that is on land; the
   * village otherwise. "If that is on land" is not paranoia — a save written
   * from a build with a different height function would drop the player into
   * a lake, or inside a hill.
   */
  start(player) {
    this.player = player;

    /**
     * The realm's sea is at 6; the arena's is at 2.2.
     *
     * The swimming check reads `CFG.world.waterLevel` globally, so the realm
     * has to say what its own waterline is or two whole regions — both
     * marshes, both built around wading — would be walked across as if they
     * were dry. Put back on the way out, so the arena is unaffected.
     */
    this._savedWater = CFG.world.waterLevel;
    CFG.world.waterLevel = SEA;

    const p = this.progress;
    let spot = null;
    if (p.at) {
      const h = this.realm.heightAt(p.at.x, p.at.z);
      const R = regionAt(p.at.x, p.at.z, _scratch);
      // On land, roughly where the save said, and somewhere the player is
      // actually allowed to be. A save from before a gate existed must not
      // strand them inside a sealed region.
      if (h > SEA - 1 && Math.abs(h - p.at.y) < 40 && regionOpen(R, p.slain)) {
        spot = { x: p.at.x, y: h, z: p.at.z };
      }
    }
    if (!spot) {
      /**
       * A NEW GAME BEGINS ON THE FLOOR OF THE WAKEWOOD.
       *
       * Not in a village. The player has just been thrown off an island four
       * miles up and has lost every single thing they owned, including their
       * name, and waking up in somebody's tidy square would say none of that.
       * They wake in a wood they have never seen, nine paces from a stone
       * carrying the mark that is on their own clothes, and the first thing
       * the game does is let them turn round and look at it.
       *
       * See js/wakewood.js. The village comes second, and somebody walks
       * them there.
       */
      const wake = this.wood && this.wood.wakeAt;
      const start = this.sites.sites.find((s) => s.id === 'mirefoot')
        || this.sites.sites.find((s) => s.id === 'croakhollow');
      if (wake) spot = { x: wake.x, y: wake.y + 1, z: wake.z };
      else if (start) {
        spot = { x: start.at.x, y: start.at.y + 1, z: start.at.z + start.r * 0.7 };
      } else spot = { x: 430, y: 0, z: 1900 };
      spot.y = this.realm.heightAt(spot.x, spot.z) + 1;
      this._justWoke = true;
    }
    this.home = { x: spot.x, y: spot.y, z: spot.z };
    this.lastOpen = { x: spot.x, z: spot.z };

    player.pos.set(spot.x, spot.y + 1.2, spot.z);
    player.vel.set(0, 0, 0);
    player.combatEnabled = true;
    player.onUseItem = () => this.eatQuick();
    /**
     * The blades you actually have, not a fresh handful.
     *
     * `main.js` builds the hotbar with the arena's starting count; the save
     * is the authority out here. Set before `applyStats` so the very first
     * HUD paint shows the real number.
     */
    player.inventory.setUnlimitedKunai(false);
    player.inventory.setKunai(p.kunai);
    this._kunaiSeen = p.kunai;
    this.applyStats();
    player.health.revive();
    player.stamina.reset();

    // Everything within sight, before the first frame is drawn.
    this.realm.streamAround(spot.x, spot.z, true);
    if (this.scatter) this.scatter.streamAround(spot.x, spot.z, true);
    this.sites.update(spot.x, spot.z, 0);
    // Every settlement shows the version of itself that matches the save:
    // boarded up where its guardian still lives, rebuilding where it does not.
    this.sites.setFreed(p.slain);
    // Every chest you have already emptied is standing open, every lever you
    // have thrown is thrown, and every gate they lifted is still up.
    if (this.props) this.props.restore(p);
    this.region = regionAt(spot.x, spot.z, _scratch);
    p.seen.add(this.region.id);
    // The sky and the music of wherever we woke up, with no cross-fade.
    this.weather.set(this.region.weather || 'clear', true);
    this.ambience.set(this.region.music || 'calm', true);
    Audio.setRegionMood(this.region.music || 'calm');
    if (this.life) {
      this.life.moveTo(this.sites.nearestSettlement(spot.x, spot.z), p.slain);
    }
    this._paintObjectives();
    // The minimap belongs to this mode: put it up here and `resetOverlays`
    // takes it down on the way out.
    this._miniShown = true;
    this.hud.setMinimap(true);
    this.journal.paintMini(p, player.pos, this.realm, this.facing,
      this.region ? this.region.name : '');
    this._watchUnload();
    this.save();
  }

  /**
   * Push the save's numbers into the player.
   *
   * Called on start and after every equipment change. Two things cross over:
   * max health, which is hearts times HEART, and the katana's damage, which
   * rides on the multiplier the story's broken sword already uses. Nothing
   * else about the player is touched — the dash, the tongue and the kunai are
   * the same on the first day as the last, because they are the game's verbs
   * and not its numbers.
   */
  applyStats() {
    const st = this.progress.stats();
    const pl = this.player;
    if (!pl) return;
    pl.health.setMaxScale((this.progress.hearts * HEART) / CFG.combat.maxHealth);
    pl.damageMultiplier = st.atk / BASE.atk;
    /**
     * ═══ AND THE WEAPON IN YOUR HAND IS THE ONE YOU EQUIPPED ══════════════
     *
     * Twenty weapons in the gear table and, until this, every one of them
     * was the same katana held the same way and swung at the same rate.
     * Buying the Quarry Maul changed a number in the bag and nothing you
     * could see or feel.
     *
     * This is the only place gear changes: it is called from the inventory
     * screen, from every loot payout, from a market purchase and from
     * entering the mode. So both halves hang off it — the silhouette in the
     * frog's hand and the way it swings. See js/weapons.js.
     *
     * The COSMETIC SKIN still shows: `lookOf` takes the shape from the gear
     * and the colours from a bought skin, so a gold katana carried as a maul
     * is a gold maul and neither purchase is thrown away.
     */
    const wid = this.progress.equipped.weapon;
    if (this._weaponShown !== wid) {
      this._weaponShown = wid;
      /**
       * Both halves are guarded, like everything else this function touches.
       * `applyStats` is called with whatever the mode has for a player — the
       * loader calls it before the rig exists, and the tests drive it with a
       * stub — so it may not have a combat state or a model yet, and a shop
       * purchase must not be able to throw on the way out of the panel.
       */
      if (pl.combat && pl.combat.setWeapon) pl.combat.setWeapon(feelOf(wid));
      if (pl.model && pl.model.setWeapon) {
        pl.model.setWeapon(lookOf(wid, this.skins && this.skins.sword));
      }
    }
    // The hotbar's meal follows the bag, and the bag changes at exactly the
    // moments this is called: a kill, a reward, a piece of gear swapped.
    this._syncMeal();
    /**
     * GETTING STRONGER IS ITSELF A STORY BEAT.
     *
     * Two memories hang off it: one on finding a real weapon for the first
     * time — a sword your hands already know — and one on the player's own
     * power crossing the point where they were, once. Both are queued rather
     * than played, because this is called from the middle of a loot payout.
     *
     * Not fired on the very first call of a session: that one happens while
     * the world is still loading, and a memory would land on a black screen.
     */
    if (this._statsOnce) {
      const w = GEAR_BY_ID.get(this.progress.equipped.weapon);
      this._pendingMemory = [
        { kind: 'gear', key: w ? (w.tier || 0) : 0 },
        { kind: 'power', key: this.progress.power },
      ];
    }
    this._statsOnce = true;
  }

  /**
   * Write the save now.
   *
   * `Economy.setRealm` goes straight to localStorage, so this is a real
   * synchronous write. Called directly for the things a player would be
   * furious to lose — a guardian down, a quest handed in, a secret found —
   * and by the autosave below for everything smaller.
   */
  save() {
    if (!this.economy) return;
    const pl = this.player;
    if (pl) this.progress.at = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z };
    this.economy.setRealm(this.progress.toJSON());
    this._dirty = false;
    this._sinceSave = 0;
    this._savedAt = pl ? { x: pl.pos.x, z: pl.pos.z } : null;
  }

  /**
   * Something small changed. It will be on disk within a few seconds.
   *
   * Camp mobs are the reason this exists. Killing one awards experience and
   * loot, and a camp is five or six of them — writing the whole save six
   * times in four seconds is wasteful, and writing it none of the times (the
   * bug this replaces) meant a player who cleared four camps, gained two
   * levels and then closed the tab lost all of it.
   */
  markDirty() { this._dirty = true; }

  /**
   * The autosave.
   *
   * Two triggers, and they answer different worries:
   *
   *   DIRTY     something changed and has not been written. Flushed after a
   *             few seconds, so a burst of kills costs one write.
   *   MOVED     nothing changed, but the player has walked a long way. Their
   *             POSITION is progress too — coming back to find yourself half
   *             a region behind where you stopped is the same annoyance as
   *             losing a level, and it is what makes a save feel unreliable
   *             even when nothing was actually lost.
   */
  _autosave(dt) {
    this._sinceSave = (this._sinceSave || 0) + dt;
    if (this._dirty && this._sinceSave > 4) { this.save(); return; }
    if (this._sinceSave < 25) return;
    const pl = this.player;
    const from = this._savedAt;
    if (!pl || !from) { this.save(); return; }
    if (Math.hypot(pl.pos.x - from.x, pl.pos.z - from.z) > 60) this.save();
    else this._sinceSave = 0;
  }

  /**
   * Write the save on the way out of the PAGE, not just out of the mode.
   *
   * Quitting to the menu calls `dispose`, which saves. Closing the tab,
   * refreshing, or navigating away calls neither — so without this the last
   * few seconds of a session are lost, which is exactly the case a player
   * notices and describes as "it did not save".
   *
   * `pagehide` rather than `beforeunload`: it is the one mobile browsers
   * actually fire, and it fires on a tab being frozen or discarded as well as
   * on a real close. localStorage is synchronous, so the write completes.
   */
  _watchUnload() {
    if (this._onHide) return;
    this._onHide = () => {
      try { this.save(); } catch (e) { /* nothing useful to do here */ }
    };
    window.addEventListener('pagehide', this._onHide);
    window.addEventListener('beforeunload', this._onHide);
  }

  _unwatchUnload() {
    if (!this._onHide) return;
    window.removeEventListener('pagehide', this._onHide);
    window.removeEventListener('beforeunload', this._onHide);
    this._onHide = null;
  }

  // ----------------------------------------------------------------- update

  /**
   * One frame.
   *
   * @param input  the real Input. While a panel is open the world is frozen
   *               and only the panel is given the keyboard.
   * @param onHit  (damage, from) => void, for anything that hits the player
   */
  update(dt, player, input, onHit) {
    this.time += dt;

    // ---- panels first. A frozen world still runs its UI ------------------
    if (this.frozen) {
      // The bag, the map and a conversation all take the screen; the corner
      // map goes away until they are closed.
      this._miniVisible(false);
      /**
       * A memory takes precedence over the panels.
       *
       * It runs its own dialogue and it must NOT be interruptible by TAB or
       * M — a flashback the player can escape by opening their bag is a
       * flashback that gets left half-played and never comes back, since the
       * id is already recorded.
       */
      /**
       * THE AUTOSAVE RUNS BEHIND A PANEL TOO.
       *
       * It used to be at the bottom of the frame, past the early return, so
       * anything that opened a panel suspended it — and that turned out to
       * matter the moment villagers started walking over and opening
       * conversations by themselves: a kill, a quest, a level, and then a
       * frog says hello and the write never happens.
       *
       * A panel is not a pause on the player's PROGRESS. Whatever they have
       * earned is already in `Progress`; there is no reason for reading a
       * carving to be the thing that loses it.
       */
      this._autosave(dt);
      if (this.flash && this.flash.busy) {
        this.flash.update(dt, input);
        return;
      }
      // A scripted conversation with nothing else behind it — the last words
      // with Frogath. It owns the keyboard until it is finished.
      if (Cine.busy) {
        Cine.update(dt);
        Cine.keys(input);
        return;
      }
      this._panelKeys(input);
      if (this.inventory) this.inventory.update(dt);
      if (this.stallui) this.stallui.update(dt);
      // The map keeps drawing while it is open: the objective star pulses,
      // the dashed line to it follows you if you opened it mid-stride, and
      // the player arrow turns as you turn.
      this.journal.tick(dt, this.progress, player.pos, this.realm, this.facing);
      return;
    }
    this._miniVisible(true);
    if (this._openKeys(input)) return;

    // ---- the world -------------------------------------------------------
    this.realm.update(dt, player.pos);
    if (this.scatter) this.scatter.streamAround(player.pos.x, player.pos.z);
    this.sites.update(player.pos.x, player.pos.z, dt);
    if (this.props) {
      this.props.update(dt, player.pos.x, player.pos.z, player.pos);
    }
    this.people.update(dt, player.pos, this.progress);
    this._region(player);
    this._gate(dt, player);
    this._encounters(dt, player, onHit);
    this._camps(dt, player, onHit);
    this._greet(dt, player);
    this._interact(player, input);
    this._pit(dt, player);
    this._death(dt, player);
    if (this.atmo) this._sky(dt, player);
    this.weather.update(dt, this.camera.position,
      this.atmo ? this.atmo.windDir : null);
    this.ambience.update(dt);
    this._life(dt, player);
    this._wood(dt, player);
    // The broken crossings: one distance check each, and only the one you
    // are near submits any draw calls. See js/traverse.js.
    if (this.traverse) {
      this.traverse.update(dt, player.pos.x, player.pos.z);
      this._traverse(player);
    }
    // The last arena: four group rotations and one opacity pulse, and it
    // hides itself past four hundred and twenty units. See js/throne.js.
    if (this.throne) this.throne.update(dt, player.pos.x, player.pos.z);
    // And the procession, which is what keeps `player.solemn` asserted.
    if (this.walk) this.walk.update(dt, player);
    this._banner(dt);
    this._music(player);
    this._memory();
    // The banter channel runs whatever else is happening: it is the one bit
    // of dialogue in the game that never takes control.
    Cine.update(dt);
    this._mini(dt, player);
    this._syncKunai();
    this._autosave(dt);
  }

  /**
   * THE WAKEWOOD, shown and animated only when it is worth it.
   *
   * The wood is one of the densest things in the country — two thousand
   * growing things, a hundred and twenty fog cards, four instanced swarms
   * and eighteen creatures — so it is drawn on the same rule as a city and
   * its LIVING layer is stepped only when the player is actually inside it.
   *
   * Two radii, not one. It is visible from well outside because nine
   * hundred-unit trees are a landmark and the whole point of a landmark is
   * that you can see it from a distance; the creatures and the motes are
   * updated only within earshot, because nobody can see a hopping thing the
   * size of a loaf from two hundred units away.
   */
  _wood(dt, player) {
    const w = this.wood;
    if (!w || !w.at) return;
    const d = Math.hypot(w.at.x - player.pos.x, w.at.z - player.pos.z);
    const show = d < WOOD_R + 420;
    if (w.root.visible !== show) w.root.visible = show;
    if (!show) return;
    w.update(dt, player.pos, d < WOOD_R + 40);
  }

  /**
   * ARRIVING AT A BROKEN CROSSING.
   *
   * The one thing the geometry cannot say for itself: WHY. Each site has a
   * `why` — a sentence about what happened to the road — and it is shown
   * once, on arrival, alongside the name of the place.
   *
   * This is not decoration. The whole difference between a broken bridge
   * and a parkour course is whether the player has a reason for it, and a
   * player who arrives at a gap and has to guess is looking at a parkour
   * course however carefully it was modelled. The hoarding at the near end
   * carries the same line for anyone who arrives from the other direction
   * or comes back later.
   *
   * Once per site per session: told twice it stops being information.
   */
  _traverse(player) {
    /**
     * A ROPE THAT HAS JUST BEEN CUT.
     *
     * Said out loud once, because a beam coming down forty units away
     * behind you is easy to miss, and a mechanism the player does not
     * realise they triggered teaches nothing.
     */
    for (const L of this.traverse.lashings()) {
      if (!L.cut || L.told) continue;
      L.told = true;
      this.hud.toast('The rope parts and the beam comes down across the gap.',
        5);
    }
    const site = this.traverse.siteAt(player.pos.x, player.pos.z);
    if (!site) { this._atCrossing = null; return; }
    if (this._atCrossing === site.spec.id) return;
    this._atCrossing = site.spec.id;
    const told = this._toldCrossings || (this._toldCrossings = new Set());
    if (told.has(site.spec.id)) return;
    told.add(site.spec.id);
    this.hud.toast(`${site.spec.name} — ${site.spec.why}`, 9);
  }

  /**
   * A QUEUED MEMORY, once nothing else is holding the screen.
   *
   * Flashbacks are triggered by things that happen inside a conversation or a
   * loot payout — reading a carving, examining a place, taking a sword — and
   * every one of those is already showing the player something. So the
   * trigger is recorded and fired here, on the first frame when the screen is
   * free. One flashback ever waits, because two is a cutscene nobody asked
   * for; a second one queued over the first simply replaces it, and the
   * dropped trigger will come round again the next time its condition holds.
   */
  _memory() {
    const q = this._pendingMemory;
    if (!q || this.frozen || this.boss || this.frogath || this.greeting) return;
    this._pendingMemory = null;
    // A list is tried in order and the first match wins, so a guardian with
    // a memory of its own beats the generic count threshold.
    for (const t of (Array.isArray(q) ? q : [q])) {
      if (this.flash.fire(t.kind, t.key, this.progress)) break;
    }
  }

  /**
   * WHAT IS PLAYING, AND WHY.
   *
   * Three answers, in order of who wins:
   *
   *   1. a guardian is awake      its own theme, or its rank's
   *   2. you are inside a village its settlement theme — minor while the
   *                               region's guardian is still standing
   *   3. anywhere else            the region's theme
   *
   * Called every frame and almost always does nothing: `Audio.setTheme`
   * compares the name of the piece and returns if it is already playing, so
   * the cost of this is a distance check against the settlements in memory.
   * Doing it here rather than at the moments things change is what makes a
   * guardian dying, a border crossing and a gate opening all pick the right
   * music without any of them having to know about the others.
   */
  _music(player) {
    if (!this.region) return;
    if (this.frogath) return;         // Frogath brings his own, from a file.
    if (this.boss && this.boss.alive && this.boss.active && this.bossOf) {
      const e = this.bossOf;
      const rank = (e.spec && e.spec.rank) || Overworld.rankFor(e.tier);
      Audio.setTheme(bossTheme(e.id, rank), `boss:${e.id}`);
      return;
    }
    const s = this.sites.settlementAt(player.pos.x, player.pos.z);
    if (s) {
      const held = !!(s.freedBy && !this.progress.slain.has(s.freedBy));
      Audio.setTheme(settlementTheme(s.kind, held),
        `town:${held ? 'held' : s.kind}`);
      return;
    }
    Audio.setTheme(regionTheme(this.region.id), `region:${this.region.id}`);
  }

  /**
   * The minimap in the corner, redrawn twelve times a second.
   *
   * Not sixty: nothing on it moves fast enough to need it, and the arrow's
   * turn is smooth at twelve. The expensive part — the ground — is cached
   * inside `paintMini` and only re-sampled when the player has walked out of
   * the last patch, so this is a few hundred lines of vector drawing.
   */
  _mini(dt, player) {
    this.journal.pulse += dt;
    this._miniAcc = (this._miniAcc || 0) + dt;
    if (this._miniAcc < 1 / 12) return;
    this._miniAcc = 0;
    this.journal.paintMini(this.progress, player.pos, this.realm, this.facing,
      this.region ? this.region.name : '');
  }

  /**
   * The minimap gets out of the way while a panel is up.
   *
   * The bag, the map and a conversation all cover the screen, and a little
   * map of the country sitting on top of the corner of them is clutter you
   * cannot dismiss. Driven off `frozen`, so it covers all three without any
   * of them having to remember, and guarded on a cached flag because it runs
   * every frame and toggling a class is a style recalculation.
   */
  _miniVisible(on) {
    if (this._miniShown === on) return;
    this._miniShown = on;
    this.hud.setMinimap(on);
  }

  /**
   * Keep the save's kunai count and the hotbar's the same number.
   *
   * The throwing system decrements the hotbar; nothing tells the save. Rather
   * than teaching `items.js` about a `Progress` it should know nothing about,
   * the difference is noticed here and folded into the autosave — so throwing
   * your last blade and closing the tab does not hand it back.
   */
  _syncKunai() {
    const pl = this.player;
    if (!pl || !pl.inventory) return;
    const n = pl.inventory.kunaiCount;
    if (n === this._kunaiSeen) return;
    this._kunaiSeen = n;
    this.progress.kunai = clamp(n, 0, MAX_KUNAI);
    this.markDirty();
  }

  /**
   * More kunai, from wherever they came from.
   *
   * The one road into the stack: chests, bodies, shops, rewards, ruins. It
   * tops out at what a bag holds and it says how many it gave, because a
   * resource the player is counting has to be counted out loud.
   *
   * @returns how many actually went in — 0 if the bag was already full
   */
  giveKunai(n, why) {
    const pl = this.player;
    if (!pl || !pl.inventory || n <= 0) return 0;
    const have = pl.inventory.kunaiCount;
    const took = Math.min(n, MAX_KUNAI - have);
    if (took <= 0) {
      this.hud.toast('You cannot carry another kunai.', 3);
      return 0;
    }
    pl.inventory.addKunai(took);
    this.progress.kunai = have + took;
    this._kunaiSeen = this.progress.kunai;
    this.markDirty();
    if (why !== false) {
      this.hud.toast(`✦ ${took} kunai${why ? ` — ${why}` : ''}. `
        + `You have ${this.progress.kunai}.`, 5);
    }
    return took;
  }

  /**
   * The people who live in the nearest settlement.
   *
   * Only one settlement is populated at a time, and only when the player is
   * close enough to see it. Checked twice a second rather than every frame —
   * moving a village's worth of frogs is a rebuild, and the answer cannot
   * change in a frame.
   */
  _life(dt, player) {
    if (!this.life) return;
    this._lifeAcc = (this._lifeAcc || 0) + dt;
    if (this._lifeAcc > 0.5) {
      this._lifeAcc = 0;
      // The slain set goes with it: a settlement whose guardian is still
      // standing has soldiers in the square and fewer people out. See
      // `Life.moveTo`.
      this.life.moveTo(
        this.sites.nearestSettlement(player.pos.x, player.pos.z),
        this.progress.slain);
    }
    if (this.life.where) this.life.update(dt, player.pos);
  }

  /**
   * The gate: a region a guardian still holds shut is a region you bounce off.
   *
   * Not a teleport and not an invisible wall you can slide along — the player
   * is pushed back the way they came, told what is holding it, and told which
   * guardian opens it. That last part is the whole design: a locked door that
   * does not say what the key is is indistinguishable from a bug.
   *
   * The push is away from the locked region's CENTRE, which is the direction
   * that reaches an open region fastest — every region's border is where its
   * own weight stops being the largest.
   */
  _gate(dt, player) {
    const R = this.region;
    if (!R) return;
    if (regionOpen(R, this.progress.slain)) {
      this.lastOpen = { x: player.pos.x, z: player.pos.z };
      if (this.sealedT > 0) {
        this.sealedT -= dt;
        if (this.sealedT <= 0) {
          const el = $('sealed');
          if (el) el.classList.remove('show');
        }
      }
      return;
    }
    /**
     * Sealed. Walk them back the way they came.
     *
     * The direction is toward the last place they were allowed to stand,
     * NOT away from the sealed region's centre. Away-from-centre is the
     * obvious choice and it has a hole in it: at the exact centre there is no
     * "away", the direction is zero, and the player stands in the middle of a
     * region they are not allowed in with a warning on screen and nothing
     * moving. Measured — a save or a teleport that lands dead centre stuck
     * there permanently.
     *
     * The last open position is always in an open region by construction, so
     * stepping toward it always gets out, and it retraces the route rather
     * than shoving them sideways into somewhere else they cannot go.
     */
    let ux = 0, uz = 0;
    if (this.lastOpen) {
      ux = this.lastOpen.x - player.pos.x;
      uz = this.lastOpen.z - player.pos.z;
    }
    let len = Math.hypot(ux, uz);
    if (len < 1) {
      // No history, or standing on it: fall back to outward, then to due east.
      ux = player.pos.x - R.x;
      uz = player.pos.z - R.z;
      len = Math.hypot(ux, uz);
      if (len < 1) { ux = 1; uz = 0; len = 1; }
    }
    ux /= len; uz /= len;
    const push = 26 * dt + 0.35;
    player.pos.x += ux * push;
    player.pos.z += uz * push;
    player.pos.y = this.realm.heightAt(player.pos.x, player.pos.z) + 1.0;
    // Any velocity still pointing the wrong way is thrown away, or the player
    // would grind against the border instead of being turned round.
    const into = -(player.vel.x * ux + player.vel.z * uz);
    if (into > 0) {
      player.vel.x += ux * into;
      player.vel.z += uz * into;
    }
    this.sealedT = 2.4;
    const el = $('sealed');
    const why = $('sealed-why');
    if (el && this._sealedSaid !== R.id) {
      this._sealedSaid = R.id;
      const g = GUARDIAN_BY_ID.get(R.gate);
      /**
       * WHAT IS IN THE WAY, not what you have not unlocked.
       *
       * This used to read "THE LILYREACH will not open until GROTT is dead",
       * which is a lock message wearing a fantasy hat: it describes the game's
       * rule rather than the world's situation. `shutBecause` gives the
       * physical obstruction — a barred gate with something standing in it, a
       * ford nothing crosses, a bridge its builder has never let anybody on —
       * and the map already stars the guardian, so a player who reads it knows
       * exactly where to go without ever being told about a requirement.
       */
      if (why) why.textContent = shutBecause(R.id, g ? g.name : R.gate);
      el.classList.add('show');
      Audio.uiBack();
    } else if (el) el.classList.add('show');
  }

  /** Keys that OPEN a panel. Returns true if one just did. */
  _openKeys(input) {
    if (input.consume('Tab') && this.inventory) {
      this.inventory.onEat = (item) => this._eat(item);
      this.inventory.open(this.progress, this.frogColor, this.skins);
      /**
       * Give the mouse back.
       *
       * The bag has slots and tabs to click, and the game has the pointer
       * captured — so without this the panel is keyboard-only and the cursor
       * is invisible. Releasing the lock would normally drop the pause screen
       * on top; `Game._onLockChange` asks `overworld.frozen` first, which is
       * true from the moment `open` is called above.
       */
      input.releaseLock();
      return true;
    }
    if (input.consume('KeyM')) {
      this.journal.toggleMap(this.progress, this.player.pos, this.realm,
        this.facing);
      return true;
    }
    return false;
  }

  /** Keys while a panel is up. Each panel closes itself; this only routes. */
  _panelKeys(input) {
    if (this.dialogue.open) { this.dialogue.keys(input); return; }
    /**
     * The counter before the bag, because it is the one that was opened by
     * standing somewhere: E must shut it rather than reaching past it.
     */
    if (this.stallui && this.stallui.isOpen) {
      if (this.stallui.keys(input)) {
        this.stallui.close();
        this.applyStats();
        this.save();
        input.requestLock();
      }
      return;
    }
    if (this.inventory && this.inventory.isOpen) {
      if (this.inventory.keys(input)) {
        this.inventory.close();
        this.applyStats();
        this.save();
        // Take the mouse back for looking around. A browser can refuse a
        // lock requested this soon after leaving one, in which case the
        // click-to-play prompt appears and the next click gets it — which is
        // the same path every other mode already relies on.
        input.requestLock();
      }
      return;
    }
    if (this.journal.mapOpen && (input.consume('KeyM') || input.consume('Escape')
      || input.consume('Tab'))) {
      this.journal.closeAll();
    }
  }

  /** Eating: only when it would do something. Returns whether it landed. */
  _eat(item) {
    const pl = this.player;
    if (!pl || !item.heal) return false;
    if (pl.health.hp >= pl.health.max - 0.5) return false;
    pl.health.hp = Math.min(pl.health.max, pl.health.hp + item.heal);
    this.progress.remove(item.id, 1);
    Audio.refreshed(pl.pos);
    this._syncMeal();
    // One item out of the bag. Small, but it is still the bag changing.
    this.markDirty();
    return true;
  }

  /**
   * The quick meal in the last hotbar slot.
   *
   * The best thing in the bag, so the key is worth pressing — and the bag is
   * still where you choose to eat something else. Kept in step with what is
   * actually carried, because a hotbar slot that offers food you ate ten
   * minutes ago is worse than an empty one.
   */
  _syncMeal() {
    const pl = this.player;
    if (!pl || !pl.inventory) return;
    const food = this.progress.itemsIn('food');
    let best = null;
    for (const row of food) {
      if (!best || row.item.heal > best.item.heal) best = row;
    }
    this._meal = best ? best.item : null;
    pl.inventory.setMeal(best ? best.n : 0);
  }

  /** Eat the hotbar meal. Returns whether anything happened. */
  eatQuick() {
    if (!this._meal) return false;
    const item = this._meal;
    if (!this._eat(item)) {
      this.hud.toast('Not hurt enough to bother.', 1.4);
      return false;
    }
    this.hud.toast(`Ate the ${item.name.toLowerCase()}.`, 1.6);
    this.save();
    return true;
  }

  // ---------------------------------------------------------------- regions

  _region(player) {
    const R = regionAt(player.pos.x, player.pos.z, _scratch);
    if (R === this.region) return;
    const open = regionOpen(R, this.progress.slain);
    this.region = R;

    // Crossing the sky and the music over. Both damp rather than cut, so a
    // border is a couple of seconds of the weather changing round you.
    this.weather.set(R.weather || 'clear');
    this.ambience.set(R.music || 'calm');
    Audio.setRegionMood(R.music || 'calm');

    /**
     * A region only counts as SEEN if you were allowed in.
     *
     * Region weights overlap, so standing at the border of a sealed region
     * makes `regionAt` name it — and the main line asks whether regions have
     * been seen. Without this check, walking up to a sealed border would tick
     * off "reach the next region" without ever entering it.
     */
    const first = open && !this.progress.seen.has(R.id);
    if (open) this.progress.seen.add(R.id);
    else this._sealedSaid = null;
    // Walking somewhere for the first time is the commonest way a memory
    // surfaces, because the place itself is the thing that triggers it.
    this.progress.region = R.name || R.id;
    if (first) this.flash.fire('region', R.id, this.progress);

    const el = $('region-banner');
    if (el) {
      const name = $('rb-region'), blurb = $('rb-blurb');
      if (name) name.textContent = R.name;
      if (blurb) {
        blurb.textContent = open ? `Tier ${R.tier} · ${R.blurb}`
          : 'SEALED · ' + R.blurb;
      }
      el.classList.toggle('locked', !open);
      el.classList.add('show');
    }
    this.bannerT = 4.5;
    if (first) {
      // Seeing a place for the first time is worth something on its own —
      // it is what makes walking off the road a decision rather than a risk.
      const r = this.progress.addXp(60 + R.tier * 40);
      this._announceLevels(r);
      this.hud.toast(`${R.name} — ${R.blurb}`, 6);
      this.save();
      this._paintObjectives();
    }
  }

  _banner(dt) {
    if (this.bannerT <= 0) return;
    this.bannerT -= dt;
    if (this.bannerT > 0) return;
    const el = $('region-banner');
    if (el) el.classList.remove('show');
  }

  /**
   * Fog and sky, blended toward the region you are in.
   *
   * Damped rather than switched: a hard cut at a region border is the one
   * thing that makes a blended landscape look tiled. The Emberwaste's red
   * haze arrives over about two seconds of walking into it.
   */
  _sky(dt, player) {
    const R = this.region;
    if (!R) return;
    let S = R.sky || {};
    /**
     * EXCEPT OVER THE ASCENDED THRONE.
     *
     * The Ashen Throne is fog at thirty-four units under a slate sky, which
     * is right for the region and ruinous for a heavenly arena sitting in
     * the middle of it — white marble under an ash sky is grey concrete.
     * The blend runs over the last two hundred units of the approach, so
     * the light coming up is how the player is told the last fight is here.
     */
    if (this.throne) {
      const k = this.throne.insideness(player.pos.x, player.pos.z);
      if (k > 0.002) S = this.throne.skyBlend(S, k);
    }
    const fog = this.atmo.airFog;
    if (fog) {
      fog.near = damp(fog.near, S.fogNear === undefined ? 90 : S.fogNear, 1.2, dt);
      fog.far = damp(fog.far, S.fogFar === undefined ? 620 : S.fogFar, 1.2, dt);
      if (S.fogColor !== undefined) {
        _fogTarget.setHex(S.fogColor);
        fog.color.lerp(_fogTarget, clamp(dt * 1.2, 0, 1));
      }
    }
    if (this.atmo.skyMat) {
      const u = this.atmo.skyMat.uniforms;
      const lerpTo = (uni, hex, fallback) => {
        _fogTarget.setHex(hex === undefined ? fallback : hex);
        uni.value.lerp(_fogTarget, clamp(dt * 1.2, 0, 1));
      };
      lerpTo(u.uTop, S.skyTop, 0x2f7fd0);
      lerpTo(u.uMid, S.skyMid, 0x79bfee);
      lerpTo(u.uBottom, S.skyBottom, 0xcfe9f5);
    }
    if (this.atmo.sun) {
      this.atmo.sun.intensity = damp(this.atmo.sun.intensity,
        S.sunIntensity === undefined ? 1.0 : S.sunIntensity, 1.2, dt);
    }
    /**
     * The colour of the light, not just how much of it there is.
     *
     * Intensity alone made every region the same afternoon behind a different
     * pane of coloured glass. This grades the sun and the sky bounce toward
     * the region's mood as well, so the Emberwaste is lit orange from above
     * and red from below and the Frostmarch is lit blue-white from both.
     */
    this.ambience.grade(dt, this.atmo.sun, this.atmo.hemi);
  }

  // ------------------------------------------------------------- encounters

  _encounters(dt, player, onHit) {
    const px = player.pos.x, pz = player.pos.z;

    // Frogath is his own thing from start to finish.
    if (this.frogath) { this._updateFrogath(dt, player, onHit); return; }

    if (this.boss) {
      const e = this.bossOf;
      const d = Math.hypot(e.at.x - px, e.at.z - pz);
      /**
       * The killing blow is collected FIRST, before anything asks whether it
       * is alive.
       *
       * `takeDamage` is called from the player's own hit path, so by the time
       * this runs the guardian is already dead and `alive` is already false.
       * Checking `justDied` inside an `if (alive)` branch — which is what
       * this used to do — meant the payout never happened at all: no record,
       * no experience, no loot, and the main line could never advance.
       */
      if (this.boss.justDied) {
        this.boss.justDied = false;
        this._bossDown(e, player);
      }
      if (this.boss.alive) {
        if (d > DROP_AT) { this._dropBoss(); return; }
        // Inside the ring wakes it up. Only once — `begin` is idempotent but
        // the music sting is not.
        if (!this.boss.active && d < e.r + 8) {
          this.boss.begin();
          this.hud.showBossBar(this.boss.name, 1, this.boss.blurb);
          // The fight's music is picked by `_music` on the next frame, from
          // the guardian's own theme. All that is wanted here is the sting.
          Audio.cue(null);
          this._readiness(e);
        }
        this.boss.update(dt, player, onHit);
        if (this.boss.active) this.hud.setBossBar(this.boss.fraction);
        // A guardian at its last legs says so, once, without stopping.
        if (this.boss.active && this.boss.fraction < 0.14) {
          Cine.say('commander', 'No — not to you. Not again.',
            { id: 'glow:' + e.id, secs: 3.6 });
        }
      } else {
        // Let the body finish falling over, then tidy it away.
        this.boss.update(dt, player, onHit);
        this.deadFor = (this.deadFor || 0) + dt;
        if (this.deadFor > 5) this._dropBoss();
      }
      return;
    }

    /**
     * Nothing live. Frogath first, then the NEAREST guardian still standing.
     *
     * Nearest, not first in the table: the Ashen Throne holds Zehl and the
     * throne itself a hundred and twenty units apart, and taking whichever
     * the table listed first meant standing on the throne built Zehl —
     * so the message telling you why the seat is still guarded was
     * unreachable, and so was Frogath.
     */
    for (const e of this.encounters) {
      if (!e.final || this.progress.slain.has(e.id)) continue;
      if (!regionOpen(e.region, this.progress.slain)) continue;
      const d = Math.hypot(e.at.x - px, e.at.z - pz);
      if (d < e.r + 10) {
        this._maybeFrogath(e, d, player);
        if (this.frogath) return;
      }
    }
    let best = null, bestD = BUILD_AT;
    for (const e of this.encounters) {
      if (e.final || this.progress.slain.has(e.id)) continue;
      // A guardian inside a region you cannot walk into is not an encounter
      // yet. Building it would put a fight on the far side of a sealed
      // border, close enough to be shot at across it.
      if (!regionOpen(e.region, this.progress.slain)) continue;
      const d = Math.hypot(e.at.x - px, e.at.z - pz);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) this._buildBoss(best);
  }

  /**
   * How a region's tier becomes a place on the difficulty ladder.
   *
   * The first guardian anybody meets is on a farm in a tier-zero region and
   * its whole job is to teach what a telegraph is, so it stays an `elite`:
   * two phases, a soft guard, almost no dodging. The endgame regions get the
   * full treatment. See RANKS in dungeonboss.js for what each step buys.
   */
  static rankFor(tier) {
    if (tier <= 0) return 'elite';
    if (tier <= 2) return 'mini';
    if (tier <= 4) return 'major';
    return 'final';
  }

  _buildBoss(e) {
    _v.set(e.at.x, this.realm.heightAt(e.at.x, e.at.z), e.at.z);
    this.boss = new DungeonBoss(0, _v, this.scene, this.effects,
      this.realm.collision, {
        spec: e.spec,
        power: e.power,
        /**
         * A guardian's own rank beats the one its region implies.
         *
         * The ten optional mini-bosses along the first half of the road carry
         * `rank: 'mini'` in their spec, and they are standing in regions
         * whose tier would otherwise make them `major` — which would make the
         * side content harder than the story it is beside.
         */
        rank: (e.spec && e.spec.rank) || Overworld.rankFor(e.tier),
        arenaRadius: e.r,
        // So a ground wave can sweep thrown blades out of the air.
        kunai: this.kunai,
        groundAt: (x, z) => this.realm.heightAt(x, z),
        onPhase: (n, of, boss) => this._bossPhase(n, of, boss),
      });
    this.bossOf = e;
    this.deadFor = 0;
  }

  /**
   * A guardian has changed shape.
   *
   * The announcement is the point: a fight that silently gets harder reads as
   * the game cheating, and one that says so reads as a second round. The bar
   * is re-labelled so the phase is on screen for the rest of the fight.
   */
  _bossPhase(n, of, boss) {
    this.hud.showBossBar(`${boss.name}  ·  ${'◆'.repeat(n)}${'◇'.repeat(of - n)}`,
      boss.fraction, PHASE_LINES[Math.min(n - 2, PHASE_LINES.length - 1)]);
    this.hud.announce(n >= of ? 'NO MORE HOLDING BACK' : 'IT CHANGES',
      'divine', false);
    Audio.bossPhase(n);
    /**
     * AND THE GUARDIAN SAYS SOMETHING.
     *
     * On the banter channel, so the fight does not stop for a frame — it
     * appears low on the screen while the guardian is already winding up
     * whatever the new phase gave it. Which is the point: a boss that pauses
     * the battle to announce its second phase has told the player that
     * dialogue is an interruption.
     */
    const lines = GUARD_PHASE_LINES[Math.min(n - 2,
      GUARD_PHASE_LINES.length - 1)] || [];
    if (lines.length) {
      Cine.say('commander', lines[Math.floor(Math.random() * lines.length)],
        { id: `gphase${n}`, secs: 4.0, priority: 2 });
    }
  }

  /**
   * "AM I READY FOR THIS?", answered once, when you walk into the ring.
   *
   * The single most important thing about this is what it does NOT do: it
   * does not stop the fight, weaken the guardian, or ask for a confirmation.
   * The player walked in, the fight is on, and this is a line of text telling
   * them which side of the curve they are standing on so that walking back
   * out is an informed decision instead of a discovery.
   *
   * Said once per guardian per session. A warning repeated every time you
   * re-enter the ring after retreating is a warning you stop reading, and
   * retreating and coming back is exactly the loop this exists to support.
   */
  _readiness(e) {
    if (!e || this._warned.has(e.id)) return;
    this._warned.add(e.id);
    const want = e.wants || recommendedFor(e.id, e.tier);
    const r = readiness(this.progress.power, want);
    this.hud.toast(
      `${this.boss.name} — power ${want}, you are ${this.progress.power}. ${r.say}`,
      r.band === 'under' || r.band === 'far' ? 9 : 5);
    /**
     * And, for the two bands where it matters, say the other half out loud:
     * that leaving is allowed. A player who does not know a boss can be
     * walked away from will grind their head against it instead of going and
     * finding the sword that would have won it.
     */
    if (r.band === 'far' || r.band === 'under') {
      this.hud.announce('YOU CAN WALK AWAY FROM THIS', 'danger', false);
      this._pendingHint = 'Leave the ring and the fight resets. Come back'
        + ' with better gear — there is always something better out there.';
    }
  }

  _dropBoss() {
    if (this.boss) this.boss.dispose();
    this.boss = null;
    this.bossOf = null;
    this.deadFor = 0;
    this.hud.hideBossBar();
    Audio.stopBossMusic();
    Cine.clearBanter();
    // Said on the way OUT rather than on the way in: the player has just
    // retreated, which is the moment the advice is actually useful.
    if (this._pendingHint) {
      this.hud.toast(this._pendingHint, 8);
      this._pendingHint = null;
    }
  }

  /**
   * A guardian is down.
   *
   * Everything a kill pays out happens here, in one place: the record, the
   * experience, the loot, and the save. Guardians do not come back — the
   * whole main line is counted in how many of them are behind you.
   */
  _bossDown(e, player) {
    const p = this.progress;
    p.slain.add(e.id);
    const xp = Progress.xpFor(e.tier, true);
    const r = p.addXp(xp);
    this.hud.hideBossBar();
    Audio.stopBossMusic();
    this.hud.announce(`${this.boss.name} FALLS`, 'divine', false);
    /**
     * WHAT PUTTING ONE DOWN SHAKES LOOSE.
     *
     * Two chances at a memory: this particular guardian may have one of its
     * own — Arkos knew you, Grott had orders about you — and the COUNT may
     * have crossed a threshold, which is how the big revelations are paced
     * without caring which route through the country the player took.
     * Whichever fires first wins, and the other comes round again.
     */
    this._pendingMemory = [
      { kind: 'boss', key: e.id },
      { kind: 'count', key: p.slain.size },
    ];
    const said = [`${xp} experience.`];
    for (const it of rollLoot(e.tier, true)) {
      const g = GEAR_BY_ID.get(it.id);
      if (!g) continue;
      if (p.add(it.id, it.n) > 0) {
        said.push(`Taken: ${g.name}${it.n > 1 ? ` ×${it.n}` : ''}.`);
      }
    }
    /**
     * A guardian always leaves blades behind.
     *
     * Kunai are finite now, so a boss fight has to be able to REFILL as well
     * as cost — otherwise a player who spent forty of them learning a fight
     * is punished for having learned it. Scaled by tier, and generous: this
     * is the main resupply in the game.
     */
    const blades = this.giveKunai(10 + e.tier * 4, false);
    if (blades > 0) said.push(`✦ ${blades} kunai.`);
    this.hud.toast(said.join('  '), 7);
    /**
     * The world changes, and the player is told which part of it.
     *
     * This is the payoff for the boarded-up villages: killing the thing in
     * the next valley is what takes the planks off their doors, and being
     * told which village it was is what makes the kill feel like it landed
     * somewhere outside the arena.
     */
    for (const s of this.sites.setFreed(p.slain)) {
      this.hud.toast(`${s.name} is taking the boards down.`, 8);
    }
    this._announceLevels(r);
    this.economy.award(CFG.economy.roundWinReward * (1 + e.tier), 'GUARDIAN DOWN');
    this.applyStats();
    // Beating one heals you up. The next region is a long walk, and arriving
    // at it on four health is not a difficulty curve, it is a chore.
    player.health.revive();
    player.stamina.reset();
    this._paintObjectives();
    this.save();
  }

  /**
   * The last door.
   *
   * Zehl has to be down first. That is the only gate in the whole realm and
   * it is the story's: twelve guardians, then Zehl, then him. Walk up early
   * and the ground tells you so rather than nothing happening.
   */
  /**
   * FROGATH, TALKING THROUGH THE LAST FIGHT IN THE GAME.
   *
   * All of it on the banter channel: he never stops swinging to speak, and
   * the player never loses a frame of control to a line. Driven off what is
   * actually happening — his phase, his health, whether he has just been hit
   * — rather than off a timer, so the fight sounds like a conversation
   * between two frogs with a history instead of a playlist.
   */
  _frogathTalk(dt, f, player) {
    if (!f.fighting) return;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    // Phase lines, read off his own phase so any route into it gets one.
    if (f.phase !== this._fPhase) {
      if (this._fPhase !== undefined) {
        const lines = FROGATH_FINAL.phase[f.phase];
        if (lines) {
          Cine.say('frogath', pick(lines),
            { id: 'f-phase' + f.phase, secs: 4.6, priority: 2 });
        }
      }
      this._fPhase = f.phase;
    }
    // He notices the fight going either way.
    if (f.fraction < 0.55) {
      Cine.say('frogath', pick(FROGATH_FINAL.hit), { id: 'f-hit1', secs: 4.0 });
    }
    if (player.health.fraction < 0.4) {
      Cine.say('frogath', pick(FROGATH_FINAL.hurt), { id: 'f-hurt1', secs: 4.0 });
    }
    // And the last of it, in the version the player has earned.
    if (f.fraction < 0.12) {
      const low = FROGATH_FINAL.low[this._frogathKnows ? 'mem' : 'cold'];
      Cine.say('frogath', low[0], { id: 'f-low', secs: 4.6, priority: 2 });
      if (low[1]) Cine.say('frogath', low[1], { id: 'f-low2', secs: 4.6 });
      if (low[2]) Cine.say('frogath', low[2], { id: 'f-low3', secs: 4.6 });
    }
  }

  /**
   * ═══ THE CORONATION, AND THEN THE WALK ═══════════════════════════════════
   *
   * Called once, off the end of Frogath's last line. Two things happen:
   *
   *   the cutscene   staged through `flash.scene`, which is the flashback
   *                  machinery with the memory parts taken out — the wash
   *                  over the cut, the camera remembered and put back, and
   *                  `busy` so the world stands still. The tableau is
   *                  `coronation` in js/memoryscene.js.
   *
   *   the walk       when the dialogue finishes, the carpet is rolled out in
   *                  the arena, the player is put on the near end of it
   *                  facing down it, and their dash, grapple and sprint are
   *                  taken away until they reach the other end.
   *
   * `crowned` is set on progress the moment the ceremony starts rather than
   * when the walk ends, so a player who quits mid-procession still comes
   * back a king — and so every NPC in the country greets them as one. See
   * `_greetingFor` and js/quests.js.
   */
  _coronate() {
    const p = this.progress;
    if (p.crowned) return;
    p.crowned = true;
    this.save();
    if (!this.flash) return;
    const script = coronationScript(this.flash.stage, { name: 'MOSSFOOT' });
    const started = this.flash.scene({
      id: 'coronation',
      title: 'THE CORONATION',
      lines: script,
      theme: CORONATION_THEME,
      onEnd: () => this._beginCarpet(),
    });
    // No stage and no dialogue channel — a headless or reduced mode. The
    // walk still happens, because the crown is already on.
    if (!started) this._beginCarpet();
  }

  /**
   * ROLL IT OUT AND PUT THE PLAYER ON IT.
   *
   * The carpet is built with the arena and hidden; this shows it, moves the
   * player to its near end, points them down it and hands the lock to
   * `CarpetWalk`. If there is no arena — a save loaded straight into a
   * different mode, a test — nothing happens and the player keeps
   * everything, which is the correct failure.
   */
  _beginCarpet() {
    const t = this.throne;
    const pl = this.player;
    if (!t || !t.carpetFrom || !pl) return;
    t.showCarpet(true);
    pl.pos.set(t.carpetFrom.x, t.carpetFrom.y + 0.4, t.carpetFrom.z);
    pl.vel.set(0, 0, 0);
    // Facing down the carpet. `lookYaw` because a model's forward is
    // (-sin y, -cos y) and the carpet runs toward +Z, which is yaw pi.
    pl.visualYaw = lookYaw(t.carpetFrom.x, t.carpetFrom.z,
      t.carpetTo.x, t.carpetTo.z);
    pl.yaw = pl.visualYaw;
    if (this.followCam) this.followCam.snapTo(pl.pos);
    this.walk = new CarpetWalk({
      player: pl, hud: this.hud,
      from: t.carpetFrom, to: t.carpetTo,
      onEnd: () => {
        this.walk = null;
        this._paintObjectives();
        this.save();
      },
    });
  }

  _maybeFrogath(e, d, player) {
    if (d > e.r + 10) return;
    if (!this.progress.slain.has('zehl')) {
      if (!this._toldAboutZehl) {
        this._toldAboutZehl = true;
        this.hud.toast('The seat is guarded. Zehl, the Final Guardian, '
          + 'stands at the Throne Gate.', 7);
      }
      return;
    }
    _v.set(e.at.x, this.realm.heightAt(e.at.x, e.at.z), e.at.z);
    this.frogath = new Frogath(_v, this.scene, this.effects, this.hud,
      this.followCam, { speech: FROGATH_THRONE_SPEECH, name: 'FROGATH' });
    /**
     * THE HARDEST FIGHT IN THE GAME, and it has to actually be that.
     *
     * The dungeon Frogath's numbers were written for a player who has just
     * cleared fourteen rooms with nothing but what the dungeon gave them.
     * The player who walks up the marble here has a levelled character, a
     * full kit, the best gear in the realm and every ability unlocked, and
     * against them the dungeon numbers are a speed bump.
     *
     * So: FROGATH_FINAL_TUNING. Roughly double the health, and the two
     * dials turned the other way from the prologue —
     *
     *   rest 0.58   he attacks nearly twice as often, so there is no longer
     *               a free three-hit combo after every swing; you get one
     *               or two and then you have to move
     *   warn 0.80   the authored windups are a fifth shorter, but the
     *               `minWarning` floor in `_warn` is untouched, so no blow
     *               ever arrives without a readable telegraph
     *
     * That combination is deliberately the one that rewards the three things
     * the player has been doing all game — dash, hit, dodge — and punishes
     * standing still. It does not reward memorising an unreadable tell,
     * because there are none: every hitbox is still on screen for at least
     * 0.45 seconds before it can hurt anybody.
     */
    this.frogath.maxHealth = FROGATH_FINAL_TUNING.health;
    this.frogath.health = FROGATH_FINAL_TUNING.health;
    this.frogath.restScale = FROGATH_FINAL_TUNING.rest;
    this.frogath.warnScale = FROGATH_FINAL_TUNING.warn;
    this.frogathOf = e;
    this.frogath.begin(this._frogathTries > 0);
    this._frogathTries = (this._frogathTries || 0) + 1;
    this.hud.showBossBar('FROGATH, THE FIRST CROAK',
      1, 'He has been waiting the whole time.');
    /**
     * AND HE PICKS UP WHERE HE LEFT OFF.
     *
     * The bar says "he has been waiting the whole time", and this is the
     * line that makes that true: whichever of the two versions the player
     * has earned, it is a reply to a conversation they had in the first two
     * minutes of the game. See FROGATH_FINAL.
     */
    Cine.resetSaid();
    const knows = this.progress.memories.has('fell')
      || this.progress.memories.has('won');
    const open = FROGATH_FINAL.open[knows ? 'mem' : 'cold'];
    Cine.say('frogath', open[0], { id: 'f-open', secs: 5.0, priority: 3 });
    Cine.say('frogath', open[1], { id: 'f-open2', secs: 5.0, priority: 3 });
    this._frogathKnows = knows;
  }

  _updateFrogath(dt, player, onHit) {
    const f = this.frogath;
    f.update(dt, player, this.camera, onHit);
    this.hud.setBossBar(f.fraction);
    this._frogathTalk(dt, f, player);
    if (f.justDied) {
      f.justDied = false;
      const p = this.progress;
      p.slain.add('frogath');
      const r = p.addXp(Progress.xpFor(5, true) * 2);
      this._announceLevels(r);
      /**
       * The blade the game is named for, and it only ever comes from here.
       *
       * Equipped unconditionally rather than only when `add` reports a new
       * item: `equip` TOGGLES, so a second victory would have taken it back
       * out of your hand, and a save that already held it would never have
       * put it in.
       */
      p.add('frogshin', 1);
      if (!p.isEquipped('frogshin')) p.equip('frogshin');
      this.hud.toast('FROGSHIN is yours.', 10);
      this._pendingMemory = { kind: 'boss', key: 'frogath' };
      /**
       * AND THE OTHER END OF THE OPENING.
       *
       * The last conversation in the game, and it is deliberately the same
       * shape as the first: he goes down, the field goes quiet, he says the
       * line he said four years ago — and this time the player has the
       * answer. Then it names the thing the whole adventure has been about,
       * which is the one place in the story it is allowed to be said out
       * loud, because the player has now earned it.
       */
      Cine.clearBanter();
      const knew = this._frogathKnows;
      Cine.play([
        { wait: 1.6 },
        { face: 'frogath', text: '...So you have finally done it.' },
        { face: 'frogath', text: 'Again.' },
        { wait: 0.8 },
        knew
          ? { face: 'player', text: 'I remember the island. I remember all of it.' }
          : { face: 'player', text: 'I do not know what I have done. Only that it needed doing.' },
        { face: 'frogath', text: 'Four years I held that door on my own.' },
        { face: 'frogath', text: 'You are going to find out how heavy it is.' },
        { face: 'player', text: 'Then I will not hold it on my own.' },
        { wait: 0.9 },
        { face: 'frogath', text: '...No. I suppose you would not.' },
        { face: 'narrator', who: '', text: 'The banners come down all the way to the Lily Reach.' },
      ], {
        /**
         * AND STRAIGHT INTO THE CORONATION.
         *
         * Chained off the end of his last line rather than triggered by
         * anything the player does, because there is nothing left for them
         * to do: the fight is over, the country knows, and the next thing
         * that happens is a hall full of frogs. See js/coronation.js.
         */
        onEnd: () => { this._paintObjectives(); this.save(); this._coronate(); },
      });
      this.applyStats();
      this.hud.hideBossBar();
      this.hud.announce('THE FIRST CROAK FALLS', 'divine', true);
      this._paintObjectives();
      this.save();
    }
    /**
     * Leaving the throne takes him away with it.
     *
     * Alive, that means the fight resets — the same rule every guardian gets.
     * Dead, it just tidies up the body once you have walked off the dais.
     */
    const d = Math.hypot(this.frogathOf.at.x - player.pos.x,
      this.frogathOf.at.z - player.pos.z);
    if (d > (f.alive ? DROP_AT : 60)) {
      f.dispose();
      this.frogath = null;
      this.hud.hideBossBar();
      Audio.stopBossMusic();
    }
  }

  // ------------------------------------------------------------------ camps

  _camps(dt, player, onHit) {
    const px = player.pos.x, pz = player.pos.z;
    for (const c of this.camps) {
      const d = Math.hypot(c.at.x - px, c.at.z - pz);
      if (!c.live && d < CAMP_BUILD && !this.progress.camps.has(c.id)) c.spawn();
      else if (c.live && d > CAMP_DROP) { c.despawn(); continue; }
      if (!c.live) continue;
      c.update(dt, player, onHit);
      if (c.cleared && !this.progress.camps.has(c.id)) {
        this.progress.camps.add(c.id);
        const xp = Progress.xpFor(c.spec.tier, false) * c.spec.n;
        const r = this.progress.addXp(xp);
        this.hud.toast(`Camp cleared. ${xp} experience.`, 4);
        this._announceLevels(r);
        this._paintObjectives();
        this.save();
      }
    }
  }

  /** Every live thing the player can hit, in the shape combat expects. */
  targets() {
    const list = [];
    if (this.frogath && this.frogath.fighting) {
      list.push({
        id: 'frogath', pos: this.frogath.pos, dead: false, isDummy: false,
        hitbox: {
          bodyOffset: 3.0, bodyRadius: 5.0,
          headOffset: 8.0, headRadius: 2.6,
          vertical: 14,
        },
        onHit: (dmg, dx, dz, head, at, kind) =>
          this.frogath.takeDamage(dmg, { head, ranged: kind !== 'melee' }),
      });
    } else if (this.boss && this.boss.alive && this.boss.active) {
      const s = this.boss.scaleFactor;
      list.push({
        id: 'guardian', pos: this.boss.pos, dead: false, isDummy: false,
        hitbox: {
          bodyOffset: 2.0 * s, bodyRadius: 2.0 * s,
          headOffset: 3.6 * s, headRadius: 1.1 * s,
          vertical: 4.5 * s,
        },
        // The sixth argument names the weapon — see DungeonBoss.takeDamage.
        // Without it a guardian cannot tell a thrown kunai from a katana and
        // the whole guard, weak-point and punish-window layer does nothing.
        onHit: (dmg, dx, dz, head, at, kind) =>
          this.boss.takeDamage(dmg, { head, ranged: kind !== 'melee' }),
      });
    }
    for (const c of this.camps) {
      if (c.live) c.targets(list, (m) => this._mobDown(m));
    }
    /**
     * And the ropes holding up the spare beams at the broken crossings.
     *
     * They go through `targets` rather than through a mechanism of their
     * own so that a thrown kunai and a katana swing both reach them by the
     * one path everything else in the game uses. See Lashing in
     * js/traverse.js.
     */
    if (this.traverse) this.traverse.targets(list);
    return list;
  }

  _mobDown(mob) {
    if (mob.counted) return;
    mob.counted = true;
    const p = this.progress;
    const r = p.addXp(Progress.xpFor(mob.tier, false));
    for (const it of mob.loot()) p.add(it.id, it.n);
    /**
     * Some of them were carrying kunai.
     *
     * A little under half, one or two each. Clearing a camp is therefore a
     * way to restock — small, unreliable, and worth doing — which is what
     * keeps the wilderness between two bosses worth fighting through rather
     * than sneaking past on an empty pouch.
     */
    if (Math.random() < 0.42) this.giveKunai(1 + Math.floor(Math.random() * 2), false);
    this._announceLevels(r);
    this.applyStats();
    // Experience and loot, so it has to reach the disk — but a camp is six of
    // these in a few seconds, so it goes through the autosave rather than
    // writing the whole save six times.
    this.markDirty();
  }

  _announceLevels(r) {
    if (!r || !r.levels || !r.levels.length) return;
    const top = r.levels[r.levels.length - 1];
    this.hud.announce(`LEVEL ${top}`, 'divine', false);
    this.hud.toast(top % 3 === 0
      ? `Level ${top}. You feel a new heart start.`
      : `Level ${top}.`, 4);
    this.applyStats();
    // A level's worth of new max health should actually be in you.
    if (this.player) this.player.health.hp = this.player.health.max;
  }

  // ------------------------------------------------------------- interaction

  /**
   * What E does, here, now.
   *
   * One prompt and one key. The order is: a person to talk to, then a place
   * to examine — a villager standing inside their own village has to win, or
   * you would examine the huts at them.
   */
  _interact(player, input) {
    const px = player.pos.x, pz = player.pos.z;
    const npc = this.people.near(px, pz);
    /**
     * Who wins the E key when several things are in reach.
     *
     * A person, then a discovery, then a prop, then a place you have already
     * been. The discovery goes above the prop deliberately: a site is found
     * ONCE and the chest standing in it can be opened any time after, so
     * putting the chest first would let a chest placed near the middle of a
     * shrine hide the shrine's own moment permanently.
     */
    const here = npc ? null : this.sites.at(px, pz);
    const findable = here && (SECRETS[here.id] || here.landmark);
    const unfound = findable && !this.progress.found.has(here.id);
    const prop = (npc || unfound || !this.props) ? null : this.props.at(px, pz);
    const propSay = prop ? prop.promptFor(this.progress) : null;
    const site = (npc || propSay) ? null : here;
    // A site only offers a prompt when there is something in it to find.
    // Standing in a village is not an action; standing at the foot of a
    // hundred-metre statue is.
    const secret = (site && findable)
      ? (this.progress.found.has(site.id) ? 'again' : 'new') : null;

    this._npcHere = npc;
    this._siteHere = site;
    this._propHere = propSay ? prop : null;
    if (npc) this.prompt = `Talk to ${npc.spec.name}`;
    else if (propSay) this.prompt = propSay;
    else if (secret === 'new') this.prompt = `Examine ${site.name}`;
    else if (secret === 'again') this.prompt = site.name;
    else this.prompt = null;

    // The pickup prompt is already E-shaped screen furniture, so reusing it
    // means one prompt in one place rather than two that can both appear.
    this.hud.setPickupPrompt(!!this.prompt, this.prompt || '');

    /**
     * `player.interactPressed`, not `input.consume('KeyE')`.
     *
     * The player controller runs first and consumes E itself — for a supply
     * crate, of which there are none out here — so a second consume in this
     * file would never see the key and E would do nothing at all. The
     * controller already raises this one-shot flag for exactly this case (the
     * story's fruit stalls use it), so the overworld reads the flag and
     * clears it.
     */
    if (!player.interactPressed) return;
    player.interactPressed = false;
    if (!this.prompt) return;
    if (npc) this._talk(npc);
    else if (this._propHere) this._touch(this._propHere, player, input);
    else if (site) this._examine(site);
  }

  /**
   * Put a hand on something.
   *
   * The frog reaches out first and the prop starts moving second, so the two
   * animations overlap the way they would if the one were causing the other.
   * Nothing is granted here: the prop calls back on its own payoff beat, when
   * the lid is actually up. See `_propPay`.
   */
  _touch(prop, player, input) {
    const need = prop.blockedBy(this.progress);
    if (need) {
      const g = GEAR_BY_ID.get(need);
      this.hud.toast(`It will not move. ${g ? g.name : 'Something'} would.`, 5);
      Audio.parry(prop.pos);
      return;
    }
    if (prop.used) {
      // A carving can be read again. A chest cannot be looted again.
      const prize = prop.spec.prize;
      if (prize && prize.what === 'lore') {
        player.reachOut();
        this._read(prize.id, false);
        return;
      }
      this.hud.toast(prop.spec.usedLabel || 'Nothing left in it.', 3);
      return;
    }
    /**
     * A MARKET COUNTER OPENS, it does not pay out.
     *
     * The whole stock travels on the prop, so pressing E hands it to the
     * panel and nothing is charged until a lot is chosen in there. It is
     * checked before the affordability tests below because a counter has no
     * single price to check — that is the entire reason the panel exists.
     * See `_placeStalls` and js/stallui.js.
     */
    if (prop.spec.stall && this.stallui) {
      player.reachOut();
      prop.use();
      this.stallui.onBuy = (lot) => this._stallBuy(lot);
      this.stallui.open(prop.spec.stall, this.economy, this.progress);
      /**
       * Give the mouse back, exactly as the bag does. `Game._onLockChange`
       * asks `overworld.frozen` first, which is true from the moment `open`
       * is called above, so this does not drop the pause screen on top.
       */
      if (input) input.releaseLock();
      return;
    }
    /**
     * There is no affordability check here any more.
     *
     * A counter has no single price to check — six lots at six prices — so
     * saying no before the animation is not a thing this can do. The panel
     * greys out what you cannot pay for and `_stallBuy` refuses it with a
     * reason, which is a better answer than a toast anyway: it tells you how
     * short you are while you are still looking at the thing.
     */
    player.reachOut();
    if (!prop.use()) return;
    this.markDirty();
  }

  // ------------------------------------------------------ the quest-givers

  /**
   * WALKING INTO A VILLAGE IS HOW YOU GET WORK.
   *
   * The old arrangement was that quests existed on whichever frog happened to
   * be carrying them, and finding that frog was the player's problem: thirty
   * identical villagers, one of them with a small gold bang over their head,
   * in a town you have never been to. In practice people walked straight
   * through a settlement and out the other side without ever learning there
   * was anything there.
   *
   * So the village comes to you. Stand inside one for a moment and, if
   * somebody here has work you have not taken, THEY WALK OVER: the world
   * holds still, the camera turns to them, they cross the square, and the
   * conversation opens by itself. There is nothing to find and nothing to
   * miss.
   *
   * Once per visit — the flag is cleared when you leave the settlement — so
   * a town with three tasks in it greets you once, hands you one, and the
   * other two are ordinary frogs with beacons over them.
   */
  _greet(dt, player) {
    if (this.greeting) { this._runGreeting(dt, player); return; }
    // Never mid-fight, mid-panel or mid-anything-else.
    if (this.frozen || this.boss || this.frogath || player.health.dead) return;
    const s = this.sites.settlementAt(player.pos.x, player.pos.z);
    if (!s) { this._greetSite = null; this._greetIn = 0; return; }
    if (this._greetSite === s.id) return;
    this._greetIn = (this._greetIn || 0) + dt;
    // A moment inside, so walking across a corner of the map does not do it.
    if (this._greetIn < 1.0) return;
    this._greetSite = s.id;
    this._greetIn = 0;
    const npc = this._questGiverIn(s, player);
    if (npc) this._beginGreeting(npc, player);
  }

  /**
   * Somebody in this settlement with a quest the player has not taken.
   *
   * Nearest first, so in a city it is whoever you actually walked past. The
   * greeting is skipped for anyone already within talking distance: if you
   * are standing on top of them, walking them towards you is nonsense, and
   * the E prompt is already on screen.
   */
  _questGiverIn(site, player) {
    let best = null, bestD = Infinity;
    const reach = site.r * 1.3 + 20;
    for (const npc of this.people.list) {
      if (!npc.spec.gives || this.progress.quests.has(npc.spec.gives)) continue;
      if (this.people.markFor(npc, this.progress) !== 'give') continue;
      if (Math.hypot(npc.at.x - site.at.x, npc.at.z - site.at.z) > reach) continue;
      const d = Math.hypot(npc.at.x - player.pos.x, npc.at.z - player.pos.z);
      // Close enough to already be talking, or so far they would be walking
      // for twenty seconds.
      if (d < TALK_RANGE * 1.2 || d > 70) continue;
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }

  _beginGreeting(npc, player) {
    // Where they stop: a few paces in front of the player, on their side of
    // the gap, so the two of you end up facing each other.
    const dx = npc.at.x - player.pos.x, dz = npc.at.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const stop = {
      x: player.pos.x + (dx / d) * 3.4,
      z: player.pos.z + (dz / d) * 3.4,
    };
    this.people.script(npc, stop.x, stop.z, player.pos);
    this.greeting = { npc, t: 0, hailed: false };
    // The player is a spectator for the next few seconds: `cinematic` is the
    // flag the player and the camera already understand.
    player.cinematic = true;
    player.vel.x = 0;
    player.vel.z = 0;
    this.hud.toast(`${npc.spec.name} is coming over.`, 2.4);
    Audio.cue(null);
  }

  /**
   * One frame of the greeting.
   *
   * The camera is driven by hand here because `main` hands it over the moment
   * the player is `cinematic`: yaw damps round to look at whoever is walking
   * up, and the rig is still asked to update so the shot stays framed on the
   * player rather than freezing wherever it happened to be.
   */
  _runGreeting(dt, player) {
    const G = this.greeting;
    const npc = G.npc;
    // Dying mid-greeting hands control straight back. Anything else would
    // leave the player a cinematic spectator to their own corpse.
    if (player.health.dead) { this._endGreeting(); return; }
    G.t += dt;
    const dx = npc.at.x - player.pos.x, dz = npc.at.z - player.pos.z;
    // Both the camera and the player's own body measure yaw from -Z, so they
    // want the same angle — which is not the atan2 the NPCs use to face each
    // other, and getting those two confused points everybody backwards.
    const want = Math.atan2(-dx, -dz);
    if (this.followCam) {
      this.followCam.yaw = dampAngle(this.followCam.yaw, want, 3.2, dt);
      this.followCam.update(player.renderPos || player.pos, 0, dt, {});
    }
    player.visualYaw = dampAngle(player.visualYaw, want, 4, dt);
    // A word as they arrive, then the conversation itself — which is exactly
    // the conversation you would have had by walking up and pressing E, so
    // there is only one place quests are actually handed over.
    if ((npc.arrived || G.t > 9) && !G.hailed) {
      G.hailed = true;
      this._endGreeting();
      this._talk(npc);
    }
  }

  /** Hand control back and let the villager go about their day again. */
  _endGreeting() {
    const G = this.greeting;
    if (!G) return;
    this.greeting = null;
    this.people.clearScript(G.npc);
    if (this.player) this.player.cinematic = false;
  }

  /**
   * WHAT THE LOCALS SAY ABOUT THE ROAD BEING SHUT.
   *
   * A broken crossing within a few hundred units gets talked about by the
   * frogs who live near it — "That was the road between the kingdoms,
   * once", "The Wood Road is shut, windfall, a mile of it". It is the line
   * that turns an obstacle into a piece of local history, and it is the
   * reason a player arrives at the Old Mountain Route already knowing what
   * they are looking at.
   *
   * Not everybody, and always the SAME everybody: a hash of the speaker's
   * own id decides, so one villager in three mentions it and it is the same
   * one every time you come back. All of them saying it would read as a
   * notice board rather than as a village.
   */
  _crossingTalk(npc) {
    if (!this.traverse) return null;
    let best = null, bestD = 620;
    for (const s of this.traverse.sites) {
      if (!s.spec.said) continue;
      const d = Math.hypot(s.at.x - npc.at.x, s.at.z - npc.at.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return null;
    let h = 2166136261;
    const id = String(npc.spec.id || npc.spec.name || '');
    for (let i = 0; i < id.length; i++) {
      h = (h ^ id.charCodeAt(i)) * 16777619 >>> 0;
    }
    if (h % 3 !== 0) return null;
    return best.spec.said;
  }

  _talk(npc) {
    const p = this.progress;
    const lines = npcSays(npc.spec, p).slice();
    const road = this._crossingTalk(npc);
    if (road) lines.push(road);
    const turns = npc.spec.turns;
    const gives = npc.spec.gives;
    const q = turns ? QUEST_BY_ID.get(turns) : null;
    // Ready to be handed in? That is: everything before the final "hand it
    // in" stage is behind you, and it has not been handed in yet.
    const canTurn = q && p.quests.has(turns) && !p.questDone(turns)
      && questProgress(q, p) >= q.stages.length - 1;

    this.dialogue.start(npc.spec.name, lines, () => {
      if (canTurn) {
        p.finishQuest(turns);
        // Consume what the quest asked for, where it asked for a thing.
        this._takeQuestItems(turns);
        const said = [`${q.name} — done.`, ...grantReward(p, q)];
        this.applyStats();
        this._paintObjectives();
        this.save();
        this.dialogue.start(npc.spec.name, said);
        return;
      }
      if (gives && !p.quests.has(gives)) {
        p.startQuest(gives);
        /**
         * Accepting sets the stage to ONE, not zero.
         *
         * Two quests' first stage is literally "you have spoken to me", and
         * they test it as `questStage(id) > 0`. Leaving a new quest at stage
         * zero would leave those permanently on their first step no matter
         * what the player did.
         */
        p.advanceQuest(gives, 1);
        const gq = QUEST_BY_ID.get(gives);
        this._paintObjectives();
        this.save();
        if (gq) {
          this.hud.toast(gq.side ? `New task — ${gq.name}` : gq.name, 5);
        }
      }
    });
  }

  /** Quests that ask for materials take them when they are handed in. */
  _takeQuestItems(id) {
    const p = this.progress;
    const bill = {
      cutters: ['cut-stone', 5],
      gravekeeper: ['grave-salt', 6],
      coldhearth: ['ember-glass', 3],
      stilts: ['bell-clapper', 1],
    }[id];
    if (bill && p.has(bill[0], bill[1])) p.remove(bill[0], bill[1]);
  }

  /**
   * Examine a place.
   *
   * Only the ones with something to find say anything — and each of those is
   * found exactly once, which is what makes `found` a count of secrets rather
   * than a count of visits.
   */
  _examine(site) {
    const p = this.progress;
    const secret = SECRETS[site.id];
    // Some places are a memory. Queued behind whatever the place itself has
    // to say — see `_memory`.
    this._pendingMemory = { kind: 'site', key: site.id };
    /**
     * A landmark is its own kind of find.
     *
     * There is no hand-written secret for the twenty-four enormous things,
     * because what they give you is the fact that you now know where they
     * are — so this records them, pays for the walk, and reads their own
     * blurb back. They then show as found on the map, which is what makes
     * them navigation aids rather than scenery.
     */
    if (!secret && site.landmark) {
      const already = p.found.has(site.id);
      if (!already) {
        p.found.add(site.id);
        const R = REGIONS.find((r) => r.id === site.region);
        const r = p.addXp(120 + (R ? R.tier : 0) * 60);
        this._announceLevels(r);
        _v.copy(this.player.pos);
        _v.y += 1;
        this.effects.ring(_v, 1, 10, 0.9, 0xffd76b, true);
        Audio.refreshed(this.player.pos);
        this._paintObjectives();
        this.save();
      }
      this.dialogue.start(site.name,
        [site.blurb || 'You will be able to find your way back to this.']
          .concat(already ? [] : ['Marked on your map.']));
      return;
    }
    if (!secret) {
      this.hud.toast(site.blurb || site.name, 4);
      return;
    }
    if (p.found.has(site.id)) {
      this.dialogue.start(secret.title, secret.say);
      return;
    }
    p.found.add(site.id);
    const said = secret.say.slice();
    for (const it of secret.gives || []) {
      const g = GEAR_BY_ID.get(it.id);
      if (g && p.add(it.id, it.n) > 0) {
        said.push(`Taken: ${g.name}${it.n > 1 ? ` ×${it.n}` : ''}.`);
      }
    }
    if (secret.xp) {
      const r = p.addXp(secret.xp);
      said.push(`${secret.xp} experience.`);
      this._announceLevels(r);
    }
    _v.copy(this.player.pos);
    _v.y += 1;
    this.effects.ring(_v, 1, 8, 0.8, 0xffd76b, true);
    Audio.refreshed(this.player.pos);
    this.dialogue.start(secret.title, said);
    // A secret can hand over gear and food, so the numbers and the hotbar
    // both have to catch up.
    this.applyStats();
    this._paintObjectives();
    this.save();
  }

  /**
   * Fished out of a hole that is a long swim out of.
   *
   * Exactly one region declares a `pit` — the Sunderway, whose chasm is two
   * hundred units deep, flooded at the bottom and walled at seventeen units
   * of rise per metre. You can get out of it on your own, at both ends, and
   * the reachability test proves that; the rescue exists so that stepping off
   * the bridge costs a moment rather than four hundred units of swimming.
   *
   * A named exception rather than a general safety net, deliberately: a
   * general one would eventually teleport somebody out of a valley they were
   * perfectly happy exploring.
   */
  _pit(dt, player) {
    const P = this.region && this.region.pit;
    if (!P || player.pos.y > P.below) { this.pitT = 0; return; }
    this.pitT = (this.pitT || 0) + dt;
    if (this.pitT < 2.6) return;
    this.pitT = 0;
    const [x, z] = P.to;
    player.pos.set(x, this.realm.heightAt(x, z) + 1.4, z);
    player.vel.set(0, 0, 0);
    if (this.followCam) this.followCam.snapTo(player.pos);
    this.hud.toast('Somebody fished you out. Use the bridge.', 5);
    _v.copy(player.pos);
    _v.y += 1;
    this.effects.ring(_v, 1, 6, 0.6, 0x8fd8ff, true);
  }

  // ------------------------------------------------------------------ death

  /**
   * DYING IN A FIGHT PUTS YOU BACK OUTSIDE THAT FIGHT.
   *
   * Not at the last village. Losing to a guardian used to teleport you across
   * the region to somewhere with a roof, which turned every attempt at a boss
   * into a two-minute walk — the walk is not the difficulty, the guardian is.
   *
   * So: die with something live in front of you and you wake up a short way
   * off it, with the fight fully reset — the guardian back at its stone on
   * full health, the camp back on its feet. Die to anything else (a fall, a
   * hazard, drowning) and the old rule still applies: back to the last place
   * with a roof, because there is nothing to be put down beside.
   *
   * Everything you had, you keep. The realm's difficulty is in the fights.
   */
  _death(dt, player) {
    if (!player.health.dead) {
      this.deathT = 0;
      // Keep a note of the last safe place, so respawning has somewhere to go.
      const site = this.sites.at(player.pos.x, player.pos.z);
      if (site && (site.kind === 'village' || site.kind === 'shrine'
        || site.kind === 'camp')) {
        this.home = { x: site.at.x, y: site.at.y, z: site.at.z };
      }
      // And a note of what is currently trying to kill us, because by the
      // time the respawn runs it will have been thrown away.
      this._killer = this._liveFight(player);
      return;
    }
    this.deathT += dt;
    if (this.deathT < 3.2) return;
    this.deathT = 0;

    const fight = this._killer;
    this._killer = null;
    /**
     * Reset whatever it was.
     *
     * A guardian is DROPPED — the encounter rebuilds it at full health, back
     * at its own stone and asleep, when you walk into the ring again. A camp
     * is despawned, which does the same for its creatures. Neither is marked
     * cleared, so nothing is lost by dying.
     */
    if (this.boss) this._dropBoss();
    if (this.frogath) {
      this.frogath.dispose();
      this.frogath = null;
      this.hud.hideBossBar();
    }
    if (fight && fight.camp) fight.camp.despawn();

    const spot = fight ? this._retreatSpot(fight.at) : null;
    const h = spot || this.home || { x: 430, z: 1900 };
    player.pos.set(h.x, this.realm.heightAt(h.x, h.z) + 1.4, h.z);
    player.vel.set(0, 0, 0);
    player.health.revive();
    player.stamina.reset();
    if (this.followCam) this.followCam.snapTo(player.pos);
    this.hud.hideRespawn();
    this.realm.streamAround(h.x, h.z, true);
    if (this.scatter) this.scatter.streamAround(h.x, h.z, true);
    if (spot) {
      this.hud.toast(fight.name
        ? `${fight.name} is back on its feet. So are you.`
        : 'They are back on their feet. So are you.', 5);
    }
    this.save();
  }

  /**
   * What is currently fighting the player, or null.
   *
   * The guardian first, then Frogath, then the nearest camp with something
   * alive in it and close enough to have been the thing that did it. Forty
   * units is the outer edge of any camp's reach plus a margin — die further
   * off than that and whatever killed you was the landscape.
   */
  _liveFight(player) {
    const px = player.pos.x, pz = player.pos.z;
    if (this.frogath && this.frogath.alive && this.frogath.fighting) {
      return { at: this.frogath.pos, name: 'FROGATH' };
    }
    if (this.boss && this.boss.alive && this.boss.active) {
      return { at: { x: this.boss.pos.x, z: this.boss.pos.z }, name: this.boss.name };
    }
    let best = null, bestD = 40;
    for (const c of this.camps) {
      if (!c.live || c.cleared) continue;
      const d = Math.hypot(c.at.x - px, c.at.z - pz);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best ? { at: best.at, camp: best, name: null } : null;
  }

  /**
   * Standable ground about a dozen paces off something.
   *
   * Two rules and both matter. It has to be FAR enough that you are not
   * standing inside the thing you just lost to — RETREAT is a little over a
   * guardian's own reach — and it has to be ground the character controller
   * can actually stand on, or the respawn drops you inside a hillside.
   *
   * Sixteen bearings, nearest-to-your-corpse first so you reappear roughly
   * where you fell rather than on the far side of the arena, and each
   * candidate is put through `placeSpot`, which is the same search every
   * village and boss arena in the world was placed with. Nothing standable
   * anywhere on the ring hands back null and the caller falls through to the
   * last village — a bad respawn is worse than a long walk.
   */
  _retreatSpot(at) {
    const RETREAT = 14;
    const pl = this.player;
    const from = pl ? Math.atan2(pl.pos.x - at.x, pl.pos.z - at.z) : 0;
    const R = regionAt(at.x, at.z, _scratch);
    for (let i = 0; i < 16; i++) {
      // Alternate either side of the bearing we died on: 0, +1, -1, +2, -2...
      const step = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const a = from + step * (Math.PI * 2 / 16);
      const x = at.x + Math.sin(a) * RETREAT;
      const z = at.z + Math.cos(a) * RETREAT;
      const h = this.realm.heightAt(x, z);
      if (h < SEA + 1.0 && !(R && R.amphibious)) continue;
      if (this.realm._slopeAt(x, z) > 0.34) continue;
      return { x, z };
    }
    // Nothing on the ring: let the placement search look further out.
    const spot = this.realm.placeSpot(at.x, at.z, RETREAT, R, 0.34);
    if (!spot) return null;
    const d = Math.hypot(spot.x - at.x, spot.z - at.z);
    return d > 6 ? { x: spot.x, z: spot.z } : null;
  }

  // -------------------------------------------------------------------- HUD

  /**
   * The objectives panel, top-left.
   *
   * The id carries the TEXT, not just the row number. `HUD.setObjectives`
   * skips the rebuild when its key has not changed, and that key is built
   * from ids — so numbering the rows `q0..q3` would leave the first line
   * saying "Speak to Old Bram" for the rest of the game.
   */
  _paintObjectives() {
    const rows = Journal.objectives(this.progress).map((o, i) => ({
      id: `${i}:${o.text}`,
      text: o.sub ? `${o.text}  (${o.sub})` : o.text,
      done: o.done,
      active: i === 0,
    }));
    /**
     * WHAT THE PLAYER CURRENTLY THINKS IS GOING ON.
     *
     * One row at the bottom of the panel, and its text is the whole mystery
     * arc: it starts as a question about why they keep remembering things
     * they never did, and it ends as "you were the leader of the rebellion —
     * finish it". Shown as a row rather than as a toast so it is somewhere
     * the player can go and LOOK at it, which is what a slow reveal needs.
     */
    const stage = memoryStage(this.progress);
    if (stage) {
      rows.push({
        id: 'memory:' + stage,
        text: `${stage}   (${memoriesFound(this.progress)} of ${MEMORY_COUNT} `
          + 'memories)',
        done: false,
        active: false,
      });
    }
    this.hud.setObjectives(rows);
  }

  /** What the main line currently wants, for the HUD and the map. */
  get objective() { return mainObjective(this.progress); }

  /**
   * Which way the player is looking, for the arrow on the map.
   *
   * The CAMERA's yaw, not the frog's. The frog turns to face where it is
   * walking and snaps about during a dash or a swing; the camera is what the
   * player is actually pointing at the world, and it is what they mean when
   * they ask which way they are facing.
   */
  get facing() { return this.followCam ? this.followCam.yaw : 0; }

  // ---------------------------------------------------------------- teardown

  dispose() {
    this.save();
    this._unwatchUnload();
    if (this._savedWater !== null) CFG.world.waterLevel = this._savedWater;
    if (this.boss) this.boss.dispose();
    if (this.frogath) this.frogath.dispose();
    for (const c of this.camps) c.despawn();
    this.camps.length = 0;
    this.encounters.length = 0;
    if (this.life) this.life.dispose();
    if (this.people) this.people.dispose();
    if (this.sites) this.sites.dispose();
    if (this.wood) this.wood.dispose();
    if (this.throne) this.throne.dispose();
    // Cancelled, not just dropped: the walk holds a flag on the player that
    // takes their dash away, and a player who leaves the mode mid-procession
    // must not come back to a frog that cannot dash.
    if (this.walk) { this.walk.cancel(); this.walk = null; }
    if (this.props) this.props.dispose();
    this._levers.length = 0;
    this._gates.length = 0;
    if (this.scatter) this.scatter.dispose();
    if (this.weather) this.weather.dispose();
    if (this.ambience) this.ambience.dispose();
    // The module-level material caches. All are keyed rather than owned by an
    // instance, so nothing else will ever free them.
    disposeVillagerMats();
    disposeLandmarkMats();
    disposePropMats();
    Audio.stopRegionMusic();
    Audio.stopTheme();
    // A greeting caught mid-walk must not leave the player cinematic on the
    // way back to the menu, and a memory caught mid-sentence must not leave
    // its white wash over the main screen.
    this._endGreeting();
    this._greetSite = null;
    if (this.flash) this.flash.dispose();
    Cine.cancel();
    this.realm.dispose();
    this.dialogue.close();
    this.journal.closeAll();
    if (this.inventory) this.inventory.close();
    for (const id of ['region-banner', 'sealed']) {
      const el = $(id);
      if (el) el.classList.remove('show');
    }
    this.hud.setPickupPrompt(false, '');
    this.hud.setObjectives(null);
    this.hud.setMinimap(false);
  }
}
