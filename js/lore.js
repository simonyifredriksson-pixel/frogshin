/**
 * THE STORY, WRITTEN ON THINGS.
 *
 * The main quest tells you where to go. The people you meet tell you what is
 * happening this week. This file is the third layer and the one that actually
 * explains the country: twenty-eight carved stones, ledgers, grave markers
 * and half-burned books, each holding one piece of what Frogath did and why.
 *
 * ── it is deliberately out of order, and deliberately incomplete ──────────
 * Nobody sits you down at the start and explains the plot. Every entry is
 * ONE fragment, written by somebody who only knew part of it, and they are
 * scattered across the country roughly in the order a player will walk into
 * them — early ones in the south where the tiers are low, the ones that give
 * the whole thing away in the last regions. Read them all and you know what
 * happened. Read none of them and the main line still works, because the
 * quest log and the people never depend on any of this.
 *
 * `order` is what a reader is told they have found ("the fourth of twenty-
 * eight"), so a player who wants the story has a collection to complete and
 * a way of knowing they have missed some.
 *
 * ── the arc ───────────────────────────────────────────────────────────────
 *   1-6    the Croaklands as it was, and who Frogath used to be
 *   7-12   the Heart: what it is, why the seven kings split it
 *   13-18  the war, told from the losing side
 *   19-24  the guardians — where they came from and what each one holds shut
 *   25-28  what he is actually doing up there, and what it will cost to stop
 *
 * A guardian is never "a boss the game put here". Every one of them is in
 * these pages holding a specific thing: a pass, a bridge, a temple door, an
 * archive, a crown. That is what makes the progression world logic rather
 * than a lock — see the WHAT EACH ONE HOLDS entries.
 */

/**
 * @param id     stable key. Saved in `Progress.found`, so never change one.
 * @param site   which site it stands in. Props are placed off this.
 * @param kind   'stele' a carved stone, 'tome' a book on a lectern.
 * @param order  which of the twenty-eight it is, for the collection count.
 */
const L = (id, site, kind, order, title, lines) =>
  ({ id, site, kind, order, title, lines });

