# Founder Mode — Tokenisation / ICO Strategic Path

## Objective

Add a new strategic path to Founder Mode:

# Tokenise the Company

The player can choose to move away from the traditional institutional-capital path and launch a token/community-based economic model.

This should NOT behave like:

> Press ICO → get users + growth + retention.

Instead, tokenisation should represent a fundamental choice between two different ways of building and financing the company:

```text
TRADITIONAL PATH

VC / Institutional Capital
        ↓
Equity
        ↓
Board / Investors
        ↓
Series A / B / C
        ↓
Acquisition / IPO
```

versus:

```text
TOKEN PATH

Community Capital
        ↓
Token Launch
        ↓
Token Treasury
        ↓
Community Incentives
        ↓
Governance / Decentralisation
        ↓
Protocol / Network
```

The key product idea is:

> Traditional capital costs equity.
> Community capital costs control in a different way.

Tokenisation should create:

- Strong short-term hype potential
- Faster acquisition potential
- Community effects
- New capital sources
- New incentive systems

but also:

- Speculation
- Volatility
- Mercenary users
- Governance complexity
- Treasury risk
- Reputation risk
- Loss of traditional financing options
- Loss of conventional IPO path

It should be a meaningful, mostly irreversible strategic fork.

---

# Design principle

Tokenisation should answer:

> Do you want to build through institutions and centralised capital, or through community ownership and decentralised incentives?

This should become one of the largest strategic decisions available in Career Mode.

---

# Mode scope

Implement tokenisation differently by mode.

## Career

Full/deep implementation.

Tokenisation should become a genuine alternative company path.

## Quick Play

Simplified implementation.

The player may choose to tokenise and receive a smaller set of benefits/risks without managing detailed governance.

## Arena

Do NOT implement full Arena token PvP in this phase.

Build architecture compatibility only.

Arena integration can come later.

---

# Capability architecture

Use the existing rules/capability system.

Add capabilities such as:

```ts
tokenisation: boolean;
tokenEconomy: boolean;
tokenGovernance: boolean;
tokenTreasury: boolean;
communityCapital: boolean;
tokenNarrative: boolean;
```

Suggested defaults:

```text
Quick Play:
tokenisation = true
tokenEconomy = light
tokenGovernance = false

Career:
tokenisation = true
tokenEconomy = deep
tokenGovernance = true

Arena:
tokenisation = false initially
```

Do not use scattered:

```ts
if (mode === "career")
```

where capability checks are more appropriate.

---

# 1. Tokenisation eligibility

The player should not be able to launch a token immediately.

Introduce eligibility criteria.

Possible inputs:

- Minimum active users
- Minimum PMF level
- Minimum community strength
- Minimum company age
- Sector suitability
- Reputation
- Product/community engagement

Suggested:

```ts
interface TokenisationEligibility {
  eligible: boolean;

  blockers: TokenisationBlocker[];

  readinessScore: number;
}
```

Do not expose readiness as an exact hidden optimisation score unless useful.

Show readable feedback.

Example:

```text
TOKENISATION

Not ready.

You still need:
• Stronger product-market fit
• Larger active community
• More consistent retention
```

---

# 2. Sector suitability

Tokenisation should not be equally attractive in every sector.

Suggested relative suitability:

## Developer Tools

High

Reasons:
- Developer ecosystem
- Open-source communities
- Protocol/network potential

## Social

High

Reasons:
- Community effects
- User ownership
- Network participation

## Fintech

High upside / high risk

Reasons:
- Native financial mechanics
- Regulation/reputation complexity

## Marketplace

Medium-high

Reasons:
- Buyer/seller incentives
- Network economics

## B2B SaaS

Medium-low

Reasons:
- Traditional enterprise economics often fit better

## E-commerce

Medium-low

Reasons:
- Token may create loyalty/community but often weaker core utility

Do not hardcode one correct answer.

Seed/scenario/company strategy should matter.

---

# 3. Token launch decision

When eligible, allow:

# TOKENISE COMPANY

Before confirmation, clearly communicate:

```text
This is a major strategic fork.

Tokenisation may significantly accelerate community and user growth.

However:

• Traditional VC fundraising may become unavailable
• IPO path will close
• Institutional investor appetite may collapse
• Community governance pressure will increase
• Token price and treasury value may become volatile
```

Require explicit confirmation because this is strategically irreversible.

---

# 4. Irreversibility

After a successful token launch:

Set:

```ts
capitalPath: "community";
```

Traditional company:

```ts
capitalPath: "institutional";
```

