// Tokenisation — selling treasury tokens for cash. Slice 4.
//
// Brief §6 (community capital unlocks: "treasury token sales") and §30 (treasury diversification).
//
// ---------------------------------------------------------------------------------------------
// WHY THIS IS NOT OPTIONAL
//
// Tokenising closes institutional rounds and the IPO — permanently. Before this file existed it
// opened nothing in return: the treasury was a number that could only be spent on incentives, and
// the only cash a token company ever received was the one-off initial sale. A fork that removes
// every route to capital and supplies none is not a different path, it is a worse one, and §75's
// "must NOT be objectively better" was never meant to be satisfied by making it objectively worse.
//
// This is the token path's fundraising. It is also the token path's ONLY recurring capital
// decision, which is why it belongs beside the incentive sliders rather than three slices later.
//
// ---------------------------------------------------------------------------------------------
// AND WHY IT IS NOT FREE MONEY (§7.7's rule, applied a second time)
//
// Four costs, and the first two are the same mechanism the price model already runs on:
//
//   1. SLIPPAGE. You do not sell at the screen price. Selling `f` of the float moves the price down
//      by `supplyPressurePerFloatPct × f / depth` — the SAME coefficient the weekly tick charges for
//      released tokens — and you realise the average price along the way, not the price you started
//      at. A thin market punishes size; a deep one absorbs it. That is what `depth` is FOR, and it
//      is the second place liquidity incentives pay for themselves.
//   2. THE PRICE STAYS DOWN. The move is applied to `market.price` immediately, and the tokens are
//      in `circulating` from that moment, so next week's `fairValue` — a PER-TOKEN number — is
//      diluted too. The sale enters loop A and loop B through the same doors everything else does;
//      it does not bypass the damping, it is subject to it.
//   3. CONFIDENCE. A treasury selling its own token is the loudest possible statement about what
//      the people who printed it think it is worth. Trust and sentiment both fall, and the hit
//      scales with size AND with how recently you last did it — the second raise inside a quarter
//      costs far more belief than the first.
//   4. THE TREASURY IS FINITE AND IT IS ALSO YOUR INCENTIVE BUDGET. Every token sold for cash is a
//      token that cannot fund customer rewards, grants or liquidity, and the weekly incentive cap is
//      2% of what remains. Raising is a direct trade against every programme you are running.
//   5. IT DILUTES, exactly as the round it replaces would have. Added after
//      test/token-balance-probe.ts measured costs 1–4 and found them nearly free: slippage and the
//      price drop are paid by every holder rather than by the founder specifically, and cost 3 —
//      the 14-point trust hit that reads as the moral centre of this file — reaches `engagement` at
//      weight 0.35, which reaches `liquidityDiscount` at weight 0.2. A maximum sale cost about ONE
//      POINT of market quality. The founder's own arithmetic barely noticed. `saleDilution` in
//      launch.ts is the shared rule; see §7.7b there for why community capital is priced like any
//      other capital.
//
// DETERMINISM: nothing here draws. A sale is a pure function of state plus the size the player
// chose, so the quote the player is shown is exactly what they get.

import { valuation } from '../engine'
import { hasCapability } from '../modes'
import type { GameState } from '../types'
import { saleDilution } from './launch'
import { priceFloor } from './market'
import { TOKEN_BOUNDS, TOKEN_LIMITS, type TokenState } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

export const TOKEN_TREASURY = {
  /**
   * The largest share of CIRCULATING supply one sale may push into the market, before depth. A
   * treasury cannot dump 40% of the float in an afternoon; there is nobody on the other side.
   */
  maxSaleFloatShare: 0.08,
  /** Depth below this floor still absorbs something, so a thin market is punishing rather than
   *  impossible — the same reason the price floor exists rather than zero. */
  minEffectiveDepth: 0.15,
  /** Points of trust and sentiment at the maximum sale size into a fresh market. */
  trustCostMax: 14,
  sentimentCostMax: 10,
  /** Sales inside this window compound the confidence cost: doing it again soon costs double. */
  recencyWindowWeeks: 16,
  /** Speculation rises when the treasury is seen distributing — §17's crowd arrives either way. */
  speculationCostMax: 6,
} as const

