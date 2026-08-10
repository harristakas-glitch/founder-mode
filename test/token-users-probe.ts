// ICO Slice 3 — does "growth is high but most of it is bought" actually happen?
//
// Run: npx tsx test/token-users-probe.ts
//
// This is the measurement the implementation plan gates the whole feature on: "Slice 3 is the one
// that matters. If 'growth is high but most of it is bought' is not compelling there, stop and
// reconsider before building 4–8." It is deliberately NOT in `npm test` — it plays hundreds of
// full careers — and it exists to produce numbers, not to pass.
//
// It answers four questions, in order:
//
//   1. Can heavy incentive spend produce Strong PMF? IT MUST NOT.
//   2. What do the three §12 retention numbers look like over a real campaign?
//   3. What happens when the incentives stop — how many leave, over how long?
//   4. Is the tension interesting? Is there a run where growth looks strong and the game correctly
//      says most of it is rented?
//
// SLICE SEAM, STATED HONESTLY: Slice 4 owns the player controls that create incentive programmes,
// so `t.incentives` is empty in a played game today and none of this happens on its own. The probe
// writes a `customer_rewards` programme directly, exactly as test/token-economy-probe.ts writes
// programmes to exercise the treasury cap. Every mechanism below the programme is the real one.

import { advanceWeek, newGame, valuation } from '../src/game/engine'
import { PMF_LABEL, incentivisedCustomers, organicCustomers, totalCustomers } from '../src/game/career/pmf'
import { tokenisationBars } from '../src/game/token/eligibility'
import { launchToken } from '../src/game/token/launch'
import { tokenInvariants } from '../src/game/token/market'
import {
  incentiveContext,
  mercenaryGrowthWarning,
  organicShare,
  retentionSplit,
} from '../src/game/token/users'
import type { GameState, SectorId } from '../src/game/types'
import type { GameConfig } from '../src/game/modes'

