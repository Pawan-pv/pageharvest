/** Must equal the manifest's `permissions`; `manifest-assets.test.ts` checks both lists. */
export const REQUIRED_PERMISSIONS = [
  'activeTab',
  'sidePanel',
  'storage',
  'scripting',
  'downloads',
] as const;

type RequestedPermission = chrome.runtime.ManifestPermissions;

/** The one wording for a missing per-site grant (ADR-037), shared by background and panel. */
export const SITE_PERMISSION_MESSAGE = 'PageHarvest needs access to this site to continue. Allow access?';

/** "https://host/*" for a page URL, or null when no host grant applies. Never "<all_urls>". */
export function originPatternForUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return null;
  }
}

/** Whether this page's origin is covered by a persistent host grant. */
export async function hasHostAccess(url: string | undefined): Promise<boolean> {
  const origin = originPatternForUrl(url);
  if (!origin) return false;
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return true;
  }
  try {
    return Boolean(await (chrome.permissions.contains({ origins: [origin] }) as Promise<boolean>));
  } catch {
    return false;
  }
}

/**
 * Requests the site's origin. Must be called as the first await in a click
 * handler so the user gesture is still valid; never precedes it with a
 * messaging round trip. Returns false when the user dismisses the prompt, or
 * when Chrome refuses the request (no user gesture, pattern not in
 * optional_host_permissions); it never throws.
 */
export async function requestSiteOrigin(url: string | undefined): Promise<boolean> {
  const origin = originPatternForUrl(url);
  if (!origin) return false;
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return true;
  }
  try {
    return Boolean(await (chrome.permissions.request({ origins: [origin] }) as Promise<boolean>));
  } catch (err: unknown) {
    console.warn('PageHarvest could not request site access:', err);
    return false;
  }
}

export async function hasPermission(permission: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return true;
  }
  return Boolean(await (chrome.permissions.contains({
    permissions: [permission as RequestedPermission],
  }) as Promise<boolean>));
}

export async function checkRequiredPermissions(): Promise<{ allGranted: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const perm of REQUIRED_PERMISSIONS) {
    const granted = await hasPermission(perm);
    if (!granted) {
      missing.push(perm);
    }
  }
  return {
    allGranted: missing.length === 0,
    missing,
  };
}
