// Token totals per agent: the main line's tokens segment (stdin transcript_path) and each
// subagent row's (<session>/subagents/agent-<id>.jsonl). Format and placement call the pure
// renderers; reading transcripts (dedupe, incremental reads, partial lines, the subagent
// lookup, CTXLINE_DISABLE=tokens) spawns the real script against synthetic transcripts in
// a fake HOME. No network, no real transcripts.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { makeHome, spawnMain, spawnSubagent } = require('./fixture.js');
const { renderStatusLine, renderSubagentTask } = require('../statusline.js');

const HOMES = [];
after(() => {
  for (const home of HOMES) fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// A fake HOME with an empty transcript at <home>/projects/p/session.jsonl.
function setup() {
  const home = makeHome();
  HOMES.push(home);
  const dir = path.join(home, 'projects', 'p');
  fs.mkdirSync(path.join(dir, 'session', 'subagents'), { recursive: true });
  const transcript = path.join(dir, 'session.jsonl');
  fs.writeFileSync(transcript, '');
  return { home, transcript, subagents: path.join(dir, 'session', 'subagents') };
}

// One assistant record as Claude Code logs it. `usage` fields default to 0 when omitted.
function reply(id, { input = 0, read = 0, write = 0, output, sidechain = false } = {}) {
  const usage = { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write };
  if (output != null) usage.output_tokens = output;
  const record = { type: 'assistant', message: { id, role: 'assistant', content: [], usage } };
  if (sidechain) record.isSidechain = true;
  return JSON.stringify(record) + '\n';
}

function env(home, disable) {
  const e = { ...process.env, HOME: home, USERPROFILE: home, ANTHROPIC_API_KEY: 'test' };
  delete e.COLUMNS;
  if (disable) e.CTXLINE_DISABLE = disable;
  else delete e.CTXLINE_DISABLE;
  return e;
}

function mainLine(home, transcript, disable) {
  const input = JSON.stringify({
    model: { display_name: 'Opus 5.5' },
    workspace: { current_dir: '/tmp/myproject' },
    session_id: 'session',
    transcript_path: transcript,
    context_window: { remaining_percentage: 70 }
  });
  const res = spawnMain(input, env(home, disable));
  assert.strictEqual(res.status, 0);
  return clean(res.stdout || '');
}

function subagentRows(home, transcript, tasks, disable) {
  const res = spawnSubagent(JSON.stringify({ session_id: 'session', transcript_path: transcript, tasks }), env(home, disable));
  assert.strictEqual(res.status, 0);
  const raw = (res.stdout || '').trim();
  return raw ? raw.split('\n').map(l => JSON.parse(l)).map(r => ({ id: r.id, content: clean(r.content) })) : [];
}

const tokensOf = (line) => line.split(' │ ').find(s => /^R\S+ I\S+ O\S+/.test(s)) || '';

// ── format and placement (pure) ──

test('tokens: segment reads "R<cache reads> I<input> O<output>"', () => {
  const facts = { dirname: 'myproject', branch: '', sync: '', task: '', update: '', cols: undefined, tokens: { read: 617_000_000, input: 7_012_000, output: 1_530_000, partial: false } };
  const line = clean(renderStatusLine({ model: { display_name: 'Opus 5.5' } }, facts, null));
  assert.strictEqual(tokensOf(line), 'R617M I7.0M O1.5M');
});

test('tokens: counts scale through k, M and B', () => {
  const render = (n) => tokensOf(clean(renderStatusLine({}, { dirname: 'd', cols: undefined, tokens: { read: n, input: 0, output: 0 } }, null)));
  assert.strictEqual(render(999), 'R999 I0 O0');
  assert.strictEqual(render(1_530), 'R1.5k I0 O0');
  assert.strictEqual(render(12_345), 'R12k I0 O0');
  assert.strictEqual(render(2_410_000_000), 'R2.4B I0 O0');
});

test('tokens: sits after cost and before task on the main line', () => {
  const facts = { dirname: 'myproject', cols: undefined, task: 'Writing tests', tokens: { read: 2000, input: 1000, output: 500 } };
  const parts = clean(renderStatusLine({ cost: { total_cost_usd: 1.5 } }, facts, null)).split(' │ ');
  const cost = parts.indexOf('$1.50');
  assert.ok(cost > 0);
  assert.strictEqual(parts[cost + 1], 'R2.0k I1.0k O500');
  assert.strictEqual(parts[cost + 2], 'Writing tests');
});

test('tokens: no totals, or all zero -> no segment', () => {
  for (const tokens of [undefined, null, { read: 0, input: 0, output: 0 }]) {
    const line = clean(renderStatusLine({}, { dirname: 'd', cols: undefined, tokens }, null));
    assert.ok(!/R\S+ I\S+ O/.test(line), `unexpected tokens segment for ${JSON.stringify(tokens)}`);
  }
});

test('tokens: a transcript still being caught up on ends in …', () => {
  const line = clean(renderStatusLine({}, { dirname: 'd', cols: undefined, tokens: { read: 5000, input: 0, output: 0, partial: true } }, null));
  assert.strictEqual(tokensOf(line), 'R5.0k I0 O0…');
});

test('tokens: subagent row ends with its tokens segment', () => {
  const content = clean(renderSubagentTask({ id: 't', name: 'reviewer' }, { read: 85_000, input: 45_000, output: 3_200 }));
  assert.strictEqual(content, 'reviewer │ R85k I45k O3.2k');
});

// ── reading transcripts (spawned) ──

test('tokens: a reply logged several times while streaming counts once, at its last usage', () => {
  const { home, transcript } = setup();
  fs.writeFileSync(transcript,
    reply('m1', { read: 1000, write: 200 }) +             // stream start: no output yet
    reply('m1', { read: 1000, write: 200, output: 50 }) + // same reply, complete
    reply('m2', { input: 3, read: 1200, output: 70 }));
  assert.strictEqual(tokensOf(mainLine(home, transcript)), 'R2.2k I203 O120');
});

test('tokens: the main line leaves out sidechain (inline subagent) records', () => {
  const { home, transcript } = setup();
  fs.writeFileSync(transcript, reply('m1', { read: 1000, output: 10 }) + reply('s1', { read: 9000, output: 90, sidechain: true }));
  assert.strictEqual(tokensOf(mainLine(home, transcript)), 'R1.0k I0 O10');
});

test('tokens: later renders add only what was appended, and keep a reply counted once', () => {
  const { home, transcript } = setup();
  fs.writeFileSync(transcript, reply('m1', { read: 1000, output: 10 }));
  assert.strictEqual(tokensOf(mainLine(home, transcript)), 'R1.0k I0 O10');
  fs.appendFileSync(transcript, reply('m1', { read: 1000, output: 40 }) + reply('m2', { read: 2000, output: 5 }));
  assert.strictEqual(tokensOf(mainLine(home, transcript)), 'R3.0k I0 O45');
  assert.ok(fs.readdirSync(path.join(home, '.claude', 'cache', 'tokens')).length === 1, 'one state file per transcript');
});

test('tokens: a half-written last line waits for the next render', () => {
  const { home, transcript } = setup();
  const second = reply('m2', { read: 2000, output: 5 });
  fs.writeFileSync(transcript, reply('m1', { read: 1000, output: 10 }) + second.slice(0, 20));
  assert.strictEqual(tokensOf(mainLine(home, transcript)), 'R1.0k I0 O10');
  fs.appendFileSync(transcript, second.slice(20));
  assert.strictEqual(tokensOf(mainLine(home, transcript)), 'R3.0k I0 O15');
});

test('tokens: a transcript that shrank is counted again from the start', () => {
  const { home, transcript } = setup();
  fs.writeFileSync(transcript, reply('m1', { read: 1000, output: 10 }) + reply('m2', { read: 2000, output: 20 }));
  mainLine(home, transcript);
  fs.writeFileSync(transcript, reply('m3', { read: 500, output: 1 }));
  assert.strictEqual(tokensOf(mainLine(home, transcript)), 'R500 I0 O1');
});

test('tokens: no transcript_path, or a missing file -> no segment, exit 0', () => {
  const { home, transcript } = setup();
  assert.strictEqual(tokensOf(mainLine(home, undefined)), '');
  assert.strictEqual(tokensOf(mainLine(home, transcript + '.gone')), '');
});

test('tokens: CTXLINE_DISABLE=tokens skips the segment and the read', () => {
  const { home, transcript } = setup();
  fs.writeFileSync(transcript, reply('m1', { read: 1000, output: 10 }));
  assert.strictEqual(tokensOf(mainLine(home, transcript, 'tokens')), '');
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'cache', 'tokens')), 'nothing read, nothing cached');
});

