/**
 * WHAT IS ON THE STALLS.
 *
 * Every market stall in the country sells one thing, and no two stalls beside
 * each other sell the same thing. Walk down a row in Anurath and it is a
 * grocer, then a smith, then somebody with dried reeds and dye — which is
 * what makes a market worth walking down rather than a place with a shop in
 * it.
 *
 * ── one stall, one trade, several things on it ──────────────────────────
 * A stall has a TRADE — it is a grocer, or a smith, or somebody with dried
 * reeds and dye — and under that trade it has three to six lots laid out.
 * Pressing E opens the counter (see js/stallui.js) and you look along it,
 * with the name, the icon, what it does and what it costs, and buy as many
 * as you can afford.
 *
 * The first version offered exactly one lot per stall on the E prompt and no
 * panel at all, on the theory that a menu is a thing you read instead of a
 * market you walk through. That was the wrong trade-off: you could not see
 * what a weapon DID before paying three hundred froglets for it, which for
 * the one purchase in the game that matters is not a decision, it is a
 * gamble. Variety still comes from there being eleven stalls; the panel is
 * so that the eleventh is worth the walk.
 *
 * ── and it is the same stall tomorrow ───────────────────────────────────
 * What a stall stocks is a pure function of where it stands, so the fruit
 * stall by the well in Croakhollow is the fruit stall by the well every time
 * you load the game and on every machine. That matters more than it sounds:
 * a player who finds an armourer in a town they can reach is entitled to go
 * back for the other half of the set, and to find the same blade on the
 * smith's rack after going away to earn what it costs.
 *
 * ── and the Hollow Market ───────────────────────────────────────────────
 * Every stall in the country can be bought from, including the fifty-seven
 * in the Hollow Market, where there is nobody behind any of them. That
 * place's own blurb says how it works: "Stalls, awnings, PRICES CHALKED UP.
 * Nobody." So you read the board, take what you want and leave the coins on
 * the counter. Nothing comes over to serve you and nothing says thank you —
 * which is a good deal more unsettling than a stall you cannot use, and it
 * costs the player nothing to find out.
 */

import { gearOfTier, GEAR_BY_ID } from './gear.js?v=v119';
import { mulberry32 } from './util.js?v=v119';

/** How many blades a blade-seller sells at once. */
export const KUNAI_LOT = 5;

/**
 * ═══ WHAT A MARKET WILL NOT STOCK ═══════════════════════════════════════
 *
 * A ceiling on the unit value of everyday goods, by category.
 *
 * Without it a herbalist in the Hollow City offered four Shards of the First
 * for 1,144 froglets, because the shard is a `material` and the material
 * pool at tier 5 is topped by the rarest object in the game. It is a boss
 * drop and a quest item; it is not four of something you buy off a table
 * beside the dried reeds.
 *
 * Weapons and armour have no ceiling — a smith at the top of the game should
 * have the best blade in the region on the rack, and paying for it is the
 * point of the smith.
 */
const CEILING = { material: 60, food: 170 };

/**
 * THE TRADES.
 *
 *   cat     which gear category it stocks; null means it sells kunai
 *   lot     how many of the item make up one purchase
 *   markup  what the keeper puts on the item's own `value`
 *   goods   the colour of what is piled on the counter, so a stall can be
 *           told apart from across the square before you can read anything
 *   at      how the E prompt names it. A separate field from `sign` because
 *           the sign is a shop board and the prompt is a sentence: built out
 *           of the sign it read "Look at the THE SMITH stall"
 *
 * ── on the markups ─────────────────────────────────────────────────────
 * They are LOW, and they have to be. Froglets in Story Mode come from one
 * source — a hundred per guardian per tier, and nothing else pays them at
 * all — so the whole country's purse over a playthrough is a few thousand.
 * Priced at half again over value, as the first pass had them, a tier-2
 * sabre cost more than every guardian in the south put together.
 *
 * So: food and materials are pocket money, at or barely over value, because
 * they are the healing economy and want to be bought without thinking about
 * it. Equipment carries a real but payable margin. Blades are untouched.
 */
