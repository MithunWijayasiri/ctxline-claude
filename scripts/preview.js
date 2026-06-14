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
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

function render({ dir, model, remaining, current, currentResetsInMin, weekly, weeklyResetsInMin, branch, effort, rateLimits }) {
  const home = fs.mkdtempSync(path.join(TMP, 'home-'));
  const cacheDir = path.join(home, '.claude', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  // rateLimits scenario seeds neither creds nor cache, proving the stdin path bypasses
  // the network/cache flow entirely. Otherwise seed a fresh cache (cache-first renders it).
  if (!rateLimits) {
    fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}'); // no token -> no network
    fs.writeFileSync(path.join(cacheDir, 'usage-cache.json'), JSON.stringify({
      timestamp: Date.now(),                                  // fresh -> cache-first renders it
      data: {
        fiveHour: { percentage: current, resetsAt: new Date(Date.now() + currentResetsInMin * 60000).toISOString() },
        weekly: { percentage: weekly, resetsAt: new Date(Date.now() + weeklyResetsInMin * 60000).toISOString() }
      }
    }));
  }

  // Real on-disk dir with a seeded .git/HEAD so the branch segment renders (statusline.js
  // reads .git/HEAD directly). basename(currentDir) keeps the displayed dir name.
  const projectDir = path.join(home, dir);
  fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.ANTHROPIC_API_KEY;                             // let the usage path run

  const res = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({
      model: { display_name: model },
      workspace: { current_dir: projectDir },
      session_id: 'preview',
      context_window: { remaining_percentage: remaining },
      effort: { level: effort },
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
  weeklyResetsInMin: 3720    // renders "W31 ↺ 2d14h"
};

// Primary line (default effort). NOTE: this MUST stay the first printed line —
// the release workflow takes only line 1 (`head -n 1`) for the GitHub release body.
console.log(render({ ...base, effort: 'high' }));

// Thinking-effort color variants: only the top two levels are highlighted.
// (low < medium < high < xhigh < max < ultracode; xhigh stays dim, max red, ultracode purple.)
console.log('\nThinking-effort levels:');
for (const effort of ['xhigh', 'max', 'ultracode']) {
  console.log(`  ${effort.padEnd(9)} ${render({ ...base, effort })}`);
}

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
