"""Where runtime state (database, accounts, logs, model cache, backups) is written.

Locally that is next to the code. On read-only hosts such as Vercel (only /tmp is writable) it is a state directory:
EPIMETRICS_STATE_DIR if set, otherwise /tmp/epimetrics when the VERCEL variable is present. /tmp there is per-instance
and wiped on cold starts, so accounts, comments and usage events do not persist on such hosts.
"""
from __future__ import annotations

import os
from pathlib import Path

_state = os.environ.get("EPIMETRICS_STATE_DIR") or ("/tmp/epimetrics" if os.environ.get("VERCEL") else "")
STATE_DIR = Path(_state) if _state else None


def state_path(name: str, local_default: Path) -> Path:
    """`STATE_DIR / name` on a read-only host, otherwise the usual local path."""
    return STATE_DIR / name if STATE_DIR else Path(local_default)
