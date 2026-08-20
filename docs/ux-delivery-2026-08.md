# UX delivery report — August 2026

The brief's §66 report. What was asked is in the owner's brief ("Founder Mode — UI-UX
Simplification & Founder HQ Redesign"); what was found is in `docs/ux-audit-2026-08.md`; this is
what shipped, commit by commit, with the one open item named at the end. Every claim here is
checkable against a commit on `main`.

The one-sentence version: **the game got simpler to read while nothing underneath it changed** —
every phase was gated on the full suite and a byte-identical `npm run bots`, including the commit
that touched `engine.ts`.

---

## 1. UX changes — the major flows

| Flow | Before | After |
|---|---|---|
| Landing (weekly loop) | A Dashboard that could not state a purpose: 16 equal boxes, the "what should I do?" answer at 13.5px against 34px data | **Founder HQ**: one hero (the binding constraint), four causally-ranked metrics, the attention list with the top item raised and named |
| Being warned | One function ending `slice(0, 3)` over push order — a `good` item could silently discard "you can be replaced". Eleven run-ending events had no route to the player; six had none at all | **The attention register** (`src/attention.ts`): severity is a type, sorted severity-then-deadline, returned unsliced. All eleven events route. Every item names the thing — "Blue Harbor offers $900k for 10%", never "1 decision waiting" |
| Week resolution (Career) | Everything dumped at once | **The weekly briefing** (§28): one story, four numbers, two "also" lines, the register's top item as next step, one Continue. A week where nothing moved says "A quiet week" and stops |
| Signing a term sheet | "Investing $1.5M for 18%" — consequences discovered after signing | **§17 context beside the Sign button**: runway before → after, ownership before → after, what happens to the board (including that a later sheet resets it and wipes strikes — never stated anywhere before), the bar you'll be held to, down-round flagged on the engine's exact condition |
| Medium-depth questions | A navigation per answer | **Glance → Understand → Analyse** (§19): click an HQ metric, get a plane-3 drawer with the why and one link deeper |

## 2. Founder HQ — hierarchy and the recommendation logic

The hero is **the binding constraint, decided by the engine** in strict precedence: the money
clock when it ticks (death) → the board's bar when you're under it (fired) → the fit clock while
the market hasn't said yes (the slow death every run starts in) → runway as the calm default. The
label names the constraint, so the screen teaches what the game currently is.

The four supporting metrics are ranked by **causal weight in the engine's own formulas**, not by
dashboard convention — PMF appears superlinearly (^1.5) in word-of-mouth, linearly in paid
acquisition, and dominantly in churn, so fit is slot 1; the growth *rate* (what the board fires
you over) is slot 2 with the user *count* demoted to its small print; revenue and People
(headcount · **lowest** morale · founder energy — lowest, because an average mathematically hides
the person about to quit) close the row.

"Next best step" **is the register's top item** — one recommendation or none, never a second
parallel evaluation, because two functions scoring the same health is how `Benchmarks` and
`attentionItems` had already drifted apart. A calm run recommends nothing; that silence is tested.

## 3. Navigation — before and after

```
BEFORE (13 rows, filed by noun)          AFTER (6 areas, filed by decision)
Dashboard · Inbox · Team · Hiring        HQ        this week · inbox
Discovery · Cohorts · Product            Market    growth (lands here) · rivals
Growth · Market · Finance                Product   build (lands) · discovery · cohorts
Fundraising · Story · Career             People    hiring (lands) · team
                                         Capital   raise (lands) · finance
                                         Company   story (the record; never badges)
```

- Screen order within an area is priority: an area **lands on its lever, never its report**
  (owner call — Growth over Rivals, Hiring over Team, Raise over Finance).
- Every old ScreenId still works; `screen: 'career'` in an old save aliases to the HQ. No routing
  rewrite (§56), no save invalidation (§57).
- **World was not built** — its entire candidate content was one unlabelled sparkline plus a
  climate line derived from the same inputs. An empty area is the placeholder page §12 forbids.
- Mobile: the five real areas are the tab bar; "More" went from hiding **9 of 13** destinations to
  holding **one**.
- Sibling tabs are bordered pills with the active one raised to plane 3 — redone after the owner's
  verdict that the first cut's bare grey text was invisible.

## 4. Noise reduction — removed, consolidated, moved deeper

Headline numbers: Dashboard **16 boxes → 5**; Finance **11 → 4**; Growth **6 → 2**; the topbar
rail **9 metrics → 3** (its nine numbers had been re-rendered 42 more times across nine screens);
nav badges **3 → 1** (the candidates badge read a constant 5 forever — an affordance carrying zero
bits); `Career.tsx` **deleted** (zero controls, stats wrong by construction).

Consolidations: one candidate list where two had drifted; one `Disclosure` component where nine
screens had hand-rolled `<details>`; one churn formula where two UI copies existed — **and the
copies were stale**: both still used pre-rebalance constants, under-weighting quality 2× and bugs
2.2× against what the tick actually charges. The one screen explaining churn was mis-explaining
it. Now a single `effectiveChurn()` in the engine, constants matched to the tick, with a docblock
ordering that any rebalance changes both in the same commit.

Real bugs fixed on the way, all found by reading the engine rather than the screens: the
severity-blind `slice(0,3)`; a React hooks-order violation in Discovery; Growth's slider clamping
its *display* to a cap the engine billed past; Team's morale bands showing 40/60 against the
engine's real 32/55 resign thresholds; the cohort chart unreachable on touch.

## 5. Progressive disclosure — where Glance → Understand → Analyse lives

- **HQ metrics**: card → plane-3 drawer → owning screen (revenue→Finance, growth→Market,
  fit→Discovery/Product, people→Team).
- **Attention**: top item full weight → two rows → "N more" behind a disclosure.
- **Prose**: Fundraising's ~3,480 default words, Finance's four explainers, Market's footers,
  Discovery's manual — all behind `Disclosure`. The cohort triangle (192–960 cells) closed by
  default.
- The two deliberate exceptions are documented in code: the covenant consequence stays on the
  panel face (it is the only statement that a breach costs 15% of the company), and Team's
  all-hands summary is a header row a string label cannot carry.

## 6. Mode differentiation

- **Quick Play**: no briefing modal, the 950ms week sweep, career-only screens gated out — its
  Product area is one screen with no tab chrome. The fit-clock hero uses PMF pace; the drawer
  explains PMF, not retention.
- **Career**: the briefing, retention-based fit everywhere PMF would mislead, the living-world
  blocks (FounderBriefing, TeamOpinions, Commitments, BoardMeeting) intact and capability-gated.
- **Arena**: excluded from the briefing (a modal must never sit on the round clock); the round
  timer rides the slimmed rail. **§42/§43 (standings hierarchy + round reveal) is the one brief
  item not yet built** — see §8.

## 7. Components — new and consolidated

New: `attentionRegister`/`nextBestStep` (pure, tested), `AttentionList`, `Hero` (binding
constraint), `MetricDrawer`, `WeeklyBriefing`, `Disclosure`, `NESTED`/`RAISED` plane exports, the
runway top-edge rule. Deleted: `Career.tsx`, Finance's `Explainer`, Market's `More`, the
Benchmarks panel, `WeekDigest`, two chart panels, one of Hiring's two candidate lists.

## 8. Testing, and the one open item

Every phase gated on: `tsc` clean → `npm run build` → full suite (28 files, including 14 new
assertions for the register: the severity invariant, purity — the register may not mutate or even
reorder the caller's arrays — and "a calm run produces nothing") → **`npm run bots` byte-identical
to the pre-work baseline** (md5 `8f02371…`), including the commit that added an export to
`engine.ts`. Verified in-browser at 1280×860 and 375×812 at each phase; save compatibility
exercised by carrying one Career save across every change in this document.

**Open: Arena §42–§43.** The standings hierarchy and round reveal need a session-local snapshot of
the previous round's presence data to compute deltas; scoped and next. Nothing else from the brief
is outstanding.
