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

  it('sends a scheduled occasion to fixed_date, not to the event shape', () => {
    // Run 15 (2026-09-17) read "the Eagles win the Super Bowl this season"
    // and "the Dodgers are going back-to-back" as event-shaped, each with a
    // stale-out a fortnight past the game. Only an event-shaped claim can
    // stale out, so an unsettled championship claim would have filed itself
    // moot instead of sitting overdue. The owner ruled fixed_date.
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/A SCHEDULED EVENT IS A DATE, NOT AN EVENT SHAPE/);
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/must never end up moot/);
  });

  it('refuses late watch on a race and on a negative claim', () => {
    // Run 15 marked "Starship reaches orbit before New Glenn ever flies" and
    // "nobody lands on the Moon before the end of 2025" as able to happen
    // late. Neither can: a race is lost for good once the other side goes,
    // and a negative claim is settled when its period closes. True here buys
    // three years of monthly paid checks on a question already answered, so
    // the old line that event-shaped claims are almost always true is gone
    // and both kinds are named instead.
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/Two kinds are always false whatever their shape/);
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/A RACE\./);
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/A NEGATIVE CLAIM\./);
    expect(STRUCTURE_SYSTEM_PROMPT).not.toMatch(/almost always true/);
  });

  it('treats the statement date as a fact', () => {
    // A card asked whether the statement was "originally posted during an
    // earlier calendar year rather than the prompt date".
    expect(STRUCTURE_SYSTEM_PROMPT).toMatch(/do not ask whether it is right/);
  });
});
