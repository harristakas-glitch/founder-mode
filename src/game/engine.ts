import {
  EVENTS,
  INVESTORS,
  RIVAL_NAMES,
  RNG,
  STAGES,
  STAGE_THRESHOLDS,
  avgMorale,
  pick,
  raiseDemandTarget,
  randomName,
  sectorById,
} from './data'
import type {
  Candidate,
  Effects,
  Employee,
  FounderKind,
  GameState,
  Message,
  Rival,
  Role,
  SectorId,
  Stage,
  TermSheet,
} from './types'

let idCounter = 0
export const uid = () =>
  `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const rand = (lo: number, hi: number) => lo + RNG.next() * (hi - lo)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Run fn with a seeded RNG, then restore true randomness. Used to deal identical starting worlds.
export function withSeed<T>(seed: number | undefined, fn: () => T): T {
  if (seed === undefined) return fn()
  const prev = RNG.next
  RNG.next = mulberry32(seed)
  try {
    return fn()
  } finally {
    RNG.next = prev
  }
}

// ---------- new game ----------

export interface NewGameOpts {
  seed?: number // deal the same world to everyone with this seed
  challenge?: { label: string; cap: number } | null // capped run (daily / multiplayer match)
  aiRivals?: boolean // false in multiplayer — the other players ARE the rivals
}

export function newGame(companyName: string, sector: SectorId, founderKind: FounderKind, opts: NewGameOpts = {}): GameState {
  return withSeed(opts.seed, () => buildGame(companyName, sector, founderKind, opts))
}

function buildGame(companyName: string, sector: SectorId, founderKind: FounderKind, opts: NewGameOpts): GameState {
  const sec = sectorById(sector)
  const state: GameState = {
    companyName,
    sector,
    founderKind,
    week: 1,
    cash: 200_000,
    users: 0,
    hype: 8,
    reputation: 10,
    features: 5,
    quality: 30,
    bugs: 5,
    pmf: 5,
    resonance: rand(0.45, 1.4),
    researchSignal: 0,
    totalResearch: 0,
    pivots: 0,
    milestones: [],
    allocation: { features: 50, quality: 20, bugs: 10, research: 20, bet: 0 },
    marketingSpend: 1000,
    employees: [],
    candidates: [],
    offersOut: [],
    pendingHires: [],
    rivals: opts.aiRivals === false ? [] : makeRivals(sec.tam),
    climate: rand(-0.3, 0.5),
    inbox: [],
    termSheets: [],
    stage: 'Pre-seed',
    board: null,
    founderEquity: 1,
    lastPostMoney: 0,
    raiseCooldown: 0,
    bridgeUsed: false,
    lastRevenue: 0,
    lastExpenses: 0,
    flash: null,
    challenge: opts.challenge ?? null,
    ipo: null,
    ipoCooldown: 0,
    ventures: [],
    history: [],
    gameOver: null,
  }
  state.candidates = Array.from({ length: 5 }, () => makeCandidate(state))
  state.inbox.push({
    id: uid(),
    week: 1,
    kind: 'system',
    title: `Welcome to ${companyName}`,
    body:
      `You quit your job, pooled $200k from savings and friends & family, and founded ${companyName}. ` +
      `Nobody knows if the market wants what you are building — that is what user research is for. ` +
      `Find product-market fit before the money runs out, outgrow your rivals, and reach a $1B valuation. Good luck, founder.`,
  })
  return state
}

function makeRivals(tam: number): Rival[] {
  const names = [...RIVAL_NAMES].sort(() => Math.random() - 0.5).slice(0, 3)
  return names.map((name) => ({
    id: uid(),
    name,
    users: Math.round(tam * rand(0.0008, 0.006)),
    stage: Math.random() < 0.5 ? 0 : 1,
    product: rand(20, 45),
    momentum: rand(0.5, 1.5),
    alive: true,
  }))
}

// ---------- people ----------

const ROLE_BASE: Record<Role, number> = { engineer: 62_000, designer: 55_000, marketer: 50_000, sales: 52_000 }

function rollTrait(skill: number): import('./types').TraitId | null {
  if (skill >= 8 && Math.random() < 0.2) return 'tenx'
  if (Math.random() < 0.4) return pick<import('./types').TraitId>(['craftsman', 'mercenary', 'culture', 'drama'])
  return null
}

export function makeCandidate(s: GameState): Candidate {
  const role = pick<Role>(['engineer', 'engineer', 'engineer', 'designer', 'marketer', 'sales'])
  const stageBonus = STAGES.indexOf(s.stage) * 0.7
  const skill = clamp(Math.round(rand(1, 6) + s.reputation / 25 + stageBonus), 1, 10)
  const salary = Math.round((ROLE_BASE[role] + skill * 13_000 + rand(-6000, 6000)) / 1000) * 1000
  return {
    id: uid(),
    name: randomName(),
    role,
    skill,
    salary,
    weeksLeft: Math.round(rand(2, 5)),
    notice: Math.round(rand(1, 3)),
    trait: rollTrait(skill),
  }
}

export const recruiterFee = (c: Candidate) => Math.round(c.salary * 0.15)

// Every one-off payment the player has already set in motion — no hidden bills.
export function committedCosts(s: GameState): { due: number; potential: number; recommended: number } {
  const due = s.pendingHires.reduce((a, p) => a + recruiterFee(p.candidate), 0) // signed, will definitely hit
  const potential = s.offersOut.reduce((a, c) => a + recruiterFee(c), 0) // hits if the candidate accepts
  // sensible cash cushion: everything committed + a typical worst-case surprise (infra spikes scale with users)
  const recommended = due + potential + Math.max(20_000, Math.round(s.users * 8))
  return { due, potential, recommended }
}

// ---------- valuation ----------

export function valuation(s: GameState): number {
  const sector = sectorById(s.sector)
  const annualRev = s.lastRevenue * 52
  const growth = growthRate(s)
  const multiple = clamp(8 + growth * 150, 5, 25) * (1 + 0.4 * s.climate)
  const revPart = annualRev * multiple
  // Investors pay up for growth: a fast-growing user base is worth a multiple of a stagnant one.
  const growthMania = 1 + clamp(growth * 12, 0, 4)
  const ventureUserVal = s.ventures.reduce((a, v) => (v.launched ? a + v.users * sectorById(v.sector).perUserVal : a), 0)
  const userPart = (s.users * sector.perUserVal + ventureUserVal) * 0.5 * growthMania
  const vibePart = (s.hype * 12_000 + s.reputation * 10_000 + productScore(s) * 8_000) * (1 + 0.3 * s.climate)
  return Math.max(400_000, Math.round(revPart + userPart + vibePart))
}

export function growthRate(s: GameState): number {
  const h = s.history
  if (h.length < 5) return 0.05
  const now = h[h.length - 1].users
  const then = h[h.length - 5].users
  if (then <= 0) return now > 0 ? 0.2 : 0
  return clamp((now - then) / then / 4, -0.5, 0.5) // avg weekly growth over last 4 weeks
}

export function productScore(s: GameState): number {
  const bugPenalty = s.sector === 'fintech' ? 1.0 : 0.6
  return clamp(s.features * 0.5 + s.quality * 0.5 - s.bugs * bugPenalty, 0, 100)
}

// A qualitative read on demand, unlocked by doing user research.
export function demandSignal(s: GameState): 'unknown' | 'weak' | 'mixed' | 'strong' {
  if (s.researchSignal < 14) return 'unknown'
  if (s.resonance < 0.75) return 'weak'
  if (s.resonance < 1.05) return 'mixed'
  return 'strong'
}

// The measurable range of idea quality (what the demand gauge is drawn against).
export const RESONANCE_RANGE = { min: 0.45, max: 1.6, weakBelow: 0.75, strongAbove: 1.05 }

// Your team's estimate of the idea's true demand, as a confidence band.
// More research narrows the band; it is never perfectly precise.
export function resonanceEstimate(s: GameState): { lo: number; hi: number } | null {
  if (s.researchSignal < 14) return null
  const width = clamp(0.36 - s.researchSignal * 0.004, 0.1, 0.36)
  return {
    lo: Math.max(RESONANCE_RANGE.min, s.resonance - width / 2),
    hi: Math.min(RESONANCE_RANGE.max, s.resonance + width / 2),
  }
}

export function pmfLabel(pmf: number): string {
  if (pmf < 20) return 'Nobody cares yet'
  if (pmf < 40) return 'Polite interest'
  if (pmf < 60) return 'Lukewarm traction'
  if (pmf < 80) return 'Real pull'
  return 'Escape velocity'
}

// ---------- finances ----------

export function weeklyPayroll(s: GameState): number {
  return Math.round(s.employees.reduce((a, e) => a + e.salary, 0) / 52)
}

export function weeklyOffice(s: GameState): number {
  return 300 + s.employees.length * 150
}

export function weeklyInfra(s: GameState): number {
  const ventures = s.ventures.reduce((a, v) => a + v.users * sectorById(v.sector).infraCost, 0)
  return Math.round(s.users * sectorById(s.sector).infraCost + ventures)
}

// Users across every product line — what the board, the press, and the valuation see.
export function totalUsers(s: GameState): number {
  return s.users + s.ventures.reduce((a, v) => a + v.users, 0)
}

// Marketing budgets grow with the company: a Series C war chest can actually be spent.
export function marketingMax(s: GameState): number {
  const byStage: Record<Stage, number> = {
    'Pre-seed': 30_000,
    Seed: 50_000,
    'Series A': 150_000,
    'Series B': 500_000,
    'Series C': 1_500_000,
  }
  return byStage[s.stage]
}

// Paid acquisition price per user: rises as the market saturates and falls with PMF.
export function estimatedCac(s: GameState): number {
  const sector = sectorById(s.sector)
  return Math.max(1, (sector.perUserVal / 4) * (1 + 2 * marketSaturation(s)) * (1.7 - s.pmf / 100))
}

// Channels saturate: every extra dollar past ~$150k/wk buys fewer users than the last.
export function paidUsersPerWeek(s: GameState, spend: number): number {
  return spend / (estimatedCac(s) * (1 + spend / 150_000))
}

export function weeklyBurn(s: GameState): number {
  return weeklyPayroll(s) + weeklyOffice(s) + weeklyInfra(s) + s.marketingSpend
}

export function runwayWeeks(s: GameState): number {
  const net = weeklyBurn(s) - s.lastRevenue
  if (net <= 0) return Infinity
  return s.cash / net
}

// What the runway becomes if this candidate joins (their weekly salary added to burn).
export function runwayAfterHire(s: GameState, c: Candidate): number {
  const committed = [...s.offersOut, ...s.pendingHires.map((p) => p.candidate)].reduce((a, x) => a + x.salary / 52, 0)
  const net = weeklyBurn(s) + committed + c.salary / 52 - s.lastRevenue
  if (net <= 0) return Infinity
  return (s.cash - recruiterFee(c)) / net
}

// ---------- market ----------

// Markets are not static: the addressable market itself grows ~25% a year.
export function effectiveTam(s: GameState): number {
  return Math.round(sectorById(s.sector).tam * (1 + (s.week / 52) * 0.25))
}

export function marketSaturation(s: GameState, externalUsers = 0): number {
  const total = s.users + externalUsers + s.rivals.filter((r) => r.alive).reduce((a, r) => a + r.users, 0)
  return clamp(total / effectiveTam(s), 0, 1)
}

export function rivalValuation(r: Rival, s: GameState): number {
  const sector = sectorById(s.sector)
  return Math.round(r.users * sector.perUserVal * (0.5 + r.product / 150) + r.stage * 2_000_000)
}

// ---------- effects ----------

export function applyEffects(s: GameState, fx: Effects) {
  if (fx.cash) s.cash += fx.cash
  if (fx.hype) s.hype = clamp(s.hype + fx.hype, 0, 100)
  if (fx.reputation) s.reputation = clamp(s.reputation + fx.reputation, 0, 100)
  if (fx.features) s.features = clamp(s.features + fx.features, 0, 100)
  if (fx.quality) s.quality = clamp(s.quality + fx.quality, 0, 100)
  if (fx.bugs) s.bugs = clamp(s.bugs + fx.bugs, 0, 100)
  if (fx.pmf) s.pmf = clamp(s.pmf + fx.pmf, 0, 100)
  if (fx.users) {
    // Fractional values mean "percent of current users", whole numbers are absolute.
    const delta = Math.abs(fx.users) < 1 ? Math.round(s.users * fx.users) : Math.round(fx.users)
    s.users = Math.max(0, s.users + delta)
  }
  if (fx.morale) {
    for (const e of s.employees) e.morale = clamp(e.morale + fx.morale, 0, 100)
  }
  if (fx.special === 'lose-best' && s.employees.length > 0) {
    const best = [...s.employees].sort((a, b) => b.skill - a.skill)[0]
    s.employees = s.employees.filter((e) => e.id !== best.id)
  }
  if (fx.special === 'accelerator') {
    s.founderEquity *= 1 - 0.07
  }
  if (fx.special === 'angel') {
    s.founderEquity *= 1 - 0.08
  }
  if (fx.special === 'grant-raise') {
    const star = raiseDemandTarget(s)
    if (star) {
      star.salary = Math.round((star.salary * 1.2) / 1000) * 1000
      star.morale = clamp(star.morale + 18, 0, 100)
    }
  }
  if (fx.special === 'refuse-raise') {
    const star = raiseDemandTarget(s)
    if (star) star.morale = clamp(star.morale - 20, 0, 100)
  }
  if (fx.special === 'acquihire') {
    for (let i = 0; i < 2; i++) {
      const role: Role = i === 0 ? 'engineer' : pick<Role>(['engineer', 'designer', 'marketer'])
      const skill = clamp(Math.round(rand(5, 8)), 1, 10)
      s.employees.push({
        id: uid(),
        name: randomName(),
        role,
        skill,
        salary: Math.round((ROLE_BASE[role] + skill * 13_000) / 1000) * 1000,
        morale: 62, // their startup just died under them
        weeks: 0,
      })
    }
  }
  if (fx.special === 'board-layoffs' && s.board) {
    const toCut = Math.max(1, Math.floor(s.employees.length * 0.3))
    const cut = [...s.employees].sort((a, b) => a.skill - b.skill).slice(0, toCut)
    s.employees = s.employees.filter((e) => !cut.includes(e))
    s.board.strikes = 1
    applyEffects(s, { morale: -12 })
  }
  if (fx.special === 'board-defy' && s.board) {
    s.board.defied = true
  }
  if (fx.special === 'poach-rival') {
    const skill = clamp(Math.round(rand(8, 9.4)), 1, 10)
    s.candidates.unshift({
      id: uid(),
      name: randomName(),
      role: 'engineer',
      skill,
      salary: Math.round((ROLE_BASE.engineer + skill * 16_000) / 1000) * 1000,
      weeksLeft: 2,
      notice: 1,
    })
  }
}

// ---------- milestones ----------

export interface MilestoneDef {
  id: string
  title: string
  goal: string // shown in the "next goals" list
  cond: (s: GameState) => boolean
  effects: Effects
}

export const MILESTONES: MilestoneDef[] = [
  {
    id: 'first-hire',
    title: 'First employee',
    goal: 'Hire your first employee',
    cond: (s) => s.employees.length >= 1,
    effects: { morale: 3 },
  },
  {
    id: 'first-revenue',
    title: 'First real revenue',
    goal: 'Earn $250+ in a week',
    cond: (s) => s.lastRevenue >= 250,
    effects: { morale: 5, hype: 2 },
  },
  {
    id: 'users-100',
    title: '100 users',
    goal: 'Reach 100 users',
    cond: (s) => s.users >= 100,
    effects: { hype: 3 },
  },
  {
    id: 'pmf-60',
    title: 'Product-market fit!',
    goal: 'Reach 60 PMF — the moment it clicks',
    cond: (s) => s.pmf >= 60,
    effects: { hype: 12, morale: 10, reputation: 6 },
  },
  {
    id: 'users-1k',
    title: '1,000 users',
    goal: 'Reach 1,000 users',
    cond: (s) => s.users >= 1000,
    effects: { hype: 5, reputation: 3 },
  },
  {
    id: 'ramen',
    title: 'Ramen profitable',
    goal: 'Revenue covers your weekly burn',
    cond: (s) => s.week > 4 && s.lastRevenue >= s.lastExpenses,
    effects: { morale: 10, reputation: 6 },
  },
  {
    id: 'users-10k',
    title: '10,000 users',
    goal: 'Reach 10,000 users',
    cond: (s) => s.users >= 10_000,
    effects: { hype: 6, reputation: 4 },
  },
  {
    id: 'market-leader',
    title: 'Market leader',
    goal: 'Have more users than every living rival',
    cond: (s) =>
      s.users > 100 && s.rivals.some((r) => r.alive) && s.rivals.filter((r) => r.alive).every((r) => s.users > r.users),
    effects: { hype: 8, reputation: 8, morale: 6 },
  },
  {
    id: 'users-100k',
    title: '100,000 users',
    goal: 'Reach 100,000 users',
    cond: (s) => s.users >= 100_000,
    effects: { hype: 8, reputation: 5 },
  },
  {
    id: 'centaur',
    title: 'Centaur: $100M company',
    goal: 'Reach a $100M valuation',
    cond: (s) => valuation(s) >= 100_000_000,
    effects: { hype: 10, reputation: 8, morale: 8 },
  },
]

const MILESTONE_FLAVOR: Record<string, string> = {
  'first-hire': 'Someone believed in this enough to quit their job for it. Now you owe them a company worth joining.',
  'first-revenue': 'Actual money, from actual strangers, for the thing you built. Frame the invoice.',
  'users-100': 'One hundred people use your product. You could fit them in a room — and you know some by name.',
  'pmf-60': 'Something changed. Users complain when you are down, sign-ups arrive you cannot explain, and the product is getting pulled out of your hands. This is product-market fit — pour it on.',
  'users-1k': 'A thousand users. The support inbox is no longer quiet, and neither is the market.',
  ramen: 'Revenue now covers the burn. Nobody can kill this company but you.',
  'users-10k': 'Ten thousand users. Strangers mention your product in threads you were not tagged in.',
  'market-leader': 'The comparison articles now list YOU first. Rivals study your changelog.',
  'users-100k': 'Six figures of users. Your cloud bill is a small salary, and your logo shows up in slide decks.',
  centaur: 'A hundred-million-dollar company. The unicorn is visible from here.',
}

function checkMilestones(s: GameState) {
  for (const m of MILESTONES) {
    if (s.milestones.includes(m.id)) continue
    if (!m.cond(s)) continue
    s.milestones.push(m.id)
    applyEffects(s, m.effects)
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `🏁 Milestone: ${m.title}`,
      body: MILESTONE_FLAVOR[m.id] ?? m.goal,
    })
    if (!s.flash) s.flash = `🏁 Milestone reached: ${m.title}`
  }
}

// ---------- new ventures: the multi-product company ----------

export function canStartVenture(s: GameState): { ok: boolean; reason?: string } {
  if (STAGES.indexOf(s.stage) < 2) return { ok: false, reason: 'Reach Series A first — new bets need a real company underneath them' }
  if (s.pmf < 60) return { ok: false, reason: 'Find product-market fit on your core product first (PMF 60+)' }
  if (s.ventures.some((v) => !v.launched)) return { ok: false, reason: 'One un-launched bet at a time — focus is a feature' }
  return { ok: true }
}

export function availableVentureSectors(s: GameState) {
  const taken = new Set<string>([s.sector, ...s.ventures.map((v) => v.sector)])
  return SECTORS_IDS().filter((id) => !taken.has(id))
}

function SECTORS_IDS(): SectorId[] {
  return ['saas', 'social', 'fintech', 'devtools', 'ecommerce']
}

export function startVenture(s: GameState, sector: SectorId) {
  if (!canStartVenture(s).ok) return
  if (!availableVentureSectors(s).includes(sector)) return
  s.ventures.push({
    id: uid(),
    sector,
    features: 5,
    pmf: 5,
    // everything the company has learned tilts the new market's demand roll, same as a pivot
    resonance: clamp(rand(0.5, 1.45) + pivotBonus(s), 0.45, 1.6),
    researchSignal: 0,
    launched: false,
    users: 0,
    startedWeek: s.week,
  })
  if (s.allocation.bet === 0) s.allocation.bet = 25
  const name = sectorById(sector).name
  s.flash = `New bet started: ${name}. Point the "New bet" slider at it — the team explores the new market while the core business runs. It launches as a product line when its PMF reaches 50.`
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `New vertical: ${s.companyName} explores ${name}`,
    body: 'A tiger team peels off to chase a second S-curve. New market, new demand roll, new everything — the discovery loop starts again, funded by a business that already works.',
  })
}

export function ventureSignal(v: import('./types').Venture): 'unknown' | 'weak' | 'mixed' | 'strong' {
  if (v.researchSignal < 14) return 'unknown'
  if (v.resonance < 0.75) return 'weak'
  if (v.resonance < 1.05) return 'mixed'
  return 'strong'
}

export function killVenture(s: GameState, ventureId: string) {
  const v = s.ventures.find((x) => x.id === ventureId)
  if (!v || v.launched) return
  s.ventures = s.ventures.filter((x) => x.id !== ventureId)
  s.allocation.bet = 0
  applyEffects(s, { morale: -4 })
  s.flash = `The ${sectorById(v.sector).name} bet is shelved. The tiger team returns to the mothership with lessons learned.`
}

// ---------- pivot ----------

// Everything the company has learned — lifetime research and pivot scar tissue —
// raises the floor of the next idea's demand roll. This is why you research BEFORE pivoting.
export function pivotBonus(s: GameState): number {
  return Math.min(0.35, s.pivots * 0.05 + s.totalResearch * 0.0015)
}

export function pivot(s: GameState) {
  const bonus = pivotBonus(s)
  s.pivots += 1
  s.features = Math.round(s.features * 0.5)
  s.quality = Math.round(s.quality * 0.7)
  s.hype = Math.round(s.hype * 0.6)
  s.pmf = Math.round(s.pmf * 0.4)
  s.users = Math.round(s.users * 0.7)
  s.researchSignal = 0
  s.resonance = clamp(rand(0.5, 1.45) + bonus, 0.45, 1.6)
  applyEffects(s, { morale: -8 })
  s.flash =
    `Pivot #${s.pivots} is underway. Features, hype, users and PMF all took the hit — and the market's appetite for ` +
    `the new idea is a fresh unknown. Put effort into user research to read the new demand signal.`
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `Pivot #${s.pivots}: a new direction`,
    body:
      'You stood in front of the whiteboard and said the sentence every startup dreads: "What if we did something different?" ' +
      'Half the codebase survives. Some users wander off. Whether the new idea resonates — only research will tell.',
  })
}

