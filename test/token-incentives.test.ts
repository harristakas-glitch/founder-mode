// Tokenisation / ICO — Slice 4: tokenomics and the six incentive categories.
// Run: npx tsx test/token-incentives.test.ts
//
// Covers brief §13–§19 (the categories), §20–§24 (the launch screen), §41 (unlocks) and §16
// (employee token comp), plus docs/ico-architecture.md §4 loops A and D. The heavy end — 210 runs
// of 60 weeks measuring each category against a control — lives in test/token-incentives-probe.ts.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose and this
// file re-run to confirm it goes red. The mutations, and which assertion killed each, are listed at
// the bottom.
//
// THE LESSON THIS FILE IS BUILT AROUND, taken from Slices 1 and 3, both of which shipped survivors
// of exactly one class:
//
//     A TEST THAT COMPUTES THE VALUE ITSELF AND HANDS IT TO THE FUNCTION PROVES THE FUNCTION IS
//     DETERMINISTIC AND PROVES NOTHING ABOUT THE CALL SITE.
//
// So nothing below reaches into `t.incentives` to install a programme by hand and then checks that
// the maths works. Every category is exercised the way a player reaches it — `setIncentiveShares`
// (which is what the store action calls) followed by `advanceWeek` — and the assertion is made on
// what the WEEK produced. Where a pure function is asserted directly it is because a pure function
// is the thing under test (`allocationFrom`'s bounds, the migration), never as a stand-in for the
// path.

import { advanceWeek, newGame, sellTokenTreasury, setTokenIncentives, weeklyPayroll } from '../src/game/engine'
import { organicCustomers, totalCustomers } from '../src/game/career/pmf'
import { tokenisationBars } from '../src/game/token/eligibility'
import {
  INCENTIVE_CATEGORIES,
  employeeTokenComp,
  incentiveEffects,
  incentiveShares,
  incentivesActive,
  setIncentiveShares,
  tokenCompMoraleDelta,
  weeklyIncentiveSpend,
  type IncentiveShares,
} from '../src/game/token/incentives'
import { allocationBounds, allocationFrom, communityReaction, launchToken, resolveLaunchTerms, type LaunchDraft } from '../src/game/token/launch'
import { tokenInvariants, treasuryCommitment } from '../src/game/token/market'
import { tickToken } from '../src/game/token/tick'
import { migrateTokenSlice } from '../src/game/token/persistence'
import { lockedAtLaunch, pendingUnlock, utilityModelMultiplier, VESTING_TERMS } from '../src/game/token/state'
import { maxTreasurySale, treasurySaleQuote, treasurySalesActive } from '../src/game/token/treasury'
import { incentivisedUsers, organicUsers } from '../src/game/token/users'
import { TOKEN_BOUNDS, TOKEN_INCENTIVES, TOKEN_STATE_VERSION } from '../src/game/token/types'
import type { GameConfig } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}k`)

const cfg = (seed: number, sector: SectorId = 'saas', overrides?: Record<string, boolean>): GameConfig => ({
  mode: 'career',
  format: 'standard',
  sector,
  seed,
  ...(overrides ? { overrides } : {}),
})

/** A Career company that has taken the fork. Bars are set rather than played, so these tests assert
 *  the MECHANIC and not the balance of the twenty weeks in front of it. */
function tokenised(sector: SectorId = 'devtools', seed = 4242, draft: LaunchDraft = {}, overrides?: Record<string, boolean>): GameState {
  let s = newGame('Inc', sector, 'technical', { config: cfg(seed, sector, overrides) })
  s.cash = 30_000_000
  for (let w = 0; w < 20 && !s.gameOver; w++) s = advanceWeek(s)
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 60)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  const res = launchToken(s, draft)
  if (!res.ok) throw new Error(`setup failed: ${res.reason}`)
  return s
}

/** Hold a policy in place for `weeks`, exactly as a player leaving the sliders alone does. */
function play(s: GameState, weeks: number, shares: Partial<IncentiveShares>): GameState {
  let g = s
  setIncentiveShares(g, shares)
  for (let i = 0; i < weeks && !g.gameOver; i++) {
    g.marketingSpend = 12_000
    if (g.cash < 3_000_000) g.cash = 30_000_000
    g = advanceWeek(g)
    if (!g.gameOver) setIncentiveShares(g, shares)
  }
  return g
}

/** The same company under two policies. THE control design of this whole slice: both arms are the
 *  same seed, the same sector and the same launch, so any difference is the policy. */
function pair(shares: Partial<IncentiveShares>, weeks = 30, sector: SectorId = 'devtools', seed = 4242) {
  return { treatment: play(tokenised(sector, seed), weeks, shares), control: play(tokenised(sector, seed), weeks, {}) }
}

// =================================================================================================
console.log('— The capability gate, and the control surface that did not exist until this slice —')

const off = tokenised('devtools', 4242, {}, { tokenIncentives: false })
ok(!incentivesActive(off), 'with `tokenIncentives` off the six categories are not live')
setIncentiveShares(off, { customer_rewards: 1 })
ok(off.token!.incentives.length === 0, 'and no programme can be created — the gate is on the WRITE, not on a read')

const on = tokenised()
ok(incentivesActive(on), 'with the capability on, and a token slice, they are')
ok(on.token!.incentives.length === 0, 'a fresh launch commits nothing: the treasury is idle until the player points it somewhere')
setTokenIncentives(on, { customer_rewards: 0.5, developer_grants: 0.25 })
ok(on.token!.incentives.length === 2, 'the engine action creates exactly the programmes asked for')
ok(
  Math.abs(incentiveShares(on).customer_rewards - 0.5) < 1e-9 && Math.abs(incentiveShares(on).developer_grants - 0.25) < 1e-9,
  'and stores the shares it was given',
)
setTokenIncentives(on, { customer_rewards: 0 })
ok(
  on.token!.incentives.length === 1 && on.token!.incentives[0].category === 'developer_grants',
  'a category set to zero has its programme REMOVED, not left dormant at zero',
)

const greedy = tokenised()
setIncentiveShares(greedy, Object.fromEntries(INCENTIVE_CATEGORIES.map((c) => [c, 0.5])) as IncentiveShares)
const greedyTotal = INCENTIVE_CATEGORIES.reduce((a, c) => a + incentiveShares(greedy)[c], 0)
ok(Math.abs(greedyTotal - 1) < 0.01, `six categories asked for 50% each and were scaled to ${(greedyTotal * 100).toFixed(0)}% of one budget`)

// =================================================================================================
console.log('\n— The budget is the treasury cap, and a standing order tracks a draining treasury —')

const budget = tokenised()
setIncentiveShares(budget, { customer_rewards: 1 })
const capBefore = treasuryCommitment(budget)
budget.token!.supply.treasury = Math.round(budget.token!.supply.treasury / 2)
const capAfter = treasuryCommitment(budget)
ok(
  Math.abs(capAfter.requested - capBefore.requested / 2) < 1,
  'halving the treasury halves what the standing order requests — the share is re-derived against the CURRENT cap',
)
ok(
  capAfter.tokens <= budget.token!.supply.treasury * TOKEN_BOUNDS.treasurySpendCapPerWeek + 1e-6,
  'and the release never exceeds 2% of the treasury (loop A, restoring force 1)',
)

const split = tokenised()
setIncentiveShares(split, { customer_rewards: 0.25, liquidity_incentives: 0.75 })
const spend = weeklyIncentiveSpend(split)
ok(
  Math.abs(spend.byCategory.liquidity_incentives.tokens / spend.byCategory.customer_rewards.tokens - 3) < 0.01,
  'the capped release is divided PRO RATA: a 3:1 policy releases 3:1',
)
ok(
  Math.abs(spend.tokens - (spend.byCategory.customer_rewards.tokens + spend.byCategory.liquidity_incentives.tokens)) < 1e-6,
  'and the six parts sum to the whole — nothing is created in the split',
)

// =================================================================================================
console.log('\n— Each category, against a control that differs ONLY in where the tokens went —')

// Developer grants → UTILITY, the only lever that moves the fundamental anchor.
{
  const { treatment, control } = pair({ developer_grants: 1 })
  ok(
    treatment.token!.market.utility > control.token!.market.utility + 1,
    `developer grants raise utility (${treatment.token!.market.utility.toFixed(1)} vs ${control.token!.market.utility.toFixed(1)})`,
  )
  ok(
    treatment.token!.market.depth < control.token!.market.depth + 0.05,
    'and do NOT buy market depth — that is a different category',
  )
}

// Liquidity → DEPTH and SPECULATION. §17: useful and dangerous, in that order.
{
  const { treatment, control } = pair({ liquidity_incentives: 1 })
  ok(
    treatment.token!.market.depth > control.token!.market.depth + 0.02,
    `liquidity incentives deepen the market (${treatment.token!.market.depth.toFixed(2)} vs ${control.token!.market.depth.toFixed(2)})`,
  )
  ok(
    treatment.token!.market.speculation > control.token!.market.speculation + 1,
    `and raise speculation with it (${treatment.token!.market.speculation.toFixed(1)} vs ${control.token!.market.speculation.toFixed(1)}) — §17's danger is not decorative`,
  )
  ok(
    treatment.token!.market.utility <= control.token!.market.utility + 0.5,
    'and buy no utility at all: a deep market is not a used one',
  )
}

