import { describe, expect, it } from 'vitest';
import { sortFeed } from './feedSort';
import { makePrediction } from './fixtures';
import type { Prediction } from './types';

const NOW = new Date('2026-09-13T12:00:00-07:00');

function item(id: string, patch: Partial<Prediction>, author = 'Me') {
  return { prediction: makePrediction({ id, ...patch }), author: { displayName: author } };
}

describe('sortFeed', () => {
  const overdue = item('a', { resolutionDate: '2026-09-01T06:59:59.999Z', statementDate: '2026-01-01T12:00:00.000Z' }, 'Zed');
  const soon = item('b', { resolutionDate: '2026-09-20T06:59:59.999Z', statementDate: '2026-06-01T12:00:00.000Z' }, 'Ann');
  const far = item('c', { resolutionDate: '2027-09-20T06:59:59.999Z', statementDate: '2026-03-01T12:00:00.000Z' }, 'Mo');

  it('defaults to heat: overdue first', () => {
    expect(sortFeed([far, soon, overdue], 'heat', NOW).map((i) => i.prediction.id)).toEqual(['a', 'b', 'c']);
  });

  it('pinned rows hold the top in the order they were pinned, whatever the sort', () => {
    const pinnedFar = { ...far, prediction: { ...far.prediction, pinnedAt: '2026-09-13T10:00:00.000Z' } };
    const pinnedSoon = { ...soon, prediction: { ...soon.prediction, pinnedAt: '2026-09-13T09:00:00.000Z' } };
    for (const sort of ['heat', 'deadline', 'newest', 'oldest', 'author'] as const) {
      expect(sortFeed([overdue, pinnedFar, pinnedSoon], sort, NOW).map((i) => i.prediction.id)).toEqual([
        'b',
        'c',
        'a',
      ]);
    }
  });

  it('orders by the date said, both ways', () => {
    expect(sortFeed([far, soon, overdue], 'newest', NOW).map((i) => i.prediction.id)).toEqual(['b', 'c', 'a']);
    expect(sortFeed([far, soon, overdue], 'oldest', NOW).map((i) => i.prediction.id)).toEqual(['a', 'c', 'b']);
  });

  it('deadline puts the soonest first and open-ended claims last', () => {
    const openEnded = item('d', { deadlineType: 'event', resolutionDate: null, triggerExpectedDate: null });
    expect(sortFeed([openEnded, far, soon, overdue], 'deadline', NOW).map((i) => i.prediction.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('author is A to Z, case-blind', () => {
    expect(sortFeed([overdue, far, soon], 'author', NOW).map((i) => i.author.displayName)).toEqual([
      'Ann',
      'Mo',
      'Zed',
    ]);
  });
});