export const TRADES = [
  {
    /**
     * FIRST IN THE LIST, and that is load-bearing: `tradeFor` gives index 0
     * to the blade-seller at every market, so every town, city and tree
     * village in the country has somewhere to buy kunai. It is the only
     * reliable supply there is, and it was a promise the world made before
     * this file existed — see PROP_PLAN in js/overworld.js.
     */
    id: 'blades', sign: 'BLADES', cat: null, lot: KUNAI_LOT, markup: 1,
    keeper: 'The blade-seller', goods: 0xb8c0c8, at: 'the blade stall',
    line: 'Five, and they are straight. Sharpened this morning.',
  },
  {
    id: 'produce', sign: 'PRODUCE', cat: 'food', lot: 3, markup: 1.05,
    keeper: 'The grocer', goods: 0x8fbf4a, at: 'the produce stall',
    line: 'Picked this morning. Most of it.',
  },
  {
    id: 'smith', sign: 'THE SMITH', cat: 'weapon', lot: 1, markup: 1.15,
    keeper: 'The smith', goods: 0x9aa3ad, at: "the smith's stall",
    line: 'It will hold an edge. It had better, at that price.',
  },
  {
    id: 'armourer', sign: 'ARMOUR', cat: 'armour', lot: 1, markup: 1.15,
    keeper: 'The armourer', goods: 0x7a6a4a, at: "the armourer's stall",
    line: 'Padded through. You will want padding.',
  },
  {
    id: 'herbs', sign: 'HERBS & DYE', cat: 'material', lot: 4, markup: 1.05,
    keeper: 'The herbalist', goods: 0x5f8f3a, at: 'the herb stall',
    line: 'Cut fresh and dried slow. Keeps a year.',
  },
  {
    /**
     * THE ONE THAT SELLS ABOVE ITS STATION.
     *
     * Stock a tier above where it is standing, at nearly twice value — so
     * the curio stall in a tier-1 town has tier-2 equipment on it, dear
     * enough to be a decision and cheap enough to be possible. It is the
     * only way to get ahead of the region you are in without going into it.
     */
    id: 'curios', sign: 'CURIOS', cat: null, deep: 1, lot: 1, markup: 1.8,
    keeper: 'The dealer', goods: 0xc9a227, at: 'the curio stall',
    line: 'Came off a courier who did not need it any more.',
  },
];

export const TRADE_BY_ID = new Map(TRADES.map((t) => [t.id, t]));

/**
 * WHICH TRADE THE Nth STALL IN A MARKET IS.
 *
 * Index 0 is always blades — see the note on that entry. The rest walk the
 * list from an offset given by the SETTLEMENT's seed, so every market has a
 * different arrangement and a row of nine reads as a row of nine different
 * trades rather than as a shuffle.
 *
 * `seed` MUST be the settlement's, not the stall's. Seeded per stall it is
 * not a walk at all, it is an independent draw per counter, and independent
 * draws clump: the first pass did exactly that and Anurath came out with two
 * herbalists side by side and no armourer at all in a nine-stall market.
 */
export function tradeFor(index, seed) {
  if (index <= 0) return TRADES[0];
  const rest = TRADES.length - 1;
  return TRADES[1 + ((index - 1 + (seed % rest)) % rest)];
}

/**
 * ═══ THE PRICE OF ONE LOT ═══════════════════════════════════════════════
 *
 * The item's own `value`, times how many are in the lot, times what the
 * keeper puts on it. One function, so no two places in the file can disagree
 * about what a thing costs — and they did: the counter list and the one-line
 * offer it replaced each had their own copy of this arithmetic.
 */
function priceOf(item, n, markup) {
  return Math.max(2, Math.ceil(item.value * n * markup));
}

/**
 * ═══ EVERYTHING LAID OUT ON ONE COUNTER ═════════════════════════════════
 *
 * Three to six lots in the stall's own trade, cheapest first. This is what
 * the panel shows, and it is the only thing in this file the game asks for.
 *
 * A blade-seller's counter is kunai first and then a couple of the cheapest
 * things a knife-seller would also have on it, because a stall with one row
 * on it is a vending machine.
 *
 * THE LIST IS A FUNCTION OF THE SEED and nothing else, so a counter holds
 * the same goods at the same prices every time you walk up to it, on every
 * load and every machine. A shop whose stock reshuffles while you go away
 * and find the money for something is not a shop.
 *
 * @returns [{ item, n, price, kunai, name }]
 */
