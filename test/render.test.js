// Render tests for statusline.js
// Spawns the real script and asserts on its stdin -> stdout contract.
// Fully self-contained: no network, no credentials, no API key required.

const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'statusline.js');

// Empty fake HOME so the todos/credentials lookups find nothing -> deterministic.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
after(() => fs.rmSync(FAKE_HOME, { recursive: true, force: true }));

// Run statusline.js with the given stdin string. Returns { code, raw, clean }.
// opts.home  : override the fake HOME (default: empty FAKE_HOME -> no usage/todos)
// opts.usage : when true, allow the usage path to run (otherwise a dummy
//              ANTHROPIC_API_KEY is set so the usage fetch is skipped entirely)
function run(input, opts = {}) {
  const home = opts.home || FAKE_HOME;
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  if (opts.usage) {
    delete env.ANTHROPIC_API_KEY;
  } else {
    env.ANTHROPIC_API_KEY = 'test';
  }
  const res = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', timeout: 5000, env });
  const raw = res.stdout || '';
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI for readable assertions
  return { code: res.status, raw, clean };
}

// Build a throwaway HOME containing a tokenless credentials file (so getApiUsage
// bails out before any network/keychain call) and optionally a seeded usage cache
// of a given age. Lets us exercise the cache-first / stale-fallback logic offline.
function seedHome({ cacheAgeMs, percentage = 42, weeklyPercentage = 31 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cache-'));
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.credentials.json'), '{}'); // no accessToken -> API skipped
  if (cacheAgeMs != null) {
    const cache = {
      timestamp: Date.now() - cacheAgeMs,
      data: {
        fiveHour: { percentage, resetsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() },
        // 62h out -> exercises the day-aware countdown (2d14h)
        weekly: { percentage: weeklyPercentage, resetsAt: new Date(Date.now() + 62 * 3600 * 1000).toISOString() }
      }
    };
    fs.writeFileSync(path.join(claudeDir, 'cache', 'usage-cache.json'), JSON.stringify(cache));
  }
  return home;
}

function fixture(remaining, dir = '/tmp/myproject', model = 'Opus 4.8', effort, cost) {
  const obj = {
    model: { display_name: model },
    workspace: { current_dir: dir },
    session_id: 'test-session',
    context_window: { remaining_percentage: remaining }
  };
  if (effort) obj.effort = { level: effort };
  if (cost != null) obj.cost = { total_cost_usd: cost };
  return JSON.stringify(obj);
}

// stdin payload carrying `rate_limits` (Claude.ai Pro/Max, post-first-response).
// resets_at is a Unix epoch in SECONDS. 5h ~2h out, 7d ~62h out (exercises day-aware countdown).
function fixtureWithRateLimits(remaining, { five = 23.5, seven = 41.2 } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    model: { display_name: 'Opus 4.8' },
    workspace: { current_dir: '/tmp/myproject' },
    session_id: 'test-session',
    context_window: { remaining_percentage: remaining },
    rate_limits: {
      five_hour: { used_percentage: five, resets_at: nowSec + 2 * 3600 },
      seven_day: { used_percentage: seven, resets_at: nowSec + 62 * 3600 }
    }
  });
}

// Make a real dir with a seeded .git/HEAD so the branch segment renders deterministically.
function seedRepo(branch = 'feature/x') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ANSI color codes the script emits (kept in sync with statusline.js `colors`).
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const ORANGE = '\x1b[38;5;208m';
const RED = '\x1b[31m';
const PURPLE = '\x1b[38;5;135m';
const DIM = '\x1b[2m';
const BLINK = '\x1b[5m';

test('line assembly: dir basename | model | context, separated by │', () => {
  const { code, clean } = run(fixture(40, '/home/me/cool-project', 'Sonnet 4.6'));
  assert.strictEqual(code, 0);
  const parts = clean.split(' │ ');
  assert.strictEqual(parts[0], 'cool-project');        // basename only
  assert.strictEqual(parts[1], 'Sonnet 4.6');          // model passes through
  assert.match(parts[2], /^C\d+ /);                    // compact context label "C60 ███░░░"
});

test('model name is shortened: "(1M context)" -> "(1M)"', () => {
  const { clean } = run(fixture(40, '/home/me/p', 'Opus 4.8 (1M context)'));
  const parts = clean.split(' │ ');
  assert.strictEqual(parts[1], 'Opus 4.8 (1M)');
});

