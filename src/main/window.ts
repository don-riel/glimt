import { BrowserWindow, screen } from 'electron'
import path from 'path'

const POPUP_WIDTH = 680
const POPUP_HEIGHT = 480

/**
 * The Spotlight-style popup. Frameless, always-on-top, hidden on blur. We keep
 * one instance alive and toggle visibility — recreating per-summon would add
 * latency and drop renderer state.
 */
export class PopupWindow {
  private win: BrowserWindow | null = null

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      fullscreenable: false,
      // type: 'panel' is intentionally avoided — it breaks focus with some apps.
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.on('blur', () => this.hide())

    // Dev points at the Vite server; prod loads the built renderer bundle.
    if (process.env.GLIMT_RENDERER_URL) {
      void win.loadURL(process.env.GLIMT_RENDERER_URL)
    } else {
      void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
    }
    return win
  }

  /** Center on whichever display holds the cursor. */
  private positionOnCursorScreen(win: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const { x, y, width, height } = display.workArea
    win.setBounds({
      x: Math.round(x + (width - POPUP_WIDTH) / 2),
      y: Math.round(y + (height - POPUP_HEIGHT) / 3),
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
    })
  }

  toggle(): void {
    if (this.win?.isVisible()) this.hide()
    else this.show()
  }

  show(): void {
    if (!this.win) this.win = this.create()
    this.positionOnCursorScreen(this.win)
    this.win.show()
    this.win.focus()
  }

  hide(): void {
    this.win?.hide()
  }

  /** Push fresh data to the renderer. */
  send(channel: string, payload: unknown): void {
    this.win?.webContents.send(channel, payload)
  }
}
