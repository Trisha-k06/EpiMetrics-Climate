"""SQLite store for user-generated state: usage events, saved views, favourite districts and comments.

One short-lived connection per operation (safe with uvicorn's thread pool), WAL journal, schema migrations in code.
Nothing here holds health data: every number on the site is synthetic and comes from the read-only CSVs.
"""
from __future__ import annotations

import calendar
import os
import sqlite3
import threading
import time
from collections import Counter, defaultdict
from contextlib import contextmanager
from pathlib import Path

from .paths import state_path

DB_FILE = Path(os.environ.get("EPIMETRICS_DB_FILE", state_path("app.db", Path(__file__).resolve().parent / "app.db")))
RETENTION_DAYS = int(os.environ.get("EPIMETRICS_EVENT_RETENTION_DAYS", "180"))

MIGRATIONS = [
    # 1: initial schema
    """
    CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts REAL NOT NULL, day TEXT NOT NULL,
        username TEXT, role TEXT, event TEXT NOT NULL, screen TEXT,
        district TEXT, disease TEXT, scenario TEXT, export_kind TEXT, session_id TEXT
    );
    CREATE INDEX ix_events_day ON usage_events(day);
    CREATE INDEX ix_events_user ON usage_events(username);
    CREATE TABLE saved_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL, name TEXT NOT NULL, screen TEXT NOT NULL,
        district TEXT NOT NULL, disease TEXT NOT NULL, scenario TEXT NOT NULL, mask TEXT NOT NULL DEFAULT 'none',
        scenario_b TEXT, district_b TEXT, created_at REAL NOT NULL
    );
    CREATE INDEX ix_saved_user ON saved_views(username);
    CREATE TABLE favorites (
        username TEXT NOT NULL, district TEXT NOT NULL, created_at REAL NOT NULL,
        PRIMARY KEY (username, district)
    );
    CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        view_key TEXT NOT NULL, month TEXT,
        author TEXT NOT NULL, author_name TEXT NOT NULL, author_role TEXT NOT NULL,
        text TEXT NOT NULL, created_at REAL NOT NULL, edited_at REAL,
        hidden INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, moderated_by TEXT
    );
    CREATE INDEX ix_comments_view ON comments(view_key);
    """,
]

EVENT_KINDS = {"screen_open", "simulation_view", "compare", "drilldown", "save_view", "favorite", "export", "login",
               "login_failed", "logout", "comment", "admin_action", "young_activity"}


