"""Role × endpoint matrix: every endpoint in roles.ENDPOINTS is called by every role.
Allowed → 200, not allowed → 403. The matrix itself comes from backend/roles.py (single source of truth)."""
import itertools

import pytest

from backend import app as app_module
from backend import routes_admin, routes_core, routes_me, services
from backend.roles import ENDPOINTS, ROLE_IDS, SCREENS, allowed

from .conftest import PASSWORDS

_n = itertools.count()


def login(client, role):
    r = client.post("/api/v1/auth/login", json={"username": role, "password": PASSWORDS[role]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def heads(client):
    return {r: login(client, r) for r in ROLE_IDS}


def _comment_id(client, heads, role):
    """A comment owned by `role` (only roles that may post can own one)."""
    r = client.post("/api/v1/comments", headers=heads[role], json={"view": "cbe.dengue.baseline", "text": f"matrix {next(_n)}"})
    assert r.status_code == 200, r.text
    return r.json()["comment"]["id"]


def request_for(client, heads, role, method, path):
    """Build a valid request for one endpoint so an allowed role gets 200."""
    h = dict(heads[role])
    q, body = {}, None
    p = path
    if path == "/auth/logout":
        h = login(client, role)  # don't revoke the shared token
    elif path == "/events":
        body = {"event": "screen_open", "screen": SCREENS[role][0]}
    elif path in ("/simulations",):
        q = {"district": "cbe", "disease": "dengue", "scenario": "baseline"}
    elif path in ("/recovery-matrix", "/validation", "/analytics/forecast-summary", "/analytics/episodes"):
        q = {"disease": "dengue"}
    elif path in ("/analytics/eda", "/analytics/forecasts"):
        q = {"district": "cbe", "disease": "dengue"}
    elif path == "/exports":
        body = {"kind": "report_pdf", "district": "cbe", "disease": "dengue", "scenario": "baseline"}
    elif path == "/me/saved" and method == "POST":
        body = {"name": "matrix", "district": "cbe", "disease": "dengue", "scenario": "baseline"}
    elif path == "/me/saved/{saved_id}":
        sid = 999999
        if allowed(role, "saved"):
            sid = client.post("/api/v1/me/saved", headers=h, json={"name": "to delete", "district": "cbe", "disease": "dengue",
                                                                     "scenario": "baseline"}).json()["saved"]["id"]
        p = f"/me/saved/{sid}"
    elif path == "/me/favorites" and method == "POST":
        body = {"district": "mdu"}
    elif path == "/me/favorites/{district}":
        p = "/me/favorites/mdu"
    elif path == "/insights":
        q = {"district": "cbe", "disease": "dengue", "scenario": "delayed_monsoon"}
    elif path == "/comments" and method == "GET":
        q = {"view": "cbe.dengue.baseline"}
    elif path == "/comments" and method == "POST":
        body = {"view": "cbe.dengue.baseline", "text": f"hello {next(_n)}"}
    elif path == "/comments/{comment_id}":
        cid = _comment_id(client, heads, role) if allowed(role, "comments.post") else 999999
        p = f"/comments/{cid}"
        body = {"text": "edited"} if method == "PATCH" else None
    elif path == "/admin/users" and method == "POST":
        body = {"username": f"matrix_{role}_{next(_n)}", "password": "matrix-password-1", "role": "viewer"}
    elif path == "/admin/users/{username}":
        p, body = "/admin/users/viewer", {"display_name": "Demo viewer"}
    elif path == "/admin/users/{username}/password":
        name = f"pw_{role}_{next(_n)}"
        services.users.create(name, "first-password-1", "viewer")
        p, body = f"/admin/users/{name}/password", {"password": "second-password-2"}
    elif path == "/admin/comments/{comment_id}":
        cid = _comment_id(client, heads, "analyst")
        p = f"/admin/comments/{cid}"
        body = {"hidden": True} if method == "PATCH" else None
    elif path == "/admin/view-as":
        body = {"role": "viewer"}
    return client.request(method, f"/api/v1{p}", headers=h, params=q, json=body)


CASES = [(role, m, p) for (m, p) in sorted(ENDPOINTS) for role in ROLE_IDS]


@pytest.mark.parametrize("role,method,path", CASES, ids=[f"{r}-{m}-{p}" for r, m, p in CASES])
def test_role_endpoint_matrix(client, heads, role, method, path):
    r = request_for(client, heads, role, method, path)
    if allowed(role, ENDPOINTS[(method, path)]):
        assert r.status_code == 200, f"{role} {method} {path}: {r.status_code} {r.text[:200]}"
    else:
        assert r.status_code == 403, f"{role} {method} {path}: expected 403, got {r.status_code} {r.text[:200]}"
        assert r.json()["error"]["code"] == "forbidden"


def test_every_api_route_has_an_access_rule():
    routes = {(m, route.path) for r in (routes_core.router, routes_me.router, routes_admin.router)
              for route in r.routes for m in route.methods}
    public = {("POST", "/auth/login"), ("GET", "/health")}
    assert routes - public == set(ENDPOINTS), f"missing: {routes - public - set(ENDPOINTS)}; stale: {set(ENDPOINTS) - routes}"


def test_export_kinds_by_role(client, heads):
    for role, kind, status in [("viewer", "report_pdf", 200), ("viewer", "print", 200), ("viewer", "csv", 403),
                               ("viewer", "json", 403), ("viewer", "project_pdf", 403), ("junior", "report_pdf", 403),
                               ("analyst", "csv", 200), ("analyst", "project_pdf", 200)]:
        r = client.post("/api/v1/exports", headers=heads[role], json={"kind": kind})
        assert r.status_code == status, (role, kind, r.text)


def test_auth_me_returns_screens_from_the_matrix(client, heads):
    for role in ROLE_IDS:
        a = client.get("/api/v1/auth/me", headers=heads[role]).json()["access"]
        assert [s["id"] for s in a["screens"]] == SCREENS[role]
        assert a["home"] == SCREENS[role][0]
    assert client.get("/api/v1/auth/me", headers=heads["admin"]).json()["access"]["home"] == "admin"
    assert client.get("/api/v1/auth/me", headers=heads["junior"]).json()["access"]["home"] == "young-explore"


def test_view_as_preview_is_read_only_and_uses_the_previewed_role(client, heads):
    h = {**heads["admin"], "X-View-As": "viewer"}
    me = client.get("/api/v1/auth/me", headers=h).json()
    assert me["preview"] == "viewer" and me["user"]["role"] == "admin"
    assert [s["id"] for s in me["access"]["screens"]] == SCREENS["viewer"]
    assert client.get("/api/v1/meta", headers=h).status_code == 200
    assert client.get("/api/v1/analytics/episodes", headers=h, params={"disease": "dengue"}).status_code == 403
    r = client.post("/api/v1/me/saved", headers=h, json={"name": "x", "district": "cbe", "disease": "dengue", "scenario": "baseline"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "preview_read_only"
    assert client.post("/api/v1/admin/view-as", headers=h, json={"role": None}).status_code == 200
    # analysts can't use the header
    assert client.get("/api/v1/meta", headers={**heads["analyst"], "X-View-As": "admin"}).status_code == 403
    assert any(e["action"] == "view_as" for e in app_module.audit.tail(200))


def test_role_change_and_disable_end_existing_sessions(client, heads):
    services.users.create("rolechange", "first-password-1", "analyst")
    r = client.post("/api/v1/auth/login", json={"username": "rolechange", "password": "first-password-1"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/api/v1/analytics/episodes", headers=h, params={"disease": "dengue"}).status_code == 200
    assert client.patch("/api/v1/admin/users/rolechange", headers=heads["admin"], json={"role": "viewer"}).status_code == 200
    r = client.get("/api/v1/meta", headers=h)
    assert r.status_code == 401 and r.json()["error"]["code"] == "session_changed"
    r = client.post("/api/v1/auth/login", json={"username": "rolechange", "password": "first-password-1"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert client.get("/api/v1/auth/me", headers=h).json()["access"]["role"] == "viewer"
    assert client.patch("/api/v1/admin/users/rolechange", headers=heads["admin"], json={"disabled": True}).status_code == 200
    assert client.get("/api/v1/meta", headers=h).json()["error"]["code"] == "account_disabled"
    r = client.post("/api/v1/auth/login", json={"username": "rolechange", "password": "first-password-1"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_disabled"
    actions = {e["action"] for e in app_module.audit.tail(200)}
    assert {"role_change", "user_disable"} <= actions


def test_admin_cannot_lock_themselves_out(client, heads):
    r = client.patch("/api/v1/admin/users/admin", headers=heads["admin"], json={"disabled": True})
    assert r.status_code == 400
    r = client.post("/api/v1/admin/users", headers=heads["admin"], json={"username": "short", "password": "short", "role": "viewer"})
    assert r.status_code == 400 and "10 characters" in r.json()["error"]["message"]
