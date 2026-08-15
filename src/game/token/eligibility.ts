// Tokenisation — eligibility and sector suitability. Slice 1 of docs/ico-implementation-plan.md.
//
// Brief §1 and §2. Two rules shape everything in this file:
//
//   §1  "Do not expose readiness as an exact hidden optimisation score." The player sees BLOCKERS
//       — sentences with this run's own numbers in them. `readinessScore` exists so bots and tests
//       have something monotone to assert on; the UI shows the list, never the number.
//
//   §2  "Do not hardcode one correct answer. Seed/scenario/company strategy should matter."
//       So sector is a DISPOSITION, not a verdict. `sectorSuitability(sector)` is the base
//       disposition; `runSectorSuitability(s)` is what this company, on this seed, actually faces,
//       and it moves by up to two rungs. A B2B SaaS company with a hype-led, low-priced,
//       well-researched product on a warm seed can be more token-suited than a devtools company
//       that priced premium into an enterprise-readiness roadmap on a cold one.
//
// DETERMINISM. Nothing here draws from the RNG stream. The per-run "appetite" term is a pure hash
// of (config.seed, sector) — a seeded VALUE, not a seeded DRAW. That distinction is the whole
// reason this file cannot shift the stream for daily challenges, Arena or the golden traces:
// calling `tokenisationEligibility` a thousand times changes nothing.

import { hasCapability } from '../modes'
import type { GameState, SectorId } from '../types'
import type {
  SectorSuitability,
  TokenisationBlocker,
  TokenisationBlockerId,
  TokenisationEligibility,
} from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

// ---------- sector disposition (§2) ----------

/**
 * The sector's BASE disposition toward a token, before this run's seed and this company's
 * strategy are considered. Brief §2's table, mapped onto the five sectors the game has.
 *
 * This is never a gate. A `low` sector can tokenise and win; it just has to prove more first and
 * clears a smaller network at launch. `medium_high` is AI/ML's rung — well-suited, never the
 * natural best — matching §2's tier below the community-native sectors.
 */
export function sectorSuitability(sector: SectorId): SectorSuitability {
  switch (sector) {
    case 'devtools':
      // Developer ecosystem, open source, real protocol/network potential.
      return 'high'
    case 'social':
      // Community effects, user ownership, network participation.
      return 'high'
    case 'fintech':
      // Native financial mechanics — and the regulator reads the whitepaper too.
      return 'high_risk'
    case 'ecommerce':
      // Loyalty and community are real; the core utility is usually thinner.
      return 'medium'
    case 'saas':
      // Traditional enterprise economics genuinely fit better.
      return 'low'
    case 'aiml':
      // Compute-credit tokens are a real pattern and the developer audience is there — but the
      // customers are enterprises buying capacity, not a community seeking ownership. Good, never
      // the natural best: below devtools/social, above everything institutional.
      return 'medium_high'
  }
}

/** How much of a head start the base disposition is worth, 0–1. */
const SUITABILITY_WEIGHT: Record<SectorSuitability, number> = {
  high: 0.78,
  high_risk: 0.66,
  medium_high: 0.58,
  medium: 0.46,
  low: 0.3,
}

// ---------- the seed's own appetite (§2: "seed/scenario should matter") ----------

/**
 * −1 … +1. How warm this particular world is to this particular sector's tokens.
 *
 * A pure hash of (seed, sector, scenario) — deliberately NOT an RNG draw. The token subsystem must
 * be able to answer "how suitable is this?" on any frame, in any screen, without touching the
 * stream that the golden traces, the daily challenge and Arena replays all depend on.
 */
export function tokenMarketAppetite(s: GameState): number {
  const seed = s.config?.seed ?? 0
  const key = `${seed}|${s.sector}|${s.scenario ?? ''}`
  let h = 2166136261 >>> 0
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  // 0…1 → −1…1, quantised to hundredths so it is stable to read and to print.
  return Math.round(((h >>> 8) / 0xffffff) * 200 - 100) / 100
}

// ---------- what the company itself did (§2: "company strategy should matter") ----------

/**
 * −0.2 … +0.2. The strategy tilt: choices the founder actually made, not facts about the sector.
 *
 * Career reads the pricing and product-focus decisions directly. Every mode reads the hype/
 * reputation balance, accumulated research and ecosystem breadth, because those exist everywhere.
 */
