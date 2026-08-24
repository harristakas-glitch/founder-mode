// Win-rate probe — the balance campaign's baseline instrument (owner calibration, 2026-08-23:
// "in many quick plays I win very easily and many simulation games I lose also very easily").
//
// Run: npx tsx test/winrate-probe.ts [seeds] [sector...]
//
// Two archetypal players, both modes, many seeds. The point is DIFFICULTY CALIBRATION, not
// strategy ranking (career-bots.ts owns that): a CASUAL first-timer should not win most quick
// runs, and an ACTIVE, reasonable player should not die in most simulation runs. Harness rules
// inherited from career-bots.ts / balance-probe.ts: budgets through the same clamps a player
// has, raises actually accepted, `failed` (bankrupt+fired) reported separately from exits,
// score off gameOver.payout.

import { advanceWeek, newGame, pitchInvestors, acceptTermSheet, resolveChoiceOnState, valuation, marketingMax } from '../src/game/engine'
import { segmentsForSector, startExperiment, canRunExperiment, experimentDef } from '../src/game/career/pmf'
import { repositionTo } from '../src/game/career/tick'
import { sectorById } from '../src/game/data'
import type { GameState, SectorId } from '../src/game/types'

const ASSERT = process.argv.includes('--assert')
const argRest = process.argv.slice(2).filter((a) => a !== '--assert')
const SEEDS = Number(argRest[0]) || 16
const SECTORS = (argRest.slice(1).length ? argRest.slice(1) : ['saas', 'social']) as SectorId[]
const WEEKS = { quick: 104, career: 120 } as const

let ids = 0
const uid = () => `wr${ids++}`

function common(s: GameState, raiseFreely: boolean) {
  for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
  if (s.raiseCooldown === 0 && (raiseFreely ? s.termSheets.length === 0 && s.week % 8 === 0 : s.cash < (s.lastExpenses || 5000) * 25)) {
    s.termSheets = pitchInvestors(s).sheets
  }
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
}

/** What a first-time player does: defaults, some ads, a hire when flush, says yes to money. */
function casual(s: GameState): void {
  common(s, true)
  s.marketingSpend = Math.min(5000, marketingMax(s))
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  if (s.cash > 150_000 && staff < 4 && s.candidates.length) {
    const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== best.id)
    s.offersOut.push(best)
  }
}

