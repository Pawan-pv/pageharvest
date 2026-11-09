import React from 'react';
import { Globe, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
import { Banner } from '@/components/common/Banner';
import { TabInfo } from '@/services/messaging';

export interface WebsiteCardProps {
  tab: TabInfo;
  isLoading?: boolean;
  onRefresh: () => void;
}

export const WebsiteCard: React.FC<WebsiteCardProps> = ({
  tab,
  isLoading = false,
  onRefresh,
}) => {
  let hostname = tab.needsAccess ? 'Page not shared yet' : 'Unknown page';
  try {
    if (tab.url) {
      hostname = new URL(tab.url).hostname;
    }
  } catch {
    hostname = tab.url || 'Web page';
  }

  return (
    <Card variant="default" className="text-left bg-gradient-to-b from-surface to-surface-sunken/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-brand-soft border border-brand-line flex items-center justify-center shrink-0 text-brand-fg shadow-xs">
            {tab.favIconUrl ? (
              <img
                src={tab.favIconUrl}
                alt=""
                className="w-5 h-5 object-contain rounded-xs"
                onError={(e) => {
                  // Fallback to Globe icon if image fails to load
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Globe className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-fg tracking-tight truncate max-w-[200px]">
                {hostname}
              </span>
              {tab.isInjectable ? (
                <Badge variant="success" size="sm" icon={<CheckCircle2 className="w-2.5 h-2.5" />}>
                  Ready
                </Badge>
              ) : tab.needsAccess ? (
                <Badge variant="warning" size="sm" icon={<AlertCircle className="w-2.5 h-2.5" />}>
                  Access needed
                </Badge>
              ) : (
                <Badge variant="warning" size="sm" icon={<AlertCircle className="w-2.5 h-2.5" />}>
                  Restricted
                </Badge>
              )}
            </div>
            <p className="text-2xs text-fg-subtle truncate max-w-[260px] mt-0.5" title={tab.title}>
              {tab.title || 'No title'}
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh active tab connection"
          aria-label="Refresh active tab connection"
          className="p-1.5 text-fg-subtle hover:text-fg-muted hover:bg-surface-muted rounded-lg transition-colors shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!tab.isInjectable && tab.needsAccess && (
        <Banner
          tone="warning"
          className="mt-3"
          nextStep="Click the PageHarvest button in the Chrome toolbar while this page is open. The panel updates by itself."
        >
          PageHarvest cannot see this page yet. It reads a site only after you open PageHarvest on it. Browser pages, such
          as settings or the new tab page, cannot be read at all.
        </Banner>
      )}

      {!tab.isInjectable && !tab.needsAccess && (
        <Banner
          tone="warning"
          className="mt-3"
          nextStep="Switch to a normal website tab, such as a shop or a list of articles, then press Refresh."
        >
          PageHarvest cannot read browser pages like this one, such as settings or the new tab page.
        </Banner>
      )}
    </Card>
  );
};
