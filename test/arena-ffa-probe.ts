// Arena 4-player free-for-all — the multiplayer half of BACKLOG 4.4. Not part of `npm test`.
//
// Run: npx tsx test/arena-ffa-probe.ts [control|aggressor|gang|weakest|mixed|shield|all] [sector]
//
// ---------------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS
//
// `test/arena-duel-probe.ts` measured the attack layer in a 1v1 and retuned it: smear is a real
// trade (57% played situationally), raid is breakeven, spam is a mild tax, mirror wars are a
// prisoner's dilemma — and the shield is price-neutral but never EARNS its price against rational
// aggression. All of that is duel arithmetic. A real Arena lobby is four companies, and a duel
// cannot answer the questions that actually decide whether a lobby is healthy:
//
//   1. KINGMAKING — when everyone gangs up on the leader, who profits: the gang, or the bystander
//      who kept their powder dry while three rivals burned money on each other?
//   2. Is the bystander who never fights the real winner — is "don't play the layer" dominant
//      the moment there are more than two seats?
//   3. Does the shield earn its price in a lobby where attacks are AMBIENT (you get hit because
//      you are currently the leader / currently the weakest) rather than targeted by one rival
//      who has singled you out?
//   4. Does kicking the weakest pay, or does it just crown whichever bystander wasn't kicked?
//
// ---------------------------------------------------------------------------------------------
// WHAT A MATCH IS
//
// Four Arena-mode companies, same sector, DIFFERENT seeds (four players never share a world),
// ticked in lockstep for 40 weeks — an Arena match's length. Each seat plays the same calibrated
// base policy from test/deep-balance-probe.ts; what differs is the ATTACK POLICY. Attacks cross
// in seat order within the week: seat 0's attack lands on its victim before seat 1 picks, which
// is exactly the store's message order — minus the network.
//
// WHAT A POLICY SEES. Presence shares user counts, so a policy reads its rivals' `users` and
// nothing else — no rival cash, no rival valuation, no rival shield status. (The duel probe's
// "smear when contested" read rival valuation; that was a 1v1 shortcut this harness does not
// repeat.) Your own inbox knows when you were hit, so reactive shielding reads that.
//
// SEAT ROTATION. Seeds are fixed to seats; the policy lineup is rotated through the four seats
// (4 cyclic rotations per quartet), so every policy plays every seed of the quartet exactly once
// and a seed advantage cannot read as a policy advantage. 20 quartets × 4 rotations = 80 matches
// per lobby row; win-rate baseline in a 4-seat lobby is 25%.
//
// WINNER: highest `valuation()` at week 40 — what the Arena scoreboard ranks by. A bankrupt
// company loses outright (it cannot win, whatever the survivors do); a dead company stops
// ticking, stops attacking, and stops being a target — it is out of the match.
//
// ---------------------------------------------------------------------------------------------
// FINDINGS (recorded 2026-08-12 · 20 quartets × 4 rotations × 40 weeks, saas; shield rows re-run
// at 50 quartets because ±5pp of noise cannot call a ±5pp question)
//
// docs/balance-deep-dive.md carries the full tables. Headlines, all at par 25%:
//   * Control: 4x passive = 25% each, median $8.9M, 0 dead — the harness is fair.
//   * One aggressor + 3 bystanders: smear-at-leader 21%, any-at-leader 20%, raid-at-leader 25%.
//     In a duel these were 55%/50%-class trades; with bystanders, 2/3 of the damage you buy is
//     a gift to people you did not hit. The duel's best attack policies are lobby self-owns.
//   * GANG THE LEADER (all four): everyone 25% by symmetry, but median val $5.0M against peace's
//     $8.9M — the negative-sum war, now 4-handed. With THREE ganging and one abstaining, the gang
//     wins 22% and the BYSTANDER 35% ($6.2M vs $5.8M): ganging up on the leader crowns the seat
//     that kept its powder dry. Kingmaking is real and it pays the kingmaker's audience.
//   * KICK THE WEAKEST (3 kickers + bystander): kickers 20%, bystander 39% — the strongest
//     bystander edge measured. Bullying downward is the worst spend in the lobby.
//   * Mixed lobby (smearer + raider + 2 passive): passives 29%, smearer 23%, raider 20%.
//   * So YES, the bystander who never fights is the best seat in every aggressive lobby — but
//     never by enough to be a strategy tax on the layer (35-39% at its best, not 60%), and the
//     aggression that buys it is a choice the attackers made. Peace remains the group optimum;
//     that is the prisoner's dilemma the duel already found, at four hands.
//   * THE SHIELD (the reason SHIELD_BASE_COST moved $35k → $25k, see engine.ts): at $35k it
//     earned nothing anywhere — 1v1 46% vs bare's 49%, ambient lobby 32-37% vs bare's 30-33%,
//     inside the noise at 200 matches. At $25k: ambient turtle 36-37% vs bare 30-33% with ~$1.1M
//     more median valuation, 1v1 turtle 55% vs bare 49%, while a PEACETIME turtle still burns
//     13% (par 25%, $7.5M vs the passives' $8.8M). Bought hot, skipped quiet: a real decision.

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

