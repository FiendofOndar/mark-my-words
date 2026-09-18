import { describe, expect, it } from 'vitest';
import { describeKey, renderReview, showActual } from './intakeReview';
import type { IntakeCases } from './intakeReport';
import type { StructuredPrediction } from '../../src/verification/types';

const reading: StructuredPrediction = {
  normalizedClaim: 'A rogue AI drone strike occurs on or before March 16, 2027.',
  polarity: 'positive',
  disconfirmingTrigger: null,
  criteriaElements: ['A drone acting contrary to its operator orders (rogue, not merely autonomous) carries out a strike'],
  deadlineType: 'fixed_date',
  resolutionDate: '2027-03-16',
  windowStart: null,
  windowEnd: null,
  triggerEvent: null,
  triggerExpectedDate: null,
  raceEventB: null,
  staleOutDate: null,
  deadlineReasoning: 'Six months on.',
  verifiability: 'searchable',
  verifiabilityReasoning: 'Widely reported.',
  searchQueries: [],
  noCheckBefore: null,
  canHappenLate: true,
  category: 'Tech/AI',
  tags: [],
  authorGuess: null,
  statementDateGuess: null,
  ambiguities: ['Which theatre counts?'],
};

describe('putting a case key into words', () => {
  it('names the deadline shape, the date and the late flag as a person would', () => {
    expect(describeKey('deadline_type', 'fixed_date')).toBe('The deadline is a fixed date');
    expect(describeKey('deadline_type', 'window')).toBe('The deadline is a window');
    expect(describeKey('resolution_date', '2027-03-16')).toBe('The deadline is 2027-03-16');
    expect(describeKey('can_happen_late', false)).toBe('It could still come true after the deadline: no');
    expect(describeKey('polarity', 'negative')).toBe('It is a claim that something will NOT happen');
    expect(describeKey('verifiability', 'manual')).toBe('Only you can settle it, not a search');
  });

  it('bounds a date by its own name, and a list by its count', () => {
    // "Resolution_date is on or after" was the first draft and reads like a
    // column header. A date bound names the deadline; a list bound counts.
    expect(describeKey('resolution_date_min', '2027-02-01')).toBe('The deadline is on or after 2027-02-01');
    expect(describeKey('window_end_max', '2027-04-30')).toBe('The window closing is on or before 2027-04-30');
    expect(describeKey('ambiguities_min', 1)).toBe('The questions number at least 1');
  });

  it('says what the criteria must and must not carry', () => {
    expect(describeKey('criteria_elements_contains', ['rogue'])).toBe('The criteria mention "rogue"');
    expect(describeKey('criteria_elements_contains_any', ['a', 'b'])).toBe('The criteria mention at least one of "a", "b"');
    expect(describeKey('criteria_elements_absent', [' or '])).toBe('The criteria never say " or "');
  });
});

describe('showing the model\'s own words', () => {
  it('quotes the matched fragment in context rather than the whole field', () => {
    const shown = showActual('criteria_elements_contains', ['rogue'], reading);
    expect(shown).toContain('rogue');
    expect(shown.length).toBeLessThan(reading.criteriaElements[0]!.length);
  });

  it('gives the plain value for a field with nothing to match, and marks an empty one', () => {
    expect(showActual('deadline_type', 'fixed_date', reading)).toBe('fixed_date');
    expect(showActual('disconfirming_trigger_contains', ['x'], reading)).toBe('_nothing_');
  });
});

describe('the review sheet', () => {
  const cases: IntakeCases = {
    'rogue-drone': {
      statement: 'Mark my words, rogue drones within six months.',
      today: '2026-09-16',
      tests: 'the qualifier survives',
      expect: { deadline_type: 'fixed_date' },
      proposed: { category: 'Tech/AI', can_happen_late: false },
      ask: [{ about: 'category', question: 'Tech/AI or Other?' }],
    },
  };

  it('leads with the questions, counts them, and marks graded against proposed', () => {
    const md = renderReview(cases, { 'rogue-drone': reading }, { heading: 'Sheet', provenance: 'from run 17' });
    expect(md).toContain('## Sheet');
    expect(md).toContain('from run 17');
    expect(md).toContain('2 proposed values here and 1 of them need');
    expect(md).toContain('## The 1 that need you');
    expect(md).toContain('Tech/AI or Other?');
    // The graded key is labelled as such, the agreeing proposal reads ok,
    // and the one the model contradicts is called out rather than buried.
    expect(md).toContain('**graded** — The deadline is a fixed date');
    expect(md).toContain('ok — Filed under Tech/AI');
    expect(md).toContain('**differs** — It could still come true after the deadline: no — model: true');
  });

  it('works when a case has no reading, without inventing one', () => {
    const md = renderReview(cases, {}, { heading: 'Sheet', provenance: 'none' });
    expect(md).toContain('_no reading_');
  });
});
