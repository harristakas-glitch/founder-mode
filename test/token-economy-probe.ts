// Tokenisation — the token economy stress harness. ICO Slice 2.
//
// Run: npx tsx test/token-economy-probe.ts        (NOT in `npm test` — it is minutes, not seconds)
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS EXISTS TO PROVE
//
// One property: THE TOKEN ECONOMY HAS NO ABSORBING STATE. Not "should not" — must not.
//
// We shipped an absorbing state once already. `climate` was a random walk against a hard clamp;
// over 40 seeds × 104 weeks, 8 runs sat 20+ consecutive weeks in the frozen band and the worst sat
// there for 49, with fundraising 70% blocked throughout. Nothing in the test suite noticed, because
// nothing was measuring "how long does this stay stuck". This file measures it.
//
// Four deliberately hostile policies, because a model only reveals its absorbing states when you
// push it at one:
//
//   zero_spend  the treasury never spends — the economy has to stand on fundamentals alone
//   max_spend   the treasury spends its cap EVERY week for 104 weeks, the pure loop-A attack
//   pump        speculation pinned at 100 and an exogenous buyer lifting price 12%/wk for 40
//               weeks, then walking away — the loop-B attack, and the bubble-deflation test
//   crash       at week 40 the price is slammed ONTO the floor and the network is destroyed and
//               HELD destroyed for the remaining 64 weeks — the loop-C death-spiral attack, and
//               the only policy that actually reaches the floor. If the floor absorbs, it is here.
//
// ---------------------------------------------------------------------------------------------
// WHY N = 8 FOR "WEEKS STUCK AT THE FLOOR"
//
// `gravityPull` is 0.12, so the economy's characteristic relaxation time is 1/0.12 ≈ 8.3 weeks —
// the time constant on which any dislocation decays. A price that needs MORE than one relaxation
// time to leave the floor is not relaxing; something is holding it there. So the threshold is set
// at 8 weeks: strictly inside the system's own time constant, one sixth of the 49-week failure that
// motivated this file, and under two months of game time, which is a crisis a player can still act
// on rather than a state they are waiting out.
//
// ---------------------------------------------------------------------------------------------
// IF A POLICY PRODUCES A STUCK OR RUNAWAY STATE, FIX THE ECONOMY. Do not raise N, do not soften a
// bound, do not drop a policy. The first run of this harness did exactly its job: it found that
// `speculativeDemandCoef` at 0.22 put the momentum slope at ~1.4 against `priceEmaAlpha` 0.18, so
// every equilibrium was locally unstable and every run pinned itself against the saturation
// ceiling — bounded, but only ever one shape. The fix was in TOKEN_ECONOMY, not here.

import { advanceWeek, newGame, withSeed } from '../src/game/engine'
import type { GameConfig } from '../src/game/modes'
import { tokenisationBars } from '../src/game/token/eligibility'
import { launchToken } from '../src/game/token/launch'
import {
  fairValue,
  priceFloor,
  spendEffectiveness,
  tokenInvariants,
  treasuryCommitment,
  treasuryValue,
} from '../src/game/token/market'
import { networkValue } from '../src/game/token/scoring'
import { tickToken } from '../src/game/token/tick'
import { TOKEN_BOUNDS, TOKEN_ECONOMY } from '../src/game/token/types'
import type { GameState, SectorId } from '../src/game/types'

// ---------------------------------------------------------------------------------------------
// harness

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
}

const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce']
const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 137)
const WEEKS = 104
const FLOOR_WEEKS_LIMIT = 8

type Policy = 'zero_spend' | 'max_spend' | 'pump' | 'crash'
const POLICIES: Policy[] = ['zero_spend', 'max_spend', 'pump', 'crash']

const cfg = (seed: number, sector: SectorId): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const fx = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a')

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN
  const a = [...xs].sort((x, y) => x - y)
  const i = Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))
  return a[i]
}

/**
 * A Career company that has launched a token. Bars are cleared by SETTING state rather than by
 * playing a perfect 40 weeks, because this harness is measuring the economy and not the balance of
 * the run that precedes it.
 */
