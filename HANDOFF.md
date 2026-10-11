# KerryOS Deployment Handoff — 2026-10-11 ~07:30 EAT

You are taking over a live deployment debug session on `brain 67` (Oracle Cloud Ampere A1, Ubuntu 24.04 ARM64, public IP 92.5.58.122). The human runs your commands via SSH. Previous assistant (KERRY/Muse chat) had no shell access; you do. Use it.

## Project
KerryOS: a remotely accessible real Linux desktop (XFCE via TigerVNC) streamed through Apache Guacamole in the browser, framed as a Windows 7-inspired portfolio. Repo: https://github.com/kerry04/kerryos (public). Local clone: `~/kerryos` on brain 67.

## Architecture (all on brain 67, Docker Compose in `~/kerryos/gateway/`)
| Service | Container | Port / IP | Status |
|---|---|---|---|
| postgres 16 | kerryos-postgres-1 | 172.28.0.70 | Up, schema loaded |
| guacd | kerryos-guacd-1 | 172.28.0.60:4822 | Up |
| guacamole (Tomcat 9 + Guac 1.5.5 WAR) | kerryos-guacamole-1 | 127.0.0.1:8081 → /guacamole | Up, **just rebuilt with JDBC fix, needs test** |
| broker (FastAPI) | kerryos-broker-1 | 127.0.0.1:8080 | Up, healthy |
| caddy 2.8 | kerryos-caddy-1 | 0.0.0.0:80/443 | Up |
| proxy (Tinyproxy) | kerryos-proxy-1 | 172.28.0.20:3128 | Up |

Network: `br-kerryos` 172.28.0.0/24. Static IPs in `gateway/docker-compose.yml`. Secrets in `~/kerryos/.env` (gitignored). Domain: `kerryos.sokoresult.com` (DNS not yet pointed).

## What was fixed this session (do NOT redo)
1. Guest UID 1000→1001 (Ubuntu reserves 1000).
2. Compose `.env` symlink: `gateway/.env -> ../.env`.
3. guacd → `lscr.io/linuxserver/guacd:latest` (official image is AMD64-only).
4. Guacamole → official 1.5.5 WAR on `tomcat:9-jre17` (no Maven build).
5. **Squid abandoned** — `squid -N` dies silently (exit 1, zero output) on ARM64 as any user with any config. Replaced with **Tinyproxy** (`egress/`). Allowlist via `FilterDefaultDeny Yes` + `egress/filter`. Anti-rebinding via nftables rule 8 (proxy confined to public IPs).
6. Caddy `redir /guac/ 302` (was missing status arg).
7. Guacamole API scripts: base URL is `http://127.0.0.1:8081/guacamole` (not `/api` directly).
8. `init-db.sh` rewritten twice: now downloads schema SQL from `apache/guacamole-client` 1.5.5 tag (no Docker). Old version left an empty file/dir at `gateway/guacamole/initdb.sql` — resolved, file is now 24KB valid.
9. Postgres volume wiped (`kerryos_pgdata` removed, `docker compose down/up`); schema auto-loaded on fresh init (confirmed in logs).
10. **Guacamole JDBC auth extension was missing** (Dockerfile only installed the WAR). Fixed in `gateway/guacamole-webapp/Dockerfile` — now downloads `guacamole-auth-jdbc-1.5.5.tar.gz` (SHA256-verified) and installs the PostgreSQL extension JAR + JDBC driver. **This was the root cause of all auth failures.** Pushed, not yet verified.

## Current state / immediate next step
The Guacamole image was rebuilt with the JDBC extension. **Test auth now:**
```bash
cd ~/kerryos && git pull -q && cd gateway
docker compose up -d --build guacamole
sleep 30
curl -s -X POST http://127.0.0.1:8081/guacamole/api/tokens --data-urlencode "username=guacadmin" --data-urlencode "password=guacadmin" | head -c 200; echo
```
If that returns an `authToken`, the root cause is fixed. Then:
```bash
GUAC_CURRENT_PASSWORD=guacadmin ./scripts/set-admin-password.sh
CONN_ID=$(./scripts/create-connection.sh | grep -oP 'Identifier: \K\S+')
echo "Connection ID: $CONN_ID"
# put GUAC_CONNECTION_ID=$CONN_ID into ~/kerryos/.env (add or replace line)
docker compose restart broker
sleep 3
curl -s http://127.0.0.1:8080/api/health; echo
```

