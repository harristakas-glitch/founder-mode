// The living world's weekly step.
//
// This is the ONLY entry point the simulation calls, and it runs at the very end of advanceWeek —
// after every fact for the week already exists. The brief's central rule (§"Core architecture",
// §64) is that narrative interprets facts and never decides them, so nothing in here or anything
// it calls may write to a field the simulation reads: users, cash, pmf, quality, bugs, features,
// hype, reputation, morale, employees, rivals, candidates. It appends to `s.world` and, when
// `proceduralNarrative` is on, to `s.inbox`.
//
// Every stage is independently capability-gated. With all of them off this function returns
// immediately and the game is byte-for-byte what it was before the system existed.

import { hasCapability } from '../modes'
import type { GameState } from '../types'
import {
  candidateSpec,
  characterIdentityKey,
  ensureCast,
  employeeSpec,
  founderSpec,
  fullName,
  rivalSpec,
} from './characters'
import { composeNarrative, recordNarrative } from './composer'
import { directWeek, type NarrativeCandidate } from './director'
import { recordCompanyMemory, sortedCharacterIds } from './memory'
import { emptyLivingWorld, enforceLivingWorldLimits, markWeekGenerated, shouldGenerateForWeek } from './persistence'
import { tickRelationship, upsertRelationship } from './relationships'
import type { CharacterSpec } from './characters'
import type { LivingWorldState, MemoryType } from './types'

/** True when any part of the living world is switched on for this run. */
export function livingWorldActive(s: GameState): boolean {
  return (
    hasCapability(s, 'persistentCharacters') ||
    hasCapability(s, 'characterMemory') ||
    hasCapability(s, 'companyMemory') ||
    hasCapability(s, 'relationships') ||
    hasCapability(s, 'proceduralNarrative')
  )
}

/**
 * A cast id that survives a replay. The simulation's own ids come from `uid()`, which mixes
 * Date.now() and Math.random() — fine for a runtime handle, useless as an identity, because the
 * same seed would produce a differently-keyed cast on every run and no persisted world could ever
 * be matched back to its people. Names ARE seeded, so they are the stable part; job role and skill
 * disambiguate the rare collision.
 */
function stableCastId(kind: string, name: string, extra: string | number = ''): string {
  return `${kind}:${name}${extra === '' ? '' : `:${extra}`}`.toLowerCase().replace(/\s+/g, '_')
}

/** Who the simulation currently knows about, as generation specs with replay-stable ids. */
function castSpecs(s: GameState): CharacterSpec[] {
  const specs: CharacterSpec[] = [founderSpec(s.founderKind, { name: s.companyName })]
  for (const e of s.employees) specs.push({ ...employeeSpec(e), id: stableCastId('emp', e.name, e.role) })
  for (const c of s.candidates) specs.push({ ...candidateSpec(c), id: stableCastId('cand', c.name, c.role) })
  const seed = s.config?.seed ?? 0
  // companyId too: rivalSpec carries the rival's uid() through, which is the same replay hazard.
  for (const r of s.rivals)
    if (r.alive)
      specs.push({ ...rivalSpec(seed, r), id: stableCastId('rival', r.name), companyId: stableCastId('co', r.name) })
  return specs
}

/**
 * Company milestones worth remembering, read off state the simulation already computed. Every one
 * of these is a fact, not a judgement — `recordCompanyMemory` itself refuses to overwrite a
 * once-only type, so "first revenue" keeps the week it actually happened.
 */
function recordMilestones(world: LivingWorldState, s: GameState, personal: boolean): void {
  // `remember` also writes the moment into the cast's own memory, which is what later lets someone
  // say "since we landed the first customer". Only when characterMemory is on — company history
  // and personal recollection are separately gated.
  const felt = (summaryKey: string, type: MemoryType, tags: string[]) =>
    personal ? { remember: { summaryKey, type, tags } } : {}
  if (s.employees.length > 0) recordCompanyMemory(world, s.week, 'first_hire', felt('first_hire', 'hire', ['hiring']))
  if (s.lastRevenue > 0) recordCompanyMemory(world, s.week, 'first_revenue', felt('first_revenue', 'success', ['revenue']))
  if (s.users > 0) recordCompanyMemory(world, s.week, 'first_customer', felt('first_customer', 'success', ['customers']))
  if (s.pmf >= 60) recordCompanyMemory(world, s.week, 'pmf', felt('pmf', 'success', ['pmf']))
  if (s.lastRevenue > s.lastExpenses && s.lastExpenses > 0)
    recordCompanyMemory(world, s.week, 'profitability', felt('profitability', 'success', ['revenue']))
}

