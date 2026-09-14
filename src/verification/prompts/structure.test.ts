import { describe, expect, it } from 'vitest';
import { STRUCTURE_SYSTEM_PROMPT } from './structure';

/**
 * Three rules from the first ten-statement intake run on the device
 * (2026-09-14). Each one names a card that came back wrong.
 */
describe('the intake prompt', () => {
  it('refuses "or" in the testable version, not only in the criteria', () => {
    // "The Mariners win the World Series or at least the pennant" came back
    // with the "or" intact in the testable version, and the only question
    // asked was about the season.
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/"A or B" is not a claim the app can check/);
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/keep the weaker one/);
  });

  it('names an invented threshold in the question, not only in the criterion', () => {
    // "The Kraken are going to be terrible" asked what terrible meant, then
    // wrote "bottom 8 teams" into the criterion without saying that was the
    // number it had picked.
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/WHEN YOU INVENT A THRESHOLD, SAY SO/);
  });

  it('treats the statement date as a fact', () => {
    // A card asked whether the statement was "originally posted during an
    // earlier calendar year rather than the prompt date".
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/do not ask whether it is right/);
  });
});
