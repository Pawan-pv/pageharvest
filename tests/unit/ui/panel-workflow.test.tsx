import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../../entrypoints/sidepanel/App';
import { JobCoordinator, JobTransport } from '@/background/job-coordinator';
import { PaginationConfigPanel } from '@/components/picker/PaginationConfigPanel';
import { recordsToCsv } from '@/core/export/exporter';
import { db } from '@/storage/db';
import { RecipeRepository, SettingsRepository } from '@/storage/repositories';
import { ExtractionPaginationConfig } from '@/types';
import { installBackground, makeBatch, makeRecipe } from '../../utils/job-harness';

const TAB_URL = 'http://127.0.0.1:3456/simple-grid.html';

function jobId(): Promise<string> {
  return db.jobs.toArray().then((jobs) => jobs[0].id);
}

async function saveRecipe(overrides = {}) {
  await new RecipeRepository().saveRecipe({
    ...makeRecipe({ type: 'none' }),
    id: 'recipe_saved',
    name: 'Saved catalog',
    urlPattern: TAB_URL,
    ...overrides,
  });
}

async function openLibraryTab(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Datasets' }));
  fireEvent.click(await screen.findByRole('button', { name }));
}

describe('Side panel as a view of stored state', () => {
  let coordinator: JobCoordinator;
  let transport: JobTransport;

  beforeEach(async () => {
    await db.clearAllData();
    await db.settings.clear();
    ({ coordinator, transport } = installBackground(db));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Runs a recipe through the UI, leaving the job started and the panel following it. */
  async function runSavedRecipe() {
    await openLibraryTab('Recipes');
    fireEvent.click(await screen.findByRole('button', { name: 'Run recipe Saved catalog' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start extraction/i }));
    await screen.findByText('Harvesting in Progress...');
    await waitFor(async () => expect(await db.jobs.count()).toBe(1));
  }

  it('shows a job already running when the panel reopens, without restarting it', async () => {
    await saveRecipe({ pagination: makeRecipe({ type: 'next_button' }).pagination });
    render(<App />);
    await runSavedRecipe();
    const started = await db.jobs.toArray();
    const identity = {
      jobId: started[0].id,
      projectId: started[0].projectId as string,
      datasetId: started[0].datasetId as string,
      runId: started[0].runId as string,
      generation: started[0].generation as string,
    };

    // The panel closes. The job does not depend on it, so a batch still commits.
    cleanup();
    const ack = await chromeMock.sendFromContentScript(101, makeBatch(identity, 1, ['While closed']));
    expect(ack).toMatchObject({ status: 'committed' });

    render(<App />);

    expect(await screen.findByText('Harvesting in Progress...')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Records Harvested').parentElement?.parentElement).toHaveTextContent('1')
    );
    expect(await db.jobs.count()).toBe(1);
  });

  it('moves to the results when a job finishes while the panel was closed', async () => {
    await saveRecipe({ pagination: makeRecipe({ type: 'next_button' }).pagination });
    render(<App />);
    await runSavedRecipe();
    const [job] = await db.jobs.toArray();
    const identity = {
      jobId: job.id,
      projectId: job.projectId as string,
      datasetId: job.datasetId as string,
      runId: job.runId as string,
      generation: job.generation as string,
    };
    cleanup();

    await chromeMock.sendFromContentScript(101, makeBatch(identity, 1, ['Row one']));
    await coordinator.finishJob(job.id);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Datasets' }));
    fireEvent.click(await screen.findByText(/Simple Product Grid/));

    expect(await screen.findByText('Row one')).toBeInTheDocument();
    expect(await screen.findByLabelText('Extraction summary')).toHaveTextContent('1 detected, 1 kept');
  });

  it('pauses through the background, and resumes from what storage says', async () => {
    await saveRecipe({ pagination: makeRecipe({ type: 'next_button' }).pagination });
    render(<App />);
    await runSavedRecipe();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Extraction Paused')).toBeInTheDocument();
    expect((await db.jobs.get(await jobId()))?.status).toBe('PAUSED');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByText('Harvesting in Progress...')).toBeInTheDocument();
    expect((await db.jobs.get(await jobId()))?.status).toBe('RUNNING');
  });

  it('cancels through the background, keeping what was already saved', async () => {
    await saveRecipe({ pagination: makeRecipe({ type: 'next_button' }).pagination });
    render(<App />);
    await runSavedRecipe();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Job' }));

    expect(await screen.findByText('Get data from this page')).toBeInTheDocument();
    expect((await db.jobs.get(await jobId()))?.status).toBe('CANCELLED');
    expect(await db.history.count()).toBe(1);
  });

  it('finishes through the background and opens the results', async () => {
    await saveRecipe({ pagination: makeRecipe({ type: 'next_button' }).pagination });
    render(<App />);
    await runSavedRecipe();

    fireEvent.click(screen.getByRole('button', { name: /Finish & View Results/ }));

    await waitFor(async () => {
      expect((await db.jobs.get(await jobId()))?.status).toBe('COMPLETED');
    });
    expect(await screen.findByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('shows a clear error when a job cannot start, and stays on the configuration', async () => {
    await saveRecipe();
    vi.spyOn(transport, 'sendToTab').mockRejectedValue(new Error('Receiving end does not exist.'));
    render(<App />);

    await openLibraryTab('Recipes');
    fireEvent.click(await screen.findByRole('button', { name: 'Run recipe Saved catalog' }));
    fireEvent.click(await screen.findByRole('button', { name: /Start extraction/i }));

    expect(await screen.findByText(/could not start extraction/)).toBeInTheDocument();
    expect(screen.getByText('Choose your columns')).toBeInTheDocument();
    expect((await db.jobs.toArray())[0].status).toBe('FAILED');
  });

  it('applies saved defaults to a new extraction', async () => {
    await new SettingsRepository().updateSettings({ defaultMaxScrolls: 17, defaultMaxPages: 33 });
    await saveRecipe({ pagination: undefined });
    render(<App />);

    await waitFor(async () => expect(await db.settings.count()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await openLibraryTab('Recipes');
    fireEvent.click(await screen.findByRole('button', { name: 'Run recipe Saved catalog' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Next: Pagination' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Scroll to load more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByLabelText('Most scrolls')).toHaveValue(17);

    fireEvent.click(screen.getByRole('radio', { name: 'Click a Next button' }));
    expect(screen.getByLabelText('Most pages')).toHaveValue(33);
  });

  describe('Library', () => {
    it('saves a configuration as a recipe that survives a reload and can be run', async () => {
      await saveRecipe({ id: 'recipe_base', name: 'Base recipe' });
      render(<App />);

      await openLibraryTab('Recipes');
      fireEvent.click(await screen.findByRole('button', { name: 'Run recipe Base recipe' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Next: Pagination' }));
      fireEvent.change(await screen.findByLabelText('Recipe Name'), { target: { value: 'My new recipe' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Recipe' }));

      expect(await screen.findByText('Saved recipe "My new recipe".')).toBeInTheDocument();
      const saved = (await new RecipeRepository().getAllRecipes()).find((r) => r.name === 'My new recipe');
      expect(saved?.containerSelector).toBe('.card');
      expect(saved?.fields).toHaveLength(1);

      cleanup();
      render(<App />);
      await openLibraryTab('Recipes');
      fireEvent.click(await screen.findByRole('button', { name: 'Run recipe My new recipe' }));
      fireEvent.click(await screen.findByRole('button', { name: /Start extraction/i }));

      await waitFor(async () => {
        expect((await db.jobs.toArray())[0]?.recipeId).toBe(saved?.id);
      });
    });

    it('does not report a recipe saved when the write fails', async () => {
      await saveRecipe();
      render(<App />);
      await openLibraryTab('Recipes');
      fireEvent.click(await screen.findByRole('button', { name: 'Run recipe Saved catalog' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Next: Pagination' }));
      fireEvent.change(await screen.findByLabelText('Recipe Name'), { target: { value: 'Will fail' } });

      vi.spyOn(db.recipes, 'put').mockRejectedValueOnce(new Error('disk full'));
      fireEvent.click(screen.getByRole('button', { name: 'Save Recipe' }));

      expect(await screen.findByText(/disk full/)).toBeInTheDocument();
      expect(screen.queryByText(/Saved recipe/)).not.toBeInTheDocument();
    });

    it('edits and deletes a recipe', async () => {
      await saveRecipe();
      render(<App />);
      await openLibraryTab('Recipes');

      fireEvent.click(await screen.findByRole('button', { name: 'Edit recipe Saved catalog' }));
      fireEvent.change(screen.getByLabelText('Recipe Title'), { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await screen.findByRole('button', { name: 'Run recipe Renamed' });
      expect((await db.recipes.get('recipe_saved'))?.name).toBe('Renamed');

      fireEvent.click(screen.getByRole('button', { name: 'Delete recipe Renamed' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Recipe' }));
      await waitFor(async () => expect(await db.recipes.count()).toBe(0));
      expect(await screen.findByText('No saved recipes')).toBeInTheDocument();
    });

    it('creates, renames and deletes a project', async () => {
      render(<App />);
      await openLibraryTab('Projects');

      fireEvent.change(await screen.findByLabelText('New Project'), { target: { value: 'Pricing' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
      await screen.findByText('Pricing');
      expect((await db.projects.toArray())[0].name).toBe('Pricing');

      fireEvent.click(screen.getByRole('button', { name: 'Rename project Pricing' }));
      fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Prices' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Project' }));
      await screen.findByText('Prices');

      fireEvent.click(screen.getByRole('button', { name: 'Delete project Prices' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete Project' }));
      await waitFor(async () => expect(await db.projects.count()).toBe(0));
    });

    it('explains why a project cannot be deleted while it is running', async () => {
      await saveRecipe({ pagination: makeRecipe({ type: 'next_button' }).pagination });
      render(<App />);
      await runSavedRecipe();

      await openLibraryTab('Projects');
      fireEvent.click(await screen.findByRole('button', { name: /Delete project/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete Project' }));

      expect(await screen.findByText(/extraction running/)).toBeInTheDocument();
      expect(await db.projects.count()).toBe(1);
    });

    it('lists, edits, uses and protects schemas', async () => {
      await saveRecipe();
      render(<App />);
      await openLibraryTab('Recipes');
      fireEvent.click(await screen.findByRole('button', { name: 'Run recipe Saved catalog' }));
      fireEvent.click(await screen.findByRole('button', { name: /Start extraction/i }));
      await waitFor(async () => expect(await db.schemas.count()).toBe(1));
      const [schema] = await db.schemas.toArray();
      await new RecipeRepository().updateRecipe('recipe_saved', { schemaId: schema.id });
      await coordinator.cancelJob(await jobId());
      cleanup();

      render(<App />);
      await openLibraryTab('Schemas');
      fireEvent.click(await screen.findByRole('button', { name: `Delete schema ${schema.name}` }));
      expect(await screen.findByText(/used by 1 saved recipe/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: `Edit schema ${schema.name}` }));
      fireEvent.change(screen.getByLabelText('Schema Title'), { target: { value: 'Card list' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Schema' }));
      await screen.findByText('Card list');

      fireEvent.click(screen.getByRole('button', { name: 'Use schema Card list' }));
      expect(await screen.findByText('Choose your columns')).toBeInTheDocument();
    });

    it('shows real run history for finished, failed and cancelled runs', async () => {
      await db.history.bulkPut([
        { id: 'h1', datasetId: 'd', name: 'Good run', status: 'COMPLETED', totalExtracted: 5, duplicatesSkipped: 1, startedAt: 3 },
        { id: 'h2', datasetId: 'd', name: 'Bad run', status: 'FAILED', totalExtracted: 2, duplicatesSkipped: 0, startedAt: 2, errorMessage: 'Selector broke' },
        { id: 'h3', datasetId: 'd', name: 'Stopped run', status: 'CANCELLED', totalExtracted: 1, duplicatesSkipped: 0, startedAt: 1 },
      ]);
      render(<App />);

      await openLibraryTab('Run History');

      const good = (await screen.findByText('Good run')).closest('div')?.parentElement as HTMLElement;
      expect(within(good).getByText('COMPLETED')).toBeInTheDocument();
      expect(within(good).getByText(/5 rows, 1 duplicates skipped/)).toBeInTheDocument();
      expect(screen.getByText('FAILED')).toBeInTheDocument();
      expect(screen.getByText('Selector broke')).toBeInTheDocument();
      expect(screen.getByText('CANCELLED')).toBeInTheDocument();
    });
  });

  describe('field requirements', () => {
    it('offers skipping empty rows as an explicit choice that is off by default', async () => {
      await saveRecipe();
      render(<App />);
      await openLibraryTab('Recipes');
      fireEvent.click(await screen.findByRole('button', { name: 'Run recipe Saved catalog' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Edit field Title' }));
      const choice = screen.getByLabelText(/Skip rows where this column is empty/);
      expect(choice).not.toBeChecked();
      fireEvent.click(choice);
      fireEvent.click(screen.getByRole('button', { name: 'Save field edits' }));

      expect(await screen.findByText('Required')).toBeInTheDocument();
    });
  });
});

describe('URL template configuration', () => {
  const base: ExtractionPaginationConfig = {
    type: 'url_template',
    urlTemplate: 'https://shop.test/items?page={page}',
    startPage: 1,
    pageIncrement: 1,
    maxPages: 5,
  };

  it('previews the URLs a template will visit', () => {
    render(<PaginationConfigPanel config={base} sourceUrl="https://shop.test/items" onChange={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Generated page URLs' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'https://shop.test/items?page=1',
      'https://shop.test/items?page=2',
      'https://shop.test/items?page=3',
    ]);
  });

  it('applies the starting page and increment to the preview', () => {
    render(
      <PaginationConfigPanel
        config={{ ...base, startPage: 10, pageIncrement: 20 }}
        sourceUrl="https://shop.test/items"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('https://shop.test/items?page=30')).toBeInTheDocument();
  });

  it('explains the supported placeholders', () => {
    render(<PaginationConfigPanel config={base} onChange={vi.fn()} />);
    expect(screen.getByText(/Write \{page\} where the page number goes/)).toBeInTheDocument();
    expect(screen.getByText(/\{offset\} starts at 0/)).toBeInTheDocument();
  });

  it.each([
    ['', /Enter a URL template/],
    ['https://shop.test/items', /needs a \{page\} or \{offset\}/],
    ['https://shop.test/items?page={pg}', /needs a \{page\} or \{offset\}/],
    ['https://shop.test/{page}/{other}', /Only the \{page\} and \{offset\}/],
    ['not a url {page}', /does not produce a valid URL/],
    ['ftp://shop.test/{page}', /http or https/],
    ['https://other.test/{page}', /must stay on https:\/\/shop\.test/],
    ['https://{page}.shop.test/items', /must stay on/],
  ])('rejects the template %j', (urlTemplate, expected) => {
    render(
      <PaginationConfigPanel
        config={{ ...base, urlTemplate }}
        sourceUrl="https://shop.test/items"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(expected);
    expect(screen.queryByRole('list', { name: 'Generated page URLs' })).not.toBeInTheDocument();
  });

  it('reports each setting as it changes', () => {
    const onChange = vi.fn();
    render(<PaginationConfigPanel config={base} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Page address'), { target: { value: 'https://a.test/{page}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(onChange).toHaveBeenLastCalledWith({ urlTemplate: 'https://a.test/{page}' });

    fireEvent.change(screen.getByLabelText('Count up by'), { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith({ pageIncrement: 5 });

    fireEvent.change(screen.getByLabelText('Most pages'), { target: { value: '9' } });
    expect(onChange).toHaveBeenLastCalledWith({ maxPages: 9 });
  });
});

describe('Export honesty', () => {
  it('says so when copying the table fails, instead of showing nothing', async () => {
    const { DataTable } = await import('@/components/grid/DataTable');
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Clipboard blocked')) },
    });

    render(
      <DataTable
        records={[{ _id: '1', _page: 1, _extractedAt: 1, A: 'x' }]}
        fields={[{ id: 'a', name: 'A', selector: '.a', extractor: 'text' }]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByText(/not copied: Clipboard blocked/)).toBeInTheDocument();
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows why when a download is refused', async () => {
    const { ExportDialog } = await import('@/components/grid/ExportDialog');
    const download = vi.fn().mockRejectedValue(new Error('USER_CANCELED'));
    const original = chrome.downloads.download;
    chrome.downloads.download = download as never;
    const onClose = vi.fn();

    render(
      <ExportDialog
        isOpen
        onClose={onClose}
        records={[{ _id: '1', _page: 1, _extractedAt: 1, A: -5 }]}
        fields={[{ id: 'a', name: 'A', selector: '.a', extractor: 'number' }]}
      />
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download File' }));

    expect(await screen.findByText('USER_CANCELED')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    chrome.downloads.download = original;
  });

  it('writes the value it was given', () => {
    expect(
      recordsToCsv(
        [{ _id: '1', _page: 1, _extractedAt: 1, A: -5 }],
        [{ id: 'a', name: 'A', selector: '.a', extractor: 'number' }],
        { useBom: false }
      )
    ).toBe('A\r\n-5');
  });
});
