import { describe, expect, it } from 'vitest';
import { EXTRACT_RESPONSE_SCHEMA, EXTRACT_SYSTEM_PROMPT } from './extract';

/**
 * Rules from the first five screenshot shares on the device (2026-09-13).
 * Each names a capture screen that came back wrong.
 */
describe('the screenshot prompt', () => {
  it('never lets a missing date pass as today', () => {
    // Two visible datelines (September 9 and September 1) and one "2y" all
    // came back as null and the form filled in today.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/a missing date is reported as missing, never as today/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/put the text exactly as shown in posted_hint/);
    expect(EXTRACT_RESPONSE_SCHEMA.properties.posted_hint).toBeDefined();
  });

  it('credits a reported prediction to the person who made it', () => {
    // A Yahoo article reporting Kyle Brandt's pick came back with no author
    // and "Kyle Brandt predicted that..." as the statement.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/A REPORTED PREDICTION BELONGS TO THE PERSON WHO MADE IT/);
  });

  it('counts a forum member name as the author', () => {
    // "Mike D in 332" was beside the post and the author came back empty.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/a forum's member name shown beside the post/);
  });
});

describe('the screenshot prompt, second device run', () => {
  it('names the Reddit cues for author and age', () => {
    // u/digitalamish and "1y" were beside the post; the author came back
    // empty and the note said no date was visible.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/On Reddit the u\/name beside the post is the author/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/On Reddit the age sits beside the username/);
  });

  it('handles a post cut off with "...more"', () => {
    // "...more" was copied into the statement as if it were the post's words.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/A POST CUT OFF with "\.\.\.more"/);
  });
});

describe('the screenshot prompt, first eval runs (2026-09-15)', () => {
  // Six Reddit screenshots in evals/screenshots, run through the real path
  // in Actions. Each rule below names a fail row from runs 1 and 2.
  it('drops framing that is not part of the sentence', () => {
    // Every statement came back with the sub's "MMW:" tag on the front.
    // The wording moved to a punctuation test on 2026-09-16; what this
    // case is about, a sub's tag coming off the front, is unchanged.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/Framing that stands as its own sentence or fragment is dropped/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/Acronyms inside the sentence stay/);
  });

  it('takes the title when a title and a body both carry the bet', () => {
    // The Melania post came back as title plus body, joined once by
    // "body also states:" and once by "candidate_body".
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/the statement is the title, without its tag/);
  });

  it('never continues a cut-off post or writes remarks into the statement', () => {
    // Five hundred invented words after "...more" on run 1; on run 2 the
    // note was written into the statement field instead of note.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/Never continue the text yourself/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/never put a remark of your own in statement/);
  });

  it('requires every field so none is silently left out', () => {
    // platform, posted_hint and note were absent from half the answers.
    expect([...EXTRACT_RESPONSE_SCHEMA.required]).toEqual(Object.keys(EXTRACT_RESPONSE_SCHEMA.properties));
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/EVERY FIELD, EVERY TIME/);
  });
});

describe('the screenshot prompt, second eval batch (2026-09-16)', () => {
  // Fifteen more r/MarkMyWords screenshots, and four decisions the owner
  // made from reading run 5's answers.
  it('counts a joke that names a checkable outcome', () => {
    // "Trump will push the red button... but will get a Diet Coke instead"
    // came back is_prediction false. The owner's call: jokes are still bets.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/A JOKE STILL COUNTS when it names an outcome somebody could check/);
    expect(EXTRACT_SYSTEM_PROMPT).not.toMatch(/A question, a joke, a wish/);
  });

  it('ends a cut-off post at the last sentence that finishes on screen', () => {
    // It had been stopping mid-word at "ruine", which is not a claim.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/End the statement at the last sentence that finishes on screen/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/drop a trailing sentence the cut leaves unfinished/);
  });

  it('drops the age hint once the age has resolved to a date', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/posted_on carries the date and posted_hint stays null/);
  });

  it('writes the note for the reader, not about its own instructions', () => {
    // One note opened "The post's title was selected per the title-and-body
    // rule", which means nothing on the capture screen.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/THE NOTE IS FOR THE PERSON WHO SHARED THE PICTURE/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/never name a rule or a field/);
  });
});

describe('the screenshot prompt, X batch (2026-09-16)', () => {
  it('takes the date from the person who made the prediction, not the reposter', () => {
    // @TeslaZenX quoted Musk and the date came back as the repost's. The
    // date is where the app starts counting, so a reposted claim would
    // look new. The owner's call: the original's date, or none.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/THE DATE FOLLOWS THE AUTHOR TOO/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/A repost carries its own timestamp and that is not the prediction's date/);
  });
});

describe('the screenshot prompt, the framing test (2026-09-16)', () => {
  it('decides framing by the sentence, not by where the phrase sits', () => {
    // Runs 9 and 10 disagreed on the same image: "mark my words" runs on
    // inside "they will NEVER be Blue mark my words." with no punctuation
    // before it, so it is part of the sentence and stays. "At the edge of
    // the statement" could be read either way; punctuation cannot.
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/THE TEST IS THE SENTENCE, NOT THE POSITION/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/Look for the punctuation, not for the phrase/);
    expect(EXTRACT_SYSTEM_PROMPT).not.toMatch(/at the edge of the statement/);
  });
});