export function strategyTokenTilt(s: GameState): number {
  let tilt = 0

  const career = s.career
  if (career) {
    // Price low and you built a broad base that a token can mobilise; price premium and you built
    // an account list that would rather have a contract.
    tilt += career.pricing === 'low' ? 0.1 : career.pricing === 'market' ? 0.03 : -0.07
    const FOCUS_TILT: Record<string, number> = {
      collaboration: 0.08,
      simplicity: 0.04,
      automation: 0.02,
      performance: 0,
      reliability: -0.02,
      enterprise_readiness: -0.1,
    }
    tilt += FOCUS_TILT[career.focus] ?? 0
  } else {
    // No segment model: the allocation slider is the strategy statement available.
    const a = s.allocation
    const spread = (a.research ?? 0) / 100
    tilt += spread * 0.08 - ((a.bugs ?? 0) / 100) * 0.02
  }

  // A hype-led company has an audience; a quietly respectable one has customers.
  tilt += ((s.hype - s.reputation) / 100) * 0.06
  // Research is how well you understand the people you are about to hand ownership to.
  tilt += clamp01(s.totalResearch / 200) * 0.06
  // Launched product lines are ecosystem surface a token can sit across.
  tilt += Math.min(0.06, s.ventures.filter((v) => v.launched).length * 0.03)

  return clamp(tilt, -0.2, 0.2)
}

/**
 * 0–1. Everything above, resolved: base disposition + this seed's appetite + what you built.
 * This is the number the bars and the launch terms are actually drawn against.
 */
export function tokenFit(s: GameState): number {
  const base = SUITABILITY_WEIGHT[sectorSuitability(s.sector)]
  return clamp01(base + strategyTokenTilt(s) + tokenMarketAppetite(s) * 0.14)
}

/**
 * The suitability the player is actually facing, which is what the UI should show. Two companies
 * in the same sector on different seeds can sit two rungs apart — that is §2 working rather than
 * being decorative.
 */
export function runSectorSuitability(s: GameState): SectorSuitability {
  const fit = tokenFit(s)
  // Fintech keeps its character: where it works at all it is the high-upside/high-scrutiny path,
  // never a placid "high". Below that it reads like any other middling fit — the scrutiny premium
  // attaches to a token that would actually matter, and the label has to be able to move or §2's
  // "seed and strategy should matter" would be false for one whole sector.
  if (s.sector === 'fintech' && fit >= 0.68) return 'high_risk'
  if (fit >= 0.7) return 'high'
  if (fit >= 0.55) return 'medium_high'
  if (fit >= 0.4) return 'medium'
  return 'low'
}

export const SUITABILITY_LABEL: Record<SectorSuitability, string> = {
  high: 'High',
  high_risk: 'High upside · high risk',
  medium_high: 'Medium-high',
  medium: 'Medium',
  low: 'Low',
}

// ---------- community (§1 "minimum community strength", §54 community ≠ customers) ----------

/**
 * 0–1 weekly retention, read from wherever this mode actually measures it.
 *
 * Career measures it for real, per segment, off the cohorts. Quick Play has no cohorts, so the
 * best available read is the product itself — deliberately a PROXY and named as one, rather than
 * a second retention model that would drift from the first.
 */
export function retentionRead(s: GameState): number {
  const career = s.career
  if (career) {
    const primary = career.retentionBySegment[career.primaryTargetSegmentId]
    if (primary !== undefined && primary > 0) return clamp01(primary)
    const vals = Object.values(career.retentionBySegment).filter((v) => v > 0)
    if (vals.length) return clamp01(vals.reduce((a, v) => a + v, 0) / vals.length)
    return 0
  }
  const product = clamp(s.features * 0.5 + s.quality * 0.5 - s.bugs * 0.6, 0, 100)
  return clamp01(0.3 + s.pmf / 320 + product / 500)
}

/**
 * 0–100. How much of a COMMUNITY this company has, as opposed to a customer list (§54).
 * Attention (hype), standing (reputation), stickiness (retention) and understanding (research).
 *
 * Weighted so the player has leverage. Measured over 12 seeds × 5 sectors, a Career run that is
 * merely alive sits at 33–43 here, because hype parks around 45 and reputation around 10–23 unless
 * you do something about them. Reputation and research together carry 42% of the score precisely
 * because they are the two a founder moves on purpose: closing rounds, hitting milestones and
 * running real customer research take an idle 34 to roughly 60.
 */
export function communityStrength(s: GameState): number {
  return clamp(
    s.hype * 0.3 + s.reputation * 0.3 + retentionRead(s) * 100 * 0.28 + clamp01(s.totalResearch / 180) * 100 * 0.12,
    0,
    100,
  )
}

