import React from 'react';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/common/Button';

export interface ListOnAnotherTabProps {
  /** The tab the list was found on. */
  source: { title: string; url: string };
  onGoBack: () => void;
  onStartOver: () => void;
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url || 'another tab';
  }
}

/**
 * Shown instead of the list screens while another tab is in front. The list was read from
 * one page, so it can only be collected there: going back to that tab brings the screen
 * back as it was, and starting again forgets it.
 */
export const ListOnAnotherTab: React.FC<ListOnAnotherTabProps> = ({ source, onGoBack, onStartOver }) => (
  <div className="flex flex-col gap-3 p-4 text-left">
    <Banner
      tone="info"
      title="This list is on another tab"
      nextStep="Go back to that tab to carry on, or start again on this page."
      actions={
        <>
          <Button size="sm" onClick={onGoBack}>
            Go back to that tab
          </Button>
          <Button size="sm" variant="outline" onClick={onStartOver}>
            Start again on this page
          </Button>
        </>
      }
    >
      You found it on {source.title ? `“${source.title}” (${siteOf(source.url)})` : siteOf(source.url)}. PageHarvest
      collects a list only from the page it was found on.
    </Banner>
  </div>
);
