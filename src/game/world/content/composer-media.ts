// Media fragments — §48's COMPANY + ACTION + CONTEXT pattern, split so the action line and the
// context clause vary independently. 24 actions x 24 clauses is what stops "X raises $Ym after
// rapid expansion" from becoming the only headline the game knows.
//
// Headlines carry no terminal punctuation: the composer joins headline + context into one line
// and leaves it unpunctuated for the media shape (newspapers do not end headlines with a full
// stop, and the inbox renders this as a title).
//
// Slots the caller supplies: company (required by nearly every headline), rival, amount, stage,
// segment, pct, target, role, users, revenue, product. A headline whose slot is missing is
// ineligible, so a funding beat that only passes {company, amount} simply cannot draw the
// acquisition headline — the tags and the slots gate it twice.

import type { Fragment, FragmentLibrary } from '../types'

const headlines: readonly Fragment[] = [
  { id: 'med.hd.raises', type: 'headline', text: '{company} raises {amount}', tags: ['funding'], weight: 4, conditions: { requiresTags: ['funding'] } },
  { id: 'med.hd.closes_round', type: 'headline', text: '{company} closes a {amount} {stage}', tags: ['funding'], weight: 4, conditions: { requiresTags: ['funding'] } },
  { id: 'med.hd.raises_at_valuation', type: 'headline', text: '{company} raises {amount} at a {valuation} valuation', tags: ['funding'], weight: 3, conditions: { requiresTags: ['funding'] } },
  { id: 'med.hd.cuts_prices', type: 'headline', text: '{company} cuts prices in {segment}', tags: ['pricing'], weight: 4, conditions: { requiresTags: ['pricing'] } },
  { id: 'med.hd.price_war', type: 'headline', text: '{company} and {rival} are now in an open price war', tags: ['pricing', 'rival'], weight: 3, conditions: { requiresTags: ['pricing', 'rival'] } },
  { id: 'med.hd.launches', type: 'headline', text: '{company} launches {product}', tags: ['launch'], weight: 4, conditions: { requiresTags: ['launch'] } },
  { id: 'med.hd.ships_quietly', type: 'headline', text: '{company} quietly ships {product}', tags: ['launch'], weight: 2, conditions: { requiresTags: ['launch'] } },
  { id: 'med.hd.acquires', type: 'headline', text: '{company} acquires {target}', tags: ['acquisition'], weight: 4, conditions: { requiresTags: ['acquisition'] } },
  { id: 'med.hd.acquires_for', type: 'headline', text: '{company} acquires {target} for {amount}', tags: ['acquisition'], weight: 4, conditions: { requiresTags: ['acquisition'] } },
  { id: 'med.hd.layoffs_pct', type: 'headline', text: '{company} cuts {pct} of its workforce', tags: ['layoff'], weight: 4, conditions: { requiresTags: ['layoff'] } },
  { id: 'med.hd.layoffs_plain', type: 'headline', text: '{company} lays off staff', tags: ['layoff'], weight: 2, conditions: { requiresTags: ['layoff'] } },
  { id: 'med.hd.misses_targets', type: 'headline', text: '{company} misses its growth targets', tags: ['miss'], weight: 4, conditions: { requiresTags: ['miss'] } },
  { id: 'med.hd.expands', type: 'headline', text: '{company} expands into {segment}', tags: ['expansion'], weight: 4, conditions: { requiresTags: ['expansion'] } },
  { id: 'med.hd.doubles_down', type: 'headline', text: '{company} doubles down on {segment}', tags: ['expansion'], weight: 3, conditions: { requiresTags: ['expansion'] } },
  { id: 'med.hd.retreats', type: 'headline', text: '{company} retreats from {segment}', tags: ['retreat'], weight: 4, conditions: { requiresTags: ['retreat'] } },
  { id: 'med.hd.shelves', type: 'headline', text: '{company} quietly shelves {product}', tags: ['retreat'], weight: 3, conditions: { requiresTags: ['retreat'] } },
  { id: 'med.hd.surpasses', type: 'headline', text: '{company} surpasses {rival} in {segment}', tags: ['leadership', 'rival'], weight: 4, conditions: { requiresTags: ['leadership', 'rival'] } },
  { id: 'med.hd.takes_lead', type: 'headline', text: '{company} takes the lead in {segment}', tags: ['leadership'], weight: 4, conditions: { requiresTags: ['leadership'] } },
  { id: 'med.hd.loses_account', type: 'headline', text: '{company} loses {target} to {rival}', tags: ['loss', 'rival'], weight: 4, conditions: { requiresTags: ['loss', 'rival'] } },
  { id: 'med.hd.wins_account', type: 'headline', text: '{company} wins {target}', tags: ['win'], weight: 4, conditions: { requiresTags: ['win'] } },
  { id: 'med.hd.poaches', type: 'headline', text: "{company} poaches {rival}'s {role}", tags: ['talent', 'rival'], weight: 4, conditions: { requiresTags: ['talent', 'rival'] } },
  { id: 'med.hd.hires_role', type: 'headline', text: '{company} names a new {role}', tags: ['talent'], weight: 3, conditions: { requiresTags: ['talent'] } },
  { id: 'med.hd.loses_role', type: 'headline', text: '{company} loses its {role}', tags: ['talent', 'departure'], weight: 4, conditions: { requiresTags: ['departure'] } },
  { id: 'med.hd.freezes_hiring', type: 'headline', text: '{company} halts hiring', tags: ['austerity'], weight: 3, conditions: { requiresTags: ['austerity'] } },
  { id: 'med.hd.passes_customers', type: 'headline', text: '{company} passes {users} customers', tags: ['milestone', 'growth'], weight: 4, conditions: { requiresTags: ['milestone'] } },
  { id: 'med.hd.doubles_revenue', type: 'headline', text: '{company} doubles revenue to {revenue}', tags: ['milestone', 'growth'], weight: 4, conditions: { requiresTags: ['milestone'] } },
  { id: 'med.hd.running_out', type: 'headline', text: '{company} is running out of road', tags: ['distress'], weight: 4, conditions: { requiresTags: ['distress'] } },
  { id: 'med.hd.shuts_down', type: 'headline', text: '{company} shuts down', tags: ['distress', 'shutdown'], weight: 5, conditions: { requiresTags: ['shutdown'] } },
  { id: 'med.hd.goes_public', type: 'headline', text: '{company} goes public', tags: ['ipo'], weight: 5, conditions: { requiresTags: ['ipo'] } },
  { id: 'med.hd.outage', type: 'headline', text: '{company} goes dark for {hours} hours', tags: ['outage'], weight: 4, conditions: { requiresTags: ['outage'] } },
]

