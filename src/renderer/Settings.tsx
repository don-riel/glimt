import { useEffect, useState } from 'react'
import type { AdapterStatus, GlimtConfig } from '../shared/types'

/** Placeholder settings: shortcut field + adapter enable toggles. */
export function Settings() {
  const [config, setConfig] = useState<GlimtConfig | null>(null)
  const [statuses, setStatuses] = useState<AdapterStatus[]>([])

  useEffect(() => {
    window.glimt.getConfig().then(setConfig)
    window.glimt.getStatuses().then(setStatuses)
  }, [])

  if (!config) return <div className="settings">Loading…</div>

  function save(next: GlimtConfig) {
    setConfig(next)
    void window.glimt.setConfig(next)
  }

  function toggleAdapter(id: string, disabled: boolean) {
    const set = new Set(config!.disabledAdapters)
    if (disabled) set.add(id)
    else set.delete(id)
    save({ ...config!, disabledAdapters: [...set] })
  }

  return (
    <div className="settings">
      <h2>Glimt Settings</h2>

      <label className="field">
        <span>Global shortcut</span>
        <input
          value={config.shortcut}
          onChange={(e) => save({ ...config, shortcut: e.target.value })}
        />
      </label>

      <h3>Tools</h3>
      <ul className="adapters">
        {statuses.map((s) => (
          <li key={s.id}>
            <label>
              <input
                type="checkbox"
                checked={!config.disabledAdapters.includes(s.id)}
                onChange={(e) => toggleAdapter(s.id, !e.target.checked)}
              />
              {s.label}
              <span className="status">
                {s.installed ? '' : ' (not installed)'}
                {s.error ? ` ⚠ ${s.error}` : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
