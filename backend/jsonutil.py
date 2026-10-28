"""JSON helpers. JSON has no NaN, and numpy scalars are not serialisable, so every response goes through clean()."""
from __future__ import annotations

import json
import math

import numpy as np


def clean(obj):
    """Recursively convert numpy scalars/arrays to Python types and NaN/inf to None."""
    if obj is None or isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [clean(v) for v in obj.tolist()]
    try:  # pandas NA / NaT
        import pandas as pd
        if obj is pd.NA or obj is pd.NaT:
            return None
    except Exception:  # pragma: no cover
        pass
    return obj


def dumps(obj) -> bytes:
    return json.dumps(clean(obj), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def num(v, nd=None):
    """Float or None (NaN-safe), optionally rounded."""
    if v is None:
        return None
    f = float(v)
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, nd) if nd is not None else f


def as_int(v):
    f = num(v)
    return None if f is None else int(round(f))
