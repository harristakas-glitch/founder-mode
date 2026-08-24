// The Capital section's truth layer (src/game/finance.ts): the P&L must CLOSE to the engine's
// own weekly ledger, the trend rule must be the locked semantic one, and the cap table must be
// the recorded rounds — never a re-derivation that can drift from what actually happened.

import { advanceWeek, newGame, acceptTermSheet } from '../src/game/engine'
import { capTable, dilutionOutlook, pnlRows, trendTone, unitCards } from '../src/game/finance'
import type { GameConfig } from '../src/game/modes'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`)
  if (!cond) fails.push(msg)
}
const cfg = (over: Partial<GameConfig> = {}): GameConfig =>
  ({ mode: 'career', format: 'standard', sector: 'saas', seed: 11, ...over }) as GameConfig

console.log('— The P&L closes to the ledger —')
{
  let s = newGame('F', 'saas', 'technical', { config: cfg() })
  s.marketingSpend = 3000
  for (let i = 0; i < 10; i++) s = advanceWeek(s)
  const rows = pnlRows(s)
  const h = s.history[s.history.length - 1]
  const net = rows.find((r) => r.id === 'net')!
  ok(Math.abs(net.thisWeek - (h.revenue - h.expenses)) < 0.01, 'Net Income row === revenue − expenses, exactly')
  // every money row between revenue and net sums to net (margin is a context line, not money)
  const sum = rows.filter((r) => !r.sub && !['gross', 'operating', 'net'].includes(r.id)).reduce((a, r) => a + r.thisWeek, 0)
  ok(Math.abs(sum - net.thisWeek) < 1, `the money rows sum to net (${sum.toFixed(0)} vs ${net.thisWeek.toFixed(0)}) — nothing smeared, nothing lost`)
  const gross = rows.find((r) => r.id === 'gross')!
  ok(Math.abs(gross.thisWeek - (h.revenue - h.infra)) < 0.01, 'Gross Profit === revenue − infrastructure')
  ok(rows.every((r) => r.series.length >= 2), 'every row carries its trend series')
  const rev = rows.find((r) => r.id === 'revenue')!
  ok(rev.drivers.length >= 2, 'revenue explains itself — drivers present')
}

console.log('— The locked trend rule: green favourable, red unfavourable, yellow near-flat —')
{
  ok(trendTone(0.1, true) === 'good' && trendTone(0.1, false) === 'bad', 'up is green only when up is GOOD (burn up is red)')
  ok(trendTone(-0.1, true) === 'bad' && trendTone(-0.1, false) === 'good', 'down mirrors it (CAC down is green)')
  ok(trendTone(0.02, true) === 'flat' && trendTone(-0.02, false) === 'flat', '±3% is the neutral yellow zone')
}

console.log('— The cap table is the record, diluted forward —')
{
  let s = newGame('F', 'saas', 'technical', { config: cfg({ seed: 21 }) })
  for (let i = 0; i < 3; i++) s = advanceWeek(s)
  s.termSheets = [{ id: 'x1', investor: 'Meridian Capital', amount: 1_000_000, equity: 0.2, weeksLeft: 3 }]
  acceptTermSheet(s, 'x1')
  s.termSheets = [{ id: 'x2', investor: 'Northgate Partners', amount: 4_000_000, equity: 0.25, weeksLeft: 3 }]
  acceptTermSheet(s, 'x2')
  ok((s.rounds?.length ?? 0) === 2, 'both rounds entered the register')
  ok(Math.abs(s.rounds![1].founderAfter - 0.8 * 0.75) < 1e-9, 'the register records what the founder held AFTER each round')
  const holders = capTable(s)
  const total = holders.reduce((a, h) => a + h.equity, 0)
  ok(Math.abs(total - 1) < 0.01, `the table sums to 100% (${(total * 100).toFixed(1)}%)`)
  ok(Math.abs(holders[0].equity - s.founderEquity) < 1e-9, 'the founder row IS founderEquity')
  const meridian = holders.find((h) => h.name === 'Meridian Capital')!
  ok(Math.abs(meridian.equity - 0.2 * 0.75) < 1e-9, 'an early round is diluted forward by every later one')
  const out = dilutionOutlook(s)
  ok(out.nextStage === 'Series B' && out.founderAfter < s.founderEquity, 'the outlook projects the next round honestly')
}

console.log('— finHistory: career only, capped, deterministic —')
{
  let c = newGame('F', 'saas', 'technical', { config: cfg({ seed: 31 }) })
  for (let i = 0; i < 6; i++) c = advanceWeek(c)
  ok((c.finHistory?.length ?? 0) === 6, 'career keeps the weekly CAC/LTV reads')
  ok(unitCards(c).length >= 6, 'the unit cards render from live reads')
  let q = newGame('F', 'saas', 'technical', { config: { mode: 'quick', format: 'standard', sector: 'saas', seed: 31 } as GameConfig })
  for (let i = 0; i < 4; i++) q = advanceWeek(q)
  ok(q.finHistory === undefined, 'quick never writes the buffer — the classic screen needs nothing')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
