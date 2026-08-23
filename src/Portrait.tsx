// The portrait — a deterministic, procedurally drawn headshot.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS IS DRAWN AND NOT PHOTOGRAPHED
//
// The Team & Staff brief asks for "realistic modern portraits", and the honest answer to that ask
// in THIS codebase is a drawing, for four independent reasons — any one of which would be enough:
//
//   1. CSP + OFFLINE. The app ships to GitHub Pages under the strict policy in src/csp.ts and runs
//      as an offline PWA. There is no image host it is allowed to talk to, and there would be no
//      network to talk to it with.
//   2. LICENSING AND PRIVACY. A bundled pack of real faces is a bundled pack of real people, with
//      the licence terms and the consent questions that implies, attached forever to a game that
//      puts words in their mouths and fires them.
//   3. THE PEOPLE ARE GENERATED. Candidates come out of a seeded generator; a fixed pack repeats
//      within a single hiring pool and mismatches the name above it. `name x role` has ~3,600
//      combinations before traits; a pack big enough to cover that is a pack too big to ship.
//   4. IT HAS TO BE STABLE. The same person must look the same across a save reload, a replay and
//      an Arena client. That is a hash, not a fetch.
//
// So: `personSeed` (name + role, never skill or salary — see src/game/people.ts) drives a private
// mulberry32 that picks skin, hair, clothing, backdrop and features from curated palettes. The
// same person is the same face forever, and it costs nothing at rest.
//
// ---------------------------------------------------------------------------------------------
// WHAT IT IS TRYING TO LOOK LIKE
//
// A modern professional headshot, not an avatar-generator sticker: shoulders-up framing, a plain
// studio backdrop, one consistent key light from the upper left on every face, muted business
// clothing, neutral expression, no outlines. The point is that four of these side by side read as
// a SET — the same photographer, the same afternoon — which is what makes a grid of candidates
// scan as people rather than as decoration.
//
// ---------------------------------------------------------------------------------------------
// SWAPPING IT
//
// Everything below is behind ONE component and one prop shape: `<Portrait person frame />`. If a
// licensed portrait pack ever arrives, this file is the only thing that changes — no caller knows
// how a face is produced.

import { useId } from 'react'
import { personSeed } from './game/people'
import type { Person } from './game/types'

// ---------- palettes ----------
// Every ramp is base -> shadow -> light, so the key light lands the same way on every face.

const SKIN: [string, string, string][] = [
  ['#f3d9c4', '#dcb79d', '#fbeade'],
  ['#eccaa9', '#d0a883', '#f7e2ce'],
  ['#e0b189', '#c08e66', '#f0d0af'],
  ['#cf9468', '#a9714a', '#e5b691'],
  ['#b57a4f', '#8e5a37', '#d09a70'],
  ['#96603c', '#70452a', '#b4805a'],
  ['#75482f', '#563220', '#94654a'],
  ['#57351f', '#3d2415', '#754e35'],
]

const HAIR: [string, string][] = [
  ['#17181c', '#2a2c33'], // black
  ['#241a14', '#3a2a20'], // near-black brown
  ['#3d2a1c', '#57402c'], // dark brown
  ['#5a3d24', '#795535'], // brown
  ['#7b5230', '#9c6f45'], // light brown
  ['#a3763d', '#c39558'], // dark blonde
  ['#c9a463', '#e2c288'], // blonde
  ['#7d3524', '#9d4c33'], // auburn
  ['#8f949d', '#b3b8c0'], // grey
  ['#c3c8d1', '#dde1e7'], // silver
]

// Muted business wear only. Anything saturated would fight the purple accent and stop a row of
// cards reading as one set.
const CLOTH: [string, string][] = [
  ['#232833', '#2f3542'], // charcoal
  ['#1e2a3d', '#28374d'], // navy
  ['#2b3440', '#37424f'], // slate
  ['#2c3230', '#39413e'], // moss
  ['#38272c', '#472f36'], // oxblood
  ['#33302c', '#413d38'], // warm grey
  ['#1f3336', '#2a4245'], // teal
  ['#3a3646', '#484257'], // aubergine
]

