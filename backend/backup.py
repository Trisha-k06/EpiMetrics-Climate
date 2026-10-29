"""Backups: a timestamped zip in backups/ holding app.db (sqlite3 backup API), users.json, the integrity manifest
and the audit log, plus a .sha256 file. The newest KEEP archives are kept. Restore is CLI only and checks the
SHA-256 first:  python -m backend.manage backup  /  python -m backend.manage restore <file>
"""
from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .data import ROOT
from .paths import state_path

BACKUP_DIR = Path(os.environ.get("EPIMETRICS_BACKUP_DIR", state_path("backups", ROOT / "backups")))
KEEP = 14


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


class BackupError(Exception):
    pass


class Backups:
    def __init__(self, db, users_file: Path, manifest_file: Path, audit_file: Path, directory: Path = BACKUP_DIR):
        self.db, self.users_file, self.manifest_file, self.audit_file = db, Path(users_file), Path(manifest_file), Path(audit_file)
        self.dir = Path(directory)

    def create(self) -> dict:
        self.dir.mkdir(parents=True, exist_ok=True)
        # Microsecond stamps keep names unique and make name order equal to time order.
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        name = f"epimetrics_backup_{stamp}.zip"
        archive = self.dir / name
        with tempfile.TemporaryDirectory() as tmp:
            snap = Path(tmp) / "app.db"
            self.db.backup_to(snap)
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
                z.write(snap, "app.db")
                for src, arc in ((self.users_file, "users.json"), (self.manifest_file, "integrity_manifest.json"),
                                 (self.audit_file, "audit.jsonl")):
                    if src.exists():
                        z.write(src, arc)
                z.writestr("BACKUP_INFO.txt", f"EpiMetrics-Climate backup {stamp} UTC. Synthetic research prototype.\n")
        digest = _sha256(archive)
        (self.dir / (name + ".sha256")).write_text(f"{digest}  {name}\n")
        self.prune()
        return self.describe(archive)

    def describe(self, archive: Path) -> dict:
        side = archive.with_name(archive.name + ".sha256")
        return {"name": archive.name, "bytes": archive.stat().st_size,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(archive.stat().st_mtime)),
                "sha256": side.read_text().split()[0] if side.exists() else None}

    def list(self) -> list[dict]:
        if not self.dir.exists():
            return []
        return [self.describe(p) for p in sorted(self.dir.glob("epimetrics_backup_*.zip"), key=lambda p: p.name, reverse=True)]

    def prune(self):
        for p in sorted(self.dir.glob("epimetrics_backup_*.zip"), key=lambda p: p.name, reverse=True)[KEEP:]:
            p.unlink(missing_ok=True)
            p.with_name(p.name + ".sha256").unlink(missing_ok=True)

    def verify(self, archive: Path) -> str:
        archive = Path(archive)
        side = archive.with_name(archive.name + ".sha256")
        if not archive.exists():
            raise BackupError(f"{archive} does not exist.")
        if not side.exists():
            raise BackupError(f"Checksum file {side.name} is missing; refusing to restore.")
        expected = side.read_text().split()[0]
        actual = _sha256(archive)
        if actual != expected:
            raise BackupError(f"Checksum mismatch: expected {expected[:16]}…, got {actual[:16]}…. The archive was altered or damaged.")
        with zipfile.ZipFile(archive) as z:
            if "app.db" not in z.namelist():
                raise BackupError("The archive has no app.db.")
        return actual

    def restore(self, archive: Path) -> list[str]:
        """Verify, then put back app.db (via the sqlite3 backup API), users.json and the manifest. Stop the server first.
        The audit log is append-only, so the current one is kept (the archived copy is used only if it is missing)."""
        self.verify(archive)
        restored = []
        with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(archive) as z:
            z.extractall(tmp)
            src = sqlite3.connect(Path(tmp) / "app.db")
            dst = sqlite3.connect(self.db.path)
            try:
                with dst:
                    src.backup(dst)
            finally:
                dst.close()
                src.close()
            restored.append("app.db")
            for arc, dest in (("users.json", self.users_file), ("integrity_manifest.json", self.manifest_file), ("audit.jsonl", self.audit_file)):
                p = Path(tmp) / arc
                if arc == "audit.jsonl" and dest.exists():
                    continue
                if p.exists():
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(p, dest)
                    restored.append(arc)
        return restored
