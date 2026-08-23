// A deterministic ANIME / cel-shaded portrait, seeded entirely by (name, role).
//
// WHY ANIME, AND WHY DRAWN AT ALL
// ------------------------------------------------------------------------------------------------
// Owner decision 2026-08-22, after a side-by-side bake-off at the sizes that actually ship. At
// 44px — the card avatar on a phone — a semi-realistic face is an indistinguishable brown blob:
// noses, jaws and skin shading are the first things to turn to mud when you shrink a face, and
// they are exactly what realism spends its detail on. Anime keeps the cues that survive: big eyes
// with a highlight, hard two-tone cel shading, and a bold hair SILHOUETTE, which is what the eye
// actually recognises when a face is tiny. The point of a portrait here is that a player LEARNS a
// cast, so legibility at small sizes is the whole job.
//
// Photographs are the stated end goal, and this is the floor under them, not a rival to them: the
// roster spec (docs/roster-design.md) gives each person an optional `photo`, and a person with one
// renders it instead. Absent-means-draw, so the game never breaks on a missing image and offline /
// CSP / licensing are all satisfied by construction.
//
// PURE and DETERMINISTIC: no rng from the simulation stream (this is not in `src/game/`), no
// external asset, no `innerHTML` — every shape is a real JSX element so the strict CSP's
// no-injection property holds. The same person always draws the same face.

import { useId } from 'react'
import type { Person } from './game/types'

