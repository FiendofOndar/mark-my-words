# Prompt evals

Fixtures for the prompt eval loop that runs in GitHub Actions (`Prompt eval`,
manual trigger). The runner is `scripts/eval-extract.ts`; the comparison and
the table are in `lib/`, tested by the suite.

`screenshots/` holds phone screenshots of posts, one prediction each, as
shared into the app. `extract.json` holds what the model must read off each
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

`today` is the day the screenshot was taken, so a relative age on the post
resolves the same way on every run; without it the runner uses the current
Pacific date. Every key under `expect` is optional: leave one out and it is
not checked, set it to `null` and the model must return nothing for it. A
screenshot with no entry runs anyway and is reported as unconfirmed, with the
model's raw JSON, so the expected values can be written from a real result.

Expected values are confirmed by the owner in chat before they are written
here. No value in this file is a guess.
