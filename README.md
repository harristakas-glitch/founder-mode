# Founder Mode 🦄

**Run a startup like a football manager.** You have $200,000, an empty office, and a dream — find product-market fit, outgrow your rivals, survive your own board, and build a unicorn. Or die trying.

**Play now:** https://harristakas-glitch.github.io/founder-mode/

![Founder Mode](public/og.jpg)

## The game

Founder Mode is a turn-based management sim. Each turn is one week: set your team's focus, hire and fire, spend on marketing, answer the events in your inbox, then hit **Advance Week** and watch the simulation respond. Runs end in bankruptcy, acquisition, getting fired by your board, an IPO — or a $1,000,000,000 valuation.

### Core systems

| System | What it does |
|---|---|
| **Product-market fit** | Every idea has a hidden market resonance. Research reveals it; pivoting rerolls it (your accumulated research improves the odds). Without PMF, users churn as fast as they arrive. |
| **Rivals** | Three AI competitors per market with their own funding rounds, launches, and failures. They steal your users when their product is better — or you can **acquire them** (cash or stock, with rebuff risk). |
| **Fundraising** | Pre-seed → Series C. Term sheets price off your valuation and the funding climate; round sizes chase growth. Down rounds hurt. A one-time angel and a bridge loan exist for the desperate. |
| **The board** | Investor money brings growth targets, reviewed every 10 weeks. Pass by user growth, revenue growth, or real profitability. Three strikes = ultimatum; keep failing = you're fired. |
| **Macro economy** | A market index, central-bank rate, and inflation tick weekly — driving the funding climate, pricing your debt, and inflating salaries. Oil shocks, rate cuts, rallies, crashes. |
| **Bank debt** | Borrow up to half your ARR at rate + spread, no dilution — but a revenue covenant, stated up front, bites hard if you slip. |
| **Team** | Employees have skill, morale, salaries, and traits (10x, Craftsman, Mercenary, Culture carrier, Drama magnet). Offers can be declined, notice periods apply, recruiters take 15%. Rally everyone with an all-hands pitch — three speech styles with live success odds. |
| **New verticals** | Escape a saturated market: send a tiger team into a second sector with its own PMF journey and TAM. Multi-product companies stack S-curves. |
| **IPO** | $300M valuation + $10M ARR unlocks the S-1: four weeks of scrutiny, four of roadshow, then pricing day — pop, modest debut, or a pulled offering. |
| **Story arcs** | Multi-week narratives with memory: the MegaCorp pilot, a regulator inquiry, the influencer who turns, the acquired team that gels (or doesn't). |
| **Founder energy** | Your own tank, 0–100. Pitches, pivots, IPOs, and board fights drain it; low energy weakens everything you touch; hitting empty forces a burnout. Recharge weeks cost roadmap time. |
| **One-on-ones** | Employees bring their asks to your door — promotions, remote work, side projects, sabbaticals — with targeted consequences for that person's morale and salary. |
| **Catastrophes** | Late-game, sector-flavored nightmares: the fintech breach, the social-app algorithm change, the e-commerce logistics meltdown, the dev-tools CVE. |
| **Secondary sales** | From Series B, take real money off the table — 2% of your stake at a discount, banked into your final payout no matter how the run ends. |
| **Events & achievements** | A 61-card event deck (every option shows its price — no hidden bills) and 26 cross-run achievement badges. |

### Modes

- **Free play** — solo vs AI rivals, five markets (B2B SaaS, Social, Fintech, Dev Tools, E-commerce), five scenario starts (Funding Winter, Rich Kid, Second-Time Founder, Late Entrant, Standard).
- **Daily Challenge** — the same seeded world for every player on Earth, 104 weeks, global leaderboard.
- **Online multiplayer** — 2–4 founders on different devices, one shared market, rounds advance when everyone is ready or a 2½-minute clock expires. Rooms with 5-letter codes, live standings, chat, emotes, refresh-proof reconnection.

### Single player deep, multiplayer mean

The two experiences run different rule sets. Solo campaigns turn everything on — the full education. Multiplayer defaults to **battle mode**: the slow story systems (arcs, one-on-ones, catastrophes, energy, board reviews) are switched off so turns stay fast, the economic weapons (debt, verticals, IPO, macro) stay on — and **PvP attacks** come alive:

| Attack | Cost | Effect |
|---|---|---|
| 🎣 **Poach talent** | $60k | Their team's morale drops; two strong candidates appear in your hiring pool |
| 🗞 **Smear campaign** | $40k | Their hype and reputation take a hit — and a little mud sticks to you |
| ⚔️ **User raid** | $80k | You convert ~3% of their user base with targeted ads |

Every operation costs cash, puts your ops team on a 5-week cooldown — and the victim is told exactly who did it. The host can toggle **any** of the ten rule systems in the lobby before starting, from a pure-PvP knife fight to a full-depth marathon.

## Tech

Fully client-side single-page app — no game server.

- **Vite 7 + React 19 + TypeScript (strict) + Tailwind CSS v4 + Zustand** (persisted to localStorage) + lucide-react
- **Simulation**: pure functions in `src/game/engine.ts` — deterministic-seedable (mulberry32) for daily challenges and fair multiplayer starts, bot-testable headlessly
- **Multiplayer**: Supabase Realtime channels only (presence + broadcast) — each client simulates its own company; no database rows involved
- **Leaderboard**: one Supabase table (`supabase/leaderboard.sql`) with row-level security
- **Auth (optional)**: Supabase Auth with Google / X OAuth — anonymous play is always available
- **PWA**: installable, offline-capable (service worker, production only)

### Layout

```
src/
  game/            # the simulation: engine, data (events/sectors), arcs, achievements, types
  screens/         # one file per screen (Dashboard, Product, Market, Finance, …)
  net/             # Supabase: config, realtime rooms, leaderboard, auth
  components.tsx   # shared UI primitives (charts, cards, avatars)
  store.ts         # Zustand store: game actions + online match protocol
  App.tsx          # shell: nav, topbar, overlays, result screens
supabase/          # SQL to run in the Supabase SQL editor
scripts/           # singlefile.mjs — bundles the game into one HTML file
```

## Develop

```bash
npm install
npm run dev        # dev server on :5173
npm run build      # type-check + production build to dist/
node scripts/singlefile.mjs   # optional: self-contained "Founder Mode.html"
```

Deploys automatically to GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`).

### Online features setup

The game runs fully offline/anonymous without any of this. To enable online play on a fork:

1. Create a free [Supabase](https://supabase.com) project; paste its URL and publishable key into `src/net/config.ts`. Multiplayer works immediately (realtime channels need no schema).
2. Run `supabase/leaderboard.sql` in the SQL Editor → global daily leaderboard.
3. Optional social login: run `supabase/auth-upgrade.sql`, set the Site URL / redirect allowlist under Authentication → URL Configuration, and enable the Google (and/or X) provider with OAuth credentials from their consoles.

## Balance philosophy

Every mechanic ships with headless bot validation: careless play should die by week ~45, disciplined SaaS play reaches a unicorn around week 130–180, Social is a winnable lottery, and no cost is ever hidden — the game may surprise you with situations, never with invoices.

---

Built with [Claude Code](https://claude.com/claude-code).
