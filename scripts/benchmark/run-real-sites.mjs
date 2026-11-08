/* global chrome, document, indexedDB, URL */
/**
 * The real-site benchmark. It uses the built extension the way a person does: open the
 * panel, run a tool, choose a list, start a job. It then compares what was saved with truth
 * read separately from the same pages by hand-written selectors. It never logs in, solves a
 * challenge or crawls beyond the bounded pages listed in tests/benchmark/sites.json.
 *
 * Usage: pnpm build, then pnpm benchmark:sites [site-id ...]
 */
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { computeMetrics, summarizeResults } from './metrics.mjs';
import { selectBenchmarkSites } from './site-selection.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = join(root, '.output/chrome-mv3');
const outputDirectory = join(root, 'artifacts/benchmark');
const JOB_TIMEOUT_MS = 150000;
/** The least a benchmark page is left alone between requests. */
const MIN_REQUEST_GAP_MS = 1000;
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'FAILED', 'EXPIRED', 'INTERRUPTED', 'RECOVERABLE']);
/** A site passes only if it is at least this good. These are this benchmark's own bar. */
const PASS_BAR = { precision: 0.95, recall: 0.95, fieldAccuracy: 0.95, duplicateRate: 0.02, pageCoverage: 1 };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const collapse = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Runs in the page. Shares no code with the extension. */
function readTruthInPage({ recordSelector, fields }) {
  const read = (record, field) => {
    const element = record.querySelector(field.selector);
    if (!element) return null;
    if (field.attribute) {
      const value = element.getAttribute(field.attribute);
      if (value === null) return null;
      return field.kind === 'url' ? new URL(value, element.baseURI).href : value;
    }
    return element.textContent;
  };
  return Array.from(document.querySelectorAll(recordSelector)).map((record) =>
    Object.fromEntries(fields.map((field) => [field.name, read(record, field)]))
  );
}

function readTable(panel, table) {
  return panel.evaluate(
    (name) =>
      new Promise((done, fail) => {
        const open = indexedDB.open('PageHarvestDB');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction(name).objectStore(name).getAll();
          all.onerror = () => fail(all.error);
          all.onsuccess = () => {
            db.close();
            done(all.result);
          };
        };
      }),
    table
  );
}

async function readTruth(context, site) {
  const page = await context.newPage();
  const gap = Math.max(site.truth.crawlDelayMs ?? 0, MIN_REQUEST_GAP_MS);
  const records = [];
  try {
    for (const url of site.truth.pages) {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector(site.truth.recordSelector, { timeout: 15000 });
      records.push(...(await page.evaluate(readTruthInPage, site.truth)));
      await sleep(gap);
    }
  } finally {
    await page.close();
  }
  return records;
}

const TOOL = { 'auto-detect': 'Find data automatically', table: 'Extract a table', links: 'Extract all links' };
/** Table and Links sit under "More ways to start". */
const UNDER_MORE = new Set(['table', 'links']);
/** The pagination choices on the Pagination step, by the mode names in sites.json. */
const MODE_LABEL = {
  'Next Button': 'Click a Next button',
  'Infinite Scroll': 'Scroll to load more',
  'URL Template': 'Page numbers in the URL',
};
/** The first-run tour's flag (src/components/guide/preferences.ts). The benchmark measures extraction, not the tour. */
const GUIDE_STORAGE_KEY = 'pageharvest.guide';

/** Selects the option showing a truth record, and reports where the extension ranked it. */
async function chooseCandidate(panel, truthRecords, fields) {
  // Previews show text, so a URL key cannot identify a list. Use the first text field.
  const shown = fields.find((field) => field.kind === 'text')?.name;
  const needles = truthRecords
    .slice(0, 8)
    .map((record) => collapse(record[shown]).slice(0, 12))
    .filter(Boolean);
  const options = panel.getByRole('radio');
  const count = await options.count();
  if (count === 0) return { candidates: 1, rank: 1, chosen: true };

  const labels = await panel.locator('label:has(input[type="radio"])').allInnerTexts();
  const rank = labels.findIndex((label) => needles.some((needle) => label.includes(needle)));
  if (rank < 0) return { candidates: count, rank: null, chosen: false, labels };
  if (rank > 0) await options.nth(rank).check();
  return { candidates: count, rank: rank + 1, chosen: true };
}

