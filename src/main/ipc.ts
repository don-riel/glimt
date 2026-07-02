import { ipcMain, shell } from 'electron'
import type { GlimtConfig } from '../shared/types'
import type { RecentsCache } from './cache'
import { loadConfig, saveConfig } from './config'
import { FDA_SETTINGS_URL } from './fda'

export interface IpcContext {
  cache: RecentsCache
  /**
   * Apply the new config. Registers the new shortcut; on failure restores the
   * previous working one. Returns whether the new shortcut registered.
   */
  onConfigChanged: (next: GlimtConfig, prev: GlimtConfig) => boolean
  hidePopup: () => void
  resizePopup: (height: number) => void
}

/**
 * Wire the renderer-facing IPC surface. Pull handlers return current state
 * immediately; the push side ('recents-updated') is driven from index.ts.
 */
export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle('get-recents', () => ctx.cache.getMerged())
  ipcMain.handle('get-statuses', () => ctx.cache.getStatuses())

  ipcMain.handle('open-entry', async (_e, entryId: string) => {
    const found = ctx.cache.findRaw(entryId)
    if (!found) throw new Error(`entry not found: ${entryId}`)
    await found.adapter.open(found.entry)
  })

  ipcMain.handle('refresh-now', () => {
    ctx.cache.setDisabled(loadConfig().disabledAdapters)
  })

  ipcMain.handle('hide-popup', () => ctx.hidePopup())

  ipcMain.handle('resize-popup', (_e, height: number) => ctx.resizePopup(height))

  ipcMain.handle('get-config', () => loadConfig())

  ipcMain.handle('set-config', (_e, config: GlimtConfig) => {
    const prev = loadConfig()
    const shortcutRegistered = ctx.onConfigChanged(config, prev)
    // A shortcut that failed to register is never persisted — keep the last
    // working one so a restart doesn't strand the app without a summon key.
    const persisted = shortcutRegistered
      ? config
      : { ...config, shortcut: prev.shortcut }
    saveConfig(persisted)
    return { config: persisted, shortcutRegistered }
  })

  ipcMain.handle('open-fda-settings', () => {
    void shell.openExternal(FDA_SETTINGS_URL)
  })
}
