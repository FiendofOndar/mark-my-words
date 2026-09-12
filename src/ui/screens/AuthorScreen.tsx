import { Link, useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Icon } from '../components/Icon';
import { secondaryButton } from '../components/Field';
import { PredictionRow } from '../components/PredictionRow';
import { useAuthorPage } from '../queries';
import { MIN_SCORED_TO_RANK, formatHeadline, formatRate, formatRecord } from '../../domain/scoring';
import { ScorecardCard } from '../../receipts/ReceiptCard';
import { useReceipt } from '../../receipts/useReceipt';

export function AuthorScreen() {
  const { id } = useParams<{ id: string }>();
  const { data } = useAuthorPage(id);
  const receipt = useReceipt();

  if (!data) {
    return (
      <Screen title="Not found" back>
        <p className="px-5 py-10 text-center text-ink-dim">No such author.</p>
      </Screen>
    );
  }

  const { author, record, items, firstSeen } = data;

  return (
    <Screen
      title={author.displayName}
      subtitle={record.ranked ? `${formatRecord(record)} · ${formatRate(record)}` : formatRecord(record)}
      back
    >
      <section className="border-b border-rule px-5 py-5">
        <div className="flex items-baseline gap-5">
          {/* The rate only appears once it is allowed to mean something. An
              author 1-0 headlined as "100%" is the cherry-picked number the
              five-call threshold exists to refuse, printed directly above the
              sentence explaining the threshold. */}
          <span className="font-display text-5xl tabular-nums">
            {formatHeadline(record)}
          </span>
          <span className="text-[14px] text-ink-dim">
            {record.scored} settled
            {record.open > 0 && ` · ${record.open} running`}
            {record.lateHits > 0 && ` · ${record.lateHits} late`}
          </span>
        </div>
        {!record.ranked && record.scored > 0 && (
          <p className="mt-2 text-[12px] text-ink-faint">
            A rate needs {MIN_SCORED_TO_RANK} settled calls, so one lucky guess cannot stand as a
            record.
          </p>
        )}

        <button
          type="button"
          onClick={() =>
            receipt.generate(
              <ScorecardCard author={author} record={record} since={firstSeen} />,
              author.displayName,
              'scorecard',
            )
          }
          disabled={receipt.state === 'rendering'}
          className={`${secondaryButton} mt-4 min-h-11 px-4 text-[13px]`}
        >
          {receipt.state === 'rendering' ? 'Making the card...' : 'Share the record'}
        </button>
        {receipt.error && <p className="mt-2 text-[12px] text-miss">{receipt.error}</p>}
        {receipt.state === 'downloaded' && (
          <p className="mt-2 text-[12px] text-ink-faint">Saved to your downloads.</p>
        )}
      </section>

      {items.length === 0 ? (
        <p className="px-8 py-16 text-center font-display text-lg text-ink-dim italic">
          Nothing on the record for {author.displayName} yet.
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.prediction.id}>
              <PredictionRow item={item} />
            </li>
          ))}
        </ul>
      )}

      {/* A 13px faint link floating in the empty space below the list was both
          hard to see and hard to hit. It is the only way out of this screen
          other than back, so it gets the same row treatment as everything else. */}
      <Link
        to="/standings"
        className="flex items-center justify-between border-b border-rule px-5 py-4 text-[14px] text-ink-dim active:bg-surface-raised"
      >
        See the full standings
        <Icon name="chevron" size={18} className="text-ink-faint" />
      </Link>
    </Screen>
  );
}
