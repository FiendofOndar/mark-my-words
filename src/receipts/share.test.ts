import { describe, expect, it } from 'vitest';
import { receiptFilename } from './share';

describe('receipt filenames', () => {
  it('slugs the subject', () => {
    expect(receiptFilename('Popops: The Cardinals will win!', 'receipt')).toBe(
      'mark-my-words-receipt-popops-the-cardinals-will-win.png',
    );
  });

  it('caps the length so a long quote does not become the filename', () => {
    const name = receiptFilename('a'.repeat(200), 'scorecard');
    expect(name.length).toBeLessThan(70);
    expect(name.startsWith('mark-my-words-scorecard-')).toBe(true);
  });

  it('falls back when the subject has nothing sluggable in it', () => {
    expect(receiptFilename('!!! ???', 'receipt')).toBe('mark-my-words-receipt-card.png');
  });
});
