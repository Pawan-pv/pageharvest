import { useCallback, useEffect, useState } from 'react';
import { guidePreferences, type GuidePreferences } from './preferences';

/** Opens the welcome tour on first run, remembers when it is done, and lets Help reopen it. */
export function useOnboarding(preferences: GuidePreferences = guidePreferences) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void preferences.shouldShowOnboarding().then((show) => {
      if (!cancelled && show) setIsOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [preferences]);

  const open = useCallback(() => setIsOpen(true), []);
  const finish = useCallback(() => {
    setIsOpen(false);
    void preferences.markOnboardingDone();
  }, [preferences]);

  return { isOpen, open, finish };
}
