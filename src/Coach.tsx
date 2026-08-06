// First-run tutorial: a coach that watches the game state and hands out the next lesson.
// Steps auto-advance when the player actually does the thing — no forced clicking through modals.
import { useEffect, useState } from 'react'
import { GraduationCap, X } from 'lucide-react'
import { STAGE_THRESHOLDS } from './game/data'
import { valuation } from './game/engine'
import type { GameState } from './game/types'
import { useStore, type ScreenId } from './store'

const DONE_KEY = 'fm-coach-done'
const STEP_KEY = 'fm-coach-step'

interface CoachStep {
  text: string
  goto?: ScreenId // optional "take me there" navigation
  gotoLabel?: string
  done: (g: GameState, screen: ScreenId) => boolean
}

const STEPS: CoachStep[] = [
  {
    text: 'Welcome, founder. Two jobs matter right now: find out whether the market wants your idea, and don\'t run out of money. Everything else is noise. Start on the Product screen.',
    goto: 'product',
    gotoLabel: 'Open Product',
    done: (_g, screen) => screen === 'product',
  },
  {
    text: 'Set your team\'s focus: drag User research up to 60–80%. Research fills the Idea Quality gauge — building features before you know what the market wants is how startups burn their first $100k.',
    done: (g) => {
      const a = g.allocation
      const sum = Math.max(1, a.features + a.quality + a.bugs + a.research + a.bet)
      return a.research / sum >= 0.5
    },
  },
  {
    text: 'Now hire ONE engineer. On the Hiring screen, check the "runway after" column stays green before sending an offer — overhiring is the #1 killer of young companies.',
    goto: 'hiring',
    gotoLabel: 'Open Hiring',
    done: (g) => g.employees.length + g.pendingHires.length + g.offersOut.length > 0,
  },
  {
    text: 'Hit Advance Week (bottom of the sidebar) to run the simulation. News and decisions land in your Inbox — amber items block the week until you decide.',
    done: (g) => g.week >= 3,
  },
  {
    text: 'Keep researching until the Idea Quality gauge reveals your demand signal (the white band on the Product screen). It takes a few weeks of focused research.',
    goto: 'product',
    gotoLabel: 'Check the gauge',
    done: (g) => g.researchSignal >= 14 || g.pivots > 0,
  },
  {
    text: 'The signal is in. STRONG → shift focus to features and quality, raise marketing, and grow. WEAK → pivot without sentiment (your research carries over as a bonus). MIXED → your call, but decide fast — the runway is the clock.',
    done: (g) => g.pmf >= 50 || g.pivots > 0,
  },
  {
    text: 'When your valuation nears the Seed bar (Fundraising screen), pitch investors. Dilution is forever — but dead founders keep 100% of nothing. One last rule: watch the Benchmarks panel on the Dashboard; it tells you what a healthy company looks like at your age. Good luck, founder. 🎓',
    goto: 'fundraising',
    gotoLabel: 'See Fundraising',
    done: (g) => valuation(g) >= STAGE_THRESHOLDS['Pre-seed'] || g.stage !== 'Pre-seed',
  },
]

export function Coach() {
  const game = useStore((s) => s.game)
  const screen = useStore((s) => s.screen)
  const setScreen = useStore((s) => s.setScreen)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DONE_KEY) === '1')
  const [step, setStep] = useState(() => {
    const n = Number(localStorage.getItem(STEP_KEY) ?? 0)
    return Number.isInteger(n) && n >= 0 ? n : 0 // a corrupt key must not NaN-index the lesson list
  })

  // auto-advance when the current lesson's goal is met
  useEffect(() => {
    if (dismissed || !game || game.gameOver) return
    if (step < STEPS.length && STEPS[step].done(game, screen)) {
      const next = step + 1
      setStep(next)
      localStorage.setItem(STEP_KEY, String(next))
      if (next >= STEPS.length) localStorage.setItem(DONE_KEY, '1')
    }
  }, [game, screen, step, dismissed])

  if (dismissed || !game || game.gameOver || step >= STEPS.length) return null
  // a veteran mid-game doesn't need the kindergarten track
  if (game.week > 40) return null
  const s = STEPS[step]

  return (
    <div className="mb-4 rounded-xl border border-accent2/35 bg-accent2/[0.07] px-4 py-3">
      <div className="flex items-start gap-2.5">
        <GraduationCap size={17} className="mt-0.5 shrink-0 text-accent2" />
        <div className="flex-1 text-[13px] leading-relaxed">
          <span className="mr-1.5 rounded bg-accent2/20 px-1.5 py-px text-[10px] font-bold whitespace-nowrap text-accent2 tnum">
            COACH {step + 1}/{STEPS.length}
          </span>
          {s.text}
          {s.goto && screen !== s.goto && (
            <button className="ml-2 font-bold text-accent2 underline underline-offset-2 hover:brightness-125" onClick={() => setScreen(s.goto!)}>
              {s.gotoLabel} →
            </button>
          )}
        </div>
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mut transition-colors hover:bg-surface2 hover:text-ink"
          aria-label="Skip the tutorial"
          title="Skip the tutorial"
          onClick={() => {
            localStorage.setItem(DONE_KEY, '1')
            setDismissed(true)
          }}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
