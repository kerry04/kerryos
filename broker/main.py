"""
KerryOS session broker.

One active guest session globally. On session creation this broker:
  1. checks the sqlite lock (409 if a session is active)
  2. checks the sqlite-backed token buckets (429 if rate-limited)
  3. generates a per-session VNC password and `docker run`s the guest
     container with the exact hardened flags from the MVP spec
  4. waits for VNC (5901) on the container to accept TCP
  5. patches the single Guacamole VNC connection with the new password
     via the Guacamole REST API
  6. creates a per-session Guacamole user with READ-only access to just
     that one connection, mints an auth token as that user, and returns
     a relative /guac/ URL for the portfolio viewer. The visitor's token
     is never an admin token: the worst a leaked URL grants is viewing
     the visitor's own desktop until cleanup deletes the user.

On session end (explicit DELETE, hard-cap expiry, idle timeout, or admin
kill) the same cleanup runs: delete the per-session Guacamole user (which
invalidates its tokens) plus a best-effort token revoke, rotate the
Guacamole connection password to a fresh random value, `docker rm -f` the
container, release the lock, and append one audit line.

Secrets (VNC password, Guacamole tokens, BROKER_ADMIN_TOKEN) are NEVER
logged. Logs carry only session_id, ip_hash, and reason strings.
"""

import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import socket
import sqlite3
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import docker
import docker.types as t
import httpx
from docker.errors import NotFound as DockerNotFound
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kerryos-broker")

# ---------------------------------------------------------------------------
# HUMAN_FILL: all of these come from the repo-root .env (never hardcode real
# values here). The *_MINUTES values have task-specified defaults; the rest
# are required and the broker refuses to start without them.
# ---------------------------------------------------------------------------
GUAC_ADMIN_USER = os.environ.get("GUAC_ADMIN_USER")
GUAC_ADMIN_PASSWORD = os.environ.get("GUAC_ADMIN_PASSWORD")
GUAC_CONNECTION_ID = os.environ.get("GUAC_CONNECTION_ID")
BROKER_ADMIN_TOKEN = os.environ.get("BROKER_ADMIN_TOKEN")
SESSION_MAX_MINUTES = int(os.environ.get("SESSION_MAX_MINUTES", "20"))
SESSION_IDLE_MINUTES = int(os.environ.get("SESSION_IDLE_MINUTES", "5"))

# ---------------------------------------------------------------------------
# Fixed topology (from the MVP spec / compose network). These are not secrets.
# ---------------------------------------------------------------------------
GUAC_BASE = "http://guacamole:8080/guacamole"  # inside the compose network:
# the guacamole container listens on 8080 (8081 is only the host-published
# port on 127.0.0.1, unreachable from inside the network).
CONTAINER_NAME = "kerryos-session"
GUEST_IMAGE = "kerryos/guest:latest"
DOCKER_NETWORK = "kerryos_br-kerryos"  # compose prefixes the network with the project name
DOCKER_API_VERSION = "1.56"  # EndpointConfig requires an explicit version arg
GUEST_IP = "172.28.0.10"
GUEST_VNC_PORT = 5901
SQUID_PROXY = "http://172.28.0.20:3128"
VNC_READY_TIMEOUT_S = 60
SWEEP_INTERVAL_S = 30

DATA_DIR = Path("/data")
DB_PATH = DATA_DIR / "broker.db"
AUDIT_PATH = DATA_DIR / "audit.log"

DB_LOCK = threading.Lock()
_docker_client = None


def _require_env() -> None:
    missing = [
        name
        for name, val in {
            "GUAC_ADMIN_USER": GUAC_ADMIN_USER,
            "GUAC_ADMIN_PASSWORD": GUAC_ADMIN_PASSWORD,
            "GUAC_CONNECTION_ID": GUAC_CONNECTION_ID,
            "BROKER_ADMIN_TOKEN": BROKER_ADMIN_TOKEN,
        }.items()
        if not val
    ]
    if missing:
        raise RuntimeError(f"missing required env vars: {', '.join(missing)}")


