// Sharing: one text, one door to every app (owner, 2026-08-23: "it should directly open the
// apps for share — also write a base text sharing the story and the score").
//
// The door is the Web Share API: navigator.share opens the OPERATING SYSTEM's share sheet —
// WhatsApp, Viber, Slack, Telegram, Messages, whatever is actually installed — on iOS, Android,
// and desktop Chrome/Edge/Safari. That is the only honest way to "open the apps that exist":
// the browser knows what is installed, a web page never does. Where the API is missing
// (Firefox desktop), the per-app intent links below are the fallback, not the main act.
import type { GameState } from './game/types'
import { money } from './format'
import { definingBeats, storyEnding } from './game/story'
import { GAME_URL } from './theme'

/**
 * The base share text: the score AND the story. The headline is the run's outcome in one line;
 * the middle is the run's two defining beats, straight from the story engine — real recorded
 * events, not a template pretending to know what happened.
 */
export function shareRunText(g: GameState): string {
  const go = g.gameOver
  const ending = storyEnding(g)
  const payout = go?.payout ?? 0
  const weeks = go?.week ?? g.week
  const daily = g.challenge ? ` (${g.challenge.label})` : ''
  const headline = `${ending.emoji} ${g.companyName} — ${ending.title}: ${money(payout)} after ${weeks} weeks.${daily}`
  // the two beats that defined the run, as one breath — trimmed of their period so the
  // separator reads as rhythm, not punctuation soup
  const beats = definingBeats(g, 3)
    // the ending beat retells the headline — the road is the journey, not the destination
    .filter((b) => b.week < (go?.week ?? Infinity))
    .slice(0, 2)
    // the story screen's "Milestone:" label is chrome, not story — a message reads better bare
    .map((b) => b.text.replace(/^Milestone:\s*/, '').replace(/\.\s*$/, ''))
    .join(' · ')
  const story = beats ? `My road: ${beats}.` : ''
  const tail = g.challenge ? `Same world, one shot — play it: ${GAME_URL}` : `Built in Founder Mode — can you beat it? ${GAME_URL}`
  return [headline, story, tail].filter(Boolean).join('\n')
}

/**
 * Open the system share sheet with the run. Resolves 'shared' when the sheet took it,
 * 'unavailable' when this browser has no share sheet (the caller falls back to the app row),
 * 'cancelled' when the player closed the sheet — which is not a failure and must not be
 * reported as one.
 */
export async function shareNative(text: string): Promise<'shared' | 'unavailable' | 'cancelled'> {
  if (typeof navigator === 'undefined' || !navigator.share) return 'unavailable'
  try {
    // text carries GAME_URL already; passing url separately too lets targets that only take a
    // link (LinkedIn's sheet entry, e.g.) still receive one
    await navigator.share({ title: 'Founder Mode', text })
    return 'shared'
  } catch (e) {
    // AbortError = the player changed their mind; anything else = a sheet that cannot deliver
    return e instanceof Error && e.name === 'AbortError' ? 'cancelled' : 'unavailable'
  }
}

export interface ShareTarget {
  label: string
  href: string
  /** custom-scheme targets (viber:) cannot open in a popup window — they need a plain open */
  scheme?: boolean
}

/**
 * Per-app intents for the row under the primary button. wa.me and t.me are universal links —
 * the installed app claims them, the web client answers otherwise. Viber only has a custom
 * scheme (nothing happens without the app; the button says where it leads). LinkedIn's feed
 * composer prefills text where its share-offsite endpoint never did. Slack has no public
 * compose URL at all — the system share sheet above is how Slack happens.
 */
export function shareTargets(text: string): ShareTarget[] {
  const enc = encodeURIComponent(text)
  const encUrl = encodeURIComponent(GAME_URL)
  return [
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc}` },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encUrl}&text=${enc}` },
    { label: 'Viber', href: `viber://forward?text=${enc}`, scheme: true },
    { label: '𝕏', href: `https://twitter.com/intent/tweet?text=${enc}` },
    { label: 'LinkedIn', href: `https://www.linkedin.com/feed/?shareActive=true&text=${enc}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encUrl}&quote=${enc}` },
  ]
}