/**
 * How many PEOPLE stand behind each unit of `s.users` — and the two modes count `s.users` in
 * different units, which is why this is not one number.
 *
 * `types.ts` says it outright: Career "counts named, retained accounts in the hundreds where Quick
 * Play counts raw users in the tens of thousands". A Career account is an ORGANISATION. The people
 * who would turn up for a token launch are its seats, its developers, and the audience around
 * them, so the multiplier there is well above one. Quick Play's users are already individuals, and
 * only a fraction of any user base is a community, so the multiplier there is below one.
 *
 * Getting this wrong is not cosmetic: it sets the minted supply and the depth of the initial sale.
 * Treating 330 Career accounts as 20 community members made every launch clear for a few thousand
 * dollars, which is how this was found.
 */
export function communityMultiplier(s: GameState): number {
  const strength = communityStrength(s) / 100
  if (s.career) return 3 + 22 * strength
  return 0.12 + 0.48 * strength
}

/**
 * How many people would actually show up for a token, as opposed to paying an invoice.
 * Brief §54: the community and the customer list are not the same population.
 */
export function launchCommunityMembers(s: GameState): number {
  return Math.max(0, Math.round(s.users * communityMultiplier(s)))
}

// ---------- the bars ----------

/**
 * The unmodulated requirements. Every one of them is moved by `tokenFit` before it is applied —
 * these are the middle of the range, not the answer.
 *
 * Calibrated against measured Career distributions (12 seeds × 5 sectors × weeks 24/40/60/80,
 * played passively): hype p50 44–48, reputation p50 10–23, community strength p50 34–39, PMF p50
 * 49–56, 4-week retention p50 61–67%, users p50 333 (saas) to 7,518 (social). The bars sit at or
 * just above that passive median so that merely surviving is not a token launch, and clearly below
 * what an engaged run reaches, so it is not a wall. Reputation was originally set at 38 and made
 * the whole feature unreachable — no passive run in any sector reached even p90 of that.
 */
const BASE_BARS = {
  minWeek: 16,
  minPmf: 55,
  minRetention: 0.55,
  minCommunityStrength: 40,
  minReputation: 22,
  /** Career counts named accounts in the hundreds. */
  careerUserFloor: 220,
  /** Quick Play counts raw users against a sector TAM that spans 250k → 60M, so its floor is a
   *  share of that market rather than an absolute count. */
  quickTamShare: 0.0035,
} as const

/** Sector TAMs, duplicated deliberately: importing `data.ts` here would drag the whole content
 *  module into a pure predicate. Kept in one place and asserted against `data.ts` in the tests
 *  (exported for exactly that assertion — test/token-fork.test.ts). */
export const SECTOR_TAM: Record<SectorId, number> = {
  saas: 250_000,
  social: 60_000_000,
  fintech: 3_000_000,
  devtools: 900_000,
  ecommerce: 8_000_000,
  aiml: 1_400_000,
}

export interface TokenisationBars {
  minWeek: number
  minUsers: number
  minPmf: number
  minRetention: number
  minCommunityStrength: number
  minReputation: number
  /** 0–1, the resolved suitability this run is being judged against. */
  fit: number
  suitability: SectorSuitability
}

/**
 * The requirements this run actually faces. High fit lowers every bar by up to 25% and raises no
 * bar; low fit raises them.
 */
export function tokenisationBars(s: GameState): TokenisationBars {
  const fit = tokenFit(s)
  const suitability = runSectorSuitability(s)
  const ease = 1.25 - 0.5 * fit // fit 1 → 0.75, fit 0 → 1.25
  const soften = 0.85 + 0.3 * (1 - fit) // fit 1 → 0.85, fit 0 → 1.15
  const userBase = s.career ? BASE_BARS.careerUserFloor : SECTOR_TAM[s.sector] * BASE_BARS.quickTamShare
  return {
    minWeek: Math.round(BASE_BARS.minWeek * ease),
    minUsers: Math.max(1, Math.round(userBase * ease)),
    minPmf: Math.round(BASE_BARS.minPmf * soften),
    minRetention: Math.round(BASE_BARS.minRetention * (0.9 + 0.2 * (1 - fit)) * 1000) / 1000,
    minCommunityStrength: Math.round(BASE_BARS.minCommunityStrength * soften),
    // The one bar that goes UP where the others come down: brief §2 singles out fintech for
    // "regulation/reputation complexity", so a financial token is the one case where a shaky name
    // is disqualifying even when everything else lines up. Keyed on the SECTOR, not on the resolved
    // label — the regulator reads the whitepaper whether or not this cycle is warm.
    minReputation: Math.round(BASE_BARS.minReputation * soften) + (s.sector === 'fintech' ? 8 : 0),
    fit,
    suitability,
  }
}

