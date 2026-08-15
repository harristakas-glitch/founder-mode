// Local replay proofs for Daily Challenge submissions.
//
// The daily_scores table has no column for a decision log (schema work is explicitly out of
// scope), so the proof rides on THIS device: when a daily run finishes and its score goes to the
// leaderboard, the run's header + journal + fingerprint + verdict are stored here, marked
// verifiable. A future submission path that can carry the log — or any client asked to audit a
// claim — replays it with `replayRun` and checks the fingerprint. A fabricated score cannot
// produce a log that replays to it.
//
// Like the leaderboard itself, this is decoration: every function is best-effort and never
// throws into the game loop.

import {
  headerOf,
  stateFingerprint,
  verifyRun,
  type JournalEntry,
  type ReplayHeader,
  type VerifyState,
} from '../game/replay'
import type { GameState } from '../game/types'

export interface ReplayProof {
  day: number
  /** wall-clock ms when the proof was recorded */
  at: number
  company: string
  score: number
  weeks: number
  ending: string
  /** verifyRun's verdict at submission time — 'verified' means the journal reproduces the score. */
  state: VerifyState
  /** Fingerprint of the submitted end state (present whenever there was a state to hash). */
  fingerprint: number
  header: ReplayHeader
  /** The decision log itself. Null when the run had none (legacy/overflow) — verdict says so. */
  journal: JournalEntry[] | null
}

const KEY = 'founder-mode-replay-proofs'
const KEEP = 20

export function storedReplayProofs(): ReplayProof[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? (v as ReplayProof[]) : []
  } catch {
    return []
  }
}

/**
 * Verify a finished daily run and store the proof locally, newest first, keeping the last few.
 * Returns the proof (also when storage failed — the caller may still want the verdict).
 */
export function recordReplayProof(g: GameState, day: number): ReplayProof {
  const verdict = verifyRun(g)
  const proof: ReplayProof = {
    day,
    at: Date.now(),
    company: g.companyName,
    score: g.gameOver?.payout ?? 0,
    weeks: g.gameOver?.week ?? g.week,
    ending: g.gameOver?.type ?? 'live',
    state: verdict.state,
    fingerprint: verdict.claimed ?? stateFingerprint(g),
    header: headerOf(g),
    journal: verdict.state === 'legacy_no_journal' ? null : (g.journal ?? null),
  }
  try {
    const kept = [proof, ...storedReplayProofs().filter((p) => p.day !== day)].slice(0, KEEP)
    localStorage.setItem(KEY, JSON.stringify(kept))
  } catch {
    // quota/private mode: the proof just doesn't persist — never break the results screen
  }
  return proof
}
