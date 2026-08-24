// Strategic Systems Expansion — AI Adoption (master brief §5). Game verb: TRANSFORM.
//
// AI adoption is how deeply the company redesigns its operating model around AI — never a flat
// "+20% productivity". Each functional AREA climbs a maturity ladder (none → tools → workflow →
// integrated → ai_native) through INITIATIVES that cost weeks, cash and engineering capacity.
// The benefit depends on implementation QUALITY — a company that transforms while overloaded,
// indebted and unled ships a worse transformation and pays for it in bugs and morale — and the
// people REACT: builders love leverage, support fears automation (§5.8).
//
// Deep career only for now (the owner simplification: quick and arena run the classic engine).
// Everything is deterministic from game state — no live AI, no new RNG draws (§5.10) — and every
// effect flows through effects.ts, the one capped composer. NO DIRECT PMF HOOK (§5.10): AI moves
// behaviour channels (build speed, acquisition execution, cost, churn service), never fit itself.

import type { GameState } from '../types'
import type { AIAdoptionArea, AIAdoptionState, AIMaturity, SystemDepth } from './types'
import { managementCapacity } from './capacity'
import { effectiveAllocation } from './attention'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const AI_AREAS: AIAdoptionArea[] = ['engineering', 'marketing', 'sales', 'support', 'operations']

export const MATURITY_WORDS: Record<AIMaturity, string> = {
  0: 'None',
  1: 'Tools',
  2: 'Workflow',
  3: 'Integrated',
  4: 'AI-native',
}

export const AI_AREA_META: Record<AIAdoptionArea, { label: string; icon: string; moves: string }> = {
  engineering: { label: 'Engineering', icon: '🛠', moves: 'Build speed — and quality risk if botched' },
  marketing: { label: 'Marketing', icon: '📣', moves: 'Acquisition execution' },
  sales: { label: 'Sales', icon: '💼', moves: 'Revenue per customer' },
  support: { label: 'Support', icon: '🎧', moves: 'Retention and cost to serve' },
  operations: { label: 'Operations', icon: '⚙️', moves: 'Operating cost and management capacity' },
}

export interface AIInitiativeDef {
  id: string
  area: AIAdoptionArea
  name: string
  blurb: string
  /** the maturity this initiative reaches (start gate: area must be exactly target − 1) */
  target: AIMaturity
  /** duration at reference implementation pace, by depth */
  weeks: Record<Exclude<SystemDepth, 'off'>, number>
  cash: number
  /** share of eng output the rollout consumes while active (the §5.5 implementation capacity) */
  draw: number
}

// One ladder per area, each rung a real program. Costs scale with how deep the change cuts —
// tools are cheap, redesigning the operating model is not (§5.3).
export const AI_INITIATIVES: AIInitiativeDef[] = [
  // engineering
  { id: 'eng-assistants', area: 'engineering', name: 'AI coding assistants', target: 1, weeks: { light: 2, deep: 3, competitive: 2 }, cash: 8_000, draw: 0.05, blurb: 'Every engineer gets serious AI tooling and the licences to use it properly.' },
  { id: 'eng-review', area: 'engineering', name: 'AI code review & test generation', target: 2, weeks: { light: 3, deep: 5, competitive: 3 }, cash: 20_000, draw: 0.08, blurb: 'Review and test coverage become a workflow, not a heroic act.' },
  { id: 'eng-integrated', area: 'engineering', name: 'AI-integrated delivery pipeline', target: 3, weeks: { light: 4, deep: 8, competitive: 5 }, cash: 60_000, draw: 0.12, blurb: 'Triage, migration and scaffolding run through AI as a matter of course.' },
  { id: 'eng-native', area: 'engineering', name: 'AI-native development model', target: 4, weeks: { light: 6, deep: 12, competitive: 7 }, cash: 150_000, draw: 0.15, blurb: 'The team is redesigned around agents: fewer hands per feature, review as the craft.' },
  // marketing
  { id: 'mkt-content', area: 'marketing', name: 'AI content production', target: 1, weeks: { light: 2, deep: 3, competitive: 2 }, cash: 6_000, draw: 0.03, blurb: 'Creative volume stops being the bottleneck.' },
  { id: 'mkt-workflow', area: 'marketing', name: 'Campaign analysis workflow', target: 2, weeks: { light: 3, deep: 5, competitive: 3 }, cash: 18_000, draw: 0.05, blurb: 'Every campaign is measured, compared and iterated by default.' },
  { id: 'mkt-engine', area: 'marketing', name: 'Experiment synthesis engine', target: 3, weeks: { light: 4, deep: 8, competitive: 5 }, cash: 50_000, draw: 0.08, blurb: 'The channel mix retunes itself from live results.' },
  // sales
  { id: 'sales-tools', area: 'sales', name: 'AI sales tooling', target: 1, weeks: { light: 2, deep: 3, competitive: 2 }, cash: 6_000, draw: 0.03, blurb: 'Research, drafts and follow-ups stop eating selling time.' },
  { id: 'sales-workflow', area: 'sales', name: 'Pipeline intelligence workflow', target: 2, weeks: { light: 3, deep: 5, competitive: 3 }, cash: 20_000, draw: 0.05, blurb: 'Deals are scored, coached and forecast from the record, not the gut.' },
  { id: 'sales-integrated', area: 'sales', name: 'AI-assisted deal desk', target: 3, weeks: { light: 4, deep: 8, competitive: 5 }, cash: 55_000, draw: 0.08, blurb: 'Pricing, proposals and negotiation prep are generated, reviewed, sent.' },
  // support
  { id: 'sup-drafting', area: 'support', name: 'Response drafting', target: 1, weeks: { light: 2, deep: 3, competitive: 2 }, cash: 5_000, draw: 0.03, blurb: 'Agents answer with a draft in hand instead of a blank box.' },
  { id: 'sup-triage', area: 'support', name: 'Ticket classification & triage', target: 2, weeks: { light: 3, deep: 5, competitive: 3 }, cash: 15_000, draw: 0.05, blurb: 'The queue routes itself; the hard cases reach humans first.' },
  { id: 'sup-resolution', area: 'support', name: 'Automated resolution layer', target: 3, weeks: { light: 4, deep: 8, competitive: 5 }, cash: 45_000, draw: 0.08, blurb: 'The common cases resolve without a human — and the team feels it coming.' },
  // operations
  { id: 'ops-automation', area: 'operations', name: 'Back-office automation', target: 1, weeks: { light: 2, deep: 3, competitive: 2 }, cash: 6_000, draw: 0.03, blurb: 'Reporting, invoicing and scheduling stop being anyone’s Tuesday.' },
  { id: 'ops-workflow', area: 'operations', name: 'Operational workflow engine', target: 2, weeks: { light: 3, deep: 5, competitive: 3 }, cash: 20_000, draw: 0.05, blurb: 'Processes run themselves and escalate their own exceptions.' },
  { id: 'ops-integrated', area: 'operations', name: 'AI-run operations core', target: 3, weeks: { light: 4, deep: 8, competitive: 5 }, cash: 60_000, draw: 0.08, blurb: 'The machine that runs the company mostly runs itself — leadership hours come back.' },
]

