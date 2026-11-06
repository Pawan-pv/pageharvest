import React from 'react';
import { Clock, ArrowRight, FileSpreadsheet } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Dataset } from '@/types';

export interface RecentProjectsCardProps {
  datasets: Dataset[];
  isLoading?: boolean;
  onViewDataset: (dataset: Dataset) => void;
  onViewAllHistory: () => void;
}

export const RecentProjectsCard: React.FC<RecentProjectsCardProps> = ({
  datasets,
  isLoading = false,
  onViewDataset,
  onViewAllHistory,
}) => {
  const recentItems = datasets.slice(0, 3);

  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
          Recent Extractions
        </h4>
        {datasets.length > 0 && (
          <button
            onClick={onViewAllHistory}
            className="text-2xs font-medium text-brand-fg hover:text-brand-emphasis flex items-center gap-1 transition-colors"
          >
            <span>View all ({datasets.length})</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {isLoading ? (
        <Card variant="flat" className="p-3 text-center text-xs text-fg-subtle">
          Loading saved datasets...
        </Card>
      ) : recentItems.length === 0 ? (
        <Card variant="flat" className="p-4 text-center">
          <FileSpreadsheet className="w-6 h-6 text-fg-faint mx-auto mb-1.5" />
          <p className="text-xs font-medium text-fg-muted">No recent extractions</p>
          <p className="text-2xs text-fg-subtle mt-0.5">
            Start a new extraction above to save your first dataset.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-1.5">
          {recentItems.map((dataset) => (
            <Card
              key={dataset.id}
              variant="interactive"
              onClick={() => onViewDataset(dataset)}
              className="p-2.5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-fg truncate max-w-[190px]">
                    {dataset.name}
                  </span>
                  <Badge variant="neutral" size="sm">
                    {dataset.recordsCount} rows
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-2xs text-fg-subtle mt-0.5">
                  <Clock className="w-3 h-3" />
                  <span>{new Date(dataset.createdAt).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>{dataset.fields.length} columns</span>
                </div>
              </div>

              <div className="text-fg-subtle hover:text-brand-fg p-1">
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
