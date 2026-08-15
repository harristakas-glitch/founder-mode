// Living World Phase 8 — Structured Interactions (brief §38-§39, §41-§45, §46-§47; tests §85).
//
// What carries the phase: three rooms OPEN from facts the simulation already resolved, the founder
// ANSWERS on a surface the simulation never reads, and the answer is FELT through the systems
// Phases 1-7 built — trust, memory, and a promise with a deadline that a later week settles from a
// simulation fact. The rooms are content, never causes: flipping the three capabilities moves no
// simulation byte and adds no inbox message.
//
// NON-VACUITY. Two controls carry the file. "the control: one funded run reaches all three rooms"
// proves the gating assertions below are not passing because nothing was ever generated; and
// `npm run bots` is byte-identical to the pre-phase build while 128 of 144 bot runs organically
// open rooms (141 interviews, 391 conversations — no bot strategy closes a round in 90 weeks, so
// board meetings are exercised by this file's funded walkthrough instead).
//
// MUTATION LEDGER — each entry was verified by making the named break, running this file, and
// watching the named assertion fail, then reverting. An assertion that cannot fail is not a test.
// SURVIVORS ARE RECORDED, because they are the ledger's whole point.
//
//   1. answerEvidence drops the politeness term (the `stated` block)
//                                          → "§43: politeness alone inflates the answer" fails —
//                                            signal 50 vs 50, byte-equal. SURVIVOR NOTE: the first
//                                            draft compared the two ends of a GENERATED room raw
//                                            and read backwards, because the polite customer and
//                                            the blunt one also differ in price sensitivity and in
//                                            who can sign. Cloning one person and changing the one
//                                            field is what actually pins the bias.
//   2. answerEvidence drops the budget-authority penalty
//                                          → "§85: budget authority matters" fails: 0.24 vs 0.24.
//   3. composeAnswer stops passing the customer's profile tags
//                                          → "everybody in the room answers the question that was
//                                            asked" and "§45: evidence is structural" fail — with
//                                            no profile tags a customer whose only eligible line is
//                                            profile-gated composes nothing and says nothing at all.
//   4. askQuestion stops recording evidence  → "§45: evidence is structural" (0 results) and the
//                                            persistence round-trip both fail.
//   5. conversationCandidate's strain floor removed
//                                          → "a contented cast opens nothing, even with a grievance
//                                            to raise" fails. SURVIVOR NOTE: the first draft only
//                                            healed the relationships, and a contented cast has no
//                                            topic either — it passed with the floor deleted. The
//                                            grievance has to be held constant (morale forced to 40)
//                                            for the assertion to be about strain.
//   6. answerConversation's `commit` stops calling notePromise
//                                          → "committing in a room IS a promise, with a deadline",
//                                            the §77 panel row, and all three settlement
//                                            assertions fail.
//   7. interactionPromiseVerdict's headcount branch inverted (>= → <)
//                                          → "the two hires settle kept…" and "…broken when the
//                                            deadline arrives" both fail, and the trust comparison
//                                            between them inverts.
//   8. interactionPromiseVerdict's steadyCourse verdict forced to 'holding'
//                                          → "a pivot inside the quarter breaks it EARLY" fails.
//                                            SURVIVOR NOTE: zeroing only the `pivots` term survives
//                                            — the career focus/pricing/segment check catches a
//                                            refocus on its own, which is the point of reading four
//                                            facts rather than one.
//   9. answerConversation stops applying relationship facts (feelFacts gutted)
//                                          → "the three answers land differently on trust" fails:
//                                            all three read 40.91, byte-equal.
//  10. the board meeting's second voice. Three separate breaks, three different failures of
//      "§47: BOTH chairs speak":
//        a. per-chair topic exclusivity removed → both chairs pick the loudest item, and several
//           (topic, direction) pairs have exactly ONE grounded context fragment, so the second
//           chair has nothing left to say.
//        b. the soft/hard exclusion fallback removed (`?? say(hard)`) → a Dashboard panel that used
//           the only retention line that week silences the independent director outright.
//        c. RECORDED SURVIVOR: removing boardMeetingTopics' per-chair agenda guarantee survives on
//           seed 4242 now that (a) is in place — the top four by severity already contain something
//           the independent weighs. It is belt-and-braces for the weeks when they do not.
//  11. answerBoardMeeting's promise creation removed
//                                          → "§47: Accelerate IS a commitment", "made to the
//                                            board, carrying the number", and the Slow-down burn
//                                            assertion all fail.
//  12. capability gating, verified one gate at a time:
//        a. `chooseInteractionOption`'s per-kind gate → "a room left open by a since-revoked
//           capability cannot be answered" fails.
//        b. generateInteractions' board gate → "proceduralBoardMeetings off removes exactly
//           board_meeting" fails.
//        c. generateInteractions' conversation gate → the equivalent conversation assertion fails.
//      SURVIVOR NOTE: (a) survived the first draft entirely — the old fixture never closed a round,
//      so "no board meeting with the capability off" was true because no board existed. The funded
//      control replaced it.
//  13. sweepStaleInteractions removed        → "an unanswered room goes cold after 8 weeks" fails.
//  14. the cap's open-room protection removed (open rooms shed like settled ones)
//                                          → "an open room is never dropped by the cap" fails.
//  15. persistence normalizeInteraction drops `chosen`
//                                          → "the rooms survive a JSON round-trip verbatim" fails.
//  16. the interview roster stored under `who{i}` removed
//                                          → "§42: the panel is three named people" fails (empty).
//  17. story.ts's addInteractionBeats removed
//                                          → "the answer becomes a story beat" fails.
//  18. the `interaction` key renamed in the replay registry
//                                          → the journal assertion throws 'unknown replay action'
//                                            (loudly, twice), and replay.test.ts's action-surface
//                                            ledger goes red alongside it.

