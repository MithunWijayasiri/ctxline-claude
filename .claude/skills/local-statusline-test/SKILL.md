---
name: local-statusline-test
description: Point Claude Code's statusLine/subagentStatusLine at this repo's working-tree statusline.js for live local testing, then revert to the installed hook. Use when a contributor wants to try statusline.js changes in the real Claude Code UI before raising a PR — no npm/install/publish needed.
---

# Local statusline test

Test working-tree `statusline.js` live in Claude Code — no npm, no install. Only ever edits the contributor's own `~/.claude/settings.json`; nothing in this repo changes.

## 1. Point Claude Code at the working tree

Claude Code will execute the checked-out branch's `statusline.js` on every render, with session JSON on its stdin — only point it at a branch you trust.

Config file: `~/.claude/settings.json` (Windows: `$env:USERPROFILE\.claude\settings.json`).

Before editing, save whether the file exists at all, and both `statusLine`/`subagentStatusLine` values whole — every field, plus whether each key exists — needed to revert in step 4 (normally the installed hook, e.g. `node "~/.claude/hooks/statusline.js"`).

Change only `command`, to this repo's absolute path, quoted (unquoted breaks on a home dir with spaces), keeping the `subagent` arg on the second and any other fields (`padding` etc.) untouched. Forward slashes on Windows — `C:/Github/ctxline-claude`, not `C:\Github\...`, whose `\G` is an invalid JSON escape:

```json
"statusLine": { "type": "command", "command": "node \"<repo-abs-path>/statusline.js\"" },
"subagentStatusLine": { "type": "command", "command": "node \"<repo-abs-path>/statusline.js\" subagent" }
```

Tell the contributor to restart Claude Code — `settings.json` is read at startup only. After restart, further `statusline.js` edits render live, no more restarts needed.

## 2. Test

- Statusline re-renders on activity (a message/response), not on terminal resize alone. Resize, then send a message → narrow wraps usage/cost/task to line 2; wide → single line.
- Subagent rows: launch 1-2 background subagents and check the panel.

## 3. Calibrate WIDTH_MARGIN

`statusline.js` — search `WIDTH_MARGIN`, default `0`.

- Wraps right at the edge → leave `0`.
- Truncates a char or two before wrapping (Claude Code reserves edge columns) → bump to `2`-`4`.

## 4. Revert

Put back step 1's saved values exactly — all fields, and delete any key that wasn't there before. If step 1 had to create `settings.json`, delete the file once the two keys are gone. Restart Claude Code to pick it up.

## Notes

- Whichever branch is checked out in this repo is what renders — keep the branch under test checked out for the session.
- Re-running the installer (`npx ctxline-claude`) overwrites the installed hook with `main`'s `statusline.js` — unrelated to this workflow, doesn't touch step 1's path-pointing.