// The backdrop sits a plane above the card so the silhouette separates, and never so light that a
// row of them turns the grid into a wall of rectangles.
const BACKDROP: [string, string][] = [
  ['#242c38', '#1a212b'],
  ['#28303a', '#1d242d'],
  ['#252a36', '#1b1f29'],
  ['#232f33', '#1a2226'],
  ['#2a2934', '#1f1e28'],
]

const HAIR_STYLES = ['crop', 'buzz', 'sidepart', 'wavy', 'long', 'bun', 'curls', 'receding', 'wrap', 'tie'] as const
type HairStyle = (typeof HAIR_STYLES)[number]

const COLLARS = ['crew', 'shirt', 'blazer', 'roll'] as const
type Collar = (typeof COLLARS)[number]

function stream(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Iris colour. Two people with the same skin and hair still read as different people if their
// eyes do, and it is the cheapest variation in the whole file.
const IRIS = ['#4a3a2c', '#6b4a2c', '#7a6a3c', '#3f5a63', '#43604a', '#5c5f66']

interface Look {
  skin: [string, string, string]
  hair: [string, string]
  cloth: [string, string]
  back: [string, string]
  iris: string
  style: HairStyle
  collar: Collar
  glasses: boolean
  beard: 0 | 1 | 2 // none / stubble / full
  wide: number // face width scale
  browY: number
  eyeGap: number
  smile: number
}

/** The whole face in one deterministic draw. Pure — safe to call in a render. */
function look(p: Pick<Person, 'name' | 'role'>): Look {
  const r = stream(personSeed(p) ^ 0x1f83d9ab)
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]
  const style = pick(HAIR_STYLES)
  return {
    skin: pick(SKIN),
    hair: pick(HAIR),
    cloth: pick(CLOTH),
    back: pick(BACKDROP),
    iris: pick(IRIS),
    style,
    collar: pick(COLLARS),
    glasses: r() < 0.32,
    // Facial hair only where the silhouette supports it; the wrap style keeps a clean jaw.
    beard: style === 'wrap' ? 0 : r() < 0.16 ? 2 : r() < 0.34 ? 1 : 0,
    wide: 0.94 + r() * 0.13,
    browY: -0.9 + r() * 1.8,
    eyeGap: -0.7 + r() * 1.4,
    smile: r() * 1.4,
  }
}

/**
 * The framing. `card` is the wide crop that fills the top of a candidate card; `chip` is a square
 * crop around the head for the small round avatar in a list. One drawing, two windows onto it —
 * the alternative is two drawings that drift apart.
 */
export type PortraitFrame = 'card' | 'chip'

const VIEWBOX: Record<PortraitFrame, string> = { card: '0 0 120 100', chip: '25 9 70 70' }

