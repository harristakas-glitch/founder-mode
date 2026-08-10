// Tokenisation — save migration. Slice 1.
//
// Brief §73/§74 and docs/ico-architecture.md §2.1. Follows `migrateLivingWorldSlice` exactly, and
// obeys three rules that are not negotiable:
//
//   1. `undefined` IN → `undefined` OUT. This function REFUSES TO CONSTRUCT. That refusal is the
//      whole of §74's "do not automatically tokenise any legacy saves": a save with no token slice
//      is a traditional run, absence is what `capitalPath: 'institutional'` means, and there is no
//      code path here that can turn one into the other.
//
//   2. A malformed slice is DROPPED, NOT REPAIRED. localStorage is user-writable and a half-valid
//      economy must not reach the price model. The cost of dropping is a run that reverts to the
//      institutional path — a legible outcome. The cost of repairing badly is a corrupted economy
//      nobody can debug.
//
//   3. A well-formed slice is back-filled to TOKEN_STATE_VERSION and RE-BOUNDED: arrays truncated
//      to TOKEN_LIMITS, 0–100 scalars clamped, counts finite and non-negative, and the supply
//      identity `circulating + treasury + locked === total` re-asserted exactly.
//
// No global persist version bump: TOKEN_STATE_VERSION handles in-slice shape changes, which is why
// it exists.
//
// Nothing here draws randomness, and nothing reads the clock.

import { isIncentiveCategory, shareFromTokens } from './incentives'
import {
  TOKEN_LIMITS,
  TOKEN_STATE_VERSION,
  type GovernanceProposal,
  type TokenAllocationPlan,
  type TokenHistoryEntry,
  type TokenIncentiveProgramme,
  type TokenSeriesPoint,
  type TokenState,
  type TokenUtilityModel,
  type VestingPolicy,
} from './types'
import { TOKEN_BOUNDS } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type Raw = Record<string, unknown>

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
/** A number that MUST be present and finite for the slice to be considered well-formed. */
const req = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const scalar100 = (v: unknown, fallback: number) => clamp(num(v, fallback), 0, 100)
const count = (v: unknown, fallback = 0) => Math.max(0, Math.round(num(v, fallback)))

const VESTING: VestingPolicy[] = ['short', 'standard', 'long']
const UTILITY_MODELS: TokenUtilityModel[] = ['product_access', 'rewards', 'governance', 'marketplace_currency', 'ecosystem_incentive']

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === 'string' && (allowed as string[]).includes(v) ? (v as T) : fallback
}

/**
 * The allocation is structural: if it does not add up, the supply split it produced is meaningless
 * and every downstream number is wrong. That is a DROP, not a clamp.
 */
function readAllocation(raw: unknown): TokenAllocationPlan | null {
  if (!isObj(raw)) return null
  const community = req(raw.community)
  const treasury = req(raw.treasury)
  const team = req(raw.team)
  const founder = req(raw.founder)
  const partners = req(raw.partners)
  if (community === null || treasury === null || team === null || founder === null || partners === null) return null
  const parts = [community, treasury, team, founder, partners]
  if (parts.some((p) => p < 0)) return null
  const sum = parts.reduce((a, p) => a + p, 0)
  if (Math.abs(sum - 1) > TOKEN_BOUNDS.allocationEpsilon) return null
  return { community, treasury, team, founder, partners }
}

function readHistory(raw: unknown): TokenHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: TokenHistoryEntry[] = []
  for (const e of raw) {
    if (!isObj(e)) continue
    const week = req(e.week)
    if (week === null || typeof e.type !== 'string') continue
    const metadata: Record<string, string | number> = {}
    if (isObj(e.metadata))
      for (const [k, v] of Object.entries(e.metadata))
        if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) metadata[k] = v
    out.push({ week, type: e.type as TokenHistoryEntry['type'], importance: scalar100(e.importance, 50), metadata })
  }
  // Newest kept: the cap is a byte budget, and the recent past is what the postmortem quotes.
  return out.slice(-TOKEN_LIMITS.history)
}

