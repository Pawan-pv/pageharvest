import { z } from 'zod';

/**
 * Whether the user has seen the welcome tour. This is a preference, so it lives in
 * chrome.storage.local (ADR-005), never in IndexedDB with the user's data.
 */
export const GUIDE_STORAGE_KEY = 'pageharvest.guide';
const SESSION_KEY = 'pageharvest.guide.shownThisSession';

const GuidePrefsSchema = z.object({
  version: z.literal(1),
  onboardingDone: z.boolean(),
  updatedAt: z.number().int().optional(),
});

/** The part of a chrome.storage area this module uses. */
export interface GuideStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface GuidePreferences {
  /** True on first open. If storage cannot be read, true at most once per browser session. */
  shouldShowOnboarding(): Promise<boolean>;
  /** Remembers that the tour was finished or skipped. False when it could not be stored. */
  markOnboardingDone(): Promise<boolean>;
}

/**
 * @param local where the preference is kept (chrome.storage.local)
 * @param session used only when local fails, so a broken store does not show the tour on
 *   every panel open (chrome.storage.session); an in-memory flag covers the rest
 */
export function createGuidePreferences(local?: GuideStorageArea, session?: GuideStorageArea): GuidePreferences {
  let shownInMemory = false;

  async function claimSessionShow(): Promise<boolean> {
    if (shownInMemory) return false;
    shownInMemory = true;
    try {
      if (session) {
        const items = await session.get(SESSION_KEY);
        if (items[SESSION_KEY] === true) return false;
        await session.set({ [SESSION_KEY]: true });
      }
    } catch {
      // Session storage failed too; the in-memory flag still limits it to this page.
    }
    return true;
  }

  return {
    async shouldShowOnboarding() {
      try {
        if (!local) throw new Error('chrome.storage.local is not available');
        const items = await local.get(GUIDE_STORAGE_KEY);
        const parsed = GuidePrefsSchema.safeParse(items[GUIDE_STORAGE_KEY]);
        return !(parsed.success && parsed.data.onboardingDone);
      } catch {
        return claimSessionShow();
      }
    },

    async markOnboardingDone() {
      shownInMemory = true;
      try {
        if (!local) throw new Error('chrome.storage.local is not available');
        await local.set({
          [GUIDE_STORAGE_KEY]: { version: 1, onboardingDone: true, updatedAt: Date.now() },
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** A chrome.storage area looked up on each call, so it never depends on when this module loaded. */
function chromeArea(name: 'local' | 'session'): GuideStorageArea {
  const area = (): GuideStorageArea => {
    const found = typeof chrome !== 'undefined' ? chrome.storage?.[name] : undefined;
    if (!found) throw new Error(`chrome.storage.${name} is not available`);
    return found as unknown as GuideStorageArea;
  };
  return {
    get: (key) => area().get(key),
    set: (items) => area().set(items),
  };
}

export const guidePreferences: GuidePreferences = createGuidePreferences(chromeArea('local'), chromeArea('session'));
