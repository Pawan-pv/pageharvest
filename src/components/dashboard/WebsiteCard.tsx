import React from 'react';
import { Globe, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { Banner } from '@/components/common/Banner';
import { TabInfo } from '@/services/messaging';

export interface WebsiteCardProps {
  tab: TabInfo;
  isLoading?: boolean;
  /** Advanced options is on: the manual "check again" button is shown (ADR-039). */
  advanced?: boolean;
  onRefresh: () => void;
}

/**
 * Which page PageHarvest is looking at, and whether it can read it. This is the compact
 * strip under the command dock, not a card: it must never clip behind the panel header.
 * The site's own icon is not shown: loading it would be a network request from the panel,
 * and the panel makes none.
 */
export const WebsiteCard: React.FC<WebsiteCardProps> = ({
  tab,
  isLoading = false,
  advanced = false,
  onRefresh,
}) => {
  let hostname = tab.needsAccess ? 'Page not shared yet' : 'This page';
  try {
    if (tab.url) {
      hostname = new URL(tab.url).hostname || tab.url;
    }
  } catch {
    hostname = tab.url || 'Web page';
  }

  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2 ph-card-elevated">
        <div
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
            tab.isInjectable
              ? 'border-brand-line bg-brand-soft text-brand-fg'
              : 'border-warning-line bg-warning-soft text-warning-fg'
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold tracking-[-0.01em] text-fg" title={hostname}>
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
                Can&apos;t read this page
              </Badge>
            )}
          </div>
          {tab.url && (
            <p className="truncate text-2xs text-fg-subtle" title={tab.title}>
              {tab.title || 'No title'}
            </p>
          )}
        </div>

        {/* The panel follows the tab by itself; the button is for people who want to be sure. */}
        {advanced && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            title="Check this page again"
            aria-label="Check this page again"
            className="shrink-0 rounded-lg border border-transparent p-1.5 text-fg-subtle transition-colors hover:border-line hover:bg-surface-muted hover:text-fg disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {!tab.isInjectable && tab.needsAccess && (
        <Banner
          tone="warning"
          nextStep="Click the PageHarvest button in the Chrome toolbar while this page is open. The panel updates by itself."
        >
          PageHarvest cannot see this page yet. Its access to websites has been limited in Chrome&apos;s settings, so it
          reads a site only after you click its button there.
        </Banner>
      )}

      {!tab.isInjectable && !tab.needsAccess && (
        <Banner
          tone="warning"
          nextStep="Switch to a tab with a website, such as a shop or a list of articles. This panel follows the tab you are on."
        >
          PageHarvest cannot read browser pages like this one, such as settings, the new tab page or the Chrome Web
          Store.
        </Banner>
      )}
    </div>
  );
};
