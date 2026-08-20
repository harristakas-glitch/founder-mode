# Founder Mode – Official UI Redesign System
**Version 1.1 | Dark Mode Only | Production Ready**
*Updated with learnings from the latest 6-panel collage*
*World-class design handoff for Claude Code / developers*

This is the **single source of truth**.
Follow every rule, color, type scale, spacing value, and Do/Don't exactly.
Do not invent new styles.

---

## 1. Project Context & Goals

**Product**: Founder Mode – turn-based startup simulator (React 19 + Tailwind CSS v4 + Zustand + Lucide React)

**Current state**: Functional but visually flat, weak hierarchy, inconsistent spacing.

**Redesign Goal**
Elevate the experience to feel like a premium modern founder tool (Linear + Notion + subtle game juice) while keeping 100% of existing mechanics, copy, and data.

**Success Criteria**
- Instant clarity and scannability
- Strong visual hierarchy (most important number visible in <1 second)
- Consistent, scalable design system
- Feels like the same game — just 10× more polished

---

## 2. Design Principles (Non-negotiable)

1. Clarity over decoration
2. Hierarchy first — the eye must land on the most important number/action in under 1 second
3. Founder energy (Purple = ambition, Green = forward momentum)
4. Breathing room with purposeful whitespace
5. Absolute consistency across every screen
6. Subtle game juice — never noise
7. **New from collage**: Global chrome (top metrics + sidebar + Advance Week) must be identical on every screen

---

## 3. Full Style Guide

### Color System

| Token                  | Hex       | Usage                              |
|------------------------|-----------|------------------------------------|
| bg-primary             | `#0A0C10` | Main app background                |
| bg-elevated            | `#11141A` | Cards, sidebar, panels             |
| bg-overlay             | `#161A22` | Modals, elevated surfaces          |
| border-subtle          | `#1F2430` | Default borders, dividers          |
| border-strong          | `#2A3142` | Focus rings, active borders        |
| text-primary           | `#F1F3F7` | Headings, primary values           |
| text-secondary         | `#9BA3B5` | Descriptions, secondary text       |
| text-tertiary          | `#6B7385` | Hints, disabled                    |
| accent-purple          | `#8B5CF6` | Primary brand, selected nav, main CTAs |
| accent-purple-hover    | `#7C3AED` | Hover states                       |
| accent-green           | `#22C55E` | Positive metrics, Advance Week     |
| accent-red             | `#EF4444` | Danger / critical                  |
| accent-amber           | `#F59E0B` | Warnings                           |
| accent-blue            | `#3B82F6` | Informational                      |

**Strict rule (from collage learning)**: Do not introduce extra accent colors (no random yellows, teals, etc.). Stick to the palette above.

### Typography

- **UI Font**: Inter (or system-ui)
- **Numbers / Metrics**: IBM Plex Mono (mandatory for every figure)

| Style         | Size  | Weight | Usage                          |
|---------------|-------|--------|--------------------------------|
| Display       | 48px  | 700    | Large runway numbers           |
| H1            | 28px  | 650    | Screen titles                  |
| H2            | 20px  | 600    | Section headers                |
| H3            | 16px  | 600    | Card titles                    |
| Body          | 14px  | 400    | Main content                   |
| Body Small    | 13px  | 400    | Secondary text                 |
| Label         | 12px  | 500    | Labels, badges                 |
| Caption       | 11px  | 400    | Timestamps, hints              |
| Mono Metric   | 14–48px | 500  | All numbers (cash, %, weeks…)  |

### Spacing (4px base unit)
`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64`

- Card padding: **20–24px** (increased from collage feedback — do not go lower)
- Section gap: 24–32px
- Sidebar width: 240px fixed
- Top metrics bar height: 56px
- Button height: 40px (default) / 36px (small) / 48px (large)

### Border Radius
- Cards & panels: `12px`
- Buttons & inputs: `8px`
- Pills / tags: `999px`

### Elevation & Effects
- Cards: `1px solid #1F2430` + subtle shadow `0 4px 24px rgba(0,0,0,0.25)`
- Optional glass: `backdrop-filter: blur(12px)`
- Focus ring: `2px solid #8B5CF6` + 2px offset

### Icons
- Library: Lucide React
- Sizes: 16px (inline), 20px (nav), 24px (feature)
- Stroke width: 1.75–2px

