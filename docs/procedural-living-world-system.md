> **Status: NOT STARTED — filed for a future update.**
> Saved 2026-08-07 at the owner's request. Nothing in this document is implemented.
> The current Career feature is [Career Phase 1 — PMF Discovery 2.0](career-phase-1-pmf-discovery.md).

# Founder Mode — Procedural Living World System

## Objective

Build a shared procedural narrative and living-world system that makes Founder Mode feel more dynamic, personal, contextual and alive **without any live AI/LLM calls**.

The system should be available across Founder Mode, but with different depth depending on game mode:

```text
Quick Play
→ Light Living World

Career
→ Deep Living World

Arena
→ Competitive Living World
```

The core architecture should be shared.

Do not build separate narrative engines for each mode.

The implementation must be:

- Fully deterministic
- Fully playable offline
- Zero external AI/API dependencies
- Zero runtime model cost
- Secure
- Fast
- Compatible with current save/load architecture
- Compatible with seeded simulation
- Compatible with headless bots
- Capability/rules controlled
- Reusable across modes

The design principle is:

> Simulation provides truth.
> Procedural systems provide variety.
> Memory creates continuity.
> Personality creates humanity.

---

# Product goal

Founder Mode should eventually create three different types of narrative experience.

## Quick Play

> The world feels alive.

The player should see:

- Better event writing
- Recognisable AI rivals
- Contextual headlines
- Occasional employee/customer reactions
- Lightweight callbacks
- Better milestones
- Short post-run story

But Quick Play must remain fast.

Do not turn it into a relationship-management simulation.

---

## Career

> The world remembers you.

Characters should:

- Persist
- Develop history
- Remember decisions
- Hold grudges
- Appreciate support
- React differently based on personality
- Reference earlier events
- Change relationships with the founder
- Create long-running stories

Career is where the deepest implementation lives.

---

## Arena

> The world reacts to what the players just did.

Arena should use procedural narrative mainly to dramatise:

- Player competition
- Acquisitions
- Price wars
- Talent poaching
- Fundraising
- Market leadership
- Partnerships
- Betrayals
- Competitive swings

Arena should not inherit Career's deep employee relationship mechanics.

Humans create the story.

The narrative system should make that story visible.

---

# Core architecture

Build one shared system:

```text
SIMULATION
What actually happened
        ↓
CHARACTERS
Who is affected
        ↓
MEMORY + RELATIONSHIPS
What they remember and care about
        ↓
NARRATIVE DIRECTOR
What deserves attention
        ↓
PROCEDURAL COMPOSER
How the story is expressed
        ↓
GAME SURFACES
Inbox / media / meetings / recap
```

The narrative layer must never independently decide simulation outcomes.

Simulation remains authoritative.

Narrative interprets existing facts.

---

# 1. Living World depth

Do not model this as a simple Career-only boolean.

Add:

```ts
export type LivingWorldDepth =
  | "off"
  | "light"
  | "deep"
  | "competitive";
```

Mode defaults:

```ts
Quick Play:
livingWorldDepth: "light"

Career:
livingWorldDepth: "deep"

Arena:
livingWorldDepth: "competitive"
```

Use the existing GameRules architecture.

Example:

```ts
interface GameRules {
  ...
  livingWorldDepth: LivingWorldDepth;
  capabilities: GameCapabilities;
}
```

---

# 2. Capabilities

Add or extend capabilities such as:

```ts
interface GameCapabilities {
  ...

  proceduralNarrative: boolean;
  proceduralMedia: boolean;
  narrativeDirector: boolean;

  persistentCharacters: boolean;
  characterMemory: boolean;
  companyMemory: boolean;
  relationships: boolean;

  advisorOpinions: boolean;
  structuredInterviews: boolean;
  structuredEmployeeConversations: boolean;
  proceduralBoardMeetings: boolean;

  promises: boolean;
  longTermCallbacks: boolean;

  rivalArchetypes: boolean;
  rivalNarrative: boolean;

  proceduralPostmortem: boolean;
}
```

Do not rely only on:

```ts
livingWorldDepth === "deep"
```

Individual capabilities should remain independently configurable.

---

# 3. Mode configuration

Suggested initial configuration.

## Quick Play

```text
livingWorldDepth: light

ON:
proceduralNarrative
proceduralMedia
narrativeDirector
persistentCharacters
rivalArchetypes
rivalNarrative
companyMemory
proceduralPostmortem

LIGHT/LIMITED:
characterMemory
relationships

OFF:
advisorOpinions
structuredInterviews
structuredEmployeeConversations
proceduralBoardMeetings
deep promises/callbacks
```

---

## Career

```text
livingWorldDepth: deep

ON:
proceduralNarrative
proceduralMedia
narrativeDirector
persistentCharacters
characterMemory
companyMemory
relationships
advisorOpinions
structuredInterviews
structuredEmployeeConversations
proceduralBoardMeetings
promises
longTermCallbacks
rivalArchetypes
rivalNarrative
proceduralPostmortem
```

---

## Arena

```text
livingWorldDepth: competitive

ON:
proceduralNarrative
proceduralMedia
narrativeDirector
companyMemory
rival/player narrative
proceduralPostmortem

OPTIONAL/LIGHT:
persistentCharacters for talent/investors

OFF:
deep character memory
deep relationships
customer interviews
employee conversations
board meetings
Career-style promises
```

Future Arena deals/alliances may use memory later.

Do not implement that unless PvP mechanics already support it.

---

# 4. Development strategy

Build the shared infrastructure once.

However:

## First implementation target

Career.

Career should be used to prove:

- Character generation
- Memory
- Relationships
- Procedural composition
- Narrative Director
- Advisor disagreement
- Customer interviews
- Promises
- Callbacks

Once stable:

## Reuse selected systems in Quick Play

Then:

## Reuse competitive systems in Arena

