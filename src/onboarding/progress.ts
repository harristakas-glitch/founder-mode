// The onboarding ledger: what this player has already been told, and what they have already DONE.
//
// Three rules this file exists to enforce:
//
//   1. It lives under its OWN localStorage key and is never written into the game save. Onboarding
//      reads simulation state; it never writes anything the simulation reads. Deleting this key
//      restores a brand-new player and touches nothing else.
//   2. It is DURABLE ACROSS RUNS. A lesson the player has demonstrably outgrown — they have hired,
//      raised, pivoted, run an experiment, tokenised — must never be taught again, in this run or
//      any future one. That is the whole difference between a teacher and a nag.
//   3. It tolerates garbage. The value is user-writable text: every field is re-validated on read
//      and a malformed store degrades to "brand new player", never to a crash.

const KEY = 'fm-onboarding-v1'

/** Something the player has demonstrably done. Retires every lesson that lists it. */
export type SkillId =
  | 'advance'
  | 'hire'
  | 'decide'
  | 'allocate'
  | 'market'
  | 'raise'
  | 'pivot'
  | 'debt'
  | 'venture'
  | 'experiment'
  | 'interview'
  | 'conversation'
  | 'boardroom'
  | 'retain'
  | 'tokenise'

export interface OnboardingProgress {
  v: 1
  /** The single off switch. False = the whole notes layer is silent. */
  enabled: boolean
  /** Concept id -> the epoch ms it was delivered. Presence means "never show this again". */
  seen: Record<string, number>
  /** Skill id -> how many times it has been observed, summed over every run on this device. */
  skills: Record<string, number>
  /** Screen id -> how many times it has been opened. Drives the "you have never looked at…" notes. */
  visited: Record<string, number>
  /** Runs begun and runs played to an ending. */
  runs: { started: number; finished: number }
  /** Rate limiting: the run and game-week the counter below belongs to. */
  lastNoteRun: string
  lastNoteWeek: number
  /** How many notes have already been delivered in that run-week. Hard-capped by NOTES_PER_WEEK. */
  weekNotes: number
}

/**
 * The ceiling on how loud onboarding is allowed to be.
 *
 * One note is visible at a time and a note only appears when the player arrives somewhere new, so
 * this cap only bites on a player who tours every screen inside a single week — exactly the case
 * where a per-screen note would turn into a tour. Three is enough to cover the first week's real
 * questions (what is this loop, what are these sliders, what does hiring cost) and few enough that
 * the fourth screen is silent.
 */
export const NOTES_PER_WEEK = 3

const BLANK: OnboardingProgress = {
  v: 1,
  enabled: true,
  seen: {},
  skills: {},
  visited: {},
  runs: { started: 0, finished: 0 },
  lastNoteRun: '',
  lastNoteWeek: 0,
  weekNotes: 0,
}

/** Every value in a counter map coerced to a finite, non-negative number; anything else dropped. */
function counters(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n >= 0 && k.length <= 64) out[k] = n
  }
  return out
}

function sanitize(v: unknown): OnboardingProgress {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...BLANK }
  const o = v as Record<string, unknown>
  const runs = (o.runs ?? {}) as Record<string, unknown>
  const started = Number(runs.started)
  const finished = Number(runs.finished)
  const week = Number(o.lastNoteWeek)
  const weekNotes = Number(o.weekNotes)
  return {
    v: 1,
    // Only an explicit `false` turns the layer off — a missing key is a new player, not a mute.
    enabled: o.enabled !== false,
    seen: counters(o.seen),
    skills: counters(o.skills),
    visited: counters(o.visited),
    runs: {
      started: Number.isFinite(started) && started >= 0 ? started : 0,
      finished: Number.isFinite(finished) && finished >= 0 ? finished : 0,
    },
    lastNoteRun: typeof o.lastNoteRun === 'string' ? o.lastNoteRun.slice(0, 96) : '',
    lastNoteWeek: Number.isFinite(week) && week >= 0 ? week : 0,
    weekNotes: Number.isFinite(weekNotes) && weekNotes >= 0 ? Math.min(weekNotes, NOTES_PER_WEEK) : 0,
  }
}

