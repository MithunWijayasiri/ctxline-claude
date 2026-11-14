import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_STYLE, isStyleId, LOOKS, STYLE_IDS } from './looks'
import type { StyleId } from './looks'
import { SCENE_ALT, SCENES } from './scenes'

// ctxline-desktop-themes: four dark looks (three Claude orange, one gold) for the Claude desktop
// app, each with a light version and an animated backdrop. `/ctxtheme <style>`
// switches; the pick is kept in $.store and set again at every session start
// (a theme is display-only: --resume brings none back).

const PLUGIN = 'ctxline-desktop-themes'
const COMMAND = 'ctxtheme'
const STORE_KEY = 'style' // a StyleId, or 'off'
const OFF = 'off'

type Choice = StyleId | typeof OFF

const APPLIED = { plugin: 'ctxline-desktop-themes', key: 'applied' } as const

// An unreadable store falls back to the default rather than no theme at all.
async function savedChoice($: EngineInterface): Promise<Choice> {
  const value: unknown = await $.store.get(STORE_KEY).catch(() => undefined)

  return value === OFF || isStyleId(value) ? value : DEFAULT_STYLE
}

const UNSAVED = 'It couldn’t be saved, so new sessions won’t keep it.'

// Saved after the theme changes, so a failed save leaves this session's change standing.
async function save($: EngineInterface, choice: Choice): Promise<boolean> {
  return $.store.set(STORE_KEY, choice).then(
    () => true,
    () => false,
  )
}

// Resolves why nothing draws the theme right now, or undefined when it's drawn.
// Not drawn isn't a failure: the theme still stands for the session and a
// surface that attaches later (the desktop app) draws it.
async function apply($: EngineInterface, id: StyleId): Promise<string | undefined> {
  const look = LOOKS[id]
  const set = await $.theme.set({
    colors: look.colors,
    backdrop: { scene: id, glass: look.glass },
  })

  if (set.isDrawn) {
    return undefined
  }
  $.ui.log(`${id}: not drawn: ${set.reason}`, { to: 'debug' })

  return set.reason
}

// Markdown: the app draws a command's reply as markdown, after the plugin's name.
function listing(current: Choice): string {
  const rows = STYLE_IDS.map(id => {
    const tags = [id === current && 'current', id === DEFAULT_STYLE && 'default'].filter(Boolean)
    const tag = tags.length > 0 ? ` (${tags.join(', ')})` : ''

    return `- \`${id}\`${tag}: ${LOOKS[id].blurb}`
  })
  const now = current === OFF ? '**off** (the app’s own look)' : `**${LOOKS[current].name}**`

  return [
    `Current theme: ${now}`,
    '',
    ...rows,
    '',
    `Switch with \`/${COMMAND} <style>\`. Turn off with \`/${COMMAND} off\`.`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Switch the ctxline desktop theme (ember, contour, phoenix, dusk, off)',
      argumentHint: '[ember|contour|phoenix|dusk|off]',
      immediate: true,
    })

    const choice = await savedChoice($)

    if (choice !== OFF) {
      await apply($, choice)
    }
    await $.state.set(APPLIED, choice)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === '') {
      const { value: applied } = await $.state.get(APPLIED)

      return { text: listing(applied ?? (await savedChoice($))), isTextDisplayOnly: true }
    }

    if (arg === OFF) {
      await $.theme.clear()
      await $.state.set(APPLIED, OFF)
      const keep = (await save($, OFF)) ? 'It stays off for new sessions.' : UNSAVED

      return { text: `ctxline themes off. Back to the app’s own look. ${keep}`, isTextDisplayOnly: true }
    }

    if (!isStyleId(arg)) {
      return {
        text: `No style called “${arg}”. Pick one of: ${STYLE_IDS.join(', ')}, or off.`,
        isTextDisplayOnly: true,
      }
    }

    const notDrawn = await apply($, arg)
    await $.state.set(APPLIED, arg)
    const name = LOOKS[arg].name
    const keep = (await save($, arg)) ? 'It stays on for new sessions.' : UNSAVED

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
    const scene = e.props.scene

    if (e.props.plugin !== PLUGIN || !isStyleId(scene)) {
      return next(e)
    }
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENES[scene]} alt={SCENE_ALT[scene]} isInteractive />
  })
}
