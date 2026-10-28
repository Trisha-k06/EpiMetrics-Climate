"""Users, password hashing, JWT sessions, sign-in rate limiting and the audit log."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from pathlib import Path

import jwt

BACKEND = Path(__file__).resolve().parent
USERS_FILE = Path(os.environ.get("EPIMETRICS_USERS_FILE", BACKEND / "users.json"))
LOG_DIR = BACKEND / "logs"
AUDIT_FILE = LOG_DIR / "audit.jsonl"

ROLES = ("viewer", "analyst", "admin")
PBKDF2_ITERATIONS = 200_000
DEMO_USERS = [
    ("viewer", "viewer-demo-2026", "Demo viewer", "viewer"),
    ("analyst", "analyst-demo-2026", "Demo analyst", "analyst"),
    ("admin", "admin-demo-2026", "Demo admin", "admin"),
]

# Secret: from the environment, otherwise random per process (all sessions end when the server restarts).
SECRET = os.environ.get("EPIMETRICS_SECRET") or secrets.token_urlsafe(48)
ALGORITHM = "HS256"


def session_seconds() -> int:
    return int(float(os.environ.get("EPIMETRICS_SESSION_MINUTES", "15")) * 60)


def refresh_after_seconds() -> int:
    """Re-issue a token once it is this old (60 s, or half the session for very short sessions)."""
    return min(60, session_seconds() // 2)


# ---------------------------------------------------------------------------- passwords
def hash_password(password: str, salt: bytes | None = None, iterations: int = PBKDF2_ITERATIONS) -> dict:
    salt = salt or secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return {"algorithm": "pbkdf2_sha256", "salt": salt.hex(), "iterations": iterations, "hash": h.hex()}


def verify_password(password: str, record: dict | None) -> bool:
    """Constant-time check. Unknown users still pay for one hash so timing does not reveal valid usernames."""
    rec = record or {"salt": "00" * 16, "iterations": PBKDF2_ITERATIONS, "hash": "00" * 32}
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(rec["salt"]), int(rec["iterations"]))
    ok = hmac.compare_digest(h.hex(), rec["hash"])
    return ok and record is not None


class UserStore:
    def __init__(self, path: Path = USERS_FILE):
        self.path = Path(path)
        self._lock = threading.Lock()
        if not self.path.exists():
            self.seed_demo()

    def _read(self) -> dict:
        return json.loads(self.path.read_text())

    def _write(self, data: dict):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1))
        os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    def seed_demo(self):
        with self._lock:
            self._write({"note": "Demo accounts for the synthetic research prototype. Passwords are stored only as salted PBKDF2-SHA256 hashes.",
                         "users": [{"username": u, "display_name": n, "role": r, **hash_password(p)} for u, p, n, r in DEMO_USERS]})

    def get(self, username: str) -> dict | None:
        return next((u for u in self._read()["users"] if u["username"] == username), None)

    def list(self) -> list[dict]:
        return [{k: u[k] for k in ("username", "display_name", "role")} for u in self._read()["users"]]

    def set_user(self, username: str, password: str, role: str, display_name: str | None = None):
        if role not in ROLES:
            raise ValueError(f"role must be one of {ROLES}")
        with self._lock:
            data = self._read()
            data["users"] = [u for u in data["users"] if u["username"] != username]
            data["users"].append({"username": username, "display_name": display_name or username, "role": role, **hash_password(password)})
            self._write(data)

    def authenticate(self, username: str, password: str) -> dict | None:
        rec = self.get(username)
        return rec if verify_password(password, rec) else None


# ---------------------------------------------------------------------------- tokens
class TokenService:
    def __init__(self):
        self._revoked: dict[str, float] = {}  # session id -> expiry
        self._lock = threading.Lock()

    def issue(self, user: dict, sid: str | None = None) -> tuple[str, int]:
        now = int(time.time())
        ttl = session_seconds()
        claims = {"sub": user["username"], "role": user["role"], "name": user.get("display_name") or user["username"],
                  "sid": sid or secrets.token_urlsafe(12), "iat": now, "exp": now + ttl}
        return jwt.encode(claims, SECRET, algorithm=ALGORITHM), ttl

    def decode(self, token: str) -> dict | None:
        try:
            claims = jwt.decode(token, SECRET, algorithms=[ALGORITHM], options={"require": ["exp", "iat", "sub", "sid"]})
        except jwt.PyJWTError:
            return None
        if claims.get("role") not in ROLES:
            return None
        with self._lock:
            if claims["sid"] in self._revoked:
                return None
        return claims

    def revoke(self, claims: dict):
        with self._lock:
            now = time.time()
            self._revoked = {k: v for k, v in self._revoked.items() if v > now}
            self._revoked[claims["sid"]] = now + session_seconds() + 60

    def needs_refresh(self, claims: dict) -> bool:
        return time.time() - claims["iat"] >= refresh_after_seconds()


# ---------------------------------------------------------------------------- rate limiting
class LoginLimiter:
    """Locks sign-in for `lock_seconds` after `user_limit` failures for one username, or `ip_limit` from one IP.
    The IP limit is higher so one person's typos don't lock out everyone on the same network."""

    def __init__(self, user_limit=5, ip_limit=20, lock_seconds=30):
        self.user_limit, self.ip_limit, self.lock_seconds = user_limit, ip_limit, lock_seconds
        self._fails: dict[str, int] = {}
        self._locked: dict[str, float] = {}
        self._lock = threading.Lock()

    def _keys(self, username, ip):
        return [(f"u:{username}", self.user_limit)] + ([(f"ip:{ip}", self.ip_limit)] if ip else [])

    def locked_for(self, username, ip) -> int:
        now = time.time()
        with self._lock:
            left = max((self._locked.get(k, 0) - now for k, _ in self._keys(username, ip)), default=0)
        return int(left) + 1 if left > 0 else 0

    def failure(self, username, ip) -> bool:
        """Record a failure; True if this failure triggered a lock."""
        locked = False
        with self._lock:
            for k, limit in self._keys(username, ip):
                self._fails[k] = self._fails.get(k, 0) + 1
                if self._fails[k] >= limit:
                    self._locked[k] = time.time() + self.lock_seconds
                    self._fails[k] = 0
                    locked = True
        return locked

    def success(self, username, ip):
        with self._lock:
            self._fails.pop(f"u:{username}", None)

    def reset(self):
        with self._lock:
            self._fails.clear()
            self._locked.clear()


# ---------------------------------------------------------------------------- audit log
class AuditLog:
    """Append-only JSON-lines log of security-relevant actions. No health data is ever written (all data is synthetic)."""

    def __init__(self, path: Path = AUDIT_FILE):
        self.path = Path(path)
        self._lock = threading.Lock()

    def write(self, action: str, user: str | None = None, role: str | None = None, ip: str | None = None,
              status: str = "ok", detail: dict | str | None = None):
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "action": action, "user": user, "role": role,
               "ip": ip, "status": status, "detail": detail}
        line = json.dumps(rec, ensure_ascii=False)
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    def tail(self, limit: int = 200) -> list[dict]:
        if not self.path.exists():
            return []
        with self._lock:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        out = []
        for ln in reversed(lines[-limit:]):
            try:
                out.append(json.loads(ln))
            except ValueError:
                continue
        return out
