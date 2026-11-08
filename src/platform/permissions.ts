/** Must equal the manifest's `permissions`; `manifest-assets.test.ts` checks both lists. */
export const REQUIRED_PERMISSIONS = [
  'activeTab',
  'sidePanel',
  'storage',
  'downloads',
] as const;

type RequestedPermission = chrome.runtime.ManifestPermissions;

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
