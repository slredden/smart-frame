# smart-frame v2 plan: one Home, nav rail, Calendar, Weather, Photos, Reflection, Controls, Settings

Status: **plan only**, revised 2026-10-24 with Stephen's decisions (through Chief). It builds on
[PLAN.md](PLAN.md) (v1, shipped) and v1.1 (shipped, §9). Nothing here changes v1 decisions unless it says
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
- New screens: Calendar, Weather, Photos, Reflection, Controls (the screen first drafted as "House"), and Settings.

| Screen | One line |
| --- | --- |
| **Home** | The v1 split screen (photo left, clock/weather/agenda/reflection right) plus the night clock |
| **Calendar** | All calendars on the account, chosen by Stephen, as agenda, day or week |
| **Weather** | Today hour by hour, plus a 10-day outlook (Open-Meteo, no key) |
| **Photos** | The photo set, with interval, order, captions, fit, pause/next/prev, favorite and hide |
| **Reflection** | The current guide from Sage: this week in full, the guide's weeks, and recent guides |
| **Controls** | Lights, TV and media, Spotify and Ring snapshots, through Home Assistant (Phase 2) |
| **Settings** | Frame-wide options: calendar selection, day/night schedule, night dim level, idle timeout, weather location |

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

## 2. Navigation, Home, schedule and touch

### 2.1 Schedule (changed from v1)

v1 had three states: B 6–7, A 7–22 and night 22–6. B existed only as a quieter morning layout. With one
day layout, the 6:00 and 7:00 boundaries mean the same thing, so the schedule becomes:

```
scheduled(m, s):        # m = Denver minutes past midnight; s = settings.schedule
  if s.dayStart <= m < s.nightStart → HOME     # defaults: dayStart 06:00, nightStart 22:00
  else                              → NIGHT
```

- **Home 6:00–22:00, night 22:00–6:00** by default. Both times can be changed in Settings (§6).
- **The dim night clock stays.** The panel's backlight can't be dimmed from the page (PLAN.md §8), so a
  black screen with a faint clock is still the closest we get to "off". It also keeps photos from lighting
  the room at night. The dim level becomes a setting (§6).
- Time zone stays America/Denver for the clock and schedule, even if the weather location changes.

### 2.2 Rail

