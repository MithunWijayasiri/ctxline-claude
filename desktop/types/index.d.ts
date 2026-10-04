export type Limit = { percent: number; resetsAt?: string }

// One slice of the context bar: a /context category, the autocompact buffer, or free space.
export type Segment = { kind: 'used' | 'buffer' | 'free'; label: string; tokens: number; color: string }

export type Snapshot = {
  ahead: number
  behind: number
  contextUsed: number
  contextTokens?: number
  contextWindow: number
  segments: Segment[]
  fiveHour?: Limit
  sevenDay?: Limit
  costUsd?: number
}

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
      compacting: boolean
    }
  }
}
