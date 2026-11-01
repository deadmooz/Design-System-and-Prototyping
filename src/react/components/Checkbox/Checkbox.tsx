import React from 'react';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: React.ReactNode;
}

/**
 * Labelled checkbox. Works controlled (`checked`) or uncontrolled (`defaultChecked`).
 *
 * @example
 * <Checkbox label="I agree to the terms" defaultChecked />
 */
export function Checkbox({ label, disabled, className, ...rest }: CheckboxProps) {
  const classes = ['ds-checkbox', disabled && 'ds-checkbox--disabled', className].filter(Boolean).join(' ');
  return (
    <label className={classes}>
      <input type="checkbox" disabled={disabled} {...rest} />
      {label}
    </label>
  );
}
