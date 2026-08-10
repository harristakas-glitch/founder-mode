# Why a PMF number is what it is

A player reached **PMF 63, Emerging PMF** in a Social career run, targeting **Casual Users**, with
34.0k customers, 70% four-week retention, a **100/100 product** (quality 100, features 100, bugs 0),
$3.22M cash and infinite runway — and asked, repeatedly, why the number would not move.

The number was right. The game just had no way of saying why. This document is the diagnosis and
the reasoning behind the UI that now answers it without an agent.

Everything below was measured headlessly against the real simulation (`tickCareerPMF`,
`derivePmfForSegment`, `resolveCohortRetention`), not estimated.

---

## 1. Reconstructing the run

Their hidden `SegmentTruth` for `casual_users` is recoverable from what they can see.

* **`willingnessToPay` ∈ {2, 3, 4, 5}.** At quality 100 with `simplicity` focus, `productFit`
  saturates at 100 for every reachable `productRequirement`, so the only free parameter left in the
  score is price fit. Exactly four WTP values produce a score of 63 at 70% retention and 34.0k
  customers. The segment archetype's base is 10, range 0–28 — they drew near the bottom.
* **`retentionPotential` ≈ 19** (archetype base 28, range 8–48) — the value whose settled four-week
  rate is 70.0% at productFit 100, priceFit 67, bugs 0.
* `marketSize` ≈ 94, `productRequirement` ≈ 34 — neither is load-bearing.

Rebuilt with those values and run forward 80 weeks, the simulation settles at **PMF 63, 70.0%
four-week retention, ~34.9k customers.** The reconstruction is the run.

## 2. What the 63 is made of

`derivePmfForSegment` sums five terms:

| Term | Points | Max | State |
|---|---:|---:|---|
| Retention | 27.6 | 46 | **at its ceiling** |
| They pay (price fit) | 13.4 | 20 | at its ceiling — `low` is the cheapest price point in the game |
| Product fit | 14.0 | 14 | **maxed** |
| Scale | 0.1 | 12 | structurally unreachable (see §5) |
| Market size | 8.0 | 8 | **maxed** |
| **Total** | **63.1** | 100 | rounds to **63** |

## 3. The binding constraint

Retention — and it is already at its maximum.

`resolveCohortRetention` is a product of five factors. Three of them are pinned:

```
base (retentionPotential 19)  = 0.9383   ← the segment. Nothing the player controls.
fit  (productFit 100)         = 1.0150   ← MAXED. Cannot exceed 1.0150.
price(priceFit 67)            = 0.9889   ← capped: `low` is the cheapest ask available.
reliability (bugs 0)          = 1.0000   ← MAXED.
honeymoon (<4wk)              = 0.9850   ← fixed.
```

**At quality 100 with zero bugs, retention is entirely segment-bound.** There is no remaining
product-side contribution of any kind. The measured four-week rate at these settings is 70.0%,
which is exactly what they see — they are not lagging a better steady state, they are sitting on it.

## 4. Ranked levers, measured

Deltas from running `tickCareerPMF` forward 80 weeks from the reconstructed state, one lever changed
at a time:

| Lever | ΔPMF | Result |
|---|---:|---|
| 100× marketing spend (→ 303k customers) | **+1** | 64 |
| 10× marketing spend (→ 100k customers) | **±0** | 63 |
| Product focus → `performance` (their 2nd-ranked value) | **±0** | 63 |
| Product focus → `reliability` / `enterprise_readiness` | **−1** | 62 |
| Quality 100 → 60 | **−4** | 59 |
| Bugs 0 → 40 | **−13** | 50 |
| Quality 100 → 30 | **−14** | 49 |
| Pricing → `market` | **−15** | 48 |
| Pricing → `premium` | **−25** | 38 |

