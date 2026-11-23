import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelErrorBoundary } from '@/components/shell/PanelErrorBoundary';
import { errorReporter } from '@/core/resilience/error-reporter';

function Boom({ error }: { error: Error }): React.ReactElement {
  throw error;
}

describe('PanelErrorBoundary', () => {
  beforeEach(() => {
    errorReporter.clear();
    // React logs every error a boundary catches; the assertions below cover what matters.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the panel unchanged when nothing fails', () => {
    render(
      <PanelErrorBoundary>
        <p>Panel content</p>
      </PanelErrorBoundary>
    );

    expect(screen.getByText('Panel content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('replaces a crashed screen with a way back instead of a blank panel', async () => {
    const onReload = vi.fn();
    render(
      <PanelErrorBoundary onReload={onReload}>
        <Boom error={new Error("Cannot read properties of undefined (reading 'fields')")} />
      </PanelErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    // The background owns jobs and saved rows, so a panel crash loses neither.
    expect(alert).toHaveTextContent(/rows already saved are safe/i);
    expect(alert).toHaveTextContent(/running job keeps going/i);

    await userEvent.click(within(alert).getByRole('button', { name: /reload panel/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('records the failure locally, with the component that threw', () => {
    render(
      <PanelErrorBoundary onReload={vi.fn()}>
        <Boom error={new Error('render failed')} />
      </PanelErrorBoundary>
    );

    const reported = errorReporter.getRecentErrors();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ category: 'UNKNOWN', severity: 'FATAL', message: 'render failed' });
    expect(reported[0]?.context?.componentStack).toEqual(expect.stringContaining('Boom'));
  });

  it('says the extension was updated when a screen can no longer be loaded', () => {
    // Chrome updates an extension under an open panel; the old chunk names then fail to load.
    render(
      <PanelErrorBoundary onReload={vi.fn()}>
        <Boom
          error={
            new TypeError(
              'Failed to fetch dynamically imported module: chrome-extension://abc/chunks/DataTable-1a2b3c.js'
            )
          }
        />
      </PanelErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { name: /pageharvest was updated/i })).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /reload panel/i })).toBeInTheDocument();
  });

  it('keeps the technical message for a bug report, folded away', async () => {
    render(
      <PanelErrorBoundary onReload={vi.fn()}>
        <Boom error={new Error('render failed')} />
      </PanelErrorBoundary>
    );

    const message = screen.getByText('render failed');
    expect(message).not.toBeVisible();
    await userEvent.click(screen.getByText(/technical details/i));
    expect(message).toBeVisible();
  });
});
