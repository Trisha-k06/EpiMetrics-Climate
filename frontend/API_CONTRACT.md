# EpiMetrics-Climate — Frontend ↔ Backend API contract (v1.0)

The frontend only **displays** what these endpoints return. It never computes
recovery, thresholds, ΔTSR, waves or validation metrics. If a value is missing,
the UI shows "not provided by the API" rather than deriving it.

- Base URL: `/api/v1` (set in `js/config.js`)
- Format: JSON, UTF-8. Months are `"YYYY-MM"` strings. Missing values are `null`.
- Every response carries `api_version`, `dataset_version` and `synthetic: true`.
  The UI refuses to render a response whose `synthetic` flag is not `true`.
- Served by the FastAPI backend (`python -m backend`, code in `backend/`) on the same origin as the website.
  Results come from the CSVs in `data/` and `src/recovery_engine.py`; analyses reproduce notebooks 01–07.
- Every endpoint except `GET /health` and `POST /auth/login` needs `Authorization: Bearer <JWT>`.

| Endpoint | Roles | Used by |
|---|---|---|
| `GET /meta` | all | every screen |
| `GET /districts` | all | Overview and Recovery maps |
| `GET /simulations?district=&disease=&scenario=[&mask=]` | all | Simulator, Recovery, Report |
| `GET /recovery-matrix?disease=[&mask=]` | all | Overview, Recovery |
| `GET /validation?disease=` | analyst, admin | Validation |
| `GET /analytics/data-audit` | all | Data explorer |
| `GET /analytics/eda?district=&disease=` | all | Data explorer |
| `GET /analytics/forecasts?district=&disease=` | all | Forecast models, assistant |
| `GET /analytics/forecast-summary?disease=` | all | Forecast models, project PDF |
| `GET /analytics/episodes?disease=` | all | Outbreak episodes, assistant, project PDF |
| `POST /exports` | analyst, admin | every export, before it starts |
| `GET /integrity` | all (summary) · admin (full) | Users & security |
| `POST /integrity/verify`, `POST /integrity/validate`, `GET /audit-log` | admin | Users & security |

IDs must match `^[a-z0-9_]+$` (else 400) and exist (else 404): districts `chn cbe mdu try tnj`; diseases
`dengue malaria`; scenarios `baseline delayed_monsoon heavy_rain_decline prolonged_wet irregular_rain warmer warm_wet`;
masks `none mar_10pct cases_gap_3m cases_outage_9m` (`none` is the default and need not be sent).

---

## `GET /meta`

```jsonc
{
  "api_version": "1.0", "dataset_version": "0.1.1", "generator_version": "0.1.0",
  "seed": 42, "synthetic": true,
  "disclaimer": "Synthetic data — research demonstration only. …",
  "horizon": { "start_month": "2015-01", "end_month": "2024-12" },
  "training_period": { "start_month": "2015-01", "end_month": "2021-12" },
  "peak_search_window": { "start_month": "2022-08", "end_month": "2023-02" },
  "districts": [{ "id": "chn", "name": "Chennai", "climate_zone": "coastal", "population_illustrative": 7000000,
                 "population_density_per_km2": 16000, "urbanisation_pct": 100, "drainage_index": 0.45,
                 "water_storage_index": 0.75, "flood_exposure_index": 0.8,
                 "location": { "lat": 13.08, "lon": 80.27, "approximate": true } }],   // location: map placement only
  "diseases":  [{ "id": "dengue", "name": "Dengue", "vector": "Aedes mosquito", "drivers": ["…"] }],
  "scenarios": [{
    "id": "delayed_monsoon", "label": "Delayed monsoon", "short": "…", "description": "…",
    "category": "baseline | rainfall | temperature | compound", "featured": true,
    "anomalies": [{ "anomaly_id": "A01", "type": "monsoon_shift", "start_month": "2022-10",
                    "end_month": "2023-03", "magnitude": 2.0, "unit": "months", "period_months": null }]
  }],
  "recovery_rule": { "id": "r3m_f1.2", "threshold_factor": 1.2, "window_months": 3,
                     "interruption_rise_factor": 1.2, "interruption_rise_months": 2, "max_missing_frac": 0.3,
                     "threshold_definition": "…", "tsr_definition": "…", "interruption_definition": "…" },
  "masks": [{ "id": "none", "label": "Complete data", "description": "…" }],   // also mar_10pct, cases_gap_3m, cases_outage_9m
  "limitations": ["…"],
  "replicates": 50
}
```

## `GET /simulations?district=chn&disease=dengue&scenario=delayed_monsoon`

One call returns the baseline AND the requested scenario, so the UI can overlay them.
All arrays have the same length as `months` (120). With a `mask`, the masked case months are `null` in both
series, the threshold is re-estimated from the masked baseline training months (`threshold_from_history`,
factor 1.2), and the p10/p90 spread comes from the `simulation_runs.csv` rows for that mask.

