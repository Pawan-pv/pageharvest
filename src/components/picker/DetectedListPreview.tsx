import React, { useId, useState } from 'react';
import { Layers, MousePointer, ArrowRight } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Banner } from '@/components/common/Banner';
import { DetectedList } from '@/hooks/useExtractionWorkflow';

export interface DetectedListPreviewProps {
  detectedList: DetectedList;
  onConfirm: () => void;
  onPickAgain: () => void;
  onCancel: () => void;
}

const SAMPLE_ROWS = 3;

/**
 * What auto-detect, Table or Links found, for the user to accept or reject. Nothing is used
 * until they press "Use this list". This build's detection returns one list, with no score
 * and no columns yet, so the card shows only what is known: how many items, and samples.
 */
export const DetectedListPreview: React.FC<DetectedListPreviewProps> = ({
  detectedList,
  onConfirm,
  onPickAgain,
  onCancel,
}) => {
  const [showSelector, setShowSelector] = useState(false);
  const samplesLabelId = useId();
  const { matchCount, sampleSnippets, containerSelector } = detectedList;
  const found = matchCount > 0;
  const samples = sampleSnippets.slice(0, SAMPLE_ROWS);

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      <h2 className="text-sm font-semibold text-fg">Is this the data you want?</h2>

      {found ? (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-control bg-brand-soft text-brand-fg flex items-center justify-center shrink-0"
            >
              <Layers className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">
                {matchCount.toLocaleString('en-US')} similar {matchCount === 1 ? 'item' : 'items'} found
              </p>
              <p className="text-2xs text-fg-subtle">Each item becomes one row.</p>
            </div>
          </div>

          {samples.length > 0 && (
            <div>
              <p id={samplesLabelId} className="text-xs font-semibold text-fg-muted mb-1">
                Sample rows
              </p>
              <ol aria-labelledby={samplesLabelId} className="flex flex-col gap-1">
                {samples.map((snippet, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 p-2 rounded-control bg-surface-sunken border border-line text-xs text-fg-muted"
                  >
                    <span aria-hidden="true" className="text-2xs font-mono text-fg-subtle shrink-0 pt-px">
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate">{snippet || '(no text in this item)'}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="text-2xs text-fg-subtle">Columns are suggested on the next step, where you can change them.</p>

          <details open={showSelector} className="text-2xs text-fg-subtle">
            <summary
              className="cursor-pointer select-none hover:text-fg"
              onClick={(event) => {
                event.preventDefault();
                setShowSelector((open) => !open);
              }}
            >
              Technical details
            </summary>
            {showSelector && (
              <p className="mt-1 p-2 rounded-control bg-surface-muted font-mono text-fg-muted break-all select-all">
                {containerSelector}
              </p>
            )}
          </details>
        </Card>
      ) : (
        <Banner
          tone="warning"
          title="No repeated items were found on this page"
          nextStep="Pick one item on the page yourself, and PageHarvest will look for others like it."
        >
          The page may still be loading, or its items may not repeat in a way PageHarvest recognises.
        </Banner>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            iconLeft={<MousePointer aria-hidden="true" className="w-3.5 h-3.5" />}
            onClick={onPickAgain}
          >
            Pick on the page instead
          </Button>
          <Button
            size="sm"
            iconRight={<ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />}
            onClick={onConfirm}
            disabled={!found}
          >
            Use this list
          </Button>
        </div>
      </div>
    </div>
  );
};
