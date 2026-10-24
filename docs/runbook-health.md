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

Soft (shown, no email): `weather_stale`, `calendar_stale` (the cron will retry; the frame keeps
showing the last good data), and `reflection_no_current_week` (publish the next guide).

## Email template

Subject: `Frame: <problem>`.
Body: what's wrong in one line, when it started, and the fix: "Open
https://smart-frame.sredden.workers.dev/admin and reconnect Google" for a grant, or "Check the frame
is on and on Wi-Fi" for offline.
