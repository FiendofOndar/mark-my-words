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

/**
 * The same day as `daysFromNow`, written out.
 *
 * Never `.slice(0, 10)` on one of these. They are local end-of-day instants, so
 * in any timezone west of Greenwich the UTC date is already tomorrow: a claim
 * whose deadline rendered as Sep 11 had criteria written about Sep 12, and
 * every check then correctly answered that the day was not over yet.
 */
function dayOf(iso: string): string {
  return toLocalDateInput(iso);
}

/** M/D/YYYY, the way the claim would actually have been said out loud. */
function usDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
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

    const cardinals = db.predictions.create({
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

    // A check log with a queued verdict, so the evidence trail and the approval
    // step are visible without waiting for a real check to land.
    db.checks.create({
      predictionId: cardinals.id,
      trigger: 'pull',
      provider: 'demo',
      model: 'demo',
      proposedVerdict: 'no_change',
      proposedTrend: 'flat',
      rubricScore: 12,
      rubricBreakdown: {
        independentSources: 0,
        sourceTier: 0,
        urlValidation: 0,
        criteriaCoverage: 0,
        temporalSanity: 0,
        capApplied: false,
        gates: ['No sources were cited.'],
      },
      modelConfidence: 12,
      summary: 'The postseason has not started. Nothing to report yet.',
      outcome: 'no_change',
      evidence: [],
    });

    db.checks.create({
      predictionId: cardinals.id,
      trigger: 'pull',
      provider: 'demo',
      model: 'demo',
      proposedVerdict: 'hit',
      proposedTrend: 'toward_yes',
      rubricScore: 98,
      rubricBreakdown: {
        independentSources: 30,
        sourceTier: 25,
        urlValidation: 20,
        criteriaCoverage: 15,
        temporalSanity: 10,
        capApplied: true,
        gates: [],
      },
      modelConfidence: 68,
      summary:
        'St. Louis took the series in six games, closing it out at home on Sunday night.',
      outcome: 'queued',
      evidence: [
        {
          url: 'https://apnews.com/article/cardinals-win-2026-world-series',
          title: 'Cardinals take the series',
          publisher: 'AP',
          publishedAt: dayOf(daysFromNow(-1)),
          quotedText: 'The Cardinals took the series in six games on Sunday night.',
          tier: 'major_outlet',
          fetchStatus: 'ok',
          fetchedAt: nowIso(),
        },
        {
          url: 'https://www.reuters.com/sports/baseball/cardinals-win-2026',
          title: 'St. Louis wins it all',
          publisher: 'Reuters',
          publishedAt: dayOf(daysFromNow(-1)),
          quotedText: 'St. Louis closed out the series at home.',
          tier: 'major_outlet',
          fetchStatus: 'ok',
          fetchedAt: nowIso(),
        },
        {
          url: 'https://www.mlb.com/news/2026-world-series-recap',
          title: 'Series recap',
          publisher: 'MLB.com',
          publishedAt: dayOf(daysFromNow(-1)),
          quotedText: 'A championship six years in the making.',
          tier: 'primary',
          fetchStatus: 'blocked',
          fetchedAt: nowIso(),
        },
      ],
    });
    db.predictions.update(cardinals.id, {
      lastCheckedAt: nowIso(),
      checkCount: 2,
      trend: 'toward_yes',
      criteriaFrozenAt: nowIso(),
      updatedAt: nowIso(),
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

    /*
     * A live API test fixture, dated so it is always already resolvable: a
     * local weather claim from two days ago that came due yesterday. Recent,
     * narrow, and settled by public record, which makes it the cheapest way to
     * tell whether verification actually works end to end.
     */
    const weather = db.predictions.create({
      authorId: self.id,
      rawStatement: 'Anacortes WA temps will hit 85 F on ' + usDate(daysFromNow(-1)) + '.',
      normalizedClaim:
        'The daily high temperature recorded for Anacortes, Washington reached 85 degrees Fahrenheit or higher on ' +
        dayOf(daysFromNow(-1)) +
        '.',
      statementDate: daysFromNow(-2),
      sourceContext: 'Dinner',
      deadlineType: 'fixed_date',
      resolutionDate: daysFromNow(-1),
      verificationMode: 'searchable',
      category: 'Weather/Climate',
      criteria: [
        // "serving Anacortes" had no edge to it: the nearest airport with a
        // climate record is Sea-Tac, seventy miles south, and it was cited as
        // though it covered the town. A place needs pinning as tightly as a
        // number does.
        'The daily high temperature recorded at an official weather station within 25 miles of Anacortes, WA is 85 degrees Fahrenheit or higher on ' +
          dayOf(daysFromNow(-1)),
      ],
      searchQueries: [
        'Anacortes WA high temperature ' + dayOf(daysFromNow(-1)),
        'Anacortes Washington weather history daily high ' + dayOf(daysFromNow(-1)),
        'Skagit Regional Airport KBVS observed high ' + dayOf(daysFromNow(-1)),
      ],
    });
    db.predictions.update(weather.id, { trend: 'unknown', updatedAt: nowIso() });

    /*
     * The second live test fixture, chosen to exercise what the weather one
     * cannot. That claim is a miss on a numeric threshold, pinned to a place,
     * settled by a .gov page that rewrites itself hourly. This one is a hit on
     * two discrete facts, with no geography, settled by static recaps that have
     * not changed since the night they were published.
     *
     * Which makes it the only fair test of quote matching in the whole app: if
     * it cannot confirm a sentence in an ESPN recap from February 2025, it
     * cannot confirm anything, and the page-fetching layer should go.
     *
     * The result is real and was checked against live sources before seeding.
     * A fabricated demo verdict about a real team has already misled someone
     * once in this app's short life; do not do it again.
     */
    const superBowl = db.predictions.create({
      authorId: popops.id,
      rawStatement: 'Mark my words, the Eagles are going to win it all this year.',
      normalizedClaim: 'The Philadelphia Eagles win Super Bowl LIX.',
      statementDate: '2025-01-20T12:00:00.000Z',
      sourceContext: 'Said at dinner, loudly',
      deadlineType: 'fixed_date',
      resolutionDate: '2025-02-09T23:59:59.999Z',
      verificationMode: 'searchable',
      category: 'Sports',
      stakes: 'A steak dinner',
      criteria: [
        'The Philadelphia Eagles win Super Bowl LIX, played on February 9, 2025',
        'The team they defeat in that game is the Kansas City Chiefs',
      ],
      searchQueries: [
        'Super Bowl LIX final score Eagles Chiefs',
        'Super Bowl LIX February 9 2025 result recap',
        'Eagles win Super Bowl LIX box score',
      ],
    });
    db.predictions.update(superBowl.id, { trend: 'unknown', updatedAt: nowIso() });

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
