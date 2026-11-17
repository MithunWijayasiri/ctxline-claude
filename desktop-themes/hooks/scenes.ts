import { MAJOR, MINOR } from './contour-paths'
import type { StyleId } from './looks'

// The four still backdrop scenes. A scene runs no script and loads nothing.
// Each is dark first, with a `prefers-color-scheme: light` block for the light
// version. Keep each under 131,072 chars.

// How strongly each scene's art (coals, map lines, the black hole, ribbons)
// shows over its background; kept low so it doesn't pull the eye.
const ART_OPACITY = 0.5

// Seeded so a scene is the same text every load (a changed source makes the
// app redraw the frame).
function seeded(seed: number): () => number {
  let s = seed

  return () => (s = (s * 9301 + 49297) % 233280) / 233280
}

// Draws n values and drops them, keeping later draws where they were when
// the scenes still used these for motion.
function skip(rnd: () => number, n: number): void {
  for (let i = 0; i < n; i++) rnd()
}

const f = (n: number): string => n.toFixed(1).replace(/\.0$/, '')

function svg(aspect: string, style: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="${aspect}"><style>.art{opacity:${ART_OPACITY}}${style}</style>${body}</svg>`
}

// ---------- Ember: glowing coals under a warm haze ----------

function ember(): string {
  const rnd = seeded(11)
  let coals = ''
  for (let i = 0; i < 9; i++) {
    const r = 145 + rnd() * 135
    const cx = i * 184 - 96 + rnd() * 96
    skip(rnd, 2)
    coals += `<circle class="coal" cx="${f(cx)}" cy="1000" r="${f(r)}" fill="url(#coal)"/>`
  }

  const style =
    '.s0{stop-color:#120e0c}.s1{stop-color:#1a1310}' +
    '.g0{stop-color:rgba(217,119,87,.45)}.g1{stop-color:rgba(217,119,87,.12)}.g2{stop-color:rgba(217,119,87,0)}' +
    '.c0{stop-color:rgba(236,116,64,.85)}.c1{stop-color:rgba(236,116,64,0)}' +
    '.h0{stop-color:rgba(217,119,87,.32)}.h1{stop-color:rgba(217,119,87,0)}' +
    '.coal{opacity:.35}' +
    '@media (prefers-color-scheme:light){' +
    '.s0{stop-color:#efe5da}.s1{stop-color:#f1dccb}' +
    '.g0{stop-color:rgba(232,146,104,.35)}.g1{stop-color:rgba(232,146,104,.1)}.g2{stop-color:rgba(232,146,104,0)}' +
    '.c0{stop-color:rgba(236,140,96,.6)}.c1{stop-color:rgba(236,140,96,0)}' +
    '.h0{stop-color:rgba(240,170,125,.35)}.h1{stop-color:rgba(240,170,125,0)}}'

  return svg(
    'xMidYMax slice',
    style,
    '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient>' +
      '<radialGradient id="glow" cx=".3" cy="1.2" r=".85"><stop offset="0" class="g0"/><stop offset=".45" class="g1"/><stop offset="1" class="g2"/></radialGradient>' +
      '<radialGradient id="coal"><stop offset="0" class="c0"/><stop offset=".68" class="c1"/></radialGradient>' +
      '<radialGradient id="hz" cy=".6" r=".5"><stop offset="0" class="h0"/><stop offset="1" class="h1"/></radialGradient>' +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      '<g class="art"><rect width="1600" height="1000" fill="url(#glow)"/>' +
      '<ellipse cx="800" cy="900" rx="1000" ry="460" fill="url(#hz)"/>' +
      `${coals}</g>`,
  )
}

// ---------- Contour: orange map lines over a blue-slate ground ----------

function contour(): string {
  const style =
    '.t0{stop-color:#18202b}.t1{stop-color:#0f1318}' +
    '.mn{fill:none;stroke:rgba(217,119,87,.26);stroke-width:1.1}' +
    '.mj{fill:none;stroke:rgba(217,119,87,.5);stroke-width:1.5}' +
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
      `<g class="art"><path class="mn" d="${MINOR}"/><path class="mj" d="${MAJOR}"/></g>`,
  )
}

// ---------- Phoenix: a large gold black hole, its disk streaming out left, galaxies among the stars ----------

// The hole sits on the right edge; the scene pins that side (xMaxYMid) so a
// narrow or tall window crops the left instead. The halo is the far side of
// the disk, bent round the hole; the disk's own back half is hidden inside the
// halo so the two never cross. Stars, galaxies and dust sit clear of the hole,
// its lensing and the disk (`clearOfHole`).
const BH_X = 1480
const BH_Y = 400
const HOLE = 190
const HALO = HOLE + 214
const LENS = HALO + 100 // outer edge of the lensed star arcs
const TILT = -7
const FLAT = 0.09 // disk ry = rx * FLAT
const DISK = HALO + 8 + 1300 // outermost ring's rx

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

  // ----- Sky -----

  const STAR_TINTS = ['#fff6ea', '#fff6ea', '#fff6ea', '#e6ecff', '#ffdcae']
  let stars = ''
  for (let i = 0; i < 120; i++) {
    const [x, y] = spot(4)
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + rnd() * 0.8)}" fill="${STAR_TINTS[Math.floor(rnd() * STAR_TINTS.length)]}" opacity="${(0.15 + rnd() * 0.4).toFixed(2)}"/>`
  }
  for (let i = 0; i < 34; i++) {
    const [x, y] = spot(6)
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + rnd() * 0.9)}" fill="${STAR_TINTS[Math.floor(rnd() * STAR_TINTS.length)]}" opacity=".2"/>`
    skip(rnd, 2)
  }
  // A few bright ones with a soft four-point glint.
  for (let i = 0; i < 4; i++) {
    const [x, y] = spot(16)
    const s = 7 + rnd() * 6
    stars +=
      `<g class="glint" transform="translate(${f(x)} ${f(y)})"><path d="M${f(-s)} 0H${f(s)}M0 ${f(-s)}V${f(s)}"/><circle r="1.5"/></g>`
    skip(rnd, 2)
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
    skip(rnd, 2)
    if (!clearOfHole(x, y, r)) throw new Error(`phoenix: galaxy at ${x},${y} meets the black hole`)
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
      skip(rnd, 1)
      body += `<g class="arm" style="stroke-width:${f(r * 0.2)}">${arms}</g><g class="arm thin">${arms}</g><g class="gdot">${dots}</g>`
    }
    body += `<circle r="${f(r * (spiral ? 0.3 : 0.55))}" fill="url(#gCore)"/>`
    skip(rnd, 4)
    galaxies += `<g transform="translate(${x} ${y}) rotate(${tilt}) scale(1 ${incl})">${body}</g>`
  }

  // Dust: three layers, nearer ones larger.
  let dust = ''
  for (let layer = 0; layer < 3; layer++) {
    const reach = 6 + layer * 6
    let motes = ''
    for (let i = 0; i < 36; i++) {
      const [x, y] = spot(reach + 2)
      motes += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + layer * 0.3 + rnd() * 0.5)}" opacity="${(0.25 + rnd() * 0.45).toFixed(2)}"/>`
    }
    skip(rnd, 3)
    dust += motes
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

  // Dashed streaks along the disk.
  let flow = ''
  for (let i = 0; i < 12; i++) {
    const dash = `${f(20 + rnd() * 70)} ${f(60 + rnd() * 160)}`
    flow += `<path class="flow" d="${front(HALO + 12 + Math.pow(i / 11, 1.2) * 650)}" style="stroke-width:${f(1 + rnd() * 2.5)};stroke-dasharray:${dash}"/>`
  }

  // Lensed halo rings, then a dashed texture over them.
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
    swirl += `<circle class="halo-spin" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 22 + k * 26}" style="stroke-width:${f(1.5 + rnd() * 2)};stroke-dasharray:${f(30 + rnd() * 90)} ${f(40 + rnd() * 140)}"/>`
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

  const style =
    '.bg{fill:#0c0906}' +
    '.e0{stop-color:#000}.e1{stop-color:#000}.e2{stop-color:#1a1109}' +
    '.h0{stop-color:rgba(255,214,150,.16)}.h1{stop-color:rgba(255,190,110,.05)}.h2{stop-color:rgba(255,190,110,0)}' +
    // Disk colour by ring radius: cream near the hole, then gold, amber, bronze.
    '.k0{stop-color:#fff1d2}.k1{stop-color:#fcd48c}.k2{stop-color:#eeac58}.k3{stop-color:#b8702f}.k4{stop-color:#5e3417}' +
    // Halo: brighter on the upper left, where its light comes toward us.
    '.l0{stop-color:#ffe6b8}.l1{stop-color:#f2bd6a}.l2{stop-color:#9c6226}' +
    '.disk path{fill:none;stroke:url(#dg)}.far{opacity:.35}.halo circle{fill:none;stroke:url(#hg)}' +
    '.flow{fill:none;stroke:#fff1d6;stroke-linecap:round;opacity:.45}' +
    '.halo-spin{fill:none;stroke:#ffe4b0;opacity:.3}' +
    '.lens{fill:none;stroke:#ffeccc;stroke-linecap:round}' +
    '.ring{fill:none;stroke:#fff3dc}' +
    '.heat{fill:none;stroke:#ffd590;stroke-linecap:round}' +
    // Sky: stars, galaxies, dust.
    '.glint{fill:#fff6ea;stroke:#fff6ea;stroke-width:.8;stroke-linecap:round;opacity:.35}' +
    '.arm path{fill:none;stroke:#ecdcc2;stroke-linecap:round;stroke-linejoin:round;opacity:.1}.arm.thin path{stroke-width:1;opacity:.35}' +
    '.gdot,.dust{fill:#fff2dc}' +
    '.g0{stop-color:#fff4e0;stop-opacity:.95}.g1{stop-color:#f6d9a8;stop-opacity:.35}.g2{stop-color:#e8c48e;stop-opacity:0}' +
    '.q0{stop-color:#e9dcc8;stop-opacity:.22}.q1{stop-color:#e9dcc8;stop-opacity:0}' +
    '@media (prefers-color-scheme:light){' +
    // A white hole: a luminous core with a warm rim, and a gold photon ring and deeper inner disk so both read on the pale ground.
    '.bg{fill:url(#day)}.e0{stop-color:#fffefb}.e1{stop-color:#fff8ea}.e2{stop-color:#f2d9a6}' +
    '.h0{stop-color:rgba(214,150,70,.14)}.h1{stop-color:rgba(214,150,70,.04)}' +
    '.k0{stop-color:#e4ad5c}.k1{stop-color:#dfa04e}.k2{stop-color:#d08a3a}.k3{stop-color:#9a5a24}.k4{stop-color:#5e3417}' +
    '.l0{stop-color:#f0c680}.l1{stop-color:#e0a24e}.l2{stop-color:#a8692e}' +
    '.ring{stroke:#c58637}.flow{stroke:#fff6e4}.lens{stroke:#a8692e}.sky{display:none}}'

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
      `<g class="art"><circle class="ring" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 4}" stroke-width="9" opacity=".55" filter="url(#glow)"/>` +
      `<circle class="ring" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 3}" stroke-width="1.6"/>` +
      `<circle class="ring" cx="${BH_X}" cy="${BH_Y}" r="${HOLE + 11}" stroke-width=".7" opacity=".4"/>` +
      `<g ${plane}><ellipse rx="1200" ry="${f(1200 * FLAT * 0.9)}" cy="${f(1200 * FLAT * 0.35)}" fill="url(#dg)" opacity=".18" filter="url(#soft)"/>` +
      `<path class="heat" d="${front(HALO + 30)}" stroke-width="26" filter="url(#wide)"/></g>` +
      `<g ${plane} mask="url(#edge)"><g class="disk" filter="url(#bloom)">${disk}</g>${flow}</g></g>`,
  )
}

