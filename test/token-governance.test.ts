// Tokenisation / ICO — Slice 6, governance. Run: npx tsx test/token-governance.test.ts
//
// Covers brief §36 (occasional votes, major issues), §37 (outcomes derive from state — "do not use
// pure random votes"), §38 (community pressure resolved into questions), §43 (community revolt →
// the fired ending, per docs/ico-architecture.md §7.9) and §69 (the panel contract), plus the
// slice plan's one-line gate: VOTES RESOLVE FROM STATE, NEVER RANDOMLY.
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose and this
// file re-run to confirm it goes red. The mutations are listed at the bottom.
//
// House rules applied: assert on the CALL SITE (the tick, the write, advanceWeek) rather than on a
// pure function the tick would have to call correctly to reach; differential tests — two states,
// one variable apart, ticked identically — wherever an expected value would otherwise be the
// formula pasted into the test.

import { advanceWeek, newGame, withSeed } from '../src/game/engine'
import { defaultCapabilities, type GameConfig } from '../src/game/modes'
import { tokenisationBars } from '../src/game/token/eligibility'
import {
  defyGovernanceMandate,
  founderRemovalPassed,
  governancePanel,
  governanceSaleFactor,
  governanceShareFloors,
  proposalSupport,
  setGovernanceStance,
  governanceInputs,
} from '../src/game/token/governance'
import { incentiveShares, setIncentiveShares } from '../src/game/token/incentives'
import { launchToken } from '../src/game/token/launch'
import { tokenInvariants } from '../src/game/token/market'
import { migrateTokenSlice } from '../src/game/token/persistence'
import { founderStanding } from '../src/game/token/scoring'
import { maxTreasurySale, treasurySaleQuote } from '../src/game/token/treasury'
import { tickToken } from '../src/game/token/tick'
import { TOKEN_GOVERNANCE, type GovernanceProposal } from '../src/game/token/types'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const cfg = (seed: number, sector: SectorId = 'saas'): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })

