"""Role matrix: the ONE source of truth for who may open which screen and call which endpoint.

The frontend builds its navigation from GET /auth/me (which returns this matrix for the signed-in role), and
every API route is checked against ENDPOINTS by common.guard. backend/tests/test_roles.py asserts every role ×
endpoint pair and that no API route is missing from ENDPOINTS.
"""
from __future__ import annotations

ROLE_IDS = ("junior", "viewer", "analyst", "admin")

ROLE_INFO = {
    "junior": {"label": "Young Minds", "summary": "Playful climate lab for school students and young learners"},
    "viewer": {"label": "Viewer", "summary": "Headline answers in plain language for officers, the public and decision makers"},
    "analyst": {"label": "Public health analyst", "summary": "The full analytical experience, exports and team comments"},
    "admin": {"label": "Admin", "summary": "Runs the platform: users, usage, audit, integrity, backups, moderation"},
}

# Screen id → label. Order in each role's list is the nav order; the first screen is the role's home.
SCREEN_LABELS = {
    "young-explore": "Explore", "young-lab": "Climate lab", "young-quiz": "Quiz & badges", "young-glossary": "Glossary",
    "overview": "Overview", "simulator": "Scenario simulator", "map": "District map", "recovery": "Recovery & recurrence",
    "compare": "Compare climates", "episodes": "Outbreak episodes", "explorer": "Data explorer", "models": "Forecast models",
    "validation": "Validation & limits", "report": "Scenario report", "technology": "Technology & PDF",
    "platform": "Users & security", "admin": "Admin console",
}
SCREENS = {
    "junior": ["young-explore", "young-lab", "young-quiz", "young-glossary"],
    "viewer": ["overview", "simulator", "map", "compare", "report"],
    "analyst": ["overview", "simulator", "recovery", "compare", "episodes", "explorer", "models", "validation", "report", "technology", "platform"],
    "admin": ["admin", "platform", "technology"],
}

_DATA = {"data.read"}
_VIEWER = _DATA | {"integrity.summary", "export.report", "saved", "comments.read", "insights"}
_ANALYST = _VIEWER | {"analysis.read", "validation.read", "export.data", "export.project", "comments.post", "advanced"}
PERMISSIONS = {
    "junior": _DATA | {"young"},
    "viewer": _VIEWER,
    # Admin keeps read access to the data (needed for the project PDF and its own checks) but its navigation is
    # the console; analyst screens are reached through the read-only "view as" preview.
    "admin": (_ANALYST - {"saved"}) | {"integrity.admin", "audit.read", "comments.moderate", "admin"},
    "analyst": _ANALYST,
}
EVERYONE = "authenticated"  # any signed-in role

# Export kind → permission.
EXPORT_PERMS = {"report_pdf": "export.report", "print": "export.report", "json": "export.data", "csv": "export.data",
                "project_pdf": "export.project"}

# (method, route path under /api/v1) → permission. Paths use the FastAPI route template.
ENDPOINTS = {
    ("POST", "/auth/logout"): EVERYONE,
    ("GET", "/auth/me"): EVERYONE,
    ("POST", "/events"): EVERYONE,
    ("GET", "/meta"): "data.read",
    ("GET", "/districts"): "data.read",
    ("GET", "/simulations"): "data.read",
    ("GET", "/recovery-matrix"): "data.read",
    ("GET", "/validation"): "validation.read",
    ("GET", "/analytics/data-audit"): "analysis.read",
    ("GET", "/analytics/eda"): "analysis.read",
    ("GET", "/analytics/forecasts"): "analysis.read",
    ("GET", "/analytics/forecast-summary"): "analysis.read",
    ("GET", "/analytics/episodes"): "analysis.read",
    ("POST", "/exports"): "export.report",  # kind-specific check inside the route (EXPORT_PERMS)
    ("GET", "/integrity"): "integrity.summary",
    ("POST", "/integrity/verify"): "integrity.admin",
    ("POST", "/integrity/validate"): "integrity.admin",
    ("GET", "/audit-log"): "audit.read",
    ("GET", "/audit-log.csv"): "audit.read",
    ("GET", "/me/saved"): "saved",
    ("POST", "/me/saved"): "saved",
    ("DELETE", "/me/saved/{saved_id}"): "saved",
    ("GET", "/me/favorites"): "saved",
    ("POST", "/me/favorites"): "saved",
    ("DELETE", "/me/favorites/{district}"): "saved",
    ("GET", "/insights"): "insights",
    ("GET", "/comments"): "comments.read",
    ("POST", "/comments"): "comments.post",
    ("PATCH", "/comments/{comment_id}"): "comments.post",
    ("DELETE", "/comments/{comment_id}"): "comments.post",
    ("GET", "/admin/usage"): "admin",
    ("GET", "/admin/users"): "admin",
    ("POST", "/admin/users"): "admin",
    ("PATCH", "/admin/users/{username}"): "admin",
    ("POST", "/admin/users/{username}/password"): "admin",
    ("GET", "/admin/comments"): "comments.moderate",
    ("PATCH", "/admin/comments/{comment_id}"): "comments.moderate",
    ("DELETE", "/admin/comments/{comment_id}"): "comments.moderate",
    ("GET", "/admin/backups"): "admin",
    ("POST", "/admin/backups"): "admin",
    ("POST", "/admin/view-as"): "admin",
}

# Writes an admin may still make while previewing another role (everything else is refused: preview is read-only).
PREVIEW_WRITES = {("POST", "/auth/logout"), ("POST", "/admin/view-as")}


def allowed(role: str, perm: str) -> bool:
    return perm == EVERYONE or perm in PERMISSIONS.get(role, set())


def describe(role: str) -> dict:
    """What /auth/me returns about a role."""
    screens = SCREENS[role]
    return {"role": role, **ROLE_INFO[role], "home": screens[0],
            "screens": [{"id": s, "label": SCREEN_LABELS[s]} for s in screens],
            "permissions": sorted(PERMISSIONS[role])}


def matrix() -> list[dict]:
    """Every role's public description (labels, screens, permission ids) for the Users & security table."""
    return [describe(r) for r in ROLE_IDS]