function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function hash(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// [base, shadow, light]
const SKIN: [string, string, string][] = [
  ['#ffe0c4', '#e8b892', '#fff2e2'],
  ['#f7cfa8', '#dba578', '#ffe9d2'],
  ['#e8b489', '#c68a5c', '#f7d6b6'],
  ['#c98d61', '#a06840', '#e3b58c'],
  ['#9c6540', '#75462a', '#c08a63'],
  ['#6f4529', '#4e2e18', '#946642'],
]
// [base, shadow]
const HAIR: [string, string][] = [
  ['#2b2b33', '#16161c'],
  ['#4a3428', '#2e1f18'],
  ['#8a5a34', '#5f3a20'],
  ['#d9a441', '#a97a25'],
  ['#c4453a', '#8e2c25'],
  ['#5b4a8a', '#3a2f5e'],
  ['#3f6d8a', '#284a61'],
  ['#b0b6c2', '#7d8391'],
  ['#d16b9a', '#9c456e'],
]
const CLOTH: [string, string][] = [
  ['#2f3542', '#454c5c'],
  ['#3a4a5c', '#4f6478'],
  ['#4a3a52', '#61506b'],
  ['#2f4a42', '#40625a'],
  ['#5c4632', '#7a604a'],
  ['#1f2733', '#333c4b'],
]
const BACK: [string, string][] = [
  ['#3b2f5e', '#22203a'],
  ['#1f3b4d', '#16283a'],
  ['#4d2f3b', '#31202a'],
  ['#2f4d3b', '#1f3329'],
  ['#4d452f', '#332e1f'],
]
const IRIS = ['#5a4632', '#7a5230', '#3f6a7a', '#3f7a55', '#6a4a8a', '#8a4a4a', '#2f5f8a']
const CUT = ['spike', 'bob', 'long', 'sidesweep', 'twin', 'buzz', 'wavy', 'ponytail', 'messy'] as const

export interface Look {
  skin: [string, string, string]
  hair: [string, string]
  cloth: [string, string]
  back: [string, string]
  iris: string
  cut: (typeof CUT)[number]
  glasses: boolean
  facialHair: 'none' | 'stubble' | 'goatee' | 'full'
  eyeH: number
  eyeW: number
  eyeShape: 'round' | 'almond' | 'narrow'
  browTilt: number
  mouth: number
  blush: boolean
}

/** The whole face in one deterministic draw. Pure — safe to call in a render. */
export function look(p: Pick<Person, 'name' | 'role'>): Look {
  const r = stream(hash(`${p.name}|${p.role}|anime`))
  return {
    skin: SKIN[Math.floor(r() * SKIN.length)],
    hair: HAIR[Math.floor(r() * HAIR.length)],
    cloth: CLOTH[Math.floor(r() * CLOTH.length)],
    back: BACK[Math.floor(r() * BACK.length)],
    iris: IRIS[Math.floor(r() * IRIS.length)],
    cut: CUT[Math.floor(r() * CUT.length)],
    glasses: r() < 0.24,
    facialHair: r() < 0.62 ? 'none' : (['stubble', 'goatee', 'full'] as const)[Math.floor(r() * 3)],
    eyeH: 8 + r() * 4,
    eyeW: 6.5 + r() * 2,
    eyeShape: (['round', 'almond', 'narrow'] as const)[Math.floor(r() * 3)],
    browTilt: (r() * 2 - 1) * 3,
    mouth: r(),
    blush: r() < 0.35,
  }
}

export type PortraitFrame = 'card' | 'chip'
// `chip` is the tight, head-centred crop the circular avatar wants; `card` keeps the shoulders for
// the larger square on the profile.
const VIEWBOX: Record<PortraitFrame, string> = { card: '0 0 120 120', chip: '18 18 84 84' }

const ink = '#241d2b'
const cx = 60
const eyeY = 62
const gap = 13

function backHair(L: Look, hairDark: string) {
  switch (L.cut) {
    case 'long':
      return (
        <>
          <path d="M28 52 Q26 96 32 116 L46 116 Q38 88 40 56 Z" fill={hairDark} />
          <path d="M92 52 Q94 96 88 116 L74 116 Q82 88 80 56 Z" fill={hairDark} />
        </>
      )
    case 'ponytail':
      return <path d="M84 44 Q104 52 100 78 Q96 96 86 92 Q94 72 82 54 Z" fill={hairDark} />
    case 'twin':
      return (
        <>
          <ellipse cx={28} cy={76} rx={9} ry={16} fill={hairDark} />
          <ellipse cx={92} cy={76} rx={9} ry={16} fill={hairDark} />
        </>
      )
    case 'bob':
      return <path d="M30 54 Q28 86 34 96 L86 96 Q92 86 90 54 Z" fill={hairDark} />
    default:
      return null
  }
}

function frontHair(L: Look, hair: string, hairDark: string) {
  switch (L.cut) {
    case 'spike':
      return <path d="M32 52 L38 30 L46 46 L52 26 L60 44 L68 26 L74 46 L82 30 L88 52 Q60 40 32 52 Z" fill={hair} />
    case 'buzz':
      return <path d="M32 54 Q60 30 88 54 Q60 46 32 54 Z" fill={hair} />
    case 'sidesweep':
      return <path d="M30 54 Q34 30 62 28 Q88 28 90 52 Q76 40 52 44 Q38 46 30 54 Z" fill={hair} />
    case 'messy':
      return <path d="M30 54 Q32 32 46 34 Q50 26 60 32 Q70 24 76 34 Q90 32 90 54 Q78 42 68 46 Q58 38 48 46 Q38 42 30 54 Z" fill={hair} />
    case 'wavy':
      return <path d="M30 54 Q30 30 60 28 Q90 30 90 54 Q80 44 70 48 Q60 40 50 48 Q40 44 30 54 Z" fill={hair} />
    case 'bob':
      return (
        <>
          <path d="M29 56 Q29 28 60 28 Q91 28 91 56 L91 48 Q60 38 29 48 Z" fill={hair} />
          <path d="M29 48 Q60 38 91 48 L91 54 Q60 44 29 54 Z" fill={hairDark} opacity={0.5} />
        </>
      )
    case 'long':
      return <path d="M30 56 Q30 28 60 28 Q90 28 90 56 Q86 40 62 36 Q60 44 58 36 Q34 40 30 56 Z" fill={hair} />
    case 'twin':
      return <path d="M31 50 Q34 26 60 26 Q86 26 89 50 Q76 36 60 36 Q44 36 31 50 Z" fill={hair} />
    case 'ponytail':
      return (
        <>
          <path d="M31 52 Q33 28 60 28 Q87 28 89 52 Q82 40 60 40 Q38 40 31 52 Z" fill={hair} />
          <path d="M40 34 Q60 30 80 34" stroke={hairDark} strokeWidth={1.6} fill="none" opacity={0.6} />
        </>
      )
    default:
      return <path d="M30 54 Q30 28 60 28 Q90 28 90 54 Q60 42 30 54 Z" fill={hair} />
  }
}

function eye(L: Look, dir: -1 | 1) {
  const ex = cx + dir * gap
  const ry = L.eyeShape === 'round' ? L.eyeH : L.eyeShape === 'almond' ? L.eyeH * 0.82 : L.eyeH * 0.6
  const ir = Math.min(ry, L.eyeH)
  return (
    <g key={dir}>
      <ellipse cx={ex} cy={eyeY} rx={L.eyeW} ry={ry} fill="#fff" stroke={ink} strokeWidth={1.2} />
      <circle cx={ex} cy={eyeY + 1} r={ir * 0.66} fill={L.iris} />
      <circle cx={ex} cy={eyeY + 1} r={ir * 0.32} fill={ink} />
      <circle cx={ex - dir * 1.8} cy={eyeY - ry * 0.35} r={ir * 0.26} fill="#fff" />
      <path d={`M${ex - L.eyeW} ${eyeY - ry * 0.9} Q${ex} ${eyeY - ry * 1.4} ${ex + L.eyeW} ${eyeY - ry * 0.9}`} stroke={ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <path d={`M${ex - 7} ${eyeY - ry - 5 + dir * L.browTilt} Q${ex} ${eyeY - ry - 8} ${ex + 7} ${eyeY - ry - 5 - dir * L.browTilt}`} stroke={L.hair[1]} strokeWidth={2.4} fill="none" strokeLinecap="round" />
    </g>
  )
}

export function Portrait({
  person,
  frame = 'card',
  className = '',
  size,
}: {
  person: Pick<Person, 'name' | 'role'>
  frame?: PortraitFrame
  className?: string
  /** Pixel diameter. When set, the SVG is fixed to it (used by the circular avatar). */
  size?: number
}) {
  const uid = useId().replace(/:/g, '')
  const L = look(person)
  const [skin, shade, lit] = L.skin
  const [hair, hairDark] = L.hair
  const [cloth, clothLit] = L.cloth
  const [b1, b2] = L.back
  const id = (n: string) => `${n}-${uid}`
  const facePath = 'M32 52 Q32 30 60 30 Q88 30 88 52 L88 70 Q88 96 60 100 Q32 96 32 70 Z'

  const mouth =
    L.mouth < 0.4 ? (
      <path d={`M${cx - 5} 84 Q${cx} 88 ${cx + 5} 84`} stroke={ink} strokeWidth={1.6} fill="none" strokeLinecap="round" />
    ) : L.mouth < 0.75 ? (
      <path d={`M${cx - 4} 85 L${cx + 4} 85`} stroke={ink} strokeWidth={1.6} strokeLinecap="round" />
    ) : (
      <path d={`M${cx - 6} 83 Q${cx} 90 ${cx + 6} 83 Q${cx} 86 ${cx - 6} 83 Z`} fill={ink} />
    )

  const beard =
    L.facialHair === 'none' ? null : L.facialHair === 'stubble' ? (
      <path d="M40 78 Q60 102 80 78 Q80 96 60 100 Q40 96 40 78 Z" fill={hairDark} opacity={0.26} />
    ) : L.facialHair === 'goatee' ? (
      <path d={`M${cx - 7} 88 Q${cx} 100 ${cx + 7} 88 Q${cx} 94 ${cx - 7} 88 Z`} fill={hairDark} />
    ) : (
      <path d="M38 74 Q40 100 60 101 Q80 100 82 74 Q78 92 60 92 Q42 92 38 74 Z" fill={hairDark} />
    )

  return (
    <svg
      viewBox={VIEWBOX[frame]}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={person.name}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={id('bg')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={b1} />
          <stop offset="1" stopColor={b2} />
        </linearGradient>
        <clipPath id={id('face')}>
          <path d={facePath} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={120} height={120} fill={`url(#${id('bg')})`} />
      {backHair(L, hairDark)}
      <path d="M30 104 Q42 92 60 92 Q78 92 90 104 L98 120 L22 120 Z" fill={cloth} />
      <path d="M60 92 L52 120 L68 120 Z" fill={clothLit} />
      <path d="M46 84 L46 96 Q60 104 74 96 L74 84 Z" fill={shade} />
      <path d={facePath} fill={skin} stroke={ink} strokeWidth={1.4} />
      <g clipPath={`url(#${id('face')})`}>
        <path d="M60 30 L88 30 L88 100 L60 100 Z" fill={shade} opacity={0.28} />
        <path d="M32 30 L60 30 L60 62 L32 62 Z" fill={lit} opacity={0.35} />
      </g>
      {L.blush && (
        <>
          <ellipse cx={cx - 20} cy={76} rx={6} ry={3.4} fill="#e88a8a" opacity={0.5} />
          <ellipse cx={cx + 20} cy={76} rx={6} ry={3.4} fill="#e88a8a" opacity={0.5} />
        </>
      )}
      {eye(L, -1)}
      {eye(L, 1)}
      <path d={`M${cx + 1} 70 L${cx + 3} 77 L${cx - 1} 77`} stroke={ink} strokeWidth={1.1} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
      {beard}
      {mouth}
      {frontHair(L, hair, hairDark)}
      {L.glasses && (
        <g stroke={ink} strokeWidth={1.6} fill="none" opacity={0.9}>
          <rect x={cx - gap - L.eyeW - 2.5} y={eyeY - L.eyeH - 1} width={(L.eyeW + 2.5) * 2} height={(L.eyeH + 1) * 2} rx={5} />
          <rect x={cx + gap - L.eyeW - 2.5} y={eyeY - L.eyeH - 1} width={(L.eyeW + 2.5) * 2} height={(L.eyeH + 1) * 2} rx={5} />
          <path d={`M${cx - 4} ${eyeY} L${cx + 4} ${eyeY}`} />
        </g>
      )}
    </svg>
  )
}
