# EpiMetrics-Climate — Frontend ↔ Backend API contract (v1.0)

The frontend only **displays** what these endpoints return. It never computes
recovery, thresholds, ΔTSR, waves or validation metrics. If a value is missing,
the UI shows "not provided by the API" rather than deriving it.

- Base URL: `/api/v1` (set in `js/config.js`)
- Format: JSON, UTF-8. Months are `"YYYY-MM"` strings. Missing values are `null`.
- Every response carries `api_version`, `dataset_version` and `synthetic: true`.
  The UI refuses to render a response whose `synthetic` flag is not `true`.
- Mock mode serves the same shapes from `mock/api/v1/` (built by
  `tools/build_mock_api.py` from dataset v0.1.1 using `src/recovery_engine.py`).

| Endpoint | Mock file | Used by |
|---|---|---|
| `GET /meta` | `meta.json` | every screen |
| `GET /simulations?district=&disease=&scenario=` | `simulations/{district}__{disease}__{scenario}.json` | Simulator, Recovery, Report |
| `GET /recovery-matrix?disease=` | `recovery-matrix/{disease}.json` | Recovery |
| `GET /validation?disease=` | `validation/{disease}.json` | Validation |

IDs: districts `chn cbe mdu try tnj`; diseases `dengue malaria`; scenarios
`baseline delayed_monsoon heavy_rain_decline prolonged_wet irregular_rain warmer warm_wet`.

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
  "masks": [{ "id": null, "label": "Complete data", "description": "…" }],
  "limitations": ["…"],
  "replicates": 50
}
```

## `GET /simulations?district=chn&disease=dengue&scenario=delayed_monsoon`

One call returns the baseline AND the requested scenario, so the UI can overlay them.
All arrays have the same length as `months` (120).

```jsonc
{
  "api_version": "1.0", "dataset_version": "0.1.1", "synthetic": true,
  "request": { "district": "chn", "disease": "dengue", "scenario": "delayed_monsoon", "recovery_rule": "r3m_f1.2" },
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
  "provenance": { "source": "mock | live", "seed": 42, "generator_version": "0.1.0",
                  "recovery_rule": "r3m_f1.2", "replicate": 0, "generated_from": "…" }
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

## `POST /auth/login` (security)

Request `{ "username": "analyst", "password": "…" }` over HTTPS only.
Response `200`:
```jsonc
{ "token": "<signed JWT, e.g. 15-minute expiry>", "expires_in": 900,
  "user": { "username": "analyst", "display_name": "Demo analyst", "role": "viewer | analyst | admin" } }
```
Wrong credentials → `401 { "error": { "code": "bad_credentials", "message": "Username or password is incorrect." } }`.
The server must store passwords only as slow salted hashes (bcrypt, argon2 or PBKDF2), rate-limit attempts,
and never send hashes to the browser. Every other endpoint then requires `Authorization: Bearer <token>`;
an expired or invalid token → `401`, and the UI returns to the sign-in screen.

Role rules the backend must enforce (the UI hides what a role can't use, but the server is the real gate):

| Endpoint | viewer | analyst | admin |
|---|---|---|---|
| `/meta`, `/simulations`, `/recovery-matrix` | yes | yes | yes |
| `/validation` | no | yes | yes |
| `/integrity` | summary | summary | yes |

Mock mode instead reads `mock/api/v1/auth/demo-users.json` (salted PBKDF2-SHA256 hashes) and checks the
password in the browser. That is for the demo only.

## `GET /integrity` (security)

SHA-256 checksum manifest (mock file: `integrity.json`, built by `tools/build_security_files.py`):
```jsonc
{ "synthetic": true, "algorithm": "SHA-256", "dataset_version": "0.1.1", "generated_at": "2026-10-28T04:53:28Z",
  "files": [{ "kind": "api | frontend", "url": "mock/api/v1/meta.json", "label": "…", "bytes": 4123, "sha256": "…" }],
  "dataset_files": [{ "kind": "dataset", "path": "data/synthetic/disease_cases.csv", "bytes": 512000, "sha256": "…" }] }
```
Admins can re-fetch every `files[].url` in the browser and compare fingerprints.

## Errors

Non-2xx responses return `{ "error": { "code": "unknown_district", "message": "…" } }`.
The UI shows the message in an error panel and keeps the last good result visible.

## Planned (not built yet — UI shows these as "coming with the live backend")

- `POST /simulate` — custom anomaly sliders (rain %, temperature °C, start month, duration);
  same response shape as `/simulations` with `request.scenario = "custom"`.
- `GET /simulations?...&mask=` — recovery under a missing-data mask.
