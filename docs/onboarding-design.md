# Onboarding & the new-player experience

Founder Mode is mechanically deep: six sectors, three modes, Career PMF discovery with hidden
segment truths and cohort retention, a seven-slice tokenisation economy, eight Living World phases,
PvP, debt covenants, replay verification. All of that is built and all of it works.

**The biggest risk to the project is no longer correctness. It is comprehensibility.** Depth a
player cannot parse does not read as depth; it reads as noise, and it converts into churn.

The constraint that shaped every decision below: reduce friction, and do not be intrusive or
spammy. That constraint *is* the design, not a caveat on it.

---

## 1. The confusion inventory

From a genuinely fresh playthrough — cleared storage, new origin, Quick Play / B2B SaaS /
technical founder, played from the gate to week 12 without using prior knowledge of the codebase.
Ordered by how much damage each does to a first run.

### A. The gate offers no way in

Three worlds (Quick Play, Career, Arena), three Quick Play formats, ten scenarios, two founder
types and six markets — presented flat, to somebody who does not yet know what a week of this game
feels like. Nothing marks which one is the one to learn in. Career is even labelled "Early access",
which reads as *newer*, i.e. more interesting, to a newcomer.

*Cost:* the highest-variance choice in the product is made blind, before any information exists to
make it with.

### B. `RUNWAY 153 wk` is the single most misleading number on screen

Week 1: $200k cash, $1.3k/wk burn, so the header says 153 weeks in green. A new player reads three
years of safety. But burn is *recurring only* — one-off charges (recruiter fees, bills, the cost of
a decision) are not in it, and a single hire collapses that number by two thirds. The figure is
correct and the inference it invites is wrong.

*Cost:* the resource the whole game is a race against is systematically misread in exactly the
weeks when the misreading is cheapest to fix.

### C. Inbox decisions are unpriced coin flips — **the big one**

Every inbox decision is a two-sentence dilemma with two buttons. Observed at week 8, verbatim:

> **Accelerator invitation** — A famous accelerator offers you a spot in their next batch: $120,000
> for 7% of the company, plus connections and press.
> `[Accept the deal]` `[Decline — too much equity]`

Nothing on screen relates 7% to the valuation sitting in the header. After accepting, the entire
feedback is one italic line:

> → You are in the batch. Cash, connections, and a hype bump. They take 7% equity.

"A hype bump" is +12. "Connections" is +8 reputation. The cash is +$120,000. Founder equity went
100% → 93%, which is stated nowhere on the screen where the decision was taken. So the player
clicks, the week moves on, and **learns nothing** — which is how thirty hand-authored events with
real modelled trade-offs end up feeling like coin flips.

*Cost:* the richest authored content in the game is spent without teaching anything, every run.

### D. The demand signal is a hidden gate nobody finds

Quick Play's central mechanic: `researchSignal` must reach 14 before `demandSignal()` returns
anything but `'unknown'`. Until then whether the idea is any good is *not modelled as a low score* —
it is genuinely unmeasured. The gauge that reports this is two scrolls down the Product screen, and
the default allocation puts only 20% of effort into research.

A player who never scrolls can play forty weeks without discovering that the game has an answer to
"is this idea good", let alone that they must buy it.

*Cost:* the entire discovery loop — the thing Quick Play is *about* — is invisible by default.

### E. Undefined vocabulary, used before it is ever explained

Counted on screens a player sees in the first twenty minutes: PMF, hype, reputation, runway, burn,
idea quality, product score, product bar, problem intensity, reachability, standing experiment,
posture, covenant, energy, cohort, retention, dilution, down round, S-curve, TAM. Twenty terms, each
load-bearing, none defined anywhere in the product. There was no way to look one up.

### F. The team-focus sliders lie about their own units

They are raw weights, 0–100 each, but each row *displays* `weight / sum` as a percentage. Dragging
one slider changes every number on the panel, including the ones the player did not touch. Nothing
says so.

### G. Two teaching systems, in the same place, disagreeing

Not a first-run confusion — a structural one, found on arrival. A linear seven-step `Coach` already
occupied the top of every screen, and the inherited Founder's Notes rendered in the identical slot.
Two banners, two dismiss buttons, two localStorage keys, two voices. See §3.

### H. Smaller, real, and left alone

- The Dashboard's `THIS WEEK` strip reported `Cash ▼$1.2k` in the same week the player watched cash
  rise $120k — it is a snapshot delta and the decision resolved after the snapshot. Confusing, but
  fixing it means touching the simulation's history records. Out of scope by the hard rule.
- `Decline — too much equity` editorialises in the button label itself, pre-judging the choice.
- Career's "Early access" badge reads as *better* rather than *unfinished*.

---

## 2. Principles

1. **Progressive disclosure.** A lesson appears the first moment the thing it teaches can be acted
   on, anchored to the screen where that thing lives. Never a wall at the start. It waits, silently
   and indefinitely, until the player is standing in front of the subject.
2. **Diegetic first.** The game already has an in-fiction explanation layer most games would kill
   for — advisors who disagree, a weekly briefing, causal explanations the engine computes anyway.
   Use that voice, not tooltip chrome.
