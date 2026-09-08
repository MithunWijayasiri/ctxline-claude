#!/usr/bin/env node
// Claude Code statusline: dir │ model │ context │ usage │ cost │ task
// https://github.com/MithunWijayasiri/ctxline-claude

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync, execFileSync, spawn } = require('child_process');

// Lives here, not package.json: this file ships standalone to ~/.claude/hooks/. Must match package.json.
const VERSION = '1.7.0';

const IS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// Segment opt-out: comma list. Recognized: branch, effort, cost, task, update, usage.
// Disabling skips the work, not just the output; dir/model/context always render.
const DISABLED = new Set(
  (process.env.CTXLINE_DISABLE || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

// Context bar width in cells.
const BAR_WIDTH = 6;

// Branch names tail-truncated to this with "…", keeping leading ticket IDs visible.
const MAX_BRANCH_LEN = 24;

const SEGMENT_SEP = ' │ ';

// Cells reserved at the terminal edge when deciding to wrap; 0 = full width.
const WIDTH_MARGIN = 0;

// Cache configuration
const CACHE_DIR = path.join(os.homedir(), '.claude', 'cache');
const USAGE_CACHE_FILE = path.join(CACHE_DIR, 'usage-cache.json');
const FRESH_TTL_MS = 30000;            // fresh: render cache, skip API
const STALE_TTL_MS = 10 * 60 * 1000;   // stale: fallback only when a live call fails

// Single-entry ahead/behind cache: throttles the one git subprocess to once per render burst.
const GIT_CACHE_FILE = path.join(CACHE_DIR, 'git-cache.json');
const GIT_FRESH_TTL_MS = 5000;          // 5s: reuse counts within a render burst
const GIT_STALE_TTL_MS = 60000;         // 60s: fall back to last counts if git fails
const GIT_TIMEOUT_MS = 500;             // hard cap on the rev-list subprocess (warm ~130ms)

// Update check: render only reads this cache; the registry fetch runs in a detached child.
const UPDATE_CACHE_FILE = path.join(CACHE_DIR, 'update-cache.json');
const UPDATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days between successful checks
const UPDATE_RETRY_MS = 60 * 60 * 1000;         // 1h backoff after a failed/killed check
const UPDATE_TIMEOUT_MS = 2000;                 // socket idle AND whole-request deadline
const REGISTRY_HOST = 'registry.npmjs.org';
const PACKAGE_NAME = 'ctxline-claude';
const SEMVER_RE = /^\d+\.\d+\.\d+$/;       // releases only: a prerelease never nudges

// Subagent mode reads only stdin (no fetch to race), so its read gets its own short cap.
const SUBAGENT_TIMEOUT_MS = 500;

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

// Levels rank low<medium<high<xhigh<max<ultracode; only max (red) and ultracode (purple) stand out.
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

// Flat orange keeps several scoped bars readable as one group; >=90 red flags a nearly-spent cap.
function getScopedColor(percentage) {
  return percentage >= 90 ? colors.red : colors.orange;
}

// Shorten verbose model names for the statusline: "Opus 4.8 (1M context)" -> "Opus 4.8 (1M)".
function shortenModel(name) {
  return name.replace(/\s+context\)/i, ')');
}

// Resolved model ID -> "Opus 5" / "Haiku 4.5" (strips prefixes + trailing -YYYYMMDD).
function shortenModelId(id) {
  if (!id) return '';
  const stripped = String(id).replace(/^(us\.)?(anthropic\.)?claude-/, '').replace(/-\d{8}$/, '');
  const [family, ...rest] = stripped.split('-');
  if (!family) return stripped;
  const name = family[0].toUpperCase() + family.slice(1);
  const version = rest.join('.');
  return version ? `${name} ${version}` : name;
}

// Tail-truncate an over-long branch name, preserving the leading ticket ID.
function truncateBranch(name) {
  return name.length > MAX_BRANCH_LEN ? name.slice(0, MAX_BRANCH_LEN - 1) + '…' : name;
}

// Walks up from `dir` to the git dir (no subprocess); handles worktrees (".git" file). '' on failure.
function resolveGitDir(dir) {
  let cur = dir;
  let gitPath = '';
  for (let i = 0; i < 50 && cur; i++) {
    const candidate = path.join(cur, '.git');
    if (fs.existsSync(candidate)) { gitPath = candidate; break; }
    const parent = path.dirname(cur);
    if (parent === cur) break;          // reached filesystem root
    cur = parent;
  }
  if (!gitPath) return '';

  if (fs.statSync(gitPath).isFile()) {
    // ".git" is a file like "gitdir: /path/to/.git/worktrees/x".
    const m = fs.readFileSync(gitPath, 'utf8').match(/gitdir:\s*(.+)/);
    if (!m) return '';
    return path.resolve(path.dirname(gitPath), m[1].trim());
  }
  return gitPath;
}

// Branch read straight from .git/HEAD (no subprocess); detached HEAD -> short sha; '' on failure.
function getGitBranch(dir) {
  try {
    const gitDir = resolveGitDir(dir);
    if (!gitDir) return '';
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    // HEAD is read raw, not git-validated: strip control chars (escape-sequence injection).
    if (ref) return truncateBranch(ref[1].replace(/[\x00-\x1f\x7f]/g, ''));
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);  // detached HEAD -> short sha
    return '';
  } catch (e) {
    return '';
  }
}