// ---------- Dusk: mountain ridges and a still lake ----------

const SHORE = 820 // the lake's far edge; everything below it is water
const SUN_X = 950 // the sun, just set behind the ridges: the afterglow and crest rims line up on it

type Ridge = { base: number; amp: number; rough: number; dip: number; dipX: number; dipW: number }

// Crest points from x -40 to 1640: midpoint displacement for the jagged line,
// plus a dip that opens a valley toward the afterglow.
function ridgeCrest(rnd: () => number, r: Ridge): [number, number][] {
  const n = 128
  const d = new Array<number>(n + 1).fill(0)
  d[0] = (rnd() - 0.5) * r.amp
  d[n] = (rnd() - 0.5) * r.amp
  for (let step = n, amp = r.amp; step > 1; step /= 2, amp *= r.rough) {
    for (let i = step / 2; i < n; i += step) d[i] = (d[i - step / 2] + d[i + step / 2]) / 2 + (rnd() - 0.5) * amp
  }

  return d.map((dy, i) => {
    const x = -40 + (i * 1680) / n
    const y = r.base + dy + r.dip * Math.exp(-(((x - r.dipX) / r.dipW) ** 2))

    return [x, Math.min(y, SHORE)]
  })
}

const crestPath = (pts: [number, number][]): string => 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')

