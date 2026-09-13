import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { primaryButton, secondaryButton } from './Field';

/**
 * An in-app overlay. Portalled to body so it sits above the fixed header and
 * outside any scroller; never rasterized, so `position: fixed` is fine here.
 *
 * Not the WebView's confirm(): that dialog carries the site's origin in its
 * title bar and looks like a scam to anyone who has seen one.
 */
export function Modal({
  open,
  onClose,
  children,
  align = 'center',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Sheets rise from the bottom; questions sit in the middle. */
  align?: 'center' | 'bottom';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-ground/70 p-4 ${
        align === 'bottom' ? 'items-end pb-[max(1rem,env(safe-area-inset-bottom))]' : 'items-center'
      }`}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-rule bg-surface p-4 shadow-lg"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Are you sure?" with the consequence spelled out. The confirming button
 * carries the verb, never "OK", so the question and the answer read as one.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel}>
      <h2 className="font-display text-[19px] font-semibold text-ink">{title}</h2>
      {body && <p className="mt-2 text-[13.5px] leading-relaxed text-prose-dim">{body}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryButton} min-h-11 px-4 text-[13px]`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={
            danger
              ? 'min-h-11 rounded-lg border border-miss/60 bg-miss/10 px-4 font-display text-[13px] font-semibold tracking-wide text-miss active:bg-miss/20'
              : `${primaryButton} min-h-11 px-4 text-[13px]`
          }
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export interface SheetAction {
  label: string;
  onSelect: () => void;
  tone?: 'normal' | 'danger';
}

/** A short list of things to do with one item, risen from the bottom edge. */
export function ActionSheet({
  open,
  title,
  actions,
  onClose,
}: {
  open: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} align="bottom">
      {title && (
        <p className="mb-2 line-clamp-2 font-quote text-[15px] font-semibold text-ink-dim italic">{title}</p>
      )}
      <ul className="divide-y divide-rule">
        {actions.map((action) => (
          <li key={action.label}>
            <button
              type="button"
              onClick={() => {
                onClose();
                action.onSelect();
              }}
              className={`block min-h-12 w-full py-3 text-left font-display text-[16px] tracking-wide active:bg-surface-raised ${
                action.tone === 'danger' ? 'text-miss' : 'text-ink'
              }`}
            >
              {action.label}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClose}
        className={`${secondaryButton} mt-3 min-h-11 w-full px-4 text-[13px]`}
      >
        Cancel
      </button>
    </Modal>
  );
}
