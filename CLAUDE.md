# CLAUDE.md

## What this is

npm package `ctxline-claude` — single-file statusline for Claude Code:

```text
dir ⎇ branch ↑N↓M │ model · effort │ C<used> <bar> │ H<pct> ↺ <reset> │ W<pct> ↺ <reset> │ <model-initial><pct> ↺ <reset> │ $<cost> │ task
```

`C` context (only segment with a bar), `H` 5-hour usage, `W` 7-day usage, `<model-initial>` model-scoped weekly limit (Fable → `F`), `$` session cost. Everything after `dir`/`model`/`C` is conditional — renders only when its source resolves.

## Commands

No build, no lint. Edit `statusline.js` directly.

```bash
npm test           # render tests (Node built-in runner, zero deps)
npm run preview    # sample lines for every color band + fallback
npm pack --dry-run # preview what publishes
# Don't publish by hand — see Releasing.

# Ad-hoc render — feed the stdin JSON Claude Code sends:
echo '{"model":{"display_name":"Opus 4.8"},"workspace":{"current_dir":"/tmp/x"},"session_id":"t","context_window":{"remaining_percentage":40}}' | node statusline.js

# Ad-hoc subagent-row render (subagentStatusLine mode — see below):
echo '{"tasks":[{"id":"t1","name":"reviewer","model":"claude-opus-5","effort":"max","tokenCount":45200,"contextWindowSize":200000,"startTime":'$(($(date +%s)-252))'}]}' | node statusline.js subagent
# startTime above is "4m12s ago" in epoch seconds — see the startTime format note below.
```

Publishing + local-install detail: `docs/DEV.md`.

## Architecture

`statusline.js` is the entire product — standalone, zero-dependency Node (built-ins only). Installers copy it to `~/.claude/hooks/`. No non-builtin `require()`s, no module split, no assuming sibling files exist at runtime.

**Execution contract.** Claude Code pipes session JSON via stdin every render, reads stdout (one or two lines). Must **always** print, **never** hang/throw — every path falls back to cached/partial/`outputFallback()`, failures swallow silently.

Reads from stdin: `model.display_name`, `workspace.current_dir`, `session_id`, `effort.level`, `context_window.remaining_percentage`, `cost.total_cost_usd` (USD float), `rate_limits` (`five_hour`/`seven_day`, each `{ used_percentage, resets_at }` — `resets_at` is Unix epoch **seconds**). Env: `COLUMNS` (terminal width, set by Claude Code v2.1.153+), `CTXLINE_DISABLE`.

**Timing is load-bearing.** stdin raced against `overallTimeout` (500ms with `ANTHROPIC_API_KEY`, else 1300/1600ms by cache presence); first to fire prints and `exit(0)`. Usage API has its own timeout (1200ms warm / 1500ms cold) and fires only on the fallback path.

**Segment opt-out.** `CTXLINE_DISABLE` comma list parsed once into the `DISABLED` set (trimmed, lowercased). Recognized: `branch`, `effort`, `cost`, `task`, `usage` (H+W). `dir`/`model`/`context` always render; unknown names ignored. Disabling skips the work, not just the output — `usage` means no network/cache/credentials at all.

**Responsive layout (`layout()`).** Visible width (ANSI stripped) > `COLUMNS - WIDTH_MARGIN` → two lines: line 1 dir/branch + model/effort + `C`; line 2 `H`/`W` + `$` + task. Wraps only when `COLUMNS` is a known positive int and line 2 is non-empty — unknown width, wide terminals, nothing to wrap all stay single-line. `outputFallback()` stays single-line.

**Segment sources + gotchas** (each best-effort):

| segment | source | gotchas |
|---|---|---|
| dir + branch | basename of `current_dir`; branch read straight from `.git/HEAD`, no subprocess | `resolveGitDir()` walks up; handles worktree (`.git` file) + detached HEAD (short sha); tail-truncated to `MAX_BRANCH_LEN` 24 (keeps leading ticket ID); `''` on failure |
| `↑N↓M` | `getGitAheadBehind(dir)` — the only `git` subprocess: `execFileSync('git', ['rev-list','--left-right','--count','@{u}...HEAD'])` | no shell (faster cold spawn, `@{u}` passed literally); output `"<behind>\t<ahead>"`; `GIT_TIMEOUT_MS` 500ms; cache-fronted; `null` → omitted; omit a zero side; absent when in sync / no upstream / detached |
| model · effort | stdin | `(1M context)` → `(1M)`; effort ranks low<medium<high<xhigh<max<ultracode, only `max` (red) + `ultracode` (purple) highlighted, rest dim |
| `C` | stdin `remaining_percentage` | always available |
| `$` | stdin `cost.total_cost_usd`, no network/cache | `Number.isFinite`-guarded; client-side estimate at API pricing — for subscription users not actual billing |
| `H` / `W` | stdin `rate_limits` via `buildUsageFromStdin()`, else `getUsageWithCache()` → OAuth API | `rate_limits` exists only for Claude.ai Pro/Max **after the first API response** — absent at cold start and for API-key users, hence the fallback |
| scoped weekly | OAuth API only | never arrives via stdin; `getScopedColor` (orange, red ≥90), not the H/W thresholds |
| task | newest `~/.claude/todos/<sessionId>*-agent-*.json` | `activeForm` of the `in_progress` todo |

