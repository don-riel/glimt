import { app, Menu, Tray, nativeImage } from 'electron'

export interface TrayActions {
  onShow: () => void
  onRefresh: () => void
  onSettings: () => void
}

/**
 * Menu-bar presence. Left/right click opens the menu; "Show DevGlimt" is the
 * mouse path to the popup (the keyboard path is the global shortcut).
 */
export function createTray(actions: TrayActions): Tray {
  // Empty image renders as a default template slot; swap for a real icon asset.
  const tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('DevGlimt')

  const menu = Menu.buildFromTemplate([
    { label: 'Show DevGlimt', click: actions.onShow },
    { label: 'Refresh Now', click: actions.onRefresh },
    { type: 'separator' },
    { label: 'Settings…', click: actions.onSettings },
    { type: 'separator' },
    { label: 'Quit DevGlimt', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
  return tray
}