export function Portrait({
  person,
  frame = 'card',
  className = '',
  size,
}: {
  person: Pick<Person, 'name' | 'role'>
  frame?: PortraitFrame
  className?: string
  /** Only for `chip`: pixel diameter. `card` always fills its container. */
  size?: number
}) {
  const uid = useId().replace(/:/g, '')
  const L = look(person)
  const [skin, skinDark, skinLit] = L.skin
  const [hair, hairLit] = L.hair
  const [cloth, clothLit] = L.cloth
  const [back1, back2] = L.back

  const id = (n: string) => `${n}-${uid}`
  const cx = 60
  const headTop = 18
  const headBot = 68
  const w = 21 * L.wide

  return (
    <svg
      viewBox={VIEWBOX[frame]}
      className={className}
      width={frame === 'chip' ? size : undefined}
      height={frame === 'chip' ? size : undefined}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Portrait of ${person.name}`}
    >
      <defs>
        <linearGradient id={id('bg')} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor={back1} />
          <stop offset="100%" stopColor={back2} />
        </linearGradient>
        {/* the studio's soft key light, upper left — one light, every face */}
        <radialGradient id={id('key')} cx="0.3" cy="0.22" r="0.82">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
        </radialGradient>
        <linearGradient id={id('face')} x1="0.15" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor={skinLit} />
          <stop offset="46%" stopColor={skin} />
          <stop offset="100%" stopColor={skinDark} />
        </linearGradient>
        <linearGradient id={id('hair')} x1="0.2" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor={hairLit} />
          <stop offset="70%" stopColor={hair} />
        </linearGradient>
        <linearGradient id={id('cloth')} x1="0.15" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor={clothLit} />
          <stop offset="100%" stopColor={cloth} />
        </linearGradient>
        {/* form shading: the side of the face away from the key light falls off */}
        <linearGradient id={id('form')} x1="0" y1="0" x2="1" y2="0.35">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="42%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#3a2418" stopOpacity="0.3" />
        </linearGradient>
        {/* A pool of light on the backdrop behind the head — the second studio light, and the
            thing that stops a dark-haired silhouette merging into a dark backdrop. */}
        <radialGradient id={id('halo')} cx="0.5" cy="0.42" r="0.55">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.13" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id('headclip')}>
          <path d={headPath(cx, headTop, headBot, w)} />
        </clipPath>
      </defs>

      <rect x="0" y="0" width="120" height="100" fill={`url(#${id('bg')})`} />
      <ellipse cx={cx} cy="50" rx="52" ry="46" fill={`url(#${id('halo')})`} />

      {/* hair that falls BEHIND the shoulders has to be drawn before them */}
      {backHair(L, cx, headTop, headBot, w, id('hair'))}

      {/* neck, then the jaw shadow it sits under */}
      <path d={`M${cx - 8.5},${headBot - 8} h17 v16 h-17 z`} fill={skinDark} />
      <ellipse cx={cx} cy={headBot - 4} rx={10} ry={5.5} fill="#2a170e" opacity="0.28" />

      {shoulders(L, cx, id('cloth'), clothLit)}

      {/* ears */}
      <ellipse cx={cx - w - 0.2} cy={45} rx="3.2" ry="4.8" fill={skinDark} />
      <ellipse cx={cx + w + 0.2} cy={45} rx="3.2" ry="4.8" fill={skinDark} />

      <path d={headPath(cx, headTop, headBot, w)} fill={`url(#${id('face')})`} />

      {/* everything from here is clipped to the face, so nothing can hang off the jaw */}
      <g clipPath={`url(#${id('headclip')})`}>
        {/* cheekbone / temple shading — this is what stops it reading as a flat sticker */}
        <path d={headPath(cx, headTop, headBot, w)} fill={`url(#${id('form')})`} />

        {L.beard > 0 && (
          <path
            d={`M${cx - w - 1},${44} C${cx - w - 1},${headBot + 6} ${cx + w + 1},${headBot + 6} ${cx + w + 1},${44} ` +
              `C${cx + w + 1},${52} ${cx + 7},${54.5} ${cx},${54.5} C${cx - 7},${54.5} ${cx - w - 1},${52} ${cx - w - 1},${44} Z`}
            fill={hair}
            opacity={L.beard === 2 ? 0.88 : 0.22}
          />
        )}

        {/* brows */}
        <path
          d={`M${cx - 11 + L.eyeGap},${39.6 + L.browY} q4.6,-2.4 8.8,-0.4`}
          stroke={hair}
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
          opacity="0.8"
        />
        <path
          d={`M${cx + 2.2 - L.eyeGap},${39.2 + L.browY} q4.2,-2 8.8,0.4`}
          stroke={hair}
          strokeWidth="1.7"
          strokeLinecap="round"
          fill="none"
          opacity="0.8"
        />

        {/* eyes: socket shadow, sclera, iris, pupil, then the lid drawn back OVER the top */}
        {[cx - 6.4 + L.eyeGap, cx + 6.4 - L.eyeGap].map((ex, i) => (
          <g key={i}>
            <ellipse cx={ex} cy="44.6" rx="4" ry="2.6" fill={skinDark} opacity="0.32" />
            <ellipse cx={ex} cy="44.7" rx="2.85" ry="1.75" fill="#ece6e0" />
            <circle cx={ex} cy="44.8" r="1.35" fill={L.iris} />
            <circle cx={ex} cy="44.8" r="0.62" fill="#161114" />
            <circle cx={ex - 0.5} cy="44.2" r="0.34" fill="#ffffff" opacity="0.9" />
            {/* the upper lid: a filled skin shape, so the eye sits IN the face rather than on it */}
            <path d={`M${ex - 3},${44.7} q3,-3.4 6,0 v-2.4 h-6 z`} fill={skin} />
            <path d={`M${ex - 3},${44.5} q3,-2.9 6,0`} stroke={skinDark} strokeWidth="0.75" fill="none" strokeLinecap="round" opacity="0.9" />
          </g>
        ))}

        {/* nose: the shadow down one side and the underside, never an outline */}
        <path
          d={`M${cx - 0.2},${45.5} C${cx - 1.8},${49} ${cx - 2.6},${51.4} ${cx - 2.6},${52.2} C${cx - 2.6},${53.3} ${cx + 2.4},${53.3} ${cx + 2.4},${52.2}`}
          stroke={skinDark}
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* mouth: the line, and a hint of the lower lip catching the light */}
        <path d={`M${cx - 4.4},${57.6} q4.4,${1 + L.smile} 8.8,0`} stroke="#7d4a44" strokeOpacity="0.65" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d={`M${cx - 3.4},${59.4} q3.4,1.2 6.8,0`} stroke={skinLit} strokeOpacity="0.4" strokeWidth="1" fill="none" strokeLinecap="round" />

        {frontHair(L, cx, headTop, w, id('hair'))}
      </g>

      {L.glasses && (
        <g stroke="#333944" strokeWidth="0.9" fill="none" opacity="0.88">
          <rect x={cx - 11.2 + L.eyeGap} y="41" width="9.6" height="7.2" rx="3.2" fill="#cfd6e0" fillOpacity="0.08" />
          <rect x={cx + 1.6 - L.eyeGap} y="41" width="9.6" height="7.2" rx="3.2" fill="#cfd6e0" fillOpacity="0.08" />
          <path d={`M${cx - 1.6 + L.eyeGap},${43.6} h${3.2 - 2 * L.eyeGap}`} />
          {/* Temples only just clear the frame. Drawn to the ear they read as a headband at card
              size, which is the one thing they must not do. */}
          <path d={`M${cx - 11.2 + L.eyeGap},${43.2} h-2.4`} />
          <path d={`M${cx + 11.2 - L.eyeGap},${43.2} h2.4`} />
        </g>
      )}

      {/* the key light goes over everything, which is what makes a row of these look like one set */}
      <rect x="0" y="0" width="120" height="100" fill={`url(#${id('key')})`} />
    </svg>
  )
}

