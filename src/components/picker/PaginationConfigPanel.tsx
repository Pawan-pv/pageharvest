import React from 'react';
import { ArrowRightCircle, Link2, MoveDown, Compass, Sliders } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Input } from '@/components/common/Input';
import { HelpTip } from '@/components/common/Tooltip';
import { previewTemplateUrls, validateUrlTemplate } from '@/core/navigation/url-paginator';
import { ExtractionPaginationConfig, PaginationType } from '@/types';

export interface PaginationConfigPanelProps {
  config: ExtractionPaginationConfig;
  /** The page the job will start from. URL templates must stay on its website. */
  sourceUrl?: string;
  onChange: (updated: Partial<ExtractionPaginationConfig>) => void;
}

export const PaginationConfigPanel: React.FC<PaginationConfigPanelProps> = ({
  config,
  sourceUrl,
  onChange,
}) => {
  const modes: { type: PaginationType; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      type: 'none',
      label: 'Single Page',
      icon: <Compass className="w-3.5 h-3.5" />,
      desc: 'Extract only visible items on the current page',
    },
    {
      type: 'next_button',
      label: 'Next Button',
      icon: <ArrowRightCircle className="w-3.5 h-3.5" />,
      desc: 'Click "Next" button across multiple pages',
    },
    {
      type: 'infinite_scroll',
      label: 'Infinite Scroll',
      icon: <MoveDown className="w-3.5 h-3.5" />,
      desc: 'Scroll down to load lazy/infinite content',
    },
    {
      type: 'url_template',
      label: 'URL Template',
      icon: <Link2 className="w-3.5 h-3.5" />,
      desc: 'Visit numbered page URLs such as ?page=2',
    },
  ];

  const sequence = {
    template: config.urlTemplate ?? '',
    startPage: config.startPage ?? 1,
    pageIncrement: config.pageIncrement ?? 1,
  };
  const templateCheck = validateUrlTemplate(sequence, sourceUrl);

  return (
    <Card variant="flat" className="text-left bg-surface-sunken/70 p-3.5 border-line/80">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Sliders className="w-3.5 h-3.5 text-fg-muted" />
        <h4 className="text-xs font-semibold text-fg">
          Navigation & Pagination Strategy
        </h4>
        <HelpTip tipId="pagination-modes" />
      </div>

      {/* Mode selection buttons */}
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {modes.map((mode) => (
          <button
            key={mode.type}
            type="button"
            onClick={() => onChange({ type: mode.type })}
            className={`flex flex-col items-start p-2 rounded-lg border text-left transition-all ${
              config.type === mode.type
                ? 'bg-surface border-brand text-brand-emphasis shadow-xs ring-1 ring-focus'
                : 'bg-surface/70 border-line text-fg-muted hover:bg-surface hover:border-line-strong'
            }`}
          >
            <div className="flex items-center gap-1 mb-1">
              <span className={config.type === mode.type ? 'text-brand-fg' : 'text-fg-subtle'}>
                {mode.icon}
              </span>
              <span className="text-xs font-semibold">{mode.label}</span>
            </div>
            <span className="text-2xs text-fg-subtle leading-tight">
              {mode.desc}
            </span>
          </button>
        ))}
      </div>

      {/* Mode specific parameters */}
      {config.type === 'next_button' && (
        <div className="flex flex-col gap-2.5 pt-2 border-t border-line/60">
          <Input
            label="Next Button Selector"
            placeholder="e.g. a.next, [rel='next'], button.load-more"
            value={config.nextButtonSelector || ''}
            onChange={(e) => onChange({ nextButtonSelector: e.target.value })}
            helperText="CSS selector for the button. Leave empty to find it automatically."
          />

          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              label="Max Pages to Crawl"
              min={1}
              max={500}
              value={config.maxPages ?? 20}
              onChange={(e) => onChange({ maxPages: parseInt(e.target.value, 10) || 1 })}
            />
            <Input
              type="number"
              label="Delay Between Pages (ms)"
              min={200}
              max={30000}
              step={250}
              value={config.delayMs ?? 1500}
              onChange={(e) => onChange({ delayMs: parseInt(e.target.value, 10) || 1500 })}
            />
          </div>
        </div>
      )}

      {config.type === 'infinite_scroll' && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line/60">
          <Input
            type="number"
            label="Max Scrolls"
            min={1}
            max={200}
            value={config.scrollCount ?? 30}
            onChange={(e) => onChange({ scrollCount: parseInt(e.target.value, 10) || 1 })}
          />
          <Input
            type="number"
            label="Scroll Delay (ms)"
            min={300}
            max={10000}
            step={250}
            value={config.scrollDelayMs ?? 1500}
            onChange={(e) => onChange({ scrollDelayMs: parseInt(e.target.value, 10) || 1500 })}
          />
        </div>
      )}

      {config.type === 'url_template' && (
        <div className="flex flex-col gap-2.5 pt-2 border-t border-line/60">
          <Input
            label="Page URL Template"
            placeholder="https://example.com/items?page={page}"
            value={config.urlTemplate || ''}
            onChange={(e) => onChange({ urlTemplate: e.target.value })}
            helperText="{page} becomes the page number. {offset} starts at 0, for sites that count items."
          />

          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              label="Starting Page"
              min={1}
              value={config.startPage ?? 1}
              onChange={(e) => onChange({ startPage: parseInt(e.target.value, 10) || 1 })}
            />
            <Input
              type="number"
              label="Page Increment"
              min={1}
              value={config.pageIncrement ?? 1}
              onChange={(e) => onChange({ pageIncrement: parseInt(e.target.value, 10) || 1 })}
            />
            <Input
              type="number"
              label="Maximum Pages"
              min={1}
              max={500}
              value={config.maxPages ?? 20}
              onChange={(e) => onChange({ maxPages: parseInt(e.target.value, 10) || 1 })}
            />
            <Input
              type="number"
              label="Delay Between Pages (ms)"
              min={200}
              max={30000}
              step={250}
              value={config.delayMs ?? 1500}
              onChange={(e) => onChange({ delayMs: parseInt(e.target.value, 10) || 1500 })}
            />
          </div>

          {templateCheck.valid ? (
            <div className="rounded-lg bg-surface border border-line p-2">
              <p className="text-2xs font-semibold text-fg-muted mb-1">Pages it will visit</p>
              <ol className="text-2xs font-mono text-fg-muted flex flex-col gap-0.5" aria-label="Generated page URLs">
                {previewTemplateUrls(sequence, 3).map((url) => (
                  <li key={url} className="truncate" title={url}>{url}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p role="alert" className="text-2xs text-danger-fg">{templateCheck.error}</p>
          )}
        </div>
      )}
    </Card>
  );
};
