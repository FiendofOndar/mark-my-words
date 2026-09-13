import { Link } from 'react-router-dom';
import type { FeedItem } from '../queries';
import { awaitsUser } from '../queries';
import { Stamp, LateBadge, Pill } from './Stamp';
import { TrendMark } from './TrendMark';
import { formatCountdown, formatLateBadge } from '../../domain/format';
import { daysUntilDeadline, isResolved } from '../../domain/prediction';
import type { Prediction } from '../../domain/types';

/**
 * How loudly a row should speak.
 *
 * Every row used to look the same, so a prediction that expired yesterday sat
 * quietly among ones due next year. The state a row is in is the most useful
 * thing about it, so it gets carried by the edge marker, the countdown's colour
 * and the weight of the quote rather than by one small chip.
 */
type Urgency = 'overdue' | 'soon' | 'waiting' | 'settled' | 'draft' | 'calm';

function urgencyOf(p: Prediction, needsYou: boolean, queued: boolean): Urgency {
  if (p.status === 'draft') return 'draft';
  if (isResolved(p.status)) return 'settled';
  if (queued || needsYou) return 'waiting';

  const days = daysUntilDeadline(p);
  if (days !== null && days < 0) return 'overdue';
  if (days !== null && days <= 7) return 'soon';
  return 'calm';
}

const EDGE: Record<Urgency, string> = {
  overdue: 'border-l-miss',
  soon: 'border-l-attention',
  waiting: 'border-l-attention',
  draft: 'border-l-draft',
  settled: 'border-l-transparent',
  calm: 'border-l-transparent',
};

const COUNTDOWN: Record<Urgency, string> = {
  overdue: 'text-miss font-medium',
  soon: 'text-attention font-medium',
  waiting: 'text-attention font-medium',
  draft: 'text-draft',
  settled: 'text-ink-faint',
  calm: 'text-ink-dim',
};

export function PredictionRow({ item }: { item: FeedItem }) {
  const p = item.prediction;
  const late = formatLateBadge(p);
  const needsYou = awaitsUser(p, new Date(), Boolean(item.hasQueuedVerdict));
  const urgency = urgencyOf(p, needsYou, Boolean(item.hasQueuedVerdict));
  const settled = urgency === 'settled';

  const marks = [
    item.hasQueuedVerdict && (
      <Pill key="queued" tone="warn">
        Verdict ready
      </Pill>
    ),
    needsYou && !item.hasQueuedVerdict && (
      <Pill key="needs" tone="warn">
        Needs you
      </Pill>
    ),
    late && <LateBadge key="late" label={late} />,
    item.amendmentCount > 0 && (
      <Pill key="amended" tone="warn" title={`${item.amendmentCount} amendment(s) on record`}>
        Amended
      </Pill>
    ),
    p.stakes && <Pill key="stakes">{p.stakes}</Pill>,
  ].filter(Boolean);

  return (
    <Link
      // A draft has nothing to show on a detail screen yet; send it to the
      // review card so the next tap finishes the job.
      to={p.status === 'draft' ? `/draft/${p.id}` : `/p/${p.id}`}
      className={`block border-b border-l-2 border-b-rule py-4 pr-4 pl-3.5 transition-colors active:bg-surface-raised ${EDGE[urgency]}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`truncate font-sans text-[14px] font-semibold tracking-wider uppercase ${
            settled ? 'text-ink-faint' : 'text-ink-dim'
          }`}
        >
          {item.author.displayName}
          {item.author.handle && <span className="text-ink-faint"> · {item.author.handle}</span>}
        </span>

        {settled ? (
          <Stamp status={p.status} size="sm" />
        ) : (
          <span
            className={`flex shrink-0 items-center gap-1.5 text-[12.5px] ${COUNTDOWN[urgency]}`}
          >
            <TrendMark trend={p.trend} />
            {p.status === 'draft' ? 'Unfinished' : formatCountdown(p)}
          </span>
        )}
      </div>

      {/* The quote marks live inside the clamp; line-clamp is display:-webkit-box,
          so sibling spans would each take their own line. A settled prediction
          steps back so live ones carry the scan. */}
      <p
        className={`mt-2 line-clamp-3 font-quote text-[19px] leading-snug font-semibold ${
          settled ? 'text-ink-dim' : 'text-ink'
        }`}
      >
        <span className="text-ink-faint">&ldquo;</span>
        {p.rawStatement}
        <span className="text-ink-faint">&rdquo;</span>
      </p>

      {/* Only what the row does not already say, and only when there is
          something to say. Category lives in the filter chips, so carrying it
          on every row cost a line of height and told you nothing. */}
      {marks.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{marks}</div>
      )}
    </Link>
  );
}
