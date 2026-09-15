import { describe, expect, it } from 'vitest';
import { emptyFormValues, validateFormValues, type PredictionFormValues } from './PredictionForm';

function form(overrides: Partial<PredictionFormValues> = {}): PredictionFormValues {
  return {
    ...emptyFormValues(),
    rawStatement: 'A thing will happen.',
    authorName: 'Popops',
    statementDate: '2026-09-10',
    resolutionDate: '2026-12-01',
    criteria: ['The thing happens'],
    ...overrides,
  };
}

describe('what a prediction must have', () => {
  it('accepts a complete one', () => {
    expect(validateFormValues(form())).toEqual([]);
  });

  it('needs a statement, an author, a deadline and something to settle it', () => {
    expect(validateFormValues(form({ rawStatement: '   ' }))).toContain('The statement is required.');
    expect(validateFormValues(form({ authorName: '' }))).toContain('Someone said this. Who?');
    expect(validateFormValues(form({ resolutionDate: '' }))).toContain('Pick a deadline.');
    expect(validateFormValues(form({ criteria: ['', '  '] }))).toContain(
      'Add at least one thing that would settle it.',
    );
  });

  it('needs something to search for on a claim that something will not happen', () => {
    expect(validateFormValues(form({ polarity: 'negative' }))).toContain(
      'A negative claim needs the one event that would disprove it.',
    );
  });
});

describe('dates that do not make sense', () => {
  it('refuses a deadline that falls before the claim was made', () => {
    // Not a late entry, which is legitimate; this is simply backwards, and the
    // retroactive flag would have quietly papered over it.
    const problems = validateFormValues(
      form({ statementDate: '2026-09-10', resolutionDate: '2026-09-01' }),
    );
    expect(problems).toContain(
      'The deadline falls before the claim was made. Check When: a shared post defaults to today.',
    );
  });

  it('still allows a genuine after-the-fact entry', () => {
    expect(
      validateFormValues(form({ statementDate: '2024-01-01', resolutionDate: '2024-06-01' })),
    ).toEqual([]);
  });

  it('refuses a claim made in the future', () => {
    expect(validateFormValues(form({ statementDate: '2099-01-01' }))).toContain(
      'It cannot have been said in the future.',
    );
  });

  it('refuses a window that closes before it opens', () => {
    expect(
      validateFormValues(
        form({ deadlineType: 'window', windowStart: '2027-03-01', windowEnd: '2026-12-01' }),
      ),
    ).toContain('The window ends before it starts.');
  });

  it('refuses giving up before the event is even expected', () => {
    const problems = validateFormValues(
      form({
        deadlineType: 'event',
        triggerEvent: 'The film releases',
        triggerExpectedDate: '2028-01-01',
        staleOutDate: '2027-01-01',
      }),
    );
    expect(problems).toContain('It gives up before the event is even expected.');
  });

  it('refuses criteria dated past the deadline', () => {
    // The real one: a claim about temperatures on 9/11 came back from the
    // drafting model with criteria written about 9/12. Every check after that
    // correctly answered "the day is not over", forever.
    const problems = validateFormValues(
      form({
        rawStatement: 'Anacortes WA temps will hit 85 F on 9/11/2026.',
        resolutionDate: '2026-09-11',
        criteria: ['The daily high in Anacortes, WA is 85 F or higher on 2026-09-12'],
      }),
    );
    expect(problems).toContain(
      'A criterion says 2026-09-12, which is after the deadline. One of them is wrong.',
    );
  });

  it('leaves a date inside the claim window alone', () => {
    expect(
      validateFormValues(
        form({
          resolutionDate: '2026-09-11',
          criteria: ['The daily high is 85 F or higher on 2026-09-11'],
        }),
      ),
    ).toEqual([]);
  });

  it('leaves an earlier date alone, since a criterion may measure against one', () => {
    expect(
      validateFormValues(
        form({
          criteria: ['Higher than the record set on 2024-07-01'],
        }),
      ),
    ).toEqual([]);
  });

  it('accepts a well-formed event claim', () => {
    expect(
      validateFormValues(
        form({
          deadlineType: 'event',
          triggerEvent: 'The film releases',
          triggerExpectedDate: '2027-01-01',
          staleOutDate: '2031-01-01',
        }),
      ),
    ).toEqual([]);
  });
});
