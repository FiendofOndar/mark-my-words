import { describe, expect, it } from 'vitest';
import {
  assessCheck,
  countIndependentSources,
  type AssessmentInput,
  type SourceAssessment,
} from './gates';

const STATEMENT = '2026-01-01T00:00:00.000Z';

/**
 * `tier` is still on the type because the model sends it, but nothing reads it:
 * the tier comes from the domain. apnews.com is a wire service, `major_outlet`
 * and not `primary`, however it is labelled.
 */
function source(overrides: Partial<SourceAssessment> = {}): SourceAssessment {
  return {
    url: 'https://apnews.com/article/one',
    publisher: 'AP',
    tier: 'primary',
    fetchStatus: 'ok',
    publishedAt: '2026-06-01',
    ...overrides,
  };
}

/** A government host, which is genuinely the body that would know. */
function primarySource(overrides: Partial<SourceAssessment> = {}): SourceAssessment {
  return source({ url: 'https://www.weather.gov/record', publisher: 'National Weather Service', ...overrides });
}

function input(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    sources: [
      primarySource(),
      source({ url: 'https://reuters.com/a', publisher: 'Reuters' }),
      source({ url: 'https://bbc.co.uk/a', publisher: 'BBC' }),
    ],
    modelConfidence: 90,
    statementDate: STATEMENT,
    proposedVerdict: 'hit',
    forceManual: false,
    isRetroactive: false,
    ...overrides,
  };
}

describe('independent sources', () => {
  it('counts one per domain, not one per article', () => {
    expect(
      countIndependentSources([
        source({ url: 'https://apnews.com/1' }),
        source({ url: 'https://apnews.com/2' }),
      ]),
    ).toBe(1);
  });

  it('does not count a page that does not exist', () => {
    expect(
      countIndependentSources([
        source({ url: 'https://apnews.com/1' }),
        source({ url: 'https://reuters.com/1', fetchStatus: 'unreachable' }),
      ]),
    ).toBe(1);
  });

  it('ignores the publisher name the model typed', () => {
    // Two pages on one site labelled as two wire services are one source.
    expect(
      countIndependentSources([
        source({ url: 'https://example.com/1', publisher: 'AP' }),
        source({ url: 'https://example.com/2', publisher: 'Reuters' }),
      ]),
    ).toBe(1);
  });
});

describe('the decision', () => {
  it('applies a clean, corroborated, confident verdict', () => {
    const result = assessCheck(input());
    expect(result.gates).toEqual([]);
    expect(result.decision).toBe('auto_resolve');
  });

  it('asks a person when the model says it is unsure', () => {
    expect(assessCheck(input({ modelConfidence: 50 })).decision).toBe('queue');
  });

  it('still applies when the model reported no confidence at all', () => {
    expect(assessCheck(input({ modelConfidence: null })).decision).toBe('auto_resolve');
  });

  it('treats no_change as nothing to decide', () => {
    const result = assessCheck(input({ proposedVerdict: 'no_change' }));
    expect(result.decision).toBe('hold');
    expect(result.gates).toEqual(['Nothing resolved.']);
  });
});

