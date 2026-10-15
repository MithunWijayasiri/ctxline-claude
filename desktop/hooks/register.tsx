import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown, Timer } from 'claude-code'

import type { Activity, CacheTally, Limit, Segment, Snapshot } from '../types'
import { PET_HEIGHT, PET_WIDTH, isAsleep, pet } from './pet'

const IDLE: Activity = { isWorking: false, startedAt: 0, tools: 0, current: null, lastSeconds: null }
const NO_CACHE: CacheTally = { read: 0, total: 0 }

const snap = atom({ plugin: 'ctxline-desktop', key: 'snap' } as const, null)
const activity = atom({ plugin: 'ctxline-desktop', key: 'activity' } as const, IDLE)
const frame = atom({ plugin: 'ctxline-desktop', key: 'frame' } as const, 0)
const cache = atom({ plugin: 'ctxline-desktop', key: 'cache' } as const, NO_CACHE)
const compacting = atom({ plugin: 'ctxline-desktop', key: 'compacting' } as const, false)
const poke = atom({ plugin: 'ctxline-desktop', key: 'poke' } as const, null)

const REFRESH_MS = 30000
const SPIN_MS = 250
const MAX_DETAIL_LEN = 40
const BAR_SCALE = 1000 // flexGrow is capped at 10000
const LEGEND_GAP = 2
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const DETAIL_KEYS = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'skill'] as const
const GREEN = 'green'
const YELLOW = 'yellow'
const ORANGE = '#ff8700'
const RED = 'red'
const ACCENT = '#d97757'
const BUFFER_COLOR = '#4b5160'
const FREE_COLOR = '#2e3240'

// Keyed by /context's category names (Claude Code 2.1.289); an unknown name falls back to its own name and theme color.
const CATEGORIES: Record<string, { label: string; color: string }> = {
  'System prompt': { label: 'sys', color: '#a78bfa' },
  'System tools': { label: 'tools', color: '#60a5fa' },
  'MCP tools': { label: 'mcp', color: '#f472b6' },
  'MCP server instructions': { label: 'mcp info', color: '#f9a8d4' },
  'Custom agents': { label: 'agents', color: '#34d399' },
  'Memory files': { label: 'mem', color: '#fde047' },
  Skills: { label: 'skills', color: '#fb923c' },
  Messages: { label: 'msgs', color: '#22d3ee' },
}

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
  if (n < 1000) return String(n)
  return `${Math.round(n / 1000)}k`
}

function segments(breakdown: SessionContextBreakdown | undefined): Segment[] {
  if (!breakdown) return []
  const out: Segment[] = []
  for (const c of breakdown.categories) {
    if (c.kind === 'deferred' || c.tokens <= 0) continue
    if (c.kind === 'free') out.push({ kind: 'free', label: 'free', tokens: c.tokens, color: FREE_COLOR })
    else if (c.kind === 'buffer') out.push({ kind: 'buffer', label: 'buffer', tokens: c.tokens, color: BUFFER_COLOR })
    else {
      const known = CATEGORIES[c.name]
      out.push({ kind: 'used', label: known?.label ?? c.name.toLowerCase(), tokens: c.tokens, color: known?.color ?? c.color })
    }
  }
  return out
}

function legendText(g: Segment): string {
  return `${g.label} ${tokens(g.tokens)}`
}

function moreText(hidden: number): string {
  return `+${hidden} more`
}

