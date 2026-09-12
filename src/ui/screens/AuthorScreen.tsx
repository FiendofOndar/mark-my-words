import { Link, useParams } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { PredictionRow } from '../components/PredictionRow';
import { useAuthorPage } from '../queries';
import { formatRate, formatRecord } from '../../domain/scoring';
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
      subtitle={`${formatRecord(record)} · ${formatRate(record)}`}
      back
    >
      <section className="border-b border-rule px-5 py-5">
        <div className="flex items-baseline gap-5">
          <span className="font-display text-5xl tabular-nums">{formatRate(record)}</span>
          <span className="text-[14px] text-ink-dim">
            {record.scored} settled
            {record.open > 0 && ` · ${record.open} running`}
            {record.lateHits > 0 && ` · ${record.lateHits} late`}
          </span>
        </div>
        {!record.ranked && record.scored > 0 && (
          <p className="mt-2 text-[12px] text-ink-faint">
            Not ranked yet. Needs five settled calls.
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
          className="mt-4 rounded border border-rule min-h-11 px-4 text-[13px] text-ink-dim disabled:opacity-40"
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
        <ul className="pb-10">
          {items.map((item) => (
            <li key={item.prediction.id}>
              <PredictionRow item={item} />
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 pb-8">
        <Link to="/standings" className="text-[13px] text-ink-faint underline-offset-2 hover:underline">
          See the full standings
        </Link>
      </div>
    </Screen>
  );
}