def get_docker():
    """Lazy Docker client (docker.sock is mounted into this container)."""
    global _docker_client
    if _docker_client is None:
        _docker_client = docker.DockerClient(base_url="unix://var/run/docker.sock")
    return _docker_client


# ---------------------------------------------------------------------------
# sqlite (stdlib sqlite3 only): the single-session lock + rate-limit buckets
# ---------------------------------------------------------------------------
def _db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with DB_LOCK, _db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS session_lock (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                session_id TEXT NOT NULL,
                session_token TEXT NOT NULL,
                visitor_token TEXT NOT NULL,
                guac_username TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                last_heartbeat REAL NOT NULL,
                ip_hash TEXT NOT NULL
            )"""
        )
        # Lightweight migration for DBs created before guac_username existed.
        try:
            conn.execute("ALTER TABLE session_lock ADD COLUMN guac_username TEXT NOT NULL DEFAULT ''")
        except sqlite3.OperationalError:
            pass  # column already there
        conn.execute(
            """CREATE TABLE IF NOT EXISTS rate_buckets (
                key TEXT PRIMARY KEY,
                tokens REAL NOT NULL,
                updated_at REAL NOT NULL
            )"""
        )
        conn.commit()


def get_session(session_id: str):
    with DB_LOCK, _db() as conn:
        row = conn.execute(
            "SELECT * FROM session_lock WHERE id = 1 AND session_id = ?", (session_id,)
        ).fetchone()
        return dict(row) if row else None


def active_session():
    with DB_LOCK, _db() as conn:
        row = conn.execute("SELECT * FROM session_lock WHERE id = 1").fetchone()
        return dict(row) if row else None


def acquire_lock(session: dict) -> None:
    with DB_LOCK, _db() as conn:
        conn.execute(
            """INSERT INTO session_lock
               (id, session_id, session_token, visitor_token, guac_username,
                created_at, expires_at, last_heartbeat, ip_hash)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session["session_id"],
                session["session_token"],
                session["visitor_token"],
                session.get("guac_username", ""),
                session["created_at"],
                session["expires_at"],
                session["last_heartbeat"],
                session["ip_hash"],
            ),
        )
        conn.commit()


def release_lock() -> None:
    with DB_LOCK, _db() as conn:
        conn.execute("DELETE FROM session_lock WHERE id = 1")
        conn.commit()


