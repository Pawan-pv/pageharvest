import React from 'react';

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
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full flex flex-col gap-1 text-left">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-slate-700 tracking-tight">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {iconLeft && (
          <div className="absolute left-3 flex items-center pointer-events-none text-slate-400">
            {iconLeft}
          </div>
        )}
        <input
          id={inputId}
          disabled={disabled}
          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
            iconLeft ? 'pl-9' : ''
          } ${iconRight ? 'pr-9' : ''} ${
            error
              ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
              : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
          } ${className}`}
          {...props}
        />
        {iconRight && (
          <div className="absolute right-3 flex items-center text-slate-400">
            {iconRight}
          </div>
        )}
      </div>
      {error ? (
        <span className="text-xs text-rose-600 font-medium">{error}</span>
      ) : helperText ? (
        <span className="text-xs text-slate-500">{helperText}</span>
      ) : null}
    </div>
  );
};
