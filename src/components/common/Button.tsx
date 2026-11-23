import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

/** React 19 passes `ref` as a prop, so ButtonProps includes it and spreading forwards it. */
export interface ButtonProps extends React.ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  iconLeft,
  iconRight,
  className = '',
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium transition-all duration-150 select-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer rounded-control';

  const sizeClasses: Record<ButtonSize, string> = {
    xs: 'text-xs px-2 py-1 gap-1 min-h-7',
    sm: 'text-xs px-2.5 py-1.5 gap-1.5 min-h-8',
    md: 'text-sm px-3.5 py-2 gap-2',
    lg: 'text-base px-4 py-2.5 gap-2.5',
  };

  const variantClasses: Record<ButtonVariant, string> = {
    primary:
      'bg-brand text-on-strong hover:bg-brand-hover active:bg-brand-active shadow-sm border border-brand',
    secondary:
      'bg-inverse text-on-strong hover:bg-inverse-hover active:bg-inverse-active shadow-sm border border-inverse',
    outline:
      'bg-surface text-fg-muted border border-line-strong hover:bg-surface-sunken hover:text-fg active:bg-surface-muted shadow-xs',
    subtle:
      'bg-surface-muted text-fg hover:bg-surface-strong active:bg-surface-strong border border-line/80',
    ghost:
      'bg-transparent text-fg-muted hover:bg-surface-muted hover:text-fg active:bg-surface-strong',
    danger:
      'bg-danger text-on-strong hover:bg-danger-hover active:bg-danger-active shadow-sm border border-danger',
  };

  const isDisabled = disabled || isLoading;

  return (
    <button
      disabled={isDisabled}
      aria-busy={isLoading}
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-current shrink-0" aria-label="Loading" />
      ) : (
        iconLeft && <span className="shrink-0">{iconLeft}</span>
      )}
      <span>{children}</span>
      {!isLoading && iconRight && <span className="shrink-0">{iconRight}</span>}
    </button>
  );
};