export function tickLivingWorld(s: GameState): void {
  if (!livingWorldActive(s)) return
  const seed = s.config?.seed
  if (seed === undefined) return // a legacy in-flight save has no seed; generating here would not replay

  const world: LivingWorldState = s.world ?? emptyLivingWorld()
  s.world = world

  // One pass per week. advanceWeek can run several times in a catch-up loop when an Arena client
  // rejoins, and a cast reconciled twice for the same week would double-count relationship drift.
  if (!shouldGenerateForWeek(world, s.week)) return
  markWeekGenerated(world, s.week)

  if (hasCapability(s, 'persistentCharacters')) {
    world.characters = ensureCast(seed, world.characters, castSpecs(s), s.week, {
      // Employees leave; the founder and rivals are managed elsewhere and must not be buried just
      // because they are absent from this week's specs. Candidates share the 'employee' role and
      // are retired by the same rule when they rotate out of the pool.
      retireMissingRoles: ['employee'],
    })
  }

  if (hasCapability(s, 'companyMemory')) recordMilestones(world, s, hasCapability(s, 'characterMemory'))

  if (hasCapability(s, 'relationships')) {
    for (const id of sortedCharacterIds(world)) {
      const c = world.characters[id]
      if (!c || c.status === 'departed') continue
      // Persist unconditionally, not only when it moved: the first tick is what CREATES the
      // relationship from the character's baseline, and that one never "moves".
      const change = tickRelationship(c, s.week)
      world.characters[id] = upsertRelationship(c, change.after)
    }
  }

  if (hasCapability(s, 'proceduralNarrative')) composeWeeklyBeat(s, world, seed)

  enforceLivingWorldLimits(world)
}

/** Weeks between colleague check-ins. Every week was noise; a month makes it an event. */
export const BEAT_INTERVAL_WEEKS = 4

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Turn the week that just happened into things worth narrating. Reads only facts the simulation
 * already computed — this decides nothing, it observes. The Director then scores them.
 */
