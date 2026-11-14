import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_STYLE, isStyleId, LOOKS, STYLE_IDS } from './looks'
import type { StyleId } from './looks'
import { SCENE_ALT, SCENES } from './scenes'

// ctxline-desktop-themes: four dark + Claude-orange looks for the Claude desktop
// app, each with a light version and an animated backdrop. `/ctxtheme <style>`
// switches; the pick is kept in $.store and set again at every session start
// (a theme is display-only: --resume brings none back).

const PLUGIN = 'ctxline-desktop-themes'
const COMMAND = 'ctxtheme'
const STORE_KEY = 'style' // a StyleId, or 'off'
const OFF = 'off'

type Choice = StyleId | typeof OFF

// An unreadable store falls back to the default rather than no theme at all.
async function savedChoice($: EngineInterface): Promise<Choice> {
  const value: unknown = await $.store.get(STORE_KEY).catch(() => undefined)

  return value === OFF || isStyleId(value) ? value : DEFAULT_STYLE
}

async function apply($: EngineInterface, id: StyleId): Promise<void> {
  const look = LOOKS[id]
  const set = await $.theme.set({
    colors: look.colors,
    backdrop: { scene: id, glass: look.glass },
  })

  if (!set.isDrawn) {
    $.ui.log(`${id}: not drawn: ${set.reason}`, { to: 'debug' })
  }
}

function listing(current: Choice): string {
  const rows = STYLE_IDS.map(id => {
    const mark = id === current ? '●' : '○'
    const tag = id === DEFAULT_STYLE ? ' (default)' : ''

    return `${mark} ${id.padEnd(8)} ${LOOKS[id].blurb}${tag}`
  })
  const now = current === OFF ? 'off (the app’s own look)' : LOOKS[current].name

  return [
    `ctxline themes: ${now}`,
    ...rows,
    `/${COMMAND} <style> switches, /${COMMAND} off goes back to the app’s own look.`,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Switch the ctxline desktop theme (ember, contour, corona, dusk, off)',
      argumentHint: '[ember|contour|corona|dusk|off]',
      immediate: true,
    })

    const choice = await savedChoice($)

    if (choice !== OFF) {
      await apply($, choice)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === '') {
      return { text: listing(await savedChoice($)), isTextDisplayOnly: true }
    }

    if (arg === OFF) {
      await $.store.set(STORE_KEY, OFF)
      await $.theme.clear()

      return { text: 'ctxline themes off. Back to the app’s own look.', isTextDisplayOnly: true }
    }

    if (!isStyleId(arg)) {
      return {
        text: `No style called “${arg}”. Pick one of: ${STYLE_IDS.join(', ')}, or off.`,
        isTextDisplayOnly: true,
      }
    }

    await $.store.set(STORE_KEY, arg)
    await apply($, arg)

    return { text: `Switched to ${LOOKS[arg].name}. It stays on for new sessions.`, isTextDisplayOnly: true }
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
