import React from 'react';

export interface SpinnerProps {
  /** Diameter in pixels. */
  size?: number;
  label?: string;
  className?: string;
}

/**
 * Inline loading indicator.
 *
 * @example
 * <Spinner size={20} />
 */
export function Spinner({ size = 20, label = 'Loading', className }: SpinnerProps) {
  const classes = ['ds-spinner', className].filter(Boolean).join(' ');
  return <span className={classes} role="status" aria-label={label} style={{ width: size, height: size }} />;
}