// Four seeds per quartet, disjoint from each other; 20 quartets by default. Offsets are arbitrary
// distinct small numbers — the duel probe's (11n, 11n+7) pattern extended to four seats.
// `quartets=N` on the command line widens the sample when a margin sits inside the noise: at the
// default 20 quartets a fourth-seat policy plays 80 matches, so one standard error on its win
// rate is ~5pp — too coarse to call a ±10pp shield question. 50 quartets brings it to ~3pp.
const N_QUARTETS = Number(process.argv.find((a) => a.startsWith('quartets='))?.slice('quartets='.length) ?? 20)
const QUARTETS = Array.from({ length: N_QUARTETS }, (_, i) => {
  const n = 11 * (i + 1)
  return [n, n + 3, n + 5, n + 7] as const
})
const WEEKS = 40
const SECTOR: SectorId = (process.argv.find((a) => ['saas', 'devtools', 'ecommerce', 'fintech', 'social', 'aiml'].includes(a)) as SectorId) ?? 'saas'
const CALIBRATED: Allocation = { features: 36, quality: 27, bugs: 17, research: 20, bet: 0 }

// ---------------------------------------------------------------------------------------------
// one company's week — the deep-balance-probe base policy, Arena mode (same as the duel probe)
// ---------------------------------------------------------------------------------------------

function arenaGame(seed: number, name: string): GameState {
  return newGame(name, SECTOR, 'technical', { config: { mode: 'arena', format: 'standard', sector: SECTOR, seed }, aiRivals: false })
}

