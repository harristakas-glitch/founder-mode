// Tokenisation / ICO — Slice 5, the community as a counterparty. Run: npx tsx test/token-community.test.ts
//
// Covers brief §32–§35 and §38, docs/ico-architecture.md §4 loop E, and the slice's mandate:
// community state must react to founder behaviour MEASURABLY, every reaction must have a restoring
// force, and `founderInfluence` must be a read value with a consequence.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose and this
// file re-run to confirm it goes red. The mutations are listed at the bottom.
//
// The standing lesson applied throughout (from Slices 1–4's survivors): assert on the CALL SITE —
// the tick, the sale, the quote — not on a pure function the tick would have to call correctly to
// reach. Differential tests (two states, one variable apart, ticked identically) are used wherever
// an expected value would otherwise be the formula pasted into the test.

import { advanceWeek, newGame, withSeed } from '../src/game/engine'
import { defaultCapabilities, type GameConfig } from '../src/game/modes'
import { tokenisationBars } from '../src/game/token/eligibility'
import { launchToken } from '../src/game/token/launch'
import { tokenInvariants } from '../src/game/token/market'
import { liquidityDiscount } from '../src/game/token/scoring'
import {
  communityConduct,
  communityReadout,
  founderOverhang,
  resilienceFactor,
} from '../src/game/token/community'
import { setIncentiveShares } from '../src/game/token/incentives'
import { saleInfluenceFactor, sellTreasuryTokens, treasurySaleQuote, maxTreasurySale } from '../src/game/token/treasury'
import { tickToken } from '../src/game/token/tick'
import { TOKEN_COMMUNITY } from '../src/game/token/types'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const cfg = (seed: number, sector: SectorId = 'saas'): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })

/** A Career company that has taken the fork — the same rig token-economy.test.ts uses. */
function tokenised(sector: SectorId = 'devtools', seed = 4242, weeks = 20): GameState {
  let s = newGame('Comm', sector, 'technical', { config: cfg(seed, sector) })
  s.cash = 20_000_000
  for (let w = 0; w < weeks && !s.gameOver; w++) s = advanceWeek(s)
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 60)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  const res = launchToken(s)
  if (!res.ok) throw new Error(`setup failed: ${res.reason}`)
  return s
}

/** One community-gated week: bump the week, run the tick under a fixed seed. */
function week(s: GameState, seed = 31337) {
  s.week += 1
  return withSeed(seed + s.week, () => tickToken(s))
}

// ---------------------------------------------------------------------------------------------
console.log('— The capability ratchet —')

const CAREER = defaultCapabilities('career')
const QUICK = defaultCapabilities('quick')
const ARENA = defaultCapabilities('arena')
ok(CAREER.tokenCommunity === true, 'Career has `tokenCommunity` on — Slice 5 built the counterparty it gates')
ok(QUICK.tokenCommunity === false && ARENA.tokenCommunity === false, 'Quick Play and Arena stay off (§55 is Slice 7, §58 is never)')

// ---------------------------------------------------------------------------------------------
console.log('— With the capability OFF, conduct is invisible: the Slice-4 arithmetic exactly —')

