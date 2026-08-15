// Living World Phase 6 — the Advisor Opinion Engine (brief §28-§33, §76, tests §83).
//
// What carries the phase: advisors INTERPRET the week and never decide it, each seat weighs the
// same facts differently, competence and bias bend the reading plausibly, and the whole thing is
// deterministic, idempotent, persisted, and byte-invisible when its capability is off.
//
// MUTATION LEDGER — each entry below was verified by making the named break and watching the
// named assertion fail, then reverting. An assertion that cannot fail is not a test.
//   1. SEAT_DEFS.finance.weights.runway = 0        → "finance leads with runway" fails.
//   2. SEAT_DEFS.growth.stances.growth.good='hold' → "the growth chair pushes" fails.
//   3. biasMultiplier returns 1 always             → "optimism dampens bad news" fails.
//   4. advisorSkill expertise ignores simSkill     → "the sim's skill number buys better advice" fails.
//   5. pickSeatOpinion drops the judgement slip    → "poor judgement voices the second story" fails.
//   6. tick.ts stops calling buildAdvisorPanel     → "a Career run grows a panel" fails (integration IS the deliverable).
//   7. buildAdvisorPanel skips the exclude list    → "no line is spoken twice in one panel" fails.
//   8. persistence drops advisorPanel              → "the panel survives a JSON round-trip" fails.
//   9. capability gate removed in tick.ts          → "advisorOpinions off leaves no panel" fails.
//  10. readWeekFacts flips the runway sign         → "two weeks of cash reads as a severe, BAD runway
//      fact" fails. NOTE: the first version of this ledger claimed the §29 block caught this — it
//      did not (§29's fixtures are hand-built facts), which is why the reader has its own assertion.
import { advanceWeek, migrateLegacySave, newGame } from '../src/game/engine'
import { tickLivingWorld } from '../src/game/world/tick'
import {
  SPEAK_FLOOR,
  advisorSkill,
  biasMultiplier,
  buildAdvisorPanel,
  pickSeatOpinion,
  readWeekFacts,
  seatHolders,
  type WeekFact,
} from '../src/game/world/advisors'
import { SEAT_DEFS } from '../src/game/world/content/advisors'
import { validateFragmentLibrary } from '../src/game/world/composer'
import { emptyLivingWorld, migrateLivingWorldSlice } from '../src/game/world/persistence'
import type { Character } from '../src/game/world/types'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

// ---------- fixtures ----------

const cfg = (seed: number, mode: 'quick' | 'career' | 'arena' = 'career', overrides?: Record<string, boolean>) =>
  ({ mode, format: 'standard', sector: 'saas' as SectorId, seed, overrides }) as never

function play(seed: number, weeks: number, mode: 'quick' | 'career' | 'arena' = 'career', overrides?: Record<string, boolean>): GameState {
  let s = newGame('Northwind', 'saas', 'technical', { config: cfg(seed, mode, overrides) })
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    s.marketingSpend = 3000
    if (s.employees.length + s.offersOut.length + s.pendingHires.length < 4 && s.candidates.length) {
      const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((c) => c.id !== best.id)
      s.offersOut.push(best)
    }
    s = advanceWeek(s)
  }
  return s
}

/** A neutral person whose personality the test controls exactly — generation would randomise it. */
function person(over: Partial<Character['personality']> = {}, extra: Partial<Character> = {}): Character {
  return {
    id: 'test:advisor',
    firstName: 'Test',
    lastName: 'Advisor',
    role: 'advisor',
    personality: { directness: 50, ambition: 50, patience: 50, loyalty: 50, optimism: 50, ego: 50, riskTolerance: 50, empathy: 50, ...over },
    motivations: { primary: 'mission', secondary: [] },
    communicationStyle: 'direct',
    background: { careerStage: 'established', previousEnvironment: 'startup', yearsExperience: 10, notableStrength: 'operational_rigour' },
    relationships: [],
    memories: [],
    status: 'active',
    createdWeek: 1,
    ...extra,
  }
}

const fact = (topic: WeekFact['topic'], severity: number, direction: 1 | -1, slots: WeekFact['slots'] = {}): WeekFact => ({
  topic,
  severity,
  direction,
  slots,
})

/**
 * §29's textbook week: growth up, acquisition efficiency down, retention down, runway down.
 * Severities are honest mid-range values, not rigged extremes — the DISAGREEMENT must come from
 * the seat weights, or the whole §28 design is decoration.
 */
