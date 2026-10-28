"""Synthetic data generator for EpiMetrics-Climate.

SYNTHETIC DATA - RESEARCH DEMONSTRATION ONLY. Every value produced here is
artificially generated from the HYPOTHETICAL assumptions in configs/*.json.
Nothing here describes real Tamil Nadu surveillance or climate projections.

Design notes
- Climate: per-district monthly climatology x seeded noise. Scenarios are
  transformations of the SAME baseline climate (anomalies in climate_anomalies).
- Disease: expected cases = endemic seasonal baseline E_t x exp(L_t), where
  L_t = rho * L_{t-1} + climate effect (lagged, disease-specific response
  relative to climatology) + outbreak shocks. Observed cases are negative-
  binomial draws from the expected value.
- Common random numbers: shocks and observation-noise uniforms are fixed per
  series, so differences between scenarios come only from climate.
- Ground truth (expected trajectories, true thresholds, true recovery) is
  written to data/ground_truth/, separate from model inputs.

Run:  python src/generate_data.py   (from the project root)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import nbinom

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from recovery_engine import assess_recovery, threshold_from_history  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CFG = ROOT / "configs"
SYN = ROOT / "data" / "synthetic"
TRUTH = ROOT / "data" / "ground_truth"
OUT = ROOT / "data" / "outputs"


def load(name):
    return json.loads((CFG / name).read_text())


DIST = load("districts.json")["districts"]
DIS = load("diseases.json")["diseases"]
SIM = load("simulation_defaults.json")

MONTHS = pd.period_range(SIM["start_month"], SIM["end_month"], freq="M")
N = len(MONTHS)
YM = MONTHS.strftime("%Y-%m").to_numpy()
CAL = MONTHS.month.to_numpy()
YEAR = MONTHS.year.to_numpy()
IDX = {ym: i for i, ym in enumerate(YM)}
TRAIN = MONTHS <= pd.Period(SIM["training_end_month"], freq="M")
SCEN = [s["scenario_id"] for s in SIM["scenarios"]]
RULE = next(r for r in SIM["recovery_rules"] if r["recovery_rule_id"] == "r3m_f1.2")
SEED = SIM["master_seed"]


# ---------------------------------------------------------------- climate
def climatology(d):
    rain = np.array(d["rain_climatology_mm"], float)[CAL - 1]
    temp = d["temp_base_c"] + d["temp_amplitude_c"] * np.cos(2 * np.pi * (CAL - 5) / 12)
    hum = d["humidity_base_pct"] + 18 * rain / max(d["rain_climatology_mm"])
    return rain, temp, hum


def baseline_climate(d, di):
    cn = SIM["climate_noise"]
    rng = np.random.default_rng([SEED, 1, di])
    rain_c, temp_c, hum_c = climatology(d)
    years = np.unique(YEAR)
    season_f = {y: rng.lognormal(0, cn["rain_season_lognormal_sd"], 2) for y in years}
    sf = np.array([season_f[y][0] if m >= 10 else season_f[y][1] if 6 <= m <= 9 else 1.0 for y, m in zip(YEAR, CAL)])
    rain = rain_c * sf * rng.lognormal(0, cn["rain_month_lognormal_sd"], N)
    temp = temp_c + cn["temp_trend_c_per_year"] * (YEAR - YEAR[0]) + rng.normal(0, cn["temp_sd_c"], N)
    hum_noise = rng.normal(0, cn["humidity_sd_pct"], N)
    hum = humidity(hum_c, rain, rain_c, hum_noise)
    return rain, temp, hum, hum_noise


def humidity(hum_c, rain, rain_c, noise):
    return np.clip(hum_c + np.clip(0.02 * (rain - rain_c), -8, 12) + noise, 35, 97)


def window_idx(start, months):
    s = IDX[start]
    return np.arange(s, min(s + months, N))


def apply_anomalies(scenario_id, d, base):
    rain, temp, _, hum_noise = (x.copy() for x in base)
    rain0 = base[0]
    for a in SIM["climate_anomalies"]:
        if a["scenario_id"] != scenario_id or a["district_id"] not in ("all", d["district_id"]):
            continue
        w = window_idx(a["start_month"], a["duration_months"])
        t, mag = a["anomaly_type"], a["magnitude"]
        if t == "monsoon_shift":
            rain[w] = rain0[w - int(mag)]
        elif t == "heavy_rain":
            rain[w] = rain[w] + mag
        elif t == "prolonged_wet":
            rain[w] = np.maximum(rain[w], mag)
        elif t == "rainfall_pct":
            rain[w] = rain[w] * (1 + mag / 100)
        elif t == "irregular_rain":
            wet = w[(w - w[0]) % int(a["period_months"]) == 0]
            rain[wet] = rain[wet] + mag
        elif t == "temperature_shift":
            temp[w] = temp[w] + mag
        else:
            raise ValueError(t)
    rain_c, _, hum_c = climatology(d)
    hum = humidity(hum_c, rain, rain_c, hum_noise)
    return rain, temp, hum


# ---------------------------------------------------------------- disease
def response(x, p):
    s = p["shape"]
    if s == "hump":
        r = (x + 10) / p["optimum_mm"]
        return r * np.exp(1 - r)
    if s == "saturating":
        return (x + 10) / (x + 10 + p["half_saturation_mm"])
    if s == "gaussian":
        return np.exp(-((x - p["optimum"]) ** 2) / (2 * p["width"] ** 2))
    if s == "logistic":
        return 1 / (1 + np.exp(-(x - p["midpoint"]) / p["scale"]))
    raise ValueError(s)


def endemic(dz, d):
    sp = dz["seasonality_params"]
    season = 1 + sp["amplitude"] * np.cos(2 * np.pi * (CAL - sp["peak_month"]) / 12)
    urban = 1 - dz["urban_effect"] / 2 + dz["urban_effect"] * d["urbanisation_pct"] / 100
    storage = 1 - dz["water_storage_effect"] / 2 + dz["water_storage_effect"] * d["water_storage_index"]
    return d["population"] / 1e5 * dz["baseline_rate_per_100k"] * season * urban * storage


def climate_effect(dz, d, clim):
    rain, temp, hum = clim
    rain_c, temp_c, hum_c = climatology(d)
    series = {"rainfall_mm": (rain, rain_c), "mean_temperature_c": (temp, temp_c), "relative_humidity_pct": (hum, hum_c)}
    eff = np.zeros(N)
    for var, p in dz["climate_drivers"].items():
        x, xc = series[var]
        L = p["lag_months"]
        mod = (1.3 - 0.6 * d["drainage_index"]) if var == "rainfall_mm" else 1.0
        term = np.zeros(N)
        term[L:] = np.log(response(x[:N - L], p)) - np.log(response(xc[:N - L], p))
        eff += p["weight"] * mod * term
    return np.clip(eff, -1.5, 1.5)


def shocks(dz, di, ki):
    """Outbreak seeds: random ones outside the demo blackout + the demo outbreak."""
    rng = np.random.default_rng([SEED, 2, di, ki])
    s = np.zeros(N)
    events = []
    ro = dz["random_outbreaks"]
    b0, b1 = (IDX[x] for x in SIM["demo_window"]["random_outbreak_blackout"])
    t = 0
    while t < N - 1:
        if not (b0 - 6 <= t <= b1) and rng.random() < ro["prob_per_month"]:
            a = rng.uniform(*ro["log_amplitude_range"])
            s[t] += a
            s[t + 1] += 0.8 * a
            events.append(("random", t))
            t += 8
        else:
            t += 1
    demo = dz["demo_outbreak"]
    t0 = IDX[demo["start_month"]]
    for k, a in enumerate(demo["log_amplitudes"]):
        s[t0 + k] += a
    events.append(("demo", t0))
    return s, events


def expected(dz, d, clim, shock):
    E = endemic(dz, d)
    eff = climate_effect(dz, d, clim)
    rho = dz["persistence_rho"]
    L = np.zeros(N)
    for t in range(N):
        L[t] = (rho * L[t - 1] if t else 0.0) + eff[t] + shock[t]
    return E, E * np.exp(L), eff


def observe(mu, k, u):
    p = k / (k + mu)
    return nbinom.ppf(u, k, p).astype(int)


# ---------------------------------------------------------------- masks
def build_masks():
    rows = []
    for m in SIM["missing_data_masks"]:
        for di, d in enumerate(DIST):
            for var in m["variables"]:
                targets = [dz["disease_id"] for dz in DIS] if var == "cases" else [None]
                for ki, did in enumerate(targets):
                    if "fraction" in m:
                        rng = np.random.default_rng([SEED, 3, di, ki, hash_var(var)])
                        idx = np.sort(rng.choice(np.arange(N), int(round(m["fraction"] * N)), replace=False))
                    else:
                        idx = window_idx(m["start_month"], m["duration_months"])
                    for i in idx:
                        rows.append({"mask_id": m["mask_id"], "year_month": YM[i], "district_id": d["district_id"],
                                     "disease_id": did, "variable": var, "missing_reason": m["missing_reason"]})
    return pd.DataFrame(rows)


def hash_var(v):
    return {"cases": 1, "rainfall_mm": 2, "mean_temperature_c": 3, "relative_humidity_pct": 4}[v]


# ---------------------------------------------------------------- main
def main():
    for p in (SYN, TRUTH, OUT):
        p.mkdir(parents=True, exist_ok=True)
    R = SIM["replicates_for_spread"]
    created = datetime(2026, 10, 26, tzinfo=timezone.utc).isoformat()
    w0, w1 = IDX[SIM["demo_window"]["peak_search_start"]], IDX[SIM["demo_window"]["peak_search_end"]]

    climate_rows, case_rows, truth_rows, event_rows, rec_truth, runs = [], [], [], [], [], []
    masks = build_masks()

    for di, d in enumerate(DIST):
        base = baseline_climate(d, di)
        clim_by_s = {s: (base[:3] if s == "baseline" else apply_anomalies(s, d, base)) for s in SCEN}
        for s in SCEN:
            rain, temp, hum = clim_by_s[s]
            for i in range(N):
                climate_rows.append({"year_month": YM[i], "district_id": d["district_id"], "scenario_id": s,
                                     "rainfall_mm": round(float(rain[i]), 1), "mean_temperature_c": round(float(temp[i]), 1),
                                     "relative_humidity_pct": round(float(hum[i]), 1),
                                     "data_type": "synthetic_observed" if s == "baseline" else "scenario"})

        for ki, dz in enumerate(DIS):
            shock, evs = shocks(dz, di, ki)
            urng = np.random.default_rng([SEED, 4, di, ki])
            U = urng.uniform(1e-6, 1 - 1e-6, size=(R, N))  # replicate 0 = published data
            k = dz["nb_dispersion_k"]
            series = {}
            for s in SCEN:
                E, mu, eff = expected(dz, d, clim_by_s[s], shock)
                series[s] = (E, mu, eff, [observe(mu, k, U[r]) for r in range(R)])

            # --- reference months (from BASELINE, shared by all scenarios)
            E, mu_b, _, obs_b = series["baseline"]
            t0_true = w0 + int(np.argmax(mu_b[w0:w1 + 1]))
            T_true = RULE["threshold_factor"] * E

            # random outbreak events (identical in every scenario: climate differs only from 2022-07)
            for kind, t in evs:
                if kind != "random":
                    continue
                pk = t + int(np.argmax(mu_b[t:t + 5]))
                r = assess_recovery(mu_b, T_true, pk, RULE["window_months"], RULE["interruption_rise_factor"], RULE["interruption_rise_months"])
                event_rows.append(event_row(d, dz, "all", "primary", t, pk, r, "random seed"))

            for s in SCEN:
                E, mu, eff, obs = series[s]
                for i in range(N):
                    truth_rows.append({"year_month": YM[i], "district_id": d["district_id"], "disease_id": dz["disease_id"], "scenario_id": s,
                                       "endemic_baseline_cases": round(float(E[i]), 2), "true_threshold_cases": round(float(T_true[i]), 2),
                                       "expected_cases": round(float(mu[i]), 2), "climate_log_effect": round(float(eff[i]), 4),
                                       "data_type": "synthetic_reference"})
                    c = int(obs[0][i])
                    case_rows.append({"year_month": YM[i], "district_id": d["district_id"], "disease_id": dz["disease_id"], "scenario_id": s,
                                      "cases": c, "cases_per_100k": round(c / d["population"] * 1e5, 3),
                                      "data_type": "synthetic_observed" if s == "baseline" else "scenario"})

                # --- ground-truth recovery on the noise-free expected trajectory
                r = assess_recovery(mu, T_true, t0_true, RULE["window_months"], RULE["interruption_rise_factor"], RULE["interruption_rise_months"])
                onset = first_above_before(mu, T_true, t0_true)
                event_rows.append(event_row(d, dz, s, "primary", onset, t0_true, r, "demo outbreak"))
                for wo in r["wave_onsets"]:
                    wp = wo + int(np.argmax(mu[wo:wo + 6]))
                    rw = assess_recovery(mu, T_true, wp, RULE["window_months"], RULE["interruption_rise_factor"], RULE["interruption_rise_months"])
                    etype = "recurrent_wave" if (r["recovery_index"] is None or wo < r["recovery_index"]) else "primary"
                    event_rows.append(event_row(d, dz, s, etype, wo, wp, rw, "detected on expected trajectory"))
                rec_truth.append(truth_rec_row(d, dz, s, t0_true, r))

            # --- estimates from OBSERVED cases (what the simulator would report)
            base_est = {}
            for mask_id in [None] + SIM["case_masks_for_runs"]:
                case_mask = case_mask_for(masks, mask_id, d["district_id"], dz["disease_id"])
                for s in SCEN:
                    obs = [o.astype(float) for o in series[s][3]]
                    est = []
                    for rr in range(R):
                        o = obs[rr].copy()
                        o[case_mask] = np.nan
                        ob = series["baseline"][3][rr].astype(float)
                        ob[case_mask] = np.nan
                        thr = threshold_from_history(ob, CAL, TRAIN, RULE["threshold_factor"])
                        t0 = w0 + int(np.nanargmax(ob[w0:w1 + 1]))
                        est.append(assess_recovery(o, thr, t0, RULE["window_months"], RULE["interruption_rise_factor"],
                                                   RULE["interruption_rise_months"], RULE["max_missing_frac"]) | {"t0": t0})
                    e0 = est[0]
                    ttr = [e["time_to_sustained_recovery_months"] for e in est if e["status"] == "recovered"]
                    if s == "baseline":
                        base_est[mask_id] = e0
                    b = base_est[mask_id]
                    delay = (e0["time_to_sustained_recovery_months"] - b["time_to_sustained_recovery_months"]
                             if e0["status"] == "recovered" and b["status"] == "recovered" else None)
                    runs.append({
                        "run_id": f"{s}__{dz['disease_id']}__{d['district_id']}__{mask_id or 'none'}",
                        "scenario_id": s, "disease_id": dz["disease_id"], "district_id": d["district_id"],
                        "seed": SEED, "model_version": SIM["model_version"], "recovery_rule_id": RULE["recovery_rule_id"],
                        "mask_id": mask_id, "reference_month": YM[e0["t0"]],
                        "recovery_month": YM[e0["recovery_index"]] if e0["recovery_index"] is not None else None,
                        "recovery_confirmed_month": YM[e0["confirmed_index"]] if e0["confirmed_index"] is not None else None,
                        "time_to_sustained_recovery_months": e0["time_to_sustained_recovery_months"],
                        "recovery_status": e0["status"],
                        "recovery_delay_vs_baseline_months": delay,
                        "recovery_interruption_count": e0["recovery_interruption_count"],
                        "months_above_endemic_threshold": e0["months_above_endemic_threshold"],
                        "secondary_outbreak_count": e0["secondary_outbreak_count"],
                        "recovery_months_p10": float(np.percentile(ttr, 10)) if len(ttr) >= R * 0.5 else None,
                        "recovery_months_p90": float(np.percentile(ttr, 90)) if len(ttr) >= R * 0.5 else None,
                        "share_replicates_recovered": round(len(ttr) / R, 2),
                        "created_at": created,
                    })

    write(pd.DataFrame(climate_rows), SYN / "climate_history.csv")
    write(pd.DataFrame(case_rows), SYN / "disease_cases.csv")
    write(masks, SYN / "missing_data_masks.csv")
    write(static_tables()["district_metadata"], SYN / "district_metadata.csv")
    write(static_tables()["environmental_vulnerability"], SYN / "environmental_vulnerability.csv")
    write(static_tables()["disease_profiles"], SYN / "disease_profiles.csv")
    write(pd.DataFrame(SIM["scenarios"]), SYN / "scenarios.csv")
    write(pd.DataFrame(SIM["climate_anomalies"]), SYN / "climate_anomalies.csv")
    write(pd.DataFrame(SIM["intervention_profiles"]), SYN / "intervention_profiles.csv")
    write(pd.DataFrame(SIM["recovery_rules"]), SYN / "recovery_rules.csv")
    write(pd.DataFrame(truth_rows), TRUTH / "ground_truth_trajectories.csv")
    ev = pd.DataFrame(event_rows)
    ev.insert(0, "event_id", [f"E{i + 1:04d}" for i in range(len(ev))])
    write(ev, TRUTH / "outbreak_events.csv")
    write(pd.DataFrame(rec_truth), TRUTH / "recovery_truth.csv")
    write(pd.DataFrame(runs), OUT / "simulation_runs.csv")
    print("done")


def first_above_before(mu, thr, peak):
    t = peak
    while t > 0 and mu[t - 1] > thr[t - 1]:
        t -= 1
    return t


def event_row(d, dz, s, etype, onset, peak, r, note):
    return {"disease_id": dz["disease_id"], "district_id": d["district_id"], "scenario_id": s, "source": "generator_truth",
            "event_type": etype, "onset_month": YM[onset], "peak_month": YM[peak],
            "recovery_month": YM[r["recovery_index"]] if r["recovery_index"] is not None else None,
            "recovery_status": r["status"], "note": note}


def truth_rec_row(d, dz, s, t0, r):
    return {"scenario_id": s, "disease_id": dz["disease_id"], "district_id": d["district_id"], "reference_month": YM[t0],
            "recovery_rule_id": RULE["recovery_rule_id"],
            "true_recovery_month": YM[r["recovery_index"]] if r["recovery_index"] is not None else None,
            "true_time_to_sustained_recovery_months": r["time_to_sustained_recovery_months"],
            "true_recovery_status": r["status"], "true_recovery_interruption_count": r["recovery_interruption_count"],
            "true_months_above_endemic_threshold": r["months_above_endemic_threshold"],
            "data_type": "synthetic_reference"}


def case_mask_for(masks, mask_id, district_id, disease_id):
    m = np.zeros(N, bool)
    if mask_id is None:
        return m
    sel = masks[(masks.mask_id == mask_id) & (masks.district_id == district_id) & (masks.variable == "cases") & (masks.disease_id == disease_id)]
    m[[IDX[x] for x in sel.year_month]] = True
    return m


def static_tables():
    dm = pd.DataFrame([{k: d[k] for k in ("district_id", "district_name", "population", "population_density_per_km2", "urbanisation_pct", "climate_zone")} for d in DIST])
    ev = pd.DataFrame([{k: d[k] for k in ("district_id", "drainage_index", "water_storage_index", "flood_exposure_index")} for d in DIST])
    dp = pd.DataFrame([{
        "disease_id": dz["disease_id"], "display_name": dz["display_name"], "baseline_rate_per_100k": dz["baseline_rate_per_100k"],
        "seasonality_params": json.dumps(dz["seasonality_params"]), "climate_drivers": ";".join(dz["climate_drivers"]),
        "lag_months": json.dumps({k: v["lag_months"] for k, v in dz["climate_drivers"].items()}),
        "response_params": json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("lag_months", "basis")} for k, v in dz["climate_drivers"].items()}),
        "persistence_rho": dz["persistence_rho"], "nb_dispersion_k": dz["nb_dispersion_k"], "recovery_rule_id": dz["recovery_rule_id"],
    } for dz in DIS])
    return {"district_metadata": dm, "environmental_vulnerability": ev, "disease_profiles": dp}


def write(df, path):
    df.to_csv(path, index=False)
    print(f"{path.relative_to(ROOT)}: {len(df)} rows")


if __name__ == "__main__":
    main()
