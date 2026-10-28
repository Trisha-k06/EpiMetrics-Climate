"""Auth, dataset, analytics, exports and integrity endpoints."""
from __future__ import annotations

import re
import secrets
import subprocess
import sys
import time

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from . import integrity
from .common import JSON, ApiError, client_ip, guard, ids, mask_or_none
from .data import ROOT
from .roles import EXPORT_PERMS, allowed, describe
from .security import session_seconds
from .services import analytics, audit, db, limiter, store, tokens, users

router = APIRouter()
G = Depends(guard)


def record(event: str, user: dict, **fields):
    """Usage event for the admin dashboard and recommendations (counts only, no free text)."""
    db.event(event, username=user["sub"], role=user["real_role"], session_id=user.get("sid"), **fields)


# ---------------------------------------------------------------------------- auth
class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
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
        db.event("login_failed")  # no username stored for failures: it may be a typo of someone's password
        if just_locked:
            raise ApiError(429, "too_many_attempts", f"Too many wrong attempts. Sign-in is paused for {limiter.lock_seconds} seconds.",
                           {"Retry-After": str(limiter.lock_seconds)})
        raise ApiError(401, "bad_credentials", "Username or password is incorrect.")
    if user.get("disabled"):
        audit.write("login", username, user["role"], ip, "disabled")
        raise ApiError(403, "account_disabled", "This account is disabled. Ask an admin.")
    limiter.success(username, ip)
    token, ttl = tokens.issue(user)
    claims = tokens.decode(token)
    audit.write("login", user["username"], user["role"], ip, "ok")
    db.event("login", username=user["username"], role=user["role"], session_id=claims["sid"])
    return JSON({"token": token, "expires_in": ttl,
                 "user": {"username": user["username"], "display_name": user["display_name"], "role": user["role"]},
                 "access": describe(user["role"])})


@router.post("/auth/logout")
def logout(request: Request, user: dict = G):
    tokens.revoke(user)
    request.state.new_token = None
    audit.write("logout", user["sub"], user["real_role"], client_ip(request))
    record("logout", user)
    return JSON({"ok": True})


@router.get("/auth/me")
def me(request: Request, user: dict = G):
    preview = request.headers.get("x-view-as")
    effective = preview if preview and user["real_role"] == "admin" else user["real_role"]
    return JSON({"user": {"username": user["sub"], "display_name": user["name"], "role": user["real_role"]},
                 "access": describe(effective), "preview": effective if effective != user["real_role"] else None,
                 "expires_in": session_seconds()})


# ---------------------------------------------------------------------------- events
class EventBody(BaseModel):
    event: str
    screen: str | None = None
    district: str | None = None
    disease: str | None = None
    scenario: str | None = None


CLIENT_EVENTS = {"screen_open", "simulation_view", "compare", "drilldown", "young_activity"}


@router.post("/events")
def post_event(body: EventBody, user: dict = G):
    if body.event not in CLIENT_EVENTS:
        raise ApiError(400, "bad_request", f"Unknown event. Use one of: {', '.join(sorted(CLIENT_EVENTS))}.")
    if body.screen is not None and not re.match(r"^[a-z0-9_-]{1,32}$", body.screen):
        raise ApiError(400, "bad_request", "Invalid screen id.")
    ids(district=body.district, disease=body.disease, scenario=body.scenario)
    record(body.event, user, screen=body.screen, district=body.district, disease=body.disease, scenario=body.scenario)
    return JSON({"synthetic": True, "ok": True})


# ---------------------------------------------------------------------------- dataset
@router.get("/health")
def health():
    ready, total = analytics.models_ready()
    w = analytics.warm_state
    return JSON({"status": "ok", "synthetic": True, "api_version": "1.0", "models_ready": ready == total,
                 "models_cached": ready, "models_total": total,
                 "warmup": {"running": w["started"] and not w["finished_at"], "error": w["error"]}})


@router.get("/meta")
def meta(user: dict = G):
    return JSON(store.meta())


@router.get("/districts")
def districts(user: dict = G):
    return JSON(store.districts())


