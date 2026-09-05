# CLAUDE.md

## What this is

npm package `ctxline-claude` — single-file statusline for Claude Code:

```text
dir ⎇ branch ↑N↓M │ model · effort │ C<used> <bar> │ H<pct> ↺ <reset> │ W<pct> ↺ <reset> │ <model-initial><pct> ↺ <reset> │ $<cost> │ task
⬆ update <latest> · run: npx ctxline-claude@latest
```

`C` context (only segment with a bar), `H` 5-hour usage, `W` 7-day usage, `<model-initial>` model-scoped weekly limit (Fable → `F`), `$` session cost. Everything after `dir`/`model`/`C` is conditional — renders only when its source resolves. The `⬆` row is **not a segment** — it's appended below whatever the layout produced, only when a newer release is cached.

## Commands

No build, no lint. Edit `statusline.js` directly.

```bash
npm test           # render tests (Node built-in runner, zero deps)
npm run preview    # sample lines for every color band + fallback
npm run preview:svg # regenerate docs/assets/preview.svg's statusline tspans from a real render
npm pack --dry-run # preview what publishes
# Never publish by hand — see Distribution + releasing.

# Main line — the stdin JSON Claude Code sends:
echo '{"model":{"display_name":"Opus 4.8"},"workspace":{"current_dir":"/tmp/x"},"session_id":"t","context_window":{"remaining_percentage":40}}' | node statusline.js

# Update check (detached child; writes ~/.claude/cache/update-cache.json, prints nothing):
node statusline.js update-check

# Subagent rows (startTime = 4m12s ago, epoch seconds — format note below):
echo '{"tasks":[{"id":"t1","name":"reviewer","model":"claude-opus-5","effort":"max","tokenCount":45200,"contextWindowSize":200000,"startTime":'$(($(date +%s)-252))'}]}' | node statusline.js subagent
```

Publishing + local-install detail: `docs/DEV.md`.

## Architecture

`statusline.js` is the entire product — standalone, zero-dependency Node (built-ins only). Installers copy it to `~/.claude/hooks/`: no non-builtin `require()`s, no module split, no assuming sibling files exist at runtime.

**Execution contract.** Claude Code pipes session JSON via stdin every render, reads stdout (one or two lines). Must **always** print, **never** hang/throw — every path falls back to cached/partial/`outputFallback()`, failures swallow silently.

Reads from stdin: `model.display_name`, `workspace.current_dir`, `session_id`, `effort.level`, `context_window.remaining_percentage`, `cost.total_cost_usd` (USD float), `rate_limits` (`five_hour`/`seven_day`, each `{ used_percentage, resets_at }` — `resets_at` is Unix epoch **seconds**). Env: `COLUMNS` (terminal width, set by Claude Code v2.1.153+), `CTXLINE_DISABLE`.

**Timing is load-bearing.** stdin raced against `overallTimeout` (500ms with `ANTHROPIC_API_KEY`, else 1300/1600ms by cache presence); first to fire prints and `exit(0)`. Usage API has its own timeout (1200ms warm / 1500ms cold) and fires only on the fallback path.

**Segment opt-out.** `CTXLINE_DISABLE` comma list parsed once into `DISABLED` (trimmed, lowercased). Recognized: `branch`, `effort`, `cost`, `task`, `update`, `usage` (H+W). `dir`/`model`/`context` always render; unknown names ignored. Disabling skips the work, not just the output — `usage` means no network/cache/credentials at all.

**Responsive layout (`layout()`).** Visible width (ANSI stripped) > `COLUMNS - WIDTH_MARGIN` → two lines: line 1 dir/branch + model/effort + `C`; line 2 `H`/`W` + `$` + task. Fires only when `COLUMNS` is a known positive int and line 2 is non-empty — unknown width, wide terminal, or nothing to wrap stays single-line, as does `outputFallback()`. `cols` is a parameter, never an env read, so `layout()`/`renderStatusLine()` have no side effects.

**Segment sources + gotchas** (each best-effort):