export const LORE = [
  // ─────────────────────────── 1-6: the country, and the frog ──────────────
  L('lore-mirefoot', 'mirefoot', 'stele', 1,
    'THE MIREFOOT STONE',
    ['Cut into the village stone, and somebody has scratched a date under it '
      + 'in a shaking hand.',
    '“MIREFOOT. Forty-one roofs. Founded in the reign of the sixth Anurath '
      + 'crown, by frogs who wanted a quiet place to be old in.”',
    'Under it, fresh: “ELEVEN DAYS AGO THEY CAME UP THE REED PATH. THEY TOOK '
      + 'EVERYONE WHO COULD WALK. THEY DID NOT LOOK FOR THE REST.”',
    'You were the rest.']),

  L('lore-seven', 'croakhollow', 'stele', 2,
    'THE SEVEN MARKS',
    ['A boundary stone, older than the village behind it. Seven marks cut '
      + 'round its top, and one of them has been chiselled out.',
    '“Here end the lands of the Lily Reach, first of the seven kingdoms of '
      + 'the Croaklands, and here begin the lands of the Harrowmead, second.”',
    'Seven kingdoms. Somebody has taken a chisel to the seventh mark and '
      + 'worked at it until there was nothing left to read.']),

  L('lore-warrior', 'harrowmead-town', 'tome', 3,
    'A REEVE’S LEDGER, TWELVE YEARS OLD',
    ['Left on a shelf in the town hall, still open at the page.',
    '“Tribute to the crown of Anurath, paid in full. Received by the '
      + 'crown’s own champion, who came for it himself rather than sending '
      + 'soldiers, and who ate with us and would not take the head of the '
      + 'table.”',
    '“He is a serious frog and an alarmingly good one. If the country is '
      + 'ever in trouble I would like him standing in front of it.”',
    'The name in the margin is FROGATH.']),

  L('lore-champion', 'stairfoot', 'stele', 4,
    'THE CHAMPION’S STONE',
    ['A victory stone at the foot of the stair, and it names one frog.',
    '“In the ninth year, at this place, the champion of Anurath held the '
      + 'stair alone against the things that came up out of the deep water, '
      + 'and did not step back once, and was still standing at dawn.”',
    '“Let it be said of him that he was the best of us.”',
    'Somebody has come back later and cut a single deeper line under that '
      + 'last sentence. Not crossed out. Underlined.']),

  L('lore-listening', 'listening-stone', 'stele', 5,
    'WHAT THE STONE IS FOR',
    ['The stone leans over a hole in the ground and the hole goes down a '
      + 'long way. There is writing round the lip of it.',
    '“Put your ear to it in the quiet part of the night and you will hear '
      + 'the country breathing.”',
    '“Do not answer it.”']),

  L('lore-mother', 'landmark:lilyreach', 'stele', 6,
    'UNDER THE MOTHER PAD',
    ['Cut into the root-stone of the great lily, in letters a foot high.',
    '“Nothing in the Croaklands grows this big on its own. Everything that '
      + 'does is growing on top of something.”',
    '“The old kings knew what was under this country. They built their '
      + 'seven capitals in a ring around it and agreed, in writing, never to '
      + 'dig.”']),

  // ─────────────────────────── 7-12: the Heart ─────────────────────────────
  L('lore-heart1', 'sunkenchapel', 'tome', 7,
    'THE CHAPEL BOOK',
    ['Swollen with water. Most of it is gone; two pages are legible.',
    '“…and the thing beneath is not a god and not a beast. It is a WILL '
      + 'without a body, and it has been under the Croaklands since before '
      + 'there was anybody here to be ruled by it.”',
    '“The kings called it the HEART, because that is the noise it makes.”']),

  L('lore-heart2', 'the-stilts', 'stele', 8,
    'THE FEN MARKER',
    ['A marker post, and the fen has been trying to swallow it for years.',
    '“The Heart does not want. It only ANSWERS. Ask it for water and it '
      + 'floods you. Ask it for strength and it takes the rest of you to '
      + 'pay for it.”',
    '“It cannot be used a little.”']),

  L('lore-heart3', 'roothome', 'tome', 9,
    'THE ROOTHOME ARCHIVE, SHELF THREE',
    ['A bound survey, meticulous, with a hand-drawn map folded into it.',
    '“The Heart lies under the middle of the country, and the seven crowns '
      + 'each held one KEY to it. Not one frog was ever permitted to hold '
      + 'two.”',
    '“Which is the whole arrangement. Seven keys, seven kingdoms, and the '
      + 'thing under us stays asleep because no one frog can reach it.”',
    'Someone has written in the margin, later: “SIX. He has six.”']),

  L('lore-heart4', 'anurath-city', 'stele', 10,
    'THE PALACE FORECOURT',
    ['A proclamation stone. The new text has been cut straight over the old, '
      + 'badly, in a hurry.',
    'Underneath, still readable in places: “…the crown of Anurath keeps its '
      + 'key in trust for the seven, and will surrender it to no frog, not '
      + 'even to a frog it loves…”',
    'Over the top: “THE SEVEN ARE ONE. THE ONE IS FROGATH.”']),

  L('lore-heart5', 'drowned-library', 'tome', 11,
    'THE DROWNED LIBRARY, LAST ENTRY',
    ['The only book on the shelf that is still a book.',
    '“He did not come here to conquer us. I want that written down, because '
      + 'everybody after me will assume he did.”',
    '“He came here to READ. He sat in this room for three days and found out '
      + 'where the sixth key was, and then he thanked me, and then he took '
      + 'the roof off the building so nobody else could.”']),

  L('lore-heart6', 'the-tooth', 'stele', 12,
    'THE TOOTH, INNER FACE',
    ['Cut on the inside of the temple wall, where you have to be standing in '
      + 'the dark to read it.',
    '“The Heart is half awake. We know this because the rivers have started '
      + 'running the wrong way in the spring, and because the old things in '
      + 'the ground have started standing up.”',
    '“It will finish waking when the seventh key is turned. Whoever wrote '
      + 'the arrangement was not stupid: the seventh was never given to a '
      + 'kingdom at all.”']),

  // ─────────────────────────── 13-18: the war ──────────────────────────────
  L('lore-war1', 'longfurrow', 'tome', 13,
    'A FARM ACCOUNT BOOK',
    ['Kept up to the day the soldiers came, and then not.',
    '“Spring: paid tribute. Summer: paid tribute twice, because the first '
      + 'lot never reached the capital and that is apparently our problem.”',
    '“Autumn: they have closed the Mead Way. A frog came out to explain '
      + 'that the roads belong to Frogath now, and that we should be '
      + 'grateful, because the roads are safer than they were.”',
    '“They are. He is what they are safer from.”']),

  L('lore-war2', 'stairhead-gate', 'stele', 14,
    'THE GATE ORDER',
    ['A bronze plate riveted over the old gate inscription.',
    '“BY ORDER. This gate is shut. No frog passes north without the word of '
      + 'Frogath. The gate-keeper does not negotiate and cannot be bribed, '
      + 'having no use for anything you have.”',
    'Somebody has scratched under it: “it is not a soldier. do not try to '
      + 'talk to it.”']),

  L('lore-war3', 'cutters-rest', 'stele', 15,
    'THE CUTTERS’ WALL',
    ['Names. Four hundred of them, cut small to fit, in six columns.',
    '“Taken from the Cutter’s Way in the third year of the closing. If you '
      + 'are reading this and you are looking for somebody, look here first '
      + 'and then stop looking.”',
    'The last column is unfinished. There is room left.']),

  L('lore-war4', 'burnt-village', 'stele', 16,
    'WHAT WAS EMBERFORD',
    ['A door lintel, propped upright by somebody who came back.',
    '“Emberford said no. Emberford is a chimney and a well now.”',
    '“There were nine villages that said no. He did not burn them for the '
      + 'saying. He burned them so that the tenth would not have to be '
      + 'asked.”',
    'Your village said no.']),

  L('lore-war5', 'throneless-hall', 'tome', 17,
    'A QUEEN’S LETTER, NEVER SENT',
    ['Folded four times and pushed into a crack in the dais.',
    '“He was here yesterday. He is still polite. That is the part nobody '
      + 'believes when I tell them — he asks, and he waits, and he thanks '
      + 'you, and then he takes it.”',
    '“I have given him a key. It is not mine. Mine is where he will not '
      + 'think to look, and if you are reading this then I did not get the '
      + 'chance to say where.”']),

  L('lore-war6', 'hollow-market', 'stele', 18,
    'THE LAST GATE, FROM THE INSIDE',
    ['Cut into the gatepost by somebody with a great deal of time.',
    '“We barred it from in here. Four hundred years ago, and the two of us '
      + 'who did it are still standing next to it, because that is what '
      + 'happens to a frog who swears an oath on a place.”',
    '“Nothing has come south through this gate since. That is not a boast. '
      + 'It is the only thing either of us has managed.”']),

  // ─────────────────── 19-24: the guardians, and what each holds ───────────
  L('lore-guard1', 'reedcaves', 'stele', 19,
    'THE OLD THINGS',
    ['Scratched, not carved — whoever did it had no tools.',
    '“They are not his soldiers. His soldiers are frogs in black and you can '
      + 'run from those.”',
    '“The big ones were already here. They were bound to places — a stair, a '
      + 'ford, a temple door — and they slept for four hundred years, and '
      + 'when the Heart turned over in its sleep they stood up.”',
    '“He did not make them. He just told them what to hold.”']),

  L('lore-guard2', 'choirhold', 'stele', 20,
    'THE CHOIR’S OWN ACCOUNT',
    ['Cut in a spiral, so you have to walk round the stone to read it.',
    '“Every one of them holds ONE thing shut, and none of them can be '
      + 'reasoned round, and none of them will follow you off it.”',
    '“So the road north is not a road. It is a list. Whatever is standing on '
      + 'the next thing you need, that is the next thing you fight.”']),

  L('lore-guard3', 'span-shrine', 'stele', 21,
    'THE WARDEN OF THE SPAN',
    ['A shrine to a bridge, which is a strange thing to build until you have '
      + 'seen the drop.',
    '“Arkos built the span. Arkos has never let one frog cross it, including '
      + 'the frog who paid for it.”',
    '“He is not holding it for Frogath. He is holding it because he built it '
      + 'and it is his, and Frogath was clever enough to simply let him.”']),

  L('lore-guard4', 'hoarfrost', 'tome', 22,
    'THE HOARFROST DUTY BOOK',
    ['A garrison log, the last thirty pages blank.',
    '“Day 1: relieved of the courtyard by something that came up through '
      + 'the flagstones. It has not moved since. We are told it is on our '
      + 'side.”',
    '“Day 9: it is not on our side. It is on the courtyard’s side. There is '
      + 'a difference and we are learning it.”',
    '“Day 12: we have moved the garrison to the outer wall. The courtyard '
      + 'can have the courtyard.”']),

  L('lore-guard5', 'undercity', 'tome', 23,
    'THE UNDERCITY SURVEY',
    ['A surveyor’s notes, still clipped to a board.',
    '“The Hollow King wore a crown once and has not been told the city is '
      + 'empty. He still holds court. He still expects to be announced.”',
    '“What he is holding shut is the archive under the throne room, and I '
      + 'believe he does not know that either. He is standing on the last '
      + 'complete account of the seven keys because it is where the throne '
      + 'happens to be.”']),

  L('lore-guard6', 'thronegate', 'stele', 24,
    'THE THRONE GATE',
    ['The last carving on the last gate before the ash.',
    '“Zehl was a frog. That is worth saying, because nothing about him is '
      + 'any more.”',
    '“He asked to be the door. Frogath let him. Whatever a frog is made of, '
      + 'Zehl has had most of it taken out and replaced with the idea of a '
      + 'door.”',
    '“He is the last one. There is nothing after him but the seat.”']),

  // ─────────────── 25-28: what he is doing, and what it costs ──────────────
  L('lore-end1', 'rimtemple', 'stele', 25,
    'THE RIM TEMPLE, ALTAR STONE',
    ['The altar has a hollow in it the exact shape of a key, and the hollow '
      + 'is empty.',
    '“Six turned. He keeps them on him; he does not trust a vault and he is '
      + 'right not to.”',
    '“The seventh was never given to a kingdom. It was given to the country '
      + 'itself, which is a poetic way of saying it was hidden, and the frogs '
      + 'who hid it made sure not one of them knew the whole road to it.”']),

  L('lore-end2', 'mirror-shrine', 'stele', 26,
    'THE MIRROR SHRINE',
    ['Two faces cut on one stone, back to back.',
    '“Ask what he wants and everyone tells you: to rule. He has ruled for '
      + 'four years and he has not enjoyed one day of it.”',
    '“What he wants is for there to be only ONE will in the Croaklands, '
      + 'because he has had a second one in his head since the day he '
      + 'touched the first key and he cannot get it out.”',
    '“He is not trying to own us. He is trying to stop being outnumbered.”']),

  L('lore-end3', 'buried-gate', 'stele', 27,
    'THE BURIED GATE',
    ['A door in the ground with no building on it. The writing is on the '
      + 'threshold, where you would step.',
    '“This is one of the ways down to it. There are seven. This one is '
      + 'filled in, and I filled it in, and I am not sorry.”',
    '“If he finishes waking it, the Heart will not conquer anybody. It will '
      + 'simply become the only thing in the country that is deciding, and '
      + 'the rest of us will go on walking about and doing as we are told '
      + 'and will not notice that we have stopped.”']),

  L('lore-end4', 'keep-arena', 'stele', 28,
    'THE LAST STONE',
    ['At the foot of the dais, and it is the newest carving in the country. '
      + 'The cuts are still sharp.',
    '“Whoever you are: it will talk to you next.”',
    '“It talks to whoever is strongest and it is very good at knowing who '
      + 'that is. It will offer you exactly the thing you came here about. '
      + 'It will offer you your village back.”',
    '“It can do that. That is the difficulty. — F.”']),
];

export const LORE_BY_ID = new Map(LORE.map((l) => [l.id, l]));
/** site id -> the entry standing in it, for placement. */
export const LORE_BY_SITE = new Map(LORE.map((l) => [l.site, l]));
export const LORE_COUNT = LORE.length;

/** How many of the twenty-eight this save has read. */
export function loreRead(progress) {
  let n = 0;
  for (const l of LORE) if (progress.found.has(l.id)) n++;
  return n;
}