@router.get("/simulations")
def simulations(request: Request, district: str = Query(...), disease: str = Query(...), scenario: str = Query(...),
                mask: str | None = Query(None), user: dict = G):
    ids(district=district, disease=disease, scenario=scenario, mask=mask)
    audit.write("simulation", user["sub"], user["real_role"], client_ip(request),
                detail={"district": district, "disease": disease, "scenario": scenario, "mask": mask or "none"})
    return JSON(store.simulation(district, disease, scenario, mask_or_none(mask)))


@router.get("/recovery-matrix")
def recovery_matrix(disease: str = Query(...), mask: str | None = Query(None), user: dict = G):
    ids(disease=disease, mask=mask)
    return JSON(store.recovery_matrix(disease, mask_or_none(mask)))


@router.get("/validation")
def validation(disease: str = Query(...), user: dict = G):
    ids(disease=disease)
    return JSON(store.validation(disease))


@router.get("/analytics/data-audit")
def data_audit(user: dict = G):
    return JSON(analytics.data_audit())


@router.get("/analytics/eda")
def eda(district: str = Query(...), disease: str = Query(...), user: dict = G):
    ids(district=district, disease=disease)
    return JSON(analytics.eda(district, disease))


@router.get("/analytics/forecasts")
def forecasts(district: str = Query(...), disease: str = Query(...), user: dict = G):
    ids(district=district, disease=disease)
    return JSON(analytics.forecasts(district, disease))


@router.get("/analytics/forecast-summary")
def forecast_summary(disease: str = Query(...), user: dict = G):
    ids(disease=disease)
    return JSON(analytics.forecast_summary(disease))


@router.get("/analytics/episodes")
def episodes(disease: str = Query(...), user: dict = G):
    ids(disease=disease)
    return JSON(analytics.episodes(disease))


# ---------------------------------------------------------------------------- exports
class ExportBody(BaseModel):
    kind: str
    district: str | None = None
    disease: str | None = None
    scenario: str | None = None
    mask: str | None = None
    with_comments: bool | None = None


@router.post("/exports")
def exports(body: ExportBody, request: Request, user: dict = G):
    if body.kind not in EXPORT_PERMS:
        raise ApiError(400, "bad_request", f"Unknown export kind. Use one of: {', '.join(sorted(EXPORT_PERMS))}.")
    if not allowed(user["role"], EXPORT_PERMS[body.kind]):
        audit.write("export", user["sub"], user["real_role"], client_ip(request), "denied", {"kind": body.kind})
        raise ApiError(403, "forbidden", "Your account can't create this kind of export.")
    ids(district=body.district, disease=body.disease, scenario=body.scenario, mask=body.mask)
    export_id = secrets.token_hex(6)
    detail = {"kind": body.kind, "export_id": export_id,
              **{k: v for k, v in body.model_dump().items() if k != "kind" and v is not None}}
    audit.write("export", user["sub"], user["real_role"], client_ip(request), detail=detail)
    record("export", user, district=body.district, disease=body.disease, scenario=body.scenario, export_kind=body.kind)
    return JSON({"synthetic": True, "ok": True, "export_id": export_id, "kind": body.kind,
                 "logged_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})


# ---------------------------------------------------------------------------- integrity
@router.get("/integrity")
def get_integrity(user: dict = G):
    man = integrity.load_manifest()
    if allowed(user["role"], "integrity.admin") and man:
        return JSON({**man, "scope": "full"})
    return JSON({**integrity.summary(man), "scope": "summary"})


@router.post("/integrity/verify")
def verify_integrity(request: Request, user: dict = G):
    res = integrity.verify(integrity.load_manifest())
    audit.write("integrity_verify", user["sub"], user["real_role"], client_ip(request),
                "ok" if res["all_match"] else "mismatch", {"files": res.get("n_files"), "match": res.get("n_match")})
    record("admin_action", user, screen="integrity_verify")
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


@router.post("/integrity/validate")
def validate(request: Request, user: dict = G):
    res = run_validation()
    audit.write("integrity_validate", user["sub"], user["real_role"], client_ip(request),
                "ok" if res["all_pass"] else "failed", {"passed": res["passed"], "total": res["total"]})
    record("admin_action", user, screen="integrity_validate")
    return JSON(res)
