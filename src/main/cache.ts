import { watch, type FSWatcher } from 'fs'
import { EventEmitter } from 'events'
import type {
  AdapterStatus,
  MergedEntry,
  RecentEntry,
  ToolId,
} from '../shared/types'
import { entryId } from './adapters/helpers'
import { adapters } from './adapters'
import type { Adapter } from './adapters/types'

const POLL_INTERVAL_MS = 60_000
const WATCH_DEBOUNCE_MS = 250

/**
 * Owns the in-memory recents state. Runs adapters, dedups by path, watches
 * source files for changes, polls as a fallback, and emits 'updated' with the
 * merged list whenever anything changes. Renderer subscribes via IPC.
 */
export class RecentsCache extends EventEmitter {
  /** Raw entries keyed by adapter id, in adapter-reported order. */
  private rawByAdapter = new Map<ToolId, RecentEntry[]>()
  private statuses = new Map<ToolId, AdapterStatus>()
  private merged: MergedEntry[] = []
  private watchers: FSWatcher[] = []
  private watchTimers = new Map<string, NodeJS.Timeout>()
  private pollTimer: NodeJS.Timeout | null = null
  private disabled = new Set<ToolId>()

  setDisabled(ids: ToolId[]): void {
    this.disabled = new Set(ids)
    void this.refreshAll()
  }

  getMerged(): MergedEntry[] {
    return this.merged
  }

  getStatuses(): AdapterStatus[] {
    return [...this.statuses.values()]
  }

  /** Find the raw entry behind a UI association, to dispatch open(). */
  findRaw(entryId: string): { adapter: Adapter; entry: RecentEntry } | null {
    for (const adapter of adapters) {
      const list = this.rawByAdapter.get(adapter.id) ?? []
      const entry = list.find((e) => e.id === entryId)
      if (entry) return { adapter, entry }
    }
    return null
  }

  async start(): Promise<void> {
    await this.refreshAll()
    await this.setupWatchers()
    this.pollTimer = setInterval(() => void this.refreshAll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    for (const w of this.watchers) w.close()
    for (const t of this.watchTimers.values()) clearTimeout(t)
    this.watchers = []
    this.watchTimers.clear()
  }

  private async refreshAll(): Promise<void> {
    await Promise.all(adapters.map((a) => this.refreshAdapter(a, false)))
    this.rebuild()
  }

  /** Re-parse one adapter. Emits immediately unless `defer` (batch caller rebuilds). */
  private async refreshAdapter(adapter: Adapter, emit = true): Promise<void> {
    if (this.disabled.has(adapter.id)) {
      this.rawByAdapter.set(adapter.id, [])
      this.statuses.set(adapter.id, {
        id: adapter.id,
        label: adapter.label,
        installed: false,
      })
      if (emit) this.rebuild()
      return
    }

    try {
      const installed = await adapter.isInstalled()
      if (!installed) {
        this.rawByAdapter.set(adapter.id, [])
        this.statuses.set(adapter.id, {
          id: adapter.id,
          label: adapter.label,
          installed: false,
        })
      } else {
        const entries = await adapter.getRecents()
        this.rawByAdapter.set(adapter.id, entries)
        this.statuses.set(adapter.id, {
          id: adapter.id,
          label: adapter.label,
          installed: true,
        })
        // Resolve icons off the critical path: rows paint now with text badges,
        // icons swap in via a re-emit once the subprocesses finish. Skip if a
        // newer refresh already replaced this adapter's array.
        if (adapter.resolveIcons) {
          void adapter
            .resolveIcons(entries)
            .then(() => {
              if (this.rawByAdapter.get(adapter.id) === entries) this.rebuild()
            })
            .catch((err) =>
              console.error(
                `icon resolve failed for ${adapter.id}: ${(err as Error).message}`,
              ),
            )
        }
      }
    } catch (err) {
      this.rawByAdapter.set(adapter.id, [])
      this.statuses.set(adapter.id, {
        id: adapter.id,
        label: adapter.label,
        installed: true,
        error: (err as Error).message,
      })
    }
    if (emit) this.rebuild()
  }

  /** Group raw entries by normalized path into MergedEntry, sort, emit. */
  private rebuild(): void {
    const byPath = new Map<string, MergedEntry>()
    // Track adapter order so null-timestamp entries keep a stable fallback rank.
    let seq = 0
    const seqByPath = new Map<string, number>()

    for (const adapter of adapters) {
      for (const e of this.rawByAdapter.get(adapter.id) ?? []) {
        if (!seqByPath.has(e.path)) seqByPath.set(e.path, seq++)
        const existing = byPath.get(e.path)
        const assoc = {
          tool: e.tool,
          toolLabel: e.toolLabel,
          toolIcon: e.toolIcon,
          lastOpened: e.lastOpened,
          entryId: e.id,
        }
        if (existing) {
          existing.associations.push(assoc)
          if (
            e.lastOpened &&
            (!existing.lastOpened || e.lastOpened > existing.lastOpened)
          ) {
            existing.lastOpened = e.lastOpened
          }
        } else {
          byPath.set(e.path, {
            id: entryId('merged', e.path),
            path: e.path,
            label: e.label,
            kind: e.kind,
            lastOpened: e.lastOpened,
            associations: [assoc],
          })
        }
      }
    }

    const list = [...byPath.values()]
    for (const entry of list) {
      entry.associations.sort(
        (a, b) => (b.lastOpened?.getTime() ?? 0) - (a.lastOpened?.getTime() ?? 0),
      )
    }
    // Timestamped entries first (newest first), then untimed by discovery order.
    list.sort((a, b) => {
      const aTime = a.lastOpened?.getTime()
      const bTime = b.lastOpened?.getTime()
      if (aTime != null && bTime != null) return bTime - aTime
      if (aTime != null) return -1
      if (bTime != null) return 1
      return (seqByPath.get(a.path) ?? 0) - (seqByPath.get(b.path) ?? 0)
    })

    this.merged = list
    this.emit('updated', this.merged)
  }

  private async setupWatchers(): Promise<void> {
    for (const adapter of adapters) {
      if (this.disabled.has(adapter.id)) continue
      let paths: string[] = []
      try {
        paths = await adapter.watchPaths()
      } catch {
        continue
      }
      for (const p of paths) {
        try {
          const w = watch(p, () => this.onFileChange(adapter, p))
          this.watchers.push(w)
        } catch {
          // File may be locked/absent — polling fallback covers it.
        }
      }
    }
  }

  /** Debounce rapid writes (SQLite/XML save in bursts) into one refresh. */
  private onFileChange(adapter: Adapter, p: string): void {
    const prev = this.watchTimers.get(p)
    if (prev) clearTimeout(prev)
    this.watchTimers.set(
      p,
      setTimeout(() => {
        this.watchTimers.delete(p)
        void this.refreshAdapter(adapter)
      }, WATCH_DEBOUNCE_MS),
    )
  }
}
