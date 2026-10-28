"""Admin console endpoints: usage dashboard, user management, audit log, comment moderation, backups, view-as."""
from __future__ import annotations

import re
import time

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from .common import JSON, ApiError, client_ip, guard
from .roles import ROLE_IDS, ROLE_INFO, describe
from .routes_core import record
from .security import UserError
from .services import audit, backups, db, users

router = APIRouter()
G = Depends(guard)
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _day(offset_days=0):
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() + offset_days * 86400))


def _range(day_from, day_to, default_days=7):
    day_to = day_to or _day()
    day_from = day_from or _day(-(default_days - 1))
    for d in (day_from, day_to):
        if not DAY_RE.match(d):
            raise ApiError(400, "bad_request", "Dates use YYYY-MM-DD.")
    if day_from > day_to:
        raise ApiError(400, "bad_request", "The start date is after the end date.")
    return day_from, day_to


def _admin_action(request: Request, user: dict, action: str, detail=None, status="ok"):
    audit.write(action, user["sub"], user["real_role"], client_ip(request), status, detail)
    record("admin_action", user, screen=action[:32])


# ---------------------------------------------------------------------------- usage
@router.get("/admin/usage")
def usage(day_from: str | None = Query(None, alias="from"), day_to: str | None = Query(None, alias="to"), user: dict = G):
    a, b = _range(day_from, day_to)
    stats = db.usage(a, b)
    stats["active_users_7d"] = db.usage(_day(-6), _day())["active_users_range"]
    return JSON({"synthetic": True, **stats,
                 "note": "Counts from anonymised usage events (no free text). Failed sign-ins are stored without a username."})


# ---------------------------------------------------------------------------- users
class NewUser(BaseModel):
    username: str
    password: str
    role: str
    display_name: str | None = None


class UserPatch(BaseModel):
    role: str | None = None
    disabled: bool | None = None
    display_name: str | None = None


class PasswordBody(BaseModel):
    password: str


def _user_rows():
    last = db.last_logins()
    return [{**u, "last_login": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last[u["username"]])) if u["username"] in last else None,
             "role_label": ROLE_INFO[u["role"]]["label"]} for u in users.list()]


@router.get("/admin/users")
def list_users(user: dict = G):
    return JSON({"synthetic": True, "users": _user_rows(), "roles": [{"id": r, **ROLE_INFO[r]} for r in ROLE_IDS]})


@router.post("/admin/users")
def create_user(body: NewUser, request: Request, user: dict = G):
    try:
        rec = users.create(body.username.strip().lower(), body.password, body.role, body.display_name)
    except UserError as e:
        raise ApiError(400, "bad_request", str(e))
    _admin_action(request, user, "user_create", {"username": rec["username"], "role": rec["role"]})
    return JSON({"synthetic": True, "users": _user_rows()})


@router.patch("/admin/users/{username}")
def update_user(username: str, body: UserPatch, request: Request, user: dict = G):
    if username == user["sub"] and (body.disabled or (body.role and body.role != "admin")):
        raise ApiError(400, "bad_request", "You can't disable your own account or remove your own admin role.")
    before = users.get(username)
    try:
        rec = users.update(username, role=body.role, disabled=body.disabled, display_name=body.display_name)
    except UserError as e:
        raise ApiError(404 if "Unknown user" in str(e) else 400, "bad_request", str(e))
    if body.role and before and body.role != before["role"]:
        _admin_action(request, user, "role_change", {"username": username, "from": before["role"], "to": body.role})
    if body.disabled is not None and before and bool(body.disabled) != bool(before.get("disabled")):
        _admin_action(request, user, "user_disable" if body.disabled else "user_enable", {"username": username})
    if body.display_name is not None:
        _admin_action(request, user, "user_rename", {"username": username})
    return JSON({"synthetic": True, "user": {k: rec.get(k) for k in ("username", "display_name", "role", "disabled")}, "users": _user_rows()})