// ---------- fundraising ----------

export function nextStage(s: GameState): Stage | null {
  const i = STAGES.indexOf(s.stage)
  return i < STAGES.length - 1 ? STAGES[i + 1] : null
}

export function pitchInvestors(s: GameState): { sheets: TermSheet[]; message: Message } {
  if (s.ipo) {
    const message: Message = {
      id: uid(),
      week: s.week,
      kind: 'system',
      title: 'Quiet period',
      body: 'You are mid-IPO — securities law says no private fundraising until the process ends, one way or the other.',
    }
    s.flash = 'Quiet period: no private fundraising while the IPO is in progress.'
    return { sheets: [], message }
  }
  const val = valuation(s)
  const target = nextStage(s)
  const threshold = STAGE_THRESHOLDS[s.stage]
  s.raiseCooldown = 10

  const frozenOut = s.climate < -0.5 && Math.random() < 0.7
  if (!target || val < threshold || frozenOut) {
    s.raiseCooldown = 4 // a failed roadshow stings, but you can get back out there fast
    const message: Message = {
      id: uid(),
      week: s.week,
      kind: 'system',
      title: 'Investors passed',
      body: !target
        ? 'You are already at Series C. The next step is a $1B valuation — or an exit.'
        : frozenOut && val >= threshold
          ? 'The funding market is frozen solid. Partners nod politely over Zoom, then ghost you. "Great story — timing is tough." Try again when the climate thaws.'
          : `You pitched a dozen funds. The feedback: "too early." Come back when the company is worth ` +
            `$${threshold / 1e6}M (currently $${(val / 1e6).toFixed(1)}M). Traction talks.`,
    }
    s.flash = `${message.title} — ${message.body}`
    return { sheets: [], message }
  }

  const baseN = val > threshold * 2 ? 3 : 2
  const n = clamp(Math.round(baseN + (s.climate > 0.4 ? 1 : 0) - (s.climate < -0.2 ? 1 : 0)), 1, 4)
  // Funds have minimum check sizes per stage — a tiny company raising a "real" round pays for it in dilution.
  const ROUND_FLOORS: Record<Stage, number> = {
    'Pre-seed': 0,
    Seed: 800_000,
    'Series A': 4_000_000,
    'Series B': 15_000_000,
    'Series C': 40_000_000,
  }
  const investors = [...INVESTORS].sort(() => Math.random() - 0.5).slice(0, n)
  const growth = growthRate(s)
  const sheets: TermSheet[] = investors.map((investor) => {
    // Each fund prices you differently around your "fair" valuation; a cold market prices everyone down.
    const climateMult = 1 + 0.35 * s.climate
    const offeredVal = val * rand(0.7, 1.25) * climateMult
    // Investors chase growth: a company compounding fast gets offered a bigger check.
    const growthAppetite = 1 + clamp(growth, 0, 0.3) * 4
    const amount = Math.round(Math.max(ROUND_FLOORS[target], offeredVal * rand(0.15, 0.25) * growthAppetite) / 10_000) * 10_000
    const equity = clamp(amount / (offeredVal + amount), 0.05, 0.4)
    return { id: uid(), investor, amount, equity, weeksLeft: 3 }
  })
  const message: Message = {
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `Term sheets for your ${target}`,
    body: `${n} fund${n === 1 ? '' : 's'} want${n === 1 ? 's' : ''} in. Review the offers on the Fundraising screen — they expire in 3 weeks.`,
  }
  s.flash = `${n} term sheet${n === 1 ? '' : 's'} on the table — offers below expire in 3 weeks.`
  return { sheets, message }
}

