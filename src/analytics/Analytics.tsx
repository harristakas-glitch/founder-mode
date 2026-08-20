// The one place analytics touches the running game — and it touches it in exactly one direction.
//
// THE ZERO-IMPACT RULE. This module READS the store and NEVER writes it. It dispatches no action,
// mutates no GameState, and imports nothing from src/game except types and the replay journal's
// own reader. `npm run bots` is byte-identical with it present, because no code path here is
// reachable from the engine at all. That is the same rule src/onboarding/read.ts states at the top
// of itself, for the same reason, and it is worth writing twice: an observer that can change what
// it observes is not an observer.
//
// WHY A WATCHER RATHER THAN CALL SITES. The alternative is a `capture(...)` sprinkled through
// src/store.ts next to each action — which puts analytics inside the file that owns every game
// mutation, and makes "does analytics change behaviour?" a question you answer by reading a
// thousand lines. Deriving the events from observed STATE instead keeps the whole surface in this
// file, and has a second benefit that showed up immediately: state deltas catch things a call site
// would miss, like a run that ends inside a decision rather than on the advance button.
//
// NOTHING HERE MAY THROW. A crash in an analytics effect would unmount the game — main.tsx's
// boundary catches it, but "the player lost their screen because a metric failed" is not a trade
// anybody would make. Every emit goes through `safely()`.

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useStore, type ScreenId } from '../store'
import { snapshot as onboardingSnapshot, subscribe as onboardingSubscribe } from '../onboarding/progress'
import { useGuide } from '../onboarding/guide'
import type { GameState } from '../game/types'
import {
  appOpened,
  featureUsed,
  isHeartbeatWeek,
  noteSeen,
  notesToggled,
  runAbandoned,
  runEnded,
  runProgress,
  runStarted,
  screenOpened,
  runSuspended,
  runJournalUploaded,
  type Feature,
  type RunProps,
  type RunStopReason,
} from './events'
import { verifyRun } from '../game/replay'
import { uploadRunJournal } from './runJournal'
import { ConsentPrompt } from './ConsentPrompt'

function safely(fn: () => void): void {
  try {
    fn()
  } catch {
    // A metric is never worth a frame of the game.
  }
}

// ---------- reading the run ----------

/**
 * Everything an event is allowed to know about the run, derived read-only. Deliberately plain
 * field reads rather than calls into src/game/engine: there is then no engine function anywhere in
 * the analytics call graph, which is the cheapest possible proof that analytics cannot advance a
 * simulation, draw from an RNG stream, or cost a golden trace its determinism.
 */
function runProps(g: GameState, screen: ScreenId): RunProps {
  const c = g.config
  return {
    mode: c?.mode ?? 'unknown',
    format: c?.format ?? 'unknown',
    sector: g.sector,
    scenario: c?.scenario,
    career: !!g.career,
    week: g.week,
    screen,
    stage: g.stage,
    employees: g.employees.length,
    users: g.users,
    cash: g.cash,
    revenue: g.lastRevenue,
    pmf: g.pmf,
    pivots: g.pivots,
    tokenised: !!g.token,
  }
}

/**
 * Identity of a run, for "is this the same one I saw last render". Built from the seed and the
 * setup rather than the company name: the name is the one string the player authored, and the less
 * of it exists in this module's variables the shorter the argument that it never leaves.
 *
 * Restarting the SAME daily challenge with the same founder produces the same key, which is why
 * the caller also treats the week going backwards as a new run.
 */
const runKey = (g: GameState): string => `${g.config?.seed ?? 0}:${g.config?.format ?? '-'}:${g.founderKind}:${g.sector}`

/** Systems the player has demonstrably used, read off the same state they can see on screen. */
function usedFeatures(g: GameState): Feature[] {
  const out: Feature[] = []
  if (g.pivots > 0) out.push('pivot')
  if (g.token) out.push('tokenise')
  if (g.ipo) out.push('ipo')
  if (g.debt || g.flags?.tookDebt) out.push('debt')
  if (g.ventures.length > 0) out.push('venture')
  if (g.rivals.some((r) => r.acquired)) out.push('acquisition')
  if (g.founderEquity < 0.999 || g.stage !== 'Pre-seed') out.push('raise')
  const career = g.career
  if (career && (career.activeExperiments.length > 0 || career.journal.some((j) => j.category === 'experiment'))) {
    out.push('experiment')
  }
  return out
}

