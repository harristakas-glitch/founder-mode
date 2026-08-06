import { Panel, StatCard, Bar, Th, Td } from '../components'
import { money } from '../format'
import { readHall, type RunRecord } from '../store'
import { ACHIEVEMENTS, earnedAchievements } from '../game/achievements'

const ENDING_META: Record<RunRecord['ending'], { emoji: string; name: string }> = {
  unicorn: { emoji: '🦄', name: 'Unicorn' },
  ipo: { emoji: '🔔', name: 'IPO' },
  acquired: { emoji: '🤝', name: 'Acquired' },
  timeup: { emoji: '⏱', name: 'Time up' },
  fired: { emoji: '🪑', name: 'Fired' },
  bankrupt: { emoji: '💸', name: 'Bankrupt' },
}

const ENDING_ORDER: RunRecord['ending'][] = ['unicorn', 'ipo', 'acquired', 'timeup', 'fired', 'bankrupt']

const WIN_ENDINGS = new Set<RunRecord['ending']>(['unicorn', 'ipo', 'acquired'])

export function Career() {
  const runs = readHall()
  const earned = earnedAchievements()

  if (runs.length === 0) {
    return (
      <div>
        <div className="text-xl font-extrabold tracking-tight">Career</div>
        <div className="mb-4 text-[13px] text-mut">Your record across every company you've run.</div>
        <Panel title="No history yet">
          <div className="py-4 text-center text-[13px] text-mut">
            No finished runs yet — your legend starts with your first bankruptcy.
          </div>
        </Panel>
        <div className="mt-3.5 text-[13px] text-mut">
          {earned.size}/{ACHIEVEMENTS.length} achievements unlocked
        </div>
      </div>
    )
  }

  const wins = runs.filter((r) => WIN_ENDINGS.has(r.ending)).length
  const bestPayout = Math.max(...runs.map((r) => r.score))
  const totalEarnings = runs.reduce((sum, r) => sum + r.score, 0)

  const endingCounts = new Map<RunRecord['ending'], number>()
  for (const r of runs) endingCounts.set(r.ending, (endingCounts.get(r.ending) ?? 0) + 1)

  const sectors = new Map<string, { runs: number; wins: number; best: number }>()
  for (const r of runs) {
    const s = sectors.get(r.sector) ?? { runs: 0, wins: 0, best: 0 }
    s.runs += 1
    if (WIN_ENDINGS.has(r.ending)) s.wins += 1
    s.best = Math.max(s.best, r.score)
    sectors.set(r.sector, s)
  }

  return (
    <div>
      <div className="text-xl font-extrabold tracking-tight">Career</div>
      <div className="mb-4 text-[13px] text-mut">Your record across every company you've run.</div>

      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <StatCard label="Total runs" value={String(runs.length)} />
        <StatCard label="Wins" value={String(wins)} delta="unicorn, IPO or acquisition" tone={wins > 0 ? 'up' : undefined} />
        <StatCard label="Best payout" numeric={bestPayout} format={money} />
        <StatCard label="Total founder earnings" numeric={totalEarnings} format={money} />
      </div>

      <div className="mt-3.5">
        <Panel title="Endings">
          {ENDING_ORDER.filter((e) => endingCounts.has(e)).map((e) => {
            const count = endingCounts.get(e)!
            const meta = ENDING_META[e]
            return (
              <div key={e} className="mb-2.5 flex items-center gap-3 last:mb-0">
                <span className="w-28 shrink-0 text-[13px]">
                  {meta.emoji} {meta.name}
                </span>
                <div className="flex-1">
                  <Bar value={(count / runs.length) * 100} color={WIN_ENDINGS.has(e) ? 'var(--color-good)' : undefined} />
                </div>
                <span className="w-8 shrink-0 text-right text-[13px] font-semibold tnum">{count}</span>
              </div>
            )
          })}
        </Panel>
      </div>

      <div className="mt-3.5">
        <Panel title="By sector">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead>
                <tr>
                  <Th>Sector</Th>
                  <Th right>Runs</Th>
                  <Th right>Wins</Th>
                  <Th right>Best score</Th>
                </tr>
              </thead>
              <tbody>
                {[...sectors.entries()].map(([sector, s]) => (
                  <tr key={sector}>
                    <Td>{sector}</Td>
                    <Td right>{s.runs}</Td>
                    <Td right>{s.wins}</Td>
                    <Td right>{money(s.best)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-3.5">
        <Panel title="All runs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr>
                  <Th>Company</Th>
                  <Th>Sector</Th>
                  <Th>Ending</Th>
                  <Th right>Weeks</Th>
                  <Th right>Score</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i}>
                    <Td>{r.company}</Td>
                    <Td>{r.sector}</Td>
                    <Td>
                      {(ENDING_META[r.ending]?.emoji ?? '🏁') + ' ' + (ENDING_META[r.ending]?.name ?? r.ending)}
                    </Td>
                    <Td right>{r.weeks}</Td>
                    <Td right>{money(r.score)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-3.5 text-[13px] text-mut">
        {earned.size}/{ACHIEVEMENTS.length} achievements unlocked
      </div>
    </div>
  )
}
