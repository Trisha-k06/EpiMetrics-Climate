"""SHA-256 checksum manifest of the website, backend code, science code and dataset.

Rebuild it LAST, after every code or data change:  python -m backend.manage manifest
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from .data import DATASET_VERSION, ROOT

MANIFEST = Path(__file__).resolve().parent / "integrity_manifest.json"

# (kind, folder or file, glob)
SOURCES = [
    ("frontend", "frontend", "**/*"),
    ("backend", "backend", "*.py"),
    ("backend", "backend/tests", "*.py"),
    ("science", "src", "*.py"),
    ("science", "configs", "*.json"),
    ("dataset", "data", "**/*.csv"),
    ("dataset", ".", "data_dictionary.csv"),
    ("dataset", ".", "dataset_catalog.csv"),
]
EXCLUDE_PARTS = {"__pycache__", ".DS_Store", "cache", "logs"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _files():
    seen = set()
    for kind, base, pattern in SOURCES:
        for p in sorted((ROOT / base).glob(pattern)):
            if not p.is_file() or EXCLUDE_PARTS & set(p.relative_to(ROOT).parts) or p.suffix in (".pyc", ".tmp"):
                continue
            rel = p.relative_to(ROOT).as_posix()
            if rel in seen:
                continue
            seen.add(rel)
            yield kind, rel, p


def build_manifest() -> dict:
    files = []
    for kind, rel, p in _files():
        entry = {"kind": kind, "path": rel, "bytes": p.stat().st_size, "sha256": sha256_file(p)}
        if kind == "frontend":
            entry["url"] = rel[len("frontend/"):]  # served from the site root
        files.append(entry)
    man = {"synthetic": True, "algorithm": "SHA-256", "dataset_version": DATASET_VERSION,
           "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "files": files}
    MANIFEST.write_text(json.dumps(man, indent=1))
    return man


def load_manifest() -> dict | None:
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else None


def summary(man: dict | None) -> dict:
    if not man:
        return {"synthetic": True, "algorithm": "SHA-256", "available": False, "files": [], "counts": {}}
    counts = {}
    for f in man["files"]:
        counts[f["kind"]] = counts.get(f["kind"], 0) + 1
    return {"synthetic": True, "algorithm": man["algorithm"], "available": True, "dataset_version": man["dataset_version"],
            "generated_at": man["generated_at"], "counts": counts, "total_files": len(man["files"]), "files": []}


def verify(man: dict | None) -> dict:
    if not man:
        return {"synthetic": True, "available": False, "results": [], "all_match": False}
    results = []
    for f in man["files"]:
        p = ROOT / f["path"]
        actual = sha256_file(p) if p.is_file() else None
        results.append({"kind": f["kind"], "path": f["path"], "expected": f["sha256"], "actual": actual,
                        "match": actual == f["sha256"], "missing": actual is None})
    listed = {f["path"] for f in man["files"]}
    extra = [rel for _, rel, _ in _files() if rel not in listed]
    return {"synthetic": True, "available": True, "generated_at": man["generated_at"], "results": results,
            "n_files": len(results), "n_match": sum(r["match"] for r in results),
            "unlisted_files": extra, "all_match": all(r["match"] for r in results)}
