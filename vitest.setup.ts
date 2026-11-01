import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Global Chrome API mock for tests running outside browser extension runtime
if (typeof globalThis.chrome === 'undefined') {
  const listeners: Array<(...args: unknown[]) => void> = [];

  const mockChrome = {
    runtime: {
      id: 'mock-extension-id',
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn((cb: (...args: unknown[]) => void) => listeners.push(cb)),
        removeListener: vi.fn((cb: (...args: unknown[]) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx !== -1) listeners.splice(idx, 1);
        }),
        hasListener: vi.fn(() => true),
      },
      getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com/products', title: 'Example Products' }]),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    },
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  };

  (globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;
}
