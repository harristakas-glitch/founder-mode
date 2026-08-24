// Strategic Systems Expansion — phase 1 (Product Roadmap + effects foundation).
// Run: npx tsx test/strategic.test.ts
import { advanceWeek, newGame } from '../src/game/engine'
import { applyJournaled, replayRun } from '../src/game/replay'
import { systemDepth } from '../src/game/modes'
import { composeBonus, strategicModifiers } from '../src/game/strategic/effects'
import { ROADMAP_POOLS, roadmapDef, roadmapPool } from '../src/game/strategic/content'
import { availableInitiatives, effortRequired, startInitiative, tickRoadmap } from '../src/game/strategic/roadmap'
import { ATTENTION_BUDGET, attentionEngagement, attentionShortfalls, effectiveAllocation } from '../src/game/strategic/attention'
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
// Owner simplification (2026-08-23): roadmap, big bets and the growth mix are SIMULATION-ONLY
// for now — quick and arena run the classic engine. The light/competitive machinery stays
// behind the depth switches, tested below through explicit depth arguments.
ok(systemDepth(quick, 'roadmap') === 'off' && systemDepth(arena, 'roadmap') === 'off' && systemDepth(career, 'roadmap') === 'deep', 'roadmap: simulation-only (quick and arena off)')
ok(systemDepth(quick, 'bigBets') === 'off' && systemDepth(arena, 'bigBets') === 'off' && systemDepth(career, 'bigBets') === 'deep', 'big bets: simulation-only')
ok(systemDepth(quick, 'growthMix') === 'off' && systemDepth(arena, 'growthMix') === 'off' && systemDepth(career, 'growthMix') === 'deep', 'growth mix: simulation-only')
ok(systemDepth(arena, 'founderAttention') === 'off' && systemDepth(arena, 'boardMeetings') === 'off', 'arena: attention and board meetings are OFF (the brief is explicit)')
ok(systemDepth(quick, 'founderAttention') === 'light', 'quick keeps the light Founder Focus')

