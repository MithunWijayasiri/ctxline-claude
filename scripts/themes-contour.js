#!/usr/bin/env node
// Generates desktop-themes/hooks/contour-paths.ts: the Contour style's map
// lines as SVG path data. A backdrop scene can't run script, so the lines are
// traced here once (marching squares over a smooth field) and shipped as data.
//
//   node scripts/themes-contour.js
//
// Deterministic: same output every run. Re-run after changing a constant below.

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MAP_W = 1600 // the scene's viewBox
const MAP_H = 1000
const STEP = 16 // grid cell, in scene units
const SCALE = 0.0105 // field units per scene unit
const LEVELS = 22
const LO = -1.4
const HI = 2.4

function field(x, y) {
  return Math.sin(x * 1.3 + Math.sin(y * 0.9) * 1.4) * 0.55 +
    Math.cos(y * 1.1 - x * 0.45) * 0.5 +
    Math.sin((x + y) * 0.7 + 1.7) * 0.35 +
    Math.exp(-((x - 4.6) ** 2 + (y - 0.9) ** 2) / 1.4) * 1.3 +
    Math.exp(-((x - 11) ** 2 + (y - 6) ** 2) / 2.2) * 1.1
}

const cols = Math.ceil(MAP_W / STEP) + 1
const rows = Math.ceil(MAP_H / STEP) + 1
const grid = new Float64Array(cols * rows)
for (let j = 0; j < rows; j++) {
  for (let i = 0; i < cols; i++) grid[j * cols + i] = field(i * STEP * SCALE, j * STEP * SCALE)
}
const level = l => LO + (HI - LO) * (l / LEVELS)

// Segments of one iso level.
function segments(t) {
  const out = []
  const lerp = (p, q) => (t - p) / (q - p)
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const x = i * STEP
      const y = j * STEP
      const a = grid[j * cols + i]
      const b = grid[j * cols + i + 1]
      const c = grid[(j + 1) * cols + i + 1]
      const d = grid[(j + 1) * cols + i]
      const pts = []
      if ((a < t) !== (b < t)) pts.push([x + STEP * lerp(a, b), y])
      if ((b < t) !== (c < t)) pts.push([x + STEP, y + STEP * lerp(b, c)])
      if ((d < t) !== (c < t)) pts.push([x + STEP * lerp(d, c), y + STEP])
      if ((a < t) !== (d < t)) pts.push([x, y + STEP * lerp(a, d)])
      if (pts.length >= 2) out.push([pts[0], pts[1]])
      if (pts.length === 4) out.push([pts[2], pts[3]])
    }
  }
  return out
}