Do not attempt to fully implement all mode-specific surfaces simultaneously if doing so risks regressions.

---

# 5. Character system

Create persistent characters for important people.

Possible roles:

- Employees
- Executives
- Investors
- Board members
- Customers
- Rival founders
- Recruiters
- Journalists where useful

Future:

- Co-founders

Suggested:

```ts
interface Character {
  id: string;

  firstName: string;
  lastName: string;

  role: CharacterRole;

  companyId?: string;

  personality: CharacterPersonality;

  motivations: CharacterMotivation[];

  communicationStyle: CommunicationStyle;

  background: CharacterBackground;

  relationships: RelationshipState[];

  memories: CharacterMemory[];

  status: CharacterStatus;
}
```

Characters must persist.

Do not regenerate people every time they appear.

---

# 6. Deterministic character generation

Generate characters from:

- Seed
- Role
- Sector
- Company
- Character index

Suggested:

```ts
generateCharacter({
  seed,
  role,
  sector,
  companyId,
  index
})
```

Never use:

```ts
Math.random()
```

inside simulation/narrative generation.

Same campaign seed should produce the same cast.

---

# 7. Personality

Suggested dimensions:

```ts
interface CharacterPersonality {
  directness: number;
  ambition: number;
  patience: number;
  loyalty: number;
  optimism: number;
  ego: number;
  riskTolerance: number;
  empathy: number;
}
```

Use an internal range such as:

```text
0–100
```

Do not expose numbers directly.

Convert them into readable observations.

Examples:

```text
Highly ambitious
Direct communicator
Patient
Risk tolerant
Strongly loyal
Status conscious
```

---

# 8. Communication styles

Suggested:

```ts
type CommunicationStyle =
  | "direct"
  | "warm"
  | "formal"
  | "analytical"
  | "enthusiastic"
  | "blunt"
  | "cautious";
```

Communication style should affect:

- Openings
- Sentence structure
- Emotional language
- Vocabulary
- Requests
- Closings

Players should gradually recognise voices.

---

# 9. Motivations

Suggested:

```ts
type CharacterMotivation =
  | "money"
  | "career_progression"
  | "status"
  | "autonomy"
  | "mission"
  | "learning"
  | "stability"
  | "power"
  | "winning"
  | "recognition"
  | "work_life_balance";
```

Each important character:

- One primary motivation
- Up to two secondary motivations

Example:

```text
VP Sales

Primary:
Winning

Secondary:
Money
Recognition
```

Another:

```text
Early Engineer

Primary:
Autonomy

Secondary:
Learning
Mission
```

Company decisions should affect them differently.

---

# 10. Background

Suggested:

```ts
interface CharacterBackground {
  careerStage:
    | "rising"
    | "established"
    | "veteran";

  previousEnvironment:
    | "startup"
    | "scaleup"
    | "corporate"
    | "consulting"
    | "agency"
    | "university";

  notableStrength: BackgroundTrait;
  knownWeakness?: BackgroundTrait;

  reasonForJoining?: JoinMotivation;
}
```

Generate short biographies using procedural templates.

Example:

```text
Sofia spent six years selling enterprise software before joining a Series B fintech.

She is known for closing difficult accounts but has never built a sales organisation from scratch.
```

Keep biographies concise.

---

# 11. Relationship system

Career requires persistent relationships.

Suggested:

```ts
interface RelationshipState {
  characterId: string;

  trust: number;
  respect: number;
  alignment: number;
  dependence: number;

  lastMeaningfulInteractionWeek?: number;
}
```

Do not expose exact values.

Surface qualitative states:

```text
Trust: Strong
Respect: High
Alignment: Mixed
Relationship: Strained
```

Quick Play can use only a simplified subset.

Arena can generally avoid this system.

---

# 12. Character Memory

This is one of the highest-priority systems.

Suggested:

```ts
interface CharacterMemory {
  id: string;

  week: number;

  type:
    | "promise"
    | "promotion"
    | "rejection"
    | "conflict"
    | "support"
    | "success"
    | "failure"
    | "betrayal"
    | "recognition"
    | "layoff"
    | "crisis"
    | "hire"
    | "strategy_change";

  actorId?: string;
  targetId?: string;

  importance: number;
  emotionalImpact: number;

  tags: string[];

  summaryKey: string;

  resolved?: boolean;
}
```

Store semantic facts.

Do not store only free-form prose.

---

# 13. Example memory

Week 18:

Player tells Anna she may lead Engineering.

Store:

```ts
{
  week: 18,
  type: "promise",
  targetId: "anna",
  importance: 90,
  emotionalImpact: 70,
  tags: [
    "leadership",
    "engineering",
    "promotion"
  ],
  summaryKey:
    "promised_engineering_leadership"
}
```

Week 48:

External CTO hired.

Memory matcher detects:

```text
external_cto_hired
+
promised_engineering_leadership
```

Generate:

```text
Anna wants to talk.
```

Message may reference the prior promise.

---

# 14. Memory relevance

Implement:

```ts
scoreMemoryRelevance(
  memory,
  event,
  character,
  currentWeek
)
```

Factors:

- Importance
- Recency
- Semantic tag overlap
- Emotional strength
- Unresolved status
- Relationship impact

Old events should only surface when relevant.

---

# 15. Company Memory

Track company-level history.

Suggested:

```ts
interface CompanyMemory {
  id: string;
  week: number;

  type:
    | "first_customer"
    | "first_revenue"
    | "first_hire"
    | "funding_round"
    | "pivot"
    | "major_customer"
    | "major_loss"
    | "layoff"
    | "outage"
    | "acquisition"
    | "profitability"
    | "pmf"
    | "record_growth"
    | "record_revenue"
    | "crisis";

  importance: number;

  metadata: Record<
    string,
    string | number
  >;
}
```

Enable contextual statements like:

