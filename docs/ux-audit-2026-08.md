# UX audit — August 2026

The brief's §53 audit: every screen in the build, judged against the ten hard rules, with the
counts that make each finding settleable by opening a file. Companion documents:
`docs/ui-audit-2026-08.md` (visual system — elevation, type scale, colour) and
`docs/ui-direction-one-bright-thing.html` (the proposed direction). That pair asks *how it looks*.
This one asks the five questions the brief demands of every screen:

> What is this page for? What should the player notice FIRST? What can they do? What should they
> probably do next? Where is deeper information?

**Scope.** 15 screens in `src/screens/` plus the shell `src/App.tsx`, which is audited as a screen
because it renders a 9-metric dashboard and ~400 lines of endgame UI.
`src/screens/DailyLeaderboard.tsx` (67 lines) is excluded: it is an embedded component, not a
destination (`src/App.tsx:1193`, `src/screens/NewGame.tsx:449`).

**The one-line finding.** The game has no screen that violates the rules by being poorly made. It
has a codebase where the same nine numbers are rendered at least 42 more times across nine screens,
where five screens cannot state a single purpose, and where eleven run-ending events have no route
to the player at all. The problem is not any screen. It is that no screen was ever given the
authority to be the only home of anything.

---

## 1. Screen-by-screen

Sorted by noise score, worst first.

