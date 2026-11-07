import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GUIDE_STORAGE_KEY,
  createGuidePreferences,
  type GuideStorageArea,
} from '@/components/guide/preferences';
import { Onboarding, ONBOARDING_STEPS } from '@/components/guide/Onboarding';
import { HelpView } from '@/components/guide/HelpView';
import { GUIDE_SECTIONS, searchGuide, helpTips, type HelpTipId } from '@/components/guide/content';
import App from '../../../entrypoints/sidepanel/App';
import { db } from '@/storage/db';
import { installBackground } from '../../utils/job-harness';

const ROOT = resolve(__dirname, '../../..');

function memoryArea(initial: Record<string, unknown> = {}): GuideStorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
  };
}

function failingArea(): GuideStorageArea {
  return {
    get: vi.fn(async () => {
      throw new Error('storage unavailable');
    }),
    set: vi.fn(async () => {
      throw new Error('storage unavailable');
    }),
  };
}

describe('Guide preferences', () => {
  it('shows the tour on first open, and not after it is finished', async () => {
    const local = memoryArea();
    const prefs = createGuidePreferences(local);
    expect(await prefs.shouldShowOnboarding()).toBe(true);

    expect(await prefs.markOnboardingDone()).toBe(true);
    expect(local.data[GUIDE_STORAGE_KEY]).toMatchObject({ version: 1, onboardingDone: true });
    expect(await createGuidePreferences(local).shouldShowOnboarding()).toBe(false);
  });

  it('treats an unreadable stored value as not seen', async () => {
    const prefs = createGuidePreferences(memoryArea({ [GUIDE_STORAGE_KEY]: 'garbage' }));
    expect(await prefs.shouldShowOnboarding()).toBe(true);
  });

  it('shows the tour at most once per session when local storage fails', async () => {
    const prefs = createGuidePreferences(failingArea());
    expect(await prefs.shouldShowOnboarding()).toBe(true);
    expect(await prefs.shouldShowOnboarding()).toBe(false);
    expect(await prefs.markOnboardingDone()).toBe(false);
  });

  it('remembers the session across panel reopens through session storage', async () => {
    const session = memoryArea();
    expect(await createGuidePreferences(failingArea(), session).shouldShowOnboarding()).toBe(true);
    // The panel closes and reopens: a new page, the same browser session.
    expect(await createGuidePreferences(failingArea(), session).shouldShowOnboarding()).toBe(false);
  });

  it('uses chrome.storage.local in production and never IndexedDB', async () => {
    await db.clearAllData();
    const tables = db.tables.map((table) => table.name);
    const before = await Promise.all(db.tables.map((table) => table.count()));
    const prefs = createGuidePreferences(chrome.storage.local as unknown as GuideStorageArea);
    await prefs.markOnboardingDone();
    expect((await chrome.storage.local.get(GUIDE_STORAGE_KEY))[GUIDE_STORAGE_KEY]).toMatchObject({
      onboardingDone: true,
    });
    const after = await Promise.all(db.tables.map((table) => table.count()));
    expect(Object.fromEntries(tables.map((name, i) => [name, after[i]]))).toEqual(
      Object.fromEntries(tables.map((name, i) => [name, before[i]]))
    );
  });
});

describe('Onboarding', () => {
  it('has five steps that end with privacy', () => {
    expect(ONBOARDING_STEPS).toHaveLength(5);
    expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1].title).toMatch(/stays on your computer/);
  });

  it('walks forward and back, and finishes on the last step', async () => {
    const onFinish = vi.fn();
    render(<Onboarding onFinish={onFinish} />);
    const dialog = screen.getByRole('dialog', { name: ONBOARDING_STEPS[0].title });
    expect(dialog).toHaveAccessibleDescription('Step 1 of 5');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: ONBOARDING_STEPS[1].title })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: ONBOARDING_STEPS[0].title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    for (let i = 0; i < 4; i += 1) await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Step 5 of 5');
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('can be skipped with a button or Escape', async () => {
    const onFinish = vi.fn();
    render(<Onboarding onFinish={onFinish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(onFinish).toHaveBeenCalledTimes(1);

    cleanup();
    render(<Onboarding onFinish={onFinish} />);
    await userEvent.keyboard('{Escape}');
    expect(onFinish).toHaveBeenCalledTimes(2);
  });
});