```text
Your strongest growth month since Series A.
```

or:

```text
Revenue has finally recovered to its pre-layoff peak.
```

---

# 16. History architecture

Do not duplicate responsibilities.

Use:

### Decision Journal

What the player chose.

### Character Memory

How people remember those choices.

### Company Memory

Important historical company events.

### Simulation History

Raw metrics/state.

### Narrative History

What stories/messages have already been shown.

Keep these separate.

---

# 17. Procedural Narrative Composer

Do not rely mainly on full prewritten messages.

Build messages from semantic fragments.

Example:

```text
OPENING
+
CONTEXT
+
MEMORY CALLBACK
+
INTERPRETATION
+
REQUEST
+
CLOSING
```

Suggested:

```ts
interface NarrativeFragment {
  id: string;

  type:
    | "opening"
    | "context"
    | "memory"
    | "reaction"
    | "request"
    | "closing";

  text: string;

  conditions?: NarrativeConditions;

  tags: string[];

  weight: number;
}
```

---

# 18. Semantic selection

Narrative fragments should only be eligible when appropriate.

Example:

```ts
{
  text: "We need to talk.",

  conditions: {
    minDirectness: 75,
    maxTrust: 60
  }
}
```

Another:

```ts
{
  text:
    "Hey — do you have a few minutes?",

  conditions: {
    minEmpathy: 60,
    minTrust: 50
  }
}
```

Use seeded weighted selection among eligible fragments.

Do not use uncontrolled random copy.

---

# 19. Procedural variation

Create fragment pools for key categories.

Examples:

## Employee

- Promotion frustration
- Compensation
- Executive hired above them
- Recognition
- Strategy disagreement
- Departure risk

## Customer

- Reliability
- Support
- Price
- Missing product requirement
- Competitor pressure
- Renewal

## Investor

- Burn
- Growth
- Valuation
- Competitive position
- Missed commitments

## Board

- Performance
- Management quality
- Runway
- Strategic disagreement
- Commitments

## Rival/media

- Fundraising
- Expansion
- Product launch
- Layoffs
- Acquisition
- Retreat
- Category leadership

---

# 20. Repetition control

Track used:

- Fragment IDs
- Message structures
- Headline patterns
- Narrative tags
- Signature phrases

Suggested:

```ts
interface NarrativeUsageState {
  recentlyUsedFragmentIds: string[];
  recentlyUsedTags: string[];
  recentlyUsedPatterns: string[];
}
```

Apply cooldowns.

Avoid noticeable repetition.

---

# 21. Dynamic Inbox

Career should use inbox as the main living-world surface.

Potential senders:

- Employee
- Executive
- Customer
- Investor
- Board member
- Rival founder
- Journalist
- Recruiter

Message categories:

- Concern
- Opportunity
- Request
- Escalation
- Recognition
- Warning
- Conflict
- Follow-up
- Reminder
- Callback

Suggested:

```ts
interface ProceduralInboxMessage {
  id: string;

  week: number;

  senderCharacterId?: string;

  category: InboxCategory;

  subject: string;
  body: string;

  relatedEventId?: string;
  relatedMemoryIds?: string[];

  importance: number;

  actions?: GameActionOption[];
}
```

Messages must be persisted once generated.

Never regenerate wording simply because the inbox is reopened.

---

# 22. Quick Play inbox

Quick Play should use the same infrastructure but at light depth.

Examples:

```text
Your Head of Engineering is concerned about the current pace.
```

or:

```text
Orbit just announced a major enterprise push.
```

Avoid:

- Long conversations
- Complex relationship management
- Deep memory chains

Quick Play should remain fast.

---

# 23. Arena narrative surface

Arena should focus on competitive events.

Examples:

```text
BREAKING

Orbit poaches Acme's VP Sales ahead of its Series B.
```

```text
PRICE WAR

Three companies have cut prices in the Small Business segment.
```

```text
NOVA ACQUIRES BLOOM FOR $86M

The deal removes one of the market's fastest-growing challengers.
```

Narrative should summarise player behaviour.

Do not slow the match with Career-style dialogues.

---

# 24. Narrative Director

Create one shared Narrative Director.

Its job:

> Decide what deserves narrative attention.

Suggested:

```ts
interface NarrativeCandidate {
  id: string;

  type: string;

  financialImpact: number;
  strategicImpact: number;
  relationshipImpact: number;
  competitiveImpact: number;
  urgency: number;
  novelty: number;
  callbackValue: number;

  tags: string[];
}
```

---

# 25. Mode-specific Narrative Director weights

Do not use identical weighting across modes.

## Quick Play

Prioritise:

- Novelty
- Financial impact
- Entertainment
- Major strategic developments

Example:

```ts
const QUICK_NARRATIVE_WEIGHTS = {
  novelty: 0.30,
  financialImpact: 0.25,
  strategicImpact: 0.20,
  competitiveImpact: 0.15,
  callbackValue: 0.05,
  relationshipImpact: 0.05
};
```

---

## Career

Prioritise:

- Strategy
- Relationships
- Callbacks
- Financial impact

Example:

```ts
const CAREER_NARRATIVE_WEIGHTS = {
  strategicImpact: 0.25,
  relationshipImpact: 0.25,
  callbackValue: 0.20,
  financialImpact: 0.20,
  novelty: 0.10
};
```

---

## Arena

Prioritise:

- Competitive impact
- Strategy
- Market swings
- Novelty

Example:

```ts
const ARENA_NARRATIVE_WEIGHTS = {
  competitiveImpact: 0.40,
  strategicImpact: 0.25,
  financialImpact: 0.15,
  novelty: 0.20
};
```

Adjust after testing.

---

# 26. Weekly narrative hierarchy

Career:

```text
THIS WEEK

1 major story

ALSO HAPPENING

1–3 secondary stories

BACKGROUND

Normal company metrics
```