// Partnerships → HYPE → ORGANIC customers. The one category whose users are evidence.
{
  const { treatment, control } = pair({ partnerships: 1 })
  ok(treatment.hype > control.hype + 1, `partnerships buy distribution: hype ${treatment.hype.toFixed(1)} vs ${control.hype.toFixed(1)}`)
  ok(
    organicCustomers(treatment.career!) > organicCustomers(control.career!),
    `and the customers it brings are ORGANIC (${organicCustomers(treatment.career!)} vs ${organicCustomers(control.career!)}) — they count toward PMF`,
  )
  ok(
    incentivisedUsers(treatment) === 0,
    'and not one of them is rented — partnerships create no incentivised cohort',
  )
}

// Community treasury → DECENTRALISATION (monotone) and TRUST.
{
  const s = tokenised()
  const seen: number[] = []
  let g = s
  setIncentiveShares(g, { community_treasury: 1 })
  for (let i = 0; i < 30 && !g.gameOver; i++) {
    if (g.cash < 3_000_000) g.cash = 30_000_000
    g = advanceWeek(g)
    if (!g.gameOver) setIncentiveShares(g, { community_treasury: 1 })
    seen.push(g.token!.community.decentralisation)
  }
  const control = play(tokenised(), 30, {})
  ok(
    g.token!.community.decentralisation > control.token!.community.decentralisation + 5,
    `community treasury decentralises (${g.token!.community.decentralisation.toFixed(1)} vs ${control.token!.community.decentralisation.toFixed(1)})`,
  )
  ok(
    seen.every((v, i) => i === 0 || v >= seen[i - 1] - 1e-9),
    'and it is MONOTONE NON-DECREASING over every week of the run — §35, control given away is not taken back',
  )
  ok(
    g.token!.community.trust > control.token!.community.trust + 1,
    `which is what buys trust (${g.token!.community.trust.toFixed(1)} vs ${control.token!.community.trust.toFixed(1)})`,
  )
}

// Customer rewards → RENTED users. The Slice-3 mechanic, now reachable from a player action.
{
  const { treatment, control } = pair({ customer_rewards: 1 })
  ok(
    incentivisedUsers(treatment) > 0 && incentivisedUsers(control) === 0,
    `customer rewards rent users (${incentivisedUsers(treatment)} vs ${incentivisedUsers(control)}) — this is the whole of Slice 3, and until this slice no player could reach it`,
  )
  ok(
    organicUsers(treatment) + incentivisedUsers(treatment) === Math.max(0, Math.round(treatment.users)),
    'and the §4.6 user identity still holds through a played campaign',
  )
  ok(
    treatment.token!.community.decentralisation === control.token!.community.decentralisation,
    'and they decentralise nothing — that is a different category',
  )
}