function launched(sector: SectorId, seed: number): GameState | null {
  let s = newGame('Probe', sector, 'technical', { config: cfg(seed, sector) })
  s.cash = 20_000_000
  for (let w = 0; w < 20 && !s.gameOver; w++) s = advanceWeek(s)
  if (s.gameOver) return null
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 60)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  const res = launchToken(s)
  return res.ok && s.token ? s : null
}

/** Drive the treasury at its cap, or not at all. Programmes are Slice 4's; the probe writes them
 *  directly because Slice 2 owns the CAP and the two price consequences, not the controls. */
function setSpend(s: GameState, on: boolean): void {
  const t = s.token!
  t.incentives = on
    ? [{ category: 'community_treasury', share: 0, tokensPerWeek: t.supply.treasury, startedWeek: s.week, cumulativeTokens: 0, effectiveness: 1 }]
    : []
}

interface RunStats {
  policy: Policy
  sector: SectorId
  seed: number
  weeks: number
  maxFloorRun: number
  finalOverLaunch: number
  peakOverLaunch: number
  maxPriceOverFair: number
  minPriceOverFair: number
  maxSpendRatio: number
  finalNetworkValue: number
  finalTreasuryTokens: number
  treasuryShareAtLaunch: number
  treasuryEverGrew: boolean
  maxCirculating: number
  totalSupply: number
  invariantBreaks: string[]
  weeksAtFloor: number
  recoveredFromFloor: boolean
  /** `crash` only: price / priceFloor on the FIRST week after the price was pinned onto the floor.
   *  Above 1 means the economy pushed itself off an absorbing boundary in a single week. */
  floorEscapeRatio: number
}

function runOne(sector: SectorId, seed: number, policy: Policy): RunStats | null {
  let s = launched(sector, seed)
  if (!s) return null
  const t0 = s.token!
  const launchPrice = t0.plan.launchPrice
  const totalSupply = t0.supply.total

  let maxFloorRun = 0
  let floorRun = 0
  let weeksAtFloor = 0
  let recoveredFromFloor = false
  let peak = t0.market.price
  let maxOverFair = 0
  let minOverFair = Infinity
  let maxSpendRatio = 0
  let treasuryEverGrew = false
  let maxCirculating = t0.supply.circulating
  let prevTreasury = t0.supply.treasury
  const breaks: string[] = []
  let weeks = 0
  let crashedUsers = 0
  let floorEscapeRatio = Infinity

  for (let w = 0; w < WEEKS; w++) {
    const t = s.token!

    // --- the hostile policy, applied BEFORE the week runs ---
    setSpend(s, policy === 'max_spend')
    if (policy === 'pump' && w < 40) {
      // An exogenous buyer, plus the speculation level pinned where a mania would hold it.
      t.market.speculation = 100
      t.market.price *= 1.12
    }
    if (policy === 'crash') {
      // The maximally hostile policy, and the only one that actually reaches the floor. At week 40
      // the price is slammed ONTO the floor and the network is destroyed — and the network is then
      // HELD destroyed for the remaining 64 weeks. A crash the company grows out of proves nothing;
      // this asks whether a token whose fundamentals are permanently worthless can still climb off
      // 1% of its launch price. If the floor absorbs anywhere, it absorbs here.
      if (w === 40) {
        t.market.price = priceFloor(t) // ON the floor, once. From week 41 the economy is on its own.
        t.market.emaPrice = priceFloor(t)
        t.community.trust = 0
        crashedUsers = Math.max(0, Math.round(s.users * 0.02))
      }
      if (w >= 40) {
        s.users = crashedUsers
        s.lastRevenue = 0
        s.quality = 0
        s.features = 0
        s.bugs = 100
        t.users.organic = crashedUsers
        t.users.incentivised = 0
      }
    }

    // The structural loop-A ratio, from the state the week is about to use.
    const c = treasuryCommitment(s)
    if (c.tokens > 0) {
      const ratio = (TOKEN_ECONOMY.ecosystemDemandPerFloatPct * spendEffectiveness(t)) / TOKEN_BOUNDS.supplyPressurePerFloatPct
      maxSpendRatio = Math.max(maxSpendRatio, ratio)
    }

    // Keep the company solvent: this harness is not a survival test, and a bankruptcy at week 30
    // would silently shorten every run into "the economy never had time to misbehave".
    s.cash = Math.max(s.cash, 20_000_000)
    s = advanceWeek(s)
    weeks++
    const tt = s.token
    if (!tt) {
      breaks.push('token slice vanished')
      break
    }

    breaks.push(...tokenInvariants(s))

    const floor = priceFloor(tt)
    const atFloor = tt.market.price <= floor * 1.0000001
    if (atFloor) {
      floorRun++
      weeksAtFloor++
      maxFloorRun = Math.max(maxFloorRun, floorRun)
    } else {
      if (floorRun > 0) recoveredFromFloor = true
      floorRun = 0
    }

    if (policy === 'crash' && w === 40) floorEscapeRatio = tt.market.price / priceFloor(tt)

    peak = Math.max(peak, tt.market.price)
    const fair = fairValue(s)
    if (fair > 0) {
      maxOverFair = Math.max(maxOverFair, tt.market.price / fair)
      minOverFair = Math.min(minOverFair, tt.market.price / fair)
    }
    if (tt.supply.treasury > prevTreasury) treasuryEverGrew = true
    prevTreasury = tt.supply.treasury
    maxCirculating = Math.max(maxCirculating, tt.supply.circulating)

    if (s.gameOver) break
  }

  const tEnd = s.token!
  return {
    policy,
    sector,
    seed,
    weeks,
    maxFloorRun,
    finalOverLaunch: tEnd.market.price / launchPrice,
    peakOverLaunch: peak / launchPrice,
    maxPriceOverFair: maxOverFair,
    minPriceOverFair: minOverFair,
    maxSpendRatio,
    finalNetworkValue: networkValue(s),
    finalTreasuryTokens: tEnd.supply.treasury,
    treasuryShareAtLaunch: t0.supply.treasury / totalSupply,
    treasuryEverGrew,
    maxCirculating,
    totalSupply,
    invariantBreaks: [...new Set(breaks)],
    weeksAtFloor,
    recoveredFromFloor,
    floorEscapeRatio,
  }
}

