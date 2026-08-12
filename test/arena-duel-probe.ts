// Arena attack balance — the headless duel harness that did not exist. Not part of `npm test`.
//
// Run: npx tsx test/arena-duel-probe.ts [attacks|mirror|shield|all]
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// Every balance document so far ends the same way: "Arena attack balance is still unmeasured and
// needs a headless duel harness that does not exist." The auction was cleared
// (test/arena-auction-probe.ts), the price war got its cooldown (test/pricewar-probe.ts found bots
// at war 86% of all weeks), but the five attacks have never been swept against each other, and
// nobody has ever measured whether attacking is worth the money at all.
//
// ---------------------------------------------------------------------------------------------
// WHAT A DUEL IS
//
// Two Arena-mode companies, same sector, DIFFERENT seeds (two players never share a world), ticked
// in lockstep for 40 weeks — an Arena match's length, not a Career's 90. Each side plays the same
// calibrated base policy from test/deep-balance-probe.ts; what differs is the ATTACK POLICY. An
// attack pays `applyAttackOutgoing` on the attacker and `applyAttackIncoming` on the victim in the
// same week, which is exactly the message order the real store performs — minus the network.
//
// The seed pairing is (11n, 11n + 7); results are reported over 20 pairs. Both assignments are
// played (A gets the policy, then B gets it) so a seed advantage cannot masquerade as an attack
// advantage.
//
// WINNER: higher `valuation()` at the final week — what the Arena scoreboard ranks by. A bankrupt
// company loses outright; two bankrupts tie.
//
// ---------------------------------------------------------------------------------------------
// THE QUESTIONS, STATED BEFORE THE RUNS
//
//   1. Is any single attack DOMINANT — highest win rate and positive net value?
//   2. Is any attack a self-own — worse than doing nothing even against a passive victim?
//   3. Is all-out aggression positive-sum for the aggressor, and what does the victim lose?
//   4. Does the shield actually defend — does turtling beat taking the hits?
//   5. Is the mirror (both aggress) negative-sum against mutual peace — i.e. is Arena's attack
//      layer a prisoner's dilemma (fine, that is drama) or a dominant strategy tax (not fine)?

import {
  acceptTermSheet,
  advanceWeek,
  applyAttackIncoming,
  applyAttackOutgoing,
  ATTACKS,
  attackCost,
  buyShield,
  canAttack,
  canBuyShield,
  marketingMax,
  newGame,
  pitchInvestors,
  resolveChoiceOnState,
  runwayWeeks,
  shieldCost,
  valuation,
  type AttackDef,
} from '../src/game/engine'
import type { Allocation, GameState, SectorId } from '../src/game/types'

const q = (a: number[], p: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const padL = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)

const PAIRS = Array.from({ length: 40 }, (_, i) => [11 * (i + 1), 11 * (i + 1) + 7] as const)
const WEEKS = 40
const SECTOR: SectorId = (process.argv.find((a) => ['saas', 'devtools', 'ecommerce', 'fintech', 'social'].includes(a)) as SectorId) ?? 'saas'
const CALIBRATED: Allocation = { features: 36, quality: 27, bugs: 17, research: 20, bet: 0 }

// ---------------------------------------------------------------------------------------------
// one company's week — the deep-balance-probe base policy, Arena mode
// ---------------------------------------------------------------------------------------------

function arenaGame(seed: number, name: string): GameState {
  return newGame(name, SECTOR, 'technical', { config: { mode: 'arena', format: 'standard', sector: SECTOR, seed }, aiRivals: false })
}

