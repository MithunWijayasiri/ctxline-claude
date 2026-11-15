import { MAJOR, MINOR } from './contour-paths'
import type { StyleId } from './looks'

// The four animated backdrop scenes. A scene runs no script and loads nothing:
// every move is CSS animation inside the SVG's own <style>. Each scene is dark
// first, with a `prefers-color-scheme: light` block for the light version, and
// holds still under `prefers-reduced-motion`. Keep each under 131,072 chars.

const STILL = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'

// How strongly each scene's moving art (coals, map lines, the black hole,
// ribbons) shows over its background; kept low so it doesn't pull the eye.
const ART_OPACITY = 0.5

// Seeded so a scene is the same text every load (a changed source makes the
// app redraw the frame).
function seeded(seed: number): () => number {
  let s = seed

  return () => (s = (s * 9301 + 49297) % 233280) / 233280
}

const f = (n: number): string => n.toFixed(1).replace(/\.0$/, '')

function svg(aspect: string, style: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="${aspect}"><style>.art{opacity:${ART_OPACITY}}${style}${STILL}</style>${body}</svg>`
}

// ---------- Ember: breathing coals, soft sparks rising, a rising haze ----------

function ember(): string {
  const rnd = seeded(11)
  let coals = ''
  for (let i = 0; i < 9; i++) {
    const r = 145 + rnd() * 135
    const cx = i * 184 - 96 + rnd() * 96
    coals += `<circle class="coal" cx="${f(cx)}" cy="1000" r="${f(r)}" fill="url(#coal)" style="animation-duration:${f(4 + rnd() * 5)}s;animation-delay:-${f(rnd() * 8)}s"/>`
  }
  let sparks = ''
  for (let i = 0; i < 16; i++) {
    const cx = 40 + rnd() * 1520
    const cy = 900 + rnd() * 90
    const r = 5 + rnd() * 5
    sparks += `<circle class="spark" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="url(#spark)" style="animation-duration:${f(8 + rnd() * 6)}s;animation-delay:-${f(rnd() * 14)}s"/>`
  }

  const style =
    '.s0{stop-color:#120e0c}.s1{stop-color:#1a1310}' +
    '.g0{stop-color:rgba(217,119,87,.45)}.g1{stop-color:rgba(217,119,87,.12)}.g2{stop-color:rgba(217,119,87,0)}' +
    '.c0{stop-color:rgba(236,116,64,.85)}.c1{stop-color:rgba(236,116,64,0)}' +
    '.h0{stop-color:rgba(217,119,87,.32)}.h1{stop-color:rgba(217,119,87,0)}' +
    '.p0{stop-color:rgba(255,178,122,.9)}.p1{stop-color:rgba(255,178,122,0)}' +
    '.spark{opacity:0;animation:rise linear infinite}' +
    '.coal{transform-box:fill-box;transform-origin:center;opacity:.35;animation:smolder ease-in-out infinite}' +
    '.haze{transform-box:fill-box;transform-origin:center bottom;animation:haze 16s ease-in-out infinite}' +
    '@keyframes smolder{0%,100%{opacity:.22;transform:scale(.92)}50%{opacity:.95;transform:scale(1.06)}}' +
    '@keyframes haze{0%,100%{transform:translateY(0) scaleX(1);opacity:.55}50%{transform:translateY(-60px) scaleX(1.12);opacity:1}}' +
    '@keyframes rise{0%{opacity:0;transform:translate(0,0)}15%{opacity:.9}100%{opacity:0;transform:translate(30px,-420px)}}' +
    '@media (prefers-color-scheme:light){' +
    '.s0{stop-color:#efe5da}.s1{stop-color:#f1dccb}' +
    '.g0{stop-color:rgba(232,146,104,.35)}.g1{stop-color:rgba(232,146,104,.1)}.g2{stop-color:rgba(232,146,104,0)}' +
    '.c0{stop-color:rgba(236,140,96,.6)}.c1{stop-color:rgba(236,140,96,0)}' +
    '.h0{stop-color:rgba(240,170,125,.35)}.h1{stop-color:rgba(240,170,125,0)}' +
    '.p0{stop-color:rgba(217,119,79,.7)}.p1{stop-color:rgba(217,119,79,0)}}'

  return svg(
    'xMidYMax slice',
    style,
    '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient>' +
      '<radialGradient id="glow" cx=".3" cy="1.2" r=".85"><stop offset="0" class="g0"/><stop offset=".45" class="g1"/><stop offset="1" class="g2"/></radialGradient>' +
      '<radialGradient id="coal"><stop offset="0" class="c0"/><stop offset=".68" class="c1"/></radialGradient>' +
      '<radialGradient id="hz" cy=".6" r=".5"><stop offset="0" class="h0"/><stop offset="1" class="h1"/></radialGradient>' +
      '<radialGradient id="spark"><stop offset="0" class="p0"/><stop offset="1" class="p1"/></radialGradient>' +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      '<g class="art"><rect width="1600" height="1000" fill="url(#glow)"/>' +
      '<ellipse class="haze" cx="800" cy="900" rx="1000" ry="460" fill="url(#hz)"/>' +
      coals +
      `${sparks}</g>`,
  )
}

// ---------- Contour: map lines draw themselves in, hold, wipe away; loop flows ----------

// The map's paths are cut into stretches; each draws in (dashoffset 100→0),
// holds a beat, then erases forward (0→-100). Both cycle ends are fully hidden,
// so the loop point is invisible, and the nine stretches are evenly out of
// phase, so lines are always appearing somewhere and dissolving elsewhere.
function contour(): string {
  const split = (d: string, n: number): string[] => {
    const parts = d.split(/(?=M)/)
    const size = Math.ceil(parts.length / n)
    const out: string[] = []
    for (let i = 0; i < n; i++) out.push(parts.slice(i * size, (i + 1) * size).join(''))
    return out.filter(Boolean)
  }
  // 6 minor + 3 major stretches, interleaved evenly across one 36s cycle.
  const CYCLE = 36
  const order = ['mn', 'mn', 'mj', 'mn', 'mn', 'mj', 'mn', 'mn', 'mj']
  const pool: Record<string, string[]> = { mn: split(MINOR, 6), mj: split(MAJOR, 3) }
  const paths = order
    .map((cls, i) => `<path pathLength="100" class="${cls}" d="${pool[cls].shift()}" style="animation-delay:-${f((i * CYCLE) / order.length)}s"/>`)
    .join('')

  const style =
    '.t0{stop-color:#18202b}.t1{stop-color:#0f1318}' +
    '.mn{fill:none;stroke:rgba(217,119,87,.26);stroke-width:1.1;stroke-dasharray:100;stroke-dashoffset:0;animation:flow ' + CYCLE + 's linear infinite}' +
    '.mj{fill:none;stroke:rgba(217,119,87,.5);stroke-width:1.5;stroke-dasharray:100;stroke-dashoffset:0;animation:flow ' + CYCLE + 's linear infinite}' +
    '@keyframes flow{0%{stroke-dashoffset:100;opacity:0;animation-timing-function:cubic-bezier(.45,.05,.55,.95)}42%{stroke-dashoffset:0;opacity:1;animation-timing-function:cubic-bezier(.45,.05,.55,.95)}55%{stroke-dashoffset:0;opacity:1;animation-timing-function:cubic-bezier(.45,.05,.55,.95)}100%{stroke-dashoffset:-100;opacity:0}}' +
    '.drift{animation:drift 90s ease-in-out infinite alternate}' +
    '@keyframes drift{from{transform:translate(0,0)}to{transform:translate(-160px,-90px)}}' +
    '@media (prefers-color-scheme:light){' +
    '.t0{stop-color:#f1f3f4}.t1{stop-color:#e3e8ec}' +
    '.mn{stroke:rgba(176,92,54,.26)}.mj{stroke:rgba(176,92,54,.5)}}'

  return svg(
    'xMidYMid slice',
    style,
    '<defs>' +
      '<radialGradient id="sky" cx=".85" cy=".1" r=".9"><stop offset="0" class="t0"/><stop offset=".75" class="t1"/></radialGradient>' +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      `<g class="art"><g class="drift">${paths}</g></g>`,
  )
}

// ---------- Phoenix: a large gold black hole, its disk streaming out left, galaxies drifting round it ----------

// The hole sits on the right edge; the scene pins that side (xMaxYMid) so a
// narrow or tall window crops the left instead. The halo is the far side of
// the disk, bent round the hole; the disk's own back half is hidden inside the
// halo so the two never cross. Stars, galaxies and dust sit clear of the hole,
// its lensing and the disk by at least their drift (`clearOfHole`).
const BH_X = 1480
const BH_Y = 400
const HOLE = 190
const HALO = HOLE + 214
const LENS = HALO + 100 // outer edge of the lensed star arcs
const TILT = -7
const FLAT = 0.09 // disk ry = rx * FLAT
const DISK = HALO + 8 + 1300 // outermost ring's rx
const SINE = 'cubic-bezier(.37,0,.63,1)' // ease-in-out sine; with `alternate`, a swing that never jerks

function clearOfHole(x: number, y: number, pad: number): boolean {
  const dx = x - BH_X
  const dy = y - BH_Y
  if (Math.hypot(dx, dy) < LENS + 20 + pad) return false
  // Into the disk's plane: undo the tilt.
  const a = (-TILT * Math.PI) / 180
  const lx = dx * Math.cos(a) - dy * Math.sin(a)
  const ly = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(ly) > FLAT * Math.sqrt(Math.max(0, DISK * DISK - lx * lx)) + 40 + pad
}

function phoenix(): string {
  const rnd = seeded(41)

  const spot = (pad: number): [number, number] => {
    for (let i = 0; i < 1000; i++) {
      const x = rnd() * 1600
      const y = rnd() * 1000
      if (clearOfHole(x, y, pad)) return [x, y]
    }
    throw new Error('phoenix: no spot clear of the black hole')
  }

  // x and y swing on their own periods, so the path wanders and never stops.
  const drift = (ax: number, ay: number, period: number, body: string): string =>
    `<g class="dx" style="--a:${f(ax)}px;animation-duration:${f(period)}s;animation-delay:-${f(rnd() * period)}s">` +
    `<g class="dy" style="--a:${f(ay)}px;animation-duration:${f(period * (0.7 + rnd() * 0.25))}s;animation-delay:-${f(rnd() * period)}s">${body}</g></g>`

  // ----- Sky -----

  const STAR_TINTS = ['#fff6ea', '#fff6ea', '#fff6ea', '#e6ecff', '#ffdcae']
  let stars = ''
  for (let i = 0; i < 120; i++) {
    const [x, y] = spot(4)
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + rnd() * 0.8)}" fill="${STAR_TINTS[Math.floor(rnd() * STAR_TINTS.length)]}" opacity="${(0.15 + rnd() * 0.4).toFixed(2)}"/>`
  }
  for (let i = 0; i < 34; i++) {
    const [x, y] = spot(6)
    stars += `<circle class="tw" cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + rnd() * 0.9)}" fill="${STAR_TINTS[Math.floor(rnd() * STAR_TINTS.length)]}" style="animation-duration:${f(2.5 + rnd() * 4)}s;animation-delay:-${f(rnd() * 6)}s"/>`
  }
  // A few bright ones with a soft four-point glint.
  for (let i = 0; i < 4; i++) {
    const [x, y] = spot(16)
    const s = 7 + rnd() * 6
    stars +=
      `<g class="glint" transform="translate(${f(x)} ${f(y)})" style="animation-duration:${f(5 + rnd() * 4)}s;animation-delay:-${f(rnd() * 8)}s">` +
      `<path d="M${f(-s)} 0H${f(s)}M0 ${f(-s)}V${f(s)}"/><circle r="1.5"/></g>`
  }

  // Galaxies: [x, y, radius, tilt°, inclination (ry/rx), spiral?]
  const GALAXIES: [number, number, number, number, number, boolean][] = [
    [250, 230, 46, -24, 0.42, true],
    [720, 150, 30, 38, 0.55, true],
    [560, 830, 40, 12, 0.36, true],
    [1150, 880, 26, -40, 0.6, true],
    [110, 820, 18, 20, 0.6, false],
    [900, 120, 15, -10, 0.7, false],
  ]
  let galaxies = ''
  for (const [x, y, r, tilt, incl, spiral] of GALAXIES) {
    const ax = 10 + rnd() * 12
    const ay = 6 + rnd() * 8
    if (!clearOfHole(x, y, r + Math.max(ax, ay))) throw new Error(`phoenix: galaxy at ${x},${y} meets the black hole`)
    let body = `<circle r="${f(r)}" fill="url(#gHalo)"/>`
    if (spiral) {
      let arms = ''
      let dots = ''
      for (let k = 0; k < 2; k++) {
        let d = ''
        for (let i = 0; i <= 24; i++) {
          const t = i / 24
          const ang = k * Math.PI + t * 3.6
          const rr = r * (0.14 + 0.86 * t)
          d += `${i ? 'L' : 'M'}${f(Math.cos(ang) * rr)} ${f(Math.sin(ang) * rr)}`
        }
        arms += `<path d="${d}"/>`
        for (let i = 0; i < 16; i++) {
          const t = rnd()
          const ang = k * Math.PI + t * 3.6 + (rnd() - 0.5) * 0.4
          const rr = r * (0.14 + 0.86 * t) * (0.9 + rnd() * 0.2)
          dots += `<circle cx="${f(Math.cos(ang) * rr)}" cy="${f(Math.sin(ang) * rr)}" r="${f(0.5 + rnd() * 0.8)}" opacity="${(0.3 + (1 - t) * 0.6).toFixed(2)}"/>`
        }
      }
      body +=
        `<g class="spin" style="animation-duration:${f(260 + rnd() * 200)}s">` +
        `<g class="arm" style="stroke-width:${f(r * 0.2)}">${arms}</g><g class="arm thin">${arms}</g><g class="gdot">${dots}</g></g>`
    }
    body += `<circle r="${f(r * (spiral ? 0.3 : 0.55))}" fill="url(#gCore)"/>`
    galaxies += drift(ax, ay, 40 + rnd() * 30, `<g transform="translate(${x} ${y}) rotate(${tilt}) scale(1 ${incl})">${body}</g>`)
  }

  // Dust: three layers, nearer ones larger, drifting further and faster.
  let dust = ''
  for (let layer = 0; layer < 3; layer++) {
    const reach = 6 + layer * 6
    let motes = ''
    for (let i = 0; i < 36; i++) {
      const [x, y] = spot(reach + 2)
      motes += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + layer * 0.3 + rnd() * 0.5)}" opacity="${(0.25 + rnd() * 0.45).toFixed(2)}"/>`
    }
    dust += drift(reach, reach * 0.7, 70 - layer * 15, motes)
  }

  // ----- Black hole -----

  // Half a disk ring, right to left below the centre line (front) or left to right above it (back).
  const front = (rx: number): string => `M${f(rx)} 0A${f(rx)} ${f(rx * FLAT)} 0 0 1 ${f(-rx)} 0`
  const back = (rx: number): string => `M${f(-rx)} 0A${f(rx)} ${f(rx * FLAT)} 0 0 1 ${f(rx)} 0`

  // Striated disk: many thin rings, brighter and denser near the hole.
  let disk = ''
  let farDisk = ''
  const RINGS = 64
  for (let i = 0; i < RINGS; i++) {
    const t = i / (RINGS - 1)
    const rx = HALO + 8 + Math.pow(t, 1.15) * 1300
    const look = `style="stroke-width:${f(1.5 + rnd() * 6)};opacity:${(Math.pow(1 - t, 0.7) * (0.35 + rnd() * 0.65)).toFixed(2)}"`
    disk += `<path d="${front(rx)}" ${look}/>`
    farDisk += `<path d="${back(rx)}" ${look}/>`
  }

  // Streaks flowing round the disk, inner ones faster.
  let flow = ''
  for (let i = 0; i < 12; i++) {
    const dash = `${f(20 + rnd() * 70)} ${f(60 + rnd() * 160)}`
    const period = dash.split(' ').reduce((a, b) => a + Number(b), 0)
    flow += `<path class="flow" d="${front(HALO + 12 + Math.pow(i / 11, 1.2) * 650)}" style="stroke-width:${f(1 + rnd() * 2.5)};stroke-dasharray:${dash};--p:-${f(period * 4)}px;animation-duration:${f(5 + i * 1.6)}s"/>`
  }

  // Lensed halo rings, then a turning texture over them.
  let halo = ''
  const HALO_RINGS = 36
  for (let j = 0; j < HALO_RINGS; j++) {
    const t = j / (HALO_RINGS - 1)
    const width = 1.5 + rnd() * 6
    const opacity = Math.pow(1 - t, 1.4) * (0.4 + rnd() * 0.6)
    halo += `<circle cx="${BH_X}" cy="${BH_Y}" r="${f(HOLE + 14 + Math.pow(t, 1.15) * 200)}" style="stroke-width:${f(width)};opacity:${opacity.toFixed(2)}"/>`
  }
  let swirl = ''
  for (let k = 0; k < 6; k++) {
    swirl += `<circle class="halo-spin${k % 2 ? ' spinR' : ''}" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 22 + k * 26}" style="stroke-width:${f(1.5 + rnd() * 2)};stroke-dasharray:${f(30 + rnd() * 90)} ${f(40 + rnd() * 140)};animation-duration:${f(60 + k * 18)}s"/>`
  }

  // Light distortion: starlight just outside the halo stretched into arcs, longer nearer the hole.
  let lens = `<circle cx="${BH_X}" cy="${BH_Y}" r="${HALO + 34}" style="stroke-width:.8;opacity:.16"/>`
  for (let i = 0; i < 18; i++) {
    const near = rnd()
    const r = HALO + 14 + near * (LENS - HALO - 14)
    const a0 = rnd() * Math.PI * 2
    const a1 = a0 + (0.03 + rnd() * 0.07) * (1.3 - near)
    lens +=
      `<path d="M${f(BH_X + r * Math.cos(a0))} ${f(BH_Y + r * Math.sin(a0))}A${f(r)} ${f(r)} 0 0 1 ${f(BH_X + r * Math.cos(a1))} ${f(BH_Y + r * Math.sin(a1))}" ` +
      `style="stroke-width:${f(0.6 + rnd() * 1.1)};opacity:${((0.15 + rnd() * 0.3) * (1.1 - near)).toFixed(2)}"/>`
  }

  const plane = `transform="translate(${BH_X} ${BH_Y}) rotate(${TILT})"`
  const origin = `transform-origin:${BH_X}px ${BH_Y}px`

  const style =
    '.bg{fill:#0c0906}' +
    '.e0{stop-color:#000}.e1{stop-color:#000}.e2{stop-color:#1a1109}' +
    '.h0{stop-color:rgba(255,214,150,.16)}.h1{stop-color:rgba(255,190,110,.05)}.h2{stop-color:rgba(255,190,110,0)}' +
    // Disk colour by ring radius: cream near the hole, then gold, amber, bronze.
    '.k0{stop-color:#fff1d2}.k1{stop-color:#fcd48c}.k2{stop-color:#eeac58}.k3{stop-color:#b8702f}.k4{stop-color:#5e3417}' +
    // Halo: brighter on the upper left, where its light comes toward us.
    '.l0{stop-color:#ffe6b8}.l1{stop-color:#f2bd6a}.l2{stop-color:#9c6226}' +
    '.disk path{fill:none;stroke:url(#dg)}.far{opacity:.35}.halo circle{fill:none;stroke:url(#hg)}' +
    '.flow{fill:none;stroke:#fff1d6;stroke-linecap:round;opacity:.45;animation:flow linear infinite}' +
    `.halo-spin{fill:none;stroke:#ffe4b0;opacity:.3;${origin};animation:spin linear infinite}.spinR{animation-direction:reverse}` +
    `.lens{fill:none;stroke:#ffeccc;stroke-linecap:round;${origin};animation:spin 300s linear infinite}` +
    `.ring{fill:none;stroke:#fff3dc}.pulse{animation:pulse 8s ${SINE} infinite alternate}` +
    `.heat{fill:none;stroke:#ffd590;stroke-linecap:round;animation:heat 11s ${SINE} infinite alternate}` +
    // Sky: stars, galaxies, dust.
    `.tw{opacity:.2;animation:tw ${SINE} infinite alternate}` +
    `.glint{fill:#fff6ea;stroke:#fff6ea;stroke-width:.8;stroke-linecap:round;opacity:.35;animation:tw ${SINE} infinite alternate}` +
    `.dx,.dy{animation:dx 50s ${SINE} infinite alternate}.dy{animation-name:dy}` +
    '.spin{transform-origin:0 0;animation:spin 300s linear infinite}' +
    '.arm path{fill:none;stroke:#ecdcc2;stroke-linecap:round;stroke-linejoin:round;opacity:.1}.arm.thin path{stroke-width:1;opacity:.35}' +
    '.gdot,.dust{fill:#fff2dc}' +
    '.g0{stop-color:#fff4e0;stop-opacity:.95}.g1{stop-color:#f6d9a8;stop-opacity:.35}.g2{stop-color:#e8c48e;stop-opacity:0}' +
    '.q0{stop-color:#e9dcc8;stop-opacity:.22}.q1{stop-color:#e9dcc8;stop-opacity:0}' +
    '@keyframes flow{to{stroke-dashoffset:var(--p)}}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '@keyframes pulse{from{opacity:.6}to{opacity:1}}' +
    '@keyframes heat{from{opacity:.22}to{opacity:.42}}' +
    '@keyframes tw{from{opacity:.1}to{opacity:.9}}' +
    '@keyframes dx{from{transform:translateX(calc(var(--a) * -1))}to{transform:translateX(var(--a))}}' +
    '@keyframes dy{from{transform:translateY(calc(var(--a) * -1))}to{transform:translateY(var(--a))}}' +
    '@media (prefers-color-scheme:light){' +
    '.bg{fill:url(#day)}.e0,.e1{stop-color:#120d09}.e2{stop-color:#2e2014}' +
    '.h0{stop-color:rgba(214,150,70,.14)}.h1{stop-color:rgba(214,150,70,.04)}' +
    '.k0{stop-color:#fff3dc}.k1{stop-color:#f1c172}.k2{stop-color:#d8913f}.k3{stop-color:#9a5a24}.k4{stop-color:#5e3417}' +
    '.l0{stop-color:#ffeccc}.l1{stop-color:#e9b464}.l2{stop-color:#a8692e}' +
    '.lens{stroke:#a8692e}.sky{display:none}}'

  return svg(
    'xMaxYMid slice',
    style,
    '<defs>' +
      '<radialGradient id="day" cx=".85" cy=".4" r="1"><stop offset="0" stop-color="#f6efe4"/><stop offset=".75" stop-color="#ece5da"/></radialGradient>' +
      '<radialGradient id="haze"><stop offset="0" class="h0"/><stop offset=".5" class="h1"/><stop offset="1" class="h2"/></radialGradient>' +
      // The event horizon: black, with a faint warm rim just inside the photon ring.
      '<radialGradient id="eh"><stop offset="0" class="e0"/><stop offset=".86" class="e1"/><stop offset="1" class="e2"/></radialGradient>' +
      `<radialGradient id="dg" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1620" gradientTransform="scale(1 ${FLAT})"><stop offset=".26" class="k0"/><stop offset=".34" class="k1"/><stop offset=".5" class="k2"/><stop offset=".7" class="k3"/><stop offset="1" class="k4"/></radialGradient>` +
      `<linearGradient id="hg" gradientUnits="userSpaceOnUse" x1="${BH_X - 380}" y1="${BH_Y - 200}" x2="${BH_X + 380}" y2="${BH_Y + 200}"><stop offset="0" class="l0"/><stop offset=".45" class="l1"/><stop offset="1" class="l2"/></linearGradient>` +
      '<radialGradient id="gHalo"><stop offset="0" class="q0"/><stop offset="1" class="q1"/></radialGradient>' +
      '<radialGradient id="gCore"><stop offset="0" class="g0"/><stop offset=".35" class="g1"/><stop offset="1" class="g2"/></radialGradient>' +
      // Fades the disk's top edge, where each front ring's tip curls, into one smooth band.
      '<linearGradient id="fadeY" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="40"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>' +
      '<mask id="edge" maskUnits="userSpaceOnUse" x="-1900" y="-100" width="2400" height="400"><rect x="-1900" y="-100" width="2400" height="400" fill="url(#fadeY)"/></mask>' +
      // Hides the disk's back half inside the halo.
      `<radialGradient id="outside" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${HALO + 30}"><stop offset="${f((HALO - 30) / (HALO + 30) * 100)}%" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>` +
      '<mask id="behind" maskUnits="userSpaceOnUse" x="-1900" y="-300" width="2400" height="600"><rect x="-1900" y="-300" width="2400" height="600" fill="url(#outside)"/></mask>' +
      '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>' +
      '<filter id="wide" x="-10%" y="-300%" width="120%" height="700%"><feGaussianBlur stdDeviation="12"/></filter>' +
      '<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '<filter id="bloom" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>' +
      '<rect class="bg" width="1600" height="1000"/>' +
      `<g class="art"><g class="sky">${stars}${galaxies}<g class="dust">${dust}</g></g>` +
      `<circle cx="${BH_X}" cy="${BH_Y}" r="900" fill="url(#haze)"/>` +
      `<g ${plane} mask="url(#behind)"><g class="disk far">${farDisk}</g></g>` +
      `<circle cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 90}" fill="none" stroke="url(#hg)" stroke-width="170" opacity=".28" filter="url(#soft)"/>` +
      `<g class="halo" filter="url(#bloom)">${halo}</g>${swirl}` +
      `<g class="lens">${lens}</g></g>` +
      `<circle cx="${BH_X}" cy="${BH_Y}" r="${HOLE}" fill="url(#eh)"/>` +
      // Photon ring: a soft glow under a crisp line, and a fainter echo just outside.
      `<g class="art"><g class="pulse"><circle class="ring" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 4}" stroke-width="9" opacity=".55" filter="url(#glow)"/>` +
      `<circle class="ring" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 3}" stroke-width="1.6"/></g>` +
      `<circle class="ring" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 11}" stroke-width=".7" opacity=".4"/>` +
      `<g ${plane}><ellipse rx="1200" ry="${f(1200 * FLAT * 0.9)}" cy="${f(1200 * FLAT * 0.35)}" fill="url(#dg)" opacity=".18" filter="url(#soft)"/>` +
      `<path class="heat" d="${front(HALO + 30)}" stroke-width="26" filter="url(#wide)"/></g>` +
      `<g ${plane} mask="url(#edge)"><g class="disk" filter="url(#bloom)">${disk}</g>${flow}</g></g>`,
  )
}