| Screen | Purpose | Primary action | Noise | Nav depth (see / act) | Recommendation |
|---|---|---|---|---|---|
| **Fundraising.tsx** (1132 ln) | None — four screens in one file: the institutional raise, the board, the IPO endgame, and a full token-network console nested in the last panel | Unclear. "Start pitching" (1081) competes with Sign/Pass, File the S-1, Sell secondary, Tokenise, Sell treasury, Sell founder position, 8 sliders. On a tokenised run the intended primary is a *disabled* button | **10** | 1 / 2 for term sheets. Founder-removal vote: 1 + scroll past 6–8 full-size panels, two of them permanently dead. Mobile +1 tap | **COMBINE**: the six panels `TokenisationPanel` nests (772–777) are a second screen — make them one, replacing Fundraising after the fork. REMOVE both closed-path panels (943–957, 1071–1088) and the valuation StatCard (1012) |
| **Dashboard.tsx** (381 ln) | None — a week digest, a vitals board, a benchmark report and a to-do list. Only `AttentionStrip` (200–231) answers "what do I do this week?" | **None.** 0 in-place controls; all 7 buttons are router pushes. The game's verb lives in `App.tsx:379` | **9** | 0 / 1, and every act is a navigation away. The `board_meeting` item (127) routes to `dashboard` — the screen you are on | **REMOVE** the second StatCard row (319–323), Cash + Runway StatCards (271–287), the cash chart (314–316), Milestones (347–364). **COMBINE** Benchmarks into the attention strip — it already computes tone per metric (64–98) |
| **Market.tsx** (526 ln) | None — market size, leaderboard, combat console, M&A desk, plus Discovery's segment table | Unclear: 23 buttons, no ranking. The two time-critical ones (Concede, Retain) are the least prominent | **9** | 1 / 2 desktop but the urgent controls are ~7 blocks down. Mobile 2 / 3 | **REMOVE** the `SegmentHealth` copy (156) and the Momentum column (211, 270 — it plots two different scales). **COMBINE** the three per-rival lists into one row. **REORGANISE** `PriceWarBanner` (291) above the leaderboard |
| **Discovery.tsx** (368 ln) | Buy evidence, read what customers do, choose who you build for. Real and good — buried under two analytics panels and ~650 words of manual | Run the recommended experiment (244–262) — the 5th block, ~1,200px down, immediately undercut by 10 identical catalogue buttons | **9** | 1 / 1 + 1,200px scroll. Mobile 2 taps + the same scroll | **REMOVE** the standalone `PMF_CAUSAL_CHAIN` box (133–135), the 116-word research explainer (288–295), the decision journal (354–365), and the second button on every catalogue row. **REORGANISE**: recommendation to the top. Also: hooks-order bug — `if (!career) return null` (108) sits above `useState` (112) |
| **App.tsx** (1265 ln) | Three jobs: shell, always-on 9-metric dashboard, and the entire endgame (GameOver 1047–1265, MatchOver 868–936, TokenPostmortem 962–1040) | **Advance Week / "Decide N items"** (360–405). Genuinely well done — contextual, never a dead control. Protect it | **8** | 0 / 0 for the primary. 9 of 13 destinations are 2 taps on mobile | **REMOVE** rail metrics 9 → 3–5; GameOver 11 buttons → 3. **COMBINE** the 3 stackable banners (585, 599, 626) into one slot and 7 `abandonGame` call sites into 2. Fix z-40/z-30: `ChatWidget` paints over the Advance button |
| **Product.tsx** (296 ln) | None — a PMF readout, a codebase board, a vertical launcher, and the effort allocator. Only the last is a decision | The 3–5 allocation sliders (253–292) — the **last** block on the page | **8** | 1 / 1 + scroll past 4 cards. Pivot = 3 clicks and its $15k / 4-week gate (`engine.ts:1164–1176`) is never visible | **REORGANISE**: Team focus first. **REMOVE** the Product-score StatCard, the pivots counter, the duplicate research bar, 2 of 3 `pivotBonus` renderings. **ADD** exactly one thing: the pivot cost on the button, disabled when `canPivot` fails |
| **Team.tsx** (170 ln) | Manage the people you have — but renders founder self-care, an all-hands minigame and the roster at equal weight | Unclear — Recharge vs 3 speech buttons vs 2N Raise/Fire. The real job (keep the person about to resign) has no control at all | **7** | 1 / 2 desktop, 2 / 3 mobile, roster is the 3rd–5th block | **REORGANISE**: sort `game.employees` by distance to the real quit threshold and align the morale bar bands (145–148: 40/60) with the engine's 32/55. **REMOVE** `PitchPanel` to one collapsed line |
| **Finance.tsx** (251 ln) | ~90% report, ~10% decision. The report half is already elsewhere | **None by default.** Draw/Repay (108–113) is double-gated; most of a run it does nothing | **6** | 1 / 2 + a drag desktop, 2 taps mobile. In most runs there is no action to measure | **REMOVE** all 4 StatCards (181–193, 100% rail duplicates) and the cash chart (201–203, a copy of Dashboard's). 11 boxes → 3. Covenant risk (84, 116–119) must reach the Dashboard |
| **CohortAnalytics.tsx** (523 ln) | Answer "why did PMF move when I changed nothing?" — genuinely single, then surrounded by three more panels of equal weight | **None by design** ("PRESENTATION ONLY", header). 4 controls, 0 touch the simulation | **6** | 1 / — (acting is impossible; the 4 levers it names link to nothing). Mobile: the chart's numbers are unreachable — `onMouseMove` only (137–141) | **REMOVE** "What moves this number" (486–510, state-independent copy) and the 88-word chart caption. **COMBINE** verdict + chart. **REORGANISE**: the 192–960-cell triangle goes behind a disclosure |
| **Hiring.tsx** (244 ln) | Choose a candidate, priced against runway. The "runway after" column is genuinely good decision-first design | Send offer (171 mobile / 230 desktop) | **6** | 1 / 2 desktop, 2 / 3 mobile, +1 discovery click because expiry never surfaces | **REMOVE** the 3 rail-duplicated header stats (85–87). **COMBINE** the two list implementations (136–178 vs 180–241 — the decision rule is copy-pasted) and the two pipeline panels. The nav badge reads a constant 5 forever (`engine.ts:1904`) |
| **Growth.tsx** (84 ln) | Set the weekly marketing budget. That is one panel; the other five blocks are a second Dashboard | The marketing slider (37–45). 0 `<Btn>` in the file | **6** | 1 / 1 — depth is fine, the click just buys one slider | **REMOVE** 4 of 6 boxes: Users StatCard, users chart (73 — character-identical to `Dashboard.tsx:312`), Hype StatCard, "What drives acquisition". 21 numbers → ~9. Warn when `marketingSpend > marketingMax` — the engine bills the excess (`engine.ts:832`), the slider hides it |
| **NewGame.tsx** (610 ln) | Pre-run gate then a numbered briefing. The two-stage structure is good | Start the run (528–544), correctly the loudest control | **6** | Not reachable from the Dashboard except via the door icon + a `confirm()` that destroys the run | **REMOVE** 25 locked "·····" achievement chips, two of the three Quick Play routes, the Arena rules paragraph (591–596) and the Supabase setup text (555–558). Move the pip legend above the grid and keep it after the first run |
| **Lobby.tsx** (176 ln) | Pre-match staging. Also tries to be the full match-config editor — that is the part that breaks it | Split by role and unsignposted: copy the code (40–52) for everyone; Start (153–160) for the host. A non-host has no primary action | **6** | 0 / 0 — inverted problem: nothing is buried, everything is surfaced at once (21 host controls on one card) | **REMOVE** the 10 rule pills behind one "Change rules" disclosure and show the preset sentence to the **host** (today only the non-host, who cannot act, sees it — line 165). Copy a join URL, not a bare code; commit the name on change, not `onBlur` (76) |
| **Inbox.tsx** (91 ln) | Resolve what blocks the week, read what happened. The least confused screen in the audit — 0 Panels, 0 of 9 rail stats duplicated | Click a choice (77). Unambiguous, the only action | **4** | 1 / 2 if the blocker is near the top; unbounded scroll otherwise. 39 `inbox.unshift` sites in `engine.ts`, 0 trims | **REORGANISE**: partition unresolved first (`pending` is already computed at line 9). Collapse settled items. Keep the stats discipline — this screen is the counter-example |
| **Career.tsx** (146 ln) | A read-only trophy cabinet rendered *inside* a live run, showing other runs while omitting this one | **None.** 0 buttons, 0 links, 0 filters — `grep -c 'onClick\|<Btn'` returns 0 | **4** | 1 / impossible | **REMOVE the screen.** Its headline stats are silently wrong (`store.ts:181` keeps `runs.slice(0, 10)` by score, so "Total runs" reads 10 forever) and both halves already exist on `NewGame.tsx:126–166` |
| **Story.tsx** (128 ln) | Read the run back as a chaptered timeline. Clear, singular, and the execution flattens it | "📸 Share the story" (46) — the only control, and the smallest thing on the screen | **3** | 1 / 2 desktop, 2 mobile. From the overlay: ~7 stacked blocks of modal scroll | **REMOVE** the autopsy block (99–103, character-identical markup to `App.tsx:1079–1082`) and the payout line. **REORGANISE**: `StoryBeat.weight` exists (`story.ts:42`) and `grep -c weight Story.tsx` = 0 — use it |

---

## 2. Cross-cutting findings

These are worth more than any single screen's problems, because each one is a rule the codebase
breaks structurally rather than accidentally.

### 2.1 The topbar rail is rendered 9 times and then re-rendered 42 more

`src/App.tsx:314–355` defines `statRail` — Cash, Runway, Rev /wk, Burn /wk, Net /wk, Users, PMF,
Valuation, Morale, all through one `Stat` component (`App.tsx:789–797`) with one treatment
(`text-[15px] font-bold tnum`). It is on every screen. Then:

| Rail metric | Re-rendered at | Count |
|---|---|---|
| Cash | `Dashboard.tsx:271` StatCard, `:88` BenchRow, `:34` WeekDigest, `:315` LineChart; `Finance.tsx:181` StatCard, `:202` LineChart, `:239` table column | 7 |
| PMF | `Dashboard.tsx:320`, `:76`, `:36`; `Growth.tsx:78` BarRow; `Product.tsx` PMF panel; `Discovery.tsx:130` PmfBreakdown; `SegmentHealth` PMF column on **both** `Discovery.tsx:123` and `Market.tsx:156`; the entire subject of `CohortAnalytics.tsx` | 8 |
| Users | `Dashboard.tsx:288`, `:33`, `:312`; `Growth.tsx:25`, `:73`; `Market.tsx:256` | 6 |
| Runway | `Dashboard.tsx:282`, `:80`; `Finance.tsx:193`; `Hiring.tsx:86` header, plus per-candidate "Runway after" | 5 |
| Burn /wk | `Dashboard.tsx:279` delta string; `Finance.tsx:186` + 4 table columns; `Hiring.tsx:85`; `Team.tsx:74` payroll | 5 |
| Valuation | `Dashboard.tsx:297`, `:37`; `Market.tsx:264`; `Fundraising.tsx:1012`; `App.tsx:1063` | 5 |
| Rev /wk | `Finance.tsx`; `Hiring.tsx:85`; `Market.tsx:259–261` online columns | 3 |
| Morale | `Dashboard.tsx:322`; `Dashboard.tsx:190` attention item; `Team.tsx` per-employee bars | 3 |
| Net /wk | — | 0 |

**42 duplicate renderings of 9 numbers.** Two screens are the extreme cases: `Finance.tsx` renders
four StatCards that are 100% rail duplicates plus a chart that is a copy of another screen's chart —
five of its eleven boxes carry zero new information; `Growth.tsx` renders four boxes that are
Dashboard copies against one real control.

Two consequences beyond noise. First, **drift**: `Growth.tsx:13` and `Dashboard.tsx:58` are the
character-identical churn formula in two files, and `Growth.tsx:25` reads `game.users` while the rail
40px above reads `totalUsers(game)` — once a venture launches, two different user totals are on
screen with nothing marking the difference. Second, **it is the reason the rail cannot be loud**:
nine equal metrics with a colour tone as the only differentiator means Cash, the number that ends the
run, is typographically identical to Valuation, which the player cannot act on this week. And on a
narrow desktop window 3–4 of them scroll off behind a hidden scrollbar (`App.tsx:543`).

Only `Net /wk` is unique to the rail. That is the shape of the fix.

### 2.2 Five screens cannot state a purpose

Asked "what is this page for?", these answer with a list: **Dashboard** (digest + vitals + benchmark
report + to-do), **Market** (market size + leaderboard + combat + M&A + a borrowed segment table),
**Product** (PMF readout + codebase + vertical launcher + effort allocator), **Fundraising** (raise +
board + IPO + a complete token console nested in the last panel), **Team** (founder self-care +
minigame + roster). `App.tsx` does three jobs, only one of which is a shell's.

The common mechanism is not ambition, it is **filing by noun**. Anything involving other companies
went to Market; anything involving money went to Fundraising. Areas named after decisions
("who do I keep?", "where does the money come from?") do not accumulate this way; areas named after
nouns always do.

### 2.3 Buried urgency: eleven ways to lose that cannot reach the player

`Dashboard.tsx:112–198` is the only route from the simulation to the player's attention, and it ends
`return out.slice(0, 3)` (line 197) — truncating by **push order, not severity**. A `good` item
("3 interview questions left", line 129) outranks a `bad` runway crisis by sitting earlier in the
function. Board strikes — *"Miss the next review and you can be replaced"* — are pushed last
(191–196), after two merely-`warn` items.

Everything in this register is either dropped by that slice or has no entry at all:

| Event | Consequence | Where it lives today | On the Dashboard? |
|---|---|---|---|
| Board strike | You can be replaced | `Dashboard.tsx:191–196`, pushed last | Dropped by `slice(0,3)` |
| Founder-removal vote closing | Run ends | `Fundraising.tsx:622–624` | **No case exists** |
| Covenant breach | Cash + **15% of the company** | `Finance.tsx:84, 116–119` | **No case exists** |
| Price war running | Revenue cut weekly | `Market.tsx:291` | **No case exists** |
| Hostile rival flagged | "~N of your users" | `Market.tsx:426–434` | **No case exists** |
| Employee about to resign | 22%/wk roll at morale < 32 (< 55 mercenary), `engine.ts:1879–1881` | Unsorted roster row | Only `avgMorale < 45` — one person at 20 among seven at 75 averages 68 |
| Founder burnout | Forced at energy ≤ 5: −3 morale, −1 feature, reset to 35 (`engine.ts:1919–1930`) | A 1.5px sidebar bar, `App.tsx:432–445`, desktop only | **No case, and invisible on mobile** — `energy` is not in `statRail`, so the mobile stats sheet cannot show it either |
| Candidate expiring | The hire walks | `Hiring.tsx:221–223`, 7th column, muted grey, unsorted | **No case exists** |
| Experiment finished | Evidence you paid up to $28k and waited 7 weeks for | Inbox `kind:'news'` (`tick.ts:250–268`) | Badge counts `kind === 'choice'` only (`App.tsx:243`) — arrives silently |
| Standing experiment rebill | $4k–$28k every cycle (`tick.ts:317`) | The active-experiment list inside one Discovery panel | Not on Finance, Dashboard or the rail |
| Round-clock timeout | **Every unresolved choice auto-resolves to the last option** and the week force-advances (`App.tsx:223–230`) | Nowhere | Never stated in any UI |

Three of the four nav badges make this worse rather than better. `unread` is genuinely useful;
`termSheets.length` duplicates a list; `candidates.length` reads a constant **5** forever because
`engine.ts:1904` refills the pool to 5 every week — a notification affordance carrying zero bits,
which trains the player to ignore badges. And the three badges use three different visual grammars
(`App.tsx:287` `bg-bad`, `:291` `bg-warn`, `:299` bordered grey) for one concept.

Meanwhile the *existence* of a pending decision is announced four times — sidebar badge
(`App.tsx:571`), advance-button label (`:377`), Dashboard attention item (`:119`), Latest news panel
(`:365`) — and its **identity** is announced nowhere.

### 2.4 Equal-weight-panel syndrome

One recipe, `CARD` at `src/components.tsx:106`, one `Panel` at `:133`, one `StatCard` at `:175` with
one 34px figure. Everything in the game is one of those three, so nothing can outrank anything.

| Screen | Panels rendered simultaneously | Independently styled boxes |
|---|---|---|
| Fundraising | **12** (15 `<Panel>` tags; `TokenisationPanel` nests 6 more at 772–777) | 21 |
| Discovery | 8 (4 in-file + 4 from `CareerUI.tsx` components it renders) | 33 |
| Market | 5 | 7 |
| Dashboard | 5 (+7 StatCards) | 16 Quick Play / 22 Career |
| Finance | 5 (+4 StatCards) | 11 |
| CohortAnalytics | 4 on the normal path | 5 |

The brief's line is "never five equally prominent panels". Six screens are at or above it, one is at
twelve. The R2 inversion is the same fault seen from the side: on Dashboard the recommendation
renders at `text-[13.5px]` (218–225) while the data it is meant to outrank renders at `text-[34px]`
(`components.tsx:213`) — **the decision is 2.5× smaller than the numbers**. On Product, Discovery and
Market the decision is simply last.

### 2.5 Depth is on by default; the phone gets the worst of it

Nothing in this game is behind a disclosure. Measured prose shown by default: **~3,480 words**
(Fundraising), **~650** (Discovery), **~437** (CohortAnalytics), **~417** (Market) — and that is four
screens of sixteen. `CohortAnalytics` renders 192 table cells by default and up to 960 expanded;
`Hiring` renders the same static `ROLE_HELP` sentence 5 times in the table and 5 more in the mobile
cards.

Load-bearing content that a touch device cannot reach: 12 hover-only `title` tooltips on Market
(including what each of the 15 attack buttons does, `:381`, `:468`), 10 on CohortAnalytics, whose
chart binds its per-week readout to `onMouseMove`/`onMouseLeave` only (`:137–141`). `MOBILE_TABS`
(`App.tsx:76`) is 4 entries, so 9 of 13 destinations cost an extra tap. And `ChatWidget`'s FAB
(`z-40`) paints over the mobile action bar (`z-30`, `App.tsx:661`) — a chat bubble on top of the
game's primary control.

### 2.6 One rule, two implementations

Every one of these will drift, and some already have:

- `Hiring.tsx:136–178` (mobile cards) vs `:180–241` (desktop table) — `after/afterLabel/cls` is copy-pasted at `:138–140` and `:197–199`.
- `Growth.tsx:13` vs `Dashboard.tsx:58` — churn, character-identical.
- `Growth.tsx:73` vs `Dashboard.tsx:312` — the users chart, character-identical.
- `Finance.tsx:202` vs `Dashboard.tsx:315` — the cash chart, same panel title.
- `SegmentHealth` (`CareerUI.tsx:582`) rendered on `Discovery.tsx:123` **and** `Market.tsx:156`, differing only in the title string.
- `PMF_CAUSAL_CHAIN` rendered four times: `App.tsx:337` tooltip, `CareerUI.tsx:681`, `Discovery.tsx:133`, `Product.tsx:185`.
- `Story.tsx:99–103` vs `App.tsx:1079–1082` — the autopsy, identical class list and identical string.
- `Lobby.tsx:65–86` vs `:88–94` — the player row, duplicated branch.
- `Dashboard.tsx` `Benchmarks` (53–101) and `attentionItems` (112–198) independently recompute `pmfPace` (60 and 116) — two functions evaluating the same health into two UI regions.

---

## 3. What to remove

§20: *do not preserve UI simply because it already exists.* Each entry names the file, what goes, and
where the information survives. Nothing here needs a replacement panel.

### A. Destinations (2)

1. **`src/screens/Career.tsx` — the whole screen.** Delete the NAV entry (`App.tsx:90`) and the file.
   Zero controls; reachable only mid-run, when it shows every run except the one being played; its
   headline stats are wrong by construction (`store.ts:181` persists `runs.slice(0, 10)` sorted by
   score, so "Total runs" reads 10 forever). Both halves already exist, better, on `NewGame.tsx`:
   `HallOfFame` (142–166) and `AchievementGallery` (126–140). Survives: append the sector table and
   endings distribution to NewGame and relabel it "best 10 runs".
2. **`src/screens/CohortAnalytics.tsx` as a top-level destination.** Its subject is the spread behind
   one number that already has three homes. It becomes a disclosure hanging off the segment table,
   not the 6th nav row.

### B. Panels and cards (23)

3. `Dashboard.tsx:319–323` — the second StatCard row. PMF and Morale are in the rail; Hype is the
   only unique number and belongs on Growth.
4. `Dashboard.tsx:271–287` — Cash and Runway StatCards. Same thresholds as the rail. Their only
   unique content is the delta warning copy, which belongs in the attention item that fires on the
   same condition.
5. `Dashboard.tsx:314–316` — "Cash over time".
6. `Dashboard.tsx:347–364` — Milestones. A trophy shelf: four goals not earned, then a
   `join(' · ')` run-on of every goal earned.
7. `Dashboard.tsx:365–377` — "Latest news". The Inbox owns this list; this is the fourth
   announcement of a decision whose identity is announced nowhere.
8. `Dashboard.tsx:53–101` — the Benchmarks panel **as a panel**. Keep the function: it already
   computes good/warn/bad per metric (64–98) and should feed the attention strip instead of being a
   second parallel evaluation. ~50 lines and one panel deleted.
9. `Finance.tsx:181–193` — all four StatCards. 100% rail duplicates.
10. `Finance.tsx:201–203` — "Cash over time". A copy of item 5.
11. `Growth.tsx:25` — Users StatCard. `Growth.tsx:73` — the users chart. `Growth.tsx:26` — Hype
    StatCard (which the file duplicates again as a BarRow at `:76`).
12. `Growth.tsx:75–80` — "What drives acquisition". Four 0–100 bars with no weights and no binding
    constraint: it names the inputs without saying how much each matters, so it cannot inform a
    decision.
13. `Market.tsx:156` — the `SegmentHealth` copy. Discovery owns it.
14. `Market.tsx` Momentum column (`:211`, `:270`) — player rows set `product: undefined`
    unconditionally (`:74`, `:96`), so the bar compares a pmf-derived fallback (40–90) against
    rivals' real score (20–100). It invites a comparison the numbers cannot support.
15. `Product.tsx:236–241` — Product-score StatCard (benchmarked on the Dashboard).
16. `Product.tsx:226–230` — the pivots-so-far counter. A run statistic, not a decision input.
17. `Product.tsx:119–120` — the duplicate research bar (same formula as `:207–209`).
18. `Product.tsx` — two of the three `pivotBonus` renderings (`:125`, `:223`, `:225`).
19. `Product.tsx:183–197` — the career-branch panel whose content is "the thing you want is
    elsewhere". That is a link, not the largest element on the page.
20. `CohortAnalytics.tsx:486–510` — "What moves this number". 95 words + a 34-word footnote that read
    no value from `game`: byte-identical every week of every run.
21. `CohortAnalytics.tsx:470–473` — the 88-word chart caption, which restates the verdict directly
    above it.
22. `Fundraising.tsx:943–957` and `:1071–1088` — both permanently-closed panels. After the fork these
    are full-size cards containing disabled buttons for the rest of the run. A closed path deserves
    one line of text.
23. `Fundraising.tsx:1012` — "Current valuation" StatCard (rail duplicate), and the equity % at
    `:1002` which the StatCard at `:1019` repeats 17 lines later.
24. `Discovery.tsx:354–365` — the Decision journal. A read-only history log pinned to the bottom of
    the longest screen in the game.
25. `Story.tsx:99–103` and `:104–108` — the autopsy and payout, both shown at `text-4xl` in the
    overlay the player just closed, repeated here at 13px.

### C. Duplicate implementations (4)

26. `Hiring.tsx:180–241` — the desktop table. Keep the card list: cards already express "Runway
    after" better than an 8-column table (40 cells for 5 candidates, with the decision column 6th of
    8), and one implementation cannot drift from itself.