Quick Play:

Use fewer narrative elements.

Arena:

Use match/round highlights.

---

# 27. Narrative novelty

Reduce priority when similar events recently appeared.

Increase priority for first-time events.

Examples:

- First major customer
- First executive departure
- First acquisition
- First board crisis
- First layoffs
- First outage
- First down round
- First category leadership

---

# 28. Advisor Opinion Engine

Career executives/advisors should interpret identical facts differently.

Do not create one objective recommendation engine.

Each role weights metrics differently.

---

# CFO

Possible weights:

```text
Runway             30%
Margins             25%
CAC                 20%
Revenue quality     15%
Growth              10%
```

---

# Sales leader

```text
Pipeline            30%
Growth              25%
Win rate            20%
Revenue             15%
Runway              10%
```

---

# Product leader

```text
Retention           30%
Activation          25%
PMF evidence        20%
Usage               15%
Revenue             10%
```

---

# Growth investor

```text
Growth              30%
Market share        25%
Fundraising         20%
Revenue             15%
Profitability       10%
```

---

# 29. Advisor disagreement

Example state:

```text
Growth ↑
CAC ↑
Retention ↓
Runway ↓
```

CFO:

```text
Acquisition efficiency is deteriorating. Slow spending.
```

Sales:

```text
Pipeline momentum is the strongest we've had. Cutting now would be a mistake.
```

Product:

```text
The problem isn't Sales. We're acquiring users faster than we're learning to retain them.
```

The player must use judgement.

---

# 30. Advisor competence

Suggested:

```ts
interface AdvisorSkill {
  functionalExpertise: number;
  judgement: number;
  forecasting: number;
}
```

Lower-quality advisors can:

- Miss signals
- Overweight certain metrics
- React late
- Have wider forecast errors

Do not make advice absurd.

Errors should be plausible.

---

# 31. Advisor bias

Combine:

- Role
- Personality
- Incentives

Examples:

Sales:

> tends to overrate pipeline.

Product:

> tends to underweight aggressive distribution.

CFO:

> becomes conservative at low runway.

Growth investor:

> pushes expansion.

Founder-friendly investor:

> tolerates slower growth.

---

# 32. Quick Play advisors

Do not add a deep advisor layer initially.

Quick Play may occasionally surface:

```text
CFO view:
Runway is becoming risky.
```

But avoid multi-person strategy debates unless testing proves they improve pacing.

---

# 33. Arena advisors

Do not implement Career advisors in Arena.

Arena complexity comes from human opponents.

---

# 34. Promise system

Career should support explicit promises/commitments.

Possible promises:

- Reach profitability
- Reduce burn
- Hit revenue target
- Improve retention
- Hire executive
- Launch product
- Enter market
- Avoid layoffs

Suggested:

```ts
interface Promise {
  id: string;

  createdWeek: number;
  deadlineWeek: number;

  type: PromiseType;

  targetValue?: number;

  madeToCharacterIds: string[];

  status:
    | "active"
    | "fulfilled"
    | "missed"
    | "cancelled";

  importance: number;
}
```

---

# 35. Promise callbacks

Example:

Week 35:

```text
You committed to reaching profitability by Week 60.
```

Week 50:

```text
CFO:
We're not currently on track for the profitability commitment.
```

Week 59:

```text
Board:
One week remains before the target you committed to.
```

Week 60 success:

```text
You delivered.
Board trust improves.
```

Failure:

```text
The commitment was missed.
Board trust declines.
```

Promises should create long-term continuity.

---

# 36. Quick Play promises

Only use lightweight promises if already naturally part of board/events.

Do not add a complex promise-management screen.

---

# 37. Arena promises

Do not implement Career promises.

Future PvP agreements may use a different deal/commitment system.

---

# 38. Employee Conversations

Career should support structured employee interactions.

Examples:

- Promotion request
- Compensation request
- Role frustration
- Recognition issue
- Strategy disagreement
- Executive hired above them
- Departure risk

Example:

```text
Anna wants to discuss the new CTO.

A. Explain why external experience is needed.
B. Promise Anna broader responsibility.
C. Improve compensation/equity.
D. Tell her the decision is final.
```

Choices affect:

- Trust
- Respect
- Alignment
- Motivation
- Departure risk
- Memory

---

# 39. Historical employee callback

Example desired output:

```text
We need to talk.

When we discussed my role after Series A, you said I'd have the opportunity to lead Engineering.

After the outage, I thought I'd shown I could do that.

Finding out we're hiring someone above me makes me question where I fit.
```

This must be generated from:

- Current event
- Character personality
- Relevant memory
- Relationship state

Not from hardcoding Anna's specific story.

---

# 40. Quick Play employee narrative

Only lightweight reactions.

Example:

```text
Your Head of Engineering is increasingly frustrated with the pace of work.
```

Do not create deep conversation chains.

---

# 41. Structured Customer Interviews

Career PMF Discovery should use procedural customers.

No free text.

Questions:

```text
How are you solving this today?

When did this problem last happen?

What frustrates you most?

Who decides whether you buy software?

What does the problem cost you?

Would you pay X?

What would stop you switching?

Why?
```

---

# 42. Interview Customer

Suggested:

```ts
interface InterviewCustomer {
  id: string;

  segmentId: string;

  role: string;

  companySize?: number;

  problemFrequency: number;
  painIntensity: number;

  budgetAuthority: boolean;

  priceSensitivity: number;

  innovationAffinity: number;

  politenessBias: number;

  statusQuoBias: number;

  featureRequestBias: number;

  currentAlternative: string;

  communicationStyle: CommunicationStyle;
}
```

Do not expose hidden values.

---

# 43. Customer bias

Support:

- Politeness bias
- Status quo bias
- Feature-request bias
- Innovation enthusiasm
- Price sensitivity
- Authority uncertainty
- Recall bias