{
  // Differential in both directions. Two tokenised states, identical except that one has a fresh
  // treasury-sale record on the books. With `tokenCommunity` OFF the community cannot see it, so
  // one tick must produce bit-identical community state. With it ON, the same pair must diverge.
  const make = (on: boolean) => {
    const a = tokenised('saas', 777)
    a.capabilities = { ...a.capabilities, tokenCommunity: on }
    const b = structuredClone(a)
    b.token!.treasurySales = { tokensSold: 1000, proceeds: 1000, lastSaleWeek: b.week }
    week(a)
    week(b)
    return { a, b }
  }
  const off = make(false)
  ok(
    off.a.token!.community.trust === off.b.token!.community.trust &&
      off.a.token!.community.founderInfluence === off.b.token!.community.founderInfluence &&
      off.a.token!.community.decentralisationDemand === off.b.token!.community.decentralisationDemand,
    'capability OFF: a state with a fresh sale on the books ticks bit-identically — conduct does not exist',
  )
  const on = make(true)
  ok(
    on.b.token!.community.trust < on.a.token!.community.trust,
    `capability ON: the same sale record now drags trust (${on.b.token!.community.trust.toFixed(2)} vs ${on.a.token!.community.trust.toFixed(2)}) — the community remembers who sold`,
  )
  // And influence only MOVES under the capability: Slice 4 wrote it at launch and never again.
  const idle = tokenised('saas', 778)
  idle.capabilities = { ...idle.capabilities, tokenCommunity: false }
  idle.token!.community.decentralisation = 80
  const infBefore = idle.token!.community.founderInfluence
  week(idle)
  ok(idle.token!.community.founderInfluence === infBefore, 'capability OFF: founderInfluence never moves — the Slice-4 constant it was')

  // …and the Slice-4 trust write still RUNS with the capability off: a community-treasury
  // programme keeps moving trust toward its target through the legacy branch, so turning Slice 5
  // off restores Slice 4 rather than deleting it.
  const legacy = tokenised('saas', 779)
  legacy.capabilities = { ...legacy.capabilities, tokenCommunity: false }
  legacy.token!.community.decentralisation = 90
  legacy.token!.community.trust = 10
  legacy.token!.incentives = [
    { category: 'community_treasury', share: 0.5, tokensPerWeek: 0, startedWeek: legacy.week, cumulativeTokens: 0, effectiveness: 1 },
  ]
  week(legacy)
  ok(
    legacy.token!.community.trust > 10,
    `capability OFF: the Slice-4 community-treasury trust write still runs (trust 10 → ${legacy.token!.community.trust.toFixed(1)})`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— §34: founderInfluence reverts toward (100 − decentralisation) and never jumps —')

{
  const s = tokenised('saas', 811)
  const t = s.token!
  t.community.decentralisation = 80
  t.community.founderInfluence = 90
  week(s)
  const inf = t.community.founderInfluence
  ok(inf < 90, `influence declines once the network decentralises (${inf.toFixed(1)} < 90)`)
  ok(inf > 60, `…but it NEVER jumps: one week moves it a fraction of the gap (${inf.toFixed(1)} > 60), so handing over control protects you only once the community believes it`)
  // The reversion has a fixed point at the contract's own target.
  const settled = tokenised('saas', 812)
  settled.token!.community.decentralisation = 40
  settled.token!.community.founderInfluence = 60
  const before = settled.token!.community.founderInfluence
  week(settled)
  ok(Math.abs(settled.token!.community.founderInfluence - before) < 1e-9, 'at influence === 100 − decentralisation the reversion is at rest — the target is the contract’s')
}

// ---------------------------------------------------------------------------------------------
console.log('— The type’s own promise: demand rises when founderInfluence outruns trust —')

{
  const gap = tokenised('saas', 821)
  gap.token!.community.trust = 20
  gap.token!.community.founderInfluence = 90
  gap.token!.community.decentralisationDemand = 20
  week(gap)
  ok(
    gap.token!.community.decentralisationDemand > 20,
    `influence 90 over trust 20: demand rises (${gap.token!.community.decentralisationDemand.toFixed(1)} > 20)`,
  )
  const settledArg = tokenised('saas', 822)
  settledArg.token!.community.trust = 90
  settledArg.token!.community.founderInfluence = 20
  settledArg.token!.community.decentralisationDemand = 80
  week(settledArg)
  ok(
    settledArg.token!.community.decentralisationDemand < 80,
    `a decentralised, trusted network is a settled argument: demand falls (${settledArg.token!.community.decentralisationDemand.toFixed(1)} < 80)`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— The conduct ledger (§33, priced) —')

{
  // Mercenary growth: the community can read the §53 warning too. Pure conduct read on a
  // Quick-Play-shaped state so the incentivised share is settable directly.
  const s = tokenised('saas', 831)
  const bare = { ...s, career: undefined, users: 100 } as GameState
  bare.token = structuredClone(s.token)!
  bare.token.users = { organic: 40, incentivised: 60 }
  const rented = communityConduct(bare)
  ok(rented.mercenaryShare > 0.55, `a 60%-rented base is visible to the community (share ${rented.mercenaryShare.toFixed(2)})`)
  ok(
    (rented.drags.find((d) => d.id === 'mercenary_growth')?.points ?? 0) > 0,
    'and it drags the trust target — growth that is mostly bought reads as a founder buying a chart',
  )
  bare.token.users = { organic: 90, incentivised: 10 }
  const modest = communityConduct(bare)
  ok(
    (modest.drags.find((d) => d.id === 'mercenary_growth')?.points ?? 0) === 0,
    `below the ${Math.round(TOKEN_COMMUNITY.mercenaryShareFloor * 100)}% floor nobody minds the rewards programme — clean conduct is a clean ledger, not a smaller fine`,
  )

  // Founder overhang: fear of a SELLABLE bag, so the cliff matters.
  const oh = tokenised('saas', 832)
  ok(
    founderOverhang(oh.token!, oh.token!.launchWeek + 8) === 0,
    'behind the cliff the overhang is zero — a locked bag cannot hit the market',
  )
  ok(
    founderOverhang(oh.token!, oh.token!.launchWeek + 60) > founderOverhang(oh.token!, oh.token!.launchWeek + 13),
    'and it grows as the position vests — the forums were counting the weeks to your cliff',
  )

  // Centralisation: THE founderInfluence read. Identical demand, different holders of the control
  // being demanded.
  const held = tokenised('saas', 833)
  held.token!.community.decentralisationDemand = 80
  held.token!.community.founderInfluence = 90
  const heldDrag = communityConduct(held).drags.find((d) => d.id === 'centralisation')!.points
  held.token!.community.founderInfluence = 10
  const cededDrag = communityConduct(held).drags.find((d) => d.id === 'centralisation')!.points
  ok(
    heldDrag > cededDrag * 3,
    `unmet demand costs trust only to the degree you still HOLD what is demanded (${heldDrag.toFixed(1)} vs ${cededDrag.toFixed(1)} pts) — founderInfluence is a read value with a consequence`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— §35: the resilience trade — a centralised network amplifies a crash —')

{
  ok(resilienceFactor(100) > resilienceFactor(0), 'the shock amplifier rises with founder influence')
  // Everything held equal — decentralisation, demand, sentiment, the drawdown — EXCEPT influence.
  // Influence lags decentralisation by design (§34), so two networks with the same formal handover
  // and different believed influence are a legitimate state, and the only difference in what this
  // crash costs them is the resilience read itself. That isolation is what kills the mutant that
  // deletes the factor; varying decentralisation too would mask it behind the trust target.
  const crash = (influence: number) => {
    const s = tokenised('saas', 841)
    const t = s.token!
    t.community.founderInfluence = influence
    t.community.decentralisation = 50
    t.community.decentralisationDemand = 0
    t.market.emaPrice = t.market.price / 0.6 // this week reads as a 40% drawdown
    const trustBefore = t.community.trust
    week(s)
    return trustBefore - t.community.trust
  }
  const central = crash(95)
  const distributed = crash(5)
  ok(central > 0 && distributed > 0, `a crash is a trust event for everyone (−${central.toFixed(2)} / −${distributed.toFixed(2)})`)
  ok(
    central > distributed * 1.5,
    `…but the founder-run network takes it far worse (${central.toFixed(2)} vs ${distributed.toFixed(2)}): decentralisation traded control for exactly this`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— The mood reaches numbers the founder feels (the slice’s mandate) —')

{
  // ONE tick, both states above the exodus floor, differing only in trust. In a single week the
  // indirect channels (trust → sentiment → engagement → members/depth) cannot move — every target
  // reads the snapshot — so any difference below is the DIRECT scale on the call site. That is
  // what makes these kill the scale-deletion mutants rather than passing on the indirect chain.
  const oneWeek = (trust: number) => {
    const s = tokenised('saas', 851)
    s.token!.community.trust = trust
    week(s)
    return s
  }
  const warm = oneWeek(90)
  const cold = oneWeek(35)
  ok(
    warm.token!.community.members > cold.token!.community.members,
    `community growth reads trust the same week (${warm.token!.community.members} vs ${cold.token!.community.members} members after one tick)`,
  )
  ok(
    warm.token!.market.depth > cold.token!.market.depth,
    `market depth reads trust the same week (${warm.token!.market.depth.toFixed(4)} vs ${cold.token!.market.depth.toFixed(4)})`,
  )

  // And over a quarter the compounding difference reaches the founder's own arithmetic.
  const run = (trust: number) => {
    const s = tokenised('saas', 851)
    s.token!.community.trust = trust
    for (let i = 0; i < 12; i++) week(s)
    return s
  }
  const trusted = run(90)
  const betrayed = run(10)
  ok(
    trusted.token!.community.members > betrayed.token!.community.members * 1.15,
    `community growth: trust 90 grows the community, trust 10 starves it (${trusted.token!.community.members} vs ${betrayed.token!.community.members} members)`,
  )
  ok(
    liquidityDiscount(trusted) > liquidityDiscount(betrayed),
    `and depth is 45% of the liquidity discount, so the community’s mood reaches the founder’s own exit (${liquidityDiscount(trusted).toFixed(3)} vs ${liquidityDiscount(betrayed).toFixed(3)})`,
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— The exodus: below the trust floor, holders leave — and sell (§43 as a process) —')

{
  const s = tokenised('saas', 861)
  const t = s.token!
  t.community.trust = 5
  const membersBefore = t.community.members
  const control = structuredClone(s)
  control.token!.community.trust = 60
  const rep = week(s)
  const repControl = week(control)
  ok(rep.community.exodus, 'trust 5 is an exodus')
  ok(
    t.community.members < membersBefore && t.community.members < control.token!.community.members,
    `holders leave: members ${membersBefore} → ${t.community.members} in one week (trust-60 control: ${control.token!.community.members})`,
  )
  ok(
    rep.step.supplyPressure > repControl.step.supplyPressure,
    `and they SELL on the way out: supply pressure ${rep.step.supplyPressure.toFixed(4)} vs the control’s ${repControl.step.supplyPressure.toFixed(4)}`,
  )
  ok(
    t.community.engagement < control.token!.community.engagement,
    'departure is disengagement in motion — the engagement shock lands',
  )
  ok(
    t.history.some((h) => h.type === 'crisis' && h.metadata.kind === 'exodus'),
    'the week is on the record as a crisis, for the postmortem',
  )
  ok(
    s.inbox.some((m) => m.id.startsWith('token-exodus')),
    'and the founder is TOLD, with the conduct ledger attached — a cost the player cannot see is not a cost',
  )
  const inboxCount = s.inbox.filter((m) => m.id.startsWith('token-exodus')).length
  week(s)
  ok(
    s.inbox.filter((m) => m.id.startsWith('token-exodus')).length === inboxCount,
    'the second week of the same exodus is not a second lecture — rate-limited like every warning',
  )
}

{
  // The lag rule, on Slice 5's own channel: the exodus reads the SNAPSHOT trust, never the trust
  // this tick just wrote. Trust starts just above the floor, conduct drags the target far below —
  // the write lands under the floor, but THIS week must not be an exodus.
  const s = tokenised('saas', 862)
  const t = s.token!
  t.community.trust = TOKEN_COMMUNITY.exodusTrustFloor + 0.2
  t.community.sentiment = 15 // a sour crowd, so the conduct-dragged target sits far below the floor
  t.community.decentralisationDemand = 100
  t.community.founderInfluence = 100
  t.treasurySales = { tokensSold: 1000, proceeds: 1000, lastSaleWeek: s.week }
  const first = week(s)
  ok(
    first.mods.exodusSeverity === 0 && !first.community.exodus,
    `week 1: trust entered above the floor, so no exodus — the tick read the snapshot (trust is now ${t.community.trust.toFixed(1)})`,
  )
  ok(t.community.trust < TOKEN_COMMUNITY.exodusTrustFloor, '…even though the week’s write landed below it')
  const second = week(s)
  ok(second.mods.exodusSeverity > 0, 'week 2: NOW it is an exodus — one week of lag, exactly as the contract prices reflexive edges')
}

{
  // No absorbing state: the floor repels. A community at rock bottom with CLEAN conduct recovers,
  // and the exodus stops on its own — the restoring force is the trust target, not a clamp.
  const s = tokenised('saas', 863)
  const t = s.token!
  t.community.trust = 2
  t.community.decentralisationDemand = 0
  let exodusWeeks = 0
  for (let i = 0; i < 40; i++) {
    const rep = week(s)
    if (rep.community.exodus) exodusWeeks++
    const bad = tokenInvariants(s)
    if (bad.length) {
      fails.push(`invariants broke in recovery week ${i}: ${bad.join('; ')}`)
      break
    }
  }
  ok(
    t.community.trust > TOKEN_COMMUNITY.exodusTrustFloor + 2,
    `trust 2 with clean conduct recovers past the floor within 40 weeks (now ${t.community.trust.toFixed(1)}) — the floor is somewhere you pass through, not somewhere you stay`,
  )
  ok(exodusWeeks < 40, `and the exodus STOPPED (${exodusWeeks} exodus weeks of 40) — the brake is inside the loop`)
  ok(t.community.members > 0, 'somebody is still here to rebuild for')
}

// ---------------------------------------------------------------------------------------------
console.log('— The sale is priced by WHO was seen selling (the second founderInfluence read) —')

{
  const s = tokenised('saas', 871, 30)
  const t = s.token!
  t.market.depth = 0.5
  ok(saleInfluenceFactor(s) > 1 === t.community.founderInfluence > 50, 'the factor pivots at influence 50')
  const central = structuredClone(s)
  central.token!.community.founderInfluence = 95
  const ceded = structuredClone(s)
  ceded.token!.community.founderInfluence = 15
  const size = Math.floor(maxTreasurySale(s) * 0.8)
  const qCentral = treasurySaleQuote(central, size)
  const qCeded = treasurySaleQuote(ceded, size)
  ok(
    qCentral.trustCost > qCeded.trustCost * 1.5,
    `the boss cashing out costs more belief than a community-governed treasury rebalancing (${qCentral.trustCost.toFixed(1)} vs ${qCeded.trustCost.toFixed(1)} pts of trust)`,
  )
  const offCap = structuredClone(central)
  offCap.capabilities = { ...offCap.capabilities, tokenCommunity: false }
  const offCap2 = structuredClone(ceded)
  offCap2.capabilities = { ...offCap2.capabilities, tokenCommunity: false }
  ok(
    treasurySaleQuote(offCap, size).trustCost === treasurySaleQuote(offCap2, size).trustCost,
    'capability OFF: the two quotes are identical — the Slice-4 sale to the last digit',
  )
  // And the sale then feeds the ledger: selling starts the memory the trust target reads.
  const sold = structuredClone(central)
  const res = sellTreasuryTokens(sold, size)
  ok(res.ok === true, 'the sale itself still clears')
  ok(communityConduct(sold).saleMemory === 1, 'and the community’s memory of it starts at full — the target stays down until it fades')
}

// ---------------------------------------------------------------------------------------------
console.log('— Restoring forces: conduct stops, trust recovers; nothing ratchets (§4’s rule) —')

{
  const s = tokenised('devtools', 881, 30)
  // Be awful for 20 weeks: rewards-led rented growth, repeated treasury sales.
  setIncentiveShares(s, { customer_rewards: 0.8, liquidity_incentives: 0.2 })
  for (let i = 0; i < 20; i++) {
    if (i % 8 === 0) {
      const max = maxTreasurySale(s)
      if (max > 0) sellTreasuryTokens(s, Math.floor(max * 0.9))
    }
    week(s)
  }
  const low = s.token!.community.trust
  // Then stop, completely, and wait.
  setIncentiveShares(s, { customer_rewards: 0, liquidity_incentives: 0 })
  for (let i = 0; i < 40; i++) week(s)
  ok(
    s.token!.community.trust > low + 8,
    `twenty weeks of bad conduct, then forty of none: trust ${low.toFixed(1)} → ${s.token!.community.trust.toFixed(1)} — the ledger fades, it does not accumulate`,
  )
  ok(tokenInvariants(s).length === 0, 'and every invariant holds at the end of the whole arc')
}

// ---------------------------------------------------------------------------------------------
console.log('— The panel: the mood is visible where the levers are —')

{
  const s = tokenised('saas', 891)
  const r = communityReadout(s)
  ok(r.active && r.trust === s.token!.community.trust && r.conduct.drags.length === 4, 'the readout carries the mood and the full four-line ledger')
  const off = structuredClone(s)
  off.capabilities = { ...off.capabilities, tokenCommunity: false }
  ok(communityReadout(off).active === false, 'and reports inactive when the capability is off — the panel gates on it')
}

// ---------------------------------------------------------------------------------------------
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------
// MUTATION LOG. 27 mutations, each a one-line textual edit applied to a pristine copy of the
// source, this file re-run, and the edit reverted. A mutation that stays green is a test that does
// not exist. Runner: a scripted apply/run/revert loop over the exact strings below.
//
//   M1  the community runs with the capability off                       KILLED
//   M2  tokenCommunity stays false in Career                             KILLED
//   M3  the community forgets a treasury sale instantly                  KILLED
//   M4  mercenary growth is invisible to the community                   KILLED
//   M5  the mercenary floor becomes a discount, not a floor              KILLED
//   M6  overhang fear ignores the cliff (granted, not vested)            KILLED*
//   M7  unmet demand ignores who holds control (influence unread)        KILLED
//   M8  the conduct drags are ADDED to the trust target                  KILLED
//   M9  trust never reverts (the write is deleted)                       KILLED
//   M10 a crash is not a trust event                                     KILLED
//   M11 centralisation stops amplifying the crash (resilience deleted)   KILLED*
//   M12 founderInfluence never moves after launch                        KILLED
//   M13 founderInfluence JUMPS to its target (§34 broken)                KILLED
//   M14 demand never rises when influence outruns trust                  KILLED
//   M15 trust stops reaching community growth (membersScale deleted)     KILLED*
//   M16 trust stops reaching market depth (depthScale deleted)           KILLED*
//   M17 nobody leaves at the trust floor                                 KILLED
//   M18 departing holders do not sell                                    KILLED
//   M19 exodus sell pressure never reaches the price (tick drops it)     KILLED
//   M20 the exodus is not disengagement (engagement shock dropped)       KILLED
//   M21 the exodus never cuts members (tick ignores the fraction)        KILLED
//   M22 the exodus decision reads this tick's trust, not the snapshot    KILLED
//   M23 the founder is never told about the exodus                       KILLED
//   M24 the exodus warning fires every week (cooldown deleted)           KILLED
//   M25 the sale costs the same whoever sells (influence factor deleted) KILLED
//   M26 the sale influence factor ignores the capability gate            KILLED
//   M27 the legacy Slice-4 trust write is deleted when the cap is off    KILLED
//
// * FOUR SURVIVED THE FIRST PASS, and each was the same lesson the last four slices logged —
//   an assertion that could be satisfied through a channel other than the one it named:
//
//   M6  asserted overhang === 0 at the LAUNCH week, where elapsed/duration is 0 and the mutant
//       returns 0 for free. Now asserted at launch+8 — behind the cliff, past zero elapsed.
//   M11 varied decentralisation ALONG WITH influence, so the trust TARGET differed between the two
//       crash states and carried the assertion with the resilience factor deleted. The two states
//       now share decentralisation and (zero) demand and differ only in influence — which is a
//       legitimate state precisely because influence lags the handover (§34).
//   M15/M16 were asserted over twelve weeks, where trust reaches members and depth INDIRECTLY
//       (trust → sentiment → engagement → members/depth) and the betrayed arm's exodus cut kept
//       the gap open with the scale deleted. Now asserted after ONE tick, where every indirect
//       channel still reads the identical snapshot and only the direct scale can differ.
