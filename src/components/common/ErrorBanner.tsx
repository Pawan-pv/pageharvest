import React from 'react';
import { Banner } from './Banner';
import { describeError, type PanelError } from './errorCopy';

export interface ErrorBannerProps {
  error: PanelError;
  onDismiss?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

/** Every error the panel shows: what happened, whether data is safe, what to do next. */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onDismiss, actions, className }) => {
  const copy = describeError(error);
  return (
    <Banner
      tone={copy.tone}
      title={copy.title}
      dataSafety={copy.dataSafety}
      nextStep={copy.nextStep}
      details={copy.details}
      actions={actions}
      onDismiss={onDismiss}
      className={className}
    >
      {copy.whatHappened}
    </Banner>
  );
};
