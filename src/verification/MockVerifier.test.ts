import { describe, expect, it } from 'vitest';
import { MockVerifier } from './MockVerifier';

const verifier = new MockVerifier();
const today = '2026-09-12';

async function read(rawStatement: string) {
  const result = await verifier.structure({ rawStatement, today });
  return result.value;
}

describe('offline drafting', () => {
  it('strips the "mark my words" framing from the claim', async () => {
    const value = await read('Mark my words, the AI bubble will crash in the next 6 months.');
    expect(value.normalizedClaim).toBe('the AI bubble will crash in the next 6 months.');
  });

  it('does not read the framing as a claim about the speaker', async () => {
    // "Mark my words" contains "my", which would otherwise trip the
    // private-life heuristic and route an economic claim to manual resolution.
    const value = await read('Mark my words, the AI bubble will crash in the next 6 months.');
    expect(value.verifiability).toBe('searchable');
    expect(value.category).toBe('Economics');
  });

  it('keeps a genuine tech claim in Tech/AI', async () => {
    const value = await read('We will see the first rogue AI drone strikes in the next 6 months.');
    expect(value.category).toBe('Tech/AI');
  });

  it('does route an actual private-life claim to manual', async () => {
    const value = await read('I bet my neighbors leave me alone about the gutters by Halloween.');
    expect(value.verifiability).toBe('manual');
    expect(value.category).toBe('Personal');
    expect(value.resolutionDate).toBe('2026-10-31');
  });

  it('reads a relative timeframe against today', async () => {
    expect((await read('It happens in the next 6 months.')).resolutionDate).toBe('2027-03-11');
    expect((await read('It happens within 2 weeks.')).resolutionDate).toBe('2026-09-26');
  });

  it('reads this year and next year', async () => {
    expect((await read('The Cardinals will win the World Series this year.')).resolutionDate).toBe(
      '2026-12-31',
    );
    expect((await read("Next year's winter will be brutal.")).resolutionDate).toBe('2027-12-31');
  });

  it('falls back to a year out and says the date is made up', async () => {
    const value = await read('Something big is coming.');
    expect(value.resolutionDate).toBe('2027-09-12');
    expect(value.deadlineReasoning).toMatch(/defaulted/i);
  });

  it('gives a negative claim something to search for', async () => {
    const value = await read('The bubble will not crash.');
    expect(value.polarity).toBe('negative');
    expect(value.disconfirmingTrigger).toBeTruthy();
  });

  it('always warns that it is not a model', async () => {
    const result = await verifier.structure({ rawStatement: 'A thing happens.', today });
    expect(result.warnings.join(' ')).toMatch(/without a model/i);
    expect(result.value.ambiguities.join(' ')).toMatch(/pattern matching/i);
    expect(result.provider).toBe('mock');
  });
});