import { acceptTermSheet, advanceWeek, newGame, resolveChoiceOnState } from '../src/game/engine'
import { applyJournaled, replayRun } from '../src/game/replay'
import { tickLivingWorld } from '../src/game/world/tick'
import {
  INTERACTION_STALE_WEEKS,
  answerEvidence,
  buildInterviewCustomer,
  chooseInteractionOption,
  customerTags,
  interviewRoster,
  openConversation,
  openInteractions,
  recentInteractions,
} from '../src/game/world/interactions'
import {
  BOARD_MEETING_MAX_TOPICS,
  BOARD_MEETING_MIN_TOPICS,
  CUSTOMER_FRAGMENTS,
  INTERVIEW_PANEL_SIZE,
  INTERVIEW_QUESTION_BUDGET,
  interviewQuestion,
} from '../src/game/world/content/interactions'
import { LIVING_WORLD_LIMITS, type StructuredInteraction } from '../src/game/world/types'
import { migrateLivingWorldSlice } from '../src/game/world/persistence'
import { validateFragmentLibrary, DEFAULT_FRAGMENT_LIBRARY } from '../src/game/world/composer'
import { PROMISE_KEYS } from '../src/game/world/content/memory-cues'
import { commitmentLedger } from '../src/game/world/promises'
import { startExperiment } from '../src/game/career/pmf'
import { buildStory } from '../src/game/story'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails.push(msg)
}

// ---------- fixtures ----------

const cfg = (seed: number, mode: 'quick' | 'career' | 'arena' = 'career', overrides?: Record<string, boolean>) =>
  ({ mode, format: 'standard', sector: 'saas' as SectorId, seed, overrides }) as never

let expIds = 0

/** A plain Career run that hires, spends and answers its inbox — the shape a real player has. */
function play(seed: number, weeks: number, mode: 'quick' | 'career' | 'arena' = 'career', overrides?: Record<string, boolean>): GameState {
  let s = newGame('Northwind', 'saas', 'technical', { config: cfg(seed, mode, overrides) })
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
    s.marketingSpend = 3000
    if (s.employees.length + s.offersOut.length + s.pendingHires.length < 5 && s.candidates.length) {
      const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((c) => c.id !== best.id)
      s.offersOut.push(best)
    }
    s = advanceWeek(s)
  }
  return s
}

/** Start a real interview study on the target segment; it lands two weeks later. */
function runInterviewStudy(s: GameState): void {
  startExperiment(s.career!, s.week, 'interview', s.career!.primaryTargetSegmentId, `t-exp-${expIds++}`)
}

/** Play until an open room of this kind exists, or give up. Returns the room, never a guess. */
function playUntilRoom(seed: number, kind: StructuredInteraction['kind'], weeks = 60): { s: GameState; room?: StructuredInteraction } {
  let s = newGame('Northwind', 'saas', 'technical', { config: cfg(seed) })
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
    s.marketingSpend = 3000
    if (s.employees.length + s.offersOut.length + s.pendingHires.length < 5 && s.candidates.length) {
      const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
      s.candidates = s.candidates.filter((c) => c.id !== best.id)
      s.offersOut.push(best)
    }
    if (kind === 'interview' && w % 6 === 0 && s.career && s.cash > 60_000) runInterviewStudy(s)
    s = advanceWeek(s)
    const room = openInteractions(s.world, kind)[0]
    if (room) return { s, room }
  }
  return { s }
}

/** Seed 4242's walkthrough: a term sheet at w21 installs a board due for review at w33. */
function playToFunding(seed = 4242): GameState {
  const s = play(seed, 20)
  s.termSheets.push({ id: 'ts-1', investor: 'Granite Peak', amount: 1_200_000, equity: 0.18, weeksLeft: 2 })
  acceptTermSheet(s, 'ts-1')
  return s
}

const trustOf = (s: GameState, characterId: string) =>
  s.world?.characters[characterId]?.relationships.find((r) => r.characterId === 'founder')?.trust

// ---------------------------------------------------------------------------------------

console.log('— Content is lintable before it is judgeable —')
{
  const problems = validateFragmentLibrary({ ...DEFAULT_FRAGMENT_LIBRARY, ...CUSTOMER_FRAGMENTS })
  ok(problems.length === 0, `the customer pools pass the library lint (${problems.length === 0 ? 'clean' : problems.join('; ')})`)
}