export function acceptTermSheet(s: GameState, sheetId: string) {
  const sheet = s.termSheets.find((t) => t.id === sheetId)
  if (!sheet) return
  const target = nextStage(s)
  if (!target) return
  const postMoney = sheet.amount / sheet.equity
  const downRound = s.lastPostMoney > 0 && postMoney < s.lastPostMoney
  s.flash =
    `${target} closed: $${(sheet.amount / 1e6).toFixed(1)}M from ${sheet.investor} at $${(postMoney / 1e6).toFixed(1)}M post-money` +
    `${downRound ? ' — a DOWN round. The team felt that.' : '. The war chest is full — spend it wisely.'}`
  s.cash += sheet.amount
  s.founderEquity *= 1 - sheet.equity
  s.stage = target
  s.termSheets = []
  s.raiseCooldown = 12
  s.lastPostMoney = postMoney
  s.reputation = clamp(s.reputation + (downRound ? -6 : 8), 0, 100)
  s.hype = clamp(s.hype + (downRound ? 2 : 10), 0, 100)
  // New money, new masters: the board resets its expectations for the new stage.
  s.board = { targetGrowth: BOARD_TARGETS[target], nextReview: s.week + 12, strikes: 0, defied: false }
  if (downRound) applyEffects(s, { morale: -8 })
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: downRound
      ? `Down round: ${target} at $${(postMoney / 1e6).toFixed(1)}M`
      : `${target} closed: $${(sheet.amount / 1e6).toFixed(1)}M from ${sheet.investor}`,
    body: downRound
      ? `You took ${sheet.investor}'s money at a valuation below your last round. The cash saves the company, ` +
        `but early employees watch their paper wealth shrink, and the press headline writes itself. You now own ${(s.founderEquity * 100).toFixed(1)}%.`
      : `The wire hit the account. ${sheet.investor} takes ${(sheet.equity * 100).toFixed(1)}% of the company. ` +
        `You now own ${(s.founderEquity * 100).toFixed(1)}%. The press writes you up; candidates take notice.`,
  })
}

