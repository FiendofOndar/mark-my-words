import { Link } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { useStandings } from '../queries';
import { MIN_SCORED_TO_RANK, formatRate, formatRecord } from '../../domain/scoring';

export function StandingsScreen() {
  const { data = [] } = useStandings();
  const ranked = data.filter((s) => s.record.ranked);
  const rest = data.filter((s) => !s.record.ranked);

  return (
    <Screen title="Standings" subtitle="Hit rate, with volume shown" back>
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
                  <Link to={`/?author=${standing.author.id}`} className="font-display text-[17px]">
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

      <section className="px-5 py-6">
        <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
          Not enough data
        </h2>
        <p className="mt-1 text-[13px] text-ink-faint">
          Needs {MIN_SCORED_TO_RANK} settled predictions to be ranked.
        </p>
        <ul className="mt-3 space-y-2">
          {rest.map((standing) => (
            <li key={standing.author.id} className="flex items-baseline justify-between gap-3">
              <span className="font-display text-[17px]">{standing.author.displayName}</span>
              <span className="text-[13px] tabular-nums text-ink-faint">
                {formatRecord(standing.record)} · {standing.record.open} open
                {standing.record.lateHits > 0 && ` · ${standing.record.lateHits} late`}
              </span>
            </li>
          ))}
          {rest.length === 0 && <li className="text-[13px] text-ink-faint italic">Nobody yet.</li>}
        </ul>
      </section>
    </Screen>
  );
}
