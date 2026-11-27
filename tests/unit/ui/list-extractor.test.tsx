import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from '~/entrypoints/sidepanel/App';
import {
  ListSetupView,
  PickerFocusView,
  ListRunningView,
  ListCompleteView,
} from '@/components/list-extractor';
import { HarvestProgressStage, recordsToConveyorItems } from '@/components/shared/HarvestProgressStage';
import {
  useExtractionWorkflow,
  type DetectedList,
  type ExtractionStats,
} from '@/hooks/useExtractionWorkflow';
import * as permissions from '@/platform/permissions';
import * as workbench from '@/platform/workbench';
import { messagingService, type TabInfo } from '@/services/messaging';
import { db } from '@/storage/db';
import { DatasetRepository, JobRepository } from '@/storage/repositories';
import type { JobTransport } from '@/background/job-coordinator';
import { installBackground, makeBatch } from '../../utils/job-harness';
import { booksHtml, installFakePage } from '../../utils/fake-page';
import { usePanelMode } from '../../utils/panel-mode';
import type { Dataset, ExtractedRecord, FieldDefinition, ExtractionPaginationConfig } from '@/types';

const MOCK_FIELDS: FieldDefinition[] = [
  { id: 'f1', name: 'Product Title', selector: 'h2.title', extractor: 'text' },
  { id: 'f2', name: 'Price', selector: '.price', extractor: 'text' },
  { id: 'f3', name: 'Image', selector: 'img.thumb', extractor: 'src' },
];

const MOCK_PAGINATION: ExtractionPaginationConfig = {
  type: 'none',
  delayMs: 1000,
  maxPages: 10,
};

const MOCK_DETECTED_LIST: DetectedList = {
  containerSelector: '.product-card',
  matchCount: 20,
  sampleSnippets: ['Alpha Headset', 'Beta Mouse'],
};

const MOCK_STATS: ExtractionStats = {
  progressKind: 'pages',
  currentStep: 1,
  targetSteps: 1,
  totalExtracted: 20,
  duplicatesSkipped: 0,
  recordsDetected: 20,
  recordsWithMissingFields: 0,
  recordsFiltered: 0,
  recordsFailed: 0,
  elapsedSeconds: 4,
  status: 'RUNNING',
};

const MOCK_DATASET: Dataset = {
  id: 'ds-test-1',
  name: 'Store Products',
  url: 'https://store.example.com',
  createdAt: 1000,
  updatedAt: 2000,
  recordsCount: 20,
  fields: MOCK_FIELDS,
};

const MOCK_RECORDS_WITH_IMAGES: ExtractedRecord[] = Array.from({ length: 6 }, (_, i) => ({
  _id: `rec-${i}`,
  _page: 1,
  _extractedAt: 1000 + i,
  id: `rec-${i}`,
  datasetId: 'ds-test-1',
  'Product Title': `Product ${i + 1}`,
  Price: `$${(i + 1) * 10}`,
  Image: `https://images.example.com/p${i + 1}.jpg`,
}));

const MOCK_TEXT_RECORDS: ExtractedRecord[] = Array.from({ length: 4 }, (_, i) => ({
  _id: `rec-${i}`,
  _page: 1,
  _extractedAt: 1000 + i,
  id: `rec-${i}`,
  datasetId: 'ds-test-1',
  'Article Title': `Article Headline ${i + 1}`,
  Author: `Author ${i + 1}`,
}));

