# CLAUDE.md

## What this is

npm package `ctxline-claude` — single-file statusline for Claude Code:

```text
dir ⎇ branch ↑N↓M │ model · effort │ C<used> <bar> │ H<pct> ↺ <reset> │ W<pct> ↺ <reset> │ <model-initial><pct> ↺ <reset> │ $<cost> │ task
⬆ <latest> available · npx ctxline-claude@latest     (or, 5s after a self-install: ⬆ ctxline updated <old> → <new>)
```

`C` context (only segment with a bar), `H` 5-hour usage, `W` 7-day usage, `<model-initial>` model-scoped weekly limit, `$` session cost. Everything after `dir`/`model`/`C` is conditional — renders only when its source resolves. The `⬆` row is not a segment — appended below the layout only when a newer release is cached (nudge) or a self-install just landed (updated, `UPDATED_NOTICE_MS` 5s from first render).

Auto-update (default on; `CTXLINE_DISABLE=autoupdate` off): the detached `update-check` child, on finding a newer npm release, downloads `statusline.js` from GitHub raw at tag `v<latest>`, requires its `VERSION` to equal `<latest>`, and swaps it in via temp file + rename. Only when the running file is `~/.claude/hooks/statusline.js` — a working-tree copy (local testing) is never overwritten. Every release needs its `v<version>` tag pushed, or installs fail and fall back to the nudge.