/** Chooses the mode on the Pagination step and fills its limits under Advanced. Waits are in seconds there. */
async function configurePagination(panel, pagination) {
  if (pagination.mode === 'Single Page') return;
  await panel.getByRole('button', { name: 'Next: Pagination' }).click();
  await panel.getByRole('group', { name: /How does this site show more items/ }).waitFor({ timeout: 10000 });
  await panel.getByRole('radio', { name: MODE_LABEL[pagination.mode] }).check();
  if (pagination.mode === 'URL Template') await panel.getByLabel('Page address').fill(pagination.template);
  const advanced = panel.getByRole('button', { name: 'Advanced' });
  if ((await advanced.getAttribute('aria-expanded')) !== 'true') await advanced.click();
  if (pagination.mode === 'Infinite Scroll') {
    await panel.getByLabel('Most scrolls').fill(String(pagination.maxScrolls));
    await panel.getByLabel('Wait between scrolls (seconds)').fill(String(pagination.scrollDelayMs / 1000));
  } else {
    await panel.getByLabel('Most pages').fill(String(pagination.maxPages));
    await panel.getByLabel('Wait between pages (seconds)').fill(String(pagination.delayMs / 1000));
  }
}

function checkSamples(site, rows) {
  const flat = rows.map((row) =>
    Object.entries(row)
      .filter(([column]) => !column.startsWith('_') && column !== 'datasetId')
      .map(([, value]) => collapse(value))
  );
  return site.expectedSamples.map((sample) => {
    const values = Object.values(sample).map(collapse);
    const found = flat.some((row) => values.every((value) => row.includes(value)));
    return { sample, found };
  });
}

