# EpiMetrics-Climate: synthetic dataset v0.1.1 (generator v0.1.0)

> **SYNTHETIC DATA — RESEARCH DEMONSTRATION ONLY.** All disease case records and climate scenarios in this dataset are artificially generated. They do not represent actual Tamil Nadu surveillance data, verified climate projections, or clinically validated outbreak forecasts. Recovery-time estimates, recurrence events and intervention effects depend on modelling assumptions and must not be used for clinical decisions or operational public-health alerts.

The primary outcome is **time to sustained recovery**: how many months a district takes to return to, and stay at or below, its endemic threshold for 3 consecutive months after an outbreak peak. Case counts are an intermediate step toward that outcome.

## Scale

- 2 diseases (dengue, malaria) × 5 illustrative districts (Chennai, Coimbatore, Madurai, Tiruchirappalli, Thanjavur)
- 120 months (Jan 2015 – Dec 2024)
- 7 climate scenarios
- 1,200 baseline disease–district–month records; 8,400 rows including scenarios
- 600 baseline climate records; 4,200 rows including scenarios

## Folders

| Folder | What it holds | Who may use it |
| --- | --- | --- |
| `data/synthetic/` | Model inputs and configuration tables | Models and the simulator |
| `data/ground_truth/` | Noise-free expected trajectories, true thresholds, true outbreak events and true recovery times | **Evaluation only.** Never feed these to a model. |
| `data/derived/` | Tables built from the inputs: estimated thresholds and a model-ready table with lag features and a train/test split | Models and the simulator |
| `data/outputs/` | Recovery estimates, the sensitivity grid and an empty results template | Results and audit |
| `configs/` | Every generator parameter (hypothetical) | Reproducibility |
| `data_dictionary.csv` | Every field in every CSV: type, unit, key, description | Everyone |
| `dataset_catalog.csv` | One row per table: path, role, rows, columns, purpose | Everyone |

## Tables

| Table | Folder | Rows | Purpose |
| --- | --- | --- | --- |
| disease_cases | synthetic | 8,400 | Monthly synthetic case counts, all scenarios |
| climate_history | synthetic | 4,200 | Monthly rainfall, temperature and humidity, all scenarios |
| disease_profiles | synthetic | 2 | Disease-specific seasonality, climate drivers, lags and response shapes |
| district_metadata | synthetic | 5 | Population, density, urbanisation, climate zone (illustrative) |
| environmental_vulnerability | synthetic | 5 | Drainage, water storage, flood exposure (illustrative) |
| scenarios | synthetic | 7 | Scenario list |
| climate_anomalies | synthetic | 7 | Exactly how each scenario changes the baseline climate |
| intervention_profiles | synthetic | 3 | Hypothetical, for Phase 4; not used by the generator yet |
| missing_data_masks | synthetic | 435 | Four mask sets for robustness tests |
| recovery_rules | synthetic | 3 | 3-month rule (default) plus 2- and 4-month rules for sensitivity tests |
| climate_normals | synthetic | 60 | District × month climatology the climate generator starts from |
| seasonal_baseline_thresholds | derived | 120 | Endemic threshold per district, disease and month, estimated from observed 2015–2021 cases |
| model_ready_dataset | derived | 2,800 | Cases + climate + rainfall/temperature/humidity lags + `cases_lag12` + `y_log`/`y_next` targets + chronological `split`, de-duplicated (see below) |
| ground_truth_trajectories | ground_truth | 8,400 | Expected cases, endemic level, true threshold, climate effect |
| outbreak_events | ground_truth | 131 | True primary outbreaks and recurrent waves |
| recovery_truth | ground_truth | 70 | True recovery time for each scenario × disease × district |
| simulation_runs | outputs | 280 | Recovery estimated from noisy observed cases (KPI, interruptions, spread across 50 replicates) |
| sensitivity_grid | outputs | 840 | True vs estimated recovery under 2/3/4-month windows × threshold factors 1.1/1.2/1.3/1.5 |
| simulation_results_template | outputs | 0 | Empty schema (same columns as simulation_runs) for results the simulator writes |

## Using `model_ready_dataset` (v0.1.1)

| `split` | Rows | What it is | Use |
| --- | --- | --- | --- |
| `train` | 840 | Baseline, 2015-01 – 2021-12 | Fit models here only |
| `test` | 360 | Baseline, 2022-01 – 2024-12 | Chronological hold-out |
| `scenario` | 1,600 | Altered climate, from each scenario's first anomaly month (`scenario_window_start`) to 2024-12 | Scenario evaluation only; never train on these |

- **No duplicated training data.** All seven scenarios share the baseline climate and cases until their first anomaly month, so those rows are omitted for every non-baseline scenario. Training and test rows are unique.
- **Lags and targets stay correct.** Lags, `y_log` and `y_next` are computed on each full, continuous 2015–2024 series *before* rows are omitted, so a scenario's first row still has its 1–12-month history. To run a model on a scenario's complete series, prepend the baseline rows before `scenario_window_start`.
- **Targets (plan §3.3).** `y_log = ln(1 + cases)` and `y_next = y_log(t+1)`; `y_next` is empty only in Dec 2024.
- **`duplicate_of`.** 127 scenario rows are identical to another scenario's row (for example, `warm_wet` equals `warmer` until its extra rain starts in Oct 2022, and short anomalies converge back to baseline by late 2023). They are kept so each scenario series stays continuous for recovery evaluation, and are flagged with the scenario they match. Drop rows where `duplicate_of` is not empty when you need unique observations.
- `validate_data.py` now fails if train/test contain duplicates, if any unflagged rows are duplicated, or if `y_log`/`y_next` do not match the case series. `src/verify_semantics.py` adds 34 independent checks: `python src/verify_semantics.py .`

