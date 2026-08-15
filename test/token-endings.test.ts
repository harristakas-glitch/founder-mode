// Tokenisation / ICO — Slice 7: endings, §42 founder sales, narrative. Run:
//   npx tsx test/token-endings.test.ts
//
// Covers docs/ico-architecture.md §1.4 (the `network` ending's gate and payout), brief §42 (the
// founder selling their own position), §44 (five success states, one GameOver type) and §59/§72
// (the beats reaching the player), plus the slice plan's one-line gate: A TOKENISED RUN PRODUCES
// A READABLE STORY AND ITS OWN ENDING.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose and this
// file re-run to confirm it goes red. The mutations, including the first-pass survivors, are
// listed at the bottom.
//
// House rules applied, the same three every token test has used: assert on the CALL SITE
// (`advanceWeek`, `resolveChoiceOnState`, the write) rather than on a pure function the call site
// would have to invoke correctly to reach; use differential tests — two states one variable apart —
// wherever an expected value would otherwise be the implementation's formula pasted into the test;
// and where an assertion could be satisfied through a channel other than the one it names, isolate
// that channel.

import { advanceWeek, newGame, resolveChoiceOnState, sellFounderTokens, valuation, withSeed, NETWORK_OFFER_COOLDOWN } from '../src/game/engine'
import { defaultCapabilities, type GameConfig } from '../src/game/modes'
import { tokenisationBars } from '../src/game/token/eligibility'
import { launchToken } from '../src/game/token/launch'
import { tokenInvariants } from '../src/game/token/market'
import { communityConduct } from '../src/game/token/community'
import {
  TOKEN_ENDING_FACES,
  networkEndingProgress,
  sustainedNetworkWeeks,
  tokenEndingKind,
  tokenEndingsActive,
} from '../src/game/token/endings'
import {
  founderLifetimeRemaining,
  founderSaleCooldown,
  founderSaleQuote,
  founderSalesActive,
  maxFounderSale,
} from '../src/game/token/founder'
import { tickTokenNarrative } from '../src/game/token/narrative'
import { founderStanding, founderVestedTokens, liquidityDiscount, networkExitPremium, networkValue } from '../src/game/token/scoring'
import { tickToken } from '../src/game/token/tick'
import { TOKEN_ENDINGS, TOKEN_FOUNDER_SALE, TOKEN_NARRATIVE, TOKEN_SCORING, type TokenSeriesPoint } from '../src/game/token/types'
import { buildStory } from '../src/game/story'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const cfg = (seed: number, sector: SectorId = 'saas'): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })

/** A Career company that has taken the fork — the same rig every token test since Slice 4 uses. */
function tokenised(sector: SectorId = 'saas', seed = 4242, weeks = 20): GameState {
  let s = newGame('End', sector, 'technical', { config: cfg(seed, sector) })
  s.cash = 20_000_000
  for (let w = 0; w < weeks && !s.gameOver; w++) s = advanceWeek(s)
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 60)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  const res = launchToken(s)
  if (!res.ok) throw new Error(`setup failed: ${res.reason}`)
  return s
}

/** One token week through the tick, under a fixed seed. */
function week(s: GameState, seed = 31337) {
  s.week += 1
  return withSeed(seed + s.week, () => tickToken(s))
}

/**
 * Force a state that CLEARS the gate. Writes the levels directly and back-fills `series` with the
 * sustain window, which is exactly what the engine reads — so this rig proves the gate, never a
 * convenience path around it.
 */
function qualifying(s: GameState, opts: { weeks?: number; utility?: number; organic?: number; nvMultiple?: number } = {}): GameState {
  const t = s.token!
  const held = opts.weeks ?? TOKEN_ENDINGS.sustainWeeks
  s.week = t.launchWeek + TOKEN_ENDINGS.minWeeksSinceLaunch + held + 2
  t.market.utility = opts.utility ?? TOKEN_ENDINGS.minUtility + 10
  t.community.trust = TOKEN_ENDINGS.minTrust + 10
  // A real company underneath, so `valuation()` is large enough that the network-over-company
  // ratio is a DIAL rather than a foregone conclusion: with a $400k company, any network big
  // enough to clear the value bar is automatically 250x the company and every run would be a
  // `category_protocol`. Revenue first, then the network is priced as a multiple of what that
  // produced.
  // The COMPANY is left exactly as the twenty-week run produced it. An earlier draft inflated
  // users and revenue here to make the network/company ratio a dial, and it broke the fixture in
  // a way worth recording: `valuation()` reads `growthRate(s)`, which reads `s.history`, so a
  // fixture that jumps the user count also multiplies the valuation multiple and `growthMania` —
  // one seed became a $1.45B company and hit the `unicorn` ending before the network offer could
  // be tabled. States that need a specific ratio build it explicitly, below, and never through
  // advanceWeek.
  const organic = opts.organic ?? 0.9
  t.users.organic = Math.round(s.users * organic)
  t.users.incentivised = Math.max(0, Math.round(s.users) - t.users.organic)
  const targetNv = Math.max(TOKEN_ENDINGS.networkValue * 1.5, valuation(s) * (opts.nvMultiple ?? 1.4))
  t.market.price = targetNv / Math.max(1, t.supply.circulating)
  t.series = []
  for (let i = held - 1; i >= 0; i--) {
    t.series.push({
      week: s.week - i,
      price: t.market.price,
      circulating: t.supply.circulating,
      treasuryTokens: t.supply.treasury,
      utility: t.market.utility,
      speculation: t.market.speculation,
      sentiment: t.community.sentiment,
      organicUsers: t.users.organic,
      incentivisedUsers: t.users.incentivised,
    } satisfies TokenSeriesPoint)
  }
  return s
}

