// Replay verification (src/game/replay.ts). Run: npx tsx test/replay.test.ts
//
// The property under test is the HONESTY RULE: a run verifies if and only if its journal really
// reproduces its end state. Every assertion below names the mutant it kills — each was checked
// red under its mutation before the fix/feature made it green (ledger in the commit message).
//
// The scripted players here perform actions exactly the way src/store.ts does: guards first,
// then `applyJournaled(state, action, payload)`. There is no second recording mechanism to test
// against — that is the point of the registry design.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  JOURNAL_LIMIT,
  REPLAY_ACTION_NAMES,
  applyJournaled,
  replayRun,
  headerOf,
  sanitizeJournal,
  stateFingerprint,
  verifyRun,
  type JournalEntry,
  type JournalPayload,
  type ReplayActionName,
} from '../src/game/replay'
import { newGame } from '../src/game/engine'
import { resolveGameRules, type GameConfig } from '../src/game/modes'
import { canRunExperiment } from '../src/game/career/pmf'
import type { GameState, SectorId } from '../src/game/types'

const fails: string[] = []
const ok = (cond: boolean, msg: string) => {
  if (!cond) fails.push(msg)
  else console.log('  ✓', msg)
}

// ---------- scripted players (the store's calling convention, exactly) ----------

function startRun(mode: 'quick' | 'career', format: 'standard' | 'daily_challenge', seed: number, sector: SectorId = 'saas'): GameState {
  const config: GameConfig = { mode, format, sector, seed }
  const rules = resolveGameRules(config)
  const g = newGame('Replay Co', sector, 'technical', {
    config,
    challenge: rules.maxTurns ? { label: format === 'daily_challenge' ? 'Daily #99' : 'Capped run', cap: rules.maxTurns } : null,
    scenario: config.scenario,
  })
  g.journal = [] // what store.startGame does
  return g
}

/** Resolve open choices by inbox INDEX, like the store does — ids are not replay-stable. */
function resolveAllChoices(s: GameState, act: (a: ReplayActionName, p?: JournalPayload) => void) {
  const ids = s.inbox.filter((m) => m.kind === 'choice' && !m.resolved && m.choices).map((m) => m.id)
  for (const id of ids) {
    const i = s.inbox.findIndex((m) => m.id === id)
    if (i >= 0) act('resolve_choice', { i, c: 0 })
  }
}

function playQuick(seed: number, weeks = 60, format: 'standard' | 'daily_challenge' = 'standard'): GameState {
  let s = startRun('quick', format, seed)
  const act = (a: ReplayActionName, p?: JournalPayload) => {
    s = applyJournaled(s, a, p).state
  }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    resolveAllChoices(s, act)
    if (s.gameOver) break // a resolved acquisition offer can end the run mid-turn
    if (w === 2) {
      act('allocation', { k: 'features', v: 55 })
      act('allocation', { k: 'research', v: 25 })
      act('marketing', { v: 4_000 })
    }
    if (w === 4 && s.raiseCooldown === 0) act('pitch')
    if (s.termSheets.length > 0) act('accept_sheet', { i: 0 })
    if (w === 5 && s.candidates.length > 0) act('send_offer', { i: 0 })
    if (w === 9 && s.employees.length > 0) act('raise', { i: 0 })
    if (w === 11 && s.employees.length > 1) act('fire', { i: 1 })
    if (w === 13) act('pivot')
    if (w === 15) act('take_debt', { n: 100_000 })
    if (w === 21 && s.debt) act('pay_debt', { n: 30_000 })
    if (w === 23 && s.vacationCooldown === 0) act('recharge')
    if (w === 26 && s.pitchCooldown === 0 && s.employees.length > 0) act('rally', { v: 'numbers' })
    if (w === 31 && s.rivals.length > 0) act('buy_rival', { i: 0, m: 'cash' }) // usually refused — still journaled, still replayed
    act('advance')
  }
  return s
}

