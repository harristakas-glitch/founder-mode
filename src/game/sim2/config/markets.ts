// V2 market templates (spec §48-49; contract D3). Business models are DATA: each sector
// declares its product attributes and segment blueprints; init.ts turns a blueprint into truth
// by drawing inside the declared bands with the run's seeded rng — so every run's market is a
// little different, deterministically. No SaaS logic is hardcoded in the engine; adding an
// archetype is adding data here.

// BALANCE AUDIT (2026-08-25): every sector's MASS segment used to be authored 3-11x below
// the sector reference price (fintech consumers $0.8-2.5 vs $18). The 0.45 collection floor
// silently monetized them anyway, which made overpricing dominant, research worthless, and
// the informed "price to the estimate" move a trap (measured, six-lane audit). Mass-segment
// WTP now sits at ~1.2-2x under the reference so price is a real decision at baseline.
import type { SegmentAttributePreference } from '../types'

export interface Band {
  lo: number
  hi: number
}

export interface SegmentBlueprint {
  id: string
  name: string
  /** pool size band (customers) */
  size: Band
  /** share of pool in-market per year */
  activeRate: Band
  growthAnnual: Band
  adoptionMaturity: Band
  /** $/week reference willingness-to-pay */
  wtp: Band
  priceSensitivity: Band
  switchingFriction: Band
  /** weekly keep-rate band */
  retention: Band
  /** weekly expansion-revenue potential band (retained customers deepen) */
  expansion: Band
  /** 0..1 — how well paid channels reach them */
  paidAccess: number
  /** capacity-gated human sales motion required */
  salesLed: boolean
  brandImportance: number
  prefs: SegmentAttributePreference[]
}

export interface MarketTemplate {
  /** attribute id → label, in display order */
  attributes: { id: string; label: string; start: Band; ceiling: number; decayRate: number }[]
  /** how winner-take-all the category is (softmax temperature; lower = more extreme) */
  choiceTemperature: number
  /** ad-funded archetype: revenue per user compounds with network scale */
  adModel?: boolean
  /** per-new-customer onboarding cost (KYC/compliance) — regulated sectors pay to ACQUIRE,
   *  which is what keeps volume-at-any-price from being free (lever sweep, 2026-08-25) */
  onboardingCost?: number
  segments: SegmentBlueprint[]
}

const pref = (attributeId: string, importance: number, idealValue: number, minimumThreshold?: number): SegmentAttributePreference =>
  minimumThreshold === undefined
    ? { attributeId, importance, idealValue }
    : { attributeId, importance, idealValue, minimumThreshold, thresholdPenalty: 0.35 }

// The default digital-product attribute set (spec §11.1). Sectors pick and re-weight.
const CORE = { id: 'core', label: 'Core utility' }
const EASE = { id: 'ease', label: 'Ease of use' }
const RELY = { id: 'reliability', label: 'Reliability' }
const PERF = { id: 'performance', label: 'Performance' }
const SEC = { id: 'security', label: 'Security & trust' }
const INTEG = { id: 'integrations', label: 'Integrations' }
const SVC = { id: 'service', label: 'Serviceability' }
const NET = { id: 'network', label: 'Network value' }
const CONTENT = { id: 'content', label: 'Content quality' }

const attr = (a: { id: string; label: string }, start: Band, ceiling = 95, decayRate = 0.03) => ({ ...a, start, ceiling, decayRate })

