// The Narrative Director (brief §24-§27). Its whole job is deciding what deserves attention, so
// the things worth asserting are: the modes weight differently, novelty decays, a quiet week stays
// quiet, and two clients scoring the same week agree.
import {
  ARENA_WEIGHTS, CAREER_WEIGHTS, QUICK_WEIGHTS, budgetForDepth, directWeek, noveltyOf, scoreCandidate,
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
ok(mid > 0 && mid < 1, `it recovers gradually (${mid.toFixed(2)} after 8 weeks)`)
ok(noveltyOf('x', 40, { x: 10 }) === 1, 'and fully, given long enough')

console.log('\n— Picking the week —')
const budget = budgetForDepth('deep')
ok(budget.major === 1 && budget.secondary === 2, 'Career tells one lead story plus two (brief §26)')
ok(budgetForDepth('light').secondary === 0, 'Quick Play stays fast — lead story only')

const quiet = directWeek([cand('a', { financialImpact: 0.05 })], { week: 5, depth: 'deep' })
ok(quiet.major === undefined, 'a week where nothing much happened is narrated as nothing')

const busy = directWeek(
  [cand('big', { financialImpact: 1, strategicImpact: 1 }), cand('mid', { relationshipImpact: 0.8 }), cand('small', { urgency: 0.5 })],
  { week: 5, depth: 'deep' },
)
ok(busy.major?.id === 'big', 'the biggest story leads')
ok(busy.secondary.length <= 2, 'and the rest are capped by the mode budget')

const twins = directWeek([cand('a1', { type: 'same', financialImpact: 0.9 }), cand('a2', { type: 'same', financialImpact: 0.8 })], {
  week: 5, depth: 'deep',
})
ok(twins.secondary.every((c) => c.type !== twins.major?.type), 'one story per type per week — two framings of one fact is a stutter')

const order = [cand('z', { urgency: 0.5 }), cand('a', { urgency: 0.5 })]
ok(
  directWeek(order, { week: 1, depth: 'deep' }).major?.id === directWeek([...order].reverse(), { week: 1, depth: 'deep' }).major?.id,
  'ties break on id, so two clients scoring the same week agree',
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
const types = Object.keys(s.world?.narrativeLastSeen ?? {})
ok(types.length >= 3, `the director tells several kinds of story, not one (${types.length}: ${types.join(', ')})`)
let maxRun = titles.length ? 1 : 0
for (let i = 1, run = 1; i < titles.length; i++) {
  if (titles[i] === titles[i - 1]) { run++; maxRun = Math.max(maxRun, run) } else run = 1
}
ok(maxRun <= 1, `never the same headline twice running (longest streak ${maxRun})`)
ok(new Set(titles).size >= titles.length * 0.7, `most headlines are distinct (${new Set(titles).size}/${titles.length})`)
ok(
  JSON.stringify(play(4242).titles) === JSON.stringify(titles),
  'the same seed narrates the same week the same way',
)

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
