// Pixel Claude beside the folder: acts out the running tool, stands and blinks for a while after a turn, then sleeps.

export const PET_HEIGHT = 18
export const PET_WIDTH = 36 // viewBox 24×12 scaled to PET_HEIGHT
const SLEEP_AFTER_MS = 59 * 60 * 1000
const ORANGE = '#d97757'
const EYE = '#1f1a17'
const ZZZ = '#8b92a3'

const BLINK_EVERY = 16 // ticks
const BREATH_TICKS = 6
const Z_CYCLE = 10 // ticks; the z shows for the first 8
const LOOK_CYCLE = 12 // ticks: left 4, ahead 2, right 4, ahead 2
const DOT_TICKS = 2

const TYPE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const LOOK_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])

type Px = [x: number, y: number, w: number, h: number]
export type Pet = { source: string; alt: string }

function pixels(rects: Px[], fill: string): string {
  return rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join('')
}

// Two pixels of headroom above the pet for the hop, the z's and the dots.
function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" shape-rendering="crispEdges"><g transform="translate(0 2)">${body}</g></svg>`
}

// Claude Code's logo (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝) as quarter-block pixels, each 1 wide and 2 tall.
const SHELL = pixels([[3, 0, 12, 4], [1, 4, 16, 2], [3, 6, 12, 2]], ORANGE)
const OPEN_EYES: Px[] = [[5, 2, 1, 2], [12, 2, 1, 2]]
const SHUT_EYES: Px[] = [[4, 3, 2, 1], [12, 3, 2, 1]]
const DOWN_EYES: Px[] = [[5, 3, 1, 1], [12, 3, 1, 1]]
const UP_EYES: Px[] = [[5, 2, 1, 1], [12, 2, 1, 1]]
const LEG_X = [4, 6, 11, 13]
const LEGS = pixels(LEG_X.map(x => [x, 8, 1, 2]), ORANGE)

function shifted(eyes: Px[], dx: number): Px[] {
  return eyes.map(([x, y, w, h]) => [x + dx, y, w, h])
}

// Hops up a pixel, legs alternate.
function hopping(tick: number): string {
  const step = tick % 2
  const legs: Px[] = LEG_X.map((x, i) => [x, 8 - step, 1, (i % 2 === step ? 2 : 1) + step])
  return svg(`<g transform="translate(0 ${-step})">${SHELL}${pixels(OPEN_EYES, EYE)}</g>${pixels(legs, ORANGE)}`)
}

// Eyes down, legs tap in turn.
function typing(tick: number): string {
  const legs: Px[] = LEG_X.map((x, i) => [x, 8, 1, (i + tick) % 2 === 0 ? 2 : 1])
  return svg(SHELL + pixels(DOWN_EYES, EYE) + pixels(legs, ORANGE))
}

// Eyes glance left, then right.
function looking(tick: number): string {
  const k = tick % LOOK_CYCLE
  const dx = k < 4 ? -1 : k >= 6 && k < 10 ? 1 : 0
  return svg(SHELL + pixels(shifted(OPEN_EYES, dx), EYE) + LEGS)
}

// Eyes up, dots appear one by one beside it.
function thinking(tick: number): string {
  const dots = Math.floor(tick / DOT_TICKS) % 4
  const rects: Px[] = [18, 20, 22].slice(0, dots).map(x => [x, 1, 1, 1])
  return svg(SHELL + pixels(UP_EYES, EYE) + LEGS + pixels(rects, ZZZ))
}

// Stands still, blinks for one tick.
function awake(tick: number): string {
  return svg(SHELL + pixels(tick % BLINK_EVERY === BLINK_EVERY - 1 ? SHUT_EYES : OPEN_EYES, EYE) + LEGS)
}

// Rises and drifts right a pixel at a time, then a gap before the next.
function z(k: number): string {
  if (k >= Z_CYCLE - 2) return ''
  const x = 18 + Math.floor(k / 4)
  const y = 1 - Math.floor(k / 4)
  return pixels([[x, y, 5, 1], [x + 3, y + 1, 1, 1], [x + 2, y + 2, 1, 1], [x + 1, y + 3, 1, 1], [x, y + 4, 5, 1]], ZZZ)
}

// Breathes a pixel up and down, a z drifts away.
function sleeping(tick: number): string {
  const breath = Math.floor(tick / BREATH_TICKS) % 2
  return svg(`<g transform="translate(0 ${breath})">${SHELL}${pixels(SHUT_EYES, EYE)}</g>${LEGS}${z(tick % Z_CYCLE)}`)
}

function working(tool: string | null, tick: number): Pet {
  if (tool === null) return { source: thinking(tick), alt: 'Claude thinking' }
  if (TYPE_TOOLS.has(tool)) return { source: typing(tick), alt: 'Claude typing' }
  if (LOOK_TOOLS.has(tool)) return { source: looking(tick), alt: 'Claude looking around' }
  return { source: hopping(tick), alt: 'Claude working' }
}

/**
 * The pet for this render, as a plain image: frames step with `tick` (every 250ms), never SMIL, whose sandboxed
 * frame paints blank for a moment each time the image changes. `tool` is the running tool, null between tools;
 * `idleSince` is when the last turn ended, or when the session started before the first.
 */
export function pet(isBusy: boolean, tool: string | null, idleSince: number, now: number, tick: number): Pet {
  if (isBusy) return working(tool, tick)
  if (now - idleSince < SLEEP_AFTER_MS) return { source: awake(tick), alt: 'Claude idle' }
  return { source: sleeping(tick), alt: 'Claude sleeping' }
}
