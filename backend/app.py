"""FastAPI app: the JSON API under /api/v1 and the website from frontend/ on the same origin."""
from __future__ import annotations

import os
import re
import secrets
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import integrity
from .analytics import Analytics
from .data import ROOT, NotFound, Store
from .jsonutil import dumps
from .security import AuditLog, LoginLimiter, TokenService, UserStore, session_seconds

API = "/api/v1"
FRONTEND = ROOT / "frontend"
ID_RE = re.compile(r"^[a-z0-9_]+$")
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; "
       "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")

store = Store()
analytics = Analytics(store)
users = UserStore()
tokens = TokenService()
limiter = LoginLimiter()
audit = AuditLog()


class JSON(Response):
    media_type = "application/json"

    def render(self, content) -> bytes:
        return dumps(content)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict | None = None):
        self.status, self.code, self.message, self.headers = status, code, message, headers or {}


def err(status, code, message, headers=None):
    return JSON({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.environ.get("EPIMETRICS_WARM", "1") != "0":
        threading.Thread(target=analytics.warm, name="model-warmup", daemon=True).start()
    yield


app = FastAPI(title="EpiMetrics-Climate API", version="1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


# ---------------------------------------------------------------------------- errors and headers
@app.exception_handler(ApiError)
async def _api_error(request: Request, e: ApiError):
    return err(e.status, e.code, e.message, e.headers)


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, e: RequestValidationError):
    first = e.errors()[0] if e.errors() else {}
    where = ".".join(str(x) for x in first.get("loc", []) if x not in ("query", "body"))
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


# ---------------------------------------------------------------------------- auth helpers
def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def current_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise ApiError(401, "unauthorized", "Sign in to use the API.")
    claims = tokens.decode(auth[7:].strip())
    if not claims:
        raise ApiError(401, "unauthorized", "Your session has expired or is not valid. Sign in again.")
    if tokens.needs_refresh(claims):
        request.state.new_token, _ = tokens.issue({"username": claims["sub"], "role": claims["role"],
                                                   "display_name": claims["name"]}, sid=claims["sid"])
    request.state.user = claims
    return claims


def require(*roles):
    def dep(request: Request, user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            audit.write("forbidden", user["sub"], user["role"], client_ip(request), "denied", request.url.path)
            raise ApiError(403, "forbidden", f"{user['role'].capitalize()} accounts can't use this. It needs: {', '.join(roles)}.")
        return user
    return dep


ANY = Depends(current_user)
ANALYST = Depends(require("analyst", "admin"))
ADMIN = Depends(require("admin"))


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


def _mask(mask):
    return mask or "none"


# ---------------------------------------------------------------------------- auth endpoints
class LoginBody(BaseModel):
    username: str
    password: str


@app.post(f"{API}/auth/login")
def login(body: LoginBody, request: Request):
    username = body.username.strip().lower()[:64]
    ip = client_ip(request)
    wait = limiter.locked_for(username, ip)
    if wait:
        audit.write("login", username, None, ip, "locked")
        raise ApiError(429, "too_many_attempts", f"Too many wrong attempts. Try again in {wait} seconds.", {"Retry-After": str(wait)})
    user = users.authenticate(username, body.password) if username and body.password else None
    if not user:
        just_locked = limiter.failure(username, ip)
        audit.write("login", username, None, ip, "failed")
        if just_locked:
            raise ApiError(429, "too_many_attempts", f"Too many wrong attempts. Sign-in is paused for {limiter.lock_seconds} seconds.",
                           {"Retry-After": str(limiter.lock_seconds)})
        raise ApiError(401, "bad_credentials", "Username or password is incorrect.")
    limiter.success(username, ip)
    token, ttl = tokens.issue(user)
    audit.write("login", user["username"], user["role"], ip, "ok")
    return JSON({"token": token, "expires_in": ttl,
                 "user": {"username": user["username"], "display_name": user["display_name"], "role": user["role"]}})


@app.post(f"{API}/auth/logout")
def logout(request: Request, user: dict = ANY):
    tokens.revoke(user)
    request.state.new_token = None
    audit.write("logout", user["sub"], user["role"], client_ip(request))
    return JSON({"ok": True})


@app.get(f"{API}/auth/me")
def me(user: dict = ANY):
    return JSON({"user": {"username": user["sub"], "display_name": user["name"], "role": user["role"]},
                 "expires_in": session_seconds()})


# ---------------------------------------------------------------------------- data endpoints
@app.get(f"{API}/health")
def health():
    ready, total = analytics.models_ready()
    w = analytics.warm_state
    return JSON({"status": "ok", "synthetic": True, "api_version": "1.0", "models_ready": ready == total,
                 "models_cached": ready, "models_total": total,
                 "warmup": {"running": w["started"] and not w["finished_at"], "error": w["error"]}})


@app.get(f"{API}/meta")
def meta(user: dict = ANY):
    return JSON(store.meta())


@app.get(f"{API}/districts")
def districts(user: dict = ANY):
    return JSON(store.districts())


@app.get(f"{API}/simulations")
def simulations(request: Request, district: str = Query(...), disease: str = Query(...), scenario: str = Query(...),
                mask: str | None = Query(None), user: dict = ANY):
    ids(district=district, disease=disease, scenario=scenario, mask=mask)
    audit.write("simulation", user["sub"], user["role"], client_ip(request),
                detail={"district": district, "disease": disease, "scenario": scenario, "mask": mask})
    return JSON(store.simulation(district, disease, scenario, _mask(mask)))


@app.get(f"{API}/recovery-matrix")
def recovery_matrix(disease: str = Query(...), mask: str | None = Query(None), user: dict = ANY):
    ids(disease=disease, mask=mask)
    return JSON(store.recovery_matrix(disease, _mask(mask)))


@app.get(f"{API}/validation")
def validation(disease: str = Query(...), user: dict = ANALYST):
    ids(disease=disease)
    return JSON(store.validation(disease))


@app.get(f"{API}/analytics/data-audit")
def data_audit(user: dict = ANY):
    return JSON(analytics.data_audit())


@app.get(f"{API}/analytics/eda")
def eda(district: str = Query(...), disease: str = Query(...), user: dict = ANY):
    ids(district=district, disease=disease)
    return JSON(analytics.eda(district, disease))


@app.get(f"{API}/analytics/forecasts")
def forecasts(district: str = Query(...), disease: str = Query(...), user: dict = ANY):
    ids(district=district, disease=disease)
    return JSON(analytics.forecasts(district, disease))


@app.get(f"{API}/analytics/forecast-summary")
def forecast_summary(disease: str = Query(...), user: dict = ANY):
    ids(disease=disease)
    return JSON(analytics.forecast_summary(disease))


@app.get(f"{API}/analytics/episodes")
def episodes(disease: str = Query(...), user: dict = ANY):
    ids(disease=disease)
    return JSON(analytics.episodes(disease))


# ---------------------------------------------------------------------------- exports, integrity, audit
EXPORT_KINDS = {"report_pdf", "project_pdf", "json", "csv"}


class ExportBody(BaseModel):
    kind: str
    district: str | None = None
    disease: str | None = None
    scenario: str | None = None
    mask: str | None = None


@app.post(f"{API}/exports")
def exports(body: ExportBody, request: Request, user: dict = ANALYST):
    if body.kind not in EXPORT_KINDS:
        raise ApiError(400, "bad_request", f"Unknown export kind. Use one of: {', '.join(sorted(EXPORT_KINDS))}.")
    ids(district=body.district, disease=body.disease, scenario=body.scenario, mask=body.mask)
    export_id = secrets.token_hex(6)
    detail = {"kind": body.kind, "export_id": export_id,
              **{k: v for k, v in body.model_dump().items() if k != "kind" and v is not None}}
    audit.write("export", user["sub"], user["role"], client_ip(request), detail=detail)
    return JSON({"synthetic": True, "ok": True, "export_id": export_id, "kind": body.kind,
                 "logged_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})


@app.get(f"{API}/integrity")
def get_integrity(user: dict = ANY):
    man = integrity.load_manifest()
    if user["role"] == "admin" and man:
        return JSON({**man, "scope": "full"})
    return JSON({**integrity.summary(man), "scope": "summary"})


@app.post(f"{API}/integrity/verify")
def verify_integrity(request: Request, user: dict = ADMIN):
    res = integrity.verify(integrity.load_manifest())
    audit.write("integrity_verify", user["sub"], user["role"], client_ip(request),
                "ok" if res["all_match"] else "mismatch", {"files": res.get("n_files"), "match": res.get("n_match")})
    return JSON(res)


_SEM_LINE = re.compile(r"^\[(PASS|FLAG)\]\s+(.*?)(?:\s+->\s+(.*))?$")


def run_validation():
    t = time.time()
    proc = subprocess.run([sys.executable, str(ROOT / "src" / "verify_semantics.py"), str(ROOT)],
                          capture_output=True, text=True, timeout=300, cwd=str(ROOT))
    semantic = []
    for ln in proc.stdout.splitlines():
        m = _SEM_LINE.match(ln.strip())
        if m:
            semantic.append({"group": "verify_semantics.py", "name": m.group(2).strip(), "pass": m.group(1) == "PASS",
                             "detail": (m.group(3) or "")[:400]})
    ev = store.engine_vs_runs()
    engine_check = {"group": "recovery engine", "name": "Live engine reproduces outputs/simulation_runs.csv",
                    "pass": not ev["mismatches"], "detail": f"{ev['rows']} rows, {len(ev['mismatches'])} mismatches"}
    units = [{"group": "unit tests (notebook 06)", "name": u["name"], "pass": u["pass"], "detail": u["detail"]}
             for u in analytics.unit_tests()]
    checks = semantic + [engine_check] + units
    return {"synthetic": True, "checks": checks,
            "semantic": {"total": len(semantic), "passed": sum(c["pass"] for c in semantic), "exit_code": proc.returncode,
                         "stderr": proc.stderr[-800:] if proc.returncode else ""},
            "total": len(checks), "passed": sum(c["pass"] for c in checks),
            "all_pass": proc.returncode == 0 and all(c["pass"] for c in checks) and len(semantic) > 0,
            "seconds": round(time.time() - t, 1)}


@app.post(f"{API}/integrity/validate")
def validate(request: Request, user: dict = ADMIN):
    res = run_validation()
    audit.write("integrity_validate", user["sub"], user["role"], client_ip(request),
                "ok" if res["all_pass"] else "failed", {"passed": res["passed"], "total": res["total"]})
    return JSON(res)


@app.get(f"{API}/audit-log")
def audit_log(limit: int = Query(200, ge=1, le=1000), user: dict = ADMIN):
    return JSON({"synthetic": True, "entries": audit.tail(limit)})


@app.api_route(f"{API}/{{rest:path}}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def api_not_found(rest: str):
    raise ApiError(404, "unknown_endpoint", f"There is no API endpoint /{rest[:60]}.")


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def api_root_not_found(rest: str):
    raise ApiError(404, "unknown_endpoint", "The API lives under /api/v1.")


# The website. Mounted LAST so it never shadows the API routes.
app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
