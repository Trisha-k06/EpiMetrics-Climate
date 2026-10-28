"""Builds derived tables from the generated CSVs (run after generate_data.py).

data/synthetic/climate_normals.csv            per-district monthly climatology (generator input)
data/derived/seasonal_baseline_thresholds.csv thresholds estimated from OBSERVED baseline cases, 2015-2021
data/derived/model_ready_dataset.csv          cases + climate + lag features + chronological split (no ground truth)
data/outputs/sensitivity_grid.csv             true vs estimated recovery under alternative recovery rules
data/outputs/simulation_results_template.csv  empty schema for results written by the simulator
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery_engine import assess_recovery, threshold_from_history  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SYN, TRUTH, OUT, DER = (ROOT / "data" / x for x in ("synthetic", "ground_truth", "outputs", "derived"))
SIM = json.loads((ROOT / "configs" / "simulation_defaults.json").read_text())
DIST = json.loads((ROOT / "configs" / "districts.json").read_text())["districts"]
TRAIN_END = SIM["training_end_month"]
THRESHOLD_FACTORS = [1.1, 1.2, 1.3, 1.5]


def write(df, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    print(f"{path.relative_to(ROOT)}: {len(df)} rows")


def climate_normals():
    rows = []
    for d in DIST:
        mx = max(d["rain_climatology_mm"])
        for m in range(1, 13):
            r = d["rain_climatology_mm"][m - 1]
            rows.append({"district_id": d["district_id"], "calendar_month": m, "rainfall_normal_mm": r,
                         "temperature_normal_c": round(d["temp_base_c"] + d["temp_amplitude_c"] * np.cos(2 * np.pi * (m - 5) / 12), 2),
                         "humidity_normal_pct": round(d["humidity_base_pct"] + 18 * r / mx, 2), "data_type": "synthetic_parameter"})
    return pd.DataFrame(rows)


def main():
    cases = pd.read_csv(SYN / "disease_cases.csv")
    clim = pd.read_csv(SYN / "climate_history.csv")
    meta = pd.read_csv(SYN / "district_metadata.csv")
    truth_traj = pd.read_csv(TRUTH / "ground_truth_trajectories.csv")
    rec_truth = pd.read_csv(TRUTH / "recovery_truth.csv")
    runs = pd.read_csv(OUT / "simulation_runs.csv")
    rules = pd.read_csv(SYN / "recovery_rules.csv")

    write(climate_normals(), SYN / "climate_normals.csv")

    # seasonal thresholds from observed baseline training years
    base = cases[cases.scenario_id == "baseline"].copy()
    base["calendar_month"] = base.year_month.str[5:].astype(int)
    tr = base[base.year_month <= TRAIN_END]
    thr = tr.groupby(["district_id", "disease_id", "calendar_month"]).cases.agg(training_median_cases="median", training_months="count").reset_index()
    thr["threshold_factor"] = 1.2
    thr["threshold_cases"] = (thr.training_median_cases * 1.2).clip(lower=1).round(2)
    thr["training_period"] = f"{SIM['start_month']} to {TRAIN_END}"
    write(thr, DER / "seasonal_baseline_thresholds.csv")

    # model-ready table (inputs only, no ground truth)
    df = cases.merge(clim.drop(columns="data_type"), on=["year_month", "district_id", "scenario_id"]).merge(meta[["district_id", "population"]], on="district_id")
    df = df.sort_values(["scenario_id", "disease_id", "district_id", "year_month"]).reset_index(drop=True)
    df["calendar_month"] = df.year_month.str[5:].astype(int)
    df["year"] = df.year_month.str[:4].astype(int)
    g = df.groupby(["scenario_id", "disease_id", "district_id"])
    for v, lags in (("rainfall_mm", 3), ("mean_temperature_c", 2), ("relative_humidity_pct", 2)):
        for k in range(1, lags + 1):
            df[f"{v}_lag{k}"] = g[v].shift(k)
    df["cases_lag1"] = g.cases.shift(1)
    df["cases_lag12"] = g.cases.shift(12)
    # log-transformed target with 1-step lookahead (project plan section 3.3),
    # computed on each full, continuous series BEFORE rows are filtered
    df["y_log"] = np.log1p(df.cases).round(6)
    df["y_next"] = g.y_log.shift(-1)

    # De-duplication: every scenario shares the baseline climate and cases until
    # its first anomaly month, so those rows are exact copies of baseline rows.
    # Keep scenario rows only from the scenario's first anomaly month onward;
    # lags and y_next above were computed on the full series, so they stay valid.
    anom = pd.read_csv(SYN / "climate_anomalies.csv")
    scen_start = anom.groupby("scenario_id").start_month.min().to_dict()
    df["scenario_window_start"] = df.scenario_id.map(scen_start)
    keep = (df.scenario_id == "baseline") | (df.year_month >= df.scenario_window_start)
    df = df[keep].copy()
    df["split"] = np.select(
        [df.scenario_id != "baseline", df.year_month <= TRAIN_END],
        ["scenario", "train"], default="test")
    # After a short anomaly wears off (or before a later anomaly in a compound
    # scenario starts), a scenario row can be identical to another scenario's
    # row. Such rows are kept so every scenario series stays continuous for
    # recovery evaluation, but flagged: duplicate_of = the first scenario (in
    # configs order, baseline first) holding an identical row; empty if unique.
    order = {s["scenario_id"]: i for i, s in enumerate(SIM["scenarios"])}
    feat = ["year_month", "district_id", "disease_id", "cases", "rainfall_mm", "mean_temperature_c",
            "relative_humidity_pct", "rainfall_mm_lag1", "rainfall_mm_lag2", "rainfall_mm_lag3",
            "mean_temperature_c_lag1", "mean_temperature_c_lag2", "relative_humidity_pct_lag1",
            "relative_humidity_pct_lag2", "cases_lag1", "cases_lag12", "y_next"]
    df["_o"] = df.scenario_id.map(order)
    df = df.sort_values(["_o", "disease_id", "district_id", "year_month"])
    first = df.groupby(feat, dropna=False).scenario_id.transform("first")
    df["duplicate_of"] = np.where(first != df.scenario_id, first, None)
    df = df.drop(columns="_o").sort_values(["scenario_id", "disease_id", "district_id", "year_month"])
    cols = ["year_month", "district_id", "disease_id", "scenario_id", "year", "calendar_month", "population", "cases", "cases_per_100k",
            "rainfall_mm", "mean_temperature_c", "relative_humidity_pct",
            "rainfall_mm_lag1", "rainfall_mm_lag2", "rainfall_mm_lag3", "mean_temperature_c_lag1", "mean_temperature_c_lag2",
            "relative_humidity_pct_lag1", "relative_humidity_pct_lag2", "cases_lag1", "cases_lag12", "y_log", "y_next",
            "scenario_window_start", "split", "duplicate_of", "data_type"]
    write(df[cols], DER / "model_ready_dataset.csv")

    # sensitivity grid: rule window x threshold factor, truth vs estimate
    months = sorted(cases.year_month.unique())
    idx = {m: i for i, m in enumerate(months)}
    cal = np.array([int(m[5:]) for m in months])
    train = np.array([m <= TRAIN_END for m in months])
    est_t0 = runs[runs.mask_id.isna()].set_index(["scenario_id", "disease_id", "district_id"]).reference_month
    rows = []
    for (s, dz, di), gt in truth_traj.groupby(["scenario_id", "disease_id", "district_id"]):
        gt = gt.sort_values("year_month")
        mu, E = gt.expected_cases.to_numpy(), gt.endemic_baseline_cases.to_numpy()
        obs = cases[(cases.scenario_id == s) & (cases.disease_id == dz) & (cases.district_id == di)].sort_values("year_month").cases.to_numpy(float)
        obs_b = base[(base.disease_id == dz) & (base.district_id == di)].sort_values("year_month").cases.to_numpy(float)
        t0_true = idx[rec_truth.set_index(["scenario_id", "disease_id", "district_id"]).loc[(s, dz, di), "reference_month"]]
        t0_est = idx[est_t0.loc[(s, dz, di)]]
        for _, r in rules.iterrows():
            for f in THRESHOLD_FACTORS:
                tru = assess_recovery(mu, f * E, t0_true, int(r.window_months), r.interruption_rise_factor, int(r.interruption_rise_months))
                th = threshold_from_history(obs_b, cal, train, f)
                est = assess_recovery(obs, th, t0_est, int(r.window_months), r.interruption_rise_factor, int(r.interruption_rise_months), r.max_missing_frac)
                tt, et = tru["time_to_sustained_recovery_months"], est["time_to_sustained_recovery_months"]
                rows.append({"scenario_id": s, "disease_id": dz, "district_id": di, "window_months": int(r.window_months), "threshold_factor": f,
                             "true_time_to_sustained_recovery_months": tt, "true_recovery_status": tru["status"],
                             "true_recovery_interruption_count": tru["recovery_interruption_count"],
                             "estimated_time_to_sustained_recovery_months": et, "estimated_recovery_status": est["status"],
                             "estimated_recovery_interruption_count": est["recovery_interruption_count"],
                             "absolute_error_months": abs(et - tt) if tt is not None and et is not None else None,
                             "status_match": tru["status"] == est["status"]})
    write(pd.DataFrame(rows), OUT / "sensitivity_grid.csv")

    write(runs.iloc[0:0], OUT / "simulation_results_template.csv")


if __name__ == "__main__":
    main()
