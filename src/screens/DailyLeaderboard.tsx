// Global leaderboard panel for the Daily Challenge. Purely presentational:
// fetches the day's top scores on mount and renders nothing at all when the
// Supabase backend isn't configured. Errors are silent (empty state).

import { useEffect, useState } from 'react'
import { Panel, Td, Th } from '../components'
import { money } from '../format'
import { onlineConfigured } from '../net/config'
import { fetchDailyTop, type DailyScore } from '../net/leaderboard'
import { endingEmoji } from '../theme'


export function DailyLeaderboard({ day, highlightPlayerId }: { day: number; highlightPlayerId?: string }) {
  const [rows, setRows] = useState<DailyScore[] | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    fetchDailyTop(day).then((scores) => {
      if (alive) setRows(scores)
    })
    return () => {
      alive = false
    }
  }, [day])

  if (!onlineConfigured) return null

  return (
    <Panel title={`Global leaderboard — Daily #${day}`}>
      {rows === null ? (
        <div className="py-3 text-center text-xs text-mut">Loading scores…</div>
      ) : rows.length === 0 ? (
        <div className="py-3 text-center text-xs text-mut">No scores yet today — set the bar.</div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Company</Th>
              <Th right>Payout</Th>
              <Th right>Weeks</Th>
              <Th right>End</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const mine = highlightPlayerId !== undefined && r.player_id === highlightPlayerId
              return (
                <tr key={r.player_id} className={mine ? 'bg-accent/10' : ''}>
                  <Td className="w-8 text-mut tnum">{i + 1}</Td>
                  <Td className={mine ? 'font-bold' : ''}>
                    {r.company}
                    {r.display_name && <span className="ml-1.5 text-[11px] text-mut">by {r.display_name}</span>}
                  </Td>
                  <Td right>{money(r.score)}</Td>
                  <Td right>{r.weeks}</Td>
                  <Td right>{endingEmoji(r.ending)}</Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
