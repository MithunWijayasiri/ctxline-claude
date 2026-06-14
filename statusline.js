#!/usr/bin/env node
// Claude Code Enhanced Statusline
// Shows: directory | model | context usage | current (5-hour) + weekly usage | current task
// Auto-detects API key vs subscription usage
// https://github.com/MithunWijayasiri/ctxline-claude

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const IS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// Shared width (cells) for all progress bars: context, current, weekly.
const BAR_WIDTH = 6;

// Max characters shown for the git branch; longer names are tail-truncated with "…".
// Tail-truncation keeps the start (ticket IDs like "TAMA5-32796" live there) visible.
const MAX_BRANCH_LEN = 24;

// Cache configuration
const CACHE_DIR = path.join(os.homedir(), '.claude', 'cache');
const USAGE_CACHE_FILE = path.join(CACHE_DIR, 'usage-cache.json');
// Fresh: trust the cache and skip the API call entirely (fewer calls, faster render).
const FRESH_TTL_MS = 30000;            // 30 seconds
// Stale: used only as a fallback when a live API call fails, so the usage bar stays
// visible through transient timeouts/errors instead of disappearing.
const STALE_TTL_MS = 10 * 60 * 1000;   // 10 minutes

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m',
  red: '\x1b[31m',
  purple: '\x1b[38;5;135m',
  blink: '\x1b[5m'
};

// Color for the thinking-effort indicator. Levels rank low < medium < high < xhigh < max
// < ultracode; only the top two are highlighted — "max" red, "ultracode" purple. Every
// other level (including xhigh) renders dim like the rest of the metadata.
function getEffortColor(level) {
  const lvl = String(level).toLowerCase();
  if (lvl === 'max') return colors.red;
  if (lvl === 'ultracode') return colors.purple;
  return colors.dim;
}

function getUsageColor(percentage) {
  if (percentage < 50) return colors.green;
  if (percentage < 75) return colors.yellow;
  if (percentage < 90) return colors.orange;
  return colors.red;
}

// Shorten verbose model names for the statusline: "Opus 4.8 (1M context)" -> "Opus 4.8 (1M)".
function shortenModel(name) {
  return name.replace(/\s+context\)/i, ')');
}

// Tail-truncate an over-long branch name, preserving the leading ticket ID.
function truncateBranch(name) {
  return name.length > MAX_BRANCH_LEN ? name.slice(0, MAX_BRANCH_LEN - 1) + '…' : name;
}

// Resolve the current git branch by reading .git/HEAD directly (no `git` subprocess —
// keeps the render fast and dependency-free). Walks up from `dir` to find the repo,
// handles worktrees (.git as a file) and detached HEAD (short sha). Best-effort: '' on any failure.
function getGitBranch(dir) {
  try {
    let cur = dir;
    let gitPath = '';
    for (let i = 0; i < 50 && cur; i++) {
      const candidate = path.join(cur, '.git');
      if (fs.existsSync(candidate)) { gitPath = candidate; break; }
      const parent = path.dirname(cur);
      if (parent === cur) break;        // reached filesystem root
      cur = parent;
    }
    if (!gitPath) return '';

    let gitDir = gitPath;
    if (fs.statSync(gitPath).isFile()) {
      // Worktree/submodule: ".git" is a file like "gitdir: /path/to/.git/worktrees/x".
      const m = fs.readFileSync(gitPath, 'utf8').match(/gitdir:\s*(.+)/);
      if (!m) return '';
      gitDir = path.resolve(path.dirname(gitPath), m[1].trim());
    }

    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (ref) return truncateBranch(ref[1]);
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);  // detached HEAD -> short sha
    return '';
  } catch (e) {
    return '';
  }
}

