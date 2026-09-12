import { Link } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { useStandings, type Standing } from '../queries';
import { MIN_SCORED_TO_RANK, formatRate, formatRecord } from '../../domain/scoring';

/**
 * What an unranked author has so far.
 *
 * Deliberately no hit rate. A 1-0 record printed as "100%" is the cherry-picked
 * number the ranking threshold exists to refuse, and putting it on the row said
 * the opposite of what the paragraph above the list says.
 */
function describeProgress(standing: Standing): string {
  const parts = [formatRecord(standing.record)];
  if (standing.record.open > 0) parts.push(`${standing.record.open} running`);
  if (standing.record.lateHits > 0) parts.push(`${standing.record.lateHits} late`);
  return parts.join(' · ');
}

/**
 * How close this author is to being ranked at all.
 *
 * The unranked list is where everyone sits for the first months of using this,
 * so it is worth saying what is actually missing. A record of "0-1 · 1 running"
 * does not answer "when does this person get a rank"; five pips do.
 */
function RankProgress({ scored }: { scored: number }) {
  const filled = Math.min(scored, MIN_SCORED_TO_RANK);
  const label = `${scored} of ${MIN_SCORED_TO_RANK} settled calls toward a rank`;

  return (
    <span className="flex shrink-0 items-center gap-1" title={label} aria-label={label}>
      {Array.from({ length: MIN_SCORED_TO_RANK }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i < filled ? 'bg-ink-dim' : 'bg-rule'}`}
        />
      ))}
    </span>
  );
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
                  className="flex min-h-14 items-center justify-between gap-3 border-b border-rule/60 py-2 active:bg-surface-raised"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[17px]">
                      {standing.author.displayName}
                    </span>
                    <span className="block text-[12px] text-ink-faint">
                      {describeProgress(standing)}
                    </span>
                  </span>
                  <RankProgress scored={standing.record.scored} />
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
