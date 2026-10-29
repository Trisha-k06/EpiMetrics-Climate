"""Sign-in followed by the dashboard's own API calls, and session tokens across server instances.

Regression: on Vercel, EPIMETRICS_SECRET was missing from the function's environment, so each instance signed tokens
with its own random key. Sign-in worked, then the dashboard's parallel requests landed on other instances, got 401
and the site signed the user straight out ("Your session expired").
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from backend.data import ROOT

from .conftest import PASSWORDS

# The calls the overview screen makes right after sign-in (seen in the browser on the deployed site).
DASHBOARD_CALLS = [
    ("/meta", {}), ("/districts", {}), ("/recovery-matrix", {"disease": "dengue"}),
    ("/recovery-matrix", {"disease": "malaria"}),
    ("/simulations", {"district": "cbe", "disease": "dengue", "scenario": "delayed_monsoon"}),
    ("/insights", {"district": "cbe", "disease": "dengue", "scenario": "delayed_monsoon"}),
    ("/me/saved", {}), ("/me/favorites", {}),
]


def _login(client, role):
    r = client.post("/api/v1/auth/login", json={"username": role, "password": PASSWORDS[role]})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_login_then_dashboard_calls_all_authorised(client):
    for role in ("viewer", "analyst", "admin"):
        h = {"Authorization": f"Bearer {_login(client, role)}"}
        assert client.get("/api/v1/auth/me", headers=h).status_code == 200
        for path, params in DASHBOARD_CALLS:
            r = client.get(f"/api/v1{path}", params=params, headers=h)
            # 403 is a role rule (admins have no saved views); 401 would sign the user out.
            assert r.status_code == 200 or (role != "analyst" and r.status_code == 403), (role, path, r.text)


def test_dashboard_calls_in_parallel_keep_the_session(client):
    h = {"Authorization": f"Bearer {_login(client, 'analyst')}"}
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(lambda c: client.get(f"/api/v1{c[0]}", params=c[1], headers=h).status_code, DASHBOARD_CALLS * 3))
    assert codes == [200] * len(codes)
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200


def test_dashboard_screen_navigation(client):
    """Every screen the role is offered at sign-in opens without ending the session."""
    r = client.post("/api/v1/auth/login", json={"username": "analyst", "password": PASSWORDS["analyst"]})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    screens = [s["id"] for s in r.json()["access"]["screens"]]
    assert "overview" in screens
    for screen in screens:
        assert client.post("/api/v1/events", json={"event": "screen_open", "screen": screen}, headers=h).status_code == 200
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200


# ---------------------------------------------------------------------------- separate instances
_ISSUE = ("from backend.security import TokenService;"
          "print(TokenService().issue({'username': 'analyst', 'role': 'analyst', 'tv': 0})[0])")
_CHECK = "import sys; from backend.security import TokenService; print(TokenService().decode(sys.stdin.read().strip()) is not None)"


def _instance(code, tmp_path, name, stdin=None, **env):
    """A fresh Python process, like a new serverless instance: own state directory, nothing shared but the environment."""
    e = {k: v for k, v in os.environ.items() if not k.startswith("EPIMETRICS_") and k != "VERCEL"}
    e.update(EPIMETRICS_STATE_DIR=str(tmp_path / name), EPIMETRICS_WARM="0", **env)
    return subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=e, input=stdin, capture_output=True, text=True, timeout=60)


def test_token_from_one_instance_is_accepted_by_another(tmp_path):
    secret = {"VERCEL": "1", "EPIMETRICS_SECRET": "regression-test-only-" + "x" * 32}
    a = _instance(_ISSUE, tmp_path, "a", **secret)
    assert a.returncode == 0, a.stderr
    b = _instance(_CHECK, tmp_path, "b", stdin=a.stdout, **secret)
    assert b.returncode == 0, b.stderr
    assert b.stdout.strip() == "True"


def test_serverless_start_refuses_without_secret(tmp_path):
    r = _instance("import backend.security", tmp_path, "c", VERCEL="1")
    assert r.returncode != 0
    assert "EPIMETRICS_SECRET is not set" in r.stderr


def test_local_start_without_secret_still_works(tmp_path):
    assert _instance("import backend.security", tmp_path, "d").returncode == 0
