"""Data store: loads the synthetic dataset once and computes API responses with the project's own recovery engine.

The simulation logic is a port of frontend/tools/build_mock_api.py (the recipe the UI contract was built from)
and of the estimate loop in src/generate_data.py. The backend reproduces those results; it never changes them.
"""
from __future__ import annotations

import importlib.util
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from .jsonutil import as_int, num

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

API_VERSION = "1.0"
DATASET_VERSION = "0.1.1"


def _load_engine():
    spec = importlib.util.spec_from_file_location("recovery_engine", ROOT / "src" / "recovery_engine.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


engine = _load_engine()

SCEN_META = {
    "baseline": dict(label="Baseline", short="Generated climate, no anomaly", category="baseline", featured=True),
    "delayed_monsoon": dict(label="Delayed monsoon", short="NE monsoon rain arrives 2 months late", category="rainfall", featured=True),
    "heavy_rain_decline": dict(label="Extreme rain during decline", short="+250 mm pulse in Jan 2023 while cases fall", category="rainfall", featured=True),
    "prolonged_wet": dict(label="Prolonged wet spell", short="Rain held at ≥150 mm/month for 4 months", category="rainfall", featured=False),
    "irregular_rain": dict(label="Irregular rain", short="+220 mm every 2nd month to horizon end", category="rainfall", featured=False),
    "warmer": dict(label="Warmer (+1.5 °C)", short="+1.5 °C sustained from Jul 2022", category="temperature", featured=False),
    "warm_wet": dict(label="Warm and wet", short="+1.5 °C plus +40% rain Oct 2022 – Mar 2023", category="compound", featured=False),
}
# Case masks used for the published runs (configs/simulation_defaults.json: case_masks_for_runs).
MASK_META = {
    "none": dict(label="Complete data", description="No values removed"),
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
# Approximate city-centre coordinates, used only to place districts on the map.
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
CLIMATE_VARS = ["rainfall_mm", "mean_temperature_c", "relative_humidity_pct"]


class NotFound(Exception):
    """Unknown id (district, disease, scenario, mask)."""


class Store:
    """Loads every CSV once (paths relative to the repo root) and caches computed responses."""

    def __init__(self, root: Path = ROOT):
        self.root = root
        rd = lambda p: pd.read_csv(root / "data" / p)
        self.sim_cfg = json.loads((root / "configs" / "simulation_defaults.json").read_text())
        self.rule = next(r for r in self.sim_cfg["recovery_rules"] if r["recovery_rule_id"] == "r3m_f1.2")
        self.cases = rd("synthetic/disease_cases.csv")
        self.clim = rd("synthetic/climate_history.csv")
        self.district_meta = rd("synthetic/district_metadata.csv")
        self.vuln = rd("synthetic/environmental_vulnerability.csv")
        self.anom = rd("synthetic/climate_anomalies.csv")
        self.scen = rd("synthetic/scenarios.csv")
        self.masks = rd("synthetic/missing_data_masks.csv")
        self.thr = rd("derived/seasonal_baseline_thresholds.csv")
        self.runs = rd("outputs/simulation_runs.csv")
        self.truth = rd("ground_truth/recovery_truth.csv")
        self.sens = rd("outputs/sensitivity_grid.csv")
        self.catalog = pd.read_csv(root / "dataset_catalog.csv")
        for df in (self.cases, self.clim, self.masks, self.runs, self.truth):
            for c in ("year_month", "reference_month", "district_id", "disease_id", "scenario_id", "mask_id"):
                if c in df.columns:
                    df[c] = df[c].astype(object).where(df[c].notna(), None)

        self.months = sorted(str(m) for m in self.cases.year_month.unique())
        self.N = len(self.months)
        self.idx = {m: i for i, m in enumerate(self.months)}
        self.cal = np.array([int(m[5:]) for m in self.months])
        self.train_end = self.sim_cfg["training_end_month"]
        self.train_mask = np.array([m <= self.train_end for m in self.months])
        self.W = int(self.rule["window_months"])
        dw = self.sim_cfg["demo_window"]
        self.w0, self.w1 = self.idx[dw["peak_search_start"]], self.idx[dw["peak_search_end"]]

        self.district_ids = [str(d) for d in self.district_meta.district_id]
        self.disease_ids = list(DISEASE_META)
        self.scenario_ids = [str(s) for s in self.scen.scenario_id]
        self.mask_ids = list(MASK_META)
        self.population = dict(zip(self.district_meta.district_id, self.district_meta.population.astype(int)))

        self._thr_map = {(r.district_id, r.disease_id, int(r.calendar_month)): float(r.threshold_cases)
                         for r in self.thr.itertuples()}
        self._cases_idx = {k: g.sort_values("year_month") for k, g in self.cases.groupby(["district_id", "disease_id", "scenario_id"])}
        self._clim_idx = {k: g.sort_values("year_month") for k, g in self.clim.groupby(["district_id", "scenario_id"])}
        self._runs_idx = {(r.scenario_id, r.disease_id, r.district_id, r.mask_id or "none"): r for r in self.runs.itertuples()}

    # ------------------------------------------------------------------ ids
    def check(self, district=None, disease=None, scenario=None, mask=None):
        if district is not None and district not in self.district_ids:
            raise NotFound(f'Unknown district "{district}".')
        if disease is not None and disease not in self.disease_ids:
            raise NotFound(f'Unknown disease "{disease}".')
        if scenario is not None and scenario not in self.scenario_ids:
            raise NotFound(f'Unknown scenario "{scenario}".')
        if mask is not None and mask not in self.mask_ids:
            raise NotFound(f'Unknown mask "{mask}".')

    # ------------------------------------------------------------------ raw series
    def case_series(self, district, disease, scenario) -> np.ndarray:
        return self._cases_idx[(district, disease, scenario)].cases.to_numpy(float)

    def per100k_series(self, district, disease, scenario) -> np.ndarray:
        return self._cases_idx[(district, disease, scenario)].cases_per_100k.to_numpy(float)

    def climate_frame(self, district, scenario) -> pd.DataFrame:
        return self._clim_idx[(district, scenario)]

    def case_mask(self, mask, district, disease) -> np.ndarray:
        """Boolean array of masked case months (same rule as generate_data.case_mask_for)."""
        m = np.zeros(self.N, bool)
        if mask in (None, "none"):
            return m
        sel = self.masks[(self.masks.mask_id == mask) & (self.masks.district_id == district)
                         & (self.masks.variable == "cases") & (self.masks.disease_id == disease)]
        m[[self.idx[x] for x in sel.year_month]] = True
        return m

    def thresholds(self, district, disease) -> np.ndarray:
        return np.array([self._thr_map[(district, disease, int(c))] for c in self.cal])

    # ------------------------------------------------------------------ meta
    def anomaly_windows(self, sid):
        out = []
        for r in self.anom[self.anom.scenario_id == sid].itertuples():
            s = self.idx[r.start_month]
            e = min(s + int(r.duration_months), self.N) - 1
            out.append({"anomaly_id": r.anomaly_id, "type": r.anomaly_type, "start_month": r.start_month,
                        "end_month": self.months[e], "magnitude": float(r.magnitude), "unit": r.magnitude_unit,
                        "period_months": as_int(r.period_months)})
        return out

    @lru_cache(maxsize=1)
    def meta(self):
        rule = self.rule
        vul = self.vuln.set_index("district_id")
        districts = []
        for r in self.district_meta.itertuples():
            v = vul.loc[r.district_id]
            lat, lon = DISTRICT_LOCATION[r.district_id]
            districts.append({
                "id": r.district_id, "name": r.district_name, "climate_zone": r.climate_zone,
                "population_illustrative": int(r.population),
                "population_density_per_km2": int(r.population_density_per_km2),
                "urbanisation_pct": num(r.urbanisation_pct),
                "drainage_index": num(v.drainage_index), "water_storage_index": num(v.water_storage_index),
                "flood_exposure_index": num(v.flood_exposure_index),
                "location": {"lat": lat, "lon": lon, "approximate": True},
            })
        return {
            "api_version": API_VERSION, "dataset_version": DATASET_VERSION,
            "generator_version": self.sim_cfg["model_version"], "seed": self.sim_cfg["master_seed"],
            "synthetic": True, "disclaimer": DISCLAIMER,
            "horizon": {"start_month": self.months[0], "end_month": self.months[-1]},
            "training_period": {"start_month": self.months[0], "end_month": self.train_end},
            "peak_search_window": {"start_month": self.months[self.w0], "end_month": self.months[self.w1]},
            "districts": districts,
            "diseases": [{"id": k, **v} for k, v in DISEASE_META.items()],
            "scenarios": [{"id": r.scenario_id, **SCEN_META[r.scenario_id], "description": r.description.replace("degC", "°C"),
                           "anomalies": self.anomaly_windows(r.scenario_id)} for r in self.scen.itertuples()],
            "recovery_rule": {
                "id": rule["recovery_rule_id"], "threshold_factor": rule["threshold_factor"],
                "window_months": self.W, "interruption_rise_factor": rule["interruption_rise_factor"],
                "interruption_rise_months": rule["interruption_rise_months"], "max_missing_frac": rule["max_missing_frac"],
                "threshold_definition": "1.2 × median of cases in the same calendar month, 2015–2021 (baseline, observed)",
                "tsr_definition": "Months from the reference peak t0 to the first month of the first run of 3 consecutive months at or below the threshold",
                "interruption_definition": "After at least one month of decline, cases rise above the threshold and to ≥ 1.2 × the latest low for 2 consecutive months",
            },
            "masks": [{"id": k, **v} for k, v in MASK_META.items()],
            "limitations": LIMITATIONS,
            "replicates": int(self.sim_cfg["replicates_for_spread"]),
        }

    # ------------------------------------------------------------------ recovery
    def _assess(self, cases, thr, t0):
        r = self.rule
        return engine.assess_recovery(cases, thr, t0, self.W, r["interruption_rise_factor"],
                                      r["interruption_rise_months"], r["max_missing_frac"])

    @lru_cache(maxsize=64)
    def series_results(self, district, disease, mask="none"):
        """Run the engine for all 7 scenarios of one district/disease under one case mask.

        Unmasked: thresholds from seasonal_baseline_thresholds.csv. Masked: masked months become NaN in
        baseline and scenario, and the threshold is re-estimated from the masked baseline training months
        (threshold_from_history, factor 1.2) — the same steps as generate_data.py.
        """
        cm = self.case_mask(mask, district, disease)
        ob = self.case_series(district, disease, "baseline").copy()
        ob[cm] = np.nan
        if mask == "none":
            th = self.thresholds(district, disease)
        else:
            th = engine.threshold_from_history(ob, self.cal, self.train_mask, self.rule["threshold_factor"])
        seg = ob[self.w0:self.w1 + 1]
        t0 = self.w0 + int(np.nanargmax(seg)) if np.isfinite(seg).any() else None
        series, results = {}, {}
        for s in self.scenario_ids:
            o = self.case_series(district, disease, s).copy()
            o[cm] = np.nan
            series[s] = o
            if t0 is None:
                results[s] = {"status": engine.STATUS_INSUFFICIENT, "recovery_index": None, "confirmed_index": None,
                              "time_to_sustained_recovery_months": None, "recovery_interruption_count": 0,
                              "months_above_endemic_threshold": 0, "secondary_outbreak_count": 0, "wave_onsets": []}
            else:
                results[s] = self._assess(o, th, t0)
        return {"t0": t0, "thr": th, "series": series, "results": results, "baseline_obs": ob}

    def _rec_block(self, res, t0, run_row):
        status = res["status"]
        lb = (self.N - self.W + 1) - t0 if status == engine.STATUS_CENSORED else None
        unc = {"p10_months": None, "p90_months": None, "share_replicates_recovered": None,
               "replicates": int(self.sim_cfg["replicates_for_spread"])}
        if run_row is not None:
            unc.update(p10_months=num(run_row.recovery_months_p10), p90_months=num(run_row.recovery_months_p90),
                       share_replicates_recovered=num(run_row.share_replicates_recovered))
        ri, ci = res["recovery_index"], res["confirmed_index"]
        return {
            "status": status, "tsr_months": res["time_to_sustained_recovery_months"], "tsr_lower_bound_months": lb,
            "recovery_month": self.months[ri] if ri is not None else None,
            "recovery_confirmed_month": self.months[ci] if ci is not None else None,
            "interruption_count": int(res["recovery_interruption_count"]),
            "months_above_threshold": int(res["months_above_endemic_threshold"]),
            "secondary_outbreak_count": int(res["secondary_outbreak_count"]),
            "uncertainty": unc,
        }

    def _waves(self, series, res):
        out = []
        for wo in res["wave_onsets"]:
            seg = series[wo:wo + 6]
            if np.isfinite(seg).any():
                wp = wo + int(np.nanargmax(seg))
                peak_month, peak_cases = self.months[wp], int(series[wp])
            else:
                peak_month, peak_cases = None, None
            interrupts = res["recovery_index"] is None or wo < res["recovery_index"]
            out.append({"onset_month": self.months[wo], "peak_month": peak_month, "peak_cases": peak_cases,
                        "interrupts_recovery": bool(interrupts)})
        return out

    @staticmethod
    def _delta(b, sc):
        if b["status"] == engine.STATUS_RECOVERED and sc["status"] == engine.STATUS_RECOVERED:
            return sc["tsr_months"] - b["tsr_months"], None, "computed"
        if b["status"] == engine.STATUS_RECOVERED and sc["status"] == engine.STATUS_CENSORED:
            return None, sc["tsr_lower_bound_months"] - b["tsr_months"], "lower_bound"
        return None, None, "undefined"

    def run_row(self, scenario, disease, district, mask):
        return self._runs_idx.get((scenario, disease, district, mask))

    def _blocks(self, district, disease, scenario, mask):
        sr = self.series_results(district, disease, mask)
        t0 = sr["t0"]
        if t0 is None:
            empty = {"status": engine.STATUS_INSUFFICIENT, "tsr_months": None, "tsr_lower_bound_months": None,
                     "recovery_month": None, "recovery_confirmed_month": None, "interruption_count": 0,
                     "months_above_threshold": 0, "secondary_outbreak_count": 0,
                     "uncertainty": {"p10_months": None, "p90_months": None, "share_replicates_recovered": None,
                                     "replicates": int(self.sim_cfg["replicates_for_spread"])}}
            return sr, dict(empty), dict(empty)
        b = self._rec_block(sr["results"]["baseline"], t0, self.run_row("baseline", disease, district, mask))
        sc = self._rec_block(sr["results"][scenario], t0, self.run_row(scenario, disease, district, mask))
        return sr, b, sc

    @lru_cache(maxsize=512)
    def simulation(self, district, disease, scenario, mask="none"):
        sr, b, sc = self._blocks(district, disease, scenario, mask)
        t0 = sr["t0"]
        delta, dlb, dstat = self._delta(b, sc)
        meta = self.meta()

        def climate(s):
            cl = self.climate_frame(district, s)
            return {v: [round(float(x), 1) for x in cl[v]] for v in CLIMATE_VARS}

        def obs(s):
            return [None if np.isnan(x) else int(x) for x in sr["series"][s]]

        return {
            "api_version": API_VERSION, "dataset_version": DATASET_VERSION, "synthetic": True,
            "request": {"district": district, "disease": disease, "scenario": scenario,
                        "recovery_rule": self.rule["recovery_rule_id"], "mask": None if mask == "none" else mask},
            "months": self.months,
            "threshold_cases": [num(x, 2) for x in sr["thr"]],
            "reference": {"t0_month": self.months[t0] if t0 is not None else None,
                          "t0_cases_baseline": int(sr["baseline_obs"][t0]) if t0 is not None else None,
                          "peak_search_window": meta["peak_search_window"]},
            "anomaly_windows": self.anomaly_windows(scenario),
            "series": {"baseline": {"observed_cases": obs("baseline"), **climate("baseline")},
                       "scenario": {"observed_cases": obs(scenario), **climate(scenario)}},
            "recovery": {"baseline": b, "scenario": sc, "delta_tsr_months": delta,
                         "delta_tsr_lower_bound_months": dlb, "delta_status": dstat},
            "waves": {"baseline": self._waves(sr["series"]["baseline"], sr["results"]["baseline"]),
                      "scenario": self._waves(sr["series"][scenario], sr["results"][scenario])},
            "provenance": {"source": "live", "seed": self.sim_cfg["master_seed"],
                           "generator_version": self.sim_cfg["model_version"],
                           "recovery_rule": self.rule["recovery_rule_id"], "replicate": 0,
                           "mask": None if mask == "none" else mask,
                           "generated_from": "data/synthetic/disease_cases.csv + src/recovery_engine.assess_recovery"
                                             " (uncertainty: data/outputs/simulation_runs.csv)"},
        }

    @lru_cache(maxsize=16)
    def recovery_matrix(self, disease, mask="none"):
        cells = []
        for s in self.scenario_ids:
            for d in self.district_ids:
                sr, b, sc = self._blocks(d, disease, s, mask)
                delta, dlb, dstat = self._delta(b, sc)
                cells.append({"scenario": s, "district": d, "status": sc["status"], "tsr_months": sc["tsr_months"],
                              "tsr_lower_bound_months": sc["tsr_lower_bound_months"],
                              "baseline_tsr_months": b["tsr_months"], "delta_tsr_months": delta,
                              "delta_tsr_lower_bound_months": dlb, "delta_status": dstat,
                              "interruption_count": sc["interruption_count"],
                              "months_above_threshold": sc["months_above_threshold"],
                              "secondary_outbreak_count": sc["secondary_outbreak_count"],
                              "t0_month": self.months[sr["t0"]] if sr["t0"] is not None else None})
        return {"api_version": API_VERSION, "dataset_version": DATASET_VERSION, "synthetic": True,
                "request": {"disease": disease, "recovery_rule": self.rule["recovery_rule_id"],
                            "mask": None if mask == "none" else mask},
                "cells": cells}

    @lru_cache(maxsize=1)
    def districts(self):
        meta = self.meta()
        out = []
        for d in meta["districts"]:
            peaks = {}
            for dis in self.disease_ids:
                sr = self.series_results(d["id"], dis, "none")
                t0 = sr["t0"]
                c = float(sr["baseline_obs"][t0])
                peaks[dis] = {"t0_month": self.months[t0], "cases": int(c),
                              "per_100k": round(c / self.population[d["id"]] * 1e5, 3)}
            out.append({**d, "outbreak_peak": peaks})
        return {"api_version": API_VERSION, "dataset_version": DATASET_VERSION, "synthetic": True,
                "districts": out,
                "sources": ["data/synthetic/district_metadata.csv", "data/synthetic/environmental_vulnerability.csv",
                            "data/synthetic/disease_cases.csv (baseline peak at t0)"]}

    # ------------------------------------------------------------------ validation (ground truth)
    @lru_cache(maxsize=4)
    def validation(self, disease):
        tr = self.truth.set_index(["scenario_id", "disease_id", "district_id"])
        rows = []
        for r in self.runs[self.runs.disease_id == disease].itertuples():
            t = tr.loc[(r.scenario_id, disease, r.district_id)]
            et, tt = as_int(r.time_to_sustained_recovery_months), as_int(t.true_time_to_sustained_recovery_months)
            rows.append({"scenario": r.scenario_id, "district": r.district_id, "mask": r.mask_id,
                         "estimated_status": r.recovery_status, "estimated_tsr_months": et,
                         "true_status": t.true_recovery_status, "true_tsr_months": tt,
                         "true_reference_month": t.reference_month, "estimated_reference_month": r.reference_month,
                         "absolute_error_months": abs(et - tt) if et is not None and tt is not None else None,
                         "status_match": bool(r.recovery_status == t.true_recovery_status),
                         "p10_months": num(r.recovery_months_p10), "p90_months": num(r.recovery_months_p90),
                         "share_replicates_recovered": num(r.share_replicates_recovered),
                         "estimated_interruptions": int(r.recovery_interruption_count),
                         "true_interruptions": int(t.true_recovery_interruption_count)})
        df = pd.DataFrame(rows)
        summary = []
        for m, g in df.groupby(df["mask"].fillna("__none__"), sort=False):
            ae = g.absolute_error_months.dropna()
            summary.append({"mask": None if m == "__none__" else m, "n_series": len(g), "n_compared": int(ae.size),
                            "mae_months": round(float(ae.mean()), 2) if ae.size else None,
                            "status_agreement": round(float(g.status_match.mean()), 3),
                            "n_insufficient_data": int((g.estimated_status == engine.STATUS_INSUFFICIENT).sum()),
                            "n_censored_estimate": int((g.estimated_status == engine.STATUS_CENSORED).sum())})
        sg = self.sens[self.sens.disease_id == disease]
        sgrid = [{"window_months": int(w), "threshold_factor": float(f),
                  "n_compared": int(g.absolute_error_months.notna().sum()),
                  "mae_months": num(g.absolute_error_months.mean(), 2),
                  "status_agreement": round(float(g.status_match.mean()), 3),
                  "is_default": int(w) == self.W and float(f) == self.rule["threshold_factor"]}
                 for (w, f), g in sg.groupby(["window_months", "threshold_factor"])]
        return {"api_version": API_VERSION, "dataset_version": DATASET_VERSION, "synthetic": True,
                "request": {"disease": disease}, "rows": rows, "summary_by_mask": summary, "sensitivity": sgrid,
                "notes": ["Truth = recovery on noise-free expected cases with the true endemic threshold (evaluation only).",
                          "Estimate = recovery engine on observed (noisy) cases with thresholds estimated from 2015–2021.",
                          "Absolute error is only defined when both truth and estimate recovered."],
                "sources": ["data/outputs/simulation_runs.csv", "data/ground_truth/recovery_truth.csv",
                            "data/outputs/sensitivity_grid.csv"]}

    # ------------------------------------------------------------------ engine check
    def engine_vs_runs(self):
        """Re-run the engine for all 70 series × 4 masks and compare with outputs/simulation_runs.csv."""
        mism, n = [], 0
        for r in self.runs.itertuples():
            mask = r.mask_id or "none"
            sr = self.series_results(r.district_id, r.disease_id, mask)
            res = sr["results"][r.scenario_id]
            n += 1
            ref = self.months[sr["t0"]] if sr["t0"] is not None else None
            if (r.recovery_status != res["status"]
                    or as_int(r.time_to_sustained_recovery_months) != res["time_to_sustained_recovery_months"]
                    or int(r.recovery_interruption_count) != res["recovery_interruption_count"]
                    or r.reference_month != ref):
                mism.append(r.run_id)
        return {"rows": n, "mismatches": mism}