Suggested:

```ts
type CapitalPath =
  | "institutional"
  | "community";
```

Once community path is selected, switching back should either:

- Be impossible

or:

- Require a rare restructuring event with severe penalties

For Phase 1:

Prefer irreversible.

---

# 5. Traditional financing restrictions

After tokenisation, disable or heavily restrict:

- Series A
- Series B
- Series C
- Traditional institutional rounds
- Conventional IPO

Traditional acquisition may remain possible in some scenarios, but should become less common or more complex.

Do not necessarily disable:

- Debt
- Revenue financing
- Strategic partnerships

unless existing game logic makes this necessary.

---

# 6. Community capital unlocks

Tokenisation should unlock alternative sources of capital.

Examples:

- Initial token sale
- Treasury token sales
- Community funding rounds
- Ecosystem grants
- Protocol revenue
- Partner token allocations

Do not copy traditional VC under a different name.

Community capital should behave differently.

---

# 7. Token Economy state

Add a dedicated subsystem.

Suggested:

```ts
interface TokenEconomyState {
  active: boolean;

  launchWeek?: number;

  tokenPrice: number;
  circulatingSupply: number;
  totalSupply: number;

  treasuryTokens: number;
  treasuryValue: number;

  communityStrength: number;
  utilityStrength: number;
  speculationLevel: number;

  decentralisation: number;
  founderInfluence: number;

  tokenSentiment: number;
  volatility: number;

  incentivisedUsers: number;
  organicUsers: number;
}
```

Do not expose every exact number.

Use readable UI where appropriate.

---

# 8. Core token metrics

Career should focus on five core concepts.

## Community

How engaged and committed token holders/users are.

## Utility

How much real product/network value the token has.

## Speculation

How much token demand is driven by price expectations rather than utility.

## Treasury

Resources controlled through token reserves.

## Decentralisation

How much power has moved away from the founder/company.

Token price is an important derived market output, but it should not be the only success metric.

---

# 9. Token dashboard

Career should show something like:

```text
TOKEN ECONOMY

Token Price
$4.82
↑ 12%

Community
Strong

Utility
Developing

Speculation
Very High

Treasury
$41.2M

Founder Influence
72%
```

Avoid turning Career into a trading terminal.

The player manages the company/network, not candles.

---

# 10. Token launch effects

Token launch can create immediate effects.

Possible:

```text
Hype ↑↑
Brand Awareness ↑↑
New Users ↑
Community ↑
Media Attention ↑↑
```

But:

```text
Organic Retention:
unchanged initially
```

This is important.

Tokenisation should not directly create true PMF.

---

# 11. Organic vs incentivised users

Introduce distinction between:

# Organic Users

People using the product because it creates value.

# Incentivised Users

People whose behaviour is materially driven by token rewards.

Suggested:

```ts
interface UserComposition {
  organicUsers: number;
  incentivisedUsers: number;
}
```

This distinction should matter for:

- Retention
- Revenue quality
- PMF
- Token price
- Community
- Investor perception
- Sustainability

---

# 12. Incentivised retention

Do not treat all retention equally.

Career should be able to show:

```text
4-WEEK RETENTION

Organic Users
63%

Incentivised Users
81%
```

But if incentives are removed:

```text
Expected Incentivised Retention
31%
```

This creates the strategic question:

> Are users staying because they value the product, or because they are being paid to stay?

---

# 13. Token incentives

Allow the player to allocate token treasury toward major strategic categories.

Suggested:

```ts
type TokenAllocation =
  | "customer_rewards"
  | "developer_grants"
  | "employee_compensation"
  | "liquidity_incentives"
  | "partnerships"
  | "community_treasury"
  | "ecosystem_growth";
```

Do not create micro-management.

Use broad allocations.

---

# 14. Customer rewards

Effects:

Potential:
- Acquisition ↑
- Engagement ↑
- Incentivised retention ↑
- Community ↑

Risks:
- Mercenary users ↑
- Token sell pressure ↑
- Organic retention may remain weak

---

# 15. Developer grants

Especially strong for:

- Developer Tools
- Protocol-like companies
- Platform businesses

Potential:
- Integrations
- Ecosystem growth
- Network effects
- Community strength
- Utility

Costs:
- Treasury depletion
- Slow payoff
- Some projects may fail

---

# 16. Employee token compensation

Allow token compensation to substitute for some cash/equity compensation.

Potential:

- Save cash
- Align employees with token ecosystem
- Attract crypto-native talent

Risks:

