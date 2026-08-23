# Strategic Systems Expansion — implementation architecture

Owner brief: `founder-mode-strategic-systems-master-brief-v3.md` ("the biggest update since
day 0"). This doc is the execution contract: what exists vs what's new, the state design, the
exact engine integration points, the phase plan, and the testing/balance strategy. Written
before the first line of code, updated as phases land.

## 0. What already exists (build on, never duplicate)

| Brief system | Existing foundation |
|---|---|
| Living World & Memory (§12) | **Fully built**: `src/game/world/` — characters, semantic memory, promises ledger, relationships, narrative composer, Narrative Director, interactions. Extend with Big-Bet reactions + rival memory only. |
| Board (§8) | `Board` state (targetGrowth, nextReview, strikes, defied), board review in engine, `BoardMeeting`/`Commitments` panels, promises-to-board via world promises. The NEW part is the full-screen locked meeting event. |
| Management Capacity (§11) | `coordinationDrag(s)` (headcount drag 1.0→0.6) + hiring screen's coordination-overhead copy. Formalize into demand/supply with executive leverage; stays mostly DERIVED. |
| Tech debt | `technicalDebt` capability + quality/bugs machinery. Roadmap adds a debt number that feeds the existing bug/velocity paths. |
| Founder energy | Implemented. Attention is a SEPARATE mechanic (allocation), energy stays (stamina). |
| Segments/evidence | Career PMF machinery — roadmap segment-impact and evidence-confidence plug into it. |
| Capabilities | `GameCapabilities` + `resolveGameRules` — the depth model extends this, no scattered mode checks. |

Genuinely new: **Product Roadmap (named initiatives), Big Bets, Founder Attention, AI Adoption,
Strategic Coherence (derived), the board-meeting EVENT.**

## 1. Depth model

`src/game/modes.ts` gains:

```ts
export type SystemDepth = 'off' | 'light' | 'deep' | 'competitive'
export interface SystemDepthConfig { roadmap; bigBets; aiAdoption; strategicCoherence;
  founderAttention; managementCapacity; livingWorld; boardMeetings: SystemDepth }
```

resolved per mode exactly as the brief's table (quick=light, career=deep, arena=competitive
with attention/board **off**). Exposed as `rules.systemDepth`; engine code asks
`depth(s,'roadmap') !== 'off'`, never `mode === 'career'`.

## 2. State design (all slices optional — absent means default; saves never invalidate)

```ts
// GameState additions (src/game/types.ts)
roadmap?: {
  active: { id: string; progress: number; startedWeek: number }[]   // capped slots by depth
  queued: string[]                                                   // NEXT, ordered
  done: { id: string; week: number }[]
  debt: number                                                       // 0–100 tech debt
}
bigBet?: {
  type: BigBetType; startedWeek: number; targetWeek: number
  status: 'active' | 'completed' | 'abandoned' | 'failed'
  progress: number                                                   // 0–100
  milestones: { id: string; doneWeek?: number }[]
}                                                                    // null-able: no bet chosen
attention?: {
  focus: FounderAttentionArea | null              // light modes: one Focus
  allocated?: Partial<Record<FounderAttentionArea, number>>  // deep: weekly points
  dependency: Partial<Record<FounderAttentionArea, number>>  // 0–100, grows with involvement
}
aiAdoption?: {
  areas: Partial<Record<AIAdoptionArea, { maturity: 0|1|2|3|4; progress: number;
    quality: number; resistance: number }>>
  active: { id: string; area: AIAdoptionArea; progress: number; startedWeek: number }[]
}
```

Derived (never stored): management capacity, strategic coherence, all multipliers.
Content (initiative pools, big-bet archetypes, AI initiative catalogue) lives in
`src/game/strategic/content.ts` keyed by sector — data, not save state.

## 3. Effect composition — ONE choke point

`src/game/strategic/effects.ts`:

```ts
// additive parts, diminishing, hard-capped — never 1.4*1.4*1.4
export const composeBonus = (parts: number[], cap: number) =>
  1 + clamp(parts.reduce((a, b) => a + b, 0) * (1 - 0.25 * Math.max(0, parts.length - 1) / 4), -cap, cap)

export function strategicModifiers(s: GameState): {
  buildVelocity: number      // → product allocation output      (cap ±35%)
  acquisitionEff: number     // → growth/marketing effectiveness (cap ±20%)
  opexMult: number           // → weekly burn                    (cap −20%…0)
  workloadRelief: number     // → morale drain / energy costs    (cap 20%)
  supportQualityRisk: number // → bug/incident probability       (cap +25%)
  mgmtDrag: number           // REPLACES coordinationDrag input   (0.55–1.0)
}
```

Every multiplier's inputs: AI maturity×quality, coherence, tech debt, management overload,
big-bet synergy, attention. Guardrails per brief §21: most parts ±5–20%.

