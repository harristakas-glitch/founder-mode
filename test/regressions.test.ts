// Regression tests for the code-review fixes.
import {
  ATTACKS,
  acceptTermSheet,
  advanceWeek,
  applyAttackIncoming,
  applyAttackOutgoing,
  COVENANT_DEFAULT,
  covenantConversion,
  MARKETING_CAP,
  marketingMax,
  newGame,
  operatingProfit,
} from '../src/game/engine'
import { defaultCapabilities } from '../src/game/modes'
const DEFAULT_RULES = defaultCapabilities('quick')
const PVP_RULES = defaultCapabilities('arena')
import { sectorById } from '../src/game/data'
import type { GameState } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

console.log('— Determinism: same seed must deal the same world —')
const worldA = newGame('A', 'saas', 'technical', { seed: 12345 })
const worldB = newGame('B', 'saas', 'technical', { seed: 12345 })
ok(
  JSON.stringify(worldA.rivals.map((r) => [r.name, r.stage, r.users, r.product])) ===
    JSON.stringify(worldB.rivals.map((r) => [r.name, r.stage, r.users, r.product])),
  'rivals identical (names, stages, users, product)',
)
ok(
  JSON.stringify(worldA.candidates.map((c) => [c.name, c.role, c.skill, c.trait])) ===
    JSON.stringify(worldB.candidates.map((c) => [c.name, c.role, c.skill, c.trait])),
  'starting candidates identical, traits included',
)
const worldC = newGame('C', 'saas', 'technical', { seed: 999 })
ok(
  JSON.stringify(worldA.rivals.map((r) => r.name)) !== JSON.stringify(worldC.rivals.map((r) => r.name)) ||
    worldA.rivals[0].users !== worldC.rivals[0].users,
  'a different seed deals a different world',
)

console.log('— Traits survive hiring —')
let g = newGame('TraitCo', 'saas', 'technical', { seed: 7 })
g.cash = 10_000_000
// force a traited candidate through the pipeline
const c = { ...g.candidates[0], trait: 'tenx' as const, notice: 0 }
g.pendingHires.push({ candidate: c, weeksUntilStart: 1 })
g = advanceWeek(g)
const hired = g.employees.find((e) => e.id === c.id)
ok(!!hired, 'pending hire joined the team')
ok(hired?.trait === 'tenx', `trait carried onto the employee (got ${hired?.trait})`)

console.log('— Covenant breach with negative cash —')
let d = newGame('DebtCo', 'saas', 'technical', { seed: 3 })
d.cash = -5_000
d.lastRevenue = 0
d.debt = { principal: 100_000, apr: 9, covenantRevenue: 50_000 }
const before = d.cash
d = advanceWeek(d)
ok(d.cash <= before || d.gameOver !== null, `bank cannot gift money on a breach (cash ${Math.round(d.cash)})`)
ok(!Number.isNaN(d.cash), 'cash is not NaN after a breach')

console.log('— A covenant default is priced by the size of the hole (deep-dive finding 7) —')
// The old rule was a flat `founderEquity *= 0.85` that never read `shortfall`, so defaulting on
// $10M and on $250k cost the same 15%. That makes "max the line, spend it, breach" the dominant
// use of debt the moment a mode can generate the revenue to draw a big one.
{
  const small = covenantConversion(250_000, 50_000_000)
  const large = covenantConversion(10_000_000, 50_000_000)
  ok(large > small, `defaulting on $10M costs more than on $250k (${(large * 100).toFixed(0)}% vs ${(small * 100).toFixed(0)}%)`)
  ok(small >= COVENANT_DEFAULT.floor - 1e-9, 'and a small default is never free — the floor holds')
  // LITERAL again, and with an input that actually BINDS the cap — `large` above converts 30% and
  // never reaches it, so asserting `large <= COVENANT_DEFAULT.cap` was true under any cap at all.
  ok(Math.abs(covenantConversion(100_000_000, 50_000_000) - 0.6) < 1e-9, 'nor can one breach take the whole company: a 200% hole still converts 60%')
  ok(large <= 0.6 + 1e-9, 'and no ordinary default exceeds that either')
  ok(covenantConversion(0, 50_000_000) === 0, 'a fully-covered call converts no equity at all')
  ok(
    covenantConversion(1_000_000, 0) === COVENANT_DEFAULT.cap,
    'a worthless company defaults at the cap rather than dividing by zero',
  )
  // The premium is what makes a forced conversion worse than the round it replaces.
  // LITERAL, not recomputed from COVENANT_DEFAULT: deriving the expectation from the same constant
  // the function reads is a tautology that survives any change to it. (It did — see the mutation
  // ledger at the bottom of this file.)
  const priced = covenantConversion(5_000_000, 50_000_000)
  ok(
    Math.abs(priced - 0.15) < 1e-9,
    `and it carries a distress premium over a negotiated round: a 10% hole converts ${(priced * 100).toFixed(0)}%, not 10%`,
  )
}
{
  // Through the real call path, not just the pure function.
  const breach = (principal: number): number => {
    let g = newGame('DebtCo', 'saas', 'technical', { seed: 3 })
    g.cash = 0 // the bank can seize nothing, so the whole principal is shortfall
    g.lastRevenue = 0
    g.users = 5_000
    g.debt = { principal, apr: 9, covenantRevenue: 50_000 }
    const equityBefore = g.founderEquity
    g = advanceWeek(g)
    return equityBefore - g.founderEquity
  }
  const cheap = breach(100_000)
  const dear = breach(20_000_000)
  // ABSOLUTE BOUNDS on the small case, not just `dear > cheap`. The ordering alone survives the
  // flat-15% rule, because a $20M breach bankrupts the company and other terms move equity too —
  // it read as a pass while the defect was fully restored.
  ok(cheap < 0.1, `the weekly step charges the small default at ${(cheap * 100).toFixed(1)} points, not a flat 15`)
  ok(cheap > 0.02, 'and still charges it something — the floor survives the round trip through advanceWeek')
  ok(dear > cheap * 3, `while a $20M hole costs ${(dear * 100).toFixed(1)} points through the same path`)
}

