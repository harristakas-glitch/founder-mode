// Smoke test: PVP_RULES must suppress arcs / 1:1s / catastrophes / energy / board,
// and the attack functions must behave (cost, cooldown, incoming effects).
import {
  ATTACKS,
  ATTACK_COOLDOWN,
  SHIELD_BASE_COST,
  SHIELD_WEEKS,
  advanceWeek,
  applyAttackIncoming,
  applyAttackOutgoing,
  attackCost,
  buyShield,
  raidMagnitude,
  canAttack,
  canBuyShield,
  newGame,
  pivot,
  shieldCost,
} from '../src/game/engine'
import { STAGES } from '../src/game/data'
import { defaultCapabilities } from '../src/game/modes'
const DEFAULT_RULES = defaultCapabilities('quick')
const PVP_RULES = defaultCapabilities('arena')
import type { GameState } from '../src/game/types'

function run(rules: typeof DEFAULT_RULES, weeks: number): GameState {
  let s = newGame('TestCo', 'saas', 'technical', { seed: 42, capabilities: { ...rules }, aiRivals: false })
  s.cash = 50_000_000 // survive regardless — we're probing systems, not balance
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    // answer nothing; just advance
    s = advanceWeek(s)
    s.cash = Math.max(s.cash, 5_000_000)
  }
  return s
}

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

console.log('— PvP ruleset run (120 weeks) —')
const pvp = run(PVP_RULES, 120)
ok(pvp.arcs.length === 0, 'no story arcs started')
ok(!pvp.inbox.some((m) => m.meta?.employeeId && m.kind === 'choice'), 'no 1:1 asks')
ok(!pvp.inbox.some((m) => m.title.includes('🚨') || /breach|CVE|algorithm change|logistics/i.test(m.title)), 'no catastrophes (title scan)')
ok(pvp.energy === 80, `energy untouched (is ${pvp.energy})`)
ok(pvp.board === null || pvp.board.strikes === 0, 'no board strikes accrued')
ok(!pvp.inbox.some((m) => /board review/i.test(m.title)), 'no board review messages')

console.log('— Default ruleset run (120 weeks) —')
// Positive control for the PvP suppression block above. Without it, every `no X happened`
// assertion there would also pass if X were broken in EVERY mode. It has to HIRE, because 1:1s
// need two employees and the suppression fixture never hires anyone.
let stdRun = newGame('TestCo', 'saas', 'technical', { seed: 42, capabilities: { ...DEFAULT_RULES }, aiRivals: false })
stdRun.cash = 50_000_000
const richEnergy: number[] = []
for (let w = 0; w < 120 && !stdRun.gameOver; w++) {
  if (stdRun.employees.length + stdRun.offersOut.length + stdRun.pendingHires.length < 4 && stdRun.candidates.length) {
    const pickBest = [...stdRun.candidates].sort((x, y) => y.skill - x.skill)[0]
    stdRun.candidates = stdRun.candidates.filter((c) => c.id !== pickBest.id)
    stdRun.offersOut.push(pickBest)
  }
  stdRun = advanceWeek(stdRun)
  stdRun.cash = Math.max(stdRun.cash, 5_000_000)
  richEnergy.push(stdRun.energy)
}
const std = stdRun
ok(std.arcs.length > 0, `story arcs DO start when the capability is on (${std.arcs.length}) — the suppression check above is not vacuous`)
ok(std.inbox.some((m) => m.meta?.employeeId && m.kind === 'choice'), 'and 1:1 asks DO arrive when the capability is on')
// NOTE, deliberately not asserted here: the two board assertions in the PvP block above
// (`no board strikes accrued`, `no board review messages`) are vacuous in BOTH modes. `s.board` is
// only created by `acceptTermSheet`, and neither fixture ever raises a round, so `boardReview`
// returns on its first guard regardless of the capability. Making them meaningful needs a fixture
// that accepts a term sheet; recorded rather than papered over.