/** A Career company that has taken the fork — the same rig every token test uses. */
function tokenised(sector: SectorId = 'saas', seed = 4242, weeks = 20): GameState {
  let s = newGame('Gov', sector, 'technical', { config: cfg(seed, sector) })
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

/** One governed week through the CALL SITE: bump the week, run the tick under a fixed seed. */
function week(s: GameState, seed = 31337) {
  s.week += 1
  return withSeed(seed + s.week, () => tickToken(s))
}

/** An active proposal written directly, so resolution can be tested without waiting for emergence. */
function plant(s: GameState, type: GovernanceProposal['type'], weeksToClose = 0): GovernanceProposal {
  const p: GovernanceProposal = {
    id: `gov-${type}-${s.week}`,
    week: s.week,
    type,
    descriptionKey: type,
    support: 50,
    founderPosition: 'neutral',
    closesWeek: s.week + weeksToClose,
    status: 'active',
  }
  s.token!.governance.proposals.push(p)
  s.token!.governance.lastProposalWeek = s.week
  return p
}

// ---------------------------------------------------------------------------------------------
console.log('— The capability ratchet —')

const CAREER = defaultCapabilities('career')
const QUICK = defaultCapabilities('quick')
const ARENA = defaultCapabilities('arena')
ok(CAREER.tokenGovernance === true, 'Career has `tokenGovernance` on — Slice 6 built the votes it gates')
ok(QUICK.tokenGovernance === false && ARENA.tokenGovernance === false, 'Quick Play and Arena stay off (§113 keeps deep governance out of Quick Play, §58 keeps Arena out entirely)')

// ---------------------------------------------------------------------------------------------
console.log('— With the capability OFF, governance does not exist —')

{
  const s = tokenised('saas', 701)
  s.capabilities = { ...s.capabilities, tokenGovernance: false }
  // The loudest possible pressure state: if anything could table a proposal, this would.
  s.token!.community.decentralisationDemand = 90
  s.token!.community.founderInfluence = 90
  s.token!.community.trust = 5
  const frozen = JSON.stringify(s.token!.governance)
  for (let i = 0; i < 25; i++) {
    const rep = week(s)
    if (rep.governance.ran) fails.push(`capability OFF but the governance step ran in week ${s.week}`)
  }
  ok(JSON.stringify(s.token!.governance) === frozen, 'capability OFF: 25 weeks of maximal pressure write NOTHING into the governance slice')
  ok(governancePanel(s).active === false, 'and the panel reports inactive — the UI gates on it')
  ok(founderRemovalPassed(s) === false, 'and the engine ouster read is false whatever the slice contains')
}

// ---------------------------------------------------------------------------------------------
console.log('— Proposals emerge FROM STATE (§36, §38): the pressure Slice 5 computed becomes a question —')

{
  // Sustained decentralisation pressure tables the handover question, and names it.
  const s = tokenised('saas', 711)
  s.week = s.token!.governance.lastProposalWeek + TOKEN_GOVERNANCE.proposalCooldownWeeks // cooldown just expired
  s.token!.community.decentralisationDemand = 85
  s.token!.community.founderInfluence = 85
  const rep = week(s)
  ok(rep.governance.tabled === 'decentralisation', `demand 85 under influence 85 tables the decentralisation proposal (got ${rep.governance.tabled})`)
  const p = s.token!.governance.proposals.find((x) => x.status === 'active')!
  ok(p.closesWeek === p.week + TOKEN_GOVERNANCE.votingWeeks, `…with §69's countdown attached (closes ${TOKEN_GOVERNANCE.votingWeeks} weeks out)`)
  ok(s.inbox.some((m) => m.id.startsWith('gov-tabled-decentralisation')), 'and the founder is told, with the ask and what passing binds')
  // One question at a time: the same pressure does not stack a second proposal on the ballot.
  const rep2 = week(s)
  ok(rep2.governance.tabled === null, 'a second proposal is not tabled while one is on the ballot (§36: keep frequency low)')

  // A fresh treasury sale on the books tables the sale-freeze question instead.
  const sold = tokenised('saas', 712)
  sold.week = sold.token!.governance.lastProposalWeek + TOKEN_GOVERNANCE.proposalCooldownWeeks
  sold.token!.treasurySales = { tokensSold: 50000, proceeds: 50000, lastSaleWeek: sold.week }
  const repSold = week(sold)
  ok(repSold.governance.tabled === 'protocol_change', `a fresh treasury sale tables the sale freeze (got ${repSold.governance.tabled})`)

  // One at a time holds even when the cooldown alone would not block it: an active proposal with
  // a forged-ancient lastProposalWeek and a second live need still tables nothing.
  const busy = tokenised('saas', 713)
  busy.token!.governance.proposals.push({
    id: 'gov-decentralisation-old', week: busy.week - 20, type: 'decentralisation', descriptionKey: 'decentralisation',
    support: 50, founderPosition: 'neutral', closesWeek: busy.week + 3, status: 'active',
  })
  busy.token!.governance.lastProposalWeek = busy.week - 20
  busy.token!.treasurySales = { tokensSold: 50000, proceeds: 50000, lastSaleWeek: busy.week } // a second live need
  ok(week(busy).governance.tabled === null, 'one question at a time is its own rule, not a side effect of the cooldown')

  // And a clean, settled company tables NOTHING, for forty straight weeks.
  const quiet = tokenised('saas', 7)
  let tabled = 0
  for (let i = 0; i < 40; i++) if (week(quiet).governance.tabled) tabled++
  ok(tabled === 0, 'a quiet company holds no votes: emergence is thresholded on need, not scheduled')
}

// ---------------------------------------------------------------------------------------------
console.log('— Support is §37 as arithmetic: every listed input, one differential at a time —')

{
  const rig = () => {
    const s = tokenised('saas', 721)
    s.token!.community.decentralisationDemand = 75
    s.token!.community.founderInfluence = 80
    return s
  }
  const sup = (s: GameState, type: GovernanceProposal['type'], pos: GovernanceProposal['founderPosition'] = 'neutral') =>
    proposalSupport(s, { type, founderPosition: pos }).support

  // Trust: the no-confidence vote reads it against the founder.
  const a = rig()
  a.token!.community.trust = 10
  const b = rig()
  b.token!.community.trust = 60
  ok(sup(a, 'founder_removal') > sup(b, 'founder_removal'), `trust sinks the removal vote (${sup(a, 'founder_removal').toFixed(1)} at trust 10 vs ${sup(b, 'founder_removal').toFixed(1)} at trust 60)`)

  // Sentiment: a happy crowd funds ambition and keeps its founder.
  const happy = rig()
  happy.token!.community.sentiment = 85
  const sour = rig()
  sour.token!.community.sentiment = 15
  ok(sup(happy, 'decentralisation') > sup(sour, 'decentralisation'), 'sentiment lifts a constructive proposal')
  ok(sup(sour, 'founder_removal') > sup(happy, 'founder_removal'), 'and a sour crowd reaches for the door')

  // Recent token performance: a falling chart radicalises.
  const crash = rig()
  crash.token!.treasurySales = { tokensSold: 1, proceeds: 1, lastSaleWeek: crash.week } // gives protocol_change a live need
  const rally = structuredClone(crash)
  crash.token!.market.emaPrice = crash.token!.market.price / 0.6 // −40% against the anchor
  rally.token!.market.emaPrice = rally.token!.market.price / 1.4 // +40%
  ok(sup(crash, 'protocol_change') > sup(rally, 'protocol_change'), `a crash feeds the restraint vote (${sup(crash, 'protocol_change').toFixed(1)} vs ${sup(rally, 'protocol_change').toFixed(1)})`)
  ok(sup(rally, 'expansion_subsidy') > sup(crash, 'expansion_subsidy'), 'and a rally feeds the expansion vote')

  // Holder composition: holders vote their bag.
  const holderHeavy = rig()
  holderHeavy.token!.community.members = 1000
  holderHeavy.token!.community.holders = 900
  holderHeavy.token!.treasurySales = { tokensSold: 1, proceeds: 1, lastSaleWeek: holderHeavy.week }
  const memberHeavy = structuredClone(holderHeavy)
  memberHeavy.token!.community.holders = 100
  ok(sup(holderHeavy, 'protocol_change') > sup(memberHeavy, 'protocol_change'), 'a holder-heavy community backs the sale freeze — it protects the float')
  ok(sup(memberHeavy, 'ecosystem_initiative') > sup(holderHeavy, 'ecosystem_initiative'), 'a member-heavy one backs spending programmes')

  // Founder influence × trust: your word carries what your standing says it carries.
  const heard = rig()
  heard.token!.community.trust = 80
  heard.token!.community.founderInfluence = 90
  const ignored = rig()
  ignored.token!.community.trust = 10
  ignored.token!.community.founderInfluence = 15
  const swingHeard = sup(heard, 'decentralisation') - sup(heard, 'decentralisation', 'oppose')
  const swingIgnored = sup(ignored, 'decentralisation') - sup(ignored, 'decentralisation', 'oppose')
  ok(swingHeard > 0, `campaigning against moves the tally (−${swingHeard.toFixed(1)} points)`)
  ok(swingHeard > swingIgnored * 2, `…and a distrusted, uninfluential founder moves almost nothing (${swingHeard.toFixed(1)} vs ${swingIgnored.toFixed(1)}) — influence is the megaphone, trust is whether anyone believes it`)
  // Trust isolated: SAME influence, only belief differs — this is the differential that dies if
  // sway stops reading trust, because the megaphone is identical and only the believing is not.
  const believed = rig()
  believed.token!.community.trust = 90
  believed.token!.community.founderInfluence = 80
  const doubted = rig()
  doubted.token!.community.trust = 5
  doubted.token!.community.founderInfluence = 80
  const swingBelieved = sup(believed, 'decentralisation') - sup(believed, 'decentralisation', 'oppose')
  const swingDoubted = sup(doubted, 'decentralisation') - sup(doubted, 'decentralisation', 'oppose')
  ok(swingBelieved > swingDoubted * 1.5, `at identical influence, the believed founder's word moves more (${swingBelieved.toFixed(1)} vs ${swingDoubted.toFixed(1)}) — trust is a factor of the sway itself`)

  // Legitimacy: defied votes make every later vote angrier.
  const clean = rig()
  const defiant = rig()
  defiant.token!.governance.defiances = TOKEN_GOVERNANCE.maxDefiances
  ok(sup(defiant, 'decentralisation') > sup(clean, 'decentralisation'), 'torn-up mandates raise support on EVERY later proposal')

  // Turnout: engagement and decentralisation scale decisiveness, not direction.
  const engaged = rig()
  engaged.token!.community.engagement = 90
  const inert = rig()
  inert.token!.community.engagement = 5
  const dEngaged = Math.abs(sup(engaged, 'decentralisation') - 50)
  const dInert = Math.abs(sup(inert, 'decentralisation') - 50)
  ok(dEngaged > dInert, `a disengaged community cannot organise a majority: |support − 50| shrinks (${dEngaged.toFixed(1)} vs ${dInert.toFixed(1)})`)

  // Purity: same state, same tally — twice, and on a clone.
  const p = rig()
  const s1 = sup(p, 'decentralisation')
  const s2 = sup(p, 'decentralisation')
  const s3 = sup(structuredClone(p), 'decentralisation')
  ok(s1 === s2 && s1 === s3, 'the support function is pure: identical states produce the identical tally')
}

// ---------------------------------------------------------------------------------------------
console.log('— The gate: votes RESOLVE from state, never randomly —')

{
  // Two identical states, ticked under DIFFERENT RNG seeds, resolve identically: the week's price
  // noise is drawn, the vote is not. Then one input flipped, everything else identical, flips the
  // outcome — the vote is a function of the state and of nothing else.
  const make = (trust: number) => {
    const s = tokenised('saas', 731)
    s.token!.community.decentralisationDemand = 85
    s.token!.community.founderInfluence = 85
    s.token!.community.trust = trust
    plant(s, 'decentralisation', 1) // closes next week
    return s
  }
  const passA = make(60)
  const passB = structuredClone(passA)
  passA.week += 1
  passB.week += 1
  const repA = withSeed(1, () => tickToken(passA))
  const repB = withSeed(999999, () => tickToken(passB))
  ok(
    repA.step.price !== repB.step.price,
    'the two seeds produced different PRICES this week (the draw is real and it landed elsewhere)…',
  )
  ok(
    repA.governance.resolved !== null &&
      repB.governance.resolved !== null &&
      repA.governance.resolved!.passed === repB.governance.resolved!.passed &&
      repA.governance.resolved!.support === repB.governance.resolved!.support,
    `…and the IDENTICAL vote either way (${repA.governance.resolved?.support} both times): the outcome never touched the RNG`,
  )
  ok(repA.governance.resolved!.passed === true, 'demand 85 under influence 85 passes the handover')

  const failCase = make(60)
  failCase.token!.community.decentralisationDemand = 30 // the one variable that carries the need
  failCase.week += 1
  const repFail = withSeed(1, () => tickToken(failCase))
  ok(
    repFail.governance.resolved !== null && repFail.governance.resolved!.passed === false,
    'the same vote with the demand gone FAILS — one state variable, one flipped outcome, no roll anywhere',
  )
}

// ---------------------------------------------------------------------------------------------
console.log('— Outcomes BIND (the slice mandate): a passed vote constrains something real —')

{
  // A passed grants vote holds a floor under the budget — materialised without the player acting.
  const s = tokenised('devtools', 741)
  plant(s, 'ecosystem_initiative', 1)
  s.token!.community.engagement = 80
  s.token!.market.utility = 15
  s.token!.community.sentiment = 75
  week(s)
  const p = s.token!.governance.proposals[0]
  ok(p.status === 'passed', `the grants vote passed (support ${p.support})`)
  const floor = TOKEN_GOVERNANCE.grantFloorShare
  ok(incentiveShares(s).developer_grants >= floor, `the floor materialised into a live programme on its own: developer_grants ≥ ${floor} — complying is the default, not a chore`)
  ok((governanceShareFloors(s).developer_grants ?? 0) === floor, 'and the floor is published to the one write')

  // The slider physically cannot go below it…
  setIncentiveShares(s, { developer_grants: 0 })
  ok(incentiveShares(s).developer_grants >= floor, 'the player tries to zero it; the write refuses — the vote binds at the write site')
  // …and over-committing scales the FLEXIBLE part, never the mandated floor.
  setIncentiveShares(s, { customer_rewards: 1 })
  const shares = incentiveShares(s)
  const total = Object.values(shares).reduce((a, v) => a + v, 0)
  ok(shares.developer_grants >= floor - 1e-9, `full-budget requests elsewhere squeeze around the floor (grants ${shares.developer_grants})`)
  ok(total <= 1 + 1e-9, `and the budget stays a budget (total ${total.toFixed(3)})`)

  // The mandate EXPIRES: governance is a term, not a ratchet. Asserted WITHOUT a tick in between,
  // so it is the enforcement read (`activeMandates`) doing the expiring, not the weekly prune.
  s.week = s.token!.governance.mandates[0].untilWeek
  setIncentiveShares(s, { developer_grants: 0, customer_rewards: 0 })
  ok(incentiveShares(s).developer_grants === 0, 'past `untilWeek` the floor lapses and the player is free again')

  // A passed sale freeze closes the treasury's market access, with the reason attached.
  const frozen = tokenised('saas', 742)
  frozen.token!.treasurySales = { tokensSold: 1, proceeds: 1, lastSaleWeek: frozen.week }
  frozen.token!.community.holders = Math.round(frozen.token!.community.members * 0.9)
  frozen.token!.market.emaPrice = frozen.token!.market.price / 0.7
  plant(frozen, 'protocol_change', 1)
  const before = maxTreasurySale(frozen)
  ok(before > 0, 'before the vote the treasury could sell')
  week(frozen)
  ok(frozen.token!.governance.proposals[0].status === 'passed', `the freeze passed (support ${frozen.token!.governance.proposals[0].support})`)
  ok(maxTreasurySale(frozen) === 0 && governanceSaleFactor(frozen) === 0, 'after it, the treasury cannot sell a single token')
  ok(/governance/i.test(treasurySaleQuote(frozen, 1000).reason ?? ''), 'and the quote SAYS the vote is why (§47: never silently hide it)')

  // A passed handover moves control — monotone, §35 — and relieves the demand that tabled it.
  const hand = tokenised('saas', 743)
  hand.token!.community.decentralisationDemand = 85
  hand.token!.community.founderInfluence = 85
  const dBefore = hand.token!.community.decentralisation
  const demandBefore = 85
  plant(hand, 'decentralisation', 1)
  week(hand)
  ok(hand.token!.governance.proposals[0].status === 'passed', 'the handover passed')
  ok(hand.token!.community.decentralisation > dBefore + TOKEN_GOVERNANCE.decentralisationStep * 0.6, `control moved (${dBefore.toFixed(0)} → ${hand.token!.community.decentralisation.toFixed(0)})`)
  ok(hand.token!.community.decentralisationDemand < demandBefore, 'and the demand that tabled it is relieved — the loudest holders got what they asked for')
}

// ---------------------------------------------------------------------------------------------
console.log('— The campaign: a public position, priced once, shifting the NEXT tally —')

{
  const s = tokenised('saas', 751)
  s.token!.community.decentralisationDemand = 80
  s.token!.community.founderInfluence = 80
  plant(s, 'decentralisation', 6)
  week(s) // one tick so the tally exists
  const control = structuredClone(s)
  const energyBefore = s.energy
  const repBefore = s.reputation
  const res = setGovernanceStance(s, s.token!.governance.proposals[0].id, 'oppose')
  ok(res.ok, 'the founder can campaign against an active proposal')
  ok(s.energy < energyBefore && s.reputation < repBefore, `and it costs: energy ${energyBefore} → ${s.energy}, reputation ${repBefore} → ${s.reputation}`)
  ok(!setGovernanceStance(s, s.token!.governance.proposals[0].id, 'support').ok, 'a position is taken ONCE — you said it in public, it stands')
  week(s)
  week(control)
  ok(
    s.token!.governance.proposals[0].support < control.token!.governance.proposals[0].support,
    `the campaign moves the weekly tally through the tick (${s.token!.governance.proposals[0].support} vs the silent clone's ${control.token!.governance.proposals[0].support})`,
  )

  // Never re-rolls a resolved vote.
  const done = tokenised('saas', 752)
  const p = plant(done, 'decentralisation', 0)
  done.token!.community.decentralisationDemand = 85
  done.token!.community.founderInfluence = 85
  week(done)
  ok(p.status !== 'active', 'the vote closed')
  ok(!setGovernanceStance(done, p.id, 'oppose').ok, 'and nothing re-rolls it: campaigning against a resolved vote is refused')
}

// ---------------------------------------------------------------------------------------------
console.log('— Defiance: the priced exit, and the price with the long tail —')

{
  const s = tokenised('devtools', 761)
  plant(s, 'ecosystem_initiative', 1)
  s.token!.community.engagement = 80
  s.token!.market.utility = 15
  s.token!.community.sentiment = 75
  week(s)
  ok(s.token!.governance.mandates.length === 1, 'a mandate stands')
  const clone = structuredClone(s) // identical, but will not defy — the legitimacy differential
  const trustBefore = s.token!.community.trust
  const repBefore = s.reputation
  const res = defyGovernanceMandate(s, s.token!.governance.mandates[0].proposalId)
  ok(res.ok, 'the founder can tear it up')
  ok(s.token!.governance.mandates.length === 0, 'the mandate is void')
  ok(s.token!.governance.defiances === 1, 'and counted')
  ok(Math.abs(trustBefore - s.token!.community.trust - TOKEN_GOVERNANCE.defyTrustCost) < 1e-9, `trust paid the price (−${TOKEN_GOVERNANCE.defyTrustCost})`)
  ok(s.reputation < repBefore, 'so did reputation')
  ok(s.inbox.some((m) => m.id.startsWith('gov-defied')), 'and the founder is told what it cost')
  setIncentiveShares(s, { developer_grants: 0 })
  ok(incentiveShares(s).developer_grants === 0, 'the floor is gone — defiance actually frees the budget'
  )
  // The long tail: the SAME later proposal polls higher against the defiant founder.
  const later = (g: GameState) => {
    g.token!.community.decentralisationDemand = 75
    g.token!.community.founderInfluence = 80
    return proposalSupport(g, { type: 'decentralisation', founderPosition: 'neutral' }).support
  }
  // Equalise everything defiance moved EXCEPT the count itself, so the differential is legitimacy alone.
  s.token!.community.trust = clone.token!.community.trust
  s.reputation = clone.reputation
  s.energy = clone.energy
  s.token!.community.decentralisationDemand = clone.token!.community.decentralisationDemand
  ok(later(s) > later(clone), `every future vote remembers (${later(s).toFixed(1)} vs ${later(clone).toFixed(1)} on the identical next question)`)
  ok(!defyGovernanceMandate(s, 'nonsense').ok, 'and there is nothing to defy where no mandate stands')
}

// ---------------------------------------------------------------------------------------------
console.log('— The ouster (§43, §7.9): rare, telegraphed twice, resolved from state, ends the run as the board would —')

{
  // A healthy company NEVER builds heat, however long you watch it.
  const healthy = tokenised('saas', 771)
  let maxHeat = 0
  for (let i = 0; i < 30; i++) maxHeat = Math.max(maxHeat, week(healthy).governance.heat)
  ok(maxHeat === 0, 'a healthy network builds zero revolt heat over 30 weeks — the ouster is unreachable from good standing')

  // Legitimacy is a GATE with two doors: a defiance, or a recent exodus. Below the exodus floor
  // with `tokenCommunity` on, the exodus door is open by construction — the holders ARE walking
  // out — so the doors are isolated with the community process off: same rock-bottom trust, no
  // exodus, and heat builds only once a defiance is on the record.
  const viaExodus = tokenised('saas', 773)
  viaExodus.token!.community.trust = 5
  viaExodus.token!.community.founderInfluence = 90
  ok(week(viaExodus).governance.heat > 0, "below the floor the exodus door is open the same week — the walk-out IS the broken legitimacy, no defiance needed")
  const noDoor = tokenised('saas', 773)
  noDoor.capabilities = { ...noDoor.capabilities, tokenCommunity: false } // no exodus process
  noDoor.token!.community.trust = 5
  noDoor.token!.community.founderInfluence = 90
  const oneDoor = structuredClone(noDoor)
  oneDoor.token!.governance.defiances = 1
  ok(week(noDoor).governance.heat === 0, 'with neither door open, rock-bottom trust alone builds no heat: the ouster needs a story, not just a number')
  ok(week(oneDoor).governance.heat > 0, 'and a single torn-up mandate opens it — the identical state, one defiance apart')

  // The full arc, through advanceWeek — the engine call site, not the module.
  // Trust is held on the floor each week (the state under test is the mechanism, not the
  // trajectory), influence stays high, and legitimacy is already broken by one defiance.
  const doomed = tokenised('saas', 772)
  doomed.token!.governance.defiances = 1
  let g = doomed
  let warnedWeek = 0
  let tabledWeek = 0
  let endedWeek = 0
  for (let i = 0; i < 30 && !g.gameOver; i++) {
    g.token!.community.trust = 5
    g.token!.community.founderInfluence = 90
    g.cash = Math.max(g.cash, 5_000_000) // the run must end by vote, not by bankruptcy
    g = advanceWeek(g)
    if (!warnedWeek && g.inbox.some((m) => m.id.startsWith('gov-revolt-warning'))) warnedWeek = g.week
    if (!tabledWeek && g.inbox.some((m) => m.id.startsWith('gov-tabled-founder_removal'))) tabledWeek = g.week
    if (g.gameOver) endedWeek = g.week
  }
  ok(endedWeek > 0, 'held at trust 5 with influence 90 and a broken mandate on the record, the community removes the founder')
  ok(g.gameOver?.type === 'fired', `…through the EXISTING fired ending (got ${g.gameOver?.type}) — §7.9, no seventh ending type`)
  ok(warnedWeek > 0 && tabledWeek > warnedWeek && endedWeek >= tabledWeek + TOKEN_GOVERNANCE.votingWeeks, `and it was telegraphed twice: brewing warning week ${warnedWeek}, tabled week ${tabledWeek}, removed week ${endedWeek} — never a surprise`)
  ok(g.gameOver!.payout === Math.round(founderStanding(g, { equityMultiplier: 0.5 })), 'the payout is the board\'s own shape: half the equity leg, the token position untouched')

  // Recovery flips it: the IDENTICAL descent, but trust is repaired once the vote is tabled.
  const saved = tokenised('saas', 772)
  saved.token!.governance.defiances = 1
  let h = saved
  for (let i = 0; i < 30 && !h.gameOver; i++) {
    const tabled = h.token!.governance.proposals.some((p) => p.type === 'founder_removal' && p.status === 'active')
    h.token!.community.trust = tabled ? 70 : 5 // the founder finally listens
    h.token!.community.founderInfluence = 90
    h.cash = Math.max(h.cash, 5_000_000)
    h = advanceWeek(h)
  }
  const removal = h.token!.governance.proposals.find((p) => p.type === 'founder_removal')
  ok(!h.gameOver && removal?.status === 'rejected', `repairing trust before the close DEFEATS the vote (${removal?.status} at ${removal?.support}) — the outcome reads the state to the last week`)
  ok(tokenInvariants(h).length === 0, 'and every invariant holds through the whole arc')
}

// ---------------------------------------------------------------------------------------------
console.log('— Persistence: absent-means-none, hostile saves clamped, round-trips exact —')

{
  const s = tokenised('saas', 781)
  s.token!.community.decentralisationDemand = 85
  s.token!.community.founderInfluence = 85
  s.week = s.token!.governance.lastProposalWeek + TOKEN_GOVERNANCE.proposalCooldownWeeks
  week(s) // tables the handover
  setGovernanceStance(s, s.token!.governance.proposals[0].id, 'oppose')
  s.token!.governance.defiances = 2
  s.token!.governance.revoltHeat = 3
  s.token!.governance.mandates.push({ proposalId: 'x', type: 'protocol_change', saleFactor: 0, untilWeek: s.week + 10 })
  s.token!.lastTickedWeek = s.week

  const trip = migrateTokenSlice(JSON.parse(JSON.stringify(s.token)))!
  ok(JSON.stringify(trip.governance) === JSON.stringify(s.token!.governance), 'a well-formed governance slice round-trips exactly — proposals, position, mandates, defiances, heat')

  // A pre-Slice-6 save has none of the new fields: it loads with nothing bound and a clean record.
  const legacy = JSON.parse(JSON.stringify(s.token))
  legacy.governance = { proposals: [], lastProposalWeek: 5 }
  const migrated = migrateTokenSlice(legacy)!
  ok(
    migrated.governance.mandates.length === 0 && migrated.governance.defiances === 0 && migrated.governance.revoltHeat === 0,
    'a save written before this slice loads with empty mandates and a clean legitimacy record — absent means none',
  )

  // Hostile rows are clamped or dropped, never believed.
  const hostile = JSON.parse(JSON.stringify(s.token))
  hostile.governance = {
    proposals: [
      { id: 'weird', week: 1, type: 'coup_by_localStorage', closesWeek: 5, support: 400 },
      { id: 'okay', week: 1, type: 'decentralisation', closesWeek: 5, support: 400, status: 'active' },
    ],
    lastProposalWeek: 1,
    mandates: [
      { proposalId: 'a', type: 'ecosystem_initiative', category: 'developer_grants', shareFloor: 4, untilWeek: s.week + 10 },
      { proposalId: 'b', type: 'protocol_change', untilWeek: s.week + 10 }, // binds nothing
      { proposalId: 'c', type: 'expansion_subsidy', category: 'partnerships', shareFloor: 0.4, untilWeek: 1 }, // expired
      { proposalId: 'd', type: 'treasury_allocation', category: 'community_treasury', shareFloor: 0.2, untilWeek: s.week + 10 }, // honest
    ],
    defiances: -5,
    revoltHeat: 9999,
  }
  const cleaned = migrateTokenSlice(hostile)!
  ok(cleaned.governance.proposals.length === 1 && cleaned.governance.proposals[0].type === 'decentralisation', 'an unknown proposal type is dropped, not believed')
  ok(cleaned.governance.proposals[0].support <= 100, 'support is clamped to 0–100')
  ok(cleaned.governance.mandates.length === 2 && cleaned.governance.mandates.every((m) => (m.shareFloor ?? 0) <= 1), 'a 400% floor cannot reach the budget; a mandate that binds nothing, or expired, does not survive the load')
  // The clamp must run BEFORE the renormalise, or the hostile row's raw 4.0 starves the honest row
  // in the shared rescale — the honest 0.2 floor would come out under 0.05.
  ok((cleaned.governance.mandates.find((m) => m.proposalId === 'd')?.shareFloor ?? 0) >= 0.1, 'and a hostile row cannot starve an honest one through the renormalise — 400% is clamped to 100% first')
  ok(cleaned.governance.defiances === 0 && cleaned.governance.revoltHeat <= TOKEN_GOVERNANCE.removalHeatMax, 'counts and heat are clamped to their ranges')
}

// ---------------------------------------------------------------------------------------------
console.log('— The panel: the vote arithmetic is legible where the decisions are —')

{
  const s = tokenised('saas', 791)
  s.token!.community.decentralisationDemand = 85
  s.token!.community.founderInfluence = 85
  s.week = s.token!.governance.lastProposalWeek + TOKEN_GOVERNANCE.proposalCooldownWeeks
  week(s)
  const panel = governancePanel(s)
  ok(panel.active && panel.proposal !== null, 'the panel carries the active proposal')
  ok(panel.proposal!.breakdown.terms.length === 6, 'with all six §37 terms named — the tally is shown as arithmetic, not as a mood')
  ok(
    Math.abs(panel.proposal!.breakdown.support - proposalSupport(s, panel.proposal!, governanceInputs(s)).support) < 1e-9,
    'and the number on the screen is the number the tick computes — same function, same inputs',
  )
  ok(panel.proposal!.passBar === TOKEN_GOVERNANCE.passBar && panel.proposal!.weeksLeft > 0, 'the bar and the §69 countdown are attached')
}

// ---------------------------------------------------------------------------------------------
console.log('— Determinism: the governed tick draws exactly what the ungoverned tick draws —')

{
  // Identical states, one with the capability, both ticked under the same seed: the PRICE — the
  // only thing downstream of the draw — must be identical, or governance consumed randomness.
  const a = tokenised('saas', 799)
  a.token!.community.decentralisationDemand = 85
  a.token!.community.founderInfluence = 85
  a.week = a.token!.governance.lastProposalWeek + TOKEN_GOVERNANCE.proposalCooldownWeeks
  const b = structuredClone(a)
  b.capabilities = { ...b.capabilities, tokenGovernance: false }
  const repA = week(a, 555)
  const repB = week(b, 555)
  ok(repA.governance.ran && repA.governance.tabled !== null, 'the governed twin tabled a proposal this week')
  ok(repA.step.price === repB.step.price && repA.step.noise === repB.step.noise, 'and both twins printed the identical price from the identical draw — governance consumed zero randomness')
}

// ---------------------------------------------------------------------------------------------
console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------
// MUTATION LOG. 34 mutations, each a textual edit applied to a pristine copy of the source, this
// file re-run, and the edit reverted. A mutation that stays green is a test that does not exist.
// Runner: a scripted apply/run/revert loop over the exact strings below.
//
//   M1   governance runs with the capability off                          KILLED
//   M2   tokenGovernance stays false in Career                            KILLED
//   M3   support is a constant, not a function of state                   KILLED
//   M4   the need term is deleted (proposal utility unread)               KILLED
//   M5   removal need stops reading trust                                 KILLED
//   M6   sentiment term deleted                                           KILLED
//   M7   token-performance term deleted                                   KILLED
//   M8   holder-composition term deleted                                  KILLED
//   M9   legitimacy term deleted (defiances unread)                       KILLED
//   M10  founder sway deleted (campaigning does nothing)                  KILLED
//   M11  sway ignores trust (a distrusted founder moves votes anyway)     KILLED*
//   M12  turnout ignores engagement for everyone                          KILLED
//   M12b hostile votes need engagement too (the exodus mutes the revolt)  KILLED
//   M13  every vote passes regardless of support                          KILLED
//   M14  the vote resolves from the calendar, not the tally               KILLED
//   M15  floors not applied at the write (outcomes stop binding)          KILLED
//   M16  sale freeze ignored by maxTreasurySale                           KILLED
//   M17  mandates never expire (the enforcement read)                     KILLED†
//   M18  a passed handover moves nothing                                  KILLED
//   M19  campaigning is free                                              KILLED
//   M20  a position can be re-taken (the vote re-rollable by spam)        KILLED
//   M21  defiance is not counted                                          KILLED
//   M22  defiance costs no trust                                          KILLED
//   M23  heat builds without preconditions                                KILLED
//   M24  the brewing warning is never sent                                KILLED
//   M25  the engine never consumes the passed removal                     KILLED
//   M26  the ouster payout does not halve the equity leg                  KILLED
//   M27  the migration believes a hostile share floor                     KILLED*
//   M28  the migration believes unknown proposal types                    KILLED
//   M29  emergence ignores the need threshold                             KILLED
//   M30  one-at-a-time deleted (only the cooldown holds)                  KILLED†
//   M31  legitimacy gate deleted (any bad mood can build a revolt)        KILLED
//   M32  the tick never calls governance                                  KILLED
//   M33  the weekly tally is never recomputed (support goes stale)        KILLED
//
// * TWO SURVIVED THE FIRST PASS — both the standing lesson every slice has re-learned: an
//   assertion satisfiable through a channel other than the one it names.
//
//   M11 the heard/ignored sway differential varied influence AND trust together, so the influence
//       factor alone carried the assertion with belief deleted. Now also asserted at IDENTICAL
//       influence with only trust apart — the swing that can only come from belief itself.
//   M27 the hostile fixture had ONE mandate row, and for a lone row the post-clamp renormalise
//       (4 → 1 → total 1 → stays 1) and the mutant's raw renormalise (4 → total 4 → 1) produce the
//       same number. An honest 0.2-floor row now shares the fixture: unclamped, the hostile row's
//       raw 4.0 starves it through the shared rescale (0.048), clamped it keeps ≥ 0.1.
//
// † TWO WERE PRE-EMPTIVELY HARDENED before the pass, because the first draft of this file would
//   have let them survive: the mandate-expiry assertion originally ticked the week first, so the
//   tick's bookkeeping prune masked an `activeMandates` that never expired (M17); and the
//   one-at-a-time assertion was originally guarded by the 10-week cooldown alone, which always
//   outlasts the 4-week ballot, so deleting the `anyActive` check changed nothing observable (M30
//   — killed by forging `lastProposalWeek` ancient under a still-open ballot).