## After Guacamole auth works
1. **nftables**: `sudo nft -f ~/kerryos/egress/nftables.conf` (review first — human already reviewed once, but re-verify). Persist: `sudo nft list ruleset > /etc/nftables.conf && sudo systemctl enable --now nftables`.
2. **DNS**: Cloudflare A record `kerryos` → `92.5.58.122` (on his Cloudflare account).
3. **HTTPS**: Caddy auto-issues for `kerryos.sokoresult.com` (email in Caddyfile).
4. **First session**: `curl -X POST http://127.0.0.1:8080/api/session` → get Guacamole URL → open in browser → should land directly in XFCE desktop.
5. **Egress verify**: `./egress/verify-egress.sh` (tests allowlist allow/deny + metadata block).
6. Test: session delete, idle expiry (5 min), hard cap (20 min), concurrent-session 429, rate limit, admin kill switch.

## Key files
- `~/kerryos/.env` — all secrets (never commit, never print)
- `~/kerryos/gateway/docker-compose.yml` — services, static IPs
- `~/kerryos/gateway/scripts/` — `init-db.sh`, `set-admin-password.sh`, `create-connection.sh`
- `~/kerryos/egress/` — `Dockerfile` (Tinyproxy), `tinyproxy.conf`, `filter` (allowlist), `nftables.conf`, `verify-egress.sh`
- `~/kerryos/gateway/guacamole-webapp/Dockerfile` — Guacamole build (WAR + JDBC)
- Full spec: `~/workspace/kerryos-mvp/KERRYOS_MVP_SPEC.md` (on KERRY's machine, not brain 67)

## Gotchas
- `~/kerryos/gateway/guacamole/initdb.sql` is gitignored (generated). If postgres ever needs re-init, `docker compose down`, `docker volume rm kerryos_pgdata`, `docker compose up -d`.
- The broker needs `GUAC_CONNECTION_ID` in `.env` and a restart to pick it up.
- Guacamole takes ~20-30s after (re)start before the API responds.
- Tinyproxy allowlist: `egress/filter` (regex per line, `FilterDefaultDeny Yes`). Restart proxy container after edits: `docker compose restart proxy`.
- Session policy: 1 active session, 20-min hard cap, 5-min idle timeout (broker).

---
## Live status — 2026-10-11 12:40 UTC (all verified from inside the instance)

| Piece | State |
|---|---|
| `POST /api/session` → disposable XFCE desktop | ✅ live, verified end-to-end |
| Desktop streaming (guacamole → guacd → guest, real render instructions) | ✅ verified |
| Egress allowlist proxy (sokoresult.com/github pass; others 403; metadata 403) | ✅ verified |
| OCI Security List ingress 80/443 | ✅ OPEN (user-applied; externally confirmed) |
| ufw 80/443 on host | ✅ OPEN |
| DNS record `kerryos.sokoresult.com` → 92.5.58.122 | ⏳ TODO (USER_TODO.md step 2) — blocks HTTPS + real URL |
| nftables egress belt (`egress/nftables.conf`) | 🔸 written; APPLY AT LAUNCH (blocks proxy bypass) |

### How to test (after DNS, or via one-off token)
1. Operator mints session: `curl -X POST http://127.0.0.1:8080/api/session -d '{}' -H 'Content-Type: application/json'`
2. Response JSON `guac_url` contains the token for `http://92.5.58.122/guac/#/client/1?token=…` (valid 20 min).
3. Via SSH tunnel (pre-DNS): `ssh -L 8081:127.0.0.1:8081 ubuntu@92.5.58.122` then open
   `http://localhost:8081/guacamole/#/client/1?token=<token>`.
4. Expired token: mint again (session self-destructs).
5. To force-kill a session: `DELETE /api/session/{session_id}` with `Authorization: Bearer <session_token>`.

### Phase 3 next
- Win7 theming + boot animation on guest, portfolio icons, frontend embed.
- Multi-session support, inactivity sweeper UI, monitoring.
