// The people model — one description of a person, read by the hiring pool and the roster alike.
//
// ---------------------------------------------------------------------------------------------
// WHY NOTHING HERE IS STORED IN THE SAVE
//
// Every attribute, portrait, title and line of background below is DERIVED from fields the save
// already holds (`name`, `role`, `skill`, `trait`). Three constraints made that the only sane
// shape, and all three are load-bearing:
//
//   1. DETERMINISM. The run is seeded and replayable, and `advanceWeek`'s draw order is pinned by
//      recorded golden traces (test/modes.test.ts). Generating attributes would mean new draws
//      from the main stream inside `makeCandidate`, which runs inside the weekly tick — so every
//      seeded run, every daily challenge and every Arena match would shift. Deriving costs ZERO
//      draws: `personSeed` hashes fields that already exist, and a private mulberry32 does the
//      rest. See test/employees.test.ts, which asserts the attribute call consumes nothing from
//      the shared RNG.
//
//   2. SAVE COMPATIBILITY. A save written before this file existed loads with full profiles,
//      because there is nothing to migrate. Not "absent means default" — absent is impossible.
//
//   3. IDENTITY. `personSeed` reads `name` and `role` ONLY, never `skill` or `salary`. Salary
//      drifts with inflation every week and skill can be bumped (the `talent-influx` event adds
//      +2), so hashing either would give a person a new face and a new personality mid-run. The
//      same person always looks and behaves the same; getting better raises their skill, not
//      their character.
//
// ---------------------------------------------------------------------------------------------
// THE CONSTANT-SUM INVARIANT — why hiring is a trade-off and not a ranking
//
// The five attributes always sum to `ATTRIBUTE_BUDGET` (250 = 5 x 50). That is not decoration; it
// is the mechanism that makes the brief's "a candidate who is simply better than another on every
// axis is a wasted card" IMPOSSIBLE rather than merely unlikely. If person A beat person B on all
// five attributes then sum(A) > sum(B), and both sums are 250. So no such pair can exist, for any
// seed, ever. test/employees.test.ts proves it over the whole name x role space.
//
// Attributes are therefore a SHAPE and `skill` is the SIZE. They are orthogonal on purpose: it is
// what lets a cheap skill-4 hire out-fit an expensive skill-8 one at your stage, and it is what
// makes "great pre-seed hire, mediocre Series A hire" a property of the person rather than a
// coincidence.
//
// ---------------------------------------------------------------------------------------------
// WHAT IS WIRED (the anti-`expansionPotential` rule)
//
// The repo has a documented history of generated data that no formula reads. Everything this
// module exposes has exactly one of two statuses, and the UI says which:
//
//   WIRED   `stageOutputMultiplier`  -> src/game/engine.ts `eff()`, the weekly output of every
//                                       employee. All five attributes feed it through STAGE_WEIGHTS.
//           `burnStressMultiplier`   -> src/game/engine.ts morale drift, the cash-crunch penalty.
//           `deskCost`               -> src/game/engine.ts `weeklyOffice`, the office bill.
//           `teamFit`                -> the hiring recommendation, computed from the three above
//                                       plus the role mix the simulation actually rewards.
//   RENDER  `title`, `yearsExperience`, `background`, `skillChips`, `homeBase` are RENDERINGS of
//           `skill`, `role`, `trait` and the attribute shape — a second way to read numbers that
//           already decide things, never a third independent fact. Nothing reads them back.

import type { Person, Role, Stage, TraitId } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---------- salary ----------
// Lives here rather than in engine.ts because "what a person of this role and skill is worth" is a
// fact about the person, and `costEfficiency` below needs it without importing the simulation.
// engine.ts re-exports both, so every existing importer is untouched.

export const ROLE_BASE: Record<Role, number> = { engineer: 62_000, designer: 55_000, marketer: 50_000, sales: 52_000 }

/**
 * What someone of this role and skill is worth on the open market, before any premium, discount or
 * noise. Exported because it is the reference point `offerAcceptChance` prices an offer against —
 * a test that wants to ask "what happens at the asking price?" must get the number from here rather
 * than transcribing `ROLE_BASE` and the `13_000` slope into itself.
 */
