import { AlertTriangle } from 'lucide-react'
import { Disclosure, Meter, NESTED, Panel } from '../components'
import { money, num, pct } from '../format'
import { sectorById } from '../game/data'
import { effectiveChurn, MARKETING_CAP, marketingMax, operatingProfit, paidUsersPerWeek, unitEconomics } from '../game/engine'
import { useStore } from '../store'
import { systemDepth, usesBusinessSimulationV2 } from '../game/modes'
import { growthSignals, mixAlignment } from '../game/strategic/growth'
import { bigBetDef } from '../game/strategic/bigbets'
import { openGuide } from '../onboarding/guide'

export function Growth() {
  const game = useStore((s) => s.game)!
  const setMarketing = useStore((s) => s.setMarketing)
  const setGrowthMix = useStore((s) => s.setGrowthMix)
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
  // Owner direction (2026-08-21): a startup simulator teaches CAC, LTV and payback where they
  // fit — and they fit HERE, beside the budget that spends them. Engine-true via unitEconomics();
  // each term opens the field guide, so the numbers onboard the vocabulary instead of assuming it.
  const econ = unitEconomics(game)

  return (
    <div>
      <h1 className="text-[28px] font-bold tracking-tight">Growth</h1>
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
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
                {/* Each term is a guide link: the strip teaches the vocabulary, not just the number. */}
                <span>
                  <button onClick={() => openGuide('cac')} className="text-mut underline decoration-dotted underline-offset-2 hover:text-ink" title="What is CAC? — opens the field guide">CAC</button>{' '}
                  <b className="tnum">{money(econ.cac)}</b>
                </span>
                <span>
                  <button onClick={() => openGuide('ltv')} className="text-mut underline decoration-dotted underline-offset-2 hover:text-ink" title="What is LTV? — opens the field guide">LTV</button>{' '}
                  <b className="tnum">{money(econ.ltv)}</b>
                  <span className={`ml-1.5 tnum text-[12px] font-bold ${econ.ratio >= 3 ? 'text-good' : econ.ratio < 1 ? 'text-bad' : 'text-warn'}`}>
                    {econ.ratio >= 100 ? '99x+' : `${econ.ratio.toFixed(1)}x`} CAC
                  </span>
                </span>
                <span>
                  <button onClick={() => openGuide('payback')} className="text-mut underline decoration-dotted underline-offset-2 hover:text-ink" title="What is payback? — opens the field guide">Payback</button>{' '}
                  {Number.isFinite(econ.paybackWeeks) ? (
                    <b className="tnum">{Math.ceil(econ.paybackWeeks)} wk</b>
                  ) : (
                    <b className="text-warn">no revenue yet</b>
                  )}
                </span>
                <span>
                  <span className="text-mut">≈ this budget buys</span>{' '}
                  <b className="tnum">{num(Math.round(paidUsersPerWeek(game, game.marketingSpend)))}/wk</b>
                </span>
              </div>
              {/* Career reads its REAL segment economics now (engine unitEconomics, rank 6) —
                  an honest sub-1x mid-game means "not yet", and this line says what changes it. */}
              {game.career && econ.ratio < 1 && (
                <div className="mt-1.5 text-[11.5px] leading-snug text-warn">
                  Every marketing dollar currently buys less than it returns — retention is what changes that. Scale spend after your
                  settled cohorts hold, not before.
                </div>
              )}
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

        {/* ---------- THE GROWTH ENGINE (CRO + marketing mix brief): where the budget GOES ----
            Performance captures demand now; brand creates demand ~8 weeks out and compounds.
            The default is 100% performance — exactly the game before this system existed. */}
        {systemDepth(game, 'growthMix') !== 'off' && (() => {
          const g = game.growth ?? { performanceShare: 1, lastMixWeek: 0, brand: { stock: 0, pending: [] } }
          const perf = Math.round(g.performanceShare * 100)
          const sig = growthSignals(game)
          const bet = game.bigBet?.status === 'active' ? game.bigBet : null
          const align = bet ? mixAlignment(bet.type, g.performanceShare) : null
          return (
            <Panel title="Where the budget goes" className="mt-3.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-[220px] flex-1">
                  <div className="mb-1 flex justify-between text-[12.5px]">
                    <span className="font-semibold">Performance <span className="text-mut tnum">{perf}%</span></span>
                    <span className="font-semibold">Brand <span className="text-mut tnum">{100 - perf}%</span></span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={perf}
                    aria-label="Share of budget to performance marketing"
                    style={{ ['--fill' as string]: `${perf}%` }}
                    onChange={(e) => setGrowthMix(Number(e.target.value) / 100)}
                  />
                  <div className="mt-1 text-[11.5px] leading-snug text-mut">
                    Performance buys users this week at the CAC above. Brand matures in ~8 weeks into an asset: organic pull,
                    cheaper paid acquisition, a little pricing trust — and it decays if you stop feeding it.
                  </div>
                </div>
                <div className="shrink-0 space-y-1.5 text-[12.5px] md:w-[230px]">
                  <div>
                    <span className="text-mut">Brand </span>
                    <b className={g.brand.stock >= 25 ? 'text-good' : g.brand.stock >= 8 ? 'text-ink' : 'text-mut'}>{sig.brand}</b>
                    {sig.brandMaturesIn !== null && (
                      <span className="ml-1.5 text-[11px] text-mut tnum">next campaign lands in {sig.brandMaturesIn}w</span>
                    )}
                  </div>
                  <div>
                    <span className="text-mut">Paid channels </span>
                    <b className={sig.saturation === 'Crowded' ? 'text-warn' : 'text-ink'}>{sig.saturation}</b>
                  </div>
                  {align && (
                    <div className={align === 'supports' ? 'text-good' : align === 'competes' ? 'text-warn' : 'text-mut'}>
                      {align === 'supports' ? 'Supports' : align === 'competes' ? 'Competes with' : 'Neutral to'} {bigBetDef(bet!.type).name}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2.5 border-t border-line/50 pt-2 text-[12.5px]">
                <span className="text-[10px] font-bold tracking-wider text-mut uppercase">Constraint </span>
                <span className="text-mut">{sig.constraint}</span>
              </div>
            </Panel>
          )
        })()}
        <V2PricingPanel />
      </div>
    </div>
  )
}

/** V2 runs (spec §13.4): the PRICE DIAL — a real number, judged per segment against what you
 *  KNOW they'd pay (estimates, never truth) — and the positioning declaration (§12): who the
 *  story is for. Both journaled; both feed the same market resolution everything else does. */
function V2PricingPanel() {
  const game = useStore((s) => s.game)!
  const v2SetPrice = useStore((s) => s.v2SetPrice)
  const v2SetPositioning = useStore((s) => s.v2SetPositioning)
  if (!usesBusinessSimulationV2(game) || !game.simV2) return null
  const v2 = game.simV2
  const price = v2.pricing.price
  const readFor = (segId: string): { word: string; cls: string } => {
    const seg = v2.segments.find((x) => x.id === segId)!
    const est = seg.knowledge.wtp
    if (est.confidence < 0.35) return { word: 'unknown — research them', cls: 'text-mut/70' }
    const r = price / Math.max(0.1, est.visibleEstimate)
    if (r < 0.55) return { word: 'Underpriced', cls: 'text-warn' }
    if (r < 0.9) return { word: 'Strong value', cls: 'text-good' }
    if (r < 1.25) return { word: 'Fair', cls: 'text-good' }
    if (r < 2) return { word: 'Expensive', cls: 'text-warn' }
    return { word: 'Far above them', cls: 'text-bad' }
  }
  return (
    <Panel title="Price & positioning" className="mt-4">
      <div className="flex items-center gap-3">
        <span className="text-[12.5px] text-mut">Price</span>
        <input
          type="range"
          min={Math.max(0.5, price * 0.25)}
          max={price * 4}
          step={price > 40 ? 1 : 0.5}
          value={price}
          onChange={(e) => v2SetPrice(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-accent)]"
          aria-label="Weekly price per customer"
        />
        <b className="w-20 shrink-0 text-right text-[15px] tnum">{money(price)}/wk</b>
      </div>
      <div className="mt-2.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {v2.segments.map((seg) => {
          const r = readFor(seg.id)
          return (
            <div key={seg.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="text-mut">{seg.name}</span>
              <b className={r.cls}>{r.word}</b>
            </div>
          )
        })}
      </div>
      <div className="mt-3 border-t border-line/50 pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-mut" title="Who the story is FOR — the declared segment hears your marketing better; everyone else a little worse">
            Positioning
          </span>
          {v2.segments.map((seg) => (
            <button
              key={seg.id}
              onClick={() => v2SetPositioning(v2.positioning?.targetSegmentId === seg.id ? '' : seg.id)}
              aria-pressed={v2.positioning?.targetSegmentId === seg.id}
              className={`min-h-[30px] rounded-full border px-2.5 text-[11.5px] font-semibold transition-colors ${
                v2.positioning?.targetSegmentId === seg.id
                  ? 'border-accent bg-accent/15 text-ink'
                  : 'border-line2 bg-surface2 text-mut hover:text-ink'
              }`}
            >
              {seg.name}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  )
}
