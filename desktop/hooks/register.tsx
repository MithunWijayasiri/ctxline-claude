import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Activity, CacheTally, Limit, ModelLimit, ModelLimits, Snapshot } from '../types'
import { PET_HEIGHT, PET_WIDTH, pet } from './pet'

const IDLE: Activity = { isWorking: false, startedAt: 0, tools: 0, current: null, lastSeconds: null }
const NO_CACHE: CacheTally = { read: 0, total: 0 }
const NO_MODELS: ModelLimits = { limits: [], ok: true }

const snap = atom({ plugin: 'ctxline-desktop', key: 'snap' } as const, null)
const activity = atom({ plugin: 'ctxline-desktop', key: 'activity' } as const, IDLE)
const frame = atom({ plugin: 'ctxline-desktop', key: 'frame' } as const, 0)
const cache = atom({ plugin: 'ctxline-desktop', key: 'cache' } as const, NO_CACHE)
const models = atom({ plugin: 'ctxline-desktop', key: 'models' } as const, NO_MODELS)

const REFRESH_MS = 30000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const SPIN_MS = 250
const MAX_DETAIL_LEN = 40
const LINE_HEIGHT = 3 // CSS pixels
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const DETAIL_KEYS = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'skill'] as const
const GREEN = 'green'
const YELLOW = 'yellow'
const ORANGE = '#ff8700'
const RED = 'red'
const GREY = '#6b7280'
const ACCENT = '#d97757'
const TRACK_COLOR = '#2e3240'
// An Svg takes CSS colors, where green and yellow are far darker than the theme's.
const SVG_COLORS = { [GREEN]: '#22c55e', [YELLOW]: '#eab308', [ORANGE]: ORANGE, [RED]: '#f43f5e' }

function usageColor(percent: number): string {
  if (percent < 60) return GREEN
  if (percent < 80) return YELLOW
  if (percent < 90) return ORANGE
  return RED
}

// Same as the CLI's model bars: flat orange sets them apart from H/W, red flags a nearly spent cap.
function modelColor(percent: number): string {
  return percent >= 90 ? RED : ORANGE
}

function contextColor(used: number): keyof typeof SVG_COLORS {
  if (used < 50) return GREEN
  if (used < 65) return YELLOW
  if (used < 80) return ORANGE
  return RED
}

// The context share used, filled over a dim track; stretched to the slot's width.
function contextLine(used: number): string {
  const bar = (width: number, color: string): string => `<rect width="${width}" height="${LINE_HEIGHT}" rx="1.5" fill="${color}"/>`
  const fill = used > 0 ? bar(used * 10, SVG_COLORS[contextColor(used)]) : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${LINE_HEIGHT}" viewBox="0 0 1000 ${LINE_HEIGHT}" preserveAspectRatio="none">${bar(1000, TRACK_COLOR)}${fill}</svg>`
}

