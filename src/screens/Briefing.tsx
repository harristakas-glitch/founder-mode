// The weekly briefing — brief §28: the rhythm of a Career week.
//
// When the week resolves, Career does not dump every event at once; it says what mattered. The
// structure is the brief's own: the big story, why it matters, the numbers, what else happened,
// and the next best step — then one Continue. Quick Play and Arena never see this: Quick Play's
// whole promise is pace (§41), and Arena's clock must never sit behind a modal, so both keep the
// 950ms week sweep instead.
//
// §29 discipline: not every metric, not every event. One story, four numbers, at most two "also"
// lines, one recommendation. Everything else stays where it lives — the Inbox and the register —
// and this screen never invents a second evaluation: the story is picked from the same inbox the
// player will read, and the recommendation IS the register's top item. Pure presentation: reads
// state, writes nothing, and the Continue button is the only control.
import { ChevronsRight } from 'lucide-react'
import { nextBestStep } from '../attention'
import { TrendBadge } from '../components'
import { money, num } from '../format'
import { weeklyBurn } from '../game/engine'
import type { GameState } from '../game/types'
import { useStore } from '../store'

/** The one thing this week that deserves the headline, with why it matters. */
function bigStory(game: GameState): { title: string; why: string } | null {
  // A decision that arrived this week outranks any metric move — it is the thing that can expire.
  const fresh = game.inbox.find((m) => m.kind === 'choice' && !m.resolved && m.week >= game.week - 1)
  if (fresh) return { title: fresh.title, why: fresh.body.split(/(?<=\.)\s/)[0] ?? '' }

  const h = game.history
  if (h.length < 2) return null
  const now = h[h.length - 1]
  const prev = h[h.length - 2]
  // Relative movers, so a $2k cash twitch does not outrank a 20% user swing. Each carries its own
  // "why it matters" in the company's numbers, per §25: explain with the player's own company.
  const candidates: { mag: number; title: string; why: string }[] = [
    {
      mag: prev.users > 50 ? Math.abs(now.users - prev.users) / prev.users : 0,
      title: now.users >= prev.users ? `Users grew ${num(now.users - prev.users)} this week` : `You lost ${num(prev.users - now.users)} users this week`,
      why: `${num(now.users)} now. Growth compounds — and so does the other thing.`,
    },
    {
      mag: prev.revenue > 100 ? Math.abs(now.revenue - prev.revenue) / prev.revenue : 0,
      title: now.revenue >= prev.revenue ? 'Revenue stepped up' : 'Revenue slipped',
      why: `${money(now.revenue)}/wk against burn of ${money(weeklyBurn(game))}/wk.`,
    },
    {
      mag: Math.abs(now.pmf - prev.pmf) / 12,
      title: now.pmf >= prev.pmf ? 'The market is warming up' : 'The market cooled on you',
      why: `PMF ${Math.round(prev.pmf)} → ${Math.round(now.pmf)}. It moves when retained customers move.`,
    },
  ]
  const best = candidates.sort((a, b) => b.mag - a.mag)[0]
  return best && best.mag > 0.02 ? { title: best.title, why: best.why } : null
}

export function WeeklyBriefing({ week, onClose }: { week: number; onClose: () => void }) {
  const game = useStore((s) => s.game)
  if (!game) return null

  const h = game.history
  const now = h[h.length - 1]
  const prev = h.length >= 2 ? h[h.length - 2] : null
  const story = bigStory(game)
  const step = nextBestStep(game)
  const also = game.inbox.filter((m) => m.kind === 'news' && m.week >= week - 1).slice(0, 2)

  const numbers = prev
    ? [
        { label: 'Users', delta: now.users - prev.users, format: num },
        { label: 'Revenue', delta: now.revenue - prev.revenue, format: money },
        { label: 'Cash', delta: now.cash - prev.cash, format: money },
        { label: 'PMF', delta: now.pmf - prev.pmf, format: (n: number) => n.toFixed(1) },
      ].filter((n) => n.delta !== 0)
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="rise-in relative w-full max-w-[520px] rounded-[14px] border border-line2 bg-surface p-6 shadow-[var(--elev-3)]">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-mut">Week {week}</div>

        {story ? (
          <>
            <div className="mt-2 text-[22px] font-bold leading-snug tracking-[-0.01em]">{story.title}</div>
            {story.why && <div className="mt-1.5 text-[13.5px] leading-snug text-mut">{story.why}</div>}
          </>
        ) : (
          <div className="mt-2 text-[22px] font-bold leading-snug tracking-[-0.01em]">A quiet week</div>
        )}

        {numbers.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line/60 pt-3.5">
            {numbers.map((n) => (
              <span key={n.label} className="whitespace-nowrap text-[13px]">
                <span className="text-mut">{n.label}</span>
                <TrendBadge value={n.delta} format={n.format} />
              </span>
            ))}
          </div>
        )}

        {also.length > 0 && (
          <div className="mt-3.5 border-t border-line/60 pt-3.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-mut">Also happening</div>
            {also.map((m) => (
              <div key={m.id} className="mt-1.5 text-[13px] text-mut">
                {m.title}
              </div>
            ))}
          </div>
        )}

        {step && (
          <div className="mt-3.5 rounded-[10px] border border-line/70 bg-surface2 px-3.5 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-mut">Next best step</div>
            <div className="mt-1 text-[13.5px] font-semibold">{step.title}</div>
            {step.detail && <div className="mt-0.5 text-[12.5px] leading-snug text-mut">{step.detail}</div>}
          </div>
        )}

        <button
          autoFocus
          onClick={onClose}
          className="mt-5 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-accent text-[14.5px] font-bold text-bg transition-[filter] hover:brightness-110 active:scale-[0.98]"
        >
          Continue <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  )
}