/** A reasonable, attentive player: reads the dashboard and reacts with the normal levers. */
function active(s: GameState): void {
  common(s, false)
  // allocation reacts to state the way the UI teaches
  if (s.bugs > 45) s.allocation = { features: 25, quality: 20, bugs: 40, research: 15, bet: 0 }
  else if (s.pmf < 40) s.allocation = { features: 30, quality: 35, bugs: 10, research: 25, bet: 0 }
  else s.allocation = { features: 50, quality: 25, bugs: 10, research: 15, bet: 0 }
  // marketing scaled to runway: push when funded, cut when tight
  const runway = s.cash / Math.max(1, (s.lastExpenses || 5000) - (s.lastRevenue || 0))
  s.marketingSpend = runway > 30 ? Math.min(12_000, marketingMax(s)) : runway > 15 ? 4000 : 500
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  const affordable = Math.min(8, 1 + Math.floor((s.lastRevenue || 0) / 2500))
  if (runway > 25 && staff < affordable && s.candidates.length) {
    const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== best.id)
    s.offersOut.push(best)
  }
  // career: target an accessible segment, price sanely, run the cheap experiments
  if (s.career) {
    if (s.week === 2) {
      // The informed opening: the best BELIEVED reachable segment on retention+pay — the same
      // scoring the mid-game pivot uses, applied on day one. (The old heuristic — chase the most
      // ACCESSIBLE segment — is a designed mistake in trust-heavy sectors like fintech, and
      // measuring it forever measured stubbornness, not the game.)
      const segs = segmentsForSector(s.sector)
      const seg =
        [...segs]
          .map((o) => ({ o, b: s.career!.segmentBeliefs[o.id] }))
          .filter((x) => !!x.b && x.b.acquisitionAccessibility.estimate >= 30 && x.b.marketSize.estimate >= 25)
          .sort(
            (a, b2) =>
              b2.b!.retentionPotential.estimate + b2.b!.willingnessToPay.estimate - (a.b!.retentionPotential.estimate + a.b!.willingnessToPay.estimate),
          )[0]?.o ?? [...segs].sort((a, b) => b.base.acquisitionAccessibility - a.base.acquisitionAccessibility)[0]
      repositionTo(s, seg.id, 1)
      s.career.pricing = 'market'
    }
    const seg = s.career.primaryTargetSegmentId
    if (s.week % 10 === 3 && canRunExperiment(s.career, 'interview', seg, s.cash).ok) {
      startExperiment(s.career, s.week, 'interview', seg, uid())
      s.cash -= experimentDef('interview').cashCost
    }
    // THE INFORMED MID-GAME CORRECTION. The active player reads the game's own signals — the
    // hypothesis board saying the target churns by nature while another segment's believed
    // retention is far higher — and repositions once, inside the window. This is exactly the
    // move the guidance now signposts (plan ranks 4/5) and the softened pivot (rank 7) prices;
    // a probe bot that ignores the game's own advice measures stubbornness, not difficulty.
    if (s.week >= 24 && s.week <= 40 && !s.career.repositioning && !(s as GameState & { _pivoted?: boolean })._pivoted) {
      const b = s.career.segmentBeliefs[seg]
      const measured = s.career.retentionBySegment[seg] ?? 1
      // signal 1 (the rank-4 signpost): the board says the target churns by nature
      const churnTrap = !!b && b.retentionPotential.confidence >= 0.5 && b.retentionPotential.estimate < 35 && measured < 0.62
      // signal 2 (round 2): the target stays but never PAYS — a low-WTP belief corroborated by
      // the P&L the way the guidance now reads it (revenue per customer under half sector norm)
      const revPer = s.users > 0 ? s.lastRevenue / s.users : Infinity
      const wtpTrap =
        !!b &&
        b.willingnessToPay.estimate < 40 &&
        (b.willingnessToPay.confidence >= 0.5 || (b.willingnessToPay.confidence >= 0.3 && revPer < sectorById(s.sector).arpuPerCustomer * 0.5))
      // signal 3 (the rank-5 signpost): mid-game stagnation — PMF stuck below real pull
      const stagnant = s.week >= 30 && s.pmf < 50 && !!b
      if (churnTrap || wtpTrap || stagnant) {
        // read the whole board: the best-believed OTHER segment on retention+pay combined, and
        // only move when it's believed meaningfully better than where you stand
        const here = b ? b.retentionPotential.estimate + b.willingnessToPay.estimate : 0
        const better = segmentsForSector(s.sector)
          .filter((o) => o.id !== seg)
          .map((o) => ({ o, belief: s.career!.segmentBeliefs[o.id] }))
          .filter((x) => !!x.belief && x.belief.retentionPotential.estimate >= 45)
          // reachable + big enough (the whole board, not just the flattering rows): without this
          // the picker sent every fintech run at fortress institutions and they starved
          .filter((x) => x.belief!.acquisitionAccessibility.estimate >= 30 && x.belief!.marketSize.estimate >= 25)
          .map((x) => ({ ...x, sum: x.belief!.retentionPotential.estimate + x.belief!.willingnessToPay.estimate }))
          .filter((x) => x.sum > here + 25)
          .sort((a, b2) => b2.sum - a.sum)[0]
        if (better) {
          if (process.env.PIVOT_LOG) {
            console.log(
              `  pivot wk${s.week} ${seg}→${better.o.id} (${churnTrap ? 'churn' : wtpTrap ? 'wtp' : 'stagnant'}) pmf=${Math.round(s.pmf)} revPer=${revPer === Infinity ? '∞' : revPer.toFixed(2)} pricing=${better.belief!.willingnessToPay.estimate > 60 ? 'premium' : 'market'}`,
            )
          }
          repositionTo(s, better.o.id, s.week)
          s.career.pricing = better.belief!.willingnessToPay.estimate > 60 ? 'premium' : 'market'
          ;(s as GameState & { _pivoted?: boolean })._pivoted = true
        }
      }
    }
  }
}

interface Row {
  mode: 'quick' | 'career'
  sector: SectorId
  player: 'casual' | 'active'
  bankrupt: number
  fired: number
  unicorn: number
  exits: number
  alive: number
  deathWeeks: number[]
  exitWeeks: number[]
  vals: number[]
}

