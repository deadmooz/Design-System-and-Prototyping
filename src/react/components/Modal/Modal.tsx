import React from 'react';

export type ModalVariant = 'center' | 'bottomSheet';

export interface ModalProps {
  open: boolean;
  /** Called on Escape and on overlay click. */
  onClose?: () => void;
  variant?: ModalVariant;
  title?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Dialog: `center` for confirmations, `bottomSheet` for mobile action sheets.
 *
 * @example
 * <Modal open title="Delete project?" onClose={close} actions={<Button variant="destructive">Delete</Button>}>
 *   This cannot be undone.
 * </Modal>
 */
export function Modal({ open, onClose, variant = 'center', title, children, actions }: ModalProps) {
  const titleId = React.useId();
  React.useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const bottom = variant === 'bottomSheet';
  return (
    <div
      className={bottom ? 'ds-modal-overlay ds-modal-overlay--bottom' : 'ds-modal-overlay'}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={bottom ? 'ds-modal ds-modal--bottomSheet' : 'ds-modal'} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
        {title && <h3 className="ds-modal__title" id={titleId}>{title}</h3>}
        <div className="ds-modal__body">{children}</div>
        {actions && <div className="ds-modal__actions">{actions}</div>}
      </div>
    </div>
  );
}
