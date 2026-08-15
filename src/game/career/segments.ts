// Customer segments and their hidden truth.
//
// Three segments per sector, deliberately different in economics rather than renamed copies
// of one template: an easy-to-reach, low-paying, high-churn end; a middle that retains; and a
// demanding, slow, high-value end. Which one is actually best is decided by the seed — the
// player has to find out.

import type { ProductFocus, SegmentId, SegmentTruth } from './types'

export interface SegmentDef {
  id: SegmentId
  name: string
  blurb: string
  /** Archetype values before per-campaign variance. 0–100. */
  base: Omit<SegmentTruth, 'salesCycleWeeks'> & { salesCycleWeeks: number }
  /** Product dimensions this segment actually cares about, most important first. */
  values: ProductFocus[]
}

const EASY = 'Cheap to reach, quick to try, quick to leave.'
const MIDDLE = 'Harder to win, but they stay and grow.'
const HARD = 'Slow, demanding, expensive to serve — and they pay like it.'

const SECTOR_SEGMENTS: Record<string, SegmentDef[]> = {
  saas: [
    {
      id: 'freelancers',
      name: 'Freelancers',
      blurb: EASY,
      base: {
        needIntensity: 58, willingnessToPay: 24, retentionPotential: 38, acquisitionAccessibility: 84,
        productRequirement: 30, marketSize: 78, competitiveIntensity: 62, salesCycleWeeks: 1, expansionPotential: 14,
      },
      values: ['simplicity', 'performance'],
    },
    {
      id: 'small_teams',
      name: 'Small Teams',
      blurb: MIDDLE,
      base: {
        needIntensity: 62, willingnessToPay: 55, retentionPotential: 72, acquisitionAccessibility: 55,
        productRequirement: 52, marketSize: 52, competitiveIntensity: 50, salesCycleWeeks: 3, expansionPotential: 58,
      },
      values: ['collaboration', 'reliability'],
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      blurb: HARD,
      base: {
        needIntensity: 55, willingnessToPay: 88, retentionPotential: 86, acquisitionAccessibility: 18,
        productRequirement: 82, marketSize: 22, competitiveIntensity: 44, salesCycleWeeks: 10, expansionPotential: 80,
      },
      values: ['enterprise_readiness', 'reliability'],
    },
  ],
  devtools: [
    {
      id: 'individual_devs',
      name: 'Individual Developers',
      blurb: 'They adopt in an afternoon, tell their friends, and pay almost nothing.',
      base: {
        needIntensity: 64, willingnessToPay: 20, retentionPotential: 42, acquisitionAccessibility: 88,
        productRequirement: 44, marketSize: 80, competitiveIntensity: 70, salesCycleWeeks: 1, expansionPotential: 12,
      },
      values: ['simplicity', 'performance'],
    },
    {
      id: 'startup_eng',
      name: 'Startup Engineering Teams',
      blurb: 'Fast to adopt for a team, and the workflow value compounds.',
      base: {
        needIntensity: 68, willingnessToPay: 52, retentionPotential: 70, acquisitionAccessibility: 58,
        productRequirement: 56, marketSize: 48, competitiveIntensity: 52, salesCycleWeeks: 3, expansionPotential: 62,
      },
      values: ['automation', 'collaboration'],
    },
    {
      id: 'enterprise_eng',
      name: 'Enterprise Engineering',
      blurb: 'Procurement, security review, and a contract worth the wait.',
      base: {
        needIntensity: 52, willingnessToPay: 90, retentionPotential: 88, acquisitionAccessibility: 16,
        productRequirement: 86, marketSize: 18, competitiveIntensity: 40, salesCycleWeeks: 12, expansionPotential: 82,
      },
      values: ['enterprise_readiness', 'reliability'],
    },
  ],
  ecommerce: [
    {
      id: 'individual_sellers',
      name: 'Individual Sellers',
      blurb: 'Thousands of them, tiny baskets, gone by spring.',
      base: {
        needIntensity: 60, willingnessToPay: 22, retentionPotential: 34, acquisitionAccessibility: 86,
        productRequirement: 28, marketSize: 84, competitiveIntensity: 66, salesCycleWeeks: 1, expansionPotential: 16,
      },
      values: ['simplicity', 'automation'],
    },
    {
      id: 'growing_brands',
      name: 'Growing Brands',
      blurb: 'Real order volume and a reason to keep paying you.',
      base: {
        needIntensity: 66, willingnessToPay: 58, retentionPotential: 70, acquisitionAccessibility: 50,
        productRequirement: 56, marketSize: 46, competitiveIntensity: 54, salesCycleWeeks: 4, expansionPotential: 66,
      },
      values: ['automation', 'reliability'],
    },
    {
      id: 'enterprise_retail',
      name: 'Enterprise Retailers',
      blurb: 'Integrations, SLAs, and one logo worth a hundred sellers.',
      base: {
        needIntensity: 50, willingnessToPay: 86, retentionPotential: 84, acquisitionAccessibility: 20,
        productRequirement: 84, marketSize: 20, competitiveIntensity: 42, salesCycleWeeks: 9, expansionPotential: 78,
      },
      values: ['enterprise_readiness', 'performance'],
    },
  ],
  fintech: [
    {
      id: 'consumers',
      name: 'Everyday Consumers',
      blurb: 'Easy to sign up, brutal to keep, and they trust nothing.',
      base: {
        needIntensity: 56, willingnessToPay: 26, retentionPotential: 40, acquisitionAccessibility: 82,
        productRequirement: 46, marketSize: 88, competitiveIntensity: 72, salesCycleWeeks: 1, expansionPotential: 20,
      },
      values: ['simplicity', 'reliability'],
    },
    {
      id: 'smb_finance',
      name: 'SMB Finance Teams',
      blurb: 'A real recurring workflow — and real switching cost once embedded.',
      base: {
        needIntensity: 70, willingnessToPay: 58, retentionPotential: 74, acquisitionAccessibility: 48,
        productRequirement: 62, marketSize: 44, competitiveIntensity: 48, salesCycleWeeks: 4, expansionPotential: 60,
      },
      values: ['reliability', 'automation'],
    },
    {
      id: 'regulated_institutions',
      name: 'Regulated Institutions',
      blurb: 'Compliance first, procurement second, product third.',
      base: {
        needIntensity: 48, willingnessToPay: 92, retentionPotential: 90, acquisitionAccessibility: 12,
        productRequirement: 90, marketSize: 14, competitiveIntensity: 36, salesCycleWeeks: 14, expansionPotential: 76,
      },
      values: ['enterprise_readiness', 'reliability'],
    },
  ],
  social: [
    {
      id: 'casual_users',
      name: 'Casual Users',
      blurb: 'They arrive in waves and leave just as fast.',
      base: {
        needIntensity: 44, willingnessToPay: 10, retentionPotential: 28, acquisitionAccessibility: 92,
        productRequirement: 34, marketSize: 94, competitiveIntensity: 76, salesCycleWeeks: 1, expansionPotential: 10,
      },
      values: ['simplicity', 'performance'],
    },
    {
      id: 'creators',
      name: 'Creators',
      blurb: 'Small in number, loud in reach — they bring their audience.',
      base: {
        needIntensity: 72, willingnessToPay: 44, retentionPotential: 66, acquisitionAccessibility: 52,
        productRequirement: 58, marketSize: 40, competitiveIntensity: 58, salesCycleWeeks: 2, expansionPotential: 56,
      },
      values: ['collaboration', 'performance'],
    },
    {
      id: 'brand_advertisers',
      name: 'Brand Advertisers',
      blurb: 'They pay properly, but only once you have an audience worth buying.',
      base: {
        needIntensity: 46, willingnessToPay: 84, retentionPotential: 78, acquisitionAccessibility: 22,
        productRequirement: 76, marketSize: 16, competitiveIntensity: 46, salesCycleWeeks: 8, expansionPotential: 74,
      },
      values: ['enterprise_readiness', 'automation'],
    },
  ],
  aiml: [
    {
      id: 'indie_hackers',
      name: 'Indie AI Hackers',
      blurb: 'They sign up with an API key at 2am; the side project dies by June.',
      base: {
        needIntensity: 62, willingnessToPay: 22, retentionPotential: 36, acquisitionAccessibility: 86,
        productRequirement: 36, marketSize: 80, competitiveIntensity: 68, salesCycleWeeks: 1, expansionPotential: 14,
      },
      values: ['simplicity', 'performance'],
    },
    {
      id: 'ai_startups',
      name: 'AI Product Startups',
      blurb: 'Funded, in a hurry, and their bill grows with their traction.',
      base: {
        needIntensity: 72, willingnessToPay: 56, retentionPotential: 68, acquisitionAccessibility: 52,
        productRequirement: 58, marketSize: 46, competitiveIntensity: 60, salesCycleWeeks: 3, expansionPotential: 70,
      },
      values: ['performance', 'reliability'],
    },
    {
      id: 'enterprise_ml',
      name: 'Enterprise ML Platforms',
      blurb: 'Security review, procurement, a proof of concept — then a contract that pays for the cluster.',
      base: {
        needIntensity: 54, willingnessToPay: 90, retentionPotential: 88, acquisitionAccessibility: 16,
        productRequirement: 86, marketSize: 18, competitiveIntensity: 42, salesCycleWeeks: 11, expansionPotential: 82,
      },
      values: ['enterprise_readiness', 'performance'],
    },
  ],
}

