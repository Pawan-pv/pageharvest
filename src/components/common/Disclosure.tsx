import React, { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export interface DisclosureProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Shown next to the label, outside the button, such as a HelpTip. */
  aside?: React.ReactNode;
  className?: string;
}

/** A section that starts collapsed. Its content is not rendered until it is opened. */
export const Disclosure: React.FC<DisclosureProps> = ({ label, children, defaultOpen = false, aside, className = '' }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={isOpen ? contentId : undefined}
          onClick={() => setIsOpen((open) => !open)}
          className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg py-1"
        >
          <ChevronRight
            aria-hidden="true"
            className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
          {label}
        </button>
        {aside}
      </div>
      {isOpen && (
        <div id={contentId} className="pt-2">
          {children}
        </div>
      )}
    </div>
  );
};
