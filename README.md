# Founder Mode 🦄

**Run a startup like a football manager.** You have $200,000, an empty office, and a dream — find product-market fit, outgrow your rivals, survive your own board, and build a unicorn. Or die trying.

**Play now:** https://harristakas-glitch.github.io/founder-mode/

![Founder Mode](public/og.jpg)

## The game

Founder Mode is a turn-based management sim. Each turn is one week: set your team's focus, hire and fire, spend on marketing, answer the events in your inbox, then hit **Advance Week** and watch the simulation respond. Runs end in bankruptcy, acquisition, getting fired by your board, an IPO — or a $1,000,000,000 valuation.

## Three experiences, one simulation

```
PLAY
├── QUICK PLAY   ⚡  Standard Run · Daily Challenge · Scenarios
├── CAREER       🏛  a deeper founder simulation (Early Access)
└── ARENA        ⚔️  multiplayer PvP, 2–4 players
```

| Experience | Promise | What it is |
|---|---|---|
| **Quick Play** — 30–60 min · Solo | *Build a unicorn tonight.* | Fast startup management. Start a company, make the big decisions and see how far you can take it. |
| **Career** — Deep Simulation · Solo · Multi-session | *Build the company. Become the CEO.* | A deeper founder simulation about product, people, strategy and capital. Runs its own product-market-fit simulation. |
| **Arena** — 2–4 Players · Online | *Outbuild your friends.* | Compete against other founders in the same market. |

Quick Play has three **formats**:

- **Standard Run** — *Start from zero.* Build the company and chase the best possible outcome. Five markets (B2B SaaS, Social, Fintech, Dev Tools, E-commerce), open-ended.
- **Daily Challenge** — *Same world. Same seed. One shot.* Everyone gets the same company today: 104 weeks, market locked, global leaderboard.
- **Scenarios** — *Different starts. Different problems.* Five alternate hands: Standard, Funding Winter, Rich Kid, Second-Time Founder, Late Entrant.