// ---------- weekly tick ----------

// externalUsers: other human players' users in the same market (multiplayer).
export function advanceWeek(prev: GameState, externalUsers = 0): GameState {
  const s: GameState = structuredClone(prev)
  const sector = sectorById(s.sector)
  s.week += 1
  s.flash = null

  // --- funding climate drifts ---
  s.climate = clamp(s.climate + rand(-0.12, 0.12), -1, 1)

  // --- engineering & research ---
  const moraleFactor = (e: Employee) => 0.55 + (e.morale / 100) * 0.55
  const traitMult = (e: Employee) => (e.trait === 'tenx' ? 1.5 : e.trait === 'mercenary' ? 1.15 : e.trait === 'craftsman' ? 1.1 : 1)
  const eff = (e: Employee) => e.skill * moraleFactor(e) * traitMult(e)
  // an IPO process eats founder and team attention
  const ipoDrag = s.ipo ? 0.85 : 1
  const engPoints =
    (s.employees.filter((e) => e.role === 'engineer').reduce((a, e) => a + eff(e), 0) +
      (s.founderKind === 'technical' ? 5 : 1.5)) *
    ipoDrag
  const designPoints = s.employees.filter((e) => e.role === 'designer').reduce((a, e) => a + eff(e), 0)
  const craftsmen = s.employees.filter((e) => e.trait === 'craftsman').length
  const a = s.allocation
  const hasBet = s.ventures.some((v) => !v.launched)
  const betAlloc = hasBet ? a.bet : 0
  const allocSum = Math.max(1, a.features + a.quality + a.bugs + a.research + betAlloc)
  const af = a.features / allocSum
  const aq = a.quality / allocSum
  const ab = a.bugs / allocSum
  const ar = a.research / allocSum
  const abet = betAlloc / allocSum

  const featureGain = engPoints * af * 0.32 * (1 - s.features / 130)
  s.features = clamp(s.features + featureGain, 0, 100)
  s.quality = clamp(s.quality + (engPoints * aq * 0.28 + designPoints * 0.22) * (1 - s.quality / 120), 0, 100)
  // Shipping fast creates bugs; bug-fixing focus burns them down; big codebases decay a little on their own.
  s.bugs = clamp(s.bugs + featureGain * 0.55 + s.features * 0.012 - engPoints * ab * 0.5 - craftsmen * 0.7, 0, 100)

  // --- product-market fit: build the right thing, not just more things ---
  const researchPoints = engPoints * ar + designPoints * 0.3 + 0.5
  s.researchSignal += researchPoints
  s.totalResearch += researchPoints
  const pmfGain = (0.3 + researchPoints * 0.35 + featureGain * 0.25) * s.resonance * (1 - s.pmf / 110)
  s.pmf = clamp(s.pmf + pmfGain - 0.5, 0, 100)

  const pScore = productScore(s)

  // --- the new bet: a second discovery loop, run by the tiger team ---
  const bet = s.ventures.find((v) => !v.launched)
  if (bet && abet > 0) {
    const betPoints = engPoints * abet
    const betFeatureGain = betPoints * 0.3 * (1 - bet.features / 130)
    bet.features = clamp(bet.features + betFeatureGain, 0, 100)
    bet.researchSignal += betPoints
    s.totalResearch += betPoints * 0.5 // exploring new markets teaches the whole company
    bet.pmf = clamp(bet.pmf + (0.2 + betPoints * 0.3 + betFeatureGain * 0.2) * bet.resonance * (1 - bet.pmf / 110) - 0.4, 0, 100)
    if (bet.pmf >= 50) {
      bet.launched = true
      bet.users = Math.round(50 + s.hype * 10)
      s.allocation.bet = 0
      const name = sectorById(bet.sector).name
      s.flash = `🚀 ${name} line launched! A second product is live with its own market — a fresh S-curve for the growth chart.`
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${s.companyName} launches its ${name} product`,
        body: 'The press calls it "an ambitious expansion". Your early users call it useful. The growth team calls it a brand-new TAM.',
      })
      applyEffects(s, { hype: 10, morale: 8, reputation: 5 })
    }
  }

  // --- launched product lines grow in their own markets ---
  for (const v of s.ventures) {
    if (!v.launched) continue
    const vs = sectorById(v.sector)
    const vTam = vs.tam * (1 + (s.week / 52) * 0.25)
    const vRoom = Math.pow(Math.max(0, 1 - v.users / vTam), 1.2)
    const vAcq = vs.acqBase * Math.pow(s.hype / 10, 1.25) * 0.5 * (0.35 + (0.65 * v.pmf) / 100) * vRoom * rand(0.8, 1.2)
    const vWom = v.users * vs.viral * Math.pow(v.pmf / 100, 1.5) * vRoom * rand(0.8, 1.2)
    const vChurn = v.users * vs.churn * clamp(2.4 - v.pmf / 45 - s.quality / 250 + s.bugs / 200, 0.3, 3)
    v.users = Math.max(0, Math.round(v.users + vAcq + vWom - vChurn))
    v.pmf = clamp(v.pmf + 0.2, 0, 100) // the line keeps maturing slowly after launch
  }

  // --- hype & marketing (noisy, saturating) ---
  const marketerPoints =
    s.employees.filter((e) => e.role === 'marketer').reduce((a2, e) => a2 + eff(e), 0) +
    (s.founderKind === 'business' ? 4 : 1)
  s.hype *= 0.92
  const hypeGain =
    (Math.sqrt(s.marketingSpend / 250) * (1 + marketerPoints / 12) + marketerPoints * 0.35) *
    (1 - s.hype / 115) *
    rand(0.7, 1.3)
  s.hype = clamp(s.hype + hypeGain, 0, 100)

  // --- users: acquisition is gated by PMF, and the market is finite ---
  const saturation = marketSaturation(s, externalUsers)
  const room = Math.pow(1 - saturation, 1.2)
  const pmfAcq = 0.35 + (0.65 * s.pmf) / 100
  // paid acquisition: big budgets buy users directly, at a CAC that worsens with saturation and channel fatigue
  const paid = paidUsersPerWeek(s, s.marketingSpend) * room * rand(0.8, 1.2)
  const acquired = sector.acqBase * Math.pow(s.hype / 10, 1.25) * (0.4 + pScore / 130) * pmfAcq * room * rand(0.8, 1.2) + paid
  const wordOfMouth = s.users * sector.viral * Math.pow(s.pmf / 100, 1.5) * (1 + s.hype / 150) * room * rand(0.8, 1.2)
  const churnMult = clamp(2.4 - s.pmf / 45 - s.quality / 250 + s.bugs / 200, 0.3, 3)
  const churned = s.users * sector.churn * churnMult
  s.users = Math.max(0, Math.round(s.users + acquired + wordOfMouth - churned))

  // --- revenue & costs: people only pay for things they need ---
  const salesPoints = s.employees.filter((e) => e.role === 'sales').reduce((a2, e) => a2 + eff(e), 0)
  const salesBoost = 1 + salesPoints / 40 + (s.founderKind === 'business' ? 0.08 : 0)
  const conversion = 0.25 + (0.75 * s.pmf) / 100
  // Ad-driven models only monetize at scale: CPMs and fill rates climb with network size.
  const scaleBoost = s.sector === 'social' ? 1 + Math.log10(Math.max(10, s.users)) / 3 : 1
  const coreRevenue = s.users * sector.arpuWeekly * salesBoost * conversion * scaleBoost * (0.6 + pScore / 150)
  const ventureRevenue = s.ventures.reduce((acc, v) => {
    if (!v.launched) return acc
    const vs = sectorById(v.sector)
    const vScale = v.sector === 'social' ? 1 + Math.log10(Math.max(10, v.users)) / 3 : 1
    return acc + v.users * vs.arpuWeekly * salesBoost * (0.25 + (0.75 * v.pmf) / 100) * vScale * (0.6 + pScore / 150)
  }, 0)
  const revenue = Math.round(coreRevenue + ventureRevenue)
  const payroll = weeklyPayroll(s)
  const office = weeklyOffice(s)
  const infra = weeklyInfra(s)
  const expenses = payroll + office + infra + s.marketingSpend
  const cashAtStart = s.cash
  s.cash += revenue - expenses
  const cashAfterOperations = s.cash // everything below here (fees, events) is a one-off hit
  s.lastRevenue = revenue
  s.lastExpenses = expenses

  // --- offers out: candidates make up their minds ---
  const offerNews: string[] = []
  for (const c of [...s.offersOut]) {
    const runwayNow = s.cash / Math.max(1, expenses - revenue)
    const acceptChance = 0.72 + s.reputation / 400 - (runwayNow > 0 && runwayNow < 10 ? 0.25 : 0) + (s.climate < -0.2 ? 0.08 : 0)
    if (Math.random() < acceptChance) {
      s.pendingHires.push({ candidate: c, weeksUntilStart: c.notice })
      offerNews.push(`${c.name} accepted (starts in ${c.notice} wk)`)
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: `${c.name} accepted your offer`,
        body: `${c.name} (${c.role}) signed. They start in ${c.notice} week${c.notice === 1 ? '' : 's'} after serving notice. Recruiter fee due on start: $${recruiterFee(c).toLocaleString()}.`,
      })
    } else {
      offerNews.push(`${c.name} declined${runwayNow < 10 ? ' — your runway scared them off' : ''}`)
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${c.name} declined your offer`,
        body:
          runwayNow < 10
            ? `${c.name} passed. "I loved the team, but I looked at your runway and I have a mortgage." Word gets around when a startup looks shaky.`
            : `${c.name} took a counter-offer from their current employer. The search continues.`,
      })
    }
    s.offersOut = s.offersOut.filter((x) => x.id !== c.id)
  }
  if (offerNews.length > 0) s.flash = `Hiring: ${offerNews.join(' · ')}`

  // --- pending hires: notice periods tick down ---
  for (const p of [...s.pendingHires]) {
    p.weeksUntilStart -= 1
    if (p.weeksUntilStart <= 0) {
      const c = p.candidate
      s.employees.push({ id: c.id, name: c.name, role: c.role, skill: c.skill, salary: c.salary, morale: 75, weeks: 0 })
      s.cash -= recruiterFee(c)
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: `${c.name} started today`,
        body: `${c.name} (${c.role}) picked a desk and shipped their first commit. Recruiter fee paid: $${recruiterFee(c).toLocaleString()}.`,
      })
      s.pendingHires = s.pendingHires.filter((x) => x.candidate.id !== c.id)
    }
  }

  // --- morale ---
  const runway = s.cash / Math.max(1, expenses - revenue)
  const cultureCarriers = s.employees.filter((e) => e.trait === 'culture').length
  const dramaMagnets = s.employees.filter((e) => e.trait === 'drama').length
  for (const e of s.employees) {
    e.weeks += 1
    let d = (70 - e.morale) * 0.06 // drift toward 70
    if (expenses > revenue && runway < 8) d -= 5
    if (s.bugs > 55) d -= 2
    if (featureGain > 2.5) d += 1.5
    if (s.hype > 60) d += 1
    if (s.pmf > 60) d += 1
    d += cultureCarriers * 0.8 - dramaMagnets * 0.8
    if (e.trait === 'mercenary' && expenses > revenue && runway < 12) d -= 3
    d += rand(-2, 2)
    e.morale = clamp(e.morale + d, 0, 100)
  }
  // Quits — mercenaries jump ship well before anyone else
  const quitters = s.employees.filter(
    (e) => e.morale < (e.trait === 'mercenary' ? 42 : 32) && Math.random() < 0.22,
  )
  for (const q of quitters) {
    s.employees = s.employees.filter((e) => e.id !== q.id)
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `${q.name} resigned`,
      body: `${q.name} (${q.role}) handed in their notice, citing burnout and "a lack of direction". The rest of the team is watching how you respond.`,
    })
    applyEffects(s, { morale: -5 })
  }

  // --- rivals make their moves ---
  tickRivals(s, room)

  // --- candidates rotate ---
  s.candidates = s.candidates.filter((c) => (c.weeksLeft -= 1) > 0)
  while (s.candidates.length < 5) s.candidates.push(makeCandidate(s))

  // --- term sheets & cooldowns expire ---
  s.termSheets = s.termSheets.filter((t) => (t.weeksLeft -= 1) > 0)
  if (s.raiseCooldown > 0) s.raiseCooldown -= 1
  if (s.ipoCooldown > 0) s.ipoCooldown -= 1

  // --- IPO process ---
  tickIPO(s)

  // --- random event ---
  maybeFireEvent(s)

  // --- acquisition offers: only credible companies get bought ---
  const val = valuation(s)
  if (val > 8_000_000 && s.pmf > 50 && Math.random() < 0.03 && !s.inbox.some((m) => !m.resolved && m.kind === 'choice')) {
    const amount = Math.round((val * rand(0.85, 1.5)) / 1e6) * 1e6
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'choice',
      title: `Acquisition offer: $${(amount / 1e6).toFixed(0)}M`,
      body:
        `A strategic acquirer wants to buy ${s.companyName} outright for $${(amount / 1e6).toFixed(0)}M in cash. ` +
        `Your ${(s.founderEquity * 100).toFixed(0)}% stake would be worth $${((amount * s.founderEquity) / 1e6).toFixed(1)}M. ` +
        `Take the money, or keep building?`,
      meta: { acquisitionAmount: amount },
      choices: [
        { label: 'Sell the company', resultText: 'You sign the papers. Champagne — and a strange emptiness.', effects: { special: 'acquired' } },
        { label: 'Keep building', resultText: 'You are not done yet. The team cheers.', effects: { morale: 6, reputation: 3 } },
      ],
    })
  }

  // --- history ---
  s.history.push({
    week: s.week,
    cash: Math.round(s.cash),
    users: totalUsers(s),
    revenue,
    expenses,
    payroll,
    marketing: s.marketingSpend,
    office,
    infra,
    valuation: val,
    pmf: Math.round(s.pmf),
  })
  if (s.history.length > 300) s.history.shift()

  // --- board review ---
  boardReview(s)

  // --- milestones ---
  checkMilestones(s)

  // --- endings (skip if the IPO already decided this week) ---
  if (s.gameOver) return s
  if (s.cash < 0) {
    // A bridge exists for companies worth saving: real valuation, or fundamentals that basically work.
    const nearProfitable = revenue >= expenses * 0.85
    if (!s.bridgeUsed && (val > 3_000_000 || nearProfitable)) {
      s.bridgeUsed = true
      const bridge = Math.max(Math.round(weeklyBurn(s) * 10), Math.abs(Math.round(s.cash)) + 25_000)
      s.cash += bridge
      s.founderEquity *= 0.85
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: 'Emergency bridge round',
        body:
          `The bank account hit zero. ${nearProfitable && val <= 3_000_000 ? 'Your fundamentals are close enough to working that an angel took the call. They' : 'An existing investor'} wired a $${(bridge / 1000).toFixed(0)}k bridge loan to keep the lights on — ` +
          `in exchange for 15% of the company. This will not happen twice. Fix the burn.`,
      })
      s.flash = `⚠️ The account hit zero — a $${(bridge / 1000).toFixed(0)}k emergency bridge saved you, for 15% of the company. There is no second bridge.`
    } else {
      const oneOffs = Math.round(cashAfterOperations - s.cash)
      const fmt = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString()}`
      s.gameOver = {
        type: 'bankrupt',
        week: s.week,
        detail:
          `The final week: you went in with ${fmt(cashAtStart)}, earned ${fmt(revenue)} in revenue, paid ${fmt(expenses)} in running costs` +
          (oneOffs > 0 ? `, and took ${fmt(oneOffs)} in one-off hits (recruiter fees, event costs, severance)` : '') +
          `. That left the account at −${fmt(s.cash)}${s.bridgeUsed ? ', and the bridge loan was already spent' : ', and no investor would bridge it'}.`,
      }
    }
  } else if (val >= 1_000_000_000) {
    s.gameOver = { type: 'unicorn', week: s.week, payout: Math.round(val * s.founderEquity) }
  } else if (s.challenge && s.week >= s.challenge.cap) {
    s.gameOver = { type: 'timeup', week: s.week, payout: Math.round(val * s.founderEquity) }
  }

  return s
}

// ---------- IPO ----------

export const IPO_COST = 2_000_000
export const IPO_MIN_VAL = 300_000_000
export const IPO_MIN_ANNUAL_REV = 10_000_000

export function ipoChecklist(s: GameState): { label: string; met: boolean }[] {
  return [
    { label: 'Series C company', met: s.stage === 'Series C' },
    { label: `Valuation ≥ ${IPO_MIN_VAL / 1e6}M`, met: valuation(s) >= IPO_MIN_VAL },
    { label: `Revenue ≥ $${IPO_MIN_ANNUAL_REV / 1e6}M/yr`, met: s.lastRevenue * 52 >= IPO_MIN_ANNUAL_REV },
    { label: 'Bankers will answer your calls', met: s.ipoCooldown === 0 },
    { label: `$${IPO_COST / 1e6}M for bankers & lawyers`, met: s.cash >= IPO_COST },
  ]
}

export function ipoEligible(s: GameState): boolean {
  return !s.ipo && !s.gameOver && ipoChecklist(s).every((c) => c.met)
}

export function startIPO(s: GameState) {
  if (!ipoEligible(s)) return
  s.cash -= IPO_COST
  s.ipo = { phase: 'filing', weeksLeft: 4, demand: 50 }
  s.flash =
    'The S-1 is filed. Four weeks of regulatory scrutiny, then a four-week roadshow — and then the market decides what you are worth. ' +
    'Fundraising is frozen during the quiet period, and the process will eat some of your attention.'
  s.inbox.unshift({
    id: uid(),
    week: s.week,
    kind: 'system',
    title: `${s.companyName} files to go public`,
    body:
      'The confidential S-1 hits the SEC. Analysts start building models, journalists start digging, and every bug report ' +
      'is suddenly a "material risk factor". Keep the product clean and the growth curve pointing up.',
  })
}

function tickIPO(s: GameState) {
  if (!s.ipo) return
  const ipo = s.ipo
  ipo.weeksLeft -= 1

  if (ipo.phase === 'filing') {
    // scrutiny: the street reads everything
    let d = 0
    if (s.bugs > 50) d -= 4
    if (s.reputation > 60) d += 2
    if (s.reputation < 35) d -= 3
    if (growthRate(s) > 0.02) d += 2
    ipo.demand = clamp(ipo.demand + d + rand(-2, 2), 0, 100)
    if (ipo.weeksLeft <= 0) {
      ipo.phase = 'roadshow'
      ipo.weeksLeft = 4
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'system',
        title: 'The roadshow begins',
        body: 'Eight cities, forty meetings, one deck. Fund managers squint at your churn curve and ask about "the path to profitability". Every strong week adds demand for the stock.',
      })
    }
    return
  }

  // roadshow: demand builds (or leaks) week by week
  ipo.demand = clamp(ipo.demand + 3 + growthRate(s) * 60 + s.climate * 4 + s.hype / 30 + rand(-3, 3), 0, 100)
  s.hype = clamp(s.hype + 4, 0, 100)
  if (ipo.weeksLeft <= 0) priceIPO(s)
}

function priceIPO(s: GameState) {
  const val = valuation(s)
  // pricing day: investor demand meets the market's mood
  const mult = 0.72 + (s.ipo!.demand / 100) * 0.55 + 0.3 * s.climate + rand(-0.08, 0.12)
  s.ipo = null
  if (mult >= 0.95) {
    const pop = mult >= 1.15
    const payout = Math.round(val * mult * s.founderEquity)
    s.gameOver = { type: 'ipo', week: s.week, payout }
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'system',
      title: pop ? `📈 ${s.companyName} pops ${Math.round((mult - 1) * 100)}% on debut` : `${s.companyName} is a public company`,
      body: pop
        ? 'The bell rings, the ticker climbs, and CNBC mispronounces your name. A very good day.'
        : 'A steady, respectable debut. The bankers look relieved, which is their version of joy.',
    })
  } else {
    s.ipoCooldown = 25
    s.reputation = clamp(s.reputation - 10, 0, 100)
    applyEffects(s, { morale: -8 })
    s.flash =
      `IPO pulled. Demand priced the offering ${Math.round((1 - mult) * 100)}% below your last round and the board refused to go out at that price. ` +
      'The street will not look at you again for a while — build the numbers, then come back.'
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `${s.companyName} shelves its IPO`,
      body: '"Market conditions", says the press release. Everyone knows what that means. The team watched the ticker that never was.',
    })
  }
}

// ---------- the board ----------

export const BOARD_TARGETS: Record<Stage, number> = {
  'Pre-seed': 0,
  Seed: 0.035,
  'Series A': 0.03,
  'Series B': 0.025,
  'Series C': 0.02,
}

// What the board actually expects right now: raw stage targets, tempered by market reality.
export function boardEffectiveTarget(s: GameState): number {
  if (!s.board) return 0
  return Math.max(0.008, s.board.targetGrowth * (1 - 0.5 * marketSaturation(s)))
}

// Trailing weekly revenue growth — the board's alternative yardstick for mature companies.
export function revenueGrowthRate(s: GameState): number {
  const h = s.history
  if (h.length < 5) return 0
  const now = h[h.length - 1].revenue
  const then = h[h.length - 5].revenue
  if (then <= 0) return now > 0 ? 0.2 : 0
  return clamp((now - then) / then / 4, -0.5, 0.5)
}

function boardReview(s: GameState) {
  if (!s.board || s.week < s.board.nextReview) return
  const growth = growthRate(s)
  const target = boardEffectiveTarget(s)
  s.board.nextReview = s.week + 10

  // Mature companies have two ways to make the board happy: grow users, or grow money.
  const revGrowth = revenueGrowthRate(s)
  const netMargin = s.lastExpenses > 0 ? (s.lastRevenue - s.lastExpenses) / Math.max(1, s.lastRevenue) : 0
  const passedByUsers = growth >= target
  const passedByRevenue = revGrowth >= target
  const passedByProfit = netMargin > 0.15 && revGrowth >= target * 0.4

  if (passedByUsers || passedByRevenue || passedByProfit) {
    if (s.board.defied) s.board.defied = false
    s.board.strikes = Math.max(0, s.board.strikes - 1)
    s.reputation = clamp(s.reputation + 2, 0, 100)
    applyEffects(s, { morale: 2 })
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: 'Board review: thumbs up',
      body: passedByUsers
        ? `Growth of ${(growth * 100).toFixed(1)}%/wk beats the ${(target * 100).toFixed(1)}% target. The board meeting ends early, which is the highest compliment a board can give.`
        : passedByRevenue
          ? `User growth is slowing, but revenue is compounding at ${(revGrowth * 100).toFixed(1)}%/wk — above target. "Monetization story," someone writes approvingly.`
          : `Users are mature, but a ${(netMargin * 100).toFixed(0)}% net margin with growing revenue is a business, not a bet. The board approves of money.`,
    })
    return
  }

  if (growth >= target * 0.6 || revGrowth >= target * 0.6) {
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: 'Board review: raised eyebrows',
      body: `Growth of ${(growth * 100).toFixed(1)}%/wk is under the ${(target * 100).toFixed(1)}% the board signed up for. "We are watching the next quarter closely." No strike — this time.`,
    })
    return
  }

  // A real miss.
  if (s.board.defied) {
    s.gameOver = { type: 'fired', week: s.week, payout: Math.round(valuation(s) * s.founderEquity * 0.5) }
    return
  }
  s.board.strikes += 1
  if (s.board.strikes >= 3) {
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'choice',
      title: 'Board ultimatum',
      body:
        `Three reviews, three misses. The board's patience is spent: "Cut the burn and refocus, or we will find a CEO who can." ` +
        `Submit, and they expect layoffs this week. Defy them, and you had better deliver ${(target * 100).toFixed(1)}%/wk growth by the next review — or clean out your desk.`,
      choices: [
        {
          label: 'Submit — emergency layoffs',
          resultText: 'The board nods grimly. The office is quieter now, in every sense.',
          effects: { special: 'board-layoffs' },
        },
        {
          label: 'Defy the board — bet on yourself',
          resultText: 'You tell them growth is coming. The team rallies behind you. The clock is ticking.',
          effects: { morale: 5, special: 'board-defy' },
        },
      ],
    })
  } else {
    applyEffects(s, { morale: -3 })
    s.inbox.unshift({
      id: uid(),
      week: s.week,
      kind: 'news',
      title: `Board review: strike ${s.board.strikes} of 3`,
      body: `Growth of ${(growth * 100).toFixed(1)}%/wk badly misses the ${(target * 100).toFixed(1)}% target. Investors trade looks across the table. Three strikes brings an ultimatum.`,
    })
  }
}

