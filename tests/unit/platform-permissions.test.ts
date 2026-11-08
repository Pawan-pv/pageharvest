import { describe, it, expect, beforeEach } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  hasPermission,
  checkRequiredPermissions,
  REQUIRED_PERMISSIONS
} from '@/platform/permissions';

describe('Permissions & Security Model', () => {
  let mockChrome: ChromeMock;

  beforeEach(() => {
    mockChrome = createChromeMock();
    Reflect.set(globalThis, 'chrome', mockChrome);
  });

  it('checks if a specific permission is granted', async () => {
    mockChrome.grantedPermissions = new Set(['storage', 'sidePanel']);

    expect(await hasPermission('storage')).toBe(true);
    expect(await hasPermission('sidePanel')).toBe(true);
    expect(await hasPermission('downloads')).toBe(false);
  });

  it('verifies that default required permissions conform to least-privilege', () => {
    // Ensure we do NOT request dangerous broad permissions like webRequestBlocking, debugger, all_urls broad host permissions
    expect(REQUIRED_PERMISSIONS).toContain('activeTab');
    expect(REQUIRED_PERMISSIONS).not.toContain('scripting');
    expect(REQUIRED_PERMISSIONS).toContain('sidePanel');
    expect(REQUIRED_PERMISSIONS).toContain('storage');
    expect(REQUIRED_PERMISSIONS).toContain('downloads');
    expect(REQUIRED_PERMISSIONS).not.toContain('webRequest');
    expect(REQUIRED_PERMISSIONS).not.toContain('debugger');
  });

  it('verifies overall status of required permissions', async () => {
    mockChrome.grantedPermissions = new Set(REQUIRED_PERMISSIONS);
    const status = await checkRequiredPermissions();
    expect(status.allGranted).toBe(true);
    expect(status.missing.length).toBe(0);
  });

  it('names what is missing, which is what stops a job from starting', async () => {
    mockChrome.grantedPermissions = new Set(['storage']);
    const status = await checkRequiredPermissions();
    expect(status.allGranted).toBe(false);
    expect(status.missing).toContain('downloads');
  });
});
