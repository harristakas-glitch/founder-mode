// The attention register (src/attention.ts) — the one route from the simulation to the player.
// Run: npx tsx test/attention.test.ts
//
// This file exists because the thing it replaces failed SILENTLY. `Dashboard.tsx` ended
// `return out.slice(0, 3)` over push order, so "the board has issued 2 strikes — miss the next
// review and you can be replaced" was discarded by three milder items that happened to be pushed
// first, one of which could be a `good` one. Nothing threw, nothing logged, and the run ended.
//
// So the central case here is not "does the register produce items". It is: **can a severe item
// ever be ranked below a milder one**. Everything else is secondary.
import assert from 'node:assert'

const { attentionRegister, nextBestStep, ATTENTION_TYPES } = await import('../src/attention')
const { newGame } = await import('../src/game/engine')

let passed = 0
const ok = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

type G = ReturnType<typeof newGame>

/** A run that is entirely fine, so each case below turns on exactly one fact. */
const calm = (): G => {
  const g = newGame('Testco', 'saas', 'technical', {})
  g.cash = 5_000_000
  g.lastRevenue = 100_000
  g.energy = 90
  g.employees = []
  g.candidates = []
  g.termSheets = []
  g.rivals = g.rivals.map((r) => ({ ...r, hostileSince: undefined }))
  g.inbox = []
  g.debt = null
  g.board = null
  g.flags = {}
  return g
}

console.log('\n--- 1. a severe item can never rank below a milder one ---\n')

await ok('the register is sorted by severity, always', () => {
  const g = calm()
  // Stack the deck: make several MILD things true and one severe thing true, and make the severe
  // one the LAST thing the builder would push. This is the exact shape of the bug.
  g.candidates = [{ id: 'c1', name: 'Ada', role: 'eng', skill: 9, salary: 180_000, weeksLeft: 1, notice: 2 } as never]
  g.rivals = g.rivals.map((r, i) => (i === 0 ? { ...r, alive: true, hostileSince: 3 } : r))
  g.week = 20
  g.pmf = 5
  g.board = { targetGrowth: 0.05, nextReview: 25, strikes: 2, defied: true }

  const reg = attentionRegister(g)
  const ranks = reg.map((i) => ATTENTION_TYPES.indexOf(i.type))
  assert.deepStrictEqual(ranks, [...ranks].sort((a, b) => a - b), 'register is not in severity order')

  // The specific regression: the board strike must be present AND ahead of the mild items.
  const strike = reg.findIndex((i) => i.id === 'board-strikes')
  const candidate = reg.findIndex((i) => i.id.startsWith('candidate:'))
  assert.ok(strike >= 0, 'the you-can-be-replaced item vanished — this is the original bug')
  assert.ok(candidate >= 0, 'the candidate item vanished')
  assert.ok(strike < candidate, 'a mild opportunity outranked being removed from your own company')
})

await ok('a top-3 truncation by any consumer still keeps the worst thing', () => {
  // The renderer is allowed to show three. The register's contract is that the three it hands over
  // are the three that matter, whatever else is true at the same time.
  const g = calm()
  g.candidates = [{ id: 'c1', name: 'Ada', role: 'eng', skill: 9, salary: 180_000, weeksLeft: 1, notice: 2 } as never]
  g.rivals = g.rivals.map((r, i) => (i === 0 ? { ...r, alive: true, hostileSince: 3 } : r))
  g.week = 20
  g.pmf = 5
  g.cash = 1000
  g.lastRevenue = 0
  g.debt = { principal: 200_000, apr: 0.12, covenantRevenue: 50_000 }

  const reg = attentionRegister(g)
  const top3 = reg.slice(0, 3)
  assert.ok(
    top3.some((i) => i.id === 'covenant'),
    'losing 15% of the company was sliced away by softer items',
  )
  // The precise claim: EVERY urgent item that exists survives the cut, up to the three slots. Not
  // "all three are urgent" — a run can have two urgent facts and a mild third, and filling the
  // third slot with the mild one is correct.
  const urgent = reg.filter((i) => i.type === 'urgent')
  const kept = top3.filter((i) => i.type === 'urgent').length
  assert.strictEqual(kept, Math.min(3, urgent.length), 'an urgent item lost its slot to a milder one')
})

