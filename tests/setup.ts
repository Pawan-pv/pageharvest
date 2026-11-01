import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { beforeEach, afterEach } from 'vitest';
import { createChromeMock, ChromeMock } from './utils/chrome-mock';

declare global {
  // eslint-disable-next-line no-var
  var chromeMock: ChromeMock;
}

// Initialize Chrome extension API mock
const mockChrome = createChromeMock();
globalThis.chromeMock = mockChrome;
globalThis.chrome = mockChrome as unknown as typeof chrome;

beforeEach(() => {
  mockChrome.reset();
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});
