# Runbook: deploy

The Worker is `smart-frame` on `smart-frame.sredden.workers.dev`. No custom domain, no DNS. Free plan
only: D1 and KV, no R2 (R2 needs a payment method on file).

## One-time setup (Stephen, in the dashboards)

See the P0 steps document Dev sends. In short: create D1 `smart-frame-db` and KV
`smart-frame-photos`, put their ids in `worker/wrangler.jsonc`, create a deploy-only API token and
add it straight to GitHub repo secrets, set up Google OAuth and Cloudflare Access, then set the Worker
secrets with `wrangler secret put` (never in the repo or chat).

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

`npx wrangler rollback --config worker/wrangler.jsonc` (with a token that can deploy), or revert the
commit and let `deploy` run.
