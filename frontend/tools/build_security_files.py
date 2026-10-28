"""Write the mock security files for the frontend.

1. mock/api/v1/auth/demo-users.json : demo accounts, passwords stored ONLY as salted PBKDF2-SHA256 hashes.
   Mock mode checks passwords in the browser for demonstration. In live mode the server must do this
   (bcrypt/argon2 + JWT) and the browser never receives hashes.
2. mock/api/v1/integrity.json : SHA-256 checksum manifest of every mock API file, the map file,
   the vendored libraries and (optionally) the dataset CSVs.

Usage:
    python tools/build_security_files.py [path-to-dataset-project]
"""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOCK = ROOT / "mock" / "api" / "v1"
ITER = 100_000

DEMO_ACCOUNTS = [
    ("viewer", "viewer-demo-2026", "viewer", "Demo viewer"),
    ("analyst", "analyst-demo-2026", "analyst", "Demo analyst"),
    ("admin", "admin-demo-2026", "admin", "Demo admin"),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main(dataset=None):
    users = []
    for i, (u, pw, role, name) in enumerate(DEMO_ACCOUNTS):
        salt = hashlib.sha256(f"epimetrics-demo-salt-{u}-{i}".encode()).hexdigest()[:32]
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), ITER)
        users.append({"username": u, "display_name": name, "role": role, "salt": salt, "iterations": ITER, "hash": dk.hex()})
    (MOCK / "auth").mkdir(parents=True, exist_ok=True)
    (MOCK / "auth" / "demo-users.json").write_text(json.dumps({
        "synthetic": True, "algorithm": "PBKDF2-SHA256", "users": users,
        "note": "Mock mode only. The live server verifies passwords and never sends hashes to the browser."}, indent=1))

    files = []
    def add(kind, rel_url, path, label):
        files.append({"kind": kind, "url": rel_url, "label": label, "bytes": path.stat().st_size, "sha256": sha256(path)})
    for p in sorted(MOCK.rglob("*.json")):
        if p.name == "integrity.json":
            continue
        rel = p.relative_to(ROOT).as_posix()
        add("api", rel, p, rel.replace("mock/api/v1/", "/api/v1/ "))
    add("frontend", "data/geo/tamil_nadu.json", ROOT / "data/geo/tamil_nadu.json", "District boundaries")
    for p in sorted((ROOT / "vendor").glob("*.js")):
        add("frontend", p.relative_to(ROOT).as_posix(), p, f"Library {p.name}")
    dataset_files = []
    if dataset:
        d = Path(dataset)
        for p in sorted((d / "data").rglob("*.csv")):
            dataset_files.append({"kind": "dataset", "path": p.relative_to(d).as_posix(), "bytes": p.stat().st_size, "sha256": sha256(p)})
    manifest = {
        "synthetic": True, "api_version": "1.0", "dataset_version": "0.1.1", "algorithm": "SHA-256",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": files, "dataset_files": dataset_files,
        "note": "The browser can re-check every file with a URL. Dataset CSVs are checked by the backend (validate_data.py, verify_semantics.py).",
    }
    (MOCK / "integrity.json").write_text(json.dumps(manifest, indent=1))
    print(f"demo users: {len(users)}; manifest: {len(files)} files + {len(dataset_files)} dataset CSVs")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