- Token price falls → morale decreases
- Compensation volatility
- Employees may become overly focused on token price

Do not rebuild employee compensation system completely.

Integrate into existing employee economics.

---

# 17. Liquidity incentives

Potential:

- Token activity ↑
- Market depth ↑
- Token attention ↑

Risks:

- Speculation ↑
- Treasury burn ↑
- Mercenary participation ↑
- Weak real utility

Liquidity incentives should be useful but dangerous.

---

# 18. Partnerships

Tokens may be used strategically to attract:

- Ecosystem partners
- Developers
- Distribution partners
- Communities

Potential:

- Distribution
- Community
- Utility
- User growth

---

# 19. Community treasury

The player may allocate tokens into a community-controlled treasury.

Potential:

- Decentralisation ↑
- Community trust ↑
- Ecosystem development ↑

Costs:

- Founder control ↓
- Company control ↓
- Resources become less directly controllable

---

# 20. Tokenomics launch setup

When tokenising, require a few major tokenomics decisions.

Keep this intentionally simple.

Suggested decisions:

## Community allocation

## Team/founder allocation

## Treasury allocation

## Vesting policy

## Primary token utility

Do not implement complex crypto-financial engineering.

---

# 21. Allocation example

Example:

```text
TOKEN ALLOCATION

Community
40%

Treasury
25%

Team
15%

Founder
10%

Strategic Partners
10%
```

These numbers should affect:

- Community trust
- Founder upside
- Treasury resources
- Decentralisation
- Reputation

---

# 22. Founder allocation

Higher founder allocation:

Potential:
- Founder economic upside ↑
- Founder influence ↑

Risks:
- Community trust ↓
- Speculation concerns ↑
- Reputation risk ↑
- Sell-pressure fears ↑

Low founder allocation:

Potential:
- Community credibility ↑

Costs:
- Founder upside/control ↓

---

# 23. Vesting

Suggested options:

```text
SHORT
STANDARD
LONG
```

Short vesting:

- Flexibility ↑
- Community trust ↓
- Dump risk ↑

Long vesting:

- Credibility ↑
- Community trust ↑
- Founder/team flexibility ↓

---

# 24. Token utility

Allow one primary token model initially.

Potential options:

## Product Access

Token required/useful for accessing features.

## Rewards

Token rewards desired behaviours.

## Governance

Token controls decisions.

## Marketplace Currency

Token used in network transactions.

## Ecosystem Incentive

Token rewards contributors/builders.

Each sector may have different compatibility.

---

# 25. Utility strength

Token utility should strengthen when actual product behaviour supports it.

Examples:

Developer platform:

More third-party integrations
→ Utility ↑

Marketplace:

More real transactions using token
→ Utility ↑

Social:

Token used mainly for speculation
→ Utility remains weak

Do not let the player simply click:

> Improve Utility +10.

Utility should emerge from actual company/product/network activity.

---

# 26. Speculation

Speculation should be a major state variable.

Speculation may increase from:

- Rapid token price appreciation
- Media hype
- Influencer events
- Aggressive incentives
- Market bull cycle
- Major partnerships
- Large user growth

High speculation provides upside:

- Token demand
- Treasury value
- Awareness
- User acquisition

But also risk:

- Volatility
- Mercenary users
- Dump events
- Community instability
- Reputation issues
- Reduced long-term sustainability

---

# 27. Token price

Implement a simplified deterministic token-price simulation.

Do NOT attempt to model real crypto markets precisely.

Token price can depend on:

- Utility
- Community
- Company growth
- Network activity
- Speculation
- Market sentiment
- Treasury actions
- Supply pressure
- Major events

Suggested conceptual model:

```ts
tokenDemand =
  utilityDemand
  + communityDemand
  + speculativeDemand;

tokenSupplyPressure =
  unlocks
  + treasurySales
  + employeeSales
  + founderSales;

tokenPriceChange =
  demandPressure
  - supplyPressure
  + marketModifier;
```

Use bounded/damped formulas to avoid uncontrolled numerical explosions.

---

# 28. Volatility

Higher speculation should generally increase volatility.

Utility/community strength should partially stabilise token value.

Suggested:

```ts
volatility =
  baseVolatility
  + speculationModifier
  - utilityStability
  - communityStability;
```

---

# 29. Treasury

Token treasury should be valuable but unstable.

Treasury value:

```ts
treasuryValue =
  treasuryTokens * tokenPrice;
```

This creates reflexivity.

Token rises:

```text
Treasury ↑
→ more ecosystem spending
→ growth
```

Token falls:

