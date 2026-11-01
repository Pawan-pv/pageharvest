import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  hasPermission,
  requestPermission,
  checkRequiredPermissions,
  REQUIRED_PERMISSIONS
} from '@/platform/permissions';

describe('Permissions & Security Model', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    (globalThis as any).chrome = mockChrome;
  });

  it('checks if a specific permission is granted', async () => {
    mockChrome.grantedPermissions = new Set(['storage', 'sidePanel']);

    expect(await hasPermission('storage')).toBe(true);
    expect(await hasPermission('sidePanel')).toBe(true);
    expect(await hasPermission('downloads')).toBe(false);
  });

  it('requests optional permissions interactively', async () => {
    mockChrome.grantedPermissions = new Set(['storage']);

    const granted = await requestPermission('downloads');
    expect(granted).toBe(true);
    expect(mockChrome.permissions.request).toHaveBeenCalledWith({
      permissions: ['downloads']
    });
    expect(await hasPermission('downloads')).toBe(true);
  });

  it('verifies that default required permissions conform to least-privilege', () => {
    // Ensure we do NOT request dangerous broad permissions like webRequestBlocking, debugger, all_urls broad host permissions
    expect(REQUIRED_PERMISSIONS).toContain('activeTab');
    expect(REQUIRED_PERMISSIONS).toContain('sidePanel');
    expect(REQUIRED_PERMISSIONS).toContain('storage');
    expect(REQUIRED_PERMISSIONS).not.toContain('webRequest');
    expect(REQUIRED_PERMISSIONS).not.toContain('debugger');
  });

  it('verifies overall status of required permissions', async () => {
    mockChrome.grantedPermissions = new Set(REQUIRED_PERMISSIONS);
    const status = await checkRequiredPermissions();
    expect(status.allGranted).toBe(true);
    expect(status.missing.length).toBe(0);
  });
});
