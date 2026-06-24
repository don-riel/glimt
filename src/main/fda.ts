import { accessSync, constants } from 'fs'
import { adapters } from './adapters'

/**
 * Detect whether macOS TCC is blocking us from reading adapter sources.
 *
 * NOTE: contrary to the original plan's assumption, reading another app's
 * ~/Library/Application Support subfolder (Code/state.vscdb, JetBrains XML)
 * does NOT require Full Disk Access on current macOS — those live in the user's
 * own home Library and are readable by non-sandboxed apps. FDA only bites for
 * TCC-protected locations (e.g. com.apple.sharedfilelist, Mail, Messages).
 *
 * So rather than hard-gate on FDA up front, we probe the real source paths and
 * report a permission problem only when a read actually fails with EPERM/EACCES.
 * If nothing is blocked, onboarding never shows.
 */
export async function probePermissionBlocked(): Promise<boolean> {
  for (const adapter of adapters) {
    let paths: string[] = []
    try {
      paths = await adapter.watchPaths()
    } catch {
      continue
    }
    for (const p of paths) {
      try {
        accessSync(p, constants.R_OK)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EPERM' || code === 'EACCES') return true
      }
    }
  }
  return false
}

/** Deep-link into System Settings → Privacy & Security → Full Disk Access. */
export const FDA_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
