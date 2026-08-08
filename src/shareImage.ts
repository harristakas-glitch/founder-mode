// Client-side share card: draws the run's story onto a canvas — no servers, no libraries.
import type { GameState } from './game/types'
import { money, num } from './format'
import { sectorById } from './game/data'
import { ENDINGS, type EndingType } from './theme'


export interface RunMarker {
  week: number
  emoji: string
  label: string
}

// Reconstruct the run's story beats from the inbox archive.
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

export function drawResultCard(g: GameState): HTMLCanvasElement {
  const W = 1200
  const H = 630
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const ending = ENDINGS[(g.gameOver?.type ?? 'timeup') as EndingType] ?? ENDINGS.timeup
  const payout = g.gameOver?.payout ?? 0
  const font = (px: number, weight = 700) => `${weight} ${px}px -apple-system, 'Segoe UI', Roboto, Helvetica, sans-serif`

  // backdrop
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0d1428')
  bg.addColorStop(1, '#090d18')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W * 0.8, 0, 0, W * 0.8, 0, 700)
  glow.addColorStop(0, 'rgba(124, 154, 255, 0.18)')
  glow.addColorStop(1, 'rgba(124, 154, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // valuation curve across the lower half
  const hist = g.history
  if (hist.length > 1) {
    const vals = hist.map((h) => Math.sqrt(Math.max(0, h.valuation)))
    const vMax = Math.max(...vals) || 1
    const x = (i: number) => 60 + (i / (vals.length - 1)) * (W - 120)
    const y = (v: number) => H - 70 - (v / vMax) * 220
    ctx.beginPath()
    ctx.moveTo(x(0), H - 70)
    vals.forEach((v, i) => ctx.lineTo(x(i), y(v)))
    ctx.lineTo(x(vals.length - 1), H - 70)
    const area = ctx.createLinearGradient(0, H - 290, 0, H - 70)
    area.addColorStop(0, 'rgba(124, 154, 255, 0.35)')
    area.addColorStop(1, 'rgba(124, 154, 255, 0.02)')
    ctx.fillStyle = area
    ctx.fill()
    ctx.beginPath()
    vals.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))))
    ctx.strokeStyle = '#7c9aff'
    ctx.lineWidth = 4
    ctx.stroke()
    // markers on the curve
    ctx.font = font(30)
    ctx.textAlign = 'center'
    for (const mk of runMarkers(g)) {
      const found = hist.findIndex((h) => h.week >= mk.week)
      const i = found < 0 ? vals.length - 1 : Math.min(vals.length - 1, found) // past the last point → plot at the end
      if (i < 0) continue
      ctx.fillText(mk.emoji, x(i), y(vals[i]) - 14)
    }
  }

  // header
  ctx.textAlign = 'left'
  ctx.fillStyle = '#8593ab'
  ctx.font = font(24, 600)
  ctx.fillText('FOUNDER MODE', 60, 64)
  const label = g.challenge?.label ? ` · ${g.challenge.label}` : ''
  ctx.fillText(`${sectorById(g.sector).name}${label}`.toUpperCase(), 60, 96)

  ctx.fillStyle = '#dce5f5'
  ctx.font = font(64, 800)
  ctx.fillText(g.companyName.slice(0, 22), 60, 170)

  ctx.font = font(44, 800)
  ctx.fillText(`${ending.emoji} ${ending.title}`, 60, 240)
  ctx.fillStyle = payout > 0 ? '#34d399' : '#8593ab'
  ctx.font = font(92, 800)
  ctx.fillText(payout > 0 ? money(payout) : '—', 60, 340)
  ctx.fillStyle = '#8593ab'
  ctx.font = font(26, 600)
  ctx.fillText('founder payout', 64, 378)

  // stats row
  const peakUsers = Math.max(...g.history.map((h) => h.users), g.users)
  const stats: [string, string][] = [
    [`${g.gameOver?.week ?? g.week}`, 'weeks'],
    [`${g.pivots}`, 'pivots'],
    [num(peakUsers), 'peak users'],
    [`${(g.founderEquity * 100).toFixed(0)}%`, 'final stake'],
  ]
  let sx = W - 480
  for (const [v, k] of stats) {
    ctx.fillStyle = '#dce5f5'
    ctx.font = font(40, 800)
    ctx.fillText(v, sx, 90)
    ctx.fillStyle = '#8593ab'
    ctx.font = font(20, 600)
    ctx.fillText(k, sx, 120)
    sx += 120
  }

  // footer
  ctx.fillStyle = '#8593ab'
  ctx.font = font(24, 600)
  ctx.textAlign = 'right'
  ctx.fillText('play: harristakas-glitch.github.io/founder-mode', W - 40, H - 24)
  return canvas
}

export async function shareResultImage(g: GameState, text: string): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    const canvas = drawResultCard(g)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) return 'failed'
    const file = new File([blob], 'founder-mode-run.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text })
        return 'shared'
      } catch {
        // user cancelled the share sheet — fall through to download
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'founder-mode-run.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return 'downloaded'
  } catch {
    return 'failed'
  }
}
