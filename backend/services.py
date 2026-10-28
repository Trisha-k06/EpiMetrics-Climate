"""Process-wide singletons shared by the route modules."""
from __future__ import annotations

from . import integrity
from .analytics import Analytics
from .backup import Backups
from .data import Store
from .db import Database
from .security import AUDIT_FILE, USERS_FILE, AuditLog, LoginLimiter, TokenService, UserStore

store = Store()
analytics = Analytics(store)
users = UserStore(USERS_FILE)
tokens = TokenService()
limiter = LoginLimiter()
audit = AuditLog(AUDIT_FILE)
db = Database()
backups = Backups(db, USERS_FILE, integrity.MANIFEST, AUDIT_FILE)