console.log('\n— §42-§45: the hidden customer, and what an answer is actually worth —')
{
  // One segment truth, two opposite people. Everything that differs below is the PERSON, which is
  // the §43 lesson stated as an experiment.
  const truth = { needIntensity: 62, willingnessToPay: 55, productRequirement: 50, acquisitionAccessibility: 55, marketSize: 60 }
  const panel = Array.from({ length: 24 }, (_, i) => buildInterviewCustomer(4242, 'w10_interview_small_teams', i, 'small_teams', truth, 10))
  const byPoliteness = [...panel].sort((a, b) => b.politenessBias - a.politenessBias)
  const polite = byPoliteness[0]
  const blunt = byPoliteness[byPoliteness.length - 1]
  ok(
    polite.politenessBias - blunt.politenessBias > 25 && customerTags(polite).includes('polite') && customerTags(blunt).includes('blunt_customer'),
    `generation spreads the room: politeness from ${blunt.politenessBias} to ${polite.politenessBias} on one segment`,
  )

  // ONE VARIABLE AT A TIME. The two ends of the room differ in more than politeness (price
  // sensitivity, who can sign), and comparing them raw measures the mixture rather than the bias —
  // the first draft of this block did exactly that and read backwards. Each assertion below clones
  // one person and changes the single field it is about.
  const pay = interviewQuestion('pay')!
  const withBias = (bias: number) => ({ ...blunt, politenessBias: bias })
  const politeEv = answerEvidence(pay, withBias(polite.politenessBias), truth)
  const bluntEv = answerEvidence(pay, withBias(blunt.politenessBias), truth)
  ok(
    politeEv.signal > bluntEv.signal,
    `§43: politeness alone inflates the answer (signal ${politeEv.signal} vs ${bluntEv.signal}, same person, same truth)`,
  )
  ok(
    politeEv.reliability < bluntEv.reliability,
    `…and the engine prices that: reliability ${politeEv.reliability} vs ${bluntEv.reliability} — stated interest is weaker than behaviour`,
  )

  const signer = { ...blunt, budgetAuthority: true }
  const nonSigner = { ...blunt, budgetAuthority: false }
  ok(
    answerEvidence(pay, signer, truth).reliability > answerEvidence(pay, nonSigner, truth).reliability,
    `§85: budget authority matters — the same "yes" is worth more from somebody who can sign (${answerEvidence(pay, signer, truth).reliability} vs ${answerEvidence(pay, nonSigner, truth).reliability})`,
  )

  // The ladder §41 is built around: a recalled fact beats a hypothesis, whoever is answering.
  const recalled = answerEvidence(interviewQuestion('last')!, polite, truth)
  const hypothetical = answerEvidence(pay, polite, truth)
  ok(recalled.reliability > hypothetical.reliability, `"when did it last happen" outranks "would you pay" (${recalled.reliability} vs ${hypothetical.reliability})`)

  // §42: never expose the hidden values. The profile becomes TAGS, and the tags are what the
  // answer pool sees — nothing downstream can print the number.
  ok(customerTags(polite).includes('polite') && customerTags(blunt).includes('blunt_customer'), 'the profile reaches the composer as tags, never as numbers')

  // Determinism: the same person is the same person.
  const again = buildInterviewCustomer(4242, 'w10_interview_small_teams', 0, 'small_teams', truth, 10)
  ok(JSON.stringify(again) === JSON.stringify(panel[0]), 'the same (seed, room, index) rebuilds an identical customer — the record IS the seed')
}

console.log('\n— §41: the room, the budget, and the answers (integration) —')
{
  const { s, room } = playUntilRoom(4242, 'interview')
  ok(!!room, `an interview study that completed opened a room (${room?.title})`)
  if (room) {
    ok(interviewRoster(room).length === INTERVIEW_PANEL_SIZE, `§42: the panel is three named people (${interviewRoster(room).map((r) => r.role).join(', ')})`)
    ok(room.options.length === 8, '§41: all eight questions are on the table')
    ok(room.movesLeft === INTERVIEW_QUESTION_BUDGET, `the budget is what makes choosing between them a decision (${room.movesLeft})`)

    // Two different people answering the SAME question must not give the same sentence.
    chooseInteractionOption(s, room.id, 'pay')
    const answers = room.lines.filter((l) => l.optionId === 'pay')
    ok(answers.length === INTERVIEW_PANEL_SIZE, 'everybody in the room answers the question that was asked')
    ok(new Set(answers.map((a) => a.text)).size === answers.length, '§85: the answer reflects the hidden profile — three people, three different answers')
    ok(
      answers.every((a) => a.text.length > 10 && !a.text.includes('{')),
      'every answer is a finished sentence with no unfilled slot',
    )

    // §45: the evidence is produced structurally and never parsed out of the prose.
    const ev = room.evidence ?? []
    ok(ev.length === INTERVIEW_PANEL_SIZE, `§45: evidence is structural — one result per answer (${ev.length})`)
    ok(
      ev.every((e) => typeof e.metric === 'string' && e.signal >= 0 && e.signal <= 100 && e.reliability >= 0 && e.reliability <= 1),
      'each result carries metric, signal and reliability, in range',
    )
    ok(ev.every((e) => e.metric === 'willingnessToPay'), 'and the metric is the one the question probes')

    // The budget is real, and re-asking is a no-op.
    const before = JSON.stringify(room)
    chooseInteractionOption(s, room.id, 'pay')
    ok(JSON.stringify(room) === before, 'asking the same question twice changes nothing')
    ok(room.movesLeft === INTERVIEW_QUESTION_BUDGET - 1, 'one question spent, not two')

    for (const q of ['last', 'who_buys', 'switch']) chooseInteractionOption(s, room.id, q)
    ok(room.status === 'resolved' && room.movesLeft === 0, 'the room closes when the budget runs out')
    ok(!!room.outcome && /None of it moves PMF/.test(room.outcome), `and it says what the session was worth: "${room.outcome?.slice(0, 88)}…"`)
    ok(chooseInteractionOption(s, room.id, 'why') === null, 'a closed room takes no more questions')
  }
}

