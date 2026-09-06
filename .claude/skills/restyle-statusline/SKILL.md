---
name: restyle-statusline
description: Change the statusline's visible design — layout, segment format, labels, colors, bars, countdowns — or its cache shape / stdin fields. Use when the user wants to redesign, compact, expand, recolor, or relabel the rendered line, or when a `statusline.js` change has to be mirrored in the tests, preview, SVG, or site. Captures every edit point and the test-harness options so a sync pass needs no re-discovery.
---

# Restyle statusline

`statusline.js` is source of truth. **The visible line is mirrored in 5 other files — change them in the same pass or CI/release/site drift.** This skill lists every edit point so you skip re-reading the repo.

## Sync surface (edit together)

| File | What to change | Where |
|---|---|---|
| `statusline.js` | render logic — source of truth | `getContextBar`, `buildUsageBar`, `buildUsageBars`, `formatAheadBehind`, `getCostSegment`, `getLatestUpdate`, `renderUpdateLine`, `layout`, `collectFacts`, `renderStatusLine`, `outputStatus`, `outputFallback` |
| `test/render.test.js` | assertions on labels / `NN%` / colors / order | match new label regexes (e.g. `/C\d+ /`, `/H\d+\b/`); ANSI const block near top |
| `scripts/preview.js` | seed + render check | cache seed data (via `test/fixture.js`'s `seedUsageCache`), `render()` params (`columns`, `disable`); **primary `console.log` stays FIRST line** (release takes `head -n 1`) |
| `docs/assets/preview.svg` | marketing SVG (README/site) | 2 of its 12 `<text>` elements (main statusline + subagent row) are **generated**, not hand-edited — run `npm run preview:svg` after any output-shape change; the other 10 (window chrome, prompt lines, bullets) stay hand-authored |
| `docs/index.html` | landing page | hero mock (`.term .line`) and subagent rows are checked by `test/docs-drift.test.js` (fails `npm test` on drift) — update its synthetic scenario if you change what they depict; inspector `SIGNALS[]` array and `.term` color classes are NOT checked, hand-verify |
| `CLAUDE.md` | spec | format diagram (top), segment-source table, "visible contract" paragraph |

After edits: `npm test` + `npm run preview` + `npm run preview:svg`. All must pass + look right.

## Current format

```text
dir ⎇ branch ↑N↓M │ model · effort │ C45 ███░░░ │ H14 ↺ 4h20m │ W31 ↺ 2d13h │ F86 ↺ 2d13h │ $44.21 │ task
⬆ 1.7.0 available · npx ctxline-claude@latest
```

- Labels fused with percent: `C`=context, `H`=5h, `W`=7d, `<initial>`=model-scoped weekly limit (Fable → `F`, label derived from `scope.model.display_name` in `parseScopedLimits` — never hardcode a model list).
- Context keeps a bar; `H`/`W`/scoped are label + `↺ countdown`, no bar.
- Labels live INSIDE the builder functions (`getContextBar`/`buildUsageBar`), not as prefixes in `renderStatusLine`. `renderStatusLine` pushes segments verbatim; `outputStatus`/`outputFallback` are thin writers that call it.
- `↑N↓M` is appended to the branch string (↑ green / ↓ red), not a separate segment. Zero side omitted.
- `$<cost>` is dim, sits after usage and before task.
- The `⬆` row is **not a segment**. `renderUpdateLine(latest)` builds it and `renderStatusLine` appends it after `layout()`, so it never affects wrap math. Green `⬆ <version>`, dim `available ·`, bold command. Conditional and rare — only when `update-cache.json` holds a `latest` strictly newer than `VERSION`. Cache-only on the render path; the fetch runs in the detached `update-check` entry point.
- Consts: `BAR_WIDTH` 6 (bar cells), `SEGMENT_SEP` `' │ '`, `MAX_BRANCH_LEN` 24, `WIDTH_MARGIN` 0.

## Responsive wrap — reassign segments when order changes

`layout(line1Parts, line2Parts, cols)` in `renderStatusLine` splits the line when visible width > `cols - WIDTH_MARGIN` (`cols` comes from `collectFacts`' read of `COLUMNS`; `layout` itself has no env access):

- line 1 = dir/branch + model/effort + `C`
- line 2 = `H`/`W`/scoped + `$` + task
- the `⬆` row, when present, is appended below both — a 3rd row on a narrow terminal

Adding or moving a segment means picking its line in `renderStatusLine`, not just its position. Wrap fires only when `cols` is a known positive int **and** line 2 is non-empty. `outputFallback()` stays single-line — it calls `renderStatusLine` with a static `facts.cols: undefined`, which `layout` treats as unknown width.

`visibleWidth()` strips ANSI before measuring — a new escape sequence not covered by its regex breaks wrap math.

## Opt-out names are part of the visible contract

`CTXLINE_DISABLE` recognizes `branch`, `effort`, `cost`, `task`, `update`, `usage` (H+W). Renaming a segment → update the `DISABLED` checks, the test `disable` opt, preview's opt-out scenario (passes `usage,cost`), and the docs. `dir`/`model`/`context` are never disableable.

## Colors (two schemes — do NOT unify)

| | Thresholds |
|---|---|
| context (`getContextBar`) | green <50 / yellow <65 / orange <80 / **blink-red** ≥80 |
| usage `H`/`W` (`getUsageColor`) | green <50 / yellow <75 / orange <90 / red ≥90 |
| model-scoped bars (`getScopedColor`) | orange < 90 / red ≥90 — passed as `buildUsageBar`'s optional 4th arg |

Scoped bars are deliberately flat so a line carrying `H W O F` reads as two groups, not four severities; red ≥90 is the one exception, for a cap about to block its model. Restoring full threshold color means dropping that 4th arg — and updating the two scoped-color tests.

ANSI (`colors` obj, top of `statusline.js`): green `\x1b[32m` · yellow `\x1b[33m` · orange `\x1b[38;5;208m` · red `\x1b[31m` · purple `\x1b[38;5;135m` · dim `\x1b[2m` · blink `\x1b[5m` · reset `\x1b[0m`.

Effort: only top two highlighted — `max` red, `ultracode` purple; rest dim.

SVG/HTML palette (`docs/assets/preview.svg`, `docs/index.html`): green `#3fb950` (svg) / `#7ec77f` (`--green` html) · orange `#f0883e` · empty cell `#2d333b` · dim `#7d8590` · separator `#30363d` · dir/accent `#d97757`.

Ahead/behind: both the site (`.ahead` green / `.behind` `#f85149`) and `statusline.js` (`formatAheadBehind` green ↑ / red ↓) color `↑N↓M`; `docs/assets/preview.svg` uses `#3fb950`/`#f85149` matching the code.

## Gotchas

- Bar glyphs are `█`/`░` **escapes** in `statusline.js` code, but **literal** `█`/`░` in comments, SVG, HTML, and tests. Match the right form when editing (Edit tool is byte-exact).
- Scoped bars come only from the `/usage` API payload, never stdin — preview/tests exercise them through the seeded cache, so a scoped-bar restyle needs the cache seed updated too.
- Don't touch installers (`bin/install.js`, `install.sh`, `install.ps1`) — frozen. No Full/Lite prompt or second file (deleted upstream).
- README has no sample line — leave it.
- New ANSI color in `colors` (top of `statusline.js`) → add it to `scripts/preview-svg.js`'s `ANSI_HEX` table too, or `npm run preview:svg` silently falls back to the default text color for it.

## Test harness options

`test/fixture.js` backs both `test/render.test.js` and `scripts/preview.js`: fake-HOME construction, `usage-cache.json` seeding (through `statusline.js`'s exported `serializeUsageCache`, so the on-disk shape can't drift between writer and seed), diverged-repo building, spawn wrappers for both entry points. Dev-only, outside `package.json`'s `files` whitelist.

- `run()` opts: `columns` (unset → single line), `disable` (→ `CTXLINE_DISABLE`).
- `makeHome()` seeds a `latest`-less `update-cache.json` stamped now — keeps tests offline (no registry child spawns) and shows no nudge. `seedUpdateCache(home, { latest, checkedAt, lastAttempt })` overrides it; preview's `render()` takes `update: '<version>'` for the same thing.
- Preview's `render()` takes the matching params — narrow scenario passes 40, opt-out scenario passes `usage,cost` — plus `models` (`[{ label, percentage, resetsInMin }]`) for the scoped-limit scenario.
- Both clear `COLUMNS`/`CTXLINE_DISABLE` when unset, so a dev-env value can't skew output.
- Git ahead/behind tests need real `git` (skipped if absent) and a fresh HOME per test, to isolate `git-cache.json`.

## Render to verify (ANSI in terminal)

```bash
echo '{"model":{"display_name":"Opus 4.8 (1M context)"},"workspace":{"current_dir":"/tmp/my-project"},"session_id":"t","context_window":{"remaining_percentage":55},"effort":{"level":"high"},"cost":{"total_cost_usd":44.21},"rate_limits":{"five_hour":{"used_percentage":81,"resets_at":'$(($(date +%s)+8460))'},"seven_day":{"used_percentage":31,"resets_at":'$(($(date +%s)+223200))'}}}' | node statusline.js
```

Add `COLUMNS=40` in front to check the wrap, `CTXLINE_DISABLE=usage,cost` to check opt-out.