const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce']
const cfg = (seed: number, sector: SectorId): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}k`)
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)

/** A tokenised Career company with cash to keep it alive, so we measure the MECHANIC and not the
 *  twenty weeks of survival in front of it. Same construction as test/token-economy.test.ts. */
function tokenised(sector: SectorId, seed: number, weeks = 24): GameState | null {
  let s = newGame('Probe', sector, 'technical', { config: cfg(seed, sector) })
  s.cash = 40_000_000
  for (let w = 0; w < weeks && !s.gameOver; w++) s = advanceWeek(s)
  if (s.gameOver) return null
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 60)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  return launchToken(s).ok ? s : null
}

/** Point the treasury at customer rewards, hard enough that the 2%/wk token cap always binds. */
function fundRewards(s: GameState, startWeek: number): void {
  s.token!.incentives = [
    {
      category: 'customer_rewards', share: 0,
      // Far above the cap, so `treasuryCommitment` is always the binding constraint and the spend
      // is the maximum the contract permits. This is the strongest possible attempt.
      tokensPerWeek: s.token!.supply.treasury,
      startedWeek: startWeek,
      cumulativeTokens: 0,
      effectiveness: 0,
    },
  ]
}

interface WeekRow {
  week: number
  users: number
  organic: number
  incentivised: number
  organicRet: number
  incentivisedRet: number
  counterfactual: number
  strength: number
  spend: number
  pmfScore: number
  pmfStatus: string
  bestScore: number
  bestStatus: string
  warned: boolean
  valuation: number
  price: number
}

function row(s: GameState): WeekRow {
  const career = s.career!
  const target = career.primaryTargetSegmentId
  const split = retentionSplit(s, target)
  const inc = incentiveContext(s)
  // The company's PMF is the best segment's, exactly as the tick scores it.
  const best = { score: Math.round(s.pmf), status: '' }
  return {
    week: s.week,
    users: totalCustomers(career),
    organic: organicCustomers(career),
    incentivised: incentivisedCustomers(career),
    organicRet: split.organic,
    incentivisedRet: split.incentivised,
    counterfactual: split.incentivisedWithoutIncentives,
    strength: inc.strength,
    spend: inc.dollars,
    pmfScore: Math.round(s.pmf),
    pmfStatus: '',
    bestScore: best.score,
    bestStatus: best.status,
    warned: !!mercenaryGrowthWarning(s),
    valuation: valuation(s),
    price: s.token!.market.price,
  }
}

/** Play a tokenised company, optionally funding rewards from `fundFrom` and cutting them at `cutAt`. */
function play(
  s: GameState,
  opts: { weeks: number; fundFrom?: number; cutAt?: number; marketing?: number },
): { rows: WeekRow[]; end: GameState; invariantFails: string[] } {
  const rows: WeekRow[] = []
  const invariantFails: string[] = []
  let g = s
  const startWeek = g.week
  for (let i = 0; i < opts.weeks && !g.gameOver; i++) {
    g.marketingSpend = opts.marketing ?? 12_000
    const elapsed = g.week - startWeek
    if (opts.fundFrom !== undefined && elapsed === opts.fundFrom) fundRewards(g, g.week)
    if (opts.cutAt !== undefined && elapsed === opts.cutAt) g.token!.incentives = []
    // Keep the company solvent: this probe measures user composition, not runway management.
    if (g.cash < 5_000_000) g.cash = 40_000_000
    g = advanceWeek(g)
    if (g.gameOver || !g.token || !g.career) break
    rows.push(row(g))
    const v = tokenInvariants(g)
    if (v.length) invariantFails.push(`w${g.week}: ${v.join('; ')}`)
  }
  return { rows, end: g, invariantFails }
}

// =================================================================================================
console.log('\n════ 1. CAN HEAVY INCENTIVE SPEND PRODUCE STRONG PMF? ════\n')
// The attempt: a company with the weakest product it can have while still being allowed to launch,
// spending the treasury's entire permitted budget on customer rewards for eighty weeks. Against a
// byte-identical control that spends nothing.

interface PmfAttempt {
  sector: SectorId
  seed: number
  spentTotal: number
  boughtUsers: number
  pmfSpend: number
  pmfControl: number
  endSpend: number
  endControl: number
  statusSpend: string
  statusControl: string
  organicSpend: number
  organicControl: number
}

const attempts: PmfAttempt[] = []
const crossedStrong: string[] = []
for (const sector of SECTORS) {
  for (const seed of [7, 4242, 31337, 20260810]) {
    const base = tokenised(sector, seed)
    if (!base) continue
    const spendRun = play(structuredClone(base), { weeks: 80, fundFrom: 0 })
    const controlRun = play(structuredClone(base), { weeks: 80 })
    if (!spendRun.rows.length || !controlRun.rows.length) continue
    const a = spendRun.rows[spendRun.rows.length - 1]
    const b = controlRun.rows[controlRun.rows.length - 1]
    const bestSpend = Math.max(...spendRun.rows.map((r) => r.pmfScore))
    const bestControl = Math.max(...controlRun.rows.map((r) => r.pmfScore))
    if (bestSpend >= 66 && bestControl < 66) crossedStrong.push(`${sector}/${seed}: ${bestControl} -> ${bestSpend}`)
    attempts.push({
      sector,
      seed,
      spentTotal: spendRun.rows.reduce((x, r) => x + r.spend, 0),
      boughtUsers: a.incentivised,
      pmfSpend: bestSpend,
      pmfControl: bestControl,
      endSpend: a.pmfScore,
      endControl: b.pmfScore,
      statusSpend: statusFor(bestSpend),
      statusControl: statusFor(bestControl),
      organicSpend: a.organic,
      organicControl: b.organic,
    })
    if (spendRun.invariantFails.length) console.log(`  ⚠ invariants: ${spendRun.invariantFails.slice(0, 2).join(' | ')}`)
  }
}

function statusFor(score: number): string {
  // The bands `derivePmfForSegment` uses, for a readable label on the company score.
  return score >= 80 ? 'scalable?' : score >= 66 ? 'strong?' : score >= 52 ? 'emerging' : score >= 38 ? 'showing_value' : 'weak'
}

console.log('sector      seed        spent   bought   peakPMF spend/ctl   Δ    endPMF spend/ctl   Δ   organic spend/ctl')
for (const a of attempts)
  console.log(
    `${a.sector.padEnd(11)} ${String(a.seed).padEnd(9)} ${money(a.spentTotal).padStart(8)} ${String(a.boughtUsers).padStart(7)}` +
      `   ${(a.pmfSpend + ' / ' + a.pmfControl).padStart(15)} ${String(a.pmfSpend - a.pmfControl).padStart(3)}` +
      `   ${(a.endSpend + ' / ' + a.endControl).padStart(15)} ${String(a.endSpend - a.endControl).padStart(3)}` +
      `   ${(a.organicSpend + ' / ' + a.organicControl).padStart(15)}`,
  )
const deltas = attempts.map((a) => a.pmfSpend - a.pmfControl)
const endDeltas = attempts.map((a) => a.endSpend - a.endControl)
console.log(
  `\n  PEAK PMF delta (spend − control): min ${Math.min(...deltas)}, median ${median(deltas)}, max ${Math.max(...deltas)}`,
)
console.log(
  `  END-OF-RUN PMF delta:             min ${Math.min(...endDeltas)}, median ${median(endDeltas)}, max ${Math.max(...endDeltas)}` +
    `   [MUST be ≤ 0 — spend can only ever cost PMF, never buy it]`,
)
console.log(`  total spend across ${attempts.length} attempts: ${money(attempts.reduce((x, a) => x + a.spentTotal, 0))}`)
console.log(`  users bought: ${attempts.reduce((x, a) => x + a.boughtUsers, 0).toLocaleString()}`)
console.log(
  crossedStrong.length
    ? `  ⛔ ${crossedStrong.length} run(s) crossed the Strong PMF band (66) that their control did not: ${crossedStrong.join(', ')}`
    : `  ✓ no run crossed the Strong PMF band (66) that its zero-spend control did not`,
)

// =================================================================================================
console.log('\n════ 2. THE THREE §12 NUMBERS OVER A CAMPAIGN ════\n')

const showcase = tokenised('devtools', 4242)
if (showcase) {
  const run = play(structuredClone(showcase), { weeks: 70, fundFrom: 6 })
  console.log('week  users  organic  rented  share   organic4wk  incent4wk  if-stopped  strength  spend/wk   warn')
  for (const r of run.rows)
    if (r.week % 6 === 0 || r.warned)
      console.log(
        `${String(r.week).padStart(4)} ${String(r.users).padStart(6)} ${String(r.organic).padStart(8)} ${String(r.incentivised).padStart(7)}` +
          `  ${pct(r.incentivised / Math.max(1, r.users)).padStart(6)}` +
          `  ${pct(r.organicRet).padStart(10)} ${pct(r.incentivisedRet).padStart(10)} ${pct(r.counterfactual).padStart(11)}` +
          `  ${r.strength.toFixed(2).padStart(8)} ${money(r.spend).padStart(9)}   ${r.warned ? '⚠' : ' '}`,
      )
}

// =================================================================================================
console.log('\n════ 3. WHAT HAPPENS WHEN THE INCENTIVES STOP ════\n')

for (const sector of ['devtools', 'social', 'saas'] as SectorId[]) {
  const base = tokenised(sector, 4242)
  if (!base) continue
  const run = play(structuredClone(base), { weeks: 70, fundFrom: 4, cutAt: 44 })
  const cutIdx = run.rows.findIndex((r) => r.week === run.rows[0].week + 43)
  if (cutIdx < 0) continue
  const peak = run.rows[cutIdx]
  const after = run.rows.slice(cutIdx + 1)
  if (!after.length) continue
  const half = after.find((r) => r.incentivised <= peak.incentivised * 0.5)
  const tenth = after.find((r) => r.incentivised <= peak.incentivised * 0.1)
  const last = after[after.length - 1]
  console.log(`${sector}:`)
  console.log(`  at the cut (week ${peak.week}): ${peak.incentivised.toLocaleString()} rented of ${peak.users.toLocaleString()} total (${pct(peak.incentivised / Math.max(1, peak.users))})`)
  console.log(`  half gone after ${half ? half.week - peak.week : '>' + (last.week - peak.week)} weeks; 90% gone after ${tenth ? tenth.week - peak.week : '>' + (last.week - peak.week)} weeks`)
  console.log(`  ${last.week - peak.week} weeks later: ${last.incentivised.toLocaleString()} rented, ${last.organic.toLocaleString()} organic`)
  console.log(
    `  valuation ${money(peak.valuation)} → ${money(last.valuation)};  users ${peak.users.toLocaleString()} → ${last.users.toLocaleString()}` +
      ` (${pct((last.users - peak.users) / Math.max(1, peak.users))})`,
  )
  console.log(`  4wk retention at the cut — organic ${pct(peak.organicRet)}, incentivised ${pct(peak.incentivisedRet)}, forecast if stopped ${pct(peak.counterfactual)}`)
  // The honest measurement: what fraction of the population that existed AT the cut is still here
  // four weeks later — compared against what the counterfactual predicted before the cut happened.
  const fourWeeksOn = after.find((r) => r.week - peak.week === 4)
  if (fourWeeksOn)
    console.log(
      `  survivors of the at-cut population after 4 weeks: ${pct(fourWeeksOn.incentivised / Math.max(1, peak.incentivised))}` +
        `  vs the forecast shown before the cut: ${pct(peak.counterfactual)}`,
    )
  const stale = after.filter((r) => r.week - peak.week >= 12).map((r) => r.incentivisedRet)
  if (stale.length) console.log(`  displayed incentivised retention 12+ weeks after the cut: ${pct(median(stale))} (falls back to the forecast once nobody is left)`)
}

// =================================================================================================
console.log('\n════ 4. IS THE TENSION INTERESTING? ════\n')
// Sweep for a run where growth LOOKS strong and the game correctly says most of it is rented.

interface Tension {
  sector: SectorId
  seed: number
  week: number
  growth: number
  share: number
  organicRet: number
  incRet: number
  counterfactual: number
  users: number
  organic: number
}

const tensions: Tension[] = []
let sweptRuns = 0
let warnedRuns = 0
for (const sector of SECTORS) {
  for (const seed of [7, 99, 4242, 31337, 20260810, 555]) {
    const base = tokenised(sector, seed)
    if (!base) continue
    sweptRuns++
    const run = play(structuredClone(base), { weeks: 70, fundFrom: 6 })
    const warned = run.rows.filter((r) => r.warned)
    if (!warned.length) continue
    warnedRuns++
    const r = warned[Math.floor(warned.length / 2)]
    const g = run.end
    const growthIdx = run.rows.findIndex((x) => x.week === r.week)
    const prior = run.rows[Math.max(0, growthIdx - 8)]
    tensions.push({
      sector,
      seed,
      week: r.week,
      growth: (r.users - prior.users) / Math.max(1, prior.users),
      share: r.incentivised / Math.max(1, r.users),
      organicRet: r.organicRet,
      incRet: r.incentivisedRet,
      counterfactual: r.counterfactual,
      users: r.users,
      organic: r.organic,
    })
    void g
  }
}

console.log(`runs swept: ${sweptRuns};  runs where the §53 warning fired at least once: ${warnedRuns} (${pct(warnedRuns / Math.max(1, sweptRuns))})\n`)
console.log('sector      seed     week  8wk growth  rented share  organic4wk  incent4wk  if-stopped   users  organic')
for (const t of tensions)
  console.log(
    `${t.sector.padEnd(11)} ${String(t.seed).padEnd(8)} ${String(t.week).padStart(4)}  ${pct(t.growth).padStart(10)}` +
      `  ${pct(t.share).padStart(12)}  ${pct(t.organicRet).padStart(10)} ${pct(t.incRet).padStart(10)} ${pct(t.counterfactual).padStart(11)}` +
      `  ${String(t.users).padStart(6)} ${String(t.organic).padStart(8)}`,
  )

// =================================================================================================
console.log('\n════ 5. THE VALUATION DISCOUNT AND THE NETWORK GATE ════\n')
for (const sector of SECTORS) {
  const vshow = tokenised(sector, 31337)
  if (!vshow) continue
  const run = play(structuredClone(vshow), { weeks: 60, fundFrom: 4 })
  const g = run.end
  if (!g.career || !g.token) continue
  const discounted = valuation(g)
  const naiveState = structuredClone(g)
  for (const c of naiveState.career!.cohorts) c.origin = undefined
  const full = valuation(naiveState)
  console.log(
    `${sector.padEnd(11)} rented ${pct(1 - organicShare(g)).padStart(6)} of ${totalCustomers(g.career).toLocaleString().padStart(9)}` +
      `   valuation ${money(discounted).padStart(9)} vs ${money(full).padStart(9)} undiscounted` +
      `   →  the §1.5 discount is worth ${pct(1 - discounted / Math.max(1, full)).padStart(6)} of enterprise value` +
      `   network-unicorn organic gate: ${organicShare(g) >= 0.5 ? 'PASSES' : 'BLOCKED'}`,
  )
}
console.log(
  '\n  NOTE: valuation() is revenue-dominated, and §1.5 discounts only the USER term. The rented\n' +
    '  users\' REVENUE is counted in full, which the contract leaves alone deliberately. So the\n' +
    '  discount is a small correction, not the thing that stops mercenary growth inflating value —\n' +
    '  what does that is section 3: the moment the rewards stop, enterprise value falls 67–85%.',
)

console.log('\ndone.\n')
void PMF_LABEL
