/**
 * Measures the production detection and extraction code in real Chromium, on generated
 * pages of 100, 1,000 and 5,000 records. It reports what it measures and sets no targets,
 * because there was no baseline before this.
 *
 * Usage: pnpm benchmark:performance
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputDirectory = join(root, 'artifacts/benchmark');
const SIZES = [100, 1000, 5000];
const RUNS = 5;

const bundled = await build({
  stdin: {
    contents: `
      import { autoDetectLists } from '@/core/detection/detector';
      import { discoverFieldsInCluster, suggestionsToFieldDefinitions } from '@/core/detection/fields';
      import { extractRecordsFromContainers } from '@/core/extraction/extractor';
      import { detectTables } from '@/core/extraction/table-extractor';
      window.PH = { autoDetectLists, discoverFieldsInCluster, suggestionsToFieldDefinitions, extractRecordsFromContainers, detectTables };
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  write: false,
  alias: { '@': join(root, 'src') },
  logLevel: 'silent',
});
const script = bundled.outputFiles[0].text;

function pageFor(size) {
  const menu = Array.from({ length: 30 }, (_, i) => `<li><a href="/m/${i}">Menu ${i}</a></li>`).join('');
  const cards = Array.from(
    { length: size },
    (_, i) => `<article class="card"><img src="/i/${i}.jpg" alt="Item ${i}"><h3><a href="/p/${i}" title="Full name of item ${i}">Item ${i}</a></h3>
      <p class="description">Description of item number ${i} in this list.</p><span class="price">$${i}.50</span>
      <span class="stock">In stock</span><a class="buy" href="/buy/${i}">Buy now</a></article>`
  ).join('');
  const rows = Array.from({ length: size }, (_, i) => `<tr><td>Name ${i}</td><td>City ${i}</td><td>${i}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><title>Performance</title></head><body>
    <nav><ul>${menu}</ul></nav><main><div class="results">${cards}</div>
    <table id="data"><thead><tr><th>Name</th><th>City</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>
    </main></body></html>`;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
const results = [];

for (const size of SIZES) {
  const page = await browser.newPage();
  await page.setContent(pageFor(size), { waitUntil: 'load' });
  await page.addScriptTag({ content: script });

  const run = await page.evaluate(
    ({ runs, expected }) => {
      const timing = { autoDetect: [], fieldDiscovery: [], extraction: [], tableDetection: [] };
      const time = (name, work) => {
        const started = performance.now();
        const result = work();
        timing[name].push(performance.now() - started);
        return result;
      };
      const heapStart = performance.memory?.usedJSHeapSize ?? null;
      let extracted = 0;
      let top = 0;
      let columns = 0;
      for (let run = 0; run < runs; run++) {
        const lists = time('autoDetect', () => window.PH.autoDetectLists(document));
        top = lists[0]?.itemCount ?? 0;
        const items = Array.from(document.querySelectorAll('.card'));
        const fields = time('fieldDiscovery', () =>
          window.PH.suggestionsToFieldDefinitions(window.PH.discoverFieldsInCluster(items))
        );
        columns = fields.length;
        const result = time('extraction', () => window.PH.extractRecordsFromContainers(items, fields));
        extracted = result.records.length;
        time('tableDetection', () => window.PH.detectTables(document));
      }
      return {
        timing,
        extracted,
        top,
        columns,
        expected,
        domElements: document.querySelectorAll('*').length,
        heapStart,
        heapEnd: performance.memory?.usedJSHeapSize ?? null,
      };
    },
    { runs: RUNS, expected: size }
  );
  await page.close();

  if (run.extracted !== size) {
    throw new Error(`Expected ${size} records but extracted ${run.extracted}, so the timings mean nothing.`);
  }

  results.push({
    records: size,
    domElements: run.domElements,
    columns: run.columns,
    topListItems: run.top,
    medianMs: Object.fromEntries(Object.entries(run.timing).map(([name, values]) => [name, Math.round(median(values) * 10) / 10])),
    maxMs: Object.fromEntries(Object.entries(run.timing).map(([name, values]) => [name, Math.round(Math.max(...values) * 10) / 10])),
    heapUsedMb: run.heapEnd === null ? null : Math.round((run.heapEnd / 1048576) * 10) / 10,
  });
}

const version = browser.version();
await browser.close();

const report = { date: new Date().toISOString(), browser: version, runsPerSize: RUNS, results };
const lines = [
  '# Performance measurements',
  '',
  `- Date: ${report.date}`,
  `- Browser: Chrome for Testing ${version}, headless`,
  `- Method: production code bundled and run in the page, ${RUNS} runs per size, median and slowest shown`,
  '',
  '| Records | DOM elements | Auto-detect | Field discovery | Extraction | Table detection | JS heap |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...results.map(
    (r) =>
      `| ${r.records} | ${r.domElements} | ${r.medianMs.autoDetect} ms (max ${r.maxMs.autoDetect}) | ${r.medianMs.fieldDiscovery} ms (max ${r.maxMs.fieldDiscovery}) | ${r.medianMs.extraction} ms (max ${r.maxMs.extraction}) | ${r.medianMs.tableDetection} ms (max ${r.maxMs.tableDetection}) | ${r.heapUsedMb ?? 'n/a'} MB |`
  ),
  '',
];
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'performance.json'), JSON.stringify(report, null, 2));
await writeFile(join(outputDirectory, 'performance.md'), lines.join('\n'));
console.log(lines.join('\n'));