Repo also ships `ctxline-desktop`, a Claude Code plugin (mod) for the desktop app's Code tab, which doesn't run statusline scripts. And `ctxline-desktop-themes`, a theme mod for the desktop app. See [Desktop plugins](#desktop-plugins).

## Commands

No build, no lint. Edit `statusline.js` directly.

```bash
npm test            # render tests (Node built-in runner, zero deps)
npm run preview     # sample lines for every color band + fallback
npm run preview:svg # regenerate docs/assets/preview.svg's statusline tspans from a real render
npm pack --dry-run  # preview what publishes

# Main line — the stdin JSON Claude Code sends:
echo '{"model":{"display_name":"Opus 5.5"},"workspace":{"current_dir":"/tmp/x"},"session_id":"t","context_window":{"remaining_percentage":40}}' | node statusline.js

# Update check (detached child; writes ~/.claude/cache/update-cache.json, prints nothing):
node statusline.js update-check

# Subagent rows:
echo '{"tasks":[{"id":"t1","name":"reviewer","model":"claude-opus-5","effort":"max","tokenCount":45200,"contextWindowSize":200000,"startTime":'$(($(date +%s)-252))'}]}' | node statusline.js subagent
```

Live-test the working tree without installing: `.claude/skills/local-statusline-test/SKILL.md`.

## Architecture

`statusline.js` is the entire product — standalone, zero-dependency Node (built-ins only). Installers copy it alone to `~/.claude/hooks/`: no non-builtin `require()`s, no module split, no sibling files at runtime.

**Execution contract.** Claude Code pipes session JSON via stdin every render, reads stdout (one or two lines). Always print, never hang/throw — every path falls back to cached/partial/`outputFallback()`; failures swallow silently. Timing is load-bearing: stdin raced against `overallTimeout` (500ms with `ANTHROPIC_API_KEY`, else 1300/1600ms by cache presence); first to fire prints and `exit(0)`.

**stdin:** `model.display_name`, `workspace.current_dir`, `session_id`, `effort.level`, `context_window.remaining_percentage`, `cost.total_cost_usd`, `rate_limits.five_hour/seven_day` (`{ used_percentage, resets_at }` — `resets_at` is Unix epoch **seconds**). Env: `COLUMNS` (set by Claude Code v2.1.153+), `CTXLINE_DISABLE` (opt-out: `branch`, `effort`, `cost`, `task`, `update`, `autoupdate`, `usage`; `dir`/`model`/`context` always render; disabling skips the work, not just the output).

**Invariants:**
- Usage is cache-first: stdin `rate_limits` or `~/.claude/cache/`, refreshed from the OAuth `/usage` API on the render path only when the cache is past `FRESH_TTL_MS` and no `lastAttempt` cooldown applies (own timeout, 1200ms warm / 1500ms cold). The update check is the one thing that never runs on the render path — detached child, `lastAttempt` stamped before the spawn (failed check or install backs off 1h, successes 3d).
- Model-scoped weekly bars exist only in the OAuth `/usage` payload — never in stdin.
- `collectFacts()` owns fs/child_process/env access; `renderStatusLine()` is pure. Exported under `require.main === module` for direct test use: `renderStatusLine`, `renderSubagentTask`, `parseScopedLimits`, `parseUsagePayload`, `normalizePercentage`, `readStdinThen`, `serializeUsageCache`, `compareVersions`, `parseRegistryVersion`, `isReleaseBody`, `VERSION` (not `collectFacts` — it's the impure half).
- Caches (`~/.claude/cache/`): `usage-cache.json` fresh 30s, otherwise dim `00` placeholders (no old values; model labels kept from the cache), `lastAttempt` cooldown applies to failed attempts too; `git-cache.json` 5s/60s; `update-cache.json` on the render path: read, plus `lastAttempt` before the spawn and `updatedShownAt` on the updated row's first render.

Segment sources, color thresholds, layout/wrap rules, full edit-point map: `.claude/skills/restyle-statusline/SKILL.md`.

## Subagent mode

`node statusline.js subagent` — one `{"id","content"}` JSON row per running task in the agent panel. Reads only stdin (capped at `SUBAGENT_TIMEOUT_MS`); bad payload → emit nothing, exit 0. Row `name │ Model · effort │ C<used> <bar> │ ⏱ <elapsed>`; every segment past `name` is independently conditional.

## Desktop plugins

Repo root is plugin marketplace `ctxline` (`.claude-plugin/marketplace.json`). Install: `/plugin marketplace add MithunWijayasiri/ctxline-claude` → `/plugin install <plugin>@ctxline`. Both plugins: own `version` (not npm `VERSION`), not in npm `files`, not touched by installers. Marketplace `name` = "from <name>" label + `@` suffix, no spaces. Validate marketplace: `claude plugin validate .`.

- `desktop/` — `ctxline-desktop`, status rows for the Code tab → `.claude/rules/desktop-plugin.md`.
- `desktop-themes/` — `ctxline-desktop-themes`, colors + backdrops → `.claude/rules/desktop-themes.md`.

Rules load when a file in their area is read. Working on a plugin → read its rule first; change makes it wrong → update it in the same change.

## Keep in sync when `statusline.js` changes

`statusline.js` is source of truth; these files mirror it — change in the same edit or CI/release/site drifts. After any edit run `npm test` + `npm run preview`.

| file | mirrors | trap |
|---|---|---|
| `scripts/preview.js` | cache seed, `render()` params, stdin input | — |
| `test/render.test.js` | visible labels / percentages / colors / order | ANSI `colors` constants atop the file |
| `docs/assets/preview.svg` | statusline `<tspan>` runs (README + site) | generated — run `npm run preview:svg`, never hand-edit |
| `docs/index.html` | hero mock + subagent rows | byte-compared by `test/docs-drift.test.js` → drift fails `npm test` |
| `CLAUDE.md` | format diagram + legend (top), timing/TTL numbers, stdin fields, export list | the Invariants block hard-codes constants — grep it for any number you change |
| `package.json` | `version` ↔ the `VERSION` constant | test-enforced; a stale `VERSION` nudges forever (or never) |
| `desktop/hooks/register.tsx` | usage/context/scoped color thresholds, `parseScopedLimits` | hand-copied, no test — `usageColor`/`contextColor`/`modelColor`/`scopedLimits` drift silently |

Triggers: visible output change → test assertions + `npm run preview:svg`; cache shape or stdin fields → both seeds; timing/TTL constants or `module.exports` → the Invariants block above; version bump → `VERSION` in `statusline.js` too.

`test/fixture.js` backs test + preview (fake HOME, cache seeds, spawn wrappers). Harness options: `SKILL.md`.

## Non-goals — do not re-propose

- Merging the two caches, or the two duration formatters (usage countdown vs subagent elapsed): two callers each, differing validators/units/TTLs. Revisit on a third caller.
- Atomic `lastAttempt` cooldown: check+claim aren't cross-process atomic; worst case is a few extra API calls, never a bad render. A file lock + multi-process test contradicts single-file/zero-dep.

## Do not touch the installers

Install path frozen: hook location, settings.json keys, backup behavior. Allowed: branding and console output in all three; `bin/install.js` install feedback (version detection, update/changelog line, downgrade guard, failure messages); wiring a settings.json entry a shipped feature already depends on. `npx ctxline-claude` installs silently. All three write both `statusLine` and `subagentStatusLine` to the same hook file (path written quoted). New entry point → wire into all three.

Uninstall: `npx ctxline-claude uninstall` removes only our two keys (guarded, backed up), deletes the hook, clears the cache. `install.sh`/`install.ps1` have no uninstall command — their printed manual-removal instructions must list both keys. No Full/Lite prompt or second statusline file.

## Distribution

`statusline.js` is fetched verbatim from GitHub `main` by `install.sh`/`install.ps1` and copied by `bin/install.js` — a change on `main` ships to anyone re-running the installers; keep `main` releasable. `package.json` `files` whitelists what publishes.

Version bump: `version` in `package.json` **and the `VERSION` constant in `statusline.js`**, on `main` (a test asserts they match).
