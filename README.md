# Glimt

A unified launcher for recently opened development projects on macOS.

Glimt lives in your menu bar and gives you a Spotlight/Raycast-style popup of
the projects you've recently worked on — across multiple editors and IDEs — so you
can jump back into work with a single keystroke.

## Features

- **Menu-bar app** — Tray icon + frameless popup window, summoned via a global hotkey (Cmd + shift + space)
- **Multi-editor recents** — pulls recently opened projects from supported tools
- **Fast fuzzy search** — type to filter, Enter to open
- **Native macOS integration** — reads Spotlight metadata (`mdfind`) and per-app
  recent-document lists (`.sfl3`) via a small Swift helper

## Supported editors

| Family    | Tools |
|-----------|-------|
| VS Code   | VS Code, and forks sharing its storage layout |
| JetBrains | IntelliJ IDEA, PyCharm, WebStorm, etc. |

Adding a tool = write one adapter and append it to the registry in
`src/main/adapters/index.ts` — no other file changes.

## Tech stack

- **Electron + React + TypeScript** — main app
- **Node.js** (Electron main process) — shells out to native macOS tools
- **Swift** — `sfl3reader` helper CLI that parses `.sfl3` recent-document files
  (NSKeyedArchiver format) and resolves bookmarks to paths

## Requirements

- macOS
- **Full Disk Access** for the running process — required to read Spotlight
  metadata on protected paths and `~/Library/Application Support/com.apple.sharedfilelist/`
  - Dev: System Settings → Privacy & Security → Full Disk Access → add Terminal.app,
    then fully quit and reopen Terminal
  - Production: granted to the packaged app by the user

## Development

```bash
npm install
npm run rebuild:native   # rebuild better-sqlite3 against Electron's ABI
npm start                # build main + renderer, then launch Electron
```

### Scripts

| Script                  | Does |
|-------------------------|------|
| `npm run build:main`     | Compile main process (`tsc`) |
| `npm run build:renderer` | Build renderer (Vite) |
| `npm run build`          | Both of the above |
| `npm run rebuild:native` | Rebuild `better-sqlite3` native module for Electron |
| `npm start`              | Build everything and launch the app |

## Architecture

- **Main process** — runs `mdfind` / `lsof` / the Swift `sfl3reader` binary via
  `child_process`; manages the Tray icon and popup `BrowserWindow`
- **Preload bridge** — exposes a narrow, safe API to the renderer via `contextBridge`
- **Renderer (React)** — search bar + list UI, calls `window.api.*`

See [`PROJECT_HANDOVER.md`](./PROJECT_HANDOVER.md) for deeper notes on data sources,
the `.sfl3` format, and key design decisions.

## License

MIT © Donni
