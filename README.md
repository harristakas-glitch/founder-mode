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
| **Career** — Deep Simulation · Solo · Multi-session | *Build the company. Become the CEO.* | A deeper founder simulation about product, people, strategy and capital. |
| **Arena** — 2–4 Players · Online | *Outbuild your friends.* | Compete against other founders in the same market. |

Quick Play has three **formats**:

- **Standard Run** — *Start from zero.* Build the company and chase the best possible outcome. Five markets (B2B SaaS, Social, Fintech, Dev Tools, E-commerce), open-ended.
- **Daily Challenge** — *Same world. Same seed. One shot.* Everyone gets the same company today: 104 weeks, market locked, global leaderboard.
- **Scenarios** — *Different starts. Different problems.* Five alternate hands: Standard, Funding Winter, Rich Kid, Second-Time Founder, Late Entrant.

**Career is Early Access and says so in the UI.** Today it runs the same simulation as Quick Play. What it already has is its own capability table, so the deep systems on the roadmap — customer discovery, founder attention, executives, board politics — can switch on there without touching Quick Play or Arena.

Everything that differs between the three lives in `src/game/modes.ts` as **capabilities**, resolved once per run (`MODE base → FORMAT → SCENARIO → lobby overrides`). The engine never asks "which mode is this?", only "is this capability on?" — so moving a system between experiences is a one-table edit. Capabilities that aren't built yet are listed and left `false`; the game never claims functionality it doesn't have.

### Core systems

| System | What it does |
|---|---|
| **Product-market fit** | Every idea has a hidden market resonance. Research reveals it; pivoting rerolls it (your accumulated research improves the odds). Without PMF, users churn as fast as they arrive. |
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
  screens/         # one file per screen (Dashboard, Product, Market, Finance, Lobby, NewGame, …)
  net/             # Supabase: config, realtime rooms, leaderboard, auth
  components.tsx   # shared UI primitives (charts, cards, avatars)
  store.ts         # Zustand store: game actions + online match protocol
  App.tsx          # shell: nav, topbar, overlays, result screens
test/              # modes, rules and regression suites (plain tsx scripts)
supabase/          # SQL to run in the Supabase SQL editor
scripts/           # singlefile.mjs — bundles the game into one HTML file
```

## Develop

```bash
npm install
npm run dev        # dev server on :5173
npm test           # three suites: modes, rules, regressions
npm run build      # type-check + production build to dist/
node scripts/singlefile.mjs   # optional: self-contained "Founder Mode.html"
```

`npm test` runs headless against the real engine: `test/modes.test.ts` checks the three-mode
capability model (resolution order, sanitisation, legacy-save migration), `test/rules.test.ts`
checks that Arena's ruleset actually suppresses the systems it claims to and that attacks,
costs, cooldowns and the shield behave, and `test/regressions.test.ts` pins determinism and
past bug fixes.

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

---

Built with [Claude Code](https://claude.com/claude-code).
</content>