@router.post("/admin/users/{username}/password")
def reset_password(username: str, body: PasswordBody, request: Request, user: dict = G):
    try:
        users.update(username, password=body.password)
    except UserError as e:
        raise ApiError(404 if "Unknown user" in str(e) else 400, "bad_request", str(e))
    _admin_action(request, user, "password_reset", {"username": username})
    return JSON({"synthetic": True, "ok": True})


# ---------------------------------------------------------------------------- audit log
@router.get("/audit-log")
def audit_log(limit: int = Query(200, ge=1, le=5000), user_filter: str | None = Query(None, alias="user"),
              action: str | None = Query(None, alias="event"), day_from: str | None = Query(None, alias="from"),
              day_to: str | None = Query(None, alias="to"), user: dict = G):
    for d in (day_from, day_to):
        if d and not DAY_RE.match(d):
            raise ApiError(400, "bad_request", "Dates use YYYY-MM-DD.")
    entries = audit.query(user_filter, action, day_from, day_to, limit)
    actions = sorted({e.get("action") for e in audit.tail(5000) if e.get("action")})
    return JSON({"synthetic": True, "entries": entries, "actions": actions})


@router.get("/audit-log.csv")
def audit_csv(request: Request, user_filter: str | None = Query(None, alias="user"), action: str | None = Query(None, alias="event"),
              day_from: str | None = Query(None, alias="from"), day_to: str | None = Query(None, alias="to"), user: dict = G):
    entries = audit.query(user_filter, action, day_from, day_to, 100000)
    _admin_action(request, user, "audit_export", {"rows": len(entries)})
    return Response(audit.to_csv(entries), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="epimetrics_audit_{_day()}.csv"'})


# ---------------------------------------------------------------------------- comment moderation
class ModerationBody(BaseModel):
    hidden: bool


@router.get("/admin/comments")
def admin_comments(user: dict = G):
    return JSON({"synthetic": True, "comments": db.all_comments()})


@router.patch("/admin/comments/{comment_id}")
def moderate_comment(comment_id: int, body: ModerationBody, request: Request, user: dict = G):
    if not db.comment(comment_id):
        raise ApiError(404, "unknown_comment", "No comment with this id.")
    c = db.set_comment_flags(comment_id, hidden=body.hidden, moderated_by=user["sub"])
    _admin_action(request, user, "comment_hide" if body.hidden else "comment_unhide", {"id": comment_id})
    return JSON({"synthetic": True, "comment": c})


@router.delete("/admin/comments/{comment_id}")
def admin_delete_comment(comment_id: int, request: Request, user: dict = G):
    if not db.comment(comment_id):
        raise ApiError(404, "unknown_comment", "No comment with this id.")
    db.set_comment_flags(comment_id, deleted=True, moderated_by=user["sub"])
    _admin_action(request, user, "comment_delete_admin", {"id": comment_id})
    return JSON({"synthetic": True, "ok": True})


# ---------------------------------------------------------------------------- backups
@router.get("/admin/backups")
def list_backups(user: dict = G):
    return JSON({"synthetic": True, "backups": backups.list(), "keep": 14,
                 "restore": "Restore is command-line only: python -m backend.manage restore <file> (stop the server first)."})


@router.post("/admin/backups")
def create_backup(request: Request, user: dict = G):
    b = backups.create()
    _admin_action(request, user, "backup", {"name": b["name"], "sha256": b["sha256"][:16]})
    return JSON({"synthetic": True, "backup": b, "backups": backups.list()})


# ---------------------------------------------------------------------------- view as
class ViewAsBody(BaseModel):
    role: str | None = None  # None = end the preview


@router.post("/admin/view-as")
def view_as(body: ViewAsBody, request: Request, user: dict = G):
    if body.role is not None and body.role not in ROLE_IDS:
        raise ApiError(400, "bad_request", f"Role must be one of: {', '.join(ROLE_IDS)}.")
    _admin_action(request, user, "view_as", {"role": body.role or "admin (end preview)"})
    return JSON({"synthetic": True, "preview": body.role if body.role and body.role != "admin" else None,
                 "access": describe(body.role or "admin")})
