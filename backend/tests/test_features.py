"""Saved views, comments, usage events, insights, audit export and backups."""
import itertools
import zipfile
from pathlib import Path

import pytest

from backend import app as app_module
from backend import services
from backend.backup import BackupError

from .conftest import PASSWORDS

_n = itertools.count()


def login(client, username, password=None):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password or PASSWORDS[username]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def H(client):
    return {r: login(client, r) for r in PASSWORDS}


# ---------------------------------------------------------------------------- saved views and favourites
def test_saved_views_are_private_per_user(client, H):
    view = {"name": "Coimbatore monsoon", "screen": "compare", "district": "cbe", "disease": "dengue",
            "scenario": "delayed_monsoon", "scenario_b": "heavy_rain_decline", "mask": "cases_gap_3m"}
    r = client.post("/api/v1/me/saved", headers=H["analyst"], json=view)
    assert r.status_code == 200
    sid = r.json()["saved"]["id"]
    mine = client.get("/api/v1/me/saved", headers=H["analyst"]).json()["saved"]
    assert any(s["id"] == sid and s["scenario_b"] == "heavy_rain_decline" and s["mask"] == "cases_gap_3m" for s in mine)
    assert all(s["id"] != sid for s in client.get("/api/v1/me/saved", headers=H["viewer"]).json()["saved"])
    assert client.delete(f"/api/v1/me/saved/{sid}", headers=H["viewer"]).status_code == 404  # can't touch another user's
    assert client.delete(f"/api/v1/me/saved/{sid}", headers=H["analyst"]).status_code == 200
    assert client.post("/api/v1/me/saved", headers=H["analyst"], json={**view, "district": "XX"}).status_code == 400
    assert client.post("/api/v1/me/saved", headers=H["analyst"], json={**view, "name": " "}).status_code == 400


def test_favorites(client, H):
    assert client.post("/api/v1/me/favorites", headers=H["viewer"], json={"district": "tnj"}).json()["favorites"] == ["tnj"]
    assert "tnj" not in client.get("/api/v1/me/favorites", headers=H["analyst"]).json()["favorites"]
    assert client.post("/api/v1/me/favorites", headers=H["viewer"], json={"district": "zz"}).status_code == 404
    assert client.delete("/api/v1/me/favorites/tnj", headers=H["viewer"]).json()["favorites"] == []


# ---------------------------------------------------------------------------- comments
VIEW = "mdu.malaria.warmer"


def test_comments_are_plain_text_and_limited(client, H):
    evil = '<script>alert(1)</script><img src=x onerror="alert(2)"> 🦟 தமிழ்'
    r = client.post("/api/v1/comments", headers=H["analyst"], json={"view": VIEW, "text": evil, "month": "2023-04"})
    assert r.status_code == 200
    c = r.json()["comment"]
    assert c["text"] == evil and c["month"] == "2023-04" and c["mine"] is True  # stored verbatim, rendered as text by the UI
    assert "<script>" in r.text and r.headers["content-type"].startswith("application/json")
    assert client.post("/api/v1/comments", headers=H["analyst"], json={"view": VIEW, "text": "x" * 1001}).status_code == 400
    assert client.post("/api/v1/comments", headers=H["analyst"], json={"view": VIEW, "text": "   "}).status_code == 400
    assert client.post("/api/v1/comments", headers=H["analyst"], json={"view": "cbe.dengue", "text": "x"}).status_code == 400
    assert client.post("/api/v1/comments", headers=H["analyst"], json={"view": VIEW, "text": "x", "month": "2031-01"}).status_code == 400
    assert client.post("/api/v1/comments", headers=H["viewer"], json={"view": VIEW, "text": "viewer"}).status_code == 403
    listed = client.get("/api/v1/comments", headers=H["viewer"], params={"view": VIEW}).json()
    assert any(x["id"] == c["id"] and x["mine"] is False for x in listed["comments"])


