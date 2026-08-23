# Shared In-Game Shell — as implemented (2026-08-23)

The owner's "Shared In-Game Shell Design System" brief, as it shipped. The shell wraps every
screen AFTER Home and the launchers; those two stay outside it by design.

## Components (src/GameShell.tsx)

- `FounderMark` — the gradient F (purple→cyan), inline SVG, gradient id via `useId` (a constant
  id resolved into the hidden desktop copy of the mark and painted nothing on phones).
- `FounderModeBrand` — one lockup, two cuts: stacked (desktop rail-width brand zone) and flat
  (mobile top-bar centre).
- `UtilityButton` — the 40px raised-square utility grammar. MuteButton and FieldGuideButton now
  render through it.
- `RailItem` — desktop rail destination: icon over label, ~72px footprint, selected = raised
  tile + glow + edge indicator.
- `BottomNavItem` — the same selected language as a mobile capsule.

## Desktop (≥768px)

- **Top information bar, 64px, full width**: brand zone (104px, seam aligned with the rail) ·
  the five canonical metrics (CASH / RUNWAY / NET/WK / PMF / GROWTH — semantic colour only,
  plus `Room CODE` with the round clock in arena) · the advance verb · four utility squares
  (fit breakdown, field guide, sound, abandon).
- **The advance button lives on the top bar** — the rail is pure navigation, and the mockups
  show no advance control at all, but the game's one verb must be visible from every screen.
  Same three states as ever: green advance (Shift still fast-forwards ×5, now via tooltip),
  amber "Decide" routing to the blocking decision, accent "New company / Leave match" when the
  run is over. In arena, "Waiting…" is the cancel control (tap to un-ready).
- **Left rail, 104px**: HQ · Growth · Product · People · Capital · Market, stacked icon+label.
  One badge in the whole nav (blocking decisions, on HQ). Week date at the rail foot.
- The old 240px sidebar is deleted. What it carried moved: company identity, mode chip and
  energy to the **HQ page header** (where the mock puts them); the arena players/emotes to a
  floating card bottom-left (a 104px rail cannot hold a roster).

## Mobile (<768px)

- Top bar 52px: hamburger (nav sheet) · brand · company monogram (opens the full stats sheet).
- Metric rail: the same five metrics in equal columns; tapping PMF opens the fit breakdown,
  any other cell the stats sheet.
- Bottom nav: HQ · Growth · Product · People · Capital · Market — all six areas. There is no
  More tab (owner, same day: "a More holding exactly one destination is a door to one room");
  the hamburger sheet carries the company card and the utility row.
- The sticky contextual CTA (Advance / Decide) sits above the bottom nav, unchanged.

## Navigation re-cut (owner, same day)

- **Growth** is a top-level area now (it was the first tab of "Market") — it is the budget
  lever touched most weeks.
- **Market** now means the outside world: **Rivals first, Company story second** (the old
  single-screen Company area folded in; `BookOpen` freed). Recorded reservation: the company
  story under "Market" is a slight semantic stretch — revisit if players hunt for it.
- ScreenIds are untouched, so saves are unaffected; only AREAS / labels moved.

## The padding bug the migration surfaced

`.inset-x-safe` set `padding-left/right: env(safe-area-inset-left/right)` directly — and, as
an unlayered class, it beat every `px-*` utility on the same element. `inset-x-safe px-6`
had rendered with ZERO horizontal padding on desktop since the class was introduced. It now
composes: `padding: max(env(safe-area-inset-*), var(--px, 0px))`, with elements passing their
design padding as `[--px:16px] md:[--px:28px]`. Main content finally has the brief's §27
padding.

## Not done, deliberately

- Sidebar collapse (§23): no current architecture for it; the brief's own out-clause applies.
- Shell tokens (§42): the existing `--color-*` token system already covers every value; a
  parallel `--shell-*` set would be a second name for the same colour.
