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
