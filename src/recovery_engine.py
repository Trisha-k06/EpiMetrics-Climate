"""Recovery engine for EpiMetrics-Climate.

Implements the project-defined recovery rules (see data_dictionary.csv and the
project data dictionary). These are PROJECT CONVENTIONS, not epidemiological
standards.

Convention: `recovery_index` is the FIRST month of the first run of W
consecutive months at or below the threshold, searched from the reference
month t0 onward. Recovery is only confirmed at recovery_index + W - 1.
"""
from __future__ import annotations

import numpy as np

STATUS_RECOVERED = "recovered"
STATUS_CENSORED = "not_recovered_within_horizon"
STATUS_INSUFFICIENT = "insufficient_data"


def threshold_from_history(cases, cal_month, train_mask, factor, floor=1.0):
    """Endemic threshold per month: median of the same calendar month over the
    training period (missing values ignored) x factor. Uses observed data only."""
    cases = np.asarray(cases, dtype=float)
    thr_by_month = {}
    for m in range(1, 13):
        sel = (cal_month == m) & train_mask
        vals = cases[sel]
        vals = vals[~np.isnan(vals)]
        thr_by_month[m] = max(float(np.median(vals)) * factor, floor) if len(vals) else np.nan
    return np.array([thr_by_month[m] for m in cal_month])


def detect_waves(cases, thr, start, rise_factor=1.2, rise_months=2):
    """Return onset indices of new waves after `start`.

    A wave is counted when, after at least one month of decline, cases rise
    above the threshold AND to >= rise_factor x the latest low point for
    `rise_months` consecutive observed months. Missing months are skipped.
    """
    n = len(cases)
    onsets = []
    declined = False
    low = np.inf
    prev = cases[start] if not np.isnan(cases[start]) else np.nan
    t = start + 1
    while t < n:
        c = cases[t]
        if np.isnan(c):
            t += 1
            continue
        if not np.isnan(prev) and c < prev:
            declined = True
        low = min(low, c) if declined else low
        if declined and np.isfinite(low):
            ok = True
            for k in range(rise_months):
                tk = t + k
                if tk >= n or np.isnan(cases[tk]) or not (cases[tk] > thr[tk] and cases[tk] >= rise_factor * max(low, 1.0)):
                    ok = False
                    break
            if ok:
                onsets.append(t)
                # wait for this wave to peak and start declining again
                declined = False
                low = np.inf
                t += rise_months
                prev = cases[t - 1]
                continue
        prev = c
        t += 1
    return onsets


def assess_recovery(cases, thr, t0, window=3, rise_factor=1.2, rise_months=2, max_missing_frac=0.3):
    """Assess sustained recovery from reference month index t0.

    Returns a dict with the primary KPI and supporting metrics. A missing
    month breaks a qualifying window (it counts neither above nor below).
    """
    cases = np.asarray(cases, dtype=float)
    thr = np.asarray(thr, dtype=float)
    n = len(cases)
    seg = cases[t0:]
    missing_frac = float(np.mean(np.isnan(seg))) if len(seg) else 1.0

    out = {
        "status": None, "recovery_index": None, "confirmed_index": None,
        "time_to_sustained_recovery_months": None,
        "recovery_interruption_count": 0, "months_above_endemic_threshold": 0,
        "secondary_outbreak_count": 0, "missing_frac_after_t0": round(missing_frac, 3),
        "wave_onsets": [],
    }
    if missing_frac > max_missing_frac:
        out["status"] = STATUS_INSUFFICIENT
        return out

    rec = None
    for t in range(t0, n - window + 1):
        w = cases[t:t + window]
        if np.all(~np.isnan(w)) and np.all(w <= thr[t:t + window]):
            rec = t
            break

    waves = detect_waves(cases, thr, t0, rise_factor, rise_months)
    end = rec if rec is not None else n
    out["wave_onsets"] = waves
    out["secondary_outbreak_count"] = len(waves)
    out["recovery_interruption_count"] = sum(1 for w in waves if w < end)
    above = cases[t0:end] > thr[t0:end]
    out["months_above_endemic_threshold"] = int(np.nansum(above))

    if rec is None:
        out["status"] = STATUS_CENSORED
    else:
        out["status"] = STATUS_RECOVERED
        out["recovery_index"] = rec
        out["confirmed_index"] = rec + window - 1
        out["time_to_sustained_recovery_months"] = rec - t0
    return out
