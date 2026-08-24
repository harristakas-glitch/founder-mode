# Business Simulation V2 + Game Engagement — implementation contract

Owner briefs (2026-08-24, "the biggest update till now"):
`founder-mode-business-simulation-v2-claude-code-spec-integrated-v2.md` +
`founder-mode-game-engagement-replayability-roadmap-integrated-v2.md` + the architecture
context. ONE coordinated upgrade to Simulation, not two projects. This doc is the execution
contract: the decisions, the state design, the gate, the phase plan, and what each phase must
prove before the next starts.

## 0. The one rule

**V2 creates the truth. Engagement turns the truth into a game.** Engagement never applies an
economic consequence V2 already priced (no double counting); every Major-Moment choice maps to
a real domain action; characters interpret real state, never invent facts.

## 1. Mode boundary and the construction gate (decision D1)

- Quick Run and Arena keep the existing engine, byte-exactly. Every V2 system is designed
  behind depth/config switches so any piece can later be enabled per-mode with a one-word
  change (owner: "design all the features so we can selectively add them in the future").
- Simulation ships V2 — but the game DEPLOYS CONTINUOUSLY, so V2 cannot become the default
  economic engine while half-built. Gate:

```ts
config.engine?: 'v1' | 'v2'        // absent = v1 — every existing save, quick, arena
usesBusinessSimulationV2(s) === (s.config?.mode === 'career' && s.config?.engine === 'v2')
```

  New-run UI exposes "Simulation V2 (beta)" on career setup once phase 1 is playable; it
  becomes the default for NEW Simulation runs when the MVP boundary (spec §67) is met.
  Existing Simulation saves stay on V1 forever (spec §45.1 safe option — chosen over risky
  migration; documented here). The V1 career engine, its balance calibration and its winrate
  gate remain intact and tested until V2 replaces it as default, at which point the probe
  gains V2 lanes.

## 2. What already exists → what feeds V2 (never duplicated)

| Existing system | V2 role |
|---|---|
| Career segments/truth/beliefs (career/pmf.ts) | The DNA of V2 MarketSegments: per-sector templates seeded from the same generator idea, richer state (attribute prefs, WTP dispersion, channel access). V1 career machinery untouched for V1 runs. |
| Product allocation + quality/bugs/features | Inputs to V2 ProductAttributes (roadmap items carry attribute effects; quality/bugs feed Reliability). |
| Roadmap initiatives (strategic/roadmap.ts) | Gain optional `attributeEffects` — in V2 they move product attributes; in V1 they keep their impact axes. One content pool, two readers. |
| Growth mix (performance/brand), CRO | V2 GTM channels: performance→paid channel, brand→brand asset feeding awareness/WTP/organic; CRO→funnel conversion. |
| Hiring/Team, people model | Payroll → finance; seniors/roles → GTM + functional capacity supply. |
| AI adoption | Capability multipliers on throughput/capacity (already built phase 5 of strategic systems). |
| Big Bets, Founder Attention, Management Capacity, coherence | Cross-cutting modifiers, exactly as they already compose via strategic/effects.ts. |
| Capital section (game/finance.ts) | The presentation home for V2 financial truth — pnlRows/unitCards read V2 finance when the run is V2. |
| Board (targets/strikes) | Extended: BoardConfidence + commitments become first-class; V1 strike machinery keeps running V1 runs. |
| Rivals | V2 competitors participate in the SAME utility/choice market (no scripted share). V1 rival model keeps serving V1/quick/arena. |
| Living world / director / composer | The delivery mechanism for engagement reactions — new beat types, same composer. |
| history / finHistory / rounds | Superseded in V2 by `SimulationV2WeeklySnapshot` (richer), which ALSO backfills history so every existing screen keeps working. |

## 3. State design

```ts
// GameState addition — absent means V1 (saves never invalidate)
simV2?: BusinessSimulationV2State   // src/game/sim2/types.ts
```

Root state per spec §32: market, product, pricing, research, planning, gtm,
functionalCapacity, cohorts, competitors, finance, boardConfidence, investorConfidence,
weeklyHistory (snapshots, capped), events (this week), pendingResearch. TRUTH fields live only
inside `simV2`; UI reads SELECTORS that return estimates + confidence — no component may touch
`.truth` (enforced by a test grepping screen imports).

## 4. Shared contracts (phase 0, used by every later phase)

- `SimulationEvent` — exactly the spec §0A.2 shape.
- `SimulationExplanation` + `SimulationDriver` — spec §0A.3; the Capital hover panels, briefing,
  resolution, board reactions and postmortem all consume THIS, not bespoke logic.
