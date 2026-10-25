# Runbook: deploy

The Worker is `smart-frame` on `smart-frame.sredden.workers.dev`. No custom domain, no DNS. Free plan
only: D1 and KV, no R2 (R2 needs a payment method on file).

## One-time setup

Done in the dashboards on 2026-10-24 (P0 steps page): D1 `smart-frame-db` and KV `smart-frame-photos`
(ids in `worker/wrangler.jsonc`), a deploy-only API token pasted straight into the GitHub secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, the Google OAuth client (id in `wrangler.jsonc`),
and the Cloudflare Access app.

**Access app (verified by Chief, 2026-10-24):** destinations `smart-frame.sredden.workers.dev/admin`
and `/admin/*`; its AUD tag matches `ACCESS_AUD` in `wrangler.jsonc`; the policy allows exactly the two
addresses in the `ADMIN_EMAILS` secret. The Worker checks the Access JWT, the AUD and `ADMIN_EMAILS`
itself as well, so `/admin` stays closed if the Access app is ever changed or removed.

## Worker secrets

The Worker's secrets are GitHub Actions secrets first, then copied into the Worker by the manual
`worker-secrets` workflow. Dev never holds a Cloudflare token.

| GitHub secret | Made by |
| --- | --- |
| `URL_SIGNING_KEY`, `TOKEN_ENC_KEY` | Dev: random, piped into `gh secret set`, never printed |
| `HEALTH_TOKEN_HASH`, `PUBLISH_TOKEN_HASH` | Dev: SHA-256 hex of the two tokens; the raw tokens go to Chief by masked secret request |
| `ADMIN_EMAILS` | Dev: the two addresses in the Access policy (a secret only to keep them out of the repo) |
| `GOOGLE_CLIENT_SECRET` | Stephen's masked secret request lands on the box as `SMART_FRAME_GOOGLE_CLIENT_SECRET`; Dev pipes it into `gh secret set` |
| `HA_TOKEN` (optional) | Long-lived token of the non-admin HA user `frame` (Controls cameras). Stephen sets it himself |
| `SPOTIFY_CLIENT_SECRET` (optional) | The Spotify app's client secret (Controls). Stephen sets it himself. The client id is the `SPOTIFY_CLIENT_ID` var in `wrangler.jsonc` |

Pattern (never echo the value): `printf '%s' "$VALUE" | gh secret set NAME -R slredden/smart-frame`.

To copy them into the Worker, with Stephen's OK and **after the first deploy**: Actions → `worker-secrets`
→ Run workflow (on `main`). `tools/set-worker-secrets.mjs` checks every secret is present and well
formed, refuses with exit 3 if the `smart-frame` Worker doesn't exist yet (`wrangler secret bulk` would
otherwise create an empty one), then sends the six required ones plus whichever optional Controls secrets are set (`HA_TOKEN`,
`SPOTIFY_CLIENT_SECRET`; skipped while unset, never deleted) in one `wrangler secret bulk` call over stdin. It
prints names only. Re-run it after rotating any secret. The first deploy without secrets is harmless:
every route fails closed until they're set.

## Normal flow

1. Push a branch, open a PR, and let `ci` pass: lint, Chrome 106 compat check, unit and Worker tests,
   wrangler dry run, gitleaks, and Chromium 106 screenshots (artifact `e2e-screenshots`).
2. Merge to `main`. `deploy` runs only when the repo variable `DEPLOY_ENABLED` is `true`. It builds
   with `BUILD_ID` = the first 12 characters of the commit and deploys through
   `tools/deploy-worker.mjs`, which filters per-file lines from the log.
3. The frame sees the new build id on its next poll and reloads at a quiet moment.

## Local

```sh
nvm use               # Node 22
npm ci
npm run build && npm run check && npm test
npx @puppeteer/browsers install chromium@1036826 --path test/e2e/.browsers
npm run e2e           # screenshots in test/e2e/out/
npm run dev:frame     # then open http://localhost:5173/?mock=1  (&screen=a|b|night, &at=<ISO time>)
```

`puppeteer-core` is pinned to 19.x on purpose: newer versions hang launching Chromium 106.

## Rollback

Revert the commit and let `deploy` run, or `wrangler rollback` from a machine holding the deploy token
(Dev doesn't hold one).
