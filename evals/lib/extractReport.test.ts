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

  it('calls a case with no expected values unconfirmed rather than passed', () => {
    expect(statusOf(undefined, [])).toBe('unconfirmed');
    expect(statusOf({}, [])).toBe('unconfirmed');
  });
});

describe('the job summary', () => {
  it('lists every row and shows the raw response only where it is needed', () => {
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
    expect(md).not.toContain('<summary>a.png');
    expect(md).toContain('| c.png | error | The request timed out. |');
  });
});
