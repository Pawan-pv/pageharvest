import React, { useState } from 'react';
import { Layers, RotateCcw, Code, ArrowRight } from 'lucide-react';
import { Card, CardHeader } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { DetectedList } from '@/hooks/useExtractionWorkflow';

export interface DetectedListPreviewProps {
  detectedList: DetectedList;
  onConfirm: () => void;
  onPickAgain: () => void;
  onCancel: () => void;
}

export const DetectedListPreview: React.FC<DetectedListPreviewProps> = ({
  detectedList,
  onConfirm,
  onPickAgain,
  onCancel,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-4 text-left">
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
          >
            Next: Choose Fields
          </Button>
        </div>
      </div>
    </div>
  );
};
