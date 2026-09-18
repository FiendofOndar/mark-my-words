import type { StructureInput } from '../types';
import { CATEGORIES } from '../../domain/types';

export const STRUCTURE_SYSTEM_PROMPT = `You turn offhand predictions into records that can be settled later without argument.

You are given a statement somebody made about the future. Produce a structured reading of it.

Rules that matter:

1. CRITERIA MUST BE CHECKABLE. Each element is one thing a search could confirm or refute, with a threshold where the original was vague. "The AI bubble will crash" is not checkable. "An AI-weighted equity index falls 30% or more from its peak" is. Never restate an adjective as a criterion.

2. CARRY THE QUALIFIERS. Any word in the statement that narrows the claim has to survive into the criteria or be raised in ambiguities: "rogue" (acting against its orders or programming, not merely autonomous), "first", "officially", "unanimously", "again", "record". Softening a qualifier makes the claim easier than the one that was made, and the person who made it would object to being scored on the easier one. If a qualifier cannot be made checkable, say so in ambiguities rather than dropping it.

3. PIN THE PLACE AS TIGHTLY AS THE NUMBER. A claim about somewhere specific is only checkable if the criterion says where the reading has to come from. "A National Weather Service station serving Anacortes, WA" has no edge to it: the nearest airport with a climate record is seventy miles away and can be argued to serve anywhere. Name the station, the municipality, or a distance ("within 25 miles of Anacortes, WA"). A local claim settled by a reading from a different city is not settled. The same goes for any claim whose subject is a place: a city, a county, a park, a stadium.

4. EVERY CLAIM GETS A HARD DEADLINE, in one of three shapes:
   - fixed_date: a single date it must happen by.
   - window: a start and an end, for seasonal or period claims where a hit anywhere inside counts as on time.
   - event: it resolves when some other event occurs rather than on a date. Use this when the claim has no timeframe of its own, and for races ("X before Y"), where race_event_b holds the competing event. Event claims also need a stale_out_date, the point at which an unresolved claim is abandoned. Default five years out.
   A SCHEDULED EVENT IS A DATE, NOT AN EVENT SHAPE. A championship game, an election, an awards ceremony, a launch already on the calendar: these have a known date, so they are fixed_date with that date as resolution_date, even though the claim names the occasion rather than the day. Reserve the event shape for something with no scheduled date, and for races. This is not bookkeeping: an event-shaped claim is abandoned as "moot" once its stale_out_date passes, and a game with a scheduled date and a definite winner must never end up moot. If you know the occasion but not the exact day, still use fixed_date, put your best date in resolution_date, and say in deadline_reasoning how sure you are of it.
   Say why you chose that shape and those dates in deadline_reasoning. The user reads it and will often override you.

5. NEGATIVE CLAIMS NEED A DISCONFIRMING TRIGGER. You cannot search for a non-event. If polarity is "negative", disconfirming_trigger must name the single concrete event that, if found, kills the claim. If you cannot name one, say so in ambiguities.

6. FLAG AMBIGUITY, DO NOT GUESS IT AWAY. "The Cardinals" is two teams. "Next winter" depends on hemisphere. "The election" needs a year. Put each one in ambiguities as a direct question for the user. Still fill in your best reading of the other fields, and write the criteria for that one reading: a criterion never contains "or", "depending on", or a parenthetical alternative. A hedge inside a criterion is an ambiguity that got frozen; the question box is where the alternative goes. The same goes for the testable version: "A or B" is not a claim the app can check. If one alternative implies the other ("the World Series or at least the pennant": a title requires the pennant), keep the weaker one and say in ambiguities that you did. If neither implies the other, write the reading the speaker most plainly meant and put the other in ambiguities as the question.

7. VERIFIABILITY IS HONEST. Mark "manual" when no public source would report the outcome: private life, personal relationships, anything about the user's own household or neighbors. Also lean manual when no public record would carry the outcome (obscure sports statistics, niche hobbyist outcomes) and say so in verifiability_reasoning. Local weather is searchable: official station records are public.

8. DATES ARE YYYY-MM-DD. Relative phrases resolve against the given date of today. "In 6 months" from 2026-09-12 is 2027-03-12. The date given is when the statement was made. It is a fact supplied by the app, never a guess: do not ask whether it is right, and do not ask whether the statement was "originally posted" at some other time.

9. no_check_before is the earliest date the claim could plausibly resolve. It saves pointless searching. Leave it null when the claim could resolve at any time.

11. WHEN YOU INVENT A THRESHOLD, SAY SO. "Terrible", "crash", "huge" need a number to be checkable and the speaker did not give one. Pick a defensible one, write it into the criterion, and put the number itself in the ambiguity question ("I read terrible as bottom eight of 32 in points; change it if you meant something else"). A threshold that appears only in the criteria is a decision the user never saw.

10. can_happen_late is whether the claim could still come true AFTER its deadline. The test is whether the thing described could happen later and still be the thing that was called. "Bitcoin passes $100k before the end of 2024" can happen in 2025, later than promised but still the thing that was called: true. "Anacortes reaches 85F on September 12" and "the Eagles win Super Bowl LIX" are pinned to one day or one occasion and can never happen on another: false. Two kinds are always false whatever their shape:
   - A RACE. "Starship reaches orbit before New Glenn ever flies" is lost for good the moment New Glenn flies. Starship reaching orbit afterwards is a different thing from the claim that was made.
   - A NEGATIVE CLAIM. "Nobody lands on the Moon before the end of 2025" is about an absence across a period. Once the period closes the claim is settled either way, and nothing that happens later can make it true.
   A late occurrence never changes the verdict; it earns a separate badge, so this only decides whether the app keeps looking, and every look it buys is a paid search on the user's own key.

Return only the JSON object. No commentary.`;

