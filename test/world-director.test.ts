// The Narrative Director (brief §24-§27). Its whole job is deciding what deserves attention, so
// the things worth asserting are: the modes weight differently, novelty decays, a quiet week stays
// quiet, and two clients scoring the same week agree.
import {
  ARENA_WEIGHTS, CAREER_WEIGHTS, NOVELTY_MEMORY_WEEKS, QUICK_WEIGHTS, budgetForDepth, directWeek, noveltyOf, scoreCandidate,
  type NarrativeCandidate,
} from '../src/game/world/director'
import { advanceWeek, newGame, resolveChoiceOnState } from '../src/game/engine'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

const cand = (id: string, over: Partial<NarrativeCandidate> = {}): NarrativeCandidate => ({
  id, type: id, category: 'concern', tags: [],
  financialImpact: 0, strategicImpact: 0, relationshipImpact: 0, competitiveImpact: 0,
  urgency: 0, novelty: 0, callbackValue: 0, ...over,
})

console.log('— Modes value different things (brief §25) —')
const people = cand('team', { relationshipImpact: 1 })
const rivals = cand('rivals', { competitiveImpact: 1 })
ok(scoreCandidate(people, CAREER_WEIGHTS) > scoreCandidate(rivals, CAREER_WEIGHTS), 'Career leads with people over rivals')
ok(scoreCandidate(rivals, ARENA_WEIGHTS) > scoreCandidate(people, ARENA_WEIGHTS), 'Arena leads with rivals over people')
const fresh = cand('new', { novelty: 1 })
ok(scoreCandidate(fresh, QUICK_WEIGHTS) > scoreCandidate(fresh, CAREER_WEIGHTS), 'Quick Play prizes novelty more than Career does')

console.log('\n— Novelty decays, it does not vanish (brief §27) —')
ok(noveltyOf('x', 10, {}) === 1, 'a thing that has never happened is maximally novel')
ok(noveltyOf('x', 10, { x: 10 }) === 0, 'the same thing this week is not news')
const mid = noveltyOf('x', 18, { x: 10 })
// Derived from the exported constant rather than from an observed number, so retuning the memory
// window is a source change and not a test edit. `> 0 && < 1` admitted a curve that recovers in one
// week and one that takes a century.
ok(mid === 8 / NOVELTY_MEMORY_WEEKS, `it recovers linearly over the memory window (${mid.toFixed(2)} after 8 of ${NOVELTY_MEMORY_WEEKS} weeks)`)
ok(noveltyOf('x', 40, { x: 10 }) === 1, 'and fully, given long enough')

console.log('\n— Picking the week —')
const budget = budgetForDepth('deep')
ok(budget.major === 1 && budget.secondary === 2, 'Career tells one lead story plus two (brief §26)')
ok(budgetForDepth('light').secondary === 0, 'Quick Play stays fast — lead story only')
// The ordering is the property; the literals above are just today's tuning of it.
ok(
  budgetForDepth('light').secondary < budgetForDepth('competitive').secondary &&
    budgetForDepth('competitive').secondary < budgetForDepth('deep').secondary,
  'and the budget widens with depth: light < competitive < deep',
)

// `lastSeen` is supplied so novelty is genuinely 0. Without it the director fills novelty in as 1
// (never seen), the score lands at 0.11 against a 0.12 floor, and this passed by 0.01 while calling
// the most novel event possible "a quiet week".
const quiet = directWeek([cand('a', { financialImpact: 0.05 })], { week: 5, depth: 'deep', lastSeen: { a: 5 } })
ok(quiet.major === undefined, 'a week where nothing much happened is narrated as nothing')
ok(
  directWeek([cand('a', { financialImpact: 0.05 })], { week: 5, depth: 'deep', lastSeen: { a: 5 }, minScore: 0.005 }).major?.id === 'a',
  'and it is the score FLOOR doing that, not an empty pipeline — drop the floor and the same candidate leads',
)

const busy = directWeek(
  [cand('big', { financialImpact: 1, strategicImpact: 1 }), cand('mid', { relationshipImpact: 0.8 }), cand('small', { urgency: 0.5 })],
  { week: 5, depth: 'deep' },
)
ok(busy.major?.id === 'big', 'the biggest story leads')
// Exact identities, not `<= 2`. The budget makes `<= 2` structurally true, so it also passed when
// `secondary` was empty.
ok(busy.secondary.map((c) => c.id).join(',') === 'mid,small', `and the rest follow in rank order (${busy.secondary.map((c) => c.id).join(',')})`)
const overflowing = directWeek(
  [
    cand('big', { financialImpact: 1, strategicImpact: 1 }),
    cand('mid', { relationshipImpact: 0.8 }),
    cand('small', { urgency: 0.5 }),
    cand('extra', { strategicImpact: 0.9 }),
  ],
  { week: 5, depth: 'deep' },
)
ok(
  overflowing.secondary.length === 2 && !overflowing.secondary.some((c) => c.id === 'small'),
  'a fourth qualifying story is dropped, not squeezed in — the cap actually cuts',
)

