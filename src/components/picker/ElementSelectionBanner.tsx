import React from 'react';
import { MousePointer, X, Check } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Badge } from '@/components/common/Badge';
import { InspectedElement } from '@/hooks/useExtractionWorkflow';

export interface ElementSelectionBannerProps {
  inspectedElement: InspectedElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ElementSelectionBanner: React.FC<ElementSelectionBannerProps> = ({
  inspectedElement,
  onConfirm,
  onCancel,
}) => {
  return (
    <div className="flex flex-col gap-3 p-4 text-left">
      <Card variant="default" className="border-brand-line bg-brand-soft/30 p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand text-on-strong flex items-center justify-center shrink-0 shadow-xs animate-pulse">
            <MousePointer className="w-4 h-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm font-semibold text-fg">
                Visual Element Picker Active
              </h3>
              <Badge variant="brand" size="sm">
                Interactive
              </Badge>
            </div>
            <p className="text-xs text-fg-muted mt-1 leading-relaxed">
              Hover over items in the webpage. Click any product card, listing, or table row to inspect its pattern.
            </p>
          </div>
        </div>

        {inspectedElement && (
          <div className="mt-3.5 p-3 rounded-lg bg-surface border border-brand-line shadow-xs">
            <div className="flex items-center justify-between text-xs text-fg-subtle mb-1">
              <span className="font-semibold text-fg-muted">Selected Item:</span>
              <span className="font-mono text-2xs bg-surface-muted px-1.5 py-0.5 rounded text-fg-muted">
                &lt;{inspectedElement.tagName.toLowerCase()}&gt;
              </span>
            </div>
            {inspectedElement.textSnippet ? (
              <p className="text-xs font-medium text-fg line-clamp-2">
                "{inspectedElement.textSnippet}"
              </p>
            ) : (
              <p className="text-xs text-fg-subtle italic">No text content in element</p>
            )}
          </div>
        )}
      </Card>

      <div className="flex items-center gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          iconLeft={<X className="w-3.5 h-3.5" />}
          onClick={onCancel}
        >
          Cancel Picker
        </Button>
        {inspectedElement && (
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Check className="w-3.5 h-3.5" />}
            onClick={onConfirm}
          >
            Confirm & Detect
          </Button>
        )}
      </div>
    </div>
  );
};
