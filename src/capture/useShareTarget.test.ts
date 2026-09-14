import { describe, expect, it } from 'vitest';
import { normalizeIntent } from './useShareTarget';

describe('a share from another app', () => {
  it('keeps the quote and the link apart', () => {
    expect(
      normalizeIntent({
        description: 'Mark my words, the bubble pops by spring https://example.com/post',
      }),
    ).toEqual({
      text: 'Mark my words, the bubble pops by spring',
      url: 'https://example.com/post',
      imageUri: null,
      mimeType: null,
    });
  });

  it('prefers the url the intent supplied over one scraped from the text', () => {
    expect(
      normalizeIntent({
        url: 'https://reddit.com/r/x/comments/y',
        description: 'see https://shortener.example/abc',
      }).url,
    ).toBe('https://reddit.com/r/x/comments/y');
  });

  it('does not carry a bare link into the statement field', () => {
    expect(normalizeIntent({ description: 'https://example.com/post' })).toEqual({
      text: '',
      url: 'https://example.com/post',
      imageUri: null,
      mimeType: null,
    });
  });

  it('falls back to the title when there is no description', () => {
    expect(normalizeIntent({ title: 'They will never ship it' }).text).toBe(
      'They will never ship it',
    );
  });

  it('decodes percent-encoded text', () => {
    expect(normalizeIntent({ description: 'winter%20is%20coming' }).text).toBe('winter is coming');
  });

  it('survives text that is not valid percent encoding', () => {
    expect(normalizeIntent({ description: '100% certain' }).text).toBe('100% certain');
  });

  it('reports nothing usable when nothing was shared', () => {
    expect(normalizeIntent({})).toEqual({ text: '', url: null, imageUri: null, mimeType: null });
  });

  it('keeps a shared image as an image, not as a link', () => {
    // A screenshot arrives with its MIME type and a content:// URI in the
    // same field a web link uses. It used to be ignored entirely.
    expect(
      normalizeIntent({
        type: 'image/png',
        url: 'content://media/external/images/media/1234',
      }),
    ).toEqual({
      text: '',
      url: null,
      imageUri: 'content://media/external/images/media/1234',
      mimeType: 'image/png',
    });
  });
});
