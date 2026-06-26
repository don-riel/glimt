import { app, net } from 'electron'
import { execFile, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readdirSync } from 'fs'
import { mkdir } from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { promisify } from 'util'
import type { RecentEntry, ToolId } from '../shared/types'

const execFileAsync = promisify(execFile)

/** Custom scheme cached icons are served on. Registered in main/index.ts. */
export const ICON_SCHEME = 'glimt-asset'

/** Icons display at 16px; cache at 64px so they stay crisp on retina. */
const ICON_SIZE = 64

function iconDir(): string {
  return path.join(app.getPath('userData'), 'icon-cache')
}

/** Cache filename for an app, derived from its bundle display name. */
function iconHash(appName: string): string {
  return createHash('sha1').update(appName).digest('hex').slice(0, 16)
}

/** glimt-asset:// URL the renderer loads. Resolved by the protocol handler. */
function iconUrl(hash: string): string {
  return `${ICON_SCHEME}://icons/${hash}.png`
}

/** Absolute path to a cached icon file. Used by the protocol handler. */
export function iconFilePath(name: string): string {
  return path.join(iconDir(), path.basename(name))
}

// Dedupe concurrent + repeat resolves across refreshes — icons don't change at runtime.
const inFlight = new Map<string, Promise<string | null>>()

/**
 * Extract and cache an app's icon, returning a glimt-asset:// URL (or null if the
 * app can't be resolved). Keyed by the bundle display name, e.g. "Visual Studio Code".
 * Never throws — failures fall back to the renderer's text badge.
 */
export function resolveAppIcon(appName: string): Promise<string | null> {
  const cached = inFlight.get(appName)
  if (cached) return cached
  const job = extract(appName)
  inFlight.set(appName, job)
  return job
}

async function extract(appName: string): Promise<string | null> {
  const hash = iconHash(appName)
  const pngPath = path.join(iconDir(), `${hash}.png`)
  if (existsSync(pngPath)) return iconUrl(hash)

  try {
    const appPath = await resolveAppPath(appName)
    if (!appPath) return null

    const icns = resolveIcnsPath(appPath)
    if (!icns) return null

    await mkdir(iconDir(), { recursive: true })
    // `sips` rasterizes the bundle's .icns straight to PNG. We avoid
    // app.getFileIcon: it spawns an internal utility process that fails its
    // Mach-port rendezvous and SIGTRAPs on launch. sips is a plain subprocess.
    await execFileAsync('sips', [
      '-s', 'format', 'png',
      '-Z', String(ICON_SIZE), // resample to fit ICON_SIZE, preserving aspect
      icns,
      '--out', pngPath,
    ])
    return iconUrl(hash)
  } catch (err) {
    console.error(`icon extract failed for "${appName}": ${(err as Error).message}`)
    return null
  }
}

/** Resolve a bundle display name to its .app path via Launch Services — same resolution `open -na` uses. */
async function resolveAppPath(appName: string): Promise<string | null> {
  const { stdout } = await execFileAsync('osascript', [
    '-e',
    `POSIX path of (path to application "${appName}")`,
  ])
  return stdout.trim() || null
}

/** Find the bundle's .icns: prefer CFBundleIconFile, else the first .icns in Resources. */
function resolveIcnsPath(appPath: string): string | null {
  const resources = path.join(appPath, 'Contents', 'Resources')
  const named = iconFromPlist(appPath)
  if (named) {
    const file = named.endsWith('.icns') ? named : `${named}.icns`
    const full = path.join(resources, file)
    if (existsSync(full)) return full
  }
  try {
    const found = readdirSync(resources).find((f) => f.endsWith('.icns'))
    return found ? path.join(resources, found) : null
  } catch {
    return null
  }
}

/** Read CFBundleIconFile from Info.plist, or null if absent. */
function iconFromPlist(appPath: string): string | null {
  try {
    const { status, stdout } = spawnSync('defaults', [
      'read',
      path.join(appPath, 'Contents', 'Info'),
      'CFBundleIconFile',
    ])
    return status === 0 ? stdout.toString().trim() || null : null
  } catch {
    return null
  }
}

/**
 * Stamp `toolIcon` on each entry. Resolves once per unique tool, then assigns the
 * result to every entry of that tool. `appNameForTool` maps a ToolId to its bundle
 * display name (the adapter owns this map).
 */
export async function attachIcons(
  entries: RecentEntry[],
  appNameForTool: (tool: ToolId) => string | undefined,
): Promise<void> {
  const urlByTool = new Map<ToolId, string | null>()
  for (const tool of new Set(entries.map((e) => e.tool))) {
    const appName = appNameForTool(tool)
    urlByTool.set(tool, appName ? await resolveAppIcon(appName) : null)
  }
  for (const entry of entries) {
    entry.toolIcon = urlByTool.get(entry.tool) ?? null
  }
}

/** Serve a cached icon, guarding against path traversal outside the cache dir. */
export function serveIcon(requestUrl: string): Promise<Response> {
  const name = path.basename(new URL(requestUrl).pathname)
  const file = iconFilePath(name)
  const dir = iconDir()
  if (path.resolve(file) !== path.join(dir, name) || path.dirname(file) !== dir) {
    return Promise.resolve(new Response(null, { status: 403 }))
  }
  return net.fetch(pathToFileURL(file).toString())
}
