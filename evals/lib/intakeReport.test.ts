import { describe, expect, it } from 'vitest';
import { compareIntake, parseKey, renderMarkdown, statusOf, type IntakeRow } from './intakeReport';
import type { StructuredPrediction } from '../../src/verification/types';

const reading: StructuredPrediction = {
  normalizedClaim: 'A rogue AI drone strike occurs within six months.',
  polarity: 'positive',
  disconfirmingTrigger: null,
  criteriaElements: [
    'A drone acting against its orders or programming (rogue, not merely autonomous) carries out a strike',
    'The strike is reported between 2026-09-16 and 2027-03-16',
  ],
  deadlineType: 'fixed_date',
  resolutionDate: '2027-03-16',
  windowStart: null,
  windowEnd: null,
  triggerEvent: null,
  triggerExpectedDate: null,
  raceEventB: null,
  staleOutDate: null,
  deadlineReasoning: 'Six months from the statement date.',
  verifiability: 'searchable',
  verifiabilityReasoning: 'Widely reported if it happens.',
  searchQueries: ['rogue drone strike'],
  noCheckBefore: null,
  canHappenLate: true,
  category: 'Tech/AI',
  tags: [],
  authorGuess: null,
  statementDateGuess: null,
  ambiguities: ['Which theatre counts? I read it as anywhere in the world.'],
};

describe('reading a case key', () => {
  it('splits a field from its comparison suffix, and refuses a field it does not know', () => {
    expect(parseKey('criteria_elements_contains')).toEqual({ field: 'criteria_elements', suffix: '_contains' });
    expect(parseKey('resolution_date')).toEqual({ field: 'resolution_date', suffix: '' });
    expect(parseKey('ambiguities_max')).toEqual({ field: 'ambiguities', suffix: '_max' });
    expect(parseKey('is_prediction')).toBeNull();
    expect(parseKey('nope_contains')).toBeNull();
  });
});

describe('comparing a case to the reading', () => {
  it('checks only the keys the case names, exactly for plain fields', () => {
    expect(compareIntake({ deadline_type: 'fixed_date', can_happen_late: true, race_event_b: null }, reading)).toEqual([]);
    expect(compareIntake({ can_happen_late: false }, reading)).toEqual([
      { key: 'can_happen_late', expected: false, actual: true },
    ]);
  });

  it('finds words inside a list field, case-insensitively, all or any', () => {
    expect(compareIntake({ criteria_elements_contains: ['Rogue', 'strike'] }, reading)).toEqual([]);
    expect(compareIntake({ criteria_elements_contains: ['rogue', 'missile'] }, reading)).toHaveLength(1);
    expect(compareIntake({ criteria_elements_contains_any: ['missile', 'strike'] }, reading)).toEqual([]);
    expect(compareIntake({ ambiguities_contains_any: ['which'] }, reading)).toEqual([]);
  });

  it('refuses words that must not appear, and matches a pattern', () => {
    expect(compareIntake({ criteria_elements_absent: [' or ', 'depending'] }, reading)).toHaveLength(1);
    expect(compareIntake({ criteria_elements_absent: ['depending'] }, reading)).toEqual([]);
    expect(compareIntake({ criteria_elements_matches: '\\d{4}-\\d{2}-\\d{2}' }, reading)).toEqual([]);
    expect(compareIntake({ normalized_claim_matches: '^The' }, reading)).toHaveLength(1);
  });

  it('bounds a date and counts a list', () => {
    expect(compareIntake({ resolution_date_min: '2027-03-01', resolution_date_max: '2027-03-31' }, reading)).toEqual([]);
    expect(compareIntake({ resolution_date_max: '2027-02-28' }, reading)).toHaveLength(1);
    expect(compareIntake({ ambiguities_min: 1, criteria_elements_max: 2 }, reading)).toEqual([]);
    expect(compareIntake({ ambiguities_max: 0 }, reading)).toHaveLength(1);
    // A null date is neither before nor after anything.
    expect(compareIntake({ window_end_min: '2026-01-01' }, reading)).toHaveLength(1);
  });

  it('reports a key it does not know rather than passing it silently', () => {
    expect(compareIntake({ is_prediction: true }, reading)[0]?.actual).toBe('(not a field the eval knows)');
  });

  it('calls a case with no expected values unconfirmed rather than passed', () => {
    expect(statusOf(undefined, [])).toBe('unconfirmed');
    expect(statusOf({}, [])).toBe('unconfirmed');
    expect(statusOf({ polarity: 'positive' }, [])).toBe('pass');
  });
});

describe('the job summary', () => {
  it('lists every row, says how a proposal fared, and collapses the reading under each', () => {
    const rows: IntakeRow[] = [
      {
        id: 'rogue-drone',
        statement: 'Mark my words, rogue drones.',
        tests: 'the qualifier survives',
        status: 'unconfirmed',
        diffs: [],
        proposalDiffs: [{ key: 'can_happen_late', expected: false, actual: true }],
        proposedCount: 3,
        value: reading,
        warnings: [],
        tokens: 700,
        error: null,
      },
      {
        id: 'bitcoin',
        statement: 'Bitcoin finishes 2024 above $100k.',
        tests: null,
        status: 'fail',
        diffs: [{ key: 'resolution_date', expected: '2024-12-31', actual: '2026-12-31' }],
        proposalDiffs: [],
        proposedCount: 0,
        value: reading,
        warnings: ['Polarity was missing, assumed the claim is that something will happen.'],
        tokens: 650,
        error: null,
      },
      { id: 'broken', statement: 'x', tests: null, status: 'error', diffs: [], proposalDiffs: [], proposedCount: 0, value: null, warnings: [], tokens: null, error: 'The request timed out.' },
    ];
    const md = renderMarkdown(rows, 'Intake');
    expect(md).toContain('0 pass, 1 fail, 1 unconfirmed, 1 error.');
    expect(md).toContain('| rogue-drone | unconfirmed | proposal: 2 of 3 agree; differs on can_happen_late |');
    expect(md).toContain('resolution_date: expected "2024-12-31", got "2026-12-31"');
    expect(md).toContain('<summary>bitcoin: what the app would store</summary>');
    expect(md).toContain('"parser_warnings"');
    expect(md).toContain('- can_happen_late: proposed false, got true');
    expect(md).toContain('| broken | error | The request timed out. |');
  });
});
