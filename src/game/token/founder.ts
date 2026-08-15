// Tokenisation — the founder selling their own position. Brief §42. Slice 7.
//
// The full argument for why this exists and how it is priced is on `TOKEN_FOUNDER_SALE` in
// types.ts. The short version, because it is the thing a reader needs before the code:
//
//   treasury.ts sells the COMPANY's tokens for COMPANY cash and prices it as a raise — it dilutes.
//   This sells YOUR tokens for YOUR cash and does not dilute anything, because nothing is issued.
//   Until this file, `bankedPayout` was unreachable on the token path and `founderVestedTokens`
//   was a number that only ever got read at the horizon. Vesting and the liquidity discount become
//   DECISIONS here or they stay arithmetic.
//
// ---------------------------------------------------------------------------------------------
// SUPPLY DOES NOT MOVE, AND THAT IS NOT AN OVERSIGHT
//
// Founder tokens are part of the `locked` bucket at launch and reach `circulating` on the vesting
// schedule through `pendingUnlock` — the tick already moves them. `founder.granted/sold/vested` is
// a separate ledger of the founder's CLAIM on tokens that are, by the time they can be sold,
// already in the float. So a sale writes `founder.sold` and prices the pressure; it moves no
// bucket. Exactly the rule Slice 5's exodus follows: "priced pressure, not moved supply".
//
// DETERMINISM: nothing here draws. A sale is a pure function of state plus the size the player
// chose, so the quote they were shown is exactly what they get, and opening the panel cannot shift
// the RNG stream for the rest of the run.

import { hasCapability } from '../modes'
import type { GameState } from '../types'
import { communityActive } from './community'
import { priceFloor } from './market'
import { founderVestedTokens } from './scoring'
import { saleInfluenceFactor } from './treasury'
import { TOKEN_BOUNDS, TOKEN_FOUNDER_SALE, TOKEN_LIMITS, type TokenState } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

/**
 * Is §42 live? Behind Slice 7's capability, following the rule treasury.ts set: the CONTROL a
 * slice adds sits behind the capability that slice turned on, so the rollout ratchet stays honest
 * even when the contract files the mechanic under an earlier heading.
 */
export function founderSalesActive(s: GameState | null | undefined): boolean {
  return !!s?.token && hasCapability(s, 'tokenNarrative')
}

/** Tokens still permitted across the whole run: the lifetime cap, minus what is already sold. */
export function founderLifetimeRemaining(t: TokenState): number {
  const cap = t.founder.granted * TOKEN_FOUNDER_SALE.lifetimeShareOfGrant
  return Math.max(0, cap - t.founder.sold)
}

/** Weeks until the next sale is permitted. 0 when it is permitted now. */
export function founderSaleCooldown(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t) return 0
  const last = t.founder.lastSaleWeek ?? 0
  if (!(last > 0)) return 0
  return Math.max(0, TOKEN_FOUNDER_SALE.cooldownWeeks - (s!.week - last))
}

/**
 * The most this founder could sell in one go. Three ceilings, and the binding one is reported by
 * the quote so the panel can say which:
 *
 *   • what is VESTED — the cliff and the schedule chosen at launch,
 *   • what the FLOAT absorbs — `maxSaleFloatShare × circulating × depth`, the same shape the
 *     treasury is held to at half the share,
 *   • what the LIFETIME CAP leaves.
 */
export function maxFounderSale(s: GameState | null | undefined): number {
  const t = s?.token
  if (!t || !founderSalesActive(s)) return 0
  if (founderSaleCooldown(s) > 0) return 0
  const byFloat =
    t.supply.circulating * TOKEN_FOUNDER_SALE.maxSaleFloatShare * Math.max(TOKEN_FOUNDER_SALE.minEffectiveDepth, t.market.depth)
  return Math.max(0, Math.floor(Math.min(founderVestedTokens(s), byFloat, founderLifetimeRemaining(t))))
}

export interface FounderSaleQuote {
  ok: boolean
  reason?: string
  tokens: number
  maxTokens: number
  /** Which of the three ceilings set `maxTokens`. Shown, never hidden (§47). */
  boundBy: 'vesting' | 'float' | 'lifetime' | 'cooldown' | 'none'
  /** The screen price × tokens — the number that is NOT what you get. */
  grossDollars: number
  /** What lands in `bankedPayout`, after walking the book down. */
  proceeds: number
  priceImpact: number
  priceAfter: number
  trustCost: number
  sentimentCost: number
  /** Tokens left in the position afterwards, and what the lifetime cap has left after this. */
  positionAfter: number
  lifetimeLeftAfter: number
}

