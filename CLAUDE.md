# CLAUDE.md

## What this is

npm package `ctxline-claude` — single-file statusline for Claude Code:

```text
dir ⎇ branch ↑N↓M │ model · effort │ C<used> <bar> │ H<pct> ↺ <reset> │ W<pct> ↺ <reset> │ <model-initial><pct> ↺ <reset> │ $<cost> │ R<n> I<n> O<n> │ task
⬆ <latest> available · npx ctxline-claude@latest     (or, 5s after a self-install: ⬆ ctxline updated <old> → <new>)
```

`C` context (only segment with a bar), `H` 5-hour usage, `W` 7-day usage, `<model-initial>` model-scoped weekly limit, `$` session cost, then the main thread's tokens from its transcript (`R` cache reads, `I` input not from the cache = uncached input + cache writes, `O` output incl. thinking; `…` while a long transcript is still being caught up on). Everything after `dir`/`model`/`C` is conditional — renders only when its source resolves. The `⬆` row is not a segment — appended below the layout only when a newer release is cached (nudge) or a self-install just landed (updated, `UPDATED_NOTICE_MS` 5s from first render).

Auto-update (default on; `CTXLINE_DISABLE=autoupdate` off): the detached `update-check` child, on finding a newer npm release, downloads `statusline.js` from GitHub raw at tag `v<latest>`, requires its `VERSION` to equal `<latest>`, and swaps it in via temp file + rename. Only when the running file is `~/.claude/hooks/statusline.js` — a working-tree copy (local testing) is never overwritten. Every release needs its `v<version>` tag pushed, or installs fail and fall back to the nudge.