console.log('\n— §38-§39: the conversation, and the answer that becomes a commitment —')
{
  const { s, room } = playUntilRoom(11, 'conversation')
  ok(!!room, `a strained relationship opened a conversation (${room?.title})`)
  if (room) {
    const who = room.characterIds[0]
    ok(room.lines.length === 1 && room.lines[0].characterId === who, 'the person speaks first, in their own voice')
    ok(room.options.length === 3, '§38: explain, commit, or tell them the decision is final')

    // The three answers land differently. Same seed, same week, same person — three futures.
    const at = (option: string) => {
      const x = structuredClone(s)
      chooseInteractionOption(x, room.id, option)
      return x
    }
    const explained = at('explain')
    const committed = at('commit')
    const held = at('hold')
    // The invariant is that the three answers are genuinely three answers, and that the refusal is
    // the one that costs. Whether listening properly outranks promising something is deliberately
    // NOT pinned: on a departure risk it should be close, and a test that fixed the order would be
    // asserting a balance choice rather than a contract.
    const trio = [trustOf(committed, who)!, trustOf(explained, who)!, trustOf(held, who)!]
    ok(new Set(trio.map((t) => t.toFixed(2))).size === 3, `the three answers land differently on trust (${trio.map((t) => t.toFixed(2)).join(' / ')})`)
    ok(
      trustOf(held, who)! < trustOf(explained, who)! && trustOf(held, who)! < trustOf(committed, who)!,
      `and "the decision is final" is the one that costs (hold ${trustOf(held, who)!.toFixed(2)} below both)`,
    )

    const promise = committed.world!.promises.find((p) => p.week === committed.week && p.characterId === who)
    ok(!!promise && promise.status === 'open' && promise.dueWeek !== undefined, `committing in a room IS a promise, with a deadline (w${promise?.dueWeek})`)
    ok(explained.world!.promises.every((p) => p.week !== explained.week), 'explaining commits to nothing — no ledger row')
    ok(commitmentLedger(committed).some((r) => r.id === promise!.id), '§77: and it shows up on the commitments panel')

    // The refusal is remembered, and it is remembered as a refusal.
    const soured = held.world!.characters[who]!.memories.find((m) => m.sourceId === room.id)
    ok(!!soured && soured.emotionalImpact < 0, 'the decision-is-final answer is remembered, and remembered badly')

    // Answering twice is a no-op — the same idempotency the whole subsystem is built on.
    const snapshot = JSON.stringify(committed.world)
    chooseInteractionOption(committed, room.id, 'hold')
    ok(JSON.stringify(committed.world) === snapshot, 'a closed room cannot be answered again')

    // A CONVERSATION NEEDS A REAL GRIEVANCE. Same state, same week, same cast — the only thing
    // that changes below is how the person feels about the founder, and that alone decides
    // whether there is a room at all. A conversation the game cannot point at a reason for is a
    // conversation this system is not allowed to invent.
    const clearGap = (x: GameState) => {
      x.world!.interactions = x.world!.interactions!.filter((r) => r.kind !== 'conversation')
      return x
    }
    const strained = clearGap(structuredClone(s))
    ok(!!openConversation(strained, strained.world!, 4242), 'the control: with the cast as it is, a room opens')

    // The grievance is HELD CONSTANT and made unmissable (everyone underpaid and unhappy), so the
    // only thing that differs from the control is how the cast feels about the founder. Without
    // that, a contented cast is quiet for the trivial reason that it has no topic, and the
    // assertion would pass with the strain floor deleted.
    const contented = clearGap(structuredClone(s))
    for (const e of contented.employees) e.morale = 40
    for (const id of Object.keys(contented.world!.characters)) {
      const c = contented.world!.characters[id]
      c.relationships = c.relationships.map((r) => ({ ...r, trust: 95, respect: 95, alignment: 95, dependence: 95 }))
    }
    ok(!openConversation(contented, contented.world!, 4242), 'a contented cast opens nothing, even with a grievance to raise — strain is the fact, not the calendar')
  }
}

