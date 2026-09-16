# Prompt evals

Fixtures for the prompt eval loop that runs in GitHub Actions (`Prompt eval`,
manual trigger). The runner is `scripts/eval-extract.ts`; the comparison and
the table are in `lib/`, tested by the suite.

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

- **Framing that is not part of the sentence is dropped.** Not only "MMW:"
  and "Mark my words": any tag, unrecognisable acronym or stray symbol that
  cannot be read as part of a coherent statement goes ("MMW:", a flair
  label, a leading emoji, a glyph stuck to a word). Acronyms that are part
  of the sentence stay ("the GOP", "the CEO"). The statement is the bet
  itself, as a sentence a person would say.
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