let cache: OnboardingProgress | null = null

export function readProgress(): OnboardingProgress {
  if (cache) return cache
  try {
    cache = sanitize(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    cache = { ...BLANK }
  }
  return cache
}

// ---------- subscription ----------
//
// React reads this through useSyncExternalStore, so a write anywhere re-renders every note surface
// without the progress ledger having to become part of the game store (which is persisted into the
// save, and must not be).

const listeners = new Set<() => void>()

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The value identity useSyncExternalStore compares. Replaced on every write. */
export function snapshot(): OnboardingProgress {
  return readProgress()
}

function commit(next: OnboardingProgress) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Private mode, quota, a browser with storage disabled: the session still teaches correctly,
    // it just forgets between reloads. Never worth breaking the game over.
  }
  for (const fn of listeners) fn()
}

export function update(fn: (p: OnboardingProgress) => OnboardingProgress): void {
  commit(fn(readProgress()))
}

// ---------- the vocabulary the rest of the module speaks ----------

export const skillCount = (id: SkillId): number => readProgress().skills[id] ?? 0
export const hasSkill = (id: SkillId): boolean => skillCount(id) > 0
export const notesEnabled = (): boolean => readProgress().enabled
/** A player who has never finished a run is a first-timer, whatever else they have clicked. */
export const isFirstTimer = (): boolean => readProgress().runs.finished === 0

/** True while this run-week still has room under the cap. */
export function weekHasRoom(runId: string, week: number): boolean {
  const p = readProgress()
  if (p.lastNoteRun !== runId || p.lastNoteWeek !== week) return true
  return p.weekNotes < NOTES_PER_WEEK
}

export function markSeen(id: string, runId: string, week: number): void {
  update((p) => {
    const sameWeek = p.lastNoteRun === runId && p.lastNoteWeek === week
    return {
      ...p,
      seen: { ...p.seen, [id]: Date.now() },
      lastNoteRun: runId,
      lastNoteWeek: week,
      weekNotes: sameWeek ? p.weekNotes + 1 : 1,
    }
  })
}

/** Record demonstrated skills. Writes at most once per skill; counts saturate, never reset. */
export function recordSkills(ids: readonly SkillId[]): void {
  if (ids.length === 0) return
  const p = readProgress()
  const fresh = ids.filter((id) => !p.skills[id])
  if (fresh.length === 0) return
  const skills = { ...p.skills }
  for (const id of fresh) skills[id] = 1
  commit({ ...p, skills })
}

/** Count a skill that is meaningful as a TALLY rather than a yes/no — "how many decisions taken". */
export function tallySkill(id: SkillId, total: number): void {
  const p = readProgress()
  if ((p.skills[id] ?? 0) >= total) return
  commit({ ...p, skills: { ...p.skills, [id]: total } })
}

export function recordVisit(screen: string): void {
  const p = readProgress()
  commit({ ...p, visited: { ...p.visited, [screen]: (p.visited[screen] ?? 0) + 1 } })
}

export function recordRunStarted(): void {
  update((p) => ({ ...p, runs: { ...p.runs, started: p.runs.started + 1 } }))
}

export function recordRunFinished(): void {
  update((p) => ({ ...p, runs: { ...p.runs, finished: p.runs.finished + 1 } }))
}

export function setNotesEnabled(on: boolean): void {
  update((p) => ({ ...p, enabled: on }))
}

/** The "teach me again" button: forget every lesson, keep the record of what has been played. */
export function resetLessons(): void {
  update((p) => ({ ...p, enabled: true, seen: {}, lastNoteRun: '', lastNoteWeek: 0, weekNotes: 0 }))
}
