# smart-frame build plan

Status: **building.** Written 2026-10-24. Stephen said go on 2026-10-24 and answered every open
question (§18, all resolved). Code is built and tested in this repo first. Creating Cloudflare or
Google resources, setting secrets, and deploying still need Stephen's console steps and OK (§16, P0).
No DNS changes and no spending, ever, for this project.

This plan is written so a coding agent can work through it phase by phase (§16). Every phase ends with
acceptance checks it must pass before the next phase starts.

---

## 0. Goals and non-goals

**Goals**
- Turn the PF1007L frame into an always-on private display with exactly five things: photos, clock and
  date, today's calendar, Denver weather, and this week's reflection.
- Run it unattended for weeks. It has to survive late Wi-Fi at boot, outages, and redeploys without
  anyone touching it.
- Keep it private. Calendar, photos and the reflection are served only to authenticated callers.
  Nothing personal goes in the repo, in logs, or on any public page.
- Host it on Stephen's existing Cloudflare account at $0 a month, on the Workers **Free** plan only:
  Workers, D1 and KV free allowances. **No R2** (it needs a payment method on file, §6).
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
| Night | Black screen with a faint clock. The page can't dim the backlight. `frame/src/backlight.js` is a no-op hook for later real dimming (not built) |
| Schedule (America/Denver) | 6–7 AM: B. 7 AM–10 PM: A. 10 PM–6 AM: night. There is no evening mode |
| Touch | Day: swaps A and B. Night: the first tap wakes to A, and the second tap swaps A and B. After 10 idle minutes (configurable) it returns to the schedule. Touch only |
| Photos | One album in Stephen's Google Photos, read through the **Google Photos Picker API**. Stephen picks a set whenever he wants a change, and the Worker keeps cached copies. (Since 2025-03-31 the Library API can't read albums the app didn't create, so it isn't an option.) The album is on the **personal Gmail account**. At most 300 photos, 60 s each, shuffled, with a small date caption |
| Calendar | Only the **primary** calendar of his **Workspace** account, via the Calendar API. The Worker holds the token, and the frame only receives today's and tomorrow's events. All-day events go on a top line. Declined and "free" (transparent) events are hidden. After the day's last event, "Next" shows tomorrow's first event |
| Weather | Open-Meteo for Denver. No key. Cached by the Worker |
| Reflection | The current week's **theme plus its short practice** from Sage's monthly guide, shown on both A and B. Weeks are 7-day blocks from the guide's start date. Chief publishes monthly with `tools/publish-reflection.mjs` (§9.4). It is served **only** from an authenticated endpoint, never from a public page |
| Hosting | Stephen's Cloudflare account (the same one as Grokbot Hub), Workers Free plan. **Default `workers.dev` address only**: Worker `amber-heron`, so the URL is `https://amber-heron.sredden.workers.dev`. No custom domain, no DNS. The name is deliberately neutral |
| Units | °F and a 12-hour clock with AM/PM |
| Alerts | Chief checks a token-protected health endpoint and emails Stephen if the frame has been offline for over 1 hour or a Google sign-in breaks (§13) |

## 2. Assumptions about the frame (from the device plan)

- Kiosk: `com.wesbos.homehq` (from `dashboard/kiosk` in the reference repo). It opens one saved URL full
  screen (`--es url …`) and retries the page itself every 5 s. It doesn't retry the page's own
  requests. It has no JS bridge, no `alert()`, and no pop-ups.
- Android System WebView **106.0.5249.126**.
- Trusted CA roots ISRG Root X1, GTS Root R1 and GTS Root R4 are installed. Without them, HTTPS may
  fail (`net_error -202`). `*.workers.dev` has been observed working on the frame (GTS). Phase 6 has a
  gate for this.
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
  authentication, a cron trigger, D1 and KV.
- Their time zone default is `America/New_York`. Ours is America/Denver, set explicitly in code.

## 4. Architecture

```
 Phone/desktop (Stephen)                         Cloudflare (one Worker: amber-heron, Free plan)
 ───────────────────────                         ────────────────────────────────────────────────
 /admin  ──(Cloudflare Access, Stephen only)──▶  admin routes ── Google OAuth (two grants, Picker)
   "Pick new photos" → opens Google Photos           │                       │
   Picker on the phone                               ▼                       ▼
                                                 D1: FRAME_DB             KV: FRAME_PHOTOS
 Chief (box)                                       - grants (encrypted)     - p:<setId>:<n>  (JPEG bytes)
   PUT /api/publish/reflection ─(publish token)─▶  - cache (weather, calendar)
   GET /api/health ─────────────(health token)──▶  - reflection (encrypted)
                                                   - photo sets + manifest rows
 Frame (kiosk, WebView 106)                        - devices, heartbeats, meta
   GET /  (static shell, no data)                cron: */5 (calendar every run, weather every 10 min)
   GET /api/* ──(device bearer token)──────────▶
   <img src="/p/…?exp&sig"> (signed URLs) ────▶
```

