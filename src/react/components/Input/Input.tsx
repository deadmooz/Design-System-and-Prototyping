import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label shown above the control. */
  label?: string;
  /** Helper or error text shown below the control. */
  hint?: string;
  /** Marks the field invalid — border and hint switch to the error token. */
  error?: boolean;
}

/**
 * Labelled text field.
 *
 * @example
 * <Input label="Email" type="email" placeholder="you@example.com" />
 * <Input label="Code" error hint="Enter the 6-digit code" />
 */
export function Input({ label, hint, error, id, className, ...rest }: InputProps) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const classes = ['ds-field', error && 'ds-field--error', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      {label && <label className="ds-field__label" htmlFor={inputId}>{label}</label>}
      <input id={inputId} className="ds-field__control" aria-invalid={error || undefined} aria-describedby={hintId} {...rest} />
      {hint && <span className="ds-field__hint" id={hintId}>{hint}</span>}
    </div>
  );
}
