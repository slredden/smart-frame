# Runbook: publish the monthly reflection (Chief)

The frame shows the current week's theme and short practice. The text is private: it lives in
Stephen's notes, is sent only to `PUT /api/publish/reflection`, is stored encrypted in D1, and is
never written to this repo, logs, commits or chat.

## Each month, when a new guide is ready

1. Dry run. This parses locally and prints week numbers, dates and text lengths, never the text:
   ```sh
   node tools/publish-reflection.mjs <path-to-guide.html> --dry-run
   ```
   Check that the dates match the guide's range and that every week is 7 days except the last one,
   which ends on the guide's end date.
2. Publish. The token comes from the environment, never from an argument:
   ```sh
   SMART_FRAME_PUBLISH_TOKEN=… node tools/publish-reflection.mjs <path-to-guide.html>
   ```
   You should see `published: N weeks, <start> → <end>`.
3. The frame picks it up on its next `/api/state` poll (within about a minute).

## If the extractor refuses

- `date_range_unparsed`: the date line didn't parse. Pass `--start YYYY-MM-DD --end YYYY-MM-DD`.
- `week_N_heading`: an `<h3>` isn't `Week N · theme`.
- `week_N_start` / `week_N_end` / `week_N_length`: the weeks don't tile the range (the last week
  can be at most 14 days).
- `week_N_theme` / `week_N_practice`: empty theme, theme over 160 characters, or practice over 1,200.

Fix the guide or pass dates. Don't hand-edit the JSON into the repo.

## Expected guide structure

`<h1>` title, `<div class="date">` with the overall range (e.g. "October 21 – November 25, 2026"),
and one `<div class="week">` per week holding `<h3>Week N · Theme</h3>` and `<p class="practice">`.
A synthetic example is in `test/fixtures/guide-synthetic.html`.

## Gaps

If today is outside every published week, the frame leaves the slot empty and `/api/health` reports
`reflection_no_current_week`. That is a soft problem and does not trigger an email.

## Writing JSON to a file (optional)

`node tools/reflection-extract.mjs <guide.html> --out <private path>/guide.json` writes mode 600.
Keep that file outside the repo.