- **One Worker** called `amber-heron` at `https://amber-heron.sredden.workers.dev`. It serves static
  assets (the frame shell and the admin page) and routes `/api/*`, `/p/*` and `/admin*` to code
  (`assets.run_worker_first` for those prefixes).
- **No custom domain and no DNS** (decided 2026-10-24). The Worker name is neutral on purpose, so the
  URL doesn't say what it is. Preview URLs stay off (`preview_urls: false`).
- The frame shell (HTML/JS/CSS) is not sensitive. All personal data comes only from authenticated
  endpoints.
- Chief's two endpoints (`/api/publish/reflection`, `/api/health`) sit **outside** Access because a
  box script can't pass an Access login. Each has its own bearer token, stored in the Worker only as a
  SHA-256 hash.

## 5. Repo layout

```
smart-frame/
├── README.md
├── PLAN.md
├── package.json              # npm workspaces: frame, worker; scripts: build, test, check, deploy
├── .browserslistrc           # frame JS: "chrome 106"; CSS lint also checked against chrome 61 hex rule
├── .github/workflows/
│   ├── ci.yml                # PRs and pushes: install, lint, unit + worker tests, build, compat-check, e2e
│   └── deploy.yml            # push to main, gated by vars.DEPLOY_ENABLED == 'true' (unset = off)
├── frame/                    # what the kiosk loads (Vite, plain JS)
│   ├── index.html
│   ├── vite.config.js        # target chrome106, cssTarget chrome61, BUILD_ID define
│   ├── src/
│   │   ├── main.js           # boot: read token (§7.1), start loops
│   │   ├── schedule.js       # pure state machine (§8), no DOM
│   │   ├── idle.js           # touch handling + monotonic idle timer
│   │   ├── api.js            # fetch with bearer, backoff, last-good cache in localStorage
│   │   ├── version.js        # build polling → safe reload (§12)
│   │   ├── backlight.js      # no-op hook for future real dimming (§8)
│   │   ├── screens/{a.js,b.js,night.js}
│   │   └── widgets/{clock.js,weather.js,agenda.js,reflection.js,photos.js}
│   ├── styles/{base.css,a.css,b.css,night.css}
│   └── public/icons/         # static SVG weather icons (no SMIL, no animation)
├── worker/
│   ├── wrangler.jsonc        # bindings: FRAME_DB (D1), FRAME_PHOTOS (KV), assets, cron, vars (no secrets)
│   └── src/
│       ├── index.js          # router + scheduled() handler
│       ├── auth/device.js    # bearer token → SHA-256 → D1 lookup
│       ├── auth/access.js    # Cf-Access-Jwt-Assertion check (JWKS + AUD), fail closed
│       ├── auth/tokens.js    # publish + health bearer tokens (hash compare)
│       ├── db.js             # D1 schema bootstrap (idempotent) and helpers
│       ├── crypto.js         # AES-GCM for refresh tokens, HMAC for signed photo URLs
│       ├── google/oauth.js   # auth URL, callback, refresh, revoke
│       ├── google/calendar.js
│       ├── google/picker.js  # sessions, poll, list, ingest batches
│       ├── weather.js        # Open-Meteo fetch + normalize
│       ├── reflection.js     # store guide JSON, pick current week
│       ├── photos.js         # manifest, signed URLs, /p/* streaming from KV
│       ├── health.js         # /api/health for Chief
│       └── admin/            # admin API handlers
├── admin/                    # static admin page (served under /admin, behind Access)
├── tools/
│   ├── compat-check.mjs      # scans dist/ for banned CSS/JS (§10)
│   ├── reflection-extract.mjs# guide HTML → reflection JSON (§9.4); runs off-repo on private input
│   ├── publish-reflection.mjs# Chief's monthly publish CLI (extract + PUT)
│   └── check-health.mjs      # Chief's health check CLI
├── test/
│   ├── unit/                 # vitest: schedule, idle, formatters, reflection week picker, extractor
│   ├── worker/               # vitest + @cloudflare/vitest-pool-workers: routes, auth, crons
│   ├── fixtures/             # SYNTHETIC guide HTML, calendar and Open-Meteo samples. No real content
│   └── e2e/                  # Chromium 106 screenshots at 1280×800 (§10)
└── docs/
    ├── runbook-pairing.md    # set kiosk URL with token, rotate, revoke
    ├── runbook-photos.md     # how to pick a new set
    ├── runbook-reflection.md # monthly publish (Chief)
    ├── runbook-health.md     # Chief's health check and alert rules
    └── runbook-deploy.md
```

