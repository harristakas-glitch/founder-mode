// The person card and the person profile — ONE reading of a human being, used by both screens.
//
// The brief asks for the Hiring and Team pages to share a card design; this file is that sharing
// made structural rather than aspirational. `PersonCard` takes a `Person` (the base both
// `Candidate` and `Employee` extend, see src/game/types.ts), the company context, a slot for the
// numbers that differ either side of a signature, and a slot for the actions. Everything else —
// portrait, name, title, background, the three headline attributes, the skill chips, the stage
// affinity strip, the team-fit verdict — is identical, because it IS identical: the same person,
// before and after you hired them.
//
// Every number on the card is computed by src/game/people.ts, which is the same module the weekly
// simulation reads through its three seams. Nothing here is decorative and nothing here is a
// second opinion.

import { Briefcase, MapPin, Star, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Btn, CARD, Meter, NESTED, TraitChip, useDialog } from './components'
import { money } from './format'
import { Portrait } from './Portrait'
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_META,
  ALL_STAGES,
  CARD_ATTRIBUTES,
  ROLE_HELP,
  ROLE_LABEL,
  attributes,
  background,
  bestStage,
  burnLabel,
  burnRisk,
  deskCost,
  fitLabel,
  fitTone,
  homeBase,
  impactSummary,
  isRemote,
  marketSalary,
  outputPoints,
  skillChips,
  stageCurve,
  stageFit,
  stageOutputMultiplier,
  teamFit,
  title,
  valueLabel,
  valueRatio,
  yearsExperience,
  type TeamContext,
} from './game/people'
import type { Person, Stage } from './game/types'

const TONE_TEXT = { good: 'text-good', warn: 'text-warn', bad: 'text-bad' } as const

/** A tiny uppercase section label. The one uppercase treatment the design system allows, and it
 *  earns it the same way StatCard's does: short by construction. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-mut">{children}</div>
}

/**
 * Stage affinity, drawn. Five bars, one per stage, with the company's current stage ringed.
 *
 * This is the brief's centre of gravity — "the same person should be a great pre-seed hire and a
 * mediocre Series A hire" — so it goes on the CARD rather than into the profile. A single number
 * cannot say "peaks now, fades later"; five bars say it without a sentence.
 */