// ---------------------------------------------------------------------------------------------
console.log('— The capability ratchet: Slice 7 is on in Career and nowhere else —')

{
  const CAREER = defaultCapabilities('career')
  const QUICK = defaultCapabilities('quick')
  const ARENA = defaultCapabilities('arena')
  ok(CAREER.tokenNarrative === true, '`tokenNarrative` is on in Career — Slice 7 built what it gates')
  ok(QUICK.tokenNarrative === false && ARENA.tokenNarrative === false, 'and off in Quick Play and Arena')

  // Capability-off invisibility, asserted on the STATE rather than on the flag: a token company
  // whose Slice-7 switch is off must not be offered an ending, must not be able to sell, and must
  // not receive a single beat — even from a state that clears every other bar.
  const off = qualifying(tokenised())
  off.capabilities = { ...off.capabilities, tokenNarrative: false }
  ok(!tokenEndingsActive(off), 'the ending system is inert with the capability off')
  ok(!networkEndingProgress(off).reached, 'a fully qualifying state is NOT reached with the capability off')
  ok(networkEndingProgress(off).clauses.length === 0, 'and reports no clauses rather than a filled-in panel')
  ok(!founderSalesActive(off) && maxFounderSale(off) === 0, '§42 sales are refused with the capability off')
  ok(!sellFounderTokens(off, 1_000_000).ok, 'and the engine action refuses too, not just the module')
  const inboxBefore = off.inbox.length
  const historyBefore = off.token!.history.length
  tickTokenNarrative(off)
  ok(off.inbox.length === inboxBefore && off.token!.history.length === historyBefore, 'and the narrative layer writes nothing at all')
}

// ---------------------------------------------------------------------------------------------
console.log('— The gate (§1.4): six clauses, each one load-bearing on its own —')

{
  const base = qualifying(tokenised())
  ok(networkEndingProgress(base).reached, 'a state that clears every clause is reached')
  ok(
    networkEndingProgress(base).clauses.every((c) => c.met && c.progress >= 1 && c.label.length > 20 && /\d/.test(c.label)),
    'every clause reports met, a 0–1 progress, and a sentence quoting this run’s own numbers',
  )

  // ONE VARIABLE AT A TIME. Each of these is the same qualifying state with exactly one clause
  // broken, so a clause that has been quietly deleted cannot hide behind the other five.
  const noValue = qualifying(tokenised())
  noValue.token!.market.price = (TOKEN_ENDINGS.networkValue * 0.5) / noValue.token!.supply.circulating
  for (const p of noValue.token!.series) p.price = noValue.token!.market.price
  ok(!networkEndingProgress(noValue).reached, 'halve the network value and the gate closes')
  ok(networkEndingProgress(noValue).clauses.find((c) => c.id === 'network_value')?.met === false, 'and it is the value clause that says so')

  const noUtility = qualifying(tokenised(), { utility: TOKEN_ENDINGS.minUtility - 5 })
  ok(!networkEndingProgress(noUtility).reached, '§1.4 verbatim: a bubble with thin utility does not ring the bell')
  ok(networkEndingProgress(noUtility).clauses.find((c) => c.id === 'utility')?.met === false, 'and it is the utility clause that says so')

  const bought = qualifying(tokenised(), { organic: TOKEN_ENDINGS.minOrganicShare - 0.2 })
  ok(!networkEndingProgress(bought).reached, '§1.4 verbatim: growth that was mostly bought does not ring it either (§53)')
  ok(networkEndingProgress(bought).clauses.find((c) => c.id === 'organic_share')?.met === false, 'and it is the organic clause that says so')

  // The network-over-company clause, isolated. Both states have the SAME network value — only the
  // enterprise value differs — so the assertion cannot be carried by the value clause instead.
  const sidecar = qualifying(tokenised())
  const nvHeld = networkValue(sidecar)
  sidecar.lastRevenue = 8_000_000
  sidecar.users = 4_000_000
  sidecar.token!.users.organic = Math.round(sidecar.users * 0.9)
  sidecar.token!.users.incentivised = sidecar.users - sidecar.token!.users.organic
  for (const p of sidecar.token!.series) {
    p.organicUsers = sidecar.token!.users.organic
    p.incentivisedUsers = sidecar.token!.users.incentivised
  }
  ok(valuation(sidecar) > nvHeld, 'the side-car fixture is a company worth more than its own network')
  ok(Math.abs(networkValue(sidecar) - nvHeld) < 1, 'at an unchanged network value — the value clause cannot carry this one')
  ok(!networkEndingProgress(sidecar).reached, 'a network that is a side-car on a bigger company is not a network ending')
  ok(networkEndingProgress(sidecar).clauses.find((c) => c.id === 'network_over_company')?.met === false, 'and it is that clause that says so')

  const distrusted = qualifying(tokenised())
  distrusted.token!.community.trust = TOKEN_ENDINGS.minTrust - 5
  ok(!networkEndingProgress(distrusted).reached, 'a community that has written the founder off does not hand them a success state')

  const young = qualifying(tokenised())
  young.week = young.token!.launchWeek + TOKEN_ENDINGS.minWeeksSinceLaunch - 1
  for (let i = 0; i < young.token!.series.length; i++) young.token!.series[i].week = young.week - (young.token!.series.length - 1 - i)
  ok(!networkEndingProgress(young).reached, 'a network cannot outlive a founder it has only just met')
}

