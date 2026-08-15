// The Run Biography — the story a run already wrote about itself, read back in order.
//
// The game records far more than it ever replays: company memory, promises made and settled,
// the Career decision journal, the token ledger, board strikes, attacks, milestones, endings.
// This module is a PURE READ over all of it. It draws no randomness, writes no state, and
// decides nothing — `buildStory(s)` is a function of the save and nothing else, so building it
// a hundred times leaves the run byte-identical and the same save always tells the same story.
//
// SOURCES MERGED, in the order they are scanned (ties within a week keep this order):
//   1. the founding, read off config + history
//   2. the inbox archive — the recorded sentences of the run: milestones, pivots, rounds,
//      board strikes, attacks, product launches, the S-1, the bridge, resignations
//   3. world.companyMemory — what the company itself considers notable (first customer,
//      profitability), only where the inbox did not already say it
//   4. world.promises — what was said, and how it settled
//   5. world.interactions — the rooms: what somebody asked for and what you answered
//   6. career.journal — the Discovery record: segment pivots and PMF verdicts
//   7. token.history — the launch, the crashes, the votes, the exodus
//   8. the ending
//
// TOLERANCE IS THE CONTRACT. Every subsystem here is optional (no career, no world, no token),
// every array is user-writable localStorage, and a malformed row must be skipped, never thrown
// over — a biography that crashes on a corrupt memory is worse than one missing a sentence.

import type { GameState, Message } from './types'
import { sectorById } from './data'
import { PROMISE_KEYS } from './world/content/memory-cues'
import { ENDINGS, type EndingType } from '../theme'

export type StoryTone = 'good' | 'bad' | 'neutral'

export interface StoryBeat {
  week: number
  /** One human sentence. Recorded strings are reused where they exist; facts are re-worded only where none was stored. */
  text: string
  tone: StoryTone
  /** 0–100: how much this beat defines the run. The share card takes the top handful. */
  weight: number
  /** Set on beats that open a new era — a closed round, the token launch, the ending. */
  chapter?: string
}

export interface StoryChapter {
  title: string
  beats: StoryBeat[]
}

// ---------- guards ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const finiteWeek = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

// ---------- the builder ----------

export function buildStory(s: GameState): StoryBeat[] {
  const beats: StoryBeat[] = []
  const add = (week: unknown, text: string, tone: StoryTone, weight: number, chapter?: string) => {
    if (!finiteWeek(week) || !text) return
    const beat: StoryBeat = { week: Math.round(week), text, tone, weight }
    if (chapter) beat.chapter = chapter
    beats.push(beat)
  }
  // Each source is fenced on its own: a corrupt slice loses its sentences, not the biography.
  const safely = (read: () => void) => {
    try {
      read()
    } catch {
      /* a malformed slice is skipped, never thrown over */
    }
  }

  // Concepts already told by one source, so another source never says them again — the inbox
  // milestone 'Ramen profitable' and company memory's 'profitability' are the same week twice.
  const told = new Set<string>()

  safely(() => addFounding(s, add))
  safely(() => addInboxBeats(s, add, told))
  safely(() => addCompanyMemoryBeats(s, add, told))
  safely(() => addPromiseBeats(s, add))
  safely(() => addInteractionBeats(s, add))
  safely(() => addJournalBeats(s, add))
  safely(() => addTokenBeats(s, add))
  safely(() => addEnding(s, add))

  // Stable sort: by week, then by scan order — so two renders of the same save can never disagree.
  return beats
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.week - y.b.week || x.i - y.i)
    .map((x) => x.b)
}

/** Fold the flat timeline into eras. Chapter breaks are the beats that reset the company's clock. */
export function storyChapters(beats: readonly StoryBeat[]): StoryChapter[] {
  const chapters: StoryChapter[] = []
  let current: StoryChapter = { title: 'The first weeks', beats: [] }
  for (const b of beats) {
    if (b.chapter) {
      if (current.beats.length > 0) chapters.push(current)
      current = { title: b.chapter, beats: [] }
    }
    current.beats.push(b)
  }
  if (current.beats.length > 0) chapters.push(current)
  return chapters
}

/**
 * The 3–5 beats that define the run, for the share card: heaviest first, then put back in
 * week order so the card still reads as a story. The ending always makes the cut.
 */
