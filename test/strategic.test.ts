// Strategic Systems Expansion — phase 1 (Product Roadmap + effects foundation).
// Run: npx tsx test/strategic.test.ts
import { advanceWeek, newGame } from '../src/game/engine'
import { applyJournaled, replayRun } from '../src/game/replay'
import { systemDepth } from '../src/game/modes'
import { composeBonus, strategicModifiers } from '../src/game/strategic/effects'
import { ROADMAP_POOLS, roadmapDef, roadmapPool } from '../src/game/strategic/content'
import { availableInitiatives, effortRequired, startInitiative, tickRoadmap } from '../src/game/strategic/roadmap'
import type { GameConfig } from '../src/game/modes'
import type { GameState } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}
const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ mode: 'quick', format: 'standard', sector: 'saas', seed: 11, ...over })

console.log('— Depth model (brief §3) —')
const quick = newGame('Q', 'saas', 'technical', { config: cfg() })
const career = newGame('C', 'saas', 'technical', { config: cfg({ mode: 'career' }) })
const arena = newGame('A', 'saas', 'technical', { config: cfg({ mode: 'arena' }) })
ok(systemDepth(quick, 'roadmap') === 'light' && systemDepth(career, 'roadmap') === 'deep' && systemDepth(arena, 'roadmap') === 'competitive', 'roadmap: light / deep / competitive by mode')
ok(systemDepth(arena, 'founderAttention') === 'off' && systemDepth(arena, 'boardMeetings') === 'off', 'arena: attention and board meetings are OFF (the brief is explicit)')
ok(systemDepth(quick, 'bigBets') === 'light' && systemDepth(career, 'bigBets') === 'deep', 'big bets exist in every mode at the right depth')

console.log('— Content pools (brief §6.4) —')
for (const [sector, pool] of Object.entries(ROADMAP_POOLS)) {
  const budgets = pool.map((i) => Object.values(i.impact).reduce((a, b) => a + (b ?? 0), 0))
  ok(pool.length >= 9, `${sector}: at least nine initiatives (${pool.length})`)
  ok(budgets.every((b) => b >= 1 && b <= 6), `${sector}: every impact budget within 1..6`)
  ok(pool.filter((i) => i.type === 'technical_debt').length === 1, `${sector}: exactly one pay-down-the-debt item`)
  ok(pool.filter((i) => i.quickPool).length >= 3, `${sector}: a quick pool exists`)
  ok(new Set(pool.map((i) => i.id)).size === pool.length, `${sector}: ids unique`)
}

console.log('— Depth gates the pool (brief §3.1) —')
const quickPool = availableInitiatives(quick, 'light')
const deepPool = availableInitiatives(career, 'deep')
ok(quickPool.every((i) => i.quickPool), 'quick sees only the iconic pool')
ok(deepPool.length > quickPool.length, `deep sees more (${deepPool.length} vs ${quickPool.length})`)
ok(deepPool.every((i) => !i.lateStage), 'pre-seed hides late-stage items even at deep')

console.log('— The tradeoff is physical (brief §1.1/§6.7) —')
// same seed, one run starts an initiative, the other doesn't — the builder ships less product
let ctrl = newGame('T', 'saas', 'technical', { config: cfg({ seed: 21 }) })
let bldr = newGame('T', 'saas', 'technical', { config: cfg({ seed: 21 }) })
bldr = applyJournaled(bldr, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state
for (let i = 0; i < 4; i++) {
  ctrl = advanceWeek(ctrl)
  bldr = advanceWeek(bldr)
}
ok(bldr.roadmap!.active.length === 1 && bldr.roadmap!.active[0].progress > 0, 'the initiative is in flight and progressing')
ok(bldr.features < ctrl.features, `roadmap work draws real build output (features ${bldr.features.toFixed(2)} < ${ctrl.features.toFixed(2)})`)

console.log('— Completion changes the company (brief §6.13) —')
let run = newGame('T', 'saas', 'technical', { config: cfg({ seed: 33 }) })
run = applyJournaled(run, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state
let completedWeek = 0
for (let i = 0; i < 40 && !completedWeek; i++) {
  run = advanceWeek(run)
  if (run.roadmap!.done.some((d) => d.id === 'saas-onboarding-redesign')) completedWeek = run.week
}
ok(completedWeek > 0, `onboarding redesign completes (week ${completedWeek})`)
ok(run.inbox.some((m) => m.title.includes('Shipped: Onboarding Redesign')), 'completion announces itself in the inbox')
const modsAfter = strategicModifiers(run)
ok(modsAfter.acquisitionEff > 1, `a shipped acquisition item leaves a standing effect (${modsAfter.acquisitionEff.toFixed(3)})`)
ok(run.roadmap!.active.length === 0, 'the slot is free again')

console.log('— Effects are capped (brief §21–§22) —')
ok(composeBonus([0.5, 0.5, 0.5], 0.35) <= 1.35 + 1e-9, 'composeBonus hard-caps upward')
ok(composeBonus([-0.5, -0.5], 0.35) >= 0.65 - 1e-9, 'and downward')
// a company that shipped EVERYTHING stays inside every cap
const maxed: GameState = structuredClone(run)
maxed.roadmap!.done = roadmapPool('saas').map((i) => ({ id: i.id, week: 1 }))
maxed.roadmap!.debt = 0
const m = strategicModifiers(maxed)
ok(m.buildVelocity <= 1.35 && m.acquisitionEff <= 1.2 && m.arpuMult <= 1.12, `everything shipped stays capped (build ${m.buildVelocity.toFixed(2)}, acq ${m.acquisitionEff.toFixed(2)}, arpu ${m.arpuMult.toFixed(2)})`)
ok(m.opexMult >= 0.8 && m.churnRelief >= 0.85, 'discounts are floored')
maxed.roadmap!.debt = 100
const md = strategicModifiers(maxed)
ok(md.buildVelocity < m.buildVelocity && md.bugPressure > 1, 'max debt drags velocity and feeds bugs')

console.log('— Segment relevance (brief §6.5) —')
const sso = roadmapDef('saas', 'saas-sso')!
ok((sso.segmentImpact.enterprise ?? 0) > 1.2 && (sso.segmentImpact.freelancers ?? 1) < 0.5, 'SSO is an enterprise item, not a freelancer one')

console.log('— Replay integrity —')
const header = { name: 'T', sector: 'saas' as const, founderKind: 'technical' as const, config: cfg({ seed: 21 }) }
const journal = [
  { a: 'roadmap_start' as const, w: 1, p: { id: 'saas-onboarding-redesign' } },
  ...Array.from({ length: 4 }, () => ({ a: 'advance' as const, w: 0 })),
]
const replayed = replayRun(header as never, journal as never)
ok(replayed.features === bldr.features && replayed.roadmap!.active[0]?.progress === bldr.roadmap!.active[0]?.progress, 'a journaled roadmap run replays byte-identically')

console.log('— Direct engine API stays deterministic —')
const g1: GameState = structuredClone(quick)
const g2: GameState = structuredClone(quick)
startInitiative(g1, 'saas-integrations', 'light')
startInitiative(g2, 'saas-integrations', 'light')
tickRoadmap(g1, 10, 1)
tickRoadmap(g2, 10, 1)
ok(g1.roadmap!.active[0].progress === g2.roadmap!.active[0].progress, 'tickRoadmap is pure in, pure out')
ok(effortRequired(roadmapDef('saas', 'saas-integrations')!, 'deep') === 30 && effortRequired(roadmapDef('saas', 'saas-integrations')!, 'light') === 12.5, 'effort = weeks × depth-scaled reference velocity')

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)