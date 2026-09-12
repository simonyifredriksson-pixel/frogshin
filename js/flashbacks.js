/**
 * FLASHBACKS — the story, handed back one piece at a time.
 *
 * The player lived the opening and then forgot it. Everything in this file
 * exists to give it back to them slowly, in the wrong order, out of the world
 * itself: a sword in a cave, a burnt village, an old battlefield, a commander
 * who greets them by a name they do not recognise.
 *
 * ── the rule this file is built on ───────────────────────────────────────
 * A flashback never explains. It shows one image and says one thing, and it
 * is always LESS than the player wants. The reveal is the player assembling
 * it, not the game announcing it — so the early memories are deliberately
 * ambiguous ("thousands of them, and every one waiting for you to speak") and
 * only the late ones name what happened.
 *
 * ── how one fires ────────────────────────────────────────────────────────
 * Every entry has a TRIGGER, which is a kind and a key:
 *
 *   region   walking into a region for the first time
 *   boss     a named guardian going down
 *   site     examining a particular place
 *   lore     reading a particular lore entry
 *   prop     touching a particular prop
 *   quest    finishing a particular quest
 *   power    the player's power crossing a number
 *   count    a number of guardians being down
 *
 * `Flashbacks.fire(kind, key, progress)` is called from wherever that thing
 * happens and returns the entry to play, or null. Nothing else in the game
 * needs to know the story exists — the overworld calls `fire` at six places
 * and this file decides everything.
 *
 * ── ordering ─────────────────────────────────────────────────────────────
 * `after` is a list of memory ids that must already be recovered. It is what
 * stops a player who happens to walk north early from getting the last
 * revelation as their first memory, without having to hard-code a route
 * through a world the whole point of which is that you choose your own.
 */

import { MEMORY_THEME } from './themes.js?v=v123';
import { Audio } from './audio.js?v=v123';
import { Cine } from './cinema.js?v=v123';
import { MemoryScene, STAGE } from './memoryscene.js?v=v123';

const $ = (id) => document.getElementById(id);

/**
 * THE MEMORIES.
 *
 * Read top to bottom, they are the story in the order it is meant to be
 * understood — but they are FOUND in whatever order the player explores, so
 * each one stands on its own. `title` is the line on the screen; `lines` is
 * the conversation; `note` is what the objective panel says afterwards.
 */
const M = (id, trig, key, o) => Object.assign({ id, trig, key }, o);