**Usage API.** `GET api.anthropic.com/api/oauth/usage`, bearer token + `anthropic-beta: oauth-2025-04-20`. Token from `getCredentials()`: `~/.claude/.credentials.json`, then macOS keychain. API-key users get no usage. `getRawUsage()` resolves `{ fiveHour, weekly, models }` cache-first; `buildUsageBars()` renders all three (`models` a possibly-empty array). `parseScopedLimits(usage)` reads `limits[]` for `kind: 'weekly_scoped'`, label = first initial of `scope.model.display_name` (new model family needs no code change); falls back to legacy flat `seven_day_opus`/`seven_day_sonnet` only when `limits` yields nothing, so neither shape double-counts. Because scoped limits never arrive via stdin, `resolveUsage()` calls `getScopedModels()` even when `H`/`W` came from stdin — capped at one call per `FRESH_TTL_MS`, and a slow/failed call costs only the scoped bars.

Entry point guarded by `require.main === module` so `test/render.test.js` can `require('../statusline.js')` and unit-test `parseScopedLimits`/`normalizePercentage` — the `/usage` payload shape is the one part stdin can't reach.

**Caches** (both in `~/.claude/cache/`):
- `usage-cache.json` — raw `{ fiveHour, weekly, models }`, not formatted strings, so old string-format caches are ignored on read. Shared across sessions; `models` optional (pre-scoped-bars caches still validate). Fresh `FRESH_TTL_MS` 30s → render cache, skip API; stale → refresh, on API failure fall back to cache up to `STALE_TTL_MS` 10min. Bars re-rendered every time via `buildUsageBar()` so countdowns recompute from `resetsAt`. Fronts the API path only — stdin `rate_limits` never reads or writes it.
- `git-cache.json` — single entry `{ gitDir, timestamp, ahead, behind }`; different repo invalidates. Fresh `GIT_FRESH_TTL_MS` 5s (a render burst spawns `git` once) → stale re-run → on slow/failed call fall back to last counts up to `GIT_STALE_TTL_MS` 60s so they don't flicker.

**Two color schemes (intentional, do not unify):** context bar (`getContextBar`) steps 50/65/80 (≥80 → blink red); usage (`getUsageColor`) steps 50/75/90. Model-scoped bars opt out of both — `getScopedColor` (orange, red ≥90) passed as `buildUsageBar`'s optional 4th arg, so several scoped bars read as one group while a nearly-spent one still stands out.

## Subagent mode (`subagentStatusLine`)

A second entry point in the same file, activated by `process.argv[2] === 'subagent'` — wired in `settings.json` as a separate command from `statusLine`:

```json
{ "subagentStatusLine": { "type": "command", "command": "node ~/.claude/hooks/statusline.js subagent" } }
```

Renders one row per running subagent task in the agent panel. Stdin is `{ tasks: [...], ... }` (base fields like `session_id`/`cwd`/`columns` are present but unused); each task carries `id`, `name`/`description`/`label`, `type`, `status`, `startTime`, `model` (resolved ID, absent until resolved), `effort` (level string or numeric token budget, absent when the subagent inherits the session effort), `contextWindowSize`, `tokenCount`, `tokenSamples`, `cwd`. Stdout is one `{"id","content"}` JSON line per task to override — omitting a task's id keeps its default rendering, an empty `content` hides the row.

`startTime`'s format isn't documented upstream and isn't otherwise read in this file, so `formatElapsed()` accepts whatever shows up: a number < `1e12` is treated as epoch-seconds, a larger number as epoch-ms, anything else handed straight to `Date()` (covers an ISO string). Revisit if a real payload ever contradicts this.

Row: `name │ Model · effort │ C<used> <bar> │ ⏱ <elapsed>`, built by `renderSubagentTask()`. Reuses the main line's building blocks rather than duplicating them: `SEGMENT_SEP`, `renderContextBar()` (the used%→bar/color part factored out of `getContextBar`, shared by both), `getEffortColor()`. `shortenModelId()` shortens the resolved model *ID* ("claude-opus-5" → "Opus 5", strips `us.`/`anthropic.` prefixes and a trailing `-YYYYMMDD` date) — distinct from `shortenModel()`, which only trims `" context)"` off a display *name*. Every segment past `name` is independently conditional: no `model` → no model/effort segment (effort alone still renders if present); no `effort` → no `· effort` suffix; `tokenCount`/`contextWindowSize` not both finite (or window ≤ 0) → no context bar; `startTime` unparseable → no elapsed segment.