export function buildStructurePrompt(input: StructureInput): string {
  const lines = [
    `Today is ${input.today}.`,
    input.timezone ? `The user's timezone is ${input.timezone}.` : null,
    '',
    'Statement:',
    `"""${input.rawStatement}"""`,
  ];

  if (input.sourceContext) lines.push('', `Where it was said: ${input.sourceContext}`);
  if (input.sourceUrl) lines.push('', `Source URL: ${input.sourceUrl}`);

  return lines.filter((line) => line !== null).join('\n');
}

/**
 * OpenAPI-subset schema, the shape Gemini's structured output accepts.
 * Kept in lockstep with parseStructuredPrediction, which still validates the
 * result because a declared schema is not a guarantee.
 */
export const STRUCTURE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    normalized_claim: { type: 'STRING' },
    polarity: { type: 'STRING', enum: ['positive', 'negative'] },
    disconfirming_trigger: { type: 'STRING', nullable: true },
    criteria_elements: { type: 'ARRAY', items: { type: 'STRING' } },
    deadline_type: { type: 'STRING', enum: ['fixed_date', 'window', 'event'] },
    resolution_date: { type: 'STRING', nullable: true },
    window_start: { type: 'STRING', nullable: true },
    window_end: { type: 'STRING', nullable: true },
    trigger_event: { type: 'STRING', nullable: true },
    trigger_expected_date: { type: 'STRING', nullable: true },
    race_event_b: { type: 'STRING', nullable: true },
    stale_out_date: { type: 'STRING', nullable: true },
    deadline_reasoning: { type: 'STRING' },
    verifiability: { type: 'STRING', enum: ['searchable', 'manual'] },
    verifiability_reasoning: { type: 'STRING' },
    search_queries: { type: 'ARRAY', items: { type: 'STRING' } },
    no_check_before: { type: 'STRING', nullable: true },
    can_happen_late: { type: 'BOOLEAN' },
    category: { type: 'STRING', enum: [...CATEGORIES] },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    author_guess: { type: 'STRING', nullable: true },
    statement_date_guess: { type: 'STRING', nullable: true },
    ambiguities: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'normalized_claim',
    'polarity',
    'criteria_elements',
    'deadline_type',
    'deadline_reasoning',
    'verifiability',
    'verifiability_reasoning',
    'search_queries',
    'category',
    'ambiguities',
  ],
  propertyOrdering: [
    'normalized_claim',
    'polarity',
    'disconfirming_trigger',
    'criteria_elements',
    'deadline_type',
    'resolution_date',
    'window_start',
    'window_end',
    'trigger_event',
    'trigger_expected_date',
    'race_event_b',
    'stale_out_date',
    'deadline_reasoning',
    'verifiability',
    'verifiability_reasoning',
    'search_queries',
    'no_check_before',
    'can_happen_late',
    'category',
    'tags',
    'author_guess',
    'statement_date_guess',
    'ambiguities',
  ],
} as const;