// Join segments that share endpoints into polylines.
function polylines(segs) {
  const key = p => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)}`
  const ends = new Map()
  segs.forEach((s, n) => {
    for (const p of s) {
      const k = key(p)
      if (!ends.has(k)) ends.set(k, [])
      ends.get(k).push(n)
    }
  })
  const used = new Uint8Array(segs.length)
  const lines = []
  const walk = (line, tail) => {
    for (;;) {
      const next = (ends.get(key(tail)) || []).find(n => !used[n])
      if (next === undefined) return
      used[next] = 1
      const [p, q] = segs[next]
      tail = key(p) === key(tail) ? q : p
      line.push(tail)
    }
  }
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue
    used[n] = 1
    const fwd = [segs[n][0], segs[n][1]]
    walk(fwd, fwd[1])
    const back = [fwd[0]]
    walk(back, back[0])
    lines.push(back.slice(1).reverse().concat(fwd))
  }
  return lines
}

// Ramer-Douglas-Peucker: drop points that sit within `tol` of the line.
function simplify(pts, tol) {
  if (pts.length < 3) return pts
  let worst = 0
  let at = 0
  const [x1, y1] = pts[0]
  const [x2, y2] = pts[pts.length - 1]
  if (x1 === x2 && y1 === y2) {
    // A closed ring: its chord is a single point, so every distance below would
    // be 0 and the ring would collapse. Split it at the point farthest from the
    // start and simplify each half; the halves share that point and the start.
    let far = 1
    let best = -1
    for (let n = 1; n < pts.length - 1; n++) {
      const d = Math.hypot(pts[n][0] - x1, pts[n][1] - y1)
      if (d > best) { best = d; far = n }
    }
    return simplify(pts.slice(0, far + 1), tol).slice(0, -1).concat(simplify(pts.slice(far), tol))
  }
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  for (let n = 1; n < pts.length - 1; n++) {
    const [x, y] = pts[n]
    const dist = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / len
    if (dist > worst) { worst = dist; at = n }
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]]
  return simplify(pts.slice(0, at + 1), tol).slice(0, -1).concat(simplify(pts.slice(at), tol))
}

// Points snap to the 0.5 output grid first, so relative steps carry no rounding drift.
const snap = p => [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2]

// Relative numbers, each pair joined with the least text.
const num = v => String(Math.round(v * 2) / 2 || 0).replace(/^(-?)0\./, '$1.')
const sep = s => (s.startsWith('-') ? s : ' ' + s)
const pair = (dx, dy) => sep(num(dx)) + sep(num(dy))

// Smooth curves: quadratic through each point's midpoints, the point itself as
// the control. A closed ring starts and ends on a midpoint; an open line on its ends.
function toPath(lines) {
  let d = ''
  for (const line of lines) {
    const pts = simplify(line, 1.2)
    if (pts.length < 2) continue
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
    const ring = closed ? pts.slice(0, -1) : pts
    let cur = snap(closed ? mid(ring[ring.length - 1], ring[0]) : ring[0])
    d += `M${num(cur[0])} ${num(cur[1])}`
    const step = (c, to) => {
      c = snap(c)
      to = snap(to)
      d += `q${pair(c[0] - cur[0], c[1] - cur[1]).trimStart()}${pair(to[0] - cur[0], to[1] - cur[1])}`
      cur = to
    }
    if (closed) {
      for (let n = 0; n < ring.length; n++) step(ring[n], mid(ring[n], ring[(n + 1) % ring.length]))
    } else {
      for (let n = 1; n < ring.length - 1; n++) step(ring[n], mid(ring[n], ring[n + 1]))
      const end = snap(ring[ring.length - 1])
      d += `l${pair(end[0] - cur[0], end[1] - cur[1]).trimStart()}`
      cur = end
    }
  }
  return d
}

// Hillshade, lit from the upper right: coarse cells of light and shadow, one
// path per strength step. The scene blurs them into soft relief.
const CELL = 32
const SHADE_STEPS = 6
const LIGHT = [Math.SQRT1_2, -Math.SQRT1_2]
function hillshade() {
  const at = (x, y) => field(x * SCALE, y * SCALE)
  const raw = []
  for (let y = -2 * CELL; y < MAP_H + 2 * CELL; y += CELL) {
    for (let x = -2 * CELL; x < MAP_W + 2 * CELL; x += CELL) {
      const cx = x + CELL / 2
      const cy = y + CELL / 2
      const gx = (at(cx + 2, cy) - at(cx - 2, cy)) / 4
      const gy = (at(cx, cy + 2) - at(cx, cy - 2)) / 4
      raw.push([x, y, -(gx * LIGHT[0] + gy * LIGHT[1])])
    }
  }
  const sorted = raw.map(r => Math.abs(r[2])).sort((a, b) => a - b)
  const top = sorted[Math.floor(sorted.length * 0.95)]
  const lit = Array(SHADE_STEPS).fill('')
  const dark = Array(SHADE_STEPS).fill('')
  for (const [x, y, s] of raw) {
    const k = Math.min(SHADE_STEPS, Math.round((Math.abs(s) / top) * SHADE_STEPS))
    if (k === 0) continue
    ;(s > 0 ? lit : dark)[k - 1] += `M${x} ${y}h${CELL}v${CELL}h-${CELL}z`
  }
  return { lit, dark }
}

// Summits: grid points higher than everything within PEAK_R (inside the map), with a map height.
const PEAK_R = 5
function peaks() {
  const out = []
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const z = grid[j * cols + i]
      let top = true
      for (let v = -PEAK_R; v <= PEAK_R && top; v++) {
        for (let u = -PEAK_R; u <= PEAK_R; u++) {
          const jj = j + v
          const ii = i + u
          if (jj < 0 || jj >= rows || ii < 0 || ii >= cols || !(u || v)) continue
          if (grid[jj * cols + ii] >= z) { top = false; break }
        }
      }
      if (top) out.push([i * STEP, j * STEP, Math.round(((z - LO) / (HI - LO)) * 2400 + 200)])
    }
  }
  return out
}

let major = []
let minor = []
for (let l = 0; l < LEVELS; l++) {
  const lines = polylines(segments(level(l)))
  if (l % 5 === 0) major = major.concat(lines)
  else minor = minor.concat(lines)
}

const shade = hillshade()
const out = `// Generated by scripts/themes-contour.js. Don't edit by hand: change the
// script and run it again.

export const MAJOR = ${JSON.stringify(toPath(major))}

export const MINOR = ${JSON.stringify(toPath(minor))}

// Hillshade cells, weakest step first.
export const SHADE_LIT: string[] = ${JSON.stringify(shade.lit)}

export const SHADE_DARK: string[] = ${JSON.stringify(shade.dark)}

// [x, y, height] of each summit.
export const PEAKS: [number, number, number][] = ${JSON.stringify(peaks())}
`
const file = path.join(__dirname, '..', 'desktop-themes', 'hooks', 'contour-paths.ts')
fs.writeFileSync(file, out)
console.log(`wrote ${path.relative(process.cwd(), file)}: ${out.length} chars`)
