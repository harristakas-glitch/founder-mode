# Fixed rosters — people and money as a cast you learn

**Status:** design, not built. Owner direction 2026-08-22.
**Depends on:** the Team & Employee system (branch `worktree-agent-a1ebecdf59d04c90d`), which this
converts from a *generator* into a *content pipeline*.

---

## 1. The idea, and the real reason for it

Today every candidate and every investor is generated fresh. You compare stats, take the best row,
and nothing you learned survives the run. The proposal is a **fixed cast** — roughly 200 named
employees and ~30 named VCs — that recurs across runs.

The surface reason is realism. The real reason is that it **converts knowledge into skill**, which
is the difference between a game you play twice and one you play for months. On run four you know
Maya Chen is a monster at pre-seed and falls off by Series B; you know the engineer with the
flashy velocity number has quietly terrible craft; you know which fund always pushes for the
ultimatum. None of that is possible against random strangers.

Four consequences, in order of value:

1. **It makes the Arena a contest of judgement, not of stat-reading.** The machinery already
   exists: `sharedCandidates(seed, week)` deals every client a byte-identical pool of five, and
   contested hires resolve by sealed bid (`pickHiringWinner`). Today both players read the same
   strangers and bid on the same visible numbers. With a known cast, the auction becomes *"they
   will overpay for the flashy one; I know his retention record"* — which is exactly the
   competitive depth the Arena currently lacks (BACKLOG §2.2: a Sprint is "a pure score race").
2. **It makes content authorable.** A fixed person can carry a history, a reputation, a prior
   relationship. A generated one cannot carry narrative weight, which is why the Living World
   phases (`rivalArchetypes`, `longTermCallbacks`) have nothing to attach to.
3. **It unlocks photorealistic portraits.** Procedural people can never have photographs —
   infinite people, no images. Two hundred fixed people need exactly two hundred images, made
   once. **The roster is the prerequisite for the art direction, not a separate project.**
4. **It is the only way real people can appear.** Community figures, with consent, as hireable
   staff or as investors.

---

## 2. What exists today, and what it costs us

| | Today | Read by the simulation? |
|---|---|---|
| Candidates | `makeCandidate` / `sharedCandidates(seed, week)`, 5 at a time, refreshed weekly | Yes — skill, salary, role, traits all matter |
| Investors | `INVESTORS` in `data.ts` — **12 name strings** | **No.** `pitchInvestors` builds every term sheet identically and attaches a random name |

The investor list is the `expansionPotential` defect exactly: generated, displayed, believed by the
player, and read by no formula anywhere. A player who learns to prefer "Sandhill Standard" over
"SoftMoney Vision Fund" has learned nothing, because there is nothing to learn. **Fixing that is
the single highest-value half of this whole proposal, and it is also the smaller half.**

---

## 3. The VC roster — do this first

Thirty entities beats two hundred for a first slice: less content, higher personality density, and
startup culture already thinks of investors as characters.

### 3.1 Size and shape

**~30 firms**, spread across stage focus:

| Focus | Count | Cheques | Character |
|---|---|---|---|
| Angels / pre-seed | 8 | small, fast, generous on price | founder-friendly, light touch, rarely follow on |
| Seed funds | 10 | the workhorse band | the ones you meet most |
| Series A/B | 8 | large, price-disciplined | where board pressure begins |
| Growth / crossover | 4 | very large, brutal terms | late only; will not look at you early |

### 3.2 What must actually VARY — every field mechanical, none cosmetic

The rule from §2: if it is shown, it is wired, or it is labelled flavour. Each firm carries:

- **`priceMultiplier`** (≈0.8–1.25) — applied to the offered pre-money. The direct expression of
  "this fund pays up" versus "this fund grinds you".
- **`checkBand`** — min/max round size. A pre-seed angel physically cannot write the Series B.
- **`equityAppetite`** — how much of the company they want for that cheque, which combined with
  price is the whole negotiation.
- **`stageFocus`** — which stages they appear at *at all*. This is what makes a name feel real:
  you stop seeing the angels once you are past Series A, and that itself tells a story.
- **`boardPatience`** — how many missed targets before a strike, and how fast strikes escalate to
  the ultimatum. The board mechanics already exist (`Board.strikes`, `defied`, the third-strike
  ultimatum); today they are identical regardless of who funded you. This is the single most
  characterful hook available.
- **`followOn`** — probability they lead the next round. A fund that backs you again is worth
  taking a worse price from, which is a genuinely interesting trade the game cannot currently pose.
- **`reputation`** — a small, honest effect on hiring and hype. A famous name on the cap table
  should help you recruit. Keep it small; it must not become the dominant lever.

### 3.3 Archetypes worth writing (so they are distinguishable, not just numbered)

The generous angel who cannot follow on · the index-everything seed fund that writes fifty cheques
and forgets you · the high-conviction fund that pays up and then expects the moon at the board ·
the price-disciplined grinder whose terms are dull but whose follow-on is reliable · the corporate
strategic with an agenda · the celebrity whose name recruits for you and whose attention you never
get.

**Balance rule:** no firm may be strictly better than another. Every one trades price against
patience, cheque size against control, or generosity now against follow-on later.

---

## 4. The employee roster

### 4.1 Size — reasoned, not guessed

Five candidates are visible at a time and turn over weekly, so a long (~120-week) run exposes on
the order of 60–100 distinct people. Two competing pressures:

- **Too small** (say 60) and one run shows you everything; the cast is exhausted and hiring becomes
  a memory test rather than a judgement.
