import { useEffect, useMemo, useRef, useState } from 'react'
import type { MergedEntry } from '../shared/types'

const MAX_RESULTS = 8

/**
 * Placeholder popup. Proves the IPC wiring end-to-end: loads recents, subscribes
 * to push updates, filters by substring, opens on click/Enter. This is the seam
 * the real fuzzy-search / multi-tool-picker UI gets built on top of.
 */
export function App() {
  const [entries, setEntries] = useState<MergedEntry[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.glimt.getRecents().then(setEntries)
    window.glimt.onRecentsUpdated(setEntries)
    return () => window.glimt.offRecentsUpdated()
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? entries.filter(
          (e) =>
            e.label.toLowerCase().includes(q) ||
            e.path.toLowerCase().includes(q),
        )
      : entries
    return matched.slice(0, MAX_RESULTS)
  }, [entries, query])

  useEffect(() => {
    setSelected(0)
  }, [query])

  function open(entry: MergedEntry | undefined) {
    if (!entry) return
    // Placeholder: open the most-recent tool association. Real UI shows the
    // multi-tool picker when associations.length > 1.
    void window.glimt.openEntry(entry.associations[0].entryId)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      open(results[selected])
    }
  }

  return (
    <div className="popup">
      <input
        ref={inputRef}
        className="search"
        placeholder="Search recent projects…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul className="list">
        {results.map((entry, i) => (
          <li
            key={entry.id}
            className={`row ${i === selected ? 'selected' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => open(entry)}
          >
            <span className="label">{entry.label}</span>
            <span className="path">{entry.path}</span>
            <span className="tools">
              {entry.associations.map((a) => a.toolLabel).join(', ')}
            </span>
          </li>
        ))}
        {results.length === 0 && (
          <li className="empty">No recent projects found.</li>
        )}
      </ul>
    </div>
  )
}