// =================================================================================================
console.log('\n— The anchor cannot be bought: the denomination rule (loop B.3) —')

{
  // The SAME company, with the token price multiplied by 10 and nothing else changed. A
  // dollar-denominated grant would buy ten times the ecosystem; a token-denominated one buys the
  // same. `fairValue` reads utility, so this is the guarantee that the anchor is not inflatable.
  const cheap = tokenised()
  setIncentiveShares(cheap, { developer_grants: 1 })
  const dear = tokenised()
  setIncentiveShares(dear, { developer_grants: 1 })
  dear.token!.market.price *= 10
  dear.token!.market.emaPrice *= 10
  dear.token!.market.fairValue *= 10
  const a = weeklyIncentiveSpend(cheap).byCategory.developer_grants
  const b = weeklyIncentiveSpend(dear).byCategory.developer_grants
  ok(Math.abs(a.floatFraction - b.floatFraction) < 1e-12, 'a 10× token price buys exactly the same share of the float')
  ok(b.dollars > a.dollars * 9, 'even though it is ten times the money — the dollars are real, they are just not the intensity')
}

// =================================================================================================
console.log('\n— Everything is a stock: lagged, capped, reversible —')

{
  const fresh = tokenised()
  setIncentiveShares(fresh, { liquidity_incentives: 1 })
  ok(
    incentiveEffects(fresh).depth === 0 && incentiveEffects(fresh).speculation === 0,
    'a policy set this second buys NOTHING this week — every effect reads the lagged stock, never the week’s spend',
  )

  const s = tokenised()
  setIncentiveShares(s, { liquidity_incentives: 1 })
  const oneWeek = advanceWeek(s)
  const stock1 = oneWeek.token!.incentives[0].effectiveness
  const long = play(tokenised(), 30, { liquidity_incentives: 1 })
  const stockLong = long.token!.incentives[0].effectiveness
  ok(stock1 > 0 && stock1 < stockLong, `one week of spend builds ${(stock1 * 100).toFixed(0)}% of the stock a sustained programme reaches (${(stockLong * 100).toFixed(0)}%)`)
  ok(stockLong <= 1, 'and the stock is capped at 1 however long it runs')

  // Turn it off and the effect decays away rather than staying bought.
  let g = long
  const depthOn = g.token!.market.depth
  setIncentiveShares(g, {})
  for (let i = 0; i < 25 && !g.gameOver; i++) {
    if (g.cash < 3_000_000) g.cash = 30_000_000
    g = advanceWeek(g)
  }
  ok(g.token!.market.depth < depthOn - 0.01, `stopping the programme gives the depth back (${depthOn.toFixed(2)} → ${g.token!.market.depth.toFixed(2)}) — nothing ratchets`)
}

// =================================================================================================
console.log('\n— Employee token compensation (§16, loop D) —')

{
  const s = tokenised()
  for (let i = 0; i < 8; i++)
    s.employees.push({ id: `e${i}`, name: `E${i}`, role: 'engineer', skill: 60, salary: 150_000, morale: 70, weeks: 0, trait: null })
  const payroll = weeklyPayroll(s)
  setIncentiveShares(s, { employee_compensation: 1 })
  const comp = employeeTokenComp(s)
  ok(comp.dollars > 0, 'a funded programme pays part of the package in tokens')
  ok(
    comp.offset <= payroll * TOKEN_BOUNDS.tokenCompMaxShare + 1e-6,
    `and the offset is capped at ${(TOKEN_BOUNDS.tokenCompMaxShare * 100).toFixed(0)}% of payroll ($${Math.round(comp.offset)} of $${payroll})`,
  )
  ok(comp.wasted > 0 === comp.dollars > payroll * TOKEN_BOUNDS.tokenCompMaxShare, 'tokens past the cap are reported as wasted rather than silently banked')

  // Through the real call path: the week's expenses must actually be lower.
  const withComp = advanceWeek(s)
  const noComp = tokenised()
  for (let i = 0; i < 8; i++)
    noComp.employees.push({ id: `e${i}`, name: `E${i}`, role: 'engineer', skill: 60, salary: 150_000, morale: 70, weeks: 0, trait: null })
  const noCompAfter = advanceWeek(noComp)
  ok(
    withComp.lastExpenses < noCompAfter.lastExpenses,
    `the WEEK's expenses fall ($${Math.round(withComp.lastExpenses)} vs $${Math.round(noCompAfter.lastExpenses)}) — §16 substitutes for cash, it does not add a system`,
  )
  ok(withComp.cash > noCompAfter.cash, 'and the cash is really there at the end of the week')

  // Loop D: morale follows the token's MOMENTUM, and the clamp holds.
  const up = tokenised()
  for (let i = 0; i < 8; i++)
    up.employees.push({ id: `e${i}`, name: `E${i}`, role: 'engineer', skill: 60, salary: 150_000, morale: 70, weeks: 0, trait: null })
  setIncentiveShares(up, { employee_compensation: 1 })
  const down = structuredClone(up)
  up.token!.market.price = up.token!.market.emaPrice * 2
  down.token!.market.price = down.token!.market.emaPrice * 0.5
  ok(tokenCompMoraleDelta(up) > 0 && tokenCompMoraleDelta(down) < 0, 'a rising token lifts morale and a falling one drops it')
  ok(
    Math.abs(tokenCompMoraleDelta(up)) <= TOKEN_BOUNDS.tokenCompMoraleClamp + 1e-9 &&
      Math.abs(tokenCompMoraleDelta(down)) <= TOKEN_BOUNDS.tokenCompMoraleClamp + 1e-9,
    `and neither exceeds the ±${TOKEN_BOUNDS.tokenCompMoraleClamp}/wk clamp — token comp biases morale, it never dominates it`,
  )
  const noProgramme = tokenised()
  ok(tokenCompMoraleDelta(noProgramme) === 0, 'a company paying nobody in tokens feels nothing either way')
}

