// Dev fixture: produce finished runs (verified / desync / legacy) as founder-mode-save payloads
// so the results screen's replay badge can be exercised without playing 104 weeks by hand.
// Run: npx tsx scripts/make-verify-fixture.ts > /tmp/fixtures.json
import { applyJournaled, verifyRun, type JournalPayload, type ReplayActionName } from '../src/game/replay'
import { newGame } from '../src/game/engine'
import { resolveGameRules, type GameConfig } from '../src/game/modes'
import type { GameState } from '../src/game/types'

function playDaily(seed: number): GameState {
  const config: GameConfig = { mode: 'quick', format: 'daily_challenge', sector: 'saas', seed }
  const rules = resolveGameRules(config)
  let s = newGame('Proof Co', 'saas', 'technical', {
    config,
    challenge: { label: 'Daily #999', cap: rules.maxTurns ?? 104 },
    scenario: config.scenario,
  })
  s.journal = []
  const act = (a: ReplayActionName, p?: JournalPayload) => {
    s = applyJournaled(s, a, p).state
  }
  for (let w = 0; w < 120 && !s.gameOver; w++) {
    const ids = s.inbox.filter((m) => m.kind === 'choice' && !m.resolved && m.choices).map((m) => m.id)
    for (const id of ids) {
      const i = s.inbox.findIndex((m) => m.id === id)
      if (i >= 0) act('resolve_choice', { i, c: 0 })
    }
    if (s.gameOver) break
    if (w === 2) act('marketing', { v: 3_000 })
    if (w === 4 && s.raiseCooldown === 0) act('pitch')
    if (s.termSheets.length > 0) act('accept_sheet', { i: 0 })
    if (w === 6 && s.candidates.length > 0) act('send_offer', { i: 0 })
    act('advance')
  }
  return s
}

const verified = playDaily(424242)
const desync = structuredClone(verified)
desync.gameOver!.payout = (desync.gameOver!.payout ?? 0) + 5_000_000
const legacy = structuredClone(verified)
delete legacy.journal

const wrap = (g: GameState) => JSON.stringify({ state: { game: g, screen: 'dashboard', onlineResume: null }, version: 9 })
console.log(
  JSON.stringify({
    verdicts: { verified: verifyRun(verified).state, desync: verifyRun(desync).state, legacy: verifyRun(legacy).state },
    ending: verified.gameOver,
    saves: { verified: wrap(verified), desync: wrap(desync), legacy: wrap(legacy) },
  }),
)