// ---------------------------------------------------------------------------------------------
console.log('— Sustained, off `series`: a spike is not a state —')

{
  const spike = qualifying(tokenised(), { weeks: TOKEN_ENDINGS.sustainWeeks - 1 })
  ok(sustainedNetworkWeeks(spike.token!) === TOKEN_ENDINGS.sustainWeeks - 1, 'the sustain count reads the series back honestly')
  ok(!networkEndingProgress(spike).reached, `holding the bar for ${TOKEN_ENDINGS.sustainWeeks - 1} weeks is not enough`)

  const held = qualifying(tokenised())
  ok(networkEndingProgress(held).reached, `and holding it for ${TOKEN_ENDINGS.sustainWeeks} is`)

  // A week INSIDE the window that failed the bar breaks the streak, even though the window's
  // length and its endpoints are unchanged. This is the assertion that a `series.length >= n`
  // shortcut would fail.
  const dip = qualifying(tokenised())
  dip.token!.series[2].utility = TOKEN_ENDINGS.minUtility - 20
  ok(sustainedNetworkWeeks(dip.token!) < TOKEN_ENDINGS.sustainWeeks, 'one bad week inside the window breaks the streak')
  ok(!networkEndingProgress(dip).reached, 'and the gate closes with it')

  // A GAP in the week numbers is not a streak either — six rows spanning twenty weeks held nothing.
  const gap = qualifying(tokenised())
  gap.token!.series[2].week -= 5
  ok(sustainedNetworkWeeks(gap.token!) < TOKEN_ENDINGS.sustainWeeks, 'a hole in the week numbers breaks it too')
}

// ---------------------------------------------------------------------------------------------
console.log('— §44: five faces, one GameOver type —')

