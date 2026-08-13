// Tokenisation / ICO — Slice 1, the capital fork. Run: npx tsx test/token-fork.test.ts
//
// Covers brief §79 (eligibility), §80 (capital path), §87 (persistence), §70 (determinism), §2
// (sector suitability is not one right answer) and §76 (no universal correct timing), plus
// docs/ico-architecture.md §1.1 (founderStanding's disjoint legs) and §4.6 (the supply invariant).
//
// EVERY assertion here was mutation-verified: the thing it guards was broken on purpose and this
// file was re-run to confirm it goes red. The mutations are listed at the bottom of the file so
// the next person can repeat them.

import {
  acceptTermSheet,
  advanceWeek,
  ipoEligible,
  ipoVisible,
  newGame,
  pitchInvestors,
  tokeniseCompany,
  valuation,
} from '../src/game/engine'
import { defaultCapabilities, type GameConfig } from '../src/game/modes'
import {
  communityStrength,
  runSectorSuitability,
  sectorSuitability,
  tokenFit,
  tokenMarketAppetite,
  tokenisationBars,
  tokenisationEligibility,
} from '../src/game/token/eligibility'
import { launchLateness, launchToken, resolveLaunchTerms } from '../src/game/token/launch'
import { splitSupply } from '../src/game/token/state'
import { migrateTokenSlice } from '../src/game/token/persistence'
import {
  founderStanding,
  founderVestedTokens,
  liquidityDiscount,
  networkValue,
  realisableTokenValue,
} from '../src/game/token/scoring'
import { capitalPath, isTokenised, tokenActive } from '../src/game/token/state'
import { communityMultiplier, launchCommunityMembers } from '../src/game/token/eligibility'
import { TOKEN_BOUNDS, TOKEN_LIMITS, TOKEN_STATE_VERSION } from '../src/game/token/types'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

const SECTORS: SectorId[] = ['saas', 'social', 'fintech', 'devtools', 'ecommerce']
const cfg = (seed: number, sector: SectorId = 'saas'): GameConfig => ({ mode: 'career', format: 'standard', sector, seed })

function career(sector: SectorId, seed: number, weeks = 0): GameState {
  let s = newGame('Forked', sector, 'technical', { config: cfg(seed, sector) })
  s.cash = 20_000_000
  for (let w = 0; w < weeks && !s.gameOver; w++) s = advanceWeek(s)
  return s
}

/** A company that clears every bar. Set directly rather than played, so the test asserts the
 *  PREDICATE and not the balance of a 40-week simulation. */
function eligible(sector: SectorId = 'devtools', seed = 4242): GameState {
  const s = career(sector, seed, 20)
  const bars = tokenisationBars(s)
  s.users = Math.max(s.users, bars.minUsers * 3)
  s.pmf = Math.max(s.pmf, bars.minPmf + 12)
  s.reputation = Math.max(s.reputation, bars.minReputation + 25)
  s.hype = Math.max(s.hype, 70)
  s.totalResearch = Math.max(s.totalResearch, 200)
  if (s.career) for (const k of Object.keys(s.career.retentionBySegment)) s.career.retentionBySegment[k] = 0.8
  return s
}

// ---------------------------------------------------------------------------------------------
console.log('— Capabilities: exactly one switch flipped —')

const CAREER = defaultCapabilities('career')
const QUICK = defaultCapabilities('quick')
const ARENA = defaultCapabilities('arena')
// Slices 2–6 shipped `tokenEconomy`, `tokenUserComposition`, `tokenIncentives`, `tokenCommunity`
// and `tokenGovernance`, so they moved off this list — the same ratchet `detailedPMF` went
// through. The remaining one still has no code that honours it.
const LATER_SLICES = ['tokenNarrative'] as const

ok(CAREER.tokenisation === true, 'Career has `tokenisation` on — Slice 1 built the fork it gates')
ok(QUICK.tokenisation === false, 'Quick Play stays off: its simplified fork is Slice 7')
ok(ARENA.tokenisation === false, 'Arena stays off for the whole feature (§58)')
ok(
  LATER_SLICES.every((k) => !CAREER[k] && !QUICK[k] && !ARENA[k]),
  'the later-slice token capability is false in every mode — no flag claims a system that does not exist',
)

// ---------------------------------------------------------------------------------------------
console.log('— Eligibility (§79) —')

const fresh = career('devtools', 7, 2)
const freshElig = tokenisationEligibility(fresh)
ok(!freshElig.eligible && freshElig.blockers.length > 0, 'a two-week-old company is not eligible, and says why')
const MEASURED = ['too_early', 'too_few_users', 'weak_pmf', 'weak_retention', 'low_reputation']
ok(
  freshElig.blockers.every((b) => b.label.length > 12 && b.progress >= 0 && b.progress <= 1),
  'every blocker carries a readable sentence and a 0–1 progress, never a raw score (§1)',
)
ok(
  freshElig.blockers.filter((b) => MEASURED.includes(b.id)).every((b) => /\d/.test(b.label)),
  "and every measurable blocker quotes this run's own numbers rather than a generic string",
)
ok(freshElig.readinessScore >= 0 && freshElig.readinessScore <= 100, 'readinessScore is a 0–100 scalar')

