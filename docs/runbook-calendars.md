# Runbook: choosing calendars (v1.1)

The frame shows events from the calendars selected on /admin → **Calendars**. With nothing selected
it shows the primary calendar only (the v1 behaviour).

## After the v1.1 deploy (once)

1. v1.1 asks Google for one more read-only permission, `calendar.calendarlist.readonly`
   ("See the list of Google calendars you're subscribed to"). Listing calendars needs it; reading
   events on any calendar is already covered by `calendar.events.readonly`.
2. Optional: in Google Cloud console → Google Auth Platform → Data Access, add that scope next to the
   existing calendar scope so the consent screen lists it.
3. On /admin → Google, click **Reconnect calendar** and approve. Until then the frame keeps showing the
   primary calendar and **Load calendars from Google** says to reconnect.

## Choosing

1. /admin → Calendars → **Load calendars from Google**. The first load selects only the primary calendar.
2. Tick the calendars to show (25 at most) → **Save selection**. Saving refreshes the cache at once,
   so the frame updates on its next poll.
3. Load again any time calendars are added or removed on the account; ticks are kept, and calendars no
   longer on the account drop off.

## Behaviour

- One `events.list` per selected calendar per refresh (every 5 min), today through 30 days ahead.
  Free-plan Workers allow 50 subrequests per invocation; 25 calendars + weather + a token refresh fit.
- A calendar that fails (removed, no access) is skipped and logged as `calendar_error` with counts only;
  if every calendar fails the previous cache stays and the usual stale label appears.
- When nothing is left today and tomorrow has no timed event, the info line shows the next event within
  30 days: `Next: Tue, Nov 3, 9:00 AM · …`.
- Each event carries its calendar's Google colour (`color`) in the payload, for the v2 Calendar screen.

## Schema

The `calendars` table is created by the Worker's runtime schema (`worker/src/db.js`, `CREATE TABLE IF
NOT EXISTS`), the same as every other table, so there is no migration to apply.
