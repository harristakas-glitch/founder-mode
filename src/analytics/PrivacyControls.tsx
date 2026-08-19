// The off switch, in the Field Guide footer next to the founder's-notes one.
//
// Two checkboxes rather than one, because the model genuinely has three states and collapsing them
// into a single tick box would misdescribe at least one of them to the player. Reading down:
//
//   [x] Anonymous play data     — events with no identifier, nothing written to this device
//   [x] Remember this browser   — a random id kept here, so returning players can be counted
//
// Unticking the first stops everything, immediately: `analyticsActive()` is consulted on every
// capture, so the next event is refused before a client is even constructed, and the subscription
// in client.ts clears the stored id and opts the SDK out behind it. There is no "on next reload".
//
// The whole row renders NOTHING while `analyticsConfigured` is false. A privacy control for a
// system that collects nothing is worse than no control: it implies collection is happening.

import { analyticsConfigured } from './config'
import { setAnonymousConsent, setConsent } from './consent'
import { useConsent } from './ConsentPrompt'

export function PrivacyControls() {
  const consent = useConsent()
  if (!analyticsConfigured) return null

  const collecting = consent.state !== 'denied'
  const remembering = consent.state === 'granted'

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-mut">Play data</span>

      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={collecting}
          // Ticking it returns to the anonymous default rather than to "remembered": moving UP the
          // ladder is always the player's explicit act, never a side effect of undoing something.
          onChange={(e) => (e.target.checked ? setAnonymousConsent() : setConsent(false))}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span>
          Anonymous play data <span className="text-mut">— {collecting ? 'on' : 'off'}</span>
        </span>
      </label>

      <label className={`flex items-center gap-2 text-[13px] ${collecting ? 'cursor-pointer' : 'opacity-40'}`}>
        <input
          type="checkbox"
          checked={remembering}
          disabled={!collecting}
          onChange={(e) => (e.target.checked ? setConsent(true) : setAnonymousConsent())}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span>
          Remember this browser <span className="text-mut">— and upload finished runs</span>
        </span>
      </label>

      <span className="w-full text-[11.5px] leading-relaxed text-mut/85">
        Which sector you picked, how far you got, which ending you reached. Never your company name, never anything you
        typed, never an account. Details in <span className="text-ink">docs/analytics.md</span>.
      </span>
    </div>
  )
}
