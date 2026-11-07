import React, { useId, useState } from 'react';
import { Layers, MousePointer, ArrowRight } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Banner } from '@/components/common/Banner';
import { Badge } from '@/components/common/Badge';
import { HelpTip } from '@/components/common/Tooltip';
import { DetectedList } from '@/hooks/useExtractionWorkflow';
import { ListCandidate } from '@/shared/contracts/message';

export interface DetectedListPreviewProps {
  detectedList: DetectedList;
  onSelectCandidate?: (candidate: ListCandidate) => void;
  onConfirm: () => void;
  onPickAgain: () => void;
  onCancel: () => void;
}

const SAMPLE_ROWS = 3;
const CARD_SAMPLES = 2;

/** Confidence in words first, number second. The score is a heuristic, not a probability (ADR-027). */
export function confidenceLabel(confidence: number): string {
  const percent = Math.round(confidence * 100);
  const level = confidence >= 0.75 ? 'High' : confidence >= 0.45 ? 'Medium' : 'Low';
  return `${level} · ${percent}% confidence`;
}

function itemsFound(count: number): string {
  return `${count.toLocaleString('en-US')} similar ${count === 1 ? 'item' : 'items'} found`;
}

function columnsLine(fields: string[]): string {
  return `${fields.length} ${fields.length === 1 ? 'column' : 'columns'}: ${fields.join(', ')}`;
}

/** Shown on demand: evidence and selectors are for checking, not for choosing. */
const TechnicalDetails: React.FC<{ evidence?: string[]; selector: string }> = ({ evidence, selector }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details open={isOpen} className="text-2xs text-fg-subtle">
      <summary
        className="cursor-pointer select-none hover:text-fg"
        onClick={(event) => {
          event.preventDefault();
          setIsOpen((open) => !open);
        }}
      >
        Technical details
      </summary>
      {isOpen && (
        <div className="mt-1 flex flex-col gap-1">
          {evidence && evidence.length > 0 && (
            <ul className="list-disc pl-4">
              {evidence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="p-2 rounded-control bg-surface-muted font-mono text-fg-muted break-all select-all">{selector}</p>
        </div>
      )}
    </details>
  );
};

const SampleRows: React.FC<{ samples: string[]; limit: number }> = ({ samples, limit }) => {
  const labelId = useId();
  const rows = samples.slice(0, limit);
  if (rows.length === 0) return null;
  return (
    <div>
      <p id={labelId} className="text-xs font-semibold text-fg-muted mb-1">
        Sample rows
      </p>
      <ol aria-labelledby={labelId} className="flex flex-col gap-1">
        {rows.map((snippet, index) => (
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
  );
};

/** One ranked candidate the user can choose. The radio and its text share one label. */
const CandidateCard: React.FC<{
  candidate: ListCandidate;
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ candidate, rank, isSelected, onSelect }) => (
  <div
    className={`flex flex-col gap-2 p-3 rounded-card border ${
      isSelected ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong'
    }`}
  >
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="radio"
        name="list-candidate"
        checked={isSelected}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 accent-brand shrink-0"
      />
      <span className="min-w-0 flex-1 flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-fg">
            {rank === 0 ? 'Best match: ' : ''}
            {candidate.name}
          </span>
          <Badge variant={candidate.credible ? 'brand' : 'warning'} size="sm">
            {confidenceLabel(candidate.confidence)}
          </Badge>
        </span>
        <span className="text-xs text-fg-muted">{itemsFound(candidate.matchCount)}</span>
        {candidate.suggestedFields.length > 0 && (
          <span className="text-2xs text-fg-subtle truncate">{columnsLine(candidate.suggestedFields)}</span>
        )}
        {!candidate.credible && (
          <span className="text-2xs text-warning-fg">This looks like a menu or page furniture, not data.</span>
        )}
        {candidate.sampleSnippets.slice(0, CARD_SAMPLES).map((snippet, index) => (
          <span key={index} className="text-2xs text-fg-muted truncate">
            {snippet || '(no text in this item)'}
          </span>
        ))}
      </span>
    </label>
    <TechnicalDetails evidence={candidate.evidence} selector={candidate.containerSelector} />
  </div>
);

/**
 * What auto-detect, Table or Links found, for the user to accept or reject. Candidates are
 * ranked on recorded evidence (ADR-027) and the best one is chosen first, but nothing is used
 * until the user presses "Use this list"; a list that does not look like data needs a second,
 * deliberate click.
 */
export const DetectedListPreview: React.FC<DetectedListPreviewProps> = ({
  detectedList,
  onSelectCandidate,
  onConfirm,
  onPickAgain,
  onCancel,
}) => {
  const [chosenAnyway, setChosenAnyway] = useState(false);
  const candidates = detectedList.candidates ?? [];
  const selected =
    candidates.find((candidate) => candidate.containerSelector === detectedList.containerSelector) ?? candidates[0];
  const nothingCredible = detectedList.credible === false;
  const needsConfirmation = selected !== undefined && !selected.credible && !chosenAnyway;
  const found = detectedList.matchCount > 0 || candidates.length > 0;

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold text-fg">Is this the data you want?</h2>
        {candidates.length > 0 && <HelpTip tipId="confidence" />}
      </div>

      {nothingCredible && (
        <Banner
          tone="warning"
          title="No data list was found on this page"
          nextStep="Pick one item on the page yourself, or use one of these if it really is what you want."
        >
          The repeated items below look like navigation or page furniture.
        </Banner>
      )}

      {candidates.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs text-fg-muted mb-1">
            PageHarvest found {candidates.length} lists on this page. The best match is first; choose the one you want.
          </legend>
          {candidates.map((candidate, rank) => (
            <CandidateCard
              key={candidate.containerSelector}
              candidate={candidate}
              rank={rank}
              isSelected={candidate.containerSelector === selected?.containerSelector}
              onSelect={() => {
                // Choosing a list from the alternatives is itself the deliberate choice (ADR-027).
                setChosenAnyway(true);
                onSelectCandidate?.(candidate);
              }}
            />
          ))}
        </fieldset>
      ) : found ? (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-control bg-brand-soft text-brand-fg flex items-center justify-center shrink-0"
            >
              <Layers className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{itemsFound(detectedList.matchCount)}</p>
              <p className="text-2xs text-fg-subtle">Each item becomes one row.</p>
            </div>
            {selected && (
              <Badge variant={selected.credible ? 'brand' : 'warning'} size="sm">
                {confidenceLabel(selected.confidence)}
              </Badge>
            )}
          </div>

          <SampleRows samples={detectedList.sampleSnippets} limit={SAMPLE_ROWS} />

          <p className="text-2xs text-fg-subtle">
            {selected && selected.suggestedFields.length > 0
              ? `${columnsLine(selected.suggestedFields)}. You can change them on the next step.`
              : 'Columns are suggested on the next step, where you can change them.'}
          </p>

          <TechnicalDetails evidence={selected?.evidence} selector={detectedList.containerSelector} />
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

      {needsConfirmation && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setChosenAnyway(true)}>
            Use this list anyway
          </Button>
        </div>
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
            disabled={!found || needsConfirmation}
          >
            Use this list
          </Button>
        </div>
      </div>
    </div>
  );
};
