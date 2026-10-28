"""FastAPI app: the JSON API under /api/v1 and the website from frontend/ on the same origin.

Routes live in routes_core.py (auth, dataset, analytics, exports, integrity), routes_me.py (saved views,
favourites, insights, comments) and routes_admin.py (usage, users, audit, moderation, backups, view-as).
Who may call what is decided by backend/roles.py through common.guard.
"""
from __future__ import annotations

import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import routes_admin, routes_core, routes_me
from .common import API, JSON, ApiError
from .data import ROOT
from .routes_core import run_validation  # noqa: F401  (used by backend.manage)
from .routes_me import comment_limiter  # noqa: F401  (reset by the tests)
from .services import analytics, audit, backups, db, limiter, store  # noqa: F401  (re-exported for tests and manage)

FRONTEND = ROOT / "frontend"
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; "
       "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")


def err(status, code, message, headers=None):
    return JSON({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


def _maintenance_loop(hours: float):
    """Optional automatic backups (EPIMETRICS_BACKUP_HOURS) plus the usage-event retention purge."""
    while True:
        time.sleep(max(hours, 0.01) * 3600)
        try:
            db.purge()
            b = backups.create()
            audit.write("backup", "system", None, None, "ok", {"name": b["name"], "automatic": True})
        except Exception as e:  # pragma: no cover - logged for the admin
            audit.write("backup", "system", None, None, "error", f"{type(e).__name__}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    purged = db.purge()
    if purged:
        audit.write("events_purge", "system", None, None, "ok", {"rows": purged})
    if os.environ.get("EPIMETRICS_WARM", "1") != "0":
        threading.Thread(target=analytics.warm, name="model-warmup", daemon=True).start()
    hours = float(os.environ.get("EPIMETRICS_BACKUP_HOURS", "0") or 0)
    if hours > 0:
        threading.Thread(target=_maintenance_loop, args=(hours,), name="backups", daemon=True).start()
    yield


app = FastAPI(title="EpiMetrics-Climate API", version="1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(ApiError)
async def _api_error(request: Request, e: ApiError):
    return err(e.status, e.code, e.message, e.headers)


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    where = ".".join(str(x) for x in first.get("loc", []) if x not in ("query", "body", "path"))
    return err(400, "bad_request", f"Invalid or missing parameter: {where or 'request'} ({first.get('msg', 'invalid')}).")


@app.exception_handler(StarletteHTTPException)
async def _http_error(request: Request, e: StarletteHTTPException):
    if request.url.path.startswith("/api/"):
        return err(e.status_code, f"http_{e.status_code}", str(e.detail))
    return Response(str(e.detail), status_code=e.status_code, media_type="text/plain")


@app.exception_handler(Exception)
async def _unhandled(request: Request, e: Exception):  # pragma: no cover - last resort
    audit.write("server_error", status="error", detail=f"{request.url.path}: {type(e).__name__}")
    return err(500, "server_error", "The server could not complete this request.")


@app.middleware("http")
async def headers_mw(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h["Content-Security-Policy"] = CSP
    h["X-Frame-Options"] = "DENY"
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "no-referrer"
    h["Cross-Origin-Opener-Policy"] = "same-origin"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/"):
        h["Cache-Control"] = "no-store"
        new = getattr(request.state, "new_token", None)
        if new:
            h["X-Session-Token"] = new
    else:
        h["Cache-Control"] = "no-cache"
    return response


for r in (routes_core.router, routes_me.router, routes_admin.router):
    app.include_router(r, prefix=API)


@app.api_route(f"{API}/{{rest:path}}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def api_not_found(rest: str):
    raise ApiError(404, "unknown_endpoint", f"There is no API endpoint /{rest[:60]}.")


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def api_root_not_found(rest: str):
    raise ApiError(404, "unknown_endpoint", "The API lives under /api/v1.")


# The website. Mounted LAST so it never shadows the API routes.
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
