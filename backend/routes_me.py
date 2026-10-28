"""Per-user state: saved views, favourite districts, recommended insights and team comments."""
from __future__ import annotations

import re
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from .common import JSON, ApiError, client_ip, guard, ids
from .routes_core import record
from .services import audit, db, store

router = APIRouter()
G = Depends(guard)
VIEW_RE = re.compile(r"^([a-z0-9_]+)\.([a-z0-9_]+)\.([a-z0-9_]+)$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
SCREENS_SAVABLE = {"simulator", "compare", "report", "recovery", "map", "overview"}
MAX_COMMENT = 1000
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


# ---------------------------------------------------------------------------- saved views
class SavedBody(BaseModel):
    name: str
    screen: str = "simulator"
    district: str
    disease: str
    scenario: str
    mask: str | None = None
    scenario_b: str | None = None
    district_b: str | None = None


@router.get("/me/saved")
def list_saved(user: dict = G):
    return JSON({"synthetic": True, "saved": db.saved(user["sub"])})


@router.post("/me/saved")
def add_saved(body: SavedBody, request: Request, user: dict = G):
    name = CONTROL.sub("", body.name).strip()
    if not 1 <= len(name) <= 80:
        raise ApiError(400, "bad_request", "Give the view a name of 1–80 characters.")
    if body.screen not in SCREENS_SAVABLE:
        raise ApiError(400, "bad_request", "This screen can't be saved.")
    ids(district=body.district, disease=body.disease, scenario=body.scenario, mask=body.mask)
    ids(scenario=body.scenario_b, district=body.district_b)
    try:
        saved = db.add_saved(user["sub"], {**body.model_dump(), "name": name})
    except ValueError as e:
        raise ApiError(400, "limit_reached", str(e))
    record("save_view", user, screen=body.screen, district=body.district, disease=body.disease, scenario=body.scenario)
    audit.write("save_view", user["sub"], user["real_role"], client_ip(request), detail={"id": saved["id"]})
    return JSON({"synthetic": True, "saved": saved})


@router.delete("/me/saved/{saved_id}")
def delete_saved(saved_id: int, user: dict = G):
    if not db.delete_saved(user["sub"], saved_id):  # someone else's id looks exactly like a missing one
        raise ApiError(404, "unknown_saved", "No saved view with this id.")
    return JSON({"synthetic": True, "ok": True})


class FavoriteBody(BaseModel):
    district: str


@router.get("/me/favorites")
def list_favorites(user: dict = G):
    return JSON({"synthetic": True, "favorites": db.favorites(user["sub"])})


@router.post("/me/favorites")
def add_favorite(body: FavoriteBody, user: dict = G):
    ids(district=body.district)
    db.add_favorite(user["sub"], body.district)
    record("favorite", user, district=body.district)
    return JSON({"synthetic": True, "favorites": db.favorites(user["sub"])})


@router.delete("/me/favorites/{district}")
def delete_favorite(district: str, user: dict = G):
    ids(district=district)
    db.delete_favorite(user["sub"], district)
    return JSON({"synthetic": True, "favorites": db.favorites(user["sub"])})


# ---------------------------------------------------------------------------- insights
def _delay(c):
    if c["delta_status"] == "computed":
        return c["delta_tsr_months"], f"{c['delta_tsr_months']:+d}"
    if c["delta_status"] == "lower_bound":
        return c["delta_tsr_lower_bound_months"], f"≥ +{c['delta_tsr_lower_bound_months']}"
    return None, None


@router.get("/insights")
def insights(district: str = Query(...), disease: str = Query(...), scenario: str | None = Query(None), user: dict = G):
    ids(district=district, disease=disease, scenario=scenario)
    meta = store.meta()
    name = {d["id"]: d["name"] for d in meta["districts"]}
    dname = {d["id"]: d["name"] for d in meta["diseases"]}
    sname = {s["id"]: s["label"] for s in meta["scenarios"]}
    out = []
    for cv in db.coviews(district, disease):
        out.append({"kind": "coview", "text": f"People who explored {name[district]} {dname[disease].lower()} also explored "
                                              f"{name[cv['district']]} {dname[cv['disease']].lower()} ({cv['users']} users).",
                    "link": {"screen": "simulator", "district": cv["district"], "disease": cv["disease"]}})
    cells = store.recovery_matrix(disease, "none")["cells"]
    here = [(c, *_delay(c)) for c in cells if c["district"] == district and c["scenario"] != "baseline"]
    here = [x for x in here if x[1] is not None]
    if here:
        top_v = max(x[1] for x in here)
        worst = [x for x in here if x[1] == top_v]  # ties are common (e.g. four rain scenarios at +10)
        names = [sname[x[0]["scenario"]] for x in worst]
        listed = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
        out.append({"kind": "rule", "text": f"The largest delay for {dname[disease].lower()} in {name[district]} is {worst[0][2]} months, "
                                            f"under {listed}.",
                    "link": {"screen": "simulator", "district": district, "disease": disease, "scenario": worst[0][0]["scenario"]}})
        best = min(here, key=lambda x: x[1])
        if best[1] < 0:
            out.append({"kind": "rule", "text": f"Recovery is fastest under {sname[best[0]['scenario']]} ({best[2]} months). "
                                                "This follows from the model's assumed temperature optimum.",
                        "link": {"screen": "simulator", "district": district, "disease": disease, "scenario": best[0]["scenario"]}})
    if scenario and scenario != "baseline":
        same = [(c, *_delay(c)) for c in cells if c["scenario"] == scenario and c["district"] != district]
        same = [x for x in same if x[1] is not None]
        if same:
            top = max(same, key=lambda x: x[1])
            out.append({"kind": "rule", "text": f"Under {sname[scenario]}, {name[top[0]['district']]} has the longest "
                                                f"{dname[disease].lower()} delay of the other districts: {top[2]} months.",
                        "link": {"screen": "simulator", "district": top[0]["district"], "disease": disease, "scenario": scenario}})
    return JSON({"synthetic": True, "insights": out[:3],
                 "note": "Suggestions use usage counts from at least 3 different people, or results from the API."})


# ---------------------------------------------------------------------------- comments
class CommentLimiter:
    def __init__(self, per_minute=10):
        self.per_minute = per_minute
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, username: str) -> bool:
        now = time.time()
        with self._lock:
            q = self._hits[username]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


