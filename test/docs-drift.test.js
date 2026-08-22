// docs/index.html hand-authors two mocked statusline rows (hero example, subagent panel)
// as static markup so the marketing site doesn't need to run statusline.js. Nothing keeps
// those numbers/labels in sync with what the code actually renders -- #32 already found one
// such drift (a wrong reset countdown). This reconstructs each mock's visible text and
// byte-compares it against a real renderStatusLine()/renderSubagentTask() call for the same
// scenario, so a future drift fails CI instead of sitting unnoticed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { renderStatusLine, renderSubagentTask } = require('../statusline.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Pull the markup for the <div class="line...">...</div> that contains `marker` -- searches
// backward from the marker to the enclosing line div's opening tag (none of these rows nest
// a <div>, so the first </div> after that is always the row's own close).
function extractLine(marker) {
  const idx = HTML.indexOf(marker);
  assert.ok(idx !== -1, `marker not found in docs/index.html: ${marker}`);
  const lineStart = HTML.lastIndexOf('<div class="line', idx);
  const lineEnd = HTML.indexOf('</div>', lineStart);
  return HTML.slice(lineStart, lineEnd);
}

// Reconstruct the plain text a reader sees. Two elements carry no text content at all --
// the context bar (pure <i> boxes) and the "│" separators' surrounding gap (CSS padding/
// margin, not a text node in the tightly-packed subagent rows) -- so both are special-cased
// to match how renderContextBar()/SEGMENT_SEP actually format them, rather than relying on
// incidental whitespace in the source markup.
function htmlLineToText(html) {
  return html
    .replace(/<span class="bar">([\s\S]*?)<\/span>/g, (_, inner) => {
      const total = (inner.match(/<i/g) || []).length;
      const on = (inner.match(/<i class="on">/g) || []).length;
      return ' ' + '█'.repeat(on) + '░'.repeat(total - on);
    })
    .replace(/<span class="sep">│<\/span>/g, ' │ ')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('hero mock line matches a real renderStatusLine() output', () => {
  const mockText = htmlLineToText(extractLine('class="proj">my-project'));

  const data = {
    model: { display_name: 'Opus 4.8 (1M context)' },
    effort: { level: 'high' },
    context_window: { remaining_percentage: 55 }, // used 45 -> "C45"
    cost: { total_cost_usd: 44.21 }
  };
  const facts = { dirname: 'my-project', branch: 'main', sync: '↑2↓1', task: '', cols: undefined };
  const usage = { current: 'H14 ↺ 4h20m', weekly: 'W31 ↺ 2d13h' };
  const realText = stripAnsi(renderStatusLine(data, facts, usage));

  assert.strictEqual(mockText, realText, 'docs/index.html hero mock has drifted from a real render');
});

test('subagent mock rows match a real renderSubagentTask() output', () => {
  const scenarios = [
    {
      marker: '<span>architecture-review</span>',
      task: { id: 't', name: 'architecture-review', model: 'claude-opus-5', effort: 'max', tokenCount: 51000, contextWindowSize: 100000, startTime: Math.floor(Date.now() / 1000) - 252 }
    },
    {
      marker: '<span>test-coverage</span>',
      task: { id: 't', name: 'test-coverage', model: 'claude-sonnet-5', effort: 'high', tokenCount: 36000, contextWindowSize: 100000, startTime: Math.floor(Date.now() / 1000) - 108 }
    }
  ];

  for (const { marker, task } of scenarios) {
    // The "○ " bullet is docs/index.html's own chrome (a running-task marker), not
    // something renderSubagentTask ever emits -- strip it before comparing.
    const mockText = htmlLineToText(extractLine(marker)).replace(/^○\s*/, '');
    const realText = stripAnsi(renderSubagentTask(task));

    // Elapsed time is flavor text, not a fact derivable from anything else in the mock --
    // compare every segment exactly except accept any well-formed elapsed value.
    const mockParts = mockText.split(' │ ');
    const realParts = realText.split(' │ ');
    assert.strictEqual(mockParts.length, realParts.length, `${task.name}: segment count drifted`);
    for (let i = 0; i < mockParts.length - 1; i++) {
      assert.strictEqual(mockParts[i], realParts[i], `${task.name}: segment ${i} has drifted`);
    }
    // Matches formatElapsed()'s three branches: "<h>h<m>m", "<m>m<s>s", "<s>s".
    const elapsed = mockParts[mockParts.length - 1];
    assert.match(elapsed, /^⏱ (\d+h\d+m|\d+m\d{1,2}s|\d{1,2}s)$/, `${task.name}: elapsed segment "${elapsed}" isn't a well-formed duration`);
  }
});
