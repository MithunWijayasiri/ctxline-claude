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

// The map is drawn larger than the scene (1600 x 1000) so it can drift.
const MAP_W = 2400
const MAP_H = 1500
const STEP = 16 // grid cell, in scene units
const SCALE = 0.0105 // field units per scene unit
const LEVELS = 22
const LO = -1.4
const HI = 2.4
const GLOW_COUNT = 20

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

// Segments of one iso level, optionally only in cells whose centre passes `keep`.
function segments(t, keep) {
  const out = []
  const lerp = (p, q) => (t - p) / (q - p)
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const x = i * STEP
      const y = j * STEP
      if (keep && !keep(x + STEP / 2, y + STEP / 2)) continue
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

// Absolute start, then relative steps: the shortest path text.
function toPath(lines) {
  let d = ''
  for (const line of lines) {
    const pts = simplify(line, 1.2).map(([x, y]) => [Math.round(x), Math.round(y)])
    if (pts.length < 2) continue
    d += `M${pts[0][0]} ${pts[0][1]}l`
    for (let n = 1; n < pts.length; n++) {
      const dx = pts[n][0] - pts[n - 1][0]
      const dy = pts[n][1] - pts[n - 1][1]
      d += `${n > 1 && dx >= 0 ? ' ' : ''}${dx}${dy >= 0 ? ' ' : ''}${dy}`
    }
  }
  return d
}

let major = []
let minor = []
for (let l = 0; l < LEVELS; l++) {
  const lines = polylines(segments(level(l)))
  if (l % 5 === 0) major = major.concat(lines)
  else minor = minor.concat(lines)
}

// Glowing bands: two neighbouring levels near a seeded spot, faded by a mask.
let seed = 17
const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
const glows = []
for (let n = 0; n < GLOW_COUNT; n++) {
  const cx = Math.round(120 + rnd() * (MAP_W - 240))
  const cy = Math.round(100 + rnd() * (MAP_H - 200))
  const r = Math.round(220 + rnd() * 160)
  const inside = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= (r + STEP) ** 2
  // Pick the first level pair that actually crosses this spot.
  const start = Math.floor(rnd() * (LEVELS - 1))
  let d = ''
  for (let k = 0; k < LEVELS - 1 && !d; k++) {
    const l = (start + k) % (LEVELS - 1)
    d = toPath(polylines(segments(level(l), inside))) + toPath(polylines(segments(level(l + 1), inside)))
  }
  if (d) glows.push({ cx, cy, r, d })
}

const out = `// Generated by scripts/themes-contour.js. Don't edit by hand: change the
// script and run it again.

export const MAP_W = ${MAP_W}
export const MAP_H = ${MAP_H}

export const MAJOR = ${JSON.stringify(toPath(major))}

export const MINOR = ${JSON.stringify(toPath(minor))}

export const GLOWS: readonly { cx: number; cy: number; r: number; d: string }[] = ${JSON.stringify(glows, null, 2)}
`
const file = path.join(__dirname, '..', 'desktop-themes', 'hooks', 'contour-paths.ts')
fs.writeFileSync(file, out)
console.log(`wrote ${path.relative(process.cwd(), file)}: ${out.length} chars, ${glows.length} glows`)
