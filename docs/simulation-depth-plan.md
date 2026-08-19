# Simulation depth — four features, specced against the code

Owner-selected, 2026-08-16. Each is specced against real call sites so the build starts from a
design rather than inventing one. Nothing here is built yet.

The four share a theme, and it is worth naming because it is the actual weakness they fix:
**the simulation has very few costs that compound over time.** Revenue lands the week it is earned,
shipping fast costs nothing later, churn is a rate rather than a diagnosis, and every role helps
every company equally. Real startups are hard precisely because of lags and compounding.

---

## 1. Cash flow vs revenue — Career only

**The gap.** `engine.ts:1634` computes `coreRevenue` and it lands in `s.cash` the same week. There
is no receivable, so a company cannot be profitable and insolvent — which is the most instructive
death in the genre and currently unreachable.

**Design.** A receivables queue on `CareerPMFState` (Career only, per the owner: Quick Play and
Arena keep same-week cash). Revenue booked this week is *recognised* now and *collected* after a
per-segment delay: consumer segments pay immediately, enterprise pays on terms. `SegmentTruth`
already carries `salesCycleWeeks` for the acquisition lag; collection terms are its natural sibling
and should be a separate field so the two lags are independently readable.

**Why it earns its place.** It makes three existing systems suddenly cohere:
- **Debt** becomes what it actually is — bridging the gap between earning and being paid — instead
  of a slightly worse fundraise.
- **Pricing** gains a real dimension: discount for prepayment, or hold price and finance the gap.
- **Enterprise segments** get a genuine downside to match their high WTP, beyond a slow close.

**Shape:** follow the `salesCycleWeeks` pipeline precedent exactly — an optional array on the career
slice, absent-means-empty for save compat, zero new RNG draws, and a Career-only capability so
`npm run bots` moves measurably and the golden traces (Quick Play) cannot.

**Player surface:** the Finance screen needs *cash* and *revenue* as two different lines, plus
"collected / outstanding". Without that the mechanic is invisible and reads as a bug.

---

## 2. Technical debt as a first-class stock

**The gap.** `features`, `quality` and `bugs` exist. `bugs` is a *level* that churns customers and
scares press; nothing models the compounding cost of having shipped fast — that future features
cost more to build.

**Design.** A fourth product stock, `techDebt`, which:
- **accrues** from `featureGain` (shipping fast adds it, faster when quality allocation is low),
- **taxes velocity**: `engPoints` are effectively reduced as debt rises — this is the whole point,
  and it is what `bugs` does *not* do,
- **is paid down** by an allocation slider or by explicit refactor weeks,
- **decays never** on its own. Debt is the one stock that does not revert.

**Why it earns its place.** It converts the allocation sliders from a within-week trade into a
**time-preference decision** — the thing they currently lack. It also gives the craftsman trait and
the "rewrite vs ship" argument a real answer, and it is the natural counterweight to the P2 balance
work that made quality a stock feeding PMF.

**Balance caution.** The P2 pass established each slider has its own clock (research saturates,
shipping is a flow, quality is a stock). Debt is a *negative* stock with no saturation, so it must
be capped or the endgame becomes unplayable — and its cap must be measured, not assumed.

---

## 3. Sales pipeline + role impact varies by sector — the biggest of the four

### 3a. Roles do not vary by company type, and they should

**The gap, precisely located.** Four role channels, identical in all six sectors:

| Role | Channel | Line |
|---|---|---|
| engineer | `featureGain`, `quality`, `bugs` | engine.ts:1449, 1474–1480 |
| designer | `quality` (×0.22 only) | engine.ts:1455, 1476 |
| marketer | hype gain | engine.ts:1567, 1574 |
| sales | `salesBoost` = `1 + salesPoints/40` on revenue | engine.ts:1619–1634 |

`Sector` has **no role field at all**. So a Social App account executive lifts revenue exactly as
much as a B2B SaaS one, which is backwards: social monetises through scale and attention, not
through a sales team.