// =================================================================================================
console.log('\n— Vesting unlocks are supply pressure, and nothing else (§41) —')

{
  const s = tokenised('devtools', 4242, { vesting: 'short' })
  const t = s.token!
  ok(lockedAtLaunch(t) === t.supply.locked, 'at launch every team, founder and partner token is locked')
  ok(pendingUnlock(t, s.week + VESTING_TERMS.short.cliffWeeks - 1) === 0, 'nothing unlocks before the cliff')
  ok(pendingUnlock(t, s.week + VESTING_TERMS.short.cliffWeeks) > 0, 'and the cliff releases the schedule’s first tranche')
  ok(
    pendingUnlock(t, s.week + 999) === t.supply.locked,
    'and the schedule can never release more than is locked, however far past the end you look',
  )

  const shortRun = play(tokenised('devtools', 4242, { vesting: 'short' }), 40, {})
  const longRun = play(tokenised('devtools', 4242, { vesting: 'long' }), 40, {})
  ok(
    shortRun.token!.supply.locked < longRun.token!.supply.locked,
    `short vesting puts tokens into the float faster (${shortRun.token!.supply.locked} still locked vs ${longRun.token!.supply.locked})`,
  )
  ok(
    shortRun.token!.market.price < longRun.token!.market.price,
    `and pays for it in price (${shortRun.token!.market.price.toExponential(2)} vs ${longRun.token!.market.price.toExponential(2)}) — that is what makes §23 a decision`,
  )
  ok(tokenInvariants(shortRun).length === 0 && tokenInvariants(longRun).length === 0, 'and the supply identity survives every unlock')

  // The separation that matters: an unlock is pressure with NO demand behind it. Asserted through
  // the TICK, not by handing `priceStep` the two arguments myself — the whole question is what the
  // call site passes, and a pure-function test would prove only that the function can tell them
  // apart. (This is the exact hole that survived the first pass.)
  const cliffed = tokenised('devtools', 4242, { vesting: 'short' })
  cliffed.week += VESTING_TERMS.short.cliffWeeks + 2
  cliffed.token!.lastTickedWeek = undefined
  const report = tickToken(cliffed)
  ok(report.unlocked > 0, 'the tick releases the cliff’s tranche')
  ok(
    report.step.supplyPressure > 0 && report.step.ecosystemDemand === 0,
    'and the week carries supply pressure with ZERO ecosystem demand — nobody was paid to do anything with an unlocked token',
  )
  const spent = tokenised('devtools', 4242)
  setIncentiveShares(spent, { developer_grants: 1 })
  spent.token!.lastTickedWeek = undefined
  ok(tickToken(spent).step.ecosystemDemand > 0, 'whereas the same tokens released as treasury spend do buy demand')
}

// =================================================================================================
console.log('\n— The tokenomics screen (§20–§24) —')

{
  const s = tokenised()
  const b = allocationBounds(s)
  ok(b.founderMax - b.founderMin <= TOKEN_INCENTIVES.founderShareBand * 2 + 1e-9, 'the founder share moves inside a BAND, not a free field (§22)')
  for (const [f, c] of [[0, 0], [1, 1], [0.5, 0.9], [-3, 4]] as const) {
    const a = allocationFrom(s, f, c)
    const sum = a.community + a.treasury + a.team + a.founder + a.partners
    ok(Math.abs(sum - 1) <= TOKEN_BOUNDS.allocationEpsilon, `an allocation built from (${f}, ${c}) still sums to 1`)
    ok(a.treasury >= TOKEN_INCENTIVES.minTreasuryShare - 1e-9, 'and never leaves the treasury below its floor — a company that cannot run one programme')
  }
  ok(allocationFrom(s, 1, 0.2).founder <= b.founderMax + 1e-9, 'asking for everything gets you the top of the band and no more')

  // §22 through the real call path: launch twice, same company, different allocation.
  //
  // BOTH PLANS HOLD THE COMMUNITY SHARE AT ITS FLOOR, so the ONLY thing that differs is what the
  // founder took. The first version of this pair moved the community share as a side effect (a
  // bigger founder share compresses the community's ceiling) and the founder term could be deleted
  // entirely while this assertion stayed green — the trust move was coming from the community
  // term. That mutation is M23, and isolating the variable is what kills it.
  const floorC = allocationBounds(tokenised()).communityMin
  const modest = tokenised('devtools', 4242, { allocation: allocationFrom(tokenised(), 0, floorC) })
  const grabby = tokenised('devtools', 4242, { allocation: allocationFrom(tokenised(), 1, floorC) })
  ok(
    Math.abs(modest.token!.plan.allocation.community - grabby.token!.plan.allocation.community) < 1e-9,
    'the two launches differ in the founder share and in nothing else',
  )
  ok(
    grabby.token!.community.trust < modest.token!.community.trust - 1,
    `a bigger founder bag launches with less trust (${grabby.token!.community.trust.toFixed(1)} vs ${modest.token!.community.trust.toFixed(1)})`,
  )
  ok(
    grabby.token!.market.speculation > modest.token!.market.speculation + 1,
    `and more speculation — the sell-pressure story §22 names (${grabby.token!.market.speculation.toFixed(1)} vs ${modest.token!.market.speculation.toFixed(1)})`,
  )
  ok(grabby.reputation < modest.reputation, 'and it costs reputation in the outside world too')
  ok(
    grabby.token!.founder.granted > modest.token!.founder.granted,
    'while genuinely granting more tokens — the trade is real in both directions, not a tax',
  )

  // §23: vesting is priced into launch-day trust.
  const shortT = resolveLaunchTerms(s, { vesting: 'short' })
  const longT = resolveLaunchTerms(s, { vesting: 'long' })
  ok(longT.reaction.trust > shortT.reaction.trust, 'long vesting buys credibility at launch and short vesting spends it (§23)')

  // §24: the utility model is a permanent multiplier on EARNED utility, not a launch-day cosmetic.
  ok(utilityModelMultiplier('devtools', 'ecosystem_incentive') === TOKEN_INCENTIVES.utilityFitMax, "a sector's natural model is the unit multiplier")
  ok(utilityModelMultiplier('devtools', 'rewards') < utilityModelMultiplier('devtools', 'ecosystem_incentive'), 'and a mismatched one is worth less')
  const fitRun = play(tokenised('devtools', 4242, { utilityModel: 'ecosystem_incentive' }), 30, {})
  const misfitRun = play(tokenised('devtools', 4242, { utilityModel: 'rewards' }), 30, {})
  ok(
    fitRun.token!.market.utility > misfitRun.token!.market.utility + 1,
    `and thirty weeks later the difference is still there (${fitRun.token!.market.utility.toFixed(1)} vs ${misfitRun.token!.market.utility.toFixed(1)}) — utility reverts at 6%/wk, so a launch-day-only difference would be gone`,
  )

  // The default plan must reproduce Slice 1 exactly, or every earlier measurement moved.
  const dflt = resolveLaunchTerms(s)
  const reaction = communityReaction(s, dflt.plan, dflt.communityStrength)
  ok(
    Math.abs(reaction.founderExcess) < 1e-9 && Math.abs(reaction.reputationDelta) < 1e-9 && Math.abs(reaction.speculationDelta) < 1e-9,
    'and a player who takes the default plan gets exactly the launch Slice 1 gave them — no drift',
  )
}