const CONTESTED_WEEK: WeekFact[] = [
  fact('growth', 0.7, 1, { growth: '9%' }),
  fact('marketing', 0.6, -1, { marketing: '$4,000', added: 12 }),
  fact('retention', 0.7, -1, { retention: '48%' }),
  fact('runway', 0.75, -1, { runway: '11 weeks' }),
]

const skilled = advisorSkill(person({ patience: 70, ego: 30 })) // high judgement, no slip in practice
const noSlip = () => 0.999 // judgement draw that never slips, so seat weights are what is being tested

console.log('— Content is lintable before it is judgeable —')
const problems = validateFragmentLibrary()
ok(problems.length === 0, `advisor pools pass the library lint (${problems.length === 0 ? 'clean' : problems.join('; ')})`)

console.log('\n— §28/§29: identical facts, different chairs, real disagreement —')
{
  const fin = pickSeatOpinion('finance', person(), skilled, CONTESTED_WEEK, noSlip)
  const gro = pickSeatOpinion('growth', person(), skilled, CONTESTED_WEEK, noSlip)
  const pro = pickSeatOpinion('product', person(), skilled, CONTESTED_WEEK, noSlip)
  ok(fin?.fact.topic === 'runway' && fin.stance === 'cut', `finance leads with runway and says cut (got ${fin?.fact.topic}/${fin?.stance})`)
  // §31: the sales chair's answer to deteriorating efficiency is to push, not to cut — the bias IS the feature.
  ok(gro !== undefined && gro.stance === 'push', `the growth chair pushes whatever it leads with (got ${gro?.fact.topic}/${gro?.stance})`)
  ok(pro?.fact.topic === 'retention' && pro.stance === 'fix', `product leads with retention and says fix (got ${pro?.fact.topic}/${pro?.stance})`)
  const stances = new Set([fin?.stance, gro?.stance, pro?.stance])
  ok(stances.size === 3, `three chairs, three different verdicts — §29's disagreement is emergent (${[...stances].join(', ')})`)
}

console.log('\n— §83: each seat responds strongly to its own metric —')
{
  // CFO vs runway deterioration: the same mild backdrop, runway getting worse must take the lead.
  const backdrop = [fact('morale', 0.4, -1, { morale: 44 })]
  const mild = pickSeatOpinion('finance', person(), skilled, [...backdrop, fact('runway', 0.2, -1, { runway: '25 weeks' })], noSlip)
  const dire = pickSeatOpinion('finance', person(), skilled, [...backdrop, fact('runway', 0.9, -1, { runway: '4 weeks' })], noSlip)
  ok(dire?.fact.topic === 'runway', 'the CFO responds strongly to runway deterioration')
  ok(mild?.fact.topic !== 'runway' || !!(mild && dire && mild.fact.severity < dire.fact.severity), 'and it is the deterioration doing it, not a hardcoded favourite topic')
  const sales = pickSeatOpinion('growth', person(), skilled, [fact('growth', 0.6, 1, { growth: '8%' }), fact('quality', 0.6, -1, { bugs: 70 })], noSlip)
  ok(sales?.fact.topic === 'growth', 'sales responds to pipeline over product trouble')
  const prod = pickSeatOpinion('product', person(), skilled, [fact('retention', 0.5, -1, { retention: '55%' }), fact('growth', 0.5, 1, { growth: '7%' })], noSlip)
  ok(prod?.fact.topic === 'retention', 'product responds to retention over top-line growth')
}

console.log('\n— §31: bias tilts the volume, never the sign —')
{
  const bad = fact('runway', 0.6, -1)
  const optimist = biasMultiplier(person({ optimism: 90, riskTolerance: 90 }), bad)
  const pessimist = biasMultiplier(person({ optimism: 10, riskTolerance: 10 }), bad)
  ok(optimist < 1 && pessimist > 1, `optimism dampens bad news and its absence amplifies it (${optimist.toFixed(2)} vs ${pessimist.toFixed(2)})`)
  const winner = biasMultiplier(person({}, { motivations: { primary: 'winning', secondary: [] } }), fact('growth', 0.5, 1))
  ok(winner > 1.2, `a win-hungry seat over-hears momentum (${winner.toFixed(2)})`)
  // The sign is a fact: no temperament may turn a crisis into good news. The multiplier is bounded.
  ok(optimist >= 0.5 && biasMultiplier(person({ optimism: 100, riskTolerance: 100 }), bad) >= 0.5, 'no temperament is deaf — the multiplier is floored, the sign untouched')
}

