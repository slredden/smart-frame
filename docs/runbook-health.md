# Runbook: health check and alerts (Chief)

`GET /api/health` returns content-free JSON (no event titles, photo ids or reflection text). It needs
the health bearer token; the Worker stores only its SHA-256 (`HEALTH_TOKEN_HASH`).

## Check

```sh
SMART_FRAME_HEALTH_TOKEN=… node tools/check-health.mjs          # one-line summary
SMART_FRAME_HEALTH_TOKEN=… node tools/check-health.mjs --json   # full JSON
```

| Exit | Meaning | Action |
| --- | --- | --- |
| 0 | Healthy, or only soft problems | Nothing |
| 2 | `alert: true` (see below) | Email Stephen |
| 3 | Worker unreachable, or the token was refused | Email Stephen if it lasts over an hour |
| 1 | Usage error (token not set, bad URL) | Fix the setup |

Suggested cadence: every 15 minutes. Email once per incident, not once per check, and send an
all-clear when it recovers.

## Problems

Alerting (`alert: true`):

- `frame_offline`: no `/api/state` poll or heartbeat for over 60 minutes.
- `frame_never_seen`: no frame has paired yet. Expected until the frame is installed.
- `grant_calendar_<status>` / `grant_photos_<status>`: a Google grant is missing or needs re-consent.
  Stephen fixes it at `/admin` → Google → Connect.
- `grant_spotify_needs_reconsent` (Spotify refused the refresh token) and `spotify_reauth_due` (day 168 of
  Spotify's 6-month sign-in): Stephen reconnects at `/admin` → Spotify (runbook-controls.md).

Soft (shown, no email): `weather_stale`, `calendar_stale` (the cron will retry; the frame keeps
showing the last good data), `reflection_no_current_week` (publish the next guide),
`spotify_not_connected` (no `SPOTIFY_CLIENT_SECRET` yet, or Stephen hasn't connected Spotify at
`/admin`), `tasks_scope_missing` (the calendar grant works but lacks the Google Tasks permission v2 asks for;
expected until Stephen reconnects at /admin after the P1 deploy, or if he unticks Tasks; at most one
such code, and it never sets `alert`), `tasks_lists_empty` (Tasks is granted but Google returned no task
lists, e.g. the grant went to an account without Google Tasks; Chief flags it to Stephen, see
runbook-tasks.md), `tasks_stale` (no good tasks refresh for over 60 minutes), and the two
freshness codes below (PLAN-v2.md §8.5). Both use the guide's coverage dates in Denver, not when it
was published:

- `reflection_weekly_stale`: no week has started yet, or the newest started week is more than 8 days
  old (it flips 9 days after the week's start; for a long last week, 9 days after its final 7-day
  stretch starts). Chief: publish the next guide.
- `reflection_monthly_stale`: no guide has started yet, or the newest started guide began more than
  `max(35, its length in days)` days ago. A guide that starts in the future (published early) doesn't
  count until its start date.

`reflection` in the JSON: `{currentWeek, weekly: {start, ageDays, stale}, monthly: {start, end,
ageDays, stale}, publishedAt}`. `grants.calendar` is `{status, tasksScope}`. `spotify` is `{configured, status, connectedAt, reconnectBy}`. `tasks` is `{scope, lastFetch, lists, selected, listsEmpty}`. `frame.build` is the build the frame last reported, so it shows whether
the frame reloaded after a deploy.

## Email template

Subject: `Frame: <problem>`.
Body: what's wrong in one line, when it started, and the fix: "Open
https://smart-frame.sredden.workers.dev/admin and reconnect Google" for a grant, or "Check the frame
is on and on Wi-Fi" for offline.
