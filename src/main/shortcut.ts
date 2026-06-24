import { globalShortcut, Notification } from 'electron'

/**
 * Register the global summon shortcut. Electron's register() returns false
 * (no throw) when another app owns the combo, so we surface that as a tray
 * notification prompting the user to reassign in Settings.
 */
export function registerShortcut(accelerator: string, onTrigger: () => void): boolean {
  globalShortcut.unregisterAll()
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, onTrigger)
  } catch {
    ok = false
  }
  if (!ok) {
    new Notification({
      title: 'Glimt shortcut unavailable',
      body: `${accelerator} is already in use. Pick another in Settings.`,
    }).show()
  }
  return ok
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
