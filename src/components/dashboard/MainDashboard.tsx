import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { WebsiteCard } from './WebsiteCard';
import { QuickActions } from './QuickActions';
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

      {/* 3. Recent Projects */}
      <RecentProjectsCard
        datasets={datasets}
        isLoading={isDatasetsLoading}
        onViewDataset={onViewDataset}
        onViewAllHistory={onViewAllHistory}
      />

      <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
        <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
        Everything PageHarvest collects stays on this computer. Nothing is sent anywhere.
      </p>
    </div>
  );
};
