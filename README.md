# smart-frame

A private dashboard for a 10.1" smart photo frame (PF1007L, 1280×800 landscape, Android 6 WebView 106),
hosted on Cloudflare Workers.

It shows only five things: photos picked from Google Photos, the clock and date, today's Google
Calendar events, Denver weather from Open-Meteo, and the current week's private reflection.

- Layout A, photo first: 7 AM–10 PM
- Layout B, split: 6–7 AM
- Dimmed clock: 10 PM–6 AM
- A touch swaps A and B during the day or wakes the screen at night. After 10 idle minutes the
  frame goes back to its schedule.

**Status:** planning only. Nothing is built or deployed yet.

- Build plan, including the design decisions: [PLAN.md](PLAN.md) (see [§1 Design](PLAN.md#1-design-decisions-fixed))
- Design page (layout mockups and schedule): [Smart frame layout](https://cursor.com/canvas/store-593ad622-8000-409c-abb6-7c70dfc329fd/4e001d81-7509-463f-a5a4-a76cd8b088f3)
- Reference implementation: [wesbos/photo-frame-dashboard](https://github.com/wesbos/photo-frame-dashboard) (MIT)

No secrets, tokens, personal content or reflection text go in this repo. See [PLAN.md §14](PLAN.md#14-secrets-inventory) for where each secret lives.
