import type { Trend } from '../../domain/types';

const MARKS: Record<Trend, { glyph: string; label: string; tone: string } | null> = {
  toward_yes: { glyph: '↗', label: 'Trending toward yes', tone: 'text-hit' },
  toward_no: { glyph: '↘', label: 'Trending toward no', tone: 'text-miss' },
  flat: { glyph: '→', label: 'No movement', tone: 'text-ink-faint' },
  // Nothing has been checked yet, so there is no trend to show. A glyph here
  // reads as a typo next to the countdown.
  unknown: null,
};

export function TrendMark({ trend }: { trend: Trend | null }) {
  if (!trend) return null;
  const mark = MARKS[trend];
  if (!mark) return null;
  return (
    <span className={`${mark.tone} text-sm`} title={mark.label} aria-label={mark.label}>
      {mark.glyph}
    </span>
  );
}
