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
 * on color alone.
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
      ? 'px-5 py-2 text-2xl'
      : size === 'sm'
        ? 'px-2 py-0.5 text-[11px]'
        : 'px-3 py-1 text-sm';

  return (
    <span
      className={`stamp ${tilt ? 'stamp-tilt' : ''} ${STATUS_TONE[status]} ${scale} inline-block font-semibold opacity-90`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function LateBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-late/50 bg-late/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-late">
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
    warn: 'border-partial/50 text-partial',
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
