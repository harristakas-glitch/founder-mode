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
  // The mock's timeline grammar: a rail line down the left with a kind-coloured dot per entry.
  // The dot doubles the left-border tone the audit's raised/receded rule already set — hue plus
  // position, never colour alone. A blocking decision still rises a full plane.
  const dot = needsYou ? 'bg-warn' : m.kind === 'choice' ? 'bg-good' : m.kind === 'news' ? 'bg-accent' : 'bg-line2'
  return (
    <div className="relative pl-5">
      <span aria-hidden="true" className="absolute bottom-0 left-[5px] top-0 w-px bg-line/70" />
      <span aria-hidden="true" className={`absolute left-[2px] top-4 h-[7px] w-[7px] rounded-full ${dot}`} />
      <div
        className={`rounded-[10px] border p-4 transition-colors duration-[120ms] ${
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
    </div>
  )
}

/**
 * The stream: unresolved decisions first with their choices inline, then the settled record, the
 * deep past one disclosure away.
 *
 * The owner's rule (2026-08-20): inbox content renders in the inbox column and NOWHERE else — the
 * HQ's attention area carries only the facts no message owns. That rule replaced an intermediate
 * design where decisions rendered at the top of the attention area, which fixed a duplication and
 * created a placement problem; this fixes both. One fact, one home, and the home is here.
 */
export function InboxStream({ recent = 6 }: { recent?: number }) {
  const game = useStore((s) => s.game)!
  const unresolved = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved)
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
      {unresolved.map((m) => (
        <StreamItem key={m.id} m={m} />
      ))}
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
