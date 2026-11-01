import { afterEach, describe, expect, it, vi } from 'vitest';
import { DuplicateDetector } from '@/core/extraction/duplicate-detector';
import {
  RECORD_IDENTITY_VERSION,
  canonicalizeRecord,
  fingerprintRecord,
  sha256Hex,
} from '@/core/extraction/record-identity';
import { BASE_URL, ExtensionHarness, makeBatch, makeRecipe, renderCards } from '../utils/job-harness';

const TAB = 701;

async function startPassive(harness: ExtensionHarness) {
  const { coordinator } = harness.loadPage(TAB, `${BASE_URL}/list`);
  vi.spyOn(coordinator, 'extractRecords').mockReturnValue({ accepted: true });
  return harness.start(TAB, makeRecipe({ type: 'next_button', maxPages: 500 }));
}

function batchOf(identity: Awaited<ReturnType<typeof startPassive>>, sequence: number, rows: Array<Record<string, unknown>>) {
  const message = makeBatch(identity, sequence, []);
  if (message.type !== 'RECORD_BATCH') throw new Error('Expected a batch.');
  message.payload.records = rows.map((row, index) => ({
    _id: `t_${sequence}_${index}`,
    _page: 1,
    _extractedAt: 1,
    ...row,
  })) as typeof message.payload.records;
  return message;
}

