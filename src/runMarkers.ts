// The run's story beats, reconstructed from the inbox archive. Lives apart from shareImage.ts
// so the results screen (which renders markers on the timeline chart) doesn't drag the whole
// canvas share-card renderer into the main bundle — that stays a dynamic import behind the
// share button.
import type { GameState } from './game/types'
import { ENDINGS } from './theme'

export interface RunMarker {
  week: number
  emoji: string
  label: string
}

export function runMarkers(g: GameState): RunMarker[] {
  const markers: RunMarker[] = []
  const seen = new Set<string>()
  const add = (week: number, emoji: string, label: string, once = false) => {
    if (once && seen.has(emoji + label)) return
    seen.add(emoji + label)
    markers.push({ week, emoji, label })
  }
  for (const m of [...g.inbox].reverse()) {
    const t = m.title
    if (t.startsWith('Pivot #')) add(m.week, '🔄', t.split(':')[0])
    else if (t.includes('Milestone: Product-market fit')) add(m.week, '🎯', 'PMF!')
    else if (t.startsWith('Down round:')) add(m.week, '📉', 'Down round')
    else if (/ closed: /.test(t) && m.kind === 'system') add(m.week, '💰', t.split(' closed')[0])
    else if (t.includes('launches its')) add(m.week, '🚀', 'New product line')
    else if (t.includes('files to go public')) add(m.week, '📄', 'S-1 filed')
    else if (t.startsWith('Emergency bridge')) add(m.week, '🚑', 'Bridge loan')
    else if (t.includes(`${g.companyName} acquires`)) add(m.week, '🤝', t.replace(`${g.companyName} acquires `, 'Bought '))
  }
  if (g.gameOver) {
    // `?? timeup` rather than a bare lookup: this used to dereference the result directly, so an
    // ending the table did not know about threw while building the share card.
    const e = ENDINGS[g.gameOver.type] ?? ENDINGS.timeup
    add(g.gameOver.week, e.emoji, e.title)
  }
  return markers.slice(0, 12)
}
