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
npm run preview:svg # regenerate docs/assets/preview.svg's statusline tspans from a real render
npm pack --dry-run # preview what publishes
# Don't publish by hand — see Releasing.

# Ad-hoc render — feed the stdin JSON Claude Code sends:
echo '{"model":{"display_name":"Opus 4.8"},"workspace":{"current_dir":"/tmp/x"},"session_id":"t","context_window":{"remaining_percentage":40}}' | node statusline.js

# Ad-hoc subagent-row render (subagentStatusLine mode — see below):
echo '{"tasks":[{"id":"t1","name":"reviewer","model":"claude-opus-5","effort":"max","tokenCount":45200,"contextWindowSize":200000,"startTime":'$(($(date +%s)-252))'}]}' | node statusline.js subagent
# startTime = 4m12s ago in epoch seconds (format note below).
```

Publishing + local-install detail: `docs/DEV.md`.

## Architecture

`statusline.js` is the entire product — standalone, zero-dependency Node (built-ins only). Installers copy it to `~/.claude/hooks/`. No non-builtin `require()`s, no module split, no assuming sibling files exist at runtime.

**Execution contract.** Claude Code pipes session JSON via stdin every render, reads stdout (one or two lines). Must **always** print, **never** hang/throw — every path falls back to cached/partial/`outputFallback()`, failures swallow silently.

Reads from stdin: `model.display_name`, `workspace.current_dir`, `session_id`, `effort.level`, `context_window.remaining_percentage`, `cost.total_cost_usd` (USD float), `rate_limits` (`five_hour`/`seven_day`, each `{ used_percentage, resets_at }` — `resets_at` is Unix epoch **seconds**). Env: `COLUMNS` (terminal width, set by Claude Code v2.1.153+), `CTXLINE_DISABLE`.

**Timing is load-bearing.** stdin raced against `overallTimeout` (500ms with `ANTHROPIC_API_KEY`, else 1300/1600ms by cache presence); first to fire prints and `exit(0)`. Usage API has its own timeout (1200ms warm / 1500ms cold) and fires only on the fallback path.

**Segment opt-out.** `CTXLINE_DISABLE` comma list parsed once into `DISABLED` (trimmed, lowercased). Recognized: `branch`, `effort`, `cost`, `task`, `usage` (H+W). `dir`/`model`/`context` always render; unknown names ignored. Disabling skips the work, not just the output — `usage` means no network/cache/credentials at all.

**Responsive layout (`layout()`).** Visible width (ANSI stripped) > `COLUMNS - WIDTH_MARGIN` → two lines: line 1 dir/branch + model/effort + `C`; line 2 `H`/`W` + `$` + task. Wraps only when `COLUMNS` is a known positive int and line 2 is non-empty — unknown width, wide terminals, nothing to wrap all stay single-line. `outputFallback()` stays single-line. `cols` is a parameter, never an env read, so `layout()`/`renderStatusLine()` have no side effects.

**Segment sources + gotchas** (each best-effort):

| segment | source | gotchas |
|---|---|---|
| dir + branch | basename of `current_dir`; branch read straight from `.git/HEAD`, no subprocess | `resolveGitDir()` walks up; handles worktree (`.git` file) + detached HEAD (short sha); tail-truncated to `MAX_BRANCH_LEN` 24 (keeps leading ticket ID); `''` on failure |
| `↑N↓M` | `getGitAheadBehind(dir)` — the only `git` subprocess: `execFileSync('git', ['rev-list','--left-right','--count','@{u}...HEAD'])` | no shell (faster cold spawn, `@{u}` passed literally); output `"<behind>\t<ahead>"`; `GIT_TIMEOUT_MS` 500ms; cache-fronted; `null` → omitted; omit a zero side; absent when in sync / no upstream / detached |
| model · effort | stdin | `(1M context)` → `(1M)`; effort ranks low<medium<high<xhigh<max<ultracode, only `max` (red) + `ultracode` (purple) highlighted, rest dim |
| `C` | stdin `remaining_percentage` | always available |
| `$` | stdin `cost.total_cost_usd`, no network/cache | `Number.isFinite`-guarded; client-side estimate at API pricing — for subscription users not actual billing |
| `H` / `W` | stdin `rate_limits` via `buildUsageFromStdin()`, else `getRawUsage()` → OAuth API | `rate_limits` exists only for Claude.ai Pro/Max **after the first API response** — absent at cold start and for API-key users, hence the fallback |
| scoped weekly | OAuth API only | never arrives via stdin; `getScopedColor` (orange, red ≥90), not the H/W thresholds |
| task | newest `~/.claude/todos/<sessionId>*-agent-*.json` | `activeForm` of the `in_progress` todo |

**Usage API.** `GET api.anthropic.com/api/oauth/usage`, bearer token + `anthropic-beta: oauth-2025-04-20`. Token from `getCredentials()`: `~/.claude/.credentials.json`, then macOS keychain. API-key users get no usage.
- Both adapters return `{ fiveHour, weekly, models }` and feed `buildUsageBars(raw)` — one positional object. `buildUsageFromStdin()`'s `models` is always `[]` (stdin never carries scoped limits).
- `parseUsagePayload(body)` — pure, no fs/network; `null` on unparseable JSON or a missing/non-finite `five_hour` utilization. `getApiUsage()` calls it and owns only credentials/socket/timeout/cache-write.
- `getRawUsage()` is cache-first, and checks the `lastAttempt` cooldown (`getLastAttemptAge()`, `FRESH_TTL_MS`) before calling `getApiUsage()` at all → a failed/timed-out refresh backs off the same as a successful one.
- `parseScopedLimits(usage)` reads `limits[]` for `kind: 'weekly_scoped'`; label = first initial of `scope.model.display_name` (new model family needs no code change). Legacy flat `seven_day_opus`/`seven_day_sonnet` only when `limits` yields nothing → neither shape double-counts.
- Scoped limits never arrive via stdin → `resolveUsage()` calls `getRawUsage()` for those bars even when `H`/`W` came from stdin. Capped at one call per `FRESH_TTL_MS`; slow/failed call costs only the scoped bars.

**Render seam.** `collectFacts(data)` gathers everything touching fs/child_process/env (git branch + ahead/behind, in-progress task, `COLUMNS`); pure `renderStatusLine(data, facts, usage)` formats; `outputStatus` is a ~3-line writer, try/catch → `Status unavailable`. `outputFallback` calls the same renderer with a static git/task-free `facts` (`cols: undefined` → single line, matching the fallback contract). Entry guarded by `require.main === module` so `test/render.test.js` can `require()` and call exports directly instead of spawning: `renderStatusLine`, `renderSubagentTask`, `parseScopedLimits`, `parseUsagePayload`, `normalizePercentage`, `readStdinThen`, `serializeUsageCache`.

**Caches** (both in `~/.claude/cache/`):
- `usage-cache.json` — `{ timestamp, data: { fiveHour, weekly, models }, lastAttempt }`, not formatted strings → old string-format caches ignored on read. Shared across sessions; `models` optional (pre-scoped-bars caches still validate). Fresh `FRESH_TTL_MS` 30s → render cache, skip API; stale → refresh, on API failure fall back to cache up to `STALE_TTL_MS` 10m. `lastAttempt` — stamped by `recordUsageAttempt()` before the request fires, success or failure — is the retry cooldown, independent of `timestamp`. Bars re-rendered every time via `buildUsageBar()` so countdowns recompute from `resetsAt`. Fronts the API path only — stdin `rate_limits` never reads or writes it.
- `git-cache.json` — single entry `{ gitDir, timestamp, ahead, behind }`; different repo invalidates. Fresh `GIT_FRESH_TTL_MS` 5s (render burst spawns `git` once) → stale re-run → on slow/failed call fall back to last counts up to `GIT_STALE_TTL_MS` 60s so they don't flicker.

**Two color schemes (intentional, do not unify):** context bar (`getContextBar`) steps 50/65/80 (≥80 → blink red); usage (`getUsageColor`) steps 50/75/90. Model-scoped bars opt out of both — `getScopedColor` (orange, red ≥90) passed as `buildUsageBar`'s optional 4th arg → several scoped bars read as one group while a nearly-spent one still stands out.

**Deliberately duplicated, do not merge:** the two caches, and the two duration formatters (`buildUsageBar`'s countdown vs `formatElapsed`). Two callers each, differing validators / units / refresh policies (git 5s/60s vs usage 30s/10m; countdown vs elapsed) — a shared `withCache`/`formatDuration` moves complexity into parameters. Revisit only on a third caller.

**Not actioned, deliberately:** the `lastAttempt` cooldown check (`getLastAttemptAge()`) and claim (`recordUsageAttempt()`) aren't atomic across processes — concurrent hook invocations can both call `getApiUsage()`. Worst case is one extra API call, never a crash or bad render; a filesystem lock plus a multi-process test contradicts the single-file, zero-dependency constraint. Revisit only if concurrent hook processes prove common.

## Subagent mode (`subagentStatusLine`)

Second entry point in the same file, activated by `process.argv[2] === 'subagent'` — wired in `settings.json` as a separate command from `statusLine`:

```json
{ "subagentStatusLine": { "type": "command", "command": "node ~/.claude/hooks/statusline.js subagent" } }
```

One row per running subagent task in the agent panel.

- Stdin: `{ tasks: [...], ... }` (base fields `session_id`/`cwd`/`columns` present but unused). Each task: `id`, `name`/`description`/`label`, `type`, `status`, `startTime`, `model` (resolved ID, absent until resolved), `effort` (level string or numeric token budget, absent when the subagent inherits session effort), `contextWindowSize`, `tokenCount`, `tokenSamples`, `cwd`.
- Stdout: one `{"id","content"}` JSON line per task to override. Omitted id → default rendering; empty `content` → row hidden.

Row: `name │ Model · effort │ C<used> <bar> │ ⏱ <elapsed>`, built by `renderSubagentTask()`. Reuses main-line blocks rather than duplicating: `SEGMENT_SEP`, `renderContextBar()` (used%→bar/color, factored out of `getContextBar`, shared by both), `getEffortColor()`. `shortenModelId()` shortens the resolved model *ID* ("claude-opus-5" → "Opus 5"; strips `us.`/`anthropic.` prefixes and a trailing `-YYYYMMDD` date) — distinct from `shortenModel()`, which only trims `" context)"` off a display *name*.

Every segment past `name` is independently conditional: no `model` → no model/effort segment (effort alone still renders); no `effort` → no `· effort` suffix; `tokenCount`/`contextWindowSize` not both finite (or window ≤ 0) → no context bar; unparseable `startTime` → no elapsed segment.

`startTime`'s format isn't documented upstream and isn't otherwise read in this file, so `formatElapsed()` accepts whatever shows up: number < `1e12` → epoch-seconds, larger → epoch-ms, anything else handed straight to `Date()` (covers an ISO string). Revisit if a real payload contradicts this.

Skips everything main mode does besides stdin parsing — no usage API, git, todos, cache — so no `overallTimeout` race against a fetch; `emitSubagent()` hard-caps the stdin read at `SUBAGENT_TIMEOUT_MS`. Bad/missing payload, or a task whose shape breaks rendering → emit nothing rather than a partial line: default rendering stays for every task in the panel, process still exits 0.

## Keep in sync when `statusline.js` changes

`statusline.js` is source of truth; five files mirror the visible line and must change in the same edit or CI/release/site drifts. Author edits `statusline.js`; assistant re-syncs. After any edit run `npm test` + `npm run preview`.

Shared harness, not one of the five — `test/fixture.js`, used by test + preview: fake-HOME construction, `usage-cache.json` seeding (via the exported `serializeUsageCache`, so the on-disk shape can't drift between writer and seed), diverged-repo building, spawn wrappers for both entry points. Dev-only, outside the `files` whitelist.

- `scripts/preview.js` — spawns the real `statusline.js` via the fixture against a seeded cache + stdin JSON. Cache-shape change → update the seed data passed to `seedUsageCache` **and** `render()` params/labels, or usage renders wrong/disappears. New stdin field read → add to the input object. The release body shows `head -n 1` of its output → keep the primary-line `console.log` **first**.
- `test/render.test.js` — same fixture, same breakage; assertions pin visible labels/percentages/colors/order. `colors` codes change → update the constants atop the file.
- `docs/assets/preview.svg` — the statusline `<text>` elements' `<tspan>` runs; shown in README + site. Generated, not hand-edited: `npm run preview:svg` (`scripts/preview-svg.js`) renders the real ANSI output for the same fixed scenario and rewrites just those tspans (ANSI SGR → hex, via its own `ANSI_HEX` table); window chrome, prompt lines, and the "○ " running-task bullet stay hand-authored. Run it after any change that would shift this scenario's output (colors, thresholds, format).
- `docs/index.html` — hero mock (`.term .line`) and the subagent-panel rows are byte-compared against a real `renderStatusLine()`/`renderSubagentTask()` call by `test/docs-drift.test.js`, so site drift fails `npm test`. Inspector `SIGNALS[]` and `.term` color classes are still unchecked — hand-verify those.
- `CLAUDE.md` — format diagram (top), segment-source table, visible contract below.

Full edit-point map: `.claude/skills/restyle-statusline/SKILL.md`.

Visible contract = format diagram (top) + color steps above, plus: only `C` gets a bar glyph (`buildUsageBar` builds text-only `H`/`W`/scoped segments despite the name); `$<cost>` dim, after usage and before task; `↑N↓M` ↑ green / ↓ red; responsive wrap (narrow → line 2 = `H`/`W`/`$`/task); always-print-and-exit-0 fallback.

Rule of thumb: change to **what the line looks like** → test assertions. Change to **cache shape or stdin fields** → both seeds. `npm run preview` is the fast visual check. (README has no sample line — leave it.)

Test harness: `run()` opts `columns` (unset → single line) and `disable` (→ `CTXLINE_DISABLE`); preview's `render()` takes matching params (narrow scenario 40, opt-out scenario `usage,cost`) plus `models` (`[{ label, percentage, resetsInMin }]`) for the scoped-limit scenario. Both clear `COLUMNS`/`CTXLINE_DISABLE` when unset so a dev-env value can't skew output. Git ahead/behind tests need real `git` (skipped if absent) and a fresh HOME per test (isolated `git-cache.json`).

## Do not touch the installers

Work in `statusline.js` only. Install path is frozen (inherited working from upstream):
- Don't change behavior of `bin/install.js`, `install.sh`, `install.ps1` except unavoidable branding (repo URL / package name) or wiring a settings.json entry a shipped `statusline.js` feature already depends on (e.g. `subagentStatusLine`).
- `npx ctxline-claude` → `bin/install.js` installs silently, no prompts. Keep it so.
- All three write both `statusLine` and `subagentStatusLine`, same hook file (`subagentStatusLine` appends a space + `subagent`). Path written quoted — command runs through a shell, so an unquoted home dir with spaces splits into two args. New entry point → wire into all three, not just document the snippet.
- Uninstall: `npx ctxline-claude uninstall` (arg `uninstall`/`remove`) — removes only our `statusLine`/`subagentStatusLine` (guarded, backed up), deletes the hook, clears the cache. Additive; must not alter the no-arg install. `install.sh`/`install.ps1` have no uninstall command — only printed manual-removal instructions, which must list both keys too.
- Don't reintroduce a "Full vs Lite" prompt or `statusline-lite.js` (deleted upstream `846e10e`). Only as a deliberate real feature.

## Distribution + releasing

`statusline.js` is fetched verbatim from GitHub `main` by `install.sh`/`install.ps1` (via `REPO_URL`) and copied by `bin/install.js`. A change on `main` ships to anyone re-running the installers — keep `main` releasable. `package.json` `files` whitelists what publishes.

Releases are owner-triggered, manual: bump `version` in `package.json` on `main`, then run the **Release** workflow (`.github/workflows/release.yml`), which publishes from that version. Never `npm publish` by hand; never bump the version unasked.
