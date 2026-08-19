// The pull half of onboarding: a summonable glossary, and the only place the whole layer can be
// switched on and off.
//
// It is a dialog, so it is the one thing here that covers the game — but it is never opened by the
// game. It opens because the player pressed `?`, clicked the guide button, or tapped a term inside
// a note. Escape closes it, Tab stays inside it, and the run underneath is untouched.

import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Search, X } from 'lucide-react'
import { useStore } from '../store'
import { hasCapability } from '../game/modes'
import { TERMS, TERM_GROUPS, type Term } from './glossary'
import { CONCEPTS } from './concepts'
import { closeGuide, useGuide } from './guide'
import { resetLessons, setNotesEnabled } from './progress'
import { useProgress } from './useOnboarding'

/** Escape to close, Tab trapped inside, focus returned where it came from. */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null)
    focusable()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [onClose])
  return ref
}

function TermRow({ t, highlight }: { t: Term; highlight: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' })
  }, [highlight])
  return (
    <div
      ref={ref}
      id={`fg-${t.id}`}
      className={`rounded-xl border px-3.5 py-2.5 ${
        highlight ? 'border-accent/60 bg-accent/[0.07]' : 'border-line/60 bg-surface/50'
      }`}
    >
      <div className="text-[13.5px] font-bold">{t.name}</div>
      <div className="mt-0.5 text-[13px] leading-relaxed text-mut">{t.short}</div>
      {t.long && <div className="mt-1.5 text-[12.5px] leading-relaxed text-mut/85">{t.long}</div>}
    </div>
  )
}

export function FieldGuide() {
  const { open, focus } = useGuide()
  const game = useStore((s) => s.game)
  const progress = useProgress()
  const [q, setQ] = useState('')
  const dialogRef = useDialog(closeGuide)

  // The guide never claims Career vocabulary in a Quick Play run — those words are not on screen.
  const career = hasCapability(game, 'detailedPMF')
  const visible = useMemo(() => TERMS.filter((t) => career || !t.career), [career])
  const needle = q.trim().toLowerCase()
  const matches = useMemo(
    () =>
      needle.length === 0
        ? visible
        : visible.filter(
            (t) =>
              t.name.toLowerCase().includes(needle) ||
              t.short.toLowerCase().includes(needle) ||
              (t.long ?? '').toLowerCase().includes(needle),
          ),
    [visible, needle],
  )

  if (!open) return null

  const relevant = CONCEPTS.filter((c) => !c.only || (c.only === 'career') === career)
  const learned = relevant.filter((c) => progress.seen[c.id] !== undefined).length
  const retired = relevant.filter(
    (c) => progress.seen[c.id] === undefined && (c.retiredBy ?? []).some((s) => (progress.skills[s] ?? 0) > 0),
  ).length

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeGuide} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Field guide"
        className="relative flex max-h-full w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-line bg-bg2 shadow-[var(--elev-3)]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <BookOpen size={17} className="shrink-0 text-accent" />
          <h2 className="text-[15px] font-extrabold tracking-tight">Field guide</h2>
          <span className="hidden text-[12px] text-mut sm:inline">every word the game uses, defined by what the simulation does</span>
          <button
            onClick={closeGuide}
            aria-label="Close the field guide"
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-mut transition-colors hover:bg-surface2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-line px-4 py-2.5">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3 py-2 focus-within:border-accent">
            <Search size={14} className="shrink-0 text-mut" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search — runway, churn, covenant, retention…"
              aria-label="Search the field guide"
              className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-mut/60"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          {matches.length === 0 && <div className="py-8 text-center text-[13px] text-mut">Nothing in the guide matches that.</div>}
          {TERM_GROUPS.map((g) => {
            const rows = matches.filter((t) => t.group === g.id)
            if (rows.length === 0) return null
            return (
              <section key={g.id} className="mb-4 last:mb-0">
                <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-mut">{g.label}</h3>
                <div className="space-y-2">
                  {rows.map((t) => (
                    <TermRow key={t.id} t={t} highlight={focus === t.id} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={progress.enabled}
              onChange={(e) => setNotesEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span>
              Founder’s notes <span className="text-mut">— {progress.enabled ? 'on' : 'off'}</span>
            </span>
          </label>
          <span className="text-[12px] text-mut tnum">
            {learned} learned · {retired} skipped because you already did it
          </span>
          <button
            onClick={resetLessons}
            className="ml-auto rounded-lg border border-line2 px-2.5 py-1 text-[12px] font-semibold text-mut transition-colors hover:border-accent hover:text-ink"
          >
            Show them all again
          </button>
        </div>
      </div>
    </div>
  )
}