export function StageStrip({ person, stage }: { person: Person; stage: Stage }) {
  const curve = stageCurve(person)
  const best = bestStage(person)
  return (
    <div className="flex items-end gap-[3px]" aria-label={`Stage affinity, best at ${best}`}>
      {curve.map(({ stage: s, fit }) => {
        const here = s === stage
        const h = Math.max(4, Math.round((fit / 100) * 26))
        return (
          <div key={s} className="flex flex-1 flex-col items-center gap-1" title={`${s}: ${Math.round(fit)}/100`}>
            <div
              className={`w-full rounded-[2px] ${here ? 'bg-accent' : fit >= 58 ? 'bg-good/55' : fit <= 42 ? 'bg-bad/45' : 'bg-line2'}`}
              style={{ height: h }}
            />
            <span className={`text-[9px] leading-none ${here ? 'font-bold text-ink' : 'text-mut/70'}`}>
              {s === 'Pre-seed' ? 'PS' : s === 'Seed' ? 'S' : s.replace('Series ', '')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** One of the three headline attributes: label, figure, and the bar that makes 82 look like 82. */
function AttrStat({ id, value }: { id: (typeof ATTRIBUTE_IDS)[number]; value: number }) {
  const meta = ATTRIBUTE_META[id]
  return (
    <div className="min-w-0" title={meta.blurb}>
      <div className="truncate text-[9.5px] font-bold uppercase tracking-[0.08em] text-mut">{meta.label}</div>
      <div className="mt-0.5 text-[21px] font-bold leading-none tnum">{value}</div>
      <div className="mt-1.5">
        <Meter value={value} tone={value >= 68 ? 'good' : value <= 32 ? 'bad' : 'accent'} />
      </div>
    </div>
  )
}

export interface CardBadge {
  text: string
  tone: 'accent' | 'good' | 'warn' | 'bad' | 'info'
}

const BADGE_CLS = {
  accent: 'border-accent/50 bg-accent/25 text-ink',
  good: 'border-good/50 bg-good/25 text-ink',
  warn: 'border-warn/55 bg-warn/25 text-ink',
  bad: 'border-bad/55 bg-bad/30 text-ink',
  info: 'border-info/50 bg-info/25 text-ink',
} as const

/**
 * The card. Portrait, identity, three attributes that matter for the role, three skill chips, the
 * caller's numbers, stage affinity, the fit verdict, the caller's actions.
 *
 * `rows` and `actions` are the only things either screen may vary. That is the point: the hiring
 * grid and the roster grid cannot drift into two card designs, because there is one card.
 */
export function PersonCard({
  person,
  ctx,
  badges = [],
  rows,
  actions,
  onOpen,
  shortlisted,
  onShortlist,
}: {
  person: Person
  ctx: TeamContext
  badges?: CardBadge[]
  rows?: ReactNode
  actions?: ReactNode
  onOpen: () => void
  shortlisted?: boolean
  onShortlist?: () => void
}) {
  const a = attributes(person)
  const fit = teamFit(person, ctx)
  const tone = fitTone(fit)
  const bio = background(person).bio
  const chips = skillChips(person)

  return (
    <div className={`${CARD} flex h-full flex-col overflow-hidden transition-colors duration-[120ms] hover:border-line2`}>
      <div className="relative">
        {/* 5:4 is the mock's framing. On a phone the card is the full column width, and 5:4 of
            375px is 300px of face before the player reaches a single number — so the crop widens
            to 3:2 there. The portrait is one drawing behind `preserveAspectRatio="slice"`, which
            is exactly what lets the frame change without redrawing anything. */}
        <button
          onClick={onOpen}
          aria-label={`Open ${person.name}'s profile`}
          className="block aspect-[3/2] w-full cursor-pointer sm:aspect-[5/4]"
        >
          <Portrait person={person} frame="card" className="h-full w-full" />
        </button>
        {badges.length > 0 && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <span
                key={b.text}
                className={`rounded-full border px-2 py-[3px] text-[10px] font-bold backdrop-blur-[2px] ${BADGE_CLS[b.tone]}`}
              >
                {b.text}
              </span>
            ))}
          </div>
        )}
        {onShortlist && (
          <button
            onClick={onShortlist}
            aria-pressed={!!shortlisted}
            aria-label={shortlisted ? `Remove ${person.name} from your shortlist` : `Shortlist ${person.name}`}
            title={shortlisted ? 'On your shortlist' : 'Shortlist to compare'}
            className={`absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-[2px] transition-colors ${
              shortlisted ? 'border-warn/60 bg-warn/25 text-warn' : 'border-line2/70 bg-black/35 text-mut hover:text-ink'
            }`}
          >
            <Star size={15} fill={shortlisted ? 'currentColor' : 'none'} aria-hidden />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold leading-tight">{person.name}</div>
            <div className="truncate text-[12.5px] text-mut">{title(person)}</div>
          </div>
          <TraitChip trait={person.trait} />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-mut">
          <span className="inline-flex items-center gap-1">
            <Briefcase size={11} aria-hidden /> <span className="tnum">{yearsExperience(person)}</span> yrs
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin size={11} aria-hidden /> {homeBase(person)}
          </span>
        </div>

        <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-mut">{bio}</p>

        <div className="mt-3.5">
          <SectionLabel>Attributes</SectionLabel>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {CARD_ATTRIBUTES[person.role].map((id) => (
              <AttrStat key={id} id={id} value={a[id]} />
            ))}
          </div>
        </div>

        <div className="mt-3.5">
          <SectionLabel>Skills</SectionLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-line2/70 bg-surface2 px-2 py-[3px] text-[10.5px] text-mut">
                {c}
              </span>
            ))}
          </div>
        </div>

        {rows && <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line/70 pt-3 text-[13px]">{rows}</div>}

        <div className="mt-3.5 border-t border-line/70 pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <SectionLabel>Team fit</SectionLabel>
            <span className={`text-[15px] font-bold tnum ${TONE_TEXT[tone]}`}>{fit}%</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-mut">{fitLabel(fit)}</div>
          <div className="mt-2">
            <StageStrip person={person} stage={ctx.stage} />
          </div>
        </div>

        {actions && <div className="mt-auto flex gap-1.5 pt-3.5">{actions}</div>}
      </div>
    </div>
  )
}

// ---------- the full profile ----------

function Bar({ label, value, tone, note }: { label: string; value: number; tone?: 'good' | 'bad' | 'warn' | 'accent'; note?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-[13px] font-bold tnum">{Math.round(value)}</span>
      </div>
      <div className="mt-1">
        <Meter value={value} tone={tone ?? (value >= 68 ? 'good' : value <= 32 ? 'bad' : 'accent')} />
      </div>
      {note && <div className="mt-1 text-[11.5px] leading-snug text-mut">{note}</div>}
    </div>
  )
}

/**
 * The full profile. Large portrait, the whole CV, all five attributes with what each one does,
 * the affinity curve across every stage the company can reach, and — the part the brief actually
 * asks for — HOW THEY AFFECT THE COMPANY, stated as the multipliers the engine really applies.
 *
 * A dialog and not an inline expansion, deliberately: this is opened by the player from a card
 * they clicked, so it interrupts nothing. (The house rule is that the WEEKLY LOOP takes no modals;
 * a thing you asked to see is not an interruption.)
 */
export function PersonProfile({
  person,
  ctx,
  onClose,
  status,
  actions,
}: {
  person: Person
  ctx: TeamContext
  onClose: () => void
  /** The half of the story that differs either side of a signature. */
  status?: ReactNode
  actions?: ReactNode
}) {
  const ref = useDialog(onClose)
  const a = attributes(person)
  const { companies, bio } = background(person)
  const fit = teamFit(person, ctx)
  const mult = stageOutputMultiplier(person, ctx.stage)
  const burn = burnRisk(person)
  const value = valueRatio(person, ctx.stage)
  const market = marketSalary(person.role, person.skill)
  const curve = stageCurve(person)

  // A PORTAL, and it has to be. The screen this is called from sits inside the `rise-in` screen
  // transition, and an ancestor with a `transform` (or a `filter`, or a `backdrop-filter`) becomes
  // the containing block for `position: fixed` — so the profile rendered in place was laid out
  // against the scrolled card grid instead of the viewport and landed off-screen. Every other
  // overlay in the game is mounted from App.tsx, which is why none of them hit this; this one is
  // owned by the screen, so it has to escape it explicitly.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${person.name} — full profile`}
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6"
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      {/* The SHEET scrolls, not the page behind it: a dialog that pushes the viewport around is a
          dialog the player loses. `overscroll-contain` keeps a phone from scrolling the screen
          underneath once the profile hits its own end. */}
      <div
        ref={ref}
        className={`rise-in relative max-h-[92dvh] w-full max-w-[720px] overflow-y-auto overscroll-contain ${CARD}`}
      >
        <button
          onClick={onClose}
          aria-label="Close profile"
          className="sticky top-2.5 z-10 float-right mr-2.5 flex h-9 w-9 items-center justify-center rounded-lg border border-line2/70 bg-black/40 text-mut backdrop-blur-[2px] hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>

        <div className="sm:flex">
          <div className="w-full shrink-0 sm:w-[240px]">
            <div className="aspect-[5/4] w-full sm:aspect-square">
              <Portrait person={person} frame="card" className="h-full w-full" />
            </div>
          </div>
          <div className="min-w-0 flex-1 p-5">
            <div className="text-[22px] font-bold leading-tight tracking-tight">{person.name}</div>
            <div className="text-[13.5px] text-mut">
              {title(person)} <span className="text-mut/70">· {ROLE_LABEL[person.role]}</span>
              <TraitChip trait={person.trait} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mut">
              <span className="inline-flex items-center gap-1">
                <Briefcase size={12} aria-hidden /> <span className="tnum">{yearsExperience(person)}</span> yrs experience
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} aria-hidden /> {homeBase(person)}
              </span>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-mut">{bio}</p>
            {companies.length > 0 && (
              <div className="mt-2 text-[12px] text-mut">
                <span className="text-mut/70">Previously: </span>
                {companies.join(' · ')}
              </div>
            )}
            <div className="mt-3 text-[12.5px] leading-relaxed">{ROLE_HELP[person.role]}.</div>
            {status && <div className={`mt-3 ${NESTED} px-3.5 py-2.5 text-[12.5px] leading-relaxed`}>{status}</div>}
          </div>
        </div>

        <div className="grid gap-5 border-t border-line/70 p-5 md:grid-cols-2">
          <div>
            <SectionLabel>Attributes — all five feed weekly output</SectionLabel>
            <div className="mt-2.5 space-y-3">
              {ATTRIBUTE_IDS.map((id) => (
                <Bar key={id} label={ATTRIBUTE_META[id].label} value={a[id]} note={ATTRIBUTE_META[id].blurb} />
              ))}
            </div>
            <div className="mt-3.5 text-[11.5px] leading-relaxed text-mut">
              The five always total {ATTRIBUTE_IDS.length * 50}. Nobody is better at everything — a person is a shape, and{' '}
              <b className="text-ink">skill</b> ({person.skill}/10) is how big that shape is.
            </div>
          </div>

          <div>
            <SectionLabel>Impact on your company</SectionLabel>
            <div className={`mt-2.5 ${NESTED} p-3.5`}>
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-mut">Weekly output at {ctx.stage}</span>
                <span className={`text-[19px] font-bold tnum ${mult >= 1.04 ? 'text-good' : mult <= 0.96 ? 'text-bad' : ''}`}>
                  ×{mult.toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5 text-[12px] leading-relaxed text-mut">{impactSummary(person, ctx.stage)}</div>
            </div>

            <div className="mt-3">
              <div className="flex items-baseline justify-between">
                <SectionLabel>Stage affinity</SectionLabel>
                <span className={`text-[12px] font-bold tnum ${TONE_TEXT[fitTone(fit)]}`}>team fit {fit}%</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {curve.map(({ stage, fit: f }) => (
                  <div key={stage} className="flex items-center gap-2.5">
                    <span className={`w-[62px] shrink-0 text-[11.5px] ${stage === ctx.stage ? 'font-bold text-ink' : 'text-mut'}`}>{stage}</span>
                    <div className="min-w-0 flex-1">
                      <Meter value={f} tone={stage === ctx.stage ? 'accent' : f >= 58 ? 'good' : f <= 42 ? 'bad' : 'warn'} />
                    </div>
                    <span className="w-6 shrink-0 text-right text-[11.5px] font-semibold tnum">{Math.round(f)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[11.5px] text-mut">
                {ALL_STAGES.length} stages, one person. Where the bar is tall, the weekly multiplier above is high.
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
              <div className={`${NESTED} p-3`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-mut">Burn risk</div>
                <div className={`mt-0.5 text-[17px] font-bold tnum ${burn >= 70 ? 'text-bad' : burn >= 55 ? 'text-warn' : ''}`}>
                  {burn}
                </div>
                <div className="text-[11px] text-mut">
                  {burnLabel(burn)} — scales the morale hit while runway is under 8 weeks.
                </div>
              </div>
              <div className={`${NESTED} p-3`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-mut">Value</div>
                <div className={`mt-0.5 text-[17px] font-bold tnum ${value >= 1.04 ? 'text-good' : value <= 0.94 ? 'text-warn' : ''}`}>
                  ×{value.toFixed(2)}
                </div>
                <div className="text-[11px] text-mut">
                  {valueLabel(value)} — {money(person.salary)} against a {money(market)} market rate.
                </div>
              </div>
              <div className={`${NESTED} p-3`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-mut">Desk</div>
                <div className="mt-0.5 text-[17px] font-bold tnum">{deskCost(person) === 0 ? '$0' : money(deskCost(person))}</div>
                <div className="text-[11px] text-mut">
                  {isRemote(person) ? 'Remote — costs the office nothing.' : 'On-site — a desk, weekly.'}
                </div>
              </div>
              <div className={`${NESTED} p-3`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-mut">Output</div>
                <div className="mt-0.5 text-[17px] font-bold tnum">{outputPoints(person, ctx.stage).toFixed(1)}</div>
                <div className="text-[11px] text-mut">Points a week before morale and coordination.</div>
              </div>
            </div>
          </div>
        </div>

        {actions && <div className="flex flex-wrap justify-end gap-2 border-t border-line/70 p-4">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Shared by both screens: the one-line "what would this person do to my roster" hint. */
export function fitSummary(person: Person, ctx: TeamContext): string {
  const f = stageFit(person, ctx.stage)
  const best = bestStage(person)
  return best === ctx.stage
    ? `At their best right now (${Math.round(f)}/100 at ${ctx.stage}).`
    : `Peaks at ${best}; ${Math.round(f)}/100 at ${ctx.stage}.`
}

export { Btn }
