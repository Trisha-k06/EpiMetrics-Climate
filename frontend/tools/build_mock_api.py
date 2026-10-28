"""Build the mock API responses for the EpiMetrics-Climate frontend.

BACKEND-SIDE TOOL. The frontend never computes recovery: every recovery
figure in the mock files comes from the project's own recovery engine
(src/recovery_engine.py) and its published outputs (simulation_runs.csv,
recovery_truth.csv, sensitivity_grid.csv). The JSON shapes are the API
contract in API_CONTRACT.md; the real backend must return the same shapes.

Usage:
    python tools/build_mock_api.py <path-to-epimetrics_ukm> [--out mock/api/v1]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

API_VERSION = "1.0"
HORIZON_END = "2024-12"


def jdump(obj, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False))


def none_if_nan(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)) and np.isnan(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    return v


def as_int(v):
    v = none_if_nan(v)
    return None if v is None else int(round(float(v)))


SCEN_META = {
    "baseline": dict(label="Baseline", short="Generated climate, no anomaly", category="baseline", featured=True),
    "delayed_monsoon": dict(label="Delayed monsoon", short="NE monsoon rain arrives 2 months late", category="rainfall", featured=True),
    "heavy_rain_decline": dict(label="Extreme rain during decline", short="+250 mm pulse in Jan 2023 while cases fall", category="rainfall", featured=True),
    "prolonged_wet": dict(label="Prolonged wet spell", short="Rain held at ≥150 mm/month for 4 months", category="rainfall", featured=False),
    "irregular_rain": dict(label="Irregular rain", short="+220 mm every 2nd month to horizon end", category="rainfall", featured=False),
    "warmer": dict(label="Warmer (+1.5 °C)", short="+1.5 °C sustained from Jul 2022", category="temperature", featured=False),
    "warm_wet": dict(label="Warm and wet", short="+1.5 °C plus +40% rain Oct 2022 – Mar 2023", category="compound", featured=False),
}
MASK_META = {
    None: dict(label="Complete data", description="No values removed"),
    "mar_10pct": dict(label="10% random gaps", description="10% of case months removed at random"),
    "cases_gap_3m": dict(label="3-month reporting gap", description="Cases missing Jan–Mar 2023"),
    "cases_outage_9m": dict(label="9-month reporting outage", description="Cases missing Jan–Sep 2023 (exceeds the 30% missing limit by design)"),
}
DISEASE_META = {
    "dengue": dict(name="Dengue", vector="Aedes mosquito",
                   drivers=["Rainfall, lag 2 months, hump-shaped (optimum 250 mm; very heavy rain flushes breeding sites)",
                            "Mean temperature, lag 1 month, bell curve (optimum 28 °C)",
                            "Relative humidity, lag 1 month, logistic (midpoint 60%)"]),
    "malaria": dict(name="Malaria", vector="Anopheles mosquito",
                    drivers=["Rainfall, lag 2 months, saturating (half-saturation 150 mm)",
                             "Mean temperature, lag 2 months, bell curve (optimum 25 °C)"]),
}
# Approximate city-centre coordinates, used only to place districts on the schematic map.
DISTRICT_LOCATION = {
    "chn": (13.08, 80.27), "cbe": (11.02, 76.96), "mdu": (9.93, 78.12),
    "try": (10.79, 78.70), "tnj": (10.79, 79.14),
}
DISCLAIMER = ("Synthetic data — research demonstration only. All case records and climate scenarios are "
              "artificially generated. They are not Tamil Nadu surveillance data, climate projections or "
              "forecasts, and must not be used for clinical decisions or public-health alerts.")
LIMITATIONS = [
    "All values are synthetic; district populations and climatologies are illustrative, not real figures.",
    "Disease climate-response curves are modelling assumptions marked 'to be sourced'; results follow from them.",
    "Warming shortens recovery here only because the districts are warmer than the assumed temperature optimums.",
    "Endemic thresholds are estimated from only 7 training years (2015–2021).",
    "Recovery rules (1.2 × median threshold, 3-month window, interruption rule) are project conventions, not epidemiological standards.",
    "Series that never recover by Dec 2024 are censored: their recovery time is a lower bound, not a value.",
    "The estimated reference peak (t0) differs from the true t0 in some series.",
    "Flood exposure and intervention profiles are recorded but not used by generator v0.1.0.",
    "The implemented dataset departs from the written plan in climate variables, threshold method and disease choice.",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "mock" / "api" / "v1"))
    a = ap.parse_args()
    P = Path(a.project).resolve()
    OUT = Path(a.out)
    sys.path.insert(0, str(P / "src"))
    from recovery_engine import assess_recovery  # project's own engine

    sim_cfg = json.loads((P / "configs" / "simulation_defaults.json").read_text())
    rule = next(r for r in sim_cfg["recovery_rules"] if r["recovery_rule_id"] == "r3m_f1.2")
    rd = lambda p: pd.read_csv(P / "data" / p)
    cases = rd("synthetic/disease_cases.csv")
    clim = rd("synthetic/climate_history.csv")
    meta_d = rd("synthetic/district_metadata.csv")
    anom = rd("synthetic/climate_anomalies.csv")
    scen = rd("synthetic/scenarios.csv")
    thr = rd("derived/seasonal_baseline_thresholds.csv")
    runs = rd("outputs/simulation_runs.csv")
    truth = rd("ground_truth/recovery_truth.csv")
    sens = rd("outputs/sensitivity_grid.csv")

    months = sorted(cases.year_month.unique())
    N = len(months)
    idx = {m: i for i, m in enumerate(months)}
    cal = np.array([int(m[5:]) for m in months])
    W = int(rule["window_months"])
    w0, w1 = idx[sim_cfg["demo_window"]["peak_search_start"]], idx[sim_cfg["demo_window"]["peak_search_end"]]

    def anomaly_windows(sid):
        out = []
        for r in anom[anom.scenario_id == sid].itertuples():
            s = idx[r.start_month]
            e = min(s + int(r.duration_months), N) - 1
            out.append({"anomaly_id": r.anomaly_id, "type": r.anomaly_type, "start_month": r.start_month,
                        "end_month": months[e], "magnitude": float(r.magnitude), "unit": r.magnitude_unit,
                        "period_months": as_int(r.period_months)})
        return out

    # ------------------------------------------------------------ meta
    scenarios = []
    for r in scen.itertuples():
        scenarios.append({"id": r.scenario_id, **SCEN_META[r.scenario_id], "description": r.description.replace("degC", "°C"),
                          "anomalies": anomaly_windows(r.scenario_id)})
    meta = {
        "api_version": API_VERSION, "dataset_version": "0.1.1", "generator_version": sim_cfg["model_version"],
        "seed": sim_cfg["master_seed"], "synthetic": True, "disclaimer": DISCLAIMER,
        "horizon": {"start_month": months[0], "end_month": months[-1]},
        "training_period": {"start_month": months[0], "end_month": sim_cfg["training_end_month"]},
        "peak_search_window": {"start_month": sim_cfg["demo_window"]["peak_search_start"],
                               "end_month": sim_cfg["demo_window"]["peak_search_end"]},
        "districts": [{"id": r.district_id, "name": r.district_name, "climate_zone": r.climate_zone,
                       "population_illustrative": int(r.population),
                       "location": {"lat": DISTRICT_LOCATION[r.district_id][0], "lon": DISTRICT_LOCATION[r.district_id][1], "approximate": True}}
                      for r in meta_d.itertuples()],
        "diseases": [{"id": k, **v} for k, v in DISEASE_META.items()],
        "scenarios": scenarios,
        "recovery_rule": {"id": rule["recovery_rule_id"], "threshold_factor": rule["threshold_factor"],
                          "window_months": W, "interruption_rise_factor": rule["interruption_rise_factor"],
                          "interruption_rise_months": rule["interruption_rise_months"],
                          "max_missing_frac": rule["max_missing_frac"],
                          "threshold_definition": "1.2 × median of cases in the same calendar month, 2015–2021 (baseline, observed)",
                          "tsr_definition": "Months from the reference peak t0 to the first month of the first run of 3 consecutive months at or below the threshold",
                          "interruption_definition": "After at least one month of decline, cases rise above the threshold and to ≥ 1.2 × the latest low for 2 consecutive months"},
        "masks": [{"id": k, **v} for k, v in MASK_META.items()],
        "limitations": LIMITATIONS,
        "replicates": int(sim_cfg["replicates_for_spread"]),
    }
    jdump(meta, OUT / "meta.json")

    thr_map = {(r.district_id, r.disease_id, r.calendar_month): float(r.threshold_cases) for r in thr.itertuples()}
    runs_none = runs[runs.mask_id.isna()].set_index(["scenario_id", "disease_id", "district_id"])
    mismatches = []

    def rec_block(res, t0, run_row):
        status = res["status"]
        tsr = res["time_to_sustained_recovery_months"]
        lb = (N - W + 1) - t0 if status == "not_recovered_within_horizon" else None
        return {
            "status": status, "tsr_months": tsr, "tsr_lower_bound_months": lb,
            "recovery_month": months[res["recovery_index"]] if res["recovery_index"] is not None else None,
            "recovery_confirmed_month": months[res["confirmed_index"]] if res["confirmed_index"] is not None else None,
            "interruption_count": res["recovery_interruption_count"],
            "months_above_threshold": res["months_above_endemic_threshold"],
            "secondary_outbreak_count": res["secondary_outbreak_count"],
            "uncertainty": {"p10_months": none_if_nan(run_row.recovery_months_p10),
                            "p90_months": none_if_nan(run_row.recovery_months_p90),
                            "share_replicates_recovered": float(run_row.share_replicates_recovered),
                            "replicates": meta["replicates"]},
        }

    def waves_of(series, res):
        out = []
        for wo in res["wave_onsets"]:
            seg = series[wo:wo + 6]
            wp = wo + int(np.nanargmax(seg))
            interrupts = res["recovery_index"] is None or wo < res["recovery_index"]
            out.append({"onset_month": months[wo], "peak_month": months[wp], "peak_cases": int(series[wp]),
                        "interrupts_recovery": bool(interrupts)})
        return out

    matrix = {d: [] for d in DISEASE_META}
    for (dist, dis), _ in cases.groupby(["district_id", "disease_id"]):
        th = np.array([thr_map[(dist, dis, m)] for m in cal])
        ser = {}
        for s in scen.scenario_id:
            sub = cases[(cases.district_id == dist) & (cases.disease_id == dis) & (cases.scenario_id == s)].sort_values("year_month")
            cl = clim[(clim.district_id == dist) & (clim.scenario_id == s)].sort_values("year_month")
            ser[s] = (sub.cases.to_numpy(float), cl)
        ob = ser["baseline"][0]
        t0 = w0 + int(np.nanargmax(ob[w0:w1 + 1]))
        results = {}
        for s in scen.scenario_id:
            res = assess_recovery(ser[s][0], th, t0, W, rule["interruption_rise_factor"], rule["interruption_rise_months"], rule["max_missing_frac"])
            results[s] = res
            rr = runs_none.loc[(s, dis, dist)]
            # mock must agree with the published engine output
            if (rr.recovery_status != res["status"] or as_int(rr.time_to_sustained_recovery_months) != res["time_to_sustained_recovery_months"]
                    or int(rr.recovery_interruption_count) != res["recovery_interruption_count"] or rr.reference_month != months[t0]):
                mismatches.append((s, dis, dist))
        bres = results["baseline"]
        for s in scen.scenario_id:
            res = results[s]
            rr_b, rr_s = runs_none.loc[("baseline", dis, dist)], runs_none.loc[(s, dis, dist)]
            b, sc = rec_block(bres, t0, rr_b), rec_block(res, t0, rr_s)
            if b["status"] == "recovered" and sc["status"] == "recovered":
                delta, dlb, dstat = sc["tsr_months"] - b["tsr_months"], None, "computed"
            elif b["status"] == "recovered" and sc["status"] == "not_recovered_within_horizon":
                delta, dlb, dstat = None, sc["tsr_lower_bound_months"] - b["tsr_months"], "lower_bound"
            else:
                delta, dlb, dstat = None, None, "undefined"
            def climate(cl):
                return {"rainfall_mm": cl.rainfall_mm.round(1).tolist(),
                        "mean_temperature_c": cl.mean_temperature_c.round(1).tolist(),
                        "relative_humidity_pct": cl.relative_humidity_pct.round(1).tolist()}
            body = {
                "api_version": API_VERSION, "dataset_version": meta["dataset_version"], "synthetic": True,
                "request": {"district": dist, "disease": dis, "scenario": s, "recovery_rule": rule["recovery_rule_id"]},
                "months": months,
                "threshold_cases": [round(x, 2) for x in th.tolist()],
                "reference": {"t0_month": months[t0], "t0_cases_baseline": int(ob[t0]),
                              "peak_search_window": meta["peak_search_window"]},
                "anomaly_windows": anomaly_windows(s),
                "series": {
                    "baseline": {"observed_cases": [int(x) for x in ob], **climate(ser["baseline"][1])},
                    "scenario": {"observed_cases": [int(x) for x in ser[s][0]], **climate(ser[s][1])},
                },
                "recovery": {"baseline": b, "scenario": sc, "delta_tsr_months": delta,
                             "delta_tsr_lower_bound_months": dlb, "delta_status": dstat},
                "waves": {"baseline": waves_of(ob, bres), "scenario": waves_of(ser[s][0], res)},
                "provenance": {"source": "mock", "seed": meta["seed"], "generator_version": meta["generator_version"],
                               "recovery_rule": rule["recovery_rule_id"], "replicate": 0,
                               "generated_from": "simulation_runs.csv (mask none) + recovery_engine.assess_recovery"},
            }
            jdump(body, OUT / "simulations" / f"{dist}__{dis}__{s}.json")
            matrix[dis].append({"scenario": s, "district": dist, "status": sc["status"], "tsr_months": sc["tsr_months"],
                                "tsr_lower_bound_months": sc["tsr_lower_bound_months"],
                                "baseline_tsr_months": b["tsr_months"], "delta_tsr_months": delta,
                                "delta_tsr_lower_bound_months": dlb, "delta_status": dstat,
                                "interruption_count": sc["interruption_count"],
                                "months_above_threshold": sc["months_above_threshold"],
                                "secondary_outbreak_count": sc["secondary_outbreak_count"],
                                "t0_month": months[t0]})
    for dis, rows in matrix.items():
        jdump({"api_version": API_VERSION, "dataset_version": meta["dataset_version"], "synthetic": True,
               "request": {"disease": dis, "recovery_rule": rule["recovery_rule_id"], "mask": None},
               "cells": rows}, OUT / "recovery-matrix" / f"{dis}.json")

    # ------------------------------------------------------------ validation
    tr = truth.set_index(["scenario_id", "disease_id", "district_id"])
    for dis in DISEASE_META:
        rows = []
        for r in runs[runs.disease_id == dis].itertuples():
            t = tr.loc[(r.scenario_id, dis, r.district_id)]
            et, tt = as_int(r.time_to_sustained_recovery_months), as_int(t.true_time_to_sustained_recovery_months)
            rows.append({"scenario": r.scenario_id, "district": r.district_id, "mask": none_if_nan(r.mask_id),
                         "estimated_status": r.recovery_status, "estimated_tsr_months": et,
                         "true_status": t.true_recovery_status, "true_tsr_months": tt,
                         "true_reference_month": t.reference_month, "estimated_reference_month": r.reference_month,
                         "absolute_error_months": abs(et - tt) if et is not None and tt is not None else None,
                         "status_match": r.recovery_status == t.true_recovery_status,
                         "p10_months": none_if_nan(r.recovery_months_p10), "p90_months": none_if_nan(r.recovery_months_p90),
                         "share_replicates_recovered": float(r.share_replicates_recovered),
                         "estimated_interruptions": int(r.recovery_interruption_count),
                         "true_interruptions": int(t.true_recovery_interruption_count)})
        df = pd.DataFrame(rows)
        summary = []
        for m, g in df.groupby(df["mask"].fillna("__none__"), sort=False):
            ae = g.absolute_error_months.dropna()
            summary.append({"mask": None if m == "__none__" else m, "n_series": len(g), "n_compared": int(ae.size),
                            "mae_months": round(float(ae.mean()), 2) if ae.size else None,
                            "status_agreement": round(float(g.status_match.mean()), 3),
                            "n_insufficient_data": int((g.estimated_status == "insufficient_data").sum()),
                            "n_censored_estimate": int((g.estimated_status == "not_recovered_within_horizon").sum())})
        sg = sens[sens.disease_id == dis]
        sgrid = [{"window_months": int(w), "threshold_factor": float(f), "n_compared": int(g.absolute_error_months.notna().sum()),
                  "mae_months": round(float(g.absolute_error_months.mean()), 2),
                  "status_agreement": round(float(g.status_match.mean()), 3),
                  "is_default": int(w) == W and float(f) == rule["threshold_factor"]}
                 for (w, f), g in sg.groupby(["window_months", "threshold_factor"])]
        jdump({"api_version": API_VERSION, "dataset_version": meta["dataset_version"], "synthetic": True,
               "request": {"disease": dis}, "rows": rows, "summary_by_mask": summary,
               "sensitivity": sgrid,
               "notes": ["Truth = recovery on noise-free expected cases with the true endemic threshold (evaluation only).",
                         "Estimate = recovery engine on observed (noisy) cases with thresholds estimated from 2015–2021.",
                         "Absolute error is only defined when both truth and estimate recovered."]},
              OUT / "validation" / f"{dis}.json")

    print(f"wrote mock API to {OUT}")
    print(f"engine vs simulation_runs mismatches: {len(mismatches)} {mismatches[:5]}")
    return 0 if not mismatches else 1


if __name__ == "__main__":
    raise SystemExit(main())