def touch_heartbeat(session_id: str, now: float) -> None:
    with DB_LOCK, _db() as conn:
        conn.execute(
            "UPDATE session_lock SET last_heartbeat = ? WHERE id = 1 AND session_id = ?",
            (now, session_id),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# Rate limiting: token buckets persisted in sqlite.
#  - 3 session creations / hour / client IP
#  - 20 session creations / hour / globally
# ---------------------------------------------------------------------------
_RATE_POLICIES = [
    ("ip", 3, 3 / 3600.0),
    ("global", 20, 20 / 3600.0),
]


def _bucket_key(kind: str, ip_hash: str) -> str:
    return f"{kind}:{ip_hash}" if kind == "ip" else "global"


def rate_limit_ok(ip_hash: str) -> bool:
    """Refill both buckets; consume one token each only if BOTH have one.

    Two passes on purpose: a denied request must not burn a token from the
    bucket that still had room.
    """
    now = time.time()
    with DB_LOCK, _db() as conn:
        levels = []
        for kind, capacity, refill_per_s in _RATE_POLICIES:
            key = _bucket_key(kind, ip_hash)
            row = conn.execute(
                "SELECT tokens, updated_at FROM rate_buckets WHERE key = ?", (key,)
            ).fetchone()
            if row:
                tokens = min(capacity, row["tokens"] + (now - row["updated_at"]) * refill_per_s)
            else:
                tokens = float(capacity)
            levels.append((key, tokens))
        if any(tokens < 1.0 for _, tokens in levels):
            for key, tokens in levels:
                conn.execute(
                    "INSERT OR REPLACE INTO rate_buckets (key, tokens, updated_at) VALUES (?, ?, ?)",
                    (key, tokens, now),
                )
            conn.commit()
            return False
        for key, tokens in levels:
            conn.execute(
                "INSERT OR REPLACE INTO rate_buckets (key, tokens, updated_at) VALUES (?, ?, ?)",
                (key, tokens - 1.0, now),
            )
        conn.commit()
    return True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def client_ip(request: Request) -> str:
    """Caddy sets X-Forwarded-For; trust its first value, else the peer address."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def ip_hash(ip: str) -> str:
    return hashlib.sha256(ip.encode()).hexdigest()


def iso_z(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value


def audit(session_id: str, ip_hash_: str, created_at: float, reason: str) -> None:
    duration_s = int(time.time() - created_at)
    ts = iso_z(time.time())
    line = f"{ts} {session_id} {ip_hash_} {duration_s} {reason}\n"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(AUDIT_PATH, "a") as fh:
        fh.write(line)


# ---------------------------------------------------------------------------
# Docker guest lifecycle
# ---------------------------------------------------------------------------
def spawn_guest(vnc_password: str):
    """docker run the guest with the exact hardened flags from the MVP spec.

    --rm --name kerryos-session --network br-kerryos --ip 172.28.0.10
    --cpus=1 --memory=2g --pids-limit=256 --read-only
    --tmpfs /home/visitor --tmpfs /tmp --tmpfs /run
    plus the proxy env the guest needs to reach the internet only via Squid.
    """
    d = get_docker()
    try:
        container = d.containers.create(
            image=GUEST_IMAGE,
            name=CONTAINER_NAME,
            detach=True,
            # --rm equivalent: never leave a stopped container behind.
            # NB: docker SDK 7.x create() rejects remove= (despite the docstring
            # claiming run() compatibility); auto_remove is the HostConfig flag
            # run() itself translates remove= into.
            auto_remove=True,
            network="kerryos_br-kerryos",  # created by gateway compose
            networking_config={
                "kerryos_br-kerryos": t.EndpointConfig(
                    version=DOCKER_API_VERSION,
                    ipv4_address=GUEST_IP,  # reserved static IP the Guacamole conn targets
                ),
            },
            nano_cpus=1_000_000_000,  # --cpus=1
            mem_limit="2g",  # --memory=2g
            pids_limit=256,  # --pids-limit=256
            read_only=True,  # --read-only
            # uid/gid 1001 = the `visitor` user: bare tmpfs mounts would be
            # root-owned, and the entrypoint's $HOME seed would fail with
            # EPERM on every write. "uid=...,gid=..." mounts $HOME correctly.
            tmpfs={
                "/home/visitor": "uid=1001,gid=1001",
                "/tmp": "",
                "/run": "",
            },
            environment={
                "VNC_PASSWORD": vnc_password,
                # Both cases: some tools read lowercase, some uppercase.
                "HTTP_PROXY": SQUID_PROXY,
                "HTTPS_PROXY": SQUID_PROXY,
                "http_proxy": SQUID_PROXY,
                "https_proxy": SQUID_PROXY,
                "NO_PROXY": "172.28.0.0/24,127.0.0.1,localhost",
                "no_proxy": "172.28.0.0/24,127.0.0.1,localhost",
            },
        )
    except docker.errors.APIError as exc:
        raise RuntimeError(f"docker create failed: {exc}") from exc
    try:
        container.start()
    except Exception as exc:
        # Container created but never started -> remove it so it can't orphan.
        try:
            container.remove(force=True)
        except Exception:
            pass
        raise RuntimeError(f"docker network/start failed: {exc}") from exc
    return container


def wait_for_vnc(host: str, port: int, timeout_s: int) -> None:
    """Block until TCP to the guest VNC port accepts, or raise after timeout."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=3):
                return
        except OSError:
            time.sleep(1)
    raise RuntimeError(f"VNC on {host}:{port} did not accept TCP within {timeout_s}s")


def destroy_guest() -> None:
    """docker rm -f kerryos-session; ignore not-found."""
    try:
        get_docker().containers.get(CONTAINER_NAME).remove(force=True)
    except DockerNotFound:
        pass
    except Exception as exc:
        log.warning("guest container removal failed: %s", exc)


# ---------------------------------------------------------------------------
# Guacamole REST API
# ---------------------------------------------------------------------------
def _guac() -> httpx.Client:
    return httpx.Client(base_url=GUAC_BASE, timeout=15)


def guac_mint_token(username: str, password: str) -> str:
    """POST /api/tokens with form fields -> authToken string."""
    with _guac() as c:
        resp = c.post("/api/tokens", data={"username": username, "password": password})
        resp.raise_for_status()
        token = resp.json().get("authToken")
    if not token:
        raise RuntimeError("guacamole did not return an authToken")
    return token


def guac_revoke_token(token_to_revoke: str, admin_token: str) -> None:
    with _guac() as c:
        resp = c.delete(f"/api/tokens/{token_to_revoke}", params={"token": admin_token})
        if resp.status_code not in (200, 204):
            raise RuntimeError(f"guacamole token revoke returned {resp.status_code}")


def guac_create_limited_user(admin_token: str, username: str, password: str,
                             connection_id: str) -> None:
    """Create a per-session Guacamole user with READ on exactly one connection.

    This is the least-privilege fix for the naive alternative (handing the
    visitor an admin-minted token): a leaked visitor URL can at most view
    its own desktop, never administer Guacamole.
    """
    base = "/api/session/data/postgresql"
    with _guac() as c:
        r = c.post(
            f"{base}/users",
            params={"token": admin_token},
            json={
                "username": username,
                "password": password,
                "attributes": {
                    "disabled": "",
                    "expired": "",
                    "access-window-start": "",
                    "access-window-end": "",
                    "valid-from": "",
                    "valid-until": "",
                    "timezone": "",
                },
            },
        )
        r.raise_for_status()
        p = c.patch(
            f"{base}/users/{username}/permissions",
            params={"token": admin_token},
            # Guacamole's permissions endpoint is a JSON Patch whose "value"
            # is a bare permission string — NOT an array of strings. Sending
            # ["READ"] fails deserialization with HTTP 400.
            json=[
                {
                    "op": "add",
                    "path": f"/connectionPermissions/{connection_id}",
                    "value": "READ",
                }
            ],
        )
        p.raise_for_status()


def guac_delete_user(admin_token: str, username: str) -> None:
    """Delete the per-session user; this invalidates all of its tokens."""
    with _guac() as c:
        r = c.delete(
            f"/api/session/data/postgresql/users/{username}",
            params={"token": admin_token},
        )
        if r.status_code not in (200, 204, 404):
            raise RuntimeError(f"guacamole user delete returned {r.status_code}")


def guac_set_connection_password(admin_token: str, password: str) -> None:
    """GET the connection, replace only the VNC password, PUT the full object.

    GET-then-mutate (instead of building the object from scratch) preserves
    whatever the operator preconfigured (parent folder, connection group,
    sharing profiles, etc.).
    """
    url = f"/api/session/data/postgresql/connections/{GUAC_CONNECTION_ID}"
    with _guac() as c:
        resp = c.get(url, params={"token": admin_token})
        resp.raise_for_status()
        conn = resp.json()
        # Drop read-only fields the API returns but refuses on PUT.
        conn.pop("activeConnections", None)
        conn["name"] = "kerryos-guest"
        conn["protocol"] = "vnc"
        params = conn.get("parameters") or {}
        params["hostname"] = GUEST_IP
        params["port"] = str(GUEST_VNC_PORT)
        params["password"] = password
        conn["parameters"] = params
        put = c.put(url, params={"token": admin_token}, json=conn)
        put.raise_for_status()


# ---------------------------------------------------------------------------
# Session cleanup — the single shared path used by DELETE, the sweeper
# (expiry / idle), and the admin kill switch. Every step is best-effort so
# one failure can't strand the container, the lock, or a live guac token.
# ---------------------------------------------------------------------------
def end_session(session: dict, reason: str) -> None:
    now = time.time()
    session_id = session["session_id"]
    log.info("ending session %s reason=%s", session_id, reason)
    try:
        admin_token = guac_mint_token(GUAC_ADMIN_USER, GUAC_ADMIN_PASSWORD)
    except Exception as exc:
        admin_token = None
        log.warning("session %s: guac admin login failed during cleanup: %s", session_id, exc)

    if admin_token:
        try:
            guac_revoke_token(session["visitor_token"], admin_token)
        except Exception as exc:
            log.warning("session %s: visitor token revoke failed: %s", session_id, exc)
        try:
            # Deleting the per-session user invalidates its tokens even if
            # the revoke above failed.
            if session.get("guac_username"):
                guac_delete_user(admin_token, session["guac_username"])
        except Exception as exc:
            log.warning("session %s: guac user delete failed: %s", session_id, exc)
        try:
            # Rotate to a fresh random password so the old VNC password can
            # never be replayed against a future guest.
            guac_set_connection_password(admin_token, secrets.token_urlsafe(18))
        except Exception as exc:
            log.warning("session %s: guac password rotation failed: %s", session_id, exc)
        try:
            guac_revoke_token(admin_token, admin_token)
        except Exception:
            pass

    destroy_guest()
    release_lock()
    try:
        audit(session_id, session["ip_hash"], session["created_at"], reason)
    except Exception as exc:
        log.warning("session %s: audit append failed: %s", session_id, exc)
    log.info("session %s ended (%s, lived %ds)", session_id, reason, int(now - session["created_at"]))


def kill_stray_container() -> None:
    """Best-effort destroy of the guest container even when no lock is held."""
    destroy_guest()


# ---------------------------------------------------------------------------
# Background sweeper: hard cap + idle timeout, every 30s
# ---------------------------------------------------------------------------
async def sweeper() -> None:
    while True:
        try:
            session = await asyncio.to_thread(active_session)
            if session:
                now = time.time()
                if now > session["expires_at"]:
                    await asyncio.to_thread(end_session, session, "expired")
                elif now - session["last_heartbeat"] > SESSION_IDLE_MINUTES * 60:
                    await asyncio.to_thread(end_session, session, "idle")
        except Exception as exc:
            log.warning("sweeper error: %s", exc)
        await asyncio.sleep(SWEEP_INTERVAL_S)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _require_env()
    init_db()
    task = asyncio.create_task(sweeper())
    log.info("broker up: max=%dmin idle=%dmin", SESSION_MAX_MINUTES, SESSION_IDLE_MINUTES)
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.post("/api/session")
def create_session(request: Request):
    """Create a session: 200 / 409 (busy) / 429 (rate-limited).

    Any failure after the container starts still runs the shared cleanup so
    the broker never leaves an orphaned container or a held lock.
    """
    ip = client_ip(request)
    h = ip_hash(ip)
    now = time.time()

    current = active_session()
    if current:
        retry_after = max(1, int(current["expires_at"] - now))
        return JSONResponse(
            status_code=409,
            content={"error": "session_active", "retry_after": retry_after},
        )

    if not rate_limit_ok(h):
        return JSONResponse(status_code=429, content={"error": "rate_limited"})

    session_id = uuid.uuid4().hex
    session_token = secrets.token_urlsafe(32)
    vnc_password = secrets.token_urlsafe(18)
    visitor_token = None
    guac_username = None
    container_started = False

    try:
        spawn_guest(vnc_password)
        container_started = True
        wait_for_vnc(GUEST_IP, GUEST_VNC_PORT, VNC_READY_TIMEOUT_S)

        admin_token = guac_mint_token(GUAC_ADMIN_USER, GUAC_ADMIN_PASSWORD)
        try:
            guac_set_connection_password(admin_token, vnc_password)
            # Least privilege: the visitor gets a token for a throwaway user
            # that can READ only this one connection — never an admin token.
            guac_username = f"sess-{session_id[:12]}"
            guac_user_password = secrets.token_urlsafe(24)
            guac_create_limited_user(
                admin_token, guac_username, guac_user_password, GUAC_CONNECTION_ID
            )
            visitor_token = guac_mint_token(guac_username, guac_user_password)
        finally:
            try:
                guac_revoke_token(admin_token, admin_token)
            except Exception:
                pass

        expires_at = now + SESSION_MAX_MINUTES * 60
        session = {
            "session_id": session_id,
            "session_token": session_token,
            "visitor_token": visitor_token,
            "guac_username": guac_username,
            "created_at": now,
            "expires_at": expires_at,
            "last_heartbeat": now,
            "ip_hash": h,
        }
        acquire_lock(session)
    except Exception as exc:
        # Never leave a container orphaned, a user behind, or the lock held
        # on a failed boot.
        log.warning("session creation failed for %s: %s", session_id, exc)
        if container_started:
            destroy_guest()
        try:
            release_lock()
        except Exception:
            pass
        try:
            admin_token = guac_mint_token(GUAC_ADMIN_USER, GUAC_ADMIN_PASSWORD)
            try:
                if guac_username:
                    guac_delete_user(admin_token, guac_username)
                elif visitor_token:
                    guac_revoke_token(visitor_token, admin_token)
                guac_set_connection_password(admin_token, secrets.token_urlsafe(18))
            finally:
                guac_revoke_token(admin_token, admin_token)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="session boot failed") from exc

    log.info("session %s created (ip_hash=%s)", session_id, h)
    # ASSUMPTION (verify on first deploy): the guacamole-client build honours
    # the ?token= URL parameter for pre-authenticated login (added in
    # Guacamole 1.4). Test: open the returned guac_url in a private window —
    # it must land straight on the desktop, NOT the Guacamole login page.
    # If it lands on login, the portfolio viewer must instead inject the
    # auth token into the client's storage/cookie before loading /guac/.
    guac_url = f"/guac/#/client/{GUAC_CONNECTION_ID}?token={visitor_token}"
    return {
        "session_id": session_id,
        "session_token": session_token,
        "guac_url": guac_url,
        "expires_at": iso_z(expires_at),
    }


