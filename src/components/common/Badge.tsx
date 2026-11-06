import React from 'react';

export type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  icon,
  className = '',
}) => {
  const sizeClasses: Record<BadgeSize, string> = {
    sm: 'text-2xs font-medium px-1.5 py-0.5 gap-1',
    md: 'text-xs font-medium px-2 py-0.5 gap-1.5',
  };

  const variantClasses: Record<BadgeVariant, string> = {
    neutral: 'bg-surface-muted text-fg-muted border border-line/80',
    brand: 'bg-brand-soft text-brand-emphasis border border-brand-line',
    success: 'bg-brand-soft text-brand-emphasis border border-brand-line',
    warning: 'bg-warning-soft text-warning-emphasis border border-warning-line',
    danger: 'bg-danger-soft text-danger-emphasis border border-danger-line',
    info: 'bg-info-soft text-info-emphasis border border-info-line',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full select-none shrink-0 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
