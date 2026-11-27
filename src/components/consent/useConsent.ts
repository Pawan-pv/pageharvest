import { useCallback, useEffect, useState } from 'react';
import { consentPreferences, type ConsentPreferences } from './consent';

export function useConsent(preferences: ConsentPreferences = consentPreferences) {
  const [hasConsent, setHasConsent] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void preferences.hasConsent().then((accepted) => {
      if (!cancelled) setHasConsent(accepted);
    });
    return () => {
      cancelled = true;
    };
  }, [preferences]);

  const accept = useCallback(async () => {
    await preferences.saveConsent();
    setHasConsent(true);
  }, [preferences]);

  return { hasConsent, accept };
}