27. `Growth.tsx:13` — delete the copied churn formula; import the Dashboard's, or better, hoist both
    into `engine.ts` where the other derived metrics live.
28. `Lobby.tsx:88–94` — the duplicated player-row branch; one component with an `editable` prop.
29. `Discovery.tsx` — the second button on every catalogue row (`:307–325`): make "Standing" a toggle
    inside the row. 10 buttons → 5.

### D. Prose and controls (9)

30. `Fundraising.tsx` — the 27 `leading-relaxed` blocks go behind disclosure. This one file carries
    ~3,480 words of markup text.
31. `Discovery.tsx:133–135` (`PMF_CAUSAL_CHAIN`, the 4th copy) and `:288–295` (116-word research
    explainer).
32. `Market.tsx` — the 109-word leaderboard footer (284–286) and the 47-word Corp dev blurb
    (493–497) behind disclosure; move the 12 hover-only `title` payloads onto the face of the
    controls they describe.
33. `Finance.tsx` — the four muted explainers (45–48, 91–95, 115–120, 153–158) behind disclosure; 18
    `text-mut` spans in a 251-line file.
34. `Hiring.tsx:85–87` — the three rail-duplicated header stats; `Hiring.tsx:90–99` — the
    "only a hash of your offer goes over the wire" paragraph. Network implementation detail on a
    hiring screen.