A customer may say:

```text
Yeah, I'd definitely consider it.
```

while actual purchase probability is low.

This is deliberate.

The system should teach:

> Stated interest is weaker than behaviour.

---

# 44. Interview responses

Responses should be assembled from state.

Example:

```text
It probably happens two or three times a week.

We mostly handle it with a spreadsheet, although I'm not actually the person who signs off on software.
```

Another:

```text
Maybe once a month.

It's annoying, but honestly our current workaround is good enough.
```

---

# 45. Interview evidence

The game engine determines evidence directly.

Do not parse generated text.

Suggested:

```ts
interface InterviewEvidenceResult {
  metric: EvidenceMetric;
  signal: number;
  reliability: number;
}
```

Text only represents the evidence conversationally.

---

# 46. Board Meetings

Career should support procedural board discussions.

Identify 2–4 important topics.

Possible topics:

- Burn
- Growth
- Retention
- PMF
- Competitor fundraising
- Executive hiring
- Missed commitment
- Strategy changes

Board members react based on:

- Investor type
- Risk tolerance
- Growth orientation
- Control ambition
- Founder trust
- Relevant promises/memories

---

# 47. Board meeting format

Keep concise.

Example:

```text
BOARD MEETING

Topic:
Enterprise Growth

Growth Investor:
Accelerate while we have momentum.

Independent Director:
Retention isn't strong enough yet.

Founder decision:
Accelerate / Maintain / Slow down
```

Do not create huge dialogue trees.

---

# 48. Procedural media

Build a shared media generator.

Pattern:

```text
COMPANY
+
ACTION
+
CONTEXT
```

Actions:

- Raises
- Cuts
- Launches
- Acquires
- Misses
- Expands
- Retreats
- Surpasses
- Loses
- Hires
- Fires

Context:

- Amid funding downturn
- After rapid expansion
- As competition intensifies
- Following enterprise growth
- After months of speculation
- As profitability pressure mounts

Examples:

```text
Orbit raises $42M as enterprise competition intensifies
```

```text
Acme cuts 18% of workforce after rapid expansion
```

Use actual game facts only.

---

# 49. Media by mode

## Quick Play

Media is mainly:

- Entertainment
- World context
- Rival activity

## Career

Media can also affect:

- Reputation
- Investor narrative
- Employee sentiment
- Company history

Do not implement those extra consequences unless existing systems support them cleanly.

## Arena

Media should focus on:

- Competitive shifts
- Player actions
- Rankings
- Acquisitions
- Talent moves

---

# 50. Rival Archetypes

Give AI rivals persistent strategic identities.

Suggested:

```ts
type RivalArchetype =
  | "blitzscaler"
  | "product_perfectionist"
  | "enterprise_machine"
  | "low_cost_disruptor"
  | "brand_leader"
  | "efficient_operator"
  | "platform_builder";
```

---

# 51. Rival behaviour

## Blitzscaler

Prefers:

- Fundraising
- Hiring
- Marketing
- Expansion

## Efficient Operator

Prefers:

- Margin
- Survival
- Conservative hiring
- Limited expansion

## Product Perfectionist

Prefers:

- Product
- Retention
- Lower marketing
- Slower launch

## Enterprise Machine

Prefers:

- High-value customers
- Sales
- Support
- Enterprise product

Rival behaviour should create recognisable patterns.

---

# 52. Rival Founder

Give AI competitors a persistent founder.

Example:

```text
Orbit

Founder:
Maya Chen

Traits:
Highly ambitious
Risk tolerant
Impatient

Company archetype:
Blitzscaler
```

Quick Play should benefit significantly from this.

---

# 53. Rival State Transitions

Suggested:

```ts
type RivalCompanyState =
  | "normal"
  | "hypergrowth"
  | "overextended"
  | "funding_pressure"
  | "cost_cutting"
  | "turnaround"
  | "acquisition_target"
  | "category_leader";
```

Possible evolution:

```text
Normal
→ Hypergrowth
→ Overextended
→ Funding Pressure
→ Cost Cutting
```

Narrative should reflect transitions.

---

# 54. Rival memory/history

Track:

- Funding
- Segment entry
- Product launch
- Failed expansion
- Layoffs
- Acquisitions
- Major hires
- Category leadership

This allows:

```text
Orbit is returning to Enterprise less than a year after its failed consumer expansion.
```

---

# 55. Arena human-player narrative

Where Arena uses human players, do not invent AI strategic personas for them.

Narrate their actual behaviour.

Examples:

```text
Nova has now raised more capital than the rest of the market combined.
```

```text
Acme has cut prices for the third consecutive round.
```

```text
Bloom's acquisition removes the market's fastest-growing challenger.
```

---

# 56. Story-State-Machine foundation

Extend the existing story arc system where useful.

Avoid only linear:

```text
A → B → C → D
```

Prefer branching:

```text
Interested
    ↓
Pilot
 ↙      ↘
Fail    Success
          ↓
     Negotiation
      ↙       ↘
 Renewal    Expansion
```

---

# 57. Story arc model

Suggested:

```ts
interface StoryArcDefinition {
  id: string;

  initialState: string;

  states: Record<
    string,
    StoryArcStateDefinition
  >;
}
```

State:

```ts
interface StoryArcStateDefinition {
  id: string;

  entryConditions?: StoryCondition[];

  narrativeCategory: string;

  possibleTransitions: StoryTransition[];
}
```

Each state should reference:

- Characters
- Narrative tags
- Memory creation
- Possible next states

---

# 58. System collisions

Prioritise situations where multiple systems intersect.

Example:

MegaCorp renewal risk.

Relevant systems:

- Customer concentration
- Revenue
- Product
- Sales
- Board
- Runway

Possible stakeholder reactions:

VP Sales:

```text
We cannot afford to lose them.
```