test('git branch renders next to the dir (⎇ <branch>)', () => {
  const repo = seedRepo('feature/x');
  const { clean } = run(fixture(40, repo));
  const parts = clean.split(' │ ');
  assert.match(parts[0], /⎇ feature\/x$/);              // branch glued to dir segment
  assert.ok(parts[0].startsWith(path.basename(repo)));  // dir basename still first
});

test('short ticket branch is not truncated (TAMA5-32796 stays whole)', () => {
  const repo = seedRepo('TAMA5-32796');
  const { clean } = run(fixture(40, repo));
  assert.match(clean, /⎇ TAMA5-32796 /);                 // intact, no ellipsis
});

test('over-long branch is tail-truncated to 24 chars with …', () => {
  const repo = seedRepo('TAMA5-32796-add-login-form-and-tests');
  const { clean } = run(fixture(40, repo));
  const parts = clean.split(' │ ');
  const m = parts[0].match(/⎇ (.+)$/);
  assert.ok(m, 'branch segment present');
  assert.strictEqual(m[1].length, 24);                   // 23 chars + …
  assert.ok(m[1].endsWith('…'));
  assert.ok(m[1].startsWith('TAMA5-32796'));             // ticket ID preserved
});

test('no .git -> no branch glyph in dir segment', () => {
  const { clean } = run(fixture(40, '/no/such/repo/here'));
  const parts = clean.split(' │ ');
  assert.ok(!parts[0].includes('⎇'), 'branch glyph should be absent without a repo');
});

test('detached HEAD -> short 7-char SHA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-detach-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'abc1234567890abcdef1234567890abcdef12345\n'); // 40-char SHA
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { clean } = run(fixture(40, dir));
  assert.match(clean.split(' │ ')[0], /⎇ abc1234$/);   // first 7 chars of the SHA
});