describe('Deduplication integrity', () => {
  let harness: ExtensionHarness;

  afterEach(async () => {
    harness.db.close();
    await harness.db.delete();
  });

  describe('forced hash collisions', () => {
    const everythingCollides = async () => 'a'.repeat(64);

    it('keeps two different records when the hash function returns the same value', async () => {
      harness = new ExtensionHarness({ hash: everythingCollides });
      const job = await startPassive(harness);

      const ack = await harness.sendFromPage(TAB, makeBatch(job, 1, ['First', 'Second']));

      expect(ack).toMatchObject({ status: 'committed', inserted: 2, duplicates: 0 });
      expect(await harness.titles(job.datasetId)).toEqual(['First', 'Second']);
    });

    it('keeps them when the colliding record arrives in a later batch', async () => {
      harness = new ExtensionHarness({ hash: everythingCollides });
      const job = await startPassive(harness);

      await harness.sendFromPage(TAB, makeBatch(job, 1, ['First']));
      const ack = await harness.sendFromPage(TAB, makeBatch(job, 2, ['Second']));

      expect(ack.inserted).toBe(1);
      expect(await harness.titles(job.datasetId)).toEqual(['First', 'Second']);
    });

    it('still removes true duplicates when every hash is the same', async () => {
      harness = new ExtensionHarness({ hash: everythingCollides });
      const job = await startPassive(harness);

      await harness.sendFromPage(TAB, makeBatch(job, 1, ['First', 'Second']));
      const ack = await harness.sendFromPage(TAB, makeBatch(job, 2, ['Second', 'Third', 'First']));

      expect(ack).toMatchObject({ inserted: 1, duplicates: 2 });
      expect(await harness.titles(job.datasetId)).toEqual(['First', 'Second', 'Third']);
    });
  });

  describe('through the real SHA-256 path', () => {
    it('stores a SHA-256 fingerprint and the identity version on the job', async () => {
      harness = new ExtensionHarness();
      const job = await startPassive(harness);

      await harness.sendFromPage(TAB, makeBatch(job, 1, ['Alpha']));

      const [row] = await harness.rows(job.datasetId);
      expect(row._hash).toBe(await sha256Hex(canonicalizeRecord({ Title: 'Alpha' })));
      expect((await harness.job(job.jobId))?.dedupeAlgorithm).toBe(RECORD_IDENTITY_VERSION);
    });

    it.each([
      ['different URLs', { Title: 'Laptop', Url: 'https://x.test/1' }, { Title: 'Laptop', Url: 'https://x.test/2' }],
      ['product variants', { Title: 'Shirt', Size: 'M' }, { Title: 'Shirt', Size: 'L' }],
      ['letter case', { Title: 'SKU-aB3' }, { Title: 'SKU-Ab3' }],
      ['different fields', { Title: 'A', Price: 5 }, { Title: 'A', Rating: 5 }],
      ['a number and text', { Title: 'A', Price: 5 }, { Title: 'A', Price: '5' }],
      ['missing and present', { Title: 'A', Price: 5 }, { Title: 'A', Price: null }],
      ['Unicode', { Title: 'Café' }, { Title: 'Cafe' }],
      ['separator lookalikes', { A: 'x', B: 'y' }, { A: 'x|B:y', B: null }],
    ])('keeps records differing by %s', async (_name, first, second) => {
      harness = new ExtensionHarness();
      const job = await startPassive(harness);

      await harness.sendFromPage(TAB, batchOf(job, 1, [first]));
      const ack = await harness.sendFromPage(TAB, batchOf(job, 2, [second]));

      expect(ack).toMatchObject({ inserted: 1, duplicates: 0 });
      expect(await harness.db.records.count()).toBe(2);
    });

    it.each([
      ['identical content', { Title: 'A', Price: 5 }, { Title: 'A', Price: 5 }],
      ['surrounding whitespace', { Title: '  Laptop   Pro ' }, { Title: 'Laptop Pro' }],
      ['Unicode composition', { Title: 'Café' }, { Title: 'Café' }],
      ['an empty string and null', { Title: 'A', Note: '' }, { Title: 'A', Note: null }],
      ['field order', { A: 1, B: 2 }, { B: 2, A: 1 }],
    ])('treats %s as the same record', async (_name, first, second) => {
      harness = new ExtensionHarness();
      const job = await startPassive(harness);

      await harness.sendFromPage(TAB, batchOf(job, 1, [first]));
      const ack = await harness.sendFromPage(TAB, batchOf(job, 2, [second]));

      expect(ack).toMatchObject({ inserted: 0, duplicates: 1 });
      expect(await harness.db.records.count()).toBe(1);
    });

    it('ignores provenance metadata when comparing rows', async () => {
      harness = new ExtensionHarness();
      const job = await startPassive(harness);

      await harness.sendFromPage(TAB, batchOf(job, 1, [{ Title: 'A', _sourceUrl: 'https://x.test/1' }]));
      const ack = await harness.sendFromPage(TAB, batchOf(job, 2, [{ Title: 'A', _sourceUrl: 'https://x.test/2' }]));

      expect(ack.duplicates).toBe(1);
    });

    it('does not deduplicate one job against another', async () => {
      harness = new ExtensionHarness();
      const first = await startPassive(harness);
      await harness.sendFromPage(TAB, makeBatch(first, 1, ['Same']));
      await harness.coordinator.finishJob(first.jobId);

      const second = await startPassive(harness);
      const ack = await harness.sendFromPage(TAB, makeBatch(second, 1, ['Same']));

      expect(ack.inserted).toBe(1);
    });

    it('keeps identical cards on a single page, since each element is its own row', async () => {
      harness = new ExtensionHarness();
      renderCards(['Same', 'Same', 'Same']);
      harness.loadPage(TAB, `${BASE_URL}/list`);

      const identity = await harness.start(TAB, makeRecipe());
      await harness.settled(TAB);

      expect(await harness.titles(identity.datasetId)).toEqual(['Same', 'Same', 'Same']);
    });
  });

  describe('at volume', () => {
    async function commitControlled(total: number, batchSize: number, repeatEvery: number) {
      harness = new ExtensionHarness();
      const job = await startPassive(harness);
      let sequence = 0;
      let inserted = 0;
      let duplicates = 0;

      for (let start = 0; start < total; start += batchSize) {
        sequence += 1;
        const titles = Array.from({ length: Math.min(batchSize, total - start) }, (_, offset) => {
          const n = start + offset;
          // Every repeatEvery-th row repeats an earlier row on purpose.
          return n > 0 && n % repeatEvery === 0 ? 'Product 0' : `Product ${n}`;
        });
        const ack = await harness.sendFromPage(TAB, makeBatch(job, sequence, titles));
        expect(ack.status).toBe('committed');
        inserted += ack.inserted;
        duplicates += ack.duplicates;
      }

      return { job, inserted, duplicates };
    }

    it('handles 10,000 controlled records exactly', async () => {
      const { job, inserted, duplicates } = await commitControlled(10_000, 1000, 100);

      expect(duplicates).toBe(99);
      expect(inserted).toBe(10_000 - 99);
      expect(await harness.db.records.where('datasetId').equals(job.datasetId).count()).toBe(10_000 - 99);
      expect((await harness.job(job.jobId))?.duplicatesSkipped).toBe(99);
    }, 120_000);

    // Through real IndexedDB this runs in Chromium: see the 50,000 row test in
    // tests/e2e/production-workflows.spec.ts. This one checks the identity decisions.
    it('decides 50,000 controlled records exactly, with SHA-256 fingerprints', async () => {
      const detector = new DuplicateDetector();
      const hashes = new Set<string>();
      let duplicates = 0;

      for (let n = 0; n < 50_000; n++) {
        const record = { Title: n > 0 && n % 500 === 0 ? 'Product 0' : `Product ${n}` };
        const { hash } = await fingerprintRecord(record);
        hashes.add(hash);
        if (detector.process(record).isDuplicate) duplicates++;
      }

      expect(duplicates).toBe(99);
      expect(detector.getStats().uniqueCount).toBe(50_000 - 99);
      expect(hashes.size).toBe(50_000 - 99);
    }, 120_000);
  });
});
