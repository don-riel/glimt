import { useEffect, useState } from 'react'

interface Props {
  /** Current accelerator, e.g. "CommandOrControl+Shift+Space". */
  value: string
  /** Called with a new Electron accelerator once a valid combo is captured. */
  onChange: (accelerator: string) => void
  /** Highlight the button when the current shortcut failed to register. */
  invalid?: boolean
}

/** e.code values that are modifiers-only — we wait for a real key past these. */
const MODIFIER_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
])

/**
 * Map a physical key (e.code) to an Electron accelerator token. Using e.code
 * avoids Shift-altered symbols (e.g. Shift+2 stays "2", not "@").
 */
function keyToken(e: KeyboardEvent): string | null {
  const code = e.code
  if (code.startsWith('Key')) return code.slice(3) // KeyA -> A
  if (code.startsWith('Digit')) return code.slice(5) // Digit1 -> 1
  if (/^F\d{1,2}$/.test(code)) return code // F1..F12
  const map: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Escape: 'Escape',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
  }
  return map[code] ?? null
}

/** Build an Electron accelerator from a keydown, or null if not a valid combo. */
function toAccelerator(e: KeyboardEvent): string | null {
  const key = keyToken(e)
  if (!key) return null
  const mods: string[] = []
  if (e.metaKey || e.ctrlKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  // Require 2+ modifiers so single-modifier app shortcuts (Cmd+C, Cmd+V…) can't
  // be captured — Electron registers those globally and would hijack them.
  if (mods.length < 2) return null
  return [...mods, key].join('+')
}

/** Render an accelerator as macOS glyphs, e.g. "⌘⇧Space". */
function humanize(accelerator: string): string {
  if (!accelerator) return 'None'
  const glyphs: Record<string, string> = {
    CommandOrControl: '⌘',
    CmdOrCtrl: '⌘',
    Command: '⌘',
    Cmd: '⌘',
    Control: '⌃',
    Ctrl: '⌃',
    Alt: '⌥',
    Option: '⌥',
    Shift: '⇧',
  }
  return accelerator
    .split('+')
    .map((part) => glyphs[part] ?? part)
    .join('')
}

export function ShortcutRecorder({ value, onChange, invalid }: Props) {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState(false)

  useEffect(() => {
    if (!recording) return

    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setRecording(false)
        setHint(false)
        return
      }
      if (MODIFIER_CODES.has(e.code)) return // wait for a real key
      const accelerator = toAccelerator(e)
      if (!accelerator) {
        setHint(true) // needs 2+ modifiers
        return
      }
      onChange(accelerator)
      setRecording(false)
      setHint(false)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, onChange])

  function start() {
    setHint(false)
    setRecording(true)
  }

  const label = recording ? 'Press keys…' : humanize(value)
  const className = [
    'shortcut-recorder',
    recording ? 'recording' : '',
    invalid ? 'invalid' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={start}
        onBlur={() => {
          setRecording(false)
          setHint(false)
        }}
      >
        {label}
      </button>
      {hint && (
        <span className="shortcut-hint">Use at least two modifiers (⌘/⌃/⌥/⇧)</span>
      )}
    </>
  )
}