export const MEMORIES = [
  // ══ ACT ONE: something is wrong with you ══════════════════════════════
  /**
   * THE FIRST ONE, and it is the whole game in four lines.
   *
   * Fired by the stone in the glade the player wakes up in — see
   * `wakewood.js`. It arrives inside the first two minutes of play and it
   * is deliberately the biggest reveal of the early game, because a mystery
   * the player cannot NAME is not a mystery, it is confusion. They are told
   * "you were the Emperor" almost immediately, and then they spend the next
   * eight hours finding out what that meant and why nobody has one.
   */
  M('crown', 'prop', 'wakewood:stone', {
    title: 'ALL HAIL THE EMPEROR',
    after: [],
    lines: [
      { face: 'memory', text: 'Your hand touches the mark and the wood goes white.' },
      { face: 'memory', text: 'A hall. Thousands of frogs, shoulder to shoulder, all the way to the doors.' },
      { face: 'memory', text: 'Somebody is wearing royal plate and a crown you could not lift.' },
      { face: 'memory', text: 'Every frog in that hall goes down on one knee at the same moment.' },
      { face: 'soldier', text: 'ALL HAIL THE EMPEROR!' },
      { face: 'memory', text: 'The wood comes back. Birds. Water. Your own hands, empty.' },
      { face: 'player', text: '...That was me.' },
      { face: 'player', text: 'That was ME.' },
    ],
    note: 'A crowd kneeling, and a crown. You were the Emperor of this country.',
  }),
  M('ranks', 'region', 'harrowmead', {
    title: 'AN ARMY IN A CORNFIELD',
    after: [],
    lines: [
      { face: 'memory', text: 'Grain, and the smell of it — and then the field is full of frogs in armour.' },
      { face: 'memory', text: 'Rank on rank of them, all facing the same way. All facing you.' },
      { face: 'memory', text: 'Waiting. Every one of them waiting for you to say something.' },
      { face: 'player', text: 'They were waiting for ME to speak.' },
    ],
    note: 'An army standing in a field, waiting on your word.',
  }),
  M('blade', 'gear', '2', {
    title: 'A SWORD YOUR HANDS KNEW',
    after: [],
    lines: [
      { face: 'memory', text: 'Your hand closes on the grip and knows the weight of it exactly.' },
      { face: 'memory', text: 'The turn. The guard. Where the point wants to go.' },
      { face: 'memory', text: 'You have never seen this sword before in your life.' },
      { face: 'player', text: 'Somebody taught me this. Somebody good.' },
    ],
    note: 'Your hands know things you do not.',
  }),

  // ══ ACT TWO: Frogath was not the enemy ═══════════════════════════════
  /**
   * THE TURN OF THE WHOLE STORY.
   *
   * The player has spent hours being told Frogath is a monster. This is
   * where the game tells them he was their closest friend, and it is put on
   * the FIRST MAJOR BOSS so that it lands early enough to recolour
   * everything afterwards.
   */
  M('ally', 'boss', 'grott', {
    title: 'HE STOOD ON MY RIGHT',
    after: ['crown'],
    lines: [
      { face: 'memory', text: 'The gate-keeper falls, and something falls loose in your head with it.' },
      { face: 'memory', text: 'A younger frog in pale cloth, no crown, standing at your right shoulder.' },
      { face: 'memory', text: 'Laughing at something you have just said. Both of you filthy from a march.' },
      { face: 'frogathPure', text: 'I will hold your empire together until my last breath. You know that.' },
      { face: 'player', text: '...Frogath.' },
      { face: 'player', text: 'Frogath was my COMMANDER.' },
    ],
    note: 'Frogath was not your enemy. He was your closest commander.',
  }),
  M('statue', 'site', 'listening-stone', {
    title: 'THE FACE ON THE STONE',
    after: ['crown'],
    lines: [
      { face: 'memory', text: 'The carving is worn almost flat, but the shape of the head is right.' },
      { face: 'memory', text: 'The shoulders are right. The stance is right. The mark on the breast is YOURS.' },
      { face: 'elder', text: 'They cut that a long time ago, frog. Long before the banners came.' },
      { face: 'elder', text: 'It is meant to be the last Emperor. Nobody remembers his face.' },
      { face: 'elder', text: '...You have gone very quiet.' },
    ],
    note: 'They carve statues of you here. Nobody remembers your face.',
  }),
  M('throne', 'lore', 'lore-heart4', {
    title: 'THE ARTEFACT, AND WHAT I SAID ABOUT IT',
    after: ['ally'],
    lines: [
      { face: 'memory', text: 'A throne room. You are sitting in it. He is standing beside you.' },
      { face: 'memory', text: 'There is something on the table between you that hurts to look at.' },
      { face: 'frogathPure', text: 'That power should never be used. Not by you. Not by anyone.' },
      { face: 'player', text: 'If it can protect our people, we have to at least consider it.' },
      { face: 'memory', text: 'He looks at you for a long moment, and then he says nothing at all.' },
      { face: 'player', text: '...Did I do this?' },
      { face: 'player', text: 'Did I put that idea in his head?' },
    ],
    note: 'You told him to consider it. He warned you not to. You may have started this.',
  }),
  M('corrupt', 'lore', 'lore-end3', {
    title: 'WHAT IT DID TO HIM',
    after: ['throne'],
    lines: [
      { face: 'memory', text: 'He comes up from under the Ashen Throne with his hands shaking.' },
      { face: 'frogathPure', text: 'It is awake down there. It has been awake the whole time.' },
      { face: 'frogathPure', text: 'Somebody has to be strong enough to hold the door. Somebody has to.' },
      { face: 'memory', text: 'You told him not to go back down. You remember telling him not to.' },
      { face: 'memory', text: 'You remember him going back down anyway.' },
    ],
    note: 'He took the power to guard the country. It took him instead.',
  }),

  // ══ ACT THREE: the empire, and the rebellion ═════════════════════════
  M('capital', 'site', 'anurath-city', {
    title: 'THIS WAS MINE',
    after: ['crown'],
    lines: [
      { face: 'memory', text: 'You know the way through these streets without looking up.' },
      { face: 'memory', text: 'Which stair. Which arch. Which gate is always stuck in the wet.' },
      { face: 'memory', text: 'There are broken statues in the square and every one of them is you.' },
      { face: 'player', text: 'I ruled here.' },
      { face: 'player', text: 'And I could not hold it.' },
    ],
    note: 'Anurath was your capital. The statues in the square are you.',
  }),
  M('field', 'site', 'bonepit', {
    title: 'AN OLD BATTLEFIELD',
    after: ['ranks'],
    lines: [
      { face: 'memory', text: 'Spear shafts, all of them broken at the same height.' },
      { face: 'memory', text: 'You know what happened here without being told.' },
      { face: 'memory', text: 'You were standing about forty paces that way. Shouting.' },
      { face: 'player', text: 'We held. We held HERE.' },
    ],
    note: 'A battle you remember giving the orders at.',
  }),
  M('oath', 'count', '12', {
    title: 'WHAT I PROMISED THEM',
    after: ['crown', 'ally'],
    lines: [
      { face: 'memory', text: 'A hall full of frogs from every one of the seven kingdoms.' },
      { face: 'memory', text: 'Not kneeling this time. Arguing. Frightened. And looking at you.' },
      { face: 'player', text: 'He has taken the sky. So we take it back, and we do it before the winter.' },
      { face: 'memory', text: 'They shouted for a very long time.' },
      { face: 'memory', text: 'And you remember thinking: I have promised them something I may not be able to give.' },
    ],
    note: 'You did not just fight the rebellion. You called it.',
  }),
  M('name', 'power', '46', {
    title: 'WHAT THEY CALLED ME AT THE END',
    after: ['oath'],
    lines: [
      { face: 'soldier', text: 'Majesty — the left is holding. The LEFT IS HOLDING!' },
      { face: 'memory', text: 'You turn to answer, and the memory stops there. It always stops there.' },
      { face: 'player', text: 'Majesty.' },
      { face: 'player', text: 'By the end they were still calling me that. With no empire left to have.' },
    ],
    note: 'They kept the title long after the empire was gone.',
  }),
  M('bridge', 'boss', 'arkos', {
    title: 'THE WARDEN REMEMBERS ME',
    after: ['ally'],
    lines: [
      { face: 'commander', text: 'It IS you. You came over this span the first time as well.' },
      { face: 'memory', text: 'You remember the span. You remember it under a different sky.' },
      { face: 'commander', text: 'You went across with four hundred behind you, Majesty.' },
      { face: 'commander', text: 'Where are they now?' },
      { face: 'player', text: 'I do not know.' },
      { face: 'player', text: 'I am going to find out.' },
    ],
    note: 'Arkos fought you before, and he knew your title.',
  }),

  // ══ ACT FOUR: the island, and the fall ═══════════════════════════════
  M('island', 'count', '20', {
    title: 'ABOVE THE CLOUDS',
    after: ['oath'],
    lines: [
      { face: 'memory', text: 'An island. Waterfalls going off the edge of it into nothing at all.' },
      { face: 'memory', text: 'Two armies, and the whole width of the sky between them.' },
      { face: 'memory', text: 'You are at the front of one. Alone, in front of thousands.' },
      { face: 'memory', text: 'And there is a shape at the front of the other one that you know.' },
      { face: 'player', text: 'I have been up there. That was not a dream. I was UP THERE.' },
    ],
    note: 'A battlefield above the clouds — and you led one side of it.',
  }),
  M('won', 'count', '28', {
    title: 'I WON',
    after: ['island'],
    lines: [
      { face: 'memory', text: 'He is on one knee in front of you and the whole field has gone quiet.' },
      { face: 'frogath', text: '...So you have finally done it.' },
      { face: 'memory', text: 'You remember how it felt. You remember it being over.' },
      { face: 'player', text: 'I beat him. I had already beaten him.' },
    ],
    note: 'You did not lose that war. You had already won it.',
  }),
  M('fell', 'boss', 'zehl', {
    title: 'AND THEN I FELL',
    after: ['won'],
    lines: [
      { face: 'memory', text: 'He stands back up.' },
      { face: 'frogath', text: 'No. It has only begun.' },
      { face: 'memory', text: 'The sky turns over. The island gets smaller and smaller above you.' },
      { face: 'memory', text: 'You fall for a very long time, and somewhere in it you lose your name.' },
      { face: 'memory', text: 'And then a wood, and a stone with your own mark on it, and nothing else.' },
      { face: 'player', text: 'I remember. All of it. Every part of it.' },
      { face: 'player', text: 'I did not come back for a throne.' },
      { face: 'player', text: 'I came back to finish what I started.' },
    ],
    note: 'You are the Emperor of the Croaklands, and this war is not over.',
  }),
];

