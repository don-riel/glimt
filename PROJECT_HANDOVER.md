# Project handover: macOS recent files/apps launcher

## Overview

A macOS-only desktop app that shows recently opened files and apps in a quick-access UI (Spotlight/Raycast-style). Started as a cross-platform terminal tool, narrowed to macOS-only, then pivoted from a TUI to a GUI for a more native feel.

## Tech stack

- **Electron + React + TypeScript** — main app
- **Node.js** (Electron main process) — shells out to native macOS tools/binaries
- **Swift** — small helper CLI for parsing `.sfl3` files (NSKeyedArchiver format), compiled to a standalone binary and called from the main process

## Architecture

- **Main process (Node.js)**: runs `mdfind` / `lsof` / the Swift `sfl3reader` binary via `child_process`; manages the Tray icon and popup `BrowserWindow`
- **Preload bridge**: exposes a narrow, safe API to the renderer via `contextBridge`
- **Renderer (React)**: search bar + list UI, calls `window.api.*` methods exposed by preload

Recommended UX pattern: menu-bar app — `Tray` icon + frameless popup `BrowserWindow`, summoned via `globalShortcut` for a Spotlight/Raycast-like feel.

## Data sources

### 1. `mdfind` / Spotlight metadata (system-wide recents)

```bash
mdfind 'kMDItemLastUsedDate >= $time.today(-7)'
```

- Use **single quotes** — double quotes need `\$time` to avoid shell variable expansion
- `-onlyin <dir>` scopes the search for faster iteration
- For apps specifically: `kMDItemContentType == 'com.apple.application-bundle'`
- Per-file check: `mdls -name kMDItemLastUsedDate <path>` (reads live metadata, no indexing lag)
- Force re-index if needed: `mdimport -d1 <path>`

**Known caveat**: `kMDItemLastUsedDate` doesn't update reliably for all "open" actions — Finder double-click vs. an app's File > Open menu can behave differently. Test before relying on it for "just opened" detection.

### 2. Per-app recent documents (`.sfl3` files)

- Location: `~/Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/<bundle-id>.sfl3`
- Format: NSKeyedArchiver binary plist

Structure (confirmed via `plutil -p` on `com.apple.TextEdit.sfl3`):

```
root (NSDictionary)
├── items (NSArray)
│   └── [n] (NSDictionary)
│       ├── visibility (Int)
│       ├── CustomItemProperties (NSDictionary)
│       ├── Bookmark (NSData — CFURLBookmarkData)
│       └── uuid (String)
└── properties (NSDictionary)
```

No `Name`/`Order` fields — filename comes from resolving `Bookmark` to a `URL`, ordering is array position.

**Parser**: `sfl3reader.swift` (in this handover's folder) — uses `NSKeyedUnarchiver` + `URL(resolvingBookmarkData:)`. Works without custom class registration because every `$classname` in this archive is a standard `NSDictionary`/`NSArray`.

> Note: an earlier version tried manually walking the `$objects` graph via `PropertyListSerialization`, assuming UID references appear as `{"CF$UID": N}` dicts — they don't (that's a `plutil`-JSON-specific conversion). `NSKeyedUnarchiver` handles this correctly out of the box, which is the simpler and correct approach.

**Status**: rewritten, awaiting a clean test run against a real `.sfl3` file.

## Permissions

Both reading Spotlight metadata via `mdfind` on protected paths and reading `~/Library/Application Support/com.apple.sharedfilelist/` require **Full Disk Access** for whichever process is running:

- Dev: System Settings → Privacy & Security → Full Disk Access → add Terminal.app → fully quit and reopen Terminal
- Production: the packaged Electron app will need the same permission granted by the user

## Files produced so far

- `sfl3reader.swift` — standalone Swift script/CLI
  - Dev: `swift sfl3reader.swift <path-to-.sfl3>` → JSON array of `{name, path, order}`
  - Production: `swiftc sfl3reader.swift -o sfl3reader -O`, bundle the binary, call via `child_process.execFile`

## Next steps

1. Verify `sfl3reader.swift` against a real `.sfl3` file and confirm output looks correct
2. Decide whether `.sfl3` per-app parsing is part of the MVP or a phase 2 / stretch feature (originally flagged as a complexity-heavy add-on)
3. Scaffold the Electron + React project: Tray, popup window, preload bridge, IPC wiring
4. Implement the `mdfind` wrapper in the main process
5. Build the React UI: search/filter, list view, click-to-open via `shell.openPath()`
6. Add global hotkey via `globalShortcut`

## Key decisions log

- Cross-platform TUI (TypeScript + Ink) → macOS-only → GUI (Electron), for a more native quick-launcher feel
- `mdfind` queries: single-quote the query string to avoid shell expansion of `$time`
- `.sfl3` parsing: Swift + `NSKeyedUnarchiver` chosen over Python (`nska_deserialize` — functionally complete but heavy to bundle with Electron) and Rust (`nskeyedarchiver_converter` — converts archive structure but likely can't resolve `CFURLBookmarkData` to paths without Cocoa FFI)
- Bookmark-to-path resolution (`URL(resolvingBookmarkData:)`) is a native Cocoa API with no equivalent in other ecosystems without FFI — this was the deciding factor for using Swift for this one piece
