// ICO Slice 4 — do the six categories actually do six different things?
//
// Run: npx tsx test/token-incentives-probe.ts
//
// The implementation plan's gate for this slice is one sentence: "Each allocation has a measured,
// distinct effect." This file is that measurement. It is deliberately NOT in `npm test` — it plays
// several hundred full careers — and it exists to produce numbers, not to pass.
//
// THE EXPERIMENT, and why it is a fair one:
//
//   Every arm spends the SAME tokens. A treatment points 100% of the weekly treasury budget at one
//   category; the control points 0% anywhere. Because `treasuryCommitment` caps the release at 2% of
//   the treasury regardless of how the shares are split, every treatment arm releases an identical
//   number of tokens into the float on an identical schedule, and therefore suffers an identical
//   dilution and an identical supply pressure. The ONLY thing that differs between two treatment
//   arms is where the tokens went. Any difference in the outcome is attributable to the category and
//   to nothing else.
//
// It answers, in order:
//
//   1. What does each category move, against the control, and by how much?
//   2. Do any two categories move the same things — i.e. are they one lever with two names?
//   3. Does the §53 warning still DISCRIMINATE now that spend is a dial rather than a wall?
//   4. Do the tokenomics decisions at launch (founder share, vesting, utility model) matter?
//   7. Is a treasury sale a real capital route, and is it free money? (It must not be.)
//   8. How much does the stage-frozen marketing cap cost a company that took the fork?

import { acceptTermSheet, advanceWeek, marketingMax, newGame, pitchInvestors, sellTokenTreasury, valuation } from '../src/game/engine'
import { totalCustomers, incentivisedCustomers } from '../src/game/career/pmf'
import { tokenisationBars } from '../src/game/token/eligibility'
import { employeeTokenComp, INCENTIVE_CATEGORIES, setIncentiveShares, type IncentiveShares } from '../src/game/token/incentives'
import { allocationFrom, launchToken, type LaunchDraft } from '../src/game/token/launch'
import { tokenInvariants } from '../src/game/token/market'
import { founderStanding, networkValue, realisableTokenValue } from '../src/game/token/scoring'
import { maxTreasurySale } from '../src/game/token/treasury'
import { mercenaryGrowthWarning, organicUsers, incentivisedUsers } from '../src/game/token/users'
import type { TokenIncentiveCategory } from '../src/game/token/types'
import type { GameState, SectorId } from '../src/game/types'
import type { GameConfig } from '../src/game/modes'

const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce']
const SEEDS = [7, 42, 101, 4242, 31337, 2024]
const cfg = (seed: number, sector: SectorId): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })

const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`)
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

/** A tokenised Career company with enough cash to keep it alive, so we measure the MECHANIC rather
 *  than the twenty weeks of survival in front of it. Same construction as the Slice-3 probe. */
function tokenised(sector: SectorId, seed: number, draft: LaunchDraft = {}, weeks = 24): GameState | null {
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
  return launchToken(s, draft).ok ? s : null
}

interface Outcome {
  utility: number
  depth: number
  speculation: number
  volatility: number
  trust: number
  decentralisation: number
  engagement: number
  hype: number
  members: number
  organic: number
  rented: number
  users: number
  cash: number
  morale: number
  priceVsLaunch: number
  network: number
  standing: number
  tokenLeg: number
  pmf: number
  warned: number
  invariantBreaks: number
}

const METRICS: (keyof Outcome)[] = [
  'utility', 'depth', 'speculation', 'volatility', 'trust', 'decentralisation', 'engagement',
  'hype', 'members', 'organic', 'rented', 'users', 'cash', 'morale', 'priceVsLaunch', 'network',
  'standing', 'pmf',
]

function measure(s: GameState, warned: number, breaks: number): Outcome {
  const t = s.token!
  return {
    utility: t.market.utility,
    depth: t.market.depth,
    speculation: t.market.speculation,
    volatility: t.market.volatility,
    trust: t.community.trust,
    decentralisation: t.community.decentralisation,
    engagement: t.community.engagement,
    hype: s.hype,
    members: t.community.members,
    organic: organicUsers(s),
    rented: incentivisedUsers(s),
    users: s.users,
    cash: s.cash,
    morale: mean(s.employees.map((e) => e.morale)),
    priceVsLaunch: t.market.price / t.plan.launchPrice,
    network: networkValue(s),
    standing: founderStanding(s),
    tokenLeg: realisableTokenValue(s),
    pmf: s.pmf,
    warned,
    invariantBreaks: breaks,
  }
}

/** Play a tokenised company for `weeks` under one incentive policy. */
function run(sector: SectorId, seed: number, shares: Partial<IncentiveShares>, weeks = 60, draft: LaunchDraft = {}): Outcome | null {
  const s0 = tokenised(sector, seed, draft)
  if (!s0) return null
  let s = s0
  setIncentiveShares(s, shares)
  let warned = 0
  let breaks = 0
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    s = advanceWeek(s)
    // The policy is a standing order; re-asserting it every week is what a player holding a slider
    // in place looks like, and it keeps the arms comparable as the treasury drains.
    if (!s.gameOver) setIncentiveShares(s, shares)
    if (mercenaryGrowthWarning(s)) warned++
    breaks += tokenInvariants(s).length
  }
  if (!s.token) return null
  return measure(s, warned, breaks)
}

// =================================================================================================
console.log('\n=== 1. WHAT EACH CATEGORY MOVES, AGAINST A ZERO-SPEND CONTROL ===')
console.log('Every arm releases the same tokens on the same schedule. Only the destination differs.\n')

const arms: { name: string; shares: Partial<IncentiveShares> }[] = [
  { name: 'control (0%)', shares: {} },
  ...INCENTIVE_CATEGORIES.map((c) => ({ name: c, shares: { [c]: 1 } as Partial<IncentiveShares> })),
]

const results = new Map<string, Outcome[]>()
for (const arm of arms) results.set(arm.name, [])
let plays = 0
for (const sector of SECTORS) {
  for (const seed of SEEDS) {
    for (const arm of arms) {
      const o = run(sector, seed, arm.shares)
      if (o) {
        results.get(arm.name)!.push(o)
        plays++
      }
    }
  }
}
console.log(`${plays} runs of 60 weeks each, ${SECTORS.length} sectors × ${SEEDS.length} seeds × ${arms.length} arms.\n`)

const control = results.get('control (0%)')!
const controlMed: Record<string, number> = {}
for (const m of METRICS) controlMed[m] = median(control.map((o) => o[m] as number))

const SHOW: (keyof Outcome)[] = ['utility', 'depth', 'speculation', 'trust', 'decentralisation', 'hype', 'organic', 'rented', 'cash', 'morale', 'standing']
console.log(pad('category', 22) + SHOW.map((m) => padL(String(m).slice(0, 8), 10)).join(''))
console.log(pad('control (median)', 22) + SHOW.map((m) => padL(controlMed[m] >= 1000 ? money(controlMed[m]) : controlMed[m].toFixed(2), 10)).join(''))
console.log('-'.repeat(22 + SHOW.length * 10))
for (const arm of arms.slice(1)) {
  const rows = results.get(arm.name)!
  const cells = SHOW.map((m) => {
    const med = median(rows.map((o) => o[m] as number))
    const base = controlMed[m]
    const rel = base !== 0 ? (med - base) / Math.abs(base) : med === 0 ? 0 : 1
    const sign = rel > 0 ? '+' : ''
    return padL(Math.abs(rel) < 0.005 ? '·' : `${sign}${(rel * 100).toFixed(0)}%`, 10)
  })
  console.log(pad(arm.name, 22) + cells.join(''))
}

console.log('\nAbsolute medians (same runs):')
console.log(pad('category', 22) + SHOW.map((m) => padL(String(m).slice(0, 8), 10)).join(''))
for (const arm of arms) {
  const rows = results.get(arm.name)!
  const cells = SHOW.map((m) => {
    const med = median(rows.map((o) => o[m] as number))
    return padL(Math.abs(med) >= 10000 ? money(med) : med.toFixed(2), 10)
  })
  console.log(pad(arm.name, 22) + cells.join(''))
}

// =================================================================================================
console.log('\n=== 2. ARE ANY TWO CATEGORIES THE SAME LEVER? ===')
console.log('Cosine similarity of each pair\'s effect vector (median deltas against control, per-metric')
console.log('normalised by the largest |delta| any category produced on that metric).\n')

const scale: Record<string, number> = {}
for (const m of METRICS) {
  let max = 0
  for (const arm of arms.slice(1)) {
    const med = median(results.get(arm.name)!.map((o) => o[m] as number))
    max = Math.max(max, Math.abs(med - controlMed[m]))
  }
  scale[m] = max || 1
}
const vectors = new Map<string, number[]>()
for (const arm of arms.slice(1)) {
  const rows = results.get(arm.name)!
  vectors.set(arm.name, METRICS.map((m) => (median(rows.map((o) => o[m] as number)) - controlMed[m]) / scale[m]))
}
const cats = arms.slice(1).map((a) => a.name)
const cos = (a: number[], b: number[]) => {
  const dot = a.reduce((acc, v, i) => acc + v * b[i], 0)
  const na = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0))
  const nb = Math.sqrt(b.reduce((acc, v) => acc + v * v, 0))
  return na && nb ? dot / (na * nb) : 0
}
console.log(pad('', 22) + cats.map((c) => padL(c.slice(0, 9), 11)).join(''))
let worstPair = { a: '', b: '', v: -2 }
for (const a of cats) {
  const cells = cats.map((b) => {
    const v = cos(vectors.get(a)!, vectors.get(b)!)
    if (a !== b && v > worstPair.v) worstPair = { a, b, v }
    return padL(a === b ? '—' : v.toFixed(2), 11)
  })
  console.log(pad(a, 22) + cells.join(''))
}
console.log(`\nMost similar pair: ${worstPair.a} / ${worstPair.b} at ${worstPair.v.toFixed(2)}.`)
console.log('1.00 would mean identical direction — the same lever with two names. Merge anything above ~0.9.')

// =================================================================================================
console.log('\n=== 3. DOES THE §53 WARNING STILL DISCRIMINATE? ===')
console.log('Slice 3 measured 28/30 under sustained MAXIMUM customer-rewards spend, which is the')
console.log('pathological policy. Now that spend is a dial, a warning that fires on every policy is a')
console.log('warning nobody reads. Fire rate = share of runs in which it fired at least once.\n')

const POLICIES: { name: string; shares: Partial<IncentiveShares> }[] = [
  { name: 'nothing', shares: {} },
  { name: 'rewards 10%', shares: { customer_rewards: 0.1 } },
  { name: 'rewards 25%', shares: { customer_rewards: 0.25 } },
  { name: 'rewards 50%', shares: { customer_rewards: 0.5 } },
  { name: 'rewards 100% (Slice 3 arm)', shares: { customer_rewards: 1 } },
  { name: 'balanced sixths', shares: Object.fromEntries(INCENTIVE_CATEGORIES.map((c) => [c, 1 / 6])) as Partial<IncentiveShares> },
  { name: 'growth mix (40/30/30)', shares: { customer_rewards: 0.4, partnerships: 0.3, developer_grants: 0.3 } },
  { name: 'no rewards at all', shares: { developer_grants: 0.5, partnerships: 0.5 } },
]
console.log(pad('policy', 28) + padL('fired', 8) + padL('rate', 8) + padL('wks warned', 12) + padL('rented %', 10) + padL('pmf', 8))
for (const p of POLICIES) {
  let fired = 0
  let runs = 0
  const weeksWarned: number[] = []
  const rentedShare: number[] = []
  const pmfs: number[] = []
  for (const sector of SECTORS) {
    for (const seed of SEEDS) {
      const o = run(sector, seed, p.shares)
      if (!o) continue
      runs++
      if (o.warned > 0) fired++
      weeksWarned.push(o.warned)
      rentedShare.push(o.users > 0 ? o.rented / o.users : 0)
      pmfs.push(o.pmf)
    }
  }
  console.log(
    pad(p.name, 28) +
      padL(`${fired}/${runs}`, 8) +
      padL(`${((fired / Math.max(1, runs)) * 100).toFixed(0)}%`, 8) +
      padL(median(weeksWarned).toFixed(0), 12) +
      padL(`${(median(rentedShare) * 100).toFixed(0)}%`, 10) +
      padL(median(pmfs).toFixed(0), 8),
  )
}

// =================================================================================================
console.log('\n=== 4. THE TOKENOMICS SCREEN: DO THE LAUNCH DECISIONS MATTER? ===\n')

console.log('a) Founder allocation (§22), TWO WAYS, because the slider has two possible counterparties.')
console.log('   (i) founder ↔ community, treasury held at its default: the §22 trade proper.')
console.log('   (ii) founder ↔ treasury, community held: what the second slider does to your firepower.\n')
for (const mode of ['founder ↔ community', 'founder ↔ treasury'] as const) {
  console.log(
    `   ${mode}\n` +
      pad('   founder share', 22) + padL('trust', 9) + padL('spec', 9) + padL('price×', 9) + padL('tokenLeg', 11) + padL('standing', 12),
  )
  for (const label of ['minimum', 'expected', 'maximum'] as const) {
    const trust: number[] = []
    const spec: number[] = []
    const px: number[] = []
    const leg: number[] = []
    const standing: number[] = []
    const shares: number[] = []
    for (const sector of SECTORS) {
      for (const seed of SEEDS) {
        const ref = tokenised(sector, seed)
        if (!ref) continue
        const plan = ref.token!.plan.allocation
        const target = label === 'minimum' ? 0 : label === 'maximum' ? 1 : plan.founder
        // (i) keeps the treasury where the default put it by pushing the difference into the
        //     community; (ii) keeps the community and lets the treasury absorb it.
        const wanted = allocationFrom(ref, target, plan.community)
        const alloc =
          mode === 'founder ↔ community'
            ? allocationFrom(ref, target, Math.max(0, plan.community + (plan.founder - wanted.founder)))
            : wanted
        const o = run(sector, seed, { customer_rewards: 0.3, developer_grants: 0.3 }, 60, { allocation: alloc })
        if (!o) continue
        shares.push(alloc.founder)
        trust.push(o.trust)
        spec.push(o.speculation)
        px.push(o.priceVsLaunch)
        leg.push(o.tokenLeg)
        standing.push(o.standing)
      }
    }
    console.log(
      pad(`   ${label} (${(median(shares) * 100).toFixed(0)}%)`, 22) +
        padL(median(trust).toFixed(1), 9) +
        padL(median(spec).toFixed(1), 9) +
        padL(median(px).toFixed(2), 9) +
        padL(money(median(leg)), 11) +
        padL(money(median(standing)), 12),
    )
  }
  console.log('')
}

console.log('\nb) Vesting (§23). Unlocks are supply pressure; the cliff decides what you can realise.')
console.log(pad('policy', 22) + padL('trust', 9) + padL('locked%', 10) + padL('price×', 9) + padL('tokenLeg', 12) + padL('standing', 12))
for (const vesting of ['short', 'standard', 'long'] as const) {
  const trust: number[] = []
  const locked: number[] = []
  const px: number[] = []
  const leg: number[] = []
  const standing: number[] = []
  for (const sector of SECTORS) {
    for (const seed of SEEDS) {
      const s0 = tokenised(sector, seed, { vesting })
      if (!s0) continue
      let s = s0
      setIncentiveShares(s, { customer_rewards: 0.3, developer_grants: 0.3 })
      for (let w = 0; w < 60 && !s.gameOver; w++) {
        s = advanceWeek(s)
        if (!s.gameOver) setIncentiveShares(s, { customer_rewards: 0.3, developer_grants: 0.3 })
      }
      if (!s.token) continue
      trust.push(s.token.community.trust)
      locked.push(s.token.supply.locked / s.token.supply.total)
      px.push(s.token.market.price / s.token.plan.launchPrice)
      leg.push(realisableTokenValue(s))
      standing.push(founderStanding(s))
    }
  }
  console.log(
    pad(vesting, 22) +
      padL(median(trust).toFixed(1), 9) +
      padL(`${(median(locked) * 100).toFixed(0)}%`, 10) +
      padL(median(px).toFixed(2), 9) +
      padL(money(median(leg)), 12) +
      padL(money(median(standing)), 12),
  )
}

console.log('\nc) Primary utility model (§24), in devtools — the sector with the widest fit spread.')
console.log(pad('model', 24) + padL('launch util', 13) + padL('util @60', 11) + padL('price×', 9) + padL('standing', 12))
for (const model of ['ecosystem_incentive', 'product_access', 'governance', 'marketplace_currency', 'rewards'] as const) {
  const launchUtil: number[] = []
  const util: number[] = []
  const px: number[] = []
  const standing: number[] = []
  for (const seed of SEEDS) {
    const s0 = tokenised('devtools', seed, { utilityModel: model })
    if (!s0) continue
    launchUtil.push(s0.token!.market.utility)
    const o = run('devtools', seed, { developer_grants: 0.5 }, 60, { utilityModel: model })
    if (!o) continue
    util.push(o.utility)
    px.push(o.priceVsLaunch)
    standing.push(o.standing)
  }
  console.log(
    pad(model, 24) +
      padL(median(launchUtil).toFixed(1), 13) +
      padL(median(util).toFixed(1), 11) +
      padL(median(px).toFixed(2), 9) +
      padL(money(median(standing)), 12),
  )
}

// =================================================================================================
console.log('\n=== 4d. EMPLOYEE TOKEN COMPENSATION, WITH A TEAM TO PAY ===')
console.log('Section 1 measures this category at zero, because a probe company hired nobody: with no')
console.log('payroll there is nothing to offset and every token is wasted. Here the same company is')
console.log('given eight engineers first, which is what §16 is actually about.\n')

/** Eight engineers on market salaries — ~$23k/wk of payroll to substitute against. */
function withTeam(s: GameState, n = 8): GameState {
  for (let i = 0; i < n; i++)
    s.employees.push({
      id: `probe-eng-${i}`,
      name: `Engineer ${i}`,
      role: 'engineer',
      skill: 60,
      salary: 150_000,
      morale: 70,
      weeks: 0,
      trait: null,
    })
  return s
}

console.log(
  pad('policy', 26) + padL('cash', 12) + padL('payroll/wk', 12) + padL('covered', 10) + padL('morale', 9) + padL('headcount', 11) + padL('price×', 9),
)
for (const arm of [
  { name: 'control (0%)', shares: {} as Partial<IncentiveShares> },
  { name: 'employee comp 50%', shares: { employee_compensation: 0.5 } as Partial<IncentiveShares> },
  { name: 'employee comp 100%', shares: { employee_compensation: 1 } as Partial<IncentiveShares> },
]) {
  const cash: number[] = []
  const morale: number[] = []
  const heads: number[] = []
  const covered: number[] = []
  const px: number[] = []
  const payrolls: number[] = []
  for (const sector of SECTORS) {
    for (const seed of SEEDS) {
      const s0 = tokenised(sector, seed)
      if (!s0) continue
      let s = withTeam(s0)
      setIncentiveShares(s, arm.shares)
      for (let w = 0; w < 60 && !s.gameOver; w++) {
        s = advanceWeek(s)
        if (!s.gameOver) setIncentiveShares(s, arm.shares)
      }
      if (!s.token) continue
      const comp = employeeTokenComp(s)
      cash.push(s.cash)
      morale.push(mean(s.employees.map((e) => e.morale)))
      heads.push(s.employees.length)
      covered.push(comp.coverage)
      payrolls.push(comp.payroll)
      px.push(s.token.market.price / s.token.plan.launchPrice)
    }
  }
  console.log(
    pad(arm.name, 26) +
      padL(money(median(cash)), 12) +
      padL(money(median(payrolls)), 12) +
      padL(`${(median(covered) * 100).toFixed(0)}%`, 10) +
      padL(median(morale).toFixed(1), 9) +
      padL(median(heads).toFixed(0), 11) +
      padL(median(px).toFixed(2), 9),
  )
}

// =================================================================================================
console.log('\n=== 5. INVARIANTS ===')
let totalBreaks = 0
for (const arm of arms) totalBreaks += results.get(arm.name)!.reduce((a, o) => a + o.invariantBreaks, 0)
console.log(`§4.6 invariant violations across every week of every arm in section 1: ${totalBreaks}`)
console.log(`(supply identity, user split, price floor, 0–100 scalars, allocation sum, array caps)`)

console.log('\n=== 6. IS ANY OF IT WORTH IT? ===')
const spendAll = results.get('customer_rewards')!
console.log(
  `control standing ${money(median(control.map((o) => o.standing)))} · best single-category arm ` +
    `${money(Math.max(...arms.slice(1).map((a) => median(results.get(a.name)!.map((o) => o.standing)))))}`,
)
console.log(
  `control users ${median(control.map((o) => o.users)).toFixed(0)} · customer-rewards users ` +
    `${median(spendAll.map((o) => o.users)).toFixed(0)} of which ${median(spendAll.map((o) => o.rented)).toFixed(0)} rented`,
)
console.log('\n=== 7. TREASURY SALES: THE ROUND A TOKENISED COMPANY CAN STILL RAISE (§6, §30) ===')
console.log('60 weeks post-launch, running a 30/30 rewards+grants policy in every arm.\n')
console.log(pad('sale policy', 26) + padL('raised', 11) + padL('vs ent.val', 11) + padL('price×', 9) + padL('trust', 8) + padL('network', 11) + padL('breaks', 8))
for (const policy of ['never', 'every 16 wks (max)', 'every 8 wks (max)', 'every week (max)'] as const) {
  const raised: number[] = []
  const share: number[] = []
  const px: number[] = []
  const trust: number[] = []
  const net: number[] = []
  let breaks = 0
  for (const sector of SECTORS) {
    for (const seed of SEEDS) {
      const s0 = tokenised(sector, seed)
      if (!s0) continue
      let s = s0
      const ent = valuation(s)
      setIncentiveShares(s, { customer_rewards: 0.3, developer_grants: 0.3 })
      const period = policy === 'never' ? 0 : policy === 'every 16 wks (max)' ? 16 : policy === 'every 8 wks (max)' ? 8 : 1
      for (let w = 0; w < 60 && !s.gameOver; w++) {
        if (period > 0 && w % period === 0) sellTokenTreasury(s, maxTreasurySale(s))
        s = advanceWeek(s)
        if (!s.gameOver) setIncentiveShares(s, { customer_rewards: 0.3, developer_grants: 0.3 })
        breaks += tokenInvariants(s).length
      }
      if (!s.token) continue
      raised.push(s.token.treasurySales.proceeds)
      share.push(ent > 0 ? s.token.treasurySales.proceeds / ent : 0)
      px.push(s.token.market.price / s.token.plan.launchPrice)
      trust.push(s.token.community.trust)
      net.push(networkValue(s))
    }
  }
  console.log(
    pad(policy, 26) +
      padL(money(median(raised)), 11) +
      padL(`${(median(share) * 100).toFixed(0)}%`, 11) +
      padL(median(px).toFixed(2), 9) +
      padL(median(trust).toFixed(1), 8) +
      padL(money(median(net)), 11) +
      padL(String(breaks), 8),
  )
}

console.log('\n=== 8. THE MARKETING-CAP FREEZE THE FORK IMPOSES SILENTLY ===')
console.log('`marketingMax` is purely stage-based and stage only advances by accepting a term sheet,')
console.log('which a tokenised company cannot do. Measured at the week a company becomes eligible:\n')

const stages: Record<string, number> = {}
const caps: number[] = []
const cash: number[] = []
const nets: number[] = []
for (const sector of SECTORS) {
  for (const seed of SEEDS) {
    for (const weeks of [24, 40, 60, 80]) {
      const s = tokenised(sector, seed, weeks)
      if (!s) continue
      stages[s.stage] = (stages[s.stage] ?? 0) + 1
      caps.push(marketingMax(s))
      cash.push(s.cash)
      nets.push(networkValue(s))
    }
  }
}
console.log('stage at tokenisation:', Object.entries(stages).map(([k, v]) => `${k} ×${v}`).join(' · '))
console.log(`median marketing cap frozen at ${money(median(caps))}/wk`)

// What a traditional company of the same age reaches when it actually RAISES — which is the only
// way `s.stage` ever moves, and therefore the only way `marketingMax` ever moves.
const tradCaps: number[] = []
const tradStages: Record<string, number> = {}
let raisesAttempted = 0
for (const sector of SECTORS) {
  for (const seed of SEEDS) {
    let s = newGame('Trad', sector, 'technical', { config: cfg(seed, sector) })
    s.cash = 40_000_000
    s.users = 400
    s.pmf = 62
    for (let w = 0; w < 84 && !s.gameOver; w++) {
      s.marketingSpend = Math.min(marketingMax(s), 20_000)
      if (s.raiseCooldown <= 0 && s.termSheets.length === 0 && valuation(s) >= 1_000_000) s.termSheets = pitchInvestors(s).sheets
      if (s.termSheets.length > 0) acceptTermSheet(s, s.termSheets[0].id)
      raisesAttempted++
      s = advanceWeek(s)
    }
    tradCaps.push(marketingMax(s))
    tradStages[s.stage] = (tradStages[s.stage] ?? 0) + 1
  }
}

// And the same seeds, tokenised at week 24, played the same 60 weeks: the cap they are stuck with.
const forkedCaps: number[] = []
const forkedStages: Record<string, number> = {}
for (const sector of SECTORS) {
  for (const seed of SEEDS) {
    const s0 = tokenised(sector, seed)
    if (!s0) continue
    let s = s0
    setIncentiveShares(s, { customer_rewards: 0.3, partnerships: 0.3 })
    for (let w = 0; w < 60 && !s.gameOver; w++) {
      s.marketingSpend = marketingMax(s)
      if (s.cash < 5_000_000) s.cash = 40_000_000
      s = advanceWeek(s)
    }
    forkedCaps.push(marketingMax(s))
    forkedStages[s.stage] = (forkedStages[s.stage] ?? 0) + 1
  }
}
console.log(`traditional median valuation at week 84 drove ${raisesAttempted} pitch-weeks`)
console.log('traditional stage at week 84:', Object.entries(tradStages).map(([k, v]) => `${k} ×${v}`).join(' · '))
console.log(`traditional median cap at week 84: ${money(median(tradCaps))}/wk`)
console.log('tokenised stage at week 84:', Object.entries(forkedStages).map(([k, v]) => `${k} ×${v}`).join(' · '))
console.log(`tokenised median cap at week 84: ${money(median(forkedCaps))}/wk`)

console.log('\nWhat a frozen cap costs: same company, same 60 weeks, cap lifted by hand vs left alone.')
console.log(pad('marketing cap', 26) + padL('users', 10) + padL('revenue/wk', 12) + padL('ent. value', 12) + padL('standing', 12))
for (const lift of [1, 3, 10] as const) {
  const users: number[] = []
  const rev: number[] = []
  const val: number[] = []
  for (const sector of SECTORS) {
    for (const seed of SEEDS) {
      const s0 = tokenised(sector, seed)
      if (!s0) continue
      let s = s0
      setIncentiveShares(s, { customer_rewards: 0.3, partnerships: 0.3 })
      for (let w = 0; w < 60 && !s.gameOver; w++) {
        // The cap is what we are testing, so spend right up to `lift ×` it and keep cash topped up
        // so the comparison is about the CAP and not about affordability.
        s.marketingSpend = marketingMax(s) * lift
        if (s.cash < 5_000_000) s.cash = 40_000_000
        s = advanceWeek(s)
        if (!s.gameOver) setIncentiveShares(s, { customer_rewards: 0.3, partnerships: 0.3 })
      }
      users.push(s.users)
      rev.push(s.lastRevenue)
      val.push(valuation(s))
    }
  }
  console.log(
    pad(`${lift}× the stage cap`, 26) +
      padL(median(users).toFixed(0), 10) +
      padL(money(median(rev)), 12) +
      padL(money(median(val)), 12) +
      padL('', 12),
  )
}

void totalCustomers
void incentivisedCustomers
