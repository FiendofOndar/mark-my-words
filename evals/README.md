# Prompt evals

Fixtures for the prompt eval loop that runs in GitHub Actions (`Prompt eval`,
manual trigger, with a `suite` input to run one half or both). Two halves:
the extraction eval reads screenshots (`scripts/eval-extract.ts`,
`extract.json`, `screenshots/`), and the intake eval structures raw
statements (`scripts/eval-intake.ts`, `intake.json`). The comparison and
the table for each are in `lib/`, tested by the suite.

## Intake

`intake.json` holds raw statements, one per case, with the day each was
said and what the review card must get right about it. Each statement goes
through the app's real structuring path (same prompt, same schema, same
parser), so the table shows the reading the app would store. One text call
per statement, no image, no search: a few thousand tokens each.

```json
{
  "rogue-drone": {
    "statement": "Mark my words, we will see the first rogue AI drone strikes in the next 6 months.",
    "today": "2026-09-16",
    "tests": "why this statement is in the set",
    "expect": {
      "deadline_type": "fixed_date",
      "resolution_date": "2027-03-16",
      "criteria_elements_contains": ["rogue"],
      "can_happen_late": true
    }
  }
}
```

Keys under `expect` are the model's own JSON field names, plain for an
exact match, or with a suffix: `_contains` (every word appears in the
field, case-insensitive; a list field is searched as a whole),
`_contains_any`, `_absent`, `_matches` (a regular expression), `_min` and
`_max` (a date bound, or a count for a list). `lib/intakeReport.ts` has the
full list.

A case may also carry `ask`: the proposals a reasonable person could answer
differently, each written as a question for the owner, with `about` naming
the key it concerns. The review sheet puts these at the top so the rest can
be approved in one sentence instead of read one by one.

A case may carry `proposed` instead of `expect`: values a session drafted,
with a `why`, that the owner has not yet confirmed. They are never graded.
The run reports the case as unconfirmed and says how many of the proposed
values the model agreed with, so the owner can confirm or correct each in
chat; only then does a value move to `expect`. No value under `expect` is
a guess, and a proposal that the model happens to match is still a
proposal until the owner says otherwise.

## Reviewing the proposals

Raw readings are the wrong surface for deciding whether a proposal is right:
eighteen JSON objects of twenty-odd fields, in a comment near a thousand
lines long, with the case file open in another tab to compare against. The
review sheet is the surface instead.

```bash
npm run review:intake -- evals/readings/intake-17.json > sheet.md
```

It renders every proposed value as a sentence, beside the model's own words
for that field, and leads with the `ask` questions. It calls nothing and
spends nothing: the readings come from a file an eval run already wrote.
Every intake run saves one as a workflow artifact (`intake-readings-<run>`),
so the sheet can be rebuilt after editing the case file without paying for
another run. The sheet goes to the owner as a comment on issue #47.

## Extraction

`screenshots/` holds phone screenshots of posts, one prediction each, as
shared into the app. Twenty-one of them as of 2026-09-16, all Reddit; the
shapes with no coverage yet are Instagram, Threads, iMessage and a news
article with a dateline, plus a screenshot with no prediction in it at all.
Thirty-four as of 2026-09-16: twenty-one Reddit, twelve X, and one Reddit
post whose content is a screenshot of a tweet. `extract.json` holds what the model must read off each
one, keyed by file name:

```json
{
  "reddit-eagles.png": {
    "today": "2026-09-13",
    "expect": {
      "is_prediction": true,
      "statement": "the post's own words, verbatim",
      "author": "u/name",
      "platform": "Reddit",
      "posted_on": null,
      "posted_hint": "2y"
    }
  }
}
```

Two optional keys go beyond a plain field match. `statement_starts_with`
and `statement_max_length` bound a statement without pinning it exactly.
`note_contains` requires one word inside the free-text note, for the cases
where the statement alone does not say what was claimed: a quote tweet
whose subject is only "He" needs the note to name him.

`today` is the day the screenshot was taken, so a relative age on the post
resolves the same way on every run; without it the runner uses the current
Pacific date. Every key under `expect` is optional: leave one out and it is
not checked, set it to `null` and the model must return nothing for it. A
screenshot with no entry runs anyway and is reported as unconfirmed, with the
model's raw JSON, so the expected values can be written from a real result.

Expected values are confirmed by the owner in chat before they are written
here. No value in this file is a guess.

## Conventions the owner has set

Decided from real results, in chat, on 2026-09-15. New expected values follow
them; a prompt change that makes the model follow them is in scope.

- **A named list of framing phrases, always cut.** "mark my words", "MMW",
  "calling it now", "bookmark this tweet", "screenshot this" are never part
  of a claim and come out wherever they appear, punctuated or not, along
  with any punctuation the cut orphans. Interface furniture goes too: flair,
  a leading emoji, a label like "Prediction:".

  This rule was a judgment twice and unstable both times. "Framing at the
  edge of the statement" had runs 9 and 10 disagreeing on identical input.
  A punctuation test replaced it and scored 30 of 34, breaking three cases
  that had been right for four runs, because "this year mark my words" and
  "Blue mark my words." are the same construction and no grammatical rule
  separates them. The phrases carry no information about the bet, so naming
  them removes the judgment rather than refining it. Extend the list when a
  real screenshot shows a phrase it misses; never from imagination.
  Acronyms that are part of the sentence stay ("the GOP", "the CEO").
- **The title is the bet.** When a post has a title and a body that both
  carry the prediction, the most prominent one (the title) is the statement.
- **Nothing that is not on the screen.** A statement with invented words is
  wrong however plausible. A post cut off with "...more" ends at the last
  sentence that finishes on screen; a sentence the cut leaves unfinished is
  dropped, because half a sentence is not a claim anybody can check, and the
  note says words are missing.
- **A joke is still a bet.** r/MarkMyWords is full of them. If it names an
  outcome somebody could check, it is a prediction; only a post with no
  checkable outcome at all is refused.
- **An age that resolved leaves no hint.** "2d" becomes a date and
  `posted_hint` goes null. Ages in weeks, months or years cannot give a day,
  so those keep the hint and leave the date null. The parser enforces the
  first half, so it cannot drift with the model.
- **The note is a remark to the person who shared the picture**, never about
  the prompt's own rules.
- **The date follows the author.** When a post reports or quotes somebody
  else's prediction, `posted_on` is when that person said it, not when the
  account reposted them. If the screen does not show the original's date,
  `posted_on` is null and the note says whose date is visible. The date is
  where the app starts counting, so a borrowed one makes an old claim look
  new.
- **Platform is where the prediction was made.** A tweet screenshotted into
  a subreddit is still X, and the note says where it was shared.
- **The author is the u/name beside the post**, including `u/[deleted]`.

