# smart-frame v2 plan: nav rail, Calendar, Photos, Controls

Status: **plan only** (2026-10-24). Builds on [PLAN.md](PLAN.md) (v1, shipped). Nothing here changes v1
decisions unless it says so. Effort means focused agent time, as in PLAN.md §16. **[S]** marks Stephen's
own steps. Every new Cloudflare or Google resource, secret, or consent needs Stephen's go through Chief.
The fixed rules still hold: free Cloudflare plan, no spend, no DNS or custom domain, nothing findable
publicly, and the frame holds no secret except its device token.

## 0. What v2 adds

| Screen | One line |
| --- | --- |
| **Home** | The v1 screens A, B and night, unchanged, with the same schedule and taps |
| **Calendar** | All calendars on the account, chosen by Stephen, shown as agenda, day or week |
| **Photos** | The photo set with controls: interval, order, captions, fit, pause/next/prev, favorite, hide |
| **House** | Lights, TV and media, Spotify, Ring snapshots, through Home Assistant (Phase 2) |

The fourth screen is called **House** (rail label "House"), not "Home", so it can't be confused with the
Home screen. Wes Bos's reference labels its control view "Home" next to "Today"; we don't copy that.

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

## 2. Navigation and the Home screen

### 2.1 Rail

- A left rail, 76 px wide by 800 px, four 72 px buttons (icon + 12 px uppercase label): **Home,
  Calendar, Photos, House**. House is hidden until Phase 2 ships (a `features.house` flag in
  `/api/state`).
- `frame/src/nav.js` (pure, unit-tested) holds `{view, lastTouchMono}` and exposes `go(view)`,
  `onIdle(nowMono)`. `main.js` toggles prebuilt view subtrees with `display` (as v1 does for A/B/night).
  Views other than Home are built on first visit and refreshed only when their data changes.
- Switch on `pointerup` with a single touch point, the v1 tap rule (PLAN.md §8), not on `pointerdown`:
  the v1 debounce and multi-touch ignore must keep working for the kiosk's two-finger menu.
- Inline SVG icons, no icon font. No transitions on the rail (one running transition max, §10).

### 2.2 How the rail meets the v1 rules (decision)

| Situation | Behaviour |
| --- | --- |
| Night (22–6), nothing touched | Night clock only. **No rail.** |
| Night, first tap | Wakes to Home A with the rail showing (v1: wakes to A) |
| Home, layout B (6–7, or after a swap) | Rail shows. B's photo shrinks from 794 px to 718 px wide; the right info rail is unchanged |
| Home, layout A (7–22) | Photo stays full-bleed. **Rail hidden**; the first tap on A shows the rail as an overlay for 30 s (`RAIL_PEEK_S`) *and* does nothing else. A tap on the photo while the rail shows swaps A→B as in v1 |
| Tap on a rail button | Navigates. It never counts as an A/B swap tap |
| Calendar, Photos, House | Rail always shows |
| Idle 10 min (`IDLE_MINUTES`, v1 value) anywhere | Back to **Home** at the scheduled layout (night if in the night window). One timer for both the A/B override and the view |

Why A hides the rail: A is "photo first" by Stephen's decision; a permanent 76 px bar breaks it. The cost
is one extra tap on A to reach the rail. This changes v1's "first tap on A swaps to B" into "first tap on
A peeks the rail" — **Open Question Q1** asks Stephen to confirm; the fallback is "rail always shows on A".

- Night → wake → navigate to Calendar → idle 10 min → night clock (if still in the window).
- At 22:00 while on Calendar and touched recently: stays until idle expires, then night (same as v1
  overrides).
- `IDLE_MINUTES` stays the one knob (Worker var, `?idle=`). The 30 s peek is a constant.

## 3. Calendar screen

### 3.1 Which calendars (selection)

v1 reads only the primary calendar, which is often empty; most events live on about 21 other calendars.
v1.1 (§7) adds selection
on `/admin`; v2 adds it on the frame.

- Source of truth: D1 table `calendars (id, summary, color, is_primary, selected, position, updated_at)`
  (created in v1.1). `color` is the calendar's `backgroundColor` from `calendarList`.
