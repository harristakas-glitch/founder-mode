// Deep balance sweep — QUICK PLAY and the cross-cutting levers. Not part of `npm test`.
//
// Run: npx tsx test/deep-balance-probe.ts <section...> [sector...]
//   quick     coast vs balanced vs the calibrated policy — does playing pay?
//   alloc     the research share, swept 0→100%. THE finding in this file.
//   founder   technical vs business
//   choices   does which inbox option you pick change the run?
//   debt      the credit line and the flat-15% covenant default
//   econ      break-even users vs reachable users, per sector (arithmetic, no runs)
//   all       everything
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// Career's traditional path was measured exhaustively in Slice −1 (docs/balance-baseline.md) and
// the token path in test/token-balance-probe.ts. Neither touched Quick Play, and
// docs/gameplay-review.md closes by saying so: "Quick Play / Arena-only systems (M&A, IPO pricing,
// debt covenants, PvP attacks and shields) were read but not bot-tested."
//
// Quick Play is a whole MODE — the one a new player meets first — and no bot had ever played it.
//
// ---------------------------------------------------------------------------------------------
// CALIBRATING THE REFERENCE POLICY, AND WHY THE FIRST ONE WAS WRONG
//
// Recorded because it is a trap anyone re-running this will fall into. The Career harnesses set
// `marketingSpend = lastRevenue × 0.5`. Ported to Quick Play that policy measures nothing:
//
//   acquired = acqBase × (hype/10)^1.25 × … , and hype is bought with `adSpend`
//
// so a revenue-denominated budget cannot bootstrap from week 1, when revenue is 0. It is a
// cold-start trap in the harness, not in the game. Calibrated across eight budget rules, `cash ×
// 2%` is the best survivable one and is used throughout. Hiring prefers MARKETERS, because
// `marketerPoints` is what holds hype up against its 8%/wk decay.
//
// The three standing harness rules from the other files still apply: `gameOver` is not failure
// (it covers `acquired`/`unicorn`/`ipo`), score off `gameOver.payout`, and clamp the budget to
// `marketingMax` so the numbers describe a game a player could actually play.

import {
  acceptTermSheet,
  acquireRival,
  acquisitionPrice,
  advanceWeek,
  availableVentureSectors,
  canAcquire,
  canSellSecondary,
  canStartVenture,
  debtCapacity,
  drawDebt,
  marketingMax,
  newGame,
  pitchInvestors,
  pitchOptions,
  pitchTeam,
  repayDebt,
  resolveChoiceOnState,
  runwayWeeks,
  sellSecondary,
  startVenture,
  takeVacation,
} from '../src/game/engine'
import { sectorById, STAGES } from '../src/game/data'
import { founderStanding } from '../src/game/token/scoring'
import type { Allocation, FounderKind, GameState, SectorId } from '../src/game/types'


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

const failed = (s: GameState) => s.gameOver?.type === 'bankrupt' || s.gameOver?.type === 'fired'
const exited = (s: GameState) => !!s.gameOver && !failed(s)
const founderNet = (s: GameState) => s.gameOver?.payout ?? founderStanding(s)

const SEEDS = Array.from({ length: 16 }, (_, i) => 11 * (i + 1))
const ALL: SectorId[] = ['saas', 'devtools', 'ecommerce', 'fintech', 'social', 'aiml']
const LABEL: Record<SectorId, string> = {
  saas: 'B2B SaaS', devtools: 'Dev Tools', ecommerce: 'E-commerce', fintech: 'Fintech', social: 'Social App', aiml: 'AI/ML Infra',
}
const WEEKS = 90

function report(name: string, out: GameState[]): void {
  const net = out.map(founderNet)
  console.log(
    `  ${pad(name, 26)} failed ${padL(String(out.filter(failed).length), 2)}/${out.length}` +
      ` · exits ${out.filter(exited).length}` +
      ` · net ${padL(money(q(net, 0.5)), 8)} [${padL(money(q(net, 0.1)), 7)}…${padL(money(q(net, 0.9)), 8)}]` +
      ` · pmf ${padL(String(Math.round(q(out.map((s) => s.pmf), 0.5))), 3)}` +
      ` · users ${padL(Math.round(q(out.map((s) => s.users), 0.5)).toLocaleString(), 7)}` +
      // Dilution is the ONLY price institutional capital charges, so a sweep that varies how much
      // is raised has to show what it cost. `stage` is the ladder the round actually bought.
      ` · eq ${padL(`${Math.round(q(out.map((s) => s.founderEquity), 0.5) * 100)}%`, 4)}` +
      ` · ${pad(q(out.map((s) => STAGES.indexOf(s.stage)), 0.5) >= 0 ? STAGES[q(out.map((s) => STAGES.indexOf(s.stage)), 0.5)] : '?', 9)}`,
  )
}

