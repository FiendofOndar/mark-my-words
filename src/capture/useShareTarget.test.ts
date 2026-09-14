import { describe, expect, it } from 'vitest';
import { describeShare, normalizeShare } from './useShareTarget';

const PNG = 'iVBORw0KGgo=';

describe('a share from another app', () => {
  it('keeps the quote and the link apart', () => {
    expect(
      normalizeShare({
        received: true,
        type: 'text/plain',
        text: 'Mark my words, the bubble pops by spring https://example.com/post',
      }),
    ).toEqual({
      text: 'Mark my words, the bubble pops by spring',
      url: 'https://example.com/post',
      image: null,
      note: null,
    });
  });

  it('does not carry a bare link into the statement field', () => {
    // A browser shares the page title as the subject and the address as the
    // text. The title is not a claim either.
    expect(
      normalizeShare({
        received: true,
        type: 'text/plain',
        title: 'Some page title',
        text: 'https://example.com/post',
      }),
    ).toEqual({ text: '', url: 'https://example.com/post', image: null, note: null });
  });

  it('falls back to the title when there is no text', () => {
    expect(normalizeShare({ received: true, type: 'text/plain', title: 'They will never ship it' }).text).toBe(
      'They will never ship it',
    );
  });

  it('reports nothing usable when nothing was shared', () => {
    expect(normalizeShare({ received: true, type: 'text/plain' })).toEqual({
      text: '',
      url: null,
      image: null,
      note: null,
    });
  });

  it('keeps a shared picture as a picture, with the type the provider reported', () => {
    expect(
      normalizeShare({ received: true, type: 'image/*', imageData: PNG, imageType: 'image/png' }),
    ).toEqual({ text: '', url: null, image: { data: PNG, mimeType: 'image/png' }, note: null });
  });

  it('assumes jpeg when the picture type is a wildcard', () => {
    expect(normalizeShare({ received: true, type: 'image/*', imageData: PNG }).image?.mimeType).toBe(
      'image/jpeg',
    );
  });

  it('turns a picture that could not be read into a note, not an empty form', () => {
    const shared = normalizeShare({
      received: true,
      type: 'image/png',
      error: 'Could not read the shared picture: permission denied',
    });
    expect(shared.image).toBeNull();
    expect(shared.note).toBe('Could not read the shared picture: permission denied');
  });

  it('describes what arrived in one line', () => {
    const result = { received: true, type: 'image/png', imageData: PNG, imageType: 'image/png' };
    expect(describeShare(result, normalizeShare(result))).toBe(
      'type image/png, picture image/png, 0 KB. Opened the capture screen.',
    );
    const empty = { received: true, type: 'text/plain' };
    expect(describeShare(empty, normalizeShare(empty))).toBe(
      'type text/plain. Nothing usable, so nothing opened.',
    );
  });
});
