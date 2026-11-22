import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../entrypoints/sidepanel/App';
import {
  CONSENT_STORAGE_KEY,
  ConsentRecordSchema,
  createConsentPreferences,
  type ConsentStorageArea,
} from '@/components/consent/consent';
import { GUIDE_STORAGE_KEY } from '@/components/guide/preferences';

function memoryStorage(initial: Record<string, unknown> = {}): ConsentStorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
  };
}

describe('Consent Gate (B2)', () => {
  describe('createConsentPreferences', () => {
    it('returns false when no consent has been stored', async () => {
      const storage = memoryStorage();
      const prefs = createConsentPreferences(storage);
      expect(await prefs.hasConsent()).toBe(false);
    });

    it('saves valid consent record with version 1.0 and ISO timestamp', async () => {
      const storage = memoryStorage();
      const prefs = createConsentPreferences(storage);
      const record = await prefs.saveConsent();

      expect(record.accepted).toBe(true);
      expect(record.version).toBe('1.0');
      expect(new Date(record.acceptedAt).toISOString()).toBe(record.acceptedAt);
      expect(storage.data[CONSENT_STORAGE_KEY]).toEqual(record);
      expect(await prefs.hasConsent()).toBe(true);
    });

    it('recognizes previously stored valid consent', async () => {
      const storage = memoryStorage({
        [CONSENT_STORAGE_KEY]: {
          accepted: true,
          version: '1.0',
          acceptedAt: new Date().toISOString(),
        },
      });
      const prefs = createConsentPreferences(storage);
      expect(await prefs.hasConsent()).toBe(true);
    });

    it('rejects invalid or corrupted consent structure', async () => {
      const storage = memoryStorage({
        [CONSENT_STORAGE_KEY]: {
          accepted: false,
        },
      });
      const prefs = createConsentPreferences(storage);
      expect(await prefs.hasConsent()).toBe(false);
    });
  });

  describe('In-product App enforcement', () => {
    beforeEach(async () => {
      // Clear consent from mockChrome so the gate triggers on first open
      await chromeMock.storage.local.remove(CONSENT_STORAGE_KEY);
      // Ensure onboarding is marked done so it doesn't conflict after accept
      await chromeMock.storage.local.set({ [GUIDE_STORAGE_KEY]: { version: 1, onboardingDone: true } });
    });

    it('blocks the main app and displays disclosure bullets on first run', async () => {
      render(<App />);

      // The gate must be shown
      const button = await screen.findByRole('button', { name: 'I understand, continue' });
      expect(button).toBeInTheDocument();

      // Verify the 3 key bullets are present
      expect(screen.getByText(/100% local processing in your browser/i)).toBeInTheDocument();
      expect(screen.getByText(/No accounts, analytics, or external servers/i)).toBeInTheDocument();
      expect(screen.getByText(/Respect site terms & applicable laws/i)).toBeInTheDocument();

      // Verify the main app cannot be bypassed (no main navigation or dashboard actions)
      expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Data' })).not.toBeInTheDocument();
    });

    it('unblocks the app upon clicking "I understand, continue" and persists consent', async () => {
      render(<App />);

      const button = await screen.findByRole('button', { name: 'I understand, continue' });
      await userEvent.click(button);

      // App should transition to main interface
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument();
      });

      // Verify persistence in chrome.storage.local
      const stored = await chromeMock.storage.local.get(CONSENT_STORAGE_KEY);
      const parsed = ConsentRecordSchema.safeParse(stored[CONSENT_STORAGE_KEY]);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.accepted).toBe(true);
        expect(parsed.data.version).toBe('1.0');
      }
    });

    it('does not re-prompt when consent has already been granted', async () => {
      await chromeMock.storage.local.set({
        [CONSENT_STORAGE_KEY]: {
          accepted: true,
          version: '1.0',
          acceptedAt: new Date().toISOString(),
        },
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'I understand, continue' })).not.toBeInTheDocument();
    });
  });
});