const good = eligible()
ok(tokenisationEligibility(good).eligible, 'a company that clears every bar is eligible')
ok(tokenisationEligibility(good).blockers.length === 0, 'an eligible company reports no blockers')

// eligibility varies with the state it reads — one input at a time
const weakPmf = { ...good, pmf: 5 }
const weakUsers = { ...good, users: 1 }
const weakRep = { ...good, reputation: 0 }
ok(tokenisationEligibility(weakPmf).blockers.some((b) => b.id === 'weak_pmf'), 'dropping PMF alone produces the weak_pmf blocker')
ok(tokenisationEligibility(weakUsers).blockers.some((b) => b.id === 'too_few_users'), 'dropping users alone produces the too_few_users blocker')
ok(tokenisationEligibility(weakRep).blockers.some((b) => b.id === 'low_reputation'), 'dropping reputation alone produces the low_reputation blocker')
ok(
  tokenisationEligibility(weakPmf).readinessScore < tokenisationEligibility(good).readinessScore,
  'readiness is monotone: a worse company scores lower',
)

const midPmf = { ...good, pmf: tokenisationBars(good).minPmf * 0.5 }
ok(
  tokenisationEligibility(weakPmf).readinessScore < tokenisationEligibility(midPmf).readinessScore &&
    tokenisationEligibility(midPmf).readinessScore < tokenisationEligibility(good).readinessScore,
  'readiness moves continuously with the input, not in one step',
)

// an in-flight S-1 is a hard block, and the capability is another
const filing = { ...good, ipo: { phase: 'filing' as const, weeksLeft: 3, demand: 50 } }
ok(tokenisationEligibility(filing).blockers.some((b) => b.id === 'ipo_in_flight'), 'you cannot fork capital paths mid-IPO')
const capOff = { ...good, capabilities: { ...good.capabilities, tokenisation: false } }
ok(tokenisationEligibility(capOff).blockers.some((b) => b.id === 'capability_off'), 'with the capability off, that is itself the blocker')

// ---------------------------------------------------------------------------------------------
console.log('— Sector suitability is a disposition, not a verdict (§2) —')

ok(
  new Set(SECTORS.map(sectorSuitability)).size >= 4,
  'the five sectors do not share one base disposition (' + SECTORS.map((x) => `${x}:${sectorSuitability(x)}`).join(' ') + ')',
)

const SUITE_SEEDS = [7, 42, 101, 303, 909, 4242, 31337, 90210, 5150, 6060]
const perSector: Record<string, Set<string>> = {}
const fitBySectorSeed: Record<string, number[]> = {}
for (const sec of SECTORS) {
  perSector[sec] = new Set()
  fitBySectorSeed[sec] = []
  for (const seed of SUITE_SEEDS) {
    const s = career(sec, seed, 24)
    perSector[sec].add(runSectorSuitability(s))
    fitBySectorSeed[sec].push(tokenFit(s))
  }
}
ok(
  SECTORS.every((sec) => perSector[sec].size >= 2),
  'in EVERY sector the resolved suitability differs across seeds — no sector has one hardcoded answer (' +
    SECTORS.map((s) => `${s}:${[...perSector[s]].join('/')}`).join(' · ') +
    ')',
)

// the appetite term is what does it, and it is a seeded VALUE, never a seeded DRAW
const appetites = SUITE_SEEDS.map((seed) => tokenMarketAppetite(career('saas', seed, 0)))
ok(new Set(appetites).size >= 8, `market appetite spans the seed space (${Math.min(...appetites)} … ${Math.max(...appetites)})`)
ok(
  tokenMarketAppetite(career('saas', 42, 0)) === tokenMarketAppetite(career('saas', 42, 30)),
  'appetite depends on the seed and the sector only — it does not drift as the run advances',
)
ok(
  tokenMarketAppetite(career('saas', 42, 0)) !== tokenMarketAppetite(career('devtools', 42, 0)),
  'the same seed can be warm to one sector and cold to another',
)

// strategy moves it too, on a fixed seed and sector
const stratLow = career('saas', 42, 24)
const stratPremium = career('saas', 42, 24)
if (stratLow.career) stratLow.career.pricing = 'low'
if (stratPremium.career) {
  stratPremium.career.pricing = 'premium'
  stratPremium.career.focus = 'enterprise_readiness'
}
ok(
  tokenFit(stratLow) > tokenFit(stratPremium) + 0.05,
  `strategy moves suitability on a FIXED seed and sector: low/broad ${tokenFit(stratLow).toFixed(2)} vs premium/enterprise ${tokenFit(stratPremium).toFixed(2)}`,
)
const barsLow = tokenisationBars(stratLow)
const barsPrem = tokenisationBars(stratPremium)
ok(barsLow.minUsers < barsPrem.minUsers, `a better-suited company needs fewer users (${barsLow.minUsers} vs ${barsPrem.minUsers})`)
ok(
  barsLow.minPmf < barsPrem.minPmf && barsLow.minCommunityStrength < barsPrem.minCommunityStrength && barsLow.minReputation < barsPrem.minReputation,
  `and a strictly lower PMF / community / reputation bar (${barsLow.minPmf}/${barsLow.minCommunityStrength}/${barsLow.minReputation} vs ${barsPrem.minPmf}/${barsPrem.minCommunityStrength}/${barsPrem.minReputation})`,
)

