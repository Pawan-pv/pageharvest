import React from 'react';
import { Globe, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Badge } from '@/components/common/Badge';
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
  let hostname = 'Unknown page';
  try {
    if (tab.url) {
      hostname = new URL(tab.url).hostname;
    }
  } catch {
    hostname = tab.url || 'Web page';
  }

  return (
    <Card variant="default" className="text-left bg-gradient-to-b from-white to-slate-50/50">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 text-emerald-700 shadow-xs">
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
              <span className="text-xs font-semibold text-slate-900 tracking-tight truncate max-w-[200px]">
                {hostname}
              </span>
              {tab.isInjectable ? (
                <Badge variant="success" size="sm" icon={<CheckCircle2 className="w-2.5 h-2.5" />}>
                  Ready
                </Badge>
              ) : (
                <Badge variant="warning" size="sm" icon={<AlertCircle className="w-2.5 h-2.5" />}>
                  Restricted
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-slate-500 truncate max-w-[260px] mt-0.5" title={tab.title}>
              {tab.title || 'No title'}
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh active tab connection"
          aria-label="Refresh active tab connection"
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {!tab.isInjectable && (
        <div className="mt-3 p-2 rounded-lg bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-800 leading-snug">
          Chrome extensions cannot inspect browser internal pages. Please switch to any regular website (e.g. e-commerce, blog, or search results) to begin harvesting.
        </div>
      )}
    </Card>
  );
};
