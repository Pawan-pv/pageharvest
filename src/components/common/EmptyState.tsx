import React from 'react';
import { Button } from './Button';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  /** What this place is for and what to do next, in a sentence. */
  description: string;
  /**
   * The next action. Required: every empty screen decides what the user does next, and passes
   * null only when the description points at something already on screen.
   */
  action: EmptyStateAction | null;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className = '' }) => (
  <div
    className={`flex flex-col items-center justify-center text-center p-6 bg-surface-sunken border border-dashed border-line rounded-card ${className}`}
  >
    {icon && (
      <div
        aria-hidden="true"
        className="w-10 h-10 rounded-pill bg-surface-muted flex items-center justify-center text-fg-subtle mb-3"
      >
        {icon}
      </div>
    )}
    <h3 className="text-sm font-semibold text-fg">{title}</h3>
    <p className="text-xs text-fg-muted max-w-xs mt-1 leading-relaxed">{description}</p>
    {action && (
      <Button variant="primary" size="sm" className="mt-4" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </div>
);
