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

Who may call what is defined once, in `backend/roles.py`, and returned by `GET /auth/me` (so the menu is never
hard-coded). Roles: `junior` (Young Minds), `viewer`, `analyst`, `admin`. The full role × endpoint matrix is tested in
`backend/tests/test_roles.py` (allowed → 200, not allowed → 403).

| Endpoint | junior | viewer | analyst | admin |
|---|---|---|---|---|
| `GET /meta`, `/districts`, `/simulations`, `/recovery-matrix` | yes | yes | yes | yes |
| `POST /events`, `GET /auth/me`, `POST /auth/logout` | yes | yes | yes | yes |
| `GET /analytics/*`, `GET /validation` | no | no | yes | yes |
| `POST /exports` kind `report_pdf`, `print` | no | yes | yes | yes |
| `POST /exports` kind `csv`, `json`, `project_pdf` | no | no | yes | yes |
| `GET /comments` | no | yes | yes | yes |
| `POST /comments`, `PATCH`/`DELETE /comments/{id}` (own only) | no | no | yes | yes |
| `/me/saved`, `/me/favorites` (own only) | no | yes | yes | no |
| `GET /insights` | no | yes | yes | yes |
| `GET /integrity` | no | summary | summary | full |
| `POST /integrity/verify`, `/integrity/validate`, `/audit-log`, `/audit-log.csv`, `/admin/*` | no | no | no | yes |

**Admin preview.** After `POST /admin/view-as {"role": "viewer"}` (audited) the browser sends `X-View-As: viewer`.
The server then answers GET requests with that role's permissions and refuses every write with
`403 preview_read_only`. Only admins may send the header.

IDs must match `^[a-z0-9_]+$` (else 400) and exist (else 404): districts `chn cbe mdu try tnj`; diseases
`dengue malaria`; scenarios `baseline delayed_monsoon heavy_rain_decline prolonged_wet irregular_rain warmer warm_wet`;
masks `none mar_10pct cases_gap_3m cases_outage_9m` (`none` is the default and need not be sent).
Comment views are `district.disease.scenario` (e.g. `cbe.dengue.delayed_monsoon`); months are `YYYY-MM`.

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

Request `{ "kind": "report_pdf | project_pdf | json | csv | print", "district"?, "disease"?, "scenario"?, "mask"?, "with_comments"? }`.
Response `{ "synthetic": true, "ok": true, "export_id": "…", "kind": "…", "logged_at": "…" }`; a kind the role may not
create → 403. The browser builds the file only after this succeeds. With `with_comments`, the report PDF adds a
"Team comments" section (labelled team discussion, not results).

## Personal state

- `GET /me/saved` → `{ saved: [{ id, name, screen, district, disease, scenario, mask, scenario_b, district_b, created_at }] }`
- `POST /me/saved` `{ name (1–80), screen, district, disease, scenario, mask?, scenario_b?, district_b? }` → `{ saved }` (max 50)
- `DELETE /me/saved/{id}` → 404 for another user's id. `GET|POST /me/favorites`, `DELETE /me/favorites/{district}` → `{ favorites: ["cbe", …] }`
- `GET /insights?district&disease[&scenario]` → `{ insights: [{ kind: "coview" | "rule", text, link: { screen, district, disease, scenario? } }] }`
  (at most 3; co-views need at least 3 distinct users; rules use `/recovery-matrix` values)
- `POST /events` `{ event: "screen_open | simulation_view | compare | drilldown | young_activity", screen?, district?, disease?, scenario? }`
  (no free text; the server adds user, role, session and time)

## Comments

- `GET /comments?view=cbe.dengue.delayed_monsoon` → `{ comments: [{ id, view_key, month, author, author_name, author_role, text,
  created_at, edited_at, mine }], note: "Team discussion, not results." }` (hidden and deleted comments are left out)
- `POST /comments` `{ view, text (1–1000, plain text), month? }`; 10 per minute per user, else `429 too_many_comments`
- `PATCH /comments/{id}` `{ text }`, `DELETE /comments/{id}`: own comments only (404 otherwise)
- Text is stored as written and must always be rendered as text, never as HTML.

## Admin

- `GET /admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` (default last 7 days) → `{ active_users_today, active_users_7d, active_users_range,
  per_day: [{ day, active_users, logins, failed_logins, screen_opens }], sessions_by_role, top_screens, top_scenarios,
  top_districts, exports_by_kind, avg_session_minutes, sessions, comments_posted }` (counts only)
- `GET /admin/users` → `{ users: [{ username, display_name, role, disabled, last_login, created_at }], roles }`;
  `POST /admin/users` `{ username, password (10+), role, display_name? }`; `PATCH /admin/users/{u}` `{ role?, disabled?, display_name? }`;
  `POST /admin/users/{u}/password` `{ password }`. A role change, disable or reset ends that user's sessions
  (their next call → `401 session_changed` or `account_disabled`).
- `GET /audit-log?user&event&from&to&limit` → `{ entries, actions }`; `GET /audit-log.csv` (same filters, formula-safe CSV)
- `GET /admin/comments`; `PATCH /admin/comments/{id}` `{ hidden }`; `DELETE /admin/comments/{id}`
- `GET /admin/backups` → `{ backups: [{ name, bytes, created_at, sha256 }] }`; `POST /admin/backups` writes one. Restore is CLI only.
- `POST /admin/view-as` `{ role | null }` → `{ preview, access }`

## `POST /auth/login` (security)

Request `{ "username": "analyst", "password": "…" }` (HTTPS when deployed).
Response `200`:
```jsonc
{ "token": "<HS256 JWT, 15-minute sliding expiry>", "expires_in": 900,
  "user": { "username": "analyst", "display_name": "Demo analyst", "role": "junior | viewer | analyst | admin" },
  "access": { "role": "analyst", "label": "Public health analyst", "home": "overview",
              "screens": [{ "id": "overview", "label": "Overview" }, "…"], "permissions": ["data.read", "…"] },
  "roles": [ /* the same description for every role, for the Users & security table */ ] }
```
Wrong credentials → `401 { "error": { "code": "bad_credentials", "message": "Username or password is incorrect." } }`.
Five failures for one username (or 20 from one IP) → `429 too_many_attempts` for 30 s, with `Retry-After`.
Passwords are stored only as salted PBKDF2-SHA256 hashes in `backend/users.json` and never sent to the browser.
When a token is older than 60 s, any response carries a fresh one in the `X-Session-Token` header.
Disabled accounts get `403 account_disabled` at sign-in.
`POST /auth/logout` revokes the session; `GET /auth/me` returns `{ user, access, preview, roles }` and keeps an active session alive.
An expired, revoked or invalid token → `401`, and the UI returns to the sign-in screen.

Role rules: see the matrix at the top of this file.

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
400 `bad_request` (id format, missing parameter), 401 `unauthorized` / `session_changed` / `account_disabled`,
403 `forbidden` / `preview_read_only` / `account_disabled`, 404 `unknown_<id>` or `unknown_endpoint`,
429 `too_many_attempts` / `too_many_comments`. The UI shows the message in an error panel.

## Security headers

Every response: `Content-Security-Policy` (scripts from this site only; Google Fonts CSS allowed),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`;
`Cache-Control: no-store` on `/api`.

## Not in this version

- `POST /simulate` with custom anomaly sliders. The seven scenarios are the published dataset.
