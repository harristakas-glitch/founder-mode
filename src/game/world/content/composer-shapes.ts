// Message structures — the OPENING + CONTEXT + MEMORY + REACTION + REQUEST + CLOSING skeleton
// from §17, expressed as data so §20's repetition control can rotate the *shape* of a message and
// not only its wording. Two messages built from entirely different fragments still read the same
// if they always arrive in the same order.
//
// `subject` pieces are joined into one line (the inbox title / the headline); `body` pieces each
// become a paragraph. A type with no eligible fragment is dropped unless it is listed in
// `required`, which is also how a shape declares "this variant only exists when there is a memory
// worth calling back to".

import type { FragmentType } from '../types'

export interface MessageShape {
  key: string
  subject: readonly FragmentType[]
  body: readonly FragmentType[]
  /** The shape is unusable unless every one of these has an eligible fragment. */
  required?: readonly FragmentType[]
  /** Headlines are not sentences — the composer must not append a full stop. */
  punctuateSubject?: boolean
  weight?: number
}

const EMPLOYEE_SHAPES: readonly MessageShape[] = [
  {
    key: 'emp.escalation_callback',
    subject: ['opening'],
    body: ['memory', 'context', 'reaction', 'request', 'closing'],
    required: ['opening', 'memory', 'reaction'],
    weight: 3,
  },
  {
    key: 'emp.memory_first',
    subject: ['opening'],
    body: ['memory', 'reaction', 'request', 'closing'],
    required: ['opening', 'memory', 'request'],
    weight: 2,
  },
  {
    key: 'emp.direct_concern',
    subject: ['opening'],
    body: ['context', 'reaction', 'request'],
    required: ['opening', 'reaction'],
    weight: 3,
  },
  {
    key: 'emp.ask',
    subject: ['opening'],
    body: ['context', 'request', 'closing'],
    required: ['opening', 'request'],
    weight: 3,
  },
  {
    key: 'emp.flag',
    subject: ['opening'],
    body: ['reaction', 'context', 'request', 'closing'],
    required: ['opening', 'reaction'],
    weight: 2,
  },
  {
    key: 'emp.short',
    subject: ['opening'],
    body: ['reaction', 'request'],
    required: ['opening', 'request'],
    weight: 2,
  },
]

// Media context clauses are sentence fragments ("amid a broader funding downturn"), so they only
// ever attach to the headline line — never stand alone as a paragraph.
const MEDIA_SHAPES: readonly MessageShape[] = [
  { key: 'med.wire', subject: ['headline', 'context'], body: ['quote'], required: ['headline'], punctuateSubject: false, weight: 4 },
  { key: 'med.brief', subject: ['headline', 'context'], body: [], required: ['headline'], punctuateSubject: false, weight: 2 },
  { key: 'med.plain', subject: ['headline'], body: ['quote'], required: ['headline'], punctuateSubject: false, weight: 2 },
]

export const MESSAGE_SHAPES: Record<string, readonly MessageShape[]> = {
  employee: EMPLOYEE_SHAPES,
  media: MEDIA_SHAPES,
}

/** Audiences without their own structures fall back to the employee skeleton, not to nothing. */
export function shapesFor(audience: string): readonly MessageShape[] {
  return MESSAGE_SHAPES[audience] ?? EMPLOYEE_SHAPES
}
