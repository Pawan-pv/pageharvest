import { ADVANCED_STORAGE_KEY, advancedPreference } from '@/components/settings/advanced-preference';

/**
 * Puts the panel in simple mode (what a new user gets) or with Advanced options on, and
 * brings the shared preference object in line before anything renders, so the first render
 * is already in the right mode.
 */
export async function usePanelMode(mode: 'simple' | 'advanced'): Promise<void> {
  await chrome.storage.local.set({
    [ADVANCED_STORAGE_KEY]: { version: 1, advanced: mode === 'advanced' },
  });
  await advancedPreference.load();
}