// ---------------------------------------------------------------------------------------------
// the calibrated Quick Play policy
// ---------------------------------------------------------------------------------------------

/** Balanced: what the game's own default allocation looks like. */
const BALANCED: Allocation = { features: 40, quality: 30, bugs: 20, research: 10, bet: 0 }
/**
 * The calibrated policy's split — see `alloc`, where the sweep that produced it lives.
 *
 * HISTORY: this was research-80 when the file was written, because research was the dominant
 * slider (finding 2) and 80% was the measured optimum. After P2 landed — research saturates on
 * `researchSignal`, quality earns fit as a stock, decay proportional — the sweep's optimum moved
 * to 10–30% research in four sectors (E-commerce prefers 0: a high-churn transactional market
 * rewards shipping over discovery, which is sector character, not dominance). 20% is the single
 * split closest to first everywhere.
 */
const CALIBRATED: Allocation = { features: 36, quality: 27, bugs: 17, research: 20, bet: 0 }

interface Policy {
  alloc?: Allocation
  kind?: FounderKind
  /** false = coast: no marketing, no hiring, no raising. */
  play?: boolean
  /** Index answered on every inbox choice. `alt` answers 1 (or the last, when binary). */
  choice?: 'first' | 'alt'
  debt?: 'none' | 'repay' | 'hold' | 'spend'
  /**
   * The marketing budget RULE, which is the single largest lever a Quick Play player touches.
   * `pct2` (2% of cash) is the calibrated default every other section runs on; `cap` is what the
   * Growth slider's maximum actually does, and `docs/gameplay-review.md` finding 4 called it
   * "fatal in one click" — measured with a harness that could not raise a round.
   */
  budget?: 'pct1' | 'pct2' | 'pct5' | 'rev' | 'cap'
  /** Never raise / raise when thin (default) / raise on every cooldown that clears the bar. */
  raise?: 'never' | 'thin' | 'always'
  /** The second product line. `start` takes every bet the gate allows and lets it launch. */
  venture?: 'never' | 'start'
  /** Buying rivals: which currency, when the gate opens. */
  ma?: 'never' | 'cash' | 'stock'
  /** The all-hands, every time the cooldown is up. `odds` picks the highest shown probability. */
  pitch?: 'never' | 'vision' | 'numbers' | 'war' | 'odds'
  /** Founder secondary sales, taken the first week each stage allows one. */
  secondary?: 'never' | 'always'
  /** Recharge weeks, taken whenever the cooldown allows. */
  vacation?: 'never' | 'always'
}

