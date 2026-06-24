// Pure ranking layer — input: merged recents + query; output: ranked slice for
// the UI. Pure functions make this testable in isolation.
// Run tests: `SCORE_TEST=1 npx tsx src/renderer/score.ts`

import type { MergedEntry } from '../shared/types'

export const MAX_RESULTS = 8

export interface MatchResult {
  score: number
  indices: number[]
}

export interface RankedEntry {
  entry: MergedEntry
  field: 'label' | 'path'
  indices: number[]
}

const SEPARATORS = new Set(['/', '-', '_', '.', ' '])

function isWordBoundary(text: string, i: number): boolean {
  return i === 0 || SEPARATORS.has(text[i - 1])
}

/** Greedy subsequence match. Returns matched indices + score, or null on no match. */
export function fuzzyMatch(query: string, text: string): MatchResult | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0) return { score: 0, indices: [] }

  const indices: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti)
      qi++
    }
  }
  if (qi < q.length) return null

  return { score: scoreMatch(indices, t), indices }
}

/**
 * Quality score for a set of matched indices. Higher = better match.
 * Word-boundary hits are the highest-leverage signal — they make "mm" prefer
 * "menu-mate" over a mid-word coincidence.
 */
function scoreMatch(indices: number[], text: string): number {
  if (indices.length === 0) return 0
  let score = -indices[0] // leading penalty: prefer early-starting matches
  for (let k = 0; k < indices.length; k++) {
    if (isWordBoundary(text, indices[k])) score += 3
    if (k > 0) {
      if (indices[k] === indices[k - 1] + 1) score += 1
      else score -= 0.1 * (indices[k] - indices[k - 1] - 1)
    }
  }
  return score
}

/** Recency contribution in [0, 0.4]. Null (no timestamp) → 0, no bonus. */
function recencyScore(lastOpened: Date | null): number {
  if (!lastOpened) return 0
  const ageDays = (Date.now() - lastOpened.getTime()) / 86_400_000
  return 0.4 * Math.exp(-ageDays / 14)
}

/**
 * Rank merged entries for a query. Empty query returns input order (main already
 * sorts newest-first). Otherwise: match against label/path with field weights,
 * blend with recency, sort desc, cap at MAX_RESULTS.
 */
export function rankEntries(query: string, entries: MergedEntry[]): RankedEntry[] {
  const q = query.trim()
  if (q === '') {
    return entries
      .slice(0, MAX_RESULTS)
      .map((entry) => ({ entry, field: 'label' as const, indices: [] }))
  }

  const scored: { ranked: RankedEntry; final: number }[] = []
  for (const entry of entries) {
    const onLabel = fuzzyMatch(q, entry.label)
    const onPath = fuzzyMatch(q, entry.path)
    if (!onLabel && !onPath) continue

    // Label is high-signal (1.0x), path is low-signal (0.3x). Weighting shifts
    // winner-takes-all toward label without exposing two index arrays to the UI.
    const weightedLabel = onLabel ? onLabel.score * 1.0 : -Infinity
    const weightedPath = onPath ? onPath.score * 0.3 : -Infinity
    const useLabel = weightedLabel >= weightedPath
    const best = (useLabel ? onLabel : onPath)!
    const field = useLabel ? 'label' : 'path'

    // Sigmoid maps scoreMatch output (−∞, +∞) → (0, 1): strong match → near 1.
    const matchScore01 = 1 / (1 + Math.exp(-best.score))

    const final = matchScore01 * 0.6 + recencyScore(entry.lastOpened)

    scored.push({ ranked: { entry, field, indices: best.indices }, final })
  }

  scored.sort((a, b) => b.final - a.final)
  return scored.slice(0, MAX_RESULTS).map((s) => s.ranked)
}

// --- Test harness ----------------------------------------------------------
if (typeof process !== 'undefined' && process.env.SCORE_TEST) {
  const mk = (label: string, path: string, lastOpened: Date | null): MergedEntry => ({
    id: path,
    path,
    label,
    kind: 'folder',
    lastOpened,
    associations: [],
  })

  const fixture: MergedEntry[] = [
    mk('menumate', '/Users/d/dev/menumate', null),
    mk('menumate-api', '/Users/d/dev/menumate-api', null),
    mk('glimt', '/Users/d/dev/glimt', new Date()),
    mk('permisjon', '/Users/d/dev/permisjon', null),
    mk('kodepuls.api', '/Users/d/dev/kodepuls.api', null),
    mk('itstillinger', '/Users/d/dev/itstillinger', null),
  ]

  let pass = 0
  let fail = 0
  const check = (name: string, cond: boolean) => {
    if (cond) pass++
    else {
      fail++
      console.error('FAIL:', name)
    }
  }

  const mm = fuzzyMatch('mm', 'menumate')
  check('mm matches menumate', mm !== null)
  check('mm indices = [0,4]', JSON.stringify(mm?.indices) === '[0,4]')
  check('xyz no match', fuzzyMatch('xyz', 'menumate') === null)

  const empty = rankEntries('', fixture)
  check('empty preserves first', empty[0]?.entry.label === 'menumate')
  check('empty capped', empty.length <= MAX_RESULTS)

  const api = rankEntries('api', fixture).map((r) => r.entry.label)
  check('api surfaces *-api entries', api.includes('menumate-api') && api.includes('kodepuls.api'))

  check('null lastOpened ok', rankEntries('men', fixture).length > 0)

  const recent2 = mk('glimt', '/Users/d/dev/glimt', new Date())
  const stale2 = mk('glimt2', '/Users/d/dev/glimt2', new Date(Date.now() - 90 * 86_400_000))
  const byRecency = rankEntries('gli', [stale2, recent2])
  check('recency lifts recent entry', byRecency[0]?.entry.label === 'glimt')

  console.log(`score.ts tests: ${pass} passed, ${fail} failed`)
}