Product:

```text
Building another custom feature will make the underlying problem worse.
```

CFO:

```text
Losing them reduces runway to nine months.
```

Board:

```text
MegaCorp was central to the growth plan you presented last quarter.
```

This is the core source of emergent storytelling.

---

# 59. Stakeholder reactions

For major Career events, allow 1–3 relevant reactions.

Suggested:

```ts
interface StakeholderReaction {
  characterId: string;
  eventId: string;

  opinion?: AdvisorOpinion;

  narrativeMessageId?: string;
}
```

Do not make everyone react.

Determine relevance based on:

- Function
- Motivation
- Relationship
- Authority
- Relevant memories

---

# 60. Procedural Postmortem

Use the same shared system across modes with different depth.

---

# Quick Play postmortem

Short.

Examples:

```text
You scaled before retention was proven.

Your biggest win:
Enterprise expansion

Your biggest mistake:
Marketing spend accelerated while churn was rising.
```

Add founder archetype.

---

# Career postmortem

Deep.

Suggested sections:

```text
HOW IT STARTED

WHAT YOU DISCOVERED

THE FIRST TURNING POINT

THE DECISION THAT CHANGED THE COMPANY

WHAT WORKED

WHAT HURT YOU

PROMISES KEPT

PROMISES MISSED

KEY PEOPLE

THE FINAL OUTCOME

YOUR FOUNDER PROFILE
```

---

# Arena postmortem

Match recap.

Examples:

```text
Turning Point

Nova's Series B allowed it to dominate customer acquisition for five rounds.
```

```text
Best Move

Bloom acquired Orbit while it had only three months of runway.
```

---

# 61. Founder Profile

Derive from actual behaviour.

Possible dimensions:

- Product orientation
- Sales orientation
- People investment
- Capital aggression
- Cost discipline
- Risk appetite
- Pivot frequency
- Employee loyalty
- Promise reliability
- Delegation later

Possible archetypes:

- Product-Led Operator
- Growth Chaser
- Disciplined Compounder
- Talent Builder
- Capital Maximiser
- Customer Obsessive
- Empire Builder
- Crisis Founder

No archetype should be objectively best.

---

# 62. Procedural founder copy

Example:

```text
PRODUCT-LED OPERATOR

You repeatedly chose product quality before distribution.

That improved retention, but competitors often moved faster into new demand.
```

Another:

```text
GROWTH CHASER

You repeatedly accelerated customer acquisition before retention was fully proven.

It created momentum — and fragility.
```

---

# 63. Content architecture

Keep content separate from simulation.

Suggested structure:

```text
src/game/narrative/

  characters/
    generator.ts
    personalities.ts
    motivations.ts
    relationships.ts
    memory.ts

  fragments/
    employee.ts
    customer.ts
    investor.ts
    board.ts
    media.ts
    rivals.ts
    arena.ts
    postmortem.ts

  composer/
    composeEmployee.ts
    composeCustomer.ts
    composeInvestor.ts
    composeBoard.ts
    composeHeadline.ts
    composePostmortem.ts

  director/
    director.ts
    scoring.ts
    repetition.ts

  advisors/
    opinions.ts
    biases.ts

  interviews/
    customers.ts
    responses.ts

  stories/
    stateMachines.ts
```

Adapt to repository conventions.

---

# 64. Pure functions

Prefer functions such as:

```ts
generateCharacter(...)
scoreMemoryRelevance(...)
createCompanyMemory(...)
composeNarrative(...)
scoreNarrativeCandidate(...)
selectWeeklyStories(...)
generateAdvisorOpinion(...)
composeInterviewResponse(...)
composeHeadline(...)
deriveFounderProfile(...)
```

These should be:

- Pure
- Deterministic
- Testable
- Independent from React

---

# 65. Content quantity

Do not write thousands of full events.

Create fragment libraries.

Initial target:

## Employee

- 15–25 openings
- 30–50 reactions/context fragments
- 20–30 requests
- 10–20 closings

## Customer

Similar.

## Investor/board

Similar.

## Media

- 20–30 action patterns
- 20–30 context clauses

Quality matters more than raw quantity.

---

# 66. Content generation rule

Every meaningful procedural message should ideally depend on at least two contextual dimensions.

Examples:

Bad:

```text
Employee morale is low.
```

Better:

```text
Employee morale is low because workloads have remained high since the Series A.
```

Best:

```text
Anna is frustrated because workloads have remained high since Series A, and the infrastructure project she requested was delayed again.
```

The more grounded in actual state, the more alive the world feels.

---

# 67. Narrative IDs

Create stable IDs.

Example:

```text
week-48_employee-anna_external-cto
```

Use existing event IDs where appropriate.

Avoid duplicate narrative generation after reload.

---

# 68. Narrative persistence

Persist generated narrative.

Do not recompute existing prose every time.

Persist:

- Characters
- Relationships
- Memories
- Company memory
- Promises
- Inbox messages
- Media stories
- Rival states
- Active story arcs
- Narrative usage/repetition state

---

# 69. Save migration

Old Career saves:

1. Generate characters from existing employees/investors/rivals.
2. Initialise personalities deterministically.
3. Initialise relationships.
4. Convert available historical events to Company Memory.
5. Do not fabricate detailed old character memories if data does not support them.
6. Initialise narrative history.

Quick Play:

Existing save migration should be minimal.

Arena:

Preserve multiplayer/session compatibility.

---

# 70. Offline requirement

All systems must work offline.

Do not use:

- Network calls
- Remote generation
- External model endpoints
- Cloud narrative services

---

# 71. Explicitly prohibited dependencies

Do not install:

- OpenAI
- Anthropic
- Gemini
- Local LLM libraries
- Browser inference models
- Embedding libraries
- Vector databases

There should be:

```text
NO API KEY REQUIRED.
```

