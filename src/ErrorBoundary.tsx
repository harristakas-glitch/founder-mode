import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * The app had no error boundary at all. `main.tsx` mounted <App /> bare, so any throw during
 * render unmounted the entire tree and left the player on an empty <div id="root"> — a white
 * screen with no message, no way back, and nothing to report.
 *
 * That is worse here than in most apps, for two reasons that compound:
 *
 *   1. The service worker (public/sw.js) serves a cached shell offline, so "just reload" can
 *      re-serve the same broken build indefinitely. The blank screen is durable, not transient.
 *   2. The store persists to localStorage under `founder-mode-save`. A save that survives
 *      sanitisation but breaks a render turns the blank screen into a PERMANENT one: every
 *      reload rehydrates the same bad state and crashes the same way. Without a boundary the
 *      only escape is devtools, which is not a thing a player has.
 *
 * So this boundary's job is not decoration. It is to make a crash recoverable without devtools.
 */

/** How much of an error message a player ever sees. Long enough to paste into a bug report. */
export const MAX_ERROR_TEXT = 300

/**
 * The user-facing text for a caught error — and, deliberately, NOT the stack trace.
 *
 * Stacks are excluded on purpose. They name internal module paths and bundle layout, which is
 * information disclosure for no benefit to the player; the full error, stack included, goes to
 * `console.error` where a developer can get at it. The message alone survives because it is what
 * makes a bug report actionable, and this is a client-side game whose only "secret" (the Supabase
 * anon key) is public by design.
 *
 * Exported so test/csp.test.ts can assert both directions: that a real message survives, and that
 * a stack never does, even when the message itself has one glued to it.
 */
export function safeErrorText(e: unknown): string {
  const raw =
    e instanceof Error ? e.message : typeof e === 'string' ? e : e === null ? 'null' : String(e)

  // A thrown value can carry a stack inside its own message (`new Error(String(otherError))` is
  // a common way this happens). Cut at the first stack frame marker rather than trusting that
  // `.message` is free of one.
  const beforeFrames = raw.split(/\n\s*at\s/)[0] ?? ''

  // Newlines collapse: the message renders in a single element, and a multi-line message is how
  // a stack sneaks back in past the check above.
  const flat = beforeFrames.replace(/\s+/g, ' ').trim()

  if (!flat) return 'An unknown error occurred.'
  return flat.length > MAX_ERROR_TEXT ? `${flat.slice(0, MAX_ERROR_TEXT)}…` : flat
}

/** The keys a "start fresh" wipe is allowed to touch. Nothing else in localStorage is ours. */
export const SAVE_KEYS = ['founder-mode-save', 'founder-mode-hall'] as const

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The whole error, stack and component trace included, goes here and only here.
    console.error('[founder-mode] render crashed', error, info.componentStack)
  }

  /**
   * Destructive, and therefore never automatic. A corrupt save is the most likely cause of a
   * crash that survives a reload, but "delete the player's company" is not a decision this code
   * gets to make on its own — it is a button, clearly labelled, that they choose to press.
   *
   * The hall of fame goes with it because a save corrupt enough to crash a render can have come
   * from the same bad write that produced the hall entry.
   */
  private clearSaveAndReload = (): void => {
    try {
      for (const k of SAVE_KEYS) localStorage.removeItem(k)
    } catch {
      // storage disabled or full — the reload below is still worth attempting
    }
    location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    // Every style here is inline. The boundary has to render correctly in the case where the
    // stylesheet itself is what failed to load, so it cannot depend on a single class name.
    // React writes these through CSSOM, which CSP does not govern — see src/csp.ts.
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--color-bg, #0a0e18)',
          color: 'var(--color-ink, #dce5f5)',
          font: '400 15px/1.5 system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <h1 style={{ font: '700 22px/1.2 system-ui, sans-serif', margin: '0 0 12px' }}>
            Founder Mode hit an error.
          </h1>
          <p style={{ margin: '0 0 16px', opacity: 0.85 }}>
            Your saved run is still on this device. Reloading usually fixes it. If the same error
            comes back every time you reload, the save itself is the problem — starting fresh will
            clear it.
          </p>
          <p
            style={{
              margin: '0 0 20px',
              padding: '10px 12px',
              borderRadius: '10px',
              background: 'var(--color-surface2, #1a2338)',
              border: '1px solid var(--color-line2, #33405e)',
              font: '400 13px/1.4 ui-monospace, monospace',
              wordBreak: 'break-word',
            }}
          >
            {safeErrorText(error)}
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => location.reload()}
              style={{
                cursor: 'pointer',
                border: 0,
                borderRadius: '9px',
                padding: '9px 16px',
                font: '700 14px system-ui, sans-serif',
                background: 'var(--color-accent, #7c9aff)',
                color: 'var(--color-bg, #0a0e18)',
              }}
            >
              Reload
            </button>
            <button
              onClick={this.clearSaveAndReload}
              style={{
                cursor: 'pointer',
                borderRadius: '9px',
                padding: '9px 16px',
                font: '600 14px system-ui, sans-serif',
                background: 'transparent',
                color: 'var(--color-ink, #dce5f5)',
                border: '1px solid var(--color-line2, #33405e)',
              }}
            >
              Start fresh (deletes your saved run)
            </button>
          </div>
        </div>
      </div>
    )
  }
}
