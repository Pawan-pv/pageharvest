import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsView } from '@/components/settings/SettingsView';
import { db } from '@/storage/db';
import { SettingsRepository } from '@/storage/repositories/settings-repository';

const repository = new SettingsRepository(db);

async function renderLoaded() {
  render(<SettingsView onBackToDashboard={vi.fn()} />);
  await screen.findByRole('button', { name: 'Save Preferences' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save Preferences' })).toBeEnabled()
  );
}

describe('Settings persistence through the real repository', () => {
  beforeEach(async () => {
    await db.settings.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes edited values and reads them back after the view is reopened', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Default Page Delay (ms)'), { target: { value: '2750' } });
    fireEvent.change(screen.getByLabelText('Default Max Pages Limit'), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText('Default Max Scrolls'), { target: { value: '17' } });
    fireEvent.click(screen.getByLabelText(/Include UTF-8 BOM/));
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));

    expect(await screen.findByText('Settings saved successfully.')).toBeInTheDocument();

    const saved = await repository.getSettings();
    expect(saved).toMatchObject({
      defaultDelayMs: 2750,
      defaultMaxPages: 42,
      defaultMaxScrolls: 17,
      csvIncludeBom: false,
    });

    cleanup();
    await renderLoaded();

    await waitFor(() => expect(screen.getByLabelText('Default Page Delay (ms)')).toHaveValue(2750));
    expect(screen.getByLabelText('Default Max Pages Limit')).toHaveValue(42);
    expect(screen.getByLabelText('Default Max Scrolls')).toHaveValue(17);
    expect(screen.getByLabelText(/Include UTF-8 BOM/)).not.toBeChecked();
  });

  it('shows an error and no success message when the write fails', async () => {
    await renderLoaded();
    vi.spyOn(db.settings, 'put').mockRejectedValue(new Error('disk full'));

    fireEvent.change(screen.getByLabelText('Default Page Delay (ms)'), { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));

    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
    expect(screen.queryByText('Settings saved successfully.')).not.toBeInTheDocument();
  });

  it('rejects invalid values without writing them', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Default Page Delay (ms)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/delay/i);
    expect(screen.queryByText('Settings saved successfully.')).not.toBeInTheDocument();
    expect((await repository.getSettings()).defaultDelayMs).toBe(1500);
  });

  it('does not report success before the write commits', async () => {
    await renderLoaded();
    let commit: () => void = () => undefined;
    const originalPut = db.settings.put.bind(db.settings);
    vi.spyOn(db.settings, 'put').mockImplementation(((value: never) =>
      new Promise((resolve) => {
        commit = () => resolve(originalPut(value));
      })) as never);

    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));
    await waitFor(() => expect(db.settings.put).toHaveBeenCalled());
    expect(screen.queryByText('Settings saved successfully.')).not.toBeInTheDocument();

    commit();
    expect(await screen.findByText('Settings saved successfully.')).toBeInTheDocument();
  });
});