- `EstimatedValue { truth, visibleEstimate, confidence, uncertaintyRange, lastUpdatedWeek }`.
- `importance = magnitude × strategicRelevance × urgency × novelty × confidence` — one ranker.
- Evaluator interfaces: objectives, milestones, chapters, major-moment triggers — pure
  functions of (prevSnapshot, snapshot, state).
- Weekly snapshot: compact, persisted every week, feeds charts/chapters/milestones/postmortem.

## 5. Resolution order (spec §0A.18, 35 steps)

`resolveWeekV2(s)` is called from advanceWeekInner when the gate is on, REPLACING the V1
economic core (acquisition/churn/revenue block) while keeping the shared ticks that feed it
(roadmap, bets, AI, attention, capacity, world, macro). Implemented as ordered pure resolvers,
each returning `{state, events, explanations}` (spec §0A.1). Seeded RNG only — the engine's
existing `seeded()` discipline; Math.random is banned (tested).

## 6. Engagement surfaces (built with, not after)

- Weekly Briefing: the Dashboard's CEO Brief consumes ranked events (career V2).
- Week Resolution: after Decide, a reveal panel (inline, NO modal in the weekly loop — the
  house rule stands; it renders as the top of the HQ, dismissible) shows the ranked top ~6
  consequences with drivers.
- Major Moments: trigger interface in phase 0; experiences in phase 5 (they reuse
  activeMajorEvent-style locking ONLY for board intervention/cash crisis per the brief).
- Objectives/chapters/milestones/identity/postmortem: phases 6-7, all reading snapshots.

## 7. Phase plan (both specs' sequences merged; one commit per phase, tests each)

0. ✅ **Foundation** — gate, root state, contracts, snapshot, ranker, evaluator interfaces,
   archetype config skeleton, determinism harness. Goldens/quick/arena untouched (proved).
1. ✅ **Economic heart + first playable loop** — segments, product attributes, pricing/WTP,
   utility/choice (softmax + outside option), demand, competitor offers; minimal Week
   Resolution behind the beta flag. Determinism + reconciliation + monotonicity tests.
2. **GTM + cohorts + finance** — channels, saturation, sales capacity, acquisition, cohorts,
   retention/expansion, revenue/COGS/OpEx, cash, unit economics; Capital reads V2 truth.
3. **Forecast/Budget/Board** — planning horizons, forecast, budget, commitments, Plan vs
   Actual with controllability, Board+Investor confidence, board objectives.
4. **Research + fog of war** — EstimatedValue everywhere player-visible, research catalog,
   delayed studies, competitor intelligence, Discovery integration.
5. **Functional capacity + Major Moments** — capacity domains, overload, crisis triggers,
   price war/cash crisis/board intervention/capacity crisis experiences.
6. **Chapters + milestones + identity** — state-driven chapters, milestone detection,
   company timeline, emergent identity.
7. **Postmortem + scenarios** — end-of-run story from snapshots, scenario library as V2
   initial states.
8. **Balance + polish** — headless V2 bot lanes in the winrate probe, tuning, reveal polish,
   progressive disclosure audit.

## 8. Testing gates (every phase)

- Determinism: same seed+state+decisions → identical state (deep-equal).
- Reconciliation: Revenue−COGS=Gross; Gross−OpEx=Operating; cash movement reconciles.
- Choice shares + outside option sum to 1 (±1e-9) per segment.
- Monotonicity: better fit never lowers utility; price ≫ WTP lowers purchase; better brand
  never lowers demand.
- Truth isolation: no screen module imports a `.truth` path (static test).
- V1 untouched: goldens byte-identical, full suite, calibration gate — every phase.

## 9. Decisions log

- D1 (gate): new-run opt-in flag during construction; V2 default for new Simulation runs only
  at MVP boundary; old saves stay V1. Safety over migration (spec §45.1).
- D2 (naming): module lives at `src/game/sim2/` — short, greppable, mirrors spec §31 layout.
- D3 (segments): V2 market templates are per-sector data (config/markets.ts), generated
  deterministically per run seed like career segment truth — familiar DNA, richer shape.
- D4 (no double counting): V1 multipliers that price the same phenomenon are NOT applied on
  top of V2 (e.g. V2 churn comes from cohorts/service, so smods.churnRelief folds INTO cohort
  retention drivers, not onto the result twice). Each resolver documents which V1 inputs it
  consumes.
- D5 (Week Resolution): inline reveal, never a modal — the no-modals-in-the-weekly-loop house
  rule outranks the brief's "may temporarily lock" for routine weeks; locking is reserved for
  the rare Major Moments that genuinely take over (phase 5).
