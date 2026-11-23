import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { ToolHub } from './ToolHub';
import { Dataset } from '@/types';

export interface MainDashboardProps {
  datasets: Dataset[];
  /** The active page cannot be read, so every tool that needs it is switched off. */
  disabled?: boolean;
  onOpenListExtractor?: () => void;
  onAutoDetectLists: () => void;
  onExtractTable: () => void;
  onExtractLinks: () => void;
  onOpenPageExtractor?: () => void;
  onOpenSitemapExplorer?: () => void;
  onOpenShopifyExtractor?: () => void;
  onOpenEmailExtractor?: () => void;
  onOpenSocialExtractor?: () => void;
  onOpenPageTextExtractor?: () => void;
  onOpenImageDownloader?: () => void;
  onViewAllHistory: () => void;
}

/**
 * The home screen. The active page and the command dock live in the panel shell, so this
 * view is the tool hub itself: all 10 live extractors across in-page, multi-URL, and asset tools.
 */
export const MainDashboard: React.FC<MainDashboardProps> = ({
  datasets,
  disabled = false,
  onOpenListExtractor,
  onAutoDetectLists,
  onExtractTable,
  onExtractLinks,
  onOpenPageExtractor,
  onOpenSitemapExplorer,
  onOpenShopifyExtractor,
  onOpenEmailExtractor,
  onOpenSocialExtractor,
  onOpenPageTextExtractor,
  onOpenImageDownloader,
  onViewAllHistory,
}) => {
  return (
    <div className="flex max-w-full flex-col gap-4 py-3">
      <ToolHub
        datasetsCount={datasets.length}
        disabled={disabled}
        onOpenListExtractor={onOpenListExtractor}
        onAutoDetectLists={onAutoDetectLists}
        onExtractTable={onExtractTable}
        onExtractLinks={onExtractLinks}
        onOpenPageExtractor={onOpenPageExtractor}
        onOpenSitemapExplorer={onOpenSitemapExplorer}
        onOpenShopifyExtractor={onOpenShopifyExtractor}
        onOpenEmailExtractor={onOpenEmailExtractor}
        onOpenSocialExtractor={onOpenSocialExtractor}
        onOpenPageTextExtractor={onOpenPageTextExtractor}
        onOpenImageDownloader={onOpenImageDownloader}
        onViewAllHistory={onViewAllHistory}
      />

      <p className="flex items-center gap-1.5 text-2xs text-fg-subtle">
        <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
        PageHarvest reads only the page you ask it to: its text, links, image addresses and page address. Everything it
        collects stays on this computer, and nothing is sent anywhere.
      </p>
    </div>
  );
};
