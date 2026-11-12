export type Limit = { percent: number }

export type Snapshot = {
  folder: string
  branch?: string
  ahead: number
  behind: number
  contextUsed: number
  contextTokens?: number
  contextWindow: number
  fiveHour?: Limit
  sevenDay?: Limit
}

// A model-scoped weekly limit, labeled by the model's initial.
export type ModelLimit = { letter: string; percent: number }

// The last model limits fetched; `ok` is false while the latest fetch failed (letters kept, values not shown).
export type ModelLimits = { limits: ModelLimit[]; ok: boolean }

export type RunningTool = { id: string; name: string; detail: string }

export type Activity = {
  isWorking: boolean
  startedAt: number
  tools: number
  current: RunningTool | null
  lastSeconds: number | null
}

// Main-loop input tokens this session: served from the prompt cache vs all.
export type CacheTally = { read: number; total: number }

declare module 'claude-code' {
  interface PluginState {
    'ctxline-desktop': {
      snap: Snapshot | null
      activity: Activity
      frame: number
      cache: CacheTally
      models: ModelLimits
    }
  }
}