export function definingBeats(s: GameState, limit = 5): StoryBeat[] {
  const all = buildStory(s)
  const n = Math.max(1, Math.min(limit, 5))
  const picked = all
    .map((b, i) => ({ b, i }))
    .sort((x, y) => y.b.weight - x.b.weight || x.i - y.i)
    .slice(0, n)
    .sort((x, y) => x.i - y.i)
  return picked.map((x) => x.b)
}

type Add = (week: unknown, text: string, tone: StoryTone, weight: number, chapter?: string) => void

// ---------- 1. the founding ----------

function addFounding(s: GameState, add: Add): void {
  const sector = sectorById(str(s.sector)).name
  const name = str(s.companyName) || 'The company'
  add(1, `${name} opens for business in ${sector} — two hundred grand, an empty office, an idea.`, 'neutral', 30)
}

// ---------- 2. the inbox archive ----------

/**
 * The inbox is never trimmed, so it is the one complete record of what the run was told about
 * itself — and its titles are already sentences in the house voice. Matching is on the shapes
 * the engine actually writes; anything unrecognised is simply not a story beat.
 */
/** Inbox milestone title → the CompanyMemoryType it already narrates. */
const MILESTONE_COVERS: Record<string, string> = {
  'First employee': 'first_hire',
  'First real revenue': 'first_revenue',
  'Product-market fit!': 'pmf',
  'Ramen profitable': 'profitability',
}

function addInboxBeats(s: GameState, add: Add, told: Set<string>): void {
  const inbox: unknown = s.inbox
  if (!Array.isArray(inbox)) return
  const company = str(s.companyName)
  // Career states its PMF verdict in the journal with the segment named; when that entry exists
  // the generic engine milestone would be the same week said twice, and the richer telling wins.
  const journal: unknown = s.career?.journal
  const careerTellsPmf =
    Array.isArray(journal) && journal.some((j) => isRecord(j) && str(j.category) === 'milestone' && str(j.title).startsWith('PMF'))
  // unshift-ordered: newest first. Reverse into chronology.
  for (const raw of [...inbox].reverse()) {
    if (!isRecord(raw) || !finiteWeek(raw.week)) continue
    const m = raw as unknown as Message
    const t = str(m.title)
    const id = str(m.id)
    if (!t) continue
    // Token and governance modules write their own inbox mail AND their own ledger entries —
    // the ledger narrates those weeks, so their mail is skipped here rather than said twice.
    if (id.startsWith('gov-') || id.startsWith('token-')) continue
    const w = m.week

    if (t.startsWith('🏁 Milestone: ')) {
      const title = t.slice('🏁 Milestone: '.length)
      const pmf = title === 'Product-market fit!'
      if (MILESTONE_COVERS[title]) told.add(MILESTONE_COVERS[title])
      if (pmf && careerTellsPmf) continue
      add(w, pmf ? 'Product-market fit. Something changed — the product is getting pulled out of your hands.' : `Milestone: ${title.replace(/!$/, '')}.`, 'good', pmf ? 75 : 45)
    } else if (/^Pivot #\d+/.test(t)) {
      add(w, `${t.split(':')[0]} — the whiteboard sentence every startup dreads.`, 'neutral', 70)
    } else if (t.startsWith('Down round: ')) {
      add(w, `${t}. The cash saves the company; the team watches their paper wealth shrink.`, 'bad', 78, chapterForRound(t.slice('Down round: '.length)))
    } else if (/ closed: /.test(t) && m.kind === 'system') {
      add(w, `${t}. The wire hit the account.`, 'good', 80, chapterForRound(t))
    } else if (t.includes('launches its') && t.includes(' product')) {
      add(w, `${t} — a second S-curve, started on purpose.`, 'good', 55)
    } else if (t.startsWith('New vertical: ')) {
      add(w, `${t}.`, 'neutral', 35)
    } else if (t.includes('files to go public')) {
      add(w, `${t}. The S-1 is out; the quiet period begins.`, 'good', 72)
    } else if (t.includes('shelves its IPO')) {
      add(w, `${t} — the street said not yet.`, 'bad', 60)
    } else if (t.startsWith('Emergency bridge')) {
      add(w, 'An emergency bridge round — expensive money, taken at the door of the morgue.', 'bad', 62)
    } else if (t.startsWith('Board ultimatum')) {
      add(w, 'The board issues its ultimatum: deliver the number by the next review, or clean out your desk.', 'bad', 76)
    } else if (/^Board review: strike /.test(t)) {
      add(w, `${t} — investors trade looks across the table.`, 'bad', 55)
    } else if (t === 'Founder burnout') {
      add(w, 'The founder hits the wall. Burnout, the real kind.', 'bad', 50)
    } else if (/^🏦 Covenant breach/.test(t)) {
      add(w, 'The revenue covenant breaks and the bank calls the loan.', 'bad', 58)
    } else if (t === 'Founder takes money off the table') {
      add(w, 'You take some money off the table — the first personal wire that is not a salary.', 'neutral', 40)
    } else if (/ hit you: /.test(t)) {
      add(w, `${stripEmoji(t)}.`, 'bad', 42)
    } else if (t.startsWith('🛡 Crisis team deflected')) {
      add(w, `${stripEmoji(t)} — the retainer earned every dollar.`, 'good', 35)
    } else if (company && t.startsWith(`${company} acquires `)) {
      add(w, `${t}. Their users wake up under your logo.`, 'good', 60)
    } else if (/ resigned$/.test(t)) {
      add(w, `${t}.`, 'bad', 30)
    } else if (/ shut down$/.test(t)) {
      add(w, `${t}. One fewer name in the comparison articles.`, 'neutral', 35)
    }
  }
}

