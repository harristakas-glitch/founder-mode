# Founder Mode — Career Phase 1: PMF Discovery 2.0

## Implementation status

**Shipped 7 August 2026** in commit `fea4ca7` ("Career Phase 1: PMF Discovery 2.0"), with the
type and segment modules landing in `5d47354`. All four test suites are green
(`npm test`) and `tsc -p tsconfig.app.json --noEmit` is clean.

**What works.** Career runs a genuinely different customer model behind
`hasCapability(state, 'detailedPMF')`. Fifteen segments (three per sector) each carry a hidden
`SegmentTruth` generated once from `(seed, sector, scenario, segmentId)` and never rerolled.
Beliefs are separate from truth and start wide, low-confidence and — for one metric per segment
— confidently wrong. Five experiments on a reliability ladder produce imperfect evidence that
updates belief Bayesian-ishly; interviews overstate willingness to pay by ~21 points while a
pricing test lands within ~3. Customers are tracked in cohorts with per-segment retention, and
PMF is *derived* from retention, payment and fit — research alone can never manufacture it.
Segment pivots cost a 2–6 week repositioning period and keep existing customers. Quick Play,
Daily Challenge and Arena are untouched and carry no Career state.

**Not implemented** (details in the annotations):

- **§23 Segment retention screen** — `retentionBySegment` is computed weekly; no screen renders it.
- **§32 Weekly Founder Briefing** — `career.lastBriefing` is computed weekly; no UI reads it, and
  its `revenueDeltaPct` is permanently 0.
- **§31 Causal explanations / §33 Biggest uncertainty** — computed into state, never rendered.
- **§36 Career Dashboard additions** — the Dashboard was not given Career panels.
- **§37 Market screen segment cards** — not built; Discovery covers the need.
- **§43 Rival `preferredSegmentId`** — rivals are unaware of segments.
- **§49 Segment expansion** — `expansionPotential` is a belief and an evidence metric only; it
  never touches revenue.
- **§28 Product and pricing pivots** — plain setters with a journal entry, not mechanics with a cost.
- **§14 Repositioning product penalty** — computed but inert: `engine.ts` discards the
  `productCapacityDrain` that carries it, so running experiments also costs no engineering time.
- **§35 Career onboarding** — one standing line on the Discovery screen; no staged hints, no
  Career steps in `src/Coach.tsx`.
- **§53 Headless bots** — the three strategies were written and run during development, but no
  harness was committed; the results survive only in the commit message.

Everything else in the brief is implemented, most of it verifiably in `test/career-pmf.test.ts`.

---


## Objective

Implement the first deep Career-mode system:

# PMF Discovery 2.0

Replace the simplified “hidden resonance + research + pivot reroll” model used in Quick Play with a deeper, segment-based product-market-fit simulation used only in Career.

The Career player should no longer ask:

> “How high is my PMF score?”

They should ask:

> “Who actually needs this product, how badly, why, what are they willing to pay, can I reach them, and will they stay?”

The player should:

1. Discover customer segments.
2. Form hypotheses.
3. Run experiments.
4. Receive imperfect evidence.
5. Select a target segment.
6. Make pricing/product/distribution decisions.
7. Observe real customer behaviour.
8. Learn from retention and cohorts.
9. Reposition or pivot when necessary.
10. Understand why PMF is or is not emerging.

This must be implemented **only for Career mode** through the capability architecture.

Quick Play and Arena must continue using their existing simpler PMF logic.

---

# Product principle

Career Mode should teach:

> Product-market fit is not a number you discover.

It is the emergent result of:

- Customer need
- Product usefulness
- Price
- Distribution
- Competition
- Retention
- Behaviour over time

Research creates **knowledge**.

Customers create **proof**.

The system must therefore distinguish between:

## What is true

The underlying market reality.

## What the player believes

Their current interpretation of the market.

## What the player has evidence for

The observations supporting or contradicting those beliefs.

---

# Architectural requirement

Use the mode/capability architecture from the previous task.

Career should resolve:

```ts
hasCapability(state, "detailedPMF") === true
```

Quick Play and Arena should resolve:

```ts
hasCapability(state, "detailedPMF") === false
```

Do not use scattered checks such as:

```ts
if (mode === "career")
```

unless the distinction is purely presentational.

Simulation behaviour should be capability-driven.

> **✅ Implemented** — `src/game/modes.ts` sets `detailedPMF: true` only in `CAREER_BASE_RULES`; `engine.ts` gates the whole subsystem on `can(s, 'detailedPMF')` (line ~1106), a thin `s.capabilities[k]` accessor. Presentation uses the same capability table (`hasCapability(game, 'hypothesisBoard')` filters the Discovery nav item in `src/App.tsx`). No `mode === 'career'` checks were added to simulation code.

---

# Scope

Implement:

1. Customer segments
2. Segment market truth
3. Player beliefs
4. Hypothesis Board
5. Research experiments
6. Evidence system
7. Primary target segment
8. Segment-specific product fit
9. Segment-specific acquisition
10. Customer cohorts
11. Segment-specific retention
12. Pricing fit
13. Derived PMF status
14. Strategic pivots
15. Basic causal explanations
16. Decision journal foundation
17. Career dashboard integration
18. Career onboarding/tutorial hints
19. Persistence
20. Bot/test support

Do not implement broader Career systems yet.