function playCareer(seed: number, weeks = 90): GameState {
  let s = startRun('career', 'standard', seed)
  const act = (a: ReplayActionName, p?: JournalPayload) => {
    s = applyJournaled(s, a, p).state
  }
  for (let w = 0; w < weeks && !s.gameOver; w++) {
    resolveAllChoices(s, act)
    if (s.gameOver) break
    const c = s.career!
    if (w === 1) {
      act('pricing', { v: 'premium' })
      act('focus', { v: c.focus === 'reliability' ? 'simplicity' : 'reliability' })
      act('allocation', { k: 'quality', v: 40 })
      act('marketing', { v: 3_000 })
    }
    if (w === 4 && canRunExperiment(c, 'interview', c.primaryTargetSegmentId, s.cash).ok)
      act('run_experiment', { t: 'interview', s: c.primaryTargetSegmentId, st: false })
    if (w === 8 && c.activeExperiments.length > 0) act('experiment_standing', { i: 0, st: true })
    if (w === 20) {
      const other = Object.keys(c.segmentBeliefs).find((id) => id !== c.primaryTargetSegmentId)
      if (other) act('target_segment', { s: other })
    }
    if (w === 6 && s.raiseCooldown === 0) act('pitch')
    if (s.termSheets.length > 0) act('accept_sheet', { i: 0 })
    if (w === 10 && s.candidates.length > 0) act('send_offer', { i: 0 })
    act('advance')
  }
  return s
}

// ---------- 1. full runs replay to an identical fingerprint, across modes ----------

console.log('— Journaled runs verify (quick, quick daily, career) —')
const quick = playQuick(101)
ok(verifyRun(quick).state === 'verified', `quick 60wk run verifies (fp 0x${stateFingerprint(quick).toString(16)}, ${quick.journal?.length ?? 0} entries)`)

const daily = playQuick(303, 120, 'daily_challenge') // runs into the 104-week cap → a finished, scored run
ok(!!daily.gameOver, 'daily run reached an ending (needed for the tamper tests below)')
ok(verifyRun(daily).state === 'verified', `finished daily run verifies (${daily.journal?.length ?? 0} entries)`)

const career = playCareer(202)
const careerJournalBytes = JSON.stringify(career.journal ?? []).length
ok(verifyRun(career).state === 'verified', `career 90wk run verifies (${career.journal?.length ?? 0} entries, ${careerJournalBytes} bytes of JSON)`)

// KILLS: any registry function drifting from the store path, a missing journal write, a
// replay-side reseed difference. Determinism itself:
ok(
  stateFingerprint(replayRun(headerOf(quick), quick.journal!)) === stateFingerprint(replayRun(headerOf(quick), quick.journal!)),
  'replayRun is deterministic: same journal, same fingerprint, twice',
)

// ---------- 2. the journal survives persistence ----------

console.log('— JSON round-trip (the save path) —')
const thawed = JSON.parse(JSON.stringify(daily)) as GameState
ok(stateFingerprint(thawed) === stateFingerprint(daily), 'fingerprint survives a JSON round-trip (full-precision doubles)')
ok(verifyRun(thawed).state === 'verified', 'a save loaded back from JSON still verifies')
// KILLS: any non-JSON-safe payload (object snapshot, Infinity, undefined-bearing entry).

// ---------- 3. tampering fails, and fails as DESYNC, not as absence ----------

console.log('— Tampered score / tampered journal —')
{
  const t = structuredClone(daily)
  t.gameOver!.payout = (t.gameOver!.payout ?? 0) + 1_000_000
  ok(verifyRun(t).state === 'unverifiable_desync', 'a fabricated payout is unverifiable_desync')
}
{
  const t = structuredClone(quick)
  t.cash += 500_000
  ok(verifyRun(t).state === 'unverifiable_desync', 'edited cash on an in-flight save is unverifiable_desync')
}
{
  const t = structuredClone(daily)
  const i = t.journal!.findIndex((e) => e.a === 'allocation')
  t.journal![i] = { ...t.journal![i], p: { k: 'features', v: 5 } } // same action, different slider value
  ok(i >= 0 && verifyRun(t).state === 'unverifiable_desync', 'a tampered journal payload is unverifiable_desync')
}
{
  const t = structuredClone(daily)
  t.journal = t.journal!.filter((_, i) => i !== t.journal!.length - 1) // drop the last advance
  ok(verifyRun(t).state === 'unverifiable_desync', 'a truncated journal is unverifiable_desync')
}
{
  const t = structuredClone(daily)
  t.journal = [...t.journal!, { w: t.week, a: 'take_debt', p: { n: 1_000 } } satisfies JournalEntry]
  ok(verifyRun(t).state === 'unverifiable_desync', 'an appended journal entry is unverifiable_desync')
}
{
  const t = structuredClone(daily)
  ;(t.journal![2] as { a: string }).a = 'definitely_not_an_action'
  ok(verifyRun(t).state === 'unverifiable_desync', 'an unknown action name is unverifiable_desync, not a crash')
}
// KILLS: a fingerprint that skips payout/cash/debt; a verifier that "repairs" or drops entries;
// an executor that throws uncaught on hostile input.

