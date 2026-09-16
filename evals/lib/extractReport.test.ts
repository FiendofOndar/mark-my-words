import { describe, expect, it } from 'vitest';
import { compareExtract, renderMarkdown, statusOf, type ExtractRow } from './extractReport';
import type { ExtractedPost } from '../../src/verification/types';

const post: ExtractedPost = {
  isPrediction: true,
  statement: 'Mark my words,  the Eagles win it all',
  author: 'u/Tenchi2020',
  platform: 'Reddit',
  postedOn: null,
  postedHint: '2y',
  note: null,
};

describe('comparing a case to what the model read', () => {
  it('checks only the fields the case names', () => {
    expect(compareExtract({ author: 'u/tenchi2020' }, post)).toEqual([]);
    expect(statusOf({ author: 'u/tenchi2020' }, [])).toBe('pass');
  });

  it('is exact on the statement apart from whitespace, folded on handles and platforms', () => {
    expect(compareExtract({ statement: 'Mark my words, the Eagles win it all' }, post)).toEqual([]);
    expect(compareExtract({ statement: 'mark my words, the eagles win it all' }, post)).toHaveLength(1);
    expect(compareExtract({ platform: 'reddit' }, post)).toEqual([]);
  });

  it('treats an expected null as "the model must return nothing"', () => {
    expect(compareExtract({ posted_on: null, posted_hint: '2y' }, post)).toEqual([]);
    const diffs = compareExtract({ posted_hint: null }, post);
    expect(diffs).toEqual([{ field: 'posted_hint', expected: null, actual: '2y' }]);
  });

  it('bounds a cut-off post by its visible words without fixing where it ends', () => {
    // The screen showed two lines and "...more"; the model wrote five
    // hundred more. Either ending the owner might pick starts the same way
    // and is shorter than the visible text.
    const cut = { ...post, statement: 'There will be a silent march in New York. Not for him, but for all the lives lost and ruine' };
    const invented = { ...post, statement: `${cut.statement}d by his company. It will happen very soon and bring crowds.` };
    const rule = { statement_starts_with: 'There will be a silent march in New York.', statement_max_length: 95 };
    expect(compareExtract(rule, cut)).toEqual([]);
    expect(compareExtract(rule, { ...post, statement: 'There will be a silent march in New York.' })).toEqual([]);
    expect(compareExtract(rule, invented).map((d) => d.field)).toEqual(['statement_max_length']);
    expect(compareExtract(rule, { ...post, statement: 'MMW: There will be a silent march' }).map((d) => d.field)).toEqual([
      'statement_starts_with',
    ]);
  });

  it('calls a case with no expected values unconfirmed rather than passed', () => {
    expect(statusOf(undefined, [])).toBe('unconfirmed');
    expect(statusOf({}, [])).toBe('unconfirmed');
  });
});

describe('the job summary', () => {
  it('lists every row and collapses the raw response under each', () => {
    const rows: ExtractRow[] = [
      { file: 'a.png', status: 'pass', diffs: [], rawText: '{"a":1}', tokens: 900, error: null },
      {
        file: 'b.png',
        status: 'fail',
        diffs: [{ field: 'author', expected: 'u/x', actual: null }],
        rawText: '{"author":null}',
        tokens: 950,
        error: null,
      },
      { file: 'c.png', status: 'error', diffs: [], rawText: null, tokens: null, error: 'The request timed out.' },
    ];
    const md = renderMarkdown(rows, 'Extraction');
    expect(md).toContain('1 pass, 1 fail, 0 unconfirmed, 1 error.');
    expect(md).toContain('| a.png | pass |');
    expect(md).toContain('author: expected "u/x", got null');
    expect(md).toContain('<summary>b.png: what the model said</summary>');
    expect(md).toContain('"author": null');
    expect(md).toContain('<summary>a.png: what the model said</summary>');
    expect(md).toContain('| c.png | error | The request timed out. |');
  });
});

describe('pinning one fact inside a free-text note', () => {
  it('matches a substring, case-insensitively, and fails when the fact is missing', () => {
    // A quote tweet whose subject is only "He": the statement is verbatim,
    // so the note is the only place the person's name can appear.
    const named = { ...post, note: 'Posted in response to a comment about whether Jimbo Fisher will win another title.' };
    expect(compareExtract({ note_contains: 'Jimbo' }, named)).toEqual([]);
    expect(compareExtract({ note_contains: 'jimbo' }, named)).toEqual([]);
    expect(compareExtract({ note_contains: 'Jimbo' }, { ...post, note: 'A football post.' })).toHaveLength(1);
    expect(compareExtract({ note_contains: 'Jimbo' }, { ...post, note: null })).toHaveLength(1);
  });
});
