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
    info: <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />,
    success: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
    error: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />,
  };

  const variantStyles = {
    info: 'bg-sky-50/80 border-sky-200 text-sky-900',
    success: 'bg-emerald-50/80 border-emerald-200 text-emerald-900',
    warning: 'bg-amber-50/80 border-amber-200 text-amber-900',
    error: 'bg-rose-50/80 border-rose-200 text-rose-900',
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
          className="p-1 -mr-1 text-slate-400 hover:text-slate-600 rounded hover:bg-black/5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
