import React from 'react';

export type CardVariant = 'default' | 'muted' | 'interactive';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `default` bordered + shadow, `muted` tinted without shadow, `interactive` lifts on hover. */
  variant?: CardVariant;
}

/**
 * Content container.
 *
 * @example
 * <Card variant="interactive">Open project</Card>
 */
export function Card({ variant = 'default', className, ...rest }: CardProps) {
  const classes = ['ds-card', variant !== 'default' && `ds-card--${variant}`, className].filter(Boolean).join(' ');
  return <div className={classes} {...rest} />;
}
