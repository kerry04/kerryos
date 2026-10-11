# KerryOS MVP — bring-up runbook (Phase 1 scaffold)
One visitor at a time boots a real, disposable Linux desktop (XFCE, Win7-themed)
in their browser. Track A: one Docker container per session on brain 67 —
no KVM (unavailable on this shape, verified in the spec). Budget: $0/mo.

```
visitor -> Caddy (443) -> /guac/* -> Guacamole -> guacd -> VNC 5901 -> guest container
                       -> /api/*  -> session broker -> Docker socket (spawns guest)
guest container -> Squid :3128 (allowlist enforced OUTSIDE the guest) -> internet
```

Layout: `guest/` (desktop image) · `gateway/` (compose + Guacamole + Caddy + scripts) ·
`broker/` (session API) · `egress/` (Squid + nftables + verify script) ·
`frontend-snippet/` (standalone boot/viewer prototype for the Phase 3 portfolio merge).

Full architecture: `../kerryos-mvp/KERRYOS_MVP_SPEC.md`.

## 0. Prerequisites (brain 67, Ubuntu 24.04 ARM64)

```bash
# Step 0 — the virtualization check. EXPECTED: no /dev/kvm (confirms Track A).
ls -la /dev/kvm 2>&1; grep -E -c 'vmx|svm' /proc/cpuinfo

# Docker + resources
docker --version            # need 24+
free -g                     # expect ~12 GB total
df -h / | tail -1           # want 10+ GB free for images
```