35. `NewGame.tsx` — the 25 locked `·····` achievement chips (keep the earned ones and the `n/26`
    count); the Arena rules paragraph (591–596); the Supabase setup instructions (555–558), which
    are a build-time README inside a player flow; the duplicate "Early access" badge (399–401); and
    two of the three routes that all call `setExperience('quick')`.
36. `Lobby.tsx:137–152` — the 10 equal-weight rule pills, replaced by one preset sentence plus a
    "Change rules" disclosure — and shown to the **host**, who is the only person who can act on it.
37. `App.tsx` — `SocialShareRow`'s 4 targets (827–838) folded into one Share control; GameOver from
    11 buttons to 3; `TokenPostmortem` (962–1040) behind a disclosure; 5 of the 7 `abandonGame` call
    sites (362, 574, 593, 619, 926, 943, 1254).
38. `Team.tsx:16–62` — `PitchPanel` collapsed to one line. It occupies a third of the page every
    week for an action that is on cooldown most weeks, and it renders **above** the roster.

Projected effect where it is countable: Dashboard 16 boxes → 5; Finance 11 → 3; Growth 6 → 2 (21
numbers → ~9); Fundraising 12 simultaneous panels → 4 plus a separate token destination; Hiring one
list implementation instead of two.

### E. Two things to change rather than delete

