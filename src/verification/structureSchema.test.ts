import { describe, expect, it } from 'vitest';
import { DEFAULT_STALE_OUT_YEARS, extractJson, parseStructuredPrediction } from './structureSchema';

const TODAY = '2026-09-12';
const ctx = { today: TODAY };

/** The shape a well-behaved model returns. */
function good(overrides: Record<string, unknown> = {}) {
  return {
    normalized_claim: 'The St. Louis Cardinals win the 2026 World Series.',
    polarity: 'positive',
    disconfirming_trigger: null,
    criteria_elements: ['The St. Louis Cardinals win the 2026 World Series'],
    deadline_type: 'fixed_date',
    resolution_date: '2026-11-05',
    deadline_reasoning: 'The World Series concludes in early November.',
    verifiability: 'searchable',
    verifiability_reasoning: 'Widely reported.',
    search_queries: ['2026 World Series winner'],
    category: 'Sports',
    tags: ['mlb'],
    author_guess: 'Popops',
    ambiguities: [],
    ...overrides,
  };
}

describe('extractJson', () => {
  it('reads plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips a markdown fence', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips an unlabelled fence', () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('survives a preamble before the object', () => {
    expect(extractJson('Here you go:\n{"a":1}')).toEqual({ a: 1 });
  });

  it('throws when there is no object at all', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow();
  });
});

describe('parseStructuredPrediction', () => {
  it('accepts a well-formed response', () => {
    const result = parseStructuredPrediction(good(), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.normalizedClaim).toContain('Cardinals');
    expect(result.value.category).toBe('Sports');
    expect(result.warnings).toEqual([]);
  });

  it('accepts camelCase keys as well as snake_case', () => {
    const result = parseStructuredPrediction(
      {
        normalizedClaim: 'A thing happens.',
        criteriaElements: ['The thing happens'],
        deadlineType: 'fixed_date',
        resolutionDate: '2027-01-01',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects anything that is not an object', () => {
    for (const value of ['nope', 42, null, ['a']]) {
      expect(parseStructuredPrediction(value, ctx).ok).toBe(false);
    }
  });

  it('rejects a response with no claim or no criteria', () => {
    const noClaim = parseStructuredPrediction(good({ normalized_claim: '  ' }), ctx);
    expect(noClaim.ok).toBe(false);
    const noCriteria = parseStructuredPrediction(good({ criteria_elements: [] }), ctx);
    expect(noCriteria.ok).toBe(false);
  });

  it('drops blank criteria rather than storing them', () => {
    const result = parseStructuredPrediction(
      good({ criteria_elements: ['first', '   ', 'second'] }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criteriaElements).toEqual(['first', 'second']);
  });

  it('wraps a single string where an array was asked for', () => {
    const result = parseStructuredPrediction(good({ criteria_elements: 'just one thing' }), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criteriaElements).toEqual(['just one thing']);
  });

  it('refuses a negative claim with nothing to search for', () => {
    const result = parseStructuredPrediction(
      good({ polarity: 'negative', disconfirming_trigger: null }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(' ')).toMatch(/nothing to search/i);
  });

  it('accepts a negative claim that names its disconfirming event', () => {
    const result = parseStructuredPrediction(
      good({
        polarity: 'negative',
        disconfirming_trigger: 'An AI-weighted index falls 30% from its peak',
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  describe('deadlines', () => {
    it('rejects a fixed date with no date', () => {
      expect(parseStructuredPrediction(good({ resolution_date: null }), ctx).ok).toBe(false);
    });

    it('rejects a half-specified window', () => {
      const result = parseStructuredPrediction(
        good({ deadline_type: 'window', window_start: '2026-12-01', window_end: null }),
        ctx,
      );
      expect(result.ok).toBe(false);
    });

    it('rejects a window that ends before it starts', () => {
      const result = parseStructuredPrediction(
        good({ deadline_type: 'window', window_start: '2027-03-20', window_end: '2026-12-01' }),
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems.join(' ')).toMatch(/ends before it starts/i);
    });

    it('rejects an event with no triggering event', () => {
      const result = parseStructuredPrediction(
        good({ deadline_type: 'event', trigger_event: null }),
        ctx,
      );
      expect(result.ok).toBe(false);
    });

    it('defaults a missing stale-out date and says so', () => {
      const result = parseStructuredPrediction(
        good({ deadline_type: 'event', trigger_event: 'Avengers: Doomsday releases' }),
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.staleOutDate).toBe(`${2026 + DEFAULT_STALE_OUT_YEARS}-09-12`);
      expect(result.warnings.join(' ')).toMatch(/stale-out/i);
    });
  });

  describe('repairs', () => {
    it('normalizes enum casing and spacing', () => {
      const result = parseStructuredPrediction(
        good({ polarity: 'Positive', deadline_type: 'Fixed Date', verifiability: 'SEARCHABLE' }),
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.polarity).toBe('positive');
      expect(result.value.deadlineType).toBe('fixed_date');
      expect(result.value.verifiability).toBe('searchable');
    });

    it('truncates a timestamp to a date', () => {
      const result = parseStructuredPrediction(
        good({ resolution_date: '2026-11-05T23:59:59.000Z' }),
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resolutionDate).toBe('2026-11-05');
    });

    it('accepts slash-separated dates', () => {
      const result = parseStructuredPrediction(good({ resolution_date: '2026/11/05' }), ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resolutionDate).toBe('2026-11-05');
    });

    it('files an unknown category under Other and warns', () => {
      const result = parseStructuredPrediction(good({ category: 'Baseball' }), ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.category).toBe('Other');
      expect(result.warnings.join(' ')).toMatch(/taxonomy/i);
    });

    it('assumes sensible defaults for missing optional enums and warns about each', () => {
      const result = parseStructuredPrediction(
        {
          normalized_claim: 'A thing happens.',
          criteria_elements: ['The thing happens'],
          resolution_date: '2027-01-01',
        },
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.polarity).toBe('positive');
      expect(result.value.deadlineType).toBe('fixed_date');
      expect(result.value.verifiability).toBe('searchable');
      expect(result.warnings).toHaveLength(3);
    });

    it('does not warn about a category that was simply absent', () => {
      const result = parseStructuredPrediction(
        {
          normalized_claim: 'A thing happens.',
          criteria_elements: ['The thing happens'],
          polarity: 'positive',
          deadline_type: 'fixed_date',
          resolution_date: '2027-01-01',
          verifiability: 'searchable',
        },
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.category).toBe('Other');
      expect(result.warnings).toEqual([]);
    });

    it('collects every problem instead of stopping at the first', () => {
      const result = parseStructuredPrediction(
        { polarity: 'negative', deadline_type: 'fixed_date' },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems.length).toBeGreaterThanOrEqual(3);
    });
  });
});
