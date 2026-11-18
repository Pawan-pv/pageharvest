import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock, ChromeMock } from '../utils/chrome-mock';
import {
  hasPermission,
  checkRequiredPermissions,
  REQUIRED_PERMISSIONS,
  originPatternForUrl,
  hasHostAccess,
  requestSiteOrigin,
  hasAllSitesAccess,
  ALL_SITES_ORIGINS,
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
    // scripting is required for on-demand injection (ADR-037). Host access is a
    // manifest host_permissions entry (ADR-040), never an API permission here.
    expect(REQUIRED_PERMISSIONS).toContain('activeTab');
    expect(REQUIRED_PERMISSIONS).toContain('scripting');
    expect(REQUIRED_PERMISSIONS).toContain('sidePanel');
    expect(REQUIRED_PERMISSIONS).toContain('storage');
    expect(REQUIRED_PERMISSIONS).toContain('downloads');
    expect(REQUIRED_PERMISSIONS).not.toContain('webRequest');
    expect(REQUIRED_PERMISSIONS).not.toContain('debugger');
    expect(REQUIRED_PERMISSIONS).not.toContain('<all_urls>');
  });

  it('builds site origins, never <all_urls>', () => {
    expect(originPatternForUrl('https://shop.test/items?page=2')).toBe('https://shop.test/*');
    expect(originPatternForUrl('http://localhost:3000/list')).toBe('http://localhost:3000/*');
    expect(originPatternForUrl('chrome://extensions/')).toBeNull();
    expect(originPatternForUrl('')).toBeNull();
  });

  it('checks and requests host access through the chrome mock', async () => {
    expect(await hasHostAccess('https://shop.test/items')).toBe(true);
    await mockChrome.permissions.remove({ origins: ['https://shop.test/*'] });
    expect(await hasHostAccess('https://shop.test/items')).toBe(false);
    expect(await requestSiteOrigin('https://shop.test/items')).toBe(true);
    expect(await hasHostAccess('https://shop.test/items')).toBe(true);
  });

  it('treats a refused or failing request as not granted, never throwing', async () => {
    await mockChrome.permissions.remove({ origins: ['https://shop.test/*'] });
    mockChrome.permissions.request.mockResolvedValueOnce(false);
    expect(await requestSiteOrigin('https://shop.test/items')).toBe(false);

    // Chrome rejects outside a user gesture; the Start and Resume clicks must not throw.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockChrome.permissions.request.mockRejectedValueOnce(new Error('This function must be called during a user gesture'));
    expect(await requestSiteOrigin('https://shop.test/items')).toBe(false);
    expect(warn).toHaveBeenCalledWith('PageHarvest could not request site access:', expect.any(Error));
    warn.mockRestore();

    mockChrome.permissions.contains.mockRejectedValueOnce(new Error('Invalid pattern'));
    expect(await hasHostAccess('https://shop.test/items')).toBe(false);
    expect(await requestSiteOrigin('chrome://extensions/')).toBe(false);
  });

  it('knows whether it still holds the access to every website it was installed with (ADR-040)', async () => {
    expect([...ALL_SITES_ORIGINS]).toEqual(['http://*/*', 'https://*/*']);
    expect(await hasAllSitesAccess()).toBe(true);
    expect(mockChrome.permissions.contains).toHaveBeenCalledWith({ origins: ['http://*/*', 'https://*/*'] });

    // The user chose "on click" or named sites in chrome://extensions.
    mockChrome.revokedOrigins.add('https://*/*');
    expect(await hasAllSitesAccess()).toBe(false);
  });

  it('assumes the installed state when Chrome cannot be asked about site access', async () => {
    mockChrome.permissions.contains.mockRejectedValueOnce(new Error('no'));
    expect(await hasAllSitesAccess()).toBe(true);
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
