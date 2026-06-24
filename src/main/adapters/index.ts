import type { Adapter } from './types'
import { vscodeFamilyAdapter } from './vscode-family'
import { jetbrainsFamilyAdapter } from './jetbrains-family'

/**
 * The central registry. Adding a tool = import its adapter and append here.
 * Tier 2 adapters (Xcode, Sublime, GitHub Desktop, TablePlus) slot in below
 * once written — no other file changes.
 */
export const adapters: Adapter[] = [
  vscodeFamilyAdapter,
  jetbrainsFamilyAdapter,
]
