import { expect, test } from 'claude-code/testing'

import { LOOKS } from '../hooks/looks'

// Run with: claude plugin test ./desktop-themes
// Nothing sits beneath the plugin in a test: each hook here stands for the
// engine (the theme, the store and the command menu).

const PLUGIN = 'ctxline-desktop-themes'
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

type Engine = { sets: any[]; clears: () => number; store: Map<string, unknown> }

function engine(on: any, opts: { store?: boolean; notDrawn?: string } = {}): Engine {
  const sets: any[] = []
  const store = new Map<string, unknown>()
  const state = new Map<string, unknown>()
  let clears = 0

  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('state.get', (_: unknown, e: any) => ({ value: { value: state.get(e.key), version: 0 } }))
  on('state.set', (_: unknown, e: any) => {
    state.set(e.key, e.value)

    return { value: { isSet: true, version: 1 } }
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('theme.set', (_: unknown, e: any) => {
    sets.push(e)

    return opts.notDrawn === undefined
      ? { value: { isDrawn: true, requestId: 'r1' } }
      : { value: { isDrawn: false, reason: opts.notDrawn } }
  })
  on('theme.clear', () => {
    clears++

    return { value: { isDrawn: false, reason: 'cleared' } }
  })
  if (opts.store !== false) {
    on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
    on('store.set', (_: unknown, e: any) => {
      store.set(e.key, e.value)

      return { value: undefined }
    })
  }

  return { sets, clears: () => clears, store }
}

test('a first session sets Dusk, palette and scene', async ($, on) => {
  const { sets } = engine(on)

  await $.session.start(START)

  expect(sets.length).toBe(1)
  expect(sets[0].backdrop.scene).toBe('dusk')
  expect(sets[0].colors.label).toBe('ctxline Dusk')
})

test('every palette is one Desktop paints', async () => {
  for (const look of Object.values(LOOKS)) {
    expect(look.problems.filter(p => p.startsWith("Desktop won't paint"))).toEqual([])
  }
})

test('an unreadable store still sets Dusk', async ($, on) => {
  const { sets } = engine(on, { store: false })

  await $.session.start(START)

  expect(sets[0]?.backdrop.scene).toBe('dusk')
})

test('/ctxtheme switches, remembers, lists and turns off', async ($, on) => {
  const { sets, clears, store } = engine(on)

  // The engine stamps origin and presentation on a typed command; a test's call skips them.
  const run = (args: string) => $.command.run({ command: 'ctxtheme', args } as any)

  await $.session.start(START)

  const ran = await run(' Ember ')
  expect(ran.text).toContain('Switched to Ember')
  expect(sets.at(-1).backdrop.scene).toBe('ember')
  expect(store.get('style')).toBe('ember')

  await $.session.start(START)
  expect(sets.at(-1).backdrop.scene).toBe('ember')

  const list = await run('')
  expect(list.text).toContain('Current theme: **Ember**')
  expect(list.text).toContain('- `ember` (current): ')

  const bad = await run('neon')
  expect(bad.text).toContain('No style called')

  const off = await run('off')
  expect(off.text).toContain('off')
  expect(clears()).toBe(1)

  const before = sets.length
  await $.session.start(START)
  expect(sets.length).toBe(before)
})

test('/ctxtheme lists the style on screen when it could not be saved', async ($, on) => {
  engine(on, { store: false })
  const run = (args: string) => $.command.run({ command: 'ctxtheme', args } as any)

  await $.session.start(START)

  const ran = await run('ember')
  expect(ran.text).toContain('It couldn’t be saved')

  const list = await run('')
  expect(list.text).toContain('Current theme: **Ember**')
})

test('/ctxtheme says why when nothing draws the theme yet', async ($, on) => {
  // No client that draws themes is attached, as in a terminal-only session.
  const { store } = engine(on, { notDrawn: 'no desktop client attached' })
  const run = (args: string) => $.command.run({ command: 'ctxtheme', args } as any)

  await $.session.start(START)

  const ran = await run('phoenix')
  expect(ran.text).toContain('Switched to Phoenix, but nothing shows it here yet')
  expect(ran.text).toContain('no desktop client attached')
  expect(store.get('style')).toBe('phoenix')
})

test('the backdrop draws each scene and leaves other plugins alone', async ($, on) => {
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const scene of ['ember', 'contour', 'phoenix', 'dusk']) {
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'desktop',
      component: 'Backdrop',
      requestId: 'r1',
      props: { scene, plugin: PLUGIN, glass: false },
    } as any)
    const svg: any = await ui.find({ type: 'Svg' } as any)

    expect(svg?.props.source.startsWith('<svg')).toBe(true)
    expect(svg?.props.source.length).toBeLessThan(131072)
    await ui.unmount()
  }

  const other = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'Backdrop',
    requestId: 'r2',
    props: { scene: 'dusk', plugin: 'someone-else', glass: false },
  } as any)

  expect((await other.find({ type: 'Text', text: /engine/ } as any))?.text).toBe('engine')
  await other.unmount()
})
