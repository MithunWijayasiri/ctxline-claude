---
name: local-claudedesktop-test
description: Load this repo's working-tree desktop/ plugin (ctxline-desktop) into the Claude desktop app's Code tab for live testing, then revert to the marketplace install. Use when a contributor wants to try desktop/ changes in the real desktop app before release — no version bump, marketplace update, or publish needed.
---

# Local desktop plugin test

Test working-tree `desktop/` live in the desktop app's Code tab. Only ever edits the contributor's own `~/.claude/settings.json`; nothing in this repo is committed.

## 1. Point the desktop app at the working tree

The app will run the checked-out branch's `desktop/hooks/register.tsx` in every Code session — only point it at a branch you trust.

Config file: `~/.claude/settings.json` (Windows: `$env:USERPROFILE\.claude\settings.json`).

Before editing, save for step 4's exact revert:
- whether `env` exists, and if so its full value;
- whether `enabledPlugins["ctxline-desktop@ctxline"]` exists, and its value.

Set:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "<repo-abs-path>/desktop",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
},
"enabledPlugins": { "ctxline-desktop@ctxline": false }
```

- Merge into existing `env` / `enabledPlugins` — don't replace other keys.
- `CLAUDE_CODE_PLUGIN_DIRS` → desktop sessions are headless/SDK; this env var is the documented way to load a plugin there. `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` → hot reload on save.
- Absolute path (or `~`-prefixed) — relative paths are skipped. Windows: backslashes JSON-escaped (`C:\\Github\\ctxline\\desktop`); forward slashes untested there.
- Marketplace copy disabled → same plugin name as the local one. Whether both together actually conflict is untested; disabled to be safe.
- Not a local marketplace (`claude plugin marketplace add <folder>`): its name clashes with the installed `ctxline` marketplace (GitHub source), would need removing that first.

Tell the contributor to fully quit and reopen the desktop app (or start a new Code session) — settings are read at startup. Afterwards, saves to `desktop/` reload live.

Side effects of a local load (both gitignored, leave them): engine writes `desktop/tsconfig.json` and `desktop/.claude-plugin/types/`. `npx -y -p typescript tsc -p desktop` only works once these exist.

## 2. Test

- Before the first turn (new or resumed session): activity reads `ready · no turns yet`; context bar is the fallback two-segment used/free bar, no legend.
- After first response: full-width category bar + legend. A legend entry showing a full lowercased name (e.g. `new category`) = `/context` category missing from `CATEGORIES` → run `sync-context-labels`.
- During a turn: spinner + tool + elapsed + `tool #N`; `⇣ compact` dim and unclickable.
- Idle: `last turn <dur> · N tool(s)`; press `⇣ compact` → `compacting…` until it settles, repeat presses ignored; `/compact` bubble in chat is expected.
- Footer (`SessionMode`): `H<pct> ↺ <reset> │ W<pct> ↺ <reset>`.

## 3. Where errors surface

- Dim transcript line: `ctxline-desktop: ui.render (AbovePrompt) refused: <reason>; the engine drew its own`.
- Toasts from `$.ui.toast`; thrown HooksErrors include host hints.
- Known runtime constraints (flexGrow cap, headless `compact()`, `command.run` queuing, no `Button` `disabled`, etc.): `CLAUDE.md` → Desktop plugin.

## 4. Revert

Put back step 1's saved state exactly:
- `env` absent before → delete the whole `env` key; else remove only our two keys (restore any prior values they had).
- `enabledPlugins["ctxline-desktop@ctxline"]` → saved value, or delete the key if it didn't exist.

Fully quit and reopen the desktop app.

## Notes

- Whichever branch is checked out is what loads — keep the branch under test checked out for the session.
- The marketplace copy only changes when `desktop/.claude-plugin/plugin.json` `version` is bumped; local testing needs no bump.
