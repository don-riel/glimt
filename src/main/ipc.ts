import { ipcMain, shell } from 'electron'
import type { GlimtConfig } from '../shared/types'
import type { RecentsCache } from './cache'
import { loadConfig, saveConfig } from './config'
import { FDA_SETTINGS_URL } from './fda'

export interface IpcContext {
  cache: RecentsCache
  onConfigChanged: (config: GlimtConfig) => void
  hidePopup: () => void
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

  ipcMain.handle('get-config', () => loadConfig())

  ipcMain.handle('set-config', (_e, config: GlimtConfig) => {
    saveConfig(config)
    ctx.onConfigChanged(config)
    return config
  })

  ipcMain.handle('open-fda-settings', () => {
    void shell.openExternal(FDA_SETTINGS_URL)
  })
}
