import { Panel, StatCard } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import { estimatedCac, MARKETING_CAP, marketingMax, operatingProfit, paidUsersPerWeek } from '../game/engine'
import { useStore } from '../store'

export function Growth() {
  const game = useStore((s) => s.game)!
  const setMarketing = useStore((s) => s.setMarketing)
  const sector = sectorById(game.sector)
  const marketers = game.employees.filter((e) => e.role === 'marketer').length
  // Character-identical to the copy in Dashboard.tsx. `src/game/` exports no churn helper to import,
  // so the two stay in sync by hand until one is hoisted into the engine.
  const churnRate = sector.churn * Math.min(3, Math.max(0.3, 2.4 - game.pmf / 45 - game.quality / 250 + game.bugs / 200))

  // `marketingMax` is pure — call it once so the title, the slider, the fill and the warning cannot
  // disagree with each other about what this week's cap is.
  const cap = marketingMax(game)
  // The budget is clamped to the cap when it is SET (`replay.ts`'s `marketing` action), but the cap
  // itself falls when operating profit or cash does. So a budget set in a good week can sit above a
  // later week's cap, and the engine bills the whole of it (`weeklyBurn`). The slider cannot travel
  // past `cap`, so without this the overspend is invisible: the player sees a slider pinned at the
  // maximum and a burn that does not match it.
  const sliderValue = Math.min(game.marketingSpend, cap)
  const overCap = game.marketingSpend > cap

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Growth</h1>
      <div className="mb-4 text-[13px] text-mut">
        {sector.name} · {marketers} marketer{marketers === 1 ? '' : 's'}
        {game.founderKind === 'business' ? ' + you' : ''} on the megaphone
      </div>

      {/* Users, the users chart and the acquisition bars all lived here and all said something a
          second screen already said. What is left is the one number that argues WITH the slider
          below: churn is the leak the budget is trying to outrun. */}
      <div className="sm:max-w-[360px]">
        <StatCard
          label="Est. weekly churn"
          value={pct(churnRate, 1)}
          delta={game.pmf < 50 ? 'Without PMF, users leak out as fast as they arrive' : 'Users are sticking'}
          tone={game.pmf < 50 ? 'down' : 'up'}
        />
      </div>

      <div className="mt-3.5">
        <Panel title={`Marketing budget: ${money(game.marketingSpend)}/week (cap ${money(cap)})`}>
          {overCap && (
            <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] leading-relaxed text-warn">
              {/* colour never travels alone */}▲ Over the cap. You set {money(game.marketingSpend)}/wk and are still charged every
              dollar of it, but the cap has since fallen to {money(cap)} and the slider cannot travel past it. Move the slider to re-set
              the budget.
            </div>
          )}
          <input
            type="range"
            min={0}
            max={cap}
            step={cap > 100_000 ? 5000 : 500}
            value={sliderValue}
            style={{ ['--fill' as string]: `${(sliderValue / cap) * 100}%` }}
            onChange={(e) => setMarketing(Number(e.target.value))}
          />
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <span>
              <span className="text-mut">Est. cost per paid user (CAC):</span> <b className="tnum">{money(estimatedCac(game))}</b>
            </span>
            <span>
              <span className="text-mut">≈ paid users this budget buys:</span>{' '}
              <b className="tnum">{num(Math.round(paidUsersPerWeek(game, game.marketingSpend)))}/wk</b>
              <span className="text-mut"> (channels fatigue past ~$150k/wk)</span>
            </span>
            {/* Hype is the budget's other output, so it reads beside the users it buys rather than as
                a stat card of its own. Growth is the one screen that owns this number. */}
            <span>
              <span className="text-mut">Hype:</span> <b className="tnum">{Math.round(game.hype)}/100</b>
              <span className="text-mut"> (decays ~8%/wk — keep feeding it)</span>
            </span>
          </div>

          {/* Both explanations are true and neither changes week to week: you read them once, when
              you first wonder why the cap is the number it is. Native <details> so the toggle is
              focusable, operable from the keyboard and announced as expanded/collapsed for free. */}
          <details className="group mt-3 border-t border-line/60 pt-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-mut transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="text-[10px] transition-transform duration-150 group-open:rotate-90">▶</span>
              How the budget and its cap work
            </summary>
            <div className="mt-2 text-xs leading-relaxed text-mut">
              Spend does two things: builds hype (diminishing returns, amplified by marketers) and buys users directly at the CAC above —
              which climbs as the market saturates and falls with PMF. Word of mouth ({pct(sector.viral, 1)}/wk max for {sector.name}) only
              kicks in once PMF is real.
            </div>
            <div className="mt-2 text-xs leading-relaxed text-mut">
              <b className="text-ink">The cap is what you can fund, not what you raised.</b> It is the larger of your funding stage's ceiling
              ({money(MARKETING_CAP.byStage[game.stage])} at {game.stage}) and what the business itself throws off — this week that is{' '}
              <b className="tnum text-ink">{money(Math.max(0, operatingProfit(game)))}</b> of operating profit before marketing plus{' '}
              <b className="tnum text-ink">{money(Math.max(0, game.cash) * MARKETING_CAP.treasuryShare)}</b> from the bank. Profit raises it
              without a round; losing money does not raise it at all.
            </div>
          </details>
        </Panel>
      </div>
    </div>
  )
}
