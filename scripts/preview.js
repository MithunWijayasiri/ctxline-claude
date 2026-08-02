// Renders one real statusline line (including the usage bar) so CI logs and the
// GitHub release show what you actually get in the Claude Code CLI.
//
// The usage bar normally needs a live session. Here we seed a fresh usage cache
// (+ a tokenless credentials file) in a throwaway HOME, so the real statusline.js
// renders the usage segment from cache without any network call.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'statusline.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-preview-'));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

// Build a real diverged git repo in `projectDir` so statusline.js renders ↑N↓M.
// Best-effort: returns true on success, false if git is unavailable (caller falls back
// to a fake .git/HEAD so the line — and the release body — still render).
function setupDivergedRepo(projectDir, branch) {
  try {
    const g = (args) => spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
    fs.mkdirSync(projectDir, { recursive: true });
    if (g(['init', '-q']).status !== 0) return false;
    const commit = (tag) => {
      fs.writeFileSync(path.join(projectDir, 'f-' + tag), tag);
      g(['add', '-A']); g(['commit', '-q', '-m', tag]);
    };
    g(['config', 'user.email', 't@t']); g(['config', 'user.name', 'preview']);
    g(['config', 'commit.gpgsign', 'false']);
    g(['config', 'remote.origin.url', '.']);
    g(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
    commit('base');
    g(['branch', '-M', branch]);                              // force the displayed branch name
    const baseSha = g(['rev-parse', 'HEAD']).stdout.trim();
    commit('up0');                                            // upstream +1 -> behind 1
    const upstreamSha = g(['rev-parse', 'HEAD']).stdout.trim();
    g(['update-ref', 'refs/remotes/origin/' + branch, upstreamSha]);
    g(['config', 'branch.' + branch + '.remote', 'origin']);
    g(['config', 'branch.' + branch + '.merge', 'refs/heads/' + branch]);
    g(['reset', '--hard', '-q', baseSha]);
    commit('local0'); commit('local1');                      // local +2 -> ahead 2
    return g(['rev-parse', '--git-dir']).status === 0;
  } catch (e) {
    return false;
  }
}

function render({ dir, model, remaining, current, currentResetsInMin, weekly, weeklyResetsInMin, models, branch, effort, rateLimits, cost, columns, diverged, disable }) {
  const home = fs.mkdtempSync(path.join(TMP, 'home-'));
  const cacheDir = path.join(home, '.claude', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  // Only H/W bypass the cache: with rateLimits and no models, seed neither creds nor cache,
  // proving that path needs no network. Model-scoped bars never arrive via stdin, so seed a
  // fresh cache whenever `models` is set — rateLimits or not (statusline.js reads both).
  if (!rateLimits || models) {
    fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}'); // no token -> no network
    fs.writeFileSync(path.join(cacheDir, 'usage-cache.json'), JSON.stringify({
      timestamp: Date.now(),                                  // fresh -> cache-first renders it
      data: {
        fiveHour: { percentage: current, resetsAt: new Date(Date.now() + currentResetsInMin * 60000).toISOString() },
        weekly: { percentage: weekly, resetsAt: new Date(Date.now() + weeklyResetsInMin * 60000).toISOString() },
        // Model-scoped weekly limits. The cache holds the already-derived label, so seed it
        // directly; statusline.js only derives F-from-Fable when parsing a live /usage payload.
        ...(models ? {
          models: models.map(m => ({
            label: m.label,
            percentage: m.percentage,
            resetsAt: new Date(Date.now() + m.resetsInMin * 60000).toISOString()
          }))
        } : {})
      }
    }));
  }

  // Real on-disk dir so the branch segment renders. `diverged` builds a real repo with an
  // upstream (for ↑N↓M); otherwise (or if git is missing) seed a fake .git/HEAD — statusline.js
  // reads it directly. basename(currentDir) keeps the displayed dir name.
  const projectDir = path.join(home, dir);
  if (!(diverged && setupDivergedRepo(projectDir, branch))) {
    fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  }

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.ANTHROPIC_API_KEY;                             // let the usage path run
  // Width drives the responsive wrap. Force it per-scenario so output is deterministic
  // regardless of the terminal running preview (and the primary line never wraps).
  if (columns != null) env.COLUMNS = String(columns);
  else delete env.COLUMNS;
  if (disable != null) env.CTXLINE_DISABLE = disable;       // segment opt-out scenario
  else delete env.CTXLINE_DISABLE;

  const res = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({
      model: { display_name: model },
      workspace: { current_dir: projectDir },
      session_id: 'preview',
      context_window: { remaining_percentage: remaining },
      effort: { level: effort },
      ...(cost != null ? { cost: { total_cost_usd: cost } } : {}),
      ...(rateLimits ? { rate_limits: rateLimits } : {})
    }),
    encoding: 'utf8',
    timeout: 5000,
    env
  });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`statusline.js exited with ${res.status}\n${res.stderr || ''}`);
  }
  const out = (res.stdout || '').trim();
  if (!out) throw new Error(`statusline.js produced no output\n${res.stderr || ''}`);
  return out;
}