// ---------- rivals ----------

function tickRivals(s: GameState, room: number) {
  const sector = sectorById(s.sector)
  for (const r of s.rivals) {
    if (!r.alive) continue
    r.product = clamp(r.product + rand(0.3, 1.1), 0, 100)
    // Rivals follow their own S-curve: fast while small, flattening as they saturate their niche.
    const sCurve = Math.max(0, 1 - r.users / (effectiveTam(s) * 0.35))
    const growth = (sector.viral * 0.8 + 0.01) * r.momentum * (1 + 0.3 * s.climate) * room * sCurve
    r.users = Math.max(0, Math.round(r.users * (1 + growth) + sector.acqBase * rand(0.5, 2) * (0.5 + r.product / 100)))

    // A rival with a better product siphons some of your least-happy users.
    if (r.product > productScore(s) + 15 && s.users > 50 && Math.random() < 0.25) {
      const stolen = Math.round(s.users * rand(0.005, 0.02))
      s.users -= stolen
      r.users += stolen
    }

    const roll = Math.random()
    if (roll < 0.03 && r.stage < 4 && r.users > sector.tam * 0.002 * (r.stage + 1)) {
      r.stage += 1
      r.momentum *= 1.15
      const stageName = STAGES[r.stage]
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${r.name} raised a ${stageName}`,
        body: `TechCrunch reports ${r.name} closed their ${stageName}. Their recruiters are suddenly everywhere, and your candidates have started mentioning them in interviews.`,
      })
      applyEffects(s, { hype: -3 })
    } else if (roll > 0.97) {
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${r.name} shipped a big launch`,
        body: `${r.name} announced a flashy new release. The comparison threads write themselves.`,
      })
      r.product = clamp(r.product + 6, 0, 100)
      applyEffects(s, { hype: -4 })
    } else if (roll > 0.955 && roll <= 0.97 && r.users < sector.tam * 0.001 && s.week > 20) {
      r.alive = false
      const refugees = Math.round(r.users * 0.1)
      s.users += refugees
      s.inbox.unshift({
        id: uid(),
        week: s.week,
        kind: 'news',
        title: `${r.name} shut down`,
        body: `${r.name} posted the "an incredible journey" blog post. ${refugees > 0 ? `Some of their orphaned users (${refugees.toLocaleString()}) migrated to you.` : 'One less name in the comparison threads.'}`,
      })
    }
  }
}