console.log('\n--- 2. six events that previously had no route to the player ---\n')

await ok('a covenant breach reaches the player at all', () => {
  const g = calm()
  g.debt = { principal: 200_000, apr: 0.12, covenantRevenue: 50_000 }
  g.lastRevenue = 40_000
  const item = attentionRegister(g).find((i) => i.id === 'covenant')
  assert.ok(item, 'no covenant item')
  assert.strictEqual(item!.type, 'urgent')
  assert.match(item!.detail!, /converts debt to equity/)
})

await ok('the named person about to quit is found — where an average could not see them', () => {
  const g = calm()
  // The exact case the old `avgMorale < 45` item was blind to: one person at 20, seven at 75.
  g.employees = [
    { id: 'e1', name: 'Mira', role: 'eng', skill: 7, salary: 150_000, morale: 20, weeks: 30 },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: `e${i + 2}`, name: `P${i}`, role: 'eng', skill: 5, salary: 120_000, morale: 75, weeks: 10,
    })),
  ] as never
  const avg = (g.employees as { morale: number }[]).reduce((n, e) => n + e.morale, 0) / g.employees.length
  assert.ok(avg > 45, 'the fixture is wrong — the average must be ABOVE the old threshold')

  const item = attentionRegister(g).find((i) => i.id.startsWith('resign:'))
  assert.ok(item, 'the person about to quit is invisible')
  assert.match(item!.title, /Mira/, 'the item does not name them')
})

await ok('a mercenary is flagged at a much higher morale than anyone else', () => {
  const g = calm()
  g.employees = [{ id: 'e1', name: 'Sol', role: 'sales', skill: 8, salary: 200_000, morale: 50, weeks: 12, trait: 'mercenary' }] as never
  assert.ok(attentionRegister(g).some((i) => i.id === 'resign:e1'), 'morale 50 mercenary not flagged')

  const g2 = calm()
  g2.employees = [{ id: 'e1', name: 'Sol', role: 'sales', skill: 8, salary: 200_000, morale: 50, weeks: 12 }] as never
  assert.ok(!attentionRegister(g2).some((i) => i.id === 'resign:e1'), 'morale 50 non-mercenary wrongly flagged')
})

await ok('founder burnout is visible before it happens, not after', () => {
  const g = calm()
  g.energy = 6
  const item = attentionRegister(g).find((i) => i.id === 'energy')
  assert.ok(item, 'burnout has no route to the player')
  assert.strictEqual(item!.type, 'urgent')
})

await ok('a price war and a hostile rival both surface', () => {
  const g = calm()
  g.flags = { priceWar: 3 }
  assert.ok(attentionRegister(g).some((i) => i.id === 'price-war'))

  const g2 = calm()
  g2.rivals = g2.rivals.map((r, i) => (i === 0 ? { ...r, alive: true, hostileSince: 4 } : r))
  const hostile = attentionRegister(g2).find((i) => i.id === 'hostile')
  assert.ok(hostile, 'a rival coming for your users is invisible')
  assert.match(hostile!.title, /\w/, 'the hostile item does not name the rival')
})

await ok('a candidate walking this week surfaces, and the best one is chosen', () => {
  const g = calm()
  g.candidates = [
    { id: 'c1', name: 'Weak', role: 'eng', skill: 3, salary: 100_000, weeksLeft: 1, notice: 2 },
    { id: 'c2', name: 'Strong', role: 'eng', skill: 9, salary: 200_000, weeksLeft: 1, notice: 2 },
    { id: 'c3', name: 'NotLeaving', role: 'eng', skill: 10, salary: 200_000, weeksLeft: 6, notice: 2 },
  ] as never
  const item = attentionRegister(g).find((i) => i.id.startsWith('candidate:'))
  assert.ok(item, 'an expiring candidate is invisible')
  assert.match(item!.title, /Strong/, 'the weaker or the non-expiring candidate was chosen')
})

