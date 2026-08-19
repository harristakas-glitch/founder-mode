// A two-field external store for "is the field guide open, and at which term".
//
// It is not in the game store because nothing about it belongs in a save, and it is not React
// context because the openers (a chip inside a note, a header button, the `?` key) are scattered
// and context would mean wrapping the app.

import { useSyncExternalStore } from 'react'

interface GuideState {
  open: boolean
  /** Term id to scroll to and highlight, if the guide was opened from a specific word. */
  focus: string | null
}

let state: GuideState = { open: false, focus: null }
const listeners = new Set<() => void>()

const emit = () => {
  for (const fn of listeners) fn()
}

export function openGuide(focus?: string): void {
  state = { open: true, focus: focus ?? null }
  emit()
}

export function closeGuide(): void {
  if (!state.open) return
  state = { open: false, focus: null }
  emit()
}

export function useGuide(): GuideState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => state,
    () => state,
  )
}
