import { useState } from 'react'
import { ChevronRight, Copy, DoorOpen, Play, Users } from 'lucide-react'
import { NESTED } from '../components'
import { SECTORS } from '../game/data'
import { defaultCapabilities, type CapabilityKey, type GameCapabilities } from '../game/modes'
import type { SectorId } from '../game/types'
import { ROUND_SECONDS } from '../net/config'
import { myId, type NetPlayer } from '../net/online'
import { useStore } from '../store'
import { ChatWidget } from '../ChatWidget'

// Icon and name are separate fields because the name is reused in PROSE: the room states its
// ruleset as one sentence, and a sentence cannot carry emoji. The hint used to be a hover-only
// `title`, which meant a phone could not read what any of these ten switches did.
const RULES: { key: CapabilityKey; icon: string; name: string; hint: string }[] = [
  { key: 'pvpActions', icon: '⚔️', name: 'PvP attacks', hint: 'Poach, smear and raid the other founders directly' },
  { key: 'bankDebt', icon: '🏦', name: 'Bank debt', hint: 'Credit lines with covenants' },
  { key: 'multipleVerticals', icon: '🧪', name: 'New verticals', hint: 'Launch second product lines' },
  { key: 'ipoEndgame', icon: '🔔', name: 'IPO endgame', hint: 'Ring the bell to win big' },
  { key: 'macroShocks', icon: '📉', name: 'Macro shocks', hint: 'Crashes, rate hikes, oil spikes' },
  { key: 'boardReviews', icon: '👔', name: 'Board reviews', hint: 'Growth targets, strikes, ultimatums' },
  { key: 'founderEnergy', icon: '🔋', name: 'Founder energy', hint: 'Big moves drain you; burnout is real' },
  { key: 'storyArcs', icon: '📖', name: 'Story arcs', hint: 'Multi-week storylines (slower, deeper)' },
  { key: 'oneOnOnes', icon: '💬', name: '1:1 asks', hint: 'Employees bring problems to your door' },
  { key: 'catastrophes', icon: '🔥', name: 'Catastrophes', hint: 'Breaches, CVEs, logistics meltdowns' },
]

const ARENA_PRESET = defaultCapabilities('arena')

/** "Bank debt" → "bank debt" mid-sentence, while "PvP attacks" and "IPO endgame" keep their capitals. */
const inSentence = (n: string) => (/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n)

const listPhrase = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

const eyebrow = 'text-[11px] font-bold uppercase tracking-[0.1em] text-mut'

/**
 * One row per founder. Your own row is the same row with an editable name — a player who joined
 * from a shared link never saw the start screen's name field, and everyone should be able to fix
 * a typo. Two branches of near-identical markup drifted; one component with a prop cannot.
 */
function PlayerRow({
  player,
  editable,
  draft,
  onDraft,
}: {
  player: NetPlayer
  editable: boolean
  draft?: string
  onDraft?: (v: string) => void
}) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${editable ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface2'}`}>
      {editable ? (
        <>
          <label htmlFor="lobby-company" className="sr-only">
            Your company name
          </label>
          <input
            id="lobby-company"
            type="text"
            value={draft ?? ''}
            maxLength={24}
            placeholder="Name your company"
            // Committed on every keystroke, not on blur. A <button> does not take focus on click
            // in every browser, so the host could hit Start with the field never blurring — and
            // the name they had just typed would go into the match as "Untitled Inc.".
            onChange={(e) => onDraft?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur() // dismisses the phone keyboard
            }}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[14px] font-bold text-ink outline-none focus-visible:border-accent"
          />
        </>
      ) : (
        <b className="min-w-0 flex-1 truncate text-[14px]">{player.company}</b>
      )}
      <span className="shrink-0 text-xs text-mut">
        {editable && 'you · '}
        {player.founder === 'technical' ? 'Technical' : 'Business'}
        {player.host && ' · host'}
      </span>
    </div>
  )
}

