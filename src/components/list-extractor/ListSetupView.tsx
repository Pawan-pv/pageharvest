import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Columns,
  MousePointerClick,
  MousePointer2,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { DetectedList } from '@/hooks/useExtractionWorkflow';
import type { ExtractionPaginationConfig, FieldDefinition } from '@/types';

export interface ListSetupViewProps {
  detectedList: DetectedList | null;
  fields: FieldDefinition[];
  selectedFieldIds: Set<string>;
  pagination: ExtractionPaginationConfig;
  onPickList: () => void;
  onAutoDetect: () => void;
  onRepick: () => void;
  onEditColumns?: () => void;
  onToggleField?: (id: string) => void;
  onRenameField?: (id: string, name: string) => void;
  onPickNextButton?: () => void;
  onPaginationChange: (pagination: Partial<ExtractionPaginationConfig>) => void;
  onStartExtraction: () => void;
  isDetecting?: boolean;
}

type ExtendedPaginationConfig = ExtractionPaginationConfig & { isLoadMore?: boolean };

export const ListSetupView: React.FC<ListSetupViewProps> = ({
  detectedList,
  fields,
  selectedFieldIds,
  pagination,
  onPickList,
  onAutoDetect,
  onRepick,
  onEditColumns,
  onToggleField,
  onRenameField,
  onPickNextButton,
  onPaginationChange,
  onStartExtraction,
  isDetecting = false,
}) => {
  const [showLimits, setShowLimits] = useState(false);
  const [isEditingColumns, setIsEditingColumns] = useState(false);
  const list = detectedList;
  const isSelected = Boolean(list && list.matchCount > 0);
  const activeFields = fields.filter((f) => selectedFieldIds.has(f.id));
  const activeFieldsCount = activeFields.length || fields.length;

  const currentMode = pagination.type ?? 'none';
  const isLoadMoreMode =
    currentMode === 'next_button' && Boolean((pagination as ExtendedPaginationConfig).isLoadMore);

  const handleSelectMode = (mode: 'none' | 'infinite_scroll' | 'next_button' | 'load_more') => {
    if (mode === 'load_more') {
      const cfg: ExtendedPaginationConfig = {
        type: 'next_button',
        maxPages: pagination.maxPages ?? 10,
        delayMs: Math.max(1000, pagination.delayMs ?? 1000),
        isLoadMore: true,
      };
      onPaginationChange(cfg);
    } else if (mode === 'next_button') {
      const cfg: ExtendedPaginationConfig = {
        type: 'next_button',
        maxPages: pagination.maxPages ?? 10,
        delayMs: Math.max(1000, pagination.delayMs ?? 1000),
        isLoadMore: false,
      };
      onPaginationChange(cfg);
    } else if (mode === 'infinite_scroll') {
      onPaginationChange({
        type: 'infinite_scroll',
        scrollCount: pagination.scrollCount ?? 10,
        scrollDelayMs: Math.max(1000, pagination.scrollDelayMs ?? 1000),
      });
    } else {
      onPaginationChange({ type: 'none' });
    }
  };

  const handleEditColumnsClick = () => {
    if (onEditColumns) {
      onEditColumns();
    }
    setIsEditingColumns(!isEditingColumns);
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-left">
      {/* CARD 1: Select List */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs font-bold uppercase tracking-wider text-[#00E599]">
            ① Select List
          </span>
          {isSelected && (
            <span className="flex items-center gap-1 text-3xs font-semibold text-[#00E599]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00E599] animate-pulse" />
              Locked
            </span>
          )}
        </div>

        {!isSelected ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onPickList}
              className="group relative flex flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-[#00E599]/40 bg-[#00E599]/[0.04] p-5 text-center transition-all duration-200 hover:border-[#00E599] hover:bg-[#00E599]/[0.08] active:scale-[0.99] cursor-pointer"
            >
              <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-[#00E599]/30 bg-[#00E599]/15 text-[#00E599] shadow-[0_0_16px_rgba(0,229,153,0.25)] transition-transform group-hover:scale-110">
                <MousePointerClick className="h-5 w-5 text-[#00E599]" />
                <span className="absolute -inset-1 rounded-xl bg-[#00E599]/20 blur-sm -z-10 group-hover:bg-[#00E599]/35 transition-colors" />
              </div>

              <div className="flex flex-col items-center gap-0.5">
                <span className="text-sm font-bold text-fg group-hover:text-[#00E599] transition-colors">
                  Click to Pick List
                </span>
                <span className="text-2xs text-fg-subtle">
                  Hover and click any repeated item on the page
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={onAutoDetect}
              disabled={isDetecting}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-[#10141D] py-2 px-3 text-xs font-semibold text-[#00E599] shadow-sm transition-all hover:border-[#00E599]/30 hover:bg-[#00E599]/10 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5 text-[#00E599]" />
              <span>{isDetecting ? 'Detecting lists…' : '⚡ Auto-detect on this page'}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-[#00E599]/30 bg-[#00E599]/[0.07] p-3.5 shadow-[0_0_20px_rgba(0,229,153,0.1)] transition-all">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#00E599]/20 text-[#00E599] font-bold text-sm">
                  ✓
                </span>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-fg">
                    ✓ Found {list?.matchCount} items · {activeFieldsCount} columns
                  </span>
                  <span className="text-3xs text-fg-subtle truncate max-w-[180px]">
                    {list?.containerSelector}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleEditColumnsClick}
                  className="flex items-center gap-1 rounded-lg border border-line bg-[#10141D] px-2.5 py-1 text-2xs font-semibold text-fg transition-colors hover:border-[#00E599]/30 hover:text-[#00E599] cursor-pointer"
                >
                  <Columns className="h-3 w-3 text-[#00E599]" />
                  <span>Edit columns</span>
                </button>
                <button
                  type="button"
                  onClick={onRepick}
                  className="flex items-center gap-1 rounded-lg border border-line bg-[#10141D] px-2 py-1 text-2xs font-semibold text-fg-subtle transition-colors hover:text-fg hover:border-line-strong cursor-pointer"
                  title="Pick a different repeating item"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Re-pick</span>
                </button>
              </div>
            </div>

            {/* Expanded inline column editor if toggled */}
            {isEditingColumns && fields.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5 border-t border-[#00E599]/20 pt-2 ph-pop-in">
                <div className="flex items-center justify-between text-3xs font-semibold text-fg-subtle uppercase">
                  <span>Toggle Columns</span>
                  <span>{activeFieldsCount} selected</span>
                </div>
                <div className="max-h-40 overflow-y-auto flex flex-col gap-1 pr-1">
                  {fields.map((field) => {
                    const isChecked = selectedFieldIds.has(field.id);
                    return (
                      <label
                        key={field.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-[#10141D] px-2.5 py-1.5 border border-line-subtle hover:border-[#00E599]/30 cursor-pointer"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleField?.(field.id)}
                            className="accent-[#00E599] rounded"
                          />
                          <input
                            type="text"
                            value={field.name}
                            onChange={(e) => onRenameField?.(field.id, e.target.value)}
                            className="text-2xs font-medium text-fg truncate bg-transparent border-0 focus:ring-1 focus:ring-[#00E599] rounded px-1"
                          />
                        </div>
                        <span className="text-3xs text-fg-subtle font-mono uppercase">
                          {field.extractor}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CARD 2: Load More Items */}
      <div
        className={`flex flex-col gap-2.5 transition-all duration-300 ${
          isSelected ? 'opacity-100' : 'opacity-45 pointer-events-none'
        }`}
      >
        <span className="text-2xs font-bold uppercase tracking-wider text-fg-subtle">
          ② Load More Items
        </span>

        <div className="flex flex-col gap-2">
          {/* Option: This Page Only */}
          <label
            onClick={() => handleSelectMode('none')}
            className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
              currentMode === 'none'
                ? 'border-[#00E599]/50 bg-[#00E599]/10 shadow-[0_0_12px_rgba(0,229,153,0.15)]'
                : 'border-line bg-[#10141D] hover:border-line-strong'
            }`}
          >
            <input
              type="radio"
              name="pagination-mode"
              checked={currentMode === 'none'}
              onChange={() => handleSelectMode('none')}
              className="mt-0.5 accent-[#00E599]"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-fg">This Page Only</span>
              <span className="text-2xs text-fg-subtle">Extract items visible on the current page</span>
            </div>
          </label>

          {/* Option: Auto-Scroll */}
          <label
            onClick={() => handleSelectMode('infinite_scroll')}
            className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
              currentMode === 'infinite_scroll'
                ? 'border-[#00E599]/50 bg-[#00E599]/10 shadow-[0_0_12px_rgba(0,229,153,0.15)]'
                : 'border-line bg-[#10141D] hover:border-line-strong'
            }`}
          >
            <input
              type="radio"
              name="pagination-mode"
              checked={currentMode === 'infinite_scroll'}
              onChange={() => handleSelectMode('infinite_scroll')}
              className="mt-0.5 accent-[#00E599]"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-fg">Auto-Scroll</span>
              <span className="text-2xs text-fg-subtle">Scrolls down automatically to load more items</span>
            </div>
          </label>

          {/* Option: Pagination */}
          <div
            onClick={() => handleSelectMode('next_button')}
            className={`flex flex-col gap-2 rounded-xl border p-3 cursor-pointer transition-all ${
              currentMode === 'next_button' && !isLoadMoreMode
                ? 'border-[#00E599]/50 bg-[#00E599]/10 shadow-[0_0_12px_rgba(0,229,153,0.15)]'
                : 'border-line bg-[#10141D] hover:border-line-strong'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="pagination-mode"
                checked={currentMode === 'next_button' && !isLoadMoreMode}
                onChange={() => handleSelectMode('next_button')}
                className="mt-0.5 accent-[#00E599]"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-bold text-fg">Pagination</span>
                <span className="text-2xs text-fg-subtle">
                  Clicks the Next button or link across pages
                </span>
              </div>
            </div>

            {currentMode === 'next_button' && !isLoadMoreMode && (
              <div className="mt-1 ml-6 flex items-center justify-between gap-2 border-t border-[#00E599]/20 pt-2">
                <span className="text-3xs text-fg-subtle truncate">
                  {pagination.nextButtonSelector
                    ? `Button: ${pagination.nextButtonSelector}`
                    : 'Auto-detecting Next button'}
                </span>
                {onPickNextButton && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickNextButton();
                    }}
                    className="flex items-center gap-1 rounded-md border border-[#00E599]/40 bg-[#00E599]/15 px-2 py-0.5 text-3xs font-semibold text-[#00E599] hover:bg-[#00E599]/25 cursor-pointer"
                  >
                    <MousePointer2 className="h-3 w-3" />
                    <span>Pick Next button</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Option: Load More */}
          <label
            onClick={() => handleSelectMode('load_more')}
            className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
              isLoadMoreMode
                ? 'border-[#00E599]/50 bg-[#00E599]/10 shadow-[0_0_12px_rgba(0,229,153,0.15)]'
                : 'border-line bg-[#10141D] hover:border-line-strong'
            }`}
          >
            <input
              type="radio"
              name="pagination-mode"
              checked={isLoadMoreMode}
              onChange={() => handleSelectMode('load_more')}
              className="mt-0.5 accent-[#00E599]"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-fg">Load More</span>
              <span className="text-2xs text-fg-subtle">
                Clicks a &apos;Load More&apos; button on the same page
              </span>
            </div>
          </label>
        </div>

        {/* Collapsible Limits & timing link */}
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowLimits(!showLimits)}
            className="flex items-center gap-1 text-2xs font-semibold text-[#00E599] hover:text-[#00E599]/80 transition-colors cursor-pointer"
          >
            <span>Limits &amp; timing</span>
            {showLimits ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showLimits && (
            <div className="mt-2 flex flex-col gap-2.5 rounded-xl border border-line bg-[#10141D] p-3 text-2xs">
              {currentMode === 'infinite_scroll' ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-subtle">Max scrolls:</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={pagination.scrollCount ?? 10}
                    onChange={(e) =>
                      onPaginationChange({ scrollCount: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                    className="w-16 rounded-lg border border-line bg-[#080B10] px-2 py-1 text-right text-xs text-fg tabular-nums"
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-subtle">Max pages:</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={pagination.maxPages ?? 10}
                    onChange={(e) =>
                      onPaginationChange({ maxPages: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                    className="w-16 rounded-lg border border-line bg-[#080B10] px-2 py-1 text-right text-xs text-fg tabular-nums"
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-fg-subtle">Delay (min 1,000 ms):</span>
                <input
                  type="number"
                  min={1000}
                  step={200}
                  value={pagination.delayMs ?? 1000}
                  onChange={(e) =>
                    onPaginationChange({
                      delayMs: Math.max(1000, parseInt(e.target.value) || 1000),
                    })
                  }
                  className="w-20 rounded-lg border border-line bg-[#080B10] px-2 py-1 text-right text-xs text-fg tabular-nums"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Primary CTA */}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto border-t border-line bg-[#080B10]/95 p-4 backdrop-blur-md">
        <button
          type="button"
          onClick={onStartExtraction}
          disabled={!isSelected}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#00E599] py-3 px-4 font-bold text-sm text-[#080B10] shadow-[0_0_24px_rgba(0,229,153,0.35)] transition-all duration-200 hover:bg-[#00E599]/90 hover:shadow-[0_0_32px_rgba(0,229,153,0.5)] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none cursor-pointer"
        >
          <Sparkles className="h-4 w-4" />
          <span>Start Extraction</span>
        </button>
      </div>
    </div>
  );
};