comment_limiter = CommentLimiter()


def clean_text(text: str) -> str:
    """Comments are stored as plain text and always rendered as text (never HTML)."""
    t = CONTROL.sub("", text or "").replace("\r\n", "\n").strip()
    if not t:
        raise ApiError(400, "bad_request", "Write something first.")
    if len(t) > MAX_COMMENT:
        raise ApiError(400, "too_long", f"Comments can be at most {MAX_COMMENT} characters.")
    return t


def parse_view(view: str):
    m = VIEW_RE.match(view or "")
    if not m:
        raise ApiError(400, "bad_request", "view must look like district.disease.scenario")
    ids(district=m.group(1), disease=m.group(2), scenario=m.group(3))
    return m.groups()


def public(c: dict, user: dict) -> dict:
    return {k: c[k] for k in ("id", "view_key", "month", "author", "author_name", "author_role", "text", "created_at", "edited_at")} \
        | {"mine": c["author"] == user["sub"]}


class CommentBody(BaseModel):
    view: str
    text: str
    month: str | None = None


class CommentEdit(BaseModel):
    text: str


@router.get("/comments")
def list_comments(view: str = Query(...), user: dict = G):
    parse_view(view)
    return JSON({"synthetic": True, "view": view, "comments": [public(c, user) for c in db.comments(view)],
                 "note": "Team discussion, not results."})


@router.post("/comments")
def post_comment(body: CommentBody, request: Request, user: dict = G):
    d, z, s = parse_view(body.view)
    if body.month is not None and (not MONTH_RE.match(body.month) or body.month not in store.idx):
        raise ApiError(400, "bad_request", "month must be a YYYY-MM month inside the data horizon.")
    text = clean_text(body.text)
    if not comment_limiter.hit(user["sub"]):
        raise ApiError(429, "too_many_comments", "You can post up to 10 comments a minute. Wait a moment.")
    c = db.add_comment(body.view, body.month, user["sub"], user["name"], user["real_role"], text)
    audit.write("comment_post", user["sub"], user["real_role"], client_ip(request), detail={"id": c["id"], "view": body.view, "month": body.month})
    record("comment", user, district=d, disease=z, scenario=s)
    return JSON({"synthetic": True, "comment": public(c, user)})


def _own(comment_id: int, user: dict) -> dict:
    c = db.comment(comment_id)
    if not c or c["deleted"] or c["author"] != user["sub"]:
        raise ApiError(404, "unknown_comment", "No comment of yours with this id.")
    return c


@router.patch("/comments/{comment_id}")
def edit_comment(comment_id: int, body: CommentEdit, request: Request, user: dict = G):
    _own(comment_id, user)
    c = db.edit_comment(comment_id, clean_text(body.text))
    audit.write("comment_edit", user["sub"], user["real_role"], client_ip(request), detail={"id": comment_id})
    return JSON({"synthetic": True, "comment": public(c, user)})


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, request: Request, user: dict = G):
    _own(comment_id, user)
    db.set_comment_flags(comment_id, deleted=True)
    audit.write("comment_delete", user["sub"], user["real_role"], client_ip(request), detail={"id": comment_id})
    return JSON({"synthetic": True, "ok": True})
