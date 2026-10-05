---
name: sync-context-labels
description: Sync the desktop plugin's CATEGORIES map (desktop/hooks/register.tsx) with the /context category names in the installed Claude Code. Use after a Claude Code update, or when the desktop legend shows a full lowercased category name instead of a short label.
---

# Sync /context labels

`CATEGORIES` in `desktop/hooks/register.tsx` maps `/context` category `name` → short legend label + hex color. Names come from the Claude Code binary and can be added, removed, or renamed between releases. Unknown name → legend shows full lowercased name + engine theme color (visible, not silent).

Keyed by `name` on purpose (short labels save space) even though the API docs say branch on `kind` — drift is handled manually by this skill.

Flow: find active binary → extract names → diff vs `CATEGORIES` → report + proposal → apply only after user confirms.

## 1. Find the active Claude Code

```bash
which claude
claude --version
```

On this machine `claude` is the npm install:
- Binary: `$APPDATA/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe`
- Version: sibling `package.json`

`~/.local/share/claude/versions/` holds a stale native install (2.1.143) — not active. Always confirm via `which` + `--version`; if they point elsewhere, use that binary.

## 2. Extract category names

Git Bash, binary grep, slow → Bash timeout ~180000ms.

```bash
grep -a -o 'name:"[A-Z][A-Za-z ()]\{2,30\}",tokens:[^,]\{1,40\},color:"[a-zA-Z_]*"' "$BIN" | sort -u
```

Regex only matches this exact name format and `name`/`tokens`/`color` field order → a differently shaped entry is silently missed, so a missed new category reads as "in sync" and a missed existing one as "removed". Cross-check the neighbouring entries around a known one:

```bash
grep -a -o '.\{300\}name:"Custom agents",tokens.\{900\}' "$BIN" | head -1
```

- Theme color keys in the output (`promptBorder`, `inactive`, `cyan_FOR_SUBAGENTS_ONLY`, …) are irrelevant — plugin uses its own hex.
- `free` / `buffer` names are minified vars → never key on them; plugin maps those by `kind`.
- Names ending ` (deferred)` (e.g. `MCP tools (deferred)`, `System tools (deferred)`) are `kind: 'deferred'` → skipped by `segments()`, not in `CATEGORIES`.
- Secondary source: `desktop/.claude-plugin/types/claude-code/index.d.ts` (written by engine on local load, gitignored) or plugin-authoring skill's `types/claude-code.d.ts` — documents `ContextCategory` shape only, not names.

## 3. Diff and report

Compare extracted non-deferred names vs `CATEGORIES` keys. Report:
- **Added** — in binary, not in map.
- **Removed** — in map, not in binary.
- **Renamed** — likely pairs (one removed + one added with similar meaning); flag as a guess, user decides.

A clean diff is not proof (step 2 regex can miss entries) — the runtime check at the end confirms it. No diff → report "in sync with <version>"; still offer to bump the version string (step 4.1–4.2) only, no plugin version bump.

For each added/renamed name, propose:
- Label: short lowercase, ≤ 8 chars, consistent with existing (`sys`, `tools`, `mcp`, `mcp info`, `agents`, `mem`, `skills`, `msgs`). Renamed → keep the old label unless meaning changed.
- Color: hex distinct from existing entries and from `BUFFER_COLOR` `#4b5160` / `FREE_COLOR` `#2e3240`. Renamed → keep the old color.

Show diff + proposals together; wait for user OK or edits before touching files.

## 4. Apply (after OK)

1. `desktop/hooks/register.tsx`: edit `CATEGORIES`; update version in its comment (`Claude Code 2.1.289` → new).
2. `CLAUDE.md` → Desktop plugin → "Context bar" paragraph: same version string (`checked against Claude Code <version>`).
3. `desktop/.claude-plugin/plugin.json`: bump `version` — users only get changes on bump. Skip if only the version string changed.
4. Only if a label in the sample legend changed (hand-authored, not drift-tested):
   - `docs/assets/desktop-preview.svg` — legend `<text>` at y=333.
   - `docs/index.html` — `#desktop` `.legend` row.
5. Validate (via `check-bot` only if user asks, per global rules):
   - `claude plugin validate ./desktop`
   - `npx -y -p typescript tsc -p desktop` — needs `desktop/tsconfig.json`, which exists only after a local load (`local-claudedesktop-test`).

Runtime check: under `local-claudedesktop-test`, every legend entry shows a short label, none a full lowercased name.
