# smart-frame

A private dashboard for a 10.1" smart photo frame (PF1007L, 1280×800 landscape, Android 6 WebView 106),
hosted on Cloudflare Workers.

It shows only five things: photos picked from Google Photos, the clock and date, today's Google
Calendar events, Denver weather from Open-Meteo, and the current week's private reflection.

- Layout A, photo first: 7 AM–10 PM
- Layout B, split: 6–7 AM
- Dimmed clock: 10 PM–6 AM
- A touch swaps A and B during the day. At night the first touch wakes the screen and the second
  swaps A and B. After 10 idle minutes the frame goes back to its schedule.

**Status:** being built. Not deployed: deploys are off until the `DEPLOY_ENABLED` repo variable is set.
Runs on the Cloudflare Workers Free plan (D1 + KV, no R2) at the default `workers.dev` address.

## Develop

```sh
npm ci
npm test            # unit + Worker tests
npm run build       # frame + admin into frame/dist
npm run check       # Chrome 106 compat check + lint + bundle size
npm run dev:frame   # frame shell with mock data at http://localhost:5173/?mock=1
npx @puppeteer/browsers install chromium@1036826 --path test/e2e/.browsers   # once
npm run e2e         # Chromium 106 screenshots of A, B and night into test/e2e/out/
```

Runbooks for Chief and for operating the frame are in [docs/](docs/).

- Build plan, including the design decisions: [PLAN.md](PLAN.md) (see [§1 Design](PLAN.md#1-design-decisions-fixed))
- Design page (layout mockups and schedule): [Smart frame layout](https://cursor.com/canvas/store-593ad622-8000-409c-abb6-7c70dfc329fd/4e001d81-7509-463f-a5a4-a76cd8b088f3)
- Reference implementation: [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard) (MIT)

No secrets, tokens, personal content or reflection text go in this repo. See [PLAN.md §14](PLAN.md#14-secrets-inventory) for where each secret lives.
