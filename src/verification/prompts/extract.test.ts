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
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/any tag, acronym or symbol at the edge of the statement/);
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
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/never continue the text yourself/);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/never put a remark of your own in statement/);
  });

  it('requires every field so none is silently left out', () => {
    // platform, posted_hint and note were absent from half the answers.
    expect([...EXTRACT_RESPONSE_SCHEMA.required]).toEqual(Object.keys(EXTRACT_RESPONSE_SCHEMA.properties));
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/EVERY FIELD, EVERY TIME/);
  });
});
