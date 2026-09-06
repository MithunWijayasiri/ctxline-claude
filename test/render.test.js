// Render tests for statusline.js
// Format/colour-band/segment-order/wrap assertions call the exported pure functions
// (renderStatusLine, renderSubagentTask) directly. What's left spawns the real script and
// asserts on its stdin -> stdout contract: fs/git-dependent gathering, the usage cache/API
// pipeline, CTXLINE_DISABLE env-parsing, and the execution contract (always prints, exit 0).
// Fully self-contained: no network, no credentials, no API key required.

const { test, after } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  makeHome, seedCredentials, seedUsageCache, seedUpdateCache, seedFakeRepo,
  git, hasGit, gitCommit, seedDivergedRepo: buildDivergedRepo, spawnMain, spawnSubagent
} = require('./fixture.js');

// Empty fake HOME so the todos/credentials lookups find nothing -> deterministic.
const FAKE_HOME = makeHome();
after(() => fs.rmSync(FAKE_HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

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
  // Width drives the responsive wrap. Default: unset -> always single line (matches
  // pre-responsive behavior, keeps `split(' │ ')` assertions deterministic).
  if (opts.columns != null) {
    env.COLUMNS = String(opts.columns);
  } else {
    delete env.COLUMNS;
  }
  // Segment opt-out. Default: unset so a value in the dev env can't skew assertions.
  if (opts.disable != null) {
    env.CTXLINE_DISABLE = opts.disable;
  } else {
    delete env.CTXLINE_DISABLE;
  }
  const res = spawnMain(input, env);
  const raw = res.stdout || '';
  const clean = raw.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI for readable assertions
  return { code: res.status, raw, clean };
}

// Build a throwaway HOME containing a tokenless credentials file (so getApiUsage
// bails out before any network/keychain call) and optionally a seeded usage cache
// of a given age. Lets us exercise the cache-first / stale-fallback logic offline.
function seedHome({ cacheAgeMs, percentage = 42, weeklyPercentage = 31 } = {}) {
  const home = makeHome();
  seedCredentials(home); // no accessToken -> API skipped
  if (cacheAgeMs != null) {
    seedUsageCache(home, {
      fiveHour: { percentage, resetsAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() },
      // 62h out -> exercises the day-aware countdown (2d14h)
      weekly: { percentage: weeklyPercentage, resetsAt: new Date(Date.now() + 62 * 3600 * 1000).toISOString() }
    }, Date.now() - cacheAgeMs);
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
// Claude Code pipes only five_hour and seven_day here — never a model-scoped limit.
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

// Add model-scoped limits to an already-seeded cache, so the render path can be tested
// without a network call. Each entry is { label, percentage }; the reset is 62h out.
function seedScopedCache(home, models) {
  const cacheFile = path.join(home, '.claude', 'cache', 'usage-cache.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  cache.data.models = models.map(m => ({
    ...m,
    resetsAt: new Date(Date.now() + 62 * 3600 * 1000).toISOString()
  }));
  seedUsageCache(home, cache.data, cache.timestamp);
}

// Make a real dir with a seeded .git/HEAD so the branch segment renders deterministically.
function seedRepo(branch = 'feature/x') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  seedFakeRepo(dir, branch);
  after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

// Real git repo whose HEAD is `ahead` commits ahead and `behind` behind a tracked
// upstream (origin/<branch>), so `git rev-list @{u}...HEAD` reports real counts.
function seedDivergedRepo({ ahead = 0, behind = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-gitdiv-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  buildDivergedRepo(dir, { ahead, behind });
  return dir;
}

// Throwaway HOME so each git test gets an isolated git-cache.json.
function freshHome() {
  const home = makeHome();
  after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return home;
}

// ANSI color codes the script emits (kept in sync with statusline.js `colors`).
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const ORANGE = '\x1b[38;5;208m';
const RED = '\x1b[31m';
const PURPLE = '\x1b[38;5;135m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const BLINK = '\x1b[5m';

// renderStatusLine/renderSubagentTask are pure (no fs/child_process/network), so format,
// colour-band, segment-order and wrap assertions call them directly instead of spawning a
// child process. What's left spawned: git-branch/ahead-behind detection (real .git dir +
// subprocess), the usage cache/API pipeline, CTXLINE_DISABLE env-parsing (module-load-time
// state, needs a fresh process per value), and the execution-contract tests below.
const { parseScopedLimits, parseUsagePayload, readStdinThen, renderStatusLine, renderSubagentTask, compareVersions, parseRegistryVersion, VERSION } = require('../statusline.js');

// Same shape as fixture()'s stdin JSON, but as a plain object (no JSON round-trip needed
// for a direct call).
function dataObj(remaining, dir = '/tmp/myproject', model = 'Opus 4.8', effort, cost) {
  return JSON.parse(fixture(remaining, dir, model, effort, cost));
}

// facts a git-free, task-free directory produces (what collectFacts returns absent any
// repo/task/COLUMNS); override individual fields per test.
function plainFacts(overrides = {}) {
  return { dirname: 'myproject', branch: '', sync: '', task: '', update: '', cols: undefined, ...overrides };
}

function render(data, facts, usage) {
  const raw = renderStatusLine(data, facts, usage);
  return { raw, clean: raw.replace(/\x1b\[[0-9;]*m/g, '') };
}

test('line assembly: dir basename | model | context, separated by │', () => {
  const { clean } = render(dataObj(40, '/home/me/cool-project', 'Sonnet 4.6'), plainFacts({ dirname: 'cool-project' }));
  const parts = clean.split(' │ ');
  assert.strictEqual(parts[0], 'cool-project');        // basename only
  assert.strictEqual(parts[1], 'Sonnet 4.6');          // model passes through
  assert.match(parts[2], /^C\d+ /);                    // compact context label "C60 ███░░░"
});

test('model name is shortened: "(1M context)" -> "(1M)"', () => {
  const { clean } = render(dataObj(40, '/home/me/p', 'Opus 4.8 (1M context)'), plainFacts());
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
  after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const { clean } = run(fixture(40, dir));
  assert.match(clean.split(' │ ')[0], /⎇ abc1234$/);   // first 7 chars of the SHA
});

test('worktree (.git is a file with gitdir:) -> branch still renders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-wt-'));
  const gitdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-wtgit-'));
  fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/feature/wt\n');
  fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${gitdir}\n`); // .git as a file pointer
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(gitdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const { clean } = run(fixture(40, dir));
  assert.match(clean.split(' │ ')[0], /⎇ feature\/wt$/);
});

test('control chars in a hand-crafted HEAD are stripped from the branch', () => {
  const repo = seedRepo('bad\x1b[31mname\x07');   // injected ANSI escape + BEL
  const { raw, clean } = run(fixture(40, repo));
  assert.ok(!raw.includes('\x1b[31mname'), 'injected escape sequence must not reach output');
  assert.match(clean.split(' │ ')[0], /⎇ bad\[31mname$/);  // printable remainder kept, controls gone
});

test('thinking effort renders next to the model (· <level>)', () => {
  const { clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8', 'high'), plainFacts());
  const parts = clean.split(' │ ');
  assert.match(parts[1], /Opus 4\.8 · high$/);
});

test('no effort field -> model segment unchanged', () => {
  const { clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8'), plainFacts());
  const parts = clean.split(' │ ');
  assert.strictEqual(parts[1], 'Opus 4.8');
});

test('effort = max is red', () => {
  const { raw, clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8', 'max'), plainFacts());
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8 · max');
  assert.ok(raw.includes(RED), 'expected red for max effort');
});

test('effort = ultracode is purple', () => {
  const { raw, clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8', 'ultracode'), plainFacts());
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8 · ultracode');
  assert.ok(raw.includes(PURPLE), 'expected purple for ultracode effort');
});

test('effort = xhigh is dim (not highlighted red/purple)', () => {
  const { raw, clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8', 'xhigh'), plainFacts());
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8 · xhigh');
  assert.ok(raw.includes(DIM), 'xhigh effort uses the dim style');
  assert.ok(!raw.includes(PURPLE) && !raw.includes(RED), 'xhigh must not be highlighted');
});

test('session cost renders as $X.XX (two decimals)', () => {
  const { clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8', undefined, 0.4), plainFacts());
  assert.match(clean, /\$0\.40\b/);                    // 0.4 -> "$0.40"
});

test('session cost is dim', () => {
  const { raw } = render(dataObj(40, '/no/such/repo', 'Opus 4.8', undefined, 1.5), plainFacts());
  assert.ok(raw.includes(`${DIM}$1.50`), 'expected dim-rendered cost');
});

test('no cost field -> segment omitted (finite-guarded, no $)', () => {
  const { clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8'), plainFacts());
  assert.ok(!clean.includes('$'), 'cost segment should be absent without cost.total_cost_usd');
});

test('cost renders after usage and before task', () => {
  // No task active (facts.task='') -> cost is the last segment.
  const usage = { current: 'H42', weekly: 'W31' };
  const { clean } = render(dataObj(40, '/no/such/repo', 'Opus 4.8', undefined, 0.42), plainFacts(), usage);
  const parts = clean.split(' │ ');
  const costIdx = parts.findIndex(p => p.includes('$0.42'));
  const weeklyIdx = parts.findIndex(p => p === 'W31');
  assert.ok(costIdx > weeklyIdx, 'cost should come after the weekly usage segment');
  assert.strictEqual(costIdx, parts.length - 1, 'cost is the last segment when no task is active');
});

test('context bar shows used% = 100 - remaining', () => {
  const { clean } = render(dataObj(65), plainFacts());
  assert.match(clean, /C35 /);                    // remaining 65 -> used 35 -> "C35 <bar>"
});

test('threshold: used < 50 is green', () => {
  const { raw } = render(dataObj(60), plainFacts());                    // used 40
  assert.ok(raw.includes(GREEN), 'expected green color code');
});

test('threshold: 50 <= used < 65 is yellow', () => {
  const { raw } = render(dataObj(40), plainFacts());                    // used 60
  assert.ok(raw.includes(YELLOW), 'expected yellow color code');
});

test('threshold: 65 <= used < 80 is orange', () => {
  const { raw } = render(dataObj(25), plainFacts());                    // used 75
  assert.ok(raw.includes(ORANGE), 'expected orange color code');
});

test('threshold: used >= 80 is blinking red, no emoji', () => {
  const { raw, clean } = render(dataObj(10), plainFacts());             // used 90
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

test('malformed workspace.current_dir (non-string) -> no crash, exit 0', () => {
  // A non-string current_dir throws from path.basename/resolveGitDir inside collectFacts,
  // which runs outside outputStatus's try/catch (in emit()) -- collectFacts must swallow it.
  const { code, clean } = run(JSON.stringify({
    model: { display_name: 'Opus 4.8' },
    workspace: { current_dir: 12345 },
    session_id: 'test-session',
    context_window: { remaining_percentage: 40 }
  }));
  assert.strictEqual(code, 0);
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

// #41: a failed/timed-out refresh must still respect FRESH_TTL_MS before retrying, the same
// as a successful one -- otherwise every render re-hits a failing API instead of backing off.

test('#41: cold cache + failing API -> repeated renders make at most one attempt per cooldown', () => {
  const home = seedHome({}); // credentials with no accessToken, no cache file at all
  const cacheFile = path.join(home, '.claude', 'cache', 'usage-cache.json');

  run(fixture(40), { home, usage: true });
  assert.ok(fs.existsSync(cacheFile), 'a failed attempt should still record lastAttempt');
  const first = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.ok(Number.isFinite(first.lastAttempt));

  run(fixture(40), { home, usage: true }); // immediately after -> still in cooldown
  const second = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.strictEqual(second.lastAttempt, first.lastAttempt, 'render within FRESH_TTL_MS should not re-attempt');
});

test('#41: stale cache + failing API -> repeated renders make at most one attempt per cooldown', () => {
  const home = seedHome({ cacheAgeMs: 2 * 60 * 1000, percentage: 57 }); // > FRESH, < STALE
  const cacheFile = path.join(home, '.claude', 'cache', 'usage-cache.json');

  const first = run(fixture(40), { home, usage: true });
  assert.match(first.clean, /H57\b/, 'stale cache still served while the refresh fails');
  const afterFirst = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.ok(Date.now() - afterFirst.lastAttempt < 5000, 'the failed refresh should stamp lastAttempt to now');
  assert.strictEqual(afterFirst.data.fiveHour.percentage, 57, 'recording the attempt must not clobber the cached data');

  const second = run(fixture(40), { home, usage: true }); // immediately after -> still in cooldown
  assert.match(second.clean, /H57\b/, 'still served from stale cache, no crash');
  const afterSecond = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.strictEqual(afterSecond.lastAttempt, afterFirst.lastAttempt, 'render within FRESH_TTL_MS should not re-attempt');
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

// Model-scoped weekly limits ("Fable weekly limit at 86%"). The /usage payload reports
// these in a `limits` array; they never appear on stdin, so they always come from the
// cache/API path. parseScopedLimits is exercised directly against the real payload shape.

// A trimmed copy of a real GET /api/oauth/usage response: the legacy seven_day_<model>
// keys are all null, and the live scoped limit lives in `limits`.
function usagePayload({ scopedPercent = 86, model = 'Fable' } = {}) {
  return {
    five_hour: { utilization: 43, resets_at: '2026-08-02T17:00:00+00:00' },
    seven_day: { utilization: 63, resets_at: '2026-08-05T13:00:00+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
      { kind: 'session', group: 'session', percent: 43, resets_at: '2026-08-02T17:00:00+00:00', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 63, resets_at: '2026-08-05T13:00:00+00:00', scope: null },
      {
        kind: 'weekly_scoped', group: 'weekly', percent: scopedPercent, severity: 'warning',
        resets_at: '2026-08-05T13:00:00+00:00', is_active: true,
        scope: { model: { id: null, display_name: model } }
      }
    ]
  };
}

test('parseScopedLimits picks weekly_scoped out of the limits array', () => {
  const scoped = parseScopedLimits(usagePayload());
  assert.deepStrictEqual(scoped, [
    { label: 'F', percentage: 86, resetsAt: '2026-08-05T13:00:00+00:00' }
  ]);
});

test('parseScopedLimits ignores session and weekly_all entries', () => {
  // percent 43 (session) and 63 (weekly_all) must not leak in as scoped bars.
  const scoped = parseScopedLimits(usagePayload());
  assert.strictEqual(scoped.length, 1, 'only the weekly_scoped entry is a model bar');
  assert.ok(!scoped.some(s => s.percentage === 43 || s.percentage === 63));
});

test('parseScopedLimits labels by model initial, so a new family needs no code change', () => {
  assert.strictEqual(parseScopedLimits(usagePayload({ model: 'Opus' }))[0].label, 'O');
  assert.strictEqual(parseScopedLimits(usagePayload({ model: 'sonnet' }))[0].label, 'S');
  assert.strictEqual(parseScopedLimits(usagePayload({ model: 'Newmodel' }))[0].label, 'N');
});

test('parseScopedLimits skips malformed entries instead of rendering NaN', () => {
  const payload = usagePayload();
  payload.limits.push({ kind: 'weekly_scoped', percent: null, scope: { model: { display_name: 'Ghost' } } });
  payload.limits.push({ kind: 'weekly_scoped', percent: 50, scope: { model: {} } });
  payload.limits.push({ kind: 'weekly_scoped', percent: 50, scope: null });
  const scoped = parseScopedLimits(payload);
  assert.strictEqual(scoped.length, 1, 'only the well-formed entry survives');
  assert.ok(!scoped.some(s => s.label === 'G'));
});

test('parseScopedLimits falls back to legacy seven_day_<model> keys when limits is absent', () => {
  const legacy = {
    five_hour: { utilization: 43 },
    seven_day_opus: { utilization: 77, resets_at: '2026-08-05T13:00:00+00:00' },
    seven_day_sonnet: null
  };
  assert.deepStrictEqual(parseScopedLimits(legacy), [
    { label: 'O', percentage: 77, resetsAt: '2026-08-05T13:00:00+00:00' }
  ]);
});

test('parseScopedLimits does not double-count when both shapes are present', () => {
  const both = usagePayload();
  both.seven_day_opus = { utilization: 77, resets_at: '2026-08-05T13:00:00+00:00' };
  const scoped = parseScopedLimits(both);
  assert.strictEqual(scoped.length, 1, 'the limits array wins outright');
  assert.strictEqual(scoped[0].label, 'F');
});

test('no scoped limits -> nothing extra renders', () => {
  assert.deepStrictEqual(parseScopedLimits({ five_hour: { utilization: 43 } }), []);
  const { clean } = run(fixtureWithRateLimits(40), { usage: true });
  assert.match(clean, /H24\b/);
  assert.match(clean, /W41\b/);
  assert.ok(!/\bF\d+/.test(clean), 'no F bar when the account reports no scoped limit');
});

// parseUsagePayload is the pure adapter lifted out of getApiUsage's response closure —
// getApiUsage itself runs in zero tests (needs a live socket), so this is the only unit
// coverage for the half of the pipeline that breaks first on a payload change. Returns the
// same { fiveHour, weekly, models } shape as buildUsageFromStdin.

test('parseUsagePayload parses a real /usage response body into { fiveHour, weekly, models }', () => {
  const parsed = parseUsagePayload(JSON.stringify(usagePayload()));
  assert.deepStrictEqual(parsed, {
    fiveHour: { percentage: 43, resetsAt: '2026-08-02T17:00:00+00:00' },
    weekly: { percentage: 63, resetsAt: '2026-08-05T13:00:00+00:00' },
    models: [{ label: 'F', percentage: 86, resetsAt: '2026-08-05T13:00:00+00:00' }]
  });
});

test('parseUsagePayload returns null when five_hour is missing', () => {
  assert.strictEqual(parseUsagePayload(JSON.stringify({ seven_day: { utilization: 50 } })), null);
});

test('parseUsagePayload returns null when five_hour.utilization is non-finite', () => {
  assert.strictEqual(parseUsagePayload(JSON.stringify({ five_hour: { utilization: 'NaN' } })), null);
});

test('parseUsagePayload omits weekly when seven_day is absent', () => {
  const parsed = parseUsagePayload(JSON.stringify({ five_hour: { utilization: 43 } }));
  assert.deepStrictEqual(parsed, { fiveHour: { percentage: 43, resetsAt: null }, weekly: null, models: [] });
});

test('parseUsagePayload falls back to legacy seven_day_<model> keys for models', () => {
  const legacy = {
    five_hour: { utilization: 43 },
    seven_day_opus: { utilization: 77, resets_at: '2026-08-05T13:00:00+00:00' },
    seven_day_sonnet: null
  };
  const parsed = parseUsagePayload(JSON.stringify(legacy));
  assert.deepStrictEqual(parsed.models, [{ label: 'O', percentage: 77, resetsAt: '2026-08-05T13:00:00+00:00' }]);
});

test('parseUsagePayload returns null on unparseable JSON instead of throwing', () => {
  assert.strictEqual(parseUsagePayload('not json'), null);
});

// readStdinThen is the single guarded reader shared by both entry points (main and
// subagent). A stdin error used to throw unhandled on the main path only — this
// exercises that exact reader against a fake stdin, since a real stdin error can't
// be forced reliably through a spawned child's pipe.
test('readStdinThen finishes exactly once on a stdin error, never throws', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const fake = new EventEmitter();
  fake.setEncoding = () => {};
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  try {
    let calls = 0;
    let result;
    assert.doesNotThrow(() => {
      readStdinThen(1000, (input) => { calls++; result = input; });
      fake.emit('data', '{"partial":true');
      fake.emit('error', new Error('EPIPE'));
      fake.emit('end'); // must not double-fire after 'error' already finished
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(result, '{"partial":true');
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
});

test('readStdinThen finishes on timeout with whatever was read so far', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  const fake = new EventEmitter();
  fake.setEncoding = () => {};
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  try {
    return new Promise((resolve) => {
      readStdinThen(10, (input) => {
        assert.strictEqual(input, '{"partial":true');
        resolve();
      });
      fake.emit('data', '{"partial":true');
    });
  } finally {
    Object.defineProperty(process, 'stdin', original);
  }
});

// Rendering: scoped bars come from the cache, including on the stdin fast path.

test('scoped bar renders alongside the stdin H/W bars', () => {
  // The crux of the feature: stdin supplies H/W (no network), the scoped limit comes from
  // the cache. Before this, a scoped limit could never reach the screen in a live session.
  const home = seedHome({ cacheAgeMs: 5000 });
  seedScopedCache(home, [{ label: 'F', percentage: 86 }]);
  const { code, clean } = run(fixtureWithRateLimits(40), { home, usage: true });
  assert.strictEqual(code, 0);
  assert.match(clean, /H24\b/, 'H still comes from stdin, not the cache');
  assert.match(clean, /W41\b/, 'W still comes from stdin');
  assert.match(clean, /F86\b/, 'scoped bar comes from the cache');
});

test('scoped bars render after W, in payload order', () => {
  const home = seedHome({ cacheAgeMs: 5000 });
  seedScopedCache(home, [{ label: 'O', percentage: 12 }, { label: 'F', percentage: 86 }]);
  const { clean } = run(fixtureWithRateLimits(40), { home, usage: true });
  const parts = clean.split('│').map(s => s.trim());
  const idx = (re) => parts.findIndex(p => re.test(p));
  assert.ok(idx(/^W\d+/) < idx(/^O\d+/), 'W precedes the scoped bars');
  assert.ok(idx(/^O\d+/) < idx(/^F\d+/), 'scoped bars keep payload order');
});

test('scoped bars are orange below 90, not threshold-colored', () => {
  // 12% would be green and 71% yellow on the usage scheme; scoped bars flatten both to
  // orange so H/W keep sole ownership of the full color-as-severity signal.
  const home = seedHome({ cacheAgeMs: 5000 });
  seedScopedCache(home, [{ label: 'O', percentage: 12 }, { label: 'F', percentage: 71 }]);
  const { raw } = run(fixtureWithRateLimits(40), { home, usage: true });
  assert.ok(raw.includes(`${ORANGE}O12`), 'low scoped bar uses the fixed orange');
  assert.ok(raw.includes(`${ORANGE}F71`), 'mid scoped bar uses the same orange');
  assert.ok(!raw.includes(`${GREEN}O12`), 'scoped bar is not threshold-colored');
});

test('scoped bars turn red at 90+', () => {
  const home = seedHome({ cacheAgeMs: 5000 });
  seedScopedCache(home, [{ label: 'O', percentage: 89 }, { label: 'F', percentage: 90 }]);
  const { raw } = run(fixtureWithRateLimits(40), { home, usage: true });
  assert.ok(raw.includes(`${ORANGE}O89`), '89 stays orange');
  assert.ok(raw.includes(`${RED}F90`), '90 is the red boundary');
});

test('CTXLINE_DISABLE=usage also hides the scoped bars', () => {
  const home = seedHome({ cacheAgeMs: 5000 });
  seedScopedCache(home, [{ label: 'F', percentage: 86 }]);
  const { clean } = run(fixtureWithRateLimits(40), { home, usage: true, disable: 'usage' });
  assert.ok(!/\bF\d+/.test(clean), 'scoped bar is part of the usage segment');
  assert.ok(!clean.includes('H24'), 'H bar hidden too');
});

test('#41: stdin path respects the same cooldown for the scoped-models refresh', () => {
  const home = seedHome({ cacheAgeMs: 2 * 60 * 1000, percentage: 57 }); // > FRESH, < STALE
  seedScopedCache(home, [{ label: 'F', percentage: 86 }]);
  const cacheFile = path.join(home, '.claude', 'cache', 'usage-cache.json');

  const first = run(fixtureWithRateLimits(40), { home, usage: true });
  assert.match(first.clean, /H24\b/, 'H/W come from stdin regardless of cooldown');
  assert.match(first.clean, /F86\b/, 'scoped bar still comes from the stale cache while the refresh fails');
  const afterFirst = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.ok(Date.now() - afterFirst.lastAttempt < 5000, 'the failed refresh should stamp lastAttempt to now');

  const second = run(fixtureWithRateLimits(40), { home, usage: true }); // immediately after -> still in cooldown
  assert.match(second.clean, /F86\b/, 'still served from the stale cache on the next render');
  const afterSecond = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.strictEqual(afterSecond.lastAttempt, afterFirst.lastAttempt, 'render within FRESH_TTL_MS should not re-attempt');
});

test('a cache written before scoped bars existed stays valid', () => {
  // No `models` key at all — must be accepted (H/W render, no scoped bars) rather than
  // rejected as malformed, which would force a refetch for everyone on upgrade.
  const home = seedHome({ cacheAgeMs: 5000, percentage: 42, weeklyPercentage: 31 });
  const { clean } = run(fixture(40), { home, usage: true });
  assert.match(clean, /H42\b/, 'legacy cache without models is still readable');
  assert.match(clean, /W31\b/);
  assert.ok(!/\bF\d+/.test(clean));
});

test('stdin rate_limits takes precedence over a fresh cache', () => {
  // Fresh cache says 42% / 31%; stdin says 23.5% / 41.2%. stdin must win (cache not read).
  const home = seedHome({ cacheAgeMs: 5000, percentage: 42, weeklyPercentage: 31 });
  const { clean } = run(fixtureWithRateLimits(40), { home, usage: true });
  assert.match(clean, /H24\b/);
  assert.ok(!clean.includes('H42'), 'cached 5h value must not appear when stdin rate_limits is present');
});

// Responsive layout: usage/cost/task wrap to a second line only when the rendered line
// overflows facts.cols. Width unknown or line fits -> single. layout() reads facts.cols
// directly (no env access), so these are direct renderStatusLine calls.

test('narrow terminal wraps usage to a second line (line1 identity+context, line2 usage)', () => {
  const usage = { current: 'H24 ↺ 2h', weekly: 'W41 ↺ 2d14h' };
  const { raw, clean } = render(dataObj(40), plainFacts({ cols: 30 }), usage);
  assert.ok(raw.includes('\n'), 'expected a line break on a narrow terminal');
  const [l1, l2] = clean.split('\n');
  assert.match(l1, /C\d+ /, 'context stays on line 1');
  assert.ok(!/[HW]\d+/.test(l1), 'usage must not be on line 1 when wrapped');
  assert.match(l2, /H\d+\b/, 'current usage moves to line 2');
  assert.match(l2, /W\d+\b/, 'weekly usage moves to line 2');
});

test('wide terminal keeps everything on one line', () => {
  const usage = { current: 'H24 ↺ 2h', weekly: 'W41 ↺ 2d14h' };
  const { raw, clean } = render(dataObj(40), plainFacts({ cols: 200 }), usage);
  assert.ok(!raw.includes('\n'), 'no wrap when the line fits');
  assert.match(clean, /C\d+ .*H\d+\b.*W\d+\b/, 'context + usage all on one line');
});

test('unknown width (cols undefined) never wraps', () => {
  const usage = { current: 'H24 ↺ 2h', weekly: 'W41 ↺ 2d14h' };
  const { raw } = render(dataObj(40), plainFacts({ cols: undefined }), usage);
  assert.ok(!raw.includes('\n'), 'absent cols -> single line (no regression on old clients)');
});

test('narrow terminal with no usage/cost/task stays single line', () => {
  // Only identity + context exist (no usage passed) -> nothing to wrap.
  const { raw } = render(dataObj(40, '/no/such/repo', 'Opus 4.8'), plainFacts({ cols: 10 }));
  assert.ok(!raw.includes('\n'), 'empty line2 -> single line regardless of width');
});

test('narrow wrap puts cost on line 2 alongside usage', () => {
  const usage = { current: 'H24 ↺ 2h', weekly: 'W41 ↺ 2d14h' };
  const { clean } = render(dataObj(40, '/tmp/myproject', 'Opus 4.8', undefined, 1.23), plainFacts({ cols: 30 }), usage);
  const [l1, l2] = clean.split('\n');
  assert.ok(!l1.includes('$1.23'), 'cost must not be on line 1');
  assert.match(l2, /\$1\.23\b/, 'cost wraps to line 2');
});

// Git ahead/behind: counts come from a guarded, cache-fronted `git rev-list`. Needs real git.

test('ahead of upstream -> ↑N in the branch segment', (t) => {
  if (!hasGit()) return t.skip('git not available');
  const dir = seedDivergedRepo({ ahead: 2 });
  const { clean } = run(fixture(40, dir), { home: freshHome() });
  assert.match(clean, /⎇ \S+ ↑2/, 'expected ↑2');
  assert.ok(!clean.includes('↓'), 'no behind marker when only ahead');
});

test('behind upstream -> ↓N in the branch segment', (t) => {
  if (!hasGit()) return t.skip('git not available');
  const dir = seedDivergedRepo({ behind: 3 });
  const { clean } = run(fixture(40, dir), { home: freshHome() });
  assert.match(clean, /⎇ \S+ ↓3/, 'expected ↓3');
  assert.ok(!clean.includes('↑'), 'no ahead marker when only behind');
});

test('diverged -> ↑N↓M (ahead then behind)', (t) => {
  if (!hasGit()) return t.skip('git not available');
  const dir = seedDivergedRepo({ ahead: 2, behind: 1 });
  const { clean } = run(fixture(40, dir), { home: freshHome() });
  assert.match(clean, /⎇ \S+ ↑2↓1/, 'expected ↑2↓1');
});

test('ahead is green, behind is red', (t) => {
  if (!hasGit()) return t.skip('git not available');
  const dir = seedDivergedRepo({ ahead: 2, behind: 1 });
  const { raw } = run(fixture(40, dir), { home: freshHome() });
  assert.ok(raw.includes(`${GREEN}↑2`), 'ahead count should be green');
  assert.ok(raw.includes(`${RED}↓1`), 'behind count should be red');
});

test('in sync with upstream -> no ahead/behind marker', (t) => {
  if (!hasGit()) return t.skip('git not available');
  const dir = seedDivergedRepo({ ahead: 0, behind: 0 });
  const { clean } = run(fixture(40, dir), { home: freshHome() });
  assert.match(clean, /⎇ \S+/, 'branch still renders');
  assert.ok(!clean.includes('↑') && !clean.includes('↓'), 'no marker when in sync');
});

test('no upstream -> branch renders, no ahead/behind marker', (t) => {
  if (!hasGit()) return t.skip('git not available');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-noup-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  gitCommit(dir, 'base');                                  // committed, but no upstream configured
  const { clean } = run(fixture(40, dir), { home: freshHome() });
  assert.match(clean, /⎇ \S+/, 'branch renders');
  assert.ok(!clean.includes('↑') && !clean.includes('↓'), 'no marker without an upstream');
});

test('counts are cached: a commit within the TTL does not change the rendered count', (t) => {
  if (!hasGit()) return t.skip('git not available');
  const home = freshHome();                                // shared across both renders -> shared cache
  const dir = seedDivergedRepo({ ahead: 1 });
  const first = run(fixture(40, dir), { home });
  assert.match(first.clean, /↑1/, 'first render shows ↑1 and writes cache');
  gitCommit(dir, 'extra');                                 // now actually ↑2
  const second = run(fixture(40, dir), { home });          // within 5s TTL -> cache hit
  assert.match(second.clean, /↑1/, 'cached ↑1 reused; git not re-run');
  assert.ok(!second.clean.includes('↑2'), 'fresh count must not appear within the TTL');
});

// Segment opt-out via CTXLINE_DISABLE (comma list; dir/model/context always render).

// HOME seeded with an in-progress todo so the task segment renders for the session id.
function seedTodo(activeForm) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-todo-'));
  after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const todosDir = path.join(home, '.claude', 'todos');
  fs.mkdirSync(todosDir, { recursive: true });
  fs.writeFileSync(path.join(todosDir, 'test-session-agent-1.json'),
    JSON.stringify([{ status: 'in_progress', activeForm }]));
  return home;
}

test('disable=cost hides cost; model + context intact', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', undefined, 0.42), { disable: 'cost' });
  assert.ok(!clean.includes('$'), 'cost hidden');
  assert.match(clean, /Opus 4\.8/, 'model still renders');
  assert.match(clean, /C\d+ /, 'context still renders');
});

test('disable=effort drops the · level suffix', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', 'high'), { disable: 'effort' });
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8', 'no "· high"');
});

test('disable=branch hides the branch (and ahead/behind) glyph', () => {
  const repo = seedRepo('feature/x');
  const { clean } = run(fixture(40, repo), { disable: 'branch' });
  assert.ok(!clean.includes('⎇'), 'branch segment hidden');
});

test('disable=usage hides H/W', () => {
  const home = seedHome({ cacheAgeMs: 5000, percentage: 42, weeklyPercentage: 31 });
  const { clean } = run(fixture(40), { home, usage: true, disable: 'usage' });
  assert.ok(!clean.includes('H42') && !clean.includes('W31'), 'usage segments hidden');
  assert.ok(!clean.includes('↺'), 'no reset countdown');
  assert.match(clean, /C\d+ /, 'context still renders');
});

test('disable=task hides the in-progress todo', () => {
  const home = seedTodo('Refactoring usage cache');
  assert.match(run(fixture(40), { home }).clean, /Refactoring usage cache/, 'task shows by default (control)');
  const { clean } = run(fixture(40), { home, disable: 'task' });
  assert.ok(!clean.includes('Refactoring usage cache'), 'task hidden when disabled');
});

test('disable with an unknown token changes nothing', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', undefined, 0.42), { disable: 'bogus,nope' });
  assert.match(clean, /\$0\.42/, 'cost still renders for unknown tokens');
});

test('disable accepts multiple segments', () => {
  const { clean } = run(fixture(40, '/no/such/repo', 'Opus 4.8', 'high', 0.42), { disable: 'cost,effort' });
  assert.ok(!clean.includes('$'), 'cost hidden');
  assert.strictEqual(clean.split(' │ ')[1], 'Opus 4.8', 'effort hidden');
});

// Subagent mode (subagentStatusLine): `node statusline.js subagent` reads stdin
// `{ tasks: [...] }` and prints one `{id, content}` JSON line per task with an id.
// content is JSON-encoded, so its \x1b bytes arrive as literal "" text in raw
// stdout — parse each line first, then strip ANSI from the decoded content.

function runSubagent(input, opts = {}) {
  const home = opts.home || FAKE_HOME;
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const res = spawnSubagent(input, env);
  const raw = res.stdout || '';
  const lines = raw.trim() ? raw.trim().split('\n').map(l => JSON.parse(l)) : [];
  return { code: res.status, raw, lines };
}

function cleanContent(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// renderSubagentTask is pure (task -> string), so format/order assertions call it directly.
// Only the emitSubagent wrapper's payload-filtering contract (bad JSON, no tasks array, a
// task without an id) still needs a spawn — see below.

test('subagent: full task renders name │ model · effort │ context bar │ elapsed time', () => {
  const content = renderSubagentTask({
    id: 't1', name: 'reviewer', model: 'claude-opus-5', effort: 'max',
    tokenCount: 45200, contextWindowSize: 200000,
    startTime: Math.floor(Date.now() / 1000) - 252 // epoch-seconds, 4m12s ago
  });
  const parts = cleanContent(content).split(' │ ');
  assert.strictEqual(parts[0], 'reviewer');
  assert.strictEqual(parts[1], 'Opus 5 · max');
  assert.match(parts[2], /^C23 /);                    // 45200/200000 = 22.6% -> rounds to 23
  assert.match(parts[3], /^⏱ 4m\d{1,2}s$/);            // 4m12s ago, still under 5m
  assert.ok(content.includes(RED), 'max effort is red, same as the main line');
});

test('subagent: absent model and effort -> only name and elapsed time render', () => {
  const startTime = Date.now() - 18000; // epoch-ms, 18s ago
  const content = renderSubagentTask({ id: 't2', name: 'explorer', startTime });
  assert.match(cleanContent(content), /^explorer │ ⏱ \d{1,2}s$/); // 18s ago, still under 1m
});

test('subagent: absent startTime -> no elapsed segment', () => {
  const content = renderSubagentTask({ id: 't2b', name: 'explorer', tokenCount: 800, contextWindowSize: 1000 });
  assert.ok(!cleanContent(content).includes('⏱'), 'no elapsed segment without startTime');
});

test('subagent: unparseable startTime -> no elapsed segment', () => {
  const content = renderSubagentTask({ id: 't2d', name: 'explorer', startTime: 'not-a-date' });
  assert.ok(!cleanContent(content).includes('⏱'), 'no elapsed segment for an unparseable startTime');
});

test('subagent: ISO string startTime is accepted', () => {
  const startTime = new Date(Date.now() - 5000).toISOString(); // 5s ago
  const content = renderSubagentTask({ id: 't2c', name: 'x', startTime });
  assert.match(cleanContent(content), /^x │ ⏱ \d{1,2}s$/); // 5s ago, still under 1m
});

test('subagent: absent effort (inherited) -> model renders alone, no "· effort"', () => {
  const content = renderSubagentTask({ id: 't3', name: 'x', model: 'claude-sonnet-5' });
  assert.strictEqual(cleanContent(content), 'x │ Sonnet 5');
});

test('subagent: numeric effort (token budget) renders as-is, dim', () => {
  const content = renderSubagentTask({ id: 't4', name: 'x', model: 'claude-haiku-4-5-20251001', effort: 12000 });
  assert.strictEqual(cleanContent(content), 'x │ Haiku 4.5 · 12000');
  assert.ok(content.includes(`${DIM} · 12000`), 'numeric effort uses the dim style');
});

test('subagent: bad payload -> no output lines, exit 0', () => {
  const { code, raw } = runSubagent('not json at all');
  assert.strictEqual(code, 0);
  assert.strictEqual(raw, '');
});

test('subagent: missing tasks array -> no output, exit 0', () => {
  const { code, raw } = runSubagent('{}');
  assert.strictEqual(code, 0);
  assert.strictEqual(raw, '');
});

test('subagent: task without an id is skipped', () => {
  const { raw } = runSubagent(JSON.stringify({ tasks: [{ name: 'noid' }] }));
  assert.strictEqual(raw, '');
});

test('subagent: model-ID shortening - "claude-opus-5" -> "Opus 5"', () => {
  const content = renderSubagentTask({ id: 't', model: 'claude-opus-5' });
  assert.strictEqual(cleanContent(content), 'agent │ Opus 5');
});

test('subagent: model-ID shortening strips a trailing build date - "claude-haiku-4-5-20251001" -> "Haiku 4.5"', () => {
  const content = renderSubagentTask({ id: 't', model: 'claude-haiku-4-5-20251001' });
  assert.strictEqual(cleanContent(content), 'agent │ Haiku 4.5');
});

test('subagent: model-ID shortening strips us./anthropic. vendor prefixes', () => {
  const content = renderSubagentTask({ id: 't', model: 'us.anthropic.claude-opus-5' });
  assert.strictEqual(cleanContent(content), 'agent │ Opus 5');
});

// --- update nudge ---------------------------------------------------------------

test('compareVersions: orders releases, and refuses anything that is not x.y.z', () => {
  assert.strictEqual(compareVersions('1.9.0', '1.6.2'), 1);
  assert.strictEqual(compareVersions('1.6.2', '1.9.0'), -1);
  assert.strictEqual(compareVersions('1.6.2', '1.6.2'), 0);
  assert.strictEqual(compareVersions('1.10.0', '1.9.0'), 1);   // numeric, not lexical
  assert.strictEqual(compareVersions('2.0.0-beta.1', '1.6.2'), null);
  assert.strictEqual(compareVersions('1.6', '1.6.2'), null);
  assert.strictEqual(compareVersions(undefined, '1.6.2'), null);
});

test('parseRegistryVersion: pulls version from a manifest, null on anything else', () => {
  assert.strictEqual(parseRegistryVersion('{"name":"ctxline-claude","version":"1.9.0"}'), '1.9.0');
  assert.strictEqual(parseRegistryVersion('{"version":"2.0.0-beta.1"}'), null);
  assert.strictEqual(parseRegistryVersion('{"error":"Not found"}'), null);
  assert.strictEqual(parseRegistryVersion('<html>502</html>'), null);
  assert.strictEqual(parseRegistryVersion(''), null);
});

test('update nudge: own row below the statusline, main line untouched', () => {
  const { raw, clean } = render(
    dataObj(40, '/tmp/myproject', 'Opus 4.8', undefined, 0.42),
    plainFacts({ update: '1.9.0', task: 'Refactoring' })
  );
  const rows = clean.split('\n');
  assert.strictEqual(rows.length, 2, 'exactly one extra row');
  // The nudge is appended, never mixed into the statusline's own segments.
  assert.deepStrictEqual(rows[0].split(' │ ').slice(-2), ['$0.42', 'Refactoring']);
  assert.strictEqual(rows[1], '⬆ 1.9.0 available · npx ctxline-claude@latest');
  assert.ok(raw.includes(`${GREEN}⬆ 1.9.0`), 'arrow and version are green');
  assert.ok(raw.includes(`${BOLD}npx ctxline-claude@latest`), 'command is bold — the copy-paste target');
});

test('update nudge: absent when facts carry no update', () => {
  const { clean } = render(dataObj(40), plainFacts());
  assert.ok(!clean.includes('⬆'), 'no nudge row without a cached newer version');
  assert.ok(!clean.includes('\n'), 'stays a single line');
});

test('update nudge: rides along with the responsive wrap as a third row', () => {
  const { clean } = render(
    dataObj(40, '/tmp/myproject', 'Opus 4.8', undefined, 0.42),
    plainFacts({ update: '1.9.0', task: 'Refactoring', cols: 40 })
  );
  assert.strictEqual(clean.split('\n').length, 3);
});

test('update nudge: a newer cached version renders; an older one does not', () => {
  const newer = freshHome();
  seedUpdateCache(newer, { latest: '99.0.0' });
  assert.match(run(fixture(40), { home: newer }).clean, /⬆ 99\.0\.0 available · npx ctxline-claude@latest/);

  const older = freshHome();
  seedUpdateCache(older, { latest: '0.0.1' });
  assert.ok(!run(fixture(40), { home: older }).clean.includes('⬆'));
});

test('update nudge: CTXLINE_DISABLE=update hides it', () => {
  const home = freshHome();
  seedUpdateCache(home, { latest: '99.0.0' });
  const { clean } = run(fixture(40), { home, disable: 'update' });
  assert.ok(!clean.includes('⬆'), 'nudge suppressed');
  assert.match(clean, /^myproject │ /, 'the rest of the line is untouched');
  assert.ok(!clean.includes('\n'), 'no extra row');
});

test('VERSION matches package.json — a release must bump both', () => {
  // Installers copy statusline.js alone into ~/.claude/hooks/, with no package.json beside
  // it, so the running version has to live in the file. If the two drift, every installed
  // copy compares a stale VERSION against npm and nudges for an update forever.
  assert.strictEqual(VERSION, require('../package.json').version);
});
