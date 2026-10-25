# smart-frame v2 plan: one Home, nav rail, Calendar, Tasks, Weather, Photos, Reflection, Controls, Settings, alerts and brightness

Status: **approved 2026-10-24** (Stephen, 6:53 PM MT, through Chief: Dev's recommended defaults on Q1, Q2, Q10, Q11 and Q12). **v1.2, phase F, P1, P1b and the rail auto-hide shipped 2026-10-24** (§13.1). H (agent side) and P2 are approved (7:20 PM MT) and being built; D still needs Stephen's OK. It builds on
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
- On Home, tapping a widget opens its screen. On every screen, tapping empty space shows the menu rail; it
  hides 10 s after the last touch (rail auto-hide, 2026-10-24).
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
| **Controls** | Spotify (Worker → Spotify Web API) and the four Ring cameras' snapshots (through Home Assistant), Phase 2. Room to add more later |
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
  shown as snapshots fetched through Home Assistant (§11.6).

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
| **Night clock** (any spot) | **Wakes to Home with the rail showing for 10 s.** It never opens a widget, even if it lands where a widget would be |
| Home, **weather** widget (now, high/low, 3-day row) | Opens **Weather** |
| Home, **agenda** widget (all-day line, "Today", rows, "Nothing else today. Next: …") | Opens **Calendar** (agenda view, today) |
| Home, **reflection** widget | Opens **Reflection** |
| Home, anywhere else (photo, clock, date, the gaps between widgets) | Shows the rail for 10 s (`RAIL_PEEK_S`). Tapping again while it shows restarts the 10 s |
| Rail button | Goes to that screen; the rail stays up 10 s more |
| **Any screen**, empty space (no button, row or control under the finger). Off Home this includes the transparent 32 px left-edge zone (`#rail-edge`, full height above the Menu zone), which never covers a control | Shows the rail for 10 s |
| Any screen, a control (task checkbox, undo, Settings rows and buttons, calendar view toggles, banner buttons, anything in a sheet) | Works as usual. If the rail is up its 10 s restart; if it's hidden it stays hidden |
| A tap during the 400 ms after waking | Ignored (debounce), so the waking tap can't also open a widget |

- The rail appears as an overlay on the left 96 px of the photo, so Home's layout never moves. The photo
  stays 794 px wide.
- Other screens (rail full width, 2026-10-24): while the rail is hidden the screen uses all 1280 px
  (left 0, 48 px left padding = 32 px edge zone + 16 px gap). When the rail shows it **pushes** the screen
  to left 96 / width 1184 rather than overlaying it, so the leftmost checkboxes, times and photo controls
  stay visible and tappable during the 10 s the user is working. No transition (a left/width animation
  relayouts every frame on Chrome 106). No strip is left after it hides.
- The kiosk Menu zone (bottom-left 96×72) stays clear while the rail is hidden: a blank corner in the
  view colour (`#rail-corner`) covers it on list screens so scrolled rows can't be tapped there. Photos
  has no controls there and keeps its full-bleed picture.
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
railShown(now)= screen(now) != NIGHT && now < peekUntilMono                # every screen
onTap(target) : if screen == NIGHT → view = 'home', peek 10 s           # wake only
                elif target is rail item (rail up) → view = item, peek 10 s
                elif view == 'home' and target has data-go → view = data-go, peek 10 s if up
                elif target is a control → peek 10 s if up (never shows it)
                else (empty space, any screen) → peek 10 s
                lastTouchMono = now
```

- `idleMs` is the Settings idle timeout (default 10 min, the v1 value). When it runs out, the frame goes
  back to the scheduled screen, which is Home in the day window and the night clock in the night window.
- A frame woken at 23:00 that is left alone falls back to the night clock after the idle timeout.
- **Photos never idles by day (2026-10-25).** In the day window the idle timeout doesn't apply while
  the Photos screen is showing: the frame works as a plain photo frame until someone leaves Photos from
  the rail. Every other screen still returns to Home.
- **Night takes over Photos (2026-10-25, follow-up).** In the night window Photos follows the same rule
  as every other screen: the night clock (and night backlight) replaces it once nobody has touched the
  frame for the idle timeout. Photos left up at 21:59 becomes the night clock at 22:00 if the last touch
  was over `idleMs` ago, otherwise when `idleMs` after the last touch runs out; Photos opened at 23:00
  does the same. Once the night clock shows, Photos is forgotten, so 6:00 shows Home. A build reload on
  Photos by day comes back to Photos; at night (including the 3 AM reload) it doesn't.
- `version.js`'s quiet-moment check uses `awake()` instead of `overrideActive`, so a safe reload still
  waits until nobody is using the frame.
- Layout follows `railShown` through the body's `rail-on` class: hidden = full-width screen plus the
  32 px edge zone; shown = rail plus the screen pushed right 96 px (§2.3). Home never moves.

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
- Pause holds the current photo until "Play" or leaving the screen (Photos never idles, §2).

## 7. Settings screen and server-side settings

### 7.1 What's on the frame, and what isn't

| On the frame (Settings screen) | `/admin` only (Cloudflare Access) |
| --- | --- |
| Calendar selection (also on `/admin`) | Google connect/reconnect, the Photos picker session |
| Day/night schedule | Device pairing, revoking devices |
| Night dim level | Publish and health tokens, all secrets |
| Idle-return timeout | The Controls camera list and Spotify connect (Phase 2) |
| Weather location | "Reset frame settings to defaults" |
| Task-list selection (also on `/admin`) | Enabling the Tasks API and the v2 reconsent |
| Alerts (§9) | |
| Brightness (§10; read-only until phase D) | |
| Controls › Show indoor cameras and reveal time (§11.7, Phase 2; also on `/admin`) | |

Photo display options stay on the Photos screen (§6) and are stored the same way. **Secrets, Google
connect, Spotify connect, pairing and the Controls camera list never appear on the frame.**

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

## 11. Controls screen (Phase 2): Spotify and Ring

Revised 2026-10-24 from Stephen's answers. Facts checked against live docs on 2026-10-24 (§17).

### 11.1 Scope (decision)

The screen keeps the name **Controls** so more can be added later. For now it has two things:
**Spotify** and the **four Ring cameras**.

| Item | Path | Notes |
| --- | --- | --- |
| **Spotify** (Premium) | **Worker → Spotify Web API directly.** No Home Assistant | §11.5. It lists the Connect devices Spotify knows, moves playback, does play/pause/skip/volume and shows what's playing |
| **Ring cameras**: front door, back porch (outdoor); living room, basement (indoor) | Worker → Workers VPC → tunnel → Home Assistant (§11.2–11.3) | Snapshots only, never live video (§11.6). The indoor cameras have privacy rules (§11.7) |
| Lights, smart bulbs | **Dropped** | Q16 closed |
| Wemo plugs | **Dropped.** Stephen keeps them on Alexa | Q17 closed. Left on record: Belkin ended the Wemo cloud and its Alexa/Google integrations on 2026-01-31, so if Alexa stops controlling them, HA's local `wemo` integration is the fallback (a later Controls addition) |
| Harmony Hub | **Dropped** (unused) | Q21 closed |
| Samsung TV (a Samsung Frame TV) | **Dropped** | Q19 closed |
| Roku, Fire TV, Google Cast as HA devices | **Dropped** | They show up only as **Spotify devices**, and only if Spotify lists them (§11.5) |
| Alexa | Unchanged, beside all this. Not a control path | No official Alexa control API for this |

Home Assistant is now only for Ring. It stays because Ring has no official API, the Worker can't reach the
LAN, and HA gives one place with a scoped token and room to add things later. The other way to do it,
a small custom MQTT-to-HTTP bridge, would be more of our own code to maintain.

### 11.2 Where Home Assistant runs (decision)

**HA Container (Docker, host networking) on the Ubuntu box that runs Plex, `reddencloud`** (an old
Mac), with `cloudflared` beside it. The host facts (Q23) and the full runbook are in §11.9.

Ruled out:
- **MIGUEL**: not to be used (Stephen).
- **ReddenNAS**: a Buffalo LinkStation LS220DE, an ARM NAS that can't run HA.
- **The other Ubuntu Mac**: it runs OpenClaw. It stays separate and is never used for this.

Facts from the HA docs:
- HA Container needs **Docker Engine ≥ 23.0.0**. Docker Desktop is not supported.
- The documented run is `--network=host --privileged -v <config>:/config -e TZ=America/Denver
  --restart=unless-stopped ghcr.io/home-assistant/home-assistant:stable`. There's a compose example with
  `stop_grace_period: 60s`.
- Container installs have **no apps (the old add-ons)**. So `cloudflared` and the Ring bridge (§11.6) run
  as their own containers in the same compose file, not as add-ons.
- **Only 64-bit is supported**: amd64 and aarch64. 32-bit (i386, armhf, armv7) was deprecated in
  May 2025 and dropped from 2025.12. The Core and Supervised installs are deprecated.
- The HA docs give **2 GB RAM and 2 vCPU** as the minimum (stated for the HA OS VM). There's no separate
  figure for Container, so we treat **≥ 2 GB RAM free beside Plex** as the floor.

The checks that answered **Q23** (results in §11.9: Ubuntu 24.04.3, 2 cores, 7.5 GiB, 62 GB free, Docker 27.3.1):

| Check | Command | Pass |
| --- | --- | --- |
| Model / year | `cat /sys/class/dmi/id/product_name` (e.g. `MacBookPro11,1`) | Any Intel Mac with a 64-bit CPU. A 2006 Core Duo is 32-bit and fails |
| CPU | `lscpu` (Architecture, Model name, CPU(s)) | `x86_64`, 2+ cores |
| RAM | `free -h` | **≥ 2 GB available** while Plex is idle; 4 GB+ total is comfortable |
| Disk | `df -h /` (and wherever Docker data lives) | ≥ 10 GB free for HA's config, database and images |
| Ubuntu | `lsb_release -a` | A supported LTS (22.04 or 24.04) |
| Docker | `docker version` | Engine ≥ 23.0.0 from Docker's apt repo. Not Docker Desktop and not the snap |
| Plex load | `uptime`, and `top` during a transcode | Load stays well under the core count. If transcodes already peg the CPU, HA still fits (it's light), but say so |
| Always on | Sleep disabled, wired Ethernet, comes back after a power cut | Same needs as Plex |

Ring needs outbound TCP 5228 for its push events (HA ring docs). That's normally open on a home network.

### 11.3 How the Worker reaches HA (decision)

The frame talks **only to the Worker** (§11.8). The Worker reaches HA through **Workers VPC**: a VPC
Service over a Cloudflare Tunnel. `cloudflared` on `reddencloud` makes an outbound tunnel, and the VPC
Service points at HA's port 8123 at `127.0.0.1` (HA and `cloudflared` both use host networking, §11.9). The
Worker calls it through a `vpc_services` binding. It's on the Free plan and free during the open beta
(docs updated 2026-09/10, still beta). Standard Workers limits apply.

**Is it still right with only Ring? Yes.**
- Pull-on-demand costs nothing when nobody is looking.
- The alternative is HA pushing snapshots to the Worker (old option E). That would have to store images.
  At one per camera every 30 s that's ~11.5k writes/day, far over KV's 1k/day, and it would run all day.
  Images in D1 would be a misuse.
- The rejected options stay rejected: a public hostname (needs a DNS zone), a quick tunnel (a public
  random URL), webhooks (HA on the internet, or Nabu Casa, which is paid), and frame → HA on the LAN
  (mixed content, a token on the frame, and it fails at the office).

Security model:
- A dedicated **non-admin HA user `frame`** with a long-lived token. The token is a GitHub secret
  `HA_TOKEN` that `worker-secrets.yml` copies into the Worker. It never goes on the frame or into git
  or logs.
- **The Worker never calls an HA service.** It only does `GET /api/states/<camera>` and
  `GET /api/camera_proxy/<camera>`, and only for the four cameras on a fixed list. The list is a small
  D1 table `controls_cams (id, entity_id, label, indoor, position)` edited on `/admin`. HA can't limit a
  token to certain entities, so this list is the gate. A test asserts there's no POST path to HA.
- If HA can't be reached, the Worker answers 503 and the Ring card says "Cameras offline". Spotify and
  the rest of the frame keep working.

### 11.4 Controls screen layout

- **Spotify card** (left, ~45%):
  - Now playing: art, title, artist and device.
  - Buttons: prev, play/pause, next, volume − / +.
  - A **"Play on…"** list of the Connect devices, with the active one marked. Tapping one moves playback
    there and **remembers that device by name** (Q18; at the office it's mostly the Echo Dot
    "Stephen's Office").
  - Play with no active device goes to the remembered device if Spotify lists it. If it isn't listed:
    "Stephen's Office not available; say "Alexa, Spotify Connect" or play once from the Spotify app",
    plus the list of devices that are there (§11.5).
  - With nothing playing: "Nothing playing", plus the device list.
  - Spotify not connected: "Connect Spotify on /admin" (never a login on the frame).
- **Ring card** (right): a 2 × 2 grid with the outdoor cameras first.
  - Each tile shows "updated 40 s ago". A tile older than 15 min is greyed out with its age.
  - Tap a tile to enlarge it.
  - Indoor tiles follow §11.7.
- Optimistic UI for Spotify buttons, reverting with a toast after 3 s on error (the reference's pattern).
- Everything stops when Controls is hidden, the page is hidden, or night starts.

### 11.5 Spotify: Worker → Spotify Web API directly (decision)

**OAuth.** Authorization Code flow (the server-side flow with a client secret), with a random `state`
saved in the existing `oauth_state` table.
- Scopes: **`user-read-playback-state user-modify-playback-state`**. This is the minimal set:
  - `GET /me/player` and `GET /me/player/devices` need `user-read-playback-state`.
  - Transfer, play, pause, next, previous and volume need `user-modify-playback-state`.
  - `user-read-currently-playing` isn't needed, because `GET /me/player` already returns the current item.
  - P2.1 (2026-10-25) adds two **optional** scopes for the Recent picker: `user-read-recently-played`
    and `playlist-read-private`. Playback needs only the two above; a grant without the new ones gets
    `needs_consent` from `/api/spotify/recent` and the soft health code `spotify_recent_needs_consent`.
- The redirect URI is **`https://smart-frame.sredden.workers.dev/admin/spotify/callback`**.
  - Spotify's rules: exact match; HTTPS required except loopback (`127.0.0.1` / `[::1]`); `localhost`
    not allowed. Enforced for all apps since November 2025.
  - So the workers.dev HTTPS URL is fine. It has its own callback path, so the Google flow in
    `worker/src/google/oauth.js` is untouched.
- Tokens:
  - Access and refresh tokens are AES-GCM encrypted with `TOKEN_ENC_KEY` in the existing `grants`
    table, as grant `spotify`. This is the same pattern as Google's, with a new
    `worker/src/spotify/oauth.js`. No new table.
  - On refresh, the client secret goes in the `Authorization: Basic` header. If Spotify returns a new
    refresh token, it's stored.
  - Access tokens last 1 h. The Worker refreshes at most once an hour, and only while Controls is in use.
- **Refresh tokens expire 6 months after authorization, and refreshing doesn't extend that.**
  - The Worker stores `spotify_connected_at` in `meta`.
  - `/admin` shows "Reconnect Spotify by <date>".
  - `/api/health` adds `spotify_reauth_due` from 14 days before expiry. Chief can email that like a
    Google sign-in problem.
- Secrets and config:
  - `SPOTIFY_CLIENT_ID` goes in `wrangler.jsonc` vars, since it isn't secret.
  - `SPOTIFY_CLIENT_SECRET` is a GitHub secret, added to `worker-secrets.yml` and to the validator in
    `tools/set-worker-secrets.mjs`.
  - Connect, reconnect and disconnect are on `/admin` only. The frame never sees a Spotify token.
- **Premium is required.** The Web API reference says the player endpoints work only for Premium users,
  and in Development Mode the app owner must have Premium. Stephen has it.
  - `GET /me` no longer returns `product` (since the February 2026 changes), so the Worker can't check
    Premium up front. A 403 from a player call shows "Spotify Premium needed".

**Endpoints (device auth, frame → Worker):**
- `GET /api/spotify/state` → `GET /me/player` (now playing + active device) and, on the first poll and
  when the "Play on…" list is opened, `GET /me/player/devices`.
  - It returns `{connected, playing, item:{title, artists, art}, device:{id,name,type,volume}, devices[]}`.
  - Art is Spotify's `i.scdn.co` image URL, a public CDN image with no token.
- `POST /api/spotify/:action`, with action ∈ `play | pause | next | prev | volume | transfer`.
  - `volume` takes 0–100. `transfer` takes a `device_id` that must be in the last device list.
  - Each maps to exactly one Web API call. Nothing free-form passes through. The exception is `play`
    with no active device, which refreshes the device list first (one extra call).
- **Last-used device (Q18).**
  - A successful `transfer` stores the device **name** as `spotify_last_device` in D1 `meta`. That's one
    D1 write per device change, and no KV.
  - The name is kept rather than the id, because Connect device ids aren't promised to be stable.
  - `state` marks the remembered device in `devices[]`.
  - On `play` with no active device, the Worker looks for the name in a fresh `GET /me/player/devices`
    (exact match, ignoring case). If it's there, it transfers with `play: true`.
  - If it's missing, it returns `409 {error:"device_absent", name}`. The frame shows "<name> not available;
    say "Alexa, Spotify Connect" or play once from the Spotify app" and opens "Play on…". It never errors
    out or plays somewhere else.

**Development Mode rules (February 2026, still current):**
- The app owner needs Premium.
- **Up to 5 allowlisted users** per app. Stephen is the only one, and he's the owner.
- Up to 25 client IDs per developer, raised from 1 in July 2026.
- Rate limits are shared per developer account. A 429 has `Retry-After`, or reason `QUOTA_EXCEEDED` for
  the dev quota. The Worker passes back "Spotify busy, try again" and the frame backs off.
- The player endpoints are not among the endpoints removed in February 2026.
- **Extended quota is not for us.** Since 15 May 2025 it's only for organizations with ≥ 250k MAU. We
  don't need it.

**Budget (free plan):**
- The frame polls `/api/spotify/state` every **5 s, only while Controls is visible** (stopped when the
  page is hidden, at idle return and at night). That's 1 Worker request plus 1 Spotify subrequest.
- For ~30 min/day of use: ≈ 360 requests plus taps. That's < 1% of 100k/day and ~6 Spotify calls per
  30 s window.
- D1 writes: one token refresh per hour of use. KV writes: none.

**Which devices appear (caveat to document on `/admin` and in the runbook):**
- `GET /me/player/devices` returns only the Connect devices Spotify's servers know about for the account,
  and "some device models are not supported and will not be listed" (Web API reference).
- Native Connect devices that are logged in (e.g. an Echo with Spotify linked, Spotify on a TV app,
  Spotify Connect speakers) are listed **from anywhere, including the office**, because the list is
  cloud-mediated.
- **Google Cast speakers are found only by the phone app on the local network.** The Web API doesn't list
  them until something has cast to them and they're active. Spotify closed this as "not a bug" (GitHub
  `spotify/web-api` #787 and #834).
  - So a sleeping Cast speaker at home won't be in the list. Stephen starts Spotify on it once from his
    phone, and then it can be controlled from the frame while it stays active.
  - The frame shows "Not listed? Start Spotify on it once from your phone."
- Roku, Fire TV and the Samsung TV appear only if their Spotify app is signed in and Spotify lists them.
  There's nothing HA-side for them.
- **Q18 (answered): at the office, mostly the Echo Dot "Stephen's Office".** Echo Dots are supported
  Spotify (Premium) devices.
  - **Spotify must be linked in the Alexa app**: More › Settings › Music & Podcasts › Link New Service ›
    Spotify. Setting it as **Your Default Services** is better, so "Alexa, play…" uses it too
    (Spotify support, "Spotify on Alexa devices"). It must be the same Spotify account that the frame
    connects.
  - **An idle Echo can drop out of the device list.** Saying **"Alexa, Spotify Connect"** to it, or
    playing once from the Spotify app, makes it appear again (Spotify's newsroom guide and the Spotify
    Community answers). That's what the frame's "not available" message says.
  - The Community threads are about the phone app's picker. That the Web API list behaves the same way
    is a reasonable assumption, and P2's on-frame check confirms it.
  - The name is whatever Alexa calls the device, so renaming it in the Alexa app means picking it once
    again on the frame.

**Bluetooth and the Web Playback SDK on the frame: still no.**
- The frame only makes the alert chime.
- The SDK needs Widevine EME, which the kiosk doesn't grant and which this A33 build may lack.
- The SDK would also put a Spotify token on the frame.

### 11.6 Ring snapshots

**Finding that changes Stephen's plan (from HA's source, `homeassistant/components/ring/camera.py`
and `strings.json`):**
- The **HA Ring integration's camera image is a frame cut from the camera's last recorded event**. It
  isn't a live still.
