// Shared types — used by main process, preload, and renderer.
// This is the contract both halves of the app depend on. Keep it stable.

export type ToolId = string

export type EntryKind =
  | 'workspace'
  | 'folder'
  | 'file'
  | 'connection'
  | 'collection'

/** A single recently-opened item, after parsing and normalization. */
export interface RecentEntry {
  /** Stable hash of (tool + path). Identifies the entry across refreshes. */
  id: string
  /** Absolute, normalized path (symlinks resolved, ~ expanded, no trailing slash). */
  path: string
  /** Display name — project/basename. */
  label: string
  /** Owning tool id, e.g. "vscode", "cursor", "rider". */
  tool: ToolId
  /** Human label for the tool, e.g. "VS Code", "Rider". */
  toolLabel: string
  /** Absolute path to the tool's .app icon, extracted once. May be null until resolved. */
  toolIcon: string | null
  /** Last time this was opened in this tool. Null if the source has no timestamp. */
  lastOpened: Date | null
  kind: EntryKind
  /**
   * What `open()` acts on. Defaults to `path`. URL-scheme tools (e.g. TablePlus)
   * override this with a connection id / scheme target.
   */
  openTarget?: string
}

/**
 * A deduplicated entry shown in the UI: one per normalized path, carrying every
 * tool that has opened it. Built by the cache layer from raw RecentEntry lists.
 */
export interface MergedEntry {
  /** Stable id derived from the normalized path. */
  id: string
  path: string
  label: string
  kind: EntryKind
  /** Most recent lastOpened across all associations. Null if none have a timestamp. */
  lastOpened: Date | null
  /** Every tool that has this path in its recents, newest first. */
  associations: EntryAssociation[]
}

export interface EntryAssociation {
  tool: ToolId
  toolLabel: string
  toolIcon: string | null
  lastOpened: Date | null
  /** The raw entry id, so open() can dispatch to the right adapter + openTarget. */
  entryId: string
}

export interface AdapterStatus {
  id: ToolId
  label: string
  installed: boolean
  /** Set when a refresh failed (e.g. permission denied). */
  error?: string
}

export interface DevGlimtConfig {
  /** Electron accelerator string, e.g. "CommandOrControl+Shift+Space". */
  shortcut: string
  /** Tool ids the user has hidden. */
  disabledAdapters: ToolId[]
}
