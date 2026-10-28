"""Shared API plumbing: JSON responses, errors, the permission guard and id validation."""
from __future__ import annotations

import re

from fastapi import Request
from fastapi.responses import Response

from .data import NotFound
from .jsonutil import dumps
from .roles import ENDPOINTS, PREVIEW_WRITES, ROLE_IDS, allowed
from .services import audit, store, tokens, users

API = "/api/v1"
ID_RE = re.compile(r"^[a-z0-9_]+$")


class JSON(Response):
    media_type = "application/json"

    def render(self, content) -> bytes:
        return dumps(content)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict | None = None):
        self.status, self.code, self.message, self.headers = status, code, message, headers or {}


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _route_key(request: Request):
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    return request.method, path[len(API):] if path.startswith(API) else path


def authenticate(request: Request) -> dict:
    """Valid, unrevoked token for an account that still exists, is enabled and has not been changed since."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise ApiError(401, "unauthorized", "Sign in to use the API.")
    claims = tokens.decode(auth[7:].strip())
    if not claims:
        raise ApiError(401, "unauthorized", "Your session has expired or is not valid. Sign in again.")
    rec = users.get(claims["sub"])
    if not rec or rec.get("disabled"):
        tokens.revoke(claims)
        raise ApiError(401, "account_disabled", "This account is disabled. Ask an admin.")
    if int(rec.get("tv", 0)) != int(claims.get("tv", 0)) or rec["role"] != claims["role"]:
        tokens.revoke(claims)
        raise ApiError(401, "session_changed", "Your account was changed by an admin. Sign in again.")
    if tokens.needs_refresh(claims):
        request.state.new_token, _ = tokens.issue(rec, sid=claims["sid"])
    return claims


def guard(request: Request) -> dict:
    """Dependency on every API route: authenticate, then check the route's permission in roles.ENDPOINTS
    for the effective role (the admin's preview role when X-View-As is sent)."""
    key = _route_key(request)
    perm = ENDPOINTS.get(key)
    claims = authenticate(request)
    real = claims["role"]
    role = real
    preview = request.headers.get("x-view-as")
    if preview:
        if real != "admin" or preview not in ROLE_IDS:
            raise ApiError(403, "forbidden", "Only admins can preview another role.")
        if key[0] != "GET" and key not in PREVIEW_WRITES:
            raise ApiError(403, "preview_read_only", "This is a read-only preview of another role. Exit the preview to make changes.")
        if key not in PREVIEW_WRITES and key != ("GET", "/auth/me"):
            role = preview
    if perm is None:  # fail closed: a route nobody declared is nobody's
        raise ApiError(403, "forbidden", "This endpoint has no access rule.")
    if not allowed(role, perm):
        audit.write("forbidden", claims["sub"], real, client_ip(request), "denied",
                    f"{key[0]} {request.url.path}" + (f" (preview as {role})" if role != real else ""))
        raise ApiError(403, "forbidden", "Your account can't use this. Ask an admin if you need it.")
    return {**claims, "real_role": real, "role": role, "preview": role if role != real else None}


def ids(**kw):
    """Validate id format (400) then existence (404)."""
    for k, v in kw.items():
        if v is not None and not ID_RE.match(v):
            raise ApiError(400, "bad_request", f'Invalid {k} "{v[:40]}". IDs use lowercase letters, digits and underscores.')
    for k, v in kw.items():
        try:
            store.check(**{k: v})
        except NotFound as e:
            raise ApiError(404, f"unknown_{k}", str(e))


def mask_or_none(mask):
    return mask or "none"
