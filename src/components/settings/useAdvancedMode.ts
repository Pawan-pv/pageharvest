import { useCallback, useEffect, useState } from 'react';
import { advancedPreference, type AdvancedPreference } from './advanced-preference';

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