// =================================================================================================
console.log('\n— Treasury sales: the round a tokenised company can still raise (§6, §30) —')

{
  const gated = tokenised('devtools', 4242, {}, { tokenIncentives: false })
  ok(!treasurySalesActive(gated) && maxTreasurySale(gated) === 0, 'the capital mechanic is behind the same capability as the rest of the slice')

  const s = tokenised()
  const t = s.token!
  const max = maxTreasurySale(s)
  ok(max > 0 && max <= t.supply.treasury, 'a treasury with tokens can raise')
  ok(
    max <= t.supply.circulating * 0.08 + 1,
    `and no single sale exceeds what the float absorbs (${max.toLocaleString()} against a ${t.supply.circulating.toLocaleString()} float) — bounded by depth, not by ambition`,
  )

  const quote = treasurySaleQuote(s, max)
  ok(quote.proceeds < quote.grossDollars, `you do not sell at the screen price (${money(quote.proceeds)} of ${money(quote.grossDollars)})`)
  ok(quote.priceImpact > 0 && quote.priceAfter < t.market.price, 'and the price you sold into is lower afterwards')

  // Depth is what makes size cheap — the second thing liquidity incentives buy.
  const thin = tokenised()
  const deep = tokenised()
  thin.token!.market.depth = 0.15
  deep.token!.market.depth = 0.9
  const size = Math.min(maxTreasurySale(thin), maxTreasurySale(deep))
  ok(
    treasurySaleQuote(deep, size).proceeds > treasurySaleQuote(thin, size).proceeds,
    'the same sale into a deeper market raises more — depth is the price of size',
  )

  // Through the real call path.
  const seller = tokenised()
  const cashBefore = seller.cash
  const trustBefore = seller.token!.community.trust
  const equityBefore = seller.founderEquity
  const budgetBefore = treasuryCommitment(seller).cap
  const rngBefore = seller.flags?.rngTick
  const sold = maxTreasurySale(seller)
  const done = sellTokenTreasury(seller, sold)
  ok(done.ok, 'the engine action completes')
  ok(Math.abs(seller.cash - cashBefore - done.quote!.proceeds) < 1e-6, 'the cash is the quoted proceeds to the cent — the preview cannot lie')
  ok(seller.token!.supply.treasury === t.supply.treasury - sold && tokenInvariants(seller).length === 0, 'the tokens left the treasury and the supply identity holds')
  ok(seller.token!.community.trust < trustBefore - 1, `and it costs trust (${trustBefore.toFixed(1)} → ${seller.token!.community.trust.toFixed(1)})`)
  // Cost 5. Costs 1–4 were measured by test/token-balance-probe.ts and found nearly free to the
  // FOUNDER specifically: slippage and the price drop are borne by every holder, and trust reaches
  // `engagement` at 0.35, which reaches `liquidityDiscount` at 0.2 — a maximum sale moved market
  // quality by about one point. A raise has to be priced in ownership, whoever is on the other side.
  ok(done.quote!.equityDilution > 0, 'the raise is priced: community capital dilutes like any other capital')
  ok(
    Math.abs(seller.founderEquity - equityBefore * (1 - done.quote!.equityDilution)) < 1e-9,
    `and at the quoted rate exactly (${(equityBefore * 100).toFixed(1)}% → ${(seller.founderEquity * 100).toFixed(1)}%)`,
  )
  ok(treasuryCommitment(seller).cap < budgetBefore, 'and every incentive programme is permanently smaller — the treasury is one budget, not two')
  ok(seller.flags?.rngTick === rngBefore, 'and the sale draws nothing: opening the panel cannot shift the RNG stream')

  // The exploit test: is slicing a sale free? It must not be.
  const oneShot = tokenised()
  const bigSize = maxTreasurySale(oneShot)
  const big = sellTokenTreasury(oneShot, bigSize)
  const sliced = tokenised()
  let slicedProceeds = 0
  for (let i = 0; i < 4; i++) {
    const r = sellTokenTreasury(sliced, Math.floor(bigSize / 4))
    if (r.ok) slicedProceeds += r.quote!.proceeds
  }
  ok(
    slicedProceeds <= big.quote!.proceeds + 1,
    `four slices raise no more than one block (${money(slicedProceeds)} vs ${money(big.quote!.proceeds)}) — salami-slicing the book is not an edge`,
  )
  ok(
    sliced.token!.community.trust < oneShot.token!.community.trust,
    `and costs more trust doing it (${sliced.token!.community.trust.toFixed(1)} vs ${oneShot.token!.community.trust.toFixed(1)}) — selling again soon is what the community actually reacts to`,
  )
}