export interface TreasurySaleQuote {
  /** Whether a sale is possible at all, and why not. */
  ok: boolean
  reason?: string
  tokens: number
  /** The most this company could sell in one go, given its float and its depth. */
  maxTokens: number
  /** What the tokens are worth at the screen price — the number that is NOT what you get. */
  grossDollars: number
  /** What you actually receive, after walking the book down. */
  proceeds: number
  /** 0–1 fraction the price falls by. */
  priceImpact: number
  priceAfter: number
  trustCost: number
  sentimentCost: number
  /** How much of the incentive budget this sale costs, per week, forever after. */
  weeklyBudgetLost: number
  /** 0–1. The share of the company this raise costs the founder — cost 5, and the binding one. */
  equityDilution: number
}

/** Is the token path's capital mechanic live? Rides the Slice-4 switch: the contract assigns
 *  community capital to `tokenEconomy`, but the CONTROL is this slice's, and the rollout ratchet is
 *  only honest if everything a slice adds is behind the capability that slice turned on. */
export function treasurySalesActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenIncentives')
}

/** The most this treasury could sell in one sale. Bounded by the float and by how much of it the
 *  market absorbs — never by ambition (§7.7, the same rule the initial sale is held to). */
export function maxTreasurySale(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t || !treasurySalesActive(s)) return 0
  const byFloat = t.supply.circulating * TOKEN_TREASURY.maxSaleFloatShare * Math.max(TOKEN_TREASURY.minEffectiveDepth, t.market.depth)
  return Math.max(0, Math.floor(Math.min(t.supply.treasury, byFloat)))
}

/** 0–1. How much a sale of this size has been done recently — the confidence multiplier. */
function recency(t: TokenState, week: number): number {
  const since = week - t.treasurySales.lastSaleWeek
  if (!(t.treasurySales.lastSaleWeek > 0)) return 0
  return clamp01(1 - since / TOKEN_TREASURY.recencyWindowWeeks)
}

/**
 * What a sale of `tokens` would produce. Pure — the preview and the sale itself call the same
 * function with the same arguments, so the quote cannot lie.
 */
export function treasurySaleQuote(s: GameState | null | undefined, tokens: number): TreasurySaleQuote {
  const empty: TreasurySaleQuote = {
    ok: false,
    tokens: 0,
    maxTokens: 0,
    grossDollars: 0,
    proceeds: 0,
    priceImpact: 0,
    priceAfter: 0,
    trustCost: 0,
    sentimentCost: 0,
    weeklyBudgetLost: 0,
    equityDilution: 0,
  }
  const t = s?.token
  if (!t || !treasurySalesActive(s)) return { ...empty, reason: 'This company has no token treasury.' }
  const max = maxTreasurySale(s)
  if (!(max > 0)) return { ...empty, maxTokens: 0, reason: 'The treasury is empty, or the market is too thin to absorb anything.' }

  const size = Math.floor(clamp(tokens, 0, max))
  if (!(size > 0)) return { ...empty, maxTokens: max, reason: 'Nothing to sell.' }

  const circulating = Math.max(1, t.supply.circulating)
  const floatFraction = size / circulating
  // The same coefficient the weekly tick charges for released tokens, divided by depth: a market
  // that absorbs size costs you less to sell into. `1 − exp(−x)` keeps the impact bounded below 1
  // however large the sale, so a price can be crushed but never taken to zero by one transaction.
  const raw = (TOKEN_BOUNDS.supplyPressurePerFloatPct * floatFraction) / Math.max(TOKEN_TREASURY.minEffectiveDepth, t.market.depth)
  const priceImpact = clamp01(1 - Math.exp(-raw))
  const floor = priceFloor(t)
  const priceAfter = Math.max(floor, t.market.price * (1 - priceImpact))
  // You realise the AVERAGE price along the way down, not the price on the screen when you clicked.
  const avgPrice = (t.market.price + priceAfter) / 2

  const sizeShare = clamp01(size / Math.max(1, max))
  const confidence = sizeShare * (1 + recency(t, s!.week))
  const proceeds = size * avgPrice
  return {
    ok: true,
    tokens: size,
    maxTokens: max,
    grossDollars: size * t.market.price,
    proceeds,
    equityDilution: saleDilution(proceeds, valuation(s!)),
    priceImpact,
    priceAfter,
    trustCost: TOKEN_TREASURY.trustCostMax * confidence,
    sentimentCost: TOKEN_TREASURY.sentimentCostMax * confidence,
    weeklyBudgetLost: size * TOKEN_BOUNDS.treasurySpendCapPerWeek,
  }
}