/** "Seed closed: $2.5M from …" / "Series A at $18M" → the era it opens. */
function chapterForRound(title: string): string {
  const stage = title.split(/ closed| at /)[0].trim()
  return stage ? `After the ${stage}` : 'After the round'
}

const stripEmoji = (t: string) => t.replace(/^[^\w$]*\s*/u, '')

// ---------- 3. company memory (only what the inbox did not already say) ----------

/**
 * The CompanyMemory types worth a sentence of their own. first_hire / first_revenue / pmf /
 * profitability are usually already told by an inbox milestone — the `told` set (filled by the
 * inbox scan) is what keeps the same week from being said twice, whichever source got there.
 */
const COMPANY_MEMORY_TEXT: Record<string, { text: string; tone: StoryTone; weight: number }> = {
  first_customer: { text: 'The first customer shows up. Somebody out there wants this.', tone: 'good', weight: 42 },
  profitability: { text: 'Revenue covers the burn for the first time. Nobody can kill this company but you.', tone: 'good', weight: 58 },
}

function addCompanyMemoryBeats(s: GameState, add: Add, told: Set<string>): void {
  const mem: unknown = s.world?.companyMemory
  if (!Array.isArray(mem)) return
  for (const raw of mem) {
    if (!isRecord(raw) || !finiteWeek(raw.week)) continue
    const type = str(raw.type)
    if (told.has(type)) continue
    told.add(type)
    const def = COMPANY_MEMORY_TEXT[type]
    if (def) add(raw.week, def.text, def.tone, def.weight)
  }
}

// ---------- 4. promises ----------

/** What each promise was, in words that fit both "made" and "settled" sentences. */
function promisePhrase(summaryKey: string, facts: Record<string, unknown> | undefined): string {
  const target = numOr(facts?.target, 0)
  const pctWk = `${Math.round(target * 1000) / 10}%/wk growth`
  switch (summaryKey) {
    case PROMISE_KEYS.boardGrowth:
      return `the ${pctWk} you promised a defied board`
    case PROMISE_KEYS.fundingGrowth:
      return `the ${pctWk} the round came with`
    case PROMISE_KEYS.compDiscipline:
      return 'the comp-bands line'
    case PROMISE_KEYS.raise:
      return 'the raise'
    case PROMISE_KEYS.cola:
      return 'the cost-of-living adjustment'
    // Phase 8 — what was said in a room. Worded so both "kept" and "broken" read as sentences.
    case PROMISE_KEYS.boardPace:
      return `the ${pctWk} you took off the board`
    case PROMISE_KEYS.burnCut:
      return 'the smaller burn you promised the board'
    case PROMISE_KEYS.promotion:
      return 'the step up you put a date on'
    case PROMISE_KEYS.equity:
      return 'the equity refresh you owed'
    case PROMISE_KEYS.headcount:
      return 'the two people you promised'
    case PROMISE_KEYS.steadyCourse:
      return 'the quarter you swore would be quiet'
    default:
      return `the ${summaryKey.replace(/^promised_/, '').replace(/_/g, ' ')} promise`
  }
}

