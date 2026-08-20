// The fit peek — the redesign system's §5 call: "PMF Breakdown Analytics… accessible as a
// persistent drawer or modal from any screen."
//
// PMF is the most causal number in the simulation (superlinear in word-of-mouth, dominant in
// churn) and the one players ask "why?" about from screens that do not answer it. This is that
// answer, one header click away from anywhere: the figure, its shape, WHAT THE STATE SAYS moves
// it, and one link to where it is acted on. Everything shown is a field the state already holds —
// quality and bugs as meters (bounded 0–100, a scale the game owns), research as a raw count
// (its scale is the engine's business, and drawing a bar would invent a ceiling), and in Career
// the per-segment read the tick itself uses. Pure presentation; writes nothing.
import { Target, X } from 'lucide-react'
import { Meter } from './components'
import { demandSignal, pmfLabel } from './game/engine'
import { PMF_LABEL, primaryLossDiagnosis, segmentSnapshots } from './game/career/pmf'
import { sectorById } from './game/data'
import { careerActive } from './CareerUI'
import { openGuide } from './onboarding/guide'
import { useStore } from './store'

export function FitPeek({ onClose }: { onClose: () => void }) {
  const game = useStore((s) => s.game)
  const setScreen = useStore((s) => s.setScreen)
  if (!game) return null
  const career = careerActive(game)

  const go = (screen: Parameters<typeof setScreen>[0]) => {
    setScreen(screen)
    onClose()
  }
  const signal = demandSignal(game)

  return (
    <div role="dialog" aria-modal="true" aria-label="Product-market fit breakdown" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="rise-in relative w-full max-w-[440px] rounded-xl border border-line2 bg-surface p-6 shadow-[var(--elev-3)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line/70 bg-surface2 text-accent">
              <Target size={18} />
            </span>
            <div>
              <div className="text-[16px] font-semibold leading-tight">{career ? 'Fit, by segment' : 'Product-market fit'}</div>
              <div className="text-[11.5px] text-mut">{career ? 'read off customers who stay' : 'the number everything compounds from'}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-1 flex h-9 w-9 items-center justify-center rounded-lg text-mut hover:bg-surface2 hover:text-ink">
            <X size={16} />
          </button>
        </div>

        {career ? (
          // Career: the same per-segment read the weekly tick scores — name, status, retention.
          <div className="mt-4 space-y-2">
            {segmentSnapshots({
              career: game.career!,
              sector: game.sector,
              quality: game.quality,
              sectorTam: sectorById(game.sector).tam,
            }).map((row) => (
              <div key={row.name} className="flex items-baseline gap-3 rounded-lg border border-line/70 bg-surface2 px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{row.name}</span>
                <span className="text-[12px] text-mut">{PMF_LABEL[row.status]}</span>
                <span className="w-10 shrink-0 text-right text-[13px] font-bold tnum">{Math.round(row.score)}</span>
              </div>
            ))}
            {(() => {
              // Churn with reasons (simulation-depth §4): the same five terms the weekly keep-rate
              // multiplies, attributed — so the drawer answers "why are they leaving" and not just
              // "how many". The share rule is stated in resolveCohortRetentionBreakdown's docblock.
              const diag = primaryLossDiagnosis({ career: game.career!, sector: game.sector, quality: game.quality, bugs: game.bugs })
              if (!diag) return null
              const NAME: Record<string, string> = {
                segment: 'who this segment is — their own ceiling',
                product: 'product fit — what you built vs what they need',
                price: 'price fit — what you charge vs what they bear',
                bugs: 'reliability — the bugs',
                novelty: 'novelty — new cohorts churn before they settle',
              }
              const order = (Object.entries(diag.breakdown.causes) as [string, number][]).sort((a, b) => b[1] - a[1])
              return (
                <div className="mt-1 rounded-lg border border-line/70 bg-surface2 px-3.5 py-2.5">
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-mut">Where the churn comes from</div>
                  <div className="mt-1 text-[13px] leading-snug">
                    Mostly <b>{NAME[diag.cause].split(' — ')[0]}</b>
                    <span className="text-mut"> ({Math.round(diag.share * 100)}% of the loss) — {NAME[diag.cause].split(' — ')[1]}.</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {order.map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 text-[11.5px]">
                        <span className="w-16 shrink-0 text-mut">{k}</span>
                        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface3">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${diag.breakdown.loss > 0 ? Math.max(2, (v / diag.breakdown.loss) * 100) : 0}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right tnum text-mut">{Math.round((v / diag.breakdown.loss) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
            <div className="pt-1 text-[12.5px] leading-snug text-mut">
              PMF here is derived, not set: product work raises quality, quality raises fit for the segment you target, fit raises retention — and
              retained customers are the number.
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[30px] font-bold tnum">{Math.round(game.pmf)}/100</span>
              <span className={`text-[12.5px] font-semibold ${game.pmf >= 60 ? 'text-good' : game.pmf < 30 ? 'text-bad' : 'text-warn'}`}>
                {pmfLabel(game.pmf)}
              </span>
            </div>
            <div className="mt-2">
              <Meter value={game.pmf} tone={game.pmf >= 60 ? 'good' : game.pmf < 30 ? 'bad' : 'accent'} />
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="text-mut">Quality — raises fit and retention</span>
                  <span className="font-bold tnum">{Math.round(game.quality)}</span>
                </div>
                <div className="mt-1"><Meter value={game.quality} tone="accent" /></div>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="text-mut">Bugs — drag it back down</span>
                  <span className="font-bold tnum">{Math.round(game.bugs)}</span>
                </div>
                <div className="mt-1"><Meter value={game.bugs} tone={game.bugs > 55 ? 'bad' : 'warn'} /></div>
              </div>
              <div className="flex items-baseline justify-between rounded-lg border border-line/70 bg-surface2 px-3.5 py-2.5 text-[12.5px]">
                <span className="text-mut">Research on this idea</span>
                <span className="font-bold">
                  {signal === 'unknown' ? (
                    <span className="tnum">{Math.round(game.researchSignal)} — too little to read demand</span>
                  ) : (
                    <span className={signal === 'weak' ? 'text-bad' : signal === 'strong' ? 'text-good' : 'text-warn'}>
                      demand reads {signal.toUpperCase()}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={() => go(career ? 'discovery' : 'product')}
            className="rounded-lg border border-line2 px-3 py-1.5 text-[12.5px] font-bold text-ink transition-colors hover:border-accent"
          >
            {career ? 'Discovery →' : 'Product →'}
          </button>
          <button
            onClick={() => {
              openGuide('pmf')
              onClose()
            }}
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-mut transition-colors hover:text-ink"
          >
            How PMF works
          </button>
        </div>
      </div>
    </div>
  )
}
