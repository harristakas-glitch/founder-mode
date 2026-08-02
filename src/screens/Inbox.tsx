import { useStore } from '../store'

export function Inbox() {
  const game = useStore((s) => s.game)!
  const resolveChoice = useStore((s) => s.resolveChoice)

  return (
    <div>
      <div className="screen-title">Inbox</div>
      <div className="screen-sub">News, events, and decisions. Amber items block the week until you decide.</div>

      {game.inbox.length === 0 && <div className="muted">All quiet. Suspiciously quiet.</div>}

      {game.inbox.map((m) => (
        <div key={m.id} className={`msg ${m.kind} ${m.resolved ? 'resolved' : ''}`}>
          <div className="when">Week {m.week}</div>
          <div className="title">{m.title}</div>
          <div className="body">{m.body}</div>
          {m.kind === 'choice' && !m.resolved && m.choices && (
            <div className="choices">
              {m.choices.map((c, i) => (
                <button key={i} className="btn" onClick={() => resolveChoice(m.id, i)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {m.resolved && m.resultText && <div className="result">→ {m.resultText}</div>}
        </div>
      ))}
    </div>
  )
}
