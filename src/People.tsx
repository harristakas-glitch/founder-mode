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

import { Briefcase, Gem, MapPin, Shield, Shuffle, Star, Users, X, Zap, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Btn, CARD, Meter, NESTED, TraitChip, useDialog } from './components'
import { money } from './format'
import { Portrait } from './Portrait'
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_META,
  ALL_STAGES,
  archetype,
  cardAttributes,
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
import type { Person } from './game/types'

const TONE_TEXT = { good: 'text-good', warn: 'text-warn', bad: 'text-bad' } as const

/** A tiny uppercase section label. The one uppercase treatment the design system allows, and it
 *  earns it the same way StatCard's does: short by construction. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-mut">{children}</div>
}

/** One of the three headline attributes: label, figure, and the bar that makes 82 look like 82. */
/** One attribute, compact: icon + label above the figure, a thin meter under it. Brief §10 — three
 *  of these in a row must read at a glance without a section of their own. */
const ATTR_ICON: Record<(typeof ATTRIBUTE_IDS)[number], LucideIcon> = {
  velocity: Zap,
  quality: Gem,
  ownership: Shield,
  adaptability: Shuffle,
  culture: Users,
}

function AttrStat({ id, value }: { id: (typeof ATTRIBUTE_IDS)[number]; value: number }) {
  const meta = ATTRIBUTE_META[id]
  const Icon = ATTR_ICON[id]
  const tone = value >= 68 ? 'good' : value <= 32 ? 'bad' : 'accent'
  return (
    <div className="min-w-0" title={meta.blurb}>
      <div className="flex items-center gap-1 text-mut">
        <Icon size={10} aria-hidden className="shrink-0" />
        <span className="truncate text-[9px] font-bold uppercase tracking-[0.07em]">{meta.label}</span>
      </div>
      <div className="mt-0.5 text-[19px] font-bold leading-none tnum">{value}</div>
      <div className="mt-1">
        <Meter value={value} tone={tone} />
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
  banner,
  topRight,
  note,
  showAttributes = true,
}: {
  person: Person
  ctx: TeamContext
  badges?: CardBadge[]
  rows?: ReactNode
  actions?: ReactNode
  onOpen: () => void
  shortlisted?: boolean
  onShortlist?: () => void
  /** People-pages mockup (2026-08-24): one loud verdict strip across the card top. */
  banner?: { label: string; text: string; bg: string }
  /** replaces the fit% block top-right (Hiring puts the weekly cost there; fit moved to `rows`) */
  topRight?: ReactNode
  /** the founder-style one-liner under the stats — impactSummary, not marketing copy */
  note?: ReactNode
  /** the stage-attribute grid; the mockup cards trade it for tags + stats (Profile keeps all five) */
  showAttributes?: boolean
}) {
  const a = attributes(person)
  const fit = teamFit(person, ctx)
  const tone = fitTone(fit)
  const chips = skillChips(person)

  return (
    <div className={`${CARD} flex h-full flex-col overflow-hidden transition-colors duration-[120ms] hover:border-line2`}>
      {banner && (
        <div className={`border-b px-4 py-1.5 text-[10.5px] font-bold tracking-[0.09em] uppercase ${banner.bg} ${banner.text}`}>
          {banner.label}
        </div>
      )}
      {/* LinkedIn / X grammar: a small circular avatar beside the name, not a full-width banner.
          Owner call, 2026-08-22 — a smaller circle makes the card shorter (the whole card now fits
          a phone viewport, so the person and the CTA are on screen together) and reads the way
          every professional network trained people to read a person. The head-centred `chip` crop
          fills the circle; the shortlist star rides the avatar's corner. */}
      <div className="flex items-start gap-3 p-4 pb-0">
        <button
          onClick={onOpen}
          aria-label={`Open ${person.name}'s profile`}
          className="relative shrink-0 cursor-pointer"
        >
          <span className="block h-14 w-14 overflow-hidden rounded-full border border-line2/70 bg-black/30">
            <Portrait person={person} frame="chip" className="h-full w-full" />
          </span>
          {onShortlist && (
            <span
              role="button"
              tabIndex={0}
              aria-pressed={!!shortlisted}
              aria-label={shortlisted ? `Remove ${person.name} from your shortlist` : `Shortlist ${person.name}`}
              title={shortlisted ? 'On your shortlist' : 'Shortlist to compare'}
              onClick={(e) => {
                e.stopPropagation()
                onShortlist()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onShortlist()
                }
              }}
              className={`absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                shortlisted ? 'border-warn/60 bg-warn/25 text-warn' : 'border-line2/70 bg-surface text-mut hover:text-ink'
              }`}
            >
              <Star size={12} fill={shortlisted ? 'currentColor' : 'none'} aria-hidden />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button onClick={onOpen} className="min-w-0 cursor-pointer text-left">
              {/* The name is the strongest text in the card (brief §35). */}
              <div className="truncate text-[16px] font-bold leading-tight hover:underline">{person.name}</div>
              <div className="truncate text-[12.5px] text-mut">{title(person)}</div>
            </button>
            {/* CONCLUSION FIRST (brief §14, Rule 2). Default: the fit verdict. A caller with a
                banner already carrying the verdict puts the cost here instead (mockup 2026-08-24). */}
            {topRight ?? (
              <div className="shrink-0 text-right">
                <div className={`text-[17px] font-bold leading-none tnum ${TONE_TEXT[tone]}`}>{fit}%</div>
                <div className="mt-0.5 text-[10px] whitespace-nowrap text-mut">{fitLabel(fit)}</div>
              </div>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {/* One archetype, one state label (brief §9, §15) — badge spam is the thing to avoid,
                so `badges` is sliced to its single most important entry by the caller. */}
            <span className="rounded-full border border-[var(--ha)]/45 bg-[var(--ha)]/12 px-2 py-[2px] text-[10.5px] font-semibold text-[var(--ha)]">
              {archetype(person)}
            </span>
            <TraitChip trait={person.trait} />
            {badges.slice(0, 1).map((b) => (
              <span key={b.text} className={`rounded-full border px-2 py-[2px] text-[10px] font-bold ${BADGE_CLS[b.tone]}`}>
                {b.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* A BROWSING CARD, NOT A PROFILE PAGE (design brief §5, Rule 1). What used to live here and
          now lives one click away in Profile: the biography, the full skill list, the recruiter
          fee, and the five-bar stage strip — five abstract bars the player had to decode to reach
          a conclusion the percentage states outright. What is left is exactly the decision:
          who they are, the three attributes this stage rewards, what they cost, and what it does
          to the runway. */}
      <div className="flex flex-1 flex-col px-4 pb-4 pt-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-mut">
          <span className="inline-flex items-center gap-1">
            <Briefcase size={11} aria-hidden /> <span className="tnum">{yearsExperience(person)}</span> yrs
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin size={11} aria-hidden /> {homeBase(person)}
          </span>
        </div>

        {showAttributes && (
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line/60 pt-3">
            {/* Keyed on the STAGE, not the role: the engine weights attributes by stage and has no
                role term at all, so a role-keyed card printed numbers that ranked candidates
                backwards. See `cardAttributes`. */}
            {cardAttributes(ctx.stage).map((id) => (
              <AttrStat key={id} id={id} value={a[id]} />
            ))}
          </div>
        )}

        {/* Two skills and a count, on ONE line (brief §11). Three chips wrapped to two rows on a
            narrow card and pushed everything below it out of view. */}
        <div className="mt-3 truncate border-t border-line/60 pt-2.5 text-[11.5px] text-mut">
          {chips.slice(0, 2).join(' · ')}
          {chips.length > 2 && <span className="text-mut/70"> · +{chips.length - 2}</span>}
        </div>

        {rows && <div className="mt-2.5 border-t border-line/60 pt-2.5">{rows}</div>}

        {note && <div className="mt-2.5 border-t border-line/60 pt-2.5 text-[12px] leading-snug text-mut">{note}</div>}

        {actions && <div className="mt-auto flex gap-1.5 pt-3">{actions}</div>}
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
          <div className="flex w-full shrink-0 justify-center sm:w-[240px] sm:justify-start">
            <div className="h-40 w-40 overflow-hidden rounded-full border border-line2/70 bg-black/30 sm:h-52 sm:w-52">
              <Portrait person={person} frame="chip" className="h-full w-full" />
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
