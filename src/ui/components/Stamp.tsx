import type { PredictionStatus } from '../../domain/types';
import { STATUS_LABEL } from '../../domain/format';

/** Border and text for a status, shared with anything that offers a verdict. */
export const STATUS_TONE: Record<PredictionStatus, string> = {
  hit: 'text-hit border-hit',
  miss: 'text-miss border-miss',
  partial: 'text-partial border-partial',
  ambiguous: 'text-ambiguous border-ambiguous',
  void: 'text-voided border-voided line-through',
  open: 'text-ink-dim border-rule',
  draft: 'text-draft border-draft',
};

/**
 * The verdict, stamped. Carries its own text label so the meaning never rests
 * on color alone. Tilted by default, level where it sits in a column: see the
 * note on `.stamp` in styles.css.
 *
 * Each size sets a min-width from the longest word it has to hold, UNCLEAR.
 * Letting the tag shrink to fit gave the feed a ragged right edge, and the
 * rows are built on a tabular rhythm that only works if the column is a
 * column.
 */
export function Stamp({
  status,
  size = 'md',
  tilt = true,
}: {
  status: PredictionStatus;
  size?: 'sm' | 'md' | 'lg';
  tilt?: boolean;
}) {
  const scale =
    size === 'lg'
      ? 'min-w-[132px] px-5 py-2 text-2xl'
      : size === 'sm'
        ? 'min-w-[68px] px-2 py-[3px] text-[11.5px]'
        : 'min-w-[86px] px-3 py-1 text-[14px]';

  // Open and Draft are not verdicts, they are states, so they stay in the mono
  // voice the rest of a row's metadata uses rather than shouting in Oswald.
  const voice = status === 'open' || status === 'draft' ? 'font-mono font-medium tracking-normal' : '';

  return (
    <span className={`stamp ${tilt ? 'stamp-tilt' : ''} ${STATUS_TONE[status]} ${scale} ${voice} inline-block`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function LateBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-late/50 bg-late/10 px-2.5 py-0.5 font-sans text-[12px] font-semibold tracking-wide text-late uppercase">
      <span aria-hidden>★</span>
      {label}
    </span>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  title,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warn' | 'muted';
  title?: string;
}) {
  const tones = {
    neutral: 'border-rule text-ink-dim',
    // An ask, not a verdict: attention amber rather than --color-partial, which
    // is the Split verdict and once made a warning read as "partially true".
    warn: 'border-attention/50 text-attention',
    muted: 'border-rule/60 text-ink-faint',
  };
  return (
    <span
      title={title}
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