// ---------- 4. absence is reported as absence ----------

console.log('— Legacy / arena / malformed journals —')
{
  const t = structuredClone(quick)
  delete t.journal
  ok(verifyRun(t).state === 'legacy_no_journal', 'a save with no journal is legacy_no_journal — never an error')
}
{
  const t = structuredClone(quick)
  ;(t as { journal?: unknown }).journal = 'garbage'
  ok(sanitizeJournal(t.journal) === undefined && verifyRun(t).state === 'legacy_no_journal', 'a malformed journal shape reads as absent')
}
{
  const t = structuredClone(quick)
  ;(t as { journal?: unknown }).journal = [{ w: 1, a: 42 }] // storage corruption, not an edited run
  ok(verifyRun(t).state === 'legacy_no_journal', 'entry-level junk reads as absent — corruption is not reported as tampering')
}
{
  const arena = newGame('A', 'saas', 'technical', { config: { mode: 'arena', format: 'standard', sector: 'saas', seed: 7 } })
  ok(verifyRun(arena).state === 'legacy_no_journal', 'an arena run is legacy_no_journal (peer inputs are not in any local log)')
}
// KILLS: conflating "nothing to check" with "checked and failed" — the two states the UI must
// never swap.

// ---------- 5. THE CANARY: an unjournaled mutation goes red ----------

console.log('— Canary: unjournaled mutation must FAIL verification —')
{
  // Simulate the bug the honesty rule exists for: a (hypothetical future) store action that
  // mutates simulation state without going through applyJournaled.
  let s = startRun('quick', 'standard', 707)
  const act = (a: ReplayActionName, p?: JournalPayload) => {
    s = applyJournaled(s, a, p).state
  }
  for (let w = 0; w < 10 && !s.gameOver; w++) act('advance')
  s = structuredClone(s)
  s.cash += 50_000 // the unjournaled mutation
  for (let w = 0; w < 10 && !s.gameOver; w++) act('advance')
  const v = verifyRun(s)
  ok(v.state === 'unverifiable_desync', 'an unjournaled cash mutation mid-run turns verification red')
  ok(v.state !== 'verified', 'and it is NEVER silently verified (the honesty rule)')
}
{
  // Variant: a legitimate engine call made OUTSIDE the registry — e.g. someone "helpfully"
  // calling pivot() directly from a new store action. Must also go red.
  let s = startRun('quick', 'standard', 808)
  const act = (a: ReplayActionName, p?: JournalPayload) => {
    s = applyJournaled(s, a, p).state
  }
  for (let w = 0; w < 8 && !s.gameOver; w++) act('advance')
  const { state } = applyJournaled(s, 'pivot')
  s = structuredClone(state)
  s.journal = s.journal!.filter((e) => e.a !== 'pivot') // same as never journaling it
  for (let w = 0; w < 8 && !s.gameOver; w++) act('advance')
  ok(verifyRun(s).state === 'unverifiable_desync', 'an unjournaled engine mutation (pivot) turns verification red')
}
// KILLS: a fingerprint too narrow to notice, a verifier comparing the journal to itself, any
// "record on read" scheme that could reconstruct unjournaled history.

// ---------- 6. discard-on-failure keeps journal and state in step ----------

