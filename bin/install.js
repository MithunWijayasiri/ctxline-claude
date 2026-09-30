#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeDir = path.join(os.homedir(), '.claude');
const hooksDir = path.join(claudeDir, 'hooks');
const settingsFile = path.join(claudeDir, 'settings.json');
const scriptDest = path.join(hooksDir, 'statusline.js');
const scriptSrc = path.join(__dirname, '..', 'statusline.js');

const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const logo = '\x1b[38;5;173m█\x1b[0m \x1b[38;5;239m█\x1b[0m';

const { VERSION: version, compareVersions } = require('../statusline.js');
const repoUrl = 'https://github.com/MithunWijayasiri/ctxline-claude';
const displayPath = (p) => p.replace(os.homedir(), '~').replace(/\\/g, '/');

// Uninstall mode: `npx ctxline-claude uninstall` (additive — plain install is unchanged)
const mode = (process.argv[2] || '').toLowerCase();
if (mode === 'uninstall' || mode === 'remove') {
  runUninstall();
  process.exit(0);
}

console.log(`${logo} ${cyan}ctxline${reset} v${version} ${dim}· statusline for Claude Code${reset}\n`);

function fail(message, hint) {
  console.log(`  ${red}✗ ${message}${reset}`);
  if (hint) console.log(`    ${dim}${hint}${reset}`);
  console.log(`\n${red}Install failed.${reset} Stuck? ${cyan}${repoUrl}/issues${reset}\n`);
  process.exit(1);
}

if (!fs.existsSync(claudeDir)) {
  fail('Claude Code not found (~/.claude missing)', 'Install Claude Code first: https://github.com/anthropics/claude-code');
}

// null = fresh install; '' = hook predates the VERSION constant
let previousVersion = null;
if (fs.existsSync(scriptDest)) {
  const match = fs.readFileSync(scriptDest, 'utf8').match(/const VERSION = '([^']+)'/);
  previousVersion = match ? match[1] : '';
}

// npx can serve a stale cached copy — never overwrite a newer hook with it
if (previousVersion && compareVersions(version, previousVersion) === -1) {
  console.log(`  ${yellow}! v${previousVersion} is already installed — this copy is older (v${version})${reset}`);
  console.log(`\nNothing changed. Get the latest: ${cyan}npx ctxline-claude@latest${reset}\n`);
  process.exit(0);
}

try {
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(scriptSrc, scriptDest);
  fs.chmodSync(scriptDest, 0o755);
} catch (e) {
  fail(`Could not write ${displayPath(scriptDest)}`, e.message);
}
console.log(`  ${green}✓${reset} Installed  ${displayPath(scriptDest)}`);

let settings = {};
let backupNote = '';
if (fs.existsSync(settingsFile)) {
  const backup = `${settingsFile}.backup.${Date.now()}`;
  try {
    fs.copyFileSync(settingsFile, backup);
  } catch (e) {
    fail(`Could not back up ${displayPath(settingsFile)}`, e.message);
  }
  backupNote = ` ${dim}(backup: ${path.basename(backup)})${reset}`;

  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (e) {
    settings = {};
  }
}

// Path is quoted — the command runs through a shell, so an unquoted home dir with spaces would split.
const commandPath = scriptDest.replace(/\\/g, '/');

settings.statusLine = {
  type: 'command',
  command: `node "${commandPath}"`
};

settings.subagentStatusLine = {
  type: 'command',
  command: `node "${commandPath}" subagent`
};

try {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
} catch (e) {
  fail(`Could not write ${displayPath(settingsFile)}`, e.message);
}
console.log(`  ${green}✓${reset} Settings   statusLine + subagentStatusLine${backupNote}`);

if (previousVersion === version) {
  console.log(`\n  Already up to date (v${version})`);
} else if (previousVersion !== null) {
  console.log(`\n  ${green}Updated ${previousVersion ? `v${previousVersion} → ` : 'to '}v${version}${reset}`);
  console.log(`  What's new → ${cyan}${repoUrl}/releases/tag/v${version}${reset}`);
}

console.log('\nRestart Claude Code or start a new session.\n');

function runUninstall() {
  console.log(`${logo} ${cyan}ctxline${reset} v${version} ${dim}· uninstall${reset}\n`);

  if (!fs.existsSync(claudeDir)) {
    console.log(`${yellow}Nothing to remove — ~/.claude was not found.${reset}\n`);
    return;
  }

  // 1. Remove our statusLine/subagentStatusLine entries from settings.json (preserving everything else)
  if (fs.existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      const command = ((settings.statusLine && settings.statusLine.command) || '').replace(/\\/g, '/');
      const subagentCommand = ((settings.subagentStatusLine && settings.subagentStatusLine.command) || '').replace(/\\/g, '/');
      // Match our hook path only (covers absolute + manual `~` installs), not any statusline.js.
      const isOurs = command.includes('/.claude/hooks/statusline.js');
      const isSubagentOurs = subagentCommand.includes('/.claude/hooks/statusline.js');
      let changed = false;
      if (settings.statusLine && isOurs) {
        delete settings.statusLine;
        changed = true;
      } else if (settings.statusLine) {
        console.log(`${yellow}! settings.json has a different statusLine — leaving it untouched.${reset}`);
      } else {
        console.log(`${green}✓ No statusLine entry in settings.json${reset}`);
      }
      if (settings.subagentStatusLine && isSubagentOurs) {
        delete settings.subagentStatusLine;
        changed = true;
      } else if (settings.subagentStatusLine) {
        console.log(`${yellow}! settings.json has a different subagentStatusLine — leaving it untouched.${reset}`);
      }
      if (changed) {
        const backup = `${settingsFile}.backup.${Date.now()}`;
        fs.copyFileSync(settingsFile, backup);
        fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
        console.log(`${green}✓ Removed statusLine/subagentStatusLine from settings.json (backup: ${path.basename(backup)})${reset}`);
      }
    } catch (e) {
      console.log(`${red}✗ Could not parse settings.json — remove the "statusLine"/"subagentStatusLine" blocks manually.${reset}`);
    }
  }

  // 2. Delete the hook script
  if (fs.existsSync(scriptDest)) {
    try {
      fs.unlinkSync(scriptDest);
      console.log(`${green}✓ Deleted ${scriptDest}${reset}`);
    } catch (e) {
      console.log(`${red}✗ Could not delete ${scriptDest}: ${e.message}${reset}`);
      console.log(`${yellow}  Remove it manually.${reset}`);
    }
  } else {
    console.log(`${green}✓ No statusline.js found in hooks${reset}`);
  }

  // 3. Clear cached usage data (best-effort)
  const cacheFile = path.join(claudeDir, 'cache', 'usage-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      fs.unlinkSync(cacheFile);
      console.log(`${green}✓ Cleared usage cache${reset}`);
    } catch (e) {}
  }

  console.log(`\n${green}Uninstall complete.${reset} Restart Claude Code or start a new session.\n`);
}