test('worktree (.git is a file with gitdir:) -> branch still renders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-wt-'));
  const gitdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-wtgit-'));
  fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/wt\n');
  fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${gitdir}\n`); // .git as a file pointer
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(gitdir, { recursive: true, force: true });
  });
  const { clean } = run(fixture(40, dir));
  assert.match(clean.split(' │ ')[0], /⎇ feature\/wt$/);
});

test('thinking effort renders next to the model (· <level>)', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', 'high'));
  const parts = clean.split(' │ ');
  assert.match(parts[1], /Opus 4\.8 · high$/);
});

test('no effort field -> model segment unchanged', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8'));
  const parts = clean.split(' │ ');
  assert.strictEqual(parts[1], 'Opus 4.8');
});

test('effort = max is red', () => {
  const { raw, clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', 'max'));
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8 · max');
  assert.ok(raw.includes(RED), 'expected red for max effort');
});

test('effort = ultracode is purple', () => {
  const { raw, clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', 'ultracode'));
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8 · ultracode');
  assert.ok(raw.includes(PURPLE), 'expected purple for ultracode effort');
});

test('effort = xhigh is dim (not highlighted red/purple)', () => {
  const { raw, clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', 'xhigh'));
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8 · xhigh');
  assert.ok(raw.includes(DIM), 'xhigh effort uses the dim style');
  assert.ok(!raw.includes(PURPLE) && !raw.includes(RED), 'xhigh must not be highlighted');
});

test('session cost renders as $X.XX (two decimals)', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', undefined, 0.4));
  assert.match(clean, /\$0\.40\b/);                    // 0.4 -> "$0.40"
});

test('session cost is dim', () => {
  const { raw } = run(fixture(40, '/no/such/repo', 'Opus 4.8', undefined, 1.5));
  assert.ok(raw.includes(`${DIM}$1.50`), 'expected dim-rendered cost');
});

test('no cost field -> segment omitted (finite-guarded, no $)', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8'));
  assert.ok(!clean.includes('$'), 'cost segment should be absent without cost.total_cost_usd');
});

test('cost renders after usage and before task', () => {
  // Fresh-cache usage + cost present; no in_progress todo in FAKE_HOME -> cost is last.
  const home = seedHome({ cacheAgeMs: 5000, percentage: 42, weeklyPercentage: 31 });
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', undefined, 0.42), { home, usage: true });
  const parts = clean.split(' │ ');
  const costIdx = parts.findIndex(p => p.includes('$0.42'));
  const weeklyIdx = parts.findIndex(p => /^W\d+/.test(p));
  assert.ok(costIdx > weeklyIdx, 'cost should come after the weekly usage segment');
  assert.strictEqual(costIdx, parts.length - 1, 'cost is the last segment when no task is active');
});

test('context bar shows used% = 100 - remaining', () => {
  const { clean } = run(fixture(65));
  assert.match(clean, /C35 /);                    // remaining 65 -> used 35 -> "C35 <bar>"
});

test('threshold: used < 50 is green', () => {
  const { raw } = run(fixture(60));                    // used 40
  assert.ok(raw.includes(GREEN), 'expected green color code');
});

test('threshold: 50 <= used < 65 is yellow', () => {
  const { raw } = run(fixture(40));                    // used 60
  assert.ok(raw.includes(YELLOW), 'expected yellow color code');
});

test('threshold: 65 <= used < 80 is orange', () => {
  const { raw } = run(fixture(25));                    // used 75
  assert.ok(raw.includes(ORANGE), 'expected orange color code');
});

test('threshold: used >= 80 is blinking red, no emoji', () => {
  const { raw, clean } = run(fixture(10));             // used 90
  assert.ok(raw.includes(BLINK) && raw.includes(RED), 'expected blink + red');
  assert.ok(!clean.includes('\u{1F480}'), 'skull emoji should not be present');
  assert.match(clean, /C90 /);
});

// The contract that must never break: always print, always exit 0.
test('empty stdin -> fallback line, exit 0', () => {
  const { code, clean } = run('');
  assert.strictEqual(code, 0);
  assert.ok(clean.includes('│'), 'expected a separator in fallback');
  assert.match(clean, /C\d+ /, 'expected context label in fallback');
});

test('malformed JSON -> fallback line, exit 0', () => {
  const { code, clean } = run('not json at all');
  assert.strictEqual(code, 0);
  assert.match(clean, /C\d+ /);
});

test('missing fields -> no crash, exit 0', () => {
  const { code, clean } = run('{}');
  assert.strictEqual(code, 0);
  assert.ok(clean.includes('Claude'));                 // default model name
  assert.match(clean, /C\d+ /);
});

// Usage bar: cache-first behavior and the stale fallback that fixes the
// "usage section disappears mid-session" bug.

test('fresh cache -> current + weekly rendered from cache (no API call)', () => {
  const home = seedHome({ cacheAgeMs: 5000, percentage: 42, weeklyPercentage: 31 }); // < FRESH_TTL (30s)
  const { code, clean } = run(fixture(40), { home, usage: true });
  assert.strictEqual(code, 0);
  assert.match(clean, /H42\b/);
  assert.match(clean, /W31\b/);
  assert.match(clean, /W31 ↺ 2d\d{1,2}h/);                    // day-aware reset countdown (Xd Yh)
});

test('stale cache + failing API -> usage stays visible (does not disappear)', () => {
  const home = seedHome({ cacheAgeMs: 2 * 60 * 1000, percentage: 57 }); // > FRESH, < STALE
  const { clean } = run(fixture(40), { home, usage: true });
  assert.match(clean, /H57\b/);
});

test('expired cache + failing API -> usage omitted', () => {
  const home = seedHome({ cacheAgeMs: 20 * 60 * 1000, percentage: 57 }); // > STALE_TTL (10m)
  const { code, clean } = run(fixture(40), { home, usage: true });
  assert.strictEqual(code, 0);                                  // ran successfully
  assert.match(clean, /C\d+ /, 'expected the normal line to still render');
  assert.ok(!clean.includes('↺'), 'usage (and its reset glyph) should be omitted once cache is too old');
  assert.ok(!clean.includes('H57'), 'current usage should be omitted once cache is too old');
});

// Usage from stdin `rate_limits`: the network/cache path is bypassed entirely.

test('stdin rate_limits -> 5h/7d render with no cache and no creds', () => {
  // FAKE_HOME has neither a usage cache nor a credentials file, so the only way usage
  // can render is straight from stdin rate_limits (proves the API/cache path is skipped).
  const { code, clean } = run(fixtureWithRateLimits(40), { usage: true });
  assert.strictEqual(code, 0);
  assert.match(clean, /H24\b/);                                 // 23.5 -> 24 (fractional, rounded)
  assert.match(clean, /W41\b/);                                 // 41.2 -> 41
  assert.match(clean, /W41 ↺ 2d\d{1,2}h/);                      // epoch-seconds -> day-aware countdown
});

test('stdin rate_limits takes precedence over a fresh cache', () => {
  // Fresh cache says 42% / 31%; stdin says 23.5% / 41.2%. stdin must win (cache not read).
  const home = seedHome({ cacheAgeMs: 5000, percentage: 42, weeklyPercentage: 31 });
  const { clean } = run(fixtureWithRateLimits(40), { home, usage: true });
  assert.match(clean, /H24\b/);
  assert.ok(!clean.includes('H42'), 'cached 5h value must not appear when stdin rate_limits is present');
});
