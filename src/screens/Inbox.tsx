// The week stream — no longer a destination.
//
// This was a separate Inbox screen, one tab away from the HQ. The owner's read on the FM26 Portal
// settled it: Football Manager does not make Messages a separate page from the overview — the
// stream IS a third of the portal, read and acted on without leaving. So the stream renders ON
// the Founder HQ, unresolved-first, and the old `inbox` ScreenId aliases there. What stays from
// the audit: this surface's discipline (0 panels, 0 rail duplicates) and the raised-vs-receded
// grammar for items that block the week.
import { Inbox as InboxIcon } from 'lucide-react'
import { Btn, Disclosure, EmptyState } from '../components'
import { useStore } from '../store'
import { DecisionLens } from '../onboarding/DecisionLens'

export function StreamItem({ m }: { m: ReturnType<typeof useStore.getState>['game'] extends infer G ? (G extends { inbox: (infer M)[] } ? M : never) : never }) {
  const resolveChoice = useStore((s) => s.resolveChoice)
  const needsYou = m.kind === 'choice' && !m.resolved
  const rail = needsYou ? 'border-l-warn' : m.kind === 'choice' ? 'border-l-good' : m.kind === 'news' ? 'border-l-accent' : 'border-l-line'
  return (
    <div
      className={`rounded-r-[10px] border border-l-[3px] p-4 transition-colors duration-[120ms] ${rail} ${
        // Audit finding 5's fix, unchanged: a blocking row sits a full plane step above handled
        // ones — lightness, hue and edge at once, never colour alone.
        needsYou
          ? 'border-warn/45 bg-[color-mix(in_srgb,var(--color-warn)_11%,var(--color-surface3))] shadow-[var(--elev-2)]'
          : 'border-line/60 bg-surface2'
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] text-mut">
        <span className="tnum">Week {m.week}</span>
        {needsYou && <span className="rounded-md bg-warn px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-bg">Decision</span>}
      </div>
      <div className={`mt-0.5 font-bold ${needsYou ? '' : 'text-ink/90'}`}>{m.title}</div>
      <div className="mt-1 text-[13px] leading-relaxed text-mut">{m.body}</div>
      {needsYou && <DecisionLens message={m} />}
      {needsYou && m.choices && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.choices.map((c, i) => (
            // A choice label can be a full sentence ("Counter-offer: +25% salary, $13k signing
            // sweetener for Ingrid Kowalski") and Btn is built for short verbs — its baked-in
            // nowrap sent long labels straight through the card wall. Wrap, left-align, and cap
            // at the card's width; the min-height keeps the touch target when it stays one line.
            <Btn key={i} className="h-auto max-w-full !whitespace-normal py-2 text-left" onClick={() => resolveChoice(m.id, i)}>
              {c.label}
            </Btn>
          ))}
        </div>
      )}
      {m.resolved && m.resultText && <div className="mt-2 text-[13px] italic text-good">→ {m.resultText}</div>}
      {m.resolved && <DecisionLens message={m} />}
    </div>
  )
}

/**
 * The stream: the SETTLED record — recent past first, the rest one disclosure away.
 *
 * Unresolved decisions are deliberately NOT here. They render once, at the top of the HQ's
 * attention area, with their choices inline — the owner's play-testing found the same decision
 * card appearing twice on one screen (as an alarm up top and again here), and an alarm whose
 * button navigates to the screen you are already on. One fact, one card, actionable in place.
 */
export function InboxStream({ recent = 6 }: { recent?: number }) {
  const game = useStore((s) => s.game)!
  const settled = game.inbox.filter((m) => !(m.kind === 'choice' && !m.resolved))
  const shown = settled.slice(0, recent)
  // The history is unbounded (the engine trims nothing); the fold is capped so a 100-week run
  // cannot render five hundred rows into one disclosure.
  const folded = settled.slice(recent, recent + 40)

  if (game.inbox.length === 0)
    return (
      <EmptyState
        icon={<InboxIcon size={22} />}
        title="All quiet. Suspiciously quiet."
        hint="News, investor emails, and decisions land here as the weeks pass."
      />
    )

  return (
    <div className="max-w-[820px] space-y-2.5">
      {shown.map((m) => (
        <StreamItem key={m.id} m={m} />
      ))}
      {folded.length > 0 && (
        <Disclosure label={`Earlier weeks (${folded.length}${settled.length > recent + 40 ? '+' : ''})`}>
          <div className="space-y-2.5">
            {folded.map((m) => (
              <StreamItem key={m.id} m={m} />
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  )
}
