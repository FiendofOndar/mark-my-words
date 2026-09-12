import { describe, expect, it } from 'vitest';
import { cooldownFor, describeCooldown, isCoolingDown, nextPacificMidnight } from './cooldown';

describe('when to try again', () => {
  it('honors a wait the provider actually stated', () => {
    const now = new Date('2026-09-12T20:00:00.000Z');
    const c = cooldownFor('minute', 45, now)!;
    expect(new Date(c.until).getTime() - now.getTime()).toBe(45_000);
  });

  it('waits for the Pacific reset on a daily limit', () => {
    const now = new Date('2026-09-12T20:00:00.000Z');
    const c = cooldownFor('day', null, now)!;
    expect(new Date(c.until).getTime()).toBe(nextPacificMidnight(now).getTime());
    expect(c.reason).toMatch(/midnight Pacific/);
  });

  it('waits a short while on a first unclassified quota error', () => {
    // Free exhaustion and a paid account's momentary limit look identical: a
    // bare 429 with no metric and no delay. Parking a paid key until morning
    // over a blip is the worse mistake, so the first one is a short wait.
    const now = new Date('2026-09-12T20:00:00.000Z');
    const c = cooldownFor('unknown', null, now, 1)!;
    const minutes = (new Date(c.until).getTime() - now.getTime()) / 60_000;
    expect(minutes).toBe(15);
  });

  it('escalates when it keeps happening', () => {
    const now = new Date('2026-09-12T20:00:00.000Z');
    const second = cooldownFor('unknown', null, now, 2)!;
    expect((new Date(second.until).getTime() - now.getTime()) / 60_000).toBe(60);

    const third = cooldownFor('unknown', null, now, 3)!;
    expect(new Date(third.until).getTime()).toBe(nextPacificMidnight(now).getTime());
    expect(third.reason).toMatch(/repeatedly/i);
  });

  it('waits only a minute on a per-minute limit with no stated delay', () => {
    const now = new Date('2026-09-12T20:00:00.000Z');
    const c = cooldownFor('minute', null, now)!;
    expect(new Date(c.until).getTime() - now.getTime()).toBe(60_000);
  });
});

describe('the Pacific reset', () => {
  it('lands at midnight Pacific, not local or UTC midnight', () => {
    const now = new Date('2026-09-12T20:00:00.000Z'); // 1pm PDT
    const reset = nextPacificMidnight(now);
    const asPacific = reset.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hour12: false,
    });
    expect(Number(asPacific)).toBe(0);
    expect(reset.getTime()).toBeGreaterThan(now.getTime());
  });

  it('is always in the future, even just after midnight Pacific', () => {
    const now = new Date('2026-09-12T07:05:00.000Z'); // 00:05 PDT
    expect(nextPacificMidnight(now).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('holding off', () => {
  const now = new Date('2026-09-12T20:00:00.000Z');

  it('holds while the window is open and stops when it closes', () => {
    const c = cooldownFor('minute', 60, now)!;
    expect(isCoolingDown(c, now)).toBe(true);
    expect(isCoolingDown(c, new Date(now.getTime() + 61_000))).toBe(false);
    expect(isCoolingDown(null, now)).toBe(false);
  });

  it('says how long is left in units a person reads', () => {
    expect(describeCooldown(cooldownFor('minute', 120, now)!, now)).toMatch(/2 minutes/);
    expect(describeCooldown(cooldownFor('day', null, now)!, now)).toMatch(/hours/);
  });
});
