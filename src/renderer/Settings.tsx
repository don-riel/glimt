import { useEffect, useState } from 'react'
import type { AdapterStatus, GlimtConfig } from '../shared/types'
import { ShortcutRecorder } from './ShortcutRecorder'

/** Settings: global shortcut recorder + per-adapter enable toggles. */
export function Settings() {
  const [config, setConfig] = useState<GlimtConfig | null>(null)
  const [statuses, setStatuses] = useState<AdapterStatus[]>([])
  const [shortcutOk, setShortcutOk] = useState(true)

  useEffect(() => {
    window.glimt.getConfig().then(setConfig)
    window.glimt.getStatuses().then(setStatuses)
  }, [])

  if (!config) return <div className="settings">Loading…</div>

  async function save(next: GlimtConfig) {
    const prev = config!
    const shortcutChanged = next.shortcut !== prev.shortcut
    // Instant feedback for adapter toggles; for shortcut changes wait for main so
    // a rejected combo never flashes before rolling back.
    if (!shortcutChanged) setConfig(next)
    const { config: saved, shortcutRegistered } = await window.glimt.setConfig(next)
    // Reflect what actually persisted — main rolls the shortcut back on failure.
    setConfig(saved)
    // Registration only matters when the shortcut itself changed.
    if (shortcutChanged) setShortcutOk(shortcutRegistered)
  }

  function setShortcut(accelerator: string) {
    void save({ ...config!, shortcut: accelerator })
  }

  function toggleAdapter(id: string, disabled: boolean) {
    const set = new Set(config!.disabledAdapters)
    if (disabled) set.add(id)
    else set.delete(id)
    void save({ ...config!, disabledAdapters: [...set] })
  }

  return (
    <div className="settings">
      <h2>Glimt Settings</h2>

      <div className="field">
        <span>Global shortcut</span>
        <ShortcutRecorder
          value={config.shortcut}
          onChange={setShortcut}
          invalid={!shortcutOk}
        />
        {!shortcutOk && (
          <span className="shortcut-warning">
            ⚠ That shortcut is in use — pick another.
          </span>
        )}
      </div>

      <h3>Tools</h3>
      <ul className="adapters">
        {statuses.map((status) => (
          <li key={status.id}>
            <label>
              <input
                type="checkbox"
                checked={!config.disabledAdapters.includes(status.id)}
                onChange={(e) => toggleAdapter(status.id, !e.target.checked)}
              />
              <span className="adapter-label">{status.label}</span>
              <span className="status">
                {status.installed ? '' : ' (not installed)'}
                {status.error ? ` ⚠ ${status.error}` : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