```text
Treasury ↓
→ less spending capacity
→ weaker incentives
→ potential further decline
```

---

# 30. Treasury diversification

Optionally allow later:

```text
Convert some token treasury into cash/stable reserves.
```

Potential:

- Risk ↓
- Volatility exposure ↓

Cost:

- Sell pressure ↑
- Community may interpret as lack of confidence

Keep simple.

---

# 31. Reflexivity

Token companies should experience stronger positive and negative feedback loops.

Positive:

```text
Strong Product
↓
Community Growth
↓
Token Demand
↓
Token Price ↑
↓
Treasury Value ↑
↓
Ecosystem Spending ↑
↓
Network Growth
```

Negative:

```text
Weak Product
↓
Speculation Reverses
↓
Token Price ↓
↓
Treasury Value ↓
↓
Incentives Cut
↓
Users Leave
↓
Community Sentiment ↓
↓
Token Price ↓
```

Use safeguards to prevent impossible runaway loops.

---

# 32. Community stakeholder

After tokenisation, community becomes a major stakeholder.

Traditional path primarily includes:

```text
Founder
Board
Investors
Employees
Customers
```

Token path adds:

```text
Community / Token Holders
```

This should affect:

- Strategy
- Reputation
- Governance
- Product direction
- Treasury allocation

---

# 33. Community sentiment

Suggested:

```ts
interface CommunityState {
  sentiment: number;
  trust: number;
  engagement: number;
  decentralisationDemand: number;
}
```

Community reacts to:

- Token performance
- Founder behaviour
- Treasury spending
- Product progress
- Governance
- Founder token sales
- Broken promises
- Excessive centralisation

---

# 34. Founder influence

Track:

```ts
founderInfluence: number;
```

At launch:

Maybe high.

Over time:

Can decline through decentralisation.

This should not simply equal token ownership.

It represents:

- Formal control
- Reputation
- Community trust
- Governance influence

---

# 35. Decentralisation

Allow strategic movement from:

```text
Founder-controlled company
```

toward:

```text
Community-governed network
```

Higher decentralisation can provide:

- Community trust
- Ecosystem growth
- Network resilience
- Contributor activity

Costs:

- Founder control
- Decision speed
- Strategic flexibility

---

# 36. Governance

Career should eventually support occasional governance votes.

Keep frequency low.

Only major issues.

Examples:

- Treasury allocation
- Large ecosystem initiative
- Major protocol change
- International expansion subsidy
- Decentralisation proposal

Suggested:

```ts
interface GovernanceProposal {
  id: string;

  week: number;

  type: GovernanceProposalType;

  descriptionKey: string;

  support: number;

  status:
    | "active"
    | "passed"
    | "rejected";
}
```

---

# 37. Governance outcome

Probability/support should derive from:

- Community sentiment
- Proposal utility
- Founder influence
- Holder composition
- Recent token performance
- Trust
- Decentralisation level

Do not use pure random votes.

---

# 38. Community pressure

Community should sometimes disagree with the founder.

Examples:

```text
COMMUNITY PRESSURE

Token holders are demanding more ecosystem grants.
```

or:

```text
GOVERNANCE SENTIMENT

The community strongly opposes using treasury resources for enterprise expansion.
```

This replaces some of the governance pressure traditionally provided by the board.

---

# 39. Token-native narrative

Integrate with Procedural Living World.

Examples:

```text
COMMUNITY SENTIMENT TURNS

Token holders question aggressive treasury spending after three weak product releases.
```

```text
TOKEN RALLIES 24%

Developer adoption accelerated following the ecosystem grants programme.
```

```text
FOUNDERS UNDER PRESSURE

Community members criticise the size of upcoming team unlocks.
```

All must reflect actual state.

---

# 40. Token-specific event categories

Add events around:

- Community
- Treasury
- Utility
- Price
- Speculation
- Governance
- Unlocks
- Ecosystem
- Reputation

Do not immediately create dozens.

Build reusable state-driven templates.

---

# 41. Token unlocks

Team/founder allocations may vest over time.

When unlocks occur:

Potential:

- Sell pressure
- Speculation
- Community concern

Do not simulate individual wallet trading.

Use aggregate supply pressure.

---

# 42. Founder sales

Career may allow founder to sell limited token holdings.

This should be strategically sensitive.

Potential benefit:

- Founder liquidity

Risks:

- Community trust ↓
- Token sentiment ↓
- Reputation ↓
- Token price ↓

Large founder sales should be highly consequential.

---

# 43. Token-native failure states

