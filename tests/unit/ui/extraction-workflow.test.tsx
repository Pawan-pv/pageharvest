import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ElementSelectionBanner } from '@/components/picker/ElementSelectionBanner';
import { DetectedListPreview } from '@/components/picker/DetectedListPreview';
import { ExtractionProgressView } from '@/components/dashboard/ExtractionProgressView';
import { InspectedElement, DetectedList, ExtractionStats } from '@/hooks/useExtractionWorkflow';

describe('UI: Extraction Workflow States & Navigation', () => {
  describe('ElementSelectionBanner', () => {
    const mockElement: InspectedElement = {
      selector: '.product-card > h2.title',
      tagName: 'H2',
      classList: ['title'],
      textSnippet: 'Sony WH-1000XM5 Wireless Headphones',
    };

    it('renders picker active state with instructions and cancel button', () => {
      const onCancel = vi.fn();
      render(
        <ElementSelectionBanner
          inspectedElement={null}
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Visual Element Picker Active')).toBeInTheDocument();
      expect(screen.getByText(/Hover over items in the webpage/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /cancel picker/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('renders element preview snippet when an element is clicked', () => {
      const onConfirm = vi.fn();
      render(
        <ElementSelectionBanner
          inspectedElement={mockElement}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText(/Sony WH-1000XM5 Wireless Headphones/)).toBeInTheDocument();
      expect(screen.getByText('<h2 >'.replace(' ', ''))).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /confirm & detect/i });
      fireEvent.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('DetectedListPreview', () => {
    const mockList: DetectedList = {
      containerSelector: 'div.grid > div.card-item',
      matchCount: 24,
      sampleSnippets: ['Card Item 1', 'Card Item 2', 'Card Item 3'],
    };

    it('renders item count badge and sample snippets', () => {
      render(
        <DetectedListPreview
          detectedList={mockList}
          onConfirm={vi.fn()}
          onPickAgain={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('24 items detected')).toBeInTheDocument();
      expect(screen.getByText('Card Item 1')).toBeInTheDocument();
      expect(screen.getByText('Card Item 2')).toBeInTheDocument();
    });

    it('hides technical selector by default and expands on click (UX rule: avoid displaying technical DOM details to ordinary users)', () => {
      render(
        <DetectedListPreview
          detectedList={mockList}
          onConfirm={vi.fn()}
          onPickAgain={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.queryByText('div.grid > div.card-item')).not.toBeInTheDocument();

      const toggleBtn = screen.getByText(/view advanced CSS selector/i);
      fireEvent.click(toggleBtn);

      expect(screen.getByText('div.grid > div.card-item')).toBeInTheDocument();
    });

    it('handles navigation buttons (Pick Again, Next, Cancel)', () => {
      const onConfirm = vi.fn();
      const onPickAgain = vi.fn();
      const onCancel = vi.fn();

      render(
        <DetectedListPreview
          detectedList={mockList}
          onConfirm={onConfirm}
          onPickAgain={onPickAgain}
          onCancel={onCancel}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /pick again/i }));
      expect(onPickAgain).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /next: choose fields/i }));
      expect(onConfirm).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('ExtractionProgressView', () => {
    const runningStats: ExtractionStats = {
      progressKind: 'pages',
      currentStep: 3,
      targetSteps: 10,
      totalExtracted: 72,
      duplicatesSkipped: 4,
      recordsDetected: 76,
      recordsWithMissingFields: 2,
      recordsFiltered: 1,
      recordsFailed: 0,
      elapsedSeconds: 15,
      status: 'RUNNING',
    };

    it('renders real-time metrics during extraction', () => {
      render(
        <ExtractionProgressView
          stats={runningStats}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Harvesting in Progress...')).toBeInTheDocument();
      expect(screen.getByText('72')).toBeInTheDocument();
      expect(screen.getByText('Page 3 of 10')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('00:15')).toBeInTheDocument();
    });

    it('counts scrolling in scrolls, never as an impossible page number', () => {
      render(
        <ExtractionProgressView
          stats={{ ...runningStats, progressKind: 'scrolls', currentStep: 2, targetSteps: 20 }}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Scroll 2 of 20')).toBeInTheDocument();
      expect(screen.queryByText(/Page \d+ of/)).not.toBeInTheDocument();
    });

    it('shows no page denominator for a single-page job', () => {
      render(
        <ExtractionProgressView
          stats={{ ...runningStats, progressKind: 'single', currentStep: 1, targetSteps: 1 }}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Current page')).toBeInTheDocument();
      expect(screen.queryByText(/Page \d+ of/)).not.toBeInTheDocument();
    });

    it('accounts for every detected item, so none disappears silently', () => {
      render(
        <ExtractionProgressView
          stats={runningStats}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Items detected').nextSibling).toHaveTextContent('76');
      expect(screen.getByText('Missing some fields').nextSibling).toHaveTextContent('2');
      expect(screen.getByText('Filtered out').nextSibling).toHaveTextContent('1');
      expect(screen.getByText('Failed').nextSibling).toHaveTextContent('0');
    });

    it('warns once a dataset passes the configured size', () => {
      render(
        <ExtractionProgressView
          stats={runningStats}
          recordWarningThreshold={50}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Large dataset')).toBeInTheDocument();
    });

    it('handles Pause and Resume actions', () => {
      const onPause = vi.fn();
      const onResume = vi.fn();

      const { rerender } = render(
        <ExtractionProgressView
          stats={runningStats}
          onPause={onPause}
          onResume={onResume}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /pause/i }));
      expect(onPause).toHaveBeenCalledTimes(1);

      // When paused
      rerender(
        <ExtractionProgressView
          stats={{ ...runningStats, status: 'PAUSED' }}
          onPause={onPause}
          onResume={onResume}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Extraction Paused')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /resume/i }));
      expect(onResume).toHaveBeenCalledTimes(1);
    });

    it('displays error message when status is ERROR', () => {
      const errorStats: ExtractionStats = {
        ...runningStats,
        status: 'FAILED',
        errorMessage: 'Network timeout loading page 4',
      };

      render(
        <ExtractionProgressView
          stats={errorStats}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Extraction Interrupted')).toBeInTheDocument();
      expect(screen.getByText(/Network timeout loading page 4/)).toBeInTheDocument();
    });
  });
});
