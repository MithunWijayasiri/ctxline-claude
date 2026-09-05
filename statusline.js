#!/usr/bin/env node
// Claude Code Enhanced Statusline
// Shows: directory | model | context usage | 5-hour + weekly + model-scoped usage | current task
// Auto-detects API key vs subscription usage
// https://github.com/MithunWijayasiri/ctxline-claude

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync, execFileSync, spawn } = require('child_process');

// Installed version, compared against the npm registry's latest for the update nudge.
// This file is copied standalone into ~/.claude/hooks/ with no package.json beside it,
// so the version has to live here. Must match package.json "version" (see CLAUDE.md).
const VERSION = '1.6.2';

const IS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

// Optional segment opt-out: CTXLINE_DISABLE is a comma list of segments to hide.
// Recognized: branch, effort, cost, task, update, usage (H+W+model-scoped). dir/model/context
// always render.
// Unknown names are ignored. Disabling a segment also skips its work (git, todo read,
// usage fetch).
const DISABLED = new Set(
  (process.env.CTXLINE_DISABLE || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

// Shared width (cells) for all progress bars: context, current, weekly.
const BAR_WIDTH = 6;

// Max characters shown for the git branch; longer names are tail-truncated with "…".
// Tail-truncation keeps the start (ticket IDs like "TAMA5-32796" live there) visible.
const MAX_BRANCH_LEN = 24;

// Separator between segments on a rendered line.
const SEGMENT_SEP = ' │ ';

// Cells reserved at the terminal edge when deciding to wrap to a second line.
// 0 = use the full COLUMNS; bump it if Claude Code reserves columns and the line
// truncates a char or two before wrapping.
const WIDTH_MARGIN = 0;

// Cache configuration
const CACHE_DIR = path.join(os.homedir(), '.claude', 'cache');
const USAGE_CACHE_FILE = path.join(CACHE_DIR, 'usage-cache.json');
// Fresh: trust the cache and skip the API call entirely (fewer calls, faster render).
const FRESH_TTL_MS = 30000;            // 30 seconds
// Stale: used only as a fallback when a live API call fails, so the usage bar stays
// visible through transient timeouts/errors instead of disappearing.
const STALE_TTL_MS = 10 * 60 * 1000;   // 10 minutes

// Git ahead/behind cache (single repo entry, keyed by git dir). Throttles the one
// `git rev-list` subprocess so a burst of renders in a turn runs it once, not per render.
const GIT_CACHE_FILE = path.join(CACHE_DIR, 'git-cache.json');
const GIT_FRESH_TTL_MS = 5000;          // 5s: reuse counts within a render burst
const GIT_STALE_TTL_MS = 60000;         // 60s: fall back to last counts if git fails
const GIT_TIMEOUT_MS = 500;             // hard cap on the rev-list subprocess (warm ~130ms)

// Update check: compares VERSION against the npm registry's dist-tags.latest. The render
// only ever reads this cache; the refresh runs in a detached child (see refreshUpdateCheck),
// so no render ever waits on the registry.
const UPDATE_CACHE_FILE = path.join(CACHE_DIR, 'update-cache.json');
const UPDATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days between successful checks
const UPDATE_RETRY_MS = 60 * 60 * 1000;         // 1h backoff after a failed/killed check
const UPDATE_TIMEOUT_MS = 2000;                 // socket idle AND whole-request deadline
const REGISTRY_HOST = 'registry.npmjs.org';
const PACKAGE_NAME = 'ctxline-claude';
const SEMVER_RE = /^\d+\.\d+\.\d+$/;       // releases only: a prerelease never nudges

// Subagent mode reads only stdin (no usage API to race), so its stdin read gets a
// short hard cap of its own instead of the main-mode overallTimeout.
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

// Model-scoped bars skip the H/W thresholds: a line can carry several at once, so a flat
// orange keeps them readable as one group. Red at >=90 is the one distinction kept — that
// bar is about to block the model it names.
function getScopedColor(percentage) {
  return percentage >= 90 ? colors.red : colors.orange;
}

// Shorten verbose model names for the statusline: "Opus 4.8 (1M context)" -> "Opus 4.8 (1M)".
function shortenModel(name) {
  return name.replace(/\s+context\)/i, ')');
}

// Shorten a resolved model ID (subagent task.model, e.g. "claude-opus-5") for the
// subagent row: "claude-opus-5" -> "Opus 5", "claude-haiku-4-5-20251001" -> "Haiku 4.5".
// Distinct from shortenModel, which trims a display name rather than parsing an ID.
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

// Resolve the repo's git dir by walking up from `dir` (no `git` subprocess). Handles
// worktrees/submodules (".git" as a file pointing at the real dir). '' on any failure.
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

// Current git branch, read straight from .git/HEAD (no `git` subprocess — fast,
// dependency-free). Detached HEAD -> short sha. Best-effort: '' on any failure.
function getGitBranch(dir) {
  try {
    const gitDir = resolveGitDir(dir);
    if (!gitDir) return '';
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    // Strip control chars: HEAD is read raw (not git-validated), so a hand-crafted file
    // in an untrusted archive could inject terminal escape sequences.
    if (ref) return truncateBranch(ref[1].replace(/[\x00-\x1f\x7f]/g, ''));
    if (/^[0-9a-f]{7,40}$/i.test(head)) return head.slice(0, 7);  // detached HEAD -> short sha
    return '';
  } catch (e) {
    return '';
  }
}

// Read the cached ahead/behind for `gitDir`. Single-entry file: a different repo
// invalidates it. Returns { age, ahead, behind } or null.
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

// Commits ahead/behind the upstream (@{u}), cache-fronted. The single `git` call in the
// whole script — gated by GIT_FRESH_TTL_MS so a render burst runs it once. No upstream /
// detached / no git -> the subprocess errors -> null (segment omitted). On a slow/failed
// call, falls back to the last counts up to GIT_STALE_TTL_MS so they don't flicker.
function getGitAheadBehind(dir) {
  const gitDir = resolveGitDir(dir);
  if (!gitDir) return null;

  const cached = readGitCache(gitDir);
  if (cached && cached.age < GIT_FRESH_TTL_MS) {
    return { ahead: cached.ahead, behind: cached.behind };
  }

  try {
    // execFileSync (no shell): faster cold spawn than execSync and passes `@{u}` literally.
    // `@{u}...HEAD` with --left-right --count prints "<behind>\t<ahead>" (left = upstream).
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

// "↑N↓M" from ahead/behind counts: ahead green (commits to push), behind red (missing
// commits). Each part self-resets so it doesn't inherit the dim branch color. Omit a zero
// side; '' when in sync or null.
function formatAheadBehind(ab) {
  if (!ab) return '';
  let s = '';
  if (ab.ahead) s += `${colors.green}↑${ab.ahead}${colors.reset}`;
  if (ab.behind) s += `${colors.red}↓${ab.behind}${colors.reset}`;
  return s;
}

// Colored "C<used> <bar>" (e.g. "C45 ███░░░") for an already-clamped 0-100 used
// percentage. Shared by the main context bar (derived from remaining%) and the
// subagent row (derived from tokenCount/contextWindowSize) so both use the same
// thresholds and bar style.
function renderContextBar(used) {
  const filled = Math.round((used / 100) * BAR_WIDTH);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(BAR_WIDTH - filled);

  // Context color: green <50 / yellow <65 / orange <80 / blink-red >=80.
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

// Render a compact usage segment from raw data: "<label><pct> ↺ <countdown>"
// (e.g. "H81 ↺ 2h21m") — no bar. Called on every read (live or cached) so the reset
// countdown is always recomputed from resetsAt rather than frozen at fetch time.
// `color` overrides the threshold color — the model-scoped bars pass getScopedColor.
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

// Model-scoped weekly limits (e.g. "Fable weekly limit at 86%"), rendered after the
// account-wide W bar. The /usage payload reports these in a `limits` array, each entry
// carrying the model in scope.model.display_name:
//
//   { kind: "weekly_scoped", percent: 86, severity: "warning",
//     resets_at: "...", scope: { model: { display_name: "Fable" } } }
//
// The label is the model's first initial (Fable -> F), so a new model family needs no
// code change. Older payloads instead exposed flat seven_day_<model> keys, kept below as
// a fallback for accounts still reporting that shape.
//
// NOTE: these appear only in the API payload. Claude Code's statusline stdin carries just
// five_hour and seven_day under rate_limits, so the scoped limits always come from the
// cache/API path even when stdin supplies the H and W bars.
const LEGACY_MODEL_WEEKLY_KEYS = [
  { key: 'seven_day_opus', label: 'O' },
  { key: 'seven_day_sonnet', label: 'S' }
];

// Build the usage segments from a raw { fiveHour, weekly, models } object — the shared
// shape both buildUsageFromStdin and parseUsagePayload return. fiveHour/weekly are
// { percentage, resetsAt } or null/absent; models is an array of { label, percentage,
// resetsAt } (possibly empty). Returns { current, weekly, models } — the first two
// rendered strings or null, models a (possibly empty) array of rendered strings. Scoped
// bars use getScopedColor instead of the H/W thresholds, so the full threshold palette
// stays exclusive to H/W.
function buildUsageBars(raw) {
  const { fiveHour, weekly, models } = raw || {};
  return {
    current: fiveHour ? buildUsageBar('H', fiveHour.percentage, fiveHour.resetsAt) : null,
    weekly: weekly ? buildUsageBar('W', weekly.percentage, weekly.resetsAt) : null,
    models: (models || []).map(m => buildUsageBar(m.label, m.percentage, m.resetsAt, getScopedColor(m.percentage)))
  };
}

// Normalize a raw API utilization into the 0-100 integer that the rest of the
// pipeline (cache validation + bar rendering) expects. Returns null when the value
// isn't a finite number, so callers can omit that bar instead of rendering "NaN%".
function normalizePercentage(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Extract the model-scoped weekly limits from a raw /usage payload as
// [{ label, percentage, resetsAt }], in payload order. Prefers the `limits` array;
// falls back to the legacy flat keys only when it yields nothing, so an account
// reporting both shapes doesn't render the same limit twice.
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

// Build usage bars from stdin `rate_limits` (Claude.ai Pro/Max, present only after the
// first API response of a session). Same data as the OAuth usage API, so reading it here
// skips the network/credentials/cache path entirely. `resets_at` is a Unix epoch in
// SECONDS (not ISO) — ×1000 before Date. Returns raw { fiveHour, weekly, models } — same
// shape as parseUsagePayload — or null when rate_limits is absent or the required
// five_hour segment is unusable (caller falls back). models is always [] here: model-scoped
// weekly limits are never present in stdin — see LEGACY_MODEL_WEEKLY_KEYS.
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
  return { fiveHour, weekly: toEntry(rl.seven_day), models: [] };
}

// Parse a raw /usage API response body into { fiveHour, weekly, models } — same shape as
// buildUsageFromStdin — or null on unparseable JSON or a missing/non-finite five_hour
// utilization (that bar is required). Normalizes utilization first so a missing/non-finite
// value omits a bar instead of rendering "NaN%". Pure — no fs/network — so it's unit
// testable directly, unlike getApiUsage which needs a live socket.
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

    // Validate data. fiveHour is required; weekly and models are optional (the API may
    // omit either). This also rejects the legacy single-{percentage,resetsAt} format from
    // older versions, which had no fiveHour key, so stale caches are ignored on read.
    // A cache written before model bars existed simply has no models key — still valid.
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

// Serialize usage data into the on-disk cache shape ({ timestamp, data, lastAttempt }). Pure
// -- no fs -- so setCachedUsage and the test/preview cache seeds all produce exactly the same
// bytes the real writer would; a reader/writer format mismatch becomes structurally impossible
// instead of merely untested. `timestamp` defaults to now; tests override it to seed a stale
// cache. A successful write is itself an attempt, so `lastAttempt` starts equal to `timestamp`.
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

// Age in ms since the last API attempt (success or failure), or null if none recorded yet.
// Read directly from the raw file rather than via readCachedUsage so the cooldown still
// applies when no valid data has ever been cached (every attempt so far has failed).
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

// Record that an API attempt is starting, preserving any existing cached data/timestamp so a
// failed refresh doesn't erase the last successful one. Written before the request so a hang
// or a process exit mid-request still counts as an attempt for cooldown purposes.
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

// Compare two strict "x.y.z" versions -> -1 | 0 | 1, or null when either side isn't that
// shape (prerelease tags, missing parts, non-numeric). The nudge is a nicety, so an
// unparseable version means no segment rather than a guess.
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

// Pure: an npm registry version-manifest body -> its "x.y.z" version string, or null on
// unparseable JSON, a missing version, or a non-release version (404 bodies land here too).
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

// The cached latest version when it's newer than VERSION, else ''. Cache-only by design:
// collectFacts calls this on the render path, and the render must never touch the network.
function getLatestUpdate() {
  const cached = readUpdateCache();
  if (!cached) return '';
  return compareVersions(cached.latest, VERSION) === 1 ? String(cached.latest) : '';
}

// Fire the weekly check in a detached child, so the render neither waits on the registry
// nor races its own exit against the response. lastAttempt is stamped before the spawn, so
// an offline machine, a failed spawn, or a child that dies backs off UPDATE_RETRY_MS
// instead of respawning on every render.
function refreshUpdateCheck() {
  try {
    const cached = readUpdateCache();
    const now = Date.now();
    if (cached) {
      if (Number.isFinite(cached.checkedAt) && now - cached.checkedAt < UPDATE_TTL_MS) return;
      if (Number.isFinite(cached.lastAttempt) && now - cached.lastAttempt < UPDATE_RETRY_MS) return;
    }
    writeUpdateCache({ ...(cached || {}), lastAttempt: now });
    // windowsHide: a detached console app would otherwise flash its own console window on
    // Windows. detached + unref so the child outlives this render's exit(0).
    spawn(process.execPath, [__filename, 'update-check'], {
      detached: true, stdio: 'ignore', windowsHide: true
    }).unref();
  } catch (e) {}
}

// The 'update-check' entry point: the detached child. Fetches the registry's latest
// version, stamps the cache, exits. Writes nothing to stdout — it is not a statusline
// mode, and its stdio is discarded by the parent anyway. A failed fetch leaves checkedAt
// untouched, so the UPDATE_RETRY_MS backoff (not the weekly TTL) governs the next try.
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

    // The `timeout` option above is socket inactivity, not total duration -- a response
    // that trickles bytes would keep this detached child alive indefinitely, and the
    // parent's UPDATE_RETRY_MS only delays the next spawn, it can't reap this one.
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
        const resolved = parseUsagePayload(data);
        // Cache the raw data (shared across sessions); callers render from it.
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

  // Cache is fresh -> use it and skip the API entirely (fewer calls, faster).
  if (cached && cached.age < FRESH_TTL_MS) {
    return callback(cached.data);
  }

  // A refresh (successful or not) was attempted within FRESH_TTL_MS -> still in cooldown,
  // don't hit the API again. Serve stale cached data if it's still within STALE_TTL_MS, else
  // nothing. Without this, a repeatedly failing/timing-out refresh would re-hit the API on
  // every render instead of backing off (issue #41).
  const attemptAge = getLastAttemptAge();
  if (attemptAge != null && attemptAge < FRESH_TTL_MS) {
    return callback(cached && cached.age < STALE_TTL_MS ? cached.data : null);
  }

  // Cache is stale or missing and no attempt is in cooldown -> refresh from the API.
  recordUsageAttempt();
  getApiUsage((fresh) => {
    if (fresh) {
      callback(fresh);
    } else if (cached && cached.age < STALE_TTL_MS) {
      // API failed/timed out, but recent cache exists -> show it instead of nothing.
      callback(cached.data);
    } else {
      callback(null);
    }
  });
}

// Session cost from stdin `cost.total_cost_usd` (USD float, computed client-side by
// Claude Code as tokens × per-model API pricing). Pure stdin — no network/cache.
// Returns "$0.00" rendered dim, or '' when absent/non-finite so the segment is omitted.
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

// Responsive layout: one line when it fits the terminal, else line1 (identity + context)
// on top and line2 (usage/cost/task) below. Splits only when cols is known (Claude Code
// v2.1.153+ sets COLUMNS, read by collectFacts) and the single line overflows — unknown
// width or an empty line2 stays single, so there is no regression on older clients or wide
// terminals.
function layout(line1Parts, line2Parts, cols) {
  const single = [...line1Parts, ...line2Parts].join(SEGMENT_SEP);
  if (line2Parts.length === 0) return single;
  if (Number.isFinite(cols) && cols > 0 && visibleWidth(single) > cols - WIDTH_MARGIN) {
    return line1Parts.join(SEGMENT_SEP) + '\n' + line2Parts.join(SEGMENT_SEP);
  }
  return single;
}

// Gathers everything outputStatus needs that touches fs/child_process/env: git branch +
// ahead/behind (.git/HEAD, `git rev-list`), the in-progress task (~/.claude/todos), and the
// terminal width (COLUMNS). Kept separate from renderStatusLine so the render step is pure.
// Wrapped in its own try/catch (unlike renderStatusLine, it's called outside outputStatus's
// try/catch in emit()) — a malformed workspace.current_dir (e.g. non-string) can throw from
// path.basename or resolveGitDir, and this must still degrade to a renderable fallback.
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

// The update nudge gets its own row rather than a segment: Claude Code renders every
// stdout line as a separate row, and the point of the nudge is the copy-pasteable command,
// which is too wide to inline without forcing the main line to wrap on most terminals.
// `npx <pkg>@latest` is the right command for script-installed users too — it recopies the
// hook. Only the target version is shown — the running one is what you're looking at.
function renderUpdateLine(latest) {
  return `${colors.green}⬆ ${latest}${colors.reset} `
    + `${colors.dim}available ·${colors.reset} `
    + `${colors.bold}npx ${PACKAGE_NAME}@latest${colors.reset}`;
}

// Pure: data + facts (see collectFacts) + resolved usage bars -> the rendered line(s).
// No fs/child_process/network access, so it's callable directly in tests.
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

// Main
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

// Resolve usage bars for a (possibly null) parsed stdin payload.
// Order: API-key users get none; otherwise prefer stdin `rate_limits` (no network),
// then fall back to the cache+API flow when stdin lacks it (cold start / non-Pro/Max).
function resolveUsage(data, callback) {
  if (IS_API_KEY || DISABLED.has('usage')) {
    return callback(null);
  }
  const fromStdin = buildUsageFromStdin(data);
  if (fromStdin) {
    // stdin covers H and W with no network. Model-scoped weekly limits only exist in the
    // API payload, so they come from the cache — refreshed on the same TTL as every other
    // usage read, which keeps at most one call per FRESH_TTL_MS regardless of render rate.
    // Falls back to the stale cache and finally to [] so a failed or slow call costs only
    // the scoped bars, never the H/W bars stdin already gave us.
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

// Accumulate stdin then call fn(input) exactly once, on whichever fires first:
// timeout, 'end', or 'error' (an unhandled stdin error would otherwise throw,
// breaking the never-throw contract). Shared by both entry points below, which
// differ only in timeoutMs.
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

// now - startTime as "45s" / "4m12s" / "2h5m". '' when startTime is missing/unparseable.
// Format isn't documented by Claude Code, so accept epoch-seconds, epoch-ms, or an ISO
// string: numbers below 1e12 are epoch-seconds (today's epoch-seconds ~1.7e9, epoch-ms
// ~1.7e12 — far enough apart that the threshold is unambiguous for any real timestamp).
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

// subagentStatusLine mode: emit one {id, content} JSON line per task with an id, then
// exit. No usage/git/todos/cache work — the task objects carry everything needed.
// Bad payload or a task that fails to render -> emit nothing, keeping default
// rendering for every task, rather than a partial/broken output.
function emitSubagent(data) {
  try {
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    const out = tasks
      .filter(t => t && t.id)
      .map(t => JSON.stringify({ id: t.id, content: renderSubagentTask(t) }))
      .join('\n');
    if (out) {
      // Exit from the write callback: process.exit() would drop output still queued
      // behind stdout backpressure. A write error (e.g. EPIPE) also lands here — the
      // callback form reports it instead of throwing, and the answer is the same: exit 0.
      process.stdout.write(out + '\n', () => process.exit(0));
      return;
    }
  } catch (e) {}
  process.exit(0);
}

// Entry point, guarded so tests can require this file to exercise payload parsing
// directly (the /usage response shape is the easiest thing here to get wrong, and it
// can't be reached through stdin). Running the script normally is unchanged.
if (require.main === module) {
  const mode = process.argv[2];
  const isSubagent = mode === 'subagent';
  const finish = isSubagent ? emitSubagent : emit;

  if (mode === 'update-check') {
    // Detached child spawned by refreshUpdateCheck: no stdin, no output, just the fetch.
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
  module.exports = { parseScopedLimits, parseUsagePayload, serializeUsageCache, normalizePercentage, readStdinThen, renderStatusLine, renderSubagentTask, compareVersions, parseRegistryVersion };
}
