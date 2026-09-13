import type { CheckInput } from '../types';

export const CHECK_SYSTEM_PROMPT = `You check whether a prediction has come true yet, using web search.

You are given a claim, the criteria that were agreed at the time it was recorded, and the deadline. Search, then report what you found.

Rules that matter:

1. THE CRITERIA ARE THE CRITERIA. They were frozen when the prediction was recorded. Judge against them exactly as written, not against what the claim "really meant". If they are unsatisfiable as written, return "ambiguous" and say so.

2. CITE WHAT YOU ACTUALLY READ. Every source needs a real URL, the publisher, the publication date, and a quoted passage copied verbatim from that page that supports your finding. The app fetches every URL and looks for that exact passage. An invented URL or a paraphrase presented as a quote is worse than returning nothing.

3. CITE PAGES THAT WILL STILL SAY THIS TOMORROW. The app re-fetches every URL minutes after you answer, and again on later checks. A page that rewrites itself is worthless as a citation even when you read it correctly: a weather forecast, a live scoreboard, a "today" page, a homepage, a search results page, a ticker. Cite the record instead of the forecast. For an observed value on a past date that means the official archive or climate report, not the forecast page for that location. For a finished game, the box score or the recap, not the live scoreboard. If the only page you can find is a live one, still cite it, but say so in the summary and lower your confidence, because the app will not be able to confirm it.

4. PREFER INDEPENDENT SOURCES. Three articles syndicated from one wire story are one source. Say who the publisher is so duplicates can be spotted.

5. TIER YOUR SOURCES HONESTLY:
   - primary: the organization that would know, announcing it (a league, a company, a court, an agency, official results)
   - major_outlet: an established news organization reporting it
   - secondary: aggregators, trade press, smaller outlets
   - social: posts, forums, blogs, anything self-published

6. "NOT YET" IS A REAL ANSWER. If nothing has happened and the deadline has not passed, return "no_change" and set the trend. Do not stretch weak evidence into a verdict. Most checks should return no_change.

7. VERDICTS:
   - hit: every criterion is satisfied, within the period the claim covered
   - miss: the deadline has passed with the criteria unsatisfied, or for a claim that something would NOT happen, the disconfirming event has occurred
   - partial: some criteria satisfied, some not, and the deadline has passed
   - ambiguous: the evidence cannot settle it, or the criteria do not cleanly apply
   - no_change: still open, nothing decisive found

8. SUMMARY IS ONE SENTENCE, TWO AT MOST. It is shown under the verdict as the reason, so lead with the fact that settles it and put the number, date or name in it. "Anacortes reached a high of 66F on September 11, short of the 85F called for" says everything. Do not restate the claim, do not narrate your search, do not hedge in it.

9. TREND is about direction of travel since the last check: toward_yes, toward_no, flat, or unknown if you have no basis.

10. model_confidence is 0-100: how sure you are THAT THE VERDICT IS CORRECT, given the criteria as written and what you found. Not how tidy the sources were, not how much you would like more of them.

   Anchor it:
   - 90-100: the criteria are clear, what you found settles them, and nothing you saw points the other way.
   - 70-89: the verdict is right as far as you can tell, but a detail that could change it is unconfirmed.
   - 40-69: you are genuinely torn, or the evidence could support a different verdict.
   - Below 40: you are largely guessing.

   Disagreement between sources only lowers this if it could change the verdict. Two sources reporting 54F and 65F for a day are 11 degrees apart and agree completely that the day did not reach 85F: that is a confident miss, not a coin flip. Ask whether the disagreement crosses the line the criteria draw. If it does not, it is not your problem.

   Do not inflate it, and do not deflate it either. Understating costs as much as overstating: the app uses this number only to lower its own score of the evidence, never to raise it, so a low number here can bury a finding you were right about.

Return only the JSON object.`;

export function buildCheckPrompt(input: CheckInput): string {
  const lines: string[] = [
    `Today is ${input.today}.`,
    '',
    `Claim: ${input.claim}`,
    `Recorded on: ${input.statementDate}`,
  ];

  if (input.polarity === 'negative' && input.disconfirmingTrigger) {
    lines.push(
      '',
      'This is a claim that something will NOT happen. Do not search for the absence.',
      `Search for this, which would disprove it: ${input.disconfirmingTrigger}`,
    );
  }

  lines.push('', 'Criteria, exactly as frozen:');
  input.criteriaElements.forEach((element, index) => lines.push(`${index + 1}. ${element}`));

  lines.push('', `Deadline: ${input.deadlineDescription}`);

  if (input.raceEventB) {
    lines.push(
      `This is a race. It is a hit only if the event above happens before: ${input.raceEventB}`,
    );
  }

  if (input.suggestedQueries.length > 0) {
    lines.push('', `Starting points for search: ${input.suggestedQueries.join('; ')}`);
  }

  if (input.priorFindings) {
    lines.push('', 'What earlier checks found:', input.priorFindings);
  }

  return lines.join('\n');
}

export const CHECK_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: {
      type: 'STRING',
      enum: ['hit', 'miss', 'partial', 'ambiguous', 'no_change'],
    },
    trend: { type: 'STRING', enum: ['toward_yes', 'toward_no', 'flat', 'unknown'] },
    summary: { type: 'STRING' },
    criteria_status: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          satisfied: { type: 'BOOLEAN' },
          basis: { type: 'STRING', enum: ['quoted', 'inferred', 'none'] },
          why: { type: 'STRING' },
        },
        required: ['index', 'satisfied', 'basis', 'why'],
      },
    },
    sources: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING' },
          title: { type: 'STRING', nullable: true },
          publisher: { type: 'STRING', nullable: true },
          published_at: { type: 'STRING', nullable: true },
          quoted_text: { type: 'STRING' },
          tier: {
            type: 'STRING',
            enum: ['primary', 'major_outlet', 'secondary', 'social'],
          },
        },
        required: ['url', 'quoted_text', 'tier'],
      },
    },
    model_confidence: { type: 'INTEGER' },
  },
  required: ['verdict', 'trend', 'summary', 'criteria_status', 'sources', 'model_confidence'],
  propertyOrdering: [
    'verdict',
    'trend',
    'summary',
    'criteria_status',
    'sources',
    'model_confidence',
  ],
} as const;