---

# 72. Performance

Generate narrative only when:

- Week resolves
- Important event triggers
- Board meeting starts
- Interview question is asked
- Conversation starts
- Postmortem is created

Do not recompute the entire narrative world every render.

Cache generated text.

---

# 73. UI — Quick Play

Improve existing surfaces lightly.

Potential:

### Dashboard

One:

```text
THIS WEEK
```

headline.

### Rival panel

Show:

- Rival founder
- Archetype
- Recent major action

### Media

1–3 contextual headlines.

### Ending

Short postmortem + founder profile.

Do not create extra management screens unless essential.

---

# 74. UI — Career

Career receives full Living World surfaces.

Possible:

### Founder Inbox

### Character Profiles

### Advisor Perspectives

### Board Meetings

### Customer Interviews

### Active Commitments

### Media / World Feed

### Company History

### Postmortem

Do not overload the main dashboard.

Progressively disclose depth.

---

# 75. Character Profile UI

Show:

```text
Sofia Marinou
VP Sales

Background
Enterprise software

Known Traits
Highly ambitious
Direct
Risk tolerant

Relationship
High respect
Mixed alignment

History
Joined Week 31
Closed MegaCorp
Promoted Week 49
```

Do not expose raw hidden stats.

---

# 76. Advisor UI

Example:

```text
WHAT THE TEAM THINKS

CFO
Slow acquisition.
Runway is becoming dangerous.

VP Sales
Keep pushing.
Pipeline momentum is unusually strong.

Product
Fix retention first.
Recent cohorts are deteriorating.
```

Keep opinions concise.

---

# 77. Active Commitments UI

Career:

```text
ACTIVE COMMITMENTS

Reach profitability
Deadline: Week 72
Status: At risk

Hire VP Sales
Deadline: Week 61
Status: On track
```

---

# 78. Media feed

Career and Quick Play can share media infrastructure.

Example:

```text
Orbit raises $42M as enterprise competition intensifies

Bloom retreats from Europe after weak consumer growth

Acme passes $10M ARR following strong Small Team adoption
```

Arena:

Use equivalent PvP versions.

---

# 79. Tests — deterministic characters

Test:

- Same seed → same characters.
- Different roles produce varied profiles.
- Names remain stable after reload.
- Traits stay within range.

---

# 80. Tests — memory

Test:

- Major decisions create memory.
- Memory persists.
- Relevant memory scores above irrelevant memory.
- Resolved memory loses relevance appropriately.

---

# 81. Tests — narrative composition

Test:

- Direct characters use direct-compatible fragments.
- Formal characters avoid overly casual language.
- Memories are referenced only when relevant.
- Text remains grammatically valid.
- Same inputs produce same output.

---

# 82. Tests — Narrative Director

Test:

- Major event outranks trivial event.
- New story gets novelty bonus.
- Repetition reduces score.
- Callback increases score.
- Arena prioritises competitive impact.
- Career prioritises relationships/callbacks.
- Quick prioritises novelty/impact.

---

# 83. Tests — advisors

Test:

- CFO responds strongly to runway deterioration.
- Sales responds strongly to pipeline.
- Product responds strongly to retention.
- Advisors can disagree.
- Competence affects error.

---

# 84. Tests — promises

Career:

- Promise created.
- Deadline tracked.
- Warning generated.
- Fulfilment detected.
- Failure detected.
- Trust consequence applies.
- Callback generated.

---

# 85. Tests — interviews

Career:

- Response reflects hidden customer profile.
- Polite customer can overstate interest.
- Budget authority matters.
- Same profile/question/seed gives same answer.
- Evidence is created structurally.

---

# 86. Tests — rivals

Test:

- Archetype changes behaviour.
- Rival state transitions work.
- Rival media reflects real events.
- Rival history persists.
- Quick Play benefits without needing Career systems.

---

# 87. Tests — mode depth

Verify:

## Quick

```text
livingWorldDepth = light
```

No deep interview/relationship screens.

## Career

```text
livingWorldDepth = deep
```

Full system available.

## Arena

```text
livingWorldDepth = competitive
```

Competitive narrative only.

---

# 88. Tests — persistence

Test:

- Characters save/load.
- Memories save/load.
- Generated messages remain unchanged.
- Promises save/load.
- Rival states save/load.
- Narrative history saves/load.
- Old saves remain compatible.

---

# 89. Acceptance criteria

The shared Living World engine is complete when:

1. One shared procedural narrative architecture exists.
2. Quick, Career and Arena configure it differently.
3. Quick Play uses light procedural world-building.
4. Career uses deep character/history mechanics.
5. Arena uses competitive narrative.
6. Characters are persistent.
7. Personality affects behaviour and writing.
8. Motivations affect reactions.
9. Career relationships persist.
10. Career characters remember meaningful events.
11. Company history is tracked.
12. Procedural messages combine semantic fragments.
13. Messages reference actual game state.
14. Narrative repetition is actively reduced.
15. Narrative Director prioritises important developments.
16. Narrative weighting differs by mode.
17. Career advisors interpret state differently.
18. Advisors can plausibly disagree.
19. Career promises create future callbacks.
20. Career employee conversations reference history.
21. Career customer interviews work procedurally.
22. Customer bias exists.
23. Interview evidence is structural.
24. Procedural media reflects real events.
25. AI rivals have persistent archetypes.
26. Rival behaviour reflects archetype.
27. Rival companies develop history.
28. Arena can narrate human player competition.
29. Story-state-machine foundation works.
30. Quick Play has a short procedural postmortem.
31. Career has a deeper procedural postmortem.
32. Arena has a match recap.
33. Everything is deterministic.
34. Everything works offline.
35. No LLM/API dependency exists.
36. Existing PMF systems remain functional.
37. Quick Play pacing remains fast.
38. Arena gameplay remains fast.
39. Existing saves remain safe.
40. Tests pass.
41. TypeScript strict mode passes.
42. `npm run build` passes.