// ---------- the answer ----------

const blocker = (id: TokenisationBlockerId, label: string, progress: number): TokenisationBlocker => ({
  id,
  label,
  progress: clamp01(progress),
})

/** Weights for `readinessScore`. Hard gates (capability, an S-1 in flight) are not scored — they
 *  are not things you get closer to, they are things that are true or false. */
const READINESS_WEIGHTS: Partial<Record<TokenisationBlockerId, number>> = {
  too_early: 1,
  too_few_users: 2,
  weak_pmf: 2,
  weak_retention: 1.5,
  weak_community: 2,
  low_reputation: 1,
}

/**
 * Brief §1. Readable feedback with this run's numbers already in it, plus a monotone score the UI
 * does not show.
 *
 * Pure. Reads state, writes nothing, draws nothing.
 */
export function tokenisationEligibility(s: GameState): TokenisationEligibility {
  const blockers: TokenisationBlocker[] = []

  if (!hasCapability(s, 'tokenisation'))
    blockers.push(blocker('capability_off', 'Tokenisation is not part of this mode.', 0))
  if (s.token) blockers.push(blocker('already_tokenised', `${s.companyName} already launched a token.`, 1))
  if (s.ipo)
    blockers.push(
      blocker('ipo_in_flight', 'You are mid-IPO. Finish or pull the offering before choosing another capital path.', 0),
    )

  const bars = tokenisationBars(s)
  const progress: Partial<Record<TokenisationBlockerId, number>> = {}

  progress.too_early = s.week / bars.minWeek
  if (s.week < bars.minWeek)
    blockers.push(
      blocker('too_early', `A longer track record — investors and holders want ${bars.minWeek} weeks, you have ${s.week}.`, progress.too_early),
    )

  progress.too_few_users = s.users / bars.minUsers
  if (s.users < bars.minUsers)
    blockers.push(
      blocker(
        'too_few_users',
        `A larger active base — ${bars.minUsers.toLocaleString()} needed, you have ${Math.round(s.users).toLocaleString()}.`,
        progress.too_few_users,
      ),
    )

  progress.weak_pmf = s.pmf / bars.minPmf
  if (s.pmf < bars.minPmf)
    blockers.push(blocker('weak_pmf', `Stronger product-market fit — ${bars.minPmf} needed, you are at ${Math.round(s.pmf)}.`, progress.weak_pmf))

  const retention = retentionRead(s)
  progress.weak_retention = retention / bars.minRetention
  if (retention < bars.minRetention)
    blockers.push(
      blocker(
        'weak_retention',
        `More consistent retention — ${Math.round(bars.minRetention * 100)}% needed, you are keeping ${Math.round(retention * 100)}%.`,
        progress.weak_retention,
      ),
    )

  const community = communityStrength(s)
  progress.weak_community = community / bars.minCommunityStrength
  if (community < bars.minCommunityStrength)
    blockers.push(
      blocker(
        'weak_community',
        `A larger, more engaged community — roughly ${launchCommunityMembers(s).toLocaleString()} people would show up today; the story needs more.`,
        progress.weak_community,
      ),
    )

  progress.low_reputation = s.reputation / bars.minReputation
  if (s.reputation < bars.minReputation)
    blockers.push(
      blocker(
        'low_reputation',
        bars.suitability === 'high_risk'
          ? `A cleaner reputation — a financial token gets read by regulators too. ${bars.minReputation} needed, you are at ${Math.round(s.reputation)}.`
          : `A better public standing — ${bars.minReputation} needed, you are at ${Math.round(s.reputation)}.`,
        progress.low_reputation,
      ),
    )

  let weighted = 0
  let total = 0
  for (const [id, weight] of Object.entries(READINESS_WEIGHTS) as [TokenisationBlockerId, number][]) {
    weighted += clamp01(progress[id] ?? 0) * weight
    total += weight
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    readinessScore: Math.round((weighted / total) * 100),
  }
}

/** Convenience for call sites that only need the verdict. */
export function canTokenise(s: GameState): boolean {
  return tokenisationEligibility(s).eligible
}
