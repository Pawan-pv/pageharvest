import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useExtractionWorkflow } from '@/hooks/useExtractionWorkflow';
import { messagingService, TabInfo } from '@/services/messaging';
import { SettingsRepository } from '@/storage/repositories/settings-repository';
import { UserSettingsSchema } from '@/shared/contracts/settings';
import type { UserSettings } from '@/types/settings';
import type { ExtractionRecipe } from '@/types/recipe';
import { db } from '@/storage/db';

const tab: TabInfo = {
  id: 101,
  url: 'http://127.0.0.1:3456/catalog-1.html',
  title: 'Catalog',
  isInjectable: true,
};

/** Shows the pagination the next job would use, and edits it the way the Pagination step does. */
function PaginationProbe() {
  const workflow = useExtractionWorkflow(tab);
  return (
    <>
      <button
        onClick={() => workflow.updatePagination({ type: 'url_template', maxPages: 5, delayMs: 3000 })}
      >
        Set five pages
      </button>
      <button onClick={() => workflow.loadRecipe(RECIPE)}>Load recipe</button>
      <button onClick={() => workflow.updatePagination({ type: 'next_button' })}>Choose Next button</button>
      <output data-testid="pagination">
        {workflow.pagination.type}:{workflow.pagination.maxPages}:{workflow.pagination.delayMs}
      </output>
    </>
  );
}

const RECIPE: ExtractionRecipe = {
  id: 'recipe-1',
  name: 'Catalog',
  urlPattern: 'http://127.0.0.1:3456/*',
  containerSelector: '.item',
  fields: [{ id: 'f1', name: 'Title', selector: 'h3', extractor: 'text' }],
  pagination: { type: 'next_button', maxPages: 7, delayMs: 2500 },
  createdAt: 1,
  updatedAt: 1,
};

function deferredSettings() {
  let resolve: (settings: UserSettings) => void = () => undefined;
  const promise = new Promise<UserSettings>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const saved = (overrides: Partial<UserSettings>): UserSettings =>
  ({ ...UserSettingsSchema.parse({ id: 'current' }), ...overrides }) as UserSettings;

describe('saved pagination defaults', () => {
  beforeEach(async () => {
    await db.clearAllData();
    vi.spyOn(messagingService, 'reconcileJobs').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fill in the limits when the panel opens', async () => {
    vi.spyOn(SettingsRepository.prototype, 'getSettings').mockResolvedValue(
      saved({ defaultMaxPages: 42, defaultDelayMs: 2750 })
    );
    render(<PaginationProbe />);
    await waitFor(() => expect(screen.getByTestId('pagination')).toHaveTextContent('none:42:2750'));
  });

  it('never overwrite limits the person has already changed, however late they load', async () => {
    const settings = deferredSettings();
    vi.spyOn(SettingsRepository.prototype, 'getSettings').mockReturnValue(settings.promise);
    render(<PaginationProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Set five pages' }));
    expect(screen.getByTestId('pagination')).toHaveTextContent('url_template:5:3000');

    await act(async () => {
      settings.resolve(saved({ defaultMaxPages: 20, defaultDelayMs: 1500 }));
      await settings.promise;
    });
    expect(screen.getByTestId('pagination')).toHaveTextContent('url_template:5:3000');
  });

  it('never overwrite the limits of a recipe loaded before they arrive', async () => {
    const settings = deferredSettings();
    vi.spyOn(SettingsRepository.prototype, 'getSettings').mockReturnValue(settings.promise);
    render(<PaginationProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Load recipe' }));
    expect(screen.getByTestId('pagination')).toHaveTextContent('next_button:7:2500');

    await act(async () => {
      settings.resolve(saved({ defaultMaxPages: 20, defaultDelayMs: 1500 }));
      await settings.promise;
    });
    expect(screen.getByTestId('pagination')).toHaveTextContent('next_button:7:2500');
  });

  it('still fill in limits the person has not touched when only the mode was chosen', async () => {
    const settings = deferredSettings();
    vi.spyOn(SettingsRepository.prototype, 'getSettings').mockReturnValue(settings.promise);
    render(<PaginationProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose Next button' }));
    await act(async () => {
      settings.resolve(saved({ defaultMaxPages: 42, defaultDelayMs: 2750 }));
      await settings.promise;
    });
    expect(screen.getByTestId('pagination')).toHaveTextContent('next_button:42:2750');
  });
});
