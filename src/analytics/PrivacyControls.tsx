// The off switch, in the Field Guide footer next to the founder's-notes one.
//
// ONE checkbox, because the shipped model has two reachable states and a control should describe
// what is actually happening. The consent record still carries a third state ('granted' — cookie
// and person profile, which the deferred run-journal upload would need), but nothing in the
// interface can reach it, so offering a tick box for it would be offering the player a switch
// wired to nothing.
//
// Unticking stops everything, immediately: `analyticsActive()` is consulted on every capture, so
// the next event is refused before a client is even constructed, and the subscription in client.ts
// clears the stored id and opts the SDK out behind it. There is no "on next reload".
//
// The whole row renders NOTHING while `analyticsConfigured` is false. A privacy control for a
// system that collects nothing is worse than no control: it implies collection is happening.

import { analyticsConfigured } from './config'
import { setAnonymousConsent, setConsent, useConsent } from './consent'

export function PrivacyControls() {
  const consent = useConsent()
  if (!analyticsConfigured) return null

  const collecting = consent.state !== 'denied'

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-mut">Play data</span>

      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={collecting}
          // Ticking it returns to the anonymous default, never to 'granted': moving UP the ladder
          // would have to be the player's explicit act, and there is currently nothing that asks.
          onChange={(e) => (e.target.checked ? setAnonymousConsent() : setConsent(false))}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
        <span>
          Anonymous play data <span className="text-mut">— {collecting ? 'on' : 'off'}</span>
        </span>
      </label>

      <span className="w-full text-[11.5px] leading-relaxed text-mut/85">
        Which sector you picked, how far you got, which ending you reached — and a random number kept in this browser so
        a second visit is not counted as a stranger. Never your company name, never anything you typed, never an
        account, never a cookie. Unticking this erases the number and stops all of it. Details in{' '}
        <span className="text-ink">docs/analytics.md</span>.
      </span>
    </div>
  )
}
