#!/bin/bash
# Claude Code Enhanced Statusline - Installation Script

set -e

HOOKS_DIR="$HOME/.claude/hooks"
SETTINGS_FILE="$HOME/.claude/settings.json"
REPO_URL="https://raw.githubusercontent.com/MithunWijayasiri/ctxline-claude/main"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "======================================"
echo "  Claude Code Statusline Installer"
echo "======================================"
echo ""

# Check if Claude Code is installed
if [ ! -d "$HOME/.claude" ]; then
    echo -e "${RED}Error: Claude Code not found!${NC}"
    echo "Please install Claude Code first: https://github.com/anthropics/claude-code"
    exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$HOOKS_DIR"

SCRIPT_NAME="statusline.js"

# Download the script
echo ""
echo -e "${YELLOW}Downloading statusline...${NC}"

if command -v curl &> /dev/null; then
    curl -fsSL "$REPO_URL/$SCRIPT_NAME" -o "$HOOKS_DIR/$SCRIPT_NAME"
elif command -v wget &> /dev/null; then
    wget -q "$REPO_URL/$SCRIPT_NAME" -O "$HOOKS_DIR/$SCRIPT_NAME"
else
    echo -e "${RED}Error: Neither curl nor wget found. Please install one of them.${NC}"
    exit 1
fi

# Make executable
chmod +x "$HOOKS_DIR/$SCRIPT_NAME"

echo -e "${GREEN}✓ Downloaded and installed $SCRIPT_NAME${NC}"

# Update settings.json
echo ""
echo -e "${YELLOW}Updating Claude Code settings...${NC}"

# Backup existing settings
if [ -f "$SETTINGS_FILE" ]; then
    cp "$SETTINGS_FILE" "$SETTINGS_FILE.backup.$(date +%s)"
    echo -e "${GREEN}✓ Backed up existing settings${NC}"
fi

# Check if settings.json exists
if [ ! -f "$SETTINGS_FILE" ]; then
    # Create new settings file
    cat > "$SETTINGS_FILE" << EOF
{
  "statusLine": {
    "type": "command",
    "command": "node $HOOKS_DIR/$SCRIPT_NAME"
  },
  "subagentStatusLine": {
    "type": "command",
    "command": "node $HOOKS_DIR/$SCRIPT_NAME subagent"
  }
}
EOF
    echo -e "${GREEN}✓ Created new settings.json${NC}"
else
    # Update existing settings.json using node
    node << EOF
const fs = require('fs');
const path = require('path');

const settingsPath = path.join(process.env.HOME, '.claude', 'settings.json');
let settings = {};

try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch (e) {
    // File doesn't exist or is invalid JSON
}

settings.statusLine = {
    type: 'command',
    command: 'node $HOOKS_DIR/$SCRIPT_NAME'
};

settings.subagentStatusLine = {
    type: 'command',
    command: 'node $HOOKS_DIR/$SCRIPT_NAME subagent'
};

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log('Settings updated successfully');
EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Updated settings.json${NC}"
    else
        echo -e "${RED}✗ Failed to update settings.json automatically${NC}"
        echo ""
        echo "Please manually add this to $SETTINGS_FILE:"
        echo ""
        echo '  "statusLine": {'
        echo '    "type": "command",'
        echo "    \"command\": \"node $HOOKS_DIR/$SCRIPT_NAME\""
        echo '  },'
        echo '  "subagentStatusLine": {'
        echo '    "type": "command",'
        echo "    \"command\": \"node $HOOKS_DIR/$SCRIPT_NAME subagent\""
        echo '  }'
    fi
fi

# Success message
echo ""
echo -e "${GREEN}======================================"
echo "  Installation Complete! ✓"
echo "======================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code or start a new session"
echo "  2. Your statusline should now be active!"
echo ""
echo "To uninstall:"
echo "  - Remove ~/.claude/hooks/$SCRIPT_NAME"
echo "  - Remove the 'statusLine' and 'subagentStatusLine' sections from ~/.claude/settings.json"
echo ""
echo "For help, visit: https://github.com/MithunWijayasiri/ctxline-claude"
echo ""
