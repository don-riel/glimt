import type { GlimtApi } from '../preload/preload'

declare global {
  interface Window {
    glimt: GlimtApi
  }
}

export {}