// Cached ahead/behind for gitDir; different repo invalidates. { age, ahead, behind } or null.
function readGitCache(gitDir) {
  try {
    const c = JSON.parse(fs.readFileSync(GIT_CACHE_FILE, 'utf8'));
    if (!c || c.gitDir !== gitDir || !Number.isFinite(c.timestamp)) return null;
    if (!Number.isFinite(c.ahead) || !Number.isFinite(c.behind)) return null;
    return { age: Date.now() - c.timestamp, ahead: c.ahead, behind: c.behind };
  } catch (e) {
    return null;
  }
}

function writeGitCache(gitDir, ahead, behind) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(GIT_CACHE_FILE, JSON.stringify({ gitDir, timestamp: Date.now(), ahead, behind }), 'utf8');
  } catch (e) {}
}

// The only `git` subprocess, cache-fronted. null on no upstream/detached/failed (segment omitted);
// slow/failed call falls back to last counts up to GIT_STALE_TTL_MS so counts don't flicker.
function getGitAheadBehind(dir) {
  const gitDir = resolveGitDir(dir);
  if (!gitDir) return null;

  const cached = readGitCache(gitDir);
  if (cached && cached.age < GIT_FRESH_TTL_MS) {
    return { ahead: cached.ahead, behind: cached.behind };
  }

  try {
    // No shell (faster cold spawn, @{u} literal); --left-right --count prints "<behind>\t<ahead>".
    const out = execFileSync('git', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], {
      cwd: dir, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const parts = out.split(/\s+/);
    const behind = parseInt(parts[0], 10);
    const ahead = parseInt(parts[1], 10);
    if (Number.isFinite(ahead) && Number.isFinite(behind)) {
      writeGitCache(gitDir, ahead, behind);
      return { ahead, behind };
    }
    return null;
  } catch (e) {
    if (cached && cached.age < GIT_STALE_TTL_MS) {
      return { ahead: cached.ahead, behind: cached.behind };
    }
    return null;
  }
}

// "↑N↓M": ahead green, behind red, zero side omitted; '' when in sync or null.
function formatAheadBehind(ab) {
  if (!ab) return '';
  let s = '';
  if (ab.ahead) s += `${colors.green}↑${ab.ahead}${colors.reset}`;
  if (ab.behind) s += `${colors.red}↓${ab.behind}${colors.reset}`;
  return s;
}

// Colored "C<used> <bar>" (e.g. "C45 ███░░░"); shared by main line and subagent rows.
function renderContextBar(used) {
  const filled = Math.round((used / 100) * BAR_WIDTH);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(BAR_WIDTH - filled);

  let color;
  if (used < 50) color = colors.green;
  else if (used < 65) color = colors.yellow;
  else if (used < 80) color = colors.orange;
  else color = colors.blink + colors.red;

  return `${color}C${used} ${bar}${colors.reset}`;
}

function getContextBar(remaining) {
  const effectiveRemaining = remaining ?? 100;
  const used = Math.max(0, Math.min(100, 100 - Math.round(effectiveRemaining)));
  return renderContextBar(used);
}

// "model" or "model · effort" (colored). Shared by the main line and subagent rows.
function renderModelEffort(model, effort) {
  return effort ? `${model}${getEffortColor(effort)} · ${effort}${colors.reset}` : model;
}

// "<label><pct> ↺ <countdown>" (e.g. "H81 ↺ 2h21m"), no bar. Called on every read so the
// countdown recomputes from resetsAt; `color` overrides the thresholds (scoped bars).
function buildUsageBar(label, percentage, resetsAt, color) {
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

  const barColor = color || getUsageColor(percentage);
  const timePart = timeStr ? `${colors.dim} ↺ ${timeStr}${colors.reset}` : '';

  return `${barColor}${label}${percentage}${colors.reset}${timePart}`;
}

// Model-scoped weekly limits, rendered after W. /usage payload `limits[]` entries:
//   { kind: "weekly_scoped", percent, resets_at, scope: { model: { display_name } } }
// Label = first initial of the model name (Fable -> F). Legacy flat seven_day_<model> keys
// kept as fallback. Only ever in the API payload — stdin rate_limits never carries them.
const LEGACY_MODEL_WEEKLY_KEYS = [
  { key: 'seven_day_opus', label: 'O' },
  { key: 'seven_day_sonnet', label: 'S' }
];

// Raw { fiveHour, weekly, models } -> rendered segments; scoped bars use getScopedColor.
function buildUsageBars(raw) {
  const { fiveHour, weekly, models } = raw || {};
  return {
    current: fiveHour ? buildUsageBar('H', fiveHour.percentage, fiveHour.resetsAt) : null,
    weekly: weekly ? buildUsageBar('W', weekly.percentage, weekly.resetsAt) : null,
    models: (models || []).map(m => buildUsageBar(m.label, m.percentage, m.resetsAt, getScopedColor(m.percentage)))
  };
}

// Clamp to 0-100 int; null on non-finite so callers omit the bar instead of rendering "NaN%".
function normalizePercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// limits[] -> [{ label, percentage, resetsAt }]; legacy flat keys only when limits yields nothing.
function parseScopedLimits(usage) {
  const scoped = [];

  if (Array.isArray(usage?.limits)) {
    for (const entry of usage.limits) {
      if (!entry || entry.kind !== 'weekly_scoped') continue;
      const name = entry.scope?.model?.display_name;
      const pct = normalizePercentage(entry.percent);
      if (typeof name !== 'string' || !name.trim() || pct == null) continue;
      scoped.push({
        label: name.trim().charAt(0).toUpperCase(),
        percentage: pct,
        resetsAt: entry.resets_at || null
      });
    }
    if (scoped.length) return scoped;
  }

  for (const { key, label } of LEGACY_MODEL_WEEKLY_KEYS) {
    const seg = usage?.[key];
    const pct = seg ? normalizePercentage(seg.utilization) : null;
    if (pct != null) scoped.push({ label, percentage: pct, resetsAt: seg.resets_at || null });
  }
  return scoped;
}

// Usage from stdin `rate_limits` (Pro/Max only, absent at cold start) — skips the
// network/cache path entirely. resets_at is Unix epoch SECONDS (not ISO). Same raw shape as
// parseUsagePayload; models always [] — scoped limits never arrive via stdin.
function buildUsageFromStdin(data) {
  const rl = data?.rate_limits;
  if (!rl) return null;

  const toEntry = (seg) => {
    if (!seg) return null;
    const pct = normalizePercentage(seg.used_percentage);
    if (pct == null) return null;
    // Defensive: this path runs outside outputStatus's try/catch — bad value -> null, never a throw.
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
  return { fiveHour, weekly: toEntry(rl.seven_day), models: [] };
}

// /usage response body -> { fiveHour, weekly, models }, or null on unparseable JSON or a
// missing/non-finite five_hour utilization (that bar is required). Pure, so unit-testable
// directly — unlike getApiUsage, which needs a live socket.
function parseUsagePayload(body) {
  try {
    const usage = JSON.parse(body);
    const fivePct = usage?.five_hour ? normalizePercentage(usage.five_hour.utilization) : null;
    if (fivePct == null) return null;

    const fiveHour = { percentage: fivePct, resetsAt: usage.five_hour.resets_at || null };
    const weeklyPct = usage.seven_day ? normalizePercentage(usage.seven_day.utilization) : null;
    const weekly = weeklyPct != null ? { percentage: weeklyPct, resetsAt: usage.seven_day.resets_at || null } : null;
    const models = parseScopedLimits(usage);

    return { fiveHour, weekly, models };
  } catch (e) {
    return null;
  }
}

// Valid entry: finite 0-100 percentage, parseable (or absent) resetsAt.
function isValidUsageEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!Number.isFinite(entry.percentage) || entry.percentage < 0 || entry.percentage > 100) return false;
  if (entry.resetsAt != null && Number.isNaN(new Date(entry.resetsAt).getTime())) return false;
  return true;
}