console.log('\n— §30: competence is derived from the person and changes what they notice —')
{
  const veteran = advisorSkill(person({}, { background: { careerStage: 'veteran', previousEnvironment: 'corporate', yearsExperience: 25, notableStrength: 'operational_rigour' } }))
  const rookie = advisorSkill(person({}, { background: { careerStage: 'rising', previousEnvironment: 'university', yearsExperience: 2, notableStrength: 'ships_fast' } }))
  ok(veteran.functionalExpertise > rookie.functionalExpertise, `a veteran out-reads a rookie (${veteran.functionalExpertise} vs ${rookie.functionalExpertise})`)
  ok(advisorSkill(person(), 9).functionalExpertise > advisorSkill(person(), 3).functionalExpertise, "the sim's skill number buys better advice — hiring better people is the §30 loop")
  const analyst = advisorSkill(person({}, { communicationStyle: 'analytical', background: { careerStage: 'established', previousEnvironment: 'startup', yearsExperience: 10, notableStrength: 'data_driven' } }))
  ok(analyst.forecasting > advisorSkill(person({}, { communicationStyle: 'enthusiastic' })).forecasting, 'forecasting follows temperament, not the role')

  // Forecasting gates the early call: a quiet signal (felt < 0.35) needs a forecaster to be seen.
  const early = [fact('runway', 0.3, -1, { runway: '24 weeks' })]
  const seer = { ...skilled, forecasting: 80 }
  const blind = { ...skilled, forecasting: 30 }
  ok(pickSeatOpinion('finance', person(), seer, early, noSlip) !== undefined, 'a forecaster flags the problem while it is still quiet')
  ok(pickSeatOpinion('finance', person(), blind, early, noSlip) === undefined, 'a weak forecaster misses the same signal — reacting late is the §30 error mode')

  // Judgement slip: the same week, the same seat — a poor-judgement advisor voices story #2.
  const lowJ = { ...skilled, judgement: 10 }
  const slipDraw = () => 0.0 // the seeded draw landing under the slip chance
  const straight = pickSeatOpinion('finance', person(), skilled, CONTESTED_WEEK, slipDraw)
  const slipped = pickSeatOpinion('finance', person(), lowJ, CONTESTED_WEEK, slipDraw)
  ok(straight?.fact.topic === 'runway' && slipped !== undefined && slipped.fact.topic !== 'runway',
    `poor judgement voices the second story (${slipped?.fact.topic}), sound judgement the first (${straight?.fact.topic})`)
  // Plausible, never absurd: the slipped topic still cleared the speak floor.
  ok((SEAT_DEFS.finance.weights[slipped!.fact.topic] ?? 0) * slipped!.fact.severity >= SPEAK_FLOOR * 0.5, 'the slip is plausible — it picked a real concern, not noise')
}