console.log('— Hostile inputs —')
ok(sectorById('not-a-sector').id === 'saas', 'unknown sector id falls back instead of throwing')
let v = newGame('Victim', 'saas', 'technical', { seed: 5, capabilities: { ...PVP_RULES } })
v.users = 10_000
const usersBefore = v.users
// unknown attack kind off the wire must not throw
applyAttackIncoming(v, 'nuke' as unknown as (typeof ATTACKS)[number]['id'], 'Evil')
ok(v.users === usersBefore, 'unknown attack kind is ignored, not applied')
// an oversized company name gets truncated before it lands in the persisted inbox
applyAttackIncoming(v, 'smear', 'X'.repeat(5000))
ok((v.inbox[0].title.length ?? 0) < 200, `attacker company name truncated (title len ${v.inbox[0].title.length})`)
// NaN target users must not poison the attacker
let a = newGame('Attacker', 'saas', 'technical', { seed: 6, capabilities: { ...PVP_RULES } })
a.cash = 1_000_000
applyAttackOutgoing(a, 'raid', 'Ghost', NaN)
ok(!Number.isNaN(a.users), `raid against a NaN user count leaves users finite (${a.users})`)

console.log('— Board cannot overwrite a finished run —')
let ipo = newGame('IpoCo', 'saas', 'technical', { seed: 8 })
ipo.gameOver = { type: 'ipo', week: 50, payout: 500_000_000 }
ipo.board = { targetGrowth: 0.9, nextReview: 1, strikes: 2, defied: true }
ipo = advanceWeek(ipo)
ok(ipo.gameOver?.type === 'ipo', `IPO ending survives a board review week (got ${ipo.gameOver?.type})`)

console.log('— Quiet period —')
const q = newGame('QuietCo', 'saas', 'technical', { seed: 9 })
q.ipo = { phase: 'filing', weeksLeft: 4, demand: 50 }
q.termSheets = [{ id: 't1', investor: 'Sneaky Capital', amount: 5_000_000, equity: 0.2, weeksLeft: 3 }]
const stageBefore = q.stage
const cashBefore = q.cash
acceptTermSheet(q, 't1')
ok(q.stage === stageBefore && q.cash === cashBefore, 'cannot close a private round during the IPO quiet period')

console.log('— Rules default still sane —')
const std: GameState = newGame('Std', 'saas', 'technical', { seed: 1 })
ok(std.capabilities.storyArcs && !std.capabilities.pvpActions, 'single player: arcs on, pvp off')
ok(DEFAULT_RULES.founderEnergy && !PVP_RULES.founderEnergy, 'mode presets unchanged')

console.log('\n— Funding climate cycles, it does not absorb —')
{
  // A clamp is an absorbing boundary: with no mean reversion a run that wandered below -0.6 had
  // nothing pulling it back and could sit frozen for the rest of the game, with fundraising 70%
  // blocked the whole time. Measured before the fix: 8 runs in 40 stuck 20+ weeks, worst 49.
  let worst = 0
  let stuck = 0
  for (let seed = 1; seed <= 20; seed++) {
    let s = newGame('Climate', 'saas', 'technical', { seed })
    let run = 0
    let best = 0
    for (let w = 0; w < 104; w++) {
      s.cash = 5_000_000 // outlive the window; we are measuring the market, not the company
      s = advanceWeek(s)
      if (s.climate < -0.6) { run++; best = Math.max(best, run) } else run = 0
    }
    worst = Math.max(worst, best)
    if (best >= 20) stuck++
  }
  ok(stuck === 0, `no run is frozen for 20+ consecutive weeks (${stuck}/20, worst streak ${worst} wk)`)
  ok(worst > 0, 'downturns still happen — the fix is mean reversion, not removing bad markets')
}

