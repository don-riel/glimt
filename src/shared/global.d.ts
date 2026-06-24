import type { DevGlimtApi } from '../preload/preload'

declare global {
  interface Window {
    devglimt: DevGlimtApi
  }
}

export {}
