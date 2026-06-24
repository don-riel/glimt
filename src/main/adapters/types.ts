import type { RecentEntry, ToolId } from '../../shared/types'

/**
 * Every supported tool implements this. Drop a new file in /adapters that
 * exports an Adapter, register it in adapters/index.ts — no core changes.
 */
export interface Adapter {
  readonly id: ToolId
  readonly label: string

  /** Cheap check: is this tool present on the machine? */
  isInstalled(): Promise<boolean>

  /**
   * Absolute paths this adapter reads. The cache watches these with fs.watch
   * to trigger a targeted re-parse. Return [] if the adapter has no stable file
   * source (it will rely on the polling fallback only).
   */
  watchPaths(): Promise<string[]>

  /** Parse the tool's recents store into normalized entries. */
  getRecents(): Promise<RecentEntry[]>

  /** Open one of this adapter's entries in its tool. */
  open(entry: RecentEntry): Promise<void>
}
