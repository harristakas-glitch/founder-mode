// Rival aggression — BACKLOG §4.1's fix, pinned. Run: npx tsx test/rival-aggression.test.ts
//
// The contract under test, in order of importance:
//
//   GATED       — with the capability off, `tickRivals` draws EXACTLY as many times as it always
//                 did. This is the load-bearing one: it is what makes the recorded golden traces
//                 in modes.test.ts still a valid pre-change baseline, and what lets
//                 test/rival-pressure-probe.ts play both sides of the A/B out of one build.
//   ANNOUNCED   — no rival ever strikes without a week of public notice first, and the posture is
//                 on the rival table for that whole week. An attack you could not have seen coming
//                 is noise; this is the assertion that says it never happens.
//   ANSWERABLE  — wherever a rival can attack you, the shield and the counter-punch are available.
//   SITUATIONAL — the posture is a reading of market position, growth and the funding gap, NOT a
//                 timer. Change the state and the posture changes with it; hold the state and the
//                 cooldown alone never produces an attack.
//   PAID FOR    — a rival that attacks spends momentum and product on it, so aggression trades
//                 against growth rather than being free.
//   SCALED      — force and frequency both ramp on share of TAM, which is the variable that
//                 separates "Late Entrant" from "Standard" (see the table above
//                 `rivalMarketShare`). Not on the size ratio, which is saturated at 92–100%.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose in
// src/game/engine.ts and this file re-run to confirm it goes red. The ledger is at the bottom.

import {
  acceptTermSheet,
  marketingMax,
  pitchInvestors,
  resolveChoiceOnState,
  runwayWeeks,
  RIVAL_AGGRO_COOLDOWN,
  RIVAL_AGGRO_COOLDOWN_MIN,
  RIVAL_AGGRO_MIN_USERS,
  RIVAL_AGGRO_MIN_WEEK,
  RIVAL_AGGRO_NOTICE,
  RIVAL_ATTACK_MOMENTUM_COST,
  RIVAL_RAID_LEVERAGE_MAX,
  RIVAL_RAID_LEVERAGE_MIN,
  RIVAL_RAID_SHARE_CAP,
  RIVAL_RAID_SHARE_FLOOR,
  RIVAL_SMEAR_AHEAD,
  advanceWeek,
  applyAttackIncoming,
  attackRival,
  buyShield,
  canAttack,
  canBuyShield,
  effectiveTam,
  hostileRivals,
  newGame,
  raidMagnitude,
  rivalAggroCooldown,
  rivalMarketShare,
  rivalRaidLeverage,
  rivalStance,
} from '../src/game/engine'

import { defaultCapabilities } from '../src/game/modes'
import type { GameConfig } from '../src/game/modes'
import type { GameState, Rival } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ mode: 'quick', format: 'standard', sector: 'saas', seed: 42, ...over })

/** A run parked in a state where rivals are eligible to act, built by hand so no assertion below
 *  depends on a bot happening to reach the right week with the right numbers. */
function staged(over: { aggression?: boolean; users?: number; week?: number } = {}): GameState {
  const s = newGame('Staged', 'saas', 'technical', {
    config: cfg({ overrides: { rivalAggression: over.aggression ?? true } }),
    aiRivals: true,
  })
  s.week = over.week ?? 40
  s.users = over.users ?? 4_000
  s.cash = 5_000_000
  // A growth history the rival can read: 4%/wk, comfortably over RIVAL_RAID_GROWTH.
  s.history = Array.from({ length: 6 }, (_, i) => ({
    week: s.week - 5 + i,
    cash: 5_000_000,
    users: Math.round(s.users / Math.pow(1.04, 5 - i)),
    revenue: 20_000,
    expenses: 10_000,
    payroll: 8_000,
    marketing: 1_000,
    office: 500,
    infra: 500,
    interest: 0,
    macroIndex: 100,
    valuation: 5_000_000,
    pmf: 60,
  }))
  return s
}

