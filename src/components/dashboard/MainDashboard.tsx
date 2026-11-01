import React from 'react';
import { WebsiteCard } from './WebsiteCard';
import { QuickActions } from './QuickActions';
import { ExtractionInsights } from './ExtractionInsights';
import { RecentProjectsCard } from './RecentProjectsCard';
import { TabInfo } from '@/services/messaging';
import { Dataset } from '@/types';

export interface MainDashboardProps {
  tab: TabInfo;
  isTabLoading?: boolean;
  onRefreshTab: () => void;
  datasets: Dataset[];
  isDatasetsLoading?: boolean;
  onSelectElements: () => void;
  onAutoDetectLists: () => void;
  onExtractTable: () => void;
  onExtractLinks: () => void;
  onViewDataset: (dataset: Dataset) => void;
  onViewAllHistory: () => void;
}

export const MainDashboard: React.FC<MainDashboardProps> = ({
  tab,
  isTabLoading = false,
  onRefreshTab,
  datasets,
  isDatasetsLoading = false,
  onSelectElements,
  onAutoDetectLists,
  onExtractTable,
  onExtractLinks,
  onViewDataset,
  onViewAllHistory,
}) => {
  return (
    <div className="flex flex-col gap-4 p-4 max-w-full">
      {/* 1. Website Status */}
      <WebsiteCard
        tab={tab}
        isLoading={isTabLoading}
        onRefresh={onRefreshTab}
      />

      {/* 2. Quick Actions */}
      <QuickActions
        disabled={!tab.isInjectable}
        onSelectElements={onSelectElements}
        onAutoDetectLists={onAutoDetectLists}
        onExtractTable={onExtractTable}
        onExtractLinks={onExtractLinks}
      />

      {/* 3. Extraction Insights */}
      <ExtractionInsights />

      {/* 4. Recent Projects */}
      <RecentProjectsCard
        datasets={datasets}
        isLoading={isDatasetsLoading}
        onViewDataset={onViewDataset}
        onViewAllHistory={onViewAllHistory}
      />
    </div>
  );
};
