import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_STYLE, isStyleId, LOOKS, STYLE_IDS } from './looks'
import type { StyleId } from './looks'
import { SCENE_ALT, SCENES, STILL_SCENES } from './scenes'

// ctxline-desktop-themes: four dark looks (three Claude orange, one gold) for the Claude desktop
// app, each with a light version and an animated backdrop. `/ctxtheme <style>`
// switches; the pick is kept in $.store and set again at every session start
// (a theme is display-only: --resume brings none back).

const PLUGIN = 'ctxline-desktop-themes'
const COMMAND = 'ctxtheme'
const STORE_KEY = 'style' // a StyleId, or 'off'
const MOTION_KEY = 'motion' // 'off' holds the background still; anything else moves
const OFF = 'off'
// Scene id suffix for a still background; a new id gives the Svg a new source, so it redraws.
const STILL = '-still'

type Choice = StyleId | typeof OFF

const APPLIED = { plugin: 'ctxline-desktop-themes', key: 'applied' } as const
const SHOWN_STILL = { plugin: 'ctxline-desktop-themes', key: 'still' } as const

// An unreadable store falls back to the default rather than no theme at all.
async function savedChoice($: EngineInterface): Promise<Choice> {
  const value: unknown = await $.store.get(STORE_KEY).catch(() => undefined)

  return value === OFF || isStyleId(value) ? value : DEFAULT_STYLE
}

// An unreadable store keeps the background moving.
async function savedStill($: EngineInterface): Promise<boolean> {
  return (await $.store.get(MOTION_KEY).catch(() => undefined)) === OFF
}

// This session's motion, so a failed save still reports and keeps what's on screen.
async function isStill($: EngineInterface): Promise<boolean> {
  const { value } = await $.state.get(SHOWN_STILL)

  return value ?? (await savedStill($))
}

const UNSAVED = 'It couldn’t be saved, so new sessions won’t keep it.'

// Saved after the theme changes, so a failed save leaves this session's change standing.
async function save($: EngineInterface, key: string, value: string): Promise<boolean> {
  return $.store.set(key, value).then(
    () => true,
    () => false,
  )
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Resolves why nothing draws the theme right now, or undefined when it's drawn.
// Not drawn isn't a failure: the theme still stands for the session.
// A window that can't take themes (the terminal) throws instead of answering not drawn.
async function apply($: EngineInterface, id: StyleId, still: boolean): Promise<string | undefined> {
  const look = LOOKS[id]
  const scene = still ? `${id}${STILL}` : id
  const set = await $.theme
    .set({ colors: look.colors, backdrop: { scene, glass: look.glass } })
    .catch((err: unknown) => ({ isDrawn: false as const, reason: reasonOf(err) }))

  if (set.isDrawn) {
    return undefined
  }
  $.ui.log(`${id}: not drawn: ${set.reason}`, { to: 'debug' })

  return set.reason
}

// Markdown: the app draws a command's reply as markdown, after the plugin's name.
function listing(current: Choice, still: boolean): string {
  const rows = STYLE_IDS.map(id => {
    const tags = [id === current && 'current', id === DEFAULT_STYLE && 'default'].filter(Boolean)
    const tag = tags.length > 0 ? ` (${tags.join(', ')})` : ''

    return `- \`${id}\`${tag}: ${LOOKS[id].blurb}`
  })
  const now = current === OFF ? '**off** (the app’s own look)' : `**${LOOKS[current].name}**`

  return [
    `Current theme: ${now}`,
    `Background motion: **${still ? 'off' : 'on'}**`,
    '',
    ...rows,
    '',
    `Switch with \`/${COMMAND} <style>\`. Turn off with \`/${COMMAND} off\`.`,
    `\`/${COMMAND} motion off\` keeps the theme but holds the background still; \`/${COMMAND} motion on\` moves it again.`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Switch the ctxline desktop theme (ember, contour, phoenix, dusk, off), or its motion',
      argumentHint: '[ember|contour|phoenix|dusk|off|motion on|motion off]',
      immediate: true,
    })

    const choice = await savedChoice($)
    const still = await savedStill($)

    if (choice !== OFF) {
      await apply($, choice, still)
    }
    await $.state.set(APPLIED, choice)
    await $.state.set(SHOWN_STILL, still)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === '') {
      const { value: applied } = await $.state.get(APPLIED)

      return { text: listing(applied ?? (await savedChoice($)), await isStill($)), isTextDisplayOnly: true }
    }

    if (arg === OFF) {
      // Nothing to clear in a window that can't take themes.
      await $.theme.clear().catch((err: unknown) => $.ui.log(`off: not cleared: ${reasonOf(err)}`, { to: 'debug' }))
      await $.state.set(APPLIED, OFF)
      const keep = (await save($, STORE_KEY, OFF)) ? 'It stays off for new sessions.' : UNSAVED

      return { text: `ctxline themes off. Back to the app’s own look. ${keep}`, isTextDisplayOnly: true }
    }

    const motion = /^motion(?:\s+(on|off))?$/.exec(arg)

    if (motion !== null) {
      if (motion[1] === undefined) {
        const now = (await isStill($)) ? 'off: the background holds still' : 'on: the background moves'

        return {
          text: `Background motion is ${now}. Change it with \`/${COMMAND} motion on\` or \`/${COMMAND} motion off\`.`,
          isTextDisplayOnly: true,
        }
      }

      const still = motion[1] === OFF
      const { value: applied } = await $.state.get(APPLIED)
      const current = applied ?? (await savedChoice($))

      if (current !== OFF) {
        await apply($, current, still)
      }
      await $.state.set(SHOWN_STILL, still)
      const said = still ? 'Motion off: the background holds still.' : 'Motion on: the background moves.'
      const later = current === OFF ? ' It applies once a theme is on.' : ''
      const keep = (await save($, MOTION_KEY, motion[1])) ? 'It stays that way for new sessions.' : UNSAVED

      return { text: `${said}${later} ${keep}`, isTextDisplayOnly: true }
    }

    if (!isStyleId(arg)) {
      return {
        text: `No style called “${arg}”. Pick one of: ${STYLE_IDS.join(', ')}, or off. For motion: \`/${COMMAND} motion on\` or \`/${COMMAND} motion off\`.`,
        isTextDisplayOnly: true,
      }
    }

    const notDrawn = await apply($, arg, await isStill($))
    await $.state.set(APPLIED, arg)
    const name = LOOKS[arg].name
    const keep = (await save($, STORE_KEY, arg)) ? 'It stays on for new sessions.' : UNSAVED

    if (notDrawn !== undefined) {
      return {
        text: `Switched to ${name}, but nothing shows it here yet: ${notDrawn}. It appears in the Claude desktop app. ${keep}`,
        isTextDisplayOnly: true,
      }
    }

    return { text: `Switched to ${name}. ${keep}`, isTextDisplayOnly: true }
  }).catch(() => ({ text: 'ctxline themes could not switch the theme. Try again.', isTextDisplayOnly: true }))

  // Draws the backdrop scene this plugin set; another plugin's is left alone.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    const scene = String(e.props.scene)
    const still = scene.endsWith(STILL)
    const id = still ? scene.slice(0, -STILL.length) : scene

    if (e.props.plugin !== PLUGIN || !isStyleId(id)) {
      return next(e)
    }
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={(still ? STILL_SCENES : SCENES)[id]} alt={SCENE_ALT[id]} isInteractive />
  })
}