console.log('\n— Integration: a Career run grows a panel, and the panel is the §76 surface —')
// The panel is replaced whole each week, so asserting on the final week alone would test whatever
// week the run happened to end on. Collect every week's panel as the run plays.
function playCollecting(seed: number, weeks: number) {
  let s = newGame('Northwind', 'saas', 'technical', { config: cfg(seed) })
  const panels: NonNullable<GameState['world']>['advisorPanel'][] = []
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    s.marketingSpend = 3000
    if (s.employees.length + s.offersOut.length + s.pendingHires.length < 4 && s.candidates.length) {
      const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((c) => c.id !== best.id)
      s.offersOut.push(best)
    }
    s = advanceWeek(s)
    if (s.world?.advisorPanel) panels.push(JSON.parse(JSON.stringify(s.world.advisorPanel)))
  }
  return { s, panels }
}
const { s: run, panels } = playCollecting(4242, 30)
{
  const spoken = panels.filter((p) => p && p.opinions.length > 0)
  ok(panels.length > 0 && spoken.length >= 10, `a Career run grows a panel, and it usually has something to say (${spoken.length}/${panels.length} weeks) — the integration is the deliverable`)
  ok(run.world?.advisorPanel?.week === run.week, `the surviving panel is this week's read (panel w${run.world?.advisorPanel?.week}, game w${run.week})`)
  const opinions = spoken.flatMap((p) => p!.opinions)
  ok(opinions.every((o) => o.headline.length > 0 && o.detail.length > 0), 'every opinion has both a verdict and a grounded reason')
  ok(opinions.every((o) => !/\{[a-zA-Z0-9_]+\}/.test(o.headline + o.detail)), 'no unfilled {slot} ever reaches the player')
  ok(opinions.some((o) => /\d/.test(o.detail)), "§66: the reasons carry the week's actual numbers")
  ok(spoken.some((p) => p!.opinions.length >= 2), 'weeks exist where more than one chair speaks')
  const cfoNames = new Set(opinions.filter((o) => o.seat === 'finance').map((o) => o.speaker))
  ok(cfoNames.size === 1 && opinions.some((o) => o.title === 'Fractional CFO'), `the finance seat is ONE persistent named person all run (${[...cfoNames].join(', ') || 'nobody spoke'})`)
  ok(spoken.every((p) => new Set(p!.opinions.map((o) => o.seat)).size === p!.opinions.length), 'one voice per seat per week')
  ok(
    spoken.every((p) => {
      const ids = p!.opinions.flatMap((o) => o.fragmentIds)
      return new Set(ids).size === ids.length
    }),
    'no line is spoken twice in one panel — silence beats stutter',
  )
  ok(!!run.world?.characters['adv:cfo'], 'the CFO joined the persistent cast — same person next week, not a re-roll')
}

console.log('\n— Determinism and idempotency (the Arena catch-up contract) —')
{
  const again = play(4242, 30)
  ok(JSON.stringify(again.world?.advisorPanel) === JSON.stringify(run.world?.advisorPanel), 'same seed composes the identical panel')
  ok(JSON.stringify(play(99, 30).world?.advisorPanel) !== JSON.stringify(run.world?.advisorPanel), 'a different seed reads differently — the test above is not vacuous')
  const before = JSON.stringify(run.world)
  tickLivingWorld(run) // the catch-up loop calling the same week again
  ok(JSON.stringify(run.world) === before, 'a second tick over the same week changes nothing (shouldGenerateForWeek)')
  // buildAdvisorPanel itself is pure in (state, world, seed): rebuilding the same week twice agrees.
  const p1 = buildAdvisorPanel(run, run.world!, 4242)
  const p2 = buildAdvisorPanel(run, run.world!, 4242)
  ok(JSON.stringify(p1) === JSON.stringify(p2), 'the builder is pure — same inputs, same panel, any number of times')
}

console.log('\n— Interpretation only: flipping the capability moves no simulation output —')
{
  const trace = (s: GameState) => `${s.users}|${s.pmf.toFixed(6)}|${Math.round(s.cash)}|${s.quality.toFixed(4)}|${s.bugs.toFixed(4)}|${s.inbox.length}`
  const withA = play(7, 26)
  const withoutA = play(7, 26, 'career', { advisorOpinions: false })
  ok(withoutA.world?.advisorPanel === undefined, 'advisorOpinions off leaves no panel')
  ok(trace(withA) === trace(withoutA), 'and the simulation is byte-identical either way — advisors interpret, never decide')
  ok(withoutA.world?.characters['adv:cfo'] === undefined, 'no capability, no CFO in the cast — the flag buys exactly its own system')
  ok(play(7, 20, 'quick').world?.advisorPanel === undefined, 'Quick Play has no advisor layer (§32)')
  // Tracks livingWorldActive(): Phase 8 added the three structured-interaction switches to it.
  const OFF = { proceduralNarrative: false, persistentCharacters: false, characterMemory: false, companyMemory: false, relationships: false, advisorOpinions: false, promises: false, structuredInterviews: false, structuredEmployeeConversations: false, proceduralBoardMeetings: false }
  ok(play(7, 12, 'career', OFF).world === undefined, 'with every living-world capability off, no world is created at all')
}