- Without a subscription it fails with **"Ring Protect subscription required for snapshots"**.
- The video URL is refreshed at most every 3 min.
- Live view in HA is WebRTC only. The Worker can't sensibly relay that, and it drains battery cameras.

So snapshots through the HA Ring integration need **Ring Protect** and show **the last motion or ring**.
An indoor room with no motion keeps showing an old frame.

Two ways. **Q22 picked R-B (ring-mqtt)**:

| | R-A. HA `ring` integration | **R-B. `ring-mqtt` (recommended)** |
| --- | --- | --- |
| What it is | HA core integration, cloud polling 60 s, Ring login + 2FA | Community bridge (tsightler/ring-mqtt, Docker), same Ring app API, login + 2FA via its web UI on port 55123. Publishes to an MQTT broker (a Mosquitto container); HA's MQTT integration makes camera entities |
| Image | Last event recording frame | **Interval snapshots** of the current view |
| Ring Protect | **Required** | **Not required** for interval snapshots (motion snapshots on battery cameras need Protect) |
| Freshness | Only changes on a new event (cached up to 3 min) | Line-powered: default every **30 s**, settable per camera. Battery and low-power: the Ring app's **Snapshot Capture** interval, else 600 s |
| Battery cameras | No extra drain | Short intervals mean much more battery use (ring-mqtt FAQ). Can't snapshot while recording or streaming |
| Unofficial / can break | Yes | Yes |

