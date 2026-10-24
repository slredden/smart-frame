# smart-frame build plan

Status: **plan only, nothing is built yet.** Written 2026-10-24. Implementation starts only after
Stephen says go. Until then, nobody creates Cloudflare or Google resources, changes DNS, or spends
money for this project.

This plan is written so a coding agent can work through it phase by phase (§16). Every phase ends with
acceptance checks it must pass before the next phase starts. Unanswered items are listed in §18.
Don't guess at them; ask.

---

## 0. Goals and non-goals

**Goals**
- Turn the PF1007L frame into an always-on private display with exactly five things: photos, clock and
  date, today's calendar, Denver weather, and this week's reflection.
- Run it unattended for weeks. It has to survive late Wi-Fi at boot, outages, and redeploys without
  anyone touching it.
- Keep it private. Calendar, photos and the reflection are served only to authenticated callers.
  Nothing personal goes in the repo, in logs, or on any public page.
- Host it on Stephen's existing Cloudflare account at $0 a month (Workers free tier, R2 and KV free
  allowances).
- Make updates simple: edit, push to main, CI deploys, and the frame picks up the new build by itself.

**Non-goals (for now)**
- Any other widgets: tasks, shopping lists, home control, news, and the parked tile dashboard (layout C).
- Motion-sensor wake, voice or microphone.
- Changes to the frame's Android setup. Those belong to the device plan (rooting, WebView 106, CA
  roots, kiosk app), which is tracked separately. This repo only assumes its result (§2).
- Multiple frames or family members. Leave room for a second device in the schema, but don't build
  for it.
- Writing anything back to Google: no edits to the calendar or to Photos.

## 1. Design decisions (fixed)

Decided by Stephen on 2026-10-24. Source: the [Smart frame layout](https://cursor.com/canvas/store-593ad622-8000-409c-abb6-7c70dfc329fd/4e001d81-7509-463f-a5a4-a76cd8b088f3) design page.

| Area | Decision |
| --- | --- |
| Screen | 1280×800 landscape, DPR 1 |
| Layout A, Photo first (primary) | Full-bleed photo. A corner card (bottom-left, about 560×280) shows the clock, AM/PM, date, current weather, the next event, and "This week: …" |
| Layout B, Split (secondary) | Photo in about the left 62% (794 px). A rail on the right shows a large clock, the full date, current weather with high and low, a 3-day forecast, today's agenda, and the reflection |
| Night | Dimmed clock only |
| Schedule (America/Denver) | 6–7 AM: B. 7 AM–10 PM: A. 10 PM–6 AM: night. There is no evening mode |
| Touch | Day: swaps A and B. Night: wakes to the day view (A). After 10 idle minutes (configurable) it returns to the schedule. Touch only |
| Photos | One album in Stephen's Google Photos, read through the **Google Photos Picker API**. Stephen picks a set whenever he wants a change, and the Worker keeps cached copies. (Since 2025-03-31 the Library API can't read albums the app didn't create, so it isn't an option.) |
| Calendar | His Google Workspace calendar via the Calendar API. The Worker holds the token, and the frame only receives the day's events |
| Weather | Open-Meteo for Denver. No key. Cached by the Worker |
| Reflection | The current week's reflection from Sage's monthly guide, shown on both A and B. It changes weekly. It is served **only** from an authenticated endpoint, never from a public page |
| Hosting | Stephen's Cloudflare account (the same one as Grokbot Hub) |

## 2. Assumptions about the frame (from the device plan)

- Kiosk: `com.wesbos.homehq` (from `dashboard/kiosk` in the reference repo). It opens one saved URL full
  screen (`--es url …`) and retries the page itself every 5 s. It doesn't retry the page's own
  requests. It has no JS bridge, no `alert()`, and no pop-ups.
- Android System WebView **106.0.5249.126**.
- Trusted CA roots ISRG Root X1, GTS Root R1 and GTS Root R4 are installed. Without them, HTTPS to a
  Cloudflare custom domain may fail (`net_error -202`). Phase 6 has a gate for this.
- The frame's clock syncs over NTP (boot fixes), and its time zone is set to America/Denver. The page
  still computes the schedule in America/Denver explicitly (§8).
- About 1 GB of RAM, a slow ARMv7 CPU, and OpenGL ES 2.0. The kiosk with the sample dashboard used
  about 80 MB.
- Gestures: a two-finger hold for 1.5 s is reserved by the kiosk menu. Use **single taps only**.

## 3. Reference implementation: what to reuse and what to change

Reference: `wesbos/photo-frame-dashboard` @ `0bff55e` (MIT). Credit it in the code headers we adapt.

**Reuse**
- `dashboard/vite.config.js` targets: `build.target: 'chrome106'`, `cssTarget: 'chrome61'`. The
  chrome61 CSS target stops the minifier from emitting 4- and 8-digit hex colors, which the frame rejects.
- Plain-JS, no-framework approach. Keep the bundle in the low hundreds of KB at most.
- The ideas from `docs/building-for-the-frame.md`: cached `Intl.DateTimeFormat`, a minute-resolution
  clock updated once a minute, repainting only what changed, a daily `location.reload()`, `no-cache`
  `index.html` with hashed assets, and backoff retries.