describe('Help screen', () => {
  const required = [
    'Getting started',
    'Picking data',
    'Auto-detect',
    'Editing fields',
    'Pagination and infinite scroll',
    'Running, pausing and resuming jobs',
    'Recovering interrupted jobs',
    'Exporting',
    'Privacy',
    'Troubleshooting',
  ];

  it('lists every section', () => {
    render(<HelpView onClose={vi.fn()} onRestartTour={vi.fn()} />);
    const contents = screen.getByRole('navigation', { name: 'Guide sections' });
    for (const title of required) {
      expect(within(contents).getByRole('button', { name: title })).toBeInTheDocument();
    }
  });

  it('opens a section from the contents and shows its text', async () => {
    render(<HelpView onClose={vi.fn()} onRestartTour={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exporting' }));
    expect(screen.getByRole('heading', { name: 'Exporting' })).toBeInTheDocument();
    expect(screen.getByText(/semicolon/i)).toBeInTheDocument();
  });

  it('searches the guide and says how many sections match', async () => {
    render(<HelpView onClose={vi.fn()} onRestartTour={vi.fn()} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the guide' }), 'scroll');
    expect(screen.getByRole('status')).toHaveTextContent(/sections? match "scroll"/);
    expect(screen.getByRole('heading', { name: 'Pagination and infinite scroll' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Privacy' })).not.toBeInTheDocument();
  });

  it('says when nothing matches, and can clear the search', async () => {
    render(<HelpView onClose={vi.fn()} onRestartTour={vi.fn()} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the guide' }), 'zzzqqq');
    expect(screen.getByRole('status')).toHaveTextContent('No sections match "zzzqqq"');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('links to a public practice site without fetching anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<HelpView onClose={vi.fn()} onRestartTour={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Getting started' }));
    const link = screen.getByRole('link', { name: /practice site/i });
    expect(link).toHaveAttribute('href', 'https://books.toscrape.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('can restart the tour and go back', async () => {
    const onClose = vi.fn();
    const onRestartTour = vi.fn();
    render(<HelpView onClose={onClose} onRestartTour={onRestartTour} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show the welcome tour again' }));
    expect(onRestartTour).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Guide content', () => {
  it('has unique section ids', () => {
    const ids = GUIDE_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches every word of a search', () => {
    expect(searchGuide('csv excel').map((section) => section.id)).toContain('exporting');
    expect(searchGuide('csv zzzqqq')).toEqual([]);
    expect(searchGuide('   ')).toHaveLength(GUIDE_SECTIONS.length);
  });

  const tipIds = Object.keys(helpTips) as HelpTipId[];

  it.each(tipIds)('tip %s has copy and links to a real section', (id) => {
    expect(helpTips[id].text.trim()).not.toBe('');
    expect(GUIDE_SECTIONS.map((section) => section.id)).toContain(helpTips[id].section);
  });

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it('uses every tip somewhere in the panel, so no copy is dead', () => {
    const source = [join(ROOT, 'src/components'), join(ROOT, 'entrypoints/sidepanel')]
      .flatMap(sourceFiles)
      .filter((file) => !file.endsWith('tips.ts') && !file.endsWith('content.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const unused = tipIds.filter((id) => !source.includes(`'${id}'`) && !source.includes(`"${id}"`));
    expect(unused).toEqual([]);
  });

  it('keeps the guide, Help screen and tour out of the panel’s first chunk', () => {
    const app = readFileSync(join(ROOT, 'entrypoints/sidepanel/App.tsx'), 'utf8');
    expect(app).not.toMatch(/^import [^;]*from '@\/components\/guide\/(HelpView|Onboarding|content)'/m);
    expect(app).toMatch(/import\('@\/components\/guide\/HelpView'\)/);
    expect(app).toMatch(/import\('@\/components\/guide\/Onboarding'\)/);
  });
});

describe('App: first run and Help', () => {
  beforeEach(async () => {
    await db.clearAllData();
    installBackground(db);
  });

  it('shows the tour on first open, remembers a skip, and reopens it from Help', async () => {
    await chrome.storage.local.remove(GUIDE_STORAGE_KEY);
    render(<App />);
    expect(await screen.findByRole('dialog', { name: ONBOARDING_STEPS[0].title })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(async () =>
      expect((await chrome.storage.local.get(GUIDE_STORAGE_KEY))[GUIDE_STORAGE_KEY]).toMatchObject({
        onboardingDone: true,
      })
    );

    cleanup();
    render(<App />);
    await screen.findByText('Get data from this page');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByRole('heading', { name: 'Help and guide' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Show the welcome tour again' }));
    expect(await screen.findByRole('dialog', { name: ONBOARDING_STEPS[0].title })).toBeInTheDocument();
  });

  it('leaves Help from the main navigation', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Help' }));
    await screen.findByRole('heading', { name: 'Help and guide' });
    await userEvent.click(screen.getByRole('button', { name: 'Harvest' }));
    expect(await screen.findByText('Get data from this page')).toBeInTheDocument();
  });
});