Skips everything main mode does besides stdin parsing — no usage API, no git, no todos, no cache — so there's no `overallTimeout` race against a fetch; `emitSubagent()` just hard-caps the stdin read at `SUBAGENT_TIMEOUT_MS`. A bad/missing payload, or a task whose shape breaks rendering, emits nothing rather than a partial line — default rendering stays for every task in the panel, and the process still exits 0.

## Keep in sync when `statusline.js` changes

`statusline.js` is source of truth; five files mirror the visible line and must change in the same edit or CI/release/site drifts. Author edits `statusline.js`; assistant re-syncs. After any edit run `npm test` + `npm run preview`.

Executable fixtures — stale = CI/release breaks:
- `scripts/preview.js` — spawns the real `statusline.js` against a seeded `usage-cache.json` + stdin JSON. Cache-shape change → update the seed **and** `render()` params/labels, or usage renders wrong/disappears. New stdin field read → add it to the input object.
- `test/render.test.js` — `seedHome()` writes the same cache file (same breakage); assertions pin visible labels/percentages/colors/order. `colors` codes change → update the constants atop the file.

Docs/marketing — stale = silent drift:
- `docs/assets/preview.svg` — the single statusline `<text>` element (`<tspan>` runs); shown in README + site.
- `docs/index.html` — hero mock (`.term .line`), inspector `SIGNALS[]`, `.term` color classes.
- `CLAUDE.md` — format diagram (top), segment-source table, visible contract below.

Full edit-point map: `.claude/skills/restyle-statusline/SKILL.md`.

Rule of thumb: change to **what the line looks like** → test assertions. Change to **cache shape or stdin fields** → both seeds. `npm run preview` is the fast visual check. (README has no sample line — leave it.)

Visible contract: field order + `│` separator; `C<used>` with bar; `H<pct>`/`W<pct>` with `↺ <reset>`, no bar; dim `$<cost>` after usage, before task; context thresholds green <50 / yellow <65 / orange <80 / blink-red ≥80; branch + dim `↑N↓M`; effort; responsive wrap (narrow → line 2 = `H`/`W`/`$`/task); always-print-and-exit-0 fallback.

Test harness: `run()` opts `columns` (unset → single line) and `disable` (→ `CTXLINE_DISABLE`); preview's `render()` takes matching params (narrow scenario 40, opt-out scenario `usage,cost`) plus `models` (`[{ label, percentage, resetsInMin }]`) for the scoped-limit scenario. Both clear `COLUMNS`/`CTXLINE_DISABLE` when unset so a dev-env value can't skew output. Git ahead/behind tests need real `git` (skipped if absent) and a fresh HOME per test (isolated `git-cache.json`).

## Do not touch the installers

Work in `statusline.js` only. Install path is frozen (inherited working from upstream):
- Don't change behavior of `bin/install.js`, `install.sh`, `install.ps1` except unavoidable branding (repo URL / package name).
- `npx ctxline-claude` → `bin/install.js` installs silently, no prompts. Keep it so.
- Uninstall path exists: `npx ctxline-claude uninstall` (arg `uninstall`/`remove`) — removes only our `statusLine` from `settings.json` (guarded, backed up), deletes the hook, clears the cache. Additive; must not alter the no-arg install.
- Don't reintroduce a "Full vs Lite" prompt or `statusline-lite.js` (deleted upstream `846e10e`). Only as a deliberate real feature.

## Distribution

`statusline.js` is fetched verbatim from GitHub `main` by `install.sh`/`install.ps1` (via `REPO_URL`) and copied by `bin/install.js`. A change on `main` ships to anyone re-running the installers — keep `main` releasable. `package.json` `files` whitelists what publishes.

## Releasing

Automated — **don't `npm publish` by hand.** `package.json` `version` is the single source of truth.

1. Bump `version` in `package.json` (commit on `main`).
2. GitHub → Actions → **Release** (`.github/workflows/release.yml`) → Run workflow.

Workflow reads version from `package.json`, runs tests, publishes (`NPM_TOKEN` secret), tags `v<version>`, creates the release with rendered preview + auto notes + source zip. npm rejects an existing version and the tag step refuses a duplicate, so step 1 is required.

**Release preview is always a single line.** `preview.js` prints several scenarios for the CI sync-check, but the release body shows only the primary line — the workflow takes `head -n 1` ("Render statusline preview" step). Keep the primary-line `console.log` as the **first** thing `preview.js` prints, and never drop `head -n 1`.