- Portrait handling from `js/slideshow.js` (`blurfill` + `fitimg`). Use a **pre-blurred small image**,
  not a live CSS `filter: blur()` on a large layer.
- Their deployment shape: a Vite build served as Workers static assets (`wrangler.jsonc` `assets`).
- The kiosk app and its URL-saving commands (`scripts/set-kiosk-url.sh`), unchanged.

**Change or drop**
- Drop the mock data (`js/data.js`) and the multi-view app (agents, tasks, shopping, control, calendar
  views, `diag.js`).
- Drop the Ken Burns effect (`.kb` with random transforms). Infinite or long animations cost about one
  core on this CPU. Use one short opacity crossfade per photo change, and nothing else should move.
- Their Worker serves static files only. We add a Worker API (`/api/*`, `/admin/*`) with
  authentication, cron triggers, R2 and KV.
- Their time zone default is `America/New_York`. Ours is America/Denver, set explicitly in code.

## 4. Architecture

```
 Phone/desktop (Stephen)                         Cloudflare (one Worker: smart-frame)
 ───────────────────────                         ─────────────────────────────────────
 /admin  ──(Cloudflare Access, Stephen only)──▶  admin routes ── Google OAuth (Calendar, Picker)
   "Pick new photos" → opens Google Photos           │                    │
   Picker on the phone                               ▼                    ▼
                                                  KV: FRAME_KV        R2: FRAME_PHOTOS
 Box agent (reflection publisher)                  - oauth:* (encrypted) - sets/<setId>/<n>.jpg
   PUT /admin/api/reflection ──(publish token)──▶  - cache:weather       - sets/<setId>/<n>.blur.jpg
                                                   - cache:calendar
 Frame (kiosk, WebView 106)                        - reflection:guide
   GET /  (static shell, no data)                  - photos:manifest
   GET /api/* ──(device bearer token)──────────▶   - device:<id>
   <img src="/p/…?exp&sig"> (signed URLs) ────▶    cron: */10 weather, */5 calendar
```

- **One Worker** called `smart-frame`. It serves static assets (the frame shell and the admin page) and
  routes `/api/*`, `/p/*` and `/admin/*` to code (`assets.run_worker_first` for those prefixes).
- Hostname: proposed `frame.sredden.com` as a Workers Custom Domain (open question Q1). Adding it is a
  DNS change, which needs Stephen's OK through Chief.
- The frame shell (HTML/JS/CSS) is not sensitive. All personal data comes only from authenticated
  endpoints.

## 5. Repo layout

```
smart-frame/
├── README.md
├── PLAN.md
├── package.json              # npm workspaces: frame, worker; scripts: build, test, check, deploy
├── .browserslistrc           # frame JS: "chrome 106"; CSS lint also checked against chrome 61 hex rule
├── .github/workflows/
│   ├── ci.yml                # PRs and pushes: install, lint, compat-check, unit + worker tests, build
│   └── deploy.yml            # push to main, gated by vars.DEPLOY_ENABLED == 'true'
├── frame/                    # what the kiosk loads (Vite, plain JS)
│   ├── index.html
│   ├── vite.config.js        # target chrome106, cssTarget chrome61, BUILD_ID define
│   ├── src/
│   │   ├── main.js           # boot: read token (§7.1), start loops
│   │   ├── schedule.js       # pure state machine (§8), no DOM
│   │   ├── idle.js           # touch handling + monotonic idle timer
│   │   ├── api.js            # fetch with bearer, backoff, last-good cache in localStorage
│   │   ├── version.js        # build polling → safe reload (§12)
│   │   ├── screens/{a.js,b.js,night.js}
│   │   └── widgets/{clock.js,weather.js,agenda.js,reflection.js,photos.js}
│   ├── styles/{base.css,a.css,b.css,night.css}
│   └── public/icons/         # static SVG weather icons (no SMIL, no animation)
├── worker/
│   ├── wrangler.jsonc        # bindings: FRAME_KV, FRAME_PHOTOS, assets, crons, vars (no secrets)
│   └── src/
│       ├── index.js          # router + scheduled() handler
│       ├── auth/device.js    # bearer token → SHA-256 → KV lookup
│       ├── auth/access.js    # Cf-Access-Jwt-Assertion check (JWKS + AUD), fail closed
│       ├── auth/publish.js   # reflection publisher token
│       ├── crypto.js         # AES-GCM for refresh tokens, HMAC for signed photo URLs
│       ├── google/oauth.js   # auth URL, callback, refresh, revoke
│       ├── google/calendar.js
│       ├── google/picker.js  # sessions, poll, list, ingest batches
│       ├── weather.js        # Open-Meteo fetch + normalize
│       ├── reflection.js     # store guide JSON, pick current week
│       ├── photos.js         # manifest, signed URLs, /p/* streaming from R2
│       └── admin/            # admin API handlers
├── admin/                    # static admin page (served under /admin, behind Access)
├── tools/
│   ├── compat-check.mjs      # scans dist/ for banned CSS/JS (§10)
│   ├── reflection-extract.mjs# guide HTML → reflection JSON (§9.4); runs off-repo on private input
│   └── new-device-token.mjs  # prints a token once + its hash for KV
├── test/
│   ├── unit/                 # vitest: schedule, idle, formatters, reflection week picker, extractor
│   ├── worker/               # vitest + @cloudflare/vitest-pool-workers: routes, auth, crons
│   ├── fixtures/             # SYNTHETIC guide HTML, calendar and Open-Meteo samples. No real content
│   └── e2e/                  # Chromium 106 screenshots at 1280×800 (§10)
└── docs/
    ├── runbook-pairing.md    # set kiosk URL with token, rotate, revoke
    ├── runbook-photos.md     # how to pick a new set
    ├── runbook-reflection.md # monthly publish
    └── runbook-deploy.md
```

