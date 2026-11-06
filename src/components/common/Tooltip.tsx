import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { helpTips, type HelpTipId } from '@/components/guide/tips';

export interface TooltipProps {
  /** What the help is about, read as "Help: <label>". */
  label: string;
  /** The help text: one or two sentences. */
  children: React.ReactNode;
  className?: string;
}

const TIP_WIDTH_PX = 224;

/**
 * A "?" button that explains the control beside it. It opens on hover, keyboard focus or tap,
 * stays open while the pointer is over the text, and closes on Escape, blur or pointer leave.
 */
export const Tooltip: React.FC<TooltipProps> = ({ label, children, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const tipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The side panel is narrow, so a tip near the right edge opens towards the left.
  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAlignEnd(rect.left + TIP_WIDTH_PX > window.innerWidth - 8);
  }, [isOpen]);

  return (
    <span
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Help: ${label}`}
        aria-describedby={isOpen ? tipId : undefined}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && isOpen) {
            event.stopPropagation();
            setIsOpen(false);
          }
        }}
        className="inline-flex items-center justify-center h-5 w-5 rounded-pill text-fg-subtle hover:text-fg hover:bg-surface-muted"
      >
        <HelpCircle aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
      {isOpen && (
        <span
          role="tooltip"
          id={tipId}
          style={{ width: TIP_WIDTH_PX }}
          className={`absolute top-full mt-1 z-40 max-w-[calc(100vw-2rem)] rounded-control border border-line bg-inverse px-2.5 py-2 text-2xs leading-snug font-normal text-on-strong shadow-xs animate-fade-in ${
            alignEnd ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
};

/** A tooltip whose copy comes from the typed registry in guide/tips.ts. */
export const HelpTip: React.FC<{ tipId: HelpTipId; className?: string }> = ({ tipId, className }) => {
  const tip = helpTips[tipId];
  return (
    <Tooltip label={tip.topic} className={className}>
      {tip.text}
    </Tooltip>
  );
};