---

# 90. Non-goals

Do NOT implement:

- Live AI calls
- OpenAI
- Anthropic
- Gemini
- Local LLMs
- Free-text AI conversations
- Voice
- Speech generation
- AI-generated images
- Vector databases
- Embeddings
- Semantic search infrastructure
- Full Arena PvP overhaul
- Full culture system unless already part of another phase
- Founder Attention unless already scheduled separately
- Full executive simulation beyond what's necessary for advisor perspectives
- Crypto/token systems

---

# 91. Recommended implementation order

## Phase 1 — Shared foundation

Inspect:

- Current employees
- Rival AI
- Events
- Story arcs
- Inbox
- Career PMF
- Decision journal
- Persistence
- GameRules
- Capabilities
- Seeded RNG

Then implement:

- LivingWorldDepth
- Capabilities
- Character model
- Personality
- Motivations
- Background
- Character generation

---

## Phase 2 — Memory

Implement:

- Character Memory
- Company Memory
- Relationship state
- Memory relevance
- Narrative history

---

## Phase 3 — Procedural Composer

Implement:

- Fragment model
- Fragment libraries
- Eligibility conditions
- Seeded weighted selection
- Repetition control

---

## Phase 4 — Career Dynamic Inbox

Use Career first to prove:

- Contextual messages
- Character voice
- Memory callbacks
- Actions

---

## Phase 5 — Narrative Director

Implement shared director.

Then create:

- Quick weights
- Career weights
- Arena weights

---

## Phase 6 — Career Advisors

Implement:

- CFO
- Sales
- Product
- Investor perspectives
- Competence
- Bias
- Disagreement

---

## Phase 7 — Career Promises

Implement:

- Promise creation
- Deadline
- Warnings
- Success/failure
- Relationship impact
- Callback narrative

---

## Phase 8 — Career Structured Interactions

Implement:

- Customer interviews
- Employee conversations
- Board meetings

---

## Phase 9 — Rival World

Implement:

- Rival archetypes
- Rival founder profiles
- State transitions
- Rival history
- Media generator

This should improve both Career and Quick Play.

---

## Phase 10 — Quick Play integration

Enable selected shared systems:

- Procedural headlines
- Rival personalities
- Lightweight inbox
- Milestone callbacks
- Short postmortem

Do not add Career complexity.

---

## Phase 11 — Arena integration

Enable:

- Competitive Narrative Director
- Match headlines
- Player action summaries
- Market turning points
- Match recap

Do not add Career relationship systems.

---

## Phase 12 — Story State Machines

Convert 1–2 existing story arcs as proof of concept.

Validate before migrating the rest.

---

## Phase 13 — Postmortems

Implement:

- Quick summary
- Career company story
- Arena recap
- Founder profile

---

## Phase 14 — Persistence migration

Verify all modes.

---

## Phase 15 — Regression testing

Verify:

- Quick Standard
- Quick Daily
- Quick Scenarios
- Career
- PMF Discovery
- Arena
- Leaderboards
- Achievements
- Existing events
- Multiplayer
- Persistence
- Determinism

---

## Phase 16 — Build

Run:

```bash
npm run build
```

Fix all:

- TypeScript errors
- Test failures
- Persistence regressions
- Determinism regressions
- Quick Play pacing regressions
- Arena regressions

---

# 92. Final delivery report

When complete, report:

## Shared architecture

Explain:

- LivingWorldDepth
- Capabilities
- Shared narrative engine
- Shared character system
- Narrative Director

## Quick Play

Explain what was enabled.

Confirm it remains lightweight.

## Career

Explain:

- Character depth
- Memory
- Relationships
- Advisors
- Interviews
- Promises
- Board
- Conversations

## Arena

Explain:

- Competitive narrative
- Headlines
- Match events
- Recap

## Procedural content

Report:

- Fragment libraries added
- Narrative categories
- Approximate number of authored fragments

Do not claim a misleading number of total possible combinations unless calculated.

## Determinism

Explain RNG strategy.

## Persistence

Explain how:

- Characters
- Memories
- Generated messages
- History

are persisted.

## Offline

Explicitly confirm:

```text
No live AI/LLM calls exist.
No external AI SDK is installed.
No API key is required.
The Living World works fully offline.
```

## Testing

Report:

- Tests added
- Tests passed
- Headless simulations
- Build result

## Known limitations

List unsupported narrative situations.

---

# 93. Quality bar

The system succeeds if Career can naturally produce a story such as:

```text
Week 18

You tell Anna she will have the opportunity to lead Engineering.

Week 31

Anna leads the company's response to its biggest outage.

Week 42

The company raises Series A.

Week 48

You hire an experienced external CTO.

Week 49

Anna sends:

"We need to talk.

When we discussed my role after the Series A, you said I'd have the opportunity to lead Engineering.

After the outage, I thought I'd shown I could do that.

Finding out we're bringing someone in above me makes me question where I fit."

The player must decide how to respond.
```

Meanwhile Quick Play may produce:

```text
Orbit raises $38M after aggressive enterprise expansion.

Your Head of Engineering warns that the current pace is beginning to affect morale.
```

And Arena may produce:

```text
PRICE WAR

Nova and Bloom have both cut prices in the SMB segment.

Acme has refused to follow.
```

All three examples should come from the same underlying narrative infrastructure.

---

# 94. Final design rule

When evaluating a narrative feature, ask:

> Is this different because of what actually happened in this game?

If not, it is probably just flavour text.

Prioritise:

- Causality
- Memory
- Personality
- Relationships
- Competitive context
- Callbacks
- System collisions

over simply writing more event cards.

The final product goal is:

> Quick Play feels alive.
> Career remembers you.
> Arena tells the story of the fight.