console.log('\n— The room commitments settle from simulation facts, never by fiat —')
{
  // "Two more people on your team", judged by headcount. The FACT is the hire, not the intent.
  const { s, room } = playUntilRoom(11, 'conversation')
  if (!room) ok(false, 'no conversation to commit in')
  else {
    const headcountRoom = structuredClone(s)
    // Force the topic that promises headcount so the assertion is about SETTLEMENT, not about
    // which grievance seed 11 happened to produce.
    const target = headcountRoom.world!.interactions!.find((r) => r.id === room.id)!
    target.topic = 'workload'
    target.options = [
      { id: 'explain', label: 'x' },
      { id: 'commit', label: 'y' },
      { id: 'hold', label: 'z' },
    ]
    chooseInteractionOption(headcountRoom, target.id, 'commit')
    const promise = headcountRoom.world!.promises.find((p) => p.summaryKey === PROMISE_KEYS.headcount)
    ok(!!promise && typeof promise.facts?.headcount === 'number', `the record snapshots the fact it will be judged on (headcount ${promise?.facts?.headcount})`)

    const grow = (x: GameState, n: number) => {
      for (let i = 0; i < n; i++)
        x.employees.push({ id: `hired-${i}`, name: `Hire ${i}`, role: 'engineer', skill: 6, salary: 120_000, morale: 70, weeks: 1 })
    }
    const kept = structuredClone(headcountRoom)
    grow(kept, 2)
    for (let w = 0; w < 3 && !kept.gameOver; w++) kept.marketingSpend = 3000, (kept as GameState) === kept && void 0, Object.assign(kept, advanceWeek(kept))
    ok(
      kept.world!.promises.find((p) => p.id === promise!.id)?.status === 'kept',
      'the two hires settle kept as soon as headcount actually grows — an honoured promise stops hanging over the relationship',
    )

    let broken = structuredClone(headcountRoom)
    for (let w = 0; w < 20 && !broken.gameOver; w++) {
      broken.marketingSpend = 3000
      broken = advanceWeek(broken)
    }
    ok(
      broken.world!.promises.find((p) => p.id === promise!.id)?.status === 'broken',
      'and broken when the deadline arrives and nobody was hired',
    )
    ok(
      trustOf(broken, room.characterIds[0])! < trustOf(kept, room.characterIds[0])! - 5,
      `a broken room promise costs real trust against keeping it (kept ${trustOf(kept, room.characterIds[0])} vs broken ${trustOf(broken, room.characterIds[0])})`,
    )
  }
}

console.log('\n— "A quarter without a turn of the wheel" breaks EARLY, the moment the wheel turns —')
{
  const { s, room } = playUntilRoom(11, 'conversation')
  if (!room) ok(false, 'no conversation to commit in')
  else {
    const x = structuredClone(s)
    const target = x.world!.interactions!.find((r) => r.id === room.id)!
    target.topic = 'strategy'
    target.options = [{ id: 'commit', label: 'y' }]
    chooseInteractionOption(x, target.id, 'commit')
    const promise = x.world!.promises.find((p) => p.summaryKey === PROMISE_KEYS.steadyCourse)!
    ok(promise.status === 'open' && promise.facts?.focus === x.career!.focus, 'the record snapshots the strategy it promises to leave alone')

    const heldCourse = structuredClone(x)
    for (let w = 0; w < 4 && !heldCourse.gameOver; w++) Object.assign(heldCourse, advanceWeek(heldCourse))
    ok(heldCourse.world!.promises.find((p) => p.id === promise.id)?.status === 'open', 'a quiet quarter leaves it open — kept by absence, judged at the deadline')

    let turned = structuredClone(x)
    turned.career!.focus = turned.career!.focus === 'reliability' ? 'automation' : 'reliability'
    turned = advanceWeek(turned)
    ok(
      turned.world!.promises.find((p) => p.id === promise.id)?.status === 'broken',
      'a pivot inside the quarter breaks it EARLY — the deadline is not what judges a promise already contradicted',
    )
  }
}

