import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ADVANCED_STORAGE_KEY,
  advancedPreference,
  createAdvancedPreference,
  type AdvancedStorageArea,
} from '@/components/settings/advanced-preference';
import { useAdvancedMode } from '@/components/settings/useAdvancedMode';
import { SettingsView } from '@/components/settings/SettingsView';
import { db } from '@/storage/db';
import { usePanelMode } from '../../utils/panel-mode';

// These tests are about the switch itself, so they start where a new user does.
beforeEach(async () => {
  await chrome.storage.local.remove(ADVANCED_STORAGE_KEY);
  await usePanelMode('simple');
  await chrome.storage.local.remove(ADVANCED_STORAGE_KEY);
});

function memoryArea(initial: Record<string, unknown> = {}): AdvancedStorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (key) => ({ [key]: data[key] }),
    set: async (items) => {
      Object.assign(data, items);
    },
  };
}

const brokenArea: AdvancedStorageArea = {
  get: () => Promise.reject(new Error('storage is unavailable')),
  set: () => Promise.reject(new Error('storage is unavailable')),
};

describe('Advanced options preference', () => {
  it('is off until the user turns it on', async () => {
    const preference = createAdvancedPreference(memoryArea());
    expect(preference.current()).toBe(false);
    expect(await preference.load()).toBe(false);
  });

  it('is remembered by the next panel that opens', async () => {
    const area = memoryArea();
    expect(await createAdvancedPreference(area).save(true)).toBe(true);
    expect(await createAdvancedPreference(area).load()).toBe(true);

    await createAdvancedPreference(area).save(false);
    expect(await createAdvancedPreference(area).load()).toBe(false);
  });

  it.each([
    ['a bare true', true],
    ['another version', { version: 2, advanced: true }],
    ['a string', { version: 1, advanced: 'yes' }],
    ['nothing', undefined],
  ])('treats %s in storage as simple mode', async (_name, stored) => {
    const preference = createAdvancedPreference(memoryArea({ [ADVANCED_STORAGE_KEY]: stored }));
    expect(await preference.load()).toBe(false);
  });

  it('falls back to simple mode when storage cannot be read', async () => {
    expect(await createAdvancedPreference(brokenArea).load()).toBe(false);
    expect(await createAdvancedPreference(undefined).load()).toBe(false);
  });

  it('follows the switch for this panel even when the choice cannot be stored, and says so', async () => {
    const preference = createAdvancedPreference(brokenArea);
    const listener = vi.fn();
    preference.subscribe(listener);

    expect(await preference.save(true)).toBe(false);
    expect(preference.current()).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('stops telling a listener that unsubscribed', async () => {
    const preference = createAdvancedPreference(memoryArea());
    const listener = vi.fn();
    const unsubscribe = preference.subscribe(listener);
    unsubscribe();
    await preference.save(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses chrome.storage.local in production and never IndexedDB', async () => {
    const settingsBefore = await db.settings.count();
    await advancedPreference.save(true);
    const stored = await chrome.storage.local.get(ADVANCED_STORAGE_KEY);
    expect(stored[ADVANCED_STORAGE_KEY]).toMatchObject({ version: 1, advanced: true });
    expect(await db.settings.count()).toBe(settingsBefore);
    await advancedPreference.save(false);
  });
});

describe('useAdvancedMode', () => {
  it('updates every screen that uses it when one of them changes the choice', async () => {
    const preference = createAdvancedPreference(memoryArea());
    const first = renderHook(() => useAdvancedMode(preference));
    const second = renderHook(() => useAdvancedMode(preference));
    expect(first.result.current.advanced).toBe(false);

    await act(async () => {
      await first.result.current.setAdvanced(true);
    });
    expect(first.result.current.advanced).toBe(true);
    expect(second.result.current.advanced).toBe(true);
  });

  it('starts from the stored choice', async () => {
    const preference = createAdvancedPreference(
      memoryArea({ [ADVANCED_STORAGE_KEY]: { version: 1, advanced: true } })
    );
    const { result } = renderHook(() => useAdvancedMode(preference));
    await waitFor(() => expect(result.current.advanced).toBe(true));
  });
});

describe('Settings: the Advanced options switch', () => {
  const advancedOnly = ['Default Page Delay (ms)', 'Default Max Pages Limit', 'CSV Delimiter', 'JSON Indentation'];

  it('is off by default, and simple mode shows none of the detailed defaults', async () => {
    render(<SettingsView onBackToDashboard={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: 'Advanced options' });
    expect(toggle).not.toBeChecked();
    for (const label of advancedOnly) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Save Preferences' })).not.toBeInTheDocument();
    // What a beginner still needs from Settings stays.
    expect(screen.getByRole('button', { name: 'Delete all saved data' })).toBeInTheDocument();
    // Nothing on the simple screen names the storage technology.
    expect(document.body.textContent).not.toMatch(/IndexedDB|dataset|client-side|telemetry/i);
  });

  it('brings every detailed default back when turned on, and stores the choice', async () => {
    const user = userEvent.setup();
    render(<SettingsView onBackToDashboard={vi.fn()} />);
    await user.click(await screen.findByRole('switch', { name: 'Advanced options' }));

    for (const label of advancedOnly) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Save Preferences' })).toBeInTheDocument();
    await waitFor(async () => {
      const stored = await chrome.storage.local.get(ADVANCED_STORAGE_KEY);
      expect(stored[ADVANCED_STORAGE_KEY]).toMatchObject({ advanced: true });
    });
  });

  it('is still on when Settings is opened again, and can be turned off', async () => {
    const user = userEvent.setup();
    await chrome.storage.local.set({ [ADVANCED_STORAGE_KEY]: { version: 1, advanced: true } });
    const view = render(<SettingsView onBackToDashboard={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: 'Advanced options' });
    await waitFor(() => expect(toggle).toBeChecked());
    expect(await screen.findByLabelText('Default Page Delay (ms)')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByLabelText('Default Page Delay (ms)')).not.toBeInTheDocument();
    view.unmount();
  });

  it('says so when the choice could not be kept for next time', async () => {
    const user = userEvent.setup();
    vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));
    render(<SettingsView onBackToDashboard={vi.fn()} />);
    await user.click(await screen.findByRole('switch', { name: 'Advanced options' }));
    expect(await screen.findByText(/could not be remembered/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