export const MEMORY_BY_ID = new Map(MEMORIES.map((m) => [m.id, m]));
export const MEMORY_COUNT = MEMORIES.length;

/** How many memories a save has recovered. */
export function memoriesFound(progress) {
  return progress && progress.memories ? progress.memories.size : 0;
}

/**
 * WHERE THE PLAYER THINKS THEY ARE IN THE STORY.
 *
 * Read by the objectives panel, so the one line of text under the main
 * objective changes as the truth comes out. This is the whole "the player
 * should question what happened" arc, as five strings.
 */
export function memoryStage(progress) {
  const has = (id) => progress.memories.has(id);
  // Read bottom-up: the last thing the player learned is what they are
  // currently thinking about.
  if (has('fell')) return 'You are the Emperor. Finish the war you already won.';
  if (has('won')) return 'You BEAT him up there. So how are you down here?';
  if (has('island')) return 'You have been above the clouds. You led one side of it.';
  if (has('oath') || has('name')) return 'You did not join the rebellion. You called it.';
  if (has('corrupt') || has('throne')) {
    return 'The power under the country took him. You may have pointed him at it.';
  }
  if (has('ally')) return 'Frogath was your commander. What happened to him?';
  if (has('crown')) return 'You were the Emperor of this country. Nobody knows you.';
  if (memoriesFound(progress) > 0) return 'Why do you keep remembering things you never did?';
  return '';
}

