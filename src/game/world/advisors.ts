// The Advisor Opinion Engine — brief §28-§33 and the §76 panel.
//
// Advisors interpret the week; they never touch it. Everything below reads facts the simulation
// already resolved (cash, history, retention, the board's target) and produces prose plus a
// stance — no field the simulation reads is ever written, and there is deliberately no
// "recommendation engine": each seat weighs the same facts differently (§28), personality and
// incentive tilt the weighing (§31), and competence decides what a given advisor even notices
// (§30). Disagreement is therefore emergent, not scripted (§29).
//
// Determinism: the only randomness is the composer's per-message stream, keyed by
// (seed, narrative id), plus one judgement draw per seat keyed the same way. Nothing here reaches
// the engine's RNG hook, so composing the panel can never shift a simulation outcome.

import type { GameState } from '../types'
import { hasCapability } from '../modes'
import { composeNarrative, makeNarrativeRng, narrativeId } from './composer'
import { generateCharacter, employeeSpec, stableCastId, fullName, type CharacterSpec } from './characters'
import { relationshipWith } from './relationships'
import { ADVISOR_SHAPES, SEAT_DEFS, type AdvisorTopic } from './content/advisors'
import {
  LIVING_WORLD_LIMITS,
  type AdvisorPanelState,
  type AdvisorSeat,
  type AdvisorSkill,
  type AdvisorStance,
  type Character,
  type FragmentSlots,
  type LivingWorldState,
  type NarrativeUsageState,
} from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

// Formatted by hand, exactly like the composer's formatSlotValue: toLocaleString depends on the
// host's ICU build, and the same save must render the same sentence on every machine.
function usd(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.round(Math.abs(n)))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return `${sign}$${out}`
}