function getContextBar(remaining) {
  const effectiveRemaining = remaining ?? 100;
  const used = Math.max(0, Math.min(100, 100 - Math.round(effectiveRemaining)));

  const filled = Math.round((used / 100) * BAR_WIDTH);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(BAR_WIDTH - filled);

  // Context color: green <50 / yellow <65 / orange <80 / blink-red >=80.
  let color;
  if (used < 50) color = colors.green;
  else if (used < 65) color = colors.yellow;
  else if (used < 80) color = colors.orange;
  else color = colors.blink + colors.red;

  // Compact label form: "C<used> <bar>" (e.g. "C45 ███░░░"), colored as a whole.
  return `${color}C${used} ${bar}${colors.reset}`;
}

// Render a compact usage segment from raw data: "<label><pct> ↺ <countdown>"
// (e.g. "H81 ↺ 2h21m") — no bar. Called on every read (live or cached) so the reset
// countdown is always recomputed from resetsAt rather than frozen at fetch time.
function buildUsageBar(label, percentage, resetsAt) {
  let timeStr = '';
  if (resetsAt) {
    const diffMins = Math.max(0, Math.floor((new Date(resetsAt) - new Date()) / 60000));
    const days = Math.floor(diffMins / 1440);
    const hours = Math.floor((diffMins % 1440) / 60);
    const mins = diffMins % 60;
    if (days > 0) timeStr = `${days}d${hours}h`;
    else if (hours > 0) timeStr = `${hours}h${mins}m`;
    else timeStr = `${mins}m`;
  }

  const color = getUsageColor(percentage);
  const timePart = timeStr ? `${colors.dim} ↺ ${timeStr}${colors.reset}` : '';

  return `${color}${label}${percentage}${colors.reset}${timePart}`;
}

// Build both usage segments from raw entries. Each entry is { percentage, resetsAt } or
// null/absent. Returns { current, weekly } where each is a rendered segment string or null.
function buildUsageBars(fiveHour, weekly) {
  return {
    current: fiveHour ? buildUsageBar('H', fiveHour.percentage, fiveHour.resetsAt) : null,
    weekly: weekly ? buildUsageBar('W', weekly.percentage, weekly.resetsAt) : null
  };
}

// Normalize a raw API utilization into the 0-100 integer that the rest of the
// pipeline (cache validation + bar rendering) expects. Returns null when the value
// isn't a finite number, so callers can omit that bar instead of rendering "NaN%".
function normalizePercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Build usage bars from stdin `rate_limits` (Claude.ai Pro/Max, present only after the
// first API response of a session). Same data as the OAuth usage API, so reading it here
// skips the network/credentials/cache path entirely. `resets_at` is a Unix epoch in
// SECONDS (not ISO) — ×1000 before Date. Returns { current, weekly } bars, or null when
// rate_limits is absent or the required five_hour segment is unusable (caller falls back).
function buildUsageFromStdin(data) {
  const rl = data?.rate_limits;
  if (!rl) return null;

  const toEntry = (seg) => {
    if (!seg) return null;
    const pct = normalizePercentage(seg.used_percentage);
    if (pct == null) return null;
    // resets_at is a Unix epoch in SECONDS. Coerce + validate defensively: a non-numeric
    // or out-of-range value would make new Date(...).toISOString() throw, and this path
    // runs outside outputStatus's try/catch. Fall back to resetsAt: null on anything bad.
    let resetsAt = null;
    const epoch = Number(seg.resets_at);
    if (Number.isFinite(epoch) && epoch > 0) {
      const d = new Date(epoch * 1000);
      if (!Number.isNaN(d.getTime())) resetsAt = d.toISOString();
    }
    return { percentage: pct, resetsAt };
  };

  const fiveHour = toEntry(rl.five_hour);
  if (!fiveHour) return null;          // five_hour is the required bar
  const weekly = toEntry(rl.seven_day);
  return buildUsageBars(fiveHour, weekly);
}

// Validate a single usage entry ({ percentage, resetsAt }). Returns true only for a
// finite 0-100 percentage and a parseable (or absent) resetsAt.
function isValidUsageEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!Number.isFinite(entry.percentage) || entry.percentage < 0 || entry.percentage > 100) return false;
  if (entry.resetsAt != null && Number.isNaN(new Date(entry.resetsAt).getTime())) return false;
  return true;
}