`.gitignore` covers `.dev.vars`, `.wrangler/`, `dist/`, `node_modules/`, and `*.local.*`. CI runs
`gitleaks` (the same tool as habitat).

## 6. Storage

**R2 is out.** Cloudflare's R2 docs say you must "complete the checkout flow to add an R2
subscription" before using R2, and that "a primary payment method is required to purchase Cloudflare
products". That holds even inside R2's free tier. This project is Free plan only with no payment
method, so we don't enable R2. The fallback is **D1 + KV**, both on the Workers Free plan with no
payment method:

| Data | Store | Key or table | Why |
| --- | --- | --- | --- |
| Photo copies (display-sized JPEG, at most 1280×800, ~150–300 KB) | **KV** `FRAME_PHOTOS` | `p:<setId>:<n>` | Values up to 25 MiB. 300 photos ≈ 60–90 MB of the free 1 GB. Each photo is written once per set (≤ 300 writes against the free 1,000 a day). Streamed through the Worker, never public |
| Blurred backdrop for portrait photos | D1 `photos.blur` | a tiny (32×20) JPEG as a data URL, ~1 KB | Upscaled on the frame, which blurs it for free. No extra KV write |
| Photo sets and manifest | **D1** `FRAME_DB` | `photo_sets`, `photos` | The active set is one row flag, so swapping sets is atomic |
| Ingest job state | D1 | `picker_jobs` | Lets ingest resume in batches (§7.4) |
| Google grants (refresh + access tokens) | D1 `grants`, **AES-256-GCM encrypted** with `TOKEN_ENC_KEY` | rows `calendar`, `photos` | Two separate grants with separate refresh tokens. A DB dump alone is useless |
| Weather and calendar caches | D1 `cache` | `weather`, `calendar:<yyyy-mm-dd>` | Cron-filled, with `fetched_at` and `ok_at`. Stale data is served on errors |
| Reflection guide | D1 `reflection`, **encrypted** | single row | Private text, encrypted at rest, never logged, never in the repo |
| Devices and heartbeats | D1 `devices` | `id`, `token_hash`, `last_seen`, `last_heartbeat`, `build` | Token hashes only |
| Health timestamps | D1 `meta` | `photo_sync_at`, `weather_ok_at`, … | Read by `/api/health` |
| Build id | Worker var (set at deploy) | `BUILD_ID` | Used for version polling |

**Why D1 for the small stuff:** KV's free tier allows only 1,000 writes a day, which the cron,
heartbeats and photo ingest would share. D1's free tier allows 100,000 rows written a day, so the cron
can record every fetch and the heartbeat can write freely. D1 is also strongly consistent, so a
revoked device or a new photo set takes effect at once. Photo bytes stay in KV because D1 rows are
capped at 2 MB and KV is built for blobs.

**Schema:** created by the Worker itself on first use (`CREATE TABLE IF NOT EXISTS`, once per isolate),
so deploys don't need D1 migration permissions on the deploy token.

**Free-tier budget check:** about 1 frame poll a minute (version + data in one `/api/state` call) is
1,440 requests a day. Photos are about 1 a minute (~1,440 a day). The single `*/5` cron is 288 runs a
day. All of that is far under 100k requests a day. KV writes: only photo ingest (≤ 300 per new set).
D1 writes: a few thousand rows a day at most. Cron triggers: 1 of the 5 the Free plan allows per
account (the hub Workers use none).

## 7. Authentication

### 7.1 Frame → Worker: per-device bearer token

  The admin page (`POST /admin/api/devices`) creates 32 random bytes (base64url), stores only
  `SHA-256(token)` in D1, and shows the token **once**.
- **Pairing:** save the kiosk URL as `https://amber-heron.sredden.workers.dev/#d=<id>.<token>` (the device plan's
  `set-kiosk-url.sh`). The **fragment is never sent to the server**, so it doesn't appear in Cloudflare
  logs. On boot, `main.js` copies it to `localStorage`, then `history.replaceState` removes it from the
  URL. Later loads read `localStorage`. If that's empty, the saved kiosk URL still has the fragment.