export interface TreasurySaleResult {
  ok: boolean
  reason?: string
  quote?: TreasurySaleQuote
}

/**
 * Sell treasury tokens into the market for company cash.
 *
 * The cash lands in `s.cash` — this is the company's capital, the thing the round it replaced would
 * have provided. It is NOT `bankedPayout`: the founder selling their OWN vested position is §42, a
 * different mechanic with a different moral, and it is still unbuilt.
 *
 * Not wrapped in `seeded()` at the call site, and that is deliberate: nothing here draws, and a
 * player who opens the panel, moves the slider and closes it again must not have shifted the RNG
 * stream for the rest of the run.
 */
export function sellTreasuryTokens(s: GameState, tokens: number): TreasurySaleResult {
  const t = s.token
  if (!t) return { ok: false, reason: 'This company has no token treasury.' }
  if (s.gameOver) return { ok: false, reason: 'The run is over.' }
  const quote = treasurySaleQuote(s, tokens)
  if (!quote.ok) return { ok: false, reason: quote.reason }

  // One subtraction, one addition, same integer: the §4.6 supply identity cannot break here.
  t.supply.treasury -= quote.tokens
  t.supply.circulating += quote.tokens

  t.market.price = quote.priceAfter
  // The EMA is NOT reset. Next week's momentum therefore reads the drop as news, exactly as it
  // would read any other fall — the sale goes through loop B's front door rather than around it.
  t.community.trust = clamp(t.community.trust - quote.trustCost, 0, 100)
  t.community.sentiment = clamp(t.community.sentiment - quote.sentimentCost, 0, 100)
  t.market.speculation = clamp(
    t.market.speculation + TOKEN_TREASURY.speculationCostMax * clamp01(quote.tokens / Math.max(1, quote.maxTokens)),
    0,
    100,
  )

  t.treasurySales.tokensSold += quote.tokens
  t.treasurySales.proceeds += quote.proceeds
  t.treasurySales.lastSaleWeek = s.week

  const equityBefore = s.founderEquity
  s.cash += quote.proceeds
  // Cost 5, and the one that actually bites — see the header. Same rule and same function as the
  // launch sale: a raise is priced in ownership, whoever is on the other side of it.
  s.founderEquity = clamp(s.founderEquity * (1 - quote.equityDilution), 0, 1)

  t.history.push({
    week: s.week,
    type: 'treasury_sale',
    importance: Math.min(100, Math.round(45 + 55 * clamp01(quote.tokens / Math.max(1, quote.maxTokens)))),
    metadata: {
      tokens: quote.tokens,
      proceeds: Math.round(quote.proceeds),
      priceImpact: Math.round(quote.priceImpact * 1000) / 1000,
      treasuryLeft: t.supply.treasury,
    },
  })
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)

  const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`)
  s.flash =
    `🏦 Treasury sale: ${quote.tokens.toLocaleString()} tokens for ${money(quote.proceeds)} — ` +
    `${(quote.priceImpact * 100).toFixed(0)}% off the price on the way down. The forums noticed who was selling.`
  s.inbox.unshift({
    id: `treasury-sale-${s.week}`,
    week: s.week,
    kind: 'system',
    title: 'The treasury sold into the market',
    body:
      `${quote.tokens.toLocaleString()} tokens cleared for ${money(quote.proceeds)} against ${money(quote.grossDollars)} at the ` +
      `screen price — the difference is what it costs to sell size into a market this deep. The price closed ` +
      `${(quote.priceImpact * 100).toFixed(0)}% lower and those tokens are in the float now, which means every remaining token is worth ` +
      `slightly less of the same network.\n\n` +
      `Trust fell ${quote.trustCost.toFixed(0)} points. A treasury selling its own token is the loudest opinion anyone has about what ` +
      `it is worth, and the community can read a block trade as well as you can. ` +
      `Your weekly incentive budget is ${Math.round(quote.weeklyBudgetLost).toLocaleString()} tokens smaller from now on.` +
      (quote.equityDilution > 0.001
        ? `\n\nAnd it is a raise, so it is priced like one: your stake went from ${(equityBefore * 100).toFixed(1)}% to ` +
          `${(s.founderEquity * 100).toFixed(1)}%. Community capital is still capital.`
        : ''),
  })

  return { ok: true, quote }
}