export function stockOf(trade, tier, seed) {
  const rnd = mulberry32((seed ^ 0x27d4eb2f) >>> 0);
  const out = [];
  const seen = new Set();
  const push = (item, lot, markup) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    const n = Math.min(lot, item.stack || 1);
    out.push({
      item, n, kunai: false, price: priceOf(item, n, markup),
      name: `${n > 1 ? `${n} × ` : ''}${item.name}`,
    });
  };

  /**
   * EVERYTHING IN A CATEGORY THIS COUNTER COULD PLAUSIBLY HAVE.
   *
   * Four tiers wide — its own, the one above, and two below — because the
   * pools per tier per category are three or four items and a counter drawn
   * from one of them has nothing to choose between. Ceilings applied here,
   * so a treasure never reaches the shuffle.
   */
  const poolOf = (cat, base, deep) => {
    const out2 = [];
    /**
     * A DEALER LOOKS UP, NOT DOWN.
     *
     * `deep` trades stock a tier above where they stand, and the point of
     * them is being the only way to get ahead of the region you are in. Given
     * the wide four-tier pool the dealer's counter came out 57% at or BELOW
     * the region it was standing in — which is not a curio stall, it is a
     * second grocer with delusions. So it looks at its own tier and the one
     * above, and only reaches down if that leaves it nothing.
     */
    const tiers = deep ? [base, base + 1, base - 1]
      : [base, base - 1, base + 1, base - 2];
    for (const t of tiers) {
      if (t < 0 || t > 5) continue;
      for (const g of gearOfTier(t, cat)) {
        if (CEILING[cat] !== undefined && g.value > CEILING[cat]) continue;
        out2.push(g);
      }
      // A dealer with enough already does not need the tier below.
      if (deep && out2.length >= 4) break;
    }
    return out2;
  };
  /** Fisher-Yates on the stall's own seed, so the draw is stable. */
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  if (trade.id === 'blades') {
    /**
     * KUNAI FIRST, PINNED, and everything else under it cheapest-first.
     *
     * Deliberately not sorted in with the rest: blades are why anybody
     * walks to this stall, and a counter that buried them under two cheap
     * sundries because a sack of reed fibre costs eleven froglets would be
     * sorting getting in the way of the point. Every other counter reads
     * cheapest-first; this one reads blades-first.
     */
    out.push({
      item: null, n: KUNAI_LOT, kunai: true, price: 60 + tier * 25,
      name: `${KUNAI_LOT} kunai`,
    });
    /**
     * And a knife-seller's other odds and ends — the cheap end of what a
     * region produces, drawn from BOTH everyday categories so the counter
     * is never two rows. It was `gearOfTier(tier, cat)` alone, which at
     * tier 5 found nothing under the ceiling in either category and left
     * the Frostmarch's blade stalls with kunai and nothing else on them.
     */
    const sundries = shuffle(poolOf('material', tier, false)
      .concat(poolOf('food', tier, false)))
      .sort((a, b) => a.value - b.value)
      .slice(0, 3 + Math.floor(rnd() * 2));
    const rest = [];
    for (const g of sundries) {
      const n = Math.min(g.cat === 'material' ? 4 : 2, g.stack || 1);
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      rest.push({
        item: g, n, kunai: false, price: priceOf(g, n, 1.1),
        name: `${n > 1 ? `${n} × ` : ''}${g.name}`,
      });
    }
    rest.sort((a, b) => a.price - b.price);
    return out.concat(rest);
  }

  const want = trade.cat || (rnd() < 0.5 ? 'weapon' : 'armour');
  /**
   * THREE TO FIVE LOTS, and how many is part of what makes one counter
   * different from the next.
   *
   * Taking a fixed five off a pool of five gives every grocer in a region
   * the same five things in the same order — which is what happened, and
   * makes a market of nine stalls read as one stall repeated. Varying the
   * count as well as the draw means two grocers differ even where the
   * region only grows five kinds of fruit.
   */
  const pool = shuffle(poolOf(want, Math.min(5, tier + (trade.deep || 0)),
    !!trade.deep));
  const take = 3 + Math.floor(rnd() * 3);
  for (const g of pool.slice(0, take)) push(g, trade.lot, trade.markup);
  out.sort((a, b) => a.price - b.price);
  return out;
}

/** For the tests, and for anything that wants to name an item by id. */
export function itemName(id) {
  const g = GEAR_BY_ID.get(id);
  return g ? g.name : id;
}