function addPromiseBeats(s: GameState, add: Add): void {
  const promises: unknown = s.world?.promises
  if (!Array.isArray(promises)) return
  const nameOf = (id: string): string => {
    const c = s.world?.characters?.[id]
    if (!isRecord(c)) return 'the board'
    const full = `${str(c.firstName)} ${str(c.lastName)}`.trim()
    return full || 'the board'
  }
  for (const raw of promises) {
    if (!isRecord(raw) || !finiteWeek(raw.week)) continue
    const key = str(raw.summaryKey)
    const status = str(raw.status)
    const facts = isRecord(raw.facts) ? raw.facts : undefined
    const who = nameOf(str(raw.characterId))

    // The making of it — only the loud ones; a raise granted on the spot is one beat, not two.
    if (key === PROMISE_KEYS.boardGrowth) {
      const due = numOr(raw.dueWeek, 0)
      const target = numOr(facts?.target, 0)
      add(raw.week, `You defy the board and put your own job on the number: ${Math.round(target * 1000) / 10}%/wk growth${due ? `, judged week ${due}` : ''}.`, 'neutral', 74)
    } else if (key === PROMISE_KEYS.compDiscipline) {
      add(raw.week, `${who} asks for a raise and hears no — the comp bands are the comp bands.`, 'neutral', 44)
    } else if (key === PROMISE_KEYS.raise) {
      add(raw.week, `${who} asks for a raise and gets it — 20%, on the spot.`, 'good', 44)
    } else if (key === PROMISE_KEYS.cola) {
      add(raw.week, '"They actually did it" — a 5% cost-of-living adjustment for everyone on payroll.', 'good', 46)
    } else if (key === PROMISE_KEYS.boardPace) {
      // Phase 8's board decisions. Told HERE rather than from the room, because the commitment is
      // the story — the room is only where it was made.
      const target = numOr(facts?.target, 0)
      add(raw.week, `In the board room you take the number: ${Math.round(target * 1000) / 10}%/wk, by the next review.`, 'neutral', 58)
    } else if (key === PROMISE_KEYS.burnCut) {
      add(raw.week, 'In the board room you choose the other answer: the burn comes down by the next review.', 'neutral', 54)
    }

    // The settling of it — kept and broken are the story; superseded expiries are bookkeeping.
    if ((status === 'kept' || status === 'broken') && finiteWeek(raw.resolvedWeek)) {
      // Instantly-settled promises (the raise, the cola) already read as one beat above.
      if (raw.resolvedWeek === raw.week) continue
      if (status === 'kept') add(raw.resolvedWeek, `Promise kept: ${promisePhrase(key, facts)} was delivered.`, 'good', 52)
      else add(raw.resolvedWeek, `Promise broken: ${promisePhrase(key, facts)} — and ${who} remembers.`, 'bad', 64)
    }
  }
}

// ---------- 5. the rooms (Living World Phase 8) ----------

/**
 * What a settled room was, in one sentence.
 *
 * A room is a beat only when the founder actually SAID something: a stale room that closed
 * unattended has an outcome sentence but no `chosen`, and "you never got back to them" is not a
 * decision the biography should credit anyone with. A board decision that created a commitment is
 * already told by `addPromiseBeats` — the making of that promise is the same week said twice — so
 * only 'maintain', the decision that promises nothing, gets its own line here.
 */
const CONVERSATION_BEAT: Record<string, Record<string, { text: string; tone: StoryTone; weight: number }>> = {
  promotion: {
    explain: { text: 'asks where they are going. You explain the shape of the company instead of answering.', tone: 'neutral', weight: 38 },
    commit: { text: 'asks where they are going, and you name a date.', tone: 'good', weight: 48 },
    hold: { text: 'asks where they are going. You tell them the decision is final.', tone: 'bad', weight: 46 },
  },
  compensation: {
    explain: { text: 'asks about their pay. You open the books and let the runway make the argument.', tone: 'neutral', weight: 36 },
    commit: { text: 'asks about their pay, and you commit to a refresh at the next round.', tone: 'good', weight: 46 },
    hold: { text: 'asks about their pay and hears that the bands are the bands.', tone: 'bad', weight: 44 },
  },
  workload: {
    explain: { text: 'tells you they are carrying too much. You tell them what season the company is in.', tone: 'neutral', weight: 36 },
    commit: { text: 'tells you they are carrying too much, and you promise two more people.', tone: 'good', weight: 46 },
    hold: { text: 'tells you they are carrying too much. You ask them to hold on a while longer.', tone: 'bad', weight: 46 },
  },
  strategy: {
    explain: { text: 'does not agree with the strategy. You argue it out properly, end to end.', tone: 'neutral', weight: 42 },
    commit: { text: 'does not agree with the strategy, and you promise a quarter without another turn.', tone: 'neutral', weight: 48 },
    hold: { text: 'does not agree with the strategy. You tell them it is not up for a vote.', tone: 'bad', weight: 48 },
  },
  departure: {
    explain: { text: 'has been taking the recruiters’ calls. You ask what it would take, and you listen.', tone: 'neutral', weight: 50 },
    commit: { text: 'has been taking the recruiters’ calls, and you promise to make it right at the next round.', tone: 'good', weight: 54 },
    hold: { text: 'has been taking the recruiters’ calls. You wish them well and do not bid.', tone: 'bad', weight: 52 },
  },
}