console.log('\n--- 3. every item names the thing, never the count ---\n')

await ok('a blocking decision is announced by NAME, not as "1 decision"', () => {
  const g = calm()
  g.inbox = [{ id: 'm1', week: 3, kind: 'choice', title: 'The accelerator wants 7% for $120k', body: '', resolved: false }] as never
  const item = attentionRegister(g).find((i) => i.id.startsWith('decision:'))
  assert.ok(item)
  assert.strictEqual(item!.title, 'The accelerator wants 7% for $120k')
  assert.ok(!/^\d+ decision/i.test(item!.title), 'the title is a count, which is announced four times already')
})

await ok('no title is a bare count', () => {
  const g = calm()
  g.cash = 1000
  g.lastRevenue = 0
  g.energy = 4
  g.inbox = [
    { id: 'm1', week: 3, kind: 'choice', title: 'Sign with Meridian?', body: '', resolved: false },
    { id: 'm2', week: 3, kind: 'choice', title: 'Second thing', body: '', resolved: false },
  ] as never
  for (const i of attentionRegister(g)) {
    assert.ok(!/^\s*\d+\s+(decision|item|thing)/i.test(i.title), `"${i.title}" is a count, not a name`)
  }
})

console.log('\n--- 4. purity: this may never touch the simulation ---\n')

await ok('calling the register does not mutate the state it is given', () => {
  const g = calm()
  g.cash = 1000
  g.lastRevenue = 0
  g.energy = 4
  g.debt = { principal: 200_000, apr: 0.12, covenantRevenue: 50_000 }
  g.employees = [{ id: 'e1', name: 'Mira', role: 'eng', skill: 7, salary: 150_000, morale: 10, weeks: 30 }] as never
  g.candidates = [{ id: 'c1', name: 'Ada', role: 'eng', skill: 9, salary: 180_000, weeksLeft: 1, notice: 2 }] as never

  const before = JSON.stringify(g)
  attentionRegister(g)
  nextBestStep(g)
  assert.strictEqual(JSON.stringify(g), before, 'the register mutated the game state')
})

await ok('sorting does not reorder the caller\'s arrays', () => {
  // `.sort()` is in-place. Sorting `game.employees` or `game.candidates` directly would reorder
  // the SIMULATION's arrays from a render, which is how a presentation layer breaks determinism.
  const g = calm()
  g.employees = [
    { id: 'a', name: 'A', role: 'eng', skill: 5, salary: 1, morale: 10, weeks: 1 },
    { id: 'b', name: 'B', role: 'eng', skill: 5, salary: 1, morale: 5, weeks: 1 },
  ] as never
  g.candidates = [
    { id: 'x', name: 'X', role: 'eng', skill: 1, salary: 1, weeksLeft: 1, notice: 1 },
    { id: 'y', name: 'Y', role: 'eng', skill: 9, salary: 1, weeksLeft: 1, notice: 1 },
  ] as never
  g.termSheets = [
    { id: 's1', investor: 'Late', amount: 1, equity: 0.1, weeksLeft: 9 },
    { id: 's2', investor: 'Soon', amount: 1, equity: 0.1, weeksLeft: 1 },
  ] as never

  const empIds = (g.employees as { id: string }[]).map((e) => e.id)
  const canIds = (g.candidates as { id: string }[]).map((c) => c.id)
  const shtIds = (g.termSheets as { id: string }[]).map((s) => s.id)
  attentionRegister(g)
  assert.deepStrictEqual((g.employees as { id: string }[]).map((e) => e.id), empIds, 'employees were reordered in place')
  assert.deepStrictEqual((g.candidates as { id: string }[]).map((c) => c.id), canIds, 'candidates were reordered in place')
  assert.deepStrictEqual((g.termSheets as { id: string }[]).map((s) => s.id), shtIds, 'termSheets were reordered in place')
})

console.log('\n--- 5. one recommendation, not five ---\n')

