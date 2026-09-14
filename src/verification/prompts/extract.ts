import type { ExtractInput } from '../types';

/**
 * Reading a screenshot of a post for the prediction in it.
 *
 * The share sheet is the capture path that matters, and for Instagram, X,
 * TikTok and Threads a shared link carries none of the post's words. A
 * screenshot carries all of them, plus the handle and usually the date, so
 * this is the one path that works on every platform. No search: this call
 * only reads what is on the image.
 */
export const EXTRACT_SYSTEM_PROMPT = `You are reading a screenshot from a phone. It shows a social media post, a message, a comment, or an article. Your job is to find the one statement in it that predicts something, and to report who said it. Return JSON only.

Rules:

1. A PREDICTION IS FORWARD-LOOKING AND CHECKABLE. "The Mariners win it all this year" is one. "The Mariners are fun to watch" is not. A question, a joke, a wish or a report of something that already happened is not.

2. THE STATEMENT IS VERBATIM. Copy the post's own words exactly, including typos, and nothing else: no likes, reply counts, timestamps, usernames or interface text. Keep the whole sentence or sentences that carry the prediction; leave out sentences that do not.

3. THE AUTHOR IS WHO POSTED THE WORDS. Prefer the @handle where one is shown; otherwise the display name. The person who shared, quoted or screenshotted the post is not the author. In a thread, the author is whoever wrote the post that carries the prediction, even when it is a reply.

4. PLATFORM comes from the interface: X, Instagram, Threads, Reddit, Facebook, TikTok, YouTube, Bluesky, iMessage, WhatsApp, or the name of a news site. Null if you cannot tell.

5. POSTED_ON only when a date is visible, as YYYY-MM-DD. A relative time such as "3h" or "2d" resolves against today's date, given below. Null otherwise. Never guess a date.

6. SEVERAL CANDIDATES: choose the most specific prediction and mention the others in the note.

7. NOTHING PREDICTIVE: set is_prediction to false, leave statement null, and say in the note what the image shows. This is a normal answer. Never invent words that are not in the image.`;

export function buildExtractPrompt(input: ExtractInput): string {
  return `Today is ${input.today}. Read the attached screenshot and return the JSON.`;
}

export const EXTRACT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_prediction: { type: 'BOOLEAN' },
    statement: { type: 'STRING', nullable: true },
    author: { type: 'STRING', nullable: true },
    platform: { type: 'STRING', nullable: true },
    posted_on: { type: 'STRING', nullable: true },
    note: { type: 'STRING', nullable: true },
  },
  required: ['is_prediction'],
} as const;
