// Regenerates the two statusline <tspan> runs inside docs/assets/preview.svg from a real
// render of statusline.js, so the marketing SVG can't silently drift from the code the way a
// hand-transcribed one did (#32). Hand-authored terminal chrome -- window dots, prompt text,
// the "Nebulizing…" status, the "○ " running-task bullet -- is left untouched; only the
// tspan runs inside the two statusline <text> elements are replaced.

const fs = require('node:fs');
const path = require('node:path');
const {
  makeHome, seedCredentials, seedUsageCache, seedFakeRepo, seedDivergedRepo, spawnMain, spawnSubagent
} = require('../test/fixture.js');

const SVG_PATH = path.join(__dirname, '..', 'docs', 'assets', 'preview.svg');

// ANSI SGR code -> hex, tuned to read against this SVG's GitHub-dark palette. Yellow/purple
// never occur in the two scenarios below but are mapped for completeness so a future
// scenario tweak (e.g. a yellow-band usage %) doesn't need a code change here too.
const ANSI_HEX = {
  '32': '#3fb950',        // green
  '33': '#e3b341',        // yellow (matches docs/index.html's .context-yellow)
  '31': '#f85149',        // red
  '38;5;208': '#f0883e',  // orange
  '38;5;135': '#bc8cff',  // purple
  '2': '#7d8590'          // dim
};
const DEFAULT_HEX = '#c9d1d9';   // plain (no escape) text
const SEP_HEX = '#30363d';       // ' │ ' segment separator, de-emphasized vs. plain text
const BAR_EMPTY_HEX = '#2d333b'; // unfilled '░' portion of a context/usage bar

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Split "...███░░░" on the filled/unfilled boundary so '█' and '░' get their own tspans --
// the SVG always renders the empty tail in a fixed dark gray, distinct from how a real
// terminal (one color for the whole bar) renders it.
function splitBar(text) {
  const m = text.match(/^([^█░]*█+)(░+.*)$/);
  return m ? [m[1], m[2]] : null;
}

// Parse one ANSI-colored line into [{ text, hex, bold? }] runs. `firstPlain`, if given,
// re-styles the first uncolored run (used for the directory name's brand treatment below --
// real ANSI carries no color for it, so that distinction is a deliberate rendering choice
// here, not something recoverable from the escape codes themselves).
function ansiToRuns(line, { firstPlain } = {}) {
  const runs = [];
  let currentHex = null; // null = no color active (plain/default text)
  let sawFirstPlain = false;
  let lastIndex = 0;

  const pushColored = (text, hex) => {
    if (!text) return;
    const bar = splitBar(text);
    if (bar) {
      runs.push({ text: bar[0], hex });
      runs.push({ text: bar[1], hex: BAR_EMPTY_HEX });
    } else {
      runs.push({ text, hex });
    }
  };

  // SEGMENT_SEP (' │ ') carries no escape of its own, so it can end up fused with adjacent
  // plain text into one flush (e.g. "reset} │ Opus 4.8" -- no escape between '│' and 'Opus').
  // Split it back out before assigning a color to what's left.
  const pushPlain = (text) => {
    const bits = text.split(' │ ');
    bits.forEach((bit, i) => {
      if (i > 0) runs.push({ text: ' │ ', hex: SEP_HEX });
      if (!bit) return;
      let hex = DEFAULT_HEX;
      let bold = false;
      if (!sawFirstPlain) {
        if (firstPlain) { hex = firstPlain.hex; bold = !!firstPlain.bold; }
        sawFirstPlain = true;
      }
      runs.push({ text: bit, hex, bold });
    });
  };

  const flush = (end) => {
    if (end <= lastIndex) return;
    const text = line.slice(lastIndex, end);
    if (currentHex == null) pushPlain(text);
    else pushColored(text, currentHex);
  };

  const re = /\x1b\[([0-9;]*)m/g;
  let match;
  while ((match = re.exec(line)) !== null) {
    flush(match.index);
    const code = match[1];
    if (code === '' || code === '0') currentHex = null;
    else if (code !== '5') currentHex = ANSI_HEX[code] ?? currentHex; // '5' = blink, no hex of its own
    lastIndex = re.lastIndex;
  }
  flush(line.length);
  return runs;
}

function runsToTspans(runs) {
  return runs.map(r => {
    const attrs = `fill="${r.hex}"` + (r.bold ? ' font-weight="700"' : '');
    return `<tspan ${attrs}>${esc(r.text)}</tspan>`;
  }).join('');
}

// Same scenario docs/assets/preview.svg has always shown -- regenerating from a real render
// should reproduce it exactly, just from code instead of by hand.
function renderPrimaryLine() {
  const home = makeHome();
  seedCredentials(home);
  seedUsageCache(home, {
    fiveHour: { percentage: 81, resetsAt: new Date(Date.now() + (2 * 60 + 21) * 60000).toISOString() },
    weekly: { percentage: 31, resetsAt: new Date(Date.now() + (2 * 24 * 60 + 14 * 60) * 60000).toISOString() }
  });
  const projectDir = path.join(home, 'my-project');
  fs.mkdirSync(projectDir, { recursive: true });
  try {
    seedDivergedRepo(projectDir, { ahead: 2, behind: 1, branch: 'main' });
  } catch (e) {
    seedFakeRepo(projectDir, 'main');
  }
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.ANTHROPIC_API_KEY;
  delete env.COLUMNS;
  delete env.CTXLINE_DISABLE;
  const res = spawnMain(JSON.stringify({
    model: { display_name: 'Opus 4.8 (1M context)' },
    workspace: { current_dir: projectDir },
    session_id: 'preview-svg',
    context_window: { remaining_percentage: 55 }, // used 45 -> "C45"
    effort: { level: 'high' },
    cost: { total_cost_usd: 44.21 }
  }), env);
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`statusline.js exited with ${res.status}\n${res.stderr || ''}`);
  return (res.stdout || '').trim();
}