export const aiInitiativeDef = (id: string): AIInitiativeDef | undefined => AI_INITIATIVES.find((d) => d.id === id)

export const createDefaultAI = (): AIAdoptionState => ({ areas: {}, active: [] })

/** The rungs startable right now: the area must sit exactly one below the rung's target, and
 *  nothing may already be rolling out in that area. One rollout at a time company-wide in deep —
 *  transformation consumes the same scarce leadership everything else does. */
export function availableAIInitiatives(s: GameState): AIInitiativeDef[] {
  const ai = s.aiAdoption ?? createDefaultAI()
  if (ai.active.length >= 1) return []
  return AI_INITIATIVES.filter((d) => (ai.areas[d.area]?.maturity ?? 0) === d.target - 1)
}

export function startAIInitiative(s: GameState, id: string, depth: SystemDepth): boolean {
  if (depth === 'off') return false
  const def = aiInitiativeDef(id)
  if (!def) return false
  s.aiAdoption ??= createDefaultAI()
  if (!availableAIInitiatives(s).some((d) => d.id === id)) return false
  if (s.cash < def.cash) return false
  s.cash -= def.cash
  s.aiAdoption.active.push({ id, area: def.area, progress: 0, startedWeek: s.week })
  return true
}

/** Cancelling forfeits the cash and the progress — a half-installed workflow is worth nothing. */
export function cancelAIInitiative(s: GameState, id: string): boolean {
  const ai = s.aiAdoption
  if (!ai) return false
  const before = ai.active.length
  ai.active = ai.active.filter((a) => a.id !== id)
  return ai.active.length < before
}

/**
 * Implementation QUALITY at completion (§5.7) — deterministic from company state, no dice: a
 * led org with clean code and a founder paying attention ships a good transformation; an
 * overloaded, indebted, ignored one ships a mess it will pay for.
 */
export function implementationQuality(s: GameState): number {
  const mc = managementCapacity(s)
  const mgmt = mc.word === 'Healthy' ? 20 : mc.word === 'Stretched' ? 8 : mc.word === 'Overloaded' ? -8 : -20
  const debt = -((s.roadmap?.debt ?? 0) / 100) * 20
  const attn = (effectiveAllocation(s).operations ?? 0) * 3
  const teamSkill = s.employees.length ? (s.employees.reduce((a, e) => a + e.skill, 0) / s.employees.length - 5) * 3 : 0
  return clamp(55 + mgmt + debt + attn + teamSkill, 15, 95)
}

export interface AIWeek {
  draw: number
  completed: { def: AIInitiativeDef; quality: number; reaction: 'embraced' | 'wary' }[]
}

