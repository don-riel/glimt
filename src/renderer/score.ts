// Pure ranking layer for the popup. No React, no IPC — input is the merged
// recents list + the current query, output is a ranked, match-annotated slice
// the UI renders. Being pure makes it testable in isolation (see harness at the
// bottom: `SCORE_TEST=1 npx tsx src/renderer/score.ts`).

import type { MergedEntry } from '../shared/types'

/** Max rows shown in the popup. */
export const MAX_RESULTS = 8

export interface MatchResult {
  /** Higher = better. Relative only; not normalized. */
  score: number
  /** Indices into the matched text of each query char, for highlighting. */
  indices: number[]
}

export interface RankedEntry {
  entry: MergedEntry
  /** Which field the indices point into, so the UI highlights the right string. */
  field: 'label' | 'path'
  indices: number[]
}

/** Characters that begin a "word" — matches right after one score higher. */
const SEPARATORS = new Set(['/', '-', '_', '.', ' '])

function isWordBoundary(text: string, i: number): boolean {
  return i === 0 || SEPARATORS.has(text[i - 1])
}

/**
 * Greedy subsequence match: every char of `query` must appear in `text` in
 * order. Returns the matched indices + a score, or null if no match.
 *
 * The matching loop is fixed; the SCORE is the tunable part (scoreMatch below).
 */
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
  if (qi < q.length) return null // not all query chars found in order

  return { score: scoreMatch(indices, t), indices }
}

/**
 * Turn a set of matched indices into a quality score. This is the heart of
 * ranking quality — see TODO(human) below.
 *
 * Contract: pure. Higher return = better match. Same input must give same
 * output. `indices` is sorted ascending; each is a position in `text`.
 *
 * Signals worth combining (tune the weights — there's no single right answer):
 *   + prefix bonus:        indices[0] === 0
 *   + word-boundary bonus: isWordBoundary(text, idx) for each matched idx
 *                          (this is the highest-leverage signal — it makes
 *                           "mm" favor "menu-mate" over a mid-word coincidence)
 *   + contiguity bonus:    indices[k] + 1 === indices[k+1]
 *   - gap penalty:         distance between consecutive indices
 *   - leading penalty:     how far in the first match sits (indices[0])
 */
function scoreMatch(indices: number[], text: string): number {
  // TODO(human): replace this naive baseline with a real weighted score.
  // Baseline below only rewards an early first match — good enough to make the
  // test harness run, weak enough that you'll see ranking improve as you add
  // the word-boundary / contiguity / gap signals listed above.
  return indices.length === 0 ? 0 : -indices[0]
}

/**
 * Recency weight from a lastOpened timestamp. Null (e.g. VS Code, which only
 * gives list order, no timestamps) is neutral so those entries rank on pure
 * text match. Multiplicative so a strong text match still beats a stale-but-
 * recent weak one.
 */
function recencyMultiplier(lastOpened: Date | null): number {
  if (!lastOpened) return 1
  const ageDays = (Date.now() - lastOpened.getTime()) / 86_400_000
  // Today -> ~1.4, two weeks -> ~1.15, months -> ~1.0.
  return 1 + 0.4 * Math.exp(-ageDays / 14)
}

/**
 * Rank merged entries for a query. Empty query short-circuits to the input
 * order (main already sorts newest-first), so this never re-sorts a blank
 * search. Otherwise: match each entry against the better of label/path, blend
 * recency, sort desc, cap at MAX_RESULTS.
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

    // Take whichever field scored higher; carry its indices for highlighting.
    const useLabel = (onLabel?.score ?? -Infinity) >= (onPath?.score ?? -Infinity)
    const best = (useLabel ? onLabel : onPath)!
    const field = useLabel ? 'label' : 'path'
    const final = best.score * recencyMultiplier(entry.lastOpened)

    scored.push({ ranked: { entry, field, indices: best.indices }, final })
  }

  scored.sort((a, b) => b.final - a.final)
  return scored.slice(0, MAX_RESULTS).map((s) => s.ranked)
}

// --- Test harness ----------------------------------------------------------
// Runs only under Node with SCORE_TEST set; the `typeof process` guard keeps it
// inert in the browser bundle. Run: `SCORE_TEST=1 npx tsx src/renderer/score.ts`
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

  // fuzzyMatch basics
  const mm = fuzzyMatch('mm', 'menumate')
  check('mm matches menumate', mm !== null)
  check('mm indices = [0,4]', JSON.stringify(mm?.indices) === '[0,4]')
  check('xyz no match', fuzzyMatch('xyz', 'menumate') === null)

  // empty query preserves order, caps length
  const empty = rankEntries('', fixture)
  check('empty preserves first', empty[0]?.entry.label === 'menumate')
  check('empty capped', empty.length <= MAX_RESULTS)

  // query ranks relevant entries to the top (note: weak with baseline scoring —
  // these tighten once you implement scoreMatch)
  const api = rankEntries('api', fixture).map((r) => r.entry.label)
  check('api surfaces *-api entries', api.includes('menumate-api') && api.includes('kodepuls.api'))

  // null lastOpened must not throw
  check('null lastOpened ok', rankEntries('men', fixture).length > 0)

  console.log(`score.ts tests: ${pass} passed, ${fail} failed`)
}