`.gitignore` covers `.dev.vars`, `.wrangler/`, `dist/`, `node_modules/`, and `*.local.*`. CI runs
`gitleaks` (the same tool as habitat).

## 6. Storage

| Data | Store | Key or object | Why |
| --- | --- | --- | --- |
| Photo copies (display-sized JPEG, at most 1280×800) | **R2** `smart-frame-photos` | `sets/<setId>/<nnn>.jpg` | Binary blobs, cheap, and a set of a few hundred photos fits well inside the free 10 GB. Streamed through the Worker, so the bucket is never public |
| Blurred backdrop for portrait photos (small, e.g. 64×40) | R2 | `sets/<setId>/<nnn>.blur.jpg` | Fetched from Google with a small `w`/`h` and blurred on the frame by upscaling (cheap). Avoids a large live blur |
| Active photo manifest | **KV** `FRAME_KV` | `photos:manifest` → `{setId, items:[{n,w,h,orient,takenAt?}], updatedAt}` | Small, read-heavy, written rarely. One key swap makes a new set active atomically |
| Ingest job state | KV | `photos:job:<sessionId>` | Lets ingest resume in batches (§7.4) |
| Google refresh tokens | KV, **AES-256-GCM encrypted** with the `TOKEN_ENC_KEY` secret | `oauth:calendar`, `oauth:photos` | The Worker can't write its own secrets at runtime. Encrypting means a KV dump alone is useless |
| Access-token cache | KV (TTL 50 min) | `oauth:<grant>:access` (encrypted) | Avoids a refresh on every call |
| Weather cache | KV | `cache:weather` → normalized JSON + `fetchedAt` | Cron-filled. The frame never calls Open-Meteo |
| Calendar cache | KV | `cache:calendar:<yyyy-mm-dd>` → minimal event list + `fetchedAt` | Cron-filled. Stale data is served on Google errors |
| Reflection guide | KV, **encrypted** with the same key | `reflection:guide` → guide JSON (§9) | Private text, so it's encrypted at rest like tokens, never logged, and never in R2 or the repo |
| Devices | KV | `device:<id>` → `{tokenHash, name, createdAt, lastSeen, build}` | Token hashes only. Heartbeat updates `lastSeen` at most every 10 min to stay well under KV write limits |
| Build id | Worker var (set at deploy) | `BUILD_ID` | Used for version polling |

**Why not D1:** the data is a handful of keys with no relations or queries. KV plus R2 is simpler and
free. Revisit only if multi-device or history features show up. KV is eventually consistent (up to
about 60 s), which is fine for all of these.

**Free-tier budget check:** about 1 frame poll a minute (version + data, combined into one
`/api/state` call) is 1,440 requests a day. Photos are about 1 a minute (~1,440 a day). Crons are
about 430 runs a day. All of that is far under 100k requests a day. KV writes: crons (~430 a day) plus
heartbeat (~144 a day), under the free 1,000 a day. **Keep the calendar cron at every 5 min and
weather at every 10 min for this reason.** CI asserts this budget in a test that counts scheduled writes.

## 7. Authentication

### 7.1 Frame → Worker: per-device bearer token

- `tools/new-device-token.mjs` creates 32 random bytes (base64url) and prints the token **once**, plus
  `device:<id>` JSON with `tokenHash = SHA-256(token)`. The admin page can do the same
  (`POST /admin/api/devices`).
- **Pairing:** save the kiosk URL as `https://frame.sredden.com/#d=<id>.<token>` (the device plan's
  `set-kiosk-url.sh`). The **fragment is never sent to the server**, so it doesn't appear in Cloudflare
  logs. On boot, `main.js` copies it to `localStorage`, then `history.replaceState` removes it from the
  URL. Later loads read `localStorage`. If that's empty, the saved kiosk URL still has the fragment.
- Every `/api/*` call sends `Authorization: Bearer <id>.<token>`. The Worker looks up `device:<id>` and
  compares the hashes in constant time. A missing or unknown token gets **401 with no body detail**
  (fail closed).
- **Photos:** `<img>` tags can't send headers, so `/api/state` returns **signed URLs**:
  `/p/<setId>/<n>.jpg?exp=<unix>&sig=<HMAC-SHA256(URL_SIGNING_KEY, path|exp|deviceId)>`, valid for
  2 h. `/p/*` checks the signature and expiry and streams from R2 with `Cache-Control: private, max-age=3600`.
- **Rotation:** create a new token, re-save the kiosk URL over USB ADB, then delete the old
  `device:<id>`. Planned yearly, or right away on suspicion of a leak.
