// The event list. One exported function per event, typed, named after what happened.
//
// There is deliberately no `track('whatever')` in this codebase. An analytics layer built out of
// string literals scattered through the UI decays in a predictable way: the same concept gets two
// spellings, a rename lands in three of five call sites, and six months later nobody can answer
// "what do we actually collect?" without grepping. So the answer to that question is this file,
// top to bottom, and every call site imports a function.
//
// EVERY EVENT MAPS TO A QUESTION. The four the owner asked, and the design questions behind them:
//
//   Q1 VISITORS          app_opened
//   Q2 GAMES PLAYED      run_started · run_ended · run_abandoned
//   Q3 PLAYING TIME      run_progress · run_suspended  (weeks advanced — see the note below)
//   Q4 RETENTION         app_opened + run_started, once consent gives them a persistent id
//   DESIGN               screen_opened · feature_used · note_seen · notes_toggled
//   OPS                  analytics_consent_set · run_journal_uploaded
//
// WHY WEEKS AND NOT MINUTES. This is a turn-based game. A tab left open over lunch is an hour of
// "session duration" and zero play; a player who advances forty weeks in twenty minutes was
// gripped. PostHog will record wall-clock session length on its own and it is welcome to — but
// `week` is the number that means something, and it is on every progress, suspend, abandon and end
// event so that no analysis has to reach for the dishonest one.
//
// WHY ABANDONMENT IS INSTRUMENTED HARDER THAN COMPLETION. Most players will never reach an ending.
// If the only signal were `run_ended`, every chart would describe the survivors and the game would
// look far more engaging than it is. `run_progress` is therefore a heartbeat — the LAST one a
// player sends is where they stopped, whether or not they ever came back to say so — and
// `run_suspended` fires on the way out of the page, which is how most runs really end.

import { capture } from './client'
import type { EventProps, PropValue } from './props'

/**
 * What actually went out: the sanitised property bag, after ./props.ts has had it. Every function
 * below returns it — nobody uses the value in the app, and test/analytics.test.ts uses all of them,
 * which is how "no free text ever leaves" is asserted against the real code path rather than a
 * mock. See the note on `capture` in ./client.ts.
 */
export type SentProps = Record<string, PropValue>

// ---------- the vocabulary ----------

/**
 * Why a run stopped being played. 'ended' is the only one the game itself considers a conclusion.
 */
export type RunStopReason = 'ended' | 'abandoned'

/** What tore the page down under us. Both mean "the player stopped", with different confidence. */
export type SuspendTrigger = 'hidden' | 'unload'

/**
 * The systems worth knowing whether anyone ever touches. A closed vocabulary, because "did players
 * ever run an experiment" is only answerable if the answer is spelled one way.
 */
export type Feature =
  | 'acquisition'
  | 'debt'
  | 'experiment'
  | 'field_guide'
  | 'ipo'
  | 'pivot'
  | 'raise'
  | 'tokenise'
  | 'venture'

/**
 * Facts about a run, read straight off GameState and never written back. Assembled by the caller
 * (src/analytics/Analytics.tsx) so that this module imports nothing from src/game at all — the
 * zero-impact rule is easier to keep when the dependency simply does not exist.
 */
export interface RunProps extends EventProps {
  mode: string
  format: string
  sector: string
  scenario?: string
  career?: boolean
  week?: number
  screen?: string
  stage?: string
  employees?: number
  users?: number
  cash?: number
  revenue?: number
  pmf?: number
  pivots?: number
  tokenised?: boolean
}

// ---------- Q1: visitors ----------

/**
 * The game was opened. Fired once per page load, before anything else.
 *
 * PostHog attaches `$referrer`, `$referring_domain` and any UTM parameters to it on its own (with
 * query strings stripped — see props.ts), which is the "from where" half of the question. The
 * `runs_*_before` counters are the honest half of the retention question in anonymous mode: a
 * browser opening the game with eleven runs behind it is a returning player whether or not there
 * is an identifier to prove it.
 */
export function appOpened(p: {
  first_open: boolean
  standalone: boolean
  runs_started_before: number
  runs_finished_before: number
}): SentProps {
  return capture('app_opened', p)
}

// ---------- Q2: games played ----------

/** A new company was founded. `first_run` is what makes "which sector do beginners pick" answerable. */
export function runStarted(run: RunProps, p: { founder: string; first_run: boolean; runs_finished_before: number }): SentProps {
  return capture('run_started', { ...run, ...p })
}

/** A run reached an ending. The completion event — outnumbered, in reality, by the two below. */
export function runEnded(run: RunProps, p: { ending: string; weeks: number; score: number; verified: string }): SentProps {
  return capture('run_ended', { ...run, ...p })
}

/**
 * The player walked away from a live run — the Abandon button, or starting a new company over an
 * unfinished one. `week` and `screen` are the coordinates of the moment they gave up.
 */
export function runAbandoned(run: RunProps, p: { weeks: number }): SentProps {
  return capture('run_abandoned', { ...run, ...p, reason: 'abandoned' })
}

// ---------- Q3: playing time, in weeks ----------

/**
 * The heartbeat. Fired on weeks 1-5 and then every fifth week — dense where the drop-off is (most
 * players who quit do it in the first handful of weeks) and thin where it would only burn quota.
 *
 * This is the single most valuable event in the file. It needs no ending, no consent and no
 * cooperation from the player: whatever else happens, the last heartbeat says how far they got and
 * what they were looking at.
 */
export function runProgress(run: RunProps): SentProps {
  return capture('run_progress', run)
}

/** The tab went away with a run still live. Sent by beacon, because the page is already leaving. */
export function runSuspended(run: RunProps, p: { trigger: SuspendTrigger }): SentProps {
  return capture('run_suspended', { ...run, ...p }, { beacon: true })
}

// ---------- design questions ----------

/**
 * A screen was opened for the first time in this run. Once per screen per run, never per visit:
 * the question is "does anybody ever find Discovery", not "how many times did they click".
 */
export function screenOpened(run: RunProps): SentProps {
  return capture('screen_opened', run)
}

/** A system was used for the first time in this run — pivot, experiment, tokenise, raise, … */
export function featureUsed(run: RunProps, p: { feature: Feature }): SentProps {
  return capture('feature_used', { ...run, ...p })
}

/** A founder's note was delivered (see src/onboarding/progress.ts — `seen` gained an id). */
export function noteSeen(run: RunProps, p: { concept: string }): SentProps {
  return capture('note_seen', { ...run, ...p })
}

/** The onboarding layer was switched off, or back on, in the Field Guide footer. */
export function notesToggled(p: { notes_enabled: boolean }): SentProps {
  return capture('notes_toggled', p)
}

// ---------- ops ----------



/**
 * Which weeks get a heartbeat. Exported so test/analytics.test.ts can pin the cadence rather than
 * rediscovering it, and so the cost is visible: a 90-week run sends 5 + 17 = 22 of these.
 */
export function isHeartbeatWeek(week: number): boolean {
  if (!Number.isFinite(week) || week < 1) return false
  return week <= 5 || week % 5 === 0
}