function weekCandidates(s: GameState, world: LivingWorldState): NarrativeCandidate[] {
  const out: NarrativeCandidate[] = []
  const h = s.history
  const prev = h.length >= 2 ? h[h.length - 2] : undefined
  const now = h[h.length - 1]
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`

  if (now && prev) {
    const revDelta = now.revenue - prev.revenue
    const revPct = prev.revenue > 0 ? revDelta / prev.revenue : revDelta > 0 ? 1 : 0
    if (revPct >= 0.25 && revDelta > 200)
      out.push({
        id: `rev_up_${s.week}`, type: 'revenue_jump', category: 'recognition',
        financialImpact: clamp01(Math.abs(revPct)), strategicImpact: 0.3, relationshipImpact: 0.2,
        competitiveImpact: 0.2, urgency: 0.1, novelty: 0, callbackValue: 0.2,
        tags: ['revenue', 'good_week'], slots: { amount: money(now.revenue), delta: `${Math.round(revPct * 100)}%` },
      })
    if (revPct <= -0.2 && prev.revenue > 200)
      out.push({
        id: `rev_down_${s.week}`, type: 'revenue_drop', category: 'warning',
        financialImpact: clamp01(Math.abs(revPct)), strategicImpact: 0.4, relationshipImpact: 0.3,
        competitiveImpact: 0.2, urgency: 0.5, novelty: 0, callbackValue: 0.3,
        tags: ['revenue', 'bad_week'], slots: { amount: money(now.revenue), delta: `${Math.round(revPct * 100)}%` },
      })
    const userPct = prev.users > 0 ? (now.users - prev.users) / prev.users : 0
    if (userPct >= 0.3 && now.users > 40)
      out.push({
        id: `users_${s.week}`, type: 'user_surge', category: 'opportunity',
        financialImpact: 0.3, strategicImpact: 0.4, relationshipImpact: 0.2, competitiveImpact: 0.4,
        urgency: 0.2, novelty: 0, callbackValue: 0.1, tags: ['growth', 'good_week'],
        slots: { amount: `${Math.round(now.users).toLocaleString()}` },
      })
  }

  // Runway: the only fact that is genuinely urgent, so it is the only one with urgency near 1.
  const burn = Math.max(1, (s.lastExpenses || 0) - (s.lastRevenue || 0))
  const runway = s.cash / burn
  if (runway < 14 && s.cash > 0)
    out.push({
      id: `runway_${s.week}`, type: 'runway_crisis', category: 'escalation',
      financialImpact: 0.9, strategicImpact: 0.7, relationshipImpact: 0.5, competitiveImpact: 0.1,
      urgency: clamp01(1 - runway / 14), novelty: 0, callbackValue: 0.2,
      tags: ['cash', 'bad_week'], slots: { amount: `${Math.floor(runway)}` },
    })

  const morale = s.employees.length ? s.employees.reduce((a, e) => a + e.morale, 0) / s.employees.length : 100
  if (morale < 45 && s.employees.length > 0)
    out.push({
      id: `morale_${s.week}`, type: 'morale_crisis', category: 'concern',
      financialImpact: 0.2, strategicImpact: 0.4, relationshipImpact: 0.9, competitiveImpact: 0.1,
      urgency: 0.5, novelty: 0, callbackValue: 0.4, tags: ['team', 'bad_week'],
      slots: { amount: `${Math.round(morale)}` },
    })

  if (s.bugs > 60)
    out.push({
      id: `bugs_${s.week}`, type: 'quality_crisis', category: 'warning',
      financialImpact: 0.3, strategicImpact: 0.5, relationshipImpact: 0.4, competitiveImpact: 0.3,
      urgency: 0.5, novelty: 0, callbackValue: 0.2, tags: ['product', 'bad_week'],
    })

  const ahead = s.rivals.filter((r) => r.alive && r.users > s.users).length
  if (ahead > 0 && s.users > 0)
    out.push({
      id: `rivals_${s.week}`, type: 'rival_pressure', category: 'warning',
      financialImpact: 0.2, strategicImpact: 0.5, relationshipImpact: 0.1,
      competitiveImpact: clamp01(0.4 + ahead * 0.2), urgency: 0.3, novelty: 0, callbackValue: 0.2,
      tags: ['rivals'], slots: { amount: `${ahead}` },
    })

  if (s.climate < -0.6)
    out.push({
      id: `climate_${s.week}`, type: 'funding_winter', category: 'warning',
      financialImpact: 0.5, strategicImpact: 0.6, relationshipImpact: 0.1, competitiveImpact: 0.2,
      urgency: 0.3, novelty: 0, callbackValue: 0.3, tags: ['funding', 'macro'],
    })

  // A colleague raising something. Kept on a cadence so the cast does not talk over the company.
  if (s.week % BEAT_INTERVAL_WEEKS === 0 && hasCapability(s, 'relationships')) {
    const cast = sortedCharacterIds(world)
      .map((id) => world.characters[id])
      .filter((c) => c && c.status === 'active' && c.role === 'employee')
    if (cast.length > 0) {
      const speaker = cast[Math.floor(s.week / BEAT_INTERVAL_WEEKS) % cast.length]
      out.push({
        id: `checkin_${s.week}`, type: 'team_request', category: 'request',
        financialImpact: 0.05, strategicImpact: 0.2, relationshipImpact: 0.75, competitiveImpact: 0,
        urgency: 0.2, novelty: 0, callbackValue: 0.5, tags: ['team'],
        characterId: speaker.id, slots: { name: speaker.firstName },
      })
    }
  }

  return out
}

/** Render one directed candidate into the inbox. Returns the message id, or null if nothing composed. */
function emit(s: GameState, world: LivingWorldState, seed: number, c: NarrativeCandidate, lead: boolean): void {
  const speaker = c.characterId ? world.characters[c.characterId] : undefined
  const composed = composeNarrative({
    seed,
    week: s.week,
    surface: 'inbox',
    beatKey: c.type,
    // Company-level facts are narrated as coverage; a named person speaks as themselves.
    audience: speaker ? 'employee' : 'media',
    character: speaker,
    capabilities: s.capabilities,
    usage: world.narrative.usage,
    tags: c.tags,
    slots: { company: s.companyName, ...(c.slots ?? {}) },
  })
  if (!composed) return

  // A request needs an answer. Shipping people who ask for things with no way to reply is the
  // failure this phase is correcting, so anything in the 'request' category becomes a choice.
  const employee = speaker ? s.employees.find((e) => stableCastId('emp', e.name, e.role) === speaker.id) : undefined
  const asChoice = c.category === 'request' && !!speaker

  s.inbox.unshift({
    id: composed.id,
    week: s.week,
    kind: asChoice ? 'choice' : 'news',
    title: speaker ? `${fullName(speaker)} wants a word` : lead ? composed.subject : `Also this week — ${composed.subject}`,
    body: speaker ? `${composed.subject}\n\n${composed.body}` : composed.body,
    ...(asChoice
      ? {
          choices: [
            {
              label: 'Make the time — hear them out properly',
              resultText: `You block an hour. ${speaker!.firstName} leaves lighter than they arrived, and the room notices.`,
              effects: { morale: 4 },
              target: { morale: 10 },
            },
            {
              label: 'Not this week — you have a company to run',
              resultText: `"Sure. Whenever." ${speaker!.firstName} says it kindly, and means it less than they did last time.`,
              effects: { morale: -2 },
              target: { morale: -12 },
            },
          ],
          meta: employee ? { employeeId: employee.id } : undefined,
        }
      : {}),
  })

  // Record AFTER emitting. Without this the usage buffers stay empty, every fragment stays off
  // cooldown forever, and the composer keeps re-picking its favourites.
  world.narrative = recordNarrative(world.narrative, composed, composed.id)
}

/**
 * Brief §24/§26: the Director decides what leads the week and what merely also happened. Replaces
 * the fixed-cadence placeholder, which picked a person on a timer rather than picking a story.
 */
function composeWeeklyBeat(s: GameState, world: LivingWorldState, seed: number): void {
  const depth = s.capabilities?.relationships ? 'deep' : hasCapability(s, 'pvpActions') ? 'competitive' : 'light'
  const directed = directWeek(weekCandidates(s, world), { week: s.week, depth, lastSeen: world.narrativeLastSeen ?? {} })
  if (!directed.major) return // a quiet week stays quiet

  const seen: Record<string, number> = { ...(world.narrativeLastSeen ?? {}) }
  emit(s, world, seed, directed.major, true)
  seen[directed.major.type] = s.week
  for (const also of directed.secondary) {
    emit(s, world, seed, also, false)
    seen[also.type] = s.week
  }
  world.narrativeLastSeen = seen
}

export { characterIdentityKey }
