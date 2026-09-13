import type { Check, Evidence, FetchStatus } from '../../domain/types';
import type { CheckLogEntry } from '../queries';
import { formatDate } from '../../domain/format';
import { Pill } from './Stamp';
import { Bullets } from './Bullets';

/**
 * What the app found when it opened the cited page itself.
 *
 * `short` is printed on the row. The glyph alone was read as "does this source
 * agree with the claim", which is not what it means at all, and there is no
 * hover on a phone to correct it.
 */
const FETCH_LABEL: Record<FetchStatus, { glyph: string; short: string; label: string; tone: string }> = {
  ok: { glyph: '✓', short: 'quote verified', label: 'Quote found on the page', tone: 'text-hit' },
  quote_not_found: {
    glyph: '!',
    short: 'quote not found on page',
    label: 'Page loaded, quote not found',
    tone: 'text-partial',
  },
  blocked: {
    glyph: '–',
    short: 'page would not open',
    label: 'Could not read the page',
    tone: 'text-ink-faint',
  },
  unreachable: {
    glyph: '✕',
    short: 'link did not resolve',
    label: 'Link did not resolve',
    tone: 'text-miss',
  },
};

const OUTCOME_LABEL: Record<Check['outcome'], string> = {
  auto_resolved: 'Resolved',
  queued: 'Waiting on you',
  no_change: 'No change',
  error: 'Failed',
};

export function CheckLog({
  entries,
  /**
   * The check whose verdict is already being asked about higher up the screen.
   * Its summary is printed there in larger type, so repeating it verbatim in
   * the log a few hundred pixels below is the same sentence twice. The entry
   * still appears, with its score and its evidence; only the prose is dropped.
   */
  summaryShownAbove,
}: {
  entries: CheckLogEntry[];
  summaryShownAbove?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="mt-3 text-[14px] text-ink-faint italic">
        {/* Not "pull down on the feed": there is a Check now button a few
            inches below this sentence. */}
        No checks run yet. Checks run on their own schedule, or when you ask.
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

          {check.id !== summaryShownAbove && (
            <p className="mt-1.5 text-[15px] leading-snug text-ink-dim">{check.summary}</p>
          )}

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
            <>
              {/* Says what the marks are about. Someone reading three sources
                  that all agree, marked ✓ ! !, reasonably concludes the marks
                  are about agreement. They are about whether the app could
                  open the page and find the quote on it. */}
              <p className="mt-3 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                Sources the model cited
              </p>
              <p className="mt-0.5 text-[12px] text-ink-faint">
                Marks are the app&rsquo;s own check of each link, not whether the source agrees.
              </p>
              <ul className="mt-2 space-y-1.5">
                {evidence.map((source) => (
                  <EvidenceRow key={source.id} source={source} />
                ))}
              </ul>
            </>
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
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            className="min-w-0 truncate text-ink-dim underline-offset-2 hover:underline"
          >
            {source.publisher ?? source.title ?? source.url}
          </a>
          <span className={`shrink-0 text-[11px] ${status.tone}`}>{status.short}</span>
        </p>
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
