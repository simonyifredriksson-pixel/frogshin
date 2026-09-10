/**
 * WHAT IS ON THE STALLS.
 *
 * Every market stall in the country sells one thing, and no two stalls beside
 * each other sell the same thing. Walk down a row in Anurath and it is a
 * grocer, then a smith, then somebody with dried reeds and dye — which is
 * what makes a market worth walking down rather than a place with a shop in
 * it.
 *
 * ── one stall, one trade ────────────────────────────────────────────────
 * A stall offers a SINGLE lot at a single price, and it says exactly what and
 * exactly how much on the prompt: "Buy 3 × Bog Berry — 24 froglets". That is
 * a deliberate limit rather than a shortcut. The alternative is a shop panel,
 * and a shop panel is a menu you read instead of a market you walk through;
 * the interesting decision at a stall is whether to buy the thing in front of
 * you, not which of eleven things to buy. Variety comes from there being
 * eleven stalls.
 *
 * ── and it is the same stall tomorrow ───────────────────────────────────
 * What a stall stocks is a pure function of where it stands, so the fruit
 * stall by the well in Croakhollow is the fruit stall by the well every time
 * you load the game and on every machine. That matters more than it sounds:
 * a player who finds an armourer in a town they can reach is entitled to go
 * back for the other half of the set. It is also what lets `Progress.found`
 * remember which of the Hollow Market's stalls have already been searched.
 *
 * ── the exception ───────────────────────────────────────────────────────
 * `leftoverOf` is for the Hollow Market, which is the one place in the game
 * where the awnings are up, the goods are still out and there is nobody
 * behind any of them. Those are not shops. You search them, once, and most
 * of them have nothing, because the blurb on that place is one word long —
 * "Nobody." — and it would be a poor trade to sell that for a bag of
 * turnips.
 */

import { gearOfTier, GEAR_BY_ID } from './gear.js?v=v101';
import { mulberry32 } from './util.js?v=v101';

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
    keeper: 'The blade-seller', goods: 0xb8c0c8,
    line: 'Five, and they are straight. Sharpened this morning.',
  },
  {
    id: 'produce', sign: 'PRODUCE', cat: 'food', lot: 3, markup: 1.05,
    keeper: 'The grocer', goods: 0x8fbf4a,
    line: 'Picked this morning. Most of it.',
  },
  {
    id: 'smith', sign: 'THE SMITH', cat: 'weapon', lot: 1, markup: 1.15,
    keeper: 'The smith', goods: 0x9aa3ad,
    line: 'It will hold an edge. It had better, at that price.',
  },
  {
    id: 'armourer', sign: 'ARMOUR', cat: 'armour', lot: 1, markup: 1.15,
    keeper: 'The armourer', goods: 0x7a6a4a,
    line: 'Padded through. You will want padding.',
  },
  {
    id: 'herbs', sign: 'HERBS & DYE', cat: 'material', lot: 4, markup: 1.05,
    keeper: 'The herbalist', goods: 0x5f8f3a,
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
    keeper: 'The dealer', goods: 0xc9a227,
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
 * Gear of this tier in this category, reaching down and then up for it.
 *
 * `CEILING` is applied first and only relaxed if it would leave nothing at
 * all — a market that has to stock something dear is better than a stall
 * with an empty counter.
 */
function pickGear(cat, tier, rnd) {
  const cap = CEILING[cat];
  for (const strict of [true, false]) {
    if (!strict && cap === undefined) break;
    for (const t of [tier, tier - 1, tier + 1, tier - 2, tier + 2, 0]) {
      if (t < 0 || t > 5) continue;
      let pool = gearOfTier(t, cat);
      if (strict && cap !== undefined) pool = pool.filter((g) => g.value <= cap);
      if (pool.length) return pool[Math.floor(rnd() * pool.length)];
    }
  }
  return null;
}

/**
 * WHAT THIS STALL IS SELLING, AND FOR HOW MUCH.
 *
 * `seed` is the stall's own position rounded off, so the answer never
 * changes. Returns null only if the gear table has nothing at all in the
 * category, which cannot currently happen and is handled anyway.
 *
 * @returns { trade, item, n, price, kunai, label, line }
 */
export function offerOf(trade, tier, seed) {
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  if (trade.id === 'blades') {
    /**
     * The same price the world's single kunai stall charged before markets
     * existed — 60 at tier 0 and 25 more per tier. Kept exactly, because
     * blades are the one purchase the game's difficulty is balanced around
     * and this was never meant to be a rebalance.
     */
    const price = 60 + tier * 25;
    return {
      trade, item: null, n: KUNAI_LOT, price, kunai: true,
      label: `Buy ${KUNAI_LOT} kunai — ${price} froglets`,
      line: trade.line,
    };
  }
  /**
   * A trade with no category of its own is the dealer, and a dealer sells
   * EQUIPMENT. Given the run of all four categories it turned up "Buy Mire
   * Scale — 15 froglets" in Harrowmead, which is a curio stall selling one
   * ordinary component for pocket change: no reason to exist, and it wastes
   * one of the five stalls in a town. A tier above, and a weapon or a piece
   * of armour, is the only version of this stall worth walking to.
   */
  const want = trade.cat || (rnd() < 0.5 ? 'weapon' : 'armour');
  const item = pickGear(want, tier + (trade.deep || 0), rnd);
  if (!item) return null;
  const n = Math.min(trade.lot, item.stack || 1);
  const price = Math.max(2, Math.ceil(item.value * n * trade.markup));
  return {
    trade, item, n, price, kunai: false,
    label: `Buy ${n > 1 ? `${n} × ` : ''}${item.name} — ${price} froglets`,
    line: trade.line,
  };
}

/**
 * WHAT IS STILL ON AN ABANDONED STALL.
 *
 * For the Hollow Market. Free, one-shot, and usually nothing — which is
 * deliberate, and is the reason searching one is worth doing at all: if
 * every stall paid out it would be a supply depot rather than somewhere
 * frightening.
 *
 * What is left is what nobody bothered to carry: food going over, and the
 * raw materials a city runs on. Never equipment. Somebody took the swords.
 *
 * @returns { item, n } or null for nothing
 */
export function leftoverOf(tier, seed) {
  const rnd = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  if (rnd() < 0.62) return null;
  const cat = rnd() < 0.5 ? 'food' : 'material';
  const item = pickGear(cat, Math.max(0, tier - 1), rnd);
  if (!item) return null;
  const n = 1 + Math.floor(rnd() * (cat === 'material' ? 4 : 2));
  return { item, n };
}

/** For the tests, and for anything that wants to name an item by id. */
export function itemName(id) {
  const g = GEAR_BY_ID.get(id);
  return g ? g.name : id;
}
