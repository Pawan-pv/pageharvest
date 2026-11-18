import React from 'react';
import { MousePointer } from 'lucide-react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import type { DetectedList, InspectedElement } from '@/hooks/useExtractionWorkflow';
import type { FieldPreviewResult, ListCandidate } from '@/shared/contracts/message';
import type { FieldDefinition } from '@/types';
import { PreviewTable } from './PreviewTable';

/**
 * The first step in simple mode (ADR-039): find the list and let the user recognise it.
 * These screens show what was found in the user's words: how many items, and the first
 * rows. Scores, evidence and selectors stay with Advanced options.
 */

export function itemCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'item' : 'items'}`;
}

export interface SimpleListCheckProps {
  detectedList: DetectedList;
  /** The columns found for this list. Empty until the page has answered. */
  columns: FieldDefinition[];
  onPreviewFields?: (columns: FieldDefinition[]) => Promise<FieldPreviewResult>;
  onConfirm: () => void;
  onChooseAnother: () => void;
  onCancel: () => void;
}

/** "We found 20 items on this page", with the first rows and one question: is this it? */
export const SimpleListCheck: React.FC<SimpleListCheckProps> = ({
  detectedList,
  columns,
  onPreviewFields,
  onConfirm,
  onChooseAnother,
  onCancel,
}) => (
  <div className="flex flex-col gap-3 p-4 text-left">
    <div>
      <h2 className="text-base font-semibold text-fg">We found {itemCount(detectedList.matchCount)} on this page</h2>
      <p className="text-body text-fg-muted mt-1">
        Here is how the first ones will look in your spreadsheet. Each item becomes one row.
      </p>
    </div>

    <PreviewTable columns={columns} samples={detectedList.sampleSnippets} onPreview={onPreviewFields} />

    <Button size="lg" className="w-full justify-center font-semibold" onClick={onConfirm}>
      Yes, this is my list
    </Button>

    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="outline" size="sm" onClick={onChooseAnother}>
        Not the right list?
      </Button>
    </div>
  </div>
);

export interface SimpleListChooserProps {
  detectedList: DetectedList;
  onUse: (candidate: ListCandidate) => void;
  onPickMyself: () => void;
  onCancel: () => void;
}

/** Every list the page has, for when the first guess was wrong or nothing looked like data. */
export const SimpleListChooser: React.FC<SimpleListChooserProps> = ({ detectedList, onUse, onPickMyself, onCancel }) => {
  const candidates = detectedList.candidates ?? [];
  const nothingClear = candidates.length > 0 && candidates.every((candidate) => !candidate.credible);

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      {candidates.length === 0 ? (
        <Banner
          tone="warning"
          title="We couldn't find a list on this page"
          nextStep="Click one item on the page yourself, and PageHarvest will look for the others like it."
        >
          The page may still be loading, or its items may not repeat in a way PageHarvest recognises.
        </Banner>
      ) : (
        <>
          <div>
            <h2 className="text-base font-semibold text-fg">Which list do you want?</h2>
            <p className="text-body text-fg-muted mt-1">
              {nothingClear
                ? 'Nothing on this page clearly looks like a list of items. Use one of these if it is what you want, or pick one item yourself.'
                : 'These are the lists on this page. Choose the one with your items.'}
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {candidates.map((candidate, index) => (
              <li key={candidate.containerSelector}>
                <Card className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-fg">{itemCount(candidate.matchCount)}</p>
                  {candidate.sampleSnippets.slice(0, 2).map((snippet, row) => (
                    <p key={row} className="text-body text-fg-muted break-words line-clamp-2">
                      {snippet || '(no words in this item)'}
                    </p>
                  ))}
                  {!candidate.credible && (
                    <p className="text-body text-warning-fg">This might be a menu, not your list.</p>
                  )}
                  <div>
                    <Button
                      variant={index === 0 && candidate.credible ? 'primary' : 'outline'}
                      size="sm"
                      aria-label={`Use this list, ${itemCount(candidate.matchCount)}`}
                      onClick={() => onUse(candidate)}
                    >
                      Use this list
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          iconLeft={<MousePointer aria-hidden="true" className="w-3.5 h-3.5" />}
          onClick={onPickMyself}
        >
          Pick one item myself
        </Button>
      </div>
    </div>
  );
};

export interface SimplePickingProps {
  inspectedElement: InspectedElement | null;
  onCancel: () => void;
}

/** Shown while the user clicks one item on the page. The page does the highlighting. */
export const SimplePicking: React.FC<SimplePickingProps> = ({ inspectedElement, onCancel }) => (
  <div className="flex flex-col gap-3 p-4 text-left">
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="w-8 h-8 rounded-control bg-brand text-on-strong flex items-center justify-center shrink-0"
        >
          <MousePointer className="w-4 h-4" />
        </span>
        <h2 className="text-base font-semibold text-fg">Click one item on the page</h2>
      </div>
      <p className="text-body text-fg-muted">
        Move the mouse over the page and click one whole item, such as one product or one row. PageHarvest finds
        the others like it.
      </p>
      {inspectedElement && (
        <p className="text-body text-fg" aria-live="polite">
          You clicked: “{inspectedElement.textSnippet || 'an item with no words'}”. Looking for the others…
        </p>
      )}
    </Card>
    <div>
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  </div>
);