const EMPTY: FounderSaleQuote = {
  ok: false,
  tokens: 0,
  maxTokens: 0,
  boundBy: 'none',
  grossDollars: 0,
  proceeds: 0,
  priceImpact: 0,
  priceAfter: 0,
  trustCost: 0,
  sentimentCost: 0,
  positionAfter: 0,
  lifetimeLeftAfter: 0,
}

/** 0–1 how recently the founder last sold — the confidence multiplier, same shape as treasury.ts. */
function recency(t: TokenState, week: number): number {
  const last = t.founder.lastSaleWeek ?? 0
  if (!(last > 0)) return 0
  return clamp01(1 - (week - last) / TOKEN_FOUNDER_SALE.cooldownWeeks)
}

/**
 * What a sale of `tokens` would produce. Pure — the preview and the sale call this with the same
 * arguments, so the quote cannot lie.
 */
export function founderSaleQuote(s: GameState | null | undefined, tokens: number): FounderSaleQuote {
  const t = s?.token
  if (!t || !founderSalesActive(s)) return { ...EMPTY, reason: 'You have no token position to sell.' }

  const cooldown = founderSaleCooldown(s)
  if (cooldown > 0)
    return {
      ...EMPTY,
      boundBy: 'cooldown',
      reason: `You sold ${s!.week - (t.founder.lastSaleWeek ?? 0)} weeks ago. Selling again inside ${TOKEN_FOUNDER_SALE.cooldownWeeks} weeks is not a de-risking, it is an exit — ${cooldown} weeks to go.`,
    }

  const vested = founderVestedTokens(s)
  const byFloat =
    t.supply.circulating * TOKEN_FOUNDER_SALE.maxSaleFloatShare * Math.max(TOKEN_FOUNDER_SALE.minEffectiveDepth, t.market.depth)
  const lifetime = founderLifetimeRemaining(t)
  const max = maxFounderSale(s)
  // Which ceiling actually bit. Compared on the pre-floor quantities so a tie reports the real one.
  const boundBy: FounderSaleQuote['boundBy'] =
    vested <= byFloat && vested <= lifetime ? 'vesting' : byFloat <= lifetime ? 'float' : 'lifetime'

  if (!(max > 0))
    return {
      ...EMPTY,
      maxTokens: 0,
      boundBy,
      reason:
        boundBy === 'vesting'
          ? 'Nothing has vested yet. The cliff you chose at launch is the cliff.'
          : boundBy === 'lifetime'
            ? 'You have sold everything §42 lets a founder sell. The rest of your position is realised at the horizon or not at all.'
            : 'The market is too thin to absorb anything you could sell. Deepen it, or wait for the community to grow.',
    }

  const size = Math.floor(clamp(tokens, 0, max))
  if (!(size > 0)) return { ...EMPTY, maxTokens: max, boundBy, reason: 'Nothing to sell.' }

  const circulating = Math.max(1, t.supply.circulating)
  const floatFraction = size / circulating
  // The SAME coefficient the weekly tick charges for released tokens and the treasury sale charges
  // for its block, divided by depth. `1 − exp(−x)` keeps the impact bounded below 1 however large
  // the sale, so a price can be crushed but never taken to zero by one transaction.
  const raw = (TOKEN_BOUNDS.supplyPressurePerFloatPct * floatFraction) / Math.max(TOKEN_FOUNDER_SALE.minEffectiveDepth, t.market.depth)
  const priceImpact = clamp01(1 - Math.exp(-raw))
  const priceAfter = Math.max(priceFloor(t), t.market.price * (1 - priceImpact))
  // You realise the AVERAGE price along the way down, not the price on the screen when you clicked.
  const avgPrice = (t.market.price + priceAfter) / 2

  const sizeShare = clamp01(size / Math.max(1, max))
  // Slice 5's factor, unchanged and unduplicated: WHO was seen selling scales what it costs in
  // belief. A founder who handed over control is read differently from one who did not.
  const confidence = sizeShare * (1 + recency(t, s!.week)) * saleInfluenceFactor(s)
  const communityPrices = communityActive(s)

  return {
    ok: true,
    tokens: size,
    maxTokens: max,
    boundBy,
    grossDollars: size * t.market.price,
    proceeds: size * avgPrice,
    priceImpact,
    priceAfter,
    // The confidence cost is the community's, so it is zero when the community capability is off —
    // the same rule every other Slice-5 read follows.
    trustCost: communityPrices ? TOKEN_FOUNDER_SALE.trustCostMax * confidence : 0,
    sentimentCost: communityPrices ? TOKEN_FOUNDER_SALE.sentimentCostMax * confidence : 0,
    positionAfter: Math.max(0, t.founder.granted - t.founder.sold - size),
    lifetimeLeftAfter: Math.max(0, lifetime - size),
  }
}

