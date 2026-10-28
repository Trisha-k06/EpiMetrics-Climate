"""Management commands.

    python -m backend.manage manifest            rebuild the SHA-256 integrity manifest (run LAST after any change)
    python -m backend.manage verify              check every file against the manifest
    python -m backend.manage validate            run verify_semantics.py + engine check + unit tests
    python -m backend.manage warm                fit and cache all forecast models
    python -m backend.manage users               list accounts
    python -m backend.manage set-user NAME ROLE  create/replace an account (password is prompted)
    python -m backend.manage seed-demo           reset users.json to the three demo accounts
"""
from __future__ import annotations

import argparse
import getpass
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m backend.manage", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("manifest")
    sub.add_parser("verify")
    sub.add_parser("validate")
    sub.add_parser("warm")
    sub.add_parser("users")
    sub.add_parser("seed-demo")
    su = sub.add_parser("set-user")
    su.add_argument("username")
    su.add_argument("role", choices=["viewer", "analyst", "admin"])
    su.add_argument("--display-name")
    a = ap.parse_args(argv)

    if a.cmd == "manifest":
        from .integrity import MANIFEST, build_manifest
        man = build_manifest()
        print(f"wrote {MANIFEST} ({len(man['files'])} files)")
    elif a.cmd == "verify":
        from .integrity import load_manifest, verify
        res = verify(load_manifest())
        for r in res["results"]:
            if not r["match"]:
                print("CHANGED" if not r["missing"] else "MISSING", r["path"])
        for p in res.get("unlisted_files", []):
            print("UNLISTED", p)
        print(f"{res.get('n_match', 0)}/{res.get('n_files', 0)} files match")
        return 0 if res["all_match"] else 1
    elif a.cmd == "validate":
        from .app import run_validation
        res = run_validation()
        for c in res["checks"]:
            print(f"[{'PASS' if c['pass'] else 'FAIL'}] {c['group']}: {c['name']}")
        print(f"{res['passed']}/{res['total']} passed ({res['semantic']['passed']}/{res['semantic']['total']} semantic checks)")
        return 0 if res["all_pass"] else 1
    elif a.cmd == "warm":
        from .analytics import Analytics
        from .data import Store
        an = Analytics(Store())
        an.warm()
        print("models cached:", an.models_ready(), an.warm_state)
    elif a.cmd in ("users", "seed-demo", "set-user"):
        from .security import UserStore
        us = UserStore()
        if a.cmd == "seed-demo":
            us.seed_demo()
        elif a.cmd == "set-user":
            pw = getpass.getpass(f"Password for {a.username}: ")
            if len(pw) < 10:
                print("Password must be at least 10 characters.", file=sys.stderr)
                return 2
            us.set_user(a.username.lower(), pw, a.role, a.display_name)
        for u in us.list():
            print(f"{u['username']:<12} {u['role']:<8} {u['display_name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