describe('5-State List Extractor Flow (Emerald Pulse)', () => {
  describe('State A: ListSetupView', () => {
    it('renders Step 1 before selection with dropzone and auto-detect pill, dims Step 2, and disables CTA', () => {
      const onPickList = vi.fn();
      const onAutoDetect = vi.fn();
      const onStartExtraction = vi.fn();

      render(
        <ListSetupView
          detectedList={null}
          fields={[]}
          selectedFieldIds={new Set()}
          pagination={MOCK_PAGINATION}
          onPickList={onPickList}
          onAutoDetect={onAutoDetect}
          onRepick={vi.fn()}
          onPaginationChange={vi.fn()}
          onStartExtraction={onStartExtraction}
        />
      );

      // Card 1 before selection
      expect(screen.getByText('Click to Pick List')).toBeInTheDocument();
      expect(screen.getByText('Hover and click any repeated item on the page')).toBeInTheDocument();
      const autoDetectBtn = screen.getByRole('button', { name: /Auto-detect on this page/i });
      expect(autoDetectBtn).toBeInTheDocument();

      fireEvent.click(screen.getByText('Click to Pick List'));
      expect(onPickList).toHaveBeenCalledTimes(1);

      fireEvent.click(autoDetectBtn);
      expect(onAutoDetect).toHaveBeenCalledTimes(1);

      // Sticky CTA disabled
      const startBtn = screen.getByRole('button', { name: 'Start Extraction' });
      expect(startBtn).toBeDisabled();
    });

    it('renders confirmed summary card after list detection, unlocks Step 2, and enables Start Extraction', async () => {
      const onRepick = vi.fn();
      const onPaginationChange = vi.fn();
      const onStartExtraction = vi.fn();

      render(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1', 'f2', 'f3'])}
          pagination={MOCK_PAGINATION}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={onRepick}
          onPaginationChange={onPaginationChange}
          onStartExtraction={onStartExtraction}
        />
      );

      // Confirmed Card 1
      expect(screen.getByText(/Found 20 items · 3 columns/)).toBeInTheDocument();
      expect(screen.getByText('.product-card')).toBeInTheDocument();

      // Quick buttons
      const repickBtn = screen.getByRole('button', { name: /Re-pick/i });
      fireEvent.click(repickBtn);
      expect(onRepick).toHaveBeenCalledTimes(1);

      // Card 2 options
      expect(screen.getByText('This Page Only')).toBeInTheDocument();
      expect(screen.getByText('Auto-Scroll')).toBeInTheDocument();
      expect(screen.getByText('Pagination')).toBeInTheDocument();
      expect(screen.getByText('Load More')).toBeInTheDocument();

      // Selecting Auto-Scroll calls pagination change
      fireEvent.click(screen.getByText('Auto-Scroll'));
      expect(onPaginationChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'infinite_scroll' })
      );

      // Start extraction enabled
      const startBtn = screen.getByRole('button', { name: 'Start Extraction' });
      expect(startBtn).toBeEnabled();
      fireEvent.click(startBtn);
      expect(onStartExtraction).toHaveBeenCalledTimes(1);
    });

    it('toggles column editor when Edit columns is clicked', () => {
      const onToggleField = vi.fn();

      render(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1', 'f2'])}
          pagination={MOCK_PAGINATION}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onToggleField={onToggleField}
          onPaginationChange={vi.fn()}
          onStartExtraction={vi.fn()}
        />
      );

      const editBtn = screen.getByRole('button', { name: /Edit columns/i });
      fireEvent.click(editBtn);

      expect(screen.getByText('Toggle Columns')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Product Title')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Price')).toBeInTheDocument();
    });

    it('disables auto-detect when isDetecting is true', () => {
      render(
        <ListSetupView
          detectedList={null}
          fields={[]}
          selectedFieldIds={new Set()}
          pagination={MOCK_PAGINATION}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPaginationChange={vi.fn()}
          onStartExtraction={vi.fn()}
          isDetecting={true}
        />
      );

      const detectBtn = screen.getByRole('button', { name: /Detecting lists/i });
      expect(detectBtn).toBeDisabled();
    });

    it('calls onEditColumns when supplied and falls back to Reading columns when fields are empty', () => {
      const onEditColumns = vi.fn();
      const { rerender } = render(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1'])}
          pagination={MOCK_PAGINATION}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onEditColumns={onEditColumns}
          onPaginationChange={vi.fn()}
          onStartExtraction={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Edit columns/i }));
      expect(onEditColumns).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Toggle Columns')).not.toBeInTheDocument();

      rerender(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={[]}
          selectedFieldIds={new Set()}
          pagination={MOCK_PAGINATION}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPaginationChange={vi.fn()}
          onStartExtraction={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Edit columns/i }));
      expect(screen.getByText('Reading columns…')).toBeInTheDocument();
    });

    it('hides Limits & timing for none mode and enforces ADR-046 scrollDelayMs/delayMs >= 1000', () => {
      const onPaginationChange = vi.fn();
      const { rerender } = render(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1'])}
          pagination={MOCK_PAGINATION}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPaginationChange={onPaginationChange}
          onStartExtraction={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: /Limits & timing/i })).not.toBeInTheDocument();

      rerender(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1'])}
          pagination={{ type: 'infinite_scroll', scrollCount: 12, scrollDelayMs: 1800 }}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPaginationChange={onPaginationChange}
          onStartExtraction={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Limits & timing/i }));
      const scrollsInput = screen.getByLabelText('Max scrolls') as HTMLInputElement;
      const delayInput = screen.getByLabelText('Delay (min 1,000 ms)') as HTMLInputElement;
      expect(scrollsInput.value).toBe('12');
      expect(delayInput.value).toBe('1800');

      fireEvent.change(delayInput, { target: { value: '250' } });
      expect(onPaginationChange).toHaveBeenCalledWith({ scrollDelayMs: 1000 });

      fireEvent.change(scrollsInput, { target: { value: '25' } });
      expect(onPaginationChange).toHaveBeenCalledWith({ scrollCount: 25 });

      rerender(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1'])}
          pagination={{ type: 'next_button', maxPages: 8, delayMs: 1500, nextButtonSelector: 'a.next' }}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPickNextButton={vi.fn()}
          onPaginationChange={onPaginationChange}
          onStartExtraction={vi.fn()}
        />
      );

      expect(screen.getByText('Button: a.next')).toBeInTheDocument();
      const maxPagesInput = screen.getByLabelText('Max pages') as HTMLInputElement;
      expect(maxPagesInput.value).toBe('8');
      fireEvent.change(screen.getByLabelText('Delay (min 1,000 ms)'), { target: { value: '300' } });
      expect(onPaginationChange).toHaveBeenCalledWith({ delayMs: 1000 });
    });

    it('supports picking a Next button in both Pagination and Load More cards', () => {
      const onPickNextButton = vi.fn();
      const { rerender } = render(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1'])}
          pagination={{ type: 'next_button', maxPages: 10, delayMs: 1500 }}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPickNextButton={onPickNextButton}
          onPaginationChange={vi.fn()}
          onStartExtraction={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Pick Next button/i }));
      expect(onPickNextButton).toHaveBeenCalledTimes(1);

      rerender(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set(['f1'])}
          pagination={{
            type: 'next_button',
            maxPages: 10,
            delayMs: 1500,
            nextButtonSelector: 'button.load-more',
            isLoadMore: true,
          } as ExtractionPaginationConfig}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPickNextButton={onPickNextButton}
          onPaginationChange={vi.fn()}
          onStartExtraction={vi.fn()}
        />
      );

      expect(screen.getByText('Button: button.load-more')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Pick Load More button/i }));
      expect(onPickNextButton).toHaveBeenCalledTimes(2);
    });

    it('displays 0 columns and 0 selected when all columns are unchecked', () => {
      render(
        <ListSetupView
          detectedList={MOCK_DETECTED_LIST}
          fields={MOCK_FIELDS}
          selectedFieldIds={new Set()}
          pagination={MOCK_PAGINATION}
          onPickList={vi.fn()}
          onAutoDetect={vi.fn()}
          onRepick={vi.fn()}
          onPaginationChange={vi.fn()}
          onStartExtraction={vi.fn()}
        />
      );

      expect(screen.getByText(/Found 20 items · 0 columns/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Edit columns/i }));
      expect(screen.getByText('0 selected')).toBeInTheDocument();
    });
  });

  describe('State B: PickerFocusView', () => {
    it('renders radar animation, 2-step guide, Alt tip, and handles Cancel & Escape', () => {
      const onCancel = vi.fn();

      render(<PickerFocusView onCancel={onCancel} />);

      expect(screen.getByText('Select a List Item')).toBeInTheDocument();
      expect(screen.getByText('Hover')).toBeInTheDocument();
      expect(screen.getByText('Click')).toBeInTheDocument();
      expect(screen.getByText('Hold Alt')).toBeInTheDocument();

      const cancelBtn = screen.getByRole('button', { name: 'Cancel Selection' });
      fireEvent.click(cancelBtn);
      expect(onCancel).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledTimes(2);
    });

    it('displays inspected element snippet when hovering', () => {
      render(
        <PickerFocusView
          inspectedElement={{ selector: 'div.product-grid > article', tagName: 'ARTICLE', classList: ['card'] }}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('div.product-grid > article')).toBeInTheDocument();
    });

    it('renders Next button prompt when pickTarget is next_button', () => {
      render(<PickerFocusView pickTarget="next_button" onCancel={vi.fn()} />);
      expect(screen.getByText('Select Next Button')).toBeInTheDocument();
    });
  });

  describe('State C: ListRunningView', () => {
    it('renders rotating pulse ring, live item counter, telemetry card, and actions', () => {
      const onPause = vi.fn();
      const onResume = vi.fn();
      const onStop = vi.fn();

      const { rerender } = render(
        <ListRunningView
          stats={MOCK_STATS}
          records={MOCK_RECORDS_WITH_IMAGES}
          dataset={MOCK_DATASET}
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
        />
      );

      expect(screen.getAllByText('20').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('ITEMS EXTRACTED')).toBeInTheDocument();
      expect(screen.getByText('ELAPSED')).toBeInTheDocument();
      expect(screen.getByText('4s')).toBeInTheDocument();
      expect(screen.getByText('Local')).toBeInTheDocument();

      // Pause button
      const pauseBtn = screen.getByRole('button', { name: /Pause/i });
      fireEvent.click(pauseBtn);
      expect(onPause).toHaveBeenCalledTimes(1);

      // Stop button
      const stopBtn = screen.getByRole('button', { name: /Stop extraction/i });
      fireEvent.click(stopBtn);
      expect(onStop).toHaveBeenCalledTimes(1);

      // Rerender as paused
      rerender(
        <ListRunningView
          stats={{ ...MOCK_STATS, status: 'PAUSED' }}
          records={MOCK_RECORDS_WITH_IMAGES}
          dataset={MOCK_DATASET}
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
        />
      );

      expect(screen.getByText('Paused')).toBeInTheDocument();
      const resumeBtn = screen.getByRole('button', { name: /Resume/i });
      fireEvent.click(resumeBtn);
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('renders 3-row mini ticker when records have no images', () => {
      render(
        <ListRunningView
          stats={MOCK_STATS}
          records={MOCK_TEXT_RECORDS}
          dataset={MOCK_DATASET}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
        />
      );

      expect(screen.getByText('Article Headline 2')).toBeInTheDocument();
      expect(screen.getByText('Article Headline 3')).toBeInTheDocument();
      expect(screen.getByText('Article Headline 4')).toBeInTheDocument();
    });

    it('opens the live workbench for the active dataset when View results live is clicked', () => {
      const openSpy = vi.spyOn(workbench, 'openWorkbench').mockResolvedValue({ tabId: 1, reused: false });
      render(
        <ListRunningView
          stats={MOCK_STATS}
          records={MOCK_RECORDS_WITH_IMAGES}
          dataset={MOCK_DATASET}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /View results live/i }));
      expect(openSpy).toHaveBeenCalledWith({ datasetId: 'ds-test-1' });
      openSpy.mockRestore();
    });

    it('handles FAILED status cleanly by stopping animations and showing Failed + errorMessage', () => {
      const onStop = vi.fn();
      const { container } = render(
        <ListRunningView
          stats={{
            ...MOCK_STATS,
            status: 'FAILED',
            errorMessage: 'Navigation timed out after 3 retries',
          }}
          records={[]}
          dataset={MOCK_DATASET}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={onStop}
        />
      );

      expect(screen.getByText('Extraction Failed')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Navigation timed out after 3 retries');
      expect(container.querySelector('.ph-ring-spin')).toBeNull();
      expect(container.querySelector('.animate-pulse')).toBeNull();
      expect(container.querySelector('.ph-aura-breathe')).toBeNull();
      expect(screen.queryByRole('button', { name: /Pause/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Resume/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Stop extraction/i }));
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('State D: ListCompleteView', () => {
    it('renders draw-in checkmark, hero count, telemetry summary, workbench CTA, and export pills', async () => {
      const onDone = vi.fn();
      const onSaveRecipe = vi.fn().mockResolvedValue(undefined);

      // Mock navigator.clipboard
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(
        <ListCompleteView
          dataset={MOCK_DATASET}
          records={MOCK_RECORDS_WITH_IMAGES}
          fields={MOCK_FIELDS}
          runSummary={{ elapsedSeconds: 4, stopReason: 'completed', currentStep: 1 }}
          onDone={onDone}
          onSaveRecipe={onSaveRecipe}
        />
      );

      expect(screen.getByText('Extraction complete')).toBeInTheDocument();
      expect(screen.getAllByText('6').length).toBeGreaterThanOrEqual(1); // 6 records in mock
      expect(screen.getByText('ITEMS EXTRACTED')).toBeInTheDocument();
      expect(screen.getByText('COLUMNS')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();

      // Primary workbench CTA
      expect(screen.getByRole('button', { name: /View data & export/i })).toBeInTheDocument();

      // Export pills
      expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /XLSX|Download for Excel/i })).toBeInTheDocument();

      const copyTsvBtn = screen.getByRole('button', { name: 'Copy TSV' });
      fireEvent.click(copyTsvBtn);
      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });

      // Done button
      const doneBtn = screen.getByRole('button', { name: 'Done' });
      fireEvent.click(doneBtn);
      expect(onDone).toHaveBeenCalledTimes(1);

      // Bookmark / Save as Recipe button
      const bookmarkBtn = screen.getByRole('button', { name: 'Save as Recipe' });
      fireEvent.click(bookmarkBtn);
      expect(onSaveRecipe).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(screen.getByText('Saved!')).toBeInTheDocument();
      });
    });

    it('clears Copy TSV and Save as Recipe timers cleanly on unmount', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });
      const onSaveRecipe = vi.fn().mockResolvedValue(undefined);

      const { unmount } = render(
        <ListCompleteView
          dataset={MOCK_DATASET}
          records={MOCK_RECORDS_WITH_IMAGES}
          fields={MOCK_FIELDS}
          onDone={vi.fn()}
          onSaveRecipe={onSaveRecipe}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Copy TSV' }));
      await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Save as Recipe' }));
      await waitFor(() => expect(screen.getByText('Saved!')).toBeInTheDocument());

      unmount();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('skips post-await state updates and timer scheduling when unmounted mid-action', async () => {
      let resolveSave!: () => void;
      const onSaveRecipe = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          })
      );
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const { unmount } = render(
        <ListCompleteView
          dataset={MOCK_DATASET}
          records={MOCK_RECORDS_WITH_IMAGES}
          fields={MOCK_FIELDS}
          onDone={vi.fn()}
          onSaveRecipe={onSaveRecipe}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Save as Recipe' }));
      expect(onSaveRecipe).toHaveBeenCalledTimes(1);

      const callsBeforeUnmount = setTimeoutSpy.mock.calls.length;
      unmount();

      await act(async () => {
        resolveSave();
        await Promise.resolve();
      });

      expect(setTimeoutSpy.mock.calls.length).toBe(callsBeforeUnmount);
      setTimeoutSpy.mockRestore();
    });

    it('renders preview table snippet when records contain text only', () => {
      render(
        <ListCompleteView
          dataset={MOCK_DATASET}
          records={MOCK_TEXT_RECORDS}
          fields={[]}
          onDone={vi.fn()}
        />
      );

      expect(screen.getByText('Preview Snippet')).toBeInTheDocument();
      expect(screen.getByText('Article Headline 1')).toBeInTheDocument();
    });

    it('renders 6-spark celebration burst, CTA sheen, elevated cards, and zero img tags', () => {
      const { container } = render(
        <ListCompleteView
          dataset={MOCK_DATASET}
          records={MOCK_RECORDS_WITH_IMAGES}
          fields={MOCK_FIELDS}
          runSummary={{ elapsedSeconds: 3, stopReason: 'completed', currentStep: 1 }}
          onDone={vi.fn()}
        />
      );

      const sparks = container.querySelectorAll('.ph-spark-burst');
      expect(sparks).toHaveLength(6);
      sparks.forEach((spark) => {
        expect(spark.getAttribute('class')).toContain('motion-reduce:animate-none');
      });

      expect(container.querySelector('.ph-check-draw')).toBeTruthy();
      expect(container.querySelector('svg[viewBox="0 0 64 64"]')?.getAttribute('class')).toContain('overflow-visible');
      const primaryCta = screen.getByRole('button', { name: /View data & export/i });
      expect(primaryCta.className).toContain('ph-cta-sheen');
      expect(primaryCta.className).toContain('motion-reduce:animate-none');
      expect(container.querySelectorAll('.ph-card-elevated').length).toBeGreaterThanOrEqual(2);
      expect(container.querySelectorAll('img')).toHaveLength(0);
    });
  });

  describe('Shared HarvestProgressStage', () => {
    it('renders 148x148 Harvest Reactor ring, orbit/scan motion, conveyor rows, reduced-motion classes, and zero img tags when running', () => {
      const { container } = render(
        <HarvestProgressStage
          count={12}
          metricLabel="ITEMS EXTRACTED"
          status="running"
          elapsedSeconds={4}
          conveyorItems={[
            { id: 'r-1', primary: 'Wireless Mouse', pills: ['$29', 'store.example.com'] },
            { id: 'r-2', primary: 'Mechanical Keyboard', pills: ['$89'] },
          ]}
        />
      );

      const svg = container.querySelector('svg[viewBox="0 0 148 148"]');
      expect(svg).toBeTruthy();
      expect(container.querySelector('.ph-orbit-slow')?.getAttribute('class')).toContain('motion-reduce:animate-none');
      expect(container.querySelector('.ph-ring-spin')?.getAttribute('class')).toContain('motion-reduce:animate-none');
      expect(container.querySelector('.ph-scan-beam')?.className).toContain('motion-reduce:animate-none');
      expect(container.querySelectorAll('.ph-row-enter')).toHaveLength(2);
      expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/12 items extracted, running/i);
      expect(container.querySelectorAll('img')).toHaveLength(0);
      expect(screen.getByText('Wireless Mouse')).toBeInTheDocument();
      expect(screen.getByText('$29')).toBeInTheDocument();
      expect(screen.getByText('store.example.com')).toBeInTheDocument();
    });

    it('halts orbit/ring/scan animations cleanly when paused and triggers ph-harvest-pulse when count increases', () => {
      const { container, rerender } = render(
        <HarvestProgressStage
          count={5}
          metricLabel="EMAILS FOUND"
          status="running"
          elapsedSeconds={2}
          conveyorItems={[{ id: 'e-1', primary: 'team@example.com', pills: ['example.com'] }]}
        />
      );

      expect(container.querySelector('.ph-harvest-pulse')).toBeNull();

      rerender(
        <HarvestProgressStage
          count={9}
          metricLabel="EMAILS FOUND"
          status="running"
          elapsedSeconds={3}
          conveyorItems={[{ id: 'e-2', primary: 'sales@example.com', pills: ['example.com'] }]}
        />
      );

      const pulse = container.querySelector('.ph-harvest-pulse');
      expect(pulse).toBeTruthy();
      expect(pulse?.className).toContain('motion-reduce:animate-none');
      expect(container.querySelector('.ph-tick-up')).toBeTruthy();

      rerender(
        <HarvestProgressStage
          count={9}
          metricLabel="EMAILS FOUND"
          status="paused"
          elapsedSeconds={3}
          pacingNotice="Paused — press Resume to continue"
          conveyorItems={[{ id: 'e-2', primary: 'sales@example.com', pills: ['example.com'] }]}
        />
      );

      expect(container.querySelector('.ph-orbit-slow')).toBeNull();
      expect(container.querySelector('.ph-ring-spin')).toBeNull();
      expect(container.querySelector('.ph-scan-beam')).toBeNull();
      expect(screen.getByText('Paused')).toBeInTheDocument();
      expect(screen.getByText('Paused — press Resume to continue')).toBeInTheDocument();
      expect(container.querySelectorAll('img')).toHaveLength(0);
    });

    it('preserves internal elapsed seconds across Pause and Resume when count is 0 and resets only on a fresh run', () => {
      vi.useFakeTimers();
      try {
        const { rerender } = render(
          <HarvestProgressStage count={0} metricLabel="PAGES EXTRACTED" status="running" />
        );

        act(() => {
          vi.advanceTimersByTime(4000);
        });
        expect(screen.getByText('4s')).toBeInTheDocument();

        rerender(<HarvestProgressStage count={0} metricLabel="PAGES EXTRACTED" status="paused" />);
        expect(screen.getByText('4s')).toBeInTheDocument();

        rerender(<HarvestProgressStage count={0} metricLabel="PAGES EXTRACTED" status="running" />);
        expect(screen.getByText('4s')).toBeInTheDocument();

        rerender(<HarvestProgressStage count={0} metricLabel="PAGES EXTRACTED" status="completed" />);
        rerender(<HarvestProgressStage count={0} metricLabel="PAGES EXTRACTED" status="running" />);
        expect(screen.getByText('0s')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('filters image and HTML fields in recordsToConveyorItems and preserves stable keys across prepends', () => {
      const baseRecords: ExtractedRecord[] = [
        {
          _id: '',
          _page: 1,
          _extractedAt: 1000,
          Title: 'Trail Stove',
          'Body (HTML)': '<p>Ultralight stove</p>',
          'Image Src': 'https://cdn.example.com/stove?v=1',
          'Variant Image': 'https://cdn.example.com/variant?v=2',
          'Variant Price': '$64',
        },
      ];
      const first = recordsToConveyorItems(baseRecords, 4);
      expect(first).toHaveLength(1);
      expect(first[0].primary).toBe('Trail Stove');
      expect(first[0].pills).toEqual(['$64']);

      const second = recordsToConveyorItems(
        [
          ...baseRecords,
          {
            _id: '',
            _page: 1,
            _extractedAt: 2000,
            Title: 'Field Bag',
            'OG Image': 'https://cdn.example.com/bag?v=1',
            'Variant Price': '$128',
          },
        ],
        4
      );
      expect(second).toHaveLength(2);
      expect(second[0].primary).toBe('Field Bag');
      expect(second[1].id).toBe(first[0].id);
    });

    it('emits concrete @keyframes definitions in sidepanel/style.css and table/style.css for all Harvest Motion primitives', () => {
      const sidepanelCss = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/style.css'), 'utf8');
      for (const name of [
        'ph-orbit-slow',
        'ph-ring-spin',
        'ph-harvest-pulse',
        'ph-tick-up',
        'ph-row-enter',
        'ph-scan-beam',
        'ph-spark-burst',
        'ph-cta-sheen',
        'ph-check-draw',
        'ph-aura-breathe',
        'ph-radar-ping',
        'ph-pop-in',
        'ph-shimmer',
      ]) {
        expect(sidepanelCss).toContain(`@keyframes ${name}`);
      }

      const tableCss = readFileSync(resolve(process.cwd(), 'entrypoints/table/style.css'), 'utf8');
      for (const name of [
        'ph-orbit-slow',
        'ph-ring-spin',
        'ph-harvest-pulse',
        'ph-tick-up',
        'ph-row-enter',
        'ph-scan-beam',
        'ph-aura-breathe',
        'ph-shimmer',
      ]) {
        expect(tableCss).toContain(`@keyframes ${name}`);
      }
    });
  });

  describe('useExtractionWorkflow 5-state wiring', () => {
    const tab: TabInfo = {
      id: 101,
      url: 'https://store.example.com/products',
      title: 'Store',
      isInjectable: true,
    };

    let subscriber: ((msg: unknown, origin?: { tabId?: number }) => void) | null = null;

    function HookProbe() {
      const wf = useExtractionWorkflow(tab);
      return (
        <div>
          <button onClick={() => void wf.startVisualPicker()}>Pick List</button>
          <button onClick={() => void wf.startNextButtonPicker()}>Pick Next</button>
          <button onClick={() => void wf.autoDetectLists()}>Auto Detect</button>
          <button onClick={() => void wf.cancelVisualPicker()}>Cancel Pick</button>
          <button
            onClick={() => {
              if (wf.detectedList) void wf.confirmListCandidate(wf.detectedList);
            }}
          >
            Confirm List
          </button>
          <output data-testid="probe-view">{wf.view}</output>
          <output data-testid="probe-flags">
            {String(wf.isVisualPicking)}:{String(wf.isAutoDetecting)}:{wf.pickTarget}
          </output>
          <output data-testid="probe-list">{wf.detectedList?.containerSelector ?? 'none'}</output>
          <output data-testid="probe-next">{wf.pagination.nextButtonSelector ?? 'none'}</output>
          <output data-testid="probe-fields">{wf.fields.map((f) => f.name).join(',') || 'none'}</output>
          <output data-testid="probe-records">{wf.records.length}</output>
        </div>
      );
    }

    beforeEach(async () => {
      await db.clearAllData();
      subscriber = null;
      vi.spyOn(messagingService, 'reconcileJobs').mockResolvedValue(undefined);
      vi.spyOn(messagingService, 'subscribe').mockImplementation((fn) => {
        subscriber = fn as (msg: unknown, origin?: { tabId?: number }) => void;
        return () => {
          subscriber = null;
        };
      });
      vi.spyOn(messagingService, 'startElementPicker').mockResolvedValue(undefined);
      vi.spyOn(messagingService, 'stopElementPicker').mockResolvedValue(undefined);
      vi.spyOn(messagingService, 'detectRepeatedElements').mockResolvedValue(undefined);
      vi.spyOn(messagingService, 'detectFields').mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('separates isVisualPicking from autoDetectLists and supports next-button picking without clobbering detectedList', async () => {
      render(<HookProbe />);
      await waitFor(() => expect(subscriber).not.toBeNull());

      // Auto-detect should not set isVisualPicking
      fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));
      await waitFor(() => {
        expect(screen.getByTestId('probe-view')).toHaveTextContent('inspecting');
      });
      expect(screen.getByTestId('probe-flags')).toHaveTextContent('false:false:list');

      // Receive detected list and confirm it
      await act(async () => {
        subscriber?.(
          {
            type: 'REPEATED_ELEMENTS_DETECTED',
            payload: {
              containerSelector: '.product-card',
              matchCount: 12,
              sampleSnippets: ['One', 'Two'],
            },
          },
          { tabId: 101 }
        );
      });
      expect(screen.getByTestId('probe-list')).toHaveTextContent('.product-card');

      fireEvent.click(screen.getByRole('button', { name: 'Confirm List' }));
      await waitFor(() => expect(screen.getByTestId('probe-view')).toHaveTextContent('config_fields'));

      await act(async () => {
        subscriber?.(
          {
            type: 'FIELDS_DETECTED',
            payload: {
              suggestedFields: [{ id: 'f1', name: 'Title', selector: 'h2', extractor: 'text' }],
            },
          },
          { tabId: 101 }
        );
      });
      expect(screen.getByTestId('probe-fields')).toHaveTextContent('Title');

      // Pick Next button: sets next_button target, keeps detectedList & fields intact
      fireEvent.click(screen.getByRole('button', { name: 'Pick Next' }));
      await waitFor(() => {
        expect(screen.getByTestId('probe-flags')).toHaveTextContent('true:false:next_button');
      });

      await act(async () => {
        subscriber?.(
          {
            type: 'ELEMENT_SELECTED',
            payload: {
              selector: 'a.next-page',
              tagName: 'A',
              classList: ['next-page'],
              textSnippet: 'Next',
            },
          },
          { tabId: 101 }
        );
      });

      expect(screen.getByTestId('probe-next')).toHaveTextContent('a.next-page');
      expect(screen.getByTestId('probe-list')).toHaveTextContent('.product-card');
      expect(screen.getByTestId('probe-view')).toHaveTextContent('config_fields');
      expect(screen.getByTestId('probe-flags')).toHaveTextContent('false:false:list');
      expect(messagingService.detectRepeatedElements).toHaveBeenCalledTimes(1);
      expect(messagingService.stopElementPicker).toHaveBeenCalled();

      // Re-pick clears stale fields only when a new list is detected (cancelling preserves old fields)
      fireEvent.click(screen.getByRole('button', { name: 'Pick List' }));
      await waitFor(() => expect(screen.getByTestId('probe-flags')).toHaveTextContent('true:false:list'));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Pick' }));
      await waitFor(() => expect(screen.getByTestId('probe-view')).toHaveTextContent('config_fields'));
      expect(screen.getByTestId('probe-fields')).toHaveTextContent('Title');

      // Actual Re-pick detection clears old fields for the new list
      fireEvent.click(screen.getByRole('button', { name: 'Pick List' }));
      await waitFor(() => expect(screen.getByTestId('probe-flags')).toHaveTextContent('true:false:list'));
      await act(async () => {
        subscriber?.(
          {
            type: 'REPEATED_ELEMENTS_DETECTED',
            payload: {
              containerSelector: '.article-row',
              matchCount: 8,
              sampleSnippets: ['Row 1'],
            },
          },
          { tabId: 101 }
        );
      });
      expect(screen.getByTestId('probe-list')).toHaveTextContent('.article-row');
      expect(screen.getByTestId('probe-fields')).toHaveTextContent('none');
    });

    it('streams live records read-only from DatasetRepository while job is RUNNING', async () => {
      const jobRepo = new JobRepository();
      const datasetRepo = new DatasetRepository();
      await datasetRepo.createDataset({
        id: 'ds-live-1',
        name: 'Live Test',
        url: 'https://store.example.com/products',
        jobId: 'job-live-1',
        createdAt: 1000,
        updatedAt: 1000,
        recordsCount: 2,
        fields: MOCK_FIELDS,
      });
      await datasetRepo.addRecords('ds-live-1', [
        {
          _id: 'r1',
          _page: 1,
          _extractedAt: 1001,
          datasetId: 'ds-live-1',
          'Product Title': 'Item 1',
        },
        {
          _id: 'r2',
          _page: 1,
          _extractedAt: 1002,
          datasetId: 'ds-live-1',
          'Product Title': 'Item 2',
        },
      ]);
      await jobRepo.saveJob({
        id: 'job-live-1',
        datasetId: 'ds-live-1',
        targetUrl: 'https://store.example.com/products',
        schema: {
          id: 'schema-1',
          name: 'Live Schema',
          urlPattern: 'https://store.example.com/*',
          version: 1,
          containerSelector: '.product-card',
          fields: MOCK_FIELDS.map((f) => ({ ...f, required: false, transform: 'none' as const })),
          pagination: {
            type: 'none',
            maxPages: 10,
            delayMs: 1000,
            scrollCount: 10,
            scrollDelayMs: 1000,
            startPage: 1,
            pageIncrement: 1,
            stopCondition: 'no_new_records',
          },
          createdAt: 1000,
          updatedAt: 1000,
        },
        status: 'RUNNING',
        progressKind: 'single',
        lastSequence: 1,
        totalExtracted: 2,
        duplicatesSkipped: 0,
        pagesVisited: 1,
        scrollsCompleted: 0,
        recordsDetected: 2,
        recordsWithMissingFields: 0,
        recordsFiltered: 0,
        recordsFailed: 0,
        consecutiveEmptySteps: 0,
        startedAt: 1000,
        pausedMs: 0,
        updatedAt: 1000,
        errors: [],
      });

      render(<HookProbe />);

      await waitFor(() => {
        expect(screen.getByTestId('probe-view')).toHaveTextContent('extracting');
        expect(screen.getByTestId('probe-records')).toHaveTextContent('2');
      });
    });

    it('dropList clears stale detectedList, fields, and listSource when view is dashboard and no job is running', async () => {
      function DashboardDropProbe({ currentTab }: { currentTab: TabInfo }) {
        const wf = useExtractionWorkflow(currentTab);
        return (
          <div>
            <button onClick={() => void wf.autoDetectLists()}>Auto Detect</button>
            <button
              onClick={() => {
                if (wf.detectedList) void wf.confirmListCandidate(wf.detectedList);
              }}
            >
              Confirm List
            </button>
            <button onClick={() => wf.setView('dashboard')}>Go Dashboard</button>
            <output data-testid="drop-view">{wf.view}</output>
            <output data-testid="drop-list">{wf.detectedList?.containerSelector ?? 'none'}</output>
            <output data-testid="drop-fields">{wf.fields.map((f) => f.name).join(',') || 'none'}</output>
            <output data-testid="drop-source">{wf.listSource?.url ?? 'none'}</output>
          </div>
        );
      }

      const { rerender } = render(<DashboardDropProbe currentTab={tab} />);
      await waitFor(() => expect(subscriber).not.toBeNull());

      fireEvent.click(screen.getByRole('button', { name: 'Auto Detect' }));
      await waitFor(() => expect(screen.getByTestId('drop-view')).toHaveTextContent('inspecting'));

      await act(async () => {
        subscriber?.(
          {
            type: 'REPEATED_ELEMENTS_DETECTED',
            payload: {
              containerSelector: '.old-page-card',
              matchCount: 9,
              sampleSnippets: ['Old 1', 'Old 2'],
            },
          },
          { tabId: 101 }
        );
      });

      fireEvent.click(screen.getByRole('button', { name: 'Confirm List' }));
      await waitFor(() => expect(screen.getByTestId('drop-view')).toHaveTextContent('config_fields'));

      await act(async () => {
        subscriber?.(
          {
            type: 'FIELDS_DETECTED',
            payload: {
              suggestedFields: [{ id: 'f1', name: 'Old Title', selector: 'h2', extractor: 'text' }],
            },
          },
          { tabId: 101 }
        );
      });
      expect(screen.getByTestId('drop-fields')).toHaveTextContent('Old Title');
      expect(screen.getByTestId('drop-source')).toHaveTextContent('https://store.example.com/products');

      // Leave setup view to dashboard without resetToDashboard
      fireEvent.click(screen.getByRole('button', { name: 'Go Dashboard' }));
      await waitFor(() => expect(screen.getByTestId('drop-view')).toHaveTextContent('dashboard'));

      // Navigate tab to a different URL: dropList() must still clear stale list/fields/listSource
      rerender(
        <DashboardDropProbe
          currentTab={{
            ...tab,
            url: 'https://other-site.example.com/blog',
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('drop-list')).toHaveTextContent('none');
        expect(screen.getByTestId('drop-fields')).toHaveTextContent('none');
        expect(screen.getByTestId('drop-source')).toHaveTextContent('none');
      });
    });
  });

  describe('App.tsx dock navigation and stale-list lifecycle', () => {
    const TAB_URL = 'https://store.example.com/products';
    let bgTransport: JobTransport;

    const enableBroadcastForwarding = () => {
      vi.spyOn(bgTransport, 'broadcast').mockImplementation(async (message) => {
        chromeMock.notifyFromContentScript(101, JSON.parse(JSON.stringify(message)));
      });
    };

    beforeEach(async () => {
      await db.clearAllData();
      await usePanelMode('simple');
      ({ transport: bgTransport } = installBackground(db));
      chromeMock.activeTab = {
        ...chromeMock.activeTab,
        id: 101,
        url: TAB_URL,
        title: 'Example Store',
        status: 'complete',
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns cleanly to ToolHub (not SimpleDone) when clicking Tools from ListCompleteView or a viewed dataset', async () => {
      const datasetRepo = new DatasetRepository();
      await datasetRepo.createDataset({
        id: 'ds-saved-1',
        name: 'Saved Products',
        url: TAB_URL,
        createdAt: 1000,
        updatedAt: 1000,
        recordsCount: 1,
        fields: [{ id: 'f1', name: 'Title', selector: 'h2', extractor: 'text' }],
      });
      await datasetRepo.addRecords('ds-saved-1', [
        {
          _id: 'rec-1',
          _page: 1,
          _extractedAt: 1001,
          datasetId: 'ds-saved-1',
          Title: 'Saved Item 1',
        },
      ]);

      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      render(<App />);
      await screen.findByRole('button', { name: 'Find Data on This Page' });

      // 1. Open saved dataset from Data -> SimpleDone renders -> click Tools -> must return to ToolHub
      const mainNav = screen.getByRole('navigation', { name: 'Main' });
      fireEvent.click(within(mainNav).getByRole('button', { name: 'Data' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Open Saved Products' }));
      expect(await screen.findByRole('button', { name: 'Download for Excel' })).toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download for Excel' })).not.toBeInTheDocument();

      // 2. Run List Extractor to ListCompleteView -> click Tools -> must return to ToolHub (not SimpleDone)
      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);

      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      await screen.findByText('Live Extraction Stage');
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const [job] = await db.jobs.toArray();
      await act(async () => {
        await chromeMock.sendFromContentScript(
          101,
          makeBatch(
            {
              jobId: job.id,
              projectId: job.projectId as string,
              datasetId: job.datasetId as string,
              runId: job.runId as string,
              generation: job.generation as string,
            },
            1,
            ['Collected Item']
          )
        );
        await new Promise((r) => setTimeout(r, 30));
      });
      fireEvent.click(screen.getByRole('button', { name: /Stop extraction/i }));
      expect(await screen.findByText('Extraction complete')).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download for Excel' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Done\.\s+\d+\s+row/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Extraction complete')).not.toBeInTheDocument();
    });

    it('navigates from ListRunningView to ToolHub on Tools click without dropping into SimpleProgress, and restores ListRunningView on re-entry', async () => {
      installFakePage(booksHtml(12), 101, { url: TAB_URL });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 12 items · [1-9]\d* columns/);

      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Click Tools in the command dock -> must show ToolHub, NOT legacy SimpleProgress
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      expect(screen.queryByText(/Collecting your rows/i)).not.toBeInTheDocument();

      // Re-opening List Extractor returns cleanly to ListRunningView
      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
    });

    it('clears stale detectedList and listSource when leaving ListSetupView via dock Tools and navigating to a new URL', async () => {
      installFakePage(booksHtml(9), 101, { url: TAB_URL });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      expect(await screen.findByText(/Found 9 items · [1-9]\d* columns/)).toBeInTheDocument();

      // Abandon ListSetupView via dock Tools
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();

      // Navigate active tab to a new URL
      const newUrl = 'https://other-site.example.com/blog';
      await act(async () => {
        chromeMock.activeTab = { ...chromeMock.activeTab, id: 101, url: newUrl, title: 'Other Blog' };
        chromeMock.triggerTabUpdated(101, { url: newUrl }, chromeMock.activeTab);
        await new Promise((r) => setTimeout(r, 20));
      });

      // Re-open List Extractor on the new URL: must be fresh and unselected, never stale ul.products
      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      expect(await screen.findByText('Click to Pick List')).toBeInTheDocument();
      expect(screen.queryByText('Locked')).not.toBeInTheDocument();
      expect(screen.queryByText(/Found 9 items/)).not.toBeInTheDocument();
    });

    it('restores ListCompleteView (not SimpleDone) with Tools active pill when a list job completes while on ToolHub', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);

      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Navigate to ToolHub while the list job is running
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();

      const [job] = await db.jobs.toArray();
      const identity = {
        jobId: job.id,
        projectId: job.projectId as string,
        datasetId: job.datasetId as string,
        runId: job.runId as string,
        generation: job.generation as string,
      };
      await act(async () => {
        await chromeMock.sendFromContentScript(101, makeBatch(identity, 1, ['Collected Item']));
        await chromeMock.sendFromContentScript(101, {
          id: 'fin-bug-a-1',
          type: 'JOB_FINISHED',
          timestamp: Date.now(),
          payload: { identity, lastSequence: 1, stopReason: 'completed' },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(await screen.findByText('Extraction complete')).toBeInTheDocument();
      expect(screen.queryByText(/Done\.\s+\d+\s+row/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/See and change all rows/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Get another list')).not.toBeInTheDocument();
      expect(
        within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' })
      ).toHaveAttribute('aria-current', 'page');
    });

    it('restores ListCompleteView and syncs aria-current="page" to Tools when a list job completes while viewing Data or Recipes', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      render(<App />);

      // 1. Job completes while viewing Data
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);
      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const navAfterStart = screen.getByRole('navigation', { name: 'Main' });
      fireEvent.click(within(navAfterStart).getByRole('button', { name: 'Data' }));
      expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Data' })).toHaveAttribute(
        'aria-current',
        'page'
      );

      const [job1] = await db.jobs.toArray();
      const id1 = {
        jobId: job1.id,
        projectId: job1.projectId as string,
        datasetId: job1.datasetId as string,
        runId: job1.runId as string,
        generation: job1.generation as string,
      };
      await act(async () => {
        await chromeMock.sendFromContentScript(101, makeBatch(id1, 1, ['Data View Row']));
        await chromeMock.sendFromContentScript(101, {
          id: 'fin-ch2-data',
          type: 'JOB_FINISHED',
          timestamp: Date.now(),
          payload: { identity: id1, lastSequence: 1, stopReason: 'completed' },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(await screen.findByText('Extraction complete')).toBeInTheDocument();
      const navAfterDataComplete = screen.getByRole('navigation', { name: 'Main' });
      expect(within(navAfterDataComplete).getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-current', 'page');
      expect(within(navAfterDataComplete).getByRole('button', { name: 'Data' })).not.toHaveAttribute('aria-current', 'page');

      // 2. Return via Done, start second list job, and complete while viewing Recipes
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);
      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => {
        const jobs = await db.jobs.toArray();
        expect(jobs.length).toBe(2);
        expect(jobs.find((j) => j.id !== job1.id)?.status).toBe('RUNNING');
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Recipes' }));
      expect(await screen.findByRole('heading', { name: 'Saved Recipes' })).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(
        within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Recipes' })
      ).toHaveAttribute('aria-current', 'page');

      const allJobs = await db.jobs.toArray();
      const job2 = allJobs.find((j) => j.id !== job1.id)!;
      const id2 = {
        jobId: job2.id,
        projectId: job2.projectId as string,
        datasetId: job2.datasetId as string,
        runId: job2.runId as string,
        generation: job2.generation as string,
      };
      await act(async () => {
        await chromeMock.sendFromContentScript(101, makeBatch(id2, 1, ['Recipes View Row']));
        await chromeMock.sendFromContentScript(101, {
          id: 'fin-ch2-recipes',
          type: 'JOB_FINISHED',
          timestamp: Date.now(),
          payload: { identity: id2, lastSequence: 1, stopReason: 'completed' },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(await screen.findByText('Extraction complete')).toBeInTheDocument();
      const navAfterRecipesComplete = screen.getByRole('navigation', { name: 'Main' });
      expect(within(navAfterRecipesComplete).getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-current', 'page');
      expect(within(navAfterRecipesComplete).getByRole('button', { name: 'Recipes' })).not.toHaveAttribute(
        'aria-current',
        'page'
      );
    });

    it('clears stale detectedList and listSource on URL navigation after a background JOB_FAILED while on ToolHub', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(6), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 6 items · [1-9]\d* columns/);

      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Leave to ToolHub while running
      await act(async () => {
        fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();

      const [job] = await db.jobs.toArray();
      await act(async () => {
        await chromeMock.sendFromContentScript(101, {
          id: 'fail-bg-1',
          type: 'JOB_FAILED',
          timestamp: Date.now(),
          payload: {
            identity: {
              jobId: job.id,
              projectId: job.projectId as string,
              datasetId: job.datasetId as string,
              runId: job.runId as string,
              generation: job.generation as string,
            },
            message: 'Selector broke',
            category: 'SELECTOR_NOT_FOUND',
            code: 'CONTAINER_NOT_FOUND',
            recoverable: false,
          },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      await waitFor(async () => expect((await db.jobs.get(job.id))?.status).toBe('FAILED'));

      // Navigate active tab to a new URL: stale list/source must be cleared
      const newUrl = 'https://other-after-fail.example.com/list';
      await act(async () => {
        chromeMock.activeTab = { ...chromeMock.activeTab, id: 101, url: newUrl, title: 'Other List' };
        chromeMock.triggerTabUpdated(101, { url: newUrl }, chromeMock.activeTab);
        await new Promise((r) => setTimeout(r, 20));
      });

      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      expect(await screen.findByText('Click to Pick List')).toBeInTheDocument();
      expect(screen.queryByText('Locked')).not.toBeInTheDocument();
      expect(screen.queryByText(/Found 6 items/)).not.toBeInTheDocument();
    });

    it('preserves ListRunningView FAILED alert and Stop extraction -> ListCompleteView, and clears stale list on Tools exit', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(6), 101, { url: TAB_URL });
      render(<App />);

      // 1. Failed ListRunningView -> Stop extraction -> ListCompleteView
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 6 items · [1-9]\d* columns/);
      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const [job1] = await db.jobs.toArray();
      await act(async () => {
        await chromeMock.sendFromContentScript(101, {
          id: 'fail-ui-1',
          type: 'JOB_FAILED',
          timestamp: Date.now(),
          payload: {
            identity: {
              jobId: job1.id,
              projectId: job1.projectId as string,
              datasetId: job1.datasetId as string,
              runId: job1.runId as string,
              generation: job1.generation as string,
            },
            message: 'Page blocked',
            category: 'DOM_PARSING',
            code: 'CONTAINER_NOT_FOUND',
            recoverable: false,
          },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(await screen.findByText('Extraction Failed')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Page blocked');

      fireEvent.click(screen.getByRole('button', { name: /Stop extraction/i }));
      expect(await screen.findByText('Extraction complete')).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // 2. Return via Done, fail a second job, and exit via dock Tools -> re-open is fresh
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 6 items · [1-9]\d* columns/);
      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => {
        const jobs = await db.jobs.toArray();
        expect(jobs.length).toBe(2);
        expect(jobs.find((j) => j.id !== job1.id)?.status).toBe('RUNNING');
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const allJobs = await db.jobs.toArray();
      const job2 = allJobs.find((j) => j.id !== job1.id)!;
      await act(async () => {
        await chromeMock.sendFromContentScript(101, {
          id: 'fail-ui-2',
          type: 'JOB_FAILED',
          timestamp: Date.now(),
          payload: {
            identity: {
              jobId: job2.id,
              projectId: job2.projectId as string,
              datasetId: job2.datasetId as string,
              runId: job2.runId as string,
              generation: job2.generation as string,
            },
            message: 'Blocked again',
            category: 'DOM_PARSING',
            code: 'CONTAINER_NOT_FOUND',
            recoverable: false,
          },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(await screen.findByText('Extraction Failed')).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      expect(await screen.findByText('Click to Pick List')).toBeInTheDocument();
    });

    it('cancels in-flight autoDetectLists when leaving ListSetupView via Data or Settings so late REPEATED_ELEMENTS_DETECTED does not hijack view', async () => {
      installFakePage(booksHtml(6), 101, { url: TAB_URL });
      let resolveDetect!: () => void;
      const detectSpy = vi.spyOn(messagingService, 'detectRepeatedElements').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDetect = resolve;
          })
      );

      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await waitFor(() => expect(detectSpy).toHaveBeenCalledTimes(1));

      // Leave ListSetupView via dock Data while detection is in-flight
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Data' }));
      expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();

      await act(async () => {
        chromeMock.notifyFromContentScript(101, {
          id: 'late-detect-data',
          type: 'REPEATED_ELEMENTS_DETECTED',
          timestamp: Date.now(),
          payload: {
            containerSelector: 'ul.products > li',
            matchCount: 6,
            sampleSnippets: ['Book 1', 'Book 2'],
            credible: true,
          },
        });
        resolveDetect();
        await Promise.resolve();
      });

      expect(screen.getByRole('heading', { name: 'My data' })).toBeInTheDocument();
      expect(screen.queryByText(/We found \d+ items|Check your columns|Found \d+ items/)).not.toBeInTheDocument();

      // Re-open List Extractor: Auto-detect button must be enabled (not stuck "Detecting lists…")
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      const autoDetectBtn = await screen.findByRole('button', { name: /Auto-detect on this page/i });
      expect(autoDetectBtn).toBeEnabled();

      // Repeat for Settings header button
      let resolveDetectSettings!: () => void;
      detectSpy.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveDetectSettings = resolve;
          })
      );
      fireEvent.click(autoDetectBtn);
      await waitFor(() => expect(detectSpy).toHaveBeenCalledTimes(2));

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(await screen.findByRole('switch', { name: /Advanced options/i })).toBeInTheDocument();

      await act(async () => {
        chromeMock.notifyFromContentScript(101, {
          id: 'late-detect-settings',
          type: 'REPEATED_ELEMENTS_DETECTED',
          timestamp: Date.now(),
          payload: {
            containerSelector: 'ul.products > li',
            matchCount: 6,
            sampleSnippets: ['Book 1', 'Book 2'],
            credible: true,
          },
        });
        resolveDetectSettings();
        await Promise.resolve();
      });

      expect(screen.getByRole('switch', { name: /Advanced options/i })).toBeInTheDocument();
      expect(screen.queryByText(/We found \d+ items|Check your columns|Found \d+ items/)).not.toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      expect(await screen.findByRole('button', { name: /Auto-detect on this page/i })).toBeEnabled();
    });

    it('shows ListOnAnotherTab when re-opening List Extractor after switching tabs while away on Data', async () => {
      installFakePage(booksHtml(6), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      expect(await screen.findByText(/Found 6 items · [1-9]\d* columns/)).toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Data' }));
      expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();

      await act(async () => {
        chromeMock.activeTab = {
          ...chromeMock.activeTab,
          id: 202,
          url: 'https://other.example.com',
          title: 'Other',
        };
        chromeMock.triggerTabActivated({ tabId: 202, windowId: 1 });
        await new Promise((r) => setTimeout(r, 20));
      });

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));

      expect(await screen.findByText('This list is on another tab')).toBeInTheDocument();
      expect(screen.queryByText(/Found 6 items/)).not.toBeInTheDocument();
    });

    it('does not hijack a running legacy Extract all links job into ListRunningView and renders SimpleDone on completion', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(6), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Extract all links' }));
      await screen.findByRole('heading', { name: /We found 6 items on this page/i });
      fireEvent.click(screen.getByRole('button', { name: 'Yes, this is my list' }));

      await screen.findByRole('heading', { name: 'Check your columns' });
      await waitFor(() =>
        expect(screen.getAllByRole('checkbox', { name: /^Keep the column / }).length).toBeGreaterThanOrEqual(1)
      );
      fireEvent.click(screen.getByRole('button', { name: 'Start collecting' }));

      expect(await screen.findByRole('heading', { name: 'Collecting your rows…' })).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Click dock Tools -> ToolHub renders cleanly
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Collecting your rows…' })).not.toBeInTheDocument();
      expect(screen.queryByText('Live Extraction Stage')).not.toBeInTheDocument();

      // Clicking Find Data on This Page while legacy job is active must NOT hijack into ListRunningView
      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      expect(await screen.findByRole('heading', { name: 'Collecting your rows…' })).toBeInTheDocument();
      expect(screen.queryByText('Live Extraction Stage')).not.toBeInTheDocument();

      // Return to ToolHub and let legacy job complete
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();

      const [job] = await db.jobs.toArray();
      const identity = {
        jobId: job.id,
        projectId: job.projectId as string,
        datasetId: job.datasetId as string,
        runId: job.runId as string,
        generation: job.generation as string,
      };
      await act(async () => {
        await chromeMock.sendFromContentScript(101, makeBatch(identity, 1, ['Book number 1']));
        await chromeMock.sendFromContentScript(101, {
          id: 'fin-links-1',
          type: 'JOB_FINISHED',
          timestamp: Date.now(),
          payload: { identity, lastSequence: 1, stopReason: 'completed' },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(await screen.findByRole('heading', { name: /Done\. 1 row collected/i })).toBeInTheDocument();
      expect(screen.queryByText('Extraction complete')).not.toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /Done\. 1 row collected/i })).not.toBeInTheDocument();
    });

    it('returns cleanly to ToolHub from Advanced-mode LibraryView -> DataTable on dock Tools click', async () => {
      await usePanelMode('advanced');
      const datasetRepo = new DatasetRepository();
      await datasetRepo.createDataset({
        id: 'ds-adv-1',
        name: 'Saved Products',
        url: TAB_URL,
        createdAt: 1000,
        updatedAt: 1000,
        recordsCount: 1,
        fields: [{ id: 'f1', name: 'Title', selector: 'h2', extractor: 'text' }],
      });
      await datasetRepo.addRecords('ds-adv-1', [
        {
          _id: 'rec-adv-1',
          _page: 1,
          _extractedAt: 1001,
          datasetId: 'ds-adv-1',
          Title: 'Saved Item 1',
        },
      ]);

      render(<App />);
      await screen.findByRole('button', { name: 'Find Data on This Page' });

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Data' }));
      expect(await screen.findByRole('navigation', { name: 'Library sections' })).toBeInTheDocument();
      expect(await screen.findByText('Saved Extractions')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText('Loading extraction history...')).not.toBeInTheDocument());

      fireEvent.click(await screen.findByRole('heading', { name: 'Saved Products' }));
      expect(await screen.findByPlaceholderText('Search across all columns...')).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
      expect(screen.getByText('Saved Item 1')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download for Excel' })).not.toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Search across all columns...')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Download for Excel' })).not.toBeInTheDocument();
      expect(screen.queryByText('Extraction complete')).not.toBeInTheDocument();
    });

    it('H1: stopExtraction clears RUNNING status so Data -> Tools -> Find Data on This Page opens ListSetupView instead of SimpleProgress', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);
      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      fireEvent.click(screen.getByRole('button', { name: /Stop extraction/i }));
      expect(await screen.findByText('Extraction complete')).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Data' }));
      expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Find Data on This Page' }));
      expect(await screen.findByText('Click to Pick List')).toBeInTheDocument();
      expect(screen.queryByText(/Collecting your rows/i)).not.toBeInTheDocument();
    });

    it('H2: rapid double-click on Start Extraction across async requestSiteOrigin starts only one job and keeps ListRunningView', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      vi.spyOn(permissions, 'requestSiteOrigin').mockImplementation(
        () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 15))
      );
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);

      const startBtn = screen.getByRole('button', { name: 'Start Extraction' });
      fireEvent.click(startBtn);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      fireEvent.click(startBtn);

      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 80));
      });

      expect(await db.jobs.count()).toBe(1);
      expect(screen.getByText('Live Extraction Stage')).toBeInTheDocument();
      expect(screen.queryByText(/already running in this tab/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Click to Pick List')).not.toBeInTheDocument();
    });

    it('H3: navigating to Data while requestSiteOrigin is pending aborts Start Extraction without hijacking My data', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      let resolvePermission!: (granted: boolean) => void;
      vi.spyOn(permissions, 'requestSiteOrigin').mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolvePermission = resolve;
          })
      );
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);

      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      await waitFor(() => expect(permissions.requestSiteOrigin).toHaveBeenCalledTimes(1));

      // Navigate away to Data while permission prompt is still open
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Data' }));
      expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();

      await act(async () => {
        resolvePermission(true);
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(screen.getByRole('heading', { name: 'My data' })).toBeInTheDocument();
      expect(screen.queryByText(/Collecting your rows/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Live Extraction Stage')).not.toBeInTheDocument();
      expect(await db.jobs.count()).toBe(0);
    });

    it('H4: cancelled Re-pick via Escape ignores late REPEATED_ELEMENTS_DETECTED so locked list is not overwritten', async () => {
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      expect(await screen.findByText(/Found 5 items · [1-9]\d* columns/)).toBeInTheDocument();

      let resolveRepickDetect!: () => void;
      vi.spyOn(messagingService, 'detectRepeatedElements').mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRepickDetect = resolve;
          })
      );

      fireEvent.click(screen.getByRole('button', { name: /Re-pick/i }));
      expect(await screen.findByText('Select a List Item')).toBeInTheDocument();

      await act(async () => {
        chromeMock.notifyFromContentScript(101, {
          id: 'repick-el-1',
          type: 'ELEMENT_SELECTED',
          timestamp: Date.now(),
          payload: {
            selector: 'div.other-list',
            tagName: 'DIV',
            classList: ['other-list'],
            textSnippet: 'Other',
          },
        });
        await Promise.resolve();
      });

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(await screen.findByText(/Found 5 items/)).toBeInTheDocument();

      await act(async () => {
        chromeMock.notifyFromContentScript(101, {
          id: 'repick-late-detect',
          type: 'REPEATED_ELEMENTS_DETECTED',
          timestamp: Date.now(),
          payload: {
            containerSelector: 'div.other-list',
            matchCount: 99,
            sampleSnippets: ['Other 1', 'Other 2'],
            credible: true,
          },
        });
        resolveRepickDetect();
        await new Promise((r) => setTimeout(r, 30));
      });

      expect(screen.getByText(/Found 5 items/)).toBeInTheDocument();
      expect(screen.queryByText(/Found 99 items/)).not.toBeInTheDocument();
    });

    it('H5: background RECOVERABLE transition while viewing Data syncs aria-current="page" back to Tools', async () => {
      enableBroadcastForwarding();
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);
      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Data' }));
      expect(await screen.findByRole('heading', { name: 'My data' })).toBeInTheDocument();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      const [job] = await db.jobs.toArray();
      await act(async () => {
        await chromeMock.sendFromContentScript(101, {
          id: 'fail-rec-h5',
          type: 'JOB_FAILED',
          timestamp: Date.now(),
          payload: {
            identity: {
              jobId: job.id,
              projectId: job.projectId as string,
              datasetId: job.datasetId as string,
              runId: job.runId as string,
              generation: job.generation as string,
            },
            message: 'Tab disconnected',
            category: 'RUNTIME_MESSAGING',
            code: 'TAB_DISCONNECTED',
            recoverable: true,
          },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      await waitFor(async () => expect((await db.jobs.get(job.id))?.status).toBe('RECOVERABLE'));
      expect(await screen.findByRole('button', { name: 'Find Data on This Page' })).toBeInTheDocument();
      await act(async () => {
        await vi.dynamicImportSettled();
        await new Promise((r) => setTimeout(r, 50));
      });

      const navAfterRecover = screen.getByRole('navigation', { name: 'Main' });
      expect(within(navAfterRecover).getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-current', 'page');
      expect(within(navAfterRecover).getByRole('button', { name: 'Data' })).not.toHaveAttribute('aria-current', 'page');
    });

    it('H6: list job completing while Email Extractor is open restores ListCompleteView when clicking Back', async () => {
      await import('@/components/tools/EmailExtractorView');
      enableBroadcastForwarding();
      installFakePage(booksHtml(5), 101, { url: TAB_URL });
      render(<App />);

      fireEvent.click(await screen.findByRole('button', { name: 'Find Data on This Page' }));
      fireEvent.click(await screen.findByRole('button', { name: /Auto-detect on this page/i }));
      await screen.findByText(/Found 5 items · [1-9]\d* columns/);
      fireEvent.click(screen.getByRole('button', { name: 'Start Extraction' }));
      expect(await screen.findByText('Live Extraction Stage')).toBeInTheDocument();
      await waitFor(async () => expect((await db.jobs.toArray())[0]?.status).toBe('RUNNING'));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' }));
      expect(await screen.findByRole('button', { name: 'Email Extractor' })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Email Extractor' }));
        await vi.dynamicImportSettled();
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(await screen.findByRole('heading', { name: 'Email Extractor' })).toBeInTheDocument();

      const [job] = await db.jobs.toArray();
      const identity = {
        jobId: job.id,
        projectId: job.projectId as string,
        datasetId: job.datasetId as string,
        runId: job.runId as string,
        generation: job.generation as string,
      };
      await act(async () => {
        await chromeMock.sendFromContentScript(101, makeBatch(identity, 1, ['Completed While In Email']));
        await chromeMock.sendFromContentScript(101, {
          id: 'fin-h6-1',
          type: 'JOB_FINISHED',
          timestamp: Date.now(),
          payload: { identity, lastSequence: 1, stopReason: 'completed' },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      // Standalone tool remains visible until user closes it
      expect(screen.getByRole('heading', { name: 'Email Extractor' })).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Back to tools' }));
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(await screen.findByText('Extraction complete')).toBeInTheDocument();
      expect(screen.queryByText(/Done\.\s+\d+\s+row/i)).not.toBeInTheDocument();
      expect(
        within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name: 'Tools' })
      ).toHaveAttribute('aria-current', 'page');
    });
  });
});
