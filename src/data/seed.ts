/**
 * Demo data for the empty state. Covers every verdict state so the feed and the
 * stamps can be seen without waiting months for something to resolve.
 * Clearable from Settings.
 */
import type { Db } from './db';
import { SETTING_KEYS } from './repositories/settingsRepo';
import { endOfLocalDay, startOfLocalDay, toLocalDateInput } from '../domain/prediction';
import { nowIso } from '../lib/ids';

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return endOfLocalDay(toLocalDateInput(d.toISOString()));
}

function monthsFromNow(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return endOfLocalDay(toLocalDateInput(d.toISOString()));
}

export function seedDemoData(db: Db): void {
  if (db.settings.get(SETTING_KEYS.seeded) === 'true') return;

  db.driver.transaction(() => {
    const liz = db.authors.findOrCreate({ displayName: 'LizTheDeveloper', handle: '@lizthedeveloper' });
    const reddit = db.authors.findOrCreate({ displayName: 'r/MarvelStudios', handle: 'reddit', kind: 'outlet' });
    const popops = db.authors.findOrCreate({ displayName: 'Popops' });
    const cnn = db.authors.findOrCreate({ displayName: 'CNN', kind: 'outlet' });
    const economist = db.authors.findOrCreate({ displayName: 'Economist Review Column', kind: 'outlet' });
    const self = db.authors.findOrCreate({ displayName: 'Me', kind: 'self' });

    db.predictions.create({
      authorId: liz.id,
      rawStatement:
        'Mark my words, we will see the first rogue AI drone strikes in the next 6 months.',
      normalizedClaim:
        'A drone strike carried out autonomously by an AI system without human authorization is publicly reported.',
      statementDate: daysFromNow(-20),
      sourceUrl: 'https://www.instagram.com/p/example-rogue-drone',
      sourceContext: 'Instagram story',
      deadlineType: 'fixed_date',
      resolutionDate: monthsFromNow(5),
      verificationMode: 'searchable',
      category: 'Tech/AI',
      criteria: [
        'A drone strike occurs that was authorized by an autonomous system, not a human operator',
        'The incident is reported by at least two established news outlets',
        'It occurs on or before the deadline',
      ],
      searchQueries: ['autonomous drone strike no human authorization', 'rogue AI drone attack reported'],
    });

    db.predictions.create({
      authorId: reddit.id,
      rawStatement: 'Thor will lose his arm in Avengers: Doomsday.',
      normalizedClaim: 'Thor loses an arm on screen in Avengers: Doomsday.',
      statementDate: daysFromNow(-95),
      sourceUrl: 'https://www.reddit.com/r/MarvelStudios/comments/example',
      sourceContext: 'Reddit fan theory thread',
      deadlineType: 'event',
      triggerEvent: 'Avengers: Doomsday releases in theaters',
      triggerExpectedDate: monthsFromNow(14),
      staleOutDate: monthsFromNow(60),
      verificationMode: 'searchable',
      category: 'Entertainment',
      criteria: ['Avengers: Doomsday is released', 'Thor loses an arm during the film'],
    });

    db.predictions.create({
      authorId: popops.id,
      rawStatement: 'The Cardinals will win the World Series this year.',
      normalizedClaim: 'The St. Louis Cardinals win the 2026 World Series.',
      statementDate: daysFromNow(-160),
      sourceContext: 'Said at dinner, twice',
      deadlineType: 'fixed_date',
      resolutionDate: daysFromNow(45),
      verificationMode: 'searchable',
      category: 'Sports',
      stakes: '$20',
      criteria: ['The St. Louis Cardinals win the 2026 World Series'],
    });

    db.predictions.create({
      authorId: cnn.id,
      rawStatement:
        "Next year's winter is going to be bigger than anything we have seen in a decade.",
      normalizedClaim:
        'The 2026-27 North American winter exceeds every winter of the previous ten years on snowfall or cold severity.',
      statementDate: daysFromNow(-8),
      sourceUrl: 'https://www.cnn.com/example-winter-forecast',
      sourceContext: 'CNN weather segment',
      deadlineType: 'window',
      windowStart: startOfLocalDay('2026-12-01'),
      windowEnd: endOfLocalDay('2027-03-20'),
      verificationMode: 'searchable',
      category: 'Weather/Climate',
      criteria: [
        'NOAA or an equivalent agency reports the season exceeded the prior ten winters on snowfall or cold severity',
        'The finding covers the 2026-27 winter season',
      ],
    });

    db.predictions.create({
      authorId: self.id,
      rawStatement:
        'I bet the neighbors across the street will leave me alone about the gutters by Halloween.',
      normalizedClaim: 'The neighbors stop raising the gutters with me before October 31.',
      statementDate: daysFromNow(-30),
      sourceContext: 'Muttered while carrying a ladder',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2026-10-31'),
      verificationMode: 'manual',
      category: 'Personal',
      criteria: ['No further mention of the gutters from the neighbors before October 31'],
    });

    // A resolved miss that came true two years later. Demonstrates the badge.
    const late = db.predictions.create({
      authorId: economist.id,
      rawStatement: 'The AI bubble will crash within 6 months.',
      normalizedClaim:
        'An AI-weighted equity index falls 30% or more from its peak within six months.',
      statementDate: '2024-01-15T12:00:00.000Z',
      sourceUrl: 'https://example.com/economist-review-ai-bubble',
      sourceContext: 'Opinion column',
      deadlineType: 'fixed_date',
      resolutionDate: '2024-07-15T23:59:59.999Z',
      verificationMode: 'searchable',
      category: 'Economics',
      criteria: [
        'An AI-weighted equity index falls 30% or more from its peak',
        'The fall occurs within six months of the statement',
      ],
    });
    db.predictions.update(late.id, {
      status: 'miss',
      resolvedAt: '2024-07-16T09:00:00.000Z',
      resolvedBy: 'user',
      trend: null,
      lateWatchUntil: '2027-07-15T23:59:59.999Z',
      lateHitAt: '2025-11-04T00:00:00.000Z',
      lastCheckedAt: '2025-11-04T00:00:00.000Z',
      checkCount: 11,
      updatedAt: nowIso(),
    });

    // A clean hit, so the stamp has something to sit on.
    const hit = db.predictions.create({
      authorId: self.id,
      rawStatement: 'Bitcoin passes $100k before the end of 2024.',
      normalizedClaim: 'Bitcoin trades above $100,000 USD before December 31, 2024.',
      statementDate: '2024-03-01T12:00:00.000Z',
      deadlineType: 'fixed_date',
      resolutionDate: '2024-12-31T23:59:59.999Z',
      verificationMode: 'searchable',
      category: 'Economics',
      stakes: 'a beer',
      criteria: ['Bitcoin trades above $100,000 USD', 'Before December 31, 2024'],
    });
    db.predictions.update(hit.id, {
      status: 'hit',
      resolvedAt: '2024-12-05T18:00:00.000Z',
      resolvedBy: 'user',
      trend: null,
      confidenceScore: 97,
      lastCheckedAt: '2024-12-05T18:00:00.000Z',
      checkCount: 6,
      updatedAt: nowIso(),
    });

    db.settings.set(SETTING_KEYS.seeded, 'true');
  });
}

export function clearDemoFlag(db: Db): void {
  db.settings.set(SETTING_KEYS.seeded, 'false');
}
