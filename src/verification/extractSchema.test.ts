import { describe, expect, it } from 'vitest';
import { parseExtractedPost } from './extractSchema';

describe('reading the model\'s view of a screenshot', () => {
  it('keeps a full date and passes a hint through', () => {
    expect(parseExtractedPost({ is_prediction: true, statement: 'x', posted_on: '2026-09-09' }).postedOn).toBe(
      '2026-09-09',
    );
    expect(parseExtractedPost({ is_prediction: true, statement: 'x', posted_hint: '2y' })).toMatchObject({
      postedOn: null,
      postedHint: '2y',
    });
  });

  it('turns a posted_on that is not a full date into the hint', () => {
    // Five device shares on 2026-09-13 all came back with the date field
    // silently defaulting to today; a partial date is the reason, shown.
    expect(parseExtractedPost({ is_prediction: true, statement: 'x', posted_on: 'Sep 9' })).toMatchObject({
      postedOn: null,
      postedHint: 'Sep 9',
    });
  });

  it('drops the statement when the model says it is not a prediction', () => {
    const post = parseExtractedPost({ is_prediction: false, statement: 'nice weather', note: 'a photo' });
    expect(post.isPrediction).toBe(false);
    expect(post.statement).toBeNull();
    expect(post.note).toBe('a photo');
  });
});