test('tokens: a subagent row reads agent-<task id>.jsonl beside the session transcript', () => {
  const { home, transcript, subagents } = setup();
  fs.writeFileSync(transcript, reply('m1', { read: 99_000, output: 99 }));
  fs.writeFileSync(path.join(subagents, 'agent-a1.jsonl'), reply('x1', { read: 40_000, write: 5000, output: 300 }) + reply('x2', { read: 45_000, output: 20 }));
  const rows = subagentRows(home, transcript, [{ id: 'a1', name: 'reviewer' }, { id: 'a2', name: 'tester' }]);
  assert.deepStrictEqual(rows, [
    { id: 'a1', content: 'reviewer │ R85k I5.0k O320' },
    { id: 'a2', content: 'tester' }
  ]);
});

test('tokens: a subagent with no file of its id is found by the description in its meta', () => {
  const { home, transcript, subagents } = setup();
  fs.writeFileSync(path.join(subagents, 'agent-zz.jsonl'), reply('x1', { read: 2000, output: 30 }));
  fs.writeFileSync(path.join(subagents, 'agent-zz.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find the parser' }));
  const rows = subagentRows(home, transcript, [{ id: 'other-id', description: 'Find the parser' }]);
  assert.strictEqual(rows[0].content, 'Find the parser │ R2.0k I0 O30');
});

test('tokens: CTXLINE_DISABLE=tokens leaves subagent rows as before', () => {
  const { home, transcript, subagents } = setup();
  fs.writeFileSync(path.join(subagents, 'agent-a1.jsonl'), reply('x1', { read: 2000, output: 30 }));
  const rows = subagentRows(home, transcript, [{ id: 'a1', name: 'reviewer' }], 'tokens');
  assert.strictEqual(rows[0].content, 'reviewer');
});
