import { describe, expect, it } from 'vitest';
import { CHECK_SYSTEM_PROMPT, buildCheckPrompt } from './check';
import type { CheckInput } from '../types';

const input: CheckInput = {
  claim: 'We will see the first rogue AI drone strike within six months.',
  polarity: 'positive',
  disconfirmingTrigger: null,
  criteriaElements: ['A drone strike occurs that was authorized by an autonomous system'],
  statementDate: '2026-08-24',
  deadlineDescription: 'By Feb 24, 2027',
  raceEventB: null,
  suggestedQueries: [],
  priorFindings: null,
  today: '2026-09-13',
};

describe('the check prompt', () => {
  it('tells the model when the period starts, not only when it ends', () => {
    // The first wrong verdict on a real claim: a strike in July, reported on
    // August 24 and 27, was applied as a hit on a claim recorded August 24.
    // The publication-date gate is the app's; the event date is the model's,
    // and nothing had told it the period had a start.
    const prompt = buildCheckPrompt(input);
    expect(prompt).toMatch(/covers events from 2026-08-24 to the deadline/);
    expect(prompt).toMatch(/before 2026-08-24 does not count/);
    expect(CHECK_SYSTEM_PROMPT).toMatch(/THE PERIOD STARTS ON THE DAY THE CLAIM WAS RECORDED/);
    expect(CHECK_SYSTEM_PROMPT).toMatch(/reporting dates are not event dates/i);
  });

  it('numbers the criteria from 1, as the parser expects', () => {
    const prompt = buildCheckPrompt({ ...input, criteriaElements: ['first', 'second'] });
    expect(prompt).toMatch(/1\. first\n2\. second/);
  });
});