- **If the token leaks:** whoever holds it can read today's events, the weather, the current
  reflection, and the current photo set, but **cannot** reach admin, the OAuth grants, or other days.
  Response: delete `device:<id>` in KV (takes effect within about 60 s), re-pair, and check
  `lastSeen`/IP in Workers Logs. A per-token rate limit (about 120 req/min) applies.
- **Why not a Cloudflare Access service token:** it needs `CF-Access-Client-Id/Secret` headers on every
  request, including page and image loads. The kiosk's `loadUrl` can't attach those to subresources
  without changing the kiosk app, and we don't want to fork the APK. Access is used for admin instead
  (§7.2).

### 7.2 Stephen → admin: Cloudflare Access

- An Access application on `frame.sredden.com/admin*` with a Stephen-only policy (his two addresses,
  the same team as Grokbot Hub). That covers the OAuth callback, the Picker flow, device management
  and status.
- The Worker **also** validates `Cf-Access-Jwt-Assertion` against the team JWKS and this app's AUD
  (`ACCESS_AUD` var) and refuses if it's missing or invalid. This is the same fail-closed pattern as
  hub-private.

### 7.3 Google OAuth (Calendar + Picker)

- One Google Cloud project (`smart-frame`) with a **Web** OAuth client. Redirect URI:
  `https://frame.sredden.com/admin/oauth/callback`. Stephen does these console steps himself, and the
  plan gives him exact click-steps in `docs/`.