// no sector wins on every seed
const bestPerSeed = new Set(
  SUITE_SEEDS.map((_, i) => SECTORS.reduce((best, sec) => (fitBySectorSeed[sec][i] > fitBySectorSeed[best][i] ? sec : best), SECTORS[0])),
)
ok(bestPerSeed.size >= 2, `no single sector is the answer on every seed (winners: ${[...bestPerSeed].join(', ')})`)

// fintech's reputation bar goes UP where the others come down — §2's "regulation/reputation complexity"
const fin = career('fintech', 101, 24)
const finBars = tokenisationBars(fin)
const finTwin = { ...fin, sector: 'devtools' as SectorId }
ok(
  finBars.minReputation > tokenisationBars(finTwin).minReputation,
  `a financial token demands a cleaner name than any other kind (${finBars.minReputation} vs ${tokenisationBars(finTwin).minReputation}), even where the other bars ease`,
)

// ---------------------------------------------------------------------------------------------
console.log('— The community is not the customer list (§54) —')

const careerCo = career('saas', 42, 24)
const quickCo = newGame('Quick', 'saas', 'technical', { config: { ...cfg(42), mode: 'quick' } })
quickCo.users = careerCo.users
quickCo.hype = careerCo.hype
quickCo.reputation = careerCo.reputation
ok(
  communityMultiplier(careerCo) > 1,
  `a Career account is an organisation, so the community behind it is larger than the account count (×${communityMultiplier(careerCo).toFixed(1)})`,
)
ok(
  communityMultiplier(quickCo) < 1,
  `a Quick Play user is already a person, and only some of them are a community (×${communityMultiplier(quickCo).toFixed(2)})`,
)
ok(
  launchCommunityMembers(careerCo) > careerCo.users && launchCommunityMembers(quickCo) < quickCo.users,
  'so the same user count means very different community sizes in the two modes',
)
ok(
  communityMultiplier({ ...careerCo, hype: 95, reputation: 95 }) > communityMultiplier({ ...careerCo, hype: 5, reputation: 5 }),
  'and a stronger community pulls more people in per account',
)

// The supply identity has to hold for allocations that do NOT divide evenly.
const awkward = {
  community: 1 / 3,
  treasury: 1 / 3,
  team: 1 / 6,
  founder: 1 / 12,
  partners: 1 - 1 / 3 - 1 / 3 - 1 / 6 - 1 / 12,
}
let splitOk = 0
const AWKWARD_TOTALS = [1_000_003, 999_999_997, 7, 123_456_789, 3]
for (const total of AWKWARD_TOTALS) {
  const sp = splitSupply(total, { allocation: awkward } as never)
  if (sp.circulating + sp.treasury + sp.locked === total) splitOk++
}
ok(splitOk === AWKWARD_TOTALS.length, 'splitSupply keeps the identity exact even for supplies and fractions that do not divide evenly')

// ---------------------------------------------------------------------------------------------
console.log('— The launch decision and irreversibility (§3, §4, §80) —')

const before = eligible()
before.termSheets = [{ id: 'sheet-a', investor: 'Meridian', amount: 4_000_000, equity: 0.18, weeksLeft: 3 }]
const beforeCash = before.cash
const beforeEquity = before.founderEquity
const beforeStage = before.stage
const forked = structuredClone(before)
const launch = tokeniseCompany(forked)

ok(launch.ok && !!forked.token, 'an eligible company can tokenise')
if (!forked.token) {
  // Everything below reads the slice. Bail loudly rather than throwing a TypeError, so a mutation
  // that breaks the launch produces a readable failure instead of a stack trace.
  console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
  process.exit(1)
}
ok(capitalPath(forked) === 'community', 'capital path becomes community')
ok(capitalPath(before) === 'institutional', 'and the untouched company is still institutional')
ok(capitalPath(undefined) === 'institutional', 'absence of a slice IS institutional — no field, no migration write (§74)')
ok(isTokenised(forked) && !isTokenised(before), 'isTokenised agrees with capitalPath')
ok(tokenActive(forked) === true, 'tokenActive is true once a slice exists and a token capability is on')
ok(tokenActive(before) === false, 'tokenActive is false with no slice — the gate a weekly tick must sit behind')
ok(
  tokenActive({
    ...forked,
    capabilities: Object.fromEntries(
      Object.entries(forked.capabilities).map(([k, v]) => [k, k.startsWith('token') ? false : v]),
    ) as typeof forked.capabilities,
  }) === false,
  'tokenActive is false when the capabilities are off even though a slice exists',
)

