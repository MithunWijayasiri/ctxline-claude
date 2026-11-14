import { GLOWS, MAJOR, MAP_H, MAP_W, MINOR } from './contour-paths'
import type { StyleId } from './looks'

// The four animated backdrop scenes. A scene runs no script and loads nothing:
// every move is CSS animation inside the SVG's own <style>. Each scene is dark
// first, with a `prefers-color-scheme: light` block for the light version, and
// holds still under `prefers-reduced-motion`. Keep each under 131,072 chars.

const STILL = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'

// Seeded so a scene is the same text every load (a changed source makes the
// app redraw the frame).
function seeded(seed: number): () => number {
  let s = seed

  return () => (s = (s * 9301 + 49297) % 233280) / 233280
}

const f = (n: number): string => n.toFixed(1).replace(/\.0$/, '')

function svg(aspect: string, style: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="${aspect}"><style>${style}${STILL}</style>${body}</svg>`
}

// ---------- Ember: breathing coals, pulsing cracks, a rising haze ----------

const CRACKS = [
  'M30 598 L80 566 L122 578 L170 546 L226 556 L262 532',
  'M122 578 L140 600',
  'M300 600 L334 574 L392 584 L428 558 L470 566',
  'M520 598 L558 570 L612 580 L650 550 L702 560 L740 536',
  'M650 550 L664 528',
  'M820 600 L852 578 L906 588 L944 560 L990 568',
  'M1000 598 L1036 566 L1084 576 L1124 548 L1176 558',
  'M1084 576 L1096 600',
]

function ember(): string {
  const rnd = seeded(11)
  let coals = ''
  for (let i = 0; i < 9; i++) {
    const r = 145 + rnd() * 135
    const cx = i * 184 - 96 + rnd() * 96
    coals += `<circle class="coal" cx="${f(cx)}" cy="1000" r="${f(r)}" fill="url(#coal)" style="animation-duration:${f(4 + rnd() * 5)}s;animation-delay:-${f(rnd() * 8)}s"/>`
  }
  const cracks = CRACKS.map(
    d => `<path class="crack" d="${d}" style="animation-duration:${f(3.5 + rnd() * 4)}s;animation-delay:-${f(rnd() * 6)}s"/>`,
  ).join('')

  const style =
    '.s0{stop-color:#120e0c}.s1{stop-color:#1a1310}' +
    '.g0{stop-color:rgba(217,119,87,.45)}.g1{stop-color:rgba(217,119,87,.12)}.g2{stop-color:rgba(217,119,87,0)}' +
    '.c0{stop-color:rgba(236,116,64,.85)}.c1{stop-color:rgba(236,116,64,0)}' +
    '.h0{stop-color:rgba(217,119,87,.32)}.h1{stop-color:rgba(217,119,87,0)}' +
    '.crack{fill:none;stroke:#ffa06a;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.15;animation:pulse ease-in-out infinite}' +
    '.coal{transform-box:fill-box;transform-origin:center;opacity:.35;animation:smolder ease-in-out infinite}' +
    '.haze{transform-box:fill-box;transform-origin:center bottom;animation:haze 16s ease-in-out infinite}' +
    '@keyframes smolder{0%,100%{opacity:.22;transform:scale(.92)}50%{opacity:.95;transform:scale(1.06)}}' +
    '@keyframes haze{0%,100%{transform:translateY(0) scaleX(1);opacity:.55}50%{transform:translateY(-60px) scaleX(1.12);opacity:1}}' +
    '@keyframes pulse{0%,100%{opacity:.1}50%{opacity:.9}}' +
    '@media (prefers-color-scheme:light){' +
    '.s0{stop-color:#efe5da}.s1{stop-color:#f1dccb}' +
    '.g0{stop-color:rgba(232,146,104,.35)}.g1{stop-color:rgba(232,146,104,.1)}.g2{stop-color:rgba(232,146,104,0)}' +
    '.c0{stop-color:rgba(236,140,96,.6)}.c1{stop-color:rgba(236,140,96,0)}' +
    '.h0{stop-color:rgba(240,170,125,.35)}.h1{stop-color:rgba(240,170,125,0)}' +
    '.crack{stroke:#d9774f}}'

  return svg(
    'xMidYMax slice',
    style,
    '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient>' +
      '<radialGradient id="glow" cx=".3" cy="1.2" r=".85"><stop offset="0" class="g0"/><stop offset=".45" class="g1"/><stop offset="1" class="g2"/></radialGradient>' +
      '<radialGradient id="coal"><stop offset="0" class="c0"/><stop offset=".68" class="c1"/></radialGradient>' +
      '<radialGradient id="hz" cy=".6" r=".5"><stop offset="0" class="h0"/><stop offset="1" class="h1"/></radialGradient>' +
      '<filter id="heat" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      '<rect width="1600" height="1000" fill="url(#glow)"/>' +
      '<ellipse class="haze" cx="800" cy="900" rx="1000" ry="460" fill="url(#hz)"/>' +
      coals +
      `<g filter="url(#heat)" transform="translate(0 200) scale(1.3334)">${cracks}</g>`,
  )
}

// ---------- Contour: drifting map lines; bands light up and fade ----------

function contour(): string {
  const rnd = seeded(29)
  let masks = ''
  let glows = ''
  GLOWS.forEach((g, n) => {
    masks += `<mask id="m${n}" maskUnits="userSpaceOnUse" x="${g.cx - g.r}" y="${g.cy - g.r}" width="${g.r * 2}" height="${g.r * 2}"><circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="url(#fade)"/></mask>`
    const duration = 13 + rnd() * 5
    // Spread the starts evenly over one cycle, so a band lights about every second.
    const delay = (n / GLOWS.length) * duration + rnd()
    glows += `<g class="glow" mask="url(#m${n})" style="animation-duration:${f(duration)}s;animation-delay:-${f(delay)}s"><path d="${g.d}"/></g>`
  })

  const style =
    '.t0{stop-color:#18202b}.t1{stop-color:#0f1318}' +
    '.minor{fill:none;stroke:rgba(217,119,87,.2);stroke-width:1.1}' +
    '.major{fill:none;stroke:rgba(217,119,87,.42);stroke-width:1.5}' +
    '.glow{opacity:0;animation:glow linear infinite}' +
    '.glow path{fill:none;stroke:#ff9669;stroke-width:2.8;stroke-linecap:round}' +
    '.map{animation:drift 40s ease-in-out infinite alternate}' +
    `@keyframes drift{to{transform:translate(${1600 - MAP_W}px,${1000 - MAP_H}px)}}` +
    '@keyframes glow{0%{opacity:0}7%{opacity:1}17%{opacity:1}25%,100%{opacity:0}}' +
    '@media (prefers-color-scheme:light){' +
    '.t0{stop-color:#f1f3f4}.t1{stop-color:#e3e8ec}' +
    '.minor{stroke:rgba(176,92,54,.2)}.major{stroke:rgba(176,92,54,.5)}' +
    '.glow path{stroke:#c45c30}}'

  return svg(
    'xMidYMid slice',
    style,
    '<defs>' +
      '<radialGradient id="sky" cx=".85" cy=".1" r=".9"><stop offset="0" class="t0"/><stop offset=".75" class="t1"/></radialGradient>' +
      '<radialGradient id="fade"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<filter id="bloom" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      masks +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      `<g class="map"><path class="minor" d="${MINOR}"/><path class="major" d="${MAJOR}"/><g filter="url(#bloom)">${glows}</g></g>`,
  )
}

// ---------- Corona: an eclipse in the top corner, turning flares, stars ----------

// The eclipse's centre sits just off the top-right corner; the scene pins that
// corner (xMaxYMin) so a narrow or tall window crops the other sides instead.
const SUN_X = 1520
const SUN_Y = -16

function corona(): string {
  const rnd = seeded(23)
  let dust = ''
  for (let i = 0; i < 70; i++) {
    dust += `<circle cx="${f(rnd() * 1600)}" cy="${f(rnd() * 1000)}" r="${f(0.5 + rnd() * 0.8)}"/>`
  }
  let stars = ''
  for (let i = 0; i < 26; i++) {
    stars += `<circle class="star" cx="${f(rnd() * 1600)}" cy="${f(rnd() * 1000)}" r="${f(0.9 + rnd() * 0.9)}" style="animation-duration:${f(2.5 + rnd() * 4)}s;animation-delay:-${f(rnd() * 5)}s"/>`
  }
  const origin = `transform-origin:${SUN_X}px ${SUN_Y}px`

  const style =
    '.bg{fill:#0b0a0a}.disc{fill:#0b0a0a}' +
    '.k0{stop-color:rgba(255,170,110,.95)}.k1{stop-color:rgba(232,132,95,.55)}.k2{stop-color:rgba(217,119,87,.18)}.k3{stop-color:rgba(217,119,87,0)}' +
    '.o0{stop-color:rgba(217,119,87,0)}.o1{stop-color:rgba(217,119,87,.1)}' +
    '.ring{fill:none;stroke:rgba(255,186,140,.9);stroke-width:3}' +
    '.flare{fill:none;stroke:rgba(255,165,115,.75)}' +
    '.dust{fill:rgba(255,236,222,.35)}.star{fill:#fff3ea;opacity:.2;animation:twinkle ease-in-out infinite}' +
    `.sun{${origin};animation:breathe 5s ease-in-out infinite}` +
    `.spin{${origin};animation:spin 26s linear infinite}` +
    `.spin2{${origin};animation:spin 40s linear infinite reverse;opacity:.7}` +
    '.shoot{opacity:0;animation:shoot 7s ease-in 1s infinite}' +
    '@keyframes breathe{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.06);opacity:1}}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '@keyframes twinkle{0%,100%{opacity:.12}50%{opacity:.95}}' +
    '@keyframes shoot{0%{opacity:0;transform:translateX(0)}2%{opacity:1}9%,100%{opacity:0;transform:translateX(760px)}}' +
    '@media (prefers-color-scheme:light){' +
    '.bg{fill:url(#day)}.disc{fill:#fbf8f5}' +
    '.k0{stop-color:rgba(226,120,80,.85)}.k1{stop-color:rgba(232,140,100,.35)}.k2{stop-color:rgba(232,150,110,.12)}.k3{stop-color:rgba(232,150,110,0)}' +
    '.o1{stop-color:rgba(217,119,87,.08)}' +
    '.ring{stroke:rgba(214,108,66,.85)}.flare{stroke:rgba(226,120,80,.6)}' +
    '.dust,.star,.shooter{display:none}}'

  return svg(
    'xMaxYMin slice',
    style,
    '<defs>' +
      '<radialGradient id="day" cx=".9" cy="0" r="1"><stop offset="0" stop-color="#f7f3ef"/><stop offset=".7" stop-color="#ebe8e5"/></radialGradient>' +
      '<radialGradient id="corona"><stop offset=".66" class="k0"/><stop offset=".71" class="k1"/><stop offset=".8" class="k2"/><stop offset="1" class="k3"/></radialGradient>' +
      '<radialGradient id="halo"><stop offset=".6" class="o0"/><stop offset=".72" class="o1"/><stop offset="1" class="o0"/></radialGradient>' +
      '<linearGradient id="trail"><stop offset="0" stop-color="#ffd9c2" stop-opacity="0"/><stop offset="1" stop-color="#ffd9c2"/></linearGradient>' +
      '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>' +
      '<filter id="edge"><feGaussianBlur stdDeviation="1"/></filter>' +
      '</defs>' +
      '<rect class="bg" width="1600" height="1000"/>' +
      `<g class="dust">${dust}</g>${stars}` +
      '<g class="shooter" transform="translate(110 150) rotate(20)"><line class="shoot" x1="0" y1="0" x2="240" y2="0" stroke="url(#trail)" stroke-width="2.4" stroke-linecap="round"/></g>' +
      `<circle cx="${SUN_X}" cy="${SUN_Y}" r="560" fill="url(#halo)"/>` +
      `<g class="sun"><circle cx="${SUN_X}" cy="${SUN_Y}" r="262" fill="url(#corona)"/>` +
      `<circle class="disc" cx="${SUN_X}" cy="${SUN_Y}" r="174"/>` +
      `<circle class="ring" cx="${SUN_X}" cy="${SUN_Y}" r="175" filter="url(#edge)"/></g>` +
      `<g filter="url(#soft)"><circle class="flare spin" cx="${SUN_X}" cy="${SUN_Y}" r="192" stroke-width="34" stroke-dasharray="70 200 40 250 95 180 50 230"/>` +
      `<circle class="flare spin2" cx="${SUN_X}" cy="${SUN_Y}" r="204" stroke-width="22" stroke-dasharray="40 260 80 220 30 300 60 240"/></g>`,
  )
}

// ---------- Dusk: orange and violet ribbons swaying over layered hills ----------

function dusk(): string {
  const style =
    '.k0{stop-color:#120e17}.k1{stop-color:#1a1322}.k2{stop-color:#2a1a2a}' +
    '.ra{stop-color:#d97757}.rb{stop-color:#9b6fd6}' +
    '.h1{fill:#1d1525}.h2{fill:#17111e}.h3{fill:#120d17}.rim{fill:none;stroke:rgba(217,119,87,.55);stroke-width:2}' +
    '.ribbons{opacity:.85;transform-origin:800px 400px;animation:sway 26s ease-in-out infinite alternate}' +
    '@keyframes sway{from{transform:translateX(-55px) skewX(-3deg)}to{transform:translateX(55px) skewX(3deg)}}' +
    '@media (prefers-color-scheme:light){' +
    '.k0{stop-color:#eee8f1}.k1{stop-color:#f1e6ea}.k2{stop-color:#f6ddd0}' +
    '.ra{stop-color:#e8916c}.rb{stop-color:#b79be0}' +
    '.h1{fill:#e6dbe9}.h2{fill:#ddd0e2}.h3{fill:#d4c5da}.rim{stroke:rgba(217,119,87,.45)}' +
    '.ribbons{opacity:.7}}'

  return svg(
    'xMidYMax slice',
    style,
    '<defs>' +
      '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="k0"/><stop offset=".55" class="k1"/><stop offset="1" class="k2"/></linearGradient>' +
      '<linearGradient id="r1" x1="0" x2="1"><stop offset="0" class="rb" stop-opacity="0"/><stop offset=".45" class="ra"/><stop offset="1" class="rb" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="r2" x1="0" x2="1"><stop offset="0" class="ra" stop-opacity="0"/><stop offset=".6" class="rb"/><stop offset="1" class="ra" stop-opacity="0"/></linearGradient>' +
      '<filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>' +
      '</defs>' +
      '<rect width="1600" height="1000" fill="url(#sky)"/>' +
      '<g class="ribbons" filter="url(#soft)">' +
      '<path d="M-70 333 C 267 200, 560 433, 867 283 S 1400 183, 1680 317" stroke="url(#r1)" stroke-width="110" fill="none"/>' +
      '<path d="M-70 483 C 347 383, 627 550, 1013 433 S 1440 383, 1680 467" stroke="url(#r2)" stroke-width="70" fill="none"/>' +
      '</g>' +
      '<path class="h1" d="M0 783 C 240 717, 453 758, 693 717 S 1173 667, 1600 733 V1000 H0Z"/>' +
      '<path class="rim" d="M0 783 C 240 717, 453 758, 693 717 S 1173 667, 1600 733"/>' +
      '<path class="h2" d="M0 858 C 293 817, 560 867, 853 825 S 1307 800, 1600 842 V1000 H0Z"/>' +
      '<path class="h3" d="M0 933 C 347 908, 640 942, 960 917 S 1360 900, 1600 925 V1000 H0Z"/>',
  )
}

export const SCENES: Record<StyleId, string> = {
  ember: ember(),
  contour: contour(),
  corona: corona(),
  dusk: dusk(),
}

export const SCENE_ALT: Record<StyleId, string> = {
  ember: 'Glowing coals and cracks of heat along the bottom of a warm charcoal background',
  contour: 'Orange topographic map lines drifting slowly over a blue-slate background',
  corona: 'An eclipse with turning orange flares in the top corner of a near-black starry sky',
  dusk: 'Orange and violet light ribbons swaying above layered dusk hills',
}