// Cached usage -> { age, data } or null; caller applies TTLs. Invalid shape -> null.
function readCachedUsage() {
  try {
    if (!fs.existsSync(USAGE_CACHE_FILE)) return null;

    const cache = JSON.parse(fs.readFileSync(USAGE_CACHE_FILE, 'utf8'));
    if (!cache || !Number.isFinite(cache.timestamp) || cache.timestamp <= 0) return null;

    // fiveHour required; weekly/models optional. Rejects legacy formats lacking fiveHour.
    const data = cache.data;
    if (!data || typeof data !== 'object') return null;
    if (!isValidUsageEntry(data.fiveHour)) return null;
    if (data.weekly != null && !isValidUsageEntry(data.weekly)) return null;
    if (data.models != null) {
      if (!Array.isArray(data.models)) return null;
      if (!data.models.every(m => typeof m?.label === 'string' && isValidUsageEntry(m))) return null;
    }

    return { age: Date.now() - cache.timestamp, data };
  } catch (e) {
    return null;
  }
}

// On-disk cache shape; pure so test/preview seeds produce writer-identical bytes. lastAttempt
// starts equal to timestamp: a successful write is itself an attempt.
function serializeUsageCache(data, timestamp = Date.now()) {
  return JSON.stringify({ timestamp, data, lastAttempt: timestamp });
}

