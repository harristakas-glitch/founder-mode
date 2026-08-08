// Smoke test: PVP_RULES must suppress arcs / 1:1s / catastrophes / energy / board,
// and the attack functions must behave (cost, cooldown, incoming effects).
import {
  ATTACKS,
  ATTACK_COOLDOWN,
  SHIELD_WEEKS,
  advanceWeek,
  applyAttackIncoming,
  applyAttackOutgoing,
  attackCost,
  buyShield,
  raidMagnitude,
  canAttack,
  newGame,
  shieldCost,
} from '../src/game/engine'
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
const std = run(DEFAULT_RULES, 120)
ok(std.energy !== 80 || std.week < 10, `energy system alive (is ${std.energy})`)

console.log('— Attack mechanics —')
let a = newGame('Attacker', 'saas', 'technical', { seed: 7, capabilities: { ...PVP_RULES }, aiRivals: false })
a.cash = 1_000_000
ok(canAttack(a).ok, 'canAttack with pvp on + no cooldown')
const before = a.cash
ok(applyAttackOutgoing(a, 'raid', 'VictimCo', 100_000), 'raid launches')
ok(a.cash === before - ATTACKS.find((x) => x.id === 'raid')!.cost, 'raid cost deducted')
ok(a.users >= Math.round(100_000 * 0.04 * 0.8), `raid spoils landed (users ${a.users})`)
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
ok(v.users < 50_000, `raid drains victim users (${v.users})`)

const noPvp = newGame('Peace', 'saas', 'technical', { seed: 3, capabilities: { ...DEFAULT_RULES }, aiRivals: false })
ok(!canAttack(noPvp).ok, 'attacks blocked when pvp rule is off')

console.log('— Shields & cost scaling —')
let d = newGame('Defender', 'saas', 'technical', { seed: 11, capabilities: { ...PVP_RULES }, aiRivals: false })
d.cash = 1_000_000
ok(attackCost(d, 'smear') === 40_000, 'pre-seed smear costs base $40k')
d.stage = 'Series B'
ok(attackCost(d, 'smear') === 100_000, `Series B smear costs 2.5x ($${attackCost(d, 'smear')})`)
ok(shieldCost(d) === 480_000, `Series B shield costs 4x ($${shieldCost(d)})`)
d.stage = 'Pre-seed'
const cashBefore = d.cash
ok(buyShield(d), 'shield purchase succeeds')
ok(d.cash === cashBefore - 120_000, `shield cost deducted (${cashBefore - d.cash})`)
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
  ok(raidMagnitude(40) <= 40 * 0.16, `a tiny rival is not flattened (${raidMagnitude(40)} of 40)`)
  ok(raidMagnitude(10_000) === 400, 'large-scale behaviour is unchanged — this is a floor, not a buff')
  ok(raidMagnitude(0) === 0 && raidMagnitude(NaN) === 0, 'no users and a hostile NaN both yield zero')
  ok(
    raidMagnitude(300) >= raidMagnitude(120) && raidMagnitude(2000) >= raidMagnitude(300),
    'magnitude never decreases as the target grows',
  )
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
