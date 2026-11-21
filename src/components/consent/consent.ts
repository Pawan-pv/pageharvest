import { z } from 'zod';

/**
 * Storage key for user disclosure and consent (B2).
 * Persisted in chrome.storage.local (ADR-005).
 */
export const CONSENT_STORAGE_KEY = 'pageharvest.consent';

export const ConsentRecordSchema = z.object({
  accepted: z.literal(true),
  version: z.literal('1.0'),
  acceptedAt: z.string(),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export interface ConsentStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface ConsentPreferences {
  hasConsent(): Promise<boolean>;
  saveConsent(): Promise<ConsentRecord>;
}

export function createConsentPreferences(storage?: ConsentStorageArea): ConsentPreferences {
  let inMemoryAccepted = false;

  return {
    async hasConsent(): Promise<boolean> {
      if (inMemoryAccepted) return true;
      try {
        if (!storage) return inMemoryAccepted;
        const items = await storage.get(CONSENT_STORAGE_KEY);
        const parsed = ConsentRecordSchema.safeParse(items[CONSENT_STORAGE_KEY]);
        if (parsed.success && parsed.data.accepted) {
          inMemoryAccepted = true;
          return true;
        }
        return false;
      } catch {
        return inMemoryAccepted;
      }
    },
    async saveConsent(): Promise<ConsentRecord> {
      const record: ConsentRecord = {
        accepted: true,
        version: '1.0',
        acceptedAt: new Date().toISOString(),
      };
      inMemoryAccepted = true;
      try {
        if (storage) {
          await storage.set({ [CONSENT_STORAGE_KEY]: record });
        }
      } catch {
        // In-memory fallback allows continued use if storage write fails
      }
      return record;
    },
  };
}

/** A chrome.storage area looked up on each call, so it never depends on when this module loaded. */
function chromeArea(name: 'local' | 'session'): ConsentStorageArea {
  const area = (): ConsentStorageArea => {
    const found = typeof chrome !== 'undefined' ? chrome.storage?.[name] : undefined;
    if (!found) throw new Error(`chrome.storage.${name} is not available`);
    return found as unknown as ConsentStorageArea;
  };
  return {
    get: (key) => area().get(key),
    set: (items) => area().set(items),
  };
}

export const consentPreferences: ConsentPreferences = createConsentPreferences(chromeArea('local'));