Add new failure/crisis states.

## Token Death Spiral

Possible when:

- Token price collapses
- Treasury collapses
- Incentives disappear
- Community sentiment collapses

This does not have to instantly end the company.

It may create a severe turnaround challenge.

---

## Community Revolt

Possible when:

- Trust extremely low
- Founder highly centralised
- Governance legitimacy weak

Potential effects:

- Governance defeat
- Founder influence ↓
- Ecosystem participation ↓

---

## Mercenary Growth

Not necessarily a game-over state.

Occurs when:

- Incentivised users dominate
- Organic retention weak
- Utility weak

The game should warn:

```text
Growth is high, but most engagement is incentive-driven.
```

---

## Treasury Crisis

Triggered when treasury value/spend becomes unsustainable.

---

# 44. Token-native success states

Tokenisation should unlock alternative success paths.

Possible Career achievements/end states:

## Network Unicorn

Network/token ecosystem value exceeds major milestone.

## Category Protocol

Company becomes infrastructure/category standard.

## Community Network

Community participation becomes highly self-sustaining.

## Founder Decentralised

Founder influence falls substantially while network remains healthy.

## Self-Sustaining Protocol

The network continues successfully without founder operational control.

---

# 45. Alternative endgame

Traditional path:

```text
Acquisition
IPO
Large private company
Profitable company
```

Token path:

```text
Decentralised Network
Category Protocol
Self-Sustaining Ecosystem
Network Unicorn
```

Traditional IPO must remain unavailable after tokenisation.

---

# 46. Founder Dependency connection

Do not implement Founder Dependency if not already built.

But make token architecture compatible with it.

Long-term idea:

Traditional path:

```text
Founder
→ Management Team
→ Institution
```

Token path:

```text
Founder
→ Community
→ Governance
→ Network
```

Both ultimately ask:

> Can the thing survive without the founder?

---

# 47. Fundraising integration

When:

```ts
capitalPath === "community"
```

disable inappropriate institutional rounds.

Existing fundraising UI should clearly explain:

```text
Traditional equity fundraising is unavailable after tokenisation.
```

Do not silently hide it without explanation.

---

# 48. IPO integration

When tokenised:

```ts
ipoEligible = false;
```

UI should show:

```text
IPO unavailable.

This company chose the community-capital path.
```

Do not allow accidental switching back.

---

# 49. Valuation

Do not simply replace company valuation with token market cap.

Track separately:

```ts
companyEnterpriseValue
tokenNetworkValue
```

Depending on the business model, network value may become more important.

Avoid double-counting.

---

# 50. Token market cap

Suggested:

```ts
tokenMarketCap =
  tokenPrice * circulatingSupply;
```

This is an ecosystem/network metric.

Do not automatically treat market cap as realised company value.

---

# 51. Founder wealth

If Founder Mode later tracks founder wealth:

Token founder holdings can contribute to theoretical founder value.

But mark illiquidity/volatility.

Do not treat all token holdings as immediately cash-equivalent.

---

# 52. PMF integration

Tokenisation must NOT override Career PMF Discovery.

PMF remains grounded in:

- Product fit
- Retention
- WTP
- Acquisition
- Segment behaviour

Token incentives can alter acquisition and observed engagement.

Do not let them artificially create Strong PMF.

This is critical.

---

# 53. PMF warning

If token incentives are masking weak product fundamentals, surface:

```text
TOKEN-DRIVEN GROWTH

User growth is strong.

However, organic retention remains weak.

Most recent growth appears incentive-driven.
```

This should be one of the primary educational insights of the system.

---

# 54. Community vs customers

Do not assume:

```text
Token holders = customers.
```

Track distinctions where possible:

- Product users
- Paying customers
- Token holders
- Contributors

Overlap can exist.

---

# 55. Quick Play implementation

Quick Play should use a simplified token mechanic.

Player chooses:

# TOKENISE

Effects:

Potential:

- Hype ↑
- User acquisition ↑
- Community ↑
- Treasury capital ↑

Costs:

- Traditional fundraising locked
- IPO locked
- Volatility introduced
- Organic/incentivised retention distinction
- Token risk events

Quick Play should NOT require:

- Detailed governance
- Tokenomics micro-management
- Complex treasury screen

Keep the decision bold and understandable.

---

# 56. Quick Play token dashboard

Maybe only:

```text
TOKEN

Price
$3.82

Community
Strong

Utility
Medium

Speculation
High

Treasury
$18M
```

Enough to create the strategic difference without slowing gameplay.

---

