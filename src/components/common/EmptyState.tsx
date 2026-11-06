import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center p-6 bg-surface-sunken/50 border border-dashed border-line rounded-xl ${className}`}
    >
      {icon && (
        <div className="w-10 h-10 rounded-full bg-surface-muted flex items-center justify-center text-fg-subtle mb-3">
          {icon}
        </div>
      )}
      <h4 className="text-sm font-semibold text-fg">{title}</h4>
      <p className="text-xs text-fg-subtle max-w-xs mt-1 mb-4 leading-relaxed">
        {description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
};
