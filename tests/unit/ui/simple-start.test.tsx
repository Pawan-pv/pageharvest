import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../entrypoints/sidepanel/App';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { db } from '@/storage/db';
import { installBackground } from '../../utils/job-harness';
import { usePanelMode } from '../../utils/panel-mode';

function renderActions(props: Partial<React.ComponentProps<typeof QuickActions>> = {}) {
  const handlers = {
    onSelectElements: vi.fn(),
    onAutoDetectLists: vi.fn(),
    onExtractTable: vi.fn(),
    onExtractLinks: vi.fn(),
  };
  render(<QuickActions {...handlers} {...props} />);
  return handlers;
}

describe('Start screen in simple mode (T1, step 1)', () => {
  it('has one obvious primary action, and it looks for the list', async () => {
    const handlers = renderActions();
    const primary = screen.getByRole('button', { name: 'Find Data on This Page' });
    await userEvent.click(primary);
    expect(handlers.onAutoDetectLists).toHaveBeenCalledTimes(1);

    // Nothing else on the screen competes with it as a large choice.
    expect(screen.queryByRole('button', { name: 'Find data automatically' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pick items myself' })).not.toBeInTheDocument();
  });

  it('offers picking by hand as the way out when the list is not found', async () => {
    const handlers = renderActions();
    expect(screen.getByText('Not finding it?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pick one item myself' }));
    expect(handlers.onSelectElements).toHaveBeenCalledTimes(1);
  });

  it('keeps tables and links under Quick presets, in plain words', async () => {
    const handlers = renderActions();
    expect(screen.getByText('Quick presets')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Links' }));
    expect(handlers.onExtractTable).toHaveBeenCalledTimes(1);
    expect(handlers.onExtractLinks).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Extract/)).not.toBeInTheDocument();
  });

  it('disables every way to start on a page that cannot be read, and says what to do', () => {
    renderActions({ disabled: true });
    expect(screen.getByRole('button', { name: 'Find Data on This Page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pick one item myself' })).toBeDisabled();
    expect(screen.getByText(/Open a normal website tab to start/)).toBeInTheDocument();
  });

  it('gives every way to start a target at least 32px tall', () => {
    renderActions();
    for (const name of ['Find Data on This Page', 'Pick one item myself']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/min-h-(8|9|1\d)\b/);
    }
  });
});

describe('Start screen with Advanced options on', () => {
  it('keeps both large choices and the presets, so nothing is lost', async () => {
    const handlers = renderActions({ advanced: true });
    await userEvent.click(screen.getByRole('button', { name: 'Find data automatically' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pick items myself' }));
    expect(screen.getByText('Quick presets')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Links' }));
    expect(handlers.onAutoDetectLists).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectElements).toHaveBeenCalledTimes(1);
    expect(handlers.onExtractTable).toHaveBeenCalledTimes(1);
    expect(handlers.onExtractLinks).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Find Data on This Page' })).not.toBeInTheDocument();
  });
});

describe('App: the start screen follows the Advanced options switch', () => {
  beforeEach(async () => {
    await db.clearAllData();
    installBackground(db);
  });

  it('opens in simple mode for a new user and starts looking for the list in one click', async () => {
    await usePanelMode('simple');
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
    expect(await screen.findByRole('navigation', { name: 'Steps' })).toBeInTheDocument();
  });

  it('shows the detailed start options when Advanced options is on', async () => {
    await usePanelMode('advanced');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Find data automatically' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find Data on This Page' })).not.toBeInTheDocument();
  });
});