async function runSite(context, extensionId, site) {
  const startedAt = Date.now();
  const result = { id: site.id, url: site.url, categories: site.categories, method: site.method };
  let panel;
  let target;
  try {
    panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const previousJobs = new Set((await readTable(panel, 'jobs')).map((job) => job.id));

    const preRead = site.truth.pages.length > 0 ? await readTruth(context, site) : null;

    target = await context.newPage();
    await target.goto(site.url, { waitUntil: 'load', timeout: 45000 });
    await target.waitForSelector(site.truth.recordSelector, { timeout: 15000 }).catch(() => undefined);
    await sleep(MIN_REQUEST_GAP_MS);
    await target.bringToFront();

    if (UNDER_MORE.has(site.method)) {
      const more = panel.getByText('More ways to start');
      await more.waitFor({ timeout: 15000 });
      const details = panel.locator('details', { has: more });
      if (!(await details.evaluate((element) => element.open))) await more.click();
    }
    const tool = panel.getByRole('button', { name: TOOL[site.method], exact: true });
    await tool.waitFor({ timeout: 15000 });
    await panel.waitForFunction(
      (name) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(name) && !b.disabled),
      TOOL[site.method],
      { timeout: 15000 }
    );
    await tool.click();
    await panel.getByRole('heading', { name: 'Is this the data you want?' }).waitFor({ timeout: 20000 });

    const onPageTruth = await target.evaluate(readTruthInPage, site.truth);
    result.choice = await chooseCandidate(panel, onPageTruth, site.truth.fields);
    if (!result.choice.chosen) {
      result.status = 'FAIL';
      result.reason = 'None of the candidates offered was the list being tested.';
      return result;
    }

    // A list that does not look like data needs the same second click a person would give it.
    const anyway = panel.getByRole('button', { name: 'Use this list anyway' });
    result.choice.confirmedAnyway = await anyway.isVisible();
    if (result.choice.confirmedAnyway) await anyway.click();
    await panel.getByRole('button', { name: 'Use this list', exact: true }).click();
    await panel.getByText('Choose your columns').waitFor({ timeout: 10000 });
    const start = panel.getByRole('button', { name: /Start extraction/ });
    await panel.waitForFunction(
      () => [...document.querySelectorAll('button')].some((b) => /Start extraction/.test(b.textContent) && !b.disabled),
      undefined,
      { timeout: 15000 }
    );
    result.columnsOffered = await panel
      .locator('input[type="checkbox"][aria-label^="Include "]')
      .evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-label').slice('Include '.length)));
    await configurePagination(panel, site.pagination);
    await start.click();

    let job;
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (Date.now() < deadline) {
      job = (await readTable(panel, 'jobs')).find((item) => !previousJobs.has(item.id));
      if (job && TERMINAL.has(job.status)) break;
      await sleep(700);
    }
    if (!job || !TERMINAL.has(job.status)) throw new Error('The job did not finish in time.');

    const rows = (await readTable(panel, 'records'))
      .filter((row) => row.datasetId === job.datasetId)
      .sort((a, b) => Number(a._order) - Number(b._order));

    const truthRecords = site.truth.readFromJobTab
      ? await target.evaluate(readTruthInPage, site.truth)
      : preRead;
    const progress = site.pagination.mode === 'Infinite Scroll' ? 1 : job.pagesVisited;
    const metrics = computeMetrics({
      truthRecords,
      rows,
      key: site.truth.key,
      fields: site.truth.fields,
      pagesVisited: progress,
      expectedPages: site.expectedPages,
    });
    const samples = checkSamples(site, rows);

    Object.assign(result, {
      jobStatus: job.status,
      stopReason: job.stopReason ?? null,
      pagesVisited: job.pagesVisited,
      duplicatesSkipped: job.duplicatesSkipped,
      missingFieldRows: job.recordsWithMissingFields,
      metrics,
      samples,
      sampleRow: Object.fromEntries(
        Object.entries(rows[0] ?? {})
          .filter(([column]) => !column.startsWith('_') && column !== 'datasetId')
          .map(([column, value]) => [column, typeof value === 'string' ? value.slice(0, 60) : value])
      ),
      valuesAmbiguous: rows.filter((row) => /"status":"ambiguous"/.test(String(row._valueNotes ?? ''))).length,
    });

    const failures = [];
    if (job.status !== 'COMPLETED') failures.push(`job ended ${job.status}`);
    if (metrics.precision < PASS_BAR.precision) failures.push(`precision ${metrics.precision}`);
    if (metrics.recall < PASS_BAR.recall) failures.push(`recall ${metrics.recall}`);
    if (metrics.fieldAccuracy < PASS_BAR.fieldAccuracy) failures.push(`field accuracy ${metrics.fieldAccuracy}`);
    if (!site.truth.repeatedKeys && metrics.duplicateRate > PASS_BAR.duplicateRate) {
      failures.push(`duplicate rate ${metrics.duplicateRate}`);
    }
    if (metrics.pageCoverage < PASS_BAR.pageCoverage) failures.push(`page coverage ${metrics.pageCoverage}`);
    const missed = samples.filter((sample) => !sample.found);
    if (missed.length > 0) failures.push(`missing sample ${JSON.stringify(missed[0].sample)}`);
    for (const column of site.expectedColumns ?? []) {
      if (!result.columnsOffered.includes(column)) failures.push(`no column named ${column}`);
    }
    result.status = failures.length === 0 ? 'PASS' : 'FAIL';
    if (failures.length > 0) result.reason = failures.join('; ');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A site that cannot be reached says nothing about the extension.
    const unreachable = /net::ERR|Timeout .*goto|ERR_NAME|ERR_CONNECTION|ERR_TIMED_OUT/.test(message);
    result.status = unreachable ? 'BLOCKED' : 'FAIL';
    result.reason = collapse(message).slice(0, 300);
    return result;
  } finally {
    result.durationMs = Date.now() - startedAt;
    await target?.close().catch(() => undefined);
    await panel?.close().catch(() => undefined);
    await sleep(MIN_REQUEST_GAP_MS);
  }
}