### Motion
- Duration: 150–200ms
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`

---

## 4. Do's and Don'ts (Updated)

### Do's
- Use purple only for primary actions and selected states
- Keep IBM Plex Mono exclusively for numbers
- Maintain **20–24px card padding** (critical from collage)
- Make the most important number (runway, cash, PMF) the largest element
- Use green exclusively for forward progress (Advance Week, positive deltas)
- Keep the left sidebar + top metrics bar + Advance Week button identical on every screen
- Give every interactive element clear hover + active states
- Prefer subtle glass + border over heavy shadows
- Make "Advance Week" the single strongest visual element wherever it appears
- Increase vertical breathing room in Hiring and Capital panels

### Don'ts
- Never use pure white (`#FFFFFF`) — always `#F1F3F7`
- Don't mix font weights randomly
- Don't make cards too dense (this was the biggest issue in the collage)
- Don't introduce extra accent colors beyond the defined palette
- Don't hide critical metrics behind hover
- Don't change the left sidebar structure or order
- Don't add decorative illustrations or heavy gradients
- Don't use border-radius larger than 12px on cards
- Don't make the green Advance button smaller or weaker than primary purple buttons
- Don't vary card internal padding or border treatments between screens

---

## 5. Key Screen Improvements (Informed by Collage)

- **HQ Dashboard**: Keep the giant runway number. It is the strongest element in the collage.
- **Discovery & Experiments**: Excellent structure — preserve the clear "Your bet" + experiment list pattern.
- **Product Build**: Color-code the three sliders (New features = purple, Polish = blue, Bugs = amber).
- **Hiring / Team**: Increase card padding and vertical gaps. Make "Make offer" buttons more prominent and consistent.
- **Capital / Raise & Finance**: Clean up density. Strengthen the visual hierarchy of the three top metric cards and the credit-line slider.
- **PMF Breakdown Analytics**: This is one of the best panels — consider making it accessible as a persistent drawer or modal from any screen.

**Global rule from collage**: Every screen must share the exact same top metrics bar, left sidebar, and Advance Week treatment.

---

## 6. Implementation Notes for Claude Code

```text
Tech stack remains exactly the same: React 19 + Tailwind CSS v4 + Zustand + Lucide React

- Create CSS variables for the entire color system
- Build reusable components: Button (primary / success / secondary / danger / ghost), MetricCard, CandidateCard, SidebarNavItem
- All numbers MUST use font-family: "IBM Plex Mono", monospace
- Sidebar is 240px fixed
- Top metrics bar is global and identical on every screen
- Card padding must be 20-24px
- Strictly follow the spacing scale and border-radius values
- Motion only 150-200ms
- No new features — pure visual & UX elevation of existing screens
- Apply extra breathing room especially to Hiring and Capital panels
```


---

## 7. Reconciliation amendments — measured constraints (owner-approved, apply ON TOP of the rules above)
*Added 2026-08-20 with the owner; retained across spec versions. The sample mockups are the tiebreaker wherever they and §3 disagree.*

1. **Surface ramp** (replaces §3's three surfaces). The spec's steps measure ΔL* ≈ 2.95 — below the
   ≥4 visibility rule the elevation rebuild was gated on. Same hue family, re-derived at the
   measured steps, four planes:
   `bg #080C10 (L*3.2) · elevated #131921 (8.5) · overlay #1D252F (14.3) · raised #27323F (20.3)`
2. **The hero figure is light purple, not white.** Per the sample HQ mock. `#FFFFFF` stays banned
   (§4); text-primary is `#F1F3F7`; the one display figure per screen renders `#A78BFA`. The
   "one bright thing" emphasis channel survives with the brand's hue.
3. **Glass on overlays only** — modals and scrims, never in-flow cards. Translucent cards over a
   varying background are what made the same card render raised at one corner and sunken at the
   other (audit §1.1).
4. **The hero slot stays dynamic** (binding constraint; runway is its default face) — the owner's
   own metrics review. The sample HQ mock happens to show runway, which is that default.
5. **Display serif** (from the sample mocks, 4 of 8 use one): screen titles and panel headers set
   in Instrument Serif 400, self-hosted latin subset. Numbers stay IBM Plex Mono; body stays
   system. Three voices, one job each.
6. **Per-sector accent theming retires.** "Absolute consistency" + purple-as-brand cannot coexist
   with a per-run accent swap. The sector personality now lives in copy and content only.
7. **No photos.** The sample Hiring mock shows headshot avatars; the game has no photo assets and
   invents no people images — the deterministic Monogram stays.
8. **Weeks, not months.** Two mocks show runway in months; the simulation's unit is weeks and
   mechanics are out of scope (§6).