def _day(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


class Database:
    def __init__(self, path: Path = DB_FILE):
        self.path = Path(path)
        self._lock = threading.Lock()
        self.migrate()

    @contextmanager
    def conn(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        try:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA foreign_keys=ON")
            yield c
            c.commit()
        finally:
            c.close()

    def migrate(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self.conn() as c:
            version = c.execute("PRAGMA user_version").fetchone()[0]
            for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
                c.executescript(sql)
                c.execute(f"PRAGMA user_version = {i}")

    def schema_version(self) -> int:
        with self.conn() as c:
            return c.execute("PRAGMA user_version").fetchone()[0]

    # ------------------------------------------------------------------ usage events
    def event(self, event: str, username=None, role=None, screen=None, district=None, disease=None, scenario=None,
              export_kind=None, session_id=None, ts=None):
        if event not in EVENT_KINDS:
            raise ValueError(f"unknown event {event}")
        ts = ts or time.time()
        with self.conn() as c:
            c.execute("INSERT INTO usage_events (ts, day, username, role, event, screen, district, disease, scenario, export_kind, session_id)"
                      " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                      (ts, _day(ts), username, role, event, screen, district, disease, scenario, export_kind, session_id))

    def purge(self, days: int = RETENTION_DAYS) -> int:
        cutoff = time.time() - days * 86400
        with self.conn() as c:
            return c.execute("DELETE FROM usage_events WHERE ts < ?", (cutoff,)).rowcount

    def last_logins(self) -> dict:
        with self.conn() as c:
            return {r["username"]: r["ts"] for r in c.execute(
                "SELECT username, MAX(ts) AS ts FROM usage_events WHERE event='login' GROUP BY username")}

    def usage(self, day_from: str, day_to: str) -> dict:
        """Admin dashboard figures for [day_from, day_to] (UTC dates, inclusive). Counts only."""
        with self.conn() as c:
            rows = [dict(r) for r in c.execute("SELECT * FROM usage_events WHERE day BETWEEN ? AND ? ORDER BY ts", (day_from, day_to))]
            comments = c.execute("SELECT COUNT(*) FROM comments WHERE created_at >= ? AND created_at < ?",
                                 (_ts(day_from), _ts(day_to) + 86400)).fetchone()[0]
        today = _day(time.time())
        days = _days(day_from, day_to)
        per_day = {d: {"day": d, "active_users": set(), "logins": 0, "failed_logins": 0, "screen_opens": 0} for d in days}
        sessions = defaultdict(list)
        role_of_session = {}
        for r in rows:
            d = per_day.get(r["day"])
            if d is None:
                continue
            if r["username"] and r["event"] not in ("login_failed",):
                d["active_users"].add(r["username"])
            d["logins"] += r["event"] == "login"
            d["failed_logins"] += r["event"] == "login_failed"
            d["screen_opens"] += r["event"] == "screen_open"
            if r["session_id"]:
                sessions[r["session_id"]].append(r["ts"])
                role_of_session[r["session_id"]] = r["role"]
        lengths = [max(v) - min(v) for v in sessions.values() if len(v) > 1]
        top = lambda key, ev=None, n=8: [{"key": k, "count": v} for k, v in Counter(
            key(r) for r in rows if (ev is None or r["event"] in ev) and key(r)).most_common(n)]
        active_range = {r["username"] for r in rows if r["username"] and r["event"] != "login_failed"}
        return {
            "range": {"from": day_from, "to": day_to},
            "active_users_today": len(per_day[today]["active_users"]) if today in per_day else _active_on(rows, today),
            "active_users_range": len(active_range),
            "per_day": [{**d, "active_users": len(d["active_users"])} for d in per_day.values()],
            "sessions_by_role": [{"key": k, "count": v} for k, v in Counter(role_of_session.values()).most_common()],
            "top_screens": top(lambda r: r["screen"], {"screen_open"}),
            "top_scenarios": top(lambda r: "|".join([r["district"], r["disease"], r["scenario"]]) if r["district"] and r["disease"] and r["scenario"] else None,
                                 {"simulation_view", "compare", "save_view"}),
            "top_districts": top(lambda r: r["district"], {"simulation_view", "compare", "drilldown", "save_view", "favorite"}),
            "exports_by_kind": top(lambda r: r["export_kind"], {"export"}),
            "avg_session_minutes": round(sum(lengths) / len(lengths) / 60, 1) if lengths else None,
            "sessions": len(sessions),
            "comments_posted": comments,
            "events": len(rows),
        }

    def coviews(self, district: str, disease: str, min_users: int = 3, limit: int = 3) -> list[dict]:
        """Series (district, disease) explored by users who also explored this one. Counts of distinct users only."""
        with self.conn() as c:
            rows = c.execute("SELECT DISTINCT username, district, disease FROM usage_events WHERE username IS NOT NULL "
                             "AND district IS NOT NULL AND disease IS NOT NULL AND event IN ('simulation_view','compare','drilldown','save_view')").fetchall()
        by_user = defaultdict(set)
        for r in rows:
            by_user[r["username"]].add((r["district"], r["disease"]))
        target = (district, disease)
        counts = Counter()
        for series in by_user.values():
            if target in series:
                for s in series - {target}:
                    counts[s] += 1
        return [{"district": d, "disease": z, "users": n} for (d, z), n in counts.most_common() if n >= min_users][:limit]

    # ------------------------------------------------------------------ saved views and favourites
    def saved(self, username: str) -> list[dict]:
        with self.conn() as c:
            return [dict(r) for r in c.execute("SELECT id, name, screen, district, disease, scenario, mask, scenario_b, district_b, created_at "
                                                "FROM saved_views WHERE username=? ORDER BY created_at DESC", (username,))]

    def add_saved(self, username: str, v: dict) -> dict:
        with self.conn() as c:
            n = c.execute("SELECT COUNT(*) FROM saved_views WHERE username=?", (username,)).fetchone()[0]
            if n >= 50:
                raise ValueError("You can keep up to 50 saved views. Delete one first.")
            cur = c.execute("INSERT INTO saved_views (username, name, screen, district, disease, scenario, mask, scenario_b, district_b, created_at)"
                            " VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (username, v["name"], v["screen"], v["district"], v["disease"], v["scenario"], v.get("mask") or "none",
                             v.get("scenario_b"), v.get("district_b"), time.time()))
            return dict(c.execute("SELECT id, name, screen, district, disease, scenario, mask, scenario_b, district_b, created_at "
                                  "FROM saved_views WHERE id=?", (cur.lastrowid,)).fetchone())

    def delete_saved(self, username: str, saved_id: int) -> bool:
        with self.conn() as c:
            return c.execute("DELETE FROM saved_views WHERE id=? AND username=?", (saved_id, username)).rowcount > 0

    def favorites(self, username: str) -> list[str]:
        with self.conn() as c:
            return [r["district"] for r in c.execute("SELECT district FROM favorites WHERE username=? ORDER BY created_at", (username,))]

    def add_favorite(self, username: str, district: str):
        with self.conn() as c:
            c.execute("INSERT OR IGNORE INTO favorites (username, district, created_at) VALUES (?,?,?)", (username, district, time.time()))

    def delete_favorite(self, username: str, district: str) -> bool:
        with self.conn() as c:
            return c.execute("DELETE FROM favorites WHERE username=? AND district=?", (username, district)).rowcount > 0

    # ------------------------------------------------------------------ comments
    _COLS = "id, view_key, month, author, author_name, author_role, text, created_at, edited_at, hidden, deleted, moderated_by"

    def comments(self, view_key: str) -> list[dict]:
        with self.conn() as c:
            return [_comment(r) for r in c.execute(f"SELECT {self._COLS} FROM comments WHERE view_key=? AND hidden=0 AND deleted=0 "
                                                   "ORDER BY created_at", (view_key,))]

    def comment(self, comment_id: int) -> dict | None:
        with self.conn() as c:
            r = c.execute(f"SELECT {self._COLS} FROM comments WHERE id=?", (comment_id,)).fetchone()
            return _comment(r) if r else None

    def add_comment(self, view_key, month, author, author_name, author_role, text) -> dict:
        with self.conn() as c:
            cur = c.execute("INSERT INTO comments (view_key, month, author, author_name, author_role, text, created_at) VALUES (?,?,?,?,?,?,?)",
                            (view_key, month, author, author_name, author_role, text, time.time()))
            cid = cur.lastrowid
        return self.comment(cid)

    def edit_comment(self, comment_id: int, text: str) -> dict:
        with self.conn() as c:
            c.execute("UPDATE comments SET text=?, edited_at=? WHERE id=?", (text, time.time(), comment_id))
        return self.comment(comment_id)

    def set_comment_flags(self, comment_id: int, *, hidden=None, deleted=None, moderated_by=None) -> dict:
        with self.conn() as c:
            if hidden is not None:
                c.execute("UPDATE comments SET hidden=?, moderated_by=? WHERE id=?", (int(bool(hidden)), moderated_by, comment_id))
            if deleted is not None:
                c.execute("UPDATE comments SET deleted=?, moderated_by=COALESCE(?, moderated_by) WHERE id=?", (int(bool(deleted)), moderated_by, comment_id))
        return self.comment(comment_id)

    def all_comments(self, include_deleted=False, limit=500) -> list[dict]:
        with self.conn() as c:
            q = f"SELECT {self._COLS} FROM comments {'' if include_deleted else 'WHERE deleted=0'} ORDER BY created_at DESC LIMIT ?"
            return [_comment(r) for r in c.execute(q, (limit,))]

    # ------------------------------------------------------------------ backups
    def backup_to(self, target: Path):
        """Consistent snapshot through the sqlite3 backup API (not a file copy)."""
        src = sqlite3.connect(self.path)
        dst = sqlite3.connect(target)
        try:
            with dst:
                src.backup(dst)
        finally:
            dst.close()
            src.close()


def _comment(r) -> dict:
    d = dict(r)
    d["hidden"], d["deleted"] = bool(d["hidden"]), bool(d["deleted"])
    return d


def _ts(day: str) -> float:
    """UTC midnight of a YYYY-MM-DD date as a Unix time."""
    return calendar.timegm(time.strptime(day, "%Y-%m-%d"))


def _days(a: str, b: str) -> list[str]:
    t, end, out = _ts(a), _ts(b), []
    while t <= end and len(out) < 400:
        out.append(_day(t))
        t += 86400
    return out


def _active_on(rows, day):
    return len({r["username"] for r in rows if r["day"] == day and r["username"] and r["event"] != "login_failed"})
