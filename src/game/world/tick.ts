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
import { composeNarrative } from './composer'
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

/**
 * One composed message a week, at most. The Narrative Director (brief §24) decides what deserves
 * attention and is a later phase; until it exists this picks the longest-serving active employee,
 * which is deterministic and gives the composer a real character with real memories to draw on.
 */
function composeWeeklyBeat(s: GameState, world: LivingWorldState, seed: number): void {
  const ids = sortedCharacterIds(world)
  const speaker = ids
    .map((id) => world.characters[id])
    .filter((c) => c && c.status === 'active' && c.role === 'employee')
    .sort((a, b) => a.createdWeek - b.createdWeek || a.id.localeCompare(b.id))[0]
  if (!speaker) return

  const composed = composeNarrative({
    seed,
    week: s.week,
    surface: 'inbox',
    beatKey: 'weekly_checkin',
    audience: 'employee',
    character: speaker,
    capabilities: s.capabilities,
    usage: world.narrative.usage,
    slots: { company: s.companyName, name: speaker.firstName },
  })
  if (!composed) return

  s.inbox.unshift({
    id: composed.id,
    week: s.week,
    kind: 'news',
    title: `${fullName(speaker)} — ${composed.subject}`,
    body: composed.body,
  })
}

export { characterIdentityKey }
