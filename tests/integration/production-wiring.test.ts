import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Walks the real import graph from the three extension entry points. A module that tests
 * cover but production never reaches is exactly how this project once had hundreds of
 * passing tests over disconnected code, so that situation now fails the suite.
 */
const ROOT = resolve(__dirname, '../..');
const ENTRY_POINTS = [
  'entrypoints/background.ts',
  'entrypoints/content.ts',
  'entrypoints/sidepanel/main.tsx',
];
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

function resolveModule(importer: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('~/')) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier);
  else return null;

  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next form.
    }
  }
  return null;
}

function reachableFrom(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map((entry) => join(ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = resolveModule(file, match[1]);
      if (target && /\.tsx?$/.test(target)) queue.push(target);
    }
  }
  return seen;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listSourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const reachable = reachableFrom(ENTRY_POINTS);
const toRelative = (path: string) => relative(ROOT, path).replace(/\\/g, '/');
const reachableRelative = new Set(Array.from(reachable).map(toRelative));

function sourceOf(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('Production wiring', () => {
  it('reaches every source module from a real entry point', () => {
    const unreachable = listSourceFiles(join(ROOT, 'src'))
      .map(toRelative)
      // A barrel only re-exports. What matters is that the modules behind it are reached.
      .filter((path) => !/\/index\.tsx?$/.test(path))
      .filter((path) => !reachableRelative.has(path));

    expect(unreachable).toEqual([]);
  });

  it.each([
    ['platform/messaging-client', 'src/platform/messaging-client.ts'],
    ['core/state/extraction-machine', 'src/core/state/extraction-machine.ts'],
    ['core/resilience/error-reporter', 'src/core/resilience/error-reporter.ts'],
    ['platform/downloads', 'src/platform/downloads.ts'],
    ['platform/permissions', 'src/platform/permissions.ts'],
    ['core/navigation/runner', 'src/core/navigation/runner.ts'],
    ['background/job-coordinator', 'src/background/job-coordinator.ts'],
  ])('keeps %s in the production graph', (_name, path) => {
    expect(reachableRelative.has(path)).toBe(true);
  });

  it.each([
    'project-repository',
    'job-repository',
    'schema-repository',
    'recipe-repository',
    'record-repository',
    'dataset-repository',
    'history-repository',
    'settings-repository',
  ])('keeps storage/repositories/%s in the production graph', (name) => {
    expect(reachableRelative.has(`src/storage/repositories/${name}.ts`)).toBe(true);
  });

  describe('each abstraction is actually called, not just imported', () => {
    it('the background coordinator moves jobs only through the state machine', () => {
      const source = sourceOf('src/background/job-coordinator.ts');
      expect(source).toMatch(/machine\.transition\(/);
      expect(source).toMatch(/ExtractionStateMachine\.fromJob/);
    });

    it('content scripts and the side panel send through MessagingClient', () => {
      expect(sourceOf('entrypoints/content.ts')).toMatch(/client\.sendToBackground/);
      expect(sourceOf('src/services/messaging.ts')).toMatch(/this\.client\.send/);
      expect(sourceOf('src/background/chrome-job-transport.ts')).toMatch(/client\.sendToTab/);
    });

    it('workflow errors go through the error reporter', () => {
      expect(sourceOf('src/background/job-coordinator.ts')).toMatch(/this\.reporter\.report/);
      expect(sourceOf('src/content/workflow-coordinator.ts')).toMatch(/errorReporter\.report/);
    });

    it('exports use the download module', () => {
      expect(sourceOf('src/components/grid/ExportDialog.tsx')).toMatch(/triggerDownload\(/);
      expect(sourceOf('src/components/history/ExtractionHistoryView.tsx')).toMatch(/triggerDownload\(/);
    });

    it('the content script runs jobs through the navigation runner', () => {
      expect(sourceOf('src/content/workflow-coordinator.ts')).toMatch(/runNavigationJob\(/);
    });

    it('starting a job checks permissions', () => {
      expect(sourceOf('src/background/job-coordinator.ts')).toMatch(/checkRequiredPermissions/);
      expect(sourceOf('src/background/job-coordinator.ts')).toMatch(/await this\.checkPermissions\(\)/);
    });
  });

  describe('the side panel does not own extraction data', () => {
    const hook = () => sourceOf('src/hooks/useExtractionWorkflow.ts');

    it('never writes extracted records from the side panel workflow', () => {
      expect(hook()).not.toMatch(/saveExtractedBatch|records\.bulkPut|bulkAdd/);
    });

    it('never touches the database singleton directly in the workflow', () => {
      expect(hook()).not.toMatch(/from '@\/storage\/db'/);
    });

    it('only the background coordinator commits record batches', () => {
      const writers = listSourceFiles(join(ROOT, 'src'))
        .filter((path) => !path.includes('storage'))
        .filter((path) => /saveExtractedBatch/.test(readFileSync(path, 'utf8')))
        .map(toRelative);
      expect(writers).toEqual(['src/background/job-coordinator.ts']);
    });
  });

  it('has exactly one message protocol', () => {
    expect(sourceOf('src/contracts/messages.ts')).not.toMatch(/z\.object|discriminatedUnion/);
    expect(sourceOf('src/shared/contracts/message.ts')).toMatch(/discriminatedUnion/);
  });

  it('has no weak record hash left in production', () => {
    const offenders = listSourceFiles(join(ROOT, 'src'))
      .filter((path) => /fnv1a|0x811c9dc5|2166136261/i.test(readFileSync(path, 'utf8')))
      .map(toRelative);
    expect(offenders).toEqual([]);
  });

  it('does not use the removed durable stores', () => {
    const offenders = [...listSourceFiles(join(ROOT, 'src')), ...listSourceFiles(join(ROOT, 'entrypoints'))]
      .filter((path) => /pageharvest_active_job|pageharvest_url_pagination_sessions/.test(readFileSync(path, 'utf8')))
      .map(toRelative);
    expect(offenders).toEqual([]);
  });
});