```jsonc
{
  "api_version": "1.0", "dataset_version": "0.1.1", "synthetic": true,
  "request": { "district": "chn", "disease": "dengue", "scenario": "delayed_monsoon", "recovery_rule": "r3m_f1.2", "mask": null },
  "months": ["2015-01", "…", "2024-12"],
  "threshold_cases": [/* 120 numbers: endemic threshold for each month */],
  "reference": { "t0_month": "2022-11", "t0_cases_baseline": 1081,
                 "peak_search_window": { "start_month": "2022-08", "end_month": "2023-02" } },
  "anomaly_windows": [/* same objects as meta.scenarios[].anomalies */],
  "series": {
    "baseline": { "observed_cases": [], "rainfall_mm": [], "mean_temperature_c": [], "relative_humidity_pct": [] },
    "scenario": { "observed_cases": [], "rainfall_mm": [], "mean_temperature_c": [], "relative_humidity_pct": [] }
  },
  "recovery": {
    "baseline": RecoveryBlock,
    "scenario": RecoveryBlock,
    "delta_tsr_months": 5,                 // null unless delta_status = "computed"
    "delta_tsr_lower_bound_months": null,  // set when delta_status = "lower_bound"
    "delta_status": "computed | lower_bound | undefined"
  },
  "waves": {
    "baseline": [WaveEvent],
    "scenario": [{ "onset_month": "2023-03", "peak_month": "2023-04", "peak_cases": 323, "interrupts_recovery": true }]
  },
  "provenance": { "source": "live", "seed": 42, "generator_version": "0.1.0",
                  "recovery_rule": "r3m_f1.2", "replicate": 0, "mask": null, "generated_from": "…" }
}
```

`RecoveryBlock`

| Field | Type | Meaning |
|---|---|---|
| `status` | `recovered` \| `not_recovered_within_horizon` \| `insufficient_data` | Recovery status |
| `tsr_months` | int \| null | Time to Sustained Recovery from t0; null unless recovered |
| `tsr_lower_bound_months` | int \| null | For censored series: TSR is at least this many months |
| `recovery_month` | month \| null | First month of the qualifying 3-month window |
| `recovery_confirmed_month` | month \| null | Last month of that window (recovery confirmed) |
| `interruption_count` | int | Secondary waves that began before sustained recovery |
| `months_above_threshold` | int | Months from t0 to recovery (or horizon) above the threshold |
| `secondary_outbreak_count` | int | All detected waves after t0, including after recovery |
| `uncertainty.p10_months` / `p90_months` | number \| null | Spread across noise replicates (null if < 50% recovered) |
| `uncertainty.share_replicates_recovered` | 0–1 | Share of replicates that recovered |
| `uncertainty.replicates` | int | Number of replicates (50) |

`delta_status` rules (backend decides, UI only displays):
- `computed`: both recovered → `delta_tsr_months = scenario.tsr − baseline.tsr`
- `lower_bound`: scenario censored, baseline recovered → ΔTSR ≥ `delta_tsr_lower_bound_months`
- `undefined`: anything else (e.g. insufficient data)

## `GET /recovery-matrix?disease=dengue`

```jsonc
{ "api_version": "1.0", "dataset_version": "0.1.1", "synthetic": true,
  "request": { "disease": "dengue", "recovery_rule": "r3m_f1.2", "mask": null },
  "cells": [{ "scenario": "delayed_monsoon", "district": "chn", "status": "recovered",
              "tsr_months": 12, "tsr_lower_bound_months": null, "baseline_tsr_months": 7,
              "delta_tsr_months": 5, "delta_tsr_lower_bound_months": null, "delta_status": "computed",
              "interruption_count": 1, "months_above_threshold": 8, "secondary_outbreak_count": 1,
              "t0_month": "2022-11" }] }   // 35 cells: 7 scenarios × 5 districts
```

## `GET /validation?disease=dengue`

Ground truth appears ONLY here (evaluation of the estimator, never a model input).

```jsonc
{ "api_version": "1.0", "dataset_version": "0.1.1", "synthetic": true, "request": { "disease": "dengue" },
  "rows": [{ "scenario": "baseline", "district": "chn", "mask": null,
             "estimated_status": "recovered", "estimated_tsr_months": 7,
             "true_status": "recovered", "true_tsr_months": 7,
             "estimated_reference_month": "2022-11", "true_reference_month": "2022-11",
             "absolute_error_months": 0, "status_match": true,
             "p10_months": 6.0, "p90_months": 8.0, "share_replicates_recovered": 1.0,
             "estimated_interruptions": 0, "true_interruptions": 0 }],   // 35 series × 4 masks
  "summary_by_mask": [{ "mask": null, "n_series": 35, "n_compared": 34, "mae_months": 1.5,
                        "status_agreement": 0.971, "n_insufficient_data": 0, "n_censored_estimate": 0 }],
  "sensitivity": [{ "window_months": 3, "threshold_factor": 1.2, "n_compared": 35,
                    "mae_months": 1.5, "status_agreement": 0.971, "is_default": true }],
  "notes": ["…"] }
```

## `GET /districts`

