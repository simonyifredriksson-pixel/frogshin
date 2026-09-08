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

import { MEMORY_THEME } from './themes.js?v=v88';
import { Audio } from './audio.js?v=v88';
import { Cine } from './cinema.js?v=v88';

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
  // ── the first three: something is wrong with you ──
  M('blade', 'gear', '2', {
    title: 'A SWORD YOU HAVE HELD BEFORE',
    after: [],
    lines: [
      { face: 'memory', text: 'Your hand closes on the grip and knows the weight of it.' },
      { face: 'memory', text: 'You have never seen this sword before in your life.' },
      { face: 'player', text: '...I have held this.' },
    ],
    note: 'A sword your hands already knew.',
  }),
  M('ranks', 'region', 'harrowmead', {
    title: 'THOUSANDS OF THEM',
    after: [],
    lines: [
      { face: 'memory', text: 'Grain, and the smell of it, and a field — but the field is full of frogs in armour.' },
      { face: 'memory', text: 'Rank on rank of them, all facing the same way. All facing you.' },
      { face: 'memory', text: 'Every one of them waiting for you to say something.' },
      { face: 'player', text: 'Waiting for me?' },
    ],
    note: 'A field of soldiers, waiting for someone to speak.',
  }),
  M('burnt', 'site', 'mirefoot', {
    title: 'THE MORNING AFTER',
    after: [],
    lines: [
      { face: 'memory', text: 'You have stood in this square with the roofs still burning.' },
      { face: 'memory', text: 'Black banners at the well. A pale eye on every one of them.' },
      { face: 'memory', text: 'You remember being angry in a way you have not been since.' },
    ],
    note: 'You were here the morning it burned.',
  }),

  // ── then: you were somebody ──
  M('statue', 'site', 'listening-stone', {
    title: 'THE FACE ON THE STONE',
    after: ['ranks'],
    lines: [
      { face: 'memory', text: 'The carving is worn almost flat, but the shape of the head is right.' },
      { face: 'memory', text: 'The set of the shoulders is right. The stance is right.' },
      { face: 'elder', text: 'They cut that four years ago, frog. Before the banners came.' },
      { face: 'elder', text: '...You have gone very quiet.' },
    ],
    note: 'A carving of somebody who stood the way you stand.',
  }),
  M('bridge', 'boss', 'arkos', {
    title: 'THE WARDEN, AGAIN',
    after: [],
    lines: [
      { face: 'commander', text: 'You. It IS you. You came over this span the first time too.' },
      { face: 'memory', text: 'You remember the span. You remember it under a different sky.' },
      { face: 'commander', text: 'You went across it with four hundred behind you. Where are they now?' },
      { face: 'player', text: 'I do not know.' },
    ],
    note: 'Arkos knew you. He fought you before.',
  }),
  M('field', 'site', 'bonepit', {
    title: 'AN OLD BATTLEFIELD',
    after: ['ranks'],
    lines: [
      { face: 'memory', text: 'Spear shafts, all of them broken at the same height.' },
      { face: 'memory', text: 'You know what happened here without being told.' },
      { face: 'memory', text: 'You were standing about forty paces that way, shouting.' },
      { face: 'player', text: 'We held. We held here.' },
    ],
    note: 'A battle you remember giving orders at.',
  }),

  // ── then: who you were fighting, and why ──
  M('banner', 'boss', 'grott', {
    title: 'THE GATE-KEEPER\'S ORDERS',
    after: ['burnt'],
    lines: [
      { face: 'memory', text: 'The gate-keeper had a name for you. It used it before it swung.' },
      { face: 'memory', text: 'Not your name. A title.' },
      { face: 'memory', text: 'Something that ended in "of the rebellion".' },
    ],
    note: 'It called you a title, not a name.',
  }),
  M('pure', 'lore', 'lore-warrior', {
    title: 'HE WAS NOT ALWAYS THIS',
    after: ['burnt'],
    lines: [
      { face: 'memory', text: 'A green frog in pale cloth, on a step, laughing at something you said.' },
      { face: 'memory', text: 'The same jaw. The same eyes. No crown.' },
      { face: 'frogathPure', text: 'You worry too much. Nothing under this country can get out.' },
      { face: 'player', text: '...Frogath.' },
    ],
    note: 'Frogath, before the crown. You knew him.',
  }),
  M('door', 'lore', 'lore-end3', {
    title: 'WHAT HE MEANT BY THE DOOR',
    after: ['pure'],
    lines: [
      { face: 'memory', text: 'He came back up from under the Ashen Throne with his hands shaking.' },
      { face: 'frogathPure', text: 'Somebody has to hold it shut. It has to be somebody strong.' },
      { face: 'memory', text: 'You told him not to. You remember telling him not to.' },
    ],
    note: 'He went under the throne, and something came back with him.',
  }),

  // ── then: you led it ──
  M('oath', 'count', '12', {
    title: 'WHAT YOU PROMISED THEM',
    after: ['ranks', 'field'],
    lines: [
      { face: 'memory', text: 'A hall full of frogs from every region, and you at the end of it.' },
      { face: 'player', text: 'Then we take the sky from him, and we do it before the winter.' },
      { face: 'memory', text: 'They shouted for a long time.' },
      { face: 'memory', text: 'You remember thinking: I have just promised them something I cannot give.' },
    ],
    note: 'You promised them the sky. Twelve regions of them.',
  }),
  M('name', 'power', '46', {
    title: 'THEY KNEW WHAT TO CALL YOU',
    after: ['oath'],
    lines: [
      { face: 'soldier', text: 'Commander — the left is holding. The LEFT is holding!' },
      { face: 'memory', text: 'You turn to answer and the memory stops there, every time.' },
      { face: 'player', text: 'Commander.' },
    ],
    note: 'Commander. That was the word.',
  }),
  M('island', 'count', '20', {
    title: 'ABOVE THE CLOUDS',
    after: ['oath'],
    lines: [
      { face: 'memory', text: 'An island. Waterfalls going off the edge of it into nothing.' },
      { face: 'memory', text: 'Two armies, and the whole width of the sky between them.' },
      { face: 'memory', text: 'You are at the front of one of them. You are ALONE at the front of one of them.' },
      { face: 'player', text: 'I have been there. I have been up there.' },
    ],
    note: 'A battlefield above the clouds. You stood at the front of it.',
  }),

  // ── and finally: you won, and then you lost ──
  M('won', 'count', '28', {
    title: 'YOU WON',
    after: ['island'],
    lines: [
      { face: 'memory', text: 'He is on one knee in front of you and the field has gone quiet.' },
      { face: 'frogath', text: '...So you have finally done it.' },
      { face: 'memory', text: 'You remember how it felt. You remember it being over.' },
    ],
    note: 'You beat him. You had already beaten him.',
  }),
  M('fell', 'boss', 'zehl', {
    title: 'AND THEN YOU FELL',
    after: ['won'],
    lines: [
      { face: 'memory', text: 'He stands up.' },
      { face: 'frogath', text: 'No. It has only begun.' },
      { face: 'memory', text: 'The sky turns over. The island gets smaller and smaller above you.' },
      { face: 'memory', text: 'You fall for a very long time.' },
      { face: 'player', text: 'That is why I am here.' },
      { face: 'player', text: 'I have to finish what I started.' },
    ],
    note: 'He put you off the island. THIS is the fight you came back for.',
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
  if (has('fell')) return 'You were the leader of the rebellion. Finish it.';
  if (has('island') || has('won')) return 'You have fought Frogath before. Above the clouds.';
  if (has('oath') || has('name')) return 'You led them. You promised them something.';
  if (has('pure') || has('door')) return 'Frogath was not always this. Something changed him.';
  if (memoriesFound(progress) > 0) return 'Why do you keep remembering things you never did?';
  return '';
}

export class Flashbacks {
  /**
   * @param opts hud, progress, onSave
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
    if (this.wash) {
      const label = this.wash.querySelector('.mw-label');
      if (label) label.textContent = m.title;
      this.wash.classList.add('show');
    }
    Audio.stopTheme();
    Audio.setTheme(MEMORY_THEME, 'memory:' + m.id);
    Audio.cue(null);
    if (this.hud) this.hud.announce('MEMORY RECOVERED', 'divine', false);
    // A beat of white before anybody speaks, so the label is read.
    const script = [{ wait: 1.5 }].concat(m.lines.map((l) => Object.assign({}, l)));
    Cine.play(script, {
      bars: false,
      onEnd: () => this._end(),
    });
  }

  _end() {
    if (this.wash) this.wash.classList.remove('show');
    this.busy = false;
    const m = this.live;
    this.live = null;
    Audio.stopTheme();
    if (this.hud && m) this.hud.toast(m.note, 6);
  }

  /** Drive the dialogue. Called every frame while `busy`. */
  update(dt, input) {
    if (!this.busy) return;
    Cine.update(dt);
    Cine.keys(input);
  }

  /** Abandon whatever is playing — used when the mode is left. */
  cancel() {
    if (!this.busy) return;
    Cine.cancel();
    this._end();
  }
}