/**
 * Weekly tick. Progress scales with management health (an overloaded org rolls things out
 * slowly) and suffers the area's accumulated resistance. Deterministic; strict no-op with
 * nothing active, so untouched saves and light modes cannot move.
 */
export function tickAI(s: GameState, depth: SystemDepth): AIWeek {
  const out: AIWeek = { draw: 0, completed: [] }
  const ai = s.aiAdoption
  if (depth !== 'deep' || !ai || ai.active.length === 0) return out
  const mc = managementCapacity(s)
  const pace = mc.word === 'Healthy' ? 1 : mc.word === 'Stretched' ? 0.85 : mc.word === 'Overloaded' ? 0.65 : 0.5
  for (const a of ai.active) {
    const def = aiInitiativeDef(a.id)
    if (!def) continue
    out.draw = Math.min(0.2, out.draw + def.draw)
    const resistance = ai.areas[a.area]?.resistance ?? 0
    a.progress += (100 / def.weeks[depth]) * pace * (1 - resistance / 250)
  }
  const done = ai.active.filter((a) => a.progress >= 100)
  if (done.length) {
    ai.active = ai.active.filter((a) => a.progress < 100)
    for (const a of done) {
      const def = aiInitiativeDef(a.id)!
      const quality = implementationQuality(s)
      const prev = ai.areas[def.area]
      // people-heavy functions brace when automation arrives into an unhappy room (§5.8)
      const avgMorale = s.employees.length ? s.employees.reduce((x, e) => x + e.morale, 0) / s.employees.length : 70
      const wary = (def.area === 'support' || def.area === 'sales') && (avgMorale < 55 || def.target >= 3)
      ai.areas[def.area] = {
        maturity: def.target,
        // quality carries forward as a running average — a sloppy rung drags the whole area
        quality: prev ? Math.round((prev.quality + quality) / 2) : quality,
        resistance: clamp((prev?.resistance ?? 0) + (wary ? 10 : -5), 0, 60),
      }
      out.completed.push({ def, quality, reaction: wary ? 'wary' : 'embraced' })
    }
  }
  return out
}

// ---------- effects (consumed by effects.ts — sizes here, caps there) ------------------------

export interface AIParts {
  build: number[]
  acq: number[]
  arpu: number[]
  churn: number[]
  opex: number[]
  bugs: number[]
  moraleDrift: number
}

/** One maturity point ≈ 2.5% on the area's axis at quality 100, half that at quality 50 — and a
 *  BOTCHED engineering transformation (quality < 40) generates bugs instead of speed (§5.7). */
export function aiParts(s: GameState): AIParts {
  const out: AIParts = { build: [], acq: [], arpu: [], churn: [], opex: [], bugs: [], moraleDrift: 0 }
  const ai = s.aiAdoption
  if (!ai) return out
  for (const area of AI_AREAS) {
    const st = ai.areas[area]
    if (!st || st.maturity === 0) continue
    const scale = (st.maturity / 4) * (0.4 + (st.quality / 100) * 0.6)
    switch (area) {
      case 'engineering':
        out.build.push(0.1 * scale)
        if (st.quality < 40) out.bugs.push(0.06)
        break
      case 'marketing':
        out.acq.push(0.06 * scale)
        break
      case 'sales':
        out.arpu.push(0.04 * scale)
        break
      case 'support':
        out.churn.push(0.05 * scale)
        out.opex.push(0.04 * scale)
        break
      case 'operations':
        out.opex.push(0.06 * scale)
        break
    }
    // leverage takes the boring work off people's plates — a small, real morale term (§5.8)
    out.moraleDrift += 0.08 * st.maturity * (st.quality >= 40 ? 1 : 0)
    // a resistant area quietly costs a little of what it gives
    if (st.resistance >= 30) out.moraleDrift -= 0.15
  }
  out.moraleDrift = clamp(out.moraleDrift, -0.6, 0.8)
  return out
}

/** The §5.9 leverage lines, in words the UI can print directly. */
export function aiLeverage(s: GameState): { label: string; value: string }[] {
  const p = aiParts(s)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const rows: { label: string; value: string }[] = []
  if (sum(p.build)) rows.push({ label: 'Development speed', value: `+${Math.round(sum(p.build) * 100)}%` })
  if (sum(p.acq)) rows.push({ label: 'Growth execution', value: `+${Math.round(sum(p.acq) * 100)}%` })
  if (sum(p.arpu)) rows.push({ label: 'Revenue per customer', value: `+${Math.round(sum(p.arpu) * 100)}%` })
  if (sum(p.churn)) rows.push({ label: 'Retention service', value: `+${Math.round(sum(p.churn) * 100)}%` })
  if (sum(p.opex)) rows.push({ label: 'Operating cost', value: `−${Math.round(sum(p.opex) * 100)}%` })
  if (sum(p.bugs)) rows.push({ label: 'Quality risk', value: `+${Math.round(sum(p.bugs) * 100)}%` })
  return rows
}
