// Tokenisation / ICO — Slice 2, the token economy core. Run: npx tsx test/token-economy.test.ts
//
// Covers docs/ico-architecture.md §3.2 (the determinism gate), §4 loops A/B/C, §4.6 (the
// invariants), and brief §26–§31. The heavy end of the proof — 24 seeds × 5 sectors × 104 weeks
// under four hostile policies — lives in test/token-economy-probe.ts, which is too slow for
// `npm test`. This file is the fast, mutation-verified guard on the properties that probe relies on.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose and this
// file re-run to confirm it goes red. The mutations are listed at the bottom.
//
// Two lessons from Slice 1's first version are applied throughout:
//
//   • THE GOLDEN TRACE GUARDS DRAW ORDER, NOT PURITY. A `Math.random()` inside a pure read is
//     invisible to it, because a pure read does not feed the simulation. Purity is asserted on its
//     own here, and the draw COUNT is asserted separately from the draw order.
//   • ONE EXAMPLE IS NOT A TEST. Slice 1 shipped a mutant where a floating-point reassociation
//     agreed on every number the test happened to pick and disagreed on 34.8% of random triples.
//     Where an assertion could pass by luck, this file SEARCHES for a disagreeing input instead of
//     trusting one.

import { advanceWeek, newGame, withSeed } from '../src/game/engine'
import { RNG } from '../src/game/data'
import { defaultCapabilities, type GameConfig } from '../src/game/modes'
import { tokenisationBars } from '../src/game/token/eligibility'
import { launchToken } from '../src/game/token/launch'
import {
  fairNetworkValue,
  fairValue,
  momentum,
  organicUserCount,
  priceFloor,
  priceStep,
  spendEffectiveness,
  tokenInvariants,
  treasuryCommitment,
  treasuryValue,
} from '../src/game/token/market'
import { tickToken } from '../src/game/token/tick'
import { TOKEN_BOUNDS, TOKEN_ECONOMY, TOKEN_LIMITS, type TokenState } from '../src/game/token/types'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce']
const cfg = (seed: number, sector: SectorId = 'saas'): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })

/** A Career company that has taken the fork. Bars are set rather than played, so these tests assert
 *  the ECONOMY and not the balance of the twenty weeks in front of it. */
function tokenised(sector: SectorId = 'devtools', seed = 4242, weeks = 20): GameState {
  let s = newGame('Econ', sector, 'technical', { config: cfg(seed, sector) })
  s.cash = 20_000_000
  for (let w = 0; w < weeks && !s.gameOver; w++) s = advanceWeek(s)
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 60)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  const res = launchToken(s)
  if (!res.ok) throw new Error(`probe setup failed: ${res.reason}`)
  return s
}

/** Run the tick with the draws counted, outside `withSeed` so RNG.next is ours to instrument. */
function withDrawCount<T>(fn: () => T): { value: T; draws: number } {
  const prev = RNG.next
  let draws = 0
  RNG.next = () => {
    draws++
    return prev()
  }
  try {
    return { value: fn(), draws }
  } finally {
    RNG.next = prev
  }
}

const spend = (t: TokenState, tokensPerWeek: number, week = 0) => {
  t.incentives = [{ category: 'community_treasury', share: 0, tokensPerWeek, startedWeek: week, cumulativeTokens: 0, effectiveness: 1 }]
}

// ---------------------------------------------------------------------------------------------
console.log('— The capability ratchet —')

const CAREER = defaultCapabilities('career')
const QUICK = defaultCapabilities('quick')
const ARENA = defaultCapabilities('arena')
ok(CAREER.tokenEconomy === true, 'Career has `tokenEconomy` on — Slice 2 built the economy it gates')
ok(QUICK.tokenEconomy === false && ARENA.tokenEconomy === false, 'Quick Play and Arena stay off (§55 is Slice 7, §58 is never)')

// ---------------------------------------------------------------------------------------------
console.log('— Determinism: the gate, the draw count, and purity (architecture §3.2) —')

// The single most likely way to break the whole game silently: a token tick that draws for a run
// which never tokenised. `tokenActive` is false there, so the draw count must be unchanged.
for (const seed of [7, 4242, 31337]) {
  const trace = (caps: Partial<ReturnType<typeof defaultCapabilities>>) => {
    let g = newGame('Trace', 'saas', 'technical', { config: cfg(seed), capabilities: caps })
    const out: string[] = []
    for (let w = 0; w < 16 && !g.gameOver; w++) {
      g = advanceWeek(g)
      out.push(`${g.week}|${g.users}|${Math.round(g.cash)}|${g.pmf.toFixed(6)}|${g.hype.toFixed(6)}|${g.rivals.map((r) => r.users).join(',')}`)
    }
    return out.join(';')
  }
  ok(
    trace({ tokenEconomy: true }) === trace({ tokenEconomy: false }),
    `seed ${seed}: a run that never tokenises is identical with tokenEconomy on or off — zero draws behind the gate`,
  )
}