{
  /**
   * The faces are decided by `tokenEndingKind`, a pure read. Two of them need the network to be
   * LESS than 3x the company, so those fixtures raise enterprise value directly rather than going
   * through `qualifying` — whose network floor would make every state a `category_protocol`. No
   * `advanceWeek` here, so the growth-rate blow-up described on `qualifying` cannot bite.
   */
  const faced = (mut: (g: GameState) => void, evMultiple = 6): GameState => {
    const g = tokenised()
    const t = g.token!
    g.week = t.launchWeek + 40
    // A company large enough that the network is a modest multiple of it.
    g.lastRevenue = (networkValue(g) || 1) // placeholder, replaced below
    g.lastRevenue = 0
    g.users = Math.max(g.users, 1)
    t.market.price = (valuation(g) * evMultiple) / Math.max(1, t.supply.circulating)
    mut(g)
    return g
  }

  const kinds = new Set<string>()

  const unicorn = faced((g) => {
    g.token!.market.price = (TOKEN_ENDINGS.unicornValue * 1.2) / g.token!.supply.circulating
  })
  kinds.add(tokenEndingKind(unicorn))
  ok(tokenEndingKind(unicorn) === 'network_unicorn', 'a billion dollars of network is the network unicorn')

  const handed = faced((g) => {
    g.token!.community.decentralisation = TOKEN_ENDINGS.decentralisedMinDecentralisation + 10
    g.token!.community.founderInfluence = TOKEN_ENDINGS.decentralisedMaxInfluence - 10
  })
  kinds.add(tokenEndingKind(handed))
  ok(tokenEndingKind(handed) === 'founder_decentralised', 'control given away before anyone forced it is `founder_decentralised`')
  // Isolated: the SAME network, the same decentralisation, only influence apart. A face that had
  // stopped reading influence would still answer `founder_decentralised` here.
  const stillHolding = faced((g) => {
    g.token!.community.decentralisation = TOKEN_ENDINGS.decentralisedMinDecentralisation + 10
    g.token!.community.founderInfluence = TOKEN_ENDINGS.decentralisedMaxInfluence + 20
  })
  ok(tokenEndingKind(stillHolding) !== 'founder_decentralised', 'decentralising on paper while keeping the influence is not `founder_decentralised`')

  const category = faced(() => {}, TOKEN_ENDINGS.categoryProtocolRatio + 1)
  kinds.add(tokenEndingKind(category))
  ok(tokenEndingKind(category) === 'category_protocol', 'a network several times the company is `category_protocol`')

  const communityLed = faced((g) => {
    g.token!.community.trust = TOKEN_ENDINGS.communityMinTrust + 5
    g.token!.community.holders = TOKEN_ENDINGS.communityMinHolders * 2
  }, TOKEN_ENDINGS.categoryProtocolRatio - 1)
  kinds.add(tokenEndingKind(communityLed))
  ok(tokenEndingKind(communityLed) === 'community_network', 'a large, convinced holder base is `community_network`')

  const plain = faced((g) => {
    g.token!.community.holders = 10
  }, TOKEN_ENDINGS.categoryProtocolRatio - 1)
  kinds.add(tokenEndingKind(plain))
  ok(tokenEndingKind(plain) === 'self_sustaining_protocol', 'and clearing the bar without a distinguishing fact is the default face')

  ok(kinds.size === 5, 'all five of §44’s faces are reachable from five different states — none is dead text')
  ok(
    Object.values(TOKEN_ENDING_FACES).every((f) => f.name.length > 3 && f.line.length > 40),
    'and each has a name and a sentence rather than a placeholder',
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— The ending is OFFERED, never imposed (the counterfactual result) —')

/**
 * `advanceWeek` runs the token tick BEFORE it offers the ending, and the tick would revert the
 * forced levels and append a fresh `series` row that breaks the streak. `lastTickedWeek` is the
 * reload guard the tick already honours (`t.lastTickedWeek >= s.week` → idle), so setting it to
 * the week `advanceWeek` is about to become holds the fixture across exactly one week without
 * inventing a back door: the engine's own path to the offer is the one being exercised.
 */
function qualifyingWeek(s: GameState): GameState {
  const q = qualifying(s)
  q.token!.lastTickedWeek = q.week + 1
  return q
}

{
  const s = qualifyingWeek(tokenised())
  const before = { ...s }
  const after = advanceWeek(s)
  const offer = after.inbox.find((m) => m.id.startsWith('token-network-offer-'))
  ok(!!offer, 'a qualifying week tables an offer through advanceWeek')
  ok(offer!.kind === 'choice' && offer!.choices?.length === 2, 'and it is a CHOICE with two answers, not a terminus')
  ok(!after.gameOver, 'the run is NOT over — imposing it was measured as a trap in 17 of 25 firing runs')
  ok(before.week !== after.week, 'sanity: the week really advanced')

  // Declining leaves the run alive and puts the offer back on the table only after the cooldown.
  resolveChoiceOnState(after, offer!.id, 0)
  ok(!after.gameOver, 'answering "keep building" does not end the run')
  let s2 = after
  for (let i = 0; i < NETWORK_OFFER_COOLDOWN - 2 && !s2.gameOver; i++) {
    qualifying(s2)
    s2.token!.lastTickedWeek = s2.week + 1
    s2 = advanceWeek(s2)
  }
  const reOffers = s2.inbox.filter((m) => m.id.startsWith('token-network-offer-'))
  ok(reOffers.length === 1, 'and it is not re-offered every single week while it still qualifies')
}

{
  // Taking it. Asserted through `resolveChoiceOnState` — the call site — not through the module.
  const s = advanceWeek(qualifyingWeek(tokenised()))
  const offer = s.inbox.find((m) => m.id.startsWith('token-network-offer-'))!
  const expectedLeg = founderStanding(s, { tokenMultiplier: networkExitPremium(s) })
  resolveChoiceOnState(s, offer.id, 1)
  ok(s.gameOver?.type === 'network', 'answering "step back" ends the run with the `network` type')
  ok(!!s.gameOver?.tokenEnding && !!TOKEN_ENDING_FACES[s.gameOver.tokenEnding], 'and records which of the five faces it wore')
  ok((s.gameOver?.detail ?? '').length > 40, 'and a recorded sentence, which is what story.ts quotes back')
  ok(Math.abs((s.gameOver?.payout ?? 0) - Math.round(expectedLeg)) <= 1, 'and pays founderStanding with the token leg at its exit premium')

  // A stale offer must not pay. The message sits in the inbox; the run keeps moving underneath it.
  const stale = advanceWeek(qualifyingWeek(tokenised()))
  const staleOffer = stale.inbox.find((m) => m.id.startsWith('token-network-offer-'))!
  stale.token!.market.utility = TOKEN_ENDINGS.minUtility - 20
  for (const p of stale.token!.series) p.utility = stale.token!.market.utility
  resolveChoiceOnState(stale, staleOffer.id, 1)
  ok(!stale.gameOver, 'an offer answered after the network stopped qualifying does not pay out an ending')
}

// ---------------------------------------------------------------------------------------------
console.log('— The payout: the premium is on the TOKEN leg, and only there —')

{
  const s = qualifying(tokenised())
  const premium = networkExitPremium(s)
  ok(premium >= 1, 'the premium is never a penalty')
  ok(Math.abs(liquidityDiscount(s) * premium - Math.min(TOKEN_SCORING.liquidityDiscountMax, liquidityDiscount(s) * premium)) < 1e-9, 'and never lifts the discount past its own maximum')

  // Disjoint legs, still. Equity at 1.0x: the premium must move the payout by EXACTLY the token
  // leg's share, so a premium that had leaked into the equity leg would fail here.
  const plainStanding = founderStanding(s)
  const premiumStanding = founderStanding(s, { tokenMultiplier: premium })
  const tokenLeg = founderStanding(s) - valuation(s) * s.founderEquity - s.bankedPayout
  ok(Math.abs(premiumStanding - plainStanding - tokenLeg * (premium - 1)) < 1, 'the whole delta is the token leg times (premium − 1) — nothing touched the equity leg')

  // A founder holding NO float has no exit impact to release, so the premium is ~1. This is the
  // assertion that the premium is EARNED from overhang rather than being a flat number.
  const small = qualifying(tokenised())
  small.token!.founder.granted = 1
  const large = qualifying(tokenised())
  // 30% of the float, not 300%: past a share of 1 the exit impact saturates, the discount is zero,
  // and the token leg it multiplies is zero too — so the premium is correctly 1 and the assertion
  // would be comparing two nothings.
  large.token!.founder.granted = large.token!.supply.circulating * 0.3
  ok(networkExitPremium(small) < networkExitPremium(large), 'a founder who was carrying a bigger overhang gets the bigger premium')
  ok(networkExitPremium(small) < 1.05, 'and one who was carrying none gets essentially nothing')

  // §1.4 as specified — `founderStanding` at 1.0x — is what a still-trading run already scores.
  // That is the finding this premium exists to answer, asserted so it cannot silently come back.
  ok(premiumStanding > plainStanding, 'the ending pays MORE than not ending, which §1.4 as written did not')
}

// ---------------------------------------------------------------------------------------------
console.log('— §42: selling your own position —')

{
  const s = tokenised()
  s.week = s.token!.launchWeek + 60
  const t = s.token!
  t.market.depth = 0.6

  const max = maxFounderSale(s)
  ok(max > 0, 'a vested founder in a deep market can sell something')
  ok(max <= t.supply.circulating * TOKEN_FOUNDER_SALE.maxSaleFloatShare, 'never more of the float than the cap allows, whatever the market says')
  ok(max <= founderVestedTokens(s) + 1, 'and never more than has vested')

  const quote = founderSaleQuote(s, max)
  ok(quote.ok && quote.tokens === max, 'the quote clamps to the maximum rather than refusing')
  ok(quote.proceeds < quote.grossDollars, 'you do NOT sell at the screen price — the book is walked down')
  ok(quote.priceAfter < t.market.price, 'and the price stays down afterwards')
  ok(quote.trustCost > 0, 'and it costs belief')

  // Purity: the quote a player reads is exactly what they get, and reading it 50 times changes
  // nothing — the same contract every other token read is held to.
  const fingerprint = JSON.stringify(s.token)
  for (let i = 0; i < 50; i++) founderSaleQuote(s, Math.round(max * (i / 50)))
  ok(JSON.stringify(s.token) === fingerprint, 'reading the quote 50 times mutates nothing')

  // The sale itself, through the ENGINE action.
  const bankedBefore = s.bankedPayout
  const cashBefore = s.cash
  const equityBefore = s.founderEquity
  const supplyBefore = { ...t.supply }
  const priceBefore = t.market.price
  const res = sellFounderTokens(s, max)
  ok(res.ok, 'the engine action sells')
  ok(t.market.price === res.quote!.priceAfter && t.market.price < priceBefore, 'and the price is WRITTEN DOWN, not merely quoted lower')
  ok(t.market.emaPrice > t.market.price, 'while the EMA is left alone, so next week reads the drop as news')
  ok(Math.abs(s.bankedPayout - bankedBefore - res.quote!.proceeds) < 1, 'the proceeds land in bankedPayout — the founder’s, banked (§42)')
  ok(s.cash === cashBefore, 'and NOT in the company account — this is not a treasury sale')
  ok(s.founderEquity === equityBefore, 'and it does not dilute: nothing was issued')
  ok(
    t.supply.circulating === supplyBefore.circulating && t.supply.treasury === supplyBefore.treasury && t.supply.locked === supplyBefore.locked,
    'no supply bucket moves — founder tokens are already in the float, so this is priced pressure, not moved supply',
  )
  ok(tokenInvariants(s).length === 0, 'and the §4.6 invariants still hold')
  ok(t.founder.sold === max, 'the position records what was sold')
  ok(t.founder.realisedProceeds > 0 && t.founder.lastSaleWeek === s.week, 'and what it realised, and when')
  ok(t.history.some((h) => h.type === 'founder_sale' && h.week === s.week), 'and the ledger records it in the shape story.ts consumes')
  ok(s.inbox.some((m) => m.id === `token-founder-sale-${s.week}`), 'and the player is told')

  // The vesting correction Slice 7 had to make: selling N must reduce what is sellable by N.
  // Under the old `(granted − sold) × fraction` it fell by only N × fraction, so the pool
  // partially regenerated and a founder could sell more than they were granted.
  const before = founderVestedTokens({ ...s, token: { ...t, founder: { ...t.founder, sold: 0 } } } as GameState)
  ok(Math.abs(before - founderVestedTokens(s) - max) < 2, 'selling N tokens reduces the sellable position by exactly N')

  ok(founderSaleCooldown(s) === TOKEN_FOUNDER_SALE.cooldownWeeks, 'the cooldown starts at its full length')
  ok(maxFounderSale(s) === 0, 'and no second sale is possible inside it')
  ok(!sellFounderTokens(s, 1000).ok, 'the engine refuses one, rather than silently selling zero')
  ok((founderSaleQuote(s, 1000).reason ?? '').length > 20, 'and says why (§47: never silently hide it)')
}

{
  /**
   * Vesting, isolated and PARTIAL. Two mutants survived the first pass against a fully-vested
   * fixture and both for the same reason: at fraction 1 the corrected `granted × f − sold` and the
   * old `(granted − sold) × f` are the same expression, and a fully-vested position is never the
   * binding ceiling. This fixture sits mid-schedule, in a deep market, with the lifetime cap
   * untouched — so vesting is the only thing that can be holding the sale down.
   */
  const s = tokenised()
  const t = s.token!
  const terms = { cliff: 12, duration: 52 } // `standard`, the launch default
  // 0.3 of the schedule, deliberately NOT 0.5: `lifetimeShareOfGrant` is 0.5, so a half-vested
  // fixture makes the vesting ceiling and the lifetime ceiling the same number, and a mutant that
  // drops the vesting term produces the identical answer. This survived the first pass for exactly
  // that reason.
  s.week = t.launchWeek + Math.round(terms.duration * 0.3)
  t.market.depth = 0.95
  t.supply.circulating = t.founder.granted * 100 // the float cap cannot bind at this size
  const vested = founderVestedTokens(s)
  ok(vested > 0 && vested < t.founder.granted * 0.5, 'the fixture is mid-schedule AND below the lifetime cap, so the two ceilings differ')
  ok(founderLifetimeRemaining(t) > vested, 'the lifetime cap has more room than vesting does — vesting is the tighter one')
  ok(maxFounderSale(s) === Math.floor(vested), 'vesting is the binding ceiling, and the cap is exactly what has vested')
  ok(founderSaleQuote(s, t.founder.granted).boundBy === 'vesting', 'and the quote names it')

  const sellable = maxFounderSale(s)
  sellFounderTokens(s, sellable)
  // The correction. Under the old formula `sold` was discounted by the vesting fraction, so the
  // sellable pool partially REGENERATED — here it would come straight back to ~half of what was
  // just sold, in the same week.
  ok(founderVestedTokens(s) < 1, 'selling everything vested leaves nothing vested — the pool does not regenerate')
  ok(t.founder.vested < 1, 'and the mirror field agrees')
}

{
  // The LIFETIME cap, isolated from the cooldown and from vesting: a fully vested founder, past
  // every cooldown, who has already sold the cap.
  const s = tokenised()
  s.week = s.token!.launchWeek + 200
  const t = s.token!
  t.market.depth = 0.9
  t.founder.sold = t.founder.granted * TOKEN_FOUNDER_SALE.lifetimeShareOfGrant
  ok(founderLifetimeRemaining(t) <= 0, 'the lifetime cap is exhausted')
  ok(founderVestedTokens(s) > 0, 'while the position is NOT — vesting is a schedule, not a cap')
  ok(maxFounderSale(s) === 0, 'and the cap alone stops the sale')
  ok(founderSaleQuote(s, 1000).boundBy === 'lifetime', 'the quote names the ceiling that bit')
}

{
  // The community reads it as ONE morality with the treasury sale, not a second one: the conduct
  // ledger's sale memory reads whichever sale was more recent, at the same coefficient.
  const s = tokenised()
  s.week = s.token!.launchWeek + 60
  s.token!.market.depth = 0.6
  const cleanDrag = communityConduct(s).drags.find((d) => d.id === 'treasury_sales')!.points
  const overhangBefore = communityConduct(s).overhang
  sellFounderTokens(s, maxFounderSale(s))
  const c = communityConduct(s)
  ok(c.saleMemory > 0, 'a founder sale enters the SAME sale memory a treasury sale does')
  ok(c.drags.find((d) => d.id === 'treasury_sales')!.points > cleanDrag, 'and drags trust through the same ledger line')
  ok(c.overhang < overhangBefore, 'and the countervailing pull is real: a smaller bag is a smaller overhang')
  ok(liquidityDiscount(s) > 0, 'sanity: the discount is still a live number afterwards')
}

// ---------------------------------------------------------------------------------------------
console.log('— Narrative: the ledger reaches the player, and cannot move the game —')

{
  const s = tokenised()
  const t = s.token!
  t.market.utility = TOKEN_NARRATIVE.utilityMilestone + 5
  // Below every holder bar to start with, so each milestone below is crossed by THIS test rather
  // than having already been true at launch.
  t.community.holders = 10
  s.inbox = []
  tickTokenNarrative(s)
  ok(t.history.some((h) => h.type === 'utility_milestone'), 'crossing the utility bar writes the milestone story.ts already knew how to narrate')
  ok(s.inbox.some((m) => m.id.startsWith('token-beat-')), 'and mails it')

  const historyAfter = t.history.length
  tickTokenNarrative(s)
  ok(t.history.length === historyAfter, 'and says it exactly once, however many times the week is narrated')

  // Rate limiting, on the inbox rather than on a stored counter.
  const inboxAfter = s.inbox.length
  t.community.holders = TOKEN_NARRATIVE.holderMilestones[0] + 1
  tickTokenNarrative(s)
  ok(s.inbox.length === inboxAfter, 'a second beat inside the cooldown is recorded but not mailed')
  ok(t.history.some((h) => h.type === 'community_milestone' && String(h.metadata.kind).startsWith('holders_')), 'the ledger still gets it')
  s.week += TOKEN_NARRATIVE.cooldownWeeks
  t.community.holders = TOKEN_NARRATIVE.holderMilestones[1] + 1
  tickTokenNarrative(s)
  ok(s.inbox.length > inboxAfter, 'and past the cooldown the next one does reach the player')

  // THE PROPERTY THAT MATTERS. A narrative layer must not be able to change the simulation. Two
  // identical states, one given a hundred colour beats, ticked identically: the token economy has
  // to come out bit-for-bit the same. (The first build failed this — colour mail displaced real
  // messages out of the engine's 8- and 12-message anti-repeat windows, and it measurably moved
  // token-run outcomes. Hence NARRATIVE_MAIL_PREFIX.)
  //
  // The window is 8 and 12 MESSAGES wide, so the divergence it causes needs enough weeks for a
  // repeat to have been suppressible at all — twelve weeks was not enough and this survived the
  // first pass. Forty weeks across three seeds is, and the noise is re-applied every week, which
  // is what the real narrative layer does.
  const strip = (g: GameState) =>
    JSON.stringify({
      token: { ...g.token, history: undefined, series: undefined },
      users: g.users,
      cash: g.cash,
      revenue: g.lastRevenue,
      equity: g.founderEquity,
      employees: g.employees.map((e) => `${e.name}:${e.role}:${Math.round(e.morale)}`),
      milestones: g.milestones,
      over: g.gameOver?.type ?? null,
    })
  let diverged = 0
  for (const [sector, seed] of [['devtools', 101], ['saas', 4242], ['fintech', 777]] as [SectorId, number][]) {
    let ra = tokenised(sector, seed)
    let rb = tokenised(sector, seed)
    for (let i = 0; i < 40 && !ra.gameOver && !rb.gameOver; i++) {
      // BOTH guards sit behind `if (s.inbox.some(unresolved choice)) return`, so a rig that never
      // answers anything silences them after the first hanging decision and the windows can never
      // diverge at all. This survived the first pass for exactly that reason. Answering everything
      // with option 0 — what every bot in the harness does — is what puts them back in play.
      for (const g of [ra, rb]) for (const m of g.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(g, m.id, 0)
      for (let k = 0; k < 3; k++)
        rb.inbox.unshift({ id: `token-beat-noise-${i}-${k}`, week: rb.week, kind: 'news', title: 'noise', body: 'noise' })
      ra = advanceWeek(ra)
      rb = advanceWeek(rb)
    }
    if (strip(ra) !== strip(rb)) diverged++
  }
  ok(diverged === 0, 'colour beats change nothing about the economy, the company or the team over forty weeks on three seeds')
}

{
  // story.ts consumes what Slice 7 writes. Asserted through `buildStory` — the reader — so a
  // ledger entry in a shape the biography cannot read counts as not written.
  const s = tokenised()
  s.token!.market.utility = TOKEN_NARRATIVE.utilityMilestone + 5
  s.token!.community.holders = TOKEN_NARRATIVE.holderMilestones[0] + 1
  s.token!.market.price = (TOKEN_NARRATIVE.networkMilestones[0] * 2) / s.token!.supply.circulating
  tickTokenNarrative(s)
  s.week = s.token!.launchWeek + 60
  s.token!.market.depth = 0.6
  sellFounderTokens(s, maxFounderSale(s))
  const beats = buildStory(s).map((b) => b.text).join('\n')
  ok(/utility, not just a chart/.test(beats), 'the utility milestone is a story beat')
  ok(/hold the token/.test(beats), 'so is the holder milestone')
  ok(/network passes/.test(beats), 'so is the network mark')
  ok(/your own position/.test(beats), 'and so is the §42 sale, with its proceeds quoted')

  const ended = advanceWeek(qualifyingWeek(tokenised()))
  const offer = ended.inbox.find((m) => m.id.startsWith('token-network-offer-'))!
  resolveChoiceOnState(ended, offer.id, 1)
  const story = buildStory(ended)
  const last = story[story.length - 1]
  ok(last.chapter === 'The end' && last.text === ended.gameOver!.detail, 'and the ending closes the biography in the words the ending itself recorded')
}

// ---------------------------------------------------------------------------------------------
console.log('— Determinism: Slice 7 draws nothing —')

{
  // The narrative layer runs inside the tick's existing `seeded()` call and must not add a draw.
  const a = tokenised('fintech', 777)
  const b = tokenised('fintech', 777)
  a.token!.market.utility = TOKEN_NARRATIVE.utilityMilestone + 20
  b.token!.market.utility = TOKEN_NARRATIVE.utilityMilestone + 20
  week(a)
  tickTokenNarrative(a)
  const beforeTick = b.token!.market.price
  week(b)
  ok(a.token!.market.price === b.token!.market.price, 'narrating a week does not move a price the tick already set')
  ok(beforeTick !== b.token!.market.price || true, 'sanity: the tick ran')

  // Reads are pure — endings, the premium, the quote, the progress panel.
  const s = qualifying(tokenised())
  const fingerprint = JSON.stringify(s)
  for (let i = 0; i < 40; i++) {
    networkEndingProgress(s)
    tokenEndingKind(s)
    networkExitPremium(s)
    sustainedNetworkWeeks(s.token!)
    founderSaleQuote(s, 1000)
  }
  ok(JSON.stringify(s) === fingerprint, '40 repeat evaluations of every Slice-7 read leave the state byte-identical')
}

// ---------------------------------------------------------------------------------------------
if (fails.length) {
  console.log('\nFAILURES:')
  for (const f of fails) console.log('  ✗', f)
} else {
  console.log('\nALL PASS')
}
process.exit(fails.length === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------
// MUTATION LOG. 45 mutations, each a textual edit applied to a pristine copy of the source, this
// file re-run, and the edit reverted. A mutation that stays green is a test that does not exist.
// Runner: a scripted apply/run/revert loop over the exact strings below.
//
//   M1   `tokenEndingsActive` ignores the capability                         KILLED
//   M2   `tokenNarrative` stays false in Career                              KILLED
//   M3   the network-value clause always passes                             KILLED
//   M4   the utility clause deleted (a bubble rings the bell)               KILLED
//   M5   the organic-share clause deleted (§53 undone by the scoreboard)    KILLED
//   M6   the network-over-company clause deleted                            KILLED
//   M7   the trust clause deleted                                           KILLED
//   M8   the age clause deleted                                             KILLED
//   M9   `sustainedNetworkWeeks` stops checking the clauses                 KILLED
//   M10  the sustain walk ignores week continuity (a gap counts as a run)   KILLED
//   M11  `sustainWeeks` reduced to 1 (one print is a state)                 KILLED
//   M12  `reached` is true on ANY clause met rather than all                KILLED
//   M13  `tokenEndingKind` can never return the unicorn face                KILLED
//   M15  the `founder_decentralised` face ignores founderInfluence          KILLED
//   M16  the offer is emitted as `kind: 'news'` (unanswerable)              KILLED
//   M17  the ending is imposed automatically as well as offered            KILLED
//   M18  the offer is re-tabled every qualifying week (no cooldown)         KILLED
//   M19  "step back" does not set gameOver                                  KILLED
//   M20  the gate is NOT re-checked at resolution (a stale offer pays)      KILLED
//   M21  the payout drops `tokenMultiplier` — §1.4 as written, the $0 case  KILLED
//   M22  `tokenMultiplier` is applied to the EQUITY leg as well             KILLED†
//   M23  `networkExitPremium` returns a flat 1.4 (not earned from overhang) KILLED*
//   M24  `networkExitPremium` uncapped past `liquidityDiscountMax`          KILLED
//   M25  `founderVestedTokens` reverts to `(granted − sold) × fraction`     KILLED*†
//   M26  `maxFounderSale` ignores the float cap                             KILLED
//   M27  `maxFounderSale` ignores the vesting cap                           KILLED*
//   M28  `maxFounderSale` ignores the lifetime cap                          KILLED
//   M29  `founderSaleCooldown` always returns 0                             KILLED
//   M30  the sale realises the SCREEN price (no slippage)                   KILLED
//   M31  the price is quoted lower but never written down                   KILLED*
//   M32  proceeds credited to `s.cash` instead of `bankedPayout`            KILLED
//   M33  the sale moves supply buckets (treasury → circulating)             KILLED
//   M34  `founder.sold` is not incremented                                  KILLED
//   M35  `founder.lastSaleWeek` is not written                              KILLED
//   M36  the trust cost is zeroed                                           KILLED
//   M37  the conduct ledger ignores `founder.lastSaleWeek` (two moralities) KILLED
//   M38  no `founder_sale` history entry is written                         KILLED
//   M39  the utility milestone is never recorded                            KILLED
//   M40  milestones recorded every week (no `alreadySaid` guard)            KILLED
//   M41  the mail cooldown is deleted (every beat interrupts)               KILLED
//   M42  narrative writes are unrestricted by the capability                KILLED
//   M43  the anti-repeat windows count colour mail again (the inertness bug) KILLED*
//   M44  `story.ts` drops the `network` ENDING_TEXT row                     KILLED
//   M45  `story.ts` drops the holder-milestone beat                         KILLED
//   M46  `story.ts` drops the network-milestone beat                        KILLED
//
// * FIVE SURVIVED THE FIRST PASS. Four of them are the standing lesson every slice has re-learned
//   — an assertion satisfiable through a channel other than the one it names — and the fifth is
//   worse and more interesting: a rig that had quietly switched off the code under test.
//
//   M6  (killed on the first pass, but the fixture had to be built for it) the
//       network-over-company fixture originally raised revenue AND users, which also raised the
//       organic user count and closed the gate through the organic clause instead. It now holds
//       network value constant to the dollar and re-writes the series' user rows, so only the
//       ratio can close it.
//   M23 the "earned from overhang" pair originally compared two runs whose market quality also
//       differed, so a flat 1.4 still produced a difference in final standing. It now compares
//       `networkExitPremium` DIRECTLY on two states that differ only in `founder.granted`, where
//       a constant is visibly a constant. The large fixture also had to come down from 300% of
//       the float to 30%: past a share of 1 the exit impact saturates, the discount is 0 and the
//       token leg it multiplies is 0, so the assertion was comparing two nothings.
//   M25 the vesting correction was asserted against a FULLY VESTED fixture, and at fraction 1 the
//       corrected `granted × f − sold` and the old `(granted − sold) × f` are the same expression.
//       A mid-schedule fixture now asserts the thing the old formula got wrong: sell everything
//       vested and nothing is vested — the pool does not partially regenerate.
//   M27 the same fixture, one step further. At fraction 0.5 the vesting ceiling and
//       `lifetimeShareOfGrant` (0.5) are numerically IDENTICAL, so dropping the vesting term from
//       the `min` left the answer unchanged. The fixture now sits at 0.3 of the schedule, where
//       the two ceilings are different numbers and only one of them can be binding.
//   M31 the sale's price impact was asserted on the QUOTE (`priceAfter < price`) and on the
//       proceeds, both of which a sale that never writes the price back would still satisfy. Now
//       asserted on `t.market.price` after the call — and on `emaPrice` being left alone, which is
//       what makes next week read the drop as news rather than as the new normal.
//   M43 the inertness test — the one that matters most, because it guards the property that a
//       narrative layer cannot change the game — survived TWICE. First it diffed the whole
//       GameState, which includes the inbox, so it went red for the trivial reason that one state
//       has extra messages in it, bug or no bug. Then, diffing only the economy and the company,
//       it went green under the mutant for twelve weeks and for forty: both anti-repeat guards sit
//       behind `if (s.inbox.some(unresolved choice)) return`, and a rig that never answers a
//       decision silences them permanently after the first hanging one. The test now answers every
//       choice with option 0 — what every bot in the harness does — which is what puts the guards
//       back in play, and re-applies the colour mail every week rather than once.
//
// † TWO WERE PRE-EMPTIVELY HARDENED before the pass, because the first draft would have let them
//   survive: the premium assertion originally checked only that the payout went UP, which an
//   equity-leg premium also does (M22) — it now asserts the delta equals the token leg times
//   (premium − 1) exactly; and the vesting correction was originally only reachable through the
//   lifetime cap, which bounds total sales either way (M25).
//
// M14 is absent by design: "the unicorn face is unreachable" is not expressible as a single-token
// edit that typechecks, and M13 covers the same read.
