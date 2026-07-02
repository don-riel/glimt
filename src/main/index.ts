import { app, BrowserWindow, protocol, Tray } from 'electron'
import path from 'path'
import type { GlimtConfig, MergedEntry } from '../shared/types'
import { RecentsCache } from './cache'
import { loadConfig } from './config'
import { ICON_SCHEME, serveIcon } from './icons'
import { registerIpc } from './ipc'
import { registerShortcut, unregisterShortcuts } from './shortcut'
import { createTray } from './tray'
import { PopupWindow } from './window'

let tray: Tray | null = null
let settingsWin: BrowserWindow | null = null
const popup = new PopupWindow()
const cache = new RecentsCache()

// Cached app icons are served on a privileged scheme so they load from both the
// dev http renderer and the prod file:// renderer (plain file:// img is blocked in dev).
protocol.registerSchemesAsPrivileged([
  { scheme: ICON_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function openSettings(): void {
  if (settingsWin) {
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 520,
    title: 'Glimt Settings',
    backgroundColor: '#1e1e20',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const base = process.env.GLIMT_RENDERER_URL
  if (base) {
    void settingsWin.loadURL(`${base}#/settings`)
  } else {
    void settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), {
      hash: 'settings',
    })
  }
  settingsWin.on('closed', () => {
    settingsWin = null
  })
}

function applyShortcut(config: GlimtConfig): boolean {
  return registerShortcut(config.shortcut, () => popup.toggle())
}

function onConfigChanged(next: GlimtConfig, prev: GlimtConfig): boolean {
  cache.setDisabled(next.disabledAdapters)
  // Adapter-only changes must not churn the global shortcut — re-registering
  // unbinds/rebinds it and, if the combo is unavailable, spams the tray
  // notification on unrelated toggles.
  if (next.shortcut === prev.shortcut) return true
  const ok = applyShortcut(next)
  // Registering unbinds the old combo first; if the new one failed, restore the
  // previous working shortcut so a summon key stays live.
  if (!ok) applyShortcut(prev)
  return ok
}

async function bootstrap(): Promise<void> {
  // Menu-bar app: no dock icon, no window on launch.
  app.dock?.hide()

  protocol.handle(ICON_SCHEME, (req) => serveIcon(req.url))

  const config = loadConfig()
  cache.setDisabled(config.disabledAdapters)

  // Push fresh merged data to the popup on every cache change.
  cache.on('updated', (merged: MergedEntry[]) => {
    popup.send('recents-updated', merged)
  })

  registerIpc({
    cache,
    onConfigChanged,
    hidePopup: () => popup.hide(),
    resizePopup: (h) => popup.setHeight(h),
  })

  tray = createTray({
    onShow: () => popup.show(),
    onRefresh: () => cache.setDisabled(loadConfig().disabledAdapters),
    onSettings: () => openSettings(),
  })

  applyShortcut(config)
  await cache.start()
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  // Stay alive as a menu-bar app even with no windows open.
})

app.on('will-quit', () => {
  unregisterShortcuts()
  cache.stop()
  tray?.destroy()
})