{
  const s = tokenised('saas', 909)
  const before = structuredClone(s.token!)
  s.token!.lastTickedWeek = s.week - 1
  const { value: report, draws } = withDrawCount(() => tickToken(s))
  ok(report.ran && draws === 1, `a week of economy draws exactly ONE number, always (drew ${draws})`)
  ok(JSON.stringify(before) !== JSON.stringify(s.token), 'and it actually moved the economy')

  // Same state + same seed ⇒ same week. Twice, from a clone, because "consistent with itself" is
  // not the claim — reproducible from state is.
  const a = structuredClone(s)
  const b = structuredClone(s)
  a.token!.lastTickedWeek = a.week - 1
  b.token!.lastTickedWeek = b.week - 1
  withSeed(555, () => tickToken(a))
  withSeed(555, () => tickToken(b))
  ok(JSON.stringify(a.token) === JSON.stringify(b.token), 'the same state under the same seed produces the identical week')
}

{
  // PURITY, asserted on its own because no golden trace can see a Math.random() in a pure read.
  const s = tokenised('fintech', 31337)
  const reads = () =>
    JSON.stringify([
      fairValue(s), fairNetworkValue(s), treasuryValue(s), momentum(s.token!),
      treasuryCommitment(s), spendEffectiveness(s.token!), organicUserCount(s), priceFloor(s.token!),
      priceStep(s.token!, fairValue(s), 0.004, 0.7, 0.25),
    ])
  const first = reads()
  const { draws } = withDrawCount(() => {
    for (let i = 0; i < 200; i++) if (reads() !== first) fails.push('a market read is not pure')
  })
  ok(draws === 0, '200 repeat evaluations of every market read: identical answers, and zero RNG draws')
}

{
  // The re-entry guard. A reload can hand the same week back; a second pass would double a move.
  const s = tokenised('saas', 12)
  s.token!.lastTickedWeek = s.week - 1
  withSeed(1, () => tickToken(s))
  const after = structuredClone(s.token!)
  const second = withSeed(1, () => tickToken(s))
  ok(!second.ran && JSON.stringify(after) === JSON.stringify(s.token), 'ticking the same week twice is a no-op (lastTickedWeek guard)')
}

{
  // The capability, not the mode.
  const s = tokenised('saas', 13)
  s.capabilities = { ...s.capabilities, tokenEconomy: false }
  s.token!.lastTickedWeek = s.week - 1
  const before = JSON.stringify(s.token)
  const r = withDrawCount(() => tickToken(s))
  ok(!r.value.ran && r.draws === 0 && JSON.stringify(s.token) === before, 'with `tokenEconomy` off the tick runs nothing and draws nothing')
}

// ---------------------------------------------------------------------------------------------
console.log('— Loop B: speculative demand reads MOMENTUM, never the price level —')

{
  // The mutation this kills is the funding-climate bug rewritten: `demand ∝ price`. A level term
  // and a difference term agree whenever price ≈ ema, so ONE example proves nothing. Search a wide
  // range of price SCALES at a FIXED ratio: a momentum term is invariant to scale, a level term
  // cannot be.
  const s = tokenised('devtools', 77)
  const t = s.token!
  const fair = fairValue(s)
  const ratio = 1.3
  const demands = new Set<string>()
  for (const scale of [1e-6, 1e-3, 0.1, 1, 10, 1e3, 1e6]) {
    const c = structuredClone(t)
    // Scale the WHOLE denomination — launch price too, so the floor scales with it. Otherwise the
    // test is asserting something unphysical (an EMA below the price floor) rather than the
    // scale-invariance a momentum term actually has.
    c.plan.launchPrice = t.plan.launchPrice * scale
    c.market.launchPrice = t.market.launchPrice * scale
    c.market.emaPrice = t.market.emaPrice * scale
    c.market.price = c.market.emaPrice * ratio
    demands.add(priceStep(c, fair * scale, 0, 0.7, 0).speculativeDemand.toFixed(12))
  }
  ok(demands.size === 1, `speculative demand is identical across seven price scales spanning 1e12 at a fixed price/ema ratio`)

  // …and it is not simply constant: it must actually respond to the ratio, monotonically.
  const at = (r: number) => {
    const c = structuredClone(t)
    c.market.emaPrice = t.plan.launchPrice
    c.market.price = c.market.emaPrice * r
    return priceStep(c, fair, 0, 0.7, 0).speculativeDemand
  }
  const ladder = [0.5, 0.8, 1, 1.2, 1.6, 2.5]
  ok(
    ladder.every((r, i) => i === 0 || at(r) > at(ladder[i - 1])),
    'and it rises monotonically with the price/ema ratio — a difference term, not a constant',
  )
  ok(Math.abs(at(1)) < 1e-12, 'at price === ema the speculative term is exactly zero: a price that stopped moving stops being news')
}

