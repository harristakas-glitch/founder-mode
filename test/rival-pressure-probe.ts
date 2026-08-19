// Rival pressure — do AI rivals make a scenario harder, or only longer? Not part of `npm test`.
//
// Run: npx tsx test/rival-pressure-probe.ts <section...> [sector...]
//
//   scenarios   win rate / exit week / founder net per scenario, aggression OFF vs ON.
//               THE measurement: BACKLOG.md §4.1 says Late Entrant wins 97% against Standard's
//               90% and is merely longer (median week 165). This section is what says whether
//               that is still true.
//   counter     does the counterplay pay? shield-when-threatened and raid-back, against the
//               same seeds as the bare policy.
//   posture     what the rivals actually DO: attacks per run by kind, by scenario, and the
//               weeks they land — the sanity check that a policy is situational and not a timer.
//   all         everything
//
// ---------------------------------------------------------------------------------------------
// THE STANDING HARNESS RULES (docs/balance-baseline.md §0, and every probe since)
//
//  * **`gameOver` is not failure.** It covers `acquired`, `unicorn`, `ipo` and `timeup` as well as
//    `bankrupt` and `fired`. "Win rate" here is `1 − failed/runs`, where `failed` is bankrupt or
//    fired and nothing else — the definition §4.1's 97%/90% was quoted under.
//  * **Score off `gameOver.payout`.** For an acquisition that number carries the 1.1–2.0x premium;
//    re-deriving `valuation × equity` throws away exactly the runs that did best.
//  * **Clamp the budget to `marketingMax`.** A bot that assigns `s.marketingSpend` directly is
//    describing a game nobody can play.
//
// WHY 200 WEEKS. Free play has no clock (BACKLOG §2.1), so a run only ends when it fails or exits.
// §4.1 reports a median exit at week 165, so a 90-week harness would score most Late Entrant runs
// as "still going" and measure nothing. 200 weeks is long enough for the median run to resolve.
//
// WHY BOTH SIDES OF THE SWITCH IN ONE BINARY. `rivalAggression` is a capability, so the same build
// plays both worlds and a difference between the two rows cannot be a build difference. Every
// number below is an A/B on that one flag with the seed, sector, scenario and policy held fixed.

import {
  acceptTermSheet,
  advanceWeek,
  attackCost,
  attackRival,
  buyShield,
  canAttack,
  canBuyShield,
  hostileRivals,
  marketingMax,
  newGame,
  pitchInvestors,
  resolveChoiceOnState,
  runwayWeeks,
  shieldCost,
} from '../src/game/engine'
import { founderStanding } from '../src/game/token/scoring'
import type { GameState, SectorId } from '../src/game/types'

type Allocation = GameState['allocation']

// ---------------------------------------------------------------------------------------------
// reporting
// ---------------------------------------------------------------------------------------------

