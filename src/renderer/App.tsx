import { useEffect, useMemo, useRef, useState } from 'react'
import type { MergedEntry } from '../shared/types'
import { rankEntries } from './score'
import type { RankedEntry } from './score'

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

  const results: RankedEntry[] = useMemo(
    () => rankEntries(query, entries),
    [entries, query],
  )

  useEffect(() => {
    setSelected(0)
  }, [query])

  function open(result: RankedEntry | undefined) {
    if (!result) return
    void window.glimt.openEntry(result.entry.associations[0].entryId)
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
        {results.map((result, i) => (
          <li
            key={result.entry.id}
            className={`row ${i === selected ? 'selected' : ''}`}
            onMouseEnter={() => setSelected(i)}
            onClick={() => open(result)}
          >
            <span className="label">{result.entry.label}</span>
            <span className="path">{result.entry.path}</span>
            <span className="tools">
              {result.entry.associations.map((assoc) => assoc.toolLabel).join(', ')}
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
