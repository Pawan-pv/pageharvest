import React, { useId } from 'react';
import { Input } from '@/components/common/Input';
import { Disclosure } from '@/components/common/Disclosure';
import { HelpTip } from '@/components/common/Tooltip';
import type { HelpTipId } from '@/components/guide/tips';
import { previewTemplateUrls, validateUrlTemplate } from '@/core/navigation/url-paginator';
import { ExtractionPaginationConfig, PaginationType } from '@/types';
import { PAGINATION_DEFAULTS, describeLimits } from './pagination-copy';

export interface PaginationConfigPanelProps {
  config: ExtractionPaginationConfig;
  /** The page the job will start from. URL templates must stay on its website. */
  sourceUrl?: string;
  onChange: (updated: Partial<ExtractionPaginationConfig>) => void;
}

const MODES: { type: PaginationType; label: string; description: string; tip?: HelpTipId }[] = [
  { type: 'none', label: 'Just this page', description: 'Collect only the items you can see now.' },
  {
    type: 'next_button',
    label: 'Click a Next button',
    description: 'For sites with Next or page-number buttons.',
    tip: 'pagination-next-button',
  },
  {
    type: 'infinite_scroll',
    label: 'Scroll to load more',
    description: 'For pages that add items as you scroll down.',
    tip: 'pagination-scroll',
  },
  {
    type: 'url_template',
    label: 'Page numbers in the URL',
    description: 'For addresses that change with the page, such as ?page=2.',
    tip: 'pagination-url',
  },
];

