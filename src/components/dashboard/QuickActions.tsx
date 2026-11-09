import React, { useId } from 'react';
import { MousePointer, Sparkles, Table, Link2, ChevronRight } from 'lucide-react';

export interface QuickActionsProps {
  disabled?: boolean;
  /** The page is a website PageHarvest has not been given yet (ADR-037), not a browser page. */
  needsAccess?: boolean;
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

const SecondaryOption: React.FC<{ label: string; icon: React.ReactNode; disabled: boolean; onClick: () => void }> = ({
  label,
  icon,
  disabled,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex items-center gap-2 px-3 py-2 rounded-control border border-line bg-surface text-xs font-medium text-fg-muted hover:text-fg hover:border-line-strong disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <span aria-hidden="true">{icon}</span>
    {label}
  </button>
);

/**
 * How to start. Auto-detect comes first because it needs no knowledge of the page; picking
 * by hand is the fallback. Tables and links are rarer, so they wait under "More ways".
 */
export const QuickActions: React.FC<QuickActionsProps> = ({
  disabled = false,
  needsAccess = false,
  onSelectElements,
  onAutoDetectLists,
  onExtractTable,
  onExtractLinks,
}) => (
  <section aria-labelledby="start-heading" className="flex flex-col gap-2 text-left">
    <h2 id="start-heading" className="text-sm font-semibold text-fg">
      Get data from this page
    </h2>
    {disabled && (
      <p className="text-xs text-fg-muted">
        {needsAccess
          ? 'Click the PageHarvest button in the Chrome toolbar to start. The panel updates by itself.'
          : 'Open a normal website tab to start. Then press Refresh above.'}
      </p>
    )}

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

    <details className="group">
      <summary className="cursor-pointer select-none text-xs font-medium text-fg-muted hover:text-fg py-1">
        More ways to start
      </summary>
      <div className="flex flex-wrap gap-2 pt-1">
        <SecondaryOption
          label="Extract a table"
          icon={<Table className="w-3.5 h-3.5" />}
          disabled={disabled}
          onClick={onExtractTable}
        />
        <SecondaryOption
          label="Extract all links"
          icon={<Link2 className="w-3.5 h-3.5" />}
          disabled={disabled}
          onClick={onExtractLinks}
        />
      </div>
    </details>
  </section>
);
