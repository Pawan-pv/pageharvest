import React, { useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  helperText,
  error,
  iconLeft,
  iconRight,
  id,
  className = '',
  disabled,
  ...props
}) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const hasMessage = Boolean(error || helperText);

  return (
    <div className="w-full flex flex-col gap-1 text-left">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-fg-muted tracking-tight">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {iconLeft && (
          <div className="absolute left-3 flex items-center pointer-events-none text-fg-subtle">
            {iconLeft}
          </div>
        )}
        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:outline-none focus:ring-1 focus:ring-offset-0 disabled:bg-surface-sunken disabled:text-fg-subtle disabled:cursor-not-allowed ${
            iconLeft ? 'pl-9' : ''
          } ${iconRight ? 'pr-9' : ''} ${
            error
              ? 'border-danger focus:border-danger focus:ring-danger'
              : 'border-line-strong focus:border-focus focus:ring-focus'
          } ${className}`}
          {...props}
        />
        {iconRight && (
          <div className="absolute right-3 flex items-center text-fg-subtle">
            {iconRight}
          </div>
        )}
      </div>
      {error ? (
        <span id={messageId} className="text-xs text-danger-fg font-medium">{error}</span>
      ) : helperText ? (
        <span id={messageId} className="text-xs text-fg-subtle">{helperText}</span>
      ) : null}
    </div>
  );
};
