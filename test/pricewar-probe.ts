// Is the price war a decision, or a mutual death spiral? Mutual-damage mechanics are where
// degenerate lock-ins hide, so this simulates two founders under every combination of policy.
import { advanceWeek, newGame, concedePriceWar, canConcedePriceWar } from '../src/game/engine'
import { PRICE_WAR_WEEKS, PRICE_WAR_COOLDOWN } from '../src/game/pvp'

const mk = (seed: number, name: string) =>
  newGame(name, 'saas', 'technical', { config: { mode: 'arena', format: 'standard', sector: 'saas', seed } as never })

/** Run both founders 60 weeks. `policy` decides what the TARGET does when a war starts. */
function duel(seed: number, policy: 'endure' | 'concede', warEvery: number) {
  let a = mk(seed, 'Aggressor')
  let b = mk(seed + 1, 'Target')
  let concedes = 0
  let warWeeks = 0
  for (let w = 0; w < 60 && !a.gameOver && !b.gameOver; w++) {
    a.marketingSpend = 3500
    b.marketingSpend = 3500
    // aggressor re-declares whenever it can
    if (w > 4 && w % warEvery === 0 && (a.flags.priceWar ?? 0) === 0 && (a.flags.priceWarCooldown ?? 0) === 0) {
      a.flags.priceWar = PRICE_WAR_WEEKS
      a.flags.priceWarInitiator = 1
      a.flags.priceWarCooldown = PRICE_WAR_WEEKS + PRICE_WAR_COOLDOWN
      b.flags.priceWar = PRICE_WAR_WEEKS
      delete b.flags.priceWarInitiator
    }
    if (policy === 'concede' && canConcedePriceWar(b).ok) {
      concedePriceWar(b)
      concedes++
    }
    if ((a.flags.priceWar ?? 0) > 0) warWeeks++
    if ((a.flags.priceWarCooldown ?? 0) > 0) a.flags.priceWarCooldown -= 1
    a = advanceWeek(a)
    b = advanceWeek(b)
  }
  return { aRev: Math.round(a.lastRevenue), bRev: Math.round(b.lastRevenue), aUsers: a.users, bUsers: b.users,
           aDead: !!a.gameOver, bDead: !!b.gameOver, concedes, warWeeks }
}

console.log('Price war over 60 weeks, aggressor re-declares as soon as the cooldown allows.\n')
for (const warEvery of [PRICE_WAR_WEEKS, 12]) {
  for (const policy of ['endure', 'concede'] as const) {
    let aWins = 0, bWins = 0, bothDead = 0, aDeadN = 0, bDeadN = 0, totalWarWeeks = 0
    for (let seed = 1; seed <= 12; seed++) {
      const r = duel(seed, policy, warEvery)
      totalWarWeeks += r.warWeeks
      if (r.aDead && r.bDead) bothDead++
      else if (r.aDead) { aDeadN++; bWins++ }
      else if (r.bDead) { bDeadN++; aWins++ }
      else if (r.aUsers > r.bUsers) aWins++
      else bWins++
    }
    console.log(
      `  re-declare every ${warEvery} wk · target ${policy.padEnd(8)} → aggressor wins ${aWins}/12, target wins ${bWins}/12, ` +
        `both dead ${bothDead}, war active ${(100 * totalWarWeeks / (12 * 60)).toFixed(0)}% of weeks`,
    )
  }
}
