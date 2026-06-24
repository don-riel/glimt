import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { realpathSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Expand ~, resolve symlinks, strip trailing slash. Best-effort — falls back to input. */
export function normalizePath(rawPath: string): string {
  let out = rawPath
  if (out.startsWith('~')) out = path.join(homedir(), out.slice(1))
  out = path.resolve(out)
  try {
    out = realpathSync(out)
  } catch {
    // Path may no longer exist on disk — keep the resolved-but-unverified form.
  }
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/** Decode a file:// URI to an absolute path. Returns null if not a file URI. */
export function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(uri).pathname)
  } catch {
    return null
  }
}

/** Stable id for an entry. */
export function entryId(tool: string, filePath: string): string {
  return createHash('sha1').update(`${tool}\0${filePath}`).digest('hex').slice(0, 16)
}

/** Last path segment, used as the display label. */
export function basenameLabel(filePath: string): string {
  return path.basename(filePath) || filePath
}

/**
 * Launch an app bundle with arguments via `open -na`. PATH-independent —
 * macOS resolves the .app through Launch Services. `appName` is the bundle
 * display name without the .app suffix, e.g. "Visual Studio Code".
 */
export async function openApp(appName: string, args: string[]): Promise<void> {
  await execFileAsync('open', ['-na', `${appName}.app`, '--args', ...args])
}

/** Open a URL scheme target, e.g. tableplus://<id>. */
export async function openUrl(url: string): Promise<void> {
  await execFileAsync('open', [url])
}