// =================================================================================================
console.log('\n— The §53 warning still discriminates —')

{
  // WHAT THIS BLOCK MEASURES, AND WHY IT WAS RESAMPLED RATHER THAN RETUNED.
  //
  // The property is DISCRIMINATION, not firing: zero on any policy that rents nobody, and clearly
  // more often on rented growth than on a token programme. The rates it discriminates between
  // moved when `tickCareerPMF`'s reconciliation drain was corrected to remove customers in
  // proportion to cohort size (docs/cohort-retention-noise.md, Option A), and the reason is worth
  // stating because it looks like a regression and is not:
  //
  //   The old drain charged every company-wide loss to the NEWEST cohort — the one about to freeze
  //   its permanent four-week snapshot — so measured organic retention carried a downward bias.
  //   Across 240 tokenised runs of 60 weeks the median read 59.3% before the fix and 62.4% after.
  //   §53's third condition is `organic < 62%`. A bar the population sat BELOW is a bar that is
  //   almost always satisfied, so the shipped predicate was effectively a two-condition test.
  //
  // Measured on the probe sweep (test/token-incentives-probe.ts §3, 5 sectors × 6 seeds × 60 weeks,
  // share of runs warning at least once):
  //
  //   policy            before fix   after fix   after fix, condition 3 deleted
  //   nothing               0/30        0/30                0/30
  //   no rewards at all     0/30        0/30                0/30
  //   rewards 10%            27%         10%                 30%
  //   balanced sixths        33%         13%                 37%
  //   rewards 25%            67%         23%                 67%
  //   growth mix             67%         30%                 73%
  //   rewards 50%            77%         37%                 77%
  //   rewards 100%           80%         40%                 80%
  //
  // The third column is the second: with honest retention, DELETING the weak-retention condition
  // reproduces the pre-fix numbers. That is the proof that the condition was carrying no weight
  // before — the bug was doing its job for it. It carries weight now, and the weight it carries is
  // exactly its purpose: withholding the warning from a company whose base is not actually leaking.
  //
  // So the bar was left where it is. 62% is not arbitrary — `pmfBlocker` uses the same line for the
  // same reason ("below roughly 62% a cohort drains faster than marketing can refill it"), and
  // measured against `npm run bots`, corrected four-week retention is 75-76% for the disciplined
  // strategies and 55-60% for the careless one, so the line separates play rather than sectors.
  // Moving it to 72% absolute, or to 80% of the segment's own achievable ceiling, was measured: both
  // reproduce the third column EXACTLY, because both are above the whole distribution. That is not a
  // recalibration, it is deleting the condition and leaving the corpse in the predicate.
  //
  // WHAT WAS ACTUALLY WRONG WAS THIS TEST. It sampled ONE sector and THREE seeds for an event with a
  // ~35% per-run rate, and saas is the sector that fires least (0/4 even at maximum spend). It
  // passed on a draw. It now runs 20 runs an arm across five sectors, and — the Slice-1/3 lesson —
  // it counts what the WEEK SAID, not what the predicate returns, so a tick that stops calling
  // `mercenaryGrowthWarning` fails it.
  const SECTORS: SectorId[] = ['saas', 'devtools', 'social', 'fintech', 'ecommerce']
  const SEEDS = [7, 42, 101, 4242]

  /** Did the WEEK say it? Reading `lastExplanations[0]` proves the tick called the predicate AND
   *  put it first, which is the §53 requirement. Calling the predicate here would prove neither. */
  const saidIt = (g: GameState) => !!g.career?.lastExplanations[0]?.primaryCause.includes('incentive-driven')

  const arm = (shares: Partial<IncentiveShares>) => {
    let runs = 0
    let firedRuns = 0
    let weeks = 0
    let inboxed = 0
    for (const sector of SECTORS) {
      for (const seed of SEEDS) {
        let g = tokenised(sector, seed)
        setIncentiveShares(g, shares)
        let said = 0
        for (let i = 0; i < 40 && !g.gameOver; i++) {
          g.marketingSpend = 12_000
          if (g.cash < 3_000_000) g.cash = 30_000_000
          g = advanceWeek(g)
          if (!g.gameOver) setIncentiveShares(g, shares)
          if (saidIt(g)) said++
        }
        runs++
        if (said > 0) firedRuns++
        weeks += said
        if (g.inbox.some((m) => m.title === 'Token-driven growth')) inboxed++
      }
    }
    return { runs, firedRuns, weeks, inboxed }
  }

  const heavy = arm({ customer_rewards: 1 })
  const light = arm({ customer_rewards: 0.1 })
  const none = arm({})
  const other = arm({ developer_grants: 0.5, partnerships: 0.5 })

  // Structural, not statistical: with no customer-rewards programme no cohort is ever marked
  // incentivised, so the rented share of the target segment is 0 and condition 2 cannot hold.
  ok(
    none.firedRuns === 0 && none.weeks === 0,
    `it never fires on a company that rents nobody (0/${none.runs} runs, 0 weeks)`,
  )
  ok(
    other.firedRuns === 0 && other.weeks === 0,
    `nor on one that spends the whole treasury on grants and partnerships (0/${other.runs} runs) — it is about rented USERS, not about spending`,
  )
  // measured: 7/20 against 2/20, and 164 warned weeks against 40. The bar is the ordering plus real
  // headroom on both, so this fails on a regression rather than on a reshuffled seed.
  //
  // `Math.max` rather than a bare ratio, and it is not decoration: `0 >= 0 * 2` is true, so a
  // predicate that returned null unconditionally passed the ratio form. The first mutation run
  // found exactly that, and it is the same class of hole as a test that computes the value itself.
  ok(
    heavy.firedRuns >= Math.max(2, light.firedRuns * 2) && heavy.weeks >= Math.max(1, light.weeks * 2),
    `it fires more often on maximum spend than on a 10% programme (${heavy.firedRuns}/${heavy.runs} runs and ${heavy.weeks} weeks ` +
      `vs ${light.firedRuns}/${light.runs} and ${light.weeks})`,
  )
  // A SECOND de-biasing landed on the same number, and the same decision was taken for the same
  // reason. `retentionAt4wk` was freezing after FIVE weekly decays and calling it four-week
  // retention (docs/pmf-why-it-is-stuck.md §7); correcting it to four raised every retention
  // reading in the game by ~4.3pp. On this exact arm, measured before and after:
  //
  //   rewards 100%   7/20 runs, 164 warned weeks   →   3/20 runs, 94 warned weeks
  //   rewards 10%    2/20 runs,  40 warned weeks   →   1/20 runs, 36 warned weeks
  //
  // and across the arm's 800 week-samples the blocking condition is retention in 531 of them:
  // organic retention on the target segment is now p10 61.1% / median 68.6% / p90 74.3%, so only
  // 16.9% of week-samples sit under the bar at all.
  //
  // The bar was left where it is, AGAIN, and this is the load-bearing part: 62% is the same line
  // as `pmfBlocker`'s and as `derivePmfForSegment`'s `emerging` gate. Raising it by 4.3pp to hold
  // this test's numbers constant would cancel exactly the correction that was just made — the
  // whole point of fixing the metric is that companies which read 58% were really at 62%, and a
  // company that is not leaking must not be told it is. The warning firing on fewer runs IS the
  // corrected behaviour.
  //
  // So the floor moves with the measurement, and the weeks count carries the real weight: 94 is a
  // far tighter bound than 3, and it is the number that collapses if the predicate stops working.
  ok(
    heavy.firedRuns >= 3 && heavy.inboxed >= 3 && heavy.weeks >= 60,
    `and it still fires on the policy it exists to catch (${heavy.firedRuns}/${heavy.runs} runs, ${heavy.weeks} warned weeks; ${heavy.inboxed} reached the inbox)`,
  )
}

