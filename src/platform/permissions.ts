export const REQUIRED_PERMISSIONS = [
  'activeTab',
  'sidePanel',
  'storage',
  'scripting',
  'downloads'
] as const;

export type RequiredPermission = typeof REQUIRED_PERMISSIONS[number];

/**
 * Checks if a specific Chrome permission has been granted to the extension.
 */
export async function hasPermission(permission: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }

  try {
    return await chrome.permissions.contains({
      permissions: [permission]
    });
  } catch {
    return false;
  }
}

/**
 * Requests an optional permission with user interaction.
 */
export async function requestPermission(permission: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return false;
  }

  try {
    return await chrome.permissions.request({
      permissions: [permission]
    });
  } catch {
    return false;
  }
}

/**
 * Checks the status of all required extension permissions to ensure least-privilege compliance.
 */
export async function checkRequiredPermissions(): Promise<{
  allGranted: boolean;
  missing: string[];
}> {
  const missing: string[] = [];

  for (const perm of REQUIRED_PERMISSIONS) {
    const granted = await hasPermission(perm);
    if (!granted) {
      missing.push(perm);
    }
  }

  return {
    allGranted: missing.length === 0,
    missing
  };
}
