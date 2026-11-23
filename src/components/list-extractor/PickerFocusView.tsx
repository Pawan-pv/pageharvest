import React, { useEffect } from 'react';
import { MousePointer2, X } from 'lucide-react';
import type { InspectedElement } from '@/hooks/useExtractionWorkflow';

export interface PickerFocusViewProps {
  inspectedElement?: InspectedElement | null;
  onCancel: () => void;
}

export const PickerFocusView: React.FC<PickerFocusViewProps> = ({
  inspectedElement,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCancel]);

  return (
    <div className="relative flex min-h-[500px] h-full w-full flex-col items-center justify-between bg-[#080B10] p-6 text-center select-none animate-fade-in">
      {/* Top Section: Radar Animation & Title */}
      <div className="flex flex-col items-center gap-6 pt-4 w-full">
        {/* Radar-cursor SVG container */}
        <div className="relative flex h-32 w-32 items-center justify-center">
          {/* Animated concentric emerald expanding rings */}
          <div className="absolute h-28 w-28 rounded-full border border-[#00E599]/30 ph-radar-ping pointer-events-none" />
          <div
            className="absolute h-20 w-20 rounded-full border border-[#00E599]/50 ph-radar-ping pointer-events-none"
            style={{ animationDelay: '0.6s' }}
          />
          <div className="absolute h-16 w-16 rounded-full bg-[#00E599]/10 ph-aura-breathe pointer-events-none" />

          {/* Central radar emitter / cursor tile */}
          <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#00E599]/40 bg-[#10141D] text-[#00E599] shadow-[0_0_24px_rgba(0,229,153,0.4)]">
            <MousePointer2 className="h-6 w-6 transform -rotate-12 fill-[#00E599]/20" />
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[#00E599] shadow-[0_0_8px_#00E599]" />
          </div>
        </div>

        {/* Bold Title */}
        <div className="flex flex-col items-center gap-1.5">
          <h2 className="text-xl font-bold tracking-tight text-fg">
            Select a List Item
          </h2>
          <p className="text-2xs text-fg-subtle max-w-[260px]">
            Target any repeated card, row, or product on the active webpage
          </p>
        </div>

        {/* Vertical 2-Step Guide connected by subtle line */}
        <div className="relative flex flex-col gap-6 text-left max-w-[260px] w-full mt-2">
          {/* Connecting line */}
          <div className="absolute left-[13px] top-4 bottom-4 w-0.5 bg-[#00E599]/20" />

          {/* Step 1 */}
          <div className="relative flex items-start gap-3 z-10">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#00E599]/40 bg-[#10141D] text-xs font-bold text-[#00E599] shadow-sm">
              ①
            </span>
            <div className="flex flex-col pt-0.5">
              <span className="text-xs font-bold text-fg">Hover</span>
              <span className="text-2xs text-fg-subtle">
                Move your cursor over any list, product card, or table
              </span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative flex items-start gap-3 z-10">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#00E599]/40 bg-[#10141D] text-xs font-bold text-[#00E599] shadow-sm">
              ②
            </span>
            <div className="flex flex-col pt-0.5">
              <span className="text-xs font-bold text-fg">Click</span>
              <span className="text-2xs text-fg-subtle">
                Click the highlighted area to lock the pattern
              </span>
            </div>
          </div>
        </div>

        {/* Live Inspected Element pill (if hovering element) */}
        {inspectedElement && (
          <div className="mt-2 w-full max-w-[280px] rounded-xl border border-[#00E599]/30 bg-[#00E599]/[0.08] px-3 py-1.5 text-left text-3xs text-[#00E599] truncate ph-pop-in">
            <span className="font-semibold text-fg">Hovering: </span>
            <code>{inspectedElement.selector || inspectedElement.tagName}</code>
          </div>
        )}

        {/* Keyboard Tip Pill */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 py-1 text-3xs text-fg-muted">
          <kbd className="rounded border border-line-strong bg-surface-muted px-1.5 py-0.5 font-mono text-3xs font-semibold text-fg">
            Hold Alt
          </kbd>
          <span>to pick a single element only</span>
        </div>
      </div>

      {/* Bottom Section: Circular Cancel Button */}
      <div className="flex flex-col items-center pb-2 pt-6">
        <button
          type="button"
          onClick={onCancel}
          className="group flex flex-col items-center gap-1.5 text-fg-subtle transition-colors hover:text-fg cursor-pointer"
          aria-label="Cancel Selection"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-[#10141D] shadow-sm transition-all duration-150 group-hover:border-danger-line group-hover:bg-danger-soft group-hover:text-danger-fg group-active:scale-95">
            <X className="h-5 w-5" />
          </div>
          <span className="text-2xs font-medium">Cancel Selection</span>
        </button>
      </div>
    </div>
  );
};
