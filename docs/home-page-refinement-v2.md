# Home Page Refinement V2 — as implemented

The owner's V2 brief ("Founder Mode — Home Page Refinement V2") in the form it actually shipped.
The brief's numbers were starting points; the values below are the tuned, final ones. Where the
implementation deviates from the letter of the brief, the deviation and its reason are recorded —
this document is the source of truth for the current Home page, not the aspiration for it.

The target, unchanged from the brief:

> **Dark editorial business photography + premium strategy-game interface** — not black + purple
> gaming UI. The Home page is a game-mode selector with a great hero, and the hero must never push
> Quick Run / Simulation / Arena below the fold on a normal laptop.

## What shipped

### 1. The hero owns the page chrome (brief §7–§13)

- There is **no separate header row** on the launcher any more. The old top bar (an empty span +
  the auth control, ~40px of dead height) renders only on the briefing view, where it carries the
  back button.
- **`FOUNDER MODE`** wordmark (purple glyph + spaced caps) sits top-left *inside* the hero.
- The **profile / login control** sits top-right inside the hero composition. Structurally it is
  absolutely positioned in a wrapper *around* the hero `<section>`, not inside it — the section
  clips (`overflow-hidden`), and a control inside it could never open its profile-card popover past
  the hero's bottom edge. The popover floats (`absolute`), pushes nothing, and closes on
  Escape/outside-click, unchanged.
- The pill is 36px tall; on phones it collapses to the avatar alone. Logged-out shows one pill in
  the same spot ("Log in with Google" / just "Google" on phones) — no layout shift between auth
  states.
- **Google is the only visible login for now.** X and LinkedIn stay wired in the auth layer
  (`signIn('twitter')` still works if called) but render no button, so nobody meets a login that
  cannot work. Re-enabling is one line in `AuthCorner` (NewGame.tsx).

### 2. Above the fold, height-aware (brief §14–§17, §52)

The fold is a *height* problem, so the values the breakpoints change live in dedicated classes in
`index.css` (`.home-hero-content`, `.home-hero-welcome`, `.home-hero-title`, `.home-hero-stats`,
`.home-world-gap`, `.home-mode-card`, `.home-card-spacer`) — deliberately not Tailwind utilities,
which would silently lose to them anyway (plain classes beat `@layer utilities`).

| | base (mobile) | ≥768px | ≥768px & ≤850px tall | ≥768px & ≤760px tall |
|---|---|---|---|---|
| hero title | clamp(31px, 8vw, 58px) | clamp(38px, 4.6vw, 58px) | clamp(34px, 4vw, 48px) | clamp(30px, 3.6vw, 42px) |
| mode card min-height | 300px | 355px | 325px | 300px |
| hero → welcome gap | 22px | 40px | 24px | 18px |
| hero → worlds gap | 22px | 28px | 20px | — |

Compression never hides: stats, descriptions, meta and cards all survive every breakpoint (§17).

**Measured at 1366×768** (the hard acceptance viewport): brand, profile, full three-line headline,
founder stats, `CHOOSE YOUR WORLD`, and **all three complete mode cards including CTAs** fit above
the fold — the daily-challenge strip peeks in below them. At 1440×900 the entire launcher fits. At
1920×1080 the composition stays at `max-w-[1440px]` and the slack goes to outer whitespace. On
mobile (375×812) the hero + 2×2 stats fill the first screen with `CHOOSE YOUR WORLD` visible and
the first card breaking the fold.

### 3. Brightness through hierarchy, not purple (brief §20–§33)

One deliberate overlay system per image, redundant darkeners removed:

- **Hero overlay**: `90deg — 0.96 → 0.84 @30% → 0.46 @56% → 0.16 @78% → 0.05` (was 0.98/0.90/0.55/0.12
  — the office is now clearly visible from the midpoint, nearly untouched at the right edge).
