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

/** Weeks between check-ins. Every week was noise; a month makes it an event you notice. */
export const BEAT_INTERVAL_WEEKS = 4

/**
 * A colleague raises something with you. Deliberately a CHOICE, not a news item: the composer
 * writes people asking for things ("put me in front of the board once, that is the whole ask"),
 * and a request the player cannot answer is worse than no message at all — it reads as a broken
 * game. The Narrative Director (brief §24) will decide what deserves attention and with what
 * weight; until it lands this is a fixed cadence with a rotating speaker.
 */
function composeWeeklyBeat(s: GameState, world: LivingWorldState, seed: number): void {
  if (s.week % BEAT_INTERVAL_WEEKS !== 0) return

  const cast = sortedCharacterIds(world)
    .map((id) => world.characters[id])
    .filter((c) => c && c.status === 'active' && c.role === 'employee')
  if (cast.length === 0) return

  // Rotate. Picking the longest-serving employee meant the same person spoke every single time,
  // for the whole run — the fastest way to make a cast of characters feel like one stuck NPC.
  const speaker = cast[Math.floor(s.week / BEAT_INTERVAL_WEEKS) % cast.length]

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

  // The composed id is already unique and deterministic, so it doubles as the message id — and
  // avoids importing uid() from the engine, which would close an import cycle (engine → tick).
  const id = composed.id
  // Map back to the SIMULATION's employee: `target.morale` is applied by resolveChoiceOnState via
  // meta.employeeId, and our cast ids are derived, so without this the per-person consequence
  // would silently do nothing.
  const employee = s.employees.find((e) => stableCastId('emp', e.name, e.role) === speaker.id)
  s.inbox.unshift({
    id,
    week: s.week,
    kind: 'choice',
    title: `${fullName(speaker)} wants a word`,
    body: `${composed.subject}\n\n${composed.body}`,
    choices: [
      {
        label: 'Make the time — hear them out properly',
        resultText: `You block an hour. ${speaker.firstName} leaves lighter than they arrived, and the room notices.`,
        effects: { morale: 4 },
        target: { morale: 10 },
      },
      {
        label: 'Not this week — you have a company to run',
        resultText: `"Sure. Whenever." ${speaker.firstName} says it kindly, and means it less than they did last time.`,
        effects: { morale: -2 },
        target: { morale: -12 },
      },
    ],
    meta: employee ? { employeeId: employee.id } : undefined,
  })

  // Record AFTER emitting. Without this the usage buffers stay empty, every fragment stays off
  // cooldown forever, and the composer keeps re-picking its favourites — which is exactly how the
  // same subject line came back four weeks later with half the same body.
  world.narrative = recordNarrative(world.narrative, composed, id)
}

export { characterIdentityKey }
