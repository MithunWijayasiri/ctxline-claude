// Pixel Claude beside the folder: hops while a turn runs, stands and blinks for a while after, then sleeps.
// A click wakes it with a start; a click while awake gets a happy hop and a heart.

import type { Poke } from '../types'

export const PET_HEIGHT = 18
export const PET_WIDTH = 36 // viewBox 24×12 scaled to PET_HEIGHT
const SLEEP_AFTER_MS = 5 * 60 * 1000
const TICK_MS = 250
const ORANGE = '#d97757'
const EYE = '#1f1a17'
const ZZZ = '#8b92a3'
const HEART = '#f472b6'

const BLINK_EVERY = 16 // ticks
const BREATH_TICKS = 6
const Z_CYCLE = 10 // ticks; the z shows for the first 8
const STARTLE_TICKS = 6
const TRICK_TICKS = 10

type Px = [x: number, y: number, w: number, h: number]
export type Pet = { source: string; alt: string }

function pixels(rects: Px[], fill: string): string {
  return rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join('')
}

// Two pixels of headroom above the pet for the hop and the z's.
function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" shape-rendering="crispEdges"><g transform="translate(0 2)">${body}</g></svg>`
}

// Claude Code's logo (▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝) as quarter-block pixels, each 1 wide and 2 tall.
const SHELL = pixels([[3, 0, 12, 4], [1, 4, 16, 2], [3, 6, 12, 2]], ORANGE)
const OPEN_EYES: Px[] = [[5, 2, 1, 2], [12, 2, 1, 2]]
const SHUT_EYES: Px[] = [[4, 3, 2, 1], [12, 3, 2, 1]]
const WIDE_EYES: Px[] = [[4, 2, 2, 2], [12, 2, 2, 2]]
const HAPPY_EYES: Px[] = [[4, 3, 1, 1], [5, 2, 1, 1], [6, 3, 1, 1], [11, 3, 1, 1], [12, 2, 1, 1], [13, 3, 1, 1]]
const LEG_X = [4, 6, 11, 13]
const LEGS = pixels(LEG_X.map(x => [x, 8, 1, 2]), ORANGE)

// Hops up a pixel, legs alternate.
function working(tick: number): string {
  const step = tick % 2
  const legs: Px[] = LEG_X.map((x, i) => [x, 8 - step, 1, (i % 2 === step ? 2 : 1) + step])
  return svg(`<g transform="translate(0 ${-step})">${SHELL}${pixels(OPEN_EYES, EYE)}</g>${pixels(legs, ORANGE)}`)
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

// Jumps with wide eyes, an exclamation mark beside it, then lands.
function startled(t: number): string {
  const lift = t < 2 ? 2 : 0
  const bang = pixels([[20, -1, 1, 3], [20, 3, 1, 1]], ORANGE)
  return svg(`<g transform="translate(0 ${-lift})">${SHELL}${pixels(WIDE_EYES, EYE)}${LEGS}</g>${bang}`)
}

// Hops twice with happy eyes while a heart floats up.
function trick(t: number): string {
  const lift = t < 8 && t % 4 < 2 ? 2 : 0
  const y = Math.max(-2, 3 - Math.floor(t / 2))
  const heart = pixels([[18, y, 2, 1], [21, y, 2, 1], [18, y + 1, 5, 1], [19, y + 2, 3, 1], [20, y + 3, 1, 1]], HEART)
  return svg(`<g transform="translate(0 ${-lift})">${SHELL}${pixels(HAPPY_EYES, EYE)}${LEGS}</g>${heart}`)
}

/** Whether the pet sleeps: no turn ended and no click in the last 5 minutes. */
export function isAsleep(idleSince: number | null, poke: Poke | null, now: number): boolean {
  const since = Math.max(idleSince ?? -Infinity, poke?.at ?? -Infinity)
  return now - since >= SLEEP_AFTER_MS
}

/**
 * The pet for this render, as a plain image: frames step with `tick` (every 250ms), never SMIL, whose sandboxed
 * frame paints blank for a moment each time the image changes. `idleSince` is when the last turn ended, null before the first;
 * `poke` is the last click, whose animation steps from the click itself.
 */
export function pet(isBusy: boolean, idleSince: number | null, poke: Poke | null, now: number, tick: number): Pet {
  if (isBusy) return { source: working(tick), alt: 'Claude working' }
  if (poke !== null) {
    const t = Math.floor((now - poke.at) / TICK_MS)
    if (poke.woke && t < STARTLE_TICKS) return { source: startled(t), alt: 'Claude waking up' }
    if (!poke.woke && t < TRICK_TICKS) return { source: trick(t), alt: 'Claude happy' }
  }
  if (!isAsleep(idleSince, poke, now)) return { source: awake(tick), alt: 'Claude idle' }
  return { source: sleeping(tick), alt: 'Claude sleeping' }
}
