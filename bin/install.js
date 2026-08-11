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
const reset = '\x1b[0m';

// Uninstall mode: `npx ctxline-claude uninstall` (additive — plain install is unchanged)
const mode = (process.argv[2] || '').toLowerCase();
if (mode === 'uninstall' || mode === 'remove') {
  runUninstall();
  process.exit(0);
}

console.log(`${cyan}======================================${reset}`);
console.log(`${cyan}  Claude Code Statusline Installer${reset}`);
console.log(`${cyan}======================================${reset}\n`);

// Check Claude Code is installed
if (!fs.existsSync(claudeDir)) {
  console.log(`${red}Error: Claude Code not found!${reset}`);
  console.log('Please install Claude Code first: https://github.com/anthropics/claude-code');
  process.exit(1);
}

// Create hooks directory
if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

// Copy statusline script
console.log(`${yellow}Installing statusline...${reset}`);
fs.copyFileSync(scriptSrc, scriptDest);
fs.chmodSync(scriptDest, 0o755);
console.log(`${green}✓ Installed statusline.js${reset}`);

// Update settings.json
console.log(`${yellow}Updating settings...${reset}`);

let settings = {};
if (fs.existsSync(settingsFile)) {
  // Backup existing settings
  const backup = `${settingsFile}.backup.${Date.now()}`;
  fs.copyFileSync(settingsFile, backup);
  console.log(`${green}✓ Backed up existing settings${reset}`);

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

fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
console.log(`${green}✓ Updated settings.json${reset}`);

console.log(`\n${green}======================================${reset}`);
console.log(`${green}  Installation Complete!${reset}`);
console.log(`${green}======================================${reset}`);
console.log('\nRestart Claude Code or start a new session.');
console.log('The statusline will auto-detect your setup (subscription vs API key).\n');

function runUninstall() {
  console.log(`${cyan}======================================${reset}`);
  console.log(`${cyan}  Claude Code Statusline Uninstaller${reset}`);
  console.log(`${cyan}======================================${reset}\n`);

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