- Every frame `/api/*` call sends `Authorization: Bearer <id>.<token>`. The Worker looks up the device row and
  compares the hashes in constant time. A missing or unknown token gets **401 with no body detail**
  (fail closed).
- **Photos:** `<img>` tags can't send headers, so `/api/state` returns **signed URLs**:
  `/p/<setId>/<n>.jpg?exp=<unix>&sig=<HMAC-SHA256(URL_SIGNING_KEY, path|exp|deviceId)>`, valid for
  2 h. `/p/*` checks the signature and expiry and streams from KV with `Cache-Control: private, max-age=3600`.
- **Rotation:** create a new token, re-save the kiosk URL over USB ADB, then revoke the old device on
  `/admin` (a `revoked_at` flag, not a delete). Planned yearly, or right away on suspicion of a leak.
- **If the token leaks:** whoever holds it can read today's events, the weather, the current
  reflection, and the current photo set, but **cannot** reach admin, the OAuth grants, or other days.
  Response: revoke the device on `/admin` (D1, takes effect at once), re-pair, and check `last_seen`
  in Workers Logs. A per-token rate limit (about 120 req/min) applies.
- **Why not a Cloudflare Access service token:** it needs `CF-Access-Client-Id/Secret` headers on every
  request, including page and image loads. The kiosk's `loadUrl` can't attach those to subresources
  without changing the kiosk app, and we don't want to fork the APK. Access is used for admin instead
  (§7.2).

### 7.2 Stephen → admin: Cloudflare Access

- A self-hosted Access application on `amber-heron.sredden.workers.dev` paths `admin` and `admin/*`
  with a Stephen-only policy (his addresses, the same Zero Trust team as Grokbot Hub). Cloudflare
  documents hostname- and path-based Access for `workers.dev`. Don't use Worker-level Access ("protect
  this Worker"): it would lock the frame out too. That covers the OAuth callback, the Picker flow, device management
  and status.
- The Worker **also** validates `Cf-Access-Jwt-Assertion` against the team JWKS and this app's AUD
  (`ACCESS_AUD` var), checks the email is in `ADMIN_EMAILS` (a secret, so no addresses in the repo),
  and refuses if anything is missing or invalid. This is the same fail-closed pattern as
  hub-private.

### 7.3 Google OAuth (Calendar + Picker)

- One Google Cloud project with **one Web OAuth client**. Redirect URI:
  `https://amber-heron.sredden.workers.dev/admin/oauth/callback`. Stephen does the console steps
  himself from the P0 steps page.
- **Consent screen: External, In production (published), unverified.** External because the Photos
  album is on the personal Gmail. Published so refresh tokens don't expire after 7 days (Testing
  status does that). Stephen accepted the "Google hasn't verified this app" warning at consent.
