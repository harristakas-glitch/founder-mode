import { Bar, Btn, Panel, StatCard } from '../components'
import { money, pct } from '../format'
import { STAGE_THRESHOLDS, climateLabel } from '../game/data'
import {
  boardEffectiveTarget,
  canSellSecondary,
  growthRate,
  ipoChecklist,
  ipoEligible,
  ipoVisible,
  nextStage,
  revenueGrowthRate,
  secondaryProceeds,
  valuation,
} from '../game/engine'
import { useStore } from '../store'

function SecondaryPanel() {
  const game = useStore((s) => s.game)!
  const doSecondary = useStore((s) => s.doSecondary)
  const gate = canSellSecondary(game)
  // don't clutter the early game — the option surfaces once it's within reach
  if (!gate.ok && !gate.reason?.startsWith('Already')) {
    if (game.stage === 'Pre-seed' || game.stage === 'Seed') return null
  }
  return (
    <div className="mt-3.5">
      <Panel title="Secondary sale — take money off the table">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] leading-relaxed text-mut">
            Sell <b className="text-ink">2% of your personal stake</b> at a 30% discount —{' '}
            <b className="text-ink tnum">{money(secondaryProceeds(game))}</b> banked for you, no matter how the company ends. Costs a
            little reputation and team goodwill; buys a founder who sleeps. Once per funding stage, from Series B.
            {game.bankedPayout > 0 && (
              <span className="text-good"> Banked so far: {money(game.bankedPayout)}.</span>
            )}
          </div>
          {gate.ok ? (
            <Btn variant="primary" onClick={doSecondary}>
              Sell 2% for {money(secondaryProceeds(game))}
            </Btn>
          ) : (
            <span className="text-xs text-mut">{gate.reason}</span>
          )}
        </div>
      </Panel>
    </div>
  )
}

