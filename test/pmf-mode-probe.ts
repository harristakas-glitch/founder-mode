// The cross-mode PMF probe — owner report 2026-08-21: "PMF seems very easy on simulation
// [Career], hard on Quick Play, and Arena was hard last time."
//
// One instrument, three arms, the same 24 seeds, so the difficulty claim becomes a number:
//
//   QUICK   — 90 weeks, the calibrated default allocation, choices resolved option-0.
//   ARENA'  — the same policy under Arena's config and its 52-week cap, NO opponents. This
//             deliberately isolates the PROGRESSION difficulty (less time, same engine) from
//             opponent pressure, which the duel/ffa probes own. A prime, not the real Arena.
//   CAREER  — the same two bounds the balance baseline uses: Careless (never researches) and
//             Disciplined (experiments first), because Career PMF is unreachable without
//             mode-specific actions and a "neutral" career bot would measure ignorance, not ease.
//
// Reported per arm: share of seeds crossing PMF 30 and 60, median week of each crossing, and the
// final PMF quartiles. Read-only over the engine; prints, changes nothing.
import {
  advanceWeek,
  newGame,
  resolveChoiceOnState,
  pitchInvestors,
  acceptTermSheet,
  marketingMax,
} from '../src/game/engine'
import { segmentsForSector, segmentDef } from '../src/game/career/segments'
import { repositionTo } from '../src/game/career/tick'
import type { GameState, SectorId } from '../src/game/types'

const SEEDS = Array.from({ length: 24 }, (_, i) => 11 * (i + 1))
const SECTORS: SectorId[] = ['saas', 'social']

function common(s: GameState) {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
  if (s.raiseCooldown === 0 && s.cash < (s.lastExpenses || 5000) * 25) s.termSheets = pitchInvestors(s).sheets
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  s.marketingSpend = Math.min(s.marketingSpend || 4000, marketingMax(s))
}

interface Track { cross30: number | null; cross60: number | null; final: number }

function track(s0: GameState, weeks: number, act: (s: GameState) => void): Track {
  let s = s0
  const t: Track = { cross30: null, cross60: null, final: 0 }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    act(s)
    common(s)
    s = advanceWeek(s)
    if (t.cross30 === null && s.pmf >= 30) t.cross30 = s.week
    if (t.cross60 === null && s.pmf >= 60) t.cross60 = s.week
  }
  t.final = s.pmf
  return t
}

function quickArm(seed: number, sector: SectorId, mode: 'quick' | 'arena', weeks: number): Track {
  const s = newGame('Probe', sector, 'technical', {
    config: { mode, format: mode === 'arena' ? 'sprint' : 'standard', sector, seed } as never,
  })
  s.allocation = { features: 40, quality: 20, bugs: 15, research: 25, bet: 0 }
  s.marketingSpend = 4000
  return track(s, weeks, () => {})
}

function careerArm(seed: number, sector: SectorId, disciplined: boolean): Track {
  const s = newGame('Probe', sector, 'technical', {
    config: { mode: 'career', format: 'standard', sector, seed } as never,
  })
  const segs = segmentsForSector(sector)
  const easiest = [...segs].sort((a, b) => b.base.acquisitionAccessibility - a.base.acquisitionAccessibility)[0]
  repositionTo(s, easiest.id, 1)
  s.career!.pricing = disciplined ? 'market' : 'low'
  s.career!.focus = segmentDef(sector, easiest.id).values[0]
  s.allocation = disciplined
    ? { features: 30, quality: 30, bugs: 15, research: 25, bet: 0 }
    : { features: 65, quality: 10, bugs: 10, research: 15, bet: 0 }
  s.marketingSpend = 4000
  return track(s, 90, () => {})
}

const q = (xs: number[], p: number) => {
  const a = [...xs].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(p * a.length))]
}
const fmt = (t: Track[]) => {
  const c30 = t.filter((x) => x.cross30 !== null)
  const c60 = t.filter((x) => x.cross60 !== null)
  const finals = t.map((x) => x.final)
  return (
    `PMF≥30: ${String(c30.length).padStart(2)}/${t.length} (median wk ${c30.length ? q(c30.map((x) => x.cross30!), 0.5) : '—'})` +
    ` · PMF≥60: ${String(c60.length).padStart(2)}/${t.length} (median wk ${c60.length ? q(c60.map((x) => x.cross60!), 0.5) : '—'})` +
    ` · final p25/p50/p75: ${Math.round(q(finals, 0.25))}/${Math.round(q(finals, 0.5))}/${Math.round(q(finals, 0.75))}`
  )
}

for (const sector of SECTORS) {
  console.log(`\n=== ${sector} · 24 seeds ===`)
  console.log(`  quick 90wk        ${fmt(SEEDS.map((s) => quickArm(s, sector, 'quick', 90)))}`)
  console.log(`  arena' 52wk       ${fmt(SEEDS.map((s) => quickArm(s, sector, 'arena', 52)))}`)
  console.log(`  career-careless   ${fmt(SEEDS.map((s) => careerArm(s, sector, false)))}`)
  console.log(`  career-discipline ${fmt(SEEDS.map((s) => careerArm(s, sector, true)))}`)
}