## 4. Engine integration points (each one line, each named here, each tested)

1. `advanceWeekInner` gains `tickStrategic(s)` at a FIXED position (after product/market
   resolution, before living-world tick), seeded via the existing `seeded()` discipline.
   It advances roadmap progress, big-bet progress, AI initiatives, attention effects,
   dependency drift, and emits inbox events through the existing director.
2. Employee output line (`eff(e)` ~engine:1650): `coordination` becomes `mgmtDrag` from
   strategicModifiers (same clamp shape; defaults reproduce today's coordinationDrag exactly).
3. Product allocation output: × buildVelocity.
4. Marketing/user acquisition: × acquisitionEff.
5. `weeklyBurn`: × opexMult.
6. Bug-generation path: × supportQualityRisk (and roadmap.debt feeds existing bug odds).
7. Board review: reads big-bet commitment status (phase 8).
8. Career PMF: **no direct hook — AI adoption never touches PMF directly (brief §5.10).**

## 5. Golden traces policy

New systems tick in ALL modes (light/competitive), so goldens WILL move. Per phase:
regenerate goldens in the same commit, with the balance probes re-run and their deltas
recorded in the commit message. A golden change without a probe read is a red flag.

## 6. UI map (one primary decision surface per screen — brief §28)

| Surface | Where | Depth |
|---|---|---|
| Roadmap (NOW/NEXT slots, initiative cards w/ segment fit + bet alignment) | Product area → new `roadmap` screen; Build keeps the weekly sliders | light: 2 slots, small pool; deep: full |
| Big Bet (choose / active program card) | HQ area → new `strategy` sibling screen; compact card on HQ | all modes |
| AI Adoption (maturity chips + initiatives) | Product area → `roadmap` screen section (light) / own `ai` screen (deep) |
| Founder Attention | HQ card: light = one Focus chip-row; deep = 8-point allocator | career deep; arena off |
| Management capacity | qualitative line in People/Team header + HQ pulse context | derived |
| Coherence | qualitative signals only (CEO Brief line, character lines) | hidden |
| Board meeting | full-screen locked event (`activeMajorEvent`), career only | deep |

## 6.5 Addendum — the Growth Engine (second owner brief, same day)

A ninth system arrived mid-expansion: "Growth Engine — CRO + Marketing Mix". Integrated as
phase 3 (it builds directly on the roadmap): the marketing budget splits into PERFORMANCE
(feeds the existing paid-acquisition curve immediately) and BRAND (a lagged, compounding,
decaying stock: organic pull + cheaper CAC + a little pricing trust); CRO is a roadmap
initiative TYPE that competes for the same slots and is ceilinged by PMF. Default mix 100%
performance = the pre-expansion game. All effects through the same capped composer; reads in
docs/balance-strategic.md.

## 7. Phase plan (brief §25 order; one commit per phase, tests+goldens+probes each)

1. ✅ **Foundation + Roadmap** — depth config, state+migration, effects module, tickStrategic,
   roadmap engine + content pools (6 sectors), Roadmap screen, tests.
2. ✅ **Big Bets** — model, 6 archetypes, alignment, milestones, synergy (capped), selection +
   program UI, roadmap alignment labels, tests.
3. ✅ **Growth Engine** (inserted — see §6.5) · then **Founder Attention** — focus (light) / points (deep), crisis forcing, dependency,
   delegation hooks from executives, tests.
4. **Management Capacity** — demand/supply derivation, overload states, executive leverage,
   mgmtDrag replacing coordinationDrag, tests.
5. **AI Adoption** — areas, maturity ladder, initiatives, quality/resistance, effects,
   employee reaction events, tests.
6. **Strategic Coherence** — derived score, qualitative signals, pivot friction, tests.
7. **Living-world extensions** — big-bet/AI reaction templates, rival memory, tests.
8. **Live Board Meetings** — meeting state machine, question generator from state,
   commitments (reusing promises), full-screen UI, advance lock, tests.
9. **Balance campaign** — probe fleet across modes/sectors/strategies; tune caps; record in
   docs/balance-strategic.md.
10. **Player guide** — docs/how-to-win.md + README section.

## 8. Risks / decisions log

- R1: new ticks shift RNG streams → accepted; goldens regenerated per phase with probes.
- R2: scope — phases land independently; the game is shippable after every phase.
- R3: UI bloat — hard rule: no new top-level nav; screens slot into existing areas.
- D1: attention ≠ energy — energy stays as stamina; attention is allocation. Both feed morale
  paths differently; documented in phase 3.
- D2: coherence fully derived in v1 (no declared-strategy persistence) — declaration IS the
  big bet + existing career targeting; revisit only if signals feel arbitrary.
