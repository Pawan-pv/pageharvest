/**
 * Whether the panel shows its advanced controls. Off by default: the panel opens in simple
 * mode, written for someone who wants "the list on this page, in a spreadsheet" (ADR-039).
 *
 * This is a preference, so it lives in chrome.storage.local like the tour flag (ADR-005,
 * ADR-032), never in IndexedDB with the user's data, and it needs no contract.
 */
export const ADVANCED_STORAGE_KEY = 'pageharvest.advanced';

/** The part of a chrome.storage area this module uses. */
export interface AdvancedStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface AdvancedPreference {
  /** The stored choice. Simple mode (false) when nothing is stored or storage cannot be read. */
  load(): Promise<boolean>;
  /** Applies the choice at once and stores it. Resolves false when it could not be stored. */
  save(advanced: boolean): Promise<boolean>;
  /** The last value loaded or saved in this panel. */
  current(): boolean;
  /** Told about every change made in this panel. Returns the unsubscribe function. */
  subscribe(listener: (advanced: boolean) => void): () => void;
}

function readStored(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const stored = value as { version?: unknown; advanced?: unknown };
  return stored.version === 1 && stored.advanced === true;
}

export function createAdvancedPreference(local?: AdvancedStorageArea): AdvancedPreference {
  let value = false;
  // Counts saves, so a read that was already under way cannot undo a newer choice.
  let saves = 0;
  const listeners = new Set<(advanced: boolean) => void>();

  const apply = (next: boolean) => {
    if (next === value) return;
    value = next;
    listeners.forEach((listener) => listener(next));
  };

  return {
    async load() {
      const savesBefore = saves;
      try {
        if (!local) throw new Error('chrome.storage.local is not available');
        const items = await local.get(ADVANCED_STORAGE_KEY);
        if (saves === savesBefore) apply(readStored(items[ADVANCED_STORAGE_KEY]));
      } catch {
        // Unreadable storage leaves the panel in simple mode, the safe default.
      }
      return value;
    },

    async save(advanced) {
      // The screen follows the switch even if the choice cannot be kept for next time.
      saves += 1;
      apply(advanced);
      try {
        if (!local) throw new Error('chrome.storage.local is not available');
        await local.set({ [ADVANCED_STORAGE_KEY]: { version: 1, advanced, updatedAt: Date.now() } });
        return true;
      } catch {
        return false;
      }
    },

    current: () => value,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** chrome.storage.local looked up on each call, so it never depends on when this module loaded. */
const chromeLocal: AdvancedStorageArea = {
  get: (key) => area().get(key),
  set: (items) => area().set(items),
};

function area(): AdvancedStorageArea {
  const found = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  if (!found) throw new Error('chrome.storage.local is not available');
  return found as unknown as AdvancedStorageArea;
}

export const advancedPreference: AdvancedPreference = createAdvancedPreference(chromeLocal);