// ---------- the watcher ----------

/** Fired once per page load, not once per mount: React 19 StrictMode mounts effects twice in dev. */
let openReported = false

function AnalyticsWatcher() {
  const game = useStore((s) => s.game)
  const screen = useStore((s) => s.screen)
  const progress = useSyncExternalStore(onboardingSubscribe, onboardingSnapshot, onboardingSnapshot)
  const guide = useGuide()

  // The previous observation. `bootstrapped` is what stops a RESUMED save (the store rehydrates a
  // run at module scope, before React mounts) being reported as a run that was just started.
  const last = useRef<{ key: string; week: number; game: GameState; screen: ScreenId } | null>(null)
  const bootstrapped = useRef(false)
  const seenScreens = useRef(new Set<string>())
  const seenFeatures = useRef(new Set<string>())
  const seenWeeks = useRef(new Set<number>())
  const seenNotes = useRef<Set<string> | null>(null)
  const notesEnabled = useRef<boolean | null>(null)
  const guideSeen = useRef(false)
  const suspendedWeek = useRef(-1)
  /**
   * Per-run, in-memory, never persisted and never reused: it exists so two players who abandon the
   * same daily challenge in week 1 having done nothing do not collide on the journal table's
   * unique key. It is not an identifier — see runJournal.ts.
   */
  const nonce = useRef('')
  const uploaded = useRef(false)

  // Live mirror for the unload handler, which cannot re-read a closure.
  const live = useRef<{ game: GameState | null; screen: ScreenId }>({ game: null, screen })
  live.current = { game, screen }

  // ---- Q1: the visit ----
  useEffect(() => {
    if (openReported) return
    openReported = true
    safely(() => {
      const p = onboardingSnapshot()
      appOpened({
        first_open: p.runs.started === 0 && p.runs.finished === 0,
        standalone: typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)')?.matches,
        runs_started_before: p.runs.started,
        runs_finished_before: p.runs.finished,
      })
    })
  }, [])

  // ---- runs: started, progressed, ended, abandoned ----
  useEffect(() => {
    safely(() => {
      const prev = last.current
      const key = game ? runKey(game) : null
      // Is this the first thing we have seen this page load? It decides two things, and getting
      // either wrong quietly corrupts the counts:
      //   * the store rehydrates a saved run at module scope, BEFORE React mounts, so an in-flight
      //     run that was resumed must not be reported as a run that was just started;
      //   * a FINISHED run sits in the save until the player starts another, so `run_ended` must
      //     not fire again on every reload of the results screen. One lost ending when a tab
      //     crashes at exactly the wrong moment is a far better trade than a run that counts
      //     itself six times because somebody left the tab open and kept refreshing.
      const firstLook = !bootstrapped.current
      bootstrapped.current = true

      // A run left the stage: abandoned if it never reached an ending. Reported from the PREVIOUS
      // state, because the coordinates that matter — the week and the screen they were looking at
      // when they gave up — only exist there.
      if (prev && (!game || key !== prev.key || game.week < prev.week)) {
        if (!prev.game.gameOver) {
          const props = runProps(prev.game, prev.screen)
          runAbandoned(props, { weeks: prev.game.week })
          void upload(prev.game, 'abandoned', nonce.current, uploaded)
        }
      }

      if (!game) {
        last.current = null
        return
      }

      const fresh = !prev || key !== prev.key || game.week < prev.week
      if (fresh) {
        seenScreens.current = new Set()
        seenFeatures.current = new Set()
        seenWeeks.current = new Set()
        guideSeen.current = false
        suspendedWeek.current = -1
        nonce.current = makeNonce()
        uploaded.current = false
        // Only a run that BEGAN while we were watching is a run that was started.
        if (!firstLook) {
          const p = onboardingSnapshot()
          runStarted(runProps(game, screen), {
            founder: game.founderKind,
            first_run: p.runs.finished === 0,
            runs_finished_before: p.runs.finished,
          })
        }
      }

      // The ending. Emitted from the state that carries it, once, and only if we watched it happen.
      if (game.gameOver && !firstLook && (!prev || !prev.game.gameOver || key !== prev.key)) {
        runEnded(runProps(game, screen), {
          ending: game.gameOver.type,
          weeks: game.gameOver.week,
          score: game.gameOver.payout ?? 0,
          verified: verifyRun(game).state,
        })
        void upload(game, 'ended', nonce.current, uploaded)
      }

      // The heartbeat — the event that measures the players who never finish anything.
      if (!game.gameOver && isHeartbeatWeek(game.week) && !seenWeeks.current.has(game.week)) {
        seenWeeks.current.add(game.week)
        runProgress(runProps(game, screen))
      }

      // First use of a system, once per run.
      for (const f of usedFeatures(game)) {
        if (seenFeatures.current.has(f)) continue
        seenFeatures.current.add(f)
        featureUsed(runProps(game, screen), { feature: f })
      }

      last.current = { key: key!, week: game.week, game, screen }
    })
  }, [game, screen])

  // ---- where they went: first visit to each screen, per run ----
  useEffect(() => {
    if (!game) return
    safely(() => {
      if (seenScreens.current.has(screen)) return
      seenScreens.current.add(screen)
      screenOpened(runProps(game, screen))
    })
  }, [game, screen])

  // ---- the onboarding layer: was it read, was it switched off ----
  useEffect(() => {
    safely(() => {
      const ids = Object.keys(progress.seen)
      if (seenNotes.current === null) {
        // First observation is the backlog of everything this device already learned — history,
        // not events. Recording it would invent a burst of note_seen on every page load.
        seenNotes.current = new Set(ids)
      } else {
        for (const id of ids) {
          if (seenNotes.current.has(id)) continue
          seenNotes.current.add(id)
          if (game) noteSeen(runProps(game, screen), { concept: id })
        }
      }
      if (notesEnabled.current === null) notesEnabled.current = progress.enabled
      else if (notesEnabled.current !== progress.enabled) {
        notesEnabled.current = progress.enabled
        notesToggled({ notes_enabled: progress.enabled })
      }
    })
  }, [progress, game, screen])

  // ---- the field guide: the pull half of onboarding, once per run ----
  useEffect(() => {
    if (!guide.open || guideSeen.current || !game) return
    guideSeen.current = true
    safely(() => featureUsed(runProps(game, screen), { feature: 'field_guide' }))
  }, [guide.open, game, screen])

  // ---- leaving: the way most runs actually end ----
  useEffect(() => {
    const send = (trigger: 'hidden' | 'unload') =>
      safely(() => {
        const { game: g, screen: s } = live.current
        if (!g || g.gameOver) return
        // At most one per game-week. Switching tabs half a dozen times inside one week is a
        // browsing habit, not six abandonments, and paying quota to record it would make the
        // event less readable as well as more expensive.
        if (suspendedWeek.current === g.week) return
        suspendedWeek.current = g.week
        runSuspended(runProps(g, s), { trigger })
      })
    const onHide = () => {
      if (document.visibilityState === 'hidden') send('hidden')
    }
    const onLeave = () => send('unload')
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onLeave)
    }
  }, [])

  return null
}