const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`

// ---------- the week, read as facts ----------

/**
 * One thing the week is saying, before anyone interprets it. `severity` is how loudly (0–1),
 * `direction` is whether it is good or bad news — the sign is a fact and no bias may flip it
 * (same contract as relationships.ts).
 */
export interface WeekFact {
  topic: AdvisorTopic
  severity: number
  direction: -1 | 1
  /** The actual numbers, preformatted, for §66-grade grounding. */
  slots: FragmentSlots
}

/**
 * Everything an advisor could talk about this week. Pure over GameState — no RNG, no clock —
 * and defensive about absence: a young run has no history and no board, and simply has fewer facts.
 */
export function readWeekFacts(s: GameState): WeekFact[] {
  const out: WeekFact[] = []
  const h = s.history
  const now = h.length >= 1 ? h[h.length - 1] : undefined
  const monthAgo = h.length >= 5 ? h[h.length - 5] : undefined

  // Runway — the fact §31 says makes CFOs conservative. Severity ramps as the weeks drain.
  const net = (s.lastExpenses || 0) - (s.lastRevenue || 0)
  if (net > 0 && s.cash > 0) {
    const runway = s.cash / net
    if (runway < 30) {
      const weeks = Math.max(0, Math.floor(runway))
      out.push({
        topic: 'runway',
        severity: clamp01((30 - runway) / 26),
        direction: -1,
        // Preformatted so no fragment has to pluralise, and "0 weeks" reads as the emergency it is.
        slots: { runway: weeks === 1 ? '1 week' : `${weeks} weeks` },
      })
    }
  } else if (net <= 0 && s.lastRevenue > 200) {
    out.push({
      topic: 'profit',
      severity: 0.5,
      direction: 1,
      slots: { revenue: usd(s.lastRevenue), expenses: usd(s.lastExpenses) },
    })
  }
  if (net > 0 && s.lastRevenue > 500 && s.lastExpenses > s.lastRevenue * 2.5)
    out.push({
      topic: 'profit',
      severity: clamp01((s.lastExpenses / s.lastRevenue - 2.5) / 3),
      direction: -1,
      slots: { revenue: usd(s.lastRevenue), expenses: usd(s.lastExpenses) },
    })

  // Growth — average weekly rate over the last month, the same window the Dashboard shows.
  let growth: number | undefined
  if (now && monthAgo && monthAgo.users > 20) {
    growth = clamp((now.users - monthAgo.users) / monthAgo.users / 4, -0.5, 0.5)
    if (now.users > 30) {
      const direction = growth >= 0.03 ? 1 : -1
      const severity = clamp01(Math.abs(growth - 0.03) / 0.1)
      if (severity > 0.1)
        out.push({ topic: 'growth', severity, direction: direction as 1 | -1, slots: { growth: pct(growth) } })
    }
  }

  // Retention — Career's measured four-week number when it exists. Deliberately no synthetic
  // fallback: an advisor quoting a retention figure the run never measured would be invented data.
  const career = s.career
  if (career) {
    const retention = career.retentionBySegment[career.primaryTargetSegmentId]
    if (typeof retention === 'number' && retention > 0) {
      const direction = retention >= 0.7 ? 1 : -1
      const severity = clamp01(Math.abs(retention - 0.7) / 0.3)
      if (severity > 0.12)
        out.push({
          topic: 'retention',
          severity,
          direction: direction as 1 | -1,
          slots: { retention: `${Math.round(retention * 100)}%` },
        })
    }
  }

  // Quality — bugs are churn with a lag; a clean product at scale is worth saying out loud.
  if (s.bugs > 50)
    out.push({ topic: 'quality', severity: clamp01((s.bugs - 50) / 40), direction: -1, slots: { bugs: Math.round(s.bugs) } })
  else if (s.quality > 70 && s.bugs < 20 && s.users > 50)
    out.push({
      topic: 'quality',
      severity: clamp01((s.quality - 70) / 30) * 0.6,
      direction: 1,
      slots: { quality: Math.round(s.quality), bugs: Math.round(s.bugs) },
    })

  // PMF — measured against the same pace curve the Dashboard benchmarks against.
  const pace = Math.min(85, s.week * 1.6)
  if (s.week > 6 && s.pmf < pace * 0.6)
    out.push({
      topic: 'pmf',
      severity: clamp01(1 - s.pmf / Math.max(1, pace * 0.6)),
      direction: -1,
      slots: { pmf: Math.round(s.pmf), pace: Math.round(pace), week: s.week },
    })
  else if (s.pmf >= 60)
    out.push({ topic: 'pmf', severity: clamp01((s.pmf - 60) / 30) * 0.7, direction: 1, slots: { pmf: Math.round(s.pmf) } })

  // Marketing efficiency — §29's CAC axis, as a real month-over-month comparison off the history
  // the run already keeps (users added per marketing dollar, now vs a month ago).
  if (now && monthAgo && s.marketingSpend >= 1000 && h.length >= 6) {
    const prev = h[h.length - 2]
    const addedNow = now.users - prev.users
    const addedThen = h[h.length - 5].users - h[h.length - 6].users
    const perDollarNow = now.marketing > 0 ? addedNow / now.marketing : 0
    const perDollarThen = h[h.length - 5].marketing > 0 ? addedThen / h[h.length - 5].marketing : 0
    if (perDollarThen > 0 && perDollarNow < perDollarThen * 0.55)
      out.push({
        topic: 'marketing',
        severity: clamp01(1 - perDollarNow / perDollarThen),
        direction: -1,
        slots: { marketing: usd(s.marketingSpend), added: Math.max(0, Math.round(addedNow)) },
      })
    else if (perDollarNow > 0 && perDollarThen > 0 && perDollarNow > perDollarThen * 1.6)
      out.push({
        topic: 'marketing',
        severity: clamp01(perDollarNow / perDollarThen - 1) * 0.5,
        direction: 1,
        slots: { marketing: usd(s.marketingSpend), added: Math.max(0, Math.round(addedNow)) },
      })
  }

  // Morale — output follows it with a lag, which is exactly when a warning is still cheap.
  if (s.employees.length > 0) {
    const morale = s.employees.reduce((a, e) => a + e.morale, 0) / s.employees.length
    if (morale < 50)
      out.push({ topic: 'morale', severity: clamp01((50 - morale) / 30), direction: -1, slots: { morale: Math.round(morale) } })
    else if (morale > 78)
      out.push({ topic: 'morale', severity: clamp01((morale - 78) / 20) * 0.5, direction: 1, slots: { morale: Math.round(morale) } })
  }

  // The board's commitment — the one fact with a deadline attached.
  if (s.board && growth !== undefined) {
    const target = s.board.targetGrowth
    if (growth < target)
      out.push({
        topic: 'board',
        severity: clamp01(((target - growth) / Math.max(0.005, target)) * (1 + s.board.strikes * 0.35)),
        direction: -1,
        slots: { target: pct(target), growth: pct(growth), strikes: s.board.strikes },
      })
    else out.push({ topic: 'board', severity: 0.3, direction: 1, slots: { target: pct(target) } })
  }

  // The funding market — macro context both money seats watch.
  if (s.climate < -0.5) out.push({ topic: 'market', severity: clamp01((-s.climate - 0.5) / 0.5), direction: -1, slots: {} })
  else if (s.climate > 0.6) out.push({ topic: 'market', severity: clamp01((s.climate - 0.6) / 0.4) * 0.6, direction: 1, slots: {} })

  // Sorted by topic so the caller's ranking can never depend on push order.
  return out.sort((a, b) => a.topic.localeCompare(b.topic))
}

// ---------- who holds each seat ----------

/** The finance seat: a generated person, because the sim has no CFO on payroll. Persisted like anyone. */
const CFO_SPEC = (s: GameState): CharacterSpec => ({
  id: 'adv:cfo',
  role: 'advisor',
  title: 'Fractional CFO',
  index: 90,
  sector: s.config?.sector,
})

/** The investor seat exists only once outside money owns a piece of you — a fact, not a choice. */
const BOARD_SPEC = (s: GameState): CharacterSpec => ({
  id: 'adv:board',
  role: 'board_member',
  title: 'Lead investor',
  index: 91,
  sector: s.config?.sector,
})

/** Deterministic "who speaks for this discipline": best skill, name as the replay-stable tiebreak. */
function bestEmployee(s: GameState, roles: readonly string[]) {
  const pool = s.employees.filter((e) => roles.includes(e.role))
  if (pool.length === 0) return undefined
  return [...pool].sort((a, b) => b.skill - a.skill || a.name.localeCompare(b.name) || a.role.localeCompare(b.role))[0]
}

export interface SeatHolder {
  seat: AdvisorSeat
  spec: CharacterSpec
  /** The sim's 1–10 skill when the seat is held by an employee — feeds §30 competence. */
  simSkill?: number
}

/** Which seats exist this week and who sits in them. Facts of the run: no employee, no seat. */
export function seatHolders(s: GameState): SeatHolder[] {
  const out: SeatHolder[] = [{ seat: 'finance', spec: CFO_SPEC(s) }]
  const growth = bestEmployee(s, ['marketer', 'sales'])
  if (growth)
    out.push({
      seat: 'growth',
      spec: { ...employeeSpec(growth, { week: s.week, sector: s.config?.sector }), id: stableCastId('emp', growth.name, growth.role) },
      simSkill: growth.skill,
    })
  const product = bestEmployee(s, ['engineer', 'designer'])
  if (product)
    out.push({
      seat: 'product',
      spec: { ...employeeSpec(product, { week: s.week, sector: s.config?.sector }), id: stableCastId('emp', product.name, product.role) },
      simSkill: product.skill,
    })
  if (s.board) out.push({ seat: 'investor', spec: BOARD_SPEC(s) })
  return out
}

/** The non-employee seats, for the cast reconciler: these people persist between weeks. */
export function advisorCastSpecs(s: GameState): CharacterSpec[] {
  const specs: CharacterSpec[] = [CFO_SPEC(s)]
  if (s.board) specs.push(BOARD_SPEC(s))
  return specs
}

// ---------- competence (§30) ----------

const STAGE_EXPERTISE = { rising: 48, established: 62, veteran: 74 } as const

/**
 * Derived from the person, never stored — a second copy would drift from the character. The sim's
 * own skill number dominates when the seat is held by an employee, so hiring better people buys
 * you better advice, which is the §30 loop the phase exists for.
 */
export function advisorSkill(c: Character, simSkill?: number): AdvisorSkill {
  const p = c.personality
  const b = c.background
  let expertise = STAGE_EXPERTISE[b.careerStage] + clamp(b.yearsExperience, 0, 30) * 0.4
  if (simSkill !== undefined) expertise += (clamp(simSkill, 1, 10) - 5.5) * 5
  if (b.notableStrength === 'data_driven' || b.notableStrength === 'operational_rigour') expertise += 6

  // Judgement is temperament: patience to wait for the signal, low enough ego to read it straight.
  let judgement = 0.4 * p.patience + 0.35 * (100 - p.ego) + 0.25 * p.directness
  if (b.careerStage === 'veteran') judgement += 8

  let forecasting = 45 + (p.patience - 50) * 0.15
  if (c.communicationStyle === 'analytical') forecasting += 16
  if (c.communicationStyle === 'cautious') forecasting += 8
  if (c.communicationStyle === 'enthusiastic') forecasting -= 8
  if (b.notableStrength === 'data_driven') forecasting += 12
  if (b.notableStrength === 'first_principles') forecasting += 8

  return {
    functionalExpertise: Math.round(clamp(expertise, 5, 95)),
    judgement: Math.round(clamp(judgement, 5, 95)),
    forecasting: Math.round(clamp(forecasting, 5, 95)),
  }
}

// ---------- bias (§31) ----------

/**
 * How loudly this person feels this fact. Personality and motivation tilt the volume — an
 * optimist under-hears bad news, a win-hungry seller over-hears momentum — but never the sign,
 * and the multiplier is bounded so no temperament is deaf.
 */
export function biasMultiplier(c: Character, fact: WeekFact): number {
  const p = c.personality
  let m = 1
  if (fact.direction < 0) {
    m *= 1 - (p.optimism - 50) / 250
    if (fact.topic === 'runway' || fact.topic === 'market') m *= 1 - (p.riskTolerance - 50) / 250
  } else {
    m *= 1 + (p.optimism - 50) / 400
  }
  const motives = [c.motivations.primary, ...c.motivations.secondary]
  if (fact.topic === 'growth' || fact.topic === 'marketing') {
    if (c.motivations.primary === 'winning' || c.motivations.primary === 'status') m *= 1.25
    else if (motives.includes('winning') || motives.includes('status')) m *= 1.1
  }
  if (fact.direction < 0 && motives.includes('stability')) m *= 1.15
  return clamp(m, 0.5, 1.6)
}

// ---------- picking what a seat talks about ----------

export interface SeatPick {
  fact: WeekFact
  stance: AdvisorStance
}

/** Below this weighted score a seat has nothing worth saying — a quiet week stays quiet. */
export const SPEAK_FLOOR = 0.045

/**
 * The seat's read of the week. Deterministic given the rng stream: `rng` is consumed exactly once
 * (the §30 judgement draw), so the pick cannot depend on how many facts the week produced.
 */
export function pickSeatOpinion(
  seat: AdvisorSeat,
  character: Character,
  skill: AdvisorSkill,
  facts: readonly WeekFact[],
  rng: () => number,
): SeatPick | undefined {
  const def = SEAT_DEFS[seat]
  const slip = rng() // drawn unconditionally: a judgement draw per seat per week, always one

  const ranked = facts
    .map((fact) => {
      const weight = def.weights[fact.topic] ?? 0
      // §30: weak functional expertise under-reads the week — signals get missed, reactions late.
      const felt = fact.severity * (0.7 + skill.functionalExpertise / 250) * biasMultiplier(character, fact)
      return { fact, felt, score: felt * weight }
    })
    .filter((r) => r.score >= SPEAK_FLOOR)
    // §30: early, still-quiet signals (felt under 0.35) need real forecasting to be noticed at all.
    .filter((r) => r.felt >= 0.35 || skill.forecasting >= 60)
    .sort((a, b) => b.score - a.score || a.fact.topic.localeCompare(b.fact.topic))

  if (ranked.length === 0) return undefined

  // §30: poor judgement sometimes voices the second-loudest thing — plausible, never absurd,
  // because everything in `ranked` already cleared the floor.
  const slipChance = clamp01((55 - skill.judgement) / 120)
  const chosen = ranked.length > 1 && slip < slipChance ? ranked[1] : ranked[0]

  const stanceDef = def.stances[chosen.fact.topic]
  const stance: AdvisorStance = stanceDef
    ? chosen.fact.direction < 0
      ? stanceDef.bad
      : stanceDef.good
    : chosen.fact.direction < 0
      ? 'warn'
      : 'hold'
  return { fact: chosen.fact, stance }
}

// ---------- the panel ----------

/**
 * Week-over-week repetition control, self-contained: last week's fragment ids go on cooldown, and
 * NOTHING is folded into world.narrative.usage — advisor wording must never change which fragment
 * the inbox beat draws, or the capabilities stop being independent switches.
 */
function panelUsage(prev: AdvisorPanelState | undefined): NarrativeUsageState {
  const recent: string[] = []
  for (const o of prev?.opinions ?? []) recent.push(...o.fragmentIds)
  return { recentFragmentIds: recent, recentTags: [], recentPatterns: [], lastUsedWeek: {} }
}

/**
 * §76's "What the team thinks", built once per resolved week (the caller sits inside the
 * shouldGenerateForWeek guard). Reads only facts; writes only world.advisorPanel.
 */
export function buildAdvisorPanel(s: GameState, world: LivingWorldState, seed: number): AdvisorPanelState {
  const facts = readWeekFacts(s)
  const panel: AdvisorPanelState = { week: s.week, opinions: [] }
  if (facts.length === 0) return panel

  const usage = panelUsage(world.advisorPanel)
  const relationshipsOn = hasCapability(s, 'relationships')
  // Hard within-week exclusion: a sentence spoken by one seat is off the table for the rest of
  // the panel. Cooldowns only bias; on a hot week two seats read the same fact, and biasing was
  // observed letting them read the same LINE (growth and product both quoting the growth context).
  const spokenThisWeek: string[] = []

  for (const holder of seatHolders(s)) {
    if (panel.opinions.length >= LIVING_WORLD_LIMITS.advisorOpinions) break
    // The persisted person when the cast keeps one; the identical generated person when it does
    // not (generation is pure in (seed, spec), so the two never disagree about who this is).
    const character =
      world.characters[holder.spec.id] ?? generateCharacter({ seed, ...holder.spec, createdWeek: holder.spec.createdWeek ?? s.week })
    if (character.status === 'departed') continue

    const skill = advisorSkill(character, holder.simSkill)
    const id = narrativeId(s.week, 'advisor', holder.seat)
    const pick = pickSeatOpinion(holder.seat, character, skill, facts, makeNarrativeRng(seed, `${id}_judgement`))
    if (!pick) continue

    const composed = composeNarrative({
      seed,
      week: s.week,
      surface: 'advice',
      beatKey: `advisor_${holder.seat}`,
      audience: 'advisor',
      id,
      character,
      relationship: relationshipsOn ? relationshipWith(character, s.week) : undefined,
      tags: [holder.seat, pick.fact.topic, pick.stance, pick.fact.direction < 0 ? 'bad' : 'good'],
      slots: { company: s.companyName, ...pick.fact.slots },
      memory: null, // the panel is this week's read; callbacks belong to the inbox
      usage,
      shapes: ADVISOR_SHAPES,
      exclude: spokenThisWeek,
      capabilities: s.capabilities,
    })
    if (!composed || !composed.subject || !composed.body) continue

    spokenThisWeek.push(...composed.fragmentIds)

    panel.opinions.push({
      id: composed.id,
      seat: holder.seat,
      characterId: character.id,
      speaker: fullName(character),
      title: character.title ?? SEAT_DEFS[holder.seat].label,
      topic: pick.fact.topic,
      stance: pick.stance,
      headline: composed.subject,
      detail: composed.body,
      direction: pick.fact.direction,
      fragmentIds: composed.fragmentIds,
    })
  }
  return panel
}
