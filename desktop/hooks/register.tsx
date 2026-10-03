import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Activity, CacheTally, Limit, Snapshot } from '../types'

const IDLE: Activity = { isWorking: false, startedAt: 0, tools: 0, current: null, lastSeconds: null }
const NO_CACHE: CacheTally = { read: 0, total: 0 }

const snap = atom({ plugin: 'ctxline-desktop', key: 'snap' } as const, null)
const activity = atom({ plugin: 'ctxline-desktop', key: 'activity' } as const, IDLE)
const frame = atom({ plugin: 'ctxline-desktop', key: 'frame' } as const, 0)
const cache = atom({ plugin: 'ctxline-desktop', key: 'cache' } as const, NO_CACHE)

const REFRESH_MS = 30000
const SPIN_MS = 250
const BAR_WIDTH = 18
const MAX_DETAIL_LEN = 40
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const DETAIL_KEYS = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'skill'] as const
const GREEN = 'green'
const YELLOW = 'yellow'
const ORANGE = '#ff8700'
const RED = 'red'
const ACCENT = '#d97757'

function usageColor(percent: number): string {
  if (percent < 60) return GREEN
  if (percent < 80) return YELLOW
  if (percent < 90) return ORANGE
  return RED
}

function contextColor(used: number): string {
  if (used < 50) return GREEN
  if (used < 65) return YELLOW
  if (used < 80) return ORANGE
  return RED
}

function countdown(resetsAt: string, now: number): string {
  const mins = Math.max(0, Math.floor((Date.parse(resetsAt) - now) / 60000))
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  if (hours > 0) return `${hours}h${mins % 60}m`
  return `${mins}m`
}

