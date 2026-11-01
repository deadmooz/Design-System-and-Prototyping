import React from 'react';

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/**
 * Status pill.
 *
 * @example
 * <Badge variant="success">Active</Badge>
 */
export function Badge({ variant = 'neutral', className, ...rest }: BadgeProps) {
  const classes = ['ds-badge', variant !== 'neutral' && `ds-badge--${variant}`, className].filter(Boolean).join(' ');
  return <span className={classes} {...rest} />;
}