const base = {
  dir: 'my-project',
  branch: 'main',
  model: 'Opus 4.8 (1M context)',
  remaining: 55,             // context 45% used
  current: 14,
  currentResetsInMin: 261,   // renders "H14 ↺ 4h21m"
  weekly: 31,
  weeklyResetsInMin: 3720,   // renders "W31 ↺ 2d14h"
  cost: 44.21                // renders dim "$44.21" (stdin cost.total_cost_usd)
};

// Primary line (default effort). NOTE: this MUST stay the first printed line —
// the release workflow takes only line 1 (`head -n 1`) for the GitHub release body.
// `diverged` shows ↑N↓M from a real upstream; falls back to no-counts if git is missing.
console.log(render({ ...base, effort: 'high', diverged: true }));

// Thinking-effort color variants: only the top two levels are highlighted.
// (low < medium < high < xhigh < max < ultracode; xhigh stays dim, max red, ultracode purple.)
console.log('\nThinking-effort levels:');
for (const effort of ['xhigh', 'max', 'ultracode']) {
  console.log(`  ${effort.padEnd(9)} ${render({ ...base, effort })}`);
}

// Responsive: on a narrow terminal the usage/cost/task segments wrap to a second line
// (width measured against COLUMNS). Wide terminals keep the single line above.
console.log('\nResponsive (narrow terminal, COLUMNS=40):');
console.log(render({ ...base, effort: 'high', columns: 40 }));

// Usage from stdin `rate_limits` (Pro/Max post-first-response): no cache, no creds.
// resets_at is a Unix epoch in seconds. Renders the same 5h/7d bars as the cache path.
const nowSec = Math.floor(Date.now() / 1000);
console.log('\nUsage from stdin rate_limits (no cache / no creds):');
console.log('  ' + render({
  ...base,
  effort: 'high',
  rateLimits: {
    five_hour: { used_percentage: base.current, resets_at: nowSec + base.currentResetsInMin * 60 },
    seven_day: { used_percentage: base.weekly, resets_at: nowSec + base.weeklyResetsInMin * 60 }
  }
}));

// Model-scoped weekly limit: an account can be near a per-model cap while the account-wide
// W bar is comfortable. Renders after W, labelled with the model's initial (Fable -> F).
// Cache/API only — these never arrive via stdin rate_limits.
console.log('\nModel-scoped weekly limit (Fable at 86%):');
console.log('  ' + render({
  ...base,
  effort: 'high',
  models: [{ label: 'F', percentage: 86, resetsInMin: base.weeklyResetsInMin }]
}));

// Combined: H/W from stdin, scoped bars still from cache — resolveUsage() calls
// getScopedModels() even when stdin covered H/W, so all three must render together.
console.log('\nStdin rate_limits + cached model-scoped limit:');
console.log('  ' + render({
  ...base,
  effort: 'high',
  rateLimits: {
    five_hour: { used_percentage: base.current, resets_at: nowSec + base.currentResetsInMin * 60 },
    seven_day: { used_percentage: base.weekly, resets_at: nowSec + base.weeklyResetsInMin * 60 }
  },
  models: [{ label: 'F', percentage: 86, resetsInMin: base.weeklyResetsInMin }]
}));

// Segment opt-out: CTXLINE_DISABLE hides segments (dir/model/context always render).
console.log('\nSegment opt-out (CTXLINE_DISABLE=usage,cost):');
console.log('  ' + render({ ...base, effort: 'high', disable: 'usage,cost' }));