import React, { useState } from 'react';
import { Layers, RotateCcw, Code, ArrowRight } from 'lucide-react';
import { Card, CardHeader } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { DetectedList } from '@/hooks/useExtractionWorkflow';
import { ListCandidate } from '@/shared/contracts/message';

export interface DetectedListPreviewProps {
  detectedList: DetectedList;
  onSelectCandidate?: (candidate: ListCandidate) => void;
  onConfirm: () => void;
  onPickAgain: () => void;
  onCancel: () => void;
}

const SAMPLES_PER_CANDIDATE = 2;

const CandidateOption: React.FC<{
  candidate: ListCandidate;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ candidate, isSelected, onSelect }) => (
  <label
    className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
      isSelected ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200 bg-white hover:border-slate-300'
    }`}
  >
    <input
      type="radio"
      name="list-candidate"
      checked={isSelected}
      onChange={onSelect}
      className="mt-0.5 text-emerald-600 focus:ring-emerald-500"
    />
    <span className="min-w-0 flex-1 flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-900">{candidate.name}</span>
        <span className="flex items-center gap-1">
          <Badge variant="neutral" size="sm">
            {candidate.matchCount} items
          </Badge>
          <Badge variant={candidate.credible ? 'brand' : 'warning'} size="sm">
            {Math.round(candidate.confidence * 100)}% confidence
          </Badge>
        </span>
      </span>
      {candidate.sampleSnippets.slice(0, SAMPLES_PER_CANDIDATE).map((snippet, index) => (
        <span key={index} className="text-[11px] text-slate-600 truncate">
          {snippet || '(no text)'}
        </span>
      ))}
      {candidate.suggestedFields.length > 0 && (
        <span className="text-[11px] text-slate-500 truncate">
          Columns: {candidate.suggestedFields.join(', ')}
        </span>
      )}
      <span className="text-[10px] text-slate-400">{candidate.evidence.join(' · ')}</span>
    </span>
  </label>
);

export const DetectedListPreview: React.FC<DetectedListPreviewProps> = ({
  detectedList,
  onSelectCandidate,
  onConfirm,
  onPickAgain,
  onCancel,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [chosenAnyway, setChosenAnyway] = useState(false);

  const candidates = detectedList.candidates ?? [];
  const selected =
    candidates.find((candidate) => candidate.containerSelector === detectedList.containerSelector) ??
    candidates[0];
  const nothingCredible = detectedList.credible === false;
  const needsConfirmation = selected !== undefined && !selected.credible && !chosenAnyway;

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      {nothingCredible && (
        <div role="alert" className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
          <p className="font-semibold">No data list was found on this page.</p>
          <p className="mt-0.5">
            The repeated items below look like navigation or page furniture. Pick an element on the page to
            choose exactly what you want, or use one of these if it really is what you are after.
          </p>
        </div>
      )}

      <Card variant="default">
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-600" />
              <span>Repeating Elements Found</span>
            </div>
          }
          action={
            <Badge variant="brand" size="md">
              {detectedList.matchCount} items detected
            </Badge>
          }
          subtitle="PageHarvest detected a pattern of repeating structured records."
        />

        {/* Human-readable preview */}
        <div className="flex flex-col gap-2 mt-2">
          <span className="text-xs font-semibold text-slate-700">
            Sample Preview ({Math.min(detectedList.sampleSnippets.length, 3)} of {detectedList.matchCount}):
          </span>

          <div className="space-y-1.5">
            {detectedList.sampleSnippets.slice(0, 3).map((snippet, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-700 flex items-start gap-2"
              >
                <span className="text-[10px] font-mono bg-white border border-slate-200 text-slate-500 rounded px-1.5 py-0.5 shrink-0">
                  #{idx + 1}
                </span>
                <span className="truncate leading-relaxed">
                  {snippet || '(Empty text container)'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Advanced selector toggle (satisfies UX requirement: Avoid displaying technical DOM details to ordinary users, but allow power users to inspect) */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            <span>{showAdvanced ? 'Hide technical selector' : 'View advanced CSS selector'}</span>
          </button>

          {showAdvanced && (
            <div className="mt-2 p-2 rounded bg-slate-100 font-mono text-[11px] text-slate-700 break-all select-all">
              {detectedList.containerSelector}
            </div>
          )}
        </div>
      </Card>

      {/* The best guess can be wrong, so the alternatives are always shown. */}
      {candidates.length > 1 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-semibold text-slate-700 mb-1">
            Other lists on this page. Choose the one you want:
          </legend>
          {candidates.map((candidate) => (
            <CandidateOption
              key={candidate.containerSelector}
              candidate={candidate}
              isSelected={candidate.containerSelector === selected?.containerSelector}
              onSelect={() => {
                setChosenAnyway(true);
                onSelectCandidate?.(candidate);
              }}
            />
          ))}
        </fieldset>
      )}

      {needsConfirmation && (
        <Button variant="outline" size="sm" onClick={() => setChosenAnyway(true)}>
          Use this list anyway
        </Button>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          Cancel
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            iconLeft={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={onPickAgain}
          >
            Pick Again
          </Button>

          <Button
            variant="primary"
            size="sm"
            iconRight={<ArrowRight className="w-3.5 h-3.5" />}
            onClick={onConfirm}
            disabled={needsConfirmation}
          >
            Next: Choose Fields
          </Button>
        </div>
      </div>
    </div>
  );
};