export const MARKET_TEMPLATES: Record<string, MarketTemplate> = {
  saas: {
    attributes: [
      attr(CORE, { lo: 25, hi: 40 }),
      attr(EASE, { lo: 20, hi: 35 }),
      attr(RELY, { lo: 20, hi: 35 }),
      attr(SEC, { lo: 10, hi: 20 }),
      attr(INTEG, { lo: 5, hi: 15 }),
      attr(SVC, { lo: 10, hi: 20 }),
    ],
    choiceTemperature: 0.16,
    segments: [
      {
        id: 'freelancers',
        name: 'Freelancers',
        size: { lo: 220_000, hi: 340_000 },
        activeRate: { lo: 0.25, hi: 0.4 },
        growthAnnual: { lo: 0.05, hi: 0.15 },
        adoptionMaturity: { lo: 0.5, hi: 0.75 },
        wtp: { lo: 8, hi: 16 },
        priceSensitivity: { lo: 0.7, hi: 0.9 },
        switchingFriction: { lo: 0.1, hi: 0.25 },
        retention: { lo: 0.955, hi: 0.975 },
        expansion: { lo: 0.0002, hi: 0.001 },
        paidAccess: 0.85,
        salesLed: false,
        brandImportance: 0.25,
        // LEVER SWEEP (2026-08-26): ease+reliability+service put 0.65 weight on quality-fed
        // attributes, so the all-quality monoculture (features 5 / quality 80) beat balanced
        // play 1.27x at 12 seeds — same failure shape as the fintech consumers audit fix.
        // Freelancers now care first that the product DOES the job (core is features-fed).
        prefs: [pref('core', 0.45, 75), pref('ease', 0.3, 90), pref('reliability', 0.15, 70), pref('service', 0.1, 50)],
      },
      {
        id: 'small_teams',
        name: 'Small teams',
        size: { lo: 60_000, hi: 110_000 },
        activeRate: { lo: 0.2, hi: 0.35 },
        growthAnnual: { lo: 0.08, hi: 0.2 },
        adoptionMaturity: { lo: 0.4, hi: 0.65 },
        wtp: { lo: 14, hi: 26 },
        priceSensitivity: { lo: 0.5, hi: 0.7 },
        switchingFriction: { lo: 0.25, hi: 0.45 },
        retention: { lo: 0.965, hi: 0.985 },
        expansion: { lo: 0.001, hi: 0.003 },
        paidAccess: 0.7,
        salesLed: false,
        brandImportance: 0.35,
        prefs: [pref('core', 0.3, 80), pref('ease', 0.25, 80), pref('reliability', 0.2, 80), pref('integrations', 0.15, 65), pref('service', 0.1, 60)],
      },
      {
        id: 'mid_market',
        name: 'Mid-market',
        size: { lo: 12_000, hi: 24_000 },
        activeRate: { lo: 0.15, hi: 0.3 },
        growthAnnual: { lo: 0.06, hi: 0.16 },
        adoptionMaturity: { lo: 0.35, hi: 0.6 },
        wtp: { lo: 45, hi: 85 },
        priceSensitivity: { lo: 0.35, hi: 0.55 },
        switchingFriction: { lo: 0.45, hi: 0.65 },
        retention: { lo: 0.975, hi: 0.99 },
        expansion: { lo: 0.002, hi: 0.005 },
        paidAccess: 0.45,
        salesLed: true,
        brandImportance: 0.45,
        prefs: [
          pref('core', 0.25, 85),
          pref('reliability', 0.2, 85, 45),
          pref('security', 0.2, 75, 40),
          pref('integrations', 0.2, 75),
          pref('service', 0.15, 70),
        ],
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        size: { lo: 2_500, hi: 6_000 },
        activeRate: { lo: 0.1, hi: 0.22 },
        growthAnnual: { lo: 0.04, hi: 0.12 },
        adoptionMaturity: { lo: 0.3, hi: 0.55 },
        wtp: { lo: 160, hi: 320 },
        priceSensitivity: { lo: 0.15, hi: 0.35 },
        switchingFriction: { lo: 0.6, hi: 0.85 },
        retention: { lo: 0.982, hi: 0.995 },
        expansion: { lo: 0.003, hi: 0.007 },
        paidAccess: 0.15,
        salesLed: true,
        brandImportance: 0.55,
        prefs: [
          pref('core', 0.2, 85),
          pref('reliability', 0.2, 90, 55),
          pref('security', 0.3, 90, 60),
          pref('integrations', 0.15, 80, 40),
          pref('service', 0.15, 80),
        ],
      },
    ],
  },

  social: {
    adModel: true,
    attributes: [
      attr(CORE, { lo: 25, hi: 40 }),
      attr(EASE, { lo: 25, hi: 40 }),
      attr(NET, { lo: 5, hi: 12 }),
      attr(CONTENT, { lo: 15, hi: 30 }),
      attr(PERF, { lo: 20, hi: 35 }),
      attr(SEC, { lo: 10, hi: 20 }),
    ],
    choiceTemperature: 0.12,
    segments: [
      {
        id: 'casual_users',
        name: 'Casual users',
        size: { lo: 3_500_000, hi: 6_000_000 },
        activeRate: { lo: 0.3, hi: 0.5 },
        growthAnnual: { lo: 0.1, hi: 0.3 },
        adoptionMaturity: { lo: 0.6, hi: 0.85 },
        wtp: { lo: 0.8, hi: 1.8 },
        priceSensitivity: { lo: 0.85, hi: 0.97 },
        switchingFriction: { lo: 0.05, hi: 0.15 },
        retention: { lo: 0.9, hi: 0.945 },
        expansion: { lo: 0.0, hi: 0.0004 },
        paidAccess: 0.9,
        salesLed: false,
        brandImportance: 0.5,
        prefs: [pref('ease', 0.3, 95), pref('content', 0.3, 85), pref('network', 0.25, 80), pref('performance', 0.15, 75)],
      },
      {
        id: 'creators',
        name: 'Creators',
        size: { lo: 250_000, hi: 500_000 },
        activeRate: { lo: 0.25, hi: 0.45 },
        growthAnnual: { lo: 0.1, hi: 0.25 },
        adoptionMaturity: { lo: 0.45, hi: 0.7 },
        wtp: { lo: 3, hi: 9 },
        priceSensitivity: { lo: 0.55, hi: 0.75 },
        switchingFriction: { lo: 0.3, hi: 0.5 },
        retention: { lo: 0.955, hi: 0.98 },
        expansion: { lo: 0.001, hi: 0.003 },
        paidAccess: 0.75,
        salesLed: false,
        brandImportance: 0.45,
        prefs: [pref('core', 0.3, 85), pref('content', 0.25, 90), pref('network', 0.25, 85, 35), pref('performance', 0.2, 80)],
      },
      {
        id: 'brand_advertisers',
        name: 'Brand advertisers',
        size: { lo: 15_000, hi: 35_000 },
        activeRate: { lo: 0.15, hi: 0.3 },
        growthAnnual: { lo: 0.05, hi: 0.15 },
        adoptionMaturity: { lo: 0.3, hi: 0.55 },
        wtp: { lo: 90, hi: 200 },
        priceSensitivity: { lo: 0.25, hi: 0.45 },
        switchingFriction: { lo: 0.4, hi: 0.6 },
        retention: { lo: 0.975, hi: 0.99 },
        expansion: { lo: 0.002, hi: 0.006 },
        paidAccess: 0.35,
        salesLed: true,
        brandImportance: 0.6,
        prefs: [pref('network', 0.35, 90, 45), pref('content', 0.25, 80), pref('security', 0.2, 75, 40), pref('core', 0.2, 75)],
      },
    ],
  },

  fintech: {
    onboardingCost: 35,
    attributes: [
      attr(CORE, { lo: 25, hi: 40 }),
      attr(EASE, { lo: 20, hi: 35 }),
      attr(RELY, { lo: 20, hi: 35 }),
      attr(SEC, { lo: 15, hi: 25 }),
      attr(SVC, { lo: 10, hi: 20 }),
      attr(INTEG, { lo: 5, hi: 15 }),
    ],
    choiceTemperature: 0.18,
    segments: [
      {
        id: 'consumers',
        name: 'Consumers',
        size: { lo: 1_800_000, hi: 3_200_000 },
        activeRate: { lo: 0.2, hi: 0.4 },
        growthAnnual: { lo: 0.08, hi: 0.22 },
        adoptionMaturity: { lo: 0.5, hi: 0.75 },
        wtp: { lo: 8, hi: 16 },
        priceSensitivity: { lo: 0.8, hi: 0.95 },
        switchingFriction: { lo: 0.3, hi: 0.5 },
        retention: { lo: 0.93, hi: 0.965 },
        expansion: { lo: 0.0002, hi: 0.001 },
        paidAccess: 0.8,
        salesLed: false,
        brandImportance: 0.55,
        // AUDIT (2026-08-25): ease+security put 0.75 weight on quality-fed attributes — the
        // all-quality monoculture beat balanced play 29/3 on paired seeds. Core work matters now.
        prefs: [pref('core', 0.35, 75), pref('ease', 0.2, 85), pref('security', 0.2, 85, 40), pref('reliability', 0.15, 80), pref('integrations', 0.1, 60)],
      },
      {
        id: 'smb_finance',
        name: 'SMB finance',
        size: { lo: 90_000, hi: 170_000 },
        activeRate: { lo: 0.18, hi: 0.32 },
        growthAnnual: { lo: 0.07, hi: 0.18 },
        adoptionMaturity: { lo: 0.35, hi: 0.6 },
        wtp: { lo: 20, hi: 45 },
        priceSensitivity: { lo: 0.4, hi: 0.6 },
        switchingFriction: { lo: 0.5, hi: 0.7 },
        retention: { lo: 0.972, hi: 0.99 },
        expansion: { lo: 0.001, hi: 0.004 },
        paidAccess: 0.55,
        salesLed: true,
        brandImportance: 0.45,
        prefs: [pref('core', 0.3, 85), pref('security', 0.25, 85, 50), pref('reliability', 0.2, 90, 45), pref('integrations', 0.15, 70), pref('service', 0.1, 65)],
      },
      {
        id: 'regulated_institutions',
        name: 'Regulated institutions',
        size: { lo: 800, hi: 2_200 },
        activeRate: { lo: 0.08, hi: 0.18 },
        growthAnnual: { lo: 0.03, hi: 0.1 },
        adoptionMaturity: { lo: 0.25, hi: 0.45 },
        wtp: { lo: 400, hi: 900 },
        priceSensitivity: { lo: 0.1, hi: 0.25 },
        switchingFriction: { lo: 0.75, hi: 0.92 },
        retention: { lo: 0.988, hi: 0.997 },
        expansion: { lo: 0.003, hi: 0.008 },
        paidAccess: 0.08,
        salesLed: true,
        brandImportance: 0.65,
        prefs: [
          pref('security', 0.35, 95, 70),
          pref('reliability', 0.25, 95, 60),
          pref('service', 0.2, 85, 45),
          pref('core', 0.2, 80),
        ],
      },
    ],
  },

  devtools: {
    attributes: [
      attr(CORE, { lo: 25, hi: 40 }),
      attr(EASE, { lo: 15, hi: 30 }),
      attr(RELY, { lo: 20, hi: 35 }),
      attr(PERF, { lo: 20, hi: 35 }),
      attr(INTEG, { lo: 10, hi: 20 }),
      attr(SEC, { lo: 10, hi: 20 }),
      // AUDIT: enterprise_eng's service pref pointed at an attribute this template never
      // defined — productFit pinned it at 0 forever. The attribute exists now.
      attr(SVC, { lo: 10, hi: 20 }),
    ],
    choiceTemperature: 0.14,
    segments: [
      {
        id: 'individual_devs',
        name: 'Individual developers',
        size: { lo: 400_000, hi: 700_000 },
        activeRate: { lo: 0.25, hi: 0.45 },
        growthAnnual: { lo: 0.08, hi: 0.2 },
        adoptionMaturity: { lo: 0.55, hi: 0.8 },
        wtp: { lo: 8, hi: 18 },
        priceSensitivity: { lo: 0.75, hi: 0.92 },
        switchingFriction: { lo: 0.15, hi: 0.3 },
        retention: { lo: 0.95, hi: 0.975 },
        expansion: { lo: 0.0002, hi: 0.001 },
        paidAccess: 0.6,
        salesLed: false,
        brandImportance: 0.4,
        prefs: [pref('core', 0.35, 78), pref('performance', 0.25, 78), pref('ease', 0.2, 72), pref('reliability', 0.2, 75)],
      },
      {
        id: 'startup_eng',
        name: 'Startup engineering teams',
        size: { lo: 40_000, hi: 80_000 },
        activeRate: { lo: 0.2, hi: 0.38 },
        growthAnnual: { lo: 0.1, hi: 0.22 },
        adoptionMaturity: { lo: 0.45, hi: 0.7 },
        wtp: { lo: 18, hi: 38 },
        priceSensitivity: { lo: 0.45, hi: 0.65 },
        switchingFriction: { lo: 0.35, hi: 0.55 },
        retention: { lo: 0.968, hi: 0.988 },
        expansion: { lo: 0.001, hi: 0.004 },
        paidAccess: 0.55,
        salesLed: false,
        brandImportance: 0.4,
        prefs: [pref('core', 0.3, 80), pref('reliability', 0.25, 80, 40), pref('performance', 0.2, 78), pref('integrations', 0.25, 72)],
      },
      {
        id: 'enterprise_eng',
        name: 'Enterprise engineering',
        size: { lo: 3_000, hi: 7_000 },
        activeRate: { lo: 0.1, hi: 0.2 },
        growthAnnual: { lo: 0.05, hi: 0.12 },
        adoptionMaturity: { lo: 0.3, hi: 0.55 },
        wtp: { lo: 140, hi: 280 },
        priceSensitivity: { lo: 0.15, hi: 0.35 },
        switchingFriction: { lo: 0.6, hi: 0.85 },
        retention: { lo: 0.982, hi: 0.995 },
        expansion: { lo: 0.003, hi: 0.007 },
        paidAccess: 0.18,
        salesLed: true,
        brandImportance: 0.5,
        prefs: [
          pref('reliability', 0.25, 92, 55),
          pref('security', 0.3, 90, 60),
          pref('integrations', 0.2, 80, 40),
          pref('core', 0.15, 80),
          pref('service', 0.1, 75),
        ],
      },
    ],
  },

  ecommerce: {
    attributes: [
      attr(CORE, { lo: 25, hi: 40 }),
      attr(EASE, { lo: 20, hi: 35 }),
      attr(RELY, { lo: 20, hi: 35 }),
      attr(PERF, { lo: 15, hi: 30 }),
      attr(INTEG, { lo: 10, hi: 20 }),
      attr(SVC, { lo: 10, hi: 20 }),
    ],
    choiceTemperature: 0.15,
    segments: [
      {
        id: 'individual_sellers',
        name: 'Individual sellers',
        size: { lo: 500_000, hi: 900_000 },
        activeRate: { lo: 0.25, hi: 0.45 },
        growthAnnual: { lo: 0.08, hi: 0.2 },
        adoptionMaturity: { lo: 0.55, hi: 0.8 },
        wtp: { lo: 6, hi: 12 },
        priceSensitivity: { lo: 0.75, hi: 0.92 },
        switchingFriction: { lo: 0.2, hi: 0.35 },
        retention: { lo: 0.94, hi: 0.97 },
        expansion: { lo: 0.0004, hi: 0.0015 },
        paidAccess: 0.85,
        salesLed: false,
        brandImportance: 0.35,
        prefs: [pref('ease', 0.35, 90), pref('core', 0.3, 80), pref('reliability', 0.2, 80), pref('service', 0.15, 60)],
      },
      {
        id: 'growing_brands',
        name: 'Growing brands',
        size: { lo: 60_000, hi: 120_000 },
        activeRate: { lo: 0.2, hi: 0.35 },
        growthAnnual: { lo: 0.1, hi: 0.22 },
        adoptionMaturity: { lo: 0.4, hi: 0.65 },
        wtp: { lo: 25, hi: 55 },
        priceSensitivity: { lo: 0.4, hi: 0.6 },
        switchingFriction: { lo: 0.45, hi: 0.65 },
        retention: { lo: 0.97, hi: 0.988 },
        expansion: { lo: 0.002, hi: 0.005 },
        paidAccess: 0.6,
        salesLed: true,
        brandImportance: 0.45,
        prefs: [pref('core', 0.3, 85), pref('integrations', 0.25, 80, 35), pref('reliability', 0.2, 85, 45), pref('performance', 0.15, 75), pref('service', 0.1, 70)],
      },
      {
        id: 'enterprise_retail',
        name: 'Enterprise retail',
        size: { lo: 1_500, hi: 4_000 },
        activeRate: { lo: 0.08, hi: 0.18 },
        growthAnnual: { lo: 0.04, hi: 0.1 },
        adoptionMaturity: { lo: 0.3, hi: 0.5 },
        wtp: { lo: 250, hi: 550 },
        priceSensitivity: { lo: 0.12, hi: 0.3 },
        switchingFriction: { lo: 0.7, hi: 0.9 },
        retention: { lo: 0.985, hi: 0.996 },
        expansion: { lo: 0.003, hi: 0.008 },
        paidAccess: 0.12,
        salesLed: true,
        brandImportance: 0.55,
        prefs: [
          pref('reliability', 0.3, 95, 60),
          pref('performance', 0.2, 90, 50),
          pref('integrations', 0.2, 85, 45),
          pref('service', 0.15, 85),
          pref('core', 0.15, 80),
        ],
      },
    ],
  },

  aiml: {
    attributes: [
      attr(CORE, { lo: 25, hi: 40 }),
      attr(EASE, { lo: 15, hi: 30 }),
      attr(PERF, { lo: 20, hi: 35 }),
      attr(RELY, { lo: 15, hi: 30 }),
      attr(INTEG, { lo: 10, hi: 20 }),
      attr(SEC, { lo: 10, hi: 20 }),
    ],
    choiceTemperature: 0.13,
    segments: [
      {
        id: 'indie_hackers',
        name: 'Indie hackers',
        size: { lo: 250_000, hi: 450_000 },
        activeRate: { lo: 0.3, hi: 0.5 },
        growthAnnual: { lo: 0.15, hi: 0.35 },
        adoptionMaturity: { lo: 0.5, hi: 0.75 },
        wtp: { lo: 10, hi: 20 },
        priceSensitivity: { lo: 0.7, hi: 0.9 },
        switchingFriction: { lo: 0.1, hi: 0.25 },
        retention: { lo: 0.94, hi: 0.97 },
        expansion: { lo: 0.0004, hi: 0.0015 },
        paidAccess: 0.65,
        salesLed: false,
        brandImportance: 0.45,
        prefs: [pref('core', 0.35, 80), pref('performance', 0.25, 78), pref('ease', 0.25, 75), pref('reliability', 0.15, 70)],
      },
      {
        id: 'ai_startups',
        name: 'AI startups',
        size: { lo: 30_000, hi: 70_000 },
        activeRate: { lo: 0.25, hi: 0.45 },
        growthAnnual: { lo: 0.15, hi: 0.35 },
        adoptionMaturity: { lo: 0.4, hi: 0.65 },
        wtp: { lo: 25, hi: 60 },
        priceSensitivity: { lo: 0.4, hi: 0.6 },
        switchingFriction: { lo: 0.3, hi: 0.5 },
        retention: { lo: 0.96, hi: 0.985 },
        expansion: { lo: 0.002, hi: 0.006 },
        paidAccess: 0.55,
        salesLed: false,
        brandImportance: 0.45,
        prefs: [pref('performance', 0.3, 82, 40), pref('core', 0.3, 80), pref('integrations', 0.2, 75), pref('reliability', 0.2, 75)],
      },
      {
        id: 'enterprise_ml',
        name: 'Enterprise ML teams',
        size: { lo: 2_000, hi: 5_000 },
        activeRate: { lo: 0.1, hi: 0.22 },
        growthAnnual: { lo: 0.08, hi: 0.18 },
        adoptionMaturity: { lo: 0.25, hi: 0.5 },
        wtp: { lo: 200, hi: 450 },
        priceSensitivity: { lo: 0.12, hi: 0.3 },
        switchingFriction: { lo: 0.65, hi: 0.88 },
        retention: { lo: 0.984, hi: 0.996 },
        expansion: { lo: 0.004, hi: 0.009 },
        paidAccess: 0.15,
        salesLed: true,
        brandImportance: 0.5,
        prefs: [
          pref('security', 0.3, 92, 60),
          pref('performance', 0.2, 90, 50),
          pref('reliability', 0.2, 90, 50),
          pref('integrations', 0.15, 80),
          pref('core', 0.15, 85),
        ],
      },
    ],
  },
}


/** Sectors without a bespoke template borrow the SaaS shape — archetype data can land later
 *  without touching the engine (spec §49: strong generic digital model first). */
export const marketTemplate = (sector: string): MarketTemplate => MARKET_TEMPLATES[sector] ?? MARKET_TEMPLATES.saas
