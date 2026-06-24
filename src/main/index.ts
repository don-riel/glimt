import { app, BrowserWindow, Tray } from 'electron'
import path from 'path'
import type { GlimtConfig, MergedEntry } from '../shared/types'
import { RecentsCache } from './cache'
import { loadConfig } from './config'
import { registerIpc } from './ipc'
import { registerShortcut, unregisterShortcuts } from './shortcut'
import { createTray } from './tray'
import { PopupWindow } from './window'

let tray: Tray | null = null
let settingsWin: BrowserWindow | null = null
const popup = new PopupWindow()
const cache = new RecentsCache()

function openSettings(): void {
  if (settingsWin) {
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 520,
    title: 'Glimt Settings',
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

function applyShortcut(config: GlimtConfig): void {
  registerShortcut(config.shortcut, () => popup.toggle())
}

function onConfigChanged(config: GlimtConfig): void {
  applyShortcut(config)
  cache.setDisabled(config.disabledAdapters)
}

async function bootstrap(): Promise<void> {
  // Menu-bar app: no dock icon, no window on launch.
  app.dock?.hide()

  const config = loadConfig()
  cache.setDisabled(config.disabledAdapters)

  // Push fresh merged data to the popup on every cache change.
  cache.on('updated', (merged: MergedEntry[]) => {
    popup.send('recents-updated', merged)
  })

  registerIpc({ cache, onConfigChanged, hidePopup: () => popup.hide() })

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
