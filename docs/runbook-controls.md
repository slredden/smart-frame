# Runbook: Controls (Home Assistant for Ring, Spotify)

A copy of PLAN-v2.md §11.9, the box side, plus the Worker side of phase H and P2. No secrets live here or
anywhere in git: the HA token and the Spotify client secret are GitHub secrets copied into the Worker by
`worker-secrets.yml`; the tunnel token, MQTT passwords and Ring token stay in root-only (or `sredden`-only)
files on `reddencloud`. `docs/controls-compose.yaml` is the repo copy of step 2's `compose.yaml`.

## Status (2026-10-24)

- §11.9 steps 1–11 are done. Step 11 (load check) passed 2026-10-24 8:36 PM MT: HA ~400 MiB, ring-mqtt
  176 MiB, mosquitto 3 MiB, under 1% CPU, swap 0, no OOM.
- Step 12 (tunnel + `cloudflared`) and PLAN-v2 §14 step 13 (Workers VPC Service) are gated until Chief
  sends them. Until then the frame's Controls screen shows "Cameras not connected" and `/api/health` has the
  soft code `controls_not_connected` (no alert).
- Spotify, Worker side: `/admin` › Spotify (connect, disconnect, "Reconnect Spotify by"), `GET /api/spotify/state`
  and `POST /api/spotify/{play,pause,next,prev,volume,transfer}` for the frame. Waits on
  `SPOTIFY_CLIENT_SECRET` (worker-secrets) and Stephen's Connect click.
- Cameras, Worker side: `GET /api/controls/state` (per-camera `updated`, outdoor first) and
  `GET /api/controls/cam/<c1–c4>` (streamed image) for the frame; `/admin` › Controls (HA status, "List cameras
  from Home Assistant", the 4-camera allowlist, the indoor switch). No `HA` binding is in `wrangler.jsonc` yet:
  the Worker detects it at runtime and answers "not connected" (200, `connected:false`) until it exists.
- Frame: the **Controls** screen is on (`features.controls`, rail button between Reflection and Settings).
  Spotify card on the left, 2×2 camera snapshots on the right. It polls `/api/spotify/state` and
  `/api/controls/state` every 5 s only while it's shown (not on Home, at night, after idle return or with the
  page hidden), and fetches a picture only when its `updated` changes. Without HA it shows "Cameras not
  connected"; without Spotify, "Connect Spotify on /admin". Settings › **Indoor cameras** (off by default;
  on: each tap shows one indoor camera for 30–60 s, 45 s default) covers again on timeout, leaving the screen,
  idle or night.

## Worker side

- **Binding.** The Worker reaches HA only through a Workers VPC binding named **`HA`**:

  ```jsonc
  // worker/wrangler.jsonc, added once the VPC Service exists (needs its service_id)
  "vpc_services": [{ "binding": "HA", "service_id": "<VPC service id>", "remote": true }]
  ```

  The VPC Service is http, host `127.0.0.1`, port 8123, over the `reddencloud` tunnel. No public hostname and
  no DNS records. The deploy token needs **Connectivity Directory Bind** to deploy a Worker with the binding
  (creating the service needs Connectivity Directory Admin). Without the binding, or without `HA_TOKEN`, the
  Worker treats HA as "not connected" and never errors.
- **Token.** `HA_TOKEN` is a long-lived token of the non-admin HA user `frame`. GitHub secret → `worker-secrets.yml`
  → Worker secret. Optional in `tools/set-worker-secrets.mjs` until it exists.
- **Calls.** GET only: `/api/config` (the `/admin` status line), `/api/states` filtered to `camera.*` (only when
  `/admin` asks to list cameras), `/api/states/<camera>` and `/api/camera_proxy/<camera>` for cameras on the
  `controls_cams` allowlist (edited on `/admin` › Controls). The Worker never calls an HA service.
- **Images** stream straight through (`Cache-Control: no-store, private`); nothing is stored in KV, D1 or a cache.
- **Indoor cameras** (marked "indoor" on `/admin`): refused (403) unless Settings › Indoor cameras is on, and
  even then only with `?reveal=1`, which the frame sends after a tap.