function playWeek(s: GameState): void {
  for (const m of s.inbox) {
    if (m.kind !== 'choice' || m.resolved || !m.choices) continue
    resolveChoiceOnState(s, m.id, 0)
  }
  // HARNESS RULE (d): `pitchInvestors` returns the sheets, the caller stores them. See the note
  // in test/career-bots.ts — without this assignment no bot ever raised a round.
  if (s.raiseCooldown === 0 && runwayWeeks(s) < 20) s.termSheets = pitchInvestors(s).sheets
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
// attack policies — what a seat does with the layer
// ---------------------------------------------------------------------------------------------

type AttackKind = AttackDef['id']

/** What presence actually shares about a rival: a user count. Nothing else. */
interface RivalView {
  seat: number
  users: number
}

interface FfaPolicy {
  name: string
  /** Pick an attack and a victim, or hold. `me` has already played its economic week; `rivals`
   *  are the LIVING rivals only. */
  attack?: (me: GameState, rivals: RivalView[]) => { kind: AttackKind; seat: number } | null
  /** always: keep the retainer up. reactive: only while under fire (hit in the last 3 weeks). */
  shield?: 'always' | 'reactive'
}

/** The duel probe's war-chest floor: an attacker that spends itself to death measures
 *  bankruptcy, not the attack. */
const canAfford = (me: GameState, kind: AttackKind) =>
  canAttack(me, kind).ok && me.cash >= attackCost(me, kind) + (me.lastExpenses || 4000) * 12

const leaderOf = (rivals: RivalView[]) => [...rivals].sort((a, b) => b.users - a.users)[0]
const weakestOf = (rivals: RivalView[]) => [...rivals].sort((a, b) => a.users - b.users)[0]

const PASSIVE: FfaPolicy = { name: 'Passive' }

/** Launch `kind` at the current LEADER whenever the leader is not me. This is "gang up on
 *  whoever is winning" — the lobby dynamic a duel cannot produce. */
const gangLeader = (kind: AttackKind, label?: string): FfaPolicy => ({
  name: label ?? `Gang leader (${kind})`,
  attack: (me, rivals) => {
    if (!rivals.length) return null
    const lead = leaderOf(rivals)
    if (lead.users <= me.users) return null // I am the leader — nobody above me to gang
    if (!canAfford(me, kind)) return null
    return { kind, seat: lead.seat }
  },
})

/** Kick whoever is losing: cheapest scalp, worst optics. */
const kickWeakest = (kind: AttackKind): FfaPolicy => ({
  name: `Kick weakest (${kind})`,
  attack: (me, rivals) => {
    if (!rivals.length) return null
    const weak = weakestOf(rivals)
    if (weak.users >= me.users) return null // everyone is above me — nothing to kick down at
    if (!canAfford(me, kind)) return null
    return { kind, seat: weak.seat }
  },
})

/** The duel probe's blind spammer, pointed at the leader: cheapest ready attack, on cooldown. */
const anyAtLeader: FfaPolicy = {
  name: 'Any at leader',
  attack: (me, rivals) => {
    if (!rivals.length) return null
    const ready = ATTACKS.filter((a) => canAfford(me, a.id))
    if (!ready.length) return null
    const kind = [...ready].sort((a, b) => attackCost(me, a.id) - attackCost(me, b.id))[0].id
    return { kind, seat: leaderOf(rivals).seat }
  },
}

/** Raid punching UP — the situational winner from the duel probe, in lobby form. */
const raidUp: FfaPolicy = {
  name: 'Raid when behind 1.3x',
  attack: (me, rivals) => {
    const above = rivals.filter((r) => r.users >= me.users * 1.3)
    if (!above.length || !canAfford(me, 'raid')) return null
    return { kind: 'raid', seat: leaderOf(above).seat }
  },
}

const TURTLE: FfaPolicy = { name: 'Turtle (shield up)', shield: 'always' }
const REACTIVE: FfaPolicy = { name: 'Reactive shield', shield: 'reactive' }

/** An attack landed on us in the last three weeks — the same read the duel probe used. */
function underFire(s: GameState): boolean {
  return s.inbox.some((m) => m.week >= s.week - 3 && typeof m.title === 'string' && m.title.includes('hit you'))
}

// ---------------------------------------------------------------------------------------------
// the match
// ---------------------------------------------------------------------------------------------

interface SeatResult {
  policy: string
  win: boolean
  dead: boolean
  val: number
  attacks: number
}

const dead = (s: GameState) => s.gameOver?.type === 'bankrupt' || s.gameOver?.type === 'fired'

function match(seeds: readonly number[], lineup: FfaPolicy[]): SeatResult[] {
  let states = seeds.map((seed, i) => arenaGame(seed, `Co${i}`))
  const attacks = [0, 0, 0, 0]
  for (let w = 0; w < WEEKS; w++) {
    const alive = states.map((s) => !s.gameOver)
    if (alive.filter(Boolean).length <= 1) break
    // 1. everyone plays their economic week
    for (let i = 0; i < 4; i++) if (alive[i]) playWeek(states[i])
    // 2. shields go up (a purchase you make before the week's attacks arrive)
    for (let i = 0; i < 4; i++) {
      if (!alive[i]) continue
      const pol = lineup[i]
      const wants = pol.shield === 'always' || (pol.shield === 'reactive' && underFire(states[i]))
      if (wants && canBuyShield(states[i]).ok && states[i].cash > shieldCost(states[i]) + (states[i].lastExpenses || 4000) * 12)
        buyShield(states[i])
    }
    // 3. attacks cross in seat order — the store's message order. Each attacker reads the board
    //    as it stands when its message is sent: user counts are the last-shared presence values
    //    (this week's, since presence beats attacks in the real client too).
    for (let i = 0; i < 4; i++) {
      if (!alive[i]) continue
      const pol = lineup[i]
      if (!pol.attack) continue
      const rivals: RivalView[] = states
        .map((s, j) => ({ seat: j, users: s.users }))
        .filter((r) => r.seat !== i && alive[r.seat])
      const order = pol.attack(states[i], rivals)
      if (!order || !alive[order.seat]) continue
      const victim = states[order.seat]
      if (applyAttackOutgoing(states[i], order.kind, victim.companyName, victim.users)) {
        applyAttackIncoming(victim, order.kind, states[i].companyName)
        attacks[i]++
      }
    }
    // 4. the week resolves for everyone still standing
    for (let i = 0; i < 4; i++) if (alive[i]) states[i] = advanceWeek(states[i])
  }
  const score = (s: GameState) => (dead(s) ? -1 : valuation(s))
  const scores = states.map(score)
  const top = Math.max(...scores)
  return states.map((s, i) => ({
    policy: lineup[i].name,
    win: scores[i] === top && scores[i] > -1,
    dead: dead(s),
    val: valuation(s),
    attacks: attacks[i],
  }))
}

/** Run a lineup across every quartet × every cyclic seat rotation; aggregate per policy NAME.
 *  Distinct policies must carry distinct names or their stats merge (which is what you want for
 *  a lobby of e.g. three identical aggressors). */
function lobby(lineup: FfaPolicy[]) {
  const byPolicy = new Map<string, { wins: number; deaths: number; vals: number[]; attacks: number; seats: number }>()
  for (const quartet of QUARTETS) {
    for (let rot = 0; rot < 4; rot++) {
      const rotated = [0, 1, 2, 3].map((i) => lineup[(i + rot) % 4])
      for (const r of match(quartet, rotated)) {
        const agg = byPolicy.get(r.policy) ?? { wins: 0, deaths: 0, vals: [], attacks: 0, seats: 0 }
        agg.wins += r.win ? 1 : 0
        agg.deaths += r.dead ? 1 : 0
        agg.vals.push(r.val)
        agg.attacks += r.attacks
        agg.seats++
        byPolicy.set(r.policy, agg)
      }
    }
  }
  return byPolicy
}

function printLobby(title: string, lineup: FfaPolicy[]) {
  console.log(`\n  ${title}`)
  const stats = lobby(lineup)
  // Exactly one winner per match, so PER-SEAT par is 25% whatever the lineup: a policy holding
  // three seats gets three chances but each seat's chance is still a quarter.
  for (const [name, s] of stats) {
    console.log(
      `    ${pad(name, 26)} win ${padL(`${Math.round((s.wins / s.seats) * 100)}%`, 4)} (par  25%)` +
        ` · median val ${padL(money(q(s.vals, 0.5)), 8)} · dead ${s.deaths}/${s.seats}` +
        (s.attacks ? ` · ${(s.attacks / s.seats).toFixed(1)} attacks/match` : ''),
    )
  }
}

// ---------------------------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------------------------

const SECTIONS: Record<string, () => void> = {
  // Sanity: four passives. Win rates should sit near 25% and deaths near the sector's base rate.
  control() {
    console.log(`\n=== CONTROL — four passive seats · ${QUARTETS.length * 4} matches · ${WEEKS} weeks · ${SECTOR} ===`)
    printLobby('4x Passive', [PASSIVE, PASSIVE, PASSIVE, PASSIVE])
  },

  // One aggressor, three bystanders: does attacking pay when 2/3 of the field is NOT your victim?
  // In a duel every dollar of damage lands on your only rival; here it subsidises two spectators.
  aggressor() {
    console.log(`\n=== ONE AGGRESSOR vs THREE PASSIVE — attacking with bystanders in the room ===`)
    const pass2 = { ...PASSIVE }
    for (const pol of [gangLeader('smear'), gangLeader('raid'), anyAtLeader, raidUp]) {
      printLobby(`${pol.name} + 3x Passive`, [pol, pass2, pass2, pass2])
    }
  },

  // Everyone gangs the leader. The kingmaking section: with all four playing it, being ahead is
  // taxed; with three playing it and one abstaining, the abstainer is the control group.
  gang() {
    console.log(`\n=== GANG THE LEADER — kingmaking ===`)
    printLobby('4x Gang leader (smear)', [gangLeader('smear'), gangLeader('smear'), gangLeader('smear'), gangLeader('smear')])
    printLobby('4x Any at leader', [anyAtLeader, anyAtLeader, anyAtLeader, anyAtLeader])
    // the bystander test: NAME the abstainer differently so its stats separate
    const bystander: FfaPolicy = { name: 'Bystander (passive)' }
    printLobby('3x Gang leader (smear) + Bystander', [gangLeader('smear'), gangLeader('smear'), gangLeader('smear'), bystander])
    printLobby('3x Any at leader + Bystander', [anyAtLeader, anyAtLeader, anyAtLeader, bystander])
  },

  // Everyone kicks the weakest: does cheap bullying pay, or does it crown the untouched?
  weakest() {
    console.log(`\n=== KICK THE WEAKEST ===`)
    printLobby('4x Kick weakest (raid)', [kickWeakest('raid'), kickWeakest('raid'), kickWeakest('raid'), kickWeakest('raid')])
    const bystander: FfaPolicy = { name: 'Bystander (passive)' }
    printLobby('3x Kick weakest (raid) + Bystander', [kickWeakest('raid'), kickWeakest('raid'), kickWeakest('raid'), bystander])
  },

  // The lobby brief 4.4 names: 1 smearer + 1 raider + 2 passive.
  mixed() {
    console.log(`\n=== MIXED LOBBY — 1 smearer + 1 raider + 2 passive ===`)
    printLobby('Smear + Raid-up + 2x Passive', [gangLeader('smear', 'Smearer (at leader)'), raidUp, PASSIVE, PASSIVE])
  },

  // The shield, where attacks are ambient: three gang-the-leader aggressors, and the fourth seat
  // is (a) bare, (b) always-shielded, (c) reactively shielded. The fourth seat gets hit whenever
  // it is the leader — which a healthy company is, sooner or later.
  shield() {
    console.log(`\n=== THE SHIELD IN A LOBBY — ambient attacks, not a targeted duel ===`)
    const gang = () => gangLeader('smear', 'Gang (smear)')
    printLobby('3x Gang (smear) + Bare passive', [gang(), gang(), gang(), { name: 'Bare passive' }])
    printLobby('3x Gang (smear) + Turtle', [gang(), gang(), gang(), TURTLE])
    printLobby('3x Gang (smear) + Reactive shield', [gang(), gang(), gang(), REACTIVE])
    // and against the noisier ganging policy
    const any = () => ({ ...anyAtLeader, name: 'Gang (any)' })
    printLobby('3x Gang (any) + Bare passive', [any(), any(), any(), { name: 'Bare passive' }])
    printLobby('3x Gang (any) + Turtle', [any(), any(), any(), TURTLE])
    printLobby('3x Gang (any) + Reactive shield', [any(), any(), any(), REACTIVE])
    // The other half of the decision: what an unneeded retainer costs. If always-shielding in a
    // lobby that never attacks is free, "buy it every match" is dominant and the price is fake.
    printLobby('3x Passive + Turtle (peace)', [PASSIVE, PASSIVE, PASSIVE, { name: 'Turtle in peacetime', shield: 'always' }])
  },
}

const args = process.argv.slice(2)
const run = args.filter((a) => a in SECTIONS)
const chosen = run.length ? run : args.includes('all') ? Object.keys(SECTIONS) : ['control', 'gang']
console.log(`Arena FFA probe · ${QUARTETS.length} seed quartets × 4 seat rotations · ${WEEKS} weeks · ${SECTOR}`)
for (const name of chosen) SECTIONS[name]()
