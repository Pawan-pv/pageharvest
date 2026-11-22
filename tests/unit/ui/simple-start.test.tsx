import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../../entrypoints/sidepanel/App';
import { ToolHub } from '@/components/dashboard/ToolHub';
import { db } from '@/storage/db';
import { installBackground } from '../../utils/job-harness';
import { usePanelMode } from '../../utils/panel-mode';

function renderTools(props: Partial<React.ComponentProps<typeof ToolHub>> = {}) {
  const handlers = {
    onAutoDetectLists: vi.fn(),
    onExtractTable: vi.fn(),
    onExtractLinks: vi.fn(),
    onViewAllHistory: vi.fn(),
  };
  render(<ToolHub datasetsCount={0} {...handlers} {...props} />);
  return handlers;
}

describe('Start screen in simple mode (T1, step 1)', () => {
  it('has one obvious primary action, and it looks for the list', async () => {
    const handlers = renderTools();
    const primary = screen.getByRole('button', { name: 'Find Data on This Page' });
    await userEvent.click(primary);
    expect(handlers.onAutoDetectLists).toHaveBeenCalledTimes(1);

    // The old competing start choices are gone: one list action leads the hub.
    expect(screen.queryByRole('button', { name: 'Find data automatically' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pick items myself' })).not.toBeInTheDocument();
  });

  it('keeps tables and links as equally visible tools, in plain words', async () => {
    const handlers = renderTools();
    await userEvent.click(screen.getByRole('button', { name: 'Extract a table' }));
    await userEvent.click(screen.getByRole('button', { name: 'Extract all links' }));
    expect(handlers.onExtractTable).toHaveBeenCalledTimes(1);
    expect(handlers.onExtractLinks).toHaveBeenCalledTimes(1);

    expect(screen.getByText('Table Extractor')).toBeInTheDocument();
    expect(screen.getByText('Links Extractor')).toBeInTheDocument();
    expect(screen.queryByText('Quick presets')).not.toBeInTheDocument();
  });

  it('disables every way to start on a page that cannot be read', () => {
    renderTools({ disabled: true });
    expect(screen.getByRole('button', { name: 'Find Data on This Page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Extract a table' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Extract all links' })).toBeDisabled();
  });

  it('gives every live tool a full-width target with room around it', () => {
    renderTools();
    for (const name of ['Find Data on This Page', 'Extract a table', 'Extract all links']) {
      const className = screen.getByRole('button', { name }).className;
      expect(className).toMatch(/\bw-full\b/);
      expect(className).toMatch(/\bp-3\.5\b/);
    }
  });
});

describe('Start screen with Advanced options on', () => {
  it('offers the same tool hub, so nothing is lost or duplicated', async () => {
    const handlers = renderTools();
    await userEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
    expect(handlers.onAutoDetectLists).toHaveBeenCalledTimes(1);

    // The v2.0 preview suite is visible to everyone, always disabled.
    expect(screen.getByRole('button', { name: 'Page Extractor' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Find data automatically' })).not.toBeInTheDocument();
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

  it('shows the same tool hub when Advanced options is on', async () => {
    await usePanelMode('advanced');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
    expect(screen.getByText('List Extractor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find data automatically' })).not.toBeInTheDocument();
  });
});