console.log('— Refused actions journal nothing —')
{
  let s = startRun('quick', 'standard', 909)
  for (let w = 0; w < 3; w++) s = applyJournaled(s, 'advance').state
  const before = s.journal!.length
  const { result } = applyJournaled(s, 'tokenise') // no tokenisation capability here → refused
  ok((result as { ok?: boolean } | undefined)?.ok === false, 'tokenise without the capability is refused')
  ok(s.journal!.length === before, 'the refused action left no journal entry on the live state (clone discarded, store-style)')
  ok(verifyRun(s).state === 'verified', 'and the run still verifies')
}

// ---------- 7. slider coalescing ----------

console.log('— Slider writes coalesce —')
{
  let s = startRun('quick', 'standard', 111)
  const act = (a: ReplayActionName, p?: JournalPayload) => {
    s = applyJournaled(s, a, p).state
  }
  act('marketing', { v: 1_000 })
  act('marketing', { v: 2_000 })
  act('marketing', { v: 3_000 })
  act('allocation', { k: 'features', v: 41 })
  act('allocation', { k: 'features', v: 52 })
  act('allocation', { k: 'quality', v: 33 }) // different key: must NOT coalesce
  const j = s.journal!
  const mkt = j.find((e) => e.a === 'marketing')?.p as { v?: number } | undefined
  ok(j.filter((e) => e.a === 'marketing').length === 1 && mkt?.v === 3_000, 'three same-week marketing writes journal once, with the final value')
  ok(j.filter((e) => e.a === 'allocation').length === 2, 'allocation coalesces per key, not across keys')
  act('advance')
  act('marketing', { v: 4_000 })
  // Note: the intervening 'advance' entry already blocks cross-week coalescing on its own — the
  // `last.w === entry.w` guard in recordJournal is defense-in-depth (its removal is an
  // equivalent mutant today, and stops being one the day any action skips journaling a week).
  ok(s.journal!.filter((e) => e.a === 'marketing').length === 2, 'a new week starts a new marketing entry')
  for (let w = 0; w < 5 && !s.gameOver; w++) act('advance')
  ok(verifyRun(s).state === 'verified', 'the coalesced journal still replays exactly')
}
// KILLS: coalescing across weeks, across keys, or across different actions — each would replay
// to a different state.

// ---------- 8. overflow degrades honestly ----------

console.log('— Overflow —')
{
  let s = startRun('quick', 'standard', 121)
  s.journal = Array.from({ length: JOURNAL_LIMIT }, () => ({ w: 1, a: 'pivot' as const }))
  s = applyJournaled(s, 'advance').state
  ok(s.journal === undefined, `past ${JOURNAL_LIMIT} entries the journal is dropped, not truncated`)
  ok(verifyRun(s).state === 'legacy_no_journal', 'an overflowed run reads as unverifiable, never as tampered')
}

// ---------- 9. the action surface is locked, and the store cannot bypass it ----------