// ---------------------------------------------------------------------------------------------
console.log(`— Sweep: ${SEEDS.length} seeds × ${SECTORS.length} sectors × ${POLICIES.length} policies × ${WEEKS} weeks —`)

const started = Date.now()
const runs: RunStats[] = []
let skipped = 0
for (const policy of POLICIES)
  for (const sector of SECTORS)
    for (const seed of SEEDS) {
      const r = runOne(sector, seed, policy)
      if (r) runs.push(r)
      else skipped++
    }
console.log(`  ${runs.length} runs completed, ${skipped} skipped (never reached a launch), ${((Date.now() - started) / 1000).toFixed(0)}s\n`)

for (const policy of POLICIES) {
  const rs = runs.filter((r) => r.policy === policy)
  if (rs.length === 0) continue
  const finals = rs.map((r) => r.finalOverLaunch)
  console.log(`  ${policy.padEnd(11)} n=${String(rs.length).padStart(3)}` +
    `  floor-run max ${String(Math.max(...rs.map((r) => r.maxFloorRun))).padStart(2)}wk` +
    `  weeks@floor ${String(rs.reduce((a, r) => a + r.weeksAtFloor, 0)).padStart(4)}` +
    `  price/launch p10 ${fx(quantile(finals, 0.1), 2)} med ${fx(quantile(finals, 0.5), 2)} p90 ${fx(quantile(finals, 0.9), 2)}` +
    `  max price/fair ${fx(Math.max(...rs.map((r) => r.maxPriceOverFair)), 2)}` +
    `  min price/fair ${fx(Math.min(...rs.map((r) => r.minPriceOverFair)), 3)}`)
}
console.log('')

// ---------------------------------------------------------------------------------------------
console.log('— No absorbing state —')