Every available lever is zero or negative. Their configuration —`low` pricing on a low-WTP segment,
`simplicity` focus (which *is* Casual Users' first-ranked value, `values: ['simplicity',
'performance']`), quality 100, zero bugs — is **already optimal for this segment**. There is no
mistake to correct.

## 5. Is 63 near the ceiling? Yes — it *is* the ceiling

Over every combination of price and focus, at quality 100 and zero bugs, at their current size,
Casual Users tops out at **63.1**. They are on it.

Two further caps are worth stating plainly:

* **The scale term is unreachable in practice.** `marketSize` 94 against Social's 60M TAM gives a
  segment ceiling of 25.6M customers, and the scale term only fills at 12% of that — **3.08M
  customers, 90× what they have.** 100× marketing spend over 80 weeks reached 303k and bought one
  point. On large-TAM segments this term is close to inert.
* **The status band is hard-capped.** `strong` requires four-week retention above 72%. Casual Users
  at `retentionPotential` 19 cannot exceed 70.0% at any price or quality — it would need
  `retentionPotential ≥ 27`. **This segment can never leave "Emerging PMF"**, whatever the score.

The only lever with room is repositioning. Measured from their state (median-draw truth for the
other two Social segments, 90 weeks including the repositioning penalty):

| Segment | Best pricing | PMF after 90wk | 4-wk retention |
|---|---|---:|---:|
| Creators | `low` | **85** (Scalable) | 89.9% |
| Brand Advertisers | `premium` | **82** (Scalable) | 90.7% |
| Casual Users (staying put) | `low` | 63 (Emerging) | 70.0% |

Across 500 seeds, the *ceiling* at 34k customers is: Casual Users median 69 (p10 62), Creators
median 84, Brand Advertisers median 80. This player drew a below-median Casual Users and is playing
it perfectly.

**A player with a perfect product, 34k customers and infinite runway is capped at 63 purely by who
they chose to sell to.** That is the lesson Career exists to teach; the game simply never said it.

---

## 6. What was added to the UI

All of it in the presentation layer (`src/CareerUI.tsx`, `src/screens/Discovery.tsx`) — nothing under
`src/game/career/**` was touched.

* **`pmfDiagnosis(game, segmentId, snapshot)`** — decomposes a segment's score into the five terms,
  forecasts the retention a cohort won *today* will report, computes the segment's ceiling over every
  price and focus at quality 100 / zero bugs, and prices each lever by projecting the score the way
  the tick scores it.
* **`PmfBreakdown`** — renders the five terms with bars and which are exhausted; a *what is actually
  holding it back* paragraph that says **"nothing you can build"** when the product side is
  saturated; a *ceiling* paragraph; a warning when the next status band is unreachable at any price
  or quality; and a ranked lever list where a maxed lever reads `±0 MAXED` rather than being omitted.
  Full panel on Discovery, condensed into `PmfExplainer` on the Dashboard.
* **`SegmentHealth`** gains an **"Its ceiling"** column, shown only for segments with real customer
  behaviour to read — a segment you have never sold to keeps its ceiling secret, because that is
  still a discovery question.

### Two formula details are restated in the UI, and guarded

`derivePmfForSegment` returns one rounded score and nothing else, so the term weights (46/20/14/12/8)
are restated in `CareerUI.tsx`. They are **checked**: `pmfDiagnosis` recomputes the total and returns
`null` — the panel disappears — if it does not round to the score the tick actually produced. If
someone reweights the formula, the UI goes quiet instead of lying.

The cohort lifecycle is likewise restated (see §7). `resolveCohortRetention` still does all the
arithmetic; only the number of applications lives in the UI.

**If `src/game/career/pmf.ts` becomes editable, the right fix is to export the decomposition from
`derivePmfForSegment` itself** — something like `pmfComponents(args): Record<PmfTerm, number>` that
the score is summed from, plus a `settledRetention()` helper wrapping the five-decay lifecycle. Then
the UI imports the truth instead of mirroring it.

## 7. A bug found and left alone

**`retentionAt4wk` measures five weeks of churn, not four.**

In `tickCareerPMF`, a newly acquired cohort is pushed and then decayed *in the same week*
(`weeksSinceAcquired = 0`), and the snapshot fires on the tick where `s.week - c.acquiredWeek >= 4`.
That is five applications of `resolveCohortRetention` — four inside the `weeksSinceAcquired < 4`
honeymoon and one outside it.

Measured on the reconstruction: four decays give 69.9%, five give **65.2%**, and the live sim reports
65.2%. The label says four weeks.

It is not obviously wrong to charge a cohort a week of churn on arrival, but the metric is named,
displayed and reasoned about as *four-week retention*, and it feeds 46 of the 100 PMF points. The
practical effect is a systematic ~4.7pp understatement of every retention reading in the game, which
in turn understates PMF by ~4 points across the board.

**FIXED.** The window is now one exported constant, `RETENTION_WINDOW_WEEKS`, which is simultaneously
the length of the honeymoon in `resolveCohortRetention` and the number of weekly keep rates
`retentionAt4wk` is the product of — they cannot drift apart again, and a test asserts the keep rate
changes on exactly the week the window closes. The snapshot now fires on `cohortDecaysApplied` rather
than on calendar age, the two differing by one precisely because of the decay-on-arrival above.

Measured over 60 runs of 70 weeks across five sectors: median four-week retention on the target
segment **62.81% → 67.12%** (+4.31pp) and median PMF **50 → 54**, matching the prediction here.

The two restatements in §6 are down to one. `settledRetention` in `CareerUI.tsx` now forwards to an
exported `settledCohortRetention`, so the forecast reads the lifecycle instead of mirroring it, and
`src/screens/CohortAnalytics.tsx` reindexed its triangle from calendar offset to weeks-of-churn —
without which the frozen four-week number sat in the column labelled 3 and column 4 showed a fifth
week of decay. Only `PMF_WEIGHTS` is still restated in the UI.