export function marketSalary(role: Role, skill: number): number {
  return ROLE_BASE[role] + skill * 13_000
}

// ---------- the per-person generator ----------

/**
 * A person's private, stable sub-seed. Hashes NAME and ROLE only — see the header for why skill
 * and salary are excluded. FNV-1a, the same hash the golden-trace harness uses, so there is one
 * hashing idiom in the repo rather than two.
 */
export function personSeed(p: Pick<Person, 'name' | 'role'>): number {
  const s = `${p.name}|${p.role}`
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** A private stream. Never `RNG.next()`: this must not touch the simulation's draw order. */
function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A second, independent stream off the same person, so one derived thing cannot shift another. */
const salt = (seed: number, tag: number) => stream((seed ^ Math.imul(tag, 0x9e3779b9)) >>> 0)

// ---------- attributes ----------

export type AttributeId = 'velocity' | 'quality' | 'ownership' | 'adaptability' | 'culture'
export type PersonAttributes = Record<AttributeId, number>

export const ATTRIBUTE_IDS: AttributeId[] = ['velocity', 'quality', 'ownership', 'adaptability', 'culture']

/** The five always sum to this. The whole trade-off guarantee rests on it — see the header. */
export const ATTRIBUTE_BUDGET = 250

export const ATTRIBUTE_META: Record<AttributeId, { label: string; short: string; blurb: string }> = {
  velocity: {
    label: 'Velocity',
    short: 'VEL',
    blurb: 'How fast they ship. Worth most before there is anything to break — the pre-seed weighting is nearly triple the Series C one.',
  },
  quality: {
    label: 'Craft',
    short: 'CFT',
    blurb: 'How robust the work is. Nearly worthless at pre-seed and the heaviest single term from Series A on, when what you shipped fast has to keep standing up.',
  },
  ownership: {
    label: 'Ownership',
    short: 'OWN',
    blurb: 'How much they carry end to end without being handed a spec. Matters at every stage, most when there is no process to lean on.',
  },
  adaptability: {
    label: 'Adaptability',
    short: 'ADA',
    blurb: 'How well they work through ambiguity and survive a pivot. Early-stage currency; a settled company asks for it less.',
  },
  culture: {
    label: 'Culture',
    short: 'CUL',
    blurb: 'How much they raise everyone around them. Cheap to ignore at four people, the heaviest term once you are hiring people who will never meet you.',
  },
}

/**
 * How the trait bends the shape. Applied BEFORE centring, so the constant-sum invariant survives
 * untouched: whatever a trait adds to one attribute it takes from the others.
 *
 * EVERY ROW SUMS TO ZERO. A tilt reshapes a person, it does not hand them extra points — and a row
 * that netted positive would quietly raise the population mean of whatever it touched, which shows
 * up later as a stage whose average fit is not 50 and therefore as a silent output tax or bonus on
 * the whole economy. The first cut of this table netted +0.14 to +0.36 per trait and dragged the
 * population's Culture mean nearly eight points below every other attribute.
 */
const TRAIT_TILT: Record<TraitId, Partial<Record<AttributeId, number>>> = {
  tenx: { velocity: 0.66, quality: -0.22, ownership: 0.1, adaptability: -0.16, culture: -0.38 },
  craftsman: { quality: 0.66, velocity: -0.4, adaptability: -0.26 },
  mercenary: { ownership: 0.4, adaptability: 0.2, culture: -0.6 },
  culture: { culture: 0.74, velocity: -0.4, quality: -0.34 },
  drama: { velocity: 0.5, ownership: 0.22, adaptability: -0.22, culture: -0.5 },
}

/** Working remotely is a shape, not just a desk: more self-direction, less hallway. Sums to zero. */
const REMOTE_TILT: Partial<Record<AttributeId, number>> = { ownership: 0.26, adaptability: 0.02, culture: -0.28 }

const SPREAD = 30 // how far a deviation can carry an attribute from 50 before clamping
const ATTR_FLOOR = 14
const ATTR_CEIL = 88

/**
 * The five attributes of this person. Deterministic, allocation-based, and guaranteed to sum to
 * `ATTRIBUTE_BUDGET`.
 *
 * The method: draw five deviations, apply the trait and work-style tilts, subtract the mean so the
 * deviations sum to zero, scale, then clamp — redistributing whatever the clamp took back across
 * the attributes that still have headroom, so the sum survives the clamp. Integer rounding drift
 * (at most a couple of points) is pushed onto the attribute with the most room, which keeps the
 * invariant exact rather than approximate.
 */
export function attributes(p: Pick<Person, 'name' | 'role' | 'trait'>): PersonAttributes {
  const seed = personSeed(p)
  const r = stream(seed)
  const remote = isRemote(p)

  const dev: number[] = ATTRIBUTE_IDS.map(() => r() * 2 - 1)
  const tilt = { ...(p.trait ? TRAIT_TILT[p.trait] : undefined) }
  ATTRIBUTE_IDS.forEach((id, i) => {
    dev[i] += tilt[id] ?? 0
    if (remote) dev[i] += REMOTE_TILT[id] ?? 0
  })
  const mean = dev.reduce((a, b) => a + b, 0) / dev.length
  const raw = dev.map((d) => 50 + (d - mean) * SPREAD)

  // Clamp, then hand the clamped-away points back to whoever can still take them. Four passes is
  // more than enough for five values; the residual after that is under a point.
  const out = raw.slice()
  for (let pass = 0; pass < 4; pass++) {
    let residual = 0
    for (let i = 0; i < out.length; i++) {
      const c = clamp(out[i], ATTR_FLOOR, ATTR_CEIL)
      residual += out[i] - c
      out[i] = c
    }
    if (Math.abs(residual) < 1e-9) break
    const room = out.map((v) => (residual > 0 ? ATTR_CEIL - v : v - ATTR_FLOOR))
    const total = room.reduce((a, b) => a + b, 0)
    if (total < 1e-9) break
    for (let i = 0; i < out.length; i++) out[i] += residual * (room[i] / total)
  }

  const rounded = out.map((v) => Math.round(v))
  // Rounding cannot be allowed to break the invariant the trade-off guarantee depends on.
  let drift = ATTRIBUTE_BUDGET - rounded.reduce((a, b) => a + b, 0)
  while (drift !== 0) {
    const step = drift > 0 ? 1 : -1
    // pick the attribute furthest from the wall it would be moving toward, deterministically
    let best = 0
    let bestRoom = -Infinity
    for (let i = 0; i < rounded.length; i++) {
      const room = step > 0 ? ATTR_CEIL - rounded[i] : rounded[i] - ATTR_FLOOR
      if (room > bestRoom) {
        bestRoom = room
        best = i
      }
    }
    if (bestRoom <= 0) break
    rounded[best] += step
    drift -= step
  }

  const attrs = {} as PersonAttributes
  ATTRIBUTE_IDS.forEach((id, i) => (attrs[id] = rounded[i]))
  return attrs
}

// ---------- stage affinity: the heart of the brief ----------

/**
 * What each stage is buying. Every row sums to 1, so `stageFit` has the same 0–100 range and the
 * same population mean (50) at every stage — which is what makes "this person is a 74 pre-seed and
 * a 38 Series A" a statement about the PERSON and not about the scale sliding under them.
 *
 * The shape of the table is the brief's §4 example, made numeric: early stage weights Velocity +
 * Ownership + Adaptability; growth stage weights Craft + Culture.
 *
 * THE WEIGHTS HAVE TO BE FAR FROM UNIFORM, and that is a mathematical requirement rather than a
 * taste. Attributes sum to a constant, so a weighted average with near-uniform weights is a
 * constant too: the first cut of this table gave Series A weights of (.18 .24 .20 .14 .24) and
 * every person in the game scored between 45.7 and 54.3 there — a stage affinity that could not
 * tell anyone apart. What `stageFit` actually measures is `Σ (wᵢ − 0.2)(aᵢ − 50)`, so the spread of
 * a row's weights IS the resolution of that stage's opinion. Pre-seed and Series C now disagree
 * about Velocity by a factor of nine, and about Culture by a factor of ten.
 */
export const STAGE_WEIGHTS: Record<Stage, PersonAttributes> = {
  'Pre-seed': { velocity: 0.38, quality: 0.02, ownership: 0.3, adaptability: 0.26, culture: 0.04 },
  Seed: { velocity: 0.3, quality: 0.12, ownership: 0.26, adaptability: 0.2, culture: 0.12 },
  'Series A': { velocity: 0.12, quality: 0.3, ownership: 0.18, adaptability: 0.08, culture: 0.32 },
  'Series B': { velocity: 0.06, quality: 0.34, ownership: 0.16, adaptability: 0.06, culture: 0.38 },
  'Series C': { velocity: 0.04, quality: 0.36, ownership: 0.14, adaptability: 0.04, culture: 0.42 },
}

export const ALL_STAGES: Stage[] = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C']

/** 0–100, population mean exactly 50. How well this person's shape suits this stage. */
export function stageFit(p: Pick<Person, 'name' | 'role' | 'trait'>, stage: Stage): number {
  const a = attributes(p)
  const w = STAGE_WEIGHTS[stage] ?? STAGE_WEIGHTS['Pre-seed']
  return ATTRIBUTE_IDS.reduce((sum, id) => sum + a[id] * w[id], 0)
}

/** The fit curve across the whole company lifetime — the card's five-bar strip. */
export function stageCurve(p: Pick<Person, 'name' | 'role' | 'trait'>): { stage: Stage; fit: number }[] {
  return ALL_STAGES.map((stage) => ({ stage, fit: stageFit(p, stage) }))
}

export const bestStage = (p: Pick<Person, 'name' | 'role' | 'trait'>): Stage =>
  stageCurve(p).reduce((a, b) => (b.fit > a.fit ? b : a)).stage

export const worstStage = (p: Pick<Person, 'name' | 'role' | 'trait'>): Stage =>
  stageCurve(p).reduce((a, b) => (b.fit < a.fit ? b : a)).stage

/**
 * WIRED — src/game/engine.ts `eff()`. The single seam through which attributes reach the weekly
 * simulation, and the only one.
 *
 * Deliberately bounded and mean-neutral: `stageFit` averages 50 across the population at every
 * stage, so this averages exactly 1.0 and the expected output of a randomly drawn team is
 * unchanged. What moves is the VARIANCE — hiring the right shape for your stage is worth roughly
 * ±10%, about a third of what the `10x` trait is worth, which keeps skill and traits as the
 * dominant terms and makes stage fit a tiebreaker rather than a new main axis.
 *
 * The clamp is a guard rail, not a shaping term: `stageFit` cannot leave [16, 86] because the
 * attributes cannot, so the multiplier's real range is about [0.80, 1.22].
 */
export function stageOutputMultiplier(p: Pick<Person, 'name' | 'role' | 'trait'>, stage: Stage): number {
  return clamp(0.7 + 0.006 * stageFit(p, stage), 0.75, 1.25)
}

// ---------- burn risk ----------

const BURN_TRAIT: Record<TraitId, number> = { tenx: 8, craftsman: -4, mercenary: 10, culture: -8, drama: 6 }

/**
 * 0–100. Who cracks first when the money gets tight. High velocity with nothing to absorb the
 * shock (low adaptability, low culture) is the classic burnout shape, and the traits move it the
 * way the game already says they do.
 */
export function burnRisk(p: Pick<Person, 'name' | 'role' | 'trait'>): number {
  const a = attributes(p)
  // The 47 is a measured recentring, not a taste: Culture runs ~5 points under the other
  // attributes across the population (three of the five traits corrode it, and so does working
  // remotely), so an intercept of 50 put the population mean at 52.9 — which would have made the
  // cash-crunch morale penalty 2.3% harsher for everyone than it was before this seam existed.
  // At 47 the mean lands within a tenth of 50 and the seam is genuinely neutral.
  const base =
    47 +
    0.45 * (a.velocity - 50) +
    0.3 * (50 - a.adaptability) +
    0.25 * (50 - a.culture) +
    // `?? 0`, not `BURN_TRAIT[p.trait]`: a trait string this table does not know — an older save,
    // a future trait, a hand-edited save — yielded `undefined`, and `undefined` poisons the whole
    // sum to NaN. `clamp(Math.round(NaN))` is NaN, so the person's burn risk stayed NaN forever
    // and rendered as "NaN" on the card.
    (p.trait ? (BURN_TRAIT[p.trait] ?? 0) : 0)
  return clamp(Math.round(base), 0, 100)
}

/**
 * WIRED — src/game/engine.ts morale drift. Scales ONLY the cash-crunch penalty (the flat -5/week
 * morale hit while runway is under 8 weeks), so in a healthy company this term is never reached
 * and burn risk costs nothing. Mean-neutral by construction: burn risk averages ~50, which is 1.0.
 */
export function burnStressMultiplier(p: Pick<Person, 'name' | 'role' | 'trait'>): number {
  return 0.6 + 0.008 * burnRisk(p)
}

export const burnLabel = (v: number): string => (v >= 70 ? 'High' : v >= 55 ? 'Elevated' : v >= 40 ? 'Steady' : 'Low')

// ---------- where they work ----------

/**
 * WIRED — src/game/engine.ts `weeklyOffice`. A remote hire needs no desk.
 *
 * Calibrated to be neutral, not generous: the old bill was a flat `300 + heads * 150`, and with
 * `REMOTE_SHARE` at 0.4 the new one costs `300 + onsite * 250` = `300 + heads * 150` in
 * expectation. A remote-heavy team is genuinely cheaper to seat and an all-onsite one is genuinely
 * dearer; the average company pays what it always paid. The trade-off that stops "always hire
 * remote" from being free is in `REMOTE_TILT` above — remote people are drawn with more ownership
 * and materially less culture, which is a real cost from Series A on.
 */
export const REMOTE_SHARE = 0.4
export const DESK_COST = 250

export function isRemote(p: Pick<Person, 'name' | 'role'>): boolean {
  return salt(personSeed(p), 0x5ea7)() < REMOTE_SHARE
}

export const deskCost = (p: Pick<Person, 'name' | 'role'>): number => (isRemote(p) ? 0 : DESK_COST)

const CITIES = [
  'San Francisco', 'New York', 'London', 'Berlin', 'Toronto', 'Amsterdam', 'Lisbon',
  'Singapore', 'Bangalore', 'Tel Aviv', 'Stockholm', 'Sydney', 'Austin', 'Warsaw', 'São Paulo',
]

/** RENDER — a place name for the meta line. Remote is the mechanical fact; the city is its label. */
export function homeBase(p: Pick<Person, 'name' | 'role'>): string {
  const city = CITIES[Math.floor(salt(personSeed(p), 0xc17)() * CITIES.length)]
  return isRemote(p) ? `Remote · ${city}` : city
}

// ---------- title, history, chips: renderings of skill and shape ----------

const TITLES: Record<Role, string[]> = {
  // index by skill tier: 1–2, 3–4, 5–6, 7–8, 9–10
  engineer: ['Junior Engineer', 'Software Engineer', 'Senior Engineer', 'Staff Engineer', 'Principal Engineer'],
  designer: ['Junior Designer', 'Product Designer', 'Senior Product Designer', 'Lead Product Designer', 'Head of Design'],
  marketer: ['Growth Associate', 'Growth Marketer', 'Senior Growth Marketer', 'Growth Lead', 'Head of Growth'],
  sales: ['Sales Development Rep', 'Account Executive', 'Senior Account Executive', 'Sales Lead', 'Head of Sales'],
}

const tier = (skill: number) => clamp(Math.ceil(clamp(skill, 1, 10) / 2) - 1, 0, 4)

/** RENDER — the job title IS the skill rating, spelled in the language a player already reads. */
export const title = (p: Pick<Person, 'role' | 'skill'>): string => TITLES[p.role][tier(p.skill)]

/** RENDER — years follow skill on a fixed slope, with a stable per-person offset. */
export function yearsExperience(p: Pick<Person, 'name' | 'role' | 'skill'>): number {
  const jitter = Math.floor(salt(personSeed(p), 0x7ea)() * 4)
  return Math.max(1, Math.round(1 + clamp(p.skill, 1, 10) * 1.7) + jitter - 1)
}

// Fictional, like RIVAL_NAMES in data.ts — the game does not put real companies' names in a
// procedurally generated CV, and a name pool that can be recognised is a name pool that can be
// wrong about a real employer. Tiered, so the CV reads as an encoding of skill.
const EMPLOYERS: Record<'top' | 'mid' | 'low', string[]> = {
  top: ['Northwind', 'Meridian', 'Halcyon', 'Aperture Labs', 'Lumen', 'Vector Foundry', 'Keystone', 'Atlas Systems'],
  mid: ['Tessellate', 'Blue Harbour', 'Riverstone', 'Foldwork', 'Sable & Co', 'Kestrel Digital', 'Broadleaf', 'Ninetail'],
  low: ['a two-person agency', 'a bootcamp cohort', 'a university spin-out', 'a family logistics firm', 'a failed marketplace'],
}

/** RENDER — the CV. High skill buys recognisable logos; low skill buys a story. */
export function background(p: Pick<Person, 'name' | 'role' | 'skill' | 'trait'>): { companies: string[]; bio: string } {
  const seed = personSeed(p)
  const r = salt(seed, 0xc0)
  const t = tier(p.skill)
  const pool = t >= 3 ? EMPLOYERS.top : t >= 1 ? EMPLOYERS.mid : EMPLOYERS.low
  const n = t >= 3 ? 2 : t >= 1 ? 2 : 1
  const picked: string[] = []
  const bag = [...pool]
  for (let i = 0; i < n && bag.length > 0; i++) picked.push(bag.splice(Math.floor(r() * bag.length), 1)[0])

  const a = attributes(p)
  const top = ATTRIBUTE_IDS.reduce((x, y) => (a[y] > a[x] ? y : x))
  const low = ATTRIBUTE_IDS.reduce((x, y) => (a[y] < a[x] ? y : x))
  const STRENGTH: Record<AttributeId, string[]> = {
    velocity: ['Ships first and argues later.', 'Turns a conversation into a pull request the same day.'],
    quality: ['Leaves things more solid than they found them.', 'Would rather ship late than ship a mess.'],
    ownership: ['Picks up whatever is on the floor and finishes it.', 'Takes a problem end to end without being asked twice.'],
    adaptability: ['Comfortable when nobody knows the answer yet.', 'Has survived two pivots and did not flinch at either.'],
    culture: ['Makes the people around them better.', 'The person everyone quietly goes to first.'],
  }
  const WEAKNESS: Record<AttributeId, string[]> = {
    velocity: ['Deliberate to a fault when the clock is loud.', 'Not the fastest hands on the team.'],
    quality: ['Leaves a trail to clean up behind them.', 'Polish is somebody else’s job, apparently.'],
    ownership: ['Waits to be handed the next thing.', 'Needs the scope drawn before they start.'],
    adaptability: ['Wants the spec settled before they commit.', 'Ambiguity costs them a week.'],
    culture: ['Keeps to themselves; the room does not warm up.', 'Great work, thin patience for everyone else’s.'],
  }
  const strength = STRENGTH[top][Math.floor(r() * STRENGTH[top].length)]
  const weakness = WEAKNESS[low][Math.floor(r() * WEAKNESS[low].length)]
  const cv = picked.length === 0 ? '' : t >= 1 ? `Ex-${picked.join(', ex-')}. ` : `Came up through ${picked[0]}. `
  return { companies: picked, bio: `${cv}${strength} ${weakness}` }
}

// Chips are chosen BY the attribute shape, so they are a second reading of the bars above them
// rather than a third independent fact: the first chip is always the person's top attribute in
// this role's vocabulary, and the rest fill in from the role pool.
const ROLE_CHIPS: Record<Role, Record<AttributeId, string>> = {
  engineer: {
    velocity: 'Rapid prototyping', quality: 'System design', ownership: 'On-call & ops',
    adaptability: 'Greenfield builds', culture: 'Code review & mentoring',
  },
  designer: {
    velocity: 'Fast iteration', quality: 'Design systems', ownership: 'End-to-end product',
    adaptability: 'User research', culture: 'Design critique',
  },
  marketer: {
    velocity: 'Growth experiments', quality: 'Attribution & analytics', ownership: 'Full-funnel ownership',
    adaptability: 'New channel discovery', culture: 'Brand & community',
  },
  sales: {
    velocity: 'High-volume outbound', quality: 'Discovery & qualification', ownership: 'Named accounts',
    adaptability: 'New-market landing', culture: 'Customer relationships',
  },
}

/** RENDER — three chips, ordered by the attributes they stand for. */
export function skillChips(p: Pick<Person, 'name' | 'role' | 'trait'>): string[] {
  const a = attributes(p)
  return [...ATTRIBUTE_IDS]
    .sort((x, y) => a[y] - a[x])
    .slice(0, 3)
    .map((id) => ROLE_CHIPS[p.role][id])
}

/**
 * The three attributes worth putting on a card for this role — the ones whose value actually
 * changes the decision for that job. The profile shows all five; a card that shows five numbers
 * shows none of them.
 */
/**
 * The three attributes the card puts in 21px figures — DERIVED FROM `STAGE_WEIGHTS`, never
 * hand-written, and keyed on the STAGE rather than on the role.
 *
 * It used to be a hand-maintained `Record<Role, …>` justified as "the ones whose value actually
 * changes the decision for that job". That was false, and measurably so: nothing the simulation
 * does with an attribute is role-dependent. The only path attributes take into the engine is
 * `stageOutputMultiplier`, which is a dot product against `STAGE_WEIGHTS[stage]` with no role term
 * anywhere — role decides only which bucket the resulting output is summed into.
 *
 * The consequence was a card that ranked candidates BACKWARDS. At Pre-seed the designer card showed
 * `quality` (stage weight 0.02) and hid `velocity` (0.38); ranking two designers by the three big
 * figures disagreed with the engine's own ranking on 47% of pairs at Pre-seed and 59% at Series C,
 * where `culture` is the single heaviest weight (0.42) and EVERY role's card hid it. The measured
 * worst case printed the better hire's headline number in red and the worse hire's in green.
 *
 * Deriving it makes that drift impossible by construction, and it tells the truth the brief is
 * actually about: what matters changes with the STAGE. Early you are reading velocity and
 * ownership; from Series A the card switches to culture and quality, because that is the moment
 * the simulation switches too.
 */
export function cardAttributes(stage: Stage): AttributeId[] {
  const w = STAGE_WEIGHTS[stage] ?? STAGE_WEIGHTS['Pre-seed']
  // ties break on ATTRIBUTE_IDS order, so the result is stable for a given weight table
  return [...ATTRIBUTE_IDS].sort((a, b) => w[b] - w[a]).slice(0, 3)
}

export const ROLE_LABEL: Record<Role, string> = {
  engineer: 'Engineering',
  designer: 'Product',
  marketer: 'Growth',
  sales: 'Revenue',
}

export const ROLE_HELP: Record<Role, string> = {
  engineer: 'Builds features, raises quality, burns down bugs',
  designer: 'Raises product quality — and counts triple on customer research',
  marketer: 'Turns marketing spend into hype and reach',
  sales: 'Lifts revenue per customer',
}

// ---------- team shape ----------

/**
 * The role mix each stage rewards, as a share of headcount.
 *
 * Not invented: it is the simulation's own emphasis, written down. `engPoints` drives features,
 * quality and bugs, which is why engineers dominate early; `researchHeads` in career/tick.ts
 * counts a designer TRIPLE for experiment reliability; `salesPoints` scales revenue per customer,
 * which only matters once there are customers to scale. One table, two readers — the card's gap
 * term and the roster panel's checklist — so they can never disagree.
 */
export const TARGET_MIX: Record<Stage, Record<Role, number>> = {
  'Pre-seed': { engineer: 0.6, designer: 0.15, marketer: 0.15, sales: 0.1 },
  Seed: { engineer: 0.55, designer: 0.15, marketer: 0.18, sales: 0.12 },
  'Series A': { engineer: 0.45, designer: 0.18, marketer: 0.2, sales: 0.17 },
  'Series B': { engineer: 0.4, designer: 0.18, marketer: 0.2, sales: 0.22 },
  'Series C': { engineer: 0.38, designer: 0.18, marketer: 0.2, sales: 0.24 },
}

export interface TeamContext {
  stage: Stage
  roles: Role[]
}

/**
 * 0–100. How badly this stage's team wants one more of this role. 50 is "you have exactly the
 * share this stage wants"; an empty team wants an engineer at 100 and a salesperson at 70.
 */
export function roleGap(role: Role, ctx: TeamContext): number {
  const target = (TARGET_MIX[ctx.stage] ?? TARGET_MIX['Pre-seed'])[role]
  const n = ctx.roles.length
  const actual = n === 0 ? 0 : ctx.roles.filter((r) => r === role).length / n
  return clamp(50 + (target - actual) * 200, 0, 100)
}

/**
 * WIRED — the one number that makes a grid of candidates scannable, and every term in it is
 * something the simulation does:
 *
 *   50%  stage fit          — `stageOutputMultiplier`, this person's weekly output right now
 *   30%  role gap           — the mix the engine's own output terms reward at this stage
 *   20%  culture            — heaviest stage weight late, and the thing a roster of one cannot buy
 *
 * It is a RECOMMENDATION, not a hidden stat: everything in it is printed on the same card.
 */
export function teamFit(p: Pick<Person, 'name' | 'role' | 'trait'>, ctx: TeamContext): number {
  const a = attributes(p)
  return Math.round(0.5 * stageFit(p, ctx.stage) + 0.3 * roleGap(p.role, ctx) + 0.2 * a.culture)
}

export const fitTone = (v: number): 'good' | 'warn' | 'bad' => (v >= 62 ? 'good' : v >= 46 ? 'warn' : 'bad')

export const fitLabel = (v: number): string =>
  v >= 75 ? 'Ideal for this stage' : v >= 62 ? 'Strong fit' : v >= 46 ? 'Workable' : v >= 34 ? 'Off-stage' : 'Wrong hire, right person'

// ---------- what they cost ----------

/**
 * Output per $100k of salary, at the current stage — the brief's "cost efficiency", computed from
 * the same terms `eff()` uses (skill x trait x stage fit) rather than asserted.
 *
 * The morale and coordination factors are deliberately absent: both are properties of the COMPANY
 * on the week you look, not of the person, and folding them in would make the same candidate read
 * differently depending on how the rest of the roster felt that morning.
 */
export function outputPoints(p: Pick<Person, 'name' | 'role' | 'skill' | 'trait'>, stage: Stage): number {
  const traitMult = p.trait === 'tenx' ? 1.7 : p.trait === 'mercenary' ? 1.15 : p.trait === 'craftsman' ? 1.1 : 1
  return clamp(p.skill, 1, 10) * traitMult * stageOutputMultiplier(p, stage)
}

/** >1 means they deliver more per dollar than a plain peer of the same role and skill costs. */
export function valueRatio(p: Pick<Person, 'name' | 'role' | 'skill' | 'trait' | 'salary'>, stage: Stage): number {
  const market = marketSalary(p.role, clamp(p.skill, 1, 10))
  const par = clamp(p.skill, 1, 10) / market
  const theirs = outputPoints(p, stage) / Math.max(1, p.salary)
  return theirs / par
}

export const valueLabel = (r: number): string =>
  r >= 1.18 ? 'Bargain' : r >= 1.04 ? 'Good value' : r >= 0.94 ? 'Market rate' : r >= 0.82 ? 'Pricey' : 'Overpriced'

/**
 * The profile's "how they affect the company" line — the impact summary the brief asks for, built
 * from the two wired multipliers so it can never drift away from what the engine does.
 */
export function impactSummary(p: Pick<Person, 'name' | 'role' | 'trait'>, stage: Stage): string {
  const mult = stageOutputMultiplier(p, stage)
  const pctText = `${mult >= 1 ? '+' : ''}${Math.round((mult - 1) * 100)}%`
  const best = bestStage(p)
  const worst = worstStage(p)
  const here = mult >= 1.06 ? 'well suited to' : mult >= 0.98 ? 'about par for' : 'a poor match for'
  return (
    `Output ${pctText} against a like-for-like peer at ${stage} — ${here} where the company is now. ` +
    `Peaks at ${best}, weakest at ${worst}.`
  )
}