/** 8 hex characters of `crypto.getRandomValues`, or a clock fallback where crypto is absent. */
function makeNonce(): string {
  try {
    const b = new Uint8Array(4)
    crypto.getRandomValues(b)
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  } catch {
    return Math.floor(Math.random() * 2 ** 32).toString(16)
  }
}

/** Fire-and-forget journal upload, at most once per run. Refusals are reported, never thrown. */
async function upload(game: GameState, reason: RunStopReason, nonce: string, done: { current: boolean }) {
  if (done.current) return
  done.current = true
  try {
    const r = await uploadRunJournal(game, reason, nonce)
    // 'unconfigured' and 'no_consent' are the normal, quiet cases — reporting them would be an
    // event about a player who has not agreed to events. Everything else is worth seeing.
    if (!r.sent && (r.reason === 'unconfigured' || r.reason === 'no_consent')) return
    runJournalUploaded({
      reason,
      entries: r.sent ? r.entries : 0,
      bytes: r.sent ? r.bytes : 0,
      ok: r.sent,
    })
  } catch {
    // never surfaces to the player
  }
}

/**
 * The mount point: one component, rendered next to <App/> in main.tsx so that it survives App's
 * early returns (the start screen and the lobby both return before the game shell renders, and a
 * visitor who never starts a run is exactly who question 1 is about).
 */
export function AnalyticsLayer() {
  return (
    <>
      <AnalyticsWatcher />
      <ConsentPrompt />
    </>
  )
}
