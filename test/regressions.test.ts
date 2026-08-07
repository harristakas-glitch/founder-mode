// Regression tests for the code-review fixes.
import {
  ATTACKS,
  acceptTermSheet,
  advanceWeek,
  applyAttackIncoming,
  applyAttackOutgoing,
  newGame,
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

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
