// The one hook every onboarding surface reads. It owns three jobs and nothing else:
//
//   1. WATCH — turn the live GameState into RunFacts, and record what the player has demonstrably
//      done into the durable ledger (in an effect, never during render).
//   2. CHOOSE — pick at most ONE eligible lesson for where the player is standing right now.
//   3. RATE-LIMIT — one note visible at a time, one per arrival somewhere new, three per week.
//
// It never dispatches into the game store and never mutates GameState.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store'
import { conceptById, conceptOnScreen, conceptsForRun, type Concept } from './concepts'
import {
  markSeen,
  recordRunFinished,
  recordRunStarted,
  recordSkills,
  recordVisit,
  snapshot,
  subscribe,
  tallySkill,
  weekHasRoom,
} from './progress'
import { observedSkills, readRun, type RunFacts } from './read'

/** Re-render whenever the onboarding ledger changes, without putting it in the game store. */
export function useProgress() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export interface ActiveNote {
  concept: Concept
  facts: RunFacts
  /** Marks the lesson learned and frees the slot. */
  dismiss: () => void
}

export function useActiveNote(): ActiveNote | null {
  const game = useStore((s) => s.game)
  const screen = useStore((s) => s.screen)
  const progress = useProgress()

  const facts = useMemo(() => (game ? readRun(game, screen) : null), [game, screen])

  // ---- watch: keep the ledger honest about what has actually been done ----
  const startedRun = useRef<string | null>(null)
  const finishedRun = useRef<string | null>(null)
  useEffect(() => {
    if (!facts) return
    recordSkills(observedSkills(facts))
    tallySkill('decide', facts.resolvedDecisions)
    if (startedRun.current !== facts.runId) {
      startedRun.current = facts.runId
      recordRunStarted()
    }
    if (facts.game.gameOver && finishedRun.current !== facts.runId) {
      finishedRun.current = facts.runId
      recordRunFinished()
    }
  }, [facts])

  // Screen only. Keyed on `game` as well, this fired on every simulation tick — so "screens opened"
  // counted weeks advanced, and every tick wrote localStorage and woke every subscriber for nothing.
  const inRun = !!game
  useEffect(() => {
    if (inRun) recordVisit(screen)
  }, [screen, inRun])

  // ---- rate limit: one note per arrival somewhere new ----
  //
  // "Somewhere new" is (run, week, screen). Session-local on purpose: it is a politeness limiter,
  // not progress, and a reload that offers the next unseen note is the behaviour we want anyway.
  const [consumed, setConsumed] = useState<string>('')
  const slot = facts ? `${facts.runId}|${facts.week}|${facts.screen}` : ''

  const candidate = useMemo(() => {
    if (!facts || !progress.enabled) return null
    if (facts.game.gameOver) return null // the results screen is not the place for a lesson
    if (consumed === slot) return null
    if (!weekHasRoom(facts.runId, facts.week)) return null
    const eligible = conceptsForRun(facts).filter(
      (c) =>
        progress.seen[c.id] === undefined &&
        !(c.retiredBy ?? []).some((s) => (progress.skills[s] ?? 0) > 0) &&
        conceptOnScreen(c, facts.screen) &&
        safeWhen(c, facts),
    )
    if (eligible.length === 0) return null
    // Highest priority wins; ties break on catalogue order so the choice is deterministic.
    return eligible.reduce((best, c) => (c.priority > best.priority ? c : best))
  }, [facts, progress, consumed, slot])

  // ---- pin: the note stays put while it is being read ----
  //
  // A chosen note is pinned to its slot, and the pin — not eligibility — decides what renders. That
  // separation is what lets the note be RECORDED as delivered while it is still on screen: the
  // moment `seen` gains the id, `candidate` goes null, and without the pin the note would vanish
  // out from under the player mid-sentence.
  const [pin, setPin] = useState<{ slot: string; id: string } | null>(null)
  useEffect(() => {
    if (pin?.slot === slot) return // this slot already has its note; never swap it out
    if (candidate) setPin({ slot, id: candidate.id })
    else if (pin) setPin(null)
  }, [slot, candidate, pin])

  const concept = pin?.slot === slot ? (conceptById(pin.id) ?? null) : null

  // ---- deliver: on screen long enough to have been read is DELIVERED ----
  //
  // Without this the ledger only ever recorded notes the player explicitly clicked "Got it" on, so
  // reading a note and simply walking away meant it came back next week, and the week after, until
  // it was formally acknowledged. That is the nagging this whole module exists to avoid. A note the
  // player had in front of them for the dwell counts, whether or not they clicked anything.
  const seenRef = useRef<{ runId: string; week: number } | null>(null)
  seenRef.current = facts ? { runId: facts.runId, week: facts.week } : null
  useEffect(() => {
    if (!concept) return
    const t = setTimeout(() => {
      const at = seenRef.current
      if (at) markSeen(concept.id, at.runId, at.week)
    }, DWELL_MS)
    return () => clearTimeout(t)
  }, [concept])

  if (!concept || !facts) return null
  return {
    concept,
    facts,
    dismiss: () => {
      markSeen(concept.id, facts.runId, facts.week)
      setConsumed(slot)
      setPin(null)
    },
  }
}

/**
 * How long a note has to be on screen before it counts as taught.
 *
 * Long enough that flicking through the nav does not silently burn a lesson the player never read;
 * short enough that anybody who actually stopped and read the sentence has spent it. The note does
 * not move, change or disappear when the timer fires — the only thing that happens is that it will
 * not be offered again.
 */
const DWELL_MS = 5_000

/**
 * A predicate in the catalogue must never be able to take the game down with it. A lesson whose
 * condition throws is simply not eligible — the run keeps going and the player never knows.
 */
function safeWhen(c: Concept, f: RunFacts): boolean {
  try {
    return c.when(f)
  } catch {
    return false
  }
}

/** Body text, with the same guarantee. */
export function safeText(fn: (f: RunFacts) => string, f: RunFacts): string | null {
  try {
    return fn(f)
  } catch {
    return null
  }
}
