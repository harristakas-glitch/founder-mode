import { AlertTriangle } from 'lucide-react'
import { Disclosure, Meter, NESTED, Panel } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import { effectiveChurn, estimatedCac, MARKETING_CAP, marketingMax, operatingProfit, paidUsersPerWeek } from '../game/engine'
import { useStore } from '../store'

export function Growth() {
  const game = useStore((s) => s.game)!
  const setMarketing = useStore((s) => s.setMarketing)
  const sector = sectorById(game.sector)
  const marketers = game.employees.filter((e) => e.role === 'marketer').length
  // One formula, one home: `effectiveChurn` in src/game/engine.ts — the same call the attention
  // register makes, so this banner and the churn warning can never disagree.
  const churnRate = effectiveChurn(game)
  // The sector's base churn is the yardstick the banner measures against. Past 1.5× it, the whole
  // banner turns amber — and says so in words, because colour never travels alone.
  const sectorAvgChurn = sector.churn
  const churnHot = churnRate > sectorAvgChurn * 1.5
  // Display-only arithmetic: the leak in people rather than percent. No engine call owns this
  // number; it is the two numbers above it multiplied, shown so the % has a body count.
  const usersLostPerWeek = Math.round(game.users * churnRate)

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
      <h1 className="font-[family-name:var(--font-display)] text-[28px] font-normal leading-none tracking-normal">Growth</h1>
      <div className="mb-4 text-[13px] text-mut">
        {sector.name} · {marketers} marketer{marketers === 1 ? '' : 's'}
        {game.founderKind === 'business' ? ' + you' : ''} on the megaphone
      </div>

      {/* Users, the users chart and the acquisition bars all lived here and all said something a
          second screen already said. What is left is the one number that argues WITH the slider
          below: churn is the leak the budget is trying to outrun — so it reads as the mock's
          warning banner, not as one more stat card. */}
      <Panel className={churnHot ? 'border-warn/60' : ''}>
        <div className="flex items-start gap-4">
          <div className={`${NESTED} flex h-11 w-11 shrink-0 items-center justify-center`}>
            <AlertTriangle size={20} className="text-warn" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mut">Est. weekly churn</div>
            <div className="mt-1 text-[34px] leading-[1.05] font-bold tracking-[-0.02em] text-warn tnum">{pct(churnRate, 1)}</div>
            <div className="mt-1.5 text-[13px] leading-snug">
              <span className="text-mut">At {num(game.users)} users you lose</span> <b className="tnum">~{num(usersLostPerWeek)} users/wk</b>
              {churnHot ? (
                <span className="text-warn"> — over 1.5× the {sector.name} average of {pct(sectorAvgChurn, 1)}</span>
              ) : (
                <span className="text-mut"> · {sector.name} average {pct(sectorAvgChurn, 1)}</span>
              )}
            </div>
            <div className="mt-1 text-[12.5px] leading-snug text-mut">
              {game.pmf < 50 ? 'Without PMF, users leak out as fast as they arrive.' : 'Users are sticking.'}
            </div>
          </div>
        </div>
      </Panel>

      <div className="mt-3.5">
        <Panel title={`Marketing budget: ${money(game.marketingSpend)}/week`}>
          {overCap && (
            <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] leading-relaxed text-warn">
              {/* colour never travels alone */}▲ Over the cap. You set {money(game.marketingSpend)}/wk and are still charged every
              dollar of it, but the cap has since fallen to {money(cap)} and the slider cannot travel past it. Move the slider to re-set
              the budget.
            </div>
          )}
          {/* The mock's split: the slider keeps the room on the left, and the numbers the budget
              answers to — the cap and the hype it buys — read as a compact column on the right.
              Both already lived in this card; only their seats changed. */}
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="min-w-0 flex-1">
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
              </div>
            </div>
            <div className={`${NESTED} flex shrink-0 flex-col gap-3 px-3.5 py-3 md:w-[210px]`}>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mut">Cap this week</div>
                <div className="mt-0.5 text-[17px] font-bold tnum">{money(cap)}</div>
              </div>
              {/* Hype is the budget's other output. Growth is the one screen that owns this number,
                  and the meter gives the bounded 0–100 a shape the bare figure cannot. */}
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mut">Hype</span>
                  <span className="text-[13px] font-bold tnum">{Math.round(game.hype)}/100</span>
                </div>
                <div className="mt-1.5">
                  <Meter value={game.hype} tone="accent" />
                </div>
                <div className="mt-1 text-[11px] leading-snug text-mut">Decays ~8%/wk — keep feeding it</div>
              </div>
            </div>
          </div>

          {/* Both explanations are true and neither changes week to week: you read them once, when
              you first wonder why the cap is the number it is. */}
          <Disclosure label="How the budget and its cap work" className="mt-3 border-t border-line/60 pt-2.5">
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
          </Disclosure>
        </Panel>
      </div>
    </div>
  )
}
