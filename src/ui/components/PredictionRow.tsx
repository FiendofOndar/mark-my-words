import { Link } from 'react-router-dom';
import type { FeedItem } from '../queries';
import { awaitsUser } from '../queries';
import { Stamp, LateBadge, Pill } from './Stamp';
import { TrendMark } from './TrendMark';
import { formatCountdown, formatLateBadge } from '../../domain/format';
import { isResolved } from '../../domain/prediction';

export function PredictionRow({ item }: { item: FeedItem }) {
  const p = item.prediction;
  const late = formatLateBadge(p);
  const needsYou = awaitsUser(p);

  return (
    <Link
      to={`/p/${p.id}`}
      className="paper block border-b border-rule bg-surface px-4 py-4 transition-colors active:bg-surface-raised"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13px] font-medium text-ink-dim">
          {item.author.displayName}
          {item.author.handle && (
            <span className="text-ink-faint"> · {item.author.handle}</span>
          )}
        </span>
        {isResolved(p.status) ? (
          <Stamp status={p.status} size="sm" tilt={false} />
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-dim">
            <TrendMark trend={p.trend} />
            {formatCountdown(p)}
          </span>
        )}
      </div>

      {/* The quote marks live inside the clamp; line-clamp is display:-webkit-box,
          so sibling spans would each take their own line. */}
      <p className="mt-2 line-clamp-3 font-display text-[17px] leading-snug text-ink">
        <span className="text-ink-faint">&ldquo;</span>
        {p.rawStatement}
        <span className="text-ink-faint">&rdquo;</span>
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {needsYou && <Pill tone="warn">Needs you</Pill>}
        {p.status === 'draft' && <Pill tone="warn">Draft</Pill>}
        {late && <LateBadge label={late} />}
        {p.verificationMode === 'manual' && <Pill tone="muted">You decide</Pill>}
        {p.forceManual && p.verificationMode === 'searchable' && (
          <Pill tone="muted">Manual check</Pill>
        )}
        {item.amendmentCount > 0 && (
          <Pill tone="warn" title={`${item.amendmentCount} amendment(s) on record`}>
            Amended
          </Pill>
        )}
        {p.isRetroactive && <Pill tone="muted">After the fact</Pill>}
        {p.stakes && <Pill>{p.stakes}</Pill>}
        <Pill tone="muted">{p.category}</Pill>
      </div>
    </Link>
  );
}