// =================================================================================================
console.log('\n— Migration (§74, and the v1 → v2 shape change) —')

{
  const s = play(tokenised(), 5, { customer_rewards: 0.4, partnerships: 0.2 })
  const round = migrateTokenSlice(JSON.parse(JSON.stringify(s.token)))
  ok(round !== undefined && round.version === TOKEN_STATE_VERSION, 'a live slice survives a JSON round trip and is back-filled to v2')
  ok(round!.incentives.length === 2 && Math.abs(round!.incentives[0].share - 0.4) < 1e-9, 'with the shares intact')

  // A v1 save: programmes with `tokensPerWeek` and no `share` at all.
  const v1 = JSON.parse(JSON.stringify(s.token)) as Record<string, unknown>
  const cap = s.token!.supply.treasury * TOKEN_BOUNDS.treasurySpendCapPerWeek
  v1.incentives = [{ category: 'customer_rewards', tokensPerWeek: cap / 2, startedWeek: 1, cumulativeTokens: 0, effectiveness: 0.5 }]
  const migrated = migrateTokenSlice(v1)
  ok(
    migrated !== undefined && Math.abs(migrated.incentives[0].share - 0.5) < 0.02,
    'a v1 programme with no share keeps spending what it was spending — the share is re-derived from the standing order',
  )

  const hostile = JSON.parse(JSON.stringify(s.token)) as Record<string, unknown>
  hostile.incentives = [
    { category: 'customer_rewards', share: 0.8, tokensPerWeek: 0, startedWeek: 1, cumulativeTokens: 0, effectiveness: 9 },
    { category: 'partnerships', share: 0.8, tokensPerWeek: 0, startedWeek: 1, cumulativeTokens: 0, effectiveness: 9 },
    { category: 'customer_rewards', share: 4, tokensPerWeek: 0, startedWeek: 1, cumulativeTokens: 0, effectiveness: 9 },
    { category: 'not_a_category', share: 1, tokensPerWeek: 0, startedWeek: 1, cumulativeTokens: 0, effectiveness: 1 },
  ]
  const fixed = migrateTokenSlice(hostile)!
  ok(fixed.incentives.length === 2, 'a hand-edited save cannot smuggle in a duplicate or an unknown category')
  ok(
    Math.abs(fixed.incentives.reduce((a, p) => a + p.share, 0) - 1) < 1e-9,
    'and two programmes claiming 80% each of one weekly budget are renormalised to exactly one budget',
  )
  ok(fixed.incentives.every((p) => p.effectiveness <= 1), 'nor can a stock be edited above 1')
}

// =================================================================================================
console.log('\n— Determinism and the untouched game —')