Install Docker if missing (https://docs.docker.com/engine/install/ubuntu/),
then: `sudo usermod -aG docker $USER` and re-login.

## 1. Secrets — .env

```bash
cd ~/workspace/kerryos   # or wherever you cloned this
cp .env.example .env
# Generate real values (do this on brain 67, never paste them anywhere):
python3 - <<'EOF'
import secrets
for name in ("POSTGRES_PASSWORD", "GUAC_ADMIN_PASSWORD", "BROKER_ADMIN_TOKEN"):
    print(f"{name}={secrets.token_urlsafe(32)}")
EOF
# Paste the three values into .env, and set:
#   PORTFOLIO_DOMAIN=kerryos.sokoresult.com   (HUMAN_FILL — your call)
#   ACME_EMAIL=you@example.com                (HUMAN_FILL)
# Leave GUAC_CONNECTION_ID for step 4. .env is gitignored; never commit it.
```

## 2. Build the images

```bash
# Guest desktop (the per-session machine). ~5-10 min on first build.
docker build -t kerryos/guest:latest ./guest
# Broker + squid build from ./broker and ./egress via compose (next step).
```

## 3. Start the gateway stack

```bash
cd gateway
./scripts/init-db.sh          # one-time: generates guacamole/initdb.sql from the image
docker compose up -d --build  # postgres, guacd, guacamole, squid, broker, caddy
docker compose ps             # all six "running"
./scripts/set-admin-password.sh   # rotates guacadmin off the default password
```

Sanity: `curl -s http://127.0.0.1:8080/api/health` → `{"ok":true,"session_active":false}`.

## 4. Register the single VNC connection

The broker patches this connection's password per session; it must exist first.

```bash
./scripts/create-connection.sh
# Prints a connection identifier like 42. Paste it into .env as GUAC_CONNECTION_ID,
# then restart the broker so it picks it up:
docker compose restart broker
```

## 5. Firewall — the security story lives or dies here

```bash
# Review first, then apply. Priority -100 puts our chain BEFORE Docker's own
# ACCEPT rules; without that, the drops would be shadowed and useless.
sudo nft -f ../egress/nftables.conf
sudo nft list ruleset | grep -A3 'table inet kerryos' | head -8
# Persist across reboots:
sudo sh -c 'nft list ruleset > /etc/nftables.conf'
sudo systemctl enable --now nftables
```

## 6. DNS + TLS

Point `PORTFOLIO_DOMAIN` (e.g. `kerryos.sokoresult.com`) at 92.5.58.122.
Caddy fetches the Let's Encrypt certificate on first HTTPS hit. Until DNS
propagates, test over SSH tunnels (step 7).

## 7. End-to-end session test

```bash
# From your laptop, tunnel the private ports:
ssh -L 8080:127.0.0.1:8080 -L 8443:127.0.0.1:443 ubuntu@92.5.58.122

# 1) Create a session:
curl -s -X POST http://127.0.0.1:8080/api/session
# -> {"session_id":..., "session_token":..., "guac_url":"/guac/#/client/<id>?token=...",
#     "expires_at":...}

# 2) Open https://<PORTFOLIO_DOMAIN>/guac/ ... no — open the FULL guac_url:
#    https://<PORTFOLIO_DOMAIN>/guac/#/client/<id>?token=<token>
#    EXPECTED: straight to the XFCE desktop, no Guacamole login page.
#    If you land on a login page, the ?token= mechanism failed — see "Known
#    verify-on-deploy items" below before going further.

# 3) In the guest: open Firefox (SokoResult desktop icon), open a terminal,
#    confirm the desktop looks right.

# 4) End it early:
curl -s -X DELETE -H "Authorization: Bearer <session_token>" \
  http://127.0.0.1:8080/api/session/<session_id>
#    EXPECTED: {"ended":true}; `docker ps` shows no kerryos-session.
```

The `frontend-snippet/` page automates this flow (Boot button, countdown,
heartbeat, busy/expired screens). It is standalone for now and merges into
the portfolio site in Phase 3 — serve it from the same origin as Caddy so
its relative `/api/*` calls work.

## 8. Egress tests (Phase 4 done-when — all three, witnessed)

Start a session (step 7.1), then from the repo root on brain 67:

```bash
./egress/verify-egress.sh            # defaults to container kerryos-session
# EXPECTED:
#   PASS: allowed domain reachable (https://sokoresult.com -> HTTP 200)
#   PASS: non-allowlisted domain blocked (https://example.com failed as expected)
#   PASS: metadata endpoint unreachable from guest (denied/timeout)
#   ALL EGRESS CHECKS PASSED
```

Then end the session (step 7.4).

## 9. Lifecycle tests

- **Busy:** create a session, then POST /api/session again → 409 with
  `retry_after`. Second visitor sees the busy screen.
- **Idle:** create a session, don't heartbeat (or stop the frontend) → after
  5 min the sweeper ends it; `docker ps` is clean.
- **Hard cap:** sessions die at 20 min regardless of activity.
- **Kill switch:** with a session active:
  ```bash
  curl -s -X POST -H "Authorization: Bearer $BROKER_ADMIN_TOKEN" \
    http://127.0.0.1:8080/api/admin/kill
  # -> {"killed":true}; container gone, lock cleared, next visitor gets a clean desktop.
  ```
- **Rate limit:** 4 rapid POSTs from one IP → the 4th is 429.

## Recovering from a bad first bring-up

If your first `compose up` ran before these fixes (blank POSTGRES_PASSWORD
warnings, guacd/guacamole crash-looping on ARM64, squid exiting 1):

```bash
cd ~/kerryos && git pull && cd gateway
docker compose down -v   # wipes the pgdata initialized with the blank password
./scripts/init-db.sh     # regenerate the schema file
docker compose up -d --build
docker compose ps        # all six "running", none "Restarting"
./scripts/set-admin-password.sh
./scripts/create-connection.sh   # NEW id -> paste into .env as GUAC_CONNECTION_ID
docker compose restart broker
```

The `gateway/.env` symlink (committed) now feeds the repo-root `.env` into
compose variable interpolation, so the warnings are gone.

## Rollback

```bash
cd gateway
docker compose down                 # stops everything, keeps volumes
docker compose up -d                # back
# Guest image regression: rebuild the previous tag and restart the broker.
# Full reset: docker compose down -v  (DESTROYS the Guacamole DB — re-run init-db.sh)
```

## Known verify-on-deploy items (not guessable from here)

1. `?token=` URL auth: confirm the guac_url lands on the desktop, not the
   login page. Fallback is token-in-cookie injection by the viewer.
2. `guacamole/guacd:1.5.5`, `guacamole/guacamole:1.5.5`, `postgres:16-alpine`,
   `caddy:2.8-alpine` must all have linux/arm64 builds:
   `docker buildx imagetools inspect <image> | grep -i arm64`.
3. `guacamole.properties` relies on `${POSTGRES_PASSWORD}` env substitution
   (per Guacamole docs); if JDBC fails on first boot, wrap with envsubst.
4. Mozilla PPA Firefox install path must be `/usr/lib/firefox` for
   `policies.json` to apply (asserted in the Dockerfile comments).
5. After the allowlist dependency mapping (spec 4.4), add each SokoResult
   dependency to `egress/domains.txt` with a purpose comment and reload squid.

## Security notes worth re-reading monthly

- The allowlist is enforced at Squid + nftables, never in the guest. A
  visitor with a terminal cannot bypass it: no DNS, no direct egress.
- Visitor Guacamole tokens belong to throwaway users with READ on one
  connection only — never admin. Users are deleted at cleanup.
- Review `broker-data/audit.log` and Squid's `access.log` weekly during
  the MVP: >10 sessions/hour or BLOCKED spikes get investigated.
- Test the admin kill switch monthly. An untested kill switch is decoration.