- **Logs** carry only the camera's short id and an HTTP status, never the entity id or token.

## Spotify

- App in Development mode, owned by Stephen (Premium). `SPOTIFY_CLIENT_ID` is a `wrangler.jsonc` var;
  `SPOTIFY_CLIENT_SECRET` is a GitHub secret copied by `worker-secrets.yml` (optional until set).
- Redirect URI: `https://smart-frame.sredden.workers.dev/admin/spotify/callback` (behind `/admin` Access).
- Connect on `/admin` › Spotify. Scopes: `user-read-playback-state user-modify-playback-state` only.
  P2.1 (Recent picker) also asks for the optional `user-read-recently-played playlist-read-private`. A grant
  from before P2.1 keeps working for playback; the Recent sheet says "Reconnect Spotify on /admin to see
  recent" and health shows the soft `spotify_recent_needs_consent` until Stephen reconnects once.
- **Recent picker (P2.1).** Controls › Recent opens "Play from Spotify": a Recent tab (up to 10 recently
  played playlists, albums or artists, 2×5, no scrolling; an item with no context counts as its album;
  podcasts skipped; topped up from playlists) and a Playlists tab (up to 20 of Stephen's playlists,
  scrolls). A tap plays it from the start on the active speaker, else the remembered one, else "not
  available" (409 `device_absent`); shuffle stays as last set. Spotify-owned playlists that dev mode
  refuses (404/403) are skipped. `GET /api/spotify/recent` caches 60 s in memory only (no KV or D1
  writes); 429 backs off per `Retry-After`. Art is Spotify's CDN only (CSP `img-src` allows
  `https://i.scdn.co`). Logs carry counts and statuses, never names or history. The sheet closes on an
  outside tap, Close, or 30 s idle.
- The refresh token expires 6 months after connecting. `/admin` shows "Reconnect Spotify by <date>", and
  `/api/health` adds `spotify_reauth_due` (alerting) from day 168.
- The frame remembers the last speaker by name (default "Stephen's Office"). If Spotify doesn't list it, the
  frame says so and never plays elsewhere. An idle Echo reappears after "Alexa, Spotify Connect".

## Health codes

Soft (no email): `controls_not_connected` (no `HA` binding or no `HA_TOKEN` yet), `controls_ha_unreachable`
(the last HA call failed; clears on the next one that reaches HA), `controls_no_cameras` (connected, but no
cameras mapped on `/admin` › Controls yet), `spotify_not_connected` (Spotify not connected on `/admin` yet, or `SPOTIFY_CLIENT_SECRET` not set),
`spotify_recent_needs_consent` (connected before P2.1; reconnect once on `/admin` › Spotify for the Recent picker).
Alerting: `spotify_reauth_due`, `grant_spotify_needs_reconsent` (Spotify refused the refresh token).

## The HA stack on `reddencloud` (PLAN-v2.md §11.9)

The host is the Plex box **`reddencloud`**. It now has a static address ending **`.24`**, outside the
DHCP range. There's no Omada DNS entry yet, so reach it as **`reddencloud.local`** (avahi/mDNS) or by the
`.24` address.

Host facts: Q23, plus Chief's update after the 2026-10-24 evening cleanup:

| Fact | Value | Against the floor (§11.2) |
| --- | --- | --- |
| OS | Ubuntu 24.04.3 LTS | Supported LTS |
| CPU | 2 cores | At the HA docs' 2 vCPU minimum, and **shared with Plex** |
| RAM | 7.5 GiB total, **6.9 GiB available, 0 swap used** (after the cleanup; was 3.4 GiB and 1.8 GiB swap) | ≥ 2 GB available: passes easily |
| Disk | 62 GB free on `/` | ≥ 10 GB: passes |
| Docker | 27.3.1; `sredden` is in the `docker` group | Engine ≥ 23.0.0: passes. **No Docker install step, and no `sudo` for `docker`** |
| Mode | Boots to `multi-user.target`: headless, SSH only | Good for a server |
| Cleanup | Removed: Nextcloud, multipass, lxd, Chrome Remote Desktop, samba. Disabled: cups, bluetooth, ModemManager, gnome-remote-desktop | Frees RAM and CPU for Plex + HA |
| Still running | NAS CIFS mount, Plex, Docker, NetworkManager | Expected |
| Failed units | Only `systemd-networkd-wait-online` | **Harmless. Don't chase it:** NetworkManager manages the network, not systemd-networkd |

