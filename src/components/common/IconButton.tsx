import React from 'react';

export type IconButtonVariant = 'ghost' | 'danger' | 'brand';
export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Required: an icon has no text, so this is the button's only name for screen readers. */
  label: string;
  icon: React.ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-fg-subtle hover:text-fg hover:bg-surface-muted',
  danger: 'text-fg-subtle hover:text-danger-fg hover:bg-danger-soft',
  brand: 'text-brand-fg hover:text-brand-emphasis bg-brand-soft hover:bg-brand-soft/70',
};

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
};

export const IconButton: React.FC<IconButtonProps> = ({
  label,
  icon,
  variant = 'ghost',
  size = 'sm',
  className = '',
  type = 'button',
  title,
  ...props
}) => (
  <button
    type={type}
    aria-label={label}
    title={title ?? label}
    className={`inline-flex items-center justify-center shrink-0 rounded-control transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    {...props}
  >
    <span aria-hidden="true" className="inline-flex">
      {icon}
    </span>
  </button>
);
