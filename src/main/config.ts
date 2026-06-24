import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import type { DevGlimtConfig } from '../shared/types'

const DEFAULT_CONFIG: DevGlimtConfig = {
  shortcut: 'CommandOrControl+Shift+Space',
  disabledAdapters: [],
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): DevGlimtConfig {
  const file = configPath()
  if (!existsSync(file)) return { ...DEFAULT_CONFIG }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DevGlimtConfig>
    return {
      shortcut: parsed.shortcut ?? DEFAULT_CONFIG.shortcut,
      disabledAdapters: parsed.disabledAdapters ?? [],
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: DevGlimtConfig): void {
  const file = configPath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8')
}