| segment | source | gotchas |
|---|---|---|
| dir + branch | basename of `current_dir`; branch straight from `.git/HEAD`, no subprocess | `resolveGitDir()` walks up; handles worktree (`.git` file) + detached HEAD (short sha); tail-truncated to `MAX_BRANCH_LEN` 24 (keeps leading ticket ID); `''` on failure |
| `↑N↓M` | `getGitAheadBehind(dir)` — the only `git` subprocess (`execFileSync`, `rev-list --left-right --count @{u}...HEAD`) | no shell (faster cold spawn, `@{u}` passed literally); output is `"<behind>\t<ahead>"`; `GIT_TIMEOUT_MS` 500ms; cache-fronted; omitted on `null`, in sync, no upstream, detached; a zero side is dropped |
| model · effort | stdin | `(1M context)` → `(1M)`; effort ranks low<medium<high<xhigh<max<ultracode, only `max` (red) + `ultracode` (purple) highlighted, rest dim |
| `C` | stdin `remaining_percentage` | always available |
| `$` | stdin `cost.total_cost_usd`, no network/cache | `Number.isFinite`-guarded; client-side estimate at API pricing — for subscription users, not actual billing |
| `H` / `W` | stdin `rate_limits` via `buildUsageFromStdin()`, else `getRawUsage()` → OAuth API | `rate_limits` exists only for Claude.ai Pro/Max **after the first API response** — absent at cold start and for API-key users, hence the fallback |
| scoped weekly | OAuth API only | never arrives via stdin; `getScopedColor` (orange, red ≥90), not the H/W thresholds |
| `⬆` row | `update-cache.json` only — never the network on the render path | `getLatestUpdate()` compares the cached `latest` against `VERSION`; `''` unless strictly newer, and both sides must be strict `x.y.z` (a prerelease never nudges). `renderUpdateLine()` appends it *after* `layout()`, so it never competes for width and never joins the wrap decision |
| task | newest `~/.claude/todos/<sessionId>*-agent-*.json` | `activeForm` of the `in_progress` todo |

**Usage API.** `GET api.anthropic.com/api/oauth/usage`, bearer token + `anthropic-beta: oauth-2025-04-20`. Token from `getCredentials()`: `~/.claude/.credentials.json`, then macOS keychain. API-key users get no usage.
- Both adapters return `{ fiveHour, weekly, models }` → `buildUsageBars(raw)`, one positional object. `buildUsageFromStdin()`'s `models` is always `[]` (stdin never carries scoped limits).
- `parseUsagePayload(body)` — pure, no fs/network; `null` on unparseable JSON or a missing/non-finite `five_hour` utilization. `getApiUsage()` calls it and owns only credentials/socket/timeout/cache-write.
- `getRawUsage()` is cache-first, and checks the `lastAttempt` cooldown (`getLastAttemptAge()`, `FRESH_TTL_MS`) before calling `getApiUsage()` at all → a failed/timed-out refresh backs off the same as a successful one.
- `parseScopedLimits(usage)` reads `limits[]` for `kind: 'weekly_scoped'`; label = first initial of `scope.model.display_name` (new model family needs no code change). Legacy flat `seven_day_opus`/`seven_day_sonnet` only when `limits` yields nothing → neither shape double-counts.
- `resolveUsage()` still calls `getRawUsage()` for the scoped bars when `H`/`W` came from stdin. Capped at one call per `FRESH_TTL_MS`; a slow/failed call costs only those bars.

**Update check.** `GET registry.npmjs.org/ctxline-claude/latest` → `parseRegistryVersion(body)` (pure; `null` on anything but strict `x.y.z`). Anonymous — no credentials, no session data.
- Rendered as its **own stdout row** (Claude Code renders each line as a separate row), not a segment: the copy-pasteable `npx ctxline-claude@latest` is too wide to inline without forcing the main line to wrap on most terminals. `npx <pkg>@latest` is correct for `install.sh`/`install.ps1` users too — it recopies the hook.
- **Render never fetches.** `emit()` calls `refreshUpdateCheck()` → spawns a **detached** `node statusline.js update-check` child (`stdio: 'ignore'`, `.unref()`), returns immediately. Parent exits on its usual stdin race; child writes the cache ~300ms later, so the nudge shows on the next render. Blocking inline would break the timing contract for a segment nobody waits on.
- `lastAttempt` stamped **before** the spawn → offline machine / failed spawn / killed child backs off `UPDATE_RETRY_MS` (1h) instead of respawning per render. Success stamps `checkedAt` → next check gated by `UPDATE_TTL_MS` (7 days). Failure leaves `checkedAt` untouched, so the 1h backoff governs, not the weekly one.
- Interval, not calendar-pinned. "7 days since last success" needs no date math; drift is harmless.
- `VERSION` constant lives in `statusline.js`: installers copy that file alone into `~/.claude/hooks/`, no `package.json` beside it at runtime. **Bump it with `package.json`** — see keep-in-sync below.
- `CTXLINE_DISABLE=update` skips cache read and spawn entirely.

**Render seam.** `collectFacts(data)` gathers everything touching fs/child_process/env (git branch + ahead/behind, in-progress task, cached update version, `COLUMNS`); pure `renderStatusLine(data, facts, usage)` formats; `outputStatus` is a ~3-line writer, try/catch → `Status unavailable`. `outputFallback` calls the same renderer with a static git/task-free `facts` (`cols: undefined` → single line, matching the fallback contract). Entry guarded by `require.main === module` so `test/render.test.js` can `require()` and call exports directly instead of spawning: `renderStatusLine`, `renderSubagentTask`, `parseScopedLimits`, `parseUsagePayload`, `normalizePercentage`, `readStdinThen`, `serializeUsageCache`, `compareVersions`, `parseRegistryVersion`.

