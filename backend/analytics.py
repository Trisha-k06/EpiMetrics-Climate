"""Notebook analyses served by the API.

- data_audit       notebook 01 (integrity checks, train/test split, threshold reproduction) + dataset_catalog.csv
- eda              notebooks 01–02 (trajectories, seasonality, correlations, scenario changes)
- forecasts        notebooks 03–05 (seasonal naive, random forest, ARIMA, SARIMA, SARIMAX, lagged SARIMAX)
- episodes         notebooks 06–07 (outbreak episodes, matched ΔTSR, sensitivity, unit tests)

Each function reproduces the notebook code; the notebooks' printed outputs are the reference numbers
(see backend/tests/test_api.py). The ARIMA family is slow, so fits are cached in backend/cache/.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import warnings
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from .data import API_VERSION, CLIMATE_VARS, DATASET_VERSION, Store
from .jsonutil import clean, num

CACHE_DIR = Path(__file__).resolve().parent / "cache"
TEST_START = "2022-01"
LAGS = range(4)
SCENARIO_ORDER = ["baseline", "delayed_monsoon", "heavy_rain_decline", "irregular_rain", "prolonged_wet", "warm_wet", "warmer"]
MODELS = [
    {"id": "seasonal_naive", "label": "Seasonal naive", "notebook": "03", "climate": False,
     "detail": "Same calendar month of 2021"},
    {"id": "random_forest", "label": "Random forest", "notebook": "04", "climate": True,
     "detail": "12 climate lags (0–3 months) + month sin/cos; 200 trees, depth 8, min leaf 3; trained per disease on all districts"},
    {"id": "arima", "label": "ARIMA(2,0,2)", "notebook": "05", "climate": False, "detail": "No seasonal terms, no climate"},
    {"id": "sarima", "label": "SARIMA(1,0,1)(1,0,1,12)", "notebook": "05", "climate": False, "detail": "Annual seasonality, constant trend"},
    {"id": "sarimax", "label": "SARIMAX + climate", "notebook": "05", "climate": True,
     "detail": "SARIMA with rainfall, temperature and humidity (scaled on training data)"},
    {"id": "sarimax_lagged", "label": "Lagged SARIMAX", "notebook": "05", "climate": True,
     "detail": "SARIMA with rainfall lag 1, temperature lag 0, humidity lag 1"},
]
ARIMA_FAMILY = ["arima", "sarima", "sarimax", "sarimax_lagged"]


def _env(**kw):
    return {"api_version": API_VERSION, "dataset_version": DATASET_VERSION, "synthetic": True, **kw}


def _mi(m: str) -> int:
    """'YYYY-MM' → absolute month number (string month arithmetic, no datetime parsing)."""
    return int(m[:4]) * 12 + int(m[5:7])


def _r(v, nd=3):
    return num(v, nd)


class Analytics:
    def __init__(self, store: Store):
        self.s = store
        self._fit_locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()
        self.warm_state = {"started": False, "done": 0, "total": 0, "error": None, "finished_at": None}

    # ================================================================== shared frames
    @lru_cache(maxsize=1)
    def baseline_merged(self) -> pd.DataFrame:
        """Baseline cases joined with baseline climate, sorted (notebooks 01/04)."""
        s = self.s
        c = s.cases[s.cases.scenario_id == "baseline"]
        k = s.clim[s.clim.scenario_id == "baseline"][["year_month", "district_id"] + CLIMATE_VARS]
        d = c.merge(k, on=["year_month", "district_id"], how="left", validate="many_to_one")
        d = d.sort_values(["district_id", "disease_id", "year_month"]).reset_index(drop=True)
        d["calendar_month"] = d.year_month.str[5:7].astype(int)
        return d

    @lru_cache(maxsize=1)
    def nb03_thresholds(self) -> dict:
        """Notebook 03 thresholds: median of baseline training cases × 1.2 (not rounded)."""
        d = self.baseline_merged()
        tr = d[d.year_month < TEST_START]
        g = tr.groupby(["district_id", "disease_id", "calendar_month"])["cases"].median() * 1.2
        return {k: float(v) for k, v in g.items()}

    # ================================================================== notebook 01: data audit
    @lru_cache(maxsize=1)
    def data_audit(self):
        s = self.s
        cases, clim = s.cases, s.clim
        checks = []

        def chk(name, ok, detail, notebook="01"):
            checks.append({"check": name, "pass": bool(ok), "detail": detail, "notebook": notebook})

        mc, mk = int(cases.isna().sum().sum()), int(clim.isna().sum().sum())
        chk("No missing values", mc == 0 and mk == 0, f"disease_cases: {mc}, climate_history: {mk}")
        dc = int(cases.duplicated(["year_month", "district_id", "disease_id", "scenario_id"]).sum())
        dk = int(clim.duplicated(["year_month", "district_id", "scenario_id"]).sum())
        chk("No duplicate records", dc == 0 and dk == 0, f"disease_cases: {dc}, climate_history: {dk}")
        sc = cases.groupby(["disease_id", "district_id", "scenario_id"]).size()
        chk("120 months per series", bool(sc.eq(120).all()),
            f"{len(sc)} series, {int(sc.min())}–{int(sc.max())} months, {s.months[0]} to {s.months[-1]}")
        m = cases.merge(clim, on=["year_month", "district_id", "scenario_id"], how="left",
                        validate="many_to_one", indicator=True)
        both = int((m._merge == "both").sum())
        chk("Cases join climate one-to-one", both == len(cases) and len(m) == len(cases),
            f"{len(cases)} case rows, {len(m)} merged, {both} matched")
        b = self.baseline_merged()
        tr, te = b[b.year_month < TEST_START], b[b.year_month >= TEST_START]
        chk("Chronological train/test split", len(tr) == 840 and len(te) == 360 and tr.year_month.max() < te.year_month.min(),
            f"train {len(tr)} rows ({tr.year_month.min()}–{tr.year_month.max()}), test {len(te)} rows "
            f"({te.year_month.min()}–{te.year_month.max()}), {int(tr.duplicated(['year_month', 'district_id', 'disease_id']).sum())} duplicates")
        med = tr.groupby(["district_id", "disease_id", "calendar_month"])["cases"].median().rename("calc").reset_index()
        tc = s.thr.merge(med, on=["district_id", "disease_id", "calendar_month"], how="left", validate="one_to_one")
        maxdiff = float((tc.training_median_cases - tc.calc).abs().max())
        thr_ok = bool(np.allclose(tc.threshold_cases, tc.calc * tc.threshold_factor, atol=0.051))
        chk("Thresholds reproduce 1.2 × training median", maxdiff == 0.0 and thr_ok,
            f"{len(tc)} rows, max median difference {maxdiff}, factor {sorted(tc.threshold_factor.unique().tolist())}")
        catalog = [{k: (None if pd.isna(v) else (int(v) if isinstance(v, (np.integer,)) else v)) for k, v in r.items()}
                   for r in s.catalog.to_dict("records")]
        return _env(checks=checks, all_pass=all(c["pass"] for c in checks),
                    counts={"disease_case_rows": len(cases), "climate_rows": len(clim), "series": int(len(sc)),
                            "districts": len(s.district_ids), "diseases": len(s.disease_ids),
                            "scenarios": len(s.scenario_ids), "months": s.N},
                    split={"train": {"start": s.months[0], "end": "2021-12", "rows": len(tr)},
                           "test": {"start": TEST_START, "end": s.months[-1], "rows": len(te)}},
                    catalog=catalog, sources=["notebooks/01_data_audit.ipynb", "dataset_catalog.csv"])

    # ================================================================== notebooks 01–02: EDA
    @lru_cache(maxsize=1)
    def correlations(self):
        """Pooled training-period correlations of cases_per_100k with climate lags 0–3 (notebook 02)."""
        s = self.s
        c = s.cases[(s.cases.scenario_id == "baseline") & (s.cases.year_month < TEST_START)]
        k = s.clim[(s.clim.scenario_id == "baseline") & (s.clim.year_month < TEST_START)][["year_month", "district_id"] + CLIMATE_VARS]
        d = c.merge(k, on=["year_month", "district_id"], how="left", validate="many_to_one").sort_values(["disease_id", "district_id", "year_month"])
        rows = []
        for v in CLIMATE_VARS:
            for lag in LAGS:
                col = f"{v}_lag_{lag}"
                d[col] = d.groupby(["disease_id", "district_id"])[v].shift(lag)
                row = {"variable": v, "lag": lag}
                for dz in s.disease_ids:
                    sub = d[d.disease_id == dz]
                    row[dz] = _r(sub[["cases_per_100k", col]].corr().iloc[0, 1], 6)
                rows.append(row)
        return rows

    @lru_cache(maxsize=16)
    def eda(self, district, disease):
        s = self.s
        b = self.baseline_merged()
        tr = b[b.year_month < TEST_START]
        traj = {dz: [_r(x, 3) for x in s.per100k_series(district, dz, "baseline")] for dz in s.disease_ids}
        seas_pooled = tr.groupby(["disease_id", "calendar_month"])["cases_per_100k"].mean()
        seas_dist = tr[tr.district_id == district].groupby(["disease_id", "calendar_month"])["cases_per_100k"].mean()
        seasonality = {dz: {"pooled": [_r(seas_pooled[(dz, m)], 3) for m in range(1, 13)],
                            "district": [_r(seas_dist[(dz, m)], 3) for m in range(1, 13)]} for dz in s.disease_ids}
        ct = s.clim[(s.clim.scenario_id == "baseline") & (s.clim.year_month < TEST_START) & (s.clim.district_id == district)].copy()
        ct["m"] = ct.year_month.str[5:7].astype(int)
        cs = ct.groupby("m")[CLIMATE_VARS].mean()
        climate_seasonality = {v: [_r(cs.loc[m, v], 2) for m in range(1, 13)] for v in CLIMATE_VARS}

        test_months = [m for m in s.months if m >= TEST_START]
        i0 = s.idx[TEST_START]
        sc_cases = {sc: [_r(x, 3) for x in s.per100k_series(district, disease, sc)[i0:]] for sc in s.scenario_ids}
        sc_climate = {v: {sc: [_r(x, 1) for x in s.climate_frame(district, sc)[v].to_numpy(float)[i0:]] for sc in s.scenario_ids}
                      for v in CLIMATE_VARS}
        base = np.array(s.per100k_series(district, disease, "baseline")[i0:])
        case_changes = []
        for sc in s.scenario_ids:
            if sc == "baseline":
                continue
            diff = np.array(s.per100k_series(district, disease, sc)[i0:]) - base
            changed = np.abs(diff) > 1e-6
            case_changes.append({"scenario": sc, "months_changed": int(changed.sum()),
                                 "largest_increase_per_100k": _r(diff.max(), 3), "largest_decrease_per_100k": _r(diff.min(), 3),
                                 "cumulative_difference_per_100k": _r(diff.sum(), 3),
                                 "first_changed_month": test_months[int(np.argmax(changed))] if changed.any() else None})
        climate_changes = []
        for sc in s.scenario_ids:
            if sc == "baseline":
                continue
            for v in CLIMATE_VARS:
                diff = (s.climate_frame(district, sc)[v].to_numpy(float) - s.climate_frame(district, "baseline")[v].to_numpy(float))[i0:]
                climate_changes.append({"scenario": sc, "variable": v, "months_changed": int((np.abs(diff) > 1e-6).sum()),
                                        "max_increase": _r(diff.max(), 2), "max_decrease": _r(diff.min(), 2)})
        corr = self.correlations()
        return _env(request={"district": district, "disease": disease},
                    months=s.months, training_period={"start": s.months[0], "end": "2021-12"},
                    trajectories_per_100k=traj, seasonality_per_100k=seasonality,
                    climate_seasonality=climate_seasonality,
                    correlations=[r for r in corr if r["lag"] == 0], lag_correlations=corr,
                    scenario_period={"months": test_months, "cases_per_100k": sc_cases, "climate": sc_climate},
                    case_changes=case_changes, climate_changes=climate_changes,
                    notes=["Correlations are pooled over all five districts, baseline scenario, training years 2015–2021.",
                           "Correlation is not causation; seasonality drives much of these associations."],
                    sources=["notebooks/01_data_audit.ipynb", "notebooks/02_eda.ipynb"])

    # ================================================================== notebooks 03–05: forecasts
    def _test_frame(self, district, disease):
        b = self.baseline_merged()
        g = b[(b.district_id == district) & (b.disease_id == disease)]
        return g[g.year_month >= TEST_START]

    def _metrics(self, actual, pred, outbreak):
        actual, pred = np.asarray(actual, float), np.asarray(pred, float)
        err = pred - actual
        ob = np.asarray(outbreak, bool)
        return {"mae": _r(np.mean(np.abs(err)), 4), "rmse": _r(np.sqrt(np.mean(err ** 2)), 4), "bias": _r(np.mean(err), 4),
                "mae_outbreak": _r(np.mean(np.abs(err[ob])), 4) if ob.any() else None,
                "mae_other": _r(np.mean(np.abs(err[~ob])), 4) if (~ob).any() else None,
                "n": int(len(actual)), "n_outbreak": int(ob.sum())}

    def _outbreak_flags(self, test):
        thr = self.nb03_thresholds()
        return [c > thr[(d, z, m)] for c, d, z, m in zip(test.cases, test.district_id, test.disease_id, test.calendar_month)]

    @lru_cache(maxsize=4)
    def naive_predictions(self, disease):
        """Notebook 03: prediction = cases_per_100k in the same calendar month of 2021."""
        b = self.baseline_merged()
        b = b[b.disease_id == disease]
        ref = b[b.year_month.str[:4] == "2021"].set_index(["district_id", "calendar_month"])["cases_per_100k"]
        te = b[b.year_month >= TEST_START]
        return te.assign(pred=[float(ref[(d, m)]) for d, m in zip(te.district_id, te.calendar_month)])

    @lru_cache(maxsize=4)
    def rf_model(self, disease):
        """Notebook 04: RandomForest on 12 climate lags + month sin/cos, all districts of one disease."""
        from sklearn.ensemble import RandomForestRegressor

        d = self.baseline_merged().copy()
        for v in CLIMATE_VARS:
            for lag in LAGS:
                d[f"{v}_lag_{lag}"] = d.groupby(["district_id", "disease_id"])[v].shift(lag)
        d["month_sin"] = np.sin(2 * np.pi * d.calendar_month / 12)
        d["month_cos"] = np.cos(2 * np.pi * d.calendar_month / 12)
        feats = [f"{v}_lag_{lag}" for v in CLIMATE_VARS for lag in LAGS] + ["month_sin", "month_cos"]
        d = d.dropna(subset=feats + ["cases_per_100k"])
        d = d[d.disease_id == disease]
        tr, te = d[d.year_month < TEST_START], d[d.year_month >= TEST_START]
        model = RandomForestRegressor(n_estimators=200, max_depth=8, min_samples_leaf=3, random_state=42, n_jobs=-1)
        model.fit(tr[feats], tr.cases_per_100k)
        te = te.assign(pred=model.predict(te[feats]))
        imp = sorted(({"feature": f, "importance": _r(i, 4)} for f, i in zip(feats, model.feature_importances_)),
                     key=lambda x: -x["importance"])
        return {"test": te, "importance": imp, "train_rows": int(len(tr))}

    # ---------------------------------------------------------------- ARIMA family (cached to disk)
    @lru_cache(maxsize=1)
    def _data_fingerprint(self):
        import sklearn
        import statsmodels
        h = hashlib.sha256()
        for p in ("data/synthetic/disease_cases.csv", "data/synthetic/climate_history.csv"):
            h.update((self.s.root / p).read_bytes())
        h.update(f"sm{statsmodels.__version__}|sk{sklearn.__version__}|v2".encode())
        return h.hexdigest()[:16]

    def _cache_path(self, district, disease):
        return CACHE_DIR / f"arima_{district}_{disease}.json"

    def _lock(self, key):
        with self._locks_guard:
            return self._fit_locks.setdefault(key, threading.Lock())

    def arima_family(self, district, disease):
        """Fit ARIMA, SARIMA, SARIMAX and lagged SARIMAX on 2015–2021 and forecast 2022–2024 (notebook 05)."""
        path = self._cache_path(district, disease)
        fp = self._data_fingerprint()
        with self._lock(f"{district}:{disease}"):
            if path.exists():
                try:
                    cached = json.loads(path.read_text())
                    if cached.get("fingerprint") == fp:
                        return cached
                except (OSError, ValueError):
                    pass
            out = self._fit_arima_family(district, disease)
            out["fingerprint"] = fp
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(clean(out)))
            tmp.replace(path)
            return out

    def _fit_arima_family(self, district, disease):
        from statsmodels.tools.sm_exceptions import ConvergenceWarning
        from statsmodels.tsa.arima.model import ARIMA
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        b = self.baseline_merged()
        g = b[(b.district_id == district) & (b.disease_id == disease)].sort_values("year_month")
        idx = pd.to_datetime(g.year_month + "-01")  # statsmodels needs a dated, regular index
        ts = pd.Series(g.cases_per_100k.to_numpy(float), index=idx).asfreq("MS")
        clim = pd.DataFrame(g[CLIMATE_VARS].to_numpy(float), index=idx, columns=CLIMATE_VARS).asfreq("MS")
        train, test = ts.loc[:"2021-12"], ts.loc["2022-01":]
        out = {}
        kw = dict(order=(1, 0, 1), seasonal_order=(1, 0, 1, 12), trend="c", enforce_stationarity=False, enforce_invertibility=False)
        t_start = time.time()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")

            def record(name, fit, fc):
                out[name] = {"predictions": [float(x) for x in np.asarray(fc)],
                             "converged": bool(fit.mle_retvals.get("converged", False)) if fit.mle_retvals else None,
                             "aic": _r(fit.aic, 2)}

            f = ARIMA(train, order=(2, 0, 2), enforce_stationarity=False, enforce_invertibility=False).fit()
            record("arima", f, f.forecast(steps=len(test)))
            f = SARIMAX(train, **kw).fit(disp=False, maxiter=300)
            record("sarima", f, f.forecast(steps=len(test)))
            xt, xe = clim.loc[train.index], clim.loc[test.index]
            mu, sd = xt.mean(), xt.std().replace(0, 1)
            f = SARIMAX(train, exog=(xt - mu) / sd, **kw).fit(disp=False, maxiter=300)
            record("sarimax", f, f.forecast(steps=len(test), exog=(xe - mu) / sd))
            lag = clim.copy()
            lag["rainfall_mm_lag1"] = lag.rainfall_mm.shift(1)
            lag["relative_humidity_pct_lag1"] = lag.relative_humidity_pct.shift(1)
            lf = ["rainfall_mm_lag1", "mean_temperature_c", "relative_humidity_pct_lag1"]
            lt = lag.loc[train.index, lf].dropna()
            le = lag.loc[test.index, lf]
            mu, sd = lt.mean(), lt.std().replace(0, 1)
            f = SARIMAX(train.loc[lt.index], exog=(lt - mu) / sd, **kw).fit(disp=False, maxiter=300)
            record("sarimax_lagged", f, f.forecast(steps=len(test), exog=(le - mu) / sd))
        conv = sum(1 for w in caught if issubclass(w.category, ConvergenceWarning))
        out["_meta"] = {"fit_seconds": round(time.time() - t_start, 2), "convergence_warnings": conv,
                        "warnings_suppressed": len(caught)}
        return out

    def models_ready(self):
        fp = self._data_fingerprint()
        n = 0
        for d in self.s.district_ids:
            for z in self.s.disease_ids:
                p = self._cache_path(d, z)
                if p.exists():
                    try:
                        n += json.loads(p.read_text()).get("fingerprint") == fp
                    except (OSError, ValueError):
                        pass
        return n, len(self.s.district_ids) * len(self.s.disease_ids)

    def warm(self):
        """Background warm-up: fit every series once so the forecast screen answers instantly."""
        pairs = [(d, z) for z in self.s.disease_ids for d in self.s.district_ids]
        self.warm_state.update(started=True, total=len(pairs), done=0)
        try:
            for z in self.s.disease_ids:
                self.rf_model(z)
            for d, z in pairs:
                self.arima_family(d, z)
                self.warm_state["done"] += 1
            self.eda(self.s.district_ids[0], self.s.disease_ids[0])
            self.episodes("dengue")
        except Exception as e:  # pragma: no cover - reported via /health
            self.warm_state["error"] = f"{type(e).__name__}: {e}"
        self.warm_state["finished_at"] = time.time()

    # ---------------------------------------------------------------- forecast responses
    @lru_cache(maxsize=16)
    def forecasts(self, district, disease):
        test = self._test_frame(district, disease)
        actual = test.cases_per_100k.to_numpy(float)
        outbreak = self._outbreak_flags(test)
        naive = self.naive_predictions(disease)
        naive = naive[naive.district_id == district].pred.to_numpy(float)
        rf = self.rf_model(disease)
        rft = rf["test"]
        rfp = rft[rft.district_id == district].pred.to_numpy(float)
        fam = self.arima_family(district, disease)
        preds = {"seasonal_naive": naive, "random_forest": rfp, **{k: np.array(fam[k]["predictions"]) for k in ARIMA_FAMILY}}
        models = []
        for m in MODELS:
            p = preds[m["id"]]
            models.append({**m, **self._metrics(actual, p, outbreak),
                           "predictions": [_r(x, 4) for x in p],
                           "converged": fam[m["id"]]["converged"] if m["id"] in fam else None,
                           "feature_importance": rf["importance"] if m["id"] == "random_forest" else None})
        best = min(models, key=lambda x: x["mae"])
        return _env(request={"district": district, "disease": disease},
                    months=test.year_month.tolist(), actual_per_100k=[_r(x, 3) for x in actual],
                    outbreak_months=[bool(x) for x in outbreak],
                    train_period={"start": self.s.months[0], "end": "2021-12"}, test_period={"start": TEST_START, "end": self.s.months[-1]},
                    models=models, best_model={"id": best["id"], "label": best["label"], "mae": best["mae"]},
                    fit_info=fam.get("_meta"),
                    notes=["These forecasts are benchmarks on synthetic data. The project outcome is recovery time (TSR), not case counts.",
                           "Outbreak months: test months with cases above 1.2 × the 2015–2021 median for that calendar month.",
                           "Bias = mean(prediction − actual); negative means the model under-predicts."],
                    sources=["notebooks/03_forecast_benchmarks.ipynb", "notebooks/04_climate_aware_model.ipynb",
                             "notebooks/05_arima_sarima_sarimax.ipynb"])

    @lru_cache(maxsize=4)
    def forecast_summary(self, disease):
        rows, pooled_err = [], {m["id"]: [] for m in MODELS}
        pooled_actual, pooled_ob = [], []
        for d in self.s.district_ids:
            f = self.forecasts(d, disease)
            row = {"district": d}
            for m in f["models"]:
                row[m["id"]] = m["mae"]
                pooled_err[m["id"]].append(np.array(m["predictions"], float))
            rows.append(row)
            pooled_actual.append(np.array(f["actual_per_100k"], float))
            pooled_ob.append(np.array(f["outbreak_months"], bool))
        a, ob = np.concatenate(pooled_actual), np.concatenate(pooled_ob)
        # pooled metrics use unrounded predictions for the two models trained/defined across districts
        naive = self.naive_predictions(disease)
        rft = self.rf_model(disease)["test"]
        exact = {"seasonal_naive": naive.sort_values(["district_id", "year_month"]),
                 "random_forest": rft.sort_values(["district_id", "year_month"])}
        pooled = []
        for m in MODELS:
            if m["id"] in exact:
                e = exact[m["id"]]
                e = e.set_index("district_id").loc[self.s.district_ids].reset_index()
                met = self._metrics(e.cases_per_100k.to_numpy(float), e.pred.to_numpy(float), ob)
            else:
                met = self._metrics(a, np.concatenate(pooled_err[m["id"]]), ob)
            pooled.append({"id": m["id"], "label": m["label"], **met})
        return _env(request={"disease": disease}, models=[{k: m[k] for k in ("id", "label", "climate")} for m in MODELS],
                    districts=rows, pooled=pooled,
                    notes=["MAE in cases per 100,000 over the 36 test months (2022–2024), baseline scenario."])

    # ================================================================== notebooks 06–07: episodes
    @staticmethod
    def analyse_recovery(months, above, sustained_months=3):
        """Port of notebook 07 analyse_recovery: episodes from onset (first month above threshold) to the last
        month of the first run of `sustained_months` months at or below it. Returns plain dicts."""
        results, i, ep, n = [], 0, 0, len(above)
        while i < n:
            if not above[i]:
                i += 1
                continue
            ep += 1
            onset, interruptions, streak, rec = i, 0, 0, None
            j = i + 1
            while j < n:
                if above[j]:
                    if streak > 0:
                        interruptions += 1
                    streak = 0
                else:
                    streak += 1
                    if streak >= sustained_months:
                        rec = j
                        break
                j += 1
            if rec is not None:
                results.append({"episode_number": ep, "outbreak_onset": months[onset], "recovery_date": months[rec],
                                "recovery_months": _mi(months[rec]) - _mi(months[onset]),
                                "recovery_interruptions": interruptions, "recovery_status": "recovered"})
                i = rec + 1
            else:
                results.append({"episode_number": ep, "outbreak_onset": months[onset], "recovery_date": None,
                                "recovery_months": None, "recovery_interruptions": interruptions,
                                "recovery_status": "unresolved"})
                i = n
        return results

    @lru_cache(maxsize=4)
    def episode_table(self, sustained_months=3, scenarios=None) -> pd.DataFrame:
        s, thr = self.s, self.nb03_thresholds()
        rows = []
        scen = scenarios or tuple(sorted(s.scenario_ids))
        for d in sorted(s.district_ids):
            for z in sorted(s.disease_ids):
                t = np.array([thr[(d, z, int(c))] for c in s.cal])
                for sc in scen:
                    above = s.case_series(d, z, sc) > t
                    for e in self.analyse_recovery(s.months, above, sustained_months):
                        rows.append({"district_id": d, "disease_id": z, "scenario_id": sc, **e})
        df = pd.DataFrame(rows)
        df["recovery_months"] = df.recovery_months.astype(float)
        return df

    @staticmethod
    def unit_tests():
        """Notebook 06's four recovery-engine tests, run live against analyse_recovery."""
        months = [f"2022-{m:02d}" for m in range(1, 13)]
        A = Analytics.analyse_recovery
        T, F = True, False
        cases = [
            ("Normal sustained recovery", [T, T, F, F, F],
             lambda r: len(r) == 1 and r[0]["recovery_status"] == "recovered" and r[0]["recovery_months"] == 4 and r[0]["recovery_interruptions"] == 0),
            ("Interrupted recovery", [T, T, F, F, T, F, F, F],
             lambda r: len(r) == 1 and r[0]["recovery_status"] == "recovered" and r[0]["recovery_months"] == 7 and r[0]["recovery_interruptions"] == 1),
            ("Unresolved outbreak", [T, T, F, T, F],
             lambda r: len(r) == 1 and r[0]["recovery_status"] == "unresolved" and r[0]["recovery_months"] is None and r[0]["recovery_interruptions"] == 1),
            ("No outbreak", [F, F, F, F], lambda r: len(r) == 0),
        ]
        out = []
        for name, flags, ok in cases:
            try:
                r = A(months[:len(flags)], flags)
                passed = bool(ok(r))
                detail = "; ".join(
                    f"{e['recovery_status']}, "
                    + (f"{e['recovery_months']} months" if e["recovery_months"] is not None else "no recovery time")
                    + f", {e['recovery_interruptions']} interruption{'' if e['recovery_interruptions'] == 1 else 's'}"
                    for e in r) or "no episodes"
            except Exception as e:  # pragma: no cover
                passed, detail = False, f"{type(e).__name__}: {e}"
            out.append({"name": name, "input": ["above" if f else "below" for f in flags], "pass": passed, "detail": detail})
        return out

    @lru_cache(maxsize=4)
    def episodes(self, disease):
        s = self.s
        ep = self.episode_table(3)
        rec = ep[ep.recovery_status == "recovered"]
        totals = {"episodes": int(len(ep)), "recovered": int(len(rec)),
                  "unresolved": int((ep.recovery_status == "unresolved").sum()),
                  "interruptions": int(ep.recovery_interruptions.sum())}
        # per scenario × disease (notebook 07 steps 8–9)
        by_scen = []
        for sc in SCENARIO_ORDER:
            for z in s.disease_ids:
                g = ep[(ep.scenario_id == sc) & (ep.disease_id == z)]
                gr = g[g.recovery_status == "recovered"]
                by_scen.append({"scenario": sc, "disease": z, "episodes": int(len(g)), "recovered": int(len(gr)),
                                "unresolved": int((g.recovery_status == "unresolved").sum()),
                                "mean_recovery_months": _r(gr.recovery_months.mean(), 3),
                                "total_interruptions": int(g.recovery_interruptions.sum()),
                                "interrupted_episodes": int((g.recovery_interruptions > 0).sum()),
                                "interrupted_pct": _r(100 * (g.recovery_interruptions > 0).mean(), 2),
                                "unresolved_pct": _r(100 * (g.recovery_status == "unresolved").mean(), 2)})
        # exact-onset matched ΔTSR (notebook 07 step 10); exclude episodes active in the first month
        e2 = ep[ep.outbreak_onset > s.months[0]]
        base = e2[e2.scenario_id == "baseline"][["district_id", "disease_id", "outbreak_onset", "recovery_months",
                                                 "recovery_status", "recovery_interruptions"]].rename(
            columns={"recovery_months": "baseline_tsr", "recovery_status": "baseline_status",
                     "recovery_interruptions": "baseline_interruptions"})
        clim_eps = e2[e2.scenario_id != "baseline"]
        mt = clim_eps.merge(base, on=["district_id", "disease_id", "outbreak_onset"], how="inner", validate="many_to_one")
        both = (mt.recovery_status == "recovered") & (mt.baseline_status == "recovered")
        mt["delta_tsr_months"] = np.where(both, mt.recovery_months.astype(float) - mt.baseline_tsr.astype(float), np.nan)
        mt["delta_interruptions"] = mt.recovery_interruptions - mt.baseline_interruptions
        matched_summary = []
        for sc in SCENARIO_ORDER[1:]:
            for z in s.disease_ids:
                g = mt[(mt.scenario_id == sc) & (mt.disease_id == z)]
                dv = g.delta_tsr_months.dropna()
                matched_summary.append({"scenario": sc, "disease": z, "matched_episodes": int(len(g)),
                                        "comparable_recovered": int(dv.size), "mean_delta_tsr": _r(dv.mean(), 3),
                                        "median_delta_tsr": _r(dv.median(), 2),
                                        "mean_delta_interruptions": _r(g.delta_interruptions.mean(), 3)})
        valid = int(mt.delta_tsr_months.notna().sum())
        matching = {"climate_episodes": int(len(clim_eps)), "matched_episodes": int(len(mt)),
                    "matching_coverage_pct": _r(100 * len(mt) / len(clim_eps), 2) if len(clim_eps) else None,
                    "valid_delta_tsr_pairs": valid, "mean_delta_tsr_months": _r(mt.delta_tsr_months.mean(), 4)}
        # district table for the requested disease (notebook 07 step 5)
        dz = ep[ep.disease_id == disease]
        district_rows = []
        for d in s.district_ids:
            bl = None
            for sc in SCENARIO_ORDER:
                g = dz[(dz.district_id == d) & (dz.scenario_id == sc)]
                gr = g[g.recovery_status == "recovered"]
                row = {"district": d, "scenario": sc, "episodes": int(len(g)), "recovered": int(len(gr)),
                       "unresolved": int((g.recovery_status == "unresolved").sum()),
                       "mean_recovery_months": _r(g.recovery_months.astype(float).mean(), 2),
                       "median_recovery_months": _r(g.recovery_months.astype(float).median(), 2),
                       "total_interruptions": int(g.recovery_interruptions.sum())}
                if sc == "baseline":
                    bl = row
                    row.update(mean_recovery_difference_months=None, interruption_difference=None, unresolved_difference=None)
                else:
                    row.update(mean_recovery_difference_months=_r(row["mean_recovery_months"] - bl["mean_recovery_months"], 2)
                               if row["mean_recovery_months"] is not None and bl["mean_recovery_months"] is not None else None,
                               interruption_difference=row["total_interruptions"] - bl["total_interruptions"],
                               unresolved_difference=row["unresolved"] - bl["unresolved"])
                district_rows.append(row)
        timeline = [{"district": r.district_id, "scenario": r.scenario_id, "episode_number": int(r.episode_number),
                     "onset": r.outbreak_onset, "recovery": r.recovery_date,
                     "recovery_months": None if r.recovery_months is None or pd.isna(r.recovery_months) else int(r.recovery_months),
                     "interruptions": int(r.recovery_interruptions), "status": r.recovery_status}
                    for r in dz.itertuples()]
        # sensitivity on the baseline (notebook 06 step 4)
        sens = []
        for sm in (2, 3, 4):
            e = self.episode_table(sm, ("baseline",))
            for z in s.disease_ids:
                g = e[e.disease_id == z]
                rm = g.recovery_months.astype(float)
                sens.append({"disease": z, "sustained_months": sm, "total_episodes": int(len(g)),
                             "recovered_episodes": int((g.recovery_status == "recovered").sum()),
                             "unresolved_episodes": int((g.recovery_status == "unresolved").sum()),
                             "mean_recovery_months": _r(rm.mean(), 2), "median_recovery_months": _r(rm.median(), 2),
                             "total_interruptions": int(g.recovery_interruptions.sum()), "is_default": sm == 3})
        return _env(request={"disease": disease}, months=s.months, totals=totals, by_scenario=by_scen,
                    matched=matching, matched_summary=matched_summary, districts=district_rows,
                    timeline=timeline, sensitivity=sens, unit_tests=self.unit_tests(),
                    definitions={"threshold": "1.2 × median of baseline cases in the same calendar month, 2015–2021 (notebook 03, not rounded)",
                                 "episode": "Starts in the first month above the threshold; recovers when cases stay at or below it for 3 consecutive months",
                                 "recovery_months": "Months from onset to the last month of the qualifying 3-month window",
                                 "interruption": "A month above the threshold after at least one month below it, before recovery",
                                 "matched_delta": "Scenario episode minus baseline episode with the same onset month; both must recover"},
                    notes=["Episode analysis covers the whole 2015–2024 series, so it differs from the single-peak TSR in the simulator.",
                           "Episodes active in January 2015 are excluded from matching (possible left censoring)."],
                    sources=["notebooks/06_recovery_engine.ipynb", "notebooks/07_climate_recovery_analysis.ipynb"])