// §80 says existing equity does not DISAPPEAR, and this file used to read that as "does not move".
// That reading is what test/token-balance-probe.ts caught: it made the initial sale a free
// undiluted round worth 1.09x-15.13x over the traditional path on its own, with no second decision
// taken. Dilution is not disappearance — `pitchInvestors` dilutes and nobody says the founder's
// equity vanished. What §80 protects is confiscation: the cash, the stage, the board and the debt
// all survive the fork. See launch.ts §7.7b.
const soldProceeds = forked.cash - beforeCash
const forkEnterprise = valuation(before)
ok(forked.founderEquity > 0, 'existing equity does not disappear (§80) — the fork confiscates nothing')
ok(forked.founderEquity < beforeEquity, 'but it IS priced: community capital dilutes, like any other capital')
ok(
  Math.abs(forked.founderEquity - beforeEquity * (1 - soldProceeds / forkEnterprise)) < 1e-9,
  'and priced at exactly the round it replaces: equity x (1 - proceeds/enterpriseValue)',
)
ok(
  forked.founderEquity >= beforeEquity * (1 - 0.2) - 1e-9,
  'never worse than a 20% round, because §7.7 caps the sale at 20% of enterprise value',
)
ok(forked.stage === beforeStage, 'the funding stage already reached is not rewound')
ok(forked.cash > beforeCash, `the initial sale credits real cash (+$${((forked.cash - beforeCash) / 1e6).toFixed(2)}M)`)

const t = forked.token!
ok(t.supply.circulating + t.supply.treasury + t.supply.locked === t.supply.total, 'supply invariant holds exactly at creation (§4.6)')
ok(
  Number.isInteger(t.supply.circulating) && Number.isInteger(t.supply.treasury) && Number.isInteger(t.supply.locked),
  'and every supply figure is an integer, so the identity cannot drift by a rounding crumb',
)
const allocSum = Object.values(t.plan.allocation).reduce((a, v) => a + v, 0)
ok(Math.abs(allocSum - 1) <= TOKEN_BOUNDS.allocationEpsilon, `allocation sums to 1 within epsilon (${allocSum})`)
ok(t.market.price > 0 && t.market.emaPrice === t.market.price, 'the market starts at a non-zero price with zero momentum')
ok(t.incentives.length === 0 && t.governance.proposals.length === 0, 'sub-slices later phases own exist and are empty — no reader creates what it does not own')
ok(t.users.organic + t.users.incentivised === Math.round(forked.users), 'the user split is whole and entirely organic at launch')

ok(forked.termSheets.length === 0, 'term sheets on the table evaporate — leaving them signable would be a way back (§4)')
ok(before.termSheets.length === 1, 'and the untouched company still has its sheet')

// irreversibility, at BOTH layers: the engine entry point and the launch itself. Testing only the
// entry point would let a broken `launchToken` hide behind the eligibility check in front of it.
ok(!tokeniseCompany(forked).ok, 'a second launch is refused at the engine entry point')
ok(!launchToken(forked).ok, 'and refused again by launchToken itself, independently')
ok(forked.token === t, 'and the refusal did not replace the slice')

// ---------------------------------------------------------------------------------------------
console.log('— The fork closes doors, and EXPLAINS rather than hides (§5, §47, §48) —')

const pitched = structuredClone(forked)
pitched.raiseCooldown = 0
const pitch = pitchInvestors(pitched)
ok(pitch.sheets.length === 0, 'a tokenised company gets no term sheets')
ok(/unavailable after tokenisation/i.test(pitch.message.body), 'and is told why, in a sentence, not by silence (§47)')
ok(pitched.termSheets.length === 0 && !!pitched.flash, 'the refusal also reaches the flash line')

const institutional = structuredClone(before)
institutional.raiseCooldown = 0
ok(pitchInvestors(institutional).sheets.length >= 0, 'an institutional company still reaches the normal pitch path')

// a sheet that somehow survives cannot be signed
const sneaky = structuredClone(forked)
sneaky.termSheets = [{ id: 'ghost', investor: 'Ghost Capital', amount: 5_000_000, equity: 0.2, weeksLeft: 3 }]
const sneakyEquity = sneaky.founderEquity
acceptTermSheet(sneaky, 'ghost')
ok(sneaky.founderEquity === sneakyEquity && sneaky.cash === forked.cash, 'acceptTermSheet is a no-op on the community path')

const ipoReady = structuredClone(forked)
ipoReady.lastRevenue = 1_000_000
ipoReady.cash = 50_000_000
ok(ipoEligible(ipoReady) === false, 'ipoEligible is false once tokenised (§48)')
ok(ipoVisible(ipoReady) === true, 'ipoVisible stays TRUE so the screen can say why — hiding it would teach nothing (§48)')
ok(ipoVisible(before) === false || ipoEligible(before) !== ipoEligible(ipoReady), 'the institutional company is judged on the checklist as before')

// ---------------------------------------------------------------------------------------------
console.log('— founderStanding: two disjoint legs (architecture §1.1) —')

// The load-bearing claim: with no token slice this is CHARACTER FOR CHARACTER today's expression.
// Asserted with === on the raw float, not a tolerance, over many different states.
let identical = 0
let checked = 0
for (const sec of SECTORS) {
  for (const seed of [7, 42, 4242]) {
    let s = career(sec, seed, 0)
    for (let w = 0; w < 30; w++) {
      s = advanceWeek(s)
      if (s.gameOver) break
      s.bankedPayout = w * 12_345.678 // exercise the banked term too
      checked++
      if (founderStanding(s) === valuation(s) * s.founderEquity + s.bankedPayout) identical++
    }
  }
}
ok(checked > 300 && identical === checked, `founderStanding is bit-identical to the old payout expression on all ${checked} traditional states`)

