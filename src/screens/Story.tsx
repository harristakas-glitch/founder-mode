// The Run Biography — the timeline nobody had to keep, read back as chapters.
//
// A pure render over buildStory(s): no state is written, no RNG is touched, and everything on
// screen is a fact the run already recorded about itself. Works in every mode — a Quick Play
// run still has its raises, pivots, milestones and ending; a week-3 run honestly has nothing.

import { useState } from 'react'
import {
  Banknote,
  Camera,
  Coins,
  Flag,
  Gavel,
  Handshake,
  Landmark,
  RefreshCw,
  Rocket,
  Target,
  TrendingDown,
  Trophy,
  UserMinus,
  Vote,
  type LucideIcon,
} from 'lucide-react'
import { Btn, EmptyState, NESTED, Panel, RAISED } from '../components'
import { buildStory, storyChapters, storyEnding, type StoryBeat, type StoryTone } from '../game/story'
import { sectorById } from '../game/data'
import { GAME_URL } from '../theme'
import { useStore } from '../store'

const DOT: Record<StoryTone, string> = { good: 'bg-good', bad: 'bg-bad', neutral: 'bg-line2' }

// `StoryBeat.weight` (0–100) is the run's own answer to "how much did this week matter". The share
// card has read it since it shipped (`definingBeats`); this screen never did, so a $12M round and a
// designer's third week landed at identical size. Importance is carried by composition: a major
// beat is a nested card with an icon tile, a normal one a plain sentence, a minor one a muted row.
// The dot in the week chip still means tone and only tone, because a heavy beat is not a good one.
type Emphasis = 'major' | 'normal' | 'minor'
const emphasis = (weight: number): Emphasis => (weight >= 70 ? 'major' : weight >= 45 ? 'normal' : 'minor')

// A beat's KIND, read off the recorded sentence. `buildStory` writes stable sentence shapes
// (src/game/story.ts) but deliberately stores no kind field — so the icon is derived here, the
// same way story.ts itself derives beats by matching the inbox's recorded titles. First match
// wins; anything unrecognised falls back to the flag, which is honest about being "a moment".
const BEAT_ICONS: [RegExp, LucideIcon][] = [
  [/no.confidence|vote of no confidence|governance binds|tear up a passed vote/i, Vote], // governance
  [/token sheds|account hits zero/i, TrendingDown], // the crash, the bankruptcy
  [/holders leave in numbers/i, UserMinus], // the exodus
  [/token|sell from your own position|network passes/i, Coins], // the token economy
  [/wire hit the account|down round|emergency bridge|covenant/i, Banknote], // funding
  [/board/i, Gavel], // ultimatums, strikes, defiance, the firing
  [/product-market fit|milestone/i, Target], // milestones
  [/^pivot #/i, RefreshCw], // pivots
  [/files to go public|rings the bell|shelves its ipo/i, Landmark], // the public markets
  [/promise kept|promise broken/i, Handshake], // promises settled
  [/is acquired|acquires /i, Handshake], // M&A, either direction
  [/unicorn/i, Trophy], // the $1B crossing
  [/opens for business|launches its/i, Rocket], // the founding, product launches
]
const beatIcon = (b: StoryBeat): LucideIcon => BEAT_ICONS.find(([re]) => re.test(b.text))?.[1] ?? Flag

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
    // The screen's one action, so it wears the one primary treatment.
    <Btn
      variant="primary"
      disabled={busy}
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
      <Camera size={16} aria-hidden="true" />
      {state === 'idle' ? 'Share the story' : state === 'shared' ? 'Shared!' : state === 'downloaded' ? 'Image saved!' : 'Could not render'}
    </Btn>
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
          <h1 className="text-[28px] font-bold tracking-tight">The story of {game.companyName}</h1>
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
                <BeatList beats={beats} />
              </Panel>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3.5">
          {chapters.map((ch, ci) => (
            <Panel key={ci} title={ch.title}>
              <BeatList beats={ch.beats} />
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

function BeatList({ beats }: { beats: readonly StoryBeat[] }) {
  return (
    <div className="relative">
      {/* the rail: one quiet line through the chapter's weeks, centred under the week chips
          (a w-14 column, so its midpoint is 28px in) — the chips' opaque plane-2 fill is what
          lets them sit ON the line rather than beside it */}
      <span className="absolute top-3 bottom-3 left-[27px] w-px bg-line/60" aria-hidden />
      {beats.map((b, i) => (
        <BeatRow key={i} beat={b} />
      ))}
    </div>
  )
}

function BeatRow({ beat }: { beat: StoryBeat }) {
  const em = emphasis(beat.weight)
  const Icon = beatIcon(beat)
  return (
    <div className={`relative flex items-start gap-3 ${em === 'major' ? 'py-2' : 'py-1.5'}`}>
      {/* the week chip on the rail: tnum figure + the tone dot, which means tone and only tone */}
      <span className={`z-10 flex w-14 shrink-0 justify-center ${em === 'major' ? 'mt-2' : 'mt-px'}`}>
        <span
          className={`inline-flex items-center gap-1 rounded-md border border-line/70 bg-surface2 px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap tnum ${
            em === 'major' ? 'text-ink' : 'text-mut'
          }`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[beat.tone]}`} aria-hidden />
          wk {beat.week}
        </span>
      </span>
      {em === 'major' ? (
        // A defining week reads as a card: nested box (plane 2) with the beat's kind as an icon
        // tile raised one step further (plane 3) — adjacent planes only, per the ramp rule.
        <div className={`${NESTED} flex min-w-0 flex-1 items-start gap-3 p-3.5`}>
          <span className={`${RAISED} flex h-10 w-10 shrink-0 items-center justify-center`}>
            <Icon size={20} className="text-accent" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 pt-px text-[14px] leading-relaxed font-semibold text-ink">{beat.text}</span>
        </div>
      ) : (
        <span className={`min-w-0 flex-1 leading-relaxed ${em === 'normal' ? 'text-[13.5px] text-ink' : 'text-[12.5px] text-mut'}`}>
          {beat.text}
        </span>
      )}
    </div>
  )
}
