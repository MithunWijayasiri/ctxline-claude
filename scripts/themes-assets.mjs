#!/usr/bin/env node
// Exports the ctxline themes backdrops to docs/assets/themes/<style>.svg for the
// site's Themes section: the same SVGs the plugin draws, dark version only (the
// site shows the dark looks), still animated, still under reduced motion.
//
//   node --experimental-strip-types scripts/themes-assets.mjs
//
// Re-run after changing desktop-themes/hooks/scenes.ts or contour-paths.ts.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hooks = join(root, 'desktop-themes', 'hooks')
const outDir = join(root, 'docs', 'assets', 'themes')

// Node's type stripping needs file extensions on relative imports, which the
// plugin's own sources leave off; copy the two files and add them.
const tmp = mkdtempSync(join(tmpdir(), 'ctxline-themes-'))
try {
  const scenes = readFileSync(join(hooks, 'scenes.ts'), 'utf8')
    .replace("from './contour-paths'", "from './contour-paths.ts'")
  writeFileSync(join(tmp, 'scenes.ts'), scenes)
  writeFileSync(join(tmp, 'contour-paths.ts'), readFileSync(join(hooks, 'contour-paths.ts'), 'utf8'))

  const { SCENES } = await import(pathToFileURL(join(tmp, 'scenes.ts')).href)
  mkdirSync(outDir, { recursive: true })
  for (const [id, svg] of Object.entries(SCENES)) {
    const dark = dropBlock(svg, '@media (prefers-color-scheme:light){')
    writeFileSync(join(outDir, `${id}.svg`), dark + '\n')
    console.log(`wrote docs/assets/themes/${id}.svg: ${dark.length} chars`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// Removes the CSS block that opens with `head`, matching its braces.
function dropBlock(text, head) {
  const start = text.indexOf(head)
  if (start === -1) return text
  let depth = 0
  for (let i = start + head.length - 1; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(0, start) + text.slice(i + 1)
  }
  throw new Error(`unbalanced block: ${head}`)
}
