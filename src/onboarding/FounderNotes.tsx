// The founder's notes: the one surface onboarding is allowed to push at the player.
//
// It is deliberately NOT a tutorial overlay, a spotlight, a modal or a tour. It is a single line in
// the margin of the screen you are already on, in the voice of somebody keeping notes on their own
// company — because the thing a new player is missing is not a sequence of steps, it is the
// vocabulary and the causality of the week in front of them.
//
// The contract, which the rest of the module enforces and this file makes visible:
//   * one note at a time, ever;
//   * only on the screen where the thing lives;
//   * never the same note twice, on this device, in any run;
//   * gone for good the moment you demonstrably do the thing;
//   * dismissible with one click, and switchable off entirely from the same row.

import { useEffect } from 'react'
import { BookOpen, PenLine, X } from 'lucide-react'
import { useStore } from '../store'
import { term } from './glossary'
import { closeGuide, openGuide, useGuide } from './guide'
import { setNotesEnabled } from './progress'
import { FieldGuide } from './FieldGuide'
import { safeText, useActiveNote } from './useOnboarding'

function Note() {
  const note = useActiveNote()
  const setScreen = useStore((s) => s.setScreen)
  if (!note) return null
  const body = safeText(note.concept.body, note.facts)
  if (!body) return null
  const { concept, facts, dismiss } = note
  const chips = (concept.terms ?? []).map((id) => term(id)).filter((t): t is NonNullable<typeof t> => !!t)

  return (
    <div
      role="note"
      aria-live="polite"
      className="rise-in mb-2.5 rounded-2xl border border-line/70 bg-surface pl-0.5 md:mb-3.5"
    >
      <div className="flex items-start gap-2.5 rounded-2xl border-l-[3px] border-l-accent2/60 px-3 py-2.5 md:gap-3 md:px-4 md:py-3">
        <PenLine size={15} className="mt-[3px] shrink-0 text-accent2/80" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-mut">Founder’s notes</span>
            <span className="text-[13.5px] font-bold">{concept.title}</span>
          </div>
          <p className="mt-1 text-[13px] leading-[1.45] text-mut md:leading-relaxed">{body}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 md:mt-2 md:gap-y-1.5">
            {chips.map((t) => (
              <button
                key={t.id}
                onClick={() => openGuide(t.id)}
                title={t.short}
                className="rounded-lg border border-line/80 px-2 py-0.5 text-[11.5px] font-semibold text-mut transition-colors hover:border-accent hover:text-ink"
              >
                {t.name}
              </button>
            ))}
            {concept.goto && facts.screen !== concept.goto.screen && (
              <button
                onClick={() => setScreen(concept.goto!.screen)}
                className="rounded-lg border border-accent/45 px-2 py-0.5 text-[11.5px] font-bold text-accent transition-colors hover:brightness-125"
              >
                {concept.goto.label} →
              </button>
            )}
            <span className="ml-auto flex items-center gap-2.5 md:gap-3">
              <button
                onClick={() => {
                  setNotesEnabled(false)
                  dismiss()
                }}
                className="text-[11.5px] text-mut/70 underline underline-offset-2 transition-colors hover:text-ink"
              >
                Turn notes off
              </button>
              <button
                onClick={dismiss}
                className="rounded-lg border border-line2 px-2.5 py-1 text-[12px] font-semibold transition-colors hover:border-accent hover:text-ink"
              >
                Got it
              </button>
            </span>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss this note"
          title="Dismiss — you will not see this one again"
          className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mut transition-colors hover:bg-surface2 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * Mounted once, at the top of the screen area. Renders the note for wherever the player is, hosts
 * the field guide, and owns the `?` shortcut that summons it.
 */
export function FounderNotes() {
  const { open } = useGuide()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return
      // never steal a keystroke the player meant for a field
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement | null)?.isContentEditable) return
      e.preventDefault()
      if (open) closeGuide()
      else openGuide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <Note />
      <FieldGuide />
    </>
  )
}

/**
 * The only permanent chrome onboarding adds: one header button. It is the way back to anything the
 * player dismissed — the vocabulary, and the switch that turns the notes back on.
 */
export function FieldGuideButton() {
  return (
    <button
      onClick={() => openGuide()}
      aria-label="Open the field guide"
      title="Field guide — what every number means (?)"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-ink md:h-9 md:w-9"
    >
      <BookOpen size={17} />
    </button>
  )
}
