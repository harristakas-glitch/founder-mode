// The Big Bet — Strategic Systems Expansion phase 2 (master brief §7). Game verb: COMMIT.
// One question, answered once per chapter: what are we trying to become? The screen is a
// selection ritual when no bet is active and a compact program card when one is — never a
// dashboard (§7.19).
import { Target, Check, Circle, Flag } from 'lucide-react'
import { systemDepth } from '../game/modes'
import { BIG_BETS, alignmentWord, bigBetDef, initiativeAlignment } from '../game/strategic/bigbets'
import { roadmapDef } from '../game/strategic/content'
import { useStore } from '../store'

const WORD_LABEL = {
  strongly_supports: 'Strongly supports',
  supports: 'Supports',
  neutral: 'Neutral to',
  competes: 'Competes with',
} as const

export function Strategy() {
  const game = useStore((s) => s.game)!
  const betChoose = useStore((s) => s.betChoose)
  const betAbandon = useStore((s) => s.betAbandon)
  const depth = systemDepth(game, 'bigBets')
  const bet = game.bigBet

  if (depth === 'off') return null

  // ---------- an active program ----------
  if (bet && bet.status === 'active') {
    const def = bigBetDef(bet.type)
    const weekOf = game.week - bet.startedWeek
    const span = bet.targetWeek - bet.startedWeek
    const active = game.roadmap?.active ?? []
    return (
      <div className="max-w-[760px]">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-accent uppercase">
          <Target size={13} /> Big Bet
        </div>
        <h1 className="text-[28px] font-bold tracking-tight">{def.name}</h1>
        <div className="mb-4 text-[13px] text-mut">{def.blurb}</div>

        <div className="rounded-[14px] border border-line bg-surface p-5 shadow-[var(--elev-2)]">
          <div className="flex items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.round(bet.progress)}%` }} />
            </div>
            <span className="text-[15px] font-bold tnum">{Math.round(bet.progress)}%</span>
          </div>
          <div className="mt-1.5 text-[12px] text-mut tnum">
            Week {weekOf} of ~{span} · progress comes only from aligned work — declaring a strategy is not executing it.
          </div>

          <div className="mt-4 space-y-1.5">
            {def.milestones.map((label, i) => {
              const m = bet.milestones[i]
              return (
                <div key={i} className="flex items-center gap-2.5 text-[13px]">
                  {m?.doneWeek ? <Check size={15} className="shrink-0 text-good" /> : <Circle size={13} className="shrink-0 text-mut" />}
                  <span className={m?.doneWeek ? '' : 'text-mut'}>{label}</span>
                  {m?.doneWeek && <span className="text-[11px] text-mut tnum">wk {m.doneWeek}</span>}
                </div>
              )
            })}
          </div>

          <div className="mt-4 border-t border-line/50 pt-3">
            <div className="mb-1.5 text-[10.5px] font-bold tracking-wider text-mut uppercase">This week&apos;s roadmap vs the bet</div>
            {active.length === 0 ? (
              <div className="text-[12.5px] text-warn">Nothing on the roadmap is advancing this bet — it only moves when aligned work does.</div>
            ) : (
              active.map((item) => {
                const idef = roadmapDef(game.sector, item.id)
                if (!idef) return null
                const w = alignmentWord(initiativeAlignment(bet.type, game.sector, item.id))
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-0.5 text-[12.5px]">
                    <span className="min-w-0 truncate">{idef.name}</span>
                    <span className={w === 'strongly_supports' || w === 'supports' ? 'text-good' : w === 'neutral' ? 'text-mut' : 'text-warn'}>
                      {WORD_LABEL[w]} the bet
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <button className="mt-3 text-[12px] font-semibold text-mut transition-colors hover:text-bad" onClick={betAbandon}>
          Reconsider — abandon this bet
        </button>
      </div>
    )
  }

  // ---------- the record of a settled bet + choose the next ----------
  const settled = bet && bet.status !== 'active' ? bet : null
  return (
    <div className="max-w-[860px]">
      <h1 className="text-[28px] font-bold tracking-tight">Choose your Big Bet</h1>
      <div className="mb-4 max-w-[62ch] text-[13px] text-mut">
        What are we committing the company to for the next chapter? One bet at a time; aligned roadmap work advances it, everything
        else is still allowed — it just doesn&apos;t.
      </div>

      {settled && (
        <div
          className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-2.5 text-[13px] ${
            settled.status === 'completed' ? 'border-good/40 bg-good/5' : 'border-line bg-surface'
          }`}
        >
          <Flag size={14} className={settled.status === 'completed' ? 'text-good' : 'text-mut'} />
          <b>{bigBetDef(settled.type).name}</b>
          <span className="text-mut">
            {settled.status === 'completed'
              ? `completed week ${settled.startedWeek + Math.round((settled.targetWeek - settled.startedWeek) * (100 / 100))} — its edge is permanent`
              : settled.status === 'failed'
                ? 'failed — the declaration never became execution'
                : `abandoned week ${settled.abandonedWeek} — the company took weeks to refocus`}
          </span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {BIG_BETS.map((def) => (
          <div key={def.type} className="flex flex-col rounded-[14px] border border-line bg-surface p-4">
            <div className="text-[15.5px] font-bold">{def.name}</div>
            <div className="mt-1 text-[12.5px] leading-snug text-mut">{def.blurb}</div>
            <div className="mt-2.5 space-y-1 text-[12px]">
              <div>
                <span className="text-[10px] font-bold tracking-wider text-good/90 uppercase">Best when </span>
                <span className="text-mut">{def.bestWhen}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold tracking-wider text-warn/90 uppercase">Costs </span>
                <span className="text-mut">{def.tradeoff}</span>
              </div>
            </div>
            <div className="mt-3 flex flex-1 items-end justify-between gap-2">
              <span className="text-[11px] text-mut tnum">~{def.weeks[depth]} weeks</span>
              <button
                className="rounded-lg border border-[var(--color-accent)]/45 bg-[var(--color-accent)]/10 px-3.5 py-1.5 text-[12px] font-bold text-accent transition-colors hover:bg-accent hover:text-bg"
                onClick={() => betChoose(def.type)}
              >
                Commit
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
