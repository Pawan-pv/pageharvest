import React from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import type { FlowKind } from './flow';

const LOOKING_FOR: Partial<Record<FlowKind, string>> = {
  auto: 'repeated items',
  table: 'tables',
  links: 'links',
};

export interface ScanningStateProps {
  kind: FlowKind;
  onCancel: () => void;
}

/** Shown while detection runs for flows that do not use the picker. */
export const ScanningState: React.FC<ScanningStateProps> = ({ kind, onCancel }) => (
  <div className="p-4">
    <Card className="flex flex-col items-start gap-2 text-left" aria-busy="true">
      <div className="flex items-center gap-2">
        <Loader2 aria-hidden="true" className="w-4 h-4 text-brand-fg animate-spin" />
        <h2 className="text-sm font-semibold text-fg">
          Looking for {LOOKING_FOR[kind] ?? 'data'} on this page…
        </h2>
      </div>
      <p className="text-xs text-fg-muted">
        This usually takes a moment. Nothing is collected until you choose what to keep.
      </p>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </Card>
  </div>
);