function dusk(): string {
  const rnd = seeded(23)

  const ridges = [
    { base: 585, amp: 150, rough: 0.62, dip: 0, dipX: 0, dipW: 1 },
    { base: 650, amp: 120, rough: 0.6, dip: 40, dipX: 1000, dipW: 350 },
    { base: 705, amp: 100, rough: 0.62, dip: 60, dipX: SUN_X, dipW: 330 },
    { base: 745, amp: 90, rough: 0.6, dip: 110, dipX: 900, dipW: 300 },
  ].map((r) => ridgeCrest(rnd, r))
  const fills = ridges.map((pts, i) => `<path class="m${i + 1}" d="${crestPath(pts)}V${SHORE + 1}H-40Z"/>`)
  // Backlit crests: a thin rim, brightest where the sun went down.
  const rimGroup = (body: string): string =>
    `<g class="rim" fill="none" stroke="url(#rimg)" stroke-linejoin="round">${body}</g>`
  const rims = [
    `<path d="${crestPath(ridges[0])}" stroke-width="5" stroke-opacity=".3" filter="url(#rg)"/><path d="${crestPath(ridges[0])}" stroke-width="1.2" stroke-opacity=".55"/>`,
    `<path d="${crestPath(ridges[1])}" stroke-width="1.2" stroke-opacity=".3"/>`,
  ]
  const r1 = ridges[0]
  const crestAt = (x: number): number => r1[Math.round(((x + 40) / 1680) * (r1.length - 1))][1]

  // Stars thin out toward the glowing horizon.
  const tint = (): string => {
    const t = rnd()

    return t < 0.7 ? 's0' : t < 0.85 ? 's1' : 's2'
  }
  let stars = ''
  for (let i = 0; i < 150; ) {
    const x = rnd() * 1600
    const y = 8 + rnd() * 540
    if (rnd() > 1 - y / 640 || y > crestAt(x) - 20) continue
    const fade = 1 - y / 640
    if (i < 28) {
      skip(rnd, 1)
      stars += `<circle class="${tint()}" cx="${f(x)}" cy="${f(y)}" r="${f(0.9 + rnd() * 0.6)}" fill-opacity="${(fade * (0.5 + rnd() * 0.4)).toFixed(2)}"/>`
      skip(rnd, 1)
    } else {
      stars += `<circle class="${tint()}" cx="${f(x)}" cy="${f(y)}" r="${f(0.4 + rnd() * 0.7)}" fill-opacity="${(fade * (0.2 + rnd() * 0.5)).toFixed(2)}"/>`
    }
    i++
  }
  for (const [x, y] of [
    [1490, 70],
    [560, 64],
    [250, 430],
  ]) {
    if (y > crestAt(x) - 40) throw new Error(`dusk: glint star at ${x},${y} sits on a ridge`)
    skip(rnd, 1)
    stars += `<g class="s0" transform="translate(${x} ${y})"><circle r="1.7"/><path d="M-8 0H8M0 -8V8" stroke="#fff6ea" stroke-width=".6" stroke-opacity=".55"/></g>`
  }

  // Mist pooled in a valley, in front of the ridge behind it: [cx, cy, rx, ry].
  const mist = (list: number[][]): string => {
    skip(rnd, list.length)

    return (
      '<g class="art">' +
      list.map(([cx, cy, rx, ry]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#mg)"/>`).join('') +
      '</g>'
    )
  }

  const style =
    '.k0{stop-color:#0c0a11}.k1{stop-color:#151020}.k2{stop-color:#261a2c}.k3{stop-color:#3d2331}' +
    '.ra{stop-color:#d97757}.rb{stop-color:#9b6fd6}.gl{stop-color:#e08a5c}.mi{stop-color:#8c7aa8}' +
    '.l0{stop-color:#1c1525}.l1{stop-color:#09070c}' +
    '.m1{fill:#211829}.m2{fill:#1a1321}.m3{fill:#130e19}.m4{fill:#0c0a10}' +
    '.s0{fill:#f3ecff}.s1{fill:#e6ecff}.s2{fill:#ffdcae}' +
    '@media (prefers-color-scheme:light){' +
    '.k0{stop-color:#e9e2ef}.k1{stop-color:#efe4ec}.k2{stop-color:#f4dccf}.k3{stop-color:#f6d2bf}' +
    '.ra{stop-color:#e8916c}.rb{stop-color:#b79be0}.gl{stop-color:#f0a07c}.mi{stop-color:#fff}' +
    '.l0{stop-color:#d9cbdf}.l1{stop-color:#e8dfec}' +
    '.m1{fill:#e2d3e3}.m2{fill:#d6c5da}.m3{fill:#c9b6d0}.m4{fill:#bba7c4}' +
    '.sky,.rim{display:none}}'

  const afterglow = `<ellipse cx="${SUN_X}" cy="680" rx="1000" ry="300" fill="url(#ag)"/>`
  const water = `y="${SHORE}" width="1600" height="${1000 - SHORE}"`

  return svg(
    'xMidYMax slice',
    style,
    '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop class="k0"/><stop offset=".4" class="k1"/><stop offset=".62" class="k2"/><stop offset=".8" class="k3"/></linearGradient>' +
      '<radialGradient id="ag"><stop class="gl" stop-opacity=".45"/><stop offset=".3" class="ra" stop-opacity=".22"/><stop offset=".65" class="rb" stop-opacity=".07"/><stop offset="1" class="rb" stop-opacity="0"/></radialGradient>' +
      `<linearGradient id="rimg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1600" y2="0"><stop class="ra" stop-opacity="0"/><stop offset=".3" class="ra" stop-opacity=".25"/><stop offset="${(SUN_X / 1600).toFixed(2)}" class="gl"/><stop offset=".85" class="ra" stop-opacity=".25"/><stop offset="1" class="ra" stop-opacity="0"/></linearGradient>` +
      '<radialGradient id="mg"><stop class="mi" stop-opacity=".14"/><stop offset="1" class="mi" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop class="l0"/><stop offset="1" class="l1"/></linearGradient>' +
      '<linearGradient id="lf" x1="0" y1="0" x2="0" y2="1"><stop class="l1" stop-opacity="0"/><stop offset="1" class="l1" stop-opacity=".55"/></linearGradient>' +
      '<filter id="rg" y="-50%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>' +
      '<filter id="ref" y="-10%" height="120%"><feGaussianBlur stdDeviation="1 3"/></filter>' +
      `<clipPath id="lk"><rect ${water}/></clipPath>` +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      afterglow +
      `<g class="art sky">${stars}</g>` +
      fills[0] +
      rimGroup(rims[0]) +
      mist([
        [400, 655, 520, 40, 30],
        [1250, 645, 480, 36, 40],
      ]) +
      fills[1] +
      rimGroup(rims[1]) +
      mist([
        [820, 712, 600, 34, 35],
        [150, 705, 350, 30, 25],
      ]) +
      fills[2] +
      mist([[1100, 772, 450, 28, 30]]) +
      fills[3] +
      // the lake: the land mirrored and softened, darkening toward the near shore
      `<rect ${water} fill="url(#lake)"/>` +
      `<g clip-path="url(#lk)" opacity=".85"><g filter="url(#ref)"><g transform="matrix(1 0 0 -1 0 ${2 * SHORE})">${afterglow}${fills.join('')}</g></g></g>` +
      `<rect ${water} fill="url(#lf)"/>` +
      rimGroup(`<path d="M-40 ${SHORE}H1640" stroke-width="1.2" stroke-opacity=".5"/>`) +
      mist([[700, SHORE - 2, 700, 18, 45]]),
  )
}

export const SCENES: Record<StyleId, string> = {
  ember: ember(),
  contour: contour(),
  phoenix: phoenix(),
  dusk: dusk(),
}

export const SCENE_ALT: Record<StyleId, string> = {
  ember: 'Glowing coals along the bottom of a warm charcoal background, a soft haze above them',
  contour: 'Orange map lines over a blue-slate background',
  phoenix: 'A large gold black hole on the right edge, its striped disk streaming out to the left, small galaxies among the stars around it',
  dusk: 'Layered mountain ridges under a violet and orange dusk sky, the afterglow mirrored in a still lake below',
}