const worstFloorRun = Math.max(...runs.map((r) => r.maxFloorRun))
const worstRun = runs.find((r) => r.maxFloorRun === worstFloorRun)!
ok(
  worstFloorRun <= FLOOR_WEEKS_LIMIT,
  `no run sits at the price floor for more than ${FLOOR_WEEKS_LIMIT} consecutive weeks ` +
    `(worst ${worstFloorRun}wk, ${worstRun.policy}/${worstRun.sector}/seed ${worstRun.seed}) — one gravity relaxation time`,
)
ok(
  runs.every((r) => r.weeksAtFloor === 0 || r.recoveredFromFloor || r.weeks < WEEKS),
  'every run that ever touched the floor climbed back off it — the floor repels, it does not hold',
)
const crashRuns = runs.filter((r) => r.policy === 'crash')
ok(
  crashRuns.length > 0 && crashRuns.every((r) => r.floorEscapeRatio > 1.05),
  `and the "0 weeks" above is not vacuous: all ${crashRuns.length} crash runs were slammed ONTO the floor with a dead network, ` +
    `and every one climbed off it within a SINGLE week (worst escape ${fx(Math.min(...crashRuns.map((r) => r.floorEscapeRatio)), 2)}× the floor, ` +
    `median ${fx(quantile(crashRuns.map((r) => r.floorEscapeRatio), 0.5), 2)}×)`,
)
ok(
  runs.every((r) => r.invariantBreaks.length === 0),
  `the §4.6 invariants hold on every one of ~${(runs.reduce((a, r) => a + r.weeks, 0) / 1000).toFixed(0)}k simulated weeks` +
    (runs.some((r) => r.invariantBreaks.length) ? ` — FIRST BREAK: ${runs.find((r) => r.invariantBreaks.length)!.invariantBreaks[0]}` : ''),
)

// ---------------------------------------------------------------------------------------------
console.log('— No unbounded growth —')

// The algebraic ceiling: gravity overtakes the bounded demand side at a finite dislocation.
const maxNoise = TOKEN_ECONOMY.priceNoiseScale * (TOKEN_ECONOMY.priceNoiseVolBase + 1)
const theoreticalCeiling = Math.exp(
  Math.pow((TOKEN_ECONOMY.demandCap + maxNoise) / TOKEN_BOUNDS.gravityPull, 1 / TOKEN_BOUNDS.gravityExponent),
)
const observedCeiling = Math.max(...runs.map((r) => r.maxPriceOverFair))
ok(
  observedCeiling < theoreticalCeiling,
  `price never exceeds ${fx(observedCeiling, 2)}× fair value, inside the algebraic ceiling of ` +
    `${fx(theoreticalCeiling, 2)}× where superlinear gravity overtakes the whole demand side`,
)
ok(
  runs.every((r) => Number.isFinite(r.peakOverLaunch) && r.peakOverLaunch < 1000),
  `price is bounded in absolute terms too: the loudest peak across every run is ${fx(Math.max(...runs.map((r) => r.peakOverLaunch)), 1)}× launch`,
)
ok(!runs.some((r) => r.treasuryEverGrew), 'the treasury only ever shrinks — nothing in this slice mints or refills it')
ok(
  runs.every((r) => r.maxCirculating <= r.totalSupply),
  'circulating supply never exceeds total supply — the only supply movement is treasury → float',
)
ok(
  runs.every((r) => r.finalTreasuryTokens >= 0),
  `the treasury never goes negative (thinnest survivor holds ${Math.min(...runs.map((r) => r.finalTreasuryTokens)).toLocaleString()} tokens)`,
)

// ---------------------------------------------------------------------------------------------
console.log('— Treasury loop: the per-cycle gain, MEASURED —')

// (a) The structural inequality, read off the states the sweep actually visited rather than off the
//     constants. `ecosystemDemandPerFloatPct × effectiveness` against `supplyPressurePerFloatPct`.
const structuralGain = Math.max(...runs.map((r) => r.maxSpendRatio).filter((x) => x > 0), 0)
ok(
  structuralGain > 0 && structuralGain < 1,
  `same-week gain: the best demand a released token bought anywhere in the sweep was ${fx(structuralGain)} of the ` +
    `supply pressure it created (bound ${fx(TOKEN_ECONOMY.ecosystemDemandPerFloatPct / TOKEN_BOUNDS.supplyPressurePerFloatPct)})`,
)

/**
 * (b) The full multi-week loop, by paired replay. Same state, same seed, same fundamentals — one
 *     branch spends its cap for a week, the other spends nothing. If the spend's best cumulative
 *     price effect over the following weeks never repays the price it cost on the day, the loop
 *     cannot bootstrap itself, whatever the lagged engagement leg adds.
 */