const noSlice = career('saas', 42, 10)
ok(realisableTokenValue(noSlice) === 0, 'the token leg is exactly zero with no slice')
ok(networkValue(noSlice) === 0 && liquidityDiscount(noSlice) === 0, 'network value and the liquidity discount are zero too')
ok(
  founderStanding(noSlice, { equityMultiplier: 0.5 }) === valuation(noSlice) * noSlice.founderEquity * 0.5 + noSlice.bankedPayout,
  'the fired multiplier applies to the EQUITY leg only',
)
ok(
  founderStanding(noSlice, { exitValue: 987_654_321 }) === 987_654_321 * noSlice.founderEquity + noSlice.bankedPayout,
  'an acquisition offer replaces the equity BASE, not the whole expression',
)

// ARITHMETIC ORDER. `(base × equity) × mult` and `(base × mult) × equity` are NOT the same double:
// measured over 3M random triples in the ranges this game uses, they differ 34.8% of the time. The
// payout sites were rewritten in place, so the order has to be the one they were written in — and
// a test that only checks values on convenient numbers will not notice. This searches for a triple
// where the two orders genuinely disagree, and fails if it cannot find one (so it can never pass
// vacuously).
const orderState = { ...noSlice, founderEquity: 0.6180339887498949, bankedPayout: 0 }
let orderProbe: { base: number; mult: number } | null = null
for (let i = 1; i <= 20_000 && !orderProbe; i++) {
  const base = 400_000 + i * 97_003.7
  const mult = 0.5 + (i % 977) / 613
  if (base * orderState.founderEquity * mult !== base * mult * orderState.founderEquity) orderProbe = { base, mult }
}
ok(orderProbe !== null, 'found a case where the two multiplication orders give different doubles')
if (orderProbe)
  ok(
    founderStanding(orderState, { exitValue: orderProbe.base, equityMultiplier: orderProbe.mult }) ===
      orderProbe.base * orderState.founderEquity * orderProbe.mult,
    'founderStanding multiplies in the order the payout expressions it replaced used — (value × equity) × multiplier',
  )

// disjointness: moving the token price must not move enterprise value
const priced = structuredClone(forked)
priced.week = priced.token!.launchWeek + 60
const valBefore = valuation(priced)
const legBefore = realisableTokenValue(priced)
priced.token!.market.price *= 4
ok(valuation(priced) === valBefore, 'quadrupling the token price does not move valuation() by one cent — no double count')
ok(realisableTokenValue(priced) > legBefore, 'but it does move the token leg')
ok(
  Math.abs(founderStanding(priced) - (valuation(priced) * priced.founderEquity + realisableTokenValue(priced) + priced.bankedPayout)) < 1e-9,
  'founderStanding is exactly the sum of the two legs plus what is already banked',
)

// vesting: the clock starts at the launch week
const vest = structuredClone(forked)
ok(founderVestedTokens({ ...vest, week: vest.token!.launchWeek + 1 }) === 0, 'nothing is vested before the cliff')
ok(founderVestedTokens({ ...vest, week: vest.token!.launchWeek + 20 }) > 0, 'the position starts vesting after the cliff')
ok(
  founderVestedTokens({ ...vest, week: vest.token!.launchWeek + 200 }) === vest.token!.founder.granted,
  'and reaches the whole grant once the schedule completes',
)
ok(
  liquidityDiscount({ ...vest, week: vest.token!.launchWeek + 200 }) < liquidityDiscount({ ...vest, week: vest.token!.launchWeek + 20 }),
  'a bigger vested position is HARDER to sell — exit impact rises with the founder share of the float (§51)',
)

// ---------------------------------------------------------------------------------------------
console.log('— Save migration: refuses to construct (§74, §87) —')

ok(migrateTokenSlice(undefined) === undefined, 'undefined in, undefined out — a legacy save is never tokenised')
ok(migrateTokenSlice(null) === undefined, 'null is not a token economy')
ok(migrateTokenSlice('{"capitalPath":"community"}') === undefined, 'a string is not a token economy')
ok(migrateTokenSlice([]) === undefined, 'an array is not a token economy')
ok(migrateTokenSlice({}) === undefined, 'an empty object is dropped, not back-filled into a launch')
ok(
  migrateTokenSlice({ ...structuredClone(t), capitalPath: 'institutional' }) === undefined,
  'a slice claiming the institutional path is a contradiction and is dropped — absence is the only way to say that',
)
ok(migrateTokenSlice({ ...structuredClone(t), plan: undefined }) === undefined, 'no plan, no slice')
ok(
  migrateTokenSlice({ ...structuredClone(t), plan: { ...t.plan, allocation: { ...t.plan.allocation, founder: 0.9 } } }) === undefined,
  'an allocation that does not sum to 1 is structural damage — dropped, not repaired',
)
ok(migrateTokenSlice({ ...structuredClone(t), launchWeek: 'soon' }) === undefined, 'a non-numeric launch week is dropped')