function play(seed: number, sector: SectorId, p: Policy = {}): GameState {
  const active = p.play !== false
  let s = newGame('Probe', sector, p.kind ?? 'technical', {
    config: { mode: 'quick', format: 'standard', sector, seed },
    aiRivals: true,
  })
  for (let w = 0; w < WEEKS && !s.gameOver; w++) {
    for (const m of s.inbox) {
      if (m.kind !== 'choice' || m.resolved || !m.choices) continue
      resolveChoiceOnState(s, m.id, p.choice === 'alt' ? Math.min(1, m.choices.length - 1) : 0)
    }
    if (active) {
      // HARNESS RULE (d): `pitchInvestors` returns the sheets, the caller stores them. See the note
      // in test/career-bots.ts — without this assignment no bot ever raised a round.
      const wantsRound = p.raise === 'always' ? true : p.raise === 'never' ? false : runwayWeeks(s) < 20
      if (s.raiseCooldown === 0 && wantsRound) s.termSheets = pitchInvestors(s).sheets
      if (s.termSheets.length && p.raise !== 'never') acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
      const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
      if (s.cash / Math.max(1, s.lastExpenses || 5000) > 25 && staff < Math.min(8, 1 + Math.floor(s.lastRevenue / 2500)) && s.candidates.length) {
        // ENGINEERS first. This was marketers-first when the file was written — hype^1.25 was the
        // whole of acquisition and PMF was research's to move — but P2 made the quality stock feed
        // PMF and the craft terms feed churn, and engineers build both. Re-measured: engineer-first
        // beats marketer-first for BOTH founder kinds in all five sectors, up to 6x in Social
        // ($30.3M vs $4.9M). Kept in sync with what the sweep actually rewards, because a stale
        // bot policy is how finding 4 got overstated in the first place.
        const pick = (s.candidates.filter((c) => c.role === 'engineer').sort((a, b) => b.skill - a.skill)[0] ??
          [...s.candidates].sort((a, b) => b.skill - a.skill)[0])
        s.candidates = s.candidates.filter((x) => x.id !== pick.id)
        s.offersOut.push(pick)
      }
    }
    if (p.debt && p.debt !== 'none') {
      const room = debtCapacity(s) - (s.debt?.principal ?? 0)
      if (room > 0) drawDebt(s, room)
      if (p.debt === 'repay' && s.debt && s.cash > (s.lastExpenses || 3000) * 30) {
        repayDebt(s, Math.min(s.debt.principal, s.cash - (s.lastExpenses || 3000) * 30))
      }
    }
    if (active) {
      // --- the levers no harness had ever pulled -------------------------------------------
      if (p.venture === 'start' && canStartVenture(s).ok) {
        const open = availableVentureSectors(s)
        if (open.length) {
          startVenture(s, open[0])
          s.allocation = { ...(p.alloc ?? CALIBRATED), bet: 25 }
        }
      }
      if (p.ma && p.ma !== 'never') {
        // The cheapest rival the gate will let us have, so the arm is "buy when you can" rather
        // than "buy the biggest thing you can", which is a different (and much rarer) policy.
        const target = s.rivals
          .filter((r) => r.alive && !r.acquired && canAcquire(s, r).ok)
          .sort((a, b) => acquisitionPrice(s, a) - acquisitionPrice(s, b))[0]
        if (target && (p.ma === 'stock' || s.cash > acquisitionPrice(s, target) * 1.5)) acquireRival(s, target.id, p.ma)
      }
      if (p.pitch && p.pitch !== 'never' && s.pitchCooldown === 0 && s.employees.length > 0) {
        const opts = pitchOptions(s)
        const pick = p.pitch === 'odds' ? [...opts].sort((a, b) => b.p - a.p)[0].id : p.pitch
        pitchTeam(s, pick)
      }
      if (p.secondary === 'always' && canSellSecondary(s).ok) sellSecondary(s)
      if (p.vacation === 'always' && s.vacationCooldown === 0) takeVacation(s)
    }
    s.allocation = s.allocation.bet > 0 ? s.allocation : (p.alloc ?? CALIBRATED)
    // `spend` converts the credit line into marketing the week it lands, so the bank has no cash
    // to seize and the shortfall — whatever its size — is charged at the flat 15%.
    const rule =
      p.debt === 'spend' && s.debt
        ? Math.max(s.cash * 0.02, s.cash * 0.5)
        : p.budget === 'pct1'
          ? s.cash * 0.01
          : p.budget === 'pct5'
            ? s.cash * 0.05
            : p.budget === 'rev'
              ? s.lastRevenue
              : p.budget === 'cap'
                ? Infinity // the top of the Growth slider — `marketingMax` is the only bound left
                : s.cash * 0.02
    const want = !active ? 0 : rule
    s.marketingSpend = Math.max(0, Math.min(want, marketingMax(s), s.cash))
    s = advanceWeek(s)
  }
  return s
}

const sweep = (sector: SectorId, p: Policy) => SEEDS.map((seed) => play(seed, sector, p))

// ---------------------------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------------------------

