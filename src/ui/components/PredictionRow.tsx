import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FeedItem } from '../queries';
import { awaitsUser, useDeletePrediction, useTogglePin } from '../queries';
import { useLongPress } from '../useLongPress';
import { ActionSheet, ConfirmDialog } from './Modal';
import { Stamp, LateBadge, Pill } from './Stamp';
import { TrendMark } from './TrendMark';
import { formatCountdown, formatLateBadge } from '../../domain/format';
import { daysUntilDeadline, isResolved } from '../../domain/prediction';
import type { Prediction } from '../../domain/types';

/**
 * How loudly a row should speak.
 *
 * Carried by the countdown's colour and the weight of the quote. A coloured
 * left edge used to carry it too, and with the countdown already red the
 * second signal was noise: the owner asked for it gone.
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

  const navigate = useNavigate();
  const remove = useDeletePrediction();
  const togglePin = useTogglePin();
  const pinned = p.pinnedAt !== null;
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const hold = useLongPress(() => setMenu(true));
  const href = p.status === 'draft' ? `/draft/${p.id}` : `/p/${p.id}`;

  const marks = [
    pinned && (
      <Pill key="pinned" tone="muted" title="Held at the top of the feed">
        Pinned
      </Pill>
    ),
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
    <>
    <Link
      // A draft has nothing to show on a detail screen yet; send it to the
      // review card so the next tap finishes the job.
      to={href}
      {...hold}
      // Press and hold opens the menu; the browser's own long-press menu and
      // text selection would fight it.
      className="block border-b border-b-rule px-4 py-4 transition-colors select-none active:bg-surface-raised [-webkit-touch-callout:none]"
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
          <Stamp status={p.status} size="sm" tilt={false} />
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

    <ActionSheet
      open={menu}
      onClose={() => setMenu(false)}
      title={p.rawStatement}
      actions={[
        { label: p.status === 'draft' ? 'Finish it' : 'Open', onSelect: () => navigate(href) },
        {
          label: pinned ? 'Unpin' : 'Pin to top',
          onSelect: () => togglePin.mutate({ id: p.id, pinned: !pinned }),
        },
        ...(p.status === 'draft'
          ? []
          : [{ label: 'Amend the claim', onSelect: () => navigate(`${href}?amend=1`) }]),
        { label: 'Delete', tone: 'danger' as const, onSelect: () => setConfirming(true) },
      ]}
    />
    <ConfirmDialog
      open={confirming}
      title="Delete this prediction?"
      body="It comes off the record, along with its checks and its place in the standings."
      confirmLabel="Delete"
      danger
      onCancel={() => setConfirming(false)}
      onConfirm={() => {
        setConfirming(false);
        remove.mutate(p.id);
      }}
    />
    </>
  );
}