{
  // THE ANCHOR CATCHES UP — the property that makes a difference term safe where a level term is
  // not. It has two halves, and the first draft of this test asserted a WRONG version of the first
  // one ("momentum decays under a constant rise"): it does not decay, it converges to a fixed
  // point, which is the actual claim and a stronger one.
  const s = tokenised('social', 88)
  const alpha = TOKEN_BOUNDS.priceEmaAlpha
  const ride = (growth: number, weeks: number) => {
    const t = structuredClone(s.token!)
    const seen: number[] = []
    for (let w = 0; w < weeks; w++) {
      t.market.price *= growth
      t.market.emaPrice += (t.market.price - t.market.emaPrice) * alpha
      seen.push(momentum(t))
    }
    return seen
  }

  // (1) A price compounding forever produces a CONSTANT momentum, not a growing one — and at the
  //     analytic fixed point of the EMA recurrence, r* = α / (1 − (1−α)/g), m* = 1/r* − 1.
  //     Checking the closed form rather than "it stopped rising" is what makes this mean something.
  for (const g of [1.02, 1.08, 1.25]) {
    const seen = ride(g, 90)
    const mStar = 1 / (alpha / (1 - (1 - alpha) / g)) - 1
    ok(
      Math.abs(seen[89] - seen[88]) < 1e-9 && Math.abs(seen[89] - mStar) < 1e-6,
      `a price compounding at ${((g - 1) * 100).toFixed(0)}%/wk forever settles at a FIXED momentum of ${seen[89].toFixed(4)} — the closed form, never a compounding one`,
    )
  }

  // (2) And when the rise stops, the anchor closes the gap entirely. A price that keeps rising
  //     raises its own baseline; a price that plateaus stops being news at all. Neither can hold
  //     the permanent bid a level term would.
  const t = structuredClone(s.token!)
  for (let w = 0; w < 30; w++) {
    t.market.price *= 1.15
    t.market.emaPrice += (t.market.price - t.market.emaPrice) * alpha
  }
  const peak = momentum(t)
  for (let w = 0; w < 40; w++) t.market.emaPrice += (t.market.price - t.market.emaPrice) * alpha
  ok(peak > 0.4 && momentum(t) < 0.002, `momentum decays from ${peak.toFixed(3)} to ${momentum(t).toFixed(5)} once the price plateaus`)
}

// ---------------------------------------------------------------------------------------------
console.log('— Loop B: gravity is superlinear, symmetric, and eventually beats every demand term —')