`{ "synthetic": true, "districts": [ {…same fields as meta.districts…, "outbreak_peak": { "dengue": { "t0_month": "2022-11", "cases": 587, "per_100k": 16.771 }, "malaria": {…} } } ] }`

## Analytics (notebooks 01–07)

- `GET /analytics/data-audit` → `{ checks: [{check, pass, detail, notebook}], all_pass, counts, split, catalog: [dataset_catalog.csv rows] }`
- `GET /analytics/eda` → `{ months, trajectories_per_100k: {dengue, malaria}, seasonality_per_100k: {disease: {pooled[12], district[12]}},
  climate_seasonality: {variable: [12]}, correlations, lag_correlations: [{variable, lag, dengue, malaria}],
  scenario_period: { months, cases_per_100k: {scenario: []}, climate: {variable: {scenario: []}} }, case_changes, climate_changes }`
- `GET /analytics/forecasts` → `{ months[36], actual_per_100k[36], outbreak_months[36], models: [{ id, label, notebook, climate, detail, mae, rmse,
  bias, mae_outbreak, mae_other, n, n_outbreak, predictions[36], converged, feature_importance }], best_model, fit_info }`
  Models: `seasonal_naive`, `random_forest`, `arima`, `sarima`, `sarimax`, `sarimax_lagged`.
- `GET /analytics/forecast-summary` → `{ models, districts: [{ district, <model id>: MAE }], pooled: [{ id, mae, rmse, bias, … }] }`
- `GET /analytics/episodes` → `{ totals, by_scenario, matched, matched_summary, districts, timeline, sensitivity, unit_tests, definitions }`

## `POST /exports`

Request `{ "kind": "report_pdf | project_pdf | json | csv | print", "district"?, "disease"?, "scenario"?, "mask"? }`.
Response `{ "synthetic": true, "ok": true, "export_id": "…", "kind": "…", "logged_at": "…" }`; viewers get 403.
The browser builds the file only after this succeeds.

## `POST /auth/login` (security)

Request `{ "username": "analyst", "password": "…" }` (HTTPS when deployed).
Response `200`:
```jsonc
{ "token": "<HS256 JWT, 15-minute sliding expiry>", "expires_in": 900,
  "user": { "username": "analyst", "display_name": "Demo analyst", "role": "viewer | analyst | admin" } }
```
Wrong credentials → `401 { "error": { "code": "bad_credentials", "message": "Username or password is incorrect." } }`.
Five failures for one username (or 20 from one IP) → `429 too_many_attempts` for 30 s, with `Retry-After`.
Passwords are stored only as salted PBKDF2-SHA256 hashes in `backend/users.json` and never sent to the browser.
When a token is older than 60 s, any response carries a fresh one in the `X-Session-Token` header.
`POST /auth/logout` revokes the session; `GET /auth/me` returns the user and keeps an active session alive.
An expired, revoked or invalid token → `401`, and the UI returns to the sign-in screen.

Role rules the backend must enforce (the UI hides what a role can't use, but the server is the real gate):

| Endpoint | viewer | analyst | admin |
|---|---|---|---|
| `/meta`, `/districts`, `/simulations`, `/recovery-matrix`, `/analytics/*` | yes | yes | yes |
| `/validation`, `POST /exports` | no | yes | yes |
| `/integrity` | summary | summary | full |
| `POST /integrity/verify`, `POST /integrity/validate`, `/audit-log` | no | no | yes |

## `GET /integrity` (security)

SHA-256 manifest built by `python -m backend.manage manifest` (stored in `backend/integrity_manifest.json`):
```jsonc
{ "synthetic": true, "algorithm": "SHA-256", "dataset_version": "0.1.1", "generated_at": "…", "scope": "full",
  "files": [{ "kind": "frontend | backend | science | dataset", "path": "frontend/js/app.js", "url": "js/app.js", "bytes": 4123, "sha256": "…" }] }
```
Non-admins get `{ "scope": "summary", "counts": {kind: n}, "total_files", "files": [] }`.
`POST /integrity/verify` recomputes every fingerprint on the server → `{ results: [{path, kind, match, missing}], n_files, n_match, all_match, unlisted_files }`.
`POST /integrity/validate` runs `src/verify_semantics.py` (34 checks), the engine-vs-`simulation_runs.csv` check
and notebook 06's unit tests → `{ checks: [{group, name, pass, detail}], semantic: {total, passed}, total, passed, all_pass }`.
Admins can also re-fetch every `files[].url` in the browser and compare fingerprints.

## Errors

Non-2xx responses return `{ "error": { "code": "unknown_district", "message": "…" } }`:
400 `bad_request` (id format, missing parameter), 401 `unauthorized`, 403 `forbidden`, 404 `unknown_<id>` or
`unknown_endpoint`, 429 `too_many_attempts`. The UI shows the message in an error panel.

## Security headers

Every response: `Content-Security-Policy` (scripts from this site only; Google Fonts CSS allowed),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`;
`Cache-Control: no-store` on `/api`.

## Not in this version

- `POST /simulate` with custom anomaly sliders. The seven scenarios are the published dataset.
