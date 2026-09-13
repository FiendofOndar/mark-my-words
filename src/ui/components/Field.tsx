import type { ReactNode } from 'react';

/**
 * A labelled form row.
 *
 * `<label>` may only wrap a single control, so anything holding a group of
 * controls (a segmented control, a repeating list, two inputs) renders as a
 * labelled group instead. Wrapping a group in a label breaks both the click
 * target and the accessible name of every control inside it.
 */
export function Field({
  label,
  hint,
  group = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  group?: boolean;
  children: ReactNode;
}) {
  const body = (
    <>
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-prose-faint">{hint}</p>}
    </>
  );

  if (group) {
    return (
      <div role="group" aria-label={label} className="block">
        {body}
      </div>
    );
  }

  return <label className="block">{body}</label>;
}

export const inputClass =
  'w-full rounded-lg border border-rule bg-ink/[0.04] px-3 py-2.5 text-[15px] outline-none focus:border-ink-dim';

/**
 * The filled action. One per screen.
 *
 * Accent rather than cream. The accent went near-neutral precisely so it could
 * carry fills without competing with a verdict, and this is the fill it exists
 * for. Ground-coloured text on it, never ink: the accent is too light to hold
 * cream at any weight.
 *
 * Disabled swaps to a surface token rather than diluting the fill. Both
 * `opacity-40` and `bg-ink/20` end up as the same muddy grey rectangle, which
 * reads as pressed rather than as unavailable, and the grey belongs to neither
 * palette. Three screens each grew their own copy of this button and all three
 * had the bug.
 */
export const primaryButton =
  'rounded-lg bg-accent font-display font-semibold tracking-wide text-ground disabled:border disabled:border-rule disabled:bg-surface-raised disabled:font-normal disabled:text-ink-faint';

/**
 * The outlined action. `border-rule` is already faint, so the disabled state
 * leaves the outline alone and dims only the label; at 40% opacity the whole
 * thing disappeared and the button looked like stray text.
 */
export const secondaryButton =
  'rounded-lg border border-rule font-display tracking-wide text-ink-dim active:bg-surface-raised disabled:text-ink-faint';

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-11 flex-1 rounded-lg border px-3 py-2 font-sans text-[14px] font-semibold tracking-wide uppercase transition-colors ${
            value === option.value
              ? 'border-accent bg-accent text-ground'
              : 'border-rule text-ink-dim active:bg-surface-raised'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
