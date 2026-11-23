// Bundle budget gate (CI). Run after `pnpm build`:
//   pnpm build && pnpm bundle:budget
//
// Two different numbers matter, and they are checked separately:
//   * the side panel's ENTRY chunk, which Chrome parses before the panel can paint. It has
//     an absolute cap, so a library added to the shell cannot quietly make every open slow.
//   * the REACHABLE bytes for an entry point: the entry chunk plus every chunk it imports,
//     directly or through another chunk. This is what a user downloads, so it is held to a
//     small tolerance over a recorded baseline.
//
// The full-tab workbench (`table.html`) is tracked as its own entry point, so its growth
// cannot hide inside the side panel's numbers.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.output', 'chrome-mv3');
const CHUNKS = join(OUT, 'chunks');

// Recorded after Sprint 2.1 (workbench entry point, Data Table 2.0, vendor chunks).
// Re-baseline only with a recorded reason in docs/DECISIONS.md.
const BASELINE = {
  sidepanelReachable: 833241,
  tableReachable: 662669,
  content: 280109,
  background: 284844,
};
const TOLERANCE = 0.05;
const SIDEPANEL_ENTRY_LIMIT = 500000; // 500 kB: the shell must stay quick to open.

function findEntry(prefix) {
  const candidates = [];
  for (const dir of [CHUNKS, OUT]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (new RegExp(`^${prefix}-.*\\.js$`).test(name) || name === `${prefix}.js`) {
        const full = join(dir, name);
        if (statSync(full).isFile()) candidates.push(full);
      }
    }
  }
  // WXT hashes entry chunks; if a prefix ever matches more than one file, the largest is the
  // entry itself and the rest are shared chunks with a similar name.
  return candidates.sort((a, b) => statSync(b).size - statSync(a).size)[0] ?? null;
}

const IMPORT_PATTERN = /(?:from\s*|import\s*\(\s*|import\s+|export\s+[^'"]*?from\s*)["'](\.{1,2}\/[^"']+)["']/g;

/** The entry chunk plus every chunk reachable from it, without counting a chunk twice. */
function reachableChunks(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = resolve(dirname(file), match[1]);
      if (existsSync(target) && target.endsWith('.js')) queue.push(target);
    }
  }
  return seen;
}

function totalBytes(files) {
  return Array.from(files).reduce((sum, file) => sum + statSync(file).size, 0);
}

function fileSize(path) {
  return path && existsSync(path) ? statSync(path).size : null;
}

const sidepanelEntry = findEntry('sidepanel');
const tableEntry = findEntry('table');
const contentFile = join(OUT, 'content-scripts', 'content.js');
const backgroundFile = join(OUT, 'background.js');

const sidepanelChunks = sidepanelEntry ? reachableChunks(sidepanelEntry) : null;
const tableChunks = tableEntry ? reachableChunks(tableEntry) : null;

const sizes = {
  sidepanelReachable: sidepanelChunks ? totalBytes(sidepanelChunks) : null,
  tableReachable: tableChunks ? totalBytes(tableChunks) : null,
  content: fileSize(contentFile),
  background: fileSize(backgroundFile),
};

let failed = false;

const sidepanelEntrySize = fileSize(sidepanelEntry);
if (sidepanelEntrySize == null) {
  console.error(`Missing side panel entry chunk under ${CHUNKS}. Run \`pnpm build\` first.`);
  failed = true;
} else {
  const over = sidepanelEntrySize > SIDEPANEL_ENTRY_LIMIT;
  console.log(
    `sidepanel entry: ${sidepanelEntrySize} B (cap ${SIDEPANEL_ENTRY_LIMIT} B) -> ${over ? 'OVER' : 'OK'}`
  );
  if (over) failed = true;
}

for (const [name, base] of Object.entries(BASELINE)) {
  const actual = sizes[name];
  if (actual == null) {
    console.error(`Missing built file for ${name} under ${OUT}. Run \`pnpm build\` first.`);
    failed = true;
    continue;
  }
  if (base === 0) {
    // First run after the Sprint 2.1 re-baseline; the numbers are printed to be recorded.
    console.log(`${name}: ${actual} B (no baseline recorded yet) -> RECORD`);
    continue;
  }
  const limit = Math.floor(base * (1 + TOLERANCE));
  const pct = ((actual - base) / base) * 100;
  const over = actual > limit;
  console.log(
    `${name}: ${actual} B (baseline ${base} B, +${pct.toFixed(2)}%), limit ${limit} B -> ${over ? 'OVER' : 'OK'}`
  );
  if (over) failed = true;
}

if (sidepanelChunks) {
  console.log(
    `sidepanel reachable: ${sidepanelChunks.size} chunk(s), ${totalBytes(sidepanelChunks)} B`
  );
}
if (tableChunks) {
  console.log(`table reachable: ${tableChunks.size} chunk(s), ${totalBytes(tableChunks)} B`);
}

process.exit(failed ? 1 : 0);