3. **Post-hoc beats pre-hoc.** In a simulation, "here is what that did" teaches more than any
   tutorial, because it is about the run the player is actually in and it cannot be skipped as
   preamble. **The engine already computes the answer. The player just never saw it.**
4. **Never teach what the player has demonstrably done** — and persist that across runs, on the
   device, forever. Demonstrated is read off the save (`observedSkills`), never off "was told".
5. **Always skippable, never blocking, one visible off switch** that turns the whole layer off and
   back on again.

---

## 3. Judgement on the inherited code

Ten files, ~1,796 lines, written across three infrastructure stalls and never once compiled.

**Verdict: strong work, kept nearly whole.** The architecture is right — a read-only fact
projection, a durable ledger under its own key, a catalogue of place-anchored lessons, and surfaces
that only render. It compiled after **one** fix.

| File | Verdict |
|---|---|
| `read.ts` | Kept. Fixed `CustomerCohort.customers` → `activeCustomers` (the only compile error in all ten files). Extended with `founderEquity`, `researchSignal`, `demand`. |
| `progress.ts` | Kept. Made `markSeen` idempotent (§4). |
| `useOnboarding.ts` | Kept, substantially reworked — the pinning and dwell logic in §4. |
| `guide.ts` | Kept unchanged. |
| `concepts.ts` | Kept. Added `demand-unknown` / `demand-known`; strengthened `hiring-fee`. |
| `glossary.ts` | Kept unchanged. 34 terms, each defined by *what the simulation does*, not what a startup blog says. |
| `FieldGuide.tsx` | Kept unchanged. |
| `FounderNotes.tsx` | Kept unchanged. |
| `DecisionLens.tsx` | Kept. Added equity pricing (§5). |
| `FirstRun.tsx` | Kept unchanged. |

**Deleted: `src/Coach.tsx` (175 lines), which the predecessor never addressed.**

It had to go, on two grounds. Structurally, it rendered in the exact slot the notes layer needed;
shipping both would have produced precisely the intrusive, spammy double-teaching this work exists
to prevent. And pedagogically it taught the wrong shape:

- It gave *answers*, not concepts — "drag User research up to 60–80%", "hire ONE engineer". In a
  simulation that removes the decision instead of equipping it.
- It ran a fixed sequence regardless of what the player already knew. A veteran returning for their
  tenth run got step 1 of 7.
- Its only memory was a step index, so it could not tell a player who had raised three rounds from
  one who had never opened Fundraising.

`observedSkills()` is the honest replacement: it reads demonstrated competence off the save, so a
player whose company already has employees, a board and resolved decisions is never taught hiring,
raising or deciding — in this run or any future one.

Its genuinely load-bearing content was preserved as concepts rather than steps: the demand-signal
chain became `demand-unknown` / `demand-known` (inventory item D), including the one mechanic
nothing else surfaces — a pivot carries prior research over as a permanent bonus to the next idea's
roll (`engine.ts: pivotBonus`) — and the "runway after" column moved into `hiring-fee`.

---

## 4. What was built

Everything reads `GameState`. Nothing writes it. Progress lives under `fm-onboarding-v1`, entirely
outside the game save; every field is re-validated on read and malformed data degrades to
"brand-new player", never to a crash.

### The Decision Lens — the highest-value piece
Answers inventory item C, in two halves split deliberately.

**Before you answer** it names only *which* resources each option touches, unsigned. That is the
vocabulary gap — "reputation and my own energy are things that exist, and press decisions spend
them" — and it is information a real founder obviously has. Direction and magnitude stay hidden, so
the decision is still a decision.

**After you answer** it prints the exact ledger. `Choice.effects` is fully resolved when the message
is created and stored in the save, so this is not a model of the engine — it is *the engine's own
numbers, read back*. Nothing is spoiled, because the choice is already locked.

The accelerator from §1C now resolves to:

> **WHAT IT DID** `Cash +$120k` `Hype +12` `Reputation +8` `gives up 7% of the company`
> **Dilution**: 7% of the company — about $61.1k at today's $873k valuation. That share is gone for
> good — it does not come back when the company grows.

The equity line is the addition this playthrough proved necessary: the specials that take a slice
(`accelerator`, `angel`) are *relative* cuts in `applyEffects`, and a percentage with no money
beside it lands as a word rather than a price. It retires itself after 20 resolved decisions.

### Founder's notes
One line in the margin of the screen you are already on, in the voice of somebody keeping notes on
their own company. Not an overlay, not a spotlight, not a modal, not a tour. One note at a time,
ever; only on the screen where the thing lives; never the same note twice on this device in any run;
gone for good the moment you demonstrably do the thing; at most three per game-week.

### Field guide
The pull half — 34 terms, grouped, searchable, each defined by what the simulation does. Never
opened by the game: only by the header button, the `?` key, or tapping a term inside a note. Escape
closes, Tab is trapped, focus returns where it came from. Career vocabulary is hidden in Quick Play,
where those words never appear. Its footer is the one off switch, and "Show them all again".

