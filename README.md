# smart-frame

A private dashboard for a 10.1" smart photo frame (PF1007L, 1280×800 landscape, Android 6 WebView 106),
hosted on Cloudflare Workers.

v1 showed five things: photos picked from Google Photos, the clock and date, today's Google
Calendar events, Denver weather from Open-Meteo, and the current week's private reflection.

- Home, 6 AM–10 PM: the photo on the left, and the clock, weather, agenda and reflection on the right
- Dimmed clock: 10 PM–6 AM
- At night a touch wakes the frame to Home. After 10 idle minutes it goes back to its schedule.
- v1.2 (2026-10-24) removed v1's full-bleed layout A and the A/B tap swap. The v2 screens and menu rail
  are planned in [PLAN-v2.md](PLAN-v2.md).
- v2 P1 (2026-10-24): tapping Home's weather or agenda opens the Weather (24 h, 10 days) or Calendar
  (Agenda, Day, Week) screen; a tap on empty space on any screen shows the menu rail, which hides 10 s after the last touch. Settings (schedule, night dim,
  idle timeout, weather place, calendars) live in D1 and can be changed on the frame or on /admin.
  Screens not built yet stay off the rail (`features` in `/api/state`).
- v2 P1b (2026-10-24): Tasks (Google Tasks, up to 10 lists, check-off with a 10 s undo, "Due today" on
  Home), alerts (event banners before events, a 9 AM tasks banner, an optional chime, quiet at night),
  the Reflection screen (this week, this guide, recent guides) and the Photos screen (pause, next,
  favorite, hide, interval, order, fit, captions). See [docs/runbook-tasks.md](docs/runbook-tasks.md).

**Status:** deployed on every push to `main` (see [docs/runbook-deploy.md](docs/runbook-deploy.md)).
Runs on the Cloudflare Workers Free plan (D1 + KV, no R2) at the default `workers.dev` address.

## Develop

```sh
npm ci
npm test            # unit + Worker tests
npm run build       # frame + admin into frame/dist
npm run check       # Chrome 106 compat check + lint + bundle size
npm run dev:frame   # frame shell with mock data at http://localhost:5173/?mock=1
npx @puppeteer/browsers install chromium@1036826 --path test/e2e/.browsers   # once
npm run e2e         # Chromium 106 screenshots and tap tests of every screen into test/e2e/out/
```

Runbooks for Chief and for operating the frame are in [docs/](docs/).

- Build plan, including the design decisions: [PLAN.md](PLAN.md) (see [§1 Design](PLAN.md#1-design-decisions-fixed))
- Design page (layout mockups and schedule): [Smart frame layout](https://cursor.com/canvas/store-593ad622-8000-409c-abb6-7c70dfc329fd/4e001d81-7509-463f-a5a4-a76cd8b088f3)
- Reference implementation: [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard) (MIT)

No secrets, tokens, personal content or reflection text go in this repo. See [PLAN.md §14](PLAN.md#14-secrets-inventory) for where each secret lives.
