import type { AuthorRecord } from '../../domain/scoring';

/**
 * A record, "8-4-1", with each number in its verdict's colour: hits green,
 * misses red, splits amber. The order is the standings convention; the
 * colour is what lets the eye read it without counting dashes. The third
 * number only appears once there is a split to show, same as formatRecord.
 */
export function RecordMark({ record, className = '' }: { record: AuthorRecord; className?: string }) {
  return (
    <span className={`tabular-nums ${className}`}>
      <span className="text-hit">{record.hit}</span>
      <span className="text-ink-faint">-</span>
      <span className="text-miss">{record.miss}</span>
      {record.partial > 0 && (
        <>
          <span className="text-ink-faint">-</span>
          <span className="text-partial">{record.partial}</span>
        </>
      )}
    </span>
  );
}
