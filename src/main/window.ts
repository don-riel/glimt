import { BrowserWindow, screen } from 'electron'
import path from 'path'

const POPUP_WIDTH = 680
const MIN_HEIGHT = 120
const MAX_HEIGHT = 520

/**
 * The Spotlight-style popup. Frameless, always-on-top, hidden on blur. We keep
 * one instance alive and toggle visibility — recreating per-summon would add
 * latency and drop renderer state. Height is driven by the renderer
 * (`setHeight`) so the window grows/shrinks to fit its content.
 */
export class PopupWindow {
  private win: BrowserWindow | null = null
  /** Top-left anchor, fixed on show so content resizes don't recenter the popup. */
  private anchor = { x: 0, y: 0 }
  private height = MIN_HEIGHT

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      width: POPUP_WIDTH,
      height: MIN_HEIGHT,
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

  /**
   * Anchor the top-left on whichever display holds the cursor. The vertical
   * offset is computed against MAX_HEIGHT so a fully-grown popup stays on-screen,
   * while the top edge stays put as the height changes.
   */
  private positionOnCursorScreen(win: BrowserWindow): void {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const { x, y, width, height } = display.workArea
    this.anchor = {
      x: Math.round(x + (width - POPUP_WIDTH) / 2),
      y: Math.round(y + (height - MAX_HEIGHT) / 3),
    }
    win.setBounds({
      x: this.anchor.x,
      y: this.anchor.y,
      width: POPUP_WIDTH,
      height: this.height,
    })
  }

  /** Grow/shrink to fit content; top-left anchor stays fixed. */
  setHeight(height: number): void {
    if (!this.win) return
    this.height = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height)))
    this.win.setBounds({
      x: this.anchor.x,
      y: this.anchor.y,
      width: POPUP_WIDTH,
      height: this.height,
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