// `std.energy !== 80 || std.week < 10` was a free pass twice over: the disjunct excused any short
// run, and `!== 80` is satisfied by 79. On THIS fixture energy can only ever rise — cash is pinned
// at $5M every week, so `stressed = expenses > revenue && runway < 8` is unreachable and the
// erosion half of the system is never exercised. Both halves now get their own fixture.
ok(
  Math.max(...richEnergy) === 100 && richEnergy[richEnergy.length - 1] === 100,
  `a founder with no money worries recovers to a full tank (${Math.min(...richEnergy)}..${Math.max(...richEnergy)})`,
)
// What stress ACTUALLY does, measured rather than assumed. advanceWeek applies
// `energy + 3 - (ipo ? 4 : 0) - (stressed ? 3 : 0)`, so cash stress exactly cancels the weekly
// recovery and cannot push the tank down on its own. Only founder ACTIONS drain it. The engine's
// own comment says "slow recovery, faster erosion under stress", which overstates the second half —
// pinning the real behaviour here so a future change to either is a visible diff.
let broke = newGame('Broke', 'saas', 'technical', { seed: 42, capabilities: { ...DEFAULT_RULES }, aiRivals: false })
broke.cash = 30_000
broke.marketingSpend = 20_000 // burn far faster than any revenue can cover: runway well under 8 weeks
const brokeEnergy: number[] = []
for (let w = 0; w < 12 && !broke.gameOver; w++) {
  broke = advanceWeek(broke)
  broke.cash = 30_000 // hold the runway short so the stress term keeps firing
  brokeEnergy.push(broke.energy)
}
ok(
  brokeEnergy.every((e) => e === 80),
  `cash stress cancels the weekly recharge exactly — it does not erode on its own (${Math.min(...brokeEnergy)}..${Math.max(...brokeEnergy)})`,
)
const drained = newGame('Drained', 'saas', 'technical', { seed: 42, capabilities: { ...DEFAULT_RULES }, aiRivals: false })
const energyBefore = drained.energy
pivot(drained)
ok(drained.energy === energyBefore - 12, `a pivot is what actually costs the founder (${energyBefore} → ${drained.energy})`)

console.log('— Attack mechanics —')
let a = newGame('Attacker', 'saas', 'technical', { seed: 7, capabilities: { ...PVP_RULES }, aiRivals: false })
a.cash = 1_000_000
ok(canAttack(a).ok, 'canAttack with pvp on + no cooldown')
const before = a.cash
ok(applyAttackOutgoing(a, 'raid', 'VictimCo', 100_000), 'raid launches')
ok(a.cash === before - ATTACKS.find((x) => x.id === 'raid')!.cost, 'raid cost deducted')
// Exact, and it INCLUDES the leverage term. The old bound was `100_000 * 0.04 * 0.8` = 3,200,
// written before leverage existed; the real value is 9,600, so deleting leverage entirely left it
// passing at a third of the truth. The 0.8 spoils haircut is GONE — the duel probe measured raids
// at a 25-35% win rate against a completely passive victim (a self-own, not a trade), and the
// haircut meant a raid destroyed users rather than moving them.
ok(
  a.users === Math.round(raidMagnitude(100_000) * 3),
  `raid spoils landed, leverage and all (users ${a.users}, expected ${Math.round(raidMagnitude(100_000) * 3)})`,
)
ok(a.flags.attackCooldown === ATTACK_COOLDOWN, 'cooldown set')
ok(!canAttack(a).ok, 'second attack blocked by cooldown')
for (let i = 0; i < ATTACK_COOLDOWN; i++) a = advanceWeek(a)
ok(canAttack(a).ok, `cooldown expires after ${ATTACK_COOLDOWN} weeks`)

let v = newGame('Victim', 'saas', 'technical', { seed: 9, capabilities: { ...PVP_RULES }, aiRivals: false })
v.users = 50_000
const hypeBefore = v.hype
applyAttackIncoming(v, 'smear', 'Attacker')
ok(v.hype === Math.max(0, hypeBefore - 10), 'smear hits hype')
ok(v.inbox[0].title.includes('Attacker'), 'victim gets an inbox message')
applyAttackIncoming(v, 'raid', 'Attacker')
// `< 50_000` is the assertion that let the shipped bug through: a raid moving FIVE users satisfied
// it for the entire life of the defect players reported.
ok(
  v.users === 50_000 - raidMagnitude(50_000),
  `raid drains exactly raidMagnitude users (${v.users}, expected ${50_000 - raidMagnitude(50_000)})`,
)

// Who may use the attack layer. Two capabilities open it — `pvpActions` (Arena: other founders)
// and `rivalAggression` (single player: the AI rivals came for you first, so the shield and the
// counter-punch have to exist) — and the assertion states BOTH halves in the same run, because
// this repo has twice shipped a control that blocked the attack and the legitimate path together
// (BACKLOG §1.3). A blanket "attacks are always blocked outside Arena" would now be a lie: Quick
// Play has aggressive rivals, and a player with no answer to them is being handed noise.
const noCombat = newGame('Peace', 'saas', 'technical', {
  seed: 3,
  capabilities: { ...DEFAULT_RULES, rivalAggression: false },
  aiRivals: false,
})
ok(!canAttack(noCombat).ok, 'attacks blocked when neither pvpActions nor rivalAggression is on')
ok(!canBuyShield(noCombat).ok, 'and so is the shield — offence and defence share one gate')
const quickPlay = newGame('Solo', 'saas', 'technical', { seed: 3, capabilities: { ...DEFAULT_RULES }, aiRivals: true })
ok(DEFAULT_RULES.rivalAggression, 'Quick Play rivals are aggressive by default')
ok(canAttack(quickPlay).ok, 'a Quick Play founder CAN answer them — the counter-punch is available')
ok(canBuyShield(quickPlay).ok, 'and so is the crisis retainer')
ok(!defaultCapabilities('arena').rivalAggression, 'Arena has no AI rivals, so nothing to make aggressive')