/** Parses a whole-number field; an empty or invalid entry gives undefined. */
function wholeNumber(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Seconds on screen, milliseconds in the contract, kept within the contract's range. */
function secondsToMs(value: string, min: number, max: number): number | undefined {
  const seconds = Number.parseFloat(value);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(max, Math.max(min, Math.round(seconds * 1000)));
}

const ModeOption: React.FC<{
  mode: (typeof MODES)[number];
  checked: boolean;
  onSelect: () => void;
}> = ({ mode, checked, onSelect }) => {
  const inputId = useId();
  const descriptionId = useId();
  return (
    <div
      className={`flex items-start gap-2 p-2.5 rounded-control border ${
        checked ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      <input
        id={inputId}
        type="radio"
        name="pagination-mode"
        checked={checked}
        onChange={onSelect}
        aria-describedby={descriptionId}
        className="mt-0.5 h-4 w-4 accent-brand"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block text-xs font-semibold text-fg cursor-pointer">
          {mode.label}
        </label>
        <span id={descriptionId} className="block text-2xs text-fg-muted">
          {mode.description}
        </span>
      </div>
      {mode.tip && <HelpTip tipId={mode.tip} />}
    </div>
  );
};

export const PaginationConfigPanel: React.FC<PaginationConfigPanelProps> = ({ config, sourceUrl, onChange }) => {
  const legendId = useId();
  const sequence = {
    template: config.urlTemplate ?? '',
    startPage: config.startPage ?? PAGINATION_DEFAULTS.startPage,
    pageIncrement: config.pageIncrement ?? PAGINATION_DEFAULTS.pageIncrement,
  };
  const templateCheck = validateUrlTemplate(sequence, sourceUrl);
  const isPaged = config.type === 'next_button' || config.type === 'url_template';

  const rowLimitInput = (
    <Input
      type="number"
      label="Stop after this many rows"
      min={1}
      placeholder="No limit"
      value={config.maxRecords ?? ''}
      onChange={(e) => onChange({ maxRecords: wholeNumber(e.target.value) })}
    />
  );

  return (
    <div className="flex flex-col gap-3 text-left">
      <fieldset aria-labelledby={legendId} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1 mb-0.5">
          <span id={legendId} className="text-sm font-semibold text-fg">
            How does this site show more items?
          </span>
          <HelpTip tipId="pagination-modes" />
        </div>
        {MODES.map((mode) => (
          <ModeOption
            key={mode.type}
            mode={mode}
            checked={config.type === mode.type}
            onSelect={() => onChange({ type: mode.type })}
          />
        ))}
      </fieldset>

      {config.type === 'url_template' && (
        <div className="flex flex-col gap-2">
          <Input
            label="Page address"
            placeholder="https://example.com/items?page={page}"
            value={config.urlTemplate || ''}
            onChange={(e) => onChange({ urlTemplate: e.target.value })}
            helperText="Write {page} where the page number goes. {offset} starts at 0, for sites that count items."
          />
          {templateCheck.valid ? (
            <div className="rounded-control bg-surface-sunken border border-line p-2">
              <p className="text-2xs font-semibold text-fg-muted mb-1">Pages it will visit</p>
              <ol className="text-2xs font-mono text-fg-muted flex flex-col gap-0.5" aria-label="Generated page URLs">
                {previewTemplateUrls(sequence, 3).map((url) => (
                  <li key={url} className="truncate" title={url}>
                    {url}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p role="alert" className="text-2xs text-danger-fg">
              {templateCheck.error}
            </p>
          )}
        </div>
      )}

      <p className="text-2xs text-fg-subtle">{describeLimits(config)}</p>

      <Disclosure label="Advanced" aside={<HelpTip tipId="pagination-limits" />}>
        <div className="grid grid-cols-2 gap-2">
          {config.type === 'next_button' && (
            <div className="col-span-2">
              <Input
                label="Next button selector (optional)"
                placeholder="e.g. a.next"
                value={config.nextButtonSelector || ''}
                onChange={(e) => onChange({ nextButtonSelector: e.target.value })}
                helperText="Leave empty and PageHarvest looks for the button itself."
              />
            </div>
          )}
          {config.type === 'url_template' && (
            <>
              <Input
                type="number"
                label="First page number"
                min={1}
                value={sequence.startPage}
                onChange={(e) => {
                  const value = wholeNumber(e.target.value);
                  if (value !== undefined) onChange({ startPage: value });
                }}
              />
              <Input
                type="number"
                label="Count up by"
                min={1}
                value={sequence.pageIncrement}
                onChange={(e) => {
                  const value = wholeNumber(e.target.value);
                  if (value !== undefined) onChange({ pageIncrement: value });
                }}
              />
            </>
          )}
          {isPaged && (
            <>
              <Input
                type="number"
                label="Most pages"
                min={1}
                max={500}
                value={config.maxPages ?? PAGINATION_DEFAULTS.maxPages}
                onChange={(e) => {
                  const value = wholeNumber(e.target.value);
                  if (value !== undefined) onChange({ maxPages: Math.min(500, Math.max(1, value)) });
                }}
              />
              <Input
                type="number"
                label="Wait between pages (seconds)"
                min={0.2}
                max={30}
                step={0.5}
                value={(config.delayMs ?? PAGINATION_DEFAULTS.delayMs) / 1000}
                onChange={(e) => {
                  const value = secondsToMs(e.target.value, 200, 30000);
                  if (value !== undefined) onChange({ delayMs: value });
                }}
              />
            </>
          )}
          {config.type === 'infinite_scroll' && (
            <>
              <Input
                type="number"
                label="Most scrolls"
                min={1}
                max={200}
                value={config.scrollCount ?? PAGINATION_DEFAULTS.scrollCount}
                onChange={(e) => {
                  const value = wholeNumber(e.target.value);
                  if (value !== undefined) onChange({ scrollCount: Math.min(200, Math.max(1, value)) });
                }}
              />
              <Input
                type="number"
                label="Wait between scrolls (seconds)"
                min={0.3}
                max={10}
                step={0.5}
                value={(config.scrollDelayMs ?? PAGINATION_DEFAULTS.scrollDelayMs) / 1000}
                onChange={(e) => {
                  const value = secondsToMs(e.target.value, 300, 10000);
                  if (value !== undefined) onChange({ scrollDelayMs: value });
                }}
              />
            </>
          )}
          <div className="col-span-2">{rowLimitInput}</div>
        </div>
      </Disclosure>
    </div>
  );
};
