// Self-contained (`claude plugin validate` refuses imports): keep in step with STYLE_IDS in hooks/looks.ts.
export type Applied = 'ember' | 'contour' | 'phoenix' | 'dusk' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'ctxline-desktop-themes': {
      // The style this session shows, or 'off'; a failed save leaves it apart from $.store.
      applied: Applied
      // Whether this session's background holds still; a failed save leaves it apart from $.store.
      still: boolean
    }
  }
}
