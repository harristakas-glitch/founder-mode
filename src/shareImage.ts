// Client-side share card: draws the run's story onto a canvas — no servers, no libraries.
// Loaded lazily (dynamic import) from the share buttons; keep it that way — a static import
// from App would pull it back into the main chunk.
import type { GameState } from './game/types'
import { money, num } from './format'
import { sectorById } from './game/data'
import { ENDINGS, type EndingType } from './theme'
import { runMarkers } from './runMarkers'
import { definingBeats, storyEnding, type StoryTone } from './game/story'

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

// ---------- the biography card: the run's 3–5 defining beats as a shareable page ----------

const TONE_INK: Record<StoryTone, string> = { good: '#34d399', bad: '#f87171', neutral: '#8593ab' }

export function drawStoryCard(g: GameState): HTMLCanvasElement {
  const W = 1200
  const H = 630
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const ending = storyEnding(g)
  const font = (px: number, weight = 700) => `${weight} ${px}px -apple-system, 'Segoe UI', Roboto, Helvetica, sans-serif`

  // same backdrop as the results card — one brand, two cards
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

  // header
  ctx.textAlign = 'left'
  ctx.fillStyle = '#8593ab'
  ctx.font = font(24, 600)
  ctx.fillText('FOUNDER MODE · THE STORY OF', 60, 64)
  ctx.fillText(sectorById(g.sector).name.toUpperCase(), 60, 96)
  ctx.fillStyle = '#dce5f5'
  ctx.font = font(60, 800)
  ctx.fillText(g.companyName.slice(0, 24), 60, 162)
  ctx.font = font(38, 800)
  ctx.fillText(g.gameOver ? `${ending.emoji} ${ending.title} — week ${g.gameOver.week}` : `Week ${g.week} — still being written`, 60, 222)

  // the defining beats, in week order, one line each
  const beats = definingBeats(g, 5)
  const truncate = (text: string, max: number): string => {
    if (ctx.measureText(text).width <= max) return text
    let t = text
    while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
    return `${t.trimEnd()}…`
  }
  let y = 292
  for (const b of beats.slice(0, 5)) {
    ctx.fillStyle = TONE_INK[b.tone]
    ctx.beginPath()
    ctx.arc(72, y - 9, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#8593ab'
    ctx.font = font(22, 700)
    ctx.fillText(`wk ${b.week}`, 94, y)
    ctx.fillStyle = '#dce5f5'
    ctx.font = font(26, 600)
    ctx.fillText(truncate(b.text, W - 260), 180, y)
    y += 52
  }

  // headline numbers
  const peakUsers = Math.max(...g.history.map((h) => h.users), g.users, 0)
  const payout = g.gameOver?.payout ?? 0
  const stats: [string, string][] = [
    [`${g.gameOver?.week ?? g.week}`, 'weeks'],
    [`${g.pivots}`, 'pivots'],
    [num(peakUsers), 'peak users'],
    [payout > 0 ? money(payout) : '—', 'founder payout'],
  ]
  let sx = 60
  for (const [v, k] of stats) {
    ctx.fillStyle = payout > 0 && k === 'founder payout' ? '#34d399' : '#dce5f5'
    ctx.font = font(38, 800)
    ctx.fillText(v, sx, 578)
    ctx.fillStyle = '#8593ab'
    ctx.font = font(19, 600)
    ctx.fillText(k, sx, 604)
    sx += Math.max(170, ctx.measureText(v).width + 90)
  }

  // footer
  ctx.fillStyle = '#8593ab'
  ctx.font = font(22, 600)
  ctx.textAlign = 'right'
  ctx.fillText('play: harristakas-glitch.github.io/founder-mode', W - 40, H - 24)
  return canvas
}

// ---------- share plumbing, one copy for both cards ----------

async function shareCanvas(canvas: HTMLCanvasElement, filename: string, text: string): Promise<'shared' | 'downloaded' | 'failed'> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) return 'failed'
  const file = new File([blob], filename, { type: 'image/png' })
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
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return 'downloaded'
}

export async function shareResultImage(g: GameState, text: string): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    return await shareCanvas(drawResultCard(g), 'founder-mode-run.png', text)
  } catch {
    return 'failed'
  }
}

export async function shareStoryImage(g: GameState, text: string): Promise<'shared' | 'downloaded' | 'failed'> {
  try {
    return await shareCanvas(drawStoryCard(g), 'founder-mode-story.png', text)
  } catch {
    return 'failed'
  }
}