// Write usage data to cache (shared across all sessions)
function setCachedUsage(data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    fs.writeFileSync(USAGE_CACHE_FILE, serializeUsageCache(data), 'utf8');
  } catch (e) {
    // Silently fail
  }
}

// Age in ms since the last attempt (success or failure), or null. Read from the raw file, not
// readCachedUsage, so the cooldown applies even when no valid data has ever been cached.
function getLastAttemptAge() {
  try {
    if (!fs.existsSync(USAGE_CACHE_FILE)) return null;
    const cache = JSON.parse(fs.readFileSync(USAGE_CACHE_FILE, 'utf8'));
    if (!cache || !Number.isFinite(cache.lastAttempt) || cache.lastAttempt <= 0) return null;
    return Date.now() - cache.lastAttempt;
  } catch (e) {
    return null;
  }
}

// Stamp lastAttempt before the request so failed attempts still enter cooldown; preserves
// existing cached data so a failed refresh doesn't erase the last successful one.
function recordUsageAttempt() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(USAGE_CACHE_FILE, 'utf8'));
    } catch (e) {}
    const merged = existing && typeof existing === 'object' ? { ...existing } : {};
    merged.lastAttempt = Date.now();
    fs.writeFileSync(USAGE_CACHE_FILE, JSON.stringify(merged), 'utf8');
  } catch (e) {
    // Silently fail
  }
}

// Strict "x.y.z" -> -1|0|1, null otherwise (prerelease never nudges — a nicety, not a guess).
function compareVersions(a, b) {
  const parse = (v) => SEMVER_RE.test(String(v ?? '')) ? String(v).split('.').map(Number) : null;
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

// Registry body -> "x.y.z" or null (404 bodies land here too).
function parseRegistryVersion(body) {
  try {
    const v = JSON.parse(body)?.version;
    return SEMVER_RE.test(String(v ?? '')) ? String(v) : null;
  } catch (e) {
    return null;
  }
}

function readUpdateCache() {
  try {
    const c = JSON.parse(fs.readFileSync(UPDATE_CACHE_FILE, 'utf8'));
    return c && typeof c === 'object' ? c : null;
  } catch (e) {
    return null;
  }
}

function writeUpdateCache(obj) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_CACHE_FILE, JSON.stringify(obj), 'utf8');
  } catch (e) {}
}

// Cached latest when strictly newer than VERSION, else ''. Cache-only: render never touches the network.
function getLatestUpdate() {
  const cached = readUpdateCache();
  if (!cached) return '';
  return compareVersions(cached.latest, VERSION) === 1 ? String(cached.latest) : '';
}

