import React, { useId } from 'react';
import { MousePointer, Sparkles, Table, Link2, ChevronRight } from 'lucide-react';

export interface QuickActionsProps {
  disabled?: boolean;
  /** A website the user has kept PageHarvest off in Chrome's settings (ADR-040), not a browser page. */
  needsAccess?: boolean;
  /** Advanced options is on: both large choices are shown, as before simple mode (ADR-039). */
  advanced?: boolean;
  /**
   * Something above this section already says why the page cannot be read and what to do.
   * Simple mode then shows only the switched-off button, not the advice a second time or
   * the other ways to start, none of which can work on this page.
   */
  stateExplained?: boolean;
  onSelectElements: () => void;
  onAutoDetectLists: () => void;
  onExtractTable: () => void;
  onExtractLinks: () => void;
}

interface StartOptionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
}

/** A large choice button. Its name is the title; the description is read as its description. */
const StartOption: React.FC<StartOptionProps> = ({ title, description, icon, primary = false, disabled, onClick }) => {
  const descriptionId = useId();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      aria-describedby={descriptionId}
      className={`w-full flex items-start gap-3 p-3 rounded-card border text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        primary
          ? 'bg-brand-soft border-brand-line hover:border-brand'
          : 'bg-surface border-line hover:border-line-strong'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-8 h-8 rounded-control flex items-center justify-center shrink-0 ${
          primary ? 'bg-brand text-on-strong' : 'bg-surface-muted text-fg-muted'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        <span id={descriptionId} className="block text-xs text-fg-muted mt-0.5 leading-snug">
          {description}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="w-4 h-4 text-fg-subtle shrink-0 self-center" />
    </button>
  );
};

const SecondaryOption: React.FC<{
  label: string;
  ariaLabel?: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}> = ({
  label,
  ariaLabel,
  icon,
  disabled,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={ariaLabel}
    className="flex items-center gap-2 min-h-8 px-3 py-2 rounded-control border border-line bg-surface text-xs font-medium text-fg-muted hover:text-fg hover:border-line-strong disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <span aria-hidden="true">{icon}</span>
    {label}
  </button>
);

/**
 * How to start. In simple mode there is one large action, finding the list, because it needs
 * no knowledge of the page; picking by hand is offered as the way out when that fails. With
 * Advanced options on, both are large choices. Tables and links are rarer, so they wait under
 * "More ways to start" in both modes.
 */
export const QuickActions: React.FC<QuickActionsProps> = ({
  disabled = false,
  needsAccess = false,
  advanced = false,
  stateExplained = false,
  onSelectElements,
  onAutoDetectLists,
  onExtractTable,
  onExtractLinks,
}) => {
  // Simple mode on a page that cannot be read: the reason is on screen already.
  const onlyTheButton = disabled && stateExplained && !advanced;
  return (
  <section aria-labelledby="start-heading" className="flex flex-col gap-2 text-left">
    <h2 id="start-heading" className="text-sm font-semibold text-fg">
      Get data from this page
    </h2>
    {disabled && !onlyTheButton && (
      <p className="text-xs text-fg-muted">
        {needsAccess
          ? 'Click the PageHarvest button in the Chrome toolbar to start. The panel updates by itself.'
          : 'Open a normal website tab to start. This panel follows the tab you are on.'}
      </p>
    )}

    {advanced ? (
      <>
        <StartOption
          primary
          title="Find data automatically"
          description="PageHarvest looks for repeated items, such as products or search results, and shows you what it found."
          icon={<Sparkles className="w-4 h-4" />}
          disabled={disabled}
          onClick={onAutoDetectLists}
        />
        <StartOption
          title="Pick items myself"
          description="Click one item on the page. PageHarvest finds the others like it."
          icon={<MousePointer className="w-4 h-4" />}
          disabled={disabled}
          onClick={onSelectElements}
        />
      </>
    ) : (
      <>
        <button
          type="button"
          onClick={onAutoDetectLists}
          disabled={disabled}
          aria-describedby={onlyTheButton ? undefined : 'start-primary-description'}
          className="w-full min-h-12 flex items-center justify-center gap-2 px-4 py-3 rounded-card bg-brand text-on-strong text-base font-semibold border border-brand shadow-sm hover:bg-brand-hover active:bg-brand-active disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkles aria-hidden="true" className="w-5 h-5 shrink-0" />
          Find Data on This Page
        </button>
        {!onlyTheButton && (
        <>
        <p id="start-primary-description" className="text-body text-fg-muted">
          PageHarvest looks for the repeated items on this page, such as products or search results, and shows you
          what it found before anything is saved.
        </p>
        <p className="flex flex-wrap items-center gap-x-1 text-body text-fg-muted">
          <span>Not finding it?</span>
          <button
            type="button"
            onClick={onSelectElements}
            disabled={disabled}
            className="inline-flex items-center gap-1 min-h-8 px-1 rounded-control font-medium text-brand-fg underline underline-offset-2 hover:text-brand-emphasis disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MousePointer aria-hidden="true" className="w-3.5 h-3.5" />
            Pick one item myself
          </button>
        </p>
        </>
        )}
      </>
    )}

    {!onlyTheButton && (
      <div className="pt-2">
        <div className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle mb-1.5">
          Quick presets
        </div>
        <div className="flex items-center gap-2">
          <SecondaryOption
            label="Table"
            ariaLabel={advanced ? 'Extract a table' : 'Get a table'}
            icon={<Table className="w-3.5 h-3.5" />}
            disabled={disabled}
            onClick={onExtractTable}
          />
          <SecondaryOption
            label="Links"
            ariaLabel={advanced ? 'Extract all links' : 'Get all the links'}
            icon={<Link2 className="w-3.5 h-3.5" />}
            disabled={disabled}
            onClick={onExtractLinks}
          />
        </div>
      </div>
    )}
  </section>
  );
};
