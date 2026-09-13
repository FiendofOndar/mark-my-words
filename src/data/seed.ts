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
      /*
       * "Rogue" is the load-bearing word and the first version of this seed
       * dropped it, testing "autonomous" instead. A drone striking without a
       * human in the loop is doing what it was built to do; a rogue one acts
       * against its orders or its programming. The easier reading settled as
       * a hit on a July strike the model found in August reporting, which was
       * the app's first wrong verdict on a real claim. The owner caught the
       * dropped word; the criteria now carry it.
       */
      normalizedClaim:
        'An AI-controlled drone carries out a strike against its orders or its programming, and the incident is publicly reported.',
      statementDate: daysFromNow(-20),
      sourceUrl: 'https://www.instagram.com/p/example-rogue-drone',
      sourceContext: 'Instagram story',
      deadlineType: 'fixed_date',
      resolutionDate: monthsFromNow(5),
      verificationMode: 'searchable',
      category: 'Tech/AI',
      criteria: [
        'An AI-controlled drone carries out a strike against its orders or its programming (rogue), not merely without a human in the loop',
        'The incident is reported by at least two established news outlets',
        'The strike happens after the claim was made and on or before the deadline',
      ],
      searchQueries: ['rogue AI drone strike against orders', 'AI drone attacked wrong target against programming reported'],
    });

    /*
     * Live API test fixtures, chosen so one pull covers six different shapes
     * of check. Each is settled by public record and was verified against
     * live sources before it was written here (see the commit). The two
     * below plus the four further down are the whole live set; the budget
     * of six per pull is why there are not more.
     *
     * A film plot point. A different kind of fact from a score or a reading:
     * nothing is measured, it is simply what happens in the story, and every
     * synopsis on the web says so. Released December 17, 2003; the One Ring
     * goes into the fire at Mount Doom.
     */
    db.predictions.create({
      authorId: reddit.id,
      rawStatement: 'Mark my words, the hobbits actually destroy the ring in Return of the King. No fake-out.',
      normalizedClaim:
        'In The Lord of the Rings: The Return of the King (2003), the One Ring is destroyed at Mount Doom.',
      statementDate: '2003-11-01T12:00:00.000Z',
      sourceContext: 'Forum thread, before the film opened',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2003-12-31'),
      verificationMode: 'searchable',
      category: 'Entertainment',
      criteria: [
        'The Lord of the Rings: The Return of the King is released in theaters in 2003',
        'In the film, the One Ring is destroyed in the fire of Mount Doom',
      ],
      searchQueries: [
        'Return of the King 2003 plot Mount Doom ring destroyed',
        'Return of the King release date December 2003',
      ],
    });

    /*
     * A partial. Oppenheimer won Best Picture at the 96th Academy Awards on
     * March 10, 2024; Best Actress went to Emma Stone for Poor Things, and no
     * Oppenheimer performer was nominated in that category. One criterion
     * holds and one fails, which is the one verdict the app never applies on
     * its own, so this exercises the approval card and the mixed ticks.
     */
    db.predictions.create({
      authorId: liz.id,
      rawStatement: 'Oppenheimer sweeps. Best Picture AND Best Actress. Mark my words.',
      normalizedClaim:
        'Oppenheimer wins both Best Picture and Best Actress at the 96th Academy Awards on March 10, 2024.',
      statementDate: '2024-01-24T12:00:00.000Z',
      sourceContext: 'Group chat, the day after nominations',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2024-03-10'),
      verificationMode: 'searchable',
      category: 'Entertainment',
      stakes: 'Loser buys popcorn',
      criteria: [
        'Oppenheimer wins Best Picture at the 96th Academy Awards, held March 10, 2024',
        'A performer from Oppenheimer wins Best Actress at the same ceremony',
      ],
      searchQueries: [
        '96th Academy Awards Best Picture winner',
        '2024 Oscars Best Actress winner',
      ],
    });

    /*
     * A negative claim that came true by absence. No crewed spacecraft has
     * landed on the Moon since Apollo 17 in 1972; Artemis II (April 2026) was
     * a flyby, and the first Artemis landing is targeted for 2028. The model
     * can only report that it found nothing; past the deadline the app turns
     * that into a hit for the owner to approve, which is the path this tests.
     */
    db.predictions.create({
      authorId: self.id,
      rawStatement: 'Nobody is landing on the Moon again before the end of 2025. Mark my words.',
      normalizedClaim: 'No spacecraft with people aboard lands on the Moon before December 31, 2025.',
      polarity: 'negative',
      disconfirmingTrigger:
        'A spacecraft with people aboard lands on the surface of the Moon between January 1, 2024 and December 31, 2025',
      statementDate: '2024-01-01T12:00:00.000Z',
      sourceContext: 'New Year\'s Day, arguing about Artemis',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2025-12-31'),
      verificationMode: 'searchable',
      category: 'Tech/AI',
      criteria: [
        'No spacecraft with people aboard lands on the lunar surface between January 1, 2024 and December 31, 2025',
      ],
      searchQueries: [
        'crewed Moon landing 2025',
        'Artemis III landing date',
        'first crewed lunar landing since Apollo 17',
      ],
    });

    /*
     * Still open. Rockstar moved Grand Theft Auto VI to November 19, 2026 on
     * November 6, 2025, so at the time of writing this cannot resolve either
     * way: the right answer is no_change with a trend, and it stays in the
     * feed as a countdown. It can happen late, so a miss would keep watching.
     */
    db.predictions.create({
      authorId: liz.id,
      rawStatement: 'GTA 6 is finally out before the end of 2026. Mark my words.',
      normalizedClaim: 'Grand Theft Auto VI is released to the public before December 31, 2026.',
      statementDate: '2025-11-07T12:00:00.000Z',
      sourceContext: 'The day after the second delay',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2026-12-31'),
      canHappenLate: true,
      verificationMode: 'searchable',
      category: 'Entertainment',
      criteria: ['Grand Theft Auto VI is released to the public on or before December 31, 2026'],
      searchQueries: ['Grand Theft Auto VI release date', 'GTA VI released'],
    });

    /*
     * A settled bet with a real, checkable answer.
     *
     * This slot used to hold a fabricated World Series win for a season that
     * had not been played, on example.com URLs dressed in wire-service names,
     * with fetchStatus hardcoded to "ok" so the app reported a quote verified
     * on pages it had never opened. A Sample badge was not enough: the first
     * thing anyone reads is the verdict, and the verdict was false.
     *
     * The result below was verified against live sources before it was written
     * here: the Dodgers beat the Blue Jays 5-4 in eleven innings in Game 7 on
     * November 1, 2025, taking the series 4-3 and repeating as champions.
     */
    const dodgers = db.predictions.create({
      authorId: popops.id,
      rawStatement: 'The Dodgers are going back-to-back. Mark my words.',
      normalizedClaim: 'The Los Angeles Dodgers win the 2025 World Series.',
      statementDate: '2025-10-20T02:00:00.000Z',
      sourceContext: 'Said at dinner, twice',
      deadlineType: 'fixed_date',
      resolutionDate: '2025-11-30T23:59:59.999Z',
      verificationMode: 'searchable',
      category: 'Sports',
      stakes: '$20',
      criteria: ['The Los Angeles Dodgers win the 2025 World Series'],
    });

    // A check log with a queued verdict, so the evidence trail and the approval
    // step are visible without waiting for a real check to land.
    db.checks.create({
      predictionId: dodgers.id,
      trigger: 'pull',
      provider: 'demo',
      model: 'demo',
      proposedVerdict: 'no_change',
      proposedTrend: 'flat',
      gates: ['No sources were cited.'],
      modelConfidence: 12,
      summary: 'The series is tied at three. Nothing settled yet.',
      outcome: 'no_change',
      evidence: [],
    });

    /*
     * Queued rather than resolved because the model reported 68, under the 70
     * the app treats as sure, which is the honest reason this sits waiting
     * for a person. The evidence carries no quoted text and no fetch result,
     * because nothing here was fetched: these are real addresses the app has
     * never opened, and saying otherwise is what went wrong last time.
     */
    db.checks.create({
      predictionId: dodgers.id,
      trigger: 'pull',
      provider: 'demo',
      model: 'demo',
      proposedVerdict: 'hit',
      proposedTrend: 'toward_yes',
      gates: [],
      modelConfidence: 68,
      summary:
        'Los Angeles won Game 7 in Toronto 5-4 in eleven innings on November 1, taking the series 4-3.',
      outcome: 'queued',
      searchQueries: ['2025 world series result', 'dodgers blue jays game 7 final score'],
      evidence: [
        {
          url: 'https://www.espn.com/mlb/story/_/id/46796786/world-series-2025-los-angeles-dodgers-champions-repeat-dynasty',
          title: 'Game 7 win cements Dodgers dynasty',
          publisher: 'ESPN',
          publishedAt: '2025-11-02',
          quotedText: null,
          tier: 'secondary',
          fetchStatus: 'not_checked',
          fetchedAt: null,
        },
        {
          url: 'https://www.baseball-reference.com/boxes/TOR/TOR202511010.shtml',
          title: 'Dodgers at Blue Jays box score, November 1, 2025',
          publisher: 'Baseball-Reference',
          publishedAt: '2025-11-01',
          quotedText: null,
          tier: 'secondary',
          fetchStatus: 'not_checked',
          fetchedAt: null,
        },
        {
          url: 'https://www.foxsports.com/mlb/world-series-game-7-los-angeles-dodgers-vs-toronto-blue-jays-nov-01-2025-game-boxscore-94232',
          title: 'World Series Game 7 box score',
          publisher: 'FOX Sports',
          publishedAt: '2025-11-01',
          quotedText: null,
          tier: 'secondary',
          fetchStatus: 'not_checked',
          fetchedAt: null,
        },
      ],
    });
    db.predictions.update(dodgers.id, {
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
      canHappenLate: true,
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
      canHappenLate: true,
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
      lastCheckedAt: '2024-12-05T18:00:00.000Z',
      checkCount: 6,
      updatedAt: nowIso(),
    });


    /*
     * Six adversarial fixtures, added 2026-09-13. Each aims at a rule that has
     * already been wrong once. Every fact below was verified by web search on
     * the day it was written (sources in the commit); a fixture whose fact
     * could not be confirmed was dropped, not adjusted.
     */

    // 1. Period start. Recorded today, about a future Super Bowl. The Eagles
    // won LIX on February 9, 2025, nineteen months before this was said, and a
    // search will find that immediately. The right answer is no_change (or
    // ambiguous with "predates the claim"); a hit means the model counted an
    // event from before the recorded date.
    db.predictions.create({
      authorId: popops.id,
      rawStatement: 'Mark my words, the Eagles win the Super Bowl this season.',
      normalizedClaim: 'The Philadelphia Eagles win Super Bowl LXI, played on February 14, 2027.',
      statementDate: new Date().toISOString(),
      sourceContext: 'Week 1, from the couch',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2027-02-14'),
      verificationMode: 'searchable',
      category: 'Sports',
      criteria: ['The Philadelphia Eagles win Super Bowl LXI, played on February 14, 2027'],
      searchQueries: ['Eagles Super Bowl win', 'Super Bowl LXI result February 14 2027'],
    });

    // 2. The qualifier. "Finishes above" is not "passes". Bitcoin crossed
    // $100,000 on December 4, 2024 and closed December 31, 2024 at $93,429.20,
    // so this is a miss while the sibling "passes $100k" fixture is a hit. If
    // both come back hit, the criteria dropped "finishes".
    db.predictions.create({
      authorId: self.id,
      rawStatement: 'Bitcoin finishes 2024 above $100k. Mark my words.',
      normalizedClaim: "Bitcoin's price is above $100,000 USD at the close of December 31, 2024.",
      statementDate: '2024-11-15T12:00:00.000Z',
      sourceContext: 'Group chat, the week after the election',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2024-12-31'),
      verificationMode: 'searchable',
      category: 'Economics',
      canHappenLate: false,
      criteria: ['Bitcoin trades above $100,000 USD at the close of trading on December 31, 2024'],
      searchQueries: ['Bitcoin price December 31 2024 close', 'Bitcoin year end 2024 price'],
    });

    // 3. A negative claim that was disconfirmed. Cal Raleigh hit his 60th home
    // run on September 24, 2025. The model may never return hit on a negative
    // claim; here it should return miss, with sources. That path has never run.
    db.predictions.create({
      authorId: liz.id,
      rawStatement: 'Nobody hits 60 home runs this season. Mark my words.',
      normalizedClaim: 'No Major League Baseball player hits 60 or more home runs in the 2025 regular season.',
      polarity: 'negative',
      disconfirmingTrigger:
        'A Major League Baseball player hits his 60th home run of the 2025 regular season',
      statementDate: '2025-03-20T12:00:00.000Z',
      sourceContext: 'Opening week, at the bar',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2025-09-30'),
      verificationMode: 'searchable',
      category: 'Sports',
      criteria: ['No Major League Baseball player reaches 60 home runs during the 2025 regular season'],
      searchQueries: ['60 home runs 2025 season', 'MLB 2025 home run leader'],
    });

    // 4. Three criteria, two true. Eagles 40, Chiefs 22, Hurts MVP: the margin
    // was 18. Expected partial, queued, with the third criterion unmet. The
    // criterion index bug's home turf, with a longer list.
    db.predictions.create({
      authorId: popops.id,
      rawStatement: "Eagles win it, Hurts gets MVP, and it won't even be close. Mark my words.",
      normalizedClaim:
        'The Philadelphia Eagles win Super Bowl LIX, Jalen Hurts is named its MVP, and the margin of victory is at least 20 points.',
      statementDate: '2025-02-01T12:00:00.000Z',
      sourceContext: 'The week before, over wings',
      deadlineType: 'fixed_date',
      resolutionDate: '2025-02-09T23:59:59.999Z',
      verificationMode: 'searchable',
      category: 'Sports',
      stakes: 'Wings, next time',
      criteria: [
        'The Philadelphia Eagles win Super Bowl LIX on February 9, 2025',
        'Jalen Hurts is named the Super Bowl LIX Most Valuable Player',
        'The Eagles win Super Bowl LIX by 20 or more points',
      ],
      searchQueries: ['Super Bowl LIX final score', 'Super Bowl LIX MVP'],
    });

    // 5. A real late hit. Artemis II launched April 1, 2026 and splashed down
    // April 10. Expected: miss at the deadline, then the late badge on the
    // next check under late watch, with the verdict unchanged. A first check
    // that returns hit has counted an event from after the deadline.
    db.predictions.create({
      authorId: liz.id,
      rawStatement: 'Artemis II flies before the end of 2025. Mark my words.',
      normalizedClaim: "NASA's Artemis II mission launches with its crew aboard on or before December 31, 2025.",
      statementDate: '2025-01-10T12:00:00.000Z',
      sourceContext: 'After the SLS stacking news',
      deadlineType: 'fixed_date',
      resolutionDate: endOfLocalDay('2025-12-31'),
      verificationMode: 'searchable',
      category: 'Tech/AI',
      canHappenLate: true,
      criteria: ["NASA's Artemis II mission launches with its four crew members aboard on or before December 31, 2025"],
      searchQueries: ['Artemis II launch date', 'Artemis II launched'],
    });

    // 6. A race. New Glenn reached orbit on its first launch, January 16, 2025;
    // every Starship flight before that was suborbital. Expected miss. The
    // only event-shaped fixture with a race, and it cannot happen late: the
    // other rocket has already flown.
    db.predictions.create({
      authorId: self.id,
      rawStatement: 'Starship gets to orbit before New Glenn ever flies. Mark my words.',
      normalizedClaim:
        "A SpaceX Starship completes an orbit of Earth before Blue Origin's New Glenn makes its first launch.",
      statementDate: '2024-06-01T12:00:00.000Z',
      sourceContext: 'Launch-day thread',
      deadlineType: 'event',
      triggerEvent: "Blue Origin's New Glenn rocket makes its first launch",
      triggerExpectedDate: endOfLocalDay('2025-01-16'),
      // An event deadline needs a stale-out: if New Glenn had never flown,
      // the claim would have gone void at the end of 2026.
      staleOutDate: endOfLocalDay('2026-12-31'),
      raceEventB: 'A SpaceX Starship completes at least one full orbit of Earth',
      verificationMode: 'searchable',
      category: 'Tech/AI',
      canHappenLate: false,
      criteria: [
        "A SpaceX Starship completes at least one full orbit of Earth before the first launch of Blue Origin's New Glenn",
      ],
      searchQueries: ['New Glenn first launch date', 'Starship first orbital flight'],
    });

    db.settings.set(SETTING_KEYS.seeded, 'true');
  });
}

export function clearDemoFlag(db: Db): void {
  db.settings.set(SETTING_KEYS.seeded, 'false');
}
