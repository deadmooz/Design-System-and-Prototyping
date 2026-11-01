import React from 'react';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  /** Image source. Falls back to `initials` when missing or failing to load. */
  src?: string;
  initials?: string;
  alt?: string;
  size?: AvatarSize;
  className?: string;
}

/**
 * Profile image with an initials fallback.
 *
 * @example
 * <Avatar initials="AK" />
 */
export function Avatar({ src, initials, alt, size = 'md', className }: AvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const showImage = Boolean(src) && !failed;
  const classes = ['ds-avatar', size !== 'md' && `ds-avatar--${size}`, className].filter(Boolean).join(' ');
  return (
    <span className={classes} role={showImage ? undefined : 'img'} aria-label={showImage ? undefined : alt ?? initials}>
      {showImage ? <img src={src} alt={alt ?? initials ?? ''} onError={() => setFailed(true)} /> : initials}
    </span>
  );
}