// How many legend items fit in `columns` cells, room kept for the `+N more` when some don't.
function legendFit(legend: Segment[], columns: number): number {
  const widths = legend.map(g => legendText(g).length + 2) // marker and space
  const total = (n: number): number => widths.slice(0, n).reduce((sum, w) => sum + w, 0) + LEGEND_GAP * Math.max(0, n - 1)
  if (total(legend.length) <= columns) return legend.length
  let fit = legend.length - 1
  while (fit > 0 && total(fit) + LEGEND_GAP + moreText(legend.length - fit).length > columns) fit--
  return fit
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
  const [usage, counts, branch, shortstat] = await Promise.all([
    $.session.usage({ breakdown: 'summary' }),
    git($, cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    git($, cwd, ['branch', '--show-current']),
    git($, cwd, ['diff', 'HEAD', '--shortstat']),
  ])
  const [behind = 0, ahead = 0] = (counts ?? '').split(/\s+/).map(n => parseInt(n, 10) || 0)
  const stat = (re: RegExp): number => parseInt(re.exec(shortstat ?? '')?.[1] ?? '0', 10)
  const limit = (kind: string): Limit | undefined => {
    const found = usage.rateLimits.find(r => r.kind === kind)
    return found && { percent: Math.round(found.percentUsed), resetsAt: found.resetsAt }
  }
  const next: Snapshot = {
    folder: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd,
    branch: branch || undefined, // empty when HEAD is detached
    added: stat(/(\d+) insertion/),
    removed: stat(/(\d+) deletion/),
    ahead,
    behind,
    contextUsed: Math.max(0, Math.min(100, Math.round(usage.context.percent ?? 0))),
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    segments: segments(usage.context.breakdown),
    fiveHour: limit('five_hour'),
    sevenDay: limit('seven_day'),
    costUsd: usage.cost?.usd,
  }
  await update($, snap, () => next)
}

/*
 * Desktop sessions are headless, where $.session.compact() is unavailable; /compact runs as a command instead.
 * command.run queues every call, so presses are locked out until the running compaction settles.
 */
async function compact($: EngineInterface): Promise<void> {
  if (await read($, compacting)) return
  await update($, compacting, () => true)
  try {
    await $.command.run({ command: 'compact' })
  } catch (err) {
    $.ui.toast(`compact failed: ${String(err)}`)
  } finally {
    await update($, compacting, () => false)
  }
}

function idleSince(a: Activity): number | null {
  return a.lastSeconds === null ? null : a.startedAt + a.lastSeconds * 1000
}

async function pokePet($: EngineInterface): Promise<void> {
  const [a, p, now] = await Promise.all([read($, activity), read($, poke), $.clock.now()])
  await update($, poke, () => ({ at: now, woke: isAsleep(idleSince(a), p, now) }))
}

export const register: Register = on => {
  let spinner: Timer | undefined
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, activity, () => IDLE)
    await update($, poke, () => null)
    await update($, cache, () => NO_CACHE)
    await update($, compacting, () => false)
    await refresh($)
    ticker?.cancel()
    ticker = $.clock.every(REFRESH_MS, () => {
      refresh($).catch((err: unknown) => $.ui.log(`refresh failed: ${String(err)}`, { to: 'debug' }))
    })
    // Always on: steps the spinner while working and the pet's frames while idle.
    spinner?.cancel()
    spinner = $.clock.every(SPIN_MS, () => void update($, frame, n => n + 1))

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await update($, activity, a => ({ ...a, isWorking: true, startedAt, tools: 0, current: null }))

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
    if (e.surface !== 'desktop') return next(e)

    const s = await read($, snap)
    if (e.props.hasSurvey || s === null) return next(e)

    const a = await read($, activity)
    const now = await $.clock.now()
    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    const isBusy = a.isWorking || e.props.isWorking
    const tick = await read($, frame)

    let live = null
    if (a.isWorking) {
      const spin = SPINNER.charAt(tick % SPINNER.length)
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

    const limitSegment = (label: string, limit: Limit) => (
      <Text>
        <Text color={usageColor(limit.percent)}>
          {label}
          {limit.percent}
        </Text>
        {limit.resetsAt && <Text dimColor> {countdown(limit.resetsAt, now)}</Text>}
      </Text>
    )
    const limits = [s.fiveHour && limitSegment('H', s.fiveHour), s.sevenDay && limitSegment('W', s.sevenDay)].filter(Boolean)

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

    const label = `C${s.contextUsed}`
    const bar: Segment[] =
      s.segments.length > 0
        ? s.segments
        : [
            { kind: 'used', label: '', tokens: s.contextUsed, color: contextColor(s.contextUsed) },
            { kind: 'free', label: '', tokens: 100 - s.contextUsed, color: FREE_COLOR },
          ]
    const barTotal = bar.reduce((sum, g) => sum + g.tokens, 0) || 1
    const legend = s.segments.filter(g => g.kind !== 'free')
    const shown = legend.slice(0, legendFit(legend, e.props.bodyColumns - label.length - 1))
    const hidden = legend.length - shown.length
    const isCompacting = await read($, compacting)
    const hasSync = s.ahead > 0 || s.behind > 0
    const groups = [limits, stats].filter(g => g.length > 0)
    const hasChanges = s.added > 0 || s.removed > 0
    const mascot = pet(isBusy, idleSince(a), await read($, poke), now, tick)
    return (
      <Box flexDirection="column" rowGap={1}>
        <Box justifyContent="space-between" alignItems="center" columnGap={2} borderStyle="round" borderDimColor paddingX={1}>
          <Box alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
            {/* Only a Button takes a click and it can't hold an Svg, so a blank one lies over the pet. */}
            <Box position="relative" flexShrink={0}>
              <Svg {...mascot} width={PET_WIDTH} height={PET_HEIGHT} />
              {!isBusy && (
                <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
                  <Button key="pet" label={' '.repeat(6)} plain onPress={() => void pokePet($)} />
                </Box>
              )}
            </Box>
            <Text wrap="truncate-end">
              <Text>{s.folder}</Text>
              {s.branch && (
                <Text>
                  <Text dimColor> ⎇ </Text>
                  {s.branch}
                </Text>
              )}
              {hasSync && (
                <Text>
                  {' '}
                  {s.ahead > 0 && <Text color={GREEN}>↑{s.ahead}</Text>}
                  {s.behind > 0 && <Text color={RED}>↓{s.behind}</Text>}
                </Text>
              )}
            </Text>
          </Box>
          {hasChanges && (
            <Text>
              <Text color={GREEN}>+{s.added.toLocaleString('en-US')}</Text>{' '}
              <Text color={RED}>-{s.removed.toLocaleString('en-US')}</Text>
            </Text>
          )}
        </Box>
        <Box justifyContent="space-between" columnGap={2}>
          <Text wrap="truncate-end">{live}</Text>
          <Text>
            {groups.map((group, gi) => (
              <Text key={String(gi)}>
                {gi > 0 && <Text dimColor> │ </Text>}
                {group.map((item, i) => (
                  <Text key={String(i)}>
                    {i > 0 && <Text dimColor> · </Text>}
                    {item}
                  </Text>
                ))}
              </Text>
            ))}
          </Text>
        </Box>
        <Box alignItems="center" columnGap={1}>
          <Text color={contextColor(s.contextUsed)}>{label}</Text>
          <Box flexGrow={1} height={1}>
            {bar.map((g, i) => (
              <Box key={String(i)} flexGrow={Math.round((g.tokens / barTotal) * BAR_SCALE)} width={0} minWidth={1} height={1} backgroundColor={g.color} />
            ))}
          </Box>
          {s.contextTokens !== undefined && (
            <Text dimColor>
              {tokens(s.contextTokens)} / {tokens(s.contextWindow)}
            </Text>
          )}
          <Text dimColor>│</Text>
          {isCompacting ? (
            <Text dimColor>compacting…</Text>
          ) : isBusy ? (
            <Text dimColor>⇣ compact</Text>
          ) : (
            <Button key="compact" label="⇣ compact" plain dimColor onPress={() => void compact($)} />
          )}
        </Box>
        {/* Desktop wraps a Text despite truncate-end: items past the width estimate wrap onto a clipped second row. */}
        {legend.length > 0 && (
          <Box columnGap={LEGEND_GAP} paddingLeft={label.length + 1}>
            <Box flexWrap="wrap" columnGap={LEGEND_GAP} flexShrink={1} minWidth={0} height={1} overflow="hidden">
              {shown.map((g, i) => (
                <Box key={String(i)} flexShrink={0}>
                  <Text>
                    <Text color={g.color}>{g.kind === 'buffer' ? '▨' : '■'}</Text>
                    <Text dimColor> {legendText(g)}</Text>
                  </Text>
                </Box>
              ))}
            </Box>
            {hidden > 0 && <Text dimColor>{moreText(hidden)}</Text>}
          </Box>
        )}
      </Box>
    )
  })
}
