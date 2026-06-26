// Pure relative-time formatting for entry rows. Dependency-free and testable in
// isolation, mirroring score.ts. Run tests: `TIME_TEST=1 npx tsx src/renderer/time.ts`

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/**
 * Short, glanceable age. Null (no timestamp) renders as empty — those entries
 * carry no recency and shouldn't show a misleading time.
 */
export function relativeTime(date: Date | null, now: number = Date.now()): string {
  if (!date) return ''
  const ms = now - date.getTime()
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d`
  if (ms < 5 * WEEK) return `${Math.floor(ms / WEEK)}w`
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

// --- Test harness ----------------------------------------------------------
if (typeof process !== 'undefined' && process.env.TIME_TEST) {
  const now = new Date('2026-06-24T12:00:00Z').getTime()
  let pass = 0
  let fail = 0
  const check = (name: string, got: string, want: string) => {
    if (got === want) pass++
    else {
      fail++
      console.error(`FAIL: ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
    }
  }

  const ago = (ms: number) => new Date(now - ms)
  check('null → empty', relativeTime(null, now), '')
  check('30s → now', relativeTime(ago(30 * SECOND), now), 'now')
  check('5m', relativeTime(ago(5 * MINUTE), now), '5m')
  check('3h', relativeTime(ago(3 * HOUR), now), '3h')
  check('2d', relativeTime(ago(2 * DAY), now), '2d')
  check('3w', relativeTime(ago(3 * WEEK), now), '3w')
  check('old → month day', relativeTime(new Date('2026-03-09T12:00:00Z'), now), 'Mar 9')

  console.log(`time.ts tests: ${pass} passed, ${fail} failed`)
}