**Design.** Add a per-sector role profile to `Sector`, applied as a multiplier on each role's points
before the existing formulas consume them — no formula changes, one multiplication at four sites.
Indicative shape (to be **calibrated, not asserted**):

| Sector | engineer | designer | marketer | sales |
|---|---|---|---|---|
| B2B SaaS | 1.0 | 0.9 | 0.8 | **1.4** |
| Fintech | 1.1 | 0.8 | 0.7 | **1.3** |
| Dev Tools | **1.3** | 0.7 | 0.9 | 0.7 |
| AI/ML Infra | **1.5** | 0.6 | 0.7 | 1.1 |
| E-commerce | 0.9 | 1.2 | **1.4** | 0.6 |
| Social App | 1.1 | 1.3 | **1.5** | **0.3** |

**The bar this must clear** — the same one pricing and founder kinds had to: **every role must be
first, or near-first, in a nameable situation.** A role that is never worth hiring is a dead
mechanic, and designer is the one at risk today (it reaches exactly one term at ×0.22).
Designer likely needs a second channel — retention or conversion — regardless of sector weights.

**Player surface, and this is also onboarding:** the Hiring screen should say what *this* company
needs. "Social App — marketers and engineers build this business; sales barely moves it" teaches the
sector's identity at the moment the player is spending money on it.

**Optional follow-on, not required:** new sector-specific roles (support, ops, data, compliance).
Weights first — they are cheap, safe and testable; new roles need salaries, candidate generation and
UI, and should only follow if weights prove the concept.

### 3b. The pipeline

`salesCycleWeeks` now lags deals but there is no funnel. Leads → qualified → pilot → closed/lost,
with rep capacity as the constraint and named enterprise opportunities that can be **lost** —
including to a rival, which gives rival aggression a second front that is not an attack. Gate this
behind the role work: a pipeline is only meaningful once sales *means* something different per
sector.

---

## 4. Churn with reasons

**The gap.** Retention is a scalar. `resolveCohortRetention` (career/pmf.ts:534) already receives
`truth`, `productFit`, `priceFit`, `bugs` and `weeksSinceAcquired` and computes each term — it just
collapses them into one number before anyone can see which one dominated.

**Design.** Return a breakdown alongside the rate: the weekly keep rate *plus* the attributed share
of the loss per cause (fit, price, bugs, age/novelty, and — where the token slice is live —
incentive withdrawal). **This is nearly free**: the terms exist, the function simply does not report
them. Cohorts already store `priceAtAcquisition` and `productQualityAtAcquisition`, so per-cohort
attribution is available without new state.

**Why it earns its place.** It turns retention from a number you watch into a **problem you
diagnose**, which is exactly the loop Career exists to teach. It feeds the Cohort Analytics screen,
the advisors ("we are losing them on price, not on product"), and the causal explanations. It is
also the single best answer to the onboarding question "why did that happen?" — the highest-value
onboarding in a simulation is post-hoc causality.

**Caution.** Attribution must be honest: if the terms are multiplicative, a "share of loss" is a
modelling choice, not a fact. State the decomposition rule in the code and make sure the shares sum
to the actual loss, or the screen will quietly lie.

---

## Sequencing note

All four touch `src/game/engine.ts` and/or `src/game/career/`. They should NOT be built in parallel
with a structural refactor of `engine.ts` or with balance retuning of the same constants — the merge
cost exceeds the parallelism gain. Build order, by dependency and risk:

1. **Churn reasons** — most isolated, near-free, immediately useful to onboarding and analytics.
2. **Role weights** — small, high-impact, must be calibrated against "every role first somewhere".
3. **Technical debt** — needs its own balance pass; the cap is the risky number.
4. **Cash flow** — largest surface (Finance screen, debt interaction, per-segment terms).
5. **Sales pipeline** — gated behind role weights.