Repo also ships `ctxline-desktop`, a Claude Code plugin (mod) for the desktop app's Code tab, which doesn't run statusline scripts. See [Desktop plugin](#desktop-plugin).

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

**stdin:** `model.display_name`, `workspace.current_dir`, `session_id`, `effort.level`, `context_window.remaining_percentage`, `cost.total_cost_usd`, `transcript_path` (tokens segment), `rate_limits.five_hour/seven_day` (`{ used_percentage, resets_at }` — `resets_at` is Unix epoch **seconds**). Env: `COLUMNS` (set by Claude Code v2.1.153+), `CTXLINE_DISABLE` (opt-out: `branch`, `effort`, `cost`, `tokens`, `task`, `update`, `autoupdate`, `usage`; `dir`/`model`/`context` always render; disabling skips the work, not just the output).

**Invariants:**
- Usage is cache-first: stdin `rate_limits` or `~/.claude/cache/`, refreshed from the OAuth `/usage` API on the render path only when the cache is past `FRESH_TTL_MS` and no `lastAttempt` cooldown applies (own timeout, 1200ms warm / 1500ms cold). The update check is the one thing that never runs on the render path — detached child, `lastAttempt` stamped before the spawn (failed check or install backs off 1h, successes 3d).
- Model-scoped weekly bars exist only in the OAuth `/usage` payload — never in stdin.
- `collectFacts()` owns fs/child_process/env access; `renderStatusLine()` is pure. Exported under `require.main === module` for direct test use: `renderStatusLine`, `renderSubagentTask`, `parseScopedLimits`, `parseUsagePayload`, `normalizePercentage`, `readStdinThen`, `serializeUsageCache`, `compareVersions`, `parseRegistryVersion`, `isReleaseBody`, `VERSION` (not `collectFacts` — it's the impure half).
- Caches (`~/.claude/cache/`): `usage-cache.json` fresh 30s / stale-fallback 10m, `lastAttempt` cooldown applies to failed attempts too; `git-cache.json` 5s/60s; `update-cache.json` on the render path: read, plus `lastAttempt` before the spawn and `updatedShownAt` on the updated row's first render; `tokens/<sha1 of path>.json` per transcript (inode, byte offset, running totals, last `TOKENS_RECENT_IDS` 64 message ids): each render reads only what was appended, at most `TOKENS_MAX_READ` 16 MB, whole lines only; when a new state file is created, any not written for `TOKENS_MAX_AGE_MS` 30 days are deleted. A reply is logged several times while it streams, so a message id counts once, at its last usage.

Segment sources, color thresholds, layout/wrap rules, full edit-point map: `.claude/skills/restyle-statusline/SKILL.md`.

## Subagent mode

`node statusline.js subagent` — one `{"id","content"}` JSON row per running task in the agent panel. Reads stdin (capped at `SUBAGENT_TIMEOUT_MS`) and, for the tokens segment, each subagent's transcript: `agent-<task id>.jsonl` in `<transcript_path minus .jsonl>/subagents/`, else the newest `.meta.json` with the task's `description`. Bad payload → emit nothing, exit 0. Row `name │ Model · effort │ C<used> <bar> │ ⏱ <elapsed> │ <tokens>`; every segment past `name` is independently conditional.

## Desktop plugin

`desktop/` — function-hooks plugin `ctxline-desktop`, own version (`desktop/.claude-plugin/plugin.json`, independent of npm `VERSION`). Repo root is plugin marketplace `ctxline` (`.claude-plugin/marketplace.json`, `source: "./desktop"`). Install: `/plugin marketplace add MithunWijayasiri/ctxline-claude` → `/plugin install ctxline-desktop@ctxline`. Not in npm `files`, not touched by installers.

Files: `hooks/hooks.json` → `hooks/register.tsx` (the module) → `hooks/pet.ts` (pixel pet SVG frames); `types/index.d.ts` (`PluginState['ctxline-desktop']`: `snap`, `activity`, `frame`, `cache`, `compacting`, `models`; state keys must match plugin name or validation fails).

Layout (Desktop already shows model/effort — omitted; its own folder/branch/changes display is gone since its latest update, so the plugin draws them):

```text
AbovePrompt  ╭ <pet> <folder> ⎇ <branch> ↑N↓M                             +<added> -<removed> ╮
             <activity>                          (H) <left>% · (W) <left>% · (F) <left>% │ cache <pct>% · $<cost>
             C<used> <full-width category bar> <tokens> / <window> │ ⇣ compact
                 ■ sys 4k  ■ tools 34k  ■ mcp 17k  … ▨ buffer 33k
```

Top row: rounded dim-bordered `Box` inside `AbovePrompt` (a plugin can't draw a separate Desktop card). Branch hidden on detached HEAD; `+added -removed` (green/red) hidden when zero, counts the committed branch diff vs the default branch (`git diff origin/HEAD...HEAD --shortstat`, same numbers as Desktop's Changes panel for a PR; hidden without `origin/HEAD`); `↑N↓M` hidden when in sync. `<pet>`: pixel Claude (`Svg`, from the terminal logo) — not interactive. While working, acts out the running tool: types (Edit/MultiEdit/Write/NotebookEdit), looks around (Read/Grep/Glob/WebFetch/WebSearch), thinks (`...`, between tools), hops (any other tool). Idle: stands and blinks, sleeps 59 min after the last turn ends (or session start, before the first turn). Frames step on the `frame` atom, ticked every 250ms all session (also drives the spinner).

No in-plugin update check. Updates come from Claude Code's marketplace auto-update (off by default for third-party marketplaces; no enable-auto-update toggle in `/plugin` → Marketplaces (only a one-off Update, found by testing) — user sets `extraKnownMarketplaces.ctxline.autoUpdate: true` in `~/.claude/settings.json`; runs after session start, no interval setting, not settable from repo). Users get a change only when `version` is bumped — bump it with every `desktop/` change meant to ship.

`displayName` (`plugin.json`) is the UI name; `name` must stay kebab-case (no spaces). Marketplace `name` is the "from <name>" label and the `@` suffix in install ids; no spaces allowed. `icon` in `plugin.json` is read only by Anthropic's directory — Desktop ignores it, not set.

Limits: percent left (100 − used), no reset time; `(H)`/`(W)` is an `Svg` donut of the share left with the limit's letter inside, arc colored by `usageColor` through `SVG_COLORS` (an `Svg` takes CSS colors, not the theme's named ones). Model-scoped weekly limits (`(F)` for Fable, one ring per `weekly_scoped` entry, labeled by the model's initial) follow W, colored by `modelColor` (flat orange, red ≥90 — the CLI's `getScopedColor`); fetched from `/api/oauth/usage` via `$.http.fetch` with the `$.session.authorize()` handle (bearer only — none on an API key) on session start + every 30s, not after turns; last good reading kept `MODELS_KEEP_MS` 10m through failed fetches, then hidden.

`<activity>`: working → `<spinner> <tool> <detail> · <elapsed> · tool #N` (`thinking` between tools); idle → `last turn <dur> · N tool(s)`; before the first turn (new or resumed session) → `ready · no turns yet`.

Context bar: one segment per `/context` category from `$.session.usage({ breakdown: 'summary' })` (local estimate, no API call); deferred rows skipped, `free`/`buffer` by `kind`. Short labels + colors come from `CATEGORIES`, keyed by `/context` category name (checked against Claude Code 2.1.289); an unknown name falls back to its lowercased name + theme color — add it to `CATEGORIES` when one shows up. Legend stays one line: items fitted to `e.props.bodyColumns`, the rest counted as `+N more`; a wrapping second row is clipped (Desktop ignores `truncate-end` on it). No breakdown → two-segment bar from `contextUsed`, no legend.

`⇣ compact`: `Button` → `$.command.run({ command: 'compact' })` — Desktop sessions are headless: `$.session.compact()` throws there, and `$.prompt.submit` refuses `/`-prefixed text (both found by testing). `command.run` queues every call → `compacting` atom locks presses (shows `compacting…`) until the run settles; dim unclickable text while a turn runs (`activity` or `e.props.isWorking`); failure → toast. Neither `isWorking` flag covers a compaction (found by testing).

Sources: `$.session.usage()` (context, `five_hour`/`seven_day`, cost) refreshed every 30s + after each turn; `git rev-list --left-right --count @{u}...HEAD`, `git branch --show-current`, `git diff origin/HEAD...HEAD --shortstat` via `$.process.run` (folder = basename of `$.session.cwd()`); `prompt.submit`/`tool.call`/`turn.complete` for activity; cache hit = Σ`cache_read` / Σ(input + cache_read + cache_creation) from main-loop `turn.complete` `usage` (subagent turns, `e.agentId` set, ignored). Cache tally resets on `session.start` (incl. hot reload).

Desktop constraints (found by testing): `PromptHint` not drawn; `SessionMode` drawn on its own row below the model picker since Desktop's Claude Code 2.1.296 update — not hooked; everything in `AbovePrompt`. `Box flexGrow` must be finite ≤ 10000 (bar slices scaled per-mille). `Svg isInteractive` (needed for SMIL) draws in a sandboxed frame that paints blank for a moment on each source change → visible flash; pet stays a plain image, animated by swapping frames. `$.command.run` echoes `/compact` as a user bubble in the chat — not removable (`session.append` only rewrites content; Desktop draws its own transcript).

Not available in the plugin: task (needs files the mod doesn't read).

Validate: `claude plugin validate .` (marketplace) and `claude plugin validate ./desktop`. No tsconfig in `desktop/` → editor shows "Cannot find module 'claude-code'"; editor-only.

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

Desktop plugin mirrors (hand-authored, not drift-tested) — update when `desktop/` layout changes: `docs/assets/desktop-preview.svg` (README), `docs/index.html` `#desktop` mock, README "Claude desktop app" section.

Triggers: visible output change → test assertions + `npm run preview:svg`; cache shape or stdin fields → both seeds; timing/TTL constants or `module.exports` → the Invariants block above; version bump → `VERSION` in `statusline.js` too.

`test/fixture.js` backs test + preview (fake HOME, cache seeds, spawn wrappers). Harness options: `SKILL.md`.

## Non-goals — do not re-propose

- Merging the two caches, or the two duration formatters (usage countdown vs subagent elapsed): two callers each, differing validators/units/TTLs. Revisit on a third caller.
- Atomic `lastAttempt` cooldown: check+claim aren't cross-process atomic; worst case is a few extra API calls, never a bad render. A file lock + multi-process test contradicts single-file/zero-dep.

## Do not touch the installers

Install path frozen: hook location, settings.json keys, backup behavior. Allowed: branding and console output in all three; `bin/install.js` install feedback (version detection, update/changelog line, downgrade guard, failure messages); wiring a settings.json entry a shipped feature already depends on. `npx ctxline-claude` installs silently. All three write both `statusLine` and `subagentStatusLine` to the same hook file (path written quoted). New entry point → wire into all three.

Uninstall: `npx ctxline-claude uninstall` removes only our two keys (guarded, backed up), deletes the hook, clears the cache (`usage-cache.json`, `tokens/`). `install.sh`/`install.ps1` have no uninstall command — their printed manual-removal instructions must list both keys. No Full/Lite prompt or second statusline file.

## Distribution

`statusline.js` is fetched verbatim from GitHub `main` by `install.sh`/`install.ps1` and copied by `bin/install.js` — a change on `main` ships to anyone re-running the installers; keep `main` releasable. `package.json` `files` whitelists what publishes.

Version bump: `version` in `package.json` **and the `VERSION` constant in `statusline.js`**, on `main` (a test asserts they match).
