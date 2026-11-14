import type { StyleId } from '../hooks/looks'

declare module 'claude-code' {
  interface PluginState {
    'ctxline-desktop-themes': {
      // The style this session shows, or 'off'; a failed save leaves it apart from $.store.
      applied: StyleId | 'off'
    }
  }
}