export class Flashbacks {
  /**
   * @param opts hud, onSave, and — for the cutscenes — scene and camera
   */
  constructor(opts = {}) {
    this.hud = opts.hud || null;
    this.onSave = opts.onSave || (() => {});
    this.wash = $('memory-wash');
    /** The one playing, or null. Nothing else may start while it is set. */
    this.live = null;
    this.t = 0;
    /** Set true while a memory owns the screen, read by the overworld. */
    this.busy = false;
    /**
     * THE STAGE THE MEMORIES ARE ACTED ON.
     *
     * Built lazily and only if a scene was given: a flashback with no
     * camera to drive still works, it is just the words. That fallback is
     * what keeps every existing test and every non-realm mode running
     * without having to know this exists.
     */
    this.camera = opts.camera || null;
    this.stage = opts.scene ? new MemoryScene(opts.scene) : null;
    /** Where the camera was before the memory took it. */
    this._camWas = null;
  }

  /**
   * Should this trigger fire a memory? If so, play it.
   *
   * @returns the entry that fired, or null
   */
  fire(kind, key, progress) {
    if (this.busy || !progress) return null;
    // The opening has to have happened. A player who skipped it — a save
    // carried over from before this existed — gets no flashbacks, because
    // remembering a scene you were never shown is not a reveal, it is a
    // non-sequitur.
    if (!progress.prologue) return null;
    const k = String(key);
    for (const m of MEMORIES) {
      if (m.trig !== kind) continue;
      if (progress.memories.has(m.id)) continue;
      if (!this._keyMatches(m, kind, k, progress)) continue;
      if ((m.after || []).some((id) => !progress.memories.has(id))) continue;
      this._play(m, progress);
      return m;
    }
    return null;
  }

