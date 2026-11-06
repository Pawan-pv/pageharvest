import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options: SelectOption[];
}

export const Select: React.FC<SelectProps> = ({
  label,
  helperText,
  error,
  options,
  id,
  className = '',
  disabled,
  ...props
}) => {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;
  const hasMessage = Boolean(error || helperText);

  return (
    <div className="w-full flex flex-col gap-1 text-left">
      {label && (
        <label htmlFor={selectId} className="text-xs font-semibold text-fg-muted tracking-tight">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <select
          id={selectId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          className={`w-full appearance-none rounded-lg border bg-surface px-3 py-2 pr-9 text-sm text-fg transition-colors focus:outline-none focus:ring-1 focus:ring-offset-0 disabled:bg-surface-sunken disabled:text-fg-subtle disabled:cursor-not-allowed ${
            error
              ? 'border-danger focus:border-danger focus:ring-danger'
              : 'border-line-strong focus:border-focus focus:ring-focus'
          } ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="absolute right-3 flex items-center pointer-events-none text-fg-subtle">
          <ChevronDown className="w-4 h-4" />
        </div>
      </div>
      {error ? (
        <span id={messageId} className="text-xs text-danger-fg font-medium">{error}</span>
      ) : helperText ? (
        <span id={messageId} className="text-xs text-fg-subtle">{helperText}</span>
      ) : null}
    </div>
  );
};
