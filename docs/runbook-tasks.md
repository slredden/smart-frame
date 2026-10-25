# Runbook: Tasks on the frame (v2 P1b)

The Tasks screen shows Google Tasks from up to 10 lists, grouped Overdue / Today / Upcoming / No date.
Tasks come from the **calendar** Google grant (the Workspace account, Q11) with the
`https://www.googleapis.com/auth/tasks` permission added by P1's batched consent.

## Turning it on (once)

1. Google Cloud console → APIs & Services → **Google Tasks API** is enabled, and the consent screen's
   Data Access page lists `https://www.googleapis.com/auth/tasks` (see runbook-calendars.md).
2. /admin → Google → **Connect calendar**, and leave the Tasks tick box on.
   Until then the Tasks screen says "Connect calendar on /admin to enable Tasks" and `/api/health`
   shows the soft `tasks_scope_missing`.
3. /admin → Task lists → **Load task lists from Google**, tick up to 10, **Save task lists**. Or on the
   frame: Tasks → **Lists**, or Settings → Task lists. Nothing ticked means the default list.

## Behaviour

- The cron refreshes tasks every 15 minutes: one `tasks.list` per selected list (open tasks only,
  ≤ 100 per list). A list that fails is skipped and logged as `tasks_error` with counts only.
- Check-off: tap the circle; a "Done · Undo" toast stays 10 s. Only after it closes does the frame send
  `POST /api/tasks/:list/:task/complete`. The Worker accepts it only for a task that is in its cache
  and in a list the frame shows, with no body or `{status:"completed"}`, inside the device's
  60 writes/hour budget. It then makes one Google `PATCH` and removes the task from its cache.
  Completing a parent leaves its subtasks open, as Google does.
- Home's agenda shows "Due today: …" (Settings → Tasks on Home turns it off).
- The daily tasks banner is at 9:00 AM when anything is due today or overdue (see Alerts below).
- Logs carry counts and HTTP statuses only, never task or list titles.

## Health

- `tasks_scope_missing` (soft): the calendar grant lacks the Tasks permission. Reconnect at /admin.
- `tasks_lists_empty` (soft, flagged for Chief): Tasks is granted but Google returned no task lists,
  usually because the grant went to an account that doesn't use Google Tasks. Check which account was
  connected at /admin → Google; create a list in Google Tasks or reconnect with the right account.
  It clears on the next good refresh or list load.
- `tasks_stale` (soft): no good tasks refresh for over 60 minutes. The frame keeps the last cache and
  shows "Updated … ago".
- `tasks` in the health JSON: `{scope, lastFetch, lists, selected, listsEmpty}`.

## Alerts (computed on the frame)

Settings → Alerts on the frame (or the defaults below). Banners come from the cached `/api/state` data,
so they work while the Worker is unreachable.

| Setting | Default | Range |
| --- | --- | --- |
| Event alert | 10 min before (0 = off) | 0, 5, 10, 15, 30, 60 min |
| Chime | On, 60 % | 20–100 % in 10 % steps |
| Tasks alert | On, 9:00 AM | 6:00 AM–12:00 PM, 15 min steps |
| Quiet hours | Night (10 PM–6 AM) | or a custom range |

- Each calendar has its own Alerts on/off (frame: Calendar → Calendars → bell button; /admin → Calendars).
- Event banners show from the lead time until 5 minutes after the start; all-day events never alert.
- In quiet hours there is no chime and events starting then don't alert; a tasks alert that falls in
  quiet hours fires when they end. The night clock never shows banners.
- Each alert fires (and chimes) once; ✕ dismisses it; **Open** goes to Calendar or Tasks.
- If the WebView refuses to play the chime, it plays on the next tap instead.
- The chime's loudness is also limited by the Android **media** volume on the frame.

## Free-plan budgets (Workers Free)

| Resource | Limit | P1b use |
| --- | --- | --- |
| Subrequests per cron run | 50 | ≤ 1 token refresh + 1 weather + 25 calendars + 10 task lists = 37 |
| Subrequests per check-off | 50 | ≤ 1 token refresh + 1 PATCH |
| D1 writes/day | 100,000 | tasks: ≤ 2 per 15-min refresh (cache row only when changed, plus `tasks_ok_at`) = ≤ 192/day; frame writes ≤ 60/hour per device |
| KV writes/day | 1,000 | none added (favorites and hides are D1 rows; photo copies unchanged) |
| CPU per request | 10 ms | the frame does grouping and alerts; the Worker only filters the cache |