- **Too large** (say 600) and nobody recurs often enough to be learned, which forfeits the entire
  point.

**Target: ~200.** One long run shows roughly a third to a half of the cast; by the third run the
standouts are familiar. That is the Football Manager shape — thousands exist, dozens are *known*.

### 4.2 Distribution by tier

Skill drives salary, so the tier mix decides whether the roster serves a whole run:

| Tier | Skill | Share | ~Count | Job in the game |
|---|---|---|---|---|
| Junior | 1–3 | 35% | 70 | affordable at pre-seed; the growth bet |
| Mid | 4–6 | 40% | 80 | the workhorse band, always available |
| Senior | 7–8 | 18% | 36 | a real cash decision |
| Star | 9–10 | 7% | 14 | rare, memorable, run-defining |

Fourteen stars is deliberate: few enough that each is an event, many enough that runs differ.

**By role**, roughly matching what a startup actually hires: engineer 40%, designer 20%,
marketer 20%, sales 20%.

### 4.3 Stage affinity — the heart of it

The brief's core promise is that the *same person* is a great pre-seed hire and a mediocre Series B
one. That must hold **within every tier**, or affinity collapses into "seniors are for later":

- juniors who thrive in chaos and juniors who need structure to be any good
- seniors who are brilliant at scale and drown in a five-person company
- a few genuine generalists (flat curve) — rare, and correspondingly expensive

### 4.4 Availability — what stops it going stale

Existence is not availability. Each entry carries:

- **`rarity`** — how often they surface at all. Stars rare, mid-tier common.
- **`stageGate`** — a growth-stage director will not answer a pre-seed advert. This also naturally
  paces the roster across a run.
- **`sectorAffinity`** (optional) — some people only appear in fintech, or never in social. Free
  variety across runs, and it flavours the sector choice.
- **Per-run sampling.** The run's seed selects a *subset*, so two runs in the same sector show
  overlapping but different casts: recurring faces without repetition.

### 4.5 The recognition hook — the feature that makes it click

Once the cast is fixed, the game can say: **"You hired her at Northreef, week 40."** A small marker
on the card, drawn from local history. It costs almost nothing, it is impossible without a fixed
roster, and it is the moment a name becomes a memory. Ship it in the same slice, not later.

---

## 5. Data format and the build pipeline

### 5.1 Generate, then curate — do not hand-author 200 people

The people system on the feature branch already generates plausible humans deterministically. The
pipeline is therefore:

1. Run the existing generator to emit ~250 candidates as data.
2. **Freeze** the output to a checked-in table.
3. Curate: name them, write two-line backgrounds, hand-tune the tier and affinity distribution
   against §4.2–4.3, promote ~14 to stars and give those real character.
4. Drop the surplus.

This is how sports games seed their databases, and it turns a month of authoring into a few days
of editing.

### 5.2 Shape

Roster entries are **static data with stable ids**. Candidates become a *selection* from a table
rather than a *generation*, which is strictly better for the properties this repo protects:
selection is cheaper, more deterministic, and replay-verifiable — a journal can record an id.

```
RosterPerson {
  id            // stable forever; what saves and journals store
  name
  role
  tier / skill
  attributes    // the five, hand-tunable
  stageAffinity // per stage
  salaryBand
  background    // the two lines the card shows
  rarity, stageGate, sectorAffinity?
  photo?        // ABSENT = render the procedural portrait
}
```

`photo` is optional on purpose, following this repo's absent-means-default convention: the anime
SVG is the permanent floor, photographs are an upgrade that lands per-person as art is made. No
migration, no flag day, and the game never breaks on a missing image.

### 5.3 Portraits

**Anime/cel style ships now** (owner decision 2026-08-22, after a side-by-side bake-off: at 44px —
the real mobile avatar size — semi-realistic portraits are indistinguishable brown blobs, while
big eyes, hard cel shading and a bold hair silhouette stay legible at every size).

**Photorealistic is the stated goal.** With a fixed roster it is tractable: ~200 images at 256px
WebP is roughly 15 KB each ≈ 3 MB total, lazy-loaded so it never touches first paint. Generate them
against one locked prompt template — identical framing, lighting and backdrop — or they read as 200
unrelated stock photos rather than one cast. Synthetic faces avoid consent questions entirely;
real photographs belong only to the real-people tier, with permission, where being real is the
point.

---

## 6. Risks, and what would tell us it went wrong

- **Repetition.** The failure mode is "these five again". Mitigated by per-run sampling and rarity;
  the tell is players describing the pool as samey rather than familiar.
- **Fixed rosters have fixed balance.** Generation hides mistakes behind averages; 200 hand-tuned
  people do not. Every tier needs a bot sweep, and the protected property stands: Disciplined
  Discovery strongest in all six sectors.
- **Authoring burden** — answered by generate-then-curate (§5.1).
- **Determinism and saves** — improved, not threatened: ids are stabler than generated objects.
  Old saves hold generated employees with no roster id; they must keep working, which is the same
  absent-means-default rule as everywhere else.

---

## 7. Order of work

1. **VC roster** — ~30 firms, the seven mechanical fields, board patience and follow-on wired.
   Smallest slice, highest ratio of depth to content, and it closes a live "displayed but unwired"
   defect.
2. **Employee roster** — generate → freeze → curate to ~200, with availability rules.
3. **The recognition hook** — "you hired her before", once ids are stable.
4. **Photo layer** — per-person, whenever the art exists.

Each is independently shippable and independently measurable.
