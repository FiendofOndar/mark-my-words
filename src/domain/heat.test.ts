import { describe, expect, it } from 'vitest';
import { heatScore, sortByHeat, type HeatInput } from './heat';
import { NOW, isoDaysFrom, makePrediction } from './fixtures';

const ids = (items: HeatInput[]) => items.map((i) => i.prediction.id);

function at(days: number, overrides: Parameters<typeof makePrediction>[0] = {}): HeatInput {
  return { prediction: makePrediction({ resolutionDate: isoDaysFrom(NOW, days), ...overrides }) };
}

describe('heat score', () => {
  it('puts an overdue open prediction above everything else', () => {
    expect(heatScore(at(-1), NOW)).toBeGreaterThan(heatScore(at(1), NOW));
  });

  it('ranks a queued verdict above a draft', () => {
    const queued = { ...at(200), hasQueuedVerdict: true };
    const draft = at(200, { status: 'draft' });
    expect(heatScore(queued, NOW)).toBeGreaterThan(heatScore(draft, NOW));
  });

  it('gives a deleted prediction no heat at all', () => {
    expect(heatScore(at(-5, { deletedAt: NOW.toISOString() }), NOW)).toBe(-1);
  });

  it('flattens past sixty days, which is why the sort needs a tiebreaker', () => {
    expect(heatScore(at(90), NOW)).toBe(heatScore(at(900), NOW));
  });
});

describe('sortByHeat', () => {
  it('orders the far-future tail by deadline rather than arbitrarily', () => {
    const soon = at(150);
    const later = at(400);
    const latest = at(900);
    expect(ids(sortByHeat([latest, soon, later], NOW))).toEqual(ids([soon, later, latest]));
    expect(ids(sortByHeat([later, latest, soon], NOW))).toEqual(ids([soon, later, latest]));
  });

  it('is stable across repeated calls on rows that share a timestamp', () => {
    const a = at(400);
    const b = at(400);
    const c = at(400);
    const first = ids(sortByHeat([a, b, c], NOW));
    expect(ids(sortByHeat([c, a, b], NOW))).toEqual(first);
    expect(ids(sortByHeat([b, c, a], NOW))).toEqual(first);
  });

  it('sinks an open-ended claim below anything with a date', () => {
    const dated = at(900);
    const openEnded: HeatInput = {
      prediction: makePrediction({
        deadlineType: 'event',
        resolutionDate: null,
        triggerExpectedDate: null,
        staleOutDate: null,
      }),
    };
    expect(ids(sortByHeat([openEnded, dated], NOW))).toEqual(ids([dated, openEnded]));
    expect(ids(sortByHeat([dated, openEnded], NOW))).toEqual(ids([dated, openEnded]));
  });

  it('does not let the tiebreaker override heat', () => {
    const overdue = at(-1);
    const nextWeek = at(7);
    expect(ids(sortByHeat([nextWeek, overdue], NOW))).toEqual(ids([overdue, nextWeek]));
  });
});
