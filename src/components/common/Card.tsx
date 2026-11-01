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
    default: 'bg-white border border-slate-200/90 shadow-xs rounded-xl',
    flat: 'bg-slate-50 border border-slate-200/80 rounded-xl',
    interactive:
      'bg-white border border-slate-200 hover:border-slate-300 hover:shadow-xs transition-all duration-150 cursor-pointer rounded-xl',
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
  <div className={`flex items-start justify-between gap-2 pb-3 mb-3 border-b border-slate-100 ${className}`}>
    <div>
      <h3 className="text-sm font-semibold text-slate-900 leading-snug">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
