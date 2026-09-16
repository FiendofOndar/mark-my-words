/**
 * What a gate may and may not do, for any set of citations the model could
 * return. The shape rule under test: a gate fires on "nothing here works",
 * never on "one thing does not", and no citation the app could not open may
 * make a verdict look better.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CONFIDENT_AT, assessCheck, countIndependentSources, type AssessmentInput, type SourceAssessment } from './gates';
import { publisherMismatch, registrableDomain, tierForUrl } from './sources';
import { STATUSES, isoInstant, shuffled, source, sources, url } from './arbitraries';

const verdict = fc.constantFrom(...STATUSES.filter((s) => s !== 'draft' && s !== 'open'), 'no_change' as const);

const input: fc.Arbitrary<AssessmentInput> = fc.record({
  sources: sources(),
  modelConfidence: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  statementDate: isoInstant(),
  proposedVerdict: verdict,
  forceManual: fc.boolean(),
  isRetroactive: fc.boolean(),
});

describe('decision', () => {
  it('holds exactly when nothing resolved, and never buries a verdict', () => {
    fc.assert(
      fc.property(input, (i) => {
        const { decision, gates } = assessCheck(i);
        if (i.proposedVerdict === 'no_change') return decision === 'hold';
        const unsure = i.modelConfidence !== null && i.modelConfidence < CONFIDENT_AT;
        return decision === (gates.length > 0 || unsure ? 'queue' : 'auto_resolve');
      }),
    );
  });

  it('auto-resolves only a hit, miss or void the model is sure of, with something real behind it', () => {
    fc.assert(
      fc.property(input, (i) => {
        const { decision } = assessCheck(i);
        if (decision !== 'auto_resolve') return true;
        // "Real" is a page that answered. A set nobody tried to open
        // (every citation not_checked) says nothing either way, and the
        // check path never produces one; the gate is not asked to guess.
        const tried = i.sources.filter((s) => s.fetchStatus !== 'not_checked');
        const opened = tried.filter((s) => s.fetchStatus === 'ok' || s.fetchStatus === 'blocked');
        return (
          !i.forceManual &&
          i.proposedVerdict !== 'partial' &&
          i.proposedVerdict !== 'ambiguous' &&
          countIndependentSources(i.sources) >= 1 &&
          (tried.length === 0 || opened.length >= 1)
        );
      }),
      { numRuns: 2000 },
    );
  });

  it('a verdict the model is unsure of is always queued, whatever the citations say', () => {
    fc.assert(
      fc.property(input, (i) => {
        if (i.proposedVerdict === 'no_change' || i.modelConfidence === null || i.modelConfidence >= CONFIDENT_AT) return true;
        return assessCheck(i).decision === 'queue';
      }),
    );
  });

  it('does not depend on the order the citations came in', () => {
    fc.assert(
      fc.property(input.chain((i) => fc.tuple(fc.constant(i), shuffled(i.sources))), ([i, mixed]) => {
        const a = assessCheck(i);
        const b = assessCheck({ ...i, sources: mixed });
        expect(b.decision).toBe(a.decision);
        expect(b.gates.length).toBe(a.gates.length);
      }),
    );
  });
});

describe('what a citation the app could not open may do', () => {
  it('a citation on a host that does not exist never turns a queued check into an applied one', () => {
    // An invented URL is the one failure this layer exists to catch. It may
    // add a gate; it may never remove one.
    fc.assert(
      fc.property(input, source, (i, extra) => {
        const ghost: SourceAssessment = { ...extra, fetchStatus: 'unreachable' };
        const before = assessCheck(i).decision;
        const after = assessCheck({ ...i, sources: [...i.sources, ghost] }).decision;
        if (before === 'queue') return after === 'queue';
        return true;
      }),
    );
  });

  it('an undated citation on a host that does not exist cannot clear the predates gate', () => {
    // Every real source predates the claim, which is a gate. One more URL
    // whose host does not exist, carrying no date, must not read as "a
    // source of unknown age" and clear it: the app could not open it, so it
    // knows nothing about it.
    const real: SourceAssessment = {
      url: 'https://apnews.com/story/1',
      publisher: 'Associated Press',
      tier: null,
      fetchStatus: 'ok',
      publishedAt: '2026-08-01',
    };
    const second: SourceAssessment = { ...real, url: 'https://www.reuters.com/story/9', publisher: 'Reuters' };
    const ghost: SourceAssessment = {
      url: 'https://blog.someone.net/story/2',
      publisher: null,
      tier: null,
      fetchStatus: 'unreachable',
      publishedAt: null,
    };
    const base: AssessmentInput = {
      sources: [real, second],
      modelConfidence: 98,
      statementDate: '2026-09-01T12:00:00.000Z',
      proposedVerdict: 'hit',
      forceManual: false,
      isRetroactive: false,
    };
    expect(assessCheck(base).decision).toBe('queue');
    expect(assessCheck({ ...base, sources: [real, second, ghost] }).decision).toBe('queue');
  });

  it('a citation nobody tried to open never gates a check as invented', () => {
    // `not_checked` is a seeded sample or an import. The fabrication gate
    // is about pages the app tried and could not reach; it has no evidence
    // about a page nobody tried.
    fc.assert(
      fc.property(input, (i) => {
        const untried = i.sources.map((s) => ({ ...s, fetchStatus: 'not_checked' as const }));
        const gates = assessCheck({ ...i, sources: untried }).gates;
        return !gates.some((g) => g.includes('invented'));
      }),
    );
  });

  it('a clean, opened, dated, independent citation on a primary host never adds a gate', () => {
    fc.assert(
      fc.property(input, fc.integer({ min: 1, max: 999 }), (i, n) => {
        if (i.proposedVerdict === 'no_change') return true;
        const clean: SourceAssessment = {
          url: `https://www.weather.gov/record/${n}`,
          publisher: 'National Weather Service',
          tier: null,
          fetchStatus: 'ok',
          publishedAt: '2032-12-31',
        };
        const before = assessCheck(i).gates;
        const after = assessCheck({ ...i, sources: [...i.sources, clean] }).gates;
        return after.length <= before.length;
      }),
    );
  });
});

describe('counting sources', () => {
  it('counts publishers, never more than citations, and two pages on one site as one', () => {
    fc.assert(
      fc.property(sources(), (ss) => {
        const n = countIndependentSources(ss);
        const reachable = ss.filter((s) => s.fetchStatus !== 'unreachable');
        const domains = new Set(reachable.map((s) => registrableDomain(s.url)));
        return n <= reachable.length && n === domains.size;
      }),
    );
  });

  it('does not change when a citation is duplicated', () => {
    fc.assert(
      fc.property(sources(), source, (ss, extra) => {
        const once = countIndependentSources([...ss, extra]);
        const twice = countIndependentSources([...ss, extra, { ...extra, url: extra.url + '?again' }]);
        return once === twice;
      }),
    );
  });
});

describe('domains', () => {
  it('ignores www and subdomains, and never keeps a scheme or path', () => {
    fc.assert(
      fc.property(url, (u) => {
        const d = registrableDomain(u);
        if (d === null) return false;
        if (d.startsWith('www.') || d.includes('/') || d.includes(':')) return false;
        const withWww = u.replace('https://', 'https://www.');
        return registrableDomain(withWww) === d || u.includes('://www.');
      }),
    );
  });

  it('only a .gov or .mil host, or a governing body in the table, is primary', () => {
    fc.assert(
      fc.property(url, (u) => {
        const tier = tierForUrl(u);
        const d = registrableDomain(u)!;
        if (d.endsWith('.gov') || d.endsWith('.mil')) return tier === 'primary';
        if (tier === 'primary') return ['mlb.com', 'nba.com', 'nfl.com', 'nhl.com', 'olympics.com'].includes(d);
        return true;
      }),
    );
  });
});

describe('publisher names', () => {
  const KNOWN_PAIRS: [string, string][] = [
    ['https://apnews.com/a', 'Associated Press'],
    ['https://www.reuters.com/a', 'Reuters'],
    ['https://www.bbc.co.uk/a', 'BBC'],
    ['https://www.nytimes.com/a', 'The New York Times'],
    ['https://www.wsj.com/a', 'The Wall Street Journal'],
    ['https://www.mlb.com/a', 'MLB'],
    ['https://www.nfl.com/a', 'NFL'],
    ['https://olympics.com/a', 'the IOC'],
    ['https://x.com/a', 'X'],
    ['https://www.youtube.com/a', 'YouTube'],
    ['https://www.economist.com/a', 'The Economist'],
    ['https://www.politico.com/a', 'Politico'],
    ['https://www.axios.com/a', 'Axios'],
    ['https://www.ft.com/a', 'Financial Times'],
  ];

  it('never flags the outlet named for its own site', () => {
    for (const [u, name] of KNOWN_PAIRS) expect(publisherMismatch(u, name)).toBe(false);
  });

  it('never flags an unknown site, whatever it is called', () => {
    fc.assert(
      fc.property(fc.constantFrom('https://example.org/a', 'https://blog.someone.net/a'), fc.string(), (u, name) => {
        return publisherMismatch(u, name) === false;
      }),
    );
  });

  it('flags one known outlet credited on another known outlet\'s site', () => {
    const failures: string[] = [];
    for (const [u, name] of KNOWN_PAIRS) {
      for (const [, other] of KNOWN_PAIRS) {
        if (other === name) continue;
        if (!publisherMismatch(u, other)) failures.push(`${other} on ${u}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