  _keyMatches(m, kind, k, progress) {
    // `count`, `power` and `gear` are THRESHOLDS rather than names: the key
    // is a number and the memory fires the moment the player is past it.
    // Everything else is an exact id, which is what makes a memory belong to
    // one specific place in the world.
    if (kind === 'count') return progress.slain.size >= Number(m.key);
    if (kind === 'power' || kind === 'gear') return Number(k) >= Number(m.key);
    return m.key === k;
  }

  /**
   * PLAY ONE.
   *
   * The screen washes to white — not black; a flashback is something coming
   * back to you, and white reads as remembering where black reads as passing
   * out — the label comes up, and then the conversation runs over the wash.
   * The world behind it is frozen by whoever called us.
   */
  _play(m, progress) {
    this.busy = true;
    this.live = m;
    this.t = 0;
    progress.memories.add(m.id);
    this.onSave();

    /**
     * CUT TO THE SCENE, if there is one.
     *
     * This is the difference between a flashback and a subtitle. The camera
     * is taken over completely — its position is remembered so it can be
     * put back exactly — and the wash goes to `thin` rather than solid,
     * because the whole point is that the player can now SEE the memory
     * rather than being told about it over a white screen.
     */
    const acted = this.stage && this.camera && this.stage.begin(m.id);
    if (acted) {
      this._camWas = {
        pos: this.camera.position.clone(),
        quat: this.camera.quaternion.clone(),
      };
    }
    if (this.wash) {
      const label = this.wash.querySelector('.mw-label');
      if (label) label.textContent = m.title;
      this.wash.classList.add('show');
      // A solid wash over a scene would hide the scene. Thinned to a
      // wash you can see through, and taken off entirely once the first
      // line arrives — see `update`.
      this.wash.classList.toggle('thin', !!acted);
    }
    this._acted = !!acted;
    this._lifted = false;

    /**
     * Guarded, for the same reason `scene` is: `busy` is already set and the
     * camera already taken, and only the dialogue's ending hook gives them
     * back. A flashback that plays in silence is a small loss; one that
     * never starts is the world frozen for good.
     */
    try {
      Audio.stopTheme();
      Audio.setTheme(MEMORY_THEME, 'memory:' + m.id);
      Audio.cue(null);
      if (this.hud) this.hud.announce('MEMORY RECOVERED', 'divine', false);
    } catch (e) {
      console.warn('[frogshin] memory audio failed:', m.id, e && e.message);
    }
    /**
     * A beat before anybody speaks, so the title is read and the first
     * camera move has started — and a `next()` cue on every third line, so
     * the shot changes as the conversation goes on rather than one long
     * slow drift.
     */
    const script = [{ wait: acted ? 2.2 : 1.5 }];
    m.lines.forEach((l, i) => {
      const beat = Object.assign({}, l);
      if (acted && i > 0 && i % 3 === 0) {
        script.push({ wait: 0.35, act: () => this.stage.next() });
      }
      script.push(beat);
    });
    Cine.play(script, { bars: !!acted, onEnd: () => this._end() });
  }