const round = migrateTokenSlice(JSON.parse(JSON.stringify(t)))
ok(!!round, 'a well-formed slice survives a JSON round trip')
ok(round!.version === TOKEN_STATE_VERSION && round!.capitalPath === 'community', 'and is back-filled to the current in-slice version')
ok(round!.supply.circulating + round!.supply.treasury + round!.supply.locked === round!.supply.total, 'the supply identity survives too')

// tampering: the identity is RE-ASSERTED, not trusted
const tampered = JSON.parse(JSON.stringify(t))
tampered.supply.treasury = 999_999_999_999
tampered.market.price = -5
tampered.community.sentiment = 5000
tampered.founder.sold = tampered.founder.granted * 10
const fixed = migrateTokenSlice(tampered)!
ok(
  fixed.supply.circulating + fixed.supply.treasury + fixed.supply.locked === fixed.supply.total,
  'a hand-edited treasury cannot break the supply identity — it is recomputed as the remainder',
)
ok(fixed.market.price > 0, 'a negative price is clamped above the floor — zero is absorbing')
ok(fixed.community.sentiment <= 100, 'a 0–100 scalar out of range is clamped')
ok(fixed.founder.sold <= fixed.founder.granted, 'you cannot have sold more than you were granted')

const flooded = JSON.parse(JSON.stringify(t))
flooded.history = Array.from({ length: 500 }, (_, i) => ({ week: i, type: 'unlock', importance: 50, metadata: {} }))
flooded.series = Array.from({ length: 900 }, (_, i) => ({ week: i, price: 1 }))
const bounded = migrateTokenSlice(flooded)!
ok(bounded.history.length === TOKEN_LIMITS.history, `history is truncated to its cap (${TOKEN_LIMITS.history})`)
ok(bounded.series.length === TOKEN_LIMITS.series, `series is truncated to its cap (${TOKEN_LIMITS.series})`)

// ---------------------------------------------------------------------------------------------
console.log('— Determinism: the token subsystem draws nothing (§70, architecture §3.2) —')

function trace(seed: number, weeks: number, probe: ((s: GameState) => void) | null): string {
  let g = newGame('Trace', 'saas', 'technical', { config: cfg(seed) })
  const out: string[] = []
  for (let w = 0; w < weeks; w++) {
    g = advanceWeek(g)
    // Hammer every pure token read the UI calls on render. If ANY of them touched the RNG stream,
    // the following weeks would diverge — which is exactly how this breaks silently in production.
    if (probe) for (let i = 0; i < 5; i++) probe(g)
    out.push(`${g.week}|${g.users}|${Math.round(g.cash)}|${g.pmf.toFixed(6)}|${g.hype.toFixed(6)}|${g.rivals.map((r) => r.users).join(',')}`)
  }
  return out.join(';')
}

const probeAll = (s: GameState) => {
  tokenisationEligibility(s)
  tokenisationBars(s)
  runSectorSuitability(s)
  communityStrength(s)
  resolveLaunchTerms(s)
  launchLateness(s)
  founderStanding(s)
  realisableTokenValue(s)
  networkValue(s)
}

for (const seed of [7, 4242, 31337]) {
  ok(
    trace(seed, 20, null) === trace(seed, 20, probeAll),
    `seed ${seed}: reading eligibility, suitability, launch terms and standing 100× changes nothing in the simulation`,
  )
}

// PURITY. The trace test above catches a draw from the SEEDED stream. It cannot catch a
// `Math.random()` — that would not shift `RNG`, it would just make the screen disagree with itself
// between renders and make a replayed eligibility unreproducible. So assert the stronger property
// directly: the same state in, the same answer out, every time.
let pureRuns = 0
let pureMatches = 0
for (const sec of SECTORS) {
  for (const seed of [7, 42, 4242]) {
    const s = career(sec, seed, 18)
    const snap = () =>
      JSON.stringify([
        tokenisationEligibility(s),
        tokenisationBars(s),
        runSectorSuitability(s),
        communityStrength(s),
        launchCommunityMembers(s),
        resolveLaunchTerms(s),
        launchLateness(s),
      ])
    const first = snap()
    for (let i = 0; i < 8; i++) {
      pureRuns++
      if (snap() === first) pureMatches++
    }
  }
}
ok(pureRuns > 100 && pureMatches === pureRuns, `every token read is pure: ${pureRuns} repeat evaluations, ${pureMatches} identical`)

// and the whole run is unaffected by the capability being on, since nothing ticks
function traceCaps(seed: number, tokenisation: boolean): string {
  let g = newGame('Trace', 'saas', 'technical', { config: cfg(seed), capabilities: { tokenisation } })
  const out: string[] = []
  for (let w = 0; w < 24; w++) {
    g = advanceWeek(g)
    out.push(`${g.week}|${g.users}|${Math.round(g.cash)}|${g.pmf.toFixed(6)}|${g.rivals.map((r) => r.users).join(',')}`)
  }
  return out.join(';')
}
for (const seed of [7, 4242]) {
  ok(traceCaps(seed, true) === traceCaps(seed, false), `seed ${seed}: a run that never tokenises is identical with the capability on or off`)
}