> **⚠️ Partial** — 17 of the 20 listed items are built. Career dashboard integration (#17) is limited to the shared `s.pmf` number; onboarding/tutorial hints (#18) amount to one line of copy; bot/test support (#20) has tests but no committed bot harness.

---

# 1. Customer segments

Every existing sector must have multiple customer segments.

Career should start with **three segments per sector**.

Current sectors include:

- B2B SaaS
- Social
- Fintech
- Developer Tools
- E-commerce

Each segment must have genuinely different economics and behaviour.

Do not simply rename the same three templates.

---

# Example — B2B SaaS

## Freelancers

Characteristics:

- Easy to reach
- Fast activation
- Low willingness to pay
- High price sensitivity
- Higher churn
- Low expansion potential
- Short sales cycle

## Small Teams

Characteristics:

- Moderate acquisition difficulty
- Better recurring need
- Higher retention
- Moderate willingness to pay
- Good expansion potential
- Moderate sales cycle

## Enterprise

Characteristics:

- Hard to reach
- Long sales cycle
- High willingness to pay
- High retention if successfully onboarded
- High product requirements
- High support requirements
- Greater revenue concentration

---

# Example — Developer Tools

Possible segments:

## Individual Developers

- Easy adoption
- Low willingness to pay
- Strong community effects
- High churn

## Startup Engineering Teams

- Moderate price tolerance
- Strong workflow value
- Good retention
- Faster adoption than enterprise

## Enterprise Engineering Organisations

- High contract value
- Security/compliance requirements
- Long procurement cycle
- Strong retention

---

# Example — E-commerce

Possible segments:

## Individual Sellers

## Growing Brands

## Enterprise Retailers

Their behaviour should differ in:

- Order volume
- Willingness to pay
- Switching cost
- Operational requirements
- Acquisition accessibility
- Retention
- Market size

> **✅ Implemented** — `src/game/career/segments.ts`. Three segments per sector across all five sectors (`saas`, `devtools`, `ecommerce`, `fintech`, `social` — 15 total), each with distinct base economics rather than renamed templates: an easy/cheap/churny end, a middle that retains, and a slow/demanding/high-value end. Asserted per sector in `test/career-pmf.test.ts`.

---

# 2. Segment market truth

Each segment has a stable underlying reality generated at the beginning of the campaign.

Suggested structure:

```ts
interface SegmentTruth {
  needIntensity: number;
  willingnessToPay: number;
  retentionPotential: number;
  acquisitionAccessibility: number;
  productRequirement: number;
  marketSize: number;
  competitiveIntensity: number;
  salesCycleWeeks: number;
  expansionPotential: number;
}
```

Use a consistent internal scale such as:

```ts
0–100
```

Segment Truth should be generated deterministically from:

- Seed
- Sector
- Scenario
- Segment ID

The same campaign seed must always generate the same market reality.

Do not regenerate Segment Truth after:

- Research
- Pricing changes
- Product changes
- Pivots
- Fundraising
- Reloading

The market should have a persistent reality.

> **✅ Implemented** — `generateSegmentTruth(seed, sector, scenario, segmentId)` in `segments.ts` hashes exactly those four inputs through a self-contained PRNG. All nine fields, 0–100 scale, variance ±14–24 points per metric. It is called only from `createCareerPMF`/`migrateCareerSave` at run start; the test suite asserts truth is byte-identical after a segment pivot.

---

# 3. Product-market relationship

The company's product must have different fit by segment.

Do not use one universal PMF value.

Suggested model:

```ts
interface SegmentFitState {
  segmentId: string;

  productFit: number;
  priceFit: number;
  distributionFit: number;

  activationRate: number;
  retentionRate: number;
  conversionRate: number;
}
```

A company may therefore have:

```text
Freelancers
Product fit: strong
Price fit: weak

Small Teams
Product fit: very strong
Price fit: strong

Enterprise
Product fit: weak
Price fit: strong
```

This should create strategic ambiguity.

> **⚠️ Partial** — fit is recomputed per segment every tick by `segmentProductFit()` and `segmentPriceFit()` in `src/game/career/pmf.ts` rather than stored as a `SegmentFitState`. `distributionFit`, `activationRate` and `conversionRate` have no separate existence: conversion is folded into `resolveSegmentAcquisition`, and activation is not modelled at all.

---

# 4. Player beliefs

The player should not see Segment Truth directly.

Maintain a separate belief model.

Suggested:

```ts
interface MetricBelief {
  estimate: number;
  confidence: number;
  evidenceCount: number;
}

interface SegmentBeliefs {
  needIntensity: MetricBelief;
  willingnessToPay: MetricBelief;
  retentionPotential: MetricBelief;
  acquisitionAccessibility: MetricBelief;
  productRequirement: MetricBelief;
  marketSize: MetricBelief;
  expansionPotential: MetricBelief;
}
```

At the start of Career:

- Confidence is low.
- Estimates are broad.
- Some beliefs may be wrong.
- Some initial assumptions may be overconfident.

Do not show exact hidden truth.

Instead surface readable labels:

```text
Need intensity
Likely high
Confidence: Medium
```

or:

```text
Estimated willingness to pay
$35–$90
Confidence: Low
```

> **✅ Implemented** — `MetricBelief`/`SegmentBeliefs` in `src/game/career/types.ts`; `initialBeliefs()` in `pmf.ts` starts estimates ±30 points off truth at 0.10–0.22 confidence. Truth is never rendered. `beliefBand()` and `confidenceLabel()` produce the readable label plus confidence word shown in `src/screens/Discovery.tsx`. Bands are 0–100 labels ("High" / "Confidence: Medium"), not dollar ranges.

---

# 5. Initial founder assumptions

At Career creation, generate or allow the player to choose some initial assumptions.

For example:

```text
You believe:
• Freelancers have the strongest pain.
• Small teams may retain better.
• Enterprises are probably too demanding for the current product.
```

These assumptions should populate the initial Hypothesis Board.

They are beliefs, not facts.

The player should be able to prove themselves wrong.

> **✅ Implemented** — generated, not chosen. `initialBeliefs()` gives exactly one metric per segment a confident prior pointing the *wrong* way (22–42 points off, confidence 0.42), so there is a specific assumption worth killing. Surfaced as the opening journal entry `j-start` in `createCareerPMF` plus the Hypothesis Board itself.

---

# 6. Hypothesis Board

Add a dedicated Career UI called:

# Hypothesis Board

This should become the centre of early Career PMF gameplay.

Each customer segment should have hypotheses around:

- Problem intensity
- Willingness to pay
- Product requirements
- Acquisition accessibility
- Retention potential
- Market size
- Expansion potential

Example:

```text
SMALL TEAMS

Problem intensity
Likely high
Confidence: 62%

Evidence:
+ 7/10 interviews mentioned weekly pain
+ Prototype adoption above expectation
- Several teams use acceptable existing tools
```

Each hypothesis should show:

- Current belief
- Confidence
- Supporting evidence
- Contradicting evidence
- Last updated week
- Suggested next experiment

Do not make this a dense spreadsheet.

Use cards, summaries and progressive disclosure.

> **⚠️ Partial** — `SegmentHypotheses` in `src/screens/Discovery.tsx` renders a card per segment with all seven metrics, belief label, a confidence bar, an "Assumption — no evidence yet" marker and the four most recent evidence lines tagged +/−/~. Missing: per-hypothesis "last updated week", and per-hypothesis suggested next experiment (the recommendation is a single global one).

---

# 7. Evidence model

Research should produce evidence.

Suggested:

```ts
interface EvidenceItem {
  id: string;
  week: number;

  segmentId: string;

  source:
    | "interview"
    | "landing_page"
    | "prototype"
    | "pricing_test"
    | "pilot"
    | "customer_behaviour"
    | "renewal"
    | "referral";

  metric:
    | "needIntensity"
    | "willingnessToPay"
    | "retentionPotential"
    | "acquisitionAccessibility"
    | "productRequirement"
    | "marketSize"
    | "expansionPotential";

  signal: number;
  reliability: number;

  direction:
    | "positive"
    | "negative"
    | "mixed";

  summary: string;
}
```

Evidence should differ by quality.

> **✅ Implemented** — `EvidenceItem` in `types.ts` matches the brief field for field, plus an internal `misleading?: boolean` recorded for postmortems and never surfaced live. All eight sources are typed; only the five experiment types are actually emitted today (`customer_behaviour`, `renewal`, `referral` are declared but unused).

---

# 8. Evidence hierarchy

Use a hierarchy where behaviour is stronger than stated intent.

Suggested ranking:

## Weak evidence

- Opinions
- Surveys
- Social engagement
- Stated interest

## Medium evidence

- Interviews
- Landing-page conversion
- Prototype usage
- Sales meetings

## Strong evidence

- Payment
- Repeat usage
- Retention
- Renewal
- Expansion
- Referral

The player should sometimes receive:

> Strong interest, weak behaviour.

This is important.

Example:

```text
Interviews:
9/12 founders said they would pay.

Pricing test:
Only 2/12 accepted the proposed price.
```

The game should update the belief accordingly.

> **✅ Implemented** — `EXPERIMENTS` in `pmf.ts` ranks `baseReliability` 0.34 (interview) → 0.44 (landing page) → 0.62 (prototype) → 0.70 (pricing test) → 0.88 (pilot). `resolveExperiment` adds a systematic +10..+26 point bias to `willingnessToPay`/`needIntensity` for interviews and landing pages — the "9 of 12 said they'd pay, 2 actually did" effect. Measured in the test suite at +21.1 points vs +2.9 for a pricing test.

---

# 9. Research experiments

Implement five experiment types.

---

## Customer Interviews

### Purpose

Learn about:

- Problem intensity
- Existing alternatives
- Customer language
- Weak willingness-to-pay signal

### Characteristics

- Low cost
- Fast
- No product required
- Moderate reliability
- Susceptible to stated-preference bias

Suggested duration:

1–2 weeks

---

## Landing Page Test

### Purpose

Learn about:

- Demand signal
- Messaging
- Acquisition accessibility
- Relative segment interest

### Characteristics

- Low/moderate cost
- Short duration
- Requires marketing spend
- Does not prove long-term value

Suggested duration:

1–3 weeks

---

## Prototype Test

### Purpose

Learn about:

- Product usefulness
- Product requirements
- Activation
- Workflow value

### Characteristics

- Requires product capacity
- Medium duration
- Stronger behavioural evidence

Suggested duration:

2–4 weeks

---

## Pricing Test

### Purpose

Learn about:

- Willingness to pay
- Conversion sensitivity
- Price elasticity

### Characteristics

- Moderate risk
- Can reduce conversion
- Evidence depends on sample size

Suggested duration:

2–4 weeks

---

## Pilot

### Purpose

Learn about:

- Real usage
- Real payment
- Implementation effort
- Retention
- Support requirements
- Expansion potential

### Characteristics

- Highest cost
- Long duration
- Strongest evidence
- Particularly valuable for enterprise-type segments

Suggested duration:

4–12 weeks depending on sector/segment

> **✅ Implemented** — all five types in `EXPERIMENTS` (`pmf.ts`) with the specified purposes and cost profiles: interview 2wk/$4k, landing page 2wk/$6k, prototype 3wk/$12k, pricing test 3wk/$9k, pilot 7wk/$28k. Durations are fixed constants; the pilot does not scale 4–12 weeks by sector or segment.

---

# 10. Active experiments

Suggested:

```ts
interface ActiveExperiment {
  id: string;

  type: ExperimentType;
  segmentId: string;

  startWeek: number;
  completionWeek: number;

  cashCost: number;

  productCapacityCost?: number;
  marketingCapacityCost?: number;

  sampleSize: number;

  expectedEvidenceMetrics: EvidenceMetric[];

  status:
    | "active"
    | "complete"
    | "cancelled";
}
```

Experiments must take time.

Do not allow instant research.

The player should see:

```text
Enterprise Pilot
Week 4 / 8
```

> **✅ Implemented** — `ActiveExperiment` matches the brief; `startExperiment()` sets `completionWeek = week + def.weeks` and `Discovery.tsx` renders "Week n / m" with a progress bar. `canRunExperiment()` caps three concurrent and one per (type, segment). The `cancelled` status is typed but nothing cancels an experiment.

---

# 11. Experiment quality

Evidence quality should depend on:

- Experiment type
- Sample size
- Current product quality
- Current strategy alignment
- Segment accessibility
- Deterministic random noise

Suggested concept:

```ts
evidenceReliability =
  baseExperimentReliability
  × sampleQuality
  × executionQuality;
```

Do not expose exact formulas.

The same seed and decisions must produce the same evidence.

> **⚠️ Partial** — `resolveExperiment` computes `reliability = baseReliability × sampleQuality(log₁₀ of sample) × (0.6 + executionQuality × 0.4) × accessPenalty(segment reachability)`, with `executionQuality` derived from product quality and headcount in `tick.ts`. Deterministic from the run's seeded RNG. "Current strategy alignment" is not an input.

---

# 12. Misleading evidence

Weak evidence should occasionally be misleading.

Examples:

### False positive

Interviews suggest strong willingness to pay.

Actual conversion is weak.

### False negative

Early prototype performs poorly because UX is weak.

Underlying need is actually strong.

### Sample bias

Landing page reaches unusually sophisticated users.

Results overestimate broader market quality.

Do not make evidence arbitrary.

The probability of misleading information should correlate with:

- Small samples
- Weak experiment types
- Poor execution quality

> **⚠️ Partial** — false positive (interviews/landing pages overstate WTP and need) and false negative (a prototype run at `executionQuality < 0.45` understates need) are explicit branches in `resolveExperiment` and set `misleading: true`. Sample bias is only implicit: hard-to-reach segments get a lower `accessPenalty` and therefore wider noise. There is no distinct sample-bias mechanic.

---

# 13. Selecting a primary target segment

The player should explicitly select:

# Primary Target Segment

Only one primary segment initially.

Changing the target should affect:

- Product prioritisation
- Marketing efficiency
- Messaging
- Pricing
- Sales cycle
- Customer composition
- Team clarity
- Product requirements

The target segment should be clearly displayed on:

- Dashboard
- Market screen
- Product screen

> **⚠️ Partial** — `primaryTargetSegmentId` drives acquisition, product fit, price fit, repositioning and the default experiment target. It is displayed only on the Discovery screen; the Dashboard, Market and Product screens never mention it.

---

# 14. Repositioning cost

Changing the primary segment should not be free.

Possible temporary effects:

- Product velocity penalty
- Marketing efficiency penalty
- Reduced team clarity
- Existing roadmap disruption
- Loss of some accumulated segment-specific optimisation

Suggested:

```ts
interface RepositioningState {
  previousSegmentId: string;
  newSegmentId: string;

  startWeek: number;
  remainingWeeks: number;

  productPenalty: number;
  marketingPenalty: number;
}
```

Typical duration:

2–6 weeks

depending on how different the segments are.

> **⚠️ Partial** — `repositionTo()` in `src/game/career/tick.ts` sets a `RepositioningState` of 2–6 weeks, sized by the distance between the two segments' `productRequirement` + `willingnessToPay`. The marketing penalty (0.55) is applied in `resolveSegmentAcquisition`. The product penalty (0.7) only modulates the returned `productCapacityDrain`, which `engine.ts` never reads — so product velocity is not actually reduced.

---

# 15. Product fit by segment

Current product development should map into segment-specific fit.

Suggested simplified model:

```ts
segmentProductFit =
  baseProductQuality
  + relevantProductStrengths
  + segmentAlignmentBonus
  - segmentProductRequirement;
```

Do not require a full feature-level product system yet.

The important result is:

> Improving product quality should help demanding segments differently than easy segments.

Example:

A product quality of 55 might be:

- Excellent for freelancers
- Good for small teams
- Insufficient for enterprise

> **✅ Implemented** — `segmentProductFit()` = `50 + (quality − productRequirement) × 0.85 + focusBonus`, so the same product serves segments differently by their bar. Test asserts a quality of 55 scores 100 for freelancers and 14 for enterprise on the same seed.

---

# 16. Product focus

Add a Career product focus concept.

Possible focuses:

- Simplicity
- Reliability
- Collaboration
- Enterprise readiness
- Mobile
- Automation
- Performance

Do not create dozens.

3–6 relevant product dimensions per sector is enough.

Each segment should value some product dimensions more than others.

Example:

Enterprise values:

- Reliability
- Security
- Administration

Freelancers value:

- Simplicity
- Speed
- Low cost

This helps make targeting strategically meaningful.

> **⚠️ Partial** — six focuses exist (`ProductFocus` in `types.ts`: simplicity, reliability, collaboration, enterprise_readiness, automation, performance) and each `SegmentDef` lists the two it values, worth +18 / +9 / −8 in `segmentProductFit`. They are one global list, not 3–6 dimensions *per sector*; "Mobile" from the brief was dropped.

---

# 17. Pricing fit

Price should interact with willingness to pay.

Do not simply model:

> Higher price = more revenue.

Segment pricing fit should affect:

- Conversion
- Retention
- Revenue
- Customer quality
- Expansion potential

Suggested relationship:

```ts
priceFit =
  compare(
    companyPrice,
    estimatedSegmentWTP
  );
```

Avoid exposing hidden WTP exactly.

The player should learn it through evidence.

> **⚠️ Partial** — `segmentPriceFit()` compares a fixed price level (low 26 / market 52 / premium 82) against hidden `willingnessToPay`, penalising overpricing at 1.5× and underpricing at 0.35×. It feeds conversion (via `resolveSegmentAcquisition`), retention (via `resolveCohortRetention`) and the PMF score. It does not affect customer quality or expansion potential.

---

# 18. Pricing strategy

Career should support a simplified pricing choice.

Possible initial options:

- Low
- Market
- Premium

or a numerical price if the current system already supports it cleanly.

The system should allow:

- Low price → higher conversion, lower revenue
- Premium price → lower conversion, higher potential revenue
- Severe overpricing → weak acquisition/retention
- Underpricing → growth but weaker economics

Do not implement complex packaging yet.

> **✅ Implemented** — three-way `PricingStrategy`, set from `Discovery.tsx` through `setPricing` in `src/store.ts`. `revenueMultiplier()` returns 0.55 / 1.0 / 1.75 and multiplies core revenue in `engine.ts`; conversion and retention re-rate through `priceFit`, so severe overpricing genuinely starves acquisition.

---

# 19. Segment-level acquisition

Customer acquisition must become segment-aware.

Acquisition should depend on:

- Target segment
- Segment accessibility
- Marketing spend
- Product promise
- Product fit
- Pricing fit
- Competition
- Market size
- Saturation
- Existing brand strength

Suggested conceptual model:

```ts
segmentAcquisition =
  marketingEffect
  × acquisitionAccessibility
  × messageAlignment
  × priceConversion
  × competitionModifier;
```

The player should be able to acquire many customers with weak long-term value.

> **✅ Implemented** — `resolveSegmentAcquisition()` combines marketing spend (sqrt, so CAC worsens), hype, `acquisitionAccessibility`, a product×price conversion term, `competitiveIntensity`, remaining ceiling room and the repositioning penalty, scaled by the sector's `acqBase`. Buying many low-value customers is entirely possible and is what the Careless Growth bot did.

---

# 20. Customer cohorts

Track acquired customers by cohort.

Suggested:

```ts
interface CustomerCohort {
  id: string;

  acquiredWeek: number;
  segmentId: string;

  channelId?: string;

  startingCustomers: number;
  activeCustomers: number;

  acquisitionCost: number;

  priceAtAcquisition: number;

  productQualityAtAcquisition: number;
}
```

For Phase 1, the engine must support cohorts.

The UI can remain relatively simple.

> **✅ Implemented** — `CustomerCohort` in `types.ts` matches the brief minus `channelId` (no channel system exists yet). Cohorts are created on acquisition and on reconciliation in `tickCareerPMF`, and the list is trimmed to the newest 60.

---

# 21. Cohort behaviour

Each cohort should evolve over time.

Track:

- Activation
- Retention
- Churn
- Revenue
- Expansion where relevant

This allows the game to teach:

> Aggregate user growth can hide weak cohorts.

Example:

```text
New customers: +1,850
Total users: +1,100

Why?

750 existing customers churned this week.
```

> **⚠️ Partial** — retention and churn run per cohort every week, and 4-week retention is measured per segment from mature cohorts. Activation, per-cohort revenue and expansion are not tracked; revenue is still computed from aggregate `s.users` in `engine.ts`. Aggregate-growth-hides-churn is real and asserted, but the game never shows the "+1,850 new / +1,100 net" breakdown.

---

# 22. Retention

Retention should depend on:

- Need intensity
- Product fit
- Price fit
- Product reliability
- Competition
- Customer support where applicable
- Segment retention potential
- Time since acquisition

Suggested concept:

```ts
retentionProbability =
  segmentRetentionPotential
  × productFitModifier
  × priceFitModifier
  × reliabilityModifier;
```

Do not expose the formula.

> **✅ Implemented** — `resolveCohortRetention()` multiplies `retentionPotential`, product fit, price fit, a bug-driven reliability term and an early-weeks honeymoon penalty into a weekly keep rate. Customer-support staffing is not an input. The formula is never exposed.

---

# 23. Segment retention screen

Career should surface simple but useful segment-level retention.

Example:

```text
FREELANCERS

Customers
4,260

4-week retention
58%

Trend
Declining

Main issue
Low recurring usage
```

```text
SMALL TEAMS

Customers
870

4-week retention
84%

Trend
Improving

Main strength
Strong collaboration usage
```

Do not build an enterprise analytics product.

Keep the UI game-readable.

> **❌ Not implemented** — `career.retentionBySegment` is recomputed every week in `tickCareerPMF`, but no screen reads it: `grep retentionBySegment src/screens` returns nothing. `Discovery.tsx` shows customer counts per segment, not retention, trend or a main-issue line. Deferred, not superseded.

---

# 24. PMF status

Retain a high-level PMF label for readability.

But derive it from real behaviour.

Possible states:

- No clear demand
- Early signal
- Problem validated
- Product showing value
- Emerging PMF
- Strong PMF
- Scalable PMF

PMF should be calculated separately by segment.

Example:

```text
Small Teams
STRONG PMF

Freelancers
WEAK PMF

Enterprise
UNPROVEN
```

The company-level PMF status should reference the strongest validated segment.

> **✅ Implemented** — eight `PmfStatus` values (the brief's seven plus `unproven`), derived per segment by `derivePmfForSegment()` and labelled through `PMF_LABEL`. `tickCareerPMF` takes the best-scoring segment as the company-level status and writes its score to `s.pmf`.

---

# 25. PMF requirements

Strong PMF should require evidence across multiple dimensions.

Suggested inputs:

- Retention
- Payment
- Product fit
- Repeatable acquisition
- Segment size
- Evidence confidence

Important:

Research alone cannot create strong PMF.

The player could have:

```text
High confidence
Low PMF
```

because research proves the idea is weak.

That should be possible.

> **✅ Implemented** — score = retention 46 + price fit 20 + product fit 14 + scale 12 + market headroom 8. Evidence confidence contributes only below 15 customers and is capped at `problem_validated`. Asserted: perfect research (all metrics at 95/0.98 confidence) with zero customers yields `problem_validated`, score 39.

---

# 26. Scaling too early

Career should explicitly support the classic failure mode:

> Scaling before PMF.

If the player spends aggressively on acquisition when:

- Retention is weak
- Product fit is weak
- Pricing fit is weak

they may get:

- Rapid user growth
- Rapid churn
- High CAC
- Weak revenue quality
- Higher burn
- False sense of momentum

This should be a viable way to fail.

> **✅ Implemented** — asserted in `test/career-pmf.test.ts`: on the same seed, a run at $250k/wk marketing burns far more cash *and* churns more customers in absolute terms than one at $15k. Acquisition uses sqrt-of-spend so CAC rises, and the "growth is rented, not owned" causal explanation fires when retention is below 0.6.

---

# 27. False PMF

Add the possibility of temporary apparent success.

Examples:

- Large marketing campaign
- Viral event
- Influencer boost
- Heavy discount
- One major customer

These can create:

- Strong acquisition
- Strong revenue spike

without proving retention.

Do not immediately label this PMF.

> **✅ Implemented** — events, viral moments and arcs award users straight onto `s.users`; `tickCareerPMF` absorbs them into a cohort of the target segment, where they face the same retention as anyone else. PMF status still requires 4-week retention above 0.62 / 0.72 / 0.80, so a spike alone cannot be labelled PMF.

---

# 28. Strategic pivots

Replace the Career pivot mechanic with explicit pivot types.

---

## Segment Pivot

Change primary target segment.

Effects:

- Repositioning period
- Product mismatch risk
- Existing customer consequences
- New research needs

---

## Product Pivot

Change what the product is optimised for.

Effects:

- Some product progress lost
- New segment alignment
- Short-term product velocity reduction

---

## Pricing Pivot

Change pricing strategy.

Effects:

- Conversion change
- Revenue change
- Existing customer reaction
- New evidence generated over time

> **⚠️ Partial** — the **segment pivot** is a real mechanic: `repositionTo()` applies a repositioning period, writes a journal entry and an inbox message, and keeps existing customers. The **product pivot** and **pricing pivot** are plain setters (`setProductFocus`, `setPricing` in `src/store.ts`) with a journal entry — no product progress is lost and no velocity penalty applies. Pricing does re-rate existing customers, since retention reads `priceFit` every week.

---

# 29. Pivot memory

Pivots should be logged permanently.

Example:

```text
Week 27

SEGMENT PIVOT

From:
Freelancers

To:
Small Teams

Reason:
Freelancer acquisition was strong,
but 4-week retention fell to 42%.
```

Later postmortems should use this.

> **⚠️ Partial** — every pivot writes a `category: 'pivot'` journal entry naming from/to and, where known, the retention that motivated it (`"Freelancers retention had settled at 42%…"`). Not permanent, though: `addJournal()` truncates the journal to the most recent 80 entries.

---

# 30. Decision journal

Implement the foundation now.

Suggested:

```ts
interface DecisionJournalEntry {
  id: string;
  week: number;

  category:
    | "strategy"
    | "experiment"
    | "discovery"
    | "pricing"
    | "pivot"
    | "milestone";

  title: string;
  description: string;

  relatedSegmentId?: string;
  relatedDecisionId?: string;
}
```

Automatically record:

- Initial target selection
- Experiment started
- Major evidence discovered
- Pricing change
- Segment change
- Product pivot
- PMF milestone
- PMF deterioration

> **⚠️ Partial** — `DecisionJournalEntry` matches the brief minus `relatedDecisionId`. Auto-recorded: initial target, experiment started, evidence discovered, pricing change, product-focus change, segment pivot, PMF milestone and the legacy migration. PMF *deterioration* is not recorded.

---

# 31. Causal explanations

Implement the first version of Career causal explanations.

Focus only on:

- Acquisition
- Conversion
- Retention
- Revenue quality
- PMF

Suggested:

```ts
interface CausalExplanation {
  metric:
    | "acquisition"
    | "conversion"
    | "retention"
    | "revenue"
    | "pmf";

  direction:
    | "up"
    | "down"
    | "flat";

  primaryCause: string;

  secondaryCauses: string[];

  relatedDecisionIds?: string[];
}
```

Example:

```text
RETENTION ↓

Most new customers came from Freelancers,
where recurring need is weaker.

Your current product also prioritises
collaboration features valued more by Small Teams.
```

> **⚠️ Partial** — `CausalExplanation` matches (minus `relatedDecisionIds`). Three rules in `tick.ts` generate retention-down, acquisition-up-with-weak-retention and conversion-down explanations into `career.lastExplanations`, with segment-aware prose. No screen renders them; `explanationText()` in `pmf.ts` has no callers.

---

# 32. Weekly Founder Briefing

Career dashboard should begin each week with a concise summary.

Example:

```text
WEEK 18

WHAT CHANGED

Customers
+620

Revenue
+4%

Retention
-6%

WHY

Your new campaign acquired many Freelancers,
but they are retaining worse than Small Teams.

WHAT WE LEARNED

Pricing Test completed:
Small Teams appear willing to pay more than expected.

BIGGEST UNCERTAINTY

Can Small Teams be acquired efficiently at scale?
```

This should be concise.

Avoid information overload.

> **⚠️ Partial** — the data is computed. `career.lastBriefing` is written every week with `customersDelta`, `retentionDeltaPct`, a `why` drawn from the top explanation, a `learned` line from any experiment that completed, and the biggest uncertainty. **No UI reads it** — nothing in `src/screens` references `lastBriefing`. `revenueDeltaPct` is hard-coded to 0 with the comment "filled by the engine once revenue is known"; the engine never fills it.

---

# 33. “Biggest uncertainty”

Career should surface one important unresolved question.

Examples:

```text
BIGGEST UNCERTAINTY

Will Enterprise customers accept the current implementation effort?
```

or:

```text
BIGGEST UNCERTAINTY

Is Small Team retention strong enough to justify scaling acquisition?
```

Determine this from:

- Low confidence
- Strategic importance
- Current target segment
- Evidence gaps

This should guide the player without prescribing the answer.

> **⚠️ Partial** — `biggestUncertainty()` in `pmf.ts` picks the least-confident metric on the *target* segment, with two behavioural overrides that take precedence (customers churning below 60% retention; unproven willingness to pay with real customers). It reaches state only through `lastBriefing`, which is not rendered.

---

# 34. Suggested experiment

The game may recommend:

```text
Recommended next test:
Pilot — Small Teams
```

But it should explain why:

```text
You have strong evidence of need,
but weak evidence of real willingness to pay.
```

The recommendation is advisory.

Do not force it.

> **✅ Implemented** — `suggestedExperiment()` walks confidence thresholds in order (interview → landing page → prototype → pricing test → pilot) and returns a typed reason. Rendered as "Recommended next: …" with its explanation in `Discovery.tsx`. Purely advisory; nothing is gated on it.

---

# 35. Career onboarding

Career PMF should be learnable without a long tutorial.

At first Career start, use short contextual hints.

Example:

```text
You don't know your market yet.

Research improves what you know.
Customers prove whether you're right.
```

Then:

```text
Choose a customer segment to investigate first.
```

Then:

```text
Experiments take time and money.
Stronger experiments create better evidence.
```

No large tutorial modal unless the existing UX already uses one well.

> **⚠️ Partial** — the Discovery screen carries one standing line of the brief's copy ("You don't know your market yet. Research improves what you *know*; customers prove whether you were *right*."), and unevidenced metrics read "Assumption — no evidence yet." There are no staged contextual hints, and `src/Coach.tsx` (the existing first-run tutorial) has no Career steps.

---

# 36. Career Dashboard additions

Add:

- Primary target segment
- Company PMF status
- Best-performing segment
- Active experiments
- Biggest uncertainty
- Key PMF explanation
- Recent discovery

Do not overcrowd the dashboard.

> **❌ Not implemented** — `src/screens/Dashboard.tsx` is unchanged: it shows the generic PMF stat card and benchmarks, which in Career happen to read the derived score. No target segment, best segment, active experiments, biggest uncertainty, PMF explanation or recent discovery. Deferred — the whole surface lives on Discovery instead.

---

# 37. Market screen

Career Market screen should show segment cards.

Each card should include:

- Segment name
- Customer count
- Estimated market size
- Acquisition accessibility estimate
- Retention
- PMF status
- Confidence
- Target indicator

Example:

```text
SMALL TEAMS
Primary Target

Market size
Likely Medium–Large

Customers
842

4-week retention
83%

PMF
Emerging

Confidence
High
```

> **❌ Not implemented** — `src/screens/Market.tsx` contains no segment code at all. Superseded in practice by the Hypothesis Board cards, which cover segment name, customer count, market-size belief, reachability belief, confidence and the target indicator — but not retention or PMF status.

---

# 38. Research / Product screen

Add a Career-specific PMF section containing:

- Hypothesis Board
- Experiment catalogue
- Active experiments
- Completed evidence

Do not remove existing product controls.

Integrate where logical.

> **⚠️ Partial** — the Career PMF section is its own screen (`src/screens/Discovery.tsx`, nav item gated on `hasCapability(game, 'hypothesisBoard')`) rather than a section inside Product. It contains the Hypothesis Board, the experiment catalogue, active experiments, evidence and the journal. Existing product controls are untouched.

---

# 39. Inbox integration

Experiment results should arrive through the inbox.

Example:

```text
PRICING TEST COMPLETE

Small Teams reacted better than expected.

Current belief:
Willingness to Pay — High

Confidence increased:
48% → 69%
```

Important discoveries should feel like events.

> **✅ Implemented** — on completion, `tickCareerPMF` pushes an inbox item titled `🔬 <experiment> complete — <segment>` listing every evidence line plus the confidence move ("48% → 69%"). Asserted in the test suite ("results arrive through the inbox as an event").

---

# 40. Existing Quick Play compatibility

Quick Play must remain unchanged.

When:

```ts
detailedPMF === false
```

use the existing PMF system.

Do not expose:

- Segments
- Hypotheses
- Experiments
- Cohorts
- Detailed PMF

inside Quick Play.

Quick Play should remain fast and accessible.

> **✅ Implemented** — the Quick Play acquisition/PMF block in `advanceWeek` is byte-for-byte the old code, now in the `else` branch of `if (can(s, 'detailedPMF') && s.career)`. Quick Play creates no `career` state, and the Discovery nav item is filtered out by capability. Asserted: Quick Play "still runs its own simple PMF model unchanged".

---

# 41. Arena compatibility

Arena must continue using simplified PMF.

Do not make Arena players manage:

- Hypothesis boards
- Interviews
- Pilots
- Detailed cohorts

PvP complexity will come from other players later.

> **✅ Implemented** — `ARENA_BASE_RULES` in `src/game/modes.ts` leaves `detailedPMF` false. Asserted in both `test/career-pmf.test.ts` and `test/modes.test.ts`.

---

# 42. Daily Challenge compatibility

Daily Challenge lives inside Quick Play.

Therefore it should continue using the simple Quick Play PMF model for now.

Do not enable detailed Career PMF in Daily Challenge.

> **✅ Implemented** — Daily is a *format* of Quick Play, so it inherits `detailedPMF: false` and creates no Career state. Asserted explicitly.

---

# 43. Existing rivals

Do not deeply rebuild rivals yet.

Where easy, assign each AI rival:

```ts
preferredSegmentId
```

This can affect:

- Competitive intensity
- Segment attractiveness
- Market share

Example:

```text
Orbit
Enterprise-focused

Bloom
Freelancer-focused
```

Do not build full competitor strategy AI in this task.

> **❌ Not implemented** — `Rival` in `src/game/types.ts` has no `preferredSegmentId`, and nothing reads segment identity when rivals tick. Competitive pressure on a segment comes only from that segment's static `competitiveIntensity` in `SegmentTruth`. Skipped as explicitly optional ("where easy").

---

# 44. Fundraising integration

Do not rebuild fundraising.

Career fundraising should receive better inputs from the new PMF model.

Investor attractiveness may increase with:

- Strong retention
- Validated high-value segment
- Repeatable acquisition
- Strong evidence confidence

Suggested:

```ts
fundraisingPMFModifier =
  derivedCareerPMFScore;
```

Do not expose a hidden composite score directly.

> **✅ Implemented, indirectly** — `tickCareerPMF` writes the derived company score into `s.pmf` ("downstream systems still read a single number"), so existing valuation, investor appetite and pitch odds consume the Career PMF score with no fundraising code changed. There is no separate `fundraisingPMFModifier`, and the composite is never displayed as a number beyond the existing PMF stat.

---

# 45. Board integration

Do not rebuild board mechanics.

Existing board targets may continue.

Where appropriate, a board target can recognise:

- Strong PMF
- Retention
- Revenue growth

No deeper board politics yet.

> **✅ Implemented, indirectly** — same mechanism: board targets and reviews continue to read `s.pmf` and growth, which in Career are outputs of the segment model rather than the research loop. No board code was touched, and no board politics were added.

---

# 46. Product integration

Existing product investment should feed the new segment-fit calculations.

Avoid maintaining two unrelated product-quality systems.

The new PMF system should build on current product state wherever practical.

> **✅ Implemented** — there is one product-quality system. `s.quality` is the sole product input to `segmentProductFit()`, and `s.bugs` feeds `resolveCohortRetention()`. No parallel product state was created.

---

# 47. Marketing integration

Career marketing should acquire customers from the target segment.

If the existing marketing system has no targeting concept, add a minimal target parameter.

Do not build the full future distribution-channel system.

For now:

```ts
marketingTargetSegmentId
```

is sufficient.

> **✅ Implemented** — the existing `s.marketingSpend` is passed straight into `resolveSegmentAcquisition` and spends entirely against `primaryTargetSegmentId`. No separate `marketingTargetSegmentId` field was added: the primary target *is* the marketing target.

---

# 48. Market saturation

Segments should have finite growth potential.

As the company acquires more customers:

- Acquisition becomes harder
- CAC should gradually rise
- Remaining customers may be lower quality

Do not create aggressive saturation early.

Use it primarily to prevent infinite growth in small segments.

> **⚠️ Partial** — `segmentCeiling()` caps each segment at its share of sector TAM (`tam × marketSize / 100 / 2.2`) and acquisition decays as `(1 − customers/ceiling)^1.3`; with sqrt-of-spend this makes effective CAC climb. Late-arriving customers are not modelled as lower quality.

---

# 49. Segment expansion

A segment with high expansion potential may produce increased revenue over time.

For Phase 1, keep this simple.

Example:

Small Teams may:

- Add seats
- Upgrade plan

Enterprise may:

- Expand contracts

Freelancers may have limited expansion.

Do not implement complex account-level expansion yet.

> **❌ Not implemented** — `expansionPotential` exists as a `SegmentTruth` field, as a tracked belief and as a metric a pilot can produce evidence about, but it never touches revenue. There are no seats, plan upgrades or contract expansions; revenue per customer is flat within a pricing strategy. Effectively it is modelled only as "this segment retains and is worth pursuing".

---

# 50. Save schema

Update persistence for Career state.

Suggested additions:

```ts
interface CareerPMFState {
  segmentTruth: Record<
    SegmentId,
    SegmentTruth
  >;

  segmentBeliefs: Record<
    SegmentId,
    SegmentBeliefs
  >;

  evidence: EvidenceItem[];

  activeExperiments: ActiveExperiment[];

  cohorts: CustomerCohort[];

  primaryTargetSegmentId: SegmentId;

  repositioning?: RepositioningState;

  journal: DecisionJournalEntry[];
}
```

Only store this when necessary.

Avoid bloating Quick Play state unnecessarily if the architecture allows separation.

> **✅ Implemented** — `CareerPMFState` hangs off `GameState.career` as an optional field, absent entirely on Quick Play and Arena saves, and is persisted wholesale by the existing zustand `persist` in `src/store.ts`. Fields beyond the brief's list: `pricing`, `focus`, `retentionBySegment`, `lastExplanations`, `lastBriefing`.

---

# 51. Save migration

Existing Career Preview saves created before this feature must not crash.

When loading an old Career save:

1. Generate deterministic Segment Truth from the original seed.
2. Generate initial beliefs.
3. Infer a reasonable primary segment.
4. Map existing users into initial cohorts.
5. Map existing PMF/research progress into broad starting confidence.
6. Preserve:
   - Cash
   - Revenue
   - Employees
   - Week
   - Valuation
   - Funding
   - Rivals
   - Board state

Add a journal entry:

```text
Career PMF system activated.
Existing market progress has been converted.
```

Do not migrate Quick Play saves into Career.

> **✅ Implemented** — `migrateCareerSave()` in `pmf.ts` rebuilds truth from the original seed, converts `researchSignal` into up to +0.30 of broad confidence across all beliefs, folds existing users into a `cohort-legacy` cohort and appends the "Career PMF system activated" journal entry. Called from `migrateLegacySave` in `engine.ts` when `capabilities.detailedPMF && !g.career`. Quick Play saves are never migrated into Career. Asserted.

---

# 52. Determinism

All new simulation mechanics must be deterministic.

Never use:

```ts
Math.random()
```

inside simulation logic.

Use the existing seeded RNG.

Same:

- Seed
- Career configuration
- Decisions

must produce identical:

- Segment Truth
- Evidence
- Experiment results
- Acquisition
- Retention
- PMF

> **✅ Implemented** — no `Math.random` anywhere in `src/game/career/`. `segments.ts` and `pmf.ts` each carry a self-contained mulberry-style PRNG seeded from hashed inputs; `tick.ts` draws only from the engine's seeded RNG passed in as `rng`. Asserted: the same seed and decisions reproduce users, cash and evidence count exactly over 18 weeks.

---

# 53. Headless bots

Update bot support.

Create at least three Career PMF bot strategies.

---

## Careless Growth Bot

Behaviour:

- Picks easiest segment
- Runs little research
- Spends heavily on acquisition
- Rarely pivots

Expected:

Often experiences:

- Fast early growth
- Weak retention
- High burn
- Failure

---

## Disciplined Discovery Bot

Behaviour:

- Runs interviews
- Runs prototype
- Runs pricing test/pilot
- Chooses target based on evidence
- Scales only after retention improves

Expected:

More likely to reach sustainable PMF.

---

## Enterprise Bet Bot

Behaviour:

- Targets high-value segment
- Invests heavily in product
- Accepts slower acquisition
- Runs pilots
- Seeks higher price

Expected:

Slower early growth but stronger revenue if successful.

> **⚠️ Partial** — all three strategies were written and run during development (8 seeds × 90 weeks) and the comparison is recorded in commit `fea4ca7`: Careless Growth 6/8 alive, 474 customers, 28% retention, never past "Showing value"; Disciplined Discovery 7/8 alive, 238 customers, 72% retention, mostly Emerging PMF; Enterprise Bet 7/8 alive, 527 customers, 87% retention, Strong or Scalable in 7/8. **No harness was committed with the feature**, so that run is not reproducible from commit `fea4ca7`. A harness has since appeared at `test/career-bots.ts` (untracked at the time of writing, not yet wired into `npm test`) — check its state before relying on this note.

---

# 54. Balance philosophy

Career should support several viable strategies.

Avoid:

> Small Teams are always optimal.

The underlying seed should create meaningful variation.

Examples:

Campaign A:

- Freelancer opportunity is unusually strong.

Campaign B:

- Enterprise is exceptional.

Campaign C:

- Small Teams are clearly strongest.

Campaign D:

- No segment has easy PMF.

The player should have to discover the market.

> **✅ Implemented** — the ±14–24 point per-metric variance in `generateSegmentTruth` is wide enough that a seed can produce an unusually strong freelancer market or an enterprise segment that simply is not there. Asserted that different seeds produce different markets. The only dominance check performed is the bot run in §53, which found no dominant strategy.

---

# 55. Difficulty philosophy

Research should improve decisions.

It should not guarantee success.

Bad decisions with good research can still fail.

Good decisions with incomplete information can succeed.

PMF should contain:

- Skill
- Judgement
- Uncertainty
- Market variance

Avoid pure randomness.

Avoid perfect predictability.

> **➖ N/A** — philosophy, but it is expressed in mechanics: research raises confidence while PMF stays capped at `problem_validated` without customers, and cheap instruments can leave the player confidently wrong.

---

# 56. Tests — Segment generation

Test:

- Same seed → same Segment Truth.
- Different seed → meaningful variation.
- Segments differ within each sector.
- Values remain inside valid ranges.

> **✅ Implemented** — `test/career-pmf.test.ts` covers all four: same seed → identical truth, different seed → different market, three distinct segments per sector for all five sectors, and every metric inside 0–100.

---

# 57. Tests — Evidence

Test:

- Interviews generate lower reliability than pilots.
- Larger sample improves reliability.
- Repeated evidence improves confidence.
- Strong evidence moves beliefs toward truth.
- Weak evidence can sometimes mislead.
- Same seed produces same evidence.

> **✅ Implemented** — all six covered: pilot reliability 0.416 vs interview 0.173, larger samples raise `sampleQuality`, repeated strong evidence moves belief to 78 and confidence to 0.72, weak evidence moves it less, same seed → same evidence, and the stated-preference bias measured over 60 trials (+21.1 vs +2.9).

---

# 58. Tests — PMF

Test:

- High acquisition + low retention ≠ Strong PMF.
- Strong retention + payment can produce Strong PMF.
- PMF differs by segment.
- Research alone cannot create PMF.
- Changing target segment does not regenerate truth.
- Weak product fit harms retention.
- Severe price mismatch harms conversion.

> **⚠️ Partial** — five of seven asserted: high acquisition + low retention is not strong PMF, retention + payment produces `scalable`, research alone cannot create PMF, target changes do not regenerate truth, and better fit retains better. **Not asserted:** that PMF differs by segment (only *fit* differs is tested), and that a severe price mismatch harms conversion (only that it harms `priceFit`).

---

# 59. Tests — Cohorts

Test:

- Cohorts persist.
- Churn reduces active customers.
- Better-fit segments retain better.
- New cohorts can perform differently from old cohorts.
- Aggregate growth can coexist with poor retention.

> **⚠️ Partial** — cohorts persist, churn eats into them, and better-fit segments retain better are all asserted; aggregate growth alongside heavy churn is asserted indirectly through the §26 scaling test. **Not asserted:** that a new cohort can perform differently from an old one.

---

# 60. Tests — Pivot

Test:

- Segment pivot updates target.
- Repositioning cost applies.
- Segment Truth remains unchanged.
- Journal entry is created.
- Existing customers are not silently deleted.

> **✅ Implemented** — all five asserted in the "Truth never rerolls" block: the pivot updates the target, repositioning costs real weeks, `segmentTruth` is JSON-identical afterwards, customer totals are unchanged, and a `category: 'pivot'` journal entry exists.

---

# 61. Tests — Mode separation

Test:

Career:

```ts
detailedPMF === true
```

Quick Play:

```ts
detailedPMF === false
```

Arena:

```ts
detailedPMF === false
```

Quick Play Daily Challenge:

```ts
detailedPMF === false
```

No detailed PMF UI should appear outside Career.

> **✅ Implemented** — asserted for Career (true), Quick Play, Daily Challenge and Arena (all false, and all with no `career` state), in both `test/career-pmf.test.ts` and `test/modes.test.ts`. "No detailed PMF UI outside Career" is enforced by the capability filter on the nav rather than by a test.

---

# 62. Tests — Persistence

Test:

- New Career save/load.
- Legacy Career save migration.
- Quick Play save remains unaffected.
- Arena save/session remains unaffected.
- Same loaded Career state produces deterministic outcomes.

> **✅ Implemented** — legacy Career migration is asserted here; save/load round-tripping ("a Career save restores as Career"), Quick Play/Arena save integrity and determinism from a loaded state are covered in `test/regressions.test.ts`.

---

# 63. UX acceptance criteria

A first-time Career player should be able to understand within approximately five minutes:

- There are different customer segments.
- They do not know everything about them.
- Research creates evidence.
- Behaviour is stronger evidence than opinions.
- They must choose who to target.
- Retention matters.
- Marketing cannot create PMF by itself.

Do not rely on external documentation.

> **⚠️ Partial** — the Discovery screen teaches segments, uncertainty, the evidence hierarchy, the need to choose a target, and that experiments cost time and money. It does **not** teach that retention matters or that marketing cannot create PMF: retention is never shown in the UI (§23) and the briefing that would have said so is not rendered (§32).

---

# 64. Product acceptance criteria

The feature is complete when:

1. Career campaigns contain three customer segments.
2. Segment Truth is hidden.
3. Player beliefs are visible.
4. Hypothesis Board works.
5. Five research experiment types work.
6. Experiments take time.
7. Evidence updates beliefs.
8. Evidence has different reliability.
9. The player chooses a target segment.
10. Segment targeting affects acquisition.
11. Product fit differs by segment.
12. Price fit differs by segment.
13. Customers are tracked by cohort.
14. Retention differs by segment.
15. PMF is derived from real behaviour.
16. PMF can differ by segment.
17. Research cannot directly create PMF.
18. Scaling before PMF can create fragile growth.
19. Segment pivot works.
20. Pivot has a real cost.
21. Market Truth does not reroll.
22. Decision journal records important actions.
23. Weekly Career briefing explains major PMF changes.
24. Quick Play remains unchanged.
25. Daily Challenge remains unchanged.
26. Arena remains unchanged.
27. Determinism remains intact.
28. Existing systems continue functioning.
29. Tests pass.
30. TypeScript strict mode passes.
31. `npm run build` passes.

> **⚠️ Partial** — 29 of 31 met. **#20 (pivot has a real cost)** is half-met: the marketing penalty applies, the product penalty is inert. **#23 (weekly Career briefing explains major PMF changes)** is not met — the briefing is computed but never displayed. Items 24–31 all hold: Quick Play/Daily/Arena unchanged, determinism intact, tests pass, `tsc --noEmit` clean.

---

# 65. Non-goals

Do NOT implement in Career Phase 1:

- Founder Attention
- Founder Dependency
- Founder burnout
- Co-founder relationship mechanics
- Deep employee careers
- Management capacity
- Executives
- Delegation
- Company culture overhaul
- Investor personalities
- Board coalitions
- Full distribution-channel system
- Complex product portfolio
- Technical debt overhaul
- Internationalisation redesign
- New sectors
- Full competitor AI overhaul
- Living startup ecosystem
- Visual headquarters
- Company Museum
- Cross-run Founder Career
- Arena PvP redesign
- Crypto/token functionality

Avoid scope creep.

> **➖ N/A** — non-goal list. Verified held: none of the twenty-three listed systems appear in the diff. The only scope beyond the brief was calibration work (see Deviations).

---

# 66. Recommended implementation order

## Step 1 — Inspect existing PMF system

Before changing code:

Inspect:

- Existing resonance logic
- Existing research mechanic
- Existing pivot mechanic
- Product quality
- User acquisition
- Churn
- Marketing
- Sectors
- Scenario generation
- Game state
- Persistence
- Career capability handling
- Bot simulations

Document what can be reused.

Do not delete the Quick Play PMF system.

---

## Step 2 — Add Career PMF data model

Implement:

- Segment definitions
- SegmentTruth
- SegmentBeliefs
- EvidenceItem
- ActiveExperiment
- CustomerCohort
- RepositioningState
- DecisionJournalEntry
- CareerPMFState

Add tests.

---

## Step 3 — Segment generation

Implement deterministic per-sector segment generation.

Add tests immediately.

---

## Step 4 — Belief engine

Implement:

- Initial beliefs
- Confidence
- Estimate ranges
- Evidence weighting
- Belief updates

---

## Step 5 — Experiment engine

Implement all five experiments.

Ensure deterministic results.

---

## Step 6 — Segment targeting

Implement:

- Primary target
- Repositioning
- Target switching cost

---

## Step 7 — Customer simulation

Implement:

- Segment acquisition
- Pricing fit
- Product fit
- Cohorts
- Retention
- Churn

---

## Step 8 — Derived PMF

Implement segment PMF statuses.

Integrate with:

- Existing valuation
- Existing fundraising
- Existing dashboard

---

## Step 9 — Journal and explanations

Implement:

- Decision journal
- Causal explanation generation
- Biggest uncertainty
- Suggested next experiment

---

## Step 10 — Career UI

Implement:

- Segment cards
- Hypothesis Board
- Experiment controls
- Evidence results
- Cohort/retention summary
- Career dashboard PMF summary
- Inbox results
- Journal view

---

## Step 11 — Persistence

Implement:

- Save schema
- Career migration
- Reload tests

---

## Step 12 — Bots and balance

Run Career bot simulations.

Compare:

- Careless Growth
- Disciplined Discovery
- Enterprise Bet

Ensure there is no obvious dominant strategy.

---

## Step 13 — Regression testing

Verify:

- Quick Play
- Quick Play Daily
- Quick Play Scenarios
- Career
- Arena
- Leaderboards
- Persistence
- Determinism

---

## Step 14 — Build

Run:

```bash
npm run build
```

Fix all:

- TypeScript errors
- Test failures
- Persistence issues
- Determinism issues
- UI regressions

> **➖ N/A** — process. Steps 1–11 and 13–14 were followed. Step 12 (bots and balance) was performed with a throwaway harness that was not committed (§53).

---

# 67. Architectural quality requirements

Prefer:

```ts
resolveDetailedPMF(state)
```

behind:

```ts
hasCapability(state, "detailedPMF")
```

Do not replace the Quick Play PMF implementation.

Prefer:

```ts
CareerPMFState
```

as a clear subsystem rather than spreading PMF fields throughout unrelated state.

Prefer pure functions such as:

```ts
generateSegmentTruth(...)
resolveExperiment(...)
updateBeliefs(...)
resolveSegmentAcquisition(...)
resolveCohortRetention(...)
derivePMFStatus(...)
```

Simulation functions must remain:

- Pure
- Deterministic
- Testable
- Independent from React

> **✅ Implemented, with one naming deviation** — the subsystem is a self-contained `CareerPMFState` in `src/game/career/`, and every simulation function is pure, deterministic, React-free and separately tested: `generateSegmentTruth`, `resolveExperiment`, `updateBelief`, `resolveSegmentAcquisition`, `resolveCohortRetention`, `derivePmfForSegment`. There is no `resolveDetailedPMF(state)` wrapper — `engine.ts` calls `can(s, 'detailedPMF')` directly, which is the same capability accessor `hasCapability` uses.

---

# 68. Final delivery report

When finished, report:

## Mechanics implemented

Explain:

- Segments
- Hypotheses
- Experiments
- Evidence
- Cohorts
- Retention
- PMF
- Pivots

## Architecture

Explain:

- New files
- New types
- Engine integration
- Career-only capability control

## Quick Play protection

Confirm:

- Quick Play PMF unchanged
- Daily unchanged
- Arena unchanged

## Persistence

Explain:

- New Career saves
- Old Career migration
- Legacy protection

## Balance

Report bot outcomes.

Examples:

- Careless Growth median outcome
- Disciplined Discovery median outcome
- Enterprise Bet outcome range

Do not tune solely to make all bots successful.

The purpose is to detect broken strategies.

## Testing

Report:

- Tests added
- Tests passed
- Build result
- Determinism validation

## Known limitations

List what remains simplified.

> **➖ N/A** — process. The report was delivered as the body of commit `fea4ca7`, including mechanics, architecture, Quick Play protection, persistence, the bot table and known limitations. This document supersedes it.

---

# 69. Next Career feature

Do not implement automatically.

The next Career phase should be:

# Career Phase 2 — Founder & Organisation

Primary systems:

1. Founder Attention
2. Founder Dependency
3. Co-founder
4. Management Capacity
5. Employee Career Depth
6. Executives
7. Delegation
8. Conflicting Advice

Career Phase 2 should build on the new PMF system.

The founder must eventually decide not only:

> What should the company do?

but:

> Where should I personally intervene, and what must I learn to delegate?

> **➖ N/A** — correctly not implemented. Nothing in the repository touches Founder Attention, co-founders, management capacity, executives or delegation.


---

# Deviations and discoveries

Things the brief did not anticipate, which came up during implementation and are visible in the
code or in commit `fea4ca7`.

## Retention had to be recalibrated by an order of magnitude

The first pass set weekly keep rates around 0.73 — roughly 28% of a cohort surviving a month.
That is churn, not a business, and it flattened every strategy onto the same plateau because no
amount of good fit could compound. `resolveCohortRetention` in `src/game/career/pmf.ts` now
produces a band of roughly 0.85 to 0.995: about 1%/week churn when product, price and segment all
line up (a base that grows), and 15–20%/week when they do not (a bucket with a hole). The comment
in the function records the reasoning. This was a modelling bug, not a difficulty knob.

## Event-granted users belonged to no cohort and would have evaporated

Events, viral moments and story arcs award users by writing directly to `s.users`. Because
`tickCareerPMF` writes the cohort total back to `s.users` at the end of the week, every one of
those customers would have silently disappeared on the next tick. The tick now reconciles in
**both** directions at the start of the week: a surplus is absorbed into a new cohort of the
target segment, and a shortfall (a churn event, an outage, a rival stealing users) is taken off
the newest cohorts. Reconciliation happens at the start of the tick, so a late-week grant leaves
a small drift that the following week absorbs — the invariant asserted in the tests is "no silent
loss" (drift < 25), not "exactly equal always".

## The first bot harness was broken, and it looked like an economy problem

The first version of the three Career bots hired eight people on about $1k/week of revenue, and
all three strategies died of payroll. That result told us nothing about segment strategy — it
told us the bots could not run a company. The bots were fixed rather than the economy. The final
run (8 seeds, 90 weeks) shows no dominant strategy: Careless Growth survives but never gets past
"Showing value" at 28% retention; Disciplined Discovery ends smaller (238 customers) but at 72%
retention; Enterprise Bet is slowest to start and strongest at the end (527 customers, 87%
retention, Strong or Scalable PMF on 7 of 8 seeds).

## The stated-preference gap is a measured number, not a vibe

The brief asked for "strong interest, weak behaviour". Rather than hand-waving it, the bias is
asserted quantitatively in `test/career-pmf.test.ts` over 60 trials: interviews overstate
willingness to pay by **+21.1 points** on average, while a pricing test lands at **+2.9**. Those
figures come from the systematic bias branch in `resolveExperiment` and are printed by the test
run, so a future balance change that erases the lesson will fail the suite.

## Things computed but never shown

Three deliverables ended up implemented in the simulation and absent from the interface: the
weekly founder briefing (`career.lastBriefing`), the causal explanations
(`career.lastExplanations`, with an unused `explanationText()` helper), and per-segment retention
(`career.retentionBySegment`). Each is written every week and read by nothing. The engine also
discards `productCapacityDrain`, which means running experiments costs cash but no engineering
time, and the repositioning product penalty has no effect. These are the cheapest remaining wins
in the feature.
