# UI audit — August 2026

> "our UI overall is not top class, not even average, it's boring and old school… we should be
> more sleek and fresh and clean."
> — the owner, on the current build

The owner is right, and this document is an attempt to say *why* precisely enough that the fix is
obvious. Five principles were given: **easiness, fresh, ux friendly, clean, sleek**. Every finding
below names the file, the line, and the number that makes it checkable. Nothing here is a matter of
taste that could not be settled by opening the file.

Companion: `docs/ui-proposals-2026-08.html` — three rendered design directions, side
by side with the current look. That page is the decision; this document is the diagnosis.

---

## 0. How the measurements were taken

Two numbers are used throughout, and they are not interchangeable.

**WCAG contrast ratio** `(L₁+0.05)/(L₂+0.05)`. Correct for text legibility. **Useless for judging
whether two dark surfaces look different**, because at near-black luminances the `+0.05` flare term
dominates: `--color-bg` (#0a0e18, Y=0.0044) against `--color-surface` (#121a2c, Y=0.0105) scores
1.111:1, and so would any other pair down there. WCAG 1.4.11's 3:1 non-text bar is literally
unreachable for a hairline on a near-black card without making the hairline mid-grey.

**CIE L\*** — perceptual lightness, 0–100. This is the honest metric for a dark-UI elevation ramp.
Rule of thumb used below: **ΔL\* ≥ 4 between adjacent planes** is a step a player can see on a
laptop screen in a lit room; ΔL\* ≤ 2 is not a step, it is a rounding error.

All composited values (`bg-surface/80`, `bg-warn/[0.06]`, `rgba(0,0,0,0.5)` shadows) were alpha-
blended against what is actually behind them before being measured, because that is what the player
sees.

---

## 1. The five most damning findings

### 1.1 The elevation ramp inverts across the viewport

`src/components.tsx:97` defines the single card recipe for the whole game:

```
const CARD = 'rounded-2xl border border-line/70 bg-surface/80 shadow-[var(--elev-2)] ring-1 ring-inset ring-white/[0.03]'
```

`src/index.css:113` puts a **fixed** radial gradient behind everything:

```css
background: radial-gradient(1400px 700px at 70% -20%, #16203b 0%, var(--color-bg) 55%);
background-attachment: fixed;
```

`bg-surface/80` is 80% opaque, so every card is tinted by whatever the gradient is doing behind it.
Measured:

| where on screen | page behind | card composites to | ΔL\* |
|---|---|---|---|
| bottom-left (gradient exhausted, `--color-bg`) | `#0a0e18`, L\*=4.02 | `#101828`, L\*=8.28 | **+4.26** |
| top-right (gradient at 0%, `#16203b`) | `#16203b`, L\*=12.73 | `#131b2f`, L\*=10.01 | **−2.72** |

**The same `<Panel>` is a raised card at the bottom of the page and a recessed hole at the top-right
of it.** The gradient is `fixed`, so this does not even move with the content: scroll, and a card
changes from raised to sunken as it crosses the viewport.

The shadow does not save it. `--elev-2` is `0 2px 8px -2px rgba(0,0,0,0.5)` — pure black, on a page
that is already L\*=4.02. Its darkest possible pixel composites to `#05070c`, L\*=1.90: **ΔL\* =
−2.12 from the page.** `--elev-3` (60% black) reaches ΔL\*=−2.41. There is, functionally, no shadow
anywhere in this product. Black shadows do not work on near-black backgrounds; that is a physics
problem, not a taste problem.

And the `ring-1 ring-inset ring-white/[0.03]` is described in the comment above it as "a 1px inner
highlight along the top edge". `ring` draws all four sides. The code does not do what its own
comment says.

**Consequence:** the game has one visual plane. Everything the player looks at — page, card, nested
box, modal — sits at the same apparent depth. That is the single largest contributor to "flat and
old school", and it is why adding more cards has been making it worse rather than better.

Checkable: `src/components.tsx:97`, `src/index.css:37–39`, `src/index.css:113`.

---

### 1.2 There is no type scale — there are twenty-four sizes, and effectively two

Counted across `src/`:

- 19 distinct `text-[Npx]` values
- 5 distinct named Tailwind sizes (`text-xs`, `sm`, `lg`, `3xl`, `4xl`)

**24 type sizes.** For comparison, Linear ships 7; Things 3 ships 6.

Worse, they are not distributed as a hierarchy. The top two account for 63% of all sized text:

```
143  text-[13px]
107  text-[11px]
 47  text-[12px]
 39  text-[12.5px]
 29  text-[10px]
 23  text-[11.5px]
 14  text-[10.5px]
  8  text-[13.5px]
  ...
```

So the working scale is **11px and 13px**, and the remaining 22 sizes are noise around them:
`text-[12.5px]`, `text-[11.5px]`, `text-[10.5px]`, `text-[13.5px]`, `text-[15.5px]`,
`text-[16.5px]`, `text-[9.5px]`. Nobody can perceive a half-pixel step as a level of hierarchy —
these are not decisions, they are nudges that got committed.

Because size cannot carry hierarchy across a 2px range, **weight and capitals** are carrying it
instead. Weight declarations across `src/`:

```
111  font-bold
 71  font-semibold
 48  font-extrabold
  2  font-normal
```

232 weight declarations; **two** of them are normal. There is no light end to this axis. Combined
with 43 `uppercase` labels and 12 distinct `tracking-` values (including `tracking-[0.3em]`,
`[0.35em]`, `[0.28em]`, `[0.16em]`, `[0.14em]`, `[0.09em]`, `[0.08em]`, `[0.06em]`), the result is a
UI where everything is shouting, which means nothing is loud. That texture — small, bold,
letterspaced, all-caps grey micro-labels stacked on top of dense figures — *is* the 2011 enterprise
dashboard look the owner is reacting to.

Checkable: `grep -rhoE "text-\[[0-9.]+px\]" src | sort | uniq -c | sort -rn`

---

### 1.3 Grey is the default text colour, and section titles are 11px shouting grey

```
460  text-mut
113  text-ink
```

**Four fifths of the explicitly-coloured text in the game is `--color-mut` (#8593ab).** That is
5.59:1 on a card — it passes AA, and it still reads as *disabled*. A page where the majority of the
type is secondary has no figure/ground: the eye lands nowhere, finds no primary, and moves on. This
is the mechanical reason the screens read as "boring" even though the writing on them is good.

It is compounded by `Panel` (`src/components.tsx:99–111`), which forces **every** section title in
the game through one micro-label style:

```
text-[11px] font-bold uppercase tracking-[0.1em] text-mut
```

That style is correct for a 6-character label. Actual titles being pushed through it include:

- `"Cohort triangle — % of each group still here, N weeks after joining"` — **69 characters**
- `"Governance — the community votes, and the votes bind"` — 54
- `"Community capital — this company is a token network"` — 53
- `"The network ending — what this path is playing for"` — 52

At 11px with 0.1em tracking, a 69-character all-caps line is ~490px wide and wraps to two lines
inside a half-width panel. It is a sentence being screamed in grey. The `Panel` API has exactly one
slot, so a writer with a title *and* a subtitle has no choice but to jam both into it with an em
dash — which is why 30 of ~56 panel titles contain " — ".

Checkable: `src/components.tsx:104`; `grep -rhoE 'Panel title="[^"]*"' src`

---

### 1.4 The Dashboard is sixteen identical rectangles with no rhythm

In Quick Play the Dashboard (`src/screens/Dashboard.tsx:257–379`) renders, top to bottom:

1–3. `AttentionStrip` — up to three `rounded-2xl border` boxes
4. `WeekDigest` — one `rounded-xl border` box
5–8. four `StatCard`s
9–10. two chart `Panel`s
11–13. three more `StatCard`s
14. `Benchmarks` `Panel` (six `BenchRow`s inside it)
15–16. `Milestones` and `Latest news` `Panel`s

**Sixteen bordered rectangles.** In Career, `FounderBriefing`, `PmfExplainer`, `TeamOpinions`,
`Commitments` and `BoardMeeting` all become non-null (`src/CareerUI.tsx:516, 672, …`) and it goes
past twenty.

Every one of them is the same width band, the same radius, the same near-invisible fill, the same
1px hairline — and they are separated by the same gap, forever:

```
62  mt-3
59  mt-3.5
43  mt-2.5
36  mt-2
33  mt-1
22  mt-1.5
```

`mt-3` is 12px and `mt-3.5` is 14px. Those two are used 121 times between them, essentially
interchangeably, and a 2px difference is not a rhythm — it is jitter. There is no spacing that says
"new section" and none that says "these three belong together". The page is a uniform grey ladder.

Related: **there are at least 25 distinct card recipes for one concept.** `components.tsx` defines
`CARD`, and then screens hand-roll variants anyway:

```
 7  rounded-xl  border border-line   bg-surface2
 4  rounded-xl  border border-line   bg-surface2/50
 3  rounded-xl  border border-line   bg-surface2/60
 3  rounded-lg  border border-line/60 bg-surface2/40
 2  rounded-2xl border border-line/70 bg-surface/60
 2  rounded-2xl border border-line/70 bg-surface/50
 …
```

109 `border border-*` declarations total, across five radii (`rounded`, `-md`, `-lg`, `-xl`,
`-2xl`, `-3xl` = six, plus `rounded-[3px]` and `rounded-[5px]`). And they nest:
`src/screens/Fundraising.tsx` has 15 `<Panel>`s and five `rounded-xl border border-line bg-surface2`
boxes *inside* them. Box-in-box, at 1px hairlines that are 1.22:1 against their own fill.

Checkable: `grep -rho "border border-" src | wc -l` → 109; `grep -c "<Panel" src/screens/Fundraising.tsx` → 15.

---

### 1.5 The urgency signals are below threshold — and internal notes have shipped to screen

The Inbox is where the week is blocked. `src/screens/Inbox.tsx:47–52` distinguishes a decision that
is blocking the week from one already handled:

```
needsYou ? 'bg-warn/[0.06]' : 'bg-surface/70'
```

with the comment *"an item that needs you is lit; everything already handled recedes."* Measured
against the page:

| state | composites to | L\* |
|---|---|---|
| blocking (`bg-warn/[0.06]`) | `#181919` | 8.65 |
| handled (`bg-surface/70`) | `#101626` | 7.44 |

**ΔL\* = 1.21.** That is at or below the just-noticeable difference for large flat areas. The fill
carries no information; the whole signal is riding on a 3px left border. The comment describes an
intent the pixels do not deliver.

Same story on the Dashboard's `AttentionStrip` (`src/screens/Dashboard.tsx:211–228`) — the three
urgency tones composite to L\* 8.43 (bad), 10.27 (warn), 7.45 (good). The *tone* of the most
important strip in the game is conveyed by a 6px dot and a border tint.

And then, on the same screens:

- **`src/screens/Fundraising.tsx:333`** — `<Panel title="Your own position — §42">`. A section
  number from an internal design brief, rendered to the player, in all-caps, as
  `YOUR OWN POSITION — §42`.
- Panel titles carry raw emoji: `"⚔️ Competitive response"`, `"⚔️ Dirty tricks — hit the other
  founders"`. Emoji render as platform-specific, full-colour, non-scalable glyphs. Dropping a
  colour cartoon into an 11px letterspaced grey label inside an otherwise monochrome dark UI is the
  loudest single "amateur" tell in the build.
- The game runs **two icon systems at once**: 22 `lucide-react` icons imported in `App.tsx` alone,
  and an emoji vocabulary for everything content-side — 🦄 🔔 🤝 ⏱ 🪑 💸 🕸 👑 ☠️ 🚪 ◻ ✓ ⚠ ▲ ▼.
  `MILESTONES` renders `◻` as its checkbox (`Dashboard.tsx:352`).

Checkable: `src/screens/Fundraising.tsx:333`, `src/screens/Inbox.tsx:47`, `src/screens/Dashboard.tsx:211`.

---

## 2. Secondary findings, all real

**2.1 Motion is declared but not spent.** `src/index.css:21–33` defines a genuinely good motion
vocabulary — three durations, one easing, "nothing over 260ms". In practice it is applied almost
exclusively to `hover` colour transitions. The only entrance in the whole app is
`<div key={screen} className="rise-in">` (`App.tsx`), which animates all sixteen Dashboard boxes as
**one block**. Nothing has choreography, so a screen change reads as a jump-cut with a fade rather
than as content arriving.

**2.2 Fourteen numbers count up simultaneously.** `Ticker` (`components.tsx:42`) runs a 500ms
count-up on every value change. The desktop stat rail wraps seven of them (Cash, Rev/wk, Burn/wk,
Net/wk, Users, PMF, Valuation) and the Dashboard's `StatCard`s wrap seven more. On Advance Week,
fourteen numbers animate at once. Motion that happens everywhere communicates nothing; the player
cannot tell which number *mattered*.

**2.3 Prose is doing design's job.** 92 `leading-relaxed` blocks across `src/`; `Fundraising.tsx`
alone has 27. `Growth.tsx:57–70` puts ~150 words of explanation under one slider, all at
`text-xs`/`text-[13px]` in `text-mut`. The writing is genuinely good — that is exactly why it
deserves a reading size and a rhythm instead of being set as fine print.

**2.4 The layout has one breakpoint.** 49 `md:`, 32 `sm:`, 7 `lg:`, 6 `xl:`. `grid-cols-2` appears
33 times against 11 uses of `grid-cols-4`. A 27" display renders the same two-up layout as a 13"
laptop for nearly every panel, with a hard `max-w-[820px]` on Inbox and no max width anywhere else —
so on a wide monitor the Dashboard's `BenchRow` labels sit 1400px from their values.

**2.5 The chart colour is the darkest thing in the palette.** `--color-chart: #6172f3` is 4.31:1 on
a card and is stroked at `strokeWidth="1.6"` with `vectorEffect="non-scaling-stroke"`
(`components.tsx:478`). A 1.6px line at 4.31:1 is the least visible element on the busiest screens.
Gridlines are `rgba(220,229,245,0.07)` — ΔL\* ≈ 2 from the plot area.

**2.6 What is already right, and must survive any redesign.** Not everything here is broken, and a
redesign that throws these away is a regression:

- The focus ring (`index.css:146`): 2px accent + 2px offset, one rule, everywhere. Keep verbatim.
- `prefers-reduced-motion` is handled twice over (`index.css:559`, `572`) and `Ticker` opts out of
  count-up. Keep.
- Status colour never travels alone — `TrendBadge` ships ▲/▼, `StatCard` prefixes the delta,
  `SkillRing` prints the number inside the ring. This is genuinely good practice.
- The mobile pass (`MOBILE_TABS`, `nav[aria-label="Sections"]`, `pad-bottom-safe`, `dvh`,
  16px inputs, `overscroll-behavior: none`) is correct and recent. **Every direction below builds
  on it and none contradicts it**: four tabs + More, the contextual action bar above the tab bar,
  and the safe-area utilities all stay exactly as they are.
- The per-sector accent rebinding (`theme.ts`, `App.tsx` `useEffect` on `game.sector`) is a real
  identity idea. All three directions keep it.

---

## 3. The diagnosis in one paragraph

The game does not have a *bad* design system; it has a design system that **collapsed into a single
plane and a single type size**. Four surface tokens that differ by ΔL\* 2–4 and are then blended at
80% over a fixed gradient that undoes the ordering; black shadows on a black page; 24 type sizes of
which two do 63% of the work; 232 weight declarations of which two are normal; four fifths of the
text set in the secondary grey; and sixteen identical rectangles per screen separated by an
undifferentiated 12–14px. Every one of those is a *flattening*. Stack them and you get exactly what
the owner described: dense, competent, legible, and completely without hierarchy — which reads as
old, because 2011 enterprise dashboards looked like this for the same reason.

The fix is not "add whitespace" or "use a nicer blue". It is to pick **one** thing that carries
hierarchy — typography, elevation, or disclosure — and commit to it hard enough that the other two
can be quiet. That is the choice the three directions in `ui-proposals.html` put in front of the
owner.

---

## 4. The three directions, in one line each

Full specs and rendered mockups are in `ui-proposals.html`. Summary only:

| | **A — Ledger** | **B — Cockpit** | **C — Briefing** |
|---|---|---|---|
| **Thesis** | Delete the boxes. In a game about numbers, the container is noise — structure comes from type, alignment and one hairline. | Keep the cards, but make elevation *real*: three planes you can actually see, one hero number per screen, everything else pushed back. | The screen is a weekly briefing, not a dashboard: one question at the top, everything else folded until asked for. |
| **Carries hierarchy with** | Typography | Elevation | Disclosure |
| **Type steps** | 7 (11/12/14/16/20/28/44) | 7 (11/13/15/18/24/34/56) | 6 (12/14/16/20/26/40) + a 15px reading size |
| **Surfaces** | 2 planes | 4 planes, ΔL\* ≈ 5–6 each | 3 planes |
| **Boxes on Dashboard** | 0 | 9 | 6 (1 open + 5 folded) |
| **Radius** | 6px | 14px | 18px |
| **Density** | Highest | High | Lowest visible / highest available |
| **Strongest on** | clean, sleek | fresh, sleek | easiness, ux friendly |
| **Biggest risk** | reads austere if the type is not right | four planes need discipline or it becomes soup again | hiding numbers in a sim annoys expert players |

All three are expressible as a rewrite of the `@theme` block in `src/index.css` plus a rewrite of
`CARD`/`Panel`/`StatCard` in `src/components.tsx`. A and B need no changes to screen structure at
all. C needs one new `<Section>` component and a reordering of `Dashboard.tsx`.

---

## 5. What must be true of whichever direction wins

Non-negotiables, carried over from this audit:

1. **Adjacent planes differ by ΔL\* ≥ 4.** Measured after alpha compositing, against whatever is
   actually behind them. If a surface is semi-transparent over a gradient, the ordering must hold at
   *both* ends of that gradient — or the gradient goes.
2. **No pure-black shadows as the primary depth cue on dark.** Depth comes from the plane step; a
   shadow is a 20% assist and a top inner highlight is worth more than a drop shadow.
3. **One type scale, ≤ 8 steps, no fractional pixels.** Every `text-[12.5px]` in the codebase is
   deleted, not migrated.
4. **A normal weight exists and is the default for prose.** Bold becomes a signal again only once
   it is rare.
5. **Ink is the default text colour; grey is the exception.** The current 460:113 ratio inverts.
6. **Contrast holds:** body ≥ 4.5:1, large/secondary ≥ 4.5:1 (this game's "secondary" is 12–13px and
   therefore not large text — 3:1 does not apply), interactive borders as high as the palette can
   carry with a plane step behind them so the boundary never depends on the hairline alone.
7. **The mobile shell is untouched.** Bottom tab bar, More sheet, contextual action bar, safe-area
   utilities, `dvh`, 16px inputs, haptics.
8. **`prefers-reduced-motion`, the focus ring, and never-colour-alone survive verbatim.**
9. **It is tested against Fundraising, not Dashboard.** 15 panels, 5 nested boxes, sliders, tables
   and 27 prose blocks. A direction that looks beautiful with four widgets and dies at forty is not
   a direction.

---

## 6. Cleanups worth doing regardless of which direction wins

These are bugs, not taste, and they are cheap:

- `src/screens/Fundraising.tsx:333` — `title="Your own position — §42"`. Remove `— §42`.
- `src/components.tsx:97` — the `ring-1 ring-inset ring-white/[0.03]` comment claims a top-edge
  highlight; it draws four sides. Either make it `shadow-[inset_0_1px_0_…]` or fix the comment.
- `src/index.css:559` and `:572` — the `prefers-reduced-motion` block is duplicated; the second is a
  superset of the first.
- `src/index.css:113` — `background-attachment: fixed` on the body gradient is what makes the card
  inversion scroll-dependent. Even if the gradient stays, this should not.
- Emoji in `Panel title` (`"⚔️ Competitive response"`, `"⚔️ Dirty tricks…"`) — move to a lucide icon
  in the `action` slot, or drop.
- 24 type sizes → the winning direction's scale. This is a mechanical find-and-replace and it is the
  single highest-leverage change in the list.