{
  // A Career run that never tokenises must be identical with `tokenIncentives` on or off, because
  // every Slice-4 read returns 0 without a token slice — including the two that live OUTSIDE the
  // `tokenActive` gate, in the payroll and morale blocks.
  const trace = (overrides?: Record<string, boolean>) => {
    let g = newGame('Trace', 'saas', 'technical', { config: cfg(31337, 'saas', overrides) })
    for (let i = 0; i < 40 && !g.gameOver; i++) {
      g.marketingSpend = 9_000
      g = advanceWeek(g)
    }
    return [g.week, Math.round(g.cash), Math.round(g.users), Math.round(g.lastExpenses), g.employees.length, Math.round(g.hype * 1e6)].join('|')
  }
  ok(trace() === trace({ tokenIncentives: false }), 'a run that never tokenised is byte-identical with the capability on or off')

  const a = tokenised()
  const b = structuredClone(a)
  setIncentiveShares(a, { developer_grants: 0.5 })
  setIncentiveShares(b, { developer_grants: 0.5 })
  const ra = advanceWeek(a)
  const rb = advanceWeek(b)
  ok(
    ra.token!.market.price === rb.token!.market.price && ra.flags?.rngTick === rb.flags?.rngTick,
    'and two identical tokenised states step identically — the standing order draws nothing',
  )

  const jitter = tokenised()
  const quiet = structuredClone(jitter)
  for (let i = 0; i < 12; i++) setIncentiveShares(jitter, { developer_grants: i % 2 === 0 ? 0.5 : 0.6 })
  setIncentiveShares(jitter, { developer_grants: 0.5 })
  setIncentiveShares(quiet, { developer_grants: 0.5 })
  ok(
    advanceWeek(jitter).token!.market.price === advanceWeek(quiet).token!.market.price,
    'dragging the slider twelve times does not shift the RNG stream — a UI gesture must never be a draw',
  )
}

// =================================================================================================
console.log('\n— The §4.6 invariants survive a full campaign —')

{
  let breaks = 0
  for (const sector of ['saas', 'social', 'devtools'] as SectorId[]) {
    const g = play(tokenised(sector, 101), 40, Object.fromEntries(INCENTIVE_CATEGORIES.map((c) => [c, 1 / 6])) as IncentiveShares)
    breaks += tokenInvariants(g).length
    if (g.career) {
      const total = totalCustomers(g.career)
      breaks += organicCustomers(g.career) + (total - organicCustomers(g.career)) === total ? 0 : 1
    }
  }
  ok(breaks === 0, 'three sectors, forty weeks, all six categories running: zero invariant violations')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// =================================================================================================
// MUTATIONS RUN AGAINST THIS FILE. Each was applied on its own, the four token suites re-run, and
// reverted. 42 applied, 42 killed. A mutation that stays green is a test that does not exist.
//
//   M1  setIncentiveShares ignores the capability gate                KILLED
//   M2  shares are never scaled down past 100% of one budget          KILLED
//   M3  a zero share leaves a dormant programme                       KILLED
//   M4  programmeRequest uses the stale tokensPerWeek                 KILLED  ← the desync this slice
//                                                                              had to avoid
//   M5  the capped release is split equally, not pro rata             KILLED
//   M6  spend intensity is denominated in DOLLARS                     KILLED  ← the anchor becomes
//                                                                              buyable (loop B.3)
//   M7  effects read this week's spend, not the lagged stock          KILLED*
//   M8  the stock never decays (every category becomes a ratchet)     KILLED
//   M9  developer grants buy no utility                              KILLED
//   M10 developer grants buy DEPTH too (category collision)           KILLED
//   M11 liquidity incentives carry no speculation risk                KILLED
//   M12 partnerships buy no distribution                              KILLED
//   M13 decentralisation is allowed to fall back (§35 broken)         KILLED
//   M14 the community treasury buys no trust                          KILLED
//   M15 the employee-comp offset is uncapped                          KILLED
//   M16 employee comp does not reduce payroll                         KILLED
//   M17 the token-comp morale move is unclamped                       KILLED
//   M18 token-comp morale reads the price LEVEL, not momentum         KILLED
//   M19 vesting unlocks never happen                                  KILLED
//   M20 the vesting cliff is ignored                                  KILLED
//   M21 an unlock is folded into the treasury float (gains demand)    KILLED*
//   M22 an unlock adds supply without removing it from locked         KILLED
//   M23 the founder share does not move launch trust                  KILLED*
//   M24 the founder share does not move speculation                   KILLED
//   M25 the vesting policy does not move launch trust                 KILLED
//   M26 the utility model is launch-day cosmetic again                KILLED
//   M27 allocationFrom ignores the band                               KILLED
//   M28 allocationFrom lets the treasury go to zero                   KILLED
//   M29 migration drops a v1 programme's standing order               KILLED
//   M30 migration does not renormalise hostile shares                 KILLED*
//   M31 migration accepts duplicate categories                        KILLED
//   M35 the treasury weekly cap is removed                            KILLED (token-economy.test.ts)
//   M36 customer rewards no longer reach users                        KILLED
//   M37 every category reaches users (rewards is not special)         KILLED
//   M38 a treasury sale realises the screen price (no slippage)       KILLED
//   M39 a treasury sale does not move the price                       KILLED
//   M40 a treasury sale costs no trust                                KILLED
//   M41 selling again soon is free (recency ignored)                  KILLED
//   M42 the sale is not bounded by the float or by depth              KILLED
//   M43 sold tokens are not removed from the treasury                 KILLED
//   M44 depth does not affect what a sale realises                    KILLED
//   M45 the sale banks founder money instead of company cash          KILLED
//   M46 a treasury sale does not dilute the founder                   KILLED
//
// * FOUR OF THESE SURVIVED THE FIRST PASS, and every one of them was the same hole the last three
//   slices shipped — a test that proved a function works rather than that the CALL SITE calls it:
//
//   M7  the stock's lag was asserted after thirty weeks, by which point a stock at equilibrium and
//       this week's intensity are the same number. Now asserted at the moment the policy is set,
//       where they are 0 and 1.
//   M21 unlock pressure was asserted by handing `priceStep` a `floatFraction` and an
//       `unlockFraction` myself — which proves the function can tell them apart and nothing about
//       what the tick passes it. Now asserted on `tickToken`'s own report.
//   M23 "a bigger founder bag launches with less trust" compared two plans that ALSO differed in
//       their community share (a bigger founder share compresses the community's ceiling), so the
//       founder term could be deleted entirely and the community term kept the assertion green.
//       Both plans now hold the community share at its floor.
//   M30 the hostile-save test used two copies of ONE category, which de-duplication removed before
//       renormalisation was ever reached. Now two different categories at 80% each.
