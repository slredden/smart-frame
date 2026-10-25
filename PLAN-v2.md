# smart-frame v2 plan: one Home, nav rail, Calendar, Tasks, Weather, Photos, Reflection, Controls, Settings, alerts and brightness

Status: **approved 2026-10-24** (Stephen, 6:53 PM MT, through Chief: Dev's recommended defaults on Q1, Q2, Q10, Q11 and Q12). **v1.2, phase F and P1 shipped 2026-10-24** (§13.1). P1b is approved and next; H, P2 and D are not yet approved. It builds on
[PLAN.md](PLAN.md) (v1, shipped) and v1.1 (shipped, §12). Nothing here changes v1 decisions unless it says
so. **v2 does change one:** the A/B layouts and the A/B tap swap are removed (§2).

- Effort means focused agent time, as in PLAN.md §16.
- **[S]** marks Stephen's own steps.
- Every new Cloudflare or Google resource, secret or consent needs Stephen's go through Chief.
- The fixed rules still hold:
  - free Cloudflare plan and no spend
  - no DNS changes and no custom domain
  - nothing publicly findable
  - the frame holds no secret except its device token

## 0. What v2 adds

Decided by Stephen through Chief on 2026-10-24, and replacing the first draft of this plan:
- **One Home layout.** The full-bleed photo layout with the corner card (v1 "A") and the A/B tap swap
  are **removed**. Home is the v1 split screen (v1 "B"): photo on the left, info column on the right.
- On Home, tapping a widget opens its screen, and tapping anywhere else shows the menu rail for 30 s.
- New screens: Calendar, Tasks, Weather, Photos, Reflection, Controls (the screen first drafted as "House"), and Settings.
- Across all screens: **alerts** (a banner plus an optional chime before events and for tasks due) and
  **brightness** (manual, or auto from the light sensor; the auto part needs a kiosk change, §10).

| Screen | One line |
| --- | --- |
| **Home** | The v1 split screen (photo left, clock/weather/agenda/reflection right) plus the night clock |
| **Calendar** | All calendars on the account, chosen by Stephen, as agenda, day or week |
| **Tasks** | Google Tasks from the selected lists, with check-off (if the scope allows) and a "Due today" line on Home |
| **Weather** | Today hour by hour, plus a 10-day outlook (Open-Meteo, no key) |
| **Photos** | The photo set, with interval, order, captions, fit, pause/next/prev, favorite and hide |
| **Reflection** | The current guide from Sage: this week in full, the guide's weeks, and recent guides |
| **Controls** | Lights, TV and media, Spotify and Ring snapshots, through Home Assistant (Phase 2) |
| **Settings** | Frame-wide options: calendar and task-list selection, day/night schedule, night dim, idle timeout, weather location, alerts, brightness |

Wes Bos's reference labels its control view "Home" next to "Today". We call ours **Controls** so it can't
be confused with Home.

## 1. Inputs read for this plan

- PLAN.md, the v1 code (`worker/`, `frame/`, `shared/`, tests) and `docs/runbook-*.md`.
- Wiki: `house/photo-frame.md` (decisions, schedule, touch rules), `house.md` (Alexa hub, 15 lights, Ring
  cameras), `house/omada-network.md` (the device scan of 2026-10-19/24: Roku Streambar `.61` ECP :8060,
  Harmony Hub `.109` :8088, Wemo plugs `.60 .83 .105 .108` :49153 with `.72` silent, Cast on :8009 at
  `.76` Fire TV, `.104`, `.115`, `.132`; Samsung TV `.67` did not answer; ReddenNAS `.9`; cloud-only:
  Ring, Wyze, Echo, Nest Protect, myQ, Rachio, Emporia, Tuya/ESP devices, a GE light),
  `house/firetv-dumbtv.md` (Fire TV ADB from the home PC, Alexa off on the TV).
- Reference repo `wesbos/photo-frame-dashboard` at `0bff55e` (box clone): `dashboard/index.html`
  (`<nav class="rail">`, 76 px column, one `button.rail-item[data-go]` per view, a clock at the bottom),
  `css/base.css` (`grid-template-columns: 76px 1fr`, 72 px items, active item inverted),
  `js/app.js` (`App.go(name)` toggles `.view.is-active` and `.rail-item.is-active`; switches on
  `pointerdown`; views are built once and kept hidden; idle returns to the home view after 60 s and to
  ambient after 120 s; in "nightdash" mode the rail is hidden). It's demo data only (no backend).
- Kiosk source `dashboard/kiosk/src/com/wesbos/homehq/MainActivity.java` in the same reference repo (MIT)
  and the device plan `/workspace/projects/photo-frame/PLAN.md` §5 (box copies, not in this repo).

### 1.1 Frame hardware (checked by Chief over adb, 2026-10-24)

| Part | Present? | What v2 does with it |
| --- | --- | --- |
| Display | 10.1", 1280×800, DPR 1, touch | Layout and hit sizes (§2) |
| **Camera** | **No** (`/dev/video*` absent) | Nothing. No presence detection, no video, no QR scanning |
| **Microphone** | **No** | Nothing. No voice control, no wake word, no sound-level sensing |
| Audio output | Yes: `audiocodec` and `android.hardware.audio.output`. Probably a small speaker; not yet heard | Optional alert chime (§9). Confirm with a test tone on the frame (§14) |
| Ambient light sensor | Yes | Auto-brightness (§10), through a kiosk change that needs Stephen's OK |
| Bluetooth / BLE | Yes | Not used. Spotify plays on Connect/Cast speakers, not through the frame (§11.5) |
| Accelerometer (`sc7a20`) | Yes | Not used. Possible later: knock-to-wake or a tilt warning. Nothing planned |
| Thermal sensor (`sunxi-ths`) | Yes | Not used in v2. The same kiosk bridge could later report the SoC temperature to the heartbeat |

- **SoC and OS:** PF1007L, Allwinner A33 (ARMv7), Android 6.0.1, about 1 GB RAM, WebView 106.0.5249.126
  (device plan step 4), and the Home HQ kiosk (step 6).
- **No camera or microphone assumptions.** Nothing in v1 or this plan uses either. v1 PLAN.md §1 already
  rules out motion-sensor wake and voice, and v2 keeps that. The only "cameras" here are the Ring cameras,
  shown as snapshots fetched through Home Assistant (§11).

## 2. Navigation, Home, schedule and touch

### 2.1 Schedule (changed from v1)

v1 had three states: B 6–7, A 7–22 and night 22–6. B existed only as a quieter morning layout. With one
day layout, the 6:00 and 7:00 boundaries mean the same thing, so the schedule becomes:

```
scheduled(m, s):        # m = Denver minutes past midnight; s = settings.schedule
  if s.dayStart <= m < s.nightStart → HOME     # defaults: dayStart 06:00, nightStart 22:00
  else                              → NIGHT
```

- **Home 6:00–22:00, night 22:00–6:00** by default. Both times can be changed in Settings (§7).
- **The dim night clock stays.** The panel's backlight can't be dimmed from the page today (PLAN.md §8), so a
  black screen with a faint clock is still the closest we get to "off". Phase D adds real backlight
  control through a kiosk change (§10). It also keeps photos from lighting
  the room at night. The dim level becomes a setting (§7).
- Time zone stays America/Denver for the clock and schedule, even if the weather location changes.

### 2.2 Rail

- **Order (decided by Stephen through Chief, 2026-10-24): Home, Calendar, Tasks, Weather, Photos,
  Reflection, Controls, Settings.** This settles the old Q1. The order is one array in `nav.js`.
- Each screen has a `features.<name>` flag in `/api/state` and joins the rail when its phase ships.
  Controls stays hidden until Phase 2.
- **Size check for 8 items at 1280×800, DPR 1.** The frame is 10.1" at about 150 px per inch, so
  1 px ≈ 0.17 mm.
  - The rail is **96 px wide** (up from 88) and the full 800 px tall.
  - The seven screen items sit in a top group. Each is **96 × 72 px** (about 16 × 12 mm) with 8 px gaps,
    so the group takes 7 × 72 + 6 × 8 = 552 px.
  - **Settings is pinned near the bottom** (96 × 72 px), but above the kiosk's Menu zone. v1's `idle.js`
    leaves the bottom-left 96 × 72 px (`MENU_ZONE`) to the kiosk's optional Menu button, so no rail item
    may sit there. From the top:

    | y (px) | What |
    | --- | --- |
    | 0–552 | Seven screen items |
    | 552–576 | Empty |
    | 576–640 | Small clock (not a button) |
    | 640–648 | Gap |
    | 648–720 | **Settings** |
    | 720–728 | Gap |
    | 728–800 | Kiosk Menu zone (no rail button) |

    The clock sits between Controls and Settings, which puts 96 px between those two buttons, so a slip
    can't open Settings.
  - Each item has a 28 px icon and an 11 px uppercase label. The longest label, "REFLECTION", is about
    76 px wide and fits inside the 96 px with padding. An e2e check fails if any label overflows
    (`scrollWidth > clientWidth`).
  - Every item is above the 64 × 64 px minimum and keeps the 8 px gap (§2.4).
  - Before Phase 2 (Controls hidden) the top group has six items and the empty space grows.
  - The active item is inverted, as in the reference.
- **Rejected: a "More" group.** It would add a second tap and a popover for screens used daily, and all
  eight fit. Reconsider only past nine items.
- **Rejected: icon-only 64 px squares.** Labels matter on a frame the whole family uses.
- Class name `nav-rail`. v1 already uses `.rail` for Home's info column, so the reference's name would
  clash.
- `frame/src/nav.js` (pure, unit-tested) holds `{view, lastTouchMono, peekUntilMono}`. `main.js` switches
  between prebuilt view subtrees with `display`. Views other than Home are built on first visit.
- Taps register on `pointerup` with one finger, using the v1 filter (`idle.js`: 400 ms debounce,
  multi-touch ignored for the kiosk's two-finger menu, and the bottom-left 96×72 px Menu zone left alone).
  That's why we don't switch on `pointerdown` as the reference does.
- Inline SVG icons and no transitions on the rail.

### 2.3 Home taps (replaces the v1 A/B swap)

| Where and when | What a tap does |
| --- | --- |
| **Night clock** (any spot) | **Wakes to Home with the rail showing for 30 s.** It never opens a widget, even if it lands where a widget would be |
| Home, **weather** widget (now, high/low, 3-day row) | Opens **Weather** |
| Home, **agenda** widget (all-day line, "Today", rows, "Nothing else today. Next: …") | Opens **Calendar** (agenda view, today) |
| Home, **reflection** widget | Opens **Reflection** |
| Home, anywhere else (photo, clock, date, the gaps between widgets) | Shows the rail for 30 s (`RAIL_PEEK_S`). Tapping again while it shows restarts the 30 s |
| Rail button | Goes to that screen |
| A tap during the 400 ms after waking | Ignored (debounce), so the waking tap can't also open a widget |

- The rail appears as an overlay on the left 96 px of the photo, so Home's layout never moves. The photo
  stays 794 px wide.
- The widgets get `data-go="weather|calendar|reflection"`. One delegated listener reads `closest('[data-go]')`,
  so there are no per-widget handlers.

### 2.4 Hit areas (1280×800, DPR 1)

- **At least 64 × 64 px** (about 11 mm) for any tap target, with **at least 8 px** of non-target space
  between neighbours. This is above Android's 48 dp guidance at this density.
- The Home widgets are whole blocks inside the 486 px info column:
  - Weather: about 486 × 200 px.
  - Agenda: about 486 × 260 px, never shorter than 120 px even when empty.
  - Reflection: about 486 × 120 px, never shorter than 96 px.
- Each widget's hit box is its padded block, not just its text. The CSS sets `min-height` so a short day
  can't shrink a target.
- Other screens follow the same rules:
  - Toolbar buttons: at least 72 × 72 px.
  - List rows (calendars in Settings, weeks in Reflection): at least 64 px tall.
  - Steppers (schedule, idle, dim): buttons of at least 72 × 64 px. No sliders, because they're hard to
    use on a resistive-feeling panel.
- An e2e check measures `getBoundingClientRect()` of every `[data-go]`, `button` and `.row` against these
  minimums.

### 2.5 Idle and wake (one timer, no A/B override)

```
state = { view: 'home', lastTouchMono: null, peekUntilMono: 0 }
awake(now)    = lastTouchMono != null && 0 <= now - lastTouchMono < idleMs
screen(now)   = awake(now) ? state.view : scheduled(denverMinutes, schedule)   # HOME or NIGHT
railShown(now)= screen(now) != NIGHT && (state.view != 'home' || now < peekUntilMono)
onTap(target) : if screen == NIGHT → view = 'home', peek 30 s           # wake only
                elif target is rail item → view = item
                elif view == 'home' and target has data-go → view = data-go
                elif view == 'home' → peek 30 s
                lastTouchMono = now
```

- `idleMs` is the Settings idle timeout (default 10 min, the v1 value). When it runs out, the frame goes
  back to the scheduled screen, which is Home in the day window and the night clock in the night window.
- A frame woken at 23:00 that is left alone falls back to the night clock after the idle timeout.
- `version.js`'s quiet-moment check uses `awake()` instead of `overrideActive`, so a safe reload still
  waits until nobody is using the frame.

### 2.6 v1 code and tests removed or simplified (Phase 1, first commit)

| File | Change |
| --- | --- |
| `frame/index.html` | Delete `<section id="screen-a">` and its `.card`. Rename `#screen-b` to `#home`. Add the nav rail and the view sections |
| `frame/styles/frame.css` | Delete `.screen-a #screen-a`, `.card` and `.next` (A only). Fold the base `.clock-row` into `.rail .clock-row.big`, because Home and night still use it. Keep `.rail` (the info column) |
| `frame/src/schedule.js` | Delete `A`, `B`, `MORNING_START`, `initialState`, `overrideActive`, `screenAt`, `onTap`, `expire` and `overrideRemaining`. It shrinks to `scheduled(minutes, schedule) → HOME/NIGHT`. Override and idle logic move to `nav.js` |
| `frame/src/main.js` | Delete the `?screen=a/b` hooks (they become `?screen=home/night/<view>`), the A-only bindings (`setText('next', …)`, `shortDate`) and the A/B switching in `currentScreen`. Keep `renderCalendar`'s agenda and the "Nothing else today. Next: …" row |
| `frame/src/agenda.js` | Keep `nextLine` (the B empty-agenda row uses it). Fix its comment ("for screen A") |
| `frame/src/version.js` | `quietMoment({awake, crossfading})` |
| `test/unit/schedule.test.js` | Delete "day: taps swap A and B", "morning: tap on B shows A" and "night: first tap wakes to A, second swaps to B". Rewrite "follows the day plan" (6–22 Home) and the DST test with configurable bounds. Move the idle and override tests to a new `test/unit/nav.test.js` |
| `test/e2e/run.mjs` | Drop the `a` case. `b` becomes `home`, and `morning-scheduled` expects `home`. The tap test checks that night tap → home + rail, that a widget tap opens its screen and an off-widget tap peeks the rail. Add the hit-size check |
| `PLAN.md` §1, §8 and `docs/` | Add a short note pointing to PLAN-v2 for the new Home/schedule (PLAN.md stays as the v1 record) |
| `worker/` | No change needed. Nothing in the Worker knows about A/B. `IDLE_MINUTES` becomes the default under the D1 setting |

**Where the removal belongs:** the first commit of Phase 1, together with the rail. If A/B is removed
without the rail, a daytime tap does nothing, and the 6–7 change ships with nothing new to show for it.
If Stephen wants A gone sooner, the same commit can ship alone as a ~2 h v1.2, with taps waking the
frame only (**Q1**).

## 3. Calendar screen

### 3.1 Which calendars (selection)

v1 reads only the primary calendar, which is often empty; most events live on about 21 other calendars.
v1.1 (§12, shipped) adds selection
on `/admin`. v2 adds it on the frame, in **Settings** (§7), with a shortcut from the Calendar screen.

- Source of truth: D1 table `calendars (id, summary, color, is_primary, selected, position, updated_at)`
  (created in v1.1). `color` is the calendar's `backgroundColor` from `calendarList`.
- The list is refreshed from Google only on demand (`/admin` "Load calendars" and a "Refresh list" button
  on the frame's selection sheet), never by the cron.
- Frame: Settings › Calendars, and a "Calendars" button at the top right of the Calendar screen, open the same sheet with one row per
  calendar (color chip, name, checkbox). Changes are saved on "Done" with
  `PUT /api/calendars/selection` (device auth, same validation as the admin PUT: known ids only, at most
  25). Saving triggers one immediate calendar refresh.
- Default when nothing is selected: primary only (v1 behaviour).
- Each event carries its calendar's `color` (already in the v1.1 payload). Rows show a 4 px left bar in
  that color; week/day blocks use a 15% tint (computed in JS into `rgb()`; 8-digit hex is banned by PLAN.md §10).

### 3.2 Views

- **Agenda** (default): the next 14 days grouped by day, starting today. All-day events on the top line of
  each day ("All day · A · B" as v1). Empty days are skipped; if the 14 days are empty, show the v1.1
  look-ahead line ("Next: …") or "Nothing in the next 30 days".
- **Day**: one day, 6:00–22:00 grid (rows of 30 min, 44 px each, scrolls), all-day strip on top,
  prev/next day buttons. Overlaps are laid out in up to 3 side-by-side columns, then "+n".
- **Week**: 7 columns Mon–Sun, all-day strip, 7:00–21:00 grid, prev/next week. Titles truncate to one line.
- A segmented control (Agenda | Day | Week) and a "Today" button. The chosen view is a frame setting
  (§7) so it persists.
- v1 filters apply everywhere: drop cancelled, free (transparent), working-location and self-declined
  events (`normalizeEvents`).

### 3.3 Data and budget

- The v1.1 cron already fetches each selected calendar with one `events.list`, today → +30 days,
  `orderBy=startTime`, `singleEvents=true`, `maxResults=50`. v2 keeps **all** events in that window in
  the one `calendar` cache row instead of trimming to today/tomorrow/next (one D1 write per refresh;
  ~25 × 50 events ≈ 150 KB worst case, under D1's 2 MB row limit).
- New `GET /api/calendar?from=YYYY-MM-DD&days=N` (device auth, N ≤ 14) slices the cached row. Past
  days (prev buttons before today) are out of the cached window: show "Earlier days aren't loaded"
  rather than fetch on demand (keeps one code path and the subrequest budget). → **Q3**.
- Budget (Workers Free: 50 subrequests and 10 ms CPU per invocation, 100,000 requests/day; subrequests
  aren't billed): a cron run uses ≤ 1 token refresh + 1 weather + N calendars, so N ≤ 25 (enforced).
  Google: 22 calendars × 288 runs ≈ 6.3k `events.list` calls/day. Workers allow 6 simultaneous
  connections, so 22 fetches queue in ~4 waves; wall time isn't CPU time. If CPU on the cron ever
  exceeds 10 ms (watch `calendar_error` / exceeded-CPU in logs), move calendars to every 10 min.
- Truncation: a calendar with more than 50 events in 30 days loses the tail. Acceptable for agenda; the
  admin list shows a "busy calendar" note when a fetch hit 50 items.

## 4. Tasks screen (new)

### 4.1 API, scope and the one reconsent

- **The Google Tasks API is separate from Calendar.** It's its own API to enable in the same Cloud
  project, with its own scopes. The Calendar API doesn't return tasks.
- Calls:
  - `tasklists.list`, on demand only, for the selection sheet.
  - `tasks.list`, once per selected list, with `showCompleted=false`, `showHidden=false`,
    `maxResults=100` (the API maximum) and `fields` trimmed to `id,title,due,status,parent,position`.
    Task notes are never fetched.
- **`due` is date-only.** The Tasks reference says only the date is recorded: the time part is dropped
  when a due date is set, and the API can't read or write a due time. So a task set for "3 PM" in the
  Google Tasks app arrives with only its date. Tasks show no times, and task alerts are once a day
  (§9.1).
- **Scope: recommend `https://www.googleapis.com/auth/tasks`** ("Create, edit, organize, and delete all
  your tasks") so tasks can be checked off from the frame (§4.4). If Stephen doesn't want check-off, use
  `https://www.googleapis.com/auth/tasks.readonly` ("View your tasks"). `tasks.list` works with either.
  - There's no narrower write scope. Starting read-only and adding check-off later would cost a second
    reconsent, so decide now → **Q10**.
  - The Worker narrows what the frame can actually do (§4.4).
- **One reconsent for all of v2.**
  - The `calendar` grant's scopes in `worker/src/google/oauth.js` become: `calendar.events.readonly`, plus
    `calendar.calendarlist.readonly` (v1.1), plus `tasks` (or `tasks.readonly`).
  - That change ships in **P1's first deploy**, before the Tasks screen exists. Stephen then clicks
    **Connect calendar** (the `/admin` button) once, and that one click also covers v1.1's still-pending reconnect.
  - The Photos grant (`photospicker.mediaitems.readonly`) doesn't change. v2 adds **no other Google
    scope**: Weather uses Open-Meteo, and Alerts reuse cached data.
  - Until the reconnect, health shows a soft `tasks_scope_missing` code, and the Tasks screen shows
    "Reconnect on /admin".
- This assumes the tasks live on the same Google account as the calendar grant → **Q11**. If they don't,
  Tasks needs its own `tasks` grant and connect button (+0.25 day).

### 4.2 Lists (selection)

- D1 table `tasklists (id, title, selected, position, updated_at)`, created by the runtime schema (no
  migration to apply).
- The list is loaded only on demand: "Load task lists" on `/admin`, or "Refresh lists" on the frame's
  sheet. The cron never loads it.
- The default selection is the account's default list (`@default`) only. At most 10 lists can be selected.
- On the frame, Settings › Task lists and a "Lists" button on the Tasks screen open the same sheet. It
  saves with `PUT /api/tasklists/selection`, which has these guards:
  - device auth
  - known ids only, at most 10
  - counts toward the 60 writes per hour limit (§7.3)
  - saving triggers one refresh

### 4.3 Screen

- **Tabs** across the top: "All" plus one tab per selected list, each 72 px tall.
- Each tab has these sections:
  - **Overdue**, marked in red
  - **Today**
  - **Upcoming**, by due date
  - **No date**, in Google's `position` order
- Subtasks are indented under their parent.
- Rows are 72 px tall: a 64 × 64 check circle (only with the `tasks` scope), then the title on one line,
  then the due label ("Today", "Fri", "Nov 3", "Overdue · Oct 20").
- An empty tab shows "Nothing to do". The v1 stale label shows when the cache is over 60 min old.
- **Home agenda line** (setting `tasks.onHome`, default on): after the agenda rows, one line such as
  "Due today: Pay water bill · +2", shown only when something is due today or overdue. It sits inside the
  agenda widget, so tapping it opens Calendar. A separate tap target would be under the 64 px minimum.

### 4.4 Check-off (only with the `tasks` scope)

- **Tapping the circle** strikes the row through at once and shows a 10 s "Done · Undo" toast. The frame
  calls `POST /api/tasks/:list/:task/complete` (device auth) only when the toast ends. Undo during the
  10 s sends nothing.
- **Worker guards:**
  - The device token is required.
  - The list must be selected, and the task id must be in the current cache. Arbitrary ids are refused.
  - Only one Google call is made: `tasks.patch` with `{status: "completed"}`. There are no create,
    rename, move, delete, notes or reopen endpoints. Reopening happens in Google Tasks itself.
  - Writes share the 60 per device per hour limit.
  - Only status codes are logged, never titles.
  - The cache row is updated in place (one D1 write).
- **Worst case if the device token leaked:** someone could mark tasks done in the selected lists. That's
  reversible in Google Tasks, and the device can be revoked on `/admin`.
- With `tasks.readonly`, there are no circles and the screen is view-only.

### 4.5 Data and budget

- **Refresh:** inside the `*/5` cron, tasks refresh when the cache is older than 15 min, and also right
  after a selection change.
- **Subrequests per run:** at most 1 token refresh (shared with Calendar, since it's the same grant),
  plus 1 weather, plus 25 calendars, plus 10 task lists = **37, under the 50 cap**. The selection limits
  enforce this.
- **D1 writes:** one `cache` row `tasks` plus one `meta` `tasks_ok_at` per refresh, so at most 192 rows a
  day. The cache row is skipped when its content hash hasn't changed. That's 0.2% of the free 100k.
  **No KV writes.**
- **Google calls:** 10 lists × 96 refreshes ≈ 960 `tasks.list` calls a day.
- **What the frame gets:**
  - `/api/state` carries only `tasks.dueToday` and the overdue count, for the Home line and alerts.
  - `GET /api/tasks` (device auth) returns the full trimmed set when the Tasks screen opens, then every
    5 min while it's open.

## 5. Weather screen

- **Layout:**
  - Top: now (large icon, temperature, label), today's high/low, sunrise and sunset.
  - Middle: **hourly for the next 24 h** as a horizontally scrolling strip of 24 cells, 96 × 180 px each,
    showing the hour, icon, °F and precipitation %.
  - Bottom: **10-day outlook** as rows 64 px tall, showing the weekday, icon, high/low bar, precipitation % max and wind.
- A "Updated 4 min ago" line, and the stale label used by v1 (`staleLabel`) when the cache is over 60 min old.
- **Data: still one Open-Meteo call**, made by the existing weather refresh (`worker/src/weather.js`).
  `weatherUrl` adds:
  `hourly=temperature_2m,precipitation_probability,weather_code,is_day,wind_speed_10m`,
  `forecast_hours=24`, `daily=…,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max`,
  `forecast_days=10`, `wind_speed_unit=mph`. The raw response measured 2026-10-24 with these
  parameters is ~2.8 KB. The normalized cache value stays under 3 KB.
- `normalizeWeather` keeps today, `next3` (Home is unchanged) and adds `hourly[24]` and `daily[10]`.
  `/api/state` keeps sending only the Home fields. New `GET /api/weather` (device auth) returns the full
  value and is called when the Weather screen opens, then every 10 min while it's open.
- **Cron and cache cost: no change in cadence or writes.** Refresh stays "if older than 10 min" inside
  the `*/5` cron. Each refresh is still one subrequest, one `cache` row upsert and one `meta`
  (`weather_ok_at`) upsert. That's ≤ 288 D1 rows written a day, the same as v1. That's 0.3% of the free
  100k, and **no KV writes**.
- The location comes from Settings (§7). Changing it forces one immediate refresh (one extra write pair).
- Open-Meteo's free API is for non-commercial use with no key (the same terms v1 already relies on).

## 6. Photos screen

- Full photo area (1184 × 800 next to the rail) with a bottom toolbar that hides after 5 s:
  **Prev · Pause/Play · Next · ♥ Favorite · Hide · Options**.
- Photo options sheet (saved server-side in `settings.photos`, §7): interval (15 s, 30 s, 1 min, 2 min, 5 min; default 60 s, the v1
  value), order (shuffle daily | in picked order), captions on/off (month + year, v1), fit (fit with
  blurred backdrop, v1 default | fill/crop), "Favorites only" on/off.
- These options drive the Home photo pane too, so photos behave the same everywhere. They stay on this screen and don't appear in Settings.
- **Favorite / Hide**: columns `favorite INTEGER DEFAULT 0`, `hidden INTEGER DEFAULT 0` on `photos`
  (runtime `ALTER TABLE` guarded by a `meta` schema version; see §7.3). Hidden photos leave the manifest
  in `/api/state`; `/admin` Photos gets a "Hidden (n) · Unhide all" control. Hide asks for confirmation
  on the frame ("Hide this photo? Undo"), 5 s undo toast.
- Picking a new set keeps working from `/admin` (Picker API, v1). The frame never starts a Picker session.
- Pause holds the current photo until "Play" or idle return to Home.

## 7. Settings screen and server-side settings

### 7.1 What's on the frame, and what isn't

| On the frame (Settings screen) | `/admin` only (Cloudflare Access) |
| --- | --- |
| Calendar selection (also on `/admin`) | Google connect/reconnect, the Photos picker session |
| Day/night schedule | Device pairing, revoking devices |
| Night dim level | Publish and health tokens, all secrets |
| Idle-return timeout | The Controls allowlist editor (Phase 2) |
| Weather location | "Reset frame settings to defaults" |
| Task-list selection (also on `/admin`) | Enabling the Tasks API and the v2 reconsent |
| Alerts (§9) | |
| Brightness (§10; read-only until phase D) | |

Photo display options stay on the Photos screen (§6) and are stored the same way. **Secrets, Google
connect, pairing and the Controls allowlist never appear on the frame.**

### 7.2 Fields, bounds and defaults

| Key | Field | Default | Allowed (enforced by the Worker) |
| --- | --- | --- | --- |
| `schedule` | `dayStart`, `nightStart` | 06:00, 22:00 | 15-min steps. `dayStart` 04:00–10:00. `nightStart` 18:00–24:00. Day at least 8 h long |
| `night` | `dimPct`, the night clock's opacity | 35 | 15–60. It can't go below 15, so the night screen can't be made invisible |
| `idle` | `minutes` | 10 | 1–60. **No 0 and no "never"**: 0 would make every tap expire at once, and "never" keeps photos on all night |
| `weather` | `name`, `lat`, `lon` | Denver, 39.74, −104.99 (v1 vars) | `lat` −90..90 and `lon` −180..180, rounded to 2 decimals (city level, never a home address). `name` ≤ 80 chars |
| `photos` | `intervalSec`, `order`, `captions`, `fit`, `favoritesOnly` | 60, shuffle, on, fit, off | interval ∈ {15, 30, 60, 120, 300}. Order ∈ {shuffle, picked}. Fit ∈ {fit, fill} |
| `calendar` | `view` | agenda | ∈ {agenda, day, week} |
| (table) | calendar selection | primary | Known ids only, ≤ 25 (v1.1 rules). Each calendar also has an alert on/off (§9.1) |
| (table) | task-list selection | `@default` | Known ids only, ≤ 10 (§4.2) |
| `tasks` | `onHome` | on | on/off |
| `alerts` | `leadMin`, `chime`, `volume`, `quiet`, `tasksAt`, `tasks` | 10, on, 60, night, 09:00, on | See §9.5 |
| `brightness` | `mode`, `manualPct`, `autoMin`, `autoMax`, `nightPct`, `luxFull` | auto, 80, 20, 100, 5, 400 | See §10.3. Night never 0, day never under 10 |

### 7.3 Storage and guards

- D1 table `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL)` with JSON values. `updated_by` is `frame:<deviceId>` or `admin:<email>`.
  It's created with `CREATE TABLE IF NOT EXISTS` in `db.js` (the repo convention, no migration file).
- Code: `shared/settings.js` holds the defaults, bounds and a pure `validateSetting(key, value)`. The
  same code runs in the Worker and in the frame UI, so steppers can't go out of bounds.
- `GET /api/state` includes `settings` (merged over defaults). The frame writes with
  `PUT /api/settings/:key`, `PUT /api/calendars/selection` and `PUT /api/tasklists/selection`, which have these guards:
  - The **device token is required**. A revoked device gets 401. Writes are tied to the device id.
  - **Unknown keys and fields are refused**, along with out-of-bounds values (400 with a problem code).
    Partial objects are merged with the stored value, so a missing field can't reset another one.
  - **Rate limit: 60 setting writes per device per hour**, counted in a `meta` row. Beyond that the
    Worker returns 429. This protects D1's 100k writes/day from a stuck UI loop.
  - The frame sends one PUT when a sheet's "Done" is tapped, not one per stepper press.
  - `/admin` shows each setting's last change (when and by whom) and can reset all of them to defaults.
- **Lock-out proof:**
  - Settings is always one tap away on the rail, and the rail peek can't be turned off.
  - The bounds above rule out values that blank the screen or freeze it awake.
  - `/admin` can always override.
- Writes go to **D1, not KV**. KV's free tier is 1,000 writes/day, and photo ingest already uses up to
  300 of them. Settings, favorites and hides add only a few dozen D1 rows a day.

### 7.4 Weather location without a geocoding key

- In Settings › Weather location, type a city into a text field. The Android 6 soft keyboard opens on
  focus, which is checked on the frame in Phase 1. `/admin` has the same field as a fallback.
- The frame calls `GET /api/settings/weather/search?q=<2–60 chars>` (device auth). The Worker calls
  **Open-Meteo's geocoding API**
  (`https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=5&language=en&format=json`). It's free
  and needs no key; checked 2026-10-24, where "Denver" returns lat/lon, admin1, country and time zone.
  The Worker returns up to 5 `{name, admin1, country, lat, lon}` results.
- Picking a result PUTs the `weather` setting. The Worker validates it, stores it rounded, and refreshes
  the weather once.
- If the picked place's time zone isn't America/Denver, show "The clock stays on Denver time".
- Search queries are not logged. Only the status code and the result count are.

## 8. Reflection screen and freshness

### 8.1 What it shows (only what's already published)

The screen shows **only fields that already reach the Worker through the existing publish path**: the
guide's `{start, end}` and each week's `{n, start, end, theme, practice}`. `cleanGuide` in
`shared/reflection.js` drops everything else, including the title and daily readings. No other Sage
output and no private notes are read, and nothing new is added to the publish payload.

- **This week** (large): "Week 3 of 5 · Oct 4–10", the theme, and the **full practice** (Home clamps it
  to a few lines; `MAX_PRACTICE` is 1,200 chars).
- **This guide** ("the month"): the guide's date range and every week as a row (week number, dates, theme).
  - Past weeks open to their practice when tapped.
  - Future weeks show the theme only, or nothing (**Q4**).
- **Recent guides**: up to the 5 guides before the current one, by date range. Tapping one shows its weeks
  the same way.
- **Empty state:** "No reflection for this week yet." Nothing is shown for a gap, which is how v1 already handles it.
- Data comes from new `GET /api/reflection` (device auth, `cache-control: no-store`). It's fetched on open
  and not polled, because the content changes at most a few times a month. `/api/state` keeps sending only
  the current week for Home.
- **"Monthly" content:** Sage's guides run about 5 weeks (the observed range is 36 days), not calendar months. The
  only month-level fields kept are the date range. If Stephen wants a month-level line (for example the
  guide's intro theme), that means changing the extractor and the publish payload (**Q6**, not in this plan).

### 8.2 History retention

- Today there's **no history**. `worker/src/reflection.js` stores a single row
  (`reflection`, `id = 1`, `data_enc`, `updated_at`), encrypted with AES-GCM under `TOKEN_ENC_KEY` (AAD
  `reflection`). Each publish overwrites it.
- Phase 1 adds the table `reflection_guides (start TEXT PRIMARY KEY, end TEXT NOT NULL, data_enc TEXT NOT NULL,
  published_at TEXT NOT NULL)`. Each row is encrypted the same way.
  - Republishing a guide with the same start replaces that row.
  - On first run, the old `id = 1` row is copied over.
  - The old table is dropped one release later.
- **Keep the 6 most recent guides (about 6 months)**, and delete older ones on publish. **Q5** asks
  whether that's right.
  - At ≤ 8 weeks × (160 + 1,200) chars, plus base64 and the GCM overhead, a guide is ≤ ~15 KB. That's
    ≤ 90 KB in total, against D1's 5 GB free storage and 2 MB per row. Writes are 1–2 rows per publish.
  - **The free plan isn't the limit.** The cap is a privacy choice: keep the minimum of private text on a
    third-party service.
- When guides overlap (Sage publishes the next guide before the current one ends), the picker uses
  **the guide with the latest `start` ≤ today**. Publishing early is then safe: the new guide takes over
  on its start date.

### 8.3 How publishing works today (from the repo, not assumed)

1. **It's manual and done by Chief.** Nothing in the repo runs on a schedule. PLAN.md §9.4 step 1:
   "When Sage finishes a monthly guide, **Chief** runs `node tools/publish-reflection.mjs <guide.html>`".
   `docs/runbook-reflection.md`, "Each month, when a new guide is ready": dry run, then publish.
2. **Source:** Sage's self-contained HTML guide in Stephen's private notes (PLAN.md §9.4,
   "Real source format"). Since PR #1, the extractor also reads the copy published to the private hub
   (`p.meta` date line; `docs/runbook-reflection.md`). The repo doesn't know where Chief finds it, and the wiki's Sage seat recipe
   doesn't mention guides. So **no drop path or Sage cadence is defined** (**Q7**).
3. **CLI** (`tools/publish-reflection.mjs`):
   - It runs `extractGuide` (`tools/lib/reflection-parse.mjs`, then `shared/reflection.js`
     `validateGuide`) **locally**, then prints a
     summary of week numbers, dates and lengths, never the text.
   - `--dry-run` stops there. `--start/--end` override an unparsed date line, and `--base` overrides the
     Worker URL.
   - The token comes **only** from env `SMART_FRAME_PUBLISH_TOKEN`, through `tools/lib/cli.mjs`
     `tokenFrom`. It refuses any value under 24 chars and is never read from an argument.
   - It sends only the cleaned guide JSON to `PUT /api/publish/reflection` as `Bearer`.
   - Exit codes: 0 when published, 1 for any refusal or failure (the message starts with `refused:` or
     `publish failed: HTTP <code>`, or is a network error), and 2 for usage errors.
4. **Worker** (`worker/src/index.js` → `worker/src/reflection.js` `publishReflection`):
   - checks the token against `PUBLISH_TOKEN_HASH`
   - validates the guide again
   - encrypts it and upserts the `id = 1` row
   - sets meta `reflection_published_at`
   - logs `reflection_publish {ok, weeks}`, a count only
5. **Weeks aren't published separately.** One guide is published, and the weeks inside it are
   7-day blocks from `guide.start`. The last week can be up to 14 days long, and a guide has at most
   8 weeks (`validateGuide`). "Weekly" freshness therefore depends entirely on the guide covering today.
6. **Health today** (`worker/src/health.js`): `reflection_no_current_week` is a soft problem that doesn't
   alert. `/api/health` returns `reflection: {currentWeek}`.

### 8.4 Proposed routine for Chief (`smart-frame-reflection`, daily)

| | |
| --- | --- |
| **When** | Daily at **08:00 America/Denver**. Publishing is idempotent, so a daily check costs nothing when nothing changed |
| **Inputs** | (1) The newest `*.html` guide at the agreed private drop path (**Q7**). (2) The publish token file `/home/box/.secrets/smart-frame/publish.token` (mode 600, never printed). (3) The health token file `/home/box/.secrets/smart-frame/health.token`. (4) A local state file holding the last published file's sha256 (no text) |
| **Step 1** | `SMART_FRAME_HEALTH_TOKEN="$(< …/health.token)" node tools/check-health.mjs --json`, then read `reflection.weekly` and `reflection.monthly` (§8.5) |
| **Step 2** | Find the newest guide file and compute its sha256. If it matches the state file and health isn't stale → done, silently |
| **Step 3** | `node tools/publish-reflection.mjs "$GUIDE" --dry-run`. The output has dates and counts only. Check that the range includes or follows today |
| **Step 4** | `SMART_FRAME_PUBLISH_TOKEN="$(< /home/box/.secrets/smart-frame/publish.token)" node tools/publish-reflection.mjs "$GUIDE"`, run in a subshell with `set +x`. The token is never echoed, logged or passed as an argument. On `published:`, save the sha256 |
| **Step 5** | Run health again. Expect `reflection_weekly_stale` and `reflection_monthly_stale` to be gone |
| **Failure: `refused: …`** | Don't retry. Tell Stephen (and Sage, through Chief) the **problem codes only**, e.g. `week_3_length`, plus the runbook fix. Never quote guide text |
| **Failure: HTTP 401** | The publish token doesn't match `PUBLISH_TOKEN_HASH`. Alert Stephen once a day until fixed. Rotation is in `docs/runbook-deploy.md` |
| **Failure: HTTP 400 `problems`** | Same as a refusal |
| **Failure: network / 5xx** | Retry 3 times, 10 min apart, then report it. The next day's run tries again |
| **Nudge** | If the current guide ends within 5 days and no newer file exists, ask Sage (through Chief) for the next guide. If `reflection_monthly_stale` is set, tell Stephen |
| **Approval** | Auto-publishing an unchanged pipeline is assumed to be fine. **Q7** asks whether Chief should publish on its own or wait for a go each time |

### 8.5 Health: `reflection_weekly_stale` and `reflection_monthly_stale`

Both use the Denver date `today`, guide **coverage dates** (not `published_at`, which is reported too)
and the guides stored in §8.2. They're computed in `buildHealth` from the decrypted dates only (no text).

- **Newest guide** = among published guides, the one with the greatest `start` ≤ today. Guides that start
  in the future are ignored, because they're published early.
- **Newest weekly** = within all published guides, the week with the greatest `start` ≤ today.
- **`reflection_weekly_stale`**: there's no newest weekly, or `today − anchor > 8 days`, where
  `anchor = max(week.start, week.end − 6)`.
  - The `end − 6` term handles the long last week. A 12-day last week is "fresh" until 8 days after its
    final 7-day stretch begins, so it doesn't go stale halfway through the week.
  - For a normal week, `anchor = start`, so it goes stale on day 9: one day after the next week should
    have started.
- **`reflection_monthly_stale`**: there's no newest guide, or `today − guide.start > max(35, guideDays)`,
  where `guideDays = guide.end − guide.start + 1`.
  - That's 35 days for 4- and 5-week guides (the 5-week, 35-day case is the reason it isn't 31).
  - A longer guide (up to 8 weeks or 56+ days) isn't stale while it still covers today.
- **Severity:** both are soft for Stephen (they don't change `alert`, matching `reflection_no_current_week`),
  and Chief acts on them in §8.4.
- The JSON adds `reflection: {currentWeek, weekly: {start, ageDays, stale}, monthly: {start, end,
  ageDays, stale}, publishedAt}`. `docs/runbook-health.md` gets the two new codes.
- Unit tests:
  - week day 8 vs 9
  - a 12-day last week
  - 5-week (35-day) and 8-week guides
  - a gap
  - a future-start guide
  - two overlapping guides
  - the DST boundary
  - the empty DB
- **This can ship on its own before Phase 1**, in about 1–2 h. With only the current `id = 1` row, "all
  published guides" is just that one guide, and the definitions still hold. **Shipped 2026-10-24 as
  phase F** (`reflectionFreshness` in `shared/reflection.js`; `frame.build` was added to the health JSON
  at the same time).
- "Day 9" counts the week's start as day 0: with `anchor = start`, `today − anchor = 8` is still fresh and
  `9` is stale.

## 9. Alerts (new): banner and optional chime

### 9.1 What triggers an alert

- **Events:** a timed event on a calendar marked for alerts fires `leadMin` minutes before it starts
  (default 10).
  - The calendar sheet gets a per-calendar "Alerts" toggle (`calendars.alert INTEGER DEFAULT 1`, runtime
    schema).
  - All-day events never alert. The v1 filters still apply: no cancelled, free or self-declined events.
- **Tasks:** `due` has no time (§4.1), so there are no per-task alerts. Instead there's one daily "Due
  today" alert at `tasksAt` (default 09:00), listing what's due today plus the overdue count. If
  `tasksAt` falls in quiet hours, it fires at the first minute after them.
- Photos, weather and reflection never alert.

### 9.2 Computed on the frame, with no Worker writes

- `/api/state` (polled at the v1 cadence) already has everything alerts need:
  - the next 24 h of timed events, from the full-window cache (§3.3)
  - `tasks.dueToday`
- `frame/src/alerts.js` is pure and unit-tested. A 15 s timer uses it to work out due alerts from the last
  good state. This keeps working offline, marked "may be out of date" when the state is stale.
- **Dedupe:** a key such as `event:<id>:<start>` or `tasks:<date>` is kept in `localStorage` with the time
  it fired, and keys older than 2 days are pruned. This covers two cases:
  - a page reload doesn't chime again
  - a moved event (new start time) alerts again
- **Cost: no D1 or KV writes and no extra Worker requests.** Titles are never logged.

### 9.3 How it looks and sounds

- **Banner:** it overlays the top of whatever is showing (Home, any screen, the Photos screen), 88 px tall
  and to the right of the rail.
  - It shows the calendar color, then "In 10 min · 9:00 AM · Title", then **Open** (Calendar or Tasks)
    and **Dismiss**, both 72 × 72.
  - At most two banners stack, and the rest show as "+n".
  - An event banner stays until it's dismissed or 5 min after the event starts. The tasks banner stays
    30 min.
  - A banner is not a touch: it doesn't restart the idle timer or change screens.
- **Chime** (setting `chime`, default on): a bundled synthetic tone, under 1 s and about 10 KB, made with
  a script in the repo so there's no third-party audio license. It plays once per alert through an
  `<audio>` element at `volume` × the Android media volume.
- **WebView 106 audio rules:**
  - Chromium blocks autoplaying sound without a user gesture by default. Android WebView lets the app
    turn that off with `setMediaPlaybackRequiresUserGesture(false)`.
  - **The Home HQ kiosk already does this** (`MainActivity.java`, its WebView settings block), so
    `audio.play()` works with no tap.
  - Fallback: if `play()` rejects (an old kiosk build), the frame sets `audioBlocked` and unlocks audio on
    the next tap by playing a silent clip. The banner shows either way.
  - No Web Audio and no speech.
- **The speaker isn't confirmed** (§1.1). A test tone during P1b's on-frame check settles it (§14). If
  nothing is audible, the chime setting is hidden and alerts are banner-only.

### 9.4 Night and quiet hours

- **Quiet hours default to the night window** (22:00–6:00, following the schedule setting). During
  quiet hours:
  - no chime
  - no banner on the night clock
  - the screen isn't woken, and the backlight stays at its night level (§10)
  - alerts for events that start during quiet hours are skipped, not queued
- If someone wakes the frame during quiet hours, any alert still in its window shows as a banner, but
  without a chime.
- A custom quiet window (15-min steps) can replace "follow night" → **Q12** (defaults).

### 9.5 Settings and tests

- Setting `alerts` (also listed in §7.2):

  | Field | Allowed | Default |
  | --- | --- | --- |
  | `leadMin` | 0 (off), 5, 10, 15, 30, 60 | 10 |
  | `chime` | on, off | on |
  | `volume` | 20–100 | 60 |
  | `quiet` | `"night"` or `{start, end}` in 15-min steps | `"night"` |
  | `tasksAt` | 06:00–12:00 in 15-min steps | 09:00 |
  | `tasks` | on, off | on |

- **Unit tests:**
  - lead-time edges
  - DST dates 2026-11-01 and 2027-03-14
  - dedupe, and a moved event alerting again
  - quiet hours and night
  - all-day events skipped
  - the date-only task alert at `tasksAt`
- **e2e with a fake clock:**
  - a banner on Home, Calendar and Photos
  - nothing at night
  - the chime called (stubbed `<audio>`)
  - the path where `play()` rejects

## 10. Brightness (new): manual, auto from the light sensor, night override

### 10.1 What's wanted

- **Settings › Brightness** has two modes:
  - a **manual** level
  - **auto** from the frame's light sensor (§1.1)
- The **night schedule acts as a floor and override**: at night the backlight drops to the night level.
- Today the page can't touch the backlight. v1's `frame/src/backlight.js` is a no-op
  `setBacklight(level)` hook, waiting for "a future frame-side change", and the night screen only dims
  pixels.

### 10.2 How the page could read the sensor and set the backlight

| Option | Verdict |
| --- | --- |
| `AmbientLightSensor` (Generic Sensor API) in the page | **Not available.** Android WebView doesn't support it in any version. In Chrome it's off by default behind an experimental flag, and WebView 106 has no way to turn that on |
| **A. A kiosk JS bridge.** The Home HQ kiosk (built from source in device plan step 6) gets one `@JavascriptInterface` object. `FrameHW.lux()` returns the last `SensorManager` `TYPE_LIGHT` reading, and `FrameHW.setBrightness(level)` sets the activity window's `WindowManager.LayoutParams.screenBrightness` | **Recommended.** It needs no Android permission, no root, no new app and no network listener. Window brightness applies only while the kiosk is in front and goes back to the system value when it leaves, so a bug can't leave the panel dark everywhere. About 60 lines of Java |
| B. `settings put system screen_brightness N` through root or adb | Rejected. Something with a root shell would have to run all the time: an adb host on MIGUEL, or a root daemon on the frame. Network adb is exactly what the device plan shuts. It also changes the system-wide value |
| C. A companion APK: a service that reads the sensor and serves `http://127.0.0.1:<port>` | Rejected. It's a second app to keep alive, any app on the device could call its local listener, and an HTTPS page calling local HTTP is fragile. It's what v1's `backlight.js` comment imagined, but A is simpler |
| D. Replace the kiosk with a third-party kiosk browser that has a brightness API | Rejected. It's closed source, it changes device plan steps 4–6, and its licensing wasn't checked (no-spend rule) |

### 10.3 Recommended design (option A)

- **Kiosk side** (`MainActivity.java`, kept in this repo as `kiosk/framehw.patch` against the reference at
  `0bff55e` plus `docs/runbook-kiosk.md`):
  - It registers a `TYPE_LIGHT` listener in `onResume` and unregisters it in `onPause`.
  - `setBrightness(x)` clamps `x` to 0.02–1.0 (−1 means the system default) and applies it on the UI
    thread.
  - **Origin check.** The kiosk doesn't block navigation to other sites, and its captive-portal mode
    loads Wi-Fi sign-in pages in the same WebView. So both methods do nothing unless the page currently
    loaded (`mainUrl`, already tracked in `onPageStarted`) is on the configured frame host, and the kiosk
    isn't in portal mode.
  - The bridge exposes no files, settings, tokens or URLs. The frame still holds no secret beyond its
    device token.
- **Frame side:**
  - `backlight.js` feature-detects `window.FrameHW`. Without it (the e2e browser, or an old kiosk build)
    it stays the no-op, so nothing else changes.
  - The pure `brightness.js` picks the target level:
    ```
    target(now) =
      night clock showing (NIGHT and not awake) → s.nightPct            # override
      s.mode == manual                         → s.manualPct
      s.mode == auto                           → clamp(curve(luxAvg), s.autoMin, s.autoMax)   # autoMin is the day floor
    curve(lux) = autoMin + (autoMax - autoMin) * clamp(log10(lux + 1) / log10(luxFull + 1), 0, 1)
    ```
  - It reads lux every 2 s and averages it over about 20 s. It only moves when the target changes by
    more than 5 points, then ramps in 5-point steps every 200 ms, so there's no flicker at dusk.
  - Waking the frame at night uses the day level while it's awake. Once it goes idle, the night override
    returns.
  - `night.dimPct` (the night clock's pixel opacity) stays. With the bridge, the night screen is a low
    backlight plus the dim clock.
- **Setting `brightness`:**

  | Field | Allowed | Default |
  | --- | --- | --- |
  | `mode` | auto, manual | auto (falls back to manual if no lux reading comes) |
  | `manualPct` | 10–100 | 80 |
  | `autoMin` | 10–60 | 20 |
  | `autoMax` | 40–100, and at least `autoMin` + 10 | 100 |
  | `nightPct` | 2–30, never 0 | 5 |
  | `luxFull` | 50–2000 | 400 (calibrated on the frame) |

  The sheet shows the live reading ("Room 120 lx → 64%") for tuning. Without the bridge, it says "Needs
  the frame app update" and is read-only.
- The sensor's range on this panel isn't known yet (Chief only saw that it exists). Calibrating
  `luxFull` is part of phase D.

### 10.4 Frame-side change: needs Stephen's OK

- This changes the kiosk APK. That's device plan §5 **step 6**: set `DEFAULT_URL`, build, `adb install -r`.
  It belongs to v1 **P6 "On the frame + soak"**.
- The wiki says the frame is still pre-lockdown and every write needs Stephen's OK. **Nothing in this
  plan installs anything.** Phase D waits for Stephen's go → **Q13**.
- Do it in the same session as P6, so the kiosk is built and installed once. If P6 has already happened,
  it's one more `adb install -r` with Stephen's OK.
- Everything else in v2 works without it. Brightness then stays manual on the device, as in v1.

## 11. Controls screen (Phase 2) and Home Assistant

### 11.1 What can and can't be controlled (verified 2026-10-24)

| Gear | Path | Notes |
| --- | --- | --- |
| **Wemo plugs** (4 answer locally) | HA `wemo`, Local Push via pywemo | Belkin shut the Wemo cloud, app and **Alexa/Google integrations on 2026-01-31**; pywemo is local and unaffected. So Alexa control of Wemo should already have stopped → **Q17**. HA needs the plugs on its subnet (port 8989 inbound for push) |
| **Smart bulbs** (brand unconfirmed, maybe Philips) | **Hue**: HA `hue` via a Hue Bridge, Local Push. **Without a bridge**: depends on brand | Cloud-only bulbs (the scan shows a GE light and Tuya devices, both cloud) need a cloud integration or can't be controlled; that's a **risk**, decided per brand once identified (**Q16**, [S] task) |
| **Alexa** | Stays as it is, beside HA. **Not the control path** | No official Alexa control API for this use. The HACS `alexa_media_player` uses the unofficial Alexa API and breaks with Amazon changes. We don't depend on it |
| **Harmony Hub** `.109` | HA `harmony`, Local Push | Logitech stopped making Harmony in 2021; the hub keeps working locally. HA docs: some firmware needs "Enable XMPP" in the Harmony app. Activities (`remote.turn_on activity=…`) are the useful control |
| **Samsung TV** `.67` | HA `samsungtv`, Local Push | Turning on from off may need Wake-on-LAN, depends on model (**Q19**) |
| **Roku Streambar** `.61` | HA `roku`, Local Polling (ECP) | Power, volume, input, app launch |
| **Fire TV** `.76` | HA `androidtv` (ADB), Local Polling | The Android TV Remote integration does **not** work on Fire TV (HA docs). ADB is already enabled for the dumbtv work |
| **Google Cast** (`.104 .115 .132`, Fire TV) | HA `cast`, Local Polling | Play/pause/volume of what's casting. HA Container needs host networking for discovery |
| **Spotify** | HA `spotify` (cloud) | **Premium required** (Spotify requires Premium for the Developer Portal since Feb 2026). **Stephen has Premium.** Plays on Spotify Connect/Cast speakers that Spotify knows (`source_list`), never on the frame (§11.5) → **Q18** |
| **Ring** (doorbell, stickup, 4 cameras) | HA `ring`, Cloud Polling (60 s) | No official public Ring API; HA's integration is community-maintained on Ring's cloud, needs Ring login + 2FA, and can break. Live view is WebRTC through HA's frontend; we use **snapshots** (`/api/camera_proxy/<entity>`) refreshed every 10 s while the Controls screen is open. Battery cameras may return stale snapshots. Last-recording needs Ring Protect |

### 11.2 Where Home Assistant runs (decision)

**Home Assistant OS in a VM on the MIGUEL PC** (the home Windows PC that already runs 24/7). Reasons:
it's known to be always on and reachable for Chief's approved commands; HA OS gives add-ons
(cloudflared) and HACS without hand-built containers; the HA docs install path for Windows is a VM.
**ReddenNAS** is the better long-term host *if* its model can run a VM or Docker with host networking
(Cast and Wemo push need it); its model is unknown → **Q14**. Switching later is an HA backup/restore.
Either way HA must sit on the same LAN/VLAN as the Wemo plugs and TVs (the proposed IoT-VLAN split on
the Omada page would need mDNS/SSDP forwarding or static IPs).

### 11.3 How the frame reaches HA (decision)

The Worker can't reach the LAN, and the frame page (HTTPS on workers.dev) can't call `http://` LAN
addresses (mixed content) and mustn't hold an HA token. Options weighed:

| Option | Verdict |
| --- | --- |
| **A. Workers VPC Service over a Cloudflare Tunnel** — `cloudflared` on the HA host makes an outbound tunnel; a VPC Service registers `http://<ha-ip>:8123`; the Worker calls it through a `vpc_services` binding | **Chosen.** No public hostname, no DNS, no inbound port, HA never on the internet. Available on the Free plan and free during its open beta. Low latency (direct call per tap) |
| B. Tunnel with a public hostname (+ Access) | Rejected: needs a zone on Cloudflare (a DNS change/custom domain) and puts HA on a public name |
| C. Quick tunnel (`trycloudflare.com`) | Rejected: random public URL, no uptime guarantee |
| D. HA webhooks called by the Worker | Rejected: needs HA reachable from the internet (B) or Nabu Casa (paid); webhook IDs are bearer secrets |
| E. HA pulls commands from the Worker (automation or small script polling `/api/controls/queue` every 3–5 s) | **Fallback** if Workers VPC changes terms: free and outbound-only, but 1–5 s lag and ~17–29k Worker requests/day of the 100k |
| F. Frame → HA directly on the LAN | Rejected: mixed content, and an HA token or webhook ID on the frame |

Security model for A:
- A dedicated **non-admin HA user `frame`** with a long-lived access token, stored only as a Worker
  secret `HA_TOKEN` (never in the frame, git or logs). Non-admin blocks HA's admin endpoints; HA has
  **no UI for per-entity permissions**, so the token can still call any service on any entity.
- Therefore **the Worker is the real gate**: D1 table `controls (id, kind, entity_id, label,
  room, position, actions_json)` configured on `/admin`, and `POST /api/controls/:id/:action` (device auth)
  maps only allowlisted `(id, action)` pairs to fixed HA service calls (`light.turn_on/off`,
  `switch.turn_on/off`, `media_player.media_play_pause/volume_up/…`, `remote.turn_on activity=…`).
  No free-form service, entity or data from the frame. Locks, garage and alarm entities are refused by
  kind (house rule: garage off-limits).
- State: `GET /api/controls` (device auth) is called every 5 s **only while Controls is visible**; the Worker
  reads the allowlisted entities from HA (`/api/states/<entity>`, ≤ 30 per call, under the 50
  subrequest cap) and returns `{id, state, brightness?, media?}`. Snapshots: `GET /api/controls/cam/:id`
  proxies `/api/camera_proxy/<entity>` (no caching in KV; `Cache-Control: no-store`).
- Request budget: 5 s polling for, say, 30 min/day of Controls use ≈ 360 requests + taps. Negligible.

### 11.4 Controls screen layout

- Rooms as sections; tiles 160 × 120: light/plug tiles toggle on tap (optimistic flip, revert with a
  toast on error after 3 s, the reference's pattern); dimmable Hue lights get a long-press brightness
  sheet.
- **Media** card: per player (Roku, Fire TV, Samsung, Cast, Spotify) play/pause, prev/next, volume ±,
  and Harmony activities as buttons ("Watch TV", "Off").
- **Ring** card: a 2 × 2 grid of snapshots with "updated 8 s ago"; tap enlarges one.
- "HA offline" banner when the Worker can't reach HA; the rest of the frame is unaffected.

### 11.5 Spotify and Bluetooth (Stephen's question)

Stephen has **Spotify Premium** (the old Q15, resolved). He asked about Bluetooth for nearby speakers.

**Chief's take is right:** Controls should target **Spotify Connect and Cast devices**, through Home
Assistant's `spotify` integration and the Spotify Web API. Candidates are the Cast speakers (`.104 .115
.132`), the Samsung TV and the Roku Streambar, if each runs Spotify or Cast. The frame only sends "play
here, pause, next, volume" to the Worker, which passes allowlisted calls to HA (§11.3). The music never
goes through the frame.

- **Device list.** HA's `spotify` media player switches playback with its source list, which contains
  the Connect devices Spotify currently sees. A Cast speaker that's asleep may be missing from it until
  it has been cast to once. P2 checks this on the real devices. HA's `cast` entities can still
  play/pause or change volume on a Cast speaker that's already playing.
- **Frame Bluetooth only matters if the frame itself makes sound.** The frame's own sound is just the
  alert chime (§9). Pairing a BT speaker would only move that chime, so it isn't needed. Using it for
  music would mean playing Spotify on the frame, which is ruled out below.
- **Web Playback SDK on the frame (would turn the frame into a Connect device): no.**
  - The SDK needs Encrypted Media Extensions with Widevine. In Android WebView, the app has to grant
    `RESOURCE_PROTECTED_MEDIA_ID` in `onPermissionRequest`, and the Home HQ kiosk doesn't. Whether this
    A33 / Android 6 build ships a working Widevine is also unknown.
  - The SDK runs in the page with a Spotify user access token. That breaks the rule that the frame holds
    no secret beyond its device token.
  - The frame's small speaker would be a poor music player anyway.
- Left open: **which speakers** should be targets, and whether each one shows up in Spotify → **Q18**.

## 12. v1.1 (calendar selection): shipped

**Shipped** through [PR #2](https://github.com/slredden/smart-frame/pull/2) (`feat/v1.1-calendar-select`),
which was approved and merged 2026-10-24 (`22ce8d5` on main) after Chief's go. main auto-deploys.
v2 builds on it as merged and doesn't reopen it.

- `/admin` → Calendars has these controls:
  - "Load calendars from Google" (`calendarList.list`, with `fields` trimmed)
  - a checkbox list with Google color swatches
  - "Save selection" (≤ 25)
  - The first load selects primary only, and nothing selected means primary (v1 behaviour). Saving
    refreshes the cache at once.
- The cron fetches each selected calendar (one `events.list` each, today → +30 days) and merges them,
  keeping each calendar's color. A failing calendar is skipped, and the old cache is kept if all fail.
- Home agenda: when today has nothing left and tomorrow has no timed event, the empty-agenda row shows
  the next event within 30 days ("Nothing else today. Next: Tue, Nov 3, 9:00 AM · …") instead of going
  blank.
  - The same line also fed v1's screen A `#next`. Phase 1 deletes that (§2.6), and the Home row stays.
- D1 `calendars` table via the runtime schema (no migration to apply).
- **Consent:** v1.1 added **`calendar.calendarlist.readonly`** (`calendarList.list` needs a calendar-list
  scope; `calendar.events.readonly` already covers events on every calendar). [S] still has to do
  **Connect calendar** on `/admin` once. v2 folds this into one reconsent after P1's first deploy,
  together with the Tasks scope (§4.1, §14 step 1). Until then the frame shows the primary calendar.

## 13. Phases

Re-phased 2026-10-24 along the split Chief suggested. Each phase is one or more small PRs, because main
auto-deploys. Everything up to P1b ships before Home Assistant exists, and only phase D touches the
device.

| Phase | Scope | Effort | Acceptance |
| --- | --- | --- | --- |
| **v1.1** | §12 | **Shipped** (PR #2) | Done. [S] reconnect still pending, and P1 folds it into the one v2 reconsent (§14 step 1) |
| **F Reflection freshness** (optional, standalone) | §8.5 `reflection_weekly_stale` / `reflection_monthly_stale` in `buildHealth`, runbook-health codes, and the §8.4 routine handed to Chief | 0.25 day | Unit tests for every case in §8.5. `/api/health` JSON shape in worker tests. No reflection text in health output or logs (canary test) |
| **P1 Nav, Home taps, Calendar, Weather, Settings** | §2.6 A/B removal (first commit). §2 schedule, `nav.js`, the 8-slot rail with `features.*` flags, widget taps, hit sizes. **The batched Google scope change (§4.1) in the first deploy.** §7 Settings screen (schedule, night dim, idle, weather location, calendar selection), `settings` table, guards, `/admin` Settings and reset, geocoding proxy. §3 Calendar views, `/api/calendar`, full-window cache. §5 Weather screen, `/api/weather` | 3–3.5 days | `nav.js` tests: night tap → Home + rail and never a widget; widget tap → screen; off-widget tap → 30 s peek; idle → Home or night per schedule; DST dates 2026-11-01 and 2027-03-14. `schedule.test.js` rewritten (§2.6). Settings worker tests: device auth, unknown key/field, each bound, merge-not-replace, 61st write/hour → 429, `updated_by`, geocoding proxy (mocked, query not logged). Calendar tests as before. `normalizeWeather` tests (24 hourly, 10 daily, missing → null, Home `next3` unchanged), still exactly 1 cache + 1 meta write per weather refresh. OAuth test: the calendar grant asks for the three scopes, and `tasks_scope_missing` shows until reconnect. e2e (Chromium 106): Home, night, each widget tap, rail with 6 and 8 items (no label overflow, nothing in the Menu zone), Settings sheets, Calendar views, Weather, **hit-size check** (§2.4), no console errors. `check` (Chrome 106 compat, JS ≤ 60 KB gz). On-frame check (PLAN.md §10), including the soft keyboard. gitleaks clean |
| **P1b Tasks, Alerts, Reflection, Photos** | §4 Tasks (lists table, `/api/tasks`, check-off if Q10 = `tasks`, Home "Due today" line). §9 Alerts (`alerts.js`, banner, chime, quiet hours, Settings sheet, `calendars.alert`). §8.1–8.2 Reflection screen, `reflection_guides` with migration from `id = 1`, retention 6. §6 Photos screen, favorite/hide | 3–4 days | Tasks worker tests (mocked Google): selection bounds (≤ 10, known ids), ≤ 37 subrequests per cron run, cache write skipped when unchanged, check-off only for cached ids in selected lists, a non-completed patch body refused, 401 without a device token, no titles in logs. `alerts.js` tests (§9.5). Reflection tests: migration, republish, 7th guide prunes, overlap, 401, no text in logs. Hidden photos leave the manifest. e2e: Tasks tabs and check-off with undo, alert banners on three screens and none at night, Reflection, Photos. On-frame check, including a **test chime**. gitleaks clean |
| **H (prerequisite) Home Assistant** | [S] install the HA OS VM, onboard, add integrations (§11.1) one by one, create the `frame` user and token. Agent writes `docs/runbook-controls.md`. [S] or Chief create the tunnel and VPC Service. Worker: `vpc_services` binding, `HA_TOKEN` secret, "HA status" on `/admin` | 0.5 day agent + 2–4 h [S] (+ Ring 2FA, Spotify app) | `/admin` shows "HA reachable, version x" through the binding. No DNS records, and the tunnel can't be reached from the internet. The token appears nowhere but the Worker secret (gitleaks, log canary test) |
| **P2 Controls** | §11.3 allowlist table and `/admin` editor, `/api/controls` state, actions, camera proxy. §11.4 screen. Spotify Connect targets (§11.5). `features.controls` on | 2–3 days | Worker tests with a mocked HA binding: non-allowlisted id/action → 403; lock and garage kinds refused; HA down → 503 + banner; no HA token or entity names in logs. Optimistic toggle and revert tests. Chromium 106 e2e of Controls (mock data). On the frame: toggle a Wemo plug and a light, run a Harmony activity, move Spotify to a Connect speaker and pause it, Ring snapshots refresh. gitleaks green |
| **D Device brightness (with v1 P6; needs Stephen's OK)** | §10: `kiosk/framehw.patch` + `docs/runbook-kiosk.md` (origin check, portal-mode check, clamp). `backlight.js` wired to `FrameHW`, `brightness.js`, the Brightness settings sheet. [S]/[G] build and `adb install -r` at the frame only after Stephen's OK (Q13) | 1 day agent (0.5 kiosk + 0.5 frame) + ~30 min at the frame | `brightness.js` tests: night override, manual, auto curve, clamps, hysteresis, ramp, no bridge → no-op. e2e with a fake `window.FrameHW`: Brightness sheet, live lux line, read-only without the bridge. On the frame: the backlight follows a covered and lit sensor; at night it drops to `nightPct` and returns to the system value when the kiosk exits; on a non-frame page (e.g. the Wi-Fi portal) the bridge does nothing |

**Effort per phase** (agent days; [S] time is separate):

| Phase | Original plan | Previous revision (`306c8bed`) | Now | Change vs `306c8bed` | Why |
| --- | --- | --- | --- | --- | --- |
| F Freshness | – | 0.25 | 0.25 | 0 | |
| P1 | 2.5–3 (all of Phase 1) | 2.5–3 (P1a) | **3–3.5** | **+0.5** | Weather moves in; 8-slot rail |
| P1b | – | 1.75–2.25 | **3–4** | **+1.25 to +1.75** | Tasks (+1–1.25) and Alerts (+0.75–1) added; Weather moved out (−0.5) |
| H | 0.5 | 0.5 | 0.5 | 0 | |
| P2 Controls | 2–3 | 2–3 | 2–3 | 0 | The Spotify finding changes nothing in scope |
| D Brightness | – | – | **1** | **+1** | New, tied to P6 |
| **TOTAL after v1.1** | **5–6.5** | **7–9** | **9.75–12.25 agent days** | **+2.75 to +3.25** (+4.75 to +5.75 vs the original) | Plus [S] time: 2–4 h for HA, ~30 min for phase D at the frame, and minutes for the reconnect and the checks |

Breakdown inside P1 and P1b:

| Part | Phase | Effort |
| --- | --- | --- |
| A/B removal + 8-slot rail + nav + widget taps + scope change | P1 | 0.5–0.75 |
| Settings screen + guards + geocoding | P1 | 1–1.25 |
| Calendar | P1 | 1 |
| Weather | P1 | 0.5 |
| Tasks (screen, lists, cache, check-off, Home line) | P1b | 1–1.25 |
| Alerts (banner, chime, quiet hours, settings) | P1b | 0.75–1 |
| Reflection screen + history | P1b | 0.75–1 |
| Photos | P1b | 0.5–0.75 |

### 13.1 Shipped

| Phase | Date | Notes |
| --- | --- | --- |
| v1.2 | 2026-10-24 | §2.6 deletion list: one Home layout (photo left, info right), `scheduled(minutes, schedule)` → HOME/NIGHT at 6:00–22:00, idle and taps in `nav.js` (a tap at night wakes to Home), no A/B swap. Night dim clock and the "Nothing else today. Next: …" row kept |
| F | 2026-10-24 | §8.5 freshness codes in `/api/health`, runbook-health codes. The §8.4 routine is Chief's |
| P1 | 2026-10-24 | Menu rail (built screens only; unbuilt ones hidden by `features`), Home widget taps, 30 s rail peek, 10 min idle → Home/night. Calendar screen (Agenda default, Day, Week; Google colours; calendar picker on the frame), Weather screen (24 h, 10 days, no extra writes), Settings in D1 (schedule, night dim, idle, weather place by Open-Meteo geocoding, calendars; bounded, no lock-out, device-token writes capped at 60/h). Batched consent asks for `tasks`; missing it is the soft `tasks_scope_missing`. Calendar cache now starts at this week's Monday for the Week view |
| P1b | 2026-10-24 | Tasks screen (Google Tasks, ≤ 10 lists picked on the frame or /admin, groups Overdue/Today/Upcoming/No date, check-off after a 10 s undo, guarded by the Worker: cached task in a shown list, `{status:"completed"}` only, 60 writes/h), Home "Due today" line, soft `tasks_lists_empty`/`tasks_stale`. Alerts computed on the frame: event banner per calendar (default 10 min), 9:00 tasks banner, chime 60 % with tap fallback, quiet = night, test chime in Settings › Alerts. Reflection screen (6 guides kept). Photos screen (toolbar, options in D1, favorites/hides in D1). Rail shows Tasks, Photos, Reflection; Controls hidden. Budgets: runbook-tasks.md |

## 14. Stephen's manual steps

1. **One Google reconsent for all of v2**, done after P1's first deploy. It also covers v1.1's
   still-pending reconnect. Reconnecting now just for v1.1 means doing it twice.
   - Beforehand, with Chief's guidance: enable **Google Tasks API** in the Cloud project. On the consent
     screen's Data Access page, add `https://www.googleapis.com/auth/tasks` (Q10) and
     `calendar.calendarlist.readonly`.
   - Click **Connect calendar** on `/admin` once (the same button as the first connect).
   - Load calendars and tick the ones to show. Load task lists and tick the ones to show.
2. ~~**Answer the open questions** before P1: Q1–Q2, Q10–Q11 and Q12.~~ Answered 2026-10-24 (§15).
3. **Reflection:** tell Chief where Sage's finished guides land and whether Chief may auto-publish them
   (Q7). Answer Q3–Q6.
4. **On the frame after P1:**
   - Check that the soft keyboard opens in Settings › Weather location. If it doesn't, set the location
     on `/admin`.
   - Check that the rail's Settings button and the kiosk's Menu button don't interfere.
5. **On the frame after P1b:** pick task lists (Tasks → **Lists**, or /admin → Task lists), check
   Settings › Alerts, and press **Play test chime**.
   - Set the Android media volume once on the device, or Chief does it over adb with Stephen's OK.
   - Say whether the chime is audible. If it isn't, alerts become banner-only.
6. **Phase D, with v1 P6 (only with Stephen's OK, Q13):** approve the kiosk rebuild with the `FrameHW`
   bridge. [S]/[G] at the frame: `adb install -r`, choose Home → **Always** again if Android asks, then a
   short calibration with the room dark and then bright.
7. **Identify the smart bulbs**: the brand and model of each bulb or lamp (Alexa app → Devices shows the
   brand or skill), and **whether a Philips Hue Bridge exists** (a square or round white box wired to the
   router).
8. Say whether the Wemo plugs still respond to Alexa. They shouldn't since 2026-01-31.
9. Choose the HA host: a VM on the MIGUEL PC by default, or ReddenNAS if its model supports VMs or Docker.
10. Install HA OS, create the owner account, and add these integrations:
    - Wemo
    - Hue (press the bridge button)
    - Harmony (enable XMPP if asked)
    - Samsung TV (accept the prompt on the TV)
    - Roku
    - Android Debug Bridge for the Fire TV (accept the ADB prompt)
    - Cast
    - Spotify (create a Spotify developer app; **Premium is confirmed**)
    - Ring (login + 2FA)
11. Create the non-admin HA user `frame` and its long-lived token. Hand it to Chief to set as the Worker
    secret. It must never be pasted into chat logs or files.
12. Create the Cloudflare Tunnel (the cloudflared add-on on HA OS) and the Workers VPC Service in the
    dashboard. Chief can guide, and it needs Connectivity Directory Admin.
13. Pick which lights, players, **Spotify speakers** and cameras go on the Controls screen (the Controls
    editor on `/admin`). Play something on each speaker once so Spotify lists it (Q18).

## 15. Open questions

**Resolved so far:**
- **Q1, Q2, Q10, Q11, Q12** (Stephen, 2026-10-24 6:53 PM MT: "all dev's picks are good"):
  - Q1: A/B removal shipped early as v1.2 (taps only wake the frame until the rail lands).
  - Q2: Home 6:00–22:00, night 22:00–6:00.
  - Q10: the full `tasks` scope, with check-off behind the Worker guards and undo.
  - Q11: assumed to be the calendar grant's account (his Workspace account); P1b checks this when it
    loads task lists.
  - Q12: the proposed alert defaults.
- Rail on Home: hidden, and a tap shows it for 30 s.
- Rail order: 8 items, decided 2026-10-24 (§2.2).
- Spotify Premium: yes.
- Frame camera and microphone: there are none (§1.1).

The rest, renumbered:

- **Q1** Should A/B removal go out early as a small v1.2 (taps only wake the frame until the rail lands),
  or with P1 (proposed)?
- **Q2** Is the proposed schedule right: Home 6:00–22:00, night 22:00–6:00? It can be changed later in
  Settings.
- **Q3** Calendar: is "no earlier than today" acceptable, or should day and week views show past days
  (which needs on-demand fetches)?
- **Q4** Reflection: should future weeks of the current guide be visible (themes only), or hidden until
  they start?
- **Q5** Is keeping the 6 most recent guides (about 6 months) right? Fewer means less private text stored.
- **Q6** Is a month-level line wanted on Reflection? That would mean changing the extractor and the
  publish payload. Today only the weeks are published.
- **Q7** Where do Sage's finished guides land for Chief? Should Chief publish automatically when a new
  file appears, or wait for a go each time?
- **Q8** Night: is a 15% minimum for the clock's opacity right, and with phase D a 5% night backlight? A
  fully black "off" isn't allowed, because a black screen can look broken.
- **Q9** When the weather location is moved to another time zone, should the clock stay on Denver time
  (proposed)?
- **Q10** Tasks scope: `tasks`, which allows check-off from the frame behind the Worker guards
  (recommended), or `tasks.readonly`, which is view-only? Changing later costs a second reconsent.
- **Q11** Are Stephen's Google Tasks on the same Google account as the calendar grant?
- **Q12** Alert defaults: 10 min before events, chime on, quiet hours = the night window, the daily
  "Due today" alert at 09:00, and every selected calendar alerting until switched off?
- **Q13** May the kiosk app be changed and reinstalled with the `FrameHW` brightness bridge (§10), during
  P6?
- **Q14** What's the ReddenNAS model, and can it run a VM or Docker with host networking? If not, HA goes
  on MIGUEL.
- **Q15** Is MIGUEL the always-on Windows PC used for the Omada and Fire TV work, and can it host a VM with
  ~2 GB of RAM 24/7?
- **Q16** What are the smart bulb brands and models, and is there a Hue Bridge? Cloud-only bulbs may not
  be controllable.
- **Q17** Do the Wemo plugs still work through Alexa today? Belkin ended Alexa support on 2026-01-31.
- **Q18** Which speakers should Spotify target (the Cast speakers, the Samsung TV, the Roku Streambar)?
  Is each one signed in to Spotify or castable?
- **Q19** What's the Samsung TV model? It decides whether turn-on works or needs Wake-on-LAN. Is it the
  same set as the Fire TV Edition?
- **Q20** Which Ring cameras belong on the frame: all four, or only the front door?
- **Q21** Should the Harmony Hub stay in use, given Logitech no longer makes Harmony? It works fine
  locally today.

## 16. Risks

- **Workers VPC is beta**: terms or pricing may change. Fallback E (HA polls the Worker) needs no
  Cloudflare beta feature.
- **Ring**: unofficial cloud integration, 2FA, can break; snapshots only.
- **Cloud-only bulbs**: may not be controllable from HA without a vendor cloud integration.
- **Harmony**: discontinued hardware; works locally until it doesn't.
- **Wemo**: no vendor support; a factory-reset plug needs pywemo setup to rejoin Wi-Fi.
- **CPU on the free plan**: 22-calendar merges and Controls state calls must stay under 10 ms CPU; measure
  in P1/P2 and back off cadence if needed.
- **Privacy**: calendar names, event titles and entity names must never reach logs, git, PRs or
  fixtures (synthetic fixtures only; log canary tests as in v1).
- **Frame-side settings**: a bad value could make the frame unusable. The mitigations are the bounds,
  the allowlist, the rate limit, Settings always being on the rail, and the reset on `/admin` (§7.3).
- **Soft keyboard on Android 6**: it may not appear in the kiosk WebView. Weather location then falls
  back to `/admin`.
- **Reflection history** keeps more private text on Cloudflare than v1 does (6 guides instead of 1). It's
  encrypted at rest under `TOKEN_ENC_KEY`, and Q5 sets the number.
- **Stale reflection** if no one publishes. §8.4 and §8.5 cover it, but the routine depends on Q7.
- **Tasks check-off** writes to Stephen's Google Tasks. It's limited to marking cached tasks done in the
  selected lists, rate-limited, and reversible in Google Tasks (§4.4). Q10 can make it view-only.
- **The `tasks` scope is broad** ("delete all your tasks") on the stored refresh token. It's encrypted at
  rest like the calendar token, and the Worker exposes only the complete call.
- **Alerts on an unconfirmed speaker**: the chime may be inaudible, which leaves banners only. A missed
  alert at night is by design (quiet hours).
- **Kiosk bridge (phase D)**: any page in the kiosk WebView can see `FrameHW`. The origin and portal-mode
  checks and the harmless methods (read lux, set window brightness) limit this. Window brightness reverts
  when the kiosk leaves, so a bad level can't stick system-wide. It needs Stephen's OK and a device
  install.
- **Rail crowding**: 8 items plus the Menu zone leave little slack (§2.2). A ninth screen needs the
  "More" group.

## 17. Sources (checked 2026-10-24)

- Calendar `calendarList.list` scopes: https://developers.google.com/calendar/api/v3/reference/calendarList/list
- Calendar `events.list`: https://developers.google.com/calendar/api/v3/reference/events/list
- Calendar scopes: https://developers.google.com/workspace/calendar/api/auth
- Workers limits (50 subrequests, 10 ms CPU, 6 connections): https://developers.cloudflare.com/workers/platform/limits/
- Workers pricing (100k requests/day, subrequests not billed): https://developers.cloudflare.com/workers/platform/pricing/
- Workers VPC (Free plan, beta): https://developers.cloudflare.com/workers-vpc/ · pricing: https://developers.cloudflare.com/workers-vpc/platform/pricing/ · VPC Services: https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/ · setup: https://developers.cloudflare.com/workers-vpc/get-started/
- HA webhook trigger (local_only, ID is the only secret): https://www.home-assistant.io/docs/automation/trigger/#webhook-trigger
- HA REST API (`camera_proxy`, admin-only endpoints): https://developers.home-assistant.io/docs/api/rest/
- HA users (admin vs non-admin): https://www.home-assistant.io/docs/configuration/user-configuration/
- HA install options: https://www.home-assistant.io/installation/
- Wemo: https://www.home-assistant.io/integrations/wemo/ · Belkin end of support: https://www.belkin.com/support-article/?articleNum=335419 · pywemo unaffected: https://github.com/pywemo/pywemo/issues/773
- Hue: https://www.home-assistant.io/integrations/hue/
- Harmony: https://www.home-assistant.io/integrations/harmony/
- Samsung TV: https://www.home-assistant.io/integrations/samsungtv/
- Roku: https://www.home-assistant.io/integrations/roku/
- Fire TV via ADB: https://www.home-assistant.io/integrations/androidtv/ · Android TV Remote (not Fire TV): https://www.home-assistant.io/integrations/androidtv_remote/
- Cast: https://www.home-assistant.io/integrations/cast/
- Spotify (Premium): https://www.home-assistant.io/integrations/spotify/
- Ring: https://www.home-assistant.io/integrations/ring/
- Alexa Media Player (unofficial API): https://github.com/alandtse/alexa_media_player
- Reference UI: https://github.com/wesbos/photo-frame-dashboard (at `0bff55e`)
- Open-Meteo geocoding API (free, no key): https://open-meteo.com/en/docs/geocoding-api. Checked live
  2026-10-24 with `name=Denver&count=2`.
- Open-Meteo forecast API (`hourly`, `forecast_hours`, `forecast_days` up to 16):
  https://open-meteo.com/en/docs. Checked live 2026-10-24 with the §5 parameters (24 hourly, 10 daily,
  ~2.8 KB).
- Repo files cited in §8.3: `tools/publish-reflection.mjs`, `tools/lib/cli.mjs`, `tools/lib/reflection-parse.mjs`, `shared/reflection.js`,
  `worker/src/reflection.js`, `worker/src/health.js`, `worker/src/index.js`, `tools/check-health.mjs`,
  `docs/runbook-reflection.md`, `docs/runbook-health.md`, PLAN.md §9.4.
- Google Tasks API: `tasks.list` (both scopes, `maxResults` ≤ 100, `showCompleted`, `dueMin`/`dueMax`):
  https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list · Task resource (`due` is
  date-only): https://developers.google.com/workspace/tasks/reference/rest/v1/tasks · scopes:
  https://developers.google.com/workspace/tasks/auth
- AmbientLightSensor support (not in Android WebView; flagged in Chrome): https://caniuse.com/mdn-api_ambientlightsensor ·
  https://developer.mozilla.org/en-US/docs/Web/API/AmbientLightSensor
- Android `WindowManager.LayoutParams.screenBrightness`: https://developer.android.com/reference/android/view/WindowManager.LayoutParams#screenBrightness ·
  `Sensor.TYPE_LIGHT`: https://developer.android.com/reference/android/hardware/Sensor#TYPE_LIGHT ·
  `@JavascriptInterface` / `addJavascriptInterface`: https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,%20java.lang.String)
- WebView `setMediaPlaybackRequiresUserGesture`: https://developer.android.com/reference/android/webkit/WebSettings#setMediaPlaybackRequiresUserGesture(boolean) ·
  Chrome autoplay policy: https://developer.chrome.com/blog/autoplay
- WebView protected media (`RESOURCE_PROTECTED_MEDIA_ID`): https://developer.android.com/reference/android/webkit/PermissionRequest#RESOURCE_PROTECTED_MEDIA_ID
- Spotify Web Playback SDK (EME, Premium): https://developer.spotify.com/documentation/web-playback-sdk ·
  Web API Connect devices: https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices
- Home HQ kiosk `MainActivity.java` (WebView settings, `onPageStarted` `mainUrl`, portal mode) and device
  plan §5 steps 4–6: box copies of the reference repo at `0bff55e` and the photo-frame project.