function playWeek(s: GameState): void {
  for (const m of s.inbox) {
    if (m.kind !== 'choice' || m.resolved || !m.choices) continue
    resolveChoiceOnState(s, m.id, 0)
  }
  if (s.raiseCooldown === 0 && runwayWeeks(s) < 20) pitchInvestors(s)
  if (s.termSheets.length) acceptTermSheet(s, [...s.termSheets].sort((a, b) => b.amount - a.amount)[0].id)
  const staff = s.employees.length + s.pendingHires.length + s.offersOut.length
  if (s.cash / Math.max(1, s.lastExpenses || 5000) > 25 && staff < Math.min(8, 1 + Math.floor(s.lastRevenue / 2500)) && s.candidates.length) {
    const pick =
      s.candidates.filter((c) => c.role === 'engineer').sort((a, b) => b.skill - a.skill)[0] ??
      [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
    s.candidates = s.candidates.filter((x) => x.id !== pick.id)
    s.offersOut.push(pick)
  }
  s.allocation = CALIBRATED
  s.marketingSpend = Math.max(0, Math.min(s.cash * 0.02, marketingMax(s), s.cash))
}

// ---------------------------------------------------------------------------------------------
// attack policies
// ---------------------------------------------------------------------------------------------

type AttackKind = AttackDef['id']

interface DuelPolicy {
  name: string
  /** Which attack to launch this week, or null. `me` has already played its economic week. */
  attack?: (me: GameState, rival: GameState) => AttackKind | null
  /** Buy the crisis retainer whenever it is down and affordable. */
  turtle?: boolean
}

/** Launch `kind` every time the cooldown allows and a war chest remains. The war-chest floor
 *  matters: an attacker that spends itself to death measures bankruptcy, not the attack. */
const always = (kind: AttackKind) => (me: GameState, _rival: GameState): AttackKind | null => {
  const cost = attackCost(me, kind)
  if (!canAttack(me, kind).ok || me.cash < cost + (me.lastExpenses || 4000) * 12) return null
  return kind
}

const PASSIVE: DuelPolicy = { name: 'Passive' }

const POLICIES: DuelPolicy[] = [
  { name: 'Poach on cooldown', attack: always('poach') },
  { name: 'Smear on cooldown', attack: always('smear') },
  { name: 'Raid on cooldown', attack: always('raid') },
  { name: 'Hit piece on cooldown', attack: always('hitpiece') },
  { name: 'Price war on cooldown', attack: always('pricewar') },
  {
    name: 'Any (cheapest ready)',
    attack: (me, rival) => {
      const ready = ATTACKS.filter((a) => canAttack(me, a.id).ok && me.cash >= attackCost(me, a.id) + (me.lastExpenses || 4000) * 12)
      if (!ready.length) return null
      return [...ready].sort((a, b) => attackCost(me, a.id) - attackCost(me, b.id))[0].id
    },
  },
]

const TURTLE: DuelPolicy = { name: 'Turtle (shield up)', turtle: true }

// ---------------------------------------------------------------------------------------------
// SITUATIONAL policies — the real balance bar. Blind on-cooldown spam SHOULD be a mild tax; the
// question that decides whether the layer is healthy is whether reading the board beats not
// playing it. Each of these uses information both real clients have (presence shares user counts;
// your own inbox knows when you were hit).
// ---------------------------------------------------------------------------------------------

const SITUATIONAL: DuelPolicy[] = [
  {
    // Raid pays leverage x when punching UP — so only punch up. This is the catch-up mechanic
    // used as one, instead of on a timer.
    name: 'Raid when behind 1.3x',
    attack: (me, rival) => {
      if (rival.users < me.users * 1.3) return null
      return always('raid')(me, rival)
    },
  },
  {
    // Kick them while they are close: spend on smears only when the match is actually contested,
    // where a hype swing flips the ranking rather than decorating a blowout.
    name: 'Smear when contested',
    attack: (me, rival) => {
      const gap = Math.abs(valuation(me) - valuation(rival)) / Math.max(1, valuation(me))
      if (gap > 0.35) return null
      return always('smear')(me, rival)
    },
  },
  {
    // War chest first: attack only from a position of cash strength, so the compounding the
    // attack budget forfeits is the surplus, not the engine.
    name: 'Any, only when flush',
    attack: (me, rival) => {
      if (me.cash < (me.lastExpenses || 4000) * 45) return null
      const ready = ATTACKS.filter((a) => canAttack(me, a.id).ok && me.cash >= attackCost(me, a.id) + (me.lastExpenses || 4000) * 12)
      if (!ready.length) return null
      return [...ready].sort((a, b) => attackCost(me, a.id) - attackCost(me, b.id))[0].id
    },
  },
]

/** Shield only while actually under fire: an attack landed in the last three weeks. */
const REACTIVE_SHIELD: DuelPolicy = {
  name: 'Reactive shield',
  turtle: false,
  attack: () => null,
}
export function underFire(s: GameState): boolean {
  return s.inbox.some((m) => m.week >= s.week - 3 && typeof m.title === 'string' && m.title.includes('hit you'))
}

// ---------------------------------------------------------------------------------------------
// the duel
// ---------------------------------------------------------------------------------------------

interface DuelResult {
  a: GameState
  b: GameState
  /** +1 A wins, -1 B wins, 0 tie. */
  winner: number
  attacksByA: number
  attacksByB: number
}

function duel(seedA: number, seedB: number, polA: DuelPolicy, polB: DuelPolicy): DuelResult {
  let a = arenaGame(seedA, 'Alpha')
  let b = arenaGame(seedB, 'Beta')
  let attacksByA = 0
  let attacksByB = 0
  for (let w = 0; w < WEEKS && !a.gameOver && !b.gameOver; w++) {
    playWeek(a)
    playWeek(b)
    const wantsShield = (pol: DuelPolicy, me: GameState) => pol.turtle || (pol.name === 'Reactive shield' && underFire(me))
    if (wantsShield(polA, a) && canBuyShield(a).ok && a.cash > shieldCost(a) + (a.lastExpenses || 4000) * 12) buyShield(a)
    if (wantsShield(polB, b) && canBuyShield(b).ok && b.cash > shieldCost(b) + (b.lastExpenses || 4000) * 12) buyShield(b)
    // A's attack lands on B the same week, then B's on A — the store's message order, and the
    // ordering is symmetric because both sides already played their economic week above.
    const kindA = polA.attack?.(a, b) ?? null
    if (kindA && applyAttackOutgoing(a, kindA, b.companyName, b.users)) {
      applyAttackIncoming(b, kindA, a.companyName)
      attacksByA++
    }
    const kindB = polB.attack?.(b, a) ?? null
    if (kindB && applyAttackOutgoing(b, kindB, a.companyName, a.users)) {
      applyAttackIncoming(a, kindB, b.companyName)
      attacksByB++
    }
    a = advanceWeek(a)
    b = advanceWeek(b)
  }
  const dead = (s: GameState) => s.gameOver?.type === 'bankrupt' || s.gameOver?.type === 'fired'
  const score = (s: GameState) => (dead(s) ? -1 : valuation(s))
  const sa = score(a)
  const sb = score(b)
  return { a, b, winner: sa > sb ? 1 : sb > sa ? -1 : 0, attacksByA, attacksByB }
}

/** Both seat assignments, so a seed edge cannot read as a policy edge. Returns the POLICY side's
 *  stats regardless of which seat it sat in. */
function contest(polX: DuelPolicy, polY: DuelPolicy) {
  const xWins: number[] = []
  const xVal: number[] = []
  const yVal: number[] = []
  let xAttacks = 0
  let xDead = 0
  let yDead = 0
  for (const [s1, s2] of PAIRS) {
    for (const flip of [false, true]) {
      const r = flip ? duel(s1, s2, polY, polX) : duel(s1, s2, polX, polY)
      const x = flip ? r.b : r.a
      const y = flip ? r.a : r.b
      xWins.push((flip ? -r.winner : r.winner) > 0 ? 1 : 0)
      xVal.push(valuation(x))
      yVal.push(valuation(y))
      xAttacks += flip ? r.attacksByB : r.attacksByA
      if (x.gameOver?.type === 'bankrupt') xDead++
      if (y.gameOver?.type === 'bankrupt') yDead++
    }
  }
  const n = PAIRS.length * 2
  return {
    winRate: xWins.reduce((a2, v) => a2 + v, 0) / n,
    xVal: q(xVal, 0.5),
    yVal: q(yVal, 0.5),
    attacksPerMatch: xAttacks / n,
    xDead,
    yDead,
    n,
  }
}

// ---------------------------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------------------------

const SECTIONS: Record<string, () => void> = {
  // Each attack, on cooldown, against a passive rival — is it worth the money at all?
  attacks() {
    console.log(`\n=== EACH ATTACK vs PASSIVE · ${PAIRS.length * 2} duels each · ${WEEKS} weeks · ${SECTOR} ===`)
    const base = contest(PASSIVE, PASSIVE)
    console.log(
      `  ${pad('Passive (control)', 24)} win ${padL(`${Math.round(base.winRate * 100)}%`, 4)}` +
        ` · own val ${padL(money(base.xVal), 8)} · victim val ${padL(money(base.yVal), 8)} · dead ${base.xDead}/${base.n}`,
    )
    for (const pol of POLICIES) {
      const r = contest(pol, PASSIVE)
      console.log(
        `  ${pad(pol.name, 24)} win ${padL(`${Math.round(r.winRate * 100)}%`, 4)}` +
          ` · own val ${padL(money(r.xVal), 8)} · victim val ${padL(money(r.yVal), 8)}` +
          ` · ${r.attacksPerMatch.toFixed(1)} attacks/match · dead ${r.xDead}/${r.n}`,
      )
    }
    console.log('  (a win rate above 50% that costs the attacker own-valuation is a trade; below 50% is a self-own)')
  },

  // Both sides aggress: prisoner's dilemma or dominant-strategy tax?
  mirror() {
    console.log(`\n=== MIRRORS — both sides play the same policy ===`)
    const peace = contest(PASSIVE, PASSIVE)
    console.log(`  ${pad('Peace (both passive)', 24)} own val ${padL(money(peace.xVal), 8)} · dead ${peace.xDead + peace.yDead}/${peace.n * 2}`)
    for (const pol of [...POLICIES.slice(-1), POLICIES[4], POLICIES[2]]) {
      const r = contest(pol, pol)
      console.log(
        `  ${pad(`War (both ${pol.name})`, 24)} own val ${padL(money(r.xVal), 8)}` +
          ` · dead ${r.xDead + r.yDead}/${r.n * 2} · ${(r.attacksPerMatch * 2).toFixed(1)} attacks/match total`,
      )
    }
  },

  // Does the retainer earn its price against an all-out attacker?
  shield() {
    console.log(`\n=== THE SHIELD — turtle vs aggression ===`)
    const aggro = POLICIES[POLICIES.length - 1]
    const bare = contest(PASSIVE, aggro)
    const turtled = contest(TURTLE, aggro)
    console.log(
      `  ${pad('Bare vs Any-attack', 24)} win ${padL(`${Math.round(bare.winRate * 100)}%`, 4)} · own val ${padL(money(bare.xVal), 8)} · dead ${bare.xDead}/${bare.n}`,
    )
    console.log(
      `  ${pad('Turtle vs Any-attack', 24)} win ${padL(`${Math.round(turtled.winRate * 100)}%`, 4)} · own val ${padL(money(turtled.xVal), 8)} · dead ${turtled.xDead}/${turtled.n}`,
    )
    console.log('  (the shield earns its price if turtling wins materially more often than standing bare)')
  },
}

SECTIONS.situational = () => {
  console.log(`\n=== SITUATIONAL PLAY — reading the board vs not playing the layer ===`)
  for (const pol of SITUATIONAL) {
    const r = contest(pol, PASSIVE)
    console.log(
      `  ${pad(pol.name + ' vs Passive', 34)} win ${padL(`${Math.round(r.winRate * 100)}%`, 4)}` +
        ` · own val ${padL(money(r.xVal), 8)} · victim val ${padL(money(r.yVal), 8)} · ${r.attacksPerMatch.toFixed(1)} attacks/match`,
    )
  }
  const aggro = POLICIES[POLICIES.length - 1]
  const r = contest(REACTIVE_SHIELD, aggro)
  console.log(
    `  ${pad('Reactive shield vs Any-attack', 34)} win ${padL(`${Math.round(r.winRate * 100)}%`, 4)}` +
      ` · own val ${padL(money(r.xVal), 8)} (bare was 50% · turtle-always 43%)`,
  )
}

const args = process.argv.slice(2)
const run = args.filter((a) => a in SECTIONS)
const chosen = run.length ? run : args.includes('all') ? Object.keys(SECTIONS) : ['attacks']
console.log(`Arena duel probe · ${PAIRS.length} seed pairs × both seats · ${WEEKS} weeks`)
for (const name of chosen) SECTIONS[name]()