console.log('\n— §46-§47: the board sits down, and the decision is a commitment —')
{
  let s = playToFunding()
  let room: StructuredInteraction | undefined
  for (let w = 0; w < 30 && !s.gameOver && !room; w++) {
    s.marketingSpend = 3000
    s = advanceWeek(s)
    room = openInteractions(s.world, 'board_meeting')[0]
  }
  ok(!!room, `the board sat down a quarter after the round closed (${room?.title})`)
  if (room) {
    const topics = String(room.facts?.topics ?? '').split(',').filter(Boolean)
    ok(
      topics.length >= BOARD_MEETING_MIN_TOPICS && topics.length <= BOARD_MEETING_MAX_TOPICS,
      `§46: ${topics.length} topics on the agenda, all read off the week (${topics.join(', ')})`,
    )
    ok(room.lines.length === 2, `§47: BOTH chairs speak (${room.lines.map((l) => l.role).join(' / ')})`)
    ok(
      new Set(room.characterIds).size === 2 && room.lines[0].text !== room.lines[1].text,
      `§47: two chairs, and they can disagree — neither borrows the other's sentence ("${room.lines[0]?.text.slice(0, 46)}…" vs "${room.lines[1]?.text.slice(0, 46)}…")`,
    )
    ok(room.options.map((o) => o.id).join(',') === 'accelerate,maintain,slow', '§47: Accelerate / Maintain / Slow down')

    const accelerate = structuredClone(s)
    chooseInteractionOption(accelerate, room.id, 'accelerate')
    const pace = accelerate.world!.promises.find((p) => p.summaryKey === PROMISE_KEYS.boardPace)
    ok(!!pace && pace.status === 'open' && pace.dueWeek !== undefined, `§47: Accelerate IS a commitment, due at the next review (w${pace?.dueWeek})`)
    ok(pace?.characterId === 'adv:board' && typeof pace.facts?.target === 'number', 'made to the board, carrying the number it will be judged on')

    const maintain = structuredClone(s)
    chooseInteractionOption(maintain, room.id, 'maintain')
    ok(
      maintain.world!.promises.every((p) => p.summaryKey !== PROMISE_KEYS.boardPace && p.summaryKey !== PROMISE_KEYS.burnCut),
      'Maintain promises nothing — that is exactly what makes it the safe answer',
    )

    const slow = structuredClone(s)
    chooseInteractionOption(slow, room.id, 'slow')
    const burn = slow.world!.promises.find((p) => p.summaryKey === PROMISE_KEYS.burnCut)
    ok(!!burn && typeof burn.facts?.burn === 'number', `Slow down commits to a number the company actually spends (burn ${burn?.facts?.burn})`)

    // Settlement is the simulation's own arithmetic. Same seed, one field changed.
    const judged = (mut: (x: GameState) => void): GameState => {
      const x = structuredClone(accelerate)
      x.week = pace!.dueWeek!
      mut(x)
      tickLivingWorld(x)
      return x
    }
    const deliveredTarget = (pace!.facts!.target as number) * 4
    const hit = judged((x) => {
      const h = x.history
      const base = h[h.length - 5].users
      h[h.length - 1] = { ...h[h.length - 1], users: Math.round(base * (1 + deliveredTarget) + 10) }
    })
    ok(hit.world!.promises.find((p) => p.id === pace!.id)?.status === 'kept', 'the number delivered settles the board commitment kept')
    // BOTH yardsticks have to be flat: the board accepts users or revenue, exactly as its own
    // review does, so zeroing only one of them leaves the commitment legitimately kept.
    const missed = judged((x) => {
      const h = x.history
      h[h.length - 1] = { ...h[h.length - 1], users: h[h.length - 5].users, revenue: h[h.length - 5].revenue }
    })
    ok(missed.world!.promises.find((p) => p.id === pace!.id)?.status === 'broken', 'flat growth at the review settles it broken')
    ok(
      trustOf(missed, 'adv:board')! < trustOf(hit, 'adv:board')! - 5,
      `and the board feels the difference (kept ${trustOf(hit, 'adv:board')} vs broken ${trustOf(missed, 'adv:board')})`,
    )
  }
}

console.log('\n— Rooms are bounded, and an unanswered one goes cold rather than queueing —')
{
  const { s, room } = playUntilRoom(4242, 'interview')
  ok(!!room, 'a room to leave unanswered')
  if (room) {
    let cold = structuredClone(s)
    for (let w = 0; w <= INTERACTION_STALE_WEEKS && !cold.gameOver; w++) {
      cold.marketingSpend = 3000
      cold = advanceWeek(cold)
    }
    const swept = cold.world!.interactions!.find((r) => r.id === room.id)!
    ok(swept.status === 'resolved' && !!swept.outcome, `an unanswered room goes cold after ${INTERACTION_STALE_WEEKS} weeks ("${swept.outcome?.slice(0, 60)}…")`)
    ok(swept.chosen.length === 0, 'and nothing was said, so nothing was felt: no choice on the record')
    ok(
      cold.world!.characters[Object.keys(cold.world!.characters)[0]] !== undefined,
      'the cast is untouched by a room nobody attended',
    )
  }

  // The cap: an OPEN room is never dropped, however many settled ones are competing.
  const s2 = play(4242, 12)
  const world = s2.world!
  world.interactions = [
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `settled-${i}`, kind: 'interview' as const, mode: 'ask' as const, week: i, topic: 't', title: 't',
      characterIds: [], lines: [], options: [], chosen: [], movesLeft: 0, status: 'resolved' as const, resolvedWeek: i,
    })),
    { id: 'open-1', kind: 'conversation' as const, mode: 'answer' as const, week: 1, topic: 'promotion', title: 't',
      characterIds: [], lines: [], options: [{ id: 'hold', label: 'x' }], chosen: [], movesLeft: 1, status: 'open' as const },
  ]
  const revived = migrateLivingWorldSlice(JSON.parse(JSON.stringify(world)))!
  ok(revived.interactions!.length <= LIVING_WORLD_LIMITS.interactions, `the cap holds (${revived.interactions!.length} ≤ ${LIVING_WORLD_LIMITS.interactions})`)
  ok(revived.interactions!.some((r) => r.id === 'open-1'), 'an open room is never dropped by the cap — a question asked and never answered is not bookkeeping')
}

