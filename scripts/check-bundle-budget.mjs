// Bundle budget gate (CI): fails if sidepanel, content.js, or background.js
// grow more than 5% over the redesign baseline (feat/sidepanel-ux-redesign @ 30f2851).
// The side panel has an additional absolute cap of 530 kB. Run after `pnpm build`:
//   pnpm build && pnpm bundle:budget
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, '.output', 'chrome-mv3');

// Recorded baseline sizes (bytes) after the sidepanel-ux-redesign.
const BASELINE = {
  sidepanel: 526486,
  content: 266839,
  background: 273078,
};
const TOLERANCE = 0.05;
const SIDEPANEL_ABSOLUTE_LIMIT = 530000; // 530 kB (decimal, as reported by WXT)

function findSize(pattern, dir) {
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (pattern.test(name) && statSync(full).isFile()) return statSync(full).size;
    }
  } catch {
    return null;
  }
  return null;
}

const sizes = {
  sidepanel: findSize(/^sidepanel-.*\.js$/, join(OUT, 'chunks')),
  content: existsSync(join(OUT, 'content-scripts', 'content.js'))
    ? statSync(join(OUT, 'content-scripts', 'content.js')).size
    : null,
  background: existsSync(join(OUT, 'background.js'))
    ? statSync(join(OUT, 'background.js')).size
    : null,
};

let failed = false;
for (const [name, base] of Object.entries(BASELINE)) {
  const actual = sizes[name];
  if (actual == null) {
    console.error(`Missing built file for ${name} under ${OUT}. Run \`pnpm build\` first.`);
    failed = true;
    continue;
  }
  const limit = Math.floor(base * (1 + TOLERANCE));
  const pct = ((actual - base) / base) * 100;
  const over = actual > limit;
  const overAbsolute = name === 'sidepanel' && actual > SIDEPANEL_ABSOLUTE_LIMIT;
  console.log(
    `${name}: ${actual} B (baseline ${base} B, +${pct.toFixed(2)}%), limit ${limit} B${name === 'sidepanel' ? `, absolute 530 kB` : ''} -> ${over || overAbsolute ? 'OVER' : 'OK'}`
  );
  if (over || overAbsolute) failed = true;
}

process.exit(failed ? 1 : 0);