### First-run path
Answers inventory item A without hiding anything: a "Start here" marker on Quick Play, and one strip
under the three cards recommending Quick Play in B2B SaaS with the reason (steady revenue, slow
churn, mistakes that take weeks rather than days to kill you). One button sets it up. On the
briefing, a first-timer also gets what the market choice actually decides. Both vanish permanently
once a run has been played to an ending — after that the gate is the gate again.

### The nagging bug found in the browser
`markSeen()` originally ran *only* from the "Got it" button. A player who read a note and simply
navigated on had it re-offered the next week, and the week after — indefinitely, and for concepts
with no retiring skill there was no exit at all. That is exactly the nagging the module's own header
promises it does not do. Fixed with three changes:

- A chosen note is **pinned** to its `(run, week, screen)` slot, and the pin — not eligibility —
  decides what renders. Without that, recording a note would make it ineligible and it would vanish
  mid-sentence.
- **Five seconds on screen counts as delivered**, clicked or not. Long enough that paging through
  the nav does not silently burn a lesson; short enough that anyone who read it has spent it.
- `markSeen` is **idempotent**, so the dwell and the click do not charge the weekly cap twice.

Also fixed: `recordVisit` was keyed on `[screen, game]`, so "screens opened" counted weeks advanced
and every simulation tick wrote localStorage and woke every subscriber.

### How a player turns it off
The book icon in the header (or `?`) opens the field guide; its footer has a single **Founder's
notes — on/off** checkbox. Off silences the notes *and* the Decision Lens immediately and
permanently, across runs. The same checkbox turns it back on, and "Show them all again" forgets
every delivered lesson. Every note also carries an inline "Turn notes off". The field guide itself
is never silenced, because it is never pushed.

---

## 5. What was deliberately not built, and why

- **A tutorial, a tour, spotlights, or any modal that blocks play.** The owner's constraint rules
  them out and the simulation makes them useless: the interesting state is the one the player is
  in, and no scripted sequence can be about it.
- **Tooltips on every metric.** Twenty terms × every screen is chrome, and chrome is what makes a
  deep game look fussy rather than deep. The guide is one keystroke away instead — pull, not push.
- **A Career-specific lens over `lastExplanations` / `PMF_CAUSAL_CHAIN`.** Tempting, and the causal
  chain is already computed. But Career *already* surfaces it on Discovery, Product and the weekly
  briefing. Adding a fourth voice over the same data is duplication, not clarity. The gap was in
  Quick Play, and in the inbox — which is where the work went.
- **Onboarding for Arena.** PvP is a different game with a different audience, and a player who
  picks it over a marked "Start here" is making an informed choice. It would also have to teach
  under a 2½-minute round clock, which is its own design problem.
- **Fixing the `THIS WEEK` cash delta (§1H).** It is a real confusion and the fix belongs in the
  simulation's history records, which this work may not touch.
- **A rewrite of the mode/market copy on the gate.** The pips already carry `title` tooltips and the
  copy is good; the missing thing was a recommendation, not better prose.

---

## 6. What still confuses a new player after this work

Honest assessment. The layer narrows the gap; it does not close it.

1. **Career mode is still a wall.** Discovery presents hypothesis boards, segment truths, evidence
   reliability, cohort retention and repositioning at once. Four concepts and the existing
   in-product copy help, but Career needs its own designed first hour, not notes in a margin. It is
   correctly labelled "Early access"; that badge is doing real work.
2. **Nothing teaches strategy.** The player now knows what every number *means* and what every
   decision *did*. Nothing tells them whether 40 PMF at week 20 is good, or when to stop researching
   and start building. The Dashboard's benchmark panel is the closest thing and it is per-metric,
   not per-plan. This is the largest remaining gap and it is a *game* design problem, not an
   onboarding one.
3. **The first ninety seconds are still the weakest.** The recommendation strip helps, but the
   player still meets nine header metrics and thirteen nav items before their first decision.
4. **The one-off-charge trap is explained only after it bites.** `one-off-shock` fires post-hoc, by
   design — but a player can still lose a run to a recruiter fee they never saw coming.
5. **The three-notes-per-week cap can starve a fast tourer.** Someone who visits six screens in one
   week gets three lessons and silence. Correct under the anti-spam constraint, and the cost is
   real: the remaining lessons wait for a later week.
6. **The notes are tall on a phone.** One note can occupy two thirds of a 375px viewport. Nothing
   breaks and nothing overflows, but the incoming mobile-native pass should tighten the note's
   density rather than inherit this one.

---

## 7. Constraints honoured

- **Zero simulation changes.** No file under `src/game/**` or `test/**` was modified. Onboarding
  reads state and never writes it.
- **`npm run bots` byte-identical** — SHA-256 `da967c1e…`, unchanged before and after.
- **`npm test` ALL PASS**, golden traces in `test/modes.test.ts` untouched.
- **`npm run build` green.**
- Progress persists under `fm-onboarding-v1`, never inside the game save, and tolerates absent or
  malformed data.
- Keyboard navigable (`?` toggles the guide, Escape closes, Tab trapped, focus restored), notes are
  `role="note"` with `aria-live="polite"`, the dialog is a labelled `aria-modal`, and the global
  `prefers-reduced-motion` rule already neutralises the note's entry animation.