const IMPULSE_HORIZON = 16
function spendImpulseGain(snapshot: GameState): number | null {
  const base = structuredClone(snapshot)
  const imp = structuredClone(snapshot)
  setSpend(base, false)
  setSpend(imp, true)
  let cost = 0
  let bestGain = -Infinity
  for (let k = 0; k < IMPULSE_HORIZON; k++) {
    for (const g of [base, imp]) {
      g.token!.lastTickedWeek = g.week - 1
      withSeed(0x51ce ^ k, () => tickToken(g))
      g.week++
    }
    // Only the FIRST week carries the impulse; after that both branches are identical policy.
    setSpend(imp, false)
    const delta = Math.log(imp.token!.market.price / base.token!.market.price)
    if (k === 0) cost = -delta
    bestGain = Math.max(bestGain, delta)
  }
  if (!(cost > 1e-9)) return null
  return bestGain / cost
}

/**
 * (c) Loop B — the dangerous one — by propagating a +1% price shock through paired replay.
 *
 * WHY THIS IS NOT A ONE-STEP RATIO. The first version of this measurement asserted that a single
 * week's amplification was below 1 and it failed at 1.236. Working out why is the most useful thing
 * this harness produced, so it is written down rather than tuned away:
 *
 *     one-step gain = 1 + k − γ,   k = momentum slope,   γ = gravityPull × exponent × |d|^0.5
 *
 * and γ → 0 AT the anchor, because gravity is superlinear. So a one-step gain below 1 requires
 * k < γ = 0 — it is unachievable for ANY model with a momentum term at all, including one with the
 * term set to zero, which would sit at exactly 1.0. The metric was mis-specified, not the economy.
 *
 * The property that actually matters, and the one measured here, is that THE RESPONSE TO A SHOCK IS
 * BOUNDED AND EVENTUALLY DECAYS. Two nearby trajectories in this economy separate while speculation
 * is high (k > priceEmaAlpha ⇒ the anchor is locally unstable, by design — see the derivation on
 * TOKEN_ECONOMY.speculativeDemandCoef) and are then caught by superlinear gravity at a finite
 * dislocation. So the honest test is: how far apart do they ever get, and do they come back.
 */
const SHOCK_HORIZON = 52
function priceShockTrace(snapshot: GameState): { oneStep: number; peak: number; terminal: number } | null {
  const eps = Math.log(1.01)
  const a = structuredClone(snapshot)
  const b = structuredClone(snapshot)
  b.token!.market.price *= 1.01
  let peak = 0
  let terminal = 0
  let oneStep = 0
  for (let k = 0; k < SHOCK_HORIZON; k++) {
    for (const g of [a, b]) {
      g.token!.lastTickedWeek = g.week - 1
      withSeed(0xb1d ^ k, () => tickToken(g))
      g.week++
    }
    const dev = Math.abs(Math.log(b.token!.market.price / a.token!.market.price))
    if (!Number.isFinite(dev)) return null
    if (k === 0) oneStep = dev / eps
    peak = Math.max(peak, dev / eps)
    terminal = dev / eps
  }
  return { oneStep, peak, terminal }
}

/** (d) The elasticity the contract's loop-A brake rests on: tokens released must not respond to
 *      price at all. Measured, not assumed. */
function spendPriceElasticity(snapshot: GameState): number {
  const a = structuredClone(snapshot)
  const b = structuredClone(snapshot)
  setSpend(a, true)
  setSpend(b, true)
  b.token!.market.price *= 4
  return treasuryCommitment(b).tokens - treasuryCommitment(a).tokens
}

// Snapshots taken from a representative slice of the sweep: every sector, a sixth of the seeds,
// every policy, sampled through the run so both calm and violent states are covered.
const SNAP_SEEDS = SEEDS.filter((_, i) => i % 6 === 0)
const snapshots: GameState[] = []
for (const policy of POLICIES)
  for (const sector of SECTORS)
    for (const seed of SNAP_SEEDS) {
      let s = launched(sector, seed)
      if (!s) continue
      let snapCrashUsers = 0
      for (let w = 0; w < WEEKS; w++) {
        setSpend(s, policy === 'max_spend')
        if (policy === 'pump' && w < 40) {
          s.token!.market.speculation = 100
          s.token!.market.price *= 1.12
        }
        if (policy === 'crash' && w === 40) {
          s.token!.market.price = priceFloor(s.token!)
          s.token!.market.emaPrice = priceFloor(s.token!)
          snapCrashUsers = Math.max(0, Math.round(s.users * 0.02))
        }
        if (policy === 'crash' && w >= 40) {
          s.users = snapCrashUsers
          s.lastRevenue = 0
          s.token!.users.organic = snapCrashUsers
          s.token!.users.incentivised = 0
        }
        s.cash = Math.max(s.cash, 20_000_000)
        s = advanceWeek(s)
        if (!s.token || s.gameOver) break
        if (w % 11 === 5) snapshots.push(structuredClone(s))
      }
    }