- **Hero crop**: `62% 48%` desktop, `68% center` mobile (was `72% center` everywhere).
- **Card overlay**: `to bottom — 0.04 → 0.18 @34% → 0.80 @62% → 0.97` (was 0.10/0.45 @30%/0.92 —
  the 45%-black band at 30% height was crushing the photographs).
- **Card images**: base `brightness(1.08)`, hover `1.16` — the photographs were shot at midnight
  and needed the half-stop (§30 allowed it).
- **Page vignette**: edge darkness 0.7 → 0.5, onset pushed out (one of the stacked darkeners, §24).
- **Borders**: launcher surfaces moved from `line` (#1f2430) to `line2` (#2a3142) at ~70% — visible
  structure, no glow. History strip surface lifted to `rgba(14,18,28,0.72)`.
- **Secondary text**: already `--color-mut` #9ba3b5, inside the brief's target range — unchanged.
- **No purple added anywhere.** The launcher aurora stays at its halved 0.45 opacity.

### 4. Mode cards (brief §38–§47)

- Copy is exactly the brief's §39–§41 (taglines "Build a unicorn tonight." / "Build the company.
  Become the CEO." / "Outbuild your friends."). Simulation's meta is now `DEEP SIMULATION ·
  MULTI-SESSION` (was "Solo / multi-session") and keeps its `Early access` badge.
- Heights per the table above (were 330/400px fixed).
- **No default selection** — all three rest neutral; highlight only on hover/focus (§45, already
  true, preserved).
- Hover: −2px translate, purple border, +8% image brightness, CTA fills purple. 180ms, honours
  `prefers-reduced-motion`.

### Deviations from the brief's letter

- §8 asks for the profile absolutely positioned *inside* the hero element; it is absolutely
  positioned over the hero from a sibling wrapper instead — same visual, but the popover escapes
  the hero's `overflow-hidden`. The brief's own caveat ("structural behaviour, not exact pixel
  values") covers this.
- §42's 340–390px desktop card target ended at 355px (325 short-laptop) because at 1366×768 the
  taller end pushed CTAs to the fold line.
- §46 continue-state highlighting is **not built** — the launcher has no active-run detection to
  read today, and the brief forbids inventing states. If a "Continue Simulation — Week 83" card
  state is wanted, it needs real save-state plumbing first (candidate for the backlog).

### Untouched (brief §2)

Authentication, profile state and menu, badges, personal bests, routing for all three modes, Daily
Challenge, saves, active-run handling, Zustand stores, localStorage, Supabase. Golden traces
byte-identical (18 assertions pass), `tsc` clean, production build clean.

## V2.1 addendum — mobile compaction (owner, 2026-08-23)

The owner overrode V2's mobile treatment: "everything more compact — the 3 choices above the
fold — we don't need the statistic above the fold in mobile." As shipped:

- **Phone mode cards are ~100px horizontal rows** (icon chip · title + tagline + meta · arrow),
  the photograph filling the row behind a left-to-right gradient. The card itself is the tap
  target — no inner CTA button spends height. The full art cards return at `md:`.
- **The founder stats strip leaves the mobile hero** and re-renders below the daily-challenge
  strip (compressed placement, not hidden — V2 §17 survives in spirit).
- **Mobile hero shrank** to ~190px: title clamp(27px, 7.2vw), 14px paddings.
- Result at 375×812: brand, hero, `CHOOSE YOUR WORLD`, **all three complete mode cards, and the
  daily challenge** sit above the fold, stats half-visible at the fold line.
- Desktop is untouched by V2.1.

## Where the code lives

- `src/screens/HomeLauncher.tsx` — hero (brand row, overlays, crops), history strip, mode cards,
  daily strip.
- `src/screens/NewGame.tsx` — launcher/briefing layout, `AuthCorner` (profile pill + Google-only
  login), hero wrapper that overlays the profile.
- `src/index.css` — `.home-*` height-breakpoint classes (search "above-the-fold discipline"),
  vignette.
- `src/assets/home/*.webp` — the four photographs (imported as modules; 136KB total).
