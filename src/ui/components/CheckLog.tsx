import type { Check, Evidence, FetchStatus } from '../../domain/types';
import type { CheckLogEntry } from '../queries';
import { formatDate } from '../../domain/format';
import { Pill } from './Stamp';
import { Bullets } from './Bullets';

const FETCH_LABEL: Record<FetchStatus, { glyph: string; label: string; tone: string }> = {
  ok: { glyph: '✓', label: 'Quote found on the page', tone: 'text-hit' },
  quote_not_found: { glyph: '!', label: 'Page loaded, quote not found', tone: 'text-partial' },
  blocked: { glyph: '–', label: 'Could not read the page', tone: 'text-ink-faint' },
  unreachable: { glyph: '✕', label: 'Link did not resolve', tone: 'text-miss' },
};

const OUTCOME_LABEL: Record<Check['outcome'], string> = {
  auto_resolved: 'Resolved',
  queued: 'Waiting on you',
  no_change: 'No change',
  error: 'Failed',
};

export function CheckLog({ entries }: { entries: CheckLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-3 text-[14px] text-ink-faint italic">
        No checks run yet. Pull down on the feed to check what is due.
      </p>
    );
  }

  return (
    <ol className="mt-3 space-y-5">
      {entries.map(({ check, evidence }) => (
        <li key={check.id} className="border-l border-rule pl-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[13px] text-ink-faint">{formatDate(check.ranAt)}</span>
            <Pill tone={check.outcome === 'error' ? 'warn' : 'muted'}>
              {OUTCOME_LABEL[check.outcome]}
            </Pill>
            {check.rubricScore !== null && <ScoreChip check={check} />}
          </div>

          <p className="mt-1.5 text-[15px] leading-snug text-ink-dim">{check.summary}</p>

          {/* The provider's own words, verbatim. A summarized failure is a
              failure you have to guess at. */}
          {check.errorMessage && check.errorMessage !== check.summary && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[12px] text-ink-faint">
                What the provider said
              </summary>
              <pre className="mt-1.5 max-h-64 overflow-auto rounded border border-rule bg-surface p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-faint">
                {check.errorMessage}
              </pre>
            </details>
          )}

          {evidence.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {evidence.map((source) => (
                <EvidenceRow key={source.id} source={source} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function ScoreChip({ check }: { check: Check }) {
  const breakdown = parseBreakdown(check.rubricBreakdown);
  const gates = breakdown?.gates ?? [];

  return (
    <details className="w-full">
      {/* A summary is display:list-item, so once the details opened inside a
          flex row the pill stretched the full width and read as an empty input
          box rather than as a score. */}
      <summary className="inline-flex w-fit cursor-pointer list-none rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-dim">
        {check.rubricScore}/100
      </summary>
      <div className="mt-2 rounded border border-rule bg-surface p-2.5 text-[12px]">
        {breakdown && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-ink-faint">
            <Row label="Independent sources" value={breakdown.independentSources} max={30} />
            <Row label="Source tier" value={breakdown.sourceTier} max={25} />
            <Row label="Links verified" value={breakdown.urlValidation} max={20} />
            <Row label="Criteria covered" value={breakdown.criteriaCoverage} max={15} />
            <Row label="Dates make sense" value={breakdown.temporalSanity} max={10} />
          </dl>
        )}
        {check.modelConfidence !== null && (
          <p className="mt-2 text-ink-faint">
            The model said {check.modelConfidence}/100
            {breakdown?.capApplied ? ', which capped the score above.' : '.'}
          </p>
        )}
        {gates.length > 0 && (
          <Bullets items={gates} className="mt-2 text-partial" />
        )}
      </div>
    </details>
  );
}

/**
 * One line of the rubric.
 *
 * The lines that fell short are tinted, because they are the answer to the only
 * question this panel is opened to ask: why did this not resolve on its own?
 * Every row looked the same, so finding the 10/20 among four perfect scores
 * meant reading all five.
 */
function Row({ label, value, max }: { label: string; value: number; max: number }) {
  const short = value < max;
  return (
    <>
      <dt className={short ? 'text-partial' : undefined}>{label}</dt>
      <dd className={`tabular-nums ${short ? 'text-partial' : ''}`}>
        {value}/{max}
      </dd>
    </>
  );
}

function EvidenceRow({ source }: { source: Evidence }) {
  const status = FETCH_LABEL[source.fetchStatus];
  return (
    <li className="flex gap-2">
      <span className={`${status.tone} shrink-0 text-[13px]`} title={status.label} aria-label={status.label}>
        {status.glyph}
      </span>
      <div className="min-w-0">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="block truncate text-[13px] text-ink-dim underline-offset-2 hover:underline"
        >
          {source.publisher ?? source.title ?? source.url}
        </a>
        {source.quotedText && (
          <p className="mt-0.5 line-clamp-2 font-display text-[13px] text-ink-faint italic">
            &ldquo;{source.quotedText}&rdquo;
          </p>
        )}
      </div>
    </li>
  );
}

interface Breakdown {
  independentSources: number;
  sourceTier: number;
  urlValidation: number;
  criteriaCoverage: number;
  temporalSanity: number;
  capApplied: boolean;
  gates?: string[];
}

function parseBreakdown(raw: string | null): Breakdown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Breakdown;
  } catch {
    return null;
  }
}
