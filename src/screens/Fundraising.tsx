import { Btn, Panel, StatCard } from '../components'
import { money, pct } from '../format'
import { STAGE_THRESHOLDS, climateLabel } from '../game/data'
import { growthRate, nextStage, valuation } from '../game/engine'
import { useStore } from '../store'

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
                <div className="text-[11px] text-mut">Growth target</div>
                <b className="tnum">{pct(game.board.targetGrowth, 1)}/wk</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Your trailing growth</div>
                <b className={`tnum ${growthRate(game) >= game.board.targetGrowth ? 'text-good' : 'text-bad'}`}>
                  {pct(growthRate(game), 1)}/wk
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
              Investor money comes with investor expectations. Miss the growth target at three reviews and you will face an ultimatum;
              keep missing it and the board will find a new CEO.
            </div>
          </Panel>
        </div>
      )}

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
                    <div className="my-2.5 text-[13.5px] leading-relaxed text-mut">
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
