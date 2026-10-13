<p align="center">
  <img src="https://raw.githubusercontent.com/MithunWijayasiri/ctxline-claude/main/docs/assets/apple-touch-icon.png" width="64" height="64" alt="">
</p>

<h1 align="center">Claude Code Statusline</h1>

<p align="center">
  A lightweight, zero-config statusline for Claude Code.
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/MithunWijayasiri/ctxline-claude/main/docs/assets/preview.svg" alt="Claude Code Statusline">
</p>

Shows your directory, git branch, model, context window, 5-hour and weekly usage limits, and session cost in one line under the Claude Code prompt.

## Install

```bash
npx ctxline-claude     # or: bunx ctxline-claude
```

Restart Claude Code or start a new session.

<details>
<summary>Other install methods</summary>

Clone and run the installer:

```bash
git clone https://github.com/MithunWijayasiri/ctxline-claude.git
cd ctxline-claude
./install.sh      # macOS / Linux
./install.ps1     # Windows (PowerShell)
```

Or install by hand. Download the script:

```bash
mkdir -p ~/.claude/hooks
curl -o ~/.claude/hooks/statusline.js https://raw.githubusercontent.com/MithunWijayasiri/ctxline-claude/main/statusline.js
chmod +x ~/.claude/hooks/statusline.js
```

Then add both entries to `~/.claude/settings.json`. The second one draws a row per running subagent in the agent panel.

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/hooks/statusline.js"
  },
  "subagentStatusLine": {
    "type": "command",
    "command": "node ~/.claude/hooks/statusline.js subagent"
  }
}
```

</details>

## What it shows

| Segment | Detail |
|---|---|
| Directory | Current working directory |
| Branch | Git branch, plus `↑N↓M` commits ahead / behind upstream |
| Model | Active model and effort level |
| `C` Context | Bar of context window used |
| `H` 5-hour | 5-hour usage limit and reset countdown |
| `W` Weekly | Weekly usage limit and reset countdown |
| Model limit | Weekly limit for one model, if your account has one, labeled by the model's initial (`F` = Fable) |
| `$` Cost | Session cost in USD |
| Task | The in-progress todo |

Segments past model and context appear only when there is data for them. Usage limits show for Pro/Max subscriptions only. Bars change color as you near a limit. On a narrow terminal the line wraps to two (needs Claude Code v2.1.153+).

## Configuration

To hide segments, set `CTXLINE_DISABLE` to a comma-separated list of:

| Name | Hides |
|---|---|
| `branch` | Branch and ahead / behind |
| `effort` | Effort level |
| `cost` | Session cost |
| `task` | Current task |
| `usage` | 5-hour, weekly, and model limits |
| `autoupdate` | Auto-update. You get an upgrade notice instead |
| `update` | Auto-update and the upgrade notice |

Directory, model, and context always show.

Set it in `~/.claude/settings.json` so it works on every OS:

```json
{
  "env": {
    "CTXLINE_DISABLE": "cost,task"
  }
}
```

Or export it in your shell before running `claude`. Restart Claude Code to apply either one.

## Update

ctxline updates itself. Every 3 days a background process checks npm. When a newer release is out, it downloads it from GitHub and swaps it in. The statusline then shows `⬆ ctxline updated <old> → <new>` for 5 seconds.

To update by hand:

```bash
npx ctxline-claude@latest
```

## Uninstall

```bash
npx ctxline-claude uninstall
```

This removes the `statusLine` and `subagentStatusLine` entries from `settings.json` (after a backup), deletes the script, and clears the cache. It leaves other statuslines alone.

<details>
<summary>Manual uninstall</summary>

Remove the `statusLine` and `subagentStatusLine` blocks from `~/.claude/settings.json`. The installer left a backup at `settings.json.backup.<n>`. Then delete the script:

```bash
# macOS / Linux
rm ~/.claude/hooks/statusline.js
rm -f ~/.claude/cache/usage-cache.json
```

```powershell
# Windows (PowerShell)
Remove-Item "$env:USERPROFILE\.claude\hooks\statusline.js"
Remove-Item "$env:USERPROFILE\.claude\cache\usage-cache.json" -ErrorAction SilentlyContinue
```

</details>

## FAQ

<details>
<summary>Does it use tokens?</summary>

No. Claude Code draws the statusline in your terminal and never sends it to the model.

</details>

<details>
<summary>Does it slow Claude Code down?</summary>

No. Most renders read a local cache. Usage comes from the session data Claude Code passes in, and the usage API is called only when that is missing, at most once every 30 seconds. The git check runs at most every 5 seconds and has a time limit. If anything fails, the line still prints.

</details>

<details>
<summary>Is the cost my actual bill?</summary>

No, if you're on Pro or Max. It's what the session would cost at API prices, as Claude Code computes it. API-key users pay this amount.

</details>

<details>
<summary>What does it send over the network?</summary>

- **Usage.** Only when the session data has no usage numbers, it calls Anthropic's usage API (the one `/usage` uses) with your local OAuth token. It caches only the percentages, never the token. API-key users skip this.
- **Updates.** Every 3 days it asks the npm registry for the latest version number. When it installs an update, it downloads the script from GitHub. Neither request carries session data or credentials. `CTXLINE_DISABLE=update` turns both off.

</details>

## Links

- [GitHub repository](https://github.com/MithunWijayasiri/ctxline-claude)
- [Claude desktop app plugin](https://github.com/MithunWijayasiri/ctxline-claude#claude-desktop-app)
- [Support on Ko-fi](https://ko-fi.com/mithunwijayasiri)

## License

MIT