console.log('— Shields & cost scaling —')
let d = newGame('Defender', 'saas', 'technical', { seed: 11, capabilities: { ...PVP_RULES }, aiRivals: false })
d.cash = 1_000_000
const smearBase = ATTACKS.find((x) => x.id === 'smear')!.cost
ok(attackCost(d, 'smear') === smearBase, `pre-seed smear costs the base price ($${attackCost(d, 'smear')})`)
d.stage = 'Series B'
// Derived from the exported constants and the documented scaling rules, not from observed output.
// Attacks and shields now share ONE stage curve, deliberately: the shield used to scale linearly
// against the attacks' softer 1 + 0.5/stage, so defence outpaced offence with every round raised —
// measured in test/arena-duel-probe.ts as a turtle that WON LESS than standing bare (45% vs 68%).
ok(
  attackCost(d, 'smear') === Math.round(smearBase * (1 + STAGES.indexOf('Series B') * 0.5)),
  `Series B smear scales softer than linear ($${attackCost(d, 'smear')})`,
)
ok(
  shieldCost(d) === Math.round(SHIELD_BASE_COST * (1 + STAGES.indexOf('Series B') * 0.5)),
  `Series B shield scales on the same soft curve as the attacks it deflects ($${shieldCost(d)})`,
)
d.stage = 'Pre-seed'
const cashBefore = d.cash
ok(buyShield(d), 'shield purchase succeeds')
// The invariant is that buyShield charges what shieldCost SAYS, not that it charges 120,000.
ok(d.cash === cashBefore - shieldCost(d), `shield charges exactly shieldCost (${cashBefore - d.cash})`)
ok(d.flags.shield === SHIELD_WEEKS, `shield lasts ${SHIELD_WEEKS} weeks`)
ok(!buyShield(d), 'no double-shield')
const moraleBefore = d.employees.reduce((a, e) => a + e.morale, 0)
const usersBefore2 = (d.users = 50_000)
applyAttackIncoming(d, 'raid', 'Attacker')
ok(d.users === usersBefore2, 'shield deflects the raid (no users lost)')
ok(d.flags.shield > 0, `shield SURVIVES the hit — it is a duration, not one charge (${d.flags.shield} wk left)`)
ok(d.inbox[0].title.includes('deflected'), 'victim told about the deflection')
applyAttackIncoming(d, 'raid', 'Attacker')
ok(d.users === usersBefore2, 'a second attack inside the window is also deflected')
// once it lapses, attacks land again
d.flags.shield = 0
applyAttackIncoming(d, 'raid', 'Attacker')
ok(d.users < usersBefore2, 'attacks land again after the retainer lapses')
void moraleBefore
// shield expires on its own
let e = newGame('Expirer', 'saas', 'technical', { seed: 13, capabilities: { ...PVP_RULES }, aiRivals: false })
e.cash = 1_000_000
buyShield(e)
for (let i = 0; i < SHIELD_WEEKS; i++) e = advanceWeek(e)
ok((e.flags.shield ?? 0) === 0, 'shield expires after its term')

console.log('\n— A raid has to be worth its price at Arena scale —')
{
  // Player report: "I do not see material effects on these actions in arena". They were right.
  // Damage was purely proportional while cost is absolute and stage-scaled, so a $120k raid on a
  // 120-user rival — a completely normal Arena position — moved FIVE users.
  ok(raidMagnitude(120) >= 15, `a 120-user rival loses something you can see (${raidMagnitude(120)}, was 5)`)
  // 0.16 was the 15% cap plus a rounding fudge, which asserted the opposite of the cap it guards.
  ok(raidMagnitude(40) === Math.round(40 * 0.15), `the 15% cap holds exactly at 40 users (${raidMagnitude(40)} of 40)`)
  ok(
    [10, 25, 40, 80, 119].every((u) => raidMagnitude(u) <= Math.ceil(u * 0.15)),
    'and across the whole small-company range the cap is never exceeded',
  )
  // 10%, up from 4% — a deliberate buff this time, unlike the floor above. At 4% a raid was the
  // worst attack in the game: 25-35% win rate against a PASSIVE victim in the duel probe, because
  // absolute stage-scaled costs compound (cash forfeits marketing forever) while a 4% user bite
  // does not. Users are the one thing a raid steals that compounds back.
  ok(raidMagnitude(10_000) === 1000, `large-scale raids move 10% (${raidMagnitude(10_000)} of 10,000)`)
  ok(raidMagnitude(0) === 0 && raidMagnitude(NaN) === 0, 'no users and a hostile NaN both yield zero')
  ok(
    raidMagnitude(300) >= raidMagnitude(120) && raidMagnitude(2000) >= raidMagnitude(300),
    'magnitude never decreases as the target grows',
  )
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