- Two separate **grants**, each with its own refresh token, so either one can be reconnected or
  revoked on its own:
  - `calendar`: signed in as the **Workspace** account. Scope
    `https://www.googleapis.com/auth/calendar.events.readonly`, primary calendar only.
  - `photos`: signed in as the **personal Gmail**. Scope
    `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
- The flow is `access_type=offline`, `prompt=consent`, PKCE (S256), and a one-time `state` row in D1
  (10-minute expiry). The admin is behind Access, so the state row is the CSRF check. The callback
  checks that the granted scope matches the grant, swaps the code for tokens, encrypts the refresh
  token with `TOKEN_ENC_KEY`, and stores it in `grants`. Tokens are never logged.
- Refresh on demand, caching the encrypted access token until 5 min before expiry. On `invalid_grant`,
  mark the grant `needs_reconsent`. `/api/health` reports it, so Chief can email Stephen. The frame
  keeps showing cached data.
- Disconnect: `/admin` has a "Disconnect" button per grant that calls Google's revoke endpoint and
  clears the stored tokens (the row stays, status `disconnected`).

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
   - fetches `baseUrl=w1280-h800` (stored in KV) and, for portrait photos, `baseUrl=w32-h20` (stored
     as a data URL in D1), **with the OAuth bearer header**. Base URLs expire after 60 min, so ingest
     finishes within the session. At most 20 photos per call keeps it under 50 subrequests;
   - writes `p:<newSetId>:<n>` to KV and a `photos` row to D1;
   - saves its progress in `picker_jobs`.
6. On completion it marks the new set active in one D1 statement (an atomic swap) and deletes the
   Picker session (`DELETE /v1/sessions/<id>`). The previous set's KV keys get a 7-day expiration at
   swap time, so KV cleans them up by itself with no delete calls.
7. Cap: `PHOTO_SET_MAX` = 300. The Picker's own `maxItemCount` is set to the same value. A full
   300-photo set uses 300 of the 1,000 free KV writes a day; ingest refuses to start a second set the
   same day if the KV write budget would pass 900.
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
- At night, the first tap wakes to A and the second tap swaps A and B, the same as daytime (decided
  2026-10-24).
- Taps: listen to `pointerup` / `touchend` with a single touch point. Ignore multi-touch so the kiosk's
  two-finger menu still works. Debounce 400 ms. Leave the bottom-left 96×72 px clear on night and A
  screens in case the kiosk's optional Menu button is enabled.
- Rendering: the three screens are prebuilt DOM subtrees that are toggled with `display`. A switch
  repaints only the incoming screen's widgets.
- **Night screen:** black background, clock at about 35% opacity, minute updates only, and a ±8 px
  position shift every 10 min to avoid burn-in. The page **can't dim the backlight** (no bridge).
  `frame/src/backlight.js` exposes `setBacklight(level)` and is called on every screen change. Today it
  does nothing. Real dimming would need a frame-side change later (not built). Photos stop loading at
  night.

**Photo rotation:** shuffle the manifest once a day with a seeded shuffle, so the order is stable
across reloads. Advance every `PHOTO_INTERVAL` (60 s) with a single 600 ms opacity crossfade. A small
caption at the bottom-right shows the photo's month and year (e.g. "June 2019") when Google gives a
creation time. Preload the next image, and keep at most 2 `<img>` in the DOM. Portrait photos are fitted
and centered over their blurred backdrop.

## 9. Data endpoints and content

### 9.1 `/api/state` (device auth), polled every 60 s with backoff

```json
{ "build": "<BUILD_ID>", "serverTime": "...", "config": {"idleMinutes": 10, "photoIntervalSec": 60},
  "weather": {...}, "calendar": {"today": {"allDay": [...], "timed": [...]}, "tomorrowFirst": {...}},
  "reflection": {"n": 2, "theme": "...", "practice": "..."},
  "photos": {"setId": "...", "items": [{"url": "/p/...sig", "blur": "data:...", "orient": "p", "taken": "2019-06"}], "expiresAt": "..."} }