**Decision (Q22, 2026-10-24): R-B (ring-mqtt).**
- Stephen **has Ring Protect**, so HA's built-in Ring integration (R-A) would also work. It would show
  last-event images.
- ring-mqtt stays the choice because it shows what the camera sees now (live interval snapshots).
- The Worker side is identical either way (`camera_proxy` on four camera entities), so R-A is still a
  fallback if ring-mqtt breaks.

**Cadence and staleness:**
- **Wired (living room, basement, back porch): 30 s**, ring-mqtt's default. If `reddencloud`'s CPU is
  tight (§11.9 step 11), set 60–120 s per camera.
- **Front door (battery, the only one):**
  - ring-mqtt follows the Ring app's **Snapshot Capture** interval for it, and uses 600 s if none is set.
    So set the interval in the Ring app (front door › Device settings › Snapshot Capture), not in
    ring-mqtt.
  - Suggested: **every 10–15 min**. That keeps the tile under the 15-minute greying with modest battery
    drain.
  - Go longer if the battery drops noticeably faster.
  - Short intervals cost much more battery (ring-mqtt FAQ).
  - The camera can't snapshot while it's recording. With Protect, motion events also produce snapshots.
- `GET /api/controls/state` returns each camera's `updated` time from `/api/states/<camera>`
  (4 subrequests).
- The frame polls it every 5 s with Spotify state while Controls is visible. It fetches
  `GET /api/controls/cam/:id` **only when that camera's `updated` changed**.
- Tiles older than 15 min are greyed out with their age.

**Bytes path (HA → tunnel → Worker → frame), with no storage:**
- `GET /api/controls/cam/:id` fetches `/api/camera_proxy/<entity>` through the VPC binding and returns
  `new Response(upstream.body)`. It streams, with no buffering, no KV, no D1 and
  `Cache-Control: no-store, private`.
- That's 1 subrequest per image and almost no CPU.
- **No cross-request in-memory cache.** Isolates aren't guaranteed to be shared or kept, and the frame
  already keeps the last image it showed.
- The Cache API isn't used: the Workers docs give working `cache` operations only on custom domains, and we have none.

**Budget:**
- 4 cameras × at most 1 image per 30 s ≈ ≤ 240 image requests per 30 min of use, plus the 5 s state
  polls already counted with Spotify.
- That's well under 1% of 100k/day. Each state call is ≤ 6 subrequests of the 50.

### 11.7 Indoor camera privacy (living room, basement)

Q25 (2026-10-24): Stephen confirmed these defaults: off by default, 45 s reveal.

The frame may sit in an office, so the indoor cameras have extra rules:
- **Settings › Controls › "Show indoor cameras"**: **off by default**.
  - Off: the indoor tiles read "Indoor cameras off" and the Worker **refuses** their images (403). The
    setting is in D1, so this is enforced on the server, not just hidden.
- On: indoor tiles start **covered** ("Tap to show").
  - A tap reveals the camera for **45 s** (a setting, 30–60 s), then it covers itself again.
  - Leaving Controls, idle return or night also cover it right away.
  - The frame sends `?reveal=1` only after a tap.
  - The Worker returns indoor images only when the setting is on, and logs nothing but the camera id
    and status.
- **Never at night** (no Controls polling at night), **never on Home**, **never in alerts or banners**.
  Outdoor cameras aren't on Home or in alerts either. Cameras appear only on the Controls screen.
- Changing the setting is a normal settings write (`/api/settings`, device auth). `/admin` has the same
  switch.

### 11.8 If the frame moves to Stephen's office

Q24 (2026-10-24): Stephen is the office's IT person.
- The frame on the office network is fine, and there's no 802.1X concern.
- The city and the move date are still unknown. Not blocking: the Settings weather location covers the
  city.
- The AiMOR-lockdown confirmation and the NTP check below still apply.