function addInteractionBeats(s: GameState, add: Add): void {
  const rooms: unknown = s.world?.interactions
  if (!Array.isArray(rooms)) return
  for (const raw of rooms) {
    if (!isRecord(raw) || !finiteWeek(raw.resolvedWeek)) continue
    if (str(raw.status) !== 'resolved') continue
    const chosen = Array.isArray(raw.chosen) ? raw.chosen.filter((c): c is string => typeof c === 'string') : []
    if (chosen.length === 0) continue // closed unattended: nothing was said, so nothing is told
    const week = raw.resolvedWeek
    const kind = str(raw.kind)

    if (kind === 'conversation') {
      const lines = Array.isArray(raw.lines) ? raw.lines : []
      const who = isRecord(lines[0]) ? str(lines[0].speaker) : ''
      const def = CONVERSATION_BEAT[str(raw.topic)]?.[chosen[0]]
      if (who && def) add(week, `${who} ${def.text}`, def.tone, def.weight)
    } else if (kind === 'board_meeting') {
      // Accelerate and Slow down ARE commitments; the promise beats already narrate those.
      if (chosen[0] === 'maintain')
        add(week, 'The board asks which way you are going. You hold the line and promise them nothing.', 'neutral', 42)
    } else if (kind === 'interview') {
      const segment = isRecord(raw.facts) ? str(raw.facts.segment) : ''
      if (segment)
        add(
          week,
          `You sit in on the ${segment} interviews yourself — ${chosen.length} question${chosen.length === 1 ? '' : 's'}, three people, and the answers are not the ones the deck assumed.`,
          'neutral',
          40,
        )
    }
  }
}

// ---------- 6. the Career journal ----------

function addJournalBeats(s: GameState, add: Add): void {
  const journal: unknown = s.career?.journal
  if (!Array.isArray(journal)) return
  // unshift-ordered, newest first. Reverse into chronology; only the entries that shape the arc.
  for (const raw of [...journal].reverse()) {
    if (!isRecord(raw) || !finiteWeek(raw.week)) continue
    const title = str(raw.title)
    if (!title) continue
    const category = str(raw.category)
    if (category === 'pivot') {
      add(raw.week, `${title} — betting the roadmap on somebody else.`, 'neutral', 66)
    } else if (category === 'milestone') {
      const warning = title.startsWith('Token-driven growth')
      add(
        raw.week,
        warning ? `${title}: the growth is rented, and the retention math says so.` : `${title} — customers who stay and pay. The real thing.`,
        warning ? 'bad' : 'good',
        warning ? 56 : 68,
      )
    }
  }
}

// ---------- 7. the token ledger ----------

