import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EntryAssociation } from '../shared/types'
import type { RankedEntry } from './score'
import { rankEntries } from './score'
import { relativeTime } from './time'

export function App() {
  const [entries, setEntries] = useState<RankedEntry['entry'][]>([])
  const [query, setQuery] = useState('')
  // Which result row is highlighted.
  const [selectedRow, setSelectedRow] = useState(0)
  // When a multi-tool row is expanded, the sub-index into its associations;
  // null means every row is collapsed.
  const [expandedTool, setExpandedTool] = useState<number | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    window.glimt.getRecents().then(setEntries)
    window.glimt.onRecentsUpdated(setEntries)
    return () => window.glimt.offRecentsUpdated()
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = useMemo(() => rankEntries(query, entries), [entries, query])

  // Any change to the query resets navigation to the top, collapsed.
  useEffect(() => {
    setSelectedRow(0)
    setExpandedTool(null)
  }, [query])

  // results can shrink while the popup is open (watcher refresh) without a
  // query change. Clamp the cursor so it never points past the live list.
  useEffect(() => {
    const row = Math.min(selectedRow, Math.max(results.length - 1, 0))
    if (row !== selectedRow) setSelectedRow(row)
    const tools = results[row]?.entry.associations ?? []
    setExpandedTool((t) =>
      t === null ? null : Math.min(t, Math.max(tools.length - 1, 0)))
  }, [results])

  // Keep the highlighted row in view when navigating past the visible area, or
  // when expanding a row makes a tall picker overflow below the fold.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedRow, expandedTool])

  // Report rendered height to main so the window fits its content. Re-measured
  // whenever the rows or expansion change — the popup element itself is clamped
  // to the window, so a ResizeObserver on it would never see content grow; we
  // read scrollHeight (full content) instead.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root) void window.glimt.resizePopup(root.scrollHeight)
  }, [results, expandedTool])

  function open(entryId: string) {
    void window.glimt.openEntry(entryId)
    void window.glimt.hidePopup()
  }

  function selectRow(i: number) {
    setSelectedRow(i)
    setExpandedTool(null)
  }

  function activate(result: RankedEntry | undefined) {
    if (!result) return
    const { associations } = result.entry
    if (associations.length === 0) return
    if (associations.length === 1) {
      open(associations[0].entryId)
    } else if (expandedTool === null) {
      // Picker-first: a multi-tool row expands to a tool chooser before opening.
      setExpandedTool(0)
    } else {
      const assoc = associations[expandedTool]
      if (assoc) open(assoc.entryId)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const result = results[selectedRow]
    const tools = result?.entry.associations ?? []

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (expandedTool !== null) {
        setExpandedTool((t) => Math.min((t ?? 0) + 1, tools.length - 1))
      } else {
        selectRow(Math.min(selectedRow + 1, results.length - 1))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (expandedTool !== null) {
        setExpandedTool((t) => Math.max((t ?? 0) - 1, 0))
      } else {
        selectRow(Math.max(selectedRow - 1, 0))
      }
    } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
      // Tab must never blur the input — that kills keyboard nav silently.
      e.preventDefault()
      // Enter the tool picker for a multi-tool row.
      if (expandedTool === null && tools.length > 1) {
        setExpandedTool(0)
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(result)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (expandedTool !== null) setExpandedTool(null)
      else void window.glimt.hidePopup()
    }
  }

  return (
    <div className="popup" ref={rootRef}>
      <input
        ref={inputRef}
        className="search"
        placeholder="Search recent projects…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <ul className="list">
        {results.map((result, i) => {
          const expanded = i === selectedRow && expandedTool !== null
          const tools = result.entry.associations
          return (
            <li
              key={result.entry.id}
              ref={i === selectedRow ? selectedRef : null}
              className={`row ${i === selectedRow ? 'selected' : ''} ${expanded ? 'expanded' : ''}`}
              onMouseEnter={() => selectRow(i)}
              onClick={() => activate(result)}
            >
              <span className="label">{highlight(result, 'label')}</span>
              <span className="path">{highlight(result, 'path')}</span>
              <span className="badges">
                {tools.map((assoc) => (
                  <ToolBadge key={assoc.entryId} association={assoc} />
                ))}
              </span>
              <span className="time">{relativeTime(result.entry.lastOpened)}</span>

              {expanded && (
                <ul className="tool-picker" onClick={(e) => e.stopPropagation()}>
                  {tools.map((assoc, t) => (
                    <li
                      key={assoc.entryId}
                      className={`tool-option ${t === expandedTool ? 'selected' : ''}`}
                      onMouseEnter={() => setExpandedTool(t)}
                      onClick={() => open(assoc.entryId)}
                    >
                      <ToolBadge association={assoc} />
                      <span className="tool-name">{assoc.toolLabel}</span>
                      <span className="time">{relativeTime(assoc.lastOpened)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
        {results.length === 0 && (
          <li className="empty">No recent projects found.</li>
        )}
      </ul>
    </div>
  )
}

/** Render a tool's icon if extracted, otherwise a short text badge. */
function ToolBadge({ association }: { association: EntryAssociation }) {
  // Fall back to the text badge if the icon URL fails to load (cache evicted,
  // serveIcon 404). Reset when the URL changes so a later valid one re-attempts.
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [association.toolIcon])

  if (association.toolIcon && !failed) {
    return (
      <img
        className="badge-icon"
        src={association.toolIcon}
        alt={association.toolLabel}
        title={association.toolLabel}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="badge" title={association.toolLabel}>
      {shortLabel(association.toolLabel)}
    </span>
  )
}

/** Compact tool label for the badge — initials of multi-word names, else the name. */
function shortLabel(toolLabel: string): string {
  const words = toolLabel.split(/\s+/).filter(Boolean)
  if (words.length > 1) return words.map((w) => w[0]).join('').toUpperCase()
  return toolLabel
}

/**
 * Wrap matched characters in <mark>, but only on the field the match landed on.
 * Path is rendered plain: its `.path` style uses `direction: rtl` for left-side
 * truncation, which would reorder inline <mark> children.
 */
function highlight(result: RankedEntry, field: 'label' | 'path') {
  const text = field === 'label' ? result.entry.label : result.entry.path
  if (field === 'path' || result.field !== field || result.indices.length === 0) {
    return text
  }

  const marked = new Set(result.indices)
  const nodes: React.ReactNode[] = []
  let run = ''
  let runMarked = false
  const flush = (key: number) => {
    if (!run) return
    nodes.push(runMarked ? <mark key={key}>{run}</mark> : run)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const isMarked = marked.has(i)
    if (isMarked !== runMarked) {
      flush(i)
      runMarked = isMarked
    }
    run += text[i]
  }
  flush(text.length)
  return nodes
}
