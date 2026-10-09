---
name: release-notes
description: Prepare a ctxline release — bump the version, commit and push the chore commit to main, then draft the GitHub release title and notes in chat; after the user triggers the release workflow, apply them to the live release. Use when the user gives a release version (e.g. "release 1.7.6", "/release-notes 1.7.6") or asks for release notes for a published tag.
---

# Release notes

Input: version `X.Y.Z`. User triggers the `Release` workflow themselves (publishes npm + creates the GitHub release with preview, Downloads, auto-generated notes). This skill: bump + push before, notes in chat meanwhile, rewrite notes/title after.

## 1. Preflight

- Version must be semver, greater than latest tag (`git tag --sort=-v:refname | head -1`). Gap (e.g. 1.7.2 → 1.7.5) → ask before continuing.
- Branch `main`, no tracked changes, in sync with `origin/main`. Untracked files are ignored. Otherwise stop and report.

## 2. Bump, commit, push

Invoking the skill with a version is approval to commit and push `main` — no further ask.

1. `package.json` `version` → `X.Y.Z`.
2. `statusline.js` `VERSION` → `'X.Y.Z'`. Both must match (test-enforced; workflow fails otherwise).
3. Commit `chore: bump version to X.Y.Z` (single line, via `git commit -F -` heredoc), `git push origin main`.

Desktop plugin version (`desktop/.claude-plugin/plugin.json`) is never bumped here. If `desktop/` changed since the last tag and `version` equals the one at that tag → tell the user before they trigger the workflow (marketplace users only get changes on bump).

## 3. Draft notes in chat

Gather changes since the previous tag via `git-bot` (digest of commits + merged PR titles, `vPREV..HEAD`). Reply with title + body in one block, then stop; user is releasing meanwhile.

**Title:** `vX.Y.Z (Short label)` — 2–3 words naming the headline change (`v1.7.2 (Installer feedback)`, `v1.7.5 (Desktop plugin)`).

**Body:**

````markdown
### Statusline preview

_Sample line — colors render in a real terminal; stripped here._

```text
<first line of `node scripts/preview.js`, ANSI stripped>
```

### Downloads

- `ctxline-claude-code-vX.Y.Z.zip` — statusline (same contents as the npm package)
- `ctxline-claude-desktop-v<plugin.json version>.zip` — Claude desktop plugin v<plugin.json version> (updates itself through the plugin marketplace; not versioned with this release)

## What's Changed
* <user-facing bullet>
* Statusline itself is unchanged.

**Full Changelog**: https://github.com/MithunWijayasiri/ctxline-claude/compare/vPREV...vX.Y.Z
````

Rules:
- Bullets: plain words, user-visible effect first, no PR numbers, authors, or `feat(...)` prefixes. Name commands/labels in backticks.
- Drop internal-only changes (skills, tests, CI tweaks) unless users see them (new release assets, npm page, installer output).
- Statusline output unchanged (no visible diff in `statusline.js`/renders) → end bullets with `Statusline itself is unchanged.`
- First desktop plugin release or new install path → include the install commands.
- Preview line comes from `scripts/preview.js`, not from memory.

## 4. Apply to the release

Wait for the user to say the release is made.

1. `gh release view vX.Y.Z` — must exist; else stop and say so.
2. Read the live body. Keep `### Statusline preview` and `### Downloads` verbatim from it (they are generated from the actual run); replace everything from `## What's Changed` down with the drafted bullets + Full Changelog.
3. `gh release edit vX.Y.Z --title "<title>" --notes-file -` (heredoc).
4. Re-read the body once; report the release URL.