The design works off the home LAN: **the frame talks only to the Worker**, and only the Worker reaches
home (Spotify's cloud; HA via the tunnel).

Checked against the code:
- **No LAN assumptions in the frame or the Worker.** `frame/src` calls only the Worker (relative URLs),
  plus the kiosk's on-device asset server at `127.0.0.1:8765`.
- **Health and heartbeats keep working.**
  - The heartbeat is frame → Worker. `/api/health` is read by Chief from the Worker.
  - "Frame offline > 1 h" then means "office Wi-Fi or power" (`docs/runbook-health.md`).
- **Time zone stays America/Denver.** That's `TIME_ZONE` in `worker/wrangler.jsonc`, the
  `America/Denver` defaults in `worker/src/{state,health,weather}.js` and `google/calendar.js`, and
  `TZ` in `frame/src/main.js`. The 03:00 daily reload in `frame/src/version.js` is "Denver" time too.
  Nothing changes unless the office is in another zone (Q9 already covers that).
- **The weather location is a Denver default.** `WEATHER_LAT/LON` are `39.74/-104.99` in
  `wrangler.jsonc`. After the move, set **Settings › Weather location** (§7.4) to the office. It's a
  frame or `/admin` setting, with no deploy.

Frame-side steps for the move (need Chief/Stephen; device-side changes need Stephen's OK):
- **Wi-Fi:** kiosk controls (hold two fingers still for 1.5 s) → **Wi-Fi settings** → join the office
  network. This is the kiosk's own menu, so no adb is needed.
  - If the office Wi-Fi has a **sign-in page**, the kiosk's captive-portal mode shows it so the terms can
    be accepted, then returns to the frame (`MainActivity.java`). It may come back every day or week.
    The brightness bridge stays inactive on that page (§10).
  - **Use a WPA2/WPA3 password network** (guest or IoT; Stephen runs the office network, Q24). An
    802.1X (enterprise) login would put work credentials on the frame, which breaks the "only a device
    token" rule.
- **Before it joins any network outside home, confirm the AiMOR lockdown** (device plan §5 step 3:
  `com.efercro.os.aimor` disabled, `netstat -an | grep :7806` empty). At home the Omada router could block
  TCP 7806. At the office there's no such backstop.
- **NTP:** the boot fixes set `NTP_SERVER=time.google.com`. If the office blocks UDP 123, the clock drifts
  and HTTPS fails after long uptimes. Check that the clock is right a day after the move.
- At home, the MAC reservation and router allow-list (device plan §5 steps 7–8) were in Omada. At the
  office they're the office network's business.
- **USB adb for device steps (phase D, P6 soak checks) needs a computer next to the frame.** Do those
  before the move, or bring a laptop.
- Spotify works the same from the office (cloud), with the Cast caveat in §11.5. Speakers at home can be
  controlled from the office, so the device list shows names.

### 11.9 H runbook: the HA stack on `reddencloud`

The host is the Plex box **`reddencloud`**. It now has a static address ending **`.24`**, outside the
DHCP range. There's no Omada DNS entry yet, so reach it as **`reddencloud.local`** (avahi/mDNS) or by the
`.24` address.

Host facts: Q23, plus Chief's update after the 2026-10-24 evening cleanup:

| Fact | Value | Against the floor (§11.2) |
| --- | --- | --- |
| OS | Ubuntu 24.04.3 LTS | Supported LTS |
| CPU | 2 cores | At the HA docs' 2 vCPU minimum, and **shared with Plex** |
| RAM | 7.5 GiB total, **6.9 GiB available, 0 swap used** (after the cleanup; was 3.4 GiB and 1.8 GiB swap) | ≥ 2 GB available: passes easily |
| Disk | 62 GB free on `/` | ≥ 10 GB: passes |
| Docker | 27.3.1; `sredden` is in the `docker` group | Engine ≥ 23.0.0: passes. **No Docker install step, and no `sudo` for `docker`** |
| Mode | Boots to `multi-user.target`: headless, SSH only | Good for a server |
| Cleanup | Removed: Nextcloud, multipass, lxd, Chrome Remote Desktop, samba. Disabled: cups, bluetooth, ModemManager, gnome-remote-desktop | Frees RAM and CPU for Plex + HA |
| Still running | NAS CIFS mount, Plex, Docker, NetworkManager | Expected |
| Failed units | Only `systemd-networkd-wait-online` | **Harmless. Don't chase it:** NetworkManager manages the network, not systemd-networkd |

**Resource plan.** Every container gets a memory cap with `memswap_limit` equal to `mem_limit`.
Per the Compose reference, that gives the container no swap. It also gets a hard `cpus` cap and a low
`cpu_shares` (256; the default is 1024), so Plex wins whenever both want the CPU. The caps are estimates,
and step 11 below checks them against `docker stats`.

| Container | Image (pinned) | `mem_limit` | `cpus` | Why that cap |
| --- | --- | --- | --- | --- |
| homeassistant | `homeassistant/home-assistant:2026.10.4` | **1g** | 1.0 | Enough for HA core + MQTT + four camera entities with the minimal recorder below. No Ring integration, no add-ons, no Bluetooth or USB. If HA is OOM-killed, it restarts (`unless-stopped`) and step 11 raises the cap to 1.25g |
| mosquitto | `eclipse-mosquitto:2.1.2-alpine` | 64m | 0.25 | Two clients and a few dozen topics. Mosquitto itself uses a few MB |
| ring-mqtt | `tsightler/ring-mqtt:5.9.3` | 384m | 0.5 | Node.js plus snapshot JPEGs. No live streams are used (RTSP port 8554 isn't published) |
| cloudflared | `cloudflare/cloudflared:2026.10.3` | 128m | 0.25 | One tunnel, a few requests a minute while Controls is open |

The caps total about 1.6 GiB against 6.9 GiB available, which leaves over 5 GiB for Plex and the page
cache. **HA's 1 GB cap stays.** It's about 2× what a lean HA Container uses. With this much headroom, it's
a guard against a leak, not a squeeze. If step 11 ever shows HA near the cap, raise it to 1.5g; that's
safe now.

The tags were checked on Docker Hub on 2026-10-24. Pull digests, for checking what's installed:
- HA `sha256:23f4dfbb…e133`
- Mosquitto `sha256:860aeb5d…bb0f`
- ring-mqtt `sha256:4a4e0db4…f00a`
- cloudflared `sha256:faa8e0a1…ff39`

Tags rather than digests sit in the file, so updates stay a one-word edit.

Compared with the HA docs' compose example, two things are deliberately left out:
- `privileged: true`
- the `/run/dbus` mount

The docs include them for USB radios and Bluetooth, and nothing here uses either.

**cloudflared: container, not a systemd service.**
- The systemd install (`cloudflared service install <token>`) puts the token in the unit's `ExecStart`,
  where `systemctl status` shows it (Cloudflare run-parameters docs). It also updates itself outside our
  version pin.
- The container is pinned, capped, and started and stopped with the rest of the stack. It reads
  `TUNNEL_TOKEN` from an env file only `sredden` can read (mode 600).
- The env file's value is visible to anyone with Docker access via `docker inspect`. On this box, that's
  only Stephen.
- It uses `network_mode: host`, so the VPC Service can point at `127.0.0.1:8123`.

**Plex contention and swap:**
- Plex keeps its default CPU weight, and the HA stack gets a low weight and hard caps. Everything here is
  idle except a light poll, and the cameras are fetched only while the Controls screen is open.
- **Prefer direct play in Plex.** Set clients to Original/Maximum quality. Two old cores can't transcode
  1080p and do much else.
- **ring-mqtt interval:** line-powered cameras snapshot every 30 s by default (Configuration-Details).
  If step 11 shows load, set the interval per camera to 60–120 s. The frame shows each image's age
  anyway.
- **Swap:** 0 used after the cleanup (was 1.8 GiB), so this is now a low risk.
  - Step 11 still watches `vmstat` `si`/`so`; near zero is fine.
  - The caps keep this stack out of swap.
  - If `docker info` warns "No swap limit support", the swap caps don't apply, so tell Chief.

**Files.** Everything lives under `/opt/smart-frame-ha` and is written by the commands below:
- `compose.yaml` (step 2; the repo copy `docs/controls-compose.yaml` is identical)
- `mosquitto/config/mosquitto.conf` (step 3)
- `mosquitto/config/passwd` (step 4)
- `ring-mqtt/config.json` (step 5)
- `cloudflared.env` (steps 5 and 12)
- HA's `configuration.yaml` (step 8)

Secrets are only:
- the two MQTT passwords, which are random and never shown except HA's, once, in step 10
- the tunnel token
- Ring's token, which ring-mqtt writes itself

Every secret file is readable only by root, or for `cloudflared.env` only by `sredden` (mode 600, or 700 for `passwd`), and none is ever committed.

`ring-mqtt/config.json` has this shape (ring-mqtt's minimal config). Step 5 fills in the password:

```json
{
  "mqtt_url": "mqtt://ringmqtt:<RINGMQTT_PASSWORD>@mosquitto:1883"
}
```

**The MQTT credentials go inside `mqtt_url`.** ring-mqtt 5.9.3 ignores separate `mqtt_user` /
`mqtt_pass` keys, so a config that uses them connects without auth and Mosquitto refuses it (fixed on
`reddencloud` 2026-10-24). The password is `openssl rand -hex` output, so it needs no URL escaping.
The file is written under `umask 077` (root-only).

**Stephen's commands, in order** (on `reddencloud`, in a terminal):

> **Run `sudo -v` first, before pasting any multi-line block.** It caches the sudo password for a few
> minutes. Otherwise a sudo password prompt that appears mid-paste swallows the lines pasted after it,
> and they never run (this happened on 2026-10-24). If a block was pasted over a prompt, re-run it.

```bash
sudo -v                                # cache sudo first, so no prompt eats pasted lines

# 1. Folders
sudo mkdir -p /opt/smart-frame-ha/{homeassistant,mosquitto/config,mosquitto/data,ring-mqtt}
cd /opt/smart-frame-ha
docker compose version                 # Compose v2 should print a version

# 2. compose.yaml (no secrets)
sudo tee /opt/smart-frame-ha/compose.yaml >/dev/null <<'EOF'
name: smart-frame-ha

x-logging: &logging
  driver: json-file
  options: { max-size: "10m", max-file: "3" }

services:
  homeassistant:
    container_name: homeassistant
    image: homeassistant/home-assistant:2026.10.4
    network_mode: host                 # HA listens on :8123
    environment:
      TZ: America/Denver
    volumes:
      - /opt/smart-frame-ha/homeassistant:/config
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
    stop_grace_period: 60s             # lets HA close its database (HA docs)
    mem_limit: 1g
    memswap_limit: 1g                  # equal to mem_limit = no swap
    cpus: 1.0
    cpu_shares: 256
    depends_on: [mosquitto]
    logging: *logging

  mosquitto:
    container_name: mosquitto
    image: eclipse-mosquitto:2.1.2-alpine
    ports:
      - "127.0.0.1:1883:1883"          # for HA on the host network only, not the LAN
    volumes:
      - /opt/smart-frame-ha/mosquitto/config:/mosquitto/config
      - /opt/smart-frame-ha/mosquitto/data:/mosquitto/data
    restart: unless-stopped
    mem_limit: 64m
    memswap_limit: 64m
    cpus: 0.25
    cpu_shares: 256
    logging: *logging

  ring-mqtt:
    container_name: ring-mqtt
    image: tsightler/ring-mqtt:5.9.3
    ports:
      - "55123:55123"                  # Ring login page; only runs while there's no token
    volumes:
      - /opt/smart-frame-ha/ring-mqtt:/data
    restart: unless-stopped
    mem_limit: 384m
    memswap_limit: 384m
    cpus: 0.5
    cpu_shares: 256
    depends_on: [mosquitto]
    logging: *logging

  cloudflared:
    container_name: cloudflared
    image: cloudflare/cloudflared:2026.10.3
    network_mode: host                 # reaches HA at 127.0.0.1:8123
    command: tunnel --no-autoupdate run
    env_file: /opt/smart-frame-ha/cloudflared.env   # TUNNEL_TOKEN=…, mode 600, never committed
    restart: unless-stopped
    mem_limit: 128m
    memswap_limit: 128m
    cpus: 0.25
    cpu_shares: 256
    logging: *logging
EOF

# 3. Mosquitto config: auth on, anonymous off
sudo tee /opt/smart-frame-ha/mosquitto/config/mosquitto.conf >/dev/null <<'EOF'
listener 1883
allow_anonymous false
password_file /mosquitto/config/passwd
persistence true
persistence_location /mosquitto/data/
log_dest stdout
EOF

# 4. Two random MQTT passwords (never printed), hashed in place by mosquitto_passwd -U
HA_MQTT_PW=$(openssl rand -hex 16); RING_MQTT_PW=$(openssl rand -hex 16)
printf 'homeassistant:%s\nringmqtt:%s\n' "$HA_MQTT_PW" "$RING_MQTT_PW" \
  | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/mosquitto/config/passwd'
docker run --rm -v /opt/smart-frame-ha/mosquitto/config:/mosquitto/config \
  eclipse-mosquitto:2.1.2-alpine mosquitto_passwd -U /mosquitto/config/passwd
sudo chown 1883:1883 /opt/smart-frame-ha/mosquitto/config/passwd
sudo chmod 0700 /opt/smart-frame-ha/mosquitto/config/passwd
printf '%s\n' "$HA_MQTT_PW" | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/ha-mqtt-password.txt'

# 5. ring-mqtt config (credentials inside mqtt_url; ring-mqtt 5.9.3 ignores mqtt_user/mqtt_pass),
#    and an empty tunnel env file (filled in at step 12)
printf '{\n  "mqtt_url": "mqtt://ringmqtt:%s@mosquitto:1883"\n}\n' \
  "$RING_MQTT_PW" | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/ring-mqtt/config.json'
unset HA_MQTT_PW RING_MQTT_PW
sudo install -m 600 -o "$USER" -g "$USER" /dev/null /opt/smart-frame-ha/cloudflared.env
printf 'TUNNEL_TOKEN=\n' > /opt/smart-frame-ha/cloudflared.env   # owned by you so docker compose can read it without sudo

# 6. Start everything except cloudflared, then check (no sudo: sredden is in the docker group;
#    if `id -nG` doesn't list docker, log out and back in once)
cd /opt/smart-frame-ha
sudo chown "$USER": cloudflared.env && chmod 600 cloudflared.env   # only needed if step 5 ran as first sent
docker compose pull
docker compose up -d homeassistant mosquitto ring-mqtt
docker compose ps                         # three containers running
docker compose logs --tail=50 mosquitto ring-mqtt
docker compose logs -f homeassistant      # wait until it settles, then Ctrl-C
```

7. **Onboarding:** from a computer on the home network, open **http://reddencloud.local:8123**, or the
   `.24` address on port 8123 if `.local` doesn't resolve. There's no Omada DNS entry yet, so plain
   `reddencloud` may not work. HA listens on all interfaces (host networking), so both work.
   - Create the owner account and keep its password in the password manager.
   - Home location: home. Time zone: America/Denver. Analytics: off.
8. **Recorder** (HA recorder docs):
   - Camera and image entities stay out of the database. Their state attributes carry short-lived
     access tokens, and nothing needs their history.
   - History is kept for 3 days.
   - Commits are batched every 30 s to cut disk writes.

   Add the snippet, then restart HA:

   ```bash
   sudo tee -a /opt/smart-frame-ha/homeassistant/configuration.yaml >/dev/null <<'EOF'

   recorder:
     purge_keep_days: 3
     commit_interval: 30
     exclude:
       domains:
         - camera
         - image
   EOF
   cd /opt/smart-frame-ha && docker compose restart homeassistant
   ```
9. **Ring login (2FA):** open **http://reddencloud.local:55123** (or the `.24` address), enter the Ring email and password, then the
   2FA code. Then run `docker compose logs --tail=50 ring-mqtt`, which should list the four cameras.
   The page stops once the token is saved in `ring-mqtt/ring-state.json`. Treat that file as a secret,
   since it's full Ring account access (ring-mqtt docs). It holds the **Ring refresh token**, so lock it
   down right after the login:

   ```bash
   cd /opt/smart-frame-ha && sudo chmod 600 ring-mqtt/ring-state.json
   ```
10. **MQTT integration:** HA › Settings › Devices & services › Add integration › **MQTT**.
    - Broker `127.0.0.1`, port `1883`, username `homeassistant`.
    - Password: run `sudo cat /opt/smart-frame-ha/ha-mqtt-password.txt`, paste it, then `clear`.
    - The four Ring cameras then appear as MQTT devices, each with a camera entity.
    - If a battery camera has no image yet, that's expected (§11.6).
11. **A day later, during a Plex transcode**, run:

    ```bash
    docker stats --no-stream
    free -h
    vmstat 5 6
    docker inspect -f '{{.Name}} OOM={{.State.OOMKilled}} restarts={{.RestartCount}}' \
      homeassistant mosquitto ring-mqtt
    ```

    Send Chief only the numbers. Pass:
    - HA under ~700 MiB
    - no `OOM=true`
    - `si`/`so` near 0
    - Plex playback smooth

    Otherwise:
    - raise HA's cap to 1.25g
    - set ring-mqtt to 60–120 s
    - prefer direct play

    **DONE: passed 2026-10-24 8:36 PM MT.** HA ~400 MiB, ring-mqtt 176 MiB, mosquitto 3 MiB, under 1% CPU,
    swap 0, no OOM. The caps stay as they are.
12. **Tunnel** (§14 step 13): paste the token without echoing it, then start cloudflared.

    ```bash
    read -rsp 'Tunnel token: ' T; echo
    printf 'TUNNEL_TOKEN=%s\n' "$T" > /opt/smart-frame-ha/cloudflared.env; unset T   # file is yours, mode 600 (step 5)
    cd /opt/smart-frame-ha && docker compose up -d cloudflared
    docker compose logs --tail=30 cloudflared   # look for "Registered tunnel connection"
    ```

    The VPC Service points at `127.0.0.1`, port 8123, http.
    - If the Worker gets HTTP 400 from HA: since HA 2026.8, reverse-proxy settings are set in the UI, at
      **Settings › System › Network › HTTP server**. Turn on "Trust X-Forwarded-For" and add `127.0.0.1`
      to Trusted proxies.

**Changing one MQTT user's password later** (e.g. `ringmqtt` or `homeassistant`). Update the existing
`passwd` file in place with `mosquitto_passwd -b`; don't rewrite the file, or the other user's entry is
lost. Then restore the owner and mode from step 4:

```bash
sudo -v
NEW_PW=$(openssl rand -hex 16)                     # never printed
docker run --rm -v /opt/smart-frame-ha/mosquitto/config:/mosquitto/config \
  eclipse-mosquitto:2.1.2-alpine mosquitto_passwd -b /mosquitto/config/passwd ringmqtt "$NEW_PW"
sudo chown 1883:1883 /opt/smart-frame-ha/mosquitto/config/passwd
sudo chmod 0700 /opt/smart-frame-ha/mosquitto/config/passwd
# For ringmqtt: rewrite mqtt_url with the new password (same umask 077 as step 5)
printf '{\n  "mqtt_url": "mqtt://ringmqtt:%s@mosquitto:1883"\n}\n' \
  "$NEW_PW" | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/ring-mqtt/config.json'
unset NEW_PW
cd /opt/smart-frame-ha && docker compose restart mosquitto ring-mqtt
```

For `homeassistant` instead: use `homeassistant` as the user above, skip the `config.json` lines, write
the new password to `ha-mqtt-password.txt` as in step 4, restart `mosquitto`, and update the password in
HA › Settings › Devices & services › MQTT › Reconfigure.

**Updates:** edit a tag in `compose.yaml` (`sudo` to edit, since it's root-owned), then run `docker compose pull && docker compose up -d`.

**`sudo docker …` from steps sent earlier still works.** It's just not needed now.
Chief proposes HA tag bumps monthly.

**Backup:** `/opt/smart-frame-ha` holds everything, including the Ring and MQTT secrets, so back it up
only to somewhere private.

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

**Status (2026-10-24 7:20 PM MT): Stephen approved the Controls plan. H and P2 are approved to build
after P1 and P1b, in plan order.**

**Gate (updated 2026-10-24 7:47 PM MT):**
- The `reddencloud` cleanup is **done**.
- Chief has sent Stephen **§11.9 steps 1–10** (files, start, onboarding, recorder, Ring login, MQTT).
  Those may run now.
- **Step 11 (load check) is DONE:** passed 2026-10-24 8:36 PM MT (HA ~400 MiB, ring-mqtt 176 MiB,
  mosquitto 3 MiB, under 1% CPU, swap 0, no OOM). §11.9 steps 1–11 are all done.
- **Step 12 (tunnel + `cloudflared`, §14 step 13) stays gated** until Chief sends it.
- **Live (per Chief, 2026-10-24 8:24 PM MT):** the stack is up on `reddencloud`, ring-mqtt is connected
  to Mosquitto (after the `mqtt_url` credentials fix in §11.9), and the Ring devices appear in HA.

Agent work for H and P2 that needs no box (code, tests, docs) can go ahead in plan order.

Re-phased 2026-10-24 along the split Chief suggested. Each phase is one or more small PRs, because main
auto-deploys. Everything up to P1b ships before Home Assistant exists, and only phase D touches the
device.

| Phase | Scope | Effort | Acceptance |
| --- | --- | --- | --- |
| **v1.1** | §12 | **Shipped** (PR #2) | Done. [S] reconnect still pending, and P1 folds it into the one v2 reconsent (§14 step 1) |
| **F Reflection freshness** (optional, standalone) | §8.5 `reflection_weekly_stale` / `reflection_monthly_stale` in `buildHealth`, runbook-health codes, and the §8.4 routine handed to Chief | 0.25 day | Unit tests for every case in §8.5. `/api/health` JSON shape in worker tests. No reflection text in health output or logs (canary test) |
| **P1 Nav, Home taps, Calendar, Weather, Settings** | §2.6 A/B removal (first commit). §2 schedule, `nav.js`, the 8-slot rail with `features.*` flags, widget taps, hit sizes. **The batched Google scope change (§4.1) in the first deploy.** §7 Settings screen (schedule, night dim, idle, weather location, calendar selection), `settings` table, guards, `/admin` Settings and reset, geocoding proxy. §3 Calendar views, `/api/calendar`, full-window cache. §5 Weather screen, `/api/weather` | 3–3.5 days | `nav.js` tests: night tap → Home + rail and never a widget; widget tap → screen; off-widget tap → 30 s peek; idle → Home or night per schedule; DST dates 2026-11-01 and 2027-03-14. `schedule.test.js` rewritten (§2.6). Settings worker tests: device auth, unknown key/field, each bound, merge-not-replace, 61st write/hour → 429, `updated_by`, geocoding proxy (mocked, query not logged). Calendar tests as before. `normalizeWeather` tests (24 hourly, 10 daily, missing → null, Home `next3` unchanged), still exactly 1 cache + 1 meta write per weather refresh. OAuth test: the calendar grant asks for the three scopes, and `tasks_scope_missing` shows until reconnect. e2e (Chromium 106): Home, night, each widget tap, rail with 6 and 8 items (no label overflow, nothing in the Menu zone), Settings sheets, Calendar views, Weather, **hit-size check** (§2.4), no console errors. `check` (Chrome 106 compat, JS ≤ 60 KB gz). On-frame check (PLAN.md §10), including the soft keyboard. gitleaks clean |
| **P1b Tasks, Alerts, Reflection, Photos** | §4 Tasks (lists table, `/api/tasks`, check-off if Q10 = `tasks`, Home "Due today" line). §9 Alerts (`alerts.js`, banner, chime, quiet hours, Settings sheet, `calendars.alert`). §8.1–8.2 Reflection screen, `reflection_guides` with migration from `id = 1`, retention 6. §6 Photos screen, favorite/hide | 3–4 days | Tasks worker tests (mocked Google): selection bounds (≤ 10, known ids), ≤ 37 subrequests per cron run, cache write skipped when unchanged, check-off only for cached ids in selected lists, a non-completed patch body refused, 401 without a device token, no titles in logs. `alerts.js` tests (§9.5). Reflection tests: migration, republish, 7th guide prunes, overlap, 401, no text in logs. Hidden photos leave the manifest. e2e: Tasks tabs and check-off with undo, alert banners on three screens and none at night, Reflection, Photos. On-frame check, including a **test chime**. gitleaks clean |
| **H (prerequisite) Home Assistant for Ring** | **Partly gated (see Status above): §11.9 steps 1–11 done; step 12 (tunnel) waits for Chief.** [S] runs the §11.9 runbook on `reddencloud` (Docker 27.3.1 already there): the compose stack (HA Container, Mosquitto, ring-mqtt, cloudflared, with memory and CPU caps; ring-mqtt per Q22), onboarding, the minimal recorder, Ring login + 2FA, the MQTT integration, the `frame` user and token, and a next-day resource check. Agent copies §11.9 into `docs/runbook-controls.md` and `docs/controls-compose.yaml` (no secrets; the tunnel token, MQTT passwords and Ring token stay in root-only files on the box). [S] or Chief create the tunnel and VPC Service. Worker: `vpc_services` binding, `HA_TOKEN` as a GitHub secret copied by `worker-secrets.yml` (optional in `tools/set-worker-secrets.mjs` until set), "HA status" on `/admin` | 0.5 day agent + 1–2 h [S] | `/admin` shows "HA reachable, version x" and the four camera entities through the binding. No DNS records, and the tunnel can't be reached from the internet. The token appears nowhere but the GitHub/Worker secret (gitleaks, log canary test) |
| **P2 Controls (Spotify + Ring)** | §11.5 Spotify: `worker/src/spotify/` OAuth on `/admin` (grant `spotify` in `grants`, `SPOTIFY_CLIENT_SECRET` via `worker-secrets.yml`), `/api/spotify/state` and actions, `spotify_reauth_due` in health. §11.6 cameras: `controls_cams` table + `/admin` editor, `/api/controls/state`, streaming `/api/controls/cam/:id`. §11.7 indoor setting and tap-to-reveal. §11.4 screen. `features.controls` on | 1.75–2.25 days | Worker tests (mocked Spotify and HA binding): the requested scopes are exactly the two; `state` checked on the callback; tokens encrypted and never logged; refresh uses Basic auth and keeps a rotated refresh token; 429 and `QUOTA_EXCEEDED` → backoff per `Retry-After`; 403 → "Premium needed"; transfer refused for an id not in the last device list; last device remembered by name after transfer, Play with no active device transfers to it, absent device → 409 `device_absent` and the frame's "not available" message; `spotify_reauth_due` from day 168. Cameras: unknown id → 404; indoor image → 403 while the setting is off; no POST path to HA; HA down → 503; images `no-store`; zero KV writes; no token or entity names in logs. e2e (Chromium 106, mock data): Controls with and without Spotify connected; polling stops when hidden, idle or at night; an image is fetched only when `updated` changes; indoor cover, reveal and auto-hide at 45 s; no camera on Home or in alerts. On the frame: move Spotify to a Connect speaker, pause, skip, volume; four snapshots refresh; an indoor reveal hides itself. gitleaks green |
| **D Device brightness (with v1 P6; needs Stephen's OK)** | §10: `kiosk/framehw.patch` + `docs/runbook-kiosk.md` (origin check, portal-mode check, clamp). `backlight.js` wired to `FrameHW`, `brightness.js`, the Brightness settings sheet. [S]/[G] build and `adb install -r` at the frame only after Stephen's OK (Q13) | 1 day agent (0.5 kiosk + 0.5 frame) + ~30 min at the frame | `brightness.js` tests: night override, manual, auto curve, clamps, hysteresis, ramp, no bridge → no-op. e2e with a fake `window.FrameHW`: Brightness sheet, live lux line, read-only without the bridge. On the frame: the backlight follows a covered and lit sensor; at night it drops to `nightPct` and returns to the system value when the kiosk exits; on a non-frame page (e.g. the Wi-Fi portal) the bridge does nothing |

**Effort per phase** (agent days; [S] time is separate):

| Phase | Original plan | Previous revision (`306c8bed`) | Now | Change vs `306c8bed` | Why |
| --- | --- | --- | --- | --- | --- |
| F Freshness | – | 0.25 | 0.25 | 0 | |
| P1 | 2.5–3 (all of Phase 1) | 2.5–3 (P1a) | **3–3.5** | **+0.5** | Weather moves in; 8-slot rail |
| P1b | – | 1.75–2.25 | **3–4** | **+1.25 to +1.75** | Tasks (+1–1.25) and Alerts (+0.75–1) added; Weather moved out (−0.5) |
| H | 0.5 | 0.5 | 0.5 | 0 | One integration instead of nine, but a compose file and runbook for HA Container (now written in §11.9). [S] time drops from 2–4 h to 1–2 h: Docker is already installed, and the commands are exact |
| P2 Controls | 2–3 | 2–3 | **1.75–2.25** | **−0.25 to −0.75** | Scope cut to Spotify + Ring (2026-10-24). No lights, plugs, media players or HA service calls; direct Spotify OAuth adds a little. Inside P2: Spotify 0.75–1, cameras + privacy 0.5–0.75, screen + e2e 0.5 |
| D Brightness | – | – | **1** | **+1** | New, tied to P6 |
| **TOTAL after v1.1** | **5–6.5** | **7–9** | **9.5–11.5 agent days** | **+2.5** (+4.5 to +5 vs the original) | Was 9.75–12.25 before the Controls revision (−0.25 to −0.75, all from P2). Plus [S] time: 1–2 h for HA, ~15 min for the Spotify app, ~30 min for phase D at the frame, and minutes for the reconnect and the checks |

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
| Rail auto-hide | 2026-10-24 | The rail hides 10 s after the last touch on every screen (was Home only, 30 s). An empty-space tap shows it; controls work without toggling it and restart a showing rail. e2e: hide/reveal on all 7 screens, checkbox with the rail hidden and shown |
| Rail full width | 2026-10-24 | Off Home, the screen uses all 1280 px while the rail is hidden (no 96 px strip); the rail pushes it right while shown. A transparent 32 px left-edge zone brings the rail back; a blank 96×72 corner keeps the kiosk Menu zone clear. e2e on all 6 non-Home screens: view at x=0, w=1280 when hidden and x=96 when shown, no control under the edge zone, edge tap reveals, checkbox/undo/Settings work with the rail hidden without showing it |
| P2 Controls (agent side) | 2026-10-24 | Secrets plumbing (`HA_TOKEN`, `SPOTIFY_CLIENT_SECRET` optional in worker-secrets; `SPOTIFY_CLIENT_ID` var). Spotify OAuth on `/admin`, `/api/spotify/state` and actions, last speaker by name, `device_absent`. Cameras via HA (GET only, `controls_cams` allowlist on `/admin`, streamed `no-store` images, indoor 403 unless revealed). No `HA` binding in `wrangler.jsonc` yet: detected at runtime, "not connected" until the VPC Service exists. Controls screen with `features.controls` on: Spotify card (play/pause/skip/volume, optimistic with revert toast, speaker list), 2×2 snapshots (fetched only when `updated` changes, age and stale marks, tap to enlarge), indoor covered with tap-to-show for 30–60 s (Settings › Indoor cameras, off by default), polls every 5 s only while shown. Full-width/push rail and 32 px edge zone respected. Waits on Chief's §14 steps 12–13 and Stephen's Spotify connect |
| Photos no idle | 2026-10-25 | The idle return to Home no longer applies on the Photos screen (`nav.NO_IDLE`); night mode doesn't take over it either. Other screens unchanged. A reload on Photos resumes Photos |
| Photos night | 2026-10-25 | Night takes over Photos: in the schedule's night window Photos idles to the night clock after the idle timeout like every other screen (`nav.screenAt`), the night clock forgets Photos so the morning is Home (`nav.settle`), and the reload restore is day-only (`nav.resumeState`). Daytime Photos still never idles |
| P2.1 Spotify Recent | 2026-10-25 | Controls › Recent: "Play from Spotify" sheet with Recent (≤ 10 contexts, 2×5, no scroll, album when no context, shows skipped, topped up from playlists) and Playlists (≤ 20, scrolls) tabs. `GET /api/spotify/recent` (60 s memory cache, no KV/D1 writes, 404/403 lookups skipped, 429 backoff). Play takes a validated `context_uri` from the start (no offset for artists), shuffle untouched, active → remembered device → 409 `device_absent`. Optional scopes `user-read-recently-played playlist-read-private`; without them `needs_consent` and soft `spotify_recent_needs_consent`. CSP `img-src` adds only `https://i.scdn.co`. Sheet closes on outside tap, Close or 30 s idle; touches never toggle the rail |
| P1c Photo-set cleanup | 2026-10-25 | Keeps the active set and the newest retired set (`previous`); older retired sets and failed/stuck building sets (failed job, or no live job and over 24 h old) are queued. The 5-min cron deletes their KV keys `p:<set>:<n>` oldest set first, 50 per batch, ≤ 3 sets per run, under a 900/UTC-day budget in `kv_deletes` (separate from `kv_writes`), and resumes the next UTC day. A set's D1 rows go only after all its keys, then it is `purged`; each step is idempotent and re-checks the status, so active/previous/building sets are never touched even if the active set changes mid-run. A new set going live pushes the old `previous` into the queue. /admin › Photos: current/previous counts and dates, sets queued, deletes left today, storage (`photos.size` recorded at copy time, older rows estimated and marked approx.), and **Restore previous set** with a one-tap confirm (atomic swap; again flips back). Health: soft `photos.cleanup {queued, deletedToday}`, alert `photos_active_missing`. runbook-photos.md |

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
7. **`reddencloud` status** (§13 Status): the cleanup is done, and Chief has sent §11.9 steps 1–10, so
   steps 8–11 below are done (step 11 passed 2026-10-24 8:36 PM MT). Step 13 (tunnel) waits for Chief. Q18 and Q22–Q25 are
   all answered.
8. **Write the files on `reddencloud`** (§11.9 commands 1–5). Q23 is answered and Docker 27.3.1 is
   already installed, so there's no check or install step. The commands create `/opt/smart-frame-ha`,
   `compose.yaml`, the Mosquitto config with two random passwords, the ring-mqtt config and an empty
   tunnel env file. No secret is typed or shown.
9. **Start and onboard** (§11.9 commands 6–8): `docker compose up -d` for HA, Mosquitto and
   ring-mqtt, check the logs, then open **http://reddencloud.local:8123** (or the `.24` address) from the home network. Create the owner
   account (time zone America/Denver), add the recorder snippet and restart HA.
10. **Ring and MQTT** (§11.9 steps 9–10): sign in to Ring with 2FA at **http://reddencloud.local:55123**,
    run `sudo chmod 600 /opt/smart-frame-ha/ring-mqtt/ring-state.json` (it holds the Ring refresh token), then add HA's MQTT integration (`127.0.0.1:1883`, user `homeassistant`) and check that the four cameras
    appear. In the Ring app, set the front door's (battery) **Snapshot Capture** to every 10–15 min. The
    wired three stay at 30 s (§11.6).
11. **DONE 2026-10-24 8:36 PM MT** (passed: HA ~400 MiB, ring-mqtt 176 MiB, mosquitto 3 MiB, under 1% CPU,
    swap 0, no OOM). Was: **next day, during a Plex transcode** (§11.9 step 11): send Chief the `docker stats`, `free -h` and
    `vmstat` numbers. Chief adjusts caps or the snapshot interval if needed.
12. **HA `frame` user:** create a non-admin user `frame`, then a long-lived token for it. Store it as the
    GitHub secret `HA_TOKEN` yourself (`gh secret set HA_TOKEN` or the repo's Settings › Secrets), then
    tell Chief to run `worker-secrets.yml`. Never paste it into chat, files or logs.
13. **Gated until Chief sends it. Tunnel and VPC Service**, with Chief's guidance (needs Connectivity Directory Admin; box side is §11.9 step 12):
    Zero Trust › Networks › Tunnels › create a tunnel, save its token with §11.9 step 12
    (`cloudflared.env`, mode 600), then create a Workers VPC Service pointing at HA (`127.0.0.1:8123`). No public
    hostname and no DNS records.
14. **Spotify developer app** (~15 min, signed in with the Premium account at
    https://developer.spotify.com/dashboard):
    - Accept the Developer Terms if asked. Click **Create app**.
    - Give it a plain name and description, e.g. "Frame controls" (they show on the consent screen).
    - Redirect URI: `https://smart-frame.sredden.workers.dev/admin/spotify/callback` (exact). Tick **Web API**
      if asked which APIs are used. Save.
    - Leave it in **Development mode**. As the owner, Stephen is the only user. If Spotify answers 403 at
      connect, add his account email under **User Management**.
    - Settings: give Chief the **Client ID** (not a secret; it goes in `wrangler.jsonc`). Store the
      **Client secret** as the GitHub secret `SPOTIFY_CLIENT_SECRET` yourself, then tell Chief to run
      `worker-secrets.yml`.
15. **After P2 deploys:** `/admin` › **Connect Spotify** and approve. Then on `/admin` › Controls, label
    the four cameras and mark living room and basement as indoor. In the Alexa app, check that Spotify is
    linked (ideally the default music service) on the Echo Dot "Stephen's Office". Say "Alexa, Spotify
    Connect" to it once, then pick it in "Play on…" on the frame so it's remembered (Q18). Reconnect Spotify every 6 months when `/admin` asks.
16. **If the frame moves to the office** (frame-side, with Chief; device changes need Stephen's OK):
    - Before the move: confirm the AiMOR lockdown (device plan §5 step 3, `:7806` empty). Do any USB adb
      work first (phase D, P6 checks).
    - At the office: kiosk controls (hold two fingers still for 1.5 s) › Wi-Fi settings › join a password
      (guest or IoT) network that Stephen sets up (Q24). Accept the sign-in page if the kiosk shows one.
    - Settings › Weather location → the office. A day later, check the clock and that `/api/health` shows
      no `frame_offline`.

## 15. Open questions

**Resolved so far:**
- **Q1, Q2, Q10, Q11, Q12** (Stephen, 2026-10-24 6:53 PM MT: "all dev's picks are good"):
  - Q1: A/B removal shipped early as v1.2 (taps only wake the frame until the rail lands).
  - Q2: Home 6:00–22:00, night 22:00–6:00.
  - Q10: the full `tasks` scope, with check-off behind the Worker guards and undo.
  - Q11: assumed to be the calendar grant's account (his Workspace account); P1b checks this when it
    loads task lists.
  - Q12: the proposed alert defaults.
- Rail: hidden on every screen 10 s after the last touch; an empty-space tap shows it (2026-10-24; was
  Home only, 30 s).
- Rail order: 8 items, decided 2026-10-24 (§2.2).
- Spotify Premium: yes.
- Frame camera and microphone: there are none (§1.1).
- **Controls scope and HA host** (Stephen via Chief, 2026-10-24 7:01 PM MT; §11):
  - Q14: ReddenNAS is a Buffalo LinkStation LS220DE (ARM). Ruled out.
  - Q15: not MIGUEL. HA Container goes on the Plex Ubuntu Mac. The OpenClaw Mac is never used.
  - Q16 (bulbs), Q17 (Wemo stays on Alexa), Q19 (Samsung Frame TV left out), Q21 (Harmony unused):
    closed, because they're out of scope.
  - Q20: all four Ring cameras (front door, living room, basement, back porch). The indoor two follow §11.7.
- **Controls answers** (Stephen via Chief, 2026-10-24 7:20 PM MT; plan approved):
  - Q18: the Echo Dot "Stephen's Office", with last-used-device memory.
  - Q22: Protect yes; front door battery, the rest wired; ring-mqtt.
  - Q24: office network fine (Stephen is the IT person); city and date TBD.
  - Q25: defaults confirmed.
- **Q23, HA host facts** (Chief, 2026-10-24 7:11 PM MT; updated 7:47 PM after the cleanup): `reddencloud`,
  static `.24` (`reddencloud.local`), Ubuntu 24.04.3, headless, 2 cores, 7.5 GiB RAM (6.9 GiB available,
  0 swap), 62 GB free, Docker 27.3.1 (`sredden` in the `docker` group). Runbook in §11.9.

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
- ~~**Q14** ReddenNAS model~~ Resolved: LS220DE (ARM), ruled out.
- ~~**Q15** MIGUEL as HA host~~ Resolved: not MIGUEL. The Plex Ubuntu Mac (Q23).
- ~~**Q16** Smart bulbs~~ Closed: lights are out of scope.
- ~~**Q17** Wemo via Alexa~~ Closed: Wemo stays on Alexa, out of scope.
- ~~**Q18** Spotify targets~~ Resolved: mostly the Echo Dot "Stephen's Office" at the office (§11.4–11.5).
- ~~**Q19** Samsung TV model~~ Closed: it's a Samsung Frame TV and is left out.
- ~~**Q20** Which Ring cameras~~ Resolved: all four.
- ~~**Q21** Harmony~~ Closed: unused, out of scope.
- ~~**Q22** Ring~~ Resolved: Protect yes; front door is battery, the other three wired; ring-mqtt (§11.6).
- ~~**Q23** Plex Mac check results~~ Resolved: `reddencloud` (`.24`), Ubuntu 24.04.3, 2 cores, 7.5 GiB RAM
  (6.9 GiB available), 62 GB free, Docker 27.3.1 (§11.9).
- ~~**Q24** Office network~~ Resolved: Stephen is the office IT person, so no 802.1X concern. City and
  move date still unknown (not blocking; Settings weather location).
- ~~**Q25** Indoor defaults~~ Resolved: yes (off, 45 s reveal).

## 16. Risks

- **Workers VPC is beta** (still beta and free in the 2026-09/10 docs): terms or pricing may change.
  Fallback E (HA polls the Worker) works for small state, but not for camera images: those would need
  storage over the KV write limit. Without VPC, the Ring card would go away while Spotify keeps working.
- **Ring is unofficial** (ring-mqtt, or HA's `ring`), uses the Ring app API with 2FA, and can break or
  need a fresh login. **HA's `ring` snapshots need Ring Protect** and show only the last event (§11.6).
  Battery cameras give stale images, and short intervals drain them.
- **Indoor camera privacy** on a frame in an office: the server enforces "off by default", and reveals
  are short and tap-only (§11.7). The risk left is someone tapping while the setting is on.
- **Spotify Development Mode**: Premium is needed for the owner and for control. The 6-month refresh token
  means a reconnect twice a year (health code warns). The per-developer quota is shared, and Spotify has
  changed dev-mode rules twice since 2025. Cast speakers may be missing from the device list (§11.5).
- **`reddencloud` is shared, and CPU is the limit** (2 cores, shared with Plex).
  - After the cleanup, memory is no longer the concern: 6.9 GiB available, 0 swap. HA's 1 GB cap leaves
    plenty of room to raise it.
  - Plex transcodes still compete for CPU.
  - Swapping is now unlikely.
  - It's old Mac hardware: sleep, power-on after an outage.

  Mitigations (§11.9):
  - memory caps with no swap for the stack
  - low CPU weight and hard `cpus` caps
  - the minimal recorder
  - Plex direct play
  - a longer ring-mqtt interval if needed
  - a next-day `docker stats`/`vmstat` check

  If the box dies, only the Ring card is lost. `/opt/smart-frame-ha` is the one folder to back up
  privately.
- **Office network**: Stephen runs it (Q24), so 802.1X and policy aren't a concern. A sign-in page that
  comes back or blocked NTP still could be. §11.8 lists the checks, and the AiMOR lockdown must be
  confirmed first.
- **Echo not listed**: an idle Echo can drop out of Spotify's device list. The frame says how to wake it
  ("Alexa, Spotify Connect"), and Play never falls back to another device on its own (§11.5).
- **CPU on the free plan**: 22-calendar merges and Controls state calls must stay under 10 ms CPU. Camera
  images are streamed, not parsed. Measure in P1/P2 and back off cadence if needed.
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
- HA install options: https://www.home-assistant.io/installation/ · HA Container on Linux (Docker Engine
  ≥ 23.0.0, not Docker Desktop, `--network=host`, compose, no apps): https://www.home-assistant.io/installation/linux ·
  32-bit and Core/Supervised deprecation: https://www.home-assistant.io/blog/2025/05/22/deprecating-core-and-supervised-installation-methods-and-32-bit-systems/
- Ring in HA (cloud polling, TCP 5228, `last_recording` needs Ring Protect): https://www.home-assistant.io/integrations/ring/ ·
  source: camera image from the last recording, "Ring Protect subscription required for snapshots", 3 min URL refresh:
  https://github.com/home-assistant/core/blob/dev/homeassistant/components/ring/camera.py ·
  https://github.com/home-assistant/core/blob/dev/homeassistant/components/ring/strings.json
- ring-mqtt (Docker, needs an MQTT broker, 2FA web UI on 55123): https://github.com/tsightler/ring-mqtt/wiki/Installation-(Docker) ·
  snapshot intervals (30 s line-powered; Snapshot Capture or 600 s low-power): https://github.com/tsightler/ring-mqtt/wiki/Configuration-Details ·
  low-power cameras, battery use, motion snapshots need Protect: https://github.com/tsightler/ring-mqtt/wiki/Frequently-Asked-Questions-(FAQ) ·
  HA MQTT camera: https://www.home-assistant.io/integrations/camera.mqtt/
- HA Container compose (`stop_grace_period: 60s`, `network_mode: host`, `TZ`): https://www.home-assistant.io/installation/linux ·
  recorder (`purge_keep_days` default 10, `commit_interval` default 5, `exclude.domains`): https://www.home-assistant.io/integrations/recorder/ ·
  reverse-proxy settings in the UI since 2026.8: https://www.home-assistant.io/integrations/http/ ·
  MQTT integration: https://www.home-assistant.io/integrations/mqtt/
- Images and tags (checked 2026-10-24): https://hub.docker.com/r/homeassistant/home-assistant/tags ·
  https://hub.docker.com/_/eclipse-mosquitto · https://hub.docker.com/r/tsightler/ring-mqtt/tags ·
  https://hub.docker.com/r/cloudflare/cloudflared/tags · https://github.com/home-assistant/core/releases ·
  https://github.com/tsightler/ring-mqtt/releases · https://github.com/cloudflare/cloudflared/releases
- Spotify on Alexa (linking, default service, Echo Dot supported): https://support.spotify.com/us/article/spotify-on-alexa-devices/ ·
  "Alexa, Spotify Connect": https://newsroom.spotify.com/2018-12-14/how-to-set-up-spotify-on-your-amazon-alexa-enabled-device/ ·
  https://community.spotify.com/t5/FAQs/How-to-play-music-with-Alexa/ta-p/5283510 ·
  https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Spotify-Connect-can-t-find-Alexa-devices/td-p/5606285
- Mosquitto config (`allow_anonymous`, `password_file`, `persistence_location`, `log_dest`):
  https://mosquitto.org/man/mosquitto-conf-5.html · `mosquitto_passwd -U`: https://mosquitto.org/man/mosquitto_passwd-1.html ·
  image entrypoint (UID 1883): https://github.com/eclipse/mosquitto/blob/master/docker/2.1-alpine/docker-entrypoint.sh
- cloudflared `TUNNEL_TOKEN`, `--token-file`, systemd unit, auto-update:
  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/ ·
  image (`ENTRYPOINT cloudflared --no-autoupdate`, UID 65532): https://github.com/cloudflare/cloudflared/blob/master/Dockerfile
- Compose `mem_limit`, `memswap_limit` (equal = no swap), `cpus`, `cpu_shares`, `env_file`:
  https://docs.docker.com/reference/compose-file/services/
- Workers Cache API (functional on custom domains): https://developers.cloudflare.com/workers/runtime-apis/cache/ ·
  Workers VPC limits: https://developers.cloudflare.com/workers-vpc/platform/limits/
- Spotify Web API:
  - scopes: https://developer.spotify.com/documentation/web-api/concepts/scopes
  - playback state: https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback
  - transfer (Premium only): https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback
  - volume: https://developer.spotify.com/documentation/web-api/reference/set-volume-for-users-playback
  - auth code flow: https://developer.spotify.com/documentation/web-api/tutorials/code-flow
  - refresh tokens (6-month lifetime): https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
  - redirect URIs (HTTPS or loopback): https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
  - quota modes (owner Premium, `QUOTA_EXCEEDED`, user allowlist): https://developer.spotify.com/documentation/web-api/concepts/quota-modes
  - February 2026 changes: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
  - extended access criteria: https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access
  - rate limits: https://developer.spotify.com/documentation/web-api/concepts/rate-limits
  - apps (up to 25 per developer): https://developer.spotify.com/documentation/web-api/concepts/apps
- Cast devices missing from `/me/player/devices` until active: https://github.com/spotify/web-api/issues/787 ·
  https://github.com/spotify/web-api/issues/834
- Wemo cloud and Alexa end (context for dropping Wemo): https://www.belkin.com/support-article/?articleNum=335419
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
- Home HQ kiosk `MainActivity.java` (WebView settings, `onPageStarted` `mainUrl`, portal mode, the
  two-finger hold menu with Wi-Fi settings) and device plan §5 steps 3–8 (AiMOR disabled, boot fixes with
  NTP, Omada reservation and allow-list): box copies of the reference repo at `0bff55e` and the
  photo-frame project.
- Repo files cited in §11.8: `worker/wrangler.jsonc` (`TIME_ZONE`, `WEATHER_LAT/LON`),
  `worker/src/{state,health,weather}.js`, `worker/src/google/{calendar,oauth}.js`, `frame/src/main.js`,
  `frame/src/version.js`, `.github/workflows/worker-secrets.yml`, `tools/set-worker-secrets.mjs`,
  `docs/runbook-health.md`.