# 57. Career implementation

Career gets full depth:

- Eligibility
- Tokenomics
- Community
- Utility
- Speculation
- Treasury
- Organic vs incentivised users
- Governance
- Decentralisation
- Founder influence
- Alternative capital
- Token narrative
- Token-specific success/failure

---

# 58. Arena compatibility

For this implementation:

```text
Arena tokenisation = disabled
```

But keep the architecture compatible with later asymmetric Arena builds.

Do not implement token PvP yet.

---

# 59. Narrative Director integration

Token events should become NarrativeCandidates.

Examples:

- Major token rally
- Major token crash
- Governance rebellion
- Founder token sale
- Major treasury proposal
- Incentivised-user surge
- Ecosystem breakthrough

Career Narrative Director should score them using normal impact/callback rules.

---

# 60. Procedural media integration

Token companies should generate media such as:

```text
Acme launches community token after reaching 2M users
```

```text
Acme token slides 28% as treasury spending accelerates
```

```text
Developer activity surges after Acme expands ecosystem grants
```

Do not mention outcomes not present in simulation.

---

# 61. Company memory integration

Token-related milestones should enter Company Memory.

Examples:

- Token launch
- First token rally
- First governance vote
- Major crash
- Treasury milestone
- Decentralisation milestone
- Community revolt
- Network self-sustainability

These should appear in postmortem.

---

# 62. Decision journal integration

Record:

- Decision to tokenise
- Token allocation
- Vesting choice
- Utility choice
- Major treasury allocations
- Founder sales
- Decentralisation changes
- Governance outcomes

---

# 63. Procedural postmortem

Career token path should add sections such as:

```text
THE CAPITAL FORK

WHY YOU TOKENISED

THE HYPE PHASE

WHAT THE COMMUNITY BUILT

WHERE SPECULATION HELPED

WHERE SPECULATION HURT

CONTROL YOU GAVE UP

TOKEN ECONOMY OUTCOME
```

Example:

```text
You tokenised in Week 62.

Growth accelerated almost immediately, but most new activity was incentive-driven.

The turning point came when developer grants began producing real third-party integrations.

By Week 118, utility growth had overtaken speculation as the primary source of token demand.
```

This must be procedurally assembled from actual history.

---

# 64. Founder profile integration

Possible token-related founder characteristics:

- Community Builder
- Speculation Chaser
- Protocol Architect
- Treasury Maximalist
- Decentraliser
- Control Keeper

Do not make these mutually exclusive with existing founder archetypes unless necessary.

---

# 65. UI — Tokenisation decision screen

The decision should feel significant.

Suggested:

```text
TOKENISE THE COMPANY

You are considering moving from institutional capital to a community-owned economic model.

Potential:

• Faster community growth
• New capital source
• Ecosystem incentives
• Strong network effects

You will give up:

• Traditional VC fundraising
• Conventional IPO path
• Some founder control

This decision is permanent.
```

CTA:

```text
DESIGN TOKEN
```

Secondary:

```text
STAY TRADITIONAL
```

---

# 66. UI — Token setup

Keep to one screen if possible.

Decisions:

1. Allocation
2. Vesting
3. Utility
4. Decentralisation starting point

Show tradeoffs clearly.

Avoid unnecessary crypto terminology.

---

# 67. UI — Community screen

Career could add:

```text
COMMUNITY

Members
1.8M

Sentiment
Strong

Trust
Medium

Token Holders
420K

Organic Users
680K

Incentivised Users
510K

Founder Influence
68%
```

Keep readable.

---

# 68. UI — Treasury

Show:

- Treasury token reserves
- Estimated value
- Current allocation
- Burn/spend
- Major commitments

Do not create a trading interface.

---

# 69. UI — Governance

Only show when relevant.

Example:

```text
GOVERNANCE PROPOSAL

Allocate 8% of treasury to international developer grants.

Community Support
62%

Founder Position
Support

Voting closes this week.
```

---

# 70. Determinism

All token simulation must be deterministic.

Same:

- Seed
- Company history
- Token decisions
- Treasury decisions
- Market state

must produce identical outcomes.

Never use:

```ts
Math.random()
```

Use existing seeded RNG.

---

# 71. Data model

Suggested subsystem:

```ts
interface TokenisationState {
  capitalPath: CapitalPath;

  tokenEconomy?: TokenEconomyState;

  community?: CommunityState;

  governance?: GovernanceState;

  tokenAllocation?: TokenAllocationState;

  activeProposals?: GovernanceProposal[];

  tokenHistory?: TokenHistoryEntry[];
}
```