await ok('nextBestStep returns exactly one item, and it is the most severe', () => {
  const g = calm()
  g.cash = 1000
  g.lastRevenue = 0
  g.energy = 4
  g.candidates = [{ id: 'c1', name: 'Ada', role: 'eng', skill: 9, salary: 180_000, weeksLeft: 1, notice: 2 }] as never

  const step = nextBestStep(g)
  const reg = attentionRegister(g)
  assert.ok(step, 'no recommendation when several things are wrong')
  assert.strictEqual(step!.id, reg[0].id, 'the recommendation is not the top of the register')
  assert.ok(reg.length > 1, 'the fixture should produce several items')
})

await ok('a calm run recommends nothing at all', () => {
  // "Quiet when nothing needs attention." A recommendation engine that always has a suggestion is
  // a nag, and the player stops reading it.
  assert.strictEqual(nextBestStep(calm()), null, 'invented a recommendation for a healthy run')
  assert.deepStrictEqual(attentionRegister(calm()), [], 'a calm run produced attention items')
})

// ---- PMF decay: the slide the game used to watch in silence -------------------------------------
// Owner report 2026-08-22: "when I reached 60+ PMF it started dropping, didn't know how to fix it."
// Measured cause: only the retention term falls, and it falls because bugs accumulate. The absolute
// pace check never fires on a decaying-but-decent score, so nothing spoke. Both halves are asserted
// here — it fires on the real slide, and it stays silent on a healthy run and on the legitimate dip
// that happens when a segment crosses the customer floor.
const withHistory = (pmfByWeek: number[], users: number): G => {
  const g = calm()
  g.history = pmfByWeek.map((pmf, i) => ({
    week: i + 1, cash: 1_000_000, users, revenue: 5_000, expenses: 5_000, payroll: 3_000,
    marketing: 1_000, office: 500, infra: 500, valuation: 5_000_000, pmf,
  }))
  g.pmf = pmfByWeek[pmfByWeek.length - 1]
  g.week = pmfByWeek.length
  return g
}
ok('a slow slide off the peak is finally named', () => {
  // 68 down to 60 over 30 weeks — one point per ~4 weeks, exactly the invisible kind
  const decaying = Array.from({ length: 30 }, (_, i) => Math.round(68 - i * 0.27))
  const item = attentionRegister(withHistory(decaying, 400)).find((i) => i.id === 'pmf-decay')
  assert.ok(item, 'the decay went unreported')
  assert.match(item!.title, /fallen \d+ points from its peak of 68/, `title was: ${item!.title}`)
})
ok('...and a healthy run that holds its peak is NOT nagged', () => {
  const healthy = Array.from({ length: 30 }, (_, i) => (i < 20 ? 60 + i * 0.4 : 68))
  assert.ok(!attentionRegister(withHistory(healthy, 400)).some((i) => i.id === 'pmf-decay'), 'nagged a healthy run')
})
ok('...nor is a run whose only "peak" predates having customers to measure', () => {
  // Below the customer floor the score is research-derived and capped ~40; crossing the floor
  // legitimately REPLACES it with an honest, lower number. That is correct play, not decay.
  const g = withHistory([38, 38, 39, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30], 4)
  assert.ok(!attentionRegister(g).some((i) => i.id === 'pmf-decay'), 'fired on a sub-floor company')
})
ok('the bug warning now trips where the damage actually starts, not at 55', () => {
  const g = calm()
  g.bugs = 30 // ~13% of four-week retention already gone; the old bar was 55
  const item = attentionRegister(g).find((i) => i.id === 'bugs')
  assert.ok(item, 'bugs at 30 went unreported')
  assert.match(item!.detail ?? '', /% of your four-week retention/, 'the cost is not quantified')
  const quiet = calm()
  quiet.bugs = 12 // a normal working backlog must stay silent
  assert.ok(!attentionRegister(quiet).some((i) => i.id === 'bugs'), 'nagged about an ordinary bug backlog')
})

console.log(`\n${passed} assertions passed\n`)