// ---------- silhouette pieces ----------

/** A tapered oval: wider at the temples, narrower at the chin. */
function headPath(cx: number, top: number, bot: number, w: number): string {
  return (
    `M${cx},${top} C${cx + w * 0.62},${top} ${cx + w},${top + 9} ${cx + w},${top + 23} ` +
    `C${cx + w},${bot - 12} ${cx + w * 0.6},${bot} ${cx},${bot} ` +
    `C${cx - w * 0.6},${bot} ${cx - w},${bot - 12} ${cx - w},${top + 23} ` +
    `C${cx - w},${top + 9} ${cx - w * 0.62},${top} ${cx},${top} Z`
  )
}

/**
 * Shoulders and the collar. Deliberately BROAD — the first cut spanned 104 of the 120 units and
 * still read as a small torso pinned under a large head, because a headshot crops the shoulders at
 * the edge of the frame rather than showing their whole width.
 */
function shoulders(L: Look, cx: number, fill: string, lit: string) {
  const body = `M${cx - 62},100 C${cx - 62},83 ${cx - 27},74.5 ${cx},74.5 C${cx + 27},74.5 ${cx + 62},83 ${cx + 62},100 Z`
  // A shirt reads as light against the jacket, not as WHITE: pure white here is both banned by the
  // design system and, at this size, the brightest thing on a card whose subject is a face.
  const shirt = '#aab2c0'
  const shirtDark = '#8d95a3'
  return (
    <g>
      <path d={body} fill={`url(#${fill})`} />
      {/* the neck's own shadow falling on the chest — without it the head floats above the body */}
      <ellipse cx={cx} cy="77" rx="13" ry="6" fill="#000" opacity="0.2" />
      {L.collar === 'crew' && <path d={`M${cx - 12},76.5 q12,8.5 24,0`} stroke={lit} strokeWidth="1.8" fill="none" opacity="0.75" />}
      {L.collar === 'roll' && <path d={`M${cx - 11},72 q11,9 22,0 v6 q-11,8 -22,0 z`} fill={lit} />}
      {L.collar === 'shirt' && (
        <g>
          {/* the V of an open shirt: a light wedge, with a point of collar either side of it */}
          <path d={`M${cx - 10.5},76 L${cx},92 L${cx + 10.5},76 L${cx + 6.5},74.5 L${cx},83 L${cx - 6.5},74.5 Z`} fill={shirt} opacity="0.9" />
          <path d={`M${cx - 10.5},76 L${cx - 3},80 L${cx - 8},89 Z`} fill={shirtDark} opacity="0.9" />
          <path d={`M${cx + 10.5},76 L${cx + 3},80 L${cx + 8},89 Z`} fill={shirtDark} opacity="0.9" />
        </g>
      )}
      {L.collar === 'blazer' && (
        <g>
          <path d={`M${cx - 8.5},75 L${cx},91 L${cx + 8.5},75 L${cx + 5.5},74 L${cx},83 L${cx - 5.5},74 Z`} fill={shirt} opacity="0.85" />
          {/* lapels, cut from the jacket itself so they read as the same garment */}
          <path d={`M${cx - 19},79 L${cx - 2.5},91 L${cx - 11},100 L${cx - 30},100 Z`} fill={lit} opacity="0.9" />
          <path d={`M${cx + 19},79 L${cx + 2.5},91 L${cx + 11},100 L${cx + 30},100 Z`} fill={lit} opacity="0.9" />
        </g>
      )}
    </g>
  )
}

