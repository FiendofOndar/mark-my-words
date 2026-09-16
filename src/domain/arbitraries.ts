/**
 * Generators for the property tests. Test-only, like fixtures.ts.
 *
 * Every arbitrary here produces a value the app could hold: a prediction
 * whose date fields match its deadline type, a source whose fetch status is
 * one the fetcher can return. Nothing generated is a fact about the world;
 * statements are placeholders and dates are drawn from a fixed span.
 */
import fc from 'fast-check';
import type { DeadlineType, FetchStatus, Prediction, PredictionStatus, VerificationMode } from './types';
import type { SourceAssessment } from './gates';
import { makePrediction } from './fixtures';

/** A span wide enough to cross many years, DST changes and leap days. */
const SPAN_START = new Date('2020-01-01T00:00:00.000Z').getTime();
const SPAN_END = new Date('2032-12-31T23:59:59.999Z').getTime();

export const isoInstant = (min = SPAN_START, max = SPAN_END): fc.Arbitrary<string> =>
  fc.integer({ min, max }).map((ms) => new Date(ms).toISOString());

/** A calendar date as the date input writes it, YYYY-MM-DD, always valid. */
export const dateOnly: fc.Arbitrary<string> = fc
  .integer({ min: SPAN_START, max: SPAN_END })
  .map((ms) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });

export const STATUSES: PredictionStatus[] = ['draft', 'open', 'hit', 'miss', 'partial', 'ambiguous', 'void'];
export const status: fc.Arbitrary<PredictionStatus> = fc.constantFrom(...STATUSES);
export const deadlineType: fc.Arbitrary<DeadlineType> = fc.constantFrom('fixed_date', 'window', 'event');
export const verificationMode: fc.Arbitrary<VerificationMode> = fc.constantFrom('searchable', 'manual');
export const FETCH_STATUSES: FetchStatus[] = ['ok', 'blocked', 'missing', 'unreachable', 'not_checked'];
export const fetchStatus: fc.Arbitrary<FetchStatus> = fc.constantFrom(...FETCH_STATUSES);

const maybe = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | null> => fc.option(arb, { nil: null });

let ids = 0;
/** Unique within a run; a real id is a UUID, and only inequality matters here. */
const freshId = (): string => `p-${(ids += 1).toString(36)}`;

/**
 * A prediction with date fields that agree with its deadline type. Everything
 * else is drawn independently, including combinations the app would never
 * write (a draft with a lateHitAt), because a function that is only correct
 * on well-formed rows is not the invariant being tested.
 */
export const prediction: fc.Arbitrary<Prediction> = fc
  .record({
    status,
    deadlineType,
    verificationMode,
    a: isoInstant(),
    b: isoInstant(),
    statementDate: isoInstant(),
    lastCheckedAt: maybe(isoInstant()),
    lateWatchUntil: maybe(isoInstant()),
    lateHitAt: maybe(isoInstant()),
    deletedAt: maybe(isoInstant()),
    pinnedAt: maybe(isoInstant()),
    noCheckBefore: maybe(isoInstant()),
    promptNextAt: maybe(isoInstant()),
    resolvedAt: maybe(isoInstant()),
    updatedAt: isoInstant(),
    criteriaFrozenAt: maybe(isoInstant()),
    canHappenLate: fc.boolean(),
    isRetroactive: fc.boolean(),
    forceManual: fc.boolean(),
    hasDeadline: fc.boolean(),
    hasStaleOut: fc.boolean(),
    promptSnoozes: fc.integer({ min: 0, max: 6 }),
    checkCount: fc.integer({ min: 0, max: 40 }),
  })
  .map((r) => {
    const [start, end] = r.a <= r.b ? [r.a, r.b] : [r.b, r.a];
    const dates: Partial<Prediction> =
      r.deadlineType === 'fixed_date'
        ? { resolutionDate: r.hasDeadline ? end : null }
        : r.deadlineType === 'window'
          ? { windowStart: start, windowEnd: r.hasDeadline ? end : null }
          : {
              triggerEvent: 'the event',
              triggerExpectedDate: r.hasDeadline ? start : null,
              staleOutDate: r.hasStaleOut ? end : null,
            };
    return makePrediction({
      id: freshId(),
      status: r.status,
      deadlineType: r.deadlineType,
      verificationMode: r.verificationMode,
      statementDate: r.statementDate,
      lastCheckedAt: r.lastCheckedAt,
      lateWatchUntil: r.lateWatchUntil,
      lateHitAt: r.lateHitAt,
      deletedAt: r.deletedAt,
      pinnedAt: r.pinnedAt,
      noCheckBefore: r.noCheckBefore,
      promptNextAt: r.promptNextAt,
      resolvedAt: r.resolvedAt,
      updatedAt: r.updatedAt,
      criteriaFrozenAt: r.criteriaFrozenAt,
      canHappenLate: r.canHappenLate,
      isRetroactive: r.isRetroactive,
      forceManual: r.forceManual,
      promptSnoozes: r.promptSnoozes,
      checkCount: r.checkCount,
      ...dates,
    });
  });

export const predictions = (max = 12): fc.Arbitrary<Prediction[]> =>
  fc.array(prediction, { minLength: 0, maxLength: max });

export const instant: fc.Arbitrary<Date> = fc.integer({ min: SPAN_START, max: SPAN_END }).map((ms) => new Date(ms));

/** Hosts the source table knows, ones it does not, and .gov, on paths that differ. */
const HOSTS = [
  'apnews.com',
  'www.reuters.com',
  'bbc.co.uk',
  'nytimes.com',
  'mlb.com',
  'weather.gov',
  'www.weather.gov',
  'x.com',
  'youtube.com',
  'example.org',
  'news.example.org',
  'blog.someone.net',
  'vertexaisearch.cloud.google.com',
];

export const url: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...HOSTS), fc.integer({ min: 1, max: 999 }))
  .map(([host, n]) => `https://${host}/story/${n}`);

/** A publisher name: the truth for some host, a lie for others, or nothing. */
export const publisher: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom('Associated Press', 'AP', 'Reuters', 'BBC', 'ESPN', 'MLB', 'National Weather Service', 'X', 'Some Blog'),
  { nil: null },
);

/** A bare date, a full instant, junk, or nothing, which is what the model returns. */
export const publishedAt: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  dateOnly,
  isoInstant(),
  fc.constant('not a date'),
);

export const source: fc.Arbitrary<SourceAssessment> = fc.record({
  url,
  publisher,
  tier: fc.constant(null),
  fetchStatus,
  publishedAt,
});

export const sources = (max = 6): fc.Arbitrary<SourceAssessment[]> =>
  fc.array(source, { minLength: 0, maxLength: max });

export const shuffled = <T>(items: T[]): fc.Arbitrary<T[]> => fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length });
