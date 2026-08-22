# Founder Mode – Team & Employee System Brief
**For Claude Code**  
**Feature**: Realistic Employee / Hiring / Team System  
**Priority**: High  
**Version**: 1.0

---

## 1. Overview

We need a much more realistic and deep **Team & Hiring system**.

Every employee should feel like a real person with:
- Photo / avatar
- Personal history / background
- Skills
- Attributes / personality traits
- Different impact depending on company stage and type

This system should make hiring decisions meaningful and strategic.

---

## 2. Goals

- Make employees feel real and distinct
- Create meaningful trade-offs when hiring
- Make attributes and skills affect the company differently based on stage (Pre-seed → Seed → Series A+) and company type
- Keep the UI clean, modern, and game-like (fresh new-age aesthetic)
- Support both Hiring (candidates) and Team (current employees) views

---

## 3. Employee Data Model

Every employee (candidate or hired) must have:

### Core Identity
- `id`
- `name`
- `photo` (realistic modern portrait)
- `role` (e.g. Founding Engineer, Growth Lead, Product Designer, etc.)
- `location` / remote preference
- `years_of_experience`
- `previous_companies` (short history, e.g. “ex-Stripe, ex-Notion”)

### Skills (0–100 scale)
Hard skills relevant to startups. Examples:
- Technical: Coding, System Design, Architecture, DevOps, Data
- Product: Product Sense, User Research, Roadmapping, Design
- Growth: Acquisition, Retention, Experimentation, Content, Sales
- Operations: Process, Hiring, Finance, Legal awareness
- Soft: Communication, Leadership, Mentoring

### Attributes / Traits (Personality & Work Style)
These are the most important for realism and differentiation.

Suggested attributes (can be 0–100 or tiered: Low / Medium / High / Exceptional):

- **Velocity** – How fast they ship
- **Quality** – How polished and robust their work is
- **Ownership** – How much they take end-to-end responsibility
- **Adaptability** – How well they handle ambiguity and stage changes
- **Culture Fit** – How well they reinforce or shape culture
- **Burn Risk** – Likelihood of burning out or leaving
- **Cost Efficiency** – Value delivered relative to salary
- **Stage Affinity** – Which stages they perform best in (Pre-seed / Seed / Growth)

### Impact Modifiers
Each employee should have multipliers or bonuses that change based on:

**Company Stage**
- Pre-seed / Idea stage
- Seed
- Series A
- Growth / Scale

**Company Type / Focus** (examples)
- Deep Tech
- Consumer
- B2B SaaS
- Marketplace
- AI / Infrastructure
- Hard Tech

Example:
- A high-Velocity + high-Ownership engineer might be extremely strong in Pre-seed but create quality debt in later stages if Quality is low.
- A high-Culture Fit + Mentoring person becomes much more valuable at Series A when the team is scaling.

---

## 4. How Attributes Should Work (Logic)

When an employee is hired or active, their attributes should affect:

- Product velocity / shipping speed
- Product quality / bug rate / tech debt
- Hiring success rate (if they help recruit)
- Team morale / culture score
- Burn rate efficiency
- Experiment success rate
- Ability to handle chaos (early stage) vs process (later stage)

The system should support different weightings per stage.

Example logic (simplified):
- Early stage → Velocity + Ownership + Adaptability heavily weighted
- Growth stage → Quality + Mentoring + Process + Culture Fit more important

---

## 5. UI Requirements

### Hiring Page
- Grid or list of candidate cards
- Each card shows:
  - Photo
  - Name + Role
  - Short history (ex-companies)
  - Key skills (top 3–4)
  - Key attributes (with visual indicators)
  - Salary + Runway impact
  - Stage affinity indicator
  - Clear “Make Offer” / “View Profile” actions

### Team Page (Current Employees)
- Same card design as Hiring for consistency
- Additional info: current contribution, happiness/morale, time at company
- Ability to view full profile

### Full Employee Profile (Modal or dedicated view)
Should contain:
- Large photo
- Full history
- Complete skills radar or bars
- All attributes with explanations
- Impact summary (“Strong in Pre-seed, average in Growth”)
- How they currently affect the company

---

## 6. Design Direction

- Fresh, modern, new-age browser game aesthetic
- Clean dark theme
- Realistic modern photos (no fantasy, no medieval)
- Clear visual hierarchy
- Easy to compare candidates
- Satisfying and readable skill/attribute visualization

---

## 7. Implementation Notes for Claude Code

- Create a rich `Employee` type/interface
- Support both candidates and hired employees from the same model
- Make attributes and skills data-driven so they can be balanced later
- Calculate impact modifiers based on current company stage
- Build reusable `EmployeeCard` and `EmployeeProfile` components
- Keep the UI consistent with the latest fresh modern game direction
- Prioritize clarity and meaningful information density

---

**End of Brief**

Please implement the Team & Employee system according to this specification.
Focus first on the data model + Hiring page + Employee profile view.
