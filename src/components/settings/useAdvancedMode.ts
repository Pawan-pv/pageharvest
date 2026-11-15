import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { advancedPreference, type AdvancedPreference } from './advanced-preference';

/**
 * The current choice, for a component that only reads it. It does not load the stored
 * value itself: the panel shell does that once, through `useAdvancedMode`, and every reader
 * follows.
 */
export function useIsAdvanced(preference: AdvancedPreference = advancedPreference): boolean {
  return useSyncExternalStore(preference.subscribe, preference.current, preference.current);
}

/**
 * Whether advanced options are on. Every screen that uses this follows the Settings switch
 * at once, because they share one preference object.
 */
export function useAdvancedMode(preference: AdvancedPreference = advancedPreference) {
  const [advanced, setAdvancedState] = useState(preference.current());

  useEffect(() => {
    const unsubscribe = preference.subscribe(setAdvancedState);
    void preference.load().then(setAdvancedState);
    return unsubscribe;
  }, [preference]);

  const setAdvanced = useCallback((next: boolean) => preference.save(next), [preference]);

  return { advanced, setAdvanced };
}
