import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ListSetupView,
  PickerFocusView,
  ListRunningView,
  ListCompleteView,
} from '@/components/list-extractor';
import type { DetectedList, ExtractionStats } from '@/hooks/useExtractionWorkflow';
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
      expect(screen.getByText(/✓ Found 20 items · 3 columns/)).toBeInTheDocument();
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
      expect(screen.getByText('Local ✓')).toBeInTheDocument();

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
      });

      // Done button
      const doneBtn = screen.getByRole('button', { name: 'Done' });
      fireEvent.click(doneBtn);
      expect(onDone).toHaveBeenCalledTimes(1);

      // Bookmark / Save as Recipe button
      const bookmarkBtn = screen.getByRole('button', { name: 'Save as Recipe' });
      fireEvent.click(bookmarkBtn);
      expect(onSaveRecipe).toHaveBeenCalledTimes(1);
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
  });
});
