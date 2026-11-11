import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, vi } from 'vitest';
import { configure } from '@testing-library/react';
import { GUIDE_STORAGE_KEY } from '@/components/guide/preferences';
import { createChromeMock, ChromeMock } from './utils/chrome-mock';
import { usePanelMode } from './utils/panel-mode';

declare global {
  var chromeMock: ChromeMock;
}

// Side panel screens are lazy-loaded chunks (ADR-014). Under a full parallel run, loading one
// can take longer than Testing Library's 1s default, which made findBy/waitFor flaky.
// A lazy view is transformed on first import, which can take several seconds on a busy machine.
configure({ asyncUtilTimeout: 10000 });
// A test that waits on several lazy views needs more than Vitest's 5s default, which
// equals one findBy wait. This only allows slow runs to finish; no assertion changes.
vi.setConfig({ testTimeout: 15000 });

// Initialize Chrome extension API mock
const mockChrome = createChromeMock();
globalThis.chromeMock = mockChrome;
globalThis.chrome = mockChrome as unknown as typeof chrome;

beforeEach(async () => {
  mockChrome.reset();
  // The first-run tour would open over every App test. Tests of the tour clear this flag.
  await mockChrome.storage.local.set({ [GUIDE_STORAGE_KEY]: { version: 1, onboardingDone: true } });
  // The suites written before simple mode drive the detailed controls, so they run with
  // Advanced options on and prove nothing was lost (ADR-039). Simple-mode tests switch it off.
  await usePanelMode('advanced');
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});
