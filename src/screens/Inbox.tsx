import { Btn } from '../components'
import { useStore } from '../store'

export function Inbox() {
  const game = useStore((s) => s.game)!
  const resolveChoice = useStore((s) => s.resolveChoice)

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Inbox</div>
      <div className="mb-4 text-[13px] text-mut">News, events, and decisions. Amber items block the week until you decide.</div>

      {game.inbox.length === 0 && <div className="text-mut">All quiet. Suspiciously quiet.</div>}

      <div className="max-w-[820px] space-y-2.5">
        {game.inbox.map((m) => {
          const accent =
            m.kind === 'choice' && !m.resolved
              ? 'border-l-warn'
              : m.kind === 'choice'
                ? 'border-l-good'
                : m.kind === 'news'
                  ? 'border-l-accent'
                  : 'border-l-line'
          return (
            <div key={m.id} className={`rounded-r-xl border border-l-[3px] border-line/60 bg-surface p-3.5 ${accent}`}>
              <div className="text-[10.5px] text-mut">Week {m.week}</div>
              <div className="mt-0.5 font-bold">{m.title}</div>
              <div className="mt-1 text-[13.5px] leading-relaxed text-mut">{m.body}</div>
              {m.kind === 'choice' && !m.resolved && m.choices && (
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