const q = (a: number[], p: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const pct = (n: number) => `${(n * 100).toFixed(0)}%`

const failed = (s: GameState) => s.gameOver?.type === 'bankrupt' || s.gameOver?.type === 'fired'
const exited = (s: GameState) => !!s.gameOver && !failed(s)
const founderNet = (s: GameState) => s.gameOver?.payout ?? founderStanding(s)

const SEEDS = Array.from({ length: 24 }, (_, i) => 11 * (i + 1))
const WEEKS = 200
const ALL: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social', 'aiml']
const LABEL: Record<SectorId, string> = {
  saas: 'B2B SaaS', devtools: 'Dev Tools', ecommerce: 'E-commerce', fintech: 'Fintech', social: 'Social App', aiml: 'AI/ML Infra',
}
const SCENARIOS = ['standard', 'late', 'winter', 'richkid', 'secondtime'] as const
type Scenario = (typeof SCENARIOS)[number]

/** The calibrated Quick Play allocation from test/deep-balance-probe.ts. Not re-derived here. */
const CALIBRATED: Allocation = { features: 36, quality: 27, bugs: 17, research: 20, bet: 0 }
/** The game's own default split — what a player who never touches the sliders is running. */
const DEFAULT_ALLOC: Allocation = { features: 40, quality: 30, bugs: 20, research: 10, bet: 0 }

// ---------------------------------------------------------------------------------------------
// the policy
// ---------------------------------------------------------------------------------------------

interface Policy {
  /**
   * "Ordinary play" instead of the calibrated reference: the game's default sliders, a fatter
   * marketing budget, and hiring on runway rather than on revenue. This is BACKLOG §2.1's
   * "sloppy-but-funded" founder, and it is the population §4.1's 97%/90% was measured over — the
   * calibrated policy never goes bankrupt in any scenario, so a win RATE measured on it is
   * saturated at 100% and cannot show a difficulty difference at all. Score still can, and both
   * are reported; this row is what makes the win-rate column live.
   */
  ordinary?: boolean
  /** buy the crisis retainer when the rival table shows someone hostile */
  shield?: boolean
  /** raid back at the biggest hostile rival when the ops team is free and cash allows */
  counter?: boolean
}

interface Run {
  state: GameState
  /** attacks that landed on the player, by kind */
  hits: Record<string, number>
  /** the week each attack landed */
  hitWeeks: number[]
  /** attacks the crisis retainer ate */
  deflected: number
  shieldsBought: number
  countersLaunched: number
}

function play(seed: number, sector: SectorId, scenario: Scenario, aggression: boolean, p: Policy = {}): Run {
  const config = {
    mode: 'quick' as const,
    format: (scenario === 'standard' ? 'standard' : 'scenario') as 'standard' | 'scenario',
    sector,
    scenario: scenario === 'standard' ? undefined : scenario,
    seed,
    overrides: { rivalAggression: aggression },
  }
  let s = newGame('Probe', sector, 'technical', {
    config,
    scenario: config.scenario,
    aiRivals: true,
  })
  const run: Run = { state: s, hits: {}, hitWeeks: [], deflected: 0, shieldsBought: 0, countersLaunched: 0 }
  const counted = new Set<string>()

  for (let w = 0; w < WEEKS && !s.gameOver; w++) {
    for (const m of s.inbox) {
      if (m.kind !== 'choice' || m.resolved || !m.choices) continue
      resolveChoiceOnState(s, m.id, 0)
    }
    // HARNESS RULE (d): `pitchInvestors` returns the sheets, the caller stores them. See the note
    // in test/career-bots.ts — without this assignment no bot ever raised a round.
    if (s.raiseCooldown === 0 && runwayWeeks(s) < 20) s.termSheets = pitchInvestors(s).sheets
    if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
    const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
    const runwayBar = p.ordinary ? 12 : 25
    const headBar = p.ordinary ? 8 : Math.min(8, 1 + Math.floor(s.lastRevenue / 2500))
    if (s.cash / Math.max(1, s.lastExpenses || 5000) > runwayBar && staff < headBar && s.candidates.length) {
      const pick =
        s.candidates.filter((c) => c.role === 'engineer').sort((a, b) => b.skill - a.skill)[0] ??
        [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((x) => x.id !== pick.id)
      s.offersOut.push(pick)
    }

    // --- counterplay, played off the SAME public signal the player is shown ---
    // `hostileRivals` is what the rival table renders. The bot gets no private information: it
    // reacts to the posture the screen displays, which is the only way this measures whether the
    // counterplay a PLAYER can run is worth its price.
    if (p.shield || p.counter) {
      const threats = hostileRivals(s)
      if (p.shield && threats.length > 0 && canBuyShield(s).ok && s.cash > shieldCost(s) * 4) {
        if (buyShield(s)) run.shieldsBought++
      }
      if (p.counter && threats.length > 0 && canAttack(s, 'raid').ok) {
        const target = [...threats].sort((a, b) => b.users - a.users)[0]
        if (s.cash > attackCost(s, 'raid') * 6 && attackRival(s, 'raid', target.id)) run.countersLaunched++
      }
    }

    s.allocation = p.ordinary ? DEFAULT_ALLOC : CALIBRATED
    s.marketingSpend = Math.max(0, Math.min(s.cash * (p.ordinary ? 0.05 : 0.02), marketingMax(s), s.cash))
    s = advanceWeek(s)

    // The inbox is the only place an attack is announced, which is the point: what the harness can
    // see is exactly what a player can see. Counted by message id rather than by list length,
    // because the inbox is capped and old messages fall off the end.
    for (const m of s.inbox) {
      if (m.kind !== 'news' || typeof m.meta?.rivalAttack !== 'string' || counted.has(m.id)) continue
      counted.add(m.id)
      if (m.meta.deflected) {
        run.deflected++
        continue
      }
      run.hits[m.meta.rivalAttack] = (run.hits[m.meta.rivalAttack] ?? 0) + 1
      run.hitWeeks.push(m.week)
    }
  }
  run.state = s
  return run
}

// ---------------------------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------------------------

function row(name: string, runs: Run[]): void {
  const out = runs.map((r) => r.state)
  const net = out.map(founderNet)
  const exits = out.filter(exited)
  const nFailed = out.filter(failed).length
  const attacks = runs.reduce((a, r) => a + r.hitWeeks.length, 0)
  const stopped = runs.reduce((a, r) => a + r.deflected, 0)
  console.log(
    `  ${pad(name, 24)} win ${padL(pct(1 - nFailed / out.length), 4)}` +
      ` · failed ${padL(String(nFailed), 2)}/${out.length}` +
      ` · exits ${padL(String(exits.length), 2)}` +
      ` · exit wk ${padL(String(Math.round(q(exits.map((s) => s.gameOver!.week), 0.5))), 3)}` +
      ` · net ${padL(money(q(net, 0.5)), 8)}` +
      ` · users ${padL(Math.round(q(out.map((s) => s.users), 0.5)).toLocaleString(), 8)}` +
      ` · atk ${padL((attacks / runs.length).toFixed(1), 4)}` +
      (stopped ? ` · blocked ${padL((stopped / runs.length).toFixed(1), 4)}` : ''),
  )
}

const SECTIONS: Record<string, (sectors: SectorId[]) => void> = {
  scenarios(sectors) {
    console.log('\n=== SCENARIO DIFFICULTY — calibrated policy, aggression OFF vs ON ===')
    console.log('  win = 1 − (bankrupt+fired)/runs. atk = attacks landed on the player per run.')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      for (const sc of SCENARIOS) {
        row(`${sc} · off`, SEEDS.map((seed) => play(seed, sector, sc, false)))
        row(`${sc} · ON`, SEEDS.map((seed) => play(seed, sector, sc, true)))
      }
    }
  },

  ordinary(sectors) {
    console.log('\n=== SCENARIO DIFFICULTY — ORDINARY play, where the win rate is not saturated ===')
    console.log('  Default sliders, 5% of cash on ads, hiring on runway. §4.1 quoted 97% Late vs 90% Standard.')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      for (const sc of SCENARIOS) {
        row(`${sc} · off`, SEEDS.map((seed) => play(seed, sector, sc, false, { ordinary: true })))
        row(`${sc} · ON`, SEEDS.map((seed) => play(seed, sector, sc, true, { ordinary: true })))
      }
    }
  },

  counter(sectors) {
    console.log('\n=== COUNTERPLAY — is answering the pressure worth the money? ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      for (const sc of ['standard', 'late'] as Scenario[]) {
        row(`${sc} · bare`, SEEDS.map((seed) => play(seed, sector, sc, true)))
        row(`${sc} · shield`, SEEDS.map((seed) => play(seed, sector, sc, true, { shield: true })))
        row(`${sc} · shield+raid`, SEEDS.map((seed) => play(seed, sector, sc, true, { shield: true, counter: true })))
      }
    }
  },

  posture(sectors) {
    console.log('\n=== WHAT THE RIVALS DO — kind mix and timing ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      for (const sc of SCENARIOS) {
        const runs = SEEDS.map((seed) => play(seed, sector, sc, true))
        const kinds: Record<string, number> = {}
        for (const r of runs) for (const [k, n] of Object.entries(r.hits)) kinds[k] = (kinds[k] ?? 0) + n
        const weeks = runs.flatMap((r) => r.hitWeeks)
        const mix = Object.entries(kinds)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k} ${n}`)
          .join(' · ')
        console.log(
          `  ${pad(sc, 14)} total ${padL(String(weeks.length), 4)}` +
            ` · first wk ${padL(String(Math.round(q(runs.map((r) => r.hitWeeks[0] ?? 999), 0.5))), 3)}` +
            ` · median wk ${padL(String(Math.round(q(weeks, 0.5))), 3)}` +
            ` · ${mix || '—'}`,
        )
      }
    }
  },
}

// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2)
const sectors = (args.filter((a) => ALL.includes(a as SectorId)) as SectorId[])
const chosen = args.filter((a) => a in SECTIONS || a === 'all')
const run = chosen.includes('all') || chosen.length === 0 ? Object.keys(SECTIONS) : chosen
const targetSectors = sectors.length ? sectors : args.includes('allsectors') ? ALL : (['saas', 'fintech'] as SectorId[])
for (const name of run) SECTIONS[name](targetSectors)
console.log()
