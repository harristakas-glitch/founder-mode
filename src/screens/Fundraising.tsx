import { useState } from 'react'
import { Bar, Btn, Panel, StatCard } from '../components'
import { money, pct } from '../format'
import { STAGE_THRESHOLDS, climateLabel } from '../game/data'
import {
  boardEffectiveTarget,
  canSellSecondary,
  growthRate,
  ipoChecklist,
  ipoEligible,
  ipoVisible,
  nextStage,
  revenueGrowthRate,
  secondaryProceeds,
  valuation,
} from '../game/engine'
import { SUITABILITY_LABEL, runSectorSuitability, tokenisationEligibility } from '../game/token/eligibility'
import {
  INCENTIVE_CATEGORIES,
  INCENTIVE_LABELS,
  incentivePanel,
  incentivesActive,
} from '../game/token/incentives'
import {
  allocationBounds,
  allocationFrom,
  defaultAllocation,
  defaultUtilityModel,
  resolveLaunchTerms,
  utilityModelFit,
  type LaunchDraft,
} from '../game/token/launch'
import { treasuryValue } from '../game/token/market'
import { maxTreasurySale, treasurySaleQuote, treasurySalesActive } from '../game/token/treasury'
import type { TokenUtilityModel, VestingPolicy } from '../game/token/types'
import type { GameState } from '../game/types'
import { FORK_WARNINGS, institutionalRoundsClosed, ipoClosed } from '../game/token/restrictions'
import { isTokenised, tokenisationOffered } from '../game/token/state'
import { networkValue } from '../game/token/scoring'
import { useStore } from '../store'

function SecondaryPanel() {
  const game = useStore((s) => s.game)!
  const doSecondary = useStore((s) => s.doSecondary)
  const gate = canSellSecondary(game)
  // don't clutter the early game — the option surfaces once it's within reach
  if (!gate.ok && !gate.reason?.startsWith('Already')) {
    if (game.stage === 'Pre-seed' || game.stage === 'Seed') return null
  }
  return (
    <div className="mt-3.5">
      <Panel title="Secondary sale — take money off the table">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] leading-relaxed text-mut">
            Sell <b className="text-ink">2% of your personal stake</b> at a 30% discount —{' '}
            <b className="text-ink tnum">{money(secondaryProceeds(game))}</b> banked for you, no matter how the company ends. Costs a
            little reputation and team goodwill; buys a founder who sleeps. Once per funding stage, from Series B.
            {game.bankedPayout > 0 && (
              <span className="text-good"> Banked so far: {money(game.bankedPayout)}.</span>
            )}
          </div>
          {gate.ok ? (
            <Btn variant="primary" onClick={doSecondary}>
              Sell 2% for {money(secondaryProceeds(game))}
            </Btn>
          ) : (
            <span className="text-xs text-mut">{gate.reason}</span>
          )}
        </div>
      </Panel>
    </div>
  )
}

const tokenPrice = (p: number) => (p >= 0.01 ? `$${p.toFixed(4)}` : `$${p.toExponential(2)}`)

const VESTING_LABEL: Record<VestingPolicy, string> = { short: 'Short · 4wk cliff, 26wk', standard: 'Standard · 12wk cliff, 52wk', long: 'Long · 26wk cliff, 104wk' }
const UTILITY_LABEL: Record<TokenUtilityModel, string> = {
  product_access: 'Product access',
  rewards: 'Rewards',
  governance: 'Governance',
  marketplace_currency: 'Marketplace currency',
  ecosystem_incentive: 'Ecosystem incentive',
}
const UTILITY_MODELS: TokenUtilityModel[] = ['product_access', 'rewards', 'governance', 'marketplace_currency', 'ecosystem_incentive']

/** ICO brief §20–§24. The whole tokenomics screen, and deliberately one screen's worth: five
 *  decisions, two of them sliders inside a band the community sets. §20 says keep it simple and
 *  warns twice against crypto-financial engineering, so there is no emission curve, no bonding
 *  curve and no per-round unlock table — the vesting policy is three buttons. */