/** Put one rival at an exact share of the market and leave the others harmless. */
function setShares(s: GameState, shares: number[]): void {
  const tam = effectiveTam(s)
  s.rivals.forEach((r, i) => {
    r.users = Math.round(tam * (shares[i] ?? 0.0001))
    r.alive = true
    r.product = 10 // far behind, so `ahead` is positive and the smear/pricewar tests can steer it
    delete r.aggroCooldown
    delete r.hostileSince
  })
}

// ---------------------------------------------------------------------------------------------
console.log('— GATED: off is byte-identical to the world before this existed —')

// Divergence, not draw counts: `advanceWeek` reseeds through `withSeed`, so the global RNG hook
// cannot be instrumented from out here. A trace hash catches the same thing and more — any extra
// draw reorders the stream and every downstream number moves with it.
function trace(aggression: boolean, weeks: number, seed = 4242): string {
  let g = newGame('Trace', 'saas', 'technical', { config: cfg({ seed, overrides: { rivalAggression: aggression } }), aiRivals: true })
  const out: string[] = []
  for (let w = 0; w < weeks && !g.gameOver; w++) {
    // A company that is actually PLAYED. A passive advanceWeek loop never reaches the 120-user
    // visibility floor, so both columns would be trivially identical at any horizon and the
    // divergence assertion below would pass by measuring nothing.
    for (const m of g.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(g, m.id, 0)
    if (g.raiseCooldown === 0 && runwayWeeks(g) < 20) pitchInvestors(g)
    if (g.termSheets.length) acceptTermSheet(g, [...g.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
    g.allocation = { features: 36, quality: 27, bugs: 17, research: 20, bet: 0 }
    g.marketingSpend = Math.max(0, Math.min(g.cash * 0.02, marketingMax(g), g.cash))
    g = advanceWeek(g)
    out.push(`${g.week}|${g.users}|${Math.round(g.cash)}|${g.pmf.toFixed(4)}|${g.hype.toFixed(4)}|${g.rivals.map((r) => r.users).join(',')}`)
  }
  return out.join(';')
}

ok(trace(false, 12) === trace(false, 12), 'the passive path is deterministic')
// THE assertion this file exists for. `modes.test.ts` holds recorded 12-week hashes as the
// pre-change baseline, and every "off" column in the A/B tables is that same world. Both survive
// only while a run with the capability off is byte-identical — and while the capability, when ON,
// still cannot act inside the trace window (nothing may move before week 12).
ok(
  trace(true, 12) === trace(false, 12),
  `12 weeks are identical with the capability on or off — nothing may act before week ${RIVAL_AGGRO_MIN_WEEK}, which is why the recorded golden traces did not move`,
)
ok(
  trace(true, 120) !== trace(false, 120),
  'over 120 weeks they diverge — the capability is doing something, so the assertion above is a property and not a tautology',
)
ok(trace(true, 120) === trace(true, 120), 'and the aggressive path is deterministic too — every rival decision goes through the run seed')

// The stance is gated too, not only the action. Without this a run with the capability off would
// still paint Hostile badges on the rival table for attacks that can never come — mutation testing
// found it: removing the capability check inside `rivalStance` broke nothing measurable.
{
  const off = staged({ aggression: false })
  setShares(off, [0.09, 0.09, 0.09])
  ok(off.rivals.every((r) => rivalStance(off, r).attack === null && rivalStance(off, r).id === 'calm'), 'with the capability off every rival reads as calm')
  ok(hostileRivals(off).length === 0, 'and the rival table has nobody to flag — no threat is advertised that cannot arrive')
  const on = staged({ aggression: true })
  setShares(on, [0.09, 0.09, 0.09])
  ok(hostileRivals(on).length === 3, 'with it on, the same three rivals are all flagged — so the assertion above is a gate, not an empty market')
}

// ---------------------------------------------------------------------------------------------
console.log('— ANNOUNCED: nobody swings without a week of notice —')

// The roll cannot be forced from out here — `advanceWeek` reseeds through `withSeed`, so an
// override of RNG.next is discarded before `tickRivals` ever draws. So this is proved the honest
// way instead: over 40 different seeds, EVERY first hostile week announces and NONE of them
// strikes. If the notice were skippable, 40 draws against a 22% trigger would find it.
{
  let announcedCount = 0
  let struckOnNoticeWeek = 0
  let shownHostile = 0
  for (let i = 1; i <= 40; i++) {
    const s = newGame('Staged', 'saas', 'technical', {
      config: cfg({ seed: 11 * i, overrides: { rivalAggression: true } }),
      aiRivals: true,
    })
    const base = staged()
    s.week = base.week
    s.users = base.users
    s.cash = base.cash
    s.history = base.history
    setShares(s, [0.09, 0.0001, 0.0001])
    const target = s.rivals[0]
    if (rivalStance(s, target).attack !== 'raid') continue
    const a = advanceWeek(s)
    const after = a.rivals.find((r) => r.name === target.name)!
    if (after.hostileSince === a.week) announcedCount++
    if (a.inbox.some((m) => typeof m.meta?.rivalAttack === 'string')) struckOnNoticeWeek++
    if (hostileRivals(a).some((r) => r.name === target.name)) shownHostile++
  }
  ok(announcedCount === 40, `every one of 40 seeds announced on the first hostile week (${announcedCount}/40)`)
  ok(struckOnNoticeWeek === 0, `and NOT ONE of them struck in the same week (${struckOnNoticeWeek}/40) — the notice is unskippable`)
  ok(shownHostile === 40, 'the rival table shows them hostile through the notice week — the week the retainer exists to be bought in')
  ok(RIVAL_AGGRO_NOTICE >= 1, 'the notice period is at least a full week')

  const s = staged()
  setShares(s, [0.09, 0.0001, 0.0001])
  const a = advanceWeek(s)
  ok(
    a.inbox.some((m) => m.title.includes('has you in their sights') && m.meta?.rivalName === s.rivals[0].name),
    'and the announcement names them in the inbox',
  )
  ok((a.rivals[0].attacksLaunched ?? 0) === 0, 'with nothing charged to their record yet')
}

// ---------------------------------------------------------------------------------------------
console.log('— ANSWERABLE: the shield and the counter-punch exist wherever rivals attack —')

{
  const quick = defaultCapabilities('quick')
  ok(quick.rivalAggression && !quick.pvpActions, 'Quick Play has aggressive rivals and no player-vs-player')
  const s = staged()
  ok(canBuyShield(s).ok, 'and the crisis retainer is still available in it')
  ok(canAttack(s).ok, 'as is the counter-punch')

  // The shield eats an AI rival's attack exactly as it eats a human's.
  const shielded = staged()
  shielded.users = 4_000
  buyShield(shielded)
  applyAttackIncoming(shielded, 'raid', 'Quantly', { magnitudeScale: 2 })
  ok(shielded.users === 4_000, 'a shielded raid from a rival takes nothing')
  ok(
    shielded.inbox.some((m) => m.meta?.deflected === true && m.meta?.rivalAttack === 'raid'),
    'and the deflection is recorded as such, so pressure and counterplay can be counted apart',
  )

  // The counter-punch is a TRANSFER, not minting: what we gain, they lose.
  const c = staged()
  setShares(c, [0.09, 0.0001, 0.0001])
  const before = { mine: c.users, theirs: c.rivals[0].users }
  ok(attackRival(c, 'raid', c.rivals[0].id), 'a raid on a rival goes through')
  const gained = c.users - before.mine
  ok(gained > 0, `and it wins users (${gained})`)
  ok(before.theirs - c.rivals[0].users === gained, 'every user we won left THEIR side of the board — a raid moves customers, it does not create them')
  ok(!attackRival(c, 'raid', c.rivals[1].id), 'and the ops cooldown applies to the counter-punch like any other attack')
}

// ---------------------------------------------------------------------------------------------
console.log('— SITUATIONAL: a reading of the state, not a timer —')

{
  const s = staged()
  setShares(s, [0.09, 0.0001, 0.0001])
  const r = s.rivals[0]

  // Same rival, same week, same cooldown — only the STATE changes, and the posture follows it.
  ok(rivalStance(s, r).attack === 'raid', 'entrenched rival + a growing you = a raid')

  const flat = staged()
  setShares(flat, [0.09, 0.0001, 0.0001])
  flat.history = flat.history.map((h) => ({ ...h, users: flat.users })) // dead flat: no growth
  ok(rivalStance(flat, flat.rivals[0]).attack === null, 'stop growing and the same rival stands down — grip alone is not a provocation')

  const small = staged()
  setShares(small, [0.001, 0.0001, 0.0001])
  ok(
    rivalStance(small, small.rivals[0]).attack !== 'raid',
    'a rival with a sliver of the market does not raid however fast you grow — force needs a base to come from',
  )

  // The funding gap, read on its own.
  const funded = staged()
  setShares(funded, [0.001, 0.0001, 0.0001])
  funded.history = funded.history.map((h) => ({ ...h, users: funded.users }))
  funded.rivals[0].stage = 4
  funded.employees = Array.from({ length: 4 }, (_, i) => ({
    id: `e${i}`, name: `E${i}`, role: 'engineer' as const, skill: 6, salary: 100_000, morale: 70, weeks: 10, trait: null,
  }))
  ok(rivalStance(funded, funded.rivals[0]).attack === 'poach', 'out-raised by two rounds with a team worth raiding = they come for your people')
  funded.employees = []
  ok(rivalStance(funded, funded.rivals[0]).attack !== 'poach', 'with nobody to poach they do not bother')

  // The comparison threads.
  const loud = staged()
  setShares(loud, [0.001, 0.0001, 0.0001])
  loud.history = loud.history.map((h) => ({ ...h, users: loud.users }))
  loud.rivals[0].stage = 0
  loud.rivals[0].product = 5
  loud.features = 90
  loud.quality = 90
  loud.bugs = 0
  loud.hype = 70
  ok(rivalStance(loud, loud.rivals[0]).attack === 'smear', 'far ahead on product AND loud about it = they change the subject')
  loud.hype = 5
  ok(
    rivalStance(loud, loud.rivals[0]).attack !== 'smear',
    'ahead but quiet is not a comms problem — the gate is AND, not OR, which is what stopped every rival being hostile always',
  )

  // Nothing at all before the visibility floor. Asserted against LITERALS, not against the
  // constants themselves: `staged({ week: RIVAL_AGGRO_MIN_WEEK - 1 })` moves with the constant, so
  // setting the floor to zero left it green. Week 5 and 50 users are what the golden traces and
  // the early game actually need protected, so those are the numbers written down.
  const early = staged({ week: 5 })
  setShares(early, [0.09, 0.09, 0.09])
  ok(early.rivals.every((x) => rivalStance(early, x).attack === null), 'nobody moves in week 5, however entrenched they are')
  ok(RIVAL_AGGRO_MIN_WEEK >= 12, `and the grace period covers the whole 12-week golden-trace window (${RIVAL_AGGRO_MIN_WEEK})`)
  const tiny = staged({ users: 50 })
  setShares(tiny, [0.09, 0.09, 0.09])
  ok(tiny.rivals.every((x) => rivalStance(tiny, x).attack === null), 'nor against a 50-user company — nobody runs a campaign against a rounding error')
  ok(RIVAL_AGGRO_MIN_USERS >= 100, `the visibility floor is a real threshold (${RIVAL_AGGRO_MIN_USERS} users)`)

  // A dead rival has no opinions.
  const dead = staged()
  setShares(dead, [0.09, 0.0001, 0.0001])
  dead.rivals[0].alive = false
  ok(rivalStance(dead, dead.rivals[0]).attack === null, 'and a rival that shut down never attacks anyone again')
}

// ---------------------------------------------------------------------------------------------
console.log('— PAID FOR: aggression trades against their own growth —')

/**
 * Advance until the staged rival actually swings. Returns the state on the strike week AND the
 * rival's momentum/product/stage as they stood the week BEFORE — measuring the cost against the
 * value five weeks earlier would credit the attack with everything else that happened in between
 * (a stage-up multiplies momentum by 1.15, which swamps a 0.94 attack cost outright).
 */
function runUntilStrike(seed: number, weeks = 40): { s: GameState; struck: boolean; momentum: number; product: number; stage: number } {
  let s = newGame('Staged', 'saas', 'technical', {
    config: cfg({ seed, overrides: { rivalAggression: true } }),
    aiRivals: true,
  })
  const base = staged()
  s.week = base.week
  s.users = base.users
  s.cash = base.cash
  s.history = base.history
  setShares(s, [0.09, 0.0001, 0.0001])
  s.rivals[0].hostileSince = s.week - 5 // notice already served
  const name = s.rivals[0].name
  let momentum = s.rivals[0].momentum
  let product = s.rivals[0].product
  let stage = s.rivals[0].stage
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    // Hold the staged conditions steady: this measures the rival's decision, not the player's run.
    s.users = base.users
    s.history = base.history.map((h, i) => ({ ...h, week: s.week - 5 + i }))
    setSharesKeeping(s, [0.09, 0.0001, 0.0001])
    const prev = { momentum: s.rivals[0].momentum, product: s.rivals[0].product, stage: s.rivals[0].stage }
    s = advanceWeek(s)
    const r = s.rivals.find((x) => x.name === name)!
    if ((r.attacksLaunched ?? 0) > 0) return { s, struck: true, ...prev }
    momentum = r.momentum
    product = r.product
    stage = r.stage
  }
  return { s, struck: false, momentum, product, stage }
}

/** setShares, but without wiping the aggression bookkeeping the loop above depends on. */
function setSharesKeeping(s: GameState, shares: number[]): void {
  const tam = effectiveTam(s)
  s.rivals.forEach((r, i) => {
    r.users = Math.round(tam * (shares[i] ?? 0.0001))
    r.product = 10
  })
}

{
  const { s: a, struck, momentum: beforeMomentum, product: beforeProduct, stage: beforeStage } = runUntilStrike(42)
  ok(struck, 'a rival held in a hostile position does eventually swing')
  const after = a.rivals[0]
  ok((after.attacksLaunched ?? 0) === 1, 'the strike is on their record')
  ok(after.stage === beforeStage, 'and they did not also raise a round that week, so the momentum comparison below is clean')
  ok(after.momentum < beforeMomentum, `attacking costs them momentum (${beforeMomentum.toFixed(3)} → ${after.momentum.toFixed(3)})`)
  // `<= before`, not `< before + 1.1`: the weekly build is +0.3..+1.1, so the looser bound was
  // satisfied with the product cost set to ZERO and the mutation survived. The property is that
  // the week a rival attacks is a week their product does not move forward.
  ok(
    after.product <= beforeProduct,
    `and product — the week's own +0.3..+1.1 of build is more than cancelled (${beforeProduct.toFixed(2)} → ${after.product.toFixed(2)})`,
  )
  ok(RIVAL_ATTACK_MOMENTUM_COST < 1, 'the momentum cost is a real reduction, not a rounding of 1.0')
  ok((after.aggroCooldown ?? 0) > a.week, 'and their ops team goes on cooldown, exactly like yours does')
  const hit = a.inbox.find((m) => m.meta?.rivalAttack === 'raid')
  ok(!!hit && hit.meta?.rivalName === after.name, 'the hit is announced with who threw it')
  ok(!!hit && hit.body.includes('of this market'), 'and the message leads with WHY — the same sentence the rival table showed on the notice week')

  // The cooldown is real. FIFTEEN weeks, not one: at a 22% weekly trigger a single week proves
  // nothing (78% of the time an uncooled rival also does nothing), and the mutation that deleted
  // the cooldown check survived against a one-week window. 15 is comfortably inside this rival's
  // own cooldown (20 weeks at a 9% share) and long enough that an uncooled one would swing again
  // with probability 1 − 0.78¹⁵ ≈ 98%.
  let later = a
  const name = a.rivals[0].name
  for (let w = 0; w < 15 && !later.gameOver; w++) {
    later.users = 4_000
    later.history = later.history.map((h, i, arr) => ({ ...h, users: Math.round(4_000 / Math.pow(1.04, arr.length - 1 - i)) }))
    setSharesKeeping(later, [0.09, 0.0001, 0.0001])
    later = advanceWeek(later)
  }
  const settled = later.rivals.find((x) => x.name === name)!
  ok(
    (settled.attacksLaunched ?? 0) === 1,
    `and having swung, they hold fire for their whole cooldown — a campaign is an episode, not the weather (${settled.attacksLaunched} in 15 further weeks)`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— SCALED: force and frequency ramp on share of TAM —')

ok(rivalRaidLeverage(RIVAL_RAID_SHARE_FLOOR) === RIVAL_RAID_LEVERAGE_MIN, 'a rival at the floor hits at minimum strength')
ok(rivalRaidLeverage(RIVAL_RAID_SHARE_CAP) === RIVAL_RAID_LEVERAGE_MAX, 'a rival at the cap hits at maximum')
ok(rivalRaidLeverage(0.001) === RIVAL_RAID_LEVERAGE_MIN && rivalRaidLeverage(0.9) === RIVAL_RAID_LEVERAGE_MAX, 'and it is clamped at both ends')
ok(
  rivalRaidLeverage(0.09) > rivalRaidLeverage(0.04),
  'in between, more of the market means a harder hit — the ramp is monotone, which is the whole "Late Entrant is harder" claim',
)
ok(
  rivalAggroCooldown(RIVAL_RAID_SHARE_FLOOR) === RIVAL_AGGRO_COOLDOWN && rivalAggroCooldown(RIVAL_RAID_SHARE_CAP) === RIVAL_AGGRO_COOLDOWN_MIN,
  `frequency ramps too: ${RIVAL_AGGRO_COOLDOWN} weeks between campaigns at the floor, ${RIVAL_AGGRO_COOLDOWN_MIN} at the cap`,
)
ok(RIVAL_AGGRO_COOLDOWN_MIN < RIVAL_AGGRO_COOLDOWN, 'an entrenched incumbent sustains pressure a small one cannot')

{
  // The raid the player actually takes scales with the raider's grip, all the way through.
  const small = staged()
  setShares(small, [RIVAL_RAID_SHARE_FLOOR, 0.0001, 0.0001])
  const big = staged()
  setShares(big, [RIVAL_RAID_SHARE_CAP, 0.0001, 0.0001])
  const hitBy = (s: GameState) => {
    const users = s.users
    applyAttackIncoming(s, 'raid', s.rivals[0].name, { magnitudeScale: rivalRaidLeverage(rivalMarketShare(s, s.rivals[0])) })
    return users - s.users
  }
  const lightHit = hitBy(small)
  const heavyHit = hitBy(big)
  ok(lightHit > 0 && heavyHit > lightHit * 3, `a Late-Entrant-scale incumbent takes far more than a Standard-scale one (${heavyHit} vs ${lightHit})`)
  ok(heavyHit === Math.round(raidMagnitude(4_000) * RIVAL_RAID_LEVERAGE_MAX), 'and the number is exactly raidMagnitude × leverage, which is what the UI promises')
}

// The variable that was REJECTED, kept as an assertion so nobody quietly reintroduces it: an AI
// rival is bigger than the player essentially always, so a size-ratio gate is not a gate.
{
  // 4% of TAM against a 4,000-user player: comfortably over 2.5x their size, comfortably under
  // the 5% raid floor. A size-ratio gate at any plausible threshold fires here; the share gate
  // correctly does not. That is the whole reason the policy turns on share.
  const s = staged()
  setShares(s, [0.04, 0.04, 0.04])
  const ratios = s.rivals.map((r: Rival) => r.users / s.users)
  ok(
    ratios.every((x) => x > 2.5),
    `these rivals are all >2.5x the player (${ratios.map((x) => x.toFixed(1)).join(', ')}) — the ratio gate that was rejected would fire`,
  )
  ok(s.rivals.every((r) => rivalMarketShare(s, r) < RIVAL_RAID_SHARE_FLOOR), 'but share reads all three as too small a piece of the market to raid with')
  ok(s.rivals.every((r) => rivalStance(s, r).attack !== 'raid'), 'so none of them raids — share discriminates where the size ratio does not')
}

ok(RIVAL_SMEAR_AHEAD > 0 && RIVAL_RAID_SHARE_FLOOR < RIVAL_RAID_SHARE_CAP, 'the constants describe a ramp, not a step')

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------
// MUTATION LEDGER
//
// 28 mutations of src/game/engine.ts, 27 killed, 1 equivalent. Reproduce with:
//     bash scripts/mutate-rival-aggression.sh
//
// | # | mutation                                                    | killed by |
// |---|-------------------------------------------------------------|-----------|
// |  1| rivals act regardless of the capability                      | EQUIVALENT — see below |
// |  2| rivals never act at all                                      | 10 |
// |  3| `rivalStance` ignores the capability                          |  2 |
// |  4| strike on the very week they are announced                    |  2 |
// |  5| never announce, just hit                                      |  4 |
// |  6| RIVAL_AGGRO_NOTICE → 0                                        |  3 |
// |  7| shield/counter locked back to Arena only                      |  6 |
// |  8| a counter-raid mints users instead of moving them             |  1 |
// |  9| the shield stops deflecting                                   |  2 |
// | 10| raid ignores whether you are growing                          |  1 |
// | 11| raid ignores their grip on the market                         |  2 |
// | 12| smear gate back to OR (every rival hostile always)            |  1 |
// | 13| poach without a team worth poaching                           |  1 |
// | 14| RIVAL_AGGRO_MIN_WEEK → 0                                      |  2 |
// | 15| RIVAL_AGGRO_MIN_USERS → 0                                     |  2 |
// | 16| dead rivals keep attacking                                    |  1 |
// | 17| RIVAL_ATTACK_MOMENTUM_COST → 1 (attacking is free)            |  2 |
// | 18| RIVAL_ATTACK_PRODUCT_COST → 0                                 |  1 |
// | 19| no cooldown between campaigns                                 |  1 |
// | 20| raid leverage flat at 1                                       |  6 |
// | 21| raid leverage INVERTED (big rivals punch soft — the old bug)  |  6 |
// | 22| frequency does not ramp with grip                             |  1 |
// | 23| the magnitude multiplier dropped on the victim's side         |  2 |
// | 24| share measured against the player instead of the TAM          |  5 |
// | 25| the hit no longer says why                                    |  1 |
// | 26| the attack message loses its metadata                         |  2 |
// | 27| deflections not marked as deflections                         |  1 |
// | 28| `hostileRivals` reports nobody                                |  2 |
//
// FOUR ROUNDS OF THIS FILE WERE WRONG, and the record is more useful than the score:
//
//   * #4 exposed DEAD CODE IN THE ENGINE, not a weak test. The announcement used to `return`
//     after writing `hostileSince`, which gave one week of notice as a side effect and left the
//     `s.week < hostileSince + RIVAL_AGGRO_NOTICE` guard unreachable — deleting the guard changed
//     nothing. The return is gone; the guard is now the notice, so the constant is a real dial.
//   * #3 exposed a real defect: `rivalStance` was gated but nothing checked it, so a run with the
//     capability off would still have painted Hostile badges for attacks that could never come.
//   * #14 and #15 were self-referential — the fixtures were built from the very constants being
//     mutated (`staged({ week: RIVAL_AGGRO_MIN_WEEK - 1 })`), so setting them to zero moved the
//     test with the code. Now asserted against literals (week 5, 50 users).
//   * #18 and #19 were too loose. `product < before + 1.1` was satisfied with the cost at zero
//     (the weekly build is +0.3..+1.1); it is `<= before` now. And "they do not swing again NEXT
//     WEEK" is 78% likely at a 22% trigger even with no cooldown at all; it is 15 weeks now.
//
// #1 IS GENUINELY EQUIVALENT, not an untested gap. Aggression is gated twice — `tickRivals` will
// not call `rivalAggressionStep`, and `rivalStance` returns `calm` — so removing either one alone
// leaves behaviour identical: the step is entered and returns before it reads, writes or draws.
// #2 and #3 kill the two gates individually, which is the coverage that matters.
// ---------------------------------------------------------------------------------------------
