import React from 'react';

export interface BrandMarkProps {
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Geometric harvest emblem matching the extension icon (`public/icon/128.png`).
 * Shared across the Side Panel header, Workbench header, and Welcome tour.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ size = 'md', className = '' }) => {
  const frame = size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-9 w-9 rounded-xl';
  const icon = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-brand to-tool-teal text-on-accent ring-1 ring-inset ring-hairline/15 shadow-xs ${frame} ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" className={icon}>
        <rect x="11.25" y="6.75" width="1.5" height="14.25" rx="0.75" fill="currentColor" />
        <ellipse cx="12" cy="4.75" rx="1.35" ry="2.25" fill="currentColor" />
        <ellipse cx="9.1" cy="8.2" rx="2.3" ry="1.2" transform="rotate(34 9.1 8.2)" fill="currentColor" />
        <ellipse cx="14.9" cy="8.2" rx="2.3" ry="1.2" transform="rotate(-34 14.9 8.2)" fill="currentColor" />
        <ellipse cx="8.9" cy="11.9" rx="2.3" ry="1.2" transform="rotate(34 8.9 11.9)" fill="currentColor" />
        <ellipse cx="15.1" cy="11.9" rx="2.3" ry="1.2" transform="rotate(-34 15.1 11.9)" fill="currentColor" />
        <ellipse cx="9.1" cy="15.6" rx="2.3" ry="1.2" transform="rotate(34 9.1 15.6)" fill="currentColor" />
        <ellipse cx="14.9" cy="15.6" rx="2.3" ry="1.2" transform="rotate(-34 14.9 15.6)" fill="currentColor" />
      </svg>
    </span>
  );
};