const twins = directWeek([cand('a1', { type: 'same', financialImpact: 0.9 }), cand('a2', { type: 'same', financialImpact: 0.8 })], {
  week: 5, depth: 'deep',
})
// Positive assertion: `.every()` over the empty array this produces was true for any implementation,
// including one that never returns a secondary story at all.
ok(twins.secondary.length === 0, 'one story per type per week — two framings of one fact is a stutter')
const mixed = directWeek(
  [cand('a1', { type: 'same', financialImpact: 0.9 }), cand('a2', { type: 'same', financialImpact: 0.8 }), cand('other', { type: 'other', urgency: 0.9 })],
  { week: 5, depth: 'deep' },
)
ok(
  mixed.secondary.map((c) => c.id).join(',') === 'other',
  'and the dedupe is per TYPE, not a blanket drop — a different kind of story still gets told',
)

const order = [cand('z', { urgency: 0.5 }), cand('a', { urgency: 0.5 })]
// Naming the expected winner matters: `?.id === ?.id` was `undefined === undefined` the moment the
// minScore gate filtered both out, and the margin here is 0.055.
ok(
  directWeek(order, { week: 1, depth: 'deep' }).major?.id === 'a' &&
    directWeek([...order].reverse(), { week: 1, depth: 'deep' }).major?.id === 'a',
  'ties break on the lower id, so two clients scoring the same week agree',
)

console.log('\n— In a real run —')
function play(seed: number) {
  let s = newGame('Northwind', 'saas', 'technical', { config: { mode: 'career', format: 'standard', sector: 'saas', seed } as never })
  const titles: string[] = []
  for (let w = 0; w < 60 && !s.gameOver; w++) {
    s.marketingSpend = 3000
    if (s.employees.length + s.offersOut.length + s.pendingHires.length < 4 && s.candidates.length) {
      const b = [...s.candidates].sort((x, y) => y.skill - x.skill)[0]
      s.candidates = s.candidates.filter((c) => c.id !== b.id)
      s.offersOut.push(b)
    }
    const before = new Set(s.inbox.map((m) => m.id))
    s = advanceWeek(s)
    for (const m of s.inbox) if (!before.has(m.id) && s.world?.narrative.emitted[m.id] !== undefined) titles.push(m.title)
    for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && /wants a word/.test(m.title)) resolveChoiceOnState(s, m.id, 0)
  }
  return { s, titles }
}
const { s, titles } = play(4242)
// Guard first. All four assertions below pass on an EMPTY `titles` — `maxRun` is 0, the distinct
// ratio is 0/0, and the determinism check is `"[]" === "[]"`. `titles` only fills when
// `world.narrative.emitted` is keyed by inbox message id, which is exactly the coupling a refactor
// would break, so without this line the file would go quietly green on that regression.
// ≥3, was ≥5 (2026-08-26): the 11-item balance batch (event effect grades, the maturity-scaled
// revenue multiple) legitimately reshaped seed 4242's trajectory and the director had less news
// on it. The regression this line exists for — emitted no longer keyed by inbox id — reads ZERO.
ok(titles.length >= 3, `the director actually narrated the run (${titles.length} headlines in 60 wk)`)
const types = Object.keys(s.world?.narrativeLastSeen ?? {})
ok(types.length >= 3, `the director tells several kinds of story, not one (${types.length}: ${types.join(', ')})`)
let maxRun = titles.length ? 1 : 0
for (let i = 1, run = 1; i < titles.length; i++) {
  if (titles[i] === titles[i - 1]) { run++; maxRun = Math.max(maxRun, run) } else run = 1
}
ok(maxRun <= 1, `never the same headline twice running (longest streak ${maxRun})`)
// "70% of headlines are distinct" was a sample-size lottery, not a property. This run bankrupts
// around week 27–28 and the director's whole output here is 1:1 asks, so the distinct COUNT is
// bounded by the size of the team: it scored 5/7 (0.714) against a 0.7 bar, and any change that
// moved the bankruptcy by a single week flipped it — rival aggression moved it to week 27, the
// week-28 headline vanished, and 4/6 (0.667) failed a test about the narrator by way of the
// economy. Measured over a solvent 60-week variant of the same run it gets WORSE, not better
// (4/15), because a four-person team keeps producing the same four names.
//
// The property actually worth pinning is that the director never gets STUCK on one story. That is
// stable across run length and on both sides of the aggression flag: max share 0.33 here, 0.27
// over 60 weeks, either way. `maxRun <= 1` above covers back-to-back; this covers ABAB.
const headlineCount: Record<string, number> = {}
for (const t of titles) headlineCount[t] = (headlineCount[t] ?? 0) + 1
const topShare = Math.max(0, ...Object.values(headlineCount)) / Math.max(1, titles.length)
ok(topShare <= 0.5, `no single headline dominates what the director said (top share ${topShare.toFixed(2)})`)
ok(
  JSON.stringify(play(4242).titles) === JSON.stringify(titles),
  'the same seed narrates the same week the same way',
)

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