**Caches** (all in `~/.claude/cache/`):
- `usage-cache.json` — `{ timestamp, data: { fiveHour, weekly, models }, lastAttempt }`, not formatted strings → old string-format caches ignored on read. Shared across sessions; `models` optional (pre-scoped-bars caches still validate). Fresh `FRESH_TTL_MS` 30s → render cache, skip API; stale → refresh, on API failure fall back to cache up to `STALE_TTL_MS` 10m. `lastAttempt` — stamped by `recordUsageAttempt()` before the request fires, success or failure — is the retry cooldown, independent of `timestamp`. Segments re-rendered every time via `buildUsageBar()` so countdowns recompute from `resetsAt`. Fronts the API path only — stdin `rate_limits` never reads or writes it.
- `update-cache.json` — `{ latest, checkedAt, lastAttempt }`, all optional. Written by the detached `update-check` child (`latest` + `checkedAt`) and by `refreshUpdateCheck()` (`lastAttempt` only). Read-only on the render path. Shared across sessions like the others.
- `git-cache.json` — single entry `{ gitDir, timestamp, ahead, behind }`; different repo invalidates. Fresh `GIT_FRESH_TTL_MS` 5s (render burst spawns `git` once) → stale re-run → on slow/failed call fall back to last counts up to `GIT_STALE_TTL_MS` 60s so they don't flicker.

**Two color schemes (intentional, do not unify):** context bar (`getContextBar`) steps 50/65/80 (≥80 → blink red); usage (`getUsageColor`) steps 50/75/90. Model-scoped bars opt out of both — `getScopedColor` (orange, red ≥90) passed as `buildUsageBar`'s optional 4th arg → several scoped bars read as one group while a nearly-spent one still stands out.