```

Each block carries its own `fetchedAt` and `stale` flag. Photo URLs are re-signed on every response.

### 9.2 Weather (Open-Meteo, no key)

- The `*/5` cron refreshes weather when the cached copy is 10 min old or more, calling `GET https://api.open-meteo.com/v1/forecast?latitude=39.74&longitude=-104.99
  &current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min
  &temperature_unit=fahrenheit&timezone=America%2FDenver&forecast_days=4`, using Denver city-center
  coordinates and no home address.
- Normalize to `{now:{tempF,code,isDay,label}, today:{hi,lo}, next3:[{dow,hi,lo,code}]}`. The weather
  codes (WMO) map to a static SVG icon set and a short label ("Partly cloudy").
- On failure, keep the last value. Mark it stale after 1 h, and hide the forecast after 6 h.

### 9.3 Calendar

- The `*/5` cron calls `events.list` on `primary` of the Workspace account (`calendar` grant) for today
  and tomorrow (00:00 to 24:00 America/Denver each), with `singleEvents=true`, `orderBy=startTime`,
  and `fields=items(summary,start,end,status,transparency,eventType,attendees(self,responseStatus))`.
- It keeps only `{title, start, end, allDay}`. Location, description, attendees and links are
  **dropped on the server**. Filtered out: cancelled events, events Stephen **declined**, "free"
  (**transparent**) events, and working-location events.
- **All-day events** go on a top line (A: one line above "Next"; B: a line above the agenda).
- A shows "Next: <title>, <time>". B shows the agenda (up to about 5 rows, then "+N more"). **After
  the day's last event**, "Next" shows tomorrow's first timed event as "Tomorrow 8:30 AM · <title>".

### 9.4 Weekly reflection (private)

**Real source format (observed, structure only):** Sage writes a monthly guide as one self-contained
HTML page, with `noindex`. It has an `<h1>` title, a `div.date` line with the guide's overall date
range, and a "Readings and weekly practice" section of five `div.week` blocks. Each block has an
`<h3>` of the form `Week N · <theme>` (the last one carries an end date, e.g. "(to Nov 25)"), an `<ol>`
of daily readings, and a `p.practice` paragraph with the week's practice. Per-week start dates are
**not** written explicitly. The guide lives in Stephen's private notes and is never in this repo.

**Publishing path:**
1. When Sage finishes a monthly guide, **Chief** runs `node tools/publish-reflection.mjs <guide.html>`
   on the box (doc: `docs/runbook-reflection.md`). It uses `tools/reflection-extract.mjs`, locally. It parses the structure above into:
   ```json
   { "guide": {"title": "...", "start": "2026-10-21", "end": "2026-11-25"},
     "weeks": [{"n": 1, "start": "2026-10-21", "end": "2026-10-27", "theme": "...", "practice": "..."}] }
   ```
   Weeks are **7-day blocks from the guide's start date** (decided 2026-10-24): week n starts at
   `start + 7·(n−1)`, and the last week ends at the explicit end date. The
   extractor **refuses** output if the dates don't tile the range, and prints a summary of week numbers
   and dates only, not the text, for review.
2. It sends that with `PUT /api/publish/reflection` using a separate **publish token**
   (`Authorization: Bearer`; the Worker stores only its hash in the `PUBLISH_TOKEN_HASH` secret). The
   box keeps the token in an env var. The token never goes in chat, git or logs.
3. The Worker encrypts and stores the guide in D1. `/api/state` returns only the **current week's**
   `{n, theme, practice}`, chosen by today's Denver date. Both the theme and the short practice are
   shown (decided 2026-10-24); long practice text is clamped to a few lines on screen.
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
| 401 | Stop polling data, show "Frame needs re-pairing" in the reflection slot, and retry every 15 min |
| Photo 404 or expired signature | Skip to the next photo and refresh state early. If no photos load at all, show a solid dark background on A (the clock card still works) |
| Google token revoked | The Worker serves cached calendar data marked `stale`. `/admin` shows "Reconnect calendar" |
| Clock wrong at boot | Use `serverTime` from `/api/state` to detect drift over 2 min. Then show the server-corrected time (keep an offset) until NTP fixes it |
| Memory or slow leaks | A full `location.reload()` daily at 3:00 AM Denver (during night mode) |

## 12. Deploy and update flow

1. Edit the code, open a PR, and let `ci.yml` run lint, compat-check, unit and Worker tests, build, and
   the e2e screenshots.
2. Merge to `main`. `deploy.yml` runs only if the repo variable `DEPLOY_ENABLED == 'true'`. It is
   **unset**, so deploys are off (the same pattern as Grokbot Hub). It runs `npm ci && npm run build &&
   wrangler deploy` with a deploy-only `CLOUDFLARE_API_TOKEN` (one key for this Worker, per decision
   D9) and `--var BUILD_ID:<git sha>`. Deploy output is filtered so file names and secrets don't appear
   in logs (reuse the hub's `deploy-worker.mjs` approach).
3. **Frame refresh:** `/api/state.build` is compared with the frame's compiled `BUILD_ID`. On a
   mismatch, the frame reloads at the next safe moment: no override active, not mid-crossfade, and at
   least 2 min after the last tap. Typically that's within a minute or two of deploy.
4. `index.html` is served `Cache-Control: no-cache`, and hashed assets `max-age=31536000, immutable`.
5. Rollback: `wrangler rollback`, or revert the commit and push. The frame follows the build id either
   way.
6. Secrets, D1 and KV are never touched by CI. Secrets are set by hand with `wrangler secret put`,
   with Stephen's OK.

## 13. Observability

- `observability.enabled = true` in `wrangler.jsonc` (Workers Logs). Logs are **structured and
  content-free**: route, status, device id, duration, cache age, and Google error codes. Event titles,
  reflection text, photo ids, tokens and Google response bodies are never logged. A unit test feeds
  canary strings through every handler and asserts that they never reach `console.*`.
- Heartbeat: `/api/state` updates the device's `last_seen` and `build`. The frame also posts
  `{uptimeSec, jsErrors[last 5, messages truncated to 120 chars]}` every 10 min to `/api/heartbeat`.
- `/admin/status` (Access) shows the last seen time, build, the cache age of each source, grant health
  (`ok` / `needsReconsent`), the photo set size and age, the reflection's current week number, and
  today's 401 count.
- **Alerting (decided 2026-10-24):** Chief checks `GET /api/health` with its own bearer token (the
  Worker stores only `HEALTH_TOKEN_HASH`) and emails Stephen if the frame has been offline for more than
  1 hour or a Google grant is broken. `tools/check-health.mjs` does the check, and
  `docs/runbook-health.md` documents it. The JSON has no personal content:
  ```json
  { "ok": false, "build": "<sha>", "now": "...",
    "frame": {"lastHeartbeat": "...", "ageMinutes": 75, "offline": true},
    "grants": {"calendar": {"status": "ok"}, "photos": {"status": "needs_reconsent"}},
    "photos": {"lastSync": "...", "count": 280},
    "weather": {"lastFetch": "...", "ageMinutes": 4},
    "calendar": {"lastFetch": "..."},
    "reflection": {"currentWeek": 2},
    "problems": ["frame_offline", "grant_photos_needs_reconsent"] }
  ```

## 14. Secrets inventory

Nothing in this table is committed. `wrangler.jsonc` lists only names and non-secret vars.

| Secret | Where it lives | Set by | Purpose |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_SECRET` | Worker secret | Dev with OK (`wrangler secret put`), value from Stephen via a masked secret request | OAuth code exchange (`GOOGLE_CLIENT_ID` is a plain var) |
| `TOKEN_ENC_KEY` | Worker secret (32 random bytes, base64) | Dev, generated on the box, never printed | AES-GCM for Google tokens and reflection data in D1 |
| `URL_SIGNING_KEY` | Worker secret | Dev, generated on the box | HMAC for `/p/*` signed photo URLs |
| `PUBLISH_TOKEN_HASH` | Worker secret (SHA-256 hex of the publish token) | Dev | Reflection publishing by Chief |
| `HEALTH_TOKEN_HASH` | Worker secret (SHA-256 hex of the health token) | Dev | Chief's health check |
| `ADMIN_EMAILS` | Worker secret (comma-separated) | Dev | Second check behind Access. A secret only to keep addresses out of the repo |
| Publish and health tokens (raw) | Chief's box env / vault, not the repo, not chat | Dev hands over via a masked secret request | Used by the two CLIs |
| Google refresh tokens | D1, encrypted | OAuth callback | Calendar and Picker access |
| Device token (raw) | Kiosk saved URL fragment + frame `localStorage` | Pairing over USB ADB | Frame auth. Only the hash is in D1 |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Stephen pastes it straight into GitHub | Deploy only |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Stephen | Not secret, kept out of code |
| `GOOGLE_CLIENT_ID`, `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, D1 and KV ids | `wrangler.jsonc` vars/bindings (placeholders until P0) | Dev | Not secret |

If `TOKEN_ENC_KEY` is lost or rotated, re-consent both Google grants and re-publish the reflection.
There's no other recovery path, by design.

## 15. Testing and acceptance per phase

The checks are listed with each phase in §16. Across all phases:
- `npm test` covers unit tests (schedule including DST, idle, week picker, extractor on a **synthetic**
  guide, weather and calendar normalizers, signature verification).
- Worker tests use `@cloudflare/vitest-pool-workers` with Miniflare D1 and KV. They prove that every
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
| **P0 Setup** | Repo scaffold (lint, CI without deploy, gitleaks, synthetic fixtures). **[S]**: create the D1 database and KV namespace, a deploy API token, the Google Cloud project + consent screen (External, In production) + Web OAuth client, and the Access app for `/admin`. No R2 | 0.5 day + ~45 min [S] | CI green on an empty build. `wrangler.jsonc` validates. No secrets in git (gitleaks clean) |
| **P1 Frame shell (mock data)** | `schedule.js`, `idle.js`, screens A/B/night at 1280×800 matching the design page, clock/date, photo crossfade with local sample images, compat-check, Chromium 106 e2e | 1.5 days | Schedule tests pass (all boundaries, DST). Compat-check clean. Chromium 106 screenshots of A, B and night with no console errors. JS ≤ 60 KB gz |
| **P2 Worker core** | Router, static assets, device auth + pairing fragment, `/api/state`, weather cron, version polling + safe reload, Access-gated `/admin/status`, `deploy.yml` (gated) | 1 day | Unauthenticated `/api/*` → 401 and `/admin/*` → 403 (tests + live probe). Weather appears on a desktop Chrome at 1280×800. A redeploy triggers a reload within 2 min |
| **P3 Google OAuth + Calendar** | OAuth module (PKCE, state, encryption), calendar cron, field stripping, `needsReconsent` path | 1 day | **[S]** consents once. Today's events appear on B, and "Next" on A. Logs contain no titles (canary test). Revoke → stale flag shown, no crash |
| **P4 Photos via Picker** | Picker session UI (link), batch ingest to KV + D1, set swap, signed `/p/*` URLs, old-set expiry, policy re-check (§7.4) | 1.5–2 days | **[S]** picks 20 photos from the album on his phone. All 20 appear on the frame shell. A bad or expired signature → 403. An interrupted ingest leaves the old set active |
| **P5 Reflection** | Extractor + tests (synthetic fixture), publish endpoint + hash token, encrypted store, current-week picker, display on A and B | 0.5–1 day | Extractor rejects malformed or non-tiling input. The real guide is published from the box (only week numbers and dates are shown in review). The right week appears for the current Denver date. Unauthenticated → 401. No text in logs or git |
| **P6 On the frame + soak** | Needs device plan §5 done (WebView 106, CA roots, kiosk). **[S]/Dev:** pair the kiosk URL over USB, on-frame checks (§10), 7-day soak | 0.5 day + 7 days elapsed | It loads over HTTPS on the frame. The schedule switches at 6:00, 7:00 and 22:00. Taps behave per §8. It survives an unplug/replug and a Wi-Fi outage. Memory ≤ 150 MB at 24 h. No stuck states during the soak |

**Total: about 6–7.5 agent days plus a 1-week soak**, with roughly 1–1.5 h of Stephen's time (Google
and Cloudflare console steps, consent, picking photos, the pairing session). P1 can start before any
account work.

## 17. Risks

| Risk | Likelihood / impact | Mitigation |
| --- | --- | --- |
| OAuth app in Testing status expires refresh tokens after 7 days | Resolved / — | External app set to In production (unverified). `needs_reconsent` surfaced on `/admin` and `/api/health` |
| Google Photos terms limit how long picked copies may be kept | Medium / redesign of caching | Policy re-check before P4. Fallback: refresh copies whenever a session is opened, with a shorter retention |
| HTTPS fails on the frame (missing roots) | Low / frame shows nothing | Device plan installs ISRG + GTS roots. `*.workers.dev` (GTS) was observed working. P6 gate |
| Free-tier limits (50 subrequests per invocation, 1k KV writes a day, 10 ms CPU) | Medium / ingest or cron failures | Batched ingest (20 photos per call), only photo bytes in KV, everything else in D1 (100k writes a day). No paid plan |
| R2 or any product that needs a card | — | Not used. D1 + KV only (§6) |
| `workers.dev` is reachable by anyone who learns the name | Low | Neutral name. Every data route needs a token or Access; the shell has no data |
| Device token leaks (anyone on the LAN can read the page source and localStorage via debugging) | Low / read-only exposure of today's data | Hash-only storage, quick revoke, rate limit, no admin reach. Debugging off on the frame |
| WebView quirks beyond the documented list | Medium / visual bugs | Chromium 106 e2e plus an on-frame check per phase that touches CSS |
| Burn-in from the static night clock and A's corner card | Low–medium | Position shift every 10 min. Backlight hook for later |
| Private content leaking via logs, fixtures or commits | Low / high impact | Canary log test, synthetic fixtures only, gitleaks, a review rule: no reflection, calendar or photo content in PRs |
| The frame itself is insecure (Android 6, root `su`) | Known | Keep it on a trusted or IoT network with an egress allow-list (device plan §5.8). The frame holds only a read-only device token |

## 18. Open questions: all resolved (Stephen, 2026-10-24)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Hostname | Default `workers.dev` only. No custom domain, no DNS. Neutral Worker name `amber-heron` → `https://amber-heron.sredden.workers.dev` |
| 2 | Google accounts | The Photos album is on the personal Gmail, so the OAuth app is **External** |
| 3 | Calendars | Only the primary calendar of the Workspace account. Two stored grants with separate refresh tokens, one OAuth client |
| 4 | Calendar details | All-day events on a top line. Hide declined and "free" events. After the last event, show tomorrow's first |
| 5 | Night dimming | Black screen with a faint clock now. A hook for real backlight dimming later, not built |
| 6 | Night wake | First tap wakes to A, second tap swaps A and B |
| 7 | Photos | At most 300, 60 s each, shuffled, small date caption |
| 8 | Reflection | Week theme plus the short practice. Chief publishes monthly via the private endpoint with a CLI script and doc |
| 9 | Reflection weeks | 7-day blocks from the guide's start date |
| 10 | Alerts | Chief emails Stephen if the frame is offline for more than 1 hour or a Google sign-in breaks, using the token-protected `/api/health` (§13) |
| 11 | OAuth publishing | Unverified-app warning is fine. App set to **In production** to avoid 7-day refresh-token expiry |
| 12 | Units | °F and a 12-hour clock |

Also decided while building (2026-10-24): **no R2**, because enabling it needs a payment method
(§6). Photo bytes go in KV, everything else in D1.
