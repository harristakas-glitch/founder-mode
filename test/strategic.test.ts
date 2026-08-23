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

console.log('— Big Bets (brief §7): progress only from aligned execution —')
{
  const { alignmentWord, initiativeAlignment, BIG_BETS } = await import('../src/game/strategic/bigbets')
  // alignment reads the content honestly
  const aSSO = initiativeAlignment('enterprise_readiness', 'saas', 'saas-sso')
  const aRef = initiativeAlignment('enterprise_readiness', 'saas', 'saas-onboarding-redesign')
  ok(aSSO > aRef, `SSO aligns with Enterprise Readiness more than a consumer onboarding item (${aSSO.toFixed(2)} vs ${aRef.toFixed(2)})`)
  ok(alignmentWord(initiativeAlignment('consumer_viral_engine', 'social', 'social-referral-loop')) === 'strongly_supports', 'a referral loop strongly supports the viral engine')
  ok(BIG_BETS.length === 6, 'six archetypes')

  // same seed, two twins: one declares a bet and DOES aligned work; one declares and does nothing
  let doer = newGame('B', 'saas', 'technical', { config: cfg({ seed: 55 }) })
  let talker = newGame('B', 'saas', 'technical', { config: cfg({ seed: 55 }) })
  doer = applyJournaled(doer, 'bet_choose', { t: 'consumer_viral_engine' }).state
  talker = applyJournaled(talker, 'bet_choose', { t: 'consumer_viral_engine' }).state
  doer = applyJournaled(doer, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state // growth/acquisition-weighted → aligned
  for (let i = 0; i < 8; i++) {
    doer = advanceWeek(doer)
    talker = advanceWeek(talker)
  }
  ok(doer.bigBet!.progress > 5, `aligned execution advances the bet (${doer.bigBet!.progress.toFixed(1)}%)`)
  ok(talker.bigBet!.progress === 0, 'declaring without executing advances NOTHING (§7.11)')

  // contradictory work is legal and simply does not advance the bet
  let rebel = newGame('B', 'saas', 'technical', { config: cfg({ seed: 55 }) })
  rebel = applyJournaled(rebel, 'bet_choose', { t: 'enterprise_readiness' }).state
  rebel = applyJournaled(rebel, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state // freelancer item vs enterprise bet
  for (let i = 0; i < 8; i++) rebel = advanceWeek(rebel)
  ok(rebel.roadmap!.active.length + rebel.roadmap!.done.length > 0, 'contradictory work is legal (§7.8)')
  ok(rebel.bigBet!.progress < doer.bigBet!.progress, 'but it advances the bet less than aligned work')

  // a light-depth bet with steady aligned work COMPLETES — and the edge is permanent
  ok(doer.bigBet!.status === 'completed', 'the executed light bet completes inside its window')
  ok(strategicModifiers(doer).acquisitionEff > strategicModifiers(talker).acquisitionEff, 'completion leaves a standing edge (§7.13)')

  // abandonment: shadow then recovery — on a bet still in flight
  let quitter = structuredClone(rebel) // enterprise bet, misaligned work, still active
  ok(quitter.bigBet!.status === 'active', '(fixture: the rebel bet is still active)')
  quitter = applyJournaled(quitter, 'bet_abandon').state
  ok(quitter.bigBet!.status === 'abandoned' && quitter.bigBet!.abandonedWeek === quitter.week, 'abandonment records its week')
  const shadow = strategicModifiers(quitter)
  ok(shadow.buildVelocity < 1, 'three weeks of strategic confusion follow abandonment')
  const later = structuredClone(quitter)
  later.week += 4
  ok(strategicModifiers(later).buildVelocity >= shadow.buildVelocity, 'and the shadow fades')

  // one bet at a time — against an ACTIVE bet; a settled one may be replaced
  let holder = newGame('B', 'saas', 'technical', { config: cfg({ seed: 56 }) })
  holder = applyJournaled(holder, 'bet_choose', { t: 'platform_play' }).state
  const again = applyJournaled(holder, 'bet_choose', { t: 'margin_expansion' }).state
  ok(again.bigBet!.type === 'platform_play', 'a second bet cannot displace an active one')
  ok(applyJournaled(doer, 'bet_choose', { t: 'platform_play' }).state.bigBet!.type === 'platform_play', 'a COMPLETED bet frees the seat for the next chapter')

  // synergy is bounded: the boost constant itself is small
  const { BIG_BET_SYNERGY } = await import('../src/game/strategic/bigbets')
  ok(BIG_BET_SYNERGY <= 0.15, 'synergy is a bounded nudge, not a doubling')
}

console.log('— Growth Engine (CRO + marketing mix brief) —')
{
  const { tickBrand, brandWord, brandCacRelief, mixAlignment, BRAND_LAG_WEEKS } = await import('../src/game/strategic/growth.js')
  const { estimatedCac } = await import('../src/game/engine.js')

  // brand is LAGGED: spend now, nothing this week, the stock appears BRAND_LAG_WEEKS later
  let b = newGame('G', 'saas', 'technical', { config: cfg({ seed: 71 }) })
  b.growth = { performanceShare: 0.5, lastMixWeek: 0, brand: { stock: 0, pending: [] } }
  tickBrand(b, 5000)
  ok(b.growth.brand.stock === 0 && b.growth.brand.pending.length === 1, 'brand spend produces NOTHING immediately (§24)')
  b.week += BRAND_LAG_WEEKS
  tickBrand(b, 0)
  ok(b.growth.brand.stock > 0, `the investment matures ${BRAND_LAG_WEEKS} weeks later (stock ${b.growth.brand.stock.toFixed(2)})`)

  // decay: an unfed brand fades
  const fed = b.growth.brand.stock
  for (let i = 0; i < 10; i++) { b.week += 1; tickBrand(b, 0) }
  ok(b.growth.brand.stock < fed, 'an unfed brand decays (§25)')

  // brand→performance synergy: a strong brand lowers CAC, bounded
  const plain = newGame('G', 'saas', 'technical', { config: cfg({ seed: 71 }) })
  const branded = structuredClone(plain)
  branded.growth = { performanceShare: 1, lastMixWeek: 0, brand: { stock: 80, pending: [] } }
  ok(estimatedCac(branded) < estimatedCac(plain), 'a strong brand buys cheaper paid acquisition (§27)')
  ok(brandCacRelief(branded) <= 0.12, 'and the relief is capped at 12%')
  ok(brandWord(80) === 'Category leader' && brandWord(0) === 'Unknown', 'brand speaks in words, not decimals')

  // sustained investment plateaus — no infinite compounding
  let s2 = newGame('G', 'saas', 'technical', { config: cfg({ seed: 72 }) })
  s2.growth = { performanceShare: 0.4, lastMixWeek: 0, brand: { stock: 0, pending: [] } }
  for (let i = 0; i < 200; i++) { s2.week += 1; tickBrand(s2, 5000) }
  ok(s2.growth.brand.stock < 60, `sustained 5k/wk plateaus below Strong-Category-leader (${s2.growth.brand.stock.toFixed(1)}) — no runaway`)

  // CRO is PMF-ceilinged: the same shipped CRO item lifts conversion less at weak fit
  const lowFit = newGame('G', 'saas', 'technical', { config: cfg({ seed: 73 }) })
  lowFit.roadmap = { active: [], queued: [], done: [{ id: 'saas-signup-friction', week: 1 }], debt: 0 }
  lowFit.pmf = 15
  const highFit = structuredClone(lowFit)
  highFit.pmf = 85
  ok(strategicModifiers(highFit).conversionLift > strategicModifiers(lowFit).conversionLift, 'CRO cannot outrun weak PMF (§9)')
  ok(strategicModifiers(highFit).conversionLift <= 1.18, 'conversion lift is capped')

  // the default mix IS the old game — splitting is a choice
  const untouched = newGame('G', 'saas', 'technical', { config: cfg({ seed: 74 }) })
  ok((untouched.growth?.performanceShare ?? 1) === 1, 'default: 100% performance — the system is inert until touched')

  // mix ↔ bet alignment words
  ok(mixAlignment('enterprise_readiness', 0.6) === 'supports', 'a 40% brand mix supports the enterprise push')
  ok(mixAlignment('consumer_viral_engine', 0.2) === 'competes', 'an 80% brand mix competes with the viral engine')

  // journaled mix replays
  let mixer = newGame('G', 'saas', 'technical', { config: cfg({ seed: 75 }) })
  mixer = applyJournaled(mixer, 'growth_mix', { v: 0.6 }).state
  for (let i = 0; i < 3; i++) mixer = advanceWeek(mixer)
  const replayedMix = replayRun(
    { name: 'G', sector: 'saas', founderKind: 'technical', config: cfg({ seed: 75 }) } as never,
    [{ a: 'growth_mix', w: 1, p: { v: 0.6 } }, { a: 'advance', w: 0 }, { a: 'advance', w: 0 }, { a: 'advance', w: 0 }] as never,
  )
  ok(replayedMix.growth!.brand.pending.length === mixer.growth!.brand.pending.length && replayedMix.cash === mixer.cash, 'a journaled mix change replays identically')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)