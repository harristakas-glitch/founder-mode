// All game audio is synthesized with WebAudio — no files, no network, works in the single-file build.

const MUTE_KEY = 'founder-mode-muted'
let muted = localStorage.getItem(MUTE_KEY) === '1'
let ctx: AudioContext | null = null

export function isMuted(): boolean {
  return muted
}

export function setMuted(m: boolean): void {
  muted = m
  localStorage.setItem(MUTE_KEY, m ? '1' : '0')
}

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

interface ToneOpts {
  type?: OscillatorType
  gain?: number
  at?: number // seconds from now
  slideTo?: number // glissando target frequency
}

function tone(freq: number, dur: number, { type = 'sine', gain = 0.12, at = 0, slideTo }: ToneOpts = {}): void {
  if (muted) return
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + at
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function thump(at = 0): void {
  if (muted) return
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + at
  // low body
  tone(60, 0.5, { type: 'sine', gain: 0.35, at, slideTo: 38 })
  // noise slap
  const len = Math.floor(a.sampleRate * 0.12)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = a.createBufferSource()
  const g = a.createGain()
  g.gain.setValueAtTime(0.18, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12)
  src.buffer = buf
  src.connect(g).connect(a.destination)
  src.start(t0)
}

export const sfx = {
  /** soft tick as a week rolls over */
  week(): void {
    tone(220, 0.05, { type: 'triangle', gain: 0.07 })
    tone(440, 0.06, { type: 'triangle', gain: 0.05, at: 0.05 })
  },
  /** money lands: term sheet signed, acquisition */
  cash(): void {
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, { type: 'triangle', gain: 0.1, at: i * 0.06 }))
  },
  /** milestone reached */
  milestone(): void {
    ;[392, 494, 587].forEach((f, i) => tone(f, 0.12, { type: 'triangle', gain: 0.09, at: i * 0.07 }))
    tone(784, 0.3, { type: 'triangle', gain: 0.1, at: 0.21 })
  },
  /** pivot: the record scratch of strategy */
  pivot(): void {
    tone(420, 0.4, { type: 'sawtooth', gain: 0.06, slideTo: 160 })
  },
  /** something ominous: board ultimatum, filing risk */
  ominous(): void {
    tone(110, 0.7, { type: 'sine', gain: 0.12 })
    tone(116, 0.7, { type: 'sine', gain: 0.1 })
  },
  /** bankruptcy / getting fired */
  thud(): void {
    thump()
  },
  /** unicorn fanfare */
  fanfare(): void {
    ;[523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.1, at: i * 0.1 }))
    tone(1568, 0.6, { type: 'triangle', gain: 0.11, at: 0.5 })
  },
  /** the opening bell: IPO day */
  bell(): void {
    // struck metal: a fundamental plus inharmonic partials, long decay
    ;[880, 1761, 2650, 3520].forEach((f, i) =>
      tone(f, 1.1 - i * 0.15, { type: 'sine', gain: 0.12 / (i + 1) }),
    )
    ;[880, 1761, 2650].forEach((f, i) => tone(f, 0.9 - i * 0.15, { type: 'sine', gain: 0.08 / (i + 1), at: 0.35 }))
  },
}
