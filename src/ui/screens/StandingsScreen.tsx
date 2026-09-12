import { Link } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { useStandings, type Standing } from '../queries';
import { MIN_SCORED_TO_RANK, formatRate, formatRecord } from '../../domain/scoring';

/** Record first, then whatever else is worth saying. Zeroes are left out. */
function describeProgress(standing: Standing): string {
  const parts = [formatRecord(standing.record)];
  if (standing.record.rate !== null) parts.push(formatRate(standing.record));
  if (standing.record.open > 0) parts.push(`${standing.record.open} running`);
  if (standing.record.lateHits > 0) parts.push(`${standing.record.lateHits} late`);
  return parts.join(' · ');
}

export function StandingsScreen() {
  const { data = [] } = useStandings();
  const ranked = data.filter((s) => s.record.ranked);
  const rest = data.filter((s) => !s.record.ranked);

  const anyScored = data.some((s) => s.record.scored > 0);

  return (
    <Screen
      title="Standings"
      subtitle={
        ranked.length > 0
          ? 'Hit rate, with volume shown'
          : anyScored
            ? `Nobody has ${MIN_SCORED_TO_RANK} settled calls yet`
            : 'Nothing has been settled yet'
      }
      back
    >
      {ranked.length > 0 && (
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-rule text-[11px] tracking-wide text-ink-faint uppercase">
              <th className="px-5 py-2 text-left font-semibold">#</th>
              <th className="py-2 text-left font-semibold">Who</th>
              <th className="py-2 text-right font-semibold">Record</th>
              <th className="px-5 py-2 text-right font-semibold">Rate</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((standing, index) => (
              <tr key={standing.author.id} className="border-b border-rule">
                <td className="px-5 py-3 text-ink-faint">{index + 1}</td>
                <td className="py-3">
                  <Link
                    to={`/author/${standing.author.id}`}
                    className="flex min-h-11 items-center font-display text-[17px]"
                  >
                    {standing.author.displayName}
                  </Link>
                </td>
                <td className="py-3 text-right tabular-nums text-ink-dim">
                  {formatRecord(standing.record)}
                </td>
                <td className="px-5 py-3 text-right font-display text-[17px] tabular-nums">
                  {formatRate(standing.record)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rest.length > 0 && (
        <section className="px-5 py-6">
          <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
            {ranked.length > 0 ? 'Still building a record' : 'On the board'}
          </h2>
          <p className="mt-1 text-[13px] text-ink-faint">
            A rank needs {MIN_SCORED_TO_RANK} settled calls, so one lucky guess cannot top the
            table.
          </p>
          <ul className="mt-3">
            {rest.map((standing) => (
              <li key={standing.author.id}>
                <Link
                  to={`/author/${standing.author.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 border-b border-rule/60"
                >
                  <span className="font-display text-[17px]">{standing.author.displayName}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-ink-faint">
                    {describeProgress(standing)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.length === 0 && (
        <p className="px-8 py-16 text-center font-display text-lg text-ink-dim italic">
          Nobody is on the record yet.
        </p>
      )}
    </Screen>
  );
}