console.log('\n— Legacy saves: frozen rulesets stay frozen (the Slice 5 precedent) —')
{
  // A save carries the capability set it was created with, resolved ONCE (modes.ts header). New
  // capabilities reach NEW runs — exactly how tokenCommunity shipped (887b483: mode table only,
  // no save-path backfill), and what ICO §74 depends on. An in-flight Career save from before
  // this phase must keep advisorOpinions: false and simply never grow a panel.
  const inFlight = newGame('Frozen', 'saas', 'technical', { config: cfg(5) })
  inFlight.capabilities = { ...inFlight.capabilities, advisorOpinions: false } // as an older build stored it
  const advanced = advanceWeek(advanceWeek(inFlight))
  ok(advanced.world?.advisorPanel === undefined, 'an in-flight save with a frozen pre-phase ruleset never grows a panel')
  // A pre-config save (no capabilities at all) resolves against the CURRENT tables — but those
  // migrations never assign Career, so advisorOpinions still cannot appear retroactively.
  const preConfig = { ...newGame('Ancient', 'saas', 'technical', { config: cfg(5, 'quick') }), config: undefined, capabilities: undefined } as never as GameState
  const migrated = migrateLegacySave(preConfig)
  ok(migrated.capabilities.advisorOpinions === false, 'a pre-config save migrates to Quick Play and gains no advisor layer')
}

console.log('\n— Persistence (§68/§88): the panel is prose that must never reword itself —')
{
  const revived = migrateLivingWorldSlice(JSON.parse(JSON.stringify(run.world)))
  ok(JSON.stringify(revived?.advisorPanel) === JSON.stringify(run.world?.advisorPanel), 'the panel survives a JSON round-trip verbatim')
  const empty = emptyLivingWorld()
  ok(migrateLivingWorldSlice(JSON.parse(JSON.stringify(empty)))?.advisorPanel === undefined, 'a world that never had a panel loads without one')
  const garbage = migrateLivingWorldSlice({ ...JSON.parse(JSON.stringify(run.world)), advisorPanel: { week: 5, opinions: [{ id: 'x' }, 'nonsense', { id: 'y', seat: 'astrology', headline: 'h', detail: 'd' }] } })
  ok(garbage?.advisorPanel?.opinions.length === 0, 'malformed opinions are dropped, never guessed at')
}

console.log('\n— The seat map is a fact of the run —')
{
  let s = newGame('Seats', 'saas', 'technical', { config: cfg(11) })
  ok(seatHolders(s).map((h) => h.seat).join(',') === 'finance', 'week 1: no employees, no board — finance is the only seat')
  s.employees.push({ id: 'e1', name: 'Ada Sales', role: 'sales', skill: 7, salary: 90000, morale: 80, weeks: 1 })
  s.employees.push({ id: 'e2', name: 'Bo Eng', role: 'engineer', skill: 6, salary: 90000, morale: 80, weeks: 1 })
  s.board = { targetGrowth: 0.04, nextReview: 20, strikes: 0, defied: false }
  const seats = seatHolders(s).map((h) => h.seat)
  ok(seats.join(',') === 'finance,growth,product,investor', `hiring and raising open the other chairs (${seats.join(',')})`)
  const strongest = { id: 'e3', name: 'Cy Closer', role: 'sales' as const, skill: 9, salary: 90000, morale: 80, weeks: 1 }
  s.employees.push(strongest)
  ok(seatHolders(s).find((h) => h.seat === 'growth')?.simSkill === 9, 'the strongest person in the discipline holds the chair')
}

console.log('\n— readWeekFacts reads facts, not vibes —')
{
  const facts = readWeekFacts(run)
  ok(facts.every((f) => f.severity >= 0 && f.severity <= 1 && (f.direction === 1 || f.direction === -1)), 'every fact is a bounded severity with a signed direction')
  const sorted = [...facts].sort((a, b) => a.topic.localeCompare(b.topic))
  ok(JSON.stringify(facts) === JSON.stringify(sorted), 'facts arrive in topic order — push order can never change a ranking')
  const rich = { ...run, cash: 1_000_000_000 } as GameState
  ok(!readWeekFacts(rich).some((f) => f.topic === 'runway' && f.direction === -1), 'a billion in the bank is not a runway crisis — the facts move with the state')
  // The sign IS the fact (§64): a near-empty account must read as bad news at the source, or every
  // seat downstream celebrates a crisis. M10 in the ledger originally claimed §29 caught this — it
  // did not, because the §29 fixtures are hand-built facts. This is the assertion that does.
  const broke = { ...run, cash: 20_000, lastExpenses: 10_000, lastRevenue: 1_000 } as GameState
  const runwayFact = readWeekFacts(broke).find((f) => f.topic === 'runway')
  ok(runwayFact?.direction === -1 && runwayFact.severity > 0.8, 'two weeks of cash reads as a severe, BAD runway fact straight from the reader')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
