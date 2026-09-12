import { describe, expect, it } from 'vitest';
import { quoteSizeFor } from './ReceiptCard';

describe('fitting a statement onto a fixed card', () => {
  it('uses the largest size for something short', () => {
    expect(quoteSizeFor('The Cardinals will win the World Series this year.').fontSize).toBe(72);
  });

  it('steps down as the statement grows', () => {
    const sizes = [80, 180, 300, 600].map((n) => quoteSizeFor('x'.repeat(n)).fontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(new Set(sizes).size).toBe(4);
  });

  it('never goes below something readable at a glance', () => {
    expect(quoteSizeFor('x'.repeat(5000)).fontSize).toBeGreaterThanOrEqual(36);
  });

  it('allows more lines as the type gets smaller', () => {
    expect(quoteSizeFor('x'.repeat(600)).WebkitLineClamp).toBeGreaterThan(
      quoteSizeFor('short').WebkitLineClamp,
    );
  });

  it('ignores surrounding whitespace when measuring', () => {
    expect(quoteSizeFor(`   ${'x'.repeat(100)}   `).fontSize).toBe(
      quoteSizeFor('x'.repeat(100)).fontSize,
    );
  });
});