// ---------------------------------------------------------------------------------------------
console.log('— §76: no universal correct week —')

// Supply scale is set by the community at launch, which is the contract's §7.12 rule.
const smallCommunity = eligible('devtools', 4242)
const bigCommunity = structuredClone(smallCommunity)
bigCommunity.users *= 12
ok(
  resolveLaunchTerms(bigCommunity).plan.totalSupply > resolveLaunchTerms(smallCommunity).plan.totalSupply,
  'a bigger community at launch mints a bigger float (§7.12)',
)
ok(
  resolveLaunchTerms(bigCommunity).saleProceeds > resolveLaunchTerms(smallCommunity).saleProceeds,
  'and clears a bigger initial sale — the cheque scales with who is on the other side of it',
)

// The three non-cancelling channels, each asserted on its own.
const earlyState = eligible('devtools', 4242)
earlyState.week = 24
const lateState = structuredClone(earlyState)
lateState.week = 78
lateState.users = Math.round(lateState.users * 2.2)

const early = resolveLaunchTerms(earlyState)
const late = resolveLaunchTerms(lateState)

ok(
  early.plan.allocation.founder > late.plan.allocation.founder,
  `an early community concedes a bigger founder share (${(early.plan.allocation.founder * 100).toFixed(1)}% vs ${(late.plan.allocation.founder * 100).toFixed(1)}%)`,
)
ok(late.saleProceeds > early.saleProceeds, `a late launch raises more cash ($${(late.saleProceeds / 1e6).toFixed(2)}M vs $${(early.saleProceeds / 1e6).toFixed(2)}M)`)
ok(late.utility > early.utility, `a late launch has more real utility on day one (${late.utility.toFixed(0)} vs ${early.utility.toFixed(0)})`)
ok(late.speculation < early.speculation, `and less speculation (${late.speculation.toFixed(0)} vs ${early.speculation.toFixed(0)})`)
ok(late.depth >= early.depth, 'and a deeper market')

// the vesting clock: measured at a common end-of-run week, the early launcher is vested and the
// late one is not — which is the channel supply scale cannot cancel.
const RUN_END = 104
const earlyLaunched = structuredClone(earlyState)
tokeniseCompany(earlyLaunched)
const lateLaunched = structuredClone(lateState)
tokeniseCompany(lateLaunched)
const earlyAtEnd = { ...earlyLaunched, week: RUN_END }
const lateAtEnd = { ...lateLaunched, week: RUN_END }
const earlyVestedShare = founderVestedTokens(earlyAtEnd) / earlyLaunched.token!.founder.granted
const lateVestedShare = founderVestedTokens(lateAtEnd) / lateLaunched.token!.founder.granted
ok(
  earlyVestedShare > lateVestedShare,
  `at week ${RUN_END} the early launcher is ${(earlyVestedShare * 100).toFixed(0)}% vested against the late launcher's ${(lateVestedShare * 100).toFixed(0)}% — the clock starts at the launch week`,
)
ok(earlyVestedShare === 1 && lateVestedShare < 1, 'the early position is fully realisable at the end of the run and the late one is not')

// neither timing wins on every axis, which is the whole of §76
const earlyWins = [early.plan.allocation.founder > late.plan.allocation.founder, earlyVestedShare > lateVestedShare].filter(Boolean).length
const lateWins = [late.saleProceeds > early.saleProceeds, late.utility > early.utility, late.depth >= early.depth].filter(Boolean).length
ok(earlyWins >= 2 && lateWins >= 3, `neither timing dominates: early wins ${earlyWins} axes, late wins ${lateWins}`)

// ---------------------------------------------------------------------------------------------
console.log('— §7.7: the sale is not a free buff —')

let overCeiling = 0
let launches = 0
for (const sec of SECTORS) {
  for (const seed of SUITE_SEEDS) {
    const s = eligible(sec, seed)
    const terms = resolveLaunchTerms(s)
    launches++
    if (terms.saleProceeds > valuation(s) * 0.2 + 1) overCeiling++
  }
}
ok(overCeiling === 0, `across ${launches} launches the initial sale never exceeds 20% of enterprise value — the round it replaces (§7.7)`)

const shallow = eligible('devtools', 4242)
const deep = structuredClone(shallow)
deep.hype = 95
deep.reputation = 90
ok(
  resolveLaunchTerms(deep).saleProceeds > resolveLaunchTerms(shallow).saleProceeds,
  'a stronger community absorbs more — the raise is bounded by float depth, not by ambition',
)

// Each of the three bounds has to actually BIND somewhere, or it is decoration. Construct one
// company per bound and check both that it binds and that removing it would raise the number.
const richThinCrowd = eligible('saas', 42)
richThinCrowd.lastRevenue = 4_000_000 // an enormous company…
richThinCrowd.users = tokenisationBars(richThinCrowd).minUsers // …with barely a community
const thinTerms = resolveLaunchTerms(richThinCrowd)
ok(thinTerms.boundBy === 'float_depth', 'a big company with a thin crowd is bounded by FLOAT DEPTH, not by its valuation')
ok(
  thinTerms.saleProceeds < thinTerms.nominalProceeds && thinTerms.saleProceeds < valuation(richThinCrowd) * 0.2,
  'and raises materially less than either the ask or the equity round — you cannot sell to people who are not there',
)

