import React from 'react';
import { MousePointer, Sparkles, Table, Link2 } from 'lucide-react';

export interface QuickActionsProps {
  disabled?: boolean;
  onSelectElements: () => void;
  onAutoDetectLists: () => void;
  onExtractTable: () => void;
  onExtractLinks: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  disabled = false,
  onSelectElements,
  onAutoDetectLists,
  onExtractTable,
  onExtractLinks,
}) => {
  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-fg-muted tracking-tight uppercase tracking-wider">
          Quick Actions
        </h4>
        <span className="text-2xs text-fg-subtle">Local-first</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Visual Element Picker */}
        <button
          onClick={onSelectElements}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-brand-line/90 bg-brand-soft/40 hover:bg-brand-soft hover:border-brand-line text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-brand text-on-strong flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <MousePointer className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-fg leading-tight">
            Select Elements
          </span>
          <span className="text-2xs text-fg-subtle mt-0.5 leading-snug">
            Point & click any item
          </span>
        </button>

        {/* Auto-Detect Repeating Lists */}
        <button
          onClick={onAutoDetectLists}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-line bg-surface hover:bg-surface-sunken hover:border-line-strong text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-inverse text-on-strong flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-fg leading-tight">
            Auto-Detect Lists
          </span>
          <span className="text-2xs text-fg-subtle mt-0.5 leading-snug">
            Scan cards & rows
          </span>
        </button>

        {/* Extract Table */}
        <button
          onClick={onExtractTable}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-line bg-surface hover:bg-surface-sunken hover:border-line-strong text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-info text-on-strong flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <Table className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-fg leading-tight">
            Extract Tables
          </span>
          <span className="text-2xs text-fg-subtle mt-0.5 leading-snug">
            Pull HTML tabular data
          </span>
        </button>

        {/* Extract Links */}
        <button
          onClick={onExtractLinks}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-line bg-surface hover:bg-surface-sunken hover:border-line-strong text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-info text-on-strong flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <Link2 className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-fg leading-tight">
            Extract Links
          </span>
          <span className="text-2xs text-fg-subtle mt-0.5 leading-snug">
            Harvest URLs & titles
          </span>
        </button>
      </div>
    </div>
  );
};