## How the data is generated

1. **Climate.** Each district has a monthly rainfall climatology. The coastal and delta districts peak in the northeast monsoon (Oct–Dec); the inland districts have two smaller peaks. Seeded noise and year-to-year monsoon strength are added. Each scenario applies the anomalies in `climate_anomalies.csv` to the same baseline climate.
2. **Disease.** Expected cases are calculated as `E_t × exp(L_t)`.
   - `E_t` is the seasonal endemic level, scaled by population, urbanisation and water storage.
   - `L_t = ρ·L_{t-1} + climate effect + outbreak shocks`.
   - The climate effect compares lagged climate with climatology through a disease-specific response curve:
     - dengue: rainfall has a hump-shaped effect, so very heavy rain flushes breeding sites; temperature peaks near 28 °C; humidity follows a logistic curve
     - malaria: rainfall has a saturating effect; temperature peaks near 25 °C
3. **Observation.** Reported cases are negative-binomial draws around the expected value.
4. **Common random numbers.** Outbreak shocks and noise draws are the same in every scenario, so differences between scenarios come only from climate.
5. **Demo outbreak.** Every series contains a seeded outbreak in Sep–Oct 2022. Its baseline peak is the reference month `t0`, so all scenarios measure recovery from the same starting point.

## Recovery convention (project-defined, not an epidemiological standard)

- **Threshold.** The threshold is the median of the same calendar month in 2015–2021, multiplied by 1.2. Estimates use observed data; ground truth uses the true endemic level.
- **`recovery_month`.** This is the *first* month of the first run of 3 consecutive months at or below the threshold, from `t0` onward. Recovery is confirmed 2 months later.
- **Interruption.** After at least one month of decline, cases rise above the threshold and to at least 1.2 × the latest low, for 2 consecutive months.
- **Statuses.**
  - `recovered`.
  - `not_recovered_within_horizon`: censored. The output never fabricates a date.
  - `insufficient_data`: more than 30% of months after `t0` are missing.

## Ground-truth recovery time (months from t0)

Values come from `recovery_truth.csv`. "censored" means no sustained recovery before Dec 2024.

| Disease | District | Baseline | Delayed monsoon | Heavy rain in decline | Prolonged wet | Irregular rain | Warmer | Warm + wet |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dengue | Chennai | 7 | 8 | 8 | 9 | 12 | 4 | 4 |
| dengue | Coimbatore | 3 | 13 | 13 | 13 | censored | 5 | 8 |
| dengue | Madurai | 10 | 10 | 10 | 10 | 13 | 4 | 5 |
| dengue | Tiruchirappalli | 5 | 7 | 7 | 9 | 11 | 3 | 5 |
| dengue | Thanjavur | 4 | 9 | 7 | 9 | 12 | 5 | 5 |
| malaria | Chennai | 3 | 9 | 8 | 9 | 14 | 2 | 2 |
| malaria | Coimbatore | 4 | 7 | 9 | 11 | censored | 4 | 5 |
| malaria | Madurai | 3 | 10 | 10 | 11 | censored | 2 | 3 |
| malaria | Tiruchirappalli | 3 | 9 | 7 | 9 | censored | 2 | 2 |
| malaria | Thanjavur | 3 | 2 | 9 | 10 | censored | 2 | 2 |

These numbers show how the generator behaves under its own assumptions. They are not findings about real dengue or malaria. Warming *shortens* recovery here because several districts are already above the assumed temperature optimum. That result comes directly from the assumed response curve and needs a literature check.

## Reproduce

```bash
pip install -r requirements.txt
python src/generate_data.py      # writes inputs, ground truth and simulation_runs (seed 42; byte-identical on rerun)
python src/build_derived.py      # writes climate_normals, thresholds, model_ready_dataset, sensitivity_grid, template
python src/validate_data.py      # writes data_dictionary.csv + dataset_catalog.csv and checks every CSV
```

## Changes from the earlier planning dictionary

- **Baseline rates** are lowered to dengue 2 and malaria 0.8 per 100k per month. This keeps state-level synthetic totals on a plausible scale.
- **Negative-binomial dispersion** k = 50.
- **Four supporting tables added:** `scenarios`, `recovery_rules`, `ground_truth_trajectories` and `recovery_truth`.
- **New climate-anomaly types and units:**
  - new `anomaly_type` values `rainfall_pct` and `irregular_rain`, with a `period_months` column
  - new `magnitude_unit` values `mm_added` and `mm_minimum`
- **Missing-data masks** gain a `disease_id` column and a `cases_outage_9m` mask.
- **Not used by generator v0.1.0:** `flood_exposure_index` and `intervention_profiles`.
- **Added after review of alternative dataset designs:** `climate_normals`, `seasonal_baseline_thresholds`, `model_ready_dataset`, `sensitivity_grid`, `simulation_results_template` and `dataset_catalog`.
- **Not added:** daily climate. The recovery outcome is monthly, so daily synthetic weather would add size without adding information.

## Sensitivity check (from `sensitivity_grid.csv`)

The mean absolute error of estimated vs true recovery time ranges from 1.5 to 3.1 months across the 12 rule combinations. The default rule (3 months, factor 1.2) gives 2.2 months, with the status (recovered or not) correct 94% of the time. A higher threshold factor gives smaller errors, but it also declares recovery at higher case levels. That trade-off is for the team to decide, and the report should state the choice.