// Spawn the check in a detached child — the render never waits on the registry. lastAttempt is
// stamped before the spawn, so an offline/failed/killed child backs off UPDATE_RETRY_MS.
function refreshUpdateCheck() {
  try {
    const cached = readUpdateCache();
    const now = Date.now();
    if (cached) {
      if (Number.isFinite(cached.checkedAt) && now - cached.checkedAt < UPDATE_TTL_MS) return;
      if (Number.isFinite(cached.lastAttempt) && now - cached.lastAttempt < UPDATE_RETRY_MS) return;
    }
    writeUpdateCache({ ...(cached || {}), lastAttempt: now });
    // windowsHide: no console flash on Windows; detached + unref: child outlives the render's exit.
    spawn(process.execPath, [__filename, 'update-check'], {
      detached: true, stdio: 'ignore', windowsHide: true
    }).unref();
  } catch (e) {}
}

// Detached 'update-check' entry point: fetch, stamp cache, exit. A failed fetch leaves
// checkedAt untouched, so the UPDATE_RETRY_MS backoff (not the weekly TTL) governs the next try.
function runUpdateCheck() {
  let settled = false;
  let deadline;

  const done = (latest) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    if (latest) writeUpdateCache({ ...(readUpdateCache() || {}), latest, checkedAt: Date.now() });
    process.exit(0);
  };

  try {
    const req = https.request({
      hostname: REGISTRY_HOST,
      path: `/${PACKAGE_NAME}/latest`,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      timeout: UPDATE_TIMEOUT_MS
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => done(parseRegistryVersion(body)));
    });

    req.on('error', () => done(null));
    req.on('timeout', () => {
      req.destroy();
      done(null);
    });

    // The timeout option is socket inactivity, not total — a trickling response needs this hard deadline.
    deadline = setTimeout(() => {
      req.destroy();
      done(null);
    }, UPDATE_TIMEOUT_MS);

    req.end();
  } catch (e) {
    done(null);
  }
}

