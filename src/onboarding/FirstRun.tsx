// The door.
//
// Three worlds, three formats, six markets, two founder types and ten scenarios is a lot of choice
// to hand somebody who does not yet know what a week of this game feels like — and the gate gives
// no signal about which of them is the one to learn in. The highest-leverage fix is not to hide any
// of it; it is to mark ONE recommended path and let everything else stay exactly where it is.
//
// Shown only to a player who has never played a run to an ending. After that it disappears for
// good, and the gate is the gate again.

import { ArrowRight } from 'lucide-react'
import { openGuide } from './guide'
import { FieldGuide } from './FieldGuide'
import { isFirstTimer } from './progress'
import { useProgress } from './useOnboarding'

/** True until the player has finished a run. Read through the hook so it re-renders on change. */
export function useFirstTimer(): boolean {
  const p = useProgress()
  return p.runs.finished === 0
}

/**
 * The gate's recommendation strip. One sentence, one button, and it never covers anything: the
 * three world cards are still the three world cards.
 */
export function FirstRunPath({ onTakeIt }: { onTakeIt: () => void }) {
  const first = useFirstTimer()
  if (!first) return null
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-[var(--ha)]/30 bg-[var(--ha)]/[0.06] px-4 py-3">
      <div className="min-w-0 text-[13px] leading-relaxed">
        <b className="text-ink">First time here?</b>{' '}
        <span className="text-mut">
          Take Quick Play in B2B SaaS. It is the shortest loop and the most forgiving market — steady revenue per customer, slow
          churn, and mistakes that take weeks rather than days to kill you. Career and Arena will still be here afterwards.
        </span>
      </div>
      <button
        type="button"
        onClick={onTakeIt}
        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--ha)]/50 px-3 py-2 text-[13px] font-bold text-[var(--ha)] transition-colors hover:bg-[var(--ha)]/10"
      >
        Set that up <ArrowRight size={14} />
      </button>
    </div>
  )
}

/**
 * On the briefing, for a first-timer only: what the choice below actually decides, and a way into
 * the vocabulary before the first week rather than after it.
 */
export function FirstRunBriefingNote({ mode }: { mode: 'quick' | 'career' | 'arena' }) {
  const first = useFirstTimer()
  if (!first || mode === 'arena') return null
  return (
    <>
      <div className="mt-5 rounded-2xl border border-line/70 bg-surface/50 px-4 py-3 text-[12.5px] leading-relaxed text-mut">
        <b className="text-ink">What the market choice actually decides.</b> Revenue per customer, how much word of mouth you get
        for free, and how fast customers leave — the three pips on each card. They are read off the simulation, not invented.{' '}
        <b className="text-ink">B2B SaaS</b> is the kindest of the six to learn in; <b className="text-ink">AI/ML Infra</b> pays the
        most and will bankrupt you fastest.{' '}
        <button
          type="button"
          onClick={() => openGuide()}
          className="font-semibold text-[var(--ha)] underline underline-offset-2 hover:brightness-125"
        >
          What do the words mean?
        </button>
      </div>
      {/* The gate has no game shell, so the guide has to be hosted here too. The two never coexist:
          App renders NewGame only when there is no run. */}
      <FieldGuide />
    </>
  )
}

/** Whether a "Start here" marker belongs on a mode card. Quick Play, for a first-timer, only. */
export const recommendedMode = (mode: string): boolean => mode === 'quick' && isFirstTimer()