export function segmentsForSector(sector: string): SegmentDef[] {
  return SECTOR_SEGMENTS[sector] ?? SECTOR_SEGMENTS.saas
}

export function segmentDef(sector: string, id: SegmentId): SegmentDef {
  return segmentsForSector(sector).find((s) => s.id === id) ?? segmentsForSector(sector)[0]
}

// ---------- deterministic truth ----------

/** Small self-contained PRNG so this module never depends on the engine's global RNG hook. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v))

/**
 * The market's reality for one segment. Derived only from (seed, sector, scenario, segmentId),
 * so it is stable for the whole campaign and identical for the same seed. It is NEVER
 * regenerated — not by research, not by a pivot, not by reloading. That persistence is the
 * point: the market exists independently of what the player believes about it.
 */
export function generateSegmentTruth(seed: number, sector: string, scenario: string | undefined, segmentId: SegmentId): SegmentTruth {
  const def = segmentDef(sector, segmentId)
  const rnd = prng(hashString(`${seed}|${sector}|${scenario ?? 'standard'}|${segmentId}`))
  // Wide enough that a campaign can genuinely surprise you: an unusually strong freelancer
  // market, or an enterprise segment that simply is not there.
  const vary = (base: number, spread: number) => clamp(Math.round(base + (rnd() * 2 - 1) * spread))
  return {
    needIntensity: vary(def.base.needIntensity, 24),
    willingnessToPay: vary(def.base.willingnessToPay, 18),
    retentionPotential: vary(def.base.retentionPotential, 20),
    acquisitionAccessibility: vary(def.base.acquisitionAccessibility, 14),
    productRequirement: vary(def.base.productRequirement, 14),
    marketSize: vary(def.base.marketSize, 16),
    competitiveIntensity: vary(def.base.competitiveIntensity, 20),
    salesCycleWeeks: Math.max(1, Math.round(def.base.salesCycleWeeks * (0.7 + rnd() * 0.7))),
    expansionPotential: vary(def.base.expansionPotential, 18),
  }
}

export function generateAllTruth(seed: number, sector: string, scenario: string | undefined): Record<SegmentId, SegmentTruth> {
  const out: Record<SegmentId, SegmentTruth> = {}
  for (const def of segmentsForSector(sector)) out[def.id] = generateSegmentTruth(seed, sector, scenario, def.id)
  return out
}

/** How many customers this segment could ever hold, from its share of the sector's TAM. */
export function segmentCeiling(truth: SegmentTruth, sectorTam: number): number {
  return Math.max(200, Math.round((sectorTam * truth.marketSize) / 100 / 2.2))
}