describe('gates', () => {
  it('never auto-resolves a partial or ambiguous verdict', () => {
    expect(assessCheck(input({ proposedVerdict: 'partial' })).decision).toBe('queue');
    expect(assessCheck(input({ proposedVerdict: 'ambiguous' })).decision).toBe('queue');
  });

  it('never auto-resolves when the user asked to call it themselves', () => {
    const result = assessCheck(input({ forceManual: true }));
    expect(result.decision).toBe('queue');
    expect(result.gates.join(' ')).toMatch(/yourself/);
  });

  it('never auto-resolves on a single non-primary source, however good', () => {
    const result = assessCheck(input({ sources: [source()] }));
    expect(result.decision).toBe('queue');
    expect(result.gates.join(' ')).toMatch(/one independent source/i);
  });

  it('lets the body that keeps the record stand on its own', () => {
    // An NWS observation does not need a newspaper to agree with it.
    const result = assessCheck(input({ sources: [primarySource()] }));
    expect(result.gates).toEqual([]);
    expect(result.decision).toBe('auto_resolve');
  });

  it('does not let a dead primary link stand on its own', () => {
    const result = assessCheck(
      input({ sources: [primarySource({ fetchStatus: 'unreachable' }), source()] }),
    );
    expect(result.gates.join(' ')).toMatch(/one independent source/i);
  });

  it('gates when nothing was cited', () => {
    const result = assessCheck(input({ sources: [] }));
    expect(result.gates).toEqual(['No sources were cited.']);
    expect(result.decision).toBe('queue');
  });

  it('gates only when no cited source resolved at all', () => {
    const allDead = assessCheck(
      input({
        sources: [
          source({ fetchStatus: 'unreachable' }),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters', fetchStatus: 'unreachable' }),
        ],
      }),
    );
    expect(allDead.gates.join(' ')).toMatch(/invented citations/i);

    const oneDead = assessCheck(
      input({
        sources: [
          primarySource(),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters', fetchStatus: 'unreachable' }),
          source({ url: 'https://bbc.co.uk/a', publisher: 'BBC' }),
        ],
      }),
    );
    expect(oneDead.gates).toEqual([]);
  });

  it('treats a blocked page as unread rather than as a fake citation', () => {
    const result = assessCheck(
      input({
        sources: [
          primarySource({ fetchStatus: 'blocked' }),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters', fetchStatus: 'blocked' }),
        ],
      }),
    );
    expect(result.gates).toEqual([]);
  });

  it('gates on a publisher name the host cannot support only when nothing else stands', () => {
    // The Dodgers check: a YouTube page labelled ESPN beside two real,
    // reachable pages. The two carry the verdict; the label is noted, not gated.
    const carried = assessCheck(
      input({
        sources: [
          source({ url: 'https://m.youtube.com/watch?v=1', publisher: 'ESPN' }),
          primarySource(),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters' }),
        ],
      }),
    );
    expect(carried.gates).toEqual([]);

    const alone = assessCheck(
      input({ sources: [source({ url: 'https://m.youtube.com/watch?v=1', publisher: 'ESPN' })] }),
    );
    expect(alone.gates.join(' ')).toMatch(/credited to ESPN/);

    const withDeadCompany = assessCheck(
      input({
        sources: [
          source({ url: 'https://m.youtube.com/watch?v=1', publisher: 'ESPN' }),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters', fetchStatus: 'unreachable' }),
        ],
      }),
    );
    expect(withDeadCompany.gates.join(' ')).toMatch(/credited to ESPN/);
  });

  it('gates when nothing cited postdates the prediction, and only then', () => {
    const allBefore = assessCheck(
      input({
        sources: [
          primarySource({ publishedAt: '2025-12-01' }),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters', publishedAt: '2025-11-01' }),
        ],
      }),
    );
    expect(allBefore.gates.join(' ')).toMatch(/predates/);

    const oneBefore = assessCheck(
      input({
        sources: [
          primarySource({ publishedAt: '2025-12-01' }),
          source({ url: 'https://reuters.com/a', publisher: 'Reuters', publishedAt: '2026-06-01' }),
        ],
      }),
    );
    expect(oneBefore.gates).toEqual([]);
  });

  it('compares publication dates as days, not as instants', () => {
    // The Anacortes run: the claim is stored as the end of Sep 11 local, the
    // sources were dated "2026-09-12", which parses as midnight UTC, seven
    // hours earlier in Pacific time. The gate read every source as predating
    // the claim and held a correct miss.
    const endOfSep11Local = new Date(2026, 8, 11, 23, 59, 59, 999).toISOString();
    const nextDay = assessCheck(
      input({
        statementDate: endOfSep11Local,
        sources: [primarySource({ publishedAt: '2026-09-12' })],
      }),
    );
    expect(nextDay.gates).toEqual([]);

    const sameDay = assessCheck(
      input({
        statementDate: endOfSep11Local,
        sources: [primarySource({ publishedAt: '2026-09-11' })],
      }),
    );
    expect(sameDay.gates).toEqual([]);

    const dayBefore = assessCheck(
      input({
        statementDate: endOfSep11Local,
        sources: [primarySource({ publishedAt: '2026-09-10' })],
      }),
    );
    expect(dayBefore.gates.join(' ')).toMatch(/predates/);
  });

  it('reads an undated source as unknown, not as older than the claim', () => {
    const result = assessCheck(
      input({ sources: [primarySource({ publishedAt: null })] }),
    );
    expect(result.gates).toEqual([]);
  });

  it('allows older sources on a retroactive entry', () => {
    const result = assessCheck(
      input({
        isRetroactive: true,
        sources: [primarySource({ publishedAt: '2025-12-01' })],
      }),
    );
    expect(result.gates).toEqual([]);
  });
});