// ---------- Dusk: violet and orange aurora curtains falling over layered hills ----------

function dusk(): string {
  const style =
    '.k0{stop-color:#120e17}.k1{stop-color:#1a1322}.k2{stop-color:#2a1a2a}' +
    '.ra{stop-color:#d97757}.rb{stop-color:#9b6fd6}.st{fill:#cbb8e8}' +
    '.h1{fill:#1d1525}.h2{fill:#17111e}.h3{fill:#120d17}' +
    '.fall{animation:fall 22s linear infinite}' +
    '.f2{animation:fall 30s linear infinite;animation-delay:-9s}' +
    '.f3{animation:fall 38s linear infinite;animation-delay:-20s}' +
    '@keyframes fall{0%{transform:translateY(-560px);opacity:0}12%{opacity:.55}85%{opacity:.45}100%{transform:translateY(180px);opacity:0}}' +
    '.sway{animation:skew 14s ease-in-out infinite alternate;transform-origin:800px 0}' +
    '.sw2{animation:skew 18s ease-in-out infinite alternate-reverse;transform-origin:1000px 0}' +
    '@keyframes skew{from{transform:skewX(-2.5deg)}to{transform:skewX(2.5deg)}}' +
    '.star{animation:tw 6s ease-in-out infinite alternate}' +
    '.star:nth-of-type(2n){animation-delay:-2s}.star:nth-of-type(3n){animation-delay:-4s}' +
    '@keyframes tw{from{opacity:.15}to{opacity:.6}}' +
    '@media (prefers-color-scheme:light){' +
    '.k0{stop-color:#eee8f1}.k1{stop-color:#f1e6ea}.k2{stop-color:#f6ddd0}' +
    '.ra{stop-color:#e8916c}.rb{stop-color:#b79be0}.st{fill:#8a6fb0}' +
    '.h1{fill:#e6dbe9}.h2{fill:#ddd0e2}.h3{fill:#d4c5da}' +
    '.fall,.f2,.f3{opacity:.7}}'

  return svg(
    'xMidYMax slice',
    style,
    '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="k0"/><stop offset=".55" class="k1"/><stop offset="1" class="k2"/></linearGradient>' +
      // Vertical sheets: bright mid-band, fading out at both ends of their length.
      '<linearGradient id="c1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rb" stop-opacity="0"/><stop offset=".45" class="rb" stop-opacity=".5"/><stop offset=".7" class="ra" stop-opacity=".3"/><stop offset="1" class="ra" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="c2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="rb" stop-opacity="0"/><stop offset=".5" class="rb" stop-opacity=".38"/><stop offset="1" class="rb" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="c3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ra" stop-opacity="0"/><stop offset=".5" class="ra" stop-opacity=".3"/><stop offset="1" class="ra" stop-opacity="0"/></linearGradient>' +
      '<filter id="soft" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="26"/></filter>' +
      '<filter id="haze" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="24"/></filter>' +
      '<clipPath id="sc"><rect x="0" y="0" width="1600" height="820"/></clipPath>' +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      '<g class="art">' +
      '<g class="st">' +
      '<circle class="star" cx="200" cy="140" r="1.6"/><circle class="star" cx="480" cy="90" r="1.2"/><circle class="star" cx="760" cy="180" r="1.5"/>' +
      '<circle class="star" cx="1040" cy="110" r="1.2"/><circle class="star" cx="1320" cy="200" r="1.7"/><circle class="star" cx="1480" cy="90" r="1.2"/>' +
      '<circle class="star" cx="340" cy="260" r="1.1"/><circle class="star" cx="900" cy="300" r="1.3"/><circle class="star" cx="1180" cy="330" r="1.1"/>' +
      '</g>' +
      '<g clip-path="url(#sc)">' +
      '<g class="fall" filter="url(#soft)"><g class="sway">' +
      '<path d="M180 -80 C 260 120, 220 340, 300 560 L 520 560 C 440 340, 480 120, 420 -80 Z" fill="url(#c1)"/>' +
      '</g></g>' +
      '<g class="f2" filter="url(#soft)"><g class="sw2">' +
      '<path d="M760 -120 C 840 100, 780 320, 880 540 L 1080 540 C 990 320, 1050 100, 970 -120 Z" fill="url(#c2)"/>' +
      '</g></g>' +
      '<g class="f3" filter="url(#soft)"><g class="sway">' +
      '<path d="M1160 -100 C 1240 120, 1180 320, 1280 540 L 1450 540 C 1360 320, 1420 120, 1340 -100 Z" fill="url(#c3)"/>' +
      '</g></g>' +
      '</g></g>' +
      // The hills run past every edge so the blur fades only their tops.
      '<g filter="url(#haze)">' +
      '<path class="h1" d="M-100 783 C 240 717, 453 758, 693 717 S 1173 667, 1700 733 V1100 H-100Z"/>' +
      '<path class="h2" d="M-100 858 C 293 817, 560 867, 853 825 S 1307 800, 1700 842 V1100 H-100Z"/>' +
      '<path class="h3" d="M-100 933 C 347 908, 640 942, 960 917 S 1360 900, 1700 925 V1100 H-100Z"/>' +
      '</g>',
  )
}

export const SCENES: Record<StyleId, string> = {
  ember: ember(),
  contour: contour(),
  phoenix: phoenix(),
  dusk: dusk(),
}

// Motion off (`/ctxtheme motion off`): each scene held on its reduced-motion frame.
export const STILL_SCENES = Object.fromEntries(
  Object.entries(SCENES).map(([id, source]) => [id, source.replace('<style>', '<style>*{animation:none!important}')]),
) as Record<StyleId, string>

export const SCENE_ALT: Record<StyleId, string> = {
  ember: 'Glowing coals along the bottom of a warm charcoal background, soft sparks rising from them',
  contour: 'Orange map lines drawing themselves in, holding, then wiping away, over a blue-slate background',
  phoenix: 'A large gold black hole on the right edge, its striped disk streaming out to the left, small galaxies drifting among the stars around it',
  dusk: 'Violet and orange aurora curtains falling above layered dusk hills',
}