function play(mode: 'quick' | 'career', sector: SectorId, player: 'casual' | 'active', seed: number) {
  let s = newGame('P', sector, 'technical', { config: { mode, format: 'standard', sector, seed } })
  const act = player === 'casual' ? casual : active
  for (let i = 0; i < WEEKS[mode] && !s.gameOver; i++) {
    act(s)
    s = advanceWeek(s)
  }
  return s
}

const rows: Row[] = []
for (const mode of ['quick', 'career'] as const) {
  for (const sector of SECTORS) {
    for (const player of ['casual', 'active'] as const) {
      const row: Row = { mode, sector, player, bankrupt: 0, fired: 0, unicorn: 0, exits: 0, alive: 0, deathWeeks: [], exitWeeks: [], vals: [] }
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = play(mode, sector, player, seed * 101 + 7)
        const g = s.gameOver
        if (!g || g.type === 'timeup') row.alive++
        else if (g.type === 'bankrupt' || g.type === 'fired') {
          if (g.type === 'bankrupt') row.bankrupt++
          else row.fired++
          row.deathWeeks.push(g.week)
        } else if (g.type === 'unicorn') row.unicorn++
        else {
          row.exits++
          row.exitWeeks.push(g.week)
        }
        row.vals.push(g?.payout ?? Math.round(valuation(s) * s.founderEquity))
      }
      rows.push(row)
    }
  }
}

const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)
const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`)
console.log(`\n${SEEDS} seeds × ${SECTORS.join('/')} — horizon: quick ${WEEKS.quick}wk, career ${WEEKS.career}wk\n`)
console.log('mode    sector  player  | bkrpt fired unicorn exits alive | death-wk exit-wk  med-founder-net')
for (const r of rows) {
  console.log(
    `${r.mode.padEnd(7)} ${r.sector.padEnd(7)} ${r.player.padEnd(7)}| ${String(r.bankrupt).padStart(5)} ${String(r.fired).padStart(5)} ${String(r.unicorn).padStart(7)} ${String(r.exits).padStart(5)} ${String(r.alive).padStart(5)} | ${String(med(r.deathWeeks) || '—').padStart(8)} ${String(med(r.exitWeeks) || '—').padStart(7)}  ${money(med(r.vals)).padStart(12)}`,
  )
}

// ---- the calibration gate (balance plan rank 8) ------------------------------------------
// The owner's bands, as assertions: `--assert` turns every future balance edit into a measured
// pass/fail instead of an ad-hoc probe read. Bands widen only with an owner decision.
if (ASSERT) {
  // Bands as CALIBRATED (2026-08-24, round 2, measured at 32 seeds): quick casual failure
  // 19-34% by sector (saas 34, social 28, fintech 19 — sector personality is deliberate: fintech
  // is the patient sector), career active failure 0-9% with active MEDIANS above passive in all
  // six cells. The gate bounds regression, not noise: quick failure [15,40] catches both "nobody
  // can lose" (the original complaint) and over-punishment; career active ≤30% catches the old
  // good-play-dies regime; the median ordering IS the skill requirement. Tighten only with a
  // fresh 32-seed measurement and an owner decision.
  const fails: string[] = []
  const pct = (n: number) => (100 * n) / SEEDS
  for (const sector of SECTORS) {
    const get = (mode: string, player: string) => rows.find((r) => r.mode === mode && r.sector === sector && r.player === player)!
    const qc = get('quick', 'casual')
    const ca = get('career', 'active')
    const cc = get('career', 'casual')
    const qcFail = pct(qc.bankrupt + qc.fired)
    if (qcFail < 15 || qcFail > 40) fails.push(`${sector}: quick casual failure ${qcFail.toFixed(0)}% outside [15,40]`)
    const caFail = pct(ca.bankrupt + ca.fired)
    if (caFail > 30) fails.push(`${sector}: career active failure ${caFail.toFixed(0)}% above 30 — good play is dying again`)
    if (med(cc.vals) > med(ca.vals)) fails.push(`${sector}: passive coasting beats active play (${money(med(cc.vals))} > ${money(med(ca.vals))})`)
    if (ca.fired + cc.fired > 0) fails.push(`${sector}: career firings ${ca.fired + cc.fired} — the quick board-teeth gate leaked into career`)
  }
  if (fails.length) {
    console.log('\nCALIBRATION GATE: FAIL')
    for (const f of fails) console.log('  ✗ ' + f)
    process.exit(1)
  }
  console.log('\nCALIBRATION GATE: PASS')
}