function toMarkdown(report) {
  const percent = (value) => (typeof value === 'number' ? `${Math.round(value * 1000) / 10}%` : '-');
  const lines = [
    '# Real-site benchmark report',
    '',
    `- Date: ${report.date}`,
    `- Commit: ${report.commit}`,
    `- Browser: ${report.browser}`,
    `- Sites: ${report.summary.total} (${report.summary.passed} PASS, ${report.summary.failed} FAIL, ${report.summary.blocked} BLOCKED)`,
    '',
    '| Site | Status | Rows | Truth | Precision | Recall | Field accuracy | Field completeness | Duplicates | Pages | Rank |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...report.results.map((r) => {
      const m = r.metrics;
      const rank = r.choice ? `${r.choice.rank ?? '-'} of ${r.choice.candidates}` : '-';
      return `| ${r.id} | ${r.status} | ${m?.rowCount ?? '-'} | ${m?.truthCount ?? '-'} | ${percent(m?.precision)} | ${percent(m?.recall)} | ${percent(m?.fieldAccuracy)} | ${percent(m?.fieldCompleteness)} | ${percent(m?.duplicateRate)} | ${percent(m?.pageCoverage)} | ${rank} |`;
    }),
    `| **Mean of sites that ran** | | | | ${percent(report.summary.mean.precision)} | ${percent(report.summary.mean.recall)} | ${percent(report.summary.mean.fieldAccuracy)} | ${percent(report.summary.mean.fieldCompleteness)} | ${percent(report.summary.mean.duplicateRate)} | ${percent(report.summary.mean.pageCoverage)} | |`,
    '',
    '## Why sites did not pass',
    '',
    ...report.results.filter((r) => r.status !== 'PASS').map((r) => `- **${r.id}** (${r.status}): ${r.reason}`),
    '',
    '## Fields per site',
    '',
    ...report.results
      .filter((r) => r.metrics)
      .flatMap((r) => [
        `- **${r.id}**: offered ${JSON.stringify(r.columnsOffered ?? [])}`,
        ...Object.entries(r.metrics.perField).map(
          ([name, score]) =>
            `  - ${name}: column ${score.column ?? 'none'}, accuracy ${percent(score.accuracy)}, completeness ${percent(score.completeness)}`
        ),
      ]),
    '',
  ];
  return lines.join('\n');
}

const { sites } = JSON.parse(await readFile(join(root, 'tests/benchmark/sites.json'), 'utf8'));
const only = process.argv.slice(2);
const selected = selectBenchmarkSites(sites, only);

const profile = await mkdtemp(join(os.tmpdir(), 'pageharvest-benchmark-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
const extensionId = worker.url().split('/')[2];
await worker.evaluate(
  (key) => chrome.storage.local.set({ [key]: { version: 1, onboardingDone: true } }),
  GUIDE_STORAGE_KEY
);

const results = [];
for (const site of selected) {
  const result = await runSite(context, extensionId, site);
  results.push(result);
  const m = result.metrics;
  console.log(
    `${result.status.padEnd(8)}${site.id.padEnd(22)}${m ? `rows=${m.rowCount}/${m.truthCount} P=${m.precision} R=${m.recall} acc=${m.fieldAccuracy} complete=${m.fieldCompleteness} dup=${m.duplicateRate} pages=${m.pageCoverage}` : ''} ${result.reason ?? ''}`.slice(0, 240)
  );
}

const browser = context.browser()?.version() ?? 'Chrome for Testing';
await context.close();
await rm(profile, { recursive: true, force: true }).catch(() => undefined);

const report = {
  date: new Date().toISOString(),
  commit: process.env.GITHUB_SHA?.slice(0, 7) ?? 'local',
  browser,
  passBar: PASS_BAR,
  summary: summarizeResults(results),
  results,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'real-sites-report.json'), JSON.stringify(report, null, 2));
await writeFile(join(outputDirectory, 'real-sites-report.md'), toMarkdown(report));
console.log(`\nReport: ${join(outputDirectory, 'real-sites-report.md')}`);
process.exitCode = report.summary.failed > 0 ? 1 : report.summary.blocked > 0 ? 3 : 0;
