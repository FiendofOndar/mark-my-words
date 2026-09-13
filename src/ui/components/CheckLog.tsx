import type { Check, Evidence, FetchStatus, PredictionStatus } from '../../domain/types';
import type { CheckLogEntry } from '../queries';
import { STATUS_LABEL, formatDate } from '../../domain/format';
import { publisherMismatch, registrableDomain } from '../../domain/sources';
import { Pill } from './Stamp';
import { Bullets } from './Bullets';
import { ExternalLink } from './ExternalLink';

/**
 * Whether the cited link goes anywhere, which is the one thing about a citation
 * the app checks for itself. A green check means you can tap it and land on a
 * page; a yellow mark means there is no page there.
 *
 * `short` is printed on the row. A glyph alone was read as "does this source
 * agree with the claim", which is not what it means, and there is no hover on
 * a phone to correct it.
 */
const FETCH_LABEL: Record<FetchStatus, { glyph: string; short: string; label: string; tone: string }> = {
  ok: { glyph: '✓', short: 'link works', label: 'The page answered', tone: 'text-hit' },
  blocked: {
    glyph: '✓',
    short: 'link works',
    label: 'The host answered but would not show the app the page',
    tone: 'text-hit',
  },
  unreachable: {
    glyph: '!',
    short: 'link does not work',
    label: 'There is no page at this address',
    tone: 'text-partial',
  },
  not_checked: {
    glyph: '·',
    short: 'not checked',
    label: 'The app has not tried this link',
    tone: 'text-ink-faint',
  },
};

const OUTCOME_LABEL: Record<Check['outcome'], string> = {
  auto_resolved: 'Resolved',
  queued: 'Waiting on you',
  no_change: 'No change',
  error: 'Failed',
};

/**
 * What this check actually concluded.
 *
 * A check the app held for thin evidence is stored as `no_change`, the same as
 * one that genuinely found nothing. On screen both read "No change", so a model
 * that proposed a miss and was overruled by the scoring looked identical to a
 * model that had nothing to say. The proposed verdict is on the row; use it.
 */
function outcomeLabel(check: Check): string {
  const held =
    check.outcome === 'no_change' &&
    check.proposedVerdict !== null &&
    check.proposedVerdict !== 'no_change';

  return held ? `Held: ${STATUS_LABEL[check.proposedVerdict as PredictionStatus]}` : OUTCOME_LABEL[check.outcome];
}

/**
 * What the app stood behind, as a count of independent sources whose links
 * work. Counted by domain, the way the gates count, or the two disagree on
 * screen: this once read "2 sources" beside a gate saying only one had been
 * cited, because it was counting a dead link and a duplicate domain.
 */
export function describeSources(evidence: Evidence[]): string {
  if (evidence.length === 0) return 'no sources';

  const domainOf = (e: Evidence) => registrableDomain(e.url) ?? e.url;
  const cited = new Set(evidence.map(domainOf));
  const plural = cited.size === 1 ? 'source' : 'sources';

  // "None working" implies the app looked. On a seeded or imported check it
  // never did, and saying otherwise is the same small lie as marking those
  // rows "page would not open".
  if (evidence.every((e) => e.fetchStatus === 'not_checked')) {
    return `${cited.size} ${plural}, links not checked`;
  }

  const working = new Set(
    evidence.filter((e) => e.fetchStatus !== 'unreachable').map(domainOf),
  );
  if (working.size === 0) return `${cited.size} ${plural}, no link works`;
  if (working.size === cited.size) {
    return cited.size === 1 ? '1 source, link works' : `${cited.size} sources, links work`;
  }
  return `${working.size} of ${cited.size} ${plural} with working links`;
}

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
            <Pill tone={check.outcome === 'error' ? 'warn' : 'muted'}>{outcomeLabel(check)}</Pill>
            {/* Seeded demo checks cite example.com and were never fetched, but
                they carry publisher names and read exactly like a real result.
                One of them asserts a World Series winner for a season that has
                not been played. */}
            {check.provider === 'demo' && <Pill tone="warn">Sample</Pill>}
            {check.outcome !== 'error' && <SourcesChip check={check} evidence={evidence} />}
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

function SourcesChip({ check, evidence }: { check: Check; evidence: Evidence[] }) {
  return (
    <details className="w-full">
      {/* A summary is display:list-item, so once the details opened inside a
          flex row the pill stretched the full width and read as an empty input
          box rather than as a score. */}
      <summary className="inline-flex w-fit cursor-pointer list-none rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-dim">
        {describeSources(evidence)}
      </summary>
      <div className="mt-2 rounded border border-rule bg-surface p-2.5 text-[12px] text-ink-faint">
        {/* The reasons the app did not act on its own, if any. These are the
            answer to the only question this panel is opened to ask. */}
        {check.gates.length > 0 ? (
          <Bullets items={check.gates} className="text-partial" />
        ) : (
          <p>Nothing about the citations stopped the app acting on this.</p>
        )}
        {check.modelConfidence !== null && (
          <p className="mt-2">The model put its confidence at {check.modelConfidence}/100.</p>
        )}
        <SearchesRun queries={check.searchQueries} />
      </div>
    </details>
  );
}

/**
 * What this check cost, in the unit it is billed in.
 *
 * Grounded checks are charged per search query. The prompt asks the model to
 * stop at three agreeing sources and never exceed twelve searches, and a
 * prompt cannot make it. This is the only place anyone finds out whether it
 * listened, and the queries themselves are the fastest way to see why a check
 * went to the wrong sources.
 */
function SearchesRun({ queries }: { queries: string[] | null }) {
  if (!queries || queries.length === 0) return null;
  const over = queries.length > 12;

  return (
    <details className="mt-2">
      <summary className={`cursor-pointer ${over ? 'text-partial' : 'text-ink-faint'}`}>
        {queries.length} {queries.length === 1 ? 'search' : 'searches'} run
        {over ? ', over the twelve it was asked to stay under' : ''}
      </summary>
      <ul className="mt-1 space-y-0.5 text-ink-faint">
        {queries.map((q, i) => (
          <li key={`${i}-${q}`} className="truncate">
            {q}
          </li>
        ))}
      </ul>
    </details>
  );
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
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
          <ExternalLink
            href={source.url}
            className="min-w-0 truncate text-ink-dim underline-offset-2 hover:underline"
          >
            {source.publisher ?? source.title ?? source.url}
          </ExternalLink>
          <span className={`shrink-0 text-[11px] ${status.tone}`}>{status.short}</span>
        </p>
        {/* The publisher is whatever the model typed. The host is where the
            page actually is, and showing only the former hid the one thing this
            layer exists to catch: a citation labelled "AP" sitting on
            example.com read as a real wire report. */}
        {host(source.url) && (
          <p className="text-[11px] text-ink-faint">
            {host(source.url)}
            {/* The one thing the label can still do is mislead the reader. */}
            {publisherMismatch(source.url, source.publisher) && (
              <span className="text-partial">
                {' '}
                &middot; credited to {source.publisher}, which is not whose site this is
              </span>
            )}
          </p>
        )}
        {source.quotedText && (
          <p className="mt-0.5 line-clamp-2 font-display text-[13px] text-ink-faint italic">
            &ldquo;{source.quotedText}&rdquo;
          </p>
        )}
      </div>
    </li>
  );
}