function TokenomicsSetup({
  game,
  draft,
  setDraft,
}: {
  game: GameState
  draft: LaunchDraft
  setDraft: (d: LaunchDraft) => void
}) {
  const bounds = allocationBounds(game)
  const alloc = draft.allocation ?? defaultAllocation(game)
  const terms = resolveLaunchTerms(game, draft)
  const excess = terms.reaction.founderExcess
  const setAlloc = (founder: number, community: number) => setDraft({ ...draft, allocation: allocationFrom(game, founder, community) })

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface2 p-3.5">
      <div className="text-[13px] font-bold">Tokenomics — five decisions, and you make them once.</div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between text-[13px]">
            <span>Your allocation</span>
            <b className="tnum">{pct(alloc.founder, 1)}</b>
          </div>
          <input
            type="range"
            min={Math.round(bounds.founderMin * 1000)}
            max={Math.round(bounds.founderMax * 1000)}
            step={5}
            value={Math.round(alloc.founder * 1000)}
            style={{ ['--fill' as string]: `${((alloc.founder - bounds.founderMin) / Math.max(0.001, bounds.founderMax - bounds.founderMin)) * 100}%` }}
            onChange={(e) => setAlloc(Number(e.target.value) / 1000, alloc.community)}
          />
          <div className="text-[11px] text-mut">
            This community expects about {pct(bounds.expectedFounder, 0)} from a company at your stage.{' '}
            {excess > 0.005
              ? `You are asking for ${(excess * 100).toFixed(1)} points more — trust down, sell-pressure fears up.`
              : excess < -0.005
                ? `You are leaving ${(-excess * 100).toFixed(1)} points on the table — credibility bought with upside.`
                : 'Exactly what they expect.'}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-[13px]">
            <span>Community allocation</span>
            <b className="tnum">{pct(alloc.community, 1)}</b>
          </div>
          <input
            type="range"
            min={Math.round(bounds.communityMin * 1000)}
            max={Math.round(bounds.communityMax * 1000)}
            step={5}
            value={Math.round(alloc.community * 1000)}
            style={{ ['--fill' as string]: `${((alloc.community - bounds.communityMin) / Math.max(0.001, bounds.communityMax - bounds.communityMin)) * 100}%` }}
            onChange={(e) => setAlloc(alloc.founder, Number(e.target.value) / 1000)}
          />
          <div className="text-[11px] text-mut">
            Sold and distributed into the float on day one. Whatever is left after team ({pct(bounds.team, 0)}) and partners (
            {pct(bounds.partners, 0)}) is your <b className="text-ink">treasury: {pct(alloc.treasury, 1)}</b> — the only budget every
            incentive programme you ever run is paid from.
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[13px]">Vesting — yours, the team's and the partners'</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(['short', 'standard', 'long'] as VestingPolicy[]).map((v) => (
              <Btn key={v} variant={(draft.vesting ?? 'standard') === v ? 'primary' : undefined} onClick={() => setDraft({ ...draft, vesting: v })}>
                {VESTING_LABEL[v]}
              </Btn>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-mut">
            Short is flexibility the community reads as an exit plan; long is credibility you cannot spend. Every unlocked token lands in
            the float and pushes the price down, so a short schedule dilutes your own position on the way out.
          </div>
        </div>

        <div>
          <div className="text-[13px]">Primary token utility</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {UTILITY_MODELS.map((m) => (
              <Btn
                key={m}
                variant={(draft.utilityModel ?? defaultUtilityModel(game)) === m ? 'primary' : undefined}
                onClick={() => setDraft({ ...draft, utilityModel: m })}
              >
                {UTILITY_LABEL[m]}
                {utilityModelFit(game, m) >= 1 ? ' ✓' : ''}
              </Btn>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-mut">
            One model, chosen now and never again. It multiplies how much of your product's real activity the token is actually in — a
            marketplace currency in a company with no marketplace never becomes useful, however good the product gets. ✓ marks the model
            your sector supports best ({(terms.utilityFit * 100).toFixed(0)}% fit on your current choice).
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 border-t border-line pt-3 sm:grid-cols-4">
        <div>
          <div className="text-[11px] text-mut">Your tokens</div>
          <b className="tnum">{terms.founderTokens.toLocaleString()}</b>
        </div>
        <div>
          <div className="text-[11px] text-mut">Treasury</div>
          <b className="tnum">{pct(alloc.treasury, 0)} of supply</b>
        </div>
        <div>
          <div className="text-[11px] text-mut">Launch-day trust</div>
          <b className="tnum">{terms.reaction.trust.toFixed(0)}/100</b>
        </div>
        <div>
          <div className="text-[11px] text-mut">Launch-day speculation</div>
          <b className="tnum">{terms.speculation.toFixed(0)}/100</b>
        </div>
      </div>
    </div>
  )
}

/** ICO brief §6 and §30. The token path's fundraising: sell treasury tokens for company cash.
 *  Without this the fork closes every route to capital and opens none. */
function TreasurySalePanel() {
  const game = useStore((s) => s.game)!
  const sellTreasury = useStore((s) => s.sellTreasury)
  const [size, setSize] = useState(0.5)
  if (!treasurySalesActive(game)) return null
  const max = maxTreasurySale(game)
  const quote = treasurySaleQuote(game, Math.round(max * size))
  const t = game.token!

  return (
    <div className="mt-3.5">
      <Panel title="Treasury sale — the round you can still raise">
        {max <= 0 ? (
          <div className="text-[13px] text-mut">
            {quote.reason ?? 'Nothing to sell.'} A market this thin cannot absorb size at any price — deepen it with liquidity
            incentives, or wait for the community to grow.
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between text-[13px]">
              <span>Sell {Math.round(quote.tokens).toLocaleString()} tokens</span>
              <b className="tnum">{pct(quote.tokens / Math.max(1, t.supply.circulating), 1)} of the float</b>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(size * 100)}
              style={{ ['--fill' as string]: `${size * 100}%` }}
              onChange={(e) => setSize(Number(e.target.value) / 100)}
            />
            <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
              <div>
                <div className="text-[11px] text-mut">You receive</div>
                <b className="tnum text-good">{money(quote.proceeds)}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">At the screen price</div>
                <b className="tnum text-mut">{money(quote.grossDollars)}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Price impact</div>
                <b className="tnum text-warn">−{pct(quote.priceImpact, 0)}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Trust cost</div>
                <b className="tnum text-warn">−{quote.trustCost.toFixed(0)} pts</b>
              </div>
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-mut">
              You do not sell at the screen price — you walk the book down and realise the average. A deeper market costs you less,
              which is the second thing liquidity incentives buy. The tokens stay in the float afterwards, so every remaining token is
              worth slightly less of the same network, and your weekly incentive budget falls by{' '}
              <b className="text-ink tnum">{Math.round(quote.weeklyBudgetLost).toLocaleString()}</b> tokens permanently. Selling again
              soon costs roughly double the trust.
              {t.treasurySales.tokensSold > 0 && (
                <span className="text-ink">
                  {' '}
                  Raised so far: {money(t.treasurySales.proceeds)} across {t.treasurySales.tokensSold.toLocaleString()} tokens.
                </span>
              )}
            </div>
            <Btn variant="primary" className="mt-3" disabled={!quote.ok} onClick={() => sellTreasury(quote.tokens)}>
              Sell for {money(quote.proceeds)}
            </Btn>
          </>
        )}
      </Panel>
    </div>
  )
}

/** ICO brief §13–§19. Six categories, one weekly budget, shares of it. §13: "Do not create
 *  micro-management. Use broad allocations." */
function IncentivePanel() {
  const game = useStore((s) => s.game)!
  const setIncentives = useStore((s) => s.setIncentives)
  if (!incentivesActive(game)) return null
  const panel = incentivePanel(game)
  const t = game.token!
  const committed = INCENTIVE_CATEGORIES.reduce((a, c) => a + panel.shares[c], 0)

  return (
    <div className="mt-3.5">
      <Panel title="Treasury programmes — what the tokens are for">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 text-[13px]">
          <span>
            <span className="text-mut">Treasury:</span> <b className="tnum">{panel.treasuryTokens.toLocaleString()}</b>{' '}
            <span className="text-mut">tokens ({money(treasuryValue(game))})</span>
          </span>
          <span>
            <span className="text-mut">Weekly budget (2% cap):</span>{' '}
            <b className="tnum">{Math.round(panel.weeklyCapTokens).toLocaleString()}</b>{' '}
            <span className="text-mut">tokens · {money(panel.weeklyCapTokens * t.market.price)}</span>
          </span>
          <span>
            <span className="text-mut">Committed:</span> <b className="tnum">{pct(committed, 0)}</b>
          </span>
          {panel.weeksLeft < 400 && (
            <span>
              <span className="text-mut">At this rate the treasury is spent in</span> <b className="tnum">~{panel.weeksLeft} weeks</b>
            </span>
          )}
        </div>

        <div className="mt-3 grid gap-3">
          {INCENTIVE_CATEGORIES.map((c) => {
            const share = panel.shares[c]
            const spend = panel.spend.byCategory[c]
            const label = INCENTIVE_LABELS[c]
            return (
              <div key={c} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="font-bold">{label.name}</span>
                  <span className="tnum text-mut">
                    {pct(share, 0)}
                    {spend.tokens > 0 && <> · {money(spend.dollars)}/wk</>}
                    {spend.stock > 0 && <> · running at {pct(spend.stock, 0)}</>}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(share * 100)}
                  style={{ ['--fill' as string]: `${share * 100}%` }}
                  onChange={(e) => setIncentives({ [c]: Number(e.target.value) / 100 })}
                />
                <div className="text-[11px] leading-relaxed text-mut">
                  {label.effect} <span className="text-warn">{label.risk}</span>
                  {c === 'employee_compensation' && panel.comp.payroll > 0 && (
                    <>
                      {' '}
                      Currently covering <b className="text-ink">{pct(panel.comp.coverage, 0)}</b> of a {money(panel.comp.payroll)}/wk
                      payroll{panel.comp.wasted > 0 && <span className="text-bad"> · {money(panel.comp.wasted)}/wk over the 40% cap and buying nothing</span>}.
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3 text-xs leading-relaxed text-mut">
          Everything here is a standing order against one weekly budget, and the budget is 2% of the treasury — in <b>tokens</b>, so a
          rising price buys more with the same allocation but never lets you spend more of it. Effects build over weeks and decay when
          you stop paying, so these are policies rather than purchases. Every token committed also reaches the float, which pushes the
          price down by slightly more than the demand it creates: spending is never free.
        </div>
      </Panel>
    </div>
  )
}

/**
 * ICO brief §1/§2/§3. The fork, and everything the player needs to judge it.
 *
 * The rules this panel exists to honour:
 *   §1  readable BLOCKERS, never the readiness score. The score drives a bar and nothing else.
 *   §2  the suitability shown is THIS RUN's, not the sector's — it moves with seed and strategy.
 *   §3  the warnings are shown before confirmation, and confirmation is a deliberate second click.
 *   §4  the word "permanent" appears before the button, not after it.
 */
function TokenisationPanel() {
  const game = useStore((s) => s.game)!
  const tokenise = useStore((s) => s.tokenise)
  const [confirming, setConfirming] = useState(false)
  // The tokenomics draft is REACT-LOCAL until the player confirms (architecture §2: "pre-launch
  // state does not exist"). There is no half-tokenised GameState to reason about.
  const [draft, setDraft] = useState<LaunchDraft>({})

  if (!tokenisationOffered(game)) return null

  // --- already forked: the state of the network, briefly. The full dashboard is a later slice. ---
  if (isTokenised(game)) {
    const t = game.token!
    return (
      <div className="mt-3.5">
        <Panel title="Community capital — this company is a token network">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <div>
              <div className="text-[11px] text-mut">Token price</div>
              <b className="tnum">{tokenPrice(t.market.price)}</b>
            </div>
            <div>
              <div className="text-[11px] text-mut">Network value</div>
              <b className="tnum">{money(networkValue(game))}</b>
            </div>
            <div>
              <div className="text-[11px] text-mut">Your allocation</div>
              <b className="tnum">{pct(t.plan.allocation.founder, 0)} of supply</b>
            </div>
            <div>
              <div className="text-[11px] text-mut">Community</div>
              <b className="tnum">{t.community.members.toLocaleString()} holders</b>
            </div>
          </div>
          <div className="mt-2.5 text-xs leading-relaxed text-mut">
            Launched week {t.launchWeek} · {t.plan.totalSupply.toLocaleString()} tokens minted at {tokenPrice(t.plan.launchPrice)}. Your
            allocation vests on the schedule that started that week — the run ends whether or not your cliff has passed. Enterprise value
            and network value are tracked separately and never added together; your standing is the equity you still own plus what your
            token position could actually be sold for.
          </div>
        </Panel>
        <TreasurySalePanel />
        <IncentivePanel />
      </div>
    )
  }

  // --- not yet forked: readiness, then the decision ---
  const elig = tokenisationEligibility(game)
  const terms = resolveLaunchTerms(game, draft)
  // §2: the suitability the player is actually facing, after seed and strategy — not the sector's
  // base disposition, which would be the "one correct answer" the brief tells us not to hardcode.
  const suitability = SUITABILITY_LABEL[runSectorSuitability(game)]

  return (
    <div className="mt-3.5">
      <Panel title="Tokenise the company — the other capital path">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] text-mut">Suitability for this company</div>
            <b>{suitability}</b>
          </div>
          <div className="min-w-[180px] flex-1">
            <div className="mb-1 text-[11px] text-mut">Readiness</div>
            <Bar value={elig.readinessScore} color={elig.eligible ? 'var(--color-good)' : 'var(--color-warn)'} />
          </div>
        </div>

        {!elig.eligible ? (
          <>
            <div className="mt-3 text-[13px] font-bold">Not ready.</div>
            <div className="mt-1 text-[13px] leading-relaxed text-mut">You still need:</div>
            <ul className="mt-1.5 grid gap-1">
              {elig.blockers.map((b) => (
                <li key={b.id} className="flex items-start gap-2 text-[13px] text-mut">
                  <span className="text-mut">•</span>
                  <span>{b.label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-xs leading-relaxed text-mut">
              Suitability is not fixed by your sector alone — the market's appetite this cycle and the strategy you have actually run
              (pricing, product focus, research, the balance of hype and reputation) all move the bar. A sector that reads badly for
              tokens can still be the right call for a particular company in a particular world.
            </div>
            <Btn variant="primary" className="mt-3" disabled>
              Tokenise — not yet
            </Btn>
          </>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              <div>
                <div className="text-[11px] text-mut">Initial sale raises</div>
                <b className="tnum">{money(terms.saleProceeds)}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Supply minted</div>
                <b className="tnum">{terms.plan.totalSupply.toLocaleString()}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Your allocation</div>
                <b className="tnum">{pct(terms.plan.allocation.founder, 0)}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Vesting</div>
                <b className="tnum">
                  {terms.cliffWeeks}wk cliff · {terms.durationWeeks}wk
                </b>
              </div>
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-mut">
              Supply is minted against the community you have today — roughly {terms.communityMembers.toLocaleString()} people — and the
              sale clears at what they will actually absorb
              {terms.boundBy === 'float_depth'
                ? ', which is what caps this raise. A bigger community would clear more, and a bigger float would be harder to move later.'
                : terms.boundBy === 'valuation_ceiling'
                  ? ', capped here at what an equity round of this size would have raised.'
                  : '.'}{' '}
              Launch early and you mint a small float, keep a larger share of it and vest it all before the run ends; launch late and you
              raise more against stronger fundamentals but may never get past your own cliff.
            </div>
            <TokenomicsSetup game={game} draft={draft} setDraft={setDraft} />
            <div className="mt-3 rounded-xl border border-line bg-surface2 p-3.5">
              <div className="text-[13px] font-bold">This is a major strategic fork.</div>
              <div className="mt-1 text-[13px] leading-relaxed text-mut">
                Tokenisation may significantly accelerate community and user growth. However:
              </div>
              <ul className="mt-1.5 grid gap-1">
                {FORK_WARNINGS.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-[13px] text-mut">
                    <span className="text-warn">•</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
              {confirming ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Btn
                    variant="danger"
                    onClick={() => {
                      tokenise(draft)
                      setConfirming(false)
                    }}
                  >
                    Yes — tokenise {game.companyName}, permanently
                  </Btn>
                  <Btn onClick={() => setConfirming(false)}>Not now</Btn>
                </div>
              ) : (
                <Btn variant="primary" className="mt-3" onClick={() => setConfirming(true)}>
                  Tokenise company ▸
                </Btn>
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}

function IpoPanel() {
  const game = useStore((s) => s.game)!
  const fileIPO = useStore((s) => s.fileIPO)

  if (game.ipo) {
    const filing = game.ipo.phase === 'filing'
    return (
      <div className="mt-3.5">
        <Panel title={`Going public — ${filing ? 'S-1 under review' : 'roadshow'}`}>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] text-mut">Phase</div>
              <b>{filing ? `Filing · ${game.ipo.weeksLeft} wk of scrutiny left` : `Roadshow · pricing in ${game.ipo.weeksLeft} wk`}</b>
            </div>
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 text-[11px] text-mut">Investor demand</div>
              <Bar
                value={game.ipo.demand}
                color={game.ipo.demand < 45 ? 'var(--color-bad)' : game.ipo.demand < 60 ? 'var(--color-warn)' : 'var(--color-good)'}
              />
            </div>
          </div>
          <div className="mt-2.5 text-xs leading-relaxed text-mut">
            {filing
              ? 'The street reads everything: bugs and a shaky reputation bleed demand, growth builds it. The roadshow starts when the review clears.'
              : 'Every strong week adds orders to the book. On pricing day, demand meets the funding climate — strong demand pops, weak demand gets the offering pulled at the door.'}
          </div>
        </Panel>
      </div>
    )
  }

  // ICO brief §48: "Do not silently hide it without explanation." The panel still renders, the
  // checklist is replaced by the reason, and the button is DISABLED rather than absent.
  const closed = ipoClosed(game)
  if (closed.closed)
    return (
      <div className="mt-3.5">
        <Panel title="The final exit — take the company public">
          <div className="text-[13px] font-bold">{closed.reason}</div>
          <div className="mt-2 text-xs leading-relaxed text-mut">
            A conventional listing sells equity in a company to public shareholders. This company already sold its upside to its
            community, and the two cannot both be the senior claim. The token path has its own endings — the network is the thing you
            take to scale now.
          </div>
          <Btn variant="primary" className="mt-3" disabled>
            File the S-1 — unavailable
          </Btn>
        </Panel>
      </div>
    )

  const checks = ipoChecklist(game)
  return (
    <div className="mt-3.5">
      <Panel title="The final exit — take the company public">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {checks.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[13px]">
              <span className={c.met ? 'text-good' : 'text-mut'}>{c.met ? '✓' : '◻'}</span>
              <span className={c.met ? '' : 'text-mut'}>{c.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs leading-relaxed text-mut">
          You don't need late-stage rounds to go public — profitable companies walk straight to the exchange. Eight weeks from filing
          to the bell: four of SEC scrutiny, four of roadshow. Fundraising freezes, the process eats ~15% of the team's output, and on
          pricing day the market decides — a pop crowns the run, a pulled IPO costs $2M, reputation, and ~25 weeks before the street
          will look at you again. Time it to a warm climate and a hot growth curve — and note the run no longer auto-ends at $1B while
          your IPO is in flight, so a monster debut can beat the plain unicorn ending.
        </div>
        <Btn variant="primary" className="mt-3" disabled={!ipoEligible(game)} onClick={fileIPO}>
          {game.ipoCooldown > 0 ? `The street remembers — ${game.ipoCooldown} wk` : 'File the S-1 ▸'}
        </Btn>
      </Panel>
    </div>
  )
}

export function Fundraising() {
  const game = useStore((s) => s.game)!
  const pitch = useStore((s) => s.pitch)
  const accept = useStore((s) => s.accept)
  const decline = useStore((s) => s.decline)

  const val = valuation(game)
  const target = nextStage(game)
  const threshold = STAGE_THRESHOLDS[game.stage]
  const ready = target && val >= threshold
  const roundsClosed = institutionalRoundsClosed(game)

  return (
    <div>
      <h1 className="text-[20px] font-extrabold tracking-tight">Fundraising</h1>
      <div className="mb-4 text-[13px] text-mut">
        {game.stage} · you own {pct(game.founderEquity, 1)} · dilution is forever, choose wisely
      </div>

      <div className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <StatCard
          label="Funding climate"
          value={climateLabel(game.climate)}
          delta={game.climate < -0.4 ? 'Valuations depressed, funds hibernating' : game.climate > 0.4 ? 'Cheap money — strike now' : 'Business as usual'}
          tone={game.climate < -0.4 ? 'down' : game.climate > 0.4 ? 'up' : undefined}
        />
        <StatCard label="Current valuation" numeric={val} format={money} />
        <StatCard
          label={target ? `Bar for ${target}` : 'Final stage'}
          value={target ? money(threshold) : '$1B exit'}
          delta={target ? (ready ? 'Investors will take the meeting' : 'Grow traction first') : undefined}
          tone={ready ? 'up' : undefined}
        />
        <StatCard label="Your stake" value={pct(game.founderEquity, 1)} delta={`worth ${money(val * game.founderEquity)} on paper`} />
      </div>

      {game.board && (
        <div className="mt-3.5">
          <Panel title="Your board">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <div className="text-[11px] text-mut">Growth target (saturation-adjusted)</div>
                <b className="tnum">{pct(boardEffectiveTarget(game), 1)}/wk</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Your user growth</div>
                <b className={`tnum ${growthRate(game) >= boardEffectiveTarget(game) ? 'text-good' : 'text-bad'}`}>
                  {pct(growthRate(game), 1)}/wk
                </b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Your revenue growth</div>
                <b className={`tnum ${revenueGrowthRate(game) >= boardEffectiveTarget(game) ? 'text-good' : 'text-bad'}`}>
                  {pct(revenueGrowthRate(game), 1)}/wk
                </b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Next review</div>
                <b className="tnum">week {game.board.nextReview}</b>
              </div>
              <div>
                <div className="text-[11px] text-mut">Strikes</div>
                <span className="mt-1 inline-flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className={`h-2.5 w-2.5 rounded-full ${i < game.board!.strikes ? 'bg-bad' : 'bg-line'}`} />
                  ))}
                </span>
              </div>
              {game.board.defied && <b className="text-bad">You defied the board — hit the target by the next review or you are out.</b>}
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-mut">
              Investor money comes with investor expectations — but there are three ways to satisfy them: user growth above target,
              revenue growth above target, or real profitability (15%+ net margin with revenue still climbing). The target eases as
              your market saturates. Miss on all three at three reviews and you face an ultimatum; keep missing and the board finds a
              new CEO.
            </div>
          </Panel>
        </div>
      )}

      <TokenisationPanel />

      <SecondaryPanel />

      {ipoVisible(game) && <IpoPanel />}

      <div className="mt-3.5">
        <Panel title="Pitch investors">
          {/* ICO brief §47: the button stays on screen and carries its reason. A control that
              vanishes teaches nothing; one that says why it is dark teaches the fork. */}
          <p className="mb-3 text-[13px] leading-relaxed text-mut">
            {roundsClosed.closed
              ? roundsClosed.reason
              : `Running a fundraise takes about 10 weeks of founder attention, so you cannot pitch constantly. Offers price around your
            valuation and swing with the funding climate — in a frozen market, even good companies get ghosted. Raising below your last
            round's price is a down round: cash in the bank, morale out the door. Term sheets expire in 3 weeks.`}
          </p>
          <Btn variant="primary" disabled={roundsClosed.closed || game.raiseCooldown > 0 || !!game.gameOver} onClick={pitch}>
            {roundsClosed.closed
              ? 'Institutional rounds — closed'
              : game.raiseCooldown > 0
                ? `On the road — try again in ${game.raiseCooldown} wk`
                : 'Start pitching ▸'}
          </Btn>
        </Panel>
      </div>

      {game.termSheets.length > 0 && (
        <div className="mt-3.5">
          <Panel title="Term sheets on the table">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {game.termSheets.map((t) => {
                const post = t.amount / t.equity
                return (
                  <div key={t.id} className="rise-in rounded-xl border border-line bg-surface2 p-4">
                    <div className="font-bold">{t.investor}</div>
                    <div className="my-2.5 text-[13px] leading-relaxed text-mut">
                      Investing <b className="text-ink tnum">{money(t.amount)}</b>
                      <br />
                      for <b className="text-ink tnum">{pct(t.equity, 1)}</b> of the company
                      <br />
                      <span className="text-xs">
                        {money(post)} post-money · expires in {t.weeksLeft} wk
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Btn variant="good" onClick={() => accept(t.id)}>
                        Sign
                      </Btn>
                      <Btn variant="danger" onClick={() => decline(t.id)}>
                        Pass
                      </Btn>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