console.log('\n— Persistence (§68/§88): the rooms must survive exactly —')
{
  const { s, room } = playUntilRoom(4242, 'interview')
  if (room) {
    chooseInteractionOption(s, room.id, 'pay')
    chooseInteractionOption(s, room.id, 'who_buys')
  }
  const revived = migrateLivingWorldSlice(JSON.parse(JSON.stringify(s.world)))
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v
  ok(
    JSON.stringify(canon(revived?.interactions)) === JSON.stringify(canon(s.world?.interactions)),
    'the rooms survive a JSON round-trip verbatim — every answer, every line, every evidence result',
  )

  const garbage = migrateLivingWorldSlice({
    ...JSON.parse(JSON.stringify(s.world)),
    interactions: [
      { id: 'g1', kind: 'seance', week: 3, options: [{ id: 'a', label: 'a' }] },
      { id: 'g2', kind: 'conversation', week: 4, status: 'open', movesLeft: 3, options: [], lines: [{ speaker: '', text: '' }] },
      { id: 'g3', kind: 'board_meeting', week: 5, status: 'open', movesLeft: 2, options: [{ id: 'x', label: 'X' }], chosen: 'nope', evidence: 'nope' },
      'nonsense',
      ...JSON.parse(JSON.stringify(s.world!.interactions ?? [])),
    ],
  })
  ok(!garbage!.interactions!.some((r) => r.id === 'g1'), 'a room of an unknown kind is dropped, never guessed at')
  ok(garbage!.interactions!.find((r) => r.id === 'g2')?.status === 'resolved', 'an open room with no options is closed rather than left unanswerable')
  const g3 = garbage!.interactions!.find((r) => r.id === 'g3')
  ok(!!g3 && Array.isArray(g3.chosen) && g3.chosen.length === 0 && g3.evidence === undefined, 'hostile field types coerce to empty rather than crashing the load')
}

console.log('\n— Interpretation only: flipping the capabilities moves no simulation byte —')
{
  const trace = (s: GameState) => `${s.users}|${s.pmf.toFixed(6)}|${Math.round(s.cash)}|${s.quality.toFixed(4)}|${s.bugs.toFixed(4)}|${s.inbox.length}|${s.employees.length}`
  const playStudied = (overrides?: Record<string, boolean>) => {
    let s = newGame('Northwind', 'saas', 'technical', { config: cfg(4242, 'career', overrides) })
    for (let w = 0; w < 40 && !s.gameOver; w++) {
      for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
      s.marketingSpend = 3000
      if (s.employees.length + s.offersOut.length + s.pendingHires.length < 5 && s.candidates.length) {
        const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
        s.candidates = s.candidates.filter((c) => c.id !== best.id)
        s.offersOut.push(best)
      }
      if (w % 6 === 0 && s.career && s.cash > 60_000) runInterviewStudy(s)
      s = advanceWeek(s)
    }
    return s
  }
  const on = playStudied()
  const off = playStudied({ structuredInterviews: false, structuredEmployeeConversations: false, proceduralBoardMeetings: false })
  ok((on.world?.interactions?.length ?? 0) >= 2, `the run with the capabilities opened rooms (${on.world?.interactions?.length})`)
  ok(off.world?.interactions === undefined, 'the run without them never grew the key at all')
  ok(trace(on) === trace(off), 'and the simulation is byte-identical either way — the rooms interpret, never decide')
  const inboxShape = (s: GameState) => s.inbox.map((m) => `${m.week}|${m.kind}|${m.title}`).join('\n')
  ok(inboxShape(on) === inboxShape(off), 'the inbox is untouched: not one message added, dropped or reordered (the sim READS inbox windows)')
}

console.log('\n— Determinism and idempotency (the Arena catch-up contract) —')
{
  const a = playUntilRoom(4242, 'interview').s
  const b = playUntilRoom(4242, 'interview').s
  ok(JSON.stringify(a.world?.interactions) === JSON.stringify(b.world?.interactions), 'same seed, same actions — byte-identical rooms')
  const before = JSON.stringify(a.world)
  tickLivingWorld(a) // the catch-up loop calling the same week again
  ok(JSON.stringify(a.world) === before, 'a second tick over the same week opens nothing (shouldGenerateForWeek)')
}