const contexts: readonly Fragment[] = [
  { id: 'med.cx.downturn', type: 'context', text: 'amid a broader funding downturn', tags: ['macro'], weight: 3 },
  { id: 'med.cx.rapid_expansion', type: 'context', text: 'after a year of rapid expansion', tags: ['growth'], weight: 3 },
  { id: 'med.cx.competition', type: 'context', text: 'as competition in {segment} intensifies', tags: ['rival'], weight: 3 },
  { id: 'med.cx.enterprise_growth', type: 'context', text: 'following months of enterprise growth', tags: ['growth'], weight: 3 },
  { id: 'med.cx.speculation', type: 'context', text: 'after months of speculation', tags: ['rumour'], weight: 3 },
  { id: 'med.cx.profitability', type: 'context', text: 'as profitability pressure mounts', tags: ['macro', 'austerity'], weight: 3 },
  { id: 'med.cx.rivals_slow', type: 'context', text: 'as its rivals slow down', tags: ['rival'], weight: 2 },
  { id: 'med.cx.strongest_week', type: 'context', text: 'in the strongest week the category has had this year', tags: ['growth'], weight: 2 },
  { id: 'med.cx.days_after_rival', type: 'context', text: 'days after {rival} did the same', tags: ['rival'], weight: 3, conditions: { requiresTags: ['rival'] } },
  { id: 'med.cx.competitor_stalls', type: 'context', text: 'while its closest competitor stalls', tags: ['rival'], weight: 2 },
  { id: 'med.cx.flat_growth', type: 'context', text: 'after two quarters of flat growth', tags: ['miss'], weight: 3 },
  { id: 'med.cx.consolidates', type: 'context', text: 'as the category consolidates', tags: ['macro', 'acquisition'], weight: 3 },
  { id: 'med.cx.growth_at_any_cost', type: 'context', text: 'in a market that has stopped rewarding growth at any cost', tags: ['macro'], weight: 2 },
  { id: 'med.cx.after_outage', type: 'context', text: 'weeks after a costly outage', tags: ['outage'], weight: 3 },
  { id: 'med.cx.investors_cautious', type: 'context', text: 'as investors turn cautious', tags: ['macro'], weight: 3 },
  { id: 'med.cx.runway', type: 'context', text: 'with roughly {runway} months of runway left', tags: ['distress'], weight: 4 },
  { id: 'med.cx.since_last_raise', type: 'context', text: 'less than a year after its last raise', tags: ['funding'], weight: 3 },
  { id: 'med.cx.churn_climbs', type: 'context', text: 'as churn climbs in {segment}', tags: ['churn'], weight: 3 },
  { id: 'med.cx.sector_freeze', type: 'context', text: 'in the middle of a sector-wide hiring freeze', tags: ['macro', 'austerity'], weight: 2 },
  { id: 'med.cx.strongest_quarter', type: 'context', text: 'on the back of its strongest quarter yet', tags: ['growth'], weight: 3 },
  { id: 'med.cx.land_grab', type: 'context', text: 'as the {segment} land grab accelerates', tags: ['expansion'], weight: 3 },
  { id: 'med.cx.missed_targets', type: 'context', text: 'after quietly missing its last two targets', tags: ['miss'], weight: 3 },
  { id: 'med.cx.leaders_unchallenged', type: 'context', text: "with the category's leaders still unchallenged", tags: ['rival'], weight: 2 },
  { id: 'med.cx.talent_moves', type: 'context', text: 'as talent moves toward the winners', tags: ['talent'], weight: 2 },
  { id: 'med.cx.second_attempt', type: 'context', text: 'on its second attempt', tags: ['retry'], weight: 2 },
  { id: 'med.cx.since_founding', type: 'context', text: 'in the biggest move of its short history', tags: ['milestone'], weight: 2 },
]

