"""Writes data_dictionary.csv and validates every generated CSV against it.

Checks: every column is documented, keys are unique, foreign keys resolve,
numeric ranges hold, counts are non-negative integers, dates are YYYY-MM.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
YM = "string YYYY-MM"

# table, folder, field, type, unit / allowed values, key, description, min, max
D = [
    # 1 disease_cases
    ("disease_cases", "synthetic", "year_month", "string", YM, "PK", "Calendar month", None, None),
    ("disease_cases", "synthetic", "district_id", "string", "FK district_metadata", "PK", "District code", None, None),
    ("disease_cases", "synthetic", "disease_id", "string", "FK disease_profiles", "PK", "Disease code", None, None),
    ("disease_cases", "synthetic", "scenario_id", "string", "FK scenarios", "PK", "Climate scenario that produced the row", None, None),
    ("disease_cases", "synthetic", "cases", "integer", ">= 0", "", "Synthetic reported cases in the month (expected value + negative-binomial observation noise). Missingness is applied separately from missing_data_masks", 0, None),
    ("disease_cases", "synthetic", "cases_per_100k", "float", ">= 0", "", "cases / population x 100000", 0, None),
    ("disease_cases", "synthetic", "data_type", "string", "synthetic_observed | scenario", "", "synthetic_observed = baseline climate; scenario = altered climate", None, None),
    # 2 climate_history
    ("climate_history", "synthetic", "year_month", "string", YM, "PK", "Calendar month", None, None),
    ("climate_history", "synthetic", "district_id", "string", "FK district_metadata", "PK", "District code", None, None),
    ("climate_history", "synthetic", "scenario_id", "string", "FK scenarios", "PK", "Climate scenario", None, None),
    ("climate_history", "synthetic", "rainfall_mm", "float", "mm per month, 0-1500", "", "Monthly rainfall total", 0, 1500),
    ("climate_history", "synthetic", "mean_temperature_c", "float", "degC, 15-40", "", "Monthly mean air temperature", 15, 40),
    ("climate_history", "synthetic", "relative_humidity_pct", "float", "%, 20-100", "", "Monthly mean relative humidity", 20, 100),
    ("climate_history", "synthetic", "data_type", "string", "synthetic_observed | scenario", "", "Provenance flag", None, None),
    # 3 disease_profiles
    ("disease_profiles", "synthetic", "disease_id", "string", "dengue | malaria", "PK", "Disease code", None, None),
    ("disease_profiles", "synthetic", "display_name", "string", "", "", "Label shown in the simulator", None, None),
    ("disease_profiles", "synthetic", "baseline_rate_per_100k", "float", "cases per 100k per month", "", "Endemic rate before seasonality, climate and outbreaks (hypothetical)", 0, None),
    ("disease_profiles", "synthetic", "seasonality_params", "JSON", "{amplitude, peak_month}", "", "Seasonal curve of the endemic baseline: 1 + amplitude x cos(2pi(month - peak_month)/12)", None, None),
    ("disease_profiles", "synthetic", "climate_drivers", "string", "semicolon list", "", "Climate variables the disease responds to in the model", None, None),
    ("disease_profiles", "synthetic", "lag_months", "JSON", "per driver, months", "", "Delay between climate signal and case response", None, None),
    ("disease_profiles", "synthetic", "response_params", "JSON", "per driver", "", "Response curve: hump (rain optimum), saturating (half-saturation), gaussian (optimum, width), logistic (midpoint, scale); plus weight", None, None),
    ("disease_profiles", "synthetic", "persistence_rho", "float", "0-1", "", "Month-to-month carry-over of excess transmission; higher = waves last longer", 0, 1),
    ("disease_profiles", "synthetic", "nb_dispersion_k", "float", "> 0", "", "Negative-binomial dispersion for observation noise; lower = noisier", 0, None),
    ("disease_profiles", "synthetic", "recovery_rule_id", "string", "FK recovery_rules", "", "Default recovery rule for this disease", None, None),
    # 4 district_metadata
    ("district_metadata", "synthetic", "district_id", "string", "chn | cbe | mdu | try | tnj", "PK", "District code", None, None),
    ("district_metadata", "synthetic", "district_name", "string", "", "", "Display name (values for the district are illustrative, not real)", None, None),
    ("district_metadata", "synthetic", "population", "integer", "persons", "", "Illustrative population; denominator for rates", 1, None),
    ("district_metadata", "synthetic", "population_density_per_km2", "float", "persons per km2", "", "Illustrative", 0, None),
    ("district_metadata", "synthetic", "urbanisation_pct", "float", "%", "", "Illustrative; raises the endemic baseline", 0, 100),
    ("district_metadata", "synthetic", "climate_zone", "string", "coastal | inland | delta", "", "Selects the rainfall climatology shape", None, None),
    # 5 environmental_vulnerability
    ("environmental_vulnerability", "synthetic", "district_id", "string", "FK district_metadata", "PK", "District code", None, None),
    ("environmental_vulnerability", "synthetic", "drainage_index", "float", "0-1, higher = better", "", "Damps the rainfall effect: weight x (1.3 - 0.6 x drainage_index)", 0, 1),
    ("environmental_vulnerability", "synthetic", "water_storage_index", "float", "0-1", "", "Household water storage; raises the endemic baseline", 0, 1),
    ("environmental_vulnerability", "synthetic", "flood_exposure_index", "float", "0-1", "", "Recorded for future use; not used by generator v0.1.0", 0, 1),
    # scenarios (supporting)
    ("scenarios", "synthetic", "scenario_id", "string", "", "PK", "Scenario code", None, None),
    ("scenarios", "synthetic", "description", "string", "", "", "Plain-language description (hypothetical input, not a projection)", None, None),
    # 7 climate_anomalies
    ("climate_anomalies", "synthetic", "anomaly_id", "string", "", "PK", "Anomaly code", None, None),
    ("climate_anomalies", "synthetic", "scenario_id", "string", "FK scenarios", "", "Scenario the anomaly belongs to", None, None),
    ("climate_anomalies", "synthetic", "district_id", "string", "FK or 'all'", "", "Where it applies", None, None),
    ("climate_anomalies", "synthetic", "anomaly_type", "string", "monsoon_shift | heavy_rain | prolonged_wet | rainfall_pct | irregular_rain | temperature_shift", "", "Kind of change applied to the baseline climate", None, None),
    ("climate_anomalies", "synthetic", "start_month", "string", YM, "", "First affected month", None, None),
    ("climate_anomalies", "synthetic", "duration_months", "integer", "months", "", "Number of months affected", 1, None),
    ("climate_anomalies", "synthetic", "magnitude", "float", "see magnitude_unit", "", "Size of the change", None, None),
    ("climate_anomalies", "synthetic", "magnitude_unit", "string", "months | mm_added | mm_minimum | pct | c", "", "months = rainfall shifted later; mm_added = extra rain; mm_minimum = rain floor; pct = % change; c = degC added", None, None),
    ("climate_anomalies", "synthetic", "period_months", "integer", "nullable", "", "irregular_rain only: a wet spell every N months", 1, None),
    # 8 intervention_profiles
    ("intervention_profiles", "synthetic", "intervention_id", "string", "", "PK", "Intervention code (Phase 4, not used by generator v0.1.0)", None, None),
    ("intervention_profiles", "synthetic", "disease_id", "string", "FK disease_profiles", "", "Disease targeted", None, None),
    ("intervention_profiles", "synthetic", "name", "string", "", "", "Hypothetical intervention", None, None),
    ("intervention_profiles", "synthetic", "assumed_effect", "float", "0-1 relative reduction", "", "Hypothetical effect size; must be labelled as such", 0, 1),
    ("intervention_profiles", "synthetic", "cost", "float", "illustrative units", "", "Not a real budget figure", 0, None),
    ("intervention_profiles", "synthetic", "implementation_lag_months", "integer", "months", "", "Delay before effect starts", 0, None),
    # 9 missing_data_masks
    ("missing_data_masks", "synthetic", "mask_id", "string", "mar_10pct | cases_gap_3m | cases_outage_9m | rain_outage_3m", "PK", "Mask set; apply by setting matching values to missing", None, None),
    ("missing_data_masks", "synthetic", "year_month", "string", YM, "PK", "Masked month", None, None),
    ("missing_data_masks", "synthetic", "district_id", "string", "FK district_metadata", "PK", "District", None, None),
    ("missing_data_masks", "synthetic", "disease_id", "string", "FK disease_profiles; empty for climate variables", "PK", "Disease whose cases are masked", None, None),
    ("missing_data_masks", "synthetic", "variable", "string", "cases | rainfall_mm | mean_temperature_c | relative_humidity_pct", "PK", "Field set to missing", None, None),
    ("missing_data_masks", "synthetic", "missing_reason", "string", "random | reporting_delay | sensor_outage", "", "Missing at random vs structured gap", None, None),
    # recovery_rules (supporting)
    ("recovery_rules", "synthetic", "recovery_rule_id", "string", "", "PK", "Rule code", None, None),
    ("recovery_rules", "synthetic", "threshold_factor", "float", "", "", "Endemic threshold = same-calendar-month median of training years x factor", 1, None),
    ("recovery_rules", "synthetic", "window_months", "integer", "months", "", "Consecutive months at or below threshold needed for sustained recovery", 1, None),
    ("recovery_rules", "synthetic", "interruption_rise_factor", "float", "", "", "A new wave must reach this multiple of the latest low point", 1, None),
    ("recovery_rules", "synthetic", "interruption_rise_months", "integer", "months", "", "...and stay above threshold for this many consecutive months", 1, None),
    ("recovery_rules", "synthetic", "max_missing_frac", "float", "0-1", "", "Above this share of missing months after t0 the result is insufficient_data", 0, 1),
    # ground truth
    ("ground_truth_trajectories", "ground_truth", "year_month", "string", YM, "PK", "Calendar month", None, None),
    ("ground_truth_trajectories", "ground_truth", "district_id", "string", "FK", "PK", "District", None, None),
    ("ground_truth_trajectories", "ground_truth", "disease_id", "string", "FK", "PK", "Disease", None, None),
    ("ground_truth_trajectories", "ground_truth", "scenario_id", "string", "FK", "PK", "Scenario", None, None),
    ("ground_truth_trajectories", "ground_truth", "endemic_baseline_cases", "float", "cases", "", "True seasonal endemic level E (no climate anomaly, no outbreak)", 0, None),
    ("ground_truth_trajectories", "ground_truth", "true_threshold_cases", "float", "cases", "", "True endemic threshold = 1.2 x E", 0, None),
    ("ground_truth_trajectories", "ground_truth", "expected_cases", "float", "cases", "", "Noise-free expected cases; the synthetic ground truth", 0, None),
    ("ground_truth_trajectories", "ground_truth", "climate_log_effect", "float", "log multiplier", "", "Lagged climate contribution this month (0 = climatology)", -1.5, 1.5),
    ("ground_truth_trajectories", "ground_truth", "data_type", "string", "synthetic_reference", "", "Never give these columns to a model as inputs", None, None),
    # 6 outbreak_events
    ("outbreak_events", "ground_truth", "event_id", "string", "", "PK", "Event code", None, None),
    ("outbreak_events", "ground_truth", "disease_id", "string", "FK", "", "Disease", None, None),
    ("outbreak_events", "ground_truth", "district_id", "string", "FK", "", "District", None, None),
    ("outbreak_events", "ground_truth", "scenario_id", "string", "FK or 'all'", "", "'all' = random outbreak before Jul 2022, identical in every scenario", None, None),
    ("outbreak_events", "ground_truth", "source", "string", "generator_truth", "", "Truth from the generator (detected events from models go in model outputs)", None, None),
    ("outbreak_events", "ground_truth", "event_type", "string", "primary | recurrent_wave", "", "recurrent_wave = began before the previous event sustainably recovered", None, None),
    ("outbreak_events", "ground_truth", "onset_month", "string", YM, "", "First month above the true threshold (primary) or wave detection month", None, None),
    ("outbreak_events", "ground_truth", "peak_month", "string", YM, "", "Month of maximum expected cases", None, None),
    ("outbreak_events", "ground_truth", "recovery_month", "string", YM + ", nullable", "", "First month of the qualifying 3-month window; empty if censored", None, None),
    ("outbreak_events", "ground_truth", "recovery_status", "string", "recovered | not_recovered_within_horizon", "", "", None, None),
    ("outbreak_events", "ground_truth", "note", "string", "", "", "How the event was created", None, None),
    # recovery truth
    ("recovery_truth", "ground_truth", "scenario_id", "string", "FK", "PK", "Scenario", None, None),
    ("recovery_truth", "ground_truth", "disease_id", "string", "FK", "PK", "Disease", None, None),
    ("recovery_truth", "ground_truth", "district_id", "string", "FK", "PK", "District", None, None),
    ("recovery_truth", "ground_truth", "reference_month", "string", YM, "", "t0 = peak of the demo outbreak in the BASELINE expected trajectory; shared by all scenarios", None, None),
    ("recovery_truth", "ground_truth", "recovery_rule_id", "string", "FK recovery_rules", "", "Rule applied", None, None),
    ("recovery_truth", "ground_truth", "true_recovery_month", "string", YM + ", nullable", "", "First month of the first 3-month run with expected_cases <= true_threshold_cases", None, None),
    ("recovery_truth", "ground_truth", "true_time_to_sustained_recovery_months", "integer", "months, nullable", "", "PRIMARY KPI (truth): true_recovery_month - reference_month", 0, None),
    ("recovery_truth", "ground_truth", "true_recovery_status", "string", "recovered | not_recovered_within_horizon", "", "Censored if no qualifying window before Dec 2024", None, None),
    ("recovery_truth", "ground_truth", "true_recovery_interruption_count", "integer", ">= 0", "", "New waves that began before sustained recovery", 0, None),
    ("recovery_truth", "ground_truth", "true_months_above_endemic_threshold", "integer", ">= 0", "", "Months from t0 to recovery (or horizon) above the true threshold", 0, None),
    ("recovery_truth", "ground_truth", "data_type", "string", "synthetic_reference", "", "Ground truth flag", None, None),
    # 10 simulation_runs
    ("simulation_runs", "outputs", "run_id", "string", "scenario__disease__district__mask", "PK", "Run code", None, None),
    ("simulation_runs", "outputs", "scenario_id", "string", "FK", "", "Scenario", None, None),
    ("simulation_runs", "outputs", "disease_id", "string", "FK", "", "Disease", None, None),
    ("simulation_runs", "outputs", "district_id", "string", "FK", "", "District", None, None),
    ("simulation_runs", "outputs", "seed", "integer", "", "", "Master random seed", None, None),
    ("simulation_runs", "outputs", "model_version", "string", "semver", "", "Generator / engine version", None, None),
    ("simulation_runs", "outputs", "recovery_rule_id", "string", "FK recovery_rules", "", "Rule applied", None, None),
    ("simulation_runs", "outputs", "mask_id", "string", "FK missing_data_masks, nullable", "", "Case mask applied; empty = complete data", None, None),
    ("simulation_runs", "outputs", "reference_month", "string", YM, "", "t0 estimated from observed baseline cases (peak Aug 2022 - Feb 2023)", None, None),
    ("simulation_runs", "outputs", "recovery_month", "string", YM + ", nullable", "", "Estimated: first month of the qualifying window", None, None),
    ("simulation_runs", "outputs", "recovery_confirmed_month", "string", YM + ", nullable", "", "recovery_month + window - 1", None, None),
    ("simulation_runs", "outputs", "time_to_sustained_recovery_months", "integer", "months, nullable", "", "PRIMARY KPI (estimated from observed cases)", 0, None),
    ("simulation_runs", "outputs", "recovery_status", "string", "recovered | not_recovered_within_horizon | insufficient_data", "", "", None, None),
    ("simulation_runs", "outputs", "recovery_delay_vs_baseline_months", "integer", "months, nullable", "", "Scenario minus baseline estimate (same mask); empty if either is censored", None, None),
    ("simulation_runs", "outputs", "recovery_interruption_count", "integer", ">= 0", "", "Detected new waves before sustained recovery", 0, None),
    ("simulation_runs", "outputs", "months_above_endemic_threshold", "integer", ">= 0", "", "From t0 to recovery (or horizon)", 0, None),
    ("simulation_runs", "outputs", "secondary_outbreak_count", "integer", ">= 0", "", "All detected waves after t0, including after recovery", 0, None),
    ("simulation_runs", "outputs", "recovery_months_p10", "float", "months, nullable", "", "10th percentile across 50 observation-noise replicates (empty if <50% recovered)", 0, None),
    ("simulation_runs", "outputs", "recovery_months_p90", "float", "months, nullable", "", "90th percentile across replicates", 0, None),
    ("simulation_runs", "outputs", "share_replicates_recovered", "float", "0-1", "", "Share of replicates that recovered within the horizon", 0, 1),
    ("simulation_runs", "outputs", "created_at", "string", "ISO 8601", "", "Generation timestamp (fixed for reproducibility)", None, None),
    # climate_normals
    ("climate_normals", "synthetic", "district_id", "string", "FK district_metadata", "PK", "District", None, None),
    ("climate_normals", "synthetic", "calendar_month", "integer", "1-12", "PK", "Calendar month", 1, 12),
    ("climate_normals", "synthetic", "rainfall_normal_mm", "float", "mm", "", "Climatological rainfall the generator starts from (illustrative)", 0, 1500),
    ("climate_normals", "synthetic", "temperature_normal_c", "float", "degC", "", "Climatological mean temperature before noise and trend", 15, 40),
    ("climate_normals", "synthetic", "humidity_normal_pct", "float", "%", "", "Climatological relative humidity", 20, 100),
    ("climate_normals", "synthetic", "data_type", "string", "synthetic_parameter", "", "Generator parameter, not an observation", None, None),
    # seasonal_baseline_thresholds
    ("seasonal_baseline_thresholds", "derived", "district_id", "string", "FK", "PK", "District", None, None),
    ("seasonal_baseline_thresholds", "derived", "disease_id", "string", "FK", "PK", "Disease", None, None),
    ("seasonal_baseline_thresholds", "derived", "calendar_month", "integer", "1-12", "PK", "Calendar month", 1, 12),
    ("seasonal_baseline_thresholds", "derived", "training_median_cases", "float", "cases", "", "Median observed baseline cases in this calendar month, 2015-2021", 0, None),
    ("seasonal_baseline_thresholds", "derived", "training_months", "integer", "count", "", "Months contributing to the median", 1, None),
    ("seasonal_baseline_thresholds", "derived", "threshold_factor", "float", "", "", "Multiplier applied (default rule)", 1, None),
    ("seasonal_baseline_thresholds", "derived", "threshold_cases", "float", "cases", "", "Estimated endemic threshold used by the recovery estimator (min 1)", 1, None),
    ("seasonal_baseline_thresholds", "derived", "training_period", "string", "", "", "Months used", None, None),
    # model_ready_dataset
    ("model_ready_dataset", "derived", "year_month", "string", YM, "PK", "Calendar month", None, None),
    ("model_ready_dataset", "derived", "district_id", "string", "FK", "PK", "District", None, None),
    ("model_ready_dataset", "derived", "disease_id", "string", "FK", "PK", "Disease", None, None),
    ("model_ready_dataset", "derived", "scenario_id", "string", "FK", "PK", "Scenario", None, None),
    ("model_ready_dataset", "derived", "year", "integer", "", "", "Year", 2015, 2024),
    ("model_ready_dataset", "derived", "calendar_month", "integer", "1-12", "", "Month of year (for seasonal terms)", 1, 12),
    ("model_ready_dataset", "derived", "population", "integer", "persons", "", "Illustrative district population", 1, None),
    ("model_ready_dataset", "derived", "cases", "integer", ">= 0", "", "Target: observed synthetic cases", 0, None),
    ("model_ready_dataset", "derived", "cases_per_100k", "float", ">= 0", "", "Rate version of the target", 0, None),
    ("model_ready_dataset", "derived", "rainfall_mm", "float", "mm", "", "Same-month rainfall", 0, 1500),
    ("model_ready_dataset", "derived", "mean_temperature_c", "float", "degC", "", "Same-month temperature", 15, 40),
    ("model_ready_dataset", "derived", "relative_humidity_pct", "float", "%", "", "Same-month humidity", 20, 100),
    ("model_ready_dataset", "derived", "rainfall_mm_lag1", "float", "mm, empty in first month", "", "Rainfall 1 month earlier", 0, 1500),
    ("model_ready_dataset", "derived", "rainfall_mm_lag2", "float", "mm", "", "Rainfall 2 months earlier (the generator's assumed lag for both diseases)", 0, 1500),
    ("model_ready_dataset", "derived", "rainfall_mm_lag3", "float", "mm", "", "Rainfall 3 months earlier", 0, 1500),
    ("model_ready_dataset", "derived", "mean_temperature_c_lag1", "float", "degC", "", "Temperature 1 month earlier", 15, 40),
    ("model_ready_dataset", "derived", "mean_temperature_c_lag2", "float", "degC", "", "Temperature 2 months earlier", 15, 40),
    ("model_ready_dataset", "derived", "relative_humidity_pct_lag1", "float", "%", "", "Humidity 1 month earlier", 20, 100),
    ("model_ready_dataset", "derived", "relative_humidity_pct_lag2", "float", "%", "", "Humidity 2 months earlier", 20, 100),
    ("model_ready_dataset", "derived", "cases_lag1", "float", "cases", "", "Cases 1 month earlier", 0, None),
    ("model_ready_dataset", "derived", "cases_lag12", "float", "cases", "", "Cases 12 months earlier (seasonal naive baseline)", 0, None),
    ("model_ready_dataset", "derived", "y_log", "float", "ln(cases + 1)", "", "Log-transformed target y_log(t) = ln(1 + cases), project plan section 3.3", 0, None),
    ("model_ready_dataset", "derived", "y_next", "float", "ln(cases + 1), empty in last month", "", "1-step lookahead target y_next(t) = y_log(t+1) of the same series; empty in Dec 2024", 0, None),
    ("model_ready_dataset", "derived", "scenario_window_start", "string", YM + ", empty for baseline", "", "First anomaly month of the scenario; scenario rows before it are exact copies of baseline rows and are omitted", None, None),
    ("model_ready_dataset", "derived", "split", "string", "train | test | scenario", "", "train = baseline <= 2021-12; test = baseline >= 2022-01; scenario = altered-climate rows from scenario_window_start (evaluation only, never training). Never shuffle", None, None),
    ("model_ready_dataset", "derived", "duplicate_of", "string", "FK scenarios, nullable", "", "Empty if the row is unique. Otherwise the first scenario (baseline first) with an identical row, e.g. after a short anomaly wears off. Drop these rows when you need unique observations", None, None),
    ("model_ready_dataset", "derived", "data_type", "string", "synthetic_observed | scenario", "", "Provenance flag", None, None),
    # sensitivity_grid
    ("sensitivity_grid", "outputs", "scenario_id", "string", "FK", "PK", "Scenario", None, None),
    ("sensitivity_grid", "outputs", "disease_id", "string", "FK", "PK", "Disease", None, None),
    ("sensitivity_grid", "outputs", "district_id", "string", "FK", "PK", "District", None, None),
    ("sensitivity_grid", "outputs", "window_months", "integer", "2 | 3 | 4", "PK", "Consecutive months required", 2, 4),
    ("sensitivity_grid", "outputs", "threshold_factor", "float", "1.1 | 1.2 | 1.3 | 1.5", "PK", "Threshold multiplier", 1, 2),
    ("sensitivity_grid", "outputs", "true_time_to_sustained_recovery_months", "integer", "months, nullable", "", "Truth under this rule (from ground_truth_trajectories)", 0, None),
    ("sensitivity_grid", "outputs", "true_recovery_status", "string", "recovered | not_recovered_within_horizon", "", "", None, None),
    ("sensitivity_grid", "outputs", "true_recovery_interruption_count", "integer", ">= 0", "", "", 0, None),
    ("sensitivity_grid", "outputs", "estimated_time_to_sustained_recovery_months", "integer", "months, nullable", "", "Estimate from observed cases under this rule", 0, None),
    ("sensitivity_grid", "outputs", "estimated_recovery_status", "string", "recovered | not_recovered_within_horizon | insufficient_data", "", "", None, None),
    ("sensitivity_grid", "outputs", "estimated_recovery_interruption_count", "integer", ">= 0", "", "", 0, None),
    ("sensitivity_grid", "outputs", "absolute_error_months", "integer", "months, nullable", "", "|estimate - truth|; empty if either is censored", 0, None),
    ("sensitivity_grid", "outputs", "status_match", "boolean", "", "", "Estimated status equals true status", None, None),
]
D += [("simulation_results_template",) + r[1:] for r in D if r[0] == "simulation_runs"]

CATALOG = {
    "disease_cases": ("input", "Synthetic monthly dengue and malaria cases, all scenarios"),
    "climate_history": ("input", "Monthly rainfall, temperature and humidity, all scenarios"),
    "climate_normals": ("parameter", "District climatology the climate generator starts from"),
    "disease_profiles": ("parameter", "Disease-specific seasonality, drivers, lags and response shapes"),
    "district_metadata": ("parameter", "Illustrative population and district characteristics"),
    "environmental_vulnerability": ("parameter", "Illustrative drainage, water storage and flood exposure"),
    "scenarios": ("parameter", "Climate scenario list"),
    "climate_anomalies": ("parameter", "How each scenario alters the baseline climate"),
    "intervention_profiles": ("parameter", "Hypothetical interventions (Phase 4, unused in v0.1.0)"),
    "missing_data_masks": ("robustness", "Masks for missing-data experiments"),
    "recovery_rules": ("parameter", "Recovery rule definitions (default + sensitivity variants)"),
    "seasonal_baseline_thresholds": ("derived", "Endemic thresholds estimated from observed baseline cases"),
    "model_ready_dataset": ("derived", "Cases + climate + lag features + y_log/y_next targets + train/test/scenario split, de-duplicated (scenario rows only from their first anomaly month)"),
    "ground_truth_trajectories": ("truth (evaluation only)", "Noise-free expected cases, endemic level and true threshold"),
    "outbreak_events": ("truth (evaluation only)", "True primary outbreaks and recurrent waves"),
    "recovery_truth": ("truth (evaluation only)", "True recovery time per scenario, disease and district"),
    "simulation_runs": ("output", "Recovery estimated from observed cases, incl. missing-data masks and replicate spread"),
    "sensitivity_grid": ("output", "True vs estimated recovery under 2/3/4-month windows and 4 threshold factors"),
    "simulation_results_template": ("template", "Empty schema for results written by the simulator"),
}

COLS = ["table", "folder", "field", "type", "unit_or_allowed_values", "key", "description"]


def main():
    dd = pd.DataFrame([r[:7] for r in D], columns=COLS)
    dd.to_csv(ROOT / "data_dictionary.csv", index=False)
    errors = []
    tables = {}
    for (table, folder), g in dd.groupby(["table", "folder"], sort=False):
        path = ROOT / "data" / folder / f"{table}.csv"
        df = pd.read_csv(path, keep_default_na=True)
        tables[table] = df
        documented, actual = list(g.field), list(df.columns)
        if documented != actual:
            errors.append(f"{table}: columns {actual} != dictionary {documented}")
        pk = list(g[g.key == "PK"].field)
        if pk and df.duplicated(pk).any():
            errors.append(f"{table}: duplicate primary key {pk}")
        for r in D:
            if r[0] != table:
                continue
            f, lo, hi = r[2], r[7], r[8]
            col = df[f].dropna()
            if lo is not None and (col < lo).any():
                errors.append(f"{table}.{f} below {lo}")
            if hi is not None and (col > hi).any():
                errors.append(f"{table}.{f} above {hi}")
            if r[4] == YM and not col.astype(str).str.fullmatch(r"\d{4}-\d{2}").all():
                errors.append(f"{table}.{f} not YYYY-MM")
    districts = set(tables["district_metadata"].district_id)
    diseases = set(tables["disease_profiles"].disease_id)
    scenarios = set(tables["scenarios"].scenario_id)
    for t in ("disease_cases", "climate_history", "ground_truth_trajectories", "recovery_truth", "simulation_runs"):
        df = tables[t]
        if not set(df.district_id) <= districts:
            errors.append(f"{t}: unknown district")
        if "disease_id" in df and not set(df.disease_id) <= diseases:
            errors.append(f"{t}: unknown disease")
        if not set(df.scenario_id) <= scenarios:
            errors.append(f"{t}: unknown scenario")
    if not (tables["disease_cases"].cases % 1 == 0).all():
        errors.append("cases not integer")
    # model_ready_dataset: no scenario row may duplicate a baseline row
    md = tables["model_ready_dataset"]
    feat = [c for c in md.columns if c not in ("scenario_id", "scenario_window_start", "split", "duplicate_of", "data_type")]
    tt = md[md.split.isin(["train", "test"])]
    if tt.duplicated(feat).any():
        errors.append("model_ready_dataset: duplicate rows inside train/test")
    if md[md.duplicate_of.isna()].duplicated(feat).any():
        errors.append("model_ready_dataset: rows with empty duplicate_of are not unique")
    if md[md.split != "scenario"].duplicate_of.notna().any():
        errors.append("model_ready_dataset: duplicate_of set on a train/test row")
    if (md.split == "train").sum() != (md[md.scenario_id == "baseline"].year_month <= "2021-12").sum() or \
            set(md[md.split == "train"].scenario_id) != {"baseline"}:
        errors.append("model_ready_dataset: train split must be baseline rows <= 2021-12 only")
    import numpy as _np
    if not _np.allclose(md.y_log, _np.log1p(md.cases), atol=1e-6):
        errors.append("model_ready_dataset: y_log != ln(1 + cases)")
    dc = tables["disease_cases"].sort_values(["scenario_id", "disease_id", "district_id", "year_month"])
    dc["y_next_ref"] = _np.log1p(dc.groupby(["scenario_id", "disease_id", "district_id"]).cases.shift(-1))
    chk = md.merge(dc[["scenario_id", "disease_id", "district_id", "year_month", "y_next_ref"]], how="left")
    if not ((chk.y_next.isna() == chk.y_next_ref.isna()).all()
            and _np.allclose(chk.y_next.dropna(), chk.y_next_ref.dropna(), atol=1e-6)):
        errors.append("model_ready_dataset: y_next != y_log(t+1) of the full series")
    cat = pd.DataFrame([{"table": t, "path": f"data/{dd[dd.table == t].folder.iloc[0]}/{t}.csv", "role": CATALOG[t][0],
                         "rows": len(tables[t]), "columns": tables[t].shape[1], "purpose": CATALOG[t][1]} for t in dd.table.unique()])
    cat.to_csv(ROOT / "dataset_catalog.csv", index=False)
    print(f"dataset_catalog.csv: {len(cat)} tables")
    print(f"data_dictionary.csv: {len(dd)} fields across {dd.table.nunique()} tables")
    print("VALIDATION " + ("PASSED" if not errors else "FAILED:\n" + "\n".join(errors)))
    return not errors


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