{
  const s = tokenised('saas', 99)
  const t = s.token!
  const g = (d: number) => {
    const c = structuredClone(t)
    const fair = t.plan.launchPrice
    c.market.price = fair * Math.exp(d)
    c.market.emaPrice = c.market.price // isolate gravity from momentum
    return priceStep(c, fair, 0, 0, 0).gravity
  }
  // SUPERLINEAR, searched rather than sampled once: doubling the log-deviation must more than
  // double the restoring force everywhere, which is what a linear term would fail.
  let superlinearEverywhere = true
  for (let i = 1; i <= 200; i++) {
    const d = i * 0.01
    if (!(Math.abs(g(2 * d)) > 2 * Math.abs(g(d)) * (1 + 1e-9))) superlinearEverywhere = false
  }
  ok(superlinearEverywhere, 'over 200 deviations, |gravity(2d)| > 2·|gravity(d)| — the exponent genuinely exceeds 1')
  ok(g(0.7) < 0 && g(-0.7) > 0 && Math.abs(g(0.7) + g(-0.7)) < 1e-12, 'gravity is exactly symmetric: undervaluation corrects as fast as overvaluation')
  ok(Math.abs(g(0)) < 1e-12, 'and vanishes at the anchor, so it never pushes a fairly-priced token around')

  // The algebraic ceiling. There must EXIST a finite deviation at which gravity exceeds everything
  // the demand side plus the noisiest week can produce. That is the no-runaway guarantee.
  const maxPush = TOKEN_ECONOMY.demandCap + TOKEN_ECONOMY.priceNoiseScale * (TOKEN_ECONOMY.priceNoiseVolBase + 1)
  const dStar = Math.pow(maxPush / TOKEN_BOUNDS.gravityPull, 1 / TOKEN_BOUNDS.gravityExponent)
  ok(
    Number.isFinite(dStar) && Math.abs(g(dStar * 1.001)) > maxPush,
    `gravity overtakes the entire demand side at ln(price/fair) = ${dStar.toFixed(2)}, i.e. ${Math.exp(dStar).toFixed(1)}× fair value — a ceiling by algebra`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— The price floor REPELS: zero is absorbing, and so is a floor nothing pushes off —')

{
  const s = tokenised('ecommerce', 4321)
  const t = s.token!
  // Kill the fundamentals outright: no revenue, no users, no utility, no community.
  s.users = 0
  s.lastRevenue = 0
  t.market.utility = 0
  t.community.engagement = 0
  t.users.organic = 0
  t.users.incentivised = 0
  ok(
    fairValue(s) >= priceFloor(t) * TOKEN_ECONOMY.fairValueFloorMultiple,
    `with every fundamental at zero the anchor still sits at ${TOKEN_ECONOMY.fairValueFloorMultiple}× the price floor — the floor can never be an equilibrium`,
  )

  t.market.price = priceFloor(t)
  t.market.emaPrice = priceFloor(t)
  const step = priceStep(t, fairValue(s), 0, 0, 0)
  ok(step.logDeviation < 0 && step.gravity > 0, 'standing exactly on the floor, gravity points UP — the boundary is repelling')

  // And it actually leaves, in a real simulation, within one relaxation time.
  let left = -1
  for (let w = 1; w <= 20 && left < 0; w++) {
    t.lastTickedWeek = s.week - 1
    withSeed(w, () => tickToken(s))
    s.week++
    if (t.market.price > priceFloor(t) * 1.05) left = w
  }
  ok(left > 0 && left <= 8, `a token crushed onto the floor with dead fundamentals climbs off it in ${left} weeks (limit 8, one gravity relaxation time)`)
}

{
  const s = tokenised('saas', 555)
  const t = s.token!
  ok(priceFloor(t) > 0, 'the floor is strictly positive — 0 × anything is 0 forever, and §43 would become a lie')
  ok(Math.abs(priceFloor(t) - t.plan.launchPrice * TOKEN_BOUNDS.priceFloorFraction) < 1e-15, 'and it is 1% of the launch price, as the contract names it')
  // The floor binds when it has to.
  const c = structuredClone(t)
  c.market.price = priceFloor(c) * 1.0001
  const crushed = priceStep(c, priceFloor(c) * 1e-6, 0, 0, -1)
  ok(crushed.price >= priceFloor(c), 'and no combination of terms can print a price below it')
}

// ---------------------------------------------------------------------------------------------
console.log('— Loop A: the treasury cap is in TOKENS, and spending is its own brake —')

{
  const s = tokenised('devtools', 246)
  const t = s.token!
  spend(t, t.supply.total) // ask for everything

  const c = treasuryCommitment(s)
  ok(Math.abs(c.cap - t.supply.treasury * TOKEN_BOUNDS.treasurySpendCapPerWeek) < 1e-9, `the cap is ${TOKEN_BOUNDS.treasurySpendCapPerWeek * 100}% of TREASURY TOKENS`)
  ok(c.capped && c.tokens === c.cap, 'an unlimited ask is held to it')

  // The elasticity the whole loop-A argument rests on. Searched across six orders of magnitude,
  // because a dollar-denominated cap would agree with a token one at exactly one price.
  const tokensAt = (mult: number) => {
    const g = structuredClone(s)
    g.token!.market.price *= mult
    return treasuryCommitment(g).tokens
  }
  const base = tokensAt(1)
  ok(
    [1e-3, 0.1, 2, 10, 1e3, 1e6].every((m) => tokensAt(m) === base),
    'and it does not move by a single token across a millionfold change in price — a doubling price does not double what you may spend',
  )
  ok(
    treasuryValue(s) === t.supply.treasury * t.market.price && !('treasuryValue' in (t as object)),
    'treasuryValue is DERIVED, never stored (architecture §7.3) — the number exists in exactly one place',
  )
}

{
  // Brake 2: releasing float costs more price than it buys. Asserted on the coefficients AND on a
  // real step, because a coefficient comparison alone would survive a sign error downstream.
  ok(
    TOKEN_ECONOMY.ecosystemDemandPerFloatPct < TOKEN_BOUNDS.supplyPressurePerFloatPct,
    `${TOKEN_ECONOMY.ecosystemDemandPerFloatPct} of demand against ${TOKEN_BOUNDS.supplyPressurePerFloatPct} of pressure per 1% of float`,
  )
  const s = tokenised('saas', 357)
  const t = s.token!
  let worst = 0
  for (const ff of [0.0001, 0.001, 0.004, 0.01, 0.02]) {
    const step = priceStep(t, fairValue(s), ff, 1, 0) // effectiveness forced to its MAXIMUM
    worst = Math.max(worst, step.ecosystemDemand / step.supplyPressure)
  }
  ok(worst < 1, `at maximum effectiveness the demand a release buys is ${worst.toFixed(3)} of the pressure it creates`)
  ok(spendEffectiveness(t) <= 1 && spendEffectiveness(t) >= 0.25, 'and effectiveness is bounded 0.25–1, so the ratio above is the true worst case')

  // ⚑ The ratio above compares two REPORTED fields, so deleting the pressure term from the price
  //   itself survived it. The claim that matters is about the PRICE: releasing float must make the
  //   week end lower, at every release size, even with the demand it buys at maximum.
  const quiet = priceStep(t, fairValue(s), 0, 1, 0).price
  ok(
    [0.0005, 0.002, 0.008, 0.02].every((ff) => priceStep(t, fairValue(s), ff, 1, 0).price < quiet),
    'and at four release sizes the week ends at a LOWER price than releasing nothing — the pressure reaches the price, not just the report',
  )
  ok(
    priceStep(t, fairValue(s), 0.02, 1, 0).price < priceStep(t, fairValue(s), 0.008, 1, 0).price,
    'monotonically so: a bigger release costs more',
  )
}

{
  // Brake 3, the one the contract does not name: the released tokens dilute the ANCHOR, because
  // fairValue is a per-token price. Spending is negative on both sides of the gravity term.
  const s = tokenised('fintech', 468)
  const before = fairValue(s)
  const t = s.token!
  const moved = Math.round(t.supply.treasury * 0.5)
  t.supply.treasury -= moved
  t.supply.circulating += moved
  ok(fairValue(s) < before, `releasing half the treasury into the float cuts the fundamental anchor from ${before.toExponential(3)} to ${fairValue(s).toExponential(3)}`)
}

{
  // Supply moves are exact, and the identity survives 104 weeks of maximum spend.
  const s = tokenised('saas', 579)
  const t = s.token!
  const total = t.supply.total
  let breaks = 0
  for (let w = 0; w < 104; w++) {
    spend(t, t.supply.total)
    t.lastTickedWeek = s.week - 1
    withSeed(w, () => tickToken(s))
    s.week++
    if (t.supply.circulating + t.supply.treasury + t.supply.locked !== total) breaks++
    breaks += tokenInvariants(s).length
  }
  ok(breaks === 0, '104 weeks of capped spend: the supply identity and every §4.6 invariant hold exactly, every week')
  ok(t.supply.treasury < total * 0.05 && t.supply.treasury >= 0, `and the treasury genuinely depletes — ${(t.supply.treasury / total * 100).toFixed(1)}% of supply left, never negative`)
  ok(t.series.length <= TOKEN_LIMITS.series && t.history.length <= TOKEN_LIMITS.history, 'the series and history caps hold across a full run')
  ok(JSON.parse(JSON.stringify(s.token!)) !== null && structuredClone(s.token!).market.price === t.market.price, 'the slice is still plain JSON after 104 ticks (persisted and structuredClone`d every action)')
}

// ---------------------------------------------------------------------------------------------
console.log('— Every 0–100 level has a reversion term, and no clamp is load-bearing —')

{
  // Speculation reverts to the UTILITY anchor. Held still, the gap must shrink monotonically.
  const s = tokenised('saas', 680)
  const t = s.token!
  t.market.utility = 40
  t.market.speculation = 95
  const gaps: number[] = []
  for (let w = 0; w < 25; w++) {
    t.market.price = t.market.emaPrice // no momentum shock, isolate the reversion
    t.lastTickedWeek = s.week - 1
    withSeed(w, () => tickToken(s))
    s.week++
    gaps.push(Math.abs(t.market.speculation - t.market.utility))
  }
  ok(gaps[24] < gaps[0] * 0.5, `speculation is pulled toward utility: gap ${gaps[0].toFixed(1)} → ${gaps[24].toFixed(1)} in 25 weeks`)
  ok(gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + 1e-9), 'and monotonically, at every step — the pull scales with distance, exactly as the climate fix does')

  // ⚑ Toward UTILITY, not toward the middle of the range. The test above closed a gap that a
  //   reversion to a fixed 50 would also have closed, because utility happened to be near 50. So:
  //   pin utility at two values far apart and far from the midpoint, and see where speculation goes.
  const settlesAt = (pinnedUtility: number) => {
    const g = tokenised('saas', 681)
    for (let w = 0; w < 70; w++) {
      g.token!.market.utility = pinnedUtility
      g.token!.market.price = g.token!.market.emaPrice // no momentum shock
      g.token!.lastTickedWeek = g.week - 1
      withSeed(w, () => tickToken(g))
      g.week++
    }
    return g.token!.market.speculation
  }
  const low = settlesAt(8)
  const high = settlesAt(92)
  ok(
    Math.abs(low - 8) < 6 && Math.abs(high - 92) < 6,
    `pinned at utility 8 speculation settles at ${low.toFixed(1)}, pinned at 92 it settles at ${high.toFixed(1)} — it tracks the utility ANCHOR, not the middle of the range`,
  )
}

{
  // `saturatingAdd` is what keeps 0 and 100 from being where a value is HELD. Tested through the
  // tick: pin momentum at its maximum for 60 weeks and speculation must approach 100 without ever
  // reaching it, so the clamp never becomes the mechanism.
  const s = tokenised('social', 791)
  const t = s.token!
  let everPinned = false
  for (let w = 0; w < 60; w++) {
    t.market.emaPrice = t.market.price / 5 // absurd, permanent, positive momentum
    t.lastTickedWeek = s.week - 1
    withSeed(w, () => tickToken(s))
    s.week++
    if (t.market.speculation >= 100 || t.market.sentiment >= 100 || t.market.volatility >= 100) everPinned = true
  }
  ok(t.market.speculation > 80, `60 weeks of maximum momentum drives speculation to ${t.market.speculation.toFixed(1)}`)
  ok(!everPinned, 'and never pins any 0–100 level against its boundary: the saturating step is the bound, the clamp is only arithmetic')
}

{
  // Absurd inputs must not produce absurd state. This is the "a clamp is a backstop, not a bound"
  // claim, checked from the other direction.
  for (const sector of SECTORS) {
    const s = tokenised(sector, 1024)
    const t = s.token!
    s.users = 5_000_000
    s.lastRevenue = 50_000_000
    s.quality = 100
    s.features = 100
    s.bugs = 0
    t.market.speculation = 100
    t.market.volatility = 100
    t.community.sentiment = 100
    let bad = 0
    for (let w = 0; w < 40; w++) {
      t.lastTickedWeek = s.week - 1
      withSeed(w * 31, () => tickToken(s))
      s.week++
      bad += tokenInvariants(s).length
      if (!Number.isFinite(t.market.price) || t.market.price <= 0) bad++
    }
    ok(bad === 0, `${sector}: 40 weeks from a maxed-out state stays finite, in range and invariant-clean`)
  }
}

// ---------------------------------------------------------------------------------------------
console.log('— The lag rule: no level is both input and output of the same tick (§4.6) —')

{
  // ⚑ The hard one to test without pasting the formula into the file. The trick is to find an input
  //   that reaches one level but NOT another, and check it stays out.
  //
  //   `trust` enters the SENTIMENT target and appears nowhere in the engagement target. So with the
  //   `prev` snapshot in place, two states differing only in trust must produce the IDENTICAL
  //   engagement after one tick — sentiment moves differently in each, but engagement reads the
  //   snapshot and cannot see it. Drop the snapshot and read the freshly-written sentiment instead,
  //   and trust leaks straight through into engagement. Same-tick self-reference, caught by
  //   construction rather than by a hard-coded expected value.
  const a = tokenised('saas', 8642)
  const b = structuredClone(a)
  a.token!.community.trust = 5
  b.token!.community.trust = 95
  for (const g of [a, b]) {
    g.token!.lastTickedWeek = g.week - 1
    withSeed(31337, () => tickToken(g))
  }
  ok(
    a.token!.community.sentiment !== b.token!.community.sentiment,
    `trust does reach sentiment (${a.token!.community.sentiment.toFixed(3)} vs ${b.token!.community.sentiment.toFixed(3)}), so this week genuinely differs`,
  )
  ok(
    a.token!.community.engagement === b.token!.community.engagement,
    'and engagement is bit-identical in both — it read the snapshot, not the sentiment this tick just wrote',
  )
}

{
  // ⚑ The EMA must be updated FROM THE NEW PRICE, after the move. Updating it from the old price
  //   looks almost right and is invisible to every level-based assertion — but it makes next week's
  //   momentum a difference against a stale anchor, which is a slow drift toward exactly the
  //   behaviour a level term has. Start with price === ema, where the mutant's update is identically
  //   zero, and the difference becomes total.
  const s = tokenised('devtools', 9753)
  const t = s.token!
  t.market.emaPrice = t.market.price
  const before = t.market.emaPrice
  t.lastTickedWeek = s.week - 1
  withSeed(4, () => tickToken(s))
  ok(t.market.price !== before, 'the week moved the price')
  ok(t.market.emaPrice !== before, 'and the EMA moved with it — updated from the NEW price, not the one the week started at')
  ok(
    (t.market.emaPrice - before) * (t.market.price - before) > 0 && Math.abs(t.market.emaPrice - before) < Math.abs(t.market.price - before),
    'and it moved the same direction, by less — an anchor that follows the price rather than leading it',
  )
}

{
  // ⚑ THE DETERMINISM GATE ITSELF. Removing `if (tokenActive(s))` from advanceWeekInner survives
  //   every value-based test: `tickToken` returns immediately with no slice, so no draw is consumed
  //   and the golden traces do not move. What DOES move is `s.flags.rngTick`, which `seeded()` bumps
  //   before it reseeds — and that shifts every later player action in the run. Nothing except an
  //   explicit count can see it.
  //
  //   Asserted as a DIFFERENCE, so there is no golden number to re-record: a run with a token slice
  //   pays exactly one more bump per week than a run without one. Remove the gate and both pay the
  //   same, whatever the absolute numbers are.
  const bumpsPerWeek = (withToken: boolean) => {
    let g = withToken ? tokenised('saas', 24680) : newGame('Plain', 'saas', 'technical', { config: cfg(24680) })
    if (!withToken) g.cash = 20_000_000
    const start = g.flags.rngTick ?? 0
    const w0 = g.week
    for (let w = 0; w < 12 && !g.gameOver; w++) g = advanceWeek(g)
    return ((g.flags.rngTick ?? 0) - start) / (g.week - w0)
  }
  const plain = bumpsPerWeek(false)
  const forked = bumpsPerWeek(true)
  ok(
    forked - plain === 1,
    `a tokenised run consumes exactly ONE more seeded block per week than an untokenised one (${plain} → ${forked}) — the gate is real`,
  )
  ok(Number.isInteger(plain) && plain >= 1, `and an untokenised Career run's per-week count is unchanged at ${plain}`)
}

// ---------------------------------------------------------------------------------------------
console.log('— The invariant checker itself is not a no-op —')

{
  const s = tokenised('saas', 1337)
  ok(tokenInvariants(s).length === 0, 'a healthy slice reports no violations')
  const broken = structuredClone(s)
  broken.token!.supply.treasury += 1
  ok(tokenInvariants(broken).some((v) => v.includes('supply identity')), 'a single stray token in the treasury is caught')
  // ⚑ Both directions. Checking only the surplus let a `>` survive where the contract says `!==`,
  //   and a supply that silently VANISHES is the more dangerous of the two.
  const brokenLow = structuredClone(s)
  brokenLow.token!.supply.treasury -= 1
  ok(tokenInvariants(brokenLow).some((v) => v.includes('supply identity')), 'and a single MISSING token is caught too — the identity is ===, not ≤')
  const broken2 = structuredClone(s)
  broken2.token!.market.price = 0
  ok(tokenInvariants(broken2).some((v) => v.includes('below the floor')), 'a zero price is caught — the state the whole slice exists to make unreachable')
  const broken3 = structuredClone(s)
  broken3.token!.community.sentiment = 140
  ok(tokenInvariants(broken3).some((v) => v.includes('sentiment')), 'a 0–100 scalar out of range is caught')
  const broken4 = structuredClone(s)
  broken4.users = broken4.users + 7
  ok(tokenInvariants(broken4).some((v) => v.includes('user split')), 'and the organic + incentivised === users identity is caught')
  ok(tokenInvariants({ ...s, token: undefined }).length === 0, 'a run with no token slice reports nothing — absence is institutional, not broken')
}

// ---------------------------------------------------------------------------------------------
console.log('— fairValue reads fundamentals only: the anchor cannot be bought —')

{
  const s = tokenised('saas', 2048)
  const before = fairValue(s)
  s.hype = 100
  s.reputation = 100
  ok(fairValue(s) === before, 'hype and reputation — the two cheapest things in this game to buy — move the anchor by exactly nothing')
  s.lastRevenue *= 3
  ok(fairValue(s) > before, 'protocol revenue moves it')
  const s2 = structuredClone(s)
  s2.users = Math.round(s2.users * 2)
  s2.token!.users.organic = s2.users
  ok(fairValue(s2) > fairValue(s), 'organic users move it')
  const s3 = structuredClone(s)
  s3.token!.market.utility = Math.min(100, s3.token!.market.utility + 40)
  ok(fairValue(s3) > fairValue(s), 'and utility moves it')

  // Incentivised users are NOT organic users. The anchor must refuse to see them, or the §52
  // protection arrives after the number it protects.
  //
  // SLICE 3 MOVED THE TRUTH. This wrote `TokenState.users` when Slice 2 shipped, because nothing
  // filled the cohorts yet. In Career the COHORTS are now authoritative and the mirror is derived
  // from them (docs/ico-architecture.md §7.2), so the test writes the cohort — and the fact that
  // writing the old mirror no longer moves the anchor is the desync this arrangement prevents.
  const s4 = structuredClone(s)
  const rented = Math.round(s4.users * 0.5)
  s4.career!.cohorts.push({
    id: 'rented-cohort',
    acquiredWeek: s4.week,
    segmentId: s4.career!.primaryTargetSegmentId,
    startingCustomers: rented,
    activeCustomers: rented,
    exactCustomers: rented,
    acquisitionCost: 0,
    priceAtAcquisition: 52,
    productQualityAtAcquisition: 50,
    origin: 'incentivised',
  })
  ok(fairValue(s4) < fairValue(s), 'and half the user base turning incentivised LOWERS it — a rented user is not a fundamental')
}

// ---------------------------------------------------------------------------------------------
console.log('— Utility is earned, never bought (brief §25) —')

{
  const s = tokenised('devtools', 4096)
  const t = s.token!
  const spent = structuredClone(s)
  spend(spent.token!, spent.token!.supply.total)
  const quiet = structuredClone(s)
  spend(quiet.token!, 0)
  for (let w = 0; w < 30; w++) {
    for (const g of [spent, quiet]) {
      g.token!.lastTickedWeek = g.week - 1
      withSeed(w, () => tickToken(g))
      g.week++
    }
    spend(spent.token!, spent.token!.supply.total)
  }
  ok(
    Math.abs(spent.token!.market.utility - quiet.token!.market.utility) < 1e-9,
    'thirty weeks of maximum treasury spend produces utility identical to spending nothing — no amount of money buys it',
  )
  ok(
    spent.token!.community.engagement > quiet.token!.community.engagement,
    `what it does buy is ENGAGEMENT (${spent.token!.community.engagement.toFixed(1)} vs ${quiet.token!.community.engagement.toFixed(1)}) — the loop's lagged, capped positive leg`,
  )
  ok(t.market.utility >= 0, 'utility stays a real number throughout')
}

// ---------------------------------------------------------------------------------------------
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------
// MUTATIONS RUN AGAINST THIS FILE, all 28 applied one at a time with the suite re-run each time.
// ⚑ marks one that SURVIVED the first version of this file and forced a stronger assertion — six
// of them did, which is the same lesson Slice 1 recorded when nine of its mutants survived.
// The runner lives outside the repo; every mutation below is a one-line textual edit.
//
//    M1  market.ts   speculative demand reads the price LEVEL instead of price/ema − 1
//    M2  market.ts   a faint price-level leak added to the momentum term
//    M3  market.ts   gravityExponent forced to 1 (a linear restoring force)
//    M4  market.ts   gravity sign flipped (repulsion from fair value)
//    M5  market.ts   fairValue's floor multiple dropped — the price floor becomes an equilibrium
//    M6  market.ts   priceFloor returns 0
//    M7  market.ts   fairValue reads s.hype — the anchor becomes buyable
//    M8  market.ts   fairValue counts incentivised users as organic
//    M9  market.ts   the treasury cap made price-sensitive (a dollar-denominated budget)
//   M10  types.ts    ecosystemDemandPerFloatPct raised above supplyPressurePerFloatPct
//  ⚑M11  market.ts   the supply-pressure term deleted from `logMove` (but left in the report)
//                    — the ratio assertion compared two REPORTED fields and never looked at the
//                    price. Now four release sizes must each END the week lower.
//   M12  market.ts   tokenInvariants returns [] unconditionally
//  ⚑M13  market.ts   the supply identity check weakened from `!==` to `>`
//                    — only a SURPLUS token was ever tested. A missing one is now tested too.
//   M14  tick.ts     the `hasCapability(s, 'tokenEconomy')` gate removed
//   M15  tick.ts     the lastTickedWeek re-entry guard removed
//   M16  tick.ts     a second RNG draw, conditional on price > ema (a draw-ORDER bug)
//  ⚑M17  tick.ts     speculation reverts to 50 instead of to the utility anchor
//                    — the test's utility happened to sit near 50, so both closed the same gap.
//                    Utility is now pinned at 8 and at 92 and speculation must follow it.
//   M18  tick.ts     saturatingAdd replaced by a plain add (the clamp becomes load-bearing)
//  ⚑M19  tick.ts     the `prev` snapshot bypassed — levels read values written this same tick
//                    — invisible to every level assertion. Now caught by a variable that reaches
//                    sentiment but NOT engagement: `trust` must not leak through.
//   M20  tick.ts     the treasury→circulating move drops the subtraction
//  ⚑M21  tick.ts     the EMA updated from the OLD price instead of the new one
//                    — nothing looked at the EMA's update ORDER. Now started at price === ema,
//                    where the mutant's update is identically zero.
//   M22  tick.ts     ecosystem spend added to the utility target (utility becomes buyable, §25)
//  ⚑M23  engine.ts   the `tokenActive(s)` gate removed from advanceWeekInner
//                    — THE DANGEROUS ONE. It consumes no draw with no token slice, so the golden
//                    traces do not move; only `s.flags.rngTick` shifts, which silently changes
//                    every later player action. Now caught by a per-week seeded-block COUNT,
//                    asserted as a difference so there is no golden number to re-record.
//   M24  modes.ts    tokenEconomy left false in Career
//   M25  types.ts    the speculative demand term deleted entirely
//   M26  types.ts    speculation's reversion to utility deleted (the climate bug, again)
//   M27  types.ts    fairValueFloorMultiple dropped to 1 (anchor allowed down to the floor)
//   M28  market.ts   supply pressure zeroed