function tokens(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  if (n < 1000) return String(n)
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
  const [usage, counts, branch] = await Promise.all([
    $.session.usage(),
    git($, cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
    git($, cwd, ['branch', '--show-current']),
  ])
  const [behind = 0, ahead = 0] = (counts ?? '').split(/\s+/).map(n => parseInt(n, 10) || 0)
  const limit = (kind: string): Limit | undefined => {
    const found = usage.rateLimits.find(r => r.kind === kind)
    return found && { percent: Math.round(found.percentUsed) }
  }
  const next: Snapshot = {
    folder: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd,
    branch: branch || undefined, // empty when HEAD is detached
    ahead,
    behind,
    contextUsed: Math.max(0, Math.min(100, Math.round(usage.context.percent ?? 0))),
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    fiveHour: limit('five_hour'),
    sevenDay: limit('seven_day'),
  }
  await update($, snap, () => next)
}

// Model-scoped weekly limits (`limits[]` entries of kind weekly_scoped), labeled by the model's initial: Fable -> F.
function scopedLimits(payload: { limits?: unknown }): ModelLimit[] {
  if (!Array.isArray(payload.limits)) return []
  return payload.limits.flatMap(entry => {
    const name: unknown = entry?.scope?.model?.display_name
    const percent: unknown = entry?.percent
    if (entry?.kind !== 'weekly_scoped' || typeof name !== 'string' || !name.trim() || typeof percent !== 'number' || !Number.isFinite(percent)) return []
    return [{ letter: name.trim().charAt(0).toUpperCase(), percent: Math.max(0, Math.min(100, Math.round(percent))) }]
  })
}

// Only the OAuth usage API has them; none without a subscription login.
async function refreshModels($: EngineInterface): Promise<void> {
  const auth = await $.session.authorize()
  if (auth?.kind !== 'bearer') return
  const res = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
  if (!res.ok) throw new Error(`usage API ${res.status}`)
  const limits = scopedLimits(JSON.parse(res.text))
  await update($, models, () => ({ limits, ok: true }))
}

// Before the first turn, startedAt is the session start.
function idleSince(a: Activity): number {
  return a.startedAt + (a.lastSeconds ?? 0) * 1000
}

export const register: Register = on => {
  let spinner: Timer | undefined
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.clock.now()
    await update($, activity, () => ({ ...IDLE, startedAt: now }))
    await update($, cache, () => NO_CACHE)
    const fetchModels = (): void => {
      refreshModels($).catch(async (err: unknown) => {
        $.ui.log(`model limits failed: ${String(err)}`, { to: 'debug' })
        await update($, models, m => ({ ...m, ok: false }))
      })
    }
    fetchModels()
    await refresh($)
    ticker?.cancel()
    ticker = $.clock.every(REFRESH_MS, () => {
      refresh($).catch((err: unknown) => $.ui.log(`refresh failed: ${String(err)}`, { to: 'debug' }))
      fetchModels()
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
    const { Box, Svg, Text } = $.ui.resolve(e)
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
            {elapsed}
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

    const m = await read($, models)
    // A failed model fetch keeps the letters only: grey, 00%.
    type Usage = { label: string; text: string; color: string }
    const limits: Usage[] = []
    if (s.fiveHour) limits.push({ label: 'H', text: `${s.fiveHour.percent}%`, color: usageColor(s.fiveHour.percent) })
    if (s.sevenDay) limits.push({ label: 'W', text: `${s.sevenDay.percent}%`, color: usageColor(s.sevenDay.percent) })
    for (const l of m.limits) {
      limits.push(m.ok ? { label: l.letter, text: `${l.percent}%`, color: modelColor(l.percent) } : { label: l.letter, text: '00%', color: GREY })
    }

    const c = await read($, cache)
    const stats = [
      c.total > 0 && (
        <Text>
          <Text dimColor>cache </Text>
          {Math.round((c.read / c.total) * 100)}%
        </Text>
      ),
      s.contextTokens !== undefined && (
        <Text dimColor>
          {tokens(s.contextTokens)} / {tokens(s.contextWindow)}
        </Text>
      ),
    ].filter(Boolean)

    const hasSync = s.ahead > 0 || s.behind > 0
    const mascot = pet(isBusy, a.current?.name ?? null, idleSince(a), now, tick)
    return (
      <Box flexDirection="column" rowGap="xs">
        <Box justifyContent="space-between" alignItems="center" columnGap={2}>
          <Box alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
            <Box flexShrink={0}>
              <Svg {...mascot} width={PET_WIDTH} height={PET_HEIGHT} />
            </Box>
            <Box flexShrink={1} minWidth={0}>
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
            <Box flexShrink={1} minWidth={0}>
              <Text wrap="truncate-end">
                <Text dimColor>│ </Text>
                {live}
              </Text>
            </Box>
          </Box>
          <Box flexShrink={1} minWidth={0}>
            <Box flexShrink={1} minWidth={0}>
              <Text wrap="truncate-end">
                {stats.map((item, i) => (
                  <Text key={`s${i}`}>
                    {i > 0 && <Text dimColor> · </Text>}
                    {item}
                  </Text>
                ))}
                {stats.length > 0 && limits.length > 0 && <Text dimColor> │ </Text>}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text>
                {limits.map((l, i) => (
                  <Text key={l.label}>
                    {i > 0 && <Text dimColor> · </Text>}
                    <Text dimColor>{l.label} </Text>
                    <Text color={l.color}>{l.text}</Text>
                  </Text>
                ))}
              </Text>
            </Box>
          </Box>
        </Box>
        <Svg source={contextLine(s.contextUsed)} alt={`context ${s.contextUsed}% used`} height={LINE_HEIGHT} />
      </Box>
    )
  })
}