  /**
   * PLAY A STAGED SCENE THAT IS NOT A MEMORY.
   *
   * Everything in `_play` except the parts that make it a memory: no entry
   * is added to `progress.memories`, no MEMORY RECOVERED banner, and the
   * script is taken as written instead of having camera cues sprinkled
   * through it — a scene with its own choreography wants to say where its
   * own cuts go.
   *
   * The reason it lives here rather than in a class of its own is that all
   * the awkward parts are already solved here: the wash that covers the cut
   * a mile into the sky, remembering the camera so the world comes back
   * exactly as it was, and the `busy` flag the overworld freezes on. There
   * is one caller — the coronation. See js/coronation.js.
   *
   * @param spec { id, title, lines, theme, note, onEnd }
   * @returns true if it started
   */
  scene(spec) {
    if (this.busy) return false;
    const acted = this.stage && this.camera && this.stage.begin(spec.id);
    if (!acted && !this.camera) {
      /**
       * No stage and no camera — a headless caller, or a mode that never
       * built one. The dialogue still runs, because the words are the part
       * that carries the story and a silent skip would lose the ending
       * entirely.
       */
      Cine.play(spec.lines, { bars: true, onEnd: spec.onEnd || (() => {}) });
      return true;
    }
    this.busy = true;
    this.live = { id: spec.id, title: spec.title, note: spec.note || '' };
    this.t = 0;
    if (acted) {
      this._camWas = {
        pos: this.camera.position.clone(),
        quat: this.camera.quaternion.clone(),
      };
    }
    if (this.wash) {
      const label = this.wash.querySelector('.mw-label');
      if (label) label.textContent = spec.title || '';
      this.wash.classList.add('show');
      this.wash.classList.toggle('thin', !!acted);
    }
    this._acted = !!acted;
    this._lifted = false;
    this._sceneEnd = spec.onEnd || null;
    /**
     * ═══ THE DRESSING IS GUARDED. THE DIALOGUE IS NOT OPTIONAL ═══════════
     *
     * Everything above this line has already taken something the player
     * needs back: `busy` freezes the world, the wash covers the screen and
     * the camera has been moved a mile into the sky. The ONLY thing that
     * gives all three back is `_end`, and the only thing that calls `_end`
     * is the dialogue finishing.
     *
     * So nothing between here and `Cine.play` is allowed to stop it being
     * reached. The music and the HUD are decoration; a scene that plays in
     * silence is a small disappointment, and a scene that never starts is
     * the end of the game locking up on a white screen.
     *
     * Which is exactly what happened: the coronation's theme was the wrong
     * shape, `audio.js` handed NaN to an `AudioParam`, and the TypeError
     * came out of this function between `busy = true` and `Cine.play`.
     * Nothing was left that could ever clear it.
     */
    try {
      Audio.stopTheme();
      if (spec.theme) Audio.setTheme(spec.theme, 'scene:' + spec.id);
      Audio.cue(null);
    } catch (e) {
      console.warn('[frogshin] scene audio failed:', spec.id, e && e.message);
    }
    Cine.play(spec.lines, { bars: true, onEnd: () => this._end() });
    return true;
  }

  _end() {
    if (this.wash) {
      this.wash.classList.remove('show');
      this.wash.classList.remove('thin');
    }
    // Put the camera back exactly where the world left it, so the player
    // comes out of a memory looking at what they were looking at.
    if (this.stage) this.stage.end();
    if (this._camWas && this.camera) {
      this.camera.position.copy(this._camWas.pos);
      this.camera.quaternion.copy(this._camWas.quat);
    }
    this._camWas = null;
    this._acted = false;
    this.busy = false;
    const m = this.live;
    this.live = null;
    Audio.stopTheme();
    if (this.hud && m && m.note) this.hud.toast(m.note, 6);
    /**
     * A staged scene's own ending hook, and it is called LAST.
     *
     * The coronation's hook puts the player down on a real carpet and takes
     * their abilities away, and both of those want the camera already
     * handed back and `busy` already false — otherwise the walk starts
     * inside a frame that still thinks a cutscene owns the screen.
     */
    const hook = this._sceneEnd;
    this._sceneEnd = null;
    if (hook) hook();
  }

  /** Drive the scene and the dialogue. Called every frame while `busy`. */
  update(dt, input) {
    if (!this.busy) return;
    this.t += dt;
    /**
     * The wash lifts once the scene has had a second to establish.
     *
     * It is there to cover the CUT — the frame where the camera jumps a
     * mile into the sky — and once that is past it is just in the way of
     * the thing the player is meant to be looking at.
     */
    if (this._acted && !this._lifted && this.t > 1.1) {
      this._lifted = true;
      if (this.wash) this.wash.classList.remove('show');
    }
    if (this.stage) this.stage.update(dt, this.camera);
    Cine.update(dt);
    Cine.keys(input);
  }

  /** Which tableau a memory is acted on, or null. For the tests. */
  static stageFor(id) { return STAGE[id] || null; }

  /** Abandon whatever is playing — used when the mode is left. */
  cancel() {
    if (!this.busy) return;
    Cine.cancel();
    this._end();
  }

  dispose() {
    this.cancel();
    if (this.stage) this.stage.dispose();
    this.stage = null;
  }
}