Keep this separated from unrelated core state where possible.

---

# 72. Token history

Suggested:

```ts
interface TokenHistoryEntry {
  week: number;

  type:
    | "launch"
    | "price_rally"
    | "price_crash"
    | "treasury_sale"
    | "founder_sale"
    | "governance_vote"
    | "utility_milestone"
    | "community_milestone"
    | "decentralisation";

  importance: number;

  metadata: Record<string, string | number>;
}
```

---

# 73. Save persistence

Persist:

- Capital path
- Token economy
- Community
- Treasury
- Tokenomics
- Governance
- Founder influence
- History

Generated values must survive reload.

---

# 74. Save migration

Existing games default to:

```ts
capitalPath: "institutional"
```

Do not automatically tokenise any legacy saves.

Existing Quick/Career saves must remain valid.

---

# 75. Balance philosophy

Tokenisation must NOT be objectively better than the traditional path.

It should have:

## Strong upside

- User growth
- Community
- Network effects
- Alternative capital

## Strong downside

- Volatility
- Speculation
- User-quality problems
- Treasury instability
- Governance
- Loss of traditional exits
- Reduced founder control

---

# 76. No universal correct timing

Early tokenisation:

Potential:
- Large hype
- Weak utility
- High speculation risk

Late tokenisation:

Potential:
- Stronger fundamentals
- Less explosive community upside
- Better credibility

No fixed optimal week.

---

# 77. Bot strategies

Create Career token-aware bots.

## Traditional Institution Bot

Never tokenises.

Uses VC/IPO path.

## Early Token Bot

Tokenises as soon as eligible.

Aggressively funds incentives.

Expected:

High variance.

## Utility-First Token Bot

Waits for strong PMF.

Builds community/utility before aggressive incentives.

Expected:

Slower token growth but better long-term resilience.

---

# 78. Balance validation

Compare:

- Traditional
- Early Token
- Utility-First Token

Track:

- Survival
- Users
- Organic retention
- Incentivised retention
- Founder control
- Treasury
- Final network/company value
- End state

No strategy should dominate consistently.

---

# 79. Tests — eligibility

Test:

- Ineligible company cannot tokenise.
- Eligible company can.
- Eligibility varies with relevant state.

---

# 80. Tests — capital path

After tokenisation:

- Capital path changes.
- Traditional fundraising disables.
- IPO disables.
- Existing capital/equity does not disappear.

---

# 81. Tests — PMF protection

Test:

- Incentive-driven acquisition does not directly create Strong PMF.
- Organic retention remains separate.
- High incentivised retention can coexist with weak PMF.

---

# 82. Tests — treasury

Test:

- Token-price changes affect treasury value.
- Treasury spending reduces reserves.
- Treasury sales create supply pressure.
- Same inputs produce same results.

---

# 83. Tests — speculation

Test:

- Higher speculation increases volatility.
- Utility can partially stabilise token economics.
- Extreme speculation can lead to large downside.

---

# 84. Tests — community

Test:

- Community responds to token performance.
- Founder behaviour affects trust.
- Decentralisation affects influence.
- Governance outcomes depend on state.

---

# 85. Tests — tokenomics

Test:

- Founder allocation affects founder/community tradeoff.
- Vesting affects future unlock pressure.
- Utility selection affects relevant mechanics.

---

# 86. Tests — mode behaviour

## Career

Deep token system.

## Quick Play

Simplified token system.

## Arena

Tokenisation unavailable in this phase.

---

# 87. Tests — persistence

Test:

- Token state survives reload.
- Governance state survives reload.
- Treasury survives reload.
- Token history survives reload.
- Legacy saves load as institutional.

---

# 88. Acceptance criteria

This feature is complete when:

1. Tokenisation is a major strategic decision.
2. Eligibility exists.
3. Tokenisation is effectively irreversible.
4. Traditional capital path and token path are separated.
5. Traditional VC rounds close after tokenisation.
6. Conventional IPO closes after tokenisation.
7. Community capital unlocks.
8. Token economy state exists.
9. Community is tracked.
10. Utility is tracked.
11. Speculation is tracked.
12. Treasury is tracked.
13. Token price is simulated.
14. Token volatility exists.
15. Organic and incentivised users are distinct.
16. Incentivised retention cannot masquerade as PMF.
17. Token incentives work.
18. Tokenomics setup works.
19. Founder allocation has consequences.
20. Vesting has consequences.
21. Token utility matters.
22. Founder influence can decline.
23. Decentralisation exists.
24. Governance proposals work in Career.
25. Community sentiment reacts to company behaviour.
26. Token-native crises exist.
27. Token-native success states exist.
28. Career postmortem includes token history.
29. Quick Play has simplified tokenisation.
30. Arena remains unaffected.
31. Simulation remains deterministic.
32. Existing saves remain safe.
33. Existing Career PMF remains functional.
34. Existing Quick Play remains functional.
35. Tests pass.
36. TypeScript strict mode passes.
37. `npm run build` passes.

