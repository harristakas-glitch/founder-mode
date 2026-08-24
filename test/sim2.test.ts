// Business Simulation V2 — the contract's testing gates (docs/business-sim-v2-implementation.md
// §8). Phase 1 scope: determinism, isolation from V1, choice-model laws, reconciliation,
// truth isolation, the seeded-RNG ban, and the first playable loop actually playing.

import { readFileSync, readdirSync } from 'node:fs'
import { advanceWeek, newGame } from '../src/game/engine'
import { choiceShares, effectiveWtp, offerUtility, priceFit, productFit } from '../src/game/sim2/economics'
import { marketTemplate } from '../src/game/sim2/config/markets'
import type { GameConfig } from '../src/game/modes'
import type { GameState } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`)
  if (!cond) fails.push(msg)
}

const v2cfg = (seed: number, sector = 'saas'): GameConfig =>
  ({ mode: 'career', format: 'standard', sector, seed, engine: 'v2' }) as GameConfig

const playWeeks = (s: GameState, n: number): GameState => {
  let g = s
  for (let i = 0; i < n; i++) g = advanceWeek(g)
  return g
}

console.log('— The gate: V2 exists only where it was asked for —')
{
  const q = newGame('Q', 'saas', 'technical', { config: { mode: 'quick', format: 'standard', sector: 'saas', seed: 5 } as GameConfig })
  const c1 = newGame('C', 'saas', 'technical', { config: { mode: 'career', format: 'standard', sector: 'saas', seed: 5 } as GameConfig })
  ok(q.simV2 === undefined && playWeeks(q, 3).simV2 === undefined, 'quick never allocates V2 state')
  ok(c1.simV2 === undefined && playWeeks(c1, 3).simV2 === undefined, 'a classic Simulation run never allocates V2 state')
  const v2 = newGame('V', 'saas', 'technical', { config: v2cfg(5) })
  ok(v2.simV2 !== undefined && v2.simV2.version === 2, 'engine:"v2" allocates the V2 root state at creation')
}

console.log('— Determinism: same seed + same decisions = identical state —')
{
  const a = playWeeks(newGame('D', 'saas', 'technical', { config: v2cfg(77) }), 20)
  const b = playWeeks(newGame('D', 'saas', 'technical', { config: v2cfg(77) }), 20)
  ok(JSON.stringify(a.simV2) === JSON.stringify(b.simV2), 'twenty V2 weeks replay byte-identically')
  ok(a.users === b.users && a.cash === b.cash && a.pmf === b.pmf, 'the shared numbers agree too')
  const c = playWeeks(newGame('D', 'saas', 'technical', { config: v2cfg(78) }), 20)
  ok(JSON.stringify(c.simV2) !== JSON.stringify(a.simV2), 'a different seed deals a different market')
}

console.log('— Choice-model laws (spec §44) —')
{
  const tpl = marketTemplate('saas')
  const seg = newGame('L', 'saas', 'technical', { config: v2cfg(9) }).simV2!.segments[1]
  // shares + outside sum to 1
  const offers = [
    { id: 'p', fit: 0.6, priceFitV: 0.5, brand: 30, installedShare: 0.1 },
    { id: 'r1', fit: 0.5, priceFitV: 0.6, brand: 40, installedShare: 0 },
  ]
  const sh = choiceShares(seg, offers, tpl.choiceTemperature)
  const sum = Object.values(sh).reduce((a, b) => a + b, 0)
  ok(Math.abs(sum - 1) < 1e-9 && sh.outside > 0, `shares + outside option sum to 1 (${sum.toFixed(9)}), outside is never zero`)
  // monotonicity: better fit never lowers utility
  const u1 = offerUtility(seg, { id: 'p', fit: 0.4, priceFitV: 0.5, brand: 30, installedShare: 0 })
  const u2 = offerUtility(seg, { id: 'p', fit: 0.7, priceFitV: 0.5, brand: 30, installedShare: 0 })
  ok(u2 > u1, 'better product fit never reduces utility')
  // price far above WTP is punished, smoothly
  const wtp = 20
  ok(priceFit(60, wtp, 0.6) < priceFit(22, wtp, 0.6) && priceFit(22, wtp, 0.6) < priceFit(8, wtp, 0.6), 'price above WTP always converts worse')
  ok(priceFit(8, wtp, 0.6) - priceFit(14, wtp, 0.6) < priceFit(22, wtp, 0.6) - priceFit(40, wtp, 0.6) + 1, 'cheap has diminishing upside (smooth, no cliffs)')
  // brand never reduces demand-side utility
  const u3 = offerUtility(seg, { id: 'p', fit: 0.5, priceFitV: 0.5, brand: 70, installedShare: 0 })
  ok(u3 >= u1, 'better brand never reduces utility')
  // brand cannot rescue terrible fit (bounded pricing power)
  ok(effectiveWtp(seg, 0.1, 100) < effectiveWtp(seg, 0.9, 0), 'brand at 100 with terrible fit is worth less than great fit with no brand')
  // thresholds bite: an enterprise-style segment punishes a product below its security floor
  const ent = newGame('L', 'saas', 'technical', { config: v2cfg(9) }).simV2!.segments[3]
  const below = productFit({ core: 85, reliability: 90, security: 30, integrations: 70, service: 70, ease: 70 }, ent.attributePreferences)
  const above = productFit({ core: 85, reliability: 90, security: 65, integrations: 70, service: 70, ease: 70 }, ent.attributePreferences)
  ok(above - below > 0.2, `a hard threshold is a wall, not a slope (${below.toFixed(2)} vs ${above.toFixed(2)})`)
}

console.log('— The first playable loop (spec phase 1) —')
{
  let g = newGame('P', 'saas', 'technical', { config: v2cfg(41) })
  g.marketingSpend = 4000
  g = playWeeks(g, 30)
  const v2 = g.simV2!
  ok(g.users > 0, `the causal chain acquires customers (${g.users})`)
  ok(g.lastRevenue > 0, `and they pay (${Math.round(g.lastRevenue)}/wk)`)
  ok(v2.weeklyHistory.length === 30, 'a snapshot per week, no gaps')
  const custSum = v2.cohorts.reduce((a, c) => a + c.size, 0)
  ok(Math.abs(custSum - g.users) < 1, 'customers === the sum of living cohorts (one truth)')
  const last = v2.weeklyHistory[v2.weeklyHistory.length - 1]
  const hist = g.history[g.history.length - 1]
  ok(Math.abs(last.netIncome - (hist.revenue - hist.expenses)) < 1, 'the snapshot closes to the same ledger the P&L reads')
  ok(v2.weeklyHistory.some((s) => s.eventIds.length > 0), 'weeks emit ranked, visible events')
  // playing quality should show up as fit rising somewhere
  const fitEarly = Object.values(v2.weeklyHistory[4].productFit).reduce((a, b) => a + b, 0)
  const fitLate = Object.values(last.productFit).reduce((a, b) => a + b, 0)
  ok(fitLate > fitEarly, 'building the product moves segment fit — the chain, not a stat bonus')
}

console.log('— Truth isolation + seeded-RNG ban —')
{
  const screens = readdirSync('src/screens').filter((f) => f.endsWith('.tsx'))
  let leaks = 0
  for (const f of screens) {
    const src = readFileSync(`src/screens/${f}`, 'utf8')
    if (/\.truth\b/.test(src) || /knowledge\.\w+\.truth/.test(src)) leaks++
  }
  ok(leaks === 0, 'no screen reads a .truth field — the player sees estimates only')
  const sim2files = readdirSync('src/game/sim2', { recursive: true }) as string[]
  let mathRandom = 0
  for (const f of sim2files) {
    if (!String(f).endsWith('.ts')) continue
    if (/Math\.random/.test(readFileSync(`src/game/sim2/${f}`, 'utf8'))) mathRandom++
  }
  ok(mathRandom === 0, 'Math.random is banned inside the V2 engine')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