function tokens(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  return `${Math.round(n / 1000)}k`
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

// First string argument worth showing: a Bash command, a file's name, a search pattern.
function toolDetail(args: object): string {
  for (const key of DETAIL_KEYS) {
    const value = (args as Record<string, unknown>)[key]
    if (typeof value !== 'string') continue
    const text = key === 'file_path' ? (value.split(/[\\/]/).pop() ?? value) : (value.split('\n')[0] ?? '')
    return text.length > MAX_DETAIL_LEN ? text.slice(0, MAX_DETAIL_LEN - 1) + '…' : text
  }
  return ''
}

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | undefined> {
  const { exitCode, stdout } = await $.process.run(['git', ...args], { cwd, timeoutMs: 2000 })
  return exitCode === 0 ? stdout.trim() : undefined
}

async function refresh($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [usage, counts] = await Promise.all([
    $.session.usage(),
    git($, cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
  ])
  const [behind = 0, ahead = 0] = (counts ?? '').split(/\s+/).map(n => parseInt(n, 10) || 0)
  const limit = (kind: string): Limit | undefined => {
    const found = usage.rateLimits.find(r => r.kind === kind)
    return found && { percent: Math.round(found.percentUsed), resetsAt: found.resetsAt }
  }
  const next: Snapshot = {
    ahead,
    behind,
    contextUsed: Math.max(0, Math.min(100, Math.round(usage.context.percent ?? 0))),
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    fiveHour: limit('five_hour'),
    sevenDay: limit('seven_day'),
    costUsd: usage.cost?.usd,
  }
  await update($, snap, () => next)
}

export const register: Register = on => {
  let spinner: Timer | undefined
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, activity, () => IDLE)
    await update($, cache, () => NO_CACHE)
    await refresh($)
    ticker?.cancel()
    ticker = $.clock.every(REFRESH_MS, () => {
      refresh($).catch((err: unknown) => $.ui.log(`refresh failed: ${String(err)}`, { to: 'debug' }))
    })

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, activity, a => ({ ...a, isWorking: true, startedAt, tools: 0, current: null }))
    spinner?.cancel()
    spinner = $.clock.every(SPIN_MS, () => void update($, frame, n => (n + 1) % SPINNER.length))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id ?? String(await $.clock.now())
    await update($, activity, a => ({
      ...a,
      tools: a.tools + 1,
      current: { id, name: e.tool, detail: toolDetail(e) },
    }))
    const ran = await next(e)
    await update($, activity, a => (a.current?.id === id ? { ...a, current: null } : a))

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done

    const u = e.usage
    if (u) {
      const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await update($, cache, c => ({ read: c.read + u.cache_read_input_tokens, total: c.total + total }))
    }
    spinner?.cancel()
    spinner = undefined
    const now = await $.clock.now()
    await update($, activity, a => ({
      ...a,
      isWorking: false,
      current: null,
      lastSeconds: Math.round((now - a.startedAt) / 1000),
    }))
    await refresh($)

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || s === null) return next(e)

    const a = await read($, activity)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const filled = Math.round((s.contextUsed / 100) * BAR_WIDTH)

    let live = null
    if (a.isWorking) {
      const spin = SPINNER.charAt(await read($, frame))
      const elapsed = duration(Math.round((now - a.startedAt) / 1000))
      live = (
        <Text>
          <Text color={ACCENT}>{spin} </Text>
          <Text>{a.current ? a.current.name : 'thinking'}</Text>
          {a.current?.detail && <Text dimColor> {a.current.detail}</Text>}
          <Text dimColor>
            {' · '}
            {elapsed} · tool #{a.tools}
          </Text>
        </Text>
      )
    } else if (a.lastSeconds !== null) {
      live = (
        <Text>
          <Text dimColor>last turn </Text>
          <Text>{duration(a.lastSeconds)}</Text>
          <Text dimColor> · {a.tools} {a.tools === 1 ? 'tool' : 'tools'}</Text>
        </Text>
      )
    } else {
      live = <Text dimColor>ready · no turns yet</Text>
    }

    const c = await read($, cache)
    const stats = [
      c.total > 0 && (
        <Text>
          <Text dimColor>cache </Text>
          {Math.round((c.read / c.total) * 100)}%
        </Text>
      ),
      s.costUsd !== undefined && <Text>${s.costUsd.toFixed(2)}</Text>,
    ].filter(Boolean)

    const hasSync = s.ahead > 0 || s.behind > 0
    return (
      <Box flexDirection="column">
        {(live || stats.length > 0) && (
          <Box justifyContent="space-between" columnGap={2}>
            <Text wrap="truncate-end">{live}</Text>
            <Text>
              {stats.map((stat, i) => (
                <Text key={String(i)}>
                  {i > 0 && <Text dimColor> · </Text>}
                  {stat}
                </Text>
              ))}
            </Text>
          </Box>
        )}
        <Box justifyContent="space-between" columnGap={2}>
          <Text wrap="truncate-end">
            <Text color={contextColor(s.contextUsed)}>
              C{s.contextUsed} {'█'.repeat(filled)}
            </Text>
            <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>
            {s.contextTokens !== undefined && (
              <Text dimColor>
                {' '}
                {tokens(s.contextTokens)} / {tokens(s.contextWindow)}
              </Text>
            )}
          </Text>
          {hasSync && (
            <Text>
              {s.ahead > 0 && <Text color={GREEN}>↑{s.ahead}</Text>}
              {s.behind > 0 && <Text color={RED}>↓{s.behind}</Text>}
            </Text>
          )}
        </Box>
      </Box>
    )
  })

  // Right side of the prompt footer, after the engine's own mode labels; Desktop caps its width.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const s = await read($, snap)
    if (s === null) return next(e)

    if (s.fiveHour === undefined && s.sevenDay === undefined) return next(e)

    const now = await $.clock.now()
    const { Text } = $.ui.resolve(e)
    const sep = <Text dimColor> │ </Text>
    const limitSegment = (label: string, limit: Limit) => (
      <Text>
        <Text color={usageColor(limit.percent)}>
          {label}
          {limit.percent}
        </Text>
        {limit.resetsAt && <Text dimColor> ↺ {countdown(limit.resetsAt, now)}</Text>}
      </Text>
    )

    return (
      <Text>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
        {e.props.modes.length > 0 && sep}
        {s.fiveHour && limitSegment('H', s.fiveHour)}
        {s.fiveHour && s.sevenDay && sep}
        {s.sevenDay && limitSegment('W', s.sevenDay)}
      </Text>
    )
  })
}