// Read the raw cached usage data
// ({ timestamp, data: { fiveHour: {percentage,resetsAt}, weekly: {...}|null } }).
// Returns { age, data } or null. Age-vs-TTL decisions are made by the caller.
function readCachedUsage() {
  try {
    if (!fs.existsSync(USAGE_CACHE_FILE)) return null;

    const cache = JSON.parse(fs.readFileSync(USAGE_CACHE_FILE, 'utf8'));
    if (!cache || !Number.isFinite(cache.timestamp) || cache.timestamp <= 0) return null;

    // Validate data. fiveHour is required; weekly is optional (the API may omit it).
    // This also rejects the legacy single-{percentage,resetsAt} format from older
    // versions, which had no fiveHour key, so stale caches are ignored on read.
    const data = cache.data;
    if (!data || typeof data !== 'object') return null;
    if (!isValidUsageEntry(data.fiveHour)) return null;
    if (data.weekly != null && !isValidUsageEntry(data.weekly)) return null;

    return { age: Date.now() - cache.timestamp, data };
  } catch (e) {
    return null;
  }
}

// Write usage data to cache (shared across all sessions)
function setCachedUsage(data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cache = {
      timestamp: Date.now(),
      data: data
    };

    fs.writeFileSync(USAGE_CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch (e) {
    // Silently fail
  }
}

function getCredentials() {
  // Try file first (legacy / Linux / Windows)
  const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
  if (fs.existsSync(credsPath)) {
    try {
      return JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    } catch (e) {}
  }

  // Fallback: macOS keychain
  if (os.platform() === 'darwin') {
    try {
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null', { encoding: 'utf8', timeout: 1000 });
      return JSON.parse(raw.trim());
    } catch (e) {}
  }

  return null;
}

function getApiUsage(callback) {
  try {
    // Read credentials (file or macOS keychain)
    const creds = getCredentials();
    if (!creds) {
      return callback(null);
    }

    const accessToken = creds.claudeAiOauth?.accessToken;

    if (!accessToken) {
      return callback(null);
    }

    // Adaptive timeout: if cache exists, be faster (1200ms); if not, be patient (1500ms)
    // API typically takes ~850ms, so 1200ms gives reasonable headroom
    const hasCache = fs.existsSync(USAGE_CACHE_FILE);
    const timeout = hasCache ? 1200 : 1500;

    // Make API call with adaptive timeout
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20'
      },
      timeout: timeout
    }, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const usage = JSON.parse(data);

          // 5-hour session usage is required; weekly (seven_day) is rendered when present.
          // Normalize utilization first so a missing/non-finite value omits the bar
          // instead of rendering "NaN%" or an out-of-range percentage.
          const fivePct = usage.five_hour ? normalizePercentage(usage.five_hour.utilization) : null;
          if (fivePct != null) {
            const fiveHour = {
              percentage: fivePct,
              resetsAt: usage.five_hour.resets_at || null
            };
            const weeklyPct = usage.seven_day ? normalizePercentage(usage.seven_day.utilization) : null;
            const weekly = weeklyPct != null ? {
              percentage: weeklyPct,
              resetsAt: usage.seven_day.resets_at || null
            } : null;

            // Cache the raw data (shared across sessions); render the bars from it.
            setCachedUsage({ fiveHour, weekly });
            callback(buildUsageBars(fiveHour, weekly));
          } else {
            callback(null);
          }
        } catch (e) {
          callback(null);
        }
      });
    });

    req.on('error', () => callback(null));
    req.on('timeout', () => {
      req.destroy();
      callback(null);
    });

    req.end();
  } catch (e) {
    callback(null);
  }
}