function IpoPanel() {
  const game = useStore((s) => s.game)!
  const fileIPO = useStore((s) => s.fileIPO)

  if (game.ipo) {
    const filing = game.ipo.phase === 'filing'
    return (
      <div className="mt-3.5">
        <Panel title={`Going public — ${filing ? 'S-1 under review' : 'roadshow'}`}>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] text-mut">Phase</div>
              <b>{filing ? `Filing · ${game.ipo.weeksLeft} wk of scrutiny left` : `Roadshow · pricing in ${game.ipo.weeksLeft} wk`}</b>
            </div>
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 text-[11px] text-mut">Investor demand</div>
              <Bar
                value={game.ipo.demand}
                color={game.ipo.demand < 45 ? 'var(--color-bad)' : game.ipo.demand < 60 ? 'var(--color-warn)' : 'var(--color-good)'}
              />
            </div>
          </div>
          <div className="mt-2.5 text-xs leading-relaxed text-mut">
            {filing
              ? 'The street reads everything: bugs and a shaky reputation bleed demand, growth builds it. The roadshow starts when the review clears.'
              : 'Every strong week adds orders to the book. On pricing day, demand meets the funding climate — strong demand pops, weak demand gets the offering pulled at the door.'}
          </div>
        </Panel>
      </div>
    )
  }

  const checks = ipoChecklist(game)
  return (
    <div className="mt-3.5">
      <Panel title="The final exit — take the company public">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {checks.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[13px]">
              <span className={c.met ? 'text-good' : 'text-mut'}>{c.met ? '✓' : '◻'}</span>
              <span className={c.met ? '' : 'text-mut'}>{c.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs leading-relaxed text-mut">
          You don't need late-stage rounds to go public — profitable companies walk straight to the exchange. Eight weeks from filing
          to the bell: four of SEC scrutiny, four of roadshow. Fundraising freezes, the process eats ~15% of the team's output, and on
          pricing day the market decides — a pop crowns the run, a pulled IPO costs $2M, reputation, and ~25 weeks before the street
          will look at you again. Time it to a warm climate and a hot growth curve — and note the run no longer auto-ends at $1B while
          your IPO is in flight, so a monster debut can beat the plain unicorn ending.
        </div>
        <Btn variant="primary" className="mt-3" disabled={!ipoEligible(game)} onClick={fileIPO}>
          {game.ipoCooldown > 0 ? `The street remembers — ${game.ipoCooldown} wk` : 'File the S-1 ▸'}
        </Btn>
      </Panel>
    </div>
  )
}

export function Fundraising() {
  const game = useStore((s) => s.game)!
  const pitch = useStore((s) => s.pitch)
  const accept = useStore((s) => s.accept)
  const decline = useStore((s) => s.decline)

  const val = valuation(game)
  const target = nextStage(game)
  const threshold = STAGE_THRESHOLDS[game.stage]
  const ready = target && val >= threshold

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Fundraising</div>
      <div className="mb-4 text-[13px] text-mut">
        {game.stage} · you own {pct(game.founderEquity, 1)} · dilution is forever, choose wisely
      </div>

      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <StatCard
          label="Funding climate"
          value={climateLabel(game.climate)}
          delta={game.climate < -0.4 ? 'Valuations depressed, funds hibernating' : game.climate > 0.4 ? 'Cheap money — strike now' : 'Business as usual'}
          tone={game.climate < -0.4 ? 'down' : game.climate > 0.4 ? 'up' : undefined}
        />
        <StatCard label="Current valuation" numeric={val} format={money} />
        <StatCard
          label={target ? `Bar for ${target}` : 'Final stage'}
          value={target ? money(threshold) : '$1B exit'}
          delta={target ? (ready ? 'Investors will take the meeting' : 'Grow traction first') : undefined}
          tone={ready ? 'up' : undefined}
        />
        <StatCard label="Your stake" value={pct(game.founderEquity, 1)} delta={`worth ${money(val * game.founderEquity)} on paper`} />
      </div>

      {game.board && (
        <div className="mt-3.5">
          <Panel title="Your board">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <div className="text-[11px] text-mut">Growth target (saturation-adjusted)</div>
                <b className="tnum">{pct(boardEffectiveTarget(game), 1)}/wk</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Your user growth</div>
                <b className={`tnum ${growthRate(game) >= boardEffectiveTarget(game) ? 'text-good' : 'text-bad'}`}>
                  {pct(growthRate(game), 1)}/wk
                </b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Your revenue growth</div>
                <b className={`tnum ${revenueGrowthRate(game) >= boardEffectiveTarget(game) ? 'text-good' : 'text-bad'}`}>
                  {pct(revenueGrowthRate(game), 1)}/wk
                </b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Next review</div>
                <b className="tnum">week {game.board.nextReview}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Strikes</div>
                <span className="mt-1 inline-flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className={`h-2.5 w-2.5 rounded-full ${i < game.board!.strikes ? 'bg-bad' : 'bg-line'}`} />
                  ))}
                </span>
              </div>
              {game.board.defied && <b className="text-bad">You defied the board — hit the target by the next review or you are out.</b>}
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-mut">
              Investor money comes with investor expectations — but there are three ways to satisfy them: user growth above target,
              revenue growth above target, or real profitability (15%+ net margin with revenue still climbing). The target eases as
              your market saturates. Miss on all three at three reviews and you face an ultimatum; keep missing and the board finds a
              new CEO.
            </div>
          </Panel>
        </div>
      )}

      <SecondaryPanel />

      {ipoVisible(game) && <IpoPanel />}

      <div className="mt-3.5">
        <Panel title="Pitch investors">
          <p className="mb-3 text-[13px] leading-relaxed text-mut">
            Running a fundraise takes about 10 weeks of founder attention, so you cannot pitch constantly. Offers price around your
            valuation and swing with the funding climate — in a frozen market, even good companies get ghosted. Raising below your last
            round's price is a down round: cash in the bank, morale out the door. Term sheets expire in 3 weeks.
          </p>
          <Btn variant="primary" disabled={game.raiseCooldown > 0 || !!game.gameOver} onClick={pitch}>
            {game.raiseCooldown > 0 ? `On the road — try again in ${game.raiseCooldown} wk` : 'Start pitching ▸'}
          </Btn>
        </Panel>
      </div>

      {game.termSheets.length > 0 && (
        <div className="mt-3.5">
          <Panel title="Term sheets on the table">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {game.termSheets.map((t) => {
                const post = t.amount / t.equity
                return (
                  <div key={t.id} className="rise-in rounded-xl border border-line bg-surface2 p-4">
                    <div className="font-bold">{t.investor}</div>
                    <div className="my-2.5 text-[13px] leading-relaxed text-mut">
                      Investing <b className="text-ink tnum">{money(t.amount)}</b>
                      <br />
                      for <b className="text-ink tnum">{pct(t.equity, 1)}</b> of the company
                      <br />
                      <span className="text-xs">
                        {money(post)} post-money · expires in {t.weeksLeft} wk
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Btn variant="good" onClick={() => accept(t.id)}>
                        Sign
                      </Btn>
                      <Btn variant="danger" onClick={() => decline(t.id)}>
                        Pass
                      </Btn>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