/** Everything that hangs behind the shoulders. Drawn first, or the hair sits on top of the jacket. */
function backHair(L: Look, cx: number, top: number, bot: number, w: number, grad: string) {
  const fill = `url(#${grad})`
  switch (L.style) {
    case 'long':
      return <path d={`M${cx - w - 4},${top + 16} C${cx - w - 8},${bot + 22} ${cx - w - 3},96 ${cx - w + 2},100 L${cx + w - 2},100 C${cx + w + 3},96 ${cx + w + 8},${bot + 22} ${cx + w + 4},${top + 16} Z`} fill={fill} />
    case 'wavy':
      return <path d={`M${cx - w - 3},${top + 14} C${cx - w - 7},${bot + 4} ${cx - w - 2},${bot + 14} ${cx - w + 3},${bot + 15} L${cx + w - 3},${bot + 15} C${cx + w + 2},${bot + 14} ${cx + w + 7},${bot + 4} ${cx + w + 3},${top + 14} Z`} fill={fill} />
    case 'bun':
      return <circle cx={cx} cy={top - 3} r="8.5" fill={fill} />
    case 'tie':
      return <path d={`M${cx + w - 2},${top + 20} C${cx + w + 10},${top + 26} ${cx + w + 11},${bot + 6} ${cx + w + 2},${bot + 12} C${cx + w - 2},${bot + 4} ${cx + w - 3},${top + 26} ${cx + w - 2},${top + 20} Z`} fill={fill} />
    case 'curls':
      return (
        <g fill={fill}>
          {/* The outermost pair sat at |t| = 1 with an extra +0.5 of width and a 7.2 radius, so
              their centres landed ON the skull edge and most of each lobe hung in open air at
              temple height — two floating balls beside the head. Pulled inside the silhouette
              (0.86 of the half-width, no bonus) and dropped down the curve, so the crown reads as
              hair growing from the head at every size. */}
          {[-0.86, -0.5, 0, 0.5, 0.86].map((t, i) => (
            <circle key={i} cx={cx + t * w} cy={top + 10 + Math.abs(t) * 9} r={7.2 - Math.abs(t) * 1.6} />
          ))}
        </g>
      )
    case 'wrap':
      return <path d={`M${cx - w - 5},${top + 12} C${cx - w - 8},${bot + 8} ${cx - w},${bot + 16} ${cx},${bot + 16} C${cx + w},${bot + 16} ${cx + w + 8},${bot + 8} ${cx + w + 5},${top + 12} Z`} fill={L.cloth[1]} />
    default:
      return null
  }
}