**Resource plan.** Every container gets a memory cap with `memswap_limit` equal to `mem_limit`.
Per the Compose reference, that gives the container no swap. It also gets a hard `cpus` cap and a low
`cpu_shares` (256; the default is 1024), so Plex wins whenever both want the CPU. The caps are estimates,
and step 11 below checks them against `docker stats`.

| Container | Image (pinned) | `mem_limit` | `cpus` | Why that cap |
| --- | --- | --- | --- | --- |
| homeassistant | `homeassistant/home-assistant:2026.10.4` | **1g** | 1.0 | Enough for HA core + MQTT + four camera entities with the minimal recorder below. No Ring integration, no add-ons, no Bluetooth or USB. If HA is OOM-killed, it restarts (`unless-stopped`) and step 11 raises the cap to 1.25g |
| mosquitto | `eclipse-mosquitto:2.1.2-alpine` | 64m | 0.25 | Two clients and a few dozen topics. Mosquitto itself uses a few MB |
| ring-mqtt | `tsightler/ring-mqtt:5.9.3` | 384m | 0.5 | Node.js plus snapshot JPEGs. No live streams are used (RTSP port 8554 isn't published) |
| cloudflared | `cloudflare/cloudflared:2026.10.3` | 128m | 0.25 | One tunnel, a few requests a minute while Controls is open |

The caps total about 1.6 GiB against 6.9 GiB available, which leaves over 5 GiB for Plex and the page
cache. **HA's 1 GB cap stays.** It's about 2× what a lean HA Container uses. With this much headroom, it's
a guard against a leak, not a squeeze. If step 11 ever shows HA near the cap, raise it to 1.5g; that's
safe now.

The tags were checked on Docker Hub on 2026-10-24. Pull digests, for checking what's installed:
- HA `sha256:23f4dfbb…e133`
- Mosquitto `sha256:860aeb5d…bb0f`
- ring-mqtt `sha256:4a4e0db4…f00a`
- cloudflared `sha256:faa8e0a1…ff39`

Tags rather than digests sit in the file, so updates stay a one-word edit.

Compared with the HA docs' compose example, two things are deliberately left out:
- `privileged: true`
- the `/run/dbus` mount

The docs include them for USB radios and Bluetooth, and nothing here uses either.

**cloudflared: container, not a systemd service.**
- The systemd install (`cloudflared service install <token>`) puts the token in the unit's `ExecStart`,
  where `systemctl status` shows it (Cloudflare run-parameters docs). It also updates itself outside our
  version pin.
- The container is pinned, capped, and started and stopped with the rest of the stack. It reads
  `TUNNEL_TOKEN` from an env file only `sredden` can read (mode 600).
- The env file's value is visible to anyone with Docker access via `docker inspect`. On this box, that's
  only Stephen.
- It uses `network_mode: host`, so the VPC Service can point at `127.0.0.1:8123`.

**Plex contention and swap:**
- Plex keeps its default CPU weight, and the HA stack gets a low weight and hard caps. Everything here is
  idle except a light poll, and the cameras are fetched only while the Controls screen is open.
- **Prefer direct play in Plex.** Set clients to Original/Maximum quality. Two old cores can't transcode
  1080p and do much else.
- **ring-mqtt interval:** line-powered cameras snapshot every 30 s by default (Configuration-Details).
  If step 11 shows load, set the interval per camera to 60–120 s. The frame shows each image's age
  anyway.
- **Swap:** 0 used after the cleanup (was 1.8 GiB), so this is now a low risk.
  - Step 11 still watches `vmstat` `si`/`so`; near zero is fine.
  - The caps keep this stack out of swap.
  - If `docker info` warns "No swap limit support", the swap caps don't apply, so tell Chief.

**Files.** Everything lives under `/opt/smart-frame-ha` and is written by the commands below:
- `compose.yaml` (step 2; the repo copy `docs/controls-compose.yaml` is identical)
- `mosquitto/config/mosquitto.conf` (step 3)
- `mosquitto/config/passwd` (step 4)
- `ring-mqtt/config.json` (step 5)
- `cloudflared.env` (steps 5 and 12)
- HA's `configuration.yaml` (step 8)

Secrets are only:
- the two MQTT passwords, which are random and never shown except HA's, once, in step 10
- the tunnel token
- Ring's token, which ring-mqtt writes itself

Every secret file is readable only by root, or for `cloudflared.env` only by `sredden` (mode 600, or 700 for `passwd`), and none is ever committed.

`ring-mqtt/config.json` has this shape (ring-mqtt's minimal config). Step 5 fills in the password:

```json
{
  "mqtt_url": "mqtt://ringmqtt:<RINGMQTT_PASSWORD>@mosquitto:1883"
}
```

**The MQTT credentials go inside `mqtt_url`.** ring-mqtt 5.9.3 ignores separate `mqtt_user` /
`mqtt_pass` keys, so a config that uses them connects without auth and Mosquitto refuses it (fixed on
`reddencloud` 2026-10-24). The password is `openssl rand -hex` output, so it needs no URL escaping.
The file is written under `umask 077` (root-only).

**Stephen's commands, in order** (on `reddencloud`, in a terminal):

> **Run `sudo -v` first, before pasting any multi-line block.** It caches the sudo password for a few
> minutes. Otherwise a sudo password prompt that appears mid-paste swallows the lines pasted after it,
> and they never run (this happened on 2026-10-24). If a block was pasted over a prompt, re-run it.

```bash
sudo -v                                # cache sudo first, so no prompt eats pasted lines

# 1. Folders
sudo mkdir -p /opt/smart-frame-ha/{homeassistant,mosquitto/config,mosquitto/data,ring-mqtt}
cd /opt/smart-frame-ha
docker compose version                 # Compose v2 should print a version

# 2. compose.yaml (no secrets)
sudo tee /opt/smart-frame-ha/compose.yaml >/dev/null <<'EOF'
name: smart-frame-ha

x-logging: &logging
  driver: json-file
  options: { max-size: "10m", max-file: "3" }

services:
  homeassistant:
    container_name: homeassistant
    image: homeassistant/home-assistant:2026.10.4
    network_mode: host                 # HA listens on :8123
    environment:
      TZ: America/Denver
    volumes:
      - /opt/smart-frame-ha/homeassistant:/config
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
    stop_grace_period: 60s             # lets HA close its database (HA docs)
    mem_limit: 1g
    memswap_limit: 1g                  # equal to mem_limit = no swap
    cpus: 1.0
    cpu_shares: 256
    depends_on: [mosquitto]
    logging: *logging

  mosquitto:
    container_name: mosquitto
    image: eclipse-mosquitto:2.1.2-alpine
    ports:
      - "127.0.0.1:1883:1883"          # for HA on the host network only, not the LAN
    volumes:
      - /opt/smart-frame-ha/mosquitto/config:/mosquitto/config
      - /opt/smart-frame-ha/mosquitto/data:/mosquitto/data
    restart: unless-stopped
    mem_limit: 64m
    memswap_limit: 64m
    cpus: 0.25
    cpu_shares: 256
    logging: *logging

  ring-mqtt:
    container_name: ring-mqtt
    image: tsightler/ring-mqtt:5.9.3
    ports:
      - "55123:55123"                  # Ring login page; only runs while there's no token
    volumes:
      - /opt/smart-frame-ha/ring-mqtt:/data
    restart: unless-stopped
    mem_limit: 384m
    memswap_limit: 384m
    cpus: 0.5
    cpu_shares: 256
    depends_on: [mosquitto]
    logging: *logging

  cloudflared:
    container_name: cloudflared
    image: cloudflare/cloudflared:2026.10.3
    network_mode: host                 # reaches HA at 127.0.0.1:8123
    command: tunnel --no-autoupdate run
    env_file: /opt/smart-frame-ha/cloudflared.env   # TUNNEL_TOKEN=…, mode 600, never committed
    restart: unless-stopped
    mem_limit: 128m
    memswap_limit: 128m
    cpus: 0.25
    cpu_shares: 256
    logging: *logging
EOF

# 3. Mosquitto config: auth on, anonymous off
sudo tee /opt/smart-frame-ha/mosquitto/config/mosquitto.conf >/dev/null <<'EOF'
listener 1883
allow_anonymous false
password_file /mosquitto/config/passwd
persistence true
persistence_location /mosquitto/data/
log_dest stdout
EOF

# 4. Two random MQTT passwords (never printed), hashed in place by mosquitto_passwd -U
HA_MQTT_PW=$(openssl rand -hex 16); RING_MQTT_PW=$(openssl rand -hex 16)
printf 'homeassistant:%s\nringmqtt:%s\n' "$HA_MQTT_PW" "$RING_MQTT_PW" \
  | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/mosquitto/config/passwd'
docker run --rm -v /opt/smart-frame-ha/mosquitto/config:/mosquitto/config \
  eclipse-mosquitto:2.1.2-alpine mosquitto_passwd -U /mosquitto/config/passwd
sudo chown 1883:1883 /opt/smart-frame-ha/mosquitto/config/passwd
sudo chmod 0700 /opt/smart-frame-ha/mosquitto/config/passwd
printf '%s\n' "$HA_MQTT_PW" | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/ha-mqtt-password.txt'

# 5. ring-mqtt config (credentials inside mqtt_url; ring-mqtt 5.9.3 ignores mqtt_user/mqtt_pass),
#    and an empty tunnel env file (filled in at step 12)
printf '{\n  "mqtt_url": "mqtt://ringmqtt:%s@mosquitto:1883"\n}\n' \
  "$RING_MQTT_PW" | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/ring-mqtt/config.json'
unset HA_MQTT_PW RING_MQTT_PW
sudo install -m 600 -o "$USER" -g "$USER" /dev/null /opt/smart-frame-ha/cloudflared.env
printf 'TUNNEL_TOKEN=\n' > /opt/smart-frame-ha/cloudflared.env   # owned by you so docker compose can read it without sudo

# 6. Start everything except cloudflared, then check (no sudo: sredden is in the docker group;
#    if `id -nG` doesn't list docker, log out and back in once)
cd /opt/smart-frame-ha
sudo chown "$USER": cloudflared.env && chmod 600 cloudflared.env   # only needed if step 5 ran as first sent
docker compose pull
docker compose up -d homeassistant mosquitto ring-mqtt
docker compose ps                         # three containers running
docker compose logs --tail=50 mosquitto ring-mqtt
docker compose logs -f homeassistant      # wait until it settles, then Ctrl-C
```

7. **Onboarding:** from a computer on the home network, open **http://reddencloud.local:8123**, or the
   `.24` address on port 8123 if `.local` doesn't resolve. There's no Omada DNS entry yet, so plain
   `reddencloud` may not work. HA listens on all interfaces (host networking), so both work.
   - Create the owner account and keep its password in the password manager.
   - Home location: home. Time zone: America/Denver. Analytics: off.
8. **Recorder** (HA recorder docs):
   - Camera and image entities stay out of the database. Their state attributes carry short-lived
     access tokens, and nothing needs their history.
   - History is kept for 3 days.
   - Commits are batched every 30 s to cut disk writes.

   Add the snippet, then restart HA:

   ```bash
   sudo tee -a /opt/smart-frame-ha/homeassistant/configuration.yaml >/dev/null <<'EOF'

   recorder:
     purge_keep_days: 3
     commit_interval: 30
     exclude:
       domains:
         - camera
         - image
   EOF
   cd /opt/smart-frame-ha && docker compose restart homeassistant
   ```
9. **Ring login (2FA):** open **http://reddencloud.local:55123** (or the `.24` address), enter the Ring email and password, then the
   2FA code. Then run `docker compose logs --tail=50 ring-mqtt`, which should list the four cameras.
   The page stops once the token is saved in `ring-mqtt/ring-state.json`. Treat that file as a secret,
   since it's full Ring account access (ring-mqtt docs). It holds the **Ring refresh token**, so lock it
   down right after the login:

   ```bash
   cd /opt/smart-frame-ha && sudo chmod 600 ring-mqtt/ring-state.json
   ```
10. **MQTT integration:** HA › Settings › Devices & services › Add integration › **MQTT**.
    - Broker `127.0.0.1`, port `1883`, username `homeassistant`.
    - Password: run `sudo cat /opt/smart-frame-ha/ha-mqtt-password.txt`, paste it, then `clear`.
    - The four Ring cameras then appear as MQTT devices, each with a camera entity.
    - If a battery camera has no image yet, that's expected (§11.6).
11. **A day later, during a Plex transcode**, run:

    ```bash
    docker stats --no-stream
    free -h
    vmstat 5 6
    docker inspect -f '{{.Name}} OOM={{.State.OOMKilled}} restarts={{.RestartCount}}' \
      homeassistant mosquitto ring-mqtt
    ```

    Send Chief only the numbers. Pass:
    - HA under ~700 MiB
    - no `OOM=true`
    - `si`/`so` near 0
    - Plex playback smooth

    Otherwise:
    - raise HA's cap to 1.25g
    - set ring-mqtt to 60–120 s
    - prefer direct play

    **DONE: passed 2026-10-24 8:36 PM MT.** HA ~400 MiB, ring-mqtt 176 MiB, mosquitto 3 MiB, under 1% CPU,
    swap 0, no OOM. The caps stay as they are.
12. **Tunnel** (§14 step 13): paste the token without echoing it, then start cloudflared.

    ```bash
    read -rsp 'Tunnel token: ' T; echo
    printf 'TUNNEL_TOKEN=%s\n' "$T" > /opt/smart-frame-ha/cloudflared.env; unset T   # file is yours, mode 600 (step 5)
    cd /opt/smart-frame-ha && docker compose up -d cloudflared
    docker compose logs --tail=30 cloudflared   # look for "Registered tunnel connection"
    ```

    The VPC Service points at `127.0.0.1`, port 8123, http.
    - If the Worker gets HTTP 400 from HA: since HA 2026.8, reverse-proxy settings are set in the UI, at
      **Settings › System › Network › HTTP server**. Turn on "Trust X-Forwarded-For" and add `127.0.0.1`
      to Trusted proxies.

**Changing one MQTT user's password later** (e.g. `ringmqtt` or `homeassistant`). Update the existing
`passwd` file in place with `mosquitto_passwd -b`; don't rewrite the file, or the other user's entry is
lost. Then restore the owner and mode from step 4:

```bash
sudo -v
NEW_PW=$(openssl rand -hex 16)                     # never printed
docker run --rm -v /opt/smart-frame-ha/mosquitto/config:/mosquitto/config \
  eclipse-mosquitto:2.1.2-alpine mosquitto_passwd -b /mosquitto/config/passwd ringmqtt "$NEW_PW"
sudo chown 1883:1883 /opt/smart-frame-ha/mosquitto/config/passwd
sudo chmod 0700 /opt/smart-frame-ha/mosquitto/config/passwd
# For ringmqtt: rewrite mqtt_url with the new password (same umask 077 as step 5)
printf '{\n  "mqtt_url": "mqtt://ringmqtt:%s@mosquitto:1883"\n}\n' \
  "$NEW_PW" | sudo sh -c 'umask 077; cat > /opt/smart-frame-ha/ring-mqtt/config.json'
unset NEW_PW
cd /opt/smart-frame-ha && docker compose restart mosquitto ring-mqtt
```

For `homeassistant` instead: use `homeassistant` as the user above, skip the `config.json` lines, write
the new password to `ha-mqtt-password.txt` as in step 4, restart `mosquitto`, and update the password in
HA › Settings › Devices & services › MQTT › Reconfigure.

**Updates:** edit a tag in `compose.yaml` (`sudo` to edit, since it's root-owned), then run `docker compose pull && docker compose up -d`.

**`sudo docker …` from steps sent earlier still works.** It's just not needed now.
Chief proposes HA tag bumps monthly.

**Backup:** `/opt/smart-frame-ha` holds everything, including the Ring and MQTT secrets, so back it up
only to somewhere private.
