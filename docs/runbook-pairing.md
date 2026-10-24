# Runbook: pair, rotate or revoke a frame

Each frame has its own device token. The Worker stores only the token's SHA-256.

## Pair

1. Open `https://amber-heron.sredden.workers.dev/admin` (Cloudflare Access sign-in).
2. Frames → name it → **Create pairing link**. The link is shown once and has the form
   `https://amber-heron.sredden.workers.dev/#d=<id>.<secret>`.
3. Set that link as the kiosk app's URL (over USB/ADB, per the device plan). Don't paste it into chat
   or email; it is a credential.
4. The frame stores the token, strips it from the address bar, and starts polling. `/admin` shows
   its last-seen time.

## Rotate

Create a new pairing link, set it on the frame, then revoke the old device.

## Revoke

`/admin` → Frames → **Revoke**. It takes effect immediately: `/api/*` returns 401 and signed photo
URLs for that device return 403.