/**
 * The part that sits ON the head, clipped to the face so it can never overhang the jaw.
 *
 * THE CONTROL POINTS HAVE TO GO ABOVE `top`, and the first version of this did not — which is why
 * every person in the game wore what looked like a headband. A cubic from (left, top+26) to
 * (right, top+26) with both controls at top+2 peaks at top+8: eight units of bare scalp above the
 * hairline. Control points at `top - 16` put the crown a couple of units ABOVE the skull, and the
 * head clip trims the overhang, which is how a cap of hair is actually shaped.
 */
function frontHair(L: Look, cx: number, top: number, w: number, grad: string) {
  const fill = `url(#${grad})`
  const X = w + 2
  const crown = top - 16
  /** `drop` is where the hairline sits above the brows: small = high forehead, large = low fringe. */
  const cap = (drop: number) =>
    `M${cx - X},${top + 28} C${cx - X},${crown} ${cx + X},${crown} ${cx + X},${top + 28} ` +
    `C${cx + X},${top + 11 + drop} ${cx - X},${top + 11 + drop} ${cx - X},${top + 28} Z`
  switch (L.style) {
    case 'buzz':
      return <path d={cap(1)} fill={fill} opacity="0.9" />
    case 'receding':
      // the hairline retreats in the middle and holds at the temples
      return (
        <path
          d={`M${cx - X},${top + 28} C${cx - X},${crown} ${cx + X},${crown} ${cx + X},${top + 28} ` +
            `C${cx + X},${top + 9} ${cx + 5},${top + 4} ${cx},${top + 4} ` +
            `C${cx - 5},${top + 4} ${cx - X},${top + 9} ${cx - X},${top + 28} Z`}
          fill={fill}
        />
      )
    case 'sidepart':
      // one side sweeps low across the forehead, the other stays high — the part is the asymmetry
      return (
        <path
          d={`M${cx - X},${top + 28} C${cx - X},${crown} ${cx + X},${crown} ${cx + X},${top + 26} ` +
            `C${cx + X},${top + 14} ${cx + 6},${top + 17} ${cx - 2},${top + 9} ` +
            `C${cx - 8},${top + 15} ${cx - X + 2},${top + 13} ${cx - X},${top + 28} Z`}
          fill={fill}
        />
      )
    case 'wrap':
      return (
        <path
          d={`M${cx - X - 1},${top + 32} C${cx - X - 1},${crown - 2} ${cx + X + 1},${crown - 2} ${cx + X + 1},${top + 32} ` +
            `C${cx + X + 1},${top + 12} ${cx - X - 1},${top + 12} ${cx - X - 1},${top + 32} Z`}
          fill={L.cloth[0]}
        />
      )
    case 'curls':
      return <path d={cap(8)} fill={fill} />
    case 'long':
    case 'wavy':
      return <path d={cap(6)} fill={fill} />
    case 'tie':
    case 'bun':
      // pulled back: the hairline is smooth and high
      return <path d={cap(2)} fill={fill} />
    default:
      return <path d={cap(5)} fill={fill} />
  }
}
