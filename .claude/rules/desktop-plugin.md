---
paths:
  - "desktop/**"
  - "docs/assets/desktop-preview.svg"
---

# Desktop plugin (`ctxline-desktop`)

Function-hooks plugin for the desktop app's Code tab (Code tab runs no statusline scripts). Own `version` in `desktop/.claude-plugin/plugin.json`, independent of npm `VERSION`.

Keep current: a `desktop/` change that makes anything here wrong → update this file in the same change.

## Files

- `hooks/hooks.json` → `hooks/register.tsx` (module) → `hooks/pet.ts` (pixel pet SVG frames).
- `types/index.d.ts` — `PluginState['ctxline-desktop']`: `snap`, `activity`, `frame`, `cache`, `models`. State keys must match plugin name or validation fails.
- `plugin.json`: `name` stays kebab-case (no spaces); `displayName` is the UI name; `icon` not set (Desktop ignores it).

## Layout

```text
<folder> ⎇ <branch> ↑N↓M                                    H <used>% · W <used>% · F <used>%
<pet> <activity>                                           cache <pct>% · <tokens> / <window>
━━━━━━━━━━━━━━━━━━━━──────────────────────────────────────────────────────────────────────────
```

- All inside `AbovePrompt` (plugin can't draw a separate card). No model/effort (Desktop shows them); folder/branch/changes drawn here (Desktop dropped its own).
- Each row: long item left (shrinks, `truncate-end`), short item right (`flexShrink={0}`) → long branch/tool detail never pushes numbers off.
- Desktop wraps instead of truncating → long strings cut in code with `…` (`clip`, `MAX_*_LEN`).
- `H`/`W` = percent used, as the CLI. Model-scoped weekly limits follow `W`, one per `weekly_scoped` entry, labeled by model initial.
- Context line: `Svg` 3 CSS px high (`Box` heights are cells), `preserveAspectRatio="none"`; track `#80808033` (see-through, suits light + dark). `Svg` takes CSS colors, not theme names → `SVG_COLORS`.
- Pet acts out the running tool; frames step on the `frame` atom (250ms tick, also drives spinner).

## Data sources

- `$.session.usage()` — context (local estimate, no API call) + `five_hour`/`seven_day`; every 30s + after each turn.
- Scoped weekly limits — only in `/api/oauth/usage`: `$.http.fetch` with `$.session.authorize()` (bearer only; none on an API key); session start + every 30s. Latest fetch failed → letters kept, grey `00%`.
- Git via `$.process.run`; folder = basename of `$.session.cwd()`.
- Cache hit = Σ`cache_read` / Σ(input + cache_read + cache_creation) over main-loop `turn.complete` `usage`; subagent turns (`e.agentId` set) ignored; resets on `session.start` (incl. hot reload).
- No task segment (needs files the plugin doesn't read).

## Desktop constraints (found by testing)

- `PromptHint` not drawn. `SessionMode` drawn on its own row below the model picker since 2.1.296 — not hooked.
- `Svg isInteractive` (needed for SMIL) draws in a sandboxed frame that blanks on each source change → flash. Pet stays a plain image, animated by swapping frames.

## Mirrors

- `usageColor`/`contextColor`/`modelColor`/scoped-limit parsing hand-copied from `statusline.js`, no test → change both together.
- Layout mirrors, hand-authored, not drift-tested: `docs/assets/desktop-preview.svg` (README), `docs/index.html` `#desktop` mock, README "Claude desktop app".

## Ship + validate

- Users get a change only when `version` bumps → bump with every `desktop/` change meant to ship. No in-plugin update check; updates come from marketplace auto-update (off by default for third-party marketplaces; user enables `extraKnownMarketplaces.ctxline.autoUpdate: true` in `~/.claude/settings.json`).
- `claude plugin validate ./desktop`. Editor "Cannot find module 'claude-code'" → no tsconfig in `desktop/`; editor-only.
