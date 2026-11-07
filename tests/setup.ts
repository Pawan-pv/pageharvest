import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { beforeEach, afterEach } from 'vitest';
import { configure } from '@testing-library/react';
import { GUIDE_STORAGE_KEY } from '@/components/guide/preferences';
import { createChromeMock, ChromeMock } from './utils/chrome-mock';

declare global {
  var chromeMock: ChromeMock;
}

// Side panel screens are lazy-loaded chunks (ADR-014). Under a full parallel run, loading one
// can take longer than Testing Library's 1s default, which made findBy/waitFor flaky.
configure({ asyncUtilTimeout: 5000 });

// Initialize Chrome extension API mock
const mockChrome = createChromeMock();
globalThis.chromeMock = mockChrome;
globalThis.chrome = mockChrome as unknown as typeof chrome;

beforeEach(async () => {
  mockChrome.reset();
  // The first-run tour would open over every App test. Tests of the tour clear this flag.
  await mockChrome.storage.local.set({ [GUIDE_STORAGE_KEY]: { version: 1, onboardingDone: true } });
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});