export function Lobby() {
  const online = useStore((s) => s.online)!
  const beginMatch = useStore((s) => s.beginMatch)
  const leaveOnline = useStore((s) => s.leaveOnline)
  const setMyCompany = useStore((s) => s.setMyCompany)
  // start empty when we only have the placeholder name, so the field invites typing
  const [draftName, setDraftName] = useState(online.myCompany === 'Untitled Inc.' ? '' : online.myCompany)
  const [sector, setSector] = useState<SectorId>('saas')
  const [rules, setRules] = useState<GameCapabilities>(ARENA_PRESET)
  const [cap, setCap] = useState(52)
  const [copied, setCopied] = useState(false)

  // A code alone makes the invitee find the site, find Arena, and type five characters correctly.
  // A link does all three, and NewGame reads `?room=` straight into the join field. On a file://
  // build there is no URL worth sharing, so the bare code stands in.
  const joinUrl = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}?room=${online.code}` : null

  const on = RULES.filter((r) => rules[r.key])
  const isPreset = RULES.every((r) => rules[r.key] === ARENA_PRESET[r.key])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="rise-in w-[560px] max-w-full rounded-3xl border border-line bg-gradient-to-b from-surface to-bg2 p-8 shadow-[var(--elev-3)]">
        <div className="text-center">
          <div className={eyebrow}>Room code — share with your rivals</div>
          <button
            className="mt-2 inline-flex items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 px-6 py-3 font-mono text-4xl font-extrabold tracking-[0.35em] transition-all hover:bg-accent/20"
            onClick={() => {
              navigator.clipboard
                ?.writeText(joinUrl ?? online.code)
                .then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
                .catch(() => setCopied(false))
            }}
            aria-label={joinUrl ? 'Copy the join link' : 'Copy the room code'}
          >
            {online.code}
            <Copy size={18} className="text-mut" />
          </button>
          <div className={`mt-1 min-h-[16px] text-xs ${copied ? 'text-good' : 'text-mut'}`}>
            {copied ? 'Copied' : joinUrl ? 'Tap to copy a join link' : 'Tap to copy'}
          </div>
        </div>

        <div className="mt-6">
          <div className={`mb-2 flex items-center gap-1.5 ${eyebrow}`}>
            <Users size={12} /> Founders in the room ({online.players.length}/4)
          </div>
          <div className="space-y-1.5">
            {online.players.map((p) => {
              const mine = p.id === myId()
              return (
                <PlayerRow
                  key={p.id}
                  player={p}
                  editable={mine}
                  draft={mine ? draftName : undefined}
                  onDraft={
                    mine
                      ? (v) => {
                          setDraftName(v)
                          setMyCompany(v)
                        }
                      : undefined
                  }
                />
              )
            })}
          </div>
        </div>

        {online.host ? (
          <>
            <div className={`mt-6 mb-2 ${eyebrow}`}>Market — same for everyone</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SECTORS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSector(s.id)}
                  className={`rounded-lg border px-2 py-2 text-[13px] font-semibold transition-all ${
                    sector === s.id ? 'border-accent bg-accent/15' : 'border-line bg-surface hover:border-accent/60'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className={`mt-5 mb-2 ${eyebrow}`}>Match length</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { weeks: 52, name: '⚡ Sprint — 52 weeks', blurb: 'Fast and vicious. Highest payout wins.' },
                { weeks: 104, name: '🏁 Classic — 104 weeks', blurb: 'The full two-year war.' },
              ].map((o) => (
                <button
                  key={o.weeks}
                  onClick={() => setCap(o.weeks)}
                  className={`rounded-lg border px-2 py-2 text-left transition-all ${
                    cap === o.weeks ? 'border-accent bg-accent/15' : 'border-line bg-surface hover:border-accent/60'
                  }`}
                >
                  <div className="text-[13px] font-semibold">{o.name}</div>
                  <div className="text-[11px] text-mut">{o.blurb}</div>
                </button>
              ))}
            </div>

            {/* Ten pills of equal weight made the ruleset look like ten decisions the host had to
                make before anyone could play. It is one preset with an escape hatch, so it says so
                in one sentence — and it says it HERE, to the only person who can change it. */}
            <div className={`mt-5 mb-2 ${eyebrow}`}>Match rules</div>
            <div className="text-[13px] leading-relaxed">
              <b>{isPreset ? 'Battle mode' : 'Custom rules'}</b>
              {on.length === 0 ? (
                <span className="text-mut"> — every optional system is off.</span>
              ) : (
                <span className="text-mut">
                  {' '}
                  — {listPhrase(on.map((r) => inSentence(r.name)))} {on.length === 1 ? 'is' : 'are'} on. Everything else is off.
                </span>
              )}
            </div>
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[13px] font-semibold text-mut transition-colors outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" />
                Change rules
              </summary>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {RULES.map((r) => (
                  <label key={r.key} className={`${NESTED} flex cursor-pointer items-start gap-2.5 px-3 py-2`}>
                    <input
                      type="checkbox"
                      checked={rules[r.key]}
                      onChange={() => setRules({ ...rules, [r.key]: !rules[r.key] })}
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold">
                        <span aria-hidden="true">{r.icon}</span> {r.name}
                      </span>
                      <span className="block text-[11.5px] leading-snug text-mut">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </details>

            <button
              disabled={online.players.length < 2}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-good py-3.5 font-bold text-bg shadow-[var(--elev-2)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
              onClick={() => beginMatch(sector, rules, cap)}
            >
              <Play size={17} />
              {online.players.length < 2 ? 'Waiting for at least one rival…' : `Start the match (${online.players.length} founders)`}
            </button>
          </>
        ) : (
          // The old copy here also described the ruleset — to the one person who cannot change it,
          // and from a guess: the host's toggles are not broadcast until the match starts, so it
          // was stating something that could already be false.
          <div className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-center text-[14px] text-mut">
            <span className="animate-pulse">Waiting for the host to start the match…</span>
          </div>
        )}

        {/* True for host and rival alike, and the last moment before it starts mattering. */}
        <div className="mt-4 text-center text-[12px] leading-relaxed text-mut">
          Each round is one week. The world advances when every founder is ready, or when the{' '}
          {Math.round((ROUND_SECONDS / 60) * 10) / 10}-minute clock runs out.
        </div>

        <button className="mx-auto mt-3 flex items-center gap-1.5 text-[13px] text-mut transition-colors hover:text-bad" onClick={leaveOnline}>
          <DoorOpen size={14} /> Leave room
        </button>
      </div>
      <ChatWidget />
    </div>
  )
}