- Two separate grants, so either one can be re-consented or revoked on its own:
  - `calendar`: scope `https://www.googleapis.com/auth/calendar.events.readonly`. Use
    `calendar.readonly` only if we need the calendar list, for example to pick from several calendars (Q3).
  - `photos`: scope `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
- The flow is `access_type=offline`, `prompt=consent`, and a `state` value bound to an HttpOnly,
  `SameSite=Lax` cookie (CSRF), with PKCE. The callback swaps the code for tokens, encrypts the refresh
  token with `TOKEN_ENC_KEY`, and stores it in `oauth:<grant>`. The token is never logged.
- Refresh on demand, caching the access token for 50 min. On `invalid_grant`, mark the grant
  `needsReconsent` and show it on `/admin`. The frame keeps showing cached data, plus a small "calendar
  paused" hint.
- **Publishing status risk:** an External app in **Testing** status gets refresh tokens that expire
  after **7 days**. Options: (a) make the project **Internal** under the Workspace org, which only
  works if both grants use Workspace accounts; (b) switch the External app to **In production**
  unverified, for personal use with a warning screen on consent. Decide in Q2/Q11.
- Revoke: `/admin` has a "Disconnect" button per grant that calls Google's revoke endpoint and deletes
  the KV key.

### 7.4 Picker session flow (from a phone or desktop, not the frame)

1. Stephen opens `/admin` on his phone, which passes Access, and taps **Pick new photos**.
2. The Worker `POST https://photospicker.googleapis.com/v1/sessions` returns `{id, pickerUri,
   pollingConfig}`. The admin page shows a **link** (append `/autoclose`) and a **QR code** for
   desktop-to-phone handoff.
3. Stephen opens the album in Google Photos' picker UI and selects photos. **The Picker can't be
   pre-filtered to one album, so he has to browse to it.**
4. The admin page polls `GET /admin/api/picker/<id>` at `pollingConfig.pollInterval`. The Worker calls
   `sessions.get` until `mediaItemsSet == true`, or stops at `timeoutIn`.
5. **Ingest in batches**, because free-plan Workers allow 50 subrequests per invocation. The admin page
   calls `POST /admin/api/picker/<id>/ingest?cursor=…` repeatedly. Each call:
   - lists one page of `mediaItems?sessionId=…`;
   - keeps only `image/*` items (videos are skipped and counted);
   - fetches `baseUrl=w1280-h800` and `baseUrl=w64-h40` **with the OAuth bearer header** (base URLs
     expire after 60 min, so ingest finishes within the session);
   - writes `sets/<newSetId>/…` to R2;
   - saves its progress in `photos:job:<id>`.
6. On completion it writes the new `photos:manifest` (an atomic swap), deletes the Picker session
   (`DELETE /v1/sessions/<id>`), and deletes the previous set's R2 objects **only after** the new
   manifest is live. Deleting R2 objects in our own bucket is part of normal operation, not user data
   deletion.
7. Cap: `PHOTO_SET_MAX` (default 300, Q7). The Picker's own `maxItemCount` is set to the same value.
8. If ingest fails halfway, the old set stays active. The job can be resumed or discarded from `/admin`.

**Policy check before Phase 4:** re-read the current Google Photos APIs terms on keeping copies of
picked media, which the cache needs. If they forbid long-term caching, fall back to refreshing copies
each time a session is opened, and record the decision in PLAN.md.

## 8. Layout and schedule state machine

A pure module, `frame/src/schedule.js`, with no DOM or timers, unit-tested exhaustively.

```
scheduled(denverMinutes):
  if m >= 22:00 or m < 06:00 → NIGHT
  if m < 07:00               → B
  else                       → A

state = { override: null | 'A' | 'B', lastTouchMono: number | null }

screen(now, state):
  if state.override and (mono() - lastTouchMono) < IDLE_MS → state.override
  else → scheduled(denverMinutes(now))          # override expired: back to schedule

onTap(now, state):
  shown = screen(now, state)
  next  = shown == NIGHT ? 'A'                  # night wake → day view
        : shown == 'A'   ? 'B' : 'A'            # day: swap
  return { override: next, lastTouchMono: mono() }
```

- `IDLE_MS` defaults to 10 min and is configurable with `?idle=` and a Worker var (`IDLE_MINUTES`)
  delivered in `/api/state`, so it can be tuned without a rebuild.
- `denverMinutes` uses a cached `Intl.DateTimeFormat('en-US', {timeZone:'America/Denver', hour:'2-digit',
  minute:'2-digit', hourCycle:'h23'})`, so it's correct even if the frame's time zone setting drifts.
  DST transitions get explicit tests: 2026-11-01 and 2027-03-14.
- Idle time is measured with `performance.now()` (monotonic), as the reference repo advises. On
  `visibilitychange`, or when the wall clock jumps more than 2 min (NTP fix after boot), recompute
  immediately.
- Behavior at a boundary while overridden: the override holds until the idle timer expires, then the
  screen follows the schedule. For example, a tap at 6:55 that shows A stays on A, and then at 7:05
  it's still A because A is scheduled.
- A second tap at night while woken swaps A and B, the same as daytime (Q6 can change this).
- Taps: listen to `pointerup` / `touchend` with a single touch point. Ignore multi-touch so the kiosk's
  two-finger menu still works. Debounce 400 ms. Leave the bottom-left 96×72 px clear on night and A
  screens in case the kiosk's optional Menu button is enabled.
- Rendering: the three screens are prebuilt DOM subtrees that are toggled with `display`. A switch
  repaints only the incoming screen's widgets.
- **Night screen:** black background, clock at about 35% opacity, minute updates only, and a ±8 px
  position shift every 10 min to avoid burn-in. The page **can't dim the backlight** (no bridge).
  Real backlight dimming would need a frame-side change, which is Q5. Photos stop loading at night.

**Photo rotation:** shuffle the manifest once a day with a seeded shuffle, so the order is stable
across reloads. Advance every `PHOTO_INTERVAL` (default 60 s, Q7) with a single 600 ms opacity
crossfade. Preload the next image, and keep at most 2 `<img>` in the DOM. Portrait photos are fitted
and centered over their blurred backdrop.

## 9. Data endpoints and content

### 9.1 `/api/state` (device auth), polled every 60 s with backoff

```json
{ "build": "<BUILD_ID>", "serverTime": "...", "config": {"idleMinutes": 10, "photoIntervalSec": 60},
  "weather": {...}, "calendar": {...}, "reflection": {...},
  "photos": {"setId": "...", "items": [{"url": "/p/...sig", "blurUrl": "...", "orient": "l"}], "expiresAt": "..."} }
```

Each block carries its own `fetchedAt` and `stale` flag. Photo URLs are re-signed on every response.

### 9.2 Weather (Open-Meteo, no key)

- A cron (`*/10 * * * *`) calls `GET https://api.open-meteo.com/v1/forecast?latitude=39.74&longitude=-104.99
  &current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min
  &temperature_unit=fahrenheit&timezone=America%2FDenver&forecast_days=4`, using Denver city-center
  coordinates and no home address.
- Normalize to `{now:{tempF,code,isDay,label}, today:{hi,lo}, next3:[{dow,hi,lo,code}]}`. The weather
  codes (WMO) map to a static SVG icon set and a short label ("Partly cloudy").
- On failure, keep the last value. Mark it stale after 1 h, and hide the forecast after 6 h.

### 9.3 Calendar

- A cron (`*/5 * * * *`) calls `events.list` on the configured calendar (`CALENDAR_ID`, default
  `primary`, Q3) with `timeMin`/`timeMax` = today 00:00 to 24:00 America/Denver, `singleEvents=true`,
  `orderBy=startTime`, and `fields=items(summary,start,end,status,transparency,eventType)`.
- It keeps only `{title, start, end, allDay}`. Location, description, attendees and links are
  **dropped on the server**. Cancelled events are filtered out. Declined events and "free" events are
  open question Q4.
- The frame receives today's list. A shows "Next: <title>, <time>". B shows the agenda (up to about 5
  rows, then "+N more"). After the last event, A shows nothing in that row, unless Q4 decides to show
  tomorrow.

### 9.4 Weekly reflection (private)

**Real source format (observed, structure only):** Sage writes a monthly guide as one self-contained
HTML page, with `noindex`. It has an `<h1>` title, a `div.date` line with the guide's overall date
range, and a "Readings and weekly practice" section of five `div.week` blocks. Each block has an
`<h3>` of the form `Week N · <theme>` (the last one carries an end date, e.g. "(to Nov 25)"), an `<ol>`
of daily readings, and a `p.practice` paragraph with the week's practice. Per-week start dates are
**not** written explicitly. The guide lives in Stephen's private notes and is never in this repo.

**Publishing path:**
1. When Sage finishes a monthly guide, a box agent (Dev, on Sage's or Chief's handoff) runs
   `tools/reflection-extract.mjs <guide.html>` locally. It parses the structure above into:
   ```json
   { "guide": {"title": "...", "start": "2026-10-21", "end": "2026-11-25"},
     "weeks": [{"n": 1, "start": "2026-10-21", "end": "2026-10-27", "theme": "...", "practice": "..."}] }
   ```
   Week dates are derived as `start + 7·(n−1)`, and the last week ends at the explicit end date. The
   extractor **refuses** output if the dates don't tile the range, and prints a summary of week numbers
   and dates only, not the text, for review.
2. It sends that with `PUT /admin/api/reflection` using a separate **publish token**
   (`Authorization: Bearer`; the Worker stores only its hash in the `PUBLISH_TOKEN_HASH` secret). The
   box keeps the token in an env var. The token never goes in chat, git or logs.
3. The Worker encrypts and stores `reflection:guide`. `/api/state` returns only the **current
   week's** `{n, theme, practice?}`, chosen by today's Denver date. Q8 decides whether the practice text
   is shown or only the theme.
4. Gaps: if today falls outside every published week, show nothing in that slot (no error) and flag
   "reflection: no current week" on `/admin/status`.

**Privacy rules:** no reflection text in logs, errors, commit messages, test fixtures (fixtures are
synthetic lorem), Workers Analytics custom fields, or any public page. The public Grokbot Hub doesn't
link to it. Alternatives we considered and rejected for v1: having the Worker fetch from hub-private
with an Access service token couples the two projects; hand-entering on `/admin` is fine as a fallback
form on the same endpoint.

## 10. Chrome 106 compatibility

- **Build:** Vite `build.target: 'chrome106'`, `cssTarget: 'chrome61'`. `.browserslistrc` is
  `chrome 106`. Plain CSS, no Tailwind, so there's no `oklch()`/`color-mix()`.
- **Banned in source and dist**, enforced by `tools/compat-check.mjs` on `dist/**/*.{css,js,html}`, so
  CI fails on a match:
  - CSS: `oklch(`, `oklab(`, `color-mix(`, `:has(`, `@container`, `@property`, `dvh`/`svh`/`lvh`,
    native nesting (a `{` inside a rule block), 4- and 8-digit hex, `@starting-style`, `text-wrap`, and
    `backdrop-filter`;
  - JS: `toSorted`, `toReversed`, `toSpliced`, `.with(`, `Object.groupBy`, `Map.groupBy`, `Promise.withResolvers`,
    `Array.fromAsync`, and SMIL `<animate`
    in SVGs.
- **Linters:** `eslint-plugin-compat` and `stylelint-no-unsupported-browser-features` with browserslist
  `chrome 106`.
- **Real-engine smoke test:** `test/e2e` installs a pinned **Chromium 106 snapshot** with
  `@puppeteer/browsers` (Chrome for Testing starts at 113, so use a Chromium snapshot revision from the
  106 branch, pinned in Phase 1). It loads the built page at 1280×800, DPR 1, with mocked `/api/state`.
  For each screen (A, B, night) it asserts no console errors and saves screenshots as CI artifacts.
- **On-frame check (Phase 6):** `adb -d reverse tcp:5173 tcp:5173`, a kiosk VIEW intent with `--ez debug
  true`, and `chrome://inspect`. Check `CSS.supports` for anything new, then relaunch **without**
  debug.
- Budgets: JS ≤ 60 KB gzipped, CSS ≤ 15 KB, at most 1 running transition at a time, no infinite
  animations. `dumpsys meminfo` must stay ≤ 150 MB after 24 h.

## 11. Offline and error behavior

| Situation | Frame behavior |
| --- | --- |
| Boot before Wi-Fi | The shell may not load, and the kiosk retries every 5 s. Once loaded, it shows the clock right away (from the frame's clock) and the data slots from the `localStorage` last-good snapshot |
| `/api/state` fails | Exponential backoff from 5 s to 5 min with jitter. Keep showing the last good data. After 30 min stale, show a small grey "updated 42 min ago" under the affected block only |
| 401 | Stop polling data, show "Frame needs re-pairing" in the reflection slot, and retry every 15 min (it might be KV lag after rotation) |
| Photo 404 or expired signature | Skip to the next photo and refresh state early. If no photos load at all, show a solid dark background on A (the clock card still works) |
| Google token revoked | The Worker serves cached calendar data marked `stale`. `/admin` shows "Reconnect calendar" |
| Clock wrong at boot | Use `serverTime` from `/api/state` to detect drift over 2 min. Then show the server-corrected time (keep an offset) until NTP fixes it |
| Memory or slow leaks | A full `location.reload()` daily at 3:00 AM Denver (during night mode) |

## 12. Deploy and update flow

1. Edit the code, open a PR, and let `ci.yml` run lint, compat-check, unit and Worker tests, build, and
   the e2e screenshots.
2. Merge to `main`. `deploy.yml` runs only if the repo variable `DEPLOY_ENABLED == 'true'` (off until
   Phase 2 is approved, the same pattern as Grokbot Hub). It runs `npm ci && npm run build && wrangler
   deploy` with a **Worker-scoped** `CLOUDFLARE_API_TOKEN` (one key for this Worker, per decision D9)
   and `--var BUILD_ID:<git sha>`. Deploy output is filtered so file names and secrets don't appear
   in logs (reuse the hub's `deploy-worker.mjs` approach).
3. **Frame refresh:** `/api/state.build` is compared with the frame's compiled `BUILD_ID`. On a
   mismatch, the frame reloads at the next safe moment: no override active, not mid-crossfade, and at
   least 2 min after the last tap. Typically that's within a minute or two of deploy.
4. `index.html` is served `Cache-Control: no-cache`, and hashed assets `max-age=31536000, immutable`.
5. Rollback: `wrangler rollback`, or revert the commit and push. The frame follows the build id either
   way.
6. Secrets and KV are never touched by CI except via `wrangler secret put` run by hand, with Stephen's
   OK.

## 13. Observability

- `observability.enabled = true` in `wrangler.jsonc` (Workers Logs). Logs are **structured and
  content-free**: route, status, device id, duration, cache age, and Google error codes. Event titles,
  reflection text, photo ids, tokens and Google response bodies are never logged. A unit test feeds
  canary strings through every handler and asserts that they never reach `console.*`.
- Heartbeat: `/api/state` updates `device:<id>.lastSeen/build` at most every 10 min. The frame also posts
  `{uptimeSec, jsErrors[last 5, messages truncated to 120 chars], memoryHint}` once an hour to
  `/api/heartbeat`.
- `/admin/status` (Access) shows the last seen time, build, the cache age of each source, grant health
  (`ok` / `needsReconsent`), the photo set size and age, the reflection's current week number, and
  today's 401 count.
- Alerting is open question Q10. A cheap option is the existing Chief morning ops check reading a
  token-protected `/admin/api/health` summary (`{ok:true|false, problems:[codes]}`, no content).

## 14. Secrets inventory

Nothing in this table is committed. `wrangler.jsonc` lists only names and non-secret vars.

| Secret | Where it lives | Set by | Purpose |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_SECRET` | Worker secret | Stephen or Dev with OK (`wrangler secret put`) | OAuth code exchange (`GOOGLE_CLIENT_ID` is a plain var) |
| `TOKEN_ENC_KEY` | Worker secret (32 random bytes) | Dev, generated on the box, never printed | AES-GCM for refresh tokens and reflection data in KV |
| `URL_SIGNING_KEY` | Worker secret | Dev | HMAC for `/p/*` signed photo URLs |
| `PUBLISH_TOKEN_HASH` | Worker secret (SHA-256 of the publish token) | Dev | Reflection publishing |
| Publish token (raw) | Box env var / vault, not the repo, not chat | Dev | Used by the publisher on the box |
| Google refresh tokens | KV, encrypted | OAuth callback | Calendar and Picker access |
| Device token (raw) | Kiosk saved URL fragment + frame `localStorage` | Pairing over USB ADB | Frame auth. Only the hash is in KV |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Stephen (dashboard) | Worker-scoped deploy |
| `CLOUDFLARE_ACCOUNT_ID`, `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `ADMIN_EMAILS`, `CALENDAR_ID` | Repo variable / Worker vars | Dev | Not secret, but kept out of code as config |

If `TOKEN_ENC_KEY` is lost or rotated, re-consent both Google grants and re-publish the reflection.
There's no other recovery path, by design.

## 15. Testing and acceptance per phase

The checks are listed with each phase in §16. Across all phases:
- `npm test` covers unit tests (schedule including DST, idle, week picker, extractor on a **synthetic**
  guide, weather and calendar normalizers, signature verification).
- Worker tests use `@cloudflare/vitest-pool-workers` with Miniflare KV and R2. They prove that every
  `/api` and `/p` route returns 401 or 403 without valid credentials, and every `/admin` route without
  a valid Access JWT.
- `npm run check` runs compat-check plus the linters plus a bundle-size check.
- e2e runs the Chromium 106 screenshots.

## 16. Phases and effort

Effort means focused agent working time, not elapsed time. Steps marked **[S]** are Stephen's
dashboard or physical steps. Every item that creates a Cloudflare or Google resource, changes DNS, or
sets a secret needs Stephen's go through Chief.

| Phase | Scope | Effort | Acceptance |
| --- | --- | --- | --- |
| **P0 Setup** | Repo scaffold (workspaces, lint, CI without deploy, gitleaks, synthetic fixtures). **[S]** with OK: create the R2 bucket, KV namespace, Worker-scoped API token, Google Cloud project + OAuth client + consent screen. Decide Q1, Q2 and Q11 | 0.5 day + ~45 min [S] | CI green on an empty build. `wrangler.jsonc` validates. No secrets in git (gitleaks clean) |
| **P1 Frame shell (mock data)** | `schedule.js`, `idle.js`, screens A/B/night at 1280×800 matching the design page, clock/date, photo crossfade with local sample images, compat-check, Chromium 106 e2e | 1.5 days | Schedule tests pass (all boundaries, DST). Compat-check clean. Chromium 106 screenshots of A, B and night with no console errors. JS ≤ 60 KB gz |
| **P2 Worker core** | Router, static assets, device auth + pairing fragment, `/api/state`, weather cron, version polling + safe reload, Access-gated `/admin/status`, `deploy.yml` (gated) | 1 day | Unauthenticated `/api/*` → 401 and `/admin/*` → 403 (tests + live probe). Weather appears on a desktop Chrome at 1280×800. A redeploy triggers a reload within 2 min |
| **P3 Google OAuth + Calendar** | OAuth module (PKCE, state, encryption), calendar cron, field stripping, `needsReconsent` path | 1 day | **[S]** consents once. Today's events appear on B, and "Next" on A. Logs contain no titles (canary test). Revoke → stale flag shown, no crash |
| **P4 Photos via Picker** | Picker session UI (link + QR), batch ingest to R2, manifest swap, signed `/p/*` URLs, old-set cleanup, policy re-check (§7.4) | 1.5–2 days | **[S]** picks 20 photos from the album on his phone. All 20 appear on the frame shell. A bad or expired signature → 403. An interrupted ingest leaves the old set active |
| **P5 Reflection** | Extractor + tests (synthetic fixture), publish endpoint + hash token, encrypted store, current-week picker, display on A and B | 0.5–1 day | Extractor rejects malformed or non-tiling input. The real guide is published from the box (only week numbers and dates are shown in review). The right week appears for the current Denver date. Unauthenticated → 401. No text in logs or git |
| **P6 On the frame + soak** | Needs device plan §5 done (WebView 106, CA roots, kiosk). **[S]/Dev:** pair the kiosk URL over USB, on-frame checks (§10), 7-day soak | 0.5 day + 7 days elapsed | It loads over HTTPS on the frame. The schedule switches at 6:00, 7:00 and 22:00. Taps behave per §8. It survives an unplug/replug and a Wi-Fi outage. Memory ≤ 150 MB at 24 h. No stuck states during the soak |

**Total: about 6–7.5 agent days plus a 1-week soak**, with roughly 1–1.5 h of Stephen's time (Google
and Cloudflare console steps, consent, picking photos, the pairing session). P1 can start before any
account work.

## 17. Risks

| Risk | Likelihood / impact | Mitigation |
| --- | --- | --- |
| OAuth app in Testing status expires refresh tokens after 7 days | High if ignored / calendar and photos stop | Q2/Q11: Internal app, or External "In production" unverified. `needsReconsent` surfaced on `/admin` |
| Google Photos terms limit how long picked copies may be kept | Medium / redesign of caching | Policy re-check before P4. Fallback: refresh copies whenever a session is opened, with a shorter retention |
| HTTPS fails on the frame (missing roots, or the CA chosen for the edge certificate) | Medium / frame shows nothing | Device plan installs ISRG + GTS roots. P6 gate. If it still fails, use a `*.workers.dev` hostname (GTS, observed working) or pin the custom domain's certificate CA |
| Free-tier limits (50 subrequests per invocation, 1k KV writes a day) | Medium / ingest or cron failures | Batched ingest, write budget test, heartbeat throttling. A paid plan only with Stephen's OK |
| Device token leaks (anyone on the LAN can read the page source and localStorage via debugging) | Low / read-only exposure of today's data | Hash-only storage, quick revoke, rate limit, no admin reach. Debugging off on the frame |
| WebView quirks beyond the documented list | Medium / visual bugs | Chromium 106 e2e plus an on-frame check per phase that touches CSS |
| Burn-in from the static night clock and A's corner card | Low–medium | Position shift every 10 min. Optional backlight dim (Q5) |
| Private content leaking via logs, fixtures or commits | Low / high impact | Canary log test, synthetic fixtures only, gitleaks, a review rule: no reflection, calendar or photo content in PRs |
| The frame itself is insecure (Android 6, root `su`) | Known | Keep it on a trusted or IoT network with an egress allow-list (device plan §5.8). The frame holds only a read-only device token |

## 18. Open questions for Stephen

1. **Hostname:** `frame.sredden.com` (custom domain plus a DNS record) or the default `*.workers.dev`
   address?
2. **Google accounts:** which account holds the Photos album: the personal Gmail or the Workspace
   account? This decides whether the OAuth app can be Internal.
3. **Calendar(s):** only the primary Workspace calendar, or other calendars too (shared or family)?
4. **Calendar details:** show all-day events? Hide declined or "free" events? After the last event,
   show tomorrow's first event in A's "Next" row, or leave it empty?
5. **Night dimming:** is a dark page with a faint clock enough, or should the backlight really dim?
   Real dimming needs a frame-side change.
6. **Night wake:** after a tap wakes the frame to A, should a second tap swap to B, the same as during
   the day?
7. **Photos:** maximum set size (proposed 300), seconds per photo (proposed 60), shuffle or album order,
   and whether to show a date caption.
8. **Reflection display:** the week's theme only, or the theme plus the practice paragraph? Who
   triggers the monthly publish: Sage, Chief, or Dev on handoff?
9. **Reflection weeks:** the guide gives only an overall date range and the last week's end date.
   Confirm that weeks run 7 days from the guide's start date.
10. **Alerts:** if the frame goes offline or a Google grant breaks, should anyone be told (for example
    via Chief's morning ops check), or is the `/admin/status` page enough?
11. **OAuth publishing:** is it OK to set the Google OAuth app to "In production" unverified (you'd see
    an "unverified app" warning once at consent) if Internal isn't possible?
12. **Units and format:** °F and a 12-hour clock with AM/PM (as in the mockups)? Assumed yes.