console.log('\n— The marketing cap is what you can fund, not what you raised —')
//
// `marketingMax` read `s.stage` and nothing else, and `s.stage` moves in exactly one place:
// `acceptTermSheet`. So a company that never raised was frozen at $30k/wk forever, however
// profitable — the reported case was $7.9M in the bank, +$171k/wk of net income and infinite
// runway, on the same budget as a company in its first week.
{
  const fresh = () => newGame('Cap', 'saas', 'technical', { seed: 4242 })
  const floor = MARKETING_CAP.byStage['Pre-seed']

  // 1. The bug. Never raised, so still Pre-seed; profitable and cash-rich, so it can fund growth.
  const rich = fresh()
  rich.cash = 7_920_000
  rich.lastRevenue = 200_000
  ok(rich.stage === 'Pre-seed', 'the reported company never raised, so the ladder still says Pre-seed')
  ok(operatingProfit(rich) > 150_000, `and it is genuinely profitable ($${Math.round(operatingProfit(rich)).toLocaleString()}/wk before marketing)`)
  ok(
    marketingMax(rich) > floor * 5,
    `so its budget is no longer the Pre-seed floor: $${marketingMax(rich).toLocaleString()} against $${floor.toLocaleString()}`,
  )

  // 2. The exploit guard, and the reason the treasury term is gated. Ability to fund, never
  //    appetite: docs/balance-baseline.md §1 measured LTV/CAC below 1 at low retention in all five
  //    sectors, so a cap a LOSING company could raise would only let it reach that faster.
  for (const cash of [200_000, 2_000_000, 8_000_000, 40_000_000]) {
    const burning = fresh()
    burning.cash = cash
    burning.lastRevenue = 0
    ok(operatingProfit(burning) <= 0, `a company with $${(cash / 1e6).toFixed(1)}M and no revenue is losing money`)
    ok(
      marketingMax(burning) === floor,
      `and gets exactly the stage floor — $${marketingMax(burning).toLocaleString()}, not a dollar of headroom from a bank it is burning`,
    )
  }

  // 3. Stage still matters. It is a floor, not the whole answer, and an unprofitable company is
  //    governed by it alone — which is exactly the company the ladder was designed for.
  const seedStage = fresh()
  seedStage.stage = 'Series B'
  seedStage.lastRevenue = 0
  ok(
    marketingMax(seedStage) > marketingMax(fresh()) && marketingMax(seedStage) === MARKETING_CAP.byStage['Series B'],
    `a Series B company still outspends a Pre-seed one on the ladder alone ($${marketingMax(seedStage).toLocaleString()} vs $${marketingMax(fresh()).toLocaleString()})`,
  )
  //    …and the floor binds on the PROFITABLE path too, which is the half a test that only ever
  //    looks at loss-making companies cannot see: `marketingMax` returns early for those, so
  //    deleting `Math.max(floor, …)` outright leaves such a test entirely green. A barely
  //    profitable Series C company must keep its war chest.
  const bigButThin = fresh()
  bigButThin.stage = 'Series C'
  bigButThin.cash = 100_000
  bigButThin.lastRevenue = 11_000
  ok(operatingProfit(bigButThin) > 0, 'a Series C company can be profitable and still tiny')
  ok(
    operatingProfit(bigButThin) + bigButThin.cash * MARKETING_CAP.treasuryShare < MARKETING_CAP.byStage['Series C'],
    'with earnings far below what the round it closed would fund',
  )
  ok(
    marketingMax(bigButThin) === MARKETING_CAP.byStage['Series C'],
    `and it keeps the war chest — $${marketingMax(bigButThin).toLocaleString()}, the ladder as a FLOOR rather than a maximum`,
  )

  // 4. The cap must not shrink under the player's hand. `weeklyBurn` includes `s.marketingSpend`,
  //    so an operating figure that read it would fall as the slider rose and the slider would
  //    retreat as it was dragged.
  const dragging = fresh()
  dragging.cash = 7_920_000
  dragging.lastRevenue = 200_000
  const capAtZero = marketingMax(dragging)
  dragging.marketingSpend = capAtZero
  ok(marketingMax(dragging) === capAtZero, 'moving the slider to the cap does not move the cap')

  // 5. `earnedShare` is exactly 1: spending the whole cap can take net income to zero, never below
  //    it — minus whatever treasury slice the company chose to commit on top.
  const atCap = fresh()
  atCap.cash = 4_000_000
  atCap.lastRevenue = 120_000
  const treasury = atCap.cash * MARKETING_CAP.treasuryShare
  ok(
    Math.abs(marketingMax(atCap) - (operatingProfit(atCap) + treasury)) <= 1,
    'the cap is exactly operating profit plus the treasury slice — no multiplier on either',
  )
  ok(
    operatingProfit(atCap) - (marketingMax(atCap) - treasury) >= 0,
    'so the earned half of the cap is affordable out of profit alone',
  )

  // 6. …and the treasury slice is pinned with a LITERAL, because everything above derives its
  //    expectation from `MARKETING_CAP.treasuryShare` and so survives any change to it. The share
  //    has to stay small enough that the cap is dominated by what the company EARNS: at 50% a
  //    company with $10M in the bank could commit $5M a week, the bank would swamp the earnings
  //    term entirely, and "ability to fund" would collapse back into "size of the pile".
  const banked = fresh()
  banked.stage = 'Pre-seed'
  banked.cash = 10_000_000
  banked.lastRevenue = 20_000
  ok(MARKETING_CAP.treasuryShare <= 0.03, `the treasury slice is a slice: ${(MARKETING_CAP.treasuryShare * 100).toFixed(1)}%/wk, not a third of the bank`)
  ok(
    marketingMax(banked) < 250_000,
    `so $10M in the bank on $20k/wk of revenue funds $${marketingMax(banked).toLocaleString()}/wk, not millions`,
  )
  ok(
    1 / MARKETING_CAP.treasuryShare >= 50,
    `and committing that slice every week would take ${Math.round(1 / MARKETING_CAP.treasuryShare)} weeks to spend the bank once — a year of deliberate reinvestment, not a fortnight of it`,
  )
}

