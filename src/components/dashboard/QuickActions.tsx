import React from 'react';
import { MousePointer, Sparkles, Table, Link2 } from 'lucide-react';
import { Card } from '@/components/common/Card';

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
        <h4 className="text-xs font-semibold text-slate-700 tracking-tight uppercase tracking-wider">
          Quick Actions
        </h4>
        <span className="text-[11px] text-slate-400">Local-first</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Visual Element Picker */}
        <button
          onClick={onSelectElements}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-emerald-200/90 bg-emerald-50/40 hover:bg-emerald-50 hover:border-emerald-300 text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <MousePointer className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-900 leading-tight">
            Select Elements
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 leading-snug">
            Point & click any item
          </span>
        </button>

        {/* Auto-Detect Repeating Lists */}
        <button
          onClick={onAutoDetectLists}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-slate-800 text-white flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-900 leading-tight">
            Auto-Detect Lists
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 leading-snug">
            Scan cards & rows
          </span>
        </button>

        {/* Extract Table */}
        <button
          onClick={onExtractTable}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-sky-600 text-white flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <Table className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-900 leading-tight">
            Extract Tables
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 leading-snug">
            Pull HTML tabular data
          </span>
        </button>

        {/* Extract Links */}
        <button
          onClick={onExtractLinks}
          disabled={disabled}
          className="flex flex-col items-start p-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-left transition-all duration-150 group disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center mb-2 shadow-xs group-hover:scale-105 transition-transform">
            <Link2 className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-900 leading-tight">
            Extract Links
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5 leading-snug">
            Harvest URLs & titles
          </span>
        </button>
      </div>
    </div>
  );
};
