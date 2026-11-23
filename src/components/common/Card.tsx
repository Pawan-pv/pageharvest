import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'flat' | 'interactive';
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  ...props
}) => {
  const variantStyles = {
    default: 'bg-surface border border-line/90 shadow-xs rounded-xl',
    flat: 'bg-surface-sunken border border-line/80 rounded-xl',
    interactive:
      'bg-surface border border-line hover:border-line-strong hover:shadow-xs transition-all duration-150 cursor-pointer rounded-xl',
  };

  return (
    <div className={`${variantStyles[variant]} p-4 ${className}`} {...props}>
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, action, className = '' }) => (
  <div className={`flex items-start justify-between gap-2 pb-3 mb-3 border-b border-line-subtle ${className}`}>
    <div>
      <h3 className="text-sm font-semibold text-fg leading-snug">{title}</h3>
      {subtitle && <p className="text-xs text-fg-subtle mt-0.5">{subtitle}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
