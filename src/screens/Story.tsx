// The Run Biography — the timeline nobody had to keep, read back as chapters.
//
// A pure render over buildStory(s): no state is written, no RNG is touched, and everything on
// screen is a fact the run already recorded about itself. Works in every mode — a Quick Play
// run still has its raises, pivots, milestones and ending; a week-3 run honestly has nothing.

import { useState } from 'react'
import { EmptyState, Panel } from '../components'
import { buildStory, storyChapters, storyEnding, type StoryBeat, type StoryTone } from '../game/story'
import { sectorById } from '../game/data'
import { GAME_URL } from '../theme'
import { useStore } from '../store'

const DOT: Record<StoryTone, string> = { good: 'bg-good', bad: 'bg-bad', neutral: 'bg-line2' }

// `StoryBeat.weight` (0–100) is the run's own answer to "how much did this week matter". The share
// card has read it since it shipped (`definingBeats`); this screen never did, so a $12M round and a
// designer's third week landed at identical size. Importance is carried by white and by size; the
// dot's hue still means tone and only tone, because a heavy beat is not a good one.
type Emphasis = 'major' | 'normal' | 'minor'
const emphasis = (weight: number): Emphasis => (weight >= 70 ? 'major' : weight >= 45 ? 'normal' : 'minor')

const BEAT_TEXT: Record<Emphasis, string> = {
  major: 'text-[14.5px] font-semibold text-ink',
  normal: 'text-[13.5px] text-ink',
  minor: 'text-[12.5px] text-mut',
}
// Scale, never width: a transform is centred on the dot, so a dot of any size stays on the rail.
// Changing h/w would walk each row's dot off the line by half the difference.
const BEAT_DOT: Record<Emphasis, string> = {
  major: 'mt-[9px] scale-[1.6]',
  normal: 'mt-[7px]',
  minor: 'mt-[7px] scale-75 opacity-70',
}

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
          <h1 className="font-[family-name:var(--font-display)] text-[28px] font-normal leading-none tracking-normal">The story of {game.companyName}</h1>
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
                  <BeatRow key={i} beat={b} />
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
                {/* the rail: one quiet line through the chapter's weeks, centred on the dots (40px
                    week column + 12px gap + half a 6px dot) so the scaled ones stay threaded on it */}
                <span className="absolute top-2 bottom-2 left-[55px] w-px bg-line/60" aria-hidden />
                {ch.beats.map((b, i) => (
                  <BeatRow key={i} beat={b} />
                ))}
              </div>
              {/* §25: the autopsy and the founder payout are gone from the foot of the final
                  chapter. The results overlay prints both at full size, the network ending's beat
                  already quotes its autopsy verbatim, and Career's "All runs" keeps every run's
                  payout as its score. This screen is the timeline, not the scoreboard. */}
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

function BeatRow({ beat }: { beat: StoryBeat }) {
  const em = emphasis(beat.weight)
  return (
    <div className={`relative flex gap-3 ${em === 'major' ? 'py-2.5' : 'py-1.5'}`}>
      <span className={`w-10 shrink-0 pt-px text-right text-[11px] font-semibold tnum ${em === 'major' ? 'text-ink' : 'text-mut'}`}>
        wk {beat.week}
      </span>
      <span className={`z-10 h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-bg2 ${DOT[beat.tone]} ${BEAT_DOT[em]}`} aria-hidden />
      <span className={`min-w-0 flex-1 leading-relaxed ${BEAT_TEXT[em]}`}>{beat.text}</span>
    </div>
  )
}
