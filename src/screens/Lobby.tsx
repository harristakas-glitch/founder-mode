import { useState } from 'react'
import { Copy, DoorOpen, Play, Users } from 'lucide-react'
import { SECTORS } from '../game/data'
import { PVP_RULES } from '../game/engine'
import type { Ruleset, SectorId } from '../game/types'
import { myId } from '../net/online'
import { useStore } from '../store'
import { ChatWidget } from '../ChatWidget'

const RULE_LABELS: { key: keyof Ruleset; label: string; hint: string }[] = [
  { key: 'pvp', label: '⚔️ PvP attacks', hint: 'Poach, smear and raid the other founders directly' },
  { key: 'debt', label: '🏦 Bank debt', hint: 'Credit lines with covenants' },
  { key: 'ventures', label: '🧪 New verticals', hint: 'Launch second product lines' },
  { key: 'ipo', label: '🔔 IPO endgame', hint: 'Ring the bell to win big' },
  { key: 'macroShocks', label: '📉 Macro shocks', hint: 'Crashes, rate hikes, oil spikes' },
  { key: 'board', label: '👔 Board reviews', hint: 'Growth targets, strikes, ultimatums' },
  { key: 'energy', label: '🔋 Founder energy', hint: 'Big moves drain you; burnout is real' },
  { key: 'arcs', label: '📖 Story arcs', hint: 'Multi-week storylines (slower, deeper)' },
  { key: 'oneOnOnes', label: '💬 1:1 asks', hint: 'Employees bring problems to your door' },
  { key: 'catastrophes', label: '🔥 Catastrophes', hint: 'Breaches, CVEs, logistics meltdowns' },
]

export function Lobby() {
  const online = useStore((s) => s.online)!
  const beginMatch = useStore((s) => s.beginMatch)
  const leaveOnline = useStore((s) => s.leaveOnline)
  const [sector, setSector] = useState<SectorId>('saas')
  const [rules, setRules] = useState<Ruleset>({ ...PVP_RULES })
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="rise-in w-[560px] max-w-full rounded-3xl border border-line bg-gradient-to-b from-surface to-bg2 p-8 shadow-2xl">
        <div className="text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-mut">Room code — share with your rivals</div>
          <button
            className="mt-2 inline-flex items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 px-6 py-3 font-mono text-4xl font-extrabold tracking-[0.35em] transition-all hover:bg-accent/20"
            onClick={() => {
              navigator.clipboard?.writeText(online.code).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
            title="Copy code"
          >
            {online.code}
            <Copy size={18} className="text-mut" />
          </button>
          {copied && <div className="mt-1 text-xs text-good">Copied!</div>}
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
            <Users size={12} /> Founders in the room ({online.players.length}/4)
          </div>
          <div className="space-y-1.5">
            {online.players.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-line bg-surface2/60 px-4 py-2.5">
                <span>
                  <b>{p.company}</b>
                  {p.id === myId() && <span className="text-mut"> (you)</span>}
                </span>
                <span className="text-xs text-mut">
                  {p.founder === 'technical' ? 'Technical' : 'Business'}
                  {p.host && ' · host'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {online.host ? (
          <>
            <div className="mt-6 mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mut">Market — same for everyone</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SECTORS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSector(s.id)}
                  className={`rounded-lg border px-2 py-2 text-[12.5px] font-semibold transition-all ${
                    sector === s.id ? 'border-accent bg-accent/15' : 'border-line bg-surface hover:border-accent/60'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="mt-5 mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mut">
              Match rules — lean &amp; mean by default
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RULE_LABELS.map((r) => (
                <button
                  key={r.key}
                  title={r.hint}
                  onClick={() => setRules({ ...rules, [r.key]: !rules[r.key] })}
                  className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-all ${
                    rules[r.key]
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-surface text-mut line-through decoration-mut/60 hover:border-accent/40'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              disabled={online.players.length < 2}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-good py-3.5 font-bold text-white shadow-xl shadow-good/25 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
              onClick={() => beginMatch(sector, rules)}
            >
              <Play size={17} />
              {online.players.length < 2 ? 'Waiting for at least one rival…' : `Start the match (${online.players.length} founders)`}
            </button>
          </>
        ) : (
          <div className="mt-6 rounded-xl border border-line bg-surface2/50 px-4 py-3 text-center text-[14px] text-mut">
            <span className="animate-pulse">Waiting for the host to start the match…</span>
            <div className="mt-1.5 text-xs">The host picks the market and the match rules — battle-mode by default: PvP on, story systems off.</div>
          </div>
        )}

        <button className="mx-auto mt-4 flex items-center gap-1.5 text-[13px] text-mut transition-colors hover:text-bad" onClick={leaveOnline}>
          <DoorOpen size={14} /> Leave room
        </button>
      </div>
      <ChatWidget />
    </div>
  )
}
