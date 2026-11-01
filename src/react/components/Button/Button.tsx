import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Colors come from the active design system's tokens. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner before the label and disables the button. */
  loading?: boolean;
  /** Icon rendered before the label. */
  icon?: React.ReactNode;
  block?: boolean;
}

/**
 * Primary action control. Radius, padding and weight follow the extracted design system.
 *
 * @example
 * <Button variant="primary">Get started</Button>
 * <Button variant="outline" size="sm">Share</Button>
 */
export function Button({ variant = 'primary', size = 'md', loading = false, block, icon, disabled, children, className, ...rest }: ButtonProps) {
  const classes = ['ds-btn', `ds-btn--${variant}`, size !== 'md' && `ds-btn--${size}`, block && 'ds-btn--block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="ds-spinner" style={{ width: 14, height: 14 }} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
