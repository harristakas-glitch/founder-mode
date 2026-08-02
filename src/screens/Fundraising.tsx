import { Panel, StatCard } from '../components'
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
      <div className="screen-title">Fundraising</div>
      <div className="screen-sub">
        {game.stage} · you own {pct(game.founderEquity, 1)} · dilution is forever, choose wisely
      </div>

      <div className="grid cols-4">
        <StatCard
          label="Funding climate"
          value={climateLabel(game.climate)}
          delta={game.climate < -0.4 ? 'Valuations depressed, funds hibernating' : game.climate > 0.4 ? 'Cheap money — strike now' : 'Business as usual'}
          tone={game.climate < -0.4 ? 'down' : game.climate > 0.4 ? 'up' : undefined}
        />
        <StatCard label="Current valuation" value={money(val)} />
        <StatCard
          label={target ? `Bar for ${target}` : 'Final stage'}
          value={target ? money(threshold) : '$1B exit'}
          delta={target ? (ready ? 'Investors will take the meeting' : 'Grow traction first') : undefined}
          tone={ready ? 'up' : undefined}
        />
        <StatCard label="Your stake" value={pct(game.founderEquity, 1)} delta={`worth ${money(val * game.founderEquity)} on paper`} />
      </div>

      {game.board && (
        <div className="mt">
          <Panel title="Your board">
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>Growth target</div>
                <b>{pct(game.board.targetGrowth, 1)}/wk</b>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>Your trailing growth</div>
                <b className={growthRate(game) >= game.board.targetGrowth ? 'good-text' : 'bad-text'}>
                  {pct(growthRate(game), 1)}/wk
                </b>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>Next review</div>
                <b>week {game.board.nextReview}</b>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>Strikes</div>
                <span className="strike-dots">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className={i < game.board!.strikes ? 'on' : ''} />
                  ))}
                </span>
              </div>
              {game.board.defied && (
                <b className="bad-text">You defied the board — hit the target by the next review or you are out.</b>
              )}
            </div>
            <div className="muted mt" style={{ fontSize: '0.8rem' }}>
              Investor money comes with investor expectations. Miss the growth target at three reviews and you will
              face an ultimatum; keep missing it and the board will find a new CEO.
            </div>
          </Panel>
        </div>
      )}

      <div className="mt">
        <Panel title="Pitch investors">
          <p className="muted" style={{ fontSize: '0.88rem', marginBottom: 12 }}>
            Running a fundraise takes about 10 weeks of founder attention, so you cannot pitch constantly. Offers price
            around your valuation and swing with the funding climate — in a frozen market, even good companies get
            ghosted. Raising below your last round's price is a down round: cash in the bank, morale out the door.
            Term sheets expire in 3 weeks.
          </p>
          <button className="btn primary" disabled={game.raiseCooldown > 0 || !!game.gameOver} onClick={pitch}>
            {game.raiseCooldown > 0 ? `On the road — try again in ${game.raiseCooldown} wk` : 'Start pitching ▸'}
          </button>
        </Panel>
      </div>

      {game.termSheets.length > 0 && (
        <div className="mt">
          <Panel title="Term sheets on the table">
            <div className="grid cols-3">
              {game.termSheets.map((t) => {
                const post = t.amount / t.equity
                return (
                  <div className="sheet" key={t.id}>
                    <div className="inv">{t.investor}</div>
                    <div className="terms">
                      Investing <b>{money(t.amount)}</b>
                      <br />
                      for <b>{pct(t.equity, 1)}</b> of the company
                      <br />
                      <span className="muted">
                        {money(post)} post-money · expires in {t.weeksLeft} wk
                      </span>
                    </div>
                    <button className="btn good" style={{ marginRight: 8 }} onClick={() => accept(t.id)}>
                      Sign
                    </button>
                    <button className="btn danger" onClick={() => decline(t.id)}>
                      Pass
                    </button>
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