- **Order (Chief's suggestion, adopted): Home, Calendar, Weather, Photos, Reflection, Controls,
  Settings.** This changes the order Stephen gave earlier (Home, Photos, Calendar, Reflection, Controls,
  Settings) and is **Open Question Q1** to confirm. The order is one array in `nav.js`, so a change costs
  minutes.
- Controls stays hidden until Phase 2 (the `features.controls` flag in `/api/state`).
- **Size check at 1280×800, DPR 1.** The frame is 10.1" at about 150 px per inch, so 1 px ≈ 0.17 mm.
  - The rail is 88 px wide and the full 800 px tall.
  - Seven items at **88 × 96 px** each (about 15 × 16 mm) take 672 px. That leaves 128 px at the bottom
    for the small clock.
  - Each item has a 32 px icon and a 13 px uppercase label.
  - All items are well above the 64 px minimum (§2.4). Even at 8 items, the rail would still fit at 88 px each.
  - The active item is inverted, as in the reference.
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

- The rail appears as an overlay on the left 88 px of the photo, so Home's layout never moves. The photo
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
frame only (**Q2**).

## 3. Calendar screen

### 3.1 Which calendars (selection)

v1 reads only the primary calendar, which is often empty; most events live on about 21 other calendars.
v1.1 (§9, shipped) adds selection
on `/admin`. v2 adds it on the frame, in **Settings** (§6), with a shortcut from the Calendar screen.

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
  (§6) so it persists.
- v1 filters apply everywhere: drop cancelled, free (transparent), working-location and self-declined
  events (`normalizeEvents`).

### 3.3 Data and budget

- The v1.1 cron already fetches each selected calendar with one `events.list`, today → +30 days,
  `orderBy=startTime`, `singleEvents=true`, `maxResults=50`. v2 keeps **all** events in that window in
  the one `calendar` cache row instead of trimming to today/tomorrow/next (one D1 write per refresh;
  ~25 × 50 events ≈ 150 KB worst case, under D1's 2 MB row limit).
- New `GET /api/calendar?from=YYYY-MM-DD&days=N` (device auth, N ≤ 14) slices the cached row. Past
  days (prev buttons before today) are out of the cached window: show "Earlier days aren't loaded"
  rather than fetch on demand (keeps one code path and the subrequest budget). → **Q4**.
- Budget (Workers Free: 50 subrequests and 10 ms CPU per invocation, 100,000 requests/day; subrequests
  aren't billed): a cron run uses ≤ 1 token refresh + 1 weather + N calendars, so N ≤ 25 (enforced).
  Google: 22 calendars × 288 runs ≈ 6.3k `events.list` calls/day. Workers allow 6 simultaneous
  connections, so 22 fetches queue in ~4 waves; wall time isn't CPU time. If CPU on the cron ever
  exceeds 10 ms (watch `calendar_error` / exceeded-CPU in logs), move calendars to every 10 min.
- Truncation: a calendar with more than 50 events in 30 days loses the tail. Acceptable for agenda; the
  admin list shows a "busy calendar" note when a fetch hit 50 items.

## 4. Weather screen

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
- The location comes from Settings (§6). Changing it forces one immediate refresh (one extra write pair).
- Open-Meteo's free API is for non-commercial use with no key (the same terms v1 already relies on).

## 5. Photos screen

- Full photo area (1204 × 800 next to the rail) with a bottom toolbar that hides after 5 s:
  **Prev · Pause/Play · Next · ♥ Favorite · Hide · Options**.
- Photo options sheet (saved server-side in `settings.photos`, §6): interval (15 s, 30 s, 1 min, 2 min, 5 min; default 60 s, the v1
  value), order (shuffle daily | in picked order), captions on/off (month + year, v1), fit (fit with
  blurred backdrop, v1 default | fill/crop), "Favorites only" on/off.
- These options drive the Home photo pane too, so photos behave the same everywhere. They stay on this screen and don't appear in Settings.
- **Favorite / Hide**: columns `favorite INTEGER DEFAULT 0`, `hidden INTEGER DEFAULT 0` on `photos`
  (runtime `ALTER TABLE` guarded by a `meta` schema version; see §6.3). Hidden photos leave the manifest
  in `/api/state`; `/admin` Photos gets a "Hidden (n) · Unhide all" control. Hide asks for confirmation
  on the frame ("Hide this photo? Undo"), 5 s undo toast.
- Picking a new set keeps working from `/admin` (Picker API, v1). The frame never starts a Picker session.
- Pause holds the current photo until "Play" or idle return to Home.

## 6. Settings screen and server-side settings

### 6.1 What's on the frame, and what isn't

| On the frame (Settings screen) | `/admin` only (Cloudflare Access) |
| --- | --- |
| Calendar selection (also on `/admin`) | Google connect/reconnect, the Photos picker session |
| Day/night schedule | Device pairing, revoking devices |
| Night dim level | Publish and health tokens, all secrets |
| Idle-return timeout | The Controls allowlist editor (Phase 2) |
| Weather location | "Reset frame settings to defaults" |

Photo display options stay on the Photos screen (§5) and are stored the same way. **Secrets, Google
connect, pairing and the Controls allowlist never appear on the frame.**

### 6.2 Fields, bounds and defaults

| Key | Field | Default | Allowed (enforced by the Worker) |
| --- | --- | --- | --- |
| `schedule` | `dayStart`, `nightStart` | 06:00, 22:00 | 15-min steps. `dayStart` 04:00–10:00. `nightStart` 18:00–24:00. Day at least 8 h long |
| `night` | `dimPct`, the night clock's opacity | 35 | 15–60. It can't go below 15, so the night screen can't be made invisible |
| `idle` | `minutes` | 10 | 1–60. **No 0 and no "never"**: 0 would make every tap expire at once, and "never" keeps photos on all night |
| `weather` | `name`, `lat`, `lon` | Denver, 39.74, −104.99 (v1 vars) | `lat` −90..90 and `lon` −180..180, rounded to 2 decimals (city level, never a home address). `name` ≤ 80 chars |
| `photos` | `intervalSec`, `order`, `captions`, `fit`, `favoritesOnly` | 60, shuffle, on, fit, off | interval ∈ {15, 30, 60, 120, 300}. Order ∈ {shuffle, picked}. Fit ∈ {fit, fill} |
| `calendar` | `view` | agenda | ∈ {agenda, day, week} |
| (table) | calendar selection | primary | Known ids only, ≤ 25 (v1.1 rules) |

### 6.3 Storage and guards

- D1 table `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL)` with JSON values. `updated_by` is `frame:<deviceId>` or `admin:<email>`.
  It's created with `CREATE TABLE IF NOT EXISTS` in `db.js` (the repo convention, no migration file).
- Code: `shared/settings.js` holds the defaults, bounds and a pure `validateSetting(key, value)`. The
  same code runs in the Worker and in the frame UI, so steppers can't go out of bounds.
- `GET /api/state` includes `settings` (merged over defaults). The frame writes with
  `PUT /api/settings/:key` and `PUT /api/calendars/selection`, which have these guards:
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

### 6.4 Weather location without a geocoding key

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

## 7. Reflection screen and freshness

### 7.1 What it shows (only what's already published)

The screen shows **only fields that already reach the Worker through the existing publish path**: the
guide's `{start, end}` and each week's `{n, start, end, theme, practice}`. `cleanGuide` in
`shared/reflection.js` drops everything else, including the title and daily readings. No other Sage
output and no private notes are read, and nothing new is added to the publish payload.

- **This week** (large): "Week 3 of 5 · Oct 4–10", the theme, and the **full practice** (Home clamps it
  to a few lines; `MAX_PRACTICE` is 1,200 chars).
- **This guide** ("the month"): the guide's date range and every week as a row (week number, dates, theme).
  - Past weeks open to their practice when tapped.
  - Future weeks show the theme only, or nothing (**Q5**).
- **Recent guides**: up to the 5 guides before the current one, by date range. Tapping one shows its weeks
  the same way.
- **Empty state:** "No reflection for this week yet." Nothing is shown for a gap, which is how v1 already handles it.
- Data comes from new `GET /api/reflection` (device auth, `cache-control: no-store`). It's fetched on open
  and not polled, because the content changes at most a few times a month. `/api/state` keeps sending only
  the current week for Home.
- **"Monthly" content:** Sage's guides run about 5 weeks (the observed range is 36 days), not calendar months. The
  only month-level fields kept are the date range. If Stephen wants a month-level line (for example the
  guide's intro theme), that means changing the extractor and the publish payload (**Q7**, not in this plan).

### 7.2 History retention

- Today there's **no history**. `worker/src/reflection.js` stores a single row
  (`reflection`, `id = 1`, `data_enc`, `updated_at`), encrypted with AES-GCM under `TOKEN_ENC_KEY` (AAD
  `reflection`). Each publish overwrites it.
- Phase 1 adds the table `reflection_guides (start TEXT PRIMARY KEY, end TEXT NOT NULL, data_enc TEXT NOT NULL,
  published_at TEXT NOT NULL)`. Each row is encrypted the same way.
  - Republishing a guide with the same start replaces that row.
  - On first run, the old `id = 1` row is copied over.
  - The old table is dropped one release later.
- **Keep the 6 most recent guides (about 6 months)**, and delete older ones on publish. **Q6** asks
  whether that's right.
  - At ≤ 8 weeks × (160 + 1,200) chars, plus base64 and the GCM overhead, a guide is ≤ ~15 KB. That's
    ≤ 90 KB in total, against D1's 5 GB free storage and 2 MB per row. Writes are 1–2 rows per publish.
  - **The free plan isn't the limit.** The cap is a privacy choice: keep the minimum of private text on a
    third-party service.
- When guides overlap (Sage publishes the next guide before the current one ends), the picker uses
  **the guide with the latest `start` ≤ today**. Publishing early is then safe: the new guide takes over
  on its start date.

### 7.3 How publishing works today (from the repo, not assumed)

1. **It's manual and done by Chief.** Nothing in the repo runs on a schedule. PLAN.md §9.4 step 1:
   "When Sage finishes a monthly guide, **Chief** runs `node tools/publish-reflection.mjs <guide.html>`".
   `docs/runbook-reflection.md`, "Each month, when a new guide is ready": dry run, then publish.
2. **Source:** Sage's self-contained HTML guide in Stephen's private notes (PLAN.md §9.4,
   "Real source format"). Since PR #1, the extractor also reads the copy published to the private hub
   (`p.meta` date line; `docs/runbook-reflection.md`). The repo doesn't know where Chief finds it, and the wiki's Sage seat recipe
   doesn't mention guides. So **no drop path or Sage cadence is defined** (**Q8**).
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

### 7.4 Proposed routine for Chief (`smart-frame-reflection`, daily)

| | |
| --- | --- |
| **When** | Daily at **08:00 America/Denver**. Publishing is idempotent, so a daily check costs nothing when nothing changed |
| **Inputs** | (1) The newest `*.html` guide at the agreed private drop path (**Q8**). (2) The publish token file `/home/box/.secrets/smart-frame/publish.token` (mode 600, never printed). (3) The health token file `/home/box/.secrets/smart-frame/health.token`. (4) A local state file holding the last published file's sha256 (no text) |
| **Step 1** | `SMART_FRAME_HEALTH_TOKEN="$(< …/health.token)" node tools/check-health.mjs --json`, then read `reflection.weekly` and `reflection.monthly` (§7.5) |
| **Step 2** | Find the newest guide file and compute its sha256. If it matches the state file and health isn't stale → done, silently |
| **Step 3** | `node tools/publish-reflection.mjs "$GUIDE" --dry-run`. The output has dates and counts only. Check that the range includes or follows today |
| **Step 4** | `SMART_FRAME_PUBLISH_TOKEN="$(< /home/box/.secrets/smart-frame/publish.token)" node tools/publish-reflection.mjs "$GUIDE"`, run in a subshell with `set +x`. The token is never echoed, logged or passed as an argument. On `published:`, save the sha256 |
| **Step 5** | Run health again. Expect `reflection_weekly_stale` and `reflection_monthly_stale` to be gone |
| **Failure: `refused: …`** | Don't retry. Tell Stephen (and Sage, through Chief) the **problem codes only**, e.g. `week_3_length`, plus the runbook fix. Never quote guide text |
| **Failure: HTTP 401** | The publish token doesn't match `PUBLISH_TOKEN_HASH`. Alert Stephen once a day until fixed. Rotation is in `docs/runbook-deploy.md` |
| **Failure: HTTP 400 `problems`** | Same as a refusal |
| **Failure: network / 5xx** | Retry 3 times, 10 min apart, then report it. The next day's run tries again |
| **Nudge** | If the current guide ends within 5 days and no newer file exists, ask Sage (through Chief) for the next guide. If `reflection_monthly_stale` is set, tell Stephen |
| **Approval** | Auto-publishing an unchanged pipeline is assumed to be fine. **Q8** asks whether Chief should publish on its own or wait for a go each time |

### 7.5 Health: `reflection_weekly_stale` and `reflection_monthly_stale`

Both use the Denver date `today`, guide **coverage dates** (not `published_at`, which is reported too)
and the guides stored in §7.2. They're computed in `buildHealth` from the decrypted dates only (no text).

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
  and Chief acts on them in §7.4.
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
  published guides" is just that one guide, and the definitions still hold. It isn't built in this plan
  change.

## 8. Controls screen (Phase 2) and Home Assistant

### 8.1 What can and can't be controlled (verified 2026-10-24)

| Gear | Path | Notes |
| --- | --- | --- |
| **Wemo plugs** (4 answer locally) | HA `wemo`, Local Push via pywemo | Belkin shut the Wemo cloud, app and **Alexa/Google integrations on 2026-01-31**; pywemo is local and unaffected. So Alexa control of Wemo should already have stopped → **Q14**. HA needs the plugs on its subnet (port 8989 inbound for push) |
| **Smart bulbs** (brand unconfirmed, maybe Philips) | **Hue**: HA `hue` via a Hue Bridge, Local Push. **Without a bridge**: depends on brand | Cloud-only bulbs (the scan shows a GE light and Tuya devices, both cloud) need a cloud integration or can't be controlled; that's a **risk**, decided per brand once identified (**Q13**, [S] task) |
| **Alexa** | Stays as it is, beside HA. **Not the control path** | No official Alexa control API for this use. The HACS `alexa_media_player` uses the unofficial Alexa API and breaks with Amazon changes. We don't depend on it |
| **Harmony Hub** `.109` | HA `harmony`, Local Push | Logitech stopped making Harmony in 2021; the hub keeps working locally. HA docs: some firmware needs "Enable XMPP" in the Harmony app. Activities (`remote.turn_on activity=…`) are the useful control |
| **Samsung TV** `.67` | HA `samsungtv`, Local Push | Turning on from off may need Wake-on-LAN, depends on model (**Q16**) |
| **Roku Streambar** `.61` | HA `roku`, Local Polling (ECP) | Power, volume, input, app launch |
| **Fire TV** `.76` | HA `androidtv` (ADB), Local Polling | The Android TV Remote integration does **not** work on Fire TV (HA docs). ADB is already enabled for the dumbtv work |
| **Google Cast** (`.104 .115 .132`, Fire TV) | HA `cast`, Local Polling | Play/pause/volume of what's casting. HA Container needs host networking for discovery |
| **Spotify** | HA `spotify` (cloud) | **Premium required** (Spotify requires Premium for the Developer Portal since Feb 2026). Controls only devices Spotify already knows (`source_list`) → **Q15** |
| **Ring** (doorbell, stickup, 4 cameras) | HA `ring`, Cloud Polling (60 s) | No official public Ring API; HA's integration is community-maintained on Ring's cloud, needs Ring login + 2FA, and can break. Live view is WebRTC through HA's frontend; we use **snapshots** (`/api/camera_proxy/<entity>`) refreshed every 10 s while the Controls screen is open. Battery cameras may return stale snapshots. Last-recording needs Ring Protect |

### 8.2 Where Home Assistant runs (decision)

**Home Assistant OS in a VM on the MIGUEL PC** (the home Windows PC that already runs 24/7). Reasons:
it's known to be always on and reachable for Chief's approved commands; HA OS gives add-ons
(cloudflared) and HACS without hand-built containers; the HA docs install path for Windows is a VM.
**ReddenNAS** is the better long-term host *if* its model can run a VM or Docker with host networking
(Cast and Wemo push need it); its model is unknown → **Q11**. Switching later is an HA backup/restore.
Either way HA must sit on the same LAN/VLAN as the Wemo plugs and TVs (the proposed IoT-VLAN split on
the Omada page would need mDNS/SSDP forwarding or static IPs).

### 8.3 How the frame reaches HA (decision)

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

### 8.4 Controls screen layout

- Rooms as sections; tiles 160 × 120: light/plug tiles toggle on tap (optimistic flip, revert with a
  toast on error after 3 s, the reference's pattern); dimmable Hue lights get a long-press brightness
  sheet.
- **Media** card: per player (Roku, Fire TV, Samsung, Cast, Spotify) play/pause, prev/next, volume ±,
  and Harmony activities as buttons ("Watch TV", "Off").
- **Ring** card: a 2 × 2 grid of snapshots with "updated 8 s ago"; tap enlarges one.
- "HA offline" banner when the Worker can't reach HA; the rest of the frame is unaffected.

## 9. v1.1 (calendar selection): shipped

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
  **Reconnect calendar** on `/admin` once after deploy (§11 step 1). Until then the frame shows the
  primary calendar.

## 10. Phases

Phase 1 is split into two PRs so each auto-deploy is small. Both can ship before Home Assistant exists.

| Phase | Scope | Effort | Acceptance |
| --- | --- | --- | --- |
| **v1.1** | §9 | **Shipped** (PR #2) | Done. [S] reconnect still pending (§11) |
| **F Reflection freshness** (optional, standalone) | §7.5 `reflection_weekly_stale` / `reflection_monthly_stale` in `buildHealth`, runbook-health codes, and the §7.4 routine handed to Chief | 0.25 day | Unit tests for every case in §7.5. `/api/health` JSON shape in worker tests. No reflection text in health output or logs (canary test) |
| **P1a Home, nav, Settings, Calendar** | §2.6 A/B removal (first commit). §2 schedule, `nav.js`, rail, widget taps, hit sizes. §6 Settings screen, `settings` table, guards, `/admin` Settings and reset, geocoding proxy. §3 Calendar views, `/api/calendar`, full-window cache, selection sheet | 2.5–3 days | `nav.js` tests: night tap → Home + rail and never a widget; widget tap → screen; off-widget tap → 30 s peek; idle → Home or night per schedule; DST dates 2026-11-01 and 2027-03-14; custom schedule. `schedule.test.js` rewritten (§2.6). Settings worker tests: device auth, unknown key and field, each bound (idle 0 → 400, dim 5 → 400, day < 8 h → 400), merge-not-replace, 61st write/hour → 429, `updated_by` set, geocoding proxy (mocked: 2–60 chars, ≤ 5 results, query not logged). Calendar worker tests as before. e2e (Chromium 106): Home (rail hidden and peeked), night, each widget tap, Settings sheets, Calendar agenda/day/week, **hit-size check** (§2.4), no console errors. `check` (Chrome 106 compat, JS ≤ 60 KB gz). On-frame check (PLAN.md §10), including the soft keyboard. gitleaks clean |
| **P1b Weather, Photos, Reflection** | §4 Weather screen and the extended `weatherUrl`, `/api/weather`. §5 Photos screen, favorite/hide. §7.1–7.2 Reflection screen, `reflection_guides` with migration from `id = 1`, retention 6, `/api/reflection`. Controls stays hidden (`features.controls`) | 1.75–2.25 days | `normalizeWeather` tests (24 hourly, 10 daily, missing fields → null, Home `next3` unchanged). Worker test: still exactly 1 cache + 1 meta write per weather refresh. Reflection worker tests: migration of the `id = 1` row, republish replaces the same start, the 7th guide prunes the oldest, overlap picks the latest start ≤ today, 401 without a device token, no text in logs. Hidden photos leave the manifest. e2e: Weather, Photos with toolbar and options, Reflection (current, past and future weeks, empty state). On-frame check. gitleaks clean |
| **H (prerequisite) Home Assistant** | [S] install the HA OS VM, onboard, add integrations (§8.1) one by one, and create the `frame` user and token. The agent writes `docs/runbook-controls.md`. [S] or Chief create the tunnel and VPC Service. Worker gets the `vpc_services` binding, the `HA_TOKEN` secret, and an "HA status" probe on `/admin` | 0.5 day agent + 2–4 h [S] (+ Ring 2FA, Spotify app) | `/admin` shows "HA reachable, version x" through the binding. HA has no public hostname: no DNS records are added, and probing the tunnel from the internet fails. The token appears nowhere but the Worker secret (gitleaks, log canary test) |
| **P2 Controls** | §8.3: the allowlist table and `/admin` editor, `/api/controls` state, actions, camera proxy. §8.4 screen. `features.controls` turned on | 2–3 days | Worker tests with a mocked HA binding: non-allowlisted id or action → 403; lock and garage kinds refused; HA down → 503 + banner state; no HA token or entity names in logs. Unit tests for the optimistic toggle and revert. Chromium 106 e2e of Controls (mock data). On the frame: toggle a Wemo plug and a light, run a Harmony activity, pause Spotify, see Ring snapshots refresh. Compat check, all earlier tests and gitleaks green |

**Effort change against the previous version of this plan:**

| Phase | Before | Now | Delta | Why |
| --- | --- | --- | --- | --- |
| Freshness (F) | – | 0.25 | **+0.25** | New: health staleness and the routine spec |
| Phase 1 (P1a + P1b) | 2.5–3 | 4.25–5.25 | **+1.75 to +2.25** | Breakdown below |
| HA (H) | 0.5 | 0.5 | 0 | Doc renamed to `runbook-controls.md` |
| Phase 2 (Controls) | 2–3 | 2–3 | 0 | Rename only |
| **Total after v1.1** | 5–6.5 | **7–9 agent days** | **+2 to +2.5** | Plus 2–4 h of Stephen's time, unchanged |

Phase 1 breakdown:

| Part | Effort | Change |
| --- | --- | --- |
| A/B removal + rail + nav + widget taps | 0.5–0.75 | The removal saves code, but taps and the hit-size checks add a little |
| Settings screen + guards + geocoding | 1–1.25 | Was 0.25 inside P1 as plain server settings: **+0.75–1** |
| Calendar | 1 | Unchanged |
| Weather | 0.5 | **New** |
| Photos | 0.5–0.75 | Unchanged |
| Reflection screen + history | 0.75–1 | **New** |

## 11. Stephen's manual steps

1. **v1.1 (shipped):** click **Reconnect calendar** on `/admin` (and optionally add
   `calendar.calendarlist.readonly` on the consent screen's Data Access page). Then load calendars and
   tick the ones to show.
2. **Confirm Q1–Q3**: the rail order, whether A/B goes now or with Phase 1, and the 6–22 schedule.
3. **Reflection:** tell Chief where Sage's finished guides land, and whether Chief may auto-publish
   them (Q8). Answer Q5–Q7.
4. **On the frame after P1a:** check that the soft keyboard opens in Settings › Weather location. If it
   doesn't, set the location on `/admin` instead.
5. **Identify the smart bulbs**: the brand and model of each bulb or lamp (Alexa app → Devices shows the
   brand or skill), and **whether a Philips Hue Bridge exists** (a square or round white box wired to the
   router).
6. Say whether the Wemo plugs still respond to Alexa. They shouldn't since 2026-01-31.
7. Choose the HA host: a VM on the MIGUEL PC by default, or ReddenNAS if its model supports VMs or Docker.
8. Install HA OS, create the owner account, and add these integrations:
   - Wemo
   - Hue (press the bridge button)
   - Harmony (enable XMPP if asked)
   - Samsung TV (accept the prompt on the TV)
   - Roku
   - Android Debug Bridge for the Fire TV (accept the ADB prompt)
   - Cast
   - Spotify (create a Spotify developer app; Premium is needed)
   - Ring (login + 2FA)
9. Create the non-admin HA user `frame` and its long-lived token. Hand it to Chief to set as the Worker
   secret. It must never be pasted into chat logs or files.
10. Create the Cloudflare Tunnel (the cloudflared add-on on HA OS) and the Workers VPC Service in the
   dashboard. Chief can guide, and it needs Connectivity Directory Admin.
11. Pick which lights, players and cameras go on the Controls screen (the Controls editor on `/admin`).

## 12. Open questions

The old Q1 (rail on Home) is **resolved**: the rail is hidden, and a tap shows it for 30 s. The rest are
renumbered.

- **Q1 Rail order.** Chief's order is Home, Calendar, Weather, Photos, Reflection, Controls, Settings, and
  it's in this plan. Stephen earlier gave Home, Photos, Calendar, Reflection, Controls, Settings (without
  Weather). Which one?
- **Q2** Should A/B removal go out early as a small v1.2 (taps only wake the frame until the rail lands),
  or with P1a (proposed)?
- **Q3** Is the proposed schedule right: Home 6:00–22:00, night 22:00–6:00? It can be changed later in Settings.
- **Q4** Calendar: is "no earlier than today" acceptable, or should day and week views show past days
  (which needs on-demand fetches)?
- **Q5** Reflection: should future weeks of the current guide be visible (themes only), or hidden until
  they start?
- **Q6** Is keeping the 6 most recent guides (about 6 months) right? Fewer means less private text stored.
- **Q7** Is a month-level line wanted on Reflection? That would mean changing the extractor and the
  publish payload. Today only the weeks are published.
- **Q8** Where do Sage's finished guides land for Chief? Should Chief publish automatically when a new
  file appears, or wait for a go each time?
- **Q9** Night clock: is a 15% minimum right, or should a fully black "off" be allowed? A black screen
  can look broken.
- **Q10** When the weather location is moved to another time zone, should the clock stay on Denver time
  (proposed)?
- **Q11** What's the ReddenNAS model, and can it run a VM or Docker with host networking? If not, HA goes
  on MIGUEL.
- **Q12** Is MIGUEL the always-on Windows PC used for the Omada and Fire TV work, and can it host a
  VM with ~2 GB of RAM 24/7?
- **Q13** What are the smart bulb brands and models, and is there a Hue Bridge? Cloud-only bulbs may not be
  controllable.
- **Q14** Do the Wemo plugs still work through Alexa today? Belkin ended Alexa support on 2026-01-31.
- **Q15** Is the Spotify account Premium, and which speakers should be targets?
- **Q16** What's the Samsung TV model? It decides whether turn-on works or needs Wake-on-LAN. Is it the
  same set as the Fire TV Edition?
- **Q17** Which Ring cameras belong on the frame: all four, or only the front door?
- **Q18** Should the Harmony Hub stay in use, given Logitech no longer makes Harmony? It works fine
  locally today.

## 13. Risks

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
  the allowlist, the rate limit, Settings always being on the rail, and the reset on `/admin` (§6.3).
- **Soft keyboard on Android 6**: it may not appear in the kiosk WebView. Weather location then falls
  back to `/admin`.
- **Reflection history** keeps more private text on Cloudflare than v1 does (6 guides instead of 1). It's
  encrypted at rest under `TOKEN_ENC_KEY`, and Q6 sets the number.
- **Stale reflection** if no one publishes. §7.4 and §7.5 cover it, but the routine depends on Q8.

## 14. Sources (checked 2026-10-24)

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
  https://open-meteo.com/en/docs. Checked live 2026-10-24 with the §4 parameters (24 hourly, 10 daily,
  ~2.8 KB).
- Repo files cited in §7.3: `tools/publish-reflection.mjs`, `tools/lib/cli.mjs`, `tools/lib/reflection-parse.mjs`, `shared/reflection.js`,
  `worker/src/reflection.js`, `worker/src/health.js`, `worker/src/index.js`, `tools/check-health.mjs`,
  `docs/runbook-reflection.md`, `docs/runbook-health.md`, PLAN.md §9.4.