console.log('— Action-surface ledger —')
const EXPECTED_ACTIONS = [
  'accept_sheet', 'advance', 'ai_cancel', 'ai_start', 'allocation', 'attention_allocate', 'attention_focus', 'bet_abandon', 'bet_choose',
  'buy_rival', 'concede_price_war', 'counter_sheet', 'decline_sheet', 'v2_position', 'v2_price', 'v2_research',
  // `counter_sheet` — negotiations (2026-08-24): the push-back draws from the stream and can
  // re-price or remove a sheet, so it must replay; career-guarded inside counterTermSheet.
  // `v2_price` / `v2_position` — V2 close-out (2026-08-24): the price dial and the positioning
  // declaration both move the market resolution, so they replay; gate-guarded like v2_research.
  // `v2_research` — Business Simulation V2 phase 4 (2026-08-24): a study bills cash now and
  // narrows knowledge later, so it must replay; gate-guarded to V2 runs in the handler.
  // `ai_start` / `ai_cancel` — Strategic Systems phase 5 (2026-08-24): an AI rollout spends cash,
  // draws engineering output and permanently changes area maturity/quality — simulation-mutating,
  // so it replays. Depth-guarded in startAIInitiative (quick/arena: aiAdoption off).
  'defy_mandate', 'experiment_standing', 'file_ipo', 'fire', 'focus', 'growth_mix', 'incentives', 'interaction',
  'marketing', 'pay_debt', 'pitch', 'pivot', 'pricing', 'proposal_stance', 'raise', 'rally', 'recharge',
  'resolve_choice', 'roadmap_cancel', 'roadmap_start', 'run_experiment', 'secondary', 'sell_founder',
  'sell_treasury', 'send_offer', 'shelve_bet', 'start_bet', 'take_debt', 'target_segment', 'tokenise',
  // `attention_focus` / `attention_allocate` — Strategic Systems phase 4 (2026-08-23): founder
  // attention multiplies build/churn/bugs/morale/research/candidates/valuations, so where the
  // founder spends the week is simulation-mutating and must replay. Both are depth-guarded in
  // the handler (arena = off), so an arena journal cannot smuggle the effect in.
  // `roadmap_start` / `roadmap_cancel` — Strategic Systems Expansion phase 1 (2026-08-23): the
  // roadmap mutates simulation state (slots, progress, debt, completion effects), so both go
  // through the registry like every other player action. Depth resolves from the run's config.
  // Two actions joined the surface in the same batch, from parallel worktrees:
  // `interaction` is Living World Phase 8's structured rooms — an answer given in a room can open a
  // promise, which settles from simulation facts, so the answer is simulation-mutating.
  // `sell_founder` is ICO Slice 7's §42 founder secondary. It moves `bankedPayout`, so it is a
  // simulation-mutating action and must be journalled, or a token run's score stops replaying.
].sort()
ok(
  JSON.stringify([...REPLAY_ACTION_NAMES].sort()) === JSON.stringify(EXPECTED_ACTIONS),
  `the registry is exactly the ${EXPECTED_ACTIONS.length} enumerated actions — adding or removing one is a decision, made here`,
)

// Comments stripped: the store's docs may still NAME an engine function ("see setTokenIncentives
// in engine.ts") — what must not survive is a CALL, which needs the bare identifier in code.
const storeSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/store.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/[^:'"]\/\/[^'"]*$/gm, '')
for (const name of REPLAY_ACTION_NAMES.filter((n) => n !== 'advance'))
  ok(storeSrc.includes(`'${name}'`), `store dispatches '${name}' through the journal`)
ok(/applyJournaled\((game|g), 'advance'\)/.test(storeSrc), "store dispatches 'advance' through the journal (solo path)")
ok(/g\.journal = \[\]/.test(storeSrc), 'startGame turns journaling on — without this every run reads as legacy')

// The store must be UNABLE to inline these mutations: if it does not import them, it cannot
// call them, and the registry stays the only path. (advanceWeek is exempt — the arena catch-up
// path still uses it, and arena runs never journal.)
for (const fn of [
  'pitchInvestors', 'acceptTermSheet', 'resolveChoiceOnState', 'tokeniseCompany', 'drawDebt',
  'repayDebt', 'sellSecondary', 'takeVacation', 'startVenture', 'killVenture', 'acquireRival',
  'startIPO', 'pitchTeam', 'sellTokenTreasury', 'setGovernanceStance', 'defyGovernance',
  'setTokenIncentives', 'applyEffects', 'startExperiment', 'repositionTo', 'chooseInteractionOption',
])
  ok(!new RegExp(`\\b${fn}\\b`).test(storeSrc), `store no longer touches ${fn} directly`)
// KILLS: quietly re-inlining a mutation in the store — the exact bug class the canary would
// then catch at runtime; this catches it in review.

// ---------- 10. the local proof (daily submissions) ----------

console.log('— Local replay proof —')
{
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }
  const { recordReplayProof, storedReplayProofs } = await import('../src/net/replayProof')
  const proof = recordReplayProof(daily, 99)
  ok(proof.state === 'verified' && proof.journal !== null, 'a finished daily run stores a VERIFIED proof with its journal')
  ok(proof.fingerprint === stateFingerprint(daily), "the proof's fingerprint is the submitted end state's")
  ok(storedReplayProofs()[0]?.day === 99, 'the proof is retrievable from local storage')
  delete (globalThis as { localStorage?: unknown }).localStorage
}

console.log(fails.length === 0 ? '\nALL PASS' : `\nFAILURES:\n${fails.map((f) => '  ✗ ' + f).join('\n')}`)
process.exit(fails.length === 0 ? 0 : 1)
