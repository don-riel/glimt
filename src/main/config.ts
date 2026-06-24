import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import type { GlimtConfig } from '../shared/types'

const DEFAULT_CONFIG: GlimtConfig = {
  shortcut: 'CommandOrControl+Shift+Space',
  disabledAdapters: [],
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): GlimtConfig {
  const file = configPath()
  if (!existsSync(file)) return { ...DEFAULT_CONFIG }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<GlimtConfig>
    return {
      shortcut: parsed.shortcut ?? DEFAULT_CONFIG.shortcut,
      disabledAdapters: parsed.disabledAdapters ?? [],
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: GlimtConfig): void {
  const file = configPath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
}
