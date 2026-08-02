import { useState } from 'react'
import { Rocket } from 'lucide-react'
import { SECTORS } from '../game/data'
import { money } from '../format'
import type { FounderKind, SectorId } from '../game/types'
import { readHall, useStore } from '../store'

const ENDING_ICON: Record<string, string> = { unicorn: '🦄', acquired: '🤝', bankrupt: '💸', fired: '🪑' }

function Pick({ selected, onClick, title, blurb }: { selected: boolean; onClick: () => void; title: string; blurb: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-all ${
        selected
          ? 'border-accent bg-accent/15 shadow-lg shadow-accent/10'
          : 'border-line bg-surface hover:border-accent/60'
      }`}
    >
      <div className="text-[14px] font-bold">{title}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-mut">{blurb}</div>
    </button>
  )
}

export function NewGame() {
  const startGame = useStore((s) => s.startGame)
  const [name, setName] = useState('')
  const [sector, setSector] = useState<SectorId>('saas')
  const [founder, setFounder] = useState<FounderKind>('technical')
  const hall = readHall()

  return (
    <div className="flex min-h-screen items-center justify-center p-6 md:p-8">
      <div className="rise-in w-[760px] max-w-full">
        <h1 className="bg-gradient-to-r from-ink to-accent bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
          Founder Mode
        </h1>
        <p className="mt-1.5 mb-7 text-mut">You have $200,000, an empty office, and a dream. Build a unicorn — or die trying.</p>

        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mut">Company name</label>
        <input
          type="text"
          placeholder="e.g. Hyperloop for Cats, Inc."
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
          className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] outline-none transition-colors placeholder:text-mut/50 focus:border-accent"
        />

        <label className="mt-6 mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mut">Pick your market</label>
        <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
          {SECTORS.map((s) => (
            <Pick key={s.id} selected={sector === s.id} onClick={() => setSector(s.id)} title={s.name} blurb={s.blurb} />
          ))}
        </div>

        <label className="mt-6 mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mut">What kind of founder are you?</label>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Pick
            selected={founder === 'technical'}
            onClick={() => setFounder('technical')}
            title="Technical founder"
            blurb="You code alongside the team — a serious boost to product development every week."
          />
          <Pick
            selected={founder === 'business'}
            onClick={() => setFounder('business')}
            title="Business founder"
            blurb="You sell and schmooze — free weekly hype, plus better revenue per user."
          />
        </div>

        <button
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[16px] font-bold text-white shadow-xl shadow-accent/25 transition-all hover:brightness-110 active:scale-[0.99]"
          onClick={() => startGame(name.trim(), sector, founder)}
        >
          <Rocket size={18} /> Found the company
        </button>

        {hall.length > 0 && (
          <div className="mt-8">
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mut">Hall of fame — your past runs</label>
            <div className="rounded-xl border border-line bg-surface px-4 py-2">
              {hall.slice(0, 5).map((r, i) => (
                <div key={i} className="flex items-center justify-between border-b border-line/40 py-2 text-[13.5px] last:border-b-0">
                  <span>
                    {ENDING_ICON[r.ending] ?? ''} <b>{r.company}</b>{' '}
                    <span className="text-mut">
                      · {r.sector} · {r.weeks} wks
                    </span>
                  </span>
                  <b className={`tnum ${r.score > 0 ? 'text-good' : 'text-mut'}`}>{r.score > 0 ? money(r.score) : '—'}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
