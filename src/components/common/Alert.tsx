import React from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant = 'info',
  title,
  children,
  action,
  onDismiss,
  className = '',
}) => {
  const icons = {
    info: <Info className="w-4 h-4 text-info-fg shrink-0 mt-0.5" />,
    success: <CheckCircle2 className="w-4 h-4 text-brand-fg shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="w-4 h-4 text-warning-fg shrink-0 mt-0.5" />,
    error: <AlertCircle className="w-4 h-4 text-danger-fg shrink-0 mt-0.5" />,
  };

  const variantStyles = {
    info: 'bg-info-soft/80 border-info-line text-info-emphasis',
    success: 'bg-brand-soft/80 border-brand-line text-brand-emphasis',
    warning: 'bg-warning-soft/80 border-warning-line text-warning-emphasis',
    error: 'bg-danger-soft/80 border-danger-line text-danger-emphasis',
  };

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 p-3 rounded-xl border text-xs leading-relaxed text-left transition-all ${variantStyles[variant]} ${className}`}
    >
      {icons[variant]}
      <div className="flex-1 min-w-0">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        <div>{children}</div>
        {action && <div className="mt-2 flex items-center gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss alert"
          className="p-1 -mr-1 text-fg-subtle hover:text-fg-muted rounded hover:bg-fg/5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
