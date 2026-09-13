import { describe, expect, it } from 'vitest';
import { coverageFrom, parseCheckResponse } from './checkSchema';
import type { CriterionStatus } from './types';

const at = (index: number, satisfied: boolean, basis: CriterionStatus['basis']): CriterionStatus => ({
  index,
  satisfied,
  basis,
  why: '',
});

describe('criteria coverage', () => {
  it('pays a miss for establishing that a criterion was not met', () => {
    // The one that made this necessary. Three real weather checks reported,
    // correctly and with quotes, that a 65F day did not reach 85F, and scored
    // zero here every time, because this counted only satisfied criteria. A
    // miss is precisely the case where nothing is satisfied, so fifteen of the
    // hundred were unavailable to every negative verdict.
    expect(coverageFrom([at(0, false, 'quoted')], 1, 'miss')).toBe('all_quoted');
  });

  it('reads a hit the same way', () => {
    expect(coverageFrom([at(0, true, 'quoted')], 1, 'hit')).toBe('all_quoted');
  });

  it('drops to inferred when an answer rests on nothing quoted', () => {
    expect(coverageFrom([at(0, false, 'inferred')], 1, 'miss')).toBe('inferred');
    expect(coverageFrom([at(0, true, 'quoted'), at(1, false, 'inferred')], 2, 'partial')).toBe(
      'inferred',
    );
  });

  it('drops to partial when a criterion got no answer at all', () => {
    expect(coverageFrom([at(0, false, 'quoted'), at(1, false, 'none')], 2, 'miss')).toBe('partial');
    expect(coverageFrom([at(0, false, 'quoted')], 2, 'miss')).toBe('partial');
  });

  it('gives a no_change check nothing, because nothing has been established', () => {
    expect(coverageFrom([at(0, false, 'quoted')], 1, 'no_change')).toBe('none');
    expect(coverageFrom([], 1, 'miss')).toBe('none');
  });
});

describe('source ceiling', () => {
  const source = (n: number) => ({
    url: `https://outlet${n}.example/story`,
    title: `Story ${n}`,
    publisher: `Outlet ${n}`,
    published_at: '2026-09-11',
    quoted_text: 'the thing happened',
    tier: 'major_outlet',
  });

  it('keeps only the first few, whatever the model sends', () => {
    // Three independent sources is already full marks, so the rest are fetched,
    // stored and rendered for nothing. The prompt asks for restraint; this is
    // the part that does not depend on the model agreeing to it.
    const parsed = parseCheckResponse(
      {
        verdict: 'hit',
        trend: 'toward_yes',
        summary: 'It happened.',
        criteria_status: [{ index: 0, satisfied: true, basis: 'quoted', why: 'said so' }],
        sources: Array.from({ length: 30 }, (_, i) => source(i)),
        model_confidence: 90,
      },
      1,
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.sources).toHaveLength(8);
    expect(parsed.ok && parsed.warnings.join(' ')).toMatch(/only the first 8/i);
  });
});