function readSeries(raw: unknown): TokenSeriesPoint[] {
  if (!Array.isArray(raw)) return []
  const out: TokenSeriesPoint[] = []
  for (const p of raw) {
    if (!isObj(p)) continue
    const week = req(p.week)
    if (week === null) continue
    out.push({
      week,
      price: Math.max(0, num(p.price, 0)),
      circulating: count(p.circulating),
      treasuryTokens: count(p.treasuryTokens),
      utility: scalar100(p.utility, 0),
      speculation: scalar100(p.speculation, 0),
      sentiment: scalar100(p.sentiment, 50),
      organicUsers: count(p.organicUsers),
      incentivisedUsers: count(p.incentivisedUsers),
    })
  }
  return out.slice(-TOKEN_LIMITS.series)
}

function readProposals(raw: unknown): GovernanceProposal[] {
  if (!Array.isArray(raw)) return []
  const out: GovernanceProposal[] = []
  for (const p of raw) {
    if (!isObj(p)) continue
    const week = req(p.week)
    const closesWeek = req(p.closesWeek)
    if (week === null || closesWeek === null || typeof p.id !== 'string' || typeof p.type !== 'string') continue
    out.push({
      id: p.id,
      week,
      type: p.type as GovernanceProposal['type'],
      descriptionKey: typeof p.descriptionKey === 'string' ? p.descriptionKey : '',
      support: scalar100(p.support, 50),
      founderPosition: oneOf(p.founderPosition, ['support', 'oppose', 'neutral'], 'neutral'),
      closesWeek,
      status: oneOf(p.status, ['active', 'passed', 'rejected'], 'active'),
    })
  }
  return out.slice(-TOKEN_LIMITS.proposals)
}

/**
 * Slice 4. Programmes are re-bounded, de-duplicated and RE-NORMALISED, because `share` is a claim on
 * a single weekly budget and a file claiming 400% of it would hand the treasury cap to whoever
 * edited localStorage.
 *
 * A v1 save has `tokensPerWeek` and no `share`. Rather than dropping the programme (which would
 * silently stop a running campaign on reload) the share is re-derived from the standing order
 * against the current weekly cap, so the player keeps spending what they were spending.
 */
function readIncentives(raw: unknown, supply: TokenState['supply'], launchWeek: number): TokenIncentiveProgramme[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TokenIncentiveProgramme[] = []
  for (const p of raw) {
    if (!isObj(p) || !isIncentiveCategory(p.category) || seen.has(p.category)) continue
    seen.add(p.category)
    const tokensPerWeek = Math.max(0, num(p.tokensPerWeek, 0))
    const share =
      typeof p.share === 'number' && Number.isFinite(p.share)
        ? clamp(p.share, 0, 1)
        : shareFromTokens({ supply }, tokensPerWeek)
    out.push({
      category: p.category,
      share,
      tokensPerWeek,
      startedWeek: num(p.startedWeek, launchWeek),
      cumulativeTokens: Math.max(0, num(p.cumulativeTokens, 0)),
      effectiveness: clamp(num(p.effectiveness, 0), 0, 1),
    })
  }
  const kept = out.slice(0, TOKEN_LIMITS.incentives)
  const total = kept.reduce((a, p) => a + p.share, 0)
  if (total > 1) for (const p of kept) p.share = p.share / total
  return kept
}

/**
 * In-slice version migration, run on every load beside `migrateLivingWorldSlice`.
 *
 * Returns `undefined` for absent AND for unreadable — the caller assigns the result straight back,
 * so a dropped slice reverts the run to the institutional path rather than crashing it.
 */