export interface FounderSaleResult {
  ok: boolean
  reason?: string
  quote?: FounderSaleQuote
}

/**
 * Sell from your own vested position. The cash lands in `s.bankedPayout` — the founder's, banked,
 * and it survives a bankruptcy exactly as `sellSecondary`'s does.
 */
export function sellFounderPosition(s: GameState, tokens: number): FounderSaleResult {
  const t = s.token
  if (!t) return { ok: false, reason: 'You have no token position to sell.' }
  if (s.gameOver) return { ok: false, reason: 'The run is over.' }
  const quote = founderSaleQuote(s, tokens)
  if (!quote.ok) return { ok: false, reason: quote.reason }

  t.market.price = quote.priceAfter
  // The EMA is NOT reset — next week's momentum reads the drop as news, exactly as it would read
  // any other fall. The sale goes through loop B's front door rather than around it.
  t.community.trust = clamp(t.community.trust - quote.trustCost, 0, 100)
  t.community.sentiment = clamp(t.community.sentiment - quote.sentimentCost, 0, 100)
  t.market.speculation = clamp(
    t.market.speculation + TOKEN_FOUNDER_SALE.speculationCostMax * clamp01(quote.tokens / Math.max(1, quote.maxTokens)),
    0,
    100,
  )

  t.founder.sold += quote.tokens
  t.founder.realisedProceeds += quote.proceeds
  t.founder.lastSaleWeek = s.week
  // The mirror field, kept honest at every site that touches the position (see `syncFounderVested`).
  t.founder.vested = Math.max(0, founderVestedTokens(s))

  s.bankedPayout += quote.proceeds

  t.history.push({
    week: s.week,
    type: 'founder_sale',
    importance: Math.min(100, Math.round(55 + 45 * clamp01(quote.tokens / Math.max(1, quote.maxTokens)))),
    metadata: {
      tokens: quote.tokens,
      proceeds: Math.round(quote.proceeds),
      priceImpact: Math.round(quote.priceImpact * 1000) / 1000,
      positionLeft: Math.round(quote.positionAfter),
      trustCost: Math.round(quote.trustCost),
    },
  })
  if (t.history.length > TOKEN_LIMITS.history) t.history.splice(0, t.history.length - TOKEN_LIMITS.history)

  const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`)
  s.flash =
    `💼 You sold ${quote.tokens.toLocaleString()} of your own tokens for ${money(quote.proceeds)} — banked, whatever happens next. ` +
    `The chain is public and the forums had the address inside the hour.`
  s.inbox.unshift({
    id: `token-founder-sale-${s.week}`,
    week: s.week,
    kind: 'system',
    title: 'The founder sold',
    body:
      `${quote.tokens.toLocaleString()} tokens out of your position cleared for ${money(quote.proceeds)} against ` +
      `${money(quote.grossDollars)} at the screen price — the gap is what it costs to sell size into a market this deep. ` +
      `The price closed ${(quote.priceImpact * 100).toFixed(0)}% lower.\n\n` +
      `This money is yours. It does not touch the company's account and it cannot be lost with the company.\n\n` +
      (quote.trustCost > 0.5
        ? `Trust fell ${quote.trustCost.toFixed(0)} points. Nobody has to guess what a founder selling means, and the people who ` +
          `bought at the top read it first. Trust runs your market's depth, and depth is what you would have realised the rest of ` +
          `your position into — this sale is paid for by the price of the next one.\n\n`
        : '') +
      `${Math.round(quote.positionAfter).toLocaleString()} tokens left in the position, and §42 leaves you ` +
      `${Math.round(quote.lifetimeLeftAfter).toLocaleString()} you may still sell across the rest of the run. ` +
      `The upside: a smaller bag is a smaller overhang, and a smaller overhang realises a larger share of itself.`,
  })

  return { ok: true, quote }
}