@app.get("/api/session/{session_id}")
def get_session_status(session_id: str):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="no such session")
    return {"status": "active", "expires_at": iso_z(session["expires_at"])}


@app.post("/api/session/{session_id}/heartbeat")
def heartbeat(session_id: str, authorization: str | None = Header(default=None)):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="no such session")
    token = bearer_token(authorization)
    if not token or not hmac.compare_digest(token, session["session_token"]):
        raise HTTPException(status_code=401, detail="bad session token")
    now = time.time()
    touch_heartbeat(session_id, now)
    return {"expires_at": iso_z(session["expires_at"])}


@app.delete("/api/session/{session_id}")
def delete_session(session_id: str, authorization: str | None = Header(default=None)):
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="no such session")
    token = bearer_token(authorization)
    if not token or not hmac.compare_digest(token, session["session_token"]):
        raise HTTPException(status_code=401, detail="bad session token")
    end_session(session, "ended")
    return {"ended": True}


@app.post("/api/admin/kill")
def admin_kill(authorization: str | None = Header(default=None)):
    token = bearer_token(authorization)
    if not token or not hmac.compare_digest(token, BROKER_ADMIN_TOKEN or ""):
        raise HTTPException(status_code=401, detail="bad admin token")
    session = active_session()
    if session:
        end_session(session, "killed")
    else:
        # No lock held — still make sure no guest container is running.
        kill_stray_container()
    return {"killed": True}


@app.get("/api/health")
def health():
    return {"ok": True, "session_active": active_session() is not None}
