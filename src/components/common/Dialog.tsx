import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** The element focused on open. Defaults to the first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

const SIZES = {
  sm: 'max-w-xs',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

/**
 * A modal dialog. Focus moves inside on open, Tab and Shift+Tab stay inside, Escape and the
 * backdrop close it, and focus returns to whatever opened it.
 */
export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const target = initialFocusRef?.current ?? focusableIn(panel)[0] ?? panel;
      target.focus();
    }
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen, initialFocusRef]);

  if (!isOpen) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = focusableIn(panelRef.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div
        data-testid="dialog-backdrop"
        className="fixed inset-0 bg-scrim/40 backdrop-blur-xs animate-fade-in"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`relative z-10 w-full ${SIZES[size]} bg-surface rounded-card shadow-xl border border-line overflow-hidden flex flex-col text-left animate-scale-in`}
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b border-line-subtle">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg leading-tight">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-xs text-fg-subtle mt-1">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close dialog" icon={<X className="w-4 h-4" />} onClick={() => onCloseRef.current()} />
        </div>

        <div className="p-4 overflow-y-auto max-h-[70vh] text-sm text-fg-muted">{children}</div>

        {footer && (
          <div className="p-3 bg-surface-sunken border-t border-line-subtle flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
