// The consent question — asked once, at the only moment it is honest to ask it.
//
// WHY AFTER THE FIRST FINISHED RUN, AND NOT ON ARRIVAL. A banner at the door is a toll on a game
// nobody has played yet: it interrupts before there is anything to consent about, it is answered
// by reflex, and it teaches players to dismiss the interface. Waiting until somebody has finished
// a whole run means the question is put to a person who now knows what the game is — and it means
// the player who bounced in week 3, who is the most interesting data point in the whole system,
// is NEVER ASKED ANYTHING. They are also never identified: until this prompt is answered with a
// yes, nothing is written to their device.
//
// WHAT IT IS ASKING FOR. Not permission to collect — anonymous, unlinked, id-less collection is
// already running and is what makes abandonment measurable (see ./consent.ts). It asks for the one
// thing that genuinely needs asking: permission to keep an identifier, so that "did this player
// come back next week" can be answered at all, and permission to upload the run's own decision log.
//
// ASKED ONCE, EVER. Closing this without answering counts as an answer — `markAsked` fires when
// the prompt appears, so it never returns. Anyone who changes their mind either way does it in the
// Field Guide footer, next to the founder's-notes switch, which is where every "how loud is this
// game" control in this project already lives.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { BarChart3, X } from 'lucide-react'
import { useStore } from '../store'
import { analyticsConfigured } from './config'
import { consentGrantedEvent } from './events'
import { markAsked, setConsent, shouldAskConsent, snapshot, subscribe } from './consent'

/** Re-render every consent surface when the record changes, without touching the game store. */
export function useConsent() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function ConsentPrompt() {
  const finished = useStore((s) => !!s.game?.gameOver)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // The placeholder key means the whole layer is inert, and a consent prompt for a system that
    // collects nothing would be a lie told politely.
    if (!analyticsConfigured || !finished || !shouldAskConsent()) return
    markAsked()
    setOpen(true)
  }, [finished])

  if (!open) return null

  const answer = (granted: boolean) => {
    setConsent(granted)
    // Only the yes is reported, and only after it is recorded. A "no" produces no event about the
    // person who just said no — see events.ts.
    if (granted) consentGrantedEvent()
    setOpen(false)
  }

  return (
    <section
      aria-label="Analytics consent"
      // Above the results overlay (z-60) so it is not buried, below the field guide (z-80) so the
      // player can still open the guide — and read what this actually means — while it is up.
      className="fixed inset-x-3 bottom-3 z-[78] mx-auto max-w-[520px] rounded-2xl border border-line bg-bg2/97 p-4 shadow-[var(--elev-3)] backdrop-blur sm:inset-x-auto sm:left-1/2 sm:w-[520px] sm:-translate-x-1/2"
    >
      <div className="flex items-start gap-3">
        <BarChart3 size={17} className="mt-[3px] shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-extrabold tracking-tight">Help work out which parts of this are any good?</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-mut">
            Anonymous counts already tell us how far runs get. Saying yes adds two things: a random id kept on this
            device, so it is possible to tell whether anyone comes back — and this run’s decision log, which is what
            makes the balance fixable. <b className="text-ink">Never your company name</b>, never anything you typed.
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close without answering"
          className="-mt-1 -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mut transition-colors hover:bg-surface2 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => answer(true)}
          className="rounded-xl bg-accent px-3.5 py-2 text-[13px] font-bold text-bg transition-all hover:brightness-110"
        >
          Yes, that’s fine
        </button>
        <button
          onClick={() => answer(false)}
          className="rounded-xl border border-line2 px-3.5 py-2 text-[13px] font-bold text-mut transition-colors hover:border-accent hover:text-ink"
        >
          No — collect nothing
        </button>
        <span className="text-[11.5px] text-mut/80">Changeable any time in the field guide.</span>
      </div>
    </section>
  )
}