export function migrateTokenSlice(raw: unknown): TokenState | undefined {
  if (!isObj(raw)) return undefined

  // --- structural gates: any of these failing means the slice is not a token economy ---
  // Absence IS institutional, so a slice claiming to be institutional is a contradiction and is
  // dropped rather than believed.
  if (raw.capitalPath !== 'community') return undefined

  const launchWeek = req(raw.launchWeek)
  if (launchWeek === null || launchWeek < 0) return undefined

  const planRaw = raw.plan
  if (!isObj(planRaw)) return undefined
  const allocation = readAllocation(planRaw.allocation)
  if (!allocation) return undefined
  const totalSupply = req(planRaw.totalSupply)
  const launchPrice = req(planRaw.launchPrice)
  if (totalSupply === null || totalSupply <= 0 || launchPrice === null || launchPrice <= 0) return undefined

  const supplyRaw = raw.supply
  if (!isObj(supplyRaw)) return undefined
  const marketRaw = raw.market
  if (!isObj(marketRaw)) return undefined

  // --- from here everything is recoverable: clamp, do not drop ---

  const total = Math.max(1, Math.round(num(supplyRaw.total, totalSupply)))
  let circulating = Math.min(total, count(supplyRaw.circulating))
  let locked = Math.min(total - circulating, count(supplyRaw.locked))
  // The identity is EXACT and integer. Whatever the file claimed the treasury was, it is the
  // remainder — that is the only assignment that cannot break it.
  const treasury = total - circulating - locked
  if (treasury < 0) {
    circulating = Math.min(total, circulating)
    locked = Math.max(0, total - circulating)
  }

  const price = Math.max(launchPrice * TOKEN_BOUNDS.priceFloorFraction, num(marketRaw.price, launchPrice))
  const communityRaw = isObj(raw.community) ? raw.community : {}
  const founderRaw = isObj(raw.founder) ? raw.founder : {}
  const governanceRaw = isObj(raw.governance) ? raw.governance : {}
  const usersRaw = isObj(raw.users) ? raw.users : {}

  const granted = count(founderRaw.granted)
  const sold = Math.min(granted, count(founderRaw.sold))

  const state: TokenState = {
    version: TOKEN_STATE_VERSION,
    capitalPath: 'community',
    launchWeek,
    plan: {
      allocation,
      vesting: oneOf(planRaw.vesting, VESTING, 'standard'),
      utilityModel: oneOf(planRaw.utilityModel, UTILITY_MODELS, 'product_access'),
      initialDecentralisation: scalar100(planRaw.initialDecentralisation, 25),
      totalSupply: total,
      launchPrice,
    },
    supply: { total, circulating, treasury: Math.max(0, treasury), locked },
    market: {
      price,
      launchPrice,
      emaPrice: Math.max(launchPrice * TOKEN_BOUNDS.priceFloorFraction, num(marketRaw.emaPrice, price)),
      fairValue: Math.max(0, num(marketRaw.fairValue, price)),
      volatility: scalar100(marketRaw.volatility, 30),
      speculation: scalar100(marketRaw.speculation, 50),
      utility: scalar100(marketRaw.utility, 0),
      depth: clamp(num(marketRaw.depth, 0.2), 0, 1),
      lastDemand: num(marketRaw.lastDemand, 0),
      lastSupplyPressure: num(marketRaw.lastSupplyPressure, 0),
    },
    community: {
      members: count(communityRaw.members),
      holders: count(communityRaw.holders),
      sentiment: scalar100(communityRaw.sentiment, 50),
      trust: scalar100(communityRaw.trust, 50),
      engagement: scalar100(communityRaw.engagement, 50),
      decentralisationDemand: scalar100(communityRaw.decentralisationDemand, 20),
      decentralisation: scalar100(communityRaw.decentralisation, 25),
      founderInfluence: scalar100(communityRaw.founderInfluence, 75),
    },
    founder: {
      granted,
      vested: Math.min(granted - sold, count(founderRaw.vested)),
      sold,
      realisedProceeds: Math.max(0, num(founderRaw.realisedProceeds, 0)),
    },
    incentives: readIncentives(raw.incentives, { total, circulating, treasury: Math.max(0, treasury), locked }, launchWeek),
    treasurySales: {
      tokensSold: count((isObj(raw.treasurySales) ? raw.treasurySales : {}).tokensSold),
      proceeds: Math.max(0, num((isObj(raw.treasurySales) ? raw.treasurySales : {}).proceeds, 0)),
      lastSaleWeek: Math.max(0, num((isObj(raw.treasurySales) ? raw.treasurySales : {}).lastSaleWeek, 0)),
    },
    governance: {
      proposals: readProposals(governanceRaw.proposals),
      lastProposalWeek: num(governanceRaw.lastProposalWeek, launchWeek),
    },
    users: { organic: count(usersRaw.organic), incentivised: count(usersRaw.incentivised) },
    history: readHistory(raw.history),
    series: readSeries(raw.series),
    lastTickedWeek: typeof raw.lastTickedWeek === 'number' && Number.isFinite(raw.lastTickedWeek) ? raw.lastTickedWeek : undefined,
  }

  return state
}
