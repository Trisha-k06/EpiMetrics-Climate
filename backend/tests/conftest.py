import os
import tempfile
from pathlib import Path

import pytest

# Configure before the app is imported: no background warm-up, throwaway users file and audit log.
os.environ.setdefault("EPIMETRICS_WARM", "0")
_TMP = Path(tempfile.mkdtemp())
os.environ["EPIMETRICS_USERS_FILE"] = str(_TMP / "users.json")
os.environ["EPIMETRICS_AUDIT_FILE"] = str(_TMP / "audit.jsonl")

from fastapi.testclient import TestClient  # noqa: E402

from backend import app as app_module  # noqa: E402

PASSWORDS = {"viewer": "viewer-demo-2026", "analyst": "analyst-demo-2026", "admin": "admin-demo-2026"}


@pytest.fixture(scope="session")
def client():
    with TestClient(app_module.app) as c:
        yield c


@pytest.fixture(autouse=True)
def fresh_limiter():
    """Each test starts with a clean sign-in limiter so lockout tests can't affect others."""
    app_module.limiter.reset()
    yield
    app_module.limiter.reset()


@pytest.fixture(scope="session")
def tokens(client):
    out = {}
    for role, pw in PASSWORDS.items():
        r = client.post("/api/v1/auth/login", json={"username": role, "password": pw})
        assert r.status_code == 200, r.text
        out[role] = r.json()["token"]
    return out


@pytest.fixture(scope="session")
def get(client, tokens):
    def _get(path, role="viewer", **params):
        return client.get(f"/api/v1{path}", params=params, headers={"Authorization": f"Bearer {tokens[role]}"})
    return _get