def test_comment_rate_limit(client, H):
    app_module.comment_limiter.reset()
    codes = [client.post("/api/v1/comments", headers=H["admin"], json={"view": "try.dengue.baseline", "text": f"n{i}"}).status_code
             for i in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


def test_comment_edit_delete_and_moderation(client, H):
    c = client.post("/api/v1/comments", headers=H["analyst"], json={"view": VIEW, "text": "first"}).json()["comment"]
    assert client.patch(f"/api/v1/comments/{c['id']}", headers=H["admin"], json={"text": "not yours"}).status_code == 404
    assert client.patch(f"/api/v1/comments/{c['id']}", headers=H["analyst"], json={"text": "second"}).json()["comment"]["text"] == "second"
    assert client.patch(f"/api/v1/admin/comments/{c['id']}", headers=H["admin"], json={"hidden": True}).status_code == 200
    ids = [x["id"] for x in client.get("/api/v1/comments", headers=H["analyst"], params={"view": VIEW}).json()["comments"]]
    assert c["id"] not in ids
    assert any(x["id"] == c["id"] and x["hidden"] for x in client.get("/api/v1/admin/comments", headers=H["admin"]).json()["comments"])
    assert client.delete(f"/api/v1/admin/comments/{c['id']}", headers=H["admin"]).status_code == 200
    c2 = client.post("/api/v1/comments", headers=H["analyst"], json={"view": VIEW, "text": "mine"}).json()["comment"]
    assert client.delete(f"/api/v1/comments/{c2['id']}", headers=H["analyst"]).status_code == 200
    actions = {e["action"] for e in app_module.audit.tail(300)}
    assert {"comment_post", "comment_edit", "comment_hide", "comment_delete_admin", "comment_delete"} <= actions


# ---------------------------------------------------------------------------- usage events and stats
def test_usage_events_feed_the_admin_dashboard(client, H):
    before = client.get("/api/v1/admin/usage", headers=H["admin"]).json()
    for _ in range(3):
        assert client.post("/api/v1/events", headers=H["viewer"], json={"event": "screen_open", "screen": "compare"}).status_code == 200
    client.post("/api/v1/events", headers=H["analyst"], json={"event": "simulation_view", "screen": "simulator",
                                                              "district": "chn", "disease": "malaria", "scenario": "warm_wet"})
    client.post("/api/v1/auth/login", json={"username": "viewer", "password": "wrong-one"})
    client.post("/api/v1/exports", headers=H["analyst"], json={"kind": "csv"})
    after = client.get("/api/v1/admin/usage", headers=H["admin"]).json()
    top = {x["key"]: x["count"] for x in after["top_screens"]}
    assert top.get("compare", 0) >= 3
    assert sum(d["failed_logins"] for d in after["per_day"]) > sum(d["failed_logins"] for d in before["per_day"])
    assert any(x["key"] == "csv" for x in after["exports_by_kind"])
    assert any(x["key"] == "chn|malaria|warm_wet" for x in after["top_scenarios"])
    assert after["active_users_today"] >= 2 and after["active_users_7d"] >= 2
    assert {"viewer", "analyst"} <= {x["key"] for x in after["sessions_by_role"]}
    assert client.post("/api/v1/events", headers=H["viewer"], json={"event": "keystroke"}).status_code == 400
    assert client.post("/api/v1/events", headers=H["viewer"], json={"event": "screen_open", "screen": "<b>"}).status_code == 400
    assert client.get("/api/v1/admin/usage", headers=H["admin"], params={"from": "2026-13-01"}).status_code == 400
    users = client.get("/api/v1/admin/users", headers=H["admin"]).json()["users"]
    assert next(u for u in users if u["username"] == "viewer")["last_login"]


def test_insights_need_three_distinct_users_for_coviews(client, H):
    r = client.get("/api/v1/insights", headers=H["viewer"], params={"district": "cbe", "disease": "dengue", "scenario": "delayed_monsoon"})
    body = r.json()
    assert 1 <= len(body["insights"]) <= 3 and all(i["kind"] == "rule" for i in body["insights"])
    first = body["insights"][0]["text"]  # Coimbatore dengue: four rain scenarios tie at +10 months in the API
    assert "+10 months" in first and all(x in first for x in ("Delayed monsoon", "Prolonged wet spell", "Irregular rain"))
    for k in range(3):
        name = f"cov_{next(_n)}"
        services.users.create(name, "coview-password-1", "viewer")
        h = login(client, name, "coview-password-1")
        for d, z in (("try", "malaria"), ("tnj", "dengue")):
            client.post("/api/v1/events", headers=h, json={"event": "simulation_view", "district": d, "disease": z, "scenario": "baseline"})
        if k == 1:  # only two users so far: no suggestion yet
            r = client.get("/api/v1/insights", headers=H["analyst"], params={"district": "try", "disease": "malaria"})
            assert not any(i["kind"] == "coview" for i in r.json()["insights"])
    r = client.get("/api/v1/insights", headers=H["analyst"], params={"district": "try", "disease": "malaria"}).json()
    assert r["insights"][0]["kind"] == "coview" and "Thanjavur" in r["insights"][0]["text"] and "3 users" in r["insights"][0]["text"]


# ---------------------------------------------------------------------------- audit export
def test_audit_log_filters_and_csv(client, H):
    r = client.get("/api/v1/audit-log", headers=H["admin"], params={"event": "login", "user": "viewer"}).json()
    assert r["entries"] and all(e["action"] == "login" and e["user"] == "viewer" for e in r["entries"])
    app_module.audit.write("probe", "=cmd|' /C calc'!A0", None, None, "ok", "+SUM(1)")
    csv = client.get("/api/v1/audit-log.csv", headers=H["admin"], params={"event": "probe"})
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    assert csv.text.splitlines()[0] == "ts,action,user,role,ip,status,detail"
    assert "'=cmd" in csv.text and "'+SUM" in csv.text  # spreadsheet formulas neutralised


# ---------------------------------------------------------------------------- backups
def test_backup_archive_and_verified_restore(client, H):
    r = client.post("/api/v1/admin/backups", headers=H["admin"])
    assert r.status_code == 200
    b = r.json()["backup"]
    archive = services.backups.dir / b["name"]
    with zipfile.ZipFile(archive) as z:
        names = set(z.namelist())
    assert {"app.db", "users.json", "audit.jsonl"} <= names
    assert services.backups.verify(archive) == b["sha256"]
    assert any(x["name"] == b["name"] for x in client.get("/api/v1/admin/backups", headers=H["admin"]).json()["backups"])
    # restore puts the snapshot back
    client.post("/api/v1/comments", headers=H["analyst"], json={"view": "chn.dengue.baseline", "text": "after the backup"})
    restored = services.backups.restore(archive)
    assert "app.db" in restored
    assert all(c["text"] != "after the backup" for c in services.db.comments("chn.dengue.baseline"))
    # a tampered archive is refused
    tampered = archive.with_name("epimetrics_backup_tampered.zip")
    tampered.write_bytes(archive.read_bytes() + b"x")
    Path(str(tampered) + ".sha256").write_text(Path(str(archive) + ".sha256").read_text())
    with pytest.raises(BackupError, match="Checksum mismatch"):
        services.backups.restore(tampered)
    assert any(e["action"] == "backup" for e in app_module.audit.tail(100))  # restore kept the newer audit log


def test_backups_keep_the_newest_14(client, H):
    for _ in range(16):
        services.backups.create()
    assert len(services.backups.list()) == 14
