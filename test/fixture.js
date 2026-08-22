// Shared test/preview fixture: fake HOME construction, usage-cache seeding, diverged git
// repos, and spawn wrappers for both statusline.js entry points. Required by both
// test/render.test.js and scripts/preview.js so the on-disk shapes they seed can never
// silently drift from what the real writer produces. Dev-only -- outside the package.json
// `files` whitelist, never ships.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serializeUsageCache } = require('../statusline.js');

const SCRIPT = path.join(__dirname, '..', 'statusline.js');

// Fresh throwaway HOME with .claude/cache pre-created. Caller owns cleanup.
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'cache'), { recursive: true });
  return home;
}

// Tokenless credentials file -- getApiUsage bails before any network/keychain call.
function seedCredentials(home) {
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
}

// Seed usage-cache.json through the real writer's serialization, so a reader/writer format
// mismatch can't happen. `timestamp` defaults to now; pass an offset to exercise the
// stale/expired-cache fallback paths.
function seedUsageCache(home, data, timestamp = Date.now()) {
  fs.writeFileSync(
    path.join(home, '.claude', 'cache', 'usage-cache.json'),
    serializeUsageCache(data, timestamp)
  );
}

// Fake .git/HEAD pointing at `branch` -- enough for the branch segment, no real git needed.
function seedFakeRepo(dir, branch) {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
}

function git(dir, args) { return spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); }
function hasGit() { return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0; }
function gitCommit(dir, tag) {
  fs.writeFileSync(path.join(dir, 'f-' + tag), tag);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', tag]);
}

// Build a real git repo (already created at `dir`) diverged `ahead`/`behind` commits from a
// tracked upstream (origin/<branch>), so `git rev-list @{u}...HEAD` reports real counts.
// `branch`, if given, forces the displayed branch name; otherwise git's default is kept.
// Returns the resolved branch name. Throws if git is unavailable -- callers that need a
// graceful fallback (no git installed) wrap the call in their own try/catch.
function seedDivergedRepo(dir, { ahead = 0, behind = 0, branch } = {}) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'remote.origin.url', '.']);
  git(dir, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  gitCommit(dir, 'base');
  if (branch) git(dir, ['branch', '-M', branch]);
  const resolvedBranch = branch || git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const baseSha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  for (let i = 0; i < behind; i++) gitCommit(dir, 'up' + i);
  const upstreamSha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  git(dir, ['update-ref', 'refs/remotes/origin/' + resolvedBranch, upstreamSha]);
  git(dir, ['config', 'branch.' + resolvedBranch + '.remote', 'origin']);
  git(dir, ['config', 'branch.' + resolvedBranch + '.merge', 'refs/heads/' + resolvedBranch]);
  git(dir, ['reset', '--hard', '-q', baseSha]);
  for (let i = 0; i < ahead; i++) gitCommit(dir, 'local' + i);
  return resolvedBranch;
}

// Spawn statusline.js's main entry point with the given stdin string and env.
function spawnMain(input, env) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', timeout: 5000, env });
}

// Spawn statusline.js's subagent entry point (`node statusline.js subagent`).
function spawnSubagent(input, env) {
  return spawnSync(process.execPath, [SCRIPT, 'subagent'], { input, encoding: 'utf8', timeout: 5000, env: env || process.env });
}

module.exports = {
  SCRIPT, makeHome, seedCredentials, seedUsageCache, seedFakeRepo,
  git, hasGit, gitCommit, seedDivergedRepo, spawnMain, spawnSubagent
};