- The list is refreshed from Google only on demand (`/admin` "Load calendars" and a "Refresh list" button
  on the frame's selection sheet), never by the cron.
- Frame: a "Calendars" button at the top right of the Calendar screen opens a sheet with one row per
  calendar (color chip, name, checkbox). Changes are saved on "Done" with
  `PUT /api/calendars/selection` (device auth, same validation as the admin PUT: known ids only, at most
  25). Saving triggers one immediate calendar refresh.
- Default when nothing is selected: primary only (v1 behaviour).
- Each event carries its calendar's `color` (already in the v1.1 payload). Rows show a 4 px left bar in
  that color; week/day blocks use a 15% tint (computed in JS into `rgb()`; 8-digit hex is banned by §10).

### 3.2 Views

- **Agenda** (default): the next 14 days grouped by day, starting today. All-day events on the top line of
  each day ("All day · A · B" as v1). Empty days are skipped; if the 14 days are empty, show the v1.1
  look-ahead line ("Next: …") or "Nothing in the next 30 days".
- **Day**: one day, 6:00–22:00 grid (rows of 30 min, 44 px each, scrolls), all-day strip on top,
  prev/next day buttons. Overlaps are laid out in up to 3 side-by-side columns, then "+n".
- **Week**: 7 columns Mon–Sun, all-day strip, 7:00–21:00 grid, prev/next week. Titles truncate to one line.
- A segmented control (Agenda | Day | Week) and a "Today" button. The chosen view is a frame setting
  (§5) so it persists.
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

## 4. Photos screen

- Full photo area (1204 × 800 next to the rail) with a bottom toolbar that hides after 5 s:
  **Prev · Pause/Play · Next · ♥ Favorite · Hide · Settings**.
- Settings sheet (saved server-side, §5): interval (15 s, 30 s, 1 min, 2 min, 5 min; default 60 s, the v1
  value), order (shuffle daily | in picked order), captions on/off (month + year, v1), fit (fit with
  blurred backdrop, v1 default | fill/crop), "Favorites only" on/off.
- These settings drive Home A/B rotation too, so there is one photo behaviour everywhere.
- **Favorite / Hide**: columns `favorite INTEGER DEFAULT 0`, `hidden INTEGER DEFAULT 0` on `photos`
  (runtime `ALTER TABLE` guarded by a `meta` schema version; see §5). Hidden photos leave the manifest
  in `/api/state`; `/admin` Photos gets a "Hidden (n) · Unhide all" control. Hide asks for confirmation
  on the frame ("Hide this photo? Undo"), 5 s undo toast.
- Picking a new set keeps working from `/admin` (Picker API, v1). The frame never starts a Picker session.
- Pause holds the current photo until "Play" or idle return to Home.

## 5. Server-side settings

- D1 table `settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)` with JSON
  values. Keys: `photos` `{intervalSec, order, captions, fit, favoritesOnly}`, `calendar` `{view}`.
  Unknown keys and out-of-range values are refused (allowlist in `worker/src/settings.js`).
- `/api/state` gains `settings` (merged over defaults). The frame writes with
  `PUT /api/settings/:key` (device auth) and `/admin` gets a Settings section with the same fields.
- Writes go to **D1, not KV**: KV free is 1,000 writes/day and the photo ingest already uses up to 300 of
  them (v1 guard at 900). D1 free is 100,000 rows written/day; settings, favorites and hides are a few
  dozen a day.
- Schema changes follow the repo convention: `CREATE TABLE IF NOT EXISTS` in `db.js` `SCHEMA`; the two
  new `photos` columns use `ALTER TABLE … ADD COLUMN` run once, recorded as `meta.schema_version = 2`
  (ALTER has no IF NOT EXISTS in SQLite). Add both tables to `TABLES` in `test/worker/helpers.js`.

## 6. House screen (Phase 2) and Home Assistant

### 6.1 What can and can't be controlled (verified 2026-10-24)

| Gear | Path | Notes |
| --- | --- | --- |
| **Wemo plugs** (4 answer locally) | HA `wemo`, Local Push via pywemo | Belkin shut the Wemo cloud, app and **Alexa/Google integrations on 2026-01-31**; pywemo is local and unaffected. So Alexa control of Wemo should already have stopped → **Q6**. HA needs the plugs on its subnet (port 8989 inbound for push) |
| **Smart bulbs** (brand unconfirmed, maybe Philips) | **Hue**: HA `hue` via a Hue Bridge, Local Push. **Without a bridge**: depends on brand | Cloud-only bulbs (the scan shows a GE light and Tuya devices, both cloud) need a cloud integration or can't be controlled; that's a **risk**, decided per brand once identified (**Q5**, [S] task) |
| **Alexa** | Stays as it is, beside HA. **Not the control path** | No official Alexa control API for this use. The HACS `alexa_media_player` uses the unofficial Alexa API and breaks with Amazon changes. We don't depend on it |
| **Harmony Hub** `.109` | HA `harmony`, Local Push | Logitech stopped making Harmony in 2021; the hub keeps working locally. HA docs: some firmware needs "Enable XMPP" in the Harmony app. Activities (`remote.turn_on activity=…`) are the useful control |
| **Samsung TV** `.67` | HA `samsungtv`, Local Push | Turning on from off may need Wake-on-LAN, depends on model (**Q8**) |
| **Roku Streambar** `.61` | HA `roku`, Local Polling (ECP) | Power, volume, input, app launch |
| **Fire TV** `.76` | HA `androidtv` (ADB), Local Polling | The Android TV Remote integration does **not** work on Fire TV (HA docs). ADB is already enabled for the dumbtv work |
| **Google Cast** (`.104 .115 .132`, Fire TV) | HA `cast`, Local Polling | Play/pause/volume of what's casting. HA Container needs host networking for discovery |
| **Spotify** | HA `spotify` (cloud) | **Premium required** (Spotify requires Premium for the Developer Portal since Feb 2026). Controls only devices Spotify already knows (`source_list`) → **Q7** |
| **Ring** (doorbell, stickup, 4 cameras) | HA `ring`, Cloud Polling (60 s) | No official public Ring API; HA's integration is community-maintained on Ring's cloud, needs Ring login + 2FA, and can break. Live view is WebRTC through HA's frontend; we use **snapshots** (`/api/camera_proxy/<entity>`) refreshed every 10 s while the House screen is open. Battery cameras may return stale snapshots. Last-recording needs Ring Protect |

### 6.2 Where Home Assistant runs (decision)

**Home Assistant OS in a VM on the MIGUEL PC** (the home Windows PC that already runs 24/7). Reasons:
it's known to be always on and reachable for Chief's approved commands; HA OS gives add-ons
(cloudflared) and HACS without hand-built containers; the HA docs install path for Windows is a VM.
**ReddenNAS** is the better long-term host *if* its model can run a VM or Docker with host networking
(Cast and Wemo push need it); its model is unknown → **Q2**. Switching later is an HA backup/restore.
Either way HA must sit on the same LAN/VLAN as the Wemo plugs and TVs (the proposed IoT-VLAN split on
the Omada page would need mDNS/SSDP forwarding or static IPs).

### 6.3 How the frame reaches HA (decision)

The Worker can't reach the LAN, and the frame page (HTTPS on workers.dev) can't call `http://` LAN
addresses (mixed content) and mustn't hold an HA token. Options weighed:

| Option | Verdict |
| --- | --- |
| **A. Workers VPC Service over a Cloudflare Tunnel** — `cloudflared` on the HA host makes an outbound tunnel; a VPC Service registers `http://<ha-ip>:8123`; the Worker calls it through a `vpc_services` binding | **Chosen.** No public hostname, no DNS, no inbound port, HA never on the internet. Available on the Free plan and free during its open beta. Low latency (direct call per tap) |
| B. Tunnel with a public hostname (+ Access) | Rejected: needs a zone on Cloudflare (a DNS change/custom domain) and puts HA on a public name |
| C. Quick tunnel (`trycloudflare.com`) | Rejected: random public URL, no uptime guarantee |
| D. HA webhooks called by the Worker | Rejected: needs HA reachable from the internet (B) or Nabu Casa (paid); webhook IDs are bearer secrets |
| E. HA pulls commands from the Worker (automation or small script polling `/api/house/queue` every 3–5 s) | **Fallback** if Workers VPC changes terms: free and outbound-only, but 1–5 s lag and ~17–29k Worker requests/day of the 100k |
| F. Frame → HA directly on the LAN | Rejected: mixed content, and an HA token or webhook ID on the frame |

Security model for A:
- A dedicated **non-admin HA user `frame`** with a long-lived access token, stored only as a Worker
  secret `HA_TOKEN` (never in the frame, git or logs). Non-admin blocks HA's admin endpoints; HA has
  **no UI for per-entity permissions**, so the token can still call any service on any entity.
- Therefore **the Worker is the real gate**: D1 table `house_controls (id, kind, entity_id, label,
  room, position, actions_json)` configured on `/admin`, and `POST /api/house/:id/:action` (device auth)
  maps only allowlisted `(id, action)` pairs to fixed HA service calls (`light.turn_on/off`,
  `switch.turn_on/off`, `media_player.media_play_pause/volume_up/…`, `remote.turn_on activity=…`).
  No free-form service, entity or data from the frame. Locks, garage and alarm entities are refused by
  kind (house rule: garage off-limits).
- State: `GET /api/house` (device auth) is called every 5 s **only while House is visible**; the Worker
  reads the allowlisted entities from HA (`/api/states/<entity>`, ≤ 30 per call, under the 50
  subrequest cap) and returns `{id, state, brightness?, media?}`. Snapshots: `GET /api/house/cam/:id`
  proxies `/api/camera_proxy/<entity>` (no caching in KV; `Cache-Control: no-store`).
- Request budget: 5 s polling for, say, 30 min/day of House use ≈ 360 requests + taps. Negligible.

### 6.4 House screen layout

- Rooms as sections; tiles 160 × 120: light/plug tiles toggle on tap (optimistic flip, revert with a
  toast on error after 3 s, the reference's pattern); dimmable Hue lights get a long-press brightness
  sheet.
- **Media** card: per player (Roku, Fire TV, Samsung, Cast, Spotify) play/pause, prev/next, volume ±,
  and Harmony activities as buttons ("Watch TV", "Off").
- **Ring** card: a 2 × 2 grid of snapshots with "updated 8 s ago"; tap enlarges one.
- "HA offline" banner when the Worker can't reach HA; the rest of the frame is unaffected.

## 7. v1.1 (calendar selection, before v2)

Small, shippable on its own. **Built**: [PR #2](https://github.com/slredden/smart-frame/pull/2) on
`feat/v1.1-calendar-select` (not merged; main auto-deploys, merge waits for Chief's go).

- `/admin` → Calendars: "Load calendars from Google" (`calendarList.list`, `fields` trimmed), a checkbox
  list with Google color swatches, "Save selection" (≤ 25). First load selects primary only; nothing
  selected = primary (v1 behaviour). Saving refreshes the cache at once.
- Cron fetches each selected calendar (one `events.list` each, today → +30 days), merges, keeps each
  calendar's color, skips a failing calendar and keeps the old cache if all fail.
- Home info line / B agenda: when today has nothing left and tomorrow has no timed event, show the next
  event within 30 days ("Next: Tue, Nov 3, 9:00 AM · …") instead of going blank.
- D1 `calendars` table via the runtime schema (no migration to apply).
- **Consent: yes, a new consent is needed.** `calendarList.list` requires one of `calendar.readonly`,
  `calendar`, `calendar.calendarlist` or `calendar.calendarlist.readonly`; v1's
  `calendar.events.readonly` isn't enough. v1.1 adds the narrowest,
  **`https://www.googleapis.com/auth/calendar.calendarlist.readonly`**. Events on other calendars are
  already covered by `calendar.events.readonly` ("View events on all your calendars").
  [S] after deploy: optionally add the scope under Google Auth Platform → Data Access, then **Reconnect
  calendar** on `/admin`. Until then the frame keeps showing the primary calendar.
- Effort: ~3–4 agent hours (done), 5 min [S].
- Frame-side selection waits for v2 (§3.1).

## 8. Phases

| Phase | Scope | Effort | Acceptance |
| --- | --- | --- | --- |
| **v1.1** | §7 | 3–4 h (done, PR #2) + 5 min [S] | Unit + worker tests, lint, build, compat check, Chromium 106 e2e, gitleaks — all green on the PR. After deploy and reconnect: selected calendars' events appear on B; the look-ahead line appears on an empty day |
| **P1 Nav + Calendar + Photos + settings** | §2 rail + `nav.js`; §3 Calendar views, frame selection sheet, `/api/calendar`, full-window cache; §4 Photos screen, favorites/hide; §5 `settings` table, endpoints, `/admin` Settings; House hidden behind `features.house` | 2.5–3 days | `nav.js` unit tests (night wake, rail peek on A, rail tap ≠ swap, idle → Home at scheduled layout incl. night and DST dates 2026-11-01/2027-03-14). Worker tests: settings allowlist, selection PUT (device auth, cap, unknown id), `/api/calendar` slicing, hidden photos leave the manifest. `npm run test:unit`, `test:worker`, `lint`, `build`, `check` (Chrome 106 compat, JS ≤ 60 KB gz) green. Chromium 106 e2e screenshots for Home A (rail hidden + peeked), B, night, Calendar agenda/day/week, Photos with toolbar and settings sheet, no console errors. On-frame check (PLAN.md §10) of each screen. gitleaks clean |
| **H (prerequisite) Home Assistant** | [S] install HA OS VM, onboard, add integrations (§6.1) one by one, create `frame` user + token; agent writes `docs/runbook-house.md`; [S]/Chief create tunnel + VPC Service; Worker `vpc_services` binding + `HA_TOKEN` secret; a `/admin` "HA status" probe | 0.5 day agent + 2–4 h [S] (+ Ring 2FA, Spotify app) | `/admin` shows "HA reachable, version x" through the binding. HA has no public hostname (no DNS records added; a probe of the tunnel from the internet fails). Token appears nowhere but the Worker secret (gitleaks, log canary test) |
| **P2 House** | §6.3 allowlist table + `/admin` editor, `/api/house` state, actions, camera proxy; §6.4 screen; `features.house` on | 2–3 days | Worker tests with a mocked HA binding: non-allowlisted id/action → 403, lock/garage kinds refused, HA down → 503 + banner state, no HA token or entity names in logs. Unit tests for optimistic toggle/revert. Chromium 106 e2e of House (mock data). On the frame: toggle a Wemo plug and a light, run a Harmony activity, pause Spotify, see Ring snapshots refresh. Compat check, all prior tests, gitleaks green |

**Total**: ~5–6.5 agent days after v1.1, plus 2–4 h of Stephen's time (mostly HA setup).

## 9. Stephen's manual steps

1. **v1.1**: after merge/deploy, (optional) add `calendar.calendarlist.readonly` on the consent screen's
   Data Access page; click **Reconnect calendar** on `/admin`; load calendars and tick the ones to show.
2. **Identify the smart bulbs**: brand and model of each bulb/lamp (Alexa app → Devices shows the
   brand/skill), and **whether a Philips Hue Bridge exists** (a square or round white box wired to the
   router).
3. Say whether the Wemo plugs still respond to Alexa (they shouldn't since 2026-01-31).
4. Choose the HA host (MIGUEL PC VM by default, or ReddenNAS if its model supports VMs/Docker).
5. Install HA OS, create the owner account, add integrations: Wemo, Hue (press the bridge button),
   Harmony (enable XMPP if asked), Samsung TV (accept the prompt on the TV), Roku, Android Debug Bridge
   for Fire TV (accept the ADB prompt), Cast, Spotify (create a Spotify developer app; Premium needed),
   Ring (login + 2FA).
6. Create the non-admin HA user `frame` and its long-lived token; hand it to Chief to set as the Worker
   secret (never pasted in chat logs or files).
7. Create the Cloudflare Tunnel (cloudflared add-on on HA OS) and the Workers VPC Service in the
   dashboard (Chief can guide; needs Connectivity Directory Admin).
8. Pick which lights, players and cameras go on the House screen (`/admin` House editor).
9. Confirm Q1 (rail on Home A).

## 10. Open questions

- **Q1** Home A: rail hidden with a 30 s peek on first tap (proposed), or always visible?
- **Q2** ReddenNAS model and whether it can run a VM or Docker with host networking (else HA on MIGUEL).
- **Q3** Is MIGUEL the always-on Windows PC used for Omada/Fire TV work, and can it host a ~2 GB RAM VM
  24/7?
- **Q4** Calendar: is "no earlier than today" acceptable, or should day/week views show past days
  (needs on-demand fetches)?
- **Q5** Smart bulb brands/models and whether a Hue Bridge exists (cloud-only bulbs may not be
  controllable).
- **Q6** Do the Wemo plugs still work through Alexa today? (Belkin ended Alexa support 2026-01-31.)
- **Q7** Is the Spotify account Premium, and which speakers should be targets?
- **Q8** Samsung TV model (decides whether turn-on works or needs Wake-on-LAN), and is it the same set
  as the Fire TV Edition?
- **Q9** Which Ring cameras belong on the frame (all four, or front door only)?
- **Q10** Should the Harmony Hub stay in use, given Logitech no longer makes Harmony (fine locally
  today)?

## 11. Risks

- **Workers VPC is beta**: terms or pricing may change. Fallback E (HA polls the Worker) needs no
  Cloudflare beta feature.
- **Ring**: unofficial cloud integration, 2FA, can break; snapshots only.
- **Cloud-only bulbs**: may not be controllable from HA without a vendor cloud integration.
- **Harmony**: discontinued hardware; works locally until it doesn't.
- **Wemo**: no vendor support; a factory-reset plug needs pywemo setup to rejoin Wi-Fi.
- **CPU on the free plan**: 22-calendar merges and House state calls must stay under 10 ms CPU; measure
  in P1/P2 and back off cadence if needed.
- **Privacy**: calendar names, event titles and entity names must never reach logs, git, PRs or
  fixtures (synthetic fixtures only; log canary tests as in v1).

## 12. Sources (checked 2026-10-24)

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
