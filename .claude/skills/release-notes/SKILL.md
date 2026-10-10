---
name: release-notes
description: Bump the version, push the chore commit, draft the release title and notes, then apply them to the GitHub release. Invoke manually with a version, e.g. /release-notes 1.7.6.
disable-model-invocation: true
---

# Release notes

Input: version `X.Y.Z`. User triggers the `Release` workflow themselves (publishes npm + creates the GitHub release with Downloads, auto-generated notes). This skill: bump + push before, notes in chat meanwhile, rewrite notes/title after.

## 1. Preflight

Run `git fetch --tags origin` first (the workflow creates tags on GitHub, so the local clone can lack them). Tag `vX.Y.Z` exists on `origin` (`git ls-remote --tags origin vX.Y.Z` prints a ref) → already published: skip rest of step 1 and step 2, go to step 3 with range `vPREV..vX.Y.Z` (`vPREV` = tag just before `vX.Y.Z` in `git tag --sort=-v:refname`). Otherwise new version:

- Version must be semver, greater than latest tag (`git tag --sort=-v:refname | head -1`). Gap (e.g. 1.7.2 → 1.7.5) → ask before continuing.
- Branch `main`, no tracked changes, in sync with `origin/main`. Untracked files are ignored. Otherwise stop and report.

## 2. Bump, commit, push

New versions only. Invoking the skill with a version is approval to commit and push `main` — no further ask.

1. `package.json` `version` → `X.Y.Z`.
2. `statusline.js` `VERSION` → `'X.Y.Z'`. Both must match (test-enforced; workflow fails otherwise).
3. Commit `chore: bump version to X.Y.Z` (single line, via `git commit -F -` heredoc), `git push origin main`.

Desktop plugin version (`desktop/.claude-plugin/plugin.json`) is never bumped here. If `desktop/` changed since the last tag and `version` equals the one at that tag → tell the user before they trigger the workflow (marketplace users only get changes on bump).

## 3. Draft notes in chat

Gather changes via `git-bot` (digest of commits + merged PR titles): new version → `vPREV..HEAD` (`vPREV` = latest tag); already published → `vPREV..vX.Y.Z`. Reply with title + body in one block, then stop; user is releasing meanwhile (already published → go straight to step 4 on the user's OK).

**Title:** `vX.Y.Z (Short label)` — 2–3 words naming the headline change (`v1.7.2 (Installer feedback)`, `v1.7.5 (Desktop plugin)`).

**Body:**

````markdown
### Downloads

- `ctxline-claude-code-vX.Y.Z.zip` — statusline (same contents as the npm package)
- `ctxline-claude-desktop-v<plugin.json version>.zip` — Claude desktop plugin v<plugin.json version> (updates itself through the plugin marketplace; not versioned with this release)

## What's Changed

### ctxline-claude-code
* <user-facing bullet>

### ctxline-claude-desktop
* <user-facing bullet>

**Full Changelog**: https://github.com/MithunWijayasiri/ctxline-claude/compare/vPREV...vX.Y.Z
````

Rules:
- Bullets: plain words, user-visible effect first, no PR numbers, authors, or `feat(...)` prefixes. Name commands/labels in backticks.
- Drop internal-only changes (skills, tests, CI tweaks) unless users see them (new release assets, npm page, installer output).
- Split by what changed: `statusline.js`, installers, npm package/readme → `ctxline-claude-code`; `desktop/` → `ctxline-claude-desktop`. Release-wide changes (e.g. new release assets) → `ctxline-claude-code`. Nothing changed in a section → single bullet `No changes.`
- Statusline output unchanged (no visible diff in `statusline.js`/renders) and `ctxline-claude-code` has other bullets → end them with `Statusline itself is unchanged.` Never add it next to `No changes.`
- First desktop plugin release or new install path → include the install commands under `ctxline-claude-desktop`.

## 4. Apply to the release

Wait for the user to say the release is made.

1. `gh release view vX.Y.Z` — must exist; else stop and say so.
2. Read the live body. Keep `### Downloads` verbatim from it (generated from the actual run); replace everything from `## What's Changed` down with the drafted subsections + Full Changelog.
3. `gh release edit vX.Y.Z --title "<title>" --notes-file -` (heredoc).
4. Re-read the body once; report the release URL.