const SECTIONS: Record<string, (sectors: SectorId[]) => void> = {
  quick(sectors) {
    console.log('\n=== QUICK PLAY — does playing beat coasting? ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      report('Coast (nothing)', sweep(sector, { play: false, alloc: BALANCED }))
      report("Balanced alloc (game's own)", sweep(sector, { alloc: BALANCED }))
      report('Calibrated (research 20)', sweep(sector, {}))
    }
  },

  // The finding. `pmfGain` credits research at `engPoints × ar × 0.35` and features at
  // `engPoints × af × 0.32 × (1 − features/130) × 0.25` — 4.4x less at features=0, decaying to
  // nothing as features fill. And PMF is read by FOUR multiplicative terms (pmfAcq, wordOfMouth,
  // churnMult, revenue conversion) where productScore is read by one.
  alloc(sectors) {
    console.log('\n=== PRODUCT ALLOCATION — the research share, swept ===')
    console.log('    (the other 100−r split features/quality/bugs at 4:3:2)')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      for (const r of [0, 10, 20, 30, 40, 50, 60, 80, 100]) {
        const rest = 100 - r
        const f = Math.round(rest * 0.444)
        const qy = Math.round(rest * 0.333)
        report(`research ${r}%`, sweep(sector, { alloc: { features: f, quality: qy, bugs: rest - f - qy, research: r, bet: 0 } }))
      }
    }
  },

  // Read in exactly three places: engPoints (5 vs 1.5), marketerPoints (4 vs 1) and a flat 8%
  // sales boost. engPoints feeds the PMF engine; marketerPoints feeds hype only.
  founder(sectors) {
    console.log('\n=== FOUNDER KIND ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      report('Technical', sweep(sector, { kind: 'technical' }))
      report('Business', sweep(sector, { kind: 'business' }))
    }
  },

  // Every harness ever written answers option 0 and nobody checked the others.
  choices(sectors) {
    console.log('\n=== INBOX CHOICES ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      report('Always first option', sweep(sector, { choice: 'first' }))
      report('Always second option', sweep(sector, { choice: 'alt' }))
    }
  },

  // The marketing budget RULE, and the capital that funds it. Every earlier sweep in this file
  // held the budget at 2% of cash and could not raise a round (harness rule (d)), so the two
  // levers a Quick Play player actually touches most were both pinned.
  budget(sectors) {
    console.log('\n=== MARKETING BUDGET RULE × CAPITAL ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      for (const raise of ['never', 'thin', 'always'] as const) {
        for (const budget of ['pct1', 'pct2', 'pct5', 'rev', 'cap'] as const) {
          report(`raise ${raise} · ${budget}`, sweep(sector, { raise, budget }))
        }
      }
    }
  },

  // Every mechanic a player can click that no harness had ever clicked. One arm per lever, the
  // reference policy underneath, so a row differs from `baseline` in exactly one decision.
  levers(sectors) {
    console.log('\n=== THE UNSWEPT LEVERS ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      report('baseline', sweep(sector, {}))
      report('venture: start one', sweep(sector, { venture: 'start' }))
      report('M&A: cash', sweep(sector, { ma: 'cash' }))
      report('M&A: stock', sweep(sector, { ma: 'stock' }))
      report('all-hands: vision', sweep(sector, { pitch: 'vision' }))
      report('all-hands: numbers', sweep(sector, { pitch: 'numbers' }))
      report('all-hands: war', sweep(sector, { pitch: 'war' }))
      report('all-hands: best odds', sweep(sector, { pitch: 'odds' }))
      report('secondary: always', sweep(sector, { secondary: 'always' }))
      report('vacation: on cooldown', sweep(sector, { vacation: 'always' }))
    }
  },

  // gameplay-review.md flagged this by inspection and never ran it. `covenantCheck` does
  // `s.founderEquity *= 0.85` — a FLAT 15% that never reads `shortfall`, so defaulting on $10M and
  // on $250k cost the same.
  debt(sectors) {
    console.log('\n=== DEBT & THE COVENANT ===')
    for (const sector of sectors) {
      console.log(`\n${LABEL[sector]}`)
      for (const d of ['none', 'repay', 'hold', 'spend'] as const) report(`debt: ${d}`, sweep(sector, { debt: d }))
    }
  },

  // Arithmetic, not simulation: what scale does the revenue model need, and what scale does the
  // mode actually reach? `reached` is the research-80% median from `alloc`. The finding this
  // section produced — Quick Play billing at a rate written for tens of thousands of users while
  // reaching 1,000–4,400 — is FIXED: `arpuWeekly` and `careerArpu` collapsed into one
  // `arpuPerCustomer`, so this now reports the post-fix margin.
  econ() {
    console.log('\n=== UNIT ECONOMICS — break-even scale vs reachable scale ===')
    // aiml measured the same way as the rest: the calibrated policy's median users at 90wk from
    // the `quick` section, run at the sector's shipped constants.
    const reached: Record<SectorId, number> = { saas: 1112, devtools: 2284, ecommerce: 3678, fintech: 1368, social: 12414, aiml: 1947 }
    console.log('  sector       arpu/customer   users for $6k/wk   reached@90wk    verdict')
    for (const id of ALL) {
      const sec = sectorById(id)
      // conversion at pmf 70 is 0.25 + 0.75 × 0.7 = 0.775, and infra is charged per user.
      const perUser = sec.arpuPerCustomer * 0.775 - (sec.infraCost ?? 0)
      const need = perUser > 0 ? 6000 / perUser : Infinity
      const ratio = need / reached[id]
      console.log(
        `  ${pad(LABEL[id], 13)}${padL(String(sec.arpuPerCustomer), 13)}` +
          `${padL(Number.isFinite(need) ? Math.round(need).toLocaleString() : 'never', 19)}` +
          `${padL(reached[id].toLocaleString(), 15)}    ${ratio <= 1 ? 'viable' : `${ratio.toFixed(1)}x short`}`,
      )
    }
  },
}

const args = process.argv.slice(2)
const sectors = ALL.filter((x) => args.includes(x))
const chosen = args.filter((a) => a in SECTIONS)
const run = chosen.length ? chosen : args.includes('all') ? Object.keys(SECTIONS) : ['quick']
console.log(`Deep balance sweep · ${SEEDS.length} seeds × ${WEEKS} weeks · sections: ${run.join(', ')}`)
for (const name of run) SECTIONS[name](sectors.length ? sectors : ALL)
