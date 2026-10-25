# Runbook: choosing calendars (v1.1, v2 P1)

The frame shows events from the calendars selected on /admin → **Calendars**, or on the frame itself
(Settings → Calendars, or the **Calendars** button on the Calendar screen). With nothing selected it
shows the primary calendar only (the v1 behaviour).

## After the v2 P1 deploy (once): batched consent

P1's **Connect calendar** also asks for Google Tasks (`https://www.googleapis.com/auth/tasks`, "Create,
edit, organize, and delete all your tasks") so v2 needs only one more reconsent. This covers the v1.1
step below too.

1. Google Cloud console → APIs & Services → enable **Google Tasks API**.
2. Google Auth Platform → Data Access → add `https://www.googleapis.com/auth/tasks` (and
   `calendar.calendarlist.readonly` if it's not there yet).
3. /admin → Google → **Connect calendar** and approve. The Tasks tick box is optional: the calendar
   connects without it, and `/api/health` then shows only the soft `tasks_scope_missing`.
   Picking task lists: see runbook-tasks.md.

## After the v1.1 deploy (once, superseded by the P1 step above)

1. v1.1 asks Google for one more read-only permission, `calendar.calendarlist.readonly`
   ("See the list of Google calendars you're subscribed to"). Listing calendars needs it; reading
   events on any calendar is already covered by `calendar.events.readonly`.
2. Optional: in Google Cloud console → Google Auth Platform → Data Access, add that scope next to the
   existing calendar scope so the consent screen lists it.
3. On /admin → Google, click **Connect calendar** (the same button as the first connect) and approve. Until then the frame keeps showing the
   primary calendar and **Load calendars from Google** says to click **Connect calendar** first.

## Choosing

1. /admin → Calendars → **Load calendars from Google**. The first load selects only the primary calendar.
2. Tick the calendars to show (25 at most) → **Save selection**. Saving refreshes the cache at once,
   so the frame updates on its next poll.
3. Load again any time calendars are added or removed on the account; ticks are kept, and calendars no
   longer on the account drop off.

## Behaviour

- One `events.list` per selected calendar per refresh (every 5 min), from this week's Monday through
  30 days ahead (the Calendar screen's Week view needs the earlier weekdays; same request count).
  Free-plan Workers allow 50 subrequests per invocation; 25 calendars + weather + a token refresh fit.
- A calendar that fails (removed, no access) is skipped and logged as `calendar_error` with counts only;
  if every calendar fails the previous cache stays and the usual stale label appears.
- When nothing is left today and tomorrow has no timed event, Home's agenda shows the next event within
  30 days: `Nothing else today. Next: Tue, Nov 3, 9:00 AM · …`.
- Each event carries its calendar's Google colour (`color`) in the payload, for the v2 Calendar screen.

## Alerts per calendar (P1b)

Each calendar has an alerts switch (default on): /admin → Calendars ("alerts" tick), or on the frame
Calendar → Calendars → **Alerts on/off**. Off keeps the calendar on the frame without event banners.
Stored as `calendars.alert`; events from a calendar with alerts off carry `na: true` in `/api/state`'s `soon` list, and the frame skips them.

## Schema

The `calendars` table is created by the Worker's runtime schema (`worker/src/db.js`, `CREATE TABLE IF
NOT EXISTS`), the same as every other table, so there is no migration to apply.
