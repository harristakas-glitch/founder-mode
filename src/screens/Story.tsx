// The Run Biography — the timeline nobody had to keep, read back as chapters.
//
// A pure render over buildStory(s): no state is written, no RNG is touched, and everything on
// screen is a fact the run already recorded about itself. Works in every mode — a Quick Play
// run still has its raises, pivots, milestones and ending; a week-3 run honestly has nothing.

import { useState } from 'react'
import { EmptyState, Panel } from '../components'
import { buildStory, storyChapters, storyEnding, type StoryTone } from '../game/story'
import { sectorById } from '../game/data'
import { GAME_URL } from '../theme'
import { money } from '../format'
import { useStore } from '../store'

const DOT: Record<StoryTone, string> = { good: 'bg-good', bad: 'bg-bad', neutral: 'bg-line2' }

// Same lazy-import discipline as every other share button: the canvas renderer only loads
// the first time someone actually shares, so the biography cannot drag it into the main chunk.
function ShareStoryButton() {
  const game = useStore((s) => s.game)
  const [state, setState] = useState<'idle' | 'shared' | 'downloaded' | 'failed'>('idle')
  const [busy, setBusy] = useState(false)
  if (!game) return null
  const e = storyEnding(game)
  const text = game.gameOver
    ? `Founder Mode — the story of ${game.companyName}: ${e.emoji} ${e.title} in ${game.gameOver.week} weeks. Play: ${GAME_URL}`
    : `Founder Mode — the story of ${game.companyName}, ${game.week} weeks in. Play: ${GAME_URL}`
  return (
    <button
      disabled={busy}
      className="rounded-lg bg-gradient-to-br from-accent to-accent2 px-3.5 py-2 text-[13px] font-bold text-bg shadow-[var(--elev-2)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
      onClick={async () => {
        if (busy) return
        setBusy(true)
        try {
          const r = await import('../shareImage')
            .then((m) => m.shareStoryImage(game, text))
            .catch(() => 'failed' as const)
          setState(r)
          setTimeout(() => setState('idle'), 2200)
        } finally {
          setBusy(false)
        }
      }}
    >
      {state === 'idle' ? '📸 Share the story' : state === 'shared' ? 'Shared!' : state === 'downloaded' ? 'Image saved!' : 'Could not render'}
    </button>
  )
}

export function Story() {
  const game = useStore((s) => s.game)!
  const beats = buildStory(game)
  const chapters = storyChapters(beats)
  const ending = game.gameOver
  const e = storyEnding(game)

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold tracking-tight">The story of {game.companyName}</h1>
          <div className="mb-4 text-[13px] text-mut">
            {sectorById(game.sector).name} · {ending ? `${e.emoji} ${e.title}, week ${ending.week}` : `week ${game.week}, still being written`}
          </div>
        </div>
        <ShareStoryButton />
      </div>

      {/* A young run has no story yet, and pretending otherwise would be worse than saying so. */}
      {beats.length <= 2 ? (
        <>
          <EmptyState
            title="Not much yet"
            hint="Every company starts unremarkable. Raise a round, find fit, break a promise — the weeks that matter will collect here."
          />
          {beats.length > 0 && (
            <div className="mt-3.5">
              <Panel title="So far">
                {beats.map((b, i) => (
                  <BeatRow key={i} week={b.week} tone={b.tone} text={b.text} />
                ))}
              </Panel>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3.5">
          {chapters.map((ch, ci) => (
            <Panel key={ci} title={ch.title}>
              <div className="relative">
                {/* the rail: one quiet line through the chapter's weeks */}
                <span className="absolute top-2 bottom-2 left-[52px] w-px bg-line/60" aria-hidden />
                {ch.beats.map((b, i) => (
                  <BeatRow key={i} week={b.week} tone={b.tone} text={b.text} />
                ))}
              </div>
              {/* the autopsy rides with the final chapter, in the ending's own words */}
              {ending && ci === chapters.length - 1 && ending.detail && (
                <p className="mt-3 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-mut">
                  <b className="text-ink">Autopsy:</b> {ending.detail}
                </p>
              )}
              {ending && ci === chapters.length - 1 && (ending.payout ?? 0) > 0 && (
                <div className="mt-3 text-[13px] text-mut">
                  Founder payout: <b className="text-good tnum">{money(ending.payout ?? 0)}</b>
                </div>
              )}
            </Panel>
          ))}
          <div className="pb-2 text-center text-[11.5px] text-mut">
            Assembled from what the run recorded about itself — nothing here was written after the fact.
          </div>
        </div>
      )}
    </div>
  )
}

function BeatRow({ week, tone, text }: { week: number; tone: StoryTone; text: string }) {
  return (
    <div className="relative flex gap-3 py-1.5">
      <span className="w-10 shrink-0 pt-px text-right text-[11px] font-semibold text-mut tnum">wk {week}</span>
      <span className={`z-10 mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-bg2 ${DOT[tone]}`} aria-hidden />
      <span className="min-w-0 flex-1 text-[13.5px] leading-relaxed">{text}</span>
    </div>
  )
}
