import { useState } from 'react'
import { SECTORS } from '../game/data'
import { money } from '../format'
import type { FounderKind, SectorId } from '../game/types'
import { readHall, useStore } from '../store'

const ENDING_ICON: Record<string, string> = { unicorn: '🦄', acquired: '🤝', bankrupt: '💸', fired: '🪑' }

export function NewGame() {
  const startGame = useStore((s) => s.startGame)
  const [name, setName] = useState('')
  const [sector, setSector] = useState<SectorId>('saas')
  const [founder, setFounder] = useState<FounderKind>('technical')
  const hall = readHall()

  return (
    <div className="newgame">
      <div className="card">
        <h1>Founder Mode</h1>
        <div className="sub">You have $200,000, an empty office, and a dream. Build a unicorn — or die trying.</div>

        <label className="field">Company name</label>
        <input
          type="text"
          placeholder="e.g. Hyperloop for Cats, Inc."
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={30}
        />

        <label className="field">Pick your market</label>
        <div className="pick-grid">
          {SECTORS.map((s) => (
            <button key={s.id} className={`pick ${sector === s.id ? 'selected' : ''}`} onClick={() => setSector(s.id)}>
              <div className="n">{s.name}</div>
              <div className="d">{s.blurb}</div>
            </button>
          ))}
        </div>

        <label className="field">What kind of founder are you?</label>
        <div className="pick-grid">
          <button className={`pick ${founder === 'technical' ? 'selected' : ''}`} onClick={() => setFounder('technical')}>
            <div className="n">Technical founder</div>
            <div className="d">You code alongside the team — a serious boost to product development every week.</div>
          </button>
          <button className={`pick ${founder === 'business' ? 'selected' : ''}`} onClick={() => setFounder('business')}>
            <div className="n">Business founder</div>
            <div className="d">You sell and schmooze — free weekly hype, plus better revenue per user.</div>
          </button>
        </div>

        <button
          className="btn primary mt"
          style={{ width: '100%', padding: '13px', fontSize: '1rem' }}
          onClick={() => startGame(name.trim(), sector, founder)}
        >
          Found the company ▸
        </button>

        {hall.length > 0 && (
          <div className="mt" style={{ marginTop: 28 }}>
            <label className="field">Hall of fame — your past runs</label>
            <div className="panel" style={{ padding: '10px 14px' }}>
              {hall.slice(0, 5).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '0.88rem' }}>
                  <span>
                    {ENDING_ICON[r.ending] ?? ''} <b>{r.company}</b>{' '}
                    <span className="muted">
                      · {r.sector} · {r.weeks} wks
                    </span>
                  </span>
                  <b className={r.score > 0 ? 'good-text' : 'muted'}>{r.score > 0 ? money(r.score) : '—'}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
