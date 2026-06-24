import { contextBridge, ipcRenderer } from 'electron'
import type {
  AdapterStatus,
  GlimtConfig,
  MergedEntry,
} from '../shared/types'

/**
 * The only seam between main and renderer. The renderer calls window.glimt.*;
 * nothing else from Node is exposed. Keep this surface minimal and typed — it
 * is the contract the renderer (frontend half) builds against.
 */
const api = {
  // Pull: current cache, returned immediately on popup show.
  getRecents: (): Promise<MergedEntry[]> => ipcRenderer.invoke('get-recents'),
  getStatuses: (): Promise<AdapterStatus[]> => ipcRenderer.invoke('get-statuses'),

  // Open a merged entry's chosen association by raw entry id.
  openEntry: (entryId: string): Promise<void> =>
    ipcRenderer.invoke('open-entry', entryId),

  refreshNow: (): Promise<void> => ipcRenderer.invoke('refresh-now'),

  // Dismiss the popup (e.g. Escape). Blur-hide covers most cases; this is the
  // explicit path for in-renderer dismissal.
  hidePopup: (): Promise<void> => ipcRenderer.invoke('hide-popup'),

  // Ask main to grow/shrink the popup to fit rendered content (Spotlight-style).
  resizePopup: (height: number): Promise<void> =>
    ipcRenderer.invoke('resize-popup', height),

  getConfig: (): Promise<GlimtConfig> => ipcRenderer.invoke('get-config'),
  setConfig: (config: GlimtConfig): Promise<GlimtConfig> =>
    ipcRenderer.invoke('set-config', config),

  openFdaSettings: (): Promise<void> => ipcRenderer.invoke('open-fda-settings'),

  // Push: main sends merged list whenever the cache refreshes.
  onRecentsUpdated: (cb: (entries: MergedEntry[]) => void): void => {
    ipcRenderer.on('recents-updated', (_e, entries: MergedEntry[]) => cb(entries))
  },
  offRecentsUpdated: (): void => {
    ipcRenderer.removeAllListeners('recents-updated')
  },
}

contextBridge.exposeInMainWorld('glimt', api)

export type GlimtApi = typeof api
