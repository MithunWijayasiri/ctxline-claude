// Renders one real statusline line (including the usage bar) so CI logs and the
// GitHub release show what you actually get in the Claude Code CLI.
//
// The usage bar normally needs a live session. Here we seed a fresh usage cache
// (+ a tokenless credentials file) in a throwaway HOME, so the real statusline.js
// renders the usage segment from cache without any network call.

const fs = require('node:fs');
const path = require('node:path');
const {
  makeHome, seedCredentials, seedUsageCache, seedFakeRepo, seedDivergedRepo, spawnMain, spawnSubagent
} = require('../test/fixture.js');

// makeHome() creates each scenario's home independently (os.tmpdir()-rooted, not nested
// under a shared parent) -- track them here for one cleanup pass on exit.
const HOMES = [];
process.on('exit', () => {
  for (const home of HOMES) {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// Build a real diverged git repo (ahead 2, behind 1) in `projectDir` so statusline.js
// renders ↑2↓1. Best-effort: returns true on success, false if git is unavailable (caller
// falls back to a fake .git/HEAD so the line — and the release body — still render).
function setupDivergedRepo(projectDir, branch) {
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    seedDivergedRepo(projectDir, { ahead: 2, behind: 1, branch });
    return true;
  } catch (e) {
    return false;
  }
}

function render({ dir, model, remaining, current, currentResetsInMin, weekly, weeklyResetsInMin, models, branch, effort, rateLimits, cost, columns, diverged, disable }) {
  const home = makeHome();
  HOMES.push(home);
  // Only H/W bypass the cache: with rateLimits and no models, seed neither creds nor cache,
  // proving that path needs no network. Model-scoped bars never arrive via stdin, so seed a
  // fresh cache whenever `models` is set — rateLimits or not (statusline.js reads both).
  if (!rateLimits || models) {
    seedCredentials(home); // no token -> no network
    seedUsageCache(home, {
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
    }); // fresh timestamp (default) -> cache-first renders it
  }

  // Real on-disk dir so the branch segment renders. `diverged` builds a real repo with an
  // upstream (for ↑N↓M); otherwise (or if git is missing) seed a fake .git/HEAD — statusline.js
  // reads it directly. basename(currentDir) keeps the displayed dir name.
  const projectDir = path.join(home, dir);
  if (!(diverged && setupDivergedRepo(projectDir, branch))) {
    seedFakeRepo(projectDir, branch);
  }

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.ANTHROPIC_API_KEY;                             // let the usage path run
  // Width drives the responsive wrap. Force it per-scenario so output is deterministic
  // regardless of the terminal running preview (and the primary line never wraps).
  if (columns != null) env.COLUMNS = String(columns);
  else delete env.COLUMNS;
  if (disable != null) env.CTXLINE_DISABLE = disable;       // segment opt-out scenario
  else delete env.CTXLINE_DISABLE;

  const res = spawnMain(JSON.stringify({
    model: { display_name: model },
    workspace: { current_dir: projectDir },
    session_id: 'preview',
    context_window: { remaining_percentage: remaining },
    effort: { level: effort },
    ...(cost != null ? { cost: { total_cost_usd: cost } } : {}),
    ...(rateLimits ? { rate_limits: rateLimits } : {})
  }), env);

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
// getRawUsage() for the scoped bars even when stdin covered H/W, so all three must
// render together.
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

// Subagent panel (subagentStatusLine mode): separate entry point (`node statusline.js
// subagent`), separate stdin shape ({ tasks: [...] }), no cache/HOME seeding needed since
// it reads only stdin. Two tasks cover both branches: full row, and no-effort (inherited).
function renderSubagentPanel(tasks) {
  const res = spawnSubagent(JSON.stringify({ tasks }));
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`statusline.js subagent exited with ${res.status}\n${res.stderr || ''}`);
  }
  const byId = new Map(
    (res.stdout || '').trim().split('\n').filter(Boolean).map(line => {
      const o = JSON.parse(line);
      return [o.id, o.content];
    })
  );
  return tasks.map(t => byId.get(t.id) || `(default rendering: ${t.id})`);
}

console.log('\nSubagent panel (2 running tasks):');
const nowSecPanel = Math.floor(Date.now() / 1000);
for (const line of renderSubagentPanel([
  { id: 't1', name: 'reviewer', model: 'claude-opus-5', effort: 'high', tokenCount: 45200, contextWindowSize: 200000, startTime: nowSecPanel - 252 },
  { id: 't2', name: 'explorer', model: 'claude-sonnet-5', tokenCount: 12400, contextWindowSize: 200000, startTime: nowSecPanel - 15 }
])) {
  console.log('  ' + line);
}