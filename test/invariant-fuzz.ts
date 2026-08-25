// Property-based balance fuzzing — the backstop for the exploit nobody has imagined yet.
//
// Every exploit found on 2026-08-25 violated an invariant nobody had written down: collected
// revenue per customer bounded by willingness-to-pay, valuation bounded by an envelope of the
// fundamentals, equity summing to a whole. This runner drives seeded RANDOM-POLICY runs (every
// action a legal store-path move with random-but-bounded parameters) and asserts the invariants
// every single week. Bespoke exploit hunts find what an attacker thinks to try; this catches
// the class.
//
//   npx tsx test/invariant-fuzz.ts            smoke (8 runs) — part of npm test
//   npx tsx test/invariant-fuzz.ts --full     nightly (64 runs)

import { advanceWeek, newGame, valuation, marketingMax, pitchInvestors, acceptTermSheet, resolveChoiceOnState, canAcquire, acquireRival, counterTermSheet } from '../src/game/engine'
import { applyJournaled } from '../src/game/replay'
import { sectorById } from '../src/game/data'
import { effectiveWtp } from '../src/game/sim2/economics'
import type { GameConfig } from '../src/game/modes'
import type { GameState, SectorId } from '../src/game/types'

const FULL = process.argv.includes('--full')
const RUNS = FULL ? 64 : 8
const WEEKS = 120
const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce', 'aiml']

// deterministic policy RNG (mulberry32) — the fuzz is reproducible per run index
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fails: string[] = []
function check(cond: boolean, runTag: string, week: number, msg: string): void {
  if (!cond && fails.length < 40) fails.push(`[${runTag} wk${week}] ${msg}`)
}

/** valuation envelope: generous enough that honest play NEVER trips it, tight enough that any
 *  unbounded loop (revenue floors, growth pegging, M&A re-rating) fails long before a unicorn */
function valuationEnvelope(s: GameState): number {
  const annualRev = s.lastRevenue * 52
  const sector = sectorById(s.sector)
  return Math.max(3_000_000, annualRev * 45 + s.users * sector.perUserVal * 4 + 8_000_000)
}

function invariants(s: GameState, tag: string): void {
  const w = s.week
  check(Number.isFinite(s.cash), tag, w, `cash is ${s.cash}`)
  check(Number.isFinite(s.users) && s.users >= 0, tag, w, `users is ${s.users}`)
  check(s.founderEquity >= 0 && s.founderEquity <= 1.0000001, tag, w, `founderEquity ${s.founderEquity}`)
  check(Number.isFinite(s.lastRevenue) && s.lastRevenue >= 0, tag, w, `lastRevenue ${s.lastRevenue}`)
  const val = valuation(s)
  check(Number.isFinite(val) && val >= 0, tag, w, `valuation ${val}`)
  check(val <= valuationEnvelope(s), tag, w, `valuation $${(val / 1e6).toFixed(1)}M exceeds the fundamentals envelope $${(valuationEnvelope(s) / 1e6).toFixed(1)}M (rev/wk $${Math.round(s.lastRevenue / 1000)}k, users ${s.users})`)
  const v2 = s.simV2
  if (v2) {
    const customers = v2.cohorts.reduce((a, c) => a + c.size, 0)
    if (customers > 50) {
      // nobody's weekly bill exceeds ~4x the richest segment's ceiling WTP (audit: the gouge
      // was collecting 30x a mass segment's WTP through the flat floor)
      const wtpCeil = Math.max(...v2.segments.map((seg) => effectiveWtp(seg, 1, 100)))
      const perCustomer = v2.finance.revenue / customers
      check(perCustomer <= wtpCeil * 4, tag, w, `revenue/customer $${perCustomer.toFixed(1)}/wk exceeds 4x best WTP $${wtpCeil.toFixed(1)}`)
    }
    check(v2.pricing.price >= 0.05 && Number.isFinite(v2.pricing.price), tag, w, `V2 price ${v2.pricing.price}`)
  }
}

for (let run = 0; run < RUNS; run++) {
  const r = rng(9000 + run * 37)
  const sector = SECTORS[run % SECTORS.length]
  const v2 = run % 2 === 0
  const cfg = { mode: v2 ? 'career' : 'quick', format: 'standard', sector, seed: 500 + run * 61, ...(v2 ? { engine: 'v2' } : {}) } as GameConfig
  const tag = `${v2 ? 'v2' : 'v1'}/${sector}/${run}`
  let s = newGame('Fuzz', sector, r() < 0.5 ? 'technical' : 'business', { config: cfg })
  for (let w = 0; w < WEEKS && !s.gameOver; w++) {
    // a random handful of legal moves per week, parameters bounded the way the UI bounds them
    for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, Math.floor(r() * m.choices.length))
    if (r() < 0.6) s.marketingSpend = Math.round(r() * marketingMax(s))
    if (r() < 0.25) s.allocation = { ...s.allocation, features: 10 + Math.round(r() * 50), quality: 10 + Math.round(r() * 40), bugs: Math.round(r() * 30), research: Math.round(r() * 15) }
    if (r() < 0.3 && s.raiseCooldown === 0 && s.termSheets.length === 0) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length && r() < 0.7) {
      const sheet = s.termSheets[Math.floor(r() * s.termSheets.length)]
      if (r() < 0.3) counterTermSheet(s, sheet.id)
      const still = s.termSheets[Math.floor(r() * Math.max(1, s.termSheets.length))]
      if (still) acceptTermSheet(s, still.id)
    }
    if (r() < 0.2) s = applyJournaled(s, 'take_debt', { v: Math.round(r() * 5_000_000) }).state
    if (v2 && r() < 0.25) s = applyJournaled(s, 'v2_price', { v: r() * 1000 }).state
    if (v2 && r() < 0.15 && s.simV2) s = applyJournaled(s, 'v2_position', { seg: s.simV2.segments[Math.floor(r() * s.simV2.segments.length)].id }).state
    if (r() < 0.15) {
      const t = s.rivals.filter((x) => x.alive && !x.acquired)[0]
      if (t && canAcquire(s, t).ok) acquireRival(s, t.id, r() < 0.5 ? 'cash' : 'stock')
    }
    if (r() < 0.2 && s.candidates.length) {
      const c = s.candidates[Math.floor(r() * s.candidates.length)]
      if (s.cash > 150_000) {
        s.candidates = s.candidates.filter((x) => x.id !== c.id)
        s.offersOut.push(c)
      }
    }
    if (s.gameOver) break
    s = advanceWeek(s)
    invariants(s, tag)
  }
}

console.log(`Invariant fuzz — ${RUNS} random-policy runs × up to ${WEEKS}wk (${FULL ? 'full' : 'smoke'})`)
console.log(fails.length === 0 ? 'ALL PASS' : `FAILURES (${fails.length}):\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