39. `Dashboard.tsx:197` — sort `attentionItems` by tone (and then by deadline) **before**
    `slice(0, 3)`. One line. Today a `good` item can silently discard a you-can-be-fired strike.
40. `DecisionLens.tsx:36` — `RETIRE_AFTER_DECISIONS = 20` retires the stakes table (213–231) exactly
    when decisions get expensive. Retire the tutorial sentence (227–229); keep the axes chips
    permanently. They are reference data a week-60 founder needs *more* than a week-3 one.

---

## 4. The Founder HQ candidate set

The HQ answers one question — *what should I do this week?* — and it earns the right to be the
landing screen only if everything on it is either the decision or the evidence for the decision.

### The metrics: one hero, four supporting

| Slot | Metric | Why it earns the place | What it retires |
|---|---|---|---|
| **Hero** | **Runway**, in weeks, with net/wk as its sentence ("Net is −$13.2k a week") | It is the only number that ends the run. It is the one metric whose *tone* is already computed everywhere (`App.tsx:320`, `Dashboard.tsx:80`, `Finance.tsx`, `Hiring.tsx`'s "runway after"), which is proof the game already treats it as the master number — it has simply never been allowed to be bigger than anything else. Cash lives here as the hero's subtext, not as its own tile | `Dashboard.tsx:282`, `:271`, `:80`, `:88`, `Finance.tsx:181`, `:193`, `Hiring.tsx:86` |
| 2 | **Revenue /wk**, with trend | The only lever that ends the runway problem permanently rather than deferring it. Currently rail + Finance + Hiring header | `Finance.tsx` StatCard, `Hiring.tsx:85` |
| 3 | **Users**, with trend | The growth read, and the number three screens fight over. Fix the definition while moving it: `totalUsers(game)` everywhere, never `game.users` (`Growth.tsx:25`, `Product.tsx:92`) | `Dashboard.tsx:288`, `:33`, `Growth.tsx:25`, `Market.tsx:256` |
| 4 | **PMF** (Quick Play) / **4-week retention** (Career), one cell | Quality of growth. This is the number rendered in the most places in the game (8 duplicates, §2.1) and it needs exactly one home | `Dashboard.tsx:320`, `:76`, `Growth.tsx:78`, and one of the two `SegmentHealth` copies |
| 5 | **People: headcount · lowest morale · founder energy** | Changes the *definition* to make a buried failure visible. `avgMorale` mathematically hides the person about to quit (one at 20 among seven at 75 averages 68, above the `< 45` threshold); lowest-morale does not. Founder energy today exists only as a desktop sidebar bar (`App.tsx:432–445`) and is completely absent on mobile, while `engine.ts:1919–1930` forces a burnout at ≤ 5 | `App.tsx` Morale stat, `Dashboard.tsx:322`, the sidebar energy bar |

**Left off, and why.** *Cash* — implied by runway and net; it becomes the hero's second line, not a
tile (it is currently rendered 8 times). *Burn /wk* — a component of net, and Capital owns its
breakdown. *Valuation* — a vanity figure with no in-week action; it belongs on Capital and on the
results screen. *Hype* — one screen owns it (Growth), and it is the only unique number in Dashboard's
second StatCard row. *Quality / bugs / features* — Product owns them; they are the *result* of the
effort sliders and belong beside them. *Equity / stage / week* — shell header. *Churn %* — folded
into the acquisition sentence on Market ("you buy N/wk at $X and lose M/wk"), which is the actual
decision. *Market saturation, product score, valuation of rivals* — Market. *Round-ends timer* —
shell, online only.

That is 5 cells against today's 9-metric rail plus 7 Dashboard StatCards plus 5 WeekDigest deltas.

### The attention items

The HQ shows **the top item at full weight, two more beneath it, and "N more" behind a disclosure** —
and the ordering rule is severity, then deadline, then push order. Every item must name the specific
thing (*"The accelerator wants 7% for $120k"*), never the count (*"2 decisions waiting"*), because
counts are already announced four times.

Earning a place, in priority order:

| # | Item | Fires on | Status today |
|---|---|---|---|
| 1 | The blocking decision, **named** | `hasPendingDecision` | Exists 4× as a count, 0× as an identity |
| 2 | Runway below the cash buffer | `Dashboard.tsx:136` | Exists; must stop being droppable |
| 3 | Covenant proximity | `Finance.tsx:84` (`lastRevenue < covenantRevenue * 1.2`) | **New** — 15% of the company, no route to the player |
| 4 | Governance vote closing / board strike | `Fundraising.tsx:622–624`; `Dashboard.tsx:191` | Vote **new**; strike exists but is pushed last and sliced away |
| 5 | A named person about to resign | morale < 32, < 55 mercenary (`engine.ts:1879–1881`) | **New** — replaces the `avgMorale < 45` item that cannot see it |
| 6 | Price war running / rival flagged Hostile | `Market.tsx:291`, `:426` | **New** — `grep` for `hostileRivals\|priceWar` hits no screen but Market |
| 7 | Term sheet expiring in N weeks | `Dashboard.tsx:142` | Exists |
| 8 | Candidate leaving the pool this week | `Hiring.tsx:221` (`weeksLeft`) | **New** — and it fixes the constant-5 badge |
| 9 | Founder energy ≤ 10 | `engine.ts:1919–1930` | **New** — invisible on mobile entirely |
| 10 | Experiment finished, evidence waiting | `tick.ts:250–268` | **New** — `App.tsx:243` counts `kind === 'choice'` only |
| 11 | Demand WEAK / pivot recommended; IPO pricing week | `Product.tsx` SIGNAL_COPY; `Fundraising.tsx:911–936` | Pivot exists; IPO **new** |

Five of these eleven exist today; six have no route to the player at all. Note that adding them is
not "adding UI" — the strip already exists, and six of the eight removals in §3.B free more space
than the six new cases consume.

**Left off the HQ.** Milestones and achievements (a trophy shelf: Company/NewGame). The benchmark
table (it becomes the *tone input* to these items, not a panel). Latest news (the HQ's week stream
below the fold, partitioned unresolved-first — the Inbox pattern, which is already the best on the
build). Both charts (cash and users over time are history, and history is not a decision). The PMF
explainer prose (one tooltip, one home). The WeekDigest delta strip (it becomes the trend badges on
metrics 2–4, which is the same information at a fifth of the footprint — and it removes the case in
Career where `FounderBriefing` (`Dashboard.tsx:265`) and `WeekDigest` (`:267`) render two week-over-week
delta strips two lines apart).

---

## 5. Navigation — 13 rows into 6 areas

Today: `NAV` is 13 rows (`App.tsx:77–91`), `MOBILE_TABS` is 4 (`:76`), so 9 of 13 destinations cost
an extra tap behind "More".

| Area | Absorbs | Owns (single source) | Primary action |
|---|---|---|---|
| **HQ** | `Dashboard.tsx` (rebuilt), `Inbox.tsx` as the week stream, `AttentionStrip`, `WeekDigest` | The 5 metrics of §4; the attention register; the week's events | Resolve the top decision → advance the week |
| **Market** | `Market.tsx`, `Growth.tsx`, pricing from Discovery's "Your bet" | Marketing budget, CAC/churn, pricing, saturation, rivals, price war, M&A | Set the budget / answer a rival |
| **Product** | `Product.tsx`, `Discovery.tsx`, `CohortAnalytics.tsx` as depth | Effort sliders, quality/bugs/features, ventures, experiments, segments, retention, PMF breakdown | Allocate engineering effort / run the recommended experiment |
| **People** | `Team.tsx`, `Hiring.tsx` | Roster sorted by risk-to-quit, founder energy, offers in flight, candidate pool | Keep the named person at risk / send an offer |
| **Capital** | `Finance.tsx`, `Fundraising.tsx` (institutional half), macro as one strip | Cash breakdown, burn components, debt + covenant, term sheets, board, IPO, equity | The live term sheet, vote, or draw |
| **Company** | `Story.tsx`, Milestones (`Dashboard.tsx:347`), Decision journal (`Discovery.tsx:354`), the run record | The narrative record: chaptered beats, milestones, cap table | *(none — see flag)* |
| **Network** *(conditional)* | `Fundraising.tsx:743–779` and the six panels it nests | Community, governance, treasury, founder position, incentives, network ending | Replaces Capital's raise panel after the tokenisation fork |

Outside the 7: `NewGame.tsx` and `Lobby.tsx` are pre-run and render instead of the shell
(`App.tsx:240`, `:392`); `DailyLeaderboard.tsx` is an embedded component.

**Flags.**

- **World would be empty. Do not build it.** Its entire candidate content is `MacroPanel`
  (`Finance.tsx:27–49` — one unlabelled sparkline, no units) and the funding climate line
  (`Fundraising.tsx:1008`), and `engine.ts:1568` derives `climate` from exactly those macro inputs,
  so they are one fact split across two screens. Neither carries a decision. Fold macro into
  Capital as one line, and world events into the HQ week stream. Six areas, not seven.
- **Company has real content but zero decisions.** Everything mapped to it is read-only today
  (`Story.tsx` has 1 control; the journal and milestones have 0). That is acceptable *only* if it is
  explicitly the record area: it must never carry a nav badge, must never be the landing screen, and
  must not be where an in-run decision hides. If it cannot hold the Story beats' existing `weight`
  ranking (`story.ts:42`, unused by the screen) and a real cap table, it should be a section of the
  end-of-run flow instead of an area.
- **Product is the area at risk of re-accumulating.** It absorbs three screens with 8, 5 and 4
  panels. It only works if §3's removals land first — otherwise it becomes the new Fundraising.
- **Six areas fit the mobile tab bar.** `MOBILE_TABS` can hold HQ, Market, Product, People, Capital
  with Company in the overflow — the "More" sheet stops being the route to 9 of 13 destinations, and
  the extra tap that today buries Market, Team, Hiring, Finance, Fundraising, Discovery, Cohorts,
  Story and Career disappears for all but one.