function maybeFireEvent(s: GameState) {
  if (Math.random() > 0.45) return
  if (s.inbox.some((m) => m.kind === 'choice' && !m.resolved)) return
  const eligible = EVENTS.filter(
    (e) =>
      (e.minWeek ?? 0) <= s.week &&
      (!e.cond || e.cond(s)) &&
      !s.inbox.slice(0, 8).some((m) => m.title === e.title), // avoid rapid repeats
  )
  if (eligible.length === 0) return
  const total = eligible.reduce((acc, e) => acc + e.weight, 0)
  let roll = Math.random() * total
  const def = eligible.find((e) => (roll -= e.weight) <= 0) ?? eligible[0]
  const msg: Message = {
    id: uid(),
    week: s.week,
    kind: def.choices ? 'choice' : 'news',
    title: def.title,
    body: def.body(s),
    choices: def.choices?.(s),
  }
  s.inbox.unshift(msg)
  if (def.autoEffects) applyEffects(s, def.autoEffects(s))
}

export function hasPendingDecision(s: GameState): boolean {
  return s.inbox.some((m) => m.kind === 'choice' && !m.resolved)
}

export function weekDate(week: number): string {
  const d = new Date(2025, 0, 6)
  d.setDate(d.getDate() + (week - 1) * 7)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export { avgMorale }
