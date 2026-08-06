import { Inbox as InboxIcon } from 'lucide-react'
import { Btn, EmptyState } from '../components'
import { useStore } from '../store'

export function Inbox() {
  const game = useStore((s) => s.game)!
  const resolveChoice = useStore((s) => s.resolveChoice)
  const pending = game.inbox.filter((m) => m.kind === 'choice' && !m.resolved).length

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Inbox</h1>
      <div className="mb-4 text-[13px] text-mut">News, events, and decisions. Amber items block the week until you decide.</div>

      {/* the one thing standing between the player and the next week, stated once */}
      {pending > 0 && (
        <div className="mb-3 flex max-w-[820px] items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2 text-[13px] font-semibold text-warn">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
          {pending} decision{pending === 1 ? '' : 's'} waiting — the week can&apos;t end until {pending === 1 ? 'it is' : "they're"} resolved.
        </div>
      )}

      {game.inbox.length === 0 && (
        <div className="max-w-[820px]">
          <EmptyState
            icon={<InboxIcon size={22} />}
            title="All quiet. Suspiciously quiet."
            hint="News, investor emails, and decisions land here as the weeks pass."
          />
        </div>
      )}

      <div className="max-w-[820px] space-y-2.5">
        {game.inbox.map((m) => {
          const needsYou = m.kind === 'choice' && !m.resolved
          const rail = needsYou
            ? 'border-l-warn'
            : m.kind === 'choice'
              ? 'border-l-good'
              : m.kind === 'news'
                ? 'border-l-accent'
                : 'border-l-line'
          return (
            <div
              key={m.id}
              className={`rounded-r-xl border border-l-[3px] border-line/60 p-3.5 transition-colors duration-[120ms] ${rail} ${
                // an item that needs you is lit; everything already handled recedes
                needsYou ? 'bg-warn/[0.06]' : 'bg-surface/70'
              }`}
            >
              <div className="flex items-center gap-2 text-[11px] text-mut">
                <span className="tnum">Week {m.week}</span>
                {needsYou && (
                  <span className="rounded-md bg-warn/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-warn">
                    Decision
                  </span>
                )}
              </div>
              <div className={`mt-0.5 font-bold ${needsYou ? '' : 'text-ink/90'}`}>{m.title}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-mut">{m.body}</div>
              {needsYou && m.choices && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.choices.map((c, i) => (
                    <Btn key={i} onClick={() => resolveChoice(m.id, i)}>
                      {c.label}
                    </Btn>
                  ))}
                </div>
              )}
              {m.resolved && m.resultText && <div className="mt-2 text-[13px] italic text-good">→ {m.resultText}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
