import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import type { EntryKind, RecentEntry } from '../../shared/types'
import type { Adapter } from './types'
import {
  basenameLabel,
  entryId,
  fileUriToPath,
  normalizePath,
  openApp,
} from './helpers'

/**
 * One adapter for the whole VS Code family. Every member stores recents the
 * same way under its own Application Support dir, so we parameterize by a
 * product map. Add a fork by appending one entry here.
 *
 * SOURCE NOTE: current VS Code builds no longer keep recents in the
 * `history.recentlyOpenedPathsList` key of state.vscdb (the original plan's
 * assumption — confirmed gone on a real machine). They now live in
 *   User/globalStorage/storage.json -> lastKnownMenubarData
 * as the serialized File > Open Recent menu. We read that primarily and fall
 * back to the old SQLite key for older builds / forks that still use it.
 */
interface VSCodeProduct {
  id: string
  toolLabel: string
  /** Folder name under ~/Library/Application Support. */
  appDir: string
  /** Bundle display name for `open -na`. */
  appName: string
}

const PRODUCTS: VSCodeProduct[] = [
  { id: 'vscode', toolLabel: 'VS Code', appDir: 'Code', appName: 'Visual Studio Code' },
  { id: 'vscode-insiders', toolLabel: 'VS Code Insiders', appDir: 'Code - Insiders', appName: 'Visual Studio Code - Insiders' },
  { id: 'cursor', toolLabel: 'Cursor', appDir: 'Cursor', appName: 'Cursor' },
  { id: 'windsurf', toolLabel: 'Windsurf', appDir: 'Windsurf', appName: 'Windsurf' },
  { id: 'vscodium', toolLabel: 'VSCodium', appDir: 'VSCodium', appName: 'VSCodium' },
]

const APP_SUPPORT = path.join(homedir(), 'Library', 'Application Support')

function globalStorageDir(p: VSCodeProduct): string {
  return path.join(APP_SUPPORT, p.appDir, 'User', 'globalStorage')
}
function storageJsonPath(p: VSCodeProduct): string {
  return path.join(globalStorageDir(p), 'storage.json')
}
function dbPath(p: VSCodeProduct): string {
  return path.join(globalStorageDir(p), 'state.vscdb')
}

function productFor(toolId: string): VSCodeProduct {
  const found = PRODUCTS.find((p) => p.id === toolId)
  if (!found) throw new Error(`unknown vscode product: ${toolId}`)
  return found
}

/** A serialized VS Code URI: { $mid, path, scheme }. */
interface VSCodeUri {
  path?: string
  scheme?: string
}

function uriToPath(uri: VSCodeUri | undefined): string | null {
  if (!uri?.path || uri.scheme !== 'file') return null
  return uri.path
}

function kindForMenuId(id: string): EntryKind {
  if (id === 'openRecentFile') return 'file'
  if (id === 'openRecentWorkspace') return 'workspace'
  return 'folder'
}

/** Primary source: the Open Recent menu persisted in storage.json. List order is recency. */
function parseStorageJson(p: VSCodeProduct): RecentEntry[] {
  const file = storageJsonPath(p)
  if (!existsSync(file)) return []

  const json = JSON.parse(readFileSync(file, 'utf8'))
  const fileMenu = json?.lastKnownMenubarData?.menus?.File
  if (!fileMenu?.items) return []

  const recentNode = (fileMenu.items as any[]).find(
    (i) => i?.id === 'submenuitem.MenubarRecentMenu',
  )
  const items: any[] = recentNode?.submenu?.items ?? []

  const out: RecentEntry[] = []
  for (const item of items) {
    const id: string = item?.id ?? ''
    if (!id.startsWith('openRecent')) continue
    const raw = uriToPath(item.uri)
    if (!raw) continue
    const norm = normalizePath(raw)
    out.push({
      id: entryId(p.id, norm),
      path: norm,
      label: basenameLabel(norm),
      tool: p.id,
      toolLabel: p.toolLabel,
      toolIcon: null,
      // Menu carries no timestamps; list order encodes recency (handled by cache).
      lastOpened: null,
      kind: kindForMenuId(id),
    })
  }
  return out
}

/** Shape of the legacy history.recentlyOpenedPathsList blob. */
interface RecentlyOpened {
  entries?: Array<{
    folderUri?: string
    fileUri?: string
    workspace?: { configPath?: string }
    label?: string
  }>
}

/** Legacy fallback: older builds keep recents in state.vscdb. */
function parseDb(p: VSCodeProduct): RecentEntry[] {
  const file = dbPath(p)
  if (!existsSync(file)) return []

  let db: Database.Database | null = null
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    const row = db
      .prepare(
        `SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'`,
      )
      .get() as { value?: string } | undefined
    if (!row?.value) return []

    const parsed = JSON.parse(row.value) as RecentlyOpened
    const out: RecentEntry[] = []
    for (const e of parsed.entries ?? []) {
      const uri = e.folderUri ?? e.fileUri ?? e.workspace?.configPath
      if (!uri) continue
      const raw = fileUriToPath(uri)
      if (!raw) continue
      const norm = normalizePath(raw)
      out.push({
        id: entryId(p.id, norm),
        path: norm,
        label: e.label || basenameLabel(norm),
        tool: p.id,
        toolLabel: p.toolLabel,
        toolIcon: null,
        lastOpened: null,
        kind: e.fileUri ? 'file' : e.workspace ? 'workspace' : 'folder',
      })
    }
    return out
  } finally {
    db?.close()
  }
}

function parseProduct(p: VSCodeProduct): RecentEntry[] {
  try {
    const fromJson = parseStorageJson(p)
    if (fromJson.length > 0) return fromJson
    return parseDb(p)
  } catch (err) {
    throw new Error(`vscode(${p.id}) parse failed: ${(err as Error).message}`)
  }
}

function installedProducts(): VSCodeProduct[] {
  return PRODUCTS.filter((p) => existsSync(path.join(APP_SUPPORT, p.appDir)))
}

export const vscodeFamilyAdapter: Adapter = {
  id: 'vscode-family',
  label: 'VS Code Family',

  async isInstalled() {
    return installedProducts().length > 0
  },

  async watchPaths() {
    const paths: string[] = []
    for (const p of installedProducts()) {
      const json = storageJsonPath(p)
      const db = dbPath(p)
      if (existsSync(json)) paths.push(json)
      if (existsSync(db)) paths.push(db)
    }
    return paths
  },

  async getRecents() {
    const out: RecentEntry[] = []
    for (const p of installedProducts()) out.push(...parseProduct(p))
    return out
  },

  async open(entry) {
    const product = productFor(entry.tool)
    await openApp(product.appName, [entry.openTarget ?? entry.path])
  },
}
