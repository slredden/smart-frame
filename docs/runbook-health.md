# Runbook: health check and alerts

The Worker runs its health job from the existing five-minute cron, once in each Denver slot from
7 AM through 9 PM (every other hour). It stores the previous problem set and last alerted set in D1:
the first bad slot warns silently, the next bad slot emails once, changed problems email again, and a
later healthy slot sends one recovery. The GitHub Actions watchdog runs at the same cadence to detect
an unavailable Worker; it alerts only after two failed scheduled runs and uses workflow history as state.

Set Worker secrets `AGENTMAIL_API_KEY` and `ALERT_TO` through the manual `worker-secrets` workflow.
The watchdog additionally needs repository secrets `HEALTH_TOKEN`, `AGENTMAIL_API_KEY`, and `ALERT_TO`.
Set repository variable `WATCHDOG_ENABLED=true` to enable scheduled watchdog runs; unset it or change it
to turn them off. The Worker job remains deployed, but removing the two mail secrets makes it record state
and retry a needed notification without sending mail. Use **Run workflow** with an optional URL to test the
watchdog without mail, or run the unit and Worker health-job tests locally.

`GET /api/health` returns content-free JSON (no event titles, photo ids or reflection text). It needs
the health bearer token; the Worker stores only its SHA-256 (`HEALTH_TOKEN_HASH`).
The Worker job uses every code in its `problems` array for its two-strike state, including soft codes;
the `alert` field below remains the older endpoint classification for a human or external monitor.

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
- `photos_active_missing`: the live photo set has fewer photos in D1 than it should (`photos.missing` > 0).
  The frame shows fewer photos. Stephen picks a new set, or uses /admin › Photos › **Restore previous set**
  (runbook-photos.md).
- `grant_spotify_needs_reconsent` (Spotify refused the refresh token) and `spotify_reauth_due` (day 168 of
  Spotify's 6-month sign-in): Stephen reconnects at `/admin` → Spotify (runbook-controls.md).

Soft (shown, no email): `weather_stale`, `calendar_stale` (the cron will retry; the frame keeps
showing the last good data), `reflection_no_current_week` (publish the next guide),
`spotify_not_connected` (no `SPOTIFY_CLIENT_SECRET` yet, or Stephen hasn't connected Spotify at
`/admin`), `spotify_recent_needs_consent` (Spotify works but the grant predates the P2.1 Recent scopes;
Stephen reconnects once at `/admin` → Spotify), `controls_not_connected` (no `HA` Workers VPC binding or no `HA_TOKEN` yet),
`controls_ha_unreachable` (the last HA call failed: tunnel, `cloudflared` or HA down),
`controls_no_cameras` (HA connected but no cameras mapped at `/admin` › Controls), `tasks_scope_missing` (the calendar grant works but lacks the Google Tasks permission v2 asks for;
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
ageDays, stale}, publishedAt}`. `grants.calendar` is `{status, tasksScope}`. `spotify` is `{configured, status, connectedAt, reconnectBy}`. `controls` is `{connected, reachable, cameras}` (`reachable` is null until the first HA call). `tasks` is `{scope, lastFetch, lists, selected, listsEmpty}`. `photos` is `{lastSync, count, missing, cleanup: {queued, deletedToday}}`: `cleanup.queued` is how many old or failed photo sets wait for the cron to delete them and `deletedToday` the KV deletes used today (UTC, budget 900). Both are informational; a queue that stays above 0 for days only means the daily delete budget is pacing it. `frame.build` is the build the frame last reported, so it shows whether
the frame reloaded after a deploy.

## Email template

Subjects are `Smart frame: alert` and `Smart frame: recovered`. Messages are short, content-free,
and include one appropriate next step; they never include credentials or pairing links.