**Career is Early Access and says so in the UI.** It is no longer a reskin of Quick Play: Phase 1 shipped, and Career now replaces the single hidden PMF number with [a full discovery simulation](#career-you-do-not-know-your-market-yet) — segments, beliefs, experiments and cohorts. The rest of the roadmap (founder attention, executives, board politics) is still to come.

Everything that differs between the three lives in `src/game/modes.ts` as **capabilities**, resolved once per run (`MODE base → FORMAT → SCENARIO → lobby overrides`). The engine never asks "which mode is this?", only "is this capability on?" — so moving a system between experiences is a one-table edit. Capabilities that aren't built yet are listed and left `false`; the game never claims functionality it doesn't have. Career's five extra capabilities (`detailedPMF`, `customerSegments`, `customerResearch`, `hypothesisBoard`, `decisionJournal`) are what switch the discovery simulation on, and they are `false` everywhere else.

### Core systems

| System | What it does |
|---|---|
| **Product-market fit** | Every idea has a hidden market resonance. Research reveals it; pivoting rerolls it (your accumulated research improves the odds). Without PMF, users churn as fast as they arrive. *Career replaces this whole row — see below.* |
| **Rivals** | Three AI competitors per market with their own funding rounds, launches, and failures. They steal your users when their product is better — or you can **acquire them** (cash or stock, with rebuff risk). |
| **Fundraising** | Pre-seed → Series C. Term sheets price off your valuation and the funding climate; round sizes chase growth. Down rounds hurt. A one-time emergency bridge exists for companies worth saving — 15% of the company, and there is no second one. |
| **The board** | Investor money brings growth targets, reviewed every ten weeks. Pass by user growth, revenue growth, or real profitability. Three strikes = ultimatum; keep failing = you're fired. |
| **Macro economy** | A market index, central-bank rate, and inflation tick weekly — driving the funding climate, pricing your debt, and inflating salaries. Oil shocks, rate cuts, rallies, crashes. |
| **Bank debt** | Borrow up to half your ARR (capped at $10M) at rate + spread, no dilution — but a revenue covenant, stated up front, bites hard if you slip. |
| **Team** | Employees have skill, morale, salaries, and traits: **10x** (+70% output), **Mercenary** (+15%, bails early when things wobble), **Craftsman** (+10% and quietly kills bugs), **Culture carrier** (lifts everyone's morale weekly), **Drama magnet** (drains it). Offers can be declined, notice periods apply, recruiters take 15%. |
| **Coordination overhead** | Past 8 people, every extra head costs the whole org 1.5% effectiveness, down to a 60% floor. Headcount is a decision, not a scoreboard. |
| **All-hands pitch** | Rally the company with a speech — three styles (Vision, Numbers, War), each with live success odds computed from the state of the business. The team can smell a speech that isn't earned. |
| **New verticals** | Escape a saturated market: send a tiger team into a second sector with its own PMF journey and TAM. Multi-product companies stack S-curves. |
| **IPO** | $500M valuation + $10M ARR + $2M for bankers unlocks the S-1: four weeks of scrutiny, four of roadshow, then pricing day — pop, modest debut, or a pulled offering. |
| **Story arcs** | Six multi-week narratives with memory: the MegaCorp pilot, a regulator inquiry, the influencer who turns, the acquired team that gels (or doesn't), the whale that wobbles, the open-source clone. |
| **Founder energy** | Your own tank, 0–100. Pitches, pivots, IPOs, and board fights drain it; low energy weakens everything you touch; hitting empty forces a burnout. Recharge weeks cost roadmap time. |
| **One-on-ones** | Employees bring their asks to your door — promotions, remote work, side projects, sabbaticals — with targeted consequences for that person's morale and salary. |
| **Catastrophes** | Late-game, sector-flavored nightmares: the fintech breach, the social-app algorithm change, the e-commerce logistics meltdown, the dev-tools CVE. |
| **Secondary sales** | From Series B, take real money off the table — 2% of the company at a 30% discount, banked into your final payout no matter how the run ends. Once per stage. |
| **Events & achievements** | A 66-card event deck (every option shows its price — no hidden bills) and 26 cross-run achievement badges. |

### Career: you do not know your market yet

Career Phase 1 — **PMF Discovery 2.0** — is shipped. Quick Play asks whether your idea resonates. Career asks *with whom*, and makes you pay to find out. Full spec and status: [docs/career-phase-1-pmf-discovery.md](docs/career-phase-1-pmf-discovery.md). Code: `src/game/career/`.

**Three customer segments per sector**, fifteen in all, with genuinely different economics rather than three names for the same market.

| Sector | Cheap to reach, quick to leave | Harder to win, but they stay | Slow, demanding, pays like it |
|---|---|---|---|
| **B2B SaaS** | Freelancers | Small Teams | Enterprise |
| **Dev Tools** | Individual Developers | Startup Engineering Teams | Enterprise Engineering |
| **E-commerce** | Individual Sellers | Growing Brands | Enterprise Retailers |
| **Fintech** | Everyday Consumers | SMB Finance Teams | Regulated Institutions |
| **Social** | Casual Users | Creators | Brand Advertisers |

Each segment holds nine hidden numbers — problem intensity, willingness to pay, retention potential, reachability, product bar, market size, competitive intensity, sales cycle, expansion potential. They are generated once from `(seed, sector, scenario, segmentId)` and **never rerolled**: not by research, not by a pivot, not by reloading the save. Variance around each archetype is wide enough that a campaign can hand you an unusually rich freelancer market, or an enterprise segment that simply is not there. Which segment is best is a fact about your seed, and you have to go and find it.

**You never see those numbers.** You see beliefs: an estimate, a band that narrows as confidence rises, and a confidence label. Every segment starts with one metric given a *confident and badly wrong* prior — the assumption worth killing. Evidence updates belief in proportion to how much it deserves to be trusted, and confidence saturates: you cannot become certain from a chair.

**Five experiments, on a reliability hierarchy.** Stated intent is cheap and weak; behaviour is slow and strong.

| Experiment | Time | Cash | Also costs | Base reliability | Measures |
|---|---|---|---|---|---|
| Customer interviews | 2 wks | $4,000 | — | 0.34 | problem intensity, product bar, willingness to pay |
| Landing page test | 2 wks | $6,000 | $3k/wk marketing | 0.44 | reachability, problem intensity, market size |
| Prototype test | 3 wks | $12,000 | 35% of engineering | 0.62 | product bar, problem intensity, retention potential |
| Pricing test | 3 wks | $9,000 | 10% eng, $2k/wk marketing | 0.70 | willingness to pay, reachability |
| Paid pilot | 7 wks | $28,000 | 45% of engineering | 0.88 | retention potential, willingness to pay, product bar, expansion |

Three can run at once. They take real weeks, eat real roadmap, and the results arrive in your inbox when they finish — not when you click.

**Evidence has quality, and cheap evidence lies in a predictable direction.** Effective reliability falls further with a small sample, a weak team, and a hard-to-reach segment (your sample is whoever answered). Interviews and landing pages *systematically overstate* willingness to pay and problem intensity. The test suite measures the bias: interviews overstate willingness to pay by **21.1 points** on average, a pricing test by **2.9**. That is the nine-of-twelve-said-they'd-pay-and-two-actually-did lesson, encoded. The reverse trap exists too — run a prototype test with a weak product and you get a false negative on a market that was fine.

**Customers arrive in cohorts.** Each week's intake keeps its own acquisition price and product quality, and retention is resolved per cohort, per week — roughly 1% weekly churn where everything fits, 15–20% where it doesn't. Four-week retention is measured per segment. Aggregate growth can hide a rotting base, which is the entire reason cohorts exist.

**PMF is an output, never an input.** It is read off customers who stayed and paid, with only a small contribution from confidence. Below 15 customers, perfect research caps out at *Problem validated* — research alone can never manufacture PMF. High acquisition with low retention scores as *Showing value*, not fit. Both are asserted in `test/career-pmf.test.ts`. The ladder runs Unproven → No clear demand → Early signal → Problem validated → Showing value → Emerging PMF → Strong PMF → Scalable PMF.

**Changing your mind costs something.** A segment pivot triggers 2–6 weeks of repositioning — sized by how far apart the two segments' product bars and price tolerances are — at 0.7× product output and 0.55× acquisition. Existing customers are not deleted; nobody is optimising for them any more. It goes in the journal, as does every experiment, price change and focus change.

Alongside the numbers, each week produces **causal explanations** ("customer count is rising, but retention is 41% — this growth is rented, not owned"), the **biggest open uncertainty**, and a **suggested next experiment** with its reasoning. The Career-only **Discovery** screen holds the Hypothesis Board, the experiment catalogue, your bet (target segment, pricing, product focus) and the decision journal. It is gated on the `hypothesisBoard` capability, so it never appears in Quick Play or Arena.

**Quick Play, Daily Challenge and Arena are unchanged.** They keep the simple PMF model and carry no Career state at all — `career` is absent from those saves, and the test suite asserts it for all three.

### Arena: lean, fast, mean

Arena runs the same engine with a different capability set. The slow narrative systems (arcs, one-on-ones, catastrophes, founder energy, board reviews) are off so turns stay fast; the economic weapons (debt, verticals, IPO, macro) stay on — and **PvP attacks** come alive.

2–4 founders on different devices share one seeded market. Rooms have 5-letter codes; rounds advance when everyone is ready or the 2½-minute clock expires. Live standings, chat, emotes, refresh-proof reconnection. The host picks the market, the match length (⚡ Sprint 52 weeks / 🏁 Classic 104) and can toggle **any** of the ten rule systems in the lobby — from a pure-PvP knife fight to a full-depth marathon.

| Attack | Base cost | Effect |
|---|---|---|
| 🎣 **Poach talent** | $50k | They lose their best person and 6 morale; two above-average candidates land in your hiring pool |
| 🗞 **Smear campaign** | $40k | Their hype −10 and reputation −3 — and 2 points of mud sticks to you |
| ⚔️ **User raid** | $80k | You convert ~3.2% of their users, scaled 0.5×–3× by how much bigger they are than you; they lose 4% |

Costs scale with your stage (`base × (1 + stage × 0.5)`), so dirty tricks stay a real decision at Series C. Every operation drains 4 founder energy, puts your ops team on a 5-week cooldown — and the victim is told exactly who did it.

The counterplay is the **Crisis Retainer**: $120k at pre-seed, rising a further $120k per stage, buys 8 weeks in which *every* incoming attack fizzles before it touches morale, press, or users. The attacker still pays and still burns their cooldown. Your rivals don't know you have it.

## Tech

Fully client-side single-page app — no game server.

- **Vite 7 + React 19 + TypeScript (strict) + Tailwind CSS v4 + Zustand** (persisted to localStorage) + lucide-react
- **Simulation**: pure functions in `src/game/engine.ts`, bot-testable headlessly
- **Deterministic**: the same seed + mode + format + scenario + decisions reproduce exactly. Every draw comes from the run's seed via `withSeed`/`mixSeed` (mulberry32), reseeded per (seed, week, tick) — never from `Math.random()`
- **Multiplayer**: Supabase Realtime channels only (presence + broadcast) — each client simulates its own company; no database rows involved
- **Leaderboard**: one Supabase table (`supabase/leaderboard-secure.sql`) with row-level security
- **Auth (optional)**: Supabase Auth with Google / X OAuth — anonymous play is always available
- **PWA**: installable, offline-capable (service worker, production only)

### Layout

```
src/
  game/            # the simulation: modes (the capability model), engine, data, arcs, achievements, types
    career/        # Career-only PMF discovery: types, segments, pmf, tick
  screens/         # one file per screen (Dashboard, Product, Market, Discovery, Finance, Lobby, NewGame, …)
  net/             # Supabase: config, realtime rooms, leaderboard, auth
  components.tsx   # shared UI primitives (charts, cards, avatars)
  store.ts         # Zustand store: game actions + online match protocol
  App.tsx          # shell: nav, topbar, overlays, result screens
test/              # modes, career-pmf, rules and regression suites (plain tsx scripts)
docs/              # design specs for the bigger systems
supabase/          # SQL to run in the Supabase SQL editor
scripts/           # singlefile.mjs — bundles the game into one HTML file
```

## Develop

```bash
npm install
npm run dev        # dev server on :5173
npm test           # four suites: modes, career-pmf, rules, regressions
npm run build      # type-check + production build to dist/
node scripts/singlefile.mjs   # optional: self-contained "Founder Mode.html"
```

`npm test` runs headless against the real engine: `test/modes.test.ts` checks the three-mode
capability model (resolution order, sanitisation, legacy-save migration), `test/career-pmf.test.ts`
checks the discovery simulation (truth never rerolls, instrument bias is measured in points,
PMF cannot be researched into existence, and Quick Play/Daily/Arena carry no Career state),
`test/rules.test.ts` checks that Arena's ruleset actually suppresses the systems it claims to
and that attacks, costs, cooldowns and the shield behave, and `test/regressions.test.ts` pins
determinism and past bug fixes.

Deploys automatically to GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`).

Known-but-unfixed work lives in [BACKLOG.md](BACKLOG.md).

### Versions and rolling back

Tagged versions live under [Releases](https://github.com/harristakas-glitch/founder-mode/releases).
Each release marks a state where the tests, the type-check and the build all passed, and has a
self-contained `.html` build attached — double-click it to play that exact version offline, which
is the fastest way to check whether a bug is new.

To put the site back on a previous version:

```bash
git revert --no-commit v1.0.0..HEAD && git commit -m "Roll back to v1.0.0" && git push
```

That undoes everything after the tag while keeping the history intact (nothing is erased, so you
can roll forward again). Then run the **Deploy to GitHub Pages** workflow from the Actions tab.

To cut a new version once `npm test` and `npm run build` pass:

```bash
git tag -a v1.1.0 -m "what changed" && git push origin v1.1.0
```

### Online features setup

The game runs fully offline/anonymous without any of this. To enable online play on a fork:

1. Create a free [Supabase](https://supabase.com) project; paste its URL and publishable key into `src/net/config.ts`. Arena works immediately (realtime channels need no schema).
2. Run `supabase/leaderboard-secure.sql` in the SQL Editor — and only that one. It supersedes `leaderboard.sql` and `leaderboard-hardening.sql`, and is idempotent. Ownership of a leaderboard row is proved by a per-device secret that the database stores only as a **bcrypt hash**, so reading the column gains an attacker nothing. A trigger makes `player_id`, `day` and the secret immutable and scores monotonic: even a leaked secret can only ever raise that one row's score, never blank it, steal it, or remove it.
3. Optional social login: set the Site URL / redirect allowlist under Authentication → URL Configuration, and enable the Google (and/or X) provider with OAuth credentials from their consoles.
4. Set a spending cap and usage alerts in the Supabase dashboard — the publishable key is public, and nothing else rate-limits it.

Nothing simulates the game server-side, so a determined player can still submit a cheated score for **themselves**. Closing that needs an authoritative server, not row-level security.

## Balance philosophy

Every mechanic ships with headless bot validation: careless play should die by week ~45, disciplined SaaS play reaches a unicorn around week 130–180, Social is a winnable lottery, and no cost is ever hidden — the game may surprise you with situations, never with invoices.

Career's discovery layer was validated the same way — three bot strategies over 8 seeds and 90 weeks, checking that the three produce genuinely different companies rather than converging on one plateau:

| Strategy | Survived | Customers | Retention | Best PMF reached |
|---|---|---|---|---|
| **Careless Growth** — spend, never research | 6 / 8 | ~474 | 28% | never past *Showing value* |
| **Disciplined Discovery** — experiment first, scale late | 7 / 8 | ~238 | 72% | mostly *Emerging PMF* |
| **Enterprise Bet** — pivot high, price premium, build to the bar | 7 / 8 | ~527 | 87% | *Strong* or *Scalable* in 7 / 8 |

Careless growth buys customers fastest and keeps almost none of them — at 28% retention the base is rented, not owned, and it never crosses into fit. Disciplined discovery ends with the smallest company and the cleanest one. The enterprise bet finishes ahead on this sample, but it is the slowest and most expensive line to run, and it only pays when the seed actually put a strong high-end segment there. Finding out whether it did is what the experiments are for.

---

Built with [Claude Code](https://claude.com/claude-code).
</content>