function addTokenBeats(s: GameState, add: Add): void {
  const history: unknown = s.token?.history
  if (!Array.isArray(history)) return
  for (const raw of history) {
    if (!isRecord(raw) || !finiteWeek(raw.week)) continue
    const type = str(raw.type)
    const md = isRecord(raw.metadata) ? raw.metadata : {}
    const w = raw.week
    const importance = numOr(raw.importance, 0)

    if (type === 'launch') {
      const price = numOr(md.launchPrice, 0)
      add(w, `The token goes live${price ? ` at $${price}` : ''} — the community is the cap table now.`, 'good', 85, 'The token era')
    } else if (type === 'price_crash') {
      const move = Math.abs(Math.round(numOr(md.move, 0) * 100))
      add(w, `The token sheds ${move || 'a third of a'}% in a week. The forums did the arithmetic within the hour.`, 'bad', Math.min(70, 40 + importance / 3))
    } else if (type === 'price_rally' && importance >= 55) {
      const move = Math.round(numOr(md.move, 0) * 100)
      add(w, `The token rallies ${move}% in a week — everyone is a genius in a rising market.`, 'good', 46)
    } else if (type === 'treasury_sale' && numOr(md.proceeds, 0) > 0) {
      add(w, `The treasury sells into its own market — $${Math.round(numOr(md.proceeds, 0)).toLocaleString('en-US')} raised, and the community saw who sold.`, 'neutral', 48)
    } else if (type === 'founder_sale') {
      add(w, 'You sell from your own position. The chain is public; so is the reaction.', 'neutral', 50)
    } else if (type === 'unlock') {
      add(w, 'A vesting unlock hits the float — supply pressure, on a schedule you chose at launch.', 'neutral', 34)
    } else if (type === 'governance_vote') {
      addGovernanceBeat(add, w, md)
    } else if (type === 'decentralisation') {
      add(w, `Control moves to the holders — decentralisation reaches ${Math.round(numOr(md.decentralisation, 0))}.`, 'neutral', 54)
    } else if (type === 'crisis' && str(md.kind) === 'exodus') {
      add(w, `Holders leave in numbers, and they sell on the way out — trust down at ${Math.round(numOr(md.trust, 0))}.`, 'bad', 70)
    } else if (type === 'community_milestone' && str(md.kind) === 'pressure') {
      add(w, 'The community starts asking, loudly, why one person still holds the keys.', 'bad', 44)
    } else if (type === 'utility_milestone') {
      add(w, 'The token is being used for the thing itself — utility, not just a chart.', 'good', 45)
    }
  }
}

function addGovernanceBeat(add: Add, week: number, md: Record<string, unknown>): void {
  const kind = str(md.kind)
  const proposal = str(md.proposal)
  const removal = proposal === 'founder_removal'
  if (kind === 'tabled' && removal) {
    add(week, 'A vote of no confidence in the founder is tabled. The tally is arithmetic, not a roll.', 'bad', 82)
  } else if (kind === 'passed' && removal) {
    add(week, 'The vote of no confidence passes. The community you created votes you out of it.', 'bad', 95)
  } else if (kind === 'rejected' && removal) {
    add(week, 'The no-confidence vote fails. You survive your own token holders — this time.', 'good', 72)
  } else if (kind === 'passed') {
    add(week, `Governance binds the treasury: the "${proposal.replace(/_/g, ' ')}" proposal passes.`, 'neutral', 46)
  } else if (kind === 'defied') {
    add(week, 'You tear up a passed vote. Every vote from here remembers it.', 'bad', 66)
  }
}

// ---------- 8. the ending ----------

const ENDING_TEXT: Record<EndingType, { text: (s: GameState) => string; tone: StoryTone }> = {
  bankrupt: { text: (s) => `The account hits zero. ${str(s.companyName)} is out of money, and the servers go dark.`, tone: 'bad' },
  unicorn: { text: (s) => `${str(s.companyName)} crosses a $1B valuation. A unicorn — the thing the whole genre is named after.`, tone: 'good' },
  acquired: { text: (s) => `${str(s.companyName)} is acquired. Papers signed, badges handed in, wire cleared.`, tone: 'good' },
  fired: { text: () => 'The board votes to replace you. You built it, you raised for it, and they showed you the door.', tone: 'bad' },
  ipo: { text: (s) => `${str(s.companyName)} rings the bell. A ticker symbol, confetti on the trading floor.`, tone: 'good' },
  timeup: { text: () => 'The clock runs out — the closing bell of the challenge.', tone: 'neutral' },
}

function addEnding(s: GameState, add: Add): void {
  const go = s.gameOver
  if (!go || !isRecord(go)) return
  const def = ENDING_TEXT[str(go.type) as EndingType] ?? ENDING_TEXT.timeup
  add(go.week, def.text(s), def.tone, 100, 'The end')
}

/** The ending's presentation row for surfaces that already show ENDINGS — re-exported so the
 *  Story screen and the share card agree with the results screen about every ending's face. */
export const storyEnding = (s: GameState) => ENDINGS[(s.gameOver?.type ?? 'timeup') as EndingType] ?? ENDINGS.timeup
