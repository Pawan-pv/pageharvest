import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { IconButton } from './IconButton';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  tone?: BannerTone;
  title?: React.ReactNode;
  /** What happened, in a plain sentence. */
  children?: React.ReactNode;
  /** Whether the user's data is safe. Shown as "Your data: ...". */
  dataSafety?: React.ReactNode;
  /** What the user can do now. Shown as "What to do: ...". */
  nextStep?: React.ReactNode;
  /** Technical detail, hidden behind a disclosure. */
  details?: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const ICONS: Record<BannerTone, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-info-fg" />,
  success: <CheckCircle2 className="w-4 h-4 text-brand-fg" />,
  warning: <AlertTriangle className="w-4 h-4 text-warning-fg" />,
  danger: <AlertCircle className="w-4 h-4 text-danger-fg" />,
};

const TONES: Record<BannerTone, string> = {
  info: 'bg-info-soft border-info-line text-info-emphasis',
  success: 'bg-brand-soft border-brand-line text-brand-emphasis',
  warning: 'bg-warning-soft border-warning-line text-warning-emphasis',
  danger: 'bg-danger-soft border-danger-line text-danger-emphasis',
};

/**
 * A message about the state of the user's work. Problems announce themselves as alerts;
 * everything else is a polite status, so screen readers are not interrupted for good news.
 */
export const Banner: React.FC<BannerProps> = ({
  tone = 'info',
  title,
  children,
  dataSafety,
  nextStep,
  details,
  actions,
  onDismiss,
  className = '',
}) => (
  <div
    role={tone === 'danger' ? 'alert' : 'status'}
    className={`flex items-start gap-3 p-3 rounded-card border text-xs leading-relaxed text-left ${TONES[tone]} ${className}`}
  >
    <span aria-hidden="true" className="shrink-0 mt-0.5">
      {ICONS[tone]}
    </span>
    <div className="flex-1 min-w-0 flex flex-col gap-1">
      {title && <div className="font-semibold">{title}</div>}
      {children && <div>{children}</div>}
      {dataSafety && (
        <p>
          <span className="font-semibold">Your data: </span>
          {dataSafety}
        </p>
      )}
      {nextStep && (
        <p>
          <span className="font-semibold">What to do: </span>
          {nextStep}
        </p>
      )}
      {details && (
        <details className="mt-0.5">
          <summary className="cursor-pointer select-none font-medium underline-offset-2 hover:underline">
            Technical details
          </summary>
          <div className="mt-1 font-mono text-2xs break-all opacity-90">{details}</div>
        </details>
      )}
      {actions && <div className="mt-1.5 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {onDismiss && (
      <IconButton label="Dismiss" icon={<X className="w-3.5 h-3.5" />} onClick={onDismiss} className="-mr-1 -mt-1" />
    )}
  </div>
);