**Deliberate non-goals — do not re-propose:**
- **Merging the two caches, or the two duration formatters** (`buildUsageBar`'s countdown vs `formatElapsed`). Two callers each, differing validators / units / refresh policies (git 5s/60s vs usage 30s/10m; countdown vs elapsed) — a shared `withCache`/`formatDuration` moves complexity into parameters. Revisit only on a third caller.
- **Making the `lastAttempt` cooldown atomic.** The check (`getLastAttemptAge()`) and the claim (`recordUsageAttempt()`) aren't atomic across processes — every render that reads a stale `lastAttempt` before any of them writes one calls `getApiUsage()`, so the extra calls scale with how many hook processes render at once (the cache is shared across sessions), not a fixed one. Still never a crash or bad render; a filesystem lock plus a multi-process test contradicts the single-file, zero-dependency constraint. Revisit only if concurrent hook processes prove common.

## Subagent mode (`subagentStatusLine`)

Second entry point in the same file, activated by `process.argv[2] === 'subagent'` — one row per running subagent task in the agent panel, wired in `settings.json` as a separate command from `statusLine`:

```json
{ "subagentStatusLine": { "type": "command", "command": "node ~/.claude/hooks/statusline.js subagent" } }
```

- Stdin: `{ tasks: [...], ... }` (base fields `session_id`/`cwd`/`columns` present but unused). Each task: `id`, `name`/`description`/`label`, `type`, `status`, `startTime`, `model` (resolved ID, absent until resolved), `effort` (level string or numeric token budget, absent when the subagent inherits session effort), `contextWindowSize`, `tokenCount`, `tokenSamples`, `cwd`.
- Stdout: one `{"id","content"}` JSON line per task to override. Omitted id → default rendering; empty `content` → row hidden.

Row: `name │ Model · effort │ C<used> <bar> │ ⏱ <elapsed>`, built by `renderSubagentTask()`. Reuses main-line blocks rather than duplicating: `SEGMENT_SEP`, `renderContextBar()` (used%→bar/color, factored out of `getContextBar`, shared by both), `getEffortColor()`. `shortenModelId()` shortens the resolved model *ID* ("claude-opus-5" → "Opus 5"; strips `us.`/`anthropic.` prefixes and a trailing `-YYYYMMDD` date) — distinct from `shortenModel()`, which only trims `" context)"` off a display *name*.

Every segment past `name` is independently conditional: no `model` → no model/effort segment (effort alone still renders); no `effort` → no `· effort` suffix; `tokenCount`/`contextWindowSize` not both finite (or window ≤ 0) → no context bar; unparseable `startTime` → no elapsed segment.

`startTime`'s format isn't documented upstream and isn't otherwise read in this file, so `formatElapsed()` accepts whatever shows up: number < `1e12` → epoch-seconds, larger → epoch-ms, anything else handed straight to `Date()` (covers an ISO string). Revisit if a real payload contradicts this.

Skips everything main mode does besides stdin parsing — no usage API, git, todos, cache — so no `overallTimeout` race against a fetch; `emitSubagent()` hard-caps the stdin read at `SUBAGENT_TIMEOUT_MS`. Bad/missing payload, or a task whose shape breaks rendering → emit nothing rather than a partial line: default rendering stays for every task in the panel, process still exits 0.

## Keep in sync when `statusline.js` changes

`statusline.js` is source of truth; the six files below mirror it and must change in the same edit or CI/release/site drifts. Author edits `statusline.js`; assistant re-syncs. After any edit run `npm test` + `npm run preview`.

| file | mirrors | trap |
|---|---|---|
| `scripts/preview.js` | cache seed passed to `seedUsageCache`, `render()` params/labels, stdin input object | release body shows `head -n 1` → keep the primary-line `console.log` **first**; a stale seed makes usage render wrong or vanish |
| `test/render.test.js` | visible labels / percentages / colors / order | ANSI `colors` constants sit atop the file — update them when codes change |
| `docs/assets/preview.svg` | the statusline `<text>` elements' `<tspan>` runs (README + site) | generated, never hand-edited — run `npm run preview:svg` after anything that shifts this scenario's output; window chrome, prompt lines, and the "○ " bullet stay hand-authored |
| `docs/index.html` | hero mock (`.term .line`) + subagent-panel rows | byte-compared against real `renderStatusLine()`/`renderSubagentTask()` calls by `test/docs-drift.test.js`, so drift fails `npm test`; inspector `SIGNALS[]` and `.term` color classes are unchecked — hand-verify |
| `CLAUDE.md` | format diagram (top), segment-source table, visible contract below | — |
| `package.json` | `version` ↔ the `VERSION` constant in `statusline.js` | not a visible-line mirror, but the same class of drift: a stale `VERSION` makes every installed copy nudge for an update forever (or never) |

`test/fixture.js` is the shared harness behind test + preview, not one of the six: fake-HOME construction, `usage-cache.json` seeding (via the exported `serializeUsageCache`, so the on-disk shape can't drift between writer and seed), `update-cache.json` seeding (`makeHome()` stamps a `latest`-less one so tests never spawn the registry child), diverged-repo building, spawn wrappers for both entry points. Dev-only, outside the `files` whitelist.

Triggers: change to **what the line looks like** → test assertions (+ `npm run preview:svg`). Change to **cache shape or stdin fields** → both seeds. Version bump → `VERSION` in `statusline.js` too. `npm run preview` is the fast visual check. (README has no sample line — leave it.)

Full edit-point map, test-harness options, and the ANSI/SVG color tables: `.claude/skills/restyle-statusline/SKILL.md`.

Visible contract = format diagram (top) + color steps above, plus: only `C` gets a bar glyph (`buildUsageBar` builds text-only `H`/`W`/scoped segments despite the name); `$<cost>` dim, after usage and before task; `↑N↓M` ↑ green / ↓ red; the `⬆` row appended below the layout (green `⬆` + new version, dim connective, bold command), never inside it; responsive wrap (narrow → line 2 = `H`/`W`/`$`/task); always-print-and-exit-0 fallback.

## Do not touch the installers

Work in `statusline.js` only. Install path is frozen (inherited working from upstream):
- No behavior change to `bin/install.js`, `install.sh`, `install.ps1` except unavoidable branding (repo URL / package name) or wiring a settings.json entry a shipped `statusline.js` feature already depends on (e.g. `subagentStatusLine`).
- `npx ctxline-claude` → `bin/install.js` installs silently, no prompts. Keep it so.
- All three write both `statusLine` and `subagentStatusLine` → same hook file (`subagentStatusLine` appends a space + `subagent`), path written quoted (the command runs through a shell, so an unquoted home dir with spaces splits into two args). New entry point → wire into all three, not just document the snippet.
- Uninstall: `npx ctxline-claude uninstall` (arg `uninstall`/`remove`) — removes only our two keys (guarded, backed up), deletes the hook, clears the cache. Additive; must not alter the no-arg install. `install.sh`/`install.ps1` have no uninstall command, only printed manual-removal instructions — which must list both keys too.
- No "Full vs Lite" prompt or `statusline-lite.js` (deleted upstream `846e10e`) unless reintroduced as a deliberate real feature.

## Distribution + releasing

`statusline.js` is fetched verbatim from GitHub `main` by `install.sh`/`install.ps1` (via `REPO_URL`) and copied by `bin/install.js`. A change on `main` ships to anyone re-running the installers — keep `main` releasable. `package.json` `files` whitelists what publishes.

Releases are owner-triggered, manual: bump `version` in `package.json` **and the `VERSION` constant in `statusline.js`** on `main`, then run the **Release** workflow (`.github/workflows/release.yml`), which publishes from that version. Never `npm publish` by hand; never bump the version unasked.