console.log('\n— A rival never wears the player\'s company name (audit fix, 2026-08-23) —')
{
  // 'Nimbus Labs' is in RIVAL_NAMES: pre-fix, seed 42 could seat a rival with the player's own
  // name and the leaderboard showed the company at #1 and #4 simultaneously.
  for (const seed of [1, 7, 42, 99]) {
    const g = newGame('Nimbus Labs', 'saas', 'technical', { seed })
    ok(g.rivals.every((r) => r.name.toLowerCase() !== 'nimbus labs'), `seed ${seed}: no rival is named Nimbus Labs`)
    ok(g.rivals.length === 3, `seed ${seed}: still exactly three rivals`)
  }
  // and a non-colliding name draws the SAME world it always did — the filter must not shift
  // the RNG stream (the golden traces in modes.test.ts pin this too, but say it here by name)
  const a = newGame('Totally Original Co', 'saas', 'technical', { seed: 42 })
  const b = newGame('Another Name Inc', 'saas', 'technical', { seed: 42 })
  ok(JSON.stringify(a.rivals.map((r) => r.name)) === JSON.stringify(b.rivals.map((r) => r.name)), 'non-colliding names build identical rival sets')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// =================================================================================================
// MUTATIONS RUN AGAINST THE COVENANT BLOCK. Each applied alone, this file re-run, then reverted.
//
//   M1 flat 15% regardless of shortfall (the defect itself)          KILLED
//   M2 floor removed — a small default becomes free                  KILLED
//   M3 distress premium removed — default priced like a round        KILLED
//   M4 cap removed                                                   KILLED
//   M5 zero-valuation guard removed                                  EQUIVALENT, not killed
//
// * THREE OF THESE SURVIVED THE FIRST PASS and every one was the same class the token slices kept
//   shipping — a test that derives its expectation from the constant under test:
//
//   M3  asserted `priced === (5e6/5e7) * COVENANT_DEFAULT.distressPremium`. Both sides move when
//       the constant does, so the premium could be deleted and the assertion stayed green. Now a
//       literal 0.15.
//   M4  asserted `large <= COVENANT_DEFAULT.cap`. Same tautology, and worse: no input in the test
//       reached the cap at all, so it was true under any cap. Now a 200%-of-valuation hole, which
//       binds it, against a literal 0.6.
//   M1  asserted only `dear > cheap` through advanceWeek. A $20M breach bankrupts the company and
//       other terms move equity too, so the ordering held with the flat rule fully restored. Now
//       bounded absolutely: the small default must cost under 10 points and over 2.
//
// * M5 IS AN EQUIVALENT MUTANT and is recorded rather than papered over. With the guard removed,
//   `shortfall / 0` is Infinity, `Infinity * 1.5` is Infinity, and `clamp` returns the cap — the
//   same answer the guard returns. It is kept as a statement of intent, not because it changes
//   behaviour. `shortfall > 0` is checked first, so 0/0 and NaN are unreachable.

