// The people model — attributes, stage affinity, and the three seams into the simulation.
// Run: npx tsx test/employees.test.ts
//
// Three properties are load-bearing and each has a whole section here:
//
//   1. DETERMINISM WITHOUT DRAWS. Nothing in src/game/people.ts may touch the shared `RNG`. If it
//      did, `makeCandidate` (which runs inside the weekly tick) would shift the draw order and
//      every seeded run, daily challenge, Arena match and replay would change — silently, because
//      the golden traces in test/modes.test.ts would move together with everything else.
//   2. THE CONSTANT SUM. Attributes always total 250, which is what makes "no candidate is simply
//      better than another on every axis" a proof rather than a hope.
//   3. MEAN-NEUTRAL SEAMS. Each of the three multipliers the engine reads averages 1.0 across the
//      population, so adding the system did not silently buy or tax the whole economy.

import { advanceWeek, marketSalary, newGame, weeklyOffice, ROLE_BASE } from '../src/game/engine'
import { RNG } from '../src/game/data'
import {
  ALL_STAGES,
  ATTRIBUTE_BUDGET,
  ATTRIBUTE_IDS,
  CARD_ATTRIBUTES,
  STAGE_WEIGHTS,
  TARGET_MIX,
  attributes,
  background,
  bestStage,
  burnRisk,
  burnStressMultiplier,
  deskCost,
  isRemote,
  marketSalary as peopleMarketSalary,
  outputPoints,
  personSeed,
  roleGap,
  skillChips,
  stageCurve,
  stageFit,
  stageOutputMultiplier,
  teamFit,
  title,
  valueRatio,
  yearsExperience,
  DESK_COST,
  REMOTE_SHARE,
} from '../src/game/people'
import type { Employee, GameState, Role, Stage, TraitId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

// The real name pools from src/game/data.ts — this suite must measure the population the game
// actually generates, not a population invented here.
const FIRST = [
  'Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Avery', 'Quinn', 'Dana', 'Jamie',
  'Elena', 'Marcus', 'Priya', 'Kenji', 'Sofia', 'Omar', 'Ingrid', 'Diego', 'Wei', 'Amara',
  'Lucas', 'Noor', 'Felix', 'Zara', 'Ivan', 'Maya', 'Tomas', 'Leila', 'Hugo', 'Nina',
]
const LAST = [
  'Chen', 'Patel', 'Kim', 'Novak', 'Garcia', 'Okafor', 'Larsson', 'Tanaka', 'Silva', 'Haddad',
  'Kowalski', 'Moreau', 'Ferrari', 'Ivanov', 'Nakamura', 'Andersson', 'Costa', 'Weber', 'Ali', 'Brooks',
  'Fischer', 'Santos', 'Nguyen', 'Petrov', 'Lindqvist', 'Duarte', 'Kaur', 'Yamamoto', 'Berg', 'Osei',
]
const ROLES: Role[] = ['engineer', 'designer', 'marketer', 'sales']
// `rollTrait` gives roughly a 10% chance of each ordinary trait and the rest none; `tenx` is rarer
// still (skill >= 8 and a 20% roll on top). One `tenx` in eleven is deliberately generous to it.
const TRAIT_MIX: (TraitId | null)[] = [null, null, null, null, null, null, 'craftsman', 'mercenary', 'culture', 'drama', 'tenx']

interface P { name: string; role: Role; skill: number; salary: number; trait: TraitId | null }
const person = (name: string, role: Role, skill = 5, trait: TraitId | null = null): P => ({
  name,
  role,
  skill,
  salary: marketSalary(role, skill),
  trait,
})

const POP: P[] = []
for (const f of FIRST) for (const l of LAST) for (const r of ROLES) for (const t of TRAIT_MIX) POP.push(person(`${f} ${l}`, r, 5, t))

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

console.log('— The generator draws nothing from the simulation’s RNG —')
{
  // The whole determinism story rests on this. Count every call to the shared generator while the
  // people model does its heaviest work; the answer has to be zero.
  const real = RNG.next
  let calls = 0
  RNG.next = () => {
    calls++
    return real()
  }
  try {
    for (const p of POP.slice(0, 500)) {
      attributes(p)
      stageFit(p, 'Seed')
      burnRisk(p)
      isRemote(p)
      background(p)
      skillChips(p)
      yearsExperience(p)
      title(p)
    }
  } finally {
    RNG.next = real
  }
  ok(calls === 0, `500 full profiles consumed ${calls} draws from the shared RNG — it must be 0 or the weekly tick shifts`)
}

console.log('\n— The same person is the same person —')
{
  const a = person('Priya Chen', 'engineer', 4)
  const b = person('Priya Chen', 'engineer', 4)
  ok(JSON.stringify(attributes(a)) === JSON.stringify(attributes(b)), 'identical input gives identical attributes')
  // `talent-influx` bumps a candidate's skill by 2 and inflation rewrites salary every week. Both
  // must leave the person's face and personality alone.
  const promoted = { ...a, skill: 9, salary: a.salary * 3 }
  ok(personSeed(a) === personSeed(promoted), 'a skill bump and a salary rise do not change who someone is')
  ok(JSON.stringify(attributes(a)) === JSON.stringify(attributes(promoted)), '...so their attribute shape survives it too')
  ok(isRemote(a) === isRemote(promoted), '...and so does where they work')
  ok(personSeed(a) !== personSeed(person('Priya Chen', 'designer', 4)), 'the same name in a different role is a different person')
  ok(personSeed(a) !== personSeed(person('Priya Weber', 'engineer', 4)), 'a different name is a different person')
  const shapes = new Set(POP.filter((p) => p.trait === null).map((p) => JSON.stringify(attributes(p))))
  ok(shapes.size > 2000, `the untraited population holds ${shapes.size} distinct shapes — nobody is looking at five archetypes`)
}

console.log('\n— The constant sum, and the trade-off it guarantees —')
{
  const sums = POP.map((p) => ATTRIBUTE_IDS.reduce((a, id) => a + attributes(p)[id], 0))
  ok(sums.every((s) => s === ATTRIBUTE_BUDGET), `all ${POP.length} people total exactly ${ATTRIBUTE_BUDGET}`)
  // `Math.min(...xs)` blows the call stack on a 198,000-element spread, so fold instead.
  let lo = Infinity
  let hi = -Infinity
  for (const p of POP) for (const id of ATTRIBUTE_IDS) {
    const v = attributes(p)[id]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  ok(lo >= 10 && hi <= 92, `every attribute stays inside a sane band (${lo}–${hi})`)
  ok(hi - lo > 50, 'and the band is actually used — a flat population would say nothing')

  // The brief: "a candidate who is simply better than another on every axis is a wasted card".
  // With a constant sum such a pair CANNOT exist. This checks the implementation honours the maths.
  const sample = POP.filter((_, i) => i % 53 === 0).slice(0, 300).map((p) => attributes(p))
  let dominated = 0
  for (let i = 0; i < sample.length; i++)
    for (let j = 0; j < sample.length; j++)
      if (i !== j && ATTRIBUTE_IDS.every((k) => sample[i][k] > sample[j][k])) dominated++
  ok(dominated === 0, `no person in a ${sample.length}-strong sample beats another on all five axes — every card is a trade-off`)
}

console.log('\n— Stage affinity: the same person, a different company —')
{
  for (const stage of ALL_STAGES) {
    const w = STAGE_WEIGHTS[stage]
    const total = ATTRIBUTE_IDS.reduce((a, id) => a + w[id], 0)
    ok(Math.abs(total - 1) < 1e-9, `${stage} weights sum to 1 (${total.toFixed(4)}) — every stage scores on the same scale`)
  }
  const m = ALL_STAGES.map((s) => mean(POP.map((p) => stageFit(p, s))))
  ok(m.every((v) => Math.abs(v - 50) < 3), `population mean fit is ~50 at every stage (${m.map((v) => v.toFixed(1)).join(', ')})`)

  const swings = POP.map((p) => {
    const c = stageCurve(p).map((x) => x.fit)
    return Math.max(...c) - Math.min(...c)
  })
  const bigSwing = swings.filter((s) => s >= 15).length / swings.length
  ok(bigSwing > 0.2, `${(bigSwing * 100).toFixed(1)}% of people swing 15+ points across the stages — stage affinity is the point, not a rounding error`)
  ok(Math.max(...swings) > 30, `the extreme case swings ${Math.max(...swings).toFixed(0)} points — a brilliant pre-seed hire really can be a bad Series C one`)

  // Both ends of the curve must actually occur, or "stage affinity" is one preference in a hat.
  const peaks = new Set(POP.map((p) => bestStage(p)))
  ok(peaks.has('Pre-seed') && peaks.has('Series C'), `people peak at both ends of the company's life (${[...peaks].join(', ')})`)

  // The named example from the brief: fast + owns it + reads ambiguity should be an early hire.
  const early = POP.reduce((a, b) => (stageFit(b, 'Pre-seed') - stageFit(b, 'Series C') > stageFit(a, 'Pre-seed') - stageFit(a, 'Series C') ? b : a))
  const ea = attributes(early)
  ok(
    ea.velocity + ea.ownership + ea.adaptability > ea.quality + ea.culture + 40,
    `the most pre-seed-shaped person in the pool is velocity/ownership/adaptability heavy (${ea.velocity}/${ea.ownership}/${ea.adaptability} vs craft ${ea.quality}, culture ${ea.culture})`,
  )
  const late = POP.reduce((a, b) => (stageFit(b, 'Series C') - stageFit(b, 'Pre-seed') > stageFit(a, 'Series C') - stageFit(a, 'Pre-seed') ? b : a))
  const la = attributes(late)
  ok(la.quality + la.culture > la.velocity + la.adaptability + 40, `and the most Series-C-shaped one is craft and culture (${la.quality}/${la.culture})`)
}

console.log('\n— Seam 1: weekly output. Bounded, and neutral on average —')
{
  const mults = POP.map((p) => stageOutputMultiplier(p, 'Seed'))
  ok(Math.abs(mean(mults) - 1) < 0.02, `mean multiplier is ${mean(mults).toFixed(4)} — adding the system did not buy the economy anything`)
  ok(Math.min(...mults) > 0.8 && Math.max(...mults) < 1.2, `it stays inside ±20% (${Math.min(...mults).toFixed(3)}–${Math.max(...mults).toFixed(3)})`)
  for (const s of ALL_STAGES) {
    const ms = mean(POP.map((p) => stageOutputMultiplier(p, s)))
    ok(Math.abs(ms - 1) < 0.03, `${s}: mean ${ms.toFixed(4)} — no stage is a hidden tax or bonus`)
  }
  // It must be SMALLER than the traits it sits beside, or stage fit stops being a tiebreaker and
  // becomes the main axis — which would make skill and traits ornamental.
  const spread = Math.max(...mults) - Math.min(...mults)
  ok(spread < 0.7, `its whole spread (${spread.toFixed(2)}) is well under the 10x trait's 0.7 bonus — skill and traits stay dominant`)
}

console.log('\n— Seam 2: burn risk only bites in a cash crunch —')
{
  const burns = POP.map((p) => burnRisk(p))
  ok(Math.abs(mean(burns) - 50) < 3, `mean burn risk is ${mean(burns).toFixed(1)} — centred, so the crunch costs what it always did`)
  const bm = POP.map((p) => burnStressMultiplier(p))
  ok(Math.abs(mean(bm) - 1) < 0.03, `mean stress multiplier is ${mean(bm).toFixed(4)}`)
  ok(Math.min(...bm) >= 0.6 && Math.max(...bm) <= 1.4, `bounded to 0.6–1.4 (${Math.min(...bm).toFixed(2)}–${Math.max(...bm).toFixed(2)})`)
  const merc = POP.filter((p) => p.trait === 'mercenary')
  const calm = POP.filter((p) => p.trait === 'culture')
  ok(mean(merc.map(burnRisk)) > mean(calm.map(burnRisk)) + 8, `mercenaries carry more burn risk than culture carriers (${mean(merc.map(burnRisk)).toFixed(0)} vs ${mean(calm.map(burnRisk)).toFixed(0)})`)
}

console.log('\n— Seam 3: desks, not heads —')
{
  const remote = POP.filter((p) => isRemote(p)).length / POP.length
  ok(Math.abs(remote - REMOTE_SHARE) < 0.04, `${(remote * 100).toFixed(1)}% of people are remote, against a ${REMOTE_SHARE * 100}% target`)
  ok(mean(POP.map(deskCost)) > 140 && mean(POP.map(deskCost)) < 160, `the average head still costs ~$150/wk in office (${mean(POP.map(deskCost)).toFixed(0)}) — the old flat rate, preserved`)
  ok(deskCost(POP.find(isRemote)!) === 0 && deskCost(POP.find((p) => !isRemote(p))!) === DESK_COST, 'a remote hire costs nothing to seat and an on-site one costs a desk')
  // Remote is not free money: it is bought with culture, which is the heaviest late-stage weight.
  const rc = mean(POP.filter(isRemote).map((p) => attributes(p).culture))
  const oc = mean(POP.filter((p) => !isRemote(p)).map((p) => attributes(p).culture))
  ok(oc - rc > 4, `remote people run ${(oc - rc).toFixed(1)} points lower on Culture — the desk saving has a price`)
}

console.log('\n— The engine really reads all three —')
{
  const cfg = { mode: 'quick', format: 'standard', sector: 'saas', seed: 4242 } as const
  const base = newGame('SeamCo', 'saas', 'business', { config: { ...cfg } })

  // Office: a fully remote roster pays only the base rent.
  const remoteRoster = POP.filter(isRemote).slice(0, 4)
  const onsiteRoster = POP.filter((p) => !isRemote(p)).slice(0, 4)
  const emp = (p: P, i: number): Employee => ({ ...p, id: `e${i}`, morale: 70, weeks: 10 })
  const gRemote: GameState = { ...base, employees: remoteRoster.map(emp) }
  const gOnsite: GameState = { ...base, employees: onsiteRoster.map(emp) }
  ok(weeklyOffice(gRemote) === 300, `four remote hires cost $${weeklyOffice(gRemote)}/wk of office — no desks`)
  ok(weeklyOffice(gOnsite) === 300 + 4 * DESK_COST, `four on-site hires cost $${weeklyOffice(gOnsite)}/wk`)

  // Output: the same skill, the same trait, a different shape — and the product moves.
  // Picked from the real name pool by fit, which is precisely the choice the hiring card asks the
  // player to make.
  const engineers = POP.filter((p) => p.role === 'engineer' && p.trait === null)
  const good = engineers.reduce((a, b) => (stageFit(b, 'Pre-seed') > stageFit(a, 'Pre-seed') ? b : a))
  const bad = engineers.reduce((a, b) => (stageFit(b, 'Pre-seed') < stageFit(a, 'Pre-seed') ? b : a))
  const run = (p: P): GameState => {
    let g: GameState = { ...base, employees: [{ ...p, id: 'x', skill: 7, morale: 70, weeks: 10 }] }
    for (let i = 0; i < 6; i++) g = advanceWeek(g)
    return g
  }
  const gGood = run(good)
  const gBad = run(bad)
  ok(
    gGood.features > gBad.features,
    `after six weeks a pre-seed-shaped engineer has shipped more than an off-shape one (features ${gGood.features.toFixed(2)} vs ${gBad.features.toFixed(2)}) — the attribute is not decoration`,
  )
  ok(
    stageFit(good, 'Pre-seed') - stageFit(bad, 'Pre-seed') > 20,
    `and the two really are far apart at this stage (${stageFit(good, 'Pre-seed').toFixed(0)} vs ${stageFit(bad, 'Pre-seed').toFixed(0)})`,
  )
}

console.log('\n— Old saves need no migration, because nothing was stored —')
{
  // An employee exactly as a save written before this system existed holds one: six fields, and
  // `trait` absent entirely rather than null.
  const legacy = { id: 'legacy-1', name: 'Nina Costa', role: 'engineer' as Role, skill: 6, salary: 120_000, morale: 61, weeks: 30 }
  const a = attributes(legacy)
  ok(ATTRIBUTE_IDS.every((k) => Number.isFinite(a[k])) && ATTRIBUTE_IDS.reduce((s, k) => s + a[k], 0) === ATTRIBUTE_BUDGET, 'a pre-feature employee record yields a complete, valid profile')
  ok(typeof title(legacy) === 'string' && title(legacy).length > 0, `...with a title (${title(legacy)})`)
  ok(background(legacy).bio.length > 20, '...a background')
  ok(skillChips(legacy).length === 3, '...three skill chips')
  ok(Number.isFinite(stageOutputMultiplier(legacy, 'Seed')), '...and a live output multiplier')

  // And the simulation runs a roster of them without touching the save.
  const base = newGame('LegacyCo', 'saas', 'technical', { seed: 99, aiRivals: false })
  let g: GameState = { ...base, employees: [legacy, { ...legacy, id: 'legacy-2', name: 'Omar Berg', role: 'designer' as Role }] }
  for (let i = 0; i < 8; i++) g = advanceWeek(g)
  ok(!g.gameOver && Number.isFinite(g.cash) && Number.isFinite(g.features), 'eight weeks run cleanly on a legacy roster')
}

console.log('\n— Team fit is a recommendation built only from printed numbers —')
{
  const p = person('Maya Kim', 'engineer', 6)
  const empty = { stage: 'Pre-seed' as Stage, roles: [] as Role[] }
  ok(roleGap('engineer', empty) === 100, 'an empty company wants an engineer more than anything else')
  ok(roleGap('sales', empty) < roleGap('engineer', empty), '...and a salesperson less')
  const heavy = { stage: 'Pre-seed' as Stage, roles: ['engineer', 'engineer', 'engineer', 'engineer'] as Role[] }
  ok(roleGap('engineer', heavy) < roleGap('engineer', empty), 'four engineers in, the fifth is worth less')
  // Not "the designer's gap rises" — it cannot, since a team of four engineers has exactly as many
  // designers as a team of nobody. What changes is the ORDER, which is what the card is for.
  ok(roleGap('designer', empty) < roleGap('engineer', empty), 'with nobody hired, the engineer outranks the designer')
  ok(roleGap('designer', heavy) > roleGap('engineer', heavy), '...and with four engineers hired, the designer outranks the engineer')
  ok(teamFit(p, empty) >= 0 && teamFit(p, empty) <= 100, 'team fit is a percentage')
  const fits = POP.map((x) => teamFit(x, empty))
  ok(Math.max(...fits) - Math.min(...fits) > 25, `it separates the pool (${Math.min(...fits)}–${Math.max(...fits)}) rather than reporting everyone as fine`)

  for (const stage of ALL_STAGES) {
    const mix = TARGET_MIX[stage]
    const total = ROLES.reduce((a, r) => a + mix[r], 0)
    ok(Math.abs(total - 1) < 1e-9, `${stage}'s target role mix is a whole company (${total.toFixed(3)})`)
  }
}

console.log('\n— The display layer says only what the model knows —')
{
  ok(ROLES.every((r) => CARD_ATTRIBUTES[r].length === 3), 'every role puts exactly three attributes on the card')
  ok(ROLES.every((r) => new Set(CARD_ATTRIBUTES[r]).size === 3), '...with no repeats')
  ok(ROLES.every((r) => CARD_ATTRIBUTES[r].every((id) => ATTRIBUTE_IDS.includes(id))), '...and all of them are real attributes')
  ok(peopleMarketSalary('engineer', 5) === marketSalary('engineer', 5), 'the engine re-exports one definition of market salary, not a copy')
  ok(marketSalary('engineer', 0) === ROLE_BASE.engineer, '...and the base rate is still the one the rest of the engine uses')

  // Title, years and CV are RENDERINGS of skill — so they have to move with it, monotonically.
  const titles = [1, 3, 5, 7, 9].map((s) => title({ role: 'engineer', skill: s }))
  ok(new Set(titles).size === 5, `the title ladder is a real ladder (${titles.join(' → ')})`)
  const years = [1, 4, 7, 10].map((s) => yearsExperience({ name: 'Wei Silva', role: 'sales', skill: s }))
  ok(years.every((y, i) => i === 0 || y > years[i - 1]), `years of experience rise with skill (${years.join(', ')})`)
  ok(background({ name: 'Wei Silva', role: 'sales', skill: 9, trait: null }).companies.length === 2, 'a strong candidate arrives with a CV')

  // Cost efficiency has to be a real comparison: an identical person on a bigger salary is worse value.
  const cheap = person('Felix Ali', 'engineer', 6)
  const dear = { ...cheap, salary: Math.round(cheap.salary * 1.5) }
  ok(valueRatio(cheap, 'Seed') > valueRatio(dear, 'Seed'), 'the same person costing 50% more is worse value')
  ok(Math.abs(valueRatio(cheap, 'Seed') - stageOutputMultiplier(cheap, 'Seed')) < 1e-9, '...and at the market rate, value IS the stage multiplier — no third opinion')
  ok(outputPoints({ ...cheap, trait: 'tenx' }, 'Seed') > outputPoints(cheap, 'Seed'), 'a 10x engineer out-produces the same person without the trait')
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
