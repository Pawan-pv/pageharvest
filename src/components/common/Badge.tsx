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
    sm: 'text-[10px] font-medium px-1.5 py-0.5 gap-1',
    md: 'text-xs font-medium px-2 py-0.5 gap-1.5',
  };

  const variantClasses: Record<BadgeVariant, string> = {
    neutral: 'bg-slate-100 text-slate-700 border border-slate-200/80',
    brand: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    success: 'bg-green-50 text-green-800 border border-green-200',
    warning: 'bg-amber-50 text-amber-800 border border-amber-200',
    danger: 'bg-rose-50 text-rose-800 border border-rose-200',
    info: 'bg-sky-50 text-sky-800 border border-sky-200',
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