// Get usage, cache-first.
function getUsageWithCache(callback) {
  const cached = readCachedUsage();

  // Cache is fresh -> render it and skip the API entirely (fewer calls, faster).
  if (cached && cached.age < FRESH_TTL_MS) {
    return callback(buildUsageBars(cached.data.fiveHour, cached.data.weekly));
  }

  // Cache is stale or missing -> refresh from the API.
  getApiUsage((freshBars) => {
    if (freshBars) {
      callback(freshBars);
    } else if (cached && cached.age < STALE_TTL_MS) {
      // API failed/timed out, but recent cache exists -> show it instead of nothing.
      callback(buildUsageBars(cached.data.fiveHour, cached.data.weekly));
    } else {
      callback(null);
    }
  });
}

function getCurrentTask(sessionId) {
  if (!sessionId) return '';

  const homeDir = os.homedir();
  const todosDir = path.join(homeDir, '.claude', 'todos');

  if (!fs.existsSync(todosDir)) return '';

  try {
    const files = fs.readdirSync(todosDir)
      .filter(f => f.startsWith(sessionId) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
      const inProgress = todos.find(t => t.status === 'in_progress');
      if (inProgress) return inProgress.activeForm || '';
    }
  } catch (e) {}

  return '';
}

// Main
function outputStatus(data, usage) {
  try {
    const model = shortenModel(data?.model?.display_name || 'Claude');
    const dir = data?.workspace?.current_dir || process.cwd();
    const dirname = path.basename(dir);
    const branch = getGitBranch(dir);
    const effort = data?.effort?.level || '';
    const sessionId = data?.session_id || '';
    const remaining = data?.context_window?.remaining_percentage;

    const contextBar = getContextBar(remaining);
    const task = getCurrentTask(sessionId);
    const parts = [];
    parts.push(branch ? `${dirname} ${colors.dim}⎇ ${branch}${colors.reset}` : dirname);
    parts.push(effort ? `${model}${getEffortColor(effort)} · ${effort}${colors.reset}` : model);
    parts.push(contextBar);

    if (usage?.current) parts.push(usage.current);
    if (usage?.weekly) parts.push(usage.weekly);

    if (task) parts.push(`${colors.dim}${task}${colors.reset}`);
    process.stdout.write(parts.join(' \u2502 '));
  } catch (e) {
    process.stdout.write('Status unavailable');
  }
}

function outputFallback(usage) {
  const contextBar = getContextBar(undefined);
  const parts = ['~', 'Claude', contextBar];
  if (usage?.current) parts.push(usage.current);
  if (usage?.weekly) parts.push(usage.weekly);
  process.stdout.write(parts.join(' \u2502 '));
}

// Resolve usage bars for a (possibly null) parsed stdin payload.
// Order: API-key users get none; otherwise prefer stdin `rate_limits` (no network),
// then fall back to the cache+API flow when stdin lacks it (cold start / non-Pro/Max).
function resolveUsage(data, callback) {
  if (IS_API_KEY) {
    return callback(null);
  }
  const fromStdin = buildUsageFromStdin(data);
  if (fromStdin) {
    return callback(fromStdin);
  }
  getUsageWithCache(callback);
}

// Process with timeout
// Parse the accumulated stdin into a payload object, or null if empty/unparseable.
function parseInput(input) {
  if (!input || input.length === 0) return null;
  try {
    return JSON.parse(input);
  } catch (e) {
    return null;
  }
}

// Resolve usage for `data` (preferring stdin rate_limits), then render and exit.
function emit(data) {
  resolveUsage(data, (usage) => {
    if (data) {
      outputStatus(data, usage);
    } else {
      outputFallback(usage);
    }
    process.exit(0);
  });
}

if (process.stdin.isTTY) {
  emit(null);
} else {
  let input = '';
  let timeoutReached = false;

  const overallTimeout = IS_API_KEY ? 500 : (fs.existsSync(USAGE_CACHE_FILE) ? 1300 : 1600);

  const timeout = setTimeout(() => {
    timeoutReached = true;
    emit(parseInput(input));
  }, overallTimeout);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    if (timeoutReached) return;
    clearTimeout(timeout);
    emit(parseInput(input));
  });
}
