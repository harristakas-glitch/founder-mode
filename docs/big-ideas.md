# Big ideas — the owner's feature backlog

A maintained capture of the owner's big feature ideas (started 2026-08-23). Each entry: the idea
in the owner's own framing, then design notes on how it would sit in the existing engine, and the
open questions to answer before building. These are IDEAS, not commitments — nothing here is
scheduled until the owner says "build it".

---

## 1. AI adoption

**The idea (owner):** the player should be able to improve the company's AI adoption along an
adoption framework. The more the adoption, the more the various metrics move: cost reduction,
growth, people have less workload, develop faster.

**Design notes:**
- Fits as a company-wide PROGRAM with stages (an adoption ladder — e.g. Experimenting → Tooling →
  Embedded → AI-native), not a one-off purchase. Each stage costs cash + founder attention and
  takes weeks, the way research and the ICO fork already work.
- The payoffs the owner names map cleanly onto existing engine levers: burn multiplier (cost
  reduction), growth rate, employee workload (energy/morale drain reduction), and product
  velocity (build output multiplier). No new metric needed — it moves the ones that exist.
- Needs a RISK edge to be a game and not a free upgrade: adoption too fast could carry a morale
  or quality shock (the team resents the tools / ships slop), sector-dependent — AI/ML Infra
  companies should adopt cheaper, Fintech under a trust penalty.
- Where it lives: Product area or a new HQ program card. The launch brief patterns (numbered
  steps, one verb) apply.

**Open questions:** Is adoption a slider, a staged commitment, or event-driven (adoption
opportunities arrive in the inbox)? Does it exist in Quick Play or is it a Simulation system?
What's the counterplay — can you over-adopt?

---

## 2. Product roadmap

**The idea (owner):** the roadmap should hold various FEATURES to develop or SYSTEMS to adopt —
not just sliders over abstract "product work". The player chooses priorities to finish. Each
idea benefits the project differently; the catalogue differs per company type (sector), and the
impact differs per target group (segment).

**Design notes:**
- This is the Build screen graduating from allocation (features/quality/bugs percentages) to a
  BACKLOG: named roadmap items with a cost in build-weeks, a payoff profile, and a queue the
  player reorders. "Onboarding flow redesign", "Usage-based billing", "SSO" — the shell mockups
  already imagined exactly this (the Product/Roadmap mock with quarters and bars).
- Per-sector catalogues: each of the six sectors gets its own item pool (Fintech: compliance,
  trust, audit trails; Social App: viral loops, feeds; AI/ML Infra: GPU efficiency…). Per-segment
  impact hooks straight into the Career PMF machinery — an item can move needIntensity fit,
  willingnessToPay fit, or retention FOR A SEGMENT, which is what "different impact based on
  target group" means mechanically.
- The current allocation sliders could survive as the "how the team spends the week" layer under
  the roadmap's "what we're building next" layer — or be replaced. Owner call later.
- Interacts with idea #1: "systems to adopt" (AI tooling among them) could be roadmap items —
  one queue for everything the team builds or adopts.

**Open questions:** How many items in flight at once (one focus vs a WIP limit)? Do items have
prerequisites/tiers? Does the roadmap exist in Quick Play (a lighter 3-item version?) or start as
Simulation-only? How does it read on mobile?

---

## 3. Live board meetings

**The idea (owner):** during a board meeting there should be a dedicated pop-up screen — the
user cannot do other things. Two or three questions, each with different outcomes on board
expectations, team morale, and next steps. The board should REMEMBER what was promised at the
last meeting and arrive with different sentiment based on what happened. And we need to think
about how this impacts overall gameplay after.

**Design notes:**
- The raw material already exists in Simulation: `BoardMeeting` in CareerUI, the PROMISE LEDGER
  (promises are recorded, settled weekly, and characters remember — docs/procedural-living-world
  -system.md), and board review strikes in the engine. This idea upgrades those from panels into
  a SCENE: a modal ritual that owns the screen, the way the results dialog already does.
- CAUTION, recorded from experience: the owner removed the weekly briefing modal within a day
  (memory: interruptions must be inline, no modals in the weekly loop). The board meeting is the
  argued EXCEPTION — it is not weekly (every ~12 weeks), it is diegetic (you are literally in a
  room you cannot leave), and the owner is explicitly asking for it. Keep it rare, keep it
  skippable-never, keep it SHORT (2-3 questions as specced).
- Question shape: generated from the run's actual state (the quarter's growth vs target, the
  runway, the promise from last meeting) — never canned. Each answer is a commitment the promise
  ledger records: "we'll hit 1,000 users by wk 40" becomes a tracked promise with consequences,
  which is exactly what the ledger was built for.
- Sentiment: the board chair character carries a disposition (the relationship system exists) —
  kept promises warm it, broken ones cool it, and disposition should gate real things: patience
  before strikes, bridge willingness, follow-on terms.
- "How this impacts gameplay after": the meeting's outputs are next-quarter targets (visible on
  HQ as the finish line — game-feel audit move #6), a morale delta the team feels that week, and
  the promise entries. The meeting is the game's heartbeat ritual; the weeks between are living
  with what you said in the room.

**Open questions:** Frequency (quarterly?) and whether Quick Play gets a light version. Can the
player ever defer a meeting (at a reputation cost)? Do the 2-3 questions come from a pool per
stage, or fully generated from state? What happens on a no-show ending (fired mid-meeting?).

---

*Add new ideas above this line with the same shape: the owner's framing first, mechanics second,
open questions last.*
