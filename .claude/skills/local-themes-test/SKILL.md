---
name: local-themes-test
description: Use when a contributor wants to try working-tree desktop-themes/ changes (ctxline-desktop-themes) live in the Claude desktop app before release. Handles loading the working tree, a test checklist, and reverting. Not for desktop/ → local-claudedesktop-test.
---

# Local themes plugin test

Test working-tree `desktop-themes/` live in the desktop app's Code tab. Only ever edits the contributor's own `~/.claude/settings.json`; nothing in this repo is committed.

## 1. Point the desktop app at the working tree

The app will run the checked-out branch's `desktop-themes/hooks/register.tsx` in every Code session — only point it at a branch you trust.

Config file: `~/.claude/settings.json` (Windows: `$env:USERPROFILE\.claude\settings.json`).

`env.CLAUDE_CODE_PLUGIN_DIRS` already set (e.g. a `local-claudedesktop-test` run still active) → stop and ask: revert that first, or keep it. Loading two dirs at once is untested (list separator unknown).

Before editing, save for step 4's exact revert:
- whether `env` exists, and if so its full value;
- whether `enabledPlugins["ctxline-desktop-themes@ctxline"]` exists, and its value.

Set:

```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "<repo-abs-path>/desktop-themes",
  "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
},
"enabledPlugins": { "ctxline-desktop-themes@ctxline": false }
```

- Merge into existing `env` / `enabledPlugins` — don't replace other keys.
- `CLAUDE_CODE_PLUGIN_DIRS` → desktop sessions are headless/SDK; this env var is the documented way to load a plugin there. `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` → hot reload on save.
- Absolute path (or `~`-prefixed) — relative paths are skipped. Windows: backslashes JSON-escaped (`C:\\Github\\ctxline\\desktop-themes`).
- Marketplace copy disabled (if installed) → same plugin name as the local one; disabled to avoid two copies setting the theme.
- Installed `ctxline-desktop` (marketplace) stays on — themes must work alongside it.

Tell the contributor:
- Fully quit and reopen the desktop app — settings are read at startup.
- Then open a **new** Code session. The theme is set at `session.start`, so a session already open before the restart shows nothing (found by testing). Themes never show on the home screen or in Chat — Code sessions only.
- Afterwards, saves to `desktop-themes/` reload live.

Side effects of a local load: engine writes `desktop-themes/tsconfig.json` and `desktop-themes/.claude-plugin/types/` (both gitignored, leave them). Their timestamps right after the app restart confirm the plugin loaded — the app pre-starts a background session at launch. Anything else new under `desktop-themes/` in `git status` after the load → don't commit; ask.

## 2. Test

Command (the app prefixes every reply with `ctxline-desktop-themes:` and draws it as markdown):
- `/ctxtheme` → `Current theme: <Name>` (or `off (the app’s own look)`), then a markdown list of `ember`, `contour`, `phoenix`, `dusk`; `(current)` on the pick, `(default)` on dusk. Bold, bullets and code drawn — no raw `**` or backticks.
- No saved pick (first load) → Dusk applied at session start.
- `/ctxtheme <style>` for each style → palette + backdrop change at once; reply `Switched to <Name>. It stays on for new sessions.`
- ` Ember ` (case, spaces) → works. Unknown name → `No style called “<x>”. Pick one of: …`.
- `/ctxtheme off` → app's own look; new session stays off.
- New Code session → last pick re-applied.
- Reopen an older Code session → pick re-applied? Untested (`session.start` should run on resume). Record the finding in `CLAUDE.md` → Desktop themes plugin.

Backdrops (dark mode):
- `dusk` — orange and violet ribbons sway over layered hills.
- `ember` — coals along the bottom brighten and dim; cracks of heat pulse.
- `contour` — orange map lines drift; bands light up and fade, about one a second.
- `phoenix` — black hole pinned to the right edge, gold halo, striped disk streaming left; disk never crosses the halo. Narrow/tall window → left side cropped, hole stays.
- Text over the backdrop readable (glass blur/opacity) in chat, prompt box, sidebar.

Modes:
- App light mode → palette switches to the light version.
- Backdrop light version follows `prefers-color-scheme` — untested whether the frame follows the app's mode or the OS's. Set app and OS to different modes, check which the backdrop follows, record the finding in `CLAUDE.md` → Desktop themes plugin (replace "untested").
- OS reduced motion on (Windows: Settings → Accessibility → Visual effects → Animation effects off) → every backdrop holds still.

Live edits:
- Save `hooks/register.tsx`, `hooks/looks.ts` or `hooks/scenes.ts` → hot reload re-runs `session.start` → saved pick re-applied with the new code.
- `hooks/contour-paths.ts` is generated — change `scripts/themes-contour.js`, run `node scripts/themes-contour.js`.

## 3. Where errors surface

- No theme anywhere → first: is this a Code session opened after the restart? If yes and `/ctxtheme` is missing from the slash menu → plugin not loaded: check `desktop-themes/tsconfig.json` / `.claude-plugin/types/` timestamps against the restart, and the path escaping in `settings.json`. Desktop log: `%LOCALAPPDATA%\Claude\Logs\main.log` (`[CCD] session spawn` per session; no per-plugin detail).
- Theme set but not drawn → `/ctxtheme` reply `…nothing shows it here yet: <reason>`; debug log `<style>: not drawn: <reason>`.
- Command threw → `ctxline themes could not switch the theme. Try again.`
- Pick applied but not saved → `It couldn’t be saved, so new sessions won’t keep it.`
- Whole theme silently dropped → a palette has a `Desktop won't paint` problem; run `claude plugin test ./desktop-themes` (test guards it).
- Backdrop blank / app's own backdrop instead → scene id not a style id, or surface not `desktop`/`mobile`; see `ui.render` `Backdrop` hook in `register.tsx`.

## 4. Revert

Put back step 1's saved state exactly:
- `env` absent before → delete the whole `env` key; else remove only our two keys (restore any prior values they had).
- `enabledPlugins["ctxline-desktop-themes@ctxline"]` → saved value, or delete the key if it didn't exist.

Fully quit and reopen the desktop app.

## Notes

- Whichever branch is checked out is what loads — keep the branch under test checked out for the session.
- The marketplace copy only changes when `desktop-themes/.claude-plugin/plugin.json` `version` is bumped; local testing needs no bump.