function renderSubagentLine() {
  const res = spawnSubagent(JSON.stringify({
    tasks: [{
      id: 't1', name: 'Task 1: code-review', model: 'claude-fable-5', effort: 'high',
      tokenCount: 68000, contextWindowSize: 100000,
      // Targets "6m48s" but formatElapsed() re-reads the clock after the setup above runs
      // (mkdtemp, git spawns) -- a run landing just past a second boundary can render one
      // second later than this. Harmless jitter, not a bug; re-run if the diff bothers you.
      startTime: Math.floor(Date.now() / 1000) - (6 * 60 + 48)
    }]
  }));
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`statusline.js subagent exited with ${res.status}\n${res.stderr || ''}`);
  const { content } = JSON.parse((res.stdout || '').trim());
  return content;
}

function replaceTextContent(svg, openTag, tspans) {
  const start = svg.indexOf(openTag);
  if (start === -1) throw new Error(`preview.svg: couldn't find ${openTag}`);
  const contentStart = start + openTag.length;
  const contentEnd = svg.indexOf('</text>', contentStart);
  if (contentEnd === -1) throw new Error(`preview.svg: unterminated <text> after ${openTag}`);
  return svg.slice(0, contentStart) + tspans + svg.slice(contentEnd);
}

let svg = fs.readFileSync(SVG_PATH, 'utf8');

const primaryTspans = runsToTspans(
  ansiToRuns(renderPrimaryLine(), { firstPlain: { hex: '#d97757', bold: true } })
);
svg = replaceTextContent(svg, '<text x="28" y="354" font-size="14">', primaryTspans);

// The "○ " bullet is docs/index.html-style chrome marking a running task, hand-authored
// here too -- kept as-is, only the real render's tspans are appended after it.
const bulletTspan = '<tspan fill="#7d8590">○ </tspan>';
const subagentTspans = bulletTspan + runsToTspans(ansiToRuns(renderSubagentLine()));
svg = replaceTextContent(svg, '<text x="28" y="435" font-size="13">', subagentTspans);

fs.writeFileSync(SVG_PATH, svg);
console.log('docs/assets/preview.svg regenerated from a real render.');