console.log('— The removal is exact: strategic journals are inert in quick and arena —')
for (const g0 of [quick, arena]) {
  const mode = g0.config!.mode
  let g = structuredClone(g0)
  g = applyJournaled(g, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state
  g = applyJournaled(g, 'bet_choose', { t: 'consumer_viral_engine' }).state
  g = applyJournaled(g, 'growth_mix', { v: 0.3 }).state
  ok(g.roadmap!.active.length === 0 && !g.bigBet && (g.growth?.performanceShare ?? 1) === 1, `${mode}: roadmap/bet/mix journals all no-op`)
}

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
let ctrl = newGame('T', 'saas', 'technical', { config: cfg({ seed: 21, mode: 'career' }) })
let bldr = newGame('T', 'saas', 'technical', { config: cfg({ seed: 21, mode: 'career' }) })
bldr = applyJournaled(bldr, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state
for (let i = 0; i < 4; i++) {
  ctrl = advanceWeek(ctrl)
  bldr = advanceWeek(bldr)
}
ok(bldr.roadmap!.active.length === 1 && bldr.roadmap!.active[0].progress > 0, 'the initiative is in flight and progressing')
ok(bldr.features < ctrl.features, `roadmap work draws real build output (features ${bldr.features.toFixed(2)} < ${ctrl.features.toFixed(2)})`)

console.log('— Completion changes the company (brief §6.13) —')
let run = newGame('T', 'saas', 'technical', { config: cfg({ seed: 33, mode: 'career' }) })
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
const header = { name: 'T', sector: 'saas' as const, founderKind: 'technical' as const, config: cfg({ seed: 21, mode: 'career' }) }
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
  let doer = newGame('B', 'saas', 'technical', { config: cfg({ seed: 55, mode: 'career' }) })
  let talker = newGame('B', 'saas', 'technical', { config: cfg({ seed: 55, mode: 'career' }) })
  doer = applyJournaled(doer, 'bet_choose', { t: 'consumer_viral_engine' }).state
  talker = applyJournaled(talker, 'bet_choose', { t: 'consumer_viral_engine' }).state
  doer = applyJournaled(doer, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state // growth/acquisition-weighted → aligned
  for (let i = 0; i < 22; i++) {
    doer = advanceWeek(doer)
    talker = advanceWeek(talker)
  }
  ok(doer.bigBet!.progress > 5, `aligned execution advances the bet (${doer.bigBet!.progress.toFixed(1)}%)`)
  ok(talker.bigBet!.progress === 0, 'declaring without executing advances NOTHING (§7.11)')

  // contradictory work is legal and simply does not advance the bet
  let rebel = newGame('B', 'saas', 'technical', { config: cfg({ seed: 55, mode: 'career' }) })
  rebel = applyJournaled(rebel, 'bet_choose', { t: 'enterprise_readiness' }).state
  rebel = applyJournaled(rebel, 'roadmap_start', { id: 'saas-onboarding-redesign' }).state // freelancer item vs enterprise bet
  for (let i = 0; i < 22; i++) rebel = advanceWeek(rebel)
  ok(rebel.roadmap!.active.length + rebel.roadmap!.done.length > 0, 'contradictory work is legal (§7.8)')
  ok(rebel.bigBet!.progress < doer.bigBet!.progress, 'but it advances the bet less than aligned work')

  // a deep bet with steady aligned work COMPLETES — and the edge is permanent
  ok(doer.bigBet!.status === 'completed', 'the executed bet completes with sustained aligned work')
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
  let holder = newGame('B', 'saas', 'technical', { config: cfg({ seed: 56, mode: 'career' }) })
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
  let mixer = newGame('G', 'saas', 'technical', { config: cfg({ seed: 75, mode: 'career' }) })
  mixer = applyJournaled(mixer, 'growth_mix', { v: 0.6 }).state
  for (let i = 0; i < 3; i++) mixer = advanceWeek(mixer)
  const replayedMix = replayRun(
    { name: 'G', sector: 'saas', founderKind: 'technical', config: cfg({ seed: 75, mode: 'career' }) } as never,
    [{ a: 'growth_mix', w: 1, p: { v: 0.6 } }, { a: 'advance', w: 0 }, { a: 'advance', w: 0 }, { a: 'advance', w: 0 }] as never,
  )
  ok(replayedMix.growth!.brand.pending.length === mixer.growth!.brand.pending.length && replayedMix.cash === mixer.cash, 'a journaled mix change replays identically')
}

console.log('— Founder Attention (brief §9): limited budget, real tradeoffs —')
{
  // INERT UNTIL ENGAGED: an untouched run has no attention parts anywhere
  const idle = newGame('A', 'saas', 'technical', { config: cfg({ seed: 91, mode: 'career' }) })
  const m0 = strategicModifiers(idle)
  ok(m0.researchMult === 1 && m0.moraleDrift === 0, 'no focus, no allocation → research and morale channels exactly neutral')
  ok(attentionEngagement(idle) === 'none', 'a fresh game has not engaged the system')

  // light: one Focus = one bounded boost
  let focused = newGame('A', 'saas', 'technical', { config: cfg({ seed: 91 }) })
  focused = applyJournaled(focused, 'attention_focus', { a: 'product' }).state
  const mF = strategicModifiers(focused)
  ok(mF.buildVelocity > 1 && mF.buildVelocity <= 1.35, `Focus: Product lifts build velocity, bounded (${mF.buildVelocity.toFixed(3)})`)
  focused = applyJournaled(focused, 'attention_focus', { a: 'customers' }).state
  const mC = strategicModifiers(focused)
  ok(mC.buildVelocity === 1 && mC.researchMult > 1 && mC.churnRelief < 1, 'moving the Focus moves the boost — one area at a time')

  // light mode NEVER punishes: no allocation engaged → no shortfall maluses even in a mess
  focused.bugs = 80
  focused.employees = Array.from({ length: 14 }, (_, i) => ({ ...focused.employees[0] ?? { id: `e${i}`, name: 'E', role: 'engineer', skill: 5, salary: 1, morale: 70, weeks: 0, trait: null }, id: `e${i}` })) as never
  ok(Object.keys(attentionShortfalls(focused)).length === 0, 'a Focus player is never billed for the deep allocator’s needs')

  // deep: the allocator engages needs; journal sanitizes an over-budget allocation
  let deep = newGame('A', 'saas', 'technical', { config: cfg({ seed: 92, mode: 'career' }) })
  deep = applyJournaled(deep, 'attention_allocate', { alloc: { product: 20, customers: 20, leadership: 20 } }).state
  const total = Object.values(deep.attention!.allocated!).reduce((a: number, b) => a + (b ?? 0), 0)
  ok(total === ATTENTION_BUDGET, `an over-budget journal is truncated at the ${ATTENTION_BUDGET}-point budget (got ${total})`)
  ok((deep.attention!.allocated!.product ?? 0) <= 6, 'no single area absorbs more than 6 points')

  // neglect bites the starved axis — and ONLY once engaged
  let neglect = newGame('A', 'saas', 'technical', { config: cfg({ seed: 93, mode: 'career' }) })
  neglect = applyJournaled(neglect, 'attention_allocate', { alloc: { fundraising: 6, recruiting: 2 } }).state
  neglect.bugs = 70 // operations need 2, product need 2 — both starved
  const mN = strategicModifiers(neglect)
  ok(mN.buildVelocity < 1, `starving Product while allocated elsewhere slows the build (${mN.buildVelocity.toFixed(3)})`)
  ok(mN.bugPressure > 1, `starving Operations during a bug fire raises bug pressure (${mN.bugPressure.toFixed(3)})`)

  // crisis forcing: bugs over 60 claim 3 operations points and squeeze the plan
  let crisis = newGame('A', 'saas', 'technical', { config: cfg({ seed: 94, mode: 'career' }) })
  crisis = applyJournaled(crisis, 'attention_allocate', { alloc: { product: 4, customers: 4 } }).state
  crisis.bugs = 75
  crisis = advanceWeek(crisis)
  ok(crisis.attention!.forcedWeek === crisis.week && (crisis.attention!.forced?.operations ?? 0) === 3, 'a quality fire forces 3 points of Operations attention')
  const eff = effectiveAllocation(crisis)
  const effSum = (eff.product ?? 0) + (eff.customers ?? 0)
  ok(effSum < 8 && effSum <= 5.01, `the discretionary plan is squeezed to the remaining budget (${effSum.toFixed(2)} of 8 planned)`)
  ok(crisis.inbox.some((m) => m.title.includes('Quality crisis')), 'the crisis announces itself in the inbox once')

  // dependency: sustained heavy involvement makes the org lean on you; delegation unwinds it
  let dep = newGame('A', 'saas', 'technical', { config: cfg({ seed: 95, mode: 'career' }) })
  dep = applyJournaled(dep, 'attention_allocate', { alloc: { product: 4 } }).state
  for (let i = 0; i < 12; i++) dep = advanceWeek(dep)
  const grown = dep.attention!.dependency.product ?? 0
  ok(grown >= 30, `12 weeks of heavy Product involvement grows dependency (${grown.toFixed(0)})`)
  dep = applyJournaled(dep, 'attention_allocate', { alloc: { customers: 2 } }).state
  dep.employees.push({ id: 'vp', name: 'VP Eng', role: 'engineer', skill: 9, salary: 200000, morale: 80, weeks: 0, trait: null } as never)
  for (let i = 0; i < 6; i++) dep = advanceWeek(dep)
  ok((dep.attention!.dependency.product ?? 0) < grown, 'stepping back with a senior engineer aboard unwinds the dependency')

  // big-bet integration (§13.3): attention on affinity areas trickles progress, but can NEVER
  // complete a bet alone — attention accelerates work, it is not the work
  let better = newGame('A', 'saas', 'technical', { config: cfg({ seed: 96, mode: 'career' }) })
  better = applyJournaled(better, 'bet_choose', { t: 'consumer_viral_engine' }).state
  better = applyJournaled(better, 'attention_focus', { a: 'product' }).state
  let idler = newGame('A', 'saas', 'technical', { config: cfg({ seed: 96, mode: 'career' }) })
  idler = applyJournaled(idler, 'bet_choose', { t: 'consumer_viral_engine' }).state
  for (let i = 0; i < 10; i++) {
    better = advanceWeek(better)
    idler = advanceWeek(idler)
  }
  ok(better.bigBet!.progress > idler.bigBet!.progress, `aligned attention advances the bet (${better.bigBet!.progress.toFixed(1)} vs ${idler.bigBet!.progress.toFixed(1)})`)
  ok(better.bigBet!.status === 'active' && better.bigBet!.progress < 40, 'attention alone cannot complete a bet inside its window')

  // arena: the journal guard holds — attention effects cannot exist there
  let ar = newGame('A', 'saas', 'technical', { config: cfg({ seed: 97, mode: 'arena' }) })
  ar = applyJournaled(ar, 'attention_focus', { a: 'product' }).state
  ar = applyJournaled(ar, 'attention_allocate', { alloc: { product: 4 } }).state
  ok(!ar.attention?.focus && !ar.attention?.allocated, 'arena journals cannot set focus or allocation (attention is OFF there)')

  // replay integrity: a run with attention decisions replays byte-identically
  let live = newGame('R', 'saas', 'technical', { config: cfg({ seed: 98, mode: 'career' }) })
  live = applyJournaled(live, 'attention_allocate', { alloc: { product: 3, leadership: 2 } }).state
  for (let i = 0; i < 5; i++) live = applyJournaled(live, 'advance').state
  const replayed = replayRun(
    { name: 'R', sector: 'saas', founderKind: 'technical', config: cfg({ seed: 98, mode: 'career' }) } as never,
    [
      { a: 'attention_allocate', w: 1, p: { alloc: { product: 3, leadership: 2 } } },
      ...Array.from({ length: 5 }, () => ({ a: 'advance', w: 0 })),
    ] as never,
  )
  ok(replayed.cash === live.cash && replayed.features === live.features && JSON.stringify(replayed.attention) === JSON.stringify(live.attention), 'a journaled attention run replays identically')
}

console.log('— Management Capacity (brief §11): leadership is the cap, not headcount —')
{
  const { coordinationDrag, mgmtDrag, managementCapacity, capacityParts } = await import('../src/game/strategic/capacity')
  const mkEmp = (skill: number, i: number) =>
    ({ id: `e${i}`, name: `E ${i}`, role: 'engineer', skill, salary: 100_000, morale: 70, weeks: 10, trait: null }) as never

  // 1. Outside deep career the system IS the classic formula, byte-exactly, at every headcount.
  for (const heads of [0, 5, 8, 12, 20, 40]) {
    const q = newGame('Q', 'saas', 'technical', { config: cfg({ seed: 5 }) })
    q.employees = Array.from({ length: heads }, (_, i) => mkEmp(5, i))
    ok(mgmtDrag(q) === coordinationDrag(q), `quick mgmtDrag === coordinationDrag at ${heads} heads (${mgmtDrag(q)})`)
  }

  // 2. Deep: a fresh career company is untouched (drag exactly 1 — inert until the org grows).
  const fresh = newGame('C', 'saas', 'technical', { config: cfg({ seed: 5, mode: 'career' }) })
  ok(mgmtDrag(fresh) === 1, 'a founder-only deep career org has drag exactly 1.0')

  // 3. Deep: the same 14-person org is slower UNLED than led — executives create real leverage.
  const unled = newGame('C', 'saas', 'technical', { config: cfg({ seed: 5, mode: 'career' }) })
  unled.employees = Array.from({ length: 14 }, (_, i) => mkEmp(5, i))
  const led = newGame('C', 'saas', 'technical', { config: cfg({ seed: 5, mode: 'career' }) })
  led.employees = Array.from({ length: 14 }, (_, i) => mkEmp(i < 3 ? 8 : 5, i))
  ok(mgmtDrag(led) > mgmtDrag(unled), `led beats unled at 14 heads (${mgmtDrag(led).toFixed(3)} vs ${mgmtDrag(unled).toFixed(3)})`)
  ok(mgmtDrag(led) <= 1, 'leadership recovers the coordination tax but never exceeds 1.0')
  ok(mgmtDrag(unled) < coordinationDrag(unled), 'an unled org is SLOWER than the flat headcount tax alone')

  // 4. Words track the ratio, and overload leaks into quality/morale parts — but Stretched is free.
  const mcU = managementCapacity(unled)
  ok(mcU.word === 'Overloaded' || mcU.word === 'Breaking', `14 unled heads read as overloaded (${mcU.word})`)
  ok(mcU.why.length > 0, 'the verdict comes with reasons')
  const pU = capacityParts(unled)
  ok(pU.bugs > 0 && pU.moraleDrift < 0, 'an overloaded org leaks bugs and morale')
  ok(capacityParts(fresh).bugs === 0 && capacityParts(fresh).moraleDrift === 0, 'a healthy org leaks nothing')
  ok(capacityParts(led).bugs === 0 || managementCapacity(led).word !== 'Healthy', 'a led org clears the leak (or is honestly not Healthy)')

  // 5. Quick/arena never leak regardless of shape — the depth gate holds.
  const qBig = newGame('Q', 'saas', 'technical', { config: cfg({ seed: 5 }) })
  qBig.employees = Array.from({ length: 30 }, (_, i) => mkEmp(4, i))
  const pQ = capacityParts(qBig)
  ok(pQ.bugs === 0 && pQ.moraleDrift === 0, 'no capacity leak outside deep career, even at 30 heads')
}

console.log('— AI Adoption (brief §5): transform, at the price of a real rollout —')
{
  const { availableAIInitiatives, startAIInitiative, tickAI, aiParts, implementationQuality, createDefaultAI } = await import(
    '../src/game/strategic/ai'
  )
  const { strategicModifiers } = await import('../src/game/strategic/effects')
  const mkEmp = (skill: number, i: number, morale = 70) =>
    ({ id: `e${i}`, name: `E ${i}`, role: 'engineer', skill, salary: 100_000, morale, weeks: 10, trait: null }) as never

  // 1. Inert by default: a fresh career company has zero AI parts and neutral modifiers.
  const fresh = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  const p0 = aiParts(fresh)
  ok(p0.build.length === 0 && p0.moraleDrift === 0, 'no adoption → zero parts')

  // 2. The ladder gates: only rung-1 initiatives are startable from nothing, and cash is real.
  const c = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  c.aiAdoption = createDefaultAI()
  const avail = availableAIInitiatives(c)
  ok(avail.length > 0 && avail.every((d) => d.target === 1), 'from maturity 0 only tools-level rungs are on offer')
  ok(!startAIInitiative(c, 'eng-review', 'deep'), 'a workflow rung cannot start before the tools rung')
  const cashBefore = c.cash
  ok(startAIInitiative(c, 'eng-assistants', 'deep'), 'the tools rung starts')
  ok(c.cash === cashBefore - 8_000, 'the rollout bills its cash up front')
  ok(!startAIInitiative(c, 'mkt-content', 'deep'), 'one rollout at a time — transformation is not free parallelism')

  // 3. The tick completes it, deterministically, and the area carries maturity + quality.
  let weeks = 0
  while (c.aiAdoption!.active.length > 0 && weeks < 20) {
    tickAI(c, 'deep')
    weeks++
  }
  ok(weeks >= 3 && weeks <= 6, `a 3-week tools rollout lands in 3-6 weeks at healthy pace (${weeks})`)
  ok(c.aiAdoption!.areas.engineering?.maturity === 1, 'engineering reaches Tools')

  // 4. Quality is the org, not the dice: the same rollout in an overloaded indebted org ships worse.
  const healthy = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  healthy.employees = Array.from({ length: 4 }, (_, i) => mkEmp(8, i))
  const mess = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  mess.employees = Array.from({ length: 14 }, (_, i) => mkEmp(3, i))
  mess.roadmap = { active: [], queued: [], done: [], debt: 90 }
  mess.bugs = 70
  ok(implementationQuality(healthy) > implementationQuality(mess) + 15, `quality is earned (${implementationQuality(healthy)} vs ${implementationQuality(mess)})`)

  // 5. Effects flow through the composer — and never touch fit (no PMF hook, §5.10).
  const adopted = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  adopted.aiAdoption = {
    areas: { engineering: { maturity: 3, quality: 80, resistance: 0 }, support: { maturity: 2, quality: 70, resistance: 0 } },
    active: [],
  }
  const m = strategicModifiers(adopted)
  ok(m.buildVelocity > 1, `engineering adoption speeds the build (${m.buildVelocity.toFixed(3)})`)
  ok(m.churnRelief < 1 && m.opexMult < 1, 'support adoption serves retention and trims cost')
  ok(m.conversionLift === 1, 'AI never buys conversion/fit directly — the PMF wall holds')
  const botched = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  botched.aiAdoption = { areas: { engineering: { maturity: 3, quality: 30, resistance: 0 } }, active: [] }
  ok(strategicModifiers(botched).bugPressure > 1, 'a botched engineering transformation ships bugs, not speed')

  // 6. Resistance is real: a resisted area rolls out slower than a willing one.
  const willing = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  willing.aiAdoption = { areas: { support: { maturity: 1, quality: 70, resistance: 0 } }, active: [] }
  startAIInitiative(willing, 'sup-triage', 'deep')
  const resistant = newGame('C', 'saas', 'technical', { config: cfg({ seed: 9, mode: 'career' }) })
  resistant.aiAdoption = { areas: { support: { maturity: 1, quality: 70, resistance: 50 } }, active: [] }
  startAIInitiative(resistant, 'sup-triage', 'deep')
  tickAI(willing, 'deep')
  tickAI(resistant, 'deep')
  ok(willing.aiAdoption!.active[0].progress > resistant.aiAdoption!.active[0].progress, 'resistance slows the rollout')

  // 7. Journal integrity: depth-guarded, and a journaled run replays byte-identically.
  let q = newGame('Q', 'saas', 'technical', { config: cfg({ seed: 9 }) })
  q = applyJournaled(q, 'ai_start', { id: 'eng-assistants' }).state
  ok((q.aiAdoption?.active.length ?? 0) === 0, 'quick journals cannot start a rollout (aiAdoption is OFF there)')
  let live = newGame('R', 'saas', 'technical', { config: cfg({ seed: 77, mode: 'career' }) })
  live = applyJournaled(live, 'ai_start', { id: 'eng-assistants' }).state
  for (let i = 0; i < 6; i++) live = applyJournaled(live, 'advance').state
  const replayed = replayRun(
    { name: 'R', sector: 'saas', founderKind: 'technical', config: cfg({ seed: 77, mode: 'career' }) } as never,
    [{ a: 'ai_start', w: 1, p: { id: 'eng-assistants' } }, ...Array.from({ length: 6 }, () => ({ a: 'advance', w: 0 }))] as never,
  )
  ok(
    replayed.cash === live.cash && JSON.stringify(replayed.aiAdoption) === JSON.stringify(live.aiAdoption),
    'a journaled AI run replays identically',
  )
}

console.log('— Strategic Coherence (brief §10): derived, hidden, modest —')
{
  const { coherence, coherenceParts } = await import('../src/game/strategic/coherence')
  const { chooseBigBet } = await import('../src/game/strategic/bigbets')

  // 1. Structurally neutral where its inputs are off: quick and arena always read zero.
  const q = newGame('Q', 'saas', 'technical', { config: cfg({ seed: 3 }) })
  ok(coherence(q).total === 0 && coherenceParts(q).acq === 0, 'quick/arena coherence is exactly neutral (nothing to read)')

  // 2. A company whose choices AGREE compounds; one whose choices ARGUE pays — both modest.
  const agree = newGame('C', 'saas', 'technical', { config: cfg({ seed: 3, mode: 'career' }) })
  chooseBigBet(agree, 'consumer_viral_engine', 'deep')
  agree.growth = { performanceShare: 1, lastMixWeek: 0, brand: { stock: 0, pending: [] } }
  agree.employees = [
    { id: 'm1', name: 'M', role: 'marketer', skill: 6, salary: 90_000, morale: 70, weeks: 5, trait: null },
    { id: 'e1', name: 'E', role: 'engineer', skill: 6, salary: 120_000, morale: 70, weeks: 5, trait: null },
    { id: 'e2', name: 'E2', role: 'engineer', skill: 6, salary: 120_000, morale: 70, weeks: 5, trait: null },
  ] as never
  const tgt = agree.career!.primaryTargetSegmentId
  agree.career!.segmentBeliefs[tgt].willingnessToPay = { estimate: 70, confidence: 0.7, evidenceCount: 5 }
  agree.career!.pricing = 'premium'
  const cAgree = coherence(agree)
  ok(cAgree.total >= 2, `reinforcing choices score coherent (${cAgree.total})`)
  ok(coherenceParts(agree).acq > 0, 'coherence pays a small, capped premium')

  const argue = newGame('C', 'saas', 'technical', { config: cfg({ seed: 3, mode: 'career' }) })
  chooseBigBet(argue, 'enterprise_readiness', 'deep')
  // an enterprise push… targeting freelancers, priced premium against a board that says they
  // won't pay, marketing 100% performance (the mix the bet competes with), nobody in sales
  argue.growth = { performanceShare: 1, lastMixWeek: 0, brand: { stock: 0, pending: [] } }
  argue.career!.primaryTargetSegmentId = 'freelancers'
  argue.career!.segmentBeliefs.freelancers.willingnessToPay = { estimate: 15, confidence: 0.7, evidenceCount: 5 }
  argue.career!.pricing = 'premium'
  argue.employees = [
    { id: 'e1', name: 'E', role: 'engineer', skill: 6, salary: 120_000, morale: 70, weeks: 5, trait: null },
    { id: 'e2', name: 'E2', role: 'engineer', skill: 6, salary: 120_000, morale: 70, weeks: 5, trait: null },
    { id: 'd1', name: 'D', role: 'designer', skill: 6, salary: 100_000, morale: 70, weeks: 5, trait: null },
  ] as never
  const cArgue = coherence(argue)
  ok(cArgue.total <= -2, `contradicting choices score incoherent (${cArgue.total})`)
  ok(cArgue.signals.length > 0 && cArgue.signals.every((x) => !/\d\d/.test(x.text)), 'signals are WORDS — the score never leaks a number')
  const p = coherenceParts(argue)
  ok(p.acq < 0 && p.acq >= -0.05 && p.moraleDrift < 0, 'incoherence taxes, modestly — never a death sentence')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)