const impulseGains = snapshots.map(spendImpulseGain).filter((g): g is number => g !== null)
const shocks = snapshots.map(priceShockTrace).filter((g): g is NonNullable<ReturnType<typeof priceShockTrace>> => g !== null)
const elasticities = snapshots.map(spendPriceElasticity)

/** The attractor's own half-width, from the constants: the dislocation at which gravity's slope
 *  overtakes the momentum slope at maximum speculation. Two trajectories inside one attractor
 *  cannot separate further than its diameter, so this is the amplification bound to assert on. */
const kMax = (TOKEN_ECONOMY.speculativeDemandCoef / TOKEN_ECONOMY.momentumScale) * (TOKEN_ECONOMY.speculationDemandBase + TOKEN_ECONOMY.speculationDemandSpan)
const attractorHalfWidth = Math.pow(Math.max(0, kMax - TOKEN_BOUNDS.priceEmaAlpha) / (TOKEN_BOUNDS.gravityPull * TOKEN_BOUNDS.gravityExponent), 2)
const amplificationBound = (2 * attractorHalfWidth) / Math.log(1.01)

ok(
  impulseGains.length > 50 && Math.max(...impulseGains) < 1,
  `loop A, paired replay over ${snapshots.length} sampled states: a week of capped spend never repays its own price cost ` +
    `(worst gain ${fx(Math.max(...impulseGains))} — negative means the spend's best effect at ANY horizon was still a net price cost, ` +
    `median ${fx(quantile(impulseGains, 0.5))}, n=${impulseGains.length})`,
)
ok(
  shocks.length > 50 && Math.max(...shocks.map((x) => x.peak)) < amplificationBound,
  `loop B, paired replay over ${SHOCK_HORIZON} weeks: a +1% price shock separates by at most ` +
    `${fx(Math.max(...shocks.map((x) => x.peak)), 1)}× (median peak ${fx(quantile(shocks.map((x) => x.peak), 0.5), 1)}×), ` +
    `inside the attractor bound of ${fx(amplificationBound, 1)}× — bounded, never a runaway`,
)
// The attractor bound above is the ALGEBRAIC one and is deliberately generous — it is the claim
// that cannot fail for the right reason. This is the regression guard: the measured worst case has
// been 2.7× across every sweep, so anything past 8× means a damping term moved and should be looked
// at, even though the economy would still be formally bounded.
ok(
  Math.max(...shocks.map((x) => x.peak)) < 8,
  `and comfortably inside the empirical guard of 8× as well (worst observed ${fx(Math.max(...shocks.map((x) => x.peak)), 2)}×)`,
)
ok(
  quantile(shocks.map((x) => x.terminal / x.peak), 0.5) < 1,
  `and it comes back: the median shock ends at ${pct(quantile(shocks.map((x) => x.terminal / x.peak), 0.5))} of its own peak separation after ${SHOCK_HORIZON} weeks`,
)
console.log(
  `    (diagnostic — one-step gain median ${fx(quantile(shocks.map((x) => x.oneStep), 0.5))}, worst ${fx(Math.max(...shocks.map((x) => x.oneStep)))}: ` +
    `above 1 by construction, since gravity's slope vanishes AT the anchor. See the note on priceShockTrace.)`,
)
ok(
  elasticities.every((d) => d === 0),
  'quadrupling the price changes the tokens the treasury may release by exactly 0 — the cap is denominated in TOKENS (loop A brake 1)',
)
ok(
  TOKEN_ECONOMY.ecosystemDemandPerFloatPct < TOKEN_BOUNDS.supplyPressurePerFloatPct,
  `and releasing 1% of the float costs strictly more price than it buys: ` +
    `${TOKEN_ECONOMY.ecosystemDemandPerFloatPct} demand against ${TOKEN_BOUNDS.supplyPressurePerFloatPct} pressure (loop A brake 2)`,
)