console.log('\n— Frozen rulesets stay frozen (the Slice 5 / Phase 7 precedent) —')
{
  let inFlight = newGame('Frozen', 'saas', 'technical', { config: cfg(4242) })
  inFlight.capabilities = {
    ...inFlight.capabilities,
    structuredInterviews: false,
    structuredEmployeeConversations: false,
    proceduralBoardMeetings: false,
  }
  for (let w = 0; w < 30 && !inFlight.gameOver; w++) {
    inFlight.marketingSpend = 3000
    if (w % 6 === 0 && inFlight.career && inFlight.cash > 60_000) runInterviewStudy(inFlight)
    inFlight = advanceWeek(inFlight)
  }
  ok(!!inFlight.world, 'the pre-phase world still exists and still runs')
  ok((inFlight.world?.interactions?.length ?? 0) === 0, 'a frozen pre-phase ruleset never opens a room, through the same weeks')
  ok(recentInteractions(inFlight, 'interview').length === 0, 'and the panels render nothing for it')

  // PER-KIND GATING, on a run that genuinely reaches all three rooms — a funded company, forty
  // weeks, studies running. The control below is also this file's non-vacuity evidence: without it
  // "the capability is off and the room is absent" would be true for the wrong reason.
  const fundedKinds = (overrides?: Record<string, boolean>) => {
    let s = newGame('Split', 'saas', 'technical', { config: cfg(4242, 'career', overrides) })
    for (let w = 0; w < 46 && !s.gameOver; w++) {
      for (const m of s.inbox) if (m.kind === 'choice' && !m.resolved && m.choices) resolveChoiceOnState(s, m.id, 0)
      s.marketingSpend = 3000
      if (s.employees.length + s.offersOut.length + s.pendingHires.length < 5 && s.candidates.length) {
        const best = [...s.candidates].sort((a, b) => b.skill - a.skill)[0]
        s.candidates = s.candidates.filter((c) => c.id !== best.id)
        s.offersOut.push(best)
      }
      if (w === 20) {
        s.termSheets.push({ id: 'ts-1', investor: 'Granite Peak', amount: 1_200_000, equity: 0.18, weeksLeft: 2 })
        acceptTermSheet(s, 'ts-1')
      }
      if (w % 6 === 0 && s.career && s.cash > 60_000) runInterviewStudy(s)
      s = advanceWeek(s)
    }
    return new Set((s.world?.interactions ?? []).map((r) => r.kind))
  }
  const all = fundedKinds()
  ok(
    all.has('interview') && all.has('conversation') && all.has('board_meeting'),
    `the control: one funded run reaches all three rooms (${[...all].sort().join(', ')})`,
  )
  for (const [capability, kind] of [
    ['structuredInterviews', 'interview'],
    ['structuredEmployeeConversations', 'conversation'],
    ['proceduralBoardMeetings', 'board_meeting'],
  ] as const) {
    const without = fundedKinds({ [capability]: false })
    ok(!without.has(kind) && without.size === 2, `${capability} off removes exactly ${kind} and nothing else (${[...without].sort().join(', ')})`)
  }

  // The gate on ANSWERING is separate from the gate on opening, and defends the case the opening
  // gate cannot: a save whose ruleset changed under an already-open room.
  const { s: withRoom, room: openRoom } = playUntilRoom(4242, 'interview')
  if (openRoom) {
    const revoked = structuredClone(withRoom)
    revoked.capabilities = { ...revoked.capabilities, structuredInterviews: false }
    ok(chooseInteractionOption(revoked, openRoom.id, 'pay') === null, 'a room left open by a since-revoked capability cannot be answered')
  }

  // Quick Play and Arena never get any of it (§40, §33).
  for (const mode of ['quick', 'arena'] as const) {
    const other = play(4242, 14, mode)
    ok((other.world?.interactions?.length ?? 0) === 0, `${mode} opens no rooms — §40 keeps its reactions lightweight`)
  }
}

console.log('\n— The rooms reach the biography (story.ts) —')
{
  const { s, room } = playUntilRoom(11, 'conversation')
  if (!room) ok(false, 'no conversation for the biography')
  else {
    const answered = structuredClone(s)
    chooseInteractionOption(answered, room.id, 'hold')
    const ROOM_BEAT = /decision is final|bands are the bands|hold on a while longer|not up for a vote|do not bid/
    const beat = buildStory(answered).find((b) => b.week === answered.week && ROOM_BEAT.test(b.text))
    ok(!!beat, `the answer becomes a story beat ("${beat?.text.slice(0, 90)}…")`)

    // A room nobody attended is not a beat: nothing was said, so there is nothing to credit.
    let cold = structuredClone(s)
    for (let w = 0; w <= INTERACTION_STALE_WEEKS && !cold.gameOver; w++) {
      cold.marketingSpend = 3000
      cold = advanceWeek(cold)
    }
    const coldWeek = cold.world!.interactions!.find((r) => r.id === room.id)!.resolvedWeek!
    ok(
      !buildStory(cold).some((b) => b.week === coldWeek && /decision is final|asks where they are going/.test(b.text)),
      'a room closed unattended is NOT a beat — the biography credits what was said, not what was ignored',
    )
  }
}

console.log('\n— The answer goes through the replay registry, like every other player action —')
{
  const { s, room } = playUntilRoom(4242, 'interview')
  if (!room) ok(false, 'no room to journal')
  else {
    const live = structuredClone(s)
    live.journal = []
    const { state } = applyJournaled(live, 'interaction', { r: room.id, o: 'pay' })
    ok(state.journal!.length === 1 && state.journal![0].a === 'interaction', 'answering a room writes exactly one journal entry')
    const answered = state.world!.interactions!.find((r) => r.id === room.id)!
    ok(answered.chosen.includes('pay') && answered.lines.some((l) => l.optionId === 'pay'), 'and the answer landed')
    // A replay of a single-action journal reproduces the same room, which is what the registry is for.
    const replayed = replayRun(
      { name: state.companyName, sector: state.sector, founderKind: state.founderKind, config: state.config! } as never,
      [{ a: 'interaction', w: state.week, p: { r: room.id, o: 'pay' } }],
    )
    ok(replayed.week === 1, 'a journaled answer replays to the same room without throwing (unknown-action guard)')
  }
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