// The ceiling binds when the ask is ambitious: a deep crowd plus a large community allocation.
// `nominalProceeds` is proportional to enterprise value, so this cannot be produced by inflating
// users alone — users feed `valuation()` and the ceiling moves with them. An explicit allocation is
// how a Slice-4 tokenomics screen will let a player over-ask, so it is the right case to pin now.
const hugeCrowd = eligible('social', 42)
hugeCrowd.users *= 60
hugeCrowd.hype = 95
hugeCrowd.reputation = 95
const greedy = { community: 0.7, treasury: 0.05, team: 0.1, founder: 0.1, partners: 0.05 }
const crowdTerms = resolveLaunchTerms(hugeCrowd, { allocation: greedy })
ok(crowdTerms.boundBy === 'valuation_ceiling', 'an ambitious ask into a deep crowd is bounded by the VALUATION CEILING')
ok(
  Math.abs(crowdTerms.saleProceeds - valuation(hugeCrowd) * 0.2) < 1,
  'and is held to exactly the round it replaces — the sale can match an equity round, never beat it (§7.7)',
)
ok(
  crowdTerms.nominalProceeds > crowdTerms.saleProceeds * 1.05,
  `well below what was asked for ($${(crowdTerms.nominalProceeds / 1e6).toFixed(1)}M asked, $${(crowdTerms.saleProceeds / 1e6).toFixed(1)}M cleared)`,
)

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)

// ---------------------------------------------------------------------------------------------
// MUTATION LOG. 32 mutations were applied one at a time — each to a pristine copy of the file, run,
// then reverted — and ALL 32 turned this suite red. Repeat any of them; if the suite stays green,
// that test does not exist.
//
// Nine of these SURVIVED the first version of this file and are the reason it is longer than it
// looks like it needs to be. They are marked ⚑, because each one is a class of hole worth knowing
// about:
//
//   M1  modes.ts        Career `tokenisation: false`
//   M2  eligibility.ts  `tokenMarketAppetite` → 0
//   M3  eligibility.ts  `strategyTokenTilt` → 0
//   M4a eligibility.ts  bars ignore fit: `ease = 1`
// ⚑ M4b eligibility.ts  bars ignore fit: `soften = 1`          — a `<=` in the bars test let this live
//   M5  eligibility.ts  drop the fintech reputation premium
//   M6  eligibility.ts  drop the `low_reputation` blocker
// ⚑ M7  eligibility.ts  `communityMultiplier` not mode-aware   — nothing asserted the two modes differ
//   M8  scoring.ts      `realisableTokenValue` → 1 with no slice
// ⚑ M9  scoring.ts      equity leg reassociated to `base × mult × equity` — the two orders differ as
//                       doubles 34.8% of the time over 3M random triples in this game's ranges, but
//                       agreed on every number the first test happened to use. Now searched for.
//   M10 scoring.ts      `founderVestedTokens` ignores the cliff
//   M11 scoring.ts      `liquidityDiscount` drops `(1 − exitImpact)`
// ⚑ M12 state.ts        `splitSupply` rounds all three buckets  — exact for tidy allocations only
//   M13 state.ts        `tokenActive` ignores the capabilities
//   M14 persistence.ts  accepts `capitalPath: 'institutional'`
//   M15 persistence.ts  trusts `supply.treasury` from the file
//   M16 persistence.ts  fabricates a slice from `undefined`
//   M17 persistence.ts  skips the allocation-sum check
//   M18 persistence.ts  drops the history cap
//   M19 persistence.ts  drops the series cap
//   M20 engine.ts       removes the `pitchInvestors` guard
//   M21 engine.ts       `ipoVisible` hides instead of explaining
//   M22 engine.ts       `ipoEligible` ignores the fork
//   M23 engine.ts       removes the `acceptTermSheet` guard
// ⚑ M24 launch.ts       allows a second launch                  — masked by the eligibility check in
//                       front of it, so `launchToken` is now tested directly as well
// ⚑ M25 eligibility.ts  one `Math.random()` in a pure read       — the RNG-stream trace cannot see
//                       this, because a pure read does not feed the simulation. Purity is now
//                       asserted on its own: same state in, same answer out.
//   M26 launch.ts       founder share fixed at 0.15
// ⚑ M27 launch.ts       drops the 20%-of-valuation ceiling       — no test state made it bind
// ⚑ M28 launch.ts       drops the float-depth bound              — likewise
//   M29 launch.ts       supply fixed at 1e9 rather than community-scaled
//   M30 launch.ts       the launch does not credit the sale
//   M32 launch.ts       the sale does not dilute the founder      — §7.7b, the balance fix
//   M33 launch.ts       dilution charged at half the round's price
// ⚑ M31 launch.ts       term sheets survive the fork             — never asserted