const quotes: readonly Fragment[] = [
  { id: 'med.qt.buying_growth', type: 'quote', text: '"They are buying growth they cannot afford," one investor said.', tags: ['funding', 'skeptic'], weight: 3 },
  { id: 'med.qt.fight_earlier', type: 'quote', text: '"This is the fight everyone expected, just earlier," an analyst said.', tags: ['rival'], weight: 3 },
  { id: 'med.qt.defensive_move', type: 'quote', text: 'A rival founder called it "a defensive move dressed up as a strategy."', tags: ['rival', 'skeptic'], weight: 3 },
  { id: 'med.qt.no_comment', type: 'quote', text: '{company} declined to comment.', tags: ['neutral'], weight: 2 },
  { id: 'med.qt.familiar_months', type: 'quote', text: 'Two people familiar with the talks said they had been going on for months.', tags: ['acquisition', 'rumour'], weight: 3 },
  { id: 'med.qt.employees_learned', type: 'quote', text: 'Employees learned about it at the same time as the market.', tags: ['layoff', 'talent'], weight: 3 },
  { id: 'med.qt.somebody_was_going_to', type: 'quote', text: '"Somebody was going to do it," a competitor said. "It was not going to be us."', tags: ['pricing', 'rival'], weight: 3 },
  { id: 'med.qt.watch_margins', type: 'quote', text: '"Watch what happens to the margins," one investor said.', tags: ['pricing', 'skeptic'], weight: 3 },
  { id: 'med.qt.surprised_nobody', type: 'quote', text: 'The move surprised nobody who has been watching {segment}.', tags: ['expansion'], weight: 3 },
  { id: 'med.qt.third_this_quarter', type: 'quote', text: 'It is the third move of its kind in {segment} this quarter.', tags: ['macro'], weight: 3 },
  { id: 'med.qt.insurance_not_conviction', type: 'quote', text: 'An early backer described the round as "insurance, not conviction."', tags: ['funding', 'skeptic'], weight: 3 },
  { id: 'med.qt.customers_noticed', type: 'quote', text: 'Customers noticed before the company said anything.', tags: ['outage', 'churn'], weight: 3 },
  { id: 'med.qt.hard_to_read', type: 'quote', text: 'Nobody in the category is willing to say publicly what it means yet.', tags: ['neutral'], weight: 2 },
  { id: 'med.qt.rival_response', type: 'quote', text: '{rival} is expected to respond within the quarter.', tags: ['rival'], weight: 3, conditions: { requiresTags: ['rival'] } },
]

export const MEDIA_FRAGMENTS: FragmentLibrary = {
  'media.headline': headlines,
  'media.context': contexts,
  'media.quote': quotes,
}