---

# 89. Non-goals

Do NOT implement:

- A real cryptocurrency
- Blockchain integration
- Wallets
- Smart contracts
- Pump.fun integration
- Solana integration
- Ethereum integration
- Real token trading
- Real financial transactions
- Real securities issuance
- Real ICO functionality
- Real-world token pricing APIs
- Exchange integrations
- Wallet authentication
- External market feeds
- Arena token PvP
- Complex DeFi
- Lending protocols
- Staking systems
- Yield farming
- NFTs

This is a fictional business-simulation mechanic only.

---

# 90. Recommended implementation order

## Phase 1 — Architecture

Inspect:

- Fundraising
- IPO
- PMF
- User acquisition
- Retention
- Valuation
- GameRules
- Capabilities
- Narrative
- Persistence

Add:

- CapitalPath
- Tokenisation capabilities
- TokenisationState

---

## Phase 2 — Eligibility

Implement:

- Token readiness
- Sector suitability
- Decision flow

---

## Phase 3 — Capital Fork

Implement:

- Institutional path
- Community path
- Fundraising restrictions
- IPO restriction

---

## Phase 4 — Token Economy Core

Implement:

- Token price
- Supply
- Treasury
- Utility
- Community
- Speculation
- Volatility

---

## Phase 5 — User Behaviour

Implement:

- Organic users
- Incentivised users
- Incentivised retention
- PMF protection

---

## Phase 6 — Tokenomics

Implement:

- Allocation
- Founder share
- Community share
- Treasury
- Vesting
- Utility

---

## Phase 7 — Incentive Allocation

Implement:

- Customer rewards
- Developer grants
- Employee tokens
- Liquidity
- Partnerships
- Community treasury

---

## Phase 8 — Community + Decentralisation

Implement:

- Community sentiment
- Trust
- Founder influence
- Decentralisation

---

## Phase 9 — Governance

Implement limited major governance proposals in Career.

---

## Phase 10 — Narrative

Integrate:

- Inbox
- Media
- Company Memory
- Decision Journal
- Narrative Director
- Postmortem

---

## Phase 11 — Quick Play

Build the simplified Tokenise flow.

Do not expose deep governance.

---

## Phase 12 — Bots + Balance

Run:

- Traditional
- Early Token
- Utility-First Token

Compare results.

---

## Phase 13 — Regression

Verify:

- Quick Standard
- Daily Challenge
- Scenarios
- Career
- Career PMF
- Living World
- Fundraising
- IPO
- Arena
- Persistence
- Determinism

---

## Phase 14 — Build

Run:

```bash
npm run build
```

Resolve all regressions.

---

# 91. Quality bar

The mechanic is working if a Career run can produce a story like:

```text
Week 54

Strong PMF emerges among Developer Teams.

Week 71

The company tokenises.

Traditional fundraising closes.

Token Launch:
Community explodes.
User growth accelerates.

Week 80

Token price triples.

Treasury value reaches $74M.

But:

57% of new users are now incentive-driven.

Week 91

Organic retention remains strong.

Developer grants produce 18 third-party integrations.

Token utility improves.

Week 108

A market downturn causes token price to fall 46%.

Treasury value collapses.

The company reduces incentives.

Mercenary users leave.

Week 116

Organic users continue growing despite the incentive cuts.

Community trust recovers.

Week 139

Founder influence falls below 40%.

The network becomes increasingly community governed.

Final Outcome:

SELF-SUSTAINING NETWORK

You no longer control the company you created.

It no longer needs you.
```

This should emerge from simulation.

Not from a fixed story script.

---

# 92. Core design rule

When evaluating any token feature, ask:

> Does this create a meaningful difference between community capital and traditional institutional capital?

If not, it probably does not belong.

Do not make tokenisation a generic growth booster.

It should change:

- Capital
- Governance
- Incentives
- User composition
- Risk
- Founder control
- Endgame

The strategic choice should ultimately be:

> Build a company owned and governed through institutions?

or:

> Build a network increasingly owned and governed by its community?