function getCredentials() {
  const credsPath = path.join(os.homedir(), '.claude', '.credentials.json');
  if (fs.existsSync(credsPath)) {
    try {
      return JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    } catch (e) {}
  }

  // macOS keychain fallback
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
    const creds = getCredentials();
    if (!creds) {
      return callback(null);
    }

    const accessToken = creds.claudeAiOauth?.accessToken;

    if (!accessToken) {
      return callback(null);
    }

    // Tighter timeout when the cache is warm — a fresh render already has data to print.
    const hasCache = fs.existsSync(USAGE_CACHE_FILE);
    const timeout = hasCache ? 1200 : 1500;

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
        const resolved = parseUsagePayload(data);
        if (resolved) setCachedUsage(resolved);
        callback(resolved);
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

// Resolve raw usage data ({ fiveHour, weekly, models }), cache-first. Callers render it.
function getRawUsage(callback) {
  const cached = readCachedUsage();

  if (cached && cached.age < FRESH_TTL_MS) {
    return callback(cached.data);
  }

  // Refresh attempted (even failed) within FRESH_TTL_MS -> cooldown: serve stale up to STALE_TTL_MS (issue #41).
  const attemptAge = getLastAttemptAge();
  if (attemptAge != null && attemptAge < FRESH_TTL_MS) {
    return callback(cached && cached.age < STALE_TTL_MS ? cached.data : null);
  }

  recordUsageAttempt();
  getApiUsage((fresh) => {
    if (fresh) {
      callback(fresh);
    } else if (cached && cached.age < STALE_TTL_MS) {
      callback(cached.data);
    } else {
      callback(null);
    }
  });
}

// "$0.00" (dim) from stdin cost.total_cost_usd — client-side estimate, no network; '' when absent.
function getCostSegment(data) {
  const usd = data?.cost?.total_cost_usd;
  if (!Number.isFinite(usd)) return '';
  return `${colors.dim}$${usd.toFixed(2)}${colors.reset}`;
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

// Visible (printable) width of a segment string: strip ANSI color codes, count code points.
function visibleWidth(str) {
  return [...str.replace(/\x1b\[[0-9;]*m/g, '')].length;
}

// Two lines only when cols is known (COLUMNS, set by Claude Code v2.1.153+) and the single
// line overflows; unknown width or empty line2 stays single. cols is a parameter — no env read.
function layout(line1Parts, line2Parts, cols) {
  const single = [...line1Parts, ...line2Parts].join(SEGMENT_SEP);
  if (line2Parts.length === 0) return single;
  if (Number.isFinite(cols) && cols > 0 && visibleWidth(single) > cols - WIDTH_MARGIN) {
    return line1Parts.join(SEGMENT_SEP) + '\n' + line2Parts.join(SEGMENT_SEP);
  }
  return single;
}

// Everything the render needs that touches fs/child_process/env (git, todos, update cache,
// COLUMNS), so renderStatusLine stays pure. Own try/catch: called outside outputStatus's, and
// a malformed current_dir must still degrade to a renderable fallback.
function collectFacts(data) {
  try {
    const dir = data?.workspace?.current_dir || process.cwd();
    const dirname = path.basename(dir);
    const branch = DISABLED.has('branch') ? '' : getGitBranch(dir);
    const sync = branch ? formatAheadBehind(getGitAheadBehind(dir)) : '';
    const sessionId = data?.session_id || '';
    const task = DISABLED.has('task') ? '' : getCurrentTask(sessionId);
    const update = DISABLED.has('update') ? '' : getLatestUpdate();
    const cols = parseInt(process.env.COLUMNS, 10);
    return { dirname, branch, sync, task, update, cols };
  } catch (e) {
    return { dirname: '~', branch: '', sync: '', task: '', update: '', cols: undefined };
  }
}

// Own stdout row, not a segment: the copy-pasteable command is too wide to inline without
// forcing a wrap. Appended after layout() so it never joins the wrap decision.
function renderUpdateLine(latest) {
  return `${colors.green}⬆ ${latest}${colors.reset} `
    + `${colors.dim}available ·${colors.reset} `
    + `${colors.bold}npx ${PACKAGE_NAME}@latest${colors.reset}`;
}

// Pure: data + facts (see collectFacts) + usage bars -> rendered line(s); callable directly in tests.
function renderStatusLine(data, facts, usage) {
  const model = shortenModel(data?.model?.display_name || 'Claude');
  const effort = DISABLED.has('effort') ? '' : (data?.effort?.level || '');
  const remaining = data?.context_window?.remaining_percentage;

  const contextBar = getContextBar(remaining);
  const cost = DISABLED.has('cost') ? '' : getCostSegment(data);

  // line1 = identity + context (always); line2 = usage/cost/task (wrap target).
  const line1 = [];
  line1.push(facts.branch
    ? `${facts.dirname} ${colors.dim}⎇ ${facts.branch}${colors.reset}${facts.sync ? ' ' + facts.sync : ''}`
    : facts.dirname);
  line1.push(renderModelEffort(model, effort));
  line1.push(contextBar);

  const line2 = [];
  if (usage?.current) line2.push(usage.current);
  if (usage?.weekly) line2.push(usage.weekly);
  if (usage?.models?.length) line2.push(...usage.models);
  if (cost) line2.push(cost);
  if (facts.task) line2.push(`${colors.dim}${facts.task}${colors.reset}`);

  const body = layout(line1, line2, facts.cols);
  return facts.update ? body + '\n' + renderUpdateLine(facts.update) : body;
}

function outputStatus(data, facts, usage) {
  try {
    process.stdout.write(renderStatusLine(data, facts, usage));
  } catch (e) {
    process.stdout.write('Status unavailable');
  }
}

function outputFallback(usage) {
  const facts = { dirname: '~', branch: '', sync: '', task: '', update: '', cols: undefined };
  process.stdout.write(renderStatusLine(null, facts, usage));
}

// Usage bars: API-key users none; prefer stdin rate_limits, else cache+API (cold start / non-Pro/Max).
function resolveUsage(data, callback) {
  if (IS_API_KEY || DISABLED.has('usage')) {
    return callback(null);
  }
  const fromStdin = buildUsageFromStdin(data);
  if (fromStdin) {
    // Scoped limits only exist in the API payload -> fetch from cache; a failed/slow call
    // costs only those bars, never the H/W bars stdin already gave us.
    return getRawUsage((cached) => {
      callback(buildUsageBars({ ...fromStdin, models: cached?.models || [] }));
    });
  }
  getRawUsage((raw) => callback(raw ? buildUsageBars(raw) : null));
}

// Parse the accumulated stdin into a payload object, or null if empty/unparseable.
function parseInput(input) {
  if (!input || input.length === 0) return null;
  try {
    return JSON.parse(input);
  } catch (e) {
    return null;
  }
}

// Accumulate stdin, call fn(input) exactly once — timeout, 'end', or 'error' whichever fires
// first (the error handler preserves the never-throw contract). Shared by both entry points.
function readStdinThen(timeoutMs, fn) {
  let input = '';
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    fn(input);
  };

  const timeout = setTimeout(finish, timeoutMs);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}

// Resolve usage for `data` (preferring stdin rate_limits), then render and exit.
function emit(data) {
  if (!DISABLED.has('update')) refreshUpdateCheck();
  resolveUsage(data, (usage) => {
    if (data) {
      outputStatus(data, collectFacts(data), usage);
    } else {
      outputFallback(usage);
    }
    process.exit(0);
  });
}

// "45s" / "4m12s" / "2h5m". startTime's format is undocumented upstream, so accept epoch-seconds
// (< 1e12), epoch-ms, or an ISO string. Revisit if a real payload contradicts.
function formatElapsed(startTime) {
  if (startTime == null) return '';
  const ms = typeof startTime === 'number' && startTime < 1e12 ? startTime * 1000 : startTime;
  const start = new Date(ms).getTime();
  if (Number.isNaN(start)) return '';

  const diffSec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hours > 0) return `${hours}h${mins}m`;
  if (mins > 0) return `${mins}m${secs}s`;
  return `${secs}s`;
}

// One subagentStatusLine row: "name │ Model · effort │ C<used> <bar> │ ⏱ <elapsed>".
// Every segment past name is conditional on its source being present/finite.
function renderSubagentTask(t) {
  const parts = [t.label || t.name || t.description || 'agent'];

  const model = shortenModelId(t.model);
  // effort absent = subagent inherits the session effort; show model alone then.
  const effort = t.effort != null ? String(t.effort) : '';
  if (model) {
    parts.push(renderModelEffort(model, effort));
  } else if (effort) {
    parts.push(`${getEffortColor(effort)}${effort}${colors.reset}`);
  }

  if (Number.isFinite(t.tokenCount) && Number.isFinite(t.contextWindowSize) && t.contextWindowSize > 0) {
    const used = Math.max(0, Math.min(100, Math.round((t.tokenCount / t.contextWindowSize) * 100)));
    parts.push(renderContextBar(used));
  }

  const elapsed = formatElapsed(t.startTime);
  if (elapsed) parts.push(`${colors.dim}⏱ ${elapsed}${colors.reset}`);

  return parts.join(SEGMENT_SEP);
}

// subagentStatusLine mode: one {id, content} JSON line per task. No usage/git/todos/cache
// work. Bad payload or a task that fails to render -> emit nothing (default rendering stays).
function emitSubagent(data) {
  try {
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    const out = tasks
      .filter(t => t && t.id)
      .map(t => JSON.stringify({ id: t.id, content: renderSubagentTask(t) }))
      .join('\n');
    if (out) {
      // Exit from the write callback: process.exit() would drop output queued behind backpressure.
      process.stdout.write(out + '\n', () => process.exit(0));
      return;
    }
  } catch (e) {}
  process.exit(0);
}

// Guarded so tests can require() the exports instead of spawning the script.
if (require.main === module) {
  const mode = process.argv[2];
  const isSubagent = mode === 'subagent';
  const finish = isSubagent ? emitSubagent : emit;

  if (mode === 'update-check') {
    runUpdateCheck();
  } else if (process.stdin.isTTY) {
    finish(null);
  } else {
    const timeoutMs = isSubagent
      ? SUBAGENT_TIMEOUT_MS
      : (IS_API_KEY ? 500 : (fs.existsSync(USAGE_CACHE_FILE) ? 1300 : 1600));
    readStdinThen(timeoutMs, (input) => finish(parseInput(input)));
  }
} else {
  module.exports = { parseScopedLimits, parseUsagePayload, serializeUsageCache, normalizePercentage, readStdinThen, renderStatusLine, renderSubagentTask, compareVersions, parseRegistryVersion, VERSION };
}
