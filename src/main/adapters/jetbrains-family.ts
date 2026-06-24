import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'
import type { RecentEntry } from '../../shared/types'
import type { Adapter } from './types'
import { basenameLabel, entryId, normalizePath, openApp } from './helpers'

/**
 * One adapter for the entire JetBrains family. Every product writes the same
 * recentProjects.xml schema under JetBrains/<Product><Version>/. We discover
 * installed products by globbing that dir, so a new IDE needs only a product-map
 * entry to get a correct label + .app name.
 */
interface JetBrainsProduct {
  /** Prefix of the support-dir name, e.g. "Rider" in "Rider2024.3". */
  dirPrefix: string
  id: string
  toolLabel: string
  /** Bundle display name for `open -na`. */
  appName: string
}

const PRODUCTS: JetBrainsProduct[] = [
  { dirPrefix: 'IntelliJIdea', id: 'intellij', toolLabel: 'IntelliJ IDEA', appName: 'IntelliJ IDEA' },
  { dirPrefix: 'WebStorm', id: 'webstorm', toolLabel: 'WebStorm', appName: 'WebStorm' },
  { dirPrefix: 'PyCharm', id: 'pycharm', toolLabel: 'PyCharm', appName: 'PyCharm' },
  { dirPrefix: 'Rider', id: 'rider', toolLabel: 'Rider', appName: 'Rider' },
  { dirPrefix: 'GoLand', id: 'goland', toolLabel: 'GoLand', appName: 'GoLand' },
  { dirPrefix: 'CLion', id: 'clion', toolLabel: 'CLion', appName: 'CLion' },
  { dirPrefix: 'PhpStorm', id: 'phpstorm', toolLabel: 'PhpStorm', appName: 'PhpStorm' },
  { dirPrefix: 'RubyMine', id: 'rubymine', toolLabel: 'RubyMine', appName: 'RubyMine' },
  { dirPrefix: 'DataGrip', id: 'datagrip', toolLabel: 'DataGrip', appName: 'DataGrip' },
]

const JETBRAINS_DIR = path.join(homedir(), 'Library', 'Application Support', 'JetBrains')

/** Parse "Rider2024.3" -> { version: "2024.3" } or null if no match. */
function versionFromDir(dir: string, prefix: string): string | null {
  if (!dir.startsWith(prefix)) return null
  const rest = dir.slice(prefix.length)
  return /^\d/.test(rest) ? rest : null
}

/** Sort version strings like "2024.3" descending. */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (bParts[i] ?? 0) - (aParts[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

interface ResolvedProduct {
  product: JetBrainsProduct
  /** Newest installed version's recentProjects.xml. */
  xmlPath: string
}

/** For each product with any installed version, pick the highest version's recents file. */
function resolveProducts(): ResolvedProduct[] {
  if (!existsSync(JETBRAINS_DIR)) return []
  const dirs = readdirSync(JETBRAINS_DIR)
  const out: ResolvedProduct[] = []

  for (const product of PRODUCTS) {
    const versions = dirs
      .map((dir) => ({ dir, version: versionFromDir(dir, product.dirPrefix) }))
      .filter((v): v is { dir: string; version: string } => v.version !== null)
      .sort((a, b) => compareVersions(a.version, b.version))

    for (const v of versions) {
      const xmlPath = path.join(JETBRAINS_DIR, v.dir, 'options', 'recentProjects.xml')
      if (existsSync(xmlPath)) {
        out.push({ product, xmlPath })
        break // highest version with a recents file wins
      }
    }
  }
  return out
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'entry' || name === 'option',
})

/**
 * recentProjects.xml shape (simplified):
 * <application><component name="RecentProjectsManager"><option name="additionalInfo">
 *   <map><entry key="$USER_HOME$/proj"><value><RecentProjectMetaInfo>
 *     <option name="projectOpenTimestamp" value="1700000000000"/>
 *   </RecentProjectMetaInfo></value></entry></map>
 * </option></component></application>
 */
function parseXml(rp: ResolvedProduct): RecentEntry[] {
  const xml = readFileSync(rp.xmlPath, 'utf8')
  const doc = parser.parse(xml)

  const components = asArray(doc?.application?.component)
  const mgr = components.find(
    (c: any) => c?.['@_name'] === 'RecentProjectsManager',
  )
  if (!mgr) return []

  const options = asArray(mgr.option)
  const addInfo = options.find((o: any) => o?.['@_name'] === 'additionalInfo')
  const entries = asArray(addInfo?.map?.entry)

  const out: RecentEntry[] = []
  for (const e of entries) {
    const key: string = e?.['@_key'] ?? ''
    if (!key) continue
    const raw = key.replace('$USER_HOME$', homedir())
    const norm = normalizePath(raw)

    const meta = e?.value?.RecentProjectMetaInfo
    const metaOptions = asArray(meta?.option)
    const tsOpt = metaOptions.find(
      (o: any) => o?.['@_name'] === 'projectOpenTimestamp',
    )
    const ts = tsOpt?.['@_value'] ? Number(tsOpt['@_value']) : NaN

    out.push({
      id: entryId(rp.product.id, norm),
      path: norm,
      label: basenameLabel(norm),
      tool: rp.product.id,
      toolLabel: rp.product.toolLabel,
      toolIcon: null,
      lastOpened: Number.isFinite(ts) ? new Date(ts) : null,
      kind: 'folder',
    })
  }
  return out
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

export const jetbrainsFamilyAdapter: Adapter = {
  id: 'jetbrains-family',
  label: 'JetBrains Family',

  async isInstalled() {
    return resolveProducts().length > 0
  },

  async watchPaths() {
    return resolveProducts().map((r) => r.xmlPath)
  },

  async getRecents() {
    const out: RecentEntry[] = []
    for (const rp of resolveProducts()) {
      try {
        out.push(...parseXml(rp))
      } catch (err) {
        throw new Error(
          `jetbrains(${rp.product.id}) parse failed: ${(err as Error).message}`,
        )
      }
    }
    return out
  },

  async open(entry) {
    const product = PRODUCTS.find((p) => p.id === entry.tool)
    if (!product) throw new Error(`unknown jetbrains product: ${entry.tool}`)
    await openApp(product.appName, [entry.openTarget ?? entry.path])
  },
}