// ---------------------------------------------------------------------------------------------
console.log('— The distribution is wide: an economy that always ends the same way is not a mechanic —')

const finals = runs.map((r) => r.finalOverLaunch)
const p10 = quantile(finals, 0.1)
const p90 = quantile(finals, 0.9)
ok(
  p90 / p10 >= 3,
  `final price spans ${fx(p90 / p10, 1)}× from the 10th to the 90th percentile ` +
    `(p10 ${fx(p10, 2)}×, median ${fx(quantile(finals, 0.5), 2)}×, p90 ${fx(p90, 2)}× launch)`,
)
const survivable = runs.filter((r) => r.policy !== 'crash').map((r) => r.finalOverLaunch)
ok(
  quantile(survivable, 0.9) / quantile(survivable, 0.1) >= 3,
  `and the spread is not just the crash policy: excluding it, the p10–p90 span is still ${fx(quantile(survivable, 0.9) / quantile(survivable, 0.1), 1)}× ` +
    `(p10 ${fx(quantile(survivable, 0.1), 2)}×, median ${fx(quantile(survivable, 0.5), 2)}×, p90 ${fx(quantile(survivable, 0.9), 2)}×)`,
)
const winners = finals.filter((f) => f > 1.2).length
const losers = finals.filter((f) => f < 0.8).length
ok(
  winners >= runs.length * 0.1 && losers >= runs.length * 0.1,
  `both outcomes are common: ${pct(winners / runs.length)} of runs end above 1.2× launch and ${pct(losers / runs.length)} below 0.8×`,
)
const perSector = SECTORS.map((sec) => quantile(runs.filter((r) => r.sector === sec).map((r) => r.finalOverLaunch), 0.5))
ok(
  Math.max(...perSector) / Math.min(...perSector) > 1.15,
  `sectors do not converge on one answer: median final price/launch ranges ${fx(Math.min(...perSector), 2)}×–${fx(Math.max(...perSector), 2)}× across the five`,
)
const perPolicy = POLICIES.map((p) => quantile(runs.filter((r) => r.policy === p).map((r) => r.finalOverLaunch), 0.5))
ok(
  Math.max(...perPolicy) / Math.min(...perPolicy) > 1.3,
  `and policy matters: median final price/launch ranges ${fx(Math.min(...perPolicy), 2)}×–${fx(Math.max(...perPolicy), 2)}× across the four policies`,
)

// ---------------------------------------------------------------------------------------------
console.log('\n— Detail: where the treasury and the network ended up —')
for (const policy of POLICIES) {
  const rs = runs.filter((r) => r.policy === policy)
  if (!rs.length) continue
  console.log(
    `  ${policy.padEnd(11)} treasury holds ${pct(quantile(rs.map((r) => r.finalTreasuryTokens / r.totalSupply), 0.5))} of total supply at week 104` +
      ` (median; it starts at ~${pct(quantile(rs.map((r) => r.treasuryShareAtLaunch), 0.5))})` +
      `, float ${pct(quantile(rs.map((r) => r.maxCirculating / r.totalSupply), 0.5))} of supply` +
      `, network value median $${(quantile(rs.map((r) => r.finalNetworkValue), 0.5) / 1e6).toFixed(1)}M`,
  )
}
ok(
  quantile(runs.filter((r) => r.policy === 'zero_spend').map((r) => r.finalTreasuryTokens / r.totalSupply), 0.5) ===
    quantile(runs.filter((r) => r.policy === 'zero_spend').map((r) => r.treasuryShareAtLaunch), 0.5),
  'a treasury that never spends is untouched after 104 weeks — nothing leaks out of it by accident',
)
ok(
  quantile(runs.filter((r) => r.policy === 'max_spend').map((r) => r.finalTreasuryTokens / r.totalSupply), 0.5) <
    0.2 * quantile(runs.filter((r) => r.policy === 'max_spend').map((r) => r.treasuryShareAtLaunch), 0.5),
  'and a treasury spending its cap every week for two years genuinely runs down — the resource is finite and depleting (loop A brake 3)',
)
console.log(`  (treasuryValue() is a read-out, never a budget: ${treasuryValue(null)} with no slice)`)